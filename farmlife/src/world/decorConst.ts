// ---------------------------------------------------------------------------
// decorConst — the THREE-FREE half of decor.ts: the decoration REGISTRY, types,
// and the id helper. The 2D bundle (main, hud, render2d/decor2d, farm/store,
// farm/cloudStore, net/sync) imports these from here so it never pulls the
// THREE mesh builders in decor.ts into its graph. decor.ts `export *`s from here
// so the deprecated 3D DecorField keeps working unchanged.
// ---------------------------------------------------------------------------

export type DecorCollide = "none" | "circle";

export interface DecorDef {
  label: string;
  emoji: string;
  cost: number;
  collide: DecorCollide;
  /** Placement footprint radius (m). Circle types use this; "none" types get a
   * tiny footprint so flat pieces (paths, flower beds) can pack close together. */
  cr: number;
}

export const DECOR: Record<string, DecorDef> = {
  scarecrow: { label: "Scarecrow", emoji: "🌾", cost: 60, collide: "circle", cr: 0.45 },
  gnome: { label: "Garden Gnome", emoji: "🧙", cost: 35, collide: "circle", cr: 0.3 },
  bench: { label: "Bench", emoji: "🪑", cost: 50, collide: "circle", cr: 0.7 },
  flowerbed: { label: "Flower Bed", emoji: "🌷", cost: 25, collide: "none", cr: 0.55 },
  pathtile: { label: "Stone Path", emoji: "⬜", cost: 10, collide: "none", cr: 0.5 },
  birdbath: { label: "Bird Bath", emoji: "🕊️", cost: 45, collide: "circle", cr: 0.45 },
  flag: { label: "Flag Banner", emoji: "🚩", cost: 30, collide: "none", cr: 0.3 },
  pinwheel: { label: "Pinwheel", emoji: "🎡", cost: 20, collide: "none", cr: 0.3 },
};

export const DECOR_ORDER: string[] = [
  "scarecrow",
  "gnome",
  "bench",
  "flowerbed",
  "pathtile",
  "birdbath",
  "flag",
  "pinwheel",
];

export function isDecorType(t: string): boolean {
  return Object.prototype.hasOwnProperty.call(DECOR, t);
}

/** Persisted decoration — one Firestore field on the shared `decor` doc. */
export interface DecorRecord {
  id: string;
  type: string;
  x: number;
  z: number;
  rotY: number;
  placedBy: string;
  placedAt: number;
}

/** Client-generated stable id (astronomically collision-unlikely, no server
 * round-trip needed — matches the "client-assigned id" note in the P5 brief). */
export function newDecorId(): string {
  return `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
