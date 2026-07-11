// ---------------------------------------------------------------------------
// Coordinate space for the 2D renderer.
//
// WORLD  : the existing simulation's metres. +X east, +Z "toward the farmhouse".
//          The whole valley spans [-MAP_HALF, MAP_HALF] on both axes (±60 m).
// MAP    : the static full-farm offscreen canvas, PPM pixels per world metre,
//          origin at world (-MAP_HALF, -MAP_HALF). +X world → +X map (right),
//          +Z world → +Y map (down). A straight top-down projection.
// SCREEN : the native pixel buffer (see renderer.ts). screen = map - cameraTopLeft
//          (both floored to whole pixels → crisp pixel snap).
//
// PPM = 8 is the mockup's own authored density (8 px/world-metre): the barn's
// 9 m footprint is 72 px exactly as in shots/2d-modern-pixel.png, and a 28 px
// farmer stands ~1 m footprint — so the ported drawing code reproduces the
// approved art at a chunky 3-5× integer display scale. See renderer.ts for the
// native-resolution decision.
// ---------------------------------------------------------------------------

import { MAP_HALF } from "../world/terrainConst";

export { MAP_HALF };

/** Native pixels per world metre. The zoom / art density (mockup-faithful). */
export const PPM = 8;

/** Full static-map canvas side (px): the whole ±60 m valley. */
export const MAP_PX = MAP_HALF * 2 * PPM; // 960

/** World (x or z) metre → map pixel (origin at world -MAP_HALF). */
export function worldToMap(w: number): number {
  return (w + MAP_HALF) * PPM;
}

/** Map pixel → world metre. */
export function mapToWorld(px: number): number {
  return px / PPM - MAP_HALF;
}
