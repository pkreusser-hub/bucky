#!/usr/bin/env node
"use strict";
/**
 * FARMSTEAD — Phase V visuals suite.
 *
 * Phase V is an ART phase, so most of the judging is done by eye on the hero
 * screenshots. What CAN be asserted mechanically is asserted here: that every
 * look layer actually exists and is wired to the right data, that the meadow
 * is torn up when the settlement claims ground, that the water FX animate and
 * that the fish really do care how many fish are in the water, that the charm
 * pass on the buildings is present and inside its triangle budget, that the
 * serfs are still ONE instanced mesh per (job, player), and that none of it
 * costs draw calls, frame time or memory it should not.
 *
 *   node tools/_verify-farmstead-visuals.cjs
 */
const H = require("./_fs_harness.cjs");

H.run("farmstead-visuals", async (t) => {
  const page = await t.newPage({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(t.BASE + "/farmstead.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 20000 });
  await page.evaluate(() => {
    window.__FS__.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    window.__FS__.FSRender.setQuality(1);          // judge the real thing, not the CI thinning
    for (let i = 0; i < 4; i++) window.__FS__.FSRender.frame(0.033);
  });

  // ════════════════════════════════════════════════════ 1. the look layers
  const layers = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, sc = R.scene();
    const names = ["sky", "terrain", "water", "watershimmer", "foam", "sparkle", "objects", "decor", "buildings", "dynamic", "fx"];
    const found = {};
    names.forEach((n) => { const o = sc.getObjectByName(n); found[n] = !!o; });
    const terr = sc.getObjectByName("terrain");
    const water = sc.getObjectByName("water");
    const sky = sc.getObjectByName("sky");
    let dirLights = 0, hemi = 0;
    sc.traverse((o) => { if (o.isDirectionalLight) dirLights++; if (o.isHemisphereLight) hemi++; });
    return {
      found: found,
      terrHasMap: !!(terr && terr.material.map),
      terrHasUV: !!(terr && terr.geometry.attributes.uv),
      terrVertexColors: !!(terr && terr.material.vertexColors),
      waterAlpha: !!(water && water.geometry.attributes.color && water.geometry.attributes.color.itemSize === 4),
      waterHasMap: !!(water && water.material.map),
      skyVertexColors: !!(sky && sky.material.vertexColors),
      skyOrder: sky ? sky.renderOrder : -1,
      fogColor: sc.fog ? sc.fog.color.getHex() : 0,
      fogFar: sc.fog ? sc.fog.far : 0,
      dirLights, hemi,
    };
  });
  t.check("every look layer is in the scene",
    Object.keys(layers.found).every((k) => layers.found[k]), layers.found);
  t.check("terrain carries the blade sheet on world-tiled uv",
    layers.terrHasMap && layers.terrHasUV && layers.terrVertexColors, layers);
  t.check("water is one mesh with per-vertex depth ALPHA + a ripple map",
    layers.waterAlpha && layers.waterHasMap, layers);
  t.check("the sky is a vertex-coloured dome drawn last (depth-rejected under the world)",
    layers.skyVertexColors && layers.skyOrder > 0, layers);
  t.check("warm fog reaches into the distance", layers.fogFar >= 300 && layers.fogColor !== 0, layers);
  t.check("key light + cool fill + hemisphere", layers.dirLights === 2 && layers.hemi === 1, layers);

  // ════════════════════════════════════════════════════ 2. the meadow layer
  // PHASE-F ART DIRECTION (2026-07-31): the instanced tuft-clump layer reads
  // "too visually busy" and is now DISABLED BY DEFAULT (FSC.VIS.TUFT_PER_
  // VERTEX===0 — see fs-const.js). This section is split in two: (a) proves
  // the SHIPPED default really does spend nothing on tufts (no pools at all),
  // and (b) temporarily flips the constant back on inside the browser (never
  // touching the source file) to prove the removal is a clean toggle, not a
  // deletion — the old density/flower/claim-hook assertions still run for
  // real against that re-enabled world, then the constant is restored.
  const meadowOff = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, map = FS.G.map;
    const d = R.decorInfo();
    let grassV = 0;
    for (let v = 0; v < map.W * map.H; v++) if (map.terr[v] === FSC.TERR.GRASS) grassV++;
    return { pools: Object.keys(d), tuftPerVertex: FSC.VIS.TUFT_PER_VERTEX,
      flowers: d.flower ? d.flower.live : 0, shadows: d.shadow ? d.shadow.live : 0,
      scree: d.scree ? d.scree.live : 0, grassV, quality: R.quality() };
  });
  t.check("shipped default: TUFT_PER_VERTEX is 0 (tufts off)", meadowOff.tuftPerVertex === 0, meadowOff);
  t.check("shipped default: NO tuft pools exist at all (zero alloc, zero per-frame breeze cost)",
    ["tuft0", "tuft1", "tuft2"].every((k) => meadowOff.pools.indexOf(k) < 0), meadowOff.pools);
  t.check("shipped default: wildflowers still exist, independent of tufts, and are sparse not everywhere",
    meadowOff.flowers > 10 && meadowOff.flowers < meadowOff.grassV * 0.3, meadowOff);
  t.check("shipped default: every standing object still drops a contact shadow", meadowOff.shadows > 40, meadowOff);
  t.check("shipped default: bare mountain still grows scree", meadowOff.scree > 10, meadowOff);

  // (b) the re-enable path: flip FSC.VIS.TUFT_PER_VERTEX back on for a fresh
  // world (in-browser only — the shipped source stays 0) and prove the whole
  // mechanism — density, flower co-existence, and the claim/removal hook —
  // still works exactly as Phase V built it.
  const meadowOn = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap, map0 = FS.G.map;
    FSC.VIS.TUFT_PER_VERTEX = 6;             // re-enable, in-memory only
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    R.setQuality(1);
    for (let i = 0; i < 4; i++) R.frame(0.033);
    const map = FS.G.map;
    const d = R.decorInfo();
    let grassV = 0, tufts = 0;
    for (let v = 0; v < map.W * map.H; v++) if (map.terr[v] === FSC.TERR.GRASS) grassV++;
    for (const k in d) if (k.indexOf("tuft") === 0) tufts += d[k].live;
    return { pools: Object.keys(d), tufts, flowers: d.flower ? d.flower.live : 0,
      grassV, perGrass: +(tufts / Math.max(1, grassV)).toFixed(2) };
  });
  t.check("re-enabled: tuft pools exist again", ["tuft0", "tuft1", "tuft2"].every((k) => meadowOn.pools.indexOf(k) >= 0), meadowOn.pools);
  t.check("re-enabled: the meadow is dense again — around a tuft clump per grass vertex or better",
    meadowOn.perGrass >= 0.9, meadowOn);
  t.check("re-enabled: wildflowers still co-exist and stay sparse",
    meadowOn.flowers > 10 && meadowOn.flowers < meadowOn.tufts * 0.5, meadowOn);

  // a road through open meadow must TAKE the grass with it (refreshVertex hook)
  // — exercised against the RE-ENABLED world so there is real density to tear up.
  const claim = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap, map = FS.G.map;
    function total() {
      const d = R.decorInfo();
      let n = 0;
      for (const k in d) if (k.indexOf("tuft") === 0) n += d[k].live;
      return n;
    }
    // pick a run of open grass with no object, flag, building or road on it
    let seed = -1;
    for (let v = 0; v < map.W * map.H && seed < 0; v++) {
      if (map.terr[v] !== FSC.TERR.GRASS || map.obj[v] || map.flagAt[v] || map.bldAt[v]) continue;
      let ok = true;
      FSMap.forRadius(map, v, 1, (u) => {
        if (map.terr[u] !== FSC.TERR.GRASS || map.obj[u] || map.flagAt[u] || map.bldAt[u]) ok = false;
      });
      if (ok) seed = v;
    }
    const before = total();
    // 1. an OBJECT claiming the vertex (a field is sown here)
    map.obj[seed] = FSC.OBJ.FIELD2;
    R.refreshVertex(seed);
    const afterField = total();
    map.obj[seed] = FSC.OBJ.NONE;
    R.refreshVertex(seed);
    const restored = total();
    // 2. a ROAD claiming it — roads never go through refreshVertex, the renderer
    //    diffs them itself, so this exercises the other half of the hook
    let d0 = 0, u0 = -1;
    for (d0 = 0; d0 < 6 && u0 < 0; d0++) u0 = FSMap.nbr(map, seed, d0);
    FSMap.setEdge(map, seed, u0, true);
    FS.G.roads[9999] = { id: 9999, path: [seed, u0], p: 0, water: false };
    FS.G.routeGen = (FS.G.routeGen || 0) + 1;
    R.frame(0.033);
    const afterRoad = total();
    delete FS.G.roads[9999];
    FSMap.setEdge(map, seed, u0, false);
    FS.G.routeGen++;
    R.frame(0.033);
    const afterRemoved = total();
    return { seed, u0, before, afterField, restored, afterRoad, afterRemoved };
  });
  t.check("sowing a field over open grass removes that vertex's tufts",
    claim.afterField < claim.before, claim);
  t.check("clearing it grows them straight back", claim.restored === claim.before, claim);
  t.check("building a road through the meadow tears up the grass under it",
    claim.afterRoad < claim.before, claim);
  t.check("pulling the road up lets the grass return", claim.afterRemoved === claim.before, claim);

  // restore the shipped default before the rest of the suite (draw-call
  // budgets etc. below are meant to measure the REAL player experience).
  await page.evaluate(() => {
    const FS = window.__FS__;
    FS.FSC.VIS.TUFT_PER_VERTEX = 0;
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    FS.FSRender.setQuality(1);
    for (let i = 0; i < 4; i++) FS.FSRender.frame(0.033);
    /* ===== PHASE-F test-hygiene note: sections 3/4 below reuse THIS G/FSFX
     * instance (they don't call their own newGame) and section 4's fish-pool-
     * leak check counts ANY live fish, injected or ambient. The extra newGame()
     * calls this re-enable/restore probe added (vs. the pre-Phase-F suite,
     * which made none in section 2) shift FSFX's own ambient spawn-timer
     * phase enough that an unrelated natural jump could coincidentally still
     * be airborne when section 4 starts measuring — not a leak, just a
     * different roll of FSFX's own timer. Drain to a clean slate (bounded)
     * so sections 3/4 start from the same "nothing airborne" baseline the
     * original suite always had, regardless of how many newGame calls ran
     * before it. ===== */
    for (let i = 0; i < 60 && window.FSFX.info().fish > 0; i++) FS.FSRender.frame(0.033);
  });

  // ════════════════════════════════════════════════════ 3. the water is alive
  const water = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, sc = R.scene();
    const sh = sc.getObjectByName("watershimmer");
    const foam = sc.getObjectByName("foam");
    const spark = sc.getObjectByName("sparkle");
    function snap() {
      const c = foam && foam.instanceColor ? foam.instanceColor.array.slice(0, 60) : null;
      const s = spark ? spark.instanceMatrix.array.slice(0, 64) : null;
      return {
        off: sh ? [sh.material.map.offset.x, sh.material.map.offset.y] : null,
        op: sh ? sh.material.opacity : 0,
        foam: c ? Array.prototype.slice.call(c) : null,
        spark: s ? Array.prototype.slice.call(s) : null,
      };
    }
    const a = snap();
    for (let i = 0; i < 30; i++) R.frame(0.033);
    const b = snap();
    const moved = a.off && (Math.abs(a.off[0] - b.off[0]) > 1e-4 || Math.abs(a.off[1] - b.off[1]) > 1e-4);
    const opChanged = Math.abs(a.op - b.op) > 1e-4;
    let foamChanged = false, sparkChanged = false;
    if (a.foam && b.foam) for (let i = 0; i < a.foam.length; i++) if (Math.abs(a.foam[i] - b.foam[i]) > 1e-3) foamChanged = true;
    if (a.spark && b.spark) for (let i = 0; i < a.spark.length; i++) if (Math.abs(a.spark[i] - b.spark[i]) > 1e-3) sparkChanged = true;
    return { moved, opChanged, foamChanged, sparkChanged,
      foamN: foam ? foam.count : 0, sparkN: spark ? spark.count : 0 };
  });
  t.check("the shimmer sheet scrolls across the water", water.moved, water);
  t.check("…and breathes on a sine so it never reads as a sliding tile", water.opChanged, water);
  t.check("shoreline surf is drawn and pulses", water.foamN > 20 && water.foamChanged, water);
  t.check("sun glints twinkle on open water", water.sparkN > 20 && water.sparkChanged, water);

  // ════════════════════════════════════════════════════ 4. fish, and the stock
  const fish = await page.evaluate(async () => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, map = FS.G.map, FSFX = window.FSFX;
    // a rich vertex and a fished-out one, both open water
    let rich = -1, dead = -1;
    for (let v = 0; v < map.W * map.H; v++) {
      if (map.terr[v] !== FSC.TERR.WATER) continue;
      let wet = 0;
      for (let d = 0; d < 6; d++) { const u = FS.FSMap.nbr(map, v, d); if (u >= 0 && map.terr[u] === FSC.TERR.WATER) wet++; }
      if (wet < 4) continue;
      if (rich < 0) rich = v; else if (dead < 0) dead = v;
      if (rich >= 0 && dead >= 0) break;
    }
    map.fish[rich] = FSC.GEN.FISH_MAX;
    map.fish[dead] = 0;
    const oddsRich = FSFX.fishOdds(rich), oddsDead = FSFX.fishOdds(dead);
    // deterministic injection: the jump machinery itself, not the spawn dice
    const before = FSFX.info().fish;
    FSFX.spawnFish(rich);
    const spawned = FSFX.info();
    let peak = 0, sawRing = spawned.rings > 0;
    for (let i = 0; i < 40; i++) {
      R.frame(0.033);
      const inf = FSFX.info();
      if (inf.rings > 0) sawRing = true;
      const m = R.scene().getObjectByName("fx").getObjectByName("fx:fish");
      if (m && m.count > 0) peak = Math.max(peak, m.instanceMatrix.array[13]);
    }
    let drops = 0;
    for (let i = 0; i < 12; i++) { R.frame(0.033); drops = Math.max(drops, FSFX.info().drops); }
    const after = FSFX.info();
    return { oddsRich, oddsDead, before, spawnedN: spawned.fish, peak: +peak.toFixed(2),
      sawRing, drops, gone: after.fish - before, waterCand: after.waterCand, pools: after.pools };
  });
  t.check("a jump can be injected deterministically", fish.spawnedN === fish.before + 1, fish);
  t.check("the fish leaves the water on an arc", fish.peak > 0.4, fish);
  t.check("it lands with a splash ring and droplets", fish.sawRing && fish.drops > 0, fish);
  t.check("and the jump ends (the pool does not leak)", fish.gone <= 0, fish);
  t.check("rich water is livelier than dead water", fish.oddsRich > 0.5 && fish.oddsDead === 0, fish);
  t.check("open-water jump sites were found across the map", fish.waterCand > 50, fish);
  t.check("FX pools cover fish, splash, droplets, birds, butterflies, leaves and dust",
    ["fish", "ring", "drop", "bird", "fly", "leaf", "dust"].every((k) => fish.pools.indexOf(k) >= 0), fish.pools);

  // ════════════════════════════════════════════════════ 5. building charm
  const blds = await page.evaluate(() => {
    const FS = window.__FS__, FSC = FS.FSC, M = FS.FSModels;
    const out = { max: 0, textured: 0, withProps: 0, chimneys: [], noProps: [], n: 0 };
    for (const ty of FSC.BLD_LIST.concat(["castle"])) {
      const d = M.buildingDetail(ty);
      out.n++;
      out.max = Math.max(out.max, d.tris);
      if (d.textured) out.textured++;
      if (d.props && d.props.length >= 3) out.withProps++; else out.noProps.push(ty);
      if (d.chimney) out.chimneys.push(ty);
    }
    out.budget = FSC.VIS.BLD_TRI_MAX;
    out.atlasCells = Object.keys(M.ATLAS_CELLS).length;
    return out;
  });
  t.check("every building is drawn from the shared material atlas",
    blds.textured === blds.n && blds.atlasCells >= 12, blds);
  t.check("every type carries at least three of its own props",
    blds.withProps === blds.n, blds.noProps);
  t.check("the producers that use fire have chimneys",
    ["bakery", "smelter", "goldsmelter", "weaponsmith", "toolmaker", "butcher"].every((k) => blds.chimneys.indexOf(k) >= 0), blds.chimneys);
  t.check("and every model still fits FSC.VIS.BLD_TRI_MAX", blds.max <= blds.budget, blds);

  // smoke only while the chimney is actually working
  const smoke = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap, FSSim = FS.FSSim;
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    R.setQuality(1);
    const G = FS.G, castle = FSSim.castleOf(G, 0);
    let a = -1, b = -1;
    FSMap.forRadius(G.map, castle.v, 10, (v, d) => {
      if (d < 3 || !FSMap.canPlaceBuilding(G.map, "bakery", v, 0)) return;
      if (a < 0) a = v; else if (b < 0 && FSMap.dist(G.map, v, a) > 3) b = v;
    });
    const r1 = FSSim.build(G, "bakery", a, 0), r2 = FSSim.build(G, "bakery", b, 0);
    FSSim.forceComplete(G, r1.id); FSSim.forceComplete(G, r2.id);
    const B1 = G.buildings[r1.id], B2 = G.buildings[r2.id];
    B1.working = false; B2.working = false;
    for (let i = 0; i < 4; i++) R.frame(0.033);
    const idle = (R.dynamicInfo().pools.smoke || { count: 0 }).count;
    B1.working = true; B2.working = true;
    for (let i = 0; i < 4; i++) R.frame(0.033);
    const busy = (R.dynamicInfo().pools.smoke || { count: 0 }).count;
    return { idle, busy };
  });
  t.check("an idle chimney is cold", smoke.idle === 0, smoke);
  t.check("a working one smokes", smoke.busy >= 5, smoke);

  // ════════════════════════════════════════════════════ 6. people stay instanced
  const people = await page.evaluate(() => {
    const FS = window.__FS__, FSC = FS.FSC, M = FS.FSModels;
    const tris = (g) => g.attributes.position.count / 3;
    const serf = tris(M.serfGeo(FSC.JOB.LUMBERJACK, 0));
    const carrier = tris(M.serfGeo(FSC.JOB.TRANSPORTER, 0));
    const knight = tris(M.knightGeo(3, 0));
    // the same (job, player) must return the SAME cached geometry object
    const same = M.serfGeo(FSC.JOB.LUMBERJACK, 0) === M.serfGeo(FSC.JOB.LUMBERJACK, 0);
    const diffJob = M.serfGeo(FSC.JOB.FARMER, 0) !== M.serfGeo(FSC.JOB.LUMBERJACK, 0);
    const diffPlayer = M.serfGeo(FSC.JOB.LUMBERJACK, 1) !== M.serfGeo(FSC.JOB.LUMBERJACK, 0);
    const diffRank = M.knightGeo(0, 0) !== M.knightGeo(3, 0);
    return { serf, carrier, knight, same, diffJob, diffPlayer, diffRank };
  });
  t.check("a serf is one merged mesh per (job, player), cached",
    people.same && people.diffJob && people.diffPlayer, people);
  t.check("knights differ by rank as well", people.diffRank, people);
  t.check("a serf stays a minifig (~300 tris) and a knight is not much more",
    people.serf > 180 && people.serf < 400 && people.knight < 700, people);
  t.check("carriers get their own silhouette (the pack)", people.carrier !== people.serf, people);

  // 40 workers on screen must not blow the draw budget
  const crowd = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender;
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    R.setQuality(1);
    FS.setSpeed(1); FS.ff(4000);
    for (let i = 0; i < 5; i++) R.frame(0.033);
    return { serfs: Object.keys(FS.G.serfs).length, drawn: R.dynamicInfo().serfs, draws: R.stats().drawCalls };
  });
  t.check("a working settlement stays far under the draw budget",
    crowd.serfs >= 8 && crowd.drawn >= 1 && crowd.draws < 200, crowd);

  // ════════════════════════════════════════════════════ 7. budgets
  const budget = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSSim = FS.FSSim, FSMap = FS.FSMap;
    FS.newGame({ size: "large", seed: 31337, ais: 3, speed: 0 });
    R.setQuality(1);
    const G = FS.G;
    // a busy developed town: everything the economy can put on screen
    const castle = FSSim.castleOf(G, 0);
    const used = [];
    ["lumberjack", "sawmill", "forester", "farm", "mill", "bakery", "stonecutter", "pigfarm",
      "butcher", "toolmaker", "smelter", "stock", "hut", "weaponsmith", "fisher", "boatwright",
      "coalMine", "ironMine", "tower"].forEach((ty) => {
      let best = -1;
      FSMap.forRadius(G.map, castle.v, 16, (v, d) => {
        if (d < 3 || best >= 0) return;
        if (used.some((w) => FSMap.dist(G.map, w, v) < 3)) return;
        if (!FSMap.canPlaceBuilding(G.map, ty, v, 0)) return;
        best = v;
      });
      if (best < 0) return;
      const r = FSSim.build(G, ty, best, 0);
      if (r.ok) { used.push(best); FSSim.forceComplete(G, r.id); G.buildings[r.id].working = true; }
    });
    FS.ff(1500);
    R.focusVertex(castle.v, 26);
    R.setCam({ pitch: 0.85, yaw: 0.6 });
    let fxMs = 0;
    // warm up first: the FIRST frame of a new world is where FSFX builds its
    // pools and scans the map, and that one-off is not a per-frame budget item
    for (let i = 0; i < 6; i++) R.frame(0.033);
    for (let i = 0; i < 30; i++) { R.frame(0.033); fxMs = Math.max(fxMs, window.FSFX.info().ms); }
    const dense = { draws: R.stats().drawCalls, tris: R.stats().tris, fxMs: +fxMs.toFixed(2),
      blds: Object.keys(G.buildings).length };
    // …and zoomed all the way out
    R.setCam({ dist: FSC.CAM.DIST_MAX, pitch: 1.1 });
    for (let i = 0; i < 6; i++) R.frame(0.033);
    dense.farDraws = R.stats().drawCalls;
    dense.farTris = R.stats().tris;
    dense.farTufts = (function () {
      const g = R.scene().getObjectByName("decor");
      let vis = 0;
      g.children.forEach((m) => { if (m.name.indexOf("tuft") >= 0 && m.visible) vis++; });
      return vis;
    })();
    // an empty map for the floor
    FS.newGame({ size: "medium", seed: 555, ais: 1, speed: 0 });
    R.setQuality(1);
    for (let i = 0; i < 6; i++) R.frame(0.033);
    dense.emptyDraws = R.stats().drawCalls;
    dense.emptyTris = R.stats().tris;
    return dense;
  });
  t.check("draw calls in a dense developed town stay under 900", budget.draws < 900, budget);
  t.check("…and comfortably under the world suite's own 120 ceiling too", budget.draws < 120, budget);
  t.check("zoomed all the way out the meadow drops out and the triangle count falls",
    budget.farTufts === 0 && budget.farTris < budget.tris, budget);
  t.check("an empty map is cheap", budget.emptyDraws < 60, budget);
  t.check("FSFX.frame stays inside its 1.5ms steady-state budget", budget.fxMs <= 1.5, budget);

  // ════════════════════════════════════════════════════ 8. memory stability
  const mem = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender;
    function snap() {
      for (let i = 0; i < 3; i++) R.frame(0.033);
      const m = R.renderer().info.memory;
      return { g: m.geometries, t: m.textures };
    }
    FS.newGame({ size: "medium", seed: 4242, ais: 1, speed: 0 });
    const a = snap();
    FS.newGame({ size: "medium", seed: 4243, ais: 1, speed: 0 });
    FS.newGame({ size: "medium", seed: 4244, ais: 1, speed: 0 });
    FS.newGame({ size: "medium", seed: 4242, ais: 1, speed: 0 });
    const b = snap();
    return { a, b, dg: b.g - a.g, dt: b.t - a.t };
  });
  t.check("geometry count returns to baseline across newGame x3 (+-10%)",
    Math.abs(mem.dg) <= Math.max(4, mem.a.g * 0.10), mem);
  t.check("texture count is stable across newGame x3", Math.abs(mem.dt) <= 1, mem);

  // rebuildAll (save/load + co-op resync) must bring the look layers back
  const rebuilt = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender;
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    R.setQuality(1);
    FS.ff(600);
    const before = R.decorInfo();
    const ok = FS.save("visualtest") && FS.load("visualtest");
    R.setQuality(1);
    for (let i = 0; i < 4; i++) R.frame(0.033);
    const sc = R.scene();
    const after = R.decorInfo();
    let t0 = 0, t1 = 0;
    for (const k in before) if (k.indexOf("tuft") === 0) t0 += before[k].live;
    for (const k in after) if (k.indexOf("tuft") === 0) t1 += after[k].live;
    try { localStorage.removeItem("fs_save_visualtest"); } catch (e) { /* noop */ }
    return { ok, t0, t1, f0: before.flower ? before.flower.live : 0, f1: after.flower ? after.flower.live : 0,
      layers: ["sky", "terrain", "water", "foam", "decor", "fx"].filter((n) => !!sc.getObjectByName(n)).length };
  });
  t.check("save/load rebuilds every look layer", rebuilt.ok && rebuilt.layers === 6, rebuilt);
  /* ===== PHASE-F: tufts default OFF, so t0/t1 are legitimately both 0 (still
   * asserted equal — proves rebuild doesn't spontaneously create any); the
   * now-independent wildflower layer is the one that must survive a rebuild
   * at the same density (mirrors the pre-Phase-F "…including the meadow"
   * check, just pointed at the layer that is actually on by default now). */
  t.check("…tuft count (0 by default) is unaffected by rebuild", rebuilt.t1 === rebuilt.t0, rebuilt);
  t.check("…and the wildflower layer rebuilds at the same density",
    rebuilt.f1 > 0 && Math.abs(rebuilt.f1 - rebuilt.f0) < Math.max(2, rebuilt.f0 * 0.15), rebuilt);

  // ════════════════════════════════════════════════════ 9. determinism guard
  const pure = await page.evaluate(() => {
    const FS = window.__FS__, FSC = FS.FSC, R = FS.FSRender;
    // the FX layer must never touch the sim's RNG stream or its state
    FS.newGame({ size: "medium", seed: 777, ais: 1, speed: 0 });
    R.setQuality(1);
    FS.ff(400);
    const h0 = FS.hash();
    const r0 = FSC.rngSnapshot();
    for (let i = 0; i < 60; i++) { R.frame(0.033); window.FSFX.frame(0.033, FS.G); }
    window.FSFX.spawnFish(-1);
    window.FSFX.rescan();
    const h1 = FS.hash();
    const r1 = FSC.rngSnapshot();
    return { h0, h1, calls0: r0.calls, calls1: r1.calls, seed0: r0.seed, seed1: r1.seed };
  });
  t.check("60 rendered frames of ambience do not move the sim hash", pure.h0 === pure.h1, pure);
  t.check("…and never draw a number from the sim RNG",
    pure.calls0 === pure.calls1 && pure.seed0 === pure.seed1, pure);

  // ════════════════════════════════════════════════════ 10. quality switch
  // PHASE-F: the shipped default has nothing to thin (tufts off), so this
  // re-enables the constant in-browser for the probe (same pattern as
  // section 2) and restores it to the shipped default (0) afterward — the
  // screenshots right after this depend on that restore to show the real look.
  const qual = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC;
    FSC.VIS.TUFT_PER_VERTEX = 6;
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    function tufts() {
      const d = R.decorInfo();
      let n = 0;
      for (const k in d) if (k.indexOf("tuft") === 0) n += d[k].live;
      return n;
    }
    R.setQuality(1);
    const hi = tufts();
    R.setQuality(0.3);
    const lo = tufts();
    R.setQuality(1);
    const back = tufts();
    for (let i = 0; i < 3; i++) R.frame(0.033);
    FSC.VIS.TUFT_PER_VERTEX = 0;              // restore the shipped default
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    R.setQuality(1);
    for (let i = 0; i < 3; i++) R.frame(0.033);
    return { hi, lo, back, auto: R.quality(), restoredTuftPerVertex: FSC.VIS.TUFT_PER_VERTEX };
  });
  t.check("re-enabled: the quality switch really thins the meadow", qual.lo < qual.hi * 0.5, qual);
  t.check("re-enabled: …and restores it", qual.back === qual.hi, qual);
  t.check("the shipped default (0) is restored before the hero screenshots below",
    qual.restoredTuftPerVertex === 0, qual);

  // ════════════════════════════════════════════════════ 11. hero screenshots
  async function shoot(name, setup, frames) {
    await page.evaluate(setup);
    await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__FS__.FSRender.frame(0.033); }, frames || 40);
    await t.shot(page, name);
  }
  await page.addStyleTag({ content:
    "#dbg,#speedTag,#bhint,#bmode,#netChip,#pingMark,#fsTopbar,#fsDock,#fsBuildPanel," +
    "#fsContext,#fsMinimap,#fsToasts,#fsSpeed,#fsSheetWrap{display:none!important}" });

  /* A real settlement for the hero plate: buildings AND the road network that
   * ties them together (a town without roads reads as scattered sheds). This is
   * the transport suite's connect-a-site routine, trimmed to what a screenshot
   * needs — a legal road path chopped into segments with a flag at each joint. */
  await page.evaluate(() => {
    window.__V__ = {
      connect: function (toV) {
        const FS = window.__FS__, FSSim = FS.FSSim, FSMap = FS.FSMap, G = FS.G;
        const cf = FSSim.castleOf(G, 0).flag;
        if (G.map.flagAt[toV] && (G.map.flagAt[toV] === cf || FSSim.hops(G, G.map.flagAt[toV], cf) >= 0)) return true;
        const cands = [];
        for (const id in G.flags) {
          const f = G.flags[id];
          if (f.p !== 0 || f.roads.length >= 6 || f.v === toV) continue;
          if (f.id !== cf && FSSim.hops(G, f.id, cf) < 0) continue;
          cands.push([f, FSMap.dist(G.map, f.v, toV)]);
        }
        cands.sort((a, b) => (a[1] - b[1]) || (a[0].id - b[0].id));
        for (let c = 0; c < cands.length && c < 8; c++) {
          const from = cands[c][0];
          const path = FSSim.roadPath(G, from.v, toV, 0, { maxLen: 400, maxNodes: 60000 });
          if (!path) continue;
          const STEP = 8, LAST = path.length - 3;
          let cur = from, curIdx = 0, ok = true;
          for (let i = STEP; i <= LAST; i += STEP) {
            let j = i;
            while (j <= LAST && FSMap.whyFlag(G.map, path[j], 0)) j++;
            if (j > LAST) break;
            const nf = FSSim.placeFlag(G, path[j], 0);
            if (!nf.ok) { ok = false; break; }
            const r = FSSim.buildRoad(G, cur.id, nf.id, path.slice(curIdx, j + 1), 0);
            if (!r.ok) { FSSim.removeFlag(G, nf.id); ok = false; break; }
            cur = nf.flag; curIdx = j; i = j;
          }
          if (!ok) continue;
          let fid = G.map.flagAt[toV];
          if (!fid) { const nf = FSSim.placeFlag(G, toV, 0); if (!nf.ok) continue; fid = nf.id; }
          if (FSSim.buildRoad(G, cur.id, fid, path.slice(curIdx), 0).ok) return true;
        }
        return false;
      },
    };
  });

  await shoot("farmstead_beauty_town", () => {
    const FS = window.__FS__, R = FS.FSRender, FSSim = FS.FSSim, FSMap = FS.FSMap, FSC = FS.FSC;
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0, aiPlan: false });
    R.setQuality(1);
    const G = FS.G, castle = FSSim.castleOf(G, 0), used = [];
    const sites = [];
    // nearest legal site wins, so the quarter grows AROUND the keep instead of
    // stringing itself out along the first coastline the scan happens to reach
    ["lumberjack", "sawmill", "forester", "farm", "mill", "bakery", "stonecutter", "pigfarm",
      "butcher", "toolmaker", "smelter", "stock", "hut", "weaponsmith", "tower", "fisher"].forEach((ty) => {
      let best = -1, bestD = 1e9;
      FSMap.forRadius(G.map, castle.v, 13, (v, d) => {
        if (d < 3 || d >= bestD || used.some((w) => FSMap.dist(G.map, w, v) < 3)) return;
        if (FSMap.canPlaceBuilding(G.map, ty, v, 0)) { best = v; bestD = d; }
      });
      if (best < 0) return;
      const r = FSSim.build(G, ty, best, 0);
      if (r.ok) { used.push(best); sites.push(G.buildings[r.id]); }
    });
    sites.forEach((b) => {
      if (!window.__V__.connect(G.flags[b.flag].v)) { FSSim.demolishBuilding(G, b.id); return; }
      FSSim.forceComplete(G, b.id);
    });
    FS.ff(3000);
    let cx = 0, cz = 0, n = 0;
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== 0) continue;
      if (FSC.BLD[b.type].cycleT) { b.working = true; b.prodT = 40; }
      const p = FSMap.worldXZ(G.map, b.v, [0, 0]);
      cx += p[0]; cz += p[1]; n++;
    }
    R.setCam({ yaw: 0.62, pitch: 0.76 });
    R.focusVertex(castle.v, 24);
    if (n) R.setCam({ tx: (cx / n + FSMap.worldXZ(G.map, castle.v, [0, 0])[0]) / 2,
      tz: (cz / n + FSMap.worldXZ(G.map, castle.v, [0, 0])[1]) / 2 });
  }, 60);

  await shoot("farmstead_beauty_coast", () => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap, FSSim = FS.FSSim;
    FS.newGame({ size: "medium", seed: 4242, ais: 1, speed: 0, aiPlan: false });
    R.setQuality(1);
    const G = FS.G, map = G.map, castle = FSSim.castleOf(G, 0);
    let shore = -1, bd = 1e9;
    FSMap.forRadius(map, castle.v, 22, (u, d) => {
      if (map.terr[u] !== FSC.TERR.WATER || d >= bd) return;
      bd = d; shore = u;
    });
    FS.ff(1500);
    R.setCam({ yaw: 0.7, pitch: 0.66 });
    R.focusVertex(shore >= 0 ? shore : castle.v, 22);
    R.frame(0.033);                       // let FSFX bind to the new world first
    // guarantee the hero moment: fish in the air over the bay
    for (let k = 0; k < 5; k++) {
      let v = -1;
      FSMap.forRadius(map, shore, 5, (u, d) => { if (v < 0 && d === 1 + (k % 4) && map.terr[u] === FSC.TERR.WATER) v = u; });
      if (v >= 0) { map.fish[v] = FSC.GEN.FISH_MAX; window.FSFX.spawnFish(v); }
    }
    for (let i = 0; i < 9; i++) window.__FS__.FSRender.frame(0.033);
  }, 4);

  await shoot("farmstead_beauty_mines", () => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap, FSSim = FS.FSSim;
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0, aiPlan: false });
    R.setQuality(1);
    const G = FS.G, castle = FSSim.castleOf(G, 0), used = [];
    let mine = -1;
    ["coalMine", "ironMine", "stoneMine", "goldMine", "hut"].forEach((ty) => {
      let best = -1;
      FSMap.forRadius(G.map, castle.v, 24, (v, d) => {
        if (d < 5 || best >= 0 || used.some((w) => FSMap.dist(G.map, w, v) < 2)) return;
        if (FSMap.canPlaceBuilding(G.map, ty, v, 0)) best = v;
      });
      if (best < 0) return;
      const r = FSSim.build(G, ty, best, 0);
      if (r.ok) {
        used.push(best);
        window.__V__.connect(G.flags[G.buildings[r.id].flag].v);
        FSSim.forceComplete(G, r.id);
        G.buildings[r.id].working = true; G.buildings[r.id].prodT = 60;
        if (mine < 0 && FSC.BLD[ty].mine) mine = best;
      }
    });
    FS.ff(900);
    R.setCam({ yaw: 1.05, pitch: 0.70 });
    R.focusVertex(mine >= 0 ? mine : castle.v, 20);
  }, 50);

  await shoot("farmstead_beauty_battle", () => {
    const FS = window.__FS__, R = FS.FSRender, FSSim = FS.FSSim, FSMil = FS.FSMil, FSC = FS.FSC, FSMap = FS.FSMap;
    FS.newGame({ size: "medium", seed: 90210, ais: 1, speed: 0 });
    R.setQuality(1);
    const G = FS.G, castle = FSSim.castleOf(G, 0);
    // a contested frontier: two guard huts of ours, one of theirs, and a fire
    const mine = [];
    ["hut", "tower", "hut"].forEach((ty) => {
      let best = -1;
      FSMap.forRadius(G.map, castle.v, 12, (v, dd) => {
        if (dd < 4 || best >= 0 || mine.some((w) => FSMap.dist(G.map, w, v) < 3)) return;
        if (FSMap.canPlaceBuilding(G.map, ty, v, 0)) best = v;
      });
      if (best < 0) return;
      const r = FSSim.build(G, ty, best, 0);
      if (r.ok) { mine.push(best); FSSim.forceComplete(G, r.id); }
    });
    FS.ff(1800);
    // set the last one alight and put fallen knights around it
    let burnV = -1;
    for (let i = mine.length - 1; i >= 0 && burnV < 0; i--) {
      const id = G.map.bldAt[mine[i]];
      if (!id) continue;
      G.buildings[id].state = "burn"; G.buildings[id].burnT = 0;
      burnV = mine[i];
    }
    if (burnV < 0) burnV = castle.v;
    if (!G.corpses) G.corpses = [];
    FSMap.forRadius(G.map, burnV, 2, (v, dd) => {
      if (dd === 0 || G.corpses.length > 5) return;
      G.corpses.push({ v: v, p: (dd + G.corpses.length) % 2, t: G.tick - 8 });
    });
    R.setCam({ yaw: 0.78, pitch: 0.60 });
    R.focusVertex(burnV, 13);
  }, 50);

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await shoot("farmstead_beauty_mobile", () => {
    const FS = window.__FS__, R = FS.FSRender;
    R.resize();
    R.setCam({ yaw: 0.62, pitch: 0.76, dist: 22 });
  }, 30);
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.evaluate(() => window.__FS__.FSRender.resize());

  t.check("0 page errors", t.errors.length === 0, t.errors.slice(0, 6));
});
