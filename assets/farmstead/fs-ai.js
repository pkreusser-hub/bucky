/* FARMSTEAD fs-ai.js — the computer opponents (plan §9).
 * Sim-safe: NO THREE, NO DOM, every random draw through FSC.rng.
 *
 * NO CHEATING. The planner calls exactly the functions the command layer calls
 * for a human (FSSim.build / placeFlag / buildRoad / demolish / sendGeologist,
 * FSMil.attack) and every one of them re-validates ownership, terrain, slope
 * and cost. The AI reads only what a player can see: its own territory, the map
 * surface, and geologists' SIGNS — never map.mineral, which is ground truth.
 *
 * SHAPE OF A PLANNER RUN (once per FSC.AI_PERIOD ticks, staggered per player,
 * budget ~1.5 ms): watchdog → at most ONE new building (site + road) → the odd
 * geologist → an attack decision every FSC.AI_ATTACK_T ticks. Everything heavy
 * (own-land list, rival-proximity field) is cached against G.ownerGen.
 *
 * DELIBERATE DESIGN CALL — the AI claims EMPTY land, and takes settled land by
 * conquest. It will not sneak a guard hut up against a neighbour's workshops to
 * burn them with border pressure: military sites keep clear of rival buildings,
 * so "my town caught fire" always has an army behind it.
 */
(function () {
  "use strict";

  const FSC = (typeof window !== "undefined" && window.FSC) ? window.FSC
    : (typeof require === "function" ? require("./fs-const.js") : null);
  const FSMap = (typeof window !== "undefined" && window.FSMap) ? window.FSMap
    : (typeof require === "function" ? require("./fs-map.js") : null);
  const FSSim = (typeof window !== "undefined" && window.FSSim) ? window.FSSim
    : (typeof require === "function" ? require("./fs-sim.js") : null);
  const FSMil = (typeof window !== "undefined" && window.FSMil) ? window.FSMil
    : (typeof require === "function" ? require("./fs-military.js") : null);

  const FSAI = {};
  const T = FSC.TERR, O = FSC.OBJ;
  const event = FSSim.event;

  /* ===================================================================== */
  /* ===== per-AI memory (lives on the player, so it saves and loads) ===== */
  /* ===================================================================== */
  function brain(G, p) {
    const pl = G.players[p];
    if (!pl.ai) {
      pl.ai = {
        black: {},        // vertex → tick the blacklist expires
        watch: {},        // site id → {mat, t} progress watchdog
        attackT: 0,
        geoT: 0,
        runs: 0,
        lastFail: "",
      };
    }
    return pl.ai;
  }
  function persona(p) { return FSC.AI_PERSONA[p % FSC.AI_PERSONA.length]; }

  /* ===================================================================== */
  /* ===== cached views of the world (rebuilt when the border moves) ====== */
  /* ===================================================================== */
  const cache = { G: null, gen: -1, land: {}, rival: {}, room: {}, roomGen: {} };
  function fresh(G) {
    if (cache.G === G && cache.gen === G.ownerGen) return;
    cache.G = G; cache.gen = G.ownerGen;
    cache.land = {}; cache.rival = {}; cache.room = {}; cache.roomGen = {};
  }

  /** Every vertex this player owns (the only ground he may build on). */
  function ownLand(G, p) {
    fresh(G);
    let a = cache.land[p];
    if (a) return a;
    const owner = G.map.owner, N = owner.length;
    a = [];
    for (let v = 0; v < N; v++) if (owner[v] === p) a.push(v);
    cache.land[p] = a;
    return a;
  }

  /**
   * Steps to the nearest ENEMY-team building. Doubles as "how close am I to a
   * war" and as the keep-off zone for new military sites.
   */
  function rivalField(G, p) {
    fresh(G);
    const team = G.players[p].team;
    let f = cache.rival[team];
    if (f) return f;
    const seeds = [];
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.state === "burn" || b.p < 0) continue;
      if (!G.players[b.p] || G.players[b.p].team === team) continue;
      seeds.push(b.v);
    }
    f = FSMap.distField(G.map, seeds, FSC.TERR_RADIUS + 4);
    cache.rival[team] = f;
    return f;
  }

  /* ===================================================================== */
  /* ===== small queries ================================================== */
  /* ===================================================================== */
  /**
   * How many building plots are left inside our own border. On a generous start
   * this is dozens; on a cramped one (rock, swamp and water everywhere) it can
   * be a handful, and every building we put down eats a plot plus the ring
   * around it. Cached against the border generation — it only moves when the
   * territory or the buildings do, and one bounded pass is the same budget as a
   * single site hunt.
   */
  function roomLeft(G, p) {
    fresh(G);
    // keyed on the ROAD/FLAG generation, not G.nextId — the latter ticks every
    // time a serf is born, which would defeat the cache entirely
    if (cache.room[p] !== undefined && cache.roomGen[p] === G.routeGen) return cache.room[p];
    const land = ownLand(G, p), map = G.map;
    let n = 0, checks = 0;
    const stride = Math.max(1, Math.floor(land.length / FSC.AI_SCAN_CAP));
    for (let i = 0; i < land.length; i += stride) {
      const v = land[i];
      if (map.bldAt[v] || map.flagAt[v] || map.terr[v] !== T.GRASS) continue;
      if (FSMap.objBlocks(map.obj[v])) continue;
      if (++checks > FSC.AI_PLACE_CHECKS) break;
      if (FSMap.canPlaceBuilding(map, "hut", v, p)) n++;
    }
    cache.room[p] = n;
    cache.roomGen[p] = G.routeGen;       // any new flag/road/building invalidates it
    return n;
  }

  function countTypes(G, p) {
    const c = Object.create(null);
    c._sites = 0; c._mil = 0; c._all = 0;
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p || b.state === "burn") continue;
      c[b.type] = (c[b.type] || 0) + 1;
      c._all++;
      if (b.state !== "done") c._sites++;
      if (b.mil && b.type !== "castle") c._mil++;
    }
    return c;
  }
  function has(c, t) { return c[t] || 0; }

  /**
   * On the network? Asked about dozens of flags per planner run, so it leans on
   * the ONE cached route table to the castle instead of a warehouse BFS per
   * flag (which is what made the first version's worst case 6 ms).
   */
  function homeFlag(G, p) {
    const c = FSSim.castleOf(G, p);
    return c ? c.flag : 0;
  }
  function networked(G, p, flagId, cf) {
    if (!flagId || !cf) return false;
    return flagId === cf || FSSim.hops(G, flagId, cf) >= 0;
  }
  function onNetwork(G, p, v) {
    return networked(G, p, G.map.flagAt[v], homeFlag(G, p));
  }

  /** Own flags with a free road slot, nearest first (bounded list). */
  function nearFlags(G, p, v, n) {
    const out = [], cf = homeFlag(G, p);
    for (const id in G.flags) {
      const f = G.flags[id];
      if (f.p !== p || f.roads.length >= 6) continue;
      if (!networked(G, p, f.id, cf)) continue;
      out.push([f, FSMap.dist(G.map, f.v, v)]);
    }
    out.sort((a, b) => (a[1] - b[1]) || (a[0].id - b[0].id));
    return out.slice(0, n || 3);
  }

  /**
   * Wire a new door flag into the network exactly the way a player does: one
   * legal road path, chopped into segments with a flag at every joint (the
   * long climbs up to a mountain mine are the reason the joints exist).
   */
  function connect(G, p, toV) {
    if (onNetwork(G, p, toV)) return true;
    // at most two hunts: a road A* is the single most expensive thing the
    // planner does, and the tick budget is 1.5 ms
    const cands = nearFlags(G, p, toV, 2);
    for (let c = 0; c < cands.length; c++) {
      const from = cands[c][0];
      const path = FSSim.roadPath(G, from.v, toV, p, { maxLen: FSC.AI_ROAD_MAX, maxNodes: FSC.AI_ROAD_NODES });
      if (!path || path.length < 2) continue;
      const STEP = FSC.AI_ROAD_SEG, LAST = path.length - 3;
      let cur = from, curIdx = 0, ok = true;
      const made = [];
      for (let i = STEP; i <= LAST; i += STEP) {
        let j = i;
        while (j <= LAST && FSMap.whyFlag(G.map, path[j], p)) j++;
        if (j > LAST) break;
        const nf = FSSim.placeFlag(G, path[j], p);
        if (!nf.ok) { ok = false; break; }
        made.push(nf.id);
        const r = FSSim.buildRoad(G, cur.id, nf.id, path.slice(curIdx, j + 1), p);
        if (!r.ok) { ok = false; break; }
        cur = nf.flag; curIdx = j; i = j;
      }
      if (ok) {
        let fid = G.map.flagAt[toV];
        if (!fid) {
          const nf = FSSim.placeFlag(G, toV, p);
          if (nf.ok) fid = nf.id;
        }
        if (fid && FSSim.buildRoad(G, cur.id, fid, path.slice(curIdx), p).ok) return true;
      }
      for (let i = made.length - 1; i >= 0; i--) FSSim.removeFlag(G, made[i]);   // tidy up
    }
    return false;
  }

  /* ===================================================================== */
  /* ===== what to build next ============================================= */
  /* ===================================================================== */

  /**
   * Does a geologist's sign promise this mineral anywhere in our land? Built
   * once per border generation — the wish list asks four or five times a run.
   * (Signs are all the AI may read; map.mineral is ground truth and off limits.)
   */
  const signCache = { G: null, gen: -1, byP: {} };
  function signFor(G, p, mineral) {
    if (signCache.G !== G || signCache.gen !== G.ownerGen) {
      signCache.G = G; signCache.gen = G.ownerGen; signCache.byP = {};
    }
    let m = signCache.byP[p];
    if (!m) {
      m = signCache.byP[p] = {};
      const land = ownLand(G, p), map = G.map;
      for (let i = 0; i < land.length; i++) {
        const code = map.sign[land[i]];
        if (!code || code === FSC.SIGN_EMPTY) continue;
        const k = FSSim.signMineral(code);
        if (m[k] === undefined) m[k] = land[i];
      }
    }
    return m[mineral] === undefined ? -1 : m[mineral];
  }

  /**
   * The opening book (plan §9): wood, then stone, then land, then food, then
   * geology + mines, then steel/tools, then weapons + gold, then more land.
   * Personality shifts how hungry the AI is for territory.
   * Returns a WISH LIST, best first — the planner walks down it, so one type it
   * cannot place (no room for a butcher) never blocks everything behind it.
   */
  function wishList(G, p, c, inv, st) {
    const per = persona(p);
    const land = Math.round(has(c, "hut") + has(c, "tower") * 1.5 + has(c, "fortress") * 2);
    const want = (n) => Math.round(n * per.expand);
    const w = [];
    const add = (t, cond) => { if (cond !== false && w.indexOf(t) < 0) w.push(t); };

    /**
     * CRAMPED START (plan §9). A guard hut is the only building that makes MORE
     * room, and on a rocky start the room runs out FAST — measured on one such
     * map the buildable plots fall from 15 to 1 inside the first sim-minute,
     * because every building sterilises the ring around it. So the trigger has
     * to fire while plots still exist, which means expansion outranks even the
     * opening woodcutter. To keep that from turning into pure hut-spam, it
     * alternates: right after a hut goes up the economy gets the next slot.
     * On a roomy start (plots in the dozens) none of this fires at all.
     */
    const tight = roomLeft(G, p) <= FSC.AI_ROOM_LOW && st && st.lastBuild !== "hut";
    if (tight) add("hut");

    // the first three are the settlement itself — without planks and stone
    // nothing else can ever be built
    if (has(c, "lumberjack") < 1) add("lumberjack");
    if (has(c, "sawmill") < 1) add("sawmill");
    if (has(c, "stonecutter") < 1) add("stonecutter");
    if (has(c, "forester") < 1) add("forester");
    if (land < want(2)) add("hut");
    if (has(c, "lumberjack") < 2) add("lumberjack");
    if (has(c, "fisher") + has(c, "farm") < 1) add("fisher");
    if (has(c, "farm") < 1) add("farm");
    if (land < want(4)) add("hut");
    if (has(c, "farm") >= 1 && has(c, "mill") < 1) add("mill");
    if (has(c, "mill") >= 1 && has(c, "bakery") < 1) add("bakery");
    if (has(c, "coalMine") < 1 && signFor(G, p, FSC.MINERAL.COAL) >= 0) add("coalMine");
    if (has(c, "ironMine") < 1 && signFor(G, p, FSC.MINERAL.IRON) >= 0) add("ironMine");
    if (has(c, "smelter") < 1 && has(c, "coalMine") && has(c, "ironMine")) add("smelter");
    if (has(c, "toolmaker") < 1 && has(c, "smelter")) add("toolmaker");
    if (land < want(6)) add("hut");
    if (has(c, "stoneMine") < 1 && (inv.stone | 0) < 12 && signFor(G, p, FSC.MINERAL.STONE) >= 0) add("stoneMine");
    if (has(c, "weaponsmith") < 1 && has(c, "smelter")) add("weaponsmith");
    if (has(c, "goldMine") < 1 && signFor(G, p, FSC.MINERAL.GOLD) >= 0) add("goldMine");
    if (has(c, "goldsmelter") < 1 && has(c, "goldMine")) add("goldsmelter");
    if (has(c, "pigfarm") < 1 && has(c, "farm") >= 1) add("pigfarm");
    if (has(c, "butcher") < 1 && has(c, "pigfarm")) add("butcher");
    if (has(c, "lumberjack") < 3) add("lumberjack");
    if (has(c, "farm") < 2) add("farm");
    if (has(c, "forester") < 2) add("forester");
    if (has(c, "tower") < 1 && (inv.plank | 0) >= 4 && (inv.stone | 0) >= 5) add("tower");
    if (has(c, "stock") < 1 && c._all >= 14) add("stock");
    add("hut");                        // there is always more land to hold
    return w;
  }

  /** Can we pay for it out of stores? (a site with no hope of materials stalls) */
  function affordable(G, p, type, inv) {
    const cost = FSC.BLD[type].cost || {};
    return (inv.plank | 0) >= (cost.plank || 0) && (inv.stone | 0) >= (cost.stone || 0);
  }

  /* ===================================================================== */
  /* ===== picking the spot =============================================== */
  /* ===================================================================== */

  function countIn(map, v, r, test) {
    let n = 0;
    FSMap.forRadius(map, v, r, (u, d) => { if (test(u, d)) n++; });
    return n;
  }

  /**
   * Two-stage hunt: a cheap sweep over our own land collects a handful of legal
   * spots, then only those get the expensive "is there anything to work here?"
   * scan. Bounded by FSC.AI_SCAN_CAP either way.
   */
  function pickSite(G, p, type, st) {
    const map = G.map, land = ownLand(G, p);
    if (!land.length) return -1;
    const def = FSC.BLD[type];
    const castle = FSSim.castleOf(G, p);
    const home = castle ? castle.v : land[0];
    const rival = rivalField(G, p);
    const mineral = def.mine ? FSC.MINERAL[def.mine] : 0;

    // ---- stage 1: legal, un-blacklisted, plausible ----
    // BOTH the cheap sweep and the (much dearer) canPlaceBuilding calls are
    // capped, so a huge kingdom costs the planner no more than a small one.
    const legal = [];
    const stride = Math.max(1, Math.floor(land.length / FSC.AI_SCAN_CAP));
    let checks = 0;
    for (let i = 0; i < land.length; i += stride) {
      const v = land[i];
      if ((st.black[v] || 0) > G.tick) continue;
      if (map.bldAt[v] || map.flagAt[v]) continue;
      if (def.mountain) {
        if (map.terr[v] !== T.MOUNTAIN) continue;
        // only dig where a geologist actually found something
        const code = map.sign[v];
        if (!code || code === FSC.SIGN_EMPTY || FSSim.signMineral(code) !== mineral) continue;
      } else if (map.terr[v] !== T.GRASS) continue;
      if (FSMap.objBlocks(map.obj[v])) continue;
      // military sites keep well clear of rival buildings (see the file header)
      if (def.mil && rival[v] !== 255 && rival[v] <= FSC.TERR_RADIUS) continue;
      if (++checks > FSC.AI_PLACE_CHECKS) break;
      if (!FSMap.canPlaceBuilding(map, type, v, p)) continue;
      legal.push(v);
      if (legal.length >= FSC.AI_SHORTLIST) break;
    }
    if (!legal.length) return -1;

    // ---- stage 2: score the shortlist ----
    let best = -1, bestScore = -1e9;
    for (let i = 0; i < legal.length; i++) {
      const v = legal[i];
      const dHome = FSMap.dist(map, v, home);
      let score = -dHome * 0.6;                       // stay compact: roads cost time
      const R = def.radius || 5;
      if (def.job === FSC.JOB.LUMBERJACK) {
        score += countIn(map, v, R, (u) => FSMap.isTree(map.obj[u])) * 3;
      } else if (def.job === FSC.JOB.FORESTER) {
        score += countIn(map, v, R, (u) => map.terr[u] === T.GRASS && map.obj[u] === O.NONE) * 1.2;
      } else if (def.job === FSC.JOB.STONECUTTER) {
        score += countIn(map, v, R, (u) => FSMap.isStone(map.obj[u])) * 6;
      } else if (def.job === FSC.JOB.FISHER) {
        score += countIn(map, v, R, (u) => map.terr[u] === T.WATER && map.fish[u] > FSC.FISH_MIN_STOCK) * 3;
      } else if (def.job === FSC.JOB.FARMER) {
        score += countIn(map, v, FSC.FIELD_RING[1], (u, d) => d >= FSC.FIELD_RING[0]
          && map.terr[u] === T.GRASS && map.obj[u] === O.NONE) * 2;
      } else if (def.mil) {
        // A guard hut is worth the new ground it takes — but BUILDABLE ground is
        // what actually keeps a settlement growing. Claiming forty vertices of
        // cliff and lake looks like expansion on the minimap and leaves the AI
        // with nowhere to put its next woodcutter, so open grass counts for
        // several times its area.
        let gained = 0, useful = 0;
        FSMap.forRadius(map, v, FSC.TERR_RADIUS - 1, (u) => {
          if (map.owner[u] >= 0) return;
          gained++;
          if (map.terr[u] === T.GRASS && !FSMap.objBlocks(map.obj[u])) useful++;
        });
        score += gained * 0.5 + useful * 2.5;
        // …and it must not crowd the buildings we already hold
        let crowd = 0;
        FSMap.forRadius(map, v, 5, (u) => { const b = G.buildings[map.bldAt[u]]; if (b && b.mil && b.p === p) crowd++; });
        score -= crowd * 40;
        score += dHome * 0.6;                        // push OUT, not in
        if (gained < 6) score -= 60;
      } else if (def.mine) {
        score += (FSSim.signDensity(map.sign[v]) ? 20 : 0);
      }
      if (score > bestScore) { bestScore = score; best = v; }
    }
    return bestScore > -500 ? best : -1;
  }

  /* ===================================================================== */
  /* ===== geology ======================================================== */
  /* ===================================================================== */
  /**
   * Mines need SIGNS, signs need a geologist, and a geologist needs a flag on a
   * mountain — which needs a road up there. That chain is the whole reason the
   * AI bothers with mountains at all.
   */
  function prospect(G, p, st) {
    const map = G.map, land = ownLand(G, p);
    /** how much unexplored rock a geologist could sample from here */
    function rock(v) {
      let m = 0;
      FSMap.forRadius(map, v, FSC.GEO_RING[1], (u, d) => {
        if (d < FSC.GEO_RING[0] || map.terr[u] !== T.MOUNTAIN) return;
        if (map.sign[u] || map.flagAt[u] || map.bldAt[u]) return;
        m++;
      });
      return m;
    }
    // 1. is there already a mountain flag with unexplored rock around it?
    for (const id in G.flags) {
      const f = G.flags[id];
      if (f.p !== p || map.terr[f.v] !== T.MOUNTAIN) continue;
      if (!networked(G, p, f.id, homeFlag(G, p))) continue;
      if (rock(f.v) < 4) continue;                  // nothing left to hammer here
      const r = FSSim.sendGeologist(G, f.id, p);
      if (r.ok) { st.geoT = G.tick + FSC.GEO_T * 6; return true; }
    }
    // 2. otherwise put a flag on the richest reachable seam and road to it
    // (the rock() scan is the dearest thing here — hard-capped per run)
    let best = -1, bestScore = -1e9, weighed = 0;
    const castle = FSSim.castleOf(G, p);
    const home = castle ? castle.v : land[0];
    const stride = Math.max(1, Math.floor(land.length / FSC.AI_SCAN_CAP));
    for (let i = 0; i < land.length; i += stride) {
      const v = land[i];
      if (map.terr[v] !== T.MOUNTAIN) continue;
      if ((st.black[v] || 0) > G.tick) continue;
      if (FSMap.whyFlag(map, v, p)) continue;
      if (++weighed > FSC.AI_ROCK_CHECKS) break;
      const score = rock(v) * 2 - FSMap.dist(map, v, home);
      if (score > bestScore) { bestScore = score; best = v; }
    }
    if (best < 0 || bestScore < -30) return false;
    const fl = FSSim.placeFlag(G, best, p);
    if (!fl.ok) { st.black[best] = G.tick + FSC.AI_BLACKLIST_T; return false; }
    if (!connect(G, p, best)) {
      FSSim.removeFlag(G, fl.id);
      st.black[best] = G.tick + FSC.AI_BLACKLIST_T;
      return false;
    }
    FSSim.sendGeologist(G, fl.id, p);
    st.geoT = G.tick + FSC.GEO_T * 6;
    return true;
  }

  /* ===================================================================== */
  /* ===== watchdog ======================================================= */
  /* ===================================================================== */
  /**
   * A site that has taken no material for AI_STUCK_T ticks is SUSPECT — but only
   * a site the carriers can never reach is actually a dead end.
   *
   * This distinction matters more than it looks. A young settlement has two or
   * three transporters and long roads, so a second-priority site can easily wait
   * thousands of ticks for its second plank while the sawmill ahead of it eats
   * every delivery. Scrapping that site is exactly the wrong move: it throws
   * away the materials already in the walls AND blacklists the ground, and on a
   * cramped start (where the buildable spots number in the teens) that ground
   * may be the only spot left — which is how one misfiring watchdog can freeze
   * an AI for the rest of the game. So: cut off → scrap; merely queued → wait.
   */
  function watchdog(G, p, st) {
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p || b.state === "done" || b.state === "burn") continue;
      const got = (b.matGot.plank || 0) + (b.matGot.stone || 0)
        + (b.matInFlight.plank || 0) + (b.matInFlight.stone || 0) + (b.swings || 0);
      const w = st.watch[b.id];
      if (!w || w.mat !== got) { st.watch[b.id] = { mat: got, t: G.tick }; continue; }
      if (G.tick - w.t < FSC.AI_STUCK_T) continue;
      const f = G.flags[b.flag];
      if (f && networked(G, p, f.id, homeFlag(G, p))) {
        w.t = G.tick;                    // still on the network — just be patient
        continue;
      }
      event(G, "aiScrapSite", { p, id: b.id, btype: b.type, v: b.v });
      st.black[b.v] = G.tick + FSC.AI_BLACKLIST_T;
      delete st.watch[b.id];
      FSSim.demolishBuilding(G, b.id);
      return true;
    }
    // forget the watch entries of buildings that finished or died…
    for (const k in st.watch) {
      const b = G.buildings[k];
      if (!b || b.state === "done" || b.state === "burn") delete st.watch[k];
    }
    // …and let expired blacklist entries go, so a long game's save stays small
    for (const k in st.black) if (st.black[k] <= G.tick) delete st.black[k];
    return false;
  }

  /* ===================================================================== */
  /* ===== war ============================================================ */
  /* ===================================================================== */
  /**
   * Attack the WEAKEST reachable enemy-team military building once the local
   * odds clear FSC.AI_AGGRO (scaled by personality), and commit about
   * FSC.AI_ATTACK_SHARE of the spare garrison. The minimum garrison always
   * stays home — an AI never hands its own land away to go raiding.
   */
  function warThink(G, p, st) {
    if (st.attackT > G.tick) return false;
    st.attackT = G.tick + FSC.AI_ATTACK_T;
    const targets = FSMil.attackTargets(G, p);
    if (!targets.length) return false;
    const per = persona(p);
    const need = FSC.AI_AGGRO / per.aggro;
    let best = null, bestScore = -1e9;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const ratio = t.max / Math.max(1, t.garrison);
      if (ratio < need) continue;
      const tb = G.buildings[t.id];
      let power = 0;
      for (let k = 0; k < tb.mil.knights.length; k++) power += FSC.KNIGHT_EXP[tb.mil.knights[k]] || 1;
      const score = ratio * 10 - power - (t.type === "castle" ? 0 : 2);
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (!best) return false;
    let n = Math.ceil(best.max * FSC.AI_ATTACK_SHARE);
    if (n < best.garrison + 1) n = Math.min(best.max, best.garrison + 1);
    const r = FSMil.attack(G, best.id, n, p, true);
    if (r.ok) event(G, "aiAttack", { p, target: best.id, n: r.sent, of: best.p });
    return r.ok;
  }

  /* ===================================================================== */
  /* ===== one planner run ================================================ */
  /* ===================================================================== */
  function plan(G, p) {
    const st = brain(G, p);
    st.runs++;
    if (watchdog(G, p, st)) return "scrap";
    if (warThink(G, p, st)) return "attack";

    const c = countTypes(G, p);
    if (c._sites >= FSC.AI_MAX_SITES) return "busy";
    const inv = FSSim.invOf(G, p);

    // a geologist now and then, so the mountains stop being blank
    if (st.geoT <= G.tick && c._all >= 4 && (st.runs % 8) === 0) {
      st.geoT = G.tick + FSC.GEO_T * 4;
      if (prospect(G, p, st)) return "prospect";
    }

    // Walk the wish list until something sticks. The budget has to be generous:
    // on a cramped map the first few wants can be unplaceable for a long stretch,
    // and a short budget means the planner never even LOOKS at the food and mine
    // entries further down (measured: with 4 tries the fisher was never reached
    // in 30 sim-minutes). A hunt is ~0.1 ms; the one road A* per run dominates.
    const wish = wishList(G, p, c, inv, st);
    let tried = 0;
    for (let i = 0; i < wish.length && tried < FSC.AI_TRIES; i++) {
      const type = wish[i];
      if (!affordable(G, p, type, inv)) { st.lastFail = "poor:" + type; continue; }
      tried++;
      const v = pickSite(G, p, type, st);
      if (v < 0) { st.lastFail = "nosite:" + type; continue; }
      const r = FSSim.build(G, type, v, p);
      if (!r.ok) { st.black[v] = G.tick + FSC.AI_BLACKLIST_T; st.lastFail = "build:" + r.why; continue; }
      const b = G.buildings[r.id];
      const doorV = G.flags[b.flag] ? G.flags[b.flag].v : -1;
      if (doorV < 0 || !connect(G, p, doorV)) {
        FSSim.demolishBuilding(G, b.id);
        st.black[v] = G.tick + FSC.AI_BLACKLIST_T;
        st.lastFail = "noroad:" + type;
        return "noroad";           // one road hunt per run — see FSC.AI_PERIOD
      }
      st.lastFail = "";
      st.lastBuild = type;            // drives the cramped-start alternation
      event(G, "aiBuild", { p, id: b.id, btype: type, v });
      return type;
    }
    // BOXED IN: nothing on the wish list fits anywhere. Before idling away
    // another AI_PERIOD, take back the oldest thing we wrote off — on a cramped
    // map the blacklist itself becomes the wall, and a spot that failed once
    // (no road THEN) is often buildable now that the network has grown.
    // a run that placed nothing also clears the alternation latch, so a settlement
    // that can ONLY expand still expands (and one that can do both still trades
    // off) — without this the latch could stick and deadlock a cramped AI
    st.lastBuild = "";
    let oldest = -1, oldestT = Infinity;
    for (const k in st.black) if (st.black[k] < oldestT) { oldestT = st.black[k]; oldest = k; }
    if (oldest >= 0) { delete st.black[oldest]; return "forgive"; }
    return "idle";
  }
  FSAI.plan = plan;

  /* ===================================================================== */
  /* ===== the tick ======================================================= */
  /* ===================================================================== */
  FSAI.tick = function (G) {
    if (G.aiPlan === false) return G;      // suites can park the opponents
    for (let p = 0; p < G.players.length; p++) {
      const pl = G.players[p];
      if (!pl.isAI || pl.eliminated) continue;
      // staggered so two AIs never plan on the same tick
      if (((G.tick + p * 13) % FSC.AI_PERIOD) !== 0) continue;
      plan(G, p);
    }
    return G;
  };

  /** Debug / suite view of one opponent's head. */
  FSAI.state = function (G, p) {
    const st = brain(G, p);
    const c = countTypes(G, p);
    return { runs: st.runs, lastFail: st.lastFail, sites: c._sites, mil: c._mil,
      buildings: c._all, blacklisted: Object.keys(st.black).length, attackT: st.attackT };
  };

  if (typeof window !== "undefined") window.FSAI = FSAI;
  if (FSSim._bindMilitary) FSSim._bindMilitary(null, FSAI);
  if (typeof module !== "undefined" && module.exports) module.exports = FSAI;
})();
