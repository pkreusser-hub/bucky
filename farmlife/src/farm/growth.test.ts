import { describe, it, expect, afterEach } from "vitest";
import {
  CROPS,
  CROP_ORDER,
  plantTile,
  growthMs,
  growthStage,
  needsWater,
  waterTile,
  effectiveCrop,
  setFastGrow,
  isFastGrow,
  FAST_GROW_TOTAL_MS,
  type CropId,
  type GrowthTile,
} from "./growth";

const turnip = CROPS.turnip; // growMs 4h, waterEveryMs 1h
const HOUR = 3_600_000;

describe("growth.ts — pure growth model", () => {
  it("fresh plant is stage 0 with zero growth", () => {
    const t0 = 1_000_000;
    const tile = plantTile(t0);
    expect(growthMs(tile, turnip, t0)).toBe(0);
    expect(growthStage(tile, turnip, t0)).toBe(0);
  });

  it("watered continuously reaches exactly ready at growMs", () => {
    const t0 = 0;
    let tile: GrowthTile = plantTile(t0);
    // re-water every 30min (< waterEveryMs of 1h) until growMs elapses
    const STEP = HOUR / 2;
    let t = t0;
    while (t < turnip.growMs) {
      t += STEP;
      tile = waterTile(tile, turnip, t);
    }
    expect(growthMs(tile, turnip, t)).toBe(turnip.growMs);
    expect(growthStage(tile, turnip, t)).toBe("ready");

    // just before growMs (continuously watered) should NOT be ready yet
    let tile2: GrowthTile = plantTile(t0);
    let t2 = t0;
    const target = turnip.growMs - 1000;
    while (t2 + STEP < target) {
      t2 += STEP;
      tile2 = waterTile(tile2, turnip, t2);
    }
    expect(growthMs(tile2, turnip, target)).toBeLessThan(turnip.growMs);
    expect(growthStage(tile2, turnip, target)).not.toBe("ready");
  });

  it("unwatered growth pauses exactly at the waterEveryMs boundary", () => {
    const t0 = 0;
    const tile = plantTile(t0); // lastWatered = 0, never re-watered
    const atBoundary = growthMs(tile, turnip, turnip.waterEveryMs);
    expect(atBoundary).toBe(turnip.waterEveryMs);

    // far beyond growMs, still capped at waterEveryMs (paused, not dead/reset)
    const wayLater = growthMs(tile, turnip, turnip.growMs * 50);
    expect(wayLater).toBe(turnip.waterEveryMs);
    expect(growthStage(tile, turnip, turnip.growMs * 50)).not.toBe("ready");

    // sampling again even further out gives the identical value — a true pause,
    // not a one-time cap that then resumes on its own
    const evenLater = growthMs(tile, turnip, turnip.growMs * 500);
    expect(evenLater).toBe(atBoundary);
  });

  it("re-watering resumes accrual from the paused checkpoint", () => {
    const t0 = 0;
    let tile = plantTile(t0);
    const stallTime = turnip.growMs; // long past the 1h window, paused at 1h of growth
    expect(growthMs(tile, turnip, stallTime)).toBe(turnip.waterEveryMs);

    // re-water: banks the capped window, opens a fresh one
    tile = waterTile(tile, turnip, stallTime);
    expect(tile.accruedMs).toBe(turnip.waterEveryMs);
    expect(tile.lastWatered).toBe(stallTime);
    expect(growthMs(tile, turnip, stallTime)).toBe(turnip.waterEveryMs); // no time passed yet

    // growth resumes ticking after the re-water
    const later = stallTime + HOUR / 4;
    expect(growthMs(tile, turnip, later)).toBe(turnip.waterEveryMs + HOUR / 4);
  });

  it("time far in the future while kept watered reaches ready but never exceeds growMs", () => {
    const t0 = 0;
    let tile = plantTile(t0);
    // water every 45 min, way past growMs
    const STEP = 45 * 60_000;
    let t = t0;
    for (let i = 0; i < 400; i++) {
      t += STEP;
      tile = waterTile(tile, turnip, t);
    }
    expect(t).toBeGreaterThan(turnip.growMs * 10);
    expect(growthMs(tile, turnip, t)).toBe(turnip.growMs);
    expect(growthStage(tile, turnip, t)).toBe("ready");
  });

  it("watering rapidly in succession (spam) does not bank extra growth", () => {
    const t0 = 0;
    let tile = plantTile(t0);
    const before = growthMs(tile, turnip, t0);
    for (let i = 0; i < 50; i++) {
      tile = waterTile(tile, turnip, t0 + i); // 1ms apart
    }
    const after = growthMs(tile, turnip, t0 + 49);
    // 49ms of real elapsed time total — negligible, never inflated by spam count
    expect(after - before).toBeLessThan(100);
  });

  it("watering an already-ready crop is a harmless no-op", () => {
    const t0 = 0;
    let tile = plantTile(t0);
    // one watering only ever banks up to waterEveryMs (no cheating by waiting
    // a long time and watering once) — reach ready via several waterings.
    let t = t0;
    while (growthMs(tile, turnip, t) < turnip.growMs) {
      t += turnip.waterEveryMs;
      tile = waterTile(tile, turnip, t);
    }
    expect(growthMs(tile, turnip, t)).toBe(turnip.growMs);
    expect(growthStage(tile, turnip, t)).toBe("ready");

    // water again, much later — still exactly ready, never "overflows"
    tile = waterTile(tile, turnip, turnip.growMs * 100);
    expect(growthMs(tile, turnip, turnip.growMs * 100)).toBe(turnip.growMs);
    expect(growthStage(tile, turnip, turnip.growMs * 100)).toBe("ready");
  });

  it("needsWater is false during the grace/watered window, true once it lapses, false again once ready", () => {
    const t0 = 0;
    const tile = plantTile(t0);
    expect(needsWater(tile, turnip, t0)).toBe(false);
    expect(needsWater(tile, turnip, turnip.waterEveryMs - 1)).toBe(false);
    expect(needsWater(tile, turnip, turnip.waterEveryMs)).toBe(true);
    expect(needsWater(tile, turnip, turnip.waterEveryMs + HOUR)).toBe(true);

    // once actually ready (fully watered path), needsWater must be false
    let t2: GrowthTile = plantTile(t0);
    let t = t0;
    const STEP = HOUR / 2;
    while (t < turnip.growMs) {
      t += STEP;
      t2 = waterTile(t2, turnip, t);
    }
    expect(needsWater(t2, turnip, t)).toBe(false);
  });

  it("stage thresholds land at the 1/3 and 2/3 growth marks", () => {
    const t0 = 0;
    const tile: GrowthTile = { plantedAt: t0, accruedMs: 0, lastWatered: t0 };
    const g = turnip.growMs;
    expect(growthStage({ ...tile, accruedMs: 0 }, turnip, t0)).toBe(0);
    expect(growthStage({ ...tile, accruedMs: g / 3 - 1000, lastWatered: t0 }, turnip, t0)).toBe(0);
    expect(growthStage({ ...tile, accruedMs: g / 3 + 1000, lastWatered: t0 }, turnip, t0)).toBe(1);
    expect(growthStage({ ...tile, accruedMs: (2 * g) / 3 + 1000, lastWatered: t0 }, turnip, t0)).toBe(2);
    expect(growthStage({ ...tile, accruedMs: g, lastWatered: t0 }, turnip, t0)).toBe("ready");
  });

  it("every crop is internally consistent (waterEveryMs < growMs, positive prices)", () => {
    for (const id of Object.keys(CROPS) as (keyof typeof CROPS)[]) {
      const c = CROPS[id];
      expect(c.waterEveryMs).toBeLessThan(c.growMs);
      expect(c.seedCost).toBeGreaterThan(0);
      expect(c.sellPrice).toBeGreaterThan(c.seedCost);
    }
  });
});

// ---- P5: the four new crops (strawberry / carrot / tomato / sunflower) -------
describe("growth.ts — P5 new crops", () => {
  const NEW: CropId[] = ["strawberry", "carrot", "tomato", "sunflower"];

  it("CROP_ORDER holds all 8 crops with the 4 new ones present", () => {
    expect(CROP_ORDER.length).toBe(8);
    for (const id of NEW) expect(CROP_ORDER).toContain(id);
  });

  for (const id of NEW) {
    describe(`${id}`, () => {
      const crop = CROPS[id];

      it("fresh plant is stage 0, ready exactly at growMs when watered through", () => {
        const t0 = 0;
        let tile: GrowthTile = plantTile(t0);
        expect(growthStage(tile, crop, t0)).toBe(0);
        // re-water every half-window until growMs elapses
        const STEP = crop.waterEveryMs / 2;
        let t = t0;
        while (t < crop.growMs) {
          t += STEP;
          tile = waterTile(tile, crop, t);
        }
        expect(growthMs(tile, crop, t)).toBe(crop.growMs);
        expect(growthStage(tile, crop, t)).toBe("ready");
      });

      it("stage progresses 0 -> 1 -> 2 across the 1/3 and 2/3 growth marks", () => {
        const t0 = 0;
        const base: GrowthTile = { plantedAt: t0, accruedMs: 0, lastWatered: t0 };
        const g = crop.growMs;
        expect(growthStage({ ...base, accruedMs: g / 3 - 1000 }, crop, t0)).toBe(0);
        expect(growthStage({ ...base, accruedMs: g / 3 + 1000 }, crop, t0)).toBe(1);
        expect(growthStage({ ...base, accruedMs: (2 * g) / 3 + 1000 }, crop, t0)).toBe(2);
        expect(growthStage({ ...base, accruedMs: g }, crop, t0)).toBe("ready");
      });

      it("unwatered growth pauses at the waterEveryMs boundary (kindness cap)", () => {
        const t0 = 0;
        const tile = plantTile(t0); // moist as of t0, never re-watered
        expect(growthMs(tile, crop, crop.waterEveryMs)).toBe(crop.waterEveryMs);
        // way past growMs, still capped at exactly one window — paused, never dead
        expect(growthMs(tile, crop, crop.growMs * 50)).toBe(crop.waterEveryMs);
        expect(growthStage(tile, crop, crop.growMs * 50)).not.toBe("ready");
      });

      it("waterTile banks the current window as a checkpoint and resumes accrual", () => {
        const t0 = 0;
        let tile = plantTile(t0);
        const stall = crop.growMs; // long past one window -> paused at waterEveryMs
        expect(growthMs(tile, crop, stall)).toBe(crop.waterEveryMs);
        tile = waterTile(tile, crop, stall);
        expect(tile.accruedMs).toBe(crop.waterEveryMs);
        expect(tile.lastWatered).toBe(stall);
        const later = stall + crop.waterEveryMs / 4;
        expect(growthMs(tile, crop, later)).toBe(crop.waterEveryMs + crop.waterEveryMs / 4);
      });

      it("needsWater is false during the grace window, true once it lapses", () => {
        const t0 = 0;
        const tile = plantTile(t0);
        expect(needsWater(tile, crop, t0)).toBe(false);
        expect(needsWater(tile, crop, crop.waterEveryMs - 1)).toBe(false);
        expect(needsWater(tile, crop, crop.waterEveryMs)).toBe(true);
      });
    });
  }

  it("balance: every crop's $/hr sits inside the base 4-crop band (~2.0–4.6)", () => {
    const HR = 3_600_000;
    for (const id of CROP_ORDER) {
      const c = CROPS[id];
      const perHr = c.sellPrice / (c.growMs / HR);
      expect(perHr).toBeGreaterThan(2.0);
      expect(perHr).toBeLessThan(4.6);
    }
  });
});

// ---------------------------------------------------------------------------
// FAST-GROW TEST MODE — effectiveCrop() scale accessor. The pure functions must
// stay unaffected (they only ever see whatever Crop they are handed); the scale
// lives entirely in effectiveCrop(), driven by the module flag.
// ---------------------------------------------------------------------------
describe("growth.ts — fast-grow scale accessor (effectiveCrop)", () => {
  afterEach(() => setFastGrow(false)); // never leak the flag between tests

  it("default OFF: isFastGrow() is false and effectiveCrop is the identity (table values)", () => {
    expect(isFastGrow()).toBe(false);
    for (const id of CROP_ORDER) {
      const ec = effectiveCrop(CROPS[id]);
      expect(ec.growMs).toBe(CROPS[id].growMs);
      expect(ec.waterEveryMs).toBe(CROPS[id].waterEveryMs);
      expect(ec.sellPrice).toBe(CROPS[id].sellPrice);
    }
  });

  it("setFastGrow(true): every crop matures in ~60s total (growMs = FAST_GROW_TOTAL_MS)", () => {
    setFastGrow(true);
    expect(isFastGrow()).toBe(true);
    for (const id of CROP_ORDER) {
      const ec = effectiveCrop(CROPS[id]);
      expect(ec.growMs).toBe(FAST_GROW_TOTAL_MS);
      expect(ec.growMs).toBe(60_000);
      expect(ec.waterEveryMs).toBe(30_000); // half the fast growth (see module doc)
      // identity fields untouched
      expect(ec.id).toBe(CROPS[id].id);
      expect(ec.sellPrice).toBe(CROPS[id].sellPrice);
    }
  });

  it("ON: one watering after the grace window carries a crop to maturity by ~60s", () => {
    setFastGrow(true);
    const ec = effectiveCrop(CROPS.pumpkin); // real 72h crop, effectively 60s
    let tile: GrowthTile = plantTile(0);
    // grace window banks the first 30s, then PAUSES (unwatered)
    expect(growthMs(tile, ec, 30_000)).toBe(30_000);
    expect(needsWater(tile, ec, 31_000)).toBe(true);
    // one watering opens a fresh 30s window
    tile = waterTile(tile, ec, 31_000);
    expect(growthStage(tile, ec, 61_000)).toBe("ready"); // ~60s of growth banked
  });

  it("ON: an UNWATERED crop still PAUSES (water-pause mechanic testable by not watering)", () => {
    setFastGrow(true);
    const ec = effectiveCrop(CROPS.turnip);
    const tile = plantTile(0);
    // grace window (30s) then pause at the halfway point — never ready
    expect(growthStage(tile, ec, 61_000)).not.toBe("ready");
    expect(growthMs(tile, ec, 61_000)).toBe(30_000);
    expect(growthMs(tile, ec, 60 * 60_000)).toBe(30_000); // still paused much later
  });

  it("purity preserved: the flag never leaks into the pure functions (real crop = real timeline)", () => {
    setFastGrow(true);
    // growthStage called with the REAL crop (not effectiveCrop) is unaffected by
    // the flag — 61s is nothing on a 4h turnip.
    const tile = plantTile(0);
    expect(growthStage(tile, CROPS.turnip, 61_000)).toBe(0);
    expect(growthMs(tile, CROPS.turnip, 61_000)).toBe(61_000);
  });

  it("effectiveCrop does not mutate its argument", () => {
    setFastGrow(true);
    const before = { ...CROPS.corn };
    effectiveCrop(CROPS.corn);
    expect(CROPS.corn.growMs).toBe(before.growMs);
    expect(CROPS.corn.waterEveryMs).toBe(before.waterEveryMs);
  });
});
