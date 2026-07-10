// ---------------------------------------------------------------------------
// WorldData — the typed, persistable description of everything the WORLD EDITOR
// (P1.5b) lets Dad add on top of the handcrafted valley: sculpted terrain
// deltas, painted ground, placed props, and fence runs. Ported from the proven
// Farm Kart editor (farmkart-track.js): a SPARSE, world-anchored heightfield +
// paint grid (bilinear-read), plus object/fence arrays.
//
// THREE-FREE ON PURPOSE: the sanitizer + the bilinear sample math are pure and
// unit-tested without a DOM. terrain.ts (which needs THREE for the mesh) imports
// the sample functions from here so the editor and game read byte-identically.
//
// EMPTY WORLD = the handcrafted valley, unchanged. Every section defaults empty;
// serializeWorldData() omits empties so a pristine save is `{}` and sampleHeight
// adds exactly 0 (see the terrain byte-identity test).
// ---------------------------------------------------------------------------

/** Cell size (m) of the sparse world-anchored grids. Grid point (i,j) sits at
 * world (i*CELL, j*CELL); values are bilinear-interpolated between them. */
export const CELL = 4;

export interface WorldField {
  cell: number;
  cells: Record<string, number>; // key "i,j" -> height delta (m) OR 0xRRGGBB
}

export interface WorldObject {
  id: string;
  type: string; // prop-registry key (tree/rock/barn/…); unknown -> generic box
  tag?: string;
  x: number;
  y: number;
  z: number; // CENTER of the unit-box prop, in world metres
  rotY: number;
  sx: number;
  sy: number;
  sz: number; // box dimensions the unit prop is scaled to
}

export interface WorldFence {
  id: string;
  points: Array<{ x: number; z: number }>;
  height?: number;
  postGap?: number;
}

export interface WorldData {
  terrain: WorldField; // sparse height deltas
  paint: WorldField; // sparse 0xRRGGBB ground colors
  objects: WorldObject[];
  fences: WorldFence[];
}

export function emptyWorldData(): WorldData {
  return {
    terrain: { cell: CELL, cells: {} },
    paint: { cell: CELL, cells: {} },
    objects: [],
    fences: [],
  };
}

const CELL_KEY = /^-?\d+,-?\d+$/;

function sanitizeField(raw: unknown, isColor: boolean): WorldField {
  const out: WorldField = { cell: CELL, cells: {} };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Partial<WorldField>;
  if (isFinite(Number(r.cell)) && Number(r.cell) > 0) out.cell = Number(r.cell);
  if (r.cells && typeof r.cells === "object") {
    for (const [k, val] of Object.entries(r.cells as Record<string, unknown>)) {
      if (!CELL_KEY.test(k)) continue;
      const v = Number(val);
      if (!isFinite(v)) continue;
      if (isColor) {
        if (v >= 0 && v <= 0xffffff) out.cells[k] = Math.round(v);
      } else {
        if (Math.abs(v) >= 0.01) out.cells[k] = Math.round(v * 100) / 100;
      }
    }
  }
  return out;
}

/** Defensive coercion of arbitrary parsed data into a valid WorldData. A
 * corrupt/partial save can never brick the game or the editor: bad entries are
 * skipped, never thrown. Missing sections become empty (= unchanged valley). */
export function sanitizeWorldData(raw: unknown): WorldData {
  const out = emptyWorldData();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Partial<WorldData>;

  out.terrain = sanitizeField(r.terrain, false);
  out.paint = sanitizeField(r.paint, true);

  if (Array.isArray(r.objects)) {
    let seq = 0;
    for (const o of r.objects) {
      if (!o || typeof o !== "object") continue;
      const oo = o as Partial<WorldObject>;
      const x = Number(oo.x), y = Number(oo.y), z = Number(oo.z);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      const num = (v: unknown, d: number) => (isFinite(Number(v)) ? Number(v) : d);
      out.objects.push({
        id: typeof oo.id === "string" && oo.id ? oo.id.slice(0, 40) : `obj_${++seq}`,
        type: typeof oo.type === "string" && oo.type ? oo.type.slice(0, 24) : "tree",
        tag: typeof oo.tag === "string" ? oo.tag.slice(0, 60) : "",
        x, y, z,
        rotY: num(oo.rotY, 0),
        sx: Math.max(0.2, num(oo.sx, 2)),
        sy: Math.max(0.2, num(oo.sy, 2)),
        sz: Math.max(0.2, num(oo.sz, 2)),
      });
      seq = Math.max(seq, parseSeq(out.objects[out.objects.length - 1].id));
    }
  }

  if (Array.isArray(r.fences)) {
    let seq = 0;
    for (const f of r.fences) {
      if (!f || typeof f !== "object") continue;
      const ff = f as Partial<WorldFence>;
      if (!Array.isArray(ff.points) || ff.points.length < 2) continue;
      const pts: Array<{ x: number; z: number }> = [];
      for (const p of ff.points) {
        if (!p || typeof p !== "object") continue;
        const x = Number((p as { x: unknown }).x), z = Number((p as { z: unknown }).z);
        if (isFinite(x) && isFinite(z)) pts.push({ x, z });
      }
      if (pts.length < 2) continue;
      const fence: WorldFence = {
        id: typeof ff.id === "string" && ff.id ? ff.id.slice(0, 40) : `fence_${++seq}`,
        points: pts,
      };
      if (isFinite(Number(ff.height)) && Number(ff.height) > 0) fence.height = Number(ff.height);
      if (isFinite(Number(ff.postGap)) && Number(ff.postGap) > 0.5) fence.postGap = Number(ff.postGap);
      out.fences.push(fence);
      seq = Math.max(seq, parseSeq(fence.id));
    }
  }

  return out;
}

function parseSeq(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? parseInt(m[1], 10) : 0;
}

export function isFieldEmpty(f: WorldField): boolean {
  return !f || !f.cells || Object.keys(f.cells).length === 0;
}

export function isEmptyWorldData(w: WorldData): boolean {
  return (
    isFieldEmpty(w.terrain) &&
    isFieldEmpty(w.paint) &&
    w.objects.length === 0 &&
    w.fences.length === 0
  );
}

/** Minimal serialization for storage: omit empty sections so a pristine world
 * stores as `{}`. sanitizeWorldData() reconstitutes the full shape on load. */
export function serializeWorldData(w: WorldData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isFieldEmpty(w.terrain)) out.terrain = { cell: w.terrain.cell, cells: w.terrain.cells };
  if (!isFieldEmpty(w.paint)) out.paint = { cell: w.paint.cell, cells: w.paint.cells };
  if (w.objects.length) out.objects = w.objects;
  if (w.fences.length) out.fences = w.fences;
  return out;
}

// ---- bilinear reads (the Farm Kart sampleField/sampleColor, ported) --------

/** PURE. Bilinear read of a sparse height delta field at world (x,z). Missing
 * grid points read as 0, so an empty field returns exactly 0 everywhere. */
export function sampleField(field: WorldField | null | undefined, x: number, z: number): number {
  if (!field || !field.cells) return 0;
  const C = field.cell || CELL;
  const c = field.cells;
  const fx = x / C, fz = z / C;
  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  const tx = fx - i0, tz = fz - j0;
  const h00 = c[`${i0},${j0}`] || 0;
  const h10 = c[`${i0 + 1},${j0}`] || 0;
  const h01 = c[`${i0},${j0 + 1}`] || 0;
  const h11 = c[`${i0 + 1},${j0 + 1}`] || 0;
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

function rgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/** PURE. Bilinear read of a sparse paint field. Unpainted cells fall back to
 * `base` (the current grass/dirt color) so painted patches feather smoothly. */
export function sampleColor(
  field: WorldField | null | undefined,
  x: number,
  z: number,
  base: [number, number, number]
): [number, number, number] {
  if (!field || !field.cells) return base;
  const C = field.cell || CELL;
  const c = field.cells;
  const fx = x / C, fz = z / C;
  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  const tx = fx - i0, tz = fz - j0;
  const g = (i: number, j: number): [number, number, number] => {
    const v = c[`${i},${j}`];
    return v == null ? base : rgb(v);
  };
  const c00 = g(i0, j0), c10 = g(i0 + 1, j0), c01 = g(i0, j0 + 1), c11 = g(i0 + 1, j0 + 1);
  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a = c00[k] + (c10[k] - c00[k]) * tx;
    const b = c01[k] + (c11[k] - c01[k]) * tx;
    out[k] = a + (b - a) * tz;
  }
  return out;
}
