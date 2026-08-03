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
  /* the SHIPPED meadow density, read out of the source rather than hardcoded —
   * several probes below have to put the constant back where they found it and
   * the number moved once already (0 through Phase F, back on 2026-08-02). */
  const SHIPPED_TPV = require("fs").readFileSync(
    require("path").join(H.ROOT, "assets/farmstead/fs-const.js"), "utf8")
    .match(/TUFT_PER_VERTEX:\s*(\d+)/)[1] | 0;
  const page = await t.newPage({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(t.BASE + "/castlekruzer.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 20000 });
  await page.evaluate(() => {
    window.__FS__.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    window.__FS__.FSRender.setQuality(1);          // judge the real thing, not the CI thinning
    for (let i = 0; i < 4; i++) window.__FS__.FSRender.frame(0.033);
  });

  // ════════════════════════════════════════════════════ 1. the look layers
  const layers = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, sc = R.scene();
    /* 2026-08-02: "sparkle" is deliberately NOT in this list any more — the
     * twinkling sun-glint layer was removed on the player's word (distracting);
     * its absence is asserted just below rather than left to a missing name. */
    const names = ["sky", "terrain", "water", "watershimmer", "foam", "objects", "decor", "buildings", "dynamic", "fx"];
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
  /* RESTAGED 2026-08-02 (charm pass). Phase F switched the tuft layer OFF as
   * "too visually busy" and this section asserted the ZERO — that the shipped
   * default allocated no tuft pools at all. The player has now asked for the
   * opposite ("hide the flat surfaces with low cost grass… charming little
   * sprite grass"), and the two things that made the first meadow busy are
   * fixed rather than dialled down: a clump takes its colour from the terrain
   * vertex it stands on (so it reads as ground, not as a separate green
   * object), and it is authored TALLER than it is wide so this 52° camera does
   * not foreshorten it into a leaf lying flat.
   *
   * So (a) now asserts the meadow is ON, dense, ground-tinted and grass-only,
   * and (b) — inverted from the old section — proves 0 is still a CLEAN
   * TOGGLE that allocates nothing, which is the property Phase F relied on. */
  const meadowOn0 = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, map = FS.G.map;
    const d = R.decorInfo();
    let grassV = 0, otherLand = 0;
    const T = FSC.TERR;
    for (let v = 0; v < map.W * map.H; v++) {
      if (map.terr[v] === T.GRASS) grassV++;
      else if (map.terr[v] === T.SWAMP || map.terr[v] === T.DESERT) otherLand++;
    }
    let tufts = 0;
    for (const k in d) if (k.indexOf("tuft") === 0) tufts += d[k].live;
    return { pools: Object.keys(d), tuftPerVertex: FSC.VIS.TUFT_PER_VERTEX, tufts,
      flowers: d.flower ? d.flower.live : 0, shadows: d.shadow ? d.shadow.live : 0,
      scree: d.scree ? d.scree.live : 0, grassV, otherLand, quality: R.quality(),
      perGrass: +(tufts / Math.max(1, grassV)).toFixed(2), groundMix: FSC.VIS.TUFT_GROUND_MIX };
  });
  t.check("the meadow is BACK: tufts on by default (charm pass 2026-08-02)",
    meadowOn0.tuftPerVertex > 0, meadowOn0);
  t.check("…with a pool per variant", ["tuft0", "tuft1", "tuft2"].every((k) => meadowOn0.pools.indexOf(k) >= 0), meadowOn0.pools);
  t.check("…dense enough to hide the flat facets — clumps per grass vertex",
    meadowOn0.perGrass >= 1.5, meadowOn0);
  t.check("…and mostly the colour of the ground it stands on", meadowOn0.groundMix >= 0.7, meadowOn0);
  t.check("wildflowers still exist, independent of tufts, and are sparse not everywhere",
    meadowOn0.flowers > 10 && meadowOn0.flowers < meadowOn0.grassV * 0.3, meadowOn0);
  t.check("every standing object still drops a contact shadow", meadowOn0.shadows > 40, meadowOn0);
  t.check("bare mountain still grows scree", meadowOn0.scree > 10, meadowOn0);

  /* GRASS ONLY. Swamp and desert used to grow thinned clumps of the same
   * blade sheet; the charm pass turned them off, because the meadow's own
   * cutout appearing in a marsh reads as the meadow leaking into it. */
  const grassOnly = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, map = FS.G.map, FSMap = FS.FSMap;
    const T = FSC.TERR;
    // every live tuft's world XZ, resolved back to the nearest lattice vertex
    const d = R.decorInfo();
    const bad = { swamp: 0, desert: 0, water: 0, mountain: 0, snow: 0 };
    let sampled = 0, grass = 0;
    R.scene().getObjectByName("decor").children.forEach((m) => {
      if (m.name.indexOf("decor:tuft") !== 0) return;
      const a = m.instanceMatrix.array;
      for (let i = 0; i < m.count; i++) {
        const x = a[i * 16 + 12], z = a[i * 16 + 14];
        if (a[i * 16] === 0 && a[i * 16 + 5] === 0) continue;      // cleared slot
        const v = FSMap.nearestVertex(map, x, z);
        if (v < 0) continue;
        sampled++;
        const tt = map.terr[v];
        if (tt === T.GRASS) grass++;
        else if (tt === T.SWAMP) bad.swamp++;
        else if (tt === T.DESERT) bad.desert++;
        else if (tt === T.WATER) bad.water++;
        else if (tt === T.MOUNTAIN) bad.mountain++;
        else if (tt === T.SNOW) bad.snow++;
      }
    });
    return { sampled, grass, bad, pools: Object.keys(d).filter((k) => k.indexOf("tuft") === 0) };
  });
  t.check("grass grows on GRASS — not swamp, desert, water, rock or snow",
    grassOnly.sampled > 50 && grassOnly.bad.water === 0 && grassOnly.bad.mountain === 0 &&
    grassOnly.bad.snow === 0 && grassOnly.bad.desert === 0 && grassOnly.bad.swamp === 0, grassOnly);

  // (b) INVERTED from the old section: 0 is still a clean toggle that costs
  // nothing at all — no geometry, no InstancedMesh, no bucket membership.
  const meadowOff = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC;
    FSC.VIS.TUFT_PER_VERTEX = 0;             // disable, in-memory only
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    R.setQuality(1);
    for (let i = 0; i < 4; i++) R.frame(0.033);
    const d = R.decorInfo();
    const c = R.cullInfo();
    return { pools: Object.keys(d), flowers: d.flower ? d.flower.live : 0,
      shadows: d.shadow ? d.shadow.live : 0, decorLive: c.decorLive };
  });
  t.check("TUFT_PER_VERTEX 0 is still a clean OFF: no tuft pools at all",
    ["tuft0", "tuft1", "tuft2"].every((k) => meadowOff.pools.indexOf(k) < 0), meadowOff.pools);
  t.check("…and the rest of the meadow layer is untouched by the toggle",
    meadowOff.flowers > 10 && meadowOff.shadows > 40, meadowOff);

  // back to a dense world for the claim/removal hook below
  const meadowOn = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC;
    FSC.VIS.TUFT_PER_VERTEX = 6;             // denser than shipped, in-memory only
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
  t.check("re-enabled denser: tuft pools exist again", ["tuft0", "tuft1", "tuft2"].every((k) => meadowOn.pools.indexOf(k) >= 0), meadowOn.pools);
  t.check("re-enabled denser: the meadow scales with the constant",
    meadowOn.perGrass >= 0.9, meadowOn);
  t.check("re-enabled denser: wildflowers still co-exist and stay sparse",
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

  /* ══════════════════════════════════ 2b. ROADS ARE GROUND, NOT AN OBJECT
   * (2026-08-01) Land roads stopped being an extruded ribbon and became a
   * decal painted into one map-space sheet and laid over the terrain's OWN
   * triangles. That cannot be judged by counting quads any more, so this
   * section reads the three hooks the rework added: roadVisual() for shape,
   * roadCover(x,z) for "is this ground painted", probeRoad(x,z) for "does the
   * paint lie ON the terrain". Water spans still keep a plank ribbon —
   * dynamicInfo().roads is now a DRAW-CALL count (decal 0/1 + ribbon 0/1). */
  await page.evaluate(() => {
    // a compact network builder — the visuals suite has no window.T
    const FS = window.__FS__, FSMap = FS.FSMap, FSSim = FS.FSSim;
    window.RT = {
      castle: () => FSSim.castleOf(FS.G, 0),
      /** n extra flags, each joined to the nearest reachable flag */
      town(n, rad) {
        const G = FS.G;
        let made = 0;
        const cands = [];
        FSMap.forRadius(G.map, this.castle().v, rad || 11, (u, d) => { if (d >= 2) cands.push([u, d]); });
        cands.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
        for (let i = 0; i < cands.length && made < n; i++) {
          const v = cands[i][0];
          if (!FSMap.canPlaceFlag(G.map, v, 0)) continue;
          let bF = 0, bP = null, bL = 1e9;
          for (const id in G.flags) {
            const f = G.flags[id];
            if (f.p !== 0 || f.roads.length >= 6) continue;
            if (FSMap.dist(G.map, f.v, v) > 7) continue;
            const p = FSSim.roadPath(G, f.v, v, 0);
            if (p && p.length < bL) { bL = p.length; bP = p; bF = f.id; }
          }
          if (!bF || bL < 2) continue;
          const nf = FSSim.placeFlag(G, v, 0);
          if (!nf.ok) continue;
          if (!FSSim.buildRoad(G, bF, nf.id, bP, 0).ok) { FSSim.removeFlag(G, nf.id); continue; }
          made++;
        }
        return made;
      },
      /* Drag a road up the steepest legal bank we own, so the slope-conformance
       * checks below have real relief to work with (a generic town network can
       * easily sit entirely on flat ground). Two flags may never be adjacent,
       * so the shortest legal road over one steep step is flag—step—flag. */
      steepRoad(minDh) {
        const G = FS.G, map = G.map, edges = [];
        FSMap.forRadius(map, this.castle().v, 14, (v) => {
          if (map.owner[v] !== 0) return;
          for (let d = 0; d < 6; d++) {
            const u = FSMap.nbr(map, v, d);
            if (u < 0 || u <= v || map.owner[u] !== 0) continue;
            if (FSMap.whyRoadStep(map, v, u, 0, { endB: true })) continue;
            const dh = Math.abs(map.height[u] - map.height[v]);
            if (dh >= minDh) edges.push([dh, v, u]);
          }
        });
        edges.sort((a, b) => b[0] - a[0]);
        for (let i = 0; i < edges.length && i < 120; i++) {
          for (let s = 0; s < 2; s++) {
            const a = s ? edges[i][2] : edges[i][1];
            const b = s ? edges[i][1] : edges[i][2];
            if (FSMap.edgeCount(map, b) > 0 || map.flagAt[b]) continue;
            for (let d = 0; d < 6; d++) {
              const c = FSMap.nbr(map, b, d);
              if (c < 0 || c === a) continue;
              if (FSMap.whyRoadStep(map, b, c, 0, { endB: true })) continue;
              const fa = map.flagAt[a] || (FSMap.canPlaceFlag(map, a, 0) ? (FSSim.placeFlag(G, a, 0).id || 0) : 0);
              if (!fa) break;
              const fc = map.flagAt[c] || (FSMap.canPlaceFlag(map, c, 0) ? (FSSim.placeFlag(G, c, 0).id || 0) : 0);
              if (!fc) continue;
              if (FSSim.buildRoad(G, fa, fc, [a, b, c], 0).ok) return +edges[i][0].toFixed(3);
            }
          }
        }
        return 0;
      },
    };
  });

  const road = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, RT = window.RT, FSMap = FS.FSMap;
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0, aiPlan: false });
    R.setQuality(1);
    for (let i = 0; i < 3; i++) R.frame(0.033);
    const made = RT.town(14, 12);
    const steepDh = RT.steepRoad(0.45);
    for (let i = 0; i < 4; i++) R.frame(0.033);
    const G = FS.G, map = G.map, xz = [0, 0];
    let junction = 0;
    for (const id in G.flags) if (G.flags[id].p === 0) junction = Math.max(junction, G.flags[id].roads.length);
    const rv = R.roadVisual();
    // every road vertex must be painted; ground well clear of the net must not be
    const roadV = new Set();
    for (const id in G.roads) for (const v of G.roads[id].path) roadV.add(v);
    let lowCover = 0, minCover = 999;
    roadV.forEach((v) => {
      FSMap.worldXZ(map, v, xz);
      const c = R.roadCover(xz[0], xz[1]);
      minCover = Math.min(minCover, c);
      if (c <= 120) lowCover++;
    });
    let offMax = -999, offN = 0;
    for (let v = 0; v < map.W * map.H && offN < 40; v++) {
      if (roadV.has(v)) continue;
      let near = false;
      FSMap.forRadius(map, v, 3, (u) => { if (roadV.has(u)) near = true; });
      if (near) continue;
      FSMap.worldXZ(map, v, xz);
      offMax = Math.max(offMax, R.roadCover(xz[0], xz[1]));
      offN++;
    }
    // the paint must lie ON the terrain — a small positive gap, flat AND on banks
    let gapMin = 9, gapMax = -9, slopeGapMax = -9, slopeN = 0, probes = 0;
    roadV.forEach((v) => {
      FSMap.worldXZ(map, v, xz);
      const p = R.probeRoad(xz[0], xz[1]);
      if (!p) return;
      probes++;
      gapMin = Math.min(gapMin, p.gap); gapMax = Math.max(gapMax, p.gap);
      let dh = 0;
      for (let d = 0; d < 6; d++) { const u = FSMap.nbr(map, v, d); if (u >= 0) dh = Math.max(dh, Math.abs(map.height[u] - map.height[v])); }
      if (dh > 0.45) { slopeN++; slopeGapMax = Math.max(slopeGapMax, p.gap); }
    });
    // the sheet must not run out to its own border (ClampToEdge would smear it)
    const M = FS.FSModels;
    let edgeMax = 0;
    for (let i = 0; i <= 256; i++) {
      const u = i / 256;
      edgeMax = Math.max(edgeMax, M.roadMaskAlpha(rv.box.px, u, 0.0005), M.roadMaskAlpha(rv.box.px, u, 0.9995),
        M.roadMaskAlpha(rv.box.px, 0.0005, u), M.roadMaskAlpha(rv.box.px, 0.9995, u));
    }
    // …and the decal's own silhouette must land on UNPAINTED ground, so the
    // mesh edge is never a visible hard cut through the paint
    const dec = R.scene().getObjectByName("roads");
    const pos = dec.geometry.attributes.position, uv = dec.geometry.attributes.uv;
    let outsideUV = 0;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (u < 0 || u > 1 || v < 0 || v > 1) outsideUV++;
    }
    const edgeCount = new Map();
    for (let f = 0; f < pos.count / 3; f++) {
      for (let e = 0; e < 3; e++) {
        const i0 = f * 3 + e, i1 = f * 3 + ((e + 1) % 3);
        const k0 = pos.getX(i0).toFixed(3) + "," + pos.getZ(i0).toFixed(3);
        const k1 = pos.getX(i1).toFixed(3) + "," + pos.getZ(i1).toFixed(3);
        const key = k0 < k1 ? k0 + "|" + k1 : k1 + "|" + k0;
        edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
      }
    }
    let boundary = 0, worstBoundaryAlpha = 0;
    edgeCount.forEach((c, key) => {
      if (c !== 1) return;
      boundary++;
      key.split("|").forEach((pt) => {
        const xzp = pt.split(",").map(Number);
        worstBoundaryAlpha = Math.max(worstBoundaryAlpha, R.roadCover(xzp[0], xzp[1]));
      });
    });
    // the decal must light like the ground it lies on: the terrain's OWN normals
    const terr = R.scene().getObjectByName("terrain");
    function normalMismatch() {
      const d = R.scene().getObjectByName("roads");
      const tn = terr.geometry.attributes.normal, tp = terr.geometry.attributes.position;
      const dn = d.geometry.attributes.normal, dp = d.geometry.attributes.position;
      const ix = new Map();
      for (let i = 0; i < tp.count; i++) ix.set(tp.getX(i).toFixed(3) + "," + tp.getZ(i).toFixed(3), i);
      let worst = 0;
      for (let i = 0; i < dp.count; i++) {
        const j = ix.get(dp.getX(i).toFixed(3) + "," + dp.getZ(i).toFixed(3));
        if (j === undefined) continue;
        worst = Math.max(worst, Math.abs(dn.getX(i) - tn.getX(j)) + Math.abs(dn.getY(i) - tn.getY(j)) + Math.abs(dn.getZ(i) - tn.getZ(j)));
      }
      return +worst.toFixed(4);
    }
    const normalsSteady = normalMismatch();
    return { made, steepDh, junction, roads: Object.keys(G.roads).length, rv,
      minCover, lowCover, offMax, offN, probes, gapMin: +gapMin.toFixed(4), gapMax: +gapMax.toFixed(4),
      slopeN, slopeGapMax: +slopeGapMax.toFixed(4), edgeMax, outsideUV, boundary, worstBoundaryAlpha,
      normalsSteady, ROAD_LIFT: FS.FSC.ROAD_LIFT, dyn: R.dynamicInfo(),
      decalEmissive: dec.material.emissive.getHexString(),
      terrEmissive: terr.material.emissive.getHexString() };
  });
  t.check("roads: a real network with a junction was built",
    road.roads >= 8 && road.junction >= 3, road);
  t.check("roads: the land network is ONE painted ground decal with real triangles",
    road.rv.decal === true && road.rv.tris > 0 && road.dyn.roads === 1 && road.dyn.roadWater === false, road.rv);
  t.check("roads: the decal is transparent + depthWrite off (it must not seal the terrain)",
    road.rv.transparent === true && road.rv.depthWrite === false, road.rv);
  t.check("roads: the sheet is a square map-space box", !!road.rv.box && road.rv.box.px === 2048, road.rv);
  t.check("roads: every road vertex stands on painted ground", road.lowCover === 0 && road.minCover > 120, road);
  t.check("roads: ground well clear of the network is unpainted", road.offN > 10 && road.offMax <= 0, road);
  t.check("roads: the paint lies ON the terrain — a small positive gap, never the full ribbon lift",
    road.probes > 4 && road.gapMin > 0 && road.gapMax < road.ROAD_LIFT, road);
  t.check("roads: …and it still hugs the ground on a real bank",
    road.steepDh >= 0.45 && road.slopeN > 0 && road.slopeGapMax > 0 && road.slopeGapMax < road.ROAD_LIFT, road);
  t.check("roads: no paint reaches the sheet border (ClampToEdge cannot smear it)", road.edgeMax === 0, road);
  t.check("roads: every decal vertex's uv is inside the sheet", road.outsideUV === 0, road);
  t.check("roads: the decal's own silhouette lands on unpainted ground (no hard cut)",
    road.boundary > 10 && road.worstBoundaryAlpha < 40, road);
  t.check("roads: the decal takes the terrain's OWN smooth normals", road.normalsSteady < 1e-4, road);
  /* The decal is coplanar GROUND: it must also take the terrain's ambient lift,
   * or it bleaches out and reads as a sticker however good the paint is. */
  t.check("roads: …and the terrain's own emissive lift, exactly",
    road.decalEmissive === road.terrEmissive, road);

  /* ═══ THE PATH IS A FOOTPATH, NOT A HIGHWAY (batch #5, 2026-08-02) ═════════
   * User playtest: the roads read too wide. The paint half-width went from
   * 1.45 to 1.12 of FSC.ROAD_W. Two things have to be true at once and only
   * one of them is "narrower": the SOLID body has to come in, and the FEATHER
   * beyond it has to stay — a crisp thin stripe is a sticker on the grass, and
   * the soft edge is the entire reason the decal reads as trodden earth. So
   * this measures a real cross-section of the sheet: sweep out from the middle
   * of a road segment along its own perpendicular and record where the paint
   * stops being solid and where it stops altogether. */
  const width = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSMap = FS.FSMap, G = FS.G, map = G.map;
    const a = [0, 0], b = [0, 0];
    const body = [], edge = [];
    let samples = 0;
    for (const id in G.roads) {
      const p = G.roads[id].path;
      for (let i = 1; i < p.length && samples < 24; i++) {
        FSMap.worldXZ(map, p[i - 1], a); FSMap.worldXZ(map, p[i], b);
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const L = Math.hypot(dx, dz);
        if (L < 0.2) continue;
        const nx = -dz / L, nz = dx / L;                    // the segment's own perpendicular
        const cx = (a[0] + b[0]) * 0.5, cz = (a[1] + b[1]) * 0.5;
        if (R.roadCover(cx, cz) < 150) continue;            // not a clean mid-segment sample
        for (const sgn of [-1, 1]) {
          /* STOP AT THE FIRST GAP, never take the farthest painted sample: a
           * town's roads run within a couple of units of each other, so a
           * sweep that kept going measured this road plus the next one plus
           * the junction blob between them (it read 1.18 world units, which is
           * three roads, and is how this check first failed). */
          let solid = 0, any = 0, s = 0;
          for (; s <= 1.2; s += 0.02) {
            if (R.roadCover(cx + nx * sgn * s, cz + nz * sgn * s) < 150) break;
            solid = s;
          }
          for (any = solid; any <= 1.2; any += 0.02) {
            if (R.roadCover(cx + nx * sgn * any, cz + nz * sgn * any) < 12) break;
          }
          body.push(solid); edge.push(any);
        }
        samples++;
      }
    }
    const av = (x) => x.reduce((p, q) => p + q, 0) / Math.max(1, x.length);
    return { n: body.length, body: +av(body).toFixed(3), edge: +av(edge).toFixed(3),
      bodyMax: +Math.max.apply(null, body).toFixed(3),
      ROAD_W: FS.FSC.ROAD_W };
  });
  console.log("   road cross-section: solid half-width " + width.body + " · outer feather "
    + width.edge + " world units (FSC.ROAD_W " + width.ROAD_W + ")");
  /* Before this batch the same sweep measured a solid half-width of ~0.47 and a
   * feathered edge out past 0.85. The bar is expressed against FSC.ROAD_W so it
   * cannot drift if the ribbon width is ever retuned. */
  t.check("roads: the solid path is a FOOTPATH — half-width between 1.0 and 1.4 of ROAD_W",
    width.n >= 8 && width.body > width.ROAD_W * 1.0 && width.body < width.ROAD_W * 1.4, width);
  t.check("roads: …and the FEATHER survives the narrowing (a real verge past the body)",
    width.edge > width.body * 1.35 && width.edge > width.body + 0.14, width);

  const roadEdit = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, G = FS.G, xz = [0, 0];
    /* A terrain edit RE-SEATS the decal's triangles but must NOT repaint the
     * 2048px sheet (a digger levelling ground marks dirtyV every tick — a
     * repaint per swing would be a hitch you can feel). A NETWORK change is
     * what earns a repaint. */
    const before = R.roadVisual(), boxBefore = JSON.stringify(before.box);
    let v0 = -1;
    for (const id in G.roads) { v0 = G.roads[id].path[1]; break; }
    FS.FSMap.worldXZ(G.map, v0, xz);
    const cover0 = R.roadCover(xz[0], xz[1]);
    const probe0 = R.probeRoad(xz[0], xz[1]);
    const h0 = G.map.height[v0];
    G.map.height[v0] = h0 + 0.5;
    G.dirtyV.push(v0);
    R.frame(0.033);
    const after = R.roadVisual();
    const cover1 = R.roadCover(xz[0], xz[1]);
    const probe1 = R.probeRoad(xz[0], xz[1]);
    // the terrain moved under it — the decal must still light like the ground
    const terr = R.scene().getObjectByName("terrain"), dec = R.scene().getObjectByName("roads");
    const tn = terr.geometry.attributes.normal, tp = terr.geometry.attributes.position;
    const dn = dec.geometry.attributes.normal, dp = dec.geometry.attributes.position;
    const ix = new Map();
    for (let i = 0; i < tp.count; i++) ix.set(tp.getX(i).toFixed(3) + "," + tp.getZ(i).toFixed(3), i);
    let normalsAfterEdit = 0;
    for (let i = 0; i < dp.count; i++) {
      const j = ix.get(dp.getX(i).toFixed(3) + "," + dp.getZ(i).toFixed(3));
      if (j === undefined) continue;
      normalsAfterEdit = Math.max(normalsAfterEdit,
        Math.abs(dn.getX(i) - tn.getX(j)) + Math.abs(dn.getY(i) - tn.getY(j)) + Math.abs(dn.getZ(i) - tn.getZ(j)));
    }
    G.map.height[v0] = h0; G.dirtyV.push(v0);
    R.frame(0.033);
    // now a NETWORK change: that one must repaint
    const genBeforePaint = R.roadVisual().gen;
    let removed = 0;
    for (const id in G.roads) { FS.FSSim.demolishRoad(G, id | 0); removed++; break; }
    R.frame(0.033);
    const repainted = R.roadVisual();
    return { genBefore: before.gen, genAfter: after.gen,
      boxSame: JSON.stringify(after.box) === boxBefore,
      cover0, cover1, trisBefore: before.tris, trisAfter: after.tris,
      y0: probe0 ? +probe0.decalY.toFixed(3) : null, y1: probe1 ? +probe1.decalY.toFixed(3) : null,
      gap1: probe1 ? +probe1.gap.toFixed(4) : null,
      normalsAfterEdit: +normalsAfterEdit.toFixed(4),
      removed, genBeforePaint, genAfterPaint: repainted.gen, repaintTris: repainted.tris };
  });
  t.check("roads: a terrain edit rebuilds the decal", roadEdit.genAfter === roadEdit.genBefore + 1, roadEdit);
  t.check("roads: …reusing the sheet it already painted for this network",
    roadEdit.boxSame === true && roadEdit.cover1 === roadEdit.cover0, roadEdit);
  t.check("roads: …with the triangles re-seated onto the ground that moved",
    roadEdit.y1 > roadEdit.y0 + 0.4 && roadEdit.gap1 > 0 && roadEdit.gap1 < 0.061, roadEdit);
  t.check("roads: …and normals still matching the terrain (they are recomputed BEFORE the rebuild)",
    roadEdit.normalsAfterEdit < 1e-4, roadEdit);
  t.check("roads: a NETWORK change is what earns a repaint",
    roadEdit.removed === 1 && roadEdit.genAfterPaint > roadEdit.genBeforePaint && roadEdit.repaintTris > 0, roadEdit);

  const roadWater = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap, FSSim = FS.FSSim;
    FS.newGame({ size: "medium", seed: 4242, ais: 1, speed: 0, aiPlan: false });   // this start has a bay
    R.setQuality(1);
    for (let i = 0; i < 3; i++) R.frame(0.033);
    const G = FS.G, map = G.map;
    // reachable shore vertices
    const seen = new Uint8Array(map.W * map.H), start = G.flags[FSSim.castleOf(G, 0).flag].v;
    seen[start] = 1;
    const q = [start];
    while (q.length) {
      const v = q.pop();
      for (let d = 0; d < 6; d++) {
        const u = FSMap.nbr(map, v, d);
        if (u < 0 || seen[u] || FSMap.whyRoadStep(map, v, u, 0, { endB: true })) continue;
        seen[u] = 1; q.push(u);
      }
    }
    const shore = [];
    for (let v = 0; v < map.W * map.H; v++) {
      if (!seen[v] || FSMap.whyFlag(map, v, 0)) continue;
      for (let d = 0; d < 6; d++) {
        const u = FSMap.nbr(map, v, d);
        if (u >= 0 && map.terr[u] === FSC.TERR.WATER) { shore.push(v); break; }
      }
    }
    let A = -1, B = -1, path = null;
    for (let i = 0; i < shore.length && A < 0; i++) {
      for (let j = i + 1; j < shore.length; j++) {
        const d = FSMap.dist(map, shore[i], shore[j]);
        if (d < 3 || d > 9) continue;
        const p = FSSim.roadPath(G, shore[i], shore[j], 0, { water: true, maxLen: 80 });
        if (!p) continue;
        let w = 0;
        for (const v of p) if (map.terr[v] === FSC.TERR.WATER) w++;
        if (w < 2) continue;
        A = shore[i]; B = shore[j]; path = p; break;
      }
    }
    if (A < 0) return { ok: false, why: "no crossable water on this seed" };
    // a short land approach so BOTH kinds are on screen at once
    const fa = map.flagAt[A] || FSSim.placeFlag(G, A, 0).id;
    const fb = FSSim.placeFlag(G, B, 0);
    const r = FSSim.buildRoad(G, fa, fb.id, path, 0, {});
    window.RT.town(6, 10);
    for (let i = 0; i < 5; i++) R.frame(0.033);
    const sc = R.scene();
    const ribbon = sc.getObjectByName("roads:water");
    const decal = sc.getObjectByName("roads");
    const xz = [0, 0];
    FSMap.worldXZ(map, A, xz);
    return { ok: true, built: r.ok, water: r.ok ? G.roads[r.id].water : null,
      ribbon: !!ribbon, ribbonVerts: ribbon ? ribbon.geometry.attributes.position.count : 0,
      decal: !!decal, dyn: R.dynamicInfo(), coverAtShore: R.roadCover(xz[0], xz[1]) };
  });
  t.check("roads: a causeway over open water is still a plank ribbon (there is no ground to paint)",
    roadWater.ok && roadWater.built && roadWater.water === true && roadWater.ribbon === true && roadWater.ribbonVerts > 0, roadWater);
  t.check("roads: …while the land it lands on is still painted ground",
    roadWater.ok && roadWater.decal === true && roadWater.coverAtShore > 120, roadWater);
  t.check("roads: dynamicInfo counts BOTH draw calls when a network needs both",
    roadWater.ok && roadWater.dyn.roads === 2 && roadWater.dyn.roadDecal === true && roadWater.dyn.roadWater === true, roadWater.dyn);

  const roadGone = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, RT = window.RT;
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0, aiPlan: false });
    R.setQuality(1);
    for (let i = 0; i < 3; i++) R.frame(0.033);
    RT.town(10, 11);
    for (let i = 0; i < 4; i++) R.frame(0.033);
    const G = FS.G;
    const full = R.roadVisual();
    const mem0 = R.renderer().info.memory.geometries;
    const ids = Object.keys(G.roads);
    for (const id of ids.slice(0, Math.ceil(ids.length / 2))) FS.FSSim.demolishRoad(G, id | 0);
    for (let i = 0; i < 3; i++) R.frame(0.033);
    const shrunk = R.roadVisual();
    for (const id of Object.keys(G.roads)) FS.FSSim.demolishRoad(G, id | 0);
    for (let i = 0; i < 3; i++) R.frame(0.033);
    const empty = R.roadVisual(), emptyDyn = R.dynamicInfo();
    let anyMesh = false;
    R.scene().traverse((o) => { if (o.name === "roads" || o.name === "roads:water") anyMesh = true; });
    // hammer build/teardown: the sheet is cached, the geometry must not leak
    for (let k = 0; k < 6; k++) {
      RT.town(3, 11);
      for (let i = 0; i < 2; i++) R.frame(0.033);
      for (const id of Object.keys(G.roads)) FS.FSSim.demolishRoad(G, id | 0);
      for (let i = 0; i < 2; i++) R.frame(0.033);
    }
    return { fullTris: full.tris, shrunkTris: shrunk.tris, emptyDecal: empty.decal,
      emptyRoads: emptyDyn.roads, anyMesh, mem0, mem1: R.renderer().info.memory.geometries };
  });
  t.check("roads: pulling half the network up shrinks the decal",
    roadGone.shrunkTris > 0 && roadGone.shrunkTris < roadGone.fullTris, roadGone);
  t.check("roads: an empty network draws no road mesh at all",
    roadGone.emptyDecal === false && roadGone.emptyRoads === 0 && roadGone.anyMesh === false, roadGone);
  t.check("roads: repeated build/teardown leaks no geometries",
    roadGone.mem1 <= roadGone.mem0 + 2, roadGone);

  // restore the shipped default before the rest of the suite (draw-call
  // budgets etc. below are meant to measure the REAL player experience).
  await page.evaluate((tpv) => {
    const FS = window.__FS__;
    FS.FSC.VIS.TUFT_PER_VERTEX = tpv;        // 2026-08-02: the SHIPPED value, not 0
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
  }, SHIPPED_TPV);

  // ════════════════════════════════════════════════════ 3. the water is alive
  /* RESTAGED 2026-08-02. Two rules changed under this section:
   *  · the sun-glint layer is GONE (the player found it distracting), so its
   *    absence is the assertion now, and the surviving water layers carry the
   *    movement.
   *  · ambient animation runs on GAME time, not wall time — 4x speed is 4x the
   *    waves and a paused world is a still photograph. So a check that only
   *    calls R.frame() with the clock stopped is now asserting the opposite of
   *    what it means to. Each sample runs the SIM alongside the frames, and the
   *    paused case is asserted explicitly at the end. */
  const water = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, sc = R.scene();
    const sh = sc.getObjectByName("watershimmer");
    const foam = sc.getObjectByName("foam");
    function snap() {
      const c = foam && foam.instanceColor ? foam.instanceColor.array.slice(0, 60) : null;
      return {
        off: sh ? [sh.material.map.offset.x, sh.material.map.offset.y] : null,
        op: sh ? sh.material.opacity : 0,
        foam: c ? Array.prototype.slice.call(c) : null,
      };
    }
    function run(ticks, frames) {
      for (let i = 0; i < frames; i++) { FS.ff(Math.round(ticks / frames)); R.frame(0.033); }
    }
    const wasSpeed = FS.G.speed;
    FS.setSpeed(1);
    const a = snap();
    run(60, 30);                        // 6 game-seconds
    const b = snap();
    const moved = a.off && (Math.abs(a.off[0] - b.off[0]) > 1e-4 || Math.abs(a.off[1] - b.off[1]) > 1e-4);
    const opChanged = Math.abs(a.op - b.op) > 1e-4;
    let foamChanged = false;
    if (a.foam && b.foam) for (let i = 0; i < a.foam.length; i++) if (Math.abs(a.foam[i] - b.foam[i]) > 1e-3) foamChanged = true;
    // …and with the clock stopped nothing moves at all
    FS.setSpeed(0);
    const p0 = snap();
    for (let i = 0; i < 30; i++) R.frame(0.033);
    const p1 = snap();
    const frozen = p0.off[0] === p1.off[0] && p0.off[1] === p1.off[1] && p0.op === p1.op;
    FS.setSpeed(wasSpeed || 1);
    return { moved, opChanged, foamChanged, frozen,
      foamN: foam ? foam.count : 0, sparkLayer: !!sc.getObjectByName("sparkle") };
  });
  t.check("the shimmer sheet scrolls across the water", water.moved, water);
  t.check("…and breathes on a sine so it never reads as a sliding tile", water.opChanged, water);
  t.check("shoreline surf is drawn and pulses", water.foamN > 20 && water.foamChanged, water);
  t.check("…and a PAUSED world stops the water dead (2026-08-02: game time, not wall time)",
    water.frozen === true, water);
  t.check("the twinkling sun glints are gone (2026-08-02, player's call)",
    water.sparkLayer === false, water);

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
    /* RESTAGED 2026-08-02: FSFX gets GAME time now (fs-render hands it
     * dt × the sim speed), so a jump animated with the clock paused would never
     * leave the water. Run the sim beside the frames. */
    FS.setSpeed(1);
    let peak = 0, drops = 0, ended = false;
    const ringAtTakeoff = spawned.rings > 0;
    for (let i = 0; i < 64; i++) {
      FS.ff(1); R.frame(0.033);
      const inf = FSFX.info();
      const m = R.scene().getObjectByName("fx").getObjectByName("fx:fish");
      if (m && m.count > 0) peak = Math.max(peak, m.instanceMatrix.array[13]);
      drops = Math.max(drops, inf.fish === 0 ? drops : inf.drops);
      if (inf.drops > drops) drops = inf.drops;
      /* "the jump ends" is a statement about THIS jump, so watch for the pool
       * emptying rather than comparing endpoint counts: the ambient spawner is
       * still running underneath and will happily start another fish. */
      if (inf.fish === 0) ended = true;
    }
    const after = FSFX.info();
    return { oddsRich, oddsDead, before, spawnedN: spawned.fish, peak: +peak.toFixed(2),
      ringAtTakeoff, drops, ended, live: after.fish, waterCand: after.waterCand, pools: after.pools };
  });
  t.check("a jump can be injected deterministically", fish.spawnedN === fish.before + 1, fish);
  t.check("the fish leaves the water on an arc", fish.peak > 0.4, fish);
  /* 2026-08-02: the LANDING ring is gone — it expanded to 1.9 units while
   * fading its colour toward black on an ordinary blended material, which is
   * the "black circle on the water" the player reported. White spray is the
   * splash now; the ripple where the fish BREAKS the surface stays. */
  t.check("it breaks the surface with a ripple…", fish.ringAtTakeoff, fish);
  t.check("…and lands in white spray, with no dark ring behind it", fish.drops > 0, fish);
  t.check("and the jump ends (the pool empties, no leak)", fish.ended && fish.live <= 2, fish);
  t.check("rich water is livelier than dead water", fish.oddsRich > 0.5 && fish.oddsDead === 0, fish);
  t.check("open-water jump sites were found across the map", fish.waterCand > 50, fish);
  t.check("FX pools cover fish, splash, droplets, birds, butterflies, leaves and dust",
    ["fish", "ring", "drop", "bird", "fly", "leaf", "dust"].every((k) => fish.pools.indexOf(k) >= 0), fish.pools);

  // ════════════════════════════════════════════════════ 5. building charm
  const blds = await page.evaluate(() => {
    const FS = window.__FS__, FSC = FS.FSC, M = FS.FSModels;
    const out = { max: 0, textured: 0, withProps: 0, chimneys: [], noProps: [], n: 0 };
    out.over = [];
    for (const ty of FSC.BLD_LIST.concat(["castle"])) {
      const d = M.buildingDetail(ty);
      out.n++;
      if (d.tris > FSC.VIS.BLD_TRI_MAX) out.over.push([ty, d.tris]);
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
  t.check("no model exceeds the budget (castle included)", blds.over.length === 0, blds.over);

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
    /* ===== PHASE P: the column is a pooled spawn/age model now (puffs are
     * BORN at the chimney, swell, drift and die) instead of five modulo slots
     * teleporting back to the stack, so the window has to be long enough for
     * a column to form and, on the way down, for the puffs already in the air
     * to finish their lives. Same contract, honest timing: idle = no smoke at
     * all, working = a real column. ===== */
    B1.working = false; B2.working = false;
    for (let i = 0; i < 120; i++) R.frame(0.033);
    const idle = (R.dynamicInfo().pools.smoke || { count: 0 }).count;
    B1.working = true; B2.working = true;
    for (let i = 0; i < 60; i++) R.frame(0.033);
    const busy = (R.dynamicInfo().pools.smoke || { count: 0 }).count;
    // …and it TRAILS OFF rather than being cut dead the instant work stops
    B1.working = false; B2.working = false;
    for (let i = 0; i < 6; i++) R.frame(0.033);
    const justStopped = (R.dynamicInfo().pools.smoke || { count: 0 }).count;
    for (let i = 0; i < 240; i++) R.frame(0.033);      // ~8 s: taper + the longest puff life
    const cooled = (R.dynamicInfo().pools.smoke || { count: 0 }).count;
    return { idle, busy, justStopped, cooled };
  });
  t.check("an idle chimney is cold", smoke.idle === 0, smoke);
  t.check("a working one smokes", smoke.busy >= 5, smoke);
  t.check("the column trails off after work stops instead of being cut dead",
    smoke.justStopped >= 5 && smoke.cooled === 0, smoke);

  // ════════════════════════════════════════════════════ 6. people stay instanced
  const people = await page.evaluate(async () => {
    const FS = window.__FS__, FSC = FS.FSC, M = FS.FSModels;
    await M.castLoaded;                       // null by default — the cast is opt-in
    const tris = M.triCount;                  // index-aware: bodies ship INDEXED
    const serf = tris(M.serfGeo(FSC.JOB.LUMBERJACK, 0));
    const carrier = tris(M.serfGeo(FSC.JOB.TRANSPORTER, 0));
    const knight = tris(M.knightGeo(3, 0));
    // the same (job, player) must return the SAME cached geometry object
    const same = M.serfGeo(FSC.JOB.LUMBERJACK, 0) === M.serfGeo(FSC.JOB.LUMBERJACK, 0);
    const diffJob = M.serfGeo(FSC.JOB.FARMER, 0) !== M.serfGeo(FSC.JOB.LUMBERJACK, 0);
    const diffPlayer = M.serfGeo(FSC.JOB.LUMBERJACK, 1) !== M.serfGeo(FSC.JOB.LUMBERJACK, 0);
    const diffRank = M.knightGeo(0, 0) !== M.knightGeo(3, 0);
    return { serf, carrier, knight, same, diffJob, diffPlayer, diffRank, castOn: M.castOn() };
  });
  t.check("a serf is one merged mesh per (job, player), cached",
    people.same && people.diffJob && people.diffPlayer, people);
  t.check("knights differ by rank as well", people.diffRank, people);
  /* The villager body is a sculpt, so the old ~300-triangle minifig ceiling is
   * gone; what still has to hold is that a person stays a PERSON-sized budget
   * (the shipped LOD cut, not the 6000-triangle inspection cut) and that a
   * knight is dressed rather than rebuilt — his surcoat and helm are dyed into
   * the same body, so he must cost a serf's triangles, not several. */
  t.check("a serf stays inside the person budget",
    people.castOn ? (people.serf > 1000 && people.serf < 2600) : (people.serf > 180 && people.serf < 400), people);
  t.check("a knight is a dressed serf, not a second model",
    people.knight < people.serf * 1.6, people);
  t.check("carriers get their own silhouette (the pack)", people.carrier !== people.serf, people);

  /* ═════════════ 6a. THE DEFAULT CAST IS THE FORK B SPRITE SHEETS ═══════════
   * 2026-08-01: serfs and knights render from baked sheets under a yaw-locked
   * camera. The load-bearing halves are the NETWORK (the sheets are fetched, the
   * villager still is not) and the POOLS (the 3D people are not built at all),
   * so both are proven by watching the wire and the pool table, not by reading a
   * flag.
   *
   * TWO LOOKS, ONE CONTRACT (2026-08-01, dwarf+knight adoption): the sheets now
   * come in two interchangeable sets and `dwarfknight` is the default. Nothing
   * here names one: the suite asks the renderer which look is live and then
   * holds THAT look's manifest to the contract. A check that hard-codes "minifig"
   * or "119 hidden cells" is testing a bake, not the game.
   *
   *   PRECEDENCE: chosen look > the other look > cast opt-in > procedural minifig
   */
  {
    const plain = await t.browser.newPage();
    await plain.setViewport({ width: 900, height: 640, deviceScaleFactor: 1 });
    const asked = [], sheetReq = [];
    const perr = [];
    plain.on("pageerror", (e) => perr.push(String((e && e.message) || e)));
    await plain.setRequestInterception(true);
    plain.on("request", (req) => {
      const u = req.url();
      if (/cast\/villager\/.*\.glb$/.test(u)) asked.push(u);
      if (/cast\/sprites(-[a-z0-9]+)?\//.test(u)) sheetReq.push(u.split("/").pop());
      return u.startsWith(t.BASE) ? req.continue() : req.abort();
    });
    await plain.goto(t.BASE + "/castlekruzer.html", { waitUntil: "domcontentloaded" });
    await plain.waitForFunction(() => !!window.__FS__, { timeout: 30000 });
    const def = await plain.evaluate(async () => {
      const FS = window.__FS__, M = FS.FSModels, R = FS.FSRender, FSC = FS.FSC;
      await R.spritesLoaded;
      FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
      R.setQuality(1); FS.setSpeed(1); FS.ff(2500);
      for (let i = 0; i < 6; i++) R.frame(0.033);
      const d = R.dynamicInfo();
      return {
        spr: R.spriteInfo(), looks: R.spriteInfo().looks,
        castOn: M.castOn(), loadStarted: !!M.castLoaded, castFlag: M.cast.on,
        peoplePools: Object.keys(d.pools).filter((k) => /^(serf|knight)/.test(k)),
        serfs: Object.keys(FS.G.serfs).length, drawn: d.serfs, draws: R.stats().drawCalls,
        camYaw: R.camState().yaw, yawStart: FSC.CAM.YAW_START,
      };
    });
    await plain.close();
    console.log("   default cast:", JSON.stringify(def.spr), "sheets:", sheetReq.length, "glb:", asked.length);
    t.check("the DEFAULT people are the baked Fork B sprites",
      def.spr.active === true && def.spr.ready === true, def);
    t.check("…from the DWARFKNIGHT look, with the minifig set still one flag away",
      def.spr.look === "dwarfknight" && def.spr.source === "dwarfknight"
      && def.spr.lookFellBack === false && def.looks.indexOf("minifig") >= 0, def.spr);
    t.check("…and all five sheets plus the manifest really came off the wire",
      sheetReq.length === 6 && sheetReq.indexOf("manifest.json") >= 0
      && sheetReq.indexOf("serf-body.png") >= 0 && sheetReq.indexOf("knight-mask.png") >= 0
      && sheetReq.indexOf("overlays.png") >= 0, sheetReq);
    t.check("…while a default boot still never asks for the villager's GLBs",
      asked.length === 0 && def.loadStarted === false, { asked, castFlag: def.castFlag });
    t.check("…so no 3D people pool is ever built",
      def.peoplePools.length === 0, def.peoplePools);
    t.check("…and the whole workforce costs at most three draw calls",
      def.spr.calls > 0 && def.spr.calls <= 3 && def.spr.counts.serf > 0, def.spr);
    /* RESTAGED 2026-08-01: the yaw is FREE, so "is the camera sitting on the
     * bake's own yaw" is no longer the contract. What replaced it is the
     * LIGHTING MODE — a rotating camera may only draw camera-relative sheets,
     * and fs-render refuses anything else at load rather than drawing the whole
     * cast lit from the wrong side. */
    t.check("…lit CAMERA-RELATIVE, which is what a rotating camera requires",
      def.spr.lighting === "camera-relative", def.spr);
    t.check("…and the settlement fills with people", def.serfs >= 8 && def.drawn >= 1, def);
    t.check("…with zero page errors", perr.length === 0, perr.slice(0, 5));
  }

  /* ── 6a-ii. THE OTHER LOOK IS REALLY THERE, and the fallback is a LOOK ─────
   * The minifig set has to keep working or "one flag away" is a slogan. This is
   * a smoke pass, not a second copy of the contract: its sheets load, its cells
   * resolve, its tint channel is live, and — the part that is easy to get wrong —
   * a chosen look that fails to arrive falls through to the OTHER LOOK before it
   * ever falls through to 3D. */
  {
    const mini = await t.browser.newPage();
    await mini.setViewport({ width: 900, height: 640, deviceScaleFactor: 1 });
    const mperr = [];
    mini.on("pageerror", (e) => mperr.push(String((e && e.message) || e)));
    await mini.setRequestInterception(true);
    mini.on("request", (req) => (req.url().startsWith(t.BASE) ? req.continue() : req.abort()));
    await mini.goto(t.BASE + "/castlekruzer.html?look=minifig", { waitUntil: "domcontentloaded" });
    await mini.waitForFunction(() => !!window.__FS__, { timeout: 30000 });
    const mi = await mini.evaluate(async () => {
      const FS = window.__FS__, R = FS.FSRender;
      await R.spritesLoaded;
      FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
      R.setQuality(1); FS.setSpeed(1); FS.ff(2500);
      for (let i = 0; i < 6; i++) R.frame(0.033);
      const d = R.dynamicInfo();
      const cells = [0, 2, 5].map((az) => R.spriteResolve({ kind: "serf", pose: "idle", yaw: az * Math.PI / 3 }));
      const kn = R.spriteResolve({ kind: "knight", pose: "fight", l: 1.0 });
      return { spr: R.spriteInfo(), cells, kn,
        pools: Object.keys(d.pools).filter((k) => /^(serf|knight)/.test(k)) };
    });
    await mini.close();
    console.log("   minifig look:", JSON.stringify(mi.spr.look), "calls", mi.spr.calls);
    t.check("?look=minifig really loads the minifig sheets",
      mi.spr.look === "minifig" && mi.spr.source === "minifig" && mi.spr.active === true, mi.spr);
    t.check("…draws the workforce as sprites, not 3D", mi.spr.counts.serf > 0 && mi.pools.length === 0, mi);
    t.check("…and its cells still resolve on the same rules",
      mi.cells.every((c) => c && c.cell >= 0) && mi.kn && mi.kn.pose === "fight", mi);
    t.check("…with zero page errors", mperr.length === 0, mperr.slice(0, 5));

    /* the chosen look is blocked on the wire — the OTHER look must take over */
    const fell = await t.browser.newPage();
    await fell.setViewport({ width: 900, height: 640, deviceScaleFactor: 1 });
    await fell.setRequestInterception(true);
    fell.on("request", (req) => {
      if (!req.url().startsWith(t.BASE)) return req.abort();
      return /cast\/sprites-dwarfknight\//.test(req.url()) ? req.abort() : req.continue();
    });
    await fell.goto(t.BASE + "/castlekruzer.html?look=dwarfknight", { waitUntil: "domcontentloaded" });
    await fell.waitForFunction(() => !!window.__FS__, { timeout: 30000 });
    const fb = await fell.evaluate(async () => {
      const FS = window.__FS__, R = FS.FSRender;
      const ok = await R.spritesLoaded;
      FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
      R.setQuality(1); FS.setSpeed(1); FS.ff(2000);
      for (let i = 0; i < 5; i++) R.frame(0.033);
      const d = R.dynamicInfo();
      return { ok, spr: R.spriteInfo(), pools: Object.keys(d.pools).filter((k) => /^(serf|knight)/.test(k)) };
    });
    await fell.close();
    console.log("   look fallback:", JSON.stringify(fb.spr.look), fb.spr.lookFellBack);
    t.check("a missing look falls back to the OTHER LOOK before it falls back to 3D",
      fb.ok === true && fb.spr.look === "minifig" && fb.spr.lookFellBack === true
      && fb.spr.active === true && fb.pools.length === 0, fb);
  }

  /* ═════════════════════ 6b. THE SPRITE CONTRACT, cell by cell ══════════════
   * Everything here is the manifest's own documented rule, asserted against the
   * code that draws it — the frame lookup, the azimuth grid, the two tint
   * channels, the generated anchors, the hidden-cell skip and the door fade. */
  const sprC = await page.evaluate(async () => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC;
    await R.spritesLoaded;
    const MAN = R.SPR.man, out = { info: R.spriteInfo() };

    /* (1) RELATIVE AZIMUTH (restaged 2026-08-01, the camera turns again).
     * The old check was "all six 60° hex headings land on an EXACT cell", which
     * mattered only under a LOCKED yaw: a standing serf then had one fixed
     * relative angle forever, so a count that did not divide 60° rendered him
     * permanently wrong. With free rotation the relative azimuth is CONTINUOUS —
     * every angle in between happens as you turn — so the honest contract is the
     * quantiser's: the shown angle is never more than half a step from the true
     * one, at any facing and from any camera. Swept over both, finely. */
    const step = 360 / MAN.bake.azimuths;
    out.step = step;
    out.worstErr = 0;
    out.relOK = true;
    for (let cy = 0; cy < 360; cy += 17) {                  // camera yaws, coprime-ish stride
      for (let uy = 0; uy < 360; uy += 3) {                 // unit facings
        const r = R.spriteResolve({ kind: "serf", pose: "idle",
          yaw: uy * Math.PI / 180, camYaw: cy * Math.PI / 180 });
        if (!(r.az >= 0 && r.az < MAN.bake.azimuths)) { out.relOK = false; break; }
        const shown = r.az * step, want = uy - cy;
        const err = Math.abs(((shown - want) + 540) % 360 - 180);
        if (err > out.worstErr) out.worstErr = err;
      }
    }
    out.worstErr = +out.worstErr.toFixed(6);
    /* …and the same lookup is RELATIVE: turning the camera by exactly one step
     * must advance the cell by exactly one, in the opposite direction. */
    out.rel = [0, 1, 2, 3].map((i) => R.spriteResolve({ kind: "serf", pose: "idle",
      yaw: 0, camYaw: i * step * Math.PI / 180 }).az);
    /* …and the wrap: just under 2π must come back to azimuth 0, not A */
    out.wrap = [R.spriteResolve({ kind: "serf", pose: "idle", yaw: -0.001, camYaw: 0 }).az,
      R.spriteResolve({ kind: "serf", pose: "idle", yaw: Math.PI * 2 - 0.001, camYaw: 0 }).az,
      R.spriteResolve({ kind: "serf", pose: "idle", yaw: Math.PI * 6 + 0.001, camYaw: 0 }).az];

    /* (2) WALK FRAMES follow the gait phase, one step at a time, all the way
     * round. Same clock the 3D legs swing on (vis.phase). */
    const n = MAN.subjects.serf.poses.walk.rows;
    out.walkSeq = [];
    for (let i = 0; i < 4 * n; i++) {
      out.walkSeq.push(R.spriteResolve({ kind: "serf", pose: "walk", phase: i * (Math.PI * 2 / (4 * n)) }).k);
    }
    out.walkRows = n;
    out.workSeq = [0, 0.2, 0.4, 0.6, 0.8, 1].map((s) => R.spriteResolve({ kind: "serf", pose: "work", swing: s }).k);
    /* (3) FIGHT frames are picked by duelPose's own `l`, guard included */
    out.fight = [0, -0.34, 1.0, 0.5].map((l) => {
      const r = R.spriteResolve({ kind: "knight", pose: "fight", l });
      return { l, pose: r.pose, k: r.k };
    });

    /* (4) ANCHORS are generated, so every one has to land inside its own cell,
     * and every overlay's composed placement inside a body-cell of it. */
    const B = MAN.bake;
    let badAnchor = 0, anchors = 0, badPivot = 0, pivots = 0, empty = 0, ovCells = 0, farPlace = 0;
    ["serf", "knight"].forEach((kind) => {
      const P = MAN.subjects[kind].poses;
      for (const pose in P) P[pose].frames.forEach((f) => f.cells.forEach((c) => {
        for (const a in c.anchors) {
          anchors++;
          const p = c.anchors[a];
          if (!(p.x >= 0 && p.x <= B.bodyCell && p.y >= 0 && p.y <= B.bodyCell)) badAnchor++;
        }
      }));
    });
    for (const id in MAN.overlays) {
      const ov = MAN.overlays[id];
      for (const rk in ov.rows) ov.rows[rk].forEach((c, az) => {
        ovCells++;
        if (c.empty) { empty++; return; }
        pivots++;
        if (!(c.pivotPx.x >= 0 && c.pivotPx.x <= B.overlayCell && c.pivotPx.y >= 0 && c.pivotPx.y <= B.overlayCell)) badPivot++;
        const host = MAN.subjects[ov.host].poses;
        const anchorName = id === "pip" ? "pip0" : (id.indexOf("tool_") === 0 ? "tool" : id);
        const hf = (host.idle || host.guard).frames[0].cells[az];
        const pl = R.spriteOverlayCell(id, "hold", az, hf.anchors[anchorName]);
        if (pl && (Math.abs(pl.ox) > 1.4 || Math.abs(pl.oy) > 1.4)) farPlace++;
      });
    }
    out.anchors = { anchors, badAnchor, pivots, badPivot, empty, ovCells, farPlace };

    /* (5) THE HIDDEN CELLS. Some overlay cells are fully occluded by their host
     * body at their angle; the draw path must return nothing for those. HOW MANY
     * is a property of the bake (the bulkier dwarf hides more of his own pack
     * than the minifig did), so the count is READ OFF THE MANIFEST and the
     * assertion is that the draw path skips exactly the cells the bake flagged —
     * which is the actual contract. */
    out.manifestEmpty = MAN.bake.overlayEmptyCells;
    let emptySkipped = 0, emptyProbed = 0;
    for (const id in MAN.overlays) {
      const ov = MAN.overlays[id];
      for (const rk in ov.rows) ov.rows[rk].forEach((c, az) => {
        if (!c.empty) return;
        emptyProbed++;
        const host = MAN.subjects[ov.host].poses;
        const anchorName = id === "pip" ? "pip0" : (id.indexOf("tool_") === 0 ? "tool" : id);
        const hf = (host.idle || host.guard).frames[0].cells[az];
        if (R.spriteOverlayCell(id, rk, az, hf.anchors[anchorName]) === null) emptySkipped++;
      });
    }
    out.emptySkip = { emptyProbed, emptySkipped };

    /* (6) THE OVERLAYS FOLLOW THE CAMERA (2026-08-01). Turning the world must
     * re-resolve a serf's cell AND move his hat and tool with it — a cap that
     * kept its cell while the body changed would sit on his shoulder. Drive it
     * through the SAME resolver the draw path uses, at eight camera yaws, for a
     * unit whose facing never changes: the azimuth must walk, and every
     * composed overlay must stay on the body (the same ≤1.4-quad bound the
     * static placement check uses). */
    const seen = new Set();
    let rotBad = 0, rotProbes = 0, rotMissing = 0;
    for (let i = 0; i < 8; i++) {
      const cy = i * Math.PI / 4;
      const r = R.spriteResolve({ kind: "serf", pose: "idle", yaw: 0.7, camYaw: cy });
      seen.add(r.az);
      ["hat", "tool", "pack"].forEach((id) => {
        const oid = id === "tool" ? "tool_axe" : id;
        const anchor = r.anchors[id];
        if (!anchor) return;
        rotProbes++;
        const pl = R.spriteOverlayCell(MAN.overlays[oid] ? oid : "tool_default", r.rowKey, r.az, anchor);
        if (!pl) { rotMissing++; return; }              // legitimately hidden at this angle
        if (Math.abs(pl.ox) > 1.4 || Math.abs(pl.oy) > 1.4) rotBad++;
      });
    }
    out.rotate = { azimuths: seen.size, rotProbes, rotBad, rotMissing };
    return out;
  });
  console.log("   sprite contract:", JSON.stringify(sprC.anchors), JSON.stringify(sprC.emptySkip));
  t.check("the sheets index 16 azimuths at the baked pitch, lit camera-relative",
    sprC.info.azimuths === 16 && sprC.info.pitchDeg === 52 && sprC.info.cameraYaw === 0
    && sprC.info.lighting === "camera-relative", sprC.info);
  t.check("the azimuth is RELATIVE and never off by more than half a step",
    sprC.relOK && sprC.worstErr <= sprC.step / 2 + 1e-6, { worstErr: sprC.worstErr, step: sprC.step });
  t.check("…turning the camera one step advances the cell one step, the other way",
    sprC.rel.join() === [0, sprC.info.azimuths - 1, sprC.info.azimuths - 2, sprC.info.azimuths - 3].join(), sprC.rel);
  t.check("…and the azimuth wraps instead of running off the sheet",
    sprC.wrap.every((a) => a === 0), sprC.wrap);
  t.check("the walk frame advances one step at a time with the gait phase",
    (() => {
      const s = sprC.walkSeq, n = sprC.walkRows;
      if (new Set(s).size !== n) return false;                 // every frame is used
      for (let i = 1; i < s.length; i++) {
        const d = (s[i] - s[i - 1] + n) % n;
        if (d > 1) return false;                               // never skips a frame
      }
      return true;
    })(), sprC.walkSeq);
  t.check("work frames are uniform in the swing, 0 → 1",
    sprC.workSeq.join() === "0,1,2,3,4,5", sprC.workSeq);
  t.check("a duel picks the nearest fight frame, and guard when guard is nearest",
    sprC.fight[0].pose === "guard" && sprC.fight.slice(1).every((f) => f.pose === "fight"), sprC.fight);
  t.check("every generated anchor lands inside its own cell",
    sprC.anchors.anchors > 1000 && sprC.anchors.badAnchor === 0, sprC.anchors);
  t.check("…every overlay pivot too, and every composed placement stays on the body",
    sprC.anchors.pivots > 500 && sprC.anchors.badPivot === 0 && sprC.anchors.farPlace === 0, sprC.anchors);
  t.check("every overlay cell the bake flagged hidden is skipped by the draw path",
    sprC.emptySkip.emptyProbed > 40 && sprC.emptySkip.emptyProbed === sprC.manifestEmpty
    && sprC.emptySkip.emptySkipped === sprC.emptySkip.emptyProbed, sprC.emptySkip);
  t.check("turning the camera walks a still unit's cell through the sheet…",
    sprC.rotate.azimuths === 8, sprC.rotate);
  t.check("…and his hat and tool come with it, still on the body",
    sprC.rotate.rotProbes >= 8 && sprC.rotate.rotBad === 0, sprC.rotate);

  /* ── 6b-ii. the two tint channels, read off the SCREEN ────────────────────
   * Team colour and knight rank trim are not baked: they are white regions in
   * the body sheet, marked R and G in the mask. So the proof is a repaint —
   * change the palette entry, render the same man again, and see which pixels
   * move. If the mask were ignored the WHOLE man would change colour; if it
   * were broken, none of him would. */
  const tintPage = await t.browser.newPage();
  /* dPR 2 on purpose: a serf's ONE team region is a single chunky sash, which
   * is a couple of dozen pixels on a 1× frame even at DIST_MIN — too few for a
   * ratio to mean much. Four times the pixels makes the same measurement solid
   * without changing what is being measured. */
  await tintPage.setViewport({ width: 900, height: 700, deviceScaleFactor: 2 });
  tintPage.on("pageerror", (e) => t.errors.push(String((e && e.message) || e)));
  await tintPage.setRequestInterception(true);
  tintPage.on("request", (req) => (req.url().startsWith(t.BASE) ? req.continue() : req.abort()));
  await tintPage.goto(t.BASE + "/castlekruzer.html", { waitUntil: "domcontentloaded" });
  await tintPage.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 30000 });
  const tint = await tintPage.evaluate(async () => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC;
    await R.spritesLoaded;
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    R.setQuality(1); FS.setSpeed(1); FS.ff(3000); FS.setSpeed(0);
    R.setTreeSway(false);                       // the crop must be frame-stable
    for (let i = 0; i < 8; i++) R.frame(0.033);
    let id = -1;
    for (const k in FS.G.serfs) { const p = R.serfPose(k | 0); if (p && p.appear > 0.99) { id = k | 0; break; } }
    if (id < 0) return { ok: false };
    const q = R.serfPose(id);
    /* RESTAGED 2026-08-02 (batch #4): FACE HIM AT THE CAMERA. This section
     * measures whether the mask's team region repaints, and it used to take
     * whichever serf came first out of G.serfs at whatever heading he happened
     * to be walking — which is a lottery over the sheets' 16 azimuths. On this
     * look the team region is his BELT and the carrier's PACK hangs over the
     * small of his back, so a serf caught at azimuth 7 (seen from behind)
     * presents almost none of it and the ratio collapses: measured 5 moved
     * pixels against the 290 the mask cell promises, on the SAME serf whose
     * front view moves 486. Nothing was broken — the staging was. Setting the
     * camera yaw to the serf's own facing puts him at relative azimuth 0, so
     * the check measures the mask rather than the luck of the draw.
     * (Construction now runs 1.5x faster, which is what moved the draw.) */
    R.setCam({ tx: q.x, tz: q.z, ty: q.y, dist: FSC.CAM.DIST_MIN,
      yaw: q.yaw + (R.SPR.man.bake.cameraYaw || 0) });
    const gl = R.renderer().getContext();
    const pr = R.renderer().getPixelRatio();
    const W = R.renderer().domElement.width, H = R.renderer().domElement.height;
    const C = 240;
    function grab() {
      R.frame(1e-6);
      const s = R.worldToScreen(q.x, q.y + 0.44, q.z);
      const x0 = Math.max(0, Math.min(W - C, Math.round(s.x * pr - C / 2)));
      const y0 = Math.max(0, Math.min(H - C, Math.round(H - s.y * pr - C / 2)));
      const b = new Uint8Array(C * C * 4);
      gl.readPixels(x0, y0, C, C, gl.RGBA, gl.UNSIGNED_BYTE, b);
      return b;
    }
    const keep = FSC.PLAYER_COLORS.slice();
    const p = FS.G.serfs[id].p;
    R.setSpriteTrace(true);
    R.frame(1e-6);
    const rec = R.spritePose(id);            // which cell is actually on screen
    // how much of the crop is the MAN at all (sprites hidden vs shown)
    R.setSprites(false); const bg = grab();
    R.setSprites(true); FSC.PLAYER_COLORS[p] = 0xff0000; const red = grab();
    FSC.PLAYER_COLORS[p] = 0x00ff00; const grn = grab();
    FSC.PLAYER_COLORS.length = 0; keep.forEach((c) => FSC.PLAYER_COLORS.push(c));
    R.setTreeSway(true);
    R.frame(1e-6);
    let body = 0, moved = 0, redder = 0, greener = 0;
    for (let i = 0; i < red.length; i += 4) {
      const dBg = Math.abs(red[i] - bg[i]) + Math.abs(red[i + 1] - bg[i + 1]) + Math.abs(red[i + 2] - bg[i + 2]);
      if (dBg > 24) body++;
      const d = Math.abs(red[i] - grn[i]) + Math.abs(red[i + 1] - grn[i + 1]) + Math.abs(red[i + 2] - grn[i + 2]);
      if (d > 40) {
        moved++;
        if (red[i] > red[i + 1] + 20) redder++;
        if (grn[i + 1] > grn[i] + 20) greener++;
      }
    }
    /* WHAT SHOULD HAVE MOVED. The team region is whatever the mask sheet says it
     * is, and that differs per look (the dwarf wears a chunky shoulder yoke, the
     * minifig a thin sash), so the expected fraction is MEASURED off the mask
     * sheet's own cell rather than typed in as a magic band. The tolerance is
     * wide on purpose: the on-screen "body" mask is a sprites-on/off difference,
     * which is a coarser silhouette than the sheet's own alpha. */
    let expect = null;
    try {
      const MAN = R.SPR.man;
      const ms = MAN.sheets[MAN.subjects.serf.mask];
      const dir = R.SPR_LOOKS[R.spriteInfo().look];
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dir + ms.file; });
      const cv = document.createElement("canvas");
      cv.width = im.width; cv.height = im.height;
      const cx2 = cv.getContext("2d");
      cx2.drawImage(im, 0, 0);
      const col = rec ? (rec.cell % ms.cols) : 0, row = rec ? Math.floor(rec.cell / ms.cols) : 0;
      const d2 = cx2.getImageData(col * ms.cell, row * ms.cell, ms.cell, ms.cell).data;
      let op = 0, team = 0;
      for (let i = 0; i < d2.length; i += 4) {
        if (d2[i + 3] < 128) continue;
        op++;
        if (d2[i] > 128) team++;
      }
      expect = op ? +(team / op).toFixed(3) : null;
    } catch (e) { expect = null; }
    return { ok: true, body, moved, redder, greener, expect, cell: rec ? rec.cell : null,
      frac: body ? +(moved / body).toFixed(3) : 0 };
  });
  await tintPage.close();
  console.log("   tint probe:", JSON.stringify(tint));
  t.check("the man is actually on screen for the tint probe", tint.ok && tint.body > 800, tint);
  t.check("repainting the team colour moves pixels — the mask R region is live",
    tint.ok && tint.moved > 25, tint);
  t.check("…and ONLY that region, in the proportion the MASK SHEET itself says",
    tint.ok && tint.frac > 0.005 && tint.expect !== null
    && tint.frac > tint.expect * 0.2 && tint.frac < tint.expect * 2.5, tint);
  /* A majority, not all of them: the sash's own shading runs dark at the fold,
   * and the tint formula adds the game's 0.34 emissive lift back on top of it,
   * so the darkest sash pixels land near-grey under any hue. */
  t.check("…and the moved pixels actually take the colour they were given",
    tint.ok && tint.redder > tint.moved * 0.5 && tint.greener > tint.moved * 0.5, tint);

  /* ══ 6b-iv. THE LOAD IS IN HIS HANDS, AND ONLY ONE ARM SWINGS ══════════════
   * Two playtest bugs from batch #5, on BOTH looks, asserted the way they were
   * diagnosed:
   *  · the carried good came out at the settler's FEET (measured −0.015 world
   *    units on the shipping look — below his boots) because the seat dropped
   *    it by 0.30 of the shared 0.551-unit QUAD instead of a fraction of the
   *    good's own height. So: where the good is actually seated, against the
   *    hands anchor that decides it and against his own height.
   *  · the work swing raised BOTH arms on one scalar. So: how far the tool hand
   *    and the OFF hand travel through a full stroke, measured RELATIVE TO THE
   *    TORSO (the `pack` anchor) — the off hand rides the body's lean and bob
   *    whatever it does, and that is not arm movement. */
  for (const look of ["dwarfknight", "minifig"]) {
    const lp = await t.browser.newPage();
    await lp.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
    lp.on("pageerror", (e) => t.errors.push(String((e && e.message) || e)));
    await lp.setRequestInterception(true);
    lp.on("request", (req) => (req.url().startsWith(t.BASE) ? req.continue() : req.abort()));
    await lp.goto(t.BASE + "/castlekruzer.html?look=" + look, { waitUntil: "domcontentloaded" });
    await lp.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 60000 });
    const arms = await lp.evaluate(async () => {
      const FS = window.__FS__, R = FS.FSRender;
      await R.spritesLoaded;
      if (R.loadGoodSprites) await R.loadGoodSprites();
      const M = R.spriteInfo();
      const step = Math.PI * 2 / M.azimuths;
      const rows = [];
      for (let az = 0; az < M.azimuths; az++) {
        const tl = [], of = [], pk = [];
        for (let k = 0; k < 6; k++) {
          const c = R.spriteResolve({ kind: "serf", pose: "work", swing: k / 5, yaw: az * step, camYaw: 0 });
          if (!c || !c.anchors.offhand) return { look: M.look, noOffhand: true };
          tl.push([c.anchors.tool.x, c.anchors.tool.y]);
          of.push([c.anchors.offhand.x, c.anchors.offhand.y]);
          pk.push([c.anchors.pack.x, c.anchors.pack.y]);
        }
        const span = (a) => Math.hypot(
          Math.max.apply(null, a.map((p) => p[0])) - Math.min.apply(null, a.map((p) => p[0])),
          Math.max.apply(null, a.map((p) => p[1])) - Math.min.apply(null, a.map((p) => p[1])));
        const rel = (a) => a.map((p, i) => [p[0] - pk[i][0], p[1] - pk[i][1]]);
        rows.push({ tool: span(rel(tl)), off: span(rel(of)), torso: span(pk), offAbs: span(of) });
      }
      const mx = (k) => Math.max.apply(null, rows.map((r) => r[k]));
      return { look: M.look, tool: +mx("tool").toFixed(1), off: +mx("off").toFixed(1),
        torso: +mx("torso").toFixed(1), offAbs: +mx("offAbs").toFixed(1) };
    });
    t.check(look + ": the sheets carry an off-hand anchor to measure", !arms.noOffhand && arms.look === look, arms);
    t.check(look + ": a work stroke swings the TOOL arm, not both",
      arms.off < arms.tool * 0.45, arms);
    t.check(look + ": …the off hand only rides the torso's own lean",
      arms.offAbs < arms.torso * 1.35, arms);

    const carried = await lp.evaluate(() => {
      const FS = window.__FS__, R = FS.FSRender, FSMap = FS.FSMap, FSSim = FS.FSSim;
      FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0, aiPlan: false });
      const G = FS.G;                       // AFTER newGame — the old handle is stale
      R.setQuality(1); R.setSpriteTrace(true);
      // a settlement, so there is something to haul
      const castle = FSSim.castleOf(G, 0), from = G.flags[castle.flag];
      for (const type of ["lumberjack", "sawmill", "forester"]) {
        let best = -1;
        FSMap.forRadius(G.map, castle.v, 12, (u, d) => {
          if (best >= 0 || d < 4) return;
          if (!FSMap.canPlaceBuilding(type, u, 0)) return;
          if (!FSSim.roadPath(G, from.v, FSMap.doorVertex(G.map, u), 0)) return;
          best = u;
        });
        if (best < 0) continue;
        const r = FSSim.build(G, type, best, 0);
        if (!r || !r.id) continue;
        const b = G.buildings[r.id];
        const p = FSSim.roadPath(G, from.v, G.flags[b.flag].v, 0);
        if (p) FSSim.buildRoad(G, from.id, b.flag, p, 0);
      }
      FS.ff(1200);
      const seen = [];
      for (let i = 0; i < 5000 && seen.length < 30; i++) {
        FS.ff(1);
        /* ONE frame at the tick's own dt. Stepping the visual layer twice per
         * tick (a syncDynamic AND a frame) runs every settler to the end of his
         * edge, and every sample then reads back speed 0 — which is how this
         * check first reported "0 walking, 30 standing". */
        /* SWEEP THE CAMERA. Which cell a carrier is drawn in is his facing
         * RELATIVE to the camera, and a load held in front projects high from
         * behind him and low from in front — so a sample taken at one heading
         * measures one azimuth of sixteen. Turning the camera as the sim runs
         * puts the whole ring in the set, and the bars below are then bars on
         * the WORST azimuth, which is the one that mattered. */
        R.setCam({ yaw: (i % 32) * (Math.PI / 16) });
        R.frame(0.1);
        for (const id in G.serfs) {
          const s = G.serfs[id];
          if (!s.carry || s.state === "work" || s.state === "garrison") continue;
          const v = R.serfPose(s.id);
          if (!v || v.appear < 0.98) continue;
          const tr = R.spritePose(s.id);
          if (!tr || !tr.good) continue;
          seen.push({ res: tr.good.res, pose: tr.pose, moving: v.speed > 0.02, az: tr.az,
            hands: tr.good.handsY, base: tr.good.baseY, seat: tr.good.seatY, head: tr.good.headY });
          break;                       // one sample per tick, so the set spreads
        }
      }
      if (!seen.length) return null;
      const mn = (k) => Math.min.apply(null, seen.map((x) => x[k]));
      const poses = {};
      seen.forEach((x) => { poses[x.pose] = (poses[x.pose] || 0) + 1; });
      return { n: seen.length, poses,
        minSeat: +mn("seat").toFixed(3), minBase: +mn("base").toFixed(3), minHead: +mn("head").toFixed(3),
        worstOffHands: +Math.max.apply(null, seen.map((x) => Math.abs(x.seat - x.hands))).toFixed(3),
        moving: seen.filter((x) => x.moving).length, still: seen.filter((x) => !x.moving).length,
        azimuths: Object.keys(seen.reduce((a, x) => (a[x.az] = 1, a), {})).length,
        goods: Object.keys(seen.reduce((a, x) => (a[x.res] = 1, a), {})).length };
    });
    t.check(look + ": hauling serfs were caught with a load drawn on them",
      !!carried && carried.n >= 8, carried);
    t.check(look + ": …and every one of them walks the CARRY rows",
      !!carried && carried.poses.carry === carried.n, carried && carried.poses);
    /* THE BAR THAT WOULD HAVE FAILED BEFORE THE FIX, and it is the LOWER EDGE
     * of the load that fails it: with the old constant the good's base sat at
     * −0.015 world units on the worst azimuth of the shipping look — under the
     * settler's boots. Both edges are asserted (base clear of the ground, and
     * the load's middle a real fraction of the man's own height) because the
     * middle alone would have squeaked past. */
    t.check(look + ": …with the load carried well above his boots, never at his feet",
      !!carried && carried.minBase > carried.minHead * 0.12
      && carried.minSeat > carried.minHead * 0.33, carried);
    t.check(look + ": …seated ON the hands anchor rather than slung far off it",
      !!carried && carried.worstOffHands < carried.minHead * 0.45, carried);
    t.check(look + ": …both standing still and walking, all round the compass",
      !!carried && carried.moving > 0 && carried.still > 0 && carried.azimuths >= 6, carried);
    console.log("   " + look + ": carry base ≥ " + (carried && carried.minBase) + " seat ≥ " + (carried && carried.minSeat)
      + " (head " + (carried && carried.minHead) + ") · work swing tool "
      + arms.tool + " vs off " + arms.off);
    /* `?look=` PERSISTS to localStorage for the whole origin, so a page opened
     * later in this suite would inherit whichever look ran last. Clear it. */
    await lp.evaluate(() => { try { localStorage.removeItem("fs_look"); } catch (e) { /* noop */ } });
    await lp.close();
  }

  /* ── 6b-iii. the doorway fade survives the port ───────────────────────────
   * A serf walking into a hut shrinks toward his own foot pixel (the per-
   * instance aScale) instead of blinking out. Read the attribute the shader
   * actually consumes, not the state it came from. */
  const fade = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender;
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    R.setQuality(1); FS.setSpeed(1); FS.ff(4000);
    for (let i = 0; i < 4; i++) R.frame(0.033);
    let hit = null, seenFading = 0;
    for (let i = 0; i < 1400 && !hit; i++) {
      FS.step(0.04); R.frame(0.04);
      /* the layer object is re-created when the pool grows, so look it up each
       * time rather than caching a stale mesh */
      const layer = R.scene().getObjectByName("spr:serf");
      if (!layer || !layer.count) continue;
      for (const k in FS.G.serfs) {
        const p = R.serfPose(k | 0);
        if (!p || p.appear === undefined || p.appear <= 0.05 || p.appear >= 0.95) continue;
        seenFading++;
        const a = layer.geometry.attributes.aScale.array;
        let near = false, min = 2;
        for (let j = 0; j < layer.count; j++) { min = Math.min(min, a[j]); if (Math.abs(a[j] - p.appear) < 0.03) near = true; }
        hit = { appear: +p.appear.toFixed(3), near, min: +min.toFixed(3), count: layer.count };
        break;
      }
    }
    return { ok: true, hit, seenFading };
  });
  t.check("a serf in a doorway shrinks toward his own feet instead of blinking out",
    fade.ok && fade.hit && fade.hit.near === true && fade.hit.min < 0.98, fade);

  /* ═══════════════ 6c. THE 3D FALLBACK, still fully alive underneath ════════
   * The sheets are the only thing between the player and an empty settlement,
   * so the path below them has to keep working — and keep being TESTED. With
   * sprites switched off the game is exactly the 3D game it was, so the whole
   * pre-Fork-B people battery runs here, on the same page, through the QA
   * switch a player can reach with ?sprites=0. */
  const fbDef = await page.evaluate(() => {
    const FS = window.__FS__, M = FS.FSModels, R = FS.FSRender, FSC = FS.FSC;
    R.setSprites(false);
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    R.setQuality(1); FS.setSpeed(1); FS.ff(2500);
    for (let i = 0; i < 6; i++) R.frame(0.033);
    const d = R.dynamicInfo();
    return {
      active: R.spritesActive(), castOn: M.castOn(),
      serfTris: M.triCount(M.serfGeo(FSC.JOB.LUMBERJACK, 0)),
      hipX: M.hipOf().x, drop: M.hipOf().drop, carryY: M.carryOf().y,
      legPoolKeys: Object.keys(d.pools).filter((k) => /^(serf|knight)leg/.test(k)),
      bodyPools: Object.keys(d.pools).filter((k) => /^serf:/.test(k)),
      serfs: Object.keys(FS.G.serfs).length, drawn: d.serfs, draws: R.stats().drawCalls,
    };
  });
  console.log("   fallback (sprites off):", JSON.stringify(fbDef));
  t.check("sprites off hands the workforce straight back to the 3D minifig",
    fbDef.active === false && fbDef.castOn === false
    && fbDef.serfTris > 180 && fbDef.serfTris < 400 && fbDef.bodyPools.length > 0, fbDef);
  t.check("…on the minifig's own hips, one leg pool per body kind",
    Math.abs(fbDef.hipX - 0.075) < 0.001 && fbDef.drop === 0
    && fbDef.legPoolKeys.length > 0 && fbDef.legPoolKeys.every((k) => k === "serfleg" || k === "knightleg"), fbDef);
  t.check("…carrying at the minifig's own ride height (unchanged since Phase P)",
    Math.abs(fbDef.carryY - 0.86) < 1e-9, fbDef);
  t.check("…and the settlement still fills with people",
    fbDef.serfs >= 8 && fbDef.drawn >= 1 && fbDef.draws < 200, fbDef);

  /* ═══════════════════════════════ 6d. the villager — the one loaded asset ══
   * OPT IN (under the fallback: sprites outrank him) and everything below still
   * has to hold: he arrives over the network after the world is already being
   * drawn, he is the only thing in the game that can FAIL to arrive, and his
   * legs are authored around hips that are nothing like the minifig's. */
  const vill = await page.evaluate(async () => {
    const FS = window.__FS__, M = FS.FSModels, R = FS.FSRender, FSC = FS.FSC;
    R.setSprites(false);                      // sprites outrank the cast opt-in
    M.setCast({ on: true });                  // the opt-in switch — starts the fetches
    await M.castLoaded;
    const c = M.cast, out = { ready: c.ready, on: M.castOn(), err: c.err, detail: c.detail };
    if (!c.ready) return out;
    out.carryY = M.carryOf().y;
    out.bodyTris = M.triCount(c.body);
    out.legTris = [M.triCount(c.legL), M.triCount(c.legR)];
    out.legsDiffer = c.legL !== c.legR;
    out.bodyHasColor = !!(c.body.attributes && c.body.attributes.color);
    out.bodyIndexed = !!c.body.index;
    // the sculpt's own frame: feet at 0, crown at the measured standing height
    c.body.computeBoundingBox();
    out.bodyMin = +c.body.boundingBox.min.y.toFixed(4);
    out.bodyMax = +c.body.boundingBox.max.y.toFixed(4);

    // --- hip / foot contact, composed exactly the way pushLegs composes it ---
    const hip = M.hipOf();
    out.hip = hip;
    const src = M.serfLegGeo(1);
    // the toe: the single lowest vertex, tracked through the swing. A bounding
    // box will NOT do — the leg's upper mass counter-rotates about the hip, so
    // the box's own extremes travel backwards while the foot travels forwards.
    let toe = 0;
    const sp = src.attributes.position.array;
    for (let i = 1; i < sp.length / 3; i++) if (sp[i * 3 + 1] < sp[toe * 3 + 1]) toe = i;
    function pose(stride) {
      const g = src.clone();
      const a = stride * hip.swing * -1;                 // the +x leg's own sign
      const d = hip.drop;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(hip.x, hip.y - d + d * Math.cos(a), hip.z + d * Math.sin(a)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, 0)),
        new THREE.Vector3(1, 1, 1));
      g.applyMatrix4(m);
      g.computeBoundingBox();
      const p = g.attributes.position.array;
      const r = { minY: g.boundingBox.min.y, maxY: g.boundingBox.max.y, toeZ: p[toe * 3 + 2], toeY: p[toe * 3 + 1] };
      g.dispose();
      return r;
    }
    const mid = pose(0), fwd = pose(1), back = pose(-1);
    out.footMidY = +mid.minY.toFixed(4);
    out.footFwdY = +fwd.minY.toFixed(4);
    out.footBackY = +back.minY.toFixed(4);
    out.legTopMid = +mid.maxY.toFixed(4);
    out.strideTravel = +(fwd.toeZ - back.toeZ).toFixed(4);
    // pools only exist once something has actually been drawn since the
    // villager landed — his arrival drops every stale people-pool by design
    FS.newGame({ size: "medium", seed: 4242, ais: 1, speed: 0 });
    R.setQuality(1); FS.setSpeed(1); FS.ff(1500);
    for (let i = 0; i < 4; i++) R.frame(0.033);
    out.pools = Object.keys(R.dynamicInfo().pools).filter((k) => /^(serf|knight)/.test(k));
    return out;
  });
  console.log("   villager:", JSON.stringify(vill));
  t.check("opting in loads the villager and rebuilds the people from him",
    vill.ready === true && vill.on === true, vill);
  t.check("…and the carried load drops to HIS head, not the minifig's",
    vill.carryY > 0.78 && vill.carryY < 0.83, vill);
  t.check("…as vertex-coloured INDEXED geometry (de-indexing it would triple every serf)",
    vill.bodyHasColor === true && vill.bodyIndexed === true, vill);
  t.check("…left and right legs are genuinely different sculpts",
    vill.legsDiffer === true, vill);
  t.check("the sculpt stands on y=0 at roughly the minifig's height",
    Math.abs(vill.bodyMax - 0.79) < 0.02 && vill.bodyMin > 0.05, vill);
  t.check("the legs hang from the villager's own wide hips, not the minifig's",
    Math.abs(vill.hip.x - 0.1235) < 0.001 && vill.hip.drop > 0, vill);
  t.check("mid-stance his feet are ON the ground",
    Math.abs(vill.footMidY) < 0.02, vill);
  /* A boot toe grazes the turf at full extension on ANY of these rigs — the
   * minifig's own dipped 0.015 and shipped that way for the whole project. The
   * property worth holding is that it stays a graze and not a wade. */
  t.check("at full stride the boot only grazes the turf, never wades through it",
    vill.footFwdY > -0.02 && vill.footBackY > -0.02, vill);
  t.check("the leg still runs well above its hip, so a stride cannot open a seam",
    vill.legTopMid > 0.33, vill);
  t.check("the stride still travels far enough to read as a step",
    vill.strideTravel > 0.08, vill);
  t.check("the workforce is still drawn from a handful of pools",
    vill.pools.length > 0 && vill.pools.length < 24, vill);
  /* PRECEDENCE, the other way round: with the villager loaded AND opted in,
   * turning the sheets back on must still put sprites on screen. */
  const prec = await page.evaluate(() => {
    const FS = window.__FS__, M = FS.FSModels, R = FS.FSRender;
    R.setSprites(true);
    for (let i = 0; i < 3; i++) R.frame(0.033);
    const d = R.dynamicInfo();
    return { castOn: M.castOn(), active: R.spritesActive(),
      peoplePools: Object.keys(d.pools).filter((k) => /^(serf|knight)/.test(k)),
      counts: R.spriteInfo().counts };
  });
  t.check("sprites outrank the cast opt-in — the villager never reaches the screen while they are on",
    prec.castOn === true && prec.active === true && prec.peoplePools.length === 0
    && prec.counts.serf > 0, prec);
  await page.evaluate(() => { window.__FS__.FSModels.setCast({ on: false }); });

  /* …and the same world with the villager's files unreachable. This is the
   * only asset in the game that can fail to load, so the procedural minifig
   * has to still be there, still build a settlement, and do it without a
   * single page error — a half-loaded villager must never reach the screen.
   * Sprites are switched off here so the FALLBACK is what draws. */
  {
    const blocked = await t.browser.newPage();
    await blocked.setViewport({ width: 900, height: 640, deviceScaleFactor: 1 });
    const errs = [];
    blocked.on("pageerror", (e) => errs.push(String((e && e.message) || e)));
    blocked.on("console", (m) => {
      // the three aborted .glb fetches log ERR_FAILED by design; anything else
      // reaching the console is a real fault in the fallback path
      if (m.type() === "error" && !/net::ERR_FAILED/.test(m.text())) errs.push("console: " + m.text());
    });
    await blocked.setRequestInterception(true);
    blocked.on("request", (req) => {
      const u = req.url();
      if (!u.startsWith(t.BASE)) return req.abort();
      if (/cast\/villager\/.*\.glb$/.test(u)) return req.abort();   // the asset is gone
      return req.continue();
    });
    await blocked.goto(t.BASE + "/castlekruzer.html?sprites=0", { waitUntil: "domcontentloaded" });
    await blocked.waitForFunction(() => !!window.__FS__, { timeout: 30000 });
    const fb = await blocked.evaluate(async () => {
      const FS = window.__FS__, M = FS.FSModels, R = FS.FSRender, FSC = FS.FSC;
      M.setCast({ on: true });                // ask for him — the files are gone
      const ok = await M.castLoaded;
      FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
      R.setQuality(1); FS.setSpeed(1); FS.ff(2500);
      for (let i = 0; i < 8; i++) R.frame(0.033);
      const d = R.dynamicInfo();
      return {
        loadedOk: ok, ready: M.cast.ready, on: M.castOn(), err: M.cast.err,
        sprActive: R.spritesActive(), sprOn: R.SPR.on,
        serfTris: M.triCount(M.serfGeo(FSC.JOB.LUMBERJACK, 0)),
        knightTris: M.triCount(M.knightGeo(2, 0)),
        hipX: M.hipOf().x, drop: M.hipOf().drop,
        legPoolKeys: Object.keys(d.pools).filter((k) => /^(serf|knight)leg/.test(k)),
        serfs: Object.keys(FS.G.serfs).length, drawn: d.serfs, draws: R.stats().drawCalls,
      };
    });
    await blocked.close();
    console.log("   fallback:", JSON.stringify(fb));
    t.check("?sprites=0 really opts a whole page out of the sheets",
      fb.sprOn === false && fb.sprActive === false, fb);
    t.check("a blocked villager fails soft — the load resolves false, it never throws",
      fb.loadedOk === false && fb.ready === false && fb.on === false && !!fb.err, fb);
    t.check("…and the procedural minifig takes over at its own budget",
      fb.serfTris > 180 && fb.serfTris < 400 && fb.knightTris < 700, fb);
    t.check("…on the minifig's own hips, with no pivot drop",
      Math.abs(fb.hipX - 0.075) < 0.001 && fb.drop === 0, fb);
    t.check("…sharing ONE leg pool per body kind again (the boot is symmetric)",
      fb.legPoolKeys.length > 0 && fb.legPoolKeys.every((k) => k === "serfleg" || k === "knightleg"), fb);
    t.check("…and the settlement still fills with people",
      fb.serfs >= 8 && fb.drawn >= 1 && fb.draws < 200, fb);
    t.check("…with zero page errors", errs.length === 0, errs.slice(0, 5));
  }

  /* ═══════════ 6e. THE SHEETS THEMSELVES UNREACHABLE — the real fallback ════
   * The one thing Fork B added that can fail. A blocked sheet must not throw,
   * must not half-render, and must hand the settlement to the 3D people
   * without the player noticing anything but the look. This is the page that
   * keeps the minifig path honest, so the whole 3D battery is asserted here
   * too rather than only through the in-page QA switch. */
  {
    const noSheets = await t.browser.newPage();
    await noSheets.setViewport({ width: 900, height: 640, deviceScaleFactor: 1 });
    const errs = [];
    noSheets.on("pageerror", (e) => errs.push(String((e && e.message) || e)));
    noSheets.on("console", (m) => {
      // the aborted sheet fetches log ERR_FAILED by design; anything else is a fault
      if (m.type() === "error" && !/net::ERR_FAILED/.test(m.text())) errs.push("console: " + m.text());
    });
    await noSheets.setRequestInterception(true);
    noSheets.on("request", (req) => {
      const u = req.url();
      if (!u.startsWith(t.BASE)) return req.abort();
      /* EVERY look's sheets, not just one directory — with two interchangeable
       * sets, blocking only `cast/sprites/` leaves the default look loading
       * happily and this whole fail-soft pass silently tests nothing. */
      if (/cast\/sprites(-[a-z0-9]+)?\//.test(u)) return req.abort();
      return req.continue();
    });
    /* ?sprites=1 on purpose: the blocked-villager page above navigated with
     * ?sprites=0, and that flag is written to localStorage BY DESIGN (a link
     * sticks, like ?cast=1). Same origin, same browser profile — so this page
     * has to ask for them back explicitly, which also exercises the opt-in
     * form of the flag. */
    await noSheets.goto(t.BASE + "/castlekruzer.html?sprites=1", { waitUntil: "domcontentloaded" });
    await noSheets.waitForFunction(() => !!window.__FS__, { timeout: 30000 });
    const ns = await noSheets.evaluate(async () => {
      const FS = window.__FS__, M = FS.FSModels, R = FS.FSRender, FSC = FS.FSC;
      const ok = await R.spritesLoaded;
      FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
      R.setQuality(1); FS.setSpeed(1); FS.ff(2500);
      for (let i = 0; i < 8; i++) R.frame(0.033);
      const d = R.dynamicInfo(), s = R.spriteInfo();
      return {
        loadedOk: ok, spr: s, wanted: R.SPR.on,
        serfTris: M.triCount(M.serfGeo(FSC.JOB.LUMBERJACK, 0)),
        knightTris: M.triCount(M.knightGeo(2, 0)),
        hipX: M.hipOf().x, drop: M.hipOf().drop, carryY: M.carryOf().y,
        bodyPools: Object.keys(d.pools).filter((k) => /^serf:/.test(k)).length,
        legPoolKeys: Object.keys(d.pools).filter((k) => /^(serf|knight)leg/.test(k)),
        layer: !!R.scene().getObjectByName("spr:serf"),
        serfs: Object.keys(FS.G.serfs).length, drawn: d.serfs, draws: R.stats().drawCalls,
        camYaw: R.camState().yaw,
      };
    });
    await noSheets.close();
    console.log("   no sheets:", JSON.stringify(ns));
    t.check("blocked sheets fail soft — the load resolves false and never throws",
      ns.loadedOk === false && ns.spr.ready === false && ns.spr.active === false
      && !!ns.spr.err && ns.wanted === true, ns);
    t.check("…nothing half-drawn: no sprite layer is left in the scene",
      ns.layer === false && ns.spr.counts === null, ns);
    t.check("…and the procedural minifig takes the whole workforce over",
      ns.serfTris > 180 && ns.serfTris < 400 && ns.knightTris < 700 && ns.bodyPools > 0, ns);
    t.check("…on the minifig's own hips, one leg pool per body kind",
      Math.abs(ns.hipX - 0.075) < 0.001 && ns.drop === 0 && Math.abs(ns.carryY - 0.86) < 1e-9
      && ns.legPoolKeys.length > 0 && ns.legPoolKeys.every((k) => k === "serfleg" || k === "knightleg"), ns);
    t.check("…the settlement still fills with people, inside the draw budget",
      ns.serfs >= 8 && ns.drawn >= 1 && ns.draws < 200, ns);
    t.check("…the camera stays locked either way (it is the game's contract, not the sheets')",
      ns.camYaw === 0, ns);
    t.check("…with zero page errors", errs.length === 0, errs.slice(0, 5));
  }

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
    /* 2026-08-02: the same far camera with the CULL OFF, because "zooming out
     * is cheaper" stopped being true the moment culling arrived — pulling back
     * widens the frustum and admits more buckets, which can easily outweigh
     * what the meadow's distance fade saves. The honest question now is
     * whether the far frame is cheaper than the same far frame UNCULLED. */
    R.setCulling(false);
    for (let i = 0; i < 4; i++) R.frame(0.033);
    dense.farTrisNoCull = R.stats().tris;
    dense.farCallsNoCull = R.stats().drawCalls;
    R.setCulling(true);
    for (let i = 0; i < 4; i++) R.frame(0.033);
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
  t.check("zoomed all the way out the meadow drops out entirely", budget.farTufts === 0, budget);
  t.check("…and the far frame is still cheaper than the same far frame uncalled",
    budget.farTris < budget.farTrisNoCull && budget.farCallsNoCull >= budget.farDraws, budget);
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
    /* RENDER FIRST. syncClaims — the thing that tears the meadow up where the
     * settlement has taken ground — runs inside frame(), so a census taken
     * straight after ff() counts 600 ticks of roads and huts that the view has
     * not been told about yet, and then compares it against a reloaded world
     * that HAS been rendered. That is a test artefact, not a rebuild bug: with
     * both sides rendered the two censuses agree clump for clump. */
    for (let i = 0; i < 3; i++) R.frame(0.033);
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
  /* 2026-08-02: the meadow is back on, so this compares a real population.
   * It caught a genuine asymmetry: the road-suppression used to read the
   * painted sheet during the bulk seed, and that sheet exists for a RELOADED
   * world and not for a fresh one — 41 clumps of difference. buildDecor is
   * blind to roads now and syncClaims does the suppression on frame one from
   * one code path, so a reloaded world is clump-for-clump the live one. */
  t.check("…the meadow comes back at exactly the same density", rebuilt.t1 === rebuilt.t0, rebuilt);
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
  /* 2026-08-02: the shipped default HAS a meadow again, so this no longer has
   * to re-enable anything to have something to thin — it just has to put the
   * constant back where it found it, because the hero screenshots below want
   * the real shipped look. */
  const qual = await page.evaluate((tpv) => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC;
    FSC.VIS.TUFT_PER_VERTEX = tpv;
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
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    R.setQuality(1);
    for (let i = 0; i < 3; i++) R.frame(0.033);
    return { hi, lo, back, auto: R.quality(), restoredTuftPerVertex: FSC.VIS.TUFT_PER_VERTEX };
  }, SHIPPED_TPV);
  t.check("the quality switch really thins the meadow", qual.lo < qual.hi * 0.5, qual);
  t.check("…and restores it", qual.back === qual.hi, qual);
  t.check("the shipped TUFT_PER_VERTEX is restored before the hero screenshots below",
    qual.restoredTuftPerVertex === SHIPPED_TPV && SHIPPED_TPV > 0, qual);

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

  /* ═══════════════ wind on the trees (playtest 2026-08-01) ════════════════
   * A vertex-shader lean, so nothing here may touch geometry, pools, draw
   * calls or the sim. What has to hold: it is ON by default, the shader really
   * carries the uniforms, the clock only runs while it is enabled (so a
   * disabled world is frame-stable for the film-strip rig), and the kill
   * switch is real. */
  const sway = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, M = FS.FSModels, FSC = FS.FSC;
    FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
    R.setQuality(1);
    for (let i = 0; i < 3; i++) R.frame(0.033);
    const kinds = M.objectKinds();
    const treeKey = Object.keys(kinds).filter((k) => k.indexOf("tree") === 0);
    const treeMat = kinds[treeKey[0]].mat;
    const stoneMat = kinds.stone_1.mat;
    const out = {
      defaultOn: M.treeSwayOn(), amp: M.treeSway.uSwayA.value, want: FSC.VIS.TREE_SWAY,
      treeCompiles: typeof treeMat.onBeforeCompile === "function",
      stoneUntouched: !stoneMat.onBeforeCompile || stoneMat.onBeforeCompile.length === 0,
      cacheKey: treeMat.customProgramCacheKey ? treeMat.customProgramCacheKey() : null,
      trees: R.stats().drawCalls,
    };
    /* the clock advances while enabled… RESTAGED 2026-08-02: the wind runs on
     * GAME time now (4x speed is 4x the sway, a paused world is frozen), so the
     * sim has to be running for the clock to move. Both properties are checked:
     * it runs at 1x, and it runs FOUR TIMES as far at 4x over the same number
     * of rendered frames. */
    FS.setSpeed(1);
    const t0 = M.treeSway.uSwayT.value;
    for (let i = 0; i < 5; i++) { FS.ff(10); R.frame(0.033); }
    out.ran = M.treeSway.uSwayT.value - t0;
    const tp = M.treeSway.uSwayT.value;
    FS.setSpeed(0);
    for (let i = 0; i < 8; i++) R.frame(0.033);
    out.pausedRan = M.treeSway.uSwayT.value - tp;
    FS.setSpeed(4);
    const t4 = M.treeSway.uSwayT.value;
    for (let i = 0; i < 5; i++) { FS.ff(40); R.frame(0.033); }
    out.ran4 = M.treeSway.uSwayT.value - t4;
    FS.setSpeed(1);
    /* the sway must cost NO extra draw calls. Measured at ONE world state with
     * the shader on and then off — comparing across a stretch of ticks would
     * measure the settlement growing, not the shader. */
    R.frame(0.033); out.drawsSwayOn = R.stats().drawCalls;
    R.setTreeSway(false); R.frame(0.033); out.drawsSwayOff = R.stats().drawCalls;
    R.setTreeSway(true); R.frame(0.033);
    out.drawsAfter = R.stats().drawCalls;
    // …and stops dead when it is switched off (a frame-stable world)
    R.setTreeSway(false);
    const t1 = M.treeSway.uSwayT.value;
    for (let i = 0; i < 5; i++) R.frame(0.033);
    out.frozen = M.treeSway.uSwayT.value - t1;
    out.offAmp = M.treeSway.uSwayA.value;
    out.offReported = R.treeSwayOn();
    R.setTreeSway(true);
    out.backOn = R.treeSwayOn();
    return out;
  });
  console.log("   tree sway:", JSON.stringify(sway));
  t.check("trees sway by default", sway.defaultOn === true && sway.amp === sway.want, sway);
  /* RESTAGED 2026-08-02 (batch #4): the tree material's program cache key is
   * COMPOSED now — `litBothSides` wraps the sway hook to stop a double-sided
   * card being lit from behind by its own negated normal, and extends the key
   * rather than replacing it. What the check is for is that the tree material
   * (and not the stone one) carries the sway program, so it asks for the sway
   * key as a PREFIX and keeps the "stone is untouched" half exactly as it was. */
  t.check("…driven by a shader hook on the TREE material only",
    sway.treeCompiles === true && /^fsTreeSway\b/.test(String(sway.cacheKey)) && sway.stoneUntouched === true, sway);
  t.check("…at a calm amplitude, not a gale", sway.want > 0 && sway.want <= 0.12, sway);
  t.check("…costing no extra draw calls", sway.drawsSwayOn === sway.drawsSwayOff, sway);
  t.check("the wind clock runs while it is on", sway.ran > 0.1, sway);
  t.check("…on GAME time: 4x speed is four times the sway (2026-08-02)",
    Math.abs(sway.ran4 / sway.ran - 4) < 0.35, sway);
  t.check("…and a paused world freezes it solid", sway.pausedRan === 0, sway);
  t.check("…and the kill switch really freezes it (frame-stable for the strips)",
    sway.frozen === 0 && sway.offAmp === 0 && sway.offReported === false, sway);
  t.check("…and it comes back on", sway.backOn === true, sway);

  /* ═══════════ 12. CHUNKED FRUSTUM CULLING (charm pass 2026-08-02) ═════════
   * Every instanced world pool used to submit the whole map every frame.
   * Instances are bucketed on a world grid now and only the buckets whose
   * padded AABB meets the frustum are packed into the draw buffer. The three
   * things that must hold: it is CORRECT (nothing on screen is ever dropped),
   * it is CHEAP (no extra draw calls — that was the reason for choosing
   * compaction over a mesh-per-bucket), and it REBUILDS when the world moves
   * ground from one owner to another. */
  const cull = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, map = FS.G.map, FSMap = FS.FSMap;
    FS.newGame({ size: "medium", seed: 4242, ais: 1, speed: 0 });
    R.setQuality(1);
    for (let i = 0; i < 4; i++) R.frame(0.033);
    const castle = FS.G.buildings[FS.G.players[0].castleId];
    const c = [0, 0]; FSMap.worldXZ(map, castle.v, c);
    const PLAY = { tx: c[0], tz: c[1], ty: map.height[castle.v], dist: FSC.CAM.DIST_START,
      yaw: 0.3, pitch: FSC.CAM.PITCH_START };
    R.setCam(PLAY);
    for (let i = 0; i < 3; i++) R.frame(0.033);
    const play = { info: R.cullInfo(), tris: R.stats().tris, calls: R.stats().drawCalls };
    R.setCam(Object.assign({}, PLAY, { dist: FSC.CAM.DIST_MAX }));
    for (let i = 0; i < 3; i++) R.frame(0.033);
    const out = { info: R.cullInfo(), tris: R.stats().tris, calls: R.stats().drawCalls };
    // the same two cameras with the cull switched OFF
    R.setCulling(false);
    R.setCam(PLAY);
    for (let i = 0; i < 3; i++) R.frame(0.033);
    const playOff = { info: R.cullInfo(), tris: R.stats().tris, calls: R.stats().drawCalls };
    R.setCam(Object.assign({}, PLAY, { dist: FSC.CAM.DIST_MAX }));
    for (let i = 0; i < 3; i++) R.frame(0.033);
    const outOff = { info: R.cullInfo(), tris: R.stats().tris, calls: R.stats().drawCalls };
    R.setCulling(true);
    return { play, out, playOff, outOff };
  });
  console.log("   cull:", JSON.stringify({ play: cull.play.info.drawn + "/" + cull.play.info.live,
    playTris: cull.play.tris, offTris: cull.playOff.tris, buckets: cull.play.info.buckets }));
  t.check("culling is on by default and buckets the whole board",
    cull.play.info.on === true && cull.play.info.buckets > 20 && cull.play.info.usedBuckets > 5, cull.play.info);
  t.check("at play zoom only a fraction of the world's instances are submitted",
    cull.play.info.drawn > 0 && cull.play.info.drawn < cull.play.info.live * 0.5, cull.play.info);
  t.check("…and the meadow is culled with them (it rides the same buckets)",
    cull.play.info.decorDrawn < cull.play.info.decorLive * 0.5, cull.play.info);
  t.check("culling cuts triangles hard at play zoom",
    cull.play.tris < cull.playOff.tris * 0.6, { on: cull.play.tris, off: cull.playOff.tris });
  t.check("…and still helps at MAX ZOOM, the worst case",
    cull.out.tris < cull.outOff.tris, { on: cull.out.tris, off: cull.outOff.tris });
  t.check("DRAW CALLS never grow — one mesh per kind, exactly as before",
    cull.play.calls <= cull.playOff.calls && cull.out.calls <= cull.outOff.calls,
    { play: [cull.play.calls, cull.playOff.calls], out: [cull.out.calls, cull.outOff.calls] });
  t.check("zooming out widens the visible set", cull.out.info.visBuckets > cull.play.info.visBuckets,
    { play: cull.play.info.visBuckets, out: cull.out.info.visBuckets });

  /* CORRECTNESS, the check that actually matters: an instance the camera can
   * see must never be dropped. Every live instance is tested against the SAME
   * frustum, per-instance, and compared with what the packer submitted. Zero
   * false negatives is the bar; false POSITIVES (a bucket's padding submitting
   * an instance just off screen) are the whole point of bucketing and are only
   * reported, not failed. */
  const exact = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, map = FS.G.map, FSMap = FS.FSMap;
    const THREEg = window.THREE;
    const castle = FS.G.buildings[FS.G.players[0].castleId];
    const c = [0, 0]; FSMap.worldXZ(map, castle.v, c);
    const res = [];
    const cams = [
      { dist: FSC.CAM.DIST_START, yaw: 0.0, pitch: FSC.CAM.PITCH_START },
      { dist: FSC.CAM.DIST_START, yaw: 2.2, pitch: FSC.CAM.PITCH_MAX },
      { dist: FSC.CAM.DIST_MIN, yaw: 4.1, pitch: FSC.CAM.PITCH_MIN },
      { dist: FSC.CAM.DIST_MAX, yaw: 5.6, pitch: FSC.CAM.PITCH_START },
    ];
    for (const cam of cams) {
      R.setCam(Object.assign({ tx: c[0], tz: c[1], ty: map.height[castle.v] }, cam));
      for (let i = 0; i < 2; i++) R.frame(0.033);
      const camera = R.camera();
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      const f = new THREEg.Frustum().setFromProjectionMatrix(
        new THREEg.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const sp = new THREEg.Sphere(new THREEg.Vector3(), 0);
      let missed = 0, shouldSee = 0, drawn = 0;
      // one probe per OBJECT vertex: is it inside the frustum, and did it draw?
      for (let v = 0; v < map.W * map.H; v++) {
        if (!map.obj[v]) continue;
        const p = [0, 0]; FSMap.worldXZ(map, v, p);
        sp.center.set(p[0], map.height[v] + 1.0, p[1]);
        sp.radius = 0.6;                    // well inside the object's own body
        if (!f.intersectsSphere(sp)) continue;
        shouldSee++;
        if (R.cullVisibleAt(p[0], p[1])) drawn++; else missed++;
      }
      res.push({ cam, shouldSee, drawn, missed });
    }
    return res;
  });
  console.log("   cull exactness:", JSON.stringify(exact.map((r) => r.shouldSee + "→" + r.drawn + " missed " + r.missed)));
  t.check("NOTHING inside the frustum is ever culled, at four cameras",
    exact.every((r) => r.missed === 0) && exact.some((r) => r.shouldSee > 20), exact);

  /* the framebuffer itself: culling on vs off must render the SAME PIXELS.
   * This is the assertion that would catch a padding bug the per-instance
   * test above cannot (an object whose body reaches into view while its
   * anchor does not). */
  const pix = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, map = FS.G.map, FSMap = FS.FSMap;
    const gl = R.renderer().getContext();
    const W = gl.drawingBufferWidth, Hh = gl.drawingBufferHeight;
    const castle = FS.G.buildings[FS.G.players[0].castleId];
    const c = [0, 0]; FSMap.worldXZ(map, castle.v, c);
    function grab() {
      const a = new Uint8Array(W * Hh * 4);
      gl.readPixels(0, 0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, a);
      return a;
    }
    const out = [];
    for (const cam of [{ dist: FSC.CAM.DIST_START, yaw: 0.7 }, { dist: FSC.CAM.DIST_MAX, yaw: 3.4 },
      { dist: FSC.CAM.DIST_MIN, yaw: 5.1 }]) {
      R.setTreeSway(false);                  // pixel-stable, or the wind is the diff
      R.setCam(Object.assign({ tx: c[0], tz: c[1], ty: map.height[castle.v], pitch: FSC.CAM.PITCH_START }, cam));
      R.setCulling(true);
      for (let i = 0; i < 4; i++) R.frame(0.033);
      const on = grab();
      R.setCulling(false);
      for (let i = 0; i < 4; i++) R.frame(0.033);
      const off = grab();
      R.setCulling(true);
      let diff = 0, worst = 0;
      for (let i = 0; i < on.length; i += 4) {
        const d = Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2]);
        if (d > 12) diff++;
        if (d > worst) worst = d;
      }
      out.push({ cam, px: (on.length / 4) | 0, diff, worst });
    }
    R.setTreeSway(true);
    return out;
  });
  console.log("   cull pixels:", JSON.stringify(pix.map((p) => p.diff + "/" + p.px + " worst " + p.worst)));
  /* Not "byte-identical", and the reason is worth writing down rather than
   * papering over: the packer submits a pool's instances in BUCKET order,
   * the unculled path in slot order, and two alpha-tested fragments of the
   * same pool at exactly equal depth are decided by whichever was drawn
   * first. A handful of pixels can therefore flip either way with no
   * correctness meaning. Measured 14 / 1,024,000 at play zoom, 0 zoomed out,
   * 1 zoomed in — the bar here is 1 in 10,000, which is still tight enough
   * that a genuinely mis-culled object (thousands of pixels) cannot pass.
   * RESTAGED 2026-08-02 (batch #4): both halves of the tolerance scale with
   * the MEADOW, and the meadow got denser (4 clumps a vertex, ~25% wider) and
   * higher-contrast (a clump's lit tips now sit ABOVE the ground's value
   * rather than level with it, which is what makes it read as grass). More
   * co-planar alpha-tested fragments and a bigger gap between the two things
   * that can win: measured 54 / 1,024,000, worst 147. 1-in-20,000 and a
   * worst of 96 were fitted to the old layer, not to a rule. */
  t.check("culling ON renders the same frame as culling OFF (3 cameras, whole framebuffer)",
    pix.every((p) => p.diff <= p.px * 0.0001 && p.worst <= 200), pix);

  /* MEMBERSHIP REBUILD. Felling a tree, sowing a field and laying a road all
   * move ground from one owner to another; the bucket the instance lived in
   * has to let go of it the same frame, or a felled tree keeps drawing (or a
   * new one never appears). */
  const rebuild = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, map = FS.G.map, FSMap = FS.FSMap;
    // a tree the camera is definitely looking at
    let treeV = -1;
    const cam = R.camState();
    for (let v = 0; v < map.W * map.H && treeV < 0; v++) {
      if (map.obj[v] >= FSC.OBJ.TREE3 && map.obj[v] <= FSC.OBJ.TREE4) {
        const p = [0, 0]; FSMap.worldXZ(map, v, p);
        if (R.cullVisibleAt(p[0], p[1])) treeV = v;
      }
    }
    const p = [0, 0]; FSMap.worldXZ(map, treeV, p);
    R.setCam({ tx: p[0], tz: p[1], ty: map.height[treeV], dist: 16, yaw: 0.4, pitch: FSC.CAM.PITCH_START });
    for (let i = 0; i < 3; i++) R.frame(0.033);
    const before = R.cullInfo();
    // fell it (the object fade leases the slot, so drain past OBJ_FADE_T)
    map.obj[treeV] = FSC.OBJ.STUMP;
    R.refreshVertex(treeV);
    for (let i = 0; i < 20; i++) R.frame(0.05);
    const felled = R.cullInfo();
    map.obj[treeV] = FSC.OBJ.TREE4;
    R.refreshVertex(treeV);
    for (let i = 0; i < 20; i++) R.frame(0.05);
    const back = R.cullInfo();
    // and the meadow: clearing a patch of grass must release its buckets too
    let grassV = -1;
    for (let v = 0; v < map.W * map.H && grassV < 0; v++) {
      if (map.terr[v] === FSC.TERR.GRASS && !map.obj[v] && !map.bldAt[v] && !map.flagAt[v]) {
        const q = [0, 0]; FSMap.worldXZ(map, v, q);
        if (R.cullVisibleAt(q[0], q[1])) grassV = v;
      }
    }
    const gBefore = R.cullInfo().decorLive;
    map.obj[grassV] = FSC.OBJ.FIELD2;
    R.refreshVertex(grassV);
    R.frame(0.033);
    const gAfter = R.cullInfo().decorLive;
    map.obj[grassV] = FSC.OBJ.NONE;
    R.refreshVertex(grassV);
    R.frame(0.033);
    const gBack = R.cullInfo().decorLive;
    return { treeV, before: before.live, felled: felled.live, back: back.live,
      drawnBefore: before.drawn, drawnFelled: felled.drawn, gBefore, gAfter, gBack };
  });
  t.check("felling a tree releases its bucket slot and re-fills it on regrowth",
    rebuild.felled === rebuild.before && rebuild.back === rebuild.before, rebuild);
  t.check("…and a sown field takes its grass out of the buckets, then gives it back",
    rebuild.gAfter < rebuild.gBefore && rebuild.gBack === rebuild.gBefore, rebuild);

  /* ═══════════ 13. THE FLUFF (charm pass 2026-08-02) ══════════════════════ */
  const fluff = await page.evaluate(() => {
    const FS = window.__FS__, M = FS.FSModels, FSC = FS.FSC, R = FS.FSRender;
    const kinds = M.objectKinds();
    const out = { stages: {}, tris: {}, mat: null, atlas: null };
    for (let sp = 0; sp < 3; sp++) {
      for (let st = 1; st <= 4; st++) {
        const key = "tree" + sp + "_" + st;
        const g = kinds[key].geo;
        g.computeBoundingBox();
        const b = g.boundingBox;
        out.stages[key] = { h: +(b.max.y - b.min.y).toFixed(3),
          w: +Math.max(b.max.x - b.min.x, b.max.z - b.min.z).toFixed(3) };
        out.tris[key] = M.triCount(g);
      }
    }
    const m = kinds.tree1_4.mat;
    out.mat = { hasMap: !!m.map, alphaTest: m.alphaTest, transparent: !!m.transparent,
      side: m.side, doubleSide: m.side === window.THREE.DoubleSide, sway: !!m.userData.swayK };
    // the atlas: cell 0 must be FULLY OPAQUE (every trunk samples it)
    const tex = M.foliageAtlas();
    const cv = tex.image, cx = cv.getContext("2d");
    const P = FSC.VIS.LEAF_TEX_PX;
    const d0 = cx.getImageData(0, 0, P, P).data;
    let clear = 0;
    for (let i = 3; i < d0.length; i += 4) if (d0[i] < 250) clear++;
    // a leaf cell must be RAGGED — part opaque, part clear
    const d1 = cx.getImageData(P, 0, P, P).data;
    let op = 0, tr = 0;
    for (let i = 3; i < d1.length; i += 4) { if (d1[i] > 200) op++; else if (d1[i] < 30) tr++; }
    out.atlas = { w: cv.width, h: cv.height, solidHoles: clear,
      leafOpaque: +(op / (P * P)).toFixed(3), leafClear: +(tr / (P * P)).toFixed(3) };
    /* ALPHA BLEED. A cutout sheet whose transparent region is left at
     * rgba(0,0,0,0) mips down toward BLACK — measured: it made the whole
     * meadow read as dark specks on bright ground. Every transparent texel
     * must therefore carry the sheet's own mean colour, not zero. */
    function blackHoles(data) {
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 32) continue;
        if (data[i] + data[i + 1] + data[i + 2] < 24) n++;
      }
      return n;
    }
    out.atlas.leafBlackHoles = blackHoles(d1);
    const tv = M.tuftTex().image;
    out.tuftSheet = { blackHoles: blackHoles(tv.getContext("2d").getImageData(0, 0, tv.width, tv.height).data) };
    // the tuft sheet + material
    const tm = M.tuftMat();
    const tg = M.tuftGeo(0, 3);
    const n = tg.attributes.normal.array;
    let up = 0; for (let i = 1; i < n.length; i += 3) if (n[i] > 0.99) up++;
    out.tuft = { tris: M.triCount(tg), upNormals: up, verts: n.length / 3,
      alphaTest: tm.alphaTest, transparent: !!tm.transparent, sway: !!tm.userData.swayK,
      swayK: tm.userData.swayK ? tm.userData.swayK.value.toArray() : null,
      h: FSC.VIS.TUFT_H, w: FSC.VIS.TUFT_W };
    return out;
  });
  console.log("   tree tris:", JSON.stringify(fluff.tris));
  t.check("the canopy is CARDS: the tree material carries a cutout atlas, not blended transparency",
    fluff.mat.hasMap && fluff.mat.alphaTest > 0.2 && fluff.mat.transparent === false, fluff.mat);
  t.check("…drawn double-sided (the camera orbits the full 360°)", fluff.mat.doubleSide, fluff.mat);
  t.check("…and still swayed by the shared wind shader", fluff.mat.sway === true, fluff.mat);
  t.check("the atlas' solid cell is FULLY opaque — every trunk samples it at one uv",
    fluff.atlas.solidHoles === 0, fluff.atlas);
  t.check("…and a leaf cell is genuinely ragged (opaque body, clear surround)",
    fluff.atlas.leafOpaque > 0.15 && fluff.atlas.leafClear > 0.2, fluff.atlas);
  t.check("both cutout sheets are ALPHA-BLED — no black hiding under the transparent texels",
    fluff.atlas.leafBlackHoles === 0 && fluff.tuftSheet.blackHoles === 0,
    { leaf: fluff.atlas.leafBlackHoles, tuft: fluff.tuftSheet.blackHoles });
  t.check("a mature tree costs FEWER triangles than the lobe canopy it replaced (<160)",
    Object.keys(fluff.tris).every((k) => fluff.tris[k] <= 160), fluff.tris);
  t.check("every tree stage is a distinct silhouette — taller and wider as it grows",
    [0, 1, 2].every((sp) => {
      const h = [1, 2, 3, 4].map((st) => fluff.stages["tree" + sp + "_" + st].h);
      const w = [1, 2, 3, 4].map((st) => fluff.stages["tree" + sp + "_" + st].w);
      return h[0] < h[1] && h[1] < h[2] && h[2] < h[3] && w[0] < w[3];
    }), fluff.stages);
  t.check("grass is a cutout too, never blended", fluff.tuft.alphaTest > 0.2 && fluff.tuft.transparent === false, fluff.tuft);
  t.check("…its normals face UP so a clump takes the same light as the ground",
    fluff.tuft.upNormals === fluff.tuft.verts, fluff.tuft);
  t.check("…it is TALLER than it is wide (a 52° camera foreshortens height, not width)",
    fluff.tuft.h > fluff.tuft.w, fluff.tuft);
  t.check("…and it sways on the same shader as the trees, at its own amplitude",
    fluff.tuft.sway === true && fluff.tuft.swayK[0] > 0 && fluff.tuft.swayK[1] > 1, fluff.tuft);
  t.check("a clump is cheap — 3 crossed quads", fluff.tuft.tris <= 8, fluff.tuft);

  /* THE MEADOW STOPS WHERE THE PATH STARTS. Roads are a painted ground decal
   * that is WIDER than the lattice edge it follows, so `edgeCount` alone
   * leaves grass growing through the middle of a track — the spawn reads the
   * same alpha sheet the paint comes from. */
  const roadGrass = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, map = FS.G.map, FSMap = FS.FSMap;
    /* run the settlement forward until it has actually built a road network —
     * the cull section left a world at tick 0 and an unpainted sheet answers
     * every roadCover() with -1, which would make this whole check vacuous */
    FS.setSpeed(1); FS.ff(2500); FS.setSpeed(0);
    for (let i = 0; i < 6; i++) R.frame(0.033);
    let onRoad = 0, offRoad = 0, sampled = 0, maxOn = -1;
    R.scene().getObjectByName("decor").children.forEach((m) => {
      if (m.name.indexOf("decor:tuft") !== 0 && m.name !== "decor:flower") return;
      const a = m.instanceMatrix.array;
      for (let i = 0; i < m.count; i++) {
        const x = a[i * 16 + 12], z = a[i * 16 + 14];
        const cov = R.roadCover(x, z);
        if (cov < 0) continue;
        sampled++;
        if (cov > FSC.VIS.TUFT_ROAD_ALPHA) { onRoad++; if (cov > maxOn) maxOn = cov; } else offRoad++;
      }
    });
    // …and prove the sheet is actually painting something here
    let painted = 0;
    for (const id in FS.G.roads) {
      const r = FS.G.roads[id];
      for (let i = 0; i < r.path.length; i++) {
        const p = [0, 0]; FSMap.worldXZ(map, r.path[i], p);
        if (R.roadCover(p[0], p[1]) > FSC.VIS.TUFT_ROAD_ALPHA) painted++;
      }
    }
    return { sampled, onRoad, offRoad, maxOn, painted, thresh: FSC.VIS.TUFT_ROAD_ALPHA };
  });
  t.check("the road sheet really is painting the network under this test",
    roadGrass.painted > 3, roadGrass);
  t.check("NO grass or flower stands on painted road", roadGrass.onRoad === 0, roadGrass);

  t.check("0 page errors", t.errors.length === 0, t.errors.slice(0, 6));
});
