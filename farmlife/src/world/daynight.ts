// ---------------------------------------------------------------------------
// Day/night — PURE, cosmetic-only lighting keyframes driven by real
// America/Chicago wall-clock time (via farm/time.ts's now(), so the test
// offset hook drives it exactly like growth/weather). NEVER gameplay-
// affecting: farming, animals, everything works identically at 3am as at
// 3pm. Cheap by design — no shadow-map churn beyond moving one directional
// light; stars are a single Points cloud whose opacity this module controls.
// ---------------------------------------------------------------------------

export type RGB = [number, number, number];

export interface SkyState {
  sky: RGB;
  fog: RGB;
  hemiSky: RGB;
  hemiGround: RGB;
  hemiIntensity: number;
  sunColor: RGB;
  sunIntensity: number;
  ambIntensity: number;
  starAlpha: number; // 0..1, stars fade in at night
  windowGlow: number; // 0..1, farmhouse window emissive strength
  sunAzimuthDeg: number;
  sunElevDeg: number;
}

/** America/Chicago hour-of-day as a real number [0,24) — handles DST via
 * Intl, works identically in Node (vitest) and the browser. */
export function centralHour(ms: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const hStr = parts.find((p) => p.type === "hour")?.value ?? "12";
  const mStr = parts.find((p) => p.type === "minute")?.value ?? "0";
  const h = Number(hStr) % 24;
  const m = Number(mStr);
  return ((h + m / 60) % 24 + 24) % 24;
}

type Frame = Omit<SkyState, "sunAzimuthDeg" | "sunElevDeg">;

const NIGHT: Frame = {
  sky: [0.03, 0.05, 0.12],
  fog: [0.04, 0.06, 0.14],
  hemiSky: [0.12, 0.16, 0.32],
  hemiGround: [0.05, 0.06, 0.09],
  hemiIntensity: 0.28,
  sunColor: [0.55, 0.62, 0.85],
  sunIntensity: 0.12,
  ambIntensity: 0.06,
  starAlpha: 1,
  windowGlow: 1,
};
const DAWN: Frame = {
  sky: [0.85, 0.55, 0.42],
  fog: [0.82, 0.6, 0.5],
  hemiSky: [0.9, 0.75, 0.62],
  hemiGround: [0.35, 0.28, 0.22],
  hemiIntensity: 0.65,
  sunColor: [1, 0.75, 0.55],
  sunIntensity: 0.75,
  ambIntensity: 0.14,
  starAlpha: 0.15,
  windowGlow: 0.6,
};
const DAY: Frame = {
  sky: [0.56, 0.75, 0.91],
  fog: [0.66, 0.8, 0.88],
  hemiSky: [0.87, 0.94, 1],
  hemiGround: [0.42, 0.55, 0.29],
  hemiIntensity: 0.85,
  sunColor: [1, 0.95, 0.84],
  sunIntensity: 1.15,
  ambIntensity: 0.18,
  starAlpha: 0,
  windowGlow: 0,
};
const DUSK: Frame = {
  sky: [0.7, 0.4, 0.32],
  fog: [0.68, 0.42, 0.38],
  hemiSky: [0.75, 0.55, 0.5],
  hemiGround: [0.3, 0.22, 0.2],
  hemiIntensity: 0.55,
  sunColor: [1, 0.55, 0.32],
  sunIntensity: 0.6,
  ambIntensity: 0.12,
  starAlpha: 0.25,
  windowGlow: 0.7,
};

/** Keyframe hours across a 24h loop (0 = midnight). Deep night spans the
 * wrap (20:30 -> 24 -> 5). */
const KEYFRAMES: { h: number; f: Frame }[] = [
  { h: 0, f: NIGHT },
  { h: 5, f: NIGHT },
  { h: 6.5, f: DAWN },
  { h: 8, f: DAY },
  { h: 17.5, f: DAY },
  { h: 19, f: DUSK },
  { h: 20.5, f: NIGHT },
  { h: 24, f: NIGHT },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function lerpFrame(a: Frame, b: Frame, t: number): Frame {
  return {
    sky: lerpRGB(a.sky, b.sky, t),
    fog: lerpRGB(a.fog, b.fog, t),
    hemiSky: lerpRGB(a.hemiSky, b.hemiSky, t),
    hemiGround: lerpRGB(a.hemiGround, b.hemiGround, t),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, t),
    sunColor: lerpRGB(a.sunColor, b.sunColor, t),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    ambIntensity: lerp(a.ambIntensity, b.ambIntensity, t),
    starAlpha: lerp(a.starAlpha, b.starAlpha, t),
    windowGlow: lerp(a.windowGlow, b.windowGlow, t),
  };
}

/** PURE. Interpolated lighting frame for hour-of-day `h` in [0,24). */
export function frameAtHour(h: number): Frame {
  const hh = ((h % 24) + 24) % 24;
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const a = KEYFRAMES[i];
    const b = KEYFRAMES[i + 1];
    if (hh >= a.h && hh <= b.h) {
      const t = b.h === a.h ? 0 : (hh - a.h) / (b.h - a.h);
      return lerpFrame(a.f, b.f, t);
    }
  }
  return NIGHT;
}

/** Sun rides a simple sinusoid: above the horizon ~6:00-19:00, peak at noon;
 * the "sun" light doubles as moonlight at night (dim, cool-tinted via the
 * NIGHT frame's sunColor) so there's always one directional light. */
export function sunElevationDeg(h: number): number {
  return 45 * Math.sin(((h - 6) / 12) * Math.PI);
}
export function sunAzimuthDeg(h: number): number {
  return ((h / 24) * 360 + 200) % 360;
}

/** PURE. Full sky state for a given real timestamp (ms). */
export function skyAt(ms: number): SkyState {
  const h = centralHour(ms);
  const f = frameAtHour(h);
  return { ...f, sunAzimuthDeg: sunAzimuthDeg(h), sunElevDeg: sunElevationDeg(h) };
}

export const DAYNIGHT_FRAMES = { NIGHT, DAWN, DAY, DUSK };
