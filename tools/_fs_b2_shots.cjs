#!/usr/bin/env node
"use strict";
/**
 * Screenshots for the 2026-08-01 playtest batch #2 (belt/plume team colours,
 * build-menu greying, tree clearing, nearest-rock stonecutter, free camera yaw).
 *
 *   node tools/_fs_b2_shots.cjs            → shots/fs_b2_*.png
 *
 * Uses the harness's own server + Chrome so the pages are the real game, and
 * page.screenshot for the two shots that must include the DOM overlay (the
 * build menu). The rotation trio is the acceptance evidence for the free yaw:
 * the SAME town and the SAME frame, three camera yaws apart.
 */
const H = require("./_fs_harness.cjs");

const boot = async (t, q) => {
  const page = await t.newPage({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(t.BASE + "/castlekruzer.html" + (q || ""), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 30000 });
  await page.click("#startBtn");
  await page.waitForFunction(() => window.__FS__.started(), { timeout: 30000 });
  await page.evaluate(async () => { await window.__FS__.FSRender.spritesLoaded; });
  return page;
};

H.run("fs-b2-shots", async (t) => {
  /* ────────────────── 1. TEAM COLOUR = THE BELT, two players side by side ── */
  {
    const page = await boot(t);
    await page.evaluate(async () => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap, FSSim = FS.FSSim;
      FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
      R.setQuality(1); FS.setSpeed(1); FS.ff(2500); FS.setSpeed(0);
      R.setTreeSway(false);
      /* stage the comparison rather than hunt for it: park one serf of player 0
       * and one of player 1 SIDE BY SIDE (adjacent vertices, one clear step
       * apart) and zoom right in — the point of the shot is the belt, and a belt
       * is ~3 px at play zoom. */
      const G = FS.G, map = G.map;
      const c = FSSim.castleOf(G, 0);
      const free = (u) => u >= 0 && !map.obj[u] && !map.flagAt[u]
        && !FSSim.bldBlocks(G, u) && FSMap.walkable(map.terr[u]);
      let anchor = -1, pair = [];
      FSMap.forRadius(map, c.v, 8, (u, d) => {
        if (anchor >= 0 || d < 3 || !free(u)) return;
        const ring = [];
        for (let k = 0; k < 6; k++) { const w = FSMap.nbr(map, u, k); if (free(w)) ring.push(w); }
        if (ring.length >= 3) { anchor = u; pair = [u, ring[0], ring[2]]; }
      });
      const ids = Object.keys(G.serfs).slice(0, pair.length).map(Number);
      ids.forEach((id, i) => {
        const s = G.serfs[id];
        s.p = i % 2;                              // alternate the two team colours
        /* NOT a carrier: transporters wear the pack, and from behind the pack
         * covers a good part of the belt. The shot is about the belt. */
        s.job = FSC.JOB.BUILDER;
        s.v = pair[i]; s.from = s.v; s.to = s.v; s.frac = 0; s.path.length = 0;
        s.state = "idle"; s.offroad = false; s.carry = 0;
      });
      for (let i = 0; i < 8; i++) R.frame(0.033);
      const q = R.serfPose(ids[0]);
      R.setCam({ tx: q.x, tz: q.z, ty: q.y, dist: FSC.CAM.DIST_MIN, yaw: 2.2, pitch: FSC.CAM.PITCH_START });
      for (let i = 0; i < 6; i++) R.frame(0.033);
    });
    await t.sleep(250);
    await t.shot(page, "fs_b2_belt_teams");
    t.check("belt_teams shot", true);

    /* ────────────────── 2. RANKS STRIP — rank stays readable off the plume ── */
    await page.evaluate(async () => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap, FSSim = FS.FSSim, FSMil = FS.FSMil;
      const G = FS.G, map = G.map, c = FSSim.castleOf(G, 0);
      const free = (u) => u >= 0 && !map.obj[u] && !map.flagAt[u]
        && !FSSim.bldBlocks(G, u) && FSMap.walkable(map.terr[u]);
      /* a LINE of five, so the ranks read as a strip rather than a scatter */
      let spots = [];
      FSMap.forRadius(map, c.v, 9, (u, d) => {
        if (spots.length >= 5 || d < 3 || !free(u)) return;
        const row = [u];
        let cur = u;
        for (let k = 0; k < 4; k++) {
          const nx = FSMap.nbr(map, cur, 1);          // walk one lattice direction
          if (!free(nx)) { row.length = 0; break; }
          row.push(nx); cur = nx;
        }
        if (row.length === 5) spots = row;
      });
      /* one knight per RANK, all on player 0's colour, so the strip is only
       * about rank: the plume must read as the TEAM and the trim + pips as the
       * rank, independently. Knights render from G.serfs with JOB.KNIGHT, so
       * the cheapest honest staging is to re-badge existing serfs in place —
       * the same trick the belt shot uses for the team colour. */
      const knights = [];
      const pool = Object.keys(G.serfs).map(Number);
      for (let r = 0; r < FSC.KNIGHT_RANKS && r < spots.length && r < pool.length; r++) {
        const s = G.serfs[pool[r]];
        s.p = 0; s.job = FSC.JOB.KNIGHT; s.rank = r;
        s.v = spots[r];
        s.from = s.v; s.to = s.v; s.frac = 0; s.path.length = 0;
        s.state = "idle"; s.offroad = false; s.carry = 0;
        knights.push(s.id);
      }
      for (let i = 0; i < 8; i++) R.frame(0.033);
      if (knights.length) {
        const q = R.serfPose(knights[Math.floor(knights.length / 2)]);
        R.setCam({ tx: q.x, tz: q.z, ty: q.y, dist: 10, yaw: 0.2, pitch: FSC.CAM.PITCH_START });
      }
      for (let i = 0; i < 6; i++) R.frame(0.033);
      window.__KN__ = knights.length;
    });
    await t.sleep(250);
    await t.shot(page, "fs_b2_plume_ranks");
    t.check("plume_ranks shot has knights", await page.evaluate(() => window.__KN__ > 0));

    /* ────────────────── 5. ROTATION TRIO — same town, three camera yaws ──── */
    const yaws = [0, 2.094, 4.189];             // 0°, 120°, 240°
    for (let i = 0; i < 3; i++) {
      await page.evaluate(async (y) => {
        const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSSim = FS.FSSim;
        const c = FSSim.castleOf(FS.G, 0);
        R.setCam({ dist: 26, pitch: FSC.CAM.PITCH_START, yaw: y });
        R.focusVertex(c.v, 26);
        R.setCam({ yaw: y });
        for (let k = 0; k < 8; k++) R.frame(0.033);
      }, yaws[i]);
      await t.sleep(250);
      await t.shot(page, "fs_b2_rotation_" + "abc"[i]);
    }
    t.check("rotation trio shot", true);
    await page.close();
  }

  /* ────────────────── 3. BUILD MENU — grey iff unaffordable ─────────────── */
  {
    const page = await boot(t);
    const menu = await page.evaluate(() => {
      const FS = window.__FS__, U = window.FSUI, R = FS.FSRender, FSC = FS.FSC, FSSim = FS.FSSim;
      FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
      R.setQuality(1);
      const c = FSSim.castleOf(FS.G, 0);
      /* a stock that can pay for SOME of the panel and not the rest, so the
       * shot shows both states at once */
      c.inv.plank = 2; c.inv.stone = 0;
      U.escape();
      document.querySelector('#fsDock [data-act="dock-build"]').click();
      U.frame(0.3); U.frame(0.3);
      R.focusVertex(c.v, 24);
      for (let i = 0; i < 6; i++) R.frame(0.033);
      const cards = [].map.call(document.querySelectorAll("#fsBuildGrid .build-item"),
        (b) => ({ type: b.getAttribute("data-type"), bad: b.classList.contains("bad") }));
      return { cards, bad: cards.filter((c2) => c2.bad).length, ok: cards.length - cards.filter((c2) => c2.bad).length };
    });
    await t.sleep(250);
    await t.shot(page, "fs_b2_buildmenu");
    t.check("build menu shows both affordable and unaffordable cards",
      menu.bad > 0 && menu.ok > 0, menu);
    await page.close();
  }

  /* ────────────────── 4a. ROAD THROUGH A FOREST — before / after ────────── */
  {
    const page = await boot(t);
    const stand = await page.evaluate(() => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap, FSSim = FS.FSSim;
      FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
      R.setQuality(1); R.setTreeSway(false);
      const G = FS.G, map = G.map, cf = G.flags[FSSim.castleOf(G, 0).flag];
      // a genuinely DENSE stand: plant mature trees over a disc out past the door
      let target = -1;
      FSMap.forRadius(map, cf.v, 9, (u, d) => {
        if (d !== 8 || target >= 0) return;
        if (!FSMap.whyFlag(map, u, 0)) target = u;
      });
      const path = FSSim.roadPath(G, cf.v, target, 0);
      if (!path) return { ok: false };
      const mid = path[(path.length / 2) | 0];
      let planted = 0;
      FSMap.forRadius(map, mid, 3, (u) => {
        if (map.obj[u] !== FSC.OBJ.NONE || map.flagAt[u] || FSSim.bldBlocks(G, u)) return;
        if (map.terr[u] !== FSC.TERR.GRASS) return;
        map.obj[u] = FSC.OBJ.TREE4; map.objArg[u] = 0; FSSim.dirtyVertices(G).push(u); planted++;
      });
      for (let i = 0; i < 6; i++) R.frame(0.033);
      R.focusVertex(mid, 15);
      for (let i = 0; i < 6; i++) R.frame(0.033);
      window.__STAND__ = { path, target, mid, planted };
      return { ok: true, planted, len: path.length };
    });
    await t.sleep(250);
    await t.shot(page, "fs_b2_road_thru_forest_before");
    const cut = await page.evaluate(() => {
      const FS = window.__FS__, R = FS.FSRender, FSSim = FS.FSSim;
      const G = FS.G, S = window.__STAND__;
      const ef = FSSim.placeFlag(G, S.target, 0);
      const r = FSSim.buildRoad(G, G.flags[FSSim.castleOf(G, 0).flag].id, ef.id, S.path, 0);
      for (let i = 0; i < 30; i++) R.frame(0.033);      // let the fell animation play out
      return { ok: r.ok, why: r.why || null,
        left: S.path.filter((v) => G.map.obj[v] !== 0).length };
    });
    await t.sleep(250);
    await t.shot(page, "fs_b2_road_thru_forest");
    t.check("a road really cut through the planted stand",
      stand.ok && stand.planted > 4 && cut.ok && cut.left === 0, { stand, cut });
    await page.close();
  }

  /* ────────────────── 4b. STONECUTTER on the nearest rock ───────────────── */
  {
    const page = await boot(t);
    const sc = await page.evaluate(() => {
      const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap, FSSim = FS.FSSim;
      FS.newGame({ size: "medium", seed: 12345, ais: 1, speed: 0 });
      R.setQuality(1); R.setTreeSway(false);
      const G = FS.G, map = G.map, c = FSSim.castleOf(G, 0);
      // a hut with a NEAR group and a FAR group, the shape of the complaint
      const cf = G.flags[c.flag];
      let hv = -1;
      FSMap.forRadius(map, c.v, 8, (u, d) => {
        if (d < 3 || hv >= 0) return;
        if (!FSMap.canPlaceBuilding(map, "stonecutter", u, 0)) return;
        const door = FSMap.doorVertex(map, u);
        if (door < 0 || !FSSim.roadPath(G, cf.v, door, 0)) return;   // must be connectable
        hv = u;
      });
      if (hv < 0) return { ok: false };
      const R2 = FSC.BLD.stonecutter.radius;
      FSMap.forRadius(map, hv, R2 + 2, (u) => {
        if (FSMap.isStone(map.obj[u])) { map.obj[u] = FSC.OBJ.NONE; map.objArg[u] = 0; FSSim.dirtyVertices(G).push(u); }
      });
      const near = [], far = [];
      FSMap.forRadius(map, hv, R2, (u, d) => {
        if (map.obj[u] !== FSC.OBJ.NONE || map.flagAt[u] || FSSim.bldBlocks(G, u)) return;
        if (!FSMap.walkable(map.terr[u])) return;
        if (d >= 2 && d <= 3 && near.length < 3) near.push(u);
        else if (d >= 6 && far.length < 3) far.push(u);
      });
      near.concat(far).forEach((u) => { FSMap.setStone(map, u, 8); FSSim.dirtyVertices(G).push(u); });
      const b = FSSim.build(G, "stonecutter", hv, 0);
      if (!b.ok) return { ok: false, why: b.why };
      const bl = G.buildings[b.id];
      // the hut needs a ROAD or no cutter ever walks in
      const rp = FSSim.roadPath(G, cf.v, G.flags[bl.flag].v, 0);
      const road = rp ? FSSim.buildRoad(G, cf.id, bl.flag, rp, 0) : { ok: false, why: "no path" };
      FSSim.forceComplete(G, b.id);
      FS.setSpeed(1); FS.ff(1700); FS.setSpeed(0);
      for (let i = 0; i < 8; i++) R.frame(0.033);
      R.focusVertex(hv, 19);
      for (let i = 0; i < 8; i++) R.frame(0.033);
      const cutV = G.events.filter((e) => e.type === "stoneCut").map((e) => e.v);
      return { ok: true, hut: hv, near, far, road: road.ok, roadWhy: road.why || null,
        nearCuts: cutV.filter((v) => near.indexOf(v) >= 0).length,
        farCuts: cutV.filter((v) => far.indexOf(v) >= 0).length };
    });
    await t.sleep(250);
    await t.shot(page, "fs_b2_stonecutter");
    t.check("the stonecutter shot shows him working the NEAR group",
      sc.ok && sc.nearCuts > 0 && sc.farCuts === 0, sc);
    await page.close();
  }
}, { port: 8968 });
