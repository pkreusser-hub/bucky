// ---------------------------------------------------------------------------
// Pure world<->map-canvas projection math for the Farm Map (P7). No THREE, no
// DOM — unit-tested in mapProjection.test.ts (same house convention as
// net/presenceUtil.ts / farm/action.ts: framework-free math gets its own
// tiny, cheaply-testable module).
//
// North-up, square canvas: world +X -> canvas right, world +Z -> canvas down
// (the farmkart.html #minimap convention, ported here).
// ---------------------------------------------------------------------------

export interface Proj {
  size: number; // canvas pixel size (square)
  half: number; // world half-extent mapped into the canvas (e.g. MAP_HALF)
  pad: number; // px inset on every edge
  scale: number; // px per world metre
}

/** Build a north-up square projection: world [-half, half]^2 -> canvas [pad, size-pad]^2. */
export function makeProj(size: number, half: number, pad: number): Proj {
  const scale = (size - pad * 2) / (half * 2);
  return { size, half, pad, scale };
}

/** World (x,z) -> canvas pixel (mx,my). PURE. */
export function worldToMap(x: number, z: number, p: Proj): { mx: number; my: number } {
  return { mx: p.pad + (x + p.half) * p.scale, my: p.pad + (z + p.half) * p.scale };
}

/** World-space length (radius/side) -> canvas pixels. PURE. */
export function worldLenToMap(len: number, p: Proj): number {
  return len * p.scale;
}

/**
 * Facing-arrow triangle points for a "you are here" marker at world (cx,cz)
 * with `heading` (radians, world convention: fwd = (sin h, cos h) in x,z —
 * matches main.ts's targetHeading = atan2(dx,dz)). Because the map's canvas
 * axes align 1:1 with world axes (+x right, +z down), the tip offset is just
 * the forward vector scaled by `tip` — no extra canvas-rotate sign puzzle.
 * Returns canvas-pixel points [tip, left, right]. PURE.
 */
export function arrowPoints(
  cx: number,
  cy: number,
  heading: number,
  tip: number,
  base: number
): { tip: { x: number; y: number }; left: { x: number; y: number }; right: { x: number; y: number } } {
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const rx = fz; // right-hand perpendicular of (fx,fz)
  const rz = -fx;
  const backX = cx - fx * base * 0.4;
  const backY = cy - fz * base * 0.4;
  return {
    tip: { x: cx + fx * tip, y: cy + fz * tip },
    left: { x: backX + rx * base * 0.6, y: backY + rz * base * 0.6 },
    right: { x: backX - rx * base * 0.6, y: backY - rz * base * 0.6 },
  };
}
