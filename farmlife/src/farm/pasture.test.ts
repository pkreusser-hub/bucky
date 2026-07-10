import { describe, it, expect } from "vitest";
import {
  PASTURE,
  BARN,
  DOOR,
  SILO,
  containAnimal,
  pointInRect,
  insideBarn,
  dayPhase,
  grazeSpot,
  barnSleepSpot,
  nestSpot,
  eggId,
  CHICKEN_IDS,
  DOOR_OUTSIDE,
} from "./pasture";
import { mulberry32, hashSeed } from "./animals";

const R = 0.45;

describe("pasture.ts — geometry + containment", () => {
  it("the pasture encloses the barn", () => {
    expect(pointInRect(BARN.minX, BARN.minZ, PASTURE)).toBe(true);
    expect(pointInRect(BARN.maxX, BARN.maxZ, PASTURE)).toBe(true);
  });

  it("containAnimal keeps a point inside the pasture bounds (never past the fence)", () => {
    for (const [x, z] of [
      [1000, 0], [-1000, 0], [0, 1000], [0, -1000], [PASTURE.maxX + 5, PASTURE.minZ - 5],
    ] as [number, number][]) {
      const c = containAnimal(x, z, R, true);
      expect(c.x).toBeGreaterThanOrEqual(PASTURE.minX + R - 1e-6);
      expect(c.x).toBeLessThanOrEqual(PASTURE.maxX - R + 1e-6);
      expect(c.z).toBeGreaterThanOrEqual(PASTURE.minZ + R - 1e-6);
      expect(c.z).toBeLessThanOrEqual(PASTURE.maxZ - R + 1e-6);
    }
  });

  it("an animal cannot walk through a barn WALL (pushed out)", () => {
    // aim at the middle of the north wall from just outside
    const c = containAnimal((BARN.minX + BARN.maxX) / 2, BARN.maxZ + 0.05, R, true);
    // pushed to the outer (pasture) side of the north wall
    expect(c.z).toBeGreaterThan(BARN.maxZ);
  });

  it("an animal CAN pass the door gap when OPEN, but is blocked when CLOSED", () => {
    const doorX = (DOOR.x0 + DOOR.x1) / 2;
    // door OPEN: the doorway is a free gap — a point just inside AND just outside
    // both stay put (the animal can occupy either side → it can walk through).
    const openIn = containAnimal(doorX, DOOR.z + 0.25, R, true);
    const openOut = containAnimal(doorX, DOOR.z - 0.25, R, true);
    expect(openIn.z).toBeGreaterThan(DOOR.z); // still inside, not ejected
    expect(openOut.z).toBeLessThan(DOOR.z); // still outside, not sucked in
    expect(Math.abs(openIn.x - doorX)).toBeLessThan(0.2);
    // door CLOSED: an animal outside the door can't reach the threshold — the
    // sealed wall shoves it back into the pasture (z well below the wall).
    const shut = containAnimal(doorX, DOOR.z - 0.25, R, false);
    expect(shut.z).toBeLessThan(DOOR.z - R + 0.01);
  });

  it("animals steer around the silo", () => {
    const c = containAnimal(SILO.x, SILO.z, R, true);
    expect(Math.hypot(c.x - SILO.x, c.z - SILO.z)).toBeGreaterThanOrEqual(SILO.r + R - 1e-6);
  });

  it("grazeSpot always lands in the open pasture, clear of the barn + silo", () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 200; i++) {
      const s = grazeSpot(rng);
      expect(pointInRect(s.x, s.z, PASTURE)).toBe(true);
      expect(insideBarn(s.x, s.z)).toBe(false);
      expect(Math.hypot(s.x - SILO.x, s.z - SILO.z)).toBeGreaterThan(SILO.r);
    }
  });

  it("barnSleepSpot / nestSpot sit inside the barn interior, deterministically", () => {
    for (const id of ["goat1", "goat2", ...CHICKEN_IDS]) {
      const s = barnSleepSpot(id);
      expect(insideBarn(s.x, s.z)).toBe(true);
      expect(barnSleepSpot(id)).toEqual(s); // deterministic
    }
    for (const id of CHICKEN_IDS) {
      const n = nestSpot(id);
      expect(insideBarn(n.x, n.z)).toBe(true);
    }
  });

  it("DOOR_OUTSIDE is a real settle spot outside the barn but inside the pasture", () => {
    expect(insideBarn(DOOR_OUTSIDE.x, DOOR_OUTSIDE.z)).toBe(false);
    expect(pointInRect(DOOR_OUTSIDE.x, DOOR_OUTSIDE.z, PASTURE)).toBe(true);
  });

  it("eggId is deterministic per (chicken, cycle) — same cycle → same key (no dup spawn)", () => {
    expect(eggId("chicken1", 1000)).toBe(eggId("chicken1", 1000));
    expect(eggId("chicken1", 1000.4)).toBe(eggId("chicken1", 1000)); // rounded
    expect(eggId("chicken1", 1000)).not.toBe(eggId("chicken1", 2000)); // new cycle
    expect(eggId("chicken1", 1000)).not.toBe(eggId("chicken2", 1000)); // per bird
  });

  it("dayPhase covers the full day and hits every phase", () => {
    // build ms for a Central hour by sampling a known UTC day and offsetting.
    // Simpler: assert the boundaries via a helper that maps hour->phase name.
    const phaseAtHour = (h: number): string => {
      // reconstruct a timestamp whose Central hour ≈ h is DST-dependent; instead
      // test the pure boundaries indirectly through several real timestamps.
      return h + ""; // placeholder — real assertions below use dayPhase directly
    };
    void phaseAtHour;
    // dayPhase is a pure function of centralHour(ms); assert it returns a valid
    // phase for a spread of timestamps across ~48h (never throws / undefined).
    const seen = new Set<string>();
    for (let i = 0; i < 48; i++) {
      const ms = Date.UTC(2026, 6, 10, 0, 0, 0) + i * 3_600_000;
      const p = dayPhase(ms);
      expect(["day", "dusk", "night", "dawn"]).toContain(p);
      seen.add(p);
    }
    expect(seen.has("day")).toBe(true);
    expect(seen.has("night")).toBe(true);
    expect(seen.has("dawn")).toBe(true);
    expect(seen.has("dusk")).toBe(true);
  });

  it("hashSeed determinism underpins the wander seeds", () => {
    expect(hashSeed("goat1")).toBe(hashSeed("goat1"));
  });
});
