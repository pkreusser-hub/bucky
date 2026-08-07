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
      const pts = Number(it?.points ?? it?.pointsOverrides?.[16] ?? 0);
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

// Current ESPN rosters per team — the bridge that seeds GFFL rosters while
// ESPN is still where the league's players formally live.
async function lgEspnRosters(body) {
  const { data: j, err, year } = await ffFetch(["mRoster", "mTeam"], body);
  if (err) return { ok: false, reason: err };
  try {
    const teams = (Array.isArray(j?.teams) ? j.teams : []).map((t) => ({
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
    return { ok: true, season: year, teams };
  } catch {
    return { ok: false, reason: "bad-shape" };
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
  return json({ ok: false, reason: "unknown-action" });
};
