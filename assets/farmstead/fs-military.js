/* FARMSTEAD fs-military.js — knights, garrisons, territory, combat, conquest.
 * Sim-safe: NO THREE, NO DOM, every random draw through FSC.rng (plan §16).
 *
 * WHAT LIVES HERE (plan §7 + the round-2 exact mechanics)
 *   · knights as RANKS inside their building (a garrison is a list of 0..4s —
 *     a knight only becomes a walking entity when he marches somewhere)
 *   · occupancy targets: threat tier → player level 0..4 → headcount table
 *   · periodic promotion rolls (the castle is the training ground)
 *   · morale from the player's share of the world's gold
 *   · territory: the influence-weight model + the "land you lost burns" cascade
 *   · attacks: knights walk offroad to the target flag and duel 1v1 to the death
 *   · capture, castle-falls-player-out, team victory
 *
 * TEAMS (plan §16): every rule below asks "same team?", never "same player".
 * Allies never fight, never displace each other's land, and win together.
 *
 * ─── EVENT NAMES (stable contract — render/UI/suites read G.events) ───────────
 *   knightGarrison  {bld, btype, p, rank, id}    a knight walked into a garrison
 *   knightLeave     {bld, p, rank, id}           …and out again (target dropped)
 *   knightSworn     {p, bld}                     castle turned a settler into a knight
 *   knightPromoted  {bld, btype, p, rank}
 *   landChanged     {n, gen}                     owner[] moved (n vertices)
 *   landLost        {v, from, to}                one vertex changed hands
 *   attackLaunched  {target, btype, from, p, n}
 *   knightArrive    {id, p, bld}
 *   fightStart      {bld, att, def, p, ap}
 *   fightRound      {bld, att, def, attWins, v, p, ap}
 *   knightDied      {id, p, v, rank, by}
 *   bldCaptured     {id, btype, v, from, p}
 *   castleFell      {id, v, p, by}
 *   playerEliminated{p, by}
 *   serfFade        {id, p, v, job}
 *   gameOver        {winnerTeam, winners}
 */
(function () {
  "use strict";

  const FSC = (typeof window !== "undefined" && window.FSC) ? window.FSC
    : (typeof require === "function" ? require("./fs-const.js") : null);
  const FSMap = (typeof window !== "undefined" && window.FSMap) ? window.FSMap
    : (typeof require === "function" ? require("./fs-map.js") : null);
  const FSSim = (typeof window !== "undefined" && window.FSSim) ? window.FSSim
    : (typeof require === "function" ? require("./fs-sim.js") : null);

  const FSMil = {};
  const JOB = FSC.JOB;
  const D = FSSim._d;                    // the sim internals Phase D may touch
  const event = FSSim.event;

  // ------------------------------------------------------------------ helpers
  function teamOf(G, p) { return (p >= 0 && G.players[p]) ? G.players[p].team : -1; }
  /** allied? (−1 = nobody is nobody's ally) */
  function sameTeam(G, a, b) {
    if (a < 0 || b < 0) return false;
    if (a === b) return true;
    return teamOf(G, a) === teamOf(G, b);
  }
  FSMil.sameTeam = sameTeam;
  FSMil.isEnemy = function (G, a, b) { return a >= 0 && b >= 0 && a !== b && !sameTeam(G, a, b); };

  /** A military building holds ground while at least one of its knights is home
   *  (a defender duelling at its own flag still counts — he has not left). */
  function occupied(b) { return !!b.mil && (b.mil.knights.length + (b.mil.defending || 0)) > 0; }
  FSMil.occupied = occupied;
  FSMil.garrisonOf = function (G, b) { return (b && b.mil) ? b.mil.knights.slice() : []; };

  /* ===================================================================== */
  /* ===== caches (derived, never saved) ================================== */
  /* ===================================================================== */
  const cache = { G: null, gen: -1, threat: {}, stakes: null,
    infl: null, inflN: 0, inflP: 0, mark: null, markGen: 0 };

  function resetCaches(G) {
    if (cache.G === G && cache.gen === G.ownerGen) return;
    cache.G = G; cache.gen = G.ownerGen;
    cache.threat = {}; cache.stakes = null;
  }

  /* ===================================================================== */
  /* ===== morale: your share of the world's gold ========================= */
  /* ===================================================================== */
  /**
   * No gold anywhere → everybody fights at full strength. Otherwise
   *   morale = FLOOR + (FULL − FLOOR) × min(1, 2 × myShare)
   * counting bars in warehouses AND the bars stacked in military buildings.
   */
  function computeMorale(G) {
    const np = G.players.length;
    const mine = new Array(np).fill(0);
    let all = 0;
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.state === "burn" || b.p < 0 || b.p >= np) continue;
      let n = 0;
      if (b.inv) n += b.inv.goldBar || 0;
      if (b.mil) n += b.mil.gold || 0;
      if (!n) continue;
      mine[b.p] += n; all += n;
    }
    const out = new Array(np);
    for (let p = 0; p < np; p++) {
      if (all <= 0) { out[p] = FSC.MORALE_FULL; continue; }
      let share = (mine[p] / all) * FSC.MORALE_SHARE_K;
      if (share > 1) share = 1;
      out[p] = FSC.MORALE_FLOOR + Math.floor((FSC.MORALE_FULL - FSC.MORALE_FLOOR) * share);
    }
    return out;
  }

  /**
   * Deliberately NOT cached: a bar delivered this tick must count in a duel
   * rolled this tick, and the whole thing is one pass over the buildings —
   * called about twice per FSC.FIGHT_ROUND_T ticks, not per frame.
   */
  FSMil.morale = function (G, p) {
    const m = computeMorale(G);
    return m[p] === undefined ? FSC.MORALE_FULL : m[p];
  };

  /**
   * One fighter's strength, the confirmed original formula:
   *   (STRENGTH_BASE × 2^rank × landFactor) >> 16
   * landFactor is LAND_OWN on his own player's soil, else his player's morale —
   * evaluated PER FIGHTER, so a defender pushed onto contested ground is just
   * as weakened as an invader.
   */
  FSMil.fighterStrength = function (G, p, rank, v) {
    const own = G.map.owner[v] === p;
    const land = own ? FSC.LAND_OWN : FSMil.morale(G, p);
    const r = Math.max(0, Math.min(FSC.KNIGHT_RANKS - 1, rank | 0));
    return (FSC.STRENGTH_BASE * (1 << r) * land) >> FSC.STRENGTH_SHIFT;
  };
  function strengthOf(G, s) { return FSMil.fighterStrength(G, s.p, s.rank, s.v); }

  /** Total fighting weight a player has garrisoned (exponential in rank). */
  FSMil.strength = function (G, p) {
    let n = 0;
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p || !b.mil || b.state === "burn") continue;
      for (let i = 0; i < b.mil.knights.length; i++) n += FSC.KNIGHT_EXP[b.mil.knights[i]] || 1;
    }
    for (const id in G.serfs) {
      const s = G.serfs[id];
      if (s.p === p && s.job === JOB.KNIGHT) n += FSC.KNIGHT_EXP[s.rank] || 1;
    }
    return n;
  };
  /** Knights a player owns, wherever they are (garrisons + stores + the road). */
  FSMil.knightCount = function (G, p) {
    let n = 0;
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p || b.state === "burn") continue;
      if (b.mil) n += b.mil.knights.length;
      if (b.pool) n += b.pool.knight || 0;
    }
    for (const id in G.serfs) if (G.serfs[id].p === p && G.serfs[id].job === JOB.KNIGHT) n++;
    return n;
  };

  /* ===================================================================== */
  /* ===== territory: the influence-weight model ========================== */
  /* ===================================================================== */

  /**
   * Claim strength this building projects onto a vertex `d` steps away.
   * The tier table is indexed by CLOSENESS (radius − distance), so influence
   * falls off outward and the ground under the building is uncontestable.
   * The castle stretches the fortress row over the wider CASTLE_RADIUS
   * (documented deviation §8: every start economy needs room).
   */
  function influenceAt(cl, d) {
    if (d >= cl.r) return 0;
    const idx = FSC.TERR_RADIUS - Math.floor((d * FSC.TERR_RADIUS) / cl.r);
    if (idx >= FSC.TERR_RADIUS) return FSC.TERR_ABSOLUTE;
    if (idx <= 0) return 0;
    return cl.tbl[idx];
  }
  FSMil.influenceAt = influenceAt;

  function claimList(G) {
    const out = [];
    for (const id in G.buildings) {
      const b = G.buildings[id];
      const def = FSC.BLD[b.type];
      if (!def.mil || b.state === "burn") continue;
      if (b.p < 0 || !G.players[b.p]) continue;
      if (b.type === "castle") {
        // The castle holds its ground from the first tick, garrison or not, and
        // its claim REACHES CASTLE_RADIUS inclusive — hence the +1 (influence
        // reaches zero one step past the last claimed ring, exactly as a hut's
        // radius-8 table claims rings 0..7).
        out.push({ v: b.v, p: b.p, id: b.id, r: FSC.CASTLE_RADIUS + 1, tbl: FSC.TERR_INFLUENCE.fortress });
        continue;
      }
      if (b.state !== "done" || !occupied(b)) continue;
      out.push({ v: b.v, p: b.p, id: b.id, r: FSC.TERR_RADIUS,
        tbl: FSC.TERR_INFLUENCE[b.type] || FSC.TERR_INFLUENCE.hut });
    }
    return out;
  }
  FSMil.claims = claimList;

  function ensureScratch(N, np) {
    if (cache.infl && cache.inflN === N && cache.inflP >= np) return;
    cache.infl = new Uint8Array(N * np);
    cache.mark = new Int32Array(N);
    cache.markGen = 0;
    cache.inflN = N; cache.inflP = np;
  }

  /**
   * FSMil.recomputeOwnership(G, area) — owner[] = argmax of summed influence.
   * `area` {v, r} limits the work to one building's reach (an exact bound: a
   * claim can only change vertices inside its own radius). Ties keep the
   * incumbent, then the lower player id; a claim NEVER displaces an ally.
   * Returns the number of vertices that changed hands.
   */
  let cascading = false, cascadeDirty = false;
  FSMil.recomputeOwnership = function (G, area, depth) {
    // while the conquest cascade is razing things, every burn would ask for a
    // fresh map — collapse them all into ONE pass at the end instead (O(n²)→O(n))
    if (cascading) { cascadeDirty = true; return 0; }
    const map = G.map, N = map.W * map.H, np = G.players.length;
    ensureScratch(N, np);
    const infl = cache.infl, mark = cache.mark;
    const claims = claimList(G);

    // ---- which vertices are we deciding? ----
    let region = null;
    if (area && area.v >= 0) {
      region = [];
      cache.markGen++;
      const gen = cache.markGen;
      FSMap.forRadius(map, area.v, area.r, (u) => { mark[u] = gen; region.push(u); });
    }
    if (region) {
      for (let i = 0; i < region.length; i++) {
        const u = region[i];
        for (let p = 0; p < np; p++) infl[p * N + u] = 0;
      }
    } else {
      infl.fill(0);
    }

    // ---- accumulate ----
    const gen = cache.markGen;
    for (let k = 0; k < claims.length; k++) {
      const cl = claims[k];
      if (region && FSMap.dist(map, cl.v, area.v) > area.r + cl.r) continue;
      const base = cl.p * N;
      FSMap.forRadius(map, cl.v, cl.r, (u, d) => {
        if (region && mark[u] !== gen) return;
        const w = influenceAt(cl, d);
        if (w <= 0) return;
        const i = base + u;
        if (w >= FSC.TERR_ABSOLUTE) infl[i] = FSC.TERR_ABSOLUTE;
        else if (infl[i] < FSC.TERR_ABSOLUTE) {
          const n = infl[i] + w;
          infl[i] = n > FSC.TERR_CAP ? FSC.TERR_CAP : n;
        }
      });
    }

    // ---- decide ----
    const changed = [];
    const owner = map.owner;
    const decide = (u) => {
      const inc = owner[u];
      let bestP = -1, bestVal = 0;
      for (let p = 0; p < np; p++) {
        const val = infl[p * N + u];
        if (val <= 0) continue;
        if (val > bestVal) { bestVal = val; bestP = p; }
        else if (val === bestVal) {
          if (p === inc) bestP = p;                        // the incumbent holds ties
          else if (bestP !== inc && p < bestP) bestP = p;  // …then the lower id
        }
      }
      // co-op: a friendly claim never pushes an ally off his own ground
      if (bestP >= 0 && inc >= 0 && bestP !== inc && sameTeam(G, bestP, inc) && infl[inc * N + u] > 0) bestP = inc;
      if (bestP === inc) return;
      owner[u] = bestP;
      changed.push(u);      // no per-vertex event: a big shift would flood the ring
    };
    if (region) { for (let i = 0; i < region.length; i++) decide(region[i]); }
    else { for (let u = 0; u < N; u++) decide(u); }

    if (!changed.length) return 0;
    G.ownerGen++;
    resetCaches(G);
    event(G, "landChanged", { n: changed.length, gen: G.ownerGen });
    const razed = applyLandLoss(G, changed);
    // a military building that burned in the cascade stops claiming — one more
    // pass settles it (bounded: three deep can never loop)
    if ((razed || cascadeDirty) && (depth | 0) < 3) {
      cascadeDirty = false;
      FSMil.recomputeOwnership(G, null, (depth | 0) + 1);
    }
    cascadeDirty = false;
    return changed.length;
  };

  /**
   * The conquest rule: anything of yours standing on ground that just went to a
   * RIVAL TEAM is lost — buildings burn, flags and roads dissolve, the goods on
   * them are rescheduled or lost. Allied ground never triggers it.
   * Returns true when a military building went up in smoke (the claim set moved).
   */
  function applyLandLoss(G, changed) {
    // while the razing runs, every burn asks for a fresh map — swallow those and
    // settle it with ONE pass afterwards (see recomputeOwnership)
    cascading = true;
    let razedMil = false;
    try { razedMil = razeLostLand(G, changed); } finally { cascading = false; }
    return razedMil;
  }

  function razeLostLand(G, changed) {
    const map = G.map;
    const lost = new Set(changed);
    let razedMil = false;

    // 1. buildings — their own vertex or their door flag fell to a rival
    const doomed = [];
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.state === "burn" || b.type === "castle") continue;
      let hit = lost.has(b.v) && !friendlyGround(G, b.v, b.p);
      if (!hit && b.flag) {
        const f = G.flags[b.flag];
        if (f && lost.has(f.v) && !friendlyGround(G, f.v, b.p)) hit = true;
      }
      if (hit) doomed.push(b);
    }
    for (let i = 0; i < doomed.length; i++) {
      const b = doomed[i];
      if (b.mil) razedMil = true;
      event(G, "bldOverrun", { id: b.id, btype: b.type, v: b.v, p: b.p, to: map.owner[b.v] });
      FSSim.notify(G, b.p, (FSC.BLD_NAME[b.type] || b.type) + " was overrun.", b.v);
      FSSim.burnBuilding(G, b);
    }

    // 2. flags on lost ground (their roads go with them)
    const flagIds = [];
    for (const id in G.flags) {
      const f = G.flags[id];
      if (!lost.has(f.v) || friendlyGround(G, f.v, f.p)) continue;
      flagIds.push(f.id);
    }
    for (let i = 0; i < flagIds.length; i++) {
      const f = G.flags[flagIds[i]];
      if (!f) continue;
      if (f.bld) {
        const b = G.buildings[f.bld];
        if (b && b.state !== "burn") continue;        // a live building keeps its flag
        if (b) b.flag = 0;
        f.bld = 0;
      }
      FSSim.removeFlag(G, f.id);
    }

    // 3. roads crossing lost ground
    const roadIds = [];
    for (const id in G.roads) {
      const r = G.roads[id];
      for (let i = 0; i < r.path.length; i++) {
        const v = r.path[i];
        if (lost.has(v) && !friendlyGround(G, v, r.p)) { roadIds.push(r.id); break; }
      }
    }
    for (let i = 0; i < roadIds.length; i++) if (G.roads[roadIds[i]]) FSSim.demolishRoad(G, roadIds[i]);
    return razedMil;
  }
  /** ground you may still stand on: yours, an ally's — never a rival's or no-man's. */
  function friendlyGround(G, v, p) {
    const o = G.map.owner[v];
    return o === p || sameTeam(G, o, p);
  }

  FSMil.territoryOf = function (G, p) {
    const owner = G.map.owner;
    let n = 0;
    for (let i = 0; i < owner.length; i++) if (owner[i] === p) n++;
    return n;
  };

  /** Border posts for the renderer: own vertices that touch someone else's. */
  FSMil.borderStakes = function (G) {
    resetCaches(G);
    if (cache.stakes) return cache.stakes;
    const map = G.map, N = map.W * map.H, out = [];
    for (let v = 0; v < N; v++) {
      const p = map.owner[v];
      if (p < 0) continue;
      for (let d = 0; d < 6; d++) {
        const u = FSMap.nbr(map, v, d);
        if (u < 0) { out.push({ v, p, d }); break; }
        if (map.owner[u] !== p) { out.push({ v, p, d }); break; }
      }
    }
    cache.stakes = out;
    return out;
  };

  /* ===================================================================== */
  /* ===== threat tiers + occupancy targets =============================== */
  /* ===================================================================== */

  /** Steps from every vertex to the nearest ENEMY-team ground (allies are safe). */
  function threatField(G, team) {
    resetCaches(G);
    let f = cache.threat[team];
    if (f) return f;
    const map = G.map, N = map.W * map.H, seeds = [];
    for (let v = 0; v < N; v++) {
      const o = map.owner[v];
      if (o >= 0 && G.players[o] && G.players[o].team !== team) seeds.push(v);
    }
    f = FSMap.distField(map, seeds, FSC.THREAT_NEAR[0] + 1);
    cache.threat[team] = f;
    return f;
  }

  function tierFor(d) {
    if (d > FSC.THREAT_NEAR[0]) return 0;
    if (d > FSC.THREAT_NEAR[1]) return 1;
    if (d > FSC.THREAT_NEAR[2]) return 2;
    return 3;
  }
  FSMil.threatTier = function (G, b) {
    const pl = G.players[b.p];
    if (!pl) return 0;
    const f = threatField(G, pl.team);
    return tierFor(f[b.v] === 255 ? 255 : f[b.v]);
  };

  function occLevels(G, b) {
    const pl = G.players[b.p];
    const occ = (pl && pl.knights && pl.knights.occ) || FSC.KNIGHT_OCC_DEFAULTS;
    const t = FSMil.threatTier(G, b);
    const pair = occ[t] || occ[occ.length - 1];
    return [Math.max(0, Math.min(FSC.OCC_LEVEL_MAX, pair[0])), Math.max(0, Math.min(FSC.OCC_LEVEL_MAX, pair[1]))];
  }
  function headTable(b) { return FSC.OCC_TABLE[b.type] || FSC.OCC_TABLE.hut; }

  /** The castle has no occupancy table row — its target is the player-set
   *  stepper (default CASTLE_KNIGHTS_DEFAULT, capped at CASTLE_KNIGHTS_MAX). */
  function castleWant(G, b) {
    const pl = G.players[b.p];
    const n = (pl && pl.knights) ? pl.knights.castleKnights : FSC.CASTLE_KNIGHTS_DEFAULT;
    return Math.max(0, Math.min(FSC.CASTLE_KNIGHTS_MAX, n | 0));
  }

  /** How many knights this building wants to hold right now. */
  function wantedFor(G, b) {
    if (b.type === "castle") return castleWant(G, b);
    return headTable(b)[occLevels(G, b)[1]];
  }
  /** How many must stay behind when an attack is being put together. */
  function minGarrison(G, b) {
    if (b.type === "castle") return Math.min(1, b.mil.knights.length);
    return headTable(b)[occLevels(G, b)[0]];
  }
  FSMil.wantedFor = wantedFor;
  FSMil.minGarrison = minGarrison;
  /**
   * The most knights this building could ever hold. The castle has no fixed
   * cap in the original (facts §13) — its ceiling is the player-set
   * castleKnights stepper, same as wantedFor(), not the occupancy table (there
   * is no "castle" row in OCC_TABLE, so that used to silently fall through to
   * hut's and under-report a big castle's real capacity).
   */
  FSMil.capacityOf = function (G, b) {
    if (b.type === "castle") return castleWant(G, b);
    return headTable(b)[FSC.OCC_LEVEL_MAX];
  };

  FSMil.refreshWanted = function (G, p) {
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p || !b.mil || b.state !== "done") continue;
      b.mil.wanted = wantedFor(G, b);
    }
  };

  /* ===================================================================== */
  /* ===== garrison management ============================================ */
  /* ===================================================================== */

  FSMil.onBuildingDone = function (G, b) {
    if (!b.mil) return;
    b.mil.wanted = wantedFor(G, b);
    if (b.mil.wanted > b.mil.knights.length) FSSim.requestSerf(G, b.p, JOB.KNIGHT, "bld", b.id);
    FSMil.onGarrisonChange(G, b);
  };

  /** The land follows the garrison — recompute only when 0 ↔ ≥1 flips. */
  FSMil.onGarrisonChange = function (G, b) {
    if (!b.mil) return;
    const now = occupied(b);
    const was = !!b.mil.claimed;
    b.mil.claimed = now;
    if (now !== was || b.type === "castle") {
      FSMil.recomputeOwnership(G, { v: b.v, r: b.type === "castle" ? FSC.CASTLE_RADIUS : FSC.TERR_RADIUS });
    }
  };

  /** Put a garrisoned knight back on the map at his own door flag. */
  function materialize(G, b, rank) {
    const f = G.flags[b.flag];
    const v = f ? f.v : b.v;
    const s = D.makeSerf(G, b.p, JOB.KNIGHT, v);
    s.rank = rank | 0;
    s.home = 0;
    return s;
  }

  function lowestIdx(list) {
    let k = 0;
    for (let i = 1; i < list.length; i++) if (list[i] < list[k]) k = i;
    return k;
  }
  function highestIdx(list) {
    let k = 0;
    for (let i = 1; i < list.length; i++) if (list[i] > list[k]) k = i;
    return k;
  }

  /** Over target → the single greenest knight walks home (confirmed original). */
  function ejectOne(G, b, strongest) {
    if (!b.mil.knights.length) return null;
    const k = strongest ? highestIdx(b.mil.knights) : lowestIdx(b.mil.knights);
    const rank = b.mil.knights.splice(k, 1)[0];
    const s = materialize(G, b, rank);
    event(G, "knightLeave", { bld: b.id, p: b.p, rank, id: s.id });
    D.sendHome(G, s);
    FSMil.onGarrisonChange(G, b);
    return s;
  }

  /**
   * The castle manages its own wall (a different, simpler rule than the
   * occupancy tables): keep exactly `castleKnights` — promote the best knight
   * out of the store, else swear in a settler with a sword and a shield, else
   * ask for a delivery; over target, one knight steps back into the store.
   */
  function castleGarrison(G, b, want) {
    const g = b.mil.knights;
    if (g.length < want) {
      if ((b.pool.knight || 0) > 0) {
        b.pool.knight--;
        g.push(FSSim.takeRank(b, true));
        D.syncPoolInv(b);
        FSMil.onGarrisonChange(G, b);
      } else if ((b.pool.generic || 0) > 0 && (b.inv.sword || 0) > 0 && (b.inv.shield || 0) > 0) {
        b.pool.generic--; b.inv.sword--; b.inv.shield--;
        g.push(0);
        D.syncPoolInv(b);
        event(G, "knightSworn", { p: b.p, bld: b.id });
        FSMil.onGarrisonChange(G, b);
      } else if (b.mil.knights.length + (b.mil.inbound || 0) < want) {
        FSSim.requestSerf(G, b.p, JOB.KNIGHT, "bld", b.id);
      }
    } else if (g.length > want) {
      const rank = g.splice(lowestIdx(g), 1)[0];
      b.pool.knight = (b.pool.knight || 0) + 1;
      (b.knightRanks || (b.knightRanks = [])).push(rank);
      D.syncPoolInv(b);
      FSMil.onGarrisonChange(G, b);
    }
  }

  function tickGarrisons(G) {
    // recount what is on the road once per sweep — self-healing bookkeeping
    const inbound = Object.create(null);
    for (const id in G.serfs) {
      const s = G.serfs[id];
      if (s.job !== JOB.KNIGHT) continue;
      if (s.state === "goBld" || s.state === "enter") inbound[s.target] = (inbound[s.target] || 0) + 1;
    }
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (!b.mil || b.state !== "done") continue;
      const pl = G.players[b.p];
      if (!pl || pl.eliminated) continue;
      b.mil.inbound = inbound[b.id] || 0;
      const want = wantedFor(G, b);
      b.mil.wanted = want;
      if (b.type === "castle") { castleGarrison(G, b, want); continue; }
      const held = b.mil.knights.length + (b.mil.defending || 0);
      if (held + b.mil.inbound < want) {
        FSSim.requestSerf(G, b.p, JOB.KNIGHT, "bld", b.id);
      } else if (b.mil.knights.length > want && !b.mil.fight && !b.mil.attackers.length) {
        ejectOne(G, b, false);
      }
    }
  }

  /* ===================================================================== */
  /* ===== promotion ====================================================== */
  /* ===================================================================== */
  /** One roll per garrisoned knight every PROMOTE_T ticks; p/65536 by tier+rank. */
  function tickPromotion(G) {
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (!b.mil || b.state !== "done") continue;
      const tbl = FSC.PROMOTE_P[b.type] || FSC.PROMOTE_P.hut;
      const g = b.mil.knights;
      for (let i = 0; i < g.length; i++) {
        const r = g[i];
        if (r >= FSC.KNIGHT_RANKS - 1) continue;
        if (FSC.rngInt(65536) < tbl[r]) {
          g[i] = r + 1;
          event(G, "knightPromoted", { bld: b.id, btype: b.type, p: b.p, rank: r + 1 });
          if (r + 1 >= 3) FSSim.notify(G, b.p, "A knight rose to " + FSC.RANK_NAMES[r + 1] + ".", b.v);
        }
      }
    }
  }

  /* ===================================================================== */
  /* ===== cycle knights ================================================== */
  /* ===================================================================== */
  /**
   * Rotate the frontier home: every field garrison sheds its veterans down to
   * the minimum, so fresh recruits go out and the seasoned ones come back to
   * the castle where promotion is fastest. (Simplification: the classic empties
   * them completely; we keep the minimum standing so the border cannot pop.)
   */
  FSMil.cycleKnights = function (G, p) {
    const pl = G.players[p];
    if (!pl) return { ok: false, why: "no player" };
    if ((pl.cycleT || 0) > G.tick) return { ok: false, why: "the last rotation is still under way" };
    pl.cycleT = G.tick + FSC.CYCLE_KNIGHTS_T;
    let moved = 0;
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p || !b.mil || b.state !== "done" || b.type === "castle") continue;
      if (b.mil.fight || b.mil.attackers.length) continue;
      const keep = Math.max(1, minGarrison(G, b));
      while (b.mil.knights.length > keep) { if (!ejectOne(G, b, true)) break; moved++; }
    }
    event(G, "knightsCycled", { p, moved });
    return { ok: true, moved };
  };

  /* ===================================================================== */
  /* ===== attacks ======================================================== */
  /* ===================================================================== */

  /** Own occupied military buildings in range of the target with knights to spare. */
  FSMil.attackSources = function (G, targetId, p) {
    const t = G.buildings[targetId];
    const out = [];
    if (!t) return out;
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p || !b.mil || b.state !== "done" || !b.mil.knights.length) continue;
      if (FSMap.dist(G.map, b.v, t.v) > FSC.ATTACK_RANGE) continue;
      const spare = b.mil.knights.length - minGarrison(G, b);
      if (spare > 0) out.push({ b, spare });
    }
    return out;
  };

  /** Phase-E attack dialog: how many knights could hit this target right now. */
  FSMil.maxAttackers = function (G, targetId, p) {
    const src = FSMil.attackSources(G, targetId, p);
    let n = 0;
    for (let i = 0; i < src.length; i++) n += src[i].spare;
    return Math.min(n, FSC.ATTACK_MAX);
  };

  /** Phase-E attack dialog: every enemy military building a player may attack. */
  FSMil.attackTargets = function (G, p) {
    const out = [];
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (!b.mil || b.state !== "done") continue;
      if (!FSMil.isEnemy(G, b.p, p)) continue;
      if (!occupied(b)) continue;
      const max = FSMil.maxAttackers(G, b.id, p);
      if (max <= 0) continue;
      out.push({ id: b.id, type: b.type, v: b.v, p: b.p, garrison: b.mil.knights.length,
        gold: b.mil.gold || 0, max });
    }
    out.sort((a, b) => a.id - b.id);
    return out;
  };

  /** Where an attacker stands while he waits his turn — a ring around the flag. */
  function slotVertex(G, flagV, i) {
    const map = G.map, ring = [];
    for (let d = 0; d < 6; d++) {
      const u = FSMap.nbr(map, flagV, d);
      if (u < 0 || !FSMap.walkable(map.terr[u]) || map.bldAt[u]) continue;
      ring.push(u);
    }
    if (!ring.length) return flagV;
    return ring[i % ring.length];
  }

  function routeAttacker(G, s) {
    const t = G.buildings[s.atkTarget];
    if (!t) return false;
    const tf = G.flags[t.flag];
    const goal = slotVertex(G, tf ? tf.v : t.v, s.atkSlot | 0);
    if (s.v === goal) { s.path = []; s.offroad = true; return true; }
    const path = FSSim.offroadPath(G, s.v, goal, { maxLen: FSC.KNIGHT_WALK_MAX });
    if (!path || path.length < 2) return false;
    s.path = path.slice(1);
    s.from = s.v; s.to = s.path[0]; s.stepT = 0; s.frac = 0;
    s.offroad = true;
    return true;
  }

  /**
   * FSMil.attack(G, targetId, count, p, strong) — send knights.
   * Validates a real enemy-team target, gathers every own occupied military
   * building inside ATTACK_RANGE, and takes `count` knights from their SPARE
   * garrison (the minimum for their threat tier always stays home, so an attack
   * can never hand the attacker's own land away).
   */
  FSMil.attack = function (G, targetId, count, p, strong) {
    const t = G.buildings[targetId];
    const pl = G.players[p];
    if (!pl) return { ok: false, why: "no player" };
    if (pl.eliminated) return { ok: false, why: "you are out of the game" };
    if (!t || !t.mil) return { ok: false, why: "not a military building" };
    if (t.state !== "done") return { ok: false, why: "not finished" };
    if (t.p === p) return { ok: false, why: "that one is yours" };
    if (sameTeam(G, t.p, p)) return { ok: false, why: "that is your ally's" };
    if (!occupied(t)) return { ok: false, why: "nobody is home" };

    const src = FSMil.attackSources(G, targetId, p);
    if (!src.length) return { ok: false, why: "no knights in range" };
    // candidate list: (building, rank) pairs, only up to each building's spare
    const cand = [];
    for (let i = 0; i < src.length; i++) {
      const b = src[i].b;
      const order = b.mil.knights.map((r, idx) => ({ r, idx }));
      order.sort((x, y) => (strong ? (y.r - x.r) : (x.r - y.r)) || (x.idx - y.idx));
      for (let k = 0; k < src[i].spare; k++) cand.push({ b, rank: order[k].r });
    }
    cand.sort((x, y) => (strong ? (y.rank - x.rank) : (x.rank - y.rank)) || (x.b.id - y.b.id));
    let n = (count === undefined || count === null) ? cand.length : Math.max(1, count | 0);
    n = Math.min(n, cand.length, FSC.ATTACK_MAX);
    if (n <= 0) return { ok: false, why: "no knights to send" };

    let sent = 0;
    for (let i = 0; i < cand.length && sent < n; i++) {
      const b = cand[i].b;
      // take that exact rank out of the building (it may have shifted)
      const list = b.mil.knights;
      let k = -1;
      for (let j = 0; j < list.length; j++) if (list[j] === cand[i].rank) { k = j; break; }
      if (k < 0) continue;
      if (list.length - 1 < minGarrison(G, b)) continue;         // never dip below the floor
      const rank = list.splice(k, 1)[0];
      const s = materialize(G, b, rank);
      s.atkTarget = t.id;
      s.atkSlot = sent;
      s.atkFrom = b.id;
      s.state = "atkWalk";
      if (!routeAttacker(G, s)) {                                 // no way across — stand down
        list.push(rank);
        delete G.serfs[s.id];
        continue;
      }
      t.mil.attackers.push(s.id);
      sent++;
      FSMil.onGarrisonChange(G, b);
    }
    if (!sent) return { ok: false, why: "no route to the target" };
    event(G, "attackLaunched", { target: t.id, btype: t.type, v: t.v, p, from: t.p, n: sent });
    FSSim.notify(G, p, "Your knights march on the " + (FSC.BLD_NAME[t.type] || t.type) + ".", t.v);
    if (!t.mil.warned) {
      t.mil.warned = G.tick || 1;
      FSSim.notify(G, t.p, "Under attack! " + (FSC.BLD_NAME[t.type] || t.type) + " is besieged.", t.v);
    }
    return { ok: true, sent, target: t.id };
  };

  /** An attacker with nothing left to do walks back to a warehouse. */
  function standDown(G, s) {
    const t = G.buildings[s.atkTarget];
    if (t && t.mil) {
      const k = t.mil.attackers.indexOf(s.id);
      if (k >= 0) t.mil.attackers.splice(k, 1);
      if (t.mil.fight && (t.mil.fight.att === s.id)) t.mil.fight = null;
    }
    s.atkTarget = 0; s.atkSlot = 0;
    D.sendHome(G, s);
  }

  /** PHASE-D serf states: an attacking knight walking, waiting or duelling. */
  FSMil.tickKnight = function (G, s) {
    if (s.state === "fight" || s.state === "garrison") return;   // driven by the fight loop
    const t = G.buildings[s.atkTarget];
    if (!t || !t.mil || t.state === "burn" || t.p === s.p || sameTeam(G, t.p, s.p)) { standDown(G, s); return; }
    if (s.state === "atkWalk") {
      if (!D.walk(G, s)) return;
      s.state = "atkWait";
      event(G, "knightArrive", { id: s.id, p: s.p, bld: t.id, v: s.v });
      return;
    }
    // atkWait — the target's fight loop calls him forward
    s.atkT = (s.atkT || 0) + 1;
    if (s.atkT > FSC.SIEGE_GIVEUP_T) standDown(G, s);
  };

  function pruneAttackers(G, b) {
    const list = b.mil.attackers;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = G.serfs[list[i]];
      if (!s || s.atkTarget !== b.id) list.splice(i, 1);
    }
  }

  function killKnight(G, s, b, byId) {
    G.corpses.push({ v: s.v, p: s.p, t: G.tick });
    if (G.corpses.length > 64) G.corpses.shift();
    event(G, "knightDied", { id: s.id, p: s.p, v: s.v, rank: s.rank | 0, by: byId || 0, bld: b ? b.id : 0 });
    delete G.serfs[s.id];
  }

  function startDuel(G, b, waiting) {
    // prefer a challenger already standing next to the flag
    const f = G.flags[b.flag];
    const flagV = f ? f.v : b.v;
    let pick = waiting[0];
    for (let i = 0; i < waiting.length; i++) {
      const s = G.serfs[waiting[i]];
      if (s && FSMap.adjacent(G.map, s.v, flagV)) { pick = waiting[i]; break; }
    }
    const att = G.serfs[pick];
    if (!att) return;
    // the best knight in the house answers the door
    const k = highestIdx(b.mil.knights);
    const rank = b.mil.knights.splice(k, 1)[0];
    b.mil.defending = (b.mil.defending || 0) + 1;
    const def = D.makeSerf(G, b.p, JOB.KNIGHT, flagV);
    def.rank = rank; def.home = b.id; def.state = "fight"; def.defOf = b.id;
    att.state = "fight";
    b.mil.fight = { att: att.id, def: def.id, t: FSC.FIGHT_ROUND_T, round: 0 };
    event(G, "fightStart", { bld: b.id, att: att.id, def: def.id, p: b.p, ap: att.p, v: flagV });
    FSMil.onGarrisonChange(G, b);
  }

  function advanceFight(G, b) {
    const fi = b.mil.fight;
    const att = G.serfs[fi.att], def = G.serfs[fi.def];
    if (!att || !def) {                       // somebody vanished — reset the duel
      if (def) { b.mil.knights.push(def.rank | 0); b.mil.defending--; delete G.serfs[def.id]; }
      else if (b.mil.defending > 0) b.mil.defending--;
      if (att) att.state = "atkWait";
      b.mil.fight = null;
      FSMil.onGarrisonChange(G, b);
      return;
    }
    if (--fi.t > 0) return;
    fi.round++;
    const sa = strengthOf(G, att), sd = strengthOf(G, def);
    const total = sa + sd;
    const attWins = total <= 0 ? (FSC.rngInt(2) === 0) : (FSC.rngInt(total) < sa);
    event(G, "fightRound", { bld: b.id, att: att.id, def: def.id, attWins, round: fi.round,
      v: def.v, p: b.p, ap: att.p, sa, sd });
    b.mil.fight = null;
    if (attWins) {
      b.mil.defending--;
      killKnight(G, def, b, att.id);
      att.state = "atkWait";
      if (b.mil.knights.length + b.mil.defending <= 0) { capture(G, b, att.p); return; }
      FSMil.onGarrisonChange(G, b);
    } else {
      const k = b.mil.attackers.indexOf(att.id);
      if (k >= 0) b.mil.attackers.splice(k, 1);
      killKnight(G, att, b, def.id);
      // the winner steps back inside
      b.mil.knights.push(def.rank | 0);
      b.mil.defending--;
      delete G.serfs[def.id];
      FSMil.onGarrisonChange(G, b);
      if (!b.mil.attackers.length) {
        b.mil.warned = 0;
        event(G, "siegeBroken", { bld: b.id, p: b.p });
        FSSim.notify(G, b.p, "The attack was beaten off.", b.v);
      }
    }
  }

  /** Split the besiegers into "standing at the flag" and "still on the road". */
  function splitAttackers(G, b) {
    const arrived = [], marching = [];
    for (let i = 0; i < b.mil.attackers.length; i++) {
      const s = G.serfs[b.mil.attackers[i]];
      if (!s) continue;
      if (s.state === "atkWait" || s.state === "fight") arrived.push(s); else marching.push(s);
    }
    return { arrived, marching };
  }

  /**
   * The last defender is down. The building changes hands: its flag, goods and
   * roads belong to the old owner and are lost with it, the surviving attackers
   * move in (up to the building's cap) and the border is redrawn — which may
   * set fire to whatever the loser still had on the ground around it.
   */
  function capture(G, b, byP) {
    const victim = b.p;
    const split = splitAttackers(G, b);
    b.mil.fight = null;
    if (b.type === "castle") { castleFalls(G, b, byP, split); return; }

    const f = G.flags[b.flag];
    if (f) {
      const roads = f.roads.slice();
      for (let i = 0; i < roads.length; i++) FSSim.demolishRoad(G, roads[i]);
      for (let i = 0; i < f.slots.length; i++) {
        const it = f.slots[i];
        D.inFlightAdd(G, G.buildings[it.dest], it.res, -1);
        event(G, "itemLost", { res: it.res, v: f.v, why: "captured" });
      }
      f.slots.length = 0;
      f.p = byP;
    }
    D.dropRequest(G, "bld", b.id);
    b.p = byP;
    b.mil.gold = 0; b.mil.goldReq = 0; b.mil.inbound = 0;
    b.mil.knights.length = 0; b.mil.defending = 0;
    b.mil.warned = 0;
    b.reqInFlight = {};
    D.rescheduleFor(G, b.id);

    const cap = FSMil.capacityOf(G, b);
    // Only the CAPTURING PLAYER's own arrived knights become the new garrison.
    // A rival who happened to be besieging the same building at the same
    // moment (two mutually hostile players sieging one victim) is not this
    // capture's business — he is never absorbed, never deleted. He stays an
    // attacker of the building under its new owner and resolves himself the
    // very next tick through the ordinary state machine (tickKnight, called
    // before tickFights each tick): same team as byP → the target is now
    // friendly ground, standDown sends him home; a genuine rival → he keeps
    // waiting in atkWait and either duels the fresh garrison (startDuel picks
    // him up once byP's knights are in place) or gives up after
    // SIEGE_GIVEUP_T like any other stalled siege — never stuck.
    const stillBesieging = [];
    for (let i = 0; i < split.arrived.length; i++) {
      const s = split.arrived[i];
      if (s.p !== byP) {
        if (s.state === "fight") s.state = "atkWait";  // a duel can't outlive its building's owner
        stillBesieging.push(s.id);
        continue;
      }
      s.atkTarget = 0;
      if (b.mil.knights.length < cap) {
        b.mil.knights.push(s.rank | 0);
        event(G, "knightGarrison", { bld: b.id, btype: b.type, p: byP, rank: s.rank | 0, id: s.id });
        delete G.serfs[s.id];
      } else {
        D.sendHome(G, s);
      }
    }
    for (let i = 0; i < split.marching.length; i++) {       // the late column turns around
      const s = split.marching[i];
      s.atkTarget = 0;
      D.sendHome(G, s);
    }
    b.mil.attackers = stillBesieging;
    b.mil.wanted = wantedFor(G, b);
    b.mil.claimed = occupied(b);
    event(G, "bldCaptured", { id: b.id, btype: b.type, v: b.v, from: victim, p: byP });
    FSSim.notify(G, byP, "Captured a " + (FSC.BLD_NAME[b.type] || b.type) + "!", b.v);
    FSSim.notify(G, victim, "Lost a " + (FSC.BLD_NAME[b.type] || b.type) + ".", b.v);
    FSMil.recomputeOwnership(G, null);
  }

  function castleFalls(G, b, byP, split) {
    const victim = b.p;
    b.mil.attackers.length = 0;
    const all = split.arrived.concat(split.marching);
    for (let i = 0; i < all.length; i++) { all[i].atkTarget = 0; D.sendHome(G, all[i]); }
    event(G, "castleFell", { id: b.id, v: b.v, p: victim, by: byP });
    FSSim.notify(G, byP, (G.players[victim] ? G.players[victim].name : "A rival") + "'s castle has fallen!", b.v);
    FSMil.eliminate(G, victim, byP);
  }

  function tickFights(G) {
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (!b.mil) continue;
      if (b.state === "burn") {
        if (b.mil.attackers.length) {
          const list = b.mil.attackers.slice();
          b.mil.attackers.length = 0;
          for (let i = 0; i < list.length; i++) { const s = G.serfs[list[i]]; if (s) { s.atkTarget = 0; D.sendHome(G, s); } }
        }
        continue;
      }
      if (b.mil.fight) { advanceFight(G, b); continue; }
      if (!b.mil.attackers.length) { if (b.mil.warned) b.mil.warned = 0; continue; }
      pruneAttackers(G, b);
      if (!b.mil.attackers.length) continue;
      const waiting = [];
      for (let i = 0; i < b.mil.attackers.length; i++) {
        const s = G.serfs[b.mil.attackers[i]];
        if (s && s.state === "atkWait") waiting.push(s.id);
      }
      if (!waiting.length) continue;
      if (b.mil.knights.length <= 0 && (b.mil.defending || 0) <= 0) {
        const first = G.serfs[waiting[0]];
        capture(G, b, first ? first.p : b.p);
        continue;
      }
      if (b.mil.knights.length > 0) startDuel(G, b, waiting);
    }
  }

  /* ===================================================================== */
  /* ===== fire, elimination, victory ===================================== */
  /* ===================================================================== */

  /**
   * A building is burning: its garrison joins the escape queue (the fire's
   * escape budget is shared with the worker/crew, FSC.BURN_ESCAPE_MAX in all).
   * Attackers en route are called off.
   */
  FSMil.evictGarrison = function (G, b, opts) {
    opts = opts || {};
    if (!b.mil) return;
    let escaped = opts.escaped || 0;
    const g = b.mil.knights.slice();
    b.mil.knights.length = 0;
    for (let i = 0; i < g.length; i++) {
      if (!opts.noEscape && escaped < FSC.BURN_ESCAPE_MAX) {
        escaped++;
        const s = materialize(G, b, g[i]);
        D.sendHome(G, s);
      } else {
        event(G, "serfLost", { id: 0, job: JOB.KNIGHT, p: b.p, v: b.v, why: "fire" });
      }
    }
    // whoever was duelling here dies with the building
    if (b.mil.fight) {
      const def = G.serfs[b.mil.fight.def];
      if (def) delete G.serfs[def.id];
      const att = G.serfs[b.mil.fight.att];
      if (att) att.state = "atkWait";
      b.mil.fight = null;
    }
    b.mil.defending = 0;
    const list = b.mil.attackers.slice();
    b.mil.attackers.length = 0;
    for (let i = 0; i < list.length; i++) { const s = G.serfs[list[i]]; if (s) { s.atkTarget = 0; D.sendHome(G, s); } }
    b.mil.claimed = false;
  };

  /**
   * The castle fell: the player is out. His estate comes down over the next
   * few hundred ticks (FSC.DOOM_PER_TICK a tick) so a big kingdom collapsing
   * never costs a frame.
   */
  FSMil.eliminate = function (G, p, byP) {
    const pl = G.players[p];
    if (!pl || pl.eliminated) return false;
    pl.eliminated = true;
    event(G, "playerEliminated", { p, by: byP === undefined ? -1 : byP });
    FSSim.notify(G, p, "Your kingdom has fallen.");
    for (let q = 0; q < G.players.length; q++) {
      if (q !== p && !G.players[q].eliminated) FSSim.notify(G, q, pl.name + " has been wiped out.");
    }
    // every entry remembers WHO was doomed (p) so the drain can re-check
    // ownership: DOOM_PER_TICK trickles this out over tens/hundreds of ticks,
    // and anything the doomed player still owned can be fought over and
    // CAPTURED by someone else in that window — the queue must never raze a
    // building or flag that changed hands away from p in the meantime.
    for (const id in G.buildings) if (G.buildings[id].p === p) G.doomQ.push({ k: "b", id: G.buildings[id].id, p });
    for (const id in G.flags) if (G.flags[id].p === p) G.doomQ.push({ k: "f", id: G.flags[id].id, p });
    for (const id in G.serfs) if (G.serfs[id].p === p) G.doomQ.push({ k: "s", id: G.serfs[id].id, p });
    checkVictory(G);
    return true;
  };

  /**
   * Drain a few doom-queue entries. DOOM_PER_TICK trickles a big estate out
   * over tens/hundreds of ticks — plenty of time for a LIVE building or flag
   * still standing in that window to be fought over and captured by somebody
   * else. Re-check ownership right here at drain time: an entry whose current
   * owner is no longer the doomed player (d.p) is skipped outright, so the
   * winner's freshly captured property is never burned by the loser's own
   * elimination cascade. A serf id is never reused for a different player
   * (fresh serf ids only go up), so the same check on "s" is just defensive
   * symmetry with "b"/"f", not a live-exploitable path today.
   */
  function tickDoom(G) {
    let n = 0;
    while (G.doomQ.length && n < FSC.DOOM_PER_TICK) {
      const d = G.doomQ.shift();
      n++;
      if (d.k === "b") {
        const b = G.buildings[d.id];
        if (b && b.state !== "burn" && b.p === d.p) FSSim.burnBuilding(G, b, { noEscape: true });
      } else if (d.k === "f") {
        const f = G.flags[d.id];
        if (f && f.p === d.p) {
          if (f.bld) { const b = G.buildings[f.bld]; if (b) b.flag = 0; f.bld = 0; }
          FSSim.removeFlag(G, f.id);
        }
      } else if (d.k === "s") {
        const s = G.serfs[d.id];
        if (s && s.p === d.p) { event(G, "serfFade", { id: s.id, p: s.p, v: s.v, job: s.job }); delete G.serfs[s.id]; }
      }
    }
  }

  /** One team left standing (allies win together) → the game is decided. */
  function checkVictory(G) {
    if (G.gameOver) return;
    const teams = {};
    for (let i = 0; i < G.players.length; i++) {
      const pl = G.players[i];
      if (pl.eliminated) continue;
      (teams[pl.team] || (teams[pl.team] = [])).push(i);
    }
    const keys = Object.keys(teams);
    if (keys.length > 1) return;
    const winners = keys.length ? teams[keys[0]] : [];
    const winnerTeam = winners.length ? G.players[winners[0]].team : -1;
    G.gameOver = { winnerTeam, winners, t: G.tick };
    event(G, "gameOver", { winnerTeam, winners });
    for (let i = 0; i < winners.length; i++) FSSim.notify(G, winners[i], "The land is yours. Victory!");
    return;
  }
  FSMil.checkVictory = checkVictory;

  /* ===================================================================== */
  /* ===== the tick ======================================================= */
  /* ===================================================================== */
  FSMil.tick = function (G) {
    if (G.doomQ.length) tickDoom(G);
    if ((G.tick % FSC.GARRISON_T) === 0) tickGarrisons(G);
    if ((G.tick % FSC.PROMOTE_T) === 0) tickPromotion(G);
    tickFights(G);
    // corpses are a render courtesy — drop them once the fade is over
    if (G.corpses.length && (G.tick & 7) === 0) {
      while (G.corpses.length && G.tick - G.corpses[0].t > FSC.CORPSE_T) G.corpses.shift();
    }
    return G;
  };

  /** Fresh-game seeding — the castle already holds land before tick 1. */
  FSMil.initGame = function (G) {
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.mil) { b.mil.claimed = occupied(b); b.mil.wanted = wantedFor(G, b); }
    }
    FSMil.recomputeOwnership(G, null);
  };

  if (typeof window !== "undefined") window.FSMil = FSMil;
  if (FSSim._bindMilitary) FSSim._bindMilitary(FSMil, null);   // works in node too
  if (typeof module !== "undefined" && module.exports) module.exports = FSMil;
})();
