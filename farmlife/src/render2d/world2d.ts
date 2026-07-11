// ---------------------------------------------------------------------------
// world2d — maps the EXISTING farm geography (world/terrain, farm/pasture,
// stations) into 2D. Two jobs:
//   1) bakeStaticMap(): draw the whole ±60 m valley ONCE into an offscreen
//      canvas — grass (mottle+tufts+flowers, mockup-faithful), default dirt
//      paths, the flat field's soil base, and the pond. The camera blits the
//      visible slice each frame (per-tile dirty redraw is a documented R2 hook;
//      gameplay field tiles + all tall props draw dynamically on top).
//   2) registerColliders(): register the SAME circle/box/segment obstacles the
//      3D scenery/barn/stations did — the collision module (resolveCollision)
//      is pure and reused unchanged, so movement blocks identically.
// It also returns the prop LAYOUT (tree/rock spots, fence runs, barn/silo/house/
// pond/stations) so the dynamic pass can draw them y-sorted for correct overlap.
// ---------------------------------------------------------------------------

import { MAP_HALF, FIELD, POND, DEFAULT_PATH_PTS, EDGE, isInField } from "../world/terrainConst";
import { PASTURE, BARN, DOOR, SILO, GATE } from "../farm/pasture";
import { addCircle, addBox, addSegment } from "../world/collision";
import { PPM, MAP_PX, worldToMap } from "./coords";
import { G, PATH, POND_COL } from "./palette";

export interface Vec {
  x: number;
  z: number;
}
export interface TreeSpot {
  x: number;
  z: number;
  size: number;
}
export interface FenceRun {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}
export interface Station2D {
  x: number;
  z: number;
  radius: number;
  kind: "bin" | "stand";
}

export interface World2D {
  staticMap: HTMLCanvasElement;
  trees: TreeSpot[];
  rocks: TreeSpot[];
  fieldFence: FenceRun[];
  pastureFence: FenceRun[];
  gatePosts: Vec[];
  barn: { minX: number; maxX: number; minZ: number; maxZ: number };
  silo: Vec;
  house: Vec;
  pond: { cx: number; cz: number; r: number };
  bin: Station2D;
  stand: Station2D;
}

// ---- deterministic scatter (mirrors world/scenery.ts) -----------------------
function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function farFromStuff(x: number, z: number): boolean {
  if (Math.abs(x - FIELD.cx) < FIELD.half + 4 && Math.abs(z - FIELD.cz) < FIELD.half + 4) return false;
  if (Math.hypot(x - POND.cx, z - POND.cz) < POND.r + 5) return false;
  if (Math.abs(x - 24) < 8 && Math.abs(z - 20) < 8) return false; // farmhouse
  if (x > PASTURE.minX - 3 && x < PASTURE.maxX + 3 && z > PASTURE.minZ - 3 && z < PASTURE.maxZ + 3) return false;
  if (Math.hypot(x, z) < 8) return false;
  return true;
}

const HOUSE_POS: Vec = { x: 24, z: 20 };
const BIN_POS: Station2D = { x: FIELD.cx + FIELD.half + 2.6, z: FIELD.cz, radius: 2.6, kind: "bin" };
const STAND_POS: Station2D = { x: 14, z: 13, radius: 3.2, kind: "stand" };

/** Build the whole 2D world: static map + prop layout + registered colliders. */
export function buildWorld2D(): World2D {
  // ---- tree / rock spots (same seeds/count as scenery.ts) ----
  const trees: TreeSpot[] = [];
  {
    const rnd = mulberry32(4242);
    let guard = 0;
    while (trees.length < 46 && guard++ < 4000) {
      const x = (rnd() * 2 - 1) * (MAP_HALF - 4);
      const z = (rnd() * 2 - 1) * (MAP_HALF - 4);
      if (!farFromStuff(x, z)) continue;
      const s = 0.8 + rnd() * 0.7;
      trees.push({ x, z, size: s < 1.0 ? 0 : s < 1.3 ? 1 : 2 });
    }
  }
  const rocks: TreeSpot[] = [];
  {
    const rnd = mulberry32(909);
    let guard = 0;
    while (rocks.length < 30 && guard++ < 3000) {
      const x = (rnd() * 2 - 1) * (MAP_HALF - 4);
      const z = (rnd() * 2 - 1) * (MAP_HALF - 4);
      if (!farFromStuff(x, z)) continue;
      const s = 0.5 + rnd() * 0.9;
      rocks.push({ x, z, size: s < 0.75 ? 0 : s < 1.1 ? 1 : 2 });
    }
  }

  // ---- fence runs (field fence w/ east gap + pasture fence w/ west gate) ----
  const fieldFence = buildFieldFenceRuns();
  const pastureFence = buildPastureFenceRuns();
  const gatePosts: Vec[] = [
    { x: GATE.x, z: GATE.z0 },
    { x: GATE.x, z: GATE.z1 },
  ];

  registerColliders(trees, rocks, fieldFence, pastureFence);

  const staticMap = bakeStaticMap();

  return {
    staticMap,
    trees,
    rocks,
    fieldFence,
    pastureFence,
    gatePosts,
    barn: { minX: BARN.minX, maxX: BARN.maxX, minZ: BARN.minZ, maxZ: BARN.maxZ },
    silo: { x: SILO.x, z: SILO.z },
    house: HOUSE_POS,
    pond: { cx: POND.cx, cz: POND.cz, r: POND.r },
    bin: BIN_POS,
    stand: STAND_POS,
  };
}

// ---- field fence: 4 sides, east side (i===1) split around a 3 m gap ---------
function buildFieldFenceRuns(): FenceRun[] {
  const h = FIELD.half;
  const cx = FIELD.cx,
    cz = FIELD.cz;
  const corners: [number, number][] = [
    [cx - h, cz - h],
    [cx + h, cz - h],
    [cx + h, cz + h],
    [cx - h, cz + h],
  ];
  const runs: FenceRun[] = [];
  const GAP = 3;
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    if (i === 1) {
      const len = Math.hypot(bx - ax, bz - az);
      const gh = GAP / (2 * len);
      runs.push({ x1: ax, z1: az, x2: ax + (bx - ax) * (0.5 - gh), z2: az + (bz - az) * (0.5 - gh) });
      runs.push({ x1: ax + (bx - ax) * (0.5 + gh), z1: az + (bz - az) * (0.5 + gh), x2: bx, z2: bz });
    } else {
      runs.push({ x1: ax, z1: az, x2: bx, z2: bz });
    }
  }
  return runs;
}

// ---- pasture fence: 4 sides; west side split around the player GATE gap ------
function buildPastureFenceRuns(): FenceRun[] {
  const A = { x: PASTURE.minX, z: PASTURE.minZ };
  const B = { x: PASTURE.maxX, z: PASTURE.minZ };
  const C = { x: PASTURE.maxX, z: PASTURE.maxZ };
  const Dc = { x: PASTURE.minX, z: PASTURE.maxZ };
  return [
    { x1: A.x, z1: A.z, x2: B.x, z2: B.z }, // south
    { x1: B.x, z1: B.z, x2: C.x, z2: C.z }, // east
    { x1: C.x, z1: C.z, x2: Dc.x, z2: Dc.z }, // north
    { x1: Dc.x, z1: Dc.z, x2: GATE.x, z2: GATE.z1 }, // west-top
    { x1: GATE.x, z1: GATE.z0, x2: A.x, z2: A.z }, // west-bottom
  ];
}

// ---- colliders: reuse the pure collision module (resolveCollision unchanged) -
function registerColliders(trees: TreeSpot[], rocks: TreeSpot[], fieldFence: FenceRun[], pastureFence: FenceRun[]): void {
  // pond (matches scenery: POND.r + 0.6)
  addCircle(POND.cx, POND.cz, POND.r + 0.6);
  // farmhouse box (8×6)
  addBox(HOUSE_POS.x, HOUSE_POS.z, 4, 3);
  // trees + rocks
  for (const t of trees) addCircle(t.x, t.z, 0.5 * [0.85, 1.05, 1.35][t.size]);
  for (const r of rocks) addCircle(r.x, r.z, 0.55 * [0.5, 0.75, 1.0][r.size]);
  // field fence rails
  for (const r of fieldFence) addSegment(r.x1, r.z1, r.x2, r.z2, 0.28);
  // pasture fence rails (gate gap already excluded)
  for (const r of pastureFence) addSegment(r.x1, r.z1, r.x2, r.z2, 0.22);
  // silo
  addCircle(SILO.x, SILO.z, SILO.r);
  // barn walls (5 segments, DOOR opening left open for the player — pasture.ts)
  const wt = 0.3 * 0.6;
  addSegment(BARN.minX, BARN.maxZ, BARN.maxX, BARN.maxZ, wt); // north
  addSegment(BARN.minX, BARN.minZ, BARN.minX, BARN.maxZ, wt); // west
  addSegment(BARN.maxX, BARN.minZ, BARN.maxX, BARN.maxZ, wt); // east
  addSegment(BARN.minX, BARN.minZ, DOOR.x0, BARN.minZ, wt); // south-left
  addSegment(DOOR.x1, BARN.minZ, BARN.maxX, BARN.minZ, wt); // south-right
  // stations
  addBox(BIN_POS.x, BIN_POS.z, 0.9, 0.7);
  addBox(STAND_POS.x, STAND_POS.z, 1.0, 0.8);
}

// ---------------------------------------------------------------------------
// bakeStaticMap — grass + paths + field soil + pond onto the full ±60 m canvas.
// ---------------------------------------------------------------------------
function bakeStaticMap(): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = MAP_PX;
  const p = cv.getContext("2d")!;
  p.imageSmoothingEnabled = false;
  const rnd = seeded(42);

  // base grass
  p.fillStyle = G.base;
  p.fillRect(0, 0, MAP_PX, MAP_PX);
  // low-freq mottling
  for (let i = 0; i < 220; i++) {
    const x = rnd() * MAP_PX,
      y = rnd() * MAP_PX,
      r = 24 + rnd() * 90;
    p.fillStyle = [G.dk, G.lt, G.base, G.lt][Math.floor(rnd() * 4)];
    p.beginPath();
    p.ellipse(x, y, r, r * 0.6, 0, 0, 7);
    p.fill();
  }
  // dense tufts (little v shapes)
  for (let i = 0; i < 5200; i++) {
    const x = Math.floor(rnd() * MAP_PX),
      y = Math.floor(rnd() * MAP_PX);
    const c = rnd() < 0.5 ? G.tuft : rnd() < 0.5 ? G.dk2 : G.tuftl;
    p.fillStyle = c;
    p.fillRect(x, y, 1, 1);
    p.fillRect(x - 1, y + 1, 1, 1);
    p.fillRect(x + 1, y + 1, 1, 1);
  }
  for (let i = 0; i < 4200; i++) {
    p.fillStyle = rnd() < 0.5 ? G.lt2 : G.dk;
    p.fillRect(Math.floor(rnd() * MAP_PX), Math.floor(rnd() * MAP_PX), 1, 1);
  }
  // flowers
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rnd() * MAP_PX),
      y = Math.floor(rnd() * MAP_PX);
    const c = ["#fff4e0", "#ffc4d0", "#ffe084"][Math.floor(rnd() * 3)];
    p.fillStyle = c;
    p.fillRect(x, y, 2, 2);
    p.fillStyle = "#f8fcf0";
    p.fillRect(x, y - 1, 1, 1);
  }
  // dappled light
  p.fillStyle = "rgba(255,250,200,0.05)";
  for (let i = 0; i < 26; i++) {
    const x = rnd() * MAP_PX,
      y = rnd() * MAP_PX,
      r = 60 + rnd() * 120;
    p.beginPath();
    p.ellipse(x, y, r, r * 0.55, 0, 0, 7);
    p.fill();
  }

  bakePondBody(p, rnd);
  bakeAutotiledTerrain(p); // dithered grass↔path/soil/sand transitions (auto-tiling)
  bakePathPebbles(p, rnd); // chunky pebble accents scattered along the path
  return cv;
}

// ---------------------------------------------------------------------------
// AUTO-TILED TERRAIN (R4) — grass↔path/soil/sand transitions are driven by a
// terrain COVERAGE FIELD + an ordered (Bayer 4×4) dither instead of the old
// hand-feathered alpha bands. Blob-style auto-tiling: `terrainCoverage` returns,
// for any world point, which non-grass kind covers it and a 0..1 solid fraction
// (1 = core, 0..1 = the transition band); the dither turns that band into
// pixel-art speckle so dirt/soil/sand sit ORGANICALLY in the grass. It
// generalises — a future painted path just feeds another term into the field.
// ---------------------------------------------------------------------------
const PATH_CORE = 2.0; // full-dirt half-width (m)
const PATH_FEATHER = 1.7; // dithered blend distance beyond the core (m)

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
/** deterministic per-pixel hash (stable texture speckle across runs). */
function phash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const C_PATH = [toRgb(PATH.base), toRgb(PATH.dk), toRgb(PATH.lt)];
const C_PATH_PEB = toRgb(PATH.pebl);
const C_SOIL = [toRgb("#9c7a52"), toRgb("#8a6642"), toRgb("#ab8a5f")];
const C_SAND_DRY = [toRgb("#cabd94"), toRgb("#bcab7e")];
const C_SAND_WET = toRgb("#a98f63");
const C_TUFT = toRgb(G.tuftl);

function smooth01(t: number, band: number): number {
  const x = Math.max(0, Math.min(1, t / band));
  return x * x * (3 - 2 * x);
}
function distToSegW(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
// path spine bbox (+margin) for a cheap early-out
const PATH_BB = (() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of DEFAULT_PATH_PTS) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const m = PATH_CORE + PATH_FEATHER + 0.5;
  return { minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m };
})();
function pathDist(wx: number, wz: number): number {
  if (wx < PATH_BB.minX || wx > PATH_BB.maxX || wz < PATH_BB.minZ || wz > PATH_BB.maxZ) return Infinity;
  let best = Infinity;
  for (let i = 0; i < DEFAULT_PATH_PTS.length - 1; i++) {
    const a = DEFAULT_PATH_PTS[i], b = DEFAULT_PATH_PTS[i + 1];
    const d = distToSegW(wx, wz, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return best;
}

interface Cov {
  kind: "path" | "soil" | "sand";
  solid: number;
}
/** PURE. Non-grass terrain coverage at a world point (null = pure grass). */
function terrainCoverage(wx: number, wz: number): Cov | null {
  // pond sand rim (water↔grass, wet at the waterline) — water body drawn separately
  const dPond = Math.hypot(wx - POND.cx, wz - POND.cz);
  if (dPond < POND.r) return null; // inside the water body
  if (dPond < POND.r + 2.6) return { kind: "sand", solid: 1 - smooth01(dPond - POND.r, 2.6) };
  // worn dirt fan at the barn door (grazing side) — trivial pasture add
  const dBarn = Math.hypot(wx - (DOOR.x0 + DOOR.x1) / 2, wz - (BARN.minZ - 1.5));
  if (dBarn < 4.6) return { kind: "path", solid: 1 - smooth01(dBarn - 1.4, 3.2) };
  // field soil (untilled dirt plot) — solid inside, dithered outer edge
  const edge = Math.max(Math.abs(wx - FIELD.cx), Math.abs(wz - FIELD.cz)) - FIELD.half;
  if (edge < 1.9) return { kind: "soil", solid: 1 - smooth01(edge, 1.9) };
  // dirt path
  const dp = pathDist(wx, wz);
  if (dp < PATH_CORE + PATH_FEATHER) return { kind: "path", solid: 1 - smooth01(dp - PATH_CORE, PATH_FEATHER) };
  return null;
}

function pickColor(kind: Cov["kind"], h: number, solid: number): [number, number, number] {
  if (kind === "path") return h < 0.14 ? C_PATH_PEB : h < 0.34 ? C_PATH[1] : h < 0.5 ? C_PATH[2] : C_PATH[0];
  if (kind === "soil") return h < 0.42 ? C_SOIL[1] : h < 0.72 ? C_SOIL[0] : C_SOIL[2];
  return solid > 0.74 ? C_SAND_WET : h < 0.5 ? C_SAND_DRY[0] : C_SAND_DRY[1]; // sand (wet near the waterline)
}

/** Per-pixel auto-tile: dither each kind's coverage into the grass, with a
 * bright grass-tuft overhang on the grass side so dirt sits IN the grass. */
function bakeAutotiledTerrain(p: CanvasRenderingContext2D): void {
  const W = MAP_PX;
  const img = p.getImageData(0, 0, W, W);
  const d = img.data;
  for (let py = 0; py < W; py++) {
    const wz = py / PPM - MAP_HALF;
    for (let px = 0; px < W; px++) {
      const wx = px / PPM - MAP_HALF;
      const cov = terrainCoverage(wx, wz);
      if (!cov || cov.solid <= 0) continue;
      const th = (BAYER4[py & 3][px & 3] + 0.5) / 16;
      const i = (py * W + px) * 4;
      if (cov.solid > th) {
        const c = pickColor(cov.kind, phash(px, py), cov.solid);
        d[i] = c[0];
        d[i + 1] = c[1];
        d[i + 2] = c[2];
      } else if (cov.solid > 0.3 && phash(px + 9, py + 5) > 0.9) {
        // bright grass-tuft overhang peeking through the dithered edge
        d[i] = C_TUFT[0];
        d[i + 1] = C_TUFT[1];
        d[i + 2] = C_TUFT[2];
      }
    }
  }
  p.putImageData(img, 0, 0);
}

/** Chunky 2 px pebble accents scattered along the path spine (over the dither). */
function bakePathPebbles(p: CanvasRenderingContext2D, rnd: () => number): void {
  for (let i = 0; i < DEFAULT_PATH_PTS.length - 1; i++) {
    const a = DEFAULT_PATH_PTS[i], b = DEFAULT_PATH_PTS[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.floor((len * PPM) / 6);
    for (let k = 0; k < n; k++) {
      if (rnd() > 0.5) continue;
      const t = k / n;
      const wx = a[0] + (b[0] - a[0]) * t + (rnd() - 0.5) * PATH_CORE * 1.5;
      const wz = a[1] + (b[1] - a[1]) * t + (rnd() - 0.5) * PATH_CORE * 1.5;
      if (pathDist(wx, wz) > PATH_CORE) continue; // keep pebbles on the dirt
      const x = Math.floor(worldToMap(wx)), y = Math.floor(worldToMap(wz));
      p.fillStyle = PATH.peb;
      p.fillRect(x, y, 2, 2);
      p.fillStyle = PATH.pebl;
      p.fillRect(x, y, 1, 1);
    }
  }
}

function bakePondBody(p: CanvasRenderingContext2D, rnd: () => number): void {
  const cx = worldToMap(POND.cx), cy = worldToMap(POND.cz), r = POND.r * PPM;
  const water = (rr: number, c: string) => {
    p.fillStyle = c;
    p.beginPath();
    p.ellipse(cx, cy, rr, rr, 0, 0, 7);
    p.fill();
  };
  water(r, POND_COL.deep);
  water(r - 3, POND_COL.base);
  water(r - 8, POND_COL.lt);
  // baked ripples (dynamic shimmer added per-frame over this)
  p.strokeStyle = POND_COL.ltr;
  p.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const yy = cy - r * 0.5 + rnd() * r;
    p.beginPath();
    p.moveTo(cx - r * 0.6, yy);
    p.quadraticCurveTo(cx, yy - 3, cx + r * 0.6, yy);
    p.stroke();
  }
}

function seeded(s: number): () => number {
  let seed = s;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

/** True if (x,z) is a legal spot inside the walkable world (edge clamp). */
export function inWorld(x: number, z: number): boolean {
  return Math.abs(x) <= EDGE && Math.abs(z) <= EDGE;
}

export { isInField, MAP_PX };
