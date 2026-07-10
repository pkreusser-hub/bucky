import { describe, it, expect } from "vitest";
import {
  ANIMAL_DEFS,
  CARE_WINDOW_MS,
  produceMs,
  produceReady,
  collectProduce,
  resolveAnimalAction,
  starterHerd,
  sanitizeAnimal,
  STARTER_HERD,
  homeSpot,
  hashSeed,
  mulberry32,
  type AnimalCareTile,
} from "./animals";

const goat = ANIMAL_DEFS.goat; // produceEveryMs 12h, produceId "milk"
const chicken = ANIMAL_DEFS.chicken; // produceEveryMs 8h, produceId "egg"
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("animals.ts — pure produce/care model (husbandry rework)", () => {
  it("freshly born animal has zero produce", () => {
    const t0 = 1_000_000;
    const a: AnimalCareTile = { lastFed: t0, accruedMs: 0 };
    expect(produceMs(a, goat, t0)).toBe(0);
    expect(produceReady(a, goat, t0)).toBe(false);
  });

  it("goat milk becomes ready after 12h with no action (grazing feeds them)", () => {
    const a: AnimalCareTile = { lastFed: 0, accruedMs: 0 };
    expect(produceReady(a, goat, goat.produceEveryMs - 1000)).toBe(false);
    expect(produceReady(a, goat, goat.produceEveryMs)).toBe(true);
  });

  it("chicken egg becomes ready after 8h with no action", () => {
    const a: AnimalCareTile = { lastFed: 0, accruedMs: 0 };
    expect(produceReady(a, chicken, chicken.produceEveryMs - 1)).toBe(false);
    expect(produceReady(a, chicken, chicken.produceEveryMs)).toBe(true);
  });

  it("produce never exceeds one unit worth, however long it waits (kindness cap)", () => {
    const a: AnimalCareTile = { lastFed: 0, accruedMs: 0 };
    expect(produceMs(a, goat, 90 * DAY)).toBe(goat.produceEveryMs);
    expect(produceReady(a, goat, 90 * DAY)).toBe(true);
  });

  it("CARE SEMANTICS: a 7-day absence leaves EXACTLY ONE produce waiting per animal, never sick/dead", () => {
    const goatT: AnimalCareTile = { lastFed: 0, accruedMs: 0 };
    const chickT: AnimalCareTile = { lastFed: 0, accruedMs: 0 };
    const now = 7 * DAY;
    // exactly one waiting each (capped at produceEveryMs, not 7 days' worth)
    expect(produceReady(goatT, goat, now)).toBe(true);
    expect(produceMs(goatT, goat, now)).toBe(goat.produceEveryMs);
    expect(produceReady(chickT, chicken, now)).toBe(true);
    expect(produceMs(chickT, chicken, now)).toBe(chicken.produceEveryMs);
    // there is no hunger/sickness concept anywhere in this module's surface.
  });

  it("collectProduce consumes the ready unit and starts a fresh cycle", () => {
    let a: AnimalCareTile = { lastFed: 0, accruedMs: 0 };
    const readyAt = goat.produceEveryMs;
    expect(produceReady(a, goat, readyAt)).toBe(true);
    a = collectProduce(a, goat, readyAt);
    expect(produceReady(a, goat, readyAt)).toBe(false);
    expect(produceMs(a, goat, readyAt)).toBe(0);
    // the very next unit still takes a fresh produceEveryMs to arrive
    expect(produceReady(a, goat, readyAt + goat.produceEveryMs - 1000)).toBe(false);
    expect(produceReady(a, goat, readyAt + goat.produceEveryMs)).toBe(true);
  });

  it("collecting when not actually ready yields zero produce going forward (no garbage state)", () => {
    let a: AnimalCareTile = { lastFed: 0, accruedMs: 0 };
    a = collectProduce(a, goat, 1000);
    expect(produceMs(a, goat, 1000)).toBe(0);
    expect(produceReady(a, goat, 1000)).toBe(false);
  });

  describe("resolveAnimalAction: milk-ready goat → collect, else pet (no feed)", () => {
    it("a goat with milk ready resolves to COLLECT (milking)", () => {
      const a: AnimalCareTile = { lastFed: 0, accruedMs: 0 };
      expect(resolveAnimalAction(a, goat, goat.produceEveryMs)).toBe("collect");
    });

    it("a goat with NO milk ready resolves to PET (the second hand-action)", () => {
      const a: AnimalCareTile = { lastFed: 0, accruedMs: 0 };
      expect(resolveAnimalAction(a, goat, HOUR)).toBe("pet");
      // right after milking → pet
      const milked = collectProduce(a, goat, goat.produceEveryMs);
      expect(resolveAnimalAction(milked, goat, goat.produceEveryMs)).toBe("pet");
    });

    it("a chicken ALWAYS resolves to PET — its eggs are physical (never collected off the bird)", () => {
      const a: AnimalCareTile = { lastFed: 0, accruedMs: 0 };
      expect(produceReady(a, chicken, chicken.produceEveryMs)).toBe(true); // egg IS ready...
      expect(resolveAnimalAction(a, chicken, chicken.produceEveryMs)).toBe("pet"); // ...but hand-action pets
      expect(resolveAnimalAction(a, chicken, HOUR)).toBe("pet");
    });
  });

  describe("herd generation", () => {
    it("starterHerd has exactly 2 goats + 3 chickens with the expected ids/names", () => {
      const herd = starterHerd(1000);
      const ids = Object.keys(herd);
      expect(ids.length).toBe(5);
      expect(ids.filter((id) => herd[id].type === "goat").length).toBe(2);
      expect(ids.filter((id) => herd[id].type === "chicken").length).toBe(3);
      expect(herd.goat1.name).toBe("Clover");
      expect(herd.chicken1.name).toBe("Henrietta");
      for (const id of ids) {
        expect(herd[id].bornAt).toBe(1000);
        expect(herd[id].lastFed).toBe(1000);
        expect(herd[id].accruedMs).toBe(0);
      }
    });

    it("STARTER_HERD ids are all unique", () => {
      const ids = STARTER_HERD.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("sanitizeAnimal falls back to a fresh known animal on garbage input", () => {
      expect(sanitizeAnimal("goat1", null, 5000)).toEqual({
        id: "goat1",
        type: "goat",
        name: "Clover",
        bornAt: 5000,
        lastFed: 5000,
        accruedMs: 0,
        lastPet: 0,
      });
      expect(sanitizeAnimal("goat1", { lastFed: "nope", accruedMs: -5 }, 5000)?.accruedMs).toBe(0);
    });

    it("MIGRATION: an old-shape doc with a legacy lastFed loads clean (no wipe, no dupe)", () => {
      // pre-rework saves stored lastFed as the feeding checkpoint; it still means
      // "cycle checkpoint" now, so it loads verbatim and produce math is unchanged.
      const raw = { bornAt: 10, lastFed: 20, accruedMs: 500, lastPet: 30, name: "Clover" };
      const a = sanitizeAnimal("goat1", raw, 99999);
      expect(a).toEqual({ id: "goat1", type: "goat", name: "Clover", bornAt: 10, lastFed: 20, accruedMs: 500, lastPet: 30 });
    });

    it("sanitizeAnimal returns null for an unknown id (future herd growth ignored gracefully)", () => {
      expect(sanitizeAnimal("dragon99", { bornAt: 1 }, 0)).toBeNull();
    });
  });

  describe("deterministic wander seeding", () => {
    it("hashSeed + mulberry32 are deterministic (same id -> same sequence)", () => {
      const s1 = mulberry32(hashSeed("goat1"));
      const s2 = mulberry32(hashSeed("goat1"));
      expect(s1()).toBe(s2());
      expect(s1()).toBe(s2());
    });

    it("different ids produce different seeds", () => {
      expect(hashSeed("goat1")).not.toBe(hashSeed("goat2"));
    });

    it("homeSpot stays within the pen radius, deterministically", () => {
      const pen = { cx: 24, cz: 10, r: 6 };
      for (const spec of STARTER_HERD) {
        const p = homeSpot(spec.id, pen);
        const d = Math.hypot(p.x - pen.cx, p.z - pen.cz);
        expect(d).toBeLessThanOrEqual(pen.r);
        expect(homeSpot(spec.id, pen)).toEqual(p);
      }
    });
  });

  it("every animal def is internally consistent (sane cadence, positive sell price)", () => {
    for (const def of Object.values(ANIMAL_DEFS)) {
      expect(def.produceEveryMs).toBeLessThan(CARE_WINDOW_MS);
      expect(def.sellPrice).toBeGreaterThan(0);
    }
  });
});
