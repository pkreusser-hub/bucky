"use strict";
/* YETI RIDGE builder (2026-10-12) — generates the whole "yeti-ridge" builtin track entry and patches it between the
 * YR_GEN_START / YR_GEN_END markers in assets/farmkart-track.js. Same approach as tools/_hh_build.cjs: the centreline is
 * a byte-faithful replica of the game's Catmull-Rom resample, and every prop is seated on the REAL FK_TRACK height
 * math (groundHills + sculpt field), so nothing floats or sinks. Re-run after changing anything below:
 *     node tools/_yr_build.cjs
 *
 * THE LAP (design): lodge village start straight -> Cocoa Corner (sharp right) -> two stacked switchback hairpins up
 * the mountain (+20 u) -> glacier cave (natural tunnel) -> SUMMIT SKI-JUMP over a crevasse (big jump #1) -> frozen-lake
 * sweep on painted ICE with snowman crossings -> pine-forest S with a goat crossing + slush -> GORGE JUMP over an icy
 * creek you can wade if you're slow (big jump #2) -> steam railway (two gated crossings) -> OVERPASS bridge over the
 * start straight (figure-8) -> descent -> Yeti's Elbow hairpin back into town. */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const TRACK_JS = path.join(ROOT, "assets/farmkart-track.js");
function loadModule(code){ const win = {}; new Function("window", "document", code)(win, undefined); return win.FK_TRACK; }
const FK = loadModule(fs.readFileSync(TRACK_JS, "utf8"));

// ---------------- control points [x, z, y] ----------------
const PTS = [
  [0,-30,0],[0,10,0],[0,50,0],[0,82,0],                                   // lodge-village start straight (north)
  [4,100,0.3],[18,110,0.8],[36,106,1.3],[52,96,2.0],                      // Cocoa Corner (sharp right)
  [80,100,3],[115,94,5.5],                                                // switchback leg 1 (climbing east)
  [140,96,7],[152,108,8],[148,122,9],[132,128,10],                        // hairpin A
  [100,130,11.5],[70,132,13],                                             // leg 2 (west)
  [48,138,14],[40,152,15],[50,164,16],[70,168,17],                        // hairpin B
  [105,170,18.5],[140,172,20],                                            // leg 3 (east, to the summit)
  [165,180,21],[182,196,22],                                              // summit swing -> glacier cave
  [188,222,22],[190,246,22],                                              // ski-jump run-up + lip
  [191,270,15],[192,295,11.5],[190,320,9],                                // crevasse dip + an easing-out downhill landing (was 15->16->12: a crest that
  //   re-launched karts landing at ~37 m/s - playtest 'screen stutters coming down from a big ramp jump')
  [178,346,6.5],[150,366,4],[115,378,3],[80,378,3],[52,366,3.5],            // frozen-lake sweep (left)
  [30,348,4.5],[6,336,5],[-12,318,5.5],[-8,298,6],[-26,288,6.5],[-46,284,7], // pine-forest S (ends in a hard left)
  [-54,268,7.2],[-54,246,7.5],                                            // straight run-in to the gorge lip
  [-55,226,5],[-55,206,7.5],                                              // creek dip + landing
  [-55,180,8],[-48,154,8.5],                                              // railway flats (straight out of the gorge landing)
  [-34,124,9],[-26,96,9],[-16,72,9],[0,62,9],                            // overpass leg: swings round to cross the start straight square-on
  [22,60,9],[44,52,8.5],                                                  // over the top, heading east
  [56,32,7],[56,4,5],[50,-24,3],                                          // descent (well east of the village)
  [40,-48,1.6],[26,-64,0.8],[10,-68,0.4],[-1,-54,0.2],                    // Yeti's Elbow hairpin
].map(p => ({ x:p[0], z:p[1], y:p[2] }));
const WIDTH = 16, HALF = 8;

// ---------------- centreline replica (THREE CatmullRomCurve3 'catmullrom' t=.5 closed, as FK_TRACK.resample) ----------------
const N = 400;
function catmull(points, N){
  const n = points.length, P = (i) => points[((i % n) + n) % n], out = [];
  for (let i = 0; i < N; i++){ const t = i / N * n, seg = Math.floor(t), u = t - seg, p0 = P(seg-1), p1 = P(seg), p2 = P(seg+1), p3 = P(seg+2), u2 = u*u, u3 = u2*u;
    const comp = (a0,a1,a2,a3) => { const t1 = (a2-a0)*0.5, t2 = (a3-a1)*0.5; return (2*a1-2*a2+t1+t2)*u3 + (-3*a1+3*a2-2*t1-t2)*u2 + t1*u + a1; };
    out.push({ x:comp(p0.x,p1.x,p2.x,p3.x), y:comp(p0.y,p1.y,p2.y,p3.y), z:comp(p0.z,p1.z,p2.z,p3.z) }); }
  return out;
}
const C = catmull(PTS, N);
const T = []; for (let i = 0; i < N; i++){ const a = C[(i-1+N)%N], b = C[(i+1)%N]; const dx = b.x-a.x, dz = b.z-a.z, h = Math.hypot(dx,dz) || 1; T.push({ x:dx/h, z:dz/h }); }
const arcS = [0]; let acc = 0; for (let i = 1; i < N; i++){ acc += Math.hypot(C[i].x-C[i-1].x, C[i].z-C[i-1].z); arcS[i] = acc; }
const L = acc + Math.hypot(C[0].x-C[N-1].x, C[0].z-C[N-1].z);
const sampled = { centerPts:C, tangents:T, arcS, trackLen:L, samples:N };
const OPTS0 = { amp:3.4, wave:60, margin:9 };
const groundHills = (x,z) => FK.groundHills(x, z, OPTS0);
function atFrac(f){ const target = ((f%1)+1)%1 * L; let bi = 0; for (let i = 0; i < N; i++){ if (arcS[i] >= target){ bi = i; break; } bi = i; }
  const c = C[bi], t = T[bi]; return { x:c.x, z:c.z, y:c.y, nx:-t.z, nz:t.x, tx:t.x, tz:t.z, idx:bi }; }
function fracNear(x, z){ let bi = 0, bd = 1e18; for (let i = 0; i < N; i++){ const d = (C[i].x-x)**2 + (C[i].z-z)**2; if (d < bd){ bd = d; bi = i; } } return arcS[bi] / L; }
function nearest(x, z){ let bi = 0, bd = 1e18; for (let i = 0; i < N; i++){ const d = (C[i].x-x)**2 + (C[i].z-z)**2; if (d < bd){ bd = d; bi = i; } } return { i:bi, d:Math.sqrt(bd), y:C[bi].y }; }
// all branches within r (for the overpass: ground must stay on the LOW road under the crossing)
function branchesNear(x, z, r){ const out = []; for (let i = 0; i < N; i++){ const d = Math.hypot(C[i].x-x, C[i].z-z); if (d < r) out.push({ i, d, y:C[i].y }); } return out; }

// key fractions (from the control points that define each feature)
const F = {
  skiLip: fracNear(190, 246), crevasse: fracNear(191, 270), skiLand: fracNear(192, 295),
  cave: fracNear(122, 171), gorgeLip: fracNear(-54, 246), gorgeBottom: fracNear(-55, 226),
  overpass: fracNear(0, 62), lakeA: fracNear(178, 346), lakeB: fracNear(80, 378),
};

// =================== TERRAIN SCULPT (cell 6) ===================
// The landscape follows the road's elevation (a Gaussian-weighted average of nearby road heights), so the climb reads
// as a MOUNTAINSIDE rather than a causeway, plus authored features: summit massif + glacier dome over the cave, the
// crevasse trench, the gorge's creek channel (sealed so the flood-fill water stays put) and a snowy ring of peaks.
const CELL = 6;
const xs = C.map(c => c.x), zs = C.map(c => c.z);
const BB = { x0:Math.min(...xs)-70, x1:Math.max(...xs)+70, z0:Math.min(...zs)-70, z1:Math.max(...zs)+70 };
const cells = {}; let ntc = 0;
const SIG = 30;
const gauss = (d, s) => Math.exp(-(d*d)/(2*s*s));
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x-e0)/(e1-e0))); return t*t*(3-2*t); };
const GORGE = { z:226, x0:-104, x1:-6, w:9, floor:4.3 };   // creek channel runs east-west under the gorge dip
for (let i = Math.floor(BB.x0/CELL); i <= Math.ceil(BB.x1/CELL); i++) for (let j = Math.floor(BB.z0/CELL); j <= Math.ceil(BB.z1/CELL); j++){
  const x = i*CELL, z = j*CELL;
  // road-following base
  // inverse-distance blend of EVERY nearby road height (w = 1/(d^2+16)^1.5): at a road it is that road's height,
  // between two roads at different heights it slopes smoothly. (Nearest-road-wins made Voronoi cliffs beside the
  // village straight; a plain wide Gaussian let the mountain legs pull the village ground up into banks.)
  let wsum = 0, ysum = 0, dmin = 1e9;
  for (let k = 0; k < N; k++){ const d = Math.hypot(C[k].x-x, C[k].z-z); if (d < dmin) dmin = d; if (d > 140) continue; const w = Math.pow(d*d + 16, -1.5); wsum += w; ysum += w*C[k].y; }
  let target = wsum > 0 ? ysum/wsum : 0;
  // under the overpass the ground belongs to the LOW road (start straight) — keep open air below the deck
  const br = branchesNear(x, z, 22); if (br.length){ const lo = Math.min(...br.map(b => b.y)); const hi = Math.max(...br.map(b => b.y)); if (hi - lo > 4) target = Math.min(target, lo + (hi-lo)*0.15); }
  // summit massif (behind the cave and the ski jump) + glacier dome over the cave (natural tunnel needs a hill over it)
  target += 16 * gauss(Math.hypot(x-215, z-205), 26) * smooth(HALF+4, HALF+18, dmin);
  const cave = atFrac(F.cave); target += 22 * gauss(Math.hypot(x-cave.x, z-cave.z), 22);
  // crevasse: a deep trench flanking the ski-jump dip (you see it under you in the air)
  const cv = atFrac(F.crevasse);
  { const dx = x - cv.x, dz = z - cv.z; const along = Math.abs(dx*cv.tx + dz*cv.tz), across = Math.abs(dx*cv.nx + dz*cv.nz);
    if (along < 9 && across > HALF+2 && across < 40) target -= 8 * smooth(HALF+2, HALF+8, across) * (1 - smooth(5, 9, along)) * (1 - smooth(22, 40, across)); }
  // gorge creek channel: floor 4.3 inside, a solid +1.6 lip around it so the water can't leak (HH ford lesson)
  { const inX = x > GORGE.x0 && x < GORGE.x1; const dz = Math.abs(z - GORGE.z);
    const endPad = Math.min(x - GORGE.x0, GORGE.x1 - x);
    if (inX && dz < GORGE.w && endPad > 4) target = Math.min(target, GORGE.floor + 2.6*smooth(GORGE.w-4, GORGE.w, dz));
    else if (Math.abs(x-(GORGE.x0+GORGE.x1)/2) < (GORGE.x1-GORGE.x0)/2 + 16 && dz < GORGE.w + 14) target = Math.max(target, 8.6); }
  // ring of jagged peaks far out (backdrop)
  const cx = (BB.x0+BB.x1)/2, cz = (BB.z0+BB.z1)/2, rr = Math.hypot(x-cx, z-cz), R0 = Math.min(BB.x1-BB.x0, BB.z1-BB.z0)/2;
  target += 18 * smooth(40, 90, dmin) * smooth(R0-30, R0+20, rr) * (0.7 + 0.3*Math.sin(Math.atan2(z-cz, x-cx)*7));   // eased in: a hard 'dmin > 40' cut made a cliff
  // ROAD-EDGE BANK CAP (2026-10-12 playtest scan): on the steep summit descent the blend lifted the snow 0.5 u over the
  // road edge (bilinear between 6 u cells). Within half+8 of a road the ground may rise at most 0.9 per u past edge+1,
  // measured from the LOWEST branch there. Not inside the glacier cave span: that hill IS the tunnel's cover.
  if (dmin < HALF + 8){
    // Inside the glacier cave span the game draws THIS terrain as the land over the bore (naturalTunnelCoverAt), so it
    // must stay above the 6 u bore ceiling: an earlier version capped the last 6 u inside each portal and the hill came
    // down INTO the cave as a grey snow wall you drove through (playtest 2026-10-12). Over the bore: >= road + 10.
    // (+6: this builder's replica centreline and the game's sample the arc a couple of units apart at the mouth - with
    //  +0.5 the hill sloped down to 1.2 u over the road where the game still draws the cover. Outside the span the game
    //  keeps the ROAD at road height whatever this field says, so overshooting the span here is harmless.)
    const nn = nearest(x, z), caveS = F.cave*L, inCave = Math.abs(arcS[nn.i] - caveS) <= 22 + 6;
    if (inCave) target = Math.max(target, nn.y + 10);
    else { const near = branchesNear(x, z, HALF + 8); const lo = near.length ? Math.min(...near.map(b => b.y)) : nn.y;
      target = Math.min(target, lo - 0.25 + Math.max(0, dmin - (HALF + 1)) * 0.9); }
  }
  const v = Math.round((target - groundHills(x, z))*100)/100;
  if (Math.abs(v) >= 0.05){ cells[i+","+j] = v; ntc++; }
}
const terrain = { cell:CELL, cells };
const seatOpts = Object.assign({}, OPTS0, { field:terrain });
const seat = (x,z) => FK.sampleHeight(sampled, x, z, WIDTH, seatOpts);

// =================== WATERS (gorge creek — fordable, never drowns) ===================
const gb = atFrac(F.gorgeBottom);
const waters = [{ id:"yr_creek", x:+gb.x.toFixed(1), z:GORGE.z, y:+(gb.y + 0.6).toFixed(2) }];

// =================== PAINT (physics: ICE on the lake sweep, SLUSH=mud at the forest edges) ===================
const ICE = 0xa9e0f5, SLUSH = 0x4b3826, PCELL = 4, pcells = {};
// interpolates BETWEEN centreline samples: atFrac() snaps to samples ~3.7 u apart, which is coarser than the 4 u paint
// cell on a diagonal and left comb-shaped holes in the lake ice (a kart read 'ice' on 8 of 30 frames; _verify-yeti [C])
function paintBand(fA, fB, lat0, lat1, color){ const i0 = atFrac(fA).idx, i1 = atFrac(fB).idx, cnt = (i1 - i0 + N) % N;
  for (let k = 0; k < cnt; k++){ const i = (i0 + k) % N, j = (i + 1) % N;
    for (let q = 0; q < 8; q++){ const u = q / 8, x0 = C[i].x + (C[j].x - C[i].x)*u, z0 = C[i].z + (C[j].z - C[i].z)*u;
      let nx = -(T[i].z + (T[j].z - T[i].z)*u), nz = T[i].x + (T[j].x - T[i].x)*u; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      for (let l = lat0; l <= lat1; l += 1){ const x = x0 + nx*l, z = z0 + nz*l; pcells[Math.round(x/PCELL)+","+Math.round(z/PCELL)] = color; } } } }
paintBand(fracNear(165,356), fracNear(70,374), -HALF-2, HALF+2, ICE);          // the frozen-lake sweep: full-width ice
paintBand(fracNear(-12,318), fracNear(-8,298), HALF-3, HALF+3, SLUSH);          // slush on the outside of the forest kinks
paintBand(fracNear(-26,282), fracNear(-44,270), -HALF-3, -HALF+3, SLUSH);
const paint = { cell:PCELL, cells:pcells };

// =================== OBJECTS ===================
let oi = 0; const objects = [];
// ROAD CLEARANCE (2026-10-12 playtest): hand-placed village props (lanterns, candy canes) stood in the overpass road and
// the train-stretch edge. Every GLB prop now keeps its footprint off EVERY road branch (2D, whatever the height: a prop
// under the overpass still reads as standing in the road below it); offenders are dropped and counted.
let propsDropped = 0;
function obj(model, x, z, size, rotY, extra){ extra = extra || {}; const sy = extra.sy != null ? extra.sy : size;
  if (nearest(x, z).d < HALF + 1.5 + size * 0.45){ propsDropped++; return; }
  objects.push({ id:"yr_o"+(++oi), tag:extra.tag || "", type:"glb", x:+x.toFixed(2), y:+((extra.y != null ? extra.y : seat(x,z) + sy*0.5)).toFixed(2), z:+z.toFixed(2),
    rotY:+(rotY||0).toFixed(3), sx:extra.sx != null ? extra.sx : size, sy, sz:extra.sz != null ? extra.sz : size, color:0, model }); }
// RAMPS (physics jumps): seat the base on the road; alignRampsToTrack aims them down the road at load
function ramp(id, tag, f, sy, sz, sx, color){ const a = atFrac(f); objects.push({ id, tag, type:"ramp", x:+a.x.toFixed(2), y:+(a.y + sy/2).toFixed(2), z:+a.z.toFixed(2), rotY:0, sx, sy, sz, color }); }
ramp("yr_skijump", "summit ski jump", F.skiLip - 8/L, 3.0, 14, 15, 0xdfeaf2);
ramp("yr_gorgejump", "gorge jump", F.gorgeLip - 7/L, 2.1, 12, 15, 0xc9a06a);
// scatter helpers (off-road only)
let st = 7; const rnd = () => (st = (st*1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
function scatter(cx, cz, r, count, pick, minRoad){ minRoad = minRoad || HALF+5; let placed = 0, tries = 0;
  while (placed < count && tries < count*15){ tries++; const ang = rnd()*Math.PI*2, rad = Math.sqrt(rnd())*r, x = cx+Math.cos(ang)*rad, z = cz+Math.sin(ang)*rad;
    const nn = nearest(x, z); if (nn.d < minRoad) continue;
    if (x > GORGE.x0-4 && x < GORGE.x1+4 && Math.abs(z-GORGE.z) < GORGE.w+3) continue;   // not in the creek
    pick(x, z); placed++; } }
const PINES = ["snow_pine_a","snow_pine_b","snow_pine_c","snow_pine_plain"];
// pine forests: the S-bends, the mountainside between switchbacks, the railway flats and the town edge
scatter(-20, 300, 70, 70, (x,z) => obj(PINES[(rnd()*4)|0], x, z, 7 + rnd()*5, rnd()*6));
scatter(95, 150, 75, 34, (x,z) => obj(PINES[(rnd()*4)|0], x, z, 6 + rnd()*5, rnd()*6), HALF+6);
scatter(-80, 170, 50, 26, (x,z) => obj(PINES[(rnd()*4)|0], x, z, 7 + rnd()*5, rnd()*6));
scatter(-70, 0, 30, 10, (x,z) => obj(PINES[(rnd()*4)|0], x, z, 7 + rnd()*4, rnd()*6), 40);   // far west only: the village edge belongs to the cabins
scatter(230, 300, 45, 16, (x,z) => obj(PINES[(rnd()*4)|0], x, z, 7 + rnd()*4, rnd()*6));
// ice rocks + snow piles around the summit, crevasse and gorge
scatter(205, 220, 40, 14, (x,z) => obj(["snow_ice_rocks_large","snow_ice_rocks_medium","snow_pile"][(rnd()*3)|0], x, z, 4 + rnd()*4, rnd()*6));
scatter(-54, 226, 40, 10, (x,z) => obj(["snow_ice_rocks_medium","snow_ice_rocks_small","snow_pile"][(rnd()*3)|0], x, z, 3 + rnd()*3, rnd()*6), HALF+4);
// village dressing beside the start straight: lanterns both sides, presents, candy canes, benches, sleds, a snow fort
for (let z = -24; z <= 76; z += 12){ obj("snow_lantern", -HALF-4.2, z, 3.2, 0); obj("snow_lantern", HALF+4.2, z+6, 3.2, Math.PI); }   // 4.2: clear of the half+2.5 barrier
[[-16,6],[16,30],[-18,50],[17,-8]].forEach(([x,z],k) => obj(k%2 ? "snow_bench" : "snow_sled", x, z, 3.4, k*1.3));
[[-15,-20],[14,64],[-14,70]].forEach(([x,z]) => obj("snow_candycane", x, z, 3.5, 0.4));
[[-20,24],[20,12],[21,46],[-21,40],[-19,-6]].forEach(([x,z],k) => obj(k%2 ? "snow_present" : "snow_present_round", x, z, 2.2, k));
obj("snow_fort", -34, -40, 8, 0.6, { tag:"snow fort" });
obj("snow_tree_decorated", 26, 82, 10, 0, { tag:"village tree" });
[[-30,60],[30,-18],[-28,-14],[60,70]].forEach(([x,z],k) => obj(k%2 ? "snow_snowman_hat" : "snow_snowman", x, z, 4, k*0.9));
// lake shore + forest accents
[[150,392],[100,398],[200,330],[60,392]].forEach(([x,z],k) => obj(k%2 ? "snow_snowman" : "snow_bench", x, z, 3.6, k));
// pasture paddock (cows in winter) east of the village
const PAST = { x:96, z:-4, r:14 };

// =================== GAMEPLAY FEATURES ===================
const fences = [];
function ring(cx, cz, r, n){ const pts = []; for (let k = 0; k <= n; k++){ const a = k/n*Math.PI*2; pts.push({ x:+(cx+Math.cos(a)*r).toFixed(1), z:+(cz+Math.sin(a)*r).toFixed(1) }); } return pts; }
// ROAD-EDGE WALLS: a track that defines ANY fence gets no automatic corridor walls from the game (RACE_FENCES uses
// the drawn fences instead), so generate the corridor walls here and keep them with the paddock ring. Without them
// bots running wide on the mountain climbed the glacier and the summit massif and launched 40 u off the road.
// height-blind FK.corridorFences left wall-less stretches here; tools/_fk_walls.cjs explains. The overpass span has its own walls.
// (built after the track object below: the gates need its trains + crossings)
fences.push({ id:"yr_fence_paddock", tag:"paddock", style:"rail", points:ring(PAST.x, PAST.z, PAST.r+2, 14), height:1.6, postGap:6 });
const r3 = (v) => +v.toFixed(3);
const track = {
  v:1, name:"Yeti Ridge", width:WIDTH, laps:3, gridSide:"left",
  sky:"snow", music:"snow-sprint", wallMargin:7, wallStyle:"fence", roadColor:0xdfe7ef, curbColor:0xffffff,
  itemRows:[r3(fracNear(0,30)), r3(fracNear(140,172)), r3(fracNear(115,378)), r3(fracNear(-50,175))],
  points:PTS.map(p => ({ x:p.x, z:p.z, y:p.y })),
  boostPads:[
    { s:r3(fracNear(0,62)), lane:0 },                    // start straight
    { s:r3(fracNear(100,130)), lane:0 },                 // hairpin A exit (leg 2)
    { s:r3(F.skiLip - 22/L), lane:0 },                   // ski-jump run-up
    // (no pad on the gorge run-in: the ramp itself fires a pad boost on entry; a second kick launched karts off the crest early)
    { s:r3(fracNear(56,20)), lane:0.1 },                 // the descent
  ],
  ramps:undefined,
  // a tunnel's s is where it STARTS (FK_TRACK.buildTunnelMesh / naturalTunnelCoverAt: span [s*L, s*L+len]). It was
  // written as the CENTRE, so the real bore ran 22 u past the glacier hill built over it: the hill sat at road level in
  // the last 22 u of the cave (a grey wall you drove through) and its slope filled the exit (playtest 2026-10-12).
  tunnels:[{ id:"yr_cave", tag:"glacier cave", s:r3(F.cave - 22/L), len:44, style:"natural" }],
  bridges:[{ id:"yr_overpass", tag:"village overpass", s:r3(F.overpass), len:48 }],
  chickens:[
    { id:"yr_snow1", s:r3(fracNear(140,370)), kind:"snowman" },
    { id:"yr_snow2", s:r3(fracNear(90,380)), kind:"snowman" },
    { id:"yr_goat1", s:r3(fracNear(-17,293)), kind:"goat" },
  ],
  pastures:[{ id:"yr_paddock", x:PAST.x, z:PAST.z, r:PAST.r, count:3 }],
  trains:[{ id:"yr_train", points:[{x:-118,z:190},{x:-14,z:190},{x:-4,z:166},{x:-14,z:140},{x:-118,z:140},{x:-128,z:166}], speed:9, cars:4 }],
};
delete track.ramps;
// walls: close barrier (half+2.5), open at the rail crossings, stepped out at the critter crossings, none on the overpass
// or inside the glacier cave (both carry their own walls)
const FKW = require("./_fk_walls.cjs"), G8 = FKW.gates(track, { C, N }, HALF);
const WALLS = FKW.walls({ C, T, arcS, L, N }, HALF, { margin:2.5, tight:1.2, skipArc:[[F.overpass*L - 27, F.overpass*L + 27], [F.cave*L - 28, F.cave*L + 28]], skipNear:G8.skipNear, wideNear:G8.wideNear, prefix:"yr_wall_" });
fences.splice(0, 0, ...WALLS);
{ const kept = FKW.clearOfWalls(objects, WALLS); console.log("props under a wall dropped:", objects.length - kept.length); objects.length = 0; objects.push(...kept); }

// =================== ASSEMBLE + PATCH ===================
const j = (o) => JSON.stringify(o);
const head = Object.keys(track).map(k => "      " + k + ":" + j(track[k]) + ",").join("\n");
const block = "\n    \"yeti-ridge\": {\n      /* generated by tools/_yr_build.cjs — do not hand-edit; re-run the builder */\n" + head + "\n" +
  "      terrain:" + j(terrain) + ",\n      waters:" + j(waters) + ",\n      paint:" + j(paint) + ",\n      fences:" + j(fences) + ",\n      objects:" + j(objects) + "\n    },\n    ";
let src = fs.readFileSync(TRACK_JS, "utf8");
const START = "/* YR_GEN_START", END = "/* YR_GEN_END */";
const si = src.indexOf(START), ei = src.indexOf(END);
if (si < 0 || ei < 0){ console.error("YR markers not found in farmkart-track.js"); process.exit(1); }
src = src.slice(0, src.indexOf("\n", si) + 1) + block + src.slice(ei);
fs.writeFileSync(TRACK_JS, src);
console.log("props dropped (road clearance)", propsDropped, "walls", WALLS.length, "wall pts", WALLS.reduce((a,w)=>a+w.points.length,0));
console.log("patched yeti-ridge. len", L.toFixed(0), "terrain cells", ntc, "paint cells", Object.keys(pcells).length, "objects", objects.length,
  "fracs", JSON.stringify(Object.fromEntries(Object.entries(F).map(([k,v]) => [k, +v.toFixed(3)]))), "creek level", waters[0].y);
