import * as THREE from "three";
import { CROP_ORDER, type CropId } from "./growth";
import { loadModel, instantiateSized, modelUrl, type LoadedModel } from "../world/gltfAssets";

// Crop meshes. STAGE 1 (art swap): the ready + young stages render QUATERNIUS
// CC0 crop models (see public/models/crops + LICENSE.txt); the sprout stage and
// any crop whose model fails to load fall back to the procedural chunky shapes
// below. The interface (`buildCropMesh(crop, stage) -> Group`, synchronous) is
// unchanged so field.ts's per-tile swap machinery is untouched — the GLBs load
// async and pop in (Farm Kart glb-prop pattern) via preloadCropModels() +
// a field re-sync once ready.
//
// Procedural 3-stage crop meshes (sprout -> young -> mature), Bistro-style
// chunky/readable shapes. Geometries are cached module-wide and reused across
// every tile's Mesh instance (cheap: only the Mesh/matrix differs per tile).

const geoCache = new Map<string, THREE.BufferGeometry>();
function cachedGeo(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = build();
    geoCache.set(key, g);
  }
  return g;
}

const matCache = new Map<string, THREE.MeshLambertMaterial>();
function cachedMat(color: string): THREE.MeshLambertMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
    matCache.set(color, m);
  }
  return m;
}

function mesh(geoKey: string, build: () => THREE.BufferGeometry, color: string): THREE.Mesh {
  const g = cachedGeo(geoKey, build);
  const m = new THREE.Mesh(g, cachedMat(color));
  m.castShadow = true;
  return m;
}

function leafBlade(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.06, 0.34, 4);
  return g;
}

// ---- Turnip: purple/white bulb with a leafy top ----------------------------
function buildTurnip(g: THREE.Group, stage: 0 | 1 | 2): void {
  if (stage === 0) {
    const sprout = mesh("turnip-sprout", () => leafBlade(), "#5a9a4a");
    sprout.position.y = 0.17;
    g.add(sprout);
    return;
  }
  // leaves
  const leafCount = stage === 1 ? 3 : 5;
  for (let i = 0; i < leafCount; i++) {
    const a = (i / leafCount) * Math.PI * 2;
    const leaf = mesh("turnip-leaf", () => leafBlade(), "#4f8d3f");
    leaf.position.set(Math.cos(a) * 0.1, 0.24, Math.sin(a) * 0.1);
    leaf.rotation.z = Math.cos(a) * 0.5;
    leaf.rotation.x = Math.sin(a) * 0.5;
    g.add(leaf);
  }
  if (stage === 2) {
    const white = mesh("turnip-bulb-white", () => new THREE.SphereGeometry(0.16, 8, 6), "#f2ecd8");
    white.position.y = 0.06;
    white.scale.y = 0.85;
    g.add(white);
    const purple = mesh("turnip-bulb-purple", () => new THREE.SphereGeometry(0.13, 8, 6), "#7a4a8f");
    purple.position.y = 0.14;
    purple.scale.y = 0.6;
    g.add(purple);
  }
}

// ---- Potato: leafy bush, mature reveals tan mounds at the base -------------
function buildPotato(g: THREE.Group, stage: 0 | 1 | 2): void {
  if (stage === 0) {
    const sprout = mesh("potato-sprout", () => leafBlade(), "#5f9a3f");
    sprout.position.y = 0.17;
    g.add(sprout);
    return;
  }
  const bushGeo = () => new THREE.SphereGeometry(0.22, 8, 6);
  const bush = mesh("potato-bush", bushGeo, "#427a34");
  bush.scale.set(1, stage === 1 ? 0.7 : 0.9, 1);
  bush.position.y = stage === 1 ? 0.24 : 0.3;
  g.add(bush);
  if (stage === 2) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      const mound = mesh("potato-mound", () => new THREE.SphereGeometry(0.09, 6, 5), "#c9a15f");
      mound.position.set(Math.cos(a) * 0.2, 0.06, Math.sin(a) * 0.2);
      mound.scale.set(1.2, 0.7, 1);
      g.add(mound);
    }
  }
}

// ---- Corn: stalk with leaves, mature grows visible yellow ears -------------
function buildCorn(g: THREE.Group, stage: 0 | 1 | 2): void {
  if (stage === 0) {
    const sprout = mesh("corn-sprout", () => leafBlade(), "#4f9a3f");
    sprout.position.y = 0.18;
    g.add(sprout);
    return;
  }
  const stalkH = stage === 1 ? 0.55 : 0.95;
  const stalk = mesh(`corn-stalk-${stage}`, () => new THREE.CylinderGeometry(0.045, 0.06, 1, 6), "#3f7a2f");
  stalk.scale.y = stalkH;
  stalk.position.y = (stalkH * 1) / 2;
  g.add(stalk);
  const leafCount = stage === 1 ? 2 : 3;
  for (let i = 0; i < leafCount; i++) {
    const leaf = mesh("corn-leaf", () => new THREE.ConeGeometry(0.05, 0.4, 4), "#4f9a3f");
    const a = (i / leafCount) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.08, stalkH * 0.55, Math.sin(a) * 0.08);
    leaf.rotation.z = Math.PI / 2 + Math.sin(a) * 0.6;
    leaf.rotation.y = a;
    g.add(leaf);
  }
  if (stage === 2) {
    for (const s of [-1, 1]) {
      const ear = mesh("corn-ear", () => new THREE.CylinderGeometry(0.05, 0.06, 0.32, 6), "#e8c23f");
      ear.position.set(s * 0.1, stalkH * 0.65, 0.06);
      ear.rotation.z = s * 0.35;
      g.add(ear);
    }
  }
}

// ---- Pumpkin: vine leaves, mature grows a big orange ribbed fruit ----------
function buildPumpkin(g: THREE.Group, stage: 0 | 1 | 2): void {
  if (stage === 0) {
    const sprout = mesh("pumpkin-sprout", () => leafBlade(), "#4f8a3f");
    sprout.position.y = 0.17;
    g.add(sprout);
    return;
  }
  const leafCount = stage === 1 ? 3 : 4;
  for (let i = 0; i < leafCount; i++) {
    const a = (i / leafCount) * Math.PI * 2;
    const leaf = mesh("pumpkin-vine-leaf", () => new THREE.ConeGeometry(0.14, 0.06, 5), "#3f7a34");
    leaf.position.set(Math.cos(a) * 0.22, 0.05, Math.sin(a) * 0.22);
    leaf.rotation.x = Math.PI / 2;
    leaf.rotation.z = a;
    g.add(leaf);
  }
  if (stage === 1) {
    const small = mesh("pumpkin-small", () => new THREE.SphereGeometry(0.11, 8, 6), "#5f9a3f");
    small.scale.y = 0.8;
    small.position.y = 0.1;
    g.add(small);
  } else {
    const body = mesh("pumpkin-body", () => new THREE.SphereGeometry(0.27, 10, 8), "#e07a2a");
    body.scale.y = 0.78;
    body.position.y = 0.22;
    g.add(body);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rib = mesh("pumpkin-rib", () => new THREE.BoxGeometry(0.02, 0.4, 0.06), "#c96422");
      rib.position.set(Math.cos(a) * 0.26, 0.22, Math.sin(a) * 0.26);
      rib.rotation.y = -a;
      g.add(rib);
    }
    const stem = mesh("pumpkin-stem", () => new THREE.CylinderGeometry(0.03, 0.045, 0.16, 6), "#6b7a2a");
    stem.position.y = 0.5;
    g.add(stem);
  }
}

// ---- Strawberry: low leafy bush; flowers at 1, red berries at 2 ------------
function buildStrawberry(g: THREE.Group, stage: 0 | 1 | 2): void {
  if (stage === 0) {
    const sprout = mesh("straw-sprout", () => leafBlade(), "#5a9a4a");
    sprout.position.y = 0.16;
    g.add(sprout);
    return;
  }
  const leafCount = stage === 1 ? 4 : 5;
  for (let i = 0; i < leafCount; i++) {
    const a = (i / leafCount) * Math.PI * 2;
    const leaf = mesh("straw-leaf", () => new THREE.SphereGeometry(0.12, 6, 5), "#3f8a3a");
    leaf.position.set(Math.cos(a) * 0.14, 0.12, Math.sin(a) * 0.14);
    leaf.scale.set(1, 0.5, 1);
    g.add(leaf);
  }
  if (stage === 1) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const flower = mesh("straw-flower", () => new THREE.SphereGeometry(0.045, 6, 5), "#fbf6ea");
      flower.position.set(Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12);
      g.add(flower);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.3;
      const berry = mesh("straw-berry", () => new THREE.SphereGeometry(0.075, 7, 6), "#e23b3b");
      berry.position.set(Math.cos(a) * 0.15, 0.16, Math.sin(a) * 0.15);
      berry.scale.set(1, 1.15, 1);
      g.add(berry);
      const sepal = mesh("straw-sepal", () => new THREE.ConeGeometry(0.05, 0.05, 5), "#3f8a3a");
      sepal.position.set(Math.cos(a) * 0.15, 0.24, Math.sin(a) * 0.15);
      g.add(sepal);
    }
  }
}

// ---- Carrot: leafy top; mature shows an orange crown at soil level ---------
function buildCarrot(g: THREE.Group, stage: 0 | 1 | 2): void {
  if (stage === 0) {
    const sprout = mesh("carrot-sprout", () => leafBlade(), "#5f9a3f");
    sprout.position.y = 0.16;
    g.add(sprout);
    return;
  }
  // feathery green top (leaf-only, like the turnip's leaf stage)
  const leafCount = stage === 1 ? 4 : 6;
  for (let i = 0; i < leafCount; i++) {
    const a = (i / leafCount) * Math.PI * 2;
    const leaf = mesh("carrot-leaf", () => new THREE.ConeGeometry(0.045, 0.36, 4), "#4f9a3f");
    leaf.position.set(Math.cos(a) * 0.09, 0.24, Math.sin(a) * 0.09);
    leaf.rotation.z = Math.cos(a) * 0.35;
    leaf.rotation.x = Math.sin(a) * 0.35;
    g.add(leaf);
  }
  if (stage === 2) {
    // just the crown/shoulder peeking above soil — a tapered orange cone (carrots
    // grow mostly underground, so show only the top ~30%).
    const crown = mesh("carrot-crown", () => new THREE.ConeGeometry(0.11, 0.22, 8), "#e07a24");
    crown.position.y = 0.05;
    g.add(crown);
  }
}

// ---- Tomato: staked vine; mature clusters red fruit near the top -----------
function buildTomato(g: THREE.Group, stage: 0 | 1 | 2): void {
  if (stage === 0) {
    const sprout = mesh("tomato-sprout", () => leafBlade(), "#4f9a3f");
    sprout.position.y = 0.17;
    g.add(sprout);
    return;
  }
  const stakeH = stage === 1 ? 0.5 : 0.95;
  // wooden support stake beside the vine
  const stake = mesh(`tomato-stake-${stage}`, () => new THREE.CylinderGeometry(0.028, 0.028, 1, 5), "#b58a4a");
  stake.scale.y = stakeH + 0.15;
  stake.position.set(0.12, (stakeH + 0.15) / 2, 0);
  g.add(stake);
  // green vine
  const vine = mesh(`tomato-vine-${stage}`, () => new THREE.CylinderGeometry(0.04, 0.055, 1, 6), "#3f7a34");
  vine.scale.y = stakeH;
  vine.position.y = stakeH / 2;
  g.add(vine);
  const leafCount = stage === 1 ? 2 : 4;
  for (let i = 0; i < leafCount; i++) {
    const a = (i / leafCount) * Math.PI * 2;
    const leaf = mesh("tomato-leaf", () => new THREE.ConeGeometry(0.06, 0.22, 4), "#4f9a3f");
    leaf.position.set(Math.cos(a) * 0.09, stakeH * 0.5, Math.sin(a) * 0.09);
    leaf.rotation.z = Math.PI / 2 + Math.sin(a) * 0.5;
    leaf.rotation.y = a;
    g.add(leaf);
  }
  if (stage === 2) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const fruit = mesh("tomato-fruit", () => new THREE.SphereGeometry(0.08, 8, 6), "#e03a2a");
      fruit.position.set(Math.cos(a) * 0.12, stakeH * 0.72, Math.sin(a) * 0.12);
      g.add(fruit);
    }
  }
}

// ---- Sunflower: the capstone — a TALL stalk topped with a big yellow head --
function buildSunflower(g: THREE.Group, stage: 0 | 1 | 2): void {
  if (stage === 0) {
    const sprout = mesh("sun-sprout", () => leafBlade(), "#4f9a3f");
    sprout.position.y = 0.18;
    g.add(sprout);
    return;
  }
  const stalkH = stage === 1 ? 0.75 : 1.4; // noticeably the tallest crop
  const stalk = mesh(`sun-stalk-${stage}`, () => new THREE.CylinderGeometry(0.05, 0.08, 1, 6), "#4a7a2f");
  stalk.scale.y = stalkH;
  stalk.position.y = stalkH / 2;
  g.add(stalk);
  const leafCount = stage === 1 ? 2 : 3;
  for (let i = 0; i < leafCount; i++) {
    const a = (i / leafCount) * Math.PI * 2;
    const leaf = mesh("sun-leaf", () => new THREE.ConeGeometry(0.09, 0.3, 5), "#4f9a3f");
    leaf.position.set(Math.cos(a) * 0.1, stalkH * 0.45, Math.sin(a) * 0.1);
    leaf.rotation.z = Math.PI / 2 + Math.sin(a) * 0.5;
    leaf.rotation.y = a;
    g.add(leaf);
  }
  if (stage === 1) {
    // small unopened green bud
    const bud = mesh("sun-bud", () => new THREE.SphereGeometry(0.11, 8, 6), "#6f9a3a");
    bud.scale.y = 0.8;
    bud.position.y = stalkH + 0.05;
    g.add(bud);
  } else {
    // big flower head: dark brown center disc + a radiating ring of petal cones
    const center = mesh("sun-center", () => new THREE.CylinderGeometry(0.17, 0.17, 0.08, 14), "#6b4a24");
    center.position.y = stalkH + 0.05;
    g.add(center);
    const petals = 12;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      const petal = mesh("sun-petal", () => new THREE.ConeGeometry(0.055, 0.2, 4), "#f2c21f");
      petal.position.set(Math.cos(a) * 0.24, stalkH + 0.05, Math.sin(a) * 0.24);
      petal.rotation.z = Math.PI / 2;
      petal.rotation.y = -a;
      g.add(petal);
    }
  }
}

const BUILDERS: Record<CropId, (g: THREE.Group, stage: 0 | 1 | 2) => void> = {
  turnip: buildTurnip,
  potato: buildPotato,
  corn: buildCorn,
  pumpkin: buildPumpkin,
  strawberry: buildStrawberry,
  carrot: buildCarrot,
  tomato: buildTomato,
  sunflower: buildSunflower,
};

/** Build the PROCEDURAL crop mesh (fallback when the GLB is absent/unloaded). */
function buildProceduralCropMesh(crop: CropId, stage: 0 | 1 | 2): THREE.Group {
  const g = new THREE.Group();
  BUILDERS[crop](g, stage);
  return g;
}

// ---- Quaternius GLB crop models --------------------------------------------
// One model per crop (no per-stage GLB): the model is the READY look; stage 1
// (young) is the same model scaled down; stage 0 (sprout) stays the procedural
// green sprout so early growth reads as "just poked through". `CROP_SIZE` is the
// ready max-dimension in world units, tuned to read at chase-cam distance like
// the old procedural crops (sunflower/corn tallest).
const CROP_MODEL_FILE: Record<CropId, string> = {
  turnip: "crops/turnip.glb",
  potato: "crops/potato.glb",
  corn: "crops/corn.glb",
  pumpkin: "crops/pumpkin.glb",
  strawberry: "crops/strawberry.glb",
  carrot: "crops/carrot.glb",
  tomato: "crops/tomato.glb",
  sunflower: "crops/sunflower.glb",
};
const CROP_SIZE: Record<CropId, number> = {
  turnip: 0.5,
  potato: 0.62,
  corn: 0.95,
  pumpkin: 0.62,
  strawberry: 0.42,
  carrot: 0.52,
  tomato: 0.5,
  sunflower: 1.15,
};
const STAGE1_MULT = 0.6; // young = 60% of ready size

const templates = new Map<CropId, LoadedModel | null>();
let preloaded = false;

/** Kick off loading all 8 crop GLBs (idempotent, cached). Resolves after every
 * load settles (success OR failure — a failed crop just keeps its procedural
 * mesh). Callers re-sync the field once this resolves so planted crops pop in. */
export function preloadCropModels(): Promise<void> {
  return Promise.all(
    CROP_ORDER.map(async (id) => {
      const m = await loadModel(modelUrl(CROP_MODEL_FILE[id]));
      templates.set(id, m);
    })
  ).then(() => {
    preloaded = true;
  });
}

/** True once preloadCropModels() has settled (test/diagnostic hook). */
export function cropModelsReady(): boolean {
  return preloaded;
}

/** True if THIS crop resolved to a real GLB template (not the procedural
 * fallback) — used by verify-p8 to assert the swap actually happened. */
export function cropUsesModel(crop: CropId): boolean {
  return !!templates.get(crop);
}

/** Build a fresh crop-stage mesh group, seated at y=0 (caller positions it).
 * Uses the Quaternius GLB for the young/ready stages when loaded; else the
 * procedural fallback. Stage 0 (sprout) is always the procedural sprout. */
export function buildCropMesh(crop: CropId, stage: 0 | 1 | 2): THREE.Group {
  const tpl = templates.get(crop);
  if (tpl && stage > 0) {
    const g = new THREE.Group();
    g.userData.glb = true; // marker for verify-p8 (swap actually happened)
    const size = CROP_SIZE[crop] * (stage === 1 ? STAGE1_MULT : 1);
    const inst = instantiateSized(tpl, size);
    g.add(inst.root);
    return g;
  }
  return buildProceduralCropMesh(crop, stage);
}
