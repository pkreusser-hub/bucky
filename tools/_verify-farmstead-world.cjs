#!/usr/bin/env node
"use strict";
/**
 * FARMSTEAD — Phase A world suite.
 * Covers: boot + title, map-gen determinism, terrain invariants, lattice math,
 * placement validity, picking accuracy, camera clamps, speed/pause/visibility,
 * render smoke + budgets. Screenshots into shots/.
 *
 *   node tools/_verify-farmstead-world.cjs
 */
const H = require("./_fs_harness.cjs");

H.run("farmstead-world", async (t) => {
  const page = await t.newPage({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(t.BASE + "/farmstead.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 20000 });

  // ───────────────────────────────────────────────────── boot / title screen
  const boot = await page.evaluate(() => ({
    titleVisible: !document.getElementById("title").classList.contains("hidden"),
    logo: document.querySelector(".logo").textContent.trim(),
    sub: document.querySelector(".sub").textContent.trim(),
    started: window.__FS__.started(),
    sizes: [].map.call(document.querySelectorAll("#sizeSeg button"), (b) => b.dataset.size),
    ais: [].map.call(document.querySelectorAll("#aiSeg button"), (b) => b.dataset.ai),
    seed: document.getElementById("seed").value,
    hasCanvas: !!document.getElementById("view"),
  }));
  t.check("title screen visible before start", boot.titleVisible);
  t.check("title reads FARMSTEAD", /FARMSTEAD/.test(boot.logo), boot.logo);
  t.check("subtitle build · connect · defend", /build .* connect .* defend/.test(boot.sub), boot.sub);
  t.check("map size options small/medium/large", boot.sizes.join(",") === "small,medium,large", boot.sizes);
  t.check("AI count options 1-3", boot.ais.join(",") === "1,2,3", boot.ais);
  t.check("random seed prefilled", /^\d{6}$/.test(boot.seed), boot.seed);
  t.check("no game before START", boot.started === false);

  // ───────────────────────────────────────────────────── START
  await page.click("#startBtn");
  await page.waitForFunction(() => window.__FS__.started(), { timeout: 20000 });
  await t.sleep(1500);
  const afterStart = await page.evaluate(() => {
    const G = window.__FS__.G, st = window.__FS__.FSRender.stats();
    return {
      titleHidden: document.getElementById("title").classList.contains("hidden"),
      W: G.map.W, players: G.players.length, tick: G.tick, speed: G.speed,
      frames: st.frames, draws: st.drawCalls, tris: st.tris,
      terrainMs: st.terrainMs, worldMs: st.worldMs,
      objects: window.__FS__.FSRender.objectCount(),
      canvasW: document.getElementById("view").width,
    };
  });
  t.check("START hides the title screen", afterStart.titleHidden);
  t.check("medium map is 64 wide", afterStart.W === 64, afterStart.W);
  t.check("1 human + 1 AI seated", afterStart.players === 2, afterStart.players);
  // headless swiftshader renders ~5 fps at 1280x800 — assert liveness, never absolute fps
  t.check("render loop is drawing", afterStart.frames >= 2 && afterStart.draws > 3, afterStart);
  t.check("sim clock is advancing at 1x", afterStart.tick >= 1, afterStart.tick);
  t.check("canvas sized to the viewport", afterStart.canvasW >= 1280, afterStart.canvasW);
  t.check("world objects instanced", afterStart.objects > 50, afterStart.objects);
  t.check("terrain build < 200ms", afterStart.terrainMs < 200, afterStart.terrainMs);
  t.check("world draw calls < 120", afterStart.draws < 120, afterStart.draws);

  // ───────────────────────────────────────────────────── determinism
  const det = await page.evaluate(() => {
    const a = (window.__FS__.newGame({ size: "medium", seed: 4242, ais: 2 }), window.__FS__.mapHash());
    const startsA = window.__FS__.G.map.starts.join(",");
    const b = (window.__FS__.newGame({ size: "medium", seed: 4242, ais: 2 }), window.__FS__.mapHash());
    const startsB = window.__FS__.G.map.starts.join(",");
    const c = (window.__FS__.newGame({ size: "medium", seed: 4243, ais: 2 }), window.__FS__.mapHash());
    return { a, b, c, startsA, startsB };
  });
  t.check("same seed -> identical map hash", det.a === det.b, det);
  t.check("same seed -> identical start sites", det.startsA === det.startsB, det);
  t.check("different seed -> different map", det.a !== det.c, det);

  // ───────────────────────────────────────────────────── terrain invariants
  const inv = await page.evaluate(() => {
    const FS = window.__FS__;
    FS.newGame({ size: "medium", seed: 90210, ais: 3 });
    const G = FS.G, map = G.map, FSC = FS.FSC, FSMap = FS.FSMap, T = FSC.TERR, N = map.W * map.H;
    let mineralOffMountain = 0, fishOnLand = 0, treeOffGrass = 0, stoneOffGrass = 0;
    let borderNotWater = 0, borderNotDeep = 0, mineralTotal = 0, fishTotal = 0;
    for (let r = 0; r < map.H; r++) {
      for (let c = 0; c < map.W; c++) {
        const v = r * map.W + c;
        if (map.mineral[v]) { mineralTotal++; if (map.terr[v] !== T.MOUNTAIN) mineralOffMountain++; }
        if (map.fish[v]) { fishTotal++; if (map.terr[v] !== T.WATER) fishOnLand++; }
        const o = map.obj[v];
        if (FSMap.isTree(o) && map.terr[v] !== T.GRASS) treeOffGrass++;
        if (FSMap.isStone(o) && map.terr[v] !== T.GRASS) stoneOffGrass++;
        if (Math.min(r, c, map.H - 1 - r, map.W - 1 - c) < 2) {
          if (map.terr[v] !== T.WATER) borderNotWater++;
          if (map.height[v] > -1) borderNotDeep++;
        }
      }
    }
    const starts = map.starts.map((v) => ({
      v, terr: map.terr[v], spread: FSMap.heightSpread(map, v, 1),
      castleOk: map.bldAt[v] !== 0, ownerOk: map.owner[v] >= 0,
    }));
    return { mineralOffMountain, fishOnLand, treeOffGrass, stoneOffGrass, borderNotWater, borderNotDeep,
      mineralTotal, fishTotal, starts, sLarge: FSC.S_LARGE, players: G.players.length };
  });
  t.check("minerals exist", inv.mineralTotal > 20, inv.mineralTotal);
  t.check("minerals only under MOUNTAIN", inv.mineralOffMountain === 0, inv.mineralOffMountain);
  t.check("fish stocks exist", inv.fishTotal > 20, inv.fishTotal);
  t.check("fish only on WATER", inv.fishOnLand === 0, inv.fishOnLand);
  t.check("trees only on GRASS", inv.treeOffGrass === 0, inv.treeOffGrass);
  t.check("stone piles only on GRASS", inv.stoneOffGrass === 0, inv.stoneOffGrass);
  t.check("border ring >=2 is WATER", inv.borderNotWater === 0, inv.borderNotWater);
  t.check("border water is deep", inv.borderNotDeep === 0, inv.borderNotDeep);
  t.check("4 players seated on 4 start sites", inv.starts.length === 4, inv.starts.length);
  t.check("every start is GRASS", inv.starts.every((s) => s.terr === 1), inv.starts);
  t.check("every start is castle-flat", inv.starts.every((s) => s.spread <= inv.sLarge), inv.starts);
  t.check("every start has its castle + territory", inv.starts.every((s) => s.castleOk && s.ownerOk), inv.starts);

  // ───────────────────────────────────────────────────── lattice math
  const lat = await page.evaluate(() => {
    const FS = window.__FS__, map = FS.G.map, FSMap = FS.FSMap, FSC = FS.FSC;
    let symBad = 0, offBad = 0, oppBad = 0;
    for (let i = 0; i < 600; i++) {
      const v = ((i * 7919) % (map.W * map.H));
      const ns = FSMap.neighbors(v);
      if (ns.length > 6) symBad++;
      for (const u of ns) if (FSMap.neighbors(u).indexOf(v) < 0) symBad++;
      for (let d = 0; d < 6; d++) {
        const u = FSMap.nbr(v, d);
        if (u >= 0 && FSMap.nbr(u, FSMap.OPP[d]) !== v) oppBad++;
      }
    }
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const p = FSMap.worldXZ(r * map.W + c);
        if (Math.abs(p[0] - (c + (r & 1) * 0.5) * FSC.TILE) > 1e-9) offBad++;
        if (Math.abs(p[1] - r * FSC.TILE * FSC.ROW_Z) > 1e-9) offBad++;
      }
    }
    const v0 = 40 * map.W + 30;
    const nb = FSMap.neighbors(v0);
    const distOne = nb.every((u) => FSMap.dist(v0, u) === 1);
    // edge bitmask: E is owned by v, W is owned by the neighbour
    const e = FSMap.nbr(v0, "E"), w = FSMap.nbr(v0, "W");
    const before = FSMap.edgeUsed(v0, e);
    FSMap.setEdge(v0, e, true);
    const afterE = FSMap.edgeUsed(v0, e) && FSMap.edgeUsed(e, v0);
    FSMap.setEdge(v0, w, true);
    const afterW = FSMap.edgeUsed(v0, w) && FSMap.edgeUsed(w, v0);
    const cnt = FSMap.edgeCount(v0);
    FSMap.setEdge(v0, e, false); FSMap.setEdge(v0, w, false);
    const cleared = !FSMap.edgeUsed(v0, e) && !FSMap.edgeUsed(v0, w) && FSMap.edgeCount(v0) === 0;
    const edgeOnly = map.roadAt[v0] === 0 && map.roadAt[w] === 0;
    return { symBad, offBad, oppBad, distOne, selfZero: FSMap.dist(v0, v0) === 0,
      symmetricDist: FSMap.dist(v0, 100) === FSMap.dist(100, v0),
      before, afterE, afterW, cnt, cleared, edgeOnly };
  });
  t.check("neighbours are symmetric (b in N(a) <=> a in N(b))", lat.symBad === 0, lat.symBad);
  t.check("opposite directions round-trip", lat.oppBad === 0, lat.oppBad);
  t.check("worldXZ odd-row offset + row spacing", lat.offBad === 0, lat.offBad);
  t.check("dist: self 0, neighbours 1, symmetric", lat.selfZero && lat.distOne && lat.symmetricDist, lat);
  t.check("edge bitmask set/read from both ends", !lat.before && lat.afterE && lat.afterW && lat.cnt === 2, lat);
  t.check("edge bitmask clears", lat.cleared && lat.edgeOnly, lat);

  // ───────────────────────────────────────────────────── placement validity
  const val = await page.evaluate(() => {
    const FS = window.__FS__, G = FS.G, map = G.map, FSMap = FS.FSMap, T = FS.FSC.TERR;
    const castle = G.buildings[G.players[0].castleId];
    const door = G.flags[castle.flag].v;
    // an empty own-land vertex that is not next to the door flag
    let free = -1;
    FSMap.forRadius(map, castle.v, 8, (u, d) => {
      if (free >= 0 || d < 3) return;
      if (FSMap.canPlaceFlag(u, 0)) free = u;
    });
    // an unowned vertex
    let unowned = -1;
    for (let v = 0; v < map.W * map.H && unowned < 0; v++) {
      if (map.owner[v] === -1 && map.terr[v] === T.GRASS) unowned = v;
    }
    // an owned mountain (ownership temporarily granted so the mine-vs-farm terrain
    // rules can be tested without a military building up there)
    let mtn = -1;
    for (let v = 0; v < map.W * map.H && mtn < 0; v++) {
      if (map.terr[v] !== T.MOUNTAIN) continue;
      const ring = FSMap.neighbors(v);
      if (ring.length !== 6) continue;
      if (ring.some((u) => map.terr[u] === T.WATER)) continue;
      const dv = FSMap.doorVertex(v);
      if (dv < 0 || !FSMap.flaggable(map.terr[dv]) || FSMap.objBlocks(map.obj[dv])) continue;
      mtn = v;
    }
    const grant = [mtn].concat(FSMap.neighbors(mtn));
    const prevOwner = grant.map((u) => map.owner[u]);
    grant.forEach((u) => { map.owner[u] = 0; });
    const mineOnMountain = FSMap.canPlaceBuilding("coalMine", mtn, 0);
    const whyMine = FSMap.whyBuilding("coalMine", mtn, 0);
    const farmOnMountain = FSMap.canPlaceBuilding("farm", mtn, 0);
    grant.forEach((u, i) => { map.owner[u] = prevOwner[i]; });

    const nextToDoor = FSMap.nbr(door, "E");
    const res = {
      flagOnCastleVertex: FSMap.canPlaceFlag(castle.v, 0),
      flagOnDoorVertex: FSMap.canPlaceFlag(door, 0),
      flagNextToFlag: FSMap.canPlaceFlag(nextToDoor, 0),
      flagOnFree: free >= 0 && FSMap.canPlaceFlag(free, 0),
      flagUnowned: FSMap.canPlaceFlag(unowned, 0),
      bldOnCastleVertex: FSMap.canPlaceBuilding("hut", castle.v, 0),
      bldUnowned: FSMap.canPlaceBuilding("hut", unowned, 0),
      mineOnGrass: FSMap.canPlaceBuilding("coalMine", free, 0),
      mineOnMountain, farmOnMountain, whyMine,
      whyMineOnGrass: FSMap.whyBuilding("coalMine", free, 0),
      free, unowned, mtn,
    };
    // road steps
    const a = free, b = FSMap.nbr(free, "E");
    res.roadOk = FSMap.canBuildRoadStep(a, b, 0);
    FSMap.setEdge(a, b, true);
    res.roadReuse = FSMap.canBuildRoadStep(a, b, 0);
    FSMap.setEdge(a, b, false);
    let water = -1;
    for (let v = 0; v < map.W * map.H && water < 0; v++) {
      if (map.terr[v] !== T.WATER) continue;
      for (const u of FSMap.neighbors(v)) if (map.owner[u] === 0) { water = v; res.shore = u; }
    }
    res.roadIntoWater = water >= 0 ? FSMap.canBuildRoadStep(res.shore, water, 0) : null;
    res.roadUnowned = FSMap.canBuildRoadStep(unowned, FSMap.nbr(unowned, "E"), 0);
    return res;
  });
  t.check("canPlaceFlag: castle vertex blocked", val.flagOnCastleVertex === false);
  t.check("canPlaceFlag: existing flag vertex blocked", val.flagOnDoorVertex === false);
  t.check("canPlaceFlag: adjacent to a flag blocked", val.flagNextToFlag === false);
  t.check("canPlaceFlag: free own-land vertex allowed", val.flagOnFree === true, val.free);
  t.check("canPlaceFlag: outside own land blocked", val.flagUnowned === false);
  t.check("canPlaceBuilding: castle vertex blocked", val.bldOnCastleVertex === false);
  t.check("canPlaceBuilding: outside own land blocked", val.bldUnowned === false);
  t.check("canPlaceBuilding: mine needs mountain", val.mineOnGrass === false && /mountain/i.test(val.whyMineOnGrass || ""), val.whyMineOnGrass);
  t.check("canPlaceBuilding: mine allowed on mountain", val.mineOnMountain === true, val.whyMine);
  t.check("canPlaceBuilding: mountain blocks a farm", val.farmOnMountain === false);
  t.check("canBuildRoadStep: valid own-land step", val.roadOk === true);
  t.check("canBuildRoadStep: used edge rejected", val.roadReuse === false);
  t.check("canBuildRoadStep: into water rejected", val.roadIntoWater === false, val.roadIntoWater);
  t.check("canBuildRoadStep: outside own land rejected", val.roadUnowned === false);

  // ───────────────────────────────────────────────────── picking accuracy
  const pick = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSMap = FS.FSMap;
    const castle = FS.G.buildings[FS.G.players[0].castleId];
    R.focusVertex(castle.v, 26);
    R.frame(0.016);
    const out = [];
    function probe(v) {
      const s = R.vertexScreen(v);
      if (!s.inView) return out.push({ v, got: "offscreen" });
      out.push({ v, got: R.pickVertex(s.x, s.y), d: 0 });
    }
    probe(castle.v);
    probe(FSMap.nbr(castle.v, "E"));
    probe(FSMap.nbr(FSMap.nbr(castle.v, "NW"), "NW"));
    // and again after an orbit + zoom
    R.setCam({ yaw: R.camState().yaw + 1.1, dist: 15, pitch: 0.85 });
    R.frame(0.016);
    const zoomed = [];
    [castle.v, FSMap.nbr(castle.v, "SE"), FSMap.nbr(castle.v, "W")].forEach((v) => {
      const s = R.vertexScreen(v);
      zoomed.push({ v, got: s.inView ? R.pickVertex(s.x, s.y) : "offscreen" });
    });
    const off = R.pickVertex(2, 2);          // sky / far corner
    return { out, zoomed, off };
  });
  const hits = pick.out.filter((o) => o.got === o.v).length;
  const zhits = pick.zoomed.filter((o) => o.got === o.v).length;
  t.check("pickVertex returns the projected vertex (3 probes)", hits === 3, pick.out);
  t.check("pickVertex still exact after orbit + zoom (3 probes)", zhits === 3, pick.zoomed);
  t.check("pickVertex returns -1 off the terrain", pick.off === -1, pick.off);

  // ───────────────────────────────────────────────────── camera clamps
  const camc = await page.evaluate(() => {
    const R = window.__FS__.FSRender, CAM = window.__FS__.FSC.CAM;
    const zin = R.setCam({ dist: 0.5 }).dist;
    const zout = R.setCam({ dist: 5000 }).dist;
    const pLo = R.setCam({ pitch: -1 }).pitch;
    const pHi = R.setCam({ pitch: 3 }).pitch;
    R.setCam({ dist: CAM.DIST_START, pitch: CAM.PITCH_START });
    return { zin, zout, pLo, pHi, min: CAM.DIST_MIN, max: CAM.DIST_MAX, pmin: CAM.PITCH_MIN, pmax: CAM.PITCH_MAX };
  });
  t.check("camera zoom clamped to min", camc.zin === camc.min, camc);
  t.check("camera zoom clamped to max", camc.zout === camc.max, camc);
  t.check("camera pitch clamped 35deg..70deg", camc.pLo === camc.pmin && camc.pHi === camc.pmax, camc);

  // ───────────────────────────────────────────────────── speed / pause / hidden
  const speed = await page.evaluate(() => {
    const FS = window.__FS__;
    FS.setSpeed(1);
    const t0 = FS.G.tick;
    const t1 = FS.ff(50);
    const key = (k, code) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: code || ("Digit" + k), bubbles: true }));
    key("2");
    const sp2 = FS.G.speed;
    key("3");
    const sp4 = FS.G.speed;
    key("1");
    const sp1 = FS.G.speed;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
    const paused = FS.G.speed;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
    const resumed = FS.G.speed;
    return { delta: t1 - t0, sp1, sp2, sp4, paused, resumed, tag: document.getElementById("speedTag").textContent };
  });
  t.check("ff(50) advances the tick counter by exactly 50", speed.delta === 50, speed.delta);
  t.check("key 2 sets speed 2x", speed.sp2 === 2, speed);
  t.check("key 3 sets speed 4x", speed.sp4 === 4, speed);
  t.check("key 1 sets speed 1x", speed.sp1 === 1, speed);
  t.check("Space pauses and restores", speed.paused === 0 && speed.resumed === 1, speed);

  const vis = await page.evaluate(async () => {
    const FS = window.__FS__;
    FS.setSpeed(2);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    const hidden = FS.G.speed;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    const back = FS.G.speed;
    FS.setSpeed(1);
    return { hidden, back };
  });
  t.check("page hidden auto-pauses", vis.hidden === 0, vis);
  t.check("page visible restores the speed", vis.back === 2, vis);

  // ───────────────────────────────────────────────────── render smoke + budget
  const smoke = await page.evaluate(() => {
    const R = window.__FS__.FSRender;
    const before = R.stats().frames;
    for (let i = 0; i < 60; i++) R.frame(0.016);
    const st = R.stats();
    // a single-vertex refresh must not disturb the pools
    const FS = window.__FS__, map = FS.G.map, OBJ = FS.FSC.OBJ;
    let tree = -1;
    for (let v = 0; v < map.W * map.H && tree < 0; v++) if (map.obj[v] === OBJ.TREE4) tree = v;
    const n0 = R.objectCount();
    map.obj[tree] = OBJ.STUMP; R.refreshVertex(tree);
    const n1 = R.objectCount();
    map.obj[tree] = OBJ.NONE; R.refreshVertex(tree);
    const n2 = R.objectCount();
    map.obj[tree] = OBJ.TREE4; R.refreshVertex(tree);
    R.frame(0.016);
    return { frames: st.frames - before, draws: st.drawCalls, tris: st.tris, n0, n1, n2,
      pools: Object.keys(R.poolInfo()).length };
  });
  // (the page's own rAF loop may slip in a frame or two while evaluate runs)
  t.check("60-frame render smoke advanced >=60 frames", smoke.frames >= 60 && smoke.frames <= 66, smoke.frames);
  t.check("draw calls stay under 120 after 60 frames", smoke.draws < 120, smoke.draws);
  t.check("refreshVertex swaps an object kind in place", smoke.n0 === smoke.n1 && smoke.n2 === smoke.n0 - 1, smoke);

  // ───────────────────────────────────────────────────── model builder API
  const mdl = await page.evaluate(() => {
    const FSModels = window.__FS__.FSModels;
    function tris(o) {
      let n = 0;
      o.traverse((c) => { if (c.geometry && c.geometry.attributes.position) n += c.geometry.attributes.position.count / 3; });
      return n;
    }
    const out = { types: {}, colors: [] };
    ["hut", "sawmill", "farm", "coalMine", "stock"].forEach((ty) => {
      const g = FSModels.placeholderBuilding(ty);
      out.types[ty] = { tris: tris(g), children: g.children.length };
    });
    for (let i = 0; i < 4; i++) out.colors.push(FSModels.playerColor(i));
    out.wrapped = FSModels.playerColor(5) === FSModels.playerColor(1);
    out.sign = tris(FSModels.signPost(window.__FS__.FSC.MINERAL.GOLD));
    out.kinds = Object.keys(FSModels.objectKinds()).length;
    return out;
  });
  t.check("placeholderBuilding builds every size class", Object.keys(mdl.types).every((k) => mdl.types[k].tris > 20 && mdl.types[k].tris < 400), mdl.types);
  t.check("playerColor covers 4 players and wraps", mdl.colors.length === 4 && new Set(mdl.colors).size === 4 && mdl.wrapped, mdl.colors);
  t.check("signPost + object kind registry build", mdl.sign > 8 && mdl.kinds >= 20, mdl);

  // ───────────────────────────────────────────────────── screenshots
  await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender;
    const castle = FS.G.buildings[FS.G.players[0].castleId];
    R.setCam({ yaw: 0.55, pitch: FS.FSC.CAM.PITCH_START });
    R.focusVertex(castle.v, 46);
    R.setHover(-1);
    for (let i = 0; i < 4; i++) R.frame(0.016);
  });
  await t.sleep(300);
  await t.shot(page, "farmstead_world");

  await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender;
    const castle = FS.G.buildings[FS.G.players[0].castleId];
    R.focusVertex(castle.v, 15);
    R.setCam({ yaw: 0.9, pitch: 0.72 });
    R.setHover(FS.FSMap.nbr(castle.v, "W"));
    for (let i = 0; i < 4; i++) R.frame(0.016);
  });
  await t.sleep(300);
  await t.shot(page, "farmstead_world_close");

  // ───────────────────────────────────────────────────── large map + errors
  const large = await page.evaluate(() => {
    const FS = window.__FS__;
    const t0 = performance.now();
    FS.newGame({ size: "large", seed: 31337, ais: 3 });
    const ms = performance.now() - t0;
    const R = FS.FSRender;
    for (let i = 0; i < 10; i++) R.frame(0.016);
    return { ms, W: FS.G.G === undefined ? FS.G.map.W : 0, draws: R.stats().drawCalls,
      terrainMs: R.stats().terrainMs, objects: R.objectCount(), tick: FS.ff(10) };
  });
  t.check("large map is 96 wide", large.W === 96, large.W);
  t.check("large map terrain build < 200ms", large.terrainMs < 200, large.terrainMs);
  t.check("large map draw calls < 120", large.draws < 120, large.draws);
  t.check("large map still ticks", large.tick === 10, large.tick);

  t.check("0 page errors", t.errors.length === 0, t.errors.slice(0, 5));
});
