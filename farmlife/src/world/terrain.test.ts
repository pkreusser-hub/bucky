import { describe, it, expect } from "vitest";
import {
  sampleHeight,
  setActiveWorld,
  fieldProtected,
  pathBlend,
  FIELD,
  PROTECT_MARGIN,
} from "./terrain";
import { emptyWorldData, sampleField } from "./worldData";

// ---------------------------------------------------------------------------
// BYTE-IDENTITY GUARANTEE (Farm Kart Stage-A lesson): with no world data — or a
// world with empty cells — sampleHeight must equal the ORIGINAL handcrafted
// valley formula EXACTLY. This reference duplicates the pre-P1.5b terrain math
// verbatim; any drift in the refactor fails here.
// ---------------------------------------------------------------------------
const AMP = 1.9;
const POND = { cx: 30, cz: -26, r: 10, waterY: -1.15 };
function baseHills(x: number, z: number): number {
  return (
    AMP * Math.sin(x * 0.045 + 0.5) * Math.cos(z * 0.05) +
    AMP * 0.5 * Math.sin(x * 0.09 - z * 0.06) +
    AMP * 0.35 * Math.cos(z * 0.13 + 1.3)
  );
}
function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function refHeight(x: number, z: number): number {
  let h = baseHills(x, z);
  const dxF = Math.abs(x - FIELD.cx);
  const dzF = Math.abs(z - FIELD.cz);
  const inField = Math.max(dxF, dzF);
  const fBlend = 1 - smooth(FIELD.half, FIELD.half + 6, inField);
  h = h * (1 - fBlend) + FIELD.y * fBlend;
  const dP = Math.hypot(x - POND.cx, z - POND.cz);
  if (dP < POND.r + 8) {
    const bowl = 1 - smooth(POND.r - 2, POND.r + 8, dP);
    const floor = POND.waterY - 0.6;
    h = h * (1 - bowl) + floor * bowl;
  }
  return h;
}

function gridMaxDiff(): number {
  let max = 0;
  for (let x = -60; x <= 60; x += 5) {
    for (let z = -60; z <= 60; z += 5) {
      max = Math.max(max, Math.abs(sampleHeight(x, z) - refHeight(x, z)));
    }
  }
  return max;
}

// NOTE (painted-paths change, playtest fix batch): the default valley walkways
// moved from disc MESHES (scenery.ts buildPath) to baked ground COLOR
// (terrain.ts pathBlend). That is a color-only change — sampleHeight is NOT
// affected, so this byte-identity guarantee below still holds exactly (0.0).
describe("sampleHeight byte-identity (empty world)", () => {
  it("matches the original valley exactly with no active world", () => {
    setActiveWorld(null);
    expect(gridMaxDiff()).toBe(0);
  });

  it("matches exactly with an active but EMPTY world", () => {
    setActiveWorld(emptyWorldData());
    expect(gridMaxDiff()).toBe(0);
    setActiveWorld(null);
  });
});

describe("world sculpt deltas", () => {
  it("adds the sculpt delta outside the field, ignores it inside", () => {
    const w = emptyWorldData();
    // raise a broad area centred near the pond-free NE grass (x 40, z 40)
    for (let i = 9; i <= 11; i++) for (let j = 9; j <= 11; j++) w.terrain.cells[`${i},${j}`] = 5;
    setActiveWorld(w);
    const gx = 40, gz = 40; // 10*cell(4)=40
    const expected = refHeight(gx, gz) + sampleField(w.terrain, gx, gz);
    expect(sampleHeight(gx, gz)).toBeCloseTo(expected, 9);
    expect(sampleField(w.terrain, gx, gz)).toBeGreaterThan(1);

    // A delta authored ON TOP of the field must be ignored (field stays flat).
    const w2 = emptyWorldData();
    const fi = Math.round(FIELD.cx / w2.terrain.cell);
    const fj = Math.round(FIELD.cz / w2.terrain.cell);
    w2.terrain.cells[`${fi},${fj}`] = 8;
    setActiveWorld(w2);
    expect(sampleHeight(FIELD.cx, FIELD.cz)).toBeCloseTo(refHeight(FIELD.cx, FIELD.cz), 9);
    setActiveWorld(null);
  });
});

describe("default valley paths (baked color, pathBlend)", () => {
  it("is ~1 on the path spine, 0 far away, and 0 inside the field", () => {
    // a mid-path point on the house->field-gate leg (near [16,14])
    expect(pathBlend(16, 14)).toBeGreaterThan(0.9);
    // open grass far from every path leg
    expect(pathBlend(-45, 45)).toBe(0);
    // the farming plot keeps its own dirt look — never path-tinted
    expect(pathBlend(FIELD.cx, FIELD.cz)).toBe(0);
  });
  it("feathers from spine to grass (monotonic falloff away from a leg)", () => {
    // step away (increasing z) from the farmhouse path endpoint [24,20], which
    // is well outside the field so it stays path-tinted
    const on = pathBlend(24, 20);
    const mid = pathBlend(24, 23);
    const off = pathBlend(24, 26);
    expect(on).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(off);
    expect(off).toBe(0);
  });
});

describe("fieldProtected predicate", () => {
  it("is true inside the field + margin, false well outside", () => {
    expect(fieldProtected(FIELD.cx, FIELD.cz)).toBe(true);
    expect(fieldProtected(FIELD.cx + FIELD.half, FIELD.cz)).toBe(true);
    // just inside the margin edge
    expect(fieldProtected(FIELD.cx + FIELD.half + PROTECT_MARGIN - 0.01, FIELD.cz)).toBe(true);
    // just outside the margin
    expect(fieldProtected(FIELD.cx + FIELD.half + PROTECT_MARGIN + 0.5, FIELD.cz)).toBe(false);
    expect(fieldProtected(50, 50)).toBe(false);
  });
});
