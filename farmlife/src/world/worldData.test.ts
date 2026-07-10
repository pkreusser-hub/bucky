import { describe, it, expect } from "vitest";
import {
  sanitizeWorldData,
  serializeWorldData,
  emptyWorldData,
  isEmptyWorldData,
  sampleField,
  sampleColor,
  CELL,
} from "./worldData";

describe("sanitizeWorldData", () => {
  it("returns an empty world for garbage input", () => {
    for (const bad of [null, undefined, 42, "x", [], { terrain: 5 }]) {
      const w = sanitizeWorldData(bad);
      expect(isEmptyWorldData(w)).toBe(true);
      expect(w.terrain.cell).toBe(CELL);
      expect(w.objects).toEqual([]);
    }
  });

  it("keeps valid terrain/paint cells and drops invalid keys/values", () => {
    const w = sanitizeWorldData({
      terrain: { cell: 4, cells: { "0,0": 2.345, "1,0": 0.001, bad: 5, "2,2": "nope" } },
      paint: { cell: 4, cells: { "0,0": 0x8a5a34, "1,1": -3, "2,2": 0x1000000 } },
    });
    // 2.345 rounded to 2 dp; 0.001 below the 0.01 floor -> dropped; bad key/value dropped
    expect(w.terrain.cells).toEqual({ "0,0": 2.35 });
    // only the in-range color survives
    expect(w.paint.cells).toEqual({ "0,0": 0x8a5a34 });
  });

  it("keeps valid objects with defaults, skips objects missing coords", () => {
    const w = sanitizeWorldData({
      objects: [
        { type: "barn", x: 10, y: 3, z: -4, tag: "home", rotY: 1, sx: 8, sy: 6, sz: 6 },
        { type: "tree", x: "bad", y: 0, z: 0 }, // skipped (x not finite)
        { x: 1, y: 1, z: 1 }, // type defaults to tree, id auto
      ],
    });
    expect(w.objects).toHaveLength(2);
    expect(w.objects[0]).toMatchObject({ type: "barn", x: 10, tag: "home", sx: 8 });
    expect(w.objects[1].type).toBe("tree");
    expect(w.objects[1].id).toMatch(/^obj_/);
  });

  it("keeps fences with >=2 valid points, drops short ones", () => {
    const w = sanitizeWorldData({
      fences: [
        { points: [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }], height: 1.4 },
        { points: [{ x: 0, z: 0 }] }, // too short -> dropped
        { points: [{ x: 0, z: 0 }, { x: "n", z: 0 }] }, // one bad point -> only 1 valid -> dropped
      ],
    });
    expect(w.fences).toHaveLength(1);
    expect(w.fences[0].points).toHaveLength(3);
    expect(w.fences[0].height).toBe(1.4);
  });

  it("round-trips through serialize (empty sections omitted)", () => {
    const empty = serializeWorldData(emptyWorldData());
    expect(empty).toEqual({});
    const w = sanitizeWorldData({ terrain: { cell: 4, cells: { "0,0": 3 } } });
    const ser = serializeWorldData(w);
    expect(ser.terrain).toBeDefined();
    expect(ser.paint).toBeUndefined();
    expect(ser.objects).toBeUndefined();
    // re-sanitizing the serialized form is stable
    expect(sanitizeWorldData(ser).terrain.cells).toEqual({ "0,0": 3 });
  });
});

describe("sampleField (bilinear)", () => {
  const field = { cell: 4, cells: { "0,0": 10, "1,0": 20, "0,1": 30, "1,1": 50 } };

  it("returns 0 for an empty/absent field", () => {
    expect(sampleField(null, 5, 5)).toBe(0);
    expect(sampleField({ cell: 4, cells: {} }, 5, 5)).toBe(0);
  });

  it("returns the exact grid value at grid points", () => {
    expect(sampleField(field, 0, 0)).toBe(10);
    expect(sampleField(field, 4, 0)).toBe(20); // (1,0)
    expect(sampleField(field, 0, 4)).toBe(30); // (0,1)
    expect(sampleField(field, 4, 4)).toBe(50); // (1,1)
  });

  it("interpolates linearly along an edge", () => {
    // x=2 (fx=0.5) between (0,0)=10 and (1,0)=20 -> 15
    expect(sampleField(field, 2, 0)).toBeCloseTo(15, 9);
    // z=2 (fz=0.5) between (0,0)=10 and (0,1)=30 -> 20
    expect(sampleField(field, 0, 2)).toBeCloseTo(20, 9);
  });

  it("bilinearly interpolates the cell interior (center)", () => {
    // center of the cell -> mean of the 4 corners = (10+20+30+50)/4 = 27.5
    expect(sampleField(field, 2, 2)).toBeCloseTo(27.5, 9);
  });

  it("reads missing neighbours as 0", () => {
    // cell (1..2, 0) has corners (1,0)=20,(2,0)=0,(1,1)=50,(2,1)=0; at x=6,z=0 (fx=1.5) -> 10
    expect(sampleField(field, 6, 0)).toBeCloseTo(10, 9);
  });
});

describe("sampleColor", () => {
  const base: [number, number, number] = [0.4, 0.6, 0.2];

  it("returns the base color where unpainted", () => {
    expect(sampleColor(null, 5, 5, base)).toEqual(base);
    expect(sampleColor({ cell: 4, cells: {} }, 5, 5, base)).toEqual(base);
  });

  it("returns the painted color at a painted grid point", () => {
    const f = { cell: 4, cells: { "0,0": 0xff8040 } };
    const out = sampleColor(f, 0, 0, base);
    expect(out[0]).toBeCloseTo(1, 5);
    expect(out[1]).toBeCloseTo(0x80 / 255, 5);
    expect(out[2]).toBeCloseTo(0x40 / 255, 5);
  });

  it("feathers a painted cell into the base color of its neighbour", () => {
    const f = { cell: 4, cells: { "0,0": 0xffffff } }; // white at (0,0), base elsewhere
    // halfway to (1,0) which is unpainted -> midpoint of white and base
    const out = sampleColor(f, 2, 0, base);
    expect(out[0]).toBeCloseTo((1 + base[0]) / 2, 5);
    expect(out[1]).toBeCloseTo((1 + base[1]) / 2, 5);
  });
});
