#!/usr/bin/env node
"use strict";
/**
 * FARMSTEAD — the 2026-08-02 CHARM PASS plates.
 *
 *   node tools/_fs_charm_shots.cjs        → shots/fs_charm_*.png
 *
 * The player's brief was "the world feels very polygonal, I want you to make
 * the ground and trees feel almost fluffy… charming little sprite grass… the
 * trees should be fluffy and swaying in the wind". That is a judgement made by
 * eye, so these are the plates it gets judged on — and every one of them
 * ASSERTS what it is supposed to be showing, so a green run is evidence and
 * not just ten PNGs.
 *
 * `fs_charm_forest_before.png` is an ARCHIVED plate: it was captured from the
 * pre-charm build (icosahedron-lobe canopies, no meadow) and cannot be
 * regenerated once the geometry has been replaced, exactly like the reviewed
 * film strips. This script asserts it is on disk and not blank; everything
 * else is rebuilt from scratch at the SAME camera so the pair is a fair
 * comparison.
 */
const H = require("./_fs_harness.cjs");
const fs = require("fs");
const path = require("path");

const SEED = 12345;
const FOREST_V = 586;                 // the densest wood on seed 12345 / medium

async function boot(t, vp) {
  const page = await t.newPage(vp || { width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(t.BASE + "/castlekruzer.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 40000 });
  return page;
}
async function start(page, opts) {
  await page.evaluate((o) => window.__FS__.newGame(o), opts);
  await page.waitForFunction(() => window.__FS__.started(), { timeout: 60000 });
  await page.evaluate(async () => {
    const R = window.__FS__.FSRender;
    if (R.spritesLoaded) await R.spritesLoaded;
    if (R.loadGoodSprites) await R.loadGoodSprites();
    R.setQuality(1);                  // judge the real thing, not the CI thinning
  });
}
/** mean absolute pixel delta between two framebuffer grabs, and how many moved */
function pxDelta(a, b) {
  let moved = 0, sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > 8) moved++;
    sum += d;
  }
  return { moved, mean: +(sum / (a.length / 4)).toFixed(3) };
}

H.run("fs-charm-shots", async (t) => {

  /* ═══ 0 · THE ARCHIVED BEFORE PLATE ══════════════════════════════════════ */
  {
    const fp = path.join(H.ROOT, "shots", "fs_charm_forest_before.png");
    const st = fs.existsSync(fp) ? fs.statSync(fp) : null;
    t.check("before: the archived pre-charm forest plate is on disk and not blank",
      !!st && st.size > 40000, { exists: !!st, size: st ? st.size : 0 });
  }

  /* ═══ 1 · THE SAME WOOD, AFTER ═══════════════════════════════════════════
   * Same seed, same anchor vertex, same camera as the archived plate. What
   * should have changed: canopies made of painted foliage cards instead of
   * icosahedron lobes, firs whose plan view is a scalloped rosette instead of
   * an octagon, and a meadow under all of it. */
  {
    const page = await boot(t);
    await start(page, { size: "medium", seed: SEED, ais: 1, speed: 0 });
    const info = await page.evaluate((v) => {
      const FS = window.__FS__, R = FS.FSRender, map = FS.G.map, FSMap = FS.FSMap, FSC = FS.FSC, M = FS.FSModels;
      const c = [0, 0]; FSMap.worldXZ(map, v, c);
      R.setCam({ tx: c[0], tz: c[1], ty: map.height[v], dist: 18, yaw: 0.4, pitch: FSC.CAM.PITCH_START });
      for (let i = 0; i < 8; i++) R.frame(0.033);
      let trees = 0;
      FSMap.forRadius(map, v, 5, (u) => { if (map.obj[u] >= FSC.OBJ.TREE3 && map.obj[u] <= FSC.OBJ.TREE4) trees++; });
      const mat = M.objectKinds().tree1_4.mat;
      return { trees, cards: !!mat.map && mat.alphaTest > 0.2,
        tris: R.stats().tris, drawn: R.cullInfo().drawn, live: R.cullInfo().live };
    }, FOREST_V);
    await t.sleep(150);
    await t.shot(page, "fs_charm_forest_after");
    t.check("forest_after: framed the same wood the before plate framed", info.trees > 20, info);
    t.check("forest_after: its canopies really are alpha-cutout foliage cards", info.cards, info);
    await page.close();
  }

  /* ═══ 2 · GRASS, CLOSE ═══════════════════════════════════════════════════ */
  {
    const page = await boot(t, { width: 1000, height: 700, deviceScaleFactor: 1 });
    await start(page, { size: "medium", seed: SEED, ais: 1, speed: 0 });
    const info = await page.evaluate(() => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, map = FS.G.map, FSMap = FS.FSMap;
      let best = -1;
      for (let v = 0; v < map.W * map.H && best < 0; v++) {
        if (map.terr[v] !== FSC.TERR.GRASS || map.obj[v]) continue;
        let ok = true;
        FSMap.forRadius(map, v, 3, (u) => { if (map.terr[u] !== FSC.TERR.GRASS || map.obj[u]) ok = false; });
        if (ok) best = v;
      }
      const c = [0, 0]; FSMap.worldXZ(map, best, c);
      R.setCam({ tx: c[0], tz: c[1], ty: map.height[best], dist: 9, yaw: 0.3, pitch: FSC.CAM.PITCH_START });
      for (let i = 0; i < 8; i++) R.frame(0.033);
      const d = R.decorInfo();
      let live = 0;
      for (const k in d) if (k.indexOf("tuft") === 0) live += d[k].live;
      return { best, live, drawn: R.cullInfo().decorDrawn, h: FSC.VIS.TUFT_H, w: FSC.VIS.TUFT_W };
    });
    await t.sleep(150);
    await t.shot(page, "fs_charm_grass_closeup");
    t.check("grass_closeup: a real meadow is on screen", info.drawn > 60, info);
    t.check("grass_closeup: clumps are taller than wide (the 52° camera's rule)", info.h > info.w, info);
    await page.close();
  }

  /* ═══ 3 · THE TREE STAGES — all twelve, on cleared flat ground ═══════════
   * Gameplay readability: a forester's sapling has to be tellable from a
   * mature broadleaf at a glance, so this plate is a model sheet. */
  {
    const page = await boot(t, { width: 1400, height: 760, deviceScaleFactor: 1 });
    await start(page, { size: "medium", seed: SEED, ais: 1, speed: 0 });
    const info = await page.evaluate(() => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap, map = FS.G.map, M = FS.FSModels;
      R.setTreeSway(false);
      // the flattest 14-vertex run of open grass on the board
      let best = -1, bestFlat = 1e9;
      for (let r = 4; r < map.H - 4; r++) {
        for (let c = 8; c < map.W - 18; c++) {
          const v = r * map.W + c;
          let ok = true, spread = 0;
          const h0 = map.height[v];
          for (let k = 0; k < 14 && ok; k++) {
            const u = v + k;
            if (map.terr[u] !== FSC.TERR.GRASS || map.bldAt[u] || map.flagAt[u]) ok = false;
            else spread += Math.abs(map.height[u] - h0);
          }
          if (ok && spread < bestFlat) { bestFlat = spread; best = v; }
        }
      }
      // clear a lane and its meadow so the lineup is judged on its own
      FSC.VIS.TUFT_PER_VERTEX = 0;
      for (let k = -2; k < 16; k++) {
        for (let dr = -1; dr <= 1; dr++) {
          const u = best + k + dr * map.W;
          if (u < 0 || u >= map.W * map.H) continue;
          map.obj[u] = FSC.OBJ.NONE;
          R.refreshVertex(u);
        }
      }
      // species is DERIVED from the vertex, so the lineup is its own group of
      // plain meshes built from the very geometry+material the pools use
      const kinds = M.objectKinds();
      const grp = new THREE.Group(); grp.name = "treelab";
      const p = [0, 0];
      const tris = {}, box = {};
      let i = 0;
      for (let sp = 0; sp < 3; sp++) {
        for (let st = 1; st <= 4; st++) {
          const key = "tree" + sp + "_" + st;
          const m = new THREE.Mesh(kinds[key].geo, kinds[key].mat);
          FSMap.worldXZ(map, best + i, p);
          m.position.set(p[0], map.height[best + i], p[1]);
          grp.add(m);
          tris[key] = M.triCount(kinds[key].geo);
          kinds[key].geo.computeBoundingBox();
          const b = kinds[key].geo.boundingBox;
          box[key] = +(b.max.y - b.min.y).toFixed(2);
          i++;
        }
      }
      R.scene().add(grp);
      const bb = new THREE.Box3().setFromObject(grp);
      const ctr = bb.getCenter(new THREE.Vector3());
      R.setCam({ tx: ctr.x, tz: ctr.z, ty: bb.min.y + 1.0, dist: 20, yaw: 0, pitch: 50 * Math.PI / 180 });
      for (let n = 0; n < 8; n++) R.frame(0.033);
      return { tris, box, planted: grp.children.length };
    });
    await t.sleep(200);
    await t.shot(page, "fs_charm_treestages");
    console.log("   tree tris:", JSON.stringify(info.tris));
    t.check("treestages: all twelve tree kinds are on the plate", info.planted === 12, info);
    t.check("treestages: every stage is taller than the one before it (readability)",
      [0, 1, 2].every((sp) => {
        const h = [1, 2, 3, 4].map((st) => info.box["tree" + sp + "_" + st]);
        return h[0] < h[1] && h[1] < h[2] && h[2] < h[3];
      }), info.box);
    t.check("treestages: a whole tree stays inside its triangle budget",
      Object.keys(info.tris).every((k) => info.tris[k] <= 160), info.tris);
    await page.close();
  }

  /* ═══ 4 · THE WIND IS ON THE SIM CLOCK ══════════════════════════════════
   * Two plates of the SAME frame at two sway phases. Together they prove the
   * wind moves the canopy and NOT the ground, and the numbers alongside prove
   * the phase is driven by TICKS: the same number of ticks advances it by the
   * same amount whatever speed the player is watching at, and a paused world
   * is a still photograph.
   *
   * GOTCHA: the framebuffer has to be grabbed and STASHED inside the browser.
   * `page.screenshot` between two evaluates leaves the default framebuffer
   * unreadable (preserveDrawingBuffer is off), so a naive before/after pair
   * around a shot reports every pixel on screen as changed. */
  {
    const page = await boot(t);
    await start(page, { size: "medium", seed: SEED, ais: 1, speed: 0 });
    await page.evaluate((v) => {
      const FS = window.__FS__, R = FS.FSRender, map = FS.G.map, FSMap = FS.FSMap, FSC = FS.FSC;
      const c = [0, 0]; FSMap.worldXZ(map, v, c);
      R.setCam({ tx: c[0], tz: c[1], ty: map.height[v], dist: 14, yaw: 0.9, pitch: FSC.CAM.PITCH_MIN });
      R.setTreeSway(true);
      for (let i = 0; i < 6; i++) R.frame(0.033);
      const gl = R.renderer().getContext();
      window.__W = gl.drawingBufferWidth; window.__H = gl.drawingBufferHeight;
      const a = new Uint8Array(window.__W * window.__H * 4);
      gl.readPixels(0, 0, window.__W, window.__H, gl.RGBA, gl.UNSIGNED_BYTE, a);
      window.__before = a;
    }, FOREST_V);
    await t.sleep(120);
    await t.shot(page, "fs_charm_swayspeed_a");
    const moved = await page.evaluate(() => {
      const FS = window.__FS__, R = FS.FSRender, M = FS.FSModels;
      // a paused world: frames pass, the wind does not move
      const pz = M.treeSway.uSwayT.value;
      for (let i = 0; i < 8; i++) R.frame(0.033);
      const paused = M.treeSway.uSwayT.value - pz;
      // the SAME number of ticks at 1x and at 4x must advance it equally —
      // that is what "on the sim clock" means
      const p0 = M.treeSway.uSwayT.value;
      FS.setSpeed(1);
      for (let i = 0; i < 24; i++) { FS.ff(6); R.frame(0.033); }
      const at1 = M.treeSway.uSwayT.value - p0;
      const p1 = M.treeSway.uSwayT.value;
      FS.setSpeed(4);
      for (let i = 0; i < 24; i++) { FS.ff(6); R.frame(0.033); }
      const at4 = M.treeSway.uSwayT.value - p1;
      FS.setSpeed(0);
      for (let i = 0; i < 3; i++) R.frame(0.033);
      const gl = R.renderer().getContext();
      const after = new Uint8Array(window.__W * window.__H * 4);
      gl.readPixels(0, 0, window.__W, window.__H, gl.RGBA, gl.UNSIGNED_BYTE, after);
      const before = window.__before;
      let m = 0;
      for (let i = 0; i < before.length; i += 4) {
        const d = Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]);
        if (d > 8) m++;
      }
      return { paused: +paused.toFixed(4), at1: +at1.toFixed(3), at4: +at4.toFixed(3),
        px: before.length / 4, cmp: m };
    });
    await t.sleep(120);
    await t.shot(page, "fs_charm_swayspeed_b");
    console.log("   sway:", JSON.stringify(moved));
    t.check("swayspeed: the wind really moved the canopy between the two plates",
      moved.cmp > moved.px * 0.005 && moved.cmp < moved.px * 0.55, moved);
    t.check("swayspeed: …driven by TICKS, so the same ticks are the same wind at any speed",
      moved.at1 > 1 && Math.abs(moved.at4 - moved.at1) < 0.01, moved);
    t.check("swayspeed: …and a paused world is a still photograph", moved.paused === 0, moved);
    await page.close();
  }

  /* ═══ 5 · THE ROAD EDGE ═════════════════════════════════════════════════
   * Two things have to survive next to each other: the road decal's feathered
   * edge (it must still read as trodden ground, not a sticker) and the
   * meadow, which has to stop exactly where the paint starts. */
  {
    const page = await boot(t, { width: 1100, height: 760, deviceScaleFactor: 1 });
    await start(page, { size: "medium", seed: SEED, ais: 2, speed: 0 });
    const info = await page.evaluate(() => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap;
      FS.setSpeed(1); FS.ff(3000); FS.setSpeed(0);
      for (let i = 0; i < 8; i++) R.frame(0.033);
      const map = FS.G.map;
      // the longest road on the board, framed at its middle
      let bestR = null;
      for (const id in FS.G.roads) {
        const r = FS.G.roads[id];
        if (!r.water && (!bestR || r.path.length > bestR.path.length)) bestR = r;
      }
      const mid = bestR.path[bestR.path.length >> 1];
      const c = [0, 0]; FSMap.worldXZ(map, mid, c);
      R.setCam({ tx: c[0], tz: c[1], ty: map.height[mid], dist: 11, yaw: 1.1, pitch: FSC.CAM.PITCH_MAX });
      for (let i = 0; i < 8; i++) R.frame(0.033);
      // measure the two rules this plate exists to prove
      let onRoad = 0, sampled = 0;
      R.scene().getObjectByName("decor").children.forEach((m) => {
        if (m.name.indexOf("decor:tuft") !== 0 && m.name !== "decor:flower") return;
        const a = m.instanceMatrix.array;
        for (let i = 0; i < m.count; i++) {
          const cov = R.roadCover(a[i * 16 + 12], a[i * 16 + 14]);
          if (cov < 0) continue;
          sampled++;
          if (cov > FSC.VIS.TUFT_ROAD_ALPHA) onRoad++;
        }
      });
      const probe = R.probeRoad(c[0], c[1]);
      return { roadLen: bestR.path.length, sampled, onRoad,
        gap: probe ? +probe.gap.toFixed(3) : null, decal: R.roadVisual().decal,
        cover: R.roadCover(c[0], c[1]) };
    });
    await t.sleep(150);
    await t.shot(page, "fs_charm_roadedge");
    t.check("roadedge: a real painted road is in frame", info.decal && info.cover > 100, info);
    t.check("roadedge: the decal still lies ON the terrain, not above it",
      info.gap !== null && info.gap > 0 && info.gap < 0.2, info);
    t.check("roadedge: not one clump of grass stands on the paint", info.onRoad === 0, info);
    await page.close();
  }

  /* ═══ 6 · A DEVELOPED TOWN AT PLAY ZOOM, AND THE SAME BOARD ZOOMED OUT ══
   * The town plate is the one the brief is really about — this is the frame a
   * player looks at for hours. The zoom-out plate is the culling's worst
   * case: the widest frustum the camera can make. */
  {
    const page = await boot(t);
    await start(page, { size: "large", seed: SEED, ais: 3, speed: 0 });
    const town = await page.evaluate(() => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap;
      FS.setSpeed(1); FS.ff(6000); FS.setSpeed(0);
      const map = FS.G.map;
      const castle = FS.G.buildings[FS.G.players[0].castleId];
      const c = [0, 0]; FSMap.worldXZ(map, castle.v, c);
      R.setCam({ tx: c[0], tz: c[1], ty: map.height[castle.v], dist: FSC.CAM.DIST_START,
        yaw: 0.35, pitch: FSC.CAM.PITCH_START });
      for (let i = 0; i < 10; i++) R.frame(0.033);
      return { blds: Object.keys(FS.G.buildings).length, serfs: FS.G.serfs ? Object.keys(FS.G.serfs).length : 0,
        info: R.cullInfo(), tris: R.stats().tris, calls: R.stats().drawCalls };
    });
    await t.sleep(200);
    await t.shot(page, "fs_charm_town_wide");
    t.check("town_wide: a real settlement, not an empty board", town.blds >= 6, town);
    t.check("town_wide: culling is doing its job at play zoom — under half the world submitted",
      town.info.drawn < town.info.live * 0.5, town.info);
    console.log("   town:", JSON.stringify({ tris: town.tris, calls: town.calls,
      obj: town.info.drawn + "/" + town.info.live, decor: town.info.decorDrawn + "/" + town.info.decorLive }));

    const zoom = await page.evaluate(() => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC;
      const c = R.camState();
      R.setCam({ tx: c.tx, tz: c.tz, ty: c.ty, dist: FSC.CAM.DIST_MAX, yaw: 0.35, pitch: FSC.CAM.PITCH_START });
      for (let i = 0; i < 8; i++) R.frame(0.033);
      const on = { tris: R.stats().tris, calls: R.stats().drawCalls, info: R.cullInfo() };
      R.setCulling(false);
      for (let i = 0; i < 6; i++) R.frame(0.033);
      const off = { tris: R.stats().tris, calls: R.stats().drawCalls };
      R.setCulling(true);
      for (let i = 0; i < 4; i++) R.frame(0.033);
      return { on, off };
    });
    await t.sleep(150);
    await t.shot(page, "fs_charm_zoomout");
    console.log("   zoomout:", JSON.stringify({ on: zoom.on.tris + "/" + zoom.on.calls, off: zoom.off.tris + "/" + zoom.off.calls }));
    t.check("zoomout: the worst-case frustum is still cheaper than no culling at all",
      zoom.on.tris < zoom.off.tris, zoom);
    t.check("zoomout: …and never costs MORE draw calls", zoom.on.calls <= zoom.off.calls, zoom);
    await page.close();
  }

  /* ═══ 7 · A PHONE ═══════════════════════════════════════════════════════ */
  {
    const page = await boot(t, { width: 390, height: 844, deviceScaleFactor: 2 });
    await start(page, { size: "medium", seed: SEED, ais: 1, speed: 0 });
    const info = await page.evaluate(() => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap;
      R.resize();
      FS.setSpeed(1); FS.ff(2000); FS.setSpeed(0);
      const map = FS.G.map;
      const castle = FS.G.buildings[FS.G.players[0].castleId];
      const c = [0, 0]; FSMap.worldXZ(map, castle.v, c);
      R.setCam({ tx: c[0], tz: c[1], ty: map.height[castle.v], dist: 24, yaw: 0.62, pitch: FSC.CAM.PITCH_MAX });
      for (let i = 0; i < 10; i++) R.frame(0.033);
      return { info: R.cullInfo(), tris: R.stats().tris, calls: R.stats().drawCalls,
        quality: R.quality() };
    });
    await t.sleep(200);
    await t.shot(page, "fs_charm_mobile");
    t.check("mobile: the world renders on a phone viewport with the meadow on",
      info.info.decorDrawn > 20 && info.tris > 1000, info);
    console.log("   mobile:", JSON.stringify({ tris: info.tris, calls: info.calls,
      decor: info.info.decorDrawn + "/" + info.info.decorLive }));
    await page.close();
  }

  /* every plate must exist and none of them may be blank */
  const want = ["forest_before", "forest_after", "grass_closeup", "town_wide", "treestages",
    "swayspeed_a", "swayspeed_b", "roadedge", "zoomout", "mobile"];
  const missing = want.filter((n) => {
    const fp = path.join(H.ROOT, "shots", "fs_charm_" + n + ".png");
    return !fs.existsSync(fp) || fs.statSync(fp).size < 20000;
  });
  t.check("all ten charm plates are on disk and none is blank", missing.length === 0, missing);

  t.check("0 page errors", t.errors.length === 0, t.errors.slice(0, 6));
});
