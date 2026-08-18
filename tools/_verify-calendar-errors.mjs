#!/usr/bin/env node
/**
 * BUCKY calendar — the DIAGNOSIS path.
 *
 *   node tools/_verify-calendar-errors.mjs
 *
 * Runs the REAL netlify/functions/calendar.mjs in process against a FAKE Google (both the
 * token endpoint and the Calendar REST API, via the function's own CAL_GOOGLE_TOKEN_URL /
 * CALENDAR_BASE_URL overrides) and a throwaway RSA service account. Nothing here touches
 * the family's real calendar or the real Google API.
 *
 * WHY THIS SUITE EXISTS: a family report of "the calendar can't be reached when I edit an
 * event" was untraceable. Every non-auth Google refusal AND every thrown exception inside
 * the function collapsed to the same opaque `{error:"google-error"}`, logged nowhere. These
 * checks pin the behaviour that makes such a report answerable next time: Google's own
 * reason is passed through and logged, an exception is named as OURS rather than Google's,
 * and a 404 on an EVENT is not reported as the whole calendar being unshared.
 */
import crypto from "node:crypto";
import http from "node:http";

let pass = 0;
const fails = [];
const ok = (c, m) => (c ? (pass++, console.log("  ✓ " + m)) : (fails.push(m), console.log("  ✗ " + m)));

/* ---- a throwaway service account (never a real key) ------------------------ */
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = {
  client_email: "fake-sa@amen-farms-app.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
};
const SECRET = "test-secret";

/* ---- fake Google ----------------------------------------------------------- */
let googleReply = null;   // { status, body } for the next Calendar API call
let lastPath = "";
let lastBody = null;      // parsed JSON body of the last non-token request calendar.mjs SENT to Google
const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    if (req.url.startsWith("/token")){
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }));
    }
    lastPath = req.url;
    try { lastBody = body ? JSON.parse(body) : null; } catch { lastBody = null; }
    const r = googleReply || { status: 200, body: { id: "evt_1", summary: "ok",
      start: { dateTime: "2026-08-12T09:00:00-05:00" }, end: { dateTime: "2026-08-12T10:00:00-05:00" } } };
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(JSON.stringify(r.body));
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

process.env.BUCKY_NOTIFY_SECRET = SECRET;
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(SA);
process.env.GOOGLE_CALENDAR_ID = "family@group.calendar.google.com";
process.env.CAL_GOOGLE_TOKEN_URL = `http://127.0.0.1:${port}/token`;
process.env.CALENDAR_BASE_URL = `http://127.0.0.1:${port}/cal`;

const { default: handler } = await import("../netlify/functions/calendar.mjs");

const call = async (payload) => {
  const req = new Request("https://amenfarms.netlify.app/.netlify/functions/calendar", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://amenfarms.netlify.app" },
    body: JSON.stringify({ secret: SECRET, ...payload }),
  });
  const resp = await handler(req);
  return { status: resp.status, json: await resp.json().catch(() => ({})) };
};

/* ---- capture what the function logs (that IS the deliverable) -------------- */
const logs = [];
const realErr = console.error;
console.error = (...a) => logs.push(a.map(String).join(" "));
const sinceLast = () => logs.slice(-1)[0] || "";

const GOOGLE_400 = { status: 400, body: { error: { code: 400, message: "Invalid recurrence rule.",
  errors: [{ reason: "invalid", message: "Invalid recurrence rule." }] } } };

console.log("\nA. A Google refusal keeps its reason");
googleReply = GOOGLE_400;
let r = await call({ action: "update", event: { id: "evt_1", title: "Vet", start: "2026-08-12T09:00:00", end: "2026-08-12T10:00:00" } });
ok(r.json.error === "google-error", `an unrecognised Google status is still "google-error" (${r.json.error})`);
ok(/Invalid recurrence rule/.test(r.json.detail || ""), `Google's own message reaches the client ("${r.json.detail}")`);
ok(r.json.status === 400, `…along with the status (${r.json.status})`);
ok(/\[calendar\] google 400 on event: invalid: Invalid recurrence rule/.test(sinceLast()),
  `…and it is LOGGED, which is the only after-the-fact record ("${sinceLast()}")`);

console.log("\nB. A 404 on an EVENT is not the calendar being unshared");
googleReply = { status: 404, body: { error: { code: 404, message: "Not Found",
  errors: [{ reason: "notFound", message: "Not Found" }] } } };
r = await call({ action: "update", event: { id: "gone", title: "x", start: "2026-08-12T09:00:00", end: "2026-08-12T10:00:00" } });
ok(r.json.error === "event-gone", `editing a deleted event says the EVENT is gone (${r.json.error})`);
r = await call({ action: "delete", event: { id: "gone" } });
ok(r.json.ok === true, "…and deleting an already-gone event still succeeds (unchanged)");
r = await call({ action: "list", timeMin: "2026-08-01T00:00:00Z", timeMax: "2026-09-01T00:00:00Z" });
ok(r.json.error === "calendar-not-shared",
  `but a 404 LISTING the calendar still means it isn't shared (${r.json.error})`);

console.log("\nC. 401/403 still means the sharing itself, on either scope");
for (const st of [401, 403]){
  googleReply = { status: st, body: { error: { code: st, message: "Forbidden" } } };
  r = await call({ action: "update", event: { id: "e", title: "x", start: "2026-08-12T09:00:00", end: "2026-08-12T10:00:00" } });
  ok(r.json.error === "calendar-not-shared", `a ${st} on an event is still "calendar-not-shared"`);
}

console.log("\nD. A rate limit reads as a rate limit");
googleReply = { status: 429, body: { error: { code: 429, message: "Rate Limit Exceeded",
  errors: [{ reason: "rateLimitExceeded", message: "Rate Limit Exceeded" }] } } };
r = await call({ action: "update", event: { id: "e", title: "x", start: "2026-08-12T09:00:00", end: "2026-08-12T10:00:00" } });
ok(r.json.error === "google-error" && /rateLimitExceeded/.test(r.json.detail || ""),
  `a 429 names itself ("${r.json.detail}")`);

console.log("\nE. Our own bug is named as ours, not Google's");
// A malformed Google body is tolerated rather than thrown on — worth pinning, since a
// crash here would surface as the same opaque failure this whole batch is about.
googleReply = { status: 200, body: "not-json-at-all" };
r = await call({ action: "update", event: { id: "evt_1", title: "x", start: "2026-08-12T09:00:00", end: "2026-08-12T10:00:00" } });
ok(r.status === 200 && !r.json.error, `a malformed Google body degrades quietly, no 500 (${r.status})`);
// A genuine THROW inside the function: buildGoogleEvent does `(ev.title || "").slice(...)`,
// so a title that is a number is a TypeError before Google is ever called. That is a real
// class of bug (a client sending an unexpected type) and it is exactly what used to come
// back as an indistinguishable "google-error" with nothing in the log.
googleReply = null;
r = await call({ action: "update", event: { id: "e", title: 12345, start: "2026-08-12T09:00:00", end: "2026-08-12T10:00:00" } });
ok(r.json.error === "server-bug", `a call that throws is "server-bug", not Google's fault (${r.json.error})`);
ok((r.json.detail || "").length > 0, `…and says what threw ("${r.json.detail}")`);
ok(/\[calendar\] threw on update/.test(logs.join("\n")), "…and is logged with its stack");

console.log("\nF. Nothing leaks, ever");
const all = JSON.stringify(logs) + JSON.stringify(r.json);
ok(!all.includes("PRIVATE KEY") && !all.includes(SA.private_key.slice(40, 90)),
  "the service-account key appears in no response and no log line");
ok(!all.includes("fake-token"), "the access token appears in no response and no log line");
googleReply = GOOGLE_400;
r = await call({ action: "update", event: { id: "e", title: "x", start: "2026-08-12T09:00:00", end: "2026-08-12T10:00:00" } });
ok(!String(r.json.detail).includes("group.calendar.google.com"),
  "the calendar id is not echoed back to the client");
ok(String(r.json.detail).length <= 160, "the detail is capped");

console.log("\nG. The healthy path is untouched");
googleReply = null;
r = await call({ action: "update", event: { id: "evt_1", title: "Vet visit", start: "2026-08-12T09:00:00", end: "2026-08-12T10:00:00" } });
ok(!r.json.error && r.json.event && r.json.event.id === "evt_1", "a good update still returns the normalized event");
ok(/\/cal\/calendars\/.*\/events\/evt_1/.test(lastPath), `…via a PATCH to the event (${lastPath})`);
r = await call({ action: "status" });
ok(r.json.configured === true && r.json.saEmail === SA.client_email, "status still answers the setup card");

console.log("\nH. Notify list round-trips through extendedProperties.private.buckyNotify (2026-08-18)");
// Create with a notify selection -> the outgoing Google body carries it JSON-encoded.
googleReply = null;
r = await call({ action: "create", event: { title: "Vet visit", start: "2026-08-12T09:00:00", end: "2026-08-12T10:00:00", notify: ["Isaac", "Eleanor"] } });
const sentPriv1 = lastBody && lastBody.extendedProperties && lastBody.extendedProperties.private;
ok(!!sentPriv1 && sentPriv1.buckyNotify === JSON.stringify(["Isaac", "Eleanor"]),
  `create sends the ticked names JSON-encoded under extendedProperties.private.buckyNotify (got ${JSON.stringify(sentPriv1)})`);

// list() normalizes that property back into a `notify` array — Google echoes extendedProperties
// on a plain list with no `fields` restriction, so simulate that echo.
googleReply = { status: 200, body: { items: [{ id: "evt_2", summary: "Vet visit",
  start: { dateTime: "2026-08-12T09:00:00-05:00" }, end: { dateTime: "2026-08-12T10:00:00-05:00" },
  extendedProperties: { private: { buckyNotify: JSON.stringify(["Isaac", "Eleanor"]) } } }] } };
r = await call({ action: "list", timeMin: "2026-08-01T00:00:00Z", timeMax: "2026-09-01T00:00:00Z" });
ok(Array.isArray(r.json.events) && r.json.events.length === 1, "list returns the one event");
ok(JSON.stringify(r.json.events[0].notify) === JSON.stringify(["Isaac", "Eleanor"]),
  `…with notify parsed back into a plain array (got ${JSON.stringify(r.json.events[0].notify)})`);

// An event that never had the property at all normalizes to an EMPTY array, never undefined/null.
googleReply = { status: 200, body: { items: [{ id: "evt_3", summary: "No notify ever set",
  start: { dateTime: "2026-08-12T09:00:00-05:00" }, end: { dateTime: "2026-08-12T10:00:00-05:00" } }] } };
r = await call({ action: "list", timeMin: "2026-08-01T00:00:00Z", timeMax: "2026-09-01T00:00:00Z" });
ok(Array.isArray(r.json.events[0].notify) && r.json.events[0].notify.length === 0,
  `an event with the property never set normalizes to [] (got ${JSON.stringify(r.json.events[0].notify)})`);

// UPDATE semantics, decided and documented in calendar.mjs's applyNotify:
//   ev.notify OMITTED entirely  -> leave extendedProperties alone (PATCH sends no such key)
//   ev.notify explicit (even []) -> replace/set
googleReply = null;
lastBody = null;
r = await call({ action: "update", event: { id: "evt_1", title: "Vet visit (retitled)", start: "2026-08-12T09:00:00", end: "2026-08-12T10:00:00" } });
ok(!r.json.error, "the no-notify-key update itself still succeeds");
ok(lastBody && !("extendedProperties" in lastBody),
  `an update that OMITS notify sends no extendedProperties key at all — the existing subscription is left alone, not wiped (got keys: ${lastBody ? Object.keys(lastBody).join(",") : "none"})`);

lastBody = null;
r = await call({ action: "update", event: { id: "evt_1", title: "Vet visit", start: "2026-08-12T09:00:00", end: "2026-08-12T10:00:00", notify: [] } });
const sentPriv2 = lastBody && lastBody.extendedProperties && lastBody.extendedProperties.private;
ok(!!sentPriv2 && sentPriv2.buckyNotify === "[]",
  `an update that explicitly sends notify:[] DOES clear the subscription (got ${JSON.stringify(sentPriv2)})`);

// Defensive cap: an oversized notify list is capped, not sent raw.
lastBody = null;
const hugeList = Array.from({ length: 80 }, (_, i) => "Family Member Number " + i);
r = await call({ action: "update", event: { id: "evt_1", title: "Vet visit", start: "2026-08-12T09:00:00", end: "2026-08-12T10:00:00", notify: hugeList } });
const sentPriv3 = lastBody && lastBody.extendedProperties && lastBody.extendedProperties.private;
const cappedList = sentPriv3 ? JSON.parse(sentPriv3.buckyNotify) : null;
ok(Array.isArray(cappedList) && cappedList.length > 0 && cappedList.length < hugeList.length,
  `an oversized notify list is capped defensively, not sent as-is (80 -> ${cappedList && cappedList.length})`);
ok(!sentPriv3 || sentPriv3.buckyNotify.length <= 1024,
  `the capped value still respects Google's extendedProperties.private per-value limit (${sentPriv3 && sentPriv3.buckyNotify.length} bytes)`);

console.error = realErr;
// AWAIT the close, then let the loop drain. A bare srv.close() followed immediately by
// process.exit() leaves handles mid-close and libuv on Windows aborts with
// "!(handle->flags & UV_HANDLE_CLOSING)" — AFTER the results print, so the suite reads as
// 21/21 while exiting 127. An exit code that contradicts the output is worse than a failure.
await new Promise((r) => srv.close(r));
await new Promise((r) => setTimeout(r, 100));
console.log("\n====================================================");
console.log(`CALENDAR-ERRORS: ${pass}/${pass + fails.length} checks passed`);
fails.forEach((f) => console.log("  FAIL " + f));
process.exit(fails.length ? 1 : 0);
