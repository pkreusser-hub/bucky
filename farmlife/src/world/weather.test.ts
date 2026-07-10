import { describe, it, expect } from "vitest";
import { classifyWmo, sanitizeWeather, shouldRefetch, weatherEmoji, type WeatherSnapshot } from "./weather";

describe("weather.ts — WMO classification (pure)", () => {
  it("classifies drizzle + rain codes as rain", () => {
    for (const c of [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]) {
      expect(classifyWmo(c)).toBe("rain");
    }
  });
  it("classifies thunderstorm codes as rain (visually treated the same)", () => {
    for (const c of [95, 96, 99]) expect(classifyWmo(c)).toBe("rain");
  });
  it("classifies snow codes as snow", () => {
    for (const c of [71, 73, 75, 77, 85, 86]) expect(classifyWmo(c)).toBe("snow");
  });
  it("classifies clear/cloudy/fog codes as clear (cosmetic default)", () => {
    for (const c of [0, 1, 2, 3, 45, 48]) expect(classifyWmo(c)).toBe("clear");
  });
  it("unknown/out-of-range codes degrade to clear, never crash", () => {
    expect(classifyWmo(-1)).toBe("clear");
    expect(classifyWmo(9999)).toBe("clear");
    expect(classifyWmo(NaN)).toBe("clear");
  });

  it("weatherEmoji maps each bucket", () => {
    expect(weatherEmoji("rain")).toMatch(/🌧/);
    expect(weatherEmoji("snow")).toMatch(/❄/);
    expect(weatherEmoji("clear")).toMatch(/☀/);
  });
});

describe("weather.ts — sanitizeWeather (defensive parse)", () => {
  it("rejects garbage without throwing", () => {
    expect(sanitizeWeather(null)).toBeNull();
    expect(sanitizeWeather(undefined)).toBeNull();
    expect(sanitizeWeather("nope")).toBeNull();
    expect(sanitizeWeather({})).toBeNull();
    expect(sanitizeWeather({ code: "61" })).toBeNull();
  });
  it("accepts a well-formed snapshot and re-derives cond from code", () => {
    const s = sanitizeWeather({ code: 61, fetchedAt: 1000, tempF: 72.5 });
    expect(s).toEqual({ cond: "rain", code: 61, fetchedAt: 1000, tempF: 72.5 });
  });
  it("tolerates a mismatched stored cond by trusting the code, not the label", () => {
    const s = sanitizeWeather({ cond: "clear", code: 71, fetchedAt: 5 });
    expect(s?.cond).toBe("snow");
  });
  it("tempF omitted when absent/invalid", () => {
    expect(sanitizeWeather({ code: 0, fetchedAt: 1 })?.tempF).toBeUndefined();
    expect(sanitizeWeather({ code: 0, fetchedAt: 1, tempF: "hot" })?.tempF).toBeUndefined();
  });
});

describe("weather.ts — shouldRefetch cadence", () => {
  const snap: WeatherSnapshot = { cond: "clear", code: 0, fetchedAt: 1_000_000 };
  it("no cache -> always refetch", () => {
    expect(shouldRefetch(null, 1_000_000)).toBe(true);
  });
  it("fresh cache (<30min) -> no refetch", () => {
    expect(shouldRefetch(snap, snap.fetchedAt + 10 * 60 * 1000)).toBe(false);
  });
  it("stale cache (>=30min) -> refetch", () => {
    expect(shouldRefetch(snap, snap.fetchedAt + 30 * 60 * 1000)).toBe(true);
    expect(shouldRefetch(snap, snap.fetchedAt + 60 * 60 * 1000)).toBe(true);
  });
});
