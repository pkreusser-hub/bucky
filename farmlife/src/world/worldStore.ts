import {
  emptyWorldData,
  sanitizeWorldData,
  serializeWorldData,
  type WorldData,
} from "./worldData";

// ---------------------------------------------------------------------------
// WorldStore — same store-interface pattern as FarmStore. P1.5b ships the
// localStorage implementation (key `fl_world_v1`); P2 swaps in a Firestore
// implementation (region docs) WITHOUT touching the game or editor, which only
// ever talk to this interface.
// ---------------------------------------------------------------------------

export interface WorldStore {
  load(): Promise<WorldData>;
  save(w: WorldData): void;
}

export const WORLD_KEY = "fl_world_v1";

/** Synchronous boot read — the game needs the world BEFORE it builds the ground
 * mesh, and localStorage is synchronous. Returns a full (possibly empty)
 * WorldData; never throws. */
export function loadWorldDataSync(): WorldData {
  try {
    const raw = localStorage.getItem(WORLD_KEY);
    if (!raw) return emptyWorldData();
    return sanitizeWorldData(JSON.parse(raw));
  } catch (_) {
    return emptyWorldData();
  }
}

export class LocalWorldStore implements WorldStore {
  async load(): Promise<WorldData> {
    return loadWorldDataSync();
  }

  save(w: WorldData): void {
    try {
      const min = serializeWorldData(w);
      localStorage.setItem(WORLD_KEY, JSON.stringify(min));
    } catch (_) {
      /* quota / private mode -> ignore */
    }
  }
}
