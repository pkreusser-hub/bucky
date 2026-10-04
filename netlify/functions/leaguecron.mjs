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
// 2026-10-04 review fixes (this file): (1) a sent-marker doc, leaguecron_sent_<fam>/<Central
// date>, created with currentDocument.exists=false BEFORE any send, so a retried or duplicated
// platform fire — or a hand GET of the URL — cannot push the league twice; (2) the wording
// follows the week's real claims doc (processed flag) instead of promising a result nobody has
// computed yet, and a week with no claims sends nothing; (3) the season end derives from the
// league's own seasonWeeks instead of a hardcoded 14 + 3; (4) FCM sends run 8 at a time; (5) each
// send is logged to pushlog_<fam>/<year> so per-team volume can be counted.
//
// Required env (same Firebase project as everything else): FIREBASE_SERVICE_ACCOUNT.
// Optional: LEAGUECRON_FAMILY_KEY (defaults to the production family key — the same
//   roomId("amenfarms") = "fam2jan2g" that chorereminders.mjs defaults to and
//   assets/league/lg-core.js derives as LG.famKey).
// Test overrides (used only by tools/_verify-leaguecron.mjs's in-process harness):
//   LEAGUECRON_TEST_NOW_MS   - fixed "now" in ms since epoch
//   LEAGUECRON_FORCE         - "1" bypasses every guard (scheduled-slot, season start/end, and
//                               the rules-customized skip below)
//   LEAGUECRON_FIRESTORE_BASE, LEAGUECRON_TOKEN_URL, LEAGUECRON_FCM_BASE, LEAGUECRON_FETCH_TIMEOUT_MS

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

// Every upstream fetch below carries this deadline (found in review, 2026-09-23: none of them
// had one at all). Without it, one hung call — Google's token endpoint, the Firestore query, or
// any single device's FCM send — blocks forever; the loop below never reaches the rest of the
// tokens, and this scheduled function eventually gets force-killed by the platform having sent
// nobody. Netlify's own function ceiling is the budget (sports.mjs's FETCH_TIMEOUT_MS states
// the same "~10s function kill" reasoning); a dozen tokens sent SEQUENTIALLY means the per-call
// budget has to be short enough that a few genuine hangs still leave room for the rest of the
// run, not just short enough for one. 4s matches this file's OWN measured shape: one token
// exchange + one Firestore query + (with fix 2) one rules-doc read + up to ~a dozen FCM sends +
// the rare unregistered-token delete — a real call each of these makes finishes in well under a
// second, so 4s is purely the hang ceiling, never a bound a healthy call would brush.
const FETCH_TIMEOUT_MS = Number(process.env.LEAGUECRON_FETCH_TIMEOUT_MS) || 4000;

// Absolute, on the LEAGUE's own installed-app origin — matches LG.pushLink() in
// assets/league/lg-core.js exactly. A relative link would resolve against notify.mjs's family
// origin and open the wrong installed PWA (see CLAUDE.md's "THE INSTALL COLLISION" entry — the
// league and the family app are two separately-installable PWAs on two different origins now).
const DEEP_LINK = "https://goatfantasyleague.com/league.html#moves";
const TITLE = "GFFL waivers";
// Processing is LAZY — the first league phone opened after the deadline runs the engine
// (lg-core.js processWaivers) — so at 08:00 nobody has necessarily run it. The wording follows
// the week's claims doc: `processed` true says so, anything else says only that they are ready.
const BODY_PROCESSED = "Waivers ran — open GFFL to see your claims.";
const BODY_PENDING = "Waivers are ready to run — open GFFL.";
const PUSH_TAG = "gffl-waivers"; // per-kind tray tag, same scheme as notify.mjs
const SEND_CONCURRENCY = 8;
const PUSHLOG_CAP = 300;

// ---- SEASON GUARD (start AND end) ----
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

// THE OTHER END OF THE SEASON (found in review, 2026-09-23): this guard had a start but no end
// — with nothing to stop it, the Wednesday nudge would keep firing every week from January
// clear through next preseason. It was first a hardcoded 2026-12-30 (14 regular weeks + 3
// playoff weeks); the 2026-10-04 review noted that a commissioner who changes seasonWeeks would
// leave that date wrong, so it now DERIVES from the league's own settings doc (read once per run,
// see readLeagueSettings):
//
//   last scoring week = rules.seasonWeeks + 3   (lg-core.js buildBracket: "Three playoff weeks,
//                                                seasonWeeks+1..+3"; rules.playoffs.startWeek is
//                                                declared but nothing reads it)
//   week N starts on SEASON_START + (N-1)*7 calendar days (a Tuesday); its waiver Wednesday is
//   the day after, 08:00 Central, resolved through Intl so DST is whatever the calendar says.
//
// Defaults (seasonWeeks 14) give week 17 -> Tuesday 2026-12-29 -> Wednesday 2026-12-30 08:00 CST
// (-06:00, past the 2026-11-01 fall-back) = 2026-12-30T14:00Z, the old constant exactly. AT that
// instant the run still proceeds (`>` below); the next Wednesday and every one after no-ops.
const SEASON_START = "2026-09-08"; // LG.SEASON_START (a Tuesday — week 1's own start)
const SEASON = SEASON_START.slice(0, 4);
const DEFAULT_SEASON_WEEKS = 14;
const PLAYOFF_WEEKS = 3;
// lg-core.js clamps currentWeek() to 18, so no week past 18 exists whatever the settings say.
// Used as a pre-guard that needs no Firestore read at all.
const HARD_LAST_WEEK = 18;

// America/Chicago wall clock -> instant, DST-aware via Intl (two passes, like lg-core's
// chiInstant, in case the first lands on the other side of a shift).
function chiOffsetMs(ms) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms))) parts[p.type] = parseInt(p.value, 10);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(ms / 1000) * 1000;
}
function chiInstant(y, m, d, hh, mm) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  let t = guess - chiOffsetMs(guess);
  t = guess - chiOffsetMs(t);
  return t;
}
// The Tuesday 05:00 Central that starts league week `week`, and that week's Wednesday 08:00.
function seasonDay(nDays) {
  const p = SEASON_START.split("-").map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + nDays * 86400000);
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}
function weekStartMs(week) {
  const [y, m, d] = seasonDay((week - 1) * 7);
  return chiInstant(y, m, d, 5, 0);
}
function waiverWedMs(week) {
  const [y, m, d] = seasonDay((week - 1) * 7 + 1);
  return chiInstant(y, m, d, 8, 0);
}
function leagueWeek(now) {
  let w = 1 + Math.floor((now.getTime() - weekStartMs(1)) / (7 * 24 * 3600 * 1000));
  w = Math.max(1, Math.min(HARD_LAST_WEEK, w));
  while (w > 1 && now.getTime() < weekStartMs(w)) w--;
  while (w < HARD_LAST_WEEK && now.getTime() >= weekStartMs(w + 1)) w++;
  return w;
}

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
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
// Returns a Map<token, {docIds, team}> rather than a flat array — deliberate DEDUPE BY TOKEN. A device
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
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
    // Same mute rule as notify.mjs: missing gfflMutes means ON. This cron is
    // the Wednesday waiver nudge, so a device that muted "waivers" is skipped.
    const rawMutes = fields.gfflMutes;
    const muteVals = rawMutes && rawMutes.arrayValue && rawMutes.arrayValue.values;
    let mutedWaivers = false;
    if (Array.isArray(muteVals)) {
      for (const v of muteVals) {
        if (v && v.stringValue === "waivers") { mutedWaivers = true; break; }
      }
    }
    if (mutedWaivers) continue;
    const parts = doc.name.split("/");
    const docId = parts[parts.length - 1];
    const team = raw.integerValue != null ? Number(raw.integerValue)
      : raw.doubleValue != null ? Number(raw.doubleValue) : Number(raw.stringValue);
    if (!byToken.has(token)) byToken.set(token, { docIds: [], team });
    byToken.get(token).docIds.push(docId);
  }
  return byToken;
}

async function deleteTokenDoc(accessToken, familyKey, docId) {
  await fetch(`${FIRESTORE_BASE()}/pushTokens_${familyKey}/${docId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function sendFcmMessage(accessToken, token, body) {
  // Data-only message — same rationale as notify.mjs/chorereminders.mjs: the service worker's
  // showNotification (with its replace-don't-stack tag) is the single source of truth for the
  // tray entry, so we never send a `notification` payload (the browser's FCM layer would ALSO
  // auto-display it, doubling every tray entry).
  const message = {
    message: {
      token,
      data: { title: TITLE, body, url: DEEP_LINK, tag: PUSH_TAG },
      webpush: { headers: { Urgency: "high" } },
    },
  };
  const resp = await fetch(FCM_SEND_URL(), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
// See THE OTHER END OF THE SEASON above for the arithmetic. `>` (not `>=`) so the boundary Wednesday
// itself — the championship week's own waiver run — still sends, matching seasonStarted's own
// inclusive boundary.
function seasonEnded(now, seasonWeeks) {
  if (process.env.LEAGUECRON_FORCE === "1") return false;
  return now.getTime() > waiverWedMs(seasonWeeks + PLAYOFF_WEEKS);
}

// ---- RULES GUARD (found in review, 2026-09-23) ----
// The season-guard comment above explains why this file avoids the rules doc for TIMING the
// season's START — that reasoning still holds (nothing here decodes draftAt). The season END is the
// one exception, added 2026-10-04: it needs rules.seasonWeeks (see THE OTHER END OF THE SEASON),
// and it rides the same single read as this guard. The guard itself is a narrower read: the commissioner can
// repoint WHEN waivers process at all (rules.waivers.processDow/processHour — lg-ui.js's rules
// editor ~7439, the engine's own LG.waiverDeadline ~lg-core.js:3583), and this cron is
// hardcoded to fire Wednesday 8 AM regardless (netlify.toml's cron string, unrelated to the
// rules doc). If the family ever moves claims off Wed/8, this nudge would tell them "waivers
// have processed" on a day that is no longer the real deadline — the one thing this courtesy
// push must never do. That risk (a wrong, confident push) is worth the one extra Firestore GET
// the risk of the OLD guard (a wrong season-length guess) was not: this read is a single
// document by id, no query, no pagination, and its own failure mode is spelled out below —
// never a reason to skip, only ever a reason to fall back to the old always-Wed/8 assumption.
//
// 2026-10-04: the same single read now also returns rules.seasonWeeks (for the season end), so
// there is still exactly ONE settings GET per run. Every failure keeps today's behaviour:
// not customized, the default 14 weeks.
async function readLeagueSettings(accessToken, familyKey) {
  const dflt = { customized: false, seasonWeeks: DEFAULT_SEASON_WEEKS };
  if (process.env.LEAGUECRON_FORCE === "1") return dflt;
  try {
    const url = `${FIRESTORE_BASE()}/gffl_${encodeURIComponent(familyKey)}/settings`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // No settings doc yet, or a read that failed outright: nothing on record says the family
    // customized anything, so the default Wed/8 stands and the nudge sends — the SAME "keep
    // today's behaviour" fallback a thrown error (network, timeout, bad JSON) hits below.
    if (resp.status === 404) return dflt;
    if (!resp.ok) return dflt;
    const j = await resp.json();
    const numField = (f) => (f && f.integerValue != null) ? Number(f.integerValue)
      : (f && f.doubleValue != null) ? Number(f.doubleValue) : null;
    const rf = j && j.fields && j.fields.rules && j.fields.rules.mapValue && j.fields.rules.mapValue.fields;
    if (!rf) return dflt;
    const sw = numField(rf.seasonWeeks);
    const seasonWeeks = sw != null && Number.isFinite(sw) && sw >= 1 && sw <= HARD_LAST_WEEK - PLAYOFF_WEEKS ? sw : DEFAULT_SEASON_WEEKS;
    const wf = rf.waivers && rf.waivers.mapValue && rf.waivers.mapValue.fields;
    if (!wf) return { customized: false, seasonWeeks }; // no waivers override -> defaults apply
    const dow = numField(wf.processDow);
    const hour = numField(wf.processHour);
    return { customized: (dow != null && dow !== 3) || (hour != null && hour !== 8), seasonWeeks };
  } catch {
    return dflt; // read failed (network, timeout, malformed JSON) -> keep today's behaviour: send
  }
}

// This week's claims doc (gffl_<fam>/claims_<season>_w<N>): how many claims, and whether the
// engine has run. null = the read FAILED (unknown); {count: 0} = no doc / no claims.
async function readClaims(accessToken, familyKey, week) {
  try {
    const url = `${FIRESTORE_BASE()}/gffl_${encodeURIComponent(familyKey)}/claims_${SEASON}_w${week}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (resp.status === 404) return { count: 0, processed: false };
    if (!resp.ok) return null;
    const j = await resp.json();
    const f = (j && j.fields) || {};
    const vals = f.claims && f.claims.arrayValue && f.claims.arrayValue.values;
    return { count: Array.isArray(vals) ? vals.length : 0, processed: !!(f.processed && f.processed.booleanValue === true) };
  } catch {
    return null;
  }
}

// ---- Sent-marker: leaguecron_sent_<fam>/<Central date> ----
// Created with currentDocument.exists=false, so exactly one invocation per day wins. Firestore
// answers a create-over-existing with 409 ALREADY_EXISTS; that is the "someone already sent"
// signal. Any OTHER failure is not proof of anything, and sending without a marker is how a
// double push happens — so it fails closed (no send) and says so.
function centralDateKey(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}
async function claimMarker(accessToken, familyKey, dateKey, week, nowMs) {
  const resp = await fetch(
    `${FIRESTORE_BASE()}/leaguecron_sent_${encodeURIComponent(familyKey)}/${encodeURIComponent(dateKey)}` +
      "?currentDocument.exists=false&updateMask.fieldPaths=at&updateMask.fieldPaths=week",
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { at: { integerValue: String(nowMs) }, week: { integerValue: String(week) } } }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  );
  if (resp.ok) return "claimed";
  if (resp.status === 409) return "exists";
  return "error";
}

// ---- Push log: pushlog_<fam>/<year>.entries, newest last, capped (see notify.mjs) ----
async function appendPushLog(accessToken, familyKey, entries, nowMs) {
  if (!entries.length) return false;
  const url = `${FIRESTORE_BASE()}/pushlog_${encodeURIComponent(familyKey)}/${new Date(nowMs).getUTCFullYear()}`;
  const auth = { Authorization: `Bearer ${accessToken}` };
  const wrap = (e) => ({ mapValue: { fields: {
    t: { integerValue: String(Math.round(e.t)) },
    kind: { stringValue: String(e.kind) },
    team: { integerValue: String(Math.round(e.team)) },
  } } });
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: auth, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    let cur = [], pre;
    if (r.status === 404) pre = "currentDocument.exists=false";
    else if (r.ok) {
      const j = await r.json();
      cur = (j.fields && j.fields.entries && j.fields.entries.arrayValue && j.fields.entries.arrayValue.values) || [];
      pre = "currentDocument.updateTime=" + encodeURIComponent(j.updateTime);
    } else return false;
    const values = cur.concat(entries.map(wrap)).slice(-PUSHLOG_CAP);
    const w = await fetch(`${url}?updateMask.fieldPaths=entries&${pre}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { entries: { arrayValue: { values } } } }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (w.ok) return true;
    if (w.status !== 409 && w.status !== 400) return false;
  }
  return false;
}

async function forEachBounded(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await fn(item); } catch { /* next item */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export default async () => {
  const now = new Date(nowMs());
  const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } });

  if (!isScheduledSlot(now)) return json({ sent: 0, skipped: true, reason: "not-a-scheduled-slot" });
  if (!seasonStarted(now)) return json({ sent: 0, skipped: true, reason: "before-first-waiver-week" });
  // No read needed to know nothing past the hard week cap exists; the settings-derived end
  // (which can only be EARLIER or the same for a shorter season) is checked after the read below.
  if (seasonEnded(now, HARD_LAST_WEEK - PLAYOFF_WEEKS)) return json({ sent: 0, skipped: true, reason: "after-last-waiver-week" });

  const familyKey = process.env.LEAGUECRON_FAMILY_KEY || DEFAULT_FAMILY_KEY;

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    return json({ sent: 0, skipped: true, reason: "FIREBASE_SERVICE_ACCOUNT not set" }, 500);
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    return json({ sent: 0, skipped: true, reason: "FIREBASE_SERVICE_ACCOUNT is not valid JSON" }, 500);
  }

  try {
    const accessToken = await getGoogleAccessToken(serviceAccount);

    const settings = await readLeagueSettings(accessToken, familyKey);
    if (seasonEnded(now, settings.seasonWeeks)) return json({ sent: 0, skipped: true, reason: "after-last-waiver-week" });
    if (settings.customized) return json({ sent: 0, skipped: true, reason: "waiver-schedule-customized" });

    // What the push may truthfully say, and whether there is anything to say at all. FORCE
    // (a test/hand run) skips the read and takes the generic wording.
    const week = leagueWeek(now);
    let claims = { count: 1, processed: false };
    if (process.env.LEAGUECRON_FORCE !== "1") {
      claims = await readClaims(accessToken, familyKey, week);
      if (!claims) return json({ sent: 0, skipped: true, reason: "claims-read-failed" });
      if (!claims.count) return json({ sent: 0, skipped: true, reason: "no-claims" });
    }
    const body = claims.processed ? BODY_PROCESSED : BODY_PENDING;

    const byToken = await getGfflDeviceTokens(accessToken, familyKey);

    // Idempotency: one winner per Central day. Only claimed when there is someone to send to, so
    // an empty run does not burn the day.
    if (byToken.size) {
      const claim = await claimMarker(accessToken, familyKey, centralDateKey(now.getTime()), week, now.getTime());
      if (claim === "exists") return json({ sent: 0, skipped: true, reason: "already-sent" });
      if (claim === "error") return json({ sent: 0, skipped: true, reason: "marker-write-failed" }, 500);
    }

    let sent = 0, pruned = 0;
    const logEntries = [];
    await forEachBounded([...byToken.entries()], SEND_CONCURRENCY, async ([token, { docIds, team }]) => {
      let result;
      try {
        result = await sendFcmMessage(accessToken, token, body);
      } catch {
        return; // a single send's failure (network, or our own timeout) never sinks the rest of the run
      }
      if (result.ok) {
        sent += 1;
        if (Number.isFinite(team)) logEntries.push({ t: Date.now(), kind: "waivers", team });
      } else if (isUnregistered(result)) {
        for (const docId of docIds) {
          try { await deleteTokenDoc(accessToken, familyKey, docId); }
          catch { /* a prune that fails to land is not fatal — the next run tries again */ }
        }
        pruned += docIds.length;
      }
      // any other failure (rate limit, transient 5xx, malformed token, ...) is left alone —
      // never pruned on a guess, and never allowed to stop the loop over the remaining tokens.
    });
    if (logEntries.length) {
      await Promise.race([
        appendPushLog(accessToken, familyKey, logEntries, now.getTime()).catch(() => false),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
    }

    return json({ sent, skipped: false, reason: null, tokens: byToken.size, pruned, week, processed: claims.processed });
  } catch (err) {
    return json({ sent: 0, skipped: false, reason: String((err && err.message) || err) }, 500);
  }
};

// The cron schedule lives in netlify.toml ([functions."leaguecron"].schedule =
// "0 13,14 * * 3") — two UTC fires every Wednesday (one per DST state), whose single intended
// send is selected by isScheduledSlot() above. Declared in ONE place (the toml) to avoid a
// conflicting dual declaration, same convention as chorereminders.mjs.
