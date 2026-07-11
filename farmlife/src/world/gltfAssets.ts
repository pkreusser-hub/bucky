import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

// ---------------------------------------------------------------------------
// GLTF asset pipeline — loads the Quaternius CC0 models, converts their
// materials to match the game's toon (Hemisphere + Directional, no env map)
// lighting, normalizes them, and caches a template for cheap cloning. Ports
// the proven Farm Kart FK_loadProps recipe, RETUNED for three r169.
//
// r169 vs the r128 Farm Kart recipe (house-knowledge update — verified
// visually against screenshots, see the report):
//   • THREE.ColorManagement is ON and outputColorSpace = SRGBColorSpace here.
//     GLTFLoader already tags baseColor textures `.colorSpace = SRGBColorSpace`
//     and imports baseColorFactor into the working (linear) space correctly.
//     So the r128 `convertLinearToSRGB()` on solid colors is WRONG under r169
//     (it double-corrects → washed-out) and is NOT applied here. We keep the
//     material.color exactly as GLTFLoader produced it.
//   • MeshStandard → MeshLambert is STILL needed: the scene has no env map, so
//     PBR side/shadow faces go near-black. Lambert matches the procedural
//     crops/scenery that already use MeshLambertMaterial.
//   • A small emissive lift (base × EMISSIVE_LIFT) keeps shadowed faces reading
//     as the object's colour (flat toon look), same intent as Farm Kart — but
//     much gentler under r169's correct color management (0.12, not 0.34).
//   • Skinned meshes: r128 needed `skinning: true` on the material or the mesh
//     froze in bind pose. In r169 that flag is GONE — the renderer derives
//     skinning from the SkinnedMesh automatically, so a MeshLambertMaterial on
//     a SkinnedMesh animates fine (no frozen-bind-pose bug). Verified.
// ---------------------------------------------------------------------------

const EMISSIVE_LIFT = 0.12;

export interface LoadedModel {
  /** Material-converted source scene (never mutated after load — clone it). */
  source: THREE.Group;
  /** Bounding box of the source, for normalization math. */
  box: THREE.Box3;
  /** Animation clips (empty for static models). */
  clips: THREE.AnimationClip[];
  /** True when the model has a skinned/rigged mesh (drive with AnimationMixer). */
  animated: boolean;
}

export interface Instance {
  root: THREE.Group;
  mixer?: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<LoadedModel | null>>();

function convertMaterials(scene: THREE.Object3D): void {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const hasVC = !!(mesh.geometry && mesh.geometry.attributes && (mesh.geometry.attributes as Record<string, unknown>).color);
    const map = src.map ?? null;
    if (map) map.colorSpace = THREE.SRGBColorSpace; // ensure albedo reads as sRGB in r169
    // Lambert final = material.color * (vertexColor | mapTexel). When colour lives
    // in a texture or vertex colours, force material.color WHITE so it shows at
    // full strength; a plain solid-colour mesh keeps GLTFLoader's imported color
    // AS-IS (no linear→sRGB step — see the header note).
    const baseCol = hasVC || map ? new THREE.Color(0xffffff) : src.color ? src.color.clone() : new THREE.Color(0xcccccc);
    const lam = new THREE.MeshLambertMaterial({
      color: baseCol,
      map,
      vertexColors: hasVC,
      emissive: baseCol.clone().multiplyScalar(EMISSIVE_LIFT),
      emissiveMap: map,
      transparent: !!src.transparent,
      opacity: src.opacity != null ? src.opacity : 1,
      side: src.side ?? THREE.FrontSide,
    });
    mesh.material = lam;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

/** Load + convert + cache a GLB. Resolves null on any failure (404 / offline /
 * parse) so callers keep their procedural fallback — never throws, never a
 * blank object. Cached by URL: concurrent + repeat callers share one load. */
export function loadModel(url: string): Promise<LoadedModel | null> {
  let p = cache.get(url);
  if (p) return p;
  p = new Promise<LoadedModel | null>((resolve) => {
    loader.load(
      url,
      (gltf) => {
        try {
          const scene = gltf.scene;
          convertMaterials(scene);
          const animated = hasSkin(scene);
          const box = new THREE.Box3().setFromObject(scene);
          resolve({ source: scene as THREE.Group, box, clips: gltf.animations ?? [], animated });
        } catch (_e) {
          resolve(null);
        }
      },
      undefined,
      () => resolve(null)
    );
  });
  cache.set(url, p);
  return p;
}

function hasSkin(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) found = true;
  });
  return found;
}

function cloneScene(m: LoadedModel): THREE.Object3D {
  // SkeletonUtils.clone rebinds skinned meshes to a fresh skeleton (plain
  // Object3D.clone shares the skeleton → every instance animates in lockstep /
  // breaks). Safe for static models too.
  return skeletonClone(m.source);
}

/** Instance normalized into the prop UNIT BOX: max dimension = 1, centered in
 * X/Z, base at y = -0.5 (matches props.ts's builder contract so editor gizmo
 * scaling + collision + placement math are unchanged). */
export function instantiateUnit(m: LoadedModel): Instance {
  const obj = cloneScene(m);
  const sx = m.box.max.x - m.box.min.x, sy = m.box.max.y - m.box.min.y, sz = m.box.max.z - m.box.min.z;
  const maxD = Math.max(sx, sy, sz) || 1;
  const s = 1 / maxD;
  const cx = (m.box.min.x + m.box.max.x) / 2, cz = (m.box.min.z + m.box.max.z) / 2;
  obj.scale.setScalar(s);
  obj.position.set(-cx * s, -m.box.min.y * s - 0.5, -cz * s);
  const root = new THREE.Group();
  root.add(obj);
  return wrapMixer(m, root, obj);
}

/** Instance scaled so its max horizontal-or-vertical dimension = `size`, base
 * seated at y = 0, centered in X/Z (crop contract: the caller drops it on the
 * ground at a tile centre). */
export function instantiateSized(m: LoadedModel, size: number): Instance {
  const obj = cloneScene(m);
  const sx = m.box.max.x - m.box.min.x, sy = m.box.max.y - m.box.min.y, sz = m.box.max.z - m.box.min.z;
  const maxD = Math.max(sx, sy, sz) || 1;
  const s = size / maxD;
  const cx = (m.box.min.x + m.box.max.x) / 2, cz = (m.box.min.z + m.box.max.z) / 2;
  obj.scale.setScalar(s);
  obj.position.set(-cx * s, -m.box.min.y * s, -cz * s);
  const root = new THREE.Group();
  root.add(obj);
  return wrapMixer(m, root, obj);
}

/** Instance the model AT ITS AUTHORED WORLD SCALE — no normalization, no
 * recentring. For bespoke models built to match the game's own units (e.g. a
 * multi-node building authored with named sub-parts at real meters), where the
 * caller needs the original node hierarchy/positions intact so it can look up
 * named nodes (`root.getObjectByName(...)`) and only needs to translate the
 * whole thing into place. */
export function instantiateWorldScale(m: LoadedModel): Instance {
  const obj = cloneScene(m);
  const root = new THREE.Group();
  root.add(obj);
  return wrapMixer(m, root, obj);
}

function wrapMixer(m: LoadedModel, root: THREE.Group, animTarget: THREE.Object3D): Instance {
  if (m.animated && m.clips.length) {
    const mixer = new THREE.AnimationMixer(animTarget);
    return { root, mixer, clips: m.clips };
  }
  return { root, clips: m.clips };
}

/** Find a clip by fuzzy name match (Quaternius clips are prefixed with the
 * armature name, e.g. "CharacterArmature|Walk" or nested triples). Returns the
 * first clip whose name contains `needle` case-insensitively, else null. */
export function findClip(clips: THREE.AnimationClip[], ...needles: string[]): THREE.AnimationClip | null {
  for (const needle of needles) {
    const n = needle.toLowerCase();
    const hit = clips.find((c) => c.name.toLowerCase().includes(n));
    if (hit) return hit;
  }
  return null;
}

/** Resolve a public/models URL relative to the built app base ('./' per
 * vite.config) so it works served from /farmlife/dist/. import.meta.env.BASE_URL
 * is './' → we join to a document-relative URL. */
export function modelUrl(rel: string): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "./";
  return base.replace(/\/$/, "") + "/models/" + rel;
}
