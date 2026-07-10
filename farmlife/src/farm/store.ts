import { CROP_ORDER, CropId } from "./growth";
import { TOOL_ORDER, type ToolId } from "./action";
import { STARTER_HERD, sanitizeAnimal, starterHerd, PRODUCE_ORDER, type AnimalRecord, type ProduceId } from "./animals";
import { isDecorType, type DecorRecord } from "../world/decor";
import { defaultDoorState, type DoorState, type EggRecord } from "./pasture";
// type-only import (erased at build) so there is no runtime store<->sync cycle.
import { DEFAULT_FARM_NAME, type MetaState } from "../net/sync";

// ---------------------------------------------------------------------------
// Persistence sits behind FarmStore so P2 can swap in a Firestore-backed
// implementation without touching any game logic — every caller in this
// codebase talks to the FarmStore interface, never to localStorage directly.
// ---------------------------------------------------------------------------

/** A stored tile: present only for tilled/planted tiles (sparse — untouched
 * grass tiles are simply absent from FarmState.tiles). `crop` present means
 * planted; absent means tilled-but-empty. Mirrors growth.ts's GrowthTile
 * shape when a crop is present. */
export interface TileRecord {
  crop?: CropId;
  plantedAt?: number;
  accruedMs?: number;
  lastWatered?: number;
}

export interface FarmState {
  tiles: Record<string, TileRecord>; // key = `t_<gx>_<gz>`
  seeds: Record<CropId, number>;
  crops: Record<CropId, number>; // harvested, unsold inventory
  produce: Record<ProduceId, number>; // P4: collected milk/eggs, unsold inventory
  coins: number;
  selectedCrop: CropId; // crop chosen in the seed-pouch slot (was `selectedSeed`)
  selectedTool: ToolId; // equipped hotbar tool
  tank: number; // watering-can water units
}

const DEFAULT_TANK = 6;

export function defaultFarmState(): FarmState {
  return {
    tiles: {},
    seeds: { turnip: 5, potato: 0, corn: 0, pumpkin: 0, strawberry: 0, carrot: 0, tomato: 0, sunflower: 0 },
    crops: { turnip: 0, potato: 0, corn: 0, pumpkin: 0, strawberry: 0, carrot: 0, tomato: 0, sunflower: 0 },
    produce: { milk: 0, egg: 0 },
    coins: 100,
    selectedCrop: "turnip",
    selectedTool: "hoe",
    tank: DEFAULT_TANK,
  };
}

/** Defensive merge over defaults — a corrupt/partial save can never brick the
 * game (herd-dup-hardening house convention: never trust raw storage). */
export function sanitizeFarmState(raw: unknown): FarmState {
  const out = defaultFarmState();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Partial<FarmState>;

  if (r.tiles && typeof r.tiles === "object") {
    for (const [key, val] of Object.entries(r.tiles as Record<string, unknown>)) {
      if (!/^t_\d+_\d+$/.test(key) || !val || typeof val !== "object") continue;
      const v = val as TileRecord;
      const rec: TileRecord = {};
      if (v.crop && CROP_ORDER.includes(v.crop)) {
        rec.crop = v.crop;
        rec.plantedAt = typeof v.plantedAt === "number" ? v.plantedAt : 0;
        rec.accruedMs = typeof v.accruedMs === "number" ? v.accruedMs : 0;
        rec.lastWatered = typeof v.lastWatered === "number" ? v.lastWatered : rec.plantedAt;
      }
      out.tiles[key] = rec;
    }
  }
  for (const id of CROP_ORDER) {
    const s = r.seeds && (r.seeds as Record<string, number>)[id];
    const c = r.crops && (r.crops as Record<string, number>)[id];
    if (typeof s === "number" && isFinite(s) && s >= 0) out.seeds[id] = s;
    if (typeof c === "number" && isFinite(c) && c >= 0) out.crops[id] = c;
  }
  for (const id of PRODUCE_ORDER) {
    const p = r.produce && (r.produce as Record<string, number>)[id];
    if (typeof p === "number" && isFinite(p) && p >= 0) out.produce[id] = p;
  }
  if (typeof r.coins === "number" && isFinite(r.coins) && r.coins >= 0) out.coins = r.coins;
  // selectedCrop (v1.5) with graceful migration from the old `selectedSeed` field
  const legacySeed = (raw as { selectedSeed?: unknown }).selectedSeed;
  const chosenCrop = (r.selectedCrop as CropId | undefined) ?? (legacySeed as CropId | undefined);
  if (chosenCrop && CROP_ORDER.includes(chosenCrop)) out.selectedCrop = chosenCrop;
  if (r.selectedTool && TOOL_ORDER.includes(r.selectedTool)) out.selectedTool = r.selectedTool;
  if (typeof r.tank === "number" && isFinite(r.tank) && r.tank >= 0) out.tank = Math.floor(r.tank);
  return out;
}

export interface FarmStore {
  load(): Promise<FarmState | null>;
  save(state: FarmState): void;
  /** Force any debounced pending write out immediately (pagehide / test hook).
   * Optional — LocalFarmStore and CloudFarmStore (P2) both implement it. */
  flush?(): void;
}

const KEY = "fl_farm_v1";
const DEBOUNCE_MS = 500;

/** localStorage-backed FarmStore (P1). Debounced writes + flush on pagehide
 * so a mid-write tab close never loses more than DEBOUNCE_MS of progress. */
export class LocalFarmStore implements FarmStore {
  private timer: number | null = null;
  private pending: FarmState | null = null;

  constructor() {
    window.addEventListener("pagehide", () => this.flush());
    window.addEventListener("beforeunload", () => this.flush());
  }

  async load(): Promise<FarmState | null> {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return sanitizeFarmState(JSON.parse(raw));
    } catch (_) {
      return null;
    }
  }

  save(state: FarmState): void {
    this.pending = state;
    if (this.timer != null) return;
    this.timer = window.setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  /** Force an immediate write of the last pending state (test hook + pagehide). */
  flush(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.pending));
    } catch (_) {
      /* quota / private mode -> ignore, next successful save will retry */
    }
  }
}

// ---------------------------------------------------------------------------
// Animals (P4) — a tiny sibling store, same debounce/flush shape as
// LocalFarmStore/CloudFarmStore but for the herd only. Kept separate from
// FarmState because the herd is shared-but-independent data (not per-tile),
// and because solo/local play should get a starter herd on first boot exactly
// once, same "sparse persisted record, defensive parse" posture as tiles.
// ---------------------------------------------------------------------------

export interface AnimalStore {
  load(): Promise<Record<string, AnimalRecord> | null>;
  save(herd: Record<string, AnimalRecord>): void;
  flush?(): void;
}

const ANIMALS_KEY = "fl_animals_v1";
const ANIMALS_DEBOUNCE_MS = 500;

export function sanitizeHerd(raw: unknown, now: number): Record<string, AnimalRecord> {
  const out: Record<string, AnimalRecord> = {};
  if (raw && typeof raw === "object") {
    for (const spec of STARTER_HERD) {
      if (spec.id in (raw as Record<string, unknown>)) {
        const a = sanitizeAnimal(spec.id, (raw as Record<string, unknown>)[spec.id], now);
        if (a) out[spec.id] = a;
      }
    }
  }
  return out;
}

export class LocalAnimalStore implements AnimalStore {
  private timer: number | null = null;
  private pending: Record<string, AnimalRecord> | null = null;

  constructor() {
    window.addEventListener("pagehide", () => this.flush());
    window.addEventListener("beforeunload", () => this.flush());
  }

  /** Returns the saved herd, or a freshly-spawned starter herd (persisted
   * immediately) if this device has never seen one — the local equivalent of
   * the server-confirmed-empty-doc seed guard. */
  async load(): Promise<Record<string, AnimalRecord> | null> {
    try {
      const raw = localStorage.getItem(ANIMALS_KEY);
      if (raw) {
        const herd = sanitizeHerd(JSON.parse(raw), Date.now());
        if (Object.keys(herd).length) return herd;
      }
    } catch (_) {
      /* corrupt save -> fall through to a fresh herd */
    }
    const fresh = starterHerd(Date.now());
    this.save(fresh);
    this.flush();
    return fresh;
  }

  save(herd: Record<string, AnimalRecord>): void {
    this.pending = herd;
    if (this.timer != null) return;
    this.timer = window.setTimeout(() => this.flush(), ANIMALS_DEBOUNCE_MS);
  }

  flush(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return;
    try {
      localStorage.setItem(ANIMALS_KEY, JSON.stringify(this.pending));
    } catch (_) {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Barn (husbandry rework) — LocalBarnStore holds the shared barn door state +
// the physical-egg map ({door, eggs}), same debounce/flush shape as the others.
// Solo/local play never races, so collect just marks collectedBy locally.
// ---------------------------------------------------------------------------

export interface BarnData {
  door: DoorState;
  eggs: Record<string, EggRecord>;
}

export interface BarnStore {
  load(): Promise<BarnData>;
  setDoor(d: DoorState): void;
  /** Spawn or update (collect) one egg field. */
  putEgg(e: EggRecord): void;
  flush?(): void;
}

const BARN_KEY = "fl_barn_v1";
const BARN_DEBOUNCE_MS = 400;
const EGG_ID_RE = /^e_[a-z0-9]+_-?\d+$/i;

export function sanitizeBarn(raw: unknown): BarnData {
  const out: BarnData = { door: defaultDoorState(), eggs: {} };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as { door?: unknown; eggs?: unknown };
  if (r.door && typeof r.door === "object") {
    const d = r.door as { open?: unknown; at?: unknown };
    out.door = { open: d.open === true, at: typeof d.at === "number" && isFinite(d.at) ? d.at : 0 };
  }
  if (r.eggs && typeof r.eggs === "object") {
    for (const [id, val] of Object.entries(r.eggs as Record<string, unknown>)) {
      if (!EGG_ID_RE.test(id) || !val || typeof val !== "object") continue;
      const v = val as Partial<EggRecord>;
      const num = (x: unknown, d: number) => (typeof x === "number" && isFinite(x) ? x : d);
      const cid = typeof v.chickenId === "string" ? v.chickenId.slice(0, 24) : "";
      if (!cid) continue;
      const rec: EggRecord = { id, chickenId: cid, spawnedAt: num(v.spawnedAt, 0), x: num(v.x, 0), z: num(v.z, 0) };
      if (typeof v.collectedBy === "string" && v.collectedBy.trim()) rec.collectedBy = v.collectedBy.slice(0, 40);
      if (typeof v.collectedAt === "number" && isFinite(v.collectedAt)) rec.collectedAt = v.collectedAt;
      out.eggs[id] = rec;
    }
  }
  return out;
}

export class LocalBarnStore implements BarnStore {
  private timer: number | null = null;
  private data: BarnData = { door: defaultDoorState(), eggs: {} };
  private dirty = false;

  constructor() {
    window.addEventListener("pagehide", () => this.flush());
    window.addEventListener("beforeunload", () => this.flush());
  }

  async load(): Promise<BarnData> {
    try {
      const raw = localStorage.getItem(BARN_KEY);
      if (raw) this.data = sanitizeBarn(JSON.parse(raw));
    } catch (_) {
      /* corrupt -> defaults */
    }
    return JSON.parse(JSON.stringify(this.data)) as BarnData;
  }

  setDoor(d: DoorState): void {
    this.data.door = { open: !!d.open, at: d.at || 0 };
    this.queue();
  }

  putEgg(e: EggRecord): void {
    this.data.eggs[e.id] = { ...e };
    this.queue();
  }

  private queue(): void {
    this.dirty = true;
    if (this.timer != null) return;
    this.timer = window.setTimeout(() => this.flush(), BARN_DEBOUNCE_MS);
  }

  flush(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    try {
      localStorage.setItem(BARN_KEY, JSON.stringify(this.data));
    } catch (_) {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Decorations (P5) — LocalDecorStore, same debounce/flush shape as the animal
// store but for the placed-decoration map. Unlike animals there is NO seed
// step: an empty save is a normal state (decor starts empty), so load() returns
// `{}` (never null-seeds).
// ---------------------------------------------------------------------------

export interface DecorStore {
  load(): Promise<Record<string, DecorRecord>>;
  save(decor: Record<string, DecorRecord>): void;
  flush?(): void;
}

const DECOR_KEY = "fl_decor_v1";
const DECOR_DEBOUNCE_MS = 400;

export function sanitizeDecorMap(raw: unknown): Record<string, DecorRecord> {
  const out: Record<string, DecorRecord> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^d_[a-z0-9]+$/i.test(id) || !val || typeof val !== "object") continue;
    const v = val as Partial<DecorRecord>;
    if (typeof v.type !== "string" || !isDecorType(v.type)) continue;
    const num = (x: unknown, d: number) => (typeof x === "number" && isFinite(x) ? x : d);
    out[id] = {
      id,
      type: v.type,
      x: num(v.x, 0),
      z: num(v.z, 0),
      rotY: num(v.rotY, 0),
      placedBy: typeof v.placedBy === "string" ? v.placedBy.slice(0, 40) : "",
      placedAt: num(v.placedAt, 0),
    };
  }
  return out;
}

export class LocalDecorStore implements DecorStore {
  private timer: number | null = null;
  private pending: Record<string, DecorRecord> | null = null;

  constructor() {
    window.addEventListener("pagehide", () => this.flush());
    window.addEventListener("beforeunload", () => this.flush());
  }

  async load(): Promise<Record<string, DecorRecord>> {
    try {
      const raw = localStorage.getItem(DECOR_KEY);
      if (raw) return sanitizeDecorMap(JSON.parse(raw));
    } catch (_) {
      /* corrupt save -> empty */
    }
    return {};
  }

  save(decor: Record<string, DecorRecord>): void {
    this.pending = decor;
    if (this.timer != null) return;
    this.timer = window.setTimeout(() => this.flush(), DECOR_DEBOUNCE_MS);
  }

  flush(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return;
    try {
      localStorage.setItem(DECOR_KEY, JSON.stringify(this.pending));
    } catch (_) {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Meta (P5) — shipped totals + earned milestones + farm name/founded. The
// store persists DELTAS (addShipped / setMilestone / setInit) rather than the
// whole blob, so CloudMetaStore can use atomic Firestore increment() sentinels
// with no read-modify-write race. LocalMetaStore is a single-writer, so its
// increments are trivial plain read-add-write on a persisted blob.
// ---------------------------------------------------------------------------

export interface MetaStore {
  /** Current persisted meta (or null offline/unset). */
  load(): Promise<MetaState | null>;
  /** Atomically add per-id shipped deltas (cloud = increment() sentinels). */
  addShipped(deltas: Record<string, number>): void;
  /** Record a milestone as first-earned at `ts` (write-once by convention). */
  setMilestone(key: string, ts: number): void;
  /** Set farm name + foundedAt once (never overwrites an existing foundedAt). */
  setInit(farmName: string, foundedAt: number): void;
  flush?(): void;
}

const META_KEY = "fl_meta_v1";
const META_DEBOUNCE_MS = 400;

function localEmptyMeta(): MetaState {
  return { shipped: {}, milestones: {}, farmName: DEFAULT_FARM_NAME, foundedAt: 0 };
}

export function sanitizeMeta(raw: unknown): MetaState {
  const out = localEmptyMeta();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Partial<MetaState>;
  if (r.shipped && typeof r.shipped === "object") {
    for (const [k, v] of Object.entries(r.shipped as Record<string, unknown>)) {
      if (typeof v === "number" && isFinite(v) && v >= 0) out.shipped[k] = v;
    }
  }
  if (r.milestones && typeof r.milestones === "object") {
    for (const [k, v] of Object.entries(r.milestones as Record<string, unknown>)) {
      if (typeof v === "number" && isFinite(v) && v > 0) out.milestones[k] = v;
    }
  }
  if (typeof r.farmName === "string" && r.farmName.trim()) out.farmName = r.farmName.trim().slice(0, 40);
  if (typeof r.foundedAt === "number" && isFinite(r.foundedAt) && r.foundedAt > 0) out.foundedAt = r.foundedAt;
  return out;
}

export class LocalMetaStore implements MetaStore {
  private state: MetaState = localEmptyMeta();
  private timer: number | null = null;
  private loaded = false;

  constructor() {
    window.addEventListener("pagehide", () => this.flush());
    window.addEventListener("beforeunload", () => this.flush());
  }

  async load(): Promise<MetaState | null> {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (raw) this.state = sanitizeMeta(JSON.parse(raw));
    } catch (_) {
      /* corrupt -> empty */
    }
    this.loaded = true;
    return JSON.parse(JSON.stringify(this.state)) as MetaState;
  }

  addShipped(deltas: Record<string, number>): void {
    for (const [id, d] of Object.entries(deltas)) {
      if (!d) continue;
      this.state.shipped[id] = (this.state.shipped[id] ?? 0) + d;
    }
    this.queue();
  }

  setMilestone(key: string, ts: number): void {
    if (this.state.milestones[key]) return; // write-once
    this.state.milestones[key] = ts;
    this.queue();
  }

  setInit(farmName: string, foundedAt: number): void {
    let changed = false;
    if (!this.state.foundedAt) {
      this.state.foundedAt = foundedAt;
      changed = true;
    }
    if (farmName && this.state.farmName !== farmName) {
      this.state.farmName = farmName;
      changed = true;
    }
    if (changed) this.queue();
  }

  private queue(): void {
    if (!this.loaded) this.loaded = true;
    if (this.timer != null) return;
    this.timer = window.setTimeout(() => this.flush(), META_DEBOUNCE_MS);
  }

  flush(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      localStorage.setItem(META_KEY, JSON.stringify(this.state));
    } catch (_) {
      /* ignore */
    }
  }
}
