// ---------------------------------------------------------------------------
// Growth — the pure heart of the farming loop. The ENTIRE persistence model
// (localStorage now, Firestore in P2) hangs on growthMs()/growthStage() being
// deterministic and side-effect-free: given the same tile record + crop + now,
// they always return the same answer, whether evaluated a second later or a
// week later on a different device.
//
// SEMANTICS (read this before touching the math):
//   A tile carries three numbers: `plantedAt` (when it was planted, informational
//   only), `accruedMs` (growth banked from *past* watering windows), and
//   `lastWatered` (the start of the CURRENT watering window). `plantTile(now)`
//   seeds `lastWatered = now`, so freshly-tilled soil is treated as moist —
//   every crop gets one free grace window of up to `waterEveryMs` of growth
//   before it needs its first watering. That's the only "unwatered growth"
//   that ever happens; it is intentional (a kid who plants and leaves isn't
//   punished the same minute) and keeps the formula uniform (no special-cased
//   "never watered" branch).
//
//   At any query time `now`:
//     growthMs = accruedMs + min(now - lastWatered, waterEveryMs)
//   i.e. growth accrues in real time for up to `waterEveryMs` past the last
//   watering, then PAUSES (never regresses, never dies — the Baby Bucky
//   kindness-cap rule: a neglected crop just waits for you).
//
//   Watering is a CHECKPOINT: waterTile() banks whatever growth the current
//   window has earned (capped at waterEveryMs, so watering early doesn't bank
//   more than the window allows and watering late doesn't lose the capped
//   amount) into `accruedMs`, then resets `lastWatered = now`, opening a fresh
//   window. Repeated instant re-waterings ("water spam") are harmless: the
//   elapsed-time term is ~0 each time, so accruedMs barely moves.
//
//   growthMs is always clamped to crop.growMs — once a crop is ready, further
//   time (watered or not) can never push it "past ready" or make it regress.
// ---------------------------------------------------------------------------

export type CropId =
  | "turnip"
  | "potato"
  | "corn"
  | "pumpkin"
  | "strawberry"
  | "carrot"
  | "tomato"
  | "sunflower";

export interface Crop {
  id: CropId;
  name: string;
  emoji: string;
  growMs: number; // real-time ms from plant to ready, fully watered
  waterEveryMs: number; // how long one watering keeps growth accruing
  seedCost: number; // coins to buy one seed
  sellPrice: number; // coins for one harvested crop
}

const HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// BALANCE — coins per hour of growing time (sellPrice / (growMs in hours)),
// the raw $/hr yield ignoring active watering attention. Longer crops earn a
// LOWER $/hr but a bigger absolute payout (get-rich-slow-but-reliable), matching
// the original 4-crop curve. No new crop dominates the existing ones on pure
// $/hr; the whole set sits inside the ~2.1–4.5 band the base crops define.
//   turnip     18 /  4h = 4.50
//   strawberry 26 /  6h = 4.33
//   carrot     32 /  8h = 4.00
//   tomato     62 / 16h = 3.88
//   potato     42 / 12h = 3.50
//   corn       75 / 24h = 3.13
//   sunflower 110 / 48h = 2.29
//   pumpkin   150 / 72h = 2.08
// waterEveryMs holds each crop's original grow:water ratio (4:1 for the short/
// mid crops, 6:1 for the multi-day capstones) so no crop is thirstier per hour.
// ---------------------------------------------------------------------------
export const CROPS: Record<CropId, Crop> = {
  turnip: {
    id: "turnip",
    name: "Turnip",
    emoji: "🟣",
    growMs: 4 * HOUR,
    waterEveryMs: 1 * HOUR,
    seedCost: 10,
    sellPrice: 18,
  },
  potato: {
    id: "potato",
    name: "Potato",
    emoji: "🥔",
    growMs: 12 * HOUR,
    waterEveryMs: 3 * HOUR,
    seedCost: 22,
    sellPrice: 42,
  },
  corn: {
    id: "corn",
    name: "Corn",
    emoji: "🌽",
    growMs: 24 * HOUR,
    waterEveryMs: 6 * HOUR,
    seedCost: 35,
    sellPrice: 75,
  },
  pumpkin: {
    id: "pumpkin",
    name: "Pumpkin",
    emoji: "🎃",
    growMs: 72 * HOUR,
    waterEveryMs: 12 * HOUR,
    seedCost: 60,
    sellPrice: 150,
  },
  strawberry: {
    id: "strawberry",
    name: "Strawberry",
    emoji: "🍓",
    growMs: 6 * HOUR,
    waterEveryMs: 1.5 * HOUR, // 4:1
    seedCost: 15,
    sellPrice: 26,
  },
  carrot: {
    id: "carrot",
    name: "Carrot",
    emoji: "🥕",
    growMs: 8 * HOUR,
    waterEveryMs: 2 * HOUR, // 4:1
    seedCost: 18,
    sellPrice: 32,
  },
  tomato: {
    id: "tomato",
    name: "Tomato",
    emoji: "🍅",
    growMs: 16 * HOUR,
    waterEveryMs: 4 * HOUR, // 4:1
    seedCost: 30,
    sellPrice: 62,
  },
  sunflower: {
    id: "sunflower",
    name: "Sunflower",
    emoji: "🌻",
    growMs: 48 * HOUR,
    waterEveryMs: 8 * HOUR, // 6:1
    seedCost: 45,
    sellPrice: 110,
  },
};

export const CROP_ORDER: CropId[] = [
  "turnip",
  "potato",
  "corn",
  "pumpkin",
  "strawberry",
  "carrot",
  "tomato",
  "sunflower",
];

/** Minimal growth-relevant shape a persisted tile record must provide. */
export interface GrowthTile {
  plantedAt: number;
  accruedMs: number;
  lastWatered: number;
}

export type GrowthStageValue = 0 | 1 | 2 | "ready";

/** Fresh planted-tile record, "moist" as of `now` (see module docstring). */
export function plantTile(now: number): GrowthTile {
  return { plantedAt: now, accruedMs: 0, lastWatered: now };
}

/** PURE. Total banked+accruing growth ms, clamped to [0, crop.growMs]. */
export function growthMs(tile: GrowthTile, crop: Crop, now: number): number {
  const windowMs = Math.min(Math.max(0, now - tile.lastWatered), crop.waterEveryMs);
  const g = tile.accruedMs + windowMs;
  return Math.min(crop.growMs, Math.max(0, g));
}

/** PURE. Discrete visual/gameplay stage: 0 (sprout) .. 2 (mature) | "ready". */
export function growthStage(tile: GrowthTile, crop: Crop, now: number): GrowthStageValue {
  const g = growthMs(tile, crop, now);
  if (g >= crop.growMs) return "ready";
  const frac = g / crop.growMs;
  if (frac < 1 / 3) return 0;
  if (frac < 2 / 3) return 1;
  return 2;
}

/** PURE. True if the crop is not ready and its current watering window has run out. */
export function needsWater(tile: GrowthTile, crop: Crop, now: number): boolean {
  if (growthMs(tile, crop, now) >= crop.growMs) return false;
  return now - tile.lastWatered >= crop.waterEveryMs;
}

/**
 * PURE. Returns a NEW tile record with the current window banked into
 * accruedMs and a fresh window opened at `now`. Never mutates the input.
 */
export function waterTile(tile: GrowthTile, crop: Crop, now: number): GrowthTile {
  const windowMs = Math.min(Math.max(0, now - tile.lastWatered), crop.waterEveryMs);
  const accruedMs = Math.min(crop.growMs, tile.accruedMs + windowMs);
  return { plantedAt: tile.plantedAt, accruedMs, lastWatered: now };
}

/** 0..1 progress toward ready, for progress-bar style UI (not currently used by the HUD). */
export function growthFraction(tile: GrowthTile, crop: Crop, now: number): number {
  return growthMs(tile, crop, now) / crop.growMs;
}

// ---------------------------------------------------------------------------
// FAST-GROW TEST MODE (2026-07-10) — driven by tune.ts `fastGrow` (default ON
// for testing; MUST flip to false before ship). This is a CLIENT-SIDE
// INTERPRETATION scale, applied ONLY at the live game's read sites (gameplay +
// visuals + map) through effectiveCrop(). The PURE functions above are UNTOUCHED
// and keep whatever Crop they are handed, so growth.test.ts (which passes real
// CROPS) exercises the real math and its semantics ("still growing at 2h") stay
// valid. Firestore timestamps stay ABSOLUTE — fastGrow changes only how a tile's
// elapsed time is interpreted, consistently across family devices sharing the
// default; a device with fastGrow OFF reads the same tile on the real timeline.
//
// Timings when ON: every crop matures in FAST_GROW_TOTAL_MS (~60s). waterEveryMs
// is scaled to HALF the fast growth (30s): the plant-moisture grace window
// carries a crop to the halfway point, then ONE watering carries it the rest of
// the way to maturity — while an UNWATERED crop still PAUSES at the halfway
// point (so the water-pause mechanic stays testable by simply not watering).
// (waterEveryMs == growMs would let planting alone finish it, erasing the pause;
// waterEveryMs == growMs/2 keeps watering meaningful. See report/tests.)
// ---------------------------------------------------------------------------
export const FAST_GROW_TOTAL_MS = 60_000;

let fastGrowEnabled = false;
/** Toggle fast-grow interpretation. Called from main.ts on boot + TUNE toggle. */
export function setFastGrow(on: boolean): void {
  fastGrowEnabled = on;
}
export function isFastGrow(): boolean {
  return fastGrowEnabled;
}

/**
 * Scale a crop to fast-grow timings when the mode is ON; identity when OFF.
 * Reads only the module fastGrow flag (config) and never mutates its argument.
 * Live gameplay/visual/map reads route CROPS[id] through this before calling the
 * pure growth functions; unit tests call the pure functions with real CROPS
 * directly and are unaffected.
 */
export function effectiveCrop(crop: Crop): Crop {
  if (!fastGrowEnabled) return crop;
  return {
    ...crop,
    growMs: FAST_GROW_TOTAL_MS,
    waterEveryMs: Math.round(FAST_GROW_TOTAL_MS / 2),
  };
}
