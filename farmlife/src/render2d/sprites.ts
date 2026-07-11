// ---------------------------------------------------------------------------
// Sprite atlas — every discrete prop is drawn ONCE at boot into an offscreen
// canvas (PPM px per metre) with a bottom-centre anchor, then blitted by the
// renderer. Pure (canvas in → pixels out): future cosmetics/props are code
// additions, never asset files. Techniques ported from the approved mockup
// (scratchpad/2d-modern-pixel.html): hue-shifted ramps, layered canopy puffs,
// planks+shingles, chunky shaded critters.
// ---------------------------------------------------------------------------

import { PPM } from "./coords";
import { G, PATH, SOIL, TREE, BARN_COL, HEN, GOAT, PUMP, FENCE, SILO_COL, HOUSE, ROCK, EGG_COL } from "./palette";
import type { CropId } from "../farm/growth";

// ---------------------------------------------------------------------------
// R4 SCALE CHART (2026-07-11 — user: "check the art scale, house vs person").
//
// The FARMER is the reference. farmer2d draws a ~28 px body (≈32 px silhouette
// with the straw hat) at feet-anchor — see FARMER_PX. R1/R2 authored every prop
// straight at PPM=8 (a 9 m barn = 72 px) so buildings came out only ~1.4× the
// farmer and read as dollhouses. Genre norm (Fields-of-Mistria / Stardew): the
// player is small and buildings TOWER. So props are now sized against FARMER_PX
// instead of raw metres — the sprite is a BILLBOARD over an UNCHANGED world
// footprint (the standard 2.5D trick), so collision/door-gaps/pasture geometry
// are preserved (farm GEOGRAPHY kept; only the drawn sprite grows).
//
// Target HEIGHTS (px) and their ratio to the 28 px farmer:
//   farmhouse 150 (5.4×) · barn 132 (4.7×, see note) · silo 146 (5.2×)
//   tree 74/92/110 (2.6/3.3/3.9×) · bin 39 (1.4×) · stand 42 (1.5×)
//   goat 18 (0.64×) · hen ~13 (0.46×, kept near the mockup) · door ≥ 38 (1.36×)
//
// BARN NOTE: it stays a CUTAWAY dollhouse (see-through front reveals the nests/
// herd — its charm) rather than a tall solid billboard, because its door faces
// UP-screen toward the grazing area; a tall billboard would occlude the very
// door-approach + waiting-herd routine the cutaway exists to show. So it is
// grown chunky (~4.7×) but not to the full 5-6× a camera-facing building gets.
// ---------------------------------------------------------------------------
/** Farmer reference height (px) — the scale-chart baseline. The drawn silhouette
 * (hat to feet) is ~32 px; 28 is the mockup's nominal body height. */
export const FARMER_PX = 28;
export const SCALE = {
  farmhouse: 150,
  farmhouse_door: 42,
  barn: 132,
  barn_door: 40,
  silo: 146,
  tree: [74, 92, 110] as const,
  rock: [13, 18, 24] as const,
  bin: 39,
  stand: 42,
  goat: 18,
} as const;

/** A baked sprite: its pixel canvas + the anchor (ax,ay) that maps to the
 * sprite's WORLD ground point (usually bottom-centre = where it meets the soil).
 * The renderer draws it at (screenX - ax, screenY - ay). */
export interface Sprite {
  canvas: HTMLCanvasElement;
  ax: number;
  ay: number;
}

function makeCanvas(w: number, h: number): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.ceil(w));
  cv.height = Math.max(1, Math.ceil(h));
  const ctx = cv.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return { cv, ctx };
}

/** Deterministic PRNG (mulberry32) so every baked sprite is stable across runs. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const px = (ctx: CanvasRenderingContext2D, x: number, y: number, c: string) => {
  ctx.fillStyle = c;
  ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1);
};
const rect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) => {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
};

// ---- soft ground-contact shadow (reused by most props) ----------------------
function shadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.fillStyle = "rgba(30,45,25,0.28)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, 7);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// TREE — layered canopy (mockup tree()). 3 sizes; bottom-centre anchor at the
// trunk base. Drawn at PPM so a ~4 m tree is ~ (scale) tall.
// ---------------------------------------------------------------------------
function bakeTree(sizeIdx: number): Sprite {
  // sized off the SCALE chart (2.6–3.9× the farmer) — h = s * 6.2, so s = targetH/6.2
  const s = SCALE.tree[sizeIdx] / 6.2; // canopy-radius-ish unit
  const w = Math.ceil(s * 4.4);
  const h = Math.ceil(s * 6.2);
  const { cv, ctx } = makeCanvas(w, h);
  const cx = w / 2;
  const baseY = h - 2; // trunk foot
  const cy = baseY - s * 1.7; // trunk top / canopy centre band
  shadow(ctx, cx + s * 0.3, baseY, s * 1.7, s * 0.5);
  // trunk
  rect(ctx, cx - s * 0.28, cy, s * 0.56, baseY - cy, TREE.t);
  rect(ctx, cx - s * 0.28, cy, s * 0.2, baseY - cy, TREE.td);
  px(ctx, cx + s * 0.12, cy + s * 0.5, TREE.tl);
  const puff = (x: number, y: number, r: number, c: string) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
  };
  puff(cx, cy - s * 1.35, s * 2.0, TREE.c1);
  puff(cx - s * 1.1, cy - s * 1.75, s * 1.45, TREE.c2);
  puff(cx + s * 1.2, cy - s * 1.6, s * 1.45, TREE.c2);
  puff(cx - s * 0.3, cy - s * 2.4, s * 1.45, TREE.c3);
  puff(cx + s * 0.8, cy - s * 2.55, s * 1.05, TREE.c3);
  puff(cx - s * 1.05, cy - s * 2.55, s * 0.9, TREE.c4);
  puff(cx - s * 0.4, cy - s * 3.0, s * 0.85, TREE.c4);
  // sparkle highlights top-left
  const r = rng(1000 + sizeIdx);
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2;
    const rr = r() * s * 1.7;
    px(ctx, cx - s * 0.4 + Math.cos(a) * rr, cy - s * 2.4 + Math.sin(a) * rr * 0.7, r() < 0.6 ? TREE.c5 : TREE.c4);
  }
  return { canvas: cv, ax: cx, ay: baseY };
}

// ---------------------------------------------------------------------------
// ROCK — chunky shaded boulder.
// ---------------------------------------------------------------------------
function bakeRock(sizeIdx: number): Sprite {
  // ground clutter — h = s * 2.0, so s = targetH/2.0 (SCALE chart)
  const s = SCALE.rock[sizeIdx] / 2.0;
  const w = Math.ceil(s * 2.4);
  const h = Math.ceil(s * 2.0);
  const { cv, ctx } = makeCanvas(w, h);
  const cx = w / 2;
  const baseY = h - 1;
  shadow(ctx, cx, baseY, s * 1.05, s * 0.32);
  ctx.fillStyle = ROCK.d;
  ctx.beginPath();
  ctx.ellipse(cx, baseY - s * 0.5, s * 1.0, s * 0.68, 0, 0, 7);
  ctx.fill();
  ctx.fillStyle = ROCK.b;
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.1, baseY - s * 0.62, s * 0.82, s * 0.55, 0, 0, 7);
  ctx.fill();
  ctx.fillStyle = ROCK.lt;
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.28, baseY - s * 0.8, s * 0.4, s * 0.26, 0, 0, 7);
  ctx.fill();
  // moss speckles
  const r = rng(2000 + sizeIdx);
  for (let i = 0; i < 5; i++) px(ctx, cx - s * 0.6 + r() * s * 1.2, baseY - s * 0.3 - r() * s * 0.3, ROCK.moss);
  return { canvas: cv, ax: cx, ay: baseY };
}

// ---------------------------------------------------------------------------
// BARN — split into TWO layers for the cutaway interior (R2):
//   BACK  = interior floor + back wall + 3 straw nests + hay (sort EARLY, so
//           eggs/animals inside draw OVER it).
//   FRONT = roof + red plank walls + trim + glowing window + a TRANSPARENT
//           doorway cutout (sort LATE; main fades it to reveal the interior
//           when the player is inside). The swinging door PANEL is drawn
//           dynamically by main over the cutout (BARN_DOORWAY geometry).
// Bottom-centre anchor at the barn's back(north)/max-Z ground line. Barn body
// geometry (BW/BH/roofH/margins) is shared so the two layers register exactly.
// ---------------------------------------------------------------------------
const B_U = PPM; // world unit — interior/nest offsets stay ANCHORED to world metres
// R4: the barn body is a chunky ~4.7× billboard over the UNCHANGED 9 m footprint.
// Width ~12.5 m so it reads as a proper barn without reaching the silo (x 46.5);
// B_BH/B_ROOF are now sized off the SCALE chart (px), not raw metres.
const B_BW = 12.5 * B_U,
  B_BH = SCALE.barn * 0.6, // wall/body height (px)
  B_ROOF = SCALE.barn * 0.34, // gambrel roof band (px)
  B_MARGIN = 8;
const B_W = Math.ceil(B_BW + 16);
const B_H = Math.ceil(B_BH + B_ROOF + 10);
const B_BX = (B_W - B_BW) / 2;
const B_BY = B_H - B_BH - 3;
// The door sits at the visual wall base, shifted +0.5 m east (+4 px @ PPM 8) so
// it lines up with the world door-gap centre (DOOR_CENTER.x 38 vs barn 37.5).
const B_DOOR_OFFSET = 4;
const B_DW = 3.0 * B_U,
  B_DH = SCALE.barn_door;
const B_DX = B_W / 2 + B_DOOR_OFFSET - B_DW / 2,
  B_DY = B_BY + B_BH - B_DH;
/** Doorway rect (local sprite px) — main draws the swinging panel here. */
export const BARN_DOORWAY = { x: B_DX, y: B_DY, w: B_DW, h: B_DH, ax: B_W / 2, ay: B_H - 3 };

function bakeBarnBack(night: boolean): Sprite {
  const { cv, ctx } = makeCanvas(B_W, B_H);
  // interior floor: plank boards, warm wood, receding shade toward the back
  const fx = B_BX + 2,
    fy = B_BY + 0.4 * B_U,
    fw = B_BW - 4,
    fh = B_BH - 0.6 * B_U;
  rect(ctx, fx, fy, fw, fh, night ? "#5a4028" : "#7a5636");
  for (let y = fy; y < fy + fh; y += 4) rect(ctx, fx, y, fw, 1, night ? "#4a3320" : "#63452b");
  for (let x = fx; x < fx + fw; x += 10) rect(ctx, x, fy, 1, fh, night ? "#4a3320" : "#684a2e");
  // back wall band
  rect(ctx, fx, fy - 3, fw, 4, night ? "#6a4a30" : "#8a6440");
  rect(ctx, fx, fy - 3, fw, 1, night ? "#7c5838" : "#9c7048");
  // 3 straw nests, at NEST local x (-2.6/0/+2.6 m from centre) and a Z that lines
  // up with where egg sprites render (nestSpot z ≈ maxZ − 1.3 m).
  const ny = B_H - 3 - 1.3 * B_U;
  for (const nx of [-2.6, 0, 2.6]) {
    const cx = B_W / 2 + nx * B_U;
    oval(ctx, cx, ny + 2, 0.7 * B_U, 0.34 * B_U, "#8a6a34"); // straw ring
    oval(ctx, cx, ny + 2, 0.5 * B_U, 0.22 * B_U, "#b89a52");
    oval(ctx, cx, ny + 3, 0.6 * B_U, 0.2 * B_U, "#9c7c42");
    oval(ctx, cx, ny + 1, 0.34 * B_U, 0.14 * B_U, "#5a4326"); // hollow
  }
  // a hay bale in the back corner
  rect(ctx, fx + fw - 0.9 * B_U, fy + 1, 0.8 * B_U, 0.6 * B_U, "#d8b45a");
  rect(ctx, fx + fw - 0.9 * B_U, fy + 1, 0.8 * B_U, 1, "#e8ca78");
  rect(ctx, fx + fw - 0.6 * B_U, fy + 1, 1, 0.6 * B_U, "#b8944a");
  return { canvas: cv, ax: B_W / 2, ay: B_H - 3 };
}

function bakeBarnFront(night: boolean): Sprite {
  const { cv, ctx } = makeCanvas(B_W, B_H);
  const BX = B_BX,
    BY = B_BY,
    BW = B_BW,
    BH = B_BH;
  shadow(ctx, B_W / 2, B_H - 2, BW * 0.6, 4);
  // body
  rect(ctx, BX, BY, BW, BH, BARN_COL.base);
  for (let x = BX + 6; x < BX + BW; x += 7) rect(ctx, x, BY, 1, BH, BARN_COL.dk); // planks
  rect(ctx, BX, BY, BW, 2, BARN_COL.lt);
  rect(ctx, BX, BY + BH - 3, BW, 3, BARN_COL.dk);
  rect(ctx, BX, BY + BH - 1, BW, 1, BARN_COL.dk2);
  // roof shingle rows w/ overhang
  for (let r = 0; r < 5; r++) {
    const y = BY - B_ROOF + r * (B_ROOF / 5);
    rect(ctx, BX - 5 + r, y, BW + 10 - r * 2, B_ROOF / 5 + 1, r % 2 ? BARN_COL.roof : BARN_COL.roofl);
    rect(ctx, BX - 5 + r, y + B_ROOF / 5, BW + 10 - r * 2, 1, BARN_COL.roofd);
  }
  rect(ctx, BX - B_MARGIN, BY - 2, BW + B_MARGIN * 2, 3, BARN_COL.roofd);
  // cupola
  rect(ctx, B_W / 2 - 0.5 * B_U, BY - B_ROOF - 0.6 * B_U, B_U, 0.6 * B_U, BARN_COL.dk);
  rect(ctx, B_W / 2 - 0.6 * B_U, BY - B_ROOF - 0.8 * B_U, 1.2 * B_U, 0.24 * B_U, BARN_COL.roofl);
  // trim corners
  rect(ctx, BX, BY, 2, BH, BARN_COL.trim);
  rect(ctx, BX + BW - 2, BY, 2, BH, BARN_COL.trim);
  // door FRAME + transparent doorway cutout (main draws the swinging panel)
  rect(ctx, B_DX - 2, B_DY - 2, B_DW + 4, B_DH + 2, BARN_COL.trim);
  ctx.clearRect(B_DX, B_DY, B_DW, B_DH); // see-through to the interior layer
  rect(ctx, B_DX, B_DY, B_DW, 1, "rgba(0,0,0,0.25)"); // lintel shade
  // window (glows at night)
  const wx = BX + 1.2 * B_U,
    wy = BY + 1.1 * B_U,
    ws = 1.15 * B_U;
  rect(ctx, wx, wy, ws, ws, BARN_COL.trim);
  rect(ctx, wx + 1, wy + 1, ws - 2, ws - 2, night ? BARN_COL.glow : "#7c5a3a");
  if (night) {
    px(ctx, wx + 2, wy + 2, "#fff2c8");
    px(ctx, wx + 3, wy + 2, "#fff2c8");
  }
  rect(ctx, wx + ws / 2, wy + 1, 1, ws - 2, BARN_COL.trim);
  rect(ctx, wx + 1, wy + ws / 2, ws - 2, 1, BARN_COL.trim);
  return { canvas: cv, ax: B_W / 2, ay: B_H - 3 };
}

// ---------------------------------------------------------------------------
// SILO — cylinder + dome.
// ---------------------------------------------------------------------------
function bakeSilo(): Sprite {
  // SCALE chart: ~5.2× the farmer, a tall ~3.2:1 cylinder.
  const bw = SCALE.silo * 0.26,
    bh = SCALE.silo * 0.84;
  const w = Math.ceil(bw + 4),
    h = Math.ceil(bh + bw * 0.5 + 4);
  const { cv, ctx } = makeCanvas(w, h);
  const cx = w / 2,
    baseY = h - 2;
  shadow(ctx, cx, baseY, bw * 0.6, 4);
  const topY = baseY - bh;
  // body
  rect(ctx, cx - bw / 2, topY, bw, bh, SILO_COL.b);
  rect(ctx, cx - bw / 2, topY, bw * 0.28, bh, SILO_COL.d);
  rect(ctx, cx + bw * 0.18, topY, bw * 0.16, bh, SILO_COL.lt);
  for (let y = topY + 6; y < baseY; y += 8) rect(ctx, cx - bw / 2, y, bw, 1, SILO_COL.d); // hoops
  // dome
  ctx.fillStyle = SILO_COL.dome;
  ctx.beginPath();
  ctx.ellipse(cx, topY, bw / 2, bw * 0.42, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = SILO_COL.lt;
  ctx.beginPath();
  ctx.ellipse(cx - bw * 0.12, topY - bw * 0.06, bw * 0.22, bw * 0.16, 0, Math.PI, 0);
  ctx.fill();
  return { canvas: cv, ax: cx, ay: baseY };
}

// ---------------------------------------------------------------------------
// FARMHOUSE — gabled cottage. Two variants (day / lit windows).
// ---------------------------------------------------------------------------
function bakeFarmhouse(night: boolean): Sprite {
  const u = PPM;
  // R4: a proper ~5.4× cottage BILLBOARD over the unchanged 8 m footprint; its
  // door faces the camera (down-screen) so the player stands in front to enter.
  const W = 13 * u, // 104 px body width (billboard; footprint/collider stay 8 m)
    H = Math.round(SCALE.farmhouse * 0.56), // 84 px wall
    roofH = Math.round(SCALE.farmhouse * 0.42); // 63 px roof
  const w = Math.ceil(W + 16),
    h = Math.ceil(H + roofH + 6);
  const { cv, ctx } = makeCanvas(w, h);
  const X = (w - W) / 2,
    Y = h - H - 3;
  shadow(ctx, w / 2, h - 2, W * 0.58, 5);
  // wall + shaded edges + base shadow
  rect(ctx, X, Y, W, H, HOUSE.wall);
  rect(ctx, X, Y, 3, H, HOUSE.walld);
  rect(ctx, X + W - 3, Y, 3, H, HOUSE.walld);
  rect(ctx, X, Y, W, 3, HOUSE.walll);
  rect(ctx, X, Y + H - 4, W, 4, HOUSE.walld);
  // gable roof (triangle) w/ overhang, lit left slope + eave line
  ctx.fillStyle = HOUSE.roof;
  ctx.beginPath();
  ctx.moveTo(X - 7, Y + 2);
  ctx.lineTo(X + W / 2, Y - roofH);
  ctx.lineTo(X + W + 7, Y + 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = HOUSE.roofl;
  ctx.beginPath();
  ctx.moveTo(X + W / 2, Y - roofH);
  ctx.lineTo(X + W / 2 - 5, Y - roofH + 7);
  ctx.lineTo(X - 4, Y + 1);
  ctx.lineTo(X - 7, Y + 2);
  ctx.closePath();
  ctx.fill();
  rect(ctx, X - 8, Y, W + 16, 3, HOUSE.roofd);
  // door + frame (SCALE.farmhouse_door tall, centred, camera-facing)
  const dw = 3.0 * u,
    dh = SCALE.farmhouse_door;
  const dx = Math.round(X + W / 2 - dw / 2),
    dy = Math.round(Y + H - dh);
  rect(ctx, dx - 2, dy - 2, dw + 4, dh + 2, HOUSE.walld); // frame
  rect(ctx, dx, dy, dw, dh, HOUSE.door);
  rect(ctx, dx, dy, dw, 2, "#8a6238"); // top-lit lintel
  rect(ctx, dx, dy, 2, dh, "#5a3c22");
  px(ctx, dx + dw - 4, dy + Math.round(dh / 2), "#e8c96a"); // knob
  // two windows w/ sills (glow at night)
  const ws = Math.round(3.2 * u);
  for (const wx of [Math.round(X + 0.2 * W), Math.round(X + 0.8 * W - ws)]) {
    const wy = Y + Math.round(H * 0.3);
    rect(ctx, wx - 2, wy - 2, ws + 4, ws + 4, HOUSE.walld); // frame
    rect(ctx, wx, wy, ws, ws, night ? HOUSE.winglow : HOUSE.win);
    rect(ctx, wx + ws / 2 - 1, wy, 2, ws, HOUSE.walld); // mullions
    rect(ctx, wx, wy + ws / 2 - 1, ws, 2, HOUSE.walld);
    rect(ctx, wx - 3, wy + ws + 1, ws + 6, 2, "#c8b48a"); // sill
    if (night) {
      px(ctx, wx + 3, wy + 3, "#fff2c8");
      px(ctx, wx + 4, wy + 3, "#fff2c8");
    }
  }
  // chimney w/ cap
  const chW = Math.round(1.0 * u);
  const chX = X + W - Math.round(3.2 * u);
  rect(ctx, chX, Y - Math.round(roofH * 0.62), chW, Math.round(roofH * 0.7), HOUSE.chim);
  rect(ctx, chX - 2, Y - Math.round(roofH * 0.62), chW + 4, 3, "#6b4636"); // cap
  return { canvas: cv, ax: w / 2, ay: h - 3 };
}

// ---------------------------------------------------------------------------
// FENCE — a post sprite (rails drawn as rects by the renderer).
// ---------------------------------------------------------------------------
function bakeFencePost(): Sprite {
  const u = PPM;
  const w = Math.ceil(0.4 * u) + 2,
    h = Math.ceil(1.4 * u) + 2;
  const { cv, ctx } = makeCanvas(w, h);
  const cx = w / 2,
    baseY = h - 1;
  shadow(ctx, cx, baseY, 0.32 * u, 0.16 * u);
  rect(ctx, cx - 0.18 * u, baseY - 1.4 * u, 0.36 * u, 1.4 * u, FENCE.post);
  rect(ctx, cx - 0.18 * u, baseY - 1.4 * u, 0.12 * u, 1.4 * u, FENCE.postl);
  rect(ctx, cx + 0.06 * u, baseY - 1.4 * u, 0.1 * u, 1.4 * u, FENCE.postd);
  px(ctx, cx, baseY - 1.4 * u, FENCE.postl);
  return { canvas: cv, ax: cx, ay: baseY };
}

function bakeGatePost(): Sprite {
  const u = PPM;
  const w = Math.ceil(0.5 * u) + 2,
    h = Math.ceil(2.2 * u) + 2;
  const { cv, ctx } = makeCanvas(w, h);
  const cx = w / 2,
    baseY = h - 1;
  shadow(ctx, cx, baseY, 0.34 * u, 0.18 * u);
  rect(ctx, cx - 0.24 * u, baseY - 2.2 * u, 0.48 * u, 2.2 * u, FENCE.gate);
  rect(ctx, cx - 0.24 * u, baseY - 2.2 * u, 0.14 * u, 2.2 * u, FENCE.postl);
  rect(ctx, cx + 0.1 * u, baseY - 2.2 * u, 0.12 * u, 2.2 * u, FENCE.postd);
  return { canvas: cv, ax: cx, ay: baseY };
}

// ---------------------------------------------------------------------------
// CHICKEN — plump shaded hen (mockup hen). flip = facing; sleep tucks the head;
// frame 1 = peck (head+beak dip) / opposite leg for the 2-frame graze feel.
// ---------------------------------------------------------------------------
function bakeChicken(flip: boolean, sleep: boolean, frame: 0 | 1): Sprite {
  const w = 24,
    h = 24;
  const { cv, ctx } = makeCanvas(w, h);
  const f = flip ? -1 : 1;
  const x = w / 2,
    y = h / 2 + (sleep ? 2 : 0);
  const peck = frame === 1 && !sleep;
  shadow(ctx, x + 2 * f, y + 8, 8, 2.2);
  const ell = (cx: number, cy: number, rx: number, ry: number, c: string) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, 7);
    ctx.fill();
  };
  // tail feathers (back)
  if (!sleep) {
    ctx.fillStyle = HEN.d2;
    ctx.beginPath();
    ctx.moveTo(x + 6 * f, y - 1);
    ctx.lineTo(x + 11 * f, y - 6);
    ctx.lineTo(x + 10 * f, y - 1);
    ctx.lineTo(x + 11 * f, y + 2);
    ctx.closePath();
    ctx.fill();
    px(ctx, x + 9 * f, y - 4, HEN.d);
  }
  // body
  ell(x, y + 1, 7.5, sleep ? 5 : 6, HEN.b);
  ell(x + 2 * f, y + 2.5, 5.5, 4, HEN.d); // underbelly shade
  ell(x - 1 * f, y - 1, 5.5, 4.5, HEN.b); // upper highlight
  // wing
  ell(x + 1 * f, y + 1, 3.6, 2.8, HEN.d2);
  ctx.strokeStyle = HEN.d;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 1 * f, y - 1);
  ctx.lineTo(x + 4 * f, y + 2);
  ctx.stroke();
  if (!sleep) {
    // head + neck
    const hy = y - 6 + (peck ? 4 : 0);
    const hx = x - 5 * f + (peck ? -1 * f : 0);
    ell(x - 3 * f, y - 3, 3, 3.4, HEN.b); // neck
    ctx.fillStyle = HEN.b;
    ctx.beginPath();
    ctx.arc(hx, hy, 3.6, 0, 7);
    ctx.fill();
    // comb (3 bumps)
    px(ctx, hx + 1 * f, hy - 4, HEN.comb);
    px(ctx, hx, hy - 5, HEN.comb);
    px(ctx, hx - 1 * f, hy - 4, HEN.comb);
    // beak
    px(ctx, hx - 3 * f, hy, HEN.beak);
    px(ctx, hx - 4 * f, hy + 1, HEN.beak);
    // wattle
    px(ctx, hx - 2 * f, hy + 3, HEN.comb);
    // eye
    px(ctx, hx - 1 * f, hy - 1, HEN.eye);
    // legs (frame alternates stride)
    const l1 = peck ? 6 : 5, l2 = peck ? 5 : 6;
    rect(ctx, x - 2, y + 6, 1, l1 - 2, HEN.beak);
    rect(ctx, x + 2, y + 6, 1, l2 - 2, HEN.beak);
    px(ctx, x - 3, y + 4 + l1 - 2, HEN.beak);
    px(ctx, x + 1, y + 4 + l2 - 2, HEN.beak);
  } else {
    // head tucked into the fluff
    ell(x - 3 * f, y - 1, 3.2, 3, HEN.d);
    px(ctx, x - 4 * f, y - 2, HEN.b);
  }
  return { canvas: cv, ax: x, ay: h - 2 };
}

// ---------------------------------------------------------------------------
// GOAT — chunky shaded goat. flip = facing; poses stand / graze / sleep.
// frame 1 flicks the tail up + shifts the near legs for the 2-frame idle/walk.
// ---------------------------------------------------------------------------
function bakeGoat(flip: boolean, pose: "stand" | "graze" | "sleep", frame: 0 | 1): Sprite {
  const u = PPM * 1.6; // R4: grow the drawn goat to ~0.6× the farmer (SCALE.goat)
  const w = Math.ceil(2.5 * u),
    h = Math.ceil(2.3 * u);
  const { cv, ctx } = makeCanvas(w, h);
  const f = flip ? -1 : 1;
  const baseY = h - 2;
  const legLen = pose === "sleep" ? 0.1 * u : 0.55 * u;
  const bodyY = baseY - legLen - 0.36 * u;
  const cx = w / 2;
  shadow(ctx, cx, baseY, 1.0 * u, 0.3 * u);
  const rr = (bx: number, by: number, bw: number, bh: number, c: string) => rect(ctx, cx + bx * f, by, bw, bh, c);
  // legs (frame swings the stride a touch)
  if (pose !== "sleep") {
    const swing = frame === 1 ? 0.04 * u : 0;
    let i = 0;
    for (const lx of [-0.34, -0.1, 0.22, 0.44]) {
      const s = i % 2 ? swing : -swing;
      rect(ctx, cx + lx * u * f - 0.06 * u + s, baseY - legLen, 0.12 * u, legLen, GOAT.d2);
      rect(ctx, cx + lx * u * f - 0.06 * u + s, baseY - 0.14 * u, 0.12 * u, 0.14 * u, GOAT.hoof);
      i++;
    }
  } else {
    // folded legs shadow
    rr(-0.4, baseY - 0.16 * u, 0.9 * u, 0.14 * u, GOAT.d2);
  }
  // body
  rr(-0.52, bodyY, 1.04 * u, 0.62 * u, GOAT.b);
  rr(-0.52, bodyY, 1.04 * u, 0.18 * u, GOAT.lt); // back highlight
  rr(-0.52, bodyY + 0.46 * u, 1.04 * u, 0.16 * u, GOAT.d); // belly shade
  // tail (flicks up on frame 1)
  if (frame === 1 && pose !== "sleep") {
    rr(-0.62, bodyY - 0.1 * u, 0.14 * u, 0.2 * u, GOAT.d);
    px(ctx, cx - 0.58 * u * f, bodyY - 0.12 * u, GOAT.lt);
  } else {
    rr(-0.62, bodyY + 0.04 * u, 0.14 * u, 0.18 * u, GOAT.d);
  }
  // head
  const headX = pose === "graze" ? 0.48 : 0.4;
  const headY = pose === "graze" ? bodyY + 0.52 * u : pose === "sleep" ? bodyY + 0.12 * u : bodyY - 0.22 * u;
  rr(headX, headY, 0.44 * u, 0.42 * u, GOAT.b);
  rr(headX + 0.02, headY, 0.44 * u, 0.1 * u, GOAT.lt);
  rr(headX + 0.3, headY + 0.12 * u, 0.22 * u, 0.22 * u, GOAT.snout); // snout
  px(ctx, cx + (headX + 0.14) * u * f, headY + 0.12 * u, GOAT.eye);
  // beard
  rect(ctx, cx + (headX + 0.28) * u * f - 1, headY + 0.34 * u, 2, 0.14 * u, GOAT.lt);
  // ears + horn nubs
  rr(headX - 0.06, headY + 0.04 * u, 0.12 * u, 0.24 * u, GOAT.d); // droopy ear
  rr(headX + 0.12, headY - 0.18 * u, 0.09 * u, 0.2 * u, GOAT.horns); // horn nub
  return { canvas: cv, ax: cx, ay: baseY };
}

// ---------------------------------------------------------------------------
// EGG — small nest egg.
// ---------------------------------------------------------------------------
function bakeEgg(): Sprite {
  const w = 8,
    h = 9;
  const { cv, ctx } = makeCanvas(w, h);
  shadow(ctx, w / 2, h - 1, 3, 1.2);
  ctx.fillStyle = EGG_COL.d;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, 3, 4, 0, 0, 7);
  ctx.fill();
  ctx.fillStyle = EGG_COL.b;
  ctx.beginPath();
  ctx.ellipse(w / 2 - 0.4, h / 2 - 0.4, 2.4, 3.3, 0, 0, 7);
  ctx.fill();
  px(ctx, w / 2 - 1, h / 2 - 2, EGG_COL.hi);
  return { canvas: cv, ax: w / 2, ay: h - 1 };
}

// ---------------------------------------------------------------------------
// STATIONS — shipping bin (sell) + seed stand (buy).
// ---------------------------------------------------------------------------
function bakeBin(): Sprite {
  const u = PPM * 2.0; // R4: ~2× so the station reads at ~1.4× the farmer (SCALE.bin)
  const w = Math.ceil(2.2 * u),
    h = Math.ceil(2.4 * u);
  const { cv, ctx } = makeCanvas(w, h);
  const cx = w / 2,
    baseY = h - 2;
  shadow(ctx, cx, baseY, 1.0 * u, 0.32 * u);
  const bw = 1.7 * u,
    bh = 1.15 * u;
  const bx = cx - bw / 2,
    by = baseY - bh;
  // crate body — planks + shading
  rect(ctx, bx, by, bw, bh, "#9c7038");
  rect(ctx, bx, by, bw, bh, "#9c7038");
  for (let x = bx + 4; x < bx + bw; x += 6) rect(ctx, x, by, 1, bh, "#7c5628");
  rect(ctx, bx, by, bw, 2, "#b88a4c"); // top-lit edge
  rect(ctx, bx, baseY - 3, bw, 3, "#6b4a24"); // base shade
  // corner posts + top rim
  rect(ctx, bx - 1, by - 1, 3, bh + 1, "#6b4a24");
  rect(ctx, bx + bw - 2, by - 1, 3, bh + 1, "#6b4a24");
  rect(ctx, bx - 2, by - 3, bw + 4, 4, "#7c5628"); // open rim
  rect(ctx, bx - 2, by - 3, bw + 4, 1, "#9c7038");
  // produce spilling over the top (crop-coloured)
  oval(ctx, cx - 0.4 * u, by - 3, 0.28 * u, 0.2 * u, "#e8862c"); // pumpkin
  oval(ctx, cx - 0.4 * u, by - 4, 0.16 * u, 0.1 * u, "#f6a34c");
  oval(ctx, cx + 0.1 * u, by - 4, 0.2 * u, 0.16 * u, "#e2382c"); // tomato
  oval(ctx, cx + 0.5 * u, by - 3, 0.16 * u, 0.14 * u, "#f2d24a"); // corn
  px(ctx, cx - 0.44 * u, by - 5, "#4a7c34");
  // coin placard on a post
  rect(ctx, cx - 0.5, by - 0.72 * u, 1, 0.5 * u, "#6b4a24");
  ctx.fillStyle = "#f4c542";
  ctx.beginPath();
  ctx.arc(cx, by - 0.86 * u, 4.5, 0, 7);
  ctx.fill();
  ctx.fillStyle = "#f8dc84";
  ctx.beginPath();
  ctx.arc(cx - 1, by - 0.86 * u - 1, 2, 0, 7);
  ctx.fill();
  ctx.fillStyle = "#8a5f10";
  ctx.font = "bold 7px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("$", cx, by - 0.82 * u);
  return { canvas: cv, ax: cx, ay: baseY };
}

function bakeStand(): Sprite {
  const u = PPM * 1.85; // R4: the seed stand reads at ~1.5× the farmer (SCALE.stand)
  const w = Math.ceil(2.4 * u),
    h = Math.ceil(2.8 * u);
  const { cv, ctx } = makeCanvas(w, h);
  const cx = w / 2,
    baseY = h - 2;
  shadow(ctx, cx, baseY, 1.05 * u, 0.32 * u);
  // posts
  rect(ctx, cx - 0.9 * u, baseY - 1.55 * u, 0.16 * u, 1.55 * u, "#7a5230");
  rect(ctx, cx + 0.74 * u, baseY - 1.55 * u, 0.16 * u, 1.55 * u, "#7a5230");
  rect(ctx, cx - 0.9 * u, baseY - 1.55 * u, 0.06 * u, 1.55 * u, "#96703f");
  // counter
  rect(ctx, cx - 1.05 * u, baseY - 1.58 * u, 2.1 * u, 0.24 * u, "#9c7a52");
  rect(ctx, cx - 1.05 * u, baseY - 1.58 * u, 2.1 * u, 0.06 * u, "#b89468");
  rect(ctx, cx - 1.05 * u, baseY - 1.36 * u, 2.1 * u, 0.06 * u, "#7c5c38");
  // seed packets + sacks on the counter
  for (let i = 0; i < 4; i++) {
    const sx = cx - 0.8 * u + i * 0.52 * u;
    const col = ["#e2382c", "#f2c14e", "#8f6ae8", "#5aa64a"][i];
    rect(ctx, sx, baseY - 1.86 * u, 0.34 * u, 0.34 * u, col);
    rect(ctx, sx, baseY - 1.86 * u, 0.34 * u, 0.08 * u, "#f4efe6");
    px(ctx, sx + 0.16 * u, baseY - 1.74 * u, "#3f5a24");
  }
  // striped awning
  for (let i = 0; i < 6; i++) {
    rect(ctx, cx - 1.05 * u + i * 0.35 * u, baseY - 2.5 * u, 0.35 * u, 0.55 * u, i % 2 === 0 ? "#c9483a" : "#f0e6d0");
  }
  // scalloped awning edge
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#c9483a" : "#f0e6d0";
    ctx.beginPath();
    ctx.arc(cx - 1.05 * u + i * 0.35 * u + 0.175 * u, baseY - 1.95 * u, 0.175 * u, 0, Math.PI);
    ctx.fill();
  }
  rect(ctx, cx - 1.05 * u, baseY - 2.55 * u, 2.1 * u, 0.12 * u, "#8a5a2c");
  // seed-packet sign on top
  rect(ctx, cx - 0.02 * u - 1, baseY - 2.85 * u, 2, 0.34 * u, "#7a5230");
  ctx.fillStyle = "#7fbf5a";
  ctx.beginPath();
  ctx.arc(cx, baseY - 2.86 * u, 5, 0, 7);
  ctx.fill();
  ctx.fillStyle = "#5a9c3a";
  ctx.beginPath();
  ctx.arc(cx, baseY - 2.86 * u, 5, -0.4, 1.6);
  ctx.fill();
  disc(ctx, cx, baseY - 2.86 * u, 1.8, "#3f6a26"); // seed centre
  px(ctx, cx - 2, baseY - 2.86 * u - 2, "#aee08a");
  return { canvas: cv, ax: cx, ay: baseY };
}

// ---------------------------------------------------------------------------
// CROPS — the money shot. Every crop is a distinct hand-drawn sprite per stage
// (0 sprout · 1 young · 2 mature/green · 3 ready/ripe) in the mockup's ramp
// language: the mockup pumpkin is the quality bar (ribs, top-left highlight,
// hue-shifted shadow). Stages 0-1 share a tinted sprout/bush template; stages
// 2-3 are the crop's own silhouette drawn green (mature) then ripe (ready), so
// a maturing tomato already looks like a staked tomato plant and a ready one
// hangs red fruit. Ready crops get the gold sparkle from field2d.drawEffects.
// ---------------------------------------------------------------------------

/** Per-crop palette + canopy height (metres). */
interface CropArt {
  h: number; // sprite height in metres (tall crops = corn/sunflower/tomato)
  leaf: string;
  leafD: string;
  leafL: string;
  stem: string;
  fruit: string;
  fruitD: string;
  fruitL: string;
  seed?: string;
}
const CROP_ART: Record<CropId, CropArt> = {
  turnip: { h: 1.9, leaf: "#6db55c", leafD: "#4f9a3f", leafL: "#8fd06a", stem: "#3f7c30", fruit: "#f0eaf2", fruitD: "#b98fca", fruitL: "#fdfbff" },
  potato: { h: 2.0, leaf: "#5aa24a", leafD: "#427e37", leafL: "#7cc260", stem: "#3f7c30", fruit: "#c79a5a", fruitD: "#9c6f3c", fruitL: "#e0bd82" },
  corn: { h: 2.75, leaf: "#5fae4c", leafD: "#468639", leafL: "#84c866", stem: "#5c9438", fruit: "#f2d24a", fruitD: "#d0a828", fruitL: "#fbe887" },
  pumpkin: { h: 2.0, leaf: "#4f9a3f", leafD: "#3a7830", leafL: "#6db55c", stem: "#4a7c34", fruit: PUMP.base, fruitD: PUMP.dk, fruitL: PUMP.lt2 },
  strawberry: { h: 1.75, leaf: "#5aa64a", leafD: "#41823a", leafL: "#7cc45e", stem: "#3f7c30", fruit: "#ef4034", fruitD: "#c02a24", fruitL: "#ff7a5e", seed: "#ffe27a" },
  carrot: { h: 2.05, leaf: "#68b356", leafD: "#4a8f3c", leafL: "#8ed068", stem: "#4a8f3c", fruit: "#e8823a", fruitD: "#c05f22", fruitL: "#f6a85a" },
  tomato: { h: 2.7, leaf: "#4f9a44", leafD: "#3a7834", leafL: "#6fb85a", stem: "#7a5230", fruit: "#e2382c", fruitD: "#b7261e", fruitL: "#ff6a52" },
  sunflower: { h: 2.85, leaf: "#57a048", leafD: "#417e38", leafL: "#78bd5e", stem: "#5c9438", fruit: "#f2c14e", fruitD: "#d69a2c", fruitL: "#ffe07a" },
};

const disc = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string) => {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
};
const oval = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, c: string, rot = 0) => {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, 7);
  ctx.fill();
};

/** Shared leafy sprout/young bush (stages 0-1), tinted to the crop. */
function drawSproutBush(ctx: CanvasRenderingContext2D, cx: number, baseY: number, art: CropArt, young: boolean): void {
  if (!young) {
    rect(ctx, cx - 1, baseY - 4, 2, 4, art.stem);
    oval(ctx, cx - 2, baseY - 4, 2.6, 1.7, art.leaf, -0.6);
    oval(ctx, cx + 2, baseY - 4, 2.6, 1.7, art.leafL, 0.6);
    px(ctx, cx, baseY - 5, art.leafL);
    return;
  }
  const bh = 6;
  rect(ctx, cx - 1, baseY - bh, 2, bh, art.stem);
  disc(ctx, cx, baseY - bh, 3.4, art.leafD);
  disc(ctx, cx - 2.6, baseY - bh + 1.2, 2.6, art.leaf);
  disc(ctx, cx + 2.6, baseY - bh + 0.6, 2.6, art.leaf);
  disc(ctx, cx - 0.4, baseY - bh - 2, 2.6, art.leafL);
}

/** The mockup ribbed pumpkin (quality bar): 3 lobes, hue-shifted shadow, top
 * highlight, curled stem. `ripe` swaps orange for green (mature). */
function drawGourd(ctx: CanvasRenderingContext2D, cx: number, baseY: number, art: CropArt, ripe: boolean, R: number): void {
  const f = ripe ? art.fruit : art.leaf;
  const fd = ripe ? art.fruitD : art.leafD;
  const fl = ripe ? art.fruitL : art.leafL;
  const cy = baseY - R * 0.82;
  // shadow lobe first (back), then side lobes, then centre + highlight
  oval(ctx, cx, cy, R * 1.15, R, fd);
  oval(ctx, cx - R * 0.62, cy + R * 0.06, R * 0.62, R * 0.94, f);
  oval(ctx, cx + R * 0.62, cy + R * 0.06, R * 0.62, R * 0.94, f);
  oval(ctx, cx, cy, R * 0.7, R * 0.98, fl);
  oval(ctx, cx, cy, R * 0.5, R * 0.9, f);
  // rib shadows
  ctx.strokeStyle = fd;
  ctx.lineWidth = 1;
  for (const dx of [-R * 0.5, 0, R * 0.5]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx * 0.5, cy, Math.abs(dx) * 0.5 + 1, R * 0.9, 0, -1.4, 1.4);
    ctx.stroke();
  }
  // top-left highlight
  oval(ctx, cx - R * 0.42, cy - R * 0.5, R * 0.22, R * 0.3, fl);
  // stem
  rect(ctx, cx - 1, cy - R - 2, 2, 3, art.stem);
  px(ctx, cx + 1, cy - R - 2, art.leafL);
}

function bakeCrop(cropId: CropId, stage: 0 | 1 | 2 | 3): Sprite {
  const u = PPM;
  const art = CROP_ART[cropId];
  const w = Math.ceil(2.0 * u);
  const h = Math.ceil(art.h * u);
  const { cv, ctx } = makeCanvas(w, h);
  const cx = Math.round(w / 2);
  const baseY = h - 2;
  const ripe = stage === 3;

  if (stage <= 1) {
    drawSproutBush(ctx, cx, baseY, art, stage === 1);
    return { canvas: cv, ax: cx, ay: baseY };
  }

  // stage 2 (mature/green) + 3 (ready/ripe): the crop's own silhouette
  switch (cropId) {
    case "pumpkin":
      drawVineLeaves(ctx, cx, baseY, art);
      drawGourd(ctx, cx, baseY, art, ripe, 0.62 * u);
      break;
    case "turnip":
      drawLeafFan(ctx, cx, baseY - (ripe ? 0.7 * u : 0.2 * u), art, 0.8);
      if (ripe) {
        oval(ctx, cx, baseY - 0.34 * u, 0.5 * u, 0.42 * u, art.fruitD);
        oval(ctx, cx, baseY - 0.4 * u, 0.42 * u, 0.36 * u, art.fruit);
        oval(ctx, cx - 0.14 * u, baseY - 0.52 * u, 0.16 * u, 0.14 * u, art.fruitL);
        rect(ctx, cx - 0.34 * u, baseY - 0.5 * u, 0.68 * u, 3, art.fruitD); // purple shoulder band
      } else {
        oval(ctx, cx, baseY - 0.14 * u, 0.28 * u, 0.16 * u, art.leafD);
      }
      break;
    case "carrot":
      // feathery fronds
      drawFronds(ctx, cx, baseY - (ripe ? 0.5 * u : 0.2 * u), art);
      if (ripe) {
        for (const dx of [-0.22, 0.16]) {
          oval(ctx, cx + dx * u, baseY - 0.18 * u, 0.16 * u, 0.2 * u, art.fruitD);
          oval(ctx, cx + dx * u, baseY - 0.22 * u, 0.12 * u, 0.16 * u, art.fruit);
          px(ctx, cx + dx * u, baseY - 0.32 * u, art.fruitL);
        }
      }
      break;
    case "strawberry":
      drawBush(ctx, cx, baseY, art, 1.0 * u, 0.62 * u);
      if (ripe) {
        for (const [dx, dy] of [[-0.36, 0.02], [0.32, 0.1], [0.02, 0.22]] as const) {
          const bx = cx + dx * u, by = baseY - 0.14 * u + dy * u;
          ctx.fillStyle = art.fruitD;
          ctx.beginPath();
          ctx.moveTo(bx - 2.4, by - 2.4);
          ctx.quadraticCurveTo(bx + 2.6, by - 2.6, bx + 2.4, by - 1.8);
          ctx.quadraticCurveTo(bx + 1.4, by + 2.8, bx, by + 3);
          ctx.quadraticCurveTo(bx - 1.6, by + 2.6, bx - 2.6, by - 1.6);
          ctx.closePath();
          ctx.fill();
          oval(ctx, bx, by - 0.2, 2.1, 2.3, art.fruit);
          px(ctx, bx - 1, by - 1, art.fruitL);
          if (art.seed) { px(ctx, bx + 1, by, art.seed); px(ctx, bx - 1, by + 1.6, art.seed); }
          rect(ctx, bx - 1.5, by - 3, 3, 1.5, art.leafD); // green calyx
        }
      }
      break;
    case "tomato":
      drawStakedPlant(ctx, cx, baseY, art, ripe);
      break;
    case "corn":
      drawCorn(ctx, cx, baseY, art, ripe);
      break;
    case "sunflower":
      drawSunflower(ctx, cx, baseY, art, ripe);
      break;
    case "potato":
      drawBush(ctx, cx, baseY, art, 1.05 * u, 0.7 * u);
      if (ripe) {
        // little white blossoms + a couple tubers at the soil line
        for (const dx of [-0.3, 0.22, 0]) { px(ctx, cx + dx * u, baseY - 0.9 * u, "#f4efe6"); px(ctx, cx + dx * u, baseY - 0.9 * u + 1, art.fruitL); }
        oval(ctx, cx - 0.5 * u, baseY - 0.1 * u, 0.24 * u, 0.16 * u, art.fruitD);
        oval(ctx, cx - 0.5 * u, baseY - 0.12 * u, 0.2 * u, 0.13 * u, art.fruit);
        oval(ctx, cx + 0.5 * u, baseY - 0.08 * u, 0.2 * u, 0.14 * u, art.fruit);
        px(ctx, cx - 0.56 * u, baseY - 0.16 * u, art.fruitL);
      }
      break;
  }
  return { canvas: cv, ax: cx, ay: baseY };
}

// ---- crop-part helpers ------------------------------------------------------
function drawBush(ctx: CanvasRenderingContext2D, cx: number, baseY: number, art: CropArt, wdt: number, hgt: number): void {
  const top = baseY - hgt;
  oval(ctx, cx, top + hgt * 0.4, wdt * 0.5, hgt * 0.55, art.leafD);
  disc(ctx, cx - wdt * 0.28, top + hgt * 0.35, hgt * 0.4, art.leaf);
  disc(ctx, cx + wdt * 0.28, top + hgt * 0.3, hgt * 0.4, art.leaf);
  disc(ctx, cx, top + hgt * 0.15, hgt * 0.38, art.leafL);
  disc(ctx, cx - wdt * 0.14, top + hgt * 0.05, hgt * 0.26, art.leafL);
}
function drawLeafFan(ctx: CanvasRenderingContext2D, cx: number, topY: number, art: CropArt, spread: number): void {
  for (const [dx, rot, c] of [[-0.34, -0.7, art.leaf], [0.34, 0.7, art.leaf], [-0.12, -0.25, art.leafL], [0.12, 0.25, art.leafL], [0, 0, art.leafD]] as const) {
    oval(ctx, cx + dx * PPM * spread, topY - 1, 2.1, 5.2, c as string, rot as number);
  }
}
function drawFronds(ctx: CanvasRenderingContext2D, cx: number, topY: number, art: CropArt): void {
  ctx.strokeStyle = art.leaf;
  ctx.lineWidth = 1;
  for (let i = -3; i <= 3; i++) {
    ctx.strokeStyle = i % 2 ? art.leafL : art.leaf;
    ctx.beginPath();
    ctx.moveTo(cx, topY);
    ctx.quadraticCurveTo(cx + i * 1.4, topY - 4, cx + i * 2.4, topY - 8 - Math.abs(i));
    ctx.stroke();
  }
  disc(ctx, cx, topY, 2, art.leafD);
}
function drawVineLeaves(ctx: CanvasRenderingContext2D, cx: number, baseY: number, art: CropArt): void {
  oval(ctx, cx - 0.82 * PPM, baseY - 0.2 * PPM, 0.34 * PPM, 0.22 * PPM, art.leafD, -0.3);
  oval(ctx, cx + 0.82 * PPM, baseY - 0.16 * PPM, 0.34 * PPM, 0.22 * PPM, art.leaf, 0.3);
  oval(ctx, cx + 0.72 * PPM, baseY - 0.9 * PPM, 0.26 * PPM, 0.18 * PPM, art.leafL, 0.6);
}
function drawStakedPlant(ctx: CanvasRenderingContext2D, cx: number, baseY: number, art: CropArt, ripe: boolean): void {
  const top = baseY - 2.4 * PPM;
  rect(ctx, cx + 0.3 * PPM, top, 1, 2.4 * PPM, art.stem); // stake
  rect(ctx, cx + 0.3 * PPM, top, 1, 0.3 * PPM, "#9c7048");
  // foliage clumps up the stake
  for (let i = 0; i < 4; i++) {
    const y = baseY - 0.4 * PPM - i * 0.52 * PPM;
    disc(ctx, cx + (i % 2 ? 2 : -2), y, 3.6 - i * 0.2, i % 2 ? art.leaf : art.leafD);
    disc(ctx, cx + (i % 2 ? -1 : 1), y - 1, 2.6, art.leafL);
  }
  if (ripe) {
    for (const [dx, dy] of [[-0.28, 0.3], [0.24, 0.6], [-0.05, 0.95], [0.28, 1.15]] as const) {
      const bx = cx + dx * PPM, by = baseY - dy * PPM;
      disc(ctx, bx, by, 2.4, art.fruitD);
      disc(ctx, bx, by, 2.0, art.fruit);
      px(ctx, bx - 1, by - 1, art.fruitL);
      px(ctx, bx, by - 2.4, art.leafD); // stem cap
    }
  }
}
function drawCorn(ctx: CanvasRenderingContext2D, cx: number, baseY: number, art: CropArt, ripe: boolean): void {
  const top = baseY - 2.55 * PPM;
  rect(ctx, cx - 1, top, 2, 2.55 * PPM, art.stem); // stalk
  rect(ctx, cx - 1, top, 1, 2.55 * PPM, art.leafL);
  // long blade leaves arcing down
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const y = baseY - 0.4 * PPM - i * 0.42 * PPM;
    const dir = i % 2 ? 1 : -1;
    ctx.strokeStyle = i % 2 ? art.leaf : art.leafD;
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.quadraticCurveTo(cx + dir * 0.7 * PPM, y - 2, cx + dir * 1.15 * PPM, y + 0.3 * PPM);
    ctx.stroke();
  }
  // tassel
  ctx.strokeStyle = ripe ? art.fruitL : art.leafL;
  for (const dx of [-2, 0, 2]) { ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx + dx, top - 4); ctx.stroke(); }
  if (ripe) {
    // one husked ear
    const ey = baseY - 1.15 * PPM;
    oval(ctx, cx + 0.34 * PPM, ey, 0.24 * PPM, 0.5 * PPM, art.fruitD);
    oval(ctx, cx + 0.34 * PPM, ey, 0.19 * PPM, 0.46 * PPM, art.fruit);
    for (let k = 0; k < 4; k++) { px(ctx, cx + 0.28 * PPM, ey - 4 + k * 2, art.fruitL); px(ctx, cx + 0.4 * PPM, ey - 3 + k * 2, art.fruitL); }
    oval(ctx, cx + 0.26 * PPM, ey + 0.2 * PPM, 0.1 * PPM, 0.34 * PPM, art.leaf); // husk
  }
}
function drawSunflower(ctx: CanvasRenderingContext2D, cx: number, baseY: number, art: CropArt, ripe: boolean): void {
  const headY = baseY - 2.3 * PPM;
  rect(ctx, cx - 1, headY, 2, 2.3 * PPM, art.stem); // stalk
  rect(ctx, cx - 1, headY, 1, 2.3 * PPM, art.leafL);
  oval(ctx, cx - 0.5 * PPM, baseY - 1.2 * PPM, 0.34 * PPM, 0.2 * PPM, art.leaf, -0.4); // side leaf
  oval(ctx, cx + 0.5 * PPM, baseY - 0.7 * PPM, 0.34 * PPM, 0.2 * PPM, art.leafD, 0.4);
  if (ripe) {
    // petal ring
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      oval(ctx, cx + Math.cos(a) * 0.5 * PPM, headY + Math.sin(a) * 0.5 * PPM, 2.2, 1.2, i % 2 ? art.fruit : art.fruitL, a);
    }
    disc(ctx, cx, headY, 0.34 * PPM, "#7a4c2c"); // brown centre
    disc(ctx, cx, headY, 0.26 * PPM, "#5f3820");
    for (let k = 0; k < 6; k++) px(ctx, cx - 2 + (k % 3) * 2, headY - 2 + Math.floor(k / 3) * 2, "#8a6236");
  } else {
    disc(ctx, cx, headY, 0.4 * PPM, art.leafD); // green bud
    disc(ctx, cx, headY, 0.3 * PPM, art.leaf);
    px(ctx, cx - 2, headY - 2, art.leafL);
  }
}

// ---------------------------------------------------------------------------
// DECOR — full per-type pixel sprites (R2). Static bodies bake here; the
// pinwheel's vanes + the flag's banner are drawn dynamically by decor2d (spin /
// wave) over the baked pole. PINWHEEL_TOP / FLAG_TOP give decor2d the pole-top
// anchor (sprite-local px, measured up from the ground anchor) so the animated
// part lands exactly atop the baked stick.
// ---------------------------------------------------------------------------
export const PINWHEEL_TOP = 16; // px above ground for the vane hub
export const FLAG_TOP = 15; // px above ground for the banner top

function bakeDecor(type: string): Sprite {
  switch (type) {
    case "scarecrow": {
      const w = 22, h = 30;
      const { cv, ctx } = makeCanvas(w, h);
      const cx = w / 2, baseY = h - 1;
      shadow(ctx, cx, baseY, 5, 2);
      rect(ctx, cx - 1, baseY - 22, 2, 22, "#8a6236"); // post
      rect(ctx, cx - 8, baseY - 15, 16, 2, "#8a6236"); // arms
      rect(ctx, cx - 5, baseY - 16, 10, 8, "#b3402f"); // plaid shirt
      for (let x = cx - 5; x < cx + 5; x += 3) rect(ctx, x, baseY - 16, 1, 8, "#7c2a20");
      for (let y = baseY - 16; y < baseY - 8; y += 3) rect(ctx, cx - 5, y, 10, 1, "#7c2a20");
      // straw tufts at wrists + hem
      for (const s of [-8, 8]) { rect(ctx, cx + s - 1, baseY - 15, 2, 4, "#e0c65a"); px(ctx, cx + s, baseY - 11, "#c8a63a"); }
      for (const s of [-3, 0, 3]) rect(ctx, cx + s, baseY - 8, 1, 3, "#e0c65a");
      // burlap head
      disc(ctx, cx, baseY - 20, 4, "#d9c27a");
      disc(ctx, cx - 1, baseY - 21, 2, "#e8d49a");
      px(ctx, cx - 1.5, baseY - 20, "#4a3226"); px(ctx, cx + 1.5, baseY - 20, "#4a3226"); // eyes
      rect(ctx, cx - 1, baseY - 18, 2, 1, "#8a5a2c"); // stitched mouth
      // straw hat
      rect(ctx, cx - 5, baseY - 23, 10, 2, "#c8912f");
      rect(ctx, cx - 3, baseY - 26, 6, 3, "#c8912f");
      rect(ctx, cx - 3, baseY - 26, 6, 1, "#e0b45a");
      rect(ctx, cx - 3, baseY - 24, 6, 1, "#9c6b2f");
      return { canvas: cv, ax: cx, ay: baseY };
    }
    case "gnome": {
      const w = 14, h = 18;
      const { cv, ctx } = makeCanvas(w, h);
      const cx = w / 2, baseY = h - 1;
      shadow(ctx, cx, baseY, 4, 1.6);
      oval(ctx, cx, baseY - 3, 3.4, 3, "#3f7fd0"); // blue body
      oval(ctx, cx - 1, baseY - 4, 1.6, 1.4, "#5a97e0");
      rect(ctx, cx - 3, baseY - 1, 6, 1, "#2c5aa0");
      disc(ctx, cx, baseY - 7, 3, "#f0c9a0"); // face
      px(ctx, cx - 1, baseY - 7, "#4a3226"); px(ctx, cx + 1, baseY - 7, "#4a3226"); // eyes
      px(ctx, cx, baseY - 6, "#e08a6a"); // nose
      // white beard
      ctx.fillStyle = "#f4efe6";
      ctx.beginPath();
      ctx.moveTo(cx - 3, baseY - 7);
      ctx.lineTo(cx + 3, baseY - 7);
      ctx.lineTo(cx, baseY - 2);
      ctx.closePath();
      ctx.fill();
      // red cap
      ctx.fillStyle = "#c23b3b";
      ctx.beginPath();
      ctx.moveTo(cx - 4, baseY - 9);
      ctx.lineTo(cx + 4, baseY - 9);
      ctx.lineTo(cx, baseY - 16);
      ctx.closePath();
      ctx.fill();
      px(ctx, cx - 2, baseY - 10, "#e05a5a"); // cap highlight
      px(ctx, cx, baseY - 16, "#f4efe6"); // pom
      return { canvas: cv, ax: cx, ay: baseY };
    }
    case "bench": {
      const w = 20, h = 14;
      const { cv, ctx } = makeCanvas(w, h);
      const cx = w / 2, baseY = h - 1;
      shadow(ctx, cx, baseY, 8, 2);
      rect(ctx, cx - 8, baseY - 5, 16, 3, "#9c6b3a"); // seat
      rect(ctx, cx - 8, baseY - 5, 16, 1, "#b8894e");
      rect(ctx, cx - 8, baseY - 11, 16, 2, "#9c6b3a"); // backrest top
      for (let x = cx - 7; x < cx + 8; x += 4) rect(ctx, x, baseY - 9, 1, 4, "#8a5f30"); // slats
      rect(ctx, cx - 7, baseY - 2, 2, 2, "#6b4a26"); // legs
      rect(ctx, cx + 5, baseY - 2, 2, 2, "#6b4a26");
      return { canvas: cv, ax: cx, ay: baseY };
    }
    case "flowerbed": {
      const w = 20, h = 12;
      const { cv, ctx } = makeCanvas(w, h);
      const cx = w / 2, baseY = h - 1;
      shadow(ctx, cx, baseY, 8, 2);
      rect(ctx, cx - 8, baseY - 4, 16, 4, "#6b4a2c"); // soil box
      rect(ctx, cx - 8, baseY - 4, 16, 1, "#8a6440");
      rect(ctx, cx - 8, baseY - 4, 1, 4, "#4a3320");
      const cols = ["#e86a8f", "#f2c14e", "#8f6ae8", "#ef7d4a", "#e23b3b"];
      let seed = 11;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let i = 0; i < 6; i++) {
        const fx = cx - 6 + i * 2.4;
        rect(ctx, fx, baseY - 7, 1, 3, "#4f8437"); // stem
        disc(ctx, fx, baseY - 8, 1.8, cols[Math.floor(rnd() * cols.length)]);
        px(ctx, fx, baseY - 8, "#fff4c8");
      }
      return { canvas: cv, ax: cx, ay: baseY };
    }
    case "pathtile": {
      const w = 16, h = 10;
      const { cv, ctx } = makeCanvas(w, h);
      const cx = w / 2, baseY = h - 2;
      oval(ctx, cx, baseY, 7, 4, "#8a847a");
      oval(ctx, cx, baseY - 0.6, 6, 3.2, "#a49c90");
      oval(ctx, cx - 1, baseY - 1, 3, 1.6, "#b8b0a2");
      px(ctx, cx + 3, baseY, "#7c766c"); px(ctx, cx - 3, baseY + 1, "#7c766c");
      return { canvas: cv, ax: cx, ay: baseY + 2 };
    }
    case "birdbath": {
      const w = 16, h = 18;
      const { cv, ctx } = makeCanvas(w, h);
      const cx = w / 2, baseY = h - 1;
      shadow(ctx, cx, baseY, 5, 2);
      rect(ctx, cx - 2, baseY - 8, 4, 8, "#bfbfc4"); // pedestal
      rect(ctx, cx - 2, baseY - 8, 1, 8, "#d6d6da");
      rect(ctx, cx - 3, baseY - 1, 6, 1, "#a6a6ac"); // base
      oval(ctx, cx, baseY - 9, 5, 2.2, "#d2d2d8"); // basin
      oval(ctx, cx, baseY - 9.4, 3.6, 1.5, "#5aa6d6"); // water
      oval(ctx, cx - 1, baseY - 9.8, 1.4, 0.7, "#8ec8e6"); // glint
      return { canvas: cv, ax: cx, ay: baseY };
    }
    case "flag": {
      const w = 6, h = 20;
      const { cv, ctx } = makeCanvas(w, h);
      const cx = w / 2, baseY = h - 1;
      shadow(ctx, cx, baseY, 3, 1.4);
      rect(ctx, cx - 1, baseY - 18, 2, 18, "#8a6236"); // pole
      rect(ctx, cx - 1, baseY - 18, 1, 18, "#a07a48");
      disc(ctx, cx, baseY - 18, 1.5, "#e8c96a"); // finial
      return { canvas: cv, ax: cx, ay: baseY };
    }
    case "pinwheel": {
      const w = 6, h = 18;
      const { cv, ctx } = makeCanvas(w, h);
      const cx = w / 2, baseY = h - 1;
      shadow(ctx, cx, baseY, 3, 1.4);
      rect(ctx, cx - 1, baseY - 16, 2, 16, "#c0c0c4"); // stick
      rect(ctx, cx - 1, baseY - 16, 1, 16, "#d8d8dc");
      return { canvas: cv, ax: cx, ay: baseY };
    }
    default: {
      const w = 12, h = 14;
      const { cv, ctx } = makeCanvas(w, h);
      const cx = w / 2, baseY = h - 1;
      shadow(ctx, cx, baseY, 4, 1.5);
      rect(ctx, cx - 3, baseY - 6, 6, 6, "#c8a06a");
      return { canvas: cv, ax: cx, ay: baseY };
    }
  }
}

// ---------------------------------------------------------------------------
// Cached accessors — bake once, reuse forever.
// ---------------------------------------------------------------------------
const cache = new Map<string, Sprite>();
function memo(key: string, build: () => Sprite): Sprite {
  let s = cache.get(key);
  if (!s) {
    s = build();
    cache.set(key, s);
  }
  return s;
}

export const Sprites = {
  tree: (sizeIdx: number) => memo(`tree${sizeIdx}`, () => bakeTree(sizeIdx)),
  rock: (sizeIdx: number) => memo(`rock${sizeIdx}`, () => bakeRock(sizeIdx)),
  barnBack: (night: boolean) => memo(`barnBack${night ? "n" : "d"}`, () => bakeBarnBack(night)),
  barnFront: (night: boolean) => memo(`barnFront${night ? "n" : "d"}`, () => bakeBarnFront(night)),
  silo: () => memo("silo", bakeSilo),
  farmhouse: (night: boolean) => memo(`house${night ? "n" : "d"}`, () => bakeFarmhouse(night)),
  fencePost: () => memo("fencepost", bakeFencePost),
  gatePost: () => memo("gatepost", bakeGatePost),
  chicken: (flip: boolean, sleep: boolean, frame: 0 | 1 = 0) => memo(`hen${flip ? "L" : "R"}${sleep ? "s" : ""}${frame}`, () => bakeChicken(flip, sleep, frame)),
  goat: (flip: boolean, pose: "stand" | "graze" | "sleep", frame: 0 | 1 = 0) => memo(`goat${flip ? "L" : "R"}${pose}${frame}`, () => bakeGoat(flip, pose, frame)),
  egg: () => memo("egg", bakeEgg),
  bin: () => memo("bin", bakeBin),
  stand: () => memo("stand", bakeStand),
  crop: (cropId: CropId, stage: 0 | 1 | 2 | 3) => memo(`crop${cropId}${stage}`, () => bakeCrop(cropId, stage)),
  decor: (type: string) => memo(`decor${type}`, () => bakeDecor(type)),
};

/** Ground-fill palette handles for world2d's static bake. */
export { G, PATH, SOIL };
