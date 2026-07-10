import * as THREE from "three";
import { sampleField, sampleColor, type WorldData } from "./worldData";

// ---------------------------------------------------------------------------
// Terrain — the single height authority for physics, camera, mesh & scenery.
// Gentle sine hills (Farm Kart aesthetic, mild amplitude). A flat rectangular
// field near the centre (future farming plot) and a pond dip are blended in.
// sampleHeight() is a PURE function — everything that needs a ground height
// calls it, so nothing ever fights the mesh (the Farm Kart terrain-authority
// lesson: two height functions = road/ground weirdness).
// ---------------------------------------------------------------------------

export const MAP_HALF = 60; // valley spans [-60, 60] on both axes (~120 m)
export const EDGE = MAP_HALF - 1.5; // player clamp / wall

// Flat farming field (future plot) — kept flat & dirt-tinted, visually distinct.
export const FIELD = { cx: -6, cz: 6, half: 12, y: 0.15 }; // 24×24 m

// Pond — a dip filled with translucent water.
export const POND = { cx: 30, cz: -26, r: 10, waterY: -1.15 };

// ---------------------------------------------------------------------------
// Default valley PATHS — dirt walkways (house <-> field gate <-> pond) baked
// straight into the ground COLOR (see buildGroundMesh), replacing the old
// buildPath() disc meshes in scenery.ts. These are ALWAYS present and are NOT
// worldData.paint, so the editor's "clear paint" can't erase them and the user
// paints OVER them. Heights are unchanged — only vertex colors. (Point list =
// the old scenery buildPath() polyline verbatim so the paths land identically.)
// ---------------------------------------------------------------------------
export const DEFAULT_PATH_PTS: Array<[number, number]> = [
  [24, 20], // farmhouse
  [16, 14],
  [FIELD.cx + FIELD.half + 1.5, FIELD.cz], // east field gate (matches fence gap)
  [FIELD.cx, FIELD.cz], // into the plot
  [16, -6],
  [POND.cx - 2, POND.cz + POND.r + 1], // pond edge
];
const PATH_CORE = 2.0; // full-dirt half-width (m) — a touch wider than the old 1.1 discs
const PATH_FEATHER = 1.8; // feather distance beyond the core (soft grass blend)

const AMP = 1.9; // mild hill amplitude (m)

// ---------------------------------------------------------------------------
// World-editor overlay (P1.5b). The active WorldData's sculpt heightfield is
// added to the base hills EVERYWHERE except inside the farming field (+margin),
// which stays flat & farmable. When no world is active (or its cells are empty)
// sampleField returns 0, so sampleHeight is BYTE-IDENTICAL to the handcrafted
// valley — the single-height-authority guarantee (Farm Kart Stage-A lesson).
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
 * (its own dirt look wins). Used to tint the ground toward dirt in
 * buildGroundMesh — heights are untouched. */
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

// --- Vertex-colored "fluffy" grass -----------------------------------------
// Muted green base with low-frequency brightness variation so big areas aren't
// uniform; a cached grayscale blade-noise texture modulates it for detail.
const GRASS = new THREE.Color("#7ba659");
const GRASS_DARK = new THREE.Color("#5f8a45");
const DIRT = new THREE.Color("#a9825a");
const DIRT_DARK = new THREE.Color("#8a6642");
const PATH_COL = new THREE.Color("#9c7a52"); // baked default-path dirt (old buildPath disc color)

let bladeTex: THREE.Texture | null = null;
function grassTexture(): THREE.Texture {
  if (bladeTex) return bladeTex;
  const S = 256;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#8a8a8a";
  ctx.fillRect(0, 0, S, S);
  // deterministic PRNG so the texture is stable
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };
  for (let i = 0; i < 5200; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const len = 2 + rnd() * 5;
    const v = 120 + Math.floor(rnd() * 110);
    ctx.strokeStyle = `rgb(${v},${v},${v})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 2, y - len);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  bladeTex = t;
  return t;
}

export function buildGroundMesh(): THREE.Mesh {
  const seg = 120;
  const size = MAP_HALF * 2;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2); // XZ ground plane

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, sampleHeight(x, z));

    // low-freq brightness patches
    const patch =
      0.5 +
      0.5 *
        (0.5 + 0.5 * Math.sin(x * 0.06 + 1.1)) *
        (0.5 + 0.5 * Math.cos(z * 0.07 - 0.4));

    const overField =
      Math.abs(x - FIELD.cx) <= FIELD.half + 1 &&
      Math.abs(z - FIELD.cz) <= FIELD.half + 1;

    if (overField) {
      c.copy(DIRT_DARK).lerp(DIRT, patch);
    } else {
      c.copy(GRASS_DARK).lerp(GRASS, patch);
    }
    // subtle per-vertex jitter
    tmp.setRGB((Math.sin(i * 12.9) * 0.5 + 0.5) * 0.06, 0, 0);
    c.r = Math.min(1, c.r + tmp.r * 0.1);

    // Baked default valley paths (dirt walkways). Applied to grass only (the
    // field is already dirt) and BEFORE the editor paint overlay, so any user
    // paint layers on top and "clear paint" never removes these.
    if (!overField) {
      const pb = pathBlend(x, z);
      if (pb > 0) c.lerp(PATH_COL, pb);
    }

    // World-editor paint overlay (feathered; unpainted cells keep the grass color).
    if (paintActive) {
      const [pr, pg, pb] = sampleColor(activeWorld!.paint, x, z, [c.r, c.g, c.b]);
      c.setRGB(pr, pg, pb);
    }

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // world-tiled UVs for the blade texture (every 5 m)
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / 5, pos.getZ(i) / 5);
  }

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: grassTexture(),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "ground";
  return mesh;
}
