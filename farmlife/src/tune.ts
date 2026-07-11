// Live-tunable feel parameters. Farm Kart convention: camera + movement feel are
// load-bearing, so they live in a persisted, slider-editable panel from day one.
// Persisted to localStorage 'fl_tune_v1', merged over defaults on load.

export interface Tune {
  moveSpeed: number; // m/s walk speed
  runMult: number; // run = moveSpeed * runMult
  turnRate: number; // rad/s the character rotates toward movement dir
  camDist: number; // chase distance (m)
  camHeight: number; // chase height above the pivot (m)
  camLag: number; // higher = snappier follow (lerp factor scale)
  camPitchDefault: number; // starting pitch (radians above horizontal)
  fov: number; // camera field of view (deg)
  jumpVel: number; // initial upward velocity on jump (m/s)
  gravity: number; // downward accel while airborne (m/s^2)
  tankCapacity: number; // watering-can tank units before a refill is needed
  // ⚠️ TESTING ONLY — see growth.ts effectiveCrop(). When true, every crop
  // matures in ~60s so the plant→water→harvest→sell loop can be exercised in
  // seconds. MUST be flipped to `false` before Farm Life ships (it trivializes
  // the whole real-time farming loop). Not a slider — rendered as a toggle row.
  fastGrow: boolean;
}

// Keys of Tune that are numeric (slider-driven). `fastGrow` (boolean) is
// excluded so TUNE_META stays sliders-only; the panel adds a toggle row for it.
export type NumericTuneKey = { [K in keyof Tune]: Tune[K] extends number ? K : never }[keyof Tune];

export const TUNE_DEFAULTS: Tune = {
  // Re-tuned for the 2D top-down tile scale (PPM 8): a brisk-but-controllable
  // walk that crosses the 24 m field in a few seconds; run ~1.8×.
  moveSpeed: 4.6,
  runMult: 1.8,
  turnRate: 9.0, // inert in 2D (facing snaps to movement); kept for type/editor compat
  camDist: 8.5,
  camHeight: 4.2,
  camLag: 6.0,
  camPitchDefault: 0.42,
  fov: 60,
  jumpVel: 6.6,
  gravity: 18,
  tankCapacity: 6,
  // ⚠️ SHIP BLOCKER: must become `false` before release. ON for dev testing.
  fastGrow: true,
};

// Slider metadata for the TUNE panel (label, min, max, step). Numeric keys only.
export const TUNE_META: Record<
  NumericTuneKey,
  { label: string; min: number; max: number; step: number }
> = {
  moveSpeed: { label: "Move speed", min: 1, max: 12, step: 0.1 },
  runMult: { label: "Run mult", min: 1, max: 3, step: 0.05 },
  turnRate: { label: "Turn rate", min: 1, max: 20, step: 0.1 },
  camDist: { label: "Cam dist", min: 3, max: 20, step: 0.1 },
  camHeight: { label: "Cam height", min: 1, max: 12, step: 0.1 },
  camLag: { label: "Cam lag", min: 1, max: 20, step: 0.1 },
  camPitchDefault: { label: "Cam pitch", min: 0.1, max: 1.2, step: 0.01 },
  fov: { label: "FOV", min: 40, max: 90, step: 1 },
  jumpVel: { label: "Jump vel", min: 3, max: 12, step: 0.1 },
  gravity: { label: "Gravity", min: 8, max: 30, step: 0.5 },
  tankCapacity: { label: "Tank cap", min: 1, max: 20, step: 1 },
};

const KEY = "fl_tune_v1";

export function loadTune(): Tune {
  const t: Tune = { ...TUNE_DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const k of Object.keys(TUNE_DEFAULTS) as (keyof Tune)[]) {
        const v = saved[k];
        if (k === "fastGrow") {
          if (typeof v === "boolean") t.fastGrow = v;
        } else if (typeof v === "number" && isFinite(v)) {
          (t[k] as number) = v;
        }
      }
    }
  } catch (_) {
    /* corrupt save -> defaults */
  }
  return t;
}

export function saveTune(t: Tune): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch (_) {
    /* private mode / quota -> ignore */
  }
}

export function resetTune(t: Tune): void {
  Object.assign(t, TUNE_DEFAULTS);
  try {
    localStorage.removeItem(KEY);
  } catch (_) {
    /* ignore */
  }
}
