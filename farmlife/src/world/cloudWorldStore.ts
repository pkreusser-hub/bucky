// ---------------------------------------------------------------------------
// CloudWorldStore — Firestore-backed WorldStore (P2), shares one
// FarmlifeSession with CloudFarmStore. The "world" doc holds the editor's
// WorldData as a JSON string (matches the barnyardbistro cloud-layout-sync
// pattern: settings doc, field holds a JSON string or the literal "default").
// Empty world = today's handcrafted valley, unchanged either way.
// ---------------------------------------------------------------------------
import { FarmlifeSession } from "../net/session";
import type { RawDoc } from "../net/sync";
import {
  emptyWorldData,
  isEmptyWorldData,
  sanitizeWorldData,
  serializeWorldData,
  type WorldData,
} from "./worldData";
import type { WorldStore } from "./worldStore";

const WORLD_DOC_ID = "world";

function parseWorldDoc(docs: RawDoc[]): WorldData {
  const doc = docs.find((d) => d.id === WORLD_DOC_ID);
  if (!doc || !doc.data) return emptyWorldData();
  const raw = (doc.data as Record<string, unknown>).data;
  if (typeof raw !== "string" || raw === "default" || !raw) return emptyWorldData();
  try {
    return sanitizeWorldData(JSON.parse(raw));
  } catch (_) {
    return emptyWorldData();
  }
}

export class CloudWorldStore implements WorldStore {
  readonly ready: Promise<boolean>;
  private session: FarmlifeSession;

  constructor(session: FarmlifeSession) {
    this.session = session;
    this.ready = session.ready;
  }

  async load(): Promise<WorldData> {
    await this.ready;
    if (this.session.offline) return emptyWorldData();
    return parseWorldDoc(this.session.docs());
  }

  /** Current best-known world without waiting (used for the boot-time
   * background reconcile — localStorage renders first, this arrives async). */
  current(): WorldData {
    return parseWorldDoc(this.session.docs());
  }

  save(w: WorldData): Promise<void> {
    if (this.session.offline) return Promise.resolve();
    const min = serializeWorldData(w);
    const payload = isEmptyWorldData(w) ? "default" : JSON.stringify(min);
    return this.session.write(WORLD_DOC_ID, { data: payload, updatedAt: Date.now() });
  }

  /** Fires with the latest WorldData on every server-confirmed change AFTER
   * this store's own `ready`/load(). */
  subscribe(onRemoteChange: (w: WorldData) => void): () => void {
    return this.session.onChange((docs) => onRemoteChange(parseWorldDoc(docs)));
  }
}
