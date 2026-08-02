#!/usr/bin/env node
"use strict";
/**
 * FARMSTEAD — PHASE P film-strip rig.
 *
 * The point of this tool is that an animation cannot be judged from ONE frame.
 * It stages a subject deterministically through the __FS__ debug hook, then
 * steps the simulation and the renderer IN LOCKSTEP at sub-tick granularity
 * (dt ≈ 40 ms against a 100 ms tick, so ~2.5 render frames land inside every
 * sim tick — exactly where interpolation stutter, position pops and rotation
 * snaps hide), screenshots every one of those frames, and composes them into a
 * numbered contact sheet you can read as a SEQUENCE.
 *
 *   node tools/_fs_filmstrip.cjs             # every subject
 *   node tools/_fs_filmstrip.cjs serf-walk-flat duel
 *   node tools/_fs_filmstrip.cjs --list
 *   node tools/_fs_filmstrip.cjs --tag before serf-walk-flat
 *
 * Output: shots/filmstrips/<subject>.png  (+ <subject>.json telemetry)
 *
 * DETERMINISM
 *  - window.requestAnimationFrame is stubbed out BEFORE the page's own script
 *    runs, so farmstead.html's rAF loop never self-drives. Every sim step and
 *    every render frame in a strip is issued by this file, one at a time.
 *  - FSRender.setQuality(1) is forced, so what is judged is the shipped look,
 *    not the software-rasteriser thinning.
 *  - Fixed seeds, fixed camera per strip (a following camera would HIDE
 *    foot-slide, which is one of the things we are hunting).
 *
 * NOTHING in here mutates the simulation outside FSSim's own public/command
 * API — staging uses the same calls the suites already use.
 */
const path = require("path");
const fs = require("fs");
const sharp = require(path.join(__dirname, "node_modules", "sharp"));
const H = require("./_fs_harness.cjs");

const OUT_DIR = path.join(H.ROOT, "shots", "filmstrips");
const CELL_W = 420, CELL_H = 300;      // per-frame capture size
const COLS = 6;
const DT = 0.04;                       // 40 ms — 2.5 render frames per 100 ms tick

/* ══════════════════════════════════════════════════ in-page helper library ══
 * Installed once per page as window.__STRIP__. Everything staging needs lives
 * here so each subject's setup stays a few readable lines.
 */
function installHelpers() {
  const FS = window.__FS__, FSC = FS.FSC, FSSim = FS.FSSim, FSMap = FS.FSMap, R = FS.FSRender;
  const S = {};
  // the camera's own min-distance clamp is a PLAY constraint; a film strip has
  // to get closer than a player ever would to judge a gait honestly. DISTANCE
  // only, though: FORK B's yaw lock and pitch band are a RENDERING contract —
  // the cast is baked at one camera orientation, so a strip shot outside that
  // band would be judging a pose the game can never show. Each subject's `yaw`
  // and `pitch` are therefore requests that FSRender is free to overrule, and
  // does.
  FSC.CAM.DIST_MIN = 3;
  S.fresh = function (o) {
    o = o || {};
    FS.newGame({ size: o.size || "medium", seed: o.seed || 4242, ais: o.ais === undefined ? 1 : o.ais, speed: 1 });
    R.setQuality(1);
    if (o.ff) FS.ff(o.ff);
    return FS.G;
  };
  /** every spot dMin..dMax from `from` that `type` will sit on (ownership lent
   *  while the terrain rules are checked — mirrors the military suite's helper) */
  S.spotsNear = function (type, from, dMin, dMax, p, skip) {
    const G = FS.G, map = G.map, out = [];
    FSMap.forRadius(map, from, dMax, (u, d) => {
      if (d < dMin) return;
      if (skip && skip.some((w) => FSMap.dist(map, w, u) < 3)) return;
      const own = map.owner[u], ring = [];
      FSMap.forRadius(map, u, 2, (w) => { ring.push([w, map.owner[w]]); map.owner[w] = p || 0; });
      const ok = FSMap.canPlaceBuilding(map, type, u, p || 0);
      for (let i = 0; i < ring.length; i++) map.owner[ring[i][0]] = ring[i][1];
      map.owner[u] = own;
      if (ok) out.push([u, d]);
    });
    out.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    return out.map((e) => e[0]);
  };
  /** drop a building of any player onto the map (lends the ground, like the suites) */
  S.plantAt = function (type, v, p, opts) {
    opts = opts || {};
    const G = FS.G, map = G.map, grant = [];
    FSMap.forRadius(map, v, 2, (u) => { grant.push([u, map.owner[u]]); map.owner[u] = p || 0; });
    const r = FSSim.build(G, type, v, p || 0);
    if (!r.ok) { for (let i = 0; i < grant.length; i++) map.owner[grant[i][0]] = grant[i][1]; return null; }
    const b = G.buildings[r.id];
    if (opts.done !== false) { FSSim.forceComplete(G, b.id); b.working = !!opts.working; }
    return b;
  };
  /** place a building near a vertex, optionally finished + running */
  S.plant = function (type, nearV, opts) {
    opts = opts || {};
    const list = S.spotsNear(type, nearV, opts.min === undefined ? 2 : opts.min, opts.r || 14, opts.p || 0, opts.skip);
    for (let i = 0; i < list.length && i < (opts.tries || 10); i++) {
      const b = S.plantAt(type, list[i], opts.p || 0, opts);
      if (b && b.state !== "burn" && b.p === (opts.p || 0)) return b;
    }
    return null;
  };
  S.garrison = function (b, ranks) { b.mil.knights = ranks.slice(); FS.FSMil.onGarrisonChange(FS.G, b); return b; };
  /** join a vertex to a player's road network the way a player would (mirrors
   *  the military suite's T.connect) — needed to plant a mountain flag a
   *  geologist can actually be sent to. */
  S.onNetwork = function (v, p) {
    const fid = FS.G.map.flagAt[v];
    if (!fid) return false;
    const cf = FSSim.castleOf(FS.G, p || 0).flag;
    return fid === cf || FSSim.hops(FS.G, fid, cf) >= 0;
  };
  S.connect = function (toV, p) {
    p = p || 0;
    const G = FS.G;
    if (S.onNetwork(toV, p)) return true;
    const cf = FSSim.castleOf(G, p).flag, cands = [];
    for (const id in G.flags) {
      const f = G.flags[id];
      if (f.p !== p || f.roads.length >= 6 || f.v === toV) continue;
      if (f.id !== cf && FSSim.hops(G, f.id, cf) < 0) continue;
      cands.push([f, FSMap.dist(G.map, f.v, toV)]);
    }
    cands.sort((a, b) => (a[1] - b[1]) || (a[0].id - b[0].id));
    for (let c = 0; c < cands.length && c < 8; c++) {
      const from = cands[c][0];
      const path = FSSim.roadPath(G, from.v, toV, p, { maxLen: 400, maxNodes: 60000 });
      if (!path) continue;
      const STEP = 8, LAST = path.length - 3;
      let cur = from, curIdx = 0, ok = true;
      for (let i = STEP; i <= LAST; i += STEP) {
        let j = i;
        while (j <= LAST && FSMap.whyFlag(G.map, path[j], p)) j++;
        if (j > LAST) break;
        const nf = FSSim.placeFlag(G, path[j], p);
        if (!nf.ok) { ok = false; break; }
        const r = FSSim.buildRoad(G, cur.id, nf.id, path.slice(curIdx, j + 1), p);
        if (!r.ok) { FSSim.removeFlag(G, nf.id); ok = false; break; }
        cur = nf.flag; curIdx = j; i = j;
      }
      if (!ok) continue;
      let fid = G.map.flagAt[toV];
      if (!fid) { const nf = FSSim.placeFlag(G, toV, p); if (!nf.ok) continue; fid = nf.id; }
      if (FSSim.buildRoad(G, cur.id, fid, path.slice(curIdx), p).ok) return true;
    }
    return false;
  };
  /** first serf matching a predicate */
  S.findSerf = function (pred) {
    const G = FS.G;
    for (const id in G.serfs) { const s = G.serfs[id]; if (pred(s, G)) return s; }
    return null;
  };
  S.findBld = function (pred) {
    const G = FS.G;
    for (const id in G.buildings) { const b = G.buildings[id]; if (pred(b, G)) return b; }
    return null;
  };
  /** run the sim until pred() or n ticks pass; returns ticks spent (-1 = never) */
  S.until = function (pred, n) {
    for (let i = 0; i < (n || 4000); i++) {
      if (pred(FS.G)) return i;
      FS.ff(1);
    }
    return pred(FS.G) ? (n || 4000) : -1;
  };
  S.worldOf = function (v) {
    const xz = [0, 0];
    FSMap.worldXZ(FS.G.map, v, xz);
    return { x: xz[0], y: FS.G.map.height[v], z: xz[1] };
  };
  /** frame the camera on a world point */
  S.look = function (pt, o) {
    o = o || {};
    R.setCam({ tx: pt.x, tz: pt.z, ty: pt.y, dist: o.dist || 11, pitch: o.pitch || 0.62, yaw: o.yaw === undefined ? 0.7 : o.yaw });
    return R.camState();
  };
  S.lookV = function (v, o) { return S.look(S.worldOf(v), o); };
  /** midpoint of a serf's current edge — the natural centre of a walk strip */
  S.serfMid = function (s) {
    const a = S.worldOf(s.from), b = S.worldOf(s.to);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  };
  /** hide every bit of HUD so a strip is pure 3D */
  S.hideHud = function () {
    ["dbg", "speedTag", "bhint", "bmode", "fsui-root", "netChip", "fsTouchCtx"].forEach((id) => {
      const e = document.getElementById(id);
      if (e) e.style.display = "none";
    });
    const t = document.getElementById("title");
    if (t) t.classList.add("hidden");
  };
  /** one lockstep beat: sim accumulator + one render frame */
  S.beat = function (dt) {
    FS.step(dt);
    R.frame(dt);
    return FS.G.tick;
  };
  /** telemetry sampler — what to measure while a strip rolls */
  S.sample = function (track) {
    const G = FS.G, out = { tick: G.tick };
    if (!track) return out;
    if (track.serf) {
      const p = R.serfPose(track.serf);
      if (p) { out.x = p.x; out.y = p.y; out.z = p.z; out.yaw = p.yaw; out.frac = p.frac; out.from = p.from; out.to = p.to; }
      const s = G.serfs[track.serf];
      out.alive = !!s;
      if (s) { out.state = s.state; out.carry = s.carry || null; out.simFrom = s.from; out.simTo = s.to; }
    }
    if (track.bld) {
      const b = G.buildings[track.bld];
      out.bstate = b ? b.state : "gone";
      out.working = b ? !!b.working : false;
      out.prog = b && b.build ? b.build.progress : 0;
      const mi = R.machineInfo ? R.machineInfo(track.bld) : null;
      if (mi) { out.spin = mi.spin; out.busyF = mi.busyF; }
    }
    if (track.vertex !== undefined) out.obj = G.map.obj[track.vertex];
    const d = R.dynamicInfo();
    out.pools = {};
    (track.pools || []).forEach((k) => { out.pools[k] = d.pools[k] ? d.pools[k].count : 0; });
    out.draws = R.stats().drawCalls;
    if (window.FSFX) { const f = window.FSFX.info(); out.fx = { fish: f.fish, birds: f.birds, flies: f.flies, leaves: f.leaves, dust: f.dust, rings: f.rings }; }
    if (window.FSAudio && window.FSAudio._plays) out.plays = Object.assign({}, window.FSAudio._plays);
    if (R.animInfo) out.anim = R.animInfo();
    return out;
  };
  window.__STRIP__ = S;
  return true;
}

/* ═══════════════════════════════════════════════════════ subject registry ══
 * Each subject: { note, frames?, dt?, cam?, setup(page-fn) → { track, ... } }
 * setup runs in the page and returns the tracking descriptor.
 */
const SUBJECTS = {
  /* ───────────────────────────────────────────── people: walking + carrying */
  "serf-walk-flat": {
    note: "carrier walking a flat road — foot slide, per-frame delta evenness",
    frames: 30,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__;
      S.fresh({ seed: 4242, ff: 2600 });
      let best = null, bestD = 9;
      for (const id in FS.G.serfs) {
        const s = FS.G.serfs[id];
        if (s.state === "work" || s.state === "garrison" || s.from === s.to) continue;
        const d = Math.abs(FS.G.map.height[s.from] - FS.G.map.height[s.to]);
        if (d < bestD) { bestD = d; best = s; }
      }
      if (!best) return null;
      S.look(S.serfMid(best), { dist: 4.4, pitch: 0.34 });
      return { track: { serf: best.id, pools: ["serf:transporter:0", "crate", "shadowDyn"] }, label: "flat " + best.job };
    },
  },
  "serf-gait-closeup": {
    note: "gait close-up — legs, stride length, foot slide against the ground",
    frames: 24,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__;
      S.fresh({ seed: 4242, ff: 2600 });
      let best = null, bestD = 9;
      for (const id in FS.G.serfs) {
        const s = FS.G.serfs[id];
        if (s.state === "work" || s.state === "garrison" || s.from === s.to) continue;
        const d = Math.abs(FS.G.map.height[s.from] - FS.G.map.height[s.to]);
        if (d < bestD) { bestD = d; best = s; }
      }
      if (!best) return null;
      S.look(S.serfMid(best), { dist: 2.0, pitch: 0.24, yaw: 2.2 });
      return { track: { serf: best.id, pools: ["serfleg"] }, label: "gait close-up" };
    },
  },
  "serf-walk-slope": {
    note: "walking the steepest edge in the settlement — uphill/downhill posture",
    frames: 30,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__;
      S.fresh({ seed: 4242, ff: 2600 });
      let best = null, bestD = -1;
      for (const id in FS.G.serfs) {
        const s = FS.G.serfs[id];
        if (s.state === "work" || s.state === "garrison" || s.from === s.to) continue;
        const d = Math.abs(FS.G.map.height[s.from] - FS.G.map.height[s.to]);
        if (d > bestD) { bestD = d; best = s; }
      }
      if (!best) return null;
      S.look(S.serfMid(best), { dist: 4.6, pitch: 0.30 });
      return { track: { serf: best.id }, label: "slope dy=" + bestD.toFixed(2) };
    },
  },
  "carrier-goods": {
    note: "a loaded carrier — does the crate ride the bob or float?",
    frames: 26,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__;
      S.fresh({ seed: 777, ff: 3200 });
      const s = S.findSerf((x) => x.carry && x.from !== x.to);
      if (!s) return null;
      S.look(S.serfMid(s), { dist: 3.8, pitch: 0.30 });
      return { track: { serf: s.id, pools: ["crate"] }, label: "carrying " + s.carry };
    },
  },
  "serf-turn-bend": {
    note: "direction change at a bend — must TURN, never flip",
    frames: 30,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__;
      S.fresh({ seed: 4242, ff: 2600 });
      // the serf whose NEXT step turns hardest — that is where a flip would show
      let best = null, bestTurn = -1;
      for (const id in FS.G.serfs) {
        const s = FS.G.serfs[id];
        if (s.from === s.to || !s.path || s.path.length < 2) continue;
        const a = S.worldOf(s.from), b = S.worldOf(s.to), c = S.worldOf(s.path[1]);
        const y1 = Math.atan2(b.x - a.x, b.z - a.z), y2 = Math.atan2(c.x - b.x, c.z - b.z);
        let d = Math.abs(y2 - y1); if (d > Math.PI) d = Math.PI * 2 - d;
        if (d > bestTurn) { bestTurn = d; best = s; }
      }
      if (!best) return null;
      S.look(S.worldOf(best.to), { dist: 5.2, pitch: 0.62 });
      return { track: { serf: best.id }, label: "bend turn " + (bestTurn * 57.3).toFixed(0) + "°" };
    },
  },
  "flag-handoff": {
    note: "goods dropped at / picked from a flag — the from/to/frac seam",
    frames: 30,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__;
      S.fresh({ seed: 4242, ff: 3000 });
      let best = null, n = -1;
      for (const id in FS.G.flags) {
        const f = FS.G.flags[id];
        if (f.slots.length > n) { n = f.slots.length; best = f; }
      }
      if (!best) return null;
      S.lookV(best.v, { dist: 4.6, pitch: 0.40 });
      return { track: { pools: ["crate", "pole", "pennant"] }, label: "flag " + best.id + " (" + n + " goods)" };
    },
  },

  /* ───────────────────────────────────────────────────── work animations */
  "lumberjack-chop": {
    note: "full chop cycle: swing → tree falls → stump appears",
    frames: 30, tickPerFrame: 2,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__;
      S.fresh({ seed: 4242, ff: 2200 });
      let target = null;
      S.until((G) => {
        for (const id in G.serfs) { const x = G.serfs[id]; if (x.job === "lumberjack" && x.state === "doWork") { target = x; return true; } }
        return false;
      }, 5000);
      if (!target) return null;
      // look from the OPEN side: the tree he is chopping is at s.workV, so put
      // the camera opposite it or he is filmed through a canopy
      const P = S.worldOf(target.v);
      const T = S.worldOf(target.workV >= 0 ? target.workV : target.v);
      const yaw = Math.atan2(P.x - T.x, P.z - T.z) + 1.1;
      S.look(P, { dist: 3.0, pitch: 0.26, yaw: yaw });
      return { track: { serf: target.id, vertex: target.workV >= 0 ? target.workV : target.v, pools: ["serf:lumberjack:0"] },
        label: "chop @v" + target.v };
    },
  },
  "sawmill-working": {
    note: "saw blade spin + chimney smoke continuity over a full second",
    frames: 26,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSSim = FS.FSSim;
      const G = S.fresh({ seed: 4242, ff: 900 });
      const castle = FSSim.castleOf(G, 0);
      const b = S.plant("sawmill", castle.v, { r: 12, working: true });
      if (!b) return null;
      S.lookV(b.v, { dist: 6.5, pitch: 0.42 });
      return { track: { bld: b.id, pools: ["smoke"] }, label: "sawmill working" };
    },
  },
  "chimney-smoke": {
    note: "chimney column: puffs born, swelling, drifting, dying — then work STOPS at frame 16",
    frames: 30,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSSim = FS.FSSim;
      const G = S.fresh({ seed: 12345, ff: 900 });
      const castle = FSSim.castleOf(G, 0);
      const b = S.plant("bakery", castle.v, { r: 14, working: true });
      if (!b) return null;
      S.lookV(b.v, { dist: 9.5, pitch: 0.24 });
      for (let i = 0; i < 90; i++) FS.FSRender.frame(0.04);      // let the column establish
      return { track: { bld: b.id, pools: ["smoke"] }, label: "bakery: column → stop @frame 16",
        atFrame: { 16: "FS.G.buildings[" + b.id + "].working = false;" } };
    },
  },
  "mill-and-smoke": {
    note: "mill sails + smoke; the working flag DROPS at frame 15 — spin-down?",
    frames: 30,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSSim = FS.FSSim;
      const G = S.fresh({ seed: 4242, ff: 900 });
      const castle = FSSim.castleOf(G, 0);
      const b = S.plant("mill", castle.v, { r: 16, working: true });
      if (!b) return null;
      S.lookV(b.v, { dist: 7.5, pitch: 0.42 });
      return { track: { bld: b.id, pools: ["smoke"] }, label: "mill: working → idle @frame 15",
        atFrame: { 15: "FS.G.buildings[" + b.id + "].working = false;" } };
    },
  },
  "farmer-field": {
    note: "farm quarter: the four field stages + the standing-crop ripple",
    frames: 26,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSC = FS.FSC, FSSim = FS.FSSim, FSMap = FS.FSMap;
      const G = S.fresh({ seed: 909, ff: 900 });
      const castle = FSSim.castleOf(G, 0);
      const b = S.plant("farm", castle.v, { r: 16, working: true });
      if (!b) return null;
      // A real farm takes many thousands of ticks to sow its first field; the
      // subject under test is the CROP LAYER, so the four stages are staged
      // straight onto the map (the world suite drives refreshVertex the same
      // way) and then filmed live.
      let n = 0;
      FSMap.forRadius(G.map, b.v, 4, (v, d) => {
        if (d < 1 || n >= 16) return;
        if (G.map.terr[v] !== FSC.TERR.GRASS || G.map.obj[v] || G.map.flagAt[v] || G.map.bldAt[v]) return;
        G.map.obj[v] = FSC.OBJ.FIELD1 + (n % 4);
        FS.FSRender.refreshVertex(v);
        n++;
      });
      S.lookV(b.v, { dist: 8, pitch: 0.38 });
      for (let i = 0; i < 20; i++) FS.FSRender.frame(0.04);
      return { track: { bld: b.id, pools: ["wheat"] }, label: "fields " + n + " (stages 1-4)" };
    },
  },
  "fisher-cast": {
    note: "fisher at the waterline + fish jumping",
    frames: 28, tickPerFrame: 2,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSC = FS.FSC, FSSim = FS.FSSim, FSMap = FS.FSMap;
      const G = S.fresh({ seed: 12345, ff: 600 });
      const castle = FSSim.castleOf(G, 0);
      let shore = -1;
      const list = S.spotsNear("fisher", castle.v, 3, 28, 0);
      for (let i = 0; i < list.length && shore < 0; i++) {
        let water = 0;
        FSMap.forRadius(G.map, list[i], 3, (u) => { if (G.map.terr[u] === FSC.TERR.WATER) water++; });
        if (water > 4) shore = list[i];
      }
      if (shore < 0) return null;
      const b = S.plantAt("fisher", shore, 0, { working: true });
      if (!b) return null;
      S.until((g) => { for (const id in g.serfs) { const s = g.serfs[id]; if (s.job === "fisher" && s.state !== "work") return true; } return false; }, 3000);
      const f = S.findSerf((s) => s.job === "fisher");
      S.lookV(f && f.v >= 0 ? f.v : shore, { dist: 7, pitch: 0.30 });
      let wv = -1;
      FSMap.forRadius(G.map, shore, 5, (u) => { if (wv < 0 && G.map.terr[u] === FSC.TERR.WATER) wv = u; });
      if (wv >= 0 && window.FSFX) for (let i = 0; i < 3; i++) window.FSFX.spawnFish(wv);
      return { track: { serf: f ? f.id : 0, bld: b.id }, label: "fisher + fish" };
    },
  },
  "builder-hammer": {
    note: "construction site: builders hammering, scaffold growing",
    frames: 28,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__;
      S.fresh({ seed: 4242, ff: 1800 });
      // a REAL site the settlement is genuinely working on — one planted by
      // hand never gets its planks delivered inside a strip's worth of ticks
      const got = S.until((g) => { for (const id in g.buildings) { const b = g.buildings[id]; if (b.state === "build" && b.crew) return true; } return false; }, 5000);
      const b = S.findBld((x) => x.state === "build" && x.crew) || S.findBld((x) => x.state === "build" || x.state === "site");
      if (!b) return null;
      // film the WORKMAN, not the scaffold — he is the animation under test
      const w = S.findSerf((x) => x.state === "hammer" && x.target === b.id);
      const P = S.worldOf(w ? w.v : b.v);
      const fl = FS.G.flags[b.flag], F = fl ? S.worldOf(fl.v) : P;
      const yaw = Math.atan2(F.x - P.x, F.z - P.z);
      S.look({ x: P.x, y: P.y, z: P.z }, { dist: 2.6, pitch: 0.22, yaw: yaw });
      return { track: { serf: w ? w.id : 0, bld: b.id },
        label: (got >= 0 ? "crewed site" : "site") + (w ? " — builder" : "") };
    },
  },
  "construction-stages": {
    note: "site → stakes → frame → finished, sampled across a whole real build",
    frames: 24, tickPerFrame: 45,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__;
      S.fresh({ seed: 4242, ff: 1500 });
      S.until((g) => { for (const id in g.buildings) { const b = g.buildings[id]; if (b.state === "build") return true; } return false; }, 5000);
      const b = S.findBld((x) => x.state === "build") || S.findBld((x) => x.state === "site");
      if (!b) return null;
      S.lookV(b.v, { dist: 6.0, pitch: 0.34 });
      return { track: { bld: b.id }, label: "build stages (" + b.type + ")" };
    },
  },
  "digger-level": {
    note: "digger flattening ground — terrain + everything standing on it",
    frames: 26, tickPerFrame: 5,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSSim = FS.FSSim;
      const G = S.fresh({ seed: 31337, ff: 1400 });
      const castle = FSSim.castleOf(G, 0);
      const b = S.plant("stock", castle.v, { r: 12, done: false });
      if (!b) return null;
      S.until((g) => { for (const id in g.serfs) if (g.serfs[id].job === "digger") return true; return false; }, 5000);
      const d = S.findSerf((s) => s.job === "digger");
      S.lookV(d && d.v >= 0 ? d.v : b.v, { dist: 6.5, pitch: 0.34 });
      return { track: { serf: d ? d.id : 0, bld: b.id }, label: d ? "digger" : "site levelling" };
    },
  },
  "geologist-sign": {
    note: "geologist hammering the rock, then his sign appearing",
    frames: 28, tickPerFrame: 4,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSC = FS.FSC, FSSim = FS.FSSim, FSMap = FS.FSMap;
      const G = S.fresh({ seed: 31337, ff: 1600 });
      const castle = FSSim.castleOf(G, 0);
      // a geologist needs a MOUNTAIN flag on the network, and a hammer in store
      castle.inv.hammer = (castle.inv.hammer || 0) + 3;
      let fv = -1;
      FSMap.forRadius(G.map, castle.v, 20, (u, d) => {
        if (fv >= 0 || d < 3) return;
        if (G.map.terr[u] !== FSC.TERR.MOUNTAIN || FSMap.whyFlag(G.map, u, 0)) return;
        if (!S.connect(u, 0)) return;
        fv = u;
      });
      if (fv < 0) return null;
      const r = FSSim.sendGeologist(G, G.map.flagAt[fv], 0);
      if (!r.ok) return null;
      const got = S.until((g) => { for (const id in g.serfs) { const s = g.serfs[id]; if (s.job === "geologist" && s.state === "geoWork") return true; } return false; }, 9000);
      const geo = S.findSerf((s) => s.job === "geologist");
      if (!geo) return null;
      S.lookV(geo.v, { dist: 5.5, pitch: 0.30 });
      return { track: { serf: geo.id, vertex: geo.v, pools: ["signpost", "signboard"] },
        label: got >= 0 ? "geologist surveying" : "geologist en route" };
    },
  },
  "serf-door": {
    note: "serf walking into / out of a building door (does he pop?)",
    frames: 30, tickPerFrame: 2,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__;
      const G = S.fresh({ seed: 4242, ff: 2600 });
      const b = S.findBld((x) => x.state === "done" && x.type !== "castle");
      if (!b) return null;
      S.lookV(b.v, { dist: 5.5, pitch: 0.34 });
      return { track: { bld: b.id, pools: ["serf:lumberjack:0", "serf:transporter:0", "serf:forester:0"] }, label: "door " + b.type };
    },
  },

  /* ────────────────────────────────────────────────────────────── military */
  duel: {
    note: "several duel rounds — lunge/recover, clang flash, death fall",
    frames: 30, tickPerFrame: 3,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSC = FS.FSC, FSSim = FS.FSSim, FSMil = FS.FSMil;
      const G = S.fresh({ size: "medium", seed: 909, ais: 1, ff: 400 });
      const castle = FSSim.castleOf(G, 0);
      const mineV = S.spotsNear("hut", castle.v, 8, 12, 0)[0];
      if (mineV === undefined) return null;
      const ours = S.plantAt("hut", mineV, 0);
      if (!ours) return null;
      const theirV = S.spotsNear("hut", mineV, 5, FSC.ATTACK_RANGE - 4, 1, [mineV])[0];
      if (theirV === undefined) return null;
      const foe = S.plantAt("hut", theirV, 1);
      if (!foe) return null;
      S.garrison(ours, [4, 4, 4, 4]);
      S.garrison(foe, [2, 2]);
      FSMil.attack(G, foe.id, 3, 0, true);
      const got = S.until((g) => !!(g.buildings[foe.id] && g.buildings[foe.id].mil && g.buildings[foe.id].mil.fight), 4000);
      if (got < 0) return null;
      const f = G.buildings[foe.id].mil.fight;
      // frame the PAIR, not the building — a duel happens at the door flag
      const A = S.worldOf((G.serfs[f.att] || {}).v === undefined ? foe.v : G.serfs[f.att].v);
      const B = S.worldOf((G.serfs[f.def] || {}).v === undefined ? foe.v : G.serfs[f.def].v);
      S.look({ x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, z: (A.z + B.z) / 2 }, { dist: 3.6, pitch: 0.26 });
      return { track: { serf: f.att, bld: foe.id, pools: ["clang", "corpse", "knight:4:0", "knight:2:1"] }, label: "duel at a hut" };
    },
  },
  "knight-march": {
    note: "knights marching offroad to an attack — spacing, footing, facing",
    frames: 30,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSC = FS.FSC, FSSim = FS.FSSim, FSMil = FS.FSMil;
      const G = S.fresh({ size: "medium", seed: 909, ais: 1, ff: 400 });
      const castle = FSSim.castleOf(G, 0);
      const mineV = S.spotsNear("hut", castle.v, 8, 12, 0)[0];
      if (mineV === undefined) return null;
      const ours = S.plantAt("hut", mineV, 0);
      if (!ours) return null;
      const theirV = S.spotsNear("hut", mineV, 8, FSC.ATTACK_RANGE - 2, 1, [mineV])[0];
      if (theirV === undefined) return null;
      const foe = S.plantAt("hut", theirV, 1);
      if (!foe) return null;
      S.garrison(ours, [3, 3, 3, 3]);
      S.garrison(foe, [1]);
      FSMil.attack(G, foe.id, 3, 0, true);
      S.until((g) => { for (const id in g.serfs) { const s = g.serfs[id]; if (s.job === "knight" && s.from !== s.to) return true; } return false; }, 800);
      const k = S.findSerf((s) => s.job === "knight" && s.from !== s.to);
      if (!k) return null;
      S.look(S.serfMid(k), { dist: 6.0, pitch: 0.34 });
      return { track: { serf: k.id, pools: ["knight:3:0"] }, label: "knight march" };
    },
  },
  "burning-building": {
    note: "fire + smoke over a burning building, through to collapse",
    frames: 30, tickPerFrame: 4,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSSim = FS.FSSim;
      const G = S.fresh({ seed: 4242, ff: 2600 });
      const b = S.findBld((x) => x.state === "done" && x.type !== "castle");
      if (!b) return null;
      FSSim.burnBuilding(G, b);
      S.lookV(b.v, { dist: 9, pitch: 0.24 });
      return { track: { bld: b.id, pools: ["flame", "smoke"] }, label: "burning " + b.type };
    },
  },
  "territory-stakes": {
    note: "frontier posts as the border moves (military building completes)",
    frames: 24, tickPerFrame: 8,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSSim = FS.FSSim;
      const G = S.fresh({ seed: 4242, ff: 1400 });
      const castle = FSSim.castleOf(G, 0);
      const b = S.plant("hut", castle.v, { r: 18, min: 9, done: false });
      if (!b) return null;
      S.lookV(b.v, { dist: 16, pitch: 0.62 });
      return { track: { bld: b.id, pools: ["stake"] }, label: "border grows @frame 8",
        atFrame: { 8: "FS.FSSim.forceComplete(FS.G, " + b.id + ");" } };
    },
  },

  /* ──────────────────────────────────────────────────── world + ambience */
  "boat-ferry": {
    note: "a sailor ferrying across water — hull bob, heel, wake",
    frames: 28,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSC = FS.FSC, FSSim = FS.FSSim, FSMap = FS.FSMap;
      // seed 2024's coastline has genuinely crossable channels
      const G = S.fresh({ seed: 2024, ff: 1800 });
      const map = G.map;
      const castle = FSSim.castleOf(G, 0);
      castle.inv.boat = (castle.inv.boat || 0) + 3;      // skip the boatwright chain
      const shore = [];
      for (let v = 0; v < map.W * map.H; v++) {
        if (map.terr[v] === FSC.TERR.WATER || FSMap.whyFlag(map, v, 0)) continue;
        for (let d = 0; d < 6; d++) {
          const u = FSMap.nbr(map, v, d);
          if (u >= 0 && map.terr[u] === FSC.TERR.WATER) { shore.push(v); break; }
        }
      }
      const pairs = [];
      for (let i = 0; i < shore.length; i++) {
        for (let j = i + 1; j < shore.length; j++) {
          const d = FSMap.dist(map, shore[i], shore[j]);
          if (d < 3 || d > 9) continue;
          const p = FSSim.roadPath(G, shore[i], shore[j], 0, { water: true, maxLen: 80 });
          if (!p) continue;
          let w = 0;
          for (const v of p) if (map.terr[v] === FSC.TERR.WATER) w++;
          if (w >= 2) pairs.push([shore[i], shore[j], p]);
        }
      }
      let road = null;
      for (let k = 0; k < pairs.length && !road && k < 12; k++) {
        const A = pairs[k][0], B = pairs[k][1], path = pairs[k][2];
        if (!S.connect(A, 0)) continue;
        const fb = map.flagAt[B] ? { ok: true, id: map.flagAt[B] } : FSSim.placeFlag(G, B, 0);
        if (!fb.ok) continue;
        const r = FSSim.buildRoad(G, map.flagAt[A], fb.id, path, 0, {});
        if (r.ok) road = G.roads[r.id];
      }
      if (!road) return null;
      // wait for the SAILOR, not just the boat — the crew is requested a good
      // while after the hull is delivered
      S.until(() => !!S.findSerf((x) => x.job === "sailor"), 14000);
      const sailor = S.findSerf((x) => x.job === "sailor");
      if (!sailor) return null;
      S.until((g) => { const x = g.serfs[sailor.id]; return !!(x && x.from !== x.to && (g.map.terr[x.from] === FSC.TERR.WATER || g.map.terr[x.to] === FSC.TERR.WATER)); }, 4000);
      S.look(S.serfMid(FS.G.serfs[sailor.id] || sailor), { dist: 5.0, pitch: 0.24 });
      return { track: { serf: sailor.id, pools: ["boat", "wake"] }, label: "ferry on a water road" };
    },
  },
  "water-shore": {
    note: "water surface, foam, glints and the shoreline over a full second",
    frames: 26,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSC = FS.FSC, FSMap = FS.FSMap, FSSim = FS.FSSim;
      const G = S.fresh({ seed: 12345, ff: 300 });
      const castle = FSSim.castleOf(G, 0);
      let w = -1;
      FSMap.forRadius(G.map, castle.v, 34, (v) => { if (w < 0 && G.map.terr[v] === FSC.TERR.WATER) w = v; });
      if (w < 0) return null;
      S.lookV(w, { dist: 20, pitch: 0.42 });
      for (let i = 0; i < 4; i++) if (window.FSFX) window.FSFX.spawnFish(w);
      return { track: { pools: [] }, label: "water + fish" };
    },
  },
  "birds-butterflies": {
    note: "flying life close up — wings must HINGE, not squash",
    frames: 26,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSC = FS.FSC, FSSim = FS.FSSim, FSMap = FS.FSMap;
      // bring the flock down to eye level so a wing beat can actually be judged
      // (VIS is a look table owned by the render/FX layer — strip-only tweak)
      FSC.VIS.BIRD_Y = 0.7; FSC.VIS.BIRD_R = 2.4; FSC.VIS.BIRD_SPD = 0.9;
      FSC.VIS.BFLY_R = 3.5; FSC.VIS.BFLY_MAX = 14;
      const G = S.fresh({ seed: 4242, ff: 900 });
      const castle = FSSim.castleOf(G, 0);
      let grass = -1;
      FSMap.forRadius(G.map, castle.v, 10, (v, d) => {
        if (grass >= 0 || d < 4) return;
        if (G.map.terr[v] === FSC.TERR.GRASS && !G.map.obj[v] && !G.map.bldAt[v]) grass = v;
      });
      S.lookV(grass >= 0 ? grass : castle.v, { dist: 4.5, pitch: 0.30 });
      if (window.FSFX) window.FSFX.dispose();
      for (let i = 0; i < 500; i++) FS.FSRender.frame(0.05);   // seed birds + butterflies
      return { track: { pools: [] }, label: "birds + butterflies (low pass)" };
    },
  },
  "pennant-wave": {
    note: "flag pennants + goods stacks in a busy junction",
    frames: 24,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__;
      const G = S.fresh({ seed: 4242, ff: 3200 });
      let best = null, n = -1;
      for (const id in G.flags) { const f = G.flags[id]; if (f.slots.length > n) { n = f.slots.length; best = f; } }
      if (!best) return null;
      S.lookV(best.v, { dist: 3.6, pitch: 0.32 });
      return { track: { pools: ["pennant", "crate"] }, label: "pennants" };
    },
  },
  "object-pop": {
    note: "refreshVertex object swaps — a tree felled, a stump replacing it",
    frames: 24,
    setup: () => {
      const S = window.__STRIP__, FS = window.__FS__, FSC = FS.FSC, FSMap = FS.FSMap, FSSim = FS.FSSim;
      const G = S.fresh({ seed: 4242, ff: 1200 });
      const castle = FSSim.castleOf(G, 0);
      let tree = -1;
      FSMap.forRadius(G.map, castle.v, 12, (v, d) => {
        if (tree >= 0 || d < 4) return;
        const o = G.map.obj[v];
        if (o >= FSC.OBJ.TREE1 && o <= FSC.OBJ.TREE4) tree = v;
      });
      if (tree < 0) return null;
      S.lookV(tree, { dist: 5.0, pitch: 0.34 });
      return { track: { vertex: tree }, label: "tree → stump @frame 8",
        atFrame: { 8: "FS.G.map.obj[" + tree + "] = FS.FSC.OBJ.STUMP; FS.FSRender.refreshVertex(" + tree + ");" } };
    },
  },
};

/* ══════════════════════════════════════════════════════════════ compositor ══ */
function labelSvg(text, w, h, size, color, weight) {
  const esc = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<text x="6" y="${size}" font-family="monospace" font-size="${size}" font-weight="${weight || 700}" ` +
    `fill="${color || "#ffffff"}" stroke="#000000" stroke-width="3" paint-order="stroke" ` +
    `stroke-linejoin="round">${esc}</text></svg>`
  );
}

async function compose(name, frames, header, footer) {
  const rows = Math.ceil(frames.length / COLS);
  const HEAD = 34, FOOT = 24;
  const W = COLS * CELL_W, HGT = HEAD + rows * CELL_H + FOOT;
  const base = sharp({ create: { width: W, height: HGT, channels: 3, background: { r: 14, g: 18, b: 26 } } });
  const layers = [];
  layers.push({ input: labelSvg(header, W, HEAD, 20, "#ffe6a0"), top: 4, left: 4 });
  for (let i = 0; i < frames.length; i++) {
    const cx = (i % COLS) * CELL_W, cy = HEAD + Math.floor(i / COLS) * CELL_H;
    layers.push({ input: frames[i], top: cy, left: cx });
    layers.push({ input: labelSvg(String(i + 1).padStart(2, "0"), 60, 26, 20, "#ffffff"), top: cy + 2, left: cx + 2 });
  }
  layers.push({ input: labelSvg(footer, W, FOOT, 15, "#9fd0ff"), top: HEAD + rows * CELL_H + 3, left: 4 });
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const fp = path.join(OUT_DIR, name + ".png");
  await base.composite(layers).png({ compressionLevel: 8 }).toFile(fp);
  return fp;
}

/* ════════════════════════════════════════════════════════════════ analysis ══ */
function analyse(tel) {
  const out = { frames: tel.length };
  const moved = tel.filter((t) => t.x !== undefined);
  if (moved.length > 3) {
    const d = [];
    for (let i = 1; i < moved.length; i++) {
      const a = moved[i - 1], b = moved[i];
      d.push(Math.hypot(b.x - a.x, b.z - a.z));
    }
    const nz = d.filter((v) => v > 1e-6);
    const mean = nz.length ? nz.reduce((s, v) => s + v, 0) / nz.length : 0;
    const sd = nz.length ? Math.sqrt(nz.reduce((s, v) => s + (v - mean) * (v - mean), 0) / nz.length) : 0;
    out.stepMean = +mean.toFixed(5);
    out.stepCV = mean > 0 ? +(sd / mean).toFixed(4) : 0;
    out.stepMax = +Math.max.apply(null, d.concat([0])).toFixed(5);
    out.jumpRatio = mean > 0 ? +(out.stepMax / mean).toFixed(2) : 0;
    // yaw continuity: biggest single-frame turn, wrapped
    let maxYaw = 0;
    for (let i = 1; i < moved.length; i++) {
      let dy = moved[i].yaw - moved[i - 1].yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      maxYaw = Math.max(maxYaw, Math.abs(dy));
    }
    out.maxYawStep = +maxYaw.toFixed(4);
    out.nan = moved.some((t) => !isFinite(t.x) || !isFinite(t.y) || !isFinite(t.z) || !isFinite(t.yaw));
  }
  const drawSet = new Set(tel.map((t) => t.draws));
  out.drawCalls = { min: Math.min.apply(null, tel.map((t) => t.draws)), max: Math.max.apply(null, tel.map((t) => t.draws)), distinct: drawSet.size };
  const poolKeys = Object.keys(tel[0].pools || {});
  if (poolKeys.length) {
    out.pools = {};
    poolKeys.forEach((k) => {
      const s = tel.map((t) => (t.pools || {})[k] || 0);
      out.pools[k] = { min: Math.min.apply(null, s), max: Math.max.apply(null, s) };
    });
  }
  if (tel[0].plays) {
    const a = tel[0].plays, b = tel[tel.length - 1].plays, diff = {};
    Object.keys(b).forEach((k) => { if (b[k] !== a[k]) diff[k] = b[k] - a[k]; });
    out.audio = diff;
  }
  return out;
}

/* ═════════════════════════════════════════════════════════════════ driver ══ */
async function main() {
  const argv = process.argv.slice(2);
  const tagIdx = argv.indexOf("--tag");
  let tag = "";
  if (tagIdx >= 0) { tag = argv[tagIdx + 1] || ""; argv.splice(tagIdx, 2); }
  if (argv.indexOf("--list") >= 0) {
    Object.keys(SUBJECTS).forEach((k) => console.log(k.padEnd(24), SUBJECTS[k].note));
    return;
  }
  /* FORK B: strips render the SHIPPING cast — the baked sprites — because that
   * is what a reviewer needs to judge. `--fallback` renders the 3D people
   * instead, for reviewing the minifig path that carries the game when the
   * sheets do not arrive. */
  const fallback = argv.indexOf("--fallback") >= 0;
  const want = argv.filter((a) => a[0] !== "-");
  const names = want.length ? want.filter((n) => SUBJECTS[n]) : Object.keys(SUBJECTS);
  if (want.length && names.length !== want.length) {
    console.error("unknown subject(s):", want.filter((n) => !SUBJECTS[n]).join(", "));
    process.exit(2);
  }

  const port = 8930 + Math.floor(Math.random() * 40);
  const server = await H.serveStatic(port);
  const browser = await H.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: CELL_W, height: CELL_H, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith("http://127.0.0.1:" + port) ? r.continue() : r.abort()));
  // kill the page's own rAF loop BEFORE any page script runs — this file is the clock
  await page.evaluateOnNewDocument(() => {
    window.requestAnimationFrame = function () { return 0; };
    window.cancelAnimationFrame = function () {};
  });
  await page.goto(`http://127.0.0.1:${port}/castlekruzer.html?sprites=${fallback ? 0 : 1}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE, { timeout: 20000 });
  await page.evaluate(() => window.__FS__.FSRender.spritesLoaded);
  /* Wind OFF for the rig. These sheets exist so a reviewer can judge ONE thing
   * — foot slide, a saw blade, a smoke column — and 24 frames of foliage
   * drifting behind the subject is noise in every one of them. Nothing else
   * about the frames changes: the sway is a vertex-shader lean on the tree
   * material and touches no geometry, no pool and no sim state. */
  await page.evaluate(() => { window.__FS__.FSRender.setTreeSway(false); });
  await page.evaluate(installHelpers);

  const summary = {};
  for (const name of names) {
    const spec = SUBJECTS[name];
    process.stdout.write("• " + name.padEnd(22));
    let meta;
    try {
      meta = await page.evaluate(spec.setup);
    } catch (e) { console.log("SETUP CRASH", e.message); summary[name] = { error: String(e.message) }; continue; }
    if (!meta) { console.log("— could not stage (skipped)"); summary[name] = { skipped: true }; continue; }
    await page.evaluate(() => window.__STRIP__.hideHud());
    const dt = spec.dt || DT;
    const n = spec.frames || 24;
    const tel = [], shots = [];
    for (let i = 0; i < n; i++) {
      if (meta.atFrame && meta.atFrame[i]) {
        await page.evaluate((src) => { (new Function("FS", src))(window.__FS__); }, meta.atFrame[i]);
      }
      const t = await page.evaluate((dtv, track, extra) => {
        const S = window.__STRIP__;
        for (let k = 0; k < (extra || 1); k++) S.beat(dtv);
        return S.sample(track);
      }, dt, meta.track, spec.tickPerFrame || 1);
      tel.push(t);
      shots.push(await page.screenshot({ type: "png" }));
    }
    const stats = analyse(tel);
    const header = name + "  —  " + spec.note + (meta.label ? "   [" + meta.label + "]" : "");
    const foot = "dt=" + dt.toFixed(3) + "s x" + (spec.tickPerFrame || 1) + "  frames=" + n +
      (stats.stepCV !== undefined ? "   stepMean=" + stats.stepMean + "  CV=" + stats.stepCV + "  maxJump=" + stats.jumpRatio + "x  maxYawStep=" + stats.maxYawStep : "") +
      "   draws " + stats.drawCalls.min + "-" + stats.drawCalls.max;
    const fp = await compose((tag ? tag + "_" : "") + name, shots, header, foot);
    fs.writeFileSync(fp.replace(/\.png$/, ".json"), JSON.stringify({ name, note: spec.note, label: meta.label, stats, telemetry: tel }, null, 1));
    summary[name] = stats;
    console.log("→ " + path.relative(H.ROOT, fp) + "   " + (stats.stepCV !== undefined ? "CV=" + stats.stepCV + " jump=" + stats.jumpRatio + "x yaw=" + stats.maxYawStep : "static"));
  }

  await browser.close();
  server.close();
  console.log("\npage errors:", errors.length ? errors.slice(0, 8) : "none");
  const out = path.join(OUT_DIR, (tag ? tag + "_" : "") + "_summary.json");
  fs.writeFileSync(out, JSON.stringify(summary, null, 1));
  console.log("summary →", path.relative(H.ROOT, out));
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
