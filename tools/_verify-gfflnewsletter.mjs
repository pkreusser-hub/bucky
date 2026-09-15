#!/usr/bin/env node
/**
 * GFFL weekly recap newsletter suite (in-process, zero real network).
 *
 *   node tools/_verify-gfflnewsletter.mjs
 *
 * netlify/functions/gfflnewsletter.mjs is a Netlify SCHEDULED function. This suite
 * dynamic-imports it against fake local HTTP servers for Google OAuth, Firestore REST,
 * and EmailJS /send — the same house pattern as tools/_verify-leaguecron.mjs.
 *
 * Arithmetic in the facts/standings checks is hand-computed from the fixture below,
 * not read back from the function agreeing with itself.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FN = path.join(ROOT, "netlify", "functions", "gfflnewsletter.mjs");
const TOML = path.join(ROOT, "netlify.toml");

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; failures.push(name); console.log("  FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");

const GOOG_PORT = 8951, FS_PORT = 8952, MAIL_PORT = 8953;
const FAM = "famtestnl";

/* ---------- 0. files that HEAD does not have (the bite) ---------- */
section("0. the function and its schedule exist");
ok(fs.existsSync(FN), "netlify/functions/gfflnewsletter.mjs exists");
const toml = fs.existsSync(TOML) ? fs.readFileSync(TOML, "utf8") : "";
ok(/\[functions\."gfflnewsletter"\]/.test(toml), 'netlify.toml has a [functions."gfflnewsletter"] block');
ok(/schedule\s*=\s*"0 13,14 \* \* 2,3,4"/.test(toml),
  'the cron string is "0 13,14 * * 2,3,4" — both UTC DST candidates, Tue/Wed/Thu');
// RESTAGED: a negative lookahead on "two blocks" passed vacuously when HEAD
// had zero blocks. Count the headings instead — missing is not "exactly once".
ok((toml.split('[functions."gfflnewsletter"]').length - 1) === 1,
  "gfflnewsletter is declared exactly once");
ok(/no emoji/i.test(fs.existsSync(FN) ? fs.readFileSync(FN, "utf8") : ""),
  "the function's voice rules ban emoji (chrome / system prose)");

if (!fs.existsSync(FN)) {
  console.log("\ngfflnewsletter: " + pass + "/" + (pass + fail) + " passed — function missing, remaining checks not imported");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}

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
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }));
      });
    });
    srv.listen(GOOG_PORT, "127.0.0.1", () => resolve(srv));
  });
}

const fsState = { docs: {}, commits: [], queryCalls: 0 };
function resetFirestore(docs) {
  fsState.docs = docs || {};
  fsState.commits = [];
  fsState.queryCalls = 0;
}
function serveFirestore(encodeFields) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const urlPath = req.url.split("?")[0];
        res.setHeader("content-type", "application/json");
        if (req.method === "POST" && urlPath.endsWith(":runQuery")) {
          fsState.queryCalls++;
          let collectionId = "";
          try { collectionId = JSON.parse(raw).structuredQuery.from[0].collectionId; } catch { collectionId = ""; }
          const rows = [];
          for (const [key, obj] of Object.entries(fsState.docs)) {
            const col = key.split("/")[0];
            const id = key.split("/").slice(1).join("/");
            if (col !== collectionId) continue;
            rows.push({
              document: {
                name: "projects/p/databases/(default)/documents/" + collectionId + "/" + id,
                fields: encodeFields(obj),
              },
            });
          }
          return res.end(JSON.stringify(rows.length ? rows : [{}]));
        }
        if (req.method === "POST" && urlPath.endsWith(":commit")) {
          let body = {};
          try { body = JSON.parse(raw); } catch { body = {}; }
          fsState.commits.push(body);
          return res.end("{}");
        }
        res.statusCode = 404;
        res.end("{}");
      });
    });
    srv.listen(FS_PORT, "127.0.0.1", () => resolve(srv));
  });
}

const mailState = { calls: [] };
function resetMail() { mailState.calls = []; }
function serveMail() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        let body = {};
        try { body = JSON.parse(raw); } catch { body = { raw }; }
        mailState.calls.push(body);
        const to = body.template_params && body.template_params.to_email;
        if (to === "fail@example.com") {
          res.statusCode = 400;
          return res.end("bad dest");
        }
        res.statusCode = 200;
        res.end("OK");
      });
    });
    srv.listen(MAIL_PORT, "127.0.0.1", () => resolve(srv));
  });
}

const TEAMS = [
  { kind: "team", teamId: 1, name: "Battle Kreussers", abbrev: "BK", owner: "Perry", claimedBy: "Dad" },
  { kind: "team", teamId: 2, name: "End Zone Goats", abbrev: "EZG", owner: "", claimedBy: "" },
  { kind: "team", teamId: 3, name: "Wyoming Cowboys", abbrev: "WYO", owner: "", claimedBy: "grandpa" },
  { kind: "team", teamId: 4, name: "Chula Vista Jaguarrams", abbrev: "CVJ", owner: "", claimedBy: "" },
  { kind: "team", teamId: 5, name: "Nails For Breakfast", abbrev: "NAIL", owner: "", claimedBy: "Mom" },
  { kind: "team", teamId: 9, name: "Scruffy Looking Nerfherders", abbrev: "SLN", owner: "Sam", claimedBy: "" },
  { kind: "team", teamId: 11, name: "Elanikan Skywalkers", abbrev: "ES", owner: "", claimedBy: "" },
  { kind: "team", teamId: 12, name: "The Goat Kids", abbrev: "GOAT", owner: "", claimedBy: "Isaac" },
];

// Hand-computed week-1 card. Totals and standings are derived here, in the suite,
// so a broken accumulator cannot hide behind agreeing with itself.
const W1_MATCHUPS = [
  { home: 1, away: 2, homePts: 112.4, awayPts: 88.1 },   // BK by 24.3
  { home: 3, away: 5, homePts: 101.2, awayPts: 99.8 },   // Wyoming by 1.4  CLOSEST
  { home: 4, away: 12, homePts: 70.0, awayPts: 130.0 },  // Goat Kids by 60.0  BLOWOUT
  { home: 9, away: 11, homePts: 95.0, awayPts: 95.0 },   // tie
];
const W1 = {
  kind: "weekly", week: 1,
  matchups: W1_MATCHUPS,
  awards: {
    topScore: { teamId: 12, pts: 130 },
    bust: { name: "F. Flexman", shortfall: 10 },
    benchBlunder: { teamId: 1, diff: 53 },
  },
  power: [{ teamId: 12, score: 10, rank: 1 }],
  finalizedAt: 1,
};
const W1_VOID = {
  kind: "weekly", week: 1,
  matchups: [
    { home: 1, away: 2, homePts: 0, awayPts: 0 },
    { home: 3, away: 5, homePts: 0, awayPts: 0 },
  ],
  power: [{ teamId: 1, score: 0 }],
  finalizedAt: 1,
};

const PROFILES = [
  { frequency: "profile", name: "Dad", email: "dad@example.com" },
  { frequency: "profile", name: "Isaac", email: "isaac@example.com" },
  { frequency: "profile", name: "Mom", email: "mom@example.com" },
  { frequency: "profile", name: "grandpa", email: "g@example.com" },
  { frequency: "profile", name: "Sam", email: "sam@example.com" },
  { frequency: "profile", name: "Eleanor", email: "e@example.com" },
  { frequency: "daily", name: "Isaac", email: "chore-not-a-profile@example.com" },
];

function seedWorld(extra) {
  const docs = {};
  for (const t of TEAMS) docs["gffl_" + FAM + "/team_" + t.teamId] = t;
  docs["gffl_" + FAM + "/weekly_2026_w1"] = W1;
  PROFILES.forEach((p, i) => { docs["chores_" + FAM + "/p" + i] = p; });
  Object.assign(docs, extra || {});
  resetFirestore(docs);
  resetMail();
}

async function main() {
  process.env.FIREBASE_SERVICE_ACCOUNT = SA_JSON;
  process.env.GFFLNL_FAMILY_KEY = FAM;
  process.env.GFFLNL_TOKEN_URL = "http://127.0.0.1:" + GOOG_PORT + "/token";
  process.env.GFFLNL_FIRESTORE_BASE = "http://127.0.0.1:" + FS_PORT + "/v1/projects/amen-farms-app/databases/(default)/documents";
  process.env.GFFLNL_EMAILJS_URL = "http://127.0.0.1:" + MAIL_PORT + "/send";
  process.env.GFFLNL_SKIP_MODEL = "1";
  process.env.GFFLNL_NO_THROTTLE = "1";
  delete process.env.GFFLNL_FORCE;
  delete process.env.GFFLNL_FORCE_MODEL_TEXT;
  delete process.env.XAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GFFL_NEWSLETTER_TO;

  const mod = await import("file://" + FN.replace(/\\/g, "/") + "?t=" + Date.now());
  const handler = mod.default;
  ok(typeof handler === "function", "gfflnewsletter.mjs exports a default handler function");
  ok(typeof mod.writeFallbackColumn === "function", "exports writeFallbackColumn for the suite");
  ok(typeof mod.pickRecipients === "function", "exports pickRecipients");
  ok(typeof mod.buildFacts === "function", "exports buildFacts");

  const servers = await Promise.all([serveGoogle(), serveFirestore(mod.encodeFields), serveMail()]);

  const callAt = async (ms, opts) => {
    process.env.GFFLNL_TEST_NOW_MS = String(ms);
    if (opts && opts.force) process.env.GFFLNL_FORCE = "1";
    else delete process.env.GFFLNL_FORCE;
    const res = await handler();
    const text = await res.text();
    let body = {};
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: res.status, body };
  };

  /* ---------- A. void / standings / facts (hand-computed) ---------- */
  section("A. weeklyIsVoid, standings, facts — arithmetic from the fixture");
  ok(mod.weeklyIsVoid(W1_VOID) === true, "all-zero matchups + zero power is void (the zombie shape)");
  ok(mod.weeklyIsVoid(W1) === false, "a real scored week is not void");
  ok(mod.weeklyIsVoid({ kind: "weekly", matchups: [] }) === true, "a weekly with no matchups is void");

  const facts = mod.buildFacts(W1, TEAMS, [W1]);
  ok(facts.week === 1, "facts.week is 1");
  ok(facts.games.length === 4, "four pairings");
  ok(facts.closest && facts.closest.margin === 1.4 && facts.closest.winner === "Wyoming Cowboys",
    "closest is Wyoming 101.2–99.8 Nails (margin 1.4, hand-computed)");
  ok(facts.blowout && facts.blowout.margin === 60 && facts.blowout.winner === "The Goat Kids",
    "blowout is Goat Kids 130.0–70.0 Jaguarrams (margin 60, hand-computed)");
  const tie = facts.games.find((g) => g.home === 9);
  ok(tie && tie.tie === true && tie.homePts === 95 && tie.awayPts === 95,
    "Nerfherders / Skywalkers is a 95.0–95.0 tie");

  // Standings after week 1, sorted w, then t, then pf, then teamId:
  // 12 The Goat Kids     1-0   pf 130.0
  //  1 Battle Kreussers  1-0   pf 112.4
  //  3 Wyoming Cowboys   1-0   pf 101.2
  //  9 Nerfherders       0-0-1 pf  95.0
  // 11 Skywalkers        0-0-1 pf  95.0
  //  5 Nails             0-1   pf  99.8
  //  2 End Zone Goats    0-1   pf  88.1
  //  4 Jaguarrams        0-1   pf  70.0
  const st = facts.standings;
  ok(st.length === 8, "standings has all 8 teams");
  ok(st[0].teamId === 12 && st[0].w === 1 && st[0].pf === 130 && st[0].place === 1,
    "1st: Goat Kids 1-0, pf 130.0 (130 > 112.4 > 101.2)");
  ok(st[1].teamId === 1 && st[1].pf === 112.4 && st[1].place === 2,
    "2nd: Battle Kreussers 1-0, pf 112.4");
  ok(st[2].teamId === 3 && st[2].pf === 101.2 && st[2].place === 3,
    "3rd: Wyoming 1-0, pf 101.2");
  ok(st[3].teamId === 9 && st[3].t === 1 && st[3].w === 0, "4th: Nerfherders 0-0-1 (ties rank above losses)");
  ok(st[5].teamId === 5 && st[5].l === 1 && st[5].pf === 99.8, "6th: Nails 0-1, pf 99.8 (best of the losers)");
  ok(st[7].teamId === 4 && st[7].pf === 70 && st[7].place === 8, "8th: Jaguarrams 0-1, pf 70.0");
  const bk = st.find((r) => r.teamId === 1);
  ok(bk.pa === 88.1, "Battle Kreussers PA is EZG's 88.1 (hand-computed)");

  /* ---------- B. voice: fallback is grounded and unslopped ---------- */
  section("B. fallback column is grounded, unslopped, and not a throat-clearer");
  const col = mod.writeFallbackColumn(facts);
  const full = col.headline + "\n\n" + col.body;
  const slop = mod.slopLint(full);
  ok(slop.ok, "fallback passes slopLint (" + slop.reasons.join(",") + ")");
  const grounded = mod.columnUsesFacts(full, facts);
  ok(grounded.ok, "fallback names every team and every score (" + grounded.missing.join(",") + ")");
  ok(/holds off/i.test(col.headline) && /Wyoming/.test(col.headline),
    "closest finish (1.4) leads the headline — not a blowout, not a generic 'week in review'");
  ok(!/in the books/i.test(full) && !/what a week/i.test(full) && !/recap/i.test(col.headline),
    "headline does not announce that it is a recap");
  ok(!/[\u{1F300}-\u{1FAFF}]/u.test(full), "fallback has no emoji");
  ok((full.split("—").length - 1) <= 2, "fallback uses at most two em dashes");
  ok(full.includes("F. Flexman") && full.includes("10.0"),
    "bust award is in the column with the hand-computed 10.0 shortfall");
  ok(full.includes("53.0") && full.includes("Battle Kreussers"),
    "bench blunder 53.0 is in the column");
  ok(full.includes("130.0") && /leads/.test(full),
    "standings closer names the leader and uses the 130.0 high");

  ok(mod.slopLint("What a week it was in the books").ok === false,
    "slopLint rejects 'what a week' / 'in the books'");
  ok(mod.slopLint("The Goat Kids delve into the tapestry").ok === false,
    "slopLint rejects delve / tapestry");
  ok(mod.COLUMN_SYSTEM.includes("Roast teams, never people"),
    "the model prompt, if used, still roasts teams not people");
  ok(mod.COLUMN_SYSTEM.includes("Never open by announcing"),
    "the model prompt forbids throat-clearing openers");

  /* ---------- C. recipients ---------- */
  section("C. recipients: owners and the documented choreUser map, not the whole family");
  const recips = mod.pickRecipients(PROFILES, TEAMS, "");
  const emails = recips.map((r) => r.email).sort();
  ok(emails.includes("dad@example.com"), "Dad matches claimedBy on team 1");
  ok(emails.includes("isaac@example.com"), "Isaac matches claimedBy on team 12");
  ok(emails.includes("mom@example.com"), "Mom matches claimedBy on team 5");
  ok(emails.includes("g@example.com"), "grandpa matches claimedBy on team 3");
  ok(emails.includes("sam@example.com"), "Sam matches owner on team 9");
  ok(!emails.includes("e@example.com"), "Eleanor has an email but no team — not mailed");
  ok(!emails.includes("chore-not-a-profile@example.com"), "a daily chore row is not a profile");
  ok(recips.length === 5, "exactly the five league-linked profiles (got " + recips.length + ")");

  const extras = mod.pickRecipients(PROFILES, TEAMS, "plus@example.com, dad@example.com");
  ok(extras.some((r) => r.email === "plus@example.com"), "GFFL_NEWSLETTER_TO adds an extra address");
  ok(extras.filter((r) => r.email.toLowerCase() === "dad@example.com").length === 1,
    "Dad is not duplicated when also listed in GFFL_NEWSLETTER_TO");

  const aliasOnly = mod.pickRecipients(
    [{ frequency: "profile", name: "Dad", email: "dad@example.com" }],
    [{ kind: "team", teamId: 1, name: "Battle Kreussers", owner: "", claimedBy: "" }],
    ""
  );
  ok(aliasOnly.length === 1 && aliasOnly[0].email === "dad@example.com",
    "Dad still mails when owner/claimedBy are empty — documented default map dad→1");

  /* ---------- D. schedule guard (DST + weekday) ---------- */
  section("D. Central-hour + weekday guard");
  // Tue Sep 15 2026 13:00 UTC = 08:00 CDT. Wed Sep 16 13:00 UTC = 08:00 CDT.
  // Dec 16 2026 14:00 UTC = 08:00 CST (Wed).
  const TUE_SEP15_1300 = Date.UTC(2026, 8, 15, 13, 0, 0);
  const TUE_SEP15_1400 = Date.UTC(2026, 8, 15, 14, 0, 0);
  const WED_SEP16_1300 = Date.UTC(2026, 8, 16, 13, 0, 0);
  const THU_SEP17_1300 = Date.UTC(2026, 8, 17, 13, 0, 0);
  const FRI_SEP18_1300 = Date.UTC(2026, 8, 18, 13, 0, 0);
  const DEC16_1400 = Date.UTC(2026, 11, 16, 14, 0, 0); // Wed
  const DEC16_1300 = Date.UTC(2026, 11, 16, 13, 0, 0);

  seedWorld();
  const tueOn = await callAt(TUE_SEP15_1300);
  ok(tueOn.body.skipped === false && tueOn.body.sent === 5,
    "summer Tue 08:00 Central (UTC 13:00) sends — week 1 is finalized (sent=" + tueOn.body.sent + ")");
  seedWorld();
  const tueOff = await callAt(TUE_SEP15_1400);
  ok(tueOff.body.skipped === true && tueOff.body.reason === "not-a-scheduled-slot",
    "summer Tue UTC 14:00 (Central 09:00) is skipped");
  seedWorld();
  const wedOn = await callAt(WED_SEP16_1300);
  ok(wedOn.body.skipped === false, "Wednesday 08:00 Central is a scheduled slot (backup after MNF)");
  seedWorld();
  const thuOn = await callAt(THU_SEP17_1300);
  ok(thuOn.body.skipped === false, "Thursday 08:00 Central is a scheduled slot (last backup)");
  seedWorld();
  const fri = await callAt(FRI_SEP18_1300);
  ok(fri.body.skipped === true && fri.body.reason === "not-a-scheduled-slot",
    "Friday at the right Central hour is still skipped");
  seedWorld();
  const decOn = await callAt(DEC16_1400);
  ok(decOn.body.skipped === false, "winter (CST): UTC 14:00 is the 08:00 Central candidate");
  seedWorld();
  const decOff = await callAt(DEC16_1300);
  ok(decOff.body.skipped === true && decOff.body.reason === "not-a-scheduled-slot",
    "winter (CST): UTC 13:00 (Central 07:00) is skipped");
  seedWorld();
  const forced = await callAt(Date.UTC(2026, 0, 1, 12, 0, 0), { force: true });
  ok(forced.body.skipped === false, "GFFLNL_FORCE=1 bypasses the hour/weekday guard");
  delete process.env.GFFLNL_FORCE;

  /* ---------- E. skip reasons ---------- */
  section("E. honest skip reasons");
  resetFirestore({});
  resetMail();
  const none = await callAt(TUE_SEP15_1300);
  ok(none.body.skipped === true && none.body.reason === "no-finalized-week",
    "no weekly docs → no-finalized-week");

  resetFirestore({
    ["gffl_" + FAM + "/weekly_2026_w1"]: W1_VOID,
    ["gffl_" + FAM + "/team_1"]: TEAMS[0],
  });
  resetMail();
  const voided = await callAt(TUE_SEP15_1300);
  ok(voided.body.skipped === true && voided.body.reason === "no-finalized-week",
    "a zombie 0-0 weekly is treated as absent");

  seedWorld({ ["gffl_nl_" + FAM + "/2026_w1"]: { kind: "newsletter", week: 1, season: 2026 } });
  const already = await callAt(TUE_SEP15_1300);
  ok(already.body.skipped === true && already.body.reason === "all-sent",
    "a recorded send for week 1 → all-sent when nothing else is pending");

  const w2 = {
    kind: "weekly", week: 2,
    matchups: [{ home: 1, away: 3, homePts: 90.0, awayPts: 80.0 }],
    power: [{ teamId: 1, score: 4 }],
    awards: {},
  };
  seedWorld({
    ["gffl_" + FAM + "/weekly_2026_w2"]: w2,
    ["gffl_nl_" + FAM + "/2026_w1"]: { kind: "newsletter", week: 1, season: 2026 },
  });
  const next = await callAt(TUE_SEP15_1300);
  ok(next.body.skipped === false && next.body.week === 2,
    "oldest unsent finalized week wins — week 2 after week 1 was mailed (week=" + next.body.week + ")");

  const noMailTeams = TEAMS.map((t) => ({ ...t, owner: "", claimedBy: "" }));
  const docsNoMail = {};
  for (const t of noMailTeams) docsNoMail["gffl_" + FAM + "/team_" + t.teamId] = t;
  docsNoMail["gffl_" + FAM + "/weekly_2026_w1"] = W1;
  docsNoMail["chores_" + FAM + "/p0"] = { frequency: "profile", name: "Eleanor", email: "e@example.com" };
  resetFirestore(docsNoMail);
  resetMail();
  const nobody = await callAt(TUE_SEP15_1300);
  ok(nobody.body.skipped === true && nobody.body.reason === "no-recipients",
    "profiles that do not match a team are not invented recipients");

  /* ---------- F. a real send: EmailJS shape + idempotency write ---------- */
  section("F. EmailJS payload, deep link, one mail per owner, sent-doc write");
  seedWorld();
  const run = await callAt(TUE_SEP15_1300);
  ok(run.status === 200 && run.body.sent === 5, "five successful EmailJS sends (got " + run.body.sent + ")");
  ok(run.body.source === "fallback", "without a model key the fallback column is what mailed");
  ok(mailState.calls.length === 5, "EmailJS was hit once per recipient");
  const tos = mailState.calls.map((c) => c.template_params.to_email).sort();
  ok(tos.join(",") === "dad@example.com,g@example.com,isaac@example.com,mom@example.com,sam@example.com",
    "the five league addresses, nobody else (" + tos.join(",") + ")");
  const one = mailState.calls[0];
  ok(one.service_id === "service_tcdlpci" && one.template_id === "template_rdk52zn",
    "same EmailJS service/template the family app already uses");
  ok(one.user_id === "yiqS6j2SLp5sf9BLB", "same EmailJS public key as index.html");
  ok(one.template_params.from_name === "GFFL Desk", "from_name is GFFL Desk");
  ok(/^GFFL Week 1:/.test(one.template_params.subject), "subject is GFFL Week 1: <headline>");
  ok(!/[\u{1F300}-\u{1FAFF}]/u.test(one.template_params.subject), "subject has no emoji");
  ok(one.template_params.details_block.includes("Wyoming Cowboys"),
    "the HTML body names Wyoming (the closest game)");
  ok(one.template_params.details_block.includes("101.2") && one.template_params.details_block.includes("99.8"),
    "the HTML body carries the hand-computed closest score");
  ok(one.template_params.cta_block.includes("https://goatfantasyleague.com/league.html"),
    "CTA is the league origin, not the family app");
  ok(one.template_params.cta_block.includes("Open the league"), "CTA label is text, no emoji");
  ok(fsState.commits.length === 1, "one create-only newsletter write after a successful send");
  const wroteName = JSON.stringify(fsState.commits[0]);
  ok(wroteName.includes("gffl_nl_" + FAM + "/2026_w1"), "the sent doc is gffl_nl_<fam>/2026_w1");
  ok(wroteName.includes("exists") && wroteName.includes("false"),
    "the write is create-only (currentDocument.exists=false)");

  /* ---------- G. model hop discarded when sloppy; kept when grounded ---------- */
  section("G. a sloppy model hop is discarded; a grounded one is kept");
  process.env.GFFLNL_SKIP_MODEL = "0";
  process.env.GFFLNL_FORCE_MODEL_TEXT = "What a week it was\n\nIn the books, the tapestry of scores was thrilling.";
  seedWorld();
  const sloppy = await callAt(TUE_SEP15_1300);
  ok(sloppy.body.source === "fallback", "slopLint failure falls back to the deterministic column");

  const goodModel = [
    "Wyoming Cowboys holds off Nails For Breakfast by 1.4",
    "",
    "Wyoming Cowboys 101.2, Nails For Breakfast 99.8. A kick's worth.",
    "",
    "Battle Kreussers 112.4, End Zone Goats 88.1.",
    "",
    "The Goat Kids 130.0, Chula Vista Jaguarrams 70.0. One side was playing a different sport.",
    "",
    "Scruffy Looking Nerfherders 95.0, Elanikan Skywalkers 95.0. The week called it a draw.",
    "",
    "The Goat Kids leads at 1-0 with 130.0 on the board.",
  ].join("\n");
  process.env.GFFLNL_FORCE_MODEL_TEXT = goodModel;
  seedWorld();
  const kept = await callAt(TUE_SEP15_1300);
  ok(kept.body.source === "model", "a grounded, unslopped model column is what mailed");
  ok(mailState.calls[0].template_params.subject.includes("Wyoming Cowboys holds off"),
    "the mailed subject carries the model headline");
  delete process.env.GFFLNL_FORCE_MODEL_TEXT;
  process.env.GFFLNL_SKIP_MODEL = "1";

  /* ---------- H. misconfig ---------- */
  section("H. missing service account");
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  seedWorld();
  const noSA = await callAt(TUE_SEP15_1300);
  ok(noSA.status === 500 && /FIREBASE_SERVICE_ACCOUNT/.test(noSA.body.reason || ""),
    "no FIREBASE_SERVICE_ACCOUNT → 500 naming the env var");
  process.env.FIREBASE_SERVICE_ACCOUNT = saved;

  /* ---------- I. email HTML escapes ---------- */
  section("I. HTML escape on a team name with markup");
  const evil = TEAMS.map((t) => t.teamId === 3 ? { ...t, name: "Wyoming <script>Cowboys" } : t);
  const evilFacts = mod.buildFacts(W1, evil, [W1]);
  const html = mod.toEmailHtml(mod.writeFallbackColumn(evilFacts), evilFacts);
  ok(html.includes("&lt;script&gt;"), "team names are escaped in the HTML body");
  ok(!html.includes("<script>Cowboys"), "raw <script> never reaches the EmailJS triple-brace slot");

  for (const s of servers) s.close();

  console.log("\ngfflnewsletter: " + pass + "/" + (pass + fail) + " passed");
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
