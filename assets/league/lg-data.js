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

  // EVERY factor that enters a score goes through this first (the "NaN" production report,
  // 2026-08-09). `x || 0` looks like it guards, and for a NaN it does (NaN is falsy) — but it
  // passes a TRUTHY non-number straight through, and `0 * "x"` is NaN. That is the whole
  // mechanism behind "none of the scores for players are showing up, they are saying nan":
  // ONE bad value anywhere in the scoring table poisons EVERY player, including players who
  // have zero of that stat, because the multiply happens for all 28 keys on every row. A
  // scoring table is persisted data (typed by a commissioner, imported from ESPN, round-tripped
  // through the Firestore codec), so it is untrusted input and is treated as such.
  const num = (v) => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : 0; };
  D.num = num; // test hook
  // dst_pa scores through brackets; everything else is value × points.
  // `?? 0` was the ONE unguarded read left in D.score: it catches null/undefined but NOT NaN
  // (NaN ?? 0 is NaN) and not a string ("" ?? 0 is "", which turns the running total into a
  // STRING and every later += into concatenation). num() closes both.
  function paPoints(pa, sc) {
    if (pa == null) return 0;
    const p = num(pa);
    if (p === 0) return num(sc.dst_pa_0);
    if (p <= 6) return num(sc.dst_pa_1_6);
    if (p <= 13) return num(sc.dst_pa_7_13);
    if (p <= 17) return num(sc.dst_pa_14_17);
    if (p <= 27) return num(sc.dst_pa_18_27);
    if (p <= 34) return num(sc.dst_pa_28_34);
    if (p <= 45) return num(sc.dst_pa_35_45);
    return num(sc.dst_pa_46);
  }
  D.score = function (st, scoring) {
    const sc = scoring || (LG.rules && LG.rules.scoring) || {};
    let p = 0;
    for (const k of KEYS) p += num(st[k]) * num(sc[k]);
    p += paPoints(st.dst_pa, sc);
    // Yardage GAME BONUSES (live-league review): derived from the stat line,
    // mutually-exclusive brackets exactly as ESPN applies them.
    const bonus = (yd, lo, hi, kLo, kHi) =>
      yd >= hi ? num(sc[kHi]) : yd >= lo ? num(sc[kLo]) : 0;
    p += bonus(num(st.pass_yd), 300, 400, "bonus_pass_300", "bonus_pass_400");
    p += bonus(num(st.rush_yd), 100, 200, "bonus_rush_100", "bonus_rush_200");
    p += bonus(num(st.rec_yd), 100, 200, "bonus_rec_100", "bonus_rec_200");
    // Every term above is finite by construction, so this is too — but the guard is kept as a
    // hard boundary: nothing downstream (a total, a projection, a feed delta, a weekly doc that
    // is written ONCE and can never be corrected) may ever receive a non-finite score.
    const out = Math.round(p * 100) / 100;
    return Number.isFinite(out) ? out : 0;
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
    // …and WHICH PART OF THE SEASON those rows belong to (ITEM 30, 2026-08-09). A week number
    // on its own is NOT provenance: preseason week 1 and regular-season week 1 are both "1",
    // and LG.currentWeek() clamps to 1 before SEASON_START, so in August the two agree
    // perfectly while the data underneath is preseason box scores. "pre" | "regular" | "post",
    // or null for unknown/not-yet-polled — and null is a refusal, exactly like the week is.
    espnSeasonType: null, slpSeasonType: null,
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
    loopStarts: 0,              // test hook (2026-08-08 perf fix) — see D.start()'s own comment
    injDirRefreshedAt: 0,       // S9 — wall-clock stamp of the last player-directory refetch
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
  // The player DIRECTORY fetch, split out of initSleeper (S9, 2026-08-11) so it can be re-run
  // later on its own — everything else initSleeper does (the current-week state, the
  // projections) is genuinely a once-per-session bootstrap and stays where it was.
  async function fetchPlayerDirectory() {
    const dump = await fx("sleeper players", `${SLP}/players/nfl`);
    const byEspn = new Map(), byName = new Map(), byId = new Map();
    for (const pid in dump) {
      const p = dump[pid]; if (!p || typeof p !== "object") continue;
      const meta = {
        pid, name: p.full_name || ((p.first_name || "") + " " + (p.last_name || "")).trim() || pid,
        team: p.team || "", pos: p.position || "", espn_id: p.espn_id != null ? String(p.espn_id) : null,
        injury: p.injury_status || "", searchRank: p.search_rank != null ? p.search_rank : null,
        // ⭐ ITEM 31 (2026-08-09). The directory has carried these all along and nothing
        // read them. depth_chart_order is 1 = starter, 2 = backup, 3 = third string —
        // which is exactly the question "who actually plays in a preseason game". Two
        // field reads per entry, no extra network, on a payload already being walked.
        depth: p.depth_chart_order != null && isFinite(Number(p.depth_chart_order))
          ? Number(p.depth_chart_order) : null,
        depthPos: p.depth_chart_position || "",
      };
      if (meta.pos === "DEF") meta.name = pid + " D/ST";
      if (meta.espn_id) byEspn.set(meta.espn_id, meta);
      if (meta.team) byName.set(nameKey(meta.name, meta.team), meta);
      byId.set(pid, meta);
    }
    D.S.slpPlayers = byId; D.S.slpByEspn = byEspn; D.S.slpByName = byName;
    D.bumpPidGen(); // the directory is one of the two sources pidForKey resolves through
  }
  D.initSleeper = function () {
    if (D.slpReady) return D.slpReady;
    D.slpReady = (async () => {
      try {
        const st = await fx("sleeper state", `${SLP}/state/nfl`);
        D.S.slpState = st || {};
        const wk = Number(st && (st.week != null ? st.week : st.leg));
        // Under the 2025 replay the live state is about the REAL current NFL week — the wrong
        // week AND the wrong season. Recording it would (a) give D.engineWeek() a non-null
        // answer, re-arming the auto-finalize/stale-week machinery the replay must keep silent,
        // and (b) point the live stats bucket at a completely unrelated week. So the directory
        // is still loaded (the whole app's player metadata + free-agent search depend on it)
        // and the WEEK is deliberately not.
        // Which part of the season Sleeper says we are in (ITEM 30). Recorded from the SAME
        // successful parse as the week, so the two can never disagree about which poll they
        // came from. Under the replay it is deliberately left null with the week.
        D.S.slpSeasonType = LG.SIM_2025 ? null : normSeasonType(st && st.season_type);
        if (LG.SIM_2025) { D.S.slpWeek = null; D.S.slpBucket.cands = []; }
        // ONE candidate — the week Sleeper itself says we're in. Never a "1" fallback:
        // week 1's bucket is the one bucket that is ALWAYS full, so a fallback rotation
        // reliably locked onto it and served completed week-1 lines as live scoring
        // (finding 9). No week -> no stats at all, which reads honestly as a degraded
        // source (health flips to espn-only) instead of as wrong numbers.
        else if (wk >= 1 && wk <= 22) { D.S.slpWeek = wk; D.S.slpBucket.cands = [String(wk)]; }
        else { D.S.slpWeek = null; D.S.slpBucket.cands = []; }
      } catch (e) { D.S.slpWeek = null; D.S.slpBucket.cands = []; }
      try { await fetchPlayerDirectory(); D.S.injDirRefreshedAt = Date.now(); }
      catch (e) { /* health carries it */ }
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

  // ---------------- S9's slow directory refresh (injury designations, 2026-08-11) ------------
  // The player-directory dump is the ONLY source of injury designations this app has, and
  // D.initSleeper's own load of it is a genuine ONCE-PER-SESSION bootstrap (memoized via
  // D.slpReady) — so without this, a designation baked into that one snapshot could never
  // change for the life of a tab, however long a family leaves it open on game day. Sleeper's
  // own API guidance asks this endpoint be called sparingly (at most about once a day); this
  // app's live-stat poll runs every 15-60s, so riding that clock directly would be a real abuse
  // of it. An hour is comfortably under that ceiling while still letting a designation change
  // surface the same day it happens. D.S.injDirRefreshedAt is stamped from D.initSleeper's own
  // one-time load and re-stamped here BEFORE the fetch (not after) — a slow or failing attempt
  // must not retry on every single poll tick in between, only after the interval has genuinely
  // elapsed again.
  //
  // Deliberately WALL-CLOCK (Date.now()), not LG.now(): this is a real-world API-pacing
  // concern, not a fact about the league calendar, so it must not speed up under the 2025
  // replay's 8x-accelerated clock the way genuinely league-time things correctly do.
  const INJ_DIR_REFRESH_MS = 60 * 60 * 1000; // once an hour
  D.maybeRefreshInjuryDirectory = async function () {
    if (!D.S.slpPlayers) return; // the one-time boot load hasn't landed yet — nothing to refresh
    if (Date.now() - (D.S.injDirRefreshedAt || 0) < INJ_DIR_REFRESH_MS) return;
    D.S.injDirRefreshedAt = Date.now();
    try { await fetchPlayerDirectory(); }
    catch (e) { /* best-effort — the live poll's own health tracking covers real outages; this is a courtesy refresh */ }
  };

  // ---------------- ⭐ ONE ID RESOLVER (2026-08-09, the "everything reads 0" production bug) --
  // A GFFL roster keys its players by ESPN id (that is what the ESPN importer writes, and what
  // every roster doc in the family league holds). Sleeper's directory is the only whole-NFL
  // player list this app has, and — measured live against the real directory, 2026-08-09 —
  // only 6,727 of its 12,217 entries carry an `espn_id` at all. So an espn_id lookup, in EITHER
  // direction, silently loses roughly HALF the league:
  //   · D.projFor found no pid  -> no projection, and the matchup page fell back to the live
  //     score, which is why every one of those players read "proj 0.0";
  //   · the pollers had nowhere to put the stats, so they landed under a synthetic "slp_<pid>"
  //     key that no roster row uses — an orphan row nothing ever reads.
  // Measured on the first 12 players of the real roster_2025_w1_t1: 4 resolved, 8 lost.
  // This is NOT replay-specific — it would silently zero every rookie in the real 2026 season
  // for exactly the same reason (a rookie is precisely the player Sleeper has not yet given an
  // espn_id).
  //
  // pidForKey is the single answer to "which Sleeper player is this roster key?", used by every
  // consumer. Three methods, cheapest and most certain first:
  //   1. an explicit prefix — dst_<id> / slp_<pid> carry the pid outright;
  //   2. the espn_id INDEX (D.S.slpByEspn) — O(1). D.projFor used to walk all 12,217 directory
  //      entries looking for a matching espn_id, per player, per render;
  //   3. NAME + TEAM, from what the ROSTER itself already knows. This is the half that had to be
  //      new: the pre-existing name fallback only worked once a LIVE ROW for that key already
  //      existed, which is the exact chicken-and-egg that left every espn_id-less player dark
  //      (no pid -> no stats -> no row -> no name to match on -> no pid).
  // Positive answers are memoized; negatives are not, because the directory and the rosters both
  // arrive asynchronously and a "no" cached before either landed would be permanent. `_pidGen`
  // invalidates the memo whenever either source changes.
  D._pidCache = new Map();
  D._pidGen = 0;
  D.bumpPidGen = function () { D._pidGen++; D._pidCache.clear(); };
  // (name, team) -> the key the ROSTER uses for that player. Registered as rosters load, which
  // is what lets the pollers key a stat row onto the roster's OWN key instead of orphaning it.
  D.S.keyByName = new Map();
  D.S.rosterMetaByKey = new Map();
  D.registerRosterPlayers = function (players) {
    let added = 0;
    for (const p of (players || [])) {
      if (!p || !p.key) continue;
      const k = String(p.key);
      if (!D.S.rosterMetaByKey.has(k)) { D.S.rosterMetaByKey.set(k, { name: p.name, team: p.team, pos: p.pos }); added++; }
      if (p.name && p.team) {
        const nk = nameKey(p.name, p.team);
        if (D.S.keyByName.get(nk) !== k) { D.S.keyByName.set(nk, k); added++; }
      }
    }
    if (added) D.bumpPidGen();
    return added;
  };
  // How a key resolved, for D.idCoverage's honest report.
  function resolvePid(k) {
    if (k.startsWith("dst_") || k.startsWith("slp_")) return { pid: k.slice(4), via: "prefix" };
    if (D.S.slpByEspn) { const m = D.S.slpByEspn.get(k); if (m) return { pid: m.pid, via: "espn" }; }
    if (D.S.slpByName) {
      // Whatever we know about this key's identity: the roster registry first (it knows the
      // name and NFL team before a single stat has landed), then a live row, then the generic
      // metaForKey walk.
      const meta = D.S.rosterMetaByKey.get(k) || D.S.players.get(k) || (D.metaForKey ? D.metaForKey(k) : null);
      if (meta && meta.name && meta.team) {
        const m = D.S.slpByName.get(nameKey(meta.name, meta.team));
        if (m) return { pid: m.pid, via: "name" };
      }
    }
    return { pid: null, via: "none" };
  }
  D.pidForKey = function (key) {
    const k = String(key == null ? "" : key);
    if (!k) return null;
    const hit = D._pidCache.get(k);
    if (hit && hit.gen === D._pidGen) return hit.pid;
    const r = resolvePid(k);
    if (r.pid != null) D._pidCache.set(k, { pid: r.pid, gen: D._pidGen });
    return r.pid;
  };
  D.pidMethodForKey = function (key) { return resolvePid(String(key == null ? "" : key)).via; };
  // Honest coverage report over every key the league's rosters actually hold. A key that still
  // resolves to nothing after all three methods is a REAL gap — the suite asserts on this rather
  // than on a hope, and it is what makes "half the league is invisible" a number instead of a
  // hunch.
  D.idCoverage = function (rosters) {
    const src = rosters || (LG.ui && LG.ui._rosters) || {};
    const seen = new Set(), byMethod = { prefix: 0, espn: 0, name: 0 }, missing = [];
    for (const tid in src) {
      for (const p of (src[tid] || [])) {
        if (!p || !p.key || seen.has(String(p.key))) continue;
        seen.add(String(p.key));
        const r = resolvePid(String(p.key));
        if (r.pid != null) byMethod[r.via]++;
        else missing.push({ key: String(p.key), name: p.name || "", team: p.team || "" });
      }
    }
    return { total: seen.size, resolved: seen.size - missing.length, unresolved: missing.length, byMethod, missing };
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
  // ⭐ ITEM 30 (2026-08-09) — the OTHER half of that provenance question, and the one that was
  // missing. A week number alone cannot distinguish preseason week 1 from regular-season week
  // 1; before SEASON_START, LG.currentWeek() clamps to 1, so through August the engine's week
  // and the league's week AGREE while the rows in memory are preseason box scores. Without
  // this, the first Sunday of preseason would have written weekly_<season>_w1 — a WRITE-ONCE
  // regular-season record — from exhibition football, and standings would have carried it for
  // the rest of the year with no way back.
  // Same null-means-refuse rule as the week, and same disagreement rule: two providers that
  // don't agree means the rows in memory are a MIX, which is exactly when a permanent write
  // must not happen.
  function normSeasonType(v) {
    if (v == null) return null;
    if (typeof v === "number" || /^\d+$/.test(String(v))) {
      const n = Number(v);
      return n === 1 ? "pre" : n === 2 ? "regular" : (n === 3 || n === 4) ? "post" : null;
    }
    const s = String(v).toLowerCase();
    if (s.startsWith("pre")) return "pre";
    if (s.startsWith("reg")) return "regular";
    if (s.startsWith("post")) return "post";
    return null;
  }
  D.normSeasonType = normSeasonType; // test hook
  D.engineSeasonType = function () {
    const e = D.S.espnSeasonType, s = D.S.slpSeasonType;
    if (e != null && s != null) return e === s ? e : null;
    return e != null ? e : (s != null ? s : null);
  };
  // The single question every permanent per-week write asks. POSITIVELY regular, never
  // "not known to be preseason": an unknown season type fails CLOSED, and the failure is a
  // visible one the league already knows how to recover from (the stale-weeks card, and the
  // commissioner's archived-stats backfill), where the permissive answer's failure is a
  // silently-wrong write-once document.
  D.engineRegular = function () { return D.engineSeasonType() === "regular"; };

  // Archived per-week stats — Sleeper's own /stats/nfl/<type>/<season>/<week> endpoint, which
  // serves ANY completed week, not just the live one. This is the ONLY honest way to finalize
  // a week the live engine has already rolled past (findings 1/3/7): the commissioner's
  // clearly-labelled fallback backfills the REAL week's numbers instead of stamping whatever
  // happens to be on the board today. Returns a Map keyed EXACTLY as the live poll keys rows
  // (dst_<pid> / espn_id / slp_<pid>) -> league-scored points, or null when unavailable.
  //
  // WEEK-LEVEL CACHE + IN-FLIGHT DEDUPE (2026-08-08 perf regression fix). D.gameLog (the
  // player stats card) calls this ONCE PER FINALIZED WEEK, and it used to hit the real network
  // every single time — with zero reuse between calls. Each response is a WHOLE-LEAGUE payload
  // (every NFL player's stat line for that week), so a season with N finalized weeks fired N
  // fresh multi-hundred-KB fetches on EVERY stats-card open, with no caching across opens: a
  // curious user tapping through 3-4 players re-downloaded the ENTIRE season's archive 3-4
  // times over, saturating the browser's connection pool to api.sleeper.app and starving the
  // live-poll's own ESPN/Sleeper requests in the process — this is what "taking a long time to
  // load anything" actually was; it wasn't isolated to the stats card, it was the whole page
  // fighting the same connection pool. A finalized week's archived stats never change once
  // Sleeper has published them, so caching the resolved Map indefinitely (per season+week) is
  // safe: `D._weekStatsCache` holds it for the rest of the session and every later caller — a
  // second player's card, a third, LG.finalizeWeek's own backfill path, the FA table's season
  // columns — gets it for free, no network at all. Concurrent callers for the SAME
  // not-yet-cached week (two cards opened back to back before the first resolves) share ONE
  // in-flight fetch via `D._weekStatsInFlight` rather than firing duplicate parallel requests.
  // Only a REAL (non-null) result is cached — a genuine outage/empty response is never stuck
  // permanently, so it can still retry on the next call.
  D._weekStatsCache = new Map();     // "season|seasonType|week" -> Map
  D._weekStatsInFlight = new Map();  // same key -> in-flight Promise<Map|null>, cleared on settle
  D.weekStats = async function (week, opts) {
    await D.initSleeper();
    if (!D.S.slpPlayers) return null;
    const st = D.S.slpState || {};
    // opts.season/opts.seasonType OVERRIDE Sleeper's own live /state/nfl reading — that state
    // is always the REAL CURRENT NFL season, which is the wrong season to ask for archived
    // stats about a past league year. No opts -> byte-identical to the original priority
    // (st.season, then LG.SEASON) for every existing caller.
    const seasonType = (opts && opts.seasonType) || st.season_type || "regular";
    // Under the 2025 replay Sleeper's live /state/nfl season is the REAL current one, which is
    // the wrong year to ask an archived-stats question about — this league's own LG.SEASON wins
    // there. Every caller that already passes an explicit season is unaffected either way.
    const season = (opts && opts.season) || (LG.SIM_2025 ? String(LG.SEASON) : st.season) || String(LG.SEASON);
    const cacheKey = season + "|" + seasonType + "|" + week;
    // The RAW payload is what is cached (never re-fetched — a finalized week's archived stats
    // never change); the keyed Map is DERIVED from it and re-derived whenever the id resolver's
    // generation moves, because the roster registry it keys through can legitimately land after
    // the first derivation. Re-deriving costs no network at all, which is what keeps the
    // 2026-08-08 perf fix intact.
    const cached = D._weekStatsCache.get(cacheKey);
    if (cached) return weekStatsMap(cached);
    if (D._weekStatsInFlight.has(cacheKey)) return D._weekStatsInFlight.get(cacheKey);
    const p = (async () => {
      let j;
      try { j = await fx("sleeper week stats " + week, `${SLP}/stats/nfl/${seasonType}/${season}/${week}`); }
      catch (e) { return null; }
      // An EMPTY payload is NOT "a week in which nobody scored" — it is a week that has not
      // been played (ITEM 30, 2026-08-09). Sleeper answers 200 with {} for a future week, and
      // an empty Map is truthy, so the backfill path took it as real data and would have
      // written a permanent weekly doc of ZEROES for every team. Treated as unavailable, which
      // is what "no-archived-stats" already means everywhere upstream.
      if (!j || typeof j !== "object" || !Object.keys(j).length) return null;
      const entry = { raw: j, map: null, gen: -1 };
      const m = weekStatsMap(entry);
      if (!m) return null;
      D._weekStatsCache.set(cacheKey, entry);
      return m;
    })();
    D._weekStatsInFlight.set(cacheKey, p);
    let result;
    try { result = await p; } finally { D._weekStatsInFlight.delete(cacheKey); }
    return result;
  };
  function weekStatsMap(entry) {
    if (entry.map && entry.gen === D._pidGen) return entry.map;
    const out = new Map();
    for (const pid in entry.raw) {
      const row = entry.raw[pid]; if (!row || typeof row !== "object") continue;
      const meta = D.S.slpPlayers && D.S.slpPlayers.get(pid);
      if (!meta) continue;
      const pts = D.score(normSlp(row));
      // Same keying rule as the live pollers (2026-08-09): the ROSTER's own key wins, so a
      // player Sleeper carries no espn_id for still shows a season history / FPTS column.
      const nk = nameKey(meta.name, meta.team);
      out.set(meta.pos === "DEF" ? "dst_" + pid
        : (D.S.keyByName.get(nk) || meta.espn_id || "slp_" + pid), pts);
      // A DST rostered by ESPN abbrev (the roster importer's own key shape) must resolve too.
      if (meta.pos === "DEF" && meta.team) out.set("dst_" + slpTeam(meta.team), pts);
    }
    if (!out.size) return null;
    entry.map = out; entry.gen = D._pidGen;
    return out;
  }

  // Weekly projection (league-scored, not pts_ppr) for a roster player. Under the 2025 replay
  // the source is D.S.simProj (see D.simEnsureProj below) — there is exactly ONE week in play,
  // so one map, warmed once. Rounded to 1dp there because a derived-from-actuals projection is
  // an estimate and shouldn't wear two decimal places of false precision.
  D.projFor = function (key) {
    const sim = LG.SIM_2025;
    const projMap = sim ? (D.S.simProj ? D.S.simProj.map : null) : D.S.slpProj;
    if (!projMap || !D.S.slpPlayers) return null;
    // ONE resolver (D.pidForKey) — was a LINEAR SCAN of all 12,217 directory entries per call,
    // per player, per render, that could only ever match an espn_id and therefore missed ~half
    // the league outright.
    const pid = D.pidForKey(key);
    const st = pid != null ? projMap[pid] : null;
    if (!st) return null;
    const pts = D.score(normSlp(st));
    return sim ? Math.round(pts * 10) / 10 : pts;
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

  // ---------------- S6: TRENDING adds/drops (Sleeper, keyless) ----------------
  // "Who is the rest of the fantasy world picking up right now" — the one piece of genuine
  // league-external signal this app can have for free. Sleeper's /players/nfl/trending/add
  // and /drop take no key and no cookie (the same public host the directory and the stats
  // buckets already come from), so this is a straight client fetch like every other Sleeper
  // read here.
  //
  // BARE-NOT-BROKEN is the whole contract: a failure of either endpoint (down, blocked,
  // rate-limited, garbage JSON) leaves D.S.trending null and EVERY consumer simply renders
  // nothing — no badge, no strip, no error card, no toast. Trending is decoration over the
  // real player list; it may never be the reason a page looks broken.
  //
  // CACHED 1h in localStorage, because it is a 24-hour rolling statistic — polling it more
  // often than that would be noise, and a page reload should not re-fetch it. Only a
  // genuinely successful pair of fetches is ever written to the cache, so an outage can
  // always retry on the next open rather than caching its own failure for an hour.
  const TRENDING_KEY = "gffl_trending_v1";
  D.TRENDING_TTL_MS = 3600e3;
  D.TRENDING_HOURS = 24;
  D.TRENDING_LIMIT = 50;
  D.S.trending = null;          // {at, add:{pid:count}, drop:{pid:count}} — null = absent
  D.S.trendingInFlight = null;
  function trendingFresh(t) { return !!t && Date.now() - (t.at || 0) < D.TRENDING_TTL_MS; }
  function readTrendingCache() {
    try {
      const raw = localStorage.getItem(TRENDING_KEY);
      const t = raw ? JSON.parse(raw) : null;
      return t && t.add && t.drop ? t : null;
    } catch (e) { return null; }
  }
  // One fetch of one direction -> {pid: count}. Never throws: an unusable answer is {} and
  // the CALLER decides that the pair failed (see below) rather than each half guessing.
  async function fetchTrend(kind) {
    const j = await fx("sleeper trending " + kind,
      `${SLP}/players/nfl/trending/${kind}?lookback_hours=${D.TRENDING_HOURS}&limit=${D.TRENDING_LIMIT}`);
    const out = {};
    for (const r of (Array.isArray(j) ? j : [])) {
      const pid = r && (r.player_id != null ? String(r.player_id) : null);
      const n = Number(r && r.count);
      if (pid && Number.isFinite(n)) out[pid] = n;
    }
    return out;
  }
  // Resolves to the trending object or null. Deduped in flight (the Moves page's strip and
  // its table both want it on the same paint) and memoized for the TTL.
  D.loadTrending = function () {
    if (trendingFresh(D.S.trending)) return Promise.resolve(D.S.trending);
    if (D.S.trendingInFlight) return D.S.trendingInFlight;
    const cached = readTrendingCache();
    if (trendingFresh(cached)) { D.S.trending = cached; return Promise.resolve(cached); }
    D.S.trendingInFlight = (async () => {
      try {
        const [add, drop] = await Promise.all([fetchTrend("add"), fetchTrend("drop")]);
        // BOTH halves have to have said something. One empty side is a legitimate quiet day;
        // both empty is indistinguishable from "the endpoint answered nothing useful", and
        // caching that for an hour would silently disable the feature on a device that was
        // merely unlucky once.
        if (!Object.keys(add).length && !Object.keys(drop).length) return null;
        const t = { at: Date.now(), add, drop };
        D.S.trending = t;
        try { localStorage.setItem(TRENDING_KEY, JSON.stringify(t)); } catch (e) {}
        return t;
      } catch (e) {
        return null; // absent, never an error — see the contract note above
      } finally { D.S.trendingInFlight = null; }
    })();
    return D.S.trendingInFlight;
  };
  // What this app KEY is doing in the wider fantasy world, or null. Resolves through the one
  // id resolver (D.pidForKey), so a player Sleeper knows by a pid the roster keys by an ESPN
  // id still lines up — the same "half the league was invisible" fix the projections needed.
  D.trendingFor = function (key) {
    const t = D.S.trending;
    if (!t) return null;
    const pid = D.pidForKey(key);
    if (pid == null) return null;
    const add = t.add[pid], drop = t.drop[pid];
    if (add != null && (drop == null || add >= drop)) return { dir: "add", count: add };
    if (drop != null) return { dir: "drop", count: drop };
    return null;
  };
  // The top N trending ADDS, as {pid, count} — newest signal first. The caller maps pids onto
  // its own player pool (the Moves strip only shows the ones who are genuinely free in THIS
  // league), which is why this hands back pids rather than pretending to know about rosters.
  D.trendingAdds = function (n) {
    const t = D.S.trending;
    if (!t) return [];
    return Object.keys(t.add)
      .map((pid) => ({ pid, count: t.add[pid] }))
      .sort((a, b) => b.count - a.count || String(a.pid).localeCompare(String(b.pid)))
      .slice(0, n || 5);
  };
  D._trendingKey = TRENDING_KEY; // test hook

  // ---------------- ⭐ ITEM 31: the backup pool (2026-08-09) ----------------
  // WHY BACKUPS AND NOT STARTERS. In preseason week 1 the starters take a handful of snaps or
  // none at all; the 2s and 3s play most of the game. A roster of stars would show a column of
  // zeroes all night, which is the opposite of what a shakedown is for.
  //
  // Returns { players, defenses } — both ORDERED best-first and both TOTALLY ordered, because
  // LG.buildBackupRosters draws from the head of these lists and the whole action has to be
  // deterministic given the same directory (same input, same eight rosters, every time, on
  // every device). `_i` is each skill player's index in the global order, which is what lets
  // FLEX and the bench pick "the best remaining across several positions" without re-sorting.
  // null (never []) when the directory hasn't loaded — the caller must be able to tell
  // "no data yet" from "nobody qualifies".
  D.BACKUP_POSITIONS = ["QB", "RB", "WR", "TE", "K"];
  // Genuinely unavailable, not merely dinged: a Questionable backup still plays in preseason
  // (and is exactly the kind of player who plays a LOT of it), so only the designations that
  // mean "will not be on the field" are excluded.
  D.BACKUP_EXCLUDE_INJURY = ["Out", "IR", "PUP", "NFI", "Sus", "SUS", "DNR", "NA", "COV"];
  D.backupPool = function (opts) {
    if (!D.S.slpPlayers) return null;
    const orders = (opts && opts.orders) || [2, 3];
    const players = [], defenses = [];
    for (const [pid, m] of D.S.slpPlayers) {
      if (!m.team) continue; // a free agent with no NFL team plays in no preseason game
      if (m.pos === "DEF") {
        // A team defense has no depth chart — there is exactly one per NFL team, and every
        // roster needs one, so they are drafted from their own list (see buildBackupRosters).
        defenses.push({ key: "dst_" + pid, pid, name: m.name, pos: "DST", team: m.team, injury: "", depth: null, searchRank: m.searchRank });
        continue;
      }
      if (!D.BACKUP_POSITIONS.includes(m.pos)) continue;
      if (m.depth == null || !orders.includes(m.depth)) continue;
      if (D.BACKUP_EXCLUDE_INJURY.includes(String(m.injury || ""))) continue;
      players.push({
        key: m.espn_id || ("slp_" + pid), pid, name: m.name, pos: m.pos,
        team: m.team, injury: m.injury || "", depth: m.depth, searchRank: m.searchRank,
      });
    }
    // depth first (every 2 before every 3 — the 2s get far more preseason snaps), then the
    // directory's own popularity rank, then the pid so the order is TOTAL and no two runs can
    // disagree about a tie.
    const byPid = (a, b) => String(a.pid).localeCompare(String(b.pid));
    players.sort((a, b) => a.depth - b.depth || (a.searchRank ?? 1e9) - (b.searchRank ?? 1e9) || byPid(a, b));
    players.forEach((p, i) => { p._i = i; });
    defenses.sort((a, b) => (a.searchRank ?? 1e9) - (b.searchRank ?? 1e9) || byPid(a, b));
    return { players, defenses };
  };

  // ---------------- player stats card (2026-08-08) ----------------
  // Resolve name/pos/team/injury for ANY key — rostered, benched, on a rival's team, or a
  // genuine free agent nobody's ever rostered. Roster data is authoritative when available
  // (same precedence lg-ui.js's askAiRead/buildSide already uses — an imported name/pos/team
  // is trustworthy even before the live poll has ever touched that player); the Sleeper
  // directory (D.S.slpPlayers/slpByEspn — the same maps D.projFor already resolves keys
  // through) is what makes an UNROSTERED free agent's card work at all; the live-poll row
  // (D.S.players) is the last resort, for a key that's somehow in neither.
  D.metaForKey = function (key) {
    const k = String(key);
    if (LG.ui && LG.ui._rosters) {
      for (const tid in LG.ui._rosters) {
        const p = (LG.ui._rosters[tid] || []).find((x) => x.key === k);
        if (p) return { name: p.name, pos: p.pos, team: p.team, injury: p.injury || "" };
      }
    }
    let m = null;
    if (D.S.slpPlayers) {
      if (k.startsWith("dst_") || k.startsWith("slp_")) m = D.S.slpPlayers.get(k.slice(4));
      else if (D.S.slpByEspn) m = D.S.slpByEspn.get(k);
    }
    if (m) return { name: m.name, pos: m.pos === "DEF" ? "DST" : m.pos, team: m.team, injury: m.injury || "" };
    const row = D.S.players.get(k);
    if (row) return { name: row.name, pos: row.pos, team: row.team, injury: row.injury || "" };
    return { name: k, pos: "", team: "", injury: "" };
  };

  // A player's per-week scoring history, computed from finalized ("weekly") docs' own
  // underlying data — NOT from the weekly doc itself, which only ever stores TEAM totals
  // (LG.finalizeWeek's `matchups`), never a per-player breakdown. Sleeper's archived
  // per-week stats endpoint (the same one LG.finalizeWeek's `backfill` path and the 2025 test
  // season already trust) is re-queried, ONE finalized week at a time, with the league's own
  // explicit season/seasonType (LG.SEASON/"regular" — same override finalizeWeek's backfill
  // passes, so a 2025-replay week and a live-season week both resolve against the correct
  // year rather than Sleeper's live /state/nfl reading). A week the archived endpoint
  // has no entry for that key is OMITTED, not zeroed — the app doesn't track historical roster
  // membership, so "no stat line" honestly could mean bye/inactive/not-yet-in-the-league, and
  // fabricating a 0 would be a guess this app doesn't make anywhere else. Returns
  // {rows:[{week,pts}], total, avg, best} — all three null when rows is empty (the card's
  // own "No games yet" empty state).
  D.gameLog = async function (key) {
    const weekly = (await LG.db.list("weekly")).filter((w) => w && w.kind === "weekly").sort((a, b) => (a.week || 0) - (b.week || 0));
    if (!weekly.length) return { rows: [], total: null, avg: null, best: null };
    const maps = await Promise.all(weekly.map((w) => D.weekStats(w.week, { season: LG.SEASON, seasonType: "regular" })));
    const rows = [];
    weekly.forEach((w, i) => { const map = maps[i]; if (map && map.has(key)) rows.push({ week: w.week, pts: map.get(key) }); });
    if (!rows.length) return { rows: [], total: null, avg: null, best: null };
    const total = Math.round(rows.reduce((s, r) => s + r.pts, 0) * 100) / 100;
    const avg = Math.round((total / rows.length) * 100) / 100;
    const best = Math.max(...rows.map((r) => r.pts));
    return { rows, total, avg, best };
  };

  // Real NFL opponent for a player's week — "if-known" is the whole point here: this app
  // tracks no historical NFL schedule at all, so the honest answer for any week but the one
  // the live engine currently holds is simply "not known", never a guess. Both abbrevs are
  // normalized through slpTeam() before comparing (D.S.nflEvents carries ESPN's own
  // abbreviation, which occasionally differs from a roster/Sleeper abbrev — Washington).
  D.oppForWeek = function (week, teamAbbrev) {
    if (!teamAbbrev) return null;
    // Under the 2025 replay the engine's week is deliberately UNKNOWN (nothing may auto-
    // finalize off a slate nobody has played), but the slate in memory IS week 1's own — so
    // week 1 is answerable and every other week honestly isn't, same rule, different source
    // of truth for "which week are these events".
    const ew = LG.SIM_2025 ? 1 : (D.engineWeek ? D.engineWeek() : null);
    if (ew == null || Number(week) !== ew) return null;
    const mine = slpTeam(teamAbbrev);
    const ev = (D.S.nflEvents || []).find((e) => (e.home && slpTeam(e.home.abbrev) === mine) || (e.away && slpTeam(e.away.abbrev) === mine));
    if (!ev) return null;
    const isHome = ev.home && slpTeam(ev.home.abbrev) === mine;
    const oppAb = isHome ? (ev.away && ev.away.abbrev) : (ev.home && ev.home.abbrev);
    return oppAb ? (isHome ? "vs " + oppAb : "@ " + oppAb) : null;
  };

  // An NFL team's own crest, from the slate ALREADY IN MEMORY — never a new network call.
  // pollScoreboard and fetchSimSlate both record `logo` per competitor (2026-08-09), so the
  // whole map is derivable from D.S.nflEvents; it is rebuilt only when that array is REPLACED
  // (both parsers assign a fresh array wholesale, so an identity check is a sound generation
  // counter). "" for a team the payload carried no crest for — the renderer draws no <img> at
  // all in that case rather than a broken one. Lookups normalise through slpTeam() because
  // ESPN's and Sleeper's abbreviations diverge (Washington is the documented case).
  let logoSrcArr = null, logoMap = new Map();
  D.teamLogo = function (abbrev) {
    const ab = slpTeam(abbrev);
    if (!ab) return "";
    const evs = D.S.nflEvents || [];
    if (logoSrcArr !== evs) {
      logoMap = new Map();
      for (const e of evs) for (const s of [e.away, e.home]) {
        if (s && s.abbrev && s.logo) logoMap.set(slpTeam(s.abbrev), s.logo);
      }
      logoSrcArr = evs;
    }
    return logoMap.get(ab) || "";
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
          // LEAGUE time, not wall time. `t` is display-only (feedLine is its sole consumer),
          // and under the 2025 replay a feed entry on a Sunday-afternoon board has to read as a
          // Sunday afternoon rather than as whenever this device happened to poll. Off the
          // replay LG.now() IS Date.now(), so the real league is unchanged. Everything that
          // compares FRESHNESS (side.last, health.lastChange) deliberately stays on Date.now().
          D.S.events.unshift({ t: LG.now(), src, key, name: row.name, stat: k, from: ov, to: nv, dPts });
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
    // …and WHICH PART of the season it is (ITEM 30). ESPN states this two ways on the same
    // payload — a numeric season.type (1 pre / 2 regular / 3-4 post) and a season.slug
    // ("preseason"/"regular-season"/"post-season") — and the older shape nests it under
    // leagues[0]. All three are read because the cost is nothing and the consequence of
    // reading none of them is a permanent record written from the wrong part of the season.
    D.S.espnSeasonType = normSeasonType(j?.season?.type ?? j?.season?.slug ?? j?.leagues?.[0]?.season?.type?.type);
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
      // `logo` (2026-08-09 playtest: "the nfl scoreboard should show team logos") — ESPN's
      // scoreboard payload carries the team's own crest at competitor.team.logo, with
      // team.logos[0].href as the older/alternate shape. "" when neither is present, which
      // the Scores card renders as no image at all rather than a broken one.
      const side = (comp) => comp ? {
        abbrev: comp.team?.abbreviation || "",
        name: comp.team?.shortDisplayName || comp.team?.abbreviation || "",
        score: comp.score != null ? String(comp.score) : "",
        logo: comp.team?.logo || comp.team?.logos?.[0]?.href || "",
      } : null;
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
          // HOME/AWAY (2026-08-09, the ESPN matchup layout): the lineup row's second line
          // reads "@DET Sun 12:00 PM" away / "TB Sun 12:00 PM" home, and nothing in
          // D.S.games recorded which side of that a player's own team is on. Recorded in
          // BOTH slate parsers — this one and applySimSlate's — or the 2025 replay would
          // silently render every player as away.
          home: comp.homeAway === "home",
          rz: !!(prev && prev.eventId === String(ev.id) && prev.rz),
          // Possession (2026-08-09 playtest: "highlight players when their team has the ball
          // and is on offense") is only ever known from the per-game SUMMARY's current drive
          // (pollEspnGame below) — the scoreboard payload carries no drive at all. Carried
          // ACROSS this rebuild exactly the way rz is, keyed on the same eventId, or every
          // scoreboard tick (which runs far more often than the summary poll) would blank it
          // and the highlight would flicker on and off all afternoon.
          poss: !!(prev && prev.eventId === String(ev.id) && prev.poss),
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
      if (g.eventId === String(eventId)) {
        // `poss` is the offense flag the matchup/lineup highlight reads (2026-08-09). It was
        // already computed here for the red-zone flag and thrown away; storing it is all the
        // "who has the ball" feature needs from the data layer. A drive with no team (between
        // possessions, or a summary with no drives block at all) leaves BOTH sides false —
        // nobody is highlighted, which is the honest answer.
        g.poss = !!possAb && ab === possAb;
        g.rz = inRz && g.poss;
      }
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
      // THE ROSTER'S OWN KEY WINS (2026-08-09). Symmetric to D.pidForKey: a stat row whose
      // player carries no espn_id must still land on the key the roster uses, or it is an
      // orphan nothing ever reads. D.S.keyByName is registered as rosters load, so a rookie
      // (exactly the player Sleeper hasn't given an espn_id) scores like everyone else. When
      // the roster keys a player BY his espn_id — the ordinary case — the registry returns that
      // same string, so this is a no-op for every player who already worked.
      else key = D.S.keyByName.get(nameKey(meta.name, meta.team)) || meta.espn_id
        || D.S.espnKeyByName.get(nameKey(meta.name, meta.team)) || ("slp_" + pid);
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
    // `now` compares against lastOk/lastChange, which are WALL-clock stamps — this must stay
    // Date.now(). Only the feed entries below get league time (see applySide's own note).
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
      D.S.events.unshift({ t: LG.now(), src: "sys", msg: H.note });
    }
    if (H.mode !== prev && H.mode === "dual" && prev !== "dual") {
      D.S.events.unshift({ t: LG.now(), src: "sys", msg: "Both data sources healthy again — back to dual mode" });
    }
  }
  D.updateHealth = updateHealth;

  // ---------------- 2025 SEASON REPLAY — the historical week-1 slate (2026-08-08) ----------------
  // The bare /scoreboard endpoint always means "the CURRENT real NFL week", which is the wrong
  // week AND the wrong season for the replay. ESPN's own public scoreboard takes explicit
  // dates/seasontype/week params, so the replay asks for exactly the slate it wants — the real
  // week 1 of the real 2025 season — and presents every game as UPCOMING: state "pre", 0-0, its
  // REAL kickoff datetime and TV network intact. That is not a fiction: those games really were
  // upcoming at the pinned instant (Thursday morning, before the opener).
  //
  // Fetched ONCE per session and cached. It is static history — re-polling it on the live
  // cadence would be pure waste, and this is the one thing that could otherwise hammer ESPN
  // from a page that is left open all day.
  //
  // DELIBERATELY never sets D.S.espnWeek. The engine's week must stay UNKNOWN so the week-
  // provenance guards (adversarial review, findings 1/3/7) keep maybeAutoFinalizeWeeks and the
  // stale-week alarm silent for the whole replay — nothing has been played, so there is
  // nothing any of them could honestly do.
  D.S.simSlateLoaded = false;
  D.S.simSlateRaw = null; // the fetched slate, kickoffs + real final scores, state-free
  D.simScoreboardUrl = () => `${ESPN}/scoreboard?dates=${LG.SEASON}&seasontype=2&week=1`;

  // ---- the replay's GAME CLOCK ----------------------------------------------------------
  // Every game's state comes from LG.now() vs its OWN REAL KICKOFF — the slate carries them, so
  // there is nothing to invent and no need for the crude alphabetical team-bucketing the old
  // (deleted) sandbox used when it had no kickoff data. A 60-minute regulation game spans about
  // 3h05m of wall clock; take ~13 of those minutes out for halftime and the remaining 172 wall
  // minutes carry 60 game minutes, i.e. one game-minute costs ~2.87 wall minutes.
  const SIM_REG_MIN = 60;                                            // game minutes in regulation
  const SIM_HALFTIME_MIN = 13;                                       // wall minutes
  const SIM_GAME_WALL_MIN = 185;                                     // a real NFL game, kickoff to final
  const SIM_INFLATE = (SIM_GAME_WALL_MIN - SIM_HALFTIME_MIN) / SIM_REG_MIN;
  const SIM_H1_WALL_MIN = (SIM_REG_MIN / 2) * SIM_INFLATE;           // when halftime starts
  D.SIM_GAME_WALL_MIN = SIM_GAME_WALL_MIN; // test hook
  // {state, period, clock, detail, progress}. `progress` (0..1 of regulation elapsed) is the
  // ONE number the score model and the live stat lines both scale by, which is what keeps the
  // clock on screen and the numbers beside it from ever disagreeing.
  D.simGameState = function (kickoffIso, nowMs) {
    const ko = Date.parse(kickoffIso || "");
    if (!isFinite(ko)) return { state: "pre", period: 0, clock: "", detail: "", progress: 0 };
    const el = (nowMs - ko) / 60000; // wall minutes since kickoff
    if (el < 0) return { state: "pre", period: 0, clock: "", detail: "", progress: 0 };
    if (el >= SIM_GAME_WALL_MIN) return { state: "post", period: 4, clock: "0:00", detail: "Final", progress: 1 };
    if (el >= SIM_H1_WALL_MIN && el < SIM_H1_WALL_MIN + SIM_HALFTIME_MIN) {
      return { state: "in", period: 2, clock: "0:00", detail: "Half", progress: 0.5 };
    }
    let gm = el < SIM_H1_WALL_MIN
      ? el / SIM_INFLATE
      : SIM_REG_MIN / 2 + (el - SIM_H1_WALL_MIN - SIM_HALFTIME_MIN) / SIM_INFLATE;
    gm = Math.max(0, Math.min(SIM_REG_MIN, gm));
    // Clamped to 4 so the period can never read Q5+, and the last tick of regulation reads
    // "Q4 0:00" rather than rolling over.
    const period = Math.min(4, Math.floor(gm / 15) + 1);
    const left = Math.max(0, 15 - (gm - (period - 1) * 15));
    const mm = Math.floor(left), ss = Math.floor((left - mm) * 60 + 1e-6);
    const clock = mm + ":" + String(ss).padStart(2, "0");
    return { state: "in", period, clock, detail: "Q" + period + " " + clock, progress: gm / SIM_REG_MIN };
  };

  async function fetchSimSlate() {
    if (D.S.simSlateRaw) return D.S.simSlateRaw;
    const j = await fx("espn 2025 week-1 slate", D.simScoreboardUrl());
    const raw = [];
    let last = 0;
    for (const ev of (j?.events || [])) {
      const c = ev.competitions && ev.competitions[0]; if (!c) continue;
      const comps = c.competitors || [];
      // The historical document's REAL final score is kept: it is what the in-progress score
      // model scales toward and what a finished game shows outright.
      const side = (comp) => comp ? {
        abbrev: comp.team?.abbreviation || "",
        name: comp.team?.shortDisplayName || comp.team?.abbreviation || "",
        final: Number(comp.score) || 0,
        logo: comp.team?.logo || comp.team?.logos?.[0]?.href || "",
      } : null;
      const kick = Date.parse(ev.date || "");
      if (isFinite(kick) && kick > last) last = kick;
      raw.push({
        id: String(ev.id || ""), date: ev.date || "",
        broadcast: c.broadcasts?.[0]?.names?.[0] || "",
        spread: (typeof c.odds?.[0]?.details === "string" ? c.odds[0].details : "").slice(0, 24),
        away: side(comps.find((x) => x.homeAway === "away")),
        home: side(comps.find((x) => x.homeAway === "home")),
        abbrevs: comps.map((comp) => comp?.team?.abbreviation || "").filter(Boolean),
      });
    }
    // The clock's ceiling follows the slate we actually loaded — RAISED only, never lowered, so
    // a slate landing mid-session can never drag the clock backwards.
    if (last) LG.simNoteLastKickoff(last);
    D.S.simSlateRaw = raw;
    D.S.simSlateLoaded = true;
    return raw;
  }
  D.fetchSimSlate = fetchSimSlate;

  // Rebuild D.S.games / D.S.nflEvents from the cached slate at the CURRENT replay clock. The
  // slate itself is fetched once (static history — re-polling it would be pure waste); the
  // STATE is re-derived on every tick, which is what makes the board move.
  function applySimSlate(nowMs) {
    const raw = D.S.simSlateRaw || [];
    const games = new Map();
    const events = [];
    for (const ev of raw) {
      const g = D.simGameState(ev.date, nowMs);
      // The scoreboard's own score. SYNTHETIC and deterministic: the real final scaled by how
      // far the game has got, then the exact real final once it is over. No play-by-play is
      // invented — only the number on the scoreboard.
      const shown = (side) => !side ? "0"
        : g.state === "pre" ? "0"
        : g.state === "post" ? String(side.final)
        : String(Math.round(side.final * g.progress));
      const away = ev.away ? { abbrev: ev.away.abbrev, name: ev.away.name, score: shown(ev.away), logo: ev.away.logo || "" } : null;
      const home = ev.home ? { abbrev: ev.home.abbrev, name: ev.home.name, score: shown(ev.home), logo: ev.home.logo || "" } : null;
      events.push({
        id: ev.id, date: ev.date, state: g.state, detail: g.detail, period: g.period, clock: g.clock,
        broadcast: ev.broadcast, spread: ev.spread, away, home,
      });
      const sides = [[away, home, false], [home, away, true]];
      for (const [me, opp, isHome] of sides) {
        if (!me || !me.abbrev) continue;
        games.set(slpTeam(me.abbrev), {
          eventId: ev.id, state: g.state, detail: g.detail, period: g.period, clock: g.clock,
          kickoff: ev.date, oppAb: (opp && opp.abbrev) || "",
          // See pollScoreboard's own note — the replay is the OTHER slate parser, and a
          // flag added to only one of them is the easy mistake here.
          home: isHome,
          // The replay has no drive data at all (nothing calls pollEspnGame under it), so
          // there is no honest possession to report — nobody is ever highlighted, which is
          // what "degrades to nobody" means here. Same posture as rz.
          rz: false, poss: false, score: me.score, oppScore: (opp && opp.score) || "0",
          progress: g.progress,
        });
      }
    }
    D.S.games = games;
    D.S.nflEvents = events;
  }
  D.applySimSlate = applySimSlate;
  async function pollSimSlate() {
    await fetchSimSlate();
    applySimSlate(LG.now());
  }
  D.pollSimSlate = pollSimSlate;

  // ---- the replay's LIVE PLAYER STATS ----------------------------------------------------
  // NOT invented: every line is that player's REAL week-1 2025 final, from the same archived
  // Sleeper endpoint D.weekStats and LG.finalizeWeek's backfill already trust, SCALED by how far
  // his own game has got.
  //   · his game hasn't kicked off  -> NO stat line at all (absent, not a row of zeros)
  //   · his game is in progress     -> scale = min(0.98, progress × f(pid))
  //   · his game is over            -> the exact real final, unscaled
  // f(pid) is a fixed per-player multiplier in [0.75, 1.35] from a hash of his id, so some
  // players front-load their day and others finish strong.
  //
  // MONOTONICITY IS LOAD-BEARING. applySide() builds the live feed by DIFFING consecutive polls,
  // so a value that ticks DOWN emits a negative delta and a nonsense feed line. Every term here
  // is a non-decreasing function of `progress` ALONE — f is drawn once per player and never
  // re-rolled per poll, `progress` never decreases while a game runs, min() with a constant
  // preserves that, and Math.round is non-decreasing — so no counting stat can ever regress.
  // (The one legitimate exception is a DEFENSE's fantasy POINTS, which fall as the points it has
  // allowed climb. That is real football and the live engine does exactly the same; the stat
  // itself still only ever rises.)
  const SIM_SCALE_LO = 0.75, SIM_SCALE_HI = 1.35, SIM_SCALE_CAP = 0.98;
  function hash01(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return (h >>> 8) / 16777216; // [0,1)
  }
  D.simPlayerScale = (pid) => SIM_SCALE_LO + (SIM_SCALE_HI - SIM_SCALE_LO) * hash01("gffl:" + pid);
  // Counting stats (TDs, receptions, sacks, XP/FG makes) and yardage are all INTEGERS at every
  // scale — a half-caught pass is not a thing.
  function scaleStatRow(row, s) {
    const out = {};
    for (const k in row) { const v = row[k]; out[k] = typeof v === "number" ? Math.round(v * s) : v; }
    return out;
  }
  D.scaleStatRow = scaleStatRow; // test hook
  D.S.simFinals = null;
  D.S.simFinalsInFlight = null;
  D.simEnsureFinals = function () {
    if (D.S.simFinals) return Promise.resolve(D.S.simFinals);
    if (D.S.simFinalsInFlight) return D.S.simFinalsInFlight;
    const p = (async () => {
      await D.initSleeper();
      let map = {};
      try {
        const j = await fx("sim week finals", `${SLP}/stats/nfl/regular/${LG.SEASON}/${LG.currentWeek()}`);
        if (j && typeof j === "object") map = j;
      } catch (e) { /* no archived line for that week — every game simply shows nothing */ }
      D.S.simFinals = map;
      D.S.simFinalsInFlight = null;
      return map;
    })();
    D.S.simFinalsInFlight = p;
    return p;
  };
  async function pollSimStats() {
    const finals = await D.simEnsureFinals();
    if (!finals || !D.S.slpPlayers) return;
    let n = 0;
    for (const pid in finals) {
      const st = finals[pid]; if (!st || typeof st !== "object") continue;
      const meta = D.S.slpPlayers.get(pid); if (!meta) continue;
      // Same scope the live poller uses: the NFL teams this week's league rosters actually touch.
      if (D.S.tracked.size && !D.S.tracked.has(meta.team)) continue;
      const g = D.S.games.get(slpTeam(meta.team || ""));
      if (!g || g.state === "pre") continue; // hasn't kicked off -> no stat line exists yet
      const scaled = g.state === "post"
        ? st
        : scaleStatRow(st, Math.min(SIM_SCALE_CAP, (g.progress || 0) * D.simPlayerScale(pid)));
      let key;
      if (meta.pos === "DEF") key = "dst_" + pid;
      // THE ROSTER'S OWN KEY WINS (2026-08-09). Symmetric to D.pidForKey: a stat row whose
      // player carries no espn_id must still land on the key the roster uses, or it is an
      // orphan nothing ever reads. D.S.keyByName is registered as rosters load, so a rookie
      // (exactly the player Sleeper hasn't given an espn_id) scores like everyone else. When
      // the roster keys a player BY his espn_id — the ordinary case — the registry returns that
      // same string, so this is a no-op for every player who already worked.
      else key = D.S.keyByName.get(nameKey(meta.name, meta.team)) || meta.espn_id
        || D.S.espnKeyByName.get(nameKey(meta.name, meta.team)) || ("slp_" + pid);
      if (key === "slp_" + pid) D.S.slpRowKeyByName.set(nameKey(meta.name, meta.team), key);
      const row = rowFor(key, { name: meta.name, pos: meta.pos === "DEF" ? "DST" : meta.pos, team: meta.team });
      row.injury = meta.injury || row.injury;
      if (scaled.pts_ppr != null) row.official = scaled.pts_ppr;
      applySide("slp", key, {}, normSlp(scaled), scaled);
      n++;
    }
    // Seeded AFTER the first pass, exactly like the live poller: the first poll establishes the
    // baseline silently (no feed entries for stats that were already on the board when the page
    // opened), every poll after it diffs against that baseline and fills the feed.
    if (n) D.S.slpSeeded = true;
  }
  D.pollSimStats = pollSimStats;

  // ---------------- 2025 SEASON REPLAY — week-1 projections (2026-08-08) ----------------
  // The live projections fetch (D.initSleeper's own third step) resolves off Sleeper's CURRENT
  // /state/nfl reading — the real, current NFL week — which is meaningless here, and is skipped
  // outright under the replay. This is its replacement, for THIS league's own season/week:
  //   1. TRY Sleeper's real forward-projections endpoint for 2025 week 1. If a real projection
  //      set is still retained for that week, that IS the authoritative source (source
  //      "projection") and it is used as-is.
  //   2. Otherwise — the expected case for a season this far gone; forward projections are not
  //      retained for completed weeks — DERIVE each player's projection from their REAL week-1
  //      2025 FINAL line (the same archived /stats/nfl/<season>/<week> endpoint D.weekStats and
  //      LG.finalizeWeek's backfill already trust). Identical raw pid->stat-row shape, so
  //      D.projFor's own D.score(normSlp(st)) path needs no branching; only the SOURCE differs
  //      (source "actual"), and that source is stated honestly on the replay banner rather than
  //      passed off as a real forecast. A real final is the most plausible possible estimate
  //      and it is deterministic — every device sees the same number.
  //   3. If genuinely nothing exists for that week either, the cache still gets a harmless empty
  //      entry and D.projFor degrades to "—", exactly like the real league's "not warm yet".
  D.S.simProj = null;       // {map, source:"projection"|"actual"}
  D.S.simProjInFlight = null;
  // ≥25 rows carrying any real stat field (the Sleeper keys normSlp actually reads) = a genuine
  // projections map; fewer = an ADP-only husk, treat as absent. 25 is far below a real week's
  // hundreds of projected players and far above any plausible stray.
  function simProjUsable(m) {
    let n = 0;
    for (const k in m) {
      const r = m[k];
      if (r && (Number(r.pass_yd) || Number(r.rush_yd) || Number(r.rec_yd) || Number(r.rec) ||
                Number(r.pass_td) || Number(r.fgm_yds) || Number(r.xpm) || Number(r.def_sack) || Number(r.sack))) {
        if (++n >= 25) return true;
      }
    }
    return false;
  }
  D.simProjUsable = simProjUsable; // test hook
  D.simEnsureProj = function () {
    if (D.S.simProj) return Promise.resolve(D.S.simProj);
    if (D.S.simProjInFlight) return D.S.simProjInFlight;
    const p = (async () => {
      await D.initSleeper();
      const week = LG.currentWeek();
      let map = null, source = "projection";
      try {
        const j = await fx("sim projections", `${SLP}/projections/nfl/regular/${LG.SEASON}/${week}`);
        // "Non-empty" is NOT "usable" (live probe, 2026-08-08): Sleeper's ARCHIVED projections
        // bucket for a completed season still answers 200 with thousands of rows, but rows can
        // carry only ADP fields (adp_dd_ppr etc.) with every stat projection stripped — a map
        // like that scores 0.0 through normSlp/D.score for every player, which is worse than
        // the honest fallback. Usable = a healthy number of rows carrying REAL stat fields.
        if (j && typeof j === "object" && simProjUsable(j)) map = j;
      } catch (e) { /* fall through to the archived-actuals proxy */ }
      if (!map) {
        // The SAME archived map the live replay scales its in-progress stat lines from
        // (D.simEnsureFinals), so this costs no second fetch of an identical payload.
        try {
          const j2 = await D.simEnsureFinals();
          if (j2 && typeof j2 === "object" && Object.keys(j2).length) { map = j2; source = "actual"; }
        } catch (e) { /* nothing for this week — projections legitimately stay blank */ }
      }
      const entry = { map: map || {}, source, week };
      D.S.simProj = entry;
      D.S.simProjInFlight = null;
      return entry;
    })();
    D.S.simProjInFlight = p;
    return p;
  };


  // ---------------- orchestration ----------------
  D.trackTeams = function (abbrevs) { D.S.tracked = new Set(abbrevs.map(slpTeam)); };
  D.pollOnce = async function () {
    // S9's slow injury-directory refresh (2026-08-11) — see D.maybeRefreshInjuryDirectory's own
    // header note. Rides the SAME tick every other poll job already runs on (that is the whole
    // point: no separate timer, no separate loop), but internally no-ops unless real wall-clock
    // hours have actually passed — applies uniformly whether the board is showing the live
    // season or the 2025 replay, because "which real NFL players are hurt right now" is a fact
    // about today, not about whichever season's scores this tab happens to be simulating.
    await D.maybeRefreshInjuryDirectory().catch(() => {});
    // 2025 TEST SEASON: the live-polling chain below always means "the real, current NFL
    // week" — never meaningful for a past-season replay, and actively wrong (real current-
    // season data could otherwise leak onto a 2025 board for any player id that recurs).
    // Phase 2 ("Week 4 · games LIVE") routes to the synthetic replay above instead; phases 1
    // and 3 have nothing to poll at all (before kickoff / the week is over) — D.onUpdate still
    // fires either way, so paintLive()'s repaint cadence is unaffected.
    if (LG.SIM_2025) {
      // TWO fetches for the whole session (the slate, and that week's real final stat lines);
      // every tick after that is pure re-derivation from the replay clock — no live polling at
      // all, because there is nothing live to poll for a season two years gone. The board still
      // MOVES: game states come from LG.now() vs each game's real kickoff, and each player's
      // line is his real final scaled by how far his own game has got.
      //
      // Health is left untouched on purpose (updateHealth is deliberately not called): failN and
      // lastOk never move, so the mode stays "dual"/nominal. That is honest — nothing is failing
      // — rather than painting an outage chip over a perfectly healthy replay.
      await pollSimSlate().catch(() => {});
      await pollSimStats().catch(() => {});
      for (const row of D.S.players.values()) mergeRow(row);
      if (D.onUpdate) D.onUpdate();
      return;
    }
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
    D.S.loopStarts++; // test hook (2026-08-08 perf fix) — proves the poll loop is armed at
                       // most once even across a second full UI.boot() (e.g. re-claiming a
                       // team) or repeated tab navigation; a stacked second loop would show
                       // this go to 2 without D.S.running ever having gone false in between.
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
    // A key with NO live row yet still knows which NFL team it plays for — from the roster it
    // sits on, or from the Sleeper directory (D.metaForKey resolves both). Without that
    // fallback the D.S.games lookup missed, the "game hasn't kicked off -> use the projection"
    // branch never ran, and every projected total silently read 0. That is the normal state of
    // any board before the first stat lands, and it is the PERMANENT state of the 2025 replay,
    // which polls no stats at all — the matchup page showed "proj 0.0" for every player while
    // the locker (which calls D.projFor directly) showed the right number.
    const team = slpTeam((row && row.team) || (D.metaForKey ? D.metaForKey(key).team : ""));
    const g = D.S.games.get(team);
    const proj = D.projFor(key);
    // NOTHING KNOWN about this player — no stat row, no projection, and his key resolves to no
    // Sleeper player at all. "0.0" would be a claim we can't back ("he has scored nothing");
    // null renders as "—", which is the truth (see LG.fmtPts's own note). D.livePts applies the
    // same rule to the score column.
    if (!row && proj == null && D.pidForKey(key) == null) return null;
    if (!g || g.state === "post") return pts;
    if (g.state === "pre") return proj != null ? proj : pts;
    const period = num(g.period) || 1;
    const [mm, ss] = String(g.clock || "0:00").split(":").map(Number);
    const minLeft = Math.max(0, (4 - Math.min(period, 4)) * 15 + num(mm) + num(ss) / 60);
    const frac = Math.min(1, minLeft / 60);
    return num(pts) + (proj != null ? num(proj) * frac : 0);
  };
  // The SCORE column's value: a real number when we have one (or a real zero when we know who
  // he is and simply nothing has landed), null when the key resolves to nobody — "—" beats a
  // fabricated 0.0. Always finite; never NaN.
  D.livePts = function (key) {
    const row = D.S.players.get(key);
    if (row && row.pts != null) return num(row.pts);
    if (!row && D.pidForKey(key) == null) return null;
    return 0;
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
  // ---------------- S8 · matchup win probability (est.) ----------------
  // The ESTIMATE is exactly what D.liveProj already sums for every card and the matchup
  // header — live points + the remaining fraction of a starter's projection — so the model
  // COMPOSES that, it doesn't invent a second one. What was missing was the SPREAD: the old
  // model was a fixed-scale logistic (a flat ±25-point slope), so a 10-point lead read
  // identically whether it was struck at kickoff — a whole slate still live, plenty of room
  // for it to flip — or with the clock at 0:00 and nothing left to change it. D.remainingProj
  // isolates the "still could happen" half of D.liveProj's own formula (0 once a game is
  // final, the full projection pre-game, the remaining fraction mid-game) so the SPREAD can
  // shrink as the slate empties out while the point ESTIMATE itself is untouched.
  D.remainingProj = function (key) {
    const row = D.S.players.get(key);
    const team = slpTeam((row && row.team) || (D.metaForKey ? D.metaForKey(key).team : ""));
    const g = D.S.games.get(team);
    const proj = D.projFor(key);
    if (!g || g.state === "post" || proj == null) return 0;
    if (g.state === "pre") return num(proj);
    const period = num(g.period) || 1;
    const [mm, ss] = String(g.clock || "0:00").split(":").map(Number);
    const minLeft = Math.max(0, (4 - Math.min(period, 4)) * 15 + num(mm) + num(ss) / 60);
    const frac = Math.min(1, minLeft / 60);
    return num(proj) * frac;
  };
  // K_SPREAD is a felt-right constant, documented rather than derived — there is no "correct"
  // k, only one that reads honestly, and the property tests (S8 suite) are what actually pin
  // its behaviour, not this comment. Calibrated against a "full slate remaining" reference: a
  // typical starting lineup projects to roughly ~125-130 points a side (~250-260 combined), and
  // the plan's own target is a 10-point PRE-GAME edge reading "roughly 65-70%" there. At
  // K_SPREAD=1.5, combined remaining 250 -> sd = 1.5*sqrt(250) ~= 23.7, z = 10/23.7 ~= 0.42,
  // logistic(1.702*z) ~= 67% — inside the target band.
  const WP_K_SPREAD = 1.5;
  // Floor so a near-final game (a real remaining projection near zero, but not YET the
  // provably-decided allDone case below) never divides a real point gap by a near-zero spread
  // into a knife-edge swing.
  const WP_MIN_SPREAD = 4;
  D.winProb = function (keysA, keysB) {
    const tot = (keys) => keys.reduce((s, k) => s + num(D.liveProj(k)), 0);
    const rem = (keys) => keys.reduce((s, k) => s + num(D.remainingProj(k)), 0);
    const diff = tot(keysA) - tot(keysB);
    // FINAL pins to exactly 100/0 — decided by the same game-STATE test D.remaining already
    // answers everywhere else on the page (every starter's game is "post", nobody still
    // playing), never by "remaining projection happens to read ~0", which could just as
    // easily mean nobody here resolves to a real projection yet.
    if ((keysA && keysA.length) && (keysB && keysB.length)) {
      const a = D.remaining(keysA), b = D.remaining(keysB);
      if (a.left === 0 && a.playing === 0 && b.left === 0 && b.playing === 0) {
        return diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
      }
    }
    const sd = Math.max(WP_MIN_SPREAD, WP_K_SPREAD * Math.sqrt(rem(keysA) + rem(keysB)));
    const p = 1 / (1 + Math.exp((-1.702 * diff) / sd));
    // The bar's width is Math.round(wp*100) straight into a style attribute — a non-finite p
    // would paint "width:NaN%" (an even-money 50% is the honest fallback).
    return Number.isFinite(p) ? p : 0.5;
  };
})();
