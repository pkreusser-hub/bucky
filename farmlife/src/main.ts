// ---------------------------------------------------------------------------
// Farm Life — 2D MODERN PIXEL render core (R1).
//
// The three.js render layer is GONE. This wires the surviving simulation/sync
// (FarmState + stores + Firestore cloud, presence/lobby, growth/action/animal
// pure logic, HUD, map, weather, day/night phase) to a Canvas2D pixel renderer:
//   render2d/renderer  — native-pixel buffer, integer scale, camera + tint
//   render2d/world2d   — static ground map + colliders (pure collision reused)
//   render2d/sprites   — baked prop atlas (mockup-faithful)
//   render2d/farmer2d  — puppet farmer (walk/idle/run/hop)
//   render2d/field2d   — tilled soil / crop placeholders / highlight / juice
//   render2d/animals2d — ported husbandry wander, 2D sprites
//   player2d/input     — keyboard (top-down) · player2d/touch2d — mobile stick
// Gameplay actions (till/plant/water/harvest, animal care, decor) run against
// REAL FarmState — their logic is untouched; only the visuals are 2D. Jump is a
// cosmetic HOP (shadow squash). Removed vs parked vs gated is documented in the
// report.
// ---------------------------------------------------------------------------

import { loadTune } from "./tune";
import { FarmAudio } from "./audio";
import { currentPlayerName } from "./net/firebase";
import { checkMilestones, MILESTONES, type MilestoneFacts } from "./farm/milestones";
import type { MetaState } from "./net/sync";
import { loadWorldDataSync } from "./world/worldStore";
import type { WorldData } from "./world/worldData";
import { installDebug, type PlayerState, type CamState } from "./debug";
import { buildHud, type InventoryData } from "./ui/hud";
import { buildTunePanel2d } from "./ui/tunePanel2d";
import { drawFarmMap, invalidateFarmMapBackground, type FarmMapSnapshot, type MapTileCell } from "./ui/farmMap";
import { now as flNow, setTimeOffset, addTimeOffset } from "./farm/time";
import { LocalFarmStore, defaultFarmState, sanitizeFarmState, type FarmState, type FarmStore, type TileRecord } from "./farm/store";
import { tileKey, parseTileKey, tileCenter, worldToTile, GRID, TILE_SIZE } from "./farm/grid";
import { CROPS, CROP_ORDER, type CropId, plantTile, waterTile, growthStage, needsWater, effectiveCrop, setFastGrow } from "./farm/growth";
import { FarmlifeSession } from "./net/session";
import { Presence } from "./net/presence";
import { FarmLobby } from "./net/lobby";
import { EMOTE_ORDER, EMOTES, type EmoteKind } from "./player/emoteConst";
import { CloudFarmStore, CloudAnimalStore, type LiveFarmStore, type LiveAnimalStore } from "./farm/cloudStore";
import { CloudWorldStore } from "./world/cloudWorldStore";
import { diffTiles } from "./net/sync";
import { isEmptyWorldData } from "./world/worldData";
import { findTargetTile, computeTileState } from "./farm/targeting";
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
import { DECOR, newDecorId, type DecorRecord } from "./world/decorConst";
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
import {
  PASTURE,
  BARN,
  GATE,
  GATE_CENTER,
  DOOR,
  DOOR_CENTER,
  dayPhase,
  eggId,
  nestSpot,
  defaultDoorState,
  type DoorState,
  type EggRecord,
} from "./farm/pasture";
import { skyAt, centralHour } from "./world/daynight";
import { DEFAULT_PATH_PTS } from "./world/terrainConst";
import { WeatherStation, weatherEmoji, RAIN_AUTO_WATER_INTERVAL_MS } from "./world/weather";
// --- 2D render layer ---
import { Renderer2D } from "./render2d/renderer";
import { buildWorld2D, type World2D } from "./render2d/world2d";
import { Sprites, BARN_DOORWAY, FARMER_PX, SCALE } from "./render2d/sprites";
import { Field2D } from "./render2d/field2d";
import { AnimalField2D } from "./render2d/animals2d";
import { Decor2D } from "./render2d/decor2d";
import { Remote2D, drawSpeechBubble } from "./render2d/remote2d";
import { Farmer2D, facingFromHeading, DEFAULT_LOOK, type Facing } from "./render2d/farmer2d";
import { EXTERIOR_DOORS, INTERIORS, resolveInteriorCollision, facingHeading, type Interior, type ExteriorDoor } from "./render2d/scenes";
import { resolveCollision } from "./world/collision";
import { PPM } from "./render2d/coords";
import { Input2D } from "./player2d/input";
import { TouchControls2D, isMobile } from "./player2d/touch2d";
import { FENCE } from "./render2d/palette";

const tune = loadTune();
setFastGrow(tune.fastGrow);

// ---- audio (WebAudio synth SFX + ambient beds; resumed on first gesture) ----
const audio = new FarmAudio();
function armAudioGesture(): void {
  const resume = () => audio.resume();
  window.addEventListener("pointerdown", resume);
  window.addEventListener("keydown", resume);
  window.addEventListener("touchstart", resume);
}
armAudioGesture();

// ---- renderer + world -------------------------------------------------------
const app = document.getElementById("app")!;
const renderer = new Renderer2D(app);
window.addEventListener("resize", () => renderer.resize());

const world2d: World2D = buildWorld2D(); // bakes the static map + registers colliders
// editor WorldData kept for the map + cloud sync only (3D editor deprecated — no
// 2D prop rendering of editor objects this round; empty by default).
const world: WorldData = loadWorldDataSync();

// precomputed fence render items (posts + rails), y-sorted with props
interface FenceRail {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}
const fencePosts: { x: number; z: number }[] = [];
const fenceRails: FenceRail[] = [];
for (const runs of [world2d.fieldFence, world2d.pastureFence]) {
  for (const r of runs) {
    fenceRails.push(r);
    const len = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
    const n = Math.max(1, Math.round(len / 2.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      fencePosts.push({ x: r.x1 + (r.x2 - r.x1) * t, z: r.z1 + (r.z2 - r.z1) * t });
    }
  }
}

// ---- farming field ----------------------------------------------------------
const field = new Field2D();
let farmStore: FarmStore = new LocalFarmStore();
let farmState: FarmState = defaultFarmState();
const hud = buildHud();

function tankCap(): number {
  return Math.max(1, Math.round(tune.tankCapacity));
}
function persistFarm(): void {
  farmStore.save(farmState);
}

function refreshToolHud(): void {
  hud.setTools({
    selectedTool: farmState.selectedTool,
    tank: farmState.tank,
    tankCap: tankCap(),
    cropEmoji: CROPS[farmState.selectedCrop].emoji,
    seedCount: farmState.seeds[farmState.selectedCrop],
  });
}
function equipTool(id: ToolId): void {
  farmState.selectedTool = id;
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
  hud.setCoins(farmState.coins);
  refreshToolHud();
});

// ---- animals + barn ---------------------------------------------------------
const animalField = new AnimalField2D(STARTER_HERD.map((s) => ({ id: s.id, type: s.type })));
let animalStore: AnimalStore = new LocalAnimalStore();
let herd: Record<string, AnimalRecord> = {};
function persistHerd(): void {
  animalStore.save(herd);
}
animalStore.load().then((loaded) => {
  if (loaded) herd = loaded;
});

let barnStore: BarnStore = new LocalBarnStore();
let doorState: DoorState = defaultDoorState();
let eggs: Record<string, EggRecord> = {};
const myPlayerName = currentPlayerName();
let barnWaitToastShown = false;
const doorAnchor = { x: DOOR_CENTER.x, z: DOOR.z };
// animated barn presentation: door swing + roof-fade cutaway when inside
let barnDoorFrac = 0; // 0 = closed, 1 = open
let barnCutaway = 0; // 0 = roof solid, 1 = roof faded (player inside)

function doorIsOpen(): boolean {
  return doorState.open;
}
function persistDoor(): void {
  barnStore.setDoor(doorState);
}
barnStore.load().then((data: BarnData) => {
  doorState = data.door;
  eggs = data.eggs;
});

function toggleBarnDoor(): void {
  doorState = { open: !doorState.open, at: flNow() };
  persistDoor();
  audio.hoe();
  hud.toast(doorState.open ? "🚪 Opened the barn door" : "🚪 Closed the barn door");
}

function maybeLayEggs(nowMs: number): void {
  for (const spec of STARTER_HERD) {
    if (spec.type !== "chicken") continue;
    const a = herd[spec.id];
    if (!a) continue;
    if (!produceReady(a, ANIMAL_DEFS.chicken, nowMs)) continue;
    const id = eggId(spec.id, a.lastFed);
    if (eggs[id]) continue;
    const nest = nestSpot(spec.id);
    const rec: EggRecord = { id, chickenId: spec.id, spawnedAt: nowMs, x: nest.x, z: nest.z };
    eggs[id] = rec;
    barnStore.putEgg(rec);
  }
}

function collectEgg(id: string, wx: number, wz: number): void {
  const e = eggs[id];
  if (!e || e.collectedBy) return;
  const now = flNow();
  const rec: EggRecord = { ...e, collectedBy: myPlayerName, collectedAt: now };
  eggs[id] = rec;
  barnStore.putEgg(rec);
  const a = herd[e.chickenId];
  if (a) {
    herd[e.chickenId] = { ...a, ...collectProduce(a, ANIMAL_DEFS.chicken, now) };
    persistHerd();
  }
  farmState.produce.egg += 1;
  refreshToolHud();
  persistFarm();
  hud.toast("🥚 +1 Egg!");
  field.spawnPop(wx, 0, wz, "🥚");
  audio.harvest();
  animalField.wake(e.chickenId);
  recordMilestoneEvent({ eggEvent: true });
}

// ---- decorations + meta -----------------------------------------------------
const decorField = new Decor2D();
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

function currentFacts(extra: Partial<MilestoneFacts> = {}): MilestoneFacts {
  return { shipped: meta.shipped, decorCount: decorField.count(), earned: meta.milestones, ...extra };
}
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
function applyShipped(deltas: Record<string, number>): void {
  for (const [id, d] of Object.entries(deltas)) meta.shipped[id] = (meta.shipped[id] ?? 0) + d;
  metaStore.addShipped(deltas);
  recordMilestoneEvent({});
}
function celebrateMilestone(key: string): void {
  const def = MILESTONES.find((m) => m.key === key);
  hud.toast(`🏅 Milestone: ${def?.label ?? key} ${def?.emoji ?? ""}`);
  audio.milestone();
  spawnConfetti(playerX, playerZ);
}
function spawnConfetti(x: number, z: number): void {
  const cols = [0xe23b3b, 0xf2c14e, 0x3f7fd0, 0x4f9a3f, 0xe86a8f];
  for (const c of cols) field.spawnBurst(x, 0, z, c, 8, 2.4);
}

// ---- P2 cloud (unchanged sim/sync — only render calls differ) ---------------
let cloudFarm: LiveFarmStore | null = null;
let cloudFarmCtor: LiveFarmStore | null = null;
let cloudWorld: CloudWorldStore | null = null;
let cloudAnimals: LiveAnimalStore | null = null;
let cloudAnimalsCtor: LiveAnimalStore | null = null;
let cloudBarn: LiveBarnStore | null = null;
let cloudBarnCtor: LiveBarnStore | null = null;
let cloudDecor: LiveDecorStore | null = null;
let cloudDecorCtor: LiveDecorStore | null = null;
let cloudMeta: LiveMetaStore | null = null;
let cloudMetaCtor: LiveMetaStore | null = null;

function applyRemoteDecor(remote: Record<string, DecorRecord>): void {
  decor = remote;
  decorField.syncAll(decor);
  recordMilestoneEvent({});
}
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
function applyRemoteHerd(remote: Record<string, AnimalRecord>): void {
  for (const id of Object.keys(remote)) herd[id] = remote[id];
}
function applyRemoteBarn(data: BarnData): void {
  doorState = data.door;
  for (const [id, rec] of Object.entries(data.eggs)) {
    const prev = eggs[id];
    eggs[id] = rec;
    if (rec.collectedBy && rec.collectedBy !== myPlayerName && prev && prev.collectedBy === myPlayerName) {
      farmState.produce.egg = Math.max(0, farmState.produce.egg - 1);
      refreshToolHud();
      persistFarm();
      hud.toast(`${rec.collectedBy} got that one! 🥚`);
    }
  }
}
function applyRemoteFarm(remote: FarmState): void {
  const changed = diffTiles(farmState.tiles, remote.tiles);
  for (const key of changed) {
    const p = parseTileKey(key);
    if (!p) continue;
    farmState.tiles[key] = remote.tiles[key];
    const { x, z } = tileCenter(p.gx, p.gz);
    field.spawnPop(x, 0, z, "✨");
  }
  let playerChanged = false;
  for (const id of CROP_ORDER) if (farmState.seeds[id] !== remote.seeds[id] || farmState.crops[id] !== remote.crops[id]) playerChanged = true;
  for (const id of PRODUCE_ORDER) if (farmState.produce[id] !== remote.produce[id]) playerChanged = true;
  if (
    farmState.coins !== remote.coins ||
    farmState.tank !== remote.tank ||
    farmState.selectedTool !== remote.selectedTool ||
    farmState.selectedCrop !== remote.selectedCrop
  )
    playerChanged = true;
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
  world.terrain = w.terrain;
  world.paint = w.paint;
  world.objects = w.objects;
  world.fences = w.fences;
  invalidateFarmMapBackground(); // 3D world-prop rendering is R2 (editor deprecated)
}

async function initCloud(): Promise<void> {
  try {
    hud.setSyncStatus("connecting");
    const session = new FarmlifeSession((msg) => hud.toast(msg));
    cloudWorld = new CloudWorldStore(session);
    const cloud = new CloudFarmStore(session);
    cloudFarmCtor = cloud;
    const ok = await session.ready;
    if (!ok) {
      hud.setSyncStatus("offline");
      return;
    }
    let localSeed: FarmState | null = null;
    try {
      const raw = localStorage.getItem("fl_farm_v1");
      if (raw) localSeed = sanitizeFarmState(JSON.parse(raw));
    } catch (_) {
      /* corrupt local save */
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
      hud.setCoins(farmState.coins);
      refreshToolHud();
      farmStore = cloud;
      cloudFarm = cloud;
      cloud.subscribe((remote) => applyRemoteFarm(remote));
    }
    const remoteWorld = await cloudWorld.load();
    if (!isEmptyWorldData(remoteWorld)) reconcileWorld(remoteWorld);
    cloudWorld.subscribe((w) => reconcileWorld(w));

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

    const barn = new CloudBarnStore(session);
    cloudBarnCtor = barn;
    const remoteBarn = await barn.load();
    barnStore = barn;
    cloudBarn = barn;
    const cloudEmpty = !remoteBarn.door.at && Object.keys(remoteBarn.eggs).length === 0;
    if (cloudEmpty && (doorState.at || Object.keys(eggs).length)) {
      barn.setDoor(doorState);
      for (const e of Object.values(eggs)) barn.putEgg(e);
      void barn.flush?.();
    } else {
      doorState = remoteBarn.door;
      eggs = remoteBarn.eggs;
    }
    barn.subscribe((d) => applyRemoteBarn(d));

    const cDecor = new CloudDecorStore(session);
    cloudDecorCtor = cDecor;
    decorStore = cDecor;
    cloudDecor = cDecor;
    const remoteDecor = await cDecor.load();
    if (Object.keys(remoteDecor).length === 0 && Object.keys(decor).length > 0) {
      cDecor.save(decor);
      void cDecor.flush?.();
    } else {
      decor = remoteDecor;
      decorField.syncAll(decor);
    }
    cDecor.subscribe((d) => applyRemoteDecor(d));

    const cMeta = new CloudMetaStore(session);
    cloudMetaCtor = cMeta;
    metaStore = cMeta;
    cloudMeta = cMeta;
    const remoteMeta = await cMeta.load();
    if (remoteMeta) {
      mergeMeta(remoteMeta, false);
      const shipDelta: Record<string, number> = {};
      for (const [k, v] of Object.entries(meta.shipped)) {
        const d = v - (remoteMeta.shipped[k] ?? 0);
        if (d > 0) shipDelta[k] = d;
      }
      if (Object.keys(shipDelta).length) cMeta.addShipped(shipDelta);
      for (const [k, ts] of Object.entries(meta.milestones)) if (!remoteMeta.milestones[k]) cMeta.setMilestone(k, ts);
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

// ---- shop / inventory / book / emote wiring ---------------------------------
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
let shopDismissed = false;
hud.onCloseShop(() => {
  hud.hideShop();
  shopDismissed = true;
});
hud.onAction(() => doAction());
hud.onJump(() => requestJump());
hud.onSelectTool((id) => equipTool(id));
hud.onCycleCrop(() => cycleCrop());
hud.onBuyDecor((type) => buyDecor(type));
hud.onOpenBook(() => openFarmBook());
hud.onCloseBook(() => hud.hideFarmBook());
hud.onRotate(() => rotatePlacement());
hud.onCancelPlace(() => cancelPlacement());

// ---- targeting + action -----------------------------------------------------
interface Pending {
  type: "tile" | "sell" | "refill" | "animal" | "removeDecor" | "door" | "egg" | "enter";
  gx?: number;
  gz?: number;
  res?: ActionResolution;
  animalId?: string;
  animalAction?: AnimalInteraction;
  decorId?: string;
  eggId?: string;
  doorId?: string;
  label: string;
  color: string;
  worldX: number;
  worldZ: number;
}
let pending: Pending | null = null;

const ACT_REACH = 2.2;
const STAND_DIST = 1.5;
const AUTOWALK_ARRIVE = 0.22;
const AUTOWALK_TIMEOUT_MS = 6000;
const AUTOWALK_STUCK_MS = 650;
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
  autoWalk = null;
}

function tileRec(gx: number, gz: number): TileRecord | undefined {
  return farmState.tiles[tileKey(gx, gz)];
}

const VERB_COLOR: Record<Verb, string> = { till: "#c9a15f", plant: "#7fbf5a", water: "#5ab0e0", harvest: "#ffd35a" };
const HINT_COLOR = "#e8a13a";
const SELL_COLOR = "#ffd35a";
const REFILL_COLOR = "#5ab0e0";
const ANIMAL_COLOR: Record<AnimalInteraction, string> = { collect: "#e8d38a", pet: "#ff6fa5" };
const DOOR_COLOR = "#c9a15f";
const EGG_COLOR = "#ffe9a8";
const ANIMAL_INTERACT_RADIUS = 2.2;
const ANIMAL_INTERACT_ANGLE = 1.15;
const DOOR_REACH = 3.0;
const EGG_REACH = 2.0;
const DECOR_REACH = 2.4;
const DECOR_ANGLE = 1.15;
const REMOVE_ARM_MS = 2500;
let removeArmed: { id: string; until: number } | null = null;

function animalLabel(a: AnimalRecord, action: AnimalInteraction): string {
  return action === "collect" ? `Milk ${a.name} 🥛` : `Pet ${a.name} 💕`;
}
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
    if (ang > 1.5) continue;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}
function labelWithDroplet(text: string): string {
  if (farmState.selectedTool === "can" && text) return `${text} · 💧${farmState.tank}`;
  return text;
}
function distTo(px: number, pz: number, s: { x: number; z: number }): number {
  return Math.hypot(px - s.x, pz - s.z);
}

function updateTargeting(px: number, pz: number, heading: number): void {
  if (placing) {
    // placement mode owns the on-screen prompt; suppress tile/station targeting
    field.setHighlightTile(null, null, 0);
    pending = null;
    return;
  }
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
    pending = res.label ? { type: "tile", gx, gz, res, label: labelWithDroplet(res.label), color, worldX: x, worldZ: z } : null;
    return;
  }

  // barn door
  {
    const dDoor = Math.hypot(px - doorAnchor.x, pz - doorAnchor.z);
    if (dDoor <= DOOR_REACH) {
      const toDoorZ = doorAnchor.z - pz;
      const facingBarn = Math.cos(heading) * Math.sign(toDoorZ || 1) > -0.3 || dDoor < 1.6;
      if (facingBarn) {
        field.setHighlightTile(null, null, 0);
        pending = {
          type: "door",
          label: doorIsOpen() ? "Close the barn door 🚪" : "Open the barn door 🚪",
          color: DOOR_COLOR,
          worldX: doorAnchor.x,
          worldZ: doorAnchor.z,
        };
        return;
      }
    }
  }

  // enterable building doors (farmhouse; future coop/shed) — walk up + face it
  {
    const d = doorAt(px, pz, heading);
    if (d) {
      field.setHighlightTile(null, null, 0);
      pending = { type: "enter", doorId: d.interiorId, label: `⏎ ${d.label}`, color: DOOR_COLOR, worldX: d.x, worldZ: d.z - 0.6 };
      return;
    }
  }

  if (farmState.selectedTool === "hands") {
    const egg = nearestEgg(px, pz, heading);
    if (egg) {
      field.setHighlightTile(null, null, 0);
      pending = { type: "egg", eggId: egg.id, label: "Collect egg 🥚", color: EGG_COLOR, worldX: egg.x, worldZ: egg.z };
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
          worldZ: actor.z,
        };
        return;
      }
    }
    const nearStore = distTo(px, pz, world2d.stand) <= world2d.stand.radius || distTo(px, pz, world2d.bin) <= world2d.bin.radius;
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
          worldZ: dec.z,
        };
        return;
      }
    }
  }

  // seed-stand shop by proximity
  if (distTo(px, pz, world2d.stand) <= world2d.stand.radius) {
    if (!hud.isShopOpen() && !shopDismissed) hud.showShop(farmState.coins, farmState.seeds);
  } else {
    shopDismissed = false;
    if (hud.isShopOpen()) hud.hideShop();
  }

  // watering-can refill at the pond edge
  if (farmState.selectedTool === "can") {
    const dPond = Math.hypot(px - world2d.pond.cx, pz - world2d.pond.cz);
    if (dPond <= world2d.pond.r + 3.0) {
      field.setHighlightTile(null, null, 0);
      pending = farmState.tank < tankCap()
        ? { type: "refill", label: `Refill 🚿 (💧${farmState.tank}/${tankCap()})`, color: REFILL_COLOR, worldX: px, worldZ: pz }
        : null;
      return;
    }
  }

  // shipping bin (sell)
  const heldCrops = CROP_ORDER.reduce((s, id) => s + farmState.crops[id], 0) + PRODUCE_ORDER.reduce((s, id) => s + farmState.produce[id], 0);
  if (distTo(px, pz, world2d.bin) <= world2d.bin.radius) {
    field.setHighlightTile(null, null, 0);
    pending = heldCrops > 0 ? { type: "sell", label: `Sell all (${heldCrops}) 🪙`, color: SELL_COLOR, worldX: world2d.bin.x, worldZ: world2d.bin.z } : null;
    return;
  }

  // field tile targeting
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
  pending = res.label ? { type: "tile", gx: target.gx, gz: target.gz, res, label: labelWithDroplet(res.label), color, worldX: x, worldZ: z } : null;
}

let lastHintAt = 0;
let hintFireCount = 0;
function fireHint(label: string): void {
  const t = performance.now();
  if (t - lastHintAt < 1500) return;
  lastHintAt = t;
  hintFireCount++;
  hud.toast(label);
}

let busyUntil = 0;
function isBusy(): boolean {
  return performance.now() < busyUntil;
}
function beBusy(ms = 320): void {
  busyUntil = performance.now() + ms;
}

function doAction(): void {
  // inside a building: the action button leaves via the exit mat
  if (currentInterior) {
    const it = currentInterior;
    if (!fade.active && Math.hypot(playerX - it.exit.x, playerZ - it.exit.z) < it.exit.r) exitInterior();
    return;
  }
  if (placing) {
    confirmPlacement();
    return;
  }
  if (isBusy()) return;
  if (!pending) return;
  if (pending.type === "enter") {
    const d = EXTERIOR_DOORS.find((e) => e.interiorId === pending!.doorId);
    if (d) enterInterior(d);
    return;
  }
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
    audio.refill();
    farmer.playAction("refill");
    presence.emitAnim("refill", localPose());
    field.spawnBurst(pending.worldX, 0, pending.worldZ, 0x5ab0e0, 10, 1);
    hud.toast("🚿 Can refilled!");
    refreshToolHud();
    persistFarm();
    beBusy();
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
    field.spawnPop(world2d.bin.x, 0, world2d.bin.z, "🪙");
    spawnCoinArc(world2d.bin.x, world2d.bin.z);
    persistFarm();
    applyShipped(shippedDeltas);
    return;
  }
  if (pending.type === "animal") {
    doAnimalAction(pending.animalId!, pending.animalAction!, pending.worldX, pending.worldZ);
    return;
  }
  if (pending.type === "door") {
    toggleBarnDoor();
    beBusy();
    return;
  }
  if (pending.type === "egg") {
    collectEgg(pending.eggId!, pending.worldX, pending.worldZ);
    beBusy();
    return;
  }
  const res = pending.res!;
  if (res.hint) {
    fireHint(res.label);
    return;
  }
  if (!res.verb || pending.gx == null || pending.gz == null) return;
  executeVerb(res.verb, pending.gx, pending.gz, res.cropId);
}

function doAnimalAction(id: string, action: AnimalInteraction, wx: number, wz: number): void {
  const a = herd[id];
  if (!a) return;
  const def = ANIMAL_DEFS[a.type];
  const now = flNow();
  animalField.wake(id);
  if (action === "collect") {
    herd[id] = { ...a, ...collectProduce(a, def, now) };
    farmState.produce.milk += 1;
    hud.toast(`🥛 +1 Milk from ${a.name}!`);
    field.spawnPop(wx, 0, wz, "🥛");
    field.spawnBurst(wx, 0, wz, 0xf3f0e6, 8, 0.9);
    refreshToolHud();
    persistFarm();
    audio.harvest();
    audio.bleat();
    recordMilestoneEvent({ milkEvent: true });
  } else {
    herd[id] = { ...a, lastPet: now };
    hud.toast(`${def.emoji} ${a.name} loves that! 💕`);
    field.spawnBurst(wx, 0, wz, 0xff6fa5, 10, 0.9);
    a.type === "goat" ? audio.bleat() : audio.cluck();
    audio.heartPing();
  }
  presence.emitAnim("pet", localPose());
  persistHerd();
  beBusy();
}

let lastHarvestCrop: CropId | null = null; // test hook
function executeVerb(verb: Verb, gx: number, gz: number, cropId?: CropId): void {
  const now = flNow();
  const key = tileKey(gx, gz);
  const { x, z } = tileCenter(gx, gz);
  beBusy();
  if (verb === "till") {
    farmState.tiles[key] = {};
    audio.hoe();
    farmer.playAction("hoe");
    presence.emitAnim("hoe", localPose());
    field.spawnBurst(x, 0, z, 0x6b4a2c, 12, 1);
  } else if (verb === "plant" && cropId) {
    if (farmState.seeds[cropId] <= 0) return;
    farmState.seeds[cropId] -= 1;
    farmState.tiles[key] = { crop: cropId, ...plantTile(now) };
    audio.plant();
    farmer.playAction("plant");
    presence.emitAnim("plant", localPose());
    field.spawnBurst(x, 0, z, 0x6b8f3a, 8, 0.7);
    refreshToolHud();
  } else if (verb === "water") {
    const rec = tileRec(gx, gz);
    if (!rec || !rec.crop) return;
    const crop = effectiveCrop(CROPS[rec.crop]);
    const gt = waterTile({ plantedAt: rec.plantedAt ?? 0, accruedMs: rec.accruedMs ?? 0, lastWatered: rec.lastWatered ?? rec.plantedAt ?? 0 }, crop, now);
    farmState.tiles[key] = { crop: rec.crop, ...gt };
    farmState.tank = tankConsume(farmState.tank);
    audio.water();
    farmer.playAction("water");
    presence.emitAnim("water", localPose());
    field.spawnBurst(x, 0, z, 0x5ab0e0, 10, 0.5);
    field.spawnPop(x, 0, z, "💧");
    refreshToolHud();
  } else if (verb === "harvest") {
    const rec = tileRec(gx, gz);
    if (!rec || !rec.crop) return;
    const crop = CROPS[rec.crop];
    farmState.crops[rec.crop] += 1;
    lastHarvestCrop = rec.crop;
    farmer.playAction("harvest", Sprites.crop(rec.crop, 3)); // hold-up beat with the crop
    beBusy(660); // let the signature hold-up play out
    farmState.tiles[key] = {};
    audio.harvest();
    presence.emitAnim("harvest", localPose());
    hud.toast(`${crop.emoji} +1 ${crop.name} harvested!`);
    field.spawnPop(x, 0, z, crop.emoji);
    refreshToolHud();
    recordMilestoneEvent({ harvestedEvent: true });
  }
  persistFarm();
}

function actOnTile(gx: number, gz: number): void {
  if (isBusy()) return;
  const rec = tileRec(gx, gz);
  const state = computeTileState(rec, flNow());
  const res = resolveAction(state, farmState.selectedTool, "tool", {
    selectedCrop: farmState.selectedCrop,
    seedCount: farmState.seeds[farmState.selectedCrop],
    tank: farmState.tank,
    tileCrop: rec?.crop,
  });
  const c = tileCenter(gx, gz);
  heading = Math.atan2(c.x - playerX, c.z - playerZ);
  facing = facingFromHeading(heading, true, facing);
  if (res.hint) {
    fireHint(res.label);
    return;
  }
  if (!res.verb) return;
  executeVerb(res.verb, gx, gz, res.cropId);
}
function requestTileAction(gx: number, gz: number): void {
  cancelAutoWalk();
  if (gx < 0 || gx >= GRID || gz < 0 || gz >= GRID) return;
  const c = tileCenter(gx, gz);
  const dist = Math.hypot(c.x - playerX, c.z - playerZ);
  if (dist <= ACT_REACH) {
    actOnTile(gx, gz);
    return;
  }
  const dx = playerX - c.x;
  const dz = playerZ - c.z;
  const d = Math.hypot(dx, dz) || 1;
  let sx = c.x + (dx / d) * STAND_DIST;
  let sz = c.z + (dz / d) * STAND_DIST;
  const rc = resolveCollision(sx, sz);
  sx = rc.x;
  sz = rc.z;
  const now = performance.now();
  autoWalk = { gx, gz, standX: sx, standZ: sz, startedAt: now, lastProgressAt: now, lastDist: Infinity };
}
function stepAutoWalk(dt: number): number {
  if (!autoWalk) return 0;
  const now = performance.now();
  if (now - autoWalk.startedAt > AUTOWALK_TIMEOUT_MS) {
    cancelAutoWalk();
    return 0;
  }
  const dToStand = Math.hypot(autoWalk.standX - playerX, autoWalk.standZ - playerZ);
  const c = tileCenter(autoWalk.gx, autoWalk.gz);
  const dToTile = Math.hypot(c.x - playerX, c.z - playerZ);
  if (dToStand <= AUTOWALK_ARRIVE || dToTile <= ACT_REACH - 0.1) {
    const { gx, gz } = autoWalk;
    autoWalk = null;
    actOnTile(gx, gz);
    return 0;
  }
  if (dToStand < autoWalk.lastDist - 0.02) {
    autoWalk.lastDist = dToStand;
    autoWalk.lastProgressAt = now;
  } else if (now - autoWalk.lastProgressAt > AUTOWALK_STUCK_MS) {
    cancelAutoWalk();
    return 0;
  }
  const dirx = (autoWalk.standX - playerX) / (dToStand || 1);
  const dirz = (autoWalk.standZ - playerZ) / (dToStand || 1);
  const spd = tune.moveSpeed * tune.runMult;
  const step = Math.min(spd * dt, dToStand);
  const before = { x: playerX, z: playerZ };
  const rc = resolveCollision(playerX + dirx * step, playerZ + dirz * step);
  playerX = rc.x;
  playerZ = rc.z;
  const moved = Math.hypot(rc.x - before.x, rc.z - before.z);
  heading = Math.atan2(dirx, dirz);
  facing = facingFromHeading(heading, true, facing);
  return dt > 0 ? moved / dt : 0;
}

// ---- decoration placement (R1: simple place-in-front; R2 gets the ghost) ----
function isPlaceable(type: string, x: number, z: number): boolean {
  const EDGE = 60 - 1.5;
  if (Math.abs(x) > EDGE - 1 || Math.abs(z) > EDGE - 1) return false;
  const r = DECOR[type]?.cr ?? 0.3;
  const FIELD = { cx: -6, cz: 6, half: 12 };
  if (Math.abs(x - FIELD.cx) <= FIELD.half + 0.6 && Math.abs(z - FIELD.cz) <= FIELD.half + 0.6) return false;
  if (Math.hypot(x - world2d.pond.cx, z - world2d.pond.cz) <= world2d.pond.r + 0.8) return false;
  if (decorField.overlaps(x, z, r)) return false;
  return true;
}
// ---- placement mode (R2): buy → ghost follows the spot in front of the player →
// tap/action confirms · rotate button · Esc/✖ cancel + refund ------------------
interface Placing {
  type: string;
  rotY: number;
}
let placing: Placing | null = null;

function placementPos(): { x: number; z: number } {
  return { x: playerX + Math.sin(heading) * 2.0, z: playerZ + Math.cos(heading) * 2.0 };
}
function buyDecor(type: string): void {
  const d = DECOR[type];
  if (!d || farmState.coins < d.cost) return;
  if (placing) cancelPlacement(); // one at a time
  // take the cost now; a cancel refunds it
  farmState.coins -= d.cost;
  hud.setCoins(farmState.coins);
  persistFarm();
  hud.hideShop();
  audio.buy();
  placing = { type, rotY: 0 };
  updatePlacement();
}
function updatePlacement(): void {
  if (!placing) return;
  const p = placementPos();
  const ok = isPlaceable(placing.type, p.x, p.z);
  hud.showPlacement(`Placing ${DECOR[placing.type]?.label ?? "decoration"} — tap to place`, ok);
}
function confirmPlacement(): void {
  if (!placing) return;
  const p = placementPos();
  if (!isPlaceable(placing.type, p.x, p.z)) {
    fireHint("Can't place there — find open grass! 🌱");
    return;
  }
  const rec: DecorRecord = { id: newDecorId(), type: placing.type, x: p.x, z: p.z, rotY: placing.rotY, placedBy: currentPlayerName(), placedAt: flNow() };
  decor[rec.id] = rec;
  decorField.add(rec);
  persistDecor();
  field.spawnBurst(p.x, 0, p.z, 0xffd35a, 12, 1.2);
  hud.toast(`🎀 Placed a ${DECOR[placing.type]?.label ?? "decoration"}!`);
  audio.buy();
  recordMilestoneEvent({ decorEvent: true });
  placing = null;
  hud.hidePlacement();
}
function cancelPlacement(): void {
  if (!placing) return;
  const d = DECOR[placing.type];
  if (d) {
    farmState.coins += d.cost; // refund
    hud.setCoins(farmState.coins);
    persistFarm();
  }
  placing = null;
  hud.hidePlacement();
  hud.toast("Placement cancelled — refunded 🪙");
}
function rotatePlacement(): void {
  if (placing) placing.rotY += Math.PI / 2;
}
function removeDecorAt(id: string): void {
  const rec = decor[id];
  if (!rec) return;
  delete decor[id];
  decorField.remove(id);
  persistDecor();
  hud.toast(`🗑 Removed the ${DECOR[rec.type]?.label ?? "decoration"}`);
}

function openFarmBook(): void {
  const shipped = [
    ...CROP_ORDER.map((id) => ({ emoji: CROPS[id].emoji, name: CROPS[id].name, count: meta.shipped[id] ?? 0 })),
    ...PRODUCE_ORDER.map((id) => {
      const info = produceInfo(id);
      return { emoji: info.emoji, name: info.name, count: meta.shipped[id] ?? 0 };
    }),
  ];
  const milestones = MILESTONES.map((m) => ({ key: m.key, label: m.label, emoji: m.emoji, desc: m.desc, earnedAt: meta.milestones[m.key] ?? 0 }));
  hud.showFarmBook({ farmName: meta.farmName, foundedAt: meta.foundedAt, shipped, milestones });
}

// ---- Farm Map + Inventory ---------------------------------------------------
const LOCAL_SHIRT = "#4c80c4";
const mapCtx = hud.mapCanvas.getContext("2d")!;
hud.setMapLegend([
  { emoji: "🔺", label: "You" },
  { emoji: "🟡", label: "Ready to harvest!" },
  { emoji: "🟩", label: "Growing" },
  { emoji: "🏪", label: "Seed stand" },
  { emoji: "📦", label: "Shipping bin" },
  { emoji: "🏠", label: "Farmhouse" },
  { emoji: "🚪", label: "Enter (⏎)" },
  { emoji: "🐐🐔", label: "Animals" },
  { emoji: "🔵", label: "Family" },
]);
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
  const players: FarmMapSnapshot["players"] = [{ x: playerX, z: playerZ, heading, color: LOCAL_SHIRT, self: true }];
  for (const id of presence.remoteIds()) {
    const pos = remotePlayers.pos(id);
    if (!pos) continue;
    const name = presence.remoteName(id);
    players.push({ x: pos.x, z: pos.z, heading: 0, color: shirtTint(name), self: false, name });
  }
  return {
    half: 60,
    edge: 60 - 1.5,
    field: { cx: -6, cz: 6, half: 12 },
    pond: { cx: world2d.pond.cx, cz: world2d.pond.cz, r: world2d.pond.r },
    fences: world.fences.map((f) => ({ pts: f.points.map((p) => ({ x: p.x, z: p.z })) })),
    objects: world.objects.map((o) => ({ x: o.x, z: o.z, emoji: "🌳" })),
    decor: Object.values(decor).map((d) => ({ x: d.x, z: d.z, emoji: DECOR[d.type]?.emoji ?? "🎀" })),
    stations: [
      { x: world2d.stand.x, z: world2d.stand.z, emoji: "🏪" },
      { x: world2d.bin.x, z: world2d.bin.z, emoji: "📦" },
      { x: world2d.house.x, z: world2d.house.z, emoji: "🏠" },
    ],
    doors: EXTERIOR_DOORS.map((d) => ({ x: d.mapX, z: d.mapZ, emoji: "🚪" })),
    tiles,
    animals,
    players,
    pasture: { minX: PASTURE.minX, maxX: PASTURE.maxX, minZ: PASTURE.minZ, maxZ: PASTURE.maxZ },
    gate: { x: GATE_CENTER.x, z0: GATE_CENTER.z - 1.6, z1: GATE_CENTER.z + 1.6 },
    barn: { minX: BARN.minX, maxX: BARN.maxX, minZ: BARN.minZ, maxZ: BARN.maxZ },
    doorOpen: doorIsOpen(),
    eggCount: Object.values(eggs).filter((e) => !e.collectedBy).length,
  };
}

function buildInventoryData(): InventoryData {
  return {
    seeds: CROP_ORDER.map((id) => ({ id, emoji: CROPS[id].emoji, name: CROPS[id].name, count: farmState.seeds[id], seedCost: CROPS[id].seedCost, selected: id === farmState.selectedCrop })).filter((s) => s.count > 0 || s.selected),
    produce: [
      ...CROP_ORDER.map((id) => ({ emoji: CROPS[id].emoji, name: CROPS[id].name, count: farmState.crops[id], sellPrice: CROPS[id].sellPrice })),
      ...PRODUCE_ORDER.map((id) => {
        const info = produceInfo(id);
        return { emoji: info.emoji, name: info.name, count: farmState.produce[id], sellPrice: info.sellPrice };
      }),
    ].filter((p) => p.count > 0),
    produceTotalValue:
      CROP_ORDER.reduce((s, id) => s + farmState.crops[id] * CROPS[id].sellPrice, 0) +
      PRODUCE_ORDER.reduce((s, id) => s + farmState.produce[id] * produceInfo(id).sellPrice, 0),
    tools: TOOL_ORDER.map((id) => ({ id, glyph: TOOL_META[id].icon ?? TOOL_META[id].emoji, isIcon: !!TOOL_META[id].icon, name: TOOL_META[id].name, selected: id === farmState.selectedTool })),
    tank: farmState.tank,
    tankCap: tankCap(),
  };
}
hud.onOpenInventory(() => hud.showInventory(buildInventoryData()));
hud.onCloseInventory(() => {});
hud.onSelectInventorySeed((id) => {
  farmState.selectedCrop = id;
  equipTool("seeds");
  hud.hideInventory();
  hud.toast(`${CROPS[id].emoji} ${CROPS[id].name} seeds ready to plant!`);
});
hud.onEquipInventoryTool((id) => {
  equipTool(id);
  hud.hideInventory();
});

// ---- player state (2D) ------------------------------------------------------
let playerX = 16;
let playerZ = 34;
let heading = 0;
let facing: Facing = "up";
const farmer = new Farmer2D();
renderer.snapCamera(playerX, playerZ);

// hop (cosmetic jump)
let hopY = 0;
let hopVel = 0;
let airborne = false;
let landCount = 0;
function requestJump(): void {
  if (!airborne && !isBusy()) {
    cancelAutoWalk();
    hopVel = tune.jumpVel;
    airborne = true;
    audio.jump();
  }
}

// ---- scenes: exterior ⇄ interior (R4) ---------------------------------------
// currentInterior = null → the exterior world (default). Entering a building
// fades to black, swaps to its interior room (own colliders + camera clamp), and
// spawns the player at the interior's spawn; exiting returns to the saved door
// spot facing away. Presence keeps publishing the DOOR's world coords while
// inside, so remote family see you standing at the door (no wire change).
let currentInterior: Interior | null = null;
let sceneReturn: { x: number; z: number; heading: number; facing: Facing } | null = null;
let interiorPrompt: string | null = null;
const fade = { active: false, phase: "out" as "out" | "in", t: 0, onMid: null as null | (() => void) };
const FADE_HALF = 0.14; // seconds per half → ~280 ms black dip

function startFade(onMid: () => void): void {
  if (fade.active) return;
  fade.active = true;
  fade.phase = "out";
  fade.t = 0;
  fade.onMid = onMid;
}
function updateFade(dt: number): void {
  if (!fade.active) return;
  fade.t += dt;
  if (fade.phase === "out" && fade.t >= FADE_HALF) {
    const m = fade.onMid;
    fade.onMid = null;
    fade.phase = "in";
    fade.t = 0;
    m?.();
  } else if (fade.phase === "in" && fade.t >= FADE_HALF) {
    fade.active = false;
  }
}
function fadeAlpha(): number {
  if (!fade.active) return 0;
  const f = Math.min(1, fade.t / FADE_HALF);
  return fade.phase === "out" ? f : 1 - f;
}
function drawFade(): void {
  const a = fadeAlpha();
  if (a <= 0.001) return;
  renderer.ctx.save();
  renderer.ctx.globalAlpha = a;
  renderer.ctx.fillStyle = "#000";
  renderer.ctx.fillRect(0, 0, renderer.nativeW, renderer.nativeH);
  renderer.ctx.restore();
}

function enterInterior(door: ExteriorDoor): void {
  if (fade.active || currentInterior) return;
  const it = INTERIORS[door.interiorId];
  if (!it) return;
  cancelAutoWalk();
  if (placing) cancelPlacement();
  startFade(() => {
    sceneReturn = { x: door.x, z: door.z, heading: facingHeading(door.exitFacing), facing: door.exitFacing };
    currentInterior = it;
    playerX = it.spawn.x;
    playerZ = it.spawn.z;
    heading = facingHeading(it.spawn.facing);
    facing = it.spawn.facing;
    curSpeed = 0;
    pending = null;
    field.setHighlightTile(null, null, 0);
    hud.hideShop();
    hud.showActionLabel(null, 0, 0, "#fff");
    renderer.setCamClamp(it.view);
    renderer.snapCamera(playerX, playerZ);
    audio.hoe(); // door thunk
    hud.toast(`🏠 Inside the ${it.name.toLowerCase()}`);
  });
}
function exitInterior(): void {
  if (fade.active || !currentInterior || !sceneReturn) return;
  const ret = sceneReturn;
  startFade(() => {
    currentInterior = null;
    interiorPrompt = null;
    renderer.setCamClamp(null);
    playerX = ret.x;
    playerZ = ret.z;
    heading = ret.heading;
    facing = ret.facing;
    curSpeed = 0;
    sceneReturn = null;
    renderer.snapCamera(playerX, playerZ);
    audio.hoe();
  });
}
/** Nearest enterable door the player is standing at + facing (exterior only). */
function doorAt(px: number, pz: number, hd: number): ExteriorDoor | null {
  for (const d of EXTERIOR_DOORS) {
    if (Math.hypot(px - d.x, pz - d.z) > d.reach) continue;
    // face roughly toward the building (or be right on the mat)
    const want = facingHeading(d.faceTo);
    const aligned = Math.cos(hd - want) > -0.2 || Math.hypot(px - d.x, pz - d.z) < 1.3;
    if (aligned) return d;
  }
  return null;
}

// ---- input ------------------------------------------------------------------
const controls = new Input2D();
let touch: TouchControls2D | null = null;
if (isMobile()) {
  touch = new TouchControls2D();
  // left-zone TAP (not a drag) acts on the tile under the finger — the same
  // walk-then-act path as a right-side canvas tap (touch2d documents the
  // tap/drag threshold).
  touch.onTap = (cx, cy) => worldTapAt(cx, cy);
}

// click / tap / right-click on the WORLD = act: placement→confirm, a field tile→
// walk-then-act, else the current proximity target (bin/animal/door…). Shared by
// the canvas pointer handler (desktop + right-45% mobile) and touch2d's onTap.
function worldTapAt(clientX: number, clientY: number): void {
  if (placing) {
    confirmPlacement();
    return;
  }
  cancelAutoWalk();
  const w = renderer.clientToWorld(clientX, clientY);
  const t = worldToTile(w.x, w.z);
  if (t) requestTileAction(t.gx, t.gz);
  else doAction();
}

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === " " && !e.repeat) {
    e.preventDefault();
    requestJump();
  } else if ((k === "e" || k === "enter") && !e.repeat) {
    e.preventDefault();
    doAction();
  } else if (k === "escape" && placing) {
    e.preventDefault();
    cancelPlacement();
  } else if (k === "r" && placing && !e.repeat) {
    e.preventDefault();
    rotatePlacement();
  }
});

// canvas pointer = act (desktop click/right-click + the mobile right-45% where
// the joystick zone doesn't cover). Left-zone mobile taps arrive via touch.onTap.
renderer.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
renderer.canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.button !== 2) return;
  worldTapAt(e.clientX, e.clientY);
});

// ---- presence (Playroom) — 2D remote farmers --------------------------------
const remotePlayers = new Remote2D();
const presence = new Presence((msg) => hud.toast(msg));
let localEmote: { kind: EmoteKind; until: number } | null = null;
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
  remotePlayers.playAnim(id, kind); // replay the tool-use tween on the remote puppet
  const rp = remotePlayers.pos(id);
  if (rp) {
    const d = Math.hypot(rp.x - playerX, rp.z - playerZ);
    audio.remoteAction(kind, Math.max(0, 1 - d / 26));
  }
});
presence.onRemoteEmote((id, kind) => remotePlayers.showEmote(id, kind));
void presence.ready.then((ok) => {
  if (ok) hud.setPresence(presence.presentCount());
});
const lobby = new FarmLobby(presence);
void lobby;

function localPose() {
  return { x: playerX, y: hopY, z: playerZ, heading, tool: farmState.selectedTool };
}
function doEmote(kind: EmoteKind): void {
  localEmote = { kind, until: performance.now() + 2000 };
  presence.emitEmote(kind, localPose());
}
hud.onEmote(doEmote);
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  const map: Record<string, EmoteKind> = { z: EMOTE_ORDER[0], x: EMOTE_ORDER[1], c: EMOTE_ORDER[2] };
  if (map[k]) {
    e.preventDefault();
    doEmote(map[k]);
  } else if (k === "m") {
    audio.resume();
    const muted = audio.toggleMute();
    tunePanel.syncAudio();
    hud.toast(muted ? "🔇 Muted" : "🔊 Sound on");
  }
});

// ---- tune panel (2D-pruned) -------------------------------------------------
function applyFastGrow(on: boolean): void {
  setFastGrow(on);
  tune.fastGrow = on;
}
const tunePanel = buildTunePanel2d(tune, audio, (on) => applyFastGrow(on));

// ---- day/night + weather ----------------------------------------------------
let curSunElev = 45;
let weatherRef: WeatherStation | null = null;
function applySky(): void {
  const s = skyAt(flNow());
  curSunElev = s.sunElevDeg;
  const dayFactor = Math.max(0, Math.min(1, (s.sunElevDeg + 6) / 12));
  audio.setAmbient(dayFactor, weatherRef?.current?.cond === "rain");
}
applySky();

let wasRaining = false;
let nextRainAutoWaterAt = Infinity;
const weather = new WeatherStation((snap) => {
  const label = snap.tempF != null ? `${weatherEmoji(snap.cond)} ${Math.round(snap.tempF)}°F` : weatherEmoji(snap.cond);
  hud.setWeather(label);
  if (snap.cond === "rain" && !wasRaining) hud.toast("🌧 It's raining at the farm — crops are getting watered!");
  wasRaining = snap.cond === "rain";
  audio.setAmbient(Math.max(0, Math.min(1, (skyAt(flNow()).sunElevDeg + 6) / 12)), snap.cond === "rain");
});
weatherRef = weather;
function autoWaterFromRain(nowMs: number): number {
  let count = 0;
  for (const key of Object.keys(farmState.tiles)) {
    const rec = farmState.tiles[key];
    if (!rec.crop) continue;
    const crop = effectiveCrop(CROPS[rec.crop]);
    const gt = { plantedAt: rec.plantedAt ?? 0, accruedMs: rec.accruedMs ?? 0, lastWatered: rec.lastWatered ?? rec.plantedAt ?? 0 };
    if (!needsWater(gt, crop, nowMs)) continue;
    farmState.tiles[key] = { crop: rec.crop, ...waterTile(gt, crop, nowMs) };
    count++;
  }
  if (count > 0) persistFarm();
  return count;
}
function tickWeather(nowMs: number): void {
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
}

// ---- debug hooks ------------------------------------------------------------
const playerState: PlayerState = { x: playerX, z: playerZ, y: 0, heading: 0, speed: 0, airborne: false };
installDebug({
  player: playerState,
  getCam: (): CamState => ({ x: renderer.camX, z: renderer.camZ, scale: renderer.scale }),
  setInput: (p) => controls.setInput(p),
  tune,
});
const flHook = (window as unknown as { __FL__: Record<string, unknown> }).__FL__;

flHook._snap = () => {
  const w = renderer.canvas.width;
  const h = renderer.canvas.height;
  const data = renderer.ctx.getImageData(0, 0, w, h).data;
  const seen = new Set<number>();
  let sum = 0, sum2 = 0, n = 0;
  for (let i = 0; i < data.length; i += 4 * 37) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    seen.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    sum += l;
    sum2 += l * l;
    n++;
  }
  const mean = sum / n;
  return { w, h, distinct: seen.size, mean, stdev: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
};
flHook._pixel = (cx: number, cz: number) => {
  const sx = renderer.sx(cx);
  const sy = renderer.sy(cz);
  if (sx < 0 || sy < 0 || sx >= renderer.canvas.width || sy >= renderer.canvas.height) return null;
  const d = renderer.ctx.getImageData(sx, sy, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2] };
};
flHook._pixelOff = (cx: number, cz: number, dx: number, dy: number) => {
  const sx = renderer.sx(cx) + dx;
  const sy = renderer.sy(cz) + dy;
  if (sx < 0 || sy < 0 || sx >= renderer.canvas.width || sy >= renderer.canvas.height) return null;
  const d = renderer.ctx.getImageData(sx, sy, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2] };
};
// R4: sample a square of native pixels around a world point (one call) — used by
// the verify to scan for dithered transition bands + the interior fire glow.
flHook._region = (cx: number, cz: number, halfPx: number, stride = 2) => {
  const sx = renderer.sx(cx);
  const sy = renderer.sy(cz);
  const x0 = Math.max(0, sx - halfPx);
  const y0 = Math.max(0, sy - halfPx);
  const x1 = Math.min(renderer.canvas.width, sx + halfPx);
  const y1 = Math.min(renderer.canvas.height, sy + halfPx);
  if (x1 <= x0 || y1 <= y0) return [] as number[][];
  const d = renderer.ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  const out: number[][] = [];
  for (let i = 0; i < d.length; i += 4 * stride) out.push([d[i], d[i + 1], d[i + 2]]);
  return out;
};
flHook._cssScale = () => {
  const cssW = parseFloat(renderer.canvas.style.width);
  return { scale: renderer.scale, backingW: renderer.canvas.width, cssW, ratio: cssW / renderer.canvas.width, pixelated: renderer.canvas.style.imageRendering };
};

flHook.avatar = {
  jump: () => requestJump(),
  isBusy: () => isBusy(),
  hopY: () => hopY,
  airborne: () => airborne,
  landCount: () => landCount,
  facing: () => facing,
  acting: () => farmer.isActing(),
  barnCutaway: () => barnCutaway,
  barnDoorFrac: () => barnDoorFrac,
};
flHook.farm = {
  gridSize: GRID,
  state: () => JSON.parse(JSON.stringify(farmState)) as FarmState,
  target: () => {
    if (!pending) return null;
    if (pending.type === "sell") return { kind: "sell", label: pending.label };
    if (pending.type === "refill") return { kind: "refill", label: pending.label };
    if (pending.type === "animal") return { kind: "animal", label: pending.label };
    if (pending.type === "removeDecor") return { kind: "removeDecor", label: pending.label };
    if (pending.type === "door") return { kind: "door", label: pending.label };
    if (pending.type === "egg") return { kind: "egg", label: pending.label };
    if (pending.type === "enter") return { kind: "enter", label: pending.label, doorId: pending.doorId };
    const res = pending.res!;
    return { kind: res.verb ?? (res.hint ? "hint" : "growing"), verb: res.verb, hint: res.hint, gx: pending.gx, gz: pending.gz, cropId: res.cropId, label: res.label };
  },
  tileAt: (gx: number, gz: number) => {
    const rec = farmState.tiles[tileKey(gx, gz)];
    if (!rec) return { present: false };
    if (!rec.crop) return { present: true, tilled: true, crop: null };
    const gt = { plantedAt: rec.plantedAt ?? 0, accruedMs: rec.accruedMs ?? 0, lastWatered: rec.lastWatered ?? 0 };
    return { present: true, tilled: true, crop: rec.crop, stage: growthStage(gt, effectiveCrop(CROPS[rec.crop]), flNow()), lastWatered: gt.lastWatered };
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
  addCrop: (id: CropId, n: number) => {
    farmState.crops[id] = (farmState.crops[id] ?? 0) + n;
    refreshToolHud();
    persistFarm();
  },
  setCoins: (n: number) => {
    farmState.coins = n;
    hud.setCoins(n);
    persistFarm();
  },
  lastHarvest: () => lastHarvestCrop,
  coinArcCount: () => coinArcs.length,
  plantStage: (gx: number, gz: number, crop: CropId, stage: 0 | 1 | 2 | 3) => {
    const now = flNow();
    const c = CROPS[crop];
    const frac = stage === 0 ? 0.15 : stage === 1 ? 0.5 : stage === 2 ? 0.85 : 1.1;
    farmState.tiles[tileKey(gx, gz)] = { crop, plantedAt: now, accruedMs: c.growMs * frac, lastWatered: now };
  },
  // fresh plant (accruedMs 0, moist as of now) — for fastGrow/thirsty timing tests
  plantFresh: (gx: number, gz: number, crop: CropId) => {
    farmState.tiles[tileKey(gx, gz)] = { crop, ...plantTile(flNow()) };
  },
  teleport: (x: number, z: number) => {
    playerX = x;
    playerZ = z;
    renderer.snapCamera(x, z);
  },
  setHeading: (h: number) => {
    heading = h;
    facing = facingFromHeading(h, true, facing);
  },
  isShopOpen: () => hud.isShopOpen(),
  closeShop: () => hud.hideShop(),
  binPos: { x: world2d.bin.x, z: world2d.bin.z },
  standPos: { x: world2d.stand.x, z: world2d.stand.z },
  pondPos: { x: world2d.pond.cx, z: world2d.pond.cz, r: world2d.pond.r },
  _setTimeOffset: (ms: number) => setTimeOffset(ms),
  _addTimeOffset: (ms: number) => addTimeOffset(ms),
  flushSave: () => farmStore.flush?.(),
  fastGrow: () => tune.fastGrow,
  setFastGrow: (on: boolean) => applyFastGrow(on),
  rightClickTile: (gx: number, gz: number) => requestTileAction(gx, gz),
  autoWalk: () => (autoWalk ? { gx: autoWalk.gx, gz: autoWalk.gz, standX: autoWalk.standX, standZ: autoWalk.standZ } : null),
  cancelAutoWalk: () => cancelAutoWalk(),
  tileScreen: (gx: number, gz: number) => {
    const { x, z } = tileCenter(gx, gz);
    const left = parseFloat(renderer.canvas.style.left || "0");
    const top = parseFloat(renderer.canvas.style.top || "0");
    return { sx: left + renderer.sx(x) * renderer.scale, sy: top + renderer.sy(z) * renderer.scale };
  },
};
flHook.animals = {
  ids: () => STARTER_HERD.map((s) => s.id),
  record: (id: string) => (herd[id] ? JSON.parse(JSON.stringify(herd[id])) : null),
  actorPos: (id: string) => {
    const a = animalField.actorAt(id);
    return a ? { x: a.x, z: a.z } : null;
  },
  setPos: (id: string, x: number, z: number) => {
    const a = animalField.actorAt(id);
    if (a) {
      a.x = x;
      a.z = z;
    }
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
    if (herd[id]) doAnimalAction(id, "collect", 0, 0);
  },
  pet: (id: string) => {
    if (herd[id]) doAnimalAction(id, "pet", 0, 0);
  },
  produce: () => JSON.parse(JSON.stringify(farmState.produce)),
  phase: () => dayPhase(flNow()),
  setPhase: (name: "day" | "dusk" | "night" | "dawn") => {
    const targetHour = name === "day" ? 13 : name === "dusk" ? 19.3 : name === "night" ? 1 : 7;
    const cur = centralHour(flNow());
    let delta = targetHour - cur;
    while (delta > 12) delta -= 24;
    while (delta < -12) delta += 24;
    addTimeOffset(delta * 3_600_000);
    return dayPhase(flNow());
  },
  advance: (seconds: number) => {
    const steps = Math.max(1, Math.round(seconds * 30));
    for (let i = 0; i < steps; i++) animalField.update(1 / 30, dayPhase(flNow()), doorIsOpen());
  },
  inside: (id: string) => animalField.isInside(id),
  sleeping: (id: string) => animalField.isSleeping(id),
  allInside: () => STARTER_HERD.every((s) => animalField.isInside(s.id)),
  anyInside: () => STARTER_HERD.some((s) => animalField.isInside(s.id)),
  allSleeping: () => STARTER_HERD.every((s) => animalField.isSleeping(s.id)),
  zzzVisible: (id: string) => animalField.actorAt(id)?.zzzVisible ?? false,
  isCloud: () => animalStore === cloudAnimals,
  ready: () => (cloudAnimalsCtor ? cloudAnimalsCtor.ready : Promise.resolve(false)),
  flushSave: () => animalStore.flush?.(),
};
flHook.barn = {
  isOpen: () => doorIsOpen(),
  doorState: () => ({ ...doorState }),
  toggle: () => toggleBarnDoor(),
  setOpen: (o: boolean) => {
    if (doorIsOpen() !== o) toggleBarnDoor();
  },
  eggIds: () => Object.keys(eggs).filter((id) => !eggs[id].collectedBy),
  eggCount: () => Object.values(eggs).filter((e) => !e.collectedBy).length,
  eggRecord: (id: string) => (eggs[id] ? JSON.parse(JSON.stringify(eggs[id])) : null),
  layNow: () => maybeLayEggs(flNow()),
  spawnEggNow: (chickenId: string) => {
    const nest = nestSpot(chickenId);
    const id = eggId(chickenId, flNow());
    const rec: EggRecord = { id, chickenId, spawnedAt: flNow(), x: nest.x, z: nest.z };
    eggs[id] = rec;
    barnStore.putEgg(rec);
    return id;
  },
  collect: (id: string) => {
    const e = eggs[id];
    if (e) collectEgg(id, e.x, e.z);
  },
  nestSpot: (chickenId: string) => nestSpot(chickenId),
  bounds: () => ({ pasture: { ...PASTURE }, barn: { ...BARN }, gate: { ...GATE }, door: doorAnchor }),
  gateCollidePush: () => {
    const r = resolveCollision(GATE_CENTER.x, GATE_CENTER.z);
    return Math.hypot(r.x - GATE_CENTER.x, r.z - GATE_CENTER.z);
  },
  isCloud: () => barnStore === cloudBarn,
  ready: () => (cloudBarnCtor ? cloudBarnCtor.ready : Promise.resolve(false)),
  flushSave: () => barnStore.flush?.(),
};
flHook.art = {
  // scale-chart introspection for the R4 verify (baked sprite dims vs the farmer)
  farmerPx: FARMER_PX,
  chart: SCALE,
  barnDoorH: BARN_DOORWAY.h,
  houseDoorH: SCALE.farmhouse_door,
  size: (name: string) => {
    const map: Record<string, { canvas: HTMLCanvasElement }> = {
      farmhouse: Sprites.farmhouse(false),
      barn: Sprites.barnFront(false),
      silo: Sprites.silo(),
      bin: Sprites.bin(),
      stand: Sprites.stand(),
      tree0: Sprites.tree(0),
      tree1: Sprites.tree(1),
      tree2: Sprites.tree(2),
      goat: Sprites.goat(false, "stand", 0),
      hen: Sprites.chicken(false, false, 0),
    };
    const s = map[name];
    return s ? { w: s.canvas.width, h: s.canvas.height } : null;
  },
};
flHook.scene = {
  current: () => (currentInterior ? currentInterior.id : "exterior"),
  doors: () => EXTERIOR_DOORS.map((d) => ({ id: d.interiorId, x: d.x, z: d.z, reach: d.reach, mapX: d.mapX, mapZ: d.mapZ })),
  enter: (id: string) => {
    const d = EXTERIOR_DOORS.find((e) => e.interiorId === id);
    if (d) enterInterior(d);
  },
  exit: () => exitInterior(),
  fading: () => fade.active,
  fadeAlpha: () => fadeAlpha(),
  prompt: () => interiorPrompt,
  bounds: () => (currentInterior ? { ...currentInterior.bounds } : null),
  view: () => (currentInterior ? { ...currentInterior.view } : null),
  exitMat: () => (currentInterior ? { ...currentInterior.exit } : null),
  spawn: () => (currentInterior ? { ...currentInterior.spawn } : null),
  // the coords published to presence (door while inside; own pos outside) — the
  // MP "renders at the door" representation is asserted through this.
  presencePos: () => (currentInterior && sceneReturn ? { x: sceneReturn.x, z: sceneReturn.z } : { x: playerX, z: playerZ }),
};
flHook.decor = {
  count: () => decorField.count(),
  ids: () => decorField.ids(),
  record: (id: string) => (decor[id] ? JSON.parse(JSON.stringify(decor[id])) : null),
  types: () => Object.values(decor).map((d) => d.type),
  buy: (type: string) => buyDecor(type),
  target: () => (pending && pending.type === "removeDecor" ? { id: pending.decorId, label: pending.label } : null),
  removeArmed: () => (removeArmed ? { id: removeArmed.id, until: removeArmed.until } : null),
  action: () => doAction(),
  // placement mode (R2)
  placing: () => (placing ? { type: placing.type, rotY: placing.rotY } : null),
  placementPos: () => placementPos(),
  placementValid: () => (placing ? isPlaceable(placing.type, placementPos().x, placementPos().z) : false),
  confirmPlace: () => confirmPlacement(),
  cancelPlace: () => cancelPlacement(),
  rotatePlace: () => rotatePlacement(),
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
  isCloud: () => metaStore === cloudMeta,
  ready: () => (cloudMetaCtor ? cloudMetaCtor.ready : Promise.resolve(false)),
  flushSave: () => metaStore.flush?.(),
};
flHook.mapinv = {
  openMap: () => hud.openMap(),
  closeMap: () => hud.closeMap(),
  isMapOpen: () => hud.isMapOpen(),
  mapSnapshot: () => JSON.parse(JSON.stringify(buildMapSnapshot())) as FarmMapSnapshot,
  drawMapNow: () => drawFarmMap(mapCtx, hud.mapCanvasSize(), buildMapSnapshot(), flNow() / 1000),
  openInventory: () => hud.showInventory(buildInventoryData()),
  closeInventory: () => hud.hideInventory(),
  isInventoryOpen: () => hud.isInventoryOpen(),
  inventoryData: () => JSON.parse(JSON.stringify(buildInventoryData())) as InventoryData,
};
flHook.weather = {
  current: () => weather.current,
  sky: () => skyAt(flNow()),
  applySky: () => applySky(),
  sunElev: () => curSunElev,
  _inject: (snap: { cond: "clear" | "rain" | "snow"; code: number; fetchedAt: number; tempF?: number }) => {
    weather.current = snap;
    const label = snap.tempF != null ? `${weatherEmoji(snap.cond)} ${Math.round(snap.tempF)}°F` : weatherEmoji(snap.cond);
    hud.setWeather(label);
    wasRaining = snap.cond === "rain";
  },
  nextAutoWaterAt: () => nextRainAutoWaterAt,
  forceAutoWater: () => autoWaterFromRain(flNow()),
};
flHook.net = {
  isCloud: () => farmStore === cloudFarm,
  ready: () => (cloudFarmCtor ? cloudFarmCtor.ready : Promise.resolve(false)),
  flush: () => farmStore.flush?.(),
  playerName: () => (cloudFarmCtor ? cloudFarmCtor.playerName : null),
};
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
  // full remote RENDER state on THIS device (pos/tint/facing/tool/moving/acting/
  // emote) — the MP verify samples the other player's puppet through this.
  remoteState: (id: string) => remotePlayers.state(id),
  emote: (kind: EmoteKind) => doEmote(kind),
};
flHook.touch = {
  mobile: () => !!touch,
  // live joystick vector (null on desktop) — the mobile verify reads this to
  // confirm a drag engages the analog stick and a tap does NOT.
  input: () => (touch ? { ...touch.input } : null),
};

// ---- render (dynamic, y-sorted) ---------------------------------------------
interface Sortable {
  z: number;
  draw: () => void;
}
function drawWorld(now: number): void {
  const tSec = now / 1000;
  renderer.clear();
  renderer.blitMap(world2d.staticMap);
  drawPondShimmer(tSec);
  field.drawSoil(renderer, farmState, flNow());
  field.drawHighlight(renderer);

  const items: Sortable[] = [];
  const view = renderer.viewBounds();
  const vis = (x: number, z: number, pad = 6) => x > view.minX - pad && x < view.maxX + pad && z > view.minZ - pad && z < view.maxZ + pad;

  const night = skyAt(flNow()).windowGlow > 0.35;
  // static props
  for (const t of world2d.trees) if (vis(t.x, t.z, 8)) items.push({ z: t.z, draw: () => renderer.drawSprite(Sprites.tree(t.size), t.x, t.z) });
  for (const r of world2d.rocks) if (vis(r.x, r.z)) items.push({ z: r.z, draw: () => renderer.drawSprite(Sprites.rock(r.size), r.x, r.z) });
  items.push({ z: world2d.house.z, draw: () => renderer.drawSprite(Sprites.farmhouse(night), world2d.house.x, world2d.house.z) });
  // barn: interior floor+nests behind everything inside (early z), roof+walls+door
  // in front (late z; fades to reveal the interior when the player walks in).
  const barnCX = (world2d.barn.minX + world2d.barn.maxX) / 2;
  items.push({ z: world2d.barn.minZ - 0.2, draw: () => renderer.drawSprite(Sprites.barnBack(night), barnCX, world2d.barn.maxZ) });
  items.push({ z: world2d.barn.maxZ + 5, draw: () => drawBarn(barnCX, night) });
  items.push({ z: world2d.silo.z, draw: () => renderer.drawSprite(Sprites.silo(), world2d.silo.x, world2d.silo.z) });
  items.push({ z: world2d.bin.z, draw: () => renderer.drawSprite(Sprites.bin(), world2d.bin.x, world2d.bin.z) });
  items.push({ z: world2d.stand.z, draw: () => renderer.drawSprite(Sprites.stand(), world2d.stand.x, world2d.stand.z) });
  // fences (rails then posts, per their z)
  for (const r of fenceRails) items.push({ z: (r.z1 + r.z2) / 2 - 0.01, draw: () => drawRail(r) });
  for (const p of world2d.gatePosts) items.push({ z: p.z, draw: () => renderer.drawSprite(Sprites.gatePost(), p.x, p.z) });
  for (const p of fencePosts) if (vis(p.x, p.z)) items.push({ z: p.z, draw: () => renderer.drawSprite(Sprites.fencePost(), p.x, p.z) });
  // eggs
  for (const e of Object.values(eggs)) if (!e.collectedBy) items.push({ z: e.z, draw: () => renderer.drawSprite(Sprites.egg(), e.x, e.z) });
  // crops
  for (const c of field.cropItems(farmState, flNow())) items.push({ z: c.z, draw: () => renderer.drawSprite(c.sprite, c.x, c.z) });
  // animals
  for (const a of animalField.actors) if (vis(a.x, a.z)) items.push({ z: a.z, draw: () => animalField.drawActor(renderer, a) });
  // decor
  decorField.forEach((z, draw) => items.push({ z, draw: () => draw(renderer) }));
  // remotes
  remotePlayers.forEach((z, draw) => items.push({ z, draw: () => draw(renderer) }));
  // local player
  const moving = curSpeed > 0.3 && !isBusy();
  items.push({
    z: playerZ,
    draw: () => {
      const liftPx = hopY * PPM;
      const shadowScale = 1 - Math.min(0.45, hopY * 0.4);
      farmer.draw(renderer.ctx, renderer.sx(playerX), renderer.sy(playerZ), facing, moving, curSpeed / (tune.moveSpeed * tune.runMult) > 0.6, liftPx, shadowScale, DEFAULT_LOOK, farmState.selectedTool);
    },
  });

  items.sort((a, b) => a.z - b.z);
  for (const it of items) it.draw();

  // placement ghost (follows the spot in front of the player)
  if (placing) {
    const gp = placementPos();
    decorField.drawGhost(renderer, placing.type, gp.x, gp.z, placing.rotY, isPlaceable(placing.type, gp.x, gp.z));
  }

  // overlays (above props)
  const readyItems = field.cropItems(farmState, flNow());
  field.drawEffects(renderer, readyItems);
  animalField.drawZzz(renderer);
  remotePlayers.drawOverlay(renderer);
  drawLocalEmote(now);
  drawCoinArcs();
  const cond = weather.current?.cond;
  if (cond === "rain") drawRain(tSec);
  else if (cond === "snow") drawSnow(tSec);

  renderer.applyDayNight(curSunElev);
  if (barnCutaway > 0.04) drawBarnGlow();
  if (cond === "rain") drawRainTintAndPuddles(tSec);
}

function drawPondShimmer(tSec: number): void {
  const ctx = renderer.ctx;
  const cx = renderer.sx(world2d.pond.cx);
  const cy = renderer.sy(world2d.pond.cz);
  const r = world2d.pond.r * PPM;
  ctx.strokeStyle = "rgba(200,235,246,0.5)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const yy = cy - r * 0.4 + ((tSec * 6 + i * 22) % (r * 1.2)) - r * 0.6;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, yy);
    ctx.quadraticCurveTo(cx, yy - 2, cx + r * 0.55, yy);
    ctx.stroke();
  }
}
function drawBarn(cx: number, night: boolean): void {
  const alpha = 1 - barnCutaway * 0.74; // roof-fade cutaway when the player is inside
  renderer.drawSprite(Sprites.barnFront(night), cx, world2d.barn.maxZ, 0, alpha);
  drawBarnDoor(cx, alpha);
}
/** Warm interior light pool inside the barn during the cutaway (drawn AFTER the
 * day/night tint so the revealed interior reads cozy even at night). */
function drawBarnGlow(): void {
  const ctx = renderer.ctx;
  const cx = renderer.sx((world2d.barn.minX + world2d.barn.maxX) / 2);
  const cy = renderer.sy(world2d.barn.maxZ) - 2.2 * PPM;
  const rad = (world2d.barn.maxX - world2d.barn.minX) * PPM * 0.55;
  const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, rad);
  g.addColorStop(0, "rgba(255,214,140,0.85)");
  g.addColorStop(1, "rgba(255,214,140,0)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.5 * barnCutaway;
  ctx.fillStyle = g;
  ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  ctx.restore();
}
function drawBarnDoor(cx: number, alpha: number): void {
  const ctx = renderer.ctx;
  const leftX = renderer.sx(cx) - BARN_DOORWAY.ax;
  const topY = renderer.sy(world2d.barn.maxZ) - BARN_DOORWAY.ay;
  const dx = Math.round(leftX + BARN_DOORWAY.x);
  const dy = Math.round(topY + BARN_DOORWAY.y);
  const w = Math.round(BARN_DOORWAY.w);
  const h = Math.round(BARN_DOORWAY.h);
  // the swinging panel: hinged at the left jamb, width shrinks as it opens (the
  // transparent doorway cutout behind it reveals the barn interior when open).
  const pw = Math.max(0, Math.round(w * (1 - barnDoorFrac)));
  if (pw <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#772414";
  ctx.fillRect(dx, dy, pw, h);
  ctx.fillStyle = "#96331e";
  for (let x = dx + 2; x < dx + pw - 1; x += 4) ctx.fillRect(x, dy, 1, h);
  ctx.fillStyle = "#5c1c10";
  ctx.fillRect(dx, dy, pw, 1);
  if (pw > 5) {
    ctx.strokeStyle = "#5c1c10";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dx + 1, dy + 1);
    ctx.lineTo(dx + pw - 1, dy + h - 1);
    ctx.moveTo(dx + pw - 1, dy + 1);
    ctx.lineTo(dx + 1, dy + h - 1);
    ctx.stroke();
    ctx.fillStyle = "#c88a2a"; // handle
    ctx.fillRect(dx + pw - 3, dy + Math.round(h / 2), 2, 2);
  }
  ctx.restore();
}
function drawRail(r: FenceRail): void {
  const ctx = renderer.ctx;
  for (const h of [0.5, 0.95]) {
    const y1 = renderer.sy(r.z1) - h * PPM;
    const y2 = renderer.sy(r.z2) - h * PPM;
    ctx.strokeStyle = h < 0.7 ? FENCE.raild : FENCE.rail;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(renderer.sx(r.x1), y1);
    ctx.lineTo(renderer.sx(r.x2), y2);
    ctx.stroke();
  }
}
function drawLocalEmote(now: number): void {
  if (!localEmote) return;
  if (now > localEmote.until) {
    localEmote = null;
    return;
  }
  // same pixel speech bubble as the remotes, lifted with the cosmetic hop
  const baseY = renderer.sy(playerZ) - 34 - hopY * PPM - 8;
  drawSpeechBubble(renderer.ctx, renderer.sx(playerX), baseY, EMOTES[localEmote.kind]);
}
let rainSeedInit = false;
const rainDrops: { x: number; y: number }[] = [];
function drawRain(_tSec: number): void {
  const ctx = renderer.ctx;
  if (!rainSeedInit) {
    for (let i = 0; i < 110; i++) rainDrops.push({ x: Math.random() * renderer.nativeW, y: Math.random() * renderer.nativeH });
    rainSeedInit = true;
  }
  ctx.strokeStyle = "rgba(196,222,242,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const d of rainDrops) {
    d.y += 7;
    d.x += 1.4;
    if (d.y > renderer.nativeH) d.y = -4;
    if (d.x > renderer.nativeW) d.x = 0;
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x - 1.6, d.y + 6);
  }
  ctx.stroke();
}

/** Cool overcast darkening + shimmering puddle glints on the path tiles (after
 * the day/night tint, so glints stay bright). */
function drawRainTintAndPuddles(tSec: number): void {
  const ctx = renderer.ctx;
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = "#38485a";
  ctx.fillRect(0, 0, renderer.nativeW, renderer.nativeH);
  ctx.restore();
  for (const [wx, wz] of DEFAULT_PATH_PTS) {
    const sx = renderer.sx(wx);
    const sy = renderer.sy(wz);
    if (sx < -8 || sx > renderer.nativeW + 8 || sy < -8 || sy > renderer.nativeH + 8) continue;
    const shimmer = 0.5 + 0.5 * Math.sin(tSec * 3 + wx);
    ctx.globalAlpha = 0.28 + shimmer * 0.28;
    ctx.fillStyle = "#b6d7f0";
    ctx.beginPath();
    ctx.ellipse(sx, sy, 6, 2.2, 0, 0, 7);
    ctx.fill();
    ctx.globalAlpha = (0.28 + shimmer * 0.28) * 0.6;
    ctx.fillStyle = "#e6f4ff";
    ctx.fillRect(Math.round(sx - 2), Math.round(sy - 1), 3, 1);
  }
  ctx.globalAlpha = 1;
}

const snowFlakes: { x: number; y: number; drift: number; sz: number }[] = [];
let snowInit = false;
function drawSnow(tSec: number): void {
  const ctx = renderer.ctx;
  if (!snowInit) {
    for (let i = 0; i < 80; i++) snowFlakes.push({ x: Math.random() * renderer.nativeW, y: Math.random() * renderer.nativeH, drift: Math.random() * 6, sz: Math.random() < 0.4 ? 2 : 1 });
    snowInit = true;
  }
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  for (const f of snowFlakes) {
    f.y += 0.55;
    f.x += Math.sin(tSec * 1.6 + f.drift) * 0.4;
    if (f.y > renderer.nativeH) f.y = -2;
    if (f.x > renderer.nativeW) f.x = 0;
    else if (f.x < 0) f.x = renderer.nativeW;
    ctx.fillRect(Math.round(f.x), Math.round(f.y), f.sz, f.sz);
  }
}

// ---- coin-arc juice: coins fly from the bin toward the top-left coin HUD ------
interface CoinArc {
  sx: number;
  sy: number;
  born: number;
  delay: number;
}
const coinArcs: CoinArc[] = [];
function spawnCoinArc(worldX: number, worldZ: number): void {
  const sx = renderer.sx(worldX);
  const sy = renderer.sy(worldZ) - 12;
  for (let i = 0; i < 7; i++) coinArcs.push({ sx: sx + (Math.random() - 0.5) * 9, sy, born: performance.now(), delay: i * 52 });
}
function drawCoinArcs(): void {
  if (!coinArcs.length) return;
  const ctx = renderer.ctx;
  const now = performance.now();
  const tx = 16,
    ty = 14; // toward the coin counter (top-left HUD)
  const LIFE = 620;
  for (let i = coinArcs.length - 1; i >= 0; i--) {
    const c = coinArcs[i];
    const t = (now - c.born - c.delay) / LIFE;
    if (t < 0) continue;
    if (t >= 1) {
      coinArcs.splice(i, 1);
      continue;
    }
    const e = t * t * (3 - 2 * t); // smoothstep
    const x = c.sx + (tx - c.sx) * e;
    const y = c.sy + (ty - c.sy) * e - Math.sin(t * Math.PI) * 16;
    const wsq = Math.abs(Math.cos(t * 11)) * 2 + 1; // spin squash
    ctx.fillStyle = "#f4c542";
    ctx.fillRect(Math.round(x - wsq / 2), Math.round(y - 2), Math.max(1, Math.round(wsq)), 4);
    ctx.fillStyle = "#fff2a8";
    ctx.fillRect(Math.round(x - wsq / 2), Math.round(y - 2), 1, 1);
    ctx.fillStyle = "#c8960f";
    ctx.fillRect(Math.round(x - wsq / 2), Math.round(y + 1), Math.max(1, Math.round(wsq)), 1);
  }
}

// ---- interior scene frame (R4) ----------------------------------------------
function frameInterior(now: number, dt: number): void {
  const it = currentInterior!;
  let input = controls.sample();
  if (touch && (touch.input.fwd !== 0 || touch.input.strafe !== 0)) input = touch.input;
  if (fade.active) input = { fwd: 0, strafe: 0, run: false };

  let speed = 0;
  let dx = input.strafe;
  let dz = -input.fwd;
  const mag = Math.hypot(dx, dz);
  if (mag > 0.001) {
    dx /= mag;
    dz /= mag;
    const spd = tune.moveSpeed * (input.run ? tune.runMult : 1) * Math.min(1, mag);
    const before = { x: playerX, z: playerZ };
    const rc = resolveInteriorCollision(it, playerX + dx * spd * dt, playerZ + dz * spd * dt);
    playerX = rc.x;
    playerZ = rc.z;
    speed = Math.hypot(rc.x - before.x, rc.z - before.z) / dt;
    heading = Math.atan2(dx, dz);
    facing = facingFromHeading(heading, true, facing);
  }
  curSpeed = speed;
  farmer.update(dt, speed / (tune.moveSpeed * tune.runMult));
  renderer.follow(playerX, playerZ, dt);

  // exit mat: standing on it shows a leave prompt; the action button leaves
  const onMat = Math.hypot(playerX - it.exit.x, playerZ - it.exit.z) < it.exit.r;
  interiorPrompt = onMat ? "⏎ Leave the house" : null;

  // presence: publish the DOOR world coords so remote family see us at the door
  if (sceneReturn) presence.publishLocal({ x: sceneReturn.x, y: 0, z: sceneReturn.z, heading, tool: farmState.selectedTool });
  presence.update(dt);

  skyTimer += dt;
  if (skyTimer >= 2) {
    skyTimer = 0;
    applySky();
  }
  playerState.x = playerX;
  playerState.z = playerZ;
  playerState.y = 0;
  playerState.heading = heading;
  playerState.speed = speed;
  playerState.airborne = false;

  drawInteriorScene(now);
}

function drawInteriorScene(now: number): void {
  const tSec = now / 1000;
  const it = currentInterior!;
  const night = skyAt(flNow()).windowGlow > 0.35;
  it.draw(renderer, tSec, night);
  // the farmer, drawn over the room
  const moving = curSpeed > 0.3;
  farmer.draw(renderer.ctx, renderer.sx(playerX), renderer.sy(playerZ), facing, moving, false, 0, 1, DEFAULT_LOOK, farmState.selectedTool);
  // "leave" prompt at the exit mat
  if (interiorPrompt) drawSpeechBubble(renderer.ctx, renderer.sx(it.exit.x), renderer.sy(it.exit.z) - 20, interiorPrompt);
  // a gentle (capped) day/night mood tint; the fireplace glow already lit the room
  renderer.applyDayNight(Math.max(curSunElev, -6));
  drawFade();
}

// ---- loop -------------------------------------------------------------------
let last = performance.now();
let skyTimer = 2;
let curSpeed = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  updateFade(dt);
  if (currentInterior) {
    frameInterior(now, dt);
    requestAnimationFrame(frame);
    return;
  }

  let input = controls.sample();
  if (touch && (touch.input.fwd !== 0 || touch.input.strafe !== 0)) input = touch.input;
  if (autoWalk && (input.fwd !== 0 || input.strafe !== 0)) cancelAutoWalk();
  if (isBusy() || fade.active) input = { fwd: 0, strafe: 0, run: false };

  let speed = 0;
  if (autoWalk && !isBusy()) {
    speed = stepAutoWalk(dt);
  } else {
    // top-down: strafe → +X, fwd(up) → −Z
    let dx = input.strafe;
    let dz = -input.fwd;
    const mag = Math.hypot(dx, dz);
    if (mag > 0.001) {
      dx /= mag;
      dz /= mag;
      const spd = tune.moveSpeed * (input.run ? tune.runMult : 1) * Math.min(1, mag);
      const before = { x: playerX, z: playerZ };
      const rc = resolveCollision(playerX + dx * spd * dt, playerZ + dz * spd * dt);
      playerX = rc.x;
      playerZ = rc.z;
      speed = Math.hypot(rc.x - before.x, rc.z - before.z) / dt;
      heading = Math.atan2(dx, dz);
      facing = facingFromHeading(heading, true, facing);
    }
  }
  curSpeed = speed;

  // cosmetic hop
  if (airborne) {
    hopVel -= tune.gravity * dt;
    hopY += hopVel * dt;
    if (hopY <= 0) {
      hopY = 0;
      airborne = false;
      hopVel = 0;
      landCount++;
      audio.land();
      field.spawnBurst(playerX, 0, playerZ, 0xcbb892, 5, 0.6);
    }
  }
  farmer.update(dt, speed / (tune.moveSpeed * tune.runMult));
  if (!airborne) audio.footTick(dt, speed, Math.min(1, speed / (tune.moveSpeed * tune.runMult)));

  renderer.follow(playerX, playerZ, dt);

  playerState.x = playerX;
  playerState.z = playerZ;
  playerState.y = hopY;
  playerState.heading = heading;
  playerState.speed = speed;
  playerState.airborne = airborne;

  const nowMs = flNow();
  updateTargeting(playerX, playerZ, heading);
  if (placing) updatePlacement();
  field.animate(nowMs / 1000);
  if (pending) {
    const left = parseFloat(renderer.canvas.style.left || "0");
    const top = parseFloat(renderer.canvas.style.top || "0");
    const sx = left + renderer.sx(pending.worldX) * renderer.scale;
    const sy = top + (renderer.sy(pending.worldZ) - 20) * renderer.scale;
    hud.showActionLabel(pending.label, sx, sy, pending.color);
  } else {
    hud.showActionLabel(null, 0, 0, "#fff");
  }

  presence.publishLocal(localPose());
  presence.update(dt);
  remotePlayers.update(dt, presence);

  const animalPhase = dayPhase(nowMs);
  animalField.update(dt, animalPhase, doorIsOpen());
  maybeLayEggs(nowMs);
  if ((animalPhase === "dusk" || animalPhase === "night") && !doorIsOpen()) {
    if (!barnWaitToastShown && !animalField.allInsideBarn()) {
      hud.toast("The animals are waiting by the barn door 🌙");
      barnWaitToastShown = true;
    }
  } else {
    barnWaitToastShown = false;
  }
  // animate barn door swing + roof-fade cutaway. R4: the barn is now a chunky
  // ~4.7× billboard whose door faces UP-screen, so it can occlude the door
  // approach + the herd gathering outside. The cutaway therefore covers the
  // APPROACH zone (z reaching south of the door, not just the interior), and a
  // gentle partial reveal shows the herd waiting at a shut door at dusk/night.
  const doorTarget = doorIsOpen() ? 1 : 0;
  barnDoorFrac += (doorTarget - barnDoorFrac) * Math.min(1, dt * 8);
  const inBarnZone = playerX > BARN.minX - 1.5 && playerX < BARN.maxX + 1.5 && playerZ > BARN.minZ - 4 && playerZ < BARN.maxZ + 1;
  const herdAtDoor = (animalPhase === "dusk" || animalPhase === "night") && !doorIsOpen() && !animalField.allInsideBarn();
  const cutawayTarget = inBarnZone ? 1 : herdAtDoor ? 0.5 : 0;
  barnCutaway += (cutawayTarget - barnCutaway) * Math.min(1, dt * 8);
  decorField.update(dt);

  if (hud.isMapOpen()) drawFarmMap(mapCtx, hud.mapCanvasSize(), buildMapSnapshot(), nowMs / 1000);
  if (hud.isInventoryOpen()) hud.showInventory(buildInventoryData());

  skyTimer += dt;
  if (skyTimer >= 2) {
    skyTimer = 0;
    applySky();
  }
  tickWeather(nowMs);

  drawWorld(now);
  drawFade();
  requestAnimationFrame(frame);
}

const loading = document.getElementById("loading");
if (loading) loading.style.display = "none";
requestAnimationFrame(frame);
