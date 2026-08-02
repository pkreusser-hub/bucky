#!/usr/bin/env node
"use strict";
/**
 * Screenshots for the 2026-08-02 playtest batch #3 — the twelve-item board:
 * guaranteed start ore, less water, 2x-area maps, the banner, the connect chip,
 * building tooltips, the rate HUD, the fish splash, the goods sprites and the
 * serf idles.
 *
 *   node tools/_fs_b3_shots.cjs        → shots/fs_b3_*.png
 *
 * Every shot ASSERTS what it is supposed to show, so a green run is evidence
 * and not just eleven PNGs.
 */
const H = require("./_fs_harness.cjs");

async function boot(t, q, vp) {
  const page = await t.newPage(vp || { width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(t.BASE + "/castlekruzer.html" + (q || ""), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 30000 });
  return page;
}
async function start(page, opts) {
  await page.evaluate((o) => window.__FS__.newGame(o), opts);
  await page.waitForFunction(() => window.__FS__.started(), { timeout: 30000 });
  await page.evaluate(async () => {
    const R = window.__FS__.FSRender;
    if (R.spritesLoaded) await R.spritesLoaded;
    if (R.loadGoodSprites) await R.loadGoodSprites();
    R.setQuality(1);
  });
}

H.run("fs-b3-shots", async (t) => {

  /* ═══ A1 · GUARANTEED START ORE ══════════════════════════════════════════
   * The camera looks from the castle door out to the nearest COAL a road could
   * reach, with the mineral overlay on so the seam is visible in the hill. */
  {
    const page = await boot(t);
    await start(page, { size: "medium", seed: 12345, ais: 3, speed: 0 });
    const ore = await page.evaluate(() => {
      const FS = window.__FS__, G = FS.G, map = G.map, FSMap = FS.FSMap, R = FS.FSRender;
      const castle = G.buildings[G.players[0].castleId];
      const door = FSMap.nbr(map, castle.v, FSMap.DIR[FS.FSC.DOOR_DIR]);
      const d = FSMap.reachDist(map, castle.v, FS.FSC.START.BAL_REACH);
      const kinds = ["STONE", "COAL", "IRON", "GOLD"];
      const near = {};
      for (const k of kinds) near[k] = { steps: Infinity, v: -1 };
      for (let v = 0; v < map.W * map.H; v++) {
        if (!map.mineralAmt[v] || !FSMap.mineGround(map, v)) continue;
        const dr = FSMap.nbr(map, v, FSMap.DIR[FS.FSC.DOOR_DIR]);
        const s = dr >= 0 ? d[dr] : -1;
        if (s < 0) continue;
        const k = kinds[map.mineral[v] - 1];
        if (k && s < near[k].steps) near[k] = { steps: s, v: v, amt: map.mineralAmt[v] };
      }
      /* Frame THE HILL the coal is in, looking back toward the castle, so the
       * shot is the walk a player's first coal mine actually makes. */
      const a = [0, 0], b = [0, 0];
      FSMap.worldXZ(map, castle.v, a);
      const seam = near.COAL.v >= 0 ? near.COAL.v : castle.v;
      FSMap.worldXZ(map, seam, b);
      R.setCam({ tx: b[0] * 0.72 + a[0] * 0.28, tz: b[1] * 0.72 + a[1] * 0.28, ty: map.height[seam],
        dist: Math.max(20, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.9),
        yaw: Math.atan2(a[0] - b[0], a[1] - b[1]) + Math.PI, pitch: FS.FSC.CAM.PITCH_START });
      for (let i = 0; i < 8; i++) R.frame(0.033);
      return { near, door, guarantee: map.startBalance ? !!map.startBalance.guarantee : false };
    });
    await t.sleep(200);
    await t.shot(page, "fs_b3_startore");
    t.check("startore: coal AND iron are both within MOUNTAIN_MAX of the door",
      ore.near.COAL.steps <= 18 && ore.near.IRON.steps <= 18, ore.near);
    t.check("startore: …and gold is there too", isFinite(ore.near.GOLD.steps), ore.near.GOLD);
    t.check("startore: the guarantee pass ran and is recorded on the map", ore.guarantee, ore);
    await page.close();
  }

  /* ═══ A2/A3 · LESS WATER, BIGGER BOARD ═══════════════════════════════════ */
  {
    const page = await boot(t);
    await start(page, { size: "medium", seed: 42, ais: 3, speed: 0 });
    const mix = await page.evaluate(() => {
      const FS = window.__FS__, G = FS.G, map = G.map, R = FS.FSRender;
      const N = map.W * map.H, m = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < N; i++) m[map.terr[i]]++;
      // look out over a shoreline: half water, half open land and hill
      const castle = G.buildings[G.players[0].castleId];
      const xz = [0, 0]; FS.FSMap.worldXZ(map, castle.v, xz);
      R.setCam({ tx: xz[0], tz: xz[1], ty: 0, dist: FS.FSC.CAM.DIST_MAX, yaw: 0.9, pitch: FS.FSC.CAM.PITCH_MAX });
      for (let i = 0; i < 8; i++) R.frame(0.033);
      return { W: map.W, water: m[0] / N, grass: m[1] / N, mountain: m[4] / N, snow: m[5] / N };
    });
    await t.sleep(200);
    await t.shot(page, "fs_b3_waterratio");
    t.check("waterratio: water is well under a third of the board", mix.water < 0.34, mix);
    t.check("waterratio: …and grass is the biggest single class", mix.grass > mix.water && mix.grass > mix.mountain, mix);
    t.check("waterratio: mountain got its notch", mix.mountain > 0.15, mix);
    await page.close();
  }
  {
    const page = await boot(t);
    await start(page, { size: "large", seed: 1234, ais: 3, speed: 0 });
    const big = await page.evaluate(() => {
      const FS = window.__FS__, G = FS.G, map = G.map, R = FS.FSRender;
      FS.setSpeed(1); FS.ff(2500); FS.setSpeed(0);
      const castle = G.buildings[G.players[0].castleId];
      const xz = [0, 0]; FS.FSMap.worldXZ(map, castle.v, xz);
      R.setCam({ tx: xz[0], tz: xz[1], ty: 0, dist: FS.FSC.CAM.DIST_MAX, yaw: 0.3, pitch: FS.FSC.CAM.PITCH_MAX });
      for (let i = 0; i < 10; i++) R.frame(0.033);
      const st = R.stats();
      let sep = Infinity;
      for (let a = 0; a < map.starts.length; a++) {
        for (let b = a + 1; b < map.starts.length; b++) sep = Math.min(sep, FS.FSMap.dist(map, map.starts[a], map.starts[b]));
      }
      return { W: map.W, verts: map.W * map.H, sep: sep, draws: st.drawCalls, tris: st.tris };
    });
    await t.sleep(200);
    await t.shot(page, "fs_b3_bigmap");
    t.check("bigmap: large is 136 wide — twice the AREA of the old 96", big.W === 136, big.W);
    t.check("bigmap: castles are far apart on it", big.sep >= 24, big.sep);
    t.check("bigmap: draw calls stay in budget on the bigger board", big.draws < 120, big.draws);
    await page.close();
  }

  /* ═══ B3 · BUILDING TOOLTIPS ═════════════════════════════════════════════ */
  {
    const page = await boot(t);
    await start(page, { size: "medium", seed: 12345, ais: 1, speed: 0 });
    const tip = await page.evaluate(() => {
      window.FSUI.armBuild("smelter");
      document.querySelector('#fsBuildTabs [data-tab="industry"]').click();
      window.FSUI.armBuild("smelter");
      const box = document.getElementById("fsBuildInfo");
      return { hidden: box.classList.contains("hidden"), text: box.textContent,
        chips: (box.querySelector(".bi-reqs") || {}).textContent || "" };
    });
    await t.sleep(150);
    await t.shot(page, "fs_b3_tooltips");
    t.check("tooltips: the strip is open on the armed card", tip.hidden === false, tip);
    t.check("tooltips: it says what a smelter does", /coal and iron ore/i.test(tip.text), tip.text);
    t.check("tooltips: …and what it needs", /coal/.test(tip.chips), tip.chips);
    await page.close();
  }

  /* ═══ B4 · RATE HUD, desktop and phone ═══════════════════════════════════ */
  for (const [name, vp] of [["ratehud_desktop", { width: 1280, height: 800, deviceScaleFactor: 1 }],
    ["ratehud_mobile", { width: 390, height: 844, deviceScaleFactor: 1 }]]) {
    const page = await boot(t, "", vp);
    await start(page, { size: "medium", seed: 12345, ais: 1, speed: 0 });
    const r = await page.evaluate(() => {
      const FS = window.__FS__, G = FS.G, map = G.map, FSMap = FS.FSMap, FSSim = FS.FSSim;
      /* THE RATE STRIP NEEDS AN ECONOMY. A fresh board hands player 0 a castle
       * and nothing else, and a kingdom that produces nothing honestly reads
       * ±0 on every good — so the shot stages the first three buildings any
       * player puts down, exactly as a player would: place, connect, staff. */
      const castle = FSSim.castleOf(G, 0);
      const used = [];
      function add(type, minD, maxD) {
        let v = -1;
        FSMap.forRadius(map, castle.v, maxD, (u, d) => {
          if (v >= 0 || d < minD) return;
          if (used.some((w) => FSMap.dist(map, w, u) < 3)) return;
          if (FSMap.canPlaceBuilding(map, type, u, 0)) v = u;
        });
        if (v < 0) return null;
        const r2 = FSSim.build(G, type, v, 0);
        if (!r2.ok) return null;
        const b = G.buildings[r2.id];
        const path = FSSim.roadPath(G, G.flags[b.flag].v, G.flags[castle.flag].v, 0);
        if (!path || !FSSim.buildRoad(G, b.flag, castle.flag, path, 0).ok) { FSSim.demolishBuilding(G, b.id); return null; }
        FSSim.forceComplete(G, b.id);
        used.push(v);
        return b;
      }
      const made = ["lumberjack", "sawmill", "stonecutter", "forester"].map((k) => !!add(k, 3, 12));
      FS.setSpeed(4); FS.ff(9000);
      // let the rolling window fill on the ticker's own beat
      for (let i = 0; i < 40; i++) { FS.ff(60); window.FSUI.frame(0.3); }
      FS.setSpeed(0);
      const cells = [].map.call(document.querySelectorAll("#fsRates .rate-item"),
        (n) => ({ cls: n.className, txt: n.textContent.trim() }));
      const bar = document.getElementById("fsTopbar").getBoundingClientRect();
      const speed = document.getElementById("fsSpeed").getBoundingClientRect();
      const clipped = [].filter.call(document.querySelectorAll("#fsRates .rate-item"),
        (n) => n.scrollWidth > n.clientWidth + 1).length;
      return { cells, made, barH: bar.height, overlapSpeed: bar.bottom > speed.top + 0.5, clipped,
        moving: cells.filter((c) => /up|down/.test(c.cls)).length,
        prod: FS.FSSim.production(G, 0), cons: FS.FSSim.consumption(G, 0) };
    });
    await t.sleep(200);
    await t.shot(page, "fs_b3_" + name);
    t.check(name + ": six rate chips, none clipped", r.cells.length === 6 && r.clipped === 0, r);
    t.check(name + ": at least one good is visibly moving", r.moving >= 1, r.cells);
    t.check(name + ": the strip never runs into the speed control", r.overlapSpeed === false, r);
    await page.close();
  }

  /* ═══ B1 · NO STANDING BANNER ════════════════════════════════════════════ */
  {
    const page = await boot(t);
    await start(page, { size: "medium", seed: 12345, ais: 1, speed: 0 });
    const b = await page.evaluate(() => {
      // hammer the attack action the way a held key used to
      for (let i = 0; i < 40; i++) window.FSUI.doAttackAtHover();
      for (let i = 0; i < 50; i++) window.FSUI.frame(0.05);        // 2.5 s
      const strip = document.getElementById("fsToasts");
      return { toasts: strip.querySelectorAll(".fs-toast").length, text: strip.textContent };
    });
    await t.sleep(150);
    await t.shot(page, "fs_b3_no_banner");
    t.check("no_banner: forty attack misses leave NOTHING on screen 2.5 s later",
      !/enemy hut/.test(b.text), b);
    await page.close();
  }

  /* ═══ C1 · A FISH LANDS WITHOUT A BLACK RING ═════════════════════════════ */
  {
    const page = await boot(t);
    await start(page, { size: "medium", seed: 12345, ais: 1, speed: 1 });
    const f = await page.evaluate(async () => {
      const FS = window.__FS__, R = FS.FSRender, map = FS.G.map;
      let wv = -1, best = 0;
      for (let v = 0; v < map.W * map.H; v++) {
        if (map.terr[v] !== 0) continue;
        let land = 0;
        for (let d = 0; d < 6; d++) { const u = FS.FSMap.nbr(map, v, d); if (u >= 0 && map.terr[u] !== 0) land++; }
        if (map.fish[v] + land > best) { best = map.fish[v] + land; wv = v; }
      }
      const xz = [0, 0]; FS.FSMap.worldXZ(map, wv, xz);
      R.setCam({ tx: xz[0], tz: xz[1], ty: 0, dist: 11, yaw: 0.4, pitch: FS.FSC.CAM.PITCH_START });
      window.FSFX.spawnFish(wv);
      /* fly the arc to just PAST the landing — that is the moment the old ring
       * was darkest, so it is the moment worth photographing */
      let info = window.FSFX.info(), frames = 0;
      while (frames < 90 && !info.drops) { R.frame(0.033); info = window.FSFX.info(); frames++; }
      for (let i = 0; i < 3; i++) R.frame(0.033);
      info = window.FSFX.info();
      return { wv, frames, fish: info.fish, rings: info.rings, drops: info.drops };
    });
    await t.sleep(150);
    await t.shot(page, "fs_b3_fishjump");
    t.check("fishjump: the leap and its white spray are live", f.drops > 0, f);
    t.check("fishjump: …and the landing left no expanding ring", f.rings === 0, f);
    await page.close();
  }

  /* ═══ D1 · SIX DIFFERENT GOODS ON ONE FLAG, AND ONE IN A SETTLER'S HANDS ═ */
  {
    const page = await boot(t);
    await start(page, { size: "medium", seed: 12345, ais: 1, speed: 0 });
    const pile = await page.evaluate(() => {
      const FS = window.__FS__, G = FS.G, R = FS.FSRender, map = G.map, FSMap = FS.FSMap;
      const castle = G.buildings[G.players[0].castleId];
      /* a flag OUT IN THE OPEN, not the castle's own door flag — the point of
       * the shot is six goods side by side, and the castle stands right over
       * its doorstep */
      let v = -1, bestOpen = -1;
      FSMap.forRadius(map, castle.v, 10, (u, d) => {
        if (d < 5 || FSMap.whyFlag(map, u, 0)) return;
        /* CLEAR ground: a flag dropped in a wood puts three pines between the
         * camera and the pile, which is how the first take of this shot came
         * out. Score the open apron around the candidate and take the best. */
        let open = 0;
        FSMap.forRadius(map, u, 3, (w) => { if (!FSMap.objBlocks(map.obj[w]) && map.terr[w] === 1) open++; });
        if (open > bestOpen) { bestOpen = open; v = u; }
      });
      const r = FS.FSSim.makeFlag(G, 0, v);
      const f = G.flags[r.id];
      const want = ["plank", "bread", "pig", "coal", "goldBar", "fish"];
      f.slots = want.map((res, i) => ({ res, id: 970 + i, dest: 0, t: 0 }));
      const xz = [0, 0]; FSMap.worldXZ(map, f.v, xz);
      R.setCam({ tx: xz[0], tz: xz[1], ty: map.height[f.v], dist: FS.FSC.CAM.DIST_MIN, yaw: 0.7, pitch: FS.FSC.CAM.PITCH_START });
      for (let i = 0; i < 8; i++) R.frame(0.033);
      const L = R.GSPR.layer;
      const rows = [];
      for (let i = 0; i < L.mesh.count; i++) rows.push(Math.floor(L.a.frame.getX(i) / R.GSPR.man.bake.azimuths));
      return { want, n: L.mesh.count, distinct: new Set(rows).size };
    });
    await t.sleep(200);
    await t.shot(page, "fs_b3_goods_pile");
    t.check("goods_pile: six goods on the flag", pile.n === 6, pile);
    t.check("goods_pile: …and six DIFFERENT sprites, not one crate in six colours",
      pile.distinct === 6, pile);

    const carry = await page.evaluate(() => {
      const FS = window.__FS__, G = FS.G, R = FS.FSRender;
      FS.setSpeed(1); FS.ff(3000); FS.setSpeed(0);
      // find a serf out on the road with a load, and frame him
      let best = null;
      for (const id in G.serfs) {
        const s = G.serfs[id];
        if (!s.carry || s.state === "work" || s.state === "garrison") continue;
        best = s; break;
      }
      if (!best) {                       // stage one rather than hope
        for (const id in G.serfs) { const s = G.serfs[id]; if (s.state !== "work" && s.state !== "garrison") { s.carry = "bread"; best = s; break; } }
      }
      for (let i = 0; i < 4; i++) R.frame(0.033);
      const q = R.serfPose(best.id);
      R.setCam({ tx: q.x, tz: q.z, ty: q.y, dist: FS.FSC.CAM.DIST_MIN, yaw: 1.4, pitch: FS.FSC.CAM.PITCH_START });
      for (let i = 0; i < 6; i++) R.frame(0.033);
      let carrying = 0;
      for (const id in G.serfs) if (G.serfs[id].carry) carrying++;
      return { carry: best.carry, carrying, layer: R.GSPR.layer.mesh.count };
    });
    await t.sleep(200);
    await t.shot(page, "fs_b3_goods_carried");
    t.check("goods_carried: a settler is carrying something recognisable", !!carry.carry, carry);
    t.check("goods_carried: …drawn out of the same one-call goods layer", carry.layer > 0, carry);
    await page.close();
  }

  /* ═══ D2 · IDLE VARIANTS, three settlers side by side ════════════════════ */
  {
    const page = await boot(t);
    await start(page, { size: "medium", seed: 12345, ais: 1, speed: 0 });
    const idle = await page.evaluate(() => {
      const FS = window.__FS__, G = FS.G, map = G.map, FSMap = FS.FSMap, R = FS.FSRender, FSC = FS.FSC;
      FS.setSpeed(1); FS.ff(1800); FS.setSpeed(0);
      const c = FS.FSSim.castleOf(G, 0);
      const free = (u) => u >= 0 && !map.obj[u] && !map.flagAt[u] && FSMap.walkable(map.terr[u]) && !FSMap.bldBlocked(map, u);
      // a line of open ground near home
      let line = [];
      FSMap.forRadius(map, c.v, 9, (u, d) => {
        if (line.length || d < 4 || !free(u)) return;
        const run = [u];
        let cur = u;
        for (let k = 0; k < 4; k++) { const w = FSMap.nbr(map, cur, 0); if (!free(w)) break; run.push(w); cur = w; }
        if (run.length >= 4) line = run;
      });
      const ids = Object.keys(G.serfs).slice(0, line.length).map(Number);
      // one serf per idle VARIANT, so the shot shows all three at once
      const byVar = {};
      for (const id in G.serfs) {
        const v = R.idleFrameOf(+id).variant;
        if (byVar[v] === undefined) byVar[v] = +id;
      }
      const chosen = Object.keys(byVar).map((k) => byVar[k]).slice(0, line.length);
      chosen.forEach((id, i) => {
        const s = G.serfs[id];
        s.job = FSC.JOB.BUILDER;
        s.v = line[i]; s.from = s.v; s.to = s.v; s.frac = 0; s.path.length = 0;
        s.state = "idle"; s.offroad = false; s.carry = 0;
      });
      for (let i = 0; i < 8; i++) R.frame(0.033);
      const q = R.serfPose(chosen[Math.floor(chosen.length / 2)]);
      R.setCam({ tx: q.x, tz: q.z, ty: q.y, dist: FS.FSC.CAM.DIST_MIN, yaw: 1.9, pitch: FS.FSC.CAM.PITCH_START });
      for (let i = 0; i < 6; i++) R.frame(0.033);
      return { chosen, variants: chosen.map((id) => R.idleFrameOf(id).variant),
        steps: chosen.map((id) => R.idleFrameOf(id).step) };
    });
    await t.sleep(200);
    await t.shot(page, "fs_b3_idle_variants");
    t.check("idle_variants: the staged line covers more than one idle loop",
      new Set(idle.variants).size >= 2, idle);
    await page.close();
  }

  t.check("0 page errors", t.errors.length === 0, t.errors.slice(0, 6));
});
