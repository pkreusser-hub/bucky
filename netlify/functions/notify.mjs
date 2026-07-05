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
const ALLOWED_URL_ORIGIN = "https://amenfarms.netlify.app";

// Validates the optional deep-link `url`: must start with the allowlisted origin, or be a
// relative path (in which case we prefix the origin ourselves). Anything else falls back
// to DEFAULT_URL so a bad/absolute non-allowlisted url can never smuggle in an open redirect.
function resolveUrl(url) {
  if (typeof url !== "string" || !url) return DEFAULT_URL;
  if (url.startsWith(ALLOWED_URL_ORIGIN)) return url;
  if (url.startsWith("/")) return ALLOWED_URL_ORIGIN + url;
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

// Reads device push tokens for `targetUser` from Firestore's REST API,
// via a structured query against pushTokens_<familyKey>.
async function getDeviceTokens(accessToken, familyKey, targetUser) {
  const url = `${FIRESTORE_BASE}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: `pushTokens_${familyKey}` }],
      where: {
        fieldFilter: {
          field: { fieldPath: "user" },
          op: "EQUAL",
          value: { stringValue: targetUser },
        },
      },
    },
  };

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

  const { secret, familyKey, targetUser, title, body, url } = payload || {};

  if (!process.env.BUCKY_NOTIFY_SECRET || secret !== process.env.BUCKY_NOTIFY_SECRET) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers });
  }

  if (!familyKey || !targetUser || !title) {
    return new Response(
      JSON.stringify({ error: "Missing required field(s): familyKey, targetUser, title" }),
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
    const tokens = await getDeviceTokens(accessToken, familyKey, targetUser);

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
