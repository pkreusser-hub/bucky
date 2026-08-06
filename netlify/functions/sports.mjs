// BUCKY — NFL scores for the sports page + home card.
//
// Netlify Function (ESM). POST JSON: { secret, action, ...params }
//   action "nfl_scoreboard" { week?, seasontype?, year? }
//     -> { ok, season, week, seasontype, calendar, events:[ slimmed game ] }
//   action "nfl_game" { eventId }
//     -> { ok, id, status, teams, situation, drives, scoringPlays, boxscore, winprob, venue }
//
// Data source: ESPN's unofficial site API (site.api.espn.com) — free, keyless,
// undocumented. Why a server proxy (stocks.mjs precedent): CORS on that host is
// unverified, the raw scoreboard payload is ~1MB (we slim it to a few KB so a
// phone polling every 25s isn't hurt), and routing everything through one function
// keeps a single error/caching story for the client. The fantasy side (a later
// stage) requires this function anyway for its private-league cookies.
//
// The upstream is UNOFFICIAL: shapes can drift without notice. Every read below
// is optional-chained and a failure returns { ok:false, reason } with HTTP 200 —
// the client renders an honest "scores unavailable" card, never an error page.
// Betting odds/pickcenter fields are deliberately never mapped (family app).
//
// FANTASY (ff_* actions): the family's private ESPN league (id 705063, team
// "Battle Kreussers") through the fantasy v3 API. A private league requires two
// cookies from a logged-in espn.com browser session — set them as Netlify env
// vars ESPN_S2 + ESPN_SWID (espn_s2 expires ~yearly; when it does, every ff_*
// action returns {ok:false, reason:"fantasy-auth-expired"} and the page shows
// Dad the fix). The cookies live ONLY here; they are sent upstream and never
// echoed in any response.
//
// Required env: BUCKY_NOTIFY_SECRET (shared family passphrase, same as the other
// functions). Fantasy env: ESPN_S2 + ESPN_SWID (required for the private league),
// ESPN_LEAGUE_ID / ESPN_TEAM_NAME / ESPN_SEASON overrides. Test overrides:
// SPORTS_NFL_BASE_URL + SPORTS_FF_BASE_URL point the upstreams at fake servers
// (tools/_verify-sports.cjs).

const ALLOWED_ORIGINS = new Set([
  "https://amenfarms.netlify.app",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
]);

const NFL_BASE = process.env.SPORTS_NFL_BASE_URL || "https://site.api.espn.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
// site.api.espn.com's Akamai edge BLOCKS datacenter requests that claim to be a
// browser (403 "Access Denied") but ALLOWS the curl user-agent — measured twice
// from GitHub runners on 2026-08-05 (browser UA/empty/"node"/custom all 403;
// default curl 200 both runs; see .github/workflows/sports-diag.yml). The exact
// inverse of the Yahoo/stocks.mjs lesson. The fantasy host (lm-api-reads) is
// fine with the browser UA and keeps it — don't "unify" these.
const NFL_UA = "curl/8.6.0";

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

async function fetchUpstream(url) {
  let r;
  try {
    r = await fetch(url, { headers: { "User-Agent": NFL_UA, accept: "*/*" } });
  } catch {
    return { err: "unreachable" };
  }
  if (!r.ok) return { err: "http-" + r.status };
  try { return { data: await r.json() }; } catch { return { err: "bad-json" }; }
}

// ---------------- scoreboard ----------------

function slimCompetitor(c) {
  const t = c?.team || {};
  // curatedRank.current: 1-25 = AP rank (college), 99 = unranked. NFL has no ranks.
  const rank = c?.curatedRank?.current;
  return {
    id: String(c?.id ?? t?.id ?? ""),
    homeAway: c?.homeAway || "",
    abbrev: t?.abbreviation || "",
    name: t?.shortDisplayName || t?.displayName || "",
    logo: t?.logo || t?.logos?.[0]?.href || "",
    color: t?.color || "",
    record: (Array.isArray(c?.records) ? c.records.find((r) => r?.type === "total")?.summary : "") || "",
    score: c?.score != null ? String(c.score) : "",
    winner: c?.winner === true,
    rank: Number.isInteger(rank) && rank >= 1 && rank <= 25 ? rank : null,
  };
}

function slimSituation(s) {
  if (!s) return null;
  return {
    possession: s?.possession != null ? String(s.possession) : "",
    down: s?.down ?? 0,
    distance: s?.distance ?? 0,
    downDistanceText: s?.shortDownDistanceText || s?.downDistanceText || "",
    possessionText: s?.possessionText || "",
    yardLine: s?.yardLine ?? null,
    lastPlay: s?.lastPlay?.text || "",
    redZone: s?.isRedZone === true,
  };
}

function slimScoreboard(j) {
  const events = (Array.isArray(j?.events) ? j.events : []).map((ev) => {
    const comp = ev?.competitions?.[0] || {};
    const st = comp?.status || ev?.status || {};
    const t = st?.type || {};
    return {
      id: String(ev?.id ?? ""),
      date: ev?.date || "",
      shortName: ev?.shortName || "",
      status: {
        state: t?.state || "",                       // "pre" | "in" | "post"
        detail: t?.shortDetail || t?.detail || "",
        completed: t?.completed === true,
        period: st?.period ?? 0,
        clock: st?.displayClock || "",
      },
      broadcast: comp?.broadcasts?.[0]?.names?.[0] || comp?.broadcast || "",
      // The betting line's display string only ("KC -3.5") — the full odds
      // object (provider, prices, links) stays server-side.
      spread: (typeof comp?.odds?.[0]?.details === "string" ? comp.odds[0].details : "").slice(0, 24),
      teams: (Array.isArray(comp?.competitors) ? comp.competitors : []).map(slimCompetitor),
      situation: slimSituation(comp?.situation),
    };
  });
  const calendar = (Array.isArray(j?.leagues?.[0]?.calendar) ? j.leagues[0].calendar : []).map((c) => ({
    label: c?.label || "",
    seasontype: Number(c?.value) || 0,
    weeks: (Array.isArray(c?.entries) ? c.entries : []).map((e) => ({
      num: Number(e?.value) || 0,
      label: e?.label || "",
      start: e?.startDate || "",
      end: e?.endDate || "",
    })),
  }));
  return {
    ok: true,
    season: { year: j?.season?.year ?? null, type: j?.season?.type ?? null },
    week: j?.week?.number ?? null,
    calendar,
    events,
  };
}

// One implementation serves both leagues — the site API's NFL and
// college-football endpoints share their whole shape. `groups` is the college
// conference filter (e.g. 8 = SEC, 80 = all FBS; omitted = the full FBS slate,
// measured live 2026-08-05 — NOT a Top-25 cut, so "Top 25" is the CLIENT's
// filter on each competitor's curatedRank).
async function siteScoreboard(leaguePath, body, allowGroups) {
  const params = [];
  const week = Number(body?.week);
  const seasontype = Number(body?.seasontype);
  const year = Number(body?.year);
  const group = Number(body?.group);
  if (Number.isInteger(week) && week >= 1 && week <= 30) params.push("week=" + week);
  if (Number.isInteger(seasontype) && seasontype >= 1 && seasontype <= 4) params.push("seasontype=" + seasontype);
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) params.push("dates=" + year);
  if (allowGroups && Number.isInteger(group) && group >= 1 && group <= 999) params.push("groups=" + group);
  const url = `${NFL_BASE}/apis/site/v2/sports/football/${leaguePath}/scoreboard` + (params.length ? "?" + params.join("&") : "");
  const { data, err } = await fetchUpstream(url);
  if (err) return { ok: false, reason: err };
  try {
    return slimScoreboard(data);
  } catch {
    return { ok: false, reason: "bad-shape" };
  }
}

// ---------------- game detail (summary) ----------------

function slimPlay(p) {
  return {
    id: String(p?.id ?? ""),
    text: p?.text || "",
    clock: p?.clock?.displayValue || "",
    period: p?.period?.number ?? 0,
    downDistanceText: p?.start?.shortDownDistanceText || p?.start?.downDistanceText || "",
    // Where the ball ENDED, as yards to the end zone the offense is driving toward —
    // this is what places the ball marker on the field visual.
    end: {
      down: p?.end?.down ?? 0,
      distance: p?.end?.distance ?? 0,
      yardsToEndzone: p?.end?.yardsToEndzone ?? null,
      downDistanceText: p?.end?.shortDownDistanceText || p?.end?.downDistanceText || "",
    },
    scoring: p?.scoringPlay === true,
  };
}

function slimGame(j) {
  const comp = j?.header?.competitions?.[0] || {};
  const st = comp?.status || {};
  const status = {
    state: st?.type?.state || "",
    detail: st?.type?.shortDetail || st?.type?.detail || "",
    completed: st?.type?.completed === true,
    period: st?.period ?? 0,
    clock: st?.displayClock || "",
  };
  const teams = (Array.isArray(comp?.competitors) ? comp.competitors : []).map((c) => {
    const t = c?.team || {};
    return {
      id: String(c?.id ?? t?.id ?? ""),
      homeAway: c?.homeAway || "",
      abbrev: t?.abbreviation || "",
      name: t?.shortDisplayName || t?.displayName || "",
      full: t?.displayName || "",
      color: t?.color || "",
      alt: t?.alternateColor || "",
      logo: t?.logos?.[0]?.href || t?.logo || "",
      score: c?.score != null ? String(c.score) : "",
      winner: c?.winner === true,
      linescores: (Array.isArray(c?.linescores) ? c.linescores : []).map((l) => l?.displayValue ?? ""),
      record: (Array.isArray(c?.record) ? (c.record.find((r) => r?.type === "total")?.summary || c.record?.[0]?.summary) : "") || "",
    };
  });

  const cur = j?.drives?.current;
  const curPlays = Array.isArray(cur?.plays) ? cur.plays : [];
  const drives = {
    current: cur ? {
      teamId: String(cur?.team?.id ?? ""),
      teamAbbrev: cur?.team?.abbreviation || "",
      description: cur?.description || "",
      startYardsToEndzone: cur?.start?.yardsToEndzone ?? null,
      plays: curPlays.slice(-14).map(slimPlay),
    } : null,
    // Newest first — this feeds the "previous drives" list top-down.
    previous: (Array.isArray(j?.drives?.previous) ? j.drives.previous : []).map((d) => ({
      teamId: String(d?.team?.id ?? ""),
      teamAbbrev: d?.team?.abbreviation || "",
      result: d?.displayResult || d?.result || "",
      description: d?.description || "",
      scoring: d?.isScore === true,
    })).reverse(),
  };

  // Live situation, derived from the current drive's last play. The summary
  // endpoint doesn't reliably carry a top-level situation object; the last
  // play's `end` is the authoritative "where is the ball right now".
  let situation = null;
  const last = curPlays[curPlays.length - 1];
  if (cur && last && status.state === "in") {
    situation = {
      possessionId: String(cur?.team?.id ?? ""),
      possessionAbbrev: cur?.team?.abbreviation || "",
      down: last?.end?.down ?? 0,
      distance: last?.end?.distance ?? 0,
      downDistanceText: last?.end?.shortDownDistanceText || last?.end?.downDistanceText || "",
      yardsToEndzone: last?.end?.yardsToEndzone ?? null,
      lastPlay: last?.text || "",
    };
  }

  const scoringPlays = (Array.isArray(j?.scoringPlays) ? j.scoringPlays : []).map((s) => ({
    period: s?.period?.number ?? 0,
    clock: s?.clock?.displayValue || "",
    text: s?.text || "",
    team: s?.team?.abbreviation || "",
    type: s?.scoringType?.abbreviation || "",
    away: s?.awayScore ?? 0,
    home: s?.homeScore ?? 0,
  }));

  const boxTeams = (Array.isArray(j?.boxscore?.teams) ? j.boxscore.teams : []).map((t) => ({
    abbrev: t?.team?.abbreviation || "",
    stats: (Array.isArray(t?.statistics) ? t.statistics : []).map((s) => ({
      name: s?.name || "",
      label: s?.label || s?.name || "",
      value: s?.displayValue != null ? String(s.displayValue) : "",
    })),
  }));
  const boxPlayers = (Array.isArray(j?.boxscore?.players) ? j.boxscore.players : []).map((t) => ({
    abbrev: t?.team?.abbreviation || "",
    groups: (Array.isArray(t?.statistics) ? t.statistics : []).map((g) => ({
      name: g?.name || "",
      label: g?.text || g?.name || "",
      labels: Array.isArray(g?.labels) ? g.labels : [],
      athletes: (Array.isArray(g?.athletes) ? g.athletes : []).slice(0, 8).map((a) => ({
        name: a?.athlete?.shortName || a?.athlete?.displayName || "",
        stats: Array.isArray(a?.stats) ? a.stats : [],
      })),
    })),
  }));

  // Win probability thinned to <=80 points (home team's chance, 0..1). The raw
  // series runs one entry per play — hundreds of points nobody can see on a
  // 220px sparkline.
  const wpRaw = Array.isArray(j?.winprobability) ? j.winprobability : [];
  const step = Math.max(1, Math.ceil(wpRaw.length / 80));
  const winprob = wpRaw
    .filter((_, i) => i % step === 0 || i === wpRaw.length - 1)
    .map((w) => Math.round((w?.homeWinPercentage ?? 0) * 1000) / 1000);

  return {
    ok: true,
    id: String(comp?.id ?? j?.header?.id ?? ""),
    date: comp?.date || "",
    venue: j?.gameInfo?.venue?.fullName || "",
    // The summary endpoint keeps its line under pickcenter — display string only.
    spread: (typeof j?.pickcenter?.[0]?.details === "string" ? j.pickcenter[0].details : "").slice(0, 24),
    status,
    teams,
    situation,
    drives,
    scoringPlays,
    boxscore: { teams: boxTeams, players: boxPlayers },
    winprob,
  };
}

async function siteGame(leaguePath, body) {
  const eventId = String(body?.eventId ?? "").trim();
  if (!/^\d{5,12}$/.test(eventId)) return { ok: false, reason: "bad-event-id" };
  const url = `${NFL_BASE}/apis/site/v2/sports/football/${leaguePath}/summary?event=${eventId}`;
  const { data, err } = await fetchUpstream(url);
  if (err) return { ok: false, reason: err };
  try {
    return slimGame(data);
  } catch {
    return { ok: false, reason: "bad-shape" };
  }
}

// ---------------- fantasy (private ESPN league) ----------------

const FF_BASE = process.env.SPORTS_FF_BASE_URL || "https://lm-api-reads.fantasy.espn.com";
const FF_LEAGUE_ID = /^\d{1,12}$/.test(process.env.ESPN_LEAGUE_ID || "") ? process.env.ESPN_LEAGUE_ID : "705063";
const FF_TEAM_NAME = (process.env.ESPN_TEAM_NAME || "battle kreussers").trim().toLowerCase();

// ESPN pro-team ids (shared by the fantasy API's proTeamId and the site API's
// team ids). 0 = free agent / no team.
const PRO_ABBREV = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
  9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
  17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
  25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};
const SLOT_LABEL = {
  0: "QB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE", 7: "OP",
  16: "D/ST", 17: "K", 20: "Bench", 21: "IR", 23: "FLEX",
};
const SLOT_ORDER = [0, 2, 3, 4, 5, 6, 23, 7, 16, 17, 20, 21];
const POS_LABEL = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST" };

function ffCookies() {
  // Read at call time (not module load) so an expired cookie can be replaced by
  // just updating the env var + redeploying — and so tests can flip states.
  const s2 = process.env.ESPN_S2, swid = process.env.ESPN_SWID;
  if (!s2 || !swid) return null;
  const braced = swid.startsWith("{") ? swid : "{" + swid.replace(/[{}]/g, "") + "}";
  return "espn_s2=" + s2 + "; SWID=" + braced;
}

// The NFL season a fantasy league year names: January/February still belong to
// the PREVIOUS season's league.
function ffSeason() {
  if (/^\d{4}$/.test(process.env.ESPN_SEASON || "")) return Number(process.env.ESPN_SEASON);
  const d = new Date();
  return d.getUTCMonth() < 2 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
}

async function ffFetch(views, extra, body, extraHeaders) {
  const cookie = ffCookies();
  if (!cookie) return { err: "fantasy-not-configured" };
  const year = Number(body?.year) >= 2000 && Number(body?.year) <= 2100 ? Number(body.year) : ffSeason();
  const url = FF_BASE + "/apis/v3/games/ffl/seasons/" + year + "/segments/0/leagues/" + FF_LEAGUE_ID
    + "?" + views.map((v) => "view=" + v).join("&") + (extra || "");
  let r;
  try {
    r = await fetch(url, { headers: { "User-Agent": UA, accept: "application/json", cookie, ...(extraHeaders || {}) } });
  } catch {
    return { err: "unreachable" };
  }
  if (r.status === 401 || r.status === 403) return { err: "fantasy-auth-expired" };
  if (!r.ok) return { err: "http-" + r.status };
  try { return { data: await r.json(), year }; } catch { return { err: "bad-json" }; }
}

function ffTeamName(t) {
  return (t?.name || ((t?.location || "") + " " + (t?.nickname || "")).trim() || ("Team " + t?.id)).trim();
}
function ffOwnerName(t, members) {
  const guid = Array.isArray(t?.owners) ? t.owners[0] : null;
  const m = guid && Array.isArray(members) ? members.find((x) => x?.id === guid) : null;
  if (!m) return "";
  return m.displayName || [m.firstName, m.lastName].filter(Boolean).join(" ") || "";
}
function ffSlimTeam(t, members) {
  const rec = t?.record?.overall || {};
  return {
    id: t?.id ?? 0,
    name: ffTeamName(t),
    abbrev: t?.abbrev || "",
    logo: typeof t?.logo === "string" && /^https:\/\//.test(t.logo) ? t.logo : "",
    owner: ffOwnerName(t, members),
    wins: rec?.wins ?? 0, losses: rec?.losses ?? 0, ties: rec?.ties ?? 0,
    pointsFor: Math.round((rec?.pointsFor ?? 0) * 10) / 10,
    pointsAgainst: Math.round((rec?.pointsAgainst ?? 0) * 10) / 10,
    seed: t?.playoffSeed ?? 0,
  };
}
// Resolve "my team" by name — the client sends teamName per signed-in family
// member (Isaac follows The Goat Kids, Grandpa the Wyoming Cowboys, Mom the
// Nails for Breakfast); a missing/unmatched name falls back to the env default.
// Matching NORMALIZES WHITESPACE (collapse runs, lowercase): the real league's
// team is literally "Nails  For Breakfast" — an invisible double space the
// owner could "fix" any day — measured live 2026-08-06 when the exact match
// silently fell back to the default team.
const ffNorm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
function ffWantedName(body) {
  const n = ffNorm(body?.teamName).slice(0, 60);
  return n || FF_TEAM_NAME;
}
function ffFamilyTeamId(teams, wanted) {
  const w = ffNorm(wanted || FF_TEAM_NAME);
  const hit = (teams || []).find((t) => ffNorm(ffTeamName(t)) === w)
    || (teams || []).find((t) => ffNorm(ffTeamName(t)).includes(w))
    || (w !== FF_TEAM_NAME ? (teams || []).find((t) => ffNorm(ffTeamName(t)) === FF_TEAM_NAME) : null);
  return hit ? hit.id : null;
}
const r1 = (n) => (typeof n === "number" && isFinite(n) ? Math.round(n * 10) / 10 : null);

async function ffLeague(body) {
  const wanted = ffWantedName(body);
  const { data: j, err, year } = await ffFetch(["mTeam", "mSettings"], "", body);
  if (err) return { ok: false, reason: err };
  try {
    const teams = (Array.isArray(j?.teams) ? j.teams : []).map((t) => ffSlimTeam(t, j?.members));
    return {
      ok: true,
      leagueName: j?.settings?.name || "Fantasy league",
      season: year,
      week: j?.status?.currentMatchupPeriod ?? null,
      scoringPeriodId: j?.scoringPeriodId ?? j?.status?.latestScoringPeriod ?? null,
      familyTeamId: ffFamilyTeamId(j?.teams, wanted),
      teams,
    };
  } catch {
    return { ok: false, reason: "bad-shape" };
  }
}

async function ffScoreboard(body) {
  const wanted = ffWantedName(body);
  const { data: j, err, year } = await ffFetch(["mMatchupScore", "mTeam", "mSettings"], "", body);
  if (err) return { ok: false, reason: err };
  try {
    const week = Number(body?.week) >= 1 && Number(body?.week) <= 30
      ? Number(body.week) : (j?.status?.currentMatchupPeriod ?? 1);
    const byId = new Map((Array.isArray(j?.teams) ? j.teams : []).map((t) => [t.id, ffSlimTeam(t, j?.members)]));
    function side(s) {
      if (!s || s.teamId == null) return null;
      const t = byId.get(s.teamId) || { id: s.teamId, name: "Team " + s.teamId, abbrev: "", logo: "", wins: 0, losses: 0, ties: 0 };
      return {
        teamId: s.teamId, name: t.name, abbrev: t.abbrev, logo: t.logo,
        record: t.wins + "-" + t.losses + (t.ties ? "-" + t.ties : ""),
        points: r1(s.totalPointsLive != null ? s.totalPointsLive : s.totalPoints),
        proj: r1(s.totalProjectedPointsLive),
        live: s.totalPointsLive != null,
      };
    }
    const matchups = (Array.isArray(j?.schedule) ? j.schedule : [])
      .filter((m) => m?.matchupPeriodId === week)
      .map((m) => ({
        id: m?.id ?? 0,
        home: side(m?.home), away: side(m?.away),
        winner: m?.winner === "HOME" || m?.winner === "AWAY" ? m.winner : "",
      }))
      .filter((m) => m.home || m.away);
    return {
      ok: true,
      leagueName: j?.settings?.name || "Fantasy league",
      season: year, week,
      familyTeamId: ffFamilyTeamId(j?.teams, wanted),
      matchups,
    };
  } catch {
    return { ok: false, reason: "bad-shape" };
  }
}

async function ffMatchup(body) {
  const wanted = ffWantedName(body);
  // One call answers the whole family-matchup screen: both lineups with live
  // points + projections, PLUS each player's real NFL game state (joined from
  // the site API's scoreboard, same upstream the NFL tab uses).
  const { data: j, err, year } = await ffFetch(["mMatchupScore", "mBoxscore", "mTeam", "mSettings"], "", body);
  if (err) return { ok: false, reason: err };
  try {
    const week = Number(body?.week) >= 1 && Number(body?.week) <= 30
      ? Number(body.week) : (j?.status?.currentMatchupPeriod ?? 1);
    const scoringPeriodId = j?.scoringPeriodId ?? week;
    const teams = Array.isArray(j?.teams) ? j.teams : [];
    const byId = new Map(teams.map((t) => [t.id, ffSlimTeam(t, j?.members)]));
    let teamId = Number(body?.teamId);
    if (!byId.has(teamId)) teamId = ffFamilyTeamId(teams, wanted);
    const m = (Array.isArray(j?.schedule) ? j.schedule : []).find((x) =>
      x?.matchupPeriodId === week && (x?.home?.teamId === teamId || x?.away?.teamId === teamId));
    if (!m) return { ok: true, season: year, week, familyTeamId: teamId, matchup: null };

    // Pro-game states for the "yet to play / in play / done" dots.
    const proGames = {};
    const sb = await fetchUpstream(`${NFL_BASE}/apis/site/v2/sports/football/nfl/scoreboard`);
    if (sb.data) {
      for (const ev of (sb.data.events || [])) {
        const comp = ev?.competitions?.[0] || {};
        const st = comp?.status || ev?.status || {};
        for (const c of (comp?.competitors || [])) {
          const id = Number(c?.id ?? c?.team?.id);
          if (id) proGames[id] = {
            state: st?.type?.state || "",
            detail: st?.type?.shortDetail || "",
            date: ev?.date || "",
          };
        }
      }
    }

    function player(e) {
      const pe = e?.playerPoolEntry || {};
      const p = pe?.player || {};
      const stats = Array.isArray(p?.stats) ? p.stats : [];
      const actual = pe?.appliedStatTotal != null ? pe.appliedStatTotal
        : stats.find((s) => s?.scoringPeriodId === scoringPeriodId && s?.statSourceId === 0)?.appliedTotal;
      const proj = stats.find((s) => s?.scoringPeriodId === scoringPeriodId && s?.statSourceId === 1)?.appliedTotal;
      const slotId = e?.lineupSlotId ?? 20;
      const proId = p?.proTeamId ?? 0;
      return {
        name: p?.fullName || "—",
        slotId,
        slot: SLOT_LABEL[slotId] || String(slotId),
        pos: POS_LABEL[p?.defaultPositionId] || "",
        proTeam: PRO_ABBREV[proId] || "",
        injury: p?.injuryStatus && p.injuryStatus !== "ACTIVE" ? p.injuryStatus : "",
        actual: r1(actual),
        proj: r1(proj),
        starter: slotId !== 20 && slotId !== 21,
        game: proGames[proId] || null,
      };
    }
    function side(s) {
      if (!s || s.teamId == null) return null;
      const t = byId.get(s.teamId) || { name: "Team " + s.teamId, abbrev: "", logo: "", wins: 0, losses: 0, ties: 0 };
      const entries = s?.rosterForCurrentScoringPeriod?.entries || s?.rosterForMatchupPeriod?.entries || [];
      const slotRank = (id) => { const i = SLOT_ORDER.indexOf(id); return i < 0 ? 99 : i; };
      const roster = entries.map(player).sort((a, b) => slotRank(a.slotId) - slotRank(b.slotId));
      const projTotal = roster.filter((p) => p.starter).reduce((a, p) => a + (p.proj || 0), 0);
      return {
        teamId: s.teamId, name: t.name, abbrev: t.abbrev, logo: t.logo,
        record: t.wins + "-" + t.losses + (t.ties ? "-" + t.ties : ""),
        points: r1(s.totalPointsLive != null ? s.totalPointsLive : s.totalPoints) || 0,
        proj: r1(projTotal),
        roster,
      };
    }
    const home = side(m.home), away = side(m.away);
    const anyProLive = Object.values(proGames).some((g) => g.state === "in");
    return {
      ok: true,
      leagueName: j?.settings?.name || "Fantasy league",
      season: year, week, scoringPeriodId,
      familyTeamId: teamId,
      anyProLive,
      matchup: { id: m?.id ?? 0, home, away, winner: m?.winner === "HOME" || m?.winner === "AWAY" ? m.winner : "" },
    };
  } catch {
    return { ok: false, reason: "bad-shape" };
  }
}

// Best available free agents, for the waiver-advice AI + a browse list. The fantasy v3
// API's player pool is filtered through the X-Fantasy-Filter HEADER (the documented
// community convention — the query string can't express it): free agents + waivers,
// sorted by percent-owned so the list is "players real managers are picking up", capped
// upstream at 75 and slimmed to 50 here.
async function ffFreeAgents(body) {
  const filter = {
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      limit: 75,
    },
  };
  const { data: j, err, year } = await ffFetch(["kona_player_info"], "", body,
    { "x-fantasy-filter": JSON.stringify(filter) });
  if (err) return { ok: false, reason: err };
  try {
    const sp = j?.scoringPeriodId ?? j?.status?.latestScoringPeriod ?? null;
    const players = (Array.isArray(j?.players) ? j.players : [])
      .map((e) => {
        const p = e?.player || e || {};
        const stats = Array.isArray(p?.stats) ? p.stats : [];
        const proj = stats.find((s) => s?.scoringPeriodId === sp && s?.statSourceId === 1)?.appliedTotal;
        const seasonProj = stats.find((s) => s?.scoringPeriodId === 0 && s?.statSourceId === 1)?.appliedTotal;
        return {
          name: p?.fullName || "",
          pos: POS_LABEL[p?.defaultPositionId] || "",
          proTeam: PRO_ABBREV[p?.proTeamId ?? 0] || "",
          injury: p?.injuryStatus && p.injuryStatus !== "ACTIVE" ? p.injuryStatus : "",
          pctOwned: Math.round((p?.ownership?.percentOwned ?? 0) * 10) / 10,
          proj: r1(proj),
          seasonProj: r1(seasonProj),
        };
      })
      .filter((p) => p.name)
      .slice(0, 50);
    return { ok: true, season: year, scoringPeriodId: sp, players };
  } catch {
    return { ok: false, reason: "bad-shape" };
  }
}

// ---------------- handler ----------------

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

  if (body.action === "nfl_scoreboard") return json(await siteScoreboard("nfl", body, false), 200, headers);
  if (body.action === "nfl_game") return json(await siteGame("nfl", body), 200, headers);
  if (body.action === "ncaa_scoreboard") return json(await siteScoreboard("college-football", body, true), 200, headers);
  if (body.action === "ncaa_game") return json(await siteGame("college-football", body), 200, headers);
  if (body.action === "ff_league") return json(await ffLeague(body), 200, headers);
  if (body.action === "ff_scoreboard") return json(await ffScoreboard(body), 200, headers);
  if (body.action === "ff_matchup") return json(await ffMatchup(body), 200, headers);
  if (body.action === "ff_freeagents") return json(await ffFreeAgents(body), 200, headers);
  return json({ error: "Unknown action" }, 400, headers);
};

export const config = {
  path: "/.netlify/functions/sports",
};
