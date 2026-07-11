// ---------------------------------------------------------------------------
// Targeting — PURE tile targeting + tile-state derivation, shared by the render
// core (render2d) and the action pipeline. Extracted from farm/field.ts (whose
// Field3D visuals are retired in the 2D conversion) so nothing pure has to pull
// a THREE module. Semantics are byte-identical to the originals.
// ---------------------------------------------------------------------------

import { GRID, tileCenter, worldToTile } from "./grid";
import { CROPS, growthStage, needsWater, effectiveCrop, type GrowthTile } from "./growth";
import type { TileRecord } from "./store";
import type { TileState } from "./action";

const REACH = 2.2; // m, max action distance
const FACING_COS_MIN = 0.35; // ~70° half-angle in front of the player

function toGrowthTile(rec: TileRecord): GrowthTile | null {
  if (rec.crop == null) return null;
  return {
    plantedAt: rec.plantedAt ?? 0,
    accruedMs: rec.accruedMs ?? 0,
    lastWatered: rec.lastWatered ?? rec.plantedAt ?? 0,
  };
}

/** Facing-aware tile targeting (Bistro lesson: distance-only picks the wrong
 * corner-adjacent tile). Only tiles within REACH *and* roughly in front of the
 * player are candidates; among those, prefer the most aligned, then closest. */
export function findTargetTile(px: number, pz: number, heading: number): { gx: number; gz: number } | null {
  const fwd = { x: Math.sin(heading), z: Math.cos(heading) };
  const aimX = px + fwd.x * (REACH * 0.55);
  const aimZ = pz + fwd.z * (REACH * 0.55);
  const near = worldToTile(aimX, aimZ);

  let best: { gx: number; gz: number } | null = null;
  let bestScore = -Infinity;
  const candidates: { gx: number; gz: number }[] = [];
  if (near) {
    for (const gx of [near.gx - 1, near.gx, near.gx + 1]) for (const gz of [near.gz - 1, near.gz, near.gz + 1]) candidates.push({ gx, gz });
  } else {
    for (let gx = 0; gx < GRID; gx++) for (let gz = 0; gz < GRID; gz++) candidates.push({ gx, gz });
  }

  for (const { gx, gz } of candidates) {
    if (gx < 0 || gx >= GRID || gz < 0 || gz >= GRID) continue;
    const { x, z } = tileCenter(gx, gz);
    const dx = x - px;
    const dz = z - pz;
    const dist = Math.hypot(dx, dz);
    if (dist > REACH) continue;
    const dirx = dist > 1e-4 ? dx / dist : fwd.x;
    const dirz = dist > 1e-4 ? dz / dist : fwd.z;
    const align = dirx * fwd.x + dirz * fwd.z;
    if (dist > 0.15 && align < FACING_COS_MIN) continue;
    const score = align - dist * 0.06;
    if (score > bestScore) {
      bestScore = score;
      best = { gx, gz };
    }
  }
  return best;
}

/** Derive a tile's gameplay-facing TileState from its stored record + the clock. */
export function computeTileState(rec: TileRecord | undefined, now: number): TileState {
  if (!rec) return "untouched";
  if (!rec.crop) return "tilled";
  const gTile = toGrowthTile(rec)!;
  const crop = effectiveCrop(CROPS[rec.crop]);
  const stage = growthStage(gTile, crop, now);
  if (stage === "ready") return "ready";
  if (needsWater(gTile, crop, now)) return "thirsty";
  return "growing";
}
