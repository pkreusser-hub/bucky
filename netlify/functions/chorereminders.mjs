// BUCKY — scheduled chore reminders.
//
// A Netlify Scheduled Function that fires a few times a day and sends a push
// notification to every subscribed family device, nudging the kids to do + check
// off their chores in Bucky (deep-links to index.html#chores).
//
// Intended Central-time sends: 8:30 AM, 1:00 PM, 8:30 PM.
//
// SCHEDULING NOTE (Netlify): a scheduled function accepts exactly ONE cron string.
// The three target minutes differ (30 / 0 / 30) so they can't be expressed as one
// 5-field cron without a cross product. We therefore schedule a cross-product cron
// (`0,30 1,13,18 * * *`, 6 fires/day in UTC) and the handler SELECTS the three
// intended fires by matching the current UTC time to the exact target minutes —
// deterministic and DST-independent (crons are UTC). We ALSO compute the Central
// hour and defensively no-op if it's way off from any expected slot (±90 min band),
// which protects against a stray/manual invoke at an odd time. The schedule only
// takes effect after deploy.
//
// Reuses notify.mjs's FCM technique (service-account JWT, RS256 via node:crypto)
// but is fully self-contained per the repo's one-file-per-function convention —
// notify.mjs itself is NOT imported or modified.
//
// Required env (same as notify.mjs): FIREBASE_SERVICE_ACCOUNT.
// Optional: CHOREREMINDER_FAMILY_KEY (defaults to the production family key).
// Test overrides (used only by the in-process test harness):
//   CHOREREMINDER_TEST_NOW_MS  - fixed "now" in ms since epoch
//   CHOREREMINDER_FORCE        - "1" to bypass the time guard (always attempt a send)
//   CHOREREMINDER_FIRESTORE_BASE, CHOREREMINDER_TOKEN_URL, CHOREREMINDER_FCM_BASE

const PROJECT_ID = "amen-farms-app";
const DEFAULT_FAMILY_KEY = "fam2jan2g"; // roomId("amenfarms")

// ---- Who may receive chore reminders ----
// Chore-reminder pushes are scoped to ONLY these profiles (matched against each push-token
// doc's `user` field — the choreUser identity BuckyPush.enable stamps per device). This is the
// SEND/DELIVERY gate: it's the single fan-out point for chore reminders, so filtering the token
// list here guarantees no device for any OTHER profile (Dad, Mom, guests) is ever messaged — and
// legacy/untagged token docs (no `user` field) are excluded too, since they can't match the
// allowlist. Add a name here to start reminding that profile; keep the names EXACT (choreUser).
const CHORE_REMINDER_USERS = new Set(["Isaac", "Eleanor"]);

const FIRESTORE_BASE = () =>
  process.env.CHOREREMINDER_FIRESTORE_BASE ||
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_URL = () => process.env.CHOREREMINDER_TOKEN_URL || "https://oauth2.googleapis.com/token";
const FCM_SEND_URL = () =>
  (process.env.CHOREREMINDER_FCM_BASE || `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}`) + "/messages:send";

const FCM_SCOPE =
  "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore";

const DEEP_LINK = "https://amenfarms.netlify.app/index.html#chores";
const TITLE = "🐐 Chore check!";
const BODY = "Time to knock out your chores and check them off in Bucky.";

// The three intended send times, as minutes-past-midnight UTC:
//   8:30 AM CDT = 13:30 UTC → 810 ; 1:00 PM CDT = 18:00 UTC → 1080 ; 8:30 PM CDT = 01:30 UTC → 90
const TARGETS_UTC_MIN = [810, 1080, 90];
const UTC_MATCH_WINDOW = 6; // minutes — cross-product fires are ≥30 min apart, so this never double-selects
// Central-time slots (minutes past Central midnight) for the defensive ±90 no-op.
const TARGETS_CENTRAL_MIN = [510 /* 8:30 */, 780 /* 13:00 */, 1230 /* 20:30 */];
const CENTRAL_BAND = 90;

// ---- Google token (hand-signed JWT, RS256) ----
function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function getGoogleAccessToken(serviceAccount) {
  const crypto = await import("node:crypto");
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: FCM_SCOPE,
    aud: TOKEN_URL(),
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const resp = await fetch(TOKEN_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error(`OAuth token exchange failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// ---- Firestore reads ----
// Push tokens for the family, filtered to the CHORE_REMINDER_USERS allowlist. We read the whole
// collection (no server-side filter) and drop any doc whose `user` field isn't in the allowlist —
// this is the delivery gate that keeps chore reminders off Dad's/Mom's/guests' devices. A doc with
// NO `user` field (legacy/untagged) also fails the allowlist and is excluded, so old devices for
// other people stop receiving chore reminders too.
async function getAllDeviceTokens(accessToken, familyKey) {
  const url = `${FIRESTORE_BASE()}:runQuery`;
  const body = { structuredQuery: { from: [{ collectionId: `pushTokens_${familyKey}` }] } };
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const rows = await resp.json();
  if (!resp.ok) throw new Error(`Firestore token query failed: ${resp.status} ${JSON.stringify(rows)}`);
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const doc = row.document;
    if (!doc) continue;
    const token = doc.fields && doc.fields.token && doc.fields.token.stringValue;
    if (!token) continue;
    const user = doc.fields && doc.fields.user && doc.fields.user.stringValue;
    if (!CHORE_REMINDER_USERS.has(user)) continue;   // only Isaac/Eleanor; untagged legacy docs excluded
    const parts = doc.name.split("/");
    out.push({ docId: parts[parts.length - 1], token, user });
  }
  return out;
}

// All chore docs for the family (used for the "all done" smart-skip).
async function getChores(accessToken, familyKey) {
  const url = `${FIRESTORE_BASE()}:runQuery`;
  const body = { structuredQuery: { from: [{ collectionId: `chores_${familyKey}` }] } };
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const rows = await resp.json();
  if (!resp.ok) throw new Error(`Firestore chores query failed: ${resp.status} ${JSON.stringify(rows)}`);
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.document) out.push(row.document.fields || {});
  }
  return out;
}

async function deleteTokenDoc(accessToken, familyKey, docId) {
  await fetch(`${FIRESTORE_BASE()}/pushTokens_${familyKey}/${docId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function sendFcmMessage(accessToken, token) {
  // Data-only message — same rationale as notify.mjs (the service worker is the single
  // source of truth for the tray entry, so we don't double-notify).
  const message = {
    message: {
      token,
      data: { title: TITLE, body: BODY, url: DEEP_LINK },
      webpush: { headers: { Urgency: "high" } },
    },
  };
  const resp = await fetch(FCM_SEND_URL(), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}
function isUnregistered(result) {
  if (result.status === 404) return true;
  const status = result.data && result.data.error && result.data.error.status;
  return status === "UNREGISTERED" || status === "NOT_FOUND";
}

// ---- Time helpers ----
function nowMs() {
  const t = Number(process.env.CHOREREMINDER_TEST_NOW_MS);
  return Number.isFinite(t) && t > 0 ? t : Date.now();
}
function utcMinutes(now) {
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}
// Central (America/Chicago) date key "YYYY-MM-DD" + minutes-past-midnight.
function centralParts(now) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  let hh = parseInt(parts.hour, 10);
  if (hh === 24) hh = 0; // some engines emit 24 for midnight
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  return { dateKey, minutes: hh * 60 + parseInt(parts.minute, 10) };
}
// Returns the matched slot index (0/1/2) if this is one of the intended fires, else -1.
function matchedSlot(now) {
  if (process.env.CHOREREMINDER_FORCE === "1") return 0;
  const um = utcMinutes(now);
  const within = (a, b, w) => {
    let d = Math.abs(a - b);
    d = Math.min(d, 1440 - d); // wrap around midnight
    return d <= w;
  };
  const idx = TARGETS_UTC_MIN.findIndex((t) => within(um, t, UTC_MATCH_WINDOW));
  if (idx < 0) return -1;
  // Defensive Central-band check: no-op if Central time is way off from every expected slot.
  const cm = centralParts(now).minutes;
  const ok = TARGETS_CENTRAL_MIN.some((t) => within(cm, t, CENTRAL_BAND));
  return ok ? idx : -1;
}

// ---- Smart skip: is every DAILY chore already done for today (Central)? ----
function fInt(field) {
  if (!field) return undefined;
  if (field.integerValue != null) return parseInt(field.integerValue, 10);
  if (field.doubleValue != null) return Number(field.doubleValue);
  return undefined;
}
function choreDoneToday(fields, todayKey) {
  const target = fInt(fields.target) || 1;
  const donePeriod = fields.donePeriod && fields.donePeriod.stringValue;
  const doneLog = fields.doneLog && fields.doneLog.arrayValue && fields.doneLog.arrayValue.values;
  if (donePeriod === todayKey && Array.isArray(doneLog) && doneLog.length >= target) return true;
  // legacy single-completion shape
  const lastPeriod = fields.lastPeriod && fields.lastPeriod.stringValue;
  const lastAt = fInt(fields.lastAt);
  if (lastPeriod === todayKey && lastAt) return true;
  return false;
}
// True when there is at least one daily chore and ALL daily chores are done for today.
function allDailyChoresDone(choreDocs, todayKey) {
  const daily = choreDocs.filter((f) => f.frequency && f.frequency.stringValue === "daily");
  if (!daily.length) return false; // nothing to be "all done" about → don't skip
  return daily.every((f) => choreDoneToday(f, todayKey));
}

export default async () => {
  const now = new Date(nowMs());
  const slot = matchedSlot(now);
  if (slot < 0) {
    return new Response(JSON.stringify({ skipped: "not-a-scheduled-slot" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const familyKey = process.env.CHOREREMINDER_FAMILY_KEY || DEFAULT_FAMILY_KEY;

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    return new Response(JSON.stringify({ error: "FIREBASE_SERVICE_ACCOUNT not set" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    return new Response(JSON.stringify({ error: "FIREBASE_SERVICE_ACCOUNT is not valid JSON" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const accessToken = await getGoogleAccessToken(serviceAccount);

    // Smart skip: if all daily chores are already done for today, don't nag (esp. the evening send).
    const todayKey = centralParts(now).dateKey;
    let chores = [];
    try {
      chores = await getChores(accessToken, familyKey);
    } catch (e) {
      // Reading chores is best-effort; if it fails we still send (never suppress a reminder on error).
      chores = [];
    }
    if (allDailyChoresDone(chores, todayKey)) {
      return new Response(JSON.stringify({ skipped: "all-chores-done", slot }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    const tokens = await getAllDeviceTokens(accessToken, familyKey);
    let sent = 0, pruned = 0;
    for (const { docId, token } of tokens) {
      const result = await sendFcmMessage(accessToken, token);
      if (result.ok) sent += 1;
      else if (isUnregistered(result)) { await deleteTokenDoc(accessToken, familyKey, docId); pruned += 1; }
    }
    return new Response(JSON.stringify({ sent, pruned, slot, tokens: tokens.length }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
};

// The cron schedule lives in netlify.toml ([functions."chorereminders"].schedule =
// "0,30 1,13,18 * * *") — a cross-product cron (6 UTC fires/day) whose 3 intended sends
// are selected by matchedSlot() above. Declared in ONE place (the toml) to avoid a
// conflicting dual declaration.
