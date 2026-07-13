// ---------------------------------------------------------------------------
// plots.ts — the FREE-FORM farming model (R5). PURE (no THREE, no DOM) so it
// unit-tests cheaply, same posture as sync.ts / pasture.ts.
//
// The grid is GONE. Farming is now continuous:
//   Plant       — a crop growing at a continuous world point. The growth MATH is
//                 reused verbatim from growth.ts (a Plant IS a GrowthTile plus an
//                 id, world coords, crop and a waterings counter), so every
//                 growth.test.ts semantic still holds unchanged.
//   TilledPatch — an organic soil circle the hoe digs. Overlapping patches merge
//                 into a blob (both visually, and logically via patchCoverageAt).
//
// This module owns: the tunable constants, id generation, the spacing check, the
// patch coverage/merge math, the "is this grass tillable?" geometry, the building
// solid-footprints, and the one-time tile→free-form MIGRATION transform.
// ---------------------------------------------------------------------------

import { CROP_ORDER, type CropId, type GrowthTile } from "./growth";
import { tileCenter, parseTileKey } from "./grid";
import { POND, EDGE, DEFAULT_PATH_PTS, isInField } from "../world/terrainConst";
import { PASTURE, pointInRect } from "./pasture";
// type-only (erased) — avoids a runtime plots<->store cycle (store imports Plant).
import type { TileRecord } from "./store";

// ---- tunables ---------------------------------------------------------------
/** Radius (m) of a fresh hoe-dug patch. */
export const PATCH_RADIUS = 0.9;
/** Re-tilling within a patch grows it by this much, up to PATCH_MAX_R. */
export const PATCH_GROW_STEP = 0.35;
export const PATCH_MAX_R = 1.8;
/** Minimum distance (m) a new plant must keep from every existing plant. */
export const PLANT_MIN_SPACING = 0.7;
/** A watering-can splash also credits any plant within this radius of the one
 * you aimed at — makes watering a cluster pleasant. NOTE: set ABOVE
 * PLANT_MIN_SPACING (the spec's 0.6 would sit BELOW the 0.7 min spacing, making
 * the splash inert — no legally-placed neighbour is ever within 0.6 m), so an
 * immediately-adjacent (min-spaced) plant IS credited. */
export const SPLASH_RADIUS = 1.0;
/** Generous cap so a kid can't till the whole map solid (friendly toast at cap). */
export const PLANT_CAP = 400;
export const PATCH_CAP = 600;

// ---- records ----------------------------------------------------------------
export interface Plant {
  id: string;
  x: number;
  z: number;
  crop: CropId;
  plantedAt: number;
  accruedMs: number;
  lastWatered: number;
  waterings: number;
}
export interface TilledPatch {
  id: string;
  x: number;
  z: number;
  r: number;
}

/** A Plant reduced to the growth.ts GrowthTile shape (the pure math's input). */
export function growthTileOf(p: Plant): GrowthTile {
  return { plantedAt: p.plantedAt, accruedMs: p.accruedMs, lastWatered: p.lastWatered };
}

// ---- id generation (client-assigned, collision-unlikely — decor convention) --
export function newPlantId(): string {
  return `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
export function newPatchId(): string {
  return `tp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// ---- spacing ----------------------------------------------------------------
/** PURE. True if a new plant at (x,z) keeps PLANT_MIN_SPACING from every other
 * plant (ignoreId lets a moved/self plant be excluded). */
export function spacingOk(plants: Record<string, Plant>, x: number, z: number, ignoreId?: string): boolean {
  for (const p of Object.values(plants)) {
    if (p.id === ignoreId) continue;
    if (Math.hypot(p.x - x, p.z - z) < PLANT_MIN_SPACING) return false;
  }
  return true;
}

// ---- patch coverage / merge -------------------------------------------------
/** PURE. 0..1 soil coverage at a world point (the blob auto-tiler's field): 1
 * inside any patch core, feathering to 0 across a small band, taking the MAX over
 * all patches so overlapping circles read as one merged blob. */
const PATCH_FEATHER = 0.35;
export function patchCoverageAt(patches: Record<string, TilledPatch>, x: number, z: number): number {
  let best = 0;
  for (const p of Object.values(patches)) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d >= p.r) continue;
    const cov = d <= p.r - PATCH_FEATHER ? 1 : (p.r - d) / PATCH_FEATHER;
    if (cov > best) best = cov;
    if (best >= 1) return 1;
  }
  return best;
}
/** True if (x,z) is on tilled ground (any patch covers it) — planting gate. */
export function isTilledAt(patches: Record<string, TilledPatch>, x: number, z: number): boolean {
  return patchCoverageAt(patches, x, z) > 0.001;
}
/** The patch whose CENTRE is nearest (x,z) within `maxDist`, or null — used so a
 * hoe press on an existing patch EXTENDS it instead of stacking a new circle. */
export function nearestPatch(patches: Record<string, TilledPatch>, x: number, z: number, maxDist: number): TilledPatch | null {
  let best: TilledPatch | null = null;
  let bestD = maxDist;
  for (const p of Object.values(patches)) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

// ---- solid building footprints (Stardew rule — R5) --------------------------
// Each building's collider expands to its full visual BASE footprint so a player
// can never walk BEHIND (north of) it and vanish. Widths follow the billboards;
// depth fills the band north of the base up to the visual back. The south
// (camera-facing / door) side is kept clear so the door approach + ⏎ prompt and
// the shop/sell proximity radii stay reachable. The BARN is deliberately NOT here
// (its cutaway + door-gap + pasture routing are kept exactly).
export interface BuildingBox {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export const BUILDINGS: BuildingBox[] = [
  // farmhouse (24,20), 13 m billboard; door faces south (z 24 mat). Base z=20.
  { id: "farmhouse", minX: 18, maxX: 30, minZ: 14.5, maxZ: 20.5 },
  // silo (46.5,9), ~4.7 m billboard base, cylinder in the pasture.
  { id: "silo", minX: 44.1, maxX: 48.9, minZ: 5.5, maxZ: 9.5 },
  // shipping bin (8.6,6) — the crate + its "behind" band. Kept clear of the
  // adjacent field gate (x 6, z 4.5-7.5): west edge east of the gate, and the
  // south gate lane (z > 6) left open, so the gate stays walkable.
  { id: "bin", minX: 7.3, maxX: 9.9, minZ: 4.3, maxZ: 6.0 },
  // seed stand (14,13), ~3.9 m; shop opens by proximity from the south.
  { id: "stand", minX: 12, maxX: 16, minZ: 10.5, maxZ: 13.5 },
];
/** True if (x,z) (with optional margin) lies inside any solid building footprint. */
export function inBuilding(x: number, z: number, margin = 0): boolean {
  for (const b of BUILDINGS) {
    if (x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin) return true;
  }
  return false;
}

// ---- tillable geometry ------------------------------------------------------
const PATH_NEAR = 2.0; // m from a default-path spine counts as "on the path"
function onDefaultPath(x: number, z: number): boolean {
  let best = Infinity;
  for (let i = 0; i < DEFAULT_PATH_PTS.length - 1; i++) {
    const a = DEFAULT_PATH_PTS[i];
    const b = DEFAULT_PATH_PTS[i + 1];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const len2 = abx * abx + abz * abz || 1e-6;
    let t = ((x - a[0]) * abx + (z - a[1]) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t));
    if (d < best) best = d;
  }
  return best < PATH_NEAR;
}

/** PURE. Can the hoe till at (x,z)? Grass only: inside the walkable valley, not
 * the pond, not a dirt path (except inside the fenced field, which is grass now
 * and fully tillable), not the pasture interior, not a building footprint. */
export function tillableAt(x: number, z: number): boolean {
  if (Math.abs(x) > EDGE - 0.5 || Math.abs(z) > EDGE - 0.5) return false;
  if (Math.hypot(x - POND.cx, z - POND.cz) < POND.r + 1.5) return false;
  if (pointInRect(x, z, PASTURE, -0.5)) return false; // pasture interior (herd area)
  if (inBuilding(x, z, 0.2)) return false;
  if (!isInField(x, z) && onDefaultPath(x, z)) return false;
  return true;
}

// ---- one-time tile → free-form MIGRATION ------------------------------------
// Every legacy `t_<gx>_<gz>` tile becomes a TilledPatch at the tile centre; a
// PLANTED tile also becomes a Plant there. IDs are DETERMINISTIC from the tile
// coords (`tp_mig_<gx>_<gz>` / `p_mig_<gx>_<gz>`) so two devices (or a re-run)
// converge to the SAME fields — the anti-duplication guarantee (this repo's
// signature incident class). Pure; callers persist + clear the t_ fields.
export function migrateTilesToFreeform(tiles: Record<string, TileRecord>): {
  plants: Record<string, Plant>;
  patches: Record<string, TilledPatch>;
} {
  const plants: Record<string, Plant> = {};
  const patches: Record<string, TilledPatch> = {};
  for (const [key, rec] of Object.entries(tiles)) {
    const p = parseTileKey(key);
    if (!p) continue;
    const { x, z } = tileCenter(p.gx, p.gz);
    const patchId = `tp_mig_${p.gx}_${p.gz}`;
    patches[patchId] = { id: patchId, x, z, r: PATCH_RADIUS };
    if (rec && rec.crop && (CROP_ORDER as string[]).includes(rec.crop)) {
      const plantId = `p_mig_${p.gx}_${p.gz}`;
      plants[plantId] = {
        id: plantId,
        x,
        z,
        crop: rec.crop,
        plantedAt: rec.plantedAt ?? 0,
        accruedMs: rec.accruedMs ?? 0,
        lastWatered: rec.lastWatered ?? rec.plantedAt ?? 0,
        waterings: 0,
      };
    }
  }
  return { plants, patches };
}
