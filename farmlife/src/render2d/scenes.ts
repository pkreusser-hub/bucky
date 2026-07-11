// ---------------------------------------------------------------------------
// scenes.ts — the SCENE STACK (R4). The world is the "exterior" scene; each
// enterable building is an INTERIOR scene with its own small tilemap, camera
// clamp, colliders and an exit mat. main.ts owns the fade transition + which
// scene is active; this module owns the interior DATA + drawing + collision and
// the exterior DOOR descriptors.
//
// Adding a future interior (coop, shed) is DATA + a draw function here + one
// entry in INTERIORS / EXTERIOR_DOORS — no new architecture in main.ts.
//
// COORDS: an interior lives in its own little world centred at (0,0) in the SAME
// metres/PPM as the exterior (so the farmer sprite is the same size). main.ts
// clamps the camera to `camClamp` while inside, and draws a dark gloom outside
// the room rect. THE BARN IS NOT HERE — it stays a cutaway dollhouse (its
// day/night herd routine through the door is core charm).
//
// MP: a player inside an interior keeps publishing the building's DOOR world
// coords to presence, so remote viewers see them standing at the door (their own
// screen shows the interior). No wire-format change — see main.ts frameInterior.
// ---------------------------------------------------------------------------

import { PPM } from "./coords";
import type { Renderer2D } from "./renderer";
import type { Facing } from "./farmer2d";

/** Axis-aligned box collider in a scene's own world metres. */
export interface Box {
  x: number;
  z: number;
  hw: number;
  hh: number;
}

/** An enterable door in the EXTERIOR world. */
export interface ExteriorDoor {
  interiorId: string;
  /** Interaction spot (exterior world metres) — the "doormat" the player stands on. */
  x: number;
  z: number;
  reach: number;
  /** Rough facing the player must hold (toward the building) for the prompt. */
  faceTo: Facing;
  label: string;
  /** Facing to restore on EXIT (away from the door). */
  exitFacing: Facing;
  /** Where to draw the little door icon on the map. */
  mapX: number;
  mapZ: number;
}

/** An interior room scene. */
export interface Interior {
  id: string;
  name: string;
  cols: number;
  rows: number;
  /** Visual room rect (metres) — the camera clamps here; gloom fills outside it. */
  view: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Walkable rect (inside the walls, metres). */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Where the player appears when ENTERING. */
  spawn: { x: number; z: number; facing: Facing };
  /** Exit-mat trigger (metres) — action here leaves the building. */
  exit: { x: number; z: number; r: number };
  /** Furniture colliders (metres). */
  colliders: Box[];
  /** Draw the ROOM (floor/walls/furniture/fx); main draws the player on top. */
  draw(rr: Renderer2D, tSec: number, night: boolean): void;
}

// ---------------------------------------------------------------------------
// Facing → heading (rad), the inverse of farmer2d.facingFromHeading. atan2(dx,dz)
// convention: up = −Z, down = +Z, right = +X.
// ---------------------------------------------------------------------------
export function facingHeading(f: Facing): number {
  switch (f) {
    case "up":
      return Math.PI; // dz = -1
    case "down":
      return 0; // dz = +1
    case "left":
      return -Math.PI / 2; // dx = -1
    case "right":
      return Math.PI / 2; // dx = +1
  }
}

// ---------------------------------------------------------------------------
// Interior collision: clamp to the walkable bounds (minus radius) + push out of
// furniture boxes. Two relaxation passes so a corner settles (mirrors the
// pasture containAnimal shape). PURE-ish (reads the interior's static geometry).
// ---------------------------------------------------------------------------
const PLAYER_R = 0.7;
export function resolveInteriorCollision(it: Interior, x: number, z: number): { x: number; z: number } {
  let ax = x;
  let az = z;
  const b = it.bounds;
  for (let pass = 0; pass < 2; pass++) {
    ax = Math.max(b.minX + PLAYER_R, Math.min(b.maxX - PLAYER_R, ax));
    az = Math.max(b.minZ + PLAYER_R, Math.min(b.maxZ - PLAYER_R, az));
    for (const box of it.colliders) {
      const dx = ax - box.x;
      const dz = az - box.z;
      const ox = box.hw + PLAYER_R - Math.abs(dx);
      const oz = box.hh + PLAYER_R - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        // push out along the least-penetrating axis
        if (ox < oz) ax = box.x + Math.sign(dx || 1) * (box.hw + PLAYER_R);
        else az = box.z + Math.sign(dz || 1) * (box.hh + PLAYER_R);
      }
    }
  }
  return { x: ax, z: az };
}

// ---------------------------------------------------------------------------
// Drawing helpers (camera-relative, mirror the sprite-bake pixel language).
// ---------------------------------------------------------------------------
function fillRectW(rr: Renderer2D, x0: number, z0: number, x1: number, z1: number, c: string): void {
  const sx = rr.sx(x0);
  const sy = rr.sy(z0);
  rr.ctx.fillStyle = c;
  rr.ctx.fillRect(sx, sy, rr.sx(x1) - sx, rr.sy(z1) - sy);
}
/** deterministic mulberry32 (stable interior speckle). */
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

// ---------------------------------------------------------------------------
// FARMHOUSE INTERIOR — a cosy 14×10 room. Plank floor + rug, a bed, a table with
// chairs, a fireplace with an animated flame + warm light pool, day/night
// windows, a shelf and a potted plant. Decorative this round (no gameplay).
// ---------------------------------------------------------------------------
const FH_VIEW = { minX: -14, maxX: 14, minZ: -10, maxZ: 10 };
const FH_BOUNDS = { minX: -12, maxX: 12, minZ: -8, maxZ: 8.6 };

function drawFarmhouseRoom(rr: Renderer2D, tSec: number, night: boolean): void {
  const ctx = rr.ctx;
  ctx.imageSmoothingEnabled = false;
  // gloom beyond the room
  ctx.fillStyle = "#1c140e";
  ctx.fillRect(0, 0, rr.nativeW, rr.nativeH);

  const floorZ0 = -8; // north wall base
  // ---- plank floor ----
  fillRectW(rr, FH_VIEW.minX, floorZ0, FH_VIEW.maxX, 9.2, "#8a5f38");
  const px = PPM;
  // horizontal plank seams every ~1.1 m + vertical board breaks
  const r = rng(7);
  for (let z = floorZ0; z < 9.2; z += 1.1) {
    const sy = rr.sy(z);
    ctx.fillStyle = "#6f4a2a";
    ctx.fillRect(rr.sx(FH_VIEW.minX), sy, rr.sx(FH_VIEW.maxX) - rr.sx(FH_VIEW.minX), 1);
    ctx.fillStyle = "#9c6f42";
    ctx.fillRect(rr.sx(FH_VIEW.minX), sy + 1, rr.sx(FH_VIEW.maxX) - rr.sx(FH_VIEW.minX), 1);
    // staggered board breaks
    const off = (r() - 0.5) * 2;
    for (let x = FH_VIEW.minX + off; x < FH_VIEW.maxX; x += 2.6) {
      ctx.fillStyle = "#5f3f24";
      ctx.fillRect(rr.sx(x), sy, 1, Math.round(1.1 * px));
    }
  }
  // subtle floor knots
  for (let i = 0; i < 26; i++) {
    const x = FH_VIEW.minX + r() * 28;
    const z = floorZ0 + r() * 17;
    ctx.fillStyle = "#7a5230";
    ctx.fillRect(rr.sx(x), rr.sy(z), 2, 1);
  }

  // ---- rug (centre) ----
  drawRug(rr, 0, 2.2, 9, 6.2);

  // ---- north wall band ----
  fillRectW(rr, FH_VIEW.minX, FH_VIEW.minZ, FH_VIEW.maxX, floorZ0, "#6e4a2c");
  fillRectW(rr, FH_VIEW.minX, floorZ0 - 0.4, FH_VIEW.maxX, floorZ0, "#573923"); // baseboard
  fillRectW(rr, FH_VIEW.minX, FH_VIEW.minZ, FH_VIEW.maxX, FH_VIEW.minZ + 0.3, "#835a37"); // top rail
  // vertical wall panelling
  for (let x = FH_VIEW.minX + 1; x < FH_VIEW.maxX; x += 1.6) {
    ctx.fillStyle = "#5f3f26";
    ctx.fillRect(rr.sx(x), rr.sy(FH_VIEW.minZ), 1, rr.sy(floorZ0) - rr.sy(FH_VIEW.minZ));
  }

  // ---- windows (north wall) — day light / night dark ----
  for (const wx of [-6, 6]) drawWindow(rr, wx, floorZ0, night);

  // ---- fireplace (north wall centre) ----
  drawFireplace(rr, 0, floorZ0, tSec, night);

  // ---- shelf on the west wall ----
  drawShelf(rr, -11.2, 2);

  // ---- furniture ----
  drawBed(rr, -8.5, -4.4);
  drawTable(rr, 7, 1.4);
  drawPlant(rr, 10.6, 6.2);

  // ---- south wall hint + exit door + doormat ----
  fillRectW(rr, FH_VIEW.minX, 8.9, FH_VIEW.maxX, FH_VIEW.maxZ, "#573923");
  drawExitDoor(rr, 0, 8.9);

  // ---- warm light overlays (after everything, additive) ----
  drawLightPools(rr, 0, floorZ0, night, tSec);
}

function drawRug(rr: Renderer2D, cx: number, cz: number, w: number, h: number): void {
  const ctx = rr.ctx;
  const oval = (rx: number, ry: number, c: string) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(rr.sx(cx), rr.sy(cz), rx * PPM, ry * PPM, 0, 0, 7);
    ctx.fill();
  };
  oval(w / 2, h / 2, "#7a2f2c");
  oval(w / 2 - 0.5, h / 2 - 0.4, "#a4423a");
  oval(w / 2 - 1.4, h / 2 - 1.1, "#c96a54");
  oval(w / 2 - 2.4, h / 2 - 1.9, "#a4423a");
  // cream centre motif
  oval(1.4, 1.0, "#e8d3a8");
  oval(0.8, 0.5, "#c96a54");
}

function drawWindow(rr: Renderer2D, cx: number, wallBaseZ: number, night: boolean): void {
  const ctx = rr.ctx;
  const w = 3.2;
  const topZ = wallBaseZ - 3.2;
  const x0 = rr.sx(cx - w / 2);
  const y0 = rr.sy(topZ);
  const ww = rr.sx(cx + w / 2) - x0;
  const wh = rr.sy(wallBaseZ - 0.6) - y0;
  // frame
  ctx.fillStyle = "#e8dcc0";
  ctx.fillRect(x0 - 2, y0 - 2, ww + 4, wh + 4);
  // panes
  ctx.fillStyle = night ? "#20304a" : "#bfe0f0";
  ctx.fillRect(x0, y0, ww, wh);
  if (night) {
    // moon glint + stars
    ctx.fillStyle = "#e8eeff";
    ctx.fillRect(x0 + Math.round(ww * 0.62), y0 + 3, 4, 4);
    ctx.fillStyle = "#9fb4d8";
    ctx.fillRect(x0 + 5, y0 + 6, 1, 1);
    ctx.fillRect(x0 + Math.round(ww * 0.3), y0 + 3, 1, 1);
  } else {
    // sky gradient + distant hill + sun glow
    ctx.fillStyle = "#dff0f8";
    ctx.fillRect(x0, y0, ww, Math.round(wh * 0.5));
    ctx.fillStyle = "#8fc86a";
    ctx.fillRect(x0, y0 + Math.round(wh * 0.66), ww, Math.round(wh * 0.34));
    ctx.fillStyle = "#fff1b0";
    ctx.fillRect(x0 + 3, y0 + 3, 5, 5);
  }
  // muntins
  ctx.fillStyle = "#c7b48c";
  ctx.fillRect(x0 + Math.round(ww / 2) - 1, y0, 2, wh);
  ctx.fillRect(x0, y0 + Math.round(wh / 2) - 1, ww, 2);
  // sill
  ctx.fillStyle = "#cdbf9e";
  ctx.fillRect(x0 - 3, y0 + wh + 2, ww + 6, 3);
}

function drawFireplace(rr: Renderer2D, cx: number, wallBaseZ: number, tSec: number, night: boolean): void {
  const ctx = rr.ctx;
  const w = 5.2;
  const x0 = rr.sx(cx - w / 2);
  const topY = rr.sy(wallBaseZ - 4.4);
  const baseY = rr.sy(wallBaseZ + 0.3);
  const ww = rr.sx(cx + w / 2) - x0;
  // stone surround
  ctx.fillStyle = "#8a8078";
  ctx.fillRect(x0, topY, ww, baseY - topY);
  // stone speckle
  const r = rng(31);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = r() < 0.5 ? "#726860" : "#a49a90";
    ctx.fillRect(x0 + Math.round(r() * ww), topY + Math.round(r() * (baseY - topY)), 2, 2);
  }
  // mantel
  ctx.fillStyle = "#6b4a2c";
  ctx.fillRect(x0 - 4, topY - 4, ww + 8, 5);
  ctx.fillStyle = "#835a37";
  ctx.fillRect(x0 - 4, topY - 4, ww + 8, 2);
  // hearth opening (dark)
  const hw = ww * 0.5;
  const hx = x0 + (ww - hw) / 2;
  const hTop = topY + Math.round((baseY - topY) * 0.32);
  ctx.fillStyle = "#14100c";
  ctx.fillRect(hx, hTop, hw, baseY - hTop - 2);
  // logs
  ctx.fillStyle = "#4a3320";
  ctx.fillRect(hx + 4, baseY - 8, hw - 8, 4);
  ctx.fillStyle = "#5f4228";
  ctx.fillRect(hx + 6, baseY - 10, hw - 14, 3);
  // ---- animated flame (2 flickering tongues) ----
  const fx = hx + hw / 2;
  const fBase = baseY - 6;
  for (let k = 0; k < 3; k++) {
    const flick = Math.sin(tSec * 9 + k * 2.1) * 2 + Math.sin(tSec * 17 + k) * 1.2;
    const fh = 9 + k * 3 + Math.sin(tSec * 7 + k * 3) * 3;
    const dx = (k - 1) * 4 + flick;
    ctx.fillStyle = ["#ffcf4a", "#ff8c2a", "#ffe27a"][k];
    ctx.beginPath();
    ctx.moveTo(fx + dx - 3, fBase);
    ctx.quadraticCurveTo(fx + dx - 2, fBase - fh * 0.6, fx + dx, fBase - fh);
    ctx.quadraticCurveTo(fx + dx + 2, fBase - fh * 0.6, fx + dx + 3, fBase);
    ctx.closePath();
    ctx.fill();
  }
  // ember glow core
  ctx.fillStyle = "#ff6a2a";
  ctx.fillRect(fx - 5, fBase - 2, 10, 3);
  // a couple of mantel trinkets (a candle + a framed picture)
  ctx.fillStyle = "#c9b071";
  ctx.fillRect(x0 + 4, topY - 9, 3, 5); // candle
  ctx.fillStyle = night ? "#ffd98a" : "#8a6a3a";
  ctx.fillRect(x0 + 4, topY - 11, 3, 2); // flame/wick
  ctx.fillStyle = "#5a4632";
  ctx.fillRect(x0 + ww - 12, topY - 10, 8, 6); // picture frame
  ctx.fillStyle = "#a4c8e0";
  ctx.fillRect(x0 + ww - 11, topY - 9, 6, 4);
}

function drawShelf(rr: Renderer2D, cx: number, cz: number): void {
  const ctx = rr.ctx;
  const x0 = rr.sx(cx - 0.7);
  const y0 = rr.sy(cz - 2.2);
  const w = rr.sx(cx + 0.7) - x0;
  const h = rr.sy(cz + 2.2) - y0;
  ctx.fillStyle = "#6b4a2c";
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = "#835a37";
  ctx.fillRect(x0, y0, 2, h);
  // 3 shelves of books
  const cols = ["#b3402f", "#3f7fd0", "#4a8a3f", "#e0b45a", "#8f6ae8"];
  for (let s = 0; s < 3; s++) {
    const sy = y0 + 4 + s * Math.round(h / 3);
    ctx.fillStyle = "#4a3320";
    ctx.fillRect(x0, sy + Math.round(h / 3) - 5, w, 2);
    for (let b = 0; b < 4; b++) {
      ctx.fillStyle = cols[(s * 4 + b) % cols.length];
      ctx.fillRect(x0 + 2 + b * Math.round((w - 4) / 4), sy, Math.max(2, Math.round((w - 6) / 4)), Math.round(h / 3) - 6);
    }
  }
}

function drawBed(rr: Renderer2D, cx: number, cz: number): void {
  const ctx = rr.ctx;
  const w = 4.8;
  const hgt = 6.4;
  const x0 = rr.sx(cx - w / 2);
  const y0 = rr.sy(cz - hgt / 2);
  const ww = rr.sx(cx + w / 2) - x0;
  const hh = rr.sy(cz + hgt / 2) - y0;
  // frame
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(x0 - 2, y0 - 2, ww + 4, hh + 4);
  // headboard (north/top)
  ctx.fillStyle = "#8a5f38";
  ctx.fillRect(x0 - 2, y0 - 5, ww + 4, 6);
  ctx.fillStyle = "#9c6f42";
  ctx.fillRect(x0 - 2, y0 - 5, ww + 4, 2);
  // mattress
  ctx.fillStyle = "#efe6d2";
  ctx.fillRect(x0, y0, ww, hh);
  // pillow (top)
  ctx.fillStyle = "#fbf6e6";
  ctx.fillRect(x0 + 3, y0 + 3, ww - 6, Math.round(hh * 0.24));
  ctx.fillStyle = "#e6dcc0";
  ctx.fillRect(x0 + 3, y0 + 3 + Math.round(hh * 0.24), ww - 6, 1);
  // quilt (bottom 2/3)
  const qy = y0 + Math.round(hh * 0.34);
  ctx.fillStyle = "#4a8ac4";
  ctx.fillRect(x0, qy, ww, hh - (qy - y0));
  ctx.fillStyle = "#3f76a8";
  for (let z = qy + 4; z < y0 + hh; z += 6) ctx.fillRect(x0, z, ww, 1);
  ctx.fillStyle = "#6fb0dc";
  for (let x = x0 + 4; x < x0 + ww; x += 8) ctx.fillRect(x, qy, 1, hh - (qy - y0));
  ctx.fillStyle = "#5a98c8";
  ctx.fillRect(x0, qy, ww, 2); // quilt fold highlight
}

function drawTable(rr: Renderer2D, cx: number, cz: number): void {
  const ctx = rr.ctx;
  // chairs first (behind the table)
  const chair = (chx: number, chz: number) => {
    ctx.fillStyle = "#7a5230";
    const x0 = rr.sx(chx - 0.7);
    const y0 = rr.sy(chz - 0.7);
    ctx.fillRect(x0, y0, rr.sx(chx + 0.7) - x0, rr.sy(chz + 0.7) - y0);
    ctx.fillStyle = "#96703f";
    ctx.fillRect(x0, y0, rr.sx(chx + 0.7) - x0, 2);
  };
  chair(cx - 3, cz);
  chair(cx + 3, cz);
  chair(cx, cz - 2.2);
  // table top
  const w = 4.4;
  const hgt = 3.0;
  const x0 = rr.sx(cx - w / 2);
  const y0 = rr.sy(cz - hgt / 2);
  const ww = rr.sx(cx + w / 2) - x0;
  const hh = rr.sy(cz + hgt / 2) - y0;
  ctx.fillStyle = "#5f3f24";
  ctx.fillRect(x0, y0 + 3, ww, hh); // side/leg shade
  ctx.fillStyle = "#9c6f42";
  ctx.fillRect(x0, y0, ww, hh - 2); // top
  ctx.fillStyle = "#b3844f";
  ctx.fillRect(x0, y0, ww, 2);
  // a bowl of fruit + a mug on the table
  ctx.fillStyle = "#c98a4a";
  ctx.beginPath();
  ctx.ellipse(rr.sx(cx - 0.6), rr.sy(cz), 8, 4, 0, 0, 7);
  ctx.fill();
  ctx.fillStyle = "#e2382c";
  ctx.fillRect(rr.sx(cx - 0.9), rr.sy(cz) - 4, 3, 3);
  ctx.fillStyle = "#e8823a";
  ctx.fillRect(rr.sx(cx - 0.3), rr.sy(cz) - 3, 3, 3);
  ctx.fillStyle = "#4a8ac4";
  ctx.fillRect(rr.sx(cx + 1.0), rr.sy(cz) - 4, 4, 5); // mug
}

function drawPlant(rr: Renderer2D, cx: number, cz: number): void {
  const ctx = rr.ctx;
  const bx = rr.sx(cx);
  const by = rr.sy(cz);
  // pot
  ctx.fillStyle = "#b3603a";
  ctx.fillRect(bx - 5, by - 4, 10, 8);
  ctx.fillStyle = "#c97a4c";
  ctx.fillRect(bx - 5, by - 4, 10, 2);
  // leaves
  const leaf = (dx: number, dy: number, rx: number, ry: number, c: string) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(bx + dx, by - 8 + dy, rx, ry, 0, 0, 7);
    ctx.fill();
  };
  leaf(0, -6, 7, 9, "#3f7c30");
  leaf(-5, -2, 4, 7, "#4f9a3f");
  leaf(5, -3, 4, 7, "#4f9a3f");
  leaf(-1, -12, 3.4, 6, "#6db55c");
}

function drawExitDoor(rr: Renderer2D, cx: number, wallZ: number): void {
  const ctx = rr.ctx;
  const w = 3.4;
  const x0 = rr.sx(cx - w / 2);
  const y0 = rr.sy(wallZ - 0.3);
  const ww = rr.sx(cx + w / 2) - x0;
  const hh = rr.sy(wallZ + 1.1) - y0;
  // door frame + panel (on the south wall)
  ctx.fillStyle = "#5a3c22";
  ctx.fillRect(x0 - 2, y0 - 2, ww + 4, hh + 4);
  ctx.fillStyle = "#7a5230";
  ctx.fillRect(x0, y0, ww, hh);
  ctx.fillStyle = "#96703f";
  ctx.fillRect(x0 + 3, y0 + 3, ww - 6, Math.round(hh / 2) - 4);
  ctx.fillRect(x0 + 3, y0 + Math.round(hh / 2) + 1, ww - 6, Math.round(hh / 2) - 4);
  ctx.fillStyle = "#e8c96a";
  ctx.fillRect(x0 + ww - 6, y0 + Math.round(hh / 2), 2, 3); // knob
  // doormat below the door
  const mx = rr.sx(cx - 1.6);
  const my = rr.sy(wallZ + 0.6);
  ctx.fillStyle = "#8a6a3a";
  ctx.fillRect(mx, my, rr.sx(cx + 1.6) - mx, 6);
  ctx.fillStyle = "#a4834c";
  ctx.fillRect(mx, my, rr.sx(cx + 1.6) - mx, 2);
}

/** Warm additive light from the fireplace + daytime window shafts on the floor. */
function drawLightPools(rr: Renderer2D, fireCx: number, wallBaseZ: number, night: boolean, tSec: number): void {
  const ctx = rr.ctx;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  // fireplace pool (flickers)
  const flick = 0.82 + Math.sin(tSec * 8) * 0.06 + Math.sin(tSec * 13) * 0.04;
  const fcx = rr.sx(fireCx);
  const fcy = rr.sy(wallBaseZ + 1.5);
  const fr = 11 * PPM;
  const g = ctx.createRadialGradient(fcx, fcy, 6, fcx, fcy, fr);
  g.addColorStop(0, `rgba(255,190,110,${0.34 * flick})`);
  g.addColorStop(1, "rgba(255,190,110,0)");
  ctx.fillStyle = g;
  ctx.fillRect(fcx - fr, fcy - fr, fr * 2, fr * 2);
  // daytime window shafts
  if (!night) {
    for (const wx of [-6, 6]) {
      const cxp = rr.sx(wx);
      const cyp = rr.sy(wallBaseZ + 2.4);
      const wr = 6 * PPM;
      const gw = ctx.createRadialGradient(cxp, cyp, 4, cxp, cyp, wr);
      gw.addColorStop(0, "rgba(210,235,255,0.22)");
      gw.addColorStop(1, "rgba(210,235,255,0)");
      ctx.fillStyle = gw;
      ctx.fillRect(cxp - wr, cyp - wr, wr * 2, wr * 2);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export const FARMHOUSE_INTERIOR: Interior = {
  id: "farmhouse",
  name: "Farmhouse",
  cols: 14,
  rows: 10,
  view: FH_VIEW,
  bounds: FH_BOUNDS,
  spawn: { x: 0, z: 5.8, facing: "up" }, // clear of the exit mat so you don't spawn on "Leave"
  exit: { x: 0, z: 8.2, r: 1.7 },
  colliders: [
    { x: -8.5, z: -4.4, hw: 2.6, hh: 3.4 }, // bed
    { x: 7, z: 1.4, hw: 2.4, hh: 1.9 }, // table + chairs
    { x: -11.2, z: 2, hw: 0.8, hh: 2.2 }, // shelf
    { x: 10.6, z: 6.2, hw: 0.8, hh: 0.8 }, // plant
  ],
  draw: drawFarmhouseRoom,
};

/** All interiors, keyed by id (adding one = a new entry + its draw fn). */
export const INTERIORS: Record<string, Interior> = {
  farmhouse: FARMHOUSE_INTERIOR,
};

/** Exterior doors. The farmhouse door is on the house's camera-facing (south)
 * wall — the player stands just south of the 8 m footprint to enter. */
export const FARMHOUSE_DOOR: ExteriorDoor = {
  interiorId: "farmhouse",
  x: 24,
  z: 24,
  reach: 2.8,
  faceTo: "up",
  label: "Enter the farmhouse",
  exitFacing: "down",
  mapX: 24,
  mapZ: 23,
};

export const EXTERIOR_DOORS: ExteriorDoor[] = [FARMHOUSE_DOOR];
