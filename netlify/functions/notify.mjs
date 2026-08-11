// BUCKY — push notification sender.
//
// Netlify Function (ESM). POST JSON: { secret, familyKey, targetUser, title, body, url }
//
// Flow:
//   1. Validate the shared family secret + CORS origin.
//   2. Mint a Google OAuth2 access token from a service account, by hand-signing
//      a JWT with Node's built-in `crypto` module (RS256) — no googleapis /
//      google-auth-library dependency needed, so Netlify's bundler has nothing
//      extra to pull in.
//   3. Exchange that JWT for an access token at Google's OAuth token endpoint.
//   4. Read device push tokens for the target user from Firestore via its
//      REST API (so we don't need the Firestore Admin SDK either).
//   5. Send one FCM HTTP v1 message per token. Any token FCM reports as
//      404/UNREGISTERED gets deleted from Firestore (self-pruning).
//
// Required environment variables (set in Netlify site settings):
//   BUCKY_NOTIFY_SECRET      - shared passphrase the client must send back
//   FIREBASE_SERVICE_ACCOUNT - the full service-account JSON, stringified
//
// See PUSH_SETUP.md for how to obtain/configure these.

const PROJECT_ID = "amen-farms-app";
const ALLOWED_ORIGINS = new Set([
  "https://amenfarms.netlify.app",
  // S4 (2026-08-10): the GFFL league is the SAME Netlify site under a domain alias, so its
  // calls are same-origin and never actually preflight — these are here so a cross-origin
  // call from the league (a future subdomain, a local alias) isn't refused by surprise.
  "https://goatfantasyleague.com",
  "https://www.goatfantasyleague.com",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
]);

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
// needs BOTH scopes: messaging to send pushes, datastore to read/prune token docs
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore";
const FCM_SEND_URL = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;

const DEFAULT_URL = "https://amenfarms.netlify.app";
// The origin a BARE-RELATIVE deep link is resolved against. Every index.html call site passes
// a path ("index.html#calendar"), so this stays the family app's own origin — a relative link
// is by definition a link to the app that sent it, and only the family app sends relative ones.
const ALLOWED_URL_ORIGIN = "https://amenfarms.netlify.app";
// S4 (2026-08-10). The GFFL league installs as its OWN app on its own domain, so a league push
// whose tap target is forced back to amenfarms.netlify.app lands the reader in the FAMILY app
// instead of the installed league one — the deep link would be thrown away at the last step, the
// same failure the bare-relative branch below was added to fix. So the allowlist becomes a SET.
// It is still compared by PARSED ORIGIN, never a string prefix, and anything not in the set
// still falls back to DEFAULT_URL: widening WHICH origins are allowed does not widen HOW.
const ALLOWED_URL_ORIGINS = new Set([
  ALLOWED_URL_ORIGIN,
  "https://goatfantasyleague.com",
  "https://www.goatfantasyleague.com",
]);

// Validates the optional deep-link `url`: must start with the allowlisted origin, or be a
// relative path (in which case we prefix the origin ourselves). Anything else falls back
// to DEFAULT_URL so a bad/absolute non-allowlisted url can never smuggle in an open redirect.
// Turns a caller-supplied deep link into an absolute same-origin URL, or falls back to the site
// root. This is an ALLOWLIST guarding against an open redirect — a push notification's tap target
// must never be able to leave amenfarms.netlify.app. Widen it only with an equally strict pattern.
//
// The bare-relative branch exists because EVERY call site in index.html passes a path like
// "index.html#calendar" (bank credits, calendar events, work orders). Those matched no branch and
// silently fell through to DEFAULT_URL, so tapping any push notification opened the home page
// instead of the section it was about — the deep link was being thrown away at the last step.
function resolveUrl(url) {
  if (typeof url !== "string" || !url) return DEFAULT_URL;
  // Compare the PARSED ORIGIN, never a string prefix. "https://amenfarms.netlify.app.evil.com/x"
  // passes a startsWith() check — an attacker registers that subdomain and the allowlist waves the
  // redirect through. (This endpoint is gated only by the family password, which ships in
  // client-side JS, so the caller is not meaningfully trusted.)
  try { if (ALLOWED_URL_ORIGINS.has(new URL(url).origin)) return url; } catch { /* not absolute — fall through */ }
  // "//host" is protocol-relative (leaves the site); backslashes are a known normalisation trick.
  if (url.startsWith("//") || url.includes("\\")) return DEFAULT_URL;
  if (url.startsWith("/")) return ALLOWED_URL_ORIGIN + url;
  // A bare page path, optionally with ?query / #hash. Anything carrying a scheme (https:, data:,
  // javascript:) fails this pattern, so a relative link can never become an off-site redirect.
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*\.html(?:[?#][^\s]*)?$/.test(url)) return ALLOWED_URL_ORIGIN + "/" + url;
  return DEFAULT_URL;
}

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://amenfarms.netlify.app";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Mints a short-lived Google OAuth2 access token from a service account,
// using the JWT Bearer flow (RFC 7523) signed with RS256 via Node `crypto`.
async function getGoogleAccessToken(serviceAccount) {
  const crypto = await import("node:crypto");

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: FCM_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSec,
    exp: nowSec + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error(`OAuth token exchange failed: ${resp.status} ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// Reads device push tokens from Firestore's REST API, via a structured query against
// pushTokens_<familyKey>.
//
// `sel` is one of:
//   { user: "Isaac" }        the family app's targeting, unchanged — a server-side fieldFilter
//   { gfflTeam: 5 }          S4: every device that enabled LEAGUE alerts as team 5
//   { gfflAll: true }        S4: every device that enabled league alerts at all
//   { gfflAll: true, excludeTeam: 5 }   …minus the team whose own client is sending
//
// The two league selectors are filtered IN CODE off an unfiltered query rather than by a
// fieldFilter, deliberately. A `gfflTeam` fieldFilter has to name a value TYPE, and the Firestore
// JS SDK (which is what push-client.js writes the doc with) picks integerValue vs doubleValue by
// the number it is handed — a mismatch there returns zero rows silently, which is the worst
// possible failure for a notification path. "Field exists" has no clean structured-query form at
// all. The collection is one family's phones (a dozen docs at the outside), so reading it whole
// costs nothing and cannot be wrong about a type.
async function getDeviceTokens(accessToken, familyKey, sel) {
  const url = `${FIRESTORE_BASE}:runQuery`;
  const structuredQuery = { from: [{ collectionId: `pushTokens_${familyKey}` }] };
  if (sel.user) {
    structuredQuery.where = {
      fieldFilter: { field: { fieldPath: "user" }, op: "EQUAL", value: { stringValue: sel.user } },
    };
  }
  const body = { structuredQuery };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const rows = await resp.json();
  if (!resp.ok) {
    throw new Error(`Firestore query failed: ${resp.status} ${JSON.stringify(rows)}`);
  }

  const results = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const doc = row.document;
    if (!doc) continue; // rows with no `document` are just query metadata
    const fields = doc.fields || {};
    const token = fields.token && fields.token.stringValue;
    if (!token) continue;
    // A number lands as integerValue OR doubleValue depending on how it was written; read both
    // and compare as numbers, so the type the SDK happened to choose can never matter.
    const rawTeam = fields.gfflTeam;
    const team = rawTeam == null ? null
      : rawTeam.integerValue != null ? Number(rawTeam.integerValue)
      : rawTeam.doubleValue != null ? Number(rawTeam.doubleValue)
      : rawTeam.stringValue != null ? Number(rawTeam.stringValue)
      : null;
    if (sel.gfflTeam != null && team !== Number(sel.gfflTeam)) continue;
    if (sel.gfflAll) {
      if (team == null || Number.isNaN(team)) continue; // never enabled league alerts
      if (sel.excludeTeam != null && team === Number(sel.excludeTeam)) continue;
    }
    // doc.name looks like: projects/.../documents/pushTokens_fam123/<docId>
    const parts = doc.name.split("/");
    const docId = parts[parts.length - 1];
    results.push({ docId, token });
  }
  return results;
}

async function deleteTokenDoc(accessToken, familyKey, docId) {
  const url = `${FIRESTORE_BASE}/pushTokens_${familyKey}/${docId}`;
  await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function sendFcmMessage(accessToken, token, title, body, url) {
  // DATA-ONLY message: if we sent a `notification` payload, the browser's FCM layer
  // would auto-display it AND our service worker would display it — two tray entries
  // per event, which made launcher icon badges climb forever. Data-only means the
  // service worker's showNotification (with its replace-don't-stack tag) is the
  // single source of truth for what sits in the tray.
  const message = {
    message: {
      token,
      data: { title: String(title), body: String(body), url: resolveUrl(url) },
      webpush: {
        headers: { Urgency: "high" },
      },
    },
  };

  const resp = await fetch(FCM_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
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

export default async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  }

  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers });
  }

  const { secret, familyKey, targetUser, title, body, url, gfflTeam, gfflAll, excludeTeam } = payload || {};

  if (!process.env.BUCKY_NOTIFY_SECRET || secret !== process.env.BUCKY_NOTIFY_SECRET) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers });
  }

  // Exactly one audience. `targetUser` is the family app's (a person's name); `gfflTeam` /
  // `gfflAll` are S4's (a league team, or every device with league alerts on).
  const sel = targetUser ? { user: targetUser }
    : gfflTeam != null ? { gfflTeam }
    : gfflAll ? { gfflAll: true, excludeTeam: excludeTeam == null ? null : excludeTeam }
    : null;

  if (!familyKey || !sel || !title) {
    return new Response(
      JSON.stringify({ error: "Missing required field(s): familyKey, title, and one of targetUser / gfflTeam / gfflAll" }),
      { status: 400, headers }
    );
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    return new Response(
      JSON.stringify({ error: "Server misconfigured: FIREBASE_SERVICE_ACCOUNT not set" }),
      { status: 500, headers }
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Server misconfigured: FIREBASE_SERVICE_ACCOUNT is not valid JSON" }),
      { status: 500, headers }
    );
  }

  try {
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const tokens = await getDeviceTokens(accessToken, familyKey, sel);

    let sent = 0;
    let pruned = 0;

    for (const { docId, token } of tokens) {
      const result = await sendFcmMessage(accessToken, token, title, body || "", url);
      if (result.ok) {
        sent += 1;
      } else if (isUnregistered(result)) {
        await deleteTokenDoc(accessToken, familyKey, docId);
        pruned += 1;
      }
    }

    return new Response(JSON.stringify({ sent, pruned }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }), {
      status: 500,
      headers,
    });
  }
};

export const config = {
  path: "/.netlify/functions/notify",
};
