#!/usr/bin/env node
"use strict";
/**
 * _fs_b4_shots.cjs — the eleven review plates for BATCH #4 (2026-08-02):
 * the sea of grass, the Settlers-style trees, the carry pose, the tool swings,
 * the four construction stages and the speed rail's new home.
 *
 *   node tools/_fs_b4_shots.cjs
 *
 * House pattern: every plate ASSERTS the thing its filename claims BEFORE it is
 * written, so a green run means the shots show what they say they show — not
 * merely that eleven PNGs exist.
 *
 * Writes shots/fs_b4_{carpet,carpet_closeup,trees_vs_ref,carry,builder_strike,
 * woodcutter,stages_small,stages_large,speedbtns,speedbtns_mp,zoomout}.png
 */
const H = require("./_fs_harness.cjs");
const fs = require("fs");
const path = require("path");

const SHOT = (n) => "fs_b4_" + n;

/** stage a small real settlement (the sim only builds when a player does) */
const STAGE = function () {
  const FS = window.__FS__, FSSim = FS.FSSim, FSMap = FS.FSMap;
  const T = {};
  window.T = T;
  T.build = function (type, minD, maxD, skip) {
    const G = FS.G;
    const castle = FSSim.castleOf(G, 0);
    const from = G.flags[castle.flag];
    let best = -1;
    FSMap.forRadius(G.map, castle.v, maxD || 10, (u, d) => {
      if (best >= 0 || d < (minD || 3)) return;
      if (skip && FSMap.dist(G.map, u, skip) < 3) return;
      if (!FSMap.canPlaceBuilding(type, u, 0)) return;
      if (!FSSim.roadPath(G, from.v, FSMap.doorVertex(G.map, u), 0)) return;
      best = u;
    });
    if (best < 0) return null;
    const r = FSSim.build(G, type, best, 0);
    if (!r || !r.id) return null;
    const b = G.buildings[r.id];
    const p = FSSim.roadPath(G, from.v, G.flags[b.flag].v, 0);
    if (p) FSSim.buildRoad(G, from.id, b.flag, p, 0);
    return { v: best, id: b.id };
  };
  T.clearToasts = function () { const e = document.getElementById("fsToasts"); if (e) e.innerHTML = ""; };
  return true;
};

async function boot(t, opts) {
  const page = await t.newPage(opts.vp || { width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(t.BASE + "/castlekruzer.html" + (opts.q || ""), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 60000 });
  await page.evaluate((o) => window.__FS__.newGame(o), opts.game || { size: "medium", seed: 12345, ais: 1, speed: 0 });
  await page.waitForFunction(() => window.__FS__.started(), { timeout: 90000 });
  await page.evaluate(async () => {
    const R = window.__FS__.FSRender;
    if (R.spritesLoaded) await R.spritesLoaded;
    if (R.loadGoodSprites) await R.loadGoodSprites();
    R.setQuality(1);
  });
  await page.evaluate(STAGE);
  return page;
}

H.run("farmstead-b4-shots", async (t) => {
  const shotsDir = path.join(H.ROOT, "shots");
  if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });

  /* ═══════════════════════ 1 · THE SEA OF GRASS ═══════════════════════════ */
  {
    const page = await boot(t, {});
    await page.evaluate(() => window.__FS__.ff(2500));
    const spot = await page.evaluate(() => {
      const FS = window.__FS__, G = FS.G, map = G.map, FSC = FS.FSC;
      const castle = FS.FSSim.castleOf(G, 0);
      const c = [0, 0]; FS.FSMap.worldXZ(map, castle.v, c);
      /* the WIDEST unbroken grass the board offers, so the plate is a MEADOW
       * rather than a meadow with a beach and two pines in it — the check
       * below samples a grid of ground pixels and every one has to be grass.
       * Tried widest-first because a developed board may have nothing clear at
       * radius 6 at all. */
      for (const R = [6, 5, 4, 3], _ = 0; ;) {
        for (const r of R) {
          for (let v = 0; v < map.W * map.H; v++) {
            if (map.terr[v] !== FSC.TERR.GRASS || map.obj[v]) continue;
            const p = [0, 0]; FS.FSMap.worldXZ(map, v, p);
            const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
            if (d < 14 || d > 40) continue;
            let clear = true;
            FS.FSMap.forRadius(map, v, r, (u) => { if (map.obj[u] || map.terr[u] !== FSC.TERR.GRASS) clear = false; });
            if (clear) return { v, x: p[0], z: p[1], y: map.height[v], r: r };
          }
        }
        return null;
      }
    });
    t.check("found an open meadow to photograph", !!spot, spot);
    /* THE CARPET TEST. The grass has to be UNBROKEN: sample a grid of ground
     * pixels in the lower half of the frame (below the HUD, above the dock) and
     * require every one of them to be green AND the set of them to carry real
     * texture variance — a flat wash passes "green" and fails "variance",
     * which is exactly the before-state this batch exists to kill. */
    const carpet = await page.evaluate((s) => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC;
      window.T.clearToasts();
      R.setCam({ tx: s.x, tz: s.z, ty: s.y, dist: FSC.CAM.DIST_START, yaw: 0.4, pitch: FSC.CAM.PITCH_START });
      for (let i = 0; i < 5; i++) R.frame(0.033);
      const gl = R.renderer().getContext();
      const cv = R.renderer().domElement;
      const px = new Uint8Array(4);
      /* EVERY SAMPLE IS ASKED WHAT GROUND IT LANDED ON. A play-zoom frame of
       * this world legitimately contains a lake and a rockfall, and a check
       * that demanded every pixel be green would be measuring the map, not the
       * carpet. pickVertex raycasts the terrain under the same point, so the
       * samples that survive are the ones standing on GRASS — and those are
       * the ones this batch is about. */
      const map = FS.G.map;
      const pr = R.renderer().getPixelRatio();
      let n = 0, green = 0, skipped = 0, sum = 0, sum2 = 0;
      for (let gx = 0; gx < 24; gx++) {
        for (let gy = 0; gy < 12; gy++) {
          const cssX = Math.round(cv.width / pr * (0.08 + gx * 0.036));
          const cssY = Math.round(cv.height / pr * (0.30 + gy * 0.046));
          const v = R.pickVertex(cssX, cssY);
          if (v < 0 || map.terr[v] !== FSC.TERR.GRASS || map.obj[v]) { skipped++; continue; }
          gl.readPixels(Math.round(cssX * pr), Math.round(cv.height - cssY * pr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          n++;
          if (px[1] > px[0] + 6 && px[1] > px[2] + 12) green++;
          const l = px[0] * 0.3 + px[1] * 0.6 + px[2] * 0.1;
          sum += l; sum2 += l * l;
        }
      }
      const mean = n ? sum / n : 0;
      return { n, green, skipped, mean: +mean.toFixed(1),
        sd: +Math.sqrt(Math.max(0, sum2 / Math.max(1, n) - mean * mean)).toFixed(2) };
    }, spot);
    /* All but a handful: a sample can legitimately land on a wildflower's
     * petal or on the painted road where it crosses a grass vertex, and
     * neither is bald ground. A genuinely flat, exposed surface would fail
     * this by tens of samples, not by one. */
    t.check("every scrap of grass ground in the frame reads as grass — no bald patches",
      carpet.n >= 80 && carpet.green >= carpet.n - 3, carpet);
    t.check("…and it is TEXTURED, not a flat wash (real luminance variance)",
      carpet.sd > 4, carpet);
    await t.shot(page, SHOT("carpet"));

    // close-up: the blades themselves
    await page.evaluate((s) => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC;
      window.T.clearToasts();
      R.setCam({ tx: s.x, tz: s.z, ty: s.y, dist: FSC.CAM.DIST_MIN + 2, yaw: 0.4, pitch: FSC.CAM.PITCH_MIN });
      for (let i = 0; i < 5; i++) R.frame(0.033);
    }, spot);
    const near = await page.evaluate(() => {
      const R = window.__FS__.FSRender;
      const d = R.decorInfo();
      let live = 0; for (const k in d) if (k.indexOf("tuft") === 0) live += d[k].live;
      return { live, tris: R.stats().tris };
    });
    t.check("the close-up has a real meadow standing in it", near.live > 2000, near);
    await t.shot(page, SHOT("carpet_closeup"));

    // zoom-out: the carpet must survive the far camera
    await page.evaluate((s) => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC;
      window.T.clearToasts();
      R.setCam({ tx: s.x, tz: s.z, ty: s.y, dist: FSC.CAM.DIST_MAX, yaw: 0.4, pitch: FSC.CAM.PITCH_START });
      for (let i = 0; i < 5; i++) R.frame(0.033);
    }, spot);
    const far = await page.evaluate(() => {
      const R = window.__FS__.FSRender;
      return { dist: R.camState().dist, draws: R.stats().drawCalls, tris: R.stats().tris };
    });
    t.check("the zoom-out plate really is at max zoom", far.dist >= 79, far);
    await t.shot(page, SHOT("zoomout"));
    await page.close();
  }

  /* ═══════════════════════ 2 · THE TREES ═══════════════════════════════════ */
  {
    const page = await boot(t, {});
    await page.evaluate(() => window.__FS__.ff(2500));
    const wood = await page.evaluate(() => {
      const FS = window.__FS__, G = FS.G, map = G.map, FSC = FS.FSC, O = FSC.OBJ;
      const castle = FS.FSSim.castleOf(G, 0);
      const c = [0, 0]; FS.FSMap.worldXZ(map, castle.v, c);
      let best = null, bestN = 0;
      for (let v = 0; v < map.W * map.H; v++) {
        if (map.terr[v] !== FSC.TERR.GRASS) continue;
        const p = [0, 0]; FS.FSMap.worldXZ(map, v, p);
        const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
        if (d < 10 || d > 46) continue;
        let n = 0;
        FS.FSMap.forRadius(map, v, 3, (u) => { const o = map.obj[u]; if (o >= O.TREE1 && o <= O.TREE4) n++; });
        if (n > bestN) { bestN = n; best = { v, x: p[0], z: p[1], y: map.height[v], n }; }
      }
      return best;
    });
    t.check("found a wood to photograph", !!wood && wood.n >= 4, wood);
    const treeInfo = await page.evaluate((w) => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, M = FS.FSModels;
      window.T.clearToasts();
      R.setCam({ tx: w.x, tz: w.z, ty: w.y, dist: 15, yaw: 0.9, pitch: FSC.CAM.PITCH_MIN });
      for (let i = 0; i < 5; i++) R.frame(0.033);
      const kinds = M.objectKinds();
      const mature = kinds.tree1_4.geo;
      const fir = kinds.tree0_4.geo;
      const uv = fir.attributes.uv;
      let inConifer = 0;
      for (let i = 0; i < uv.count; i++) {
        if (uv.getX(i) <= 0.25 && uv.getY(i) >= 2 / 3) inConifer++;
      }
      return {
        broadleafTris: M.triCount(mature), firTris: M.triCount(fir),
        firVerts: uv.count, firInConiferCell: inConifer,
        cards: FSC.VIS.LEAF_CARDS[3], crown: FSC.VIS.LEAF_CROWN_CARDS[3],
        trunk: FSC.COL.TREE_TRUNK.slice(),
      };
    }, wood);
    /* THE REFERENCE'S LANGUAGE, in numbers: a chunky many-card canopy over a
     * small DARK trunk, and a fir whose cones are painted rather than flat. */
    t.check("a mature broadleaf is built from many foliage cards (chunky, not a splat)",
      treeInfo.cards >= 6 && treeInfo.crown >= 2, treeInfo);
    t.check("the fir's cones sample the painted CONIFER cell, not the blank patch",
      treeInfo.firInConiferCell > treeInfo.firVerts * 0.5, treeInfo);
    t.check("trunks are dark (the reference's small dark stem)",
      treeInfo.trunk.every((c) => ((c >> 16) & 255) < 0x60), treeInfo);
    t.check("…and the canopy is still cheap", treeInfo.broadleafTris < 190, treeInfo);
    await t.shot(page, SHOT("trees_vs_ref"));
    await page.close();
  }

  /* ═══════════ 3+4 · CARRY POSE AND THE TOOL SWINGS ═══════════════════════ */
  {
    const page = await boot(t, { game: { size: "medium", seed: 12345, ais: 1, speed: 0, aiPlan: false } });
    await page.evaluate(() => window.__FS__.FSRender.setSpriteTrace(true));
    const staged = await page.evaluate(() => {
      const FS = window.__FS__;
      const a = window.T.build("lumberjack", 4, 11);
      window.T.build("forester", 4, 11, a && a.v);
      window.T.build("sawmill", 4, 12, a && a.v);
      FS.ff(1000);
      return { serfs: Object.keys(FS.G.serfs).length };
    });
    t.check("a working settlement was staged for the people plates", staged.serfs > 2, staged);

    async function frameSerf(pred, name, dist, wide) {
      const r = await page.evaluate((p, d, wideYaw) => {
        const FS = window.__FS__, G = FS.G, R = FS.FSRender, FSC = FS.FSC;
        const test = eval("(" + p + ")");
        for (let i = 0; i < 5000; i++) {
          FS.ff(1);
          for (const id in G.serfs) {
            const s = G.serfs[id];
            if (!test(s, FSC)) continue;
            R.syncDynamic(0.02);
            const v = R.serfPose(s.id);
            if (!v) continue;
            /* pick the yaw that shows him: a serf works UNDER what he is
             * working on, so sweep the circle and keep the clearest sight
             * line (scored on two body-height pixels, ground-green wins) */
            let bestYaw = 0.9, bestScore = -1;
            const gl = R.renderer().getContext(), cv = R.renderer().domElement;
            const px = new Uint8Array(4);
            for (let yi = 0; yi < 16; yi++) {
              const yy = yi * 0.3927;
              R.setCam({ tx: v.x, tz: v.z, ty: v.y, dist: d, yaw: yy, pitch: FSC.CAM.PITCH_MIN });
              for (let k = 0; k < 2; k++) R.frame(0.016);
              let sc = 0;
              for (const h of [0.20, 0.45]) {
                const sp = R.worldToScreen(v.x, v.y + h, v.z);
                gl.readPixels(Math.round(sp.x), Math.round(cv.height - sp.y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
                sc += Math.abs(px[0] - px[1]) + px[0] + px[2];
              }
              if (sc > bestScore) { bestScore = sc; bestYaw = yy; }
            }
            R.setCam({ tx: v.x, tz: v.z, ty: v.y, dist: wideYaw || d, yaw: bestYaw, pitch: FSC.CAM.PITCH_MIN });
            for (let k = 0; k < 3; k++) R.frame(0.016);
            window.T.clearToasts();
            return { id: s.id, job: s.job, carry: s.carry, state: s.state,
              trace: R.spritePose(s.id), score: bestScore };
          }
        }
        return null;
      }, pred.toString(), dist, wide);
      return r;
    }

    const carry = await frameSerf((s) => !!s.carry, "carry", 8);
    t.check("a hauling serf was framed", !!carry && !!carry.carry, carry);
    t.check("…and he is drawn in the CARRY pose, not the empty-handed walk",
      !!carry && carry.trace && carry.trace.pose === "carry", carry && carry.trace);
    t.check("…with no tool in his hands while they are full",
      !!carry && carry.trace && carry.trace.overlays.every((o) => o.id.indexOf("tool_") !== 0),
      carry && carry.trace);
    await t.shot(page, SHOT("carry"));

    const builder = await frameSerf((s, FSC) => s.job === FSC.JOB.BUILDER && s.state === "hammer", "builder", 8);
    t.check("a builder was caught mid-swing at a site", !!builder, builder);
    t.check("…drawn from the WORK rows", !!builder && builder.trace.pose === "work", builder && builder.trace);
    t.check("…with his hammer ROTATED to follow the arm (the manifest's toolAngle)",
      !!builder && builder.trace.overlays.some((o) => o.id.indexOf("tool_") === 0 && Math.abs(o.rot) > 0.1),
      builder && builder.trace);
    await t.shot(page, SHOT("builder_strike"));

    const wood = await frameSerf((s, FSC) => s.job === FSC.JOB.LUMBERJACK && s.state === "doWork", "woodcutter", 8, 13);
    t.check("a woodcutter was caught mid-chop", !!wood, wood);
    t.check("…with his axe swept off the rest angle",
      !!wood && wood.trace.overlays.some((o) => o.id.indexOf("tool_") === 0 && Math.abs(o.rot) > 0.1),
      wood && wood.trace);
    await t.shot(page, SHOT("woodcutter"));
    await page.close();
  }

  /* ═══════════════════ 5 · FOUR CONSTRUCTION STAGES ═══════════════════════ */
  for (const [type, tag] of [["lumberjack", "stages_small"], ["stock", "stages_large"]]) {
    const page = await boot(t, { vp: { width: 1280, height: 560, deviceScaleFactor: 1 },
      game: { size: "medium", seed: 7, ais: 0, speed: 0 } });
    const info = await page.evaluate((ty) => {
      const FS = window.__FS__, R = FS.FSRender, FSM = FS.FSModels, G = FS.G, map = G.map, FSC = FS.FSC;
      const sc = R.scene();
      for (const n of ["objects", "buildings", "decor"]) { const o = sc.getObjectByName(n); if (o) o.visible = false; }
      const grp = new THREE.Group(); grp.name = "stagerow"; sc.add(grp);
      const castle = FS.FSSim.castleOf(G, 0);
      const c = [0, 0]; FS.FSMap.worldXZ(map, castle.v, c);
      const y = map.height[castle.v];
      const fr = [0.10, 0.35, 0.60, 0.85];
      const tris = [], roofTris = [];
      for (let i = 0; i < 5; i++) {
        const m = i < 4 ? FSM.buildingModel(ty, "build", 0, fr[i]) : FSM.buildingModel(ty, "done", 0, 1);
        m.position.set(c[0] + (i - 2) * 3.4, y + 0.02, c[1] - 10);
        m.rotation.y = Math.PI / 6;
        grp.add(m);
        /* Count triangles AND, separately, triangles wearing a ROOFING
         * material. Raw triangle count is the wrong invariant for "the roof is
         * off" — an unfinished stage carries a whole scaffold and a set of
         * ceiling joists the finished building does not, so it can easily out-
         * count the finished model. What the stage means is that no thatch,
         * shingle, slate or tile is on it, and the building atlas says which
         * cell every triangle samples. */
        const ROOFC = ["thatch", "shingle", "slate", "tile", "straw"].map((k) => FSM.ATLAS_CELLS[k]);
        let n = 0, roofT = 0;
        m.traverse((o) => {
          const g2 = o.geometry;
          if (!g2 || !g2.attributes.position) return;
          n += FSM.triCount(g2);
          const uv = g2.attributes.uv;
          if (!uv) return;
          for (let k = 0; k + 2 < uv.count; k += 3) {
            const cx2 = Math.min(3, Math.floor(uv.getX(k) * 4));
            const cy2 = Math.min(3, Math.floor(uv.getY(k) * 4));
            if (ROOFC.indexOf(cy2 * 4 + cx2) >= 0) roofT++;
          }
        });
        tris.push(n); roofTris.push(roofT);
      }
      R.setCam({ tx: c[0], tz: c[1] - 10, ty: y, dist: 15.5, yaw: 0, pitch: FSC.CAM.PITCH_MIN });
      for (let i = 0; i < 4; i++) R.frame(0.03);
      window.T.clearToasts();
      return { tris, roofTris, stage: FSM.buildingStageInfo(ty) };
    }, type);
    /* the four stages must be four DIFFERENT buildings, and they must grow */
    t.check(type + ": the four build stages are all different meshes",
      new Set(info.tris.slice(0, 4)).size === 4, info);
    t.check(type + ": …and the roof classifier found a roof to take off",
      info.stage.roofParts >= 2, info.stage);
    t.check(type + ": …the walls-up stages carry NO roofing material at all",
      info.roofTris[2] === 0 && info.roofTris[3] === 0, info);
    t.check(type + ": …and the finished building does",
      info.roofTris[4] > 0, info);
    t.check(type + ": …with the walls-up stage carrying more of the real model than the frame",
      info.tris[2] > info.tris[1], info);
    await t.shot(page, SHOT(tag));
    await page.close();
  }

  /* ═══════════════════ 6 · THE SPEED RAIL ═════════════════════════════════ */
  {
    const page = await boot(t, {});
    await page.evaluate(() => window.__FS__.ff(600));
    const solo = await page.evaluate(() => {
      window.T.clearToasts();
      window.__FS__.FSRender.frame(0.033);
      const r = document.getElementById("fsSpeed").getBoundingClientRect();
      const top = document.querySelector(".fs-top-right").getBoundingClientRect();
      const mini = document.getElementById("fsMinimap").getBoundingClientRect();
      return { x: r.left, right: r.right, y: r.top, w: innerWidth, h: innerHeight,
        locked: document.getElementById("fsSpeed").classList.contains("locked"),
        clearOfTopRight: r.top >= top.bottom - 1,
        clearOfMinimap: r.bottom <= mini.top,
        disabled: [].some.call(document.querySelectorAll("#fsSpeed button"), (b) => b.disabled) };
    });
    t.check("the speed rail sits in the TOP RIGHT of the screen",
      solo.right > solo.w * 0.75 && solo.y < solo.h * 0.25, solo);
    t.check("…below the bell/menu cluster it belongs with, and clear of the minimap",
      solo.clearOfTopRight && solo.clearOfMinimap, solo);
    t.check("…and it is live in a solo game", !solo.locked && !solo.disabled, solo);
    await t.shot(page, SHOT("speedbtns"));

    // MULTIPLAYER: the rail is greyed and inert (FSNet stubbed live, no room needed)
    const mp = await page.evaluate(() => {
      const FS = window.__FS__;
      const origActive = FS.FSNet.active, origState = FS.FSNet.state;
      FS.FSNet.active = () => true;
      FS.FSNet.state = () => ({ connected: true, seat: 0, role: "guest" });
      window.FSUI.frame(0.016);
      const row = document.getElementById("fsSpeed");
      const btn = row.querySelector('[data-speed="4"]');
      const was = FS.G.speed;
      btn.click();
      const out = { locked: row.classList.contains("locked"), disabled: btn.disabled,
        title: btn.title, was: was, now: FS.G.speed };
      FS.FSNet.active = origActive; FS.FSNet.state = origState;
      return out;
    });
    t.check("in co-op the rail is visibly locked", mp.locked, mp);
    t.check("…every button is inert and says why", mp.disabled && /1×/.test(mp.title), mp);
    t.check("…and clicking one changes nothing", mp.now === mp.was, mp);
    await t.shot(page, SHOT("speedbtns_mp"));
    await page.evaluate(() => { window.FSUI.frame(0.016); });
    await page.close();
  }

  /* every plate on disk and not blank */
  const names = ["carpet", "carpet_closeup", "trees_vs_ref", "carry", "builder_strike",
    "woodcutter", "stages_small", "stages_large", "speedbtns", "speedbtns_mp", "zoomout"];
  let onDisk = 0, tiny = [];
  for (const n of names) {
    const fp = path.join(shotsDir, SHOT(n) + ".png");
    if (!fs.existsSync(fp)) continue;
    onDisk++;
    if (fs.statSync(fp).size < 20000) tiny.push(n);
  }
  t.check("all eleven batch-#4 plates are on disk", onDisk === names.length, { onDisk, want: names.length });
  t.check("…and none of them is a blank frame", tiny.length === 0, tiny);
  t.check("0 page errors", t.errors.length === 0, t.errors.slice(0, 6));
}, { port: 8938 });
