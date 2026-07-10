import * as THREE from "three";
import type { WorldFence } from "./worldData";
import { loadModel, instantiateUnit, modelUrl, type LoadedModel } from "./gltfAssets";

// ---------------------------------------------------------------------------
// Prop registry — the world editor's placeable palette. Every builder authors
// its prop into a UNIT box centered at the origin, base at y = -0.5, so a
// placed object's group.position = CENTER and group.scale = (sx,sy,sz) size &
// seat it uniformly (the Farm Kart buildObjectMesh pattern). buildPropMesh()
// dispatches on `type`; unknown types fall back to a generic box.
//
// Collision footprint is per-type: barns/sheds are boxes, most props are
// circles, and flowers / path tiles have none (walk right over them).
// ---------------------------------------------------------------------------

export type CollideKind = "none" | "circle" | "box";

export interface PropDef {
  label: string;
  emoji: string;
  size: [number, number, number]; // default (sx,sy,sz) on placement
  collide: CollideKind;
  /** For circle collision: radius = factor * max(sx,sz). Box uses 0.5*sx,0.5*sz. */
  cf?: number;
}

export const PROPS: Record<string, PropDef> = {
  tree: { label: "Tree", emoji: "🌳", size: [3, 4, 3], collide: "circle", cf: 0.22 },
  pine: { label: "Pine", emoji: "🌲", size: [3, 5, 3], collide: "circle", cf: 0.22 },
  bush: { label: "Bush", emoji: "🌿", size: [2, 1.4, 2], collide: "circle", cf: 0.4 },
  rock: { label: "Rock", emoji: "🪨", size: [1.6, 1.4, 1.6], collide: "circle", cf: 0.42 },
  barn: { label: "Barn", emoji: "🏠", size: [8, 6, 6], collide: "box" },
  shed: { label: "Shed", emoji: "🛖", size: [4, 3.4, 4], collide: "box" },
  silo: { label: "Silo", emoji: "🥫", size: [3, 7, 3], collide: "circle", cf: 0.45 },
  hay: { label: "Hay bale", emoji: "🌾", size: [1.8, 1.4, 2.2], collide: "circle", cf: 0.45 },
  log: { label: "Log", emoji: "🪵", size: [3, 1, 1], collide: "circle", cf: 0.42 },
  flower: { label: "Flowers", emoji: "🌷", size: [1.6, 0.8, 1.6], collide: "none" },
  path: { label: "Path tile", emoji: "⬜", size: [2, 0.25, 2], collide: "none" },
};

export const PROP_ORDER = Object.keys(PROPS);

function lam(color: number, ghost: boolean, opacity?: number): THREE.MeshLambertMaterial {
  const transparent = ghost || (opacity != null && opacity < 1);
  return new THREE.MeshLambertMaterial({
    color,
    transparent,
    opacity: opacity != null ? opacity : ghost ? 0.55 : 1,
    depthWrite: !(opacity != null && opacity < 1),
  });
}

// ---- Quaternius building models (Stage 4 art swap) --------------------------
// barn/shed/silo swap to CC0 Quaternius Farm Building GLBs when loaded; the
// procedural blockouts below stay as fallback (offline/404) and for the editor
// ghost. Templates are normalized into the SAME unit box the procedural props
// fill (base y=-0.5, centered, maxdim 1), so placement/scale/collision math is
// unchanged.
const BUILDING_MODEL_FILE: Record<string, string> = {
  barn: "buildings/barn.glb",
  shed: "buildings/shed.glb",
  silo: "buildings/silo.glb",
};
const buildingTemplates = new Map<string, LoadedModel | null>();
let buildingsPreloaded = false;

export function preloadBuildingModels(): Promise<void> {
  return Promise.all(
    Object.entries(BUILDING_MODEL_FILE).map(async ([type, file]) => {
      const m = await loadModel(modelUrl(file));
      buildingTemplates.set(type, m);
    })
  ).then(() => {
    buildingsPreloaded = true;
  });
}

export function buildingModelsReady(): boolean {
  return buildingsPreloaded;
}

/** True if this prop type currently resolves to a GLB (not the blockout). */
export function propUsesModel(type: string): boolean {
  return !!buildingTemplates.get(type);
}

/** Build one placed prop into a THREE.Group filling a unit box (base y=-0.5).
 * `ghost` renders translucent for the editor placeholder look. */
export function buildPropMesh(type: string, ghost = false): THREE.Group {
  // Solid (non-ghost) barn/shed/silo use the Quaternius GLB when loaded.
  const tpl = !ghost ? buildingTemplates.get(type) : null;
  if (tpl) {
    const g = new THREE.Group();
    g.userData.glb = true;
    g.add(instantiateUnit(tpl).root);
    return g;
  }
  const g = new THREE.Group();
  const put = (geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, opacity?: number) => {
    const m = new THREE.Mesh(geo, lam(color, ghost, opacity));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  switch (type) {
    case "tree": {
      put(new THREE.CylinderGeometry(0.09, 0.13, 0.55, 6), 0x6f4a2c, 0, -0.22, 0); // trunk
      put(new THREE.SphereGeometry(0.34, 10, 8), 0x4f7d3a, 0, 0.12, 0); // canopy
      put(new THREE.SphereGeometry(0.26, 10, 8), 0x5f9046, 0.15, 0.28, -0.1);
      break;
    }
    case "pine": {
      put(new THREE.CylinderGeometry(0.08, 0.11, 0.4, 6), 0x6f4a2c, 0, -0.3, 0);
      put(new THREE.ConeGeometry(0.34, 0.5, 8), 0x3f6f34, 0, 0.0, 0);
      put(new THREE.ConeGeometry(0.26, 0.4, 8), 0x4a7d3d, 0, 0.28, 0);
      break;
    }
    case "bush": {
      put(new THREE.SphereGeometry(0.42, 10, 8), 0x4f8437, 0, -0.05, 0);
      put(new THREE.SphereGeometry(0.32, 10, 8), 0x5c9642, 0.22, 0.08, 0.12);
      put(new THREE.SphereGeometry(0.3, 10, 8), 0x5c9642, -0.22, 0.05, -0.1);
      break;
    }
    case "rock": {
      const m = put(new THREE.DodecahedronGeometry(0.5, 0), 0x8b8b8b, 0, -0.02, 0);
      m.scale.set(1, 0.72, 1);
      put(new THREE.DodecahedronGeometry(0.26, 0), 0x9a9a9a, 0.28, -0.18, 0.2);
      break;
    }
    case "barn": {
      put(new THREE.BoxGeometry(1, 0.62, 1), 0xb3402f, 0, -0.19, 0); // walls
      const rl = put(new THREE.BoxGeometry(0.76, 0.06, 1.04), 0x7a3b2a, -0.2, 0.28, 0);
      rl.rotation.z = 0.72;
      const rr = put(new THREE.BoxGeometry(0.76, 0.06, 1.04), 0x7a3b2a, 0.2, 0.28, 0);
      rr.rotation.z = -0.72;
      put(new THREE.BoxGeometry(0.3, 0.36, 0.04), 0xe9e4d8, 0, -0.32, 0.5); // door
      break;
    }
    case "shed": {
      put(new THREE.BoxGeometry(1, 0.6, 1), 0xcaa06a, 0, -0.2, 0);
      const roof = put(new THREE.BoxGeometry(1.1, 0.08, 1.1), 0x6b4a2b, 0, 0.16, 0);
      roof.rotation.z = 0.16;
      put(new THREE.BoxGeometry(0.26, 0.32, 0.04), 0x7a5230, 0, -0.34, 0.5); // door
      break;
    }
    case "silo": {
      put(new THREE.CylinderGeometry(0.42, 0.42, 0.82, 16), 0xc9ccce, 0, -0.09, 0);
      put(new THREE.SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xaeb3b6, 0, 0.32, 0);
      break;
    }
    case "hay": {
      const bale = put(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 14), 0xd8bf5c, 0, 0, 0);
      bale.rotation.z = Math.PI / 2; // lie on its side
      put(new THREE.TorusGeometry(0.46, 0.04, 6, 16), 0xb89a3a, 0, 0, 0.28).rotation.y = Math.PI / 2;
      put(new THREE.TorusGeometry(0.46, 0.04, 6, 16), 0xb89a3a, 0, 0, -0.28).rotation.y = Math.PI / 2;
      break;
    }
    case "log": {
      const l = put(new THREE.CylinderGeometry(0.28, 0.28, 1, 10), 0x6f4a2c, 0, -0.22, 0);
      l.rotation.z = Math.PI / 2;
      put(new THREE.CylinderGeometry(0.2, 0.2, 1.02, 8), 0x8a6642, 0, -0.22, 0).rotation.z = Math.PI / 2;
      break;
    }
    case "flower": {
      put(new THREE.CircleGeometry(0.5, 12), 0x6f9a4a, 0, -0.48, 0).rotation.x = -Math.PI / 2;
      const cols = [0xe86a8f, 0xf2c14e, 0x8f6ae8, 0xef7d4a];
      let seed = 7;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let i = 0; i < 6; i++) {
        const fx = (rnd() - 0.5) * 0.7, fz = (rnd() - 0.5) * 0.7;
        put(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 4), 0x4f8437, fx, -0.33, fz);
        put(new THREE.SphereGeometry(0.07, 6, 5), cols[i % cols.length], fx, -0.16, fz);
      }
      break;
    }
    case "path": {
      put(new THREE.BoxGeometry(1, 1, 1), 0x9c8f80);
      break;
    }
    default: {
      put(new THREE.BoxGeometry(1, 1, 1), 0xc8a06a, 0, 0, 0, ghost ? 0.5 : 1);
    }
  }
  return g;
}

// ---- Fence mesh (posts + 3 rails that follow the terrain) ------------------
// heightFn(x,z) seats it on the ground (both game and editor pass sampleHeight,
// which is world-aware). Shared so editor + game render identical fences.
export function buildFenceMesh(fence: WorldFence, heightFn: (x: number, z: number) => number): THREE.Group {
  const g = new THREE.Group();
  const pts = fence.points;
  if (!pts || pts.length < 2) return g;
  const H = fence.height || 1.3;
  const postGap = fence.postGap || 2.5;
  const step = 1.2;
  const postMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const railMat = new THREE.MeshLambertMaterial({ color: 0x8a6236 });
  const railFracs = [0.42, 0.72];

  const path: Array<{ x: number; z: number; y: number }> = [];
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[s], b = pts[s + 1];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const t = i / n, x = a.x + dx * t, z = a.z + dz * t;
      path.push({ x, z, y: heightFn(x, z) });
    }
  }
  const last = pts[pts.length - 1];
  path.push({ x: last.x, z: last.z, y: heightFn(last.x, last.z) });

  const Z = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i], q = path[i + 1];
    for (const f of railFracs) {
      const dir = new THREE.Vector3(q.x - p.x, (q.y + H * f) - (p.y + H * f), q.z - p.z);
      const L = dir.length() || 0.01;
      dir.normalize();
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, L), railMat);
      rail.position.set((p.x + q.x) / 2, (p.y + q.y) / 2 + H * f, (p.z + q.z) / 2);
      rail.quaternion.setFromUnitVectors(Z, dir);
      rail.castShadow = true;
      g.add(rail);
    }
  }
  let acc = 0, next = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) acc += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    if (acc >= next || i === path.length - 1) {
      const p = path[i];
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, H, 0.16), postMat);
      post.position.set(p.x, p.y + H / 2, p.z);
      post.castShadow = true;
      g.add(post);
      next += postGap;
    }
  }
  return g;
}
