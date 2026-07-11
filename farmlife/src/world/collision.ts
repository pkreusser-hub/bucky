import { EDGE } from "./terrainConst";

// Simple circle-vs-obstacle pushback. Nothing fancy (plan: "circle-vs-obstacle
// pushback is fine"). Obstacles: circles (pond, rocks, trees), AABBs (house),
// and thin segments (fence rails). The player is a circle of radius PLAYER_R.

export const PLAYER_R = 0.55;

// Each obstacle carries a stable handle id (`hid`) and an optional `tag` so a
// dynamic layer (the editor-placed props/fences, tagged "world") can be RETRACTED
// and rebuilt without leaving stale colliders behind — the P2 known limitation
// (a removed barn used to leave an invisible wall). Permanent scenery adds with
// no tag and is never retracted.
interface Base { hid: number; tag?: string }
interface CircleObs extends Base { kind: "circle"; x: number; z: number; r: number }
interface BoxObs extends Base { kind: "box"; minX: number; maxX: number; minZ: number; maxZ: number }
interface SegObs extends Base { kind: "seg"; x1: number; z1: number; x2: number; z2: number; r: number }
type Obstacle = CircleObs | BoxObs | SegObs;

const obstacles: Obstacle[] = [];
let nextHid = 1;

export function clearObstacles(): void {
  obstacles.length = 0;
}
export function obstacleCount(): number {
  return obstacles.length;
}
/** Retract a single obstacle by its handle. */
export function removeObstacle(hid: number): void {
  const i = obstacles.findIndex((o) => o.hid === hid);
  if (i >= 0) obstacles.splice(i, 1);
}
/** Retract every obstacle registered under `tag` (clean rebuild of a layer). */
export function removeByTag(tag: string): void {
  for (let i = obstacles.length - 1; i >= 0; i--) if (obstacles[i].tag === tag) obstacles.splice(i, 1);
}
export function addCircle(x: number, z: number, r: number, tag?: string): number {
  const hid = nextHid++;
  obstacles.push({ kind: "circle", x, z, r, hid, tag });
  return hid;
}
export function addBox(cx: number, cz: number, halfX: number, halfZ: number, tag?: string): number {
  const hid = nextHid++;
  obstacles.push({ kind: "box", minX: cx - halfX, maxX: cx + halfX, minZ: cz - halfZ, maxZ: cz + halfZ, hid, tag });
  return hid;
}
export function addSegment(x1: number, z1: number, x2: number, z2: number, r = 0.25, tag?: string): number {
  const hid = nextHid++;
  obstacles.push({ kind: "seg", x1, z1, x2, z2, r, hid, tag });
  return hid;
}

/**
 * PURE-ish boolean: would a footprint of radius `r` centered at (x,z) overlap
 * any registered obstacle (circle/box/segment)? Unlike resolveCollision this
 * moves nothing — used by decoration placement to refuse dropping an ornament
 * on top of a barn / tree / rock. Ignores the map edge (placement clamps that
 * separately).
 */
export function wouldCollide(x: number, z: number, r: number): boolean {
  for (const o of obstacles) {
    if (o.kind === "circle") {
      if (Math.hypot(x - o.x, z - o.z) < o.r + r) return true;
    } else if (o.kind === "box") {
      const cx = Math.max(o.minX, Math.min(o.maxX, x));
      const cz = Math.max(o.minZ, Math.min(o.maxZ, z));
      if (Math.hypot(x - cx, z - cz) < r) return true;
    } else {
      const c = closestOnSeg(x, z, o.x1, o.z1, o.x2, o.z2);
      if (c.d < o.r + r) return true;
    }
  }
  return false;
}

// closest point on segment (a->b) to p, returns {x,z,d}
function closestOnSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz || 1e-6;
  let t = ((px - ax) * abx + (pz - az) * abz) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t, cz = az + abz * t;
  return { x: cx, z: cz, d: Math.hypot(px - cx, pz - cz) };
}

/**
 * Resolve a desired position (dx,dz) against all obstacles + the map edge.
 * Returns a corrected {x,z} the player is allowed to occupy.
 */
export function resolveCollision(dx: number, dz: number): { x: number; z: number } {
  let x = dx, z = dz;

  // map edge clamp
  x = Math.max(-EDGE, Math.min(EDGE, x));
  z = Math.max(-EDGE, Math.min(EDGE, z));

  // two relaxation passes so overlapping obstacles settle
  for (let pass = 0; pass < 2; pass++) {
    for (const o of obstacles) {
      if (o.kind === "circle") {
        const d = Math.hypot(x - o.x, z - o.z);
        const rr = o.r + PLAYER_R;
        if (d < rr) {
          const nx = d > 1e-4 ? (x - o.x) / d : 1;
          const nz = d > 1e-4 ? (z - o.z) / d : 0;
          x = o.x + nx * rr;
          z = o.z + nz * rr;
        }
      } else if (o.kind === "box") {
        // expand box by PLAYER_R, push to nearest edge if inside
        const minX = o.minX - PLAYER_R, maxX = o.maxX + PLAYER_R;
        const minZ = o.minZ - PLAYER_R, maxZ = o.maxZ + PLAYER_R;
        if (x > minX && x < maxX && z > minZ && z < maxZ) {
          const dL = x - minX, dR = maxX - x, dT = z - minZ, dB = maxZ - z;
          const m = Math.min(dL, dR, dT, dB);
          if (m === dL) x = minX;
          else if (m === dR) x = maxX;
          else if (m === dT) z = minZ;
          else z = maxZ;
        }
      } else {
        const c = closestOnSeg(x, z, o.x1, o.z1, o.x2, o.z2);
        const rr = o.r + PLAYER_R;
        if (c.d < rr) {
          const nx = c.d > 1e-4 ? (x - c.x) / c.d : 1;
          const nz = c.d > 1e-4 ? (z - c.z) / c.d : 0;
          x = c.x + nx * rr;
          z = c.z + nz * rr;
        }
      }
    }
  }

  x = Math.max(-EDGE, Math.min(EDGE, x));
  z = Math.max(-EDGE, Math.min(EDGE, z));
  return { x, z };
}
