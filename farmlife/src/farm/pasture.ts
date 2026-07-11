// ---------------------------------------------------------------------------
// Pasture + barn geometry + husbandry model — PURE (no THREE, no DOM) so it
// unit-tests cheaply, mirroring worldData.ts / sync.ts conventions. The 3D
// visuals (world/barn3d.ts) and the wander state machine (world/animals3d.ts)
// consume these numbers; the game (main.ts) drives phase from the SHARED clock
// so every device agrees on the day/night routine.
//
// LAYOUT (world units, +X east, +Z toward the farmhouse):
//   PASTURE = a 30×22 fenced rectangle east of the field, enclosing the barn.
//   BARN    = a shell in the north half; its DOOR is a gap in the south wall
//             (facing the open grazing area). GATE = a gap in the WEST fence
//             the PLAYER walks through but animals treat as solid boundary.
// Animals are contained to the pasture polygon and may only cross the barn's
// south wall through the DOOR, and only while the door is OPEN.
// ---------------------------------------------------------------------------

import { STARTER_HERD, hashSeed, mulberry32 } from "./animals";
import { centralHour } from "../world/daynight";

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The fenced pasture rectangle (30 × 22 m). */
export const PASTURE: Rect = { minX: 22, maxX: 52, minZ: -8, maxZ: 14 };

/** Barn shell footprint (north half of the pasture). */
export const BARN: Rect = { minX: 33, maxX: 42, minZ: 6, maxZ: 13 };
export const BARN_WALL = 0.3; // wall thickness (visual + collider)
export const BARN_HEIGHT = 4.6;

/** Door opening in the barn's SOUTH wall (z = BARN.minZ), facing the open
 * grazing area. The player always passes; animals only when the door is open. */
export const DOOR = { x0: 36.4, x1: 39.6, z: BARN.minZ };
export const DOOR_CENTER = { x: (DOOR.x0 + DOOR.x1) / 2, z: DOOR.z };
export const DOOR_WIDTH = DOOR.x1 - DOOR.x0;

/** A spot just OUTSIDE the door (where animals settle when the door is shut). */
export const DOOR_OUTSIDE = { x: DOOR_CENTER.x, z: BARN.minZ - 1.4 };
/** A spot just INSIDE the door threshold. */
export const DOOR_INSIDE = { x: DOOR_CENTER.x, z: BARN.minZ + 1.4 };

/** Decorative silo beside the barn (animals steer around it). */
export const SILO = { x: 46.5, z: 9, r: 1.7 };

/** Player gate: a gap in the WEST fence (x = PASTURE.minX). Solid for animals
 * (it is part of the pasture boundary), a free walk-through for the player. */
export const GATE = { x: PASTURE.minX, z0: 1.4, z1: 4.6 };
export const GATE_CENTER = { x: PASTURE.minX, z: (GATE.z0 + GATE.z1) / 2 };

export const FARM_NAME_UNUSED = 0; // (placeholder, keeps tree-shakers honest)

// ---- day/night routine phase ------------------------------------------------

export type DayPhase = "day" | "dusk" | "night" | "dawn";

/** PURE. Derive the husbandry phase from America/Chicago wall-clock hour so all
 * devices agree (same clock source as day/night lighting). Boundaries chosen to
 * sit near daynight.ts's DAWN/DAY/DUSK/NIGHT keyframes:
 *   dawn 06:00–08:00 · day 08:00–18:30 · dusk 18:30–20:30 · night otherwise. */
export function dayPhase(ms: number): DayPhase {
  const h = centralHour(ms);
  if (h >= 6 && h < 8) return "dawn";
  if (h >= 8 && h < 18.5) return "day";
  if (h >= 18.5 && h < 20.5) return "dusk";
  return "night";
}

// ---- geometry helpers -------------------------------------------------------

export function pointInRect(x: number, z: number, r: Rect, inset = 0): boolean {
  return x > r.minX + inset && x < r.maxX - inset && z > r.minZ + inset && z < r.maxZ - inset;
}

/** True when (x,z) lies within the barn's interior floor (inside all 4 walls). */
export function insideBarn(x: number, z: number): boolean {
  return pointInRect(x, z, BARN, BARN_WALL);
}

interface Seg {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  r: number; // pushback half-thickness
}

/** The barn's wall segments for animal containment. The south wall is split
 * around the door; when the door is CLOSED an extra segment seals the gap. */
export function barnWalls(doorOpen: boolean): Seg[] {
  const t = BARN_WALL * 0.5 + 0.05;
  const { minX, maxX, minZ, maxZ } = BARN;
  const segs: Seg[] = [
    { x1: minX, z1: maxZ, x2: maxX, z2: maxZ, r: t }, // north
    { x1: minX, z1: minZ, x2: minX, z2: maxZ, r: t }, // west
    { x1: maxX, z1: minZ, x2: maxX, z2: maxZ, r: t }, // east
    { x1: minX, z1: minZ, x2: DOOR.x0, z2: minZ, r: t }, // south (left of door)
    { x1: DOOR.x1, z1: minZ, x2: maxX, z2: minZ, r: t }, // south (right of door)
  ];
  if (!doorOpen) segs.push({ x1: DOOR.x0, z1: minZ, x2: DOOR.x1, z2: minZ, r: t }); // sealed door
  return segs;
}

function closestOnSeg(px: number, pz: number, s: Seg): { x: number; z: number; d: number } {
  const abx = s.x2 - s.x1, abz = s.z2 - s.z1;
  const len2 = abx * abx + abz * abz || 1e-6;
  let t = ((px - s.x1) * abx + (pz - s.z1) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = s.x1 + abx * t, cz = s.z1 + abz * t;
  return { x: cx, z: cz, d: Math.hypot(px - cx, pz - cz) };
}

/**
 * PURE. Clamp an animal of radius `r` to the pasture and push it out of the
 * barn walls (door gap conditional) + silo. Two relaxation passes so a corner
 * settles. This is the CONTAINMENT rule: the door is the only barn↔pasture
 * passage, the gate/fence is solid, animals never cross the fence.
 */
export function containAnimal(x: number, z: number, r: number, doorOpen: boolean): { x: number; z: number } {
  let ax = x, az = z;
  const walls = barnWalls(doorOpen);
  for (let pass = 0; pass < 2; pass++) {
    // pasture bounds
    ax = Math.max(PASTURE.minX + r, Math.min(PASTURE.maxX - r, ax));
    az = Math.max(PASTURE.minZ + r, Math.min(PASTURE.maxZ - r, az));
    // barn walls
    for (const s of walls) {
      const c = closestOnSeg(ax, az, s);
      const rr = s.r + r;
      if (c.d < rr) {
        const nx = c.d > 1e-4 ? (ax - c.x) / c.d : 1;
        const nz = c.d > 1e-4 ? (az - c.z) / c.d : 0;
        ax = c.x + nx * rr;
        az = c.z + nz * rr;
      }
    }
    // silo
    const dS = Math.hypot(ax - SILO.x, az - SILO.z);
    const rr = SILO.r + r;
    if (dS < rr) {
      const nx = dS > 1e-4 ? (ax - SILO.x) / dS : 1;
      const nz = dS > 1e-4 ? (az - SILO.z) / dS : 0;
      ax = SILO.x + nx * rr;
      az = SILO.z + nz * rr;
    }
  }
  return { x: ax, z: az };
}

// ---- deterministic per-animal spots ----------------------------------------

/** A deterministic grazing waypoint in the OPEN pasture (outside the barn +
 * silo). Callers pass a PRNG so a device's wander is stable per animal id.
 * BIASED to the big open area SOUTH of the barn (~78% of picks) so the herd
 * mostly grazes where the dusk walk to the door is a clean straight shot — the
 * barn hugs the north fence, so northern/side strips are narrow. */
export function grazeSpot(rng: () => number): { x: number; z: number } {
  for (let i = 0; i < 14; i++) {
    const south = rng() < 0.78;
    const x = PASTURE.minX + 1.5 + rng() * (PASTURE.maxX - PASTURE.minX - 3);
    const z = south
      ? PASTURE.minZ + 1.5 + rng() * (BARN.minZ - 1.5 - (PASTURE.minZ + 1.5))
      : PASTURE.minZ + 1.5 + rng() * (PASTURE.maxZ - PASTURE.minZ - 3);
    // keep out of the barn shell (+1) and the silo (+1)
    if (x > BARN.minX - 1 && x < BARN.maxX + 1 && z > BARN.minZ - 1 && z < BARN.maxZ + 1) continue;
    if (Math.hypot(x - SILO.x, z - SILO.z) < SILO.r + 1.2) continue;
    return { x, z };
  }
  return { x: DOOR_OUTSIDE.x, z: DOOR_OUTSIDE.z - 3 };
}

/** PURE. Two-stage funnel toward the door so animals cross the barn's south
 * wall THROUGH the gap instead of pressing on a wall panel (no pathfinding
 * needed). Given the actor's position, its FINAL destination, and the door
 * state, returns the point to steer at next: the final target when on the same
 * side (or the door is shut), otherwise DOOR_OUTSIDE to line up south of the
 * door, then DOOR_INSIDE to step through. */
export function funnelTarget(
  ax: number,
  az: number,
  final: { x: number; z: number },
  doorOpen: boolean
): { x: number; z: number } {
  const actorIn = insideBarn(ax, az);
  const finalIn = insideBarn(final.x, final.z);
  if (actorIn === finalIn) return final; // same side of the wall — go direct
  if (!doorOpen) return final; // can't cross; containment holds them, they settle
  const alignedX = Math.abs(ax - DOOR_CENTER.x) < DOOR_WIDTH / 2 - 0.12;
  if (actorIn && !finalIn) {
    // leaving: aligned → step straight out; else line up at the gap inside
    return alignedX ? DOOR_OUTSIDE : DOOR_INSIDE;
  }
  // entering: aligned in the door corridor → commit straight through the gap;
  // else line up directly south of the door first (no threshold oscillation).
  return alignedX ? DOOR_INSIDE : DOOR_OUTSIDE;
}

/** Deterministic sleep spot for an animal INSIDE the barn. */
export function barnSleepSpot(id: string): { x: number; z: number } {
  const rng = mulberry32(hashSeed(id) ^ 0x51ed270b);
  const ix0 = BARN.minX + BARN_WALL + 0.7, ix1 = BARN.maxX - BARN_WALL - 0.7;
  const iz0 = BARN.minZ + BARN_WALL + 1.2, iz1 = BARN.maxZ - BARN_WALL - 0.7;
  return { x: ix0 + rng() * (ix1 - ix0), z: iz0 + rng() * (iz1 - iz0) };
}

/** Deterministic settle spot just OUTSIDE the door (door-closed dusk/night). */
export function doorWaitSpot(id: string): { x: number; z: number } {
  const rng = mulberry32(hashSeed(id) ^ 0x2f6a11d3);
  return { x: DOOR_CENTER.x + (rng() - 0.5) * (DOOR_WIDTH + 2.2), z: BARN.minZ - 1.2 - rng() * 1.6 };
}

// ---- chicken nests / eggs (physical, shared) --------------------------------

/** Chicken ids in herd order (for deterministic nest layout). */
export const CHICKEN_IDS = STARTER_HERD.filter((s) => s.type === "chicken").map((s) => s.id);

/** Local X offsets (from the barn's centre) of the 3 straw nests baked into
 * the barn2.glb model, against the back (north) wall — see world/barn3d.ts's
 * preloadBarnModel for the placement math these must agree with. */
const NEST_LOCAL_X = [-2.6, 0, 2.6];

/** A fixed nest spot on the barn floor for a chicken (its egg materializes
 * here). Matches the GLB's baked nest positions exactly (local x -2.6/0/+2.6
 * from the barn centre, against the north interior wall) so eggs appear to
 * sit IN the model's nests whether the GLB or the procedural fallback barn
 * is showing. */
export function nestSpot(chickenId: string): { x: number; z: number } {
  const idx = CHICKEN_IDS.indexOf(chickenId);
  const cx = (BARN.minX + BARN.maxX) / 2;
  const i = idx < 0 ? 0 : Math.min(idx, NEST_LOCAL_X.length - 1);
  return { x: cx + NEST_LOCAL_X[i], z: BARN.maxZ - BARN_WALL - 1.0 };
}

/** Deterministic egg id for a chicken's current produce cycle. One cycle (one
 * `lastFed` checkpoint) yields exactly one egg id, so a re-spawn attempt writes
 * the SAME key (only-if-absent → never a duplicate egg). */
export function eggId(chickenId: string, lastFed: number): string {
  return `e_${chickenId}_${Math.round(lastFed)}`;
}

export interface EggRecord {
  id: string;
  chickenId: string;
  spawnedAt: number;
  x: number;
  z: number;
  collectedBy?: string; // set once collected (LWW winner keeps it)
  collectedAt?: number;
}

// ---- barn door (shared state) -----------------------------------------------

export interface DoorState {
  open: boolean;
  at: number; // ms of last change (for animation/ordering)
}

export function defaultDoorState(): DoorState {
  return { open: false, at: 0 };
}
