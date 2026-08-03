#!/usr/bin/env node
"use strict";
/**
 * _fs_b5_shots.cjs — the review plates for BATCH #5 (2026-08-02):
 * allied co-op starts, the co-op speed rail, the narrower roads, goods carried
 * in the hands, and a one-armed tool swing on both looks.
 *
 *   node tools/_fs_b5_shots.cjs
 *   FS_B5_BEFORE=1 node tools/_fs_b5_shots.cjs      (see ROADS, below)
 *
 * House pattern (same as _fs_b4_shots.cjs): every plate ASSERTS the thing its
 * filename claims BEFORE it is written, so a green run means the shots show
 * what they say they show — not merely that six PNGs exist.
 *
 * ROADS, BEFORE AND AFTER. The road paint is a module constant, so a "before"
 * frame cannot be produced by the shipping build. FS_B5_BEFORE=1 writes the
 * roads plate as `fs_b5_roads_narrow_before.png` and skips the width bars — it
 * is meant to be run ONCE against a working tree with ROAD_PAINT_HW back at
 * 1.45 and the batch-#5 ROAD_COATS reverted, which is how the shipped pair was
 * made. Every other run writes the AFTER plate and asserts it.
 *
 * Writes shots/fs_b5_{coop_allies,mp_speed,roads_narrow,carry_hands_dwarfknight,
 * carry_hands_minifig,tool_swing_dwarf,tool_swing_minifig}.png
 */
const H = require("./_fs_harness.cjs");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const urlmod = require("url");

const SHOT = (n) => "fs_b5_" + n;
/* toasts keep arriving while a plate is being set up (an autosave, a castle
 * finishing), so every plate is wiped and re-rendered on the frame it is taken */
const clean = (page) => page.evaluate(() => {
  const e = document.getElementById("fsToasts");
  if (e) e.innerHTML = "";
  window.__FS__.FSRender.frame(0.016);
});
const BEFORE = process.env.FS_B5_BEFORE === "1";
const RELAY_PORT = 8975 + Math.floor(Math.random() * 20);

/* the mp plate needs a LIVE room, and a live room needs a socket to talk to —
 * the same tiny fan-out relay the mp suite runs, verbatim in shape */
function startRelay(port) {
  const wss = new WebSocket.Server({ port, host: "127.0.0.1" });
  const rooms = new Map();
  wss.on("connection", (ws, req) => {
    const room = urlmod.parse(req.url, true).query.room || "-";
    let set = rooms.get(room);
    if (!set) { set = new Set(); rooms.set(room, set); }
    set.add(ws);
    ws.on("message", (d) => {
      const s = d.toString();
      for (const p of set) if (p !== ws && p.readyState === 1) { try { p.send(s); } catch (e) {} }
    });
    ws.on("close", () => set.delete(ws));
    ws.on("error", () => {});
  });
  return wss;
}

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
  opts = opts || {};
  const page = await t.newPage(opts.vp || { width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(t.BASE + "/castlekruzer.html" + (opts.q || ""), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 60000 });
  if (!opts.noWorld) {
    await page.evaluate((o) => window.__FS__.newGame(o), opts.game ||
      { size: "medium", seed: 12345, ais: 1, speed: 0, aiPlan: false });
    await page.waitForFunction(() => window.__FS__.started(), { timeout: 90000 });
  }
  await page.evaluate(async () => {
    const R = window.__FS__.FSRender;
    if (R.spritesLoaded) await R.spritesLoaded;
    if (R.loadGoodSprites) await R.loadGoodSprites();
    R.setQuality(1);
  });
  await page.evaluate(STAGE);
  return page;
}

H.run("farmstead-b5-shots", async (t) => {
  const shotsDir = path.join(H.ROOT, "shots");
  if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });
  const relay = startRelay(RELAY_PORT);

  /* ═══════════ 1 · ALLIED KINGDOMS ARE NEIGHBOURS ═════════════════════════ */
  {
    const page = await t.newPage({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.goto(t.BASE + "/castlekruzer.html?mpws=ws://127.0.0.1:" + RELAY_PORT + "&nolobby=1",
      { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__FS__ && !!window.THREE && !!window.FSNet, { timeout: 60000 });
    const st = await page.evaluate(() => window.__FS__.hostGame("separate",
      { seed: 31415, size: "medium", ais: 2, code: "B5ALLY", speed: 0 }));
    t.check("a separate-allied-kingdoms room really opened",
      !!st && st.role === "host" && st.mode === "separate", st);
    await page.evaluate(async () => {
      const R = window.__FS__.FSRender;
      if (R.spritesLoaded) await R.spritesLoaded;
      R.setQuality(1);
    });
    await page.evaluate(() => window.__FS__.ff(600));   // let the castles claim their ground
    const geo = await page.evaluate(() => {
      const FS = window.__FS__, G = FS.G, R = FS.FSRender, FSMap = FS.FSMap, FSC = FS.FSC;
      const S = G.map.starts, p = [];
      for (let i = 0; i < S.length; i++) { const q = [0, 0]; FSMap.worldXZ(G.map, S[i], q); p.push(q); }
      const d = (i, j) => FSMap.dist(G.map, S[i], S[j]);
      /* the NEAREST rival is the honest one to put in the frame: if even that
       * one is a long way off, the far one certainly is */
      const foe = d(0, 2) <= d(0, 3) ? 2 : 3;
      /* centred on the CENTROID of the three castles the plate is about, not on
       * the allied pair: at max zoom a rival 60 road steps away lands just off
       * the edge of a pair-centred frame (measured: x = 1308 of 1280) */
      const mid = [(p[0][0] + p[1][0] + p[foe][0]) / 3, (p[0][1] + p[1][1] + p[foe][1]) / 3];
      /* sweep the yaw for the heading that gets BOTH allied castles and that
       * rival inside the frame at once — the plate's whole claim */
      const want = [0, 1, foe];
      let best = null;
      const cv = R.renderer().domElement;
      for (let yi = 0; yi < 24; yi++) {
        const yaw = yi * (Math.PI * 2 / 24);
        R.setCam({ tx: mid[0], tz: mid[1], ty: G.map.height[S[0]], dist: FSC.CAM.DIST_MAX,
          yaw: yaw, pitch: FSC.CAM.PITCH_START });
        R.frame(0.033);
        let worst = 1e9, ok = true;
        for (const i of want) {
          const s = R.worldToScreen(p[i][0], G.map.height[S[i]], p[i][1]);
          const m = Math.min(s.x - 40, cv.width - 40 - s.x, s.y - 110, cv.height - 130 - s.y);
          if (m < 0) ok = false;
          worst = Math.min(worst, m);
        }
        if (ok && (!best || worst > best.worst)) best = { yaw: yaw, worst: worst };
      }
      if (best) {
        R.setCam({ tx: mid[0], tz: mid[1], ty: G.map.height[S[0]], dist: FSC.CAM.DIST_MAX,
          yaw: best.yaw, pitch: FSC.CAM.PITCH_START });
        for (let i = 0; i < 5; i++) R.frame(0.033);
      }
      const inv = document.getElementById("netInvite");
      if (inv) inv.style.display = "none";       // the share card sits over the map
      window.T && window.T.clearToasts();
      const screen = want.map((i) => {
        const s = R.worldToScreen(p[i][0], G.map.height[S[i]], p[i][1]);
        return { i: i, x: Math.round(s.x), y: Math.round(s.y) };
      });
      return { humans: G.humans, teams: G.players.map((x) => x.team), framed: !!best, screen,
        allyPair: d(0, 1), foe: [d(0, 2), d(0, 3), d(1, 2), d(1, 3)] };
    });
    const foeMin = Math.min.apply(null, geo.foe);
    t.check("…with the two HUMAN starts on one team and the AIs on their own",
      geo.humans === 2 && geo.teams[0] === 0 && geo.teams[1] === 0 && geo.teams[2] !== 0, geo);
    t.check("…the allies are neighbours and the enemies are not",
      geo.allyPair < foeMin * 0.6, { geo, foeMin });
    t.check("…and both allied castles AND a rival are inside the frame",
      geo.framed && geo.screen.length === 3, geo.screen);
    /* …and they READ as a pair: the two allies land far closer together on
     * screen than either lands to the rival */
    const sd = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    t.check("…with the allied pair visibly tighter on screen than the rival",
      sd(geo.screen[0], geo.screen[1]) < sd(geo.screen[0], geo.screen[2]) * 0.5, geo.screen);
    await clean(page);
    await t.shot(page, SHOT("coop_allies"));
    await page.close();
  }

  /* ═══════════ 2 · THE CO-OP SPEED RAIL: 1× AND 2× LIVE, 4× NOT ═══════════ */
  {
    const page = await t.newPage({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.goto(t.BASE + "/castlekruzer.html?mpws=ws://127.0.0.1:" + RELAY_PORT + "&nolobby=1",
      { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__FS__ && !!window.THREE && !!window.FSNet, { timeout: 60000 });
    await page.evaluate(() => window.__FS__.hostGame("shared",
      { seed: 12345, size: "medium", ais: 1, code: "B5SPD", speed: 1 }));
    await page.evaluate(() => window.__FS__.ff(400));
    const rail = await page.evaluate(() => {
      const FSUI = window.FSUI;
      const row = document.getElementById("fsSpeed");
      // pick 2x through the real control, then read the rail back
      const two = row.querySelector('[data-speed="2"]');
      two.click();
      window.__FS__.paintHud();
      window.__FS__.FSRender.frame(0.033);
      window.T && window.T.clearToasts();
      const state = {};
      [0, 1, 2, 4].forEach((s) => {
        const b = row.querySelector('[data-speed="' + s + '"]');
        state[s] = { disabled: !!b.disabled, on: b.classList.contains("on") };
      });
      return { state, speed: window.__FS__.G.speed, active: window.FSNet.active(),
        cap: window.FSC ? window.FSC.MP_MAX_SPEED : null,
        allowed: FSUI.speedAllowed ? [FSUI.speedAllowed(2), FSUI.speedAllowed(4)] : null };
    });
    t.check("the room really is live for the speed plate", rail.active === true, rail);
    t.check("co-op: pause, 1× and 2× are all live on the rail",
      !rail.state[0].disabled && !rail.state[1].disabled && !rail.state[2].disabled, rail.state);
    t.check("…4× is greyed", rail.state[4].disabled === true, rail.state);
    t.check("…and clicking 2× really moved the clock", rail.speed === 2 && rail.state[2].on, rail);
    await clean(page);
    await t.shot(page, SHOT("mp_speed"));
    await page.close();
  }

  /* ═══════════ 3 · THE ROADS ARE NARROWER, AND A SERF WALKS THEM ══════════ */
  {
    const page = await boot(t, { game: { size: "medium", seed: 12345, ais: 1, speed: 0, aiPlan: false } });
    await page.evaluate(() => {
      const FS = window.__FS__;
      window.T.build("lumberjack", 4, 11);
      window.T.build("sawmill", 4, 12);
      window.T.build("forester", 5, 12);
      FS.ff(1500);
    });
    const road = await page.evaluate(() => {
      const FS = window.__FS__, G = FS.G, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap;
      /* find a serf who is ON a road, and frame him at PLAY zoom: the claim is
       * that the paint still covers the line the sim walks him down */
      /* the visual layer is interpolated, so it has to be stepped with the SAME
       * dt the tick is worth (0.1 s) — feeding it more per tick runs every
       * settler to the end of his edge and reads back speed 0 */
      let hit = null, spare = null;
      for (let i = 0; i < 4000 && !hit; i++) {
        FS.ff(1);
        R.syncDynamic(0.1);
        for (const id in G.serfs) {
          const s = G.serfs[id];
          if (s.state === "work" || s.state === "garrison") continue;
          const v = R.serfPose(s.id);
          if (!v || v.appear < 0.98) continue;
          if (R.roadCover(v.x, v.z) < 120) continue;
          const c = { id: s.id, x: v.x, y: v.y, z: v.z, speed: v.speed };
          if (v.speed > 0.02) { hit = c; break; }
          if (!spare) spare = c;
        }
      }
      hit = hit || spare;
      if (!hit) return null;
      R.setCam({ tx: hit.x, tz: hit.z, ty: hit.y, dist: FSC.CAM.DIST_START * 0.55,
        yaw: 0.4, pitch: FSC.CAM.PITCH_START });
      for (let i = 0; i < 4; i++) R.frame(0.033);
      window.T.clearToasts();
      // the cross-section, measured the same way the visuals suite measures it
      const a = [0, 0], b = [0, 0]; const body = [], edge = [];
      for (const id in G.roads) {
        const p = G.roads[id].path;
        for (let i = 1; i < p.length && body.length < 24; i++) {
          FSMap.worldXZ(G.map, p[i - 1], a); FSMap.worldXZ(G.map, p[i], b);
          const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
          if (L < 0.2) continue;
          const nx = -dz / L, nz = dx / L;
          const cx = (a[0] + b[0]) * 0.5, cz = (a[1] + b[1]) * 0.5;
          if (R.roadCover(cx, cz) < 150) continue;
          for (const sg of [-1, 1]) {
            let sol = 0, any = 0, s = 0;
            for (; s <= 1.2; s += 0.02) { if (R.roadCover(cx + nx * sg * s, cz + nz * sg * s) < 150) break; sol = s; }
            for (any = sol; any <= 1.2; any += 0.02) { if (R.roadCover(cx + nx * sg * any, cz + nz * sg * any) < 12) break; }
            body.push(sol); edge.push(any);
          }
        }
      }
      const av = (x) => x.reduce((p2, q) => p2 + q, 0) / Math.max(1, x.length);
      return { hit, cover: R.roadCover(hit.x, hit.z), n: body.length,
        body: +av(body).toFixed(3), edge: +av(edge).toFixed(3), ROAD_W: FSC.ROAD_W };
    });
    t.check("a serf was caught walking a painted road at play zoom", !!road && road.cover >= 120, road);
    if (!BEFORE) {
      t.check("the painted body is a footpath (1.0–1.4 × FSC.ROAD_W)",
        road.n >= 8 && road.body > road.ROAD_W * 1.0 && road.body < road.ROAD_W * 1.4, road);
      t.check("…and it still feathers out into the grass",
        road.edge > road.body * 1.35, road);
    }
    console.log("   road cross-section: body " + road.body + " · edge " + road.edge);
    await clean(page);
    await t.shot(page, SHOT(BEFORE ? "roads_narrow_before" : "roads_narrow"));
    await page.close();
  }

  /* ═══════════ 4+5 · CARRY IN THE HANDS, AND A ONE-ARMED SWING ════════════ */
  /* THE PEOPLE PLATES USE A SMALLER WINDOW, and that is not a cheat: CAM.DIST_MIN
   * is 8 world units, so setCam cannot bring the camera closer than the game
   * itself allows. The vertical FOV is fixed, so a TALLER frame spends more
   * pixels on the same world span and the settler comes out bigger — every
   * pixel is still a shipping frame at a shipping zoom. */
  for (const look of ["dwarfknight", "minifig"]) {
    const page = await boot(t, { q: "?look=" + look, vp: { width: 1600, height: 1000, deviceScaleFactor: 1 },
      game: { size: "medium", seed: 12345, ais: 1, speed: 0, aiPlan: false } });
    await page.evaluate(() => window.__FS__.FSRender.setSpriteTrace(true));
    await page.evaluate(() => {
      const FS = window.__FS__;
      const a = window.T.build("lumberjack", 4, 11);
      window.T.build("forester", 4, 11, a && a.v);
      window.T.build("sawmill", 4, 12);
      FS.ff(1200);
    });

    /* the carried good: framed close, and MEASURED against the pose that draws
     * it — the whole bug this batch fixes was arithmetic, not art */
    const carry = await page.evaluate(() => {
      const FS = window.__FS__, G = FS.G, R = FS.FSRender, FSC = FS.FSC;
      const seen = [];
      let shot = null;
      for (let i = 0; i < 6000; i++) {
        FS.ff(1);
        for (let q = 0; q < 4; q++) R.syncDynamic(0.05);
        for (const id in G.serfs) {
          const s = G.serfs[id];
          if (!s.carry || s.state === "work" || s.state === "garrison") continue;
          const v = R.serfPose(s.id);
          if (!v || v.appear < 0.98) continue;
          R.frame(0.016);
          const tr = R.spritePose(s.id);
          if (!tr || !tr.good) continue;
          seen.push({ res: tr.good.res, pose: tr.pose, moving: v.speed > 0.02,
            handsY: +tr.good.handsY.toFixed(3), baseY: +tr.good.baseY.toFixed(3), seatY: +tr.good.seatY.toFixed(3),
            headY: +tr.good.headY.toFixed(3) });
          if (!shot) {
            R.setCam({ tx: v.x, tz: v.z, ty: v.y, dist: 5, yaw: 0.9, pitch: FSC.CAM.PITCH_MIN });
            for (let k = 0; k < 3; k++) R.frame(0.016);
            window.T.clearToasts();
            shot = { id: s.id, pose: tr.pose };
          }
        }
        if (seen.length >= 24) break;
      }
      const min = (k) => Math.min.apply(null, seen.map((x) => x[k]));
      const poses = {};
      seen.forEach((x) => { poses[x.pose] = (poses[x.pose] || 0) + 1; });
      return { n: seen.length, shot, poses,
        minSeat: min("seatY"), minBase: min("baseY"), minHead: min("headY"),
        worstDrop: Math.max.apply(null, seen.map((x) => Math.abs(x.seatY - x.handsY))),
        moving: seen.filter((x) => x.moving).length, still: seen.filter((x) => !x.moving).length,
        goods: Object.keys(seen.reduce((a, x) => (a[x.res] = 1, a), {})) };
    });
    t.check(look + ": hauling serfs were caught carrying", !!carry && carry.n >= 6, carry);
    t.check(look + ": …every one of them in the CARRY rows",
      !!carry && Object.keys(carry.poses).length === 1 && carry.poses.carry === carry.n, carry && carry.poses);
    /* THE BUG, as a bar. Before this batch the seat came out at −0.015 world
     * units on this look — BELOW the settler's boots. It must sit in the
     * hands: near the hands anchor, and a long way above the ground. */
    t.check(look + ": …with the load well above his boots (over a third of his own height)",
      !!carry && carry.minBase > carry.minHead * 0.12 && carry.minSeat > carry.minHead * 0.33, carry);
    t.check(look + ": …and seated ON the hands, not slung off them",
      !!carry && carry.worstDrop < carry.minHead * 0.45, carry);
    await clean(page);
    await t.shot(page, SHOT("carry_hands_" + look));

    /* the swing: ONE arm. Measured off the sheets' own anchors — the tool hand
     * and the off hand, both relative to the TORSO (the `pack` anchor), so the
     * body's own lean and bob are not counted as arm movement. */
    const swing = await page.evaluate(() => {
      const R = window.__FS__.FSRender;
      const M = R.spriteInfo();
      const rows = [];
      const step = Math.PI * 2 / M.azimuths;
      for (let az = 0; az < M.azimuths; az++) {
        const t2 = [], o = [], pk = [];
        for (let k = 0; k < 6; k++) {
          const c = R.spriteResolve({ kind: "serf", pose: "work", swing: k / 5, yaw: az * step, camYaw: 0 });
          if (!c || !c.anchors.offhand) return null;
          t2.push([c.anchors.tool.x, c.anchors.tool.y]);
          o.push([c.anchors.offhand.x, c.anchors.offhand.y]);
          pk.push([c.anchors.pack.x, c.anchors.pack.y]);
        }
        const span = (arr) => Math.hypot(
          Math.max.apply(null, arr.map((p) => p[0])) - Math.min.apply(null, arr.map((p) => p[0])),
          Math.max.apply(null, arr.map((p) => p[1])) - Math.min.apply(null, arr.map((p) => p[1])));
        const rel = (arr) => arr.map((p, i) => [p[0] - pk[i][0], p[1] - pk[i][1]]);
        rows.push({ tool: span(rel(t2)), off: span(rel(o)), torso: span(pk), offAbs: span(o) });
      }
      const mx = (k) => Math.max.apply(null, rows.map((r) => r[k]));
      return { tool: +mx("tool").toFixed(1), off: +mx("off").toFixed(1),
        torso: +mx("torso").toFixed(1), offAbs: +mx("offAbs").toFixed(1) };
    });
    console.log("   " + look + " work swing: tool hand " + swing.tool + " px vs off hand "
      + swing.off + " px (torso alone " + swing.torso + ")");
    t.check(look + ": the TOOL hand carries the swing and the off hand does not",
      swing.off < swing.tool * 0.45, swing);
    t.check(look + ": …the off hand barely moves apart from riding the torso",
      swing.offAbs < swing.torso * 1.35, swing);

    /* …and a picture of it. A worker stands UNDER what he is working on, so the
     * camera sweeps the circle and keeps the clearest sight line (the b4
     * lesson, verbatim). */
    const strike = await page.evaluate(() => {
      const FS = window.__FS__, G = FS.G, R = FS.FSRender, FSC = FS.FSC;
      for (let i = 0; i < 6000; i++) {
        FS.ff(1);
        for (const id in G.serfs) {
          const s = G.serfs[id];
          if (!(s.job === FSC.JOB.BUILDER && s.state === "hammer")
            && !(s.job === FSC.JOB.LUMBERJACK && s.state === "doWork")) continue;
          R.syncDynamic(0.02);
          const v = R.serfPose(s.id);
          if (!v) continue;
          const gl = R.renderer().getContext(), cv = R.renderer().domElement;
          const px = new Uint8Array(4);
          let bestYaw = 0.9, bestScore = -1;
          for (let yi = 0; yi < 16; yi++) {
            const yy = yi * 0.3927;
            R.setCam({ tx: v.x, tz: v.z, ty: v.y, dist: 7, yaw: yy, pitch: FSC.CAM.PITCH_MIN });
            for (let k = 0; k < 2; k++) R.frame(0.016);
            let sc = 0;
            for (const h of [0.20, 0.45]) {
              const sp = R.worldToScreen(v.x, v.y + h, v.z);
              gl.readPixels(Math.round(sp.x), Math.round(cv.height - sp.y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
              sc += Math.abs(px[0] - px[1]) + px[0] + px[2];
            }
            if (sc > bestScore) { bestScore = sc; bestYaw = yy; }
          }
          R.setCam({ tx: v.x, tz: v.z, ty: v.y, dist: 6, yaw: bestYaw, pitch: FSC.CAM.PITCH_MIN });
          for (let k = 0; k < 3; k++) R.frame(0.016);
          window.T.clearToasts();
          return { id: s.id, job: s.job, trace: R.spritePose(s.id) };
        }
      }
      return null;
    });
    t.check(look + ": a worker was caught mid-strike", !!strike && strike.trace.pose === "work", strike);
    t.check(look + ": …with his tool swept off the rest angle",
      !!strike && strike.trace.overlays.some((o) => o.id.indexOf("tool_") === 0 && Math.abs(o.rot) > 0.1),
      strike && strike.trace);
    await clean(page);
    await t.shot(page, SHOT("tool_swing_" + (look === "dwarfknight" ? "dwarf" : "minifig")));
    await page.close();
  }

  t.check("0 page errors", t.errors.length === 0, t.errors.slice(0, 5));
  try { relay.close(); } catch (e) { /* noop */ }
});
