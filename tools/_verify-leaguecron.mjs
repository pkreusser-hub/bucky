#!/usr/bin/env node
/**
 * GFFL S5 — leaguecron.mjs suite (in-process, zero real network).
 *
 *   node tools/_verify-leaguecron.mjs
 *
 * netlify/functions/leaguecron.mjs is a Netlify SCHEDULED function (no args, no HTTP routing —
 * matches netlify/functions/chorereminders.mjs's exact shape). This suite dynamic-imports it
 * directly and calls its default export, against THREE fake local HTTP servers standing in for
 * Google's OAuth token endpoint, Firestore's REST API, and FCM's send endpoint — the same house
 * pattern tools/_verify-activity.cjs and tools/_verify-health.cjs use (a real generated RSA key
 * signs the JWT so that path is genuinely exercised; nothing here touches real Google, real
 * Firestore, or the family's data).
 *
 * Covers: the Central-hour + weekday guard picking exactly one of the two UTC cron candidates in
 * both real DST states; the season guard (before/at/after the first waiver Wednesday); the
 * FORCE override; a missing-service-account config error; GFFL-audience selection (gfflTeam
 * present, in either Firestore value encoding) vs. family-only exclusion; token dedupe (one FCM
 * send per unique token even when multiple docs share it); per-device send-body correctness; one
 * token's FCM failure never sinking the rest of the run; unregistered-token pruning (including
 * pruning every docId that shared a now-dead token); and the {sent, skipped, reason} summary
 * shape on every path.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; failures.push(name); console.log("  FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");

const GOOG_PORT = 8941, FS_PORT = 8942, FCM_PORT = 8943;
const FAM = "famtestlc";

/* =========================== fake Google token endpoint =========================== */
const KEY = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA_JSON = JSON.stringify({
  client_email: "test@amen-farms-app.iam.gserviceaccount.com",
  private_key: KEY.privateKey.export({ type: "pkcs8", format: "pem" }),
});
const googState = { calls: 0 };
function serveGoogle() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        googState.calls++;
        const p = new URLSearchParams(raw);
        // Confirm a real signed JWT assertion actually went out — the whole point of using a
        // real generated key rather than a stub string.
        googState.lastAssertion = p.get("assertion") || "";
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }));
      });
    });
    srv.listen(GOOG_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ============================== fake Firestore ==================================
   Serves `:runQuery` (returns whatever fsState.rows currently holds), DELETE (records
   the deleted docId), and GET .../gffl_<fam>/settings (fix 2's rules-customized read —
   fsState.settingsStatus/settingsBody/settingsHang, default 404 = "no settings doc",
   which every PRE-EXISTING section below relies on reading as "defaults, so send").
   Configurable per test via resetFirestore(rows).                                    */
const fsState = { rows: [], deleted: [], queryCalls: 0, deleteCalls: 0,
  settingsStatus: 404, settingsBody: null, settingsRaw: null, settingsCalls: 0, settingsHang: false };
function resetFirestore(rows) {
  fsState.rows = rows; fsState.deleted = []; fsState.queryCalls = 0; fsState.deleteCalls = 0;
  fsState.settingsStatus = 404; fsState.settingsBody = null; fsState.settingsRaw = null;
  fsState.settingsCalls = 0; fsState.settingsHang = false;
}
// The Firestore REST shape leaguecron.mjs's waiverScheduleCustomized() decodes:
// fields.rules.mapValue.fields.waivers.mapValue.fields.{processDow,processHour}.integerValue —
// the same nesting lg-core.js's LG.loadRules()/rest.get() round-trips through production.
function settingsDoc(waivers) {
  const wf = {};
  if (waivers && waivers.processDow != null) wf.processDow = { integerValue: String(waivers.processDow) };
  if (waivers && waivers.processHour != null) wf.processHour = { integerValue: String(waivers.processHour) };
  return { fields: { kind: { stringValue: "settings" },
    rules: { mapValue: { fields: { waivers: { mapValue: { fields: wf } } } } } } };
}
function serveFirestore() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const urlPath = req.url.split("?")[0];
        if (req.method === "GET" && /\/gffl_[^/]+\/settings$/.test(urlPath)) {
          fsState.settingsCalls++;
          if (fsState.settingsHang) return; // never respond — simulates a hung upstream (section H)
          res.statusCode = fsState.settingsStatus;
          res.setHeader("content-type", "application/json");
          return res.end(fsState.settingsRaw != null ? fsState.settingsRaw : JSON.stringify(fsState.settingsBody || {}));
        }
        if (req.method === "POST" && urlPath.endsWith(":runQuery")) {
          fsState.queryCalls++;
          res.setHeader("content-type", "application/json");
          return res.end(JSON.stringify(fsState.rows));
        }
        if (req.method === "DELETE") {
          fsState.deleteCalls++;
          const docId = urlPath.split("/").pop();
          fsState.deleted.push(docId);
          res.setHeader("content-type", "application/json");
          return res.end("{}");
        }
        res.statusCode = 404;
        res.end("{}");
      });
    });
    srv.listen(FS_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ================================ fake FCM ========================================
   `behavior` maps token -> {status, body} or {hang:true} (never respond — section H's
   per-call timeout test). Default (unset) is a 200 success. Every call is logged
   verbatim on fcmState.calls (the full parsed request body) so a test can assert on
   exactly what was sent, per token.                                                  */
const fcmState = { calls: [], behavior: new Map() };
function resetFcm(behaviorEntries) {
  fcmState.calls = [];
  fcmState.behavior = new Map(behaviorEntries || []);
}
function serveFcm() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        let body = null; try { body = JSON.parse(raw); } catch {}
        const token = body && body.message && body.message.token;
        fcmState.calls.push(body);
        const behave = fcmState.behavior.get(token) || { status: 200, body: { name: "projects/x/messages/1" } };
        if (behave.hang) return; // never respond — the caller's own AbortSignal.timeout must fire
        res.statusCode = behave.status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(behave.body));
      });
    });
    srv.listen(FCM_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ============================ Firestore doc-row builder ============================ */
let seq = 0;
function tokenDoc({ token, user, gfflTeam, gfflMutes }) {
  const docId = "doc" + (++seq);
  const fields = { token: { stringValue: token } };
  if (user != null) fields.user = { stringValue: user };
  if (gfflTeam && gfflTeam.type === "int") fields.gfflTeam = { integerValue: String(gfflTeam.v) };
  else if (gfflTeam && gfflTeam.type === "double") fields.gfflTeam = { doubleValue: gfflTeam.v };
  if (gfflMutes && gfflMutes.length) {
    fields.gfflMutes = { arrayValue: { values: gfflMutes.map((k) => ({ stringValue: k })) } };
  }
  return {
    docId,
    row: {
      document: {
        name: `projects/amen-farms-app/databases/(default)/documents/pushTokens_${FAM}/${docId}`,
        fields,
      },
    },
  };
}

/* ================================= the module ===================================== */
let handler = null;
async function callAt(nowMs, { force } = {}) {
  process.env.LEAGUECRON_TEST_NOW_MS = String(nowMs);
  if (force) process.env.LEAGUECRON_FORCE = "1"; else delete process.env.LEAGUECRON_FORCE;
  const res = await handler();
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
}
function centralHH(ms) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", hour12: false }).format(new Date(ms));
}
function centralWeekday(ms) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(new Date(ms));
}

async function main() {
  process.env.LEAGUECRON_FAMILY_KEY = FAM;
  process.env.LEAGUECRON_FIRESTORE_BASE = `http://127.0.0.1:${FS_PORT}/v1/projects/amen-farms-app/databases/(default)/documents`;
  process.env.LEAGUECRON_TOKEN_URL = `http://127.0.0.1:${GOOG_PORT}/token`;
  process.env.LEAGUECRON_FCM_BASE = `http://127.0.0.1:${FCM_PORT}`;
  process.env.FIREBASE_SERVICE_ACCOUNT = SA_JSON;
  // fix 5's per-call AbortSignal.timeout. Read once at leaguecron.mjs's own import below (a
  // module-level const, same as every other *_TIMEOUT_MS in this repo), so it has to be set
  // BEFORE that import, not per-section. 300ms is generous against every fixture server's
  // real (localhost, in-process) latency — order of a millisecond — while still keeping
  // section H's deliberate hangs fast.
  process.env.LEAGUECRON_FETCH_TIMEOUT_MS = "300";

  const servers = await Promise.all([serveGoogle(), serveFirestore(), serveFcm()]);

  const mod = await import("file://" + path.join(ROOT, "netlify", "functions", "leaguecron.mjs").replace(/\\/g, "/"));
  handler = mod.default;
  ok(typeof handler === "function", "leaguecron.mjs exports a default handler function");

  /* ============================ 0. static: netlify.toml ============================ */
  section("0. netlify.toml declares the schedule (single source of truth)");
  const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
  ok(/\[functions\."leaguecron"\]/.test(toml), 'netlify.toml has a [functions."leaguecron"] block');
  ok(/schedule\s*=\s*"0 13,14 \* \* 3"/.test(toml),
    'the cron string is "0 13,14 * * 3" — both UTC DST candidates, Wednesdays only');
  ok(!/\[functions\."leaguecron"\][\s\S]{0,400}\[functions\."leaguecron"\]/.test(toml),
    "leaguecron is declared exactly once (no duplicate/conflicting block)");

  /* =============================== A. the guards ==================================== */
  section("A. Central-hour + weekday guard, and the season guard");

  // Two real dates 13 weeks apart (Sep 9 2026 is definitely CDT — well before the Nov-1
  // DST-end Sunday; Dec 9 2026 is definitely CST) so this genuinely exercises BOTH DST states
  // rather than asserting a hardcoded assumption about which offset applies when.
  const MS_WEEK = 7 * 24 * 3600 * 1000;
  const SEP9_1300 = Date.UTC(2026, 8, 9, 13, 0, 0); // the plan's own "first waiver Wed" instant
  const SEP9_1400 = Date.UTC(2026, 8, 9, 14, 0, 0);
  const DEC9_1300 = SEP9_1300 + 13 * MS_WEEK;
  const DEC9_1400 = SEP9_1400 + 13 * MS_WEEK;

  ok(centralHH(SEP9_1300) === "08", "sanity: Sep 9 UTC 13:00 really is 08:00 Central (CDT)");
  ok(centralHH(DEC9_1400) === "08", "sanity: Dec 9 UTC 14:00 really is 08:00 Central (CST)");
  ok(centralHH(SEP9_1300) !== centralHH(DEC9_1300),
    "the SAME UTC hour (13:00) lands on two different Central hours across the DST boundary — " +
    "this is exactly why the cron fires both 13 and 14");

  resetFirestore([]); resetFcm();
  const sepOn = await callAt(SEP9_1300);
  ok(sepOn.body.skipped === false, "summer (CDT): the Central-08:00 UTC candidate (13:00) runs");
  resetFirestore([]); resetFcm();
  const sepOff = await callAt(SEP9_1400);
  ok(sepOff.body.skipped === true && sepOff.body.reason === "not-a-scheduled-slot",
    "summer (CDT): the OTHER UTC candidate (14:00, real Central 09:00) is skipped");

  resetFirestore([]); resetFcm();
  const decOn = await callAt(DEC9_1400);
  ok(decOn.body.skipped === false, "winter (CST): the Central-08:00 UTC candidate (14:00) runs");
  resetFirestore([]); resetFcm();
  const decOff = await callAt(DEC9_1300);
  ok(decOff.body.skipped === true && decOff.body.reason === "not-a-scheduled-slot",
    "winter (CST): the OTHER UTC candidate (13:00, real Central 07:00) is skipped");

  // Defensive weekday guard: the exact on-hour instant, shifted one calendar day forward, must
  // no-op even though the Central clock reads 08:00 — a stray/manual invoke on a Thursday.
  const thursdaySameHour = SEP9_1300 + 24 * 3600 * 1000;
  ok(centralWeekday(thursdaySameHour) !== "Wed" && centralHH(thursdaySameHour) === "08",
    "sanity: the +1-day probe really is a non-Wednesday at Central 08:00");
  resetFirestore([]); resetFcm();
  const notWed = await callAt(thursdaySameHour);
  ok(notWed.body.skipped === true && notWed.body.reason === "not-a-scheduled-slot",
    "a non-Wednesday at the right Central hour is still skipped (defensive weekday check)");

  // Season guard, all three cases, on top of an otherwise-passing hour/weekday guard.
  resetFirestore([]); resetFcm();
  const atBoundary = await callAt(SEP9_1300); // exactly FIRST_WAIVER_WED_MS
  ok(atBoundary.body.skipped === false, "season guard: AT the first-waiver-Wednesday instant, the run proceeds");

  resetFirestore([]); resetFcm();
  const oneSecEarly = await callAt(SEP9_1300 - 1000);
  ok(oneSecEarly.body.skipped === true && oneSecEarly.body.reason === "before-first-waiver-week",
    "season guard: one second before the boundary, it no-ops with the season reason");

  resetFirestore([]); resetFcm();
  const weekEarly = await callAt(SEP9_1300 - MS_WEEK); // a Wednesday one week before season start
  ok(centralWeekday(SEP9_1300 - MS_WEEK) === "Wed", "sanity: the week-early probe really is a Wednesday");
  ok(weekEarly.body.skipped === true && weekEarly.body.reason === "before-first-waiver-week",
    "season guard: a full week before the season, still the season reason (hour/weekday guard alone isn't enough)");

  resetFirestore([]); resetFcm();
  const weekLater = await callAt(SEP9_1300 + MS_WEEK); // a Wednesday one week INTO the season
  ok(weekLater.body.skipped === false, "season guard: a week after the boundary, the run proceeds normally");

  // FORCE bypasses both guards outright — an arbitrary, deliberately-wrong instant.
  resetFirestore([]); resetFcm();
  const forced = await callAt(Date.UTC(2026, 0, 1, 12, 0, 0), { force: true });
  ok(forced.body.skipped === false, "LEAGUECRON_FORCE=1 bypasses both the hour/weekday guard and the season guard");
  delete process.env.LEAGUECRON_FORCE;

  /* ======================== B. missing service account ============================== */
  section("B. server misconfiguration");
  const savedSA = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  resetFirestore([]); resetFcm();
  const noSA = await callAt(SEP9_1300 + MS_WEEK);
  ok(noSA.status === 500, "no FIREBASE_SERVICE_ACCOUNT -> 500");
  ok(noSA.body.skipped === true && /FIREBASE_SERVICE_ACCOUNT/.test(noSA.body.reason || ""),
    "…and the reason names the missing env var, in the same {sent,skipped,reason} shape");
  process.env.FIREBASE_SERVICE_ACCOUNT = savedSA;

  /* =========================== C. a real in-season run =============================== */
  section("C. audience selection, dedupe, send bodies, failure isolation, pruning, summary shape");

  const dIsaac = tokenDoc({ token: "TOK_A", user: "Isaac", gfflTeam: { type: "int", v: 1 } });
  const dMomA  = tokenDoc({ token: "TOK_B", user: "Mom",   gfflTeam: { type: "double", v: 5 } });
  const dMomB  = tokenDoc({ token: "TOK_B", user: "Mom2",  gfflTeam: { type: "double", v: 5 } }); // same token, 2nd doc
  const dDad   = tokenDoc({ token: "TOK_C", user: "Dad" }); // no gfflTeam at all — family-only
  const dFail  = tokenDoc({ token: "TOK_FAIL",  gfflTeam: { type: "int", v: 9 } });
  const dUnreg = tokenDoc({ token: "TOK_UNREG", gfflTeam: { type: "int", v: 3 } });

  resetFirestore([dIsaac.row, dMomA.row, dMomB.row, dDad.row, dFail.row, dUnreg.row]);
  resetFcm([
    ["TOK_A", { status: 200, body: { name: "m1" } }],
    ["TOK_B", { status: 200, body: { name: "m2" } }],
    ["TOK_FAIL", { status: 500, body: { error: { status: "INTERNAL" } } }],
    ["TOK_UNREG", { status: 404, body: { error: { status: "UNREGISTERED" } } }],
  ]);

  const run = await callAt(SEP9_1300 + MS_WEEK); // a normal in-season Wednesday, on-hour
  ok(run.status === 200, "a full in-season run answers 200");

  ok(fsState.queryCalls === 1, "exactly one Firestore query per run (the collection is small — no pagination)");

  const calledTokens = fcmState.calls.map((c) => c.message.token).sort();
  ok(calledTokens.length === 4, `exactly 4 FCM sends were attempted (one per UNIQUE token) — got ${calledTokens.length}`);
  ok(new Set(calledTokens).size === 4, "…and all 4 are distinct tokens (no accidental double-send)");
  ok(!calledTokens.includes("TOK_C"),
    "the family-only device (no gfflTeam field at all) was NEVER sent a GFFL push");
  ok(calledTokens.includes("TOK_A") && calledTokens.includes("TOK_B"),
    "both an integerValue-typed and a doubleValue-typed gfflTeam device were selected (the type trap)");
  ok(calledTokens.filter((t) => t === "TOK_B").length === 1,
    "TOK_B — shared by two separate docs — was sent to exactly ONCE, not twice (token dedupe)");

  const bodyForA = fcmState.calls.find((c) => c.message.token === "TOK_A");
  ok(bodyForA.message.data.title === "GFFL waivers", "the send body's title is exact");
  ok(bodyForA.message.data.body === "Waiver claims have processed — open the app for your results.",
    "the send body's body text is exact");
  ok(bodyForA.message.data.url === "https://goatfantasyleague.com/league.html#moves",
    "the send body's deep link is exact — matches LG.pushLink('#moves') in lg-core.js");
  ok(bodyForA.message.webpush && bodyForA.message.webpush.headers && bodyForA.message.webpush.headers.Urgency === "high",
    "webpush urgency header is set, matching notify.mjs/chorereminders.mjs's convention");
  const bodyForB = fcmState.calls.find((c) => c.message.token === "TOK_B");
  ok(bodyForB.message.data.title === "GFFL waivers" && bodyForB.message.data.url === "https://goatfantasyleague.com/league.html#moves",
    "the second device's send body is identical in content (per-device, not per-doc)");

  ok(run.body.sent === 2, `sent counts only the genuinely successful sends (TOK_A + TOK_B) — got ${run.body.sent}`);
  ok(run.body.tokens === 4, `the summary's token count reflects the DEDUPED total (4), not the 6 raw docs — got ${run.body.tokens}`);
  ok(run.body.pruned === 1, `only the unregistered token's doc was pruned — got ${run.body.pruned}`);
  ok(fsState.deleted.length === 1 && fsState.deleted[0] === dUnreg.docId,
    "the DELETE that went out named exactly the unregistered doc's id, and no other");
  ok(!fsState.deleted.includes(dFail.docId),
    "TOK_FAIL's doc (a genuine 500, not an unregistered token) was left alone — never pruned on a guess");
  ok(!fsState.deleted.includes(dIsaac.docId) && !fsState.deleted.includes(dMomA.docId) && !fsState.deleted.includes(dMomB.docId),
    "no successfully-delivered device's doc was ever touched by a DELETE");

  ok(run.body.skipped === false && run.body.reason === null,
    "a successful run reports skipped:false and reason:null, per the required {sent,skipped,reason} summary shape");
  ok(typeof run.body.sent === "number" && typeof run.body.skipped === "boolean",
    "the summary's field TYPES are correct (sent: number, skipped: boolean) — auditable from the function log");

  /* ================ D. a single token shared by two docs, gone bad =================== */
  section("D. an unregistered SHARED token prunes every docId that had it");
  const dP = tokenDoc({ token: "TOK_DUPE", gfflTeam: { type: "int", v: 7 } });
  const dQ = tokenDoc({ token: "TOK_DUPE", gfflTeam: { type: "int", v: 7 } });
  resetFirestore([dP.row, dQ.row]);
  resetFcm([["TOK_DUPE", { status: 404, body: { error: { status: "UNREGISTERED" } } }]]);
  const dupRun = await callAt(SEP9_1300 + MS_WEEK);
  ok(fcmState.calls.length === 1, "the shared token was still only sent to ONCE, even though it belongs to two docs");
  ok(dupRun.body.pruned === 2, `both docIds sharing the dead token were pruned — got ${dupRun.body.pruned}`);
  ok(fsState.deleted.length === 2 && fsState.deleted.includes(dP.docId) && fsState.deleted.includes(dQ.docId),
    "the two DELETE calls named exactly dP's and dQ's docIds — no more, no fewer");
  ok(dupRun.body.sent === 0, "a token that turned out to be unregistered is never counted as sent");

  /* =========================== E. per-type mute (waivers) ============================ */
  section("E. a device that muted waivers is skipped; other mutes are not");
  const dOn = tokenDoc({ token: "TOK_ON", gfflTeam: { type: "int", v: 1 } });
  const dMuteW = tokenDoc({ token: "TOK_MUTE_W", gfflTeam: { type: "int", v: 2 }, gfflMutes: ["waivers"] });
  const dMuteC = tokenDoc({ token: "TOK_MUTE_C", gfflTeam: { type: "int", v: 3 }, gfflMutes: ["chat"] });
  resetFirestore([dOn.row, dMuteW.row, dMuteC.row]);
  resetFcm([
    ["TOK_ON", { status: 200, body: { name: "mOn" } }],
    ["TOK_MUTE_W", { status: 200, body: { name: "mW" } }],
    ["TOK_MUTE_C", { status: 200, body: { name: "mC" } }],
  ]);
  const muteRun = await callAt(SEP9_1300 + MS_WEEK);
  const muteTokens = fcmState.calls.map((c) => c.message.token).sort();
  ok(muteRun.status === 200, "a mute-filtered run still answers 200");
  ok(!muteTokens.includes("TOK_MUTE_W"),
    "the device that muted waivers is not sent the Wednesday waiver nudge");
  ok(muteTokens.includes("TOK_ON") && muteTokens.includes("TOK_MUTE_C"),
    "an unmuted device and a device that muted a DIFFERENT kind still get the nudge");
  ok(muteRun.body.sent === 2, `sent is the two unmuted devices — got ${muteRun.body.sent}`);

  /* =========================== F. season-end guard ==================================== */
  section("F. season-end guard — the waiver nudge stops once the season is over");
  // Hand-computed the SAME way leaguecron.mjs's own LAST_WAIVER_WED_MS comment states it:
  // SEASON_START 2026-09-08 (Tue) + a 14-week regular season + 3 playoff weeks (15, 16, 17,
  // per lg-core.js's bracket — "Three playoff weeks, seasonWeeks+1..+3") -> week 17 (the
  // championship week) is the LAST week whose rosters still score anything. Week 17's own
  // Tuesday = SEASON_START + 16*7 = +112 days = 2026-12-29; +1 day = its waiver Wednesday,
  // 2026-12-30 08:00 Central. Late December is past the 2026-11-01 DST fall-back, so Central
  // is CST (UTC-6): 2026-12-30T08:00-06:00 = 2026-12-30T14:00Z.
  const LAST_WED_1400 = Date.UTC(2026, 11, 30, 14, 0, 0);
  ok(centralHH(LAST_WED_1400) === "08" && centralWeekday(LAST_WED_1400) === "Wed",
    "sanity: the hand-computed last-waiver Wednesday really is Central 08:00 on a Wednesday");

  resetFirestore([]); resetFcm();
  const lastValid = await callAt(LAST_WED_1400);
  ok(lastValid.body.skipped === false,
    "season-end guard: AT week 17's own waiver Wednesday (the championship week), the run still proceeds");

  resetFirestore([]); resetFcm();
  const nextWed = await callAt(LAST_WED_1400 + MS_WEEK); // 2027-01-06 — nothing left to process
  ok(centralWeekday(LAST_WED_1400 + MS_WEEK) === "Wed", "sanity: the +1-week probe is a Wednesday");
  ok(nextWed.body.skipped === true && nextWed.body.reason === "after-last-waiver-week",
    "season-end guard: the very next Wednesday (2027-01-06, nothing left to process) no-ops with the season-end reason");

  // The reviewer's own two probes that confirmed the bug (LEAGUECRON_TEST_NOW_MS at each date).
  resetFirestore([]); resetFcm();
  const jan13_1400 = Date.UTC(2027, 0, 13, 14, 0, 0);
  ok(centralWeekday(jan13_1400) === "Wed" && centralHH(jan13_1400) === "08", "sanity: 2027-01-13 08:00 Central is a Wednesday");
  const jan13 = await callAt(jan13_1400);
  ok(jan13.body.skipped === true && jan13.body.reason === "after-last-waiver-week",
    "2027-01-13 (a Wednesday well into the offseason) sends nothing — the exact bug the reviewer found");

  resetFirestore([]); resetFcm();
  const mar3_1400 = Date.UTC(2027, 2, 3, 14, 0, 0);
  ok(centralWeekday(mar3_1400) === "Wed" && centralHH(mar3_1400) === "08", "sanity: 2027-03-03 08:00 Central is a Wednesday");
  const mar3 = await callAt(mar3_1400);
  ok(mar3.body.skipped === true && mar3.body.reason === "after-last-waiver-week",
    "2027-03-03 (the reviewer's other probe, months into next preseason) sends nothing");

  resetFirestore([]); resetFcm();
  const forcedAfterEnd = await callAt(Date.UTC(2027, 5, 1, 12, 0, 0), { force: true });
  ok(forcedAfterEnd.body.skipped === false,
    "LEAGUECRON_FORCE=1 bypasses the season-end guard too, same as the start guard and the weekday/hour guard");
  delete process.env.LEAGUECRON_FORCE;

  /* ========== G. a customized waiver schedule skips the nudge — never lie about the deadline ========== */
  section("G. rules.waivers.processDow/processHour off Wed/8 skips the nudge; a rules-read FAILURE keeps sending");
  const dRules = tokenDoc({ token: "TOK_RULES", gfflTeam: { type: "int", v: 1 } });

  // G1: no settings doc on file at all (404 — resetFirestore's own default) -> defaults (Wed/8)
  // are assumed, so the nudge sends. This is also what every section A-F above already relied
  // on without knowing it: the fake Firestore server 404s any unhandled GET.
  resetFirestore([dRules.row]); resetFcm([["TOK_RULES", { status: 200, body: { name: "m" } }]]);
  const noDoc = await callAt(SEP9_1300 + MS_WEEK);
  ok(noDoc.body.skipped === false && fsState.settingsCalls === 1,
    `G1: no settings doc (404) -> defaults assumed, the nudge sends (settingsCalls=${fsState.settingsCalls})`);

  // G2: a settings doc that explicitly keeps Wed/8 -> still sends.
  resetFirestore([dRules.row]); resetFcm([["TOK_RULES", { status: 200, body: { name: "m" } }]]);
  fsState.settingsStatus = 200; fsState.settingsBody = settingsDoc({ processDow: 3, processHour: 8 });
  const defaultDoc = await callAt(SEP9_1300 + MS_WEEK);
  ok(defaultDoc.body.skipped === false, "G2: a settings doc that explicitly names Wed/8 (the default) still sends");

  // G3: the family moved claims to Thursday — the Wednesday nudge must SKIP, not lie.
  resetFirestore([dRules.row]); resetFcm([["TOK_RULES", { status: 200, body: { name: "m" } }]]);
  fsState.settingsStatus = 200; fsState.settingsBody = settingsDoc({ processDow: 4, processHour: 8 }); // Thu
  const movedDow = await callAt(SEP9_1300 + MS_WEEK);
  ok(movedDow.body.skipped === true && movedDow.body.reason === "waiver-schedule-customized",
    `G3: rules.waivers.processDow=4 (Thursday) -> the Wednesday nudge skips (${JSON.stringify(movedDow.body)})`);
  ok(fcmState.calls.length === 0, "…and genuinely never sent a single FCM message for that run");

  // G4: still Wednesday, but the hour moved (6 PM, not 8 AM) -> skip too.
  resetFirestore([dRules.row]); resetFcm([["TOK_RULES", { status: 200, body: { name: "m" } }]]);
  fsState.settingsStatus = 200; fsState.settingsBody = settingsDoc({ processDow: 3, processHour: 18 });
  const movedHour = await callAt(SEP9_1300 + MS_WEEK);
  ok(movedHour.body.skipped === true && movedHour.body.reason === "waiver-schedule-customized",
    "G4: rules.waivers.processHour=18 (still Wed, 6 PM not 8 AM) -> the 8 AM nudge skips too");

  // G5: the rules READ itself fails (a genuine 500) -> keep today's behaviour: send, never a
  // false skip caused by an unrelated Firestore hiccup.
  resetFirestore([dRules.row]); resetFcm([["TOK_RULES", { status: 200, body: { name: "m" } }]]);
  fsState.settingsStatus = 500; fsState.settingsBody = { error: { status: "INTERNAL" } };
  const readFail500 = await callAt(SEP9_1300 + MS_WEEK);
  ok(readFail500.body.skipped === false,
    "G5: the rules doc read itself fails (500) -> falls back to the old always-send behaviour");

  // G6: the read succeeds (200) but the body is not valid JSON -> same fallback (send).
  resetFirestore([dRules.row]); resetFcm([["TOK_RULES", { status: 200, body: { name: "m" } }]]);
  fsState.settingsStatus = 200; fsState.settingsRaw = "not json{{{";
  const readFailBadJson = await callAt(SEP9_1300 + MS_WEEK);
  ok(readFailBadJson.body.skipped === false,
    "G6: the rules doc read answers 200 with unparseable JSON -> the same fallback, sends");

  // G7: a settings doc exists but carries no rules.waivers shape at all (predates the waivers
  // section, or a stray write) -> nothing on record says the family customized anything, so
  // defaults are assumed and the nudge sends — NOT a read failure, but the same outcome.
  resetFirestore([dRules.row]); resetFcm([["TOK_RULES", { status: 200, body: { name: "m" } }]]);
  fsState.settingsStatus = 200; fsState.settingsBody = { fields: { kind: { stringValue: "settings" } } };
  const noWaiversField = await callAt(SEP9_1300 + MS_WEEK);
  ok(noWaiversField.body.skipped === false, "G7: a settings doc with no rules.waivers field at all -> defaults assumed, sends");

  // G8: FORCE bypasses the rules-customized guard too.
  resetFirestore([dRules.row]); resetFcm([["TOK_RULES", { status: 200, body: { name: "m" } }]]);
  fsState.settingsStatus = 200; fsState.settingsBody = settingsDoc({ processDow: 4, processHour: 8 });
  const forcedOverCustom = await callAt(Date.UTC(2026, 0, 1, 12, 0, 0), { force: true });
  ok(forcedOverCustom.body.skipped === false, "G8: LEAGUECRON_FORCE=1 bypasses the rules-customized guard too");
  delete process.env.LEAGUECRON_FORCE;
  fsState.settingsStatus = 404; fsState.settingsBody = null; fsState.settingsRaw = null;

  /* ================ H. a hung upstream call is bounded, never the whole run =================== */
  section("H. AbortSignal.timeout per upstream call — one hang is isolated, never the whole run");
  // LEAGUECRON_FETCH_TIMEOUT_MS was set to 300ms before leaguecron.mjs's own import above (a
  // module-level const, so it can't be changed per-section) — generous against every fixture
  // server's real (localhost) latency, short enough to keep these two deliberate hangs fast.

  // H1: the settings-doc read hangs -> the read-failure rule (G5/G6) applies: fall back to
  // "send", and the WHOLE RUN still finishes promptly rather than hanging until the platform
  // kills the function having sent nobody.
  const dH1 = tokenDoc({ token: "TOK_H1", gfflTeam: { type: "int", v: 1 } });
  resetFirestore([dH1.row]); resetFcm([["TOK_H1", { status: 200, body: { name: "m" } }]]);
  fsState.settingsHang = true;
  const h1Start = Date.now();
  const h1 = await callAt(SEP9_1300 + MS_WEEK);
  const h1Elapsed = Date.now() - h1Start;
  ok(h1.body.skipped === false, "H1: a hung settings-doc read still falls back to 'send' (never a false skip)");
  ok(h1Elapsed < 2000, `…and the run finished in ${h1Elapsed}ms — bounded by the 300ms timeout, not an indefinite hang`);
  fsState.settingsHang = false;

  // H2: ONE device's FCM send hangs; the others must still be reached and sent — the exact "one
  // hung call burns the whole platform time budget and drops the rest" bug fix 5 removes.
  const dOK1 = tokenDoc({ token: "TOK_H_OK1", gfflTeam: { type: "int", v: 1 } });
  const dHang = tokenDoc({ token: "TOK_H_HANG", gfflTeam: { type: "int", v: 2 } });
  const dOK2 = tokenDoc({ token: "TOK_H_OK2", gfflTeam: { type: "int", v: 3 } });
  resetFirestore([dOK1.row, dHang.row, dOK2.row]);
  resetFcm([
    ["TOK_H_OK1", { status: 200, body: { name: "m1" } }],
    ["TOK_H_HANG", { hang: true }],
    ["TOK_H_OK2", { status: 200, body: { name: "m2" } }],
  ]);
  const h2Start = Date.now();
  const h2 = await callAt(SEP9_1300 + MS_WEEK);
  const h2Elapsed = Date.now() - h2Start;
  ok(h2.body.sent === 2, `H2: the two HEALTHY devices were still sent — got ${h2.body.sent}`);
  const h2Tokens = fcmState.calls.map((c) => c.message.token).sort();
  ok(h2Tokens.includes("TOK_H_OK1") && h2Tokens.includes("TOK_H_HANG") && h2Tokens.includes("TOK_H_OK2"),
    "…all three were genuinely attempted — the hang did not stop the loop from reaching the others");
  ok(h2Elapsed < 3000, `…the whole run finished in ${h2Elapsed}ms — one hung send did not burn the platform's time budget`);

  /* ================================== teardown ======================================= */
  for (const s of servers) s.close();

  console.log(`\nleaguecron: ${pass}/${pass + fail} passed`);
  if (fail) {
    console.log("\nFailures:");
    for (const f of failures) console.log("  - " + f);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
