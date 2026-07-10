// ---------------------------------------------------------------------------
// Pure sync helpers for the P2 CloudFarmStore/CloudWorldStore — region/tile
// key math, wire (de)serialization, and the snapshot-diff function that
// decides which tiles actually changed. Deliberately FRAMEWORK-FREE (no
// firebase/three imports) so it's cheaply unit-testable, mirroring the
// world/worldData.ts "pure math, DOM-free" convention.
// ---------------------------------------------------------------------------
import { CROP_ORDER, type CropId } from "../farm/growth";
import { TOOL_ORDER, type ToolId } from "../farm/action";
import { defaultFarmState, type FarmState, type TileRecord } from "../farm/store";
import { STARTER_HERD, sanitizeAnimal, PRODUCE_ORDER, type AnimalRecord, type ProduceId } from "../farm/animals";
import { isDecorType, type DecorRecord } from "../world/decor";
import { defaultDoorState, type DoorState, type EggRecord } from "../farm/pasture";

/** Tiles are grouped into fixed regions so a doc stays far under Firestore's
 * 1MB cap even once the map grows well past today's 12x12 field (which fits
 * entirely inside region_0_0). */
export const REGION_SIZE = 16;

const TILE_KEY_RE = /^t_(-?\d+)_(-?\d+)$/;

export function parseTileKey(key: string): { gx: number; gz: number } | null {
  const m = TILE_KEY_RE.exec(key);
  if (!m) return null;
  return { gx: parseInt(m[1], 10), gz: parseInt(m[2], 10) };
}

/** Which region document a tile's field lives in. */
export function regionKeyForTile(gx: number, gz: number): string {
  const rx = Math.floor(gx / REGION_SIZE);
  const rz = Math.floor(gz / REGION_SIZE);
  return `region_${rx}_${rz}`;
}

export function regionKeyForTileKey(tileKey: string): string | null {
  const p = parseTileKey(tileKey);
  return p ? regionKeyForTile(p.gx, p.gz) : null;
}

/** Player doc id from a display name — Firestore doc ids reject "/", so
 * sanitize while staying human-readable (unlike goat/chore docs, this one is
 * looked up by name, not by opaque id). */
export function playerDocId(name: string): string {
  const clean = (name || "Farmer").trim().replace(/[/\s]+/g, "_").slice(0, 40);
  return `player_${clean || "Farmer"}`;
}

export function isRegionDocId(id: string): boolean {
  return /^region_-?\d+_-?\d+$/.test(id);
}
export function isPlayerDocId(id: string): boolean {
  return id.startsWith("player_");
}

// ---- tile record <-> wire ---------------------------------------------------

/** Firestore's JS SDK rejects `undefined` field values by default, so the
 * wire shape only ever includes defined keys. `{}` (tilled, no crop) is a
 * valid — and common — wire value. */
export function toWireTile(rec: TileRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (rec.crop) {
    out.crop = rec.crop;
    out.plantedAt = rec.plantedAt ?? 0;
    out.accruedMs = rec.accruedMs ?? 0;
    out.lastWatered = rec.lastWatered ?? rec.plantedAt ?? 0;
  }
  return out;
}

/** Defensive parse mirroring store.ts's sanitizeFarmState tile loop — a
 * malformed/foreign doc field can never brick the game. */
export function fromWireTile(raw: unknown): TileRecord {
  const rec: TileRecord = {};
  if (!raw || typeof raw !== "object") return rec;
  const v = raw as Partial<TileRecord>;
  if (v.crop && (CROP_ORDER as string[]).includes(v.crop)) {
    rec.crop = v.crop;
    rec.plantedAt = typeof v.plantedAt === "number" ? v.plantedAt : 0;
    rec.accruedMs = typeof v.accruedMs === "number" ? v.accruedMs : 0;
    rec.lastWatered = typeof v.lastWatered === "number" ? v.lastWatered : rec.plantedAt;
  }
  return rec;
}

/** Group changed tile keys by the region doc they belong to, wire-encoded and
 * ready to `setDoc(ref, patch, {merge:true})` per region — the "per-tile
 * field update" granularity from the plan. Invalid keys are skipped. */
export function groupTileWritesByRegion(
  tiles: Record<string, TileRecord>,
  changedKeys: Iterable<string>
): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const key of changedKeys) {
    const parsed = parseTileKey(key);
    if (!parsed) continue;
    const region = regionKeyForTile(parsed.gx, parsed.gz);
    let patch = out.get(region);
    if (!patch) {
      patch = {};
      out.set(region, patch);
    }
    patch[key] = toWireTile(tiles[key] ?? {});
  }
  return out;
}

/** PURE. Returns the set of tile keys whose record differs between two tile
 * maps (added, removed, or changed) — the snapshot-diff at the heart of both
 * write-batching (what do I need to send) and remote-apply (what do I need to
 * re-render). Absent === "untouched grass", so a key present in one map and
 * absent in the other counts as changed too. */
export function diffTiles(
  prev: Record<string, TileRecord>,
  next: Record<string, TileRecord>
): string[] {
  const changed: string[] = [];
  const keys = new Set<string>([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const a = prev[key];
    const b = next[key];
    if (tileEquals(a, b)) continue;
    changed.push(key);
  }
  return changed;
}

function tileEquals(a: TileRecord | undefined, b: TileRecord | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.crop === b.crop &&
    (a.plantedAt ?? 0) === (b.plantedAt ?? 0) &&
    (a.accruedMs ?? 0) === (b.accruedMs ?? 0) &&
    (a.lastWatered ?? 0) === (b.lastWatered ?? 0)
  );
}

// ---- player doc <-> wire -----------------------------------------------------

export interface PlayerWire {
  coins?: number;
  seeds?: Partial<Record<CropId, number>>;
  crops?: Partial<Record<CropId, number>>;
  produce?: Partial<Record<ProduceId, number>>;
  selectedCrop?: CropId;
  selectedTool?: ToolId;
  tank?: number;
  lastSeen?: number;
}

export function toWirePlayer(state: FarmState): PlayerWire {
  return {
    coins: state.coins,
    seeds: { ...state.seeds },
    crops: { ...state.crops },
    produce: { ...state.produce },
    selectedCrop: state.selectedCrop,
    selectedTool: state.selectedTool,
    tank: state.tank,
    lastSeen: Date.now(),
  };
}

/** Applies a wire player doc onto a base FarmState (mutating a copy), same
 * defensive-merge posture as sanitizeFarmState. */
export function applyWirePlayer(base: FarmState, raw: unknown): FarmState {
  const out: FarmState = {
    tiles: base.tiles,
    seeds: { ...base.seeds },
    crops: { ...base.crops },
    produce: { ...base.produce },
    coins: base.coins,
    selectedCrop: base.selectedCrop,
    selectedTool: base.selectedTool,
    tank: base.tank,
  };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as PlayerWire;
  if (typeof r.coins === "number" && isFinite(r.coins) && r.coins >= 0) out.coins = r.coins;
  for (const id of CROP_ORDER) {
    const s = r.seeds && r.seeds[id];
    const c = r.crops && r.crops[id];
    if (typeof s === "number" && isFinite(s) && s >= 0) out.seeds[id] = s;
    if (typeof c === "number" && isFinite(c) && c >= 0) out.crops[id] = c;
  }
  for (const id of PRODUCE_ORDER) {
    const p = r.produce && r.produce[id];
    if (typeof p === "number" && isFinite(p) && p >= 0) out.produce[id] = p;
  }
  if (r.selectedCrop && (CROP_ORDER as string[]).includes(r.selectedCrop)) out.selectedCrop = r.selectedCrop;
  if (r.selectedTool && (TOOL_ORDER as string[]).includes(r.selectedTool)) out.selectedTool = r.selectedTool;
  if (typeof r.tank === "number" && isFinite(r.tank) && r.tank >= 0) out.tank = Math.floor(r.tank);
  return out;
}

// ---- local-dirty merge (echo-during-debounce guard) --------------------------

/** The per-player fields the local device owns (everything in a player doc that
 * the game mutates). Snapshotted so a later mutation of the game's live
 * FarmState can't corrupt the protected copy. */
export interface LocalPlayerFields {
  coins: number;
  seeds: Record<CropId, number>;
  crops: Record<CropId, number>;
  produce: Record<ProduceId, number>;
  tank: number;
  selectedTool: ToolId;
  selectedCrop: CropId;
}

/** Copy the player-owned fields out of a FarmState (deep-copies the seed/crop
 * maps so the snapshot is immune to later in-place edits of `s`). */
export function extractPlayerFields(s: FarmState): LocalPlayerFields {
  return {
    coins: s.coins,
    seeds: { ...s.seeds },
    crops: { ...s.crops },
    produce: { ...s.produce },
    tank: s.tank,
    selectedTool: s.selectedTool,
    selectedCrop: s.selectedCrop,
  };
}

/**
 * PURE. Merge a freshly-rebuilt-from-Firestore FarmState with the local
 * device's still-pending own mutations. This is the echo-during-debounce
 * guard: while a local write is unflushed OR in-flight-unacknowledged, the
 * LOCAL values must win over whatever a snapshot echo currently shows.
 *
 * WHY: the region (tiles) doc and the player doc are SEPARATE Firestore
 * writes, debounced independently. A collection-wide onSnapshot echo can
 * arrive between them (a torn read — region committed, player not yet), or
 * simply reflect the pre-write server state during our own debounce window.
 * The old guard froze player fields to the last-SENT values, which are STALE
 * (pre-harvest) during the debounce — so an echo reverted the local player's
 * just-earned crops/coins, and the debounced write then persisted the reverted
 * value = real data loss. Protecting by "locally dirty since the mutation"
 * (values that WILL be written) instead of "last sent" fixes that class
 * entirely, for any write-ordering/debounce timing.
 *
 * SCOPE — deliberately narrow so nothing over-freezes:
 *  - `localPlayer` (non-null only while THIS device has an unflushed/in-flight
 *    player write) overrides only the player-owned fields. Other players'
 *    docs never feed these fields anyway (buildFarmStateFromDocs reads only
 *    OUR player doc), so remote players stay live.
 *  - `localTiles` overrides only the specific tile keys this device has dirty
 *    (unflushed/in-flight); every other tile — including tiles another player
 *    just changed — is taken live from `fresh`.
 *
 * SEMANTICS once a local write is acknowledged (no longer dirty): the guard
 * releases, so a genuine remote change to the SAME player doc from ANOTHER
 * device (the same choreUser signed in twice) is last-write-wins. That is the
 * documented trade-off; concurrent same-identity multi-device play is not a
 * supported scenario, and LWW-after-ack can never lose a local action.
 */
export function mergeLocalDirty(
  fresh: FarmState,
  localPlayer: LocalPlayerFields | null,
  localTiles: Record<string, TileRecord> | null
): FarmState {
  if (localPlayer) {
    fresh.coins = localPlayer.coins;
    fresh.seeds = { ...localPlayer.seeds };
    fresh.crops = { ...localPlayer.crops };
    fresh.produce = { ...localPlayer.produce };
    fresh.tank = localPlayer.tank;
    fresh.selectedTool = localPlayer.selectedTool;
    fresh.selectedCrop = localPlayer.selectedCrop;
  }
  if (localTiles) {
    for (const [k, rec] of Object.entries(localTiles)) fresh.tiles[k] = rec;
  }
  return fresh;
}

// ---- whole-collection -> FarmState -------------------------------------------

export interface RawDoc {
  id: string;
  data: unknown;
}

/** Rebuilds a full FarmState from a collection snapshot's docs: tiles merge
 * from every region_* doc (shared), and only the ONE player_<name> doc that
 * matches this device's identity feeds coins/inventory/tank/tool (personal).
 * Unknown/foreign docs (meta, world, other players) are ignored here. */
export function buildFarmStateFromDocs(docs: RawDoc[], myPlayerDocId: string): FarmState {
  let state = defaultFarmState();
  state.tiles = {};
  for (const d of docs) {
    if (isRegionDocId(d.id)) {
      const data = (d.data && typeof d.data === "object" ? d.data : {}) as Record<string, unknown>;
      for (const [key, val] of Object.entries(data)) {
        if (!TILE_KEY_RE.test(key)) continue;
        state.tiles[key] = fromWireTile(val);
      }
    } else if (d.id === myPlayerDocId) {
      state = applyWirePlayer(state, d.data);
    }
  }
  return state;
}

// ---- animals (P4) — one shared doc, reuses the SAME collection listener -----
// The whole herd lives in ONE doc (`animals`), field-per-animal (`a_<id>`),
// so P4 needs zero new Firestore listeners (FarmlifeSession already watches
// the whole farmlife_<familyKey> collection for CloudFarmStore/CloudWorldStore
// — this doc just rides along). Write granularity is per-animal field paths,
// same "two kids editing different things never conflict" posture as tiles.

export const ANIMALS_DOC_ID = "animals";

export function animalWireKey(id: string): string {
  return `a_${id}`;
}

/** Firestore rejects `undefined` fields, so only defined keys are written. */
export function toWireAnimal(a: AnimalRecord): Record<string, unknown> {
  return { bornAt: a.bornAt, lastFed: a.lastFed, accruedMs: a.accruedMs, lastPet: a.lastPet, name: a.name };
}

/** Rebuilds the herd from the collection snapshot's `animals` doc. Returns
 * null if that doc doesn't exist yet (distinct from an empty herd — the
 * migration/first-seed gate cares about this distinction). */
export function buildHerdFromDocs(docs: RawDoc[], fallbackNow: number): Record<string, AnimalRecord> | null {
  const doc = docs.find((d) => d.id === ANIMALS_DOC_ID);
  if (!doc) return null;
  const data = doc.data && typeof doc.data === "object" ? (doc.data as Record<string, unknown>) : {};
  const herd: Record<string, AnimalRecord> = {};
  for (const spec of STARTER_HERD) {
    const key = animalWireKey(spec.id);
    if (key in data) {
      const a = sanitizeAnimal(spec.id, data[key], fallbackNow);
      if (a) herd[spec.id] = a;
    }
  }
  return herd;
}

/** True if the `animals` doc is absent or has no animal fields yet — the
 * one-time-seed gate (herd-dup-hardening: only an empty/absent doc, seen via
 * a server-confirmed snapshot, may ever be seeded). */
export function animalsDocIsEmpty(docs: RawDoc[]): boolean {
  const doc = docs.find((d) => d.id === ANIMALS_DOC_ID);
  if (!doc) return true;
  const data = doc.data as Record<string, unknown> | null | undefined;
  if (!data) return true;
  return !STARTER_HERD.some((s) => animalWireKey(s.id) in data);
}

/** PURE. Which animal ids differ (added/removed/changed) between two herds —
 * mirrors diffTiles's role for write-batching + remote-apply granularity. */
export function diffAnimals(prev: Record<string, AnimalRecord>, next: Record<string, AnimalRecord>): string[] {
  const changed: string[] = [];
  const ids = new Set<string>([...Object.keys(prev), ...Object.keys(next)]);
  for (const id of ids) {
    const a = prev[id], b = next[id];
    if (a === b) continue;
    if (a && b && a.bornAt === b.bornAt && a.lastFed === b.lastFed && a.accruedMs === b.accruedMs && a.lastPet === b.lastPet && a.name === b.name) continue;
    changed.push(id);
  }
  return changed;
}

// ---- decorations (P5) — one shared `decor` doc, field-per-item -------------
// Rides the SAME collection listener as tiles/animals (zero new Firestore
// reads). Field key = the record's own client-generated `d_<…>` id, so two
// kids placing different ornaments never conflict. Decor starts EMPTY (no seed
// step, unlike animals) — an absent/empty doc is a normal state, `{}`.

export const DECOR_DOC_ID = "decor";
const DECOR_KEY_RE = /^d_[a-z0-9]+$/i;

/** The Firestore field key for a decoration — its id already carries the `d_`
 * prefix, so the key IS the id. */
export function decorWireKey(id: string): string {
  return id;
}

/** Firestore rejects `undefined`, so only defined keys ship. The id is the
 * field key, so it isn't duplicated into the value. */
export function toWireDecor(d: DecorRecord): Record<string, unknown> {
  return { type: d.type, x: d.x, z: d.z, rotY: d.rotY, placedBy: d.placedBy, placedAt: d.placedAt };
}

/** Defensive parse of one decor field value into a full record (id supplied by
 * the caller from the field key). Returns null for a garbage/unknown-type value
 * so a corrupt field can never brick placement. */
export function sanitizeDecor(id: string, raw: unknown): DecorRecord | null {
  if (!DECOR_KEY_RE.test(id) || !raw || typeof raw !== "object") return null;
  const r = raw as Partial<DecorRecord>;
  if (typeof r.type !== "string" || !isDecorType(r.type)) return null;
  const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
  return {
    id,
    type: r.type,
    x: num(r.x, 0),
    z: num(r.z, 0),
    rotY: num(r.rotY, 0),
    placedBy: typeof r.placedBy === "string" ? r.placedBy.slice(0, 40) : "",
    placedAt: num(r.placedAt, 0),
  };
}

/** Rebuild the placed-decor map from the collection snapshot's `decor` doc.
 * Returns `{}` if the doc is absent/empty (a normal state — decor starts empty). */
export function buildDecorFromDocs(docs: RawDoc[]): Record<string, DecorRecord> {
  const out: Record<string, DecorRecord> = {};
  const doc = docs.find((d) => d.id === DECOR_DOC_ID);
  if (!doc) return out;
  const data = doc.data && typeof doc.data === "object" ? (doc.data as Record<string, unknown>) : {};
  for (const [key, val] of Object.entries(data)) {
    if (!DECOR_KEY_RE.test(key)) continue;
    const rec = sanitizeDecor(key, val);
    if (rec) out[key] = rec;
  }
  return out;
}

/** PURE. Which decor ids differ (added/removed/changed) between two maps —
 * mirrors diffTiles/diffAnimals for write-batching + remote-apply granularity. */
export function diffDecor(prev: Record<string, DecorRecord>, next: Record<string, DecorRecord>): string[] {
  const changed: string[] = [];
  const ids = new Set<string>([...Object.keys(prev), ...Object.keys(next)]);
  for (const id of ids) {
    const a = prev[id];
    const b = next[id];
    if (a === b) continue;
    if (a && b && a.type === b.type && a.x === b.x && a.z === b.z && a.rotY === b.rotY) continue;
    changed.push(id);
  }
  return changed;
}

// ---- barn (husbandry rework) — one shared `barn` doc: door + physical eggs --
// Rides the SAME collection listener as tiles/animals/decor (zero new Firestore
// reads). Holds ONE `door` field ({open,at}) plus a field per PHYSICAL egg
// (`e_<chickenId>_<cycleMs>`). Egg ids are deterministic per produce cycle, so
// a re-spawn writes the SAME key with merge (never a duplicate). Collecting an
// egg sets `collectedBy` on its field — Firestore last-write-wins picks ONE
// surviving collector; everyone else reconciles to loser on the echo.

export const BARN_DOC_ID = "barn";
const EGG_KEY_RE = /^e_[a-z0-9]+_-?\d+$/i;

export function toWireDoor(d: DoorState): Record<string, unknown> {
  return { open: !!d.open, at: d.at || 0 };
}

/** Read the door state from the collection snapshot's `barn` doc (default
 * closed if absent/garbage). */
export function buildDoorFromDocs(docs: RawDoc[]): DoorState {
  const doc = docs.find((d) => d.id === BARN_DOC_ID);
  const data = doc && doc.data && typeof doc.data === "object" ? (doc.data as Record<string, unknown>) : null;
  const raw = data ? (data.door as Record<string, unknown> | undefined) : undefined;
  if (!raw || typeof raw !== "object") return defaultDoorState();
  const open = (raw as { open?: unknown }).open === true;
  const atV = (raw as { at?: unknown }).at;
  const at = typeof atV === "number" && isFinite(atV) ? atV : 0;
  return { open, at };
}

export function eggWireKey(id: string): string {
  return id; // the id already carries the `e_` prefix
}

export function toWireEgg(e: EggRecord): Record<string, unknown> {
  const out: Record<string, unknown> = { chickenId: e.chickenId, spawnedAt: e.spawnedAt, x: e.x, z: e.z };
  if (e.collectedBy) out.collectedBy = e.collectedBy;
  if (e.collectedAt) out.collectedAt = e.collectedAt;
  return out;
}

export function sanitizeEgg(id: string, raw: unknown): EggRecord | null {
  if (!EGG_KEY_RE.test(id) || !raw || typeof raw !== "object") return null;
  const r = raw as Partial<EggRecord>;
  const num = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
  const cid = typeof r.chickenId === "string" ? r.chickenId.slice(0, 24) : "";
  if (!cid) return null;
  const rec: EggRecord = { id, chickenId: cid, spawnedAt: num(r.spawnedAt, 0), x: num(r.x, 0), z: num(r.z, 0) };
  if (typeof r.collectedBy === "string" && r.collectedBy.trim()) rec.collectedBy = r.collectedBy.slice(0, 40);
  if (typeof r.collectedAt === "number" && isFinite(r.collectedAt)) rec.collectedAt = r.collectedAt;
  return rec;
}

/** Rebuild the egg map (INCLUDING collected ones — the collectedBy marker is
 * how the loser-reconcile + no-respawn guard work) from the `barn` doc. */
export function buildEggsFromDocs(docs: RawDoc[]): Record<string, EggRecord> {
  const out: Record<string, EggRecord> = {};
  const doc = docs.find((d) => d.id === BARN_DOC_ID);
  if (!doc || !doc.data || typeof doc.data !== "object") return out;
  for (const [key, val] of Object.entries(doc.data as Record<string, unknown>)) {
    if (!EGG_KEY_RE.test(key)) continue;
    const rec = sanitizeEgg(key, val);
    if (rec) out[key] = rec;
  }
  return out;
}

/** PURE. Egg ids whose record differs (added / newly-collected / changed). */
export function diffEggs(prev: Record<string, EggRecord>, next: Record<string, EggRecord>): string[] {
  const changed: string[] = [];
  const ids = new Set<string>([...Object.keys(prev), ...Object.keys(next)]);
  for (const id of ids) {
    const a = prev[id], b = next[id];
    if (a === b) continue;
    if (a && b && a.x === b.x && a.z === b.z && (a.collectedBy ?? "") === (b.collectedBy ?? "")) continue;
    changed.push(id);
  }
  return changed;
}

// ---- meta (P5) — one shared `meta` doc: shipped totals + milestones ---------
// Shipped totals use Firestore increment() sentinels at the store layer (see
// cloudStore.ts) so concurrent sells never race. This module only reads the doc
// and defines its shape.

export const META_DOC_ID = "meta";
export const DEFAULT_FARM_NAME = "Amen Acres";

export interface MetaState {
  shipped: Record<string, number>; // shipped_<cropOrProduceId> running totals
  milestones: Record<string, number>; // milestone_<key> -> first-earned ms
  farmName: string;
  foundedAt: number; // ms, set once
}

export function emptyMetaState(): MetaState {
  return { shipped: {}, milestones: {}, farmName: DEFAULT_FARM_NAME, foundedAt: 0 };
}

/** Rebuild MetaState from the collection snapshot's `meta` doc (or empty). */
export function buildMetaFromDocs(docs: RawDoc[]): MetaState {
  const out = emptyMetaState();
  const doc = docs.find((d) => d.id === META_DOC_ID);
  if (!doc || !doc.data || typeof doc.data !== "object") return out;
  const data = doc.data as Record<string, unknown>;
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith("shipped_")) {
      if (typeof v === "number" && isFinite(v) && v >= 0) out.shipped[k.slice("shipped_".length)] = v;
    } else if (k.startsWith("milestone_")) {
      if (typeof v === "number" && isFinite(v) && v > 0) out.milestones[k.slice("milestone_".length)] = v;
    } else if (k === "farmName") {
      if (typeof v === "string" && v.trim()) out.farmName = v.trim().slice(0, 40);
    } else if (k === "foundedAt") {
      if (typeof v === "number" && isFinite(v) && v > 0) out.foundedAt = v;
    }
  }
  return out;
}

/** True if the collection has no farm content at all yet (no tiles in any
 * region doc, no player docs) — the migration gate: only an empty server may
 * be one-time-seeded from a device's local save. */
export function collectionIsEmpty(docs: RawDoc[]): boolean {
  for (const d of docs) {
    if (isRegionDocId(d.id)) {
      const data = d.data as Record<string, unknown> | null | undefined;
      if (data && Object.keys(data).some((k) => TILE_KEY_RE.test(k))) return false;
    } else if (isPlayerDocId(d.id)) {
      return false;
    }
  }
  return true;
}
