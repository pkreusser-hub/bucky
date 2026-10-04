// BUCKY — GFFL lineup warning push (2026-10-04, push review: feature).
//
// Netlify SCHEDULED function. About 90 minutes before an NFL kickoff, finds every GFFL team's
// STARTER in that game who is Out / on IR / Doubtful / PUP / suspended / NFI, and pushes ONLY
// that team's linked devices: "Terry McLaurin is Out and in your lineup. Kickoff 12:00 PM."
// A starter whose team is on a BYE gets the same push (without a kickoff).
//
// WHY THIS EXISTS: real week-4 data (2026-10-04) had ESKY starting Terry McLaurin (Out since
// 12:13Z) and KRUZ starting Jadarian Price (Out, then IR on 10-03); week 2 had ESKY starting an
// inactive Puka Nacua. The app already KNOWS (injstate_<season>) — nobody was told in time.
//
// WHAT IT READS, all cheap — never the 14 MB Sleeper dump:
//   - ESPN's NFL scoreboard for the league week (kickoff instants; a team in no event is on a bye)
//   - gffl_<fam> roster docs for the week (kind == roster AND week == N): who STARTS (slot not
//     BENCH / IR) and each player's key, name and NFL team
//   - gffl_<fam>/injstate_<season>: the app's own committed designation per player key (p_<key>)
//   - pushTokens_<fam>: the team's devices (gfflTeam), minus any that muted "lineup"
//   - gffl_<fam>/settings: rules.seasonWeeks, only to know when the league's season is over
// It writes ONLY its own bookkeeping: lineupwarn_sent_<fam>/<season>_w<N>_t<team>_<key> (the
// once-per-player-per-week marker) and pushlog_<fam>/<year> (the per-team push log).
//
// NOT COVERED, on purpose: "inactive" (ESPN publishes the inactive list only ~90 minutes out and
// not in the scoreboard; an inactive player is nearly always already designated Out, which this
// does catch), and eliminated teams in the playoff weeks (they still hold a roster doc).
//
// CRON: netlify.toml runs this every 15 minutes across the UTC hours that cover Central
// 05:00-20:00 in BOTH DST states. The handler warns for events whose kickoff is 75-105 minutes
// away — a window twice the cadence, so one skipped fire cannot lose a slot — and the sent-marker
// is what stops the second tick from repeating it. Kickoff instants come from ESPN in UTC and
// are only FORMATTED in America/Chicago (Intl), so DST (2026-11-01) cannot shift them; the league
// week boundary (Tuesday 05:00 Central) goes through the same Intl resolution as leaguecron.mjs.
//
// Env: FIREBASE_SERVICE_ACCOUNT. Optional LINEUPWARN_FAMILY_KEY (default "fam2jan2g").
// Test overrides (tools/_verify-lineupwarn.mjs): LINEUPWARN_TEST_NOW_MS, LINEUPWARN_FIRESTORE_BASE,
// LINEUPWARN_TOKEN_URL, LINEUPWARN_FCM_BASE, LINEUPWARN_ESPN_BASE, LINEUPWARN_FETCH_TIMEOUT_MS.

const PROJECT_ID = "amen-farms-app";
const DEFAULT_FAMILY_KEY = "fam2jan2g";
const SEASON_START = "2026-09-08"; // LG.SEASON_START — a Tuesday, week 1's own start
const SEASON = SEASON_START.slice(0, 4);
const DEFAULT_SEASON_WEEKS = 14;
const PLAYOFF_WEEKS = 3;
const HARD_LAST_WEEK = 18; // lg-core.js clamps currentWeek() to 18
const WINDOW_MIN_MS = 75 * 60 * 1000;
const WINDOW_MAX_MS = 105 * 60 * 1000;
const SEND_CONCURRENCY = 8;
const PUSHLOG_CAP = 300;
const KIND = "lineup";
const TITLE = "GFFL lineup";
const DEEP_LINK = "https://goatfantasyleague.com/league.html#matchup";
const ESPN_UA = "curl/8.6.0"; // site.api.espn.com's edge 403s browser UAs from datacenters (sports.mjs)

const FIRESTORE_BASE = () =>
  process.env.LINEUPWARN_FIRESTORE_BASE ||
  `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_URL = () => process.env.LINEUPWARN_TOKEN_URL || "https://oauth2.googleapis.com/token";
const FCM_SEND_URL = () =>
  (process.env.LINEUPWARN_FCM_BASE || `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}`) + "/messages:send";
const ESPN_BASE = () => process.env.LINEUPWARN_ESPN_BASE || "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const FCM_SCOPE =
  "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore";
const FETCH_TIMEOUT_MS = Number(process.env.LINEUPWARN_FETCH_TIMEOUT_MS) || 4000;

// ---- Google token (hand-signed JWT) — same technique as leaguecron.mjs ----
function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function getGoogleAccessToken(serviceAccount) {
  const crypto = await import("node:crypto");
  const nowSec = Math.floor(Date.now() / 1000);
  const claims = { iss: serviceAccount.client_email, scope: FCM_SCOPE, aud: TOKEN_URL(), iat: nowSec, exp: nowSec + 3600 };
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64url(signer.sign(serviceAccount.private_key))}`;
  const resp = await fetch(TOKEN_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) throw new Error(`OAuth token exchange failed: ${resp.status} ${JSON.stringify(data)}`);
  return data.access_token;
}

// ---- time: the league week, through Intl (same resolution as leaguecron.mjs / lg-core.js) ----
function nowMs() {
  const t = Number(process.env.LINEUPWARN_TEST_NOW_MS);
  return Number.isFinite(t) && t > 0 ? t : Date.now();
}
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
function weekStartMs(week) {
  const p = SEASON_START.split("-").map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + (week - 1) * 7 * 86400000);
  return chiInstant(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), 5, 0);
}
function leagueWeek(ms) {
  let w = 1 + Math.floor((ms - weekStartMs(1)) / (7 * 24 * 3600 * 1000));
  w = Math.max(1, Math.min(HARD_LAST_WEEK, w));
  while (w > 1 && ms < weekStartMs(w)) w--;
  while (w < HARD_LAST_WEEK && ms >= weekStartMs(w + 1)) w++;
  return w;
}
function kickoffText(ms) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(ms)).replace(/\s/g, " "); // newer ICU puts a narrow no-break space before PM
}

// ---- who counts as unavailable ----
// The app stores injstate designations as display labels (OUT, IR, D, Q, PUP, SUS, NFI, NA, COV);
// a roster doc's own `injury` can still carry a raw word. One normalizer reads both. Q is NOT
// warned (a Q plays most weeks — the warning would be noise), and NA / COV are the ambiguous
// Sleeper codes the app's own IR rule also declines to treat as "out".
const DESIG = {
  out: "OUT", o: "OUT",
  ir: "IR", injuredreserve: "IR", injuryreserve: "IR",
  doubtful: "D", d: "D",
  pup: "PUP", nfi: "NFI",
  sus: "SUS", susp: "SUS", suspended: "SUS", suspension: "SUS",
};
function desigOf(raw) {
  const k = String(raw == null ? "" : raw).toLowerCase().replace(/[^a-z]/g, "");
  return DESIG[k] || "";
}
const DESIG_WORDS = { OUT: "is Out", IR: "is on IR", D: "is Doubtful", PUP: "is on PUP", SUS: "is suspended", NFI: "is on NFI" };

// ESPN's abbreviations differ from the ones a roster row may carry (Sleeper-seeded rows).
const TEAM_ALIAS = { WAS: "WSH", JAC: "JAX", LA: "LAR", ARZ: "ARI", BLT: "BAL", CLV: "CLE", HST: "HOU", SD: "LAC", OAK: "LV",
  STL: "LAR", NWE: "NE", NOR: "NO", SFO: "SF", TAM: "TB", GNB: "GB", KAN: "KC", LVR: "LV" };
const normTeam = (t) => { const u = String(t || "").trim().toUpperCase(); return TEAM_ALIAS[u] || u; };

// ---- ESPN: kickoffs and byes ----
// Returns { events: [{ms, teams:[abbr,...]}], playing: Set<abbr> } or null when the feed is
// unusable. A BYE is only ever inferred from a plausibly COMPLETE slate (>= 8 events): a short
// or empty feed must not turn every starter into a bye.
async function fetchSlate(week) {
  const url = `${ESPN_BASE()}/scoreboard?week=${week}&seasontype=2&dates=${SEASON}`;
  const resp = await fetch(url, { headers: { "User-Agent": ESPN_UA, Accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) return null;
  const j = await resp.json();
  const events = [], playing = new Set();
  for (const e of (j && j.events) || []) {
    const ms = Date.parse(e.date);
    const comp = e.competitions && e.competitions[0];
    const teams = ((comp && comp.competitors) || []).map((c) => normTeam(c.team && c.team.abbreviation)).filter(Boolean);
    if (!Number.isFinite(ms) || teams.length < 2) continue;
    const state = e.status && e.status.type && e.status.type.state;
    for (const t of teams) playing.add(t);
    events.push({ ms, teams, pre: state === "pre" });
  }
  return { events, playing, complete: events.length >= 8 };
}

// ---- Firestore reads ----
const authH = (t) => ({ Authorization: `Bearer ${t}` });
async function fsQuery(accessToken, structuredQuery) {
  const resp = await fetch(`${FIRESTORE_BASE()}:runQuery`, {
    method: "POST",
    headers: { ...authH(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const rows = await resp.json();
  if (!resp.ok) throw new Error(`Firestore query failed: ${resp.status} ${JSON.stringify(rows)}`);
  return (Array.isArray(rows) ? rows : []).map((r) => r.document).filter(Boolean);
}
const sv = (f) => (f && f.stringValue != null ? f.stringValue : "");
const iv = (f) => (f && f.integerValue != null ? Number(f.integerValue) : f && f.doubleValue != null ? Number(f.doubleValue) : null);

async function readRosters(accessToken, familyKey, week) {
  // Both filters are equalities, so no composite index is needed. `week` is an INTEGER value:
  // a doubleValue/stringValue here would match nothing, silently (the type trap leaguecron's
  // token read documents) — the app writes it with integerValue.
  const docs = await fsQuery(accessToken, {
    from: [{ collectionId: `gffl_${familyKey}` }],
    where: { compositeFilter: { op: "AND", filters: [
      { fieldFilter: { field: { fieldPath: "kind" }, op: "EQUAL", value: { stringValue: "roster" } } },
      { fieldFilter: { field: { fieldPath: "week" }, op: "EQUAL", value: { integerValue: String(week) } } },
    ] } },
  });
  const out = [];
  for (const d of docs) {
    const f = d.fields || {};
    const id = d.name.split("/").pop();
    if (!id.startsWith(`roster_${SEASON}_w${week}_t`)) continue; // an old season's week-N doc
    const teamId = iv(f.teamId);
    const vals = f.players && f.players.arrayValue && f.players.arrayValue.values;
    if (teamId == null || !Array.isArray(vals)) continue;
    const players = vals.map((v) => {
      const m = (v.mapValue && v.mapValue.fields) || {};
      return { key: sv(m.key), name: sv(m.name), slot: sv(m.slot), team: sv(m.team), injury: sv(m.injury) };
    });
    out.push({ teamId, players });
  }
  return out;
}
async function readInjState(accessToken, familyKey) {
  try {
    const r = await fetch(`${FIRESTORE_BASE()}/gffl_${encodeURIComponent(familyKey)}/injstate_${SEASON}`,
      { headers: authH(accessToken), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) return {};
    const j = await r.json();
    return (j && j.fields) || {};
  } catch { return {}; }
}
async function readSeasonWeeks(accessToken, familyKey) {
  try {
    const r = await fetch(`${FIRESTORE_BASE()}/gffl_${encodeURIComponent(familyKey)}/settings`,
      { headers: authH(accessToken), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) return DEFAULT_SEASON_WEEKS;
    const j = await r.json();
    const f = j && j.fields && j.fields.rules && j.fields.rules.mapValue && j.fields.rules.mapValue.fields;
    const n = f && iv(f.seasonWeeks);
    return n != null && Number.isFinite(n) && n >= 1 && n <= HARD_LAST_WEEK - PLAYOFF_WEEKS ? n : DEFAULT_SEASON_WEEKS;
  } catch { return DEFAULT_SEASON_WEEKS; }
}
// team id -> [{token, docIds}] for devices on that team that have not muted "lineup" (missing
// gfflMutes means ON — only `moves` is default-off, and that is notify.mjs's rule, not this kind's).
async function readTeamDevices(accessToken, familyKey) {
  const docs = await fsQuery(accessToken, { from: [{ collectionId: `pushTokens_${familyKey}` }] });
  const byTeam = new Map();
  for (const d of docs) {
    const f = d.fields || {};
    const token = sv(f.token);
    const team = iv(f.gfflTeam) != null ? iv(f.gfflTeam) : (f.gfflTeam && f.gfflTeam.stringValue != null ? Number(f.gfflTeam.stringValue) : null);
    if (!token || team == null || Number.isNaN(team)) continue;
    const mutes = ((f.gfflMutes && f.gfflMutes.arrayValue && f.gfflMutes.arrayValue.values) || []).map((v) => v && v.stringValue);
    if (mutes.includes(KIND)) continue;
    if (!byTeam.has(team)) byTeam.set(team, new Map());
    const m = byTeam.get(team);
    if (!m.has(token)) m.set(token, []);
    m.get(token).push(d.name.split("/").pop());
  }
  return byTeam;
}

// ---- once-per-player-per-week marker ----
async function claimMarker(accessToken, familyKey, id, nowMsV, week, team) {
  const r = await fetch(
    `${FIRESTORE_BASE()}/lineupwarn_sent_${encodeURIComponent(familyKey)}/${encodeURIComponent(id)}` +
      "?currentDocument.exists=false&updateMask.fieldPaths=at&updateMask.fieldPaths=week&updateMask.fieldPaths=team",
    {
      method: "PATCH",
      headers: { ...authH(accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { at: { integerValue: String(nowMsV) }, week: { integerValue: String(week) }, team: { integerValue: String(team) } } }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  );
  if (r.ok) return "claimed";
  if (r.status === 409) return "exists";
  return "error"; // not proof nobody sent — fail closed, the next tick retries
}
async function releaseMarker(accessToken, familyKey, id) {
  try {
    await fetch(`${FIRESTORE_BASE()}/lineupwarn_sent_${encodeURIComponent(familyKey)}/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: authH(accessToken), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch { /* the marker stays; the player is simply not re-warned */ }
}

// ---- push log (same shape and rules as notify.mjs / leaguecron.mjs) ----
async function appendPushLog(accessToken, familyKey, entries, ms) {
  if (!entries.length) return false;
  const url = `${FIRESTORE_BASE()}/pushlog_${encodeURIComponent(familyKey)}/${new Date(ms).getUTCFullYear()}`;
  const wrap = (e) => ({ mapValue: { fields: {
    t: { integerValue: String(Math.round(e.t)) }, kind: { stringValue: String(e.kind) }, team: { integerValue: String(Math.round(e.team)) },
  } } });
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: authH(accessToken), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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
      headers: { ...authH(accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { entries: { arrayValue: { values } } } }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (w.ok) return true;
    if (w.status !== 409 && w.status !== 400) return false;
  }
  return false;
}

// ---- FCM ----
async function sendFcm(accessToken, token, body, tag) {
  const resp = await fetch(FCM_SEND_URL(), {
    method: "POST",
    headers: { ...authH(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ message: { token, data: { title: TITLE, body, url: DEEP_LINK, tag }, webpush: { headers: { Urgency: "high" } } } }),
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
async function deleteTokenDoc(accessToken, familyKey, docId) {
  await fetch(`${FIRESTORE_BASE()}/pushTokens_${familyKey}/${docId}`,
    { method: "DELETE", headers: authH(accessToken), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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

// The candidates for ONE tick, pure so the suite can reason about it. `slate` from fetchSlate,
// `rosters` from readRosters, `inj` the injstate doc's raw fields.
export function findCandidates(now, slate, rosters, inj) {
  const inWindow = slate.events.filter((e) => e.pre && e.ms - now >= WINDOW_MIN_MS && e.ms - now < WINDOW_MAX_MS);
  if (!inWindow.length) return [];
  const kick = new Map(); // NFL abbr -> kickoff ms, for teams in a window game
  for (const e of inWindow) for (const t of e.teams) kick.set(t, e.ms);
  const out = [];
  for (const r of rosters) {
    for (const p of r.players) {
      const slot = String(p.slot || "").toUpperCase();
      if (!p.key || !slot || slot === "BENCH" || slot === "IR") continue; // starters only
      const nfl = normTeam(p.team);
      if (!nfl) continue;
      const bye = slate.complete && !slate.playing.has(nfl);
      const ko = kick.get(nfl);
      if (!bye && ko == null) continue; // his game is not in this window
      const stored = inj["p_" + p.key] ? sv(inj["p_" + p.key]) : "";
      const desig = desigOf(stored) || desigOf(p.injury);
      if (!bye && !desig) continue;
      out.push({ teamId: r.teamId, key: p.key, name: p.name || p.key, nfl, bye, desig, kickoff: bye ? null : ko });
    }
  }
  out.sort((a, b) => a.teamId - b.teamId || String(a.key).localeCompare(String(b.key)));
  return out;
}
export function messageFor(c) {
  if (c.bye) return `${c.name} is on a bye and in your lineup.`;
  return `${c.name} ${DESIG_WORDS[c.desig]} and in your lineup. Kickoff ${kickoffText(c.kickoff)}.`;
}

export default async () => {
  const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { "Content-Type": "application/json" } });
  const now = nowMs();

  if (now < weekStartMs(1)) return json({ sent: 0, skipped: true, reason: "before-season" });
  const week = leagueWeek(now);

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) return json({ sent: 0, skipped: true, reason: "FIREBASE_SERVICE_ACCOUNT not set" }, 500);
  let serviceAccount;
  try { serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); }
  catch { return json({ sent: 0, skipped: true, reason: "FIREBASE_SERVICE_ACCOUNT is not valid JSON" }, 500); }
  const familyKey = process.env.LINEUPWARN_FAMILY_KEY || DEFAULT_FAMILY_KEY;

  try {
    // The cheapest gate first: one scoreboard fetch, no Firestore, and most ticks stop here.
    let slate;
    try { slate = await fetchSlate(week); } catch { slate = null; }
    if (!slate) return json({ sent: 0, skipped: true, reason: "scoreboard-unavailable" });
    const anyWindow = slate.events.some((e) => e.pre && e.ms - now >= WINDOW_MIN_MS && e.ms - now < WINDOW_MAX_MS);
    if (!anyWindow) return json({ sent: 0, skipped: true, reason: "no-kickoff-in-window", week });

    const accessToken = await getGoogleAccessToken(serviceAccount);
    if (week > (await readSeasonWeeks(accessToken, familyKey)) + PLAYOFF_WEEKS) {
      return json({ sent: 0, skipped: true, reason: "after-season", week });
    }

    const [rosters, inj, devices] = await Promise.all([
      readRosters(accessToken, familyKey, week), readInjState(accessToken, familyKey), readTeamDevices(accessToken, familyKey),
    ]);
    const cands = findCandidates(now, slate, rosters, inj);

    let sent = 0, warned = 0, already = 0, pruned = 0;
    const logEntries = [];
    for (const c of cands) {
      const team = devices.get(c.teamId);
      if (!team || !team.size) continue; // nobody to tell — do not burn the marker
      const id = `${SEASON}_w${week}_t${c.teamId}_${c.key}`;
      const claim = await claimMarker(accessToken, familyKey, id, now, week, c.teamId);
      if (claim === "exists") { already += 1; continue; }
      if (claim === "error") continue;
      const text = messageFor(c);
      const tag = `gffl-lineup-${c.key}`;
      let delivered = 0;
      await forEachBounded([...team.entries()], SEND_CONCURRENCY, async ([token, docIds]) => {
        const result = await sendFcm(accessToken, token, text, tag);
        if (result.ok) {
          delivered += 1;
          logEntries.push({ t: Date.now(), kind: KIND, team: c.teamId });
        } else if (isUnregistered(result)) {
          for (const docId of docIds) { try { await deleteTokenDoc(accessToken, familyKey, docId); pruned += 1; } catch { /* next */ } }
        }
      });
      if (delivered) { sent += delivered; warned += 1; }
      else await releaseMarker(accessToken, familyKey, id); // reached nobody: let the next tick try
    }
    if (logEntries.length) {
      await Promise.race([
        appendPushLog(accessToken, familyKey, logEntries, now).catch(() => false),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
    }
    return json({ sent, warned, already, pruned, candidates: cands.length, week, skipped: false, reason: null });
  } catch (err) {
    return json({ sent: 0, skipped: false, reason: String((err && err.message) || err) }, 500);
  }
};

// The schedule lives in netlify.toml ([functions."lineupwarn"].schedule), declared once.
