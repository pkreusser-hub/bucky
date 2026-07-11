import * as THREE from "three";
import { loadTune } from "./tune";
import { buildGroundMesh, sampleHeight, POND, FIELD, EDGE, MAP_HALF, setActiveWorld } from "./world/terrain";
import { buildScenery } from "./world/scenery";
import { resolveCollision, addCircle, addBox, addSegment, wouldCollide, removeByTag, obstacleCount } from "./world/collision";
import { Occlusion } from "./world/occlusion";
import { FarmAudio } from "./audio";
import { DecorField, DECOR, buildDecorMesh, tintGhost, newDecorId, type DecorRecord } from "./world/decor";
import { currentPlayerName } from "./net/firebase";
import { checkMilestones, MILESTONES, type MilestoneFacts } from "./farm/milestones";
import type { MetaState } from "./net/sync";
import { loadWorldDataSync } from "./world/worldStore";
import { buildPropMesh, buildFenceMesh, PROPS, preloadBuildingModels, propUsesModel, buildingModelsReady } from "./world/props";
import type { WorldData } from "./world/worldData";
import { buildFarmer, preloadCharacterModel, characterModelReady } from "./player/player";
import { buildTool } from "./player/tools";
import { Controls } from "./player/controls";
import { TouchControls, isMobile } from "./player/touch";
import { ChaseCam } from "./camera/chaseCam";
import { buildTunePanel } from "./ui/tunePanel";
import { installDebug, type PlayerState } from "./debug";
import { buildHud, type InventoryData } from "./ui/hud";
import { drawFarmMap, invalidateFarmMapBackground, type FarmMapSnapshot, type MapTileCell } from "./ui/farmMap";
import { now as flNow, setTimeOffset, addTimeOffset } from "./farm/time";
import { LocalFarmStore, defaultFarmState, sanitizeFarmState, type FarmState, type FarmStore, type TileRecord } from "./farm/store";
import { tileKey, parseTileKey, tileCenter, worldToTile, GRID, TILE_SIZE } from "./farm/grid";
import { CROPS, CROP_ORDER, CropId, plantTile, waterTile, growthStage, needsWater, effectiveCrop, setFastGrow } from "./farm/growth";
import { FarmlifeSession } from "./net/session";
import { Presence } from "./net/presence";
import { FarmLobby } from "./net/lobby";
import { RemotePlayers } from "./player/remotePlayers";
import { makeEmoteBubble, type EmoteKind, EMOTE_ORDER } from "./player/emote";
import { CloudFarmStore, CloudAnimalStore, type LiveFarmStore, type LiveAnimalStore } from "./farm/cloudStore";
import { CloudWorldStore } from "./world/cloudWorldStore";
import { diffTiles } from "./net/sync";
import { isEmptyWorldData } from "./world/worldData";
import { Field3D, findTargetTile, computeTileState } from "./farm/field";
import { buildCropMesh, preloadCropModels, cropModelsReady, cropUsesModel } from "./farm/cropVisuals";
import { buildShippingBin, buildSeedStand, distanceTo, type Station } from "./farm/stations";
import {
  resolveAction,
  tankConsume,
  tankRefill,
  TOOL_ORDER,
  TOOL_META,
  type ToolId,
  type Verb,
  type ActionResolution,
} from "./farm/action";
import { shirtTint } from "./net/presenceUtil";
import { LocalAnimalStore, LocalDecorStore, LocalMetaStore, LocalBarnStore, type AnimalStore, type DecorStore, type MetaStore, type BarnStore, type BarnData } from "./farm/store";
import { CloudDecorStore, CloudMetaStore, CloudBarnStore, type LiveDecorStore, type LiveMetaStore, type LiveBarnStore } from "./farm/cloudStore";
import {
  ANIMAL_DEFS,
  STARTER_HERD,
  PRODUCE_ORDER,
  resolveAnimalAction,
  collectProduce,
  produceInfo,
  produceReady,
  type AnimalRecord,
  type AnimalInteraction,
} from "./farm/animals";
import { AnimalField, preloadAnimalModels } from "./world/animals3d";
import {
  PASTURE,
  BARN,
  GATE,
  GATE_CENTER,
  dayPhase,
  eggId,
  nestSpot,
  defaultDoorState,
  type DoorState,
  type EggRecord,
} from "./farm/pasture";
import { buildBarnScene, preloadBarnModel, type BarnScene } from "./world/barn3d";
import { farmhouseWindows, FARMHOUSE_POS, preloadSceneryModels, sceneryModelsUsed } from "./world/scenery";
import { skyAt, centralHour } from "./world/daynight";
import { WeatherStation, weatherEmoji, RAIN_AUTO_WATER_INTERVAL_MS } from "./world/weather";
import { buildStars, buildPrecip } from "./world/precip";

const tune = loadTune();
// FAST-GROW (test mode): apply the interpretation flag before any growth read
// (field.syncAll, computeTileState, etc.). Default ON — see tune.ts (ship blocker).
setFastGrow(tune.fastGrow);

// ---- audio (P6): WebAudio synth SFX + ambient beds; resumed on first gesture
const audio = new FarmAudio();
function armAudioGesture(): void {
  const resume = () => {
    audio.resume();
    window.removeEventListener("pointerdown", resume);
    window.removeEventListener("keydown", resume);
    window.removeEventListener("touchstart", resume);
  };
  window.addEventListener("pointerdown", resume, { once: false });
  window.addEventListener("keydown", resume, { once: false });
  window.addEventListener("touchstart", resume, { once: false });
}
armAudioGesture();

// ---- renderer (modern three.js color management) ---------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; // r150+ default is sRGB; be explicit
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const app = document.getElementById("app")!;
app.appendChild(renderer.domElement);

// ---- scene + warm afternoon lighting ---------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color("#8fc0e8");
scene.fog = new THREE.Fog(new THREE.Color("#a9cbe0"), 90, 150);

const hemi = new THREE.HemisphereLight(new THREE.Color("#dff0ff"), new THREE.Color("#6b8c4a"), 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(new THREE.Color("#fff2d6"), 1.15);
sun.position.set(40, 60, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 200;
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70;
sc.updateProjectionMatrix();
scene.add(sun);
scene.add(sun.target);
const amb = new THREE.AmbientLight(new THREE.Color("#ffffff"), 0.18);
scene.add(amb);

// ---- world -----------------------------------------------------------------
// Load the editor's WorldData BEFORE the ground so sculpt/paint bake into the
// mesh and sampleHeight (empty world = the handcrafted valley, byte-identical).
const world: WorldData = loadWorldDataSync();
setActiveWorld(world);
let ground = buildGroundMesh();
scene.add(ground);
const sceneryBuilt = buildScenery();
scene.add(sceneryBuilt.group);
const sceneryOccluders = sceneryBuilt.occluders;
// editor-placed objects/fences live in their own group so a P2 world-doc
// reconcile can clear + re-spawn them without duplicating (or touching the
// base scenery's own colliders/meshes).
const worldPropsGroup = new THREE.Group();
scene.add(worldPropsGroup);
applyWorld(world);

// Stage 4 art swap: preload the Quaternius building GLBs (farmhouse in scenery,
// barn/shed/silo in props), then swap the farmhouse, re-apply editor-placed
// props as models, and rebuild the decorative farmstead. Fallback stays if the
// models can't load (offline/404).
void Promise.all([preloadSceneryModels(), preloadBuildingModels()]).then(() => {
  applyWorld(world);
});

/** Spawn the editor-placed props + fences and register their collisions.
 * Re-invocable: clears its own group AND retracts its previous colliders (all
 * tagged "world") before re-adding, so a P2 world-doc change / re-apply never
 * leaves duplicate meshes OR stale colliders behind (the old P2 limitation is
 * fixed — see world/collision.ts removeByTag). */
function applyWorld(w: WorldData): void {
  removeByTag("world"); // retract the previous layer's colliders (clean rebuild)
  for (const c of [...worldPropsGroup.children]) {
    worldPropsGroup.remove(c);
    c.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      if (mat) mat.dispose();
    });
  }
  for (const o of w.objects) {
    const g = buildPropMesh(o.type);
    g.position.set(o.x, o.y, o.z);
    g.scale.set(o.sx, o.sy, o.sz);
    g.rotation.y = o.rotY;
    worldPropsGroup.add(g);
    const def = PROPS[o.type];
    if (!def || def.collide === "none") continue;
    if (def.collide === "box") {
      addBox(o.x, o.z, Math.abs(o.sx) / 2, Math.abs(o.sz) / 2, "world");
    } else {
      addCircle(o.x, o.z, (def.cf ?? 0.4) * Math.max(Math.abs(o.sx), Math.abs(o.sz)), "world");
    }
  }
  for (const f of w.fences) {
    worldPropsGroup.add(buildFenceMesh(f, sampleHeight));
    for (let i = 0; i < f.points.length - 1; i++) {
      const a = f.points[i], b = f.points[i + 1];
      addSegment(a.x, a.z, b.x, b.z, 0.22, "world");
    }
  }
}

// ---- farming loop ------------------------------------------------------------
const field = new Field3D();
scene.add(field.group);
// Stage 1 art swap: preload the Quaternius crop GLBs, then re-sync the whole
// field so any already-planted crops pop in as models (glb-prop pop-in pattern).
void preloadCropModels().then(() => field.syncAll(farmState, flNow()));
const bin: Station = buildShippingBin();
scene.add(bin.group);
const stand: Station = buildSeedStand();
scene.add(stand.group);

let farmStore: FarmStore = new LocalFarmStore();
let farmState: FarmState = defaultFarmState();
const hud = buildHud();

function tankCap(): number {
  return Math.max(1, Math.round(tune.tankCapacity));
}

function persistFarm(): void {
  farmStore.save(farmState);
}

// ---- tool equip + hotbar sync -----------------------------------------------
let heldToolMesh: THREE.Object3D | null = null;

function refreshToolHud(): void {
  hud.setTools({
    selectedTool: farmState.selectedTool,
    tank: farmState.tank,
    tankCap: tankCap(),
    cropEmoji: CROPS[farmState.selectedCrop].emoji,
    seedCount: farmState.seeds[farmState.selectedCrop],
  });
  if (heldToolMesh && farmState.selectedTool === "can") {
    (heldToolMesh.userData.setFilled as ((f: boolean) => void) | undefined)?.(farmState.tank > 0);
  }
}

function equipTool(id: ToolId): void {
  farmState.selectedTool = id;
  const mesh = buildTool(id);
  heldToolMesh = mesh;
  player.setHeldTool(mesh);
  if (mesh && id === "can") {
    (mesh.userData.setFilled as ((f: boolean) => void) | undefined)?.(farmState.tank > 0);
  }
  refreshToolHud();
  persistFarm();
}

function cycleCrop(): void {
  const i = CROP_ORDER.indexOf(farmState.selectedCrop);
  farmState.selectedCrop = CROP_ORDER[(i + 1) % CROP_ORDER.length];
  refreshToolHud();
  persistFarm();
}

farmStore.load().then((loaded) => {
  if (loaded) farmState = loaded;
  if (farmState.tank > tankCap()) farmState.tank = tankCap();
  field.syncAll(farmState, flNow());
  hud.setCoins(farmState.coins);
  equipTool(farmState.selectedTool);
});

// ---- Animals + pasture + barn (husbandry rework) ----------------------------
// A large fenced PASTURE encloses the functional BARN. Animals roam the pasture
// by day, walk to the barn at dusk, sleep at night — all derived from the shared
// clock (dayPhase) so every device agrees. The barn has a hinged DOOR (shared
// state) that gates whether animals can go inside; chickens lay PHYSICAL eggs on
// the barn floor; the goat is milked/pet by hand.
const barnScene: BarnScene = buildBarnScene(sampleHeight);
scene.add(barnScene.group);
barnScene.onCreak = () => audio.hoe(); // creak-adjacent synth click on toggle
// beauty-pass art swap: bespoke Blender barn2.glb replaces the procedural
// walls/roof/floor/nests/door slab in place (fallback stays if it can't load).
void preloadBarnModel(barnScene);

const animalField = new AnimalField(STARTER_HERD.map((s) => ({ id: s.id, type: s.type })));
scene.add(animalField.group);
// Stage 3 art swap: preload Quaternius animal GLBs, then swap the herd in place.
void preloadAnimalModels().then(() => animalField.swapToModels());

let animalStore: AnimalStore = new LocalAnimalStore();
let herd: Record<string, AnimalRecord> = {};

function persistHerd(): void {
  animalStore.save(herd);
}

animalStore.load().then((loaded) => {
  if (loaded) herd = loaded;
});

// ---- barn door + physical eggs (shared) -------------------------------------
let barnStore: BarnStore = new LocalBarnStore();
let doorState: DoorState = defaultDoorState();
let eggs: Record<string, EggRecord> = {};
const myPlayerName = currentPlayerName();
// one-time gentle nudge when the herd is left waiting at a shut door at night
let barnWaitToastShown = false;

function persistDoor(): void {
  barnStore.setDoor(doorState);
}
function refreshEggMeshes(): void {
  barnScene.syncEggs(Object.values(eggs));
}

barnStore.load().then((data: BarnData) => {
  doorState = data.door;
  eggs = data.eggs;
  barnScene.setDoorOpen(doorState.open, false);
  refreshEggMeshes();
});

/** Toggle the barn door (player action). Shared state + creak + live animation. */
function toggleBarnDoor(): void {
  doorState = { open: !doorState.open, at: flNow() };
  barnScene.setDoorOpen(doorState.open, true);
  persistDoor();
  hud.toast(doorState.open ? "🚪 Opened the barn door" : "🚪 Closed the barn door");
}

/** Spawn eggs for any chicken whose produce cycle is ready (deterministic id,
 * only-if-absent → never a duplicate). Called each tick + on herd changes. */
function maybeLayEggs(nowMs: number): void {
  let changed = false;
  for (const spec of STARTER_HERD) {
    if (spec.type !== "chicken") continue;
    const a = herd[spec.id];
    if (!a) continue;
    if (!produceReady(a, ANIMAL_DEFS.chicken, nowMs)) continue;
    const id = eggId(spec.id, a.lastFed);
    if (eggs[id]) continue; // already laid this cycle (or collected — collectedBy stays)
    const nest = nestSpot(spec.id);
    const rec: EggRecord = { id, chickenId: spec.id, spawnedAt: nowMs, x: nest.x, z: nest.z };
    eggs[id] = rec;
    barnStore.putEgg(rec);
    changed = true;
  }
  if (changed) refreshEggMeshes();
}

/** Collect the egg with `id`: +1 egg, advance the laying chicken's cycle, and
 * write collectedBy (Firestore LWW resolves a two-player race to ONE keeper;
 * everyone else reconciles to loser in applyRemoteBarn). */
function collectEgg(id: string, wx: number, wy: number, wz: number): void {
  const e = eggs[id];
  if (!e || e.collectedBy) return;
  const now = flNow();
  const rec: EggRecord = { ...e, collectedBy: myPlayerName, collectedAt: now };
  eggs[id] = rec;
  barnStore.putEgg(rec);
  // advance the laying chicken's cycle (source of truth stays the lazy model)
  const a = herd[e.chickenId];
  if (a) {
    herd[e.chickenId] = { ...a, ...collectProduce(a, ANIMAL_DEFS.chicken, now) };
    persistHerd();
  }
  farmState.produce.egg += 1;
  refreshToolHud();
  persistFarm();
  refreshEggMeshes();
  hud.toast("🥚 +1 Egg!");
  field.spawnPop(wx, wy, wz, "🥚");
  audio.harvest();
  animalField.wake(e.chickenId);
  recordMilestoneEvent({ eggEvent: true }); // First Egg
}

// ---- P5: decorations (shared, persistent) + meta (shipped totals + milestones)
const decorField = new DecorField(sampleHeight);
scene.add(decorField.group);
let decorStore: DecorStore = new LocalDecorStore();
let decor: Record<string, DecorRecord> = {};

function persistDecor(): void {
  decorStore.save(decor);
}

decorStore.load().then((loaded) => {
  decor = loaded;
  decorField.syncAll(decor);
});

let metaStore: MetaStore = new LocalMetaStore();
let meta: MetaState = { shipped: {}, milestones: {}, farmName: "Amen Acres", foundedAt: 0 };

metaStore.load().then((loaded) => {
  if (loaded) meta = loaded;
  if (!meta.foundedAt) {
    meta.foundedAt = flNow();
    metaStore.setInit(meta.farmName, meta.foundedAt);
  }
});

// ---- P5: milestone machinery (pure check + persist + celebrate) -------------
function currentFacts(extra: Partial<MilestoneFacts> = {}): MilestoneFacts {
  return { shipped: meta.shipped, decorCount: decorField.count(), earned: meta.milestones, ...extra };
}
/** Flip + persist + celebrate each newly-earned milestone (guarded write-once). */
function flipMilestones(keys: string[], celebrate = true): void {
  const now = flNow();
  for (const key of keys) {
    if (meta.milestones[key]) continue;
    meta.milestones[key] = now;
    metaStore.setMilestone(key, now);
    if (celebrate) celebrateMilestone(key);
  }
  if (keys.length && hud.isFarmBookOpen()) openFarmBook();
}
function recordMilestoneEvent(extra: Partial<MilestoneFacts>): void {
  flipMilestones(checkMilestones(currentFacts(extra)));
}
/** A sale just shipped these per-id quantities: bump meta totals (local optimistic
 * + persisted delta) then re-check the shipped-threshold milestones. */
function applyShipped(deltas: Record<string, number>): void {
  for (const [id, d] of Object.entries(deltas)) meta.shipped[id] = (meta.shipped[id] ?? 0) + d;
  metaStore.addShipped(deltas);
  recordMilestoneEvent({});
}
function celebrateMilestone(key: string): void {
  const def = MILESTONES.find((m) => m.key === key);
  hud.toast(`🏅 Milestone: ${def?.label ?? key} ${def?.emoji ?? ""}`);
  audio.milestone();
  spawnConfetti(player.root.position.x, player.root.position.y + 1.6, player.root.position.z);
}
/** Cheap colorful celebration burst (reuses Field3D's pooled particle system). */
function spawnConfetti(x: number, y: number, z: number): void {
  const cols = [0xe23b3b, 0xf2c14e, 0x3f7fd0, 0x4f9a3f, 0xe86a8f];
  for (const c of cols) field.spawnBurst(x, y, z, c, 8, 1.7);
}

// ---- P2: persistent shared world (Firestore) --------------------------------
// Local-first boot above is UNCHANGED (P0/P1/P1.5 feel + tests stay byte-
// identical when Firebase is unreachable/blocked). This is a background
// upgrade: once a server-confirmed Firestore snapshot arrives, reconcile onto
// whatever's already on screen and switch future saves to the cloud. Offline/
// blocked/failed init leaves everything exactly as it was above — 0 crashes,
// 0 pageerrors, single-device play forever.
let cloudFarm: LiveFarmStore | null = null; // set once the store has actually SWAPPED in
let cloudFarmCtor: LiveFarmStore | null = null; // set as soon as constructed (test-hook readiness)
let cloudWorld: CloudWorldStore | null = null;
let cloudAnimals: LiveAnimalStore | null = null;
let cloudAnimalsCtor: LiveAnimalStore | null = null;
let cloudBarn: LiveBarnStore | null = null;
let cloudBarnCtor: LiveBarnStore | null = null;
let cloudDecor: LiveDecorStore | null = null;
let cloudDecorCtor: LiveDecorStore | null = null;
let cloudMeta: LiveMetaStore | null = null;
let cloudMetaCtor: LiveMetaStore | null = null;

/** Adopt a server-confirmed decor snapshot (CloudDecorStore already merged our
 * own unflushed placements/removals). fullBloom may have crossed from another
 * device placing a 5th decoration. */
function applyRemoteDecor(remote: Record<string, DecorRecord>): void {
  decor = remote;
  decorField.syncAll(decor);
  recordMilestoneEvent({});
}

/** Merge a server-confirmed meta snapshot onto the local one. Shipped totals
 * take the monotonic MAX (so a stale echo can never drop our optimistic
 * increment), milestones union (keeping the earliest earned), foundedAt takes
 * the earliest. When `celebrate`, newly-appeared milestones (whoever crossed
 * the shared threshold — even another device) fire a toast + confetti here, so
 * EVERY connected family member sees it. */
function mergeMeta(remote: MetaState, celebrate: boolean): void {
  if (remote.foundedAt && (!meta.foundedAt || remote.foundedAt < meta.foundedAt)) meta.foundedAt = remote.foundedAt;
  if (remote.farmName) meta.farmName = remote.farmName;
  for (const [k, v] of Object.entries(remote.shipped)) meta.shipped[k] = Math.max(meta.shipped[k] ?? 0, v);
  const newly: string[] = [];
  for (const [k, v] of Object.entries(remote.milestones)) {
    if (!meta.milestones[k]) {
      meta.milestones[k] = v;
      newly.push(k);
    }
  }
  // threshold crossings implied by the merged shipped totals / live decor count
  const crossed = checkMilestones(currentFacts());
  for (const key of crossed) {
    if (!meta.milestones[key]) {
      meta.milestones[key] = flNow();
      metaStore.setMilestone(key, meta.milestones[key]);
      newly.push(key);
    }
  }
  if (celebrate) for (const key of newly) celebrateMilestone(key);
  if (newly.length && hud.isFarmBookOpen()) openFarmBook();
}
function applyRemoteMeta(remote: MetaState): void {
  mergeMeta(remote, true);
}

/** Merge a server-confirmed herd snapshot onto the local one. Positions are
 * cosmetic/local-only (never synced), so this only ever touches care fields —
 * an echo of our own write diffs to nothing (CloudAnimalStore's own
 * local-dirty guard already protects any unflushed local mutation). */
function applyRemoteHerd(remote: Record<string, AnimalRecord>): void {
  for (const id of Object.keys(remote)) herd[id] = remote[id];
}

/** Adopt a server-confirmed barn snapshot: door state (animate remote toggles
 * live) + physical eggs. EGG RACE RECONCILE: an egg I locally credited but whose
 * surviving `collectedBy` is someone ELSE means I lost the race — revert my +1
 * and toast "<name> got that one! 🥚". Exactly one collector keeps the egg. */
function applyRemoteBarn(data: BarnData): void {
  if (data.door.open !== barnScene.doorIsOpen()) barnScene.setDoorOpen(data.door.open, true);
  doorState = data.door;
  for (const [id, rec] of Object.entries(data.eggs)) {
    const prev = eggs[id];
    eggs[id] = rec;
    // I optimistically collected this egg, but the winner is someone else:
    if (rec.collectedBy && rec.collectedBy !== myPlayerName && prev && prev.collectedBy === myPlayerName) {
      farmState.produce.egg = Math.max(0, farmState.produce.egg - 1);
      refreshToolHud();
      persistFarm();
      hud.toast(`${rec.collectedBy} got that one! 🥚`);
    }
  }
  refreshEggMeshes();
}

/** Re-render only the tiles that actually differ from what's on screen
 * (Bistro-proven per-tile granularity) — an echo of our OWN write always
 * diffs to nothing, since `farmState` was already updated optimistically
 * before the write went out. Non-tile (per-player) fields are adopted too,
 * for the rare same-identity-multiple-devices case. */
function applyRemoteFarm(remote: FarmState): void {
  const changed = diffTiles(farmState.tiles, remote.tiles);
  const now = flNow();
  for (const key of changed) {
    const p = parseTileKey(key);
    if (!p) continue;
    farmState.tiles[key] = remote.tiles[key];
    field.syncTile(p.gx, p.gz, farmState.tiles[key], now);
    const { x, z } = tileCenter(p.gx, p.gz);
    field.spawnPop(x, sampleHeight(x, z) + 0.9, z, "✨"); // subtle "someone else farmed this" notice
  }
  let playerChanged = false;
  for (const id of CROP_ORDER) {
    if (farmState.seeds[id] !== remote.seeds[id] || farmState.crops[id] !== remote.crops[id]) playerChanged = true;
  }
  for (const id of PRODUCE_ORDER) {
    if (farmState.produce[id] !== remote.produce[id]) playerChanged = true;
  }
  if (
    farmState.coins !== remote.coins ||
    farmState.tank !== remote.tank ||
    farmState.selectedTool !== remote.selectedTool ||
    farmState.selectedCrop !== remote.selectedCrop
  ) {
    playerChanged = true;
  }
  if (playerChanged) {
    farmState.coins = remote.coins;
    farmState.seeds = { ...remote.seeds };
    farmState.crops = { ...remote.crops };
    farmState.produce = { ...remote.produce };
    farmState.tank = remote.tank;
    farmState.selectedTool = remote.selectedTool;
    farmState.selectedCrop = remote.selectedCrop;
    hud.setCoins(farmState.coins);
    refreshToolHud();
  }
}

function reconcileWorld(w: WorldData): void {
  if (isEmptyWorldData(w) && isEmptyWorldData(world)) return;
  const same =
    JSON.stringify({ t: world.terrain, p: world.paint, o: world.objects, f: world.fences }) ===
    JSON.stringify({ t: w.terrain, p: w.paint, o: w.objects, f: w.fences });
  if (same) return;
  // rebuild ground + re-apply props/fences from scratch (P1.5b editor precedent)
  scene.remove(ground);
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  world.terrain = w.terrain;
  world.paint = w.paint;
  world.objects = w.objects;
  world.fences = w.fences;
  setActiveWorld(world);
  ground = buildGroundMesh();
  scene.add(ground);
  // objects/fences were added straight to `scene` in applyWorld(); a fresh
  // call is the simplest safe re-apply (props/fences are cheap, and this only
  // fires on an actual world-doc change, never per frame).
  applyWorld(w);
  invalidateFarmMapBackground(); // P7: fences/props changed — rebuild the map's cached layer
}

async function initCloud(): Promise<void> {
  try {
    hud.setSyncStatus("connecting");
    const session = new FarmlifeSession((msg) => hud.toast(msg));
    cloudWorld = new CloudWorldStore(session);
    const cloud = new CloudFarmStore(session);
    cloudFarmCtor = cloud; // available immediately (test hook: net.ready() shouldn't need the full reconcile)
    const ok = await session.ready;
    if (!ok) {
      hud.setSyncStatus("offline");
      return; // stays on LocalFarmStore + local world, forever, for this session
    }

    // one-time migration of this device's pre-P2 local save, only if the
    // family's shared farm is still empty on the server.
    let localSeed: FarmState | null = null;
    try {
      const raw = localStorage.getItem("fl_farm_v1");
      if (raw) localSeed = sanitizeFarmState(JSON.parse(raw));
    } catch (_) {
      /* corrupt local save -> nothing to migrate */
    }
    await cloud.migrateFromLocal(localSeed);

    const remoteFarm = await cloud.load();
    if (remoteFarm) {
      farmState.tiles = remoteFarm.tiles;
      farmState.seeds = remoteFarm.seeds;
      farmState.crops = remoteFarm.crops;
      farmState.produce = remoteFarm.produce;
      farmState.coins = remoteFarm.coins;
      farmState.tank = Math.min(remoteFarm.tank, tankCap());
      farmState.selectedTool = remoteFarm.selectedTool;
      farmState.selectedCrop = remoteFarm.selectedCrop;
      field.syncAll(farmState, flNow());
      hud.setCoins(farmState.coins);
      equipTool(farmState.selectedTool);
      farmStore = cloud;
      cloudFarm = cloud;
      cloud.subscribe((remote) => applyRemoteFarm(remote));
    }

    const remoteWorld = await cloudWorld.load();
    if (!isEmptyWorldData(remoteWorld)) reconcileWorld(remoteWorld);
    cloudWorld.subscribe((w) => reconcileWorld(w));

    // ---- P4: shared herd -----------------------------------------------------
    // Never auto-seed on an ambiguous read: load() returns null only when the
    // `animals` doc is truly absent, at which point (and ONLY then, having
    // just seen a server-confirmed snapshot) seedIfEmpty() creates it once.
    const animals = new CloudAnimalStore(session);
    cloudAnimalsCtor = animals;
    let remoteHerd = await animals.load();
    if (!remoteHerd) remoteHerd = await animals.seedIfEmpty(flNow());
    if (remoteHerd) {
      herd = remoteHerd;
      animalStore = animals;
      cloudAnimals = animals;
      animals.subscribe((h) => applyRemoteHerd(h));
    }

    // ---- shared barn (door + physical eggs) ---------------------------------
    const barn = new CloudBarnStore(session);
    cloudBarnCtor = barn;
    const remoteBarn = await barn.load();
    barnStore = barn;
    cloudBarn = barn;
    // migrate this device's local-only door/eggs up if the cloud barn is empty
    const cloudEmpty = !remoteBarn.door.at && Object.keys(remoteBarn.eggs).length === 0;
    if (cloudEmpty && (doorState.at || Object.keys(eggs).length)) {
      barn.setDoor(doorState);
      for (const e of Object.values(eggs)) barn.putEgg(e);
      void barn.flush?.();
    } else {
      doorState = remoteBarn.door;
      eggs = remoteBarn.eggs;
      barnScene.setDoorOpen(doorState.open, false);
      refreshEggMeshes();
    }
    barn.subscribe((d) => applyRemoteBarn(d));

    // ---- P5: shared decorations --------------------------------------------
    const cDecor = new CloudDecorStore(session);
    cloudDecorCtor = cDecor;
    decorStore = cDecor;
    cloudDecor = cDecor;
    const remoteDecor = await cDecor.load();
    if (Object.keys(remoteDecor).length === 0 && Object.keys(decor).length > 0) {
      // one-time migrate this device's local-only decorations up to the empty cloud
      cDecor.save(decor);
      void cDecor.flush?.();
    } else {
      decor = remoteDecor;
      decorField.syncAll(decor);
    }
    cDecor.subscribe((d) => applyRemoteDecor(d));

    // ---- P5: shared meta (shipped totals + milestones) ----------------------
    const cMeta = new CloudMetaStore(session);
    cloudMetaCtor = cMeta;
    metaStore = cMeta;
    cloudMeta = cMeta;
    const remoteMeta = await cMeta.load();
    if (remoteMeta) {
      mergeMeta(remoteMeta, false); // silent — already-earned milestones must not re-celebrate on boot
      // migrate this device's local-only progress up (offline plays before P2 connect)
      const shipDelta: Record<string, number> = {};
      for (const [k, v] of Object.entries(meta.shipped)) {
        const d = v - (remoteMeta.shipped[k] ?? 0);
        if (d > 0) shipDelta[k] = d;
      }
      if (Object.keys(shipDelta).length) cMeta.addShipped(shipDelta);
      for (const [k, ts] of Object.entries(meta.milestones)) {
        if (!remoteMeta.milestones[k]) cMeta.setMilestone(k, ts);
      }
      if (!remoteMeta.foundedAt) cMeta.setInit(meta.farmName, meta.foundedAt || flNow());
    }
    cMeta.subscribe((m) => applyRemoteMeta(m));

    hud.setSyncStatus("synced");
  } catch (err) {
    console.warn("Farm Life: cloud sync unavailable — staying offline.", err);
    hud.setSyncStatus("offline");
  }
}
void initCloud();

function buySeed(id: CropId): void {
  const c = CROPS[id];
  if (farmState.coins < c.seedCost) return;
  farmState.coins -= c.seedCost;
  farmState.seeds[id] += 1;
  persistFarm();
  hud.setCoins(farmState.coins);
  refreshToolHud();
  hud.showShop(farmState.coins, farmState.seeds);
  audio.buy();
  hud.toast(`🌱 Bought 1 ${c.name} seed`);
}

hud.onBuySeed(buySeed);
// The seed-stand shop opens automatically by proximity. If you CLOSE it while
// still standing at the stand, it must STAY closed (the old code reopened it on
// the very next frame). `shopDismissed` latches on close and clears when you
// walk out of the stand's radius (see the proximity block below).
let shopDismissed = false;
hud.onCloseShop(() => { hud.hideShop(); shopDismissed = true; });
hud.onAction(() => doAction());
hud.onJump(() => requestJump());
hud.onSelectTool((id) => equipTool(id));
// cycleCrop is bound to Q in the HUD; suppress it while placing (Q rotates then).
hud.onCycleCrop(() => {
  if (placing) return;
  cycleCrop();
});
hud.onBuyDecor((type) => buyDecor(type));
hud.onOpenBook(() => openFarmBook());
hud.onCloseBook(() => hud.hideFarmBook());
hud.onRotate(() => rotatePlacement(1));
hud.onCancelPlace(() => cancelPlacement(true));

// ---- targeting + action resolution ------------------------------------------
interface Pending {
  type: "tile" | "sell" | "refill" | "animal" | "removeDecor" | "door" | "egg";
  gx?: number;
  gz?: number;
  res?: ActionResolution;
  animalId?: string;
  animalAction?: AnimalInteraction;
  decorId?: string;
  eggId?: string;
  label: string;
  color: string;
  worldX: number;
  worldY: number;
  worldZ: number;
}
let pending: Pending | null = null;

// ---- right-click walk-then-act (2026-07-10) ---------------------------------
// Right-clicking a field tile that's out of action reach steers the farmer to a
// stand point within reach of that tile, then performs the action ON the clicked
// tile (explicit target — the facing heuristic can't act on a neighbour). The
// walk uses straight-line steering through the SAME resolveCollision path as
// normal movement (the farm is open — no pathfinding). Cancelled instantly by
// manual movement / jump / a new right-click / placement / timeout / a blocked
// jam. Tiles only (bin/stand/animals keep their existing proximity+facing flow —
// see report). ACT_REACH mirrors field.ts's REACH so "in reach" agrees with the
// facing-targeter.
const ACT_REACH = 2.2; // m to tile center that counts as "in reach"
const STAND_DIST = 1.5; // m from tile center the auto-walk aims to stop (< ACT_REACH)
const AUTOWALK_ARRIVE = 0.22; // m to the stand point that counts as arrived
const AUTOWALK_TIMEOUT_MS = 6000; // give up after ~6s (silent)
const AUTOWALK_STUCK_MS = 650; // no forward progress this long = collision jam -> give up
interface AutoWalk {
  gx: number;
  gz: number;
  standX: number;
  standZ: number;
  startedAt: number;
  lastProgressAt: number;
  lastDist: number;
}
let autoWalk: AutoWalk | null = null;

function cancelAutoWalk(): void {
  autoWalk = null; // silent — no error feel (spec)
}

/** Perform the equipped tool's action on an EXPLICIT tile (gx,gz), independent
 * of the facing heuristic. Faces the tile first so the use-animation reads. If
 * the tile's state changed before arrival (e.g. a family member watered it),
 * this just fires the normal hint/label — never crashes. */
function actOnTile(gx: number, gz: number): void {
  if (player.isBusy() || placing) return;
  const rec = tileRec(gx, gz);
  const state = computeTileState(rec, flNow());
  const res = resolveAction(state, farmState.selectedTool, "tool", {
    selectedCrop: farmState.selectedCrop,
    seedCount: farmState.seeds[farmState.selectedCrop],
    tank: farmState.tank,
    tileCrop: rec?.crop,
  });
  // face the tile (so the swing/pour/scoop points at it)
  const c = tileCenter(gx, gz);
  const h = Math.atan2(c.x - player.root.position.x, c.z - player.root.position.z);
  heading = h;
  player.root.rotation.y = h;
  if (res.hint) {
    fireHint(res.label);
    return;
  }
  if (!res.verb) return; // nothing to do (e.g. still-growing) — gentle no-op
  executeVerb(res.verb, gx, gz, res.cropId);
}

/** A right-click resolved onto tile (gx,gz): act now if in reach, else auto-walk
 * to a stand point within reach and act on arrival. Always replaces any goal. */
function requestTileAction(gx: number, gz: number): void {
  cancelAutoWalk();
  if (gx < 0 || gx >= GRID || gz < 0 || gz >= GRID) return;
  const c = tileCenter(gx, gz);
  const px = player.root.position.x;
  const pz = player.root.position.z;
  const dist = Math.hypot(c.x - px, c.z - pz);
  if (dist <= ACT_REACH) {
    actOnTile(gx, gz); // in reach -> act on THIS tile immediately (faces it)
    return;
  }
  // out of reach: stand point = STAND_DIST out from the tile, on the player's side
  const dx = px - c.x;
  const dz = pz - c.z;
  const d = Math.hypot(dx, dz) || 1;
  let sx = c.x + (dx / d) * STAND_DIST;
  let sz = c.z + (dz / d) * STAND_DIST;
  const rc = resolveCollision(sx, sz); // nudge the stand point out of any obstacle
  sx = rc.x;
  sz = rc.z;
  const now = performance.now();
  autoWalk = { gx, gz, standX: sx, standZ: sz, startedAt: now, lastProgressAt: now, lastDist: Infinity };
}

/** Advance an active auto-walk one frame: steer toward the stand point (RUN
 * speed, step-capped so it can't overshoot), face the travel direction, and on
 * arrival act on the clicked tile. Returns the ground speed for the walk anim.
 * Handles the 6s timeout + collision-jam bail. */
function stepAutoWalk(dt: number): number {
  if (!autoWalk) return 0;
  const now = performance.now();
  if (now - autoWalk.startedAt > AUTOWALK_TIMEOUT_MS) {
    cancelAutoWalk();
    return 0;
  }
  const px = player.root.position.x;
  const pz = player.root.position.z;
  const dToStand = Math.hypot(autoWalk.standX - px, autoWalk.standZ - pz);
  const c = tileCenter(autoWalk.gx, autoWalk.gz);
  const dToTile = Math.hypot(c.x - px, c.z - pz);
  if (dToStand <= AUTOWALK_ARRIVE || dToTile <= ACT_REACH - 0.1) {
    const { gx, gz } = autoWalk;
    autoWalk = null;
    actOnTile(gx, gz);
    return 0;
  }
  // collision-jam detection: bail if no real progress toward the stand point
  if (dToStand < autoWalk.lastDist - 0.02) {
    autoWalk.lastDist = dToStand;
    autoWalk.lastProgressAt = now;
  } else if (now - autoWalk.lastProgressAt > AUTOWALK_STUCK_MS) {
    cancelAutoWalk();
    return 0;
  }
  const dirx = (autoWalk.standX - px) / (dToStand || 1);
  const dirz = (autoWalk.standZ - pz) / (dToStand || 1);
  const spd = tune.moveSpeed * tune.runMult;
  const step = Math.min(spd * dt, dToStand);
  const before = { x: px, z: pz };
  const rc = resolveCollision(px + dirx * step, pz + dirz * step);
  player.root.position.x = rc.x;
  player.root.position.z = rc.z;
  const moved = Math.hypot(rc.x - before.x, rc.z - before.z);
  const targetHeading = Math.atan2(dirx, dirz);
  let dh = targetHeading - heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  heading += dh * Math.min(1, tune.turnRate * dt);
  player.root.rotation.y = heading;
  return dt > 0 ? moved / dt : 0;
}

// ---- P5: decoration placement + removal state -------------------------------
const PLACE_DIST = 2.4; // m in front of the player the ghost sits
const DECOR_REACH = 2.4; // m — removal targeting radius (hands tool)
const DECOR_ANGLE = 1.15; // rad facing cone (matches animal targeting)
const REMOVE_ARM_MS = 2500; // two-tap confirm window
interface Placing {
  type: string;
  rotY: number;
  cost: number;
  targetX: number;
  targetZ: number;
  valid: boolean;
  ghost: THREE.Group;
}
let placing: Placing | null = null;
let removeArmed: { id: string; until: number } | null = null;

function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | undefined;
    if (mat) mat.dispose();
  });
}

/** On grass, in bounds, clear of the field/pond/world-obstacles/other decor. */
function isPlaceable(type: string, x: number, z: number): boolean {
  if (Math.abs(x) > EDGE - 1 || Math.abs(z) > EDGE - 1) return false;
  const r = DECOR[type]?.cr ?? 0.3;
  // never on the flat farming plot (+ small margin) — crops need it
  if (Math.abs(x - FIELD.cx) <= FIELD.half + 0.6 && Math.abs(z - FIELD.cz) <= FIELD.half + 0.6) return false;
  // never in/at the pond
  if (Math.hypot(x - POND.cx, z - POND.cz) <= POND.r + 0.8) return false;
  // never overlapping a world obstacle (barn / tree / rock / stations)
  if (wouldCollide(x, z, r)) return false;
  // never overlapping another decoration
  if (decorField.overlaps(x, z, r)) return false;
  return true;
}

function enterPlacement(type: string, cost: number): void {
  cancelAutoWalk(); // entering placement mode cancels an auto-walk goal
  if (placing) exitPlacement();
  const ghost = buildDecorMesh(type, true);
  scene.add(ghost);
  placing = { type, rotY: 0, cost, targetX: player.root.position.x, targetZ: player.root.position.z, valid: false, ghost };
  updatePlacementGhost();
}

function updatePlacementGhost(): void {
  if (!placing) return;
  const px = player.root.position.x;
  const pz = player.root.position.z;
  const gx = px + Math.sin(heading) * PLACE_DIST;
  const gz = pz + Math.cos(heading) * PLACE_DIST;
  placing.targetX = gx;
  placing.targetZ = gz;
  placing.ghost.position.set(gx, sampleHeight(gx, gz), gz);
  placing.ghost.rotation.y = placing.rotY;
  const valid = isPlaceable(placing.type, gx, gz);
  placing.valid = valid;
  tintGhost(placing.ghost, valid);
  const d = DECOR[placing.type];
  hud.showPlacement(`Place ${d.label}  ✅ · ↺ · ✖`, valid);
}

function rotatePlacement(dir: number): void {
  if (!placing) return;
  placing.rotY += dir * (Math.PI / 6);
  updatePlacementGhost();
}

function confirmPlacement(): void {
  if (!placing) return;
  if (!placing.valid) {
    fireHint("Can't place there — find open grass! 🌱");
    return;
  }
  const rec: DecorRecord = {
    id: newDecorId(),
    type: placing.type,
    x: placing.targetX,
    z: placing.targetZ,
    rotY: placing.rotY,
    placedBy: currentPlayerName(),
    placedAt: flNow(),
  };
  decor[rec.id] = rec;
  decorField.add(rec);
  persistDecor();
  field.spawnBurst(rec.x, sampleHeight(rec.x, rec.z) + 0.4, rec.z, 0xffd35a, 12, 1.2);
  hud.toast(`🎀 Placed a ${DECOR[placing.type].label}!`);
  recordMilestoneEvent({ decorEvent: true }); // firstDecoration + fullBloom (count)
  exitPlacement();
}

function cancelPlacement(refund: boolean): void {
  if (!placing) return;
  if (refund) {
    farmState.coins += placing.cost;
    hud.setCoins(farmState.coins);
    persistFarm();
    hud.toast(`Placement cancelled — refunded 🪙${placing.cost}`);
  }
  exitPlacement();
}

function exitPlacement(): void {
  if (placing) {
    scene.remove(placing.ghost);
    disposeGroup(placing.ghost);
    placing = null;
  }
  hud.hidePlacement();
}

function buyDecor(type: string): void {
  const d = DECOR[type];
  if (!d || farmState.coins < d.cost) return;
  farmState.coins -= d.cost;
  hud.setCoins(farmState.coins);
  persistFarm();
  hud.hideShop();
  audio.buy();
  enterPlacement(type, d.cost);
}

function removeDecorAt(id: string): void {
  const rec = decor[id];
  if (!rec) return;
  delete decor[id];
  decorField.remove(id);
  persistDecor();
  hud.toast(`🗑 Removed the ${DECOR[rec.type]?.label ?? "decoration"}`);
}

/** Assemble + open the Farm Book from the live meta doc. */
function openFarmBook(): void {
  const shipped = [
    ...CROP_ORDER.map((id) => ({ emoji: CROPS[id].emoji, name: CROPS[id].name, count: meta.shipped[id] ?? 0 })),
    ...PRODUCE_ORDER.map((id) => {
      const info = produceInfo(id);
      return { emoji: info.emoji, name: info.name, count: meta.shipped[id] ?? 0 };
    }),
  ];
  const milestones = MILESTONES.map((m) => ({
    key: m.key,
    label: m.label,
    emoji: m.emoji,
    desc: m.desc,
    earnedAt: meta.milestones[m.key] ?? 0,
  }));
  hud.showFarmBook({ farmName: meta.farmName, foundedAt: meta.foundedAt, shipped, milestones });
}

// ---- P7: Farm Map -------------------------------------------------------
// Live top-down Canvas2D map drawn from DATA (see ui/farmMap.ts). The static
// background layer (terrain footprint/pond/field/fences/props) is cached
// inside drawFarmMap; only tiles/animals/players redraw per frame while open.
const LOCAL_SHIRT = "#d24b4b"; // local farmer's warm red (player.ts default)
const mapCtx = hud.mapCanvas.getContext("2d")!;
hud.setMapLegend([
  { emoji: "🔺", label: "You" },
  { emoji: "🟡", label: "Ready to harvest!" },
  { emoji: "🟩", label: "Growing" },
  { emoji: "🏪", label: "Seed stand" },
  { emoji: "📦", label: "Shipping bin" },
  { emoji: "🏠", label: "Farmhouse" },
  { emoji: "🐐🐔", label: "Animals" },
  { emoji: "🔵", label: "Family" },
]);

/** Assemble the map's full data snapshot from live game state. */
function buildMapSnapshot(): FarmMapSnapshot {
  const nowMs = flNow();
  const tiles: MapTileCell[] = [];
  for (const key of Object.keys(farmState.tiles)) {
    const p = parseTileKey(key);
    if (!p) continue;
    const st = computeTileState(farmState.tiles[key], nowMs);
    if (st === "untouched") continue;
    const { x, z } = tileCenter(p.gx, p.gz);
    tiles.push({ x, z, size: TILE_SIZE, state: st });
  }
  const animals = STARTER_HERD.map((s) => {
    const a = animalField.actorAt(s.id);
    return a ? { x: a.x, z: a.z, emoji: ANIMAL_DEFS[s.type].emoji } : null;
  }).filter((a): a is { x: number; z: number; emoji: string } => a !== null);
  const players: FarmMapSnapshot["players"] = [
    { x: player.root.position.x, z: player.root.position.z, heading, color: LOCAL_SHIRT, self: true },
  ];
  for (const id of presence.remoteIds()) {
    const pos = remotePlayers.pos(id);
    if (!pos) continue;
    const name = presence.remoteName(id);
    players.push({ x: pos.x, z: pos.z, heading: 0, color: shirtTint(name), self: false, name });
  }
  return {
    half: MAP_HALF,
    edge: EDGE,
    field: { cx: FIELD.cx, cz: FIELD.cz, half: FIELD.half },
    pond: { cx: POND.cx, cz: POND.cz, r: POND.r },
    fences: world.fences.map((f) => ({ pts: f.points.map((p) => ({ x: p.x, z: p.z })) })),
    objects: world.objects.map((o) => ({ x: o.x, z: o.z, emoji: PROPS[o.type]?.emoji ?? "🌳" })),
    decor: Object.values(decor).map((d) => ({ x: d.x, z: d.z, emoji: DECOR[d.type]?.emoji ?? "🎀" })),
    stations: [
      { x: stand.x, z: stand.z, emoji: "🏪" },
      { x: bin.x, z: bin.z, emoji: "📦" },
      { x: FARMHOUSE_POS.cx, z: FARMHOUSE_POS.cz, emoji: "🏠" },
    ],
    tiles,
    animals,
    players,
    pasture: { minX: PASTURE.minX, maxX: PASTURE.maxX, minZ: PASTURE.minZ, maxZ: PASTURE.maxZ },
    gate: { x: GATE_CENTER.x, z0: GATE_CENTER.z - 1.6, z1: GATE_CENTER.z + 1.6 },
    barn: { minX: BARN.minX, maxX: BARN.maxX, minZ: BARN.minZ, maxZ: BARN.maxZ },
    doorOpen: barnScene.doorIsOpen(),
    eggCount: Object.values(eggs).filter((e) => !e.collectedBy).length,
  };
}

// ---- P7: Inventory --------------------------------------------------------
// The full-view companion to the 4-slot hotbar. ONE source of truth: every
// row reads straight from farmState at build time; while the panel is open
// the frame loop re-calls showInventory (signature-guarded in the HUD) so
// remote-sync count changes appear live. UX DECISION (documented per spec):
// tapping a seed row selects it AND equips the seed pouch, then CLOSES the
// panel with a toast — one tap from "I want to plant tomatoes" to standing in
// the field ready to plant. Tool rows equally equip-and-close.
function buildInventoryData(): InventoryData {
  return {
    seeds: CROP_ORDER.map((id) => ({
      id,
      emoji: CROPS[id].emoji,
      name: CROPS[id].name,
      count: farmState.seeds[id],
      seedCost: CROPS[id].seedCost,
      selected: id === farmState.selectedCrop,
    })).filter((s) => s.count > 0 || s.selected),
    produce: [
      ...CROP_ORDER.map((id) => ({
        emoji: CROPS[id].emoji,
        name: CROPS[id].name,
        count: farmState.crops[id],
        sellPrice: CROPS[id].sellPrice,
      })),
      ...PRODUCE_ORDER.map((id) => {
        const info = produceInfo(id);
        return { emoji: info.emoji, name: info.name, count: farmState.produce[id], sellPrice: info.sellPrice };
      }),
    ].filter((p) => p.count > 0),
    produceTotalValue:
      CROP_ORDER.reduce((s, id) => s + farmState.crops[id] * CROPS[id].sellPrice, 0) +
      PRODUCE_ORDER.reduce((s, id) => s + farmState.produce[id] * produceInfo(id).sellPrice, 0),
    tools: TOOL_ORDER.map((id) => ({
      id,
      glyph: TOOL_META[id].icon ?? TOOL_META[id].emoji,
      isIcon: !!TOOL_META[id].icon,
      name: TOOL_META[id].name,
      selected: id === farmState.selectedTool,
    })),
    tank: farmState.tank,
    tankCap: tankCap(),
  };
}

hud.onOpenInventory(() => hud.showInventory(buildInventoryData()));
hud.onCloseInventory(() => {});
hud.onSelectInventorySeed((id) => {
  farmState.selectedCrop = id;
  equipTool("seeds"); // also refreshes the hotbar + persists
  hud.hideInventory();
  hud.toast(`${CROPS[id].emoji} ${CROPS[id].name} seeds ready to plant!`);
});
hud.onEquipInventoryTool((id) => {
  equipTool(id);
  hud.hideInventory();
});

const VERB_COLOR: Record<Verb, string> = {
  till: "#c9a15f",
  plant: "#7fbf5a",
  water: "#5ab0e0",
  harvest: "#ffd35a",
};
const HINT_COLOR = "#e8a13a";
const SELL_COLOR = "#ffd35a";
const REFILL_COLOR = "#5ab0e0";
const ANIMAL_COLOR: Record<AnimalInteraction, string> = {
  collect: "#e8d38a",
  pet: "#ff6fa5",
};
const DOOR_COLOR = "#c9a15f";
const EGG_COLOR = "#ffe9a8";
const ANIMAL_INTERACT_RADIUS = 2.2;
const ANIMAL_INTERACT_ANGLE = 1.15; // radians (~66°) — facing-aware, matches tile targeting's forgiving cone
const DOOR_REACH = 3.0; // m — barn-door proximity to offer open/close
const EGG_REACH = 2.0;

function animalLabel(a: AnimalRecord, action: AnimalInteraction): string {
  if (action === "collect") return `Milk ${a.name} 🥛`;
  return `Pet ${a.name} 💕`;
}

/** Nearest un-collected egg to (px,pz) within reach + facing cone, or null. */
function nearestEgg(px: number, pz: number, heading: number): EggRecord | null {
  const fwdX = Math.sin(heading), fwdZ = Math.cos(heading);
  let best: EggRecord | null = null;
  let bestD = Infinity;
  for (const e of Object.values(eggs)) {
    if (e.collectedBy) continue;
    const dx = e.x - px, dz = e.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > EGG_REACH || d < 0.001) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx / d) * fwdX + (dz / d) * fwdZ)));
    if (ang > 1.5) continue; // wide cone — eggs are small ground targets
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function tileRec(gx: number, gz: number): TileRecord | undefined {
  return farmState.tiles[tileKey(gx, gz)];
}

/** Append a droplet count to the label when the watering can is equipped. */
function labelWithDroplet(text: string): string {
  if (farmState.selectedTool === "can" && text) return `${text} · 💧${farmState.tank}`;
  return text;
}

function updateTargeting(px: number, pz: number, heading: number): void {
  // P5: while placing a decoration the ghost owns targeting — no tile/animal label.
  if (placing) {
    pending = null;
    field.setHighlightTile(null, null, 0);
    return;
  }

  // Walk-then-act: while auto-walking, the label + highlight live on the CLICKED
  // tile (the intent), not on whatever the farmer is momentarily facing.
  if (autoWalk) {
    const { gx, gz } = autoWalk;
    const rec = tileRec(gx, gz);
    const state = computeTileState(rec, flNow());
    const res = resolveAction(state, farmState.selectedTool, "tool", {
      selectedCrop: farmState.selectedCrop,
      seedCount: farmState.seeds[farmState.selectedCrop],
      tank: farmState.tank,
      tileCrop: rec?.crop,
    });
    const { x, z } = tileCenter(gx, gz);
    const color = res.verb ? VERB_COLOR[res.verb] : res.hint ? HINT_COLOR : "#9a9a9a";
    field.setHighlightTile(gx, gz, parseInt(color.slice(1), 16));
    pending = res.label
      ? {
          type: "tile",
          gx,
          gz,
          res,
          label: labelWithDroplet(res.label),
          color,
          worldX: x,
          worldY: sampleHeight(x, z) + 1.1,
          worldZ: z,
        }
      : null;
    return;
  }

  // Barn DOOR — proximity + facing, works with ANY tool (like the stations).
  {
    const dDoor = Math.hypot(px - barnScene.doorAnchor.x, pz - barnScene.doorAnchor.z);
    if (dDoor <= DOOR_REACH) {
      // only when roughly facing the barn (so it doesn't steal the label while
      // walking past) — the door is on the barn's south wall (+z is into barn)
      const toDoorZ = barnScene.doorAnchor.z - pz;
      const facingBarn = Math.cos(heading) * Math.sign(toDoorZ || 1) > -0.3 || dDoor < 1.6;
      if (facingBarn) {
        field.setHighlightTile(null, null, 0);
        pending = {
          type: "door",
          label: barnScene.doorIsOpen() ? "Close the barn door 🚪" : "Open the barn door 🚪",
          color: DOOR_COLOR,
          worldX: barnScene.doorAnchor.x,
          worldY: barnScene.doorAnchor.y + 0.8,
          worldZ: barnScene.doorAnchor.z,
        };
        return;
      }
    }
  }

  // HANDS tool — eggs, then animals (milk/pet), then decorations (remove).
  if (farmState.selectedTool === "hands") {
    const egg = nearestEgg(px, pz, heading);
    if (egg) {
      field.setHighlightTile(null, null, 0);
      pending = {
        type: "egg",
        eggId: egg.id,
        label: "Collect egg 🥚",
        color: EGG_COLOR,
        worldX: egg.x,
        worldY: sampleHeight(egg.x, egg.z) + 0.5,
        worldZ: egg.z,
      };
      return;
    }
    const actor = animalField.nearestFacing(px, pz, heading, ANIMAL_INTERACT_RADIUS, ANIMAL_INTERACT_ANGLE);
    if (actor) {
      const a = herd[actor.id];
      if (a) {
        const def = ANIMAL_DEFS[a.type];
        const action = resolveAnimalAction(a, def, flNow());
        field.setHighlightTile(null, null, 0);
        pending = {
          type: "animal",
          animalId: actor.id,
          animalAction: action,
          label: animalLabel(a, action),
          color: ANIMAL_COLOR[action],
          worldX: actor.x,
          worldY: sampleHeight(actor.x, actor.z) + (a.type === "goat" ? 1.3 : 0.7),
          worldZ: actor.z,
        };
        return;
      }
    }
    // decoration removal — but not while standing at a store (proximity shop wins)
    const nearStore = distanceTo(px, pz, stand) <= stand.radius || distanceTo(px, pz, bin) <= bin.radius;
    if (!nearStore) {
      const dec = decorField.nearestFacing(px, pz, heading, DECOR_REACH, DECOR_ANGLE);
      if (dec) {
        field.setHighlightTile(null, null, 0);
        const armed = !!(removeArmed && removeArmed.id === dec.id && performance.now() < removeArmed.until);
        const label = DECOR[dec.type]?.label ?? "decoration";
        pending = {
          type: "removeDecor",
          decorId: dec.id,
          label: armed ? `Remove ${label}? Tap again ✔` : `Remove ${label}?`,
          color: armed ? "#d64545" : "#ff9a4a",
          worldX: dec.x,
          worldY: sampleHeight(dec.x, dec.z) + 1.0,
          worldZ: dec.z,
        };
        return;
      }
    }
  }

  // seed-stand shop by proximity
  const distStand = distanceTo(px, pz, stand);
  if (distStand <= stand.radius) {
    // auto-open unless the player closed it while standing here (stays closed
    // until they walk away and come back — shopDismissed clears on exit below)
    if (!hud.isShopOpen() && !shopDismissed) hud.showShop(farmState.coins, farmState.seeds);
  } else {
    shopDismissed = false; // left the stand — re-arm the auto-open
    if (hud.isShopOpen()) hud.hideShop();
  }

  // watering-can refill at the pond edge
  if (farmState.selectedTool === "can") {
    const dPond = Math.hypot(px - POND.cx, pz - POND.cz);
    if (dPond <= POND.r + 3.0) {
      field.setHighlightTile(null, null, 0);
      if (farmState.tank < tankCap()) {
        pending = {
          type: "refill",
          label: `Refill 🚿 (💧${farmState.tank}/${tankCap()})`,
          color: REFILL_COLOR,
          worldX: px,
          worldY: sampleHeight(px, pz) + 1.7,
          worldZ: pz,
        };
      } else {
        pending = null;
      }
      return;
    }
  }

  // shipping bin (sell) by proximity — crops AND animal produce (P4)
  const distBin = distanceTo(px, pz, bin);
  const heldCrops =
    CROP_ORDER.reduce((s, id) => s + farmState.crops[id], 0) + PRODUCE_ORDER.reduce((s, id) => s + farmState.produce[id], 0);
  if (distBin <= bin.radius) {
    field.setHighlightTile(null, null, 0);
    pending =
      heldCrops > 0
        ? {
            type: "sell",
            label: `Sell all (${heldCrops}) 🪙`,
            color: SELL_COLOR,
            worldX: bin.x,
            worldY: sampleHeight(bin.x, bin.z) + 1.7,
            worldZ: bin.z,
          }
        : null;
    return;
  }

  // field tile targeting -> tool/auto action resolution
  const target = findTargetTile(px, pz, heading);
  if (!target) {
    pending = null;
    field.setHighlightTile(null, null, 0);
    return;
  }
  const rec = tileRec(target.gx, target.gz);
  const state = computeTileState(rec, flNow());
  const res = resolveAction(state, farmState.selectedTool, "tool", {
    selectedCrop: farmState.selectedCrop,
    seedCount: farmState.seeds[farmState.selectedCrop],
    tank: farmState.tank,
    tileCrop: rec?.crop,
  });
  const { x, z } = tileCenter(target.gx, target.gz);
  const color = res.verb ? VERB_COLOR[res.verb] : res.hint ? HINT_COLOR : "#9a9a9a";
  field.setHighlightTile(target.gx, target.gz, parseInt(color.slice(1), 16));
  if (res.label) {
    pending = {
      type: "tile",
      gx: target.gx,
      gz: target.gz,
      res,
      label: labelWithDroplet(res.label),
      color,
      worldX: x,
      worldY: sampleHeight(x, z) + 1.1,
      worldZ: z,
    };
  } else {
    pending = null;
  }
}

function worldToScreen(x: number, y: number, z: number): { sx: number; sy: number } {
  const v = new THREE.Vector3(x, y, z).project(camera);
  return { sx: (v.x * 0.5 + 0.5) * window.innerWidth, sy: (-v.y * 0.5 + 0.5) * window.innerHeight };
}

// ---- gentle hint toasts (rate-limited) --------------------------------------
let lastHintAt = 0;
let hintFireCount = 0; // test hook: counts toasts that actually fired (not suppressed)
function fireHint(label: string): void {
  const t = performance.now();
  if (t - lastHintAt < 1500) return;
  lastHintAt = t;
  hintFireCount++;
  hud.toast(label);
}

function doAction(): void {
  if (player.isBusy()) return;
  // P5: placement mode intercepts the action button/key entirely.
  if (placing) {
    confirmPlacement();
    return;
  }
  if (!pending) return;

  if (pending.type === "removeDecor") {
    const id = pending.decorId!;
    const now = performance.now();
    if (removeArmed && removeArmed.id === id && now < removeArmed.until) {
      removeArmed = null;
      removeDecorAt(id);
    } else {
      removeArmed = { id, until: now + REMOVE_ARM_MS };
      hud.toast("Tap again to remove 🗑");
    }
    return;
  }

  if (pending.type === "refill") {
    farmState.tank = tankRefill(tankCap());
    player.playToolAnim("refill");
    audio.refill();
    presence.emitAnim("refill", localPose());
    field.spawnBurst(pending.worldX, sampleHeight(pending.worldX, pending.worldZ) + 0.3, pending.worldZ, 0x5ab0e0, 10, 1);
    hud.toast("🚿 Can refilled!");
    refreshToolHud();
    persistFarm();
    return;
  }

  if (pending.type === "sell") {
    let total = 0;
    const shippedDeltas: Record<string, number> = {};
    for (const id of CROP_ORDER) {
      const q = farmState.crops[id];
      if (q > 0) {
        total += q * CROPS[id].sellPrice;
        shippedDeltas[id] = (shippedDeltas[id] ?? 0) + q;
      }
      farmState.crops[id] = 0;
    }
    for (const id of PRODUCE_ORDER) {
      const q = farmState.produce[id];
      if (q > 0) {
        total += q * produceInfo(id).sellPrice;
        shippedDeltas[id] = (shippedDeltas[id] ?? 0) + q;
      }
      farmState.produce[id] = 0;
    }
    if (total <= 0) return;
    farmState.coins += total;
    hud.setCoins(farmState.coins);
    refreshToolHud();
    audio.coin();
    hud.toast(`🪙 Sold for +${total}!`);
    field.spawnPop(bin.x, sampleHeight(bin.x, bin.z) + 1.4, bin.z, "🪙");
    persistFarm();
    applyShipped(shippedDeltas); // P5: running shipped totals + milestone checks
    return;
  }

  if (pending.type === "animal") {
    doAnimalAction(pending.animalId!, pending.animalAction!, pending.worldX, pending.worldY, pending.worldZ);
    return;
  }

  if (pending.type === "door") {
    toggleBarnDoor();
    return;
  }

  if (pending.type === "egg") {
    collectEgg(pending.eggId!, pending.worldX, pending.worldY, pending.worldZ);
    return;
  }

  // tile action
  const res = pending.res!;
  if (res.hint) {
    fireHint(res.label);
    return;
  }
  if (!res.verb || pending.gx == null || pending.gz == null) return;
  executeVerb(res.verb, pending.gx, pending.gz, res.cropId);
}

/** Hand-action on an animal (HANDS tool only — see updateTargeting). For a goat
 * with milk ready this MILKS (+1 milk, milking beat, cycle resets); otherwise it
 * PETS (hearts). So the first action on a milk-ready goat milks, the second pets
 * — the user's exact rule. Chickens only ever pet (eggs are physical). */
function doAnimalAction(id: string, action: AnimalInteraction, wx: number, wy: number, wz: number): void {
  const a = herd[id];
  if (!a) return;
  const def = ANIMAL_DEFS[a.type];
  const now = flNow();
  animalField.wake(id); // a sleepy animal blinks awake for the interaction
  if (action === "collect") {
    // milk the goat
    herd[id] = { ...a, ...collectProduce(a, def, now) };
    farmState.produce.milk += 1;
    hud.toast(`🥛 +1 Milk from ${a.name}!`);
    field.spawnPop(wx, wy, wz, "🥛");
    field.spawnBurst(wx, wy - 0.4, wz, 0xf3f0e6, 8, 0.5);
    refreshToolHud();
    persistFarm();
    audio.harvest();
    audio.bleat();
    recordMilestoneEvent({ milkEvent: true }); // First Milk
  } else {
    herd[id] = { ...a, lastPet: now };
    hud.toast(`${def.emoji} ${a.name} loves that! 💕`);
    field.spawnBurst(wx, wy - 0.3, wz, 0xff6fa5, 10, 0.5);
    a.type === "goat" ? audio.bleat() : audio.cluck();
    audio.heartPing();
  }
  player.playToolAnim("pet");
  presence.emitAnim("pet", localPose());
  persistHerd();
}

function executeVerb(verb: Verb, gx: number, gz: number, cropId?: CropId): void {
  const now = flNow();
  const key = tileKey(gx, gz);
  const { x, z } = tileCenter(gx, gz);
  const groundY = sampleHeight(x, z);

  if (verb === "till") {
    farmState.tiles[key] = {};
    field.syncTile(gx, gz, farmState.tiles[key], now);
    player.playToolAnim("hoe");
    audio.hoe();
    presence.emitAnim("hoe", localPose());
    window.setTimeout(() => field.spawnBurst(x, groundY + 0.15, z, 0x6b4a2c, 12, 1), 300);
  } else if (verb === "plant" && cropId) {
    if (farmState.seeds[cropId] <= 0) return;
    farmState.seeds[cropId] -= 1;
    farmState.tiles[key] = { crop: cropId, ...plantTile(now) };
    field.syncTile(gx, gz, farmState.tiles[key], now);
    player.playToolAnim("plant");
    audio.plant();
    presence.emitAnim("plant", localPose());
    window.setTimeout(() => field.spawnBurst(x, groundY + 0.25, z, 0x6b8f3a, 8, 0.6), 280);
    refreshToolHud();
  } else if (verb === "water") {
    const rec = tileRec(gx, gz);
    if (!rec || !rec.crop) return;
    const crop = effectiveCrop(CROPS[rec.crop]);
    const gt = waterTile(
      { plantedAt: rec.plantedAt ?? 0, accruedMs: rec.accruedMs ?? 0, lastWatered: rec.lastWatered ?? rec.plantedAt ?? 0 },
      crop,
      now
    );
    farmState.tiles[key] = { crop: rec.crop, ...gt };
    farmState.tank = tankConsume(farmState.tank);
    field.syncTile(gx, gz, farmState.tiles[key], now);
    player.playToolAnim("water");
    audio.water();
    presence.emitAnim("water", localPose());
    window.setTimeout(() => field.spawnBurst(x, groundY + 0.6, z, 0x5ab0e0, 10, 0.3), 300);
    field.spawnPop(x, groundY + 0.5, z, "💧");
    refreshToolHud();
  } else if (verb === "harvest") {
    const rec = tileRec(gx, gz);
    if (!rec || !rec.crop) return;
    const crop = CROPS[rec.crop];
    farmState.crops[rec.crop] += 1;
    farmState.tiles[key] = {}; // back to bare tilled soil, ready to replant
    field.syncTile(gx, gz, farmState.tiles[key], now);
    player.playToolAnim("harvest");
    audio.harvest();
    presence.emitAnim("harvest", localPose());
    lastProduceMesh = buildCropMesh(rec.crop, 2);
    player.showHarvestProduce(lastProduceMesh, 0.62); // HM hold-up beat
    hud.toast(`${crop.emoji} +1 ${crop.name} harvested!`);
    field.spawnPop(x, groundY + 1.0, z, crop.emoji);
    refreshToolHud();
    recordMilestoneEvent({ harvestedEvent: true }); // P5: First Harvest
  }
  persistFarm();
}

// ---- player ----------------------------------------------------------------
const player = buildFarmer();
let lastProduceMesh: THREE.Object3D | null = null; // harvest hold-up mesh (test hook)
// spawn on open grass south of the field (not inside the fenced plot)
player.root.position.set(16, sampleHeight(16, 34), 34);
scene.add(player.root);
let heading = 0;
player.root.rotation.y = heading;

// Stage 2 art swap: preload the Quaternius rigged farmer GLB, then upgrade the
// local player + every remote avatar in place (procedural until it resolves;
// stays procedural forever if the load fails — offline/404 never blanks).
void preloadCharacterModel().then((tpl) => {
  if (!tpl) return;
  player.upgradeToModel(tpl);
  remotePlayers.upgradeAll(tpl);
});

// ---- jump physics ----------------------------------------------------------
let vy = 0;
let airborne = false;
function requestJump(): void {
  if (!airborne && !player.isBusy()) {
    cancelAutoWalk(); // jumping cancels an auto-walk goal
    vy = tune.jumpVel;
    airborne = true;
    audio.jump();
  }
}

// ---- camera ----------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(tune.fov, window.innerWidth / window.innerHeight, 0.1, 400);
const chase = new ChaseCam(camera, tune);
chase.snapBehind(player.root.position.x, player.root.position.y, player.root.position.z);

// ---- P6: camera occlusion fade (see-through trees/props/buildings) ----------
const occlusion = new Occlusion(scene, camera);
// non-instanced occluders fade whole-root: the farmhouse as one piece, each
// editor prop group, each placed decoration group.
occlusion.addContainer(sceneryOccluders.farmhouse, () => sceneryOccluders.farmhouse);
// barn walls + roof fade as one piece so you can see inside (player or animals)
occlusion.addContainer(barnScene.barnRoot, () => barnScene.barnRoot);
occlusion.addContainer(worldPropsGroup, Occlusion.childUnder(worldPropsGroup));
occlusion.addContainer(decorField.group, Occlusion.childUnder(decorField.group));
// instanced scenery fades via hide-instance + fadeable proxy.
occlusion.addInstanced(sceneryOccluders.trees);
occlusion.addInstanced(sceneryOccluders.rocks);

// ---- controls --------------------------------------------------------------
const tunePanel = buildTunePanel(
  tune,
  () => {
    camera.fov = tune.fov;
    camera.updateProjectionMatrix();
  },
  audio,
  (on) => applyFastGrow(on)
);

/** Apply the fast-grow interpretation flag + repaint every planted tile at its
 * new stage immediately (field.tick would catch up over frames, but a toggle
 * should be instant). Also refreshes any open target label. */
function applyFastGrow(on: boolean): void {
  setFastGrow(on);
  tune.fastGrow = on;
  field.syncAll(farmState, flNow());
}
const controls = new Controls(renderer.domElement, chase, [tunePanel.root]);
let touch: TouchControls | null = null;
if (isMobile()) touch = new TouchControls(chase);

// SPACE = jump, E = action (P1.5 binding split — Space was the P1 action key).
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === " " && !e.repeat) {
    e.preventDefault();
    requestJump();
  } else if (k === "e" && !e.repeat) {
    e.preventDefault();
    doAction();
  }
});

// RIGHT-CLICK = action too (user request 2026-07-10): left-drag orbits, right
// hand stays on the mouse. Canvas only — HUD sits above and never sees this.
// WALK-THEN-ACT (2026-07-10): raycast the click into the world; if it lands on a
// field tile, act on THAT tile — walking to it first if it's out of reach.
// Anything else (or a miss) falls back to the faced-target doAction().
const _rayc = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
function rightClickAct(clientX: number, clientY: number): void {
  cancelAutoWalk(); // a new right-click always replaces any in-progress goal
  if (placing) {
    confirmPlacement();
    return;
  }
  _ndc.x = (clientX / window.innerWidth) * 2 - 1;
  _ndc.y = -(clientY / window.innerHeight) * 2 + 1;
  _rayc.setFromCamera(_ndc, camera);
  const hits = _rayc.intersectObject(ground, false);
  if (hits.length) {
    const p = hits[0].point;
    const t = worldToTile(p.x, p.z);
    if (t) {
      requestTileAction(t.gx, t.gz);
      return;
    }
  }
  doAction(); // not a field tile — keep the faced-target behavior
}
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.button === 2) rightClickAct(e.clientX, e.clientY);
});

// P5: placement-mode keys — Q/R rotate, Escape cancels (with refund). Runs
// first; while placing, Q also no-ops the HUD's cycleCrop (guarded there).
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (placing) {
    const k = e.key.toLowerCase();
    if (k === "q") {
      e.preventDefault();
      rotatePlacement(-1);
    } else if (k === "r") {
      e.preventDefault();
      rotatePlacement(1);
    } else if (k === "escape") {
      e.preventDefault();
      cancelPlacement(true);
    }
  } else if (e.key === "Escape" && removeArmed) {
    removeArmed = null;
  }
});

// ---- debug hook ------------------------------------------------------------
const playerState: PlayerState = {
  x: player.root.position.x,
  z: player.root.position.z,
  y: player.root.position.y,
  heading: 0,
  speed: 0,
  airborne: false,
};
installDebug({ player: playerState, cam: chase, controls, tune });

// ---- P3: live presence (Playroom) ------------------------------------------
// Ephemeral "who's on the farm now": remote avatars + name tags + tool-use
// anims + emotes, ~10Hz interpolated. Firestore stays the sole farm authority;
// nothing here writes farm state. Playroom-unreachable = solo, one quiet toast.
const maxGait = tune.moveSpeed * tune.runMult;
const remotePlayers = new RemotePlayers(scene, maxGait);
const presence = new Presence((msg) => hud.toast(msg));

// local player's own emote bubble (so you see your own reaction too)
const localBubble = makeEmoteBubble();
localBubble.sprite.position.set(0, 2.75, 0);
player.root.add(localBubble.sprite);

presence.onJoin((id, name) => {
  remotePlayers.add(id, name);
  hud.toast(`🌻 ${name} arrived at the farm!`);
  hud.setPresence(presence.presentCount());
  audio.join();
});
presence.onQuit((id, name) => {
  remotePlayers.remove(id);
  hud.toast(`👋 ${name || "A farmer"} headed home`);
  hud.setPresence(presence.presentCount());
  audio.leave();
});
presence.onRemoteAnim((id, kind) => {
  remotePlayers.playAnim(id, kind);
  // spatially-attenuated echo of the remote's tool action (0 far → 1 near)
  const rp = remotePlayers.pos(id);
  if (rp) {
    const d = Math.hypot(rp.x - player.root.position.x, rp.z - player.root.position.z);
    audio.remoteAction(kind, Math.max(0, 1 - d / 26));
  }
});
presence.onRemoteEmote((id, kind) => remotePlayers.showEmote(id, kind));
void presence.ready.then((ok) => {
  if (ok) hud.setPresence(presence.presentCount());
});

// family-lobby doc (games.html JOIN card) — single-writer, degrades silently
const lobby = new FarmLobby(presence);
void lobby;

/** Current local pose for presence publishing. */
function localPose() {
  return {
    x: player.root.position.x,
    y: player.root.position.y,
    z: player.root.position.z,
    heading,
    tool: farmState.selectedTool,
  };
}

/** Fire an emote locally (own bubble) and replicate it to everyone. */
function doEmote(kind: EmoteKind): void {
  localBubble.show(kind);
  presence.emitEmote(kind, localPose());
}
hud.onEmote(doEmote);
// desktop shortcuts: Z / X / C = wave / heart / laugh (E is the action key in
// Farm Life, so emotes get their own keys — see report). The 💬 HUD button
// gives the full picker on both desktop and mobile.
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  const map: Record<string, EmoteKind> = { z: EMOTE_ORDER[0], x: EMOTE_ORDER[1], c: EMOTE_ORDER[2] };
  if (map[k]) {
    e.preventDefault();
    doEmote(map[k]);
  } else if (k === "m") {
    // M = mute toggle (persisted to fl_muted); keep the TUNE panel row in sync.
    audio.resume();
    const muted = audio.toggleMute();
    tunePanel.syncAudio?.();
    hud.toast(muted ? "🔇 Muted" : "🔊 Sound on");
  }
});

// Test-only hook: render once and read the framebuffer synchronously so a
// headless "canvas non-blank" check is reliable regardless of preserveDrawingBuffer.
const flHook = (window as unknown as { __FL__: Record<string, unknown> }).__FL__;
flHook._snap = () => {
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const seen = new Set<number>();
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4 * 37) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    seen.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    sum += l; sum2 += l * l; n++;
  }
  const mean = sum / n;
  const stdev = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return { w, h, distinct: seen.size, stdev };
};
// Test probes for deterministic camera/collision assertions.
flHook._probe = () => ({
  camY: camera.position.y,
  camX: camera.position.x,
  camZ: camera.position.z,
  groundY: sampleHeight(camera.position.x, camera.position.z),
  pitch: chase.pitch,
});
flHook._setYaw = (y: number) => { chase.yaw = y; };
flHook._setPitch = (p: number) => { chase.pitch = p; };
// snap the camera directly behind the player (P6 occlusion test: position the
// camera instantly so a tree between it and the player is occluding right away).
flHook._snapCam = () => chase.snapBehind(player.root.position.x, player.root.position.y, player.root.position.z);

// ---- avatar (P1.5) test/anim probes -----------------------------------------
const _v = new THREE.Vector3();
flHook.avatar = {
  jump: () => requestJump(),
  playAnim: (kind: string) => player.playToolAnim(kind as Parameters<typeof player.playToolAnim>[0]),
  isBusy: () => player.isBusy(),
  actionProgress: () => player.actionProgress(),
  squashActive: () => player.squashActive(),
  landCount: () => player.landCount(),
  armQuat: () => {
    const q = player.armPivot.quaternion;
    return [q.x, q.y, q.z, q.w];
  },
  handWorld: () => {
    player.handAnchor.getWorldPosition(_v);
    return { x: _v.x, y: _v.y, z: _v.z };
  },
  toolWorld: () => {
    if (!heldToolMesh) return null;
    heldToolMesh.getWorldPosition(_v);
    return { x: _v.x, y: _v.y, z: _v.z };
  },
  // Local-space bounding-box dims of the held tool mesh (P6 hoe-silhouette test:
  // the reworked hoe is taller + has a wide flat blade — dims differ from the old
  // pick-like head). Measured in the tool's own frame (parent inverse applied).
  toolLocalBBox: () => {
    if (!heldToolMesh) return null;
    heldToolMesh.updateWorldMatrix(true, true);
    // world box → tool-local frame via the tool's matrixWorld inverse
    const inv = new THREE.Matrix4().copy(heldToolMesh.matrixWorld).invert();
    const b = new THREE.Box3().setFromObject(heldToolMesh).applyMatrix4(inv);
    const size = new THREE.Vector3();
    b.getSize(size);
    return { x: size.x, y: size.y, z: size.z };
  },
  toolAttachedToHand: () => {
    if (!heldToolMesh) return false;
    let p: THREE.Object3D | null = heldToolMesh.parent;
    while (p) {
      if (p === player.handAnchor) return true;
      p = p.parent;
    }
    return false;
  },
  tool: () => farmState.selectedTool,
  // Stage 2 rigged-farmer hooks (verify-p9):
  usesModel: () => player.usesModel(),
  boneQuat: (name: string) => player.boneQuat(name),
  boneNames: () => player.boneNames(),
  // synchronously drive the farmer at a commanded speed (no rAF interleave) and
  // return the locomotion crossfade weights — walk/run-by-speed probe.
  driveLoco: (speedFrac: number, frames = 30) => {
    const max = tune.moveSpeed * tune.runMult;
    for (let i = 0; i < frames; i++) player.update(1 / 60, speedFrac * max, max, false);
    return player.locoWeights();
  },
  // world-space y of the last harvest hold-up mesh, minus the player's feet y
  // (proves the produce is raised OVERHEAD, not at the ground).
  produceLiftY: () => {
    if (!lastProduceMesh || !lastProduceMesh.parent) return null;
    lastProduceMesh.getWorldPosition(_v);
    return _v.y - player.root.position.y;
  },
};

// ---- farm debug/test hooks ---------------------------------------------------
flHook.farm = {
  gridSize: GRID,
  state: () => JSON.parse(JSON.stringify(farmState)) as FarmState,
  target: () => {
    if (!pending) return null;
    if (pending.type === "sell") return { kind: "sell", label: pending.label };
    if (pending.type === "refill") return { kind: "refill", label: pending.label };
    if (pending.type === "animal") return { kind: "animal", label: pending.label };
    if (pending.type === "removeDecor") return { kind: "removeDecor", label: pending.label };
    const res = pending.res!;
    return {
      kind: res.verb ?? (res.hint ? "hint" : "growing"),
      verb: res.verb,
      hint: res.hint,
      gx: pending.gx,
      gz: pending.gz,
      cropId: res.cropId,
      label: res.label,
    };
  },
  tileAt: (gx: number, gz: number) => {
    const rec = farmState.tiles[tileKey(gx, gz)];
    if (!rec) return { present: false };
    if (!rec.crop) return { present: true, tilled: true, crop: null };
    const gt = { plantedAt: rec.plantedAt ?? 0, accruedMs: rec.accruedMs ?? 0, lastWatered: rec.lastWatered ?? 0 };
    return {
      present: true,
      tilled: true,
      crop: rec.crop,
      stage: growthStage(gt, effectiveCrop(CROPS[rec.crop]), flNow()),
      lastWatered: gt.lastWatered,
    };
  },
  action: () => doAction(),
  equip: (id: ToolId) => equipTool(id),
  selectedTool: () => farmState.selectedTool,
  tank: () => farmState.tank,
  tankCap: () => tankCap(),
  hintFires: () => hintFireCount,
  cycleCrop: () => cycleCrop(),
  selectCrop: (id: CropId) => {
    farmState.selectedCrop = id;
    refreshToolHud();
    persistFarm();
  },
  buySeed: (id: CropId) => buySeed(id),
  // test hook: grant harvested crops directly (skips the grow loop in tests that
  // only need inventory to sell — the grow math is covered by growth.test.ts).
  addCrop: (id: CropId, n: number) => {
    farmState.crops[id] = (farmState.crops[id] ?? 0) + n;
    refreshToolHud();
    persistFarm();
  },
  // test/screenshot hook: plant a tile at a chosen VISUAL stage (0 sprout / 1
  // young / 2 mature / 3 ready) by banking accruedMs directly. Bypasses timing.
  plantStage: (gx: number, gz: number, crop: CropId, stage: 0 | 1 | 2 | 3) => {
    const now = flNow();
    const c = CROPS[crop];
    const frac = stage === 0 ? 0.15 : stage === 1 ? 0.5 : stage === 2 ? 0.85 : 1.1;
    const key = tileKey(gx, gz);
    farmState.tiles[key] = { crop, plantedAt: now, accruedMs: c.growMs * frac, lastWatered: now };
    field.syncTile(gx, gz, farmState.tiles[key], now);
  },
  teleport: (x: number, z: number) => {
    player.root.position.set(x, sampleHeight(x, z), z);
  },
  setHeading: (h: number) => {
    heading = h;
    player.root.rotation.y = h;
  },
  isShopOpen: () => hud.isShopOpen(),
  closeShop: () => hud.hideShop(),
  binPos: { x: bin.x, z: bin.z },
  standPos: { x: stand.x, z: stand.z },
  pondPos: { x: POND.cx, z: POND.cz, r: POND.r },
  _setTimeOffset: (ms: number) => setTimeOffset(ms),
  _addTimeOffset: (ms: number) => addTimeOffset(ms),
  flushSave: () => farmStore.flush?.(),
  // fast-grow (test mode) hooks
  fastGrow: () => tune.fastGrow,
  setFastGrow: (on: boolean) => applyFastGrow(on),
  // walk-then-act hooks: rightClickTile drives the resolved-onto-a-tile path
  // (deterministic, no raycast); autoWalk exposes the in-progress goal.
  rightClickTile: (gx: number, gz: number) => requestTileAction(gx, gz),
  autoWalk: () =>
    autoWalk ? { gx: autoWalk.gx, gz: autoWalk.gz, standX: autoWalk.standX, standZ: autoWalk.standZ } : null,
  cancelAutoWalk: () => cancelAutoWalk(),
  // screen-space coords of a tile center (for driving the REAL raycast right-click)
  tileScreen: (gx: number, gz: number) => {
    const { x, z } = tileCenter(gx, gz);
    return worldToScreen(x, sampleHeight(x, z), z);
  },
};

// ---- world (P1.5b editor) test/debug hooks ----------------------------------
flHook.world = {
  sampleHeight: (x: number, z: number) => sampleHeight(x, z),
  objectCount: () => world.objects.length,
  fenceCount: () => world.fences.length,
  types: () => world.objects.map((o) => o.type),
  // pushback distance if the player tried to stand at (x,z) — >0.05 => a collider
  // occupies it (used to prove a placed barn actually collides).
  collidePush: (x: number, z: number) => {
    const r = resolveCollision(x, z);
    return Math.hypot(r.x - x, r.z - z);
  },
  // nearest ground-mesh vertex color at (x,z) — proves paint reached the mesh.
  groundColorAt: (x: number, z: number) => {
    const geo = ground.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = geo.attributes.color as THREE.BufferAttribute | undefined;
    if (!col) return null;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const d = (pos.getX(i) - x) ** 2 + (pos.getZ(i) - z) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return [col.getX(bi), col.getY(bi), col.getZ(bi)];
  },
  // P6 collider-retract test hooks: inject a barn then re-apply the world and
  // assert the obstacle count is STABLE (no stale colliders leak).
  obstacleCount: () => obstacleCount(),
  injectTestBarn: () => {
    world.objects.push({ id: "p6test", type: "barn", x: 6, y: sampleHeight(6, -30), z: -30, sx: 8, sy: 6, sz: 6, rotY: 0 });
    applyWorld(world);
    return obstacleCount();
  },
  reapplyWorld: () => {
    applyWorld(world);
    return obstacleCount();
  },
};

// ---- Stage-1 art-swap (GLB models) test hooks -------------------------------
flHook.models = {
  cropsReady: () => cropModelsReady(),
  cropUsesModel: (id: CropId) => cropUsesModel(id),
  // how many crop groups currently on the field are GLB-derived (userData.glb)
  cropGlbGroups: () => {
    let n = 0;
    field.group.children.forEach((c) => {
      if ((c as THREE.Object3D).userData?.glb) n++;
    });
    return n;
  },
  animalsUseModel: () => animalField.usesModels(),
  animalMeshKind: (id: string) => {
    const a = animalField.actorAt(id);
    return a ? (a.mesh as unknown as { kind?: string }).kind ?? "?" : null;
  },
  // sample an animal's skinned-bone world position, for the frozen-bind-pose
  // guard (verify-p8 samples this twice over time and asserts it MOVES).
  animalBoneSample: (id: string) => animalField.boneSample(id),
  // farmhouse (scenery) swapped to a GLB?
  farmhouseUsesModel: () => sceneryModelsUsed(),
  // barn/shed/silo prop type resolves to a GLB?
  propUsesModel: (type: string) => propUsesModel(type),
  buildingsReady: () => buildingModelsReady(),
  // how many editor-placed world props are GLB-derived (userData.glb)
  worldPropGlbCount: () => {
    let n = 0;
    worldPropsGroup.children.forEach((c) => {
      if ((c as THREE.Object3D).userData?.glb) n++;
    });
    return n;
  },
  // farmhouse window glow emissive intensities (night-glow check)
  windowGlow: () => farmhouseWindows().map((m) => m.emissiveIntensity),
  // Stage 2: the rigged player character
  characterReady: () => characterModelReady(),
  playerUsesModel: () => player.usesModel(),
};

// ---- P6 occlusion + audio test hooks ----------------------------------------
flHook.occlusion = {
  fadedCount: () => occlusion.fadedCount(),
  minOpacity: () => occlusion.minOpacity(),
  proxyMinOpacity: () => occlusion.proxyMinOpacity(),
  proxyCount: () => occlusion.proxyCount(),
  treeSpots: () => {
    const out: { x: number; z: number }[] = [];
    for (let i = 0; i < sceneryOccluders.trees.count; i++) out.push(sceneryOccluders.trees.spotXZ(i));
    return out;
  },
  recompute: () => occlusion.recomputeNow(player.root.position.x, player.root.position.y, player.root.position.z),
};
flHook.perf = {
  info: () => ({
    calls: renderer.info.render.calls,
    tris: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
  }),
};
flHook.audio = {
  muted: () => audio.isMuted(),
  setMuted: (m: boolean) => audio.setMuted(m),
  toggle: () => audio.toggleMute(),
  volume: () => audio.getVolume(),
  setVolume: (v: number) => audio.setVolume(v),
  resume: () => audio.resume(),
  masterGain: () => audio.masterGainValue(),
  playCount: () => audio.playCount,
  ambient: () => audio.ambientGains(),
  setAmbient: (d: number, r: boolean) => audio.setAmbient(d, r),
  ctxState: () => audio.ctxState(),
  ambientTargets: () => audio.ambientTargets(),
  hoe: () => audio.hoe(),
  coin: () => audio.coin(),
};

// ---- P2 net/sync test hooks --------------------------------------------------
flHook.net = {
  isCloud: () => farmStore === cloudFarm,
  ready: () => (cloudFarmCtor ? cloudFarmCtor.ready : Promise.resolve(false)),
  flush: () => farmStore.flush?.(),
  playerName: () => (cloudFarmCtor ? cloudFarmCtor.playerName : null),
};

// ---- P3 presence test hooks -------------------------------------------------
flHook.presence = {
  ready: () => presence.ready,
  connected: () => presence.connected,
  roomCode: () => presence.roomCode,
  myId: () => presence.myId,
  presentCount: () => presence.presentCount(),
  isOldestPresent: () => presence.isOldestPresent(),
  remoteIds: () => remotePlayers.ids(),
  remoteCount: () => remotePlayers.count(),
  remotePos: (id: string) => remotePlayers.pos(id),
  remoteTool: (id: string) => remotePlayers.tool(id),
  remoteArmQuat: (id: string) => remotePlayers.armQuat(id),
  remoteBusy: (id: string) => remotePlayers.busy(id),
  remoteEmoteVisible: (id: string) => remotePlayers.emoteVisible(id),
  sceneChildCount: () => scene.children.length,
  emote: (kind: EmoteKind) => doEmote(kind),
  // Stage 2 test hooks: synthesize a remote avatar (no Playroom) + read its rig.
  addTestRemote: (id: string, name: string, x: number, z: number) => {
    remotePlayers.add(id, name);
    const rp = remotePlayers as unknown as { avatars: Map<string, { farmer: { root: THREE.Object3D } }> };
    const a = rp.avatars.get(id);
    if (a) a.farmer.root.position.set(x, sampleHeight(x, z), z);
  },
  remoteUsesModel: (id: string) => remotePlayers.usesModel(id),
  remoteNameTagLiftY: (id: string) => remotePlayers.nameTagLiftY(id),
  remoteBodyColors: (id: string) => remotePlayers.bodyColors(id),
};

// ---- P4: day/night (cosmetic-only, real America/Chicago time) --------------
const stars = buildStars();
scene.add(stars.points);
const rain = buildPrecip({ count: 260, color: 0xbcd8ee, size: 0.16, fallSpeed: 14, spread: 16, height: 14 });
scene.add(rain.group);
const snow = buildPrecip({ count: 200, color: 0xffffff, size: 0.14, fallSpeed: 2.2, spread: 16, height: 14 });
scene.add(snow.group);

// forward ref so applySky (called once before WeatherStation is constructed) can
// read the live rain condition for the ambient bed without a TDZ error.
let weatherRef: WeatherStation | null = null;
function applySky(): void {
  const s = skyAt(flNow());
  const skyColor = new THREE.Color(s.sky[0], s.sky[1], s.sky[2]);
  (scene.background as THREE.Color).copy(skyColor);
  (scene.fog as THREE.Fog).color.setRGB(s.fog[0], s.fog[1], s.fog[2]);
  hemi.color.setRGB(s.hemiSky[0], s.hemiSky[1], s.hemiSky[2]);
  hemi.groundColor.setRGB(s.hemiGround[0], s.hemiGround[1], s.hemiGround[2]);
  hemi.intensity = s.hemiIntensity;
  sun.color.setRGB(s.sunColor[0], s.sunColor[1], s.sunColor[2]);
  sun.intensity = s.sunIntensity;
  amb.intensity = s.ambIntensity;
  stars.setAlpha(s.starAlpha);
  const az = THREE.MathUtils.degToRad(s.sunAzimuthDeg);
  const el = THREE.MathUtils.degToRad(s.sunElevDeg);
  const dist = 70;
  sun.position.set(Math.cos(el) * Math.cos(az) * dist, Math.max(4, Math.sin(el) * dist), Math.cos(el) * Math.sin(az) * dist);
  for (const mat of farmhouseWindows()) mat.emissiveIntensity = s.windowGlow;
  // P6 ambient: birds by day, crickets by night, patter while raining. Day
  // factor ramps across dusk/dawn (−6°…+6° of sun elevation).
  const dayFactor = Math.max(0, Math.min(1, (s.sunElevDeg + 6) / 12));
  audio.setAmbient(dayFactor, weatherRef?.current?.cond === "rain");
}
applySky();

// ---- P4: real Woodville weather ---------------------------------------------
// wasRaining/nextRainAutoWaterAt MUST be declared before constructing
// WeatherStation: its constructor calls the onChange callback SYNCHRONOUSLY
// when a cached snapshot already exists (instant paint on a warm boot), which
// would otherwise throw a TDZ ReferenceError reading a `let` declared below it.
let wasRaining = false;
let nextRainAutoWaterAt = Infinity;
const weather = new WeatherStation((snap) => {
  const label = snap.tempF != null ? `${weatherEmoji(snap.cond)} ${Math.round(snap.tempF)}°F` : weatherEmoji(snap.cond);
  hud.setWeather(label);
  if (snap.cond === "rain" && !wasRaining) hud.toast("🌧 It's raining at the farm — crops are getting watered!");
  wasRaining = snap.cond === "rain";
  rain.setVisible(snap.cond === "rain");
  snow.setVisible(snap.cond === "snow");
  audio.setAmbient(Math.max(0, Math.min(1, (skyAt(flNow()).sunElevDeg + 6) / 12)), snap.cond === "rain");
});
weatherRef = weather;

/** Waters every currently-due (needsWater) planted tile — idempotent per
 * tile via the normal waterTile checkpoint, so concurrent clients racing this
 * on the same rainy minute are harmless (last write simply re-confirms the
 * same watered state). Routed through the SAME executeVerb machinery's tile
 * write + field visual sync, never a shortcut. */
function autoWaterFromRain(nowMs: number): void {
  let count = 0;
  for (const key of Object.keys(farmState.tiles)) {
    const rec = farmState.tiles[key];
    if (!rec.crop) continue;
    const crop = effectiveCrop(CROPS[rec.crop]);
    const gt = { plantedAt: rec.plantedAt ?? 0, accruedMs: rec.accruedMs ?? 0, lastWatered: rec.lastWatered ?? rec.plantedAt ?? 0 };
    if (!needsWater(gt, crop, nowMs)) continue;
    const wt = waterTile(gt, crop, nowMs);
    farmState.tiles[key] = { crop: rec.crop, ...wt };
    const p = parseTileKey(key);
    if (!p) continue;
    field.syncTile(p.gx, p.gz, farmState.tiles[key], nowMs);
    count++;
  }
  if (count > 0) persistFarm();
}

function tickWeatherEffects(nowMs: number, px: number, pz: number, baseY: number): void {
  const raining = weather.current?.cond === "rain";
  if (raining) {
    if (nextRainAutoWaterAt === Infinity) nextRainAutoWaterAt = nowMs + RAIN_AUTO_WATER_INTERVAL_MS;
    if (nowMs >= nextRainAutoWaterAt) {
      nextRainAutoWaterAt = nowMs + RAIN_AUTO_WATER_INTERVAL_MS;
      autoWaterFromRain(nowMs);
    }
  } else {
    nextRainAutoWaterAt = Infinity;
  }
  rain.update(1 / 60, px, pz, baseY + 8);
  snow.update(1 / 60, px, pz, baseY + 8);
}

// ---- P4: animal test/debug hooks --------------------------------------------
flHook.animals = {
  ids: () => STARTER_HERD.map((s) => s.id),
  record: (id: string) => (herd[id] ? JSON.parse(JSON.stringify(herd[id])) : null),
  actorPos: (id: string) => {
    const a = animalField.actorAt(id);
    return a ? { x: a.x, z: a.z } : null;
  },
  setPos: (id: string, x: number, z: number) => {
    const a = animalField.actorAt(id);
    if (a) { a.x = x; a.z = z; a.mesh.group.position.set(x, sampleHeight(x, z), z); }
  },
  pastureBounds: () => ({ ...PASTURE }),
  barnBounds: () => ({ ...BARN }),
  interaction: (id: string) => {
    const a = herd[id];
    return a ? resolveAnimalAction(a, ANIMAL_DEFS[a.type], flNow()) : null;
  },
  target: () => (pending && pending.type === "animal" ? { id: pending.animalId, action: pending.animalAction, label: pending.label } : null),
  action: () => doAction(),
  collect: (id: string) => {
    if (herd[id]) doAnimalAction(id, "collect", 0, 0, 0);
  },
  pet: (id: string) => {
    if (herd[id]) doAnimalAction(id, "pet", 0, 0, 0);
  },
  produce: () => JSON.parse(JSON.stringify(farmState.produce)),
  // ---- husbandry-rework hooks (routine, containment, sleep) ----
  phase: () => dayPhase(flNow()),
  /** Fast-forward the shared clock so dayPhase lands in a target phase (mid-band). */
  setPhase: (name: "day" | "dusk" | "night" | "dawn") => {
    const targetHour = name === "day" ? 13 : name === "dusk" ? 19.3 : name === "night" ? 1 : 7;
    const cur = centralHour(flNow());
    let delta = targetHour - cur;
    while (delta > 12) delta -= 24;
    while (delta < -12) delta += 24;
    addTimeOffset(delta * 3_600_000);
    return dayPhase(flNow());
  },
  /** Drive the herd forward `seconds` deterministically (in ~1/30s steps). */
  advance: (seconds: number) => {
    const steps = Math.max(1, Math.round(seconds * 30));
    for (let i = 0; i < steps; i++) animalField.update(1 / 30, dayPhase(flNow()), barnScene.doorIsOpen());
  },
  inside: (id: string) => animalField.isInside(id),
  sleeping: (id: string) => animalField.isSleeping(id),
  allInside: () => STARTER_HERD.every((s) => animalField.isInside(s.id)),
  anyInside: () => STARTER_HERD.some((s) => animalField.isInside(s.id)),
  allSleeping: () => STARTER_HERD.every((s) => animalField.isSleeping(s.id)),
  zzzVisible: (id: string) => animalField.actorAt(id)?.zzz.visible ?? false,
  isCloud: () => animalStore === cloudAnimals,
  ready: () => (cloudAnimalsCtor ? cloudAnimalsCtor.ready : Promise.resolve(false)),
  flushSave: () => animalStore.flush?.(),
};

// ---- barn (door + physical eggs) test/debug hooks ---------------------------
flHook.barn = {
  isOpen: () => barnScene.doorIsOpen(),
  doorAngle: () => barnScene.doorAngle(),
  doorState: () => ({ ...doorState }),
  toggle: () => toggleBarnDoor(),
  setOpen: (o: boolean) => {
    if (barnScene.doorIsOpen() !== o) toggleBarnDoor();
  },
  eggIds: () => Object.keys(eggs).filter((id) => !eggs[id].collectedBy),
  eggCount: () => Object.values(eggs).filter((e) => !e.collectedBy).length,
  eggMeshCount: () => barnScene.eggMeshCount(),
  eggRecord: (id: string) => (eggs[id] ? JSON.parse(JSON.stringify(eggs[id])) : null),
  layNow: () => maybeLayEggs(flNow()),
  collect: (id: string) => {
    const e = eggs[id];
    if (e) collectEgg(id, e.x, sampleHeight(e.x, e.z) + 0.5, e.z);
  },
  nestSpot: (chickenId: string) => nestSpot(chickenId),
  bounds: () => ({ pasture: { ...PASTURE }, barn: { ...BARN }, gate: { ...GATE }, door: barnScene.doorAnchor }),
  gateCollidePush: () => {
    const r = resolveCollision(GATE_CENTER.x, GATE_CENTER.z);
    return Math.hypot(r.x - GATE_CENTER.x, r.z - GATE_CENTER.z);
  },
  isCloud: () => barnStore === cloudBarn,
  ready: () => (cloudBarnCtor ? cloudBarnCtor.ready : Promise.resolve(false)),
  flushSave: () => barnStore.flush?.(),
  usesModel: () => barnScene.usesModel(),
};

// ---- P5: decoration + meta test/debug hooks ---------------------------------
flHook.decor = {
  count: () => decorField.count(),
  ids: () => decorField.ids(),
  record: (id: string) => (decor[id] ? JSON.parse(JSON.stringify(decor[id])) : null),
  types: () => Object.values(decor).map((d) => d.type),
  buy: (type: string) => buyDecor(type),
  placing: () =>
    placing
      ? { type: placing.type, valid: placing.valid, rotY: placing.rotY, x: placing.targetX, z: placing.targetZ }
      : null,
  rotate: (dir?: number) => rotatePlacement(dir ?? 1),
  confirm: () => confirmPlacement(),
  cancel: () => cancelPlacement(true),
  target: () => (pending && pending.type === "removeDecor" ? { id: pending.decorId, label: pending.label } : null),
  removeArmed: () => (removeArmed ? { id: removeArmed.id, until: removeArmed.until } : null),
  action: () => doAction(),
  isCloud: () => decorStore === cloudDecor,
  ready: () => (cloudDecorCtor ? cloudDecorCtor.ready : Promise.resolve(false)),
  flushSave: () => decorStore.flush?.(),
};

flHook.meta = {
  shipped: () => JSON.parse(JSON.stringify(meta.shipped)),
  milestones: () => JSON.parse(JSON.stringify(meta.milestones)),
  farmName: () => meta.farmName,
  foundedAt: () => meta.foundedAt,
  openBook: () => openFarmBook(),
  closeBook: () => hud.hideFarmBook(),
  bookOpen: () => hud.isFarmBookOpen(),
  bookMilestonesEarned: () => document.querySelectorAll("#fl-book .ms.earned").length,
  isCloud: () => metaStore === cloudMeta,
  ready: () => (cloudMetaCtor ? cloudMetaCtor.ready : Promise.resolve(false)),
  flushSave: () => metaStore.flush?.(),
};

// ---- P7: Farm Map + Inventory test/debug hooks --------------------------------
flHook.mapinv = {
  openMap: () => hud.openMap(),
  closeMap: () => hud.closeMap(),
  isMapOpen: () => hud.isMapOpen(),
  mapSnapshot: () => JSON.parse(JSON.stringify(buildMapSnapshot())) as FarmMapSnapshot,
  // draw one frame synchronously so a headless test can sample pixels without
  // depending on rAF timing.
  drawMapNow: () => drawFarmMap(mapCtx, hud.mapCanvasSize(), buildMapSnapshot(), flNow() / 1000),
  openInventory: () => hud.showInventory(buildInventoryData()),
  closeInventory: () => hud.hideInventory(),
  isInventoryOpen: () => hud.isInventoryOpen(),
  inventoryData: () => JSON.parse(JSON.stringify(buildInventoryData())) as InventoryData,
};

// ---- P4: weather/day-night test/debug hooks ---------------------------------
flHook.weather = {
  current: () => weather.current,
  sky: () => skyAt(flNow()),
  isRaining: () => rain.group.visible,
  isSnowing: () => snow.group.visible,
  applySky: () => applySky(),
  _inject: (snap: { cond: "clear" | "rain" | "snow"; code: number; fetchedAt: number; tempF?: number }) => {
    weather.current = snap;
    const label = snap.tempF != null ? `${weatherEmoji(snap.cond)} ${Math.round(snap.tempF)}°F` : weatherEmoji(snap.cond);
    hud.setWeather(label);
    if (snap.cond === "rain" && !wasRaining) hud.toast("🌧 It's raining at the farm — crops are getting watered!");
    wasRaining = snap.cond === "rain";
    rain.setVisible(snap.cond === "rain");
    snow.setVisible(snap.cond === "snow");
  },
  nextAutoWaterAt: () => nextRainAutoWaterAt,
};

// ---- resize ----------------------------------------------------------------
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", onResize);

// ---- loop ------------------------------------------------------------------
const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
const moveDir = new THREE.Vector3();
let last = performance.now();
let skyTimer = 2; // force an immediate first paint (avoid a frame at the boot default)

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // gather input (touch overrides keyboard when present & active)
  let input = controls.sample();
  if (touch && (touch.input.fwd !== 0 || touch.input.strafe !== 0)) input = touch.input;
  // any manual movement input cancels an auto-walk goal (checked on the RAW input,
  // before the busy-freeze below zeroes it).
  if (autoWalk && (input.fwd !== 0 || input.strafe !== 0)) cancelAutoWalk();
  // freeze movement while a tool-use animation is playing (so it reads)
  if (player.isBusy()) input = { fwd: 0, strafe: 0, run: false };

  let speed = 0;
  if (autoWalk && !player.isBusy() && !airborne) {
    // walk-then-act: steer toward the clicked tile's stand point, then act.
    speed = stepAutoWalk(dt);
  } else {
    // camera-relative movement
    chase.forwardVec(fwd);
    chase.rightVec(right);
    moveDir.set(0, 0, 0).addScaledVector(fwd, input.fwd).addScaledVector(right, input.strafe);

    const mag = moveDir.length();
    if (mag > 0.001) {
      moveDir.normalize();
      let spd = tune.moveSpeed * (input.run ? tune.runMult : 1) * Math.min(1, mag);
      if (airborne) spd *= 0.72; // slightly reduced air control
      const px = player.root.position.x + moveDir.x * spd * dt;
      const pz = player.root.position.z + moveDir.z * spd * dt;
      const before = { x: player.root.position.x, z: player.root.position.z };
      const res = resolveCollision(px, pz);
      player.root.position.x = res.x;
      player.root.position.z = res.z;
      speed = Math.hypot(res.x - before.x, res.z - before.z) / dt;

      // turn to face movement direction
      const targetHeading = Math.atan2(moveDir.x, moveDir.z);
      let dh = targetHeading - heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      heading += dh * Math.min(1, tune.turnRate * dt);
      player.root.rotation.y = heading;
    }
  }

  // vertical: ballistic jump, land on terrain
  const groundY = sampleHeight(player.root.position.x, player.root.position.z);
  if (airborne) {
    vy -= tune.gravity * dt;
    player.root.position.y += vy * dt;
    if (player.root.position.y <= groundY) {
      player.root.position.y = groundY;
      airborne = false;
      vy = 0;
      player.land();
      audio.land();
    }
  } else {
    player.root.position.y = groundY;
  }

  // animate character
  player.update(dt, speed, tune.moveSpeed * tune.runMult, airborne);
  if (!airborne) audio.footTick(dt, speed, Math.min(1, speed / maxGait));

  // camera follow
  sun.target.position.copy(player.root.position);
  chase.update(dt, player.root.position.x, player.root.position.y, player.root.position.z);
  // P6: fade any scenery between the camera and the player (throttled internally)
  occlusion.update(dt, player.root.position.x, player.root.position.y, player.root.position.z);

  // publish debug state
  playerState.x = player.root.position.x;
  playerState.z = player.root.position.z;
  playerState.y = player.root.position.y;
  playerState.heading = heading;
  playerState.speed = speed;
  playerState.airborne = airborne;

  // farming: retarget, tick time-driven stage changes, animate sparkle/pops, label
  updateTargeting(player.root.position.x, player.root.position.z, heading);
  const nowMs = flNow();
  field.tick(farmState, nowMs);
  field.animate(nowMs / 1000);
  if (pending) {
    const { sx, sy } = worldToScreen(pending.worldX, pending.worldY, pending.worldZ);
    hud.showActionLabel(pending.label, sx, sy, pending.color);
  } else {
    hud.showActionLabel(null, 0, 0, "#fff");
  }

  // P3 presence: publish our pose, poll remotes, drive remote avatars + bubbles
  presence.publishLocal(localPose());
  presence.update(dt);
  remotePlayers.update(dt, presence, camera);
  localBubble.update(dt);

  // P4: animals wander + day/night + weather (all cosmetic-only, never gates
  // movement/farming). Sky is throttled — Intl formatting every frame is
  // unnecessary churn for a value that only meaningfully changes minute to minute.
  const animalPhase = dayPhase(nowMs);
  animalField.update(dt, animalPhase, barnScene.doorIsOpen());
  barnScene.update(dt); // door swing animation
  maybeLayEggs(nowMs); // chickens lay physical eggs on the barn floor
  // gentle one-time nudge if the herd is shut out at dusk/night (kindness cap —
  // no penalty; they just wait by the door until someone opens it)
  if ((animalPhase === "dusk" || animalPhase === "night") && !barnScene.doorIsOpen()) {
    if (!barnWaitToastShown && !animalField.allInsideBarn()) {
      hud.toast("The animals are waiting by the barn door 🌙");
      barnWaitToastShown = true;
    }
  } else {
    barnWaitToastShown = false;
  }
  decorField.update(dt); // P5: spin pinwheels, wave flags

  // P7: live Farm Map + Inventory (only while their panels are open)
  if (hud.isMapOpen()) {
    drawFarmMap(mapCtx, hud.mapCanvasSize(), buildMapSnapshot(), nowMs / 1000);
  }
  if (hud.isInventoryOpen()) {
    hud.showInventory(buildInventoryData()); // signature-guarded — cheap when unchanged
  }

  if (placing) updatePlacementGhost();
  skyTimer += dt;
  if (skyTimer >= 2) {
    skyTimer = 0;
    applySky();
  }
  tickWeatherEffects(nowMs, player.root.position.x, player.root.position.z, groundY);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// hide loading + go
const loading = document.getElementById("loading");
if (loading) loading.style.display = "none";
requestAnimationFrame(frame);

void tunePanel;
