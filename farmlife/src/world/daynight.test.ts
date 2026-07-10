import { describe, it, expect } from "vitest";
import { frameAtHour, skyAt, centralHour, DAYNIGHT_FRAMES } from "./daynight";

describe("daynight.ts — pure keyframe interpolation", () => {
  it("midnight/deep-night hours land exactly on the NIGHT frame", () => {
    expect(frameAtHour(0)).toEqual(DAYNIGHT_FRAMES.NIGHT);
    expect(frameAtHour(2)).toEqual(DAYNIGHT_FRAMES.NIGHT);
    expect(frameAtHour(23.9).starAlpha).toBeGreaterThan(0.9);
  });
  it("mid-day hours land exactly on the DAY frame", () => {
    expect(frameAtHour(12)).toEqual(DAYNIGHT_FRAMES.DAY);
    expect(frameAtHour(12).starAlpha).toBe(0);
  });
  it("dawn/dusk are distinct intermediate states, not equal to night or day", () => {
    const dawn = frameAtHour(6.5);
    const dusk = frameAtHour(19);
    expect(dawn.starAlpha).toBeCloseTo(DAYNIGHT_FRAMES.DAWN.starAlpha, 5);
    expect(dawn.windowGlow).toBeCloseTo(DAYNIGHT_FRAMES.DAWN.windowGlow, 5);
    expect(dusk.starAlpha).toBeCloseTo(DAYNIGHT_FRAMES.DUSK.starAlpha, 5);
    expect(dawn.starAlpha).not.toBeCloseTo(DAYNIGHT_FRAMES.NIGHT.starAlpha, 2);
    expect(dawn.sky).not.toEqual(DAYNIGHT_FRAMES.DAY.sky);
    expect(dusk.sky).not.toEqual(dawn.sky);
  });
  it("interpolates smoothly between night and dawn (monotonic starAlpha fade)", () => {
    const a = frameAtHour(5.5).starAlpha;
    const b = frameAtHour(6.0).starAlpha;
    const c = frameAtHour(6.5).starAlpha;
    expect(a).toBeGreaterThanOrEqual(b);
    expect(b).toBeGreaterThanOrEqual(c);
  });
  it("window glow is on at night, off during the day", () => {
    expect(frameAtHour(2).windowGlow).toBeGreaterThan(0.5);
    expect(frameAtHour(13).windowGlow).toBe(0);
  });

  it("centralHour is deterministic and within [0,24)", () => {
    const h = centralHour(Date.now());
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(24);
  });

  it("skyAt never throws and always returns finite sun angles", () => {
    for (let ms = 0; ms < 24 * 3_600_000; ms += 3_600_000) {
      const s = skyAt(ms);
      expect(isFinite(s.sunAzimuthDeg)).toBe(true);
      expect(isFinite(s.sunElevDeg)).toBe(true);
      expect(s.starAlpha).toBeGreaterThanOrEqual(0);
      expect(s.starAlpha).toBeLessThanOrEqual(1);
    }
  });
});
