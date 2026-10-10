// Netlify Function (ESM). GET /.netlify/functions/rgread?i=<season>/<issue>
//
// RoboGoat read log (Perry, 2026-10-10: "I want to log who actually reads the columns"; private,
// results on request). Every column page carries an invisible 1x1 <img> pointing here with its own
// issue path in `i`. The page has no script, so the READER comes from the Referer: the browser's
// default policy sends the full same-origin page URL, query included, and the links that know who
// is reading carry it there:
//   ?r=app<team>   the GFFL app's RoboGoat card (assets/league/lg-ui.js, the device's team)
//   ?r=push<team>  the league push (notify.mjs readTag: each device's own team)
// Anything else (the email link, the archive, a shared link, a stripped Referer) logs as "direct"
// with no team: counted, not named.
//
// One document per read in gffl_<fam>, kind "rgread": { kind, issue, via, team, t }. A create is a
// masked PATCH with currentDocument.exists=false (the house rule: masked writes only), so two
// reads can never overwrite each other. Nothing else is stored: no IP, no user agent.
//
// Always answers 200 with a 1x1 GIF, whatever happens, so a page never shows a broken image and a
// failed write costs the reader nothing. Link-preview bots (by user agent) are not logged.
//
// Env: FIREBASE_SERVICE_ACCOUNT. Optional RGREAD_FAMILY_KEY (default "fam2jan2g").
// Test overrides (tools/_verify-rgread.mjs): RGREAD_FIRESTORE_BASE, RGREAD_TOKEN_URL,
// RGREAD_TEST_NOW_MS, RGREAD_FETCH_TIMEOUT_MS.

const PROJECT_ID = "amen-farms-app";
const DEFAULT_FAMILY_KEY = "fam2jan2g"; // roomId("amenfarms"), the league collection's key
const SCOPE = "https://www.googleapis.com/auth/datastore";
const FIRESTORE_BASE = () =>
  process.env.RGREAD_FIRESTORE_BASE ||
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_URL = () => process.env.RGREAD_TOKEN_URL || "https://oauth2.googleapis.com/token";
const FETCH_TIMEOUT_MS = () => Number(process.env.RGREAD_FETCH_TIMEOUT_MS) || 3000;
const now = () => Number(process.env.RGREAD_TEST_NOW_MS) || Date.now();

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const ISSUE_RE = /^\d{4}\/week-\d{1,2}(?:-preview)?$/;
const TAG_RE = /^(app|push)(\d{1,2})$/;
const HOSTS = new Set(["goatfantasyleague.com", "www.goatfantasyleague.com", "amenfarms.netlify.app"]);
const BOT_RE = /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|embedly|whatsapp|discord|telegram|skypeuripreview|feedfetcher|google-?read|preview/i;

// The read a request describes, or null when it should not be logged.
//   url      the beacon request's own URL (carries i)
//   referer  the page that loaded it (carries r, when a tagged link was used)
//   ua       user agent, only to skip link-preview bots
export function parseRead(url, referer, ua) {
  let issue;
  try { issue = (new URL(url).searchParams.get("i") || "").replace(/^\/+|\/+$/g, ""); } catch { return null; }
  if (!ISSUE_RE.test(issue)) return null;
  if (ua && BOT_RE.test(ua)) return null;
  let via = "direct", team = null;
  try {
    const r = new URL(referer);
    // The tag only counts on the issue's own page: a tag on some other page's URL says nothing
    // about who read this one.
    if (HOSTS.has(r.hostname) && r.pathname.replace(/\/+$/, "") === "/robogoat/" + issue) {
      const m = TAG_RE.exec(r.searchParams.get("r") || "");
      if (m && Number(m[2]) >= 1 && Number(m[2]) <= 20) { via = m[1]; team = Number(m[2]); }
    }
  } catch { /* no or bad Referer: direct */ }
  return { issue, via, team };
}

// Firestore REST fields for a read. Whole numbers are integerValue decimal strings (CLAUDE.md: a JS
// number there is refused).
export function readFields(read, t) {
  return {
    kind: { stringValue: "rgread" },
    issue: { stringValue: read.issue },
    via: { stringValue: read.via },
    team: read.team == null ? { nullValue: null } : { integerValue: String(read.team) },
    t: { integerValue: String(t) },
  };
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
let cached = null; // { token, exp } — a warm function reuses its token
async function accessToken(sa) {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const crypto = await import("node:crypto");
  const nowSec = Math.floor(Date.now() / 1000);
  const claims = { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL(), iat: nowSec, exp: nowSec + 3600 };
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64url(signer.sign(sa.private_key))}`;
  const r = await fetch(TOKEN_URL(), {
    method: "POST", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS()),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`token ${r.status}`);
  cached = { token: j.access_token, exp: Date.now() + 3500_000 };
  return cached.token;
}

// One create; true when Firestore accepted it.
export async function logRead(read, t, sa, familyKey) {
  const token = await accessToken(sa);
  const id = `rgread_${t}_${Math.random().toString(36).slice(2, 8)}`;
  const fields = readFields(read, t);
  const mask = Object.keys(fields).map((f) => "updateMask.fieldPaths=" + f).join("&");
  const url = `${FIRESTORE_BASE()}/gffl_${encodeURIComponent(familyKey)}/${id}?${mask}&currentDocument.exists=false`;
  const r = await fetch(url, {
    method: "PATCH", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS()),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  return r.ok;
}

const gif = () => new Response(GIF, {
  status: 200,
  headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0", "Content-Length": String(GIF.length) },
});

export default async (req) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return gif();
    const read = parseRead(req.url, req.headers.get("referer") || "", req.headers.get("user-agent") || "");
    if (!read || req.method === "HEAD" || !process.env.FIREBASE_SERVICE_ACCOUNT) return gif();
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    await logRead(read, now(), sa, process.env.RGREAD_FAMILY_KEY || DEFAULT_FAMILY_KEY);
  } catch { /* the log is bookkeeping; the reader still gets the pixel */ }
  return gif();
};

export const config = {
  path: "/.netlify/functions/rgread",
};
