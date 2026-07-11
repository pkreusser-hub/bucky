import * as THREE from "three";
import { sampleColor } from "./worldData";
import { MAP_HALF, FIELD, sampleHeight, pathBlend, getActiveWorld, isPaintActive } from "./terrainConst";

// ---------------------------------------------------------------------------
// Terrain (3D) — the THREE mesh builder ONLY. All THREE-free constants and the
// PURE height/path math moved to terrainConst.ts (so the 2D bundle never pulls
// THREE); this module `export *`s them so every legacy 3D importer is unchanged.
// buildGroundMesh() is the sole remaining THREE consumer and is NOT reachable
// from the 2D render core — it lives here for the deprecated 3D world/editor.
//
// sampleHeight() (re-exported below) stays the single height authority for
// physics, camera, mesh & scenery — the Farm Kart terrain-authority lesson.
// ---------------------------------------------------------------------------

export * from "./terrainConst";

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
  const activeWorld = getActiveWorld();
  const paintActive = isPaintActive();

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
    if (paintActive && activeWorld) {
      const [pr, pg, pb] = sampleColor(activeWorld.paint, x, z, [c.r, c.g, c.b]);
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
