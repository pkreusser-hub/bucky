// ---------------------------------------------------------------------------
// PALETTE — the exact hue-shifted ramps from the approved mockup
// (scratchpad/2d-modern-pixel.html · shots/2d-modern-pixel.png). This is the
// STYLE CONTRACT for the 2D Modern Pixel conversion: every sprite draws from
// these ramps. Extend minimally where a piece the mockup didn't cover needs a
// hue (goat, crop stages) — always in the same 4-5 shade, hue-shifted spirit.
// ---------------------------------------------------------------------------

/** Grass — mottled base + dense tufts + flower speckles. */
export const G = {
  base: "#67b04f",
  dk: "#57964a",
  dk2: "#4a7f46",
  lt: "#79c05a",
  lt2: "#8fd06a",
  tuft: "#3f6f40",
  tuftl: "#9adf78",
} as const;

/** Dirt path — organic edges + pebbles. */
export const PATH = {
  base: "#dcb977",
  dk: "#c6a05f",
  dk2: "#a9854c",
  lt: "#ecd192",
  peb: "#b99a68",
  pebl: "#eddcae",
} as const;

/** Tilled soil plot — ridged furrows. */
export const SOIL = {
  base: "#77492b",
  dk: "#5f3820",
  dk2: "#4a2b18",
  lt: "#8a5a38",
  ridge: "#936640",
  rl: "#a5764e",
  wet: "#5a3620", // watered (darker, damp)
  wetridge: "#6e4526",
} as const;

/** Pumpkin (mockup) — reused for the pumpkin crop stage. */
export const PUMP = {
  base: "#e8862c",
  dk: "#c2661c",
  dk2: "#9c4d14",
  lt: "#f6a34c",
  lt2: "#ffc072",
  stem: "#4a7c34",
  stemd: "#38602a",
} as const;

/** Tree — trunk + layered canopy puffs. */
export const TREE = {
  t: "#7a4c2c",
  td: "#5f3820",
  tl: "#936640",
  c1: "#2f6134",
  c2: "#3f7f42",
  c3: "#529a4e",
  c4: "#6db55c",
  c5: "#8fd06a",
} as const;

/** Barn — planks + shingles + glowing window. */
export const BARN_COL = {
  base: "#b8442c",
  dk: "#96331e",
  dk2: "#772414",
  lt: "#cf5b3c",
  roof: "#5c4c44",
  roofd: "#483a34",
  roofl: "#6f5d52",
  trim: "#f0e3c8",
  trimd: "#d4c3a4",
  glow: "#ffd98a",
  glowd: "#e8b45f",
} as const;

/** Hen (chicken). */
export const HEN = {
  b: "#f6f0dc",
  d: "#dcd2b4",
  d2: "#bcae8e",
  comb: "#d8503a",
  beak: "#e8a83c",
  eye: "#3c2c22",
} as const;

/** Goat — the mockup had no goat; matched to the herd's tan/brown palette in
 * the same chunky, hue-shifted spirit. */
export const GOAT = {
  b: "#cbb892",
  d: "#ad9a74",
  d2: "#8f7c5a",
  lt: "#e0d1ad",
  horn: "#efe6cc",
  horns: "#cbbf9e",
  snout: "#f0e6cf",
  hoof: "#4a3f30",
  eye: "#3c2c22",
} as const;

/** Farmer (Sunny) — 28px modern sprite parts. */
export const K = {
  outline: "#4a3226",
  skin: "#f4c898",
  skind: "#dca470",
  blush: "#f0a080",
  hair: "#e08434",
  haird: "#b86420",
  hairl: "#f4a858",
  hat: "#ecc45c",
  hatd: "#cc9f42",
  hatl: "#f8dc84",
  band: "#d8503a",
  shirt: "#f0c848",
  shirtd: "#cca034",
  ovr: "#4c80c4",
  ovrd: "#3a629e",
  ovrl: "#6c9cd8",
  shoe: "#6b4326",
  shoed: "#503118",
} as const;

/** Fence (posts + rails) — reuses the tree wood ramp. */
export const FENCE = {
  post: "#7a5230",
  postl: "#96703f",
  postd: "#5c3b20",
  rail: "#8a6236",
  raild: "#6b4a26",
  gate: "#9a6a2e",
} as const;

/** Pond water — 3-frame shimmer blues. */
export const POND_COL = {
  deep: "#2f6f9e",
  base: "#3f86b8",
  lt: "#5aa6d6",
  ltr: "#7ec3e6",
  foam: "#cfeaf6",
  edge: "#7a8d5a", // muddy grass-water edge
} as const;

/** Crop stage greens (sprout → mature) — hue-shifted plant ramp. */
export const CROP_COL = {
  sprout: "#8fd06a",
  leaf: "#6db55c",
  leafd: "#4f9a3f",
  stem: "#4a7c34",
  stemd: "#38602a",
} as const;

/** Egg. */
export const EGG_COL = { b: "#fbf3df", d: "#e3d7b8", hi: "#fffdf4" } as const;

/** Silo. */
export const SILO_COL = { b: "#c9ccce", d: "#a9adb0", lt: "#e2e4e6", dome: "#9aa0a4" } as const;

/** Farmhouse. */
export const HOUSE = {
  wall: "#e8dcc0",
  walld: "#cdbf9e",
  walll: "#f4ecd8",
  roof: "#a6402f",
  roofd: "#822f22",
  roofl: "#c05a44",
  door: "#6b4a2b",
  win: "#bfe0f0",
  winglow: "#ffe6a0",
  chim: "#8a5a45",
} as const;

/** Rock. */
export const ROCK = { b: "#9a9a9a", d: "#7c7c7c", lt: "#b6b6b6", moss: "#6f9550" } as const;
