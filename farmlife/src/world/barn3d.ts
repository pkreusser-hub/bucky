import * as THREE from "three";
import { addSegment, addCircle } from "./collision";
import { loadModel, modelUrl, instantiateWorldScale } from "./gltfAssets";
import {
  PASTURE,
  BARN,
  BARN_WALL,
  BARN_HEIGHT,
  DOOR,
  DOOR_WIDTH,
  DOOR_CENTER,
  SILO,
  GATE,
  type EggRecord,
} from "../farm/pasture";

// ---------------------------------------------------------------------------
// Barn scene (husbandry rework) — the functional barn with a hinged DOOR, the
// pasture FENCE with a walk-through player GATE, a decorative silo, the barn
// INTERIOR floor + nests, and physical EGG meshes. Procedural THREE only
// (matches the game's Lambert toon look). Registers PLAYER colliders (walls
// minus the always-passable door opening; fence minus the gate gap). Animals
// are contained separately by farm/pasture.ts's containAnimal — this module is
// purely visuals + the door swing + eggs + player collision.
//
// The barn root is registered with the P6 Occlusion manager by main.ts so the
// near wall/roof fade when the camera is looking at the player from outside or
// the player walks inside (HM-style see-through).
// ---------------------------------------------------------------------------

function mat(color: number, opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

export interface BarnScene {
  group: THREE.Group;
  /** Walls + roof — the occlusion root (fades when between camera and player). */
  barnRoot: THREE.Group;
  baseY: number;
  doorAnchor: { x: number; y: number; z: number };
  setDoorOpen(open: boolean, animate: boolean): void;
  doorIsOpen(): boolean;
  /** Current rendered door swing angle (rad) — 0 shut, ~-1.95 fully open. */
  doorAngle(): number;
  update(dt: number): void;
  /** Show meshes for the un-collected eggs; remove collected/absent ones. */
  syncEggs(eggs: EggRecord[]): void;
  eggMeshCount(): number;
  /** True once the bespoke barn2.glb model is showing (false = procedural
   * fallback still active — offline/404/still loading). */
  usesModel(): boolean;
  /** Fired on a door TOGGLE (main wires the creak SFX here). */
  onCreak?: () => void;
}

/** Internal extension used only by `preloadBarnModel` (same module, one
 * singleton barn) to hand the loaded GLB pieces back to the closure that owns
 * the door-swing/occlusion state. Not part of the public BarnScene surface. */
interface BarnSceneInternal extends BarnScene {
  _swapToModel(barnAndDoorRoot: THREE.Object3D, doorNode: THREE.Object3D | null): void;
}

const DOOR_OPEN_ANGLE = -1.95; // rad, swings outward (south) about the left jamb (procedural fallback)
// The bespoke GLB's Door node lives inside a barn assembly that gets rotated
// 180° about Y at placement time (see preloadBarnModel) so its authored
// front (+Z local) faces game-south. A door local rotation.y of the SAME
// magnitude swings the panel the matching physical direction (verified via
// render — see the report); the two pivots use different local frames so the
// signs legitimately differ from the procedural fallback's.
const GLB_DOOR_OPEN_ANGLE = 1.95;

export function buildBarnScene(sampleHeight: (x: number, z: number) => number): BarnScene {
  const group = new THREE.Group();

  // seat the barn on the LOWEST terrain under its footprint (no float on slope)
  let baseY = Infinity;
  for (const [sx, sz] of [
    [BARN.minX, BARN.minZ], [BARN.maxX, BARN.minZ], [BARN.minX, BARN.maxZ], [BARN.maxX, BARN.maxZ],
    [(BARN.minX + BARN.maxX) / 2, (BARN.minZ + BARN.maxZ) / 2],
  ] as [number, number][]) {
    baseY = Math.min(baseY, sampleHeight(sx, sz));
  }
  if (!isFinite(baseY)) baseY = 0;

  const W = BARN.maxX - BARN.minX;
  const D = BARN.maxZ - BARN.minZ;
  const cx = (BARN.minX + BARN.maxX) / 2;
  const cz = (BARN.minZ + BARN.maxZ) / 2;

  // ---- procedural-only visuals (floor/straw/door slab) — offline fallback.
  // Grouped so a successful GLB swap (preloadBarnModel) can tear the whole
  // bunch down in one shot; NOT part of the occlusion root (matches the
  // original "interior floor is not occluded" posture). No procedural nest
  // rings — the physical EGG meshes alone mark the nest spots (kept).
  const procVisual = new THREE.Group();
  group.add(procVisual);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), mat(0x9a6b3f));
  floor.position.set(cx, baseY - 0.02, cz);
  floor.receiveShadow = true;
  procVisual.add(floor);
  // straw scatter tint under the animals
  const straw = new THREE.Mesh(new THREE.CircleGeometry(Math.min(W, D) * 0.42, 20), mat(0xd8bf5c, { transparent: true, opacity: 0.5 }));
  straw.rotation.x = -Math.PI / 2;
  straw.position.set(cx, baseY + 0.11, cz);
  procVisual.add(straw);

  // ---- walls + roof (the occlusion root) ----
  const barnRoot = new THREE.Group();
  group.add(barnRoot);
  const wallMat = mat(0xb3402f); // barn red
  const trimMat = mat(0xe9e2d0);

  const addWall = (px: number, pz: number, w: number, d: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, BARN_HEIGHT, d), wallMat);
    m.position.set(px, baseY + BARN_HEIGHT / 2, pz);
    m.castShadow = true;
    m.receiveShadow = true;
    barnRoot.add(m);
    return m;
  };
  // north (full), east, west
  addWall(cx, BARN.maxZ, W, BARN_WALL);
  addWall(BARN.maxX, cz, BARN_WALL, D);
  addWall(BARN.minX, cz, BARN_WALL, D);
  // south wall in two panels around the door opening
  const southLeftW = DOOR.x0 - BARN.minX;
  const southRightW = BARN.maxX - DOOR.x1;
  addWall(BARN.minX + southLeftW / 2, BARN.minZ, southLeftW, BARN_WALL);
  addWall(BARN.maxX - southRightW / 2, BARN.minZ, southRightW, BARN_WALL);
  // lintel above the door
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(DOOR_WIDTH + 0.2, BARN_HEIGHT - 3.6, BARN_WALL), trimMat);
  lintel.position.set(DOOR_CENTER.x, baseY + 3.6 + (BARN_HEIGHT - 3.6) / 2, BARN.minZ);
  barnRoot.add(lintel);

  // gabled roof (two slabs + gable ends)
  const roofMat = mat(0x6b4a2b, { side: THREE.DoubleSide });
  const ridge = 2.4;
  const slope = Math.hypot(W / 2, ridge);
  for (const s of [-1, 1]) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(slope, D + 0.5), roofMat);
    plane.position.set(cx + (s * W) / 4, baseY + BARN_HEIGHT + ridge / 2, cz);
    plane.rotation.y = Math.PI / 2;
    plane.rotation.z = s * (Math.PI / 2 - Math.atan2(ridge, W / 2));
    plane.castShadow = true;
    barnRoot.add(plane);
  }
  const gableMat = mat(0xa63628);
  for (const s of [-1, 1]) {
    const tri = new THREE.Shape();
    tri.moveTo(-W / 2, 0);
    tri.lineTo(W / 2, 0);
    tri.lineTo(0, ridge);
    tri.closePath();
    const gm = new THREE.Mesh(new THREE.ShapeGeometry(tri), gableMat);
    gm.position.set(cx, baseY + BARN_HEIGHT, cz + (s * D) / 2);
    if (s < 0) gm.rotation.y = Math.PI;
    barnRoot.add(gm);
  }

  // ---- hinged door (pivot at the left jamb) ----
  const doorPivot = new THREE.Group();
  doorPivot.position.set(DOOR.x0, baseY, DOOR.z);
  const doorH = 3.5;
  const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(DOOR_WIDTH, doorH, 0.12), mat(0x8a5a2c));
  doorMesh.position.set(DOOR_WIDTH / 2, doorH / 2, 0);
  doorMesh.castShadow = true;
  // plank lines
  for (const dx of [-DOOR_WIDTH * 0.28, 0, DOOR_WIDTH * 0.28]) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.05, doorH * 0.94, 0.14), mat(0x6f4620));
    plank.position.set(DOOR_WIDTH / 2 + dx, doorH / 2, 0);
    doorPivot.add(plank);
  }
  doorPivot.add(doorMesh);
  procVisual.add(doorPivot);

  // ---- silo (decorative) ----
  const siloBaseY = sampleHeight(SILO.x, SILO.z);
  const siloBody = new THREE.Mesh(new THREE.CylinderGeometry(SILO.r, SILO.r, 6.4, 16), mat(0xc9ccce));
  siloBody.position.set(SILO.x, siloBaseY + 3.2, SILO.z);
  siloBody.castShadow = true;
  siloBody.receiveShadow = true;
  group.add(siloBody);
  const siloDome = new THREE.Mesh(new THREE.SphereGeometry(SILO.r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xaeb3b6));
  siloDome.position.set(SILO.x, siloBaseY + 6.4, SILO.z);
  group.add(siloDome);

  // ---- pasture fence (terrain-following) with a walk-through GATE ----
  const fenceGroup = new THREE.Group();
  group.add(fenceGroup);
  const postMat = mat(0x7a5230);
  const railMat = mat(0x8a6236);
  const buildRun = (ax: number, az: number, bx: number, bz: number, collider = true) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 2.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.35, 0.16), postMat);
      post.position.set(px, sampleHeight(px, pz) + 0.66, pz);
      post.castShadow = true;
      fenceGroup.add(post);
    }
    for (const h of [0.5, 0.95]) {
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.12), railMat);
      rail.position.set(mx, sampleHeight(mx, mz) + h, mz);
      rail.rotation.y = Math.atan2(bz - az, bx - ax);
      fenceGroup.add(rail);
    }
    if (collider) addSegment(ax, az, bx, bz, 0.22);
  };
  const A = { x: PASTURE.minX, z: PASTURE.minZ };
  const B = { x: PASTURE.maxX, z: PASTURE.minZ };
  const C = { x: PASTURE.maxX, z: PASTURE.maxZ };
  const Dc = { x: PASTURE.minX, z: PASTURE.maxZ };
  buildRun(A.x, A.z, B.x, B.z); // south
  buildRun(B.x, B.z, C.x, C.z); // east
  buildRun(C.x, C.z, Dc.x, Dc.z); // north
  // west edge split around the gate gap (no player collider across the gap)
  buildRun(Dc.x, Dc.z, GATE.x, GATE.z1); // top portion
  buildRun(GATE.x, GATE.z0, A.x, A.z); // bottom portion

  // gate posts + arch (distinct look) — no collider (player walks through)
  const gateMat = mat(0x9a6a2e);
  for (const gz of [GATE.z0, GATE.z1]) {
    const gp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.2, 0.24), gateMat);
    gp.position.set(GATE.x, sampleHeight(GATE.x, gz) + 1.1, gz);
    gp.castShadow = true;
    fenceGroup.add(gp);
  }
  const archY = sampleHeight(GATE.x, (GATE.z0 + GATE.z1) / 2) + 2.2;
  const arch = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, GATE.z1 - GATE.z0 + 0.24), gateMat);
  arch.position.set(GATE.x, archY, (GATE.z0 + GATE.z1) / 2);
  fenceGroup.add(arch);

  // colliders: silo circle (barn walls below)
  addCircle(SILO.x, SILO.z, SILO.r);
  // barn walls (player) — thin segments, DOOR OPENING left open (player passes)
  const wt = BARN_WALL * 0.6;
  addSegment(BARN.minX, BARN.maxZ, BARN.maxX, BARN.maxZ, wt); // north
  addSegment(BARN.minX, BARN.minZ, BARN.minX, BARN.maxZ, wt); // west
  addSegment(BARN.maxX, BARN.minZ, BARN.maxX, BARN.maxZ, wt); // east
  addSegment(BARN.minX, BARN.minZ, DOOR.x0, BARN.minZ, wt); // south-left
  addSegment(DOOR.x1, BARN.minZ, BARN.maxX, BARN.minZ, wt); // south-right

  // ---- eggs ----
  const eggMeshes = new Map<string, THREE.Group>();
  const eggGeo = new THREE.SphereGeometry(0.16, 10, 8);
  const buildEgg = (e: EggRecord): THREE.Group => {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(eggGeo, mat(0xfbf3df, { emissive: new THREE.Color(0x554a30), emissiveIntensity: 0.12 }));
    shell.scale.set(1, 1.35, 1);
    shell.castShadow = true;
    g.add(shell);
    g.position.set(e.x, baseY + 0.22, e.z);
    return g;
  };

  // ---- door swing state ----
  let doorOpen = false;
  let doorAngle = 0; // current rendered angle
  const setAngleImmediate = () => {
    doorPivot.rotation.y = doorAngle;
  };

  const scene: BarnScene = {
    group,
    barnRoot,
    baseY,
    doorAnchor: { x: DOOR_CENTER.x, y: baseY + 2.4, z: DOOR.z },
    setDoorOpen(open, animate) {
      const changed = open !== doorOpen;
      doorOpen = open;
      if (!animate) {
        doorAngle = open ? DOOR_OPEN_ANGLE : 0;
        setAngleImmediate();
      }
      if (changed && scene.onCreak) scene.onCreak();
    },
    doorIsOpen() {
      return doorOpen;
    },
    doorAngle() {
      return doorAngle;
    },
    update(dt) {
      const target = doorOpen ? DOOR_OPEN_ANGLE : 0;
      if (Math.abs(doorAngle - target) > 1e-3) {
        doorAngle += (target - doorAngle) * Math.min(1, dt * 6);
        setAngleImmediate();
      }
    },
    syncEggs(eggs) {
      const want = new Set<string>();
      for (const e of eggs) {
        if (e.collectedBy) continue; // collected eggs are gone from the floor
        want.add(e.id);
        if (!eggMeshes.has(e.id)) {
          const m = buildEgg(e);
          eggMeshes.set(e.id, m);
          group.add(m);
        }
      }
      for (const [id, m] of [...eggMeshes]) {
        if (want.has(id)) continue;
        group.remove(m);
        m.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry && mesh.geometry !== eggGeo) mesh.geometry.dispose();
          const mm = mesh.material as THREE.Material | undefined;
          if (mm) mm.dispose();
        });
        eggMeshes.delete(id);
      }
    },
    eggMeshCount() {
      return eggMeshes.size;
    },
  };
  return scene;
}
