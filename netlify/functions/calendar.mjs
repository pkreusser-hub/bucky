// BUCKY — shared family calendar (Google Calendar-backed).
//
// Netlify Function (ESM). POST JSON: { secret, action, ... }
//
// Actions:
//   { action:"status" }
//       -> { configured, saEmail, hasServiceAccount, hasCalendarId }
//         (the in-app setup screen shows "share your calendar with <saEmail>")
//   { action:"list", timeMin, timeMax }
//       -> { events:[{id,title,start,end,allDay,notes,seriesId}] } (singleEvents, orderBy
//          startTime; seriesId = Google recurringEventId — the client's recurring marker
//          + series-edit handle, null for standalone events)
//   { action:"get", event:{id} }
//       -> { event:{normalized + repeat} } — repeat parsed back from the event's RRULE
//          ({freq,until}, exotic rules -> {freq:"CUSTOM"}, non-recurring -> null); the
//          client uses this to prefill "whole series" edits.
//   { action:"create", event:{...} } | { action:"update", event:{id,...} }
//       -> { event:{normalized} }
//       event.repeat (optional) = { freq:"DAILY"|"WEEKLY"|"BIWEEKLY"|"MONTHLY"|"YEARLY",
//       until:"YYYY-MM-DD"|null } builds the Google recurrence RRULE server-side
//       (BIWEEKLY = FREQ=WEEKLY;INTERVAL=2; WEEKLY recurs on the start date's weekday
//       implicitly). On UPDATE: repeat absent/null leaves recurrence UNCHANGED;
//       repeat:{freq:"NONE"} explicitly CLEARS it (recurrence:[]).
//   { action:"delete", event:{id} }
//       -> { ok:true }
//
// Auth: mints a Google OAuth2 access token from a service account by hand-signing a JWT
// with Node's built-in `crypto` (RS256) — same zero-dependency technique as notify.mjs /
// farmgpt.mjs, but with the Calendar scope. The user enables the Calendar API on the GCP
// project (amen-farms-app) and shares the family calendar with the service account email.
//
// Required environment variables (Netlify site settings):
//   BUCKY_NOTIFY_SECRET       - shared family passphrase the client must send back
//   FIREBASE_SERVICE_ACCOUNT  - the full service-account JSON, stringified (reused as-is)
//   GOOGLE_CALENDAR_ID        - id of the calendar shared with the service account
//
// Optional test overrides:
//   CALENDAR_BASE_URL         - default https://www.googleapis.com/calendar/v3
//   CAL_GOOGLE_TOKEN_URL      - default https://oauth2.googleapis.com/token

const TZ = "America/Chicago";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const CALENDAR_BASE_URL = process.env.CALENDAR_BASE_URL || "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = process.env.CAL_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";

const ALLOWED_ORIGINS = new Set([
  "https://amenfarms.netlify.app",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
]);

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://amenfarms.netlify.app";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers });
}
function jsonError(status, message, headers) {
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Parse the service-account JSON. Returns null if missing/invalid (never throws, never leaks it).
function readServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    return sa && sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

let cachedGoogleToken = null; // { token, exp(ms) } — survives across warm invocations

// Mints a short-lived Google OAuth2 access token via the JWT Bearer flow (RFC 7523),
// signed RS256 with Node `crypto`. Cached until ~1 min before expiry.
async function getGoogleAccessToken(sa) {
  if (cachedGoogleToken && Date.now() < cachedGoogleToken.exp - 60000) return cachedGoogleToken.token;
  const crypto = await import("node:crypto");
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: CALENDAR_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(header + "." + claims);
  signer.end();
  const jwt = header + "." + claims + "." + base64url(signer.sign(sa.private_key));
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => ({}));
  if (!data.access_token) return null;
  cachedGoogleToken = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedGoogleToken.token;
}

// ---- Google Calendar REST helper ----
async function calFetch(token, method, path, opts) {
  const o = opts || {};
  let url = CALENDAR_BASE_URL + path;
  if (o.query) url += "?" + new URLSearchParams(o.query).toString();
  const resp = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* 204 no-body (delete) */ }
  return { ok: resp.ok, status: resp.status, data };
}

// Google 401/403/404 on the calendar itself → the family calendar isn't shared with the SA
// (or the id is wrong). The client renders a friendly "share your calendar" explainer for this.
function classifyGoogleError(r, headers) {
  if (r.status === 401 || r.status === 403 || r.status === 404) {
    return json({ error: "calendar-not-shared" }, 200, headers);
  }
  return json({ error: "google-error" }, 200, headers);
}

// Normalize a Google event → the lean shape the client renders. Handles both timed
// (start.dateTime) and all-day (start.date) events. seriesId = the master's id when this
// is an INSTANCE of a recurring event (list uses singleEvents:true so that's what the
// client sees); null for standalone events and for the master itself.
function normalizeEvent(e) {
  const allDay = !!(e.start && e.start.date);
  return {
    id: e.id,
    title: e.summary || "",
    start: allDay ? (e.start.date || "") : ((e.start && e.start.dateTime) || ""),
    end: allDay ? ((e.end && e.end.date) || "") : ((e.end && e.end.dateTime) || ""),
    allDay,
    notes: e.description || "",
    seriesId: e.recurringEventId || null,
  };
}

// ---- Recurrence (Google-native RRULE) ----
// The app supports one simple rule per series: {freq, until}. Anything richer is created
// in Google Calendar directly and round-trips as {freq:"CUSTOM"} (which the client shows
// read-only and never rewrites).
const REPEAT_FREQ_RULES = {
  DAILY: "FREQ=DAILY",
  WEEKLY: "FREQ=WEEKLY",              // recurs on the start date's weekday implicitly
  BIWEEKLY: "FREQ=WEEKLY;INTERVAL=2",
  MONTHLY: "FREQ=MONTHLY",
  YEARLY: "FREQ=YEARLY",
};

// {freq, until} → "RRULE:..." (null for NONE/CUSTOM/unknown freq). UNTIL uses the UTC
// datetime form for timed events and the value-date form for all-day events (Google
// requires UNTIL's type to match DTSTART's).
function buildRRule(repeat, allDay) {
  if (!repeat || typeof repeat !== "object") return null;
  const base = REPEAT_FREQ_RULES[repeat.freq];
  if (!base) return null;
  let rule = "RRULE:" + base;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(repeat.until || "");
  if (m) rule += ";UNTIL=" + m[1] + m[2] + m[3] + (allDay ? "" : "T235959Z");
  return rule;
}

// Stamp ev.repeat onto the outgoing Google body. Semantics:
//   absent/null            → leave recurrence alone (PATCH omits the key entirely)
//   {freq:"NONE"}          → on update, explicitly clear (recurrence:[]); no-op on create
//   {freq:<supported>}     → recurrence:[RRULE]
//   {freq:"CUSTOM"/junk}   → leave recurrence alone (never clobber an exotic rule)
function applyRepeat(g, ev, isUpdate) {
  const rep = ev.repeat;
  if (rep === undefined || rep === null) return;
  if (rep && rep.freq === "NONE") { if (isUpdate) g.recurrence = []; return; }
  const rule = buildRRule(rep, !!ev.allDay);
  if (rule) g.recurrence = [rule];
}

// Best-effort inverse of buildRRule: Google recurrence array → {freq, until} | null.
// Anything beyond one plain FREQ/INTERVAL/UNTIL rule (COUNT, BYDAY lists, RDATE-only,
// nth-weekday, multiple RRULEs, …) → {freq:"CUSTOM"} so the client treats it read-only.
function parseRepeat(recurrence) {
  if (!Array.isArray(recurrence) || recurrence.length === 0) return null;
  const rules = recurrence.filter((s) => typeof s === "string" && /^RRULE:/i.test(s.trim()));
  if (rules.length !== 1) return { freq: "CUSTOM", until: null };  // RDATE-only or several rules
  const props = {};
  for (const part of rules[0].trim().replace(/^RRULE:/i, "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) props[part.slice(0, i).toUpperCase()] = part.slice(i + 1).toUpperCase();
  }
  let until = null;
  const um = /^(\d{4})(\d{2})(\d{2})/.exec(props.UNTIL || "");   // both 20261231 and 20261231T235959Z
  if (um) until = `${um[1]}-${um[2]}-${um[3]}`;
  const custom = { freq: "CUSTOM", until };
  const interval = props.INTERVAL ? parseInt(props.INTERVAL, 10) : 1;
  const known = new Set(["FREQ", "INTERVAL", "UNTIL", "WKST"]);
  const extras = Object.keys(props).filter((k) => !known.has(k));
  if (props.FREQ === "WEEKLY") {
    // a single plain BYDAY (what Google's own UI writes for "Weekly on Monday") is still
    // our WEEKLY — the weekday rides on the start date; anything more is CUSTOM.
    if (extras.some((k) => k !== "BYDAY")) return custom;
    if (props.BYDAY && !/^(SU|MO|TU|WE|TH|FR|SA)$/.test(props.BYDAY)) return custom;
    if (interval === 1) return { freq: "WEEKLY", until };
    if (interval === 2) return { freq: "BIWEEKLY", until };
    return custom;
  }
  if (extras.length || interval !== 1) return custom;
  if (props.FREQ === "DAILY" || props.FREQ === "MONTHLY" || props.FREQ === "YEARLY") return { freq: props.FREQ, until };
  return custom;
}

function addDayStr(dateStr) {
  // "YYYY-MM-DD" + 1 day (UTC math avoids tz drift). Used for the exclusive all-day end.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || "");
  if (!m) return dateStr;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Client event → Google Calendar event body.
function buildGoogleEvent(ev) {
  const g = { summary: (ev.title || "").slice(0, 1024), description: (ev.notes || "").slice(0, 8000) };
  if (ev.allDay) {
    const startDate = ev.startDate || ev.date;
    const endDate = ev.endDate || addDayStr(startDate); // Google all-day end is EXCLUSIVE
    g.start = { date: startDate };
    g.end = { date: endDate };
  } else {
    g.start = { dateTime: ev.start, timeZone: TZ };
    g.end = { dateTime: ev.end, timeZone: TZ };
  }
  return g;
}

async function listEvents(token, calId, body, headers) {
  const query = { singleEvents: "true", orderBy: "startTime", maxResults: "250", timeZone: TZ };
  if (body.timeMin) query.timeMin = body.timeMin;
  if (body.timeMax) query.timeMax = body.timeMax;
  const r = await calFetch(token, "GET", `/calendars/${encodeURIComponent(calId)}/events`, { query });
  if (!r.ok) return classifyGoogleError(r, headers);
  const events = ((r.data && r.data.items) || []).map(normalizeEvent);
  return json({ events }, 200, headers);
}

async function createEvent(token, calId, ev, headers) {
  const body = buildGoogleEvent(ev);
  applyRepeat(body, ev, false);
  const r = await calFetch(token, "POST", `/calendars/${encodeURIComponent(calId)}/events`, { body });
  if (!r.ok) return classifyGoogleError(r, headers);
  return json({ event: normalizeEvent(r.data || {}) }, 200, headers);
}

async function updateEvent(token, calId, ev, headers) {
  if (!ev || !ev.id) return jsonError(400, "Missing event id", headers);
  const body = buildGoogleEvent(ev);
  applyRepeat(body, ev, true);
  const r = await calFetch(token, "PATCH", `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(ev.id)}`, { body });
  if (!r.ok) return classifyGoogleError(r, headers);
  return json({ event: normalizeEvent(r.data || {}) }, 200, headers);
}

// Single-event fetch (the client prefills "whole series" edits from the master's parsed
// repeat + original dates). Returns the normalized event + repeat ({freq,until} | CUSTOM | null).
async function getEvent(token, calId, ev, headers) {
  if (!ev || !ev.id) return jsonError(400, "Missing event id", headers);
  const r = await calFetch(token, "GET", `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(ev.id)}`);
  if (!r.ok) return classifyGoogleError(r, headers);
  const norm = normalizeEvent(r.data || {});
  norm.repeat = parseRepeat((r.data || {}).recurrence);
  return json({ event: norm }, 200, headers);
}

async function deleteEvent(token, calId, ev, headers) {
  if (!ev || !ev.id) return jsonError(400, "Missing event id", headers);
  const r = await calFetch(token, "DELETE", `/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(ev.id)}`);
  // Idempotent: an already-gone event (404/410) is a successful delete from the client's view.
  if (!r.ok && r.status !== 404 && r.status !== 410) return classifyGoogleError(r, headers);
  return json({ ok: true }, 200, headers);
}

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("", { status: 204, headers });
  if (req.method !== "POST") return jsonError(405, "POST only", headers);

  const familySecret = process.env.BUCKY_NOTIFY_SECRET;
  if (!familySecret) return jsonError(500, "Server misconfigured: BUCKY_NOTIFY_SECRET is not set", headers);

  let body;
  try { body = await req.json(); } catch { return jsonError(400, "Invalid JSON", headers); }
  if (!body || body.secret !== familySecret) return jsonError(401, "Wrong family password", headers);

  const action = body.action;
  const sa = readServiceAccount();
  const calId = process.env.GOOGLE_CALENDAR_ID || "";

  // Setup/status probe — always answerable, drives the in-app setup card.
  if (action === "status") {
    return json({
      configured: !!(sa && calId),
      saEmail: sa ? sa.client_email : null,
      hasServiceAccount: !!sa,
      hasCalendarId: !!calId,
    }, 200, headers);
  }

  // Everything else needs the service account + a calendar id.
  if (!sa) return jsonError(500, "Server misconfigured: FIREBASE_SERVICE_ACCOUNT not set", headers);
  if (!calId) return json({ error: "not-configured" }, 200, headers);

  let token;
  try { token = await getGoogleAccessToken(sa); } catch { token = null; }
  if (!token) return jsonError(502, "Could not authenticate with Google", headers);

  try {
    if (action === "list") return await listEvents(token, calId, body, headers);
    if (action === "get") return await getEvent(token, calId, body.event || {}, headers);
    if (action === "create") return await createEvent(token, calId, body.event || {}, headers);
    if (action === "update") return await updateEvent(token, calId, body.event || {}, headers);
    if (action === "delete") return await deleteEvent(token, calId, body.event || {}, headers);
    return jsonError(400, "Unknown action", headers);
  } catch (err) {
    // Never leak the service-account key or Google internals.
    return json({ error: "google-error" }, 200, headers);
  }
};

export const config = {
  path: "/.netlify/functions/calendar",
};
