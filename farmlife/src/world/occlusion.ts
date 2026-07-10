import * as THREE from "three";

// ---------------------------------------------------------------------------
// Camera occlusion fade (P6) — HM-style "see-through-the-tree." Each cycle we
// cast ONE ray from the camera to the player; anything opaque between them
// (trees, rocks, editor props, decorations, the farmhouse) fades to a low
// opacity so the player never disappears behind scenery, then smoothly restores
// when the line of sight is clear. Opacity is always LERPED — no occlusion pop.
//
// COST / draw-call posture (the brief's explicit ask):
//  - Non-instanced occluders (farmhouse, editor props, decorations) fade IN
//    PLACE by mutating their existing materials' opacity — zero new draw calls,
//    zero new geometry. We resolve a raycast hit up to its owning "root" group
//    so a barn fades as one piece, never half a wall.
//  - Instanced scenery (trees, rocks — 4 InstancedMeshes total, ~76 instances)
//    CANNOT fade a single instance in place. We hide just the occluding instance
//    (zero-scale its matrix) and show a pooled, fadeable NON-instanced PROXY at
//    that spot. In practice the thin cam→player ray crosses 0–2 occluders at a
//    time, so the proxy pool (and the extra draw calls) stays a handful — the
//    46×3 tree instances are never de-instanced en masse.
//
// The ray is recast every RAY_EVERY frames (cached between), so the per-frame
// cost is just a few opacity lerps. The terrain-under-camera clamp (chaseCam)
// is untouched — this only fades things BETWEEN the camera and the player.
// ---------------------------------------------------------------------------

const FADE_OPACITY = 0.22;
const RAY_EVERY = 3; // recompute the occluder set every N frames
const LERP_RATE = 9; // opacity approach speed (higher = snappier)
const NEAR_MARGIN = 0.7; // ignore hits hugging the camera
const FAR_MARGIN = 1.4; // ignore hits right at the player
// grace frames an occluder stays faded after the ray last cleared it — the thin
// cam→player ray grazes trunk/canopy edges as the camera bobs, so without this a
// single-frame miss would reset the fade and cause visible flicker/popping.
const CLEAR_GRACE = 14;

/** An instanced scenery field (trees / rocks) the manager can occlude one
 * instance of at a time via hide + fadeable proxy. */
export interface InstancedOccluder {
  name: string;
  meshes: THREE.InstancedMesh[]; // parts that share a spot index (tree: trunk+2 canopies)
  count: number; // number of spots
  spotXZ(spot: number): { x: number; z: number };
  setHidden(spot: number, hidden: boolean): void;
  makeProxy(spot: number): THREE.Group; // non-instanced clone at spot, transparent mats
}

interface MeshRootEntry {
  root: THREE.Object3D;
  mats: THREE.Material[];
  base: number[];
  cur: number; // 1 = fully opaque
  clear: number; // consecutive frames the ray has NOT hit this occluder
}
interface ProxyEntry {
  field: InstancedOccluder;
  spot: number;
  group: THREE.Group;
  mats: THREE.Material[];
  base: number[];
  cur: number;
  clear: number;
}

function collectMats(root: THREE.Object3D): { mats: THREE.Material[]; base: number[] } {
  const mats: THREE.Material[] = [];
  const base: number[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    const arr = Array.isArray(mat) ? mat : [mat];
    for (const mm of arr) {
      if (mats.includes(mm)) continue;
      mats.push(mm);
      base.push((mm as THREE.Material & { opacity: number }).opacity ?? 1);
    }
  });
  return { mats, base };
}

export class Occlusion {
  private ray = new THREE.Raycaster();
  private frame = 0;
  private meshRoots = new Map<THREE.Object3D, MeshRootEntry>();
  private proxies = new Map<string, ProxyEntry>();
  private containers: { obj: THREE.Object3D; resolve: (hit: THREE.Object3D) => THREE.Object3D | null }[] = [];
  private instanced: InstancedOccluder[] = [];
  private activeRoots = new Set<THREE.Object3D>();
  private activeProxies = new Set<string>();
  private tmpDir = new THREE.Vector3();
  private tmpTarget = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {}

  /** Register a container to raycast; `resolve(hit)` maps a hit mesh to the
   * "root" group that should fade together (e.g. the whole barn). */
  addContainer(obj: THREE.Object3D, resolve: (hit: THREE.Object3D) => THREE.Object3D | null): void {
    this.containers.push({ obj, resolve });
  }
  addInstanced(field: InstancedOccluder): void {
    this.instanced.push(field);
  }

  /** Resolve the direct child of `container` that owns `hit` (or hit itself). */
  static childUnder(container: THREE.Object3D): (hit: THREE.Object3D) => THREE.Object3D | null {
    return (hit) => {
      let o: THREE.Object3D | null = hit;
      while (o && o.parent && o.parent !== container) o = o.parent;
      return o && o.parent === container ? o : null;
    };
  }

  update(dt: number, targetX: number, targetY: number, targetZ: number): void {
    this.frame++;
    if (this.frame % RAY_EVERY === 0) this.recompute(targetX, targetY, targetZ);
    this.applyLerp(dt);
  }

  /** Force an immediate recompute (test hook). */
  recomputeNow(targetX: number, targetY: number, targetZ: number): void {
    this.recompute(targetX, targetY, targetZ);
  }

  private recompute(tx: number, ty: number, tz: number): void {
    this.tmpTarget.set(tx, ty + 1.0, tz);
    const cam = this.camera.position;
    this.tmpDir.copy(this.tmpTarget).sub(cam);
    const dist = this.tmpDir.length();
    if (dist < 0.001) return;
    this.tmpDir.multiplyScalar(1 / dist);
    this.ray.set(cam, this.tmpDir);
    this.ray.near = 0;
    this.ray.far = dist;

    this.activeRoots.clear();
    this.activeProxies.clear();
    const lo = NEAR_MARGIN;
    const hi = dist - FAR_MARGIN;

    // non-instanced containers
    for (const c of this.containers) {
      const hits = this.ray.intersectObject(c.obj, true);
      for (const h of hits) {
        if (h.distance < lo || h.distance > hi) continue;
        const root = c.resolve(h.object);
        if (root) this.activeRoots.add(root);
      }
    }

    // instanced fields
    for (const field of this.instanced) {
      for (const m of field.meshes) {
        const hits = this.ray.intersectObject(m, false);
        for (const h of hits) {
          if (h.distance < lo || h.distance > hi) continue;
          if (h.instanceId == null) continue;
          this.activeProxies.add(`${field.name}:${h.instanceId}`);
        }
      }
    }

    // spawn proxies / hide instances for newly-active spots
    for (const key of this.activeProxies) {
      if (this.proxies.has(key)) continue;
      const [name, spotStr] = key.split(":");
      const field = this.instanced.find((f) => f.name === name);
      if (!field) continue;
      const spot = parseInt(spotStr, 10);
      field.setHidden(spot, true);
      const group = field.makeProxy(spot);
      this.scene.add(group);
      const { mats, base } = collectMats(group);
      // proxies render already-transparent; start at full then fade down
      for (const mm of mats) (mm as THREE.Material).transparent = true;
      this.proxies.set(key, { field, spot, group, mats, base, cur: 1, clear: 0 });
    }
  }

  private applyLerp(dt: number): void {
    const k = Math.min(1, LERP_RATE * dt);

    // ---- non-instanced roots -------------------------------------------------
    // ensure entries exist for active roots
    for (const root of this.activeRoots) {
      if (!this.meshRoots.has(root)) {
        const { mats, base } = collectMats(root);
        for (const mm of mats) (mm as THREE.Material).transparent = true;
        this.meshRoots.set(root, { root, mats, base, cur: 1, clear: 0 });
      }
    }
    for (const [root, e] of [...this.meshRoots]) {
      // a removed root (props rebuilt / decor deleted) drops out silently
      if (!e.root.parent) {
        this.meshRoots.delete(root);
        continue;
      }
      const active = this.activeRoots.has(root);
      e.clear = active ? 0 : e.clear + 1;
      // hysteresis: stay faded until the ray has been clear for CLEAR_GRACE frames
      const want = active || e.clear < CLEAR_GRACE ? FADE_OPACITY : 1;
      e.cur += (want - e.cur) * k;
      for (let i = 0; i < e.mats.length; i++) {
        const mm = e.mats[i] as THREE.Material & { opacity: number };
        mm.opacity = e.base[i] * e.cur;
      }
      if (want === 1 && e.cur > 0.985) {
        for (let i = 0; i < e.mats.length; i++) {
          const mm = e.mats[i] as THREE.Material & { opacity: number };
          mm.opacity = e.base[i];
          mm.transparent = e.base[i] < 1; // restore original transparency posture
        }
        this.meshRoots.delete(root);
      }
    }

    // ---- instanced proxies ---------------------------------------------------
    for (const [key, p] of [...this.proxies]) {
      const active = this.activeProxies.has(key);
      p.clear = active ? 0 : p.clear + 1;
      const want = active || p.clear < CLEAR_GRACE ? FADE_OPACITY : 1;
      p.cur += (want - p.cur) * k;
      for (let i = 0; i < p.mats.length; i++) {
        (p.mats[i] as THREE.Material & { opacity: number }).opacity = p.base[i] * p.cur;
      }
      if (want === 1 && p.cur > 0.985) {
        // clear of sight: restore the real instance, drop the proxy
        p.field.setHidden(p.spot, false);
        this.scene.remove(p.group);
        p.group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const mat = mesh.material as THREE.Material | undefined;
          if (mat) mat.dispose();
        });
        this.proxies.delete(key);
      }
    }
  }

  // ---- test hooks ------------------------------------------------------------
  /** Number of occluders currently faded below ~0.9 opacity (roots + proxies). */
  fadedCount(): number {
    let n = 0;
    for (const e of this.meshRoots.values()) if (e.cur < 0.9) n++;
    for (const p of this.proxies.values()) if (p.cur < 0.9) n++;
    return n;
  }
  /** Lowest current opacity across all tracked occluders (1 if none). */
  minOpacity(): number {
    let mn = 1;
    for (const e of this.meshRoots.values()) mn = Math.min(mn, e.cur);
    for (const p of this.proxies.values()) mn = Math.min(mn, p.cur);
    return mn;
  }
  /** Lowest current opacity among tree/rock PROXIES only (1 if none). */
  proxyMinOpacity(): number {
    let mn = 1;
    for (const p of this.proxies.values()) mn = Math.min(mn, p.cur);
    return mn;
  }
  proxyCount(): number {
    return this.proxies.size;
  }
}
