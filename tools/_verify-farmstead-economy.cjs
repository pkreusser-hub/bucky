#!/usr/bin/env node
"use strict";
/**
 * FARMSTEAD — Phase C economy suite.
 * Every production chain end to end, the living world (background sweep), mines +
 * geology, tools/weapons/gold, water roads and boats, distribution arbitration,
 * warehouse In/Stop/Out modes, halt, determinism and the new render work.
 *
 * ASSERTIONS ARE DATA DRIVEN: recipes, cycle lengths, radii, caps and pacing are
 * read out of FSC at run time (FSC.BLD[t].in/out/outN/cycleT/radius, FSC.IN_CAP,
 * FSC.WALK_TICKS_TABLE, FSC.SWEEP_*, FSC.FIELD_*, FSC.PIG_*, FSC.GEO_*, …), so a
 * later balance pass over fs-const.js cannot silently break — or silently pass —
 * this suite.
 *
 *   node tools/_verify-farmstead-economy.cjs
 */
const H = require("./_fs_harness.cjs");

/* Helpers injected once; every later evaluate() reuses window.T. */
const HELPERS = function () {
  const FS = window.__FS__;
  const T = {};
  window.T = T;
  const FSC = FS.FSC, FSMap = FS.FSMap, FSSim = FS.FSSim;

  /** The suite's world: a medium map whose start has mountains, a fishable coast
   *  and room to build. Individual tests may ask for another seed (the ferry test
   *  wants a bay it can bridge). */
  T.fresh = function (o) {
    // PHASE-D note: the AI player is kept for map generation (start-site fairness
    // depends on the player count) but its PLANNER is parked — this is an ECONOMY
    // suite, and on this seed the rival castle happens to sit 8-9 steps away, so a
    // live opponent would turn every test below into a war. Same precedent as the
    // REPRO_DEFAULT = -1 stub above. The AI is exercised in the military suite.
    FS.newGame(Object.assign({ size: "medium", seed: 12345, ais: 1, speed: 0, aiPlan: false }, o || {}));
    T.reach = null;
    return FS.G;
  };
  T.castle = function () { return FSSim.castleOf(FS.G, 0); };
  T.cflag = function () { return FS.G.flags[T.castle().flag]; };
  T.map = function () { return FS.G.map; };

  /** every vertex a road could legally reach from the castle flag */
  T.roadReach = function () {
    if (T.reach) return T.reach;
    const G = FS.G, map = G.map, N = map.W * map.H;
    const seen = new Uint8Array(N), start = T.cflag().v;
    seen[start] = 1;
    const q = [start];
    while (q.length) {
      const v = q.pop();
      for (let d = 0; d < 6; d++) {
        const u = FSMap.nbr(map, v, d);
        if (u < 0 || seen[u]) continue;
        if (FSMap.whyRoadStep(map, v, u, 0, { endB: true })) continue;
        seen[u] = 1; q.push(u);
      }
    }
    T.reach = seen;
    return seen;
  };

  /** the own NETWORKED flag with road capacity nearest to v */
  T.nearestFlag = function (v, skip) {
    const G = FS.G, cf = T.castle().flag;
    let best = null, bestD = 1e9;
    for (const id in G.flags) {
      const f = G.flags[id];
      if (f.p !== 0 || f.roads.length >= 6 || f.id === skip) continue;
      if (f.id !== cf && FSSim.hops(G, f.id, cf) < 0) continue;
      const d = FSMap.dist(G.map, f.v, v);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  };
  T.onNetwork = function (v) {
    const fid = FS.G.map.flagAt[v];
    if (!fid) return false;
    const cf = T.castle().flag;
    return fid === cf || FSSim.hops(FS.G, fid, cf) >= 0;
  };

  /** Join a vertex to the network: one long legal road path, chopped into
   *  road-sized segments with a flag at each joint (what a player does). */
  T.connect = function (toV, opts) {
    opts = opts || {};
    const G = FS.G;
    if (T.onNetwork(toV)) return true;
    const cf = T.castle().flag;
    // every networked flag with room, nearest first — the first one the ground
    // allows a legal road from wins
    const cands = [];
    for (const id in G.flags) {
      const f = G.flags[id];
      if (f.p !== 0 || f.roads.length >= 6) continue;
      if (f.v === toV) continue;
      if (f.id !== cf && FSSim.hops(G, f.id, cf) < 0) continue;
      cands.push([f, FSMap.dist(G.map, f.v, toV)]);
    }
    cands.sort((a, b) => (a[1] - b[1]) || (a[0].id - b[0].id));
    for (let c = 0; c < cands.length && c < 8; c++) {
      const from = cands[c][0];
      const path = FSSim.roadPath(G, from.v, toV, 0,
        { maxLen: opts.maxLen || 400, maxNodes: 60000, water: opts.water });
      if (!path) continue;
      const STEP = 8, LAST = path.length - 3;   // a joint may never sit next to the target
      let cur = from, curIdx = 0, ok = true;
      for (let i = STEP; i <= LAST; i += STEP) {
        let j = i;
        while (j <= LAST && FSMap.whyFlag(G.map, path[j], 0)) j++;
        if (j > LAST) break;
        const nf = FSSim.placeFlag(G, path[j], 0);
        if (!nf.ok) { ok = false; break; }
        const r = FSSim.buildRoad(G, cur.id, nf.id, path.slice(curIdx, j + 1), 0, { water: opts.water });
        if (!r.ok) { FSSim.removeFlag(G, nf.id); ok = false; break; }
        cur = nf.flag; curIdx = j; i = j;
      }
      if (!ok) continue;
      let fid = G.map.flagAt[toV];
      if (!fid) {
        const nf = FSSim.placeFlag(G, toV, 0);
        if (!nf.ok) continue;
        fid = nf.id;
      }
      if (FSSim.buildRoad(G, cur.id, fid, path.slice(curIdx), 0, { water: opts.water }).ok) return true;
    }
    return false;
  };

  /**
   * Push the border out the way a player does: a ring of guard huts. A finished
   * military building claims its radius, so the settlement gets room to grow.
   */
  T.expand = function (n) {
    const G = FS.G, map = G.map;
    let made = 0;
    for (let i = 0; i < n; i++) {
      let best = -1, bestD = -1;
      FSMap.forRadius(map, T.castle().v, 20, (u, d) => {
        if (d < 7 || !FSMap.canPlaceBuilding(map, "hut", u, 0)) return;
        if (d > bestD) { bestD = d; best = u; }        // as far out as the border allows
      });
      if (best < 0) break;
      const r = FSSim.build(G, "hut", best, 0);
      if (!r.ok) break;
      const b = G.buildings[r.id];
      if (!T.connect(G.flags[b.flag].v)) { FSSim.demolishBuilding(G, b.id); continue; }
      FSSim.forceComplete(G, b.id);                     // claims its land at once
      made++;
    }
    T.reach = null;
    return made;
  };

  T.pickSite = function (type, minD, maxD, used, near, sep) {
    const G = FS.G, center = near === undefined ? T.castle().v : near;
    let best = -1, bestD = 1e9;
    FSMap.forRadius(G.map, center, maxD || 12, (u, d) => {
      if (d < (minD || 3)) return;
      if (used && used.some((w) => FSMap.dist(G.map, w, u) < (sep || 3))) return;
      if (!FSMap.canPlaceBuilding(G.map, type, u, 0)) return;
      if (d < bestD) { best = u; bestD = d; }
    });
    return best;
  };

  /**
   * Place a whole quarter at once. Sites go down FIRST and the roads are laid
   * afterwards — once a network's flags are in, free door vertices get scarce
   * (the same lesson the transport suite learned).
   */
  T.addMany = function (types, opts) {
    opts = opts || {};
    const G = FS.G, used = opts.used || [], out = { _list: [], _missed: [] };
    const sites = [];
    for (let i = 0; i < types.length; i++) {
      const type = types[i];
      const v = T.pickSite(type, opts.minD || 3, opts.maxD || 16, used, opts.near, opts.sep || 3);
      if (v < 0) { out._missed.push(type); continue; }
      const r = FSSim.build(G, type, v, 0);
      if (!r.ok) { out._missed.push(type); continue; }
      used.push(v);
      sites.push(G.buildings[r.id]);
    }
    // Wire them up. A site the ground will not let us reach is abandoned and
    // rebuilt somewhere else — exactly the choice a player makes.
    for (let i = 0; i < sites.length; i++) {
      let b = sites[i];
      const type = b.type;
      for (let tries = 0; b && !T.connect(G.flags[b.flag].v); tries++) {
        FSSim.demolishBuilding(G, b.id);
        b = null;
        if (tries >= 3) break;
        const v2 = T.pickSite(type, opts.minD || 3, opts.maxD || 16, used, opts.near, opts.sep || 3);
        if (v2 < 0) break;
        const r2 = FSSim.build(G, type, v2, 0);
        if (!r2.ok) break;
        used.push(v2);
        b = G.buildings[r2.id];
      }
      if (!b) { out._missed.push(type); continue; }
      if (opts.finish !== false) FSSim.forceComplete(G, b.id);
      out._list.push(b);
      if (!out[b.type]) out[b.type] = b;
    }
    return out;
  };

  /** build + road-connect; `finish` (default) completes the site instantly so the
   *  production tests do not re-run Phase B's construction every time. */
  T.add = function (type, opts) {
    opts = opts || {};
    const G = FS.G;
    const v = opts.v !== undefined ? opts.v : T.pickSite(type, opts.minD, opts.maxD, opts.used, opts.near);
    if (v < 0) return null;
    const r = FSSim.build(G, type, v, 0);
    if (!r.ok) return null;
    const b = G.buildings[r.id];
    if (!T.connect(G.flags[b.flag].v)) { FSSim.demolishBuilding(G, b.id); return null; }
    if (opts.finish !== false) FSSim.forceComplete(G, b.id);
    if (opts.used) opts.used.push(v);
    return b;
  };

  /** stock a building's inputs directly (skips the supply line for focused tests) */
  T.feed = function (b, res, n) { b.stockIn[res] = (b.stockIn[res] || 0) + n; return b; };
  /** take a resource out of the whole settlement (stores, flags, hands) */
  T.drain = function (res) {
    const G = FS.G;
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.inv) b.inv[res] = 0;
      if (b.stockIn) b.stockIn[res] = 0;
      if (b.stockOut && b.stockOut[res]) { b.outHeld -= b.stockOut[res]; b.stockOut[res] = 0; }
      if (b.reqInFlight) b.reqInFlight[res] = 0;
    }
    for (const id in G.flags) {
      const f = G.flags[id];
      for (let i = f.slots.length - 1; i >= 0; i--) if (f.slots[i].res === res) f.slots.splice(i, 1);
    }
    for (const id in G.serfs) {
      const s2 = G.serfs[id];
      if (s2.carry === res) { s2.carry = 0; s2.carryDest = 0; s2.carryFlag = 0; }
    }
  };
  /** goods of `res` handed into this building since the game started */
  T.deliveredTo = function (b, res) {
    return FS.G.events.filter((e) => e.type === "itemDeliver" && e.bld === b.id && e.res === res).length;
  };

  /** count map objects of a kind inside a radius */
  T.countObj = function (v, r, test) {
    const map = FS.G.map;
    let n = 0;
    FSMap.forRadius(map, v, r, (u) => { if (test(map.obj[u], u)) n++; });
    return n;
  };
  T.prod = function () { return FSSim.production(FS.G, 0); };
  T.inv = function () { return FSSim.invOf(FS.G, 0); };
  T.ev = function (type) { return FS.G.events.filter((e) => e.type === type); };
  /** one full pass of the background sweep, in ticks */
  T.sweepPass = function () {
    const N = FS.G.map.W * FS.G.map.H;
    return Math.ceil(N / Math.ceil(N / 1024)) * FSC.SWEEP_EVERY;
  };
  /** how long one worker round trip can take, from the constants */
  T.tripTicks = function (type) {
    const def = FSC.BLD[type];
    const edge = FSC.WALK_TICKS_TABLE[FSC.WALK_TICKS_TABLE.length - 1];
    const work = Math.max(FSC.CHOP_T, FSC.HACK_T, FSC.REAP_T, FSC.FISH_CHECKS * FSC.FISH_WAIT_T);
    return (def.radius || 4) * edge * 2 + work + (def.cycleT || 0);
  };
  /** put a deposit in the ground (used where the seed has no coal in reach) */
  T.seedOre = function (v, kind, amt, r) {
    const map = FS.G.map;
    FSMap.forRadius(map, v, r === undefined ? 1 : r, (u, d) => {
      if (map.terr[u] !== FSC.TERR.MOUNTAIN) return;
      map.mineral[u] = FSC.MINERAL[kind];
      map.mineralAmt[u] = Math.max(0, amt - d * 4);
    });
  };
  T.clearOre = function (v, r) {
    const map = FS.G.map;
    FSMap.forRadius(map, v, r, (u) => { map.mineral[u] = 0; map.mineralAmt[u] = 0; });
  };
  return true;
};

H.run("farmstead-economy", async (t) => {
  const page = await t.newPage({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(t.BASE + "/farmstead.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 20000 });
  await page.click("#startBtn");
  await page.waitForFunction(() => window.__FS__.started(), { timeout: 20000 });
  await page.evaluate(HELPERS);
  // one snapshot of the tunables — every label and threshold below reads from it
  const K = await page.evaluate(() => {
    const C = window.__FS__.FSC;
    return { BLD: C.BLD, IN_CAP: C.IN_CAP, PIG_KEEP: C.PIG_KEEP, PIG_HERD_MAX: C.PIG_HERD_MAX,
      GEO_SPOTS: C.GEO_SPOTS, GEO_BIG_AMT: C.GEO_BIG_AMT, MINE_DIGS: C.MINE_DIGS,
      FISH_MIN_STOCK: C.FISH_MIN_STOCK, FIELD_RING: C.FIELD_RING, PRIO_MAX: C.PRIO_MAX,
      PRIO_STEP: C.PRIO_STEP, SIGN_EMPTY: C.SIGN_EMPTY, TOOLS: C.TOOLS, FOODS: C.FOODS };
  });

  // ════════════════════════════════ determinism rules still hold (new sim code)
  const src = await page.evaluate(async (base) => {
    const files = ["fs-const.js", "fs-map.js", "fs-sim.js"];
    const out = {};
    for (const f of files) {
      const raw = await (await fetch(base + "/assets/farmstead/" + f)).text();
      const txt = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
      out[f] = {
        trans: (txt.match(/Math\s*\.\s*(sin|cos|tan|pow|exp|log)\s*\(/g) || []),
        rnd: (txt.match(/Math\s*\.\s*random|Date\s*\.\s*now/g) || []),
        dom: (txt.match(/document\s*\.|window\s*\.\s*(location|document)|THREE\s*\./g) || []),
      };
    }
    return out;
  }, t.BASE);
  const bad = Object.keys(src).flatMap((f) => src[f].trans.concat(src[f].rnd).map((m) => f + ":" + m));
  t.check("Phase-C sim code stays deterministic (no transcendentals/random/clock)", bad.length === 0, bad);
  t.check("sim modules still touch no THREE and no DOM",
    Object.keys(src).every((f) => src[f].dom.length === 0), src);

  // ════════════════════════════════ the living world (background sweep)
  const sweep = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC, O = FSC.OBJ;
    T.fresh();
    const G = FS.G, map = G.map;
    // pick free grass vertices and plant test objects on them
    const spots = [];
    FS.FSMap.forRadius(map, T.castle().v, 9, (u, d) => {
      if (spots.length >= 40 || d < 2) return;
      if (map.terr[u] !== FSC.TERR.GRASS || map.obj[u] !== O.NONE) return;
      spots.push(u);
    });
    const sap = spots.slice(0, 12), fld = spots.slice(12, 20), stump = spots.slice(20, 28);
    sap.forEach((v) => (map.obj[v] = O.SAPLING));
    fld.forEach((v) => (map.obj[v] = O.FIELD0));
    stump.forEach((v) => (map.obj[v] = O.STUMP));
    // a fished-out water vertex
    let wet = -1;
    FS.FSMap.forRadius(map, T.castle().v, 14, (u) => { if (wet < 0 && map.terr[u] === FSC.TERR.WATER) wet = u; });
    if (wet >= 0) map.fish[wet] = 0;
    const pass = T.sweepPass();
    // the cursor walk itself: a prime stride must land on every vertex exactly once
    const N = map.W * map.H;
    const walk = new Set();
    let cur = G.sweepV;
    for (let i = 0; i < N; i++) { cur = (cur + FSC.SWEEP_STRIDE) % N; walk.add(cur); }
    const before = G.sweepV;
    const fieldsBefore = fld.map((v) => map.obj[v]);
    FS.ff(pass);
    const fieldsAfter1 = fld.map((v) => map.obj[v]);
    FS.ff(pass * 3);
    const grown = sap.filter((v) => map.obj[v] !== O.SAPLING).length;
    const rotted = stump.filter((v) => map.obj[v] === O.NONE).length;
    const fieldsAfter4 = fld.map((v) => map.obj[v]);
    FS.ff(pass * 8);
    return {
      pass, walk: walk.size, mapN: map.W * map.H, before, fieldsBefore,
      grown, sapN: sap.length, rotted, stumpN: stump.length,
      fieldsAfter1, fieldsAfter4, fieldsLate: fld.map((v) => map.obj[v]),
      fish: wet >= 0 ? map.fish[wet] : -1, cap: FSC.FISH_CAP, wet,
      overCap: (() => { let n = 0; for (let v = 0; v < map.W * map.H; v++) if (map.fish[v] > FSC.FISH_CAP) n++; return n; })(),
      SAPLING_P: FSC.SAPLING_P,
    };
  });
  t.check("the sweep's stride lands on every vertex exactly once per pass", sweep.walk === sweep.mapN, sweep);
  t.check("young trees mature over sweep visits", sweep.grown > 0 && sweep.grown <= sweep.sapN, sweep);
  t.check("stumps rot away", sweep.rotted > 0, sweep);
  t.check("one pass ripens every sown field by exactly one stage",
    sweep.fieldsAfter1.length > 0 && sweep.fieldsAfter1.every((o, i) => o === sweep.fieldsBefore[i] + 1), sweep);
  t.check("fields keep ripening on later passes",
    sweep.fieldsAfter4.every((o, i) => o > sweep.fieldsAfter1[i]), sweep);
  t.check("fields finish as stubble and then clear", sweep.fieldsLate.some((o) => o === 0 || o === 16), sweep);
  t.check("a fished-out shoal restocks (and never past FSC.FISH_CAP)",
    sweep.fish > 0 && sweep.fish <= sweep.cap && sweep.overCap === 0, sweep);

  // ════════════════════════════════ wood: lumberjack → sawmill, forester
  const wood = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC, O = FSC.OBJ;
    T.fresh();
    const G = FS.G, map = G.map;
    const q = T.addMany(["lumberjack", "sawmill", "forester"], { minD: 3, maxD: 16 });
    const lj = q.lumberjack, saw = q.sawmill, fo = q.forester;
    if (!lj || !saw || !fo) return { built: false, missed: q._missed };
    const trees0 = T.countObj(lj.v, FSC.BLD.lumberjack.radius, (o) => o === O.TREE4);
    const sap0 = fo ? T.countObj(fo.v, FSC.BLD.forester.radius, (o) => o === O.SAPLING) : 0;
    const WIN = T.tripTicks("lumberjack") * 12;
    let seenOffsite = "";
    for (let i = 0; i < WIN; i += 25) {
      FS.ff(25);
      if (!seenOffsite) {
        const w = FS.FSSim.serfsOf(G, 0).find((s) => s.job === "lumberjack" && s.state !== "work" && s.state !== "goBld" && s.state !== "enter");
        if (w) seenOffsite = w.state;
      }
    }
    const felled = T.ev("treeFelled");
    const prod = T.prod();
    return {
      built: true, window: WIN,
      trees0, trees1: T.countObj(lj.v, FSC.BLD.lumberjack.radius, (o) => o === O.TREE4),
      felled: felled.length,
      stumpAtFelled: felled.length ? (map.obj[felled[felled.length - 1].v] === O.STUMP || map.obj[felled[felled.length - 1].v] === O.NONE) : false,
      lumber: prod.lumber || 0, plank: prod.plank || 0,
      sawIn: saw.stockIn.lumber || 0, sawCycles: saw.cycles,
      recipe: FSC.BLD.sawmill.in, out: FSC.BLD.sawmill.out,
      sap0, sap1: fo ? T.countObj(fo.v, FSC.BLD.forester.radius, (o) => o === O.SAPLING) : 0,
      planted: T.ev("saplingPlanted").length,
      seenOffsite, invLumber: T.inv().lumber, invPlank: T.inv().plank,
    };
  });
  t.check("a wood camp can be scripted", wood.built, wood);
  t.check("the lumberjack fells mature trees", wood.felled > 0 && wood.trees1 < wood.trees0, wood);
  t.check("a felled tree leaves a stump", wood.stumpAtFelled, wood);
  t.check("logs come home as LUMBER", wood.lumber > 0, wood);
  t.check("the worker is visible outside doing the job", /goWork|doWork|backWork/.test(wood.seenOffsite), wood);
  t.check("the sawmill consumes " + Object.keys(K.BLD.sawmill.in) + " and makes " + K.BLD.sawmill.out,
    wood.plank > 0 && wood.sawCycles > 0 && Object.keys(wood.recipe).length === 1, wood);
  t.check("planks reach the castle store", wood.invPlank > 0, wood);
  t.check("the forester plants saplings", wood.planted > 0 && wood.sap1 > wood.sap0, wood);

  // ════════════════════════════════ stone
  const stone = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC;
    T.fresh();
    const G = FS.G, map = G.map;
    const sc = T.add("stonecutter", { minD: 3, maxD: 16 });
    if (!sc) return { built: false };
    // record the pile the cutter will work
    const piles = [];
    FS.FSMap.forRadius(map, sc.v, FSC.BLD.stonecutter.radius, (u) => {
      if (FS.FSMap.isStone(map.obj[u])) piles.push([u, map.objArg[u], map.obj[u]]);
    });
    const inv0 = T.inv().stone;
    FS.ff(T.tripTicks("stonecutter") * 14);
    const now = piles.map(([u]) => [map.objArg[u], map.obj[u]]);
    return {
      built: true, piles: piles.length,
      shrank: piles.filter(([u, a]) => map.objArg[u] < a).length,
      stageDown: piles.filter(([u, a, o]) => map.obj[u] < o).length,
      gone: piles.filter(([u]) => map.obj[u] === FSC.OBJ.NONE).length,
      stone: T.prod().stone || 0, inv0, inv1: T.inv().stone, cut: T.ev("stoneCut").length,
      now,
    };
  });
  t.check("a stonecutter works a surface pile", stone.built && stone.piles > 0 && stone.cut > 0, stone);
  t.check("each cut costs the pile a charge", stone.shrank > 0, stone);
  t.check("a worked pile visibly shrinks (and can vanish)", stone.stageDown > 0 || stone.gone > 0, stone);
  t.check("STONE arrives in the store", stone.stone > 0 && stone.inv1 > stone.inv0, stone);

  // ════════════════════════════════ fish
  const fish = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC;
    T.fresh();
    const G = FS.G, map = G.map;
    // a hut on the shore, with a rich shoal in range
    let site = -1, shoal = -1;
    const reach = T.roadReach();
    FS.FSMap.forRadius(map, T.castle().v, 14, (u, d) => {
      if (site >= 0 || d < 3 || !reach[u]) return;
      if (!FS.FSMap.canPlaceBuilding(map, "fisher", u, 0)) return;
      let best = -1;
      FS.FSMap.forRadius(map, u, FSC.BLD.fisher.radius, (w) => {
        if (map.terr[w] === FSC.TERR.WATER && (best < 0 || map.fish[w] > map.fish[best])) best = w;
      });
      if (best < 0) return;
      site = u; shoal = best;
    });
    if (site < 0) return { built: false };
    map.fish[shoal] = FSC.FISH_CAP;                       // a shoal worth casting for
    const b = T.add("fisher", { v: site });
    if (!b) return { built: false };
    // park regrowth so the depletion is measurable (the sweep refills a shoal fast)
    const regrow = FSC.FISH_REGROW_P;
    FSC.FISH_REGROW_P = 0;
    const fish0 = map.fish[shoal];
    FS.ff(T.tripTicks("fisher") * 12);
    FSC.FISH_REGROW_P = regrow;
    const caught = T.ev("fishCaught");
    // a thin shoal (at or below FSC.FISH_MIN_STOCK) must never bite
    const thin = { hits: 0 };
    const s = FS.FSSim.serfsOf(G, 0).find((x) => x.job === "fisher");
    return {
      built: true, fish0, fish1: map.fish[shoal], shoal,
      caught: caught.length, prod: T.prod().fish || 0, inv: T.inv().fish,
      minStock: FSC.FISH_MIN_STOCK, checks: FSC.FISH_CHECKS, state: s && s.state, thin,
    };
  });
  t.check("a fisher hut works a shoal", fish.built && fish.caught > 0, fish);
  t.check("a catch depletes the shoal", fish.fish1 < fish.fish0, fish);
  t.check("FISH lands in the store", (fish.prod || 0) > 0, fish);

  const thinShoal = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC;
    // a shoal at or below the biting threshold is not worth a trip and never bites
    const G = FS.G, map = G.map;
    const b = FS.FSSim.serfsOf(G, 0).find((s) => s.job === "fisher");
    let shoal = -1;
    for (let v = 0; v < map.W * map.H; v++) if (map.terr[v] === FSC.TERR.WATER) { map.fish[v] = FSC.FISH_MIN_STOCK; if (shoal < 0) shoal = v; }
    const regrow = FSC.FISH_REGROW_P, cap = FSC.FISH_CAP;
    FSC.FISH_REGROW_P = 0;
    FSC.FISH_CAP = FSC.FISH_MIN_STOCK;              // …and no shoal can drift above it
    const before = T.ev("fishCaught").length;
    FS.ff(T.tripTicks("fisher") * 6);
    const after = T.ev("fishCaught").length;
    FSC.FISH_REGROW_P = regrow; FSC.FISH_CAP = cap;
    return { rule: FSC.FISH_MIN_STOCK, div: FSC.FISH_P_DIV, bites: after - before, shoal };
  });
  t.check("a thin shoal (≤ FSC.FISH_MIN_STOCK) never bites", thinShoal.bites === 0, thinShoal);

  // ════════════════════════════════ wheat → flour → bread
  const grain = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC, O = FSC.OBJ;
    T.fresh();
    const G = FS.G, map = G.map;
    const q = T.addMany(["farm", "mill", "bakery"], { minD: 3, maxD: 16 });
    const farm = q.farm, mill = q.mill, bake = q.bakery;
    if (!farm || !mill || !bake) return { built: false, missed: q._missed };
    const WIN = T.sweepPass() * 8;
    FS.ff(WIN);
    const sown = T.ev("fieldSown"), reaped = T.ev("fieldReaped");
    // every field must sit in the sowing ring, never right against the farmhouse
    let inRing = true, minD = 99;
    sown.forEach((e) => {
      const d = FS.FSMap.dist(map, farm.v, e.v);
      if (d < minD) minD = d;
      if (d < FSC.FIELD_RING[0] || d > FSC.FIELD_RING[1]) inRing = false;
    });
    const prod = T.prod();
    return {
      built: true, mill: !!mill, bake: !!bake, window: WIN,
      sown: sown.length, reaped: reaped.length, inRing, minD, ring: FSC.FIELD_RING,
      fields: T.countObj(farm.v, FSC.BLD.farm.radius, (o) => o >= O.FIELD0 && o <= O.FIELD4),
      wheat: prod.wheat || 0, flour: prod.flour || 0, bread: prod.bread || 0,
      millIn: FSC.BLD.mill.in, millOut: FSC.BLD.mill.out,
      bakeIn: FSC.BLD.bakery.in, bakeOut: FSC.BLD.bakery.out,
      millCycles: mill ? mill.cycles : 0, bakeCycles: bake ? bake.cycles : 0,
      harvestMin: FSC.FIELD_HARVEST_MIN,
    };
  });
  t.check("the farmer sows fields", grain.built && grain.sown > 0 && grain.fields > 0, grain);
  t.check("fields are sown inside FSC.FIELD_RING", grain.inRing && grain.minD >= grain.ring[0], grain);
  t.check("ripe fields are cut for WHEAT", grain.reaped > 0 && grain.wheat > 0, grain);
  t.check("the mill turns " + Object.keys(K.BLD.mill.in) + " into " + K.BLD.mill.out,
    grain.flour > 0 && grain.millCycles > 0, grain);
  t.check("the bakery turns " + Object.keys(K.BLD.bakery.in) + " into " + K.BLD.bakery.out,
    grain.bread > 0 && grain.bakeCycles > 0, grain);

  // ════════════════════════════════ pigs → meat
  const meat = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC;
    T.fresh();
    const q = T.addMany(["pigfarm", "butcher"], { minD: 3, maxD: 16 });
    const pig = q.pigfarm, but = q.butcher;
    if (!pig || !but) return { built: false, missed: q._missed };
    T.feed(pig, "wheat", FSC.IN_CAP);
    const wheat0 = pig.stockIn.wheat;
    FS.ff(FSC.BLD.pigfarm.cycleT * 14);
    const prod = T.prod();
    const meatEv = T.ev("produced").filter((e) => e.res === "meat");
    return {
      // the pen is topped back up by the supply line, so measure what it ATE:
      // starting stock + everything delivered since, minus what is left
      built: true, wheat0, wheat1: pig.stockIn.wheat || 0, herd: pig.herd,
      fed: T.deliveredTo(pig, "wheat"),
      pigs: prod.pig || 0, meat: prod.meat || 0,
      butIn: FSC.BLD.butcher.in, outN: FSC.BLD.butcher.outN || 1,
      perCycle: meatEv.length ? meatEv[0].n : 0, butCycles: but.cycles,
      keep: FSC.PIG_KEEP, herdMax: FSC.PIG_HERD_MAX,
    };
  });
  t.check("the pig farm eats wheat and raises a herd",
    meat.built && (meat.wheat0 + meat.fed - meat.wheat1) > 0 && meat.herd >= 0, meat);
  t.check("pigs ship out once the herd is above FSC.PIG_KEEP", meat.pigs > 0 && meat.herd <= meat.herdMax, meat);
  t.check("the butcher turns " + Object.keys(K.BLD.butcher.in) + " into meat", meat.meat > 0 && meat.butCycles > 0, meat);
  t.check("each pig yields FSC.BLD.butcher.outN (=" + (K.BLD.butcher.outN || 1) + ") meat",
    meat.perCycle === (K.BLD.butcher.outN || 1), meat);

  // ════════════════════════════════ geology: signs vs the ground truth
  const geo = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC;
    T.fresh();
    const G = FS.G, map = G.map, reach = T.roadReach();
    // a mountain flag near the natural iron seam
    let ore = -1;
    for (let v = 0; v < map.W * map.H; v++) {
      if (!reach[v] || map.terr[v] !== FSC.TERR.MOUNTAIN) continue;
      if (!map.mineral[v] || !map.mineralAmt[v]) continue;
      if (ore < 0 || FS.FSMap.dist(map, T.castle().v, v) < FS.FSMap.dist(map, T.castle().v, ore)) ore = v;
    }
    if (ore < 0) return { ok: false, why: "no reachable ore" };
    T.seedOre(ore, "COAL", 20, 2);                       // a fat seam to be found
    let fv = -1;
    FS.FSMap.forRadius(map, ore, 4, (u, d) => {
      if (fv >= 0 || d < 1 || !reach[u]) return;
      if (map.terr[u] !== FSC.TERR.MOUNTAIN || FS.FSMap.whyFlag(map, u, 0)) return;
      if (!T.connect(u)) return;
      fv = u;
    });
    if (fv < 0) return { ok: false, why: "no reachable mountain flag" };
    const flag = map.flagAt[fv];
    const bad = FS.sendGeologist(0);
    FS.ff(2);
    const sent = FS.sendGeologist(flag);
    FS.ff(FSC.GEO_T * FSC.GEO_SPOTS * 6);
    let ok = 0, wrong = 0, withOre = 0, big = 0;
    const seen = [];
    for (let v = 0; v < map.W * map.H; v++) {
      if (!map.sign[v]) continue;
      const code = map.sign[v];
      const truth = map.mineralAmt[v] > 0 ? map.mineral[v] : 0;
      const said = FS.FSSim.signMineral(code);
      if (said === truth) ok++; else { wrong++; seen.push([v, code, said, truth, map.mineralAmt[v]]); }
      if (said > 0) {
        withOre++;
        if (FS.FSSim.signDensity(code) > 0) big++;
        if ((map.mineralAmt[v] >= FSC.GEO_BIG_AMT) !== (FS.FSSim.signDensity(code) > 0)) wrong++;
      }
    }
    // the tour is over when the last hammer falls, but the WALK back can be long
    // (mountain edges are the slowest in FSC.WALK_TICKS_TABLE) — give him a
    // bounded grace period instead of a knife-edge window
    let grace = 0;
    const geoLeft = () => FS.FSSim.serfsOf(G, 0).filter((s) => s.job === "geologist").length;
    const graceCap = FSC.GEO_T * FSC.GEO_SPOTS * 6;
    while (geoLeft() && grace < graceCap) { FS.ff(FSC.GEO_T); grace += FSC.GEO_T; }
    const g = FS.FSSim.serfsOf(G, 0).filter((s) => s.job === "geologist");
    return {
      ok: true, flag, fv, ore, signs: ok + wrong, correct: ok, wrong, withOre, big, seen, grace,
      geoEvents: T.ev("geoSign").length, spots: FSC.GEO_SPOTS,
      badFlag: bad && bad.args !== undefined,
      cmdFail: T.ev("cmdFail").filter((e) => e.cmd === "geologist").length,
      notif: G.notif.filter((n) => /Geologist/.test(n.text)).length,
      home: g.length,
    };
  });
  t.check("a geologist can be sent to a mountain flag", geo.ok && geo.geoEvents > 0, geo);
  t.check("he plants signs (bounded by FSC.GEO_SPOTS)", geo.signs > 0 && geo.signs <= geo.spots, geo);
  t.check("every sign matches the ground truth under it", geo.wrong === 0 && geo.correct === geo.signs, geo);
  t.check("a rich seam is signed as a big find", geo.withOre === 0 || geo.big > 0, geo);
  t.check("finding ore notifies the player", geo.withOre === 0 || geo.notif > 0, geo);
  t.check("sending a geologist to a bad flag fails cleanly", geo.cmdFail >= 1, geo);
  t.check("the geologist goes home when the survey is done", geo.home === 0, geo);

  // ════════════════════════════════ mines: food, digging, exhaustion
  const mine = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC;
    T.fresh();
    const G = FS.G, map = G.map, reach = T.roadReach();
    let mv = -1, mvRock = 0;
    for (let v = 0; v < map.W * map.H; v++) {
      if (!reach[v] || map.terr[v] !== FSC.TERR.MOUNTAIN) continue;
      if (!FS.FSMap.canPlaceBuilding(map, "coalMine", v, 0)) continue;
      const door = FS.FSMap.doorVertex(map, v);
      if (door < 0 || !reach[door]) continue;
      let rock = 0;
      FS.FSMap.forRadius(map, v, FSC.MINE_RING, (u) => { if (map.terr[u] === FSC.TERR.MOUNTAIN) rock++; });
      if (rock > mvRock) { mvRock = rock; mv = v; }        // deep in the rock, not on its lip
    }
    if (mv < 0) return { built: false };
    // this start has no COAL inside its own borders, so the seam is scripted in
    // (documented deviation — every other mine mechanic is the real thing)
    T.seedOre(mv, "COAL", 20, FSC.MINE_RING);
    const b = T.add("coalMine", { v: mv });
    if (!b) return { built: false };
    let amt0 = 0;
    FS.FSMap.forRadius(map, mv, FSC.MINE_RING, (u) => (amt0 += map.mineralAmt[u]));
    // greedy meal rule: the miner eats whichever food he holds most of
    b.stockIn.fish = 1; b.stockIn.bread = 3; b.stockIn.meat = 0;
    const mealBefore = { fish: b.stockIn.fish, bread: b.stockIn.bread };
    let guard = 0;
    while (FS.FSSim.foodStock(b) === 4 && guard++ < 4000) FS.ff(1);
    const mealAfter = { fish: b.stockIn.fish, bread: b.stockIn.bread };
    T.feed(b, "fish", FSC.IN_CAP);
    const food0 = FS.FSSim.foodStock(b);
    const cycle = FSC.MINE_WAIT[1] + FSC.MINE_EAT_T + FSC.MINE_PRE_T + FSC.MINE_DIGS * FSC.MINE_DIG_T
      + FSC.MINE_POST_T + FSC.MINE_OUT_T;
    FS.ff(cycle * 8);
    let amt1 = 0;
    FS.FSMap.forRadius(map, mv, FSC.MINE_RING, (u) => (amt1 += map.mineralAmt[u]));
    const coal = T.prod().coal || 0;
    const foodMid = FS.FSSim.foodStock(b);
    // fed rate over one window…
    T.feed(b, "fish", FSC.IN_CAP);
    const fedAt = T.prod().coal || 0;
    FS.ff(cycle * 4);
    const coalFed = (T.prod().coal || 0) - fedAt;
    // …then starve it: every meal gone and no more coming
    for (const f of FSC.FOODS) T.drain(f);
    const coalAtStarve = T.prod().coal || 0;
    FS.ff(cycle * 4);
    const coalStarved = (T.prod().coal || 0) - coalAtStarve;
    return {
      built: true, mv, mvRock, amt0, amt1, coal, food0, foodMid, cycle,
      coalFed, coalStarved, digs: FSC.MINE_DIGS, ring: FSC.MINE_RING,
      needFood: FS.FSSim.need(G, b, "fish"), needBread: FS.FSSim.need(G, b, "bread"), inCap: FSC.IN_CAP,
      worker: !!b.worker, cycles: b.cycles, mealBefore, mealAfter,
    };
  });
  t.check("a mine can be built on a mountain seam and crewed", mine.built && mine.worker, mine);
  t.check("the miner eats a meal per cycle, the one he has most of",
    mine.built && mine.mealAfter.bread === mine.mealBefore.bread - 1
    && mine.mealAfter.fish === mine.mealBefore.fish && mine.cycles > 0, mine);
  t.check("digging yields ore and empties the seam", mine.coal > 0 && mine.amt1 < mine.amt0, mine);
  t.check("ore taken never exceeds the seam", mine.amt0 - mine.amt1 >= mine.coal, mine);
  t.check("a mine with no food all but stops", mine.coalStarved * 2 < mine.coalFed, mine);
  t.check("a hungry mine asks for up to FSC.IN_CAP meals (the cap is shared by all foods)",
    mine.needFood > 0 && mine.needFood <= mine.inCap && mine.needBread === mine.needFood, mine);

  const dry = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC;
    T.fresh();
    const G = FS.G, map = G.map, reach = T.roadReach();
    let mv = -1;
    for (let v = 0; v < map.W * map.H; v++) {
      if (!reach[v] || map.terr[v] !== FSC.TERR.MOUNTAIN) continue;
      if (!FS.FSMap.canPlaceBuilding(map, "coalMine", v, 0)) continue;
      const door = FS.FSMap.doorVertex(map, v);
      if (door < 0 || !reach[door]) continue;
      if (mv < 0 || FS.FSMap.dist(map, T.castle().v, v) < FS.FSMap.dist(map, T.castle().v, mv)) mv = v;
    }
    if (mv < 0) return { built: false };
    T.clearOre(mv, FSC.MINE_RING + 1);
    T.seedOre(mv, "COAL", 4, 0);                       // one lonely pocket
    const b = T.add("coalMine", { v: mv });
    if (!b) return { built: false };
    const cycle = FSC.MINE_WAIT[1] + FSC.MINE_EAT_T + FSC.MINE_PRE_T + FSC.MINE_DIGS * FSC.MINE_DIG_T
      + FSC.MINE_POST_T + FSC.MINE_OUT_T;
    for (let i = 0; i < 70; i++) {
      T.feed(b, "fish", 2);
      FS.ff(Math.round(cycle * 1.5));
      if (T.ev("mineExhausted").length) break;
    }
    return {
      built: true, exhausted: T.ev("mineExhausted").length, flag: b.mine.exhausted,
      coal: FS.FSSim.production(G, 0).coal || 0,
      notif: G.notif.filter((n) => /run dry/i.test(n.text)).length,
      need: FS.FSSim.need(G, b, "fish"), reg: b.mine.reg,
    };
  });
  const meals = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC;
    T.fresh();
    const c = T.castle();
    c.inv.fish = 1; c.inv.bread = 5; c.inv.meat = 2;
    const most = FS.FSSim.bestFoodOf(c);
    c.inv.fish = 3; c.inv.bread = 3; c.inv.meat = 0;
    const tie = FS.FSSim.bestFoodOf(c);
    return { most, tie, order: FSC.FOODS };
  });
  t.check("a store ships the food it is longest on (ties → fish)",
    meals.most === "bread" && meals.tie === meals.order[0], meals);

  t.check("a worked-out mine raises 'exhausted'", dry.built && dry.exhausted >= 1 && dry.flag, dry);
  t.check("the player is told the mine ran dry", dry.notif >= 1, dry);
  t.check("an exhausted mine stops asking for food", dry.need === 0, dry);

  // ════════════════════════════════ smelters, tools, weapons, boats
  const works = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC;
    T.fresh();
    const G = FS.G;
    const q = T.addMany(["smelter", "goldsmelter", "toolmaker", "weaponsmith", "boatwright"],
      { minD: 3, maxD: 16 });
    const sme = q.smelter, gold = q.goldsmelter, tool = q.toolmaker, wea = q.weaponsmith, boat = q.boatwright;
    const out = { built: { sme: !!sme, gold: !!gold, tool: !!tool, wea: !!wea, boat: !!boat }, missed: q._missed };
    // hand-stock every recipe so the test is about the RECIPE, not the supply line
    [[sme, FSC.BLD.smelter.in], [gold, FSC.BLD.goldsmelter.in], [tool, FSC.BLD.toolmaker.in],
      [wea, FSC.BLD.weaponsmith.in], [boat, FSC.BLD.boatwright.in]].forEach(([b, recipe]) => {
        if (!b) return;
        for (const r in recipe) T.feed(b, r, recipe[r] * 6);
      });
    // toolmaker: mute every slider but the axe — the roulette can then only draw axes
    for (const k in G.players[0].tools) G.players[0].tools[k] = 0;
    FS.setToolPrio("axe", FSC.PRIO_MAX);
    FS.ff(2);
    const longest = Math.max(FSC.BLD.smelter.cycleT, FSC.BLD.goldsmelter.cycleT,
      FSC.BLD.toolmaker.cycleT, FSC.BLD.weaponsmith.cycleT, FSC.BLD.boatwright.cycleT);
    const stock0 = {};
    [["tool", tool, FSC.BLD.toolmaker.in], ["wea", wea, FSC.BLD.weaponsmith.in]].forEach(([k, b, recipe]) => {
      if (!b) return;
      stock0[k] = {};
      for (const r in recipe) stock0[k][r] = { had: b.stockIn[r] || 0, in: T.deliveredTo(b, r) };
    });
    FS.ff(longest * 6);
    const prod = T.prod();
    const madeTools = T.ev("produced").filter((e) => e.btype === "toolmaker").map((e) => e.res);
    const weapons = T.ev("produced").filter((e) => e.btype === "weaponsmith").map((e) => e.res);
    let alternates = true;
    for (let i = 1; i < weapons.length; i++) if (weapons[i] === weapons[i - 1]) alternates = false;
    return Object.assign(out, {
      steel: prod.steel || 0, goldBar: prod.goldBar || 0, boats: prod.boat || 0,
      madeTools, axesOnly: madeTools.length > 0 && madeTools.every((r) => r === "axe"),
      weapons, alternates, firstWeapon: weapons[0],
      used: (() => {
        const o = {};
        [["tool", tool, FSC.BLD.toolmaker.in], ["wea", wea, FSC.BLD.weaponsmith.in]].forEach(([k, b, recipe]) => {
          if (!b || !stock0[k]) return;
          o[k] = {};
          for (const r in recipe) {
            o[k][r] = stock0[k][r].had + (T.deliveredTo(b, r) - stock0[k][r].in) - (b.stockIn[r] || 0);
          }
        });
        return o;
      })(),
      toolCycles: tool ? tool.cycles : 0, weaCycles: wea ? wea.cycles : 0,
      toolBusy: tool ? (tool.working ? 1 : 0) : 0, weaBusy: wea ? (wea.working ? 1 : 0) : 0,
      toolIn: FSC.BLD.toolmaker.in, boatIn: FSC.BLD.boatwright.in,
      toolInLeft: tool ? Object.keys(FSC.BLD.toolmaker.in).map((r) => tool.stockIn[r]) : [],
      smeIn: FSC.BLD.smelter.in, goldIn: FSC.BLD.goldsmelter.in,
    });
  });
  t.check("smelter: " + Object.keys(K.BLD.smelter.in) + " → " + K.BLD.smelter.out, works.steel > 0, works);
  t.check("gold smelter: " + Object.keys(K.BLD.goldsmelter.in) + " → " + K.BLD.goldsmelter.out, works.goldBar > 0, works);
  t.check("the toolmaker draws from the priority sliders (axe only → only axes)",
    works.axesOnly && works.madeTools.length > 0, works);
  t.check("the toolmaker consumes " + Object.keys(K.BLD.toolmaker.in) + " once per tool",
    works.used && works.used.tool
    && Object.keys(K.BLD.toolmaker.in).every((r) =>
      works.used.tool[r] === (works.madeTools.length + works.toolBusy) * K.BLD.toolmaker.in[r]), works);
  t.check("the weaponsmith alternates sword and shield", works.weapons.length >= 2 && works.alternates, works);
  t.check("only the sword half-cycle eats coal + steel",
    works.weapons.length >= 2 && works.used && works.used.wea
    && works.used.wea.coal === works.weapons.filter((w) => w === "sword").length
      + (works.weaBusy && works.weapons.length % 2 === 0 ? 1 : 0)
    && works.used.wea.coal === works.used.wea.steel, works);
  t.check("the boatwright builds boats from " + Object.keys(K.BLD.boatwright.in), works.boats > 0, works);

  // ════════════════════════════════ water roads + boats
  const water = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC;
    T.fresh({ seed: 4242 });                 // this start has a bay worth bridging
    const G = FS.G, map = G.map, reach = T.roadReach();
    const shore = [];
    for (let v = 0; v < map.W * map.H; v++) {
      if (!reach[v] || FS.FSMap.whyFlag(map, v, 0)) continue;
      for (let d = 0; d < 6; d++) {
        const u = FS.FSMap.nbr(map, v, d);
        if (u >= 0 && map.terr[u] === FSC.TERR.WATER) { shore.push(v); break; }
      }
    }
    let A = -1, B = -1, path = null;
    for (let i = 0; i < shore.length && A < 0; i++) {
      for (let j = i + 1; j < shore.length; j++) {
        const d = FS.FSMap.dist(map, shore[i], shore[j]);
        if (d < 3 || d > 9) continue;
        const p = FS.FSSim.roadPath(G, shore[i], shore[j], 0, { water: true, maxLen: 80 });
        if (!p) continue;
        let w = 0;
        for (const v of p) if (map.terr[v] === FSC.TERR.WATER) w++;
        if (w < 2) continue;
        A = shore[i]; B = shore[j]; path = p;
        break;
      }
    }
    if (A < 0) return { ok: false, why: "no crossable water" };
    if (!T.connect(A)) return { ok: false, why: "shore not reachable" };
    const fb = FS.FSSim.placeFlag(G, B, 0);
    // a road drawn across the water becomes a BOAT road by itself
    const r = FS.FSSim.buildRoad(G, map.flagAt[A], fb.id, path, 0, {});
    const road = r.ok ? G.roads[r.id] : null;
    // …while an ordinary road on land is not a ferry
    let landRoad = null;
    for (const id in G.roads) if (!G.roads[id].water && !landRoad) landRoad = G.roads[id];
    const carrier0 = road ? road.carrier : -1;
    FS.ff(FSC.BOAT_REQ_T * 2);
    const inflight = road ? road.boatInFlight : 0;
    let arrived = 0, guard = 0;
    while (road && !road.boatHave && guard++ < 40) FS.ff(200);
    const sailorAt = road && road.carrier ? G.serfs[road.carrier] : null;
    // now make goods cross: a producer on the far shore
    let far = -1;
    FS.FSMap.forRadius(map, B, 5, (u, d) => {
      if (far >= 0 || d < 2) return;
      if (FS.FSMap.canPlaceBuilding(map, "lumberjack", u, 0)) far = u;
    });
    let ferried = 0, farBld = null;
    if (far >= 0) {
      const rb = FS.FSSim.build(G, "lumberjack", far, 0);
      if (rb.ok) {
        farBld = G.buildings[rb.id];
        T.connect(G.flags[farBld.flag].v);
        FS.ff(FSC.BLD.lumberjack.swings * 90 + 4000);
        ferried = T.ev("itemDeliver").filter((e) => e.bld === farBld.id).length;
      }
    }
    const sailors = FS.FSSim.serfsOf(G, 0).filter((s) => s.job === "sailor");
    return {
      ok: true, A, B, water: road ? road.water : false, landIsDry: landRoad ? !landRoad.water : false,
      built: r.ok, why: r.why, carrier0, boatHave: road ? road.boatHave : false, inflight,
      sent: T.ev("boatSent").length, arrived: T.ev("boatArrive").length,
      sailor: sailors.length, sailorState: sailorAt && sailorAt.state,
      ferried, far, farState: farBld && farBld.state,
      boatsLeft: T.inv().boat,
    };
  });
  t.check("a road drawn across water becomes a BOAT road", water.ok && water.built && water.water, water);
  t.check("roads on dry land are not ferries", water.landIsDry, water);
  t.check("a boatless ferry has no crew", water.ok && water.carrier0 === 0, water);
  t.check("a boat is shipped out to the crossing", water.sent >= 1 && water.arrived >= 1, water);
  t.check("the boat brings the ferry to life (a sailor crews it)", water.boatHave && water.sailor >= 1, water);
  t.check("goods cross the water", water.ferried >= 1, water);
  t.check("the delivered boat left the store",
    water.boatsLeft < require("../assets/farmstead/fs-const.js").START_INV.boat, water);

  // ════════════════════════════════ distribution sliders
  const dist = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC, FSSim = FS.FSSim;
    T.fresh();
    const G = FS.G;
    // two consumers of PLANKS: a construction site and a boatwright
    const q = T.addMany(["boatwright"], { minD: 3, maxD: 16 });
    const q2 = T.addMany(["toolmaker"], { minD: 3, maxD: 16, finish: false, used: [q.boatwright ? q.boatwright.v : 0] });
    const boat = q.boatwright, site = q2.toolmaker;
    if (!boat || !site) return { ok: false, missed: [q._missed, q2._missed] };
    const from = T.castle().flag;
    function measure(n) {
      const tally = {};
      G.players[0].distCredit = {};
      for (let i = 0; i < n; i++) {
        const b = FSSim.chooseDemand(G, from, "plank", 0);
        if (!b) break;
        const key = FSSim.distKey("plank", b);
        tally[key] = (tally[key] || 0) + 1;
      }
      return tally;
    }
    const step = FSC.PRIO_STEP;
    FS.setDist("planksConstruction", step * 16);   // 8 : 2 on the classic's 20 notches
    FS.setDist("planksBoats", step * 4);
    FS.ff(2);
    const a = measure(40);
    FS.setDist("planksConstruction", step * 4);
    FS.setDist("planksBoats", step * 16);
    FS.ff(2);
    const b = measure(40);
    FS.setDist("planksBoats", 0);
    FS.setDist("planksConstruction", step * 16);
    FS.ff(2);
    const c = measure(40);
    return {
      ok: true, a, b, c,
      keys: { site: FSSim.distKey("plank", site), boat: FSSim.distKey("plank", boat) },
      cmdFail: T.ev("cmdFail").filter((e) => e.cmd === "dist").length,
      badSet: FS.FSSim.setDist(G, 0, "nonsense", 5).ok,
    };
  });
  t.check("plank consumers are classed by the distribution table",
    dist.ok && dist.keys.site === "planksConstruction" && dist.keys.boat === "planksBoats", dist);
  t.check("a 4:1 slider gives construction ~4x the planks",
    dist.a.planksConstruction >= 3 * (dist.a.planksBoats || 1), dist);
  t.check("flipping the sliders reverses the flow",
    dist.b.planksBoats >= 3 * (dist.b.planksConstruction || 1), dist);
  t.check("a slider at 0 is never served", !dist.c.planksBoats, dist);
  t.check("an unknown distribution key is rejected", dist.badSet === false, dist);

  // ════════════════════════════════ warehouse In / Stop / Out
  const modes = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC;
    T.fresh();
    const G = FS.G;
    const stock = T.add("stock", { minD: 4, maxD: 16 });
    if (!stock) return { ok: false };
    const castle = T.castle();
    const M = FSC.STOCK_MODE;
    // STOP: the store refuses planks, so a produced plank may not be sent there
    FS.setStockMode(stock.id, "plank", M.STOP);
    FS.ff(2);
    const stopAccepts = FS.FSSim.stockAccepts(stock, "plank");
    const stopFound = !!FS.FSSim.warehouseNear(G, castle.flag, 0, (b) => b.id === stock.id && FS.FSSim.stockAccepts(b, "plank"));
    // OUT: the castle pushes its planks away, the store takes them in
    FS.setStockMode(stock.id, "plank", M.IN);
    FS.setStockMode(castle.id, "plank", M.OUT);
    FS.ff(2);
    const c0 = castle.inv.plank, s0 = stock.inv.plank;
    FS.ff(20000);
    const bad = FS.FSSim.setStockMode(G, castle.id, "plank", 9);
    return {
      ok: true, stopAccepts, stopFound,
      c0, s0, c1: castle.inv.plank, s1: stock.inv.plank,
      badMode: bad.ok, notWarehouse: FS.FSSim.setStockMode(G, stock.id + 999, "plank", 0).ok,
    };
  });
  t.check("a store set to STOP takes no more of that good", modes.ok && !modes.stopAccepts && !modes.stopFound, modes);
  t.check("a store set to OUT pushes the good away", modes.c1 < modes.c0, modes);
  t.check("…and it lands in the other warehouse", modes.s1 > modes.s0, modes);
  t.check("bad warehouse-mode commands are rejected", modes.badMode === false && modes.notWarehouse === false, modes);

  // ════════════════════════════════ requests, halt, pause/resume
  const flow = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC;
    T.fresh();
    const G = FS.G;
    const saw = T.add("sawmill", { minD: 3, maxD: 16 });
    if (!saw) return { ok: false };
    const need0 = FS.FSSim.need(G, saw, "lumber");
    T.feed(saw, "lumber", FSC.IN_CAP);
    const needFull = FS.FSSim.need(G, saw, "lumber");
    // no input → no production (drain every log in the settlement, not just his)
    T.drain("lumber");
    const p0 = T.prod().plank || 0;
    FS.ff(FSC.BLD.sawmill.cycleT * 3);
    const starved = (T.prod().plank || 0) - p0;
    // feed it → production resumes
    T.drain("lumber");
    T.feed(saw, "lumber", 3);
    FS.ff(FSC.BLD.sawmill.cycleT * 3 + 10);
    const fed = (T.prod().plank || 0) - p0;
    // halt → stops again
    FS.halt(saw.id, true);
    FS.ff(2);
    T.feed(saw, "lumber", 3);
    const p1 = T.prod().plank || 0;
    FS.ff(FSC.BLD.sawmill.cycleT * 3);
    const halted = (T.prod().plank || 0) - p1;
    FS.halt(saw.id, false);
    FS.ff(FSC.BLD.sawmill.cycleT * 2 + 10);
    const resumed = (T.prod().plank || 0) - p1;
    return { ok: true, need0, needFull, cap: FSC.IN_CAP, starved, fed, halted, resumed,
      haltedFlag: saw.halted };
  });
  t.check("an idle producer asks for exactly FSC.IN_CAP inputs", flow.ok && flow.need0 === flow.cap && flow.needFull === 0, flow);
  t.check("production stops when the input runs out", flow.starved === 0, flow);
  t.check("…and resumes as soon as it is fed", flow.fed > 0, flow);
  t.check("HALT stops a working building", flow.halted === 0 && !flow.haltedFlag, flow);
  t.check("un-halting starts it again", flow.resumed > 0, flow);

  // ════════════════════════════════ a whole economy: liveness, perf, determinism
  const town = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC, FSSim = FS.FSSim;
    T.fresh();
    const G = FS.G, used = [];
    const huts = T.expand(4);          // guard huts push the border out for room to build
    const wanted = ["lumberjack", "sawmill", "forester", "stonecutter", "farm", "mill",
      "bakery", "pigfarm", "butcher", "toolmaker", "smelter", "weaponsmith",
      "fisher", "boatwright", "stock", "hut", "goldsmelter", "lumberjack", "farm"];
    const q = T.addMany(wanted, { used, minD: 3, maxD: 16 });
    const made = q._list.map((b) => b.type);
    // a mine on the nearest seam
    const reach = T.roadReach(), map = G.map;
    let mv = -1;
    for (let v = 0; v < map.W * map.H; v++) {
      if (!reach[v] || map.terr[v] !== FSC.TERR.MOUNTAIN || !map.mineralAmt[v]) continue;
      if (!FS.FSMap.canPlaceBuilding(map, "ironMine", v, 0)) continue;
      const door = FS.FSMap.doorVertex(map, v);
      if (door < 0 || !reach[door]) continue;
      if (mv < 0 || FS.FSMap.dist(map, T.castle().v, v) < FS.FSMap.dist(map, T.castle().v, mv)) mv = v;
    }
    if (mv >= 0) { T.seedOre(mv, "IRON", 20, 3); if (T.add("ironMine", { v: mv })) made.push("ironMine"); }

    const t0 = performance.now();
    FS.ff(30000);
    const ms = performance.now() - t0;
    const prod = T.prod();
    let destless = 0, goods = 0;
    for (const id in G.flags) {
      const f = G.flags[id];
      for (const it of f.slots) { goods++; if (!it.dest && !it.destFlag) destless++; }
    }
    let stuck = 0;
    for (const id in G.serfs) {
      const s = G.serfs[id];
      if (s.state === "wait" && s.congestT > FSC.CONGEST_T) stuck++;
    }
    const counts = FSSim.counts(G, 0);
    const kinds = Object.keys(prod).filter((k) => prod[k] > 0);
    return {
      made, huts, buildings: counts.buildings, serfs: counts.serfs, people: counts.people,
      roads: counts.roads, flags: counts.flags,
      prod, kinds: kinds.length, goods, destless, stuck,
      msPerTick: ms / 30000, at4x: (ms / 30000) * 40,
      hash: FSSim.hash(G), tick: G.tick,
      stats: (G.stats[0].t || []).length,
    };
  });
  t.check("a full settlement can be scripted", town.made.length >= 12 && town.buildings >= 16, town.made);
  t.check("it is busy with people", town.serfs >= 12 && town.people >= 20, town);
  t.check("many different goods are produced", town.kinds >= 6, { kinds: town.kinds, prod: town.prod });
  t.check("no destless pile-up after 30k ticks", town.destless <= 4, town);
  t.check("no carrier is stuck past the congestion timeout", town.stuck === 0, town);
  t.check("the stats rings are sampled", town.stats > 0, town);
  t.check("tick cost stays inside the 6 ms budget", town.msPerTick < 6, town);
  t.check("4x with a full economy costs <60 ms of CPU per real second", town.at4x < 60, town);
  console.log("   perf: tickMsAvg=" + town.msPerTick.toFixed(4) + "ms  (4x → " + town.at4x.toFixed(2)
    + "ms/s)  buildings=" + town.buildings + " serfs=" + town.serfs + " roads=" + town.roads
    + " people=" + town.people);
  console.log("   produced: " + JSON.stringify(town.prod));

  const det = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim;
    function scripted() {
      T.fresh();
      const G = FS.G;
      T.addMany(["lumberjack", "sawmill", "farm", "mill", "stonecutter"], { minD: 3, maxD: 16 });
      FS.ff(12000);
      return { hash: FSSim.hash(G), prod: JSON.stringify(FSSim.production(G, 0)), tick: G.tick };
    }
    const a = scripted(), b = scripted();
    return { a, b };
  });
  t.check("the economy replays identically from the same seed + script",
    det.a.hash === det.b.hash && det.a.prod === det.b.prod, det);
  t.check("the replay actually produced goods", det.a.prod.length > 5 && det.a.tick === 12000, det.a);

  // ════════════════════════════════ models + render
  const models = await page.evaluate(() => {
    const FS = window.__FS__, FSC = FS.FSC, FSModels = FS.FSModels;
    const out = { types: [], maxTris: 0, distinct: 0, spin: [], smoke: [] };
    const sigs = new Set();
    for (const type of FSC.BLD_LIST) {
      const g = FSModels.building(type, 0);
      let tris = 0, verts = 0, sum = 0;
      g.traverse((o) => {
        if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
        const pos = o.geometry.attributes.position;
        const n = pos.count;
        verts += n;
        tris += (o.geometry.index ? o.geometry.index.count : n) / 3;
        for (let k = 0; k < pos.array.length; k++) sum = (sum + Math.round(pos.array[k] * 97) * (k + 1)) % 2147483647;
      });
      out.types.push([type, Math.round(tris)]);
      // The castle may be the user-supplied GLB asset (own budget, checked separately);
      // every procedural model stays under the shared ceiling.
      if (type === "castle" && typeof FSModels !== "undefined" && FSModels._castleGLB) {
        out.castleGlbTris = Math.round(tris);
      } else if (tris > out.maxTris) out.maxTris = Math.round(tris);
      sigs.add(verts + ":" + Math.round(tris) + ":" + sum);
      if (g.userData.spin) out.spin.push(type);
      if (g.userData.smoke) out.smoke.push(type);
    }
    out.distinct = sigs.size;
    out.n = FSC.BLD_LIST.length;
    out.budget = FSC.VIS.BLD_TRI_MAX;      /* ===== PHASE-V ===== */
    out.castleGlbBudget = FSC.VIS.CASTLE_GLB_TRI_MAX || 5200;
    out.dupes = out.n - sigs.size;
    return out;
  });
  t.check("every building type has its own model", models.types.length === models.n, models.types);
  /* PHASE-V raised this ceiling on purpose. The Phase-C models were bare
   * silhouettes (<=460 tris); the visual overhaul gave every type a stone
   * footing, a real roof with eaves and a ridge, framed doors, lit windows,
   * a chimney where it produces, and the props that say what happens inside —
   * budgeted in fs-const as FSC.VIS.BLD_TRI_MAX. The heaviest (pigfarm, castle)
   * land in the 850-870 range; the assertion reads the constant so a future
   * pass cannot silently blow past its own budget. */
  t.check("each model stays inside the FSC.VIS.BLD_TRI_MAX triangle budget",
    models.maxTris <= models.budget, models);
  t.check("the GLB castle (user asset) stays inside FSC.VIS.CASTLE_GLB_TRI_MAX",
    models.castleGlbTris === undefined || models.castleGlbTris <= (models.castleGlbBudget || 5200),
    { castleGlbTris: models.castleGlbTris, budget: models.castleGlbBudget });
  // the four mines deliberately share one pithead (only the ore heap is tinted),
  // so four of the signatures collapse into one — everything else is unique.
  t.check("the silhouettes really differ from each other", models.distinct >= models.n - 4, models);
  t.check("mills, mines and the sawmill have moving machinery",
    models.spin.indexOf("mill") >= 0 && models.spin.indexOf("coalMine") >= 0 && models.spin.indexOf("sawmill") >= 0, models.spin);
  t.check("furnaces and ovens have chimneys that smoke",
    models.smoke.indexOf("smelter") >= 0 && models.smoke.indexOf("bakery") >= 0 && models.smoke.indexOf("weaponsmith") >= 0, models.smoke);

  const rend = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, R = FS.FSRender, FSC = FS.FSC;
    T.fresh();
    const G = FS.G;
    // a scene with everything Phase C draws: fields, saplings, signs, smoke, machinery
    const q = T.addMany(["mill", "bakery"], { minD: 3, maxD: 16 });
    const mill = q.mill, bake = q.bakery;
    if (mill) { T.feed(mill, "wheat", 4); mill.working = true; mill.prodT = FSC.BLD.mill.cycleT * 4; }
    if (bake) { T.feed(bake, "flour", 4); bake.working = true; bake.prodT = FSC.BLD.bakery.cycleT * 4; }
    const map = G.map;
    let signV = -1;
    FS.FSMap.forRadius(map, T.castle().v, 8, (u, d) => {
      if (signV >= 0 || d < 2 || map.terr[u] === FSC.TERR.WATER) return;
      signV = u;
    });
    if (signV >= 0) { map.sign[signV] = 2 + 8; R.refreshVertex(signV); }
    R.setCam({ yaw: 0.6, pitch: 0.9 });
    R.focusVertex(T.castle().v, 30);
    R.frame(0.033);                       // building views are created during a frame
    const spin0 = mill && R.scene().getObjectByName("bld:" + mill.id);
    const rot0 = spin0 && spin0.userData.spin ? spin0.userData.spin.rotation.z : 0;
    for (let i = 0; i < 30; i++) { R.frame(0.033); }   // render only: the sim must not clear `working`
    const rot1 = spin0 && spin0.userData.spin ? spin0.userData.spin.rotation.z : 0;
    const info = R.dynamicInfo();
    const st = R.stats();
    return {
      pools: Object.keys(info.pools), draws: st.drawCalls, signV, mill: !!mill, bake: !!bake,
      rot0, rot1, spun: Math.abs(rot1 - rot0) > 0.01,
      signCount: info.pools.signboard ? info.pools.signboard.count : 0,
      smokeCount: info.pools.smoke ? info.pools.smoke.count : 0,
    };
  });
  t.check("geologist signs are drawn", rend.pools.indexOf("signboard") >= 0 && rend.signCount > 0, rend);
  t.check("working machinery turns on screen", rend.mill && rend.spun, rend);
  t.check("busy chimneys smoke", rend.bake && rend.smokeCount > 0, rend);
  t.check("draw calls stay under budget with the economy running", rend.draws < 140, rend);

  // ════════════════════════════════ screenshots
  const shot1 = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, R = FS.FSRender, FSC = FS.FSC;
    T.fresh();
    const G = FS.G;
    T.addMany(["lumberjack", "sawmill", "forester", "farm", "mill", "bakery", "stonecutter",
      "pigfarm", "butcher", "toolmaker", "smelter", "stock"], { minD: 3, maxD: 16 });
    FS.ff(26000);
    // hold the frame on a busy moment: goods on flags, workers outside, machines running
    let hit = null;
    for (let i = 0; i < 900 && !hit; i++) {
      FS.ff(1);
      const serfs = FS.FSSim.serfsOf(G, 0);
      const outside = serfs.filter((s) => /goWork|doWork|backWork/.test(s.state)).length;
      const working = Object.keys(G.buildings).filter((id) => G.buildings[id].working).length;
      const goods = FS.FSSim.counts(G, 0).goods;
      if (outside >= 1 && goods >= 2 && (working >= 1 || outside >= 2)) hit = { outside, working, goods, tick: G.tick };
    }
    R.setCam({ yaw: 0.62, pitch: 0.78 });
    R.focusVertex(T.castle().v, 23);
    R.setHover(-1);
    for (let i = 0; i < 10; i++) R.frame(0.033);
    return { hit, counts: FS.FSSim.counts(G, 0), prod: FS.FSSim.production(G, 0), hud: FS.paintHud() };
  });
  t.check("composed a busy economy frame", !!shot1.hit, shot1);
  await t.sleep(300);
  await t.shot(page, "farmstead_economy");

  const shot2 = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, R = FS.FSRender, FSC = FS.FSC;
    T.fresh();
    const G = FS.G, map = G.map, reach = T.roadReach();
    let mv = -1, rock = 0;
    for (let v = 0; v < map.W * map.H; v++) {
      if (!reach[v] || map.terr[v] !== FSC.TERR.MOUNTAIN || !FS.FSMap.canPlaceBuilding(map, "coalMine", v, 0)) continue;
      const door = FS.FSMap.doorVertex(map, v);
      if (door < 0 || !reach[door]) continue;
      let r = 0;
      FS.FSMap.forRadius(map, v, FSC.MINE_RING, (u) => { if (map.terr[u] === FSC.TERR.MOUNTAIN) r++; });
      if (r > rock) { rock = r; mv = v; }              // a pithead deep in the rock
    }
    if (mv < 0) return { ok: false };
    T.seedOre(mv, "COAL", 20, FSC.MINE_RING);
    const m1 = T.add("coalMine", { v: mv });
    // a second mine + a surveyed hillside. Collect EVERY legal pithead nearby and
    // try them in turn: whether a given one can be road-connected depends on the
    // shape of the border, so a single candidate is a coin flip.
    const m2cands = [];
    FS.FSMap.forRadius(map, mv, 8, (u, d) => {
      if (d < 3 || !reach[u]) return;
      if (map.terr[u] !== FSC.TERR.MOUNTAIN) return;
      if (FS.FSMap.canPlaceBuilding(map, "ironMine", u, 0)) m2cands.push([u, d]);
    });
    m2cands.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    let m2 = null, m2v = -1;
    for (let i = 0; i < m2cands.length && !m2; i++) {
      const u = m2cands[i][0];
      T.seedOre(u, "IRON", 16, 2);
      m2 = T.add("ironMine", { v: u });
      if (m2) m2v = u;
    }
    // sprinkle a survey around them
    let signs = 0, sx = 0, sz = 0, sn = 0;
    FS.FSMap.forRadius(map, mv, 4, (u, d) => {
      if (d < 1 || map.terr[u] !== FSC.TERR.MOUNTAIN || map.flagAt[u] || map.bldAt[u]) return;
      if (signs >= 9) return;
      const amt = map.mineralAmt[u];
      map.sign[u] = amt > 0 ? (map.mineral[u] + 1) + (amt >= FSC.GEO_BIG_AMT ? 8 : 0) : FSC.SIGN_EMPTY;
      FS.FSRender.refreshVertex(u);
      signs++;
      const p = FS.FSMap.worldXZ(map, u, [0, 0]);
      sx += p[0]; sz += p[1]; sn++;
    });
    if (m1) T.feed(m1, "fish", FSC.IN_CAP);
    if (m2) T.feed(m2, "meat", FSC.IN_CAP);
    FS.ff(700);
    // frame the pithead and the surveyed slope together
    const mp = FS.FSMap.worldXZ(map, mv, [0, 0]);
    R.setCam({ yaw: 0.85, pitch: 0.74, dist: 16, ty: map.height[mv],
      tx: (mp[0] + (sn ? sx / sn : mp[0])) / 2, tz: (mp[1] + (sn ? sz / sn : mp[1])) / 2 });
    R.setHover(-1);
    for (let i = 0; i < 10; i++) { FS.ff(1); R.frame(0.033); }
    return { ok: true, mv, m2v, signs, mines: (m1 ? 1 : 0) + (m2 ? 1 : 0), working: !!(m1 && m1.working) };
  });
  t.check("framed the mining hillside with two pitheads and a survey",
    shot2.ok && shot2.mines >= 2 && shot2.signs >= 6, shot2);
  await t.sleep(250);
  await t.shot(page, "farmstead_mine");

  t.check("0 page errors", t.errors.length === 0, t.errors.slice(0, 6));
});
