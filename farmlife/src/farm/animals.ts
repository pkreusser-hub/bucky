// ---------------------------------------------------------------------------
// Animals — P4. Pure produce/care math, deliberately mirroring growth.ts's
// shape (same reviewers, same guarantees): given the same stored record +
// def + now, these functions always return the same answer, whether queried
// a second later or a month later on a different device. No server ticks.
//
// KINDNESS CAP (Baby Bucky posture — see CLAUDE.md goatcare section): animals
// NEVER sicken or die. Absence just means "one produce waiting" — never a
// "too late", never a penalty.
//
// CARE SEMANTICS (husbandry rework 2026-07-10 — FEEDING REMOVED): grazing IS
// feeding. The animals feed themselves in the pasture by day, so there is no
// hunger gate and no feed interaction. Produce simply ACCRUES on the lazy
// timer since the last collection checkpoint (`lastFed`), capped at exactly
// ONE unit (produceEveryMs: 12h goat milk / 8h chicken egg). A family gone a
// week returns to exactly one milk per goat + one egg per chicken waiting —
// never more, never lost, never duplicated. `lastFed` is the cycle checkpoint
// (kept under that name for wire/save compatibility; old `lastFed` values load
// unchanged). CARE_WINDOW_MS remains as the accrual-pause cap but, being
// comfortably larger than every produceEveryMs, it never reduces the waiting
// amount below one — so the "exactly one waiting" guarantee holds forever.
//
//   `collectProduce()` consumes the banked produce (growth.ts's harvest):
//   zeroes `accruedMs` and re-checkpoints `lastFed` = now (starting a fresh
//   cycle). For a goat this is milking; for a chicken it fires when its
//   PHYSICAL egg is picked up off the barn floor (see farm/pasture.ts).
// ---------------------------------------------------------------------------

export type AnimalType = "goat" | "chicken";
export type ProduceId = "milk" | "egg";

export interface AnimalDef {
  type: AnimalType;
  name: string;
  emoji: string;
  produceId: ProduceId;
  produceEmoji: string;
  produceEveryMs: number;
  sellPrice: number;
}

const HOUR = 3_600_000;

/** How long a checkpoint (feed, birth, or collection) keeps produce accruing
 * before it pauses. Deliberately > every produceEveryMs below, so a single
 * checkpoint always suffices for one full cycle (the kindness-cap grace). */
export const CARE_WINDOW_MS = 24 * HOUR;

export const PRODUCE_ORDER: ProduceId[] = ["milk", "egg"];

export const ANIMAL_DEFS: Record<AnimalType, AnimalDef> = {
  goat: {
    type: "goat",
    name: "Goat",
    emoji: "🐐",
    produceId: "milk",
    produceEmoji: "🥛",
    produceEveryMs: 12 * HOUR,
    sellPrice: 40,
  },
  chicken: {
    type: "chicken",
    name: "Chicken",
    emoji: "🐔",
    produceId: "egg",
    produceEmoji: "🥚",
    produceEveryMs: 8 * HOUR,
    sellPrice: 15,
  },
};

/** Sale price + display info for a produce item, keyed by produceId (rather
 * than by animal type) so the shipping bin / HUD can treat milk & eggs as
 * plain inventory items, same as harvested crops. */
export function produceInfo(id: ProduceId): { emoji: string; name: string; sellPrice: number } {
  const def = id === "milk" ? ANIMAL_DEFS.goat : ANIMAL_DEFS.chicken;
  return { emoji: def.produceEmoji, name: def.produceId === "milk" ? "Milk" : "Eggs", sellPrice: def.sellPrice };
}

/** Minimal care-relevant shape a persisted animal record must provide. */
export interface AnimalCareTile {
  lastFed: number;
  accruedMs: number;
}

/** PURE. Total banked+accruing produce ms, clamped to [0, produceEveryMs]. */
export function produceMs(a: AnimalCareTile, def: AnimalDef, now: number): number {
  const windowMs = Math.min(Math.max(0, now - a.lastFed), CARE_WINDOW_MS);
  return Math.min(def.produceEveryMs, Math.max(0, a.accruedMs) + windowMs);
}

/** PURE. Exactly one unit of produce waiting to be collected? (Never more.) */
export function produceReady(a: AnimalCareTile, def: AnimalDef, now: number): boolean {
  return produceMs(a, def, now) >= def.produceEveryMs;
}

/** PURE. Consumes the ready produce (caller must have already checked
 * produceReady) and re-checkpoints — starting a fresh produce cycle at `now`. */
export function collectProduce(_a: AnimalCareTile, _def: AnimalDef, now: number): AnimalCareTile {
  return { lastFed: now, accruedMs: 0 };
}

// ---- interaction resolver ---------------------------------------------------

export type AnimalInteraction = "collect" | "pet";

/** PURE. Hand-action priority (feeding removed — grazing feeds them). Only a
 * GOAT with milk ready resolves to COLLECT (milking); every other hand-action
 * on an animal — a goat with no milk ready, or any chicken (eggs are physical
 * objects collected off the barn floor, never off the bird) — is a PET. So the
 * user's rule holds exactly: first hand-action on a milk-ready goat milks it,
 * the second (now not ready) pets it. */
export function resolveAnimalAction(a: AnimalCareTile, def: AnimalDef, now: number): AnimalInteraction {
  if (def.produceId === "milk" && produceReady(a, def, now)) return "collect";
  return "pet";
}

// ---- herd (shared, persistent) -----------------------------------------------

export interface AnimalRecord extends AnimalCareTile {
  id: string;
  type: AnimalType;
  name: string;
  bornAt: number;
  lastPet: number;
}

interface StarterSpec {
  id: string;
  type: AnimalType;
  name: string;
}

/** Fixed starter herd — 2 goats + 3 chickens, kid-friendly names. IDs are
 * stable across devices so the shared-doc field key (`a_<id>`) never drifts. */
export const STARTER_HERD: StarterSpec[] = [
  { id: "goat1", type: "goat", name: "Clover" },
  { id: "goat2", type: "goat", name: "Buttons" },
  { id: "chicken1", type: "chicken", name: "Henrietta" },
  { id: "chicken2", type: "chicken", name: "Nugget" },
  { id: "chicken3", type: "chicken", name: "Peep" },
];

/** A fresh herd, all animals born (and thus fed+not-hungry) `now`. */
export function starterHerd(now: number): Record<string, AnimalRecord> {
  const out: Record<string, AnimalRecord> = {};
  for (const s of STARTER_HERD) {
    out[s.id] = { id: s.id, type: s.type, name: s.name, bornAt: now, lastFed: now, accruedMs: 0, lastPet: 0 };
  }
  return out;
}

/** Defensive parse of one animal doc field — a corrupt/foreign value can
 * never brick the game (herd-dup-hardening house convention). Falls back to
 * the starter spec (freshly born) for a known id with bad data; null for an
 * id this build doesn't recognize (future herd growth, ignored gracefully). */
export function sanitizeAnimal(id: string, raw: unknown, fallbackNow: number): AnimalRecord | null {
  const spec = STARTER_HERD.find((s) => s.id === id);
  if (!spec) return null;
  const fresh: AnimalRecord = { id, type: spec.type, name: spec.name, bornAt: fallbackNow, lastFed: fallbackNow, accruedMs: 0, lastPet: 0 };
  if (!raw || typeof raw !== "object") return fresh;
  const r = raw as Partial<AnimalRecord>;
  const out = { ...fresh };
  if (typeof r.bornAt === "number" && isFinite(r.bornAt)) out.bornAt = r.bornAt;
  if (typeof r.lastFed === "number" && isFinite(r.lastFed)) out.lastFed = r.lastFed;
  if (typeof r.accruedMs === "number" && isFinite(r.accruedMs) && r.accruedMs >= 0) out.accruedMs = r.accruedMs;
  if (typeof r.lastPet === "number" && isFinite(r.lastPet)) out.lastPet = r.lastPet;
  if (typeof r.name === "string" && r.name.trim()) out.name = r.name.trim().slice(0, 24);
  return out;
}

// ---- deterministic per-animal wander seed (cosmetic-only, never synced) ------

/** FNV-1a-ish string hash -> 32-bit seed. */
export function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) so every device's local wander looks the
 * same for a given animal id — cosmetic only, never persisted/synced. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Pen {
  cx: number;
  cz: number;
  r: number;
}

/** Deterministic "home spot" for an animal within its pen — used both as the
 * wander center and as a bounds check (unit tests + verify-p4 assert every
 * spot stays within the pen and clear of the field/pond). */
export function homeSpot(id: string, pen: Pen): { x: number; z: number } {
  const rnd = mulberry32(hashSeed(id));
  const ang = rnd() * Math.PI * 2;
  const rad = rnd() * pen.r * 0.75;
  return { x: pen.cx + Math.cos(ang) * rad, z: pen.cz + Math.sin(ang) * rad };
}
