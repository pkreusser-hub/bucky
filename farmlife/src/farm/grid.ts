import { FIELD } from "../world/terrain";

// 12x12 grid of 2m tiles filling the fenced field exactly (FIELD.half*2 = 24m).

export const GRID = 12;
export const TILE_SIZE = (FIELD.half * 2) / GRID; // 2m

const ORIGIN_X = FIELD.cx - FIELD.half;
const ORIGIN_Z = FIELD.cz - FIELD.half;

export function tileKey(gx: number, gz: number): string {
  return `t_${gx}_${gz}`;
}

export function parseTileKey(key: string): { gx: number; gz: number } | null {
  const m = /^t_(-?\d+)_(-?\d+)$/.exec(key);
  if (!m) return null;
  return { gx: parseInt(m[1], 10), gz: parseInt(m[2], 10) };
}

export function tileCenter(gx: number, gz: number): { x: number; z: number } {
  return {
    x: ORIGIN_X + TILE_SIZE * (gx + 0.5),
    z: ORIGIN_Z + TILE_SIZE * (gz + 0.5),
  };
}

/** World (x,z) -> grid coords, or null if outside the 12x12 field. */
export function worldToTile(x: number, z: number): { gx: number; gz: number } | null {
  const gx = Math.floor((x - ORIGIN_X) / TILE_SIZE);
  const gz = Math.floor((z - ORIGIN_Z) / TILE_SIZE);
  if (gx < 0 || gx >= GRID || gz < 0 || gz >= GRID) return null;
  return { gx, gz };
}

export function forEachTile(fn: (gx: number, gz: number) => void): void {
  for (let gx = 0; gx < GRID; gx++) {
    for (let gz = 0; gz < GRID; gz++) fn(gx, gz);
  }
}
