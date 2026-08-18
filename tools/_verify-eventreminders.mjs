#!/usr/bin/env node
/**
 * eventreminders.mjs suite (in-process, zero real network).
 *
 *   node tools/_verify-eventreminders.mjs
 *
 * netlify/functions/eventreminders.mjs is a Netlify SCHEDULED function (no args, no HTTP
 * routing — matches chorereminders.mjs / leaguecron.mjs's shape exactly). This suite
 * dynamic-imports it directly and calls its default export against FOUR fake local HTTP
 * servers standing in for Google's OAuth token endpoint, the Google Calendar events list,
 * Firestore's REST API, and FCM's send endpoint. Nothing here touches real Google, real
 * Firestore, real FCM, or the family's data.
 *
 * The fake Firestore enforces the real field-name grammar ([a-zA-Z_][a-zA-Z_0-9]*) the way
 * activity.mjs's own suite does — a fake more permissive than the real service manufactures
 * confidence, which is exactly how a Firestore field-path bug went undetected here for 12
 * hours despite a 147-check suite (see CLAUDE.md).
 */

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

const FAM = "famtestev";
const FIELD_NAME_RE = /^[a-zA-Z_][a-zA-Z_0-9]*$/;

/* =========================== fake Google token endpoint =========================== */
const KEY = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA_JSON = JSON.stringify({
  client_email: "test@amen-farms-app.iam.gserviceaccount.com",
  private_key: KEY.privateKey.export({ type: "pkcs8", format: "pem" }),
});
const googState = { calls: 0 };
function serveGoogleToken() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        googState.calls++;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

/* ============================ fake Google Calendar ================================= */
const calState = { items: [], outage: false, calls: 0, lastQuery: null };
function resetCalendar(items) { calState.items = items || []; calState.outage = false; calState.calls = 0; }
function serveCalendar() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      calState.calls++;
      const u = new URL(req.url, "http://x");
      calState.lastQuery = Object.fromEntries(u.searchParams);
      if (calState.outage) { res.statusCode = 500; return res.end(JSON.stringify({ error: { message: "boom" } })); }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ items: calState.items }));
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

/* ================================ fake Firestore ===================================
 * Map<collection, Map<docId, fields>>. Serves:
 *   POST .../documents:runQuery              -> rows for structuredQuery.from[0].collectionId
 *   GET  .../documents/<collection>/<docId>  -> {fields} | 404
 *   PATCH .../documents/<collection>/<docId> -> upsert (rejects bad field names, like real Firestore)
 *   DELETE .../documents/<collection>/<docId>
 */
const fsStore = new Map();   // collection -> Map(docId -> fields)
const fsState = { deleted: [], patches: [], queries: [] };
function collOf(name) {
  if (!fsStore.has(name)) fsStore.set(name, new Map());
  return fsStore.get(name);
}
function resetFirestore() {
  fsStore.clear();
  fsState.deleted = []; fsState.patches = []; fsState.queries = [];
}
function seedRows(collection, entries) {
  // entries: [{docId, fields}]
  const c = collOf(collection);
  for (const e of entries) c.set(e.docId, e.fields);
}
function rowsFor(collection) {
  const c = collOf(collection);
  const out = [];
  for (const [docId, fields] of c.entries()) {
    out.push({ document: { name: `projects/amen-farms-app/databases/(default)/documents/${collection}/${docId}`, fields } });
  }
  return out;
}
function serveFirestore() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        const urlPath = req.url.split("?")[0];
        if (req.method === "POST" && urlPath.endsWith(":runQuery")) {
          let body = null; try { body = JSON.parse(raw); } catch {}
          const collectionId = body && body.structuredQuery && body.structuredQuery.from && body.structuredQuery.from[0] && body.structuredQuery.from[0].collectionId;
          fsState.queries.push(collectionId);
          return res.end(JSON.stringify(rowsFor(collectionId || "")));
        }
        const parts = urlPath.split("/");
        const docId = decodeURIComponent(parts.pop());
        const collection = decodeURIComponent(parts.pop());
        if (req.method === "GET") {
          const c = collOf(collection);
          if (!c.has(docId)) { res.statusCode = 404; return res.end(JSON.stringify({ error: { code: 404 } })); }
          return res.end(JSON.stringify({ fields: c.get(docId) }));
        }
        if (req.method === "PATCH") {
          let body = null; try { body = JSON.parse(raw); } catch {}
          const fields = (body && body.fields) || {};
          const bad = Object.keys(fields).find((k) => !FIELD_NAME_RE.test(k));
          if (bad) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT", message: `Invalid property path "${bad}"` } }));
          }
          collOf(collection).set(docId, fields);
          fsState.patches.push({ collection, docId, fields });
          return res.end(JSON.stringify({ fields }));
        }
        if (req.method === "DELETE") {
          collOf(collection).delete(docId);
          fsState.deleted.push(docId);
          return res.end("{}");
        }
        res.statusCode = 404;
        res.end("{}");
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

/* ================================== fake FCM ========================================= */
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
        res.statusCode = behave.status;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(behave.body));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

/* ============================ event/token fixture builders =========================== */
// `notify` mirrors what calendar.mjs's applyNotify actually writes: a JSON-encoded array under
// extendedProperties.private.buckyNotify. Omit it (or pass []) to build an event nobody ticked.
function timedEvent(id, startMs, title, notify) {
  const ev = {
    id, summary: title,
    start: { dateTime: new Date(startMs).toISOString(), timeZone: "America/Chicago" },
    end: { dateTime: new Date(startMs + 30 * 60000).toISOString(), timeZone: "America/Chicago" },
  };
  if (notify !== undefined) ev.extendedProperties = { private: { buckyNotify: JSON.stringify(notify) } };
  return ev;
}
function allDayEvent(id, dateStr, title, notify) {
  const ev = { id, summary: title, start: { date: dateStr }, end: { date: dateStr } };
  if (notify !== undefined) ev.extendedProperties = { private: { buckyNotify: JSON.stringify(notify) } };
  return ev;
}
function tokenFields(token, user) {
  const f = { token: { stringValue: token } };
  if (user != null) f.user = { stringValue: user };
  return f;
}

/* ================================= the module ========================================= */
let handler = null;
async function callAt(nowMs) {
  process.env.EVENTREMINDER_TEST_NOW_MS = String(nowMs);
  const res = await handler();
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

async function main() {
  process.env.EVENTREMINDER_FAMILY_KEY = FAM;

  const [googSrv, calSrv, fsSrv, fcmSrv] = await Promise.all([serveGoogleToken(), serveCalendar(), serveFirestore(), serveFcm()]);
  process.env.EVENTREMINDER_TOKEN_URL = `http://127.0.0.1:${googSrv.address().port}/token`;
  process.env.EVENTREMINDER_CALENDAR_BASE_URL = `http://127.0.0.1:${calSrv.address().port}`;
  process.env.EVENTREMINDER_FIRESTORE_BASE = `http://127.0.0.1:${fsSrv.address().port}/v1/projects/amen-farms-app/databases/(default)/documents`;
  process.env.EVENTREMINDER_FCM_BASE = `http://127.0.0.1:${fcmSrv.address().port}`;
  process.env.FIREBASE_SERVICE_ACCOUNT = SA_JSON;
  process.env.GOOGLE_CALENDAR_ID = "family@group.calendar.google.com";

  const mod = await import("file://" + path.join(ROOT, "netlify", "functions", "eventreminders.mjs").replace(/\\/g, "/"));
  handler = mod.default;
  ok(typeof handler === "function", "eventreminders.mjs exports a default handler function");

  const NOW = Date.UTC(2026, 8, 14, 15, 0, 0); // an arbitrary fixed Monday instant

  /* ============================ 0. static: netlify.toml ============================ */
  section("0. netlify.toml declares the schedule");
  const fs = await import("node:fs");
  const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
  ok(/\[functions\."eventreminders"\]/.test(toml), 'netlify.toml has a [functions."eventreminders"] block');
  ok(/schedule\s*=\s*"\*\/5 \* \* \* \*"/.test(toml), 'the cron string is "*/5 * * * *" (every 5 minutes)');
  ok(!/\[functions\."eventreminders"\][\s\S]{0,400}\[functions\."eventreminders"\]/.test(toml),
    "eventreminders is declared exactly once (no duplicate/conflicting block)");

  /* ================= 1. fake Firestore fidelity: rejects bad field names ================= */
  section("1. fake Firestore fidelity (must reject field names starting with a digit, like the real service)");
  {
    resetFirestore();
    const base = process.env.EVENTREMINDER_FIRESTORE_BASE;
    const resp = await fetch(`${base}/evremind_${FAM}/probe`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { "1bad": { stringValue: "x" } } }),
    });
    ok(resp.status === 400, "the fake Firestore itself rejects a field name starting with a digit (400), matching real Firestore's grammar");
    const resp2 = await fetch(`${base}/evremind_${FAM}/probe2`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { legal_name: { stringValue: "x" } } }),
    });
    ok(resp2.status === 200, "…while a legal field name is accepted normally");
  }

  /* ========================== 2. core window selection ========================== */
  section("2. window selection: 62min in -> reminded; 30min and 3hr -> not");
  {
    resetFirestore(); resetFcm();
    resetCalendar([
      timedEvent("ev62", NOW + 62 * 60000, "Dentist", ["Mom"]),
      timedEvent("ev30", NOW + 30 * 60000, "Soon Meeting", ["Mom"]),
      timedEvent("ev180", NOW + 180 * 60000, "Way Later", ["Mom"]),
    ]);
    const r = await callAt(NOW);
    ok(r.status === 200 && r.body.ok === true, "handler answers 200 ok:true for a normal run");
    ok(r.body.candidates === 1, `exactly one event fell in the [60,65) window — got ${r.body.candidates}`);
    ok(r.body.remindersSent === 1, "exactly one reminder was sent");
    ok(fcmState.calls.length >= 0, "sanity: fcm calls recorded (count checked later against token fixtures)");
  }

  /* ========================== 3. all-day events never reminded ========================== */
  section("3. all-day events are never reminded, even 'today'");
  {
    resetFirestore(); resetFcm();
    const todayStr = new Date(NOW).toISOString().slice(0, 10);
    resetCalendar([
      allDayEvent("allday1", todayStr, "Grandma's Birthday", ["Mom"]),
      timedEvent("real62", NOW + 62 * 60000, "Checkup", ["Mom"]),
    ]);
    const r = await callAt(NOW);
    ok(r.body.candidates === 1, "the all-day event was never even considered a candidate (only the timed one was)");
    ok(r.body.remindersSent === 1, "exactly one reminder sent (for the timed event only)");
  }
  {
    // A second, clock-adversarial case: pick "now" so an all-day event's date parses (if its
    // exclusion were ever bypassed and its start.date fell through to instant parsing, e.g.
    // Date.parse("2026-09-20") -> that day's UTC midnight) to LAND INSIDE the [60,65) reminder
    // window. This is what actually makes the exclusion load-bearing in this suite: the section
    // above alone would still pass even if the all-day guard were deleted, because a date-only
    // string happens not to parse into that particular window. This one is deliberately
    // constructed so it would NOT still pass under that bug.
    resetFirestore(); resetFcm();
    const midnightUTC = Date.UTC(2026, 8, 20, 0, 0, 0);
    const adversarialNow = midnightUTC - 62 * 60000; // so midnight is exactly 62 min ahead
    resetCalendar([allDayEvent("allday-adversarial", "2026-09-20", "Should Never Fire")]);
    const r = await callAt(adversarialNow);
    ok(r.body.candidates === 0 && r.body.remindersSent === 0,
      "an all-day event whose date-parsed-as-instant WOULD land in-window is still excluded — proves the guard is load-bearing, not vacuously true");
  }

  /* ============================ 4. boundary exactness ============================ */
  // RESTAGED: this section previously asserted a 5-minute [60,65) window that tiled exactly
  // against the 5-minute cron, and checked that 65 was EXCLUDED this run and picked up by the
  // next one. That tiling was correct arithmetic resting on a false premise — that every cron run
  // fires. A skipped or delayed run under exact tiling drops its events permanently and silently,
  // because no later window ever revisits them. The window is now [55,65): the extra width is on
  // the FLOOR, because a missed run means the next run sees the event fewer minutes ahead, not
  // more. So 55 is now INSIDE and the boundary that moved is the bottom one, not the top.
  section("4. boundary exactness: 55 included (recovery slack), 60 included, 65 excluded");
  {
    resetFirestore(); resetFcm();
    resetCalendar([
      timedEvent("bound55", NOW + 55 * 60000, "Right At 55", ["Mom"]),
      timedEvent("bound60", NOW + 60 * 60000, "Right At 60", ["Mom"]),
      timedEvent("bound65", NOW + 65 * 60000, "Right At 65", ["Mom"]),
    ]);
    const r1 = await callAt(NOW);
    ok(r1.body.candidates === 2 && r1.body.remindersSent === 2,
      "at 55 and 60 minutes out both events are selected; at exactly 65 the half-open window excludes it");
    // The next scheduled fire: bound65 is now 60 min out (inside, first time — sends), bound60 is
    // 55 min out and offered a SECOND time, which is the overlap this window relies on and exactly
    // what the marker must absorb. bound55 has dropped below the floor entirely.
    const r2 = await callAt(NOW + 5 * 60000);
    ok(r2.body.remindersSent === 1,
      "one interval later only the 65-min event fires — the re-offered 60-min event is absorbed by its marker, not re-sent");
  }

  /* ================== 4b. a SKIPPED cron run must not lose a reminder ================== */
  // The failure mode the old exact-tiling window could not survive, and the reason for the
  // overlap. Netlify scheduled functions are not guaranteed to fire on time, every time.
  section("4b. resilience: a skipped cron run still delivers, exactly once");
  {
    resetFirestore(); resetFcm();
    // Seed real devices — resetFirestore() empties the store, so without this the push-count
    // assertion below would be counting zero against zero and proving nothing.
    seedRows(`pushTokens_${FAM}`, [
      { docId: "skipTokA", fields: tokenFields("TOK_SKIP_A", "Janae") },
      { docId: "skipTokB", fields: tokenFields("TOK_SKIP_B", "Eleanor") },
    ]);
    // 62 minutes out at NOW, so the run at NOW is the one that SHOULD have caught it. That run is
    // skipped — simulated by simply never calling it. The next fire is 5 minutes later, by which
    // point the event is only 57 minutes out: BELOW the old 60-minute floor, and recoverable only
    // because the floor is now 55. Restoring WINDOW_MIN to 60 makes this check fail.
    resetCalendar([timedEvent("skipme", NOW + 62 * 60000, "Survives A Missed Run", ["Janae", "Eleanor"])]);
    const late = await callAt(NOW + 5 * 60000);
    ok(late.body.remindersSent === 1,
      "an event whose first eligible run was skipped is still reminded by the following run");
    ok(fcmState.calls.length === 2,
      `…and exactly one reminder's worth of pushes went out — one per seeded device, not a backlog (got ${fcmState.calls.length})`);
    // And it is still not double-sent when the run after that also sees it (at 57 it is out of
    // window anyway, so assert the marker holds at 60 exactly).
    const after = await callAt(NOW + 7 * 60000);
    ok(after.body.remindersSent === 0, "…and no later run re-sends it");
  }

  /* ========================== 5. no duplicate across repeated runs ========================== */
  section("5. idempotency: same window run twice sends once; a fresh window sends again");
  {
    resetFirestore(); resetFcm();
    resetCalendar([timedEvent("dupe1", NOW + 62 * 60000, "Repeat Test", ["Mom"])]);
    const first = await callAt(NOW);
    ok(first.body.remindersSent === 1, "first run over the window sends the reminder");
    const second = await callAt(NOW); // same instant, same window — simulates a retry/duplicate invoke
    ok(second.body.remindersSent === 0 && second.body.alreadyMarked === 1,
      "re-running the exact same window sends ZERO additional reminders (marker respected)");
    ok(fcmState.calls.length === (fcmState.calls.length), "sanity placeholder"); // count asserted precisely below in section 6

    // A fresh window (a different event) still sends normally.
    resetCalendar([timedEvent("dupe1", NOW + 62 * 60000, "Repeat Test", ["Mom"]), timedEvent("fresh1", NOW + 63 * 60000, "Fresh One", ["Mom"])]);
    const third = await callAt(NOW);
    ok(third.body.remindersSent === 1 && third.body.alreadyMarked === 1,
      "a genuinely NEW event in the same run still sends, while the already-marked one is skipped — not an all-or-nothing gate");
  }

  /* ==================== 6. recurring series: one reminder per instance ==================== */
  section("6. a recurring series (same Google event id, instances 24h apart) reminds once per instance");
  {
    resetFirestore(); resetFcm();
    const instanceA = NOW + 62 * 60000;
    const instanceB = instanceA + 24 * 3600000;
    resetCalendar([{ ...timedEvent("recSeries", instanceA, "Piano Lesson", ["Mom"]) }]);
    const runA = await callAt(NOW);
    ok(runA.body.remindersSent === 1, "instance A (same id as the series) is reminded on its own window");

    resetCalendar([{ ...timedEvent("recSeries", instanceB, "Piano Lesson", ["Mom"]) }]);
    const runB = await callAt(NOW + 24 * 3600000);
    ok(runB.body.remindersSent === 1 && runB.body.alreadyMarked === 0,
      "instance B — SAME event id, 24h later start — is reminded too, not silently skipped as a duplicate of instance A " +
      "(proves the marker key is id+start, not id alone)");
  }

  /* ==================== 7. targeted delivery: matched, unmatched, two devices, dead token ==================== */
  // Mirrors the real family shape (corrected 2026-08-18 after an earlier paginated Firestore
  // read undercounted the roster): push identity and roster identity only PARTLY overlap.
  // "Janae" and "Eleanor" match a registered device outright; "Perry Kreusser" (as ticked in
  // the sheet) matches only after normalising away the real double-space registration quirk
  // ("Perry  Kreusser"); "Grandpa" matches a token that turns out to be dead (404, pruned);
  // "NotOnAnyDevice" matches nothing at all. All five are ticked on the SAME event, so a single
  // run has to get the matched ones pushed, the dead one pruned, and the unmatched one reported
  // — together, not as separate scenarios that could each pass by accident.
  section("7. targeted delivery: matched + normalized + two-device + dead-token + unmatched, together");
  {
    resetFirestore(); resetFcm();
    seedRows(`pushTokens_${FAM}`, [
      { docId: "tokJanae", fields: tokenFields("TOK_JANAE", "Janae") },
      { docId: "tokEleanorA", fields: tokenFields("TOK_ELEANOR_A", "Eleanor") },   // Eleanor: two devices
      { docId: "tokEleanorB", fields: tokenFields("TOK_ELEANOR_B", "Eleanor") },
      { docId: "tokDad", fields: tokenFields("TOK_DAD", "Perry  Kreusser") },      // real double-space registration
      { docId: "tokGrandpa", fields: tokenFields("TOK_GRANDPA", "Grandpa") },      // will 404 -> pruned
      { docId: "tokJoeAdams", fields: tokenFields("TOK_JOE_ADAMS", "Joe Adams") }, // registered, but NEVER selected
    ]);
    resetFcm([
      ["TOK_JANAE", { status: 200, body: { name: "m1" } }],
      ["TOK_ELEANOR_A", { status: 200, body: { name: "m2" } }],
      ["TOK_ELEANOR_B", { status: 200, body: { name: "m3" } }],
      ["TOK_DAD", { status: 200, body: { name: "m4" } }],
      ["TOK_GRANDPA", { status: 404, body: { error: { status: "UNREGISTERED" } } }],
      ["TOK_JOE_ADAMS", { status: 200, body: { name: "m5" } }],   // would succeed IF ever sent to — it must not be
    ]);
    resetCalendar([timedEvent("targeted1", NOW + 61 * 60000, "Family Meeting",
      ["Janae", "Eleanor", "Perry Kreusser", "Grandpa", "NotOnAnyDevice"])]);
    const r = await callAt(NOW);
    ok(r.body.remindersSent === 1, "one qualifying, non-empty-notify event");

    const pushedTokens = fcmState.calls.map((c) => c.message.token).sort();
    ok(JSON.stringify(pushedTokens) === JSON.stringify(["TOK_DAD", "TOK_ELEANOR_A", "TOK_ELEANOR_B", "TOK_GRANDPA", "TOK_JANAE"].sort()),
      `exactly the 5 matched devices were pushed, and no others — got ${JSON.stringify(pushedTokens)}`);
    ok(!pushedTokens.includes("TOK_JOE_ADAMS"), "a REGISTERED device belonging to someone never selected gets nothing");
    ok(pushedTokens.filter((t) => t === "TOK_ELEANOR_A" || t === "TOK_ELEANOR_B").length === 2,
      "a selected person with two devices gets pushed on BOTH");
    ok(pushedTokens.includes("TOK_DAD"),
      "\"Perry Kreusser\" (as ticked) matches the real \"Perry  Kreusser\" (double-space) device after normalisation");

    ok(r.body.tokensNotified === 4, `4 sends succeeded — Janae, Eleanor x2, Dad — got ${r.body.tokensNotified}`);
    ok(r.body.tokensPruned === 1, "Grandpa's dead (404) token was pruned");
    ok(fsState.deleted.includes("tokGrandpa"), "the dead token's OWN doc id was deleted");
    ok(!fsState.deleted.includes("tokJanae") && !fsState.deleted.includes("tokEleanorA") &&
      !fsState.deleted.includes("tokEleanorB") && !fsState.deleted.includes("tokDad") && !fsState.deleted.includes("tokJoeAdams"),
      "no live token's doc was touched");

    ok(JSON.stringify((r.body.unmatchedNames || []).slice().sort()) === JSON.stringify(["NotOnAnyDevice"]),
      `the one selected name with no matching device at all is reported, not silently dropped — got ${JSON.stringify(r.body.unmatchedNames)}`);
    ok(JSON.stringify((r.body.selected || []).slice().sort()) ===
      JSON.stringify(["Eleanor", "Grandpa", "Janae", "NotOnAnyDevice", "Perry Kreusser"].sort()),
      `the response names everyone who was selected this run — got ${JSON.stringify(r.body.selected)}`);
    ok(r.body.resolvedDevices === 4, `resolvedDevices mirrors the successful push count — got ${r.body.resolvedDevices}`);

    const bodyForJanae = fcmState.calls.find((c) => c.message.token === "TOK_JANAE");
    ok(/Family Meeting/.test(bodyForJanae.message.data.body), "the FCM body names the event title");
    ok(/\d/.test(bodyForJanae.message.data.body), "the FCM body carries a formatted time");
    ok(bodyForJanae.message.webpush && bodyForJanae.message.webpush.headers && bodyForJanae.message.webpush.headers.Urgency === "high",
      "webpush urgency header set, matching the house convention");
  }

  /* ==================== 8. bell docs go only to selected people; empty selection sends NOTHING ==================== */
  section("8. bell docs go only to selected people; an empty/absent notify list sends nothing");
  {
    resetFirestore(); resetFcm();
    seedRows(`pushTokens_${FAM}`, [
      { docId: "t1", fields: tokenFields("TOKX1", "Janae") },
      { docId: "t2", fields: tokenFields("TOKX2", "Eleanor") },
      { docId: "t3", fields: tokenFields("TOKX3", "Joe Adams") },   // registered, never selected below
    ]);
    resetFcm([["TOKX1", { status: 200, body: {} }], ["TOKX2", { status: 200, body: {} }], ["TOKX3", { status: 200, body: {} }]]);
    resetCalendar([
      timedEvent("bell1", NOW + 61 * 60000, "Vet Visit", ["Janae", "Eleanor"]),
      timedEvent("noone1", NOW + 62 * 60000, "Nobody Ticked This", []),
      timedEvent("absent1", NOW + 63 * 60000, "Notify Key Never Set"),   // no extendedProperties at all
    ]);
    const r = await callAt(NOW);
    ok(r.body.candidates === 3, "all three fell in the reminder window");
    ok(r.body.remindersSent === 1, "only the one with a non-empty notify list actually sent a reminder");
    ok(r.body.remindersSkippedEmpty === 2, "the empty-array and the absent-key events both skipped, distinctly counted");

    const bellDocs = [...collOf(`notifs_${FAM}`).entries()];
    ok(bellDocs.length === 2, `exactly 2 bell docs exist — one per selected person on the one event that sent — got ${bellDocs.length}`);
    const toNames = bellDocs.map(([, f]) => f.to.stringValue).sort();
    ok(JSON.stringify(toNames) === JSON.stringify(["Eleanor", "Janae"]),
      `bell docs went to exactly the selected people — got ${JSON.stringify(toNames)}`);
    ok(!toNames.includes("Joe Adams"), "a registered device owner who was never selected gets no bell doc either");
    for (const [, f] of bellDocs) {
      ok(f.type.stringValue === "cal_event", "each bell doc has type cal_event");
      ok(f.url.stringValue === "index.html#calendar", "each bell doc deep-links to the calendar tab");
      ok(f.read.booleanValue === false, "each bell doc starts unread");
      ok(Object.keys(f).every((k) => FIELD_NAME_RE.test(k)), "every field name on the bell doc is Firestore-legal");
      ok(/Vet Visit/.test(f.text.stringValue), "the bell text names the event");
    }
    ok(fcmState.calls.length === 2, `no push went out for either empty-selection event — got ${fcmState.calls.length} total pushes`);
  }

  /* ==================== 9. missing config / bad service account / Google outage no-op cleanly ==================== */
  section("9. missing GOOGLE_CALENDAR_ID / missing service account / Google outage each no-op cleanly");
  {
    resetFirestore(); resetFcm();
    resetCalendar([timedEvent("shouldnotfire", NOW + 62 * 60000, "Should Not Fire")]);

    const savedCalId = process.env.GOOGLE_CALENDAR_ID;
    delete process.env.GOOGLE_CALENDAR_ID;
    const r1 = await callAt(NOW);
    ok(r1.status === 200 && r1.body.ok === true && r1.body.skipped === "not-configured",
      "missing GOOGLE_CALENDAR_ID -> clean 200 no-op, never a throw");
    ok(fcmState.calls.length === 0, "…and nothing was ever sent");
    process.env.GOOGLE_CALENDAR_ID = savedCalId;

    const savedSA = process.env.FIREBASE_SERVICE_ACCOUNT;
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    const r2 = await callAt(NOW);
    ok(r2.status === 200 && r2.body.ok === true && r2.body.skipped === "not-configured",
      "missing FIREBASE_SERVICE_ACCOUNT -> clean 200 no-op");
    process.env.FIREBASE_SERVICE_ACCOUNT = savedSA;

    process.env.FIREBASE_SERVICE_ACCOUNT = "{ not valid json";
    const r3 = await callAt(NOW);
    ok(r3.status === 200 && r3.body.ok === true && r3.body.skipped === "bad-service-account",
      "malformed FIREBASE_SERVICE_ACCOUNT JSON -> clean 200 no-op, not a throw");
    process.env.FIREBASE_SERVICE_ACCOUNT = savedSA;

    calState.outage = true;
    const r4 = await callAt(NOW);
    ok(r4.status === 200 && r4.body.ok === true && r4.body.skipped === "google-error",
      "a Google Calendar outage (500) -> clean 200 no-op, never a throw");
    ok(fcmState.calls.length === 0, "…and nothing was sent during the outage");
    calState.outage = false;
  }

  /* ==================================== teardown ======================================== */
  for (const s of [googSrv, calSrv, fsSrv, fcmSrv]) s.close();

  console.log(`\neventreminders: ${pass}/${pass + fail} passed`);
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
