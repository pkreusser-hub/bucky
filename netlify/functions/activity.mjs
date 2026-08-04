// BUCKY — who is actually using the app.
//
// Netlify Function (ESM). POST JSON, secret-gated like every other function here.
//
//   { secret, action:"log", rows:[{user, day, feature, v, m}] }
//     -> { ok:true, wrote:N }   — always 200, even when the write failed
//
//   { secret, action:"stats", months:["YYYY-MM", ...] }
//     -> { ok, users:[{user, slug, days:{ "YYYY-MM-DD": { feature:{v,m} } }}], months, pruned }
//
// ONE DOC PER PERSON PER MONTH: bucky_activity/<YYYY-MM>__<userSlug>, holding a `user`
// string (the real display name, so the dashboard can show "Eleanor" and not "eleanor")
// and a flat field per day-and-feature: `d03_news_v` views, `d03_news_m` minutes. The leading
// "d" is required — Firestore rejects an unquoted property path that starts with a digit.
//
// WHY THAT SHAPE. Every counter is written as an INCREMENT fieldTransform, exactly as
// farmgpt.mjs logs token usage — two devices flushing at the same moment converge instead
// of clobbering each other, which a read-modify-write of a JSON blob could not do. Flat
// day-prefixed field names are what make that possible: Firestore can only transform a
// field path, so the day has to be IN the name. One doc per person per month keeps the
// collection at roughly (family size × months) documents forever, and a month's worth of
// a person's activity comes back in one read.
//
// A LOG CALL CAN NEVER BE A PROBLEM THE USER SEES. It answers 200 whatever happens — a
// missing service account, a Firestore outage, a malformed row — because the caller is a
// beacon fired from a page the person is in the middle of using or leaving. `wrote` says
// quietly how many rows landed.
//
// Zero dependencies, hand-rolled JWT + Firestore REST — the house convention shared with
// farmgpt.mjs / calendar.mjs / notify.mjs / news.mjs.
//
// Required env (both already set): BUCKY_NOTIFY_SECRET, FIREBASE_SERVICE_ACCOUNT.
// Optional env: ACTIVITY_FIRESTORE_BASE / ACTIVITY_GOOGLE_TOKEN_URL to point at fakes in tests.

const ALLOWED_ORIGINS = new Set([
  "https://amenfarms.netlify.app",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
]);

const PROJECT_ID = "amen-farms-app";
const FIRESTORE_BASE = process.env.ACTIVITY_FIRESTORE_BASE ||
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const GOOGLE_TOKEN_URL = process.env.ACTIVITY_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const COLLECTION = "bucky_activity";

const MAX_ROWS = 100;          // rows one request may carry
const MAX_MONTHS = 6;          // months one stats read may ask for
const STALE_DAYS = 35;         // a row older than this is a stale buffer, not today's news
const RETAIN_MONTHS = 6;       // months kept; older docs are pruned on a stats read
const MAX_MINUTES = 1440;      // a day is 1440 minutes; anything more is a broken clock
const MAX_VIEWS = 1000;

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

/* ---------------------------------------------------------------------------
   Google auth — hand-signed JWT, cached across warm invocations (notify.mjs technique).
   --------------------------------------------------------------------------- */
let cachedGoogleToken = null;   // { token, exp(ms) }

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGoogleAccessToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  if (cachedGoogleToken && Date.now() < cachedGoogleToken.exp - 60000) return cachedGoogleToken.token;
  const sa = JSON.parse(raw);
  const crypto = await import("node:crypto");
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(header + "." + claims);
  const jwt = header + "." + claims + "." + base64url(signer.sign(sa.private_key));
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!resp.ok) return null;
  const j = await resp.json();
  cachedGoogleToken = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cachedGoogleToken.token;
}

/* ---------------------------------------------------------------------------
   Validation.

   Field names are parsed back out with /^(\d{2})_(.+)_([vm])$/, so a feature may contain
   underscores (index.html sends "app_news") but never a leading or trailing one, and
   never anything that could collide with the day prefix or the v/m suffix.
   --------------------------------------------------------------------------- */
export function slugName(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24)
    .replace(/_+$/, "");
}

function todayCentral() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}
function daysBetween(a, b) {
  const ms = Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z");
  return Number.isFinite(ms) ? Math.round(ms / 86400000) : NaN;
}

/** Rows -> a map of docId -> { user, month, fields:{name:{v,m}} }. Invalid rows are dropped. */
export function planWrites(rows, today) {
  const now = today || todayCentral();
  const byDoc = new Map();
  let kept = 0, dropped = 0;

  for (const raw of (Array.isArray(rows) ? rows : []).slice(0, MAX_ROWS)) {
    if (!raw || typeof raw !== "object") { dropped++; continue; }

    const display = String(raw.user == null ? "" : raw.user).trim().slice(0, 40) || "Unknown";
    const userSlug = slugName(display) || "unknown";
    const feature = slugName(raw.feature);
    const day = String(raw.day || "");

    if (!feature) { dropped++; continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { dropped++; continue; }
    const age = daysBetween(now, day);
    // Older than the buffer could plausibly be, or dated in the future (a device with a
    // wrong clock) — either way it is not something to file under a real day.
    if (!Number.isFinite(age) || age > STALE_DAYS || age < -1) { dropped++; continue; }

    const v = Math.max(0, Math.min(MAX_VIEWS, Math.floor(Number(raw.v) || 0)));
    const m = Math.max(0, Math.min(MAX_MINUTES, Math.round((Number(raw.m) || 0) * 100) / 100));
    if (!v && !m) { dropped++; continue; }

    const month = day.slice(0, 7);
    const dd = day.slice(8, 10);
    const docId = `${month}__${userSlug}`;
    let doc = byDoc.get(docId);
    if (!doc) { doc = { docId, user: display, slug: userSlug, month, fields: new Map() }; byDoc.set(docId, doc); }

    // The "d" prefix is LOAD-BEARING, not decoration. A Firestore property path must match
    // ([a-zA-Z_][a-zA-Z_0-9]*) unless it is backtick-quoted, so the obvious `03_news_v`
    // makes the whole commit fail with HTTP 400 — which is how the first version of this
    // silently recorded nothing for twelve hours while every test passed against a fake
    // Firestore that did not enforce the grammar.
    const key = `d${dd}_${feature}`;
    const cur = doc.fields.get(key) || { v: 0, m: 0 };
    cur.v += v;
    cur.m = Math.round((cur.m + m) * 100) / 100;
    doc.fields.set(key, cur);
    kept++;
  }
  return { docs: [...byDoc.values()], kept, dropped };
}

/** One Firestore write per doc: set `user`/`month` (masked, so counters survive) and
 *  increment every counter in the same commit. */
function writeFor(doc, base) {
  const transforms = [];
  for (const [key, val] of doc.fields) {
    if (val.v) transforms.push({ fieldPath: `${key}_v`, increment: { integerValue: String(val.v) } });
    // Minutes are fractional by nature (a 40-second visit is 0.67), so they increment as a
    // double. Views stay integers.
    if (val.m) transforms.push({ fieldPath: `${key}_m`, increment: { doubleValue: val.m } });
  }
  if (!transforms.length) return null;
  return {
    update: {
      name: `${base}/${COLLECTION}/${doc.docId}`,
      fields: { user: { stringValue: doc.user }, month: { stringValue: doc.month } },
    },
    updateMask: { fieldPaths: ["user", "month"] },
    updateTransforms: transforms,
  };
}

async function logRows(rows) {
  const plan = planWrites(rows);
  if (!plan.docs.length) return { wrote: 0, dropped: plan.dropped };
  try {
    const token = await getGoogleAccessToken();
    if (!token) return { wrote: 0, dropped: plan.dropped, reason: "no-service-account" };
    const base = `projects/${PROJECT_ID}/databases/(default)/documents`;
    const writes = plan.docs.map((d) => writeFor(d, base)).filter(Boolean);
    if (!writes.length) return { wrote: 0, dropped: plan.dropped };
    const resp = await fetch(`${FIRESTORE_BASE}:commit`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ writes }),
    });
    if (!resp.ok) return { wrote: 0, dropped: plan.dropped, reason: "http-" + resp.status };
    return { wrote: plan.kept, dropped: plan.dropped };
  } catch (e) {
    return { wrote: 0, dropped: plan.dropped, reason: "unreachable" };
  }
}

/* ---------------------------------------------------------------------------
   Reading back.
   --------------------------------------------------------------------------- */
async function listDocs(token) {
  const out = [];
  let pageToken = "";
  for (let g = 0; g < 20; g++) {
    const url = `${FIRESTORE_BASE}/${COLLECTION}?pageSize=300` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return out;
    const j = await r.json();
    for (const d of (j.documents || [])) out.push(d);
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out;
}

/** A doc's flat `d03_news_v` fields -> { "2026-08-03": { news: {v,m} } }. */
export function parseDoc(doc) {
  const id = String(doc.name || "").split("/").pop();
  const f = doc.fields || {};
  const month = (f.month && f.month.stringValue) || id.split("__")[0] || "";
  const user = (f.user && f.user.stringValue) || (id.split("__")[1] || "unknown");
  const days = {};
  for (const key of Object.keys(f)) {
    const m = /^d(\d{2})_(.+)_([vm])$/.exec(key);
    if (!m) continue;
    const cell = f[key] || {};
    const num = cell.integerValue !== undefined ? parseInt(cell.integerValue, 10)
      : cell.doubleValue !== undefined ? Number(cell.doubleValue) : 0;
    if (!Number.isFinite(num) || num <= 0) continue;
    const date = `${month}-${m[1]}`;
    const feature = m[2];
    const bucket = (days[date] = days[date] || {});
    const slot = (bucket[feature] = bucket[feature] || { v: 0, m: 0 });
    if (m[3] === "v") slot.v += num;
    else slot.m = Math.round((slot.m + num) * 100) / 100;
  }
  return { id, month, user, slug: id.split("__")[1] || slugName(user), days };
}

/** Months older than the retention window (the storylog prune precedent — bounded storage
 *  with no scheduler, paid for on a read nobody is waiting on). */
function staleMonths(months, keep) {
  const now = new Date();
  const cut = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (keep - 1), 1));
  const cutKey = `${cut.getUTCFullYear()}-${String(cut.getUTCMonth() + 1).padStart(2, "0")}`;
  return months.filter((m) => m && m < cutKey);
}

async function readStats(months) {
  const token = await getGoogleAccessToken();
  if (!token) return { ok: false, reason: "no-service-account", users: [], pruned: 0 };
  const docs = await listDocs(token);

  // Retention first, so a pruned month can never come back in this same answer.
  const base = `projects/${PROJECT_ID}/databases/(default)/documents`;
  const doomed = [];
  for (const d of docs) {
    const id = String(d.name || "").split("/").pop();
    const mth = id.split("__")[0] || "";
    if (staleMonths([mth], RETAIN_MONTHS).length) doomed.push(id);
  }
  if (doomed.length) {
    for (let i = 0; i < doomed.length; i += 400) {
      const writes = doomed.slice(i, i + 400).map((id) => ({ delete: `${base}/${COLLECTION}/${id}` }));
      await fetch(`${FIRESTORE_BASE}:commit`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ writes }),
      }).catch(() => {});
    }
  }
  const gone = new Set(doomed);

  // One entry per PERSON, with the months asked for merged together — the dashboard's
  // ranges (7 and 30 days) straddle a month boundary for most of any given month.
  const want = new Set(months);
  const byUser = new Map();
  for (const d of docs) {
    const id = String(d.name || "").split("/").pop();
    if (gone.has(id)) continue;
    const parsed = parseDoc(d);
    if (!want.has(parsed.month)) continue;
    let u = byUser.get(parsed.slug);
    if (!u) { u = { user: parsed.user, slug: parsed.slug, days: {} }; byUser.set(parsed.slug, u); }
    if (parsed.user && parsed.user !== parsed.slug) u.user = parsed.user;
    for (const date of Object.keys(parsed.days)) {
      const into = (u.days[date] = u.days[date] || {});
      for (const feat of Object.keys(parsed.days[date])) {
        const src = parsed.days[date][feat];
        const dst = (into[feat] = into[feat] || { v: 0, m: 0 });
        dst.v += src.v;
        dst.m = Math.round((dst.m + src.m) * 100) / 100;
      }
    }
  }
  return { ok: true, users: [...byUser.values()], pruned: doomed.length };
}

/* --------------------------------------------------------------------------- */

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "POST only" }, 405, headers);

  const familySecret = process.env.BUCKY_NOTIFY_SECRET;
  if (!familySecret) return json({ error: "Server misconfigured: BUCKY_NOTIFY_SECRET is not set" }, 500, headers);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, headers); }
  if (!body || body.secret !== familySecret) return json({ error: "Wrong family password" }, 401, headers);

  /* ---- log: fire-and-forget from a page the person is using or leaving ---- */
  if (body.action === "log") {
    let res;
    try { res = await logRows(body.rows); }
    catch { res = { wrote: 0, dropped: 0, reason: "crashed" }; }
    return json({ ok: true, wrote: res.wrote, dropped: res.dropped, reason: res.reason || "" }, 200, headers);
  }

  /* ---- stats: the Dad dashboard ---- */
  if (body.action === "stats") {
    const months = [];
    for (const m of (Array.isArray(body.months) ? body.months : [])) {
      if (typeof m === "string" && /^\d{4}-\d{2}$/.test(m) && !months.includes(m)) months.push(m);
      if (months.length >= MAX_MONTHS) break;
    }
    if (!months.length) months.push(todayCentral().slice(0, 7));
    try {
      const res = await readStats(months);
      return json({ ...res, months }, 200, headers);
    } catch {
      return json({ ok: false, reason: "unreachable", users: [], months, pruned: 0 }, 200, headers);
    }
  }

  return json({ error: 'action must be "log" or "stats"' }, 400, headers);
};

export const config = {
  path: "/.netlify/functions/activity",
};
