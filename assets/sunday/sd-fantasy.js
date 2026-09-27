'use strict';
/* sd-fantasy.js — Sunday's fantasy-scoring engine (GFFL: the family's 8-team league).
   House convention is to duplicate rather than share code across pages, so this is an
   independent port of assets/league/lg-data.js's scoring core + assets/league/lg-core.js's
   Firestore access, NOT a shared import — see docs/gffl.md for the pitfall history behind
   nearly every guard below (nameKey collisions, `x || 0` vs NaN, dst_ / slp_ key shapes,
   fg_made_yd, dst_pa scored at zero, the 6-vs-8 return-TD split).

   ═══════════════════════════════ WHAT'S DIFFERENT HERE ═══════════════════════════════
   lg-data.js attributes a play's stats by regexing ESPN's SITE play-by-play text (name
   strings inside a sentence). Sunday's per-play credit engine (FF.ingestPlays) instead
   reads ESPN's CORE API (…/competitions/{id}/plays, `participants[]`), which names WHO
   did WHAT with a typed role (`passer`, `receiver`, `sackedBy`, `patScorer`, …) — no name
   parsing, no alias table. The two sources are cross-checked: FF.ingestSummary parses the
   SITE box score (the numbers a family member would recognise, "18/25, 256 yds, 2 TD") as
   the ground truth per player per game, and the verify suite proves the SUM of ingestPlays'
   per-play credits equals that box total, play by play, for the whole game.

   One structural finding from that cross-check, load-bearing for creditCorePlay below:
   the CORE API's `teamParticipants[].type` ("offense"/"defense") does NOT consistently
   mean "team with the ball" across play types — a punt's offense is the punting team (it
   is that team's 4th-down play) but a kickoff's offense is the RECEIVING team (the kickoff
   is filed under the receiver's upcoming drive). Measured against the real athletes/teams
   in a live ESPN game (ATL @ GB, week 3 2026, event 401872948): trusting those labels for
   special-teams credit gets the return team backwards on exactly one of the two play
   types. So no credit below is ever assigned by "offense"/"defense" role — every credit
   resolves the responsible TEAM from the box score's own athlete→team map (built once by
   ingestSummary, keyed by the same ESPN athlete id the play's participants carry), which is
   unambiguous by construction.

   ═══════════════════════════════ PUBLIC API ═══════════════════════════════
   Pure core (no fetch/DOM; `require()`-able from Node — see the module.exports line at the
   bottom, and tools/_verify-sunday-ff.cjs, which runs entirely offline against frozen
   fixtures):
     FF.KEYS                              — the normalized stat schema (28 keys), D.KEYS' twin.
     FF.num(v)                             — untrusted-input guard: NaN/string/null -> finite 0.
     FF.score(statLine, scoring)           — statLine × the live rules.scoring table -> points.
                                              `scoring` always comes from settings at runtime;
                                              nothing here hardcodes a coefficient.
     FF.slpTeam(ab) / FF.espnTeam(ab)      — WSH <-> WAS, the one team-abbreviation mismatch.
     FF.normName(name)                     — matching key for a player name (alias-aware).
     FF.parseEspnBox(summary)              — SITE box score -> Map(athleteId -> {meta,stats,raw}).
     FF.applyScoringPlays(summary, box)    — FG distances + 2-pt makes, parsed from the site's
                                              `scoringPlays[].text` (best-effort; box wins on count).
     FF.deriveEspnDst(summary)             — per-team D/ST stat line, derived from the OPPONENT's
                                              box + scoringPlays + points-allowed.
     FF.creditCorePlay(play, ctx)          — ONE core-API play -> [{key,stat,n}], ctx =
                                              {athleteTeam: Map(athleteId -> nflAbbr)}.
     FF.ingestSummary(eventId, summary)    — box ground truth for one game. Populates
                                              FF.gameBox(eventId) and the athleteTeam map
                                              creditCorePlay needs; call BEFORE ingestPlays
                                              for the same event.
     FF.ingestPlays(eventId, items)        — core-API plays -> running per-key stat lines +
                                              a stored per-play credit ledger (idempotent: a
                                              re-poll of the same play id is a no-op).
     FF.playCredits(eventId, playId)       — that play's credits, resolved to points + owner.
     FF.gamePlayers(eventId)               — every player in the box, with owner info, sorted
                                              by points.
     FF.buildOwnerIndex(teams, rosters)    — teams: [{id,...}], rosters: Map(teamId -> players[])
                                              -> sets the roster lookup ownerOf* reads. Pure;
                                              reusable by the reconciliation probe with frozen
                                              roster fixtures, no fetch involved.
     FF.ownerOfAthlete(espnId, meta?)      — meta = {name, nflAbbr} for the slp_ fallback path.
     FF.ownerOfDst(nflAbbr)
     FF.setRules(scoring) / FF.setTeams(teams) / FF.setSchedule(week, games) / FF.setMyTeam(id)
     FF.ingestBoard(events)                — sd-app.js's own normalized `events` array (see
                                              normEvent in sd-app.js) -> game state/period/clock
                                              per NFL team, for liveProj/teamScore/winProb.
     FF.teamScore(teamId) / FF.winProb(teamId) / FF.remaining(keys)
     FF.onChange(fn)                       — subscribe; fired after any ingest-/set-family call.

   Loader (fetch + localStorage; the DOM-facing half):
     FF.load({week?, teamId?, fetch?}) -> Promise. Reads settings/teams(masked)/sched or
       bracket/all 8 rosters for the week (with the ensureRoster fallback to the latest
       earlier week)/proj doc; calls the setters above. `fetch` is injectable for tests.
     FF.poll()                             — fetches summaries for live/final games that own a
                                              rostered starter, ≤4 per call, round-robin.

   sd-app.js integration hooks (bare globals, guarded there with `typeof x === 'function'` —
   see its own header comment; defined here so the two files snap together without either
   one importing the other):
     ffOnBoard(events), ffOnSummary(ev, rawSummary), ffTabFantasy(ev), ffCardExtra(ev),
     ffPlayExtra(ev, play), ffBoardHeader(), ffGameWeight(ev),
     ffAfterRender().
*/
(function (root) {
  const FF = {};

  // ============================================================================================
  // ---------------------------------- SCHEMA + SCORING ----------------------------------------
  // ============================================================================================
  // Same 28-key schema as lg-data.js's D.KEYS (duplicated on purpose — house convention). The
  // split dst_kr_td / dst_td (6-vs-8 return-TD reconciliation) and fg_made_yd (0.1/yd, the
  // league's only per-make FG rate) are both load-bearing; see docs/gffl.md.
  const KEYS = [
    "pass_yd", "pass_td", "pass_int", "pass_2pt",
    "rush_yd", "rush_td", "rush_2pt",
    "rec", "rec_yd", "rec_td", "rec_2pt",
    "fum_lost",
    "fg_0_39", "fg_40_49", "fg_50", "fg_miss", "xp_made", "xp_miss",
    "dst_sack", "dst_int", "dst_fum_rec", "dst_td", "dst_safety", "dst_blk",
    "off_fum_td",
    "fg_made_yd", "dst_2pt_ret", "one_pt_safety",
    "dst_fum_forced", "dst_kr_td",
  ];
  FF.KEYS = KEYS;
  const emptyStat = () => { const o = {}; for (const k of KEYS) o[k] = 0; o.dst_pa = null; return o; };
  FF.emptyStat = emptyStat;

  // Every factor that enters a score goes through this FIRST (the lg-data.js "NaN production
  // report", 2026-08-09, restated here verbatim because it is the single most-repeated bug in
  // this codebase): `x || 0` passes a truthy non-number straight through, and `0 * "x"` is NaN.
  // A scoring table is persisted, hand-edited data — untrusted input — so every read of it and
  // of any parsed stat is funneled through num().
  const num = (v) => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : 0; };
  FF.num = num;

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
  FF._paPoints = paPoints;

  // The live `settings.rules.scoring` table is read at call time, never cached into a constant
  // — a commissioner edit must take effect on the next score() call, not on the next deploy.
  FF.score = function (st, scoring) {
    const sc = scoring || (FF.rules && FF.rules.scoring) || {};
    let p = 0;
    for (const k of KEYS) p += num(st[k]) * num(sc[k]);
    p += paPoints(st.dst_pa, sc);
    const bonus = (yd, lo, hi, kLo, kHi) => (yd >= hi ? num(sc[kHi]) : yd >= lo ? num(sc[kLo]) : 0);
    p += bonus(num(st.pass_yd), 300, 400, "bonus_pass_300", "bonus_pass_400");
    p += bonus(num(st.rush_yd), 100, 200, "bonus_rush_100", "bonus_rush_200");
    p += bonus(num(st.rec_yd), 100, 200, "bonus_rec_100", "bonus_rec_200");
    const out = Math.round(p * 100) / 100;
    return Number.isFinite(out) ? out : 0;
  };

  // ============================================================================================
  // ------------------------------- TEAM ABBREV / NAME NORMALIZATION ----------------------------
  // ============================================================================================
  const slpTeam = (ab) => (ab === "WSH" ? "WAS" : ab || "");
  FF.slpTeam = slpTeam;
  const espnTeam = (ab) => (ab === "WAS" ? "WSH" : ab || "");
  FF.espnTeam = espnTeam;

  const ALIAS = { "bam knight": "zonovan knight" };
  function normName(n) {
    n = String(n || "").toLowerCase().replace(/[^a-z ]/g, "")
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").trim().replace(/ +/g, " ");
    return ALIAS[n] || n;
  }
  FF.normName = normName;
  const nameKey = (name, teamAb) => normName(name) + "|" + slpTeam(teamAb);
  FF._nameKey = nameKey;

  function fgBucket(yds) {
    const y = Number(yds) || 0;
    if (y >= 50) return "fg_50";
    if (y >= 40) return "fg_40_49";
    return "fg_0_39";
  }

  // ============================================================================================
  // ------------------------------ SITE BOX SCORE (ground truth) -------------------------------
  // ============================================================================================
  // Box category labels, as ESPN's site `summary?event=` payload actually ships them (verified
  // live against event 401872948, ATL @ GB, 2026 week 3). Same category set lg-data.js reads.
  function parseEspnBox(summary) {
    const out = new Map(); // athleteId(string) -> {meta:{name,shortName,pos,team}, stats, raw}
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
            meta: {
              name: ath.displayName || ath.shortName || id,
              shortName: ath.shortName || "",
              pos: (ath.position || {}).abbreviation || "",
              team: teamAb,
            },
            stats: emptyStat(), raw: {},
          };
          const v = a.stats || [];
          const g = (lab) => (gi[lab] != null ? v[gi[lab]] : undefined);
          const numOf = (lab) => { const x = parseFloat(g(lab)); return isNaN(x) ? 0 : x; };
          const S = rec.stats, R = rec.raw;
          if (cat.name === "passing") {
            const ca = String(g("C/ATT") || "");
            if (ca.includes("/")) { const [c, at] = ca.split("/").map(Number); R.pass_cmp = c || 0; R.pass_att = at || 0; }
            S.pass_yd = numOf("YDS"); S.pass_td = numOf("TD"); S.pass_int = numOf("INT");
          } else if (cat.name === "rushing") {
            R.rush_att = numOf("CAR"); S.rush_yd = numOf("YDS"); S.rush_td = numOf("TD");
          } else if (cat.name === "receiving") {
            S.rec = numOf("REC"); S.rec_yd = numOf("YDS"); S.rec_td = numOf("TD"); R.rec_tgt = numOf("TGTS");
          } else if (cat.name === "fumbles") {
            S.fum_lost = numOf("LOST");
          } else if (cat.name === "kicking") {
            const fg = String(g("FG") || ""), xp = String(g("XP") || "");
            if (fg.includes("/")) { const [m, at] = fg.split("/").map(Number); R.fg_made = m || 0; S.fg_miss = Math.max(0, (at || 0) - (m || 0)); }
            if (xp.includes("/")) { const [m, at] = xp.split("/").map(Number); S.xp_made = m || 0; S.xp_miss = Math.max(0, (at || 0) - (m || 0)); }
          } else if (cat.name === "defensive" || cat.name === "interceptions"
                     || cat.name === "kickReturns" || cat.name === "puntReturns") {
            // A player's OWN defensive/return touchdowns (own-player 6-pt rate, never the
            // D/ST unit's 8 — that split only ever applies to a DEFENSE slot, see deriveEspnDst).
            // "defensive"'s TD column is the umbrella count (a pick-six shows up there too), so
            // max() against "interceptions" de-duplicates rather than double-counting.
            R.td_def = cat.name === "defensive" ? numOf("TD") : (R.td_def || 0);
            R.td_int = cat.name === "interceptions" ? numOf("TD") : (R.td_int || 0);
            R.td_kr = cat.name === "kickReturns" ? numOf("TD") : (R.td_kr || 0);
            R.td_pr = cat.name === "puntReturns" ? numOf("TD") : (R.td_pr || 0);
            S.dst_td = Math.max(R.td_def || 0, R.td_int || 0) + (R.td_kr || 0) + (R.td_pr || 0);
          }
          out.set(id, rec);
        }
      }
    }
    return out;
  }
  FF.parseEspnBox = parseEspnBox;

  // FG distances + 2-pt conversions live only in scoringPlays text on the SITE summary (the box
  // gives only made/attempted counts). Best-effort text parse; unparsed makes fall back to the
  // short bucket at an approximated 33-yard make (flagged via raw.fgApprox), same as lg-data.js.
  function applyScoringPlays(summary, box) {
    const plays = summary?.scoringPlays || [];
    const kickersFg = new Map();
    const byName = new Map();
    for (const [id, rec] of box) byName.set(normName(rec.meta.name), id);
    const credit2pt = (name, stat) => {
      const id = byName.get(normName(name));
      if (id && box.get(id)) box.get(id).stats[stat] += 1;
    };
    for (const p of plays) {
      const text = String(p?.text || "");
      const type = String(p?.type?.abbreviation || p?.type || "");
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
    for (const [id, rec] of box) {
      const made = rec.raw.fg_made || 0;
      if (!made) continue;
      const d = kickersFg.get(id) || { fg_0_39: 0, fg_40_49: 0, fg_50: 0, yds: 0 };
      const seen = d.fg_0_39 + d.fg_40_49 + d.fg_50;
      rec.stats.fg_0_39 = d.fg_0_39 + Math.max(0, made - seen);
      rec.stats.fg_40_49 = d.fg_40_49;
      rec.stats.fg_50 = d.fg_50;
      rec.stats.fg_made_yd = (d.yds || 0) + Math.max(0, made - seen) * 33;
      if (seen < made) rec.raw.fgApprox = true;
    }
  }
  FF.applyScoringPlays = applyScoringPlays;

  // Team D/ST line, derived from the OPPONENT's offensive box (their thrown INTs are your INTs,
  // their sacks-taken are your sacks) + scoringPlays (return/blocked TDs, safeties) + the header
  // score (points allowed). Same 6-vs-8 split as lg-data.js: kick/punt returns -> dst_kr_td (8),
  // interception/fumble/blocked returns -> dst_td (6). Forced fumbles are NOT derivable from the
  // team summary stats (no such column) — documented gap, same as lg-data.js's fallback path.
  function deriveEspnDst(summary) {
    const teams = summary?.boxscore?.teams || [];
    const comp = summary?.header?.competitions?.[0];
    const comps = comp?.competitors || [];
    const statOf = (t, names) => {
      for (const s of (t?.statistics || [])) if (names.includes(s?.name)) return String(s?.displayValue ?? "");
      return "";
    };
    const out = new Map();
    for (const me of teams) {
      const myAb = me?.team?.abbreviation || "";
      const opp = teams.find((t) => t !== me);
      if (!opp) continue;
      const st = emptyStat();
      st.dst_sack = parseFloat(statOf(opp, ["sacksYardsLost", "sacks"]).split("-")[0]) || 0;
      st.dst_int = parseFloat(statOf(opp, ["interceptions"])) || 0;
      st.dst_fum_rec = parseFloat(statOf(opp, ["fumblesLost"])) || 0;
      const oppComp = comps.find((c) => c?.team?.abbreviation === (opp?.team?.abbreviation || ""));
      st.dst_pa = oppComp && oppComp.score != null ? Number(oppComp.score) : null;
      for (const p of (summary?.scoringPlays || [])) {
        if ((p?.team?.abbreviation || "") !== myAb) continue;
        const text = String(p?.text || "");
        if (/punt return|kickoff return/i.test(text)) st.dst_kr_td++;
        else if (/interception return|fumble return|blocked .* (return|touchdown)/i.test(text)) st.dst_td++;
        if (String(p?.type?.abbreviation || p?.type || "") === "SF" || /safety/i.test(text)) st.dst_safety++;
      }
      out.set("dst_" + slpTeam(myAb), { meta: { name: myAb + " D/ST", pos: "DST", team: myAb }, stats: st });
    }
    return out;
  }
  FF.deriveEspnDst = deriveEspnDst;

  // ============================================================================================
  // ------------------------------------ GAME STATE (per event) --------------------------------
  // ============================================================================================
  FF._gameBox = new Map();          // eventId -> Map(key -> {meta, stats, pts, line})
  FF._athleteTeamByEvent = new Map(); // eventId -> Map(athleteId -> nflAbbr) (incl. DST keys' own members)
  FF._eventTeams = new Map();       // eventId -> {home:{id,abbr,score}, away:{id,abbr,score}}
  FF._playCredits = new Map();      // eventId -> Map(playId -> [{key,stat,n}])
  FF._runningStats = new Map();     // eventId -> Map(key -> statLine)  (from ingestPlays, for the invariant check)
  FF._seenPlay = new Map();         // eventId -> Set(playId)           (idempotent re-poll)

  // A player who appears in the box for one event contributes to `_pointsForKey` for as long as
  // that event stays ingested — there is no week tag on a game, only an eventId. Sunday only
  // ever shows ONE week at a time, but nothing stops a caller (FF.load on a week change, or a
  // multi-week reconciliation script) from ingesting a second week's games into the SAME
  // process without clearing the first — and a player who played in both weeks would then have
  // his points from EVERY ingested week summed into one number. Measured: this is exactly what
  // made the week-2 reconciliation come back roughly double (see docs/gffl.md-style history in
  // the fantasy-engine build notes) before this reset existed. FF.load calls it on every load;
  // a caller ingesting multiple weeks in one process (a reconciliation probe, a test) must call
  // it between weeks itself.
  FF.resetGames = function () {
    FF._gameBox = new Map();
    FF._athleteTeamByEvent = new Map();
    FF._eventTeams = new Map();
    FF._playCredits = new Map();
    FF._runningStats = new Map();
    FF._seenPlay = new Map();
    FF._board = new Map();
  };

  const listeners = [];
  FF.onChange = function (fn) { if (typeof fn === "function") listeners.push(fn); };
  function fireChange(what) { for (const fn of listeners) { try { fn(what); } catch (e) { /* one bad listener must not break the rest */ } } }
  FF._fireChange = fireChange; // test hook

  // Built from the stats a player actually has, not his position: ESPN's site box score carries
  // no position on its athletes (measured on event 401872948: pos "" for every player), so a
  // position switch produced an empty line for everyone but the D/STs.
  function lineFor(pos, stats, raw) {
    raw = raw || {};
    if (pos === "DST") {
      return `${stats.dst_sack || 0} sack, ${stats.dst_int || 0} INT, ${stats.dst_pa == null ? "—" : stats.dst_pa} PA`;
    }
    const parts = [];
    if (raw.pass_att) parts.push(`${raw.pass_cmp || 0}/${raw.pass_att} pass, ${stats.pass_yd || 0} yds${stats.pass_td ? `, ${stats.pass_td} TD` : ""}${stats.pass_int ? `, ${stats.pass_int} INT` : ""}`);
    if (raw.rush_att) parts.push(`${raw.rush_att} car, ${stats.rush_yd || 0} yds${stats.rush_td ? `, ${stats.rush_td} TD` : ""}`);
    if (stats.rec || raw.rec_tgt) parts.push(`${stats.rec || 0} rec, ${stats.rec_yd || 0} yds${stats.rec_td ? `, ${stats.rec_td} TD` : ""}`);
    if (raw.fg_made != null || stats.fg_miss || stats.xp_made || stats.xp_miss) {
      parts.push(`${raw.fg_made || 0}/${(raw.fg_made || 0) + (stats.fg_miss || 0)} FG, ${stats.xp_made || 0}/${(stats.xp_made || 0) + (stats.xp_miss || 0)} XP`);
    }
    if (stats.fum_lost) parts.push(`${stats.fum_lost} fum lost`);
    if (stats.dst_td) parts.push(`${stats.dst_td} return TD`);
    return parts.join(" · ");
  }

  // The box-derived ground truth for one game: every player who appears in the site box score
  // (rostered or not), scored against the live rules table. This is what gamePlayers() and the
  // invariant check compare ingestPlays' running totals against.
  FF.ingestSummary = function (eventId, summary) {
    const box = parseEspnBox(summary);
    applyScoringPlays(summary, box);
    const dst = deriveEspnDst(summary);
    for (const [k, v] of dst) box.set(k, v);

    const out = new Map();
    const athleteTeam = new Map();
    for (const [key, rec] of box) {
      out.set(key, { meta: rec.meta, stats: rec.stats, pts: FF.score(rec.stats), line: lineFor(rec.meta.pos, rec.stats, rec.raw) });
      if (rec.meta.team) athleteTeam.set(key, rec.meta.team);
    }
    FF._gameBox.set(eventId, out);
    FF._athleteTeamByEvent.set(eventId, athleteTeam);

    const comp = summary?.header?.competitions?.[0];
    const comps = comp?.competitors || [];
    const H = comps.find((c) => c.homeAway === "home"), A = comps.find((c) => c.homeAway === "away");
    if (H && A) {
      FF._eventTeams.set(eventId, {
        home: { id: String(H.id), abbr: H.team?.abbreviation || "", score: H.score != null ? Number(H.score) : null },
        away: { id: String(A.id), abbr: A.team?.abbreviation || "", score: A.score != null ? Number(A.score) : null },
      });
    }
    fireChange({ type: "summary", eventId });
    return out;
  };

  // ---------------------------- per-play credit engine (CORE API) -----------------------------
  // See the file header for why every credit below resolves its TEAM from the athlete->team map
  // (built by ingestSummary) rather than from the play's own "offense"/"defense" role labels.
  function athleteIdFromRef(ref) { const m = String(ref || "").match(/athletes\/(\d+)/); return m ? m[1] : null; }
  FF._athleteIdFromRef = athleteIdFromRef;

  FF.creditCorePlay = function (play, ctx) {
    const credits = [];
    if (!play) return credits;
    // NOT `play.isPenalty` — measured against the real feed (event 401872948, play
    // 401872948530): a completed 10-yard catch that ALSO drew a declined-in-effect defensive
    // penalty carries `isPenalty:true` with no "No Play" in its text, and its yards very much
    // count (M.Lloyd's box line has no full accounting without it). The flag means "a penalty
    // was assessed on or around this play," not "this play was nullified." The reliable signal
    // for a wiped-out down is the literal "- No Play" ESPN's own gamebook appends to the text —
    // every genuinely-nullified play in that same game carries it, and nothing else does. A
    // play reversed by replay review (the feed's `type`/`text` already show the POST-REVIEW
    // result, e.g. a fumble that review overturned back to an incompletion) needs no separate
    // handling: it is simply typed as whatever it now is.
    if (/\bno play\b/i.test(String(play.text || ""))) return credits;
    const type = String(play?.type?.text || "");
    const typeL = type.toLowerCase();
    if (/coin toss|^timeout$|^official timeout$|two-minute warning|^end (of|period)/i.test(type)) return credits;

    const parts = play.participants || [];
    const by = (t) => parts.filter((p) => p.type === t).map((p) => athleteIdFromRef(p.athlete && p.athlete.$ref)).filter(Boolean);
    const one = (t) => by(t)[0] || null;
    const athleteTeam = (ctx && ctx.athleteTeam) || new Map();
    const teamOf = (id) => (id ? athleteTeam.get(id) || null : null);

    const add = (id, stat, n) => { if (id && stat && Number.isFinite(n) && n !== 0) credits.push({ key: id, stat, n }); };
    const addDst = (ab, stat, n) => { if (ab && stat && Number.isFinite(n) && n !== 0) credits.push({ key: "dst_" + slpTeam(ab), stat, n }); };

    const yds = Number(play.statYardage) || 0;
    const isTd = /touchdown/i.test(type);

    // The PAT (kicked XP or 2-pt try) rides on the SAME play item as the touchdown it follows —
    // the core API has no separate "Extra Point" play type. `pointAfterAttempt.value` (1 or 2)
    // says which was attempted; a `patScorer` participant means it succeeded (a missed kicked
    // XP still names the `kicker`, a failed 2-pt try names neither `patScorer` — best-effort;
    // no failed-PAT sample existed in the fixture this was proven against, see tools/fixtures).
    const creditPAT = () => {
      const paa = play.pointAfterAttempt;
      if (!paa) return;
      const v = Number(paa.value);
      if (v === 1) {
        const scorer = one("patScorer");
        if (scorer) add(scorer, "xp_made", 1);
        else { const k = one("kicker"); if (k) add(k, "xp_miss", 1); }
      } else if (v === 2) {
        const passer2 = one("patPasser"), scorer2 = one("patScorer");
        if (passer2 && scorer2) { add(passer2, "pass_2pt", 1); add(scorer2, "rec_2pt", 1); }
        else if (scorer2 && !passer2) add(scorer2, "rush_2pt", 1);
      }
    };

    if (/field goal/i.test(type)) {
      const kicker = one("kicker");
      const blocked = /block/i.test(typeL);
      const made = !blocked && !/missed|no good/i.test(typeL);
      if (made) { add(kicker, fgBucket(yds), 1); if (yds) add(kicker, "fg_made_yd", yds); }
      else {
        add(kicker, "fg_miss", 1);
        if (blocked) addDst(teamOf(one("blocker")), "dst_blk", 1);
      }
      if (isTd) addDst(teamOf(one("returner") || one("recoverer")), "dst_td", 1); // blocked-and-returned (rare)
      creditPAT();
      return credits;
    }
    if (/^rush$/i.test(type) || /rushing touchdown/i.test(type)) {
      const rusher = one("rusher");
      if (yds) add(rusher, "rush_yd", yds);
      if (isTd) add(rusher, "rush_td", 1);
      creditPAT();
      return credits;
    }
    if (/^pass reception$/i.test(type) || /passing touchdown/i.test(type)) {
      const passer = one("passer"), receiver = one("receiver");
      if (yds) add(passer, "pass_yd", yds);
      if (isTd) add(passer, "pass_td", 1);
      if (receiver) { add(receiver, "rec", 1); if (yds) add(receiver, "rec_yd", yds); if (isTd) add(receiver, "rec_td", 1); }
      creditPAT();
      return credits;
    }
    if (/pass incompletion/i.test(type)) return credits;
    if (/^sack$/i.test(type)) { addDst(teamOf(one("sackedBy")), "dst_sack", 1); return credits; }
    if (/interception return/i.test(type)) {
      add(one("passer"), "pass_int", 1);
      const defTeam = teamOf(one("passDefender")) || teamOf(one("returner"));
      addDst(defTeam, "dst_int", 1);
      if (isTd) addDst(defTeam, "dst_td", 1);
      creditPAT();
      return credits;
    }
    // "(Opponent)" is a real turnover: the ball carrier's team loses it, the recovering team's
    // TEAM bucket (not the individual recoverer) gets dst_fum_rec — this house scores D/ST as a
    // unit, never crediting an individual defender's recovery/sack count. "(Own)" is not a
    // turnover at all (see the file header's aborted-snap example) — no fum_lost, no dst credit;
    // an own-recovery TD pays the RECOVERING PLAYER (not the team unit) via off_fum_td.
    // NOTE (documented approximation, matching lg-data.js's own convention): neither branch
    // credits rush_yd/pass_yd for the play that produced the fumble — the core API's
    // `statYardage` on a fumble item is the RETURN's net yardage, not the original ball
    // carrier's box-counted gain (proven against Jordan Love's own aborted-snap play, event
    // 401872948: statYardage=5, but his season box shows 1 car for 0 yards — crediting 5 would
    // have been wrong). The box score (ingestSummary) remains the yardage source of truth.
    if (/fumble recovery \(opponent\)/i.test(typeL)) {
      add(one("fumbler"), "fum_lost", 1);
      const defTeam = teamOf(one("recoverer"));
      addDst(defTeam, "dst_fum_rec", 1);
      if (isTd) addDst(defTeam, "dst_td", 1);
      creditPAT();
      return credits;
    }
    if (/fumble recovery \(own\)/i.test(typeL)) {
      if (isTd) add(one("recoverer") || one("scorer"), "off_fum_td", 1);
      creditPAT();
      return credits;
    }
    if (/safety/i.test(typeL)) { addDst(teamOf(one("tackler")), "dst_safety", 1); return credits; }
    if (/^(kickoff|punt)/i.test(type)) {
      if (isTd) addDst(teamOf(one("returner")), "dst_kr_td", 1);
      if (/block/i.test(typeL)) addDst(teamOf(one("blocker")), "dst_blk", 1);
      creditPAT();
      return credits;
    }
    return credits; // penalties (caught above), timeouts, drive-meta rows: no stat, by design
  };

  // Per-play credits, accumulated into a RUNNING stat line per key (for the box-total invariant
  // check) and stored per play id (for playCredits()). Idempotent: re-polling the same feed with
  // overlapping plays only ever applies a given play id once.
  FF.ingestPlays = function (eventId, items) {
    let seen = FF._seenPlay.get(eventId);
    if (!seen) { seen = new Set(); FF._seenPlay.set(eventId, seen); }
    let ledger = FF._playCredits.get(eventId);
    if (!ledger) { ledger = new Map(); FF._playCredits.set(eventId, ledger); }
    let running = FF._runningStats.get(eventId);
    if (!running) { running = new Map(); FF._runningStats.set(eventId, running); }
    const athleteTeam = FF._athleteTeamByEvent.get(eventId) || new Map();
    const ctx = { athleteTeam };
    let touched = false;
    for (const play of (items || [])) {
      const pid = String(play?.id ?? "");
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      const credits = FF.creditCorePlay(play, ctx);
      ledger.set(pid, credits);
      for (const c of credits) {
        let st = running.get(c.key);
        if (!st) { st = emptyStat(); running.set(c.key, st); }
        if (c.stat === "dst_pa") st.dst_pa = c.n; else st[c.stat] = num(st[c.stat]) + c.n;
      }
      touched = true;
    }
    if (touched) fireChange({ type: "plays", eventId });
    return running;
  };

  // A live play can be rewritten after it first appears (a review reverses it, a penalty is
  // added, yardage is corrected). Forget it, undoing its running-stat credits, so the next
  // ingestPlays re-credits the corrected version instead of skipping it as already seen.
  FF.forgetPlay = function (eventId, playId) {
    const pid = String(playId);
    const seen = FF._seenPlay.get(eventId), ledger = FF._playCredits.get(eventId), running = FF._runningStats.get(eventId);
    const old = ledger && ledger.get(pid);
    if (old && running) {
      for (const c of old) {
        const st = running.get(c.key);
        if (st && c.stat !== "dst_pa") st[c.stat] = num(st[c.stat]) - c.n;
      }
    }
    if (ledger) ledger.delete(pid);
    if (seen) seen.delete(pid);
  };

  // Resolve one play's stored credits into display form: points per stat, a total, and (when
  // the athlete/DST is on a roster this session has indexed) the owning fantasy team + starter
  // flag. `label` matches the "+7.4" convention the UI's play rows already use for deltas.
  FF.playCredits = function (eventId, playId) {
    const ledger = FF._playCredits.get(eventId);
    const raw = ledger && ledger.get(String(playId));
    if (!raw || !raw.length) return [];
    const byKey = new Map();
    for (const c of raw) {
      let e = byKey.get(c.key);
      if (!e) { e = []; byKey.set(c.key, e); }
      e.push(c);
    }
    const athleteTeam = FF._athleteTeamByEvent.get(eventId) || new Map();
    const box = FF._gameBox.get(eventId);
    const out = [];
    for (const [key, cs] of byKey) {
      const scoring = (FF.rules && FF.rules.scoring) || {};
      const parts = cs.map((c) => ({ stat: c.stat, n: c.n, pts: Math.round(FF.score({ [c.stat]: c.n }, scoring) * 100) / 100 }));
      const pts = Math.round(parts.reduce((s, p) => s + p.pts, 0) * 100) / 100;
      const isDst = key.startsWith("dst_");
      const meta = box && box.get(key) && box.get(key).meta;
      const own = isDst ? FF.ownerOfDst(key.slice(4)) : FF.ownerOfAthlete(key, meta ? { name: meta.name, nflAbbr: meta.team } : null);
      out.push({
        key, name: (meta && meta.name) || (own && own.name) || key,
        team: isDst ? key.slice(4) : (athleteTeam.get(key) || (meta && meta.team) || null),
        teamId: own ? own.teamId : null, starter: own ? own.starter : false,
        pts, parts, label: (pts >= 0 ? "+" : "") + pts.toFixed(1),
      });
    }
    out.sort((a, b) => b.pts - a.pts);
    return out;
  };

  // Every player in the game's box, owner-enriched, highest fantasy points first.
  FF.gamePlayers = function (eventId) {
    const box = FF._gameBox.get(eventId);
    if (!box) return [];
    const out = [];
    for (const [key, row] of box) {
      const isDst = key.startsWith("dst_");
      const own = isDst ? FF.ownerOfDst(key.slice(4)) : FF.ownerOfAthlete(key, { name: row.meta.name, nflAbbr: row.meta.team });
      out.push({
        key, name: row.meta.name, pos: row.meta.pos, team: row.meta.team,
        pts: row.pts, line: row.line, stats: row.stats,
        teamId: own ? own.teamId : null, starter: own ? own.starter : false,
      });
    }
    out.sort((a, b) => b.pts - a.pts);
    return out;
  };

  // ============================================================================================
  // -------------------------------- OWNERSHIP (roster index) ----------------------------------
  // ============================================================================================
  // Roster keys come in three shapes (see the task's League facts): a plain ESPN athlete id
  // string, `dst_<ABBR>` (Sleeper-normalized abbrev — WAS not WSH), and `slp_<sleeperId>` (a
  // Sleeper-only player with no ESPN id, resolved by normalized name + NFL team instead).
  FF._ownerIdx = new Map();  // roster key (as stored) -> {teamId,key,slot,starter,name,pos,nfl}
  FF._nameIdx = new Map();   // normName|slpTeam(nfl)   -> same entry, for the slp_ fallback path

  FF.buildOwnerIndex = function (teams, rostersByTeamId) {
    FF._ownerIdx = new Map();
    FF._nameIdx = new Map();
    for (const t of (teams || [])) {
      const teamId = t.id;
      const players = (rostersByTeamId && rostersByTeamId.get(teamId)) || [];
      for (const p of players) {
        const starter = !["BENCH", "IR"].includes(p.slot);
        const entry = { teamId, key: p.key, slot: p.slot, starter, name: p.name, pos: p.pos, nfl: p.team };
        FF._ownerIdx.set(p.key, entry);
        if (p.name) FF._nameIdx.set(nameKey(p.name, p.team), entry);
      }
    }
    fireChange({ type: "owners" });
    return FF._ownerIdx;
  };

  FF.ownerOfAthlete = function (espnAthleteId, meta) {
    const id = espnAthleteId != null ? String(espnAthleteId) : null;
    if (id) {
      const hit = FF._ownerIdx.get(id);
      if (hit) return hit;
    }
    if (meta && meta.name) {
      const hit = FF._nameIdx.get(nameKey(meta.name, meta.nflAbbr));
      if (hit) return hit;
    }
    return null;
  };
  FF.ownerOfDst = function (nflAbbr) {
    return FF._ownerIdx.get("dst_" + slpTeam(nflAbbr)) || null;
  };

  // ============================================================================================
  // ------------------------------ LEAGUE STATE (teams/rules/matchups) -------------------------
  // ============================================================================================
  FF.teams = new Map();  // id -> {id,name,abbrev,owner,ownerFirst,colors,logo}
  FF.rules = null;
  FF.week = null;
  FF.season = 2026;
  FF.myTeamId = null;
  FF.matchups = [];      // [{home,away}] team ids, for FF.week
  FF.myMatchup = null;   // {me,opp} team ids | null

  FF.setRules = function (rules) { FF.rules = rules || null; fireChange({ type: "rules" }); };
  FF.setTeams = function (teamsArr) {
    FF.teams = new Map();
    for (const t of (teamsArr || [])) {
      const owner = t.owner || "";
      FF.teams.set(t.teamId != null ? t.teamId : t.id, {
        id: t.teamId != null ? t.teamId : t.id, name: t.name || "", abbrev: t.abbrev || "",
        // logoData is the crest a family member uploaded in GFFL (a data: URL); logo is the old
        // ESPN import. GFFL shows `logoData || logo` everywhere (lg-ui.js teamSrc), so this does
        // too. Reading `logo` alone showed the stale ESPN art for every team that had uploaded.
        owner, ownerFirst: owner.trim().split(/\s+/)[0] || "", colors: t.colors || null, logo: t.logoData || t.logo || "",
      });
    }
    fireChange({ type: "teams" });
  };
  function recomputeMyMatchup() {
    if (FF.myTeamId == null) { FF.myMatchup = null; return; }
    const g = (FF.matchups || []).find((m) => m.home === FF.myTeamId || m.away === FF.myTeamId);
    FF.myMatchup = g ? { me: FF.myTeamId, opp: g.home === FF.myTeamId ? g.away : g.home } : null;
  }
  // `games` arrives either as [[home,away],...] (LG.gamesForWeek's own shape) or [{home,away}].
  FF.setSchedule = function (week, games) {
    FF.week = week;
    FF.matchups = (games || []).map((g) => (Array.isArray(g) ? { home: g[0], away: g[1] } : { home: g.home, away: g.away }));
    recomputeMyMatchup();
    fireChange({ type: "schedule" });
  };
  FF.setMyTeam = function (teamId) { FF.myTeamId = teamId; recomputeMyMatchup(); fireChange({ type: "myTeam" }); };

  FF.rostersByTeamId = new Map(); // teamId -> players[]  (the week just loaded)
  FF.projByKey = new Map();       // key -> points (proj_<season>_w<week> doc, if present)

  // ============================================================================================
  // ----------------------------------- LIVE GAME STATE / SCORING ------------------------------
  // ============================================================================================
  FF._board = new Map(); // nflAbbr -> {eventId,state,period,clock}
  // Accepts sd-app.js's own normalized `events` (see normEvent in sd-app.js: {id,state,period,
  // clock,home:{abbr},away:{abbr}}), OR a raw ESPN scoreboard's `events[]`. Either shape is
  // reduced to the one thing teamScore/winProb need per NFL team: is its game still to be
  // decided, and how much of it is left.
  FF.ingestBoard = function (events) {
    FF._board = new Map();
    for (const raw of (events || [])) {
      let id, state, period, clock, homeAb, awayAb;
      if (raw && raw.home && raw.away && typeof raw.home === "object" && "abbr" in raw.home) {
        id = raw.id; state = raw.state; period = raw.period; clock = raw.clock;
        homeAb = raw.home.abbr; awayAb = raw.away.abbr;
      } else {
        const c = raw?.competitions?.[0]; const st = raw?.status || c?.status;
        const H = c?.competitors?.find((x) => x.homeAway === "home"), A = c?.competitors?.find((x) => x.homeAway === "away");
        id = raw?.id; state = st?.type?.state; period = st?.period; clock = st?.displayClock;
        homeAb = H?.team?.abbreviation; awayAb = A?.team?.abbreviation;
      }
      const g = { eventId: String(id), state, period: Number(period) || 1, clock: clock || "0:00" };
      // Keyed by the SLEEPER abbreviation, because every reader looks up with slpTeam(p.team)
      // from a roster doc (WAS). Keyed by ESPN's own WSH, Washington's starters never found
      // their game and read as not-yet-played all day.
      if (homeAb) FF._board.set(slpTeam(homeAb), g);
      if (awayAb) FF._board.set(slpTeam(awayAb), g);
    }
    fireChange({ type: "board" });
  };

  // Same order as lg-data.js D.projFor: the week's Grok-adjusted proj_ doc first, then
  // Sleeper's projection scored with the league's own rules. The proj_ doc only ever covers
  // numeric ESPN-id keys, so every D/ST, slp_-keyed player and (as measured on week 3) the
  // QBs and kickers the adjuster skipped come from Sleeper. Without the fallback those
  // starters projected 0 and the win odds read 15% for a team that was even.
  function projForKey(key) {
    if (FF.projByKey.has(key)) return FF.projByKey.get(key);
    if (FF.slpProj.has(key)) return FF.slpProj.get(key);
    const own = FF._ownerIdx.get(key);
    if (own && own.name) {
      const hit = FF.slpProj.get(nameKey(own.name, own.nfl));
      if (hit != null) return hit;
    }
    return null;
  }
  FF.projFor = projForKey;

  // lg-data.js normSlp, duplicated per house convention: Sleeper's stat names -> FF.KEYS.
  // Defensive keys only for a team-defense row; a player's return TD pays the base dst_td.
  function normSlp(st, isDst) {
    const n = emptyStat();
    n.pass_yd = num(st.pass_yd); n.pass_td = num(st.pass_td); n.pass_int = num(st.pass_int); n.pass_2pt = num(st.pass_2pt);
    n.rush_yd = num(st.rush_yd); n.rush_td = num(st.rush_td); n.rush_2pt = num(st.rush_2pt);
    n.rec = num(st.rec); n.rec_yd = num(st.rec_yd); n.rec_td = num(st.rec_td); n.rec_2pt = num(st.rec_2pt);
    n.fum_lost = num(st.fum_lost);
    n.fg_made_yd = num(st.fgm_yds);
    n.dst_2pt_ret = num(st.def_2pt);
    n.fg_0_39 = num(st.fgm_0_19) + num(st.fgm_20_29) + num(st.fgm_30_39);
    n.fg_40_49 = num(st.fgm_40_49); n.fg_50 = num(st.fgm_50p);
    n.fg_miss = num(st.fgmiss); n.xp_made = num(st.xpm); n.xp_miss = num(st.xpmiss);
    if (isDst) {
      n.dst_sack = num(st.sack ?? st.def_sack);
      n.dst_int = num(st.int ?? st.def_int);
      n.dst_fum_rec = num(st.fum_rec ?? st.def_fum_rec);
      n.dst_td = num(st.def_td);
      n.dst_kr_td = num(st.def_st_td) + num(st.st_td);
      n.dst_fum_forced = num(st.ff ?? st.def_ff);
      n.dst_safety = num(st.safe ?? st.safety);
      n.dst_blk = num(st.blk_kick);
    } else {
      n.dst_td = num(st.st_td);
    }
    n.off_fum_td = num(st.fum_rec_td);
    if (st.pts_allow != null) n.dst_pa = num(st.pts_allow);
    return n;
  }
  FF.normSlp = normSlp;
  // Sleeper's projections endpoint (api.sleeper.com, CORS-open) returns rows that carry the
  // player's name, team and position, so no 5MB player directory is needed to key them:
  // DEF rows key as dst_<team>, everyone else as normName|team (the same key the owner index
  // uses for slp_ players).
  FF.slpProj = new Map();
  FF.setSleeperProj = function (rows) {
    FF.slpProj = new Map();
    const scoring = (FF.rules && FF.rules.scoring) || {};
    for (const r of (rows || [])) {
      const pl = r && r.player; if (!pl || !r.stats) continue;
      const team = r.team || pl.team; if (!team) continue;
      const isDst = pl.position === "DEF";
      const pts = FF.score(normSlp(r.stats, isDst), scoring);
      if (isDst) FF.slpProj.set("dst_" + slpTeam(r.player_id || team), pts);
      else FF.slpProj.set(nameKey(`${pl.first_name || ""} ${pl.last_name || ""}`, team), pts);
    }
    fireChange({ type: "proj" });
  };

  // liveProj: a real number once a game exists for the key's NFL team (post -> final points;
  // pre -> the projection; in-progress -> points already scored + proj × the fraction of the
  // game clock remaining), or null when nothing at all is known about the player — never a
  // fabricated 0.0 (same "—" beats a lie rule as lg-data.js's D.liveProj).
  FF.liveProj = function (key, ptsNow) {
    const own = FF._ownerIdx.get(key);
    const nfl = own ? own.nfl : null;
    const g = nfl ? FF._board.get(slpTeam(nfl)) : null;
    const proj = projForKey(key);
    const pts = num(ptsNow);
    if (!g) return proj != null ? proj : (ptsNow != null ? pts : null);
    if (g.state === "post") return pts;
    if (g.state === "pre") return proj != null ? proj : pts;
    const period = num(g.period) || 1;
    const [mm, ss] = String(g.clock || "0:00").split(":").map(Number);
    const minLeft = Math.max(0, (4 - Math.min(period, 4)) * 15 + num(mm) + num(ss) / 60);
    const frac = Math.min(1, minLeft / 60);
    return pts + (proj != null ? num(proj) * frac : 0);
  };

  // The one live-points funnel every event-derived total reads: sum of every game this key's
  // NFL team has played that FF has ingested a box for. (Most players appear in exactly one
  // game per week; this still sums correctly if ingest ever sees more than one event tagged to
  // the same team, which should not happen in-season but must not double an actual bug either.)
  // A `slp_<sleeperId>` roster key has no ESPN id, so it never appears as a box key directly —
  // the box is always keyed by ESPN athlete id (or `dst_<abbr>`). Resolve it the same way
  // ownerOfAthlete resolves the OTHER direction: normalized name + NFL team against that game's
  // box-score athletes. Measured against the real week-1/week-2 reconciliation (every diff
  // between this engine and GFFL's own finalized totals traced to exactly this — a slp_-keyed
  // starter reading `null` where he had real points, e.g. Justin Herbert at slp-less
  // "key=4038941" resolved fine, but Team 1's Evan McPherson at `slp_7839` did not until this
  // fallback existed): without it, every roster with a Sleeper-only starter under-scored by
  // exactly that player's points, never over — the exact one-directional signature that gave
  // this bug away.
  FF._pointsForKey = function (key) {
    let total = null;
    for (const box of FF._gameBox.values()) {
      let row = box.get(key);
      if (!row && key.indexOf("slp_") === 0) {
        const own = FF._ownerIdx.get(key);
        if (own && own.name) {
          for (const brow of box.values()) {
            if (brow.meta && normName(brow.meta.name) === normName(own.name) && slpTeam(brow.meta.team) === slpTeam(own.nfl)) { row = brow; break; }
          }
        }
      }
      if (row) total = (total || 0) + row.pts;
    }
    return total;
  };

  FF.remaining = function (keys) {
    let left = 0, playing = 0, done = 0;
    for (const key of (keys || [])) {
      const own = FF._ownerIdx.get(key);
      const g = own && own.nfl ? FF._board.get(slpTeam(own.nfl)) : null;
      if (!g && FF._board.size) done++; // bye week: nothing left to play
      else if (!g || g.state === "pre") left++;
      else if (g.state === "in") playing++;
      else done++;
    }
    return { left, playing, done };
  };

  FF.teamScore = function (teamId) {
    const players = FF.rostersByTeamId.get(teamId) || [];
    const starters = players.filter((p) => !["BENCH", "IR"].includes(p.slot));
    let pts = 0, proj = 0, playing = 0, yetToPlay = 0, doneCt = 0;
    const rows = [];
    for (const p of starters) {
      const g = p.team ? FF._board.get(slpTeam(p.team)) : null;
      const scored = FF._pointsForKey(p.key);
      // No game on a loaded board means a bye (or an empty slot): nothing more is coming.
      const state = g ? g.state : (FF._board.size || !p.team ? "bye" : "pre");
      const linePts = scored != null ? scored : 0;
      pts += linePts;
      // Projected finish, not the pregame projection: a final game counts what he scored, a live
      // one what he has plus his projection over the clock that's left (liveProj). Summing the
      // raw pregame number here made the win odds ignore everything that had already happened.
      const lp = state === "bye" ? linePts : FF.liveProj(p.key, linePts);
      const pProj = lp != null ? lp : linePts;
      proj += pProj;
      if (state === "in") playing++; else if (state === "post" || state === "bye") doneCt++; else yetToPlay++;
      rows.push({ key: p.key, name: p.name, pos: p.pos, slot: p.slot, nfl: p.team, pts: linePts, proj: Math.round(pProj * 100) / 100, eventId: g ? g.eventId : null, state });
    }
    return {
      pts: Math.round(pts * 100) / 100, proj: Math.round(proj * 100) / 100,
      starters: rows, playing, yetToPlay, done: doneCt === starters.length && starters.length > 0,
    };
  };

  // Same shape as lg-data.js's D.winProb: a logistic on the projected-points lead, shrunk toward
  // 50% by how much of the slate is still to play, pinned to 100/0 once every starter is final.
  const WP_SIGMA = 10, WP_MIN_SD = 8, WP_SHRINK = 0.20, WP_LOGIT = 1.702;
  function wpFromLead(diff, nStill, nTotal) {
    const sd = Math.max(WP_MIN_SD, WP_SIGMA * Math.sqrt(Math.max(0, nStill)));
    const raw = 1 / (1 + Math.exp((-WP_LOGIT * diff) / sd));
    const a = nStill / Math.max(nTotal, 1);
    const w = WP_SHRINK * Math.min(1, Math.max(0, a));
    const p = (1 - w) * raw + w * 0.5;
    return Number.isFinite(p) ? p : 0.5;
  }
  FF.winProb = function (teamId) {
    if (teamId == null) return null;
    const g = FF.matchups.find((m) => m.home === teamId || m.away === teamId);
    if (!g) return null;
    const otherId = g.home === teamId ? g.away : g.home;
    const a = FF.teamScore(teamId), b = FF.teamScore(otherId);
    const keysA = (FF.rostersByTeamId.get(teamId) || []).filter((p) => !["BENCH", "IR"].includes(p.slot)).map((p) => p.key);
    const keysB = (FF.rostersByTeamId.get(otherId) || []).filter((p) => !["BENCH", "IR"].includes(p.slot)).map((p) => p.key);
    const diff = a.proj - b.proj;
    const ra = FF.remaining(keysA), rb = FF.remaining(keysB);
    if (ra.left === 0 && ra.playing === 0 && rb.left === 0 && rb.playing === 0) {
      return diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
    }
    return wpFromLead(diff, ra.left + ra.playing + rb.left + rb.playing, keysA.length + keysB.length);
  };

  // ============================================================================================
  // -------------------------------------------- LOADER -----------------------------------------
  // ============================================================================================
  // Firestore REST codec, duplicated from lg-core.js's fsDec (house convention: no shared
  // import). Read-only here — Sunday never writes to league data.
  function fsDec(v) {
    if (!v || typeof v !== "object") return null;
    if ("nullValue" in v) return null;
    if ("booleanValue" in v) return !!v.booleanValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return Number(v.doubleValue);
    if ("stringValue" in v) return v.stringValue;
    if ("timestampValue" in v) return String(v.timestampValue);
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsDec);
    if ("mapValue" in v) return fsDecFields(v.mapValue.fields);
    return null;
  }
  function fsDecFields(fields) {
    const out = {};
    for (const k of Object.keys(fields || {})) out[k] = fsDec(fields[k]);
    return out;
  }
  FF._fsDec = fsDecFields;

  const FS_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
  const FS_BASE = "https://firestore.googleapis.com/v1/projects/amen-farms-app/databases/(default)/documents";
  const FS_COLL = "gffl_fam2jan2g";

  function currentWeek() {
    // Same rule as LG.currentWeek (lg-core.js): league weeks run Tue 05:00 America/Chicago ->
    // next Tue; week 1 starts 2026-09-08. Sunday only needs an ESTIMATE for a default week
    // (an explicit week is always preferred when the caller supplies one), so this reads the
    // wall clock in UTC-relative terms without the DST-exact machinery lg-core.js needs for
    // waiver deadlines — good enough for "which week's rosters to default to."
    const SEASON_START = Date.UTC(2026, 8, 8, 10, 0, 0); // ~05:00 America/Chicago on 2026-09-08 (CDT, UTC-5)
    const w = 1 + Math.floor((Date.now() - SEASON_START) / (7 * 24 * 3600 * 1000));
    return Math.max(1, Math.min(18, w));
  }
  FF._currentWeek = currentWeek;

  FF.load = async function (opts) {
    opts = opts || {};
    const doFetch = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
    if (!doFetch) throw new Error("FF.load: no fetch available (pass opts.fetch)");
    FF.resetGames(); // see FF.resetGames's own comment — a week change must not accumulate games
    FF.slpProj = new Map(); // last week's Sleeper projections must not stand in while this week's load

    async function fsGet(id) {
      const r = await doFetch(FS_BASE + "/" + encodeURIComponent(FS_COLL) + "/" + encodeURIComponent(id) + "?key=" + FS_KEY);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("Firestore read failed (" + r.status + ") for " + id);
      const j = await r.json();
      return fsDecFields(j.fields);
    }
    async function fsQueryTeams() {
      const body = {
        structuredQuery: {
          from: [{ collectionId: FS_COLL }],
          where: { fieldFilter: { field: { fieldPath: "kind" }, op: "EQUAL", value: { stringValue: "team" } } },
          select: { fields: [{ fieldPath: "teamId" }, { fieldPath: "name" }, { fieldPath: "abbrev" }, { fieldPath: "owner" }, { fieldPath: "colors" }, { fieldPath: "logo" }, { fieldPath: "logoData" }] },
        },
      };
      const url = FS_BASE.replace(/\/documents$/, "/documents:runQuery") + "?key=" + FS_KEY;
      const r = await doFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("Firestore runQuery failed (" + r.status + ")");
      const rows = await r.json();
      return rows.filter((x) => x.document).map((x) => fsDecFields(x.document.fields));
    }

    // Reads run in parallel where they don't depend on each other: on a phone the old one-by-one
    // chain (settings, teams, schedule, then eight roster docs in turn) took ~8s before the
    // first point showed. Settings and week come first because the schedule source depends on
    // seasonWeeks; everything else fans out.
    const settings = await fsGet("settings");
    FF.setRules((settings && settings.rules) || null);

    const week = opts.week || currentWeek();
    const seasonWeeks = (FF.rules && FF.rules.seasonWeeks) || 14;

    // Sleeper projections are a 2MB optional extra: start the request now, apply it last, and
    // never let it hold up (or break) the load.
    const pos = ["QB", "RB", "WR", "TE", "K", "DEF"].map((x) => "position%5B%5D=" + x).join("&");
    const slpP = Promise.resolve()
      .then(() => doFetch(`https://api.sleeper.com/projections/nfl/${FF.season}/${week}?season_type=regular&${pos}`))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

    const [teamsArr, schedDoc, proj] = await Promise.all([
      fsQueryTeams(),
      fsGet((week <= seasonWeeks ? "sched_" : "bracket_") + FF.season),
      fsGet(`proj_${FF.season}_w${week}`),
    ]);
    FF.setTeams(teamsArr);
    const teamIds = teamsArr.map((t) => t.teamId);

    let games = [];
    if (week <= seasonWeeks) {
      const wk = schedDoc && schedDoc.weeks && schedDoc.weeks[week - 1];
      games = wk ? (wk.g || []).map((g) => [g.h, g.a]) : [];
    } else {
      const roundKey = week === seasonWeeks + 1 ? "r1" : week === seasonWeeks + 2 ? "r2" : week === seasonWeeks + 3 ? "r3" : null;
      const round = schedDoc && roundKey && schedDoc.rounds && schedDoc.rounds[roundKey];
      games = (round || []).filter((g) => g.home != null && g.away != null).map((g) => [g.home, g.away]);
    }
    FF.setSchedule(week, games);

    let teamId = opts.teamId;
    if (teamId == null && typeof location !== "undefined") {
      try { const q = new URLSearchParams(location.search); if (q.has("team")) teamId = Number(q.get("team")); } catch (e) { /* no location */ }
    }
    if (teamId == null && typeof localStorage !== "undefined") {
      try { const v = localStorage.getItem("gffl_team"); if (v != null) teamId = Number(v); } catch (e) { /* private mode */ }
    }
    FF.setMyTeam(teamId != null && !Number.isNaN(teamId) ? teamId : null);

    // ensureRoster's own fallback rule (lg-core.js): a missing week's roster is the latest
    // earlier week's, copied forward. Read-only here; Sunday never writes the copy back.
    // The eight teams load side by side; each walks back through earlier weeks on its own.
    const rostersByTeamId = new Map();
    await Promise.all(teamIds.map(async (tid) => {
      let players = null;
      for (let w = week; w >= 1 && !players; w--) {
        const doc = await fsGet(`roster_${FF.season}_w${w}_t${tid}`);
        if (doc) players = doc.players || [];
      }
      rostersByTeamId.set(tid, players || []);
    }));
    FF.rostersByTeamId = rostersByTeamId;
    FF.buildOwnerIndex(teamsArr.map((t) => ({ id: t.teamId })), rostersByTeamId);

    FF.projByKey = new Map();
    if (proj && proj.players) {
      for (const k of Object.keys(proj.players)) {
        const row = proj.players[k];
        // `p` is the adjusted projection of record (lg-data.js D.projFor reads hit.p); `b` is
        // the ESPN baseline it was adjusted from, used only if a row somehow lacks `p`.
        const p = row && (row.p != null ? row.p : row.b);
        if (p != null) FF.projByKey.set(k, num(p));
      }
    }
    fireChange({ type: "loaded" });
    slpP.then((rows) => { if (rows && FF.week === week) FF.setSleeperProj(rows); });
    return FF;
  };

  // Rotating live-poll helper: fetch site summaries for up to 4 events this session cares about
  // (a rostered starter is playing or just finished) per call, so an open board keeps matchup
  // totals current without every open tab re-fetching every game every tick.
  FF._pollCursor = 0;
  FF.poll = async function (opts) {
    opts = opts || {};
    const doFetch = opts.fetch || (typeof fetch !== "undefined" ? fetch : null);
    if (!doFetch) return;
    const relevant = new Set();
    for (const players of FF.rostersByTeamId.values()) {
      for (const p of players) {
        if (["BENCH", "IR"].includes(p.slot)) continue;
        const g = p.team ? FF._board.get(slpTeam(p.team)) : null;
        if (g && (g.state === "in" || g.state === "post") && g.eventId) relevant.add(g.eventId);
      }
    }
    const ids = [...relevant];
    if (!ids.length) return;
    const batch = [];
    for (let i = 0; i < Math.min(4, ids.length); i++) { batch.push(ids[(FF._pollCursor + i) % ids.length]); }
    FF._pollCursor = (FF._pollCursor + batch.length) % ids.length;
    for (const eventId of batch) {
      try {
        const r = await doFetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`);
        if (!r.ok) continue;
        const summary = await r.json();
        FF.ingestSummary(eventId, summary);
      } catch (e) { /* one bad fetch must not break the rotation */ }
    }
  };

  // The sd-app.js hook functions (ffBoardHeader, ffCardExtra, ffTabFantasy, …) live in
  // sd-ffui.js. This file stays the engine: data in, numbers out, no markup.

  // ============================================================================================
  root.FF = FF;
  if (typeof module !== "undefined" && module.exports) module.exports = FF;
})(typeof window !== "undefined" ? window : globalThis);
