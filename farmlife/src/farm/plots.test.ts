import { describe, expect, it } from "vitest";
import {
  spacingOk,
  patchCoverageAt,
  isTilledAt,
  nearestPatch,
  tillableAt,
  inBuilding,
  migrateTilesToFreeform,
  PATCH_RADIUS,
  PLANT_MIN_SPACING,
  BUILDINGS,
  type Plant,
  type TilledPatch,
} from "./plots";
import { tileCenter } from "./grid";
import type { TileRecord } from "./store";

function plant(id: string, x: number, z: number): Plant {
  return { id, x, z, crop: "turnip", plantedAt: 0, accruedMs: 0, lastWatered: 0, waterings: 0 };
}
function patch(id: string, x: number, z: number, r = PATCH_RADIUS): TilledPatch {
  return { id, x, z, r };
}

describe("plots — spacing check", () => {
  it("rejects a plant closer than PLANT_MIN_SPACING to any existing plant", () => {
    const plants = { a: plant("a", 0, 0) };
    expect(spacingOk(plants, PLANT_MIN_SPACING - 0.01, 0)).toBe(false);
    expect(spacingOk(plants, PLANT_MIN_SPACING + 0.01, 0)).toBe(true);
  });
  it("empty field always accepts a plant", () => {
    expect(spacingOk({}, 5, 5)).toBe(true);
  });
  it("ignoreId excludes a plant from the check (moving/self)", () => {
    const plants = { a: plant("a", 0, 0) };
    expect(spacingOk(plants, 0.1, 0)).toBe(false);
    expect(spacingOk(plants, 0.1, 0, "a")).toBe(true);
  });
  it("min spacing is exactly 0.7 m", () => {
    expect(PLANT_MIN_SPACING).toBe(0.7);
  });
});

describe("plots — patch coverage / merge (blob auto-tiler math)", () => {
  it("a point inside a patch core is fully covered; outside is 0", () => {
    const patches = { a: patch("a", 0, 0, 1.0) };
    expect(patchCoverageAt(patches, 0, 0)).toBe(1);
    expect(patchCoverageAt(patches, 2, 0)).toBe(0);
  });
  it("two OVERLAPPING patches merge — the point between them is covered (one blob)", () => {
    // centres 1 m apart, r 0.9 each → they overlap; the midpoint (0.5) is inside both
    const patches = { a: patch("a", 0, 0, 0.9), b: patch("b", 1, 0, 0.9) };
    expect(isTilledAt(patches, 0.5, 0)).toBe(true);
    expect(patchCoverageAt(patches, 0.5, 0)).toBeGreaterThan(0);
    // a gap BEYOND both (2.5 m out) is not covered
    expect(isTilledAt(patches, 2.5, 0)).toBe(false);
  });
  it("coverage takes the MAX over patches (a point in one patch reads covered even if far from another)", () => {
    const patches = { a: patch("a", 0, 0, 0.9), b: patch("b", 50, 50, 0.9) };
    expect(patchCoverageAt(patches, 0, 0)).toBe(1);
  });
  it("nearestPatch finds the closest patch centre within maxDist (for hoe extend)", () => {
    const patches = { a: patch("a", 0, 0), b: patch("b", 3, 0) };
    expect(nearestPatch(patches, 0.3, 0, 0.75)?.id).toBe("a");
    expect(nearestPatch(patches, 10, 0, 0.75)).toBeNull();
  });
});

describe("plots — tillable geometry", () => {
  it("open grass is tillable; the fenced field (grass now) is tillable too", () => {
    expect(tillableAt(-40, -40)).toBe(true); // far open grass
    expect(tillableAt(-6, 6)).toBe(true); // field centre (grass now)
  });
  it("the pond, the pasture interior, and building footprints are NOT tillable", () => {
    expect(tillableAt(30, -26)).toBe(false); // pond centre
    expect(tillableAt(37, 0)).toBe(false); // inside the pasture
    expect(tillableAt(24, 18)).toBe(false); // farmhouse footprint
  });
  it("inBuilding matches the solid footprints", () => {
    expect(inBuilding(24, 18)).toBe(true); // farmhouse
    expect(inBuilding(0, 0)).toBe(false);
  });
  it("all four buildings have a footprint box", () => {
    expect(BUILDINGS.map((b) => b.id).sort()).toEqual(["bin", "farmhouse", "silo", "stand"]);
  });
});

describe("plots — one-time tile → free-form migration", () => {
  it("a planted tile becomes a plant + a patch at the tile centre (deterministic ids)", () => {
    const tiles: Record<string, TileRecord> = { t_5_5: { crop: "corn", plantedAt: 100, accruedMs: 50, lastWatered: 120 } };
    const { plants, patches } = migrateTilesToFreeform(tiles);
    const c = tileCenter(5, 5);
    expect(Object.keys(plants)).toEqual(["p_mig_5_5"]);
    expect(Object.keys(patches)).toEqual(["tp_mig_5_5"]);
    expect(plants.p_mig_5_5).toMatchObject({ crop: "corn", x: c.x, z: c.z, plantedAt: 100, accruedMs: 50, lastWatered: 120, waterings: 0 });
    expect(patches.tp_mig_5_5).toMatchObject({ x: c.x, z: c.z, r: PATCH_RADIUS });
  });
  it("a bare TILLED tile becomes a patch only (no plant)", () => {
    const { plants, patches } = migrateTilesToFreeform({ t_2_3: {} });
    expect(Object.keys(plants)).toEqual([]);
    expect(Object.keys(patches)).toEqual(["tp_mig_2_3"]);
  });
  it("is IDEMPOTENT — running twice yields the SAME ids (no duplicates)", () => {
    const tiles: Record<string, TileRecord> = { t_1_1: { crop: "turnip", plantedAt: 0, accruedMs: 0, lastWatered: 0 }, t_2_2: {} };
    const a = migrateTilesToFreeform(tiles);
    const b = migrateTilesToFreeform(tiles);
    expect(Object.keys(a.plants)).toEqual(Object.keys(b.plants));
    expect(Object.keys(a.patches).sort()).toEqual(Object.keys(b.patches).sort());
  });
  it("lastWatered falls back to plantedAt when absent", () => {
    const { plants } = migrateTilesToFreeform({ t_0_0: { crop: "turnip", plantedAt: 555 } });
    expect(plants.p_mig_0_0.lastWatered).toBe(555);
  });
});
