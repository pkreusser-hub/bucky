// BUCKY — GFFL scheduled waiver-processing nudge (S5, ffleague-plan.md).
//
// A Netlify Scheduled Function that fires weekly (Wednesdays ~8:00 AM Central) and sends ONE
// push to every device that has GFFL league alerts enabled: "waivers have processed, open the
// app for your results." This function NEVER writes a single league document — it is a
// courtesy nudge, nothing more.
//
// WHY NOT PORT processWaivers HERE (plan §S5, verbatim rationale): the tempting design — run the
// FAAB/priority engine server-side on a cron — is the wrong one before a season. It would
// duplicate the exact engine the client suite (`_verify-gffl.cjs`) verifies, creating drift risk
// in the code we can least afford to get wrong, weeks before kickoff. The engine
// (`LG.processWaivers` in assets/league/lg-core.js) is already idempotent and
// any-client-carries-the-league-forward (any device that opens the app after the deadline runs
// it; re-running an already-processed week is a safe no-op) — so this cron's only job is to get
// SOMEONE to open the app. Whichever client does runs the real engine seconds later, and that
// engine already sends the per-owner RESULT pushes (S4's waiver-results producer,
// LG.pushTeam/LG.pushNotify in lg-core.js). v2 (server-side processing) is explicitly deferred
// to post-season-start per the plan's ORDER AND CALENDAR table.
//
// Self-contained per the repo's one-file-per-function convention — mirrors
// netlify/functions/chorereminders.mjs's shape (Central-band guard over a cross-product cron)
// almost exactly. Neither notify.mjs nor lg-core.js is imported; the tiny service-account JWT /
// FCM sender is duplicated inline, same as every other scheduled function in this repo.
//
// Required env (same Firebase project as everything else): FIREBASE_SERVICE_ACCOUNT.
// Optional: LEAGUECRON_FAMILY_KEY (defaults to the production family key — the same
//   roomId("amenfarms") = "fam2jan2g" that chorereminders.mjs defaults to and
//   assets/league/lg-core.js derives as LG.famKey).
// Test overrides (used only by tools/_verify-leaguecron.mjs's in-process harness):
//   LEAGUECRON_TEST_NOW_MS   - fixed "now" in ms since epoch
//   LEAGUECRON_FORCE         - "1" bypasses BOTH the scheduled-slot guard and the season guard
//   LEAGUECRON_FIRESTORE_BASE, LEAGUECRON_TOKEN_URL, LEAGUECRON_FCM_BASE

const PROJECT_ID = "amen-farms-app";
const DEFAULT_FAMILY_KEY = "fam2jan2g"; // roomId("amenfarms") — same default as chorereminders.mjs

const FIRESTORE_BASE = () =>
  process.env.LEAGUECRON_FIRESTORE_BASE ||
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_URL = () => process.env.LEAGUECRON_TOKEN_URL || "https://oauth2.googleapis.com/token";
const FCM_SEND_URL = () =>
  (process.env.LEAGUECRON_FCM_BASE || `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}`) + "/messages:send";

const FCM_SCOPE =
  "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore";

// Absolute, on the LEAGUE's own installed-app origin — matches LG.pushLink() in
// assets/league/lg-core.js exactly. A relative link would resolve against notify.mjs's family
// origin and open the wrong installed PWA (see CLAUDE.md's "THE INSTALL COLLISION" entry — the
// league and the family app are two separately-installable PWAs on two different origins now).
const DEEP_LINK = "https://goatfantasyleague.com/league.html#moves";
const TITLE = "GFFL waivers";
const BODY = "Waiver claims have processed — open the app for your results.";

// ---- SEASON GUARD ----
// DECISION (documented per the build brief's "your call"): a hardcoded instant, not a live read
// of the league's `settings`/rules doc. Considered and rejected: the rules doc has no
// season-start field at all — the only date it carries is `rules.draftAt`, buried two levels
// deep in a Firestore mapValue (doc.fields.rules.mapValue.fields.draftAt.stringValue), and
// decoding that correctly is real surface area for a guard this function's own spec says is
// explicitly NOT scoring-critical ("the cron never touches league docs"). It would also couple
// this file's correctness to assets/league/lg-core.js's rules-doc shape, which a different,
// concurrently-active agent owns and can change without this file knowing. A constant is
// auditable in one line and matches the plan's own stated dates exactly.
//
// ffleague-plan.md's ORDER AND CALENDAR table states it plainly: "season start 2026-09-08,
// first waiver Wed is 2026-09-09" — the very next day (LG.SEASON_START in lg-core.js is that
// Tuesday; the league's default rules.waivers = {processDow: 3 /* Wed */, processHour: 8}).
// 8:00 AM Central, carrying its own UTC offset so the comparison is unambiguous regardless of
// what timezone this function happens to run in.
const FIRST_WAIVER_WED_MS = new Date("2026-09-09T08:00:00-05:00").getTime();

// ---- Google token (hand-signed JWT, RS256) — identical technique to chorereminders.mjs ----
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

// ---- Firestore: every device with GFFL league alerts enabled (any team) ----
// Mirrors notify.mjs's `gfflAll` selector, including WHY it filters in code over an unfiltered
// query rather than by a Firestore fieldFilter: gfflTeam's stored value TYPE is whatever the
// writing SDK (push-client.js, via the browser's Firestore SDK) picked — integerValue vs
// doubleValue — and a mismatched fieldFilter returns zero rows SILENTLY, which is the worst
// possible failure for a notification path. The collection is one family's phones (a dozen docs
// at the outside), so an unfiltered read costs nothing.
//
// Returns a Map<token, docId[]> rather than a flat array — deliberate DEDUPE BY TOKEN. A device
// is represented by exactly one doc under push-client.js's own convention (docId = a hash of the
// token), but nothing here should assume that invariant always holds — two docs sharing one
// physical token must still only receive ONE push, and if that token turns out to be
// unregistered every docId that shared it is pruned together, not just the first one found.
async function getGfflDeviceTokens(accessToken, familyKey) {
  const url = `${FIRESTORE_BASE()}:runQuery`;
  const body = { structuredQuery: { from: [{ collectionId: `pushTokens_${familyKey}` }] } };
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const rows = await resp.json();
  if (!resp.ok) throw new Error(`Firestore token query failed: ${resp.status} ${JSON.stringify(rows)}`);
  const byToken = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const doc = row.document;
    if (!doc) continue; // query-metadata-only rows carry no `document`
    const fields = doc.fields || {};
    const token = fields.token && fields.token.stringValue;
    if (!token) continue;
    const raw = fields.gfflTeam;
    const hasTeam = !!raw && (raw.integerValue != null || raw.doubleValue != null || raw.stringValue != null);
    if (!hasTeam) continue; // family-only device (chores/bank alerts) — never in the GFFL audience
    const parts = doc.name.split("/");
    const docId = parts[parts.length - 1];
    if (!byToken.has(token)) byToken.set(token, []);
    byToken.get(token).push(docId);
  }
  return byToken;
}

async function deleteTokenDoc(accessToken, familyKey, docId) {
  await fetch(`${FIRESTORE_BASE()}/pushTokens_${familyKey}/${docId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function sendFcmMessage(accessToken, token) {
  // Data-only message — same rationale as notify.mjs/chorereminders.mjs: the service worker's
  // showNotification (with its replace-don't-stack tag) is the single source of truth for the
  // tray entry, so we never send a `notification` payload (the browser's FCM layer would ALSO
  // auto-display it, doubling every tray entry).
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
  const t = Number(process.env.LEAGUECRON_TEST_NOW_MS);
  return Number.isFinite(t) && t > 0 ? t : Date.now();
}
// Central (America/Chicago) minutes-past-midnight, DST-aware via Intl (never hand-rolled offset
// math — the whole point of a Central-band guard is that DST just works because Intl knows the
// real rule, the same technique chorereminders.mjs uses).
function centralMinutes(now) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  let hh = parseInt(parts.hour, 10);
  if (hh === 24) hh = 0; // some engines emit 24 for midnight
  return hh * 60 + parseInt(parts.minute, 10);
}
function centralWeekdayIsWed(now) {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(now);
  return wd === "Wed";
}
const TARGET_CENTRAL_MIN = 8 * 60; // 8:00 AM
// The cron fires on the hour, at BOTH UTC 13:00 and UTC 14:00 every Wednesday (see
// netlify.toml) — one candidate for each DST state. DST shifts Central time by exactly 60
// minutes, so the two candidate fires are always 60 minutes apart in Central time and can never
// both land inside this band together. Any window under 60 min is safe; 20 gives slack for a
// slightly-late invocation without ever letting the "wrong" DST candidate through.
const CENTRAL_MATCH_WINDOW = 20;
// DEFENSIVE, beyond the literal spec: also require Central weekday === Wednesday. The cron
// itself already restricts firing to Wednesdays (day-of-week 3 in the toml), but
// chorereminders.mjs's own precedent is to have the HANDLER independently guard against a
// stray/manual invocation at an odd time rather than trust the schedule alone — so a
// hand-triggered run on any other day, at any hour, is a safe no-op rather than a surprise push.
function isScheduledSlot(now) {
  if (process.env.LEAGUECRON_FORCE === "1") return true;
  if (!centralWeekdayIsWed(now)) return false;
  const cm = centralMinutes(now);
  let d = Math.abs(cm - TARGET_CENTRAL_MIN);
  d = Math.min(d, 1440 - d); // wrap around midnight
  return d <= CENTRAL_MATCH_WINDOW;
}
function seasonStarted(now) {
  if (process.env.LEAGUECRON_FORCE === "1") return true;
  return now.getTime() >= FIRST_WAIVER_WED_MS;
}

export default async () => {
  const now = new Date(nowMs());

  if (!isScheduledSlot(now)) {
    return new Response(JSON.stringify({ sent: 0, skipped: true, reason: "not-a-scheduled-slot" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  if (!seasonStarted(now)) {
    return new Response(JSON.stringify({ sent: 0, skipped: true, reason: "before-first-waiver-week" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const familyKey = process.env.LEAGUECRON_FAMILY_KEY || DEFAULT_FAMILY_KEY;

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    return new Response(JSON.stringify({ sent: 0, skipped: true, reason: "FIREBASE_SERVICE_ACCOUNT not set" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    return new Response(JSON.stringify({ sent: 0, skipped: true, reason: "FIREBASE_SERVICE_ACCOUNT is not valid JSON" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const byToken = await getGfflDeviceTokens(accessToken, familyKey);

    let sent = 0, pruned = 0;
    for (const [token, docIds] of byToken) {
      let result;
      try {
        result = await sendFcmMessage(accessToken, token);
      } catch {
        continue; // a single send's network failure never sinks the rest of the run
      }
      if (result.ok) {
        sent += 1;
      } else if (isUnregistered(result)) {
        for (const docId of docIds) await deleteTokenDoc(accessToken, familyKey, docId);
        pruned += docIds.length;
      }
      // any other failure (rate limit, transient 5xx, malformed token, ...) is left alone —
      // never pruned on a guess, and never allowed to stop the loop over the remaining tokens.
    }

    return new Response(
      JSON.stringify({ sent, skipped: false, reason: null, tokens: byToken.size, pruned }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ sent: 0, skipped: false, reason: String((err && err.message) || err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

// The cron schedule lives in netlify.toml ([functions."leaguecron"].schedule =
// "0 13,14 * * 3") — two UTC fires every Wednesday (one per DST state), whose single intended
// send is selected by isScheduledSlot() above. Declared in ONE place (the toml) to avoid a
// conflicting dual declaration, same convention as chorereminders.mjs.
