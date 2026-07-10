// ---------------------------------------------------------------------------
// Real Woodville weather — Open-Meteo current conditions for the actual farm
// (34.686537,-86.210417, same coords as weather.html), free + no key. Cached
// to localStorage so a boot without network still shows the last known sky
// (or a friendly "clear" default) rather than a blank/broken state. Rain
// classification is a PURE function (unit tested); the fetch/cache wrapper is
// the only DOM-touching part, isolated at the bottom.
// ---------------------------------------------------------------------------

export type WeatherCond = "clear" | "rain" | "snow";

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

/** PURE. WMO weather code -> the 3 cosmetic buckets this game cares about. */
export function classifyWmo(code: number): WeatherCond {
  if (SNOW_CODES.has(code)) return "snow";
  if (RAIN_CODES.has(code)) return "rain";
  return "clear";
}

export function weatherEmoji(cond: WeatherCond): string {
  return cond === "rain" ? "🌧️" : cond === "snow" ? "❄️" : "☀️";
}

export interface WeatherSnapshot {
  cond: WeatherCond;
  code: number;
  fetchedAt: number;
  tempF?: number;
}

/** PURE. Defensive parse — a corrupt cache entry can never brick the game. */
export function sanitizeWeather(raw: unknown): WeatherSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<WeatherSnapshot>;
  if (typeof r.code !== "number" || !isFinite(r.code)) return null;
  if (typeof r.fetchedAt !== "number" || !isFinite(r.fetchedAt)) return null;
  const out: WeatherSnapshot = { cond: classifyWmo(r.code), code: r.code, fetchedAt: r.fetchedAt };
  if (typeof r.tempF === "number" && isFinite(r.tempF)) out.tempF = r.tempF;
  return out;
}

const FETCH_INTERVAL_MS = 30 * 60 * 1000;

/** PURE. Should we hit the network again given a cached snapshot + real now? */
export function shouldRefetch(cached: WeatherSnapshot | null, nowMs: number): boolean {
  return !cached || nowMs - cached.fetchedAt >= FETCH_INTERVAL_MS;
}

/** How often (of ACCELERATABLE game time, via farm/time.ts's now()) active
 * rain auto-waters one unwatered planted tile. Idempotent per tile (routes
 * through the normal waterTile checkpoint), so concurrent clients are safe. */
export const RAIN_AUTO_WATER_INTERVAL_MS = 3 * 60 * 1000;

const LAT = 34.686537;
const LON = -86.210417;
const CACHE_KEY = "fl_wx";

export function loadCachedWeather(): WeatherSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return sanitizeWeather(JSON.parse(raw));
  } catch (_) {
    return null;
  }
}

export function saveCachedWeather(snap: WeatherSnapshot): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snap));
  } catch (_) {
    /* quota/private mode -> ignore, next successful fetch retries */
  }
}

function weatherUrl(): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&current=weather_code,temperature_2m&temperature_unit=fahrenheit&timezone=America%2FChicago`
  );
}

/** Fetch current conditions. NEVER throws — resolves null on any failure
 * (network blocked, bad JSON, missing field) so callers can degrade to the
 * cached/default sky without ever crashing or blanking the page. */
export async function fetchWeather(nowMs: number, fetchImpl: typeof fetch = fetch): Promise<WeatherSnapshot | null> {
  try {
    const res = await fetchImpl(weatherUrl());
    if (!res.ok) return null;
    const data = (await res.json()) as { current?: { weather_code?: number; temperature_2m?: number } };
    const code = data.current?.weather_code;
    if (typeof code !== "number") return null;
    const tempF = data.current?.temperature_2m;
    const out: WeatherSnapshot = { cond: classifyWmo(code), code, fetchedAt: nowMs };
    if (typeof tempF === "number" && isFinite(tempF)) out.tempF = tempF;
    return out;
  } catch (_) {
    return null;
  }
}

/** Small poller: loads the cache immediately (instant, honest degrade),
 * background-fetches on boot + every 30 real minutes, always caching a
 * successful result. Never blanks the sky — a failed fetch just keeps
 * serving the last known (or "clear" default) snapshot. */
export class WeatherStation {
  current: WeatherSnapshot | null;
  private onChange: (snap: WeatherSnapshot) => void;
  private timer: number | null = null;

  constructor(onChange: (snap: WeatherSnapshot) => void) {
    this.onChange = onChange;
    this.current = loadCachedWeather();
    if (this.current) onChange(this.current);
    void this.tick();
  }

  private async tick(): Promise<void> {
    const nowMs = Date.now();
    if (shouldRefetch(this.current, nowMs)) {
      const fresh = await fetchWeather(nowMs);
      if (fresh) {
        this.current = fresh;
        saveCachedWeather(fresh);
        this.onChange(fresh);
      }
    }
    this.timer = window.setTimeout(() => void this.tick(), FETCH_INTERVAL_MS);
  }

  dispose(): void {
    if (this.timer != null) clearTimeout(this.timer);
  }
}
