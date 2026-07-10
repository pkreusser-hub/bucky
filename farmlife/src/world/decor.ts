import * as THREE from "three";

// ---------------------------------------------------------------------------
// Decorations (P5) — kid-placeable cosmetic accents (scarecrow, gnome, bench,
// flower bed, stone path, bird bath, flag banner, pinwheel). DELIBERATELY
// SEPARATE from the world-editor's WorldData/props system: those are Dad's
// authored world; these are shared, family-placeable ornaments that ride their
// own `decor` Firestore doc (see net/sync.ts). Meshes are chunky low-poly in
// the props.ts house style (boxes / cylinders / cones / spheres, no textures).
//
// COLLISION POSTURE (deliberate): decor is COSMETIC and WALK-THROUGH — it never
// registers a global collider. `collide`/`cr` are used ONLY as the placement
// FOOTPRINT radius (how much clear space a new piece needs, and how far apart
// two pieces must sit). This avoids the props-system's stale-collider-on-remove
// limitation entirely (a kid removing a bench never leaves an invisible wall),
// at the cost of being able to walk through a placed bench — fine for ornaments.
// ---------------------------------------------------------------------------

export type DecorCollide = "none" | "circle";

export interface DecorDef {
  label: string;
  emoji: string;
  cost: number;
  collide: DecorCollide;
  /** Placement footprint radius (m). Circle types use this; "none" types get a
   * tiny footprint so flat pieces (paths, flower beds) can pack close together. */
  cr: number;
}

export const DECOR: Record<string, DecorDef> = {
  scarecrow: { label: "Scarecrow", emoji: "🌾", cost: 60, collide: "circle", cr: 0.45 },
  gnome: { label: "Garden Gnome", emoji: "🧙", cost: 35, collide: "circle", cr: 0.3 },
  bench: { label: "Bench", emoji: "🪑", cost: 50, collide: "circle", cr: 0.7 },
  flowerbed: { label: "Flower Bed", emoji: "🌷", cost: 25, collide: "none", cr: 0.55 },
  pathtile: { label: "Stone Path", emoji: "⬜", cost: 10, collide: "none", cr: 0.5 },
  birdbath: { label: "Bird Bath", emoji: "🕊️", cost: 45, collide: "circle", cr: 0.45 },
  flag: { label: "Flag Banner", emoji: "🚩", cost: 30, collide: "none", cr: 0.3 },
  pinwheel: { label: "Pinwheel", emoji: "🎡", cost: 20, collide: "none", cr: 0.3 },
};

export const DECOR_ORDER: string[] = [
  "scarecrow",
  "gnome",
  "bench",
  "flowerbed",
  "pathtile",
  "birdbath",
  "flag",
  "pinwheel",
];

export function isDecorType(t: string): boolean {
  return Object.prototype.hasOwnProperty.call(DECOR, t);
}

/** Persisted decoration — one Firestore field on the shared `decor` doc. */
export interface DecorRecord {
  id: string;
  type: string;
  x: number;
  z: number;
  rotY: number;
  placedBy: string;
  placedAt: number;
}

/** Client-generated stable id (astronomically collision-unlikely, no server
 * round-trip needed — matches the "client-assigned id" note in the P5 brief). */
export function newDecorId(): string {
  return `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function lam(color: number, ghost: boolean, opacity?: number): THREE.MeshLambertMaterial {
  const transparent = ghost || (opacity != null && opacity < 1);
  return new THREE.MeshLambertMaterial({
    color,
    transparent,
    opacity: opacity != null ? opacity : ghost ? 0.55 : 1,
    depthWrite: !(opacity != null && opacity < 1),
  });
}

/** Marker so DecorField/placement can tint a ghost group (valid/invalid) and
 * find its animated parts. Built meshes sit with their base at y≈0; the owning
 * group is placed at terrain height. */
interface DecorBuild {
  group: THREE.Group;
  spin?: THREE.Object3D; // pinwheel head — DecorField.update spins it
  wave?: THREE.Object3D; // flag — DecorField.update oscillates it
}

function build(type: string, ghost: boolean): DecorBuild {
  const g = new THREE.Group();
  let spin: THREE.Object3D | undefined;
  let wave: THREE.Object3D | undefined;
  const put = (geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, opacity?: number) => {
    const m = new THREE.Mesh(geo, lam(color, ghost, opacity));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  switch (type) {
    case "scarecrow": {
      put(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 6), 0x8a6236, 0, 0.65, 0); // post
      const cross = put(new THREE.BoxGeometry(1.0, 0.08, 0.08), 0x8a6236, 0, 0.95, 0); // arms
      void cross;
      put(new THREE.SphereGeometry(0.16, 8, 6), 0xd9c27a, 0, 1.28, 0); // burlap head
      const hat = put(new THREE.ConeGeometry(0.24, 0.26, 12), 0x9c6b2f, 0, 1.5, 0); // straw hat
      void hat;
      put(new THREE.BoxGeometry(0.5, 0.5, 0.1), 0xb3402f, 0, 0.78, 0.06); // plaid shirt
      // straw tufts at the wrists
      for (const s of [-1, 1]) put(new THREE.ConeGeometry(0.07, 0.18, 5), 0xe0c65a, s * 0.48, 0.95, 0);
      break;
    }
    case "gnome": {
      put(new THREE.CylinderGeometry(0.16, 0.2, 0.34, 10), 0x3f7fd0, 0, 0.17, 0); // blue body
      put(new THREE.SphereGeometry(0.14, 8, 6), 0xf0c9a0, 0, 0.42, 0); // face
      const cap = put(new THREE.ConeGeometry(0.16, 0.34, 10), 0xc23b3b, 0, 0.62, 0); // red cap
      void cap;
      put(new THREE.SphereGeometry(0.09, 8, 6), 0xf4efe6, 0, 0.34, 0.11); // white beard
      break;
    }
    case "bench": {
      const woodC = 0x9c6b3a;
      put(new THREE.BoxGeometry(1.2, 0.1, 0.42), woodC, 0, 0.42, 0); // seat
      put(new THREE.BoxGeometry(1.2, 0.36, 0.08), woodC, 0, 0.62, -0.17); // backrest
      for (const s of [-1, 1]) {
        put(new THREE.BoxGeometry(0.1, 0.42, 0.1), 0x6b4a26, s * 0.5, 0.21, 0.15); // front leg
        put(new THREE.BoxGeometry(0.1, 0.42, 0.1), 0x6b4a26, s * 0.5, 0.21, -0.15); // back leg
      }
      break;
    }
    case "flowerbed": {
      // low soil box with a ring of colored blooms
      put(new THREE.BoxGeometry(1.0, 0.16, 0.7), 0x6b4a2c, 0, 0.08, 0); // soil
      const cols = [0xe86a8f, 0xf2c14e, 0x8f6ae8, 0xef7d4a, 0xe23b3b];
      let seed = 11;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let i = 0; i < 7; i++) {
        const fx = (rnd() - 0.5) * 0.8;
        const fz = (rnd() - 0.5) * 0.5;
        put(new THREE.CylinderGeometry(0.015, 0.015, 0.18, 4), 0x4f8437, fx, 0.24, fz);
        put(new THREE.SphereGeometry(0.07, 6, 5), cols[i % cols.length], fx, 0.35, fz);
      }
      break;
    }
    case "pathtile": {
      const t = put(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 8), 0x9c948a, 0, 0.04, 0);
      t.scale.set(1, 1, 0.8);
      break;
    }
    case "birdbath": {
      put(new THREE.CylinderGeometry(0.12, 0.16, 0.5, 10), 0xbfbfc4, 0, 0.25, 0); // pedestal
      put(new THREE.CylinderGeometry(0.34, 0.28, 0.12, 14), 0xd2d2d8, 0, 0.55, 0); // basin
      put(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 14), 0x5aa6d6, 0, 0.61, 0); // water
      break;
    }
    case "flag": {
      put(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), 0x8a6236, 0, 0.7, 0); // pole
      const banner = put(new THREE.BoxGeometry(0.5, 0.34, 0.03), 0xba303e, 0.27, 1.15, 0); // flag
      wave = banner;
      break;
    }
    case "pinwheel": {
      put(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6), 0x8a8a8a, 0, 0.5, 0); // stick
      const head = new THREE.Group();
      head.position.set(0, 1.0, 0.03);
      const cols = [0xe23b3b, 0xf2c14e, 0x3f7fd0, 0x4f9a3f];
      for (let i = 0; i < 4; i++) {
        const vane = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 3), lam(cols[i], ghost));
        vane.rotation.z = (i / 4) * Math.PI * 2;
        vane.position.set(Math.cos((i / 4) * Math.PI * 2) * 0.14, Math.sin((i / 4) * Math.PI * 2) * 0.14, 0);
        vane.castShadow = true;
        head.add(vane);
      }
      const hub = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), lam(0x333333, ghost));
      head.add(hub);
      g.add(head);
      spin = head;
      break;
    }
    default: {
      put(new THREE.BoxGeometry(0.5, 0.5, 0.5), 0xc8a06a, 0, 0.25, 0, ghost ? 0.5 : 1);
    }
  }
  return { group: g, spin, wave };
}

/** Build a placed decoration mesh (base at y≈0; caller seats the group on the
 * terrain). `ghost` renders translucent for the placement-preview look. */
export function buildDecorMesh(type: string, ghost = false): THREE.Group {
  const b = build(type, ghost);
  if (b.spin) b.group.userData.spin = b.spin;
  if (b.wave) b.group.userData.wave = b.wave;
  return b.group;
}

/** Recolor a ghost group green (valid) or red (invalid) without rebuilding it. */
export function tintGhost(group: THREE.Group, valid: boolean): void {
  const col = valid ? 0x4caf50 : 0xd64545;
  group.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (m && m.color) m.color.setHex(col);
  });
}

// ---------------------------------------------------------------------------
// DecorField — owns the placed-decoration meshes (mirrors world/animals3d.ts's
// AnimalField). Reconciles from the shared record map (add/remove granular),
// drives per-frame motion (pinwheels spin, flags wave), and answers the
// facing-aware "nearest decoration" query the removal tool needs.
// ---------------------------------------------------------------------------

interface DecorMesh {
  group: THREE.Group;
  spin?: THREE.Object3D;
  wave?: THREE.Object3D;
}

export class DecorField {
  group = new THREE.Group();
  private meshes = new Map<string, DecorMesh>();
  private records = new Map<string, DecorRecord>();
  private tSec = 0;
  private heightAt: (x: number, z: number) => number;

  constructor(heightAt: (x: number, z: number) => number) {
    this.heightAt = heightAt;
  }

  count(): number {
    return this.records.size;
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  record(id: string): DecorRecord | undefined {
    return this.records.get(id);
  }

  ids(): string[] {
    return [...this.records.keys()];
  }

  /** Reconcile the on-screen decorations to `next` — add new ids, remove gone
   * ids, and re-place any whose transform changed. Idempotent (an echo of our
   * own write diffs to nothing). */
  syncAll(next: Record<string, DecorRecord>): void {
    // remove
    for (const id of [...this.records.keys()]) {
      if (!(id in next)) this.remove(id);
    }
    // add / update
    for (const id of Object.keys(next)) {
      const rec = next[id];
      const cur = this.records.get(id);
      if (!cur) {
        this.add(rec);
      } else if (cur.type !== rec.type || cur.x !== rec.x || cur.z !== rec.z || cur.rotY !== rec.rotY) {
        this.remove(id);
        this.add(rec);
      }
    }
  }

  add(rec: DecorRecord): void {
    if (this.meshes.has(rec.id)) this.remove(rec.id);
    const group = buildDecorMesh(rec.type);
    group.position.set(rec.x, this.heightAt(rec.x, rec.z), rec.z);
    group.rotation.y = rec.rotY;
    this.group.add(group);
    this.meshes.set(rec.id, {
      group,
      spin: group.userData.spin as THREE.Object3D | undefined,
      wave: group.userData.wave as THREE.Object3D | undefined,
    });
    this.records.set(rec.id, { ...rec });
  }

  remove(id: string): void {
    const m = this.meshes.get(id);
    if (m) {
      this.group.remove(m.group);
      m.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | undefined;
        if (mat) mat.dispose();
      });
      this.meshes.delete(id);
    }
    this.records.delete(id);
  }

  update(dt: number): void {
    this.tSec += dt;
    for (const m of this.meshes.values()) {
      if (m.spin) m.spin.rotation.z = this.tSec * 2.4; // pinwheel head spins
      if (m.wave) m.wave.rotation.y = Math.sin(this.tSec * 3) * 0.35; // flag gentle wave
    }
  }

  /** Facing-aware nearest placed decoration (mirrors AnimalField.nearestFacing /
   * field.ts tile targeting) — within `maxDist` AND within `maxAngleRad` of the
   * player's heading. Returns the shared record (removal is family-wide). */
  nearestFacing(px: number, pz: number, heading: number, maxDist: number, maxAngleRad: number): DecorRecord | null {
    const fwdX = Math.sin(heading);
    const fwdZ = Math.cos(heading);
    let best: DecorRecord | null = null;
    let bestDist = Infinity;
    for (const rec of this.records.values()) {
      const dx = rec.x - px;
      const dz = rec.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > maxDist || dist < 0.001) continue;
      const dot = (dx / dist) * fwdX + (dz / dist) * fwdZ;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle > maxAngleRad) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = rec;
      }
    }
    return best;
  }

  /** True if a footprint of radius `r` at (x,z) overlaps any placed decoration
   * (its footprint), optionally ignoring one id (self during a move). Pure spacing
   * check — decor holds no global collider (see module header). */
  overlaps(x: number, z: number, r: number, ignoreId?: string): boolean {
    for (const rec of this.records.values()) {
      if (rec.id === ignoreId) continue;
      const other = (DECOR[rec.type]?.cr ?? 0.3);
      if (Math.hypot(rec.x - x, rec.z - z) < r + other) return true;
    }
    return false;
  }
}
