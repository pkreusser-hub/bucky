import { describe, it, expect } from "vitest";
import { makeProj, worldToMap, worldLenToMap, arrowPoints } from "./mapProjection";

describe("mapProjection", () => {
  it("maps world center to canvas center", () => {
    const p = makeProj(600, 60, 15);
    const { mx, my } = worldToMap(0, 0, p);
    expect(mx).toBeCloseTo(300, 5);
    expect(my).toBeCloseTo(300, 5);
  });

  it("maps the corners to the padded edges", () => {
    const p = makeProj(600, 60, 15);
    const a = worldToMap(-60, -60, p);
    expect(a.mx).toBeCloseTo(15, 5);
    expect(a.my).toBeCloseTo(15, 5);
    const b = worldToMap(60, 60, p);
    expect(b.mx).toBeCloseTo(585, 5);
    expect(b.my).toBeCloseTo(585, 5);
  });

  it("+X maps to canvas-right and +Z maps to canvas-down (monotonic)", () => {
    const p = makeProj(600, 60, 15);
    const a = worldToMap(-10, -10, p);
    const b = worldToMap(10, 10, p);
    expect(b.mx).toBeGreaterThan(a.mx);
    expect(b.my).toBeGreaterThan(a.my);
  });

  it("worldLenToMap scales by the same factor as worldToMap", () => {
    const p = makeProj(600, 60, 15);
    const a = worldToMap(0, 0, p);
    const b = worldToMap(5, 0, p);
    expect(worldLenToMap(5, p)).toBeCloseTo(b.mx - a.mx, 6);
  });

  it("arrowPoints: heading 0 points toward +Z (canvas down)", () => {
    const pts = arrowPoints(0, 0, 0, 10, 5);
    expect(pts.tip.x).toBeCloseTo(0, 6);
    expect(pts.tip.y).toBeCloseTo(10, 6);
  });

  it("arrowPoints: heading PI/2 points toward +X (canvas right)", () => {
    const pts = arrowPoints(0, 0, Math.PI / 2, 10, 5);
    expect(pts.tip.x).toBeCloseTo(10, 5);
    expect(pts.tip.y).toBeCloseTo(0, 5);
  });

  it("arrowPoints: left/right are symmetric around the back-center", () => {
    const pts = arrowPoints(2, 3, 1.1, 12, 6);
    const midX = (pts.left.x + pts.right.x) / 2;
    const midY = (pts.left.y + pts.right.y) / 2;
    // back-center = cx - fwd*base*0.4
    const fx = Math.sin(1.1), fz = Math.cos(1.1);
    expect(midX).toBeCloseTo(2 - fx * 6 * 0.4, 5);
    expect(midY).toBeCloseTo(3 - fz * 6 * 0.4, 5);
  });
});
