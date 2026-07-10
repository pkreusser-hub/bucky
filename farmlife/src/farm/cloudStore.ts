// ---------------------------------------------------------------------------
// CloudFarmStore — Firestore-backed FarmStore (P2). Implements the SAME
// FarmStore interface every game/editor caller already uses, plus the
// LiveFarmStore extension (subscribe + ready) main.ts wires when present.
// Shares one FarmlifeSession (net/session.ts) with CloudWorldStore.
//
// WRITE GRANULARITY: tiles are diffed against the last-sent snapshot and
// batched by region doc (net/sync.ts groupTileWritesByRegion), debounced
// TILE_DEBOUNCE_MS per action burst. Player fields (coins/inventory/tank/
// tool/selectedCrop) are diffed separately and debounced PLAYER_DEBOUNCE_MS.
// Both diffs are computed against a "last sent" baseline that starts at
// whatever `load()` returned — so a boot that changes nothing (no local
// content, empty server) produces ZERO writes, satisfying the "don't dump an
// empty farm onto app open" half of the herd-dup hardening.
//
// LOOP PREVENTION: subscribe() delivers the FULL remote FarmState on every
// server-confirmed change; the caller (main.ts) diffs it against its OWN
// current in-memory state (which it already updated optimistically before
// calling save()), so an echo of our own write produces zero visual re-sync.
// ---------------------------------------------------------------------------
import { increment } from "firebase/firestore";
import { FarmlifeSession } from "../net/session";
import {
  buildFarmStateFromDocs,
  collectionIsEmpty,
  diffTiles,
  extractPlayerFields,
  groupTileWritesByRegion,
  mergeLocalDirty,
  playerDocId,
  toWirePlayer,
  ANIMALS_DOC_ID,
  animalWireKey,
  animalsDocIsEmpty,
  buildHerdFromDocs,
  diffAnimals,
  toWireAnimal,
  DECOR_DOC_ID,
  decorWireKey,
  toWireDecor,
  buildDecorFromDocs,
  diffDecor,
  BARN_DOC_ID,
  toWireDoor,
  buildDoorFromDocs,
  eggWireKey,
  toWireEgg,
  buildEggsFromDocs,
  META_DOC_ID,
  buildMetaFromDocs,
  type LocalPlayerFields,
  type MetaState,
} from "../net/sync";
import { currentPlayerName } from "../net/firebase";
import { defaultFarmState, type FarmState, type FarmStore, type TileRecord, type AnimalStore, type DecorStore, type MetaStore, type BarnStore, type BarnData } from "./store";
import { CROP_ORDER } from "./growth";
import { starterHerd, type AnimalRecord } from "./animals";
import type { DecorRecord } from "../world/decor";
import type { DoorState, EggRecord } from "./pasture";

export interface LiveFarmStore extends FarmStore {
  /** Called with the full remote FarmState on every server-confirmed change
   * seen AFTER the store's initial load(). Returns an unsubscribe fn. */
  subscribe(onRemoteChange: (state: FarmState) => void): () => void;
  /** Resolves true once a server-confirmed (non-fromCache) snapshot has been
   * seen, false if Firestore is unreachable/blocked (caller should fall back
   * to LocalFarmStore). */
  readonly ready: Promise<boolean>;
  readonly playerName: string;
}

const TILE_DEBOUNCE_MS = 400;
const PLAYER_DEBOUNCE_MS = 1000;

export class CloudFarmStore implements LiveFarmStore {
  readonly ready: Promise<boolean>;
  readonly playerName: string;
  private readonly myDocId: string;
  private session: FarmlifeSession;
  private latestState: FarmState = defaultFarmState();
  private lastSentTiles: Record<string, TileRecord> = {};
  private lastSentPlayerSig: string | null = null;
  private pendingTiles: Record<string, TileRecord> = {};
  private tileTimer: number | null = null;
  private pendingPlayerState: FarmState | null = null;
  private playerTimer: number | null = null;
  private inFlightPlayerWrites = 0;
  // Local-dirty guard state (see mergeLocalDirty in net/sync.ts). While the
  // local device has an unflushed OR in-flight-unacknowledged mutation, these
  // hold the values that WILL be written, so a snapshot echo can never revert
  // them. `localPlayer` is non-null only while a player write is pending;
  // `dirtyTiles` maps each dirty tile key to its intended record (kept until
  // that key's write is acknowledged, unless a newer save superseded it).
  private localPlayer: LocalPlayerFields | null = null;
  private dirtyTiles: Record<string, TileRecord> = {};

  constructor(session: FarmlifeSession, playerName?: string) {
    this.session = session;
    this.playerName = playerName || currentPlayerName();
    this.myDocId = playerDocId(this.playerName);
    this.ready = session.ready;
  }

  /** True once `ready` (call after awaiting it) if the family's farmlife
   * collection has no farm content yet — the migration gate. */
  isEmptyOnServer(): boolean {
    return collectionIsEmpty(this.session.docs());
  }

  /** True while this device has an unflushed OR in-flight-unacknowledged
   * player write — `pendingPlayerState`/`playerTimer` cover the debounce
   * window, `inFlightPlayerWrites` covers the network round-trip, so coverage
   * is continuous from the mutation until the write lands. */
  private isPlayerDirty(): boolean {
    return this.pendingPlayerState != null || this.playerTimer != null || this.inFlightPlayerWrites > 0;
  }

  /**
   * ECHO-DURING-DEBOUNCE GUARD (see mergeLocalDirty in net/sync.ts for the full
   * rationale): the region (tiles) doc and the player doc are two SEPARATE,
   * independently-debounced Firestore writes, so a collection-wide onSnapshot
   * echo can arrive between them (torn read) or simply reflect the pre-write
   * server state during our own debounce. We must NOT let such an echo revert
   * the local player's own just-made changes — the previous guard froze player
   * fields to the last-SENT (stale, pre-harvest) values, which then got
   * RE-SENT, permanently clobbering the correct value (real data loss).
   *
   * Now the guard protects the values that WILL be written (locally dirty)
   * instead: `localPlayer` while a player write is pending/in-flight, and each
   * key in `dirtyTiles` while its tile write is pending/in-flight. Everything
   * else — other players' tiles, other players' docs — is taken live from the
   * fresh snapshot. Once a write is acknowledged the protection releases, so a
   * genuine remote change from another device is last-write-wins.
   */
  private buildLatest(): FarmState {
    const fresh = buildFarmStateFromDocs(this.session.docs(), this.myDocId);
    const dirtyTileKeys = Object.keys(this.dirtyTiles);
    return mergeLocalDirty(
      fresh,
      this.isPlayerDirty() ? this.localPlayer : null,
      dirtyTileKeys.length ? this.dirtyTiles : null
    );
  }

  async load(): Promise<FarmState | null> {
    await this.ready;
    if (this.session.offline) return null;
    this.latestState = this.buildLatest();
    this.markSentBaseline(this.latestState);
    return this.latestState;
  }

  private markSentBaseline(state: FarmState): void {
    this.lastSentTiles = { ...state.tiles };
    this.lastSentPlayerSig = JSON.stringify(toWirePlayer(state));
  }

  /** One-time upload of a device's pre-P2 local save, ONLY when the server
   * farm is confirmed empty (call after `ready` resolves true). No-ops (and
   * writes nothing) if there is no meaningful local content, so an empty
   * local + empty server boot never touches Firestore. */
  async migrateFromLocal(local: FarmState | null): Promise<boolean> {
    if (this.session.offline || !local) return false;
    if (!this.isEmptyOnServer()) return false;
    const hasTiles = Object.keys(local.tiles).length > 0;
    const def = defaultFarmState();
    const hasProgress =
      hasTiles ||
      local.coins !== def.coins ||
      local.tank !== def.tank ||
      CROP_ORDER.some((id) => local.crops[id] !== def.crops[id] || local.seeds[id] !== def.seeds[id]);
    if (!hasProgress) return false;

    const groups = groupTileWritesByRegion(local.tiles, Object.keys(local.tiles));
    for (const [region, patch] of groups) {
      await this.session.write(region, patch);
    }
    await this.session.write(this.myDocId, toWirePlayer(local) as unknown as Record<string, unknown>);
    this.latestState = local;
    this.markSentBaseline(local);
    return true;
  }

  save(state: FarmState): void {
    if (this.session.offline) return;

    const changedTiles = diffTiles(this.lastSentTiles, state.tiles);
    if (changedTiles.length) {
      for (const k of changedTiles) {
        // Snapshot the intended record (bare {} for a harvested/tilled tile)
        // so a later in-place edit of state.tiles can't corrupt the protected
        // copy; protect the key until its write is acknowledged.
        const rec = state.tiles[k] ? { ...state.tiles[k] } : {};
        this.pendingTiles[k] = rec;
        this.dirtyTiles[k] = rec;
      }
      if (this.tileTimer == null) {
        this.tileTimer = window.setTimeout(() => this.flushTiles(), TILE_DEBOUNCE_MS);
      }
    }

    const sig = JSON.stringify(toWirePlayer(state));
    if (sig !== this.lastSentPlayerSig) {
      this.pendingPlayerState = state;
      // Protect the values the local player intends to write from now until the
      // write is acknowledged. Snapshot (deep-copies seed/crop maps) so an echo
      // reverting the live game state can't corrupt what we'll send.
      this.localPlayer = extractPlayerFields(state);
      if (this.playerTimer == null) {
        this.playerTimer = window.setTimeout(() => this.flushPlayer(), PLAYER_DEBOUNCE_MS);
      }
    }
  }

  private flushTiles(): Promise<void> {
    this.tileTimer = null;
    const pending = this.pendingTiles;
    this.pendingTiles = {};
    const keys = Object.keys(pending);
    if (!keys.length) return Promise.resolve();
    const groups = groupTileWritesByRegion(pending, keys);
    const writes: Promise<void>[] = [];
    for (const [region, patch] of groups) writes.push(this.session.write(region, patch));
    for (const k of keys) this.lastSentTiles[k] = pending[k];
    return Promise.all(writes).then(() => {
      // Write acknowledged: release protection for these tiles UNLESS a newer
      // save re-dirtied the key with a different record (reference inequality
      // means superseded — keep protecting the newer intended value).
      for (const k of keys) {
        if (this.dirtyTiles[k] === pending[k]) delete this.dirtyTiles[k];
      }
    });
  }

  private flushPlayer(): Promise<void> {
    this.playerTimer = null;
    const state = this.pendingPlayerState;
    this.pendingPlayerState = null;
    if (!state) return Promise.resolve();
    this.lastSentPlayerSig = JSON.stringify(toWirePlayer(state));
    // The values we're about to commit; buildLatest() keeps protecting these
    // (via localPlayer) while the write is in flight so an echo can't revert
    // them. `sent` identity lets the ack release protection only if no newer
    // save superseded it.
    const sent = extractPlayerFields(state);
    this.localPlayer = sent;
    this.inFlightPlayerWrites++;
    return this.session
      .write(this.myDocId, toWirePlayer(state) as unknown as Record<string, unknown>)
      .finally(() => {
        this.inFlightPlayerWrites--;
        // Release protection once fully quiescent AND still on the values we
        // sent (a newer save() would have replaced localPlayer — keep it).
        if (this.localPlayer === sent && !this.isPlayerDirty()) this.localPlayer = null;
      });
  }

  /** Immediate flush of any debounced writes, AWAITED (pagehide / test hook —
   * satisfies the optional `FarmStore.flush()` even though it returns a value:
   * TS treats any return type as assignable where `void` is expected). */
  flush(): Promise<void> {
    const writes: Promise<void>[] = [];
    if (this.tileTimer != null) {
      clearTimeout(this.tileTimer);
      writes.push(this.flushTiles());
    }
    if (this.playerTimer != null) {
      clearTimeout(this.playerTimer);
      writes.push(this.flushPlayer());
    }
    return Promise.all(writes).then(() => {});
  }

  subscribe(onRemoteChange: (state: FarmState) => void): () => void {
    return this.session.onChange(() => {
      this.latestState = this.buildLatest();
      onRemoteChange(this.latestState);
    });
  }
}

// ---------------------------------------------------------------------------
// CloudAnimalStore (P4) — same debounced-per-field-write + local-dirty-guard
// shape as CloudFarmStore's tile handling, but for the single `animals` doc
// (field-per-animal, `a_<id>`). Rides the SAME FarmlifeSession/collection
// listener — zero new Firestore reads. First-creation of the starter herd is
// gated exactly like the herd-dup hardening requires: only once a
// server-confirmed snapshot shows the `animals` doc absent/empty.
// ---------------------------------------------------------------------------
export interface LiveAnimalStore extends AnimalStore {
  subscribe(onRemoteChange: (herd: Record<string, AnimalRecord>) => void): () => void;
  readonly ready: Promise<boolean>;
}

const ANIMAL_DEBOUNCE_MS = 400;

export class CloudAnimalStore implements LiveAnimalStore {
  readonly ready: Promise<boolean>;
  private session: FarmlifeSession;
  private lastSent: Record<string, AnimalRecord> = {};
  private pending: Record<string, AnimalRecord> = {};
  private timer: number | null = null;
  private dirty: Record<string, AnimalRecord> = {};

  constructor(session: FarmlifeSession) {
    this.session = session;
    this.ready = session.ready;
  }

  private buildLatest(now: number): Record<string, AnimalRecord> | null {
    const fresh = buildHerdFromDocs(this.session.docs(), now);
    if (!fresh) return null;
    for (const [id, rec] of Object.entries(this.dirty)) fresh[id] = rec;
    return fresh;
  }

  /** True once `ready` resolves — the animals doc has no herd fields yet
   * (herd-dup migration gate, mirrors CloudFarmStore.isEmptyOnServer). */
  isEmptyOnServer(): boolean {
    return animalsDocIsEmpty(this.session.docs());
  }

  /** Loads the existing herd, or null if the doc doesn't exist yet (caller
   * decides whether to seed — never auto-seeds here). */
  async load(): Promise<Record<string, AnimalRecord> | null> {
    await this.ready;
    if (this.session.offline) return null;
    const herd = this.buildLatest(Date.now());
    if (herd) this.lastSent = { ...herd };
    return herd;
  }

  /** One-time starter-herd seed, ONLY when the server's animals doc is
   * confirmed empty/absent (call after `ready` resolves true). */
  async seedIfEmpty(now: number): Promise<Record<string, AnimalRecord> | null> {
    if (this.session.offline) return null;
    if (!this.isEmptyOnServer()) return null;
    const herd = starterHerd(now);
    const patch: Record<string, unknown> = {};
    for (const [id, a] of Object.entries(herd)) patch[animalWireKey(id)] = toWireAnimal(a);
    await this.session.write(ANIMALS_DOC_ID, patch);
    this.lastSent = { ...herd };
    return herd;
  }

  save(herd: Record<string, AnimalRecord>): void {
    if (this.session.offline) return;
    const changed = diffAnimals(this.lastSent, herd);
    if (!changed.length) return;
    for (const id of changed) {
      const rec = { ...herd[id] };
      this.pending[id] = rec;
      this.dirty[id] = rec;
    }
    if (this.timer == null) {
      this.timer = window.setTimeout(() => this.doFlush(), ANIMAL_DEBOUNCE_MS);
    }
  }

  private doFlush(): Promise<void> {
    this.timer = null;
    const pending = this.pending;
    this.pending = {};
    const ids = Object.keys(pending);
    if (!ids.length) return Promise.resolve();
    const patch: Record<string, unknown> = {};
    for (const id of ids) patch[animalWireKey(id)] = toWireAnimal(pending[id]);
    for (const id of ids) this.lastSent[id] = pending[id];
    return this.session.write(ANIMALS_DOC_ID, patch).then(() => {
      for (const id of ids) {
        if (this.dirty[id] === pending[id]) delete this.dirty[id];
      }
    });
  }

  flush(): Promise<void> {
    if (this.timer == null) return Promise.resolve();
    clearTimeout(this.timer);
    return this.doFlush();
  }

  subscribe(onRemoteChange: (herd: Record<string, AnimalRecord>) => void): () => void {
    return this.session.onChange(() => {
      const herd = this.buildLatest(Date.now());
      if (herd) onRemoteChange(herd);
    });
  }
}

// ---------------------------------------------------------------------------
// CloudDecorStore (P5) — same debounced-per-field-write + local-dirty-guard
// shape as CloudAnimalStore, for the shared `decor` doc (field-per-item,
// `d_<id>`). Rides the SAME FarmlifeSession/collection listener. A removed
// decoration writes `deleteField()`... but Firestore's `setDoc(merge)` can't
// delete via a plain patch, so removals write a tombstone-free approach: we
// send the field set to `deleteField()` sentinel. Decor starts empty; no seed.
// ---------------------------------------------------------------------------
export interface LiveDecorStore extends DecorStore {
  subscribe(onRemoteChange: (decor: Record<string, DecorRecord>) => void): () => void;
  readonly ready: Promise<boolean>;
}

const DECOR_DEBOUNCE_MS = 400;

export class CloudDecorStore implements LiveDecorStore {
  readonly ready: Promise<boolean>;
  private session: FarmlifeSession;
  private lastSent: Record<string, DecorRecord> = {};
  private pending: Record<string, DecorRecord | null> = {}; // null = removed
  private timer: number | null = null;
  private dirty: Record<string, DecorRecord | null> = {};

  constructor(session: FarmlifeSession) {
    this.session = session;
    this.ready = session.ready;
  }

  private buildLatest(): Record<string, DecorRecord> {
    const fresh = buildDecorFromDocs(this.session.docs());
    // apply local-dirty overrides (adds win; removals delete) so an echo can't
    // resurrect a just-removed piece or drop a just-placed one.
    for (const [id, rec] of Object.entries(this.dirty)) {
      if (rec === null) delete fresh[id];
      else fresh[id] = rec;
    }
    return fresh;
  }

  async load(): Promise<Record<string, DecorRecord>> {
    await this.ready;
    if (this.session.offline) return {};
    const decor = this.buildLatest();
    this.lastSent = { ...decor };
    return decor;
  }

  save(decor: Record<string, DecorRecord>): void {
    if (this.session.offline) return;
    const changed = diffDecor(this.lastSent, decor);
    if (!changed.length) return;
    for (const id of changed) {
      const rec = decor[id] ? { ...decor[id] } : null; // absent => removed
      this.pending[id] = rec;
      this.dirty[id] = rec;
    }
    if (this.timer == null) {
      this.timer = window.setTimeout(() => this.doFlush(), DECOR_DEBOUNCE_MS);
    }
  }

  private doFlush(): Promise<void> {
    this.timer = null;
    const pending = this.pending;
    this.pending = {};
    const ids = Object.keys(pending);
    if (!ids.length) return Promise.resolve();
    const patch: Record<string, unknown> = {};
    for (const id of ids) {
      const rec = pending[id];
      // Removal: overwrite the whole `decor` doc field to an empty marker is
      // wrong; instead set the field to null. buildDecorFromDocs already skips
      // non-record values, so a null field reads as "absent" everywhere.
      patch[decorWireKey(id)] = rec ? toWireDecor(rec) : null;
      if (rec) this.lastSent[id] = rec;
      else delete this.lastSent[id];
    }
    return this.session.write(DECOR_DOC_ID, patch).then(() => {
      for (const id of ids) {
        if (this.dirty[id] === pending[id]) delete this.dirty[id];
      }
    });
  }

  flush(): Promise<void> {
    if (this.timer == null) return Promise.resolve();
    clearTimeout(this.timer);
    return this.doFlush();
  }

  subscribe(onRemoteChange: (decor: Record<string, DecorRecord>) => void): () => void {
    return this.session.onChange(() => onRemoteChange(this.buildLatest()));
  }
}

// ---------------------------------------------------------------------------
// CloudBarnStore (husbandry rework) — the shared `barn` doc: door state (one
// `door` field) + physical eggs (field-per-egg). Same debounced-per-field-write
// + local-dirty-guard shape as CloudDecorStore. Rides the SAME session listener.
// Egg spawns use deterministic ids so a re-spawn merges the same field (no dup);
// collect writes `collectedBy` (Firestore LWW picks the one surviving collector).
// ---------------------------------------------------------------------------
export interface LiveBarnStore extends BarnStore {
  subscribe(onRemoteChange: (data: BarnData) => void): () => void;
  readonly ready: Promise<boolean>;
}

const BARN_DEBOUNCE_MS = 350;

export class CloudBarnStore implements LiveBarnStore {
  readonly ready: Promise<boolean>;
  private session: FarmlifeSession;
  private pendingDoor: DoorState | null = null;
  private pendingEggs: Record<string, EggRecord> = {};
  private timer: number | null = null;
  private dirtyDoor: DoorState | null = null;
  private dirtyEggs: Record<string, EggRecord> = {};
  private sub: ((d: BarnData) => void) | null = null;

  constructor(session: FarmlifeSession) {
    this.session = session;
    this.ready = session.ready;
  }

  private buildLatest(): BarnData {
    const door = this.dirtyDoor ?? buildDoorFromDocs(this.session.docs());
    const eggs = buildEggsFromDocs(this.session.docs());
    for (const [id, rec] of Object.entries(this.dirtyEggs)) eggs[id] = rec;
    return { door, eggs };
  }

  async load(): Promise<BarnData> {
    await this.ready;
    if (this.session.offline) return { door: { open: false, at: 0 }, eggs: {} };
    return this.buildLatest();
  }

  setDoor(d: DoorState): void {
    if (this.session.offline) return;
    const door = { open: !!d.open, at: d.at || 0 };
    this.pendingDoor = door;
    this.dirtyDoor = door;
    this.arm();
  }

  putEgg(e: EggRecord): void {
    if (this.session.offline) return;
    const rec = { ...e };
    this.pendingEggs[e.id] = rec;
    this.dirtyEggs[e.id] = rec;
    this.arm();
  }

  private arm(): void {
    if (this.timer == null) this.timer = window.setTimeout(() => this.doFlush(), BARN_DEBOUNCE_MS);
  }

  private doFlush(): Promise<void> {
    this.timer = null;
    const door = this.pendingDoor;
    const eggs = this.pendingEggs;
    this.pendingDoor = null;
    this.pendingEggs = {};
    const patch: Record<string, unknown> = {};
    if (door) patch.door = toWireDoor(door);
    for (const [id, rec] of Object.entries(eggs)) patch[eggWireKey(id)] = toWireEgg(rec);
    if (!Object.keys(patch).length) return Promise.resolve();
    return this.session.write(BARN_DOC_ID, patch).then(() => {
      if (door && this.dirtyDoor === door) this.dirtyDoor = null;
      for (const [id, rec] of Object.entries(eggs)) {
        if (this.dirtyEggs[id] === rec) delete this.dirtyEggs[id];
      }
      // RE-EVALUATE after our own write acks + the dirty guard releases: this is
      // how the loser of an egg-collect race finally sees the surviving winner
      // (a losing write's echo arrived while we were still dirty, so it was
      // suppressed; no NEW snapshot follows, so without this the loser would
      // never reconcile). buildLatest now reflects the fresh server value.
      this.sub?.(this.buildLatest());
    });
  }

  flush(): Promise<void> {
    if (this.timer == null) return Promise.resolve();
    clearTimeout(this.timer);
    return this.doFlush();
  }

  subscribe(onRemoteChange: (data: BarnData) => void): () => void {
    this.sub = onRemoteChange;
    return this.session.onChange(() => onRemoteChange(this.buildLatest()));
  }
}

// ---------------------------------------------------------------------------
// CloudMetaStore (P5) — the shared `meta` doc: shipped totals + earned
// milestones + farm name/founded. Shipped totals use Firestore increment()
// FieldValue sentinels so concurrent sells from two devices sum ATOMICALLY on
// the server with ZERO read-modify-write race window. Milestone flips and the
// one-time init are plain field writes (merge). subscribe() rebuilds the whole
// MetaState from the doc on every server-confirmed change.
// ---------------------------------------------------------------------------
export interface LiveMetaStore extends MetaStore {
  subscribe(onRemoteChange: (meta: MetaState) => void): () => void;
  readonly ready: Promise<boolean>;
}

const META_SHIPPED_DEBOUNCE_MS = 500;

export class CloudMetaStore implements LiveMetaStore {
  readonly ready: Promise<boolean>;
  private session: FarmlifeSession;
  private pendingShipped: Record<string, number> = {};
  private shippedTimer: number | null = null;

  constructor(session: FarmlifeSession) {
    this.session = session;
    this.ready = session.ready;
  }

  async load(): Promise<MetaState | null> {
    await this.ready;
    if (this.session.offline) return null;
    return buildMetaFromDocs(this.session.docs());
  }

  addShipped(deltas: Record<string, number>): void {
    if (this.session.offline) return;
    let any = false;
    for (const [id, d] of Object.entries(deltas)) {
      if (!d) continue;
      this.pendingShipped[id] = (this.pendingShipped[id] ?? 0) + d;
      any = true;
    }
    if (any && this.shippedTimer == null) {
      this.shippedTimer = window.setTimeout(() => this.flushShipped(), META_SHIPPED_DEBOUNCE_MS);
    }
  }

  private flushShipped(): Promise<void> {
    this.shippedTimer = null;
    const deltas = this.pendingShipped;
    this.pendingShipped = {};
    const ids = Object.keys(deltas);
    if (!ids.length) return Promise.resolve();
    const patch: Record<string, unknown> = {};
    for (const id of ids) patch[`shipped_${id}`] = increment(deltas[id]); // ATOMIC, race-free
    return this.session.write(META_DOC_ID, patch);
  }

  setMilestone(key: string, ts: number): void {
    if (this.session.offline) return;
    void this.session.write(META_DOC_ID, { [`milestone_${key}`]: ts });
  }

  setInit(farmName: string, foundedAt: number): void {
    if (this.session.offline) return;
    // foundedAt guarded once by the caller (only writes when server foundedAt
    // is absent); farmName is a plain merge. Both are last-write-wins, but on
    // the first-ever meta write there is nothing to race with.
    void this.session.write(META_DOC_ID, { farmName, foundedAt });
  }

  flush(): Promise<void> {
    if (this.shippedTimer == null) return Promise.resolve();
    clearTimeout(this.shippedTimer);
    return this.flushShipped();
  }

  subscribe(onRemoteChange: (meta: MetaState) => void): () => void {
    return this.session.onChange(() => onRemoteChange(buildMetaFromDocs(this.session.docs())));
  }
}
