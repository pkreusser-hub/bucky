// BUCKY — ops/health dashboard, server half.
//
// Netlify Function (ESM). POST JSON, secret-gated like every other function here.
//
// =============================================================================================
// API CONTRACT (read this if you are building the client, e.g. status.html)
// =============================================================================================
//
//   { secret, action:"summary", force?:boolean }
//     -> {
//          ok: true,
//          generatedAt: <ms epoch>,     // when this payload was produced (live OR the cached one)
//          cachedUntil: <ms epoch>,     // this payload is considered fresh until this time
//          cached: boolean,             // true when served from the 10-minute Firestore cache
//          counts: { ok, warn, down, unconfigured, unknown },   // tallies over `services`, handy for a traffic light
//          services: [
//            {
//              id: "anthropic",                  // stable slug — matches the id list below
//              name: "Anthropic (Claude)",       // display name
//              tier: "paid" | "free" | "self",
//              status: "ok" | "warn" | "down" | "unconfigured" | "unknown",
//              headline: "Reachable",            // one short line, safe to show as a chip
//              detail: "The Anthropic API is responding normally.",  // one/two sentences, always safe to render
//              breaks: ["FarmGPT research & stories", ...],  // what stops working if this is down — THE POINT of the dashboard
//              metric: { ... } | null,           // OPTIONAL, service-specific — see shapes below
//              configHint: "..." | null,         // set ONLY when status === "unconfigured": exactly which env var to add and where to get it
//            }, ...
//          ]
//        }
//
//     `metric` shapes actually produced (all optional/nullable — a client should treat every
//     field as possibly-absent and just skip rendering a bar/number when metric is null):
//       netlify:    { used, limit, pct, unit:"bytes", periodEnd }
//       elevenlabs: { used, limit, pct, unit:"characters" }
//       tripo:      { balance, unit:"credits" }
//       firebase:   { totalDocs, totalBytes, measuredAt, staleMs }  (mirrors the last cached
//                    firestore_usage result, if any — this action never re-measures it itself)
//
//     REGISTRY ids (this is the whole inventory; a client can hardcode this list to lay out a
//     fixed page, or just iterate `services`):
//       paid:  anthropic, xai, gemini, netlify, firebase, elevenlabs, tripo
//       free:  openmeteo, rainviewer, iem_hrrr, yahoo_finance, jsdelivr, unpkg_leaflet,
//              unpkg_playroom, gstatic_firebase, google_fonts
//       self:  farmgpt, news, stocks, calendar, activity, goats, notify,
//              teachergpt-background, chorereminders (always status:"unknown" — it's a
//              scheduled function; see its own detail text)
//
//   { secret, action:"probe_anthropic_credit" }
//     -> { ok:true, status:"ok"|"credit-low"|"key-bad"|"down"|"unconfigured", detail:"..." }
//     ON DEMAND ONLY — the one probe that spends real money (~a penny, one real completion).
//     A client should put this behind an explicit button, never call it automatically.
//
//   { secret, action:"firestore_usage", force?:boolean }
//     -> {
//          ok: true,
//          generatedAt, cachedUntil, cached,          // 24-hour cache, same shape idea as summary
//          collections: [ { id, count, bytes, truncated, ok } ],
//          totalDocs, totalBytes,
//          anyTruncated: boolean,     // true if ANY collection's count/bytes is a floor, not exact
//          note: "..."                // the Spark free-tier reminder, plain text, safe to render
//        }
//     `count`/`bytes` are exact UNLESS `truncated` is true, in which case they are a floor
//     (the walk stopped at 5 pages of 300 = 1,500 docs) — render as ">= N" when truncated.
//
//   On any transport-level problem (bad secret, bad JSON, unknown action) the function answers
//   the usual 401/400 shape used everywhere else in this repo: { error: "..." }.
//
//   Every action call ALWAYS answers 200 with a well-formed body once past the secret gate —
//   upstream failures show up as status:"down" rows inside `services`/`collections`, never as
//   an HTTP error from this function itself. Firestore being unreachable degrades `summary` to
//   an uncached live read and `firestore_usage` to { ok:false, reason, ... } — it never blocks
//   the response.
//
// =============================================================================================
//
// WHY A REGISTRY (not one probe per feature): the point of this dashboard is the MAPPING from
// "this one account/CDN is down" to "here is the exact list of things a kid or Dad will notice
// broken" — every entry carries its own `breaks` list for exactly that reason.
//
// SECRET HYGIENE (hard requirement, defense in depth):
//   1. Every probe writes its OWN `headline`/`detail` strings from status codes and a small
//      number of known, non-secret upstream fields (a byte count, a boolean, a status code) —
//      no probe ever forwards an upstream response body verbatim into the reply.
//   2. Every outgoing response ALSO passes through redactSecrets(), which scans the final JSON
//      text for the literal value of every secret env var this function reads (plus any minted
//      Google access token) and a stray "Bearer <token>" pattern, and blanks any match. This is
//      a backstop, not the primary mechanism — #1 should mean it never fires.
//
// CACHING: the whole `summary` payload is cached in Firestore at settings_fam2jan2g/opsHealth
// (10-minute TTL) and `firestore_usage` at settings_fam2jan2g/opsFirestoreUsage (24-hour TTL) —
// same "one settings doc, read-through cache" shape as farmgpt.mjs's storylog/dnd state and
// activity.mjs's stats prune. If Firestore itself is unreachable the cache is skipped
// entirely and the response is built from live probes instead — the cache is an optimization,
// never a dependency, per the house rule.
//
// Zero dependencies, hand-rolled JWT + Firestore REST — the house convention shared with
// activity.mjs / farmgpt.mjs / calendar.mjs / notify.mjs / news.mjs.
//
// Required env (both already set for the rest of the app): BUCKY_NOTIFY_SECRET,
// FIREBASE_SERVICE_ACCOUNT. Every OTHER env var this file reads is OPTIONAL — its absence is
// reported as a first-class "unconfigured" service row, never a crash or a 500.
//
// Test overrides (all optional; point the probes at fakes instead of the real internet):
//   HEALTH_ANTHROPIC_BASE, HEALTH_XAI_BASE, HEALTH_GEMINI_BASE, HEALTH_NETLIFY_BASE,
//   HEALTH_ELEVENLABS_BASE, HEALTH_TRIPO_BASE, HEALTH_FREE_OVERRIDES (JSON string, id -> url,
//   covers every "free" tier entry), HEALTH_FIRESTORE_BASE, HEALTH_GOOGLE_TOKEN_URL,
//   HEALTH_SELF_BASE_URL (defaults to the production site — where the "self" liveness probes
//   POST/GET their own sibling functions).

const ALLOWED_ORIGINS = new Set([
  "https://amenfarms.netlify.app",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
]);

const PROJECT_ID = "amen-farms-app";
const FAMILY_KEY = "fam2jan2g"; // roomId("amenfarms") — same constant goats.mjs/chorereminders.mjs hardcode.
const DEFAULT_FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const SETTINGS_COLLECTION = `settings_${FAMILY_KEY}`;

const PROBE_TIMEOUT_MS = 5000;               // per-registry-entry budget (summary probes run in parallel)
const CACHE_DEADLINE_MS = 4000;              // budget for the cache read/write around a summary/usage call
const COLLECTION_DEADLINE_MS = 8000;         // budget for one collection's up-to-5-page walk
const SUMMARY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const USAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const WARN_PCT = 80;          // a metered service crosses into "warn" above this % used
const LOW_CREDIT_BALANCE = 5; // Tripo credits at/under this are called out as low

// Every collection this family's app writes to. Mirrors the exact set referenced across
// index.html / farmgpt.mjs / activity.mjs / games.html — family-scoped ones carry the
// familyKey suffix, the rest (farmgpt_* / bucky_activity) are global collections.
const USAGE_COLLECTIONS = [
  `chores_${FAMILY_KEY}`,
  `settings_${FAMILY_KEY}`,
  "farmgpt_usage",
  "farmgpt_usage_hourly",
  "farmgpt_story_log",
  "farmgpt_dnd",
  "bucky_activity",
  `lobbies_${FAMILY_KEY}`,
  `notifs_${FAMILY_KEY}`,
  `pushTokens_${FAMILY_KEY}`,
];
const FREE_TIER_NOTE = "The Firebase Spark (free) plan includes 1 GiB of Firestore storage. "
  + "This total is MEASURED (summed JSON-serialized document lengths), not billed usage — a real "
  + "on-disk byte count from Google would differ slightly, but this is close enough to watch the trend.";

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://amenfarms.netlify.app";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

/* ---------------------------------------------------------------------------
   Secret hygiene: the final scrub every response passes through.
   --------------------------------------------------------------------------- */
const SECRET_ENV_KEYS = [
  "BUCKY_NOTIFY_SECRET", "ANTHROPIC_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY",
  "NETLIFY_API_TOKEN", "ELEVENLABS_API_KEY", "TRIPO_API_KEY", "FIREBASE_SERVICE_ACCOUNT",
];
function knownSecretValues() {
  const vals = [];
  for (const k of SECRET_ENV_KEYS) {
    const v = process.env[k];
    if (v && v.length >= 6) vals.push(v);
  }
  if (cachedGoogleToken && cachedGoogleToken.token && cachedGoogleToken.token.length >= 6) {
    vals.push(cachedGoogleToken.token);
  }
  return vals;
}
export function redactSecrets(text) {
  let out = String(text == null ? "" : text);
  for (const v of knownSecretValues()) out = out.split(v).join("[redacted]");
  // Belt-and-braces: a bearer token should never appear in a JSON body regardless of source.
  out = out.replace(/Bearer\s+[A-Za-z0-9\-_.]{10,}/g, "Bearer [redacted]");
  return out;
}
function json(obj, status, headers) {
  return new Response(redactSecrets(JSON.stringify(obj)), { status: status || 200, headers });
}

/* ---------------------------------------------------------------------------
   Fetch with a shared deadline. Never throws — every failure mode (network error, abort,
   timeout) comes back as a plain object so probes never need their own try/catch.
   --------------------------------------------------------------------------- */
function deadline(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}
async function timedFetch(url, opts, signal) {
  try {
    const r = await fetch(url, { ...(opts || {}), signal });
    const text = await r.text();
    return {
      ok: r.ok, status: r.status, text,
      contentType: r.headers.get("content-type") || "",
      contentLength: Number(r.headers.get("content-length") || 0),
    };
  } catch (e) {
    return { ok: false, status: 0, text: "", error: true, timeout: !!(signal && signal.aborted) };
  }
}

/* ---------------------------------------------------------------------------
   Google auth — hand-signed JWT, cached across warm invocations (the notify.mjs/activity.mjs
   technique). Self-contained per this repo's one-file-per-function convention.
   --------------------------------------------------------------------------- */
let cachedGoogleToken = null; // { token, exp(ms) }
function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function mintGoogleToken(sa, signal) {
  if (!sa) return null;
  if (cachedGoogleToken && Date.now() < cachedGoogleToken.exp - 60000) return cachedGoogleToken.token;
  let crypto;
  try { crypto = await import("node:crypto"); } catch { return null; }
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  let jwt;
  try {
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(header + "." + claims);
    jwt = header + "." + claims + "." + base64url(signer.sign(sa.private_key));
  } catch { return null; }
  const tokenUrl = process.env.HEALTH_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
  const r = await timedFetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  }, signal);
  if (!r.ok || r.status !== 200) return null;
  let j; try { j = JSON.parse(r.text); } catch { return null; }
  if (!j.access_token) return null;
  cachedGoogleToken = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cachedGoogleToken.token;
}

/* ---------------------------------------------------------------------------
   The Firestore-backed cache: one settings doc, { json: stringValue, at: integerValue }.
   --------------------------------------------------------------------------- */
function firestoreBase() {
  return process.env.HEALTH_FIRESTORE_BASE || DEFAULT_FIRESTORE_BASE;
}
async function readSettingsDoc(token, docId, signal) {
  const r = await timedFetch(`${firestoreBase()}/${SETTINGS_COLLECTION}/${docId}`,
    { headers: { authorization: `Bearer ${token}` } }, signal);
  if (!r.ok || r.status !== 200) return null;
  try {
    const j = JSON.parse(r.text);
    const f = j.fields || {};
    const raw = f.json && f.json.stringValue;
    const at = f.at ? parseInt(f.at.integerValue || "0", 10) : 0;
    if (!raw) return null;
    return { data: JSON.parse(raw), at: Number.isFinite(at) ? at : 0 };
  } catch { return null; }
}
async function writeSettingsDoc(token, docId, dataObj, signal) {
  const base = `projects/${PROJECT_ID}/databases/(default)/documents`;
  const body = {
    writes: [{
      update: {
        name: `${base}/${SETTINGS_COLLECTION}/${docId}`,
        fields: { json: { stringValue: JSON.stringify(dataObj) }, at: { integerValue: String(Date.now()) } },
      },
      updateMask: { fieldPaths: ["json", "at"] },
    }],
  };
  await timedFetch(`${firestoreBase()}:commit`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }, signal);
}

/* ---------------------------------------------------------------------------
   Result shape helpers — every probe returns one of these, then runProbe() merges in
   id/name/tier/breaks. Keeping the shape narrow is part of the secret-hygiene contract:
   a probe literally cannot smuggle an upstream body through, because it never gets handed
   a slot for one — only status/headline/detail/metric/configHint.
   --------------------------------------------------------------------------- */
function okResult(headline, detail, metric) { return { status: "ok", headline, detail, metric: metric || null }; }
function warnResult(headline, detail, metric) { return { status: "warn", headline, detail, metric: metric || null }; }
function downResult(headline, detail) { return { status: "down", headline, detail, metric: null }; }
function unconfiguredResult(configHint, detail) {
  return { status: "unconfigured", headline: "Not configured", detail: detail || "This isn't set up yet.", metric: null, configHint };
}
function round1(n) { return Math.round(n * 10) / 10; }

/* ---------------------------------------------------------------------------
   PAID tier probes.
   --------------------------------------------------------------------------- */
async function probeAnthropic(signal) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return unconfiguredResult("Set ANTHROPIC_API_KEY in Netlify (from console.anthropic.com).",
    "Required — without it, FarmGPT/stories/News summaries/etc. cannot call the model at all.");
  const base = process.env.HEALTH_ANTHROPIC_BASE || "https://api.anthropic.com";
  // GET /v1/models costs no tokens — this is deliberately NOT the same call as
  // probe_anthropic_credit, which is the one probe allowed to spend real money.
  const r = await timedFetch(`${base}/v1/models`,
    { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }, signal);
  if (r.timeout) return downResult("Timed out", `No response within ${PROBE_TIMEOUT_MS / 1000}s.`);
  if (r.error) return downResult("Unreachable", "Could not reach the Anthropic API.");
  if (r.status === 200) return okResult("Reachable", "The Anthropic API is responding normally.");
  if (r.status === 401) return downResult("Key rejected", "Anthropic rejected the API key (401) — it may be revoked or wrong.");
  return downResult("Error", `Anthropic responded with an unexpected status (${r.status}).`);
}

async function probeXai(signal) {
  const key = process.env.XAI_API_KEY;
  if (!key) return unconfiguredResult("Set XAI_API_KEY in Netlify (from console.x.ai).",
    "Optional — Story Time's Grok narrator experiment. Without it, Story Time quietly uses Claude Haiku instead; nothing breaks.");
  const base = process.env.HEALTH_XAI_BASE || "https://api.x.ai";
  const r = await timedFetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${key}` } }, signal);
  if (r.timeout) return downResult("Timed out", `No response within ${PROBE_TIMEOUT_MS / 1000}s.`);
  if (r.error) return downResult("Unreachable", "Could not reach the xAI API.");
  if (r.status === 200) return okResult("Reachable", "The xAI API is responding normally.");
  if (r.status === 401) return downResult("Key rejected", "xAI rejected the API key (401).");
  return downResult("Error", `xAI responded with an unexpected status (${r.status}).`);
}

async function probeGemini(signal) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return unconfiguredResult("Set GEMINI_API_KEY in Netlify (from Google AI Studio).",
    "Optional — AI-drawn Story Time pictures. Without it, Story Time quietly falls back to SVG drawings; nothing breaks.");
  const base = process.env.HEALTH_GEMINI_BASE || "https://generativelanguage.googleapis.com";
  const r = await timedFetch(`${base}/v1beta/models?key=${encodeURIComponent(key)}`, {}, signal);
  if (r.timeout) return downResult("Timed out", `No response within ${PROBE_TIMEOUT_MS / 1000}s.`);
  if (r.error) return downResult("Unreachable", "Could not reach the Gemini API.");
  if (r.status === 200) return okResult("Reachable", "The Gemini API is responding normally.");
  if (r.status === 400 || r.status === 401 || r.status === 403) return downResult("Key rejected", "Gemini rejected the API key.");
  return downResult("Error", `Gemini responded with an unexpected status (${r.status}).`);
}

async function probeNetlify(signal) {
  const token = process.env.NETLIFY_API_TOKEN;
  if (!token) return unconfiguredResult(
    "Create a Personal Access Token at app.netlify.com → User settings → Applications, add it as NETLIFY_API_TOKEN.",
    "Optional — not required for the site to run. Adding it lets this dashboard show bandwidth usage.");
  const base = process.env.HEALTH_NETLIFY_BASE || "https://api.netlify.com";
  const r = await timedFetch(`${base}/api/v1/accounts`, { headers: { authorization: `Bearer ${token}` } }, signal);
  if (r.timeout) return downResult("Timed out", `No response within ${PROBE_TIMEOUT_MS / 1000}s.`);
  if (r.error) return downResult("Unreachable", "Could not reach the Netlify API.");
  if (r.status === 401 || r.status === 403) return downResult("Token rejected", "Netlify rejected the API token.");
  if (r.status !== 200) return downResult("Error", `Netlify responded with an unexpected status (${r.status}).`);
  let accounts; try { accounts = JSON.parse(r.text); } catch { return warnResult("Connected", "Netlify responded, but the account list wasn't a shape this dashboard understands.", null); }
  const acct = Array.isArray(accounts) ? accounts[0] : null;
  if (!acct || !acct.slug) return okResult("Connected", "The Netlify token is valid.", null);

  const br = await timedFetch(`${base}/api/v1/accounts/${encodeURIComponent(acct.slug)}/bandwidth`,
    { headers: { authorization: `Bearer ${token}` } }, signal);
  if (br.ok && br.status === 200) {
    let bw; try { bw = JSON.parse(br.text); } catch { bw = null; }
    const used = bw && typeof bw.used === "number" ? bw.used : null;
    const included = bw && typeof bw.included === "number" ? bw.included : null;
    if (used != null && included) {
      const pct = round1((used / included) * 100);
      const metric = { used, limit: included, pct, unit: "bytes", periodEnd: (bw && bw.period_end_date) || null };
      if (pct > WARN_PCT) return { status: "warn", headline: `${Math.round(pct)}% of bandwidth used`, detail: "Bandwidth usage is getting high for this billing period.", metric, configHint: null };
      return { status: "ok", headline: "Connected", detail: "Bandwidth usage looks fine.", metric, configHint: null };
    }
  }
  // Report honestly rather than inventing fields — the exact usage endpoint shape isn't
  // guaranteed, so a connected-but-unrecognized response is still "ok", just without a metric.
  return okResult("Connected", "The Netlify token is valid; usage details weren't in the shape this dashboard expects — check the Netlify dashboard directly.", null);
}

async function probeFirebase(signal) {
  const sa = parseServiceAccount();
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return unconfiguredResult(
    "Set FIREBASE_SERVICE_ACCOUNT in Netlify (a Google Cloud service-account JSON key with Firestore + FCM access).",
    "Required — without it, nothing in the app syncs at all.");
  if (!sa) return downResult("Bad service account", "FIREBASE_SERVICE_ACCOUNT is set but isn't valid JSON.");
  const token = await mintGoogleToken(sa, signal);
  if (!token) return downResult("Auth failed", "Could not mint a Google access token from the service account.");
  const r = await timedFetch(`${firestoreBase()}/bucky_activity?pageSize=1`, { headers: { authorization: `Bearer ${token}` } }, signal);
  if (r.timeout) return downResult("Timed out", "Minted a token, but Firestore didn't respond in time.");
  if (r.error || r.status !== 200) return downResult("Read failed", `Minted a token, but a test Firestore read failed (HTTP ${r.status || "network error"}).`);

  let metric = null;
  try {
    const usage = await readSettingsDoc(token, "opsFirestoreUsage", signal);
    if (usage && usage.data) {
      metric = {
        totalDocs: usage.data.totalDocs != null ? usage.data.totalDocs : null,
        totalBytes: usage.data.totalBytes != null ? usage.data.totalBytes : null,
        measuredAt: usage.at,
        staleMs: Date.now() - usage.at,
      };
    }
  } catch { /* metric is just a nice-to-have here */ }
  return { status: "ok", headline: "Connected", detail: "The service account is valid and Firestore answered a real read.", metric, configHint: null };
}

async function probeElevenLabs(signal) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return unconfiguredResult("Set ELEVENLABS_API_KEY in Netlify (from elevenlabs.io).",
    "Optional, dev-time only — for generating NEW game audio. Everything already shipped keeps working without it.");
  const base = process.env.HEALTH_ELEVENLABS_BASE || "https://api.elevenlabs.io";
  const r = await timedFetch(`${base}/v1/user/subscription`, { headers: { "xi-api-key": key } }, signal);
  if (r.timeout) return downResult("Timed out", `No response within ${PROBE_TIMEOUT_MS / 1000}s.`);
  if (r.error) return downResult("Unreachable", "Could not reach ElevenLabs.");
  if (r.status === 401) return downResult("Key rejected", "ElevenLabs rejected the API key (401).");
  if (r.status !== 200) return downResult("Error", `ElevenLabs responded with an unexpected status (${r.status}).`);
  let j; try { j = JSON.parse(r.text); } catch { return warnResult("Connected", "ElevenLabs responded, but the usage shape wasn't understandable.", null); }
  const used = typeof j.character_count === "number" ? j.character_count : null;
  const limit = typeof j.character_limit === "number" ? j.character_limit : null;
  if (used != null && limit) {
    const pct = round1((used / limit) * 100);
    const metric = { used, limit, pct, unit: "characters" };
    if (pct > WARN_PCT) return { status: "warn", headline: `${Math.round(pct)}% of character quota used`, detail: "ElevenLabs usage is getting high for this period.", metric, configHint: null };
    return { status: "ok", headline: "Connected", detail: "Character usage looks fine.", metric, configHint: null };
  }
  return okResult("Connected", "The API key works.", null);
}

async function probeTripo(signal) {
  const key = process.env.TRIPO_API_KEY;
  if (!key) return unconfiguredResult("Set TRIPO_API_KEY in Netlify (from platform.tripo3d.ai).",
    "Optional, dev-time only — for generating NEW 3D models. Everything already shipped keeps working without it.");
  const base = process.env.HEALTH_TRIPO_BASE || "https://api.tripo3d.ai";
  const r = await timedFetch(`${base}/v2/openapi/user/balance`, { headers: { authorization: `Bearer ${key}` } }, signal);
  if (r.timeout) return downResult("Timed out", `No response within ${PROBE_TIMEOUT_MS / 1000}s.`);
  if (r.error) return downResult("Unreachable", "Could not reach Tripo.");
  if (r.status === 401) return downResult("Key rejected", "Tripo rejected the API key (401).");
  if (r.status !== 200) return downResult("Error", `Tripo responded with an unexpected status (${r.status}).`);
  let j; try { j = JSON.parse(r.text); } catch { return warnResult("Connected", "Tripo responded, but the balance shape wasn't understandable.", null); }
  const d = (j && j.data) || j || {};
  const balance = typeof d.balance === "number" ? d.balance : null;
  if (balance != null) {
    const metric = { balance, unit: "credits" };
    if (balance <= LOW_CREDIT_BALANCE) return { status: "warn", headline: `${balance} credits left`, detail: "Tripo credit balance is getting low.", metric, configHint: null };
    return { status: "ok", headline: `${balance} credits`, detail: "Connected; credit balance looks fine.", metric, configHint: null };
  }
  return okResult("Connected", "The API key works.", null);
}

/* ---------------------------------------------------------------------------
   FREE tier probes — keyless services the app depends on that can simply go dark.
   --------------------------------------------------------------------------- */
function freeOverrides() {
  try { return JSON.parse(process.env.HEALTH_FREE_OVERRIDES || "{}") || {}; } catch { return {}; }
}
function freeUrl(id, fallback) {
  const o = freeOverrides();
  return (o && typeof o[id] === "string" && o[id]) || fallback;
}

// The farm's own coordinates (727 Co Rd 80, Woodville AL) — same constant every page in this
// repo that talks to weather/radar APIs uses.
const FARM_LAT = 34.686537, FARM_LON = -86.210417;

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
  + `?latitude=${FARM_LAT}&longitude=${FARM_LON}`
  + "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,apparent_temperature"
  + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
  + "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FChicago&forecast_days=7";
const RAINVIEWER_URL = "https://api.rainviewer.com/public/weather-maps.json";
const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=1d";
const DOMPURIFY_URL = "https://cdn.jsdelivr.net/npm/dompurify@3.1.5/dist/purify.min.js";
const LEAFLET_JS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const PLAYROOM_URL = "https://unpkg.com/playroomkit@0.0.96/multiplayer.full.umd.js";
const GSTATIC_FIREBASE_URL = "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Roboto:wght@400;600;700;800;900&display=swap";

// weather.html's exact IEM HRRR tile convention — layer name MUST be uppercase "REFD" with a
// trailing "-0" run stamp; the lowercase form silently 200s with a baked-in error image at
// every coordinate instead of erroring (see CLAUDE.md). Reused verbatim, not reinvented.
function hrrrLayerName(offsetMin) {
  return "hrrr::REFD-F" + String(offsetMin).padStart(4, "0") + "-0";
}
function lonLatToTile(lon, lat, z) {
  const n = Math.pow(2, z);
  const x = Math.floor((lon + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}
function iemTileUrl() {
  const IEM_PROBE_ZOOM = 6;
  const { x, y } = lonLatToTile(FARM_LON, FARM_LAT, IEM_PROBE_ZOOM);
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${hrrrLayerName(0)}/${IEM_PROBE_ZOOM}/${x}/${y}.png`;
}

function classifyFree(r, validate) {
  if (r.timeout) return downResult("Timed out", `No response within ${PROBE_TIMEOUT_MS / 1000}s.`);
  if (r.error) return downResult("Unreachable", "The request failed before getting a response.");
  if (r.status < 200 || r.status >= 300) return downResult("Error", `Responded with HTTP ${r.status}.`);
  if (validate) {
    let good = false;
    try { good = !!validate(r); } catch { good = false; }
    if (!good) return downResult("Unexpected response", "Reachable, but the response didn't look right.");
  }
  return okResult("Reachable", "Responding normally.");
}
function makeFreeProbe(id, url, validate) {
  return async (signal) => {
    const r = await timedFetch(freeUrl(id, url), {}, signal);
    return classifyFree(r, validate);
  };
}
function softenToWarn(probeFn) {
  return async (signal) => {
    const r = await probeFn(signal);
    if (r.status === "down") return { ...r, status: "warn" };
    return r;
  };
}
function jsonHas(pathFn) {
  return (r) => { const j = JSON.parse(r.text); return pathFn(j); };
}

/* ---------------------------------------------------------------------------
   SELF tier — this site's own sibling functions. Every probe is chosen so it CANNOT spend
   money or send a real notification: a wrong-secret POST that the target rejects before doing
   anything expensive, or (for goats.mjs, which has no secret gate at all) a plain read of its
   already-public, free feed.
   --------------------------------------------------------------------------- */
function selfBaseUrl() {
  return process.env.HEALTH_SELF_BASE_URL || "https://amenfarms.netlify.app";
}
function selfProbe(fnName, okStatuses, opts) {
  const o = opts || {};
  const method = o.method || "POST";
  const bodyObj = o.body === undefined ? { secret: "__bucky_health_probe__", action: "__bucky_health_probe__" } : o.body;
  return async (signal) => {
    const url = `${selfBaseUrl()}/.netlify/functions/${fnName}`;
    const r = await timedFetch(url, {
      method,
      headers: method === "GET" ? undefined : { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(bodyObj),
    }, signal);
    if (r.timeout) return downResult("Timed out", `No response from ${fnName} within ${PROBE_TIMEOUT_MS / 1000}s.`);
    if (r.error) return downResult("Unreachable", `Could not reach the ${fnName} function.`);
    if (r.status === 404) return downResult("Not found", `The ${fnName} function did not respond (404) — check it's deployed.`);
    if (okStatuses.includes(r.status)) {
      if (o.validate) {
        let good = false;
        try { good = !!o.validate(r.text); } catch { good = false; }
        if (!good) return warnResult("Responding, unexpected body", `The ${fnName} function responded (HTTP ${r.status}) but its body wasn't the shape expected.`);
      }
      return okResult("Routed and running", `The ${fnName} function responded as expected (HTTP ${r.status}).`);
    }
    if (r.status >= 500) return downResult("Server error", `The ${fnName} function responded with a server error (HTTP ${r.status}).`);
    return warnResult("Unexpected status", `The ${fnName} function responded with HTTP ${r.status}, not the expected ${okStatuses.join("/")}.`);
  };
}
async function probeChoreReminders() {
  return { status: "unknown", headline: "Scheduled function", detail: "chorereminders is a scheduled function — it runs on its own timer (cron), not on a request. Check its logs in the Netlify dashboard for its last run.", metric: null, configHint: null };
}

/* ---------------------------------------------------------------------------
   THE REGISTRY. This mapping (what breaks when this is down) is the whole point.
   --------------------------------------------------------------------------- */
const REGISTRY = [
  // ---- paid, account-backed ----
  { id: "anthropic", name: "Anthropic (Claude)", tier: "paid", probe: probeAnthropic,
    breaks: ["FarmGPT research & stories", "TeacherGPT", "Dungeon", "News summaries", "Meal AI estimates"] },
  { id: "xai", name: "xAI (Grok)", tier: "paid", probe: probeXai,
    breaks: ["Story Time (Grok narrator experiment)"] },
  { id: "gemini", name: "Google Gemini", tier: "paid", probe: probeGemini,
    breaks: ["Story pictures (kid art)", "(fallbacks cover it — drawings still work)"] },
  { id: "netlify", name: "Netlify", tier: "paid", probe: probeNetlify,
    breaks: ["The whole site", "every function"] },
  { id: "firebase", name: "Firebase / Google Cloud", tier: "paid", probe: probeFirebase,
    breaks: ["All family data sync", "calendar", "push notifications", "activity dashboard"] },
  { id: "elevenlabs", name: "ElevenLabs", tier: "paid", probe: probeElevenLabs,
    breaks: ["Generating new game audio (dev-time only — shipped sounds keep working)"] },
  { id: "tripo", name: "Tripo (3D generation)", tier: "paid", probe: probeTripo,
    breaks: ["Generating new 3D models (dev-time only — shipped models keep working)"] },

  // ---- free, keyless ----
  { id: "openmeteo", name: "Open-Meteo", tier: "free",
    probe: makeFreeProbe("openmeteo", OPEN_METEO_URL, jsonHas((j) => j && j.current && typeof j.current.temperature_2m === "number")),
    breaks: ["The Weather page's forecast", "Home's weather card", "the near-farm rain line"] },
  { id: "rainviewer", name: "RainViewer (radar)", tier: "free",
    probe: makeFreeProbe("rainviewer", RAINVIEWER_URL, jsonHas((j) => j && j.radar && Array.isArray(j.radar.past))),
    breaks: ["Weather radar — past frames"] },
  { id: "iem_hrrr", name: "Iowa State Mesonet (HRRR radar)", tier: "free",
    probe: makeFreeProbe("iem_hrrr", iemTileUrl()),
    breaks: ["Weather radar — future (forecast) frames"] },
  { id: "yahoo_finance", name: "Yahoo Finance", tier: "free",
    probe: makeFreeProbe("yahoo_finance", YAHOO_URL, jsonHas((j) => !!(j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta))),
    breaks: ["The Home stock watchlist"] },
  { id: "jsdelivr", name: "jsDelivr CDN", tier: "free",
    probe: makeFreeProbe("jsdelivr", DOMPURIFY_URL),
    breaks: ["FarmGPT research view rendering (markdown + math)"] },
  { id: "unpkg_leaflet", name: "unpkg CDN (Leaflet)", tier: "free",
    probe: makeFreeProbe("unpkg_leaflet", LEAFLET_JS_URL),
    breaks: ["The weather radar map"] },
  { id: "unpkg_playroom", name: "unpkg CDN (Playroom Kit)", tier: "free",
    probe: makeFreeProbe("unpkg_playroom", PLAYROOM_URL),
    breaks: ["All online multiplayer (Farm Kart, Castle Kruzer, Farm Party, Hayhem, Barnyard Bistro)"] },
  { id: "gstatic_firebase", name: "Google gstatic CDN (Firebase SDK)", tier: "free",
    probe: makeFreeProbe("gstatic_firebase", GSTATIC_FIREBASE_URL),
    breaks: ["Cloud sync in the app shell (chores, bank, calendar — everything Firebase-backed)"] },
  { id: "google_fonts", name: "Google Fonts", tier: "free",
    probe: softenToWarn(makeFreeProbe("google_fonts", GOOGLE_FONTS_URL)),
    breaks: [] }, // cosmetic only — a "down" here is deliberately softened to "warn"

  // ---- self, this site's own functions ----
  { id: "farmgpt", name: "farmgpt function", tier: "self", probe: selfProbe("farmgpt", [401]),
    breaks: ["FarmGPT (research, Story Time, Dungeon, TeacherGPT setup)"] },
  { id: "news", name: "news function", tier: "self", probe: selfProbe("news", [401]),
    breaks: ["The family News feed"] },
  { id: "stocks", name: "stocks function", tier: "self", probe: selfProbe("stocks", [401]),
    breaks: ["The Home stock watchlist quotes"] },
  { id: "calendar", name: "calendar function", tier: "self", probe: selfProbe("calendar", [401]),
    breaks: ["The Plan area's family calendar"] },
  { id: "activity", name: "activity function", tier: "self", probe: selfProbe("activity", [401]),
    breaks: ["This dashboard's own usage tracking (the beacon has nowhere to log)"] },
  { id: "goats", name: "goats function", tier: "self",
    probe: selfProbe("goats", [200], { method: "GET", validate: (t) => { try { const j = JSON.parse(t); return Array.isArray(j.goats) && typeof j.count === "number"; } catch { return false; } } }),
    breaks: ["The public goat feed on the Amen Farms sales site"] },
  { id: "notify", name: "notify function", tier: "self", probe: selfProbe("notify", [403]),
    breaks: ["Push notifications (bank credits, lobby invites)"] },
  { id: "teachergpt-background", name: "teachergpt-background function", tier: "self",
    probe: selfProbe("teachergpt-background", [200, 202], { body: { secret: "__bucky_health_probe__", jobId: "healthprobe" } }),
    breaks: ["TeacherGPT quiz/test generation"] },
  { id: "chorereminders", name: "chorereminders (scheduled)", tier: "self", probe: probeChoreReminders,
    breaks: ["Scheduled chore-reminder pushes"] },
];

/* ---------------------------------------------------------------------------
   Running the registry.
   --------------------------------------------------------------------------- */
async function runProbe(entry) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  let result;
  try {
    result = await Promise.race([
      Promise.resolve(null).then(() => entry.probe(ctrl.signal))
        .catch(() => downResult("Probe error", "The check itself failed unexpectedly.")),
      new Promise((resolve) => {
        ctrl.signal.addEventListener("abort", () =>
          resolve(downResult("Timed out", `No response within ${PROBE_TIMEOUT_MS / 1000}s.`)));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  return {
    id: entry.id,
    name: entry.name,
    tier: entry.tier,
    status: (result && result.status) || "unknown",
    headline: (result && result.headline) || "",
    detail: (result && result.detail) || "",
    breaks: entry.breaks,
    metric: result && result.metric != null ? result.metric : null,
    configHint: result && result.configHint != null ? result.configHint : null,
  };
}

function tallyCounts(services) {
  const counts = { ok: 0, warn: 0, down: 0, unconfigured: 0, unknown: 0 };
  for (const s of services) counts[s.status] = (counts[s.status] || 0) + 1;
  return counts;
}

/* ---------------------------------------------------------------------------
   action: "summary"
   --------------------------------------------------------------------------- */
async function handleSummary(body) {
  const force = !!body.force;
  const sa = parseServiceAccount();
  let token = null;

  if (sa) {
    const d = deadline(CACHE_DEADLINE_MS);
    try { token = await mintGoogleToken(sa, d.signal); } catch { token = null; }
    d.done();
  }

  if (!force && token) {
    try {
      const d = deadline(CACHE_DEADLINE_MS);
      const cached = await readSettingsDoc(token, "opsHealth", d.signal);
      d.done();
      if (cached && Date.now() - cached.at < SUMMARY_CACHE_TTL_MS) {
        return { ...cached.data, cached: true, cachedUntil: cached.at + SUMMARY_CACHE_TTL_MS };
      }
    } catch { /* fall straight through to a live read — cache is never a dependency */ }
  }

  const services = await Promise.all(REGISTRY.map(runProbe));
  const generatedAt = Date.now();
  const payload = {
    ok: true,
    generatedAt,
    cachedUntil: generatedAt + SUMMARY_CACHE_TTL_MS,
    cached: false,
    counts: tallyCounts(services),
    services,
  };

  if (token) {
    try {
      const d = deadline(CACHE_DEADLINE_MS);
      await writeSettingsDoc(token, "opsHealth", payload, d.signal);
      d.done();
    } catch { /* the cache write is best-effort */ }
  }
  return payload;
}

/* ---------------------------------------------------------------------------
   action: "probe_anthropic_credit" — on demand only, never called from summary.
   --------------------------------------------------------------------------- */
async function handleProbeCredit() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: true, status: "unconfigured", detail: "ANTHROPIC_API_KEY is not set." };
  const base = process.env.HEALTH_ANTHROPIC_BASE || "https://api.anthropic.com";
  const d = deadline(PROBE_TIMEOUT_MS);
  const r = await timedFetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
  }, d.signal);
  d.done();

  if (r.timeout) return { ok: true, status: "down", detail: "No response within 5 seconds." };
  if (r.error) return { ok: true, status: "down", detail: "Could not reach the Anthropic API." };
  if (r.status === 200) return { ok: true, status: "ok", detail: "The API key works and the account has credit." };
  if (r.status === 401) return { ok: true, status: "key-bad", detail: "Anthropic rejected the API key (401)." };
  if (r.status === 400) {
    let j = null; try { j = JSON.parse(r.text); } catch {}
    const type = (j && j.error && j.error.type) || "";
    const msg = (j && j.error && j.error.message) || "";
    if (type === "invalid_request_error" && /credit balance/i.test(msg)) {
      return { ok: true, status: "credit-low", detail: "The Anthropic account's credit balance is too low." };
    }
    return { ok: true, status: "down", detail: "Anthropic responded with an unexpected error (400)." };
  }
  return { ok: true, status: "down", detail: `Anthropic responded with an unexpected status (${r.status}).` };
}

/* ---------------------------------------------------------------------------
   action: "firestore_usage"
   --------------------------------------------------------------------------- */
async function measureCollection(token, id) {
  const d = deadline(COLLECTION_DEADLINE_MS);
  let count = 0, bytes = 0, pageToken = "", truncated = false, ok = true;
  for (let page = 0; page < 5; page++) {
    const url = `${firestoreBase()}/${id}?pageSize=300` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const r = await timedFetch(url, { headers: { authorization: `Bearer ${token}` } }, d.signal);
    if (r.timeout) { truncated = page > 0 || !!pageToken; break; }
    if (r.error || r.status !== 200) { if (page === 0) ok = false; break; }
    let j; try { j = JSON.parse(r.text); } catch { break; }
    for (const doc of (j.documents || [])) {
      count++;
      try { bytes += Buffer.byteLength(JSON.stringify(doc), "utf8"); } catch {}
    }
    pageToken = j.nextPageToken || "";
    if (!pageToken) break;
    if (page === 4) truncated = true; // hit the hard 5-page cap with more still remaining
  }
  d.done();
  return { id, count, bytes, truncated, ok };
}

async function handleFirestoreUsage(body) {
  const force = !!body.force;
  const sa = parseServiceAccount();
  const emptyResult = (reason) => ({
    ok: false, reason, generatedAt: Date.now(), cachedUntil: 0, cached: false,
    collections: [], totalDocs: 0, totalBytes: 0, anyTruncated: false, note: FREE_TIER_NOTE,
  });
  if (!sa) return emptyResult(process.env.FIREBASE_SERVICE_ACCOUNT ? "bad-service-account" : "no-service-account");

  const d0 = deadline(CACHE_DEADLINE_MS);
  let token = null;
  try { token = await mintGoogleToken(sa, d0.signal); } catch { token = null; }
  d0.done();
  if (!token) return emptyResult("auth-failed");

  if (!force) {
    try {
      const d = deadline(CACHE_DEADLINE_MS);
      const cached = await readSettingsDoc(token, "opsFirestoreUsage", d.signal);
      d.done();
      if (cached && Date.now() - cached.at < USAGE_CACHE_TTL_MS) {
        return { ...cached.data, cached: true, cachedUntil: cached.at + USAGE_CACHE_TTL_MS };
      }
    } catch { /* fall through to a live measurement */ }
  }

  const collections = await Promise.all(USAGE_COLLECTIONS.map((id) => measureCollection(token, id)));
  const totalDocs = collections.reduce((s, c) => s + c.count, 0);
  const totalBytes = collections.reduce((s, c) => s + c.bytes, 0);
  const anyTruncated = collections.some((c) => c.truncated);
  const generatedAt = Date.now();
  const payload = {
    ok: true, generatedAt, cachedUntil: generatedAt + USAGE_CACHE_TTL_MS, cached: false,
    collections, totalDocs, totalBytes, anyTruncated, note: FREE_TIER_NOTE,
  };

  try {
    const d = deadline(CACHE_DEADLINE_MS);
    await writeSettingsDoc(token, "opsFirestoreUsage", payload, d.signal);
    d.done();
  } catch { /* best-effort */ }
  return payload;
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

  try {
    if (body.action === "summary") return json(await handleSummary(body), 200, headers);
    if (body.action === "probe_anthropic_credit") return json(await handleProbeCredit(), 200, headers);
    if (body.action === "firestore_usage") return json(await handleFirestoreUsage(body), 200, headers);
  } catch (e) {
    // Whatever happens inside a handler, the caller never sees a raw error — see the
    // "always degrade gracefully" posture documented at the top of this file.
    return json({ ok: false, error: "Internal error" }, 200, headers);
  }

  return json({ error: 'action must be "summary", "probe_anthropic_credit" or "firestore_usage"' }, 400, headers);
};

export const config = {
  path: "/.netlify/functions/health",
};
