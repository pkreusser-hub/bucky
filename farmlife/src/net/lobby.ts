// ---------------------------------------------------------------------------
// Family-lobby doc (P3) — ported from farmkart.html's ensureLobbyDoc/
// updateLobbyDoc/deleteLobbyDoc pattern. While anyone is on the farm AND
// Playroom-connected AND Firestore is reachable, ONE doc
// `lobbies_<familyKey>/fl_farm` advertises the farm to games.html's generic
// renderLobbies() as a live "🌱 <name> is on the farm" JOIN card.
//
// SINGLE WRITER (no host in Farm Life): the doc is maintained by the OLDEST-
// JOINED present player (presence.isOldestPresent()). When that player leaves,
// the next-oldest takes over automatically. Because the doc id is FIXED
// (fl_farm — one persistent family room), even a brief clock-skew overlap where
// two clients both think they're oldest just writes the same doc idempotently.
//
// Degrades silently: no Firestore → available=false, nothing happens, the game
// is unaffected. Reuses the shared initFirestore() app (no second Firebase
// init).
// ---------------------------------------------------------------------------
import { doc, setDoc, deleteDoc, type DocumentReference, type Firestore } from "firebase/firestore";
import { initFirestore, currentPlayerName } from "./firebase";
import type { Presence } from "./presence";

const LOBBY_DOC_ID = "fl_farm";
const HEARTBEAT_MS = 15 * 1000;
const HIDDEN_DELETE_MS = 60 * 1000;
const MAX_PLAYERS = 8;

export class FarmLobby {
  private db: Firestore | null = null;
  private ref: DocumentReference | null = null;
  private available = false;
  private isWriter = false;
  private docExists = false;
  private heartbeat: number | null = null;
  private hiddenTimer: number | null = null;
  private hiddenDeleted = false;
  private hooked = false;

  constructor(private presence: Presence) {
    void this.begin();
  }

  private async begin(): Promise<void> {
    const ok = await this.presence.ready;
    if (!ok) return; // Playroom unreachable → no presence → no lobby doc
    const info = await initFirestore();
    if (!info) return; // Firestore blocked/unavailable → silent no-op
    this.db = info.db;
    this.ref = doc(this.db, `lobbies_${info.familyKey}`, LOBBY_DOC_ID);
    this.available = true;
    // re-evaluate ownership whenever the present set changes, and on a heartbeat
    this.presence.onJoin(() => this.refresh());
    this.presence.onQuit(() => this.refresh());
    this.hookLifecycle();
    this.startHeartbeat();
    this.refresh();
  }

  /** Ownership election + write/release. Called on join/quit, heartbeat, and
   * when the tab returns to the foreground. */
  async refresh(): Promise<void> {
    if (!this.available || !this.ref) return;
    if (this.presence.isOldestPresent()) {
      this.isWriter = true;
      await this.write();
    } else {
      // someone older owns the doc — stop writing, but DON'T delete it.
      this.isWriter = false;
    }
  }

  private async write(): Promise<void> {
    if (!this.ref) return;
    const now = Date.now();
    const payload: Record<string, unknown> = {
      game: "farmlife",
      gameName: "Farm Life",
      ico: "🌱",
      hostName: currentPlayerName(),
      roomCode: "",
      updatedAt: now,
      status: "open", // the farm is always joinable
      playerCount: this.presence.presentCount(),
      maxPlayers: MAX_PLAYERS,
    };
    if (!this.docExists) payload.createdAt = now;
    try {
      await setDoc(this.ref, payload, { merge: true });
      this.docExists = true;
    } catch (_) {
      /* best-effort — games.html liveness window ages a stale card out */
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat != null) return;
    this.heartbeat = window.setInterval(() => this.refresh(), HEARTBEAT_MS);
  }

  private async del(): Promise<void> {
    if (!this.ref || !this.docExists) return;
    this.docExists = false;
    try {
      await deleteDoc(this.ref);
    } catch (_) {
      /* best-effort */
    }
  }

  private hookLifecycle(): void {
    if (this.hooked) return;
    this.hooked = true;
    const leave = () => {
      // Only the current writer deletes; if others remain, the next-oldest
      // re-creates the doc on its onQuit-triggered refresh.
      if (this.isWriter) this.del();
    };
    window.addEventListener("pagehide", leave);
    window.addEventListener("beforeunload", leave);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (this.hiddenTimer != null) return;
        this.hiddenTimer = window.setTimeout(() => {
          this.hiddenTimer = null;
          if (this.isWriter && this.docExists) {
            this.hiddenDeleted = true;
            this.del();
          }
        }, HIDDEN_DELETE_MS);
      } else {
        if (this.hiddenTimer != null) {
          clearTimeout(this.hiddenTimer);
          this.hiddenTimer = null;
        }
        if (this.hiddenDeleted) {
          this.hiddenDeleted = false;
          this.refresh();
        }
      }
    });
  }
}
