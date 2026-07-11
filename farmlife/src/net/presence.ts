// ---------------------------------------------------------------------------
// Presence layer (P3) — Playroom Kit. EPHEMERAL "who's on the farm right now":
// avatars, ~10Hz positions, facing, tool-use animations, emotes. NOTHING of
// value lives here; Firestore (P2) remains the single authority for all farm
// state. If Playroom is unreachable the game is fully playable solo — one quiet
// toast, zero errors.
//
// DESIGN (contrast with Bistro/Kart): there is NO host-authoritative sim. Every
// client publishes ONLY its own presence via myPlayer().setState and reads
// everyone else's. No host means the "host leaves = session ends" problem never
// applies — the room is a stateless meeting point derived from the family key.
//
// ONE persistent family room: roomCode = roomCodeFromFamily(familyKey) — every
// device resolves the same code and lands in the same room automatically
// (insertCoin({ skipLobby, roomCode }); never lobby UI, never a `#r=` hash — the
// barnyardbistro CAUTION that Playroom's own hash parsing beats roomCode).
//
// PUBLISHED STATE (per player):
//   "meta" (reliable, set once): { n: name, j: joinedAt }
//   "p"    (unreliable, ~10Hz):  { x, y, z, h, t, a, as, e, es }
//        h = heading (rad), t = ToolId, a/as = tool-anim kind + exactly-once
//        seq, e/es = emote kind + exactly-once seq. Positions interpolate over
//        a ~120ms buffer (the Farm Kart interp lesson); a/e replay once on seq
//        change so a dropped packet just delays, never dupes or drops.
// ---------------------------------------------------------------------------
import { insertCoin, onPlayerJoin, myPlayer, getRoomCode, type PlayerState } from "playroomkit";
import { resolveFamilyKey, currentPlayerName } from "./firebase";
import { roomCodeFromFamily } from "./presenceUtil";
import type { ToolId } from "../farm/action";
import type { ToolAnimKind } from "../player/player"; // type-only (erased at build); no pure home without editing the 3D player module
import type { EmoteKind } from "../player/emoteConst";

const PUBLISH_HZ = 10;
const PUBLISH_MS = 1000 / PUBLISH_HZ;
const INTERP_DELAY_MS = 120;
const BUFFER_MAX = 16;

export interface LocalPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  tool: ToolId;
}

/** Interpolated remote snapshot handed to the render layer each frame. */
export interface RemoteSnapshot {
  x: number;
  y: number;
  z: number;
  heading: number;
  tool: ToolId;
  /** Horizontal ground speed (m/s), derived from the interp buffer — drives the
   * remote's walk/run/idle gait. */
  speed: number;
}

interface Sample {
  t: number; // performance.now() at receipt
  x: number;
  y: number;
  z: number;
  h: number;
}

interface Remote {
  player: PlayerState;
  id: string;
  name: string;
  joinedAt: number;
  buf: Sample[];
  lastPosSig: string;
  tool: ToolId;
  lastAnimSeq: number;
  lastEmoteSeq: number;
}

type IdName = (id: string, name: string) => void;
type IdKind<K> = (id: string, kind: K) => void;

export class Presence {
  readonly ready: Promise<boolean>;
  connected = false;
  myId: string | null = null;
  private myName = "";
  private myJoinedAt = 0;
  private me: PlayerState | null = null;

  private remotes = new Map<string, Remote>();
  private lastPublish = 0;
  private lastPose: LocalPose | null = null;
  private curTool: ToolId = "hoe";
  private animKind: ToolAnimKind | null = null;
  private animSeq = 0;
  private emoteKind: EmoteKind | null = null;
  private emoteSeq = 0;

  private joinCbs: IdName[] = [];
  private quitCbs: IdName[] = [];
  private animCbs: IdKind<ToolAnimKind>[] = [];
  private emoteCbs: IdKind<EmoteKind>[] = [];

  constructor(private onToast?: (msg: string) => void) {
    this.ready = this.init();
  }

  private async init(): Promise<boolean> {
    try {
      // ?nopresence — test hook so the P2 Firestore suite can run with presence
      // fully OFF (no Playroom connect, no lobby doc) without needing network
      // interception. Harmless in production (never set by real users).
      let noPresence = false;
      try {
        noPresence = new URLSearchParams(location.search).has("nopresence");
      } catch (_) {
        /* non-browser */
      }
      if (noPresence || typeof insertCoin !== "function") {
        return false;
      }
      const roomCode = roomCodeFromFamily(resolveFamilyKey());
      await insertCoin({ skipLobby: true, roomCode, maxPlayersPerRoom: 8 });
      this.me = myPlayer();
      this.myId = this.me.id;
      this.myName = currentPlayerName();
      this.myJoinedAt = Date.now();
      try {
        this.me.setState("meta", { n: this.myName, j: this.myJoinedAt }, true);
      } catch (_) {
        /* ignore */
      }
      try {
        this.roomCode = getRoomCode() ?? roomCode;
      } catch (_) {
        this.roomCode = roomCode;
      }
      onPlayerJoin((player: PlayerState) => this.handleJoin(player));
      this.connected = true;
      return true;
    } catch (err) {
      console.warn("Farm Life: presence unavailable — playing solo.", err);
      this.onToast?.("Playing solo — presence unavailable");
      this.connected = false;
      return false;
    }
  }

  roomCode: string | null = null;

  private handleJoin(player: PlayerState): void {
    if (this.myId && player.id === this.myId) return; // onPlayerJoin fires for self too
    if (this.remotes.has(player.id)) return;
    const meta = readMeta(player);
    const r: Remote = {
      player,
      id: player.id,
      name: meta.name || "Farmer",
      joinedAt: meta.joinedAt || Date.now(),
      buf: [],
      lastPosSig: "",
      tool: "hoe",
      lastAnimSeq: 0,
      lastEmoteSeq: 0,
    };
    this.remotes.set(player.id, r);
    // register quit immediately so a quick join→leave still cleans up
    player.onQuit(() => {
      const gone = this.remotes.get(player.id);
      if (!gone) return;
      this.remotes.delete(player.id);
      for (const cb of this.quitCbs) cb(player.id, gone.name);
    });
    // the "meta" (name/joinedAt) state may arrive a beat after the join event;
    // resolve it (up to ~1.5s) before announcing so the toast + name tag show
    // the real name, not the "Farmer" placeholder.
    void this.resolveNameThenAnnounce(r);
  }

  private async resolveNameThenAnnounce(r: Remote): Promise<void> {
    for (let i = 0; i < 30; i++) {
      const meta = readMeta(r.player);
      if (meta.name) {
        r.name = meta.name;
        if (meta.joinedAt) r.joinedAt = meta.joinedAt;
        break;
      }
      if (!this.remotes.has(r.id)) return; // left before name resolved
      await delay(100);
    }
    if (!this.remotes.has(r.id)) return;
    for (const cb of this.joinCbs) cb(r.id, r.name);
  }

  // ---- event subscriptions (additive; presence has multiple listeners) ------
  onJoin(cb: IdName): void {
    this.joinCbs.push(cb);
  }
  onQuit(cb: IdName): void {
    this.quitCbs.push(cb);
  }
  onRemoteAnim(cb: IdKind<ToolAnimKind>): void {
    this.animCbs.push(cb);
  }
  onRemoteEmote(cb: IdKind<EmoteKind>): void {
    this.emoteCbs.push(cb);
  }

  // ---- local publish --------------------------------------------------------
  private buildPose(pose: LocalPose): Record<string, unknown> {
    return {
      x: round2(pose.x),
      y: round2(pose.y),
      z: round2(pose.z),
      h: round3(pose.heading),
      t: pose.tool,
      a: this.animKind,
      as: this.animSeq,
      e: this.emoteKind,
      es: this.emoteSeq,
    };
  }

  /** Publish the local pose. Throttled to ~10Hz, but publishes IMMEDIATELY when
   * the tool changes (so remotes swap the held tool without lag). */
  publishLocal(pose: LocalPose): void {
    if (!this.connected || !this.me) return;
    this.lastPose = pose;
    const now = performance.now();
    const toolChanged = pose.tool !== this.curTool;
    this.curTool = pose.tool;
    if (!toolChanged && now - this.lastPublish < PUBLISH_MS) return;
    this.lastPublish = now;
    try {
      this.me.setState("p", this.buildPose(pose), false);
    } catch (_) {
      /* transient — next frame retries */
    }
  }

  private publishNow(pose?: LocalPose): void {
    if (!this.connected || !this.me) return;
    // reliable one-shot for anim/emote — reuse the last known pose so we never
    // clobber x/y/z with zeros (the seq fields are what matter here).
    const p = pose ?? this.lastPose ?? { x: 0, y: 0, z: 0, heading: 0, tool: this.curTool };
    try {
      this.me.setState("p", this.buildPose(p), true);
    } catch (_) {
      /* ignore */
    }
  }

  /** Local player started a tool-use animation — replicate it to everyone. */
  emitAnim(kind: ToolAnimKind, pose?: LocalPose): void {
    this.animKind = kind;
    this.animSeq++;
    this.publishNow(pose);
  }

  /** Local player triggered an emote — replicate it (exactly-once via seq). */
  emitEmote(kind: EmoteKind, pose?: LocalPose): void {
    this.emoteKind = kind;
    this.emoteSeq++;
    this.publishNow(pose);
  }

  // ---- per-frame remote poll + interp ---------------------------------------
  update(_dt: number): void {
    if (!this.connected) return;
    const now = performance.now();
    for (const r of this.remotes.values()) {
      // meta (name/joinedAt) may arrive a beat after join
      const meta = readMeta(r.player);
      if (meta.name) r.name = meta.name;
      if (meta.joinedAt) r.joinedAt = meta.joinedAt;

      let p: Record<string, unknown> | null = null;
      try {
        p = r.player.getState("p") as Record<string, unknown> | null;
      } catch (_) {
        p = null;
      }
      if (!p) continue;

      const x = num(p.x),
        y = num(p.y),
        z = num(p.z),
        h = num(p.h);
      const posSig = `${x},${y},${z},${h}`;
      if (posSig !== r.lastPosSig) {
        r.lastPosSig = posSig;
        r.buf.push({ t: now, x, y, z, h });
        if (r.buf.length > BUFFER_MAX) r.buf.shift();
      }

      if (typeof p.t === "string") r.tool = p.t as ToolId;

      const as = num(p.as);
      if (as > r.lastAnimSeq) {
        r.lastAnimSeq = as;
        const kind = p.a as ToolAnimKind | null;
        if (kind) for (const cb of this.animCbs) cb(r.id, kind);
      }
      const es = num(p.es);
      if (es > r.lastEmoteSeq) {
        r.lastEmoteSeq = es;
        const kind = p.e as EmoteKind | null;
        if (kind) for (const cb of this.emoteCbs) cb(r.id, kind);
      }
    }
  }

  /** Interpolated snapshot for a remote id, or null if not enough data yet. */
  sample(id: string): RemoteSnapshot | null {
    const r = this.remotes.get(id);
    if (!r || r.buf.length === 0) return null;
    const renderT = performance.now() - INTERP_DELAY_MS;
    const buf = r.buf;
    // find the two samples bracketing renderT
    let a = buf[0];
    let b = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].t <= renderT && buf[i + 1].t >= renderT) {
        a = buf[i];
        b = buf[i + 1];
        break;
      }
    }
    let s: RemoteSnapshot;
    if (a === b || b.t <= a.t) {
      s = { x: b.x, y: b.y, z: b.z, heading: b.h, tool: r.tool, speed: 0 };
    } else {
      const k = clamp01((renderT - a.t) / (b.t - a.t));
      const x = a.x + (b.x - a.x) * k;
      const y = a.y + (b.y - a.y) * k;
      const z = a.z + (b.z - a.z) * k;
      const heading = a.h + shortAngle(b.h - a.h) * k;
      // speed from the bracket (world units / s)
      const dtSec = (b.t - a.t) / 1000;
      const speed = dtSec > 0 ? Math.hypot(b.x - a.x, b.z - a.z) / dtSec : 0;
      s = { x, y, z, heading, tool: r.tool, speed };
    }
    return s;
  }

  remoteIds(): string[] {
    return [...this.remotes.keys()];
  }
  remoteName(id: string): string {
    return this.remotes.get(id)?.name ?? "Farmer";
  }

  /** Number of players on the farm right now, INCLUDING this device. */
  presentCount(): number {
    return (this.connected ? 1 : 0) + this.remotes.size || 1;
  }

  /** Single-writer election for the family-lobby doc: true if THIS device is
   * the oldest-joined present player (min joinedAt, tie-broken by id). When the
   * current writer leaves, the next-oldest becomes true automatically — so the
   * lobby doc always has exactly one maintainer. */
  isOldestPresent(): boolean {
    if (!this.connected || !this.myId) return false;
    for (const r of this.remotes.values()) {
      if (r.joinedAt < this.myJoinedAt) return false;
      if (r.joinedAt === this.myJoinedAt && r.id < this.myId) return false;
    }
    return true;
  }
}

// ---- helpers ----------------------------------------------------------------
function readMeta(player: PlayerState): { name: string; joinedAt: number } {
  try {
    const m = player.getState("meta") as { n?: string; j?: number } | null;
    return { name: (m && m.n) || "", joinedAt: (m && m.j) || 0 };
  } catch (_) {
    return { name: "", joinedAt: 0 };
  }
}
function num(v: unknown): number {
  return typeof v === "number" && isFinite(v) ? v : 0;
}
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function shortAngle(d: number): number {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
