// league.mjs — GFFL (Goat Fantasy Football League) server actions, stage S1.
//
// READ-ONLY importers for now: they pull the family's real ESPN league through
// the cookie'd fantasy API so the GFFL rules doc and week-1 rosters start from
// reality instead of hand-copied guesses. League STATE (rules, rosters, teams)
// lives in Firestore and is written client-side under the house identity
// posture; waivers/trades/finalization grow server actions in S3.
//
// Deploy marker: 2026-08-07 redeploy (the 62a21d3 build never left Netlify's queue).
// House conventions: zero deps, family-secret gate, every upstream read
// optional-chained, failures are { ok:false, reason } at HTTP 200, cookie env
// vars read at call time, CORS for the browser. Config duplicated from
// sports.mjs deliberately (no shared modules between functions in this repo).
"use strict";

const FF_BASE = process.env.SPORTS_FF_BASE_URL || "https://lm-api-reads.fantasy.espn.com";
const FF_LEAGUE_ID = /^\d{1,12}$/.test(process.env.ESPN_LEAGUE_ID || "") ? process.env.ESPN_LEAGUE_ID : "705063";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const SECRET = () => process.env.BUCKY_NOTIFY_SECRET || process.env.FAMILY_PASSWORD || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });

function ffCookies() {
  const s2 = process.env.ESPN_S2, swid = process.env.ESPN_SWID;
  if (!s2 || !swid) return null;
  const braced = swid.startsWith("{") ? swid : "{" + swid.replace(/[{}]/g, "") + "}";
  return `espn_s2=${s2}; SWID=${braced}`;
}

// Fantasy league year: Jan/Feb still belong to the previous season.
function ffSeason(body) {
  const y = Number(body?.season);
  if (y >= 2020 && y <= 2100) return y;
  const now = new Date();
  const chicago = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return chicago.getMonth() < 2 ? chicago.getFullYear() - 1 : chicago.getFullYear();
}

async function ffFetch(views, body) {
  const cookies = ffCookies();
  if (!cookies) return { err: "fantasy-not-configured" };
  const year = ffSeason(body);
  const vq = views.map((v) => "view=" + v).join("&");
  const url = `${FF_BASE}/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${FF_LEAGUE_ID}?${vq}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, accept: "application/json", Cookie: cookies } });
    if (r.status === 401 || r.status === 403) return { err: "fantasy-auth-expired" };
    if (!r.ok) return { err: "http-" + r.status };
    return { data: await r.json(), year };
  } catch (e) {
    return { err: "fetch-failed" };
  }
}

// ---------------- ESPN scoring-item map ----------------
// statId -> our normalized scoring key. Known ids from the public fantasy API;
// anything unmapped is returned RAW for the commissioner (and the post-deploy
// diag) to review — the import never silently drops a rule.
const STAT_MAP = {
  3: "pass_yd", 4: "pass_td", 19: "pass_2pt", 20: "pass_int",
  24: "rush_yd", 25: "rush_td", 26: "rush_2pt",
  42: "rec_yd", 43: "rec_td", 44: "rec_2pt", 53: "rec",
  72: "fum_lost",
  74: "fg_50", 77: "fg_40_49", 80: "fg_0_39", 85: "fg_miss",
  86: "xp_made", 88: "xp_miss",
  89: "dst_pa_0", 90: "dst_pa_1_6", 91: "dst_pa_7_13", 92: "dst_pa_14_17",
  123: "dst_pa_28_34", 124: "dst_pa_35_45", 125: "dst_pa_46",
  95: "dst_int", 96: "dst_fum_rec", 97: "dst_blk", 98: "dst_safety", 99: "dst_sack",
  101: "dst_kr_td", 102: "dst_pr_td", 103: "dst_fum_ret_td", 104: "dst_int_ret_td",
  93: "dst_blk_td", 106: "dst_fum_forced",
  // Live-league review (diag 2026-08-07): the Nerd league scores yardage GAME
  // BONUSES and distance-specific FG misses. Ids per the ffscrapr/espn-api
  // community tables, consistent with the observed point values.
  17: "bonus_pass_300", 18: "bonus_pass_400",
  37: "bonus_rush_100", 38: "bonus_rush_200",
  56: "bonus_rec_100", 57: "bonus_rec_200",
  79: "fg_miss", 82: "fg_miss", // distance misses (0-39 / 40-49) share one key; 85 (50+ miss) already mapped above
  63: "off_fum_td",
  // Kicker audit (diag 2026-08-07, Badgley's season reconciled to the penny):
  214: "fg_made_yd", 206: "dst_2pt_ret", 209: "one_pt_safety",
};
const SLOT_LABEL = {
  0: "QB", 2: "RB", 3: "RB/WR", 4: "WR", 5: "WR/TE", 6: "TE", 7: "OP",
  16: "DST", 17: "K", 20: "BENCH", 21: "IR", 23: "FLEX",
};
const POS_LABEL = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST" };
const PRO_ABBREV = {
  0: "", 1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
  9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
  17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
  25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};

function ffTeamName(t) {
  const joined = [t?.location, t?.nickname].filter(Boolean).join(" ").trim();
  return (t?.name || joined || ("Team " + (t?.id ?? "?"))).trim();
}
function ffOwnerName(t, members) {
  const ownerId = Array.isArray(t?.owners) ? t.owners[0] : null;
  const m = (Array.isArray(members) ? members : []).find((x) => x?.id === ownerId);
  const nm = [m?.firstName, m?.lastName].filter(Boolean).join(" ").trim();
  return nm || m?.displayName || "";
}

// ---------------- actions ----------------

// The real league's rules, mapped into the GFFL rules-doc shape. `unmapped`
// carries every scoring item we didn't recognize — the review step, not a
// silent drop.
async function lgEspnSettings(body) {
  const { data: j, err, year } = await ffFetch(["mSettings", "mTeam"], body);
  if (err) return { ok: false, reason: err };
  try {
    const s = j?.settings || {};
    const scoring = {};
    const unmapped = [];
    for (const it of (s?.scoringSettings?.scoringItems || [])) {
      const id = Number(it?.statId);
      // THE pointsOverrides[16] TRAP (2026-08-13, caught by the full rules reconciliation vs
      // the real 2025 boxscores): ESPN stores every DEFENSIVE rule's real value in
      // pointsOverrides["16"] (the D/ST position group) while `points` is a genuine 0 — and
      // `points ?? override` NEVER falls through on 0, so this import wrote ZEROS for the
      // whole D/ST family (sack/int/fum/blk/safety) and the non-override 6 where the
      // override says 8 (kick/punt return TDs) or 4 (2-pt return). The override WINS when
      // present; `points` is the fallback. Proven against appliedStats coefficients on 2,497
      // real player-weeks.
      const ov = it?.pointsOverrides?.[16];
      const pts = ov != null ? Number(ov) : Number(it?.points ?? 0);
      if (!id && id !== 0) continue;
      const key = STAT_MAP[id];
      if (key) scoring[key] = pts;
      else if (pts) unmapped.push({ statId: id, points: pts });
    }
    const slotCounts = s?.rosterSettings?.lineupSlotCounts || {};
    const slots = {};
    for (const k of Object.keys(slotCounts)) {
      const n = Number(slotCounts[k]) || 0;
      if (n > 0) slots[SLOT_LABEL[Number(k)] || ("slot" + k)] = n;
    }
    const teams = (Array.isArray(j?.teams) ? j.teams : []).map((t) => ({
      id: t?.id ?? 0,
      name: ffTeamName(t),
      abbrev: t?.abbrev || "",
      logo: typeof t?.logo === "string" && /^https:\/\//.test(t.logo) ? t.logo : "",
      owner: ffOwnerName(t, j?.members),
    }));
    return {
      ok: true,
      season: year,
      leagueName: s?.name || "",
      scoring,
      unmapped,
      slots,
      regularSeasonWeeks: s?.scheduleSettings?.matchupPeriodCount ?? null,
      playoffTeams: s?.scheduleSettings?.playoffTeamCount ?? null,
      trade: {
        reviewHours: s?.tradeSettings?.revisionHours ?? null,
        vetoVotesRequired: s?.tradeSettings?.vetoVotesRequired ?? null,
        deadlineDate: s?.tradeSettings?.deadlineDate ?? null,
      },
      acquisition: {
        type: s?.acquisitionSettings?.acquisitionType || null,
        budget: s?.acquisitionSettings?.acquisitionBudget ?? null,
        waiverHours: s?.acquisitionSettings?.waiverHours ?? null,
      },
      teams,
    };
  } catch {
    return { ok: false, reason: "bad-shape" };
  }
}

// Shared by lg_espn_rosters and lg_espn_rosters_season below — same mRoster team/entry shape
// either way, just a different season's data feeding it.
function mapRosterTeams(j) {
  return (Array.isArray(j?.teams) ? j.teams : []).map((t) => ({
    id: t?.id ?? 0,
    name: ffTeamName(t),
    players: (t?.roster?.entries || []).map((e) => {
      const p = e?.playerPoolEntry?.player || e?.player || {};
      return {
        espnId: p?.id ?? null,
        name: p?.fullName || "",
        pos: POS_LABEL[p?.defaultPositionId] || "",
        proTeam: PRO_ABBREV[p?.proTeamId] || "",
        injury: p?.injuryStatus || "",
        lineupSlot: SLOT_LABEL[e?.lineupSlotId] || String(e?.lineupSlotId ?? ""),
      };
    }),
  }));
}

// Current ESPN rosters per team — the bridge that seeds GFFL rosters while
// ESPN is still where the league's players formally live.
async function lgEspnRosters(body) {
  const { data: j, err, year } = await ffFetch(["mRoster", "mTeam"], body);
  if (err) return { ok: false, reason: err };
  try {
    return { ok: true, season: year, teams: mapRosterTeams(j) };
  } catch {
    return { ok: false, reason: "bad-shape" };
  }
}

// Past-season rosters (2026-08-08) — a commissioner "🧪 test run" button on Rules seeds this
// week's GFFL rosters from a FINISHED past season's real, complete rosters, for exercising the
// app while the live ESPN league is still pre-draft (every roster empty). A SEPARATE action
// from lg_espn_rosters on purpose (never touches the live-season path): past-season mRoster
// reads sometimes need the scoringPeriodId=0 retry (the kicker-audit/history-import finding —
// ffFetch's plain form is built for the CURRENT season and doesn't carry that param), so this
// tries the plain URL first and only falls back to the scoringPeriodId=0 form if the plain one
// comes back with no real roster entries. Unlike lgEspnHistory this never returns a "no-season"
// soft-stop — a single explicit season is asked for, so any failure is reported plainly.
async function lgEspnRostersSeason(body) {
  const cookies = ffCookies();
  if (!cookies) return { ok: false, reason: "fantasy-not-configured" };
  const season = Number(body?.season) >= 2000 && Number(body?.season) <= 2100 ? Number(body.season) : 2025;
  const vq = ["mRoster", "mTeam"].map((v) => "view=" + v).join("&");
  const urls = [
    `${FF_BASE}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${FF_LEAGUE_ID}?${vq}`,
    `${FF_BASE}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${FF_LEAGUE_ID}?scoringPeriodId=0&${vq}`,
  ];
  let j = null, lastErr = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, accept: "application/json", Cookie: cookies } });
      if (r.status === 401 || r.status === 403) return { ok: false, reason: "fantasy-auth-expired" };
      if (!r.ok) { lastErr = "http-" + r.status; continue; }
      const data = await r.json();
      const hasRosters = Array.isArray(data?.teams) && data.teams.some((t) => (t?.roster?.entries || []).length > 0);
      if (hasRosters) { j = data; break; }
      lastErr = "no-rosters"; // a valid response, but nobody's roster has entries — try the other URL form
    } catch (e) { lastErr = "fetch-failed"; }
  }
  if (!j) return { ok: false, reason: lastErr || "no-rosters" };
  try {
    return { ok: true, season, teams: mapRosterTeams(j) };
  } catch {
    return { ok: false, reason: "bad-shape" };
  }
}

// Kicker scoring audit — the live league's scoring carries NO conventional
// FG-made ids (74/77/80/83), only the uncertain 206/209/214. appliedStats on a
// real season's kicker names exactly what each statId paid: coefficient =
// appliedStats[id] / stats[id]. Read-only, feeds the pre-week-1 confirmation.
async function lgEspnKickerAudit(body) {
  const cookies = ffCookies();
  if (!cookies) return { ok: false, reason: "fantasy-not-configured" };
  const year = Number(body?.season) >= 2020 ? Number(body.season) : 2025;
  // Past-season kona reads want scoringPeriodId=0; the sort filter 400'd live
  // (2026-08-07), so try a ladder of filters and report which one worked.
  const url = `${FF_BASE}/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${FF_LEAGUE_ID}?scoringPeriodId=0&view=kona_player_info`;
  const attempts = [
    { mode: "slot+sort", filter: { players: { filterSlotIds: { value: [17] }, limit: 8, sortAppliedTotal: { sortPriority: 1, sortAsc: false } } } },
    { mode: "slot-only", filter: { players: { filterSlotIds: { value: [17] }, limit: 40 } } },
    { mode: "no-filter", filter: null },
  ];
  let j = null, filterMode = null, lastErr = null;
  for (const a of attempts) {
    try {
      const headers = { "User-Agent": UA, accept: "application/json", Cookie: cookies };
      if (a.filter) headers["X-Fantasy-Filter"] = JSON.stringify(a.filter);
      const r = await fetch(url, { headers });
      if (r.status === 401 || r.status === 403) return { ok: false, reason: "fantasy-auth-expired" };
      if (!r.ok) { lastErr = "http-" + r.status; continue; }
      j = await r.json(); filterMode = a.mode; break;
    } catch { lastErr = "fetch-failed"; }
  }
  if (!j) return { ok: false, reason: lastErr || "fetch-failed" };
  try {
    const pool = j?.players || [];
    const kickers = pool
      .filter((e) => e?.player?.defaultPositionId === 5) // kickers only, whatever the filter narrowed to
      .map((e) => {
        const p = e?.player || {};
        // Season-total ACTUAL line: statSourceId 0 (real), statSplitTypeId 0 (full season).
        const line = (p?.stats || []).find((s) => s?.statSourceId === 0 && s?.statSplitTypeId === 0 && Number(s?.seasonId) === year);
        return {
          name: p?.fullName || "", espnId: p?.id ?? null,
          appliedTotal: line?.appliedTotal ?? null,
          stats: line?.stats || {}, appliedStats: line?.appliedStats || {},
        };
      })
      .filter((k) => k.appliedTotal != null)
      .sort((a, b) => b.appliedTotal - a.appliedTotal)
      .slice(0, 5);
    return { ok: true, season: year, filterMode, poolCount: pool.length, kickers };
  } catch {
    return { ok: false, reason: "fetch-failed" };
  }
}

// FULL RULES RECONCILIATION (2026-08-13, pre-season proof: "did we confirm all of our rules
// produce the same results as ESPN did last season?"). The kicker audit's recipe widened to
// EVERY position: for each lineup slot group, the season's real player lines with ESPN's own
// appliedStats — the per-statId points ESPN actually paid — so a reconciliation script can
// diff every exercised coefficient against our rules doc to the penny, and surface any statId
// ESPN paid that our map doesn't carry. Read-only, diag-only (no suite fixture — the kicker
// audit's own posture); slot-only filters are the mode proven to work on past seasons.
async function lgEspnRulesAudit(body) {
  const cookies = ffCookies();
  if (!cookies) return { ok: false, reason: "fantasy-not-configured" };
  const year = Number(body?.season) >= 2020 ? Number(body.season) : 2025;
  const base = `${FF_BASE}/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${FF_LEAGUE_ID}?scoringPeriodId=0&view=kona_player_info`;
  const players = [];
  const perSlot = {};
  for (const slot of [0, 2, 4, 6, 16, 17]) { // QB RB WR TE DST K
    let j = null;
    try {
      const r = await fetch(base, { headers: {
        "User-Agent": UA, accept: "application/json", Cookie: cookies,
        "X-Fantasy-Filter": JSON.stringify({ players: { filterSlotIds: { value: [slot] }, limit: Number(body?.limit) > 0 ? Number(body.limit) : 40 } }),
      } });
      if (r.status === 401 || r.status === 403) return { ok: false, reason: "fantasy-auth-expired" };
      if (r.ok) j = await r.json();
    } catch { /* one slot failing shouldn't sink the others */ }
    const pool = j?.players || [];
    perSlot[slot] = pool.length;
    for (const e of pool) {
      const p = e?.player || {};
      const line = (p?.stats || []).find((s) => s?.statSourceId === 0 && s?.statSplitTypeId === 0 && Number(s?.seasonId) === year);
      if (!line || line.appliedTotal == null) continue;
      players.push({
        name: p?.fullName || "", espnId: p?.id ?? null, posId: p?.defaultPositionId ?? null,
        appliedTotal: line.appliedTotal, stats: line.stats || {}, appliedStats: line.appliedStats || {},
      });
    }
  }
  return { ok: true, season: year, perSlot, players };
}

// Bounded read-only ESPN probe (2026-08-13, the rules reconciliation's iteration loop): the
// slot-filtered kona recipe that worked on 2026-08-07 400s today and past-season kona lines
// come back with EMPTY appliedStats — ESPN moved, and finding the current recipe by
// deploy-per-guess is the wrong loop. Views are ALLOWLISTED (never an open proxy), the league
// id is pinned server-side as everywhere else, and the response is size-capped raw JSON for a
// diagnosis script to dissect. Family-secret-gated like every action here.
const PROBE_VIEWS = new Set(["mBoxscore", "mMatchupScore", "mMatchup", "mRoster", "mSettings", "kona_player_info", "kona_playercard"]);
async function lgEspnProbe(body) {
  const cookies = ffCookies();
  if (!cookies) return { ok: false, reason: "fantasy-not-configured" };
  const year = Number(body?.season) >= 2018 ? Number(body.season) : 2025;
  const views = (Array.isArray(body?.views) ? body.views : []).filter((v) => PROBE_VIEWS.has(v));
  if (!views.length) return { ok: false, reason: "no-views" };
  const sp = Number(body?.scoringPeriodId);
  const qp = [Number.isFinite(sp) ? "scoringPeriodId=" + sp : "", ...views.map((v) => "view=" + v)].filter(Boolean).join("&");
  const url = `${FF_BASE}/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${FF_LEAGUE_ID}?${qp}`;
  const headers = { "User-Agent": UA, accept: "application/json", Cookie: cookies };
  if (body?.filter && typeof body.filter === "object") headers["X-Fantasy-Filter"] = JSON.stringify(body.filter).slice(0, 4000);
  try {
    const r = await fetch(url, { headers });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: "fantasy-auth-expired" };
    const text = await r.text();
    return { ok: r.ok, status: r.status, bytes: text.length, body: text.slice(0, 900000) };
  } catch (e) {
    return { ok: false, reason: "fetch-failed" };
  }
}

// WEEKLY ESPN PROJECTIONS (2026-08-13, the Grok projection adjuster's baseline). ESPN's own
// per-player weekly projection line (statSourceId 1, statSplitTypeId 1) arrives ALREADY in the
// league's own scoring (appliedTotal — the same rules the 2025 reconciliation proved to the
// penny), for rostered players AND free agents alike: kona_player_info sorted by percentOwned,
// one bounded call covering everyone the league could plausibly start or claim. Verified LIVE
// on the current season before this was written (past-season kona is the recipe that broke;
// current-season is what this asks for). Slimmed to espn id + name + the one number. Never an
// open proxy — the league id is pinned, the limit capped, family-secret-gated like everything.
async function lgEspnProjections(body) {
  const cookies = ffCookies();
  if (!cookies) return { ok: false, reason: "fantasy-not-configured" };
  const year = ffSeason(body);
  const week = Number(body?.week);
  if (!(week >= 1 && week <= 18)) return { ok: false, reason: "bad-week" };
  const limit = Math.min(Math.max(Number(body?.limit) || 300, 1), 400);
  const url = `${FF_BASE}/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${FF_LEAGUE_ID}?scoringPeriodId=${week}&view=kona_player_info`;
  const headers = { "User-Agent": UA, accept: "application/json", Cookie: cookies,
    "X-Fantasy-Filter": JSON.stringify({ players: { limit, sortPercOwned: { sortAsc: false, sortPriority: 1 } } }) };
  try {
    const r = await fetch(url, { headers });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: "fantasy-auth-expired" };
    if (!r.ok) return { ok: false, reason: "http-" + r.status };
    const data = await r.json();
    const players = [];
    for (const p of (data?.players || [])) {
      const pl = p?.player || {};
      const line = (pl.stats || []).find((s) => s && s.statSourceId === 1 && s.statSplitTypeId === 1
        && s.scoringPeriodId === week && s.seasonId === year);
      if (!line || line.appliedTotal == null) continue;
      players.push({
        espnId: pl.id,
        name: pl.fullName || "",
        posId: pl.defaultPositionId ?? null,
        pctOwned: Math.round(((pl.ownership && pl.ownership.percentOwned) || 0) * 10) / 10,
        proj: Math.round(line.appliedTotal * 100) / 100,
      });
    }
    return { ok: true, season: year, week, players };
  } catch (e) {
    return { ok: false, reason: "fetch-failed" };
  }
}

// ESPN history import (plan §4.8) — one past season per call; the client
// loops seasons backward until the import runs dry. Slimmed hard: final
// standings + the champion + every real matchup's final score, nothing
// else — once this lands in Firestore as `hist_<season>` the cookie's job
// on that season is done for good (the record book/rivalries never touch
// the network again). Unknown season / empty league -> {ok:false,
// reason:"no-season"}, never a 500 — the client's loop treats that as "no
// more history to find" and stops.
async function lgEspnHistory(body) {
  const cookies = ffCookies();
  if (!cookies) return { ok: false, reason: "fantasy-not-configured" };
  const season = Number(body?.season);
  if (!(season >= 2000 && season <= 2100)) return { ok: false, reason: "no-season" };
  const views = ["mMatchupScore", "mTeam", "mSettings"];
  const vq = views.map((v) => "view=" + v).join("&");
  // Past-season league reads sometimes want scoringPeriodId=0 (the kicker
  // audit's finding, above) — try the plain form first, then that one.
  const urls = [
    `${FF_BASE}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${FF_LEAGUE_ID}?${vq}`,
    `${FF_BASE}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${FF_LEAGUE_ID}?scoringPeriodId=0&${vq}`,
  ];
  let j = null, lastErr = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, accept: "application/json", Cookie: cookies } });
      if (r.status === 401 || r.status === 403) return { ok: false, reason: "fantasy-auth-expired" };
      if (!r.ok) { lastErr = "http-" + r.status; continue; }
      const data = await r.json();
      if (Array.isArray(data?.teams) && data.teams.length) { j = data; break; }
      lastErr = "no-season"; // valid response, but nobody there — try the other URL form once more
    } catch (e) { lastErr = "fetch-failed"; }
  }
  if (!j) return { ok: false, reason: lastErr || "no-season" };
  try {
    const teams = j.teams.map((t) => {
      const rec = t?.record?.overall || {};
      return {
        id: t?.id ?? 0,
        name: ffTeamName(t),
        abbrev: t?.abbrev || "",
        owner: ffOwnerName(t, j?.members),
        w: Number(rec.wins) || 0,
        l: Number(rec.losses) || 0,
        t: Number(rec.ties) || 0,
        pf: Number(rec.pointsFor) || 0,
        pa: Number(rec.pointsAgainst) || 0,
        place: t?.rankCalculatedFinal ?? t?.playoffSeed ?? null,
      };
    });
    const champT = j.teams.find((t) => t?.rankCalculatedFinal === 1);
    const champion = champT ? { teamId: champT.id ?? 0, name: ffTeamName(champT) } : null;
    const matchups = [];
    for (const m of (Array.isArray(j?.schedule) ? j.schedule : [])) {
      const h = m?.home, a = m?.away;
      if (!h || !a || h.teamId == null || a.teamId == null) continue; // bye/incomplete pairing
      const hp = Number(h.totalPoints) || 0, ap = Number(a.totalPoints) || 0;
      if (!hp && !ap) continue; // unplayed/future — skip zero-zero
      matchups.push({ week: m?.matchupPeriodId ?? 0, home: h.teamId, away: a.teamId, homePts: hp, awayPts: ap });
    }
    return { ok: true, season, leagueName: j?.settings?.name || "", teams, champion, matchups };
  } catch {
    return { ok: false, reason: "bad-shape" };
  }
}

// GIF search proxy (plan §4.5). PROVIDER HISTORY, and why there is no Tenor path any more:
// this launched on Tenor, but Google announced the public Tenor API's discontinuation on
// 2026-01-13 and TERMINATED every key and agreement on 2026-06-30 — the industry migrated
// (WhatsApp/X to GIPHY, Bluesky to Klipy). The proxy now speaks both survivors and picks by
// whichever key is configured:
//   GIPHY_API_KEY — developers.giphy.com (instant free key; rating=pg, family posture)
//   KLIPY_API_KEY — klipy.com/developers (the ex-Tenor team; the key rides in the PATH)
// GIPHY wins when both are set. No key -> { ok:false, reason:"gif-not-configured" }, never a
// 500 — the client hides the GIF affordance on that reason. The WIRE CONTRACT is unchanged
// from the Tenor era ({ ok, gifs:[{url, preview}] }): the server normalizes, the client
// never learns the vendor, and a future migration is this function alone again.
async function lgGifSearch(body) {
  const giphy = process.env.GIPHY_API_KEY, klipy = process.env.KLIPY_API_KEY;
  if (!giphy && !klipy) return { ok: false, reason: "gif-not-configured" };
  const q = String(body?.q || "").trim();
  if (!q) return { ok: true, gifs: [] };
  try {
    if (giphy) {
      const base = process.env.GIPHY_BASE_URL || "https://api.giphy.com";
      const url = `${base}/v1/gifs/search?api_key=${encodeURIComponent(giphy)}&q=${encodeURIComponent(q)}&limit=12&rating=pg&bundle=messaging_non_clips`;
      const r = await fetch(url);
      if (!r.ok) return { ok: false, reason: "http-" + r.status };
      const j = await r.json();
      const gifs = (Array.isArray(j?.data) ? j.data : []).map((res) => {
        const im = res?.images || {};
        return { url: im?.fixed_height?.url || im?.original?.url || "",
          preview: im?.fixed_height_small?.url || im?.fixed_height?.url || "" };
      }).filter((g) => g.url);
      return { ok: true, gifs };
    }
    const base = process.env.KLIPY_BASE_URL || "https://api.klipy.com";
    const url = `${base}/api/v1/${encodeURIComponent(klipy)}/gifs/search?q=${encodeURIComponent(q)}&per_page=12&customer_id=gffl`;
    const r = await fetch(url);
    if (!r.ok) return { ok: false, reason: "http-" + r.status };
    const j = await r.json();
    const rows = Array.isArray(j?.data?.data) ? j.data.data : Array.isArray(j?.data) ? j.data : [];
    const gifs = rows.map((res) => {
      const f = res?.file || {};
      const pick = (v) => (v && ((v.gif && v.gif.url) || (v.webp && v.webp.url))) || "";
      return { url: pick(f.md) || pick(f.hd) || pick(f.sm), preview: pick(f.xs) || pick(f.sm) || pick(f.md) };
    }).filter((g) => g.url);
    return { ok: true, gifs };
  } catch (e) {
    return { ok: false, reason: "fetch-failed" };
  }
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, reason: "method" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, reason: "bad-json" }, 400); }
  const secret = SECRET();
  if (!secret || body?.secret !== secret) return json({ ok: false, reason: "unauthorized" }, 401);

  const action = String(body?.action || "");
  if (action === "lg_espn_settings") return json(await lgEspnSettings(body));
  if (action === "lg_espn_rosters") return json(await lgEspnRosters(body));
  if (action === "lg_espn_rosters_season") return json(await lgEspnRostersSeason(body));
  if (action === "lg_espn_kicker_audit") return json(await lgEspnKickerAudit(body));
  if (action === "lg_espn_rules_audit") return json(await lgEspnRulesAudit(body));
  if (action === "lg_espn_projections") return json(await lgEspnProjections(body));
  if (action === "lg_espn_probe") return json(await lgEspnProbe(body));
  if (action === "lg_espn_history") return json(await lgEspnHistory(body));
  if (action === "lg_gif_search") return json(await lgGifSearch(body));
  return json({ ok: false, reason: "unknown-action" });
};
