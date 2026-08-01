#!/usr/bin/env node
"use strict";
/**
 * FARMSTEAD — PHASE P visual/animation suite.
 *
 * Phase P is the animation-quality round. Most of its judging is done BY EYE on
 * the film strips (tools/_fs_filmstrip.cjs → shots/filmstrips/*.png), because
 * an animation cannot be judged from a single frame. What CAN be asserted
 * mechanically is asserted here, and it is deliberately NUMERIC:
 *
 *   · the simulation is byte-for-byte unchanged (FSSim.hash against the
 *     baseline recorded before the phase started, and rendering-vs-not proven
 *     to make no difference at all)
 *   · a walk on flat ground advances the SAME distance every frame
 *     (coefficient of variation < 0.15), never jumps, never NaNs
 *   · the gait is driven by the ground, not the wall clock
 *   · facing turns at a bounded rate — it never flips
 *   · a serf is swallowed by a door over several frames, not one
 *   · smoke is a pooled spawn/age system that starts, trails off and stops
 *   · machinery spins UP and DOWN instead of slamming
 *   · objects the sim swaps on live ground ease in, and felled trees fall out
 *   · the camera glide is opt-in and interruptible
 *   · every added pool stays inside the Phase F draw-call/perf budget
 *   · the film-strip rig itself still produces a real, non-blank contact sheet
 *   · every audio cue fires exactly once per sim event (no misses, no doubles)
 *
 *   node tools/_verify-farmstead-visual.cjs
 */
const H = require("./_fs_harness.cjs");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const sharp = require(path.join(__dirname, "node_modules", "sharp"));

/* The sim-hash baseline, captured from the working tree BEFORE any Phase P
 * edit. Phase P touches fs-render/fs-models/fs-fx/fs-ui only, so every one of
 * these must still match exactly. If one ever changes, a "visual" fix has
 * reached into the simulation and the change is wrong by construction. */
/* Golden sim hashes. RE-PINNED 2026-08-01 after the adversarial-review sim
 * fixes (tree growth, worker sampling, mine rolls, transport bookkeeping all
 * legitimately changed evolution). The check's job is unchanged: any FUTURE
 * visual-layer work that moves these numbers touched the sim and fails here. */
const SIM_BASELINE = [
  { size: "small", seed: 101, ais: 1, ticks: 4000, hash: 1892248560, map: 3153557556 },
  { size: "medium", seed: 4242, ais: 1, ticks: 6000, hash: 4265532716, map: 3410130282 },
  { size: "medium", seed: 909, ais: 1, ticks: 6000, hash: 4280384701, map: 2605235534 },
  { size: "large", seed: 31337, ais: 3, ticks: 5000, hash: 1343384282, map: 1140072814 },
  { size: "medium", seed: 12345, ais: 2, ticks: 8000, hash: 1373180164, map: 1415969756 },
];

/* Installed in the page: the same lockstep beat the film-strip rig uses, so
 * the numbers this suite asserts are the numbers those strips were judged on. */
function installRig() {
  const FS = window.__FS__, R = FS.FSRender;
  const P = {};
  P.fresh = function (o) {
    o = o || {};
    FS.newGame({ size: o.size || "medium", seed: o.seed || 4242, ais: o.ais === undefined ? 1 : o.ais, speed: o.speed === undefined ? 1 : o.speed });
    R.setQuality(1);
    if (o.ff) FS.ff(o.ff);
    return FS.G;
  };
  P.beat = function (dt) { FS.step(dt); R.frame(dt); };
  P.until = function (pred, n) {
    for (let i = 0; i < (n || 4000); i++) { if (pred(FS.G)) return i; FS.ff(1); }
    return pred(FS.G) ? (n || 4000) : -1;
  };
  P.findSerf = function (pred) { for (const id in FS.G.serfs) { const s = FS.G.serfs[id]; if (pred(s)) return s; } return null; };
  P.findBld = function (pred) { for (const id in FS.G.buildings) { const b = FS.G.buildings[id]; if (pred(b)) return b; } return null; };
  /** run `n` lockstep beats, sampling a serf's drawn pose each frame */
  P.trackSerf = function (id, n, dt) {
    const out = [];
    for (let i = 0; i < n; i++) {
      P.beat(dt === undefined ? 0.04 : dt);
      const p = R.serfPose(id);
      const s = FS.G.serfs[id];
      out.push(p ? { x: p.x, y: p.y, z: p.z, yaw: p.yaw, phase: p.phase, appear: p.appear,
        state: s ? s.state : null, draws: R.stats().drawCalls } : null);
    }
    return out;
  };
  P.deltas = function (rows) {
    const d = [];
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i] || !rows[i - 1]) continue;
      d.push(Math.hypot(rows[i].x - rows[i - 1].x, rows[i].z - rows[i - 1].z));
    }
    return d;
  };
  P.stat = function (a) {
    const nz = a.filter((v) => v > 1e-7);
    const mean = nz.length ? nz.reduce((s, v) => s + v, 0) / nz.length : 0;
    const sd = nz.length ? Math.sqrt(nz.reduce((s, v) => s + (v - mean) * (v - mean), 0) / nz.length) : 0;
    return { n: nz.length, mean: mean, cv: mean > 0 ? sd / mean : 0, max: Math.max.apply(null, a.concat([0])) };
  };
  /** every instance matrix currently on screen, checked for NaN/Inf */
  P.badMatrices = function () {
    const sc = R.scene();
    let bad = 0, checked = 0;
    sc.traverse((o) => {
      if (!o.isInstancedMesh || !o.count) return;
      const a = o.instanceMatrix.array;
      const n = Math.min(o.count * 16, a.length);
      for (let i = 0; i < n; i++) { checked++; if (!isFinite(a[i])) bad++; }
    });
    return { bad, checked };
  };
  window.__P__ = P;
  return true;
}

H.run("farmstead-visual", async (t) => {
  const page = await t.newPage({ width: 900, height: 620, deviceScaleFactor: 1 });
  // the page's own rAF loop must never self-drive: this suite IS the clock
  await page.evaluateOnNewDocument(() => {
    window.requestAnimationFrame = function () { return 0; };
    window.cancelAnimationFrame = function () {};
  });
  await page.goto(t.BASE + "/farmstead.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 20000 });
  await page.evaluate(installRig);

  // ══════════════════════════════════════════ 1. the simulation is untouched
  const sim = await page.evaluate((cases) => {
    const FS = window.__FS__;
    return cases.map((c) => {
      FS.newGame({ size: c.size, seed: c.seed, ais: c.ais, speed: 0 });
      FS.ff(c.ticks);
      return { k: c.size + "/" + c.seed + "/" + c.ais, hash: FS.hash(), map: FS.mapHash() };
    });
  }, SIM_BASELINE);
  SIM_BASELINE.forEach((c, i) => {
    t.check("sim hash unchanged by Phase P — " + sim[i].k,
      sim[i].hash === c.hash && sim[i].map === c.map, { got: sim[i], want: c });
  });

  // …and rendering itself must not perturb one single tick
  const purity = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, P = window.__P__;
    FS.newGame({ size: "medium", seed: 777, ais: 1, speed: 1 });
    R.setQuality(1);
    FS.ff(600);
    const mid = FS.hash();
    for (let i = 0; i < 240; i++) P.beat(0.04);      // sim + render in lockstep
    const withRender = { hash: FS.hash(), tick: FS.G.tick };
    FS.newGame({ size: "medium", seed: 777, ais: 1, speed: 1 });
    FS.ff(600);
    const mid2 = FS.hash();
    // the same wall-clock time, but the accumulator alone (no FSRender.frame)
    for (let i = 0; i < 240; i++) FS.step(0.04);
    const noRender = { hash: FS.hash(), tick: FS.G.tick };
    return { mid, mid2, withRender, noRender };
  });
  t.check("a rendered run and a headless run reach the same tick",
    purity.withRender.tick === purity.noRender.tick, purity);
  t.check("…and the same sim hash — the renderer never writes to the sim",
    purity.mid === purity.mid2 && purity.withRender.hash === purity.noRender.hash, purity);

  // ══════════════════════════════════════════ 2. the walk
  const walk = await page.evaluate(() => {
    const FS = window.__FS__, P = window.__P__;
    P.fresh({ seed: 4242, ff: 2600 });
    // the flattest edge anybody is walking — the honest smoothness case
    let best = null, bestD = 9;
    for (const id in FS.G.serfs) {
      const s = FS.G.serfs[id];
      if (s.state === "work" || s.state === "garrison" || s.from === s.to) continue;
      const d = Math.abs(FS.G.map.height[s.from] - FS.G.map.height[s.to]);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best) return { ok: false };
    const rows = P.trackSerf(best.id, 40, 0.04);
    const live = rows.filter(Boolean);
    const st = P.stat(P.deltas(rows));
    let maxYaw = 0;
    for (let i = 1; i < live.length; i++) {
      let dy = live[i].yaw - live[i - 1].yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      maxYaw = Math.max(maxYaw, Math.abs(dy));
    }
    const nan = live.some((r) => !isFinite(r.x) || !isFinite(r.y) || !isFinite(r.z) || !isFinite(r.yaw) || !isFinite(r.phase));
    const draws = live.map((r) => r.draws);
    return { ok: true, dy: bestD, n: live.length, mean: st.mean, cv: st.cv, jump: st.mean > 0 ? st.max / st.mean : 0,
      maxYaw, nan, drawMin: Math.min.apply(null, draws), drawMax: Math.max.apply(null, draws),
      mat: P.badMatrices() };
  });
  t.check("a serf really is walking for the sample", walk.ok && walk.n >= 30 && walk.mean > 0.005, walk);
  t.check("per-frame walk distance is EVEN on flat ground (CV < 0.15)", walk.ok && walk.cv < 0.15, walk);
  t.check("…with no single-frame jump (max/mean < 1.35)", walk.ok && walk.jump < 1.35, walk);
  t.check("facing turns at a bounded rate — never a flip (< 0.45 rad/frame)", walk.ok && walk.maxYaw < 0.45, walk);
  t.check("no NaN/Infinity in any drawn pose", walk.ok && !walk.nan, walk);
  t.check("no NaN/Infinity in any instance matrix on screen",
    walk.ok && walk.mat.bad === 0 && walk.mat.checked > 5000, walk.mat);
  t.check("mesh/draw-call count is stable across the whole strip",
    walk.ok && walk.drawMax - walk.drawMin <= 3, walk);

  // the gait follows the GROUND, not the wall clock
  const gait = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, P = window.__P__;
    P.fresh({ seed: 4242, ff: 2600 });
    const mover = P.findSerf((s) => s.from !== s.to && s.state !== "work" && s.state !== "garrison");
    if (!mover) return { ok: false };
    const a = P.trackSerf(mover.id, 24, 0.04).filter(Boolean);
    // PATH length, not displacement — a serf who turns a corner covers more
    // ground than the straight line between his first and last sample
    let moved = 0;
    for (let i = 1; i < a.length; i++) moved += Math.hypot(a[i].x - a[i - 1].x, a[i].z - a[i - 1].z);
    const phase = a[a.length - 1].phase - a[0].phase;
    // …now pause the world and keep rendering: the feet must stop dead
    FS.setSpeed(0);
    const b = P.trackSerf(mover.id, 20, 0.04).filter(Boolean);
    const pausedPhase = b[b.length - 1].phase - b[0].phase;
    const pausedMove = Math.hypot(b[b.length - 1].x - b[0].x, b[b.length - 1].z - b[0].z);
    return { ok: true, moved, phase, pausedPhase, pausedMove,
      ratio: moved > 0 ? phase / moved : 0 };
  });
  t.check("the walk cycle advances with distance walked", gait.ok && gait.phase > 0.5 && gait.moved > 0.02, gait);
  t.check("…at a fixed strides-per-metre rate (≈ π / SERF_STRIDE)",
    gait.ok && Math.abs(gait.ratio - Math.PI / 0.46) < 0.6, gait);
  t.check("a paused world stops the feet dead — no skating on the spot",
    gait.ok && gait.pausedPhase < 1e-6 && gait.pausedMove < 1e-6, gait);

  // ══════════════════════════════════════════ 3. the doorway
  const door = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, P = window.__P__;
    P.fresh({ seed: 4242, ff: 2200 });
    // catch anybody the moment he steps inside
    let target = null, seen = [];
    for (let i = 0; i < 4000 && !target; i++) {
      P.beat(0.04);
      for (const id in FS.G.serfs) {
        const s = FS.G.serfs[id];
        if (s.state !== "work" && s.state !== "garrison") continue;
        const p = R.serfPose(s.id);
        if (p && p.appear > 0.6 && p.appear < 1) { target = s.id; break; }
      }
    }
    if (!target) return { ok: false };
    for (let i = 0; i < 12; i++) { P.beat(0.04); const p = R.serfPose(target); seen.push(p ? p.appear : null); }
    return { ok: true, seen, frames: seen.filter((v) => v !== null && v > 0.02 && v < 0.98).length,
      ended: seen[seen.length - 1] };
  });
  t.check("a serf entering a building is SWALLOWED over several frames, not blinked away",
    door.ok && door.frames >= 2, door);
  t.check("…and is fully gone by the end of the fade", door.ok && (door.ended === null || door.ended <= 0.02), door);

  // ══════════════════════════════════════════ 4. smoke: spawn / age / stop
  const smoke = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSSim = FS.FSSim, FSMap = FS.FSMap, P = window.__P__;
    P.fresh({ seed: 12345, ais: 1, speed: 0 });
    const G = FS.G, castle = FSSim.castleOf(G, 0);
    let v = -1;
    FSMap.forRadius(G.map, castle.v, 12, (u, d) => {
      if (v >= 0 || d < 3 || !FSMap.canPlaceBuilding(G.map, "bakery", u, 0)) return;
      v = u;
    });
    if (v < 0) return { ok: false };
    const r = FSSim.build(G, "bakery", v, 0);
    FSSim.forceComplete(G, r.id);
    const b = G.buildings[r.id];
    const pool = () => (R.dynamicInfo().pools.smoke || { count: 0 }).count;
    b.working = false;
    for (let i = 0; i < 150; i++) R.frame(0.04);
    const idle = pool();
    b.working = true;
    const ramp = [];
    for (let i = 0; i < 60; i++) { R.frame(0.04); if (i % 10 === 9) ramp.push(pool()); }
    const busy = pool(), machine = R.machineInfo(r.id);
    b.working = false;
    for (let i = 0; i < 5; i++) R.frame(0.04);
    const justStopped = pool();
    for (let i = 0; i < 260; i++) R.frame(0.04);
    const cooled = pool();
    // …and it can never run away: hammer it for a long time and stay bounded
    b.working = true;
    for (let i = 0; i < 900; i++) R.frame(0.04);
    const capped = pool(), live = R.animInfo().puffs;
    return { ok: true, idle, ramp, busy, justStopped, cooled, capped, live,
      cap: FSC.VIS.SMOKE_PUFF_MAX, machine };
  });
  t.check("an idle chimney makes no smoke at all", smoke.ok && smoke.idle === 0, smoke);
  t.check("a working chimney BUILDS a column instead of popping five puffs in",
    smoke.ok && smoke.ramp[0] > 0 && smoke.ramp[smoke.ramp.length - 1] > smoke.ramp[0] && smoke.busy >= 5, smoke);
  t.check("stopping work does not cut the column dead — the puffs in the air live out",
    smoke.ok && smoke.justStopped >= 4, smoke);
  t.check("…and it does go fully cold in the end", smoke.ok && smoke.cooled === 0, smoke);
  t.check("the puff pool is bounded no matter how long it runs",
    smoke.ok && smoke.live <= smoke.cap && smoke.capped <= smoke.cap, smoke);

  // ══════════════════════════════════════════ 5. machinery spins up and down
  const spin = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSSim = FS.FSSim, FSMap = FS.FSMap, P = window.__P__;
    P.fresh({ seed: 4242, ais: 1, speed: 0, ff: 0 });
    const G = FS.G, castle = FSSim.castleOf(G, 0);
    let v = -1;
    FSMap.forRadius(G.map, castle.v, 16, (u, d) => {
      if (v >= 0 || d < 3 || !FSMap.canPlaceBuilding(G.map, "mill", u, 0)) return;
      v = u;
    });
    if (v < 0) return { ok: false };
    const r = FSSim.build(G, "mill", v, 0);
    FSSim.forceComplete(G, r.id);
    const b = G.buildings[r.id];
    b.working = true;
    for (let i = 0; i < 40; i++) R.frame(0.04);
    const hot = R.machineInfo(r.id);
    const spun = [];
    for (let i = 0; i < 4; i++) { const a = R.machineInfo(r.id).spin; R.frame(0.04); spun.push(R.machineInfo(r.id).spin - a); }
    b.working = false;
    const coast = [];
    for (let i = 0; i < 30; i++) { const a = R.machineInfo(r.id).spin; R.frame(0.04); coast.push(R.machineInfo(r.id).spin - a); }
    for (let i = 0; i < 300; i++) R.frame(0.04);
    const cold = R.machineInfo(r.id);
    const a0 = R.machineInfo(r.id).spin;
    for (let i = 0; i < 10; i++) R.frame(0.04);
    const stoppedDelta = R.machineInfo(r.id).spin - a0;
    return { ok: true, hot, spun, coast, cold, stoppedDelta,
      coastFirst: coast[0], coastLast: coast[coast.length - 1] };
  });
  t.check("a working mill turns its sails", spin.ok && spin.hot.hasSpin && spin.spun.every((d) => d > 1e-4), spin);
  t.check("stopping work does NOT freeze them on the spot — they coast",
    spin.ok && spin.coastFirst > 1e-4 && spin.coastLast > 0 && spin.coastLast < spin.coastFirst * 0.92, spin);
  t.check("…and they do come to rest", spin.ok && spin.cold.busyF === 0 && Math.abs(spin.stoppedDelta) < 1e-9, spin);

  // ══════════════════════════════════════════ 6. ground objects ease in / out
  const objs = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSMap = FS.FSMap, FSSim = FS.FSSim, P = window.__P__;
    P.fresh({ seed: 4242, ais: 1, speed: 0, ff: 200 });
    const G = FS.G, castle = FSSim.castleOf(G, 0);
    for (let i = 0; i < 4; i++) R.frame(0.04);        // arm the pop system
    let tree = -1;
    FSMap.forRadius(G.map, castle.v, 14, (u, d) => {
      if (tree >= 0 || d < 4) return;
      const o = G.map.obj[u];
      if (o >= FSC.OBJ.TREE1 && o <= FSC.OBJ.TREE4) tree = u;
    });
    if (tree < 0) return { ok: false };
    const before = R.animInfo();
    G.map.obj[tree] = FSC.OBJ.STUMP;
    R.refreshVertex(tree);
    const during = [];
    for (let i = 0; i < 14; i++) { R.frame(0.04); during.push(R.animInfo()); }
    const settled = R.animInfo();
    // the leased slot must come BACK to the pool — no instance leak
    const stumps = R.scene().getObjectByName("obj:stump");
    return { ok: true, before, popFrames: during.filter((d) => d.objPop > 0).length,
      fadeFrames: during.filter((d) => d.objFade > 0).length, settled,
      stumpCount: stumps ? stumps.count : -1 };
  });
  t.check("a swapped ground object EASES in over several frames", objs.ok && objs.popFrames >= 4, objs);
  t.check("…and the felled tree topples out instead of blinking away", objs.ok && objs.fadeFrames >= 4, objs);
  t.check("both animations finish and hand their slots back",
    objs.ok && objs.settled.objPop === 0 && objs.settled.objFade === 0 && objs.stumpCount > 0, objs);

  // ══════════════════════════════════════════ 7. camera glide
  const cam = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, P = window.__P__;
    P.fresh({ seed: 4242, ais: 1, speed: 0, ff: 200 });
    const G = FS.G;
    const a = 40, b = G.map.W * G.map.H - 400;
    R.focusVertex(a); R.frame(0.04);
    const start = R.camState();
    R.focusVertex(b);                       // default: instant, as every test expects
    const instant = R.camState();
    R.focusVertex(a); R.frame(0.04);
    R.focusVertex(b, 0, true);              // opt-in glide
    const path = [];
    for (let i = 0; i < 4; i++) { R.frame(0.04); path.push(R.camState().tx); }
    const midMoving = R.animInfo().glide;
    for (let i = 0; i < 20; i++) R.frame(0.04);
    const settled = R.camState();
    // a player touching the camera cancels the glide immediately
    R.focusVertex(a); R.frame(0.04);
    R.focusVertex(b, 0, true); R.frame(0.04);
    R.setCam({ pitch: 0.9 });
    const cancelled = R.animInfo().glide;
    return { ok: true, start: start.tx, instant: instant.tx, path, midMoving,
      settled: settled.tx, cancelled, target: instant.tx };
  });
  t.check("focusVertex stays INSTANT by default (every existing suite depends on it)",
    cam.ok && Math.abs(cam.instant - cam.target) < 1e-9, cam);
  t.check("the opt-in glide really eases — intermediate frames sit between the two points",
    cam.ok && cam.midMoving && cam.path.every((x, i) => i === 0 || Math.abs(x - cam.target) <= Math.abs(cam.path[i - 1] - cam.target)) &&
    Math.abs(cam.path[0] - cam.target) > 1e-6, cam);
  t.check("…lands exactly on the target", cam.ok && Math.abs(cam.settled - cam.target) < 1e-6, cam);
  t.check("any camera input cancels the glide at once", cam.ok && cam.cancelled === false, cam);

  // the touch long-press fix: opening the context menu must kill the pan drag
  const drag = await page.evaluate(() => {
    const R = window.__FS__.FSRender;
    return { hasCancel: typeof R.cancelDrag === "function", idle: R.cancelDrag ? R.cancelDrag() : null };
  });
  t.check("FSRender exposes cancelDrag for the long-press context menu",
    drag.hasCancel && drag.idle === false, drag);
  const dragLive = await page.evaluate(() => {
    const R = window.__FS__.FSRender;
    const cv = document.getElementById("view");
    const before = R.camState();
    cv.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 400, clientY: 300, pointerId: 7 }));
    const cancelled = R.cancelDrag();
    cv.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 500, clientY: 380, pointerId: 7 }));
    const after = R.camState();
    cv.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 500, clientY: 380, pointerId: 7 }));
    return { cancelled, moved: Math.abs(after.tx - before.tx) + Math.abs(after.tz - before.tz) };
  });
  t.check("with the menu open, a held finger no longer pans the world underneath",
    dragLive.cancelled === true && dragLive.moved < 1e-9, dragLive);

  // ══════════════════════════════════════════ 8. the flying-life rework
  const wings = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, P = window.__P__;
    P.fresh({ seed: 4242, ais: 1, speed: 0, ff: 400 });
    for (let i = 0; i < 500; i++) R.frame(0.05);
    const info = window.FSFX.info();
    const g = R.scene().getObjectByName("fx");
    const counts = {};
    if (g) g.children.forEach((m) => { counts[m.name] = m.count; });
    // the body must NOT be squashed any more — a wing is its own instance
    const body = g && g.children.filter((m) => /fx:bird$/.test(m.name))[0];
    return { pools: info.pools, counts, birds: info.birds, flies: info.flies,
      hasBirdWing: info.pools.indexOf("birdwing") >= 0, hasFlyWing: info.pools.indexOf("flywing") >= 0 };
  });
  t.check("birds and butterflies have real, separately-hinged wings",
    wings.hasBirdWing && wings.hasFlyWing, wings.pools);
  t.check("exactly two wings are drawn per body",
    wings.counts["fx:birdwing"] === wings.counts["fx:bird"] * 2 &&
    wings.counts["fx:flywing"] === wings.counts["fx:fly"] * 2, wings.counts);

  // ══════════════════════════════════════════ 9. budgets unchanged from Phase F
  const budget = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, FSSim = FS.FSSim, FSMap = FS.FSMap, P = window.__P__;
    P.fresh({ size: "large", seed: 31337, ais: 3, speed: 0 });
    const G = FS.G;
    const castle = FSSim.castleOf(G, 0), used = [];
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
    for (let i = 0; i < 10; i++) R.frame(0.04);
    let fxMs = 0, worst = 0;
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      R.frame(0.04);
      worst = Math.max(worst, performance.now() - t0);
      fxMs = Math.max(fxMs, window.FSFX.info().ms);
    }
    const d = R.dynamicInfo();
    return { draws: R.stats().drawCalls, tris: R.stats().tris, fxMs: +fxMs.toFixed(2),
      serfPools: Object.keys(d.pools).filter((k) => k.indexOf("serf") === 0 || k.indexOf("knight") === 0).length,
      legPools: ["serfleg", "knightleg"].filter((k) => d.pools[k]).length,
      blds: Object.keys(G.buildings).length, worstFrame: +worst.toFixed(1) };
  });
  console.log("   dense town: draws=" + budget.draws + " tris=" + budget.tris + " fxMs=" + budget.fxMs + " worstFrame=" + budget.worstFrame + "ms");
  t.check("draw calls in a dense developed town stay under the Phase F budget", budget.draws < 900, budget);
  t.check("…and under the world suite's own 120 ceiling too", budget.draws < 120, budget);
  t.check("the whole workforce's legs cost exactly TWO extra draw calls",
    budget.legPools === 2, budget);
  t.check("FSFX stays inside its per-frame budget", budget.fxMs < 1.5 * 3, budget);

  // ══════════════════════════════════════════ 10. audio wiring (no misses/doubles)
  const audio = await page.evaluate(() => {
    const FS = window.__FS__, FSSim = FS.FSSim, P = window.__P__;
    const A = window.FSAudio;
    if (!A || !A._plays) return { ok: false };
    P.fresh({ seed: 4242, ais: 1, speed: 1, ff: 1200 });
    const G = FS.G;
    A.frame(0.04, G);                                   // sync the event watermark

    /* (a) EVERY event that maps to a cue must fire it exactly once. Walk the
     * settlement forward a tick at a time, counting the events the SIM emitted
     * on that tick and the cues fs-audio bumped for them — a miss or a double
     * shows up immediately as a mismatch. */
    const MAP = { treeFelled: "chop", stoneCut: "chip", bldDone: "chime", fightRound: "clang",
      bldCaptured: "sting", knightPromoted: "promote", mineExhausted: "notify" };
    const expect = {}, before = {};
    Object.keys(A._plays).forEach((k) => { before[k] = A._plays[k]; expect[k] = 0; });
    for (let i = 0; i < 400; i++) {
      FS.ff(1);
      const now = G.tick;
      for (let j = G.events.length - 1; j >= 0; j--) {
        const e = G.events[j];
        if (e.t < now) break;
        const cue = MAP[e.type];
        if (cue) expect[cue]++;
        if (e.type === "produced" && e.btype === "sawmill" && e.res === "plank") expect.saw++;
      }
      A.frame(0.04, G);
    }
    const got = {}, mismatch = [];
    Object.keys(MAP).forEach((k) => {
      const cue = MAP[k];
      got[cue] = A._plays[cue] - before[cue];
    });
    got.saw = A._plays.saw - before.saw;
    Object.keys(got).forEach((cue) => { if (got[cue] !== expect[cue]) mismatch.push(cue + " got " + got[cue] + " want " + expect[cue]); });
    const anyFired = Object.keys(got).some((c) => got[c] > 0);

    /* (b) a single injected event fires once and is never replayed */
    A.frame(0.04, G);
    FS.ff(1);
    let real = 0;
    for (let j = G.events.length - 1; j >= 0; j--) { const e = G.events[j]; if (e.t < G.tick) break; if (e.type === "treeFelled") real++; }
    const b2 = A._plays.chop;
    FSSim.event(G, "treeFelled", { v: FSSim.castleOf(G, 0).v });
    A.frame(0.04, G);
    const oneChop = A._plays.chop - b2 - real;
    A.frame(0.04, G); A.frame(0.04, G);
    const stillOne = A._plays.chop - b2 - real;

    /* (c) hammer taps only happen while a crew is on a site */
    const b3 = A._plays.hammer;
    let crewed = 0;
    for (const id in G.buildings) { const b = G.buildings[id]; if (b.state === "build" && b.crew) crewed++; }
    for (let i = 0; i < 40; i++) { FS.ff(1); A.frame(0.04, G); }
    const hammers = A._plays.hammer - b3;
    return { ok: true, expect, got, mismatch, anyFired, oneChop, stillOne, hammers, crewed };
  });
  t.check("a real settlement's events and its sound cues match one-for-one — no misses, no doubles",
    audio.ok && audio.mismatch.length === 0, audio);
  t.check("…and the window actually contained cues to match", audio.ok && audio.anyFired, audio);
  t.check("one injected sim event fires exactly one cue", audio.ok && audio.oneChop === 1, audio);
  t.check("…and is never replayed on later frames", audio.ok && audio.stillOne === 1, audio);
  t.check("hammer taps happen only while a crew is actually on a site",
    audio.ok && ((audio.crewed > 0 && audio.hammers > 0) || (audio.crewed === 0 && audio.hammers === 0)), audio);

  // ══════════════════════════════════════════ 11. the film-strip rig itself
  const OUT = path.join(H.ROOT, "shots", "filmstrips");
  let ranOk = true, err = "";
  try {
    execFileSync(process.execPath, [path.join(H.ROOT, "tools", "_fs_filmstrip.cjs"), "--tag", "suite", "serf-gait-closeup"],
      { cwd: H.ROOT, stdio: "pipe", timeout: 600000 });
  } catch (e) { ranOk = false; err = String((e && e.message) || e).slice(0, 200); }
  t.check("the film-strip rig runs clean end to end", ranOk, err);
  const strip = path.join(OUT, "suite_serf-gait-closeup.png");
  t.check("…and writes a contact sheet", fs.existsSync(strip), strip);
  if (fs.existsSync(strip)) {
    const img = sharp(strip);
    const meta = await img.metadata();
    const st = await img.stats();
    const spread = Math.max.apply(null, st.channels.map((c) => c.max - c.min));
    t.check("the contact sheet is a real multi-frame grid", meta.width >= 2000 && meta.height >= 800, meta);
    t.check("…and is not blank", spread > 60 && st.channels[1].mean > 20, { spread, mean: st.channels.map((c) => Math.round(c.mean)) });
  }
  const json = strip.replace(/\.png$/, ".json");
  if (fs.existsSync(json)) {
    const tel = JSON.parse(fs.readFileSync(json, "utf8"));
    t.check("the rig's own telemetry agrees with this suite (CV < 0.15, no jump)",
      tel.stats.stepCV < 0.15 && tel.stats.jumpRatio < 1.35 && tel.stats.nan === false, tel.stats);
    t.check("…over a full 24-frame sequence", tel.telemetry.length >= 24, tel.telemetry.length);
  } else t.check("the rig writes telemetry beside the sheet", false, json);

  // every strip the phase was judged on is on disk and readable
  const wanted = ["serf-walk-flat", "serf-gait-closeup", "duel", "chimney-smoke", "object-pop",
    "birds-butterflies", "burning-building", "serf-door", "knight-march", "water-shore"];
  let present = 0, blank = 0;
  for (const nm of wanted) {
    const fp = path.join(OUT, nm + ".png");
    if (!fs.existsSync(fp)) continue;
    present++;
    const st = await sharp(fp).stats();
    if (Math.max.apply(null, st.channels.map((c) => c.max - c.min)) < 40) blank++;
  }
  t.check("the reviewed film strips are all on disk", present === wanted.length, { present, want: wanted.length });
  t.check("…and none of them is blank", blank === 0, { blank });

  // ══════════════════════════════════════════ 12. no page errors
  t.check("0 page errors", t.errors.length === 0, t.errors.slice(0, 6));
});
