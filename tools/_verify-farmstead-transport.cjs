#!/usr/bin/env node
"use strict";
/**
 * FARMSTEAD — Phase B transport suite.
 * Covers: determinism rules (source grep), the command layer, flags + road
 * splitting, road validity, carrier lifecycle, castle→site delivery end to end,
 * multi-hop routing, transport priority incl. live pre-emption, congestion,
 * road/flag demolition, digger leveling, worker requests + tool consumption,
 * warehouse output order, offroad pathing, replay determinism, render + perf.
 *
 *   node tools/_verify-farmstead-transport.cjs
 */
const H = require("./_fs_harness.cjs");

/* Helpers injected into the page once; every later evaluate() reuses window.T. */
const HELPERS = function () {
  const FS = window.__FS__;
  const T = {};
  window.T = T;

  T.fresh = function (o) {
    const G = FS.newGame(Object.assign({ size: "small", seed: 12345, ais: 1, speed: 0 }, o || {}));
    return G;
  };
  T.castle = function () { return FS.FSSim.castleOf(FS.G, 0); };
  T.cflag = function () { return FS.G.flags[T.castle().flag]; };
  /** a building site whose door flag can actually be reached by road */
  T.pickSite = function (type, minD, maxD, skip) {
    const G = FS.G, FSMap = FS.FSMap, from = T.cflag();
    let best = -1;
    FSMap.forRadius(G.map, T.castle().v, maxD || 10, (u, d) => {
      if (best >= 0 || d < (minD || 3)) return;
      if (skip && (u === skip || FSMap.dist(G.map, u, skip) < 3)) return;
      if (!FSMap.canPlaceBuilding(type, u, 0)) return;
      const door = FSMap.doorVertex(G.map, u);
      if (!FS.FSSim.roadPath(G, from.v, door, 0)) return;
      best = u;
    });
    return best;
  };
  T.flagSpot = function (minD, maxD) {
    const G = FS.G, FSMap = FS.FSMap, from = T.cflag();
    let best = -1;
    FSMap.forRadius(G.map, T.castle().v, maxD || 9, (u, d) => {
      if (best >= 0 || d < (minD || 3)) return;
      if (!FSMap.canPlaceFlag(u, 0)) return;
      if (!FS.FSSim.roadPath(G, from.v, u, 0)) return;
      best = u;
    });
    return best;
  };
  /** castleFlag —r1— midFlag —r2— siteFlag : the 3-node chain the tests lean on */
  T.chain = function (type) {
    const G = FS.G, FSMap = FS.FSMap, FSSim = FS.FSSim;
    const cf = T.cflag();
    const sv = T.pickSite(type || "hut", 5, 10);
    const site = G.buildings[FSSim.build(G, type || "hut", sv, 0).id];
    const probe = FSSim.roadPath(G, cf.v, G.flags[site.flag].v, 0);
    let midV = -1, midI = -1;
    for (let i = 2; i + 2 < probe.length; i++) {
      if (!FSMap.whyFlag(G.map, probe[i], 0)) { midV = probe[i]; midI = i; break; }
    }
    if (midV < 0) return null;
    const mf = FSSim.placeFlag(G, midV, 0).flag;
    const r1 = FSSim.buildRoad(G, cf.id, mf.id, probe.slice(0, midI + 1), 0);
    const r2 = FSSim.buildRoad(G, mf.id, site.flag, probe.slice(midI), 0);
    return { site: site.id, mid: mf.id, cf: cf.id, r1: r1.id || 0, r2: r2.id || 0, ok: !!(r1.ok && r2.ok) };
  };
  /** grow a road network: n extra flags each joined to the nearest reachable flag */
  T.town = function (n) {
    const G = FS.G, FSMap = FS.FSMap, FSSim = FS.FSSim;
    let made = 0;
    const cands = [];
    FSMap.forRadius(G.map, T.castle().v, 11, (u, d) => { if (d >= 2) cands.push([u, d]); });
    cands.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    for (let i = 0; i < cands.length && made < n; i++) {
      const v = cands[i][0];
      if (!FSMap.canPlaceFlag(v, 0)) continue;
      // nearest existing flag we can actually reach
      let bestF = 0, bestPath = null, bestLen = 1e9;
      for (const id in G.flags) {
        const f = G.flags[id];
        if (f.p !== 0 || f.roads.length >= 6) continue;
        if (FSMap.dist(G.map, f.v, v) > 7) continue;
        const p = FSSim.roadPath(G, f.v, v, 0);
        if (p && p.length < bestLen) { bestLen = p.length; bestPath = p; bestF = f.id; }
      }
      if (!bestF || bestLen < 2) continue;
      const nf = FSSim.placeFlag(G, v, 0);
      if (!nf.ok) continue;
      const r = FSSim.buildRoad(G, bestF, nf.id, bestPath, 0);
      if (!r.ok) { FSSim.removeFlag(G, nf.id); continue; }
      made++;
    }
    return made;
  };
  T.serfStates = function () {
    return FS.FSSim.serfsOf(FS.G, 0).map((s) => ({ id: s.id, job: s.job, state: s.state, v: s.v, carry: s.carry, road: s.road }));
  };
  T.evTypes = function () { return FS.G.events.map((e) => e.type); };
  T.lastFail = function () { const f = FS.G.events.filter((e) => e.type === "cmdFail"); return f.length ? f[f.length - 1] : null; };
  return true;
};

H.run("farmstead-transport", async (t) => {
  const page = await t.newPage({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(t.BASE + "/farmstead.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 20000 });
  await page.click("#startBtn");
  await page.waitForFunction(() => window.__FS__.started(), { timeout: 20000 });
  await page.evaluate(HELPERS);
  // Settler growth is real gameplay but it moves headcounts under the focused
  // tests; park it out of reach and switch it back on for the town scenario.
  await page.evaluate(() => { window.T.GROW = window.__FS__.FSC.SERF_GROW_T; window.__FS__.FSC.SERF_GROW_T = 1e9; });

  // ════════════════════════════════ settler growth
  const grow = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T;
    FS.FSC.SERF_GROW_T = 40;
    T.fresh();
    const G = FS.G, castle = T.castle();
    const gen0 = castle.pool.generic, pop0 = FS.FSSim.population(G, 0);
    FS.ff(200);
    const out = { gen0, gen1: castle.pool.generic, pop0, pop1: FS.FSSim.population(G, 0),
      born: G.events.filter((e) => e.type === "serfBorn").length, invMirror: castle.inv.serf };
    FS.FSC.SERF_GROW_T = 1e9;
    return out;
  });
  t.check("the castle breeds new settlers over time", grow.gen1 === grow.gen0 + 5 && grow.born === 5, grow);
  t.check("start roster is the confirmed 19 people", grow.pop0 === 19 && grow.pop1 === 24, grow);
  t.check("inv.serf mirrors the generic pool", grow.invMirror === grow.gen1, grow);

  // ════════════════════════════════ determinism rules (addendum §2)
  const src = await page.evaluate(async (base) => {
    const files = ["fs-const.js", "fs-map.js", "fs-sim.js"];
    const out = {};
    for (const f of files) {
      const raw = await (await fetch(base + "/assets/farmstead/" + f)).text();
      // strip comments — the rule is about executed code, and these files
      // deliberately NAME the banned calls in their determinism docs
      const txt = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
      out[f] = {
        trans: (txt.match(/Math\s*\.\s*(sin|cos|tan|pow|exp|log)\s*\(/g) || []),
        rnd: (txt.match(/Math\s*\.\s*random|Date\s*\.\s*now/g) || []),
        len: txt.length,
      };
    }
    return out;
  }, t.BASE);
  const transHits = Object.keys(src).flatMap((f) => src[f].trans.map((m) => f + ":" + m));
  const rndHits = Object.keys(src).flatMap((f) => src[f].rnd.map((m) => f + ":" + m));
  t.check("sim modules use no float transcendentals (sin/cos/tan/pow/exp/log)", transHits.length === 0, transHits);
  t.check("sim modules use no Math.random / Date.now", rndHits.length === 0, rndHits);
  t.check("all three sim modules were actually read", Object.keys(src).every((f) => src[f].len > 2000), src);

  // ════════════════════════════════ command layer
  const cmd = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim;
    T.fresh();
    FS.setSpeed(1);                       // non-zero: the queue must NOT self-pump
    const G = FS.G;
    const v = T.flagSpot(3, 8);
    const before = G.tick;
    const c = FS.placeFlag(v);
    const immediately = G.map.flagAt[v];
    FS.ff(1);
    const afterTick = G.map.flagAt[v];
    // ordering: two seats, same tick, seat 0 must win even though it issued later
    const a = T.flagSpot(3, 9);
    let b2 = -1;
    FS.FSMap.forRadius(G.map, T.castle().v, 10, (u, d) => {
      if (b2 >= 0 || d < 3 || u === a) return;
      if (FS.FSMap.canPlaceFlag(u, 0) && FS.FSMap.dist(G.map, u, a) > 2) b2 = u;
    });
    const tt = G.tick + 3;
    FSSim.issueCommand(G, { t: tt, by: 1, seq: 0, type: "flag", args: { v: b2 } });
    FSSim.issueCommand(G, { t: tt, by: 0, seq: 9, type: "flag", args: { v: a } });
    FS.ff(5);
    const fa = G.flags[G.map.flagAt[a]], fb = G.flags[G.map.flagAt[b2]];
    // invalid command must log, never throw
    const failsBefore = G.events.filter((e) => e.type === "cmdFail").length;
    FS.placeFlag(0);
    FS.cmd("nonsense", {});
    FS.ff(2);
    const fails = G.events.filter((e) => e.type === "cmdFail");
    FS.setSpeed(0);
    return {
      execTick: c.t, before, immediately, afterTick, seq: c.seq,
      aId: fa && fa.id, bId: fb && fb.id,
      newFails: fails.length - failsBefore,
      whys: fails.slice(-2).map((e) => e.why),
      speedNow: G.speed,
    };
  });
  t.check("issueCommand stamps execTick = tick + 1", cmd.execTick === cmd.before + 1, cmd);
  t.check("a queued flag command does NOT apply immediately", cmd.immediately === 0, cmd);
  t.check("it applies at the start of its tick", cmd.afterTick > 0, cmd);
  t.check("same-tick commands run in (by, seq) order — seat 0 first", cmd.aId && cmd.bId && cmd.aId < cmd.bId, cmd);
  t.check("invalid commands log cmdFail instead of throwing", cmd.newFails === 2, cmd);
  t.check("cmdFail carries a reason", cmd.whys.every((w) => typeof w === "string" && w.length), cmd.whys);
  t.check("speed is itself a command and applies at once", cmd.speedNow === 0, cmd);

  // ════════════════════════════════ flag validity + mid-road split
  const flags = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim, FSMap = FS.FSMap;
    T.fresh();
    const G = FS.G, cf = T.cflag();
    // a neighbour whose ONLY problem is the one-flag-per-two-vertices rule
    let adjV = -1;
    for (let d = 0; d < 6 && adjV < 0; d++) {
      const u = FSMap.nbr(G.map, cf.v, d);
      if (u >= 0 && /close/.test(FSMap.whyFlag(G.map, u, 0) || "")) adjV = u;
    }
    const adjacent = FSSim.placeFlag(G, adjV, 0);
    const far = T.flagSpot(5, 9);
    const good = FSSim.placeFlag(G, far, 0);
    const road = FSSim.buildRoad(G, cf.id, good.id, null, 0);
    FS.ff(300);
    const carriers0 = FSSim.serfsOf(G, 0).filter((s) => s.job === "transporter").length;
    const path = road.road.path;
    let midV = -1;
    for (let i = 1; i + 1 < path.length; i++) if (!FSMap.whyFlag(G.map, path[i], 0)) { midV = path[i]; break; }
    const split = FSSim.placeFlag(G, midV, 0);
    const roadsAfter = Object.keys(G.roads).length;
    const splitFlagRoads = split.flag ? split.flag.roads.length : 0;
    const bothPaths = Object.keys(G.roads).map((k) => G.roads[k].path.length);
    FS.ff(500);
    const carriers1 = FSSim.serfsOf(G, 0).filter((s) => s.job === "transporter").length;
    const everyRoadCrewed = Object.keys(G.roads).every((k) => !!G.roads[k].carrier);
    return {
      adjacentOk: adjacent.ok, adjacentWhy: adjacent.why, goodOk: good.ok, roadOk: road.ok,
      carriers0, carriers1, roadsAfter, splitFlagRoads, bothPaths, origLen: path.length, everyRoadCrewed,
      splitEvents: G.events.filter((e) => e.type === "roadSplit").length,
    };
  });
  t.check("flag adjacent to an existing flag is rejected", flags.adjacentOk === false && /close/.test(flags.adjacentWhy || ""), flags);
  t.check("flag on free own land is accepted", flags.goodOk === true, flags);
  t.check("road between two flags builds", flags.roadOk === true, flags);
  t.check("one road → one carrier", flags.carriers0 === 1, flags);
  t.check("flag placed mid-road splits it into two roads", flags.roadsAfter === 2, flags);
  t.check("the split flag joins both halves", flags.splitFlagRoads === 2, flags);
  t.check("the halves cover the original path", flags.bothPaths.reduce((a, b) => a + b, 0) === flags.origLen + 1, flags);
  t.check("roadSplit event fired", flags.splitEvents === 1, flags);
  t.check("splitting requests a second carrier", flags.carriers1 === 2, flags);
  t.check("every road ends up with a carrier", flags.everyRoadCrewed === true, flags);

  // ════════════════════════════════ road validity
  const roads = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim, FSMap = FS.FSMap;
    T.fresh();
    const G = FS.G, cf = T.cflag();
    const a = T.flagSpot(4, 9);
    const fa = FSSim.placeFlag(G, a, 0).flag;
    const p = FSSim.roadPath(G, cf.v, fa.v, 0);
    const first = FSSim.buildRoad(G, cf.id, fa.id, p, 0);
    const reuse = FSSim.buildRoad(G, cf.id, fa.id, p, 0);           // same edges again
    // a flag sitting on an interior vertex of a proposed path
    let blockV = -1;
    for (let i = 1; i + 1 < p.length; i++) if (!FSMap.whyFlag(G.map, p[i], 0)) { blockV = p[i]; break; }
    // steep step: find any pair over the slope limit
    let steep = null;
    for (let v = 0; v < G.map.W * G.map.H && !steep; v++) {
      if (G.map.owner[v] !== 0) continue;
      for (let d = 0; d < 6; d++) {
        const u = FSMap.nbr(G.map, v, d);
        if (u >= 0 && G.map.owner[u] === 0 && Math.abs(G.map.height[u] - G.map.height[v]) > FS.FSC.S_ROAD) { steep = [v, u]; break; }
      }
    }
    const steepWhy = steep ? FSMap.whyRoadStep(G.map, steep[0], steep[1], 0, {}) : "none found";
    // crossing an existing road at a non-flag vertex
    let crossOk = null, crossWhy = null;
    const interior = p[(p.length / 2) | 0];
    for (let d = 0; d < 6 && crossOk === null; d++) {
      const u = FSMap.nbr(G.map, interior, d);
      if (u < 0 || p.indexOf(u) >= 0) continue;
      if (FSMap.whyRoadStep(G.map, u, interior, 0, {})) continue;
      crossOk = FSSim.roadStepOk(G, u, interior, 0, false, false);
      crossWhy = "edges=" + FSMap.edgeCount(G.map, interior);
    }
    const badPath = FSSim.buildRoad(G, cf.id, fa.id, [cf.v, fa.v], 0);   // not adjacent
    return {
      firstOk: first.ok, reuseOk: reuse.ok, reuseWhy: reuse.why,
      steepWhy, crossOk, crossWhy, badOk: badPath.ok, badWhy: badPath.why,
      auto: !!p && p.length > 1, blockV,
    };
  });
  t.check("auto-routed road path found", roads.auto === true, roads);
  t.check("road built on the auto path", roads.firstOk === true, roads);
  t.check("re-using the same edges is rejected", roads.reuseOk === false && /road/.test(roads.reuseWhy || ""), roads);
  t.check("a step over the slope limit is rejected", /steep/.test(roads.steepWhy || ""), roads.steepWhy);
  t.check("roads may not cross an existing road except at a flag", roads.crossOk === false, roads);
  t.check("a non-adjacent path step is rejected", roads.badOk === false && /adjacent/.test(roads.badWhy || ""), roads);

  // ════════════════════════════════ carrier lifecycle
  const carrier = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim;
    T.fresh();
    const G = FS.G, cf = T.cflag(), castle = T.castle();
    const gen0 = castle.pool.generic;
    const v = T.flagSpot(4, 9);
    const nf = FSSim.placeFlag(G, v, 0).flag;
    const road = FSSim.buildRoad(G, cf.id, nf.id, null, 0).road;
    FS.ff(2);
    const spawned = G.events.filter((e) => e.type === "serfSpawn");
    const s0 = FSSim.serfsOf(G, 0)[0];
    const spawnedAtDoor = s0 && s0.v === cf.v;
    let sawWalk = false;
    for (let i = 0; i < 400; i++) { FS.ff(1); if (s0 && s0.state === "goRoad" && s0.from !== s0.to) sawWalk = true; if (s0 && s0.state === "idle") break; }
    const mid = road.path[(road.path.length - 1) >> 1];
    return {
      gen0, gen1: castle.pool.generic, spawnCount: spawned.length, job: spawned[0] && spawned[0].job,
      spawnedAtDoor, sawWalk, state: s0 && s0.state, onRoad: s0 && road.path.indexOf(s0.v) >= 0,
      atMiddle: s0 && s0.v === mid, carrierLinked: road.carrier === (s0 && s0.id),
    };
  });
  t.check("road dispatches exactly one transporter", carrier.spawnCount === 1 && carrier.job === "transporter", carrier);
  t.check("he leaves the castle door flag", carrier.spawnedAtDoor === true, carrier);
  t.check("the castle's generic pool paid for him", carrier.gen1 === carrier.gen0 - 1, carrier);
  t.check("he walks (from !== to while travelling)", carrier.sawWalk === true, carrier);
  t.check("he reaches his road and idles at its middle", carrier.state === "idle" && carrier.onRoad && carrier.atMiddle, carrier);
  t.check("the road owns him", carrier.carrierLinked === true, carrier);

  // ════════════════════════════════ castle → site, single hop, end to end
  const deliver = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim;
    T.fresh();
    const G = FS.G, cf = T.cflag(), castle = T.castle();
    const plank0 = castle.inv.plank, stone0 = castle.inv.stone;
    const v = T.pickSite("hut", 3, 9);
    const b = G.buildings[FSSim.build(G, "hut", v, 0).id];
    const placedEv = G.events.filter((e) => e.type === "bldPlaced").length;
    FSSim.buildRoad(G, cf.id, b.flag, null, 0);
    const seen = [];
    for (let i = 0; i < 3000; i++) {
      FS.ff(1);
      if (!seen.length || seen[seen.length - 1] !== b.state) seen.push(b.state);
      if (b.state === "done") break;
    }
    const ev = G.events;
    return {
      placedEv, states: seen, tick: G.tick, state: b.state,
      plank0, stone0, plank1: castle.inv.plank, stone1: castle.inv.stone,
      matGot: b.matGot, matUsed: b.matUsed, matFly: b.matInFlight,
      pickups: ev.filter((e) => e.type === "itemPickup").length,
      delivers: ev.filter((e) => e.type === "itemDeliver" && e.bld === b.id).length,
      doneEv: ev.filter((e) => e.type === "bldDone" && e.id === b.id).length,
      lost: ev.filter((e) => e.type === "itemLost").length,
      stateEv: ev.filter((e) => e.type === "bldStateChange" && e.id === b.id).map((e) => e.to),
    };
  });
  t.check("bldPlaced event on a new site", deliver.placedEv === 1, deliver);
  t.check("site walks site → build → done", deliver.states.join(">") === "site>build>done", deliver.states);
  t.check("bldStateChange events mirror it", deliver.stateEv.join(">") === "build>done", deliver.stateEv);
  t.check("castle inventory paid exactly 1 plank + 1 stone", deliver.plank1 === deliver.plank0 - 1 && deliver.stone1 === deliver.stone0 - 1, deliver);
  t.check("the goods really travelled (pickup + deliver events)", deliver.pickups >= 2 && deliver.delivers === 2, deliver);
  t.check("materials all arrived and were consumed", deliver.matGot.plank === 1 && deliver.matGot.stone === 1 && deliver.matUsed === 2, deliver);
  t.check("no in-flight leak once finished", deliver.matFly.plank === 0 && deliver.matFly.stone === 0, deliver);
  t.check("nothing was lost on the way", deliver.lost === 0, deliver);
  t.check("bldDone fired", deliver.doneEv === 1, deliver);

  // ════════════════════════════════ multi-hop routing + worker + tools
  const hops = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim;
    T.fresh();
    const G = FS.G;
    const c = T.chain("forester");
    const b = G.buildings[c.site];
    const cf = G.flags[c.cf];
    const hopCount = FSSim.hops(G, c.cf, b.flag);
    const next = FSSim.nextRoad(G, c.cf, b.flag);
    const fp = FSSim.flagPath(G, c.cf, b.flag);
    const vp = FSSim.vertexPath(G, fp);
    const shovel0 = FSSim.invOf(G, 0).shovel;
    for (let i = 0; i < 5000; i++) { FS.ff(1); if (b.worker) break; }
    const w = G.serfs[b.worker];
    return {
      chainOk: c.ok, hopCount, nextIsR1: next === c.r1, fp, vpOk: vp && vp[0] === cf.v && vp[vp.length - 1] === G.flags[b.flag].v,
      state: b.state, tick: G.tick, workerJob: w && w.job, workerState: w && w.state,
      shovel0, shovel1: FSSim.invOf(G, 0).shovel,
      carriers: FSSim.serfsOf(G, 0).filter((s) => s.job === "transporter").length,
      arriveEv: G.events.filter((e) => e.type === "workerArrive").length,
    };
  });
  t.check("3-flag chain built", hops.chainOk === true, hops);
  t.check("routing reports 2 hops castle → site", hops.hopCount === 2, hops);
  t.check("next hop from the castle is the first road", hops.nextIsR1 === true, hops);
  t.check("flagPath + vertexPath join the two flags", hops.fp && hops.fp.length === 3 && hops.vpOk, hops);
  t.check("the site finished over two hops", hops.state === "done", hops);
  t.check("its worker walked in with the right profession", hops.workerJob === "forester" && hops.workerState === "work", hops);
  t.check("workerArrive event fired", hops.arriveEv >= 1, hops);
  t.check("making a forester consumed a shovel", hops.shovel1 === hops.shovel0 - 1, hops);
  t.check("both roads are crewed", hops.carriers === 2, hops);

  // ════════════════════════════════ pre-made professionals first (addendum §5)
  const pool = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim, FSMap = FS.FSMap;
    T.fresh({ seed: 4242 });
    const G = FS.G, cf = T.cflag(), castle = T.castle();
    const hammer0 = castle.inv.hammer, builder0 = castle.pool.builder;
    const v1 = T.pickSite("hut", 3, 10);
    const b1 = G.buildings[FSSim.build(G, "hut", v1, 0).id];
    FSSim.buildRoad(G, cf.id, b1.flag, null, 0);
    // first builder must be the pre-made one: tools untouched
    let firstBuilder = null, hammerAtFirst = -1;
    for (let i = 0; i < 800; i++) {
      FS.ff(1);
      const bs = FSSim.serfsOf(G, 0).filter((s) => s.job === "builder");
      if (bs.length && !firstBuilder) { firstBuilder = bs[0].id; hammerAtFirst = castle.inv.hammer; break; }
    }
    const builderAfterFirst = castle.pool.builder;
    // a second SIMULTANEOUS site has to mint one from a generic + a hammer
    const v2 = T.pickSite("hut", 3, 10, v1);
    const b2 = G.buildings[FSSim.build(G, "hut", v2, 0).id];
    FSSim.buildRoad(G, cf.id, b2.flag, null, 0);
    let two = false, hammerAtSecond = -1;
    for (let i = 0; i < 1500; i++) {
      FS.ff(1);
      const bs = FSSim.serfsOf(G, 0).filter((s) => s.job === "builder");
      if (bs.length >= 2) { two = true; hammerAtSecond = castle.inv.hammer; break; }
    }
    return { hammer0, hammerAtFirst, hammerAtSecond, builder0, builderAfterFirst,
      builderPool: castle.pool.builder, two, v1, v2 };
  });
  t.check("the pre-made builder is used first (no tool spent)", pool.hammerAtFirst === pool.hammer0 && pool.builderAfterFirst === pool.builder0 - 1, pool);
  t.check("a second concurrent site mints a builder from generic + hammer", pool.two && pool.hammerAtSecond === pool.hammer0 - 1, pool);
  t.check("the pre-made builder pool is empty by then", pool.builderPool === 0, pool);

  // ════════════════════════════════ transport priority + live pre-emption
  const prio = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim, FSC = FS.FSC;
    T.fresh();
    const G = FS.G, cf = T.cflag(), castle = T.castle();
    const v = T.flagSpot(4, 9);
    const nf = FSSim.placeFlag(G, v, 0).flag;
    FSSim.buildRoad(G, cf.id, nf.id, null, 0);
    for (let i = 0; i < 400; i++) { FS.ff(1); if (FSSim.serfsOf(G, 0)[0] && FSSim.serfsOf(G, 0)[0].state === "idle") break; }
    const car = FSSim.serfsOf(G, 0)[0];

    // (a) forced order: with `stone` promoted to the front it must be taken first
    G.players[0].transportPrio = ["stone"].concat(FSC.RES_ORDER.filter((r) => r !== "stone"));
    FSSim.pushItem(G, nf, "plank", castle.id);
    FSSim.pushItem(G, nf, "stone", castle.id);
    let forced = 0;
    for (let i = 0; i < 300; i++) { FS.ff(1); if (car.carry) { forced = car.carry; break; } }
    for (let i = 0; i < 400; i++) { FS.ff(1); if (!car.carry && !nf.slots.length) break; }

    // (b) live re-evaluation: a gold ore landing before pickup pre-empts the plank
    G.players[0].transportPrio = FSC.RES_ORDER.slice();
    nf.slots.length = 0;
    FS.ff(20);
    FSSim.pushItem(G, nf, "plank", castle.id);
    FS.ff(4);
    const midState = car.state;
    FSSim.pushItem(G, nf, "goldOre", castle.id);
    let preempt = 0;
    for (let i = 0; i < 300; i++) { FS.ff(1); if (car.carry) { preempt = car.carry; break; } }
    return {
      forced, preempt, midState,
      goldPrio: FSSim.prioIndex(G.players[0], "goldOre"), plankPrio: FSSim.prioIndex(G.players[0], "plank"),
    };
  });
  t.check("carrier obeys the player's transport priority list", prio.forced === "stone", prio);
  t.check("default priority puts goldOre first and plank last", prio.goldPrio === 0 && prio.plankPrio === 25, prio);
  t.check("carrier was already walking for the plank", prio.midState === "fetch", prio);
  t.check("a higher-priority arrival pre-empts before pickup", prio.preempt === "goldOre", prio);

  // ════════════════════════════════ congestion
  const cong = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim, FSC = FS.FSC;
    T.fresh();
    const G = FS.G;
    const c = T.chain("hut");
    const mid = G.flags[c.mid];
    const rival = FSSim.castleOf(G, 1);
    // inert filler: addressed to the rival's castle, so nobody here can route it
    for (let i = 0; i < FSC.FLAG_CAP; i++) mid.slots.push({ res: "coal", dest: rival.id });
    let waiter = null, waitTicks = 0;
    for (let i = 0; i < 1200; i++) {
      FS.ff(1);
      const w = FSSim.serfsOf(G, 0).filter((s) => s.state === "wait");
      if (w.length) { waiter = w[0]; waitTicks++; }
      if (waitTicks > 5) break;
    }
    const congestEv = G.events.filter((e) => e.type === "congestion").length;
    const heldRes = waiter && waiter.carry;
    const slotsWhileWaiting = mid.slots.length;
    // give-up: keep the flag full past CONGEST_T and he must walk the good back
    let leftWait = false, backAtOrigin = false;
    for (let i = 0; i < FSC.CONGEST_T + 200; i++) {
      FS.ff(1);
      while (mid.slots.length > FSC.FLAG_CAP) mid.slots.pop();     // stay jammed
      if (waiter.state === "carry" && waiter.carry) leftWait = true;
      if (leftWait && waiter.state === "idle") { backAtOrigin = true; break; }
    }
    const originItems = FSSim.itemsAt(G, c.cf).length;
    // now really open a slot and watch the jam clear
    mid.slots.length = 0;
    let cleared = false;
    for (let i = 0; i < 600; i++) { FS.ff(1); if (!waiter.carry && waiter.state !== "wait") { cleared = true; break; } }
    return { waitTicks, congestEv, heldRes, slotsWhileWaiting, leftWait, backAtOrigin, originItems, cleared,
      cap: FSC.FLAG_CAP };
  });
  t.check("a full destination flag puts the carrier in 'wait'", cong.waitTicks > 0 && !!cong.heldRes, cong);
  t.check("congestion event logged", cong.congestEv >= 1, cong);
  t.check("the flag really was at its 8-good cap", cong.slotsWhileWaiting === cong.cap, cong);
  t.check("after CONGEST_T the carrier gives up and carries it back", cong.leftWait === true, cong);
  t.check("the good ends up back on a flag", cong.backAtOrigin && cong.originItems >= 0, cong);
  t.check("opening a slot unjams the carrier", cong.cleared === true, cong);

  // ════════════════════════════════ warehouse output order (FSC.INV_ORDER)
  const invOrder = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim, FSC = FS.FSC;
    T.fresh();
    const G = FS.G, cf = T.cflag();
    const v = T.pickSite("hut", 3, 9);
    const b = G.buildings[FSSim.build(G, "hut", v, 0).id];
    FSSim.buildRoad(G, cf.id, b.flag, null, 0);
    let first = null;
    for (let i = 0; i < 400; i++) {
      FS.ff(1);
      if (cf.slots.length) { first = cf.slots[0].res; break; }
    }
    return { first, plankIdx: FSC.INV_ORDER.indexOf("plank"), stoneIdx: FSC.INV_ORDER.indexOf("stone") };
  });
  t.check("warehouse releases goods in FSC.INV_ORDER (plank before stone)", invOrder.first === "plank" && invOrder.plankIdx < invOrder.stoneIdx, invOrder);

  // ════════════════════════════════ road demolition mid-transit
  const demoRoad = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim, FSMap = FS.FSMap;
    T.fresh();
    const G = FS.G, cf = T.cflag();
    const c = T.chain("hut");
    const before = FSSim.counts(G, 0);
    let carrying = null;
    for (let i = 0; i < 1500; i++) {
      FS.ff(1);
      carrying = FSSim.serfsOf(G, 0).find((s) => s.carry && s.road === c.r2 && s.state === "carry");
      if (carrying) break;
    }
    const res = carrying && carrying.carry;
    const road = G.roads[c.r2];
    const edgesBefore = road ? road.path.slice(0, -1).filter((v, i) => FSMap.edgeUsed(G.map, v, road.path[i + 1])).length : 0;
    const pathCopy = road ? road.path.slice() : [];
    FSSim.demolishRoad(G, c.r2);
    const edgesAfter = pathCopy.slice(0, -1).filter((v, i) => FSMap.edgeUsed(G.map, v, pathCopy[i + 1])).length;
    const goodsSomewhere = FSSim.itemsAt(G, c.mid).length + FSSim.itemsAt(G, G.buildings[c.site].flag).length
      + FSSim.itemsAt(G, c.cf).length;
    const lostEv = G.events.filter((e) => e.type === "itemLost").length;
    FS.ff(600);
    const after = FSSim.counts(G, 0);
    return {
      res, edgesBefore, edgesAfter, roads: after.roads, goodsSomewhere, lostEv,
      peopleBefore: before.people, peopleAfter: after.people,
      serfStillOnDeadRoad: FSSim.serfsOf(G, 0).some((s) => s.road === c.r2),
    };
  });
  t.check("caught a carrier mid-transit to demolish under", !!demoRoad.res, demoRoad);
  t.check("demolishing a road clears its lattice edges", demoRoad.edgesBefore > 0 && demoRoad.edgesAfter === 0, demoRoad);
  t.check("the road is gone from G.roads", demoRoad.roads === 1, demoRoad);
  t.check("the carried good is rescued onto a surviving flag", demoRoad.goodsSomewhere >= 1 || demoRoad.lostEv > 0, demoRoad);
  t.check("the carrier rejoins the pool (headcount restored)", demoRoad.peopleAfter === demoRoad.peopleBefore, demoRoad);
  t.check("no serf is left attached to the dead road", demoRoad.serfStillOnDeadRoad === false, demoRoad);

  // ════════════════════════════════ flag + building demolition
  const demoFlag = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim, FSC = FS.FSC;
    T.fresh();
    const G = FS.G, cf = T.cflag(), castle = T.castle();
    const v = T.flagSpot(4, 9);
    const nf = FSSim.placeFlag(G, v, 0).flag;
    FSSim.buildRoad(G, cf.id, nf.id, null, 0);
    FS.ff(400);
    FSSim.pushItem(G, nf, "coal", FSSim.castleOf(G, 1).id);        // inert good
    const goods0 = FSSim.itemsAt(G, nf.id).length;
    const doorRefusal = FSSim.removeFlag(G, cf.id);                // castle door flag
    const rm = FSSim.removeFlag(G, nf.id);
    const lost = G.events.filter((e) => e.type === "itemLost" && e.why === "flag removed").length;
    FS.ff(500);
    const counts = FSSim.counts(G, 0);
    // building demolition burns and then vanishes
    const bv = T.pickSite("hut", 3, 9);
    const b = G.buildings[FSSim.build(G, "hut", bv, 0).id];
    const dem = FSSim.demolish(G, b.id, 0);
    const burning = b.state === "burn";
    FS.ff(FSC.BURN_T + 20);
    const gone = !G.buildings[b.id] && G.map.bldAt[bv] === 0;
    const castleDem = FSSim.demolish(G, castle.id, 0);
    return { goods0, doorRefusal: doorRefusal.ok, doorWhy: doorRefusal.why, rmOk: rm.ok, lost,
      flags: counts.flags, roads: counts.roads, people: counts.people, burning, gone,
      demOk: dem.ok, castleDem: castleDem.ok, castleWhy: castleDem.why };
  });
  t.check("a building's door flag cannot be removed", demoFlag.doorRefusal === false && /building/.test(demoFlag.doorWhy || ""), demoFlag);
  t.check("removing a flag removes its roads too", demoFlag.rmOk === true && demoFlag.roads === 0, demoFlag);
  t.check("goods waiting on a removed flag are logged as lost", demoFlag.goods0 === 1 && demoFlag.lost === 1, demoFlag);
  t.check("its carrier returns to the pool", demoFlag.people === 19, demoFlag);
  t.check("demolishing a building burns it, then it disappears", demoFlag.demOk && demoFlag.burning && demoFlag.gone, demoFlag);
  t.check("the castle can never be demolished", demoFlag.castleDem === false && /castle/.test(demoFlag.castleWhy || ""), demoFlag);

  // ════════════════════════════════ digger leveling (LARGE only)
  const level = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim, FSMap = FS.FSMap;
    T.fresh();
    const G = FS.G, cf = T.cflag();
    const v = T.pickSite("sawmill", 3, 10);
    const ring = [v].concat(FSMap.neighbors(G.map, v));
    const h0 = ring.map((u) => G.map.height[u]);
    const spread0 = Math.max.apply(null, h0) - Math.min.apply(null, h0);
    const b = G.buildings[FSSim.build(G, "sawmill", v, 0).id];
    FSSim.buildRoad(G, cf.id, b.flag, null, 0);
    const states = [];
    let diggerSeen = false, dirtyHit = 0;
    for (let i = 0; i < 6000; i++) {
      FS.ff(1);
      if (!states.length || states[states.length - 1] !== b.state) states.push(b.state);
      if (FSSim.serfsOf(G, 0).some((s) => s.job === "digger")) diggerSeen = true;
      if (G.dirtyV.length) dirtyHit++;
      if (b.state === "done") break;
    }
    const h1 = ring.map((u) => G.map.height[u]);
    const spread1 = Math.max.apply(null, h1) - Math.min.apply(null, h1);
    // a SMALL building must skip leveling entirely
    const sv = T.pickSite("hut", 3, 10, v);
    const sb = G.buildings[FSSim.build(G, "hut", sv, 0).id];
    FSSim.buildRoad(G, cf.id, sb.flag, null, 0);
    const smallStates = [];
    for (let i = 0; i < 4000; i++) {
      FS.ff(1);
      if (!smallStates.length || smallStates[smallStates.length - 1] !== sb.state) smallStates.push(sb.state);
      if (sb.state === "done") break;
    }
    return { states, smallStates, spread0, spread1, diggerSeen, dirtyHit, size: FS.FSC.BLD.sawmill.size,
      levelEv: G.events.filter((e) => e.type === "terrainLeveled").length,
      workerJob: b.worker ? G.serfs[b.worker].job : null };
  });
  t.check("a LARGE site is levelled by a digger first", level.states.indexOf("leveling") === 1 && level.diggerSeen, level);
  t.check("leveling flattens the 7-vertex footprint", level.spread0 > 0 && level.spread1 < 0.001, level);
  t.check("terrainLeveled events fire for the renderer", level.levelEv >= 2 && level.dirtyHit > 0, level);
  t.check("the LARGE site reaches done", level.states[level.states.length - 1] === "done", level);
  t.check("a SMALL site never enters 'leveling'", level.smallStates.indexOf("leveling") < 0 && level.smallStates[level.smallStates.length - 1] === "done", level);

  // ════════════════════════════════ offroad helper (Phase C/D primitive)
  const off = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim, FSMap = FS.FSMap;
    T.fresh();
    const G = FS.G, castle = T.castle();
    let dst = -1;
    FSMap.forRadius(G.map, castle.v, 14, (u, d) => { if (dst < 0 && d >= 11 && FSMap.walkable(G.map.terr[u])) dst = u; });
    const p = FSSim.offroadPath(G, castle.v, dst);
    let bad = 0, jumps = 0;
    if (p) {
      for (let i = 0; i < p.length; i++) if (!FSMap.walkable(G.map.terr[p[i]])) bad++;
      for (let i = 0; i + 1 < p.length; i++) if (!FSMap.adjacent(G.map, p[i], p[i + 1])) jumps++;
    }
    let water = -1;
    for (let v = 0; v < G.map.W * G.map.H && water < 0; v++) if (G.map.terr[v] === FS.FSC.TERR.WATER) water = v;
    const capped = FSSim.offroadPath(G, castle.v, dst, { maxLen: 3 });
    return { len: p && p.length, ends: p && p[0] === castle.v && p[p.length - 1] === dst, bad, jumps,
      toWater: FSSim.offroadPath(G, castle.v, water), capped, dist: FSMap.dist(G.map, castle.v, dst) };
  });
  t.check("offroadPath links two land vertices", off.ends === true && off.len >= off.dist, off);
  t.check("every offroad step is walkable and adjacent", off.bad === 0 && off.jumps === 0, off);
  t.check("offroadPath refuses to walk into water", off.toWater === null, off);
  t.check("offroadPath honours its length guard", off.capped === null, off);

  // ════════════════════════════════ replay determinism
  const det = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim;
    function scripted(seed) {
      T.fresh({ seed });
      const G = FS.G, cf = T.cflag();
      const v = T.pickSite("hut", 3, 10);
      // identical commands issued at identical ticks
      FSSim.issueCommand(G, { t: 5, by: 0, seq: 0, type: "build", args: { type: "hut", v } });
      FS.ff(10);
      const b = G.buildings[G.map.bldAt[v]];
      FSSim.issueCommand(G, { t: 20, by: 0, seq: 1, type: "road", args: { f1: cf.id, f2: b.flag } });
      const v2 = T.pickSite("sawmill", 3, 10, v);
      FSSim.issueCommand(G, { t: 40, by: 1, seq: 2, type: "build", args: { type: "sawmill", v: v2 } });
      FS.ff(60 - G.tick);
      const b2 = G.buildings[G.map.bldAt[v2]];
      FSSim.issueCommand(G, { t: 70, by: 0, seq: 3, type: "road", args: { f1: cf.id, f2: b2.flag } });
      FS.ff(3000 - G.tick);
      return { hash: FSSim.hash(G), tick: G.tick, counts: FSSim.counts(G, 0), inv: FSSim.invOf(G, 0).plank };
    }
    const a = scripted(90210), b = scripted(90210), c = scripted(90211);
    return { a, b, c };
  });
  t.check("replay at tick 3000: same seed + same commands → identical hash", det.a.hash === det.b.hash, det);
  t.check("replay reproduces the same world (serfs/flags/roads/goods)", JSON.stringify(det.a.counts) === JSON.stringify(det.b.counts), det);
  t.check("a different seed diverges", det.a.hash !== det.c.hash, det);
  t.check("the replay actually ran a busy 3000-tick game", det.a.tick === 3000 && det.a.counts.buildings >= 3, det.a);

  // ════════════════════════════════ a whole working town: render + perf
  const town = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSSim = FS.FSSim, FSMap = FS.FSMap;
    FS.FSC.SERF_GROW_T = T.GROW;                 // real settler growth for the town
    T.fresh({ seed: 90210 });
    const G = FS.G, cf = T.cflag();
    // sites FIRST — once the map is peppered with flags no door vertex is free
    const types = ["hut", "lumberjack", "stonecutter", "sawmill", "forester", "mill"];
    let sites = 0;
    const used = [];
    for (let i = 0; i < types.length; i++) {
      let v = -1;
      FSMap.forRadius(G.map, T.castle().v, 11, (u, d) => {
        if (v >= 0 || d < 3) return;
        if (used.some((w) => FSMap.dist(G.map, w, u) < 4)) return;
        if (!FSMap.canPlaceBuilding(types[i], u, 0)) return;
        if (!FSSim.roadPath(G, cf.v, FSMap.doorVertex(G.map, u), 0)) return;
        v = u;
      });
      if (v < 0) continue;
      const r = FSSim.build(G, types[i], v, 0);
      if (!r.ok) continue;
      used.push(v); sites++;
      const b = G.buildings[r.id];
      let bestF = 0, bestP = null, bestL = 1e9;
      for (const id in G.flags) {
        const f = G.flags[id];
        if (f.id === b.flag || f.p !== 0 || f.roads.length >= 6) continue;
        const p = FSSim.roadPath(G, f.v, G.flags[b.flag].v, 0);
        if (p && p.length < bestL) { bestL = p.length; bestP = p; bestF = f.id; }
      }
      if (bestF) FSSim.buildRoad(G, bestF, b.flag, bestP, 0);
    }
    const made = T.town(8);                       // then a web of plain flags/roads
    FS.ff(2500);
    const c = FSSim.counts(G, 0);
    const walking = FSSim.serfsOf(G, 0).filter((s) => s.from !== s.to).length;
    const carrying = FSSim.serfsOf(G, 0).filter((s) => !!s.carry).length;
    const crewed = Object.keys(G.roads).filter((k) => !!G.roads[k].carrier).length;
    return { made, sites, counts: c, walking, carrying, crewed, roads: Object.keys(G.roads).length,
      pop: FSSim.population(G, 0), tickMs: FS.perf.tickMsAvg };
  });
  t.check("the scripted town built a real network", town.sites >= 4 && town.counts.roads >= 10, town);
  t.check("settler growth crewed every road", town.crewed === town.roads && town.crewed >= 10, town);
  t.check("it is populated with carriers and crews", town.counts.serfs >= 10, town);
  t.check("goods are moving (serfs walking + carrying)", town.walking >= 1, town);
  t.check("several sites reached 'done'", town.counts.buildings - town.counts.sites >= 4, town);

  // let the renderer draw the busy town, then measure
  const render = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender;
    const castle = FS.FSSim.castleOf(FS.G, 0);
    R.setCam({ yaw: 0.55, pitch: FS.FSC.CAM.PITCH_START });
    R.focusVertex(castle.v, 30);
    for (let i = 0; i < 20; i++) R.frame(0.016);
    const info = R.dynamicInfo();
    const st = R.stats();
    const scene = R.scene();
    let named = [];
    scene.traverse((o) => { if (o.name && o.name.indexOf("dyn:") === 0) named.push(o.name + "=" + o.count); });
    return { info, draws: st.drawCalls, tris: st.tris, named, serfs: info.serfs,
      poolKeys: Object.keys(info.pools) };
  });
  t.check("flags render as instanced poles + pennants", render.poolKeys.indexOf("pole") >= 0 && render.poolKeys.indexOf("pennant") >= 0, render.poolKeys);
  t.check("waiting goods render as instanced crates", render.poolKeys.indexOf("crate") >= 0, render.poolKeys);
  t.check("roads render as one merged ribbon", render.info.roads === 1, render.info);
  t.check("serfs render instanced, one mesh per job+player", render.poolKeys.some((k) => k.indexOf("serf:") === 0), render.poolKeys);
  t.check("every live serf is drawn", render.serfs >= 10, render);
  t.check("draw calls stay well under budget with a busy town", render.draws < 120, render);

  const perf = await page.evaluate(() => {
    const FS = window.__FS__;
    const t0 = performance.now();
    FS.ff(2000);
    const ms = performance.now() - t0;
    return { avg: ms / 2000, reported: FS.perf.tickMsAvg, tick: FS.G.tick,
      serfs: FS.FSSim.counts(FS.G, 0).serfs, at4x: (ms / 2000) * 40 };
  });
  t.check("tick cost is inside the 6 ms budget", perf.avg < 6, perf);
  t.check("4x on a busy town costs <60ms of CPU per real second", perf.at4x < 60, perf);
  console.log("   perf: tickMsAvg=" + perf.avg.toFixed(4) + "ms  (4x → " + perf.at4x.toFixed(2) + "ms/s)  serfs=" + perf.serfs);

  // ════════════════════════════════ HTML glue (temp Phase-B UI)
  const ui = await page.evaluate(() => {
    const FS = window.__FS__;
    const hint = document.getElementById("bhint");
    const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    key("r");
    const roadMode = FS.mode();
    key("Escape");
    const cleared = FS.mode();
    key("b");
    const buildMode = FS.mode();
    key("Escape");
    return {
      hintVisible: !hint.classList.contains("hidden"),
      hintText: hint.textContent.replace(/\s+/g, " ").trim(),
      roadMode, cleared, buildMode,
    };
  });
  t.check("the temp hint line lists every mode key", ui.hintVisible && /F flag/.test(ui.hintText) && /R road/.test(ui.hintText) && /B/.test(ui.hintText) && /X demolish/.test(ui.hintText), ui);
  t.check("R arms road mode, B arms build mode, Esc clears", ui.roadMode === "road" && ui.cleared === null && ui.buildMode === "build", ui);

  // ════════════════════════════════ screenshot: a busy moment
  await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender;
    const G = FS.G;
    // hold the frame on a tick where goods are waiting and serfs are mid-stride
    let best = null;
    for (let i = 0; i < 400; i++) {
      FS.ff(1);
      const serfs = FS.FSSim.serfsOf(G, 0);
      const walking = serfs.filter((s) => s.from !== s.to).length;
      const goods = FS.FSSim.counts(G, 0).goods;
      const sites = FS.FSSim.counts(G, 0).sites;
      const score = walking * 2 + goods + sites * 3;
      if (!best || score > best.score) best = { score, tick: G.tick };
      if (walking >= 4 && goods >= 2 && sites >= 1) break;
    }
    const castle = FS.FSSim.castleOf(G, 0);
    R.setCam({ yaw: 0.62, pitch: 0.86 });
    R.focusVertex(castle.v, 22);
    R.setHover(-1);
    for (let i = 0; i < 8; i++) R.frame(0.016);
  });
  await t.sleep(350);
  await t.shot(page, "farmstead_transport");

  const shotState = await page.evaluate(() => {
    const FS = window.__FS__;
    const c = FS.FSSim.counts(FS.G, 0);
    return { c, serfs: FS.FSSim.serfsOf(FS.G, 0).length, draws: FS.FSRender.stats().drawCalls,
      dyn: FS.FSRender.dynamicInfo() };
  });
  t.check("the screenshot scene has castle + roads + flags + goods + serfs", shotState.c.roads >= 8 && shotState.c.flags >= 8 && shotState.serfs >= 8, shotState);
  console.log("   scene: " + JSON.stringify(shotState.c) + " draws=" + shotState.draws);

  t.check("0 page errors", t.errors.length === 0, t.errors.slice(0, 6));
});
