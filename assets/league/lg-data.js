// lg-data.js — GFFL live data engine. The fftest.html engine (field-tested on
// the 2026 HOF game) promoted into the product and extended per plan §7:
//  · one normalized stat schema fed by EITHER provider alone
//  · rules-doc-driven scoring (nothing hardcoded)
//  · ESPN-only gaps closed: DST derived from the opponent's offensive box +
//    scoring plays; FG distances + 2-pt conversions parsed from scoring plays
//  · source-health state machine: dual -> espn-only / sleeper-only, automatic
//  · change events carry fantasy-point deltas (the matchup feed's fuel)
"use strict";
(function () {
  const LG = window.LG;
  const D = (LG.data = {});

  const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
  const SLP = "https://api.sleeper.app/v1";

  // Sleeper team abbrevs differ from ESPN only for Washington.
  const slpTeam = (ab) => (ab === "WSH" ? "WAS" : ab || "");
  D.slpTeam = slpTeam;

  // Nickname aliases (normalized espn name -> normalized sleeper name). The
  // HOF-game finding; extend as cases appear. Persisted overrides can join in S3.
  const ALIAS = { "bam knight": "zonovan knight" };
  function normName(n) {
    n = String(n || "").toLowerCase().replace(/[^a-z ]/g, "")
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").trim().replace(/ +/g, " ");
    return ALIAS[n] || n;
  }
  D.normName = normName;
  const nameKey = (name, teamAb) => normName(name) + "|" + slpTeam(teamAb);

  // ---------------- normalized schema + scoring ----------------
  const KEYS = [
    "pass_yd", "pass_td", "pass_int", "pass_2pt",
    "rush_yd", "rush_td", "rush_2pt",
    "rec", "rec_yd", "rec_td", "rec_2pt",
    "fum_lost",
    "fg_0_39", "fg_40_49", "fg_50", "fg_miss", "xp_made", "xp_miss",
    "dst_sack", "dst_int", "dst_fum_rec", "dst_td", "dst_safety", "dst_blk",
    "off_fum_td",
    // Kicker audit 2026-08-07 (Badgley reconciled EXACTLY): statId 214 =
    // FG made YARDS at 0.1/yd — the league's ONLY per-make FG scoring.
    // 206 = 2-pt conversion return TD (DST), 209 = 1-pt safety (both rare).
    "fg_made_yd", "dst_2pt_ret", "one_pt_safety",
  ];
  D.KEYS = KEYS;
  const empty = () => { const o = {}; for (const k of KEYS) o[k] = 0; o.dst_pa = null; return o; };

  // dst_pa scores through brackets; everything else is value × points.
  function paPoints(pa, sc) {
    if (pa == null) return 0;
    if (pa === 0) return sc.dst_pa_0 ?? 0;
    if (pa <= 6) return sc.dst_pa_1_6 ?? 0;
    if (pa <= 13) return sc.dst_pa_7_13 ?? 0;
    if (pa <= 17) return sc.dst_pa_14_17 ?? 0;
    if (pa <= 27) return sc.dst_pa_18_27 ?? 0;
    if (pa <= 34) return sc.dst_pa_28_34 ?? 0;
    if (pa <= 45) return sc.dst_pa_35_45 ?? 0;
    return sc.dst_pa_46 ?? 0;
  }
  D.score = function (st, scoring) {
    const sc = scoring || (LG.rules && LG.rules.scoring) || {};
    let p = 0;
    for (const k of KEYS) p += (st[k] || 0) * (sc[k] || 0);
    p += paPoints(st.dst_pa, sc);
    // Yardage GAME BONUSES (live-league review): derived from the stat line,
    // mutually-exclusive brackets exactly as ESPN applies them.
    const bonus = (yd, lo, hi, kLo, kHi) =>
      yd >= hi ? (sc[kHi] || 0) : yd >= lo ? (sc[kLo] || 0) : 0;
    p += bonus(st.pass_yd || 0, 300, 400, "bonus_pass_300", "bonus_pass_400");
    p += bonus(st.rush_yd || 0, 100, 200, "bonus_rush_100", "bonus_rush_200");
    p += bonus(st.rec_yd || 0, 100, 200, "bonus_rec_100", "bonus_rec_200");
    return Math.round(p * 100) / 100;
  };

  // ---------------- sleeper normalization ----------------
  function normSlp(st) {
    const n = empty();
    n.pass_yd = st.pass_yd || 0; n.pass_td = st.pass_td || 0; n.pass_int = st.pass_int || 0;
    n.pass_2pt = st.pass_2pt || 0;
    n.rush_yd = st.rush_yd || 0; n.rush_td = st.rush_td || 0; n.rush_2pt = st.rush_2pt || 0;
    n.rec = st.rec || 0; n.rec_yd = st.rec_yd || 0; n.rec_td = st.rec_td || 0; n.rec_2pt = st.rec_2pt || 0;
    n.fum_lost = st.fum_lost || 0;
    n.fg_made_yd = st.fgm_yds || 0;
    n.dst_2pt_ret = st.def_2pt || 0;
    // one_pt_safety: no Sleeper key exists — once-a-decade play, reads 0 here
    // (documented approximation; ESPN side doesn't parse it either).
    n.fg_0_39 = (st.fgm_0_19 || 0) + (st.fgm_20_29 || 0) + (st.fgm_30_39 || 0);
    n.fg_40_49 = st.fgm_40_49 || 0; n.fg_50 = st.fgm_50p || 0;
    n.fg_miss = st.fgmiss || 0; n.xp_made = st.xpm || 0; n.xp_miss = st.xpmiss || 0;
    n.dst_sack = st.sack ?? st.def_sack ?? 0;
    n.dst_int = st.int ?? st.def_int ?? 0;
    n.dst_fum_rec = st.fum_rec ?? st.def_fum_rec ?? 0;
    n.dst_td = (st.def_td || 0) + (st.def_st_td || 0) + (st.st_td || 0);
    n.dst_safety = st.safe ?? st.safety ?? 0;
    n.dst_blk = st.blk_kick || 0;
    n.off_fum_td = st.fum_rec_td || 0;
    if (st.pts_allow != null) n.dst_pa = st.pts_allow;
    return n;
  }
  D.normSlp = normSlp;

  // ---------------- espn parsing ----------------
  // Box score labels (live-verified shapes; same categories sports.mjs slims).
  function parseEspnBox(summary) {
    const out = new Map(); // espnId -> {meta, stats}
    for (const t of (summary?.boxscore?.players || [])) {
      const teamAb = t?.team?.abbreviation || "";
      for (const cat of (t?.statistics || [])) {
        const labels = cat.labels || [];
        const gi = {}; labels.forEach((l, i) => { gi[l] = i; });
        for (const a of (cat.athletes || [])) {
          const ath = a.athlete || {};
          const id = ath.id != null ? String(ath.id) : null;
          if (!id) continue;
          const rec = out.get(id) || {
            meta: { name: ath.displayName || ath.shortName || id, pos: (ath.position || {}).abbreviation || "", team: teamAb },
            stats: empty(), raw: {},
          };
          const v = a.stats || [];
          const g = (lab) => (gi[lab] != null ? v[gi[lab]] : undefined);
          const num = (lab) => { const x = parseFloat(g(lab)); return isNaN(x) ? 0 : x; };
          const S = rec.stats, R = rec.raw;
          if (cat.name === "passing") {
            const ca = String(g("C/ATT") || "");
            if (ca.includes("/")) { const [c, at] = ca.split("/").map(Number); R.pass_cmp = c || 0; R.pass_att = at || 0; }
            S.pass_yd = num("YDS"); S.pass_td = num("TD"); S.pass_int = num("INT");
          } else if (cat.name === "rushing") {
            R.rush_att = num("CAR"); S.rush_yd = num("YDS"); S.rush_td = num("TD");
          } else if (cat.name === "receiving") {
            S.rec = num("REC"); S.rec_yd = num("YDS"); S.rec_td = num("TD"); R.rec_tgt = num("TGTS");
          } else if (cat.name === "fumbles") {
            S.fum_lost = num("LOST");
          } else if (cat.name === "kicking") {
            const fg = String(g("FG") || ""), xp = String(g("XP") || "");
            if (fg.includes("/")) { const [m, at] = fg.split("/").map(Number); R.fg_made = m || 0; S.fg_miss = Math.max(0, (at || 0) - (m || 0)); }
            if (xp.includes("/")) { const [m, at] = xp.split("/").map(Number); S.xp_made = m || 0; S.xp_miss = Math.max(0, (at || 0) - (m || 0)); }
          }
          out.set(id, rec);
        }
      }
    }
    return out;
  }
  D.parseEspnBox = parseEspnBox;

  // FG distances + 2-pt conversions live only in the scoring plays (the fftest
  // checklist finding — closed here at build time, plan §7). Best-effort text
  // parsing; anything unparsed falls back to the shortest bucket, flagged.
  function applyScoringPlays(summary, box) {
    const plays = summary?.scoringPlays || [];
    const kickersFg = new Map(); // espnId -> {b: bucketCounts}
    const byName = new Map();
    for (const [id, rec] of box) byName.set(normName(rec.meta.name), id);
    const credit2pt = (name, stat) => {
      const id = byName.get(normName(name));
      if (id && box.get(id)) box.get(id).stats[stat] += 1;
    };
    for (const p of plays) {
      const text = String(p?.text || "");
      const type = String(p?.type || "");
      if (type === "FG" || /field goal/i.test(text)) {
        const m = text.match(/^(.*?)\s+(\d{1,2})\s*Yd\b/i);
        if (m) {
          const id = byName.get(normName(m[1]));
          if (id) {
            const rec = kickersFg.get(id) || { fg_0_39: 0, fg_40_49: 0, fg_50: 0, yds: 0 };
            const yd = Number(m[2]);
            rec[yd >= 50 ? "fg_50" : yd >= 40 ? "fg_40_49" : "fg_0_39"]++;
            rec.yds += yd;
            kickersFg.set(id, rec);
          }
        }
      }
      const two = text.match(/\(([^)]*two[- ]point[^)]*)\)/i);
      if (two) {
        const clause = two[1];
        let m = clause.match(/([A-Za-z.'\- ]+?)\s+pass\s+to\s+([A-Za-z.'\- ]+?)\s+for/i);
        if (m) { credit2pt(m[1], "pass_2pt"); credit2pt(m[2], "rec_2pt"); }
        else {
          m = clause.match(/([A-Za-z.'\- ]+?)\s+(run|rush)\b/i);
          if (m) credit2pt(m[1], "rush_2pt");
        }
      }
    }
    // Distances into the kickers' lines; box totals win if plays undercount
    // (a play feed can lag) — leftovers land in the short bucket, flagged.
    for (const [id, rec] of box) {
      const made = rec.raw.fg_made || 0;
      if (!made) continue;
      const d = kickersFg.get(id) || { fg_0_39: 0, fg_40_49: 0, fg_50: 0, yds: 0 };
      const seen = d.fg_0_39 + d.fg_40_49 + d.fg_50;
      rec.stats.fg_0_39 = d.fg_0_39 + Math.max(0, made - seen);
      rec.stats.fg_40_49 = d.fg_40_49;
      rec.stats.fg_50 = d.fg_50;
      // Made-yards (statId 214, 0.1/yd): exact from parsed plays; a lagging
      // play feed's uncounted makes approximate at 33 yds (fgApprox flags it).
      rec.stats.fg_made_yd = (d.yds || 0) + Math.max(0, made - seen) * 33;
      if (seen < made) rec.raw.fgApprox = true;
    }
  }

  // DST line for each team, derived from the OPPONENT's offensive box (their
  // thrown INTs are your INTs, their sacks-taken are your sacks) + scoring
  // plays (return/blocked TDs, safeties) + the header score (points allowed).
  function deriveEspnDst(summary) {
    const comp = summary?.header?.competitions?.[0];
    const comps = comp?.competitors || [];
    const teams = summary?.boxscore?.teams || [];
    const statOf = (t, names) => {
      for (const s of (t?.statistics || [])) {
        if (names.includes(s?.name)) return String(s?.displayValue ?? "");
      }
      return "";
    };
    const out = new Map(); // "dst_<slpTeam>" -> {meta, stats}
    for (const me of teams) {
      const myAb = me?.team?.abbreviation || "";
      const opp = teams.find((t) => t !== me);
      if (!opp) continue;
      const st = empty();
      const sacks = statOf(opp, ["sacksYardsLost", "sacks"]);
      st.dst_sack = parseFloat(sacks.split("-")[0]) || 0;
      st.dst_int = parseFloat(statOf(opp, ["interceptions"])) || 0;
      st.dst_fum_rec = parseFloat(statOf(opp, ["fumblesLost"])) || 0;
      const oppComp = comps.find((c) => c?.team?.abbreviation === (opp?.team?.abbreviation || ""));
      st.dst_pa = oppComp && oppComp.score != null ? Number(oppComp.score) : null;
      for (const p of (summary?.scoringPlays || [])) {
        if ((p?.team?.abbreviation || "") !== myAb) continue;
        const text = String(p?.text || "");
        if (/interception return|fumble return|punt return|kickoff return|blocked .* (return|touchdown)/i.test(text)) st.dst_td++;
        if (String(p?.type || "") === "SF" || /safety/i.test(text)) st.dst_safety++;
      }
      out.set("dst_" + slpTeam(myAb), { meta: { name: myAb + " D/ST", pos: "DST", team: myAb }, stats: st });
    }
    return out;
  }
  D.deriveEspnDst = deriveEspnDst;

  // ---------------- state ----------------
  D.S = {
    players: new Map(),        // key -> {key,name,pos,team,espn:{stats,raw,last},slp:{stats,last,official},merged,pts,src,conflict}
    events: [],                // newest first, {t,src,key,name,stat,from,to,dPts}
    games: new Map(),          // slpTeam -> {eventId, state, period, clock, detail, kickoff, rz, oppAb}
    nflEvents: [],             // the FULL weekly slate, one row per game — feeds the Scores tab
    espnSeeded: false, slpSeeded: false,
    espnKeyByName: new Map(), slpRowKeyByName: new Map(),
    slpPlayers: null, slpByEspn: null, slpByName: null, slpProj: null,
    // The AUTHORITATIVE NFL week each provider says its live data belongs to (adversarial
    // review 2026-08-08, findings 1/3/7/9). The engine has exactly ONE week's worth of rows
    // in memory at a time; anything that writes a PERMANENT per-week record must be able to
    // ask "which week is this?" and refuse rather than guess. null = unknown (not yet
    // polled, or the provider didn't say) — also a refusal, never an assumption.
    espnWeek: null, slpWeek: null,
    // cands is the Sleeper stats bucket to poll. It is now ALWAYS exactly the authoritative
    // week (or empty when Sleeper never told us one) — the old ["<wk>", "<wk+1>", "1"]
    // rotation could, and did, LOCK onto week 1's completed stat lines any time the current
    // week's bucket was still empty (Tue->Thu, every week of the season) and serve them as
    // this week's live scoring, permanently, for the life of the tab (finding 9).
    slpBucket: { cands: [], idx: 0, locked: false },
    sumCursor: 0,             // rotating offset into the per-poll ESPN summary window (finding 13)
    health: {
      espn: { failN: 0, lastOk: 0, lastChange: 0 },
      slp: { failN: 0, lastOk: 0, lastChange: 0 },
      mode: "dual", note: "",
    },
    tracked: new Set(),        // slpTeam abbrevs whose games we fetch summaries for
    running: false, timer: null, pollMs: 20000,
  };
  D.EP = {}; // endpoint bookkeeping (fftest pattern) — feeds the health page

  async function fx(name, url) {
    const ep = D.EP[name] || (D.EP[name] = { n: 0, okN: 0, status: "—", ms: 0, bytes: 0, lastAt: 0, err: "" });
    ep.url = url; ep.n++;
    const t0 = performance.now();
    try {
      const r = await fetch(url, { cache: "no-store" });
      ep.status = r.status; ep.ms = Math.round(performance.now() - t0);
      const txt = await r.text();
      ep.bytes = txt.length; ep.lastAt = Date.now();
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = JSON.parse(txt);
      ep.okN++; ep.err = "";
      return j;
    } catch (e) {
      ep.err = String((e && e.message) || e); ep.lastAt = Date.now();
      throw e;
    }
  }
  D.fx = fx;

  // ---------------- sleeper bootstrap ----------------
  D.slpReady = null;
  D.initSleeper = function () {
    if (D.slpReady) return D.slpReady;
    D.slpReady = (async () => {
      try {
        const st = await fx("sleeper state", `${SLP}/state/nfl`);
        D.S.slpState = st || {};
        const wk = Number(st && (st.week != null ? st.week : st.leg));
        // ONE candidate — the week Sleeper itself says we're in. Never a "1" fallback:
        // week 1's bucket is the one bucket that is ALWAYS full, so a fallback rotation
        // reliably locked onto it and served completed week-1 lines as live scoring
        // (finding 9). No week -> no stats at all, which reads honestly as a degraded
        // source (health flips to espn-only) instead of as wrong numbers.
        if (wk >= 1 && wk <= 22) { D.S.slpWeek = wk; D.S.slpBucket.cands = [String(wk)]; }
        else { D.S.slpWeek = null; D.S.slpBucket.cands = []; }
      } catch (e) { D.S.slpWeek = null; D.S.slpBucket.cands = []; }
      try {
        const dump = await fx("sleeper players", `${SLP}/players/nfl`);
        const byEspn = new Map(), byName = new Map(), byId = new Map();
        for (const pid in dump) {
          const p = dump[pid]; if (!p || typeof p !== "object") continue;
          const meta = {
            pid, name: p.full_name || ((p.first_name || "") + " " + (p.last_name || "")).trim() || pid,
            team: p.team || "", pos: p.position || "", espn_id: p.espn_id != null ? String(p.espn_id) : null,
            injury: p.injury_status || "", searchRank: p.search_rank != null ? p.search_rank : null,
          };
          if (meta.pos === "DEF") meta.name = pid + " D/ST";
          if (meta.espn_id) byEspn.set(meta.espn_id, meta);
          if (meta.team) byName.set(nameKey(meta.name, meta.team), meta);
          byId.set(pid, meta);
        }
        D.S.slpPlayers = byId; D.S.slpByEspn = byEspn; D.S.slpByName = byName;
      } catch (e) { /* health carries it */ }
      try {
        const seasonType = D.S.slpState?.season_type || "regular";
        const season = D.S.slpState?.season || String(LG.SEASON);
        const wk = D.S.slpBucket.cands[0];
        if (!wk) return; // no authoritative week -> no projections either (never week 1's)
        const proj = await fx("sleeper projections", `${SLP}/projections/nfl/${seasonType}/${season}/${wk}`);
        if (proj && typeof proj === "object") D.S.slpProj = proj;
      } catch (e) { /* optional */ }
    })();
    return D.slpReady;
  };

  // The ONE authoritative answer to "which NFL week is the data currently in memory?"
  // (adversarial review 2026-08-08). null = unknown OR the two providers disagree — either
  // way a caller writing a permanent per-week record must refuse rather than guess, because
  // a disagreement means the rows in memory are a MIX of two weeks.
  D.engineWeek = function () {
    const e = D.S.espnWeek, s = D.S.slpWeek;
    if (e != null && s != null) return e === s ? e : null;
    return e != null ? e : (s != null ? s : null);
  };

  // Archived per-week stats — Sleeper's own /stats/nfl/<type>/<season>/<week> endpoint, which
  // serves ANY completed week, not just the live one. This is the ONLY honest way to finalize
  // a week the live engine has already rolled past (findings 1/3/7): the commissioner's
  // clearly-labelled fallback backfills the REAL week's numbers instead of stamping whatever
  // happens to be on the board today. Returns a Map keyed EXACTLY as the live poll keys rows
  // (dst_<pid> / espn_id / slp_<pid>) -> league-scored points, or null when unavailable.
  D.weekStats = async function (week) {
    await D.initSleeper();
    if (!D.S.slpPlayers) return null;
    const st = D.S.slpState || {};
    const seasonType = st.season_type || "regular";
    const season = st.season || String(LG.SEASON);
    let j;
    try { j = await fx("sleeper week stats " + week, `${SLP}/stats/nfl/${seasonType}/${season}/${week}`); }
    catch (e) { return null; }
    if (!j || typeof j !== "object") return null;
    const out = new Map();
    for (const pid in j) {
      const row = j[pid]; if (!row || typeof row !== "object") continue;
      const meta = D.S.slpPlayers.get(pid);
      if (!meta) continue;
      const pts = D.score(normSlp(row));
      out.set(meta.pos === "DEF" ? "dst_" + pid : (meta.espn_id || "slp_" + pid), pts);
      // A DST rostered by ESPN abbrev (the roster importer's own key shape) must resolve too.
      if (meta.pos === "DEF" && meta.team) out.set("dst_" + slpTeam(meta.team), pts);
    }
    return out.size ? out : null;
  };

  // Weekly projection (league-scored, not pts_ppr) for a roster player.
  D.projFor = function (key) {
    if (!D.S.slpProj || !D.S.slpPlayers) return null;
    let pid = null;
    if (String(key).startsWith("slp_")) pid = String(key).slice(4);
    else if (String(key).startsWith("dst_")) pid = String(key).slice(4);
    else {
      for (const [id, m] of D.S.slpPlayers) { if (m.espn_id === String(key)) { pid = id; break; } }
      if (!pid) {
        const row = D.S.players.get(key);
        if (row) { const m = D.S.slpByName && D.S.slpByName.get(nameKey(row.name, row.team)); if (m) pid = m.pid; }
      }
    }
    const st = pid != null ? D.S.slpProj[pid] : null;
    if (!st) return null;
    return D.score(normSlp(st));
  };

  // ---------------- free agent search (S3 waivers; item 1's browsable table) ----------------
  // Name search over the Sleeper directory (the only whole-NFL player list we
  // have). null = directory not loaded yet ("player search is warming up");
  // [] = loaded but nothing matched. Keys follow the SAME convention pollSleeper
  // uses (dst_<abbrev> / espn_id / slp_<pid> fallback) so a claimed/added
  // player's key matches whatever the live poll will key their stats under.
  // `opts.pos` (a roster position, or falsy/"ALL" for no filter) narrows the
  // scan; an EMPTY `q` is no longer "too short to search" — it's browse mode,
  // returning the best `opts.limit` free agents by Sleeper search_rank (best
  // first, unranked pushed to the bottom, alphabetical tiebreak) so the Moves
  // page has something to show before anyone types a letter. A genuinely
  // typed-but-too-short query (1-2 chars) still yields [] — unfiltered
  // substring matching on 1-2 letters is mostly noise.
  D.searchFA = function (q, ownedKeys, opts) {
    if (!D.S.slpPlayers) return null;
    opts = opts || {};
    const limit = opts.limit || 20;
    const pos = opts.pos && opts.pos !== "ALL" ? opts.pos : null;
    const needle = normName(q);
    if (needle.length > 0 && needle.length < 3) return [];
    const owned = ownedKeys || new Set();
    const out = [];
    for (const [pid, m] of D.S.slpPlayers) {
      if (!m.name || !m.team) continue;
      const mpos = m.pos === "DEF" ? "DST" : m.pos;
      if (pos && mpos !== pos) continue;
      if (needle && !normName(m.name).includes(needle)) continue;
      const key = m.pos === "DEF" ? "dst_" + pid : (m.espn_id || "slp_" + pid);
      if (owned.has(key)) continue;
      out.push({ key, name: m.name, pos: mpos, team: m.team, injury: m.injury || "", searchRank: m.searchRank });
    }
    out.sort((a, b) => (a.searchRank ?? 1e9) - (b.searchRank ?? 1e9) || a.name.localeCompare(b.name));
    return out.slice(0, limit);
  };

  // ---------------- diff engine ----------------
  function rowFor(key, meta) {
    let row = D.S.players.get(key);
    if (!row) {
      row = { key, name: (meta && meta.name) || key, pos: (meta && meta.pos) || "", team: (meta && meta.team) || "", espn: null, slp: null, official: null, injury: "" };
      D.S.players.set(key, row);
    }
    if (meta && meta.name) row.name = meta.name;
    if (meta && meta.pos && !row.pos) row.pos = meta.pos;
    if (meta && meta.team && !row.team) row.team = meta.team;
    return row;
  }
  function applySide(src, key, meta, stats, raw) {
    const row = rowFor(key, meta);
    const side = row[src] || (row[src] = { stats: empty(), raw: {}, last: 0 });
    const baseline = src === "espn" ? !D.S.espnSeeded : !D.S.slpSeeded;
    const scoring = (LG.rules && LG.rules.scoring) || {};
    for (const k of [...KEYS, "dst_pa"]) {
      const nv = stats[k] ?? (k === "dst_pa" ? null : 0);
      const ov = side.stats[k] ?? (k === "dst_pa" ? null : 0);
      if (nv !== ov) {
        side.last = Date.now();
        D.S.health[src].lastChange = Date.now();
        if (!baseline) {
          const dPts = k === "dst_pa"
            ? Math.round((paPoints(nv, scoring) - paPoints(ov, scoring)) * 10) / 10
            : Math.round(((nv || 0) - (ov || 0)) * (scoring[k] || 0) * 10) / 10;
          D.S.events.unshift({ t: Date.now(), src, key, name: row.name, stat: k, from: ov, to: nv, dPts });
          if (D.S.events.length > 600) D.S.events.length = 600;
        }
      }
    }
    side.stats = stats; if (raw) side.raw = raw;
  }

  // Freshest healthy side wins the display; disagreement > 0.5 pts flags ⚠.
  // Degraded modes pin to the surviving source (plan §7's display rule).
  function mergeRow(row) {
    const mode = D.S.health.mode;
    const e = row.espn, s = row.slp;
    let pick = null, src = "";
    if (mode === "espn-only") { pick = e; src = "espn"; }
    else if (mode === "sleeper-only") { pick = s; src = "slp"; }
    else if (e && s) { if (e.last >= s.last) { pick = e; src = "espn"; } else { pick = s; src = "slp"; } }
    else if (e) { pick = e; src = "espn"; }
    else if (s) { pick = s; src = "slp"; }
    row.src = src;
    row.pts = pick ? D.score(pick.stats) : null;
    // ⚠ means SETTLED disagreement: game final and the sources still differ.
    // During live play the freshest source legitimately leads by 10-40s
    // (measured) — flagging that would flash on every play.
    const g = D.S.games.get(slpTeam(row.team));
    row.conflict = !!(g && g.state === "post" && e && s && Math.abs(D.score(e.stats) - D.score(s.stats)) > 0.5);
    row.last = Math.max(e ? e.last : 0, s ? s.last : 0);
    return row;
  }
  D.mergeRow = mergeRow;

  // ---------------- pollers ----------------
  async function pollScoreboard() {
    const j = await fx("espn scoreboard", `${ESPN}/scoreboard`);
    // Which NFL week this slate IS (adversarial review 2026-08-08). The bare /scoreboard
    // endpoint always means "the current week" and says so in `week.number` — recording it
    // is what lets finalizeWeek refuse to stamp week N's permanent record with week N+1's
    // numbers (findings 1/3/7).
    const wkNum = Number(j?.week?.number);
    D.S.espnWeek = wkNum >= 1 && wkNum <= 22 ? wkNum : null;
    // D.S.games is REBUILT, never merged into. It used to only ever .set(), so a tab left
    // open across the Tuesday rollover kept last week's "post" entries forever — which made
    // finalizeWeek's "is every game final?" guard pass for ANY past week, in any week, byes
    // included (finding 1's widening note). Games that are no longer on the slate must
    // disappear; live red-zone state is carried across by eventId so it doesn't flicker.
    const prevGames = D.S.games;
    const games = new Map();
    // The FULL slate this week, one entry per GAME (not per team) — the Scores tab's NFL half
    // (league.html) reads this directly; a light parallel read of the same public no-key
    // endpoint the per-team loop below already polls, so no new network cost.
    const events = [];
    for (const ev of (j?.events || [])) {
      const c = ev.competitions && ev.competitions[0]; if (!c) continue;
      const st = (c.status && c.status.type) || {};
      const comps = c.competitors || [];
      const side = (comp) => comp ? { abbrev: comp.team?.abbreviation || "", name: comp.team?.shortDisplayName || comp.team?.abbreviation || "", score: comp.score != null ? String(comp.score) : "" } : null;
      // TV network + betting line (item 2's Scores tab cards) — same fields/paths
      // netlify/functions/sports.mjs already reads off this same public ESPN
      // scoreboard shape: broadcasts[0].names[0] for the network, odds[0].details
      // (a DISPLAY STRING ONLY, e.g. "PHI -3.5" — never a provider/price) for the
      // spread. Both are commonly absent (bye-week/international slates, odds
      // markets not yet posted) — "" degrades to "line simply isn't shown".
      events.push({
        id: String(ev.id || ""), date: ev.date || "",
        state: st.state || "pre", detail: st.shortDetail || "",
        period: c.status?.period || 0, clock: c.status?.displayClock || "",
        broadcast: c.broadcasts?.[0]?.names?.[0] || "",
        spread: (typeof c.odds?.[0]?.details === "string" ? c.odds[0].details : "").slice(0, 24),
        away: side(comps.find((x) => x.homeAway === "away")),
        home: side(comps.find((x) => x.homeAway === "home")),
      });
      for (const comp of comps) {
        const ab = comp?.team?.abbreviation; if (!ab) continue;
        const opp = comps.find((x) => x !== comp);
        const key = slpTeam(ab);
        const prev = prevGames.get(key);
        games.set(key, {
          eventId: String(ev.id), state: st.state || "pre",
          detail: st.shortDetail || "", period: c.status?.period || 0,
          clock: c.status?.displayClock || "", kickoff: ev.date || "",
          oppAb: opp?.team?.abbreviation || "",
          rz: !!(prev && prev.eventId === String(ev.id) && prev.rz),
          score: comp?.score, oppScore: opp?.score,
        });
      }
    }
    D.S.games = games;
    D.S.nflEvents = events;
  }
  D.pollScoreboard = pollScoreboard;

  async function pollEspnGame(eventId) {
    const j = await fx("espn summary " + eventId, `${ESPN}/summary?event=${eventId}`);
    const box = parseEspnBox(j);
    applyScoringPlays(j, box);
    for (const [id, rec] of box) {
      D.S.espnKeyByName.set(nameKey(rec.meta.name, rec.meta.team), id);
      const orphan = D.S.slpRowKeyByName.get(nameKey(rec.meta.name, rec.meta.team));
      if (orphan && orphan !== id && D.S.players.has(orphan)) {
        const old = D.S.players.get(orphan);
        const dst = rowFor(id, rec.meta);
        if (old.slp && !dst.slp) dst.slp = old.slp;
        if (old.official != null) dst.official = old.official;
        if (old.injury) dst.injury = old.injury;
        D.S.players.delete(orphan);
        D.S.slpRowKeyByName.delete(nameKey(rec.meta.name, rec.meta.team));
      }
      applySide("espn", id, rec.meta, rec.stats, rec.raw);
    }
    // NEVER derive a D/ST line from a game that hasn't kicked off (finding 14). Before
    // kickoff ESPN reports the header score as "0", so dst_pa reads 0 -> paPoints(0) ->
    // dst_pa_0, a free 5-point shutout credited to every starting defense all week. The
    // summary's own header is the authority here (the scoreboard map may not be warm yet).
    const gState = String(j?.header?.competitions?.[0]?.status?.type?.state
      || [...D.S.games.values()].find((g) => g.eventId === String(eventId))?.state || "");
    if (gState !== "pre") { for (const [key, rec] of deriveEspnDst(j)) applySide("espn", key, rec.meta, rec.stats); }
    // Red-zone: current drive's last play inside the opponent 20.
    const cur = j?.drives?.current;
    const plays = cur?.plays || [];
    const lastPlay = plays[plays.length - 1];
    const inRz = !!(cur && lastPlay && (lastPlay.end?.yardsToEndzone ?? 99) <= 20);
    const possAb = slpTeam(cur?.team?.abbreviation || "");
    for (const [ab, g] of D.S.games) {
      if (g.eventId === String(eventId)) { g.rz = inRz && ab === possAb; }
    }
    if (box.size) D.S.espnSeeded = true;
  }
  D.pollEspnGame = pollEspnGame;

  function slpStatsUrl() {
    const st = D.S.slpState || {};
    const seasonType = st.season_type || "regular";
    const season = st.season || String(LG.SEASON);
    const wk = D.S.slpBucket.cands[D.S.slpBucket.idx];
    if (!wk) return null; // no authoritative week -> refuse to poll ANY bucket (finding 9)
    return `${SLP}/stats/nfl/${seasonType}/${season}/${wk}`;
  }
  async function pollSleeper() {
    // The directory must be in before stats mean anything — and a directory
    // that FAILED to load must read as a failed poll (health depends on it),
    // with a retry armed for the next pass.
    if (D.slpReady) await D.slpReady;
    if (!D.S.slpPlayers) {
      D.slpReady = null; D.initSleeper();
      throw new Error("sleeper directory unavailable");
    }
    const url = slpStatsUrl();
    if (!url) throw new Error("sleeper week unknown");
    const j = await fx("sleeper stats", url);
    if (!j || typeof j !== "object") return;
    let n = 0;
    for (const pid in j) {
      const st = j[pid]; if (!st || typeof st !== "object") continue;
      const meta = D.S.slpPlayers && D.S.slpPlayers.get(pid);
      if (!meta) continue;
      if (D.S.tracked.size && !D.S.tracked.has(meta.team)) continue;
      let key;
      if (meta.pos === "DEF") key = "dst_" + pid;
      else key = meta.espn_id || D.S.espnKeyByName.get(nameKey(meta.name, meta.team)) || ("slp_" + pid);
      if (key === "slp_" + pid) D.S.slpRowKeyByName.set(nameKey(meta.name, meta.team), key);
      const row = rowFor(key, { name: meta.name, pos: meta.pos === "DEF" ? "DST" : meta.pos, team: meta.team });
      row.injury = meta.injury || row.injury;
      if (st.pts_ppr != null) row.official = st.pts_ppr;
      applySide("slp", key, {}, normSlp(st), st);
      n++;
    }
    if (n) { D.S.slpSeeded = true; D.S.slpBucket.locked = true; }
    else if (!D.S.slpBucket.locked && D.S.slpBucket.cands.length > 1) {
      // Kept only so a future multi-candidate policy still rotates; with the single
      // authoritative candidate above this is unreachable by construction, which is the
      // point — the bucket can never lock onto a week other than the current one.
      D.S.slpBucket.idx = (D.S.slpBucket.idx + 1) % D.S.slpBucket.cands.length;
    }
  }
  D.pollSleeper = pollSleeper;

  // ---------------- health / failover ----------------
  function anyLive() { for (const g of D.S.games.values()) if (g.state === "in") return true; return false; }
  D.anyLive = anyLive;
  function updateHealth() {
    const H = D.S.health, now = Date.now();
    const bad = (h, other) =>
      h.failN >= 3 ||
      (anyLive() && other.lastChange && now - other.lastChange < 3 * 60000 && h.lastOk && now - h.lastOk > 6 * 60000);
    const eBad = bad(H.espn, H.slp), sBad = bad(H.slp, H.espn);
    const prev = H.mode;
    H.mode = eBad && sBad ? "none" : eBad ? "sleeper-only" : sBad ? "espn-only" : "dual";
    H.note =
      H.mode === "dual" ? "" :
      H.mode === "espn-only" ? "Running on ESPN only — Sleeper unreachable" :
      H.mode === "sleeper-only" ? "Running on Sleeper only — ESPN unreachable" :
      "Both data sources unreachable — scores are STALE";
    if (H.mode !== prev && H.mode !== "dual") {
      D.S.events.unshift({ t: now, src: "sys", msg: H.note });
    }
    if (H.mode !== prev && H.mode === "dual" && prev !== "dual") {
      D.S.events.unshift({ t: now, src: "sys", msg: "Both data sources healthy again — back to dual mode" });
    }
  }
  D.updateHealth = updateHealth;

  // ---------------- orchestration ----------------
  D.trackTeams = function (abbrevs) { D.S.tracked = new Set(abbrevs.map(slpTeam)); };
  D.pollOnce = async function () {
    const jobs = [];
    jobs.push(pollScoreboard().then(() => { D.S.health.espn.lastOk = Date.now(); D.S.health.espn.failN = 0; })
      .catch(() => { D.S.health.espn.failN++; }));
    jobs.push(pollSleeper().then(() => { D.S.health.slp.lastOk = Date.now(); D.S.health.slp.failN = 0; })
      .catch(() => { D.S.health.slp.failN++; }));
    await Promise.allSettled(jobs);
    // Summaries for tracked teams' games (live games always; a FINAL box exactly once).
    D.S.fetchedFinal = D.S.fetchedFinal || new Set();
    const wanted = new Map();
    for (const ab of D.S.tracked) {
      const g = D.S.games.get(ab);
      if (g && (g.state === "in" || !D.S.fetchedFinal.has(g.eventId))) wanted.set(g.eventId, g);
    }
    // ROTATE the ≤8-per-cycle window (finding 13). `wanted` is rebuilt from D.S.tracked (a
    // Set with frozen insertion order) every cycle, so a plain .slice(0,8) fetched the SAME
    // 8 games forever and every game past the eighth was never refreshed again — silently,
    // since health only counts fetches that FAILED, not fetches never attempted. An 8-team
    // league's starters routinely span 10-14 NFL games on a Sunday. A rotating cursor
    // guarantees every tracked game is refreshed within ceil(n/8) cycles.
    const eids = [...wanted.keys()];
    const CAP = 8;
    let take = eids;
    if (eids.length > CAP) {
      const start = D.S.sumCursor % eids.length;
      take = [];
      for (let i = 0; i < CAP; i++) take.push(eids[(start + i) % eids.length]);
      D.S.sumCursor = (start + CAP) % eids.length;
    } else { D.S.sumCursor = 0; }
    const sums = take.map((eid) =>
      pollEspnGame(eid).then(() => {
        D.S.health.espn.lastOk = Date.now();
        const g = wanted.get(eid);
        // ONLY a genuinely final box consumes the once-token. This used to fire on any
        // non-live state, so a game polled while `pre` was struck off the list and its REAL
        // final box was never read — the ESPN side of every 1pm game froze at whatever the
        // last in-progress poll saw (finding 14).
        if (g && g.state === "post") D.S.fetchedFinal.add(eid);
      }).catch(() => { D.S.health.espn.failN++; })
    );
    await Promise.allSettled(sums);
    updateHealth();
    for (const row of D.S.players.values()) mergeRow(row);
    if (D.onUpdate) D.onUpdate();
  };
  D.start = function (ms) {
    D.S.pollMs = ms || (anyLive() ? 15000 : 60000);
    if (D.S.running) return;
    D.S.running = true;
    const loop = async () => {
      if (!D.S.running) return;
      await D.pollOnce().catch(() => {});
      D.S.timer = setTimeout(loop, anyLive() ? (ms || 15000) : 60000);
    };
    loop();
  };
  D.stop = function () { D.S.running = false; clearTimeout(D.S.timer); };

  // ---------------- matchup math ----------------
  // Live-adjusted projection for one starter: post -> actual; pre -> weekly
  // proj; in -> actual + remaining fraction of proj.
  D.liveProj = function (key) {
    const row = D.S.players.get(key);
    const pts = row && row.pts != null ? row.pts : 0;
    const team = slpTeam(row ? row.team : "");
    const g = D.S.games.get(team);
    const proj = D.projFor(key);
    if (!g || g.state === "post") return pts;
    if (g.state === "pre") return proj != null ? proj : pts;
    const period = g.period || 1;
    const [mm, ss] = String(g.clock || "0:00").split(":").map(Number);
    const minLeft = Math.max(0, (4 - Math.min(period, 4)) * 15 + (mm || 0) + (ss || 0) / 60);
    const frac = Math.min(1, minLeft / 60);
    return pts + (proj != null ? proj * frac : 0);
  };
  // {played, playing, left} for a set of starters.
  D.remaining = function (keys) {
    let played = 0, playing = 0, left = 0;
    for (const k of keys) {
      const row = D.S.players.get(k);
      const g = row ? D.S.games.get(slpTeam(row.team)) : null;
      const st = g ? g.state : "pre";
      if (st === "post") played++; else if (st === "in") playing++; else left++;
    }
    return { played, playing, left };
  };
  D.winProb = function (keysA, keysB) {
    const tot = (keys) => keys.reduce((s, k) => s + (D.liveProj(k) || 0), 0);
    const diff = tot(keysA) - tot(keysB);
    return 1 / (1 + Math.exp((-1.702 * diff) / 25));
  };
})();
