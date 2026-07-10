import * as THREE from "three";
import { sampleHeight, FIELD, POND, MAP_HALF } from "./terrain";
import { addBox, addCircle, addSegment } from "./collision";
import type { InstancedOccluder } from "./occlusion";
import { loadModel, instantiateUnit, modelUrl } from "./gltfAssets";
import { PASTURE } from "../farm/pasture";

// Warm, chunky, HM64-ish. Trees/rocks are procedural + instanced; the farmhouse
// art-swaps to a QUATERNIUS CC0 building model (public/models/buildings) once
// loaded (procedural fallback until then / on failure). Window night-glow +
// collision are preserved across the swap.

function mat(color: string, opts: THREE.MeshLambertMaterialParameters = {}) {
  return new THREE.MeshLambertMaterial({ color: new THREE.Color(color), ...opts });
}

/** World position of the farmhouse — exported so P4's animal pen + day/night
 * window-glow logic can anchor near it without re-deriving the constant. */
export const FARMHOUSE_POS = { cx: 24, cz: 20 };

// Farmhouse footprint (matches the collision box below) — the GLB is scaled to
// fill these dims so the swap keeps the same silhouette/collision.
const FH_W = 8, FH_H = 5.5, FH_D = 6;

let farmhouseWindowMats: THREE.MeshLambertMaterial[] = [];
/** P4 day/night: the farmhouse window(s), so the lighting loop can drive
 * emissiveIntensity toward `windowGlow` from daynight.ts's SkyState. Empty
 * until buildScenery() has run once. */
export function farmhouseWindows(): THREE.MeshLambertMaterial[] {
  return farmhouseWindowMats;
}

// Farmhouse model-swap machinery (Stage 4).
let farmhouseGroup: THREE.Group | null = null; // the positioned house group
let farmhouseProcVisual: THREE.Group | null = null; // procedural walls/roof (removed on swap)
let farmhouseUsesModel = false;

/** True once the farmhouse is rendering the GLB (diagnostic/test hook). */
export function sceneryModelsUsed(): boolean {
  return farmhouseUsesModel;
}

/** Preload + swap the farmhouse GLB. Removes the procedural walls/roof, adds the
 * model, and re-seats the glow window planes on the model facade so night-glow
 * still works. No-op on load failure (keeps the procedural house). */
export function preloadSceneryModels(): Promise<void> {
  return loadModel(modelUrl("buildings/farmhouse.glb")).then((m) => {
    if (!m || !farmhouseGroup || !farmhouseProcVisual) return;
    farmhouseGroup.remove(farmhouseProcVisual);
    farmhouseProcVisual.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    const inst = instantiateUnit(m).root; // unit box, base y=-0.5, centered
    inst.scale.set(FH_W, FH_H, FH_D);
    inst.position.y = FH_H / 2; // seat base on the ground (group is at ground level)
    farmhouseGroup.add(inst);
    // Re-seat the 2 glow window planes onto the model's front (house) facade —
    // the silo_house's house block sits toward -x, so cluster the lit windows
    // there rather than centred on the silo.
    farmhouseWindowMats.forEach((wm, i) => {
      const win = (wm.userData.plane as THREE.Mesh) || null;
      if (win) {
        win.position.set(i === 0 ? -2.4 : -1.3, 1.7, FH_D / 2 + 0.06);
      }
    });
    farmhouseUsesModel = true;
  });
}

// ---- Farmhouse blockout -----------------------------------------------------
function buildFarmhouse(): { group: THREE.Group; cx: number; cz: number } {
  const g = new THREE.Group();
  const { cx, cz } = FARMHOUSE_POS;
  const w = 8, d = 6, h = 4;
  const baseY = sampleHeight(cx, cz);

  // Procedural walls/roof/gables/door/chimney go in their OWN subgroup so the
  // GLB swap can remove them without touching the glow window planes.
  const proc = new THREE.Group();

  // walls
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat("#e8dcc0"));
  walls.position.set(0, h / 2, 0);
  walls.castShadow = true;
  walls.receiveShadow = true;
  proc.add(walls);

  // gabled roof — two slanted planes
  const roofMat = mat("#a6402f", { side: THREE.DoubleSide });
  const slopeLen = Math.hypot(w / 2, 2.4);
  for (const s of [-1, 1]) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(slopeLen, d + 0.8), roofMat);
    plane.position.set((s * w) / 4, h + 1.2, 0);
    plane.rotation.z = s * (Math.PI / 2 - Math.atan2(2.4, w / 2));
    plane.rotation.y = Math.PI / 2;
    plane.castShadow = true;
    proc.add(plane);
  }
  // gable end triangles
  const gableMat = mat("#d8ccb0");
  for (const s of [-1, 1]) {
    const tri = new THREE.Shape();
    tri.moveTo(-w / 2, 0);
    tri.lineTo(w / 2, 0);
    tri.lineTo(0, 2.4);
    tri.closePath();
    const gm = new THREE.Mesh(new THREE.ShapeGeometry(tri), gableMat);
    gm.position.set(0, h, (s * d) / 2);
    proc.add(gm);
  }

  // door
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.4), mat("#6b4a2b"));
  door.position.set(0, 1.2, d / 2 + 0.02);
  proc.add(door);
  // chimney
  const chim = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.8), mat("#8a5a45"));
  chim.position.set(w / 2 - 1.4, h + 1.6, -d / 4);
  chim.castShadow = true;
  proc.add(chim);
  g.add(proc);

  // window planes (P4: warm night glow via emissiveIntensity driven by
  // daynight.ts). Kept OUTSIDE `proc` so they survive the GLB swap; each mat
  // remembers its plane (userData.plane) so the swap can re-seat it.
  farmhouseWindowMats = [];
  for (const wx of [-w / 2 + 1.4, w / 2 - 1.4]) {
    const winMat = new THREE.MeshLambertMaterial({ color: "#fff4c2", emissive: new THREE.Color("#ffcf6b"), emissiveIntensity: 0 });
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), winMat);
    win.position.set(wx, 2.1, d / 2 + 0.02);
    win.renderOrder = 3;
    winMat.userData.plane = win;
    g.add(win);
    farmhouseWindowMats.push(winMat);
  }

  g.position.set(cx, baseY, cz);
  addBox(cx, cz, w / 2, d / 2);
  farmhouseGroup = g;
  farmhouseProcVisual = proc;
  return { group: g, cx, cz };
}

// ---- Pond -------------------------------------------------------------------
function buildPond(): THREE.Mesh {
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(POND.r, 40),
    new THREE.MeshLambertMaterial({
      color: new THREE.Color("#3f7fb8"),
      transparent: true,
      opacity: 0.78,
      emissive: new THREE.Color("#123852"),
    })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(POND.cx, POND.waterY, POND.cz);
  water.renderOrder = 2;
  // Collision radius padded ~+1.0m past the old (POND.r - 0.4): the player
  // used to stop exactly at the water's edge and visually stand in the pond.
  addCircle(POND.cx, POND.cz, POND.r + 0.6);
  return water;
}

// ---- Field fence ------------------------------------------------------------
function buildFieldFence(): THREE.Group {
  const g = new THREE.Group();
  const postMat = mat("#7a5230");
  const railMat = mat("#8a6236");
  const h = FIELD.half;
  const cx = FIELD.cx, cz = FIELD.cz;
  const postGeo = new THREE.BoxGeometry(0.3, 1.3, 0.3);
  const GAP = 3; // entry gap on the north (toward the house) side

  // build 4 sides as segments of posts + a top rail; skip the gap on +? side
  const corners = [
    [cx - h, cz - h],
    [cx + h, cz - h],
    [cx + h, cz + h],
    [cx - h, cz + h],
  ];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[(i + 1) % 4];
    const isGapSide = i === 1; // east->? pick the +x/+z edge nearest the house
    const len = Math.hypot(bx - ax, bz - az);
    const nSeg = Math.round(len);
    for (let s = 0; s <= nSeg; s++) {
      const t = s / nSeg;
      const gapMid = 0.5;
      if (isGapSide && Math.abs(t - gapMid) < GAP / (2 * len)) continue;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(px, sampleHeight(px, pz) + 0.55, pz);
      post.castShadow = true;
      g.add(post);
    }
    // rails: two per side, split around the gap
    const addRail = (t0: number, t1: number) => {
      const mx = ax + (bx - ax) * ((t0 + t1) / 2);
      const mz = az + (bz - az) * ((t0 + t1) / 2);
      const rl = len * (t1 - t0);
      if (rl < 0.2) return;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(rl, 0.16, 0.16), railMat);
      rail.position.set(mx, sampleHeight(mx, mz) + 0.9, mz);
      rail.rotation.y = Math.atan2(bz - az, bx - ax);
      g.add(rail);
      addSegment(
        ax + (bx - ax) * t0,
        az + (bz - az) * t0,
        ax + (bx - ax) * t1,
        az + (bz - az) * t1,
        0.28
      );
    };
    if (isGapSide) {
      const gh = GAP / (2 * len);
      addRail(0, 0.5 - gh);
      addRail(0.5 + gh, 1);
    } else {
      addRail(0, 1);
    }
  }
  return g;
}

// NOTE: the dirt walkways (house <-> field gate <-> pond) are no longer disc
// meshes here — they are PAINTED into the ground color (terrain.ts pathBlend /
// DEFAULT_PATH_PTS), so they conform to the terrain and cost nothing to draw.

// ---- Trees & rocks (instanced) ---------------------------------------------
// deterministic PRNG so the valley is stable across loads/tests
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function farFromStuff(x: number, z: number): boolean {
  // keep clear of field, pond, house, the pasture, and the spawn/centre
  if (Math.abs(x - FIELD.cx) < FIELD.half + 4 && Math.abs(z - FIELD.cz) < FIELD.half + 4)
    return false;
  if (Math.hypot(x - POND.cx, z - POND.cz) < POND.r + 5) return false;
  if (Math.abs(x - 24) < 8 && Math.abs(z - 20) < 8) return false;
  // the fenced pasture (a small margin so trunks don't clip the fence)
  if (x > PASTURE.minX - 3 && x < PASTURE.maxX + 3 && z > PASTURE.minZ - 3 && z < PASTURE.maxZ + 3) return false;
  if (Math.hypot(x, z) < 8) return false;
  return true;
}

function buildTrees(): { group: THREE.Group; occluder: InstancedOccluder } {
  const rnd = mulberry32(4242);
  const spots: { x: number; z: number; s: number }[] = [];
  let guard = 0;
  while (spots.length < 46 && guard++ < 4000) {
    const x = (rnd() * 2 - 1) * (MAP_HALF - 4);
    const z = (rnd() * 2 - 1) * (MAP_HALF - 4);
    if (!farFromStuff(x, z)) continue;
    spots.push({ x, z, s: 0.8 + rnd() * 0.7 });
  }

  const g = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.4, 2.4, 6);
  const canopyGeo = new THREE.SphereGeometry(1.5, 8, 6);
  const trunkMat = mat("#6f4a2c");
  const canopy1Mat = mat("#4f7d3a");
  const canopy2Mat = mat("#5f9046");
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
  const canopy1 = new THREE.InstancedMesh(canopyGeo, canopy1Mat, spots.length);
  const canopy2 = new THREE.InstancedMesh(canopyGeo, canopy2Mat, spots.length);
  trunks.castShadow = canopy1.castShadow = canopy2.castShadow = true;
  const dummy = new THREE.Object3D();
  const base: THREE.Matrix4[] = []; // trunk matrix per spot (for occlusion restore)
  const c1base: THREE.Matrix4[] = [];
  const c2base: THREE.Matrix4[] = [];

  spots.forEach((sp, i) => {
    const y = sampleHeight(sp.x, sp.z);
    dummy.position.set(sp.x, y + 1.2 * sp.s, sp.z);
    dummy.scale.setScalar(sp.s);
    dummy.rotation.set(0, i * 1.3, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    base.push(dummy.matrix.clone());

    dummy.position.set(sp.x, y + (2.6 + 0.2) * sp.s, sp.z);
    dummy.scale.setScalar(sp.s);
    dummy.updateMatrix();
    canopy1.setMatrixAt(i, dummy.matrix);
    c1base.push(dummy.matrix.clone());

    dummy.position.set(sp.x + 0.4 * sp.s, y + (3.4) * sp.s, sp.z - 0.3 * sp.s);
    dummy.scale.setScalar(sp.s * 0.75);
    dummy.updateMatrix();
    canopy2.setMatrixAt(i, dummy.matrix);
    c2base.push(dummy.matrix.clone());

    addCircle(sp.x, sp.z, 0.5 * sp.s);
  });
  g.add(trunks, canopy1, canopy2);

  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const occluder: InstancedOccluder = {
    name: "tree",
    meshes: [trunks, canopy1, canopy2],
    count: spots.length,
    spotXZ: (i) => ({ x: spots[i].x, z: spots[i].z }),
    setHidden: (i, hidden) => {
      trunks.setMatrixAt(i, hidden ? ZERO : base[i]);
      canopy1.setMatrixAt(i, hidden ? ZERO : c1base[i]);
      canopy2.setMatrixAt(i, hidden ? ZERO : c2base[i]);
      trunks.instanceMatrix.needsUpdate = true;
      canopy1.instanceMatrix.needsUpdate = true;
      canopy2.instanceMatrix.needsUpdate = true;
    },
    makeProxy: (i) => {
      const sp = spots[i];
      const y = sampleHeight(sp.x, sp.z);
      const pg = new THREE.Group();
      const tp = new THREE.Mesh(trunkGeo, trunkMat.clone());
      tp.position.set(sp.x, y + 1.2 * sp.s, sp.z);
      tp.scale.setScalar(sp.s);
      tp.rotation.y = i * 1.3;
      const cp1 = new THREE.Mesh(canopyGeo, canopy1Mat.clone());
      cp1.position.set(sp.x, y + 2.8 * sp.s, sp.z);
      cp1.scale.setScalar(sp.s);
      const cp2 = new THREE.Mesh(canopyGeo, canopy2Mat.clone());
      cp2.position.set(sp.x + 0.4 * sp.s, y + 3.4 * sp.s, sp.z - 0.3 * sp.s);
      cp2.scale.setScalar(sp.s * 0.75);
      pg.add(tp, cp1, cp2);
      return pg;
    },
  };
  return { group: g, occluder };
}

function buildRocks(): { mesh: THREE.InstancedMesh; occluder: InstancedOccluder } {
  const rnd = mulberry32(909);
  const spots: { x: number; z: number; s: number; rx: number; ry: number; rz: number }[] = [];
  let guard = 0;
  while (spots.length < 30 && guard++ < 3000) {
    const x = (rnd() * 2 - 1) * (MAP_HALF - 4);
    const z = (rnd() * 2 - 1) * (MAP_HALF - 4);
    if (!farFromStuff(x, z)) continue;
    spots.push({ x, z, s: 0.5 + rnd() * 0.9, rx: rnd() * 3, ry: rnd() * 6, rz: rnd() * 3 });
  }
  const geo = new THREE.DodecahedronGeometry(0.7, 0);
  const rockMat = mat("#8b8b8b");
  const m = new THREE.InstancedMesh(geo, rockMat, spots.length);
  m.castShadow = m.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const base: THREE.Matrix4[] = [];
  spots.forEach((sp, i) => {
    const y = sampleHeight(sp.x, sp.z);
    dummy.position.set(sp.x, y + 0.35 * sp.s, sp.z);
    dummy.scale.set(sp.s, sp.s * 0.7, sp.s);
    dummy.rotation.set(sp.rx, sp.ry, sp.rz);
    dummy.updateMatrix();
    m.setMatrixAt(i, dummy.matrix);
    base.push(dummy.matrix.clone());
    addCircle(sp.x, sp.z, 0.55 * sp.s);
  });
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const occluder: InstancedOccluder = {
    name: "rock",
    meshes: [m],
    count: spots.length,
    spotXZ: (i) => ({ x: spots[i].x, z: spots[i].z }),
    setHidden: (i, hidden) => {
      m.setMatrixAt(i, hidden ? ZERO : base[i]);
      m.instanceMatrix.needsUpdate = true;
    },
    makeProxy: (i) => {
      const sp = spots[i];
      const y = sampleHeight(sp.x, sp.z);
      const pg = new THREE.Group();
      const rp = new THREE.Mesh(geo, rockMat.clone());
      rp.position.set(sp.x, y + 0.35 * sp.s, sp.z);
      rp.scale.set(sp.s, sp.s * 0.7, sp.s);
      rp.rotation.set(sp.rx, sp.ry, sp.rz);
      pg.add(rp);
      return pg;
    },
  };
  return { mesh: m, occluder };
}

// NOTE: the decorative barn + silo "farmstead" that used to sit here was
// replaced by the FUNCTIONAL barn (world/barn3d.ts) — the animal husbandry
// rework. The barn/silo/fence + door now live in the pasture built by main.ts.

/** Occluder handles for the P6 camera-fade system (see world/occlusion.ts). */
export interface SceneryOccluders {
  trees: InstancedOccluder;
  rocks: InstancedOccluder;
  farmhouse: THREE.Group;
}

/** Build all scenery into a group and register its collisions. Also returns the
 * occluder handles the camera-fade manager needs (trees/rocks instanced fields +
 * the farmhouse group). */
export function buildScenery(): { group: THREE.Group; occluders: SceneryOccluders } {
  const g = new THREE.Group();
  g.add(buildFieldFence());
  g.add(buildPond());
  const house = buildFarmhouse();
  g.add(house.group);
  const trees = buildTrees();
  g.add(trees.group);
  const rocks = buildRocks();
  g.add(rocks.mesh);
  return { group: g, occluders: { trees: trees.occluder, rocks: rocks.occluder, farmhouse: house.group } };
}
