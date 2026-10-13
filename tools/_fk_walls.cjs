"use strict";
/**
 * Road-edge walls for generated Farm Kart tracks (tools/_yr_build.cjs, tools/_hh_build.cjs).
 *
 * The game only builds automatic corridor walls for a track with NO drawn fences (RACE_FENCES), so a generator that
 * adds a paddock ring must write the walls itself. FK_TRACK.corridorFences also drops a wall point whenever ANY other
 * branch is within half+margin in 2D, which left long wall-less stretches beside parallel legs and overpass approaches
 * (Yeti Ridge playtest 2026-10-12: "need a fence here to prevent falling over").
 *
 * Here: the normal wall at half+margin where there is room; where another branch crowds it, a TIGHT wall at the road
 * edge (half+tight) unless that edge itself touches another road (a real crossing/merge). Spans listed in opts.skipArc
 * ([[a0,a1], ...] in arc units, e.g. a bridge with its own side walls) get no wall.
 *   walls({ C, T, arcS, L, N }, half, { margin:7, tight:1.2, skipArc:[], prefix:"wall_" }) -> fence[]
 */
function walls(S, half, opts){
  opts = opts || {};
  const { C, T, arcS, L, N } = S;
  const MARGIN = opts.margin || 2.5, EDGE = half + MARGIN, TIGHT = half + (opts.tight || 1.2), meanSeg = L / N, win = Math.ceil((2*EDGE) / meanSeg) + 2;
  const skip = opts.skipArc || [], skipNear = opts.skipNear || [], wideNear = opts.wideNear || [];
  const skipped = (i) => skip.some(([a0, a1]) => arcS[i] > a0 && arcS[i] < a1);
  const otherWithin = (x, z, i, r) => { for (let j = 0; j < N; j++){ const di = Math.min((j-i+N)%N, (i-j+N)%N); if (di < win) continue; if ((C[j].x-x)**2 + (C[j].z-z)**2 < r*r) return true; } return false; };
  const out = [];
  for (const side of [-1, 1]){
    const pts = [];
    for (let i = 0; i < N; i++){
      const nx = -T[i].z*side, nz = T[i].x*side;
      if (skipped(i)){ pts.push(null); continue; }
      const wide = wideNear.find((w) => Math.hypot(C[i].x - w.x, C[i].z - w.z) < w.r), E = wide ? half + wide.margin : EDGE;
      const ex = C[i].x + nx*E, ez = C[i].z + nz*E;
      if (skipNear.some((q) => Math.hypot(ex - q.x, ez - q.z) < q.r)){ pts.push(null); continue; }
      if (!otherWithin(ex, ez, i, E)){ pts.push({ x:+ex.toFixed(1), z:+ez.toFixed(1) }); continue; }
      const tx = C[i].x + nx*TIGHT, tz = C[i].z + nz*TIGHT;
      pts.push(otherWithin(tx, tz, i, TIGHT) ? null : { x:+tx.toFixed(1), z:+tz.toFixed(1) });
    }
    // rotate so index 0 is a gap (runs don't wrap), then cut runs at gaps; decimate to ~6 u (the mesh re-densifies)
    const g0 = pts.findIndex((q) => !q), seq = g0 < 0 ? pts.concat([pts[0]]) : pts.slice(g0).concat(pts.slice(0, g0));
    let run = [];
    const flush = () => { if (run.length >= 2){ const dec = [run[0]]; let acc = 0; for (let k = 1; k < run.length - 1; k++){ acc += Math.hypot(run[k].x-run[k-1].x, run[k].z-run[k-1].z); if (acc >= 6){ dec.push(run[k]); acc = 0; } } dec.push(run[run.length-1]); out.push({ tag:"corridor", style:"ribbon", height:1.2, points:dec }); } run = []; };
    for (const q of seq){ if (q) run.push(q); else flush(); } flush();
  }
  return out.map((f, k) => Object.assign({ id:(opts.prefix || "wall_") + k }, f));
}
// skipNear / wideNear from a track's trains + critter crossings. Train lines are closed polylines; every place one
// passes near the road the wall opens for 5 u either side of the rails. Critter crossings (chickens[].s)
// get the wall stepped out to half+4.8 for 7 u either way.
function gates(track, S, half){
  const { C, N } = S, skipNear = [], wideNear = [];
  for (const tr of (track.trains || [])){
    const P = tr.points, hits = [];
    for (let k = 0; k < P.length; k++){ const a = P[k], b = P[(k+1) % P.length], len = Math.hypot(b.x-a.x, b.z-a.z);
      for (let u = 0; u <= len; u += 1){ const x = a.x + (b.x-a.x)*u/len, z = a.z + (b.z-a.z)*u/len; let d = 1e9; for (let i = 0; i < N; i++) d = Math.min(d, Math.hypot(C[i].x-x, C[i].z-z)); if (d < half + 12) hits.push({ x, z }); } }
    for (const h of hits) skipNear.push({ x:h.x, z:h.z, r:5 });
  }
  for (const c of (track.chickens || [])){ const i = Math.max(0, Math.min(N-1, Math.round((c.s || 0) * N))); wideNear.push({ x:C[i].x, z:C[i].z, r:7, margin:4.8 }); }
  return { skipNear, wideNear };
}
// untagged scatter props (rocks, barrels, trees) a wall would run straight through are dropped; tagged set pieces
// (barn, silo, snow fort...) are the generator's to place and are kept
function clearOfWalls(objects, wallFences){
  const segD = (x, z, a, b) => { const dx = b.x-a.x, dz = b.z-a.z, l = dx*dx + dz*dz || 1; const t = Math.max(0, Math.min(1, ((x-a.x)*dx + (z-a.z)*dz) / l)); return Math.hypot(x-a.x-dx*t, z-a.z-dz*t); };
  const wd = (x, z) => { let m = 1e9; for (const w of wallFences) for (let i = 0; i + 1 < w.points.length; i++) m = Math.min(m, segD(x, z, w.points[i], w.points[i+1])); return m; };
  return objects.filter((o) => o.tag || o.type !== "glb" || wd(o.x, o.z) >= Math.max(o.sx || 1, o.sz || 1) * 0.35);
}
module.exports = { walls, gates, clearOfWalls };
