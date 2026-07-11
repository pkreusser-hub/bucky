// ---------------------------------------------------------------------------
// terrainConst — the THREE-FREE half of terrain.ts.
//
// Everything the 2D render core needs from the terrain layer (map extents, the
// field/pond rects, the default path spine, and the PURE sampleHeight/pathBlend
// math) lives here with NO `three` import, so the 2D bundle (coords → this,
// world2d → this, collision → this, grid → this, main → this) never drags a
// THREE module into its graph. terrain.ts (the 3D mesh builder) `export *`s from
// here so every legacy 3D importer keeps working unchanged, and the single
// height authority is preserved (Farm Kart Stage-A lesson: never two height
// functions — sampleHeight lives here, terrain.ts re-exports the same symbol).
//
// The R2 conversion had the 2D layer import these constants from terrain.ts,
// which carries `import * as THREE`; Rollup tree-shook THREE out of the OUTPUT
// but the module still sat in the graph. This split makes the THREE-free
// guarantee STRUCTURAL rather than tree-shaking-dependent.
// ---------------------------------------------------------------------------

import { sampleField, type WorldData } from "./worldData";

export const MAP_HALF = 60; // valley spans [-60, 60] on both axes (~120 m)
export const EDGE = MAP_HALF - 1.5; // player clamp / wall

// Flat farming field (future plot) — kept flat & dirt-tinted, visually distinct.
export const FIELD = { cx: -6, cz: 6, half: 12, y: 0.15 }; // 24×24 m

// Pond — a dip filled with translucent water.
export const POND = { cx: 30, cz: -26, r: 10, waterY: -1.15 };

// ---------------------------------------------------------------------------
// Default valley PATHS — dirt walkways (house <-> field gate <-> pond) baked
// straight into the ground COLOR (see terrain.ts buildGroundMesh). These are
// ALWAYS present and are NOT worldData.paint, so the editor's "clear paint"
// can't erase them and the user paints OVER them. Heights are unchanged — only
// vertex colors. In 2D these same points also drive rain puddle glints.
// ---------------------------------------------------------------------------
export const DEFAULT_PATH_PTS: Array<[number, number]> = [
  [24, 20], // farmhouse
  [16, 14],
  [FIELD.cx + FIELD.half + 1.5, FIELD.cz], // east field gate (matches fence gap)
  [FIELD.cx, FIELD.cz], // into the plot
  [16, -6],
  [POND.cx - 2, POND.cz + POND.r + 1], // pond edge
];
const PATH_CORE = 2.0; // full-dirt half-width (m)
const PATH_FEATHER = 1.8; // feather distance beyond the core (soft grass blend)

const AMP = 1.9; // mild hill amplitude (m)

// ---------------------------------------------------------------------------
// World-editor overlay (P1.5b). The active WorldData's sculpt heightfield is
// added to the base hills EVERYWHERE except inside the farming field (+margin).
// When no world is active (or its cells are empty) sampleField returns 0, so
// sampleHeight is BYTE-IDENTICAL to the handcrafted valley.
// ---------------------------------------------------------------------------
let activeWorld: WorldData | null = null;
let terrainActive = false; // any sculpt cells?
let paintActive = false; // any paint cells?

/** The margin (m) beyond the field rect within which sculpt deltas are ignored
 * so the plot edge stays flat. Also used by the editor to refuse brushes. */
export const PROTECT_MARGIN = 1.5;

export function setActiveWorld(w: WorldData | null): void {
  activeWorld = w;
  refreshWorldFlags();
}
export function getActiveWorld(): WorldData | null {
  return activeWorld;
}
/** True if the active world has any paint cells (terrain.ts's mesh builder). */
export function isPaintActive(): boolean {
  return paintActive;
}
/** Recompute the has-cells flags after the editor mutates the active world. */
export function refreshWorldFlags(): void {
  terrainActive = !!(activeWorld && Object.keys(activeWorld.terrain.cells).length);
  paintActive = !!(activeWorld && Object.keys(activeWorld.paint.cells).length);
}

/** True inside the flat farming plot (+PROTECT_MARGIN) — sculpt/paint no-op here. */
export function fieldProtected(x: number, z: number): boolean {
  return (
    Math.abs(x - FIELD.cx) <= FIELD.half + PROTECT_MARGIN &&
    Math.abs(z - FIELD.cz) <= FIELD.half + PROTECT_MARGIN
  );
}

function baseHills(x: number, z: number): number {
  return (
    AMP * Math.sin(x * 0.045 + 0.5) * Math.cos(z * 0.05) +
    AMP * 0.5 * Math.sin(x * 0.09 - z * 0.06) +
    AMP * 0.35 * Math.cos(z * 0.13 + 1.3)
  );
}

// Smoothstep 0..1
function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Distance from (px,pz) to segment (ax,az)->(bx,bz) in the XZ plane.
function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** PURE. Default-path influence 0..1 at world (x,z): 1 on the walkway spine,
 * feathering to 0 at PATH_CORE+PATH_FEATHER. Always 0 inside the farming plot
 * (its own dirt look wins). */
export function pathBlend(x: number, z: number): number {
  if (fieldProtected(x, z)) return 0;
  let best = Infinity;
  for (let i = 0; i < DEFAULT_PATH_PTS.length - 1; i++) {
    const a = DEFAULT_PATH_PTS[i], b = DEFAULT_PATH_PTS[i + 1];
    const d = distToSeg(x, z, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
    if (best <= 0) break;
  }
  return 1 - smooth(PATH_CORE, PATH_CORE + PATH_FEATHER, best);
}

/** PURE terrain height at world (x,z). Single source of truth. */
export function sampleHeight(x: number, z: number): number {
  let h = baseHills(x, z);

  // World-editor sculpt delta (ignored in/near the flat farming field).
  if (terrainActive && !fieldProtected(x, z)) {
    h += sampleField(activeWorld!.terrain, x, z);
  }

  // Flatten the field: blend toward FIELD.y inside the plot, feather the border.
  const dxF = Math.abs(x - FIELD.cx);
  const dzF = Math.abs(z - FIELD.cz);
  const inField = Math.max(dxF, dzF);
  const fBlend = 1 - smooth(FIELD.half, FIELD.half + 6, inField);
  h = h * (1 - fBlend) + FIELD.y * fBlend;

  // Pond dip: carve a bowl toward the water floor.
  const dP = Math.hypot(x - POND.cx, z - POND.cz);
  if (dP < POND.r + 8) {
    const bowl = 1 - smooth(POND.r - 2, POND.r + 8, dP);
    const floor = POND.waterY - 0.6;
    h = h * (1 - bowl) + floor * bowl;
  }

  return h;
}

export function isInField(x: number, z: number): boolean {
  return Math.abs(x - FIELD.cx) <= FIELD.half && Math.abs(z - FIELD.cz) <= FIELD.half;
}

export function isOverPond(x: number, z: number): boolean {
  return Math.hypot(x - POND.cx, z - POND.cz) < POND.r;
}
