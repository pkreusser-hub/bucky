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
// Required env: BUCKY_NOTIFY_SECRET (shared family passphrase, same as the other
// functions). Optional: SPORTS_NFL_BASE_URL to point the upstream at a fake
// server in tests (tools/_verify-sports.cjs).

const ALLOWED_ORIGINS = new Set([
  "https://amenfarms.netlify.app",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
]);

const NFL_BASE = process.env.SPORTS_NFL_BASE_URL || "https://site.api.espn.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

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
    r = await fetch(url, { headers: { "User-Agent": UA, accept: "application/json" } });
  } catch {
    return { err: "unreachable" };
  }
  if (!r.ok) return { err: "http-" + r.status };
  try { return { data: await r.json() }; } catch { return { err: "bad-json" }; }
}

// ---------------- scoreboard ----------------

function slimCompetitor(c) {
  const t = c?.team || {};
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

async function nflScoreboard(body) {
  const params = [];
  const week = Number(body?.week);
  const seasontype = Number(body?.seasontype);
  const year = Number(body?.year);
  if (Number.isInteger(week) && week >= 1 && week <= 30) params.push("week=" + week);
  if (Number.isInteger(seasontype) && seasontype >= 1 && seasontype <= 4) params.push("seasontype=" + seasontype);
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) params.push("dates=" + year);
  const url = `${NFL_BASE}/apis/site/v2/sports/football/nfl/scoreboard` + (params.length ? "?" + params.join("&") : "");
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
    status,
    teams,
    situation,
    drives,
    scoringPlays,
    boxscore: { teams: boxTeams, players: boxPlayers },
    winprob,
  };
}

async function nflGame(body) {
  const eventId = String(body?.eventId ?? "").trim();
  if (!/^\d{5,12}$/.test(eventId)) return { ok: false, reason: "bad-event-id" };
  const url = `${NFL_BASE}/apis/site/v2/sports/football/nfl/summary?event=${eventId}`;
  const { data, err } = await fetchUpstream(url);
  if (err) return { ok: false, reason: err };
  try {
    return slimGame(data);
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

  if (body.action === "nfl_scoreboard") return json(await nflScoreboard(body), 200, headers);
  if (body.action === "nfl_game") return json(await nflGame(body), 200, headers);
  return json({ error: "Unknown action" }, 400, headers);
};

export const config = {
  path: "/.netlify/functions/sports",
};
