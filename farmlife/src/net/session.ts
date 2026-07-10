// ---------------------------------------------------------------------------
// FarmlifeSession — ONE Firestore init + ONE onSnapshot listener on the whole
// farmlife_<familyKey> collection, shared by CloudFarmStore and
// CloudWorldStore so P2 never opens two redundant listeners on the same data
// (watch-your-read-volume risk called out in farmlife-plan.md). Mirrors the
// index.html/farmkart.html "one collection listener, dispatch by doc id
// prefix" convention.
//
// FIRST-RUN GUARD (herd-dup lesson, non-negotiable): `ready` only resolves
// true once a NON-fromCache ("server confirmed") snapshot has been seen.
// Nothing may write to Firestore before that.
// ---------------------------------------------------------------------------
import { collection, doc, onSnapshot, setDoc, type Firestore, type Unsubscribe } from "firebase/firestore";
import { initFirestore, farmlifeCollectionName } from "./firebase";
import type { RawDoc } from "./sync";

export type ChangeListener = (docs: RawDoc[], meta: { fromCache: boolean }) => void;

const READY_TIMEOUT_MS = 12000;

export class FarmlifeSession {
  readonly ready: Promise<boolean>;
  db: Firestore | null = null;
  colName = "";
  offline = false;
  serverConfirmed = false;
  private latestDocs: RawDoc[] = [];
  private listeners = new Set<ChangeListener>();
  private unsub: Unsubscribe | null = null;
  private onOffline: ((msg: string) => void) | null;

  constructor(onOffline?: (msg: string) => void) {
    this.onOffline = onOffline ?? null;
    this.ready = this.init();
  }

  private async init(): Promise<boolean> {
    const info = await initFirestore();
    if (!info) {
      this.offline = true;
      this.onOffline?.("Playing offline — this device only");
      return false;
    }
    this.db = info.db;
    this.colName = farmlifeCollectionName(info.familyKey);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) {
          this.offline = true;
          this.onOffline?.("Playing offline — this device only");
        }
        resolve(ok);
      };
      const timer = window.setTimeout(() => finish(false), READY_TIMEOUT_MS);
      try {
        this.unsub = onSnapshot(
          collection(this.db!, this.colName),
          (snap) => {
            this.latestDocs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
            if (!snap.metadata.fromCache) {
              this.serverConfirmed = true;
              finish(true);
            }
            if (this.serverConfirmed) {
              for (const cb of this.listeners) cb(this.latestDocs, { fromCache: snap.metadata.fromCache });
            }
          },
          (err) => {
            console.warn("Farm Life: Firestore snapshot error — playing offline.", err);
            finish(false);
          }
        );
      } catch (err) {
        console.warn("Farm Life: Firestore subscribe failed — playing offline.", err);
        finish(false);
      }
    });
  }

  docs(): RawDoc[] {
    return this.latestDocs;
  }

  /** Fires on every server-confirmed snapshot AFTER `ready` resolves true
   * (never on the bootstrap snapshot itself — callers read that via docs()
   * right after awaiting `ready`). */
  onChange(cb: ChangeListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async write(docId: string, patch: Record<string, unknown>): Promise<void> {
    if (this.offline || !this.db) return;
    try {
      await setDoc(doc(this.db, this.colName, docId), patch, { merge: true });
    } catch (err) {
      console.warn(`Farm Life: write to ${docId} failed (will retry on next change).`, err);
    }
  }

  dispose(): void {
    this.unsub?.();
    this.listeners.clear();
  }
}
