// ---------------------------------------------------------------------------
// farmer2d — the puppet farmer (mockup's 28 px "Sunny"). Drawn per frame from
// PARTS (hat · hair/pigtails · head/face · torso · two arms · two legs) that are
// tweened in code — the Dead-Cells puppet technique, no frame sheets:
//   walk = leg swap + 1 px body bob + opposite arm swing
//   idle = subtle breathe
//   run  = faster cadence + slight forward lean
//   hop  = whole sprite lifts, the shadow ellipse shrinks (top-down hop trick)
// Facings: down / up / side (side flips for left↔right). Feet anchor = the world
// ground point.
//
// R2 — TOOLS + ACTIONS: the farmer HOLDS the equipped tool (hoe/can/seeds pouch;
// bare for hands), drawn per facing at the forward-hand anchor. Firing an action
// (playAction) runs a short part-tween as an OVERLAY in un-flipped space so the
// motion + FX read the same on every facing:
//   hoe   chop = raise + swing the blade down (dirt fleck comes from main)
//   water      = tilt the can + droplet pixels arcing onto the tile
//   plant      = kneel dip + seed specks scattering
//   harvest    = scoop, then the HOLD-UP beat — the harvested crop sprite raised
//                overhead (the signature moment)
//   refill     = dip the can toward the pond + a splash
//
// ANCHOR / PART CONTRACT (R3 cosmetics + remote tints hang off this): every part
// is positioned relative to the feet anchor (sx, sy). The `ovr`/`ovrd`/`ovrl`
// overall colours are the tint seam (remote farmers pass a shirt colour); the
// hat/hair sit at fixed offsets above the head so a future hat/hair cosmetic is
// a drop-in part at the same anchor. Keep these offsets stable.
// ---------------------------------------------------------------------------

import { K } from "./palette";
import type { ToolId } from "../farm/action";
import type { Sprite } from "./sprites";

export type Facing = "down" | "up" | "left" | "right";
export type ActionKind = "hoe" | "water" | "plant" | "harvest" | "refill";

export interface FarmerLook {
  ovr: string;
  ovrd: string;
  ovrl: string;
}
export const DEFAULT_LOOK: FarmerLook = { ovr: K.ovr, ovrd: K.ovrd, ovrl: K.ovrl };

const ACTION_DUR: Record<ActionKind, number> = { hoe: 0.36, water: 0.52, plant: 0.36, harvest: 0.62, refill: 0.52 };

/** Build an overalls tint triplet from a base shirt hex (remote farmers). */
export function lookFromColor(hex: string): FarmerLook {
  const { r, g, b } = hexRgb(hex);
  return {
    ovr: hex,
    ovrd: rgbHex(r * 0.74, g * 0.74, b * 0.74),
    ovrl: rgbHex(Math.min(255, r * 1.2 + 20), Math.min(255, g * 1.2 + 20), Math.min(255, b * 1.2 + 20)),
  };
}

export class Farmer2D {
  private phase = 0;
  private breathe = 0;
  private action: ActionKind | null = null;
  private actT = 0;
  private cropSprite: Sprite | null = null;

  /** Fire a tool-use animation. `cropSprite` (harvest) is raised overhead. */
  playAction(kind: ActionKind, cropSprite?: Sprite | null): void {
    this.action = kind;
    this.actT = 0;
    this.cropSprite = cropSprite ?? null;
  }
  isActing(): boolean {
    return this.action !== null;
  }

  /** Advance the gait clock. speedFrac = ground speed / max speed (0..1). */
  update(dt: number, speedFrac: number): void {
    this.phase += dt * (6 + speedFrac * 11);
    this.breathe += dt * 2.1;
    if (this.action) {
      this.actT += dt;
      if (this.actT >= ACTION_DUR[this.action]) {
        this.action = null;
        this.cropSprite = null;
      }
    }
  }

  /**
   * Draw the farmer at feet-anchor (sx, sy) in native pixels.
   * liftPx raises the whole sprite (hop); shadowScale shrinks its shadow.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    facing: Facing,
    moving: boolean,
    run: boolean,
    liftPx: number,
    shadowScale: number,
    look: FarmerLook = DEFAULT_LOOK,
    tool: ToolId = "hands"
  ): void {
    sx = Math.round(sx);
    sy = Math.round(sy);
    // shadow first (on the ground, unaffected by lift)
    ctx.fillStyle = "rgba(30,45,25,0.34)";
    ctx.beginPath();
    ctx.ellipse(sx, sy + 1, 8 * shadowScale, 2.4 * shadowScale, 0, 0, 7);
    ctx.fill();

    // action pose progress
    const act = this.action;
    const p = act ? Math.min(1, this.actT / ACTION_DUR[act]) : 0;
    const kneel = act === "plant" ? Math.round(Math.sin(p * Math.PI) * 2) : act === "refill" ? Math.round(Math.sin(p * Math.PI) * 1.5) : 0;

    const bob = moving
      ? Math.round(Math.abs(Math.sin(this.phase)) * (run ? 2 : 1.4))
      : Math.round((Math.sin(this.breathe) * 0.5 + 0.5) * 0.6);
    const lean = run ? 1 : 0;
    const step = moving ? Math.round(Math.sin(this.phase) * (run ? 3 : 2)) : 0;
    const y = sy - liftPx + kneel; // feet baseline after hop lift + action kneel

    if (facing === "left" || facing === "right") {
      ctx.save();
      if (facing === "left") {
        ctx.translate(sx * 2, 0);
        ctx.scale(-1, 1);
      }
      this.drawSide(ctx, sx, y, bob, step, lean, look);
      ctx.restore();
    } else if (facing === "up") {
      this.drawUp(ctx, sx, y, bob, step, look);
    } else {
      this.drawDown(ctx, sx, y, bob, step, look);
    }

    // held tool + action FX overlay (un-flipped space; dir chooses the side)
    const dir = facing === "left" ? -1 : facing === "up" ? -1 : 1;
    this.drawToolAndFx(ctx, sx, y, facing, dir, tool, act, p, bob);
  }

  // ---- held tool + action FX -------------------------------------------------
  private drawToolAndFx(
    ctx: CanvasRenderingContext2D,
    sx: number,
    y: number,
    facing: Facing,
    dir: number,
    tool: ToolId,
    act: ActionKind | null,
    p: number,
    bob: number
  ): void {
    // forward-hand anchor
    let hx = sx + dir * (facing === "down" ? 7 : facing === "up" ? 6 : 7);
    let hy = y - (facing === "up" ? 11 : 10) - bob;

    // action-driven hand motion
    let toolAngle = dir > 0 ? 0.5 : Math.PI - 0.5; // resting downward-forward
    if (act === "hoe") {
      // raise (p<0.45) then chop down (p>=0.45)
      const swing = p < 0.45 ? -1.1 * (p / 0.45) : -1.1 + 1.9 * ((p - 0.45) / 0.55);
      toolAngle = (dir > 0 ? 0.4 : Math.PI - 0.4) + dir * swing;
      hy -= p < 0.45 ? 3 * (p / 0.45) : 3 * (1 - (p - 0.45) / 0.55);
    } else if (act === "water") {
      toolAngle = (dir > 0 ? 0.9 : Math.PI - 0.9); // tipped to pour
      hx += dir * 2;
    } else if (act === "refill") {
      hy += Math.round(Math.sin(p * Math.PI) * 3); // dip toward the pond
    } else if (act === "harvest") {
      hy -= p < 0.4 ? -1 : Math.round(Math.sin(((p - 0.4) / 0.6) * Math.PI) * 3); // scoop then lift
    }

    // draw the tool (hands = nothing to hold)
    if (tool === "hoe") this.drawHoe(ctx, hx, hy, dir, toolAngle);
    else if (tool === "can") this.drawCan(ctx, hx, hy, dir, act === "water" || act === "refill");
    else if (tool === "seeds") this.drawPouch(ctx, hx, hy, dir);

    // action FX
    if (act === "water") this.drawDroplets(ctx, sx + dir * 12, y - 2, dir, p);
    else if (act === "refill") this.drawSplash(ctx, sx + dir * 12, y - 1, p);
    else if (act === "plant") this.drawSeedSpecks(ctx, sx + dir * 9, y - 2, dir, p);
    else if (act === "harvest" && p >= 0.4 && this.cropSprite) {
      // HOLD-UP beat — the harvested crop raised overhead (the signature moment)
      const rise = Math.sin(((p - 0.4) / 0.6) * Math.PI) * 10;
      const s = this.cropSprite;
      ctx.drawImage(s.canvas, Math.round(sx - s.ax), Math.round(y - 34 - rise - s.ay + s.canvas.height));
      // little sparkles
      ctx.fillStyle = "rgba(255,240,150,0.9)";
      for (const a of [0.4, 1.8, 3.2]) {
        const rr = 8 + Math.sin(p * 6 + a) * 2;
        ctx.fillRect(Math.round(sx + Math.cos(a) * rr), Math.round(y - 32 - rise + Math.sin(a) * rr * 0.6), 1, 1);
      }
    }
  }

  private drawHoe(ctx: CanvasRenderingContext2D, hx: number, hy: number, _dir: number, angle: number): void {
    const len = 9;
    const ex = hx + Math.cos(angle) * len;
    const ey = hy + Math.sin(angle) * len;
    ctx.strokeStyle = "#8a5a2b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // flat blade perpendicular at the far end
    const bx = Math.cos(angle + Math.PI / 2) * 3;
    const by = Math.sin(angle + Math.PI / 2) * 3;
    ctx.strokeStyle = "#c8ccd4";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ex - bx * 0.3, ey - by * 0.3);
    ctx.lineTo(ex + bx, ey + by);
    ctx.stroke();
  }

  private drawCan(ctx: CanvasRenderingContext2D, hx: number, hy: number, dir: number, pouring: boolean): void {
    const tilt = pouring ? dir * 2 : 0;
    // body
    rect(ctx, hx - 2 + tilt, hy - 3, 5, 6, "#5aa0a8");
    rect(ctx, hx - 2 + tilt, hy - 3, 5, 2, "#7cc0c8");
    rect(ctx, hx - 2 + tilt, hy + 2, 5, 1, "#3f7c84");
    // spout forward + rose
    ctx.strokeStyle = "#5aa0a8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hx + 2 + tilt, hy - 1);
    ctx.lineTo(hx + dir * 5 + tilt, hy - (pouring ? 1 : 3));
    ctx.stroke();
    px(ctx, hx + dir * 5 + tilt, hy - (pouring ? 1 : 3), "#7cc0c8");
    // handle
    rect(ctx, hx - 1 + tilt, hy - 5, 2, 2, "#3f7c84");
  }

  private drawPouch(ctx: CanvasRenderingContext2D, hx: number, hy: number, dir: number): void {
    rect(ctx, hx - 2, hy - 2, 5, 6, "#9c6b3a");
    rect(ctx, hx - 2, hy - 2, 5, 2, "#b8894e");
    rect(ctx, hx - 2, hy - 3, 5, 1, "#6b4a26"); // cinched neck
    px(ctx, hx + dir, hy, "#e0c65a"); // seed peeking
    px(ctx, hx, hy + 2, "#f2d24a");
  }

  private drawDroplets(ctx: CanvasRenderingContext2D, ox: number, oy: number, dir: number, p: number): void {
    ctx.fillStyle = "#7cc0e8";
    for (let i = 0; i < 5; i++) {
      const t = (p * 1.6 + i * 0.2) % 1;
      const dx = dir * t * 8;
      const dy = 6 + t * t * 14 - 3;
      ctx.fillRect(Math.round(ox + dx), Math.round(oy + dy), 1, 2);
    }
  }
  private drawSplash(ctx: CanvasRenderingContext2D, ox: number, oy: number, p: number): void {
    ctx.fillStyle = "#9cd0ec";
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rr = Math.sin(p * Math.PI) * 6;
      ctx.fillRect(Math.round(ox + Math.cos(a) * rr), Math.round(oy - Math.abs(Math.sin(a)) * rr * 0.8), 1, 1);
    }
  }
  private drawSeedSpecks(ctx: CanvasRenderingContext2D, ox: number, oy: number, dir: number, p: number): void {
    ctx.fillStyle = "#e0c65a";
    for (let i = 0; i < 4; i++) {
      const t = (p * 1.4 + i * 0.25) % 1;
      ctx.fillRect(Math.round(ox + dir * t * 4), Math.round(oy + t * 10), 1, 1);
    }
  }

  // ---- FRONT (down) — the mockup farmer -------------------------------------
  private drawDown(ctx: CanvasRenderingContext2D, x: number, y: number, bob: number, step: number, look: FarmerLook): void {
    const r = (bx: number, by: number, w: number, h: number, c: string) => rect(ctx, x + bx, y + by, w, h, c);
    // legs + shoes (swing)
    r(-4, -6 - Math.max(0, step), 3, 5 + Math.max(0, step), look.ovrd);
    r(1, -6 - Math.max(0, -step), 3, 5 + Math.max(0, -step), look.ovr);
    r(-5, -1 - Math.max(0, step), 4, 2, K.shoe);
    r(1, -1 - Math.max(0, -step), 4, 2, K.shoe);
    // body: overalls + shirt (bob)
    const by = -bob;
    r(-6, -15 + by, 12, 9, look.ovr);
    r(-6, -15 + by, 3, 9, look.ovrd);
    r(5, -14 + by, 1, 2, look.ovrl);
    r(-6, -17 + by, 12, 3, K.shirt);
    r(-6, -17 + by, 3, 3, K.shirtd);
    r(-4, -16 + by, 2, 4, look.ovr); // straps
    r(2, -16 + by, 2, 4, look.ovr);
    r(-3, -15 + by, 1, 1, look.ovrl); // buttons
    r(3, -15 + by, 1, 1, look.ovrl);
    r(-2, -12 + by, 4, 4, look.ovrd); // pocket
    r(-2, -12 + by, 4, 1, look.ovrl);
    // arms + hands (swing opposite legs)
    r(-8, -16 + by + Math.max(0, -step), 2, 6, K.shirt);
    r(6, -16 + by + Math.max(0, step), 2, 6, K.shirtd);
    r(-8, -10 + by + Math.max(0, -step), 2, 3, K.skin);
    r(6, -10 + by + Math.max(0, step), 2, 3, K.skind);
    // head
    r(-5, -26 + by, 10, 9, K.skin);
    r(-5, -26 + by, 2, 9, K.skind);
    // hair + pigtails
    r(-5, -27 + by, 10, 3, K.hair);
    r(-5, -27 + by, 10, 1, K.hairl);
    r(-7, -25 + by, 2, 6, K.hair);
    r(5, -25 + by, 2, 6, K.hair);
    r(-7, -19 + by, 1, 1, K.haird);
    r(6, -19 + by, 1, 1, K.haird);
    // face
    r(-3, -22 + by, 1, 1, K.outline);
    r(2, -22 + by, 1, 1, K.outline);
    r(-4, -20 + by, 1, 1, K.blush);
    r(3, -20 + by, 1, 1, K.blush);
    r(-1, -19 + by, 2, 1, K.haird); // smile
    // straw hat
    r(-8, -29 + by, 16, 2, K.hat);
    r(-8, -28 + by, 16, 1, K.hatd);
    r(-5, -32 + by, 10, 3, K.hat);
    r(-5, -32 + by, 10, 1, K.hatl);
    r(-5, -30 + by, 10, 1, K.band);
  }

  // ---- BACK (up) — no face; hair + hat from behind --------------------------
  private drawUp(ctx: CanvasRenderingContext2D, x: number, y: number, bob: number, step: number, look: FarmerLook): void {
    const r = (bx: number, by: number, w: number, h: number, c: string) => rect(ctx, x + bx, y + by, w, h, c);
    r(-4, -6 - Math.max(0, step), 3, 5 + Math.max(0, step), look.ovrd);
    r(1, -6 - Math.max(0, -step), 3, 5 + Math.max(0, -step), look.ovr);
    r(-5, -1 - Math.max(0, step), 4, 2, K.shoe);
    r(1, -1 - Math.max(0, -step), 4, 2, K.shoe);
    const by = -bob;
    r(-6, -15 + by, 12, 9, look.ovr);
    r(-6, -15 + by, 12, 2, look.ovrd);
    r(-6, -17 + by, 12, 3, K.shirt);
    r(-4, -15 + by, 2, 9, look.ovrd); // back straps
    r(2, -15 + by, 2, 9, look.ovrd);
    r(-8, -16 + by + Math.max(0, -step), 2, 6, K.shirtd);
    r(6, -16 + by + Math.max(0, step), 2, 6, K.shirtd);
    r(-8, -10 + by + Math.max(0, -step), 2, 3, K.skind);
    r(6, -10 + by + Math.max(0, step), 2, 3, K.skind);
    r(-5, -26 + by, 10, 9, K.hair); // back of head = hair
    r(-5, -26 + by, 10, 1, K.hairl);
    r(-7, -25 + by, 2, 7, K.hair); // pigtails
    r(5, -25 + by, 2, 7, K.hair);
    r(-8, -29 + by, 16, 2, K.hat);
    r(-8, -28 + by, 16, 1, K.hatd);
    r(-5, -32 + by, 10, 3, K.hat);
    r(-5, -30 + by, 10, 1, K.band);
  }

  // ---- SIDE (right; caller flips for left) ----------------------------------
  private drawSide(ctx: CanvasRenderingContext2D, x: number, y: number, bob: number, step: number, lean: number, look: FarmerLook): void {
    const r = (bx: number, by: number, w: number, h: number, c: string) => rect(ctx, x + bx + lean, y + by, w, h, c);
    // far leg (back), near leg (front) — swing
    r(-2, -6 - Math.max(0, -step), 3, 6 + Math.max(0, -step), look.ovrd);
    r(-1, -6 - Math.max(0, step), 3, 6 + Math.max(0, step), look.ovr);
    r(-2, -1 - Math.max(0, -step), 5, 2, K.shoed);
    r(-1, -1 - Math.max(0, step), 5, 2, K.shoe);
    const by = -bob;
    // torso (narrower profile)
    r(-3, -15 + by, 7, 9, look.ovr);
    r(-3, -15 + by, 2, 9, look.ovrd);
    r(-3, -17 + by, 7, 3, K.shirt);
    r(-1, -12 + by, 3, 4, look.ovrd); // pocket
    // near arm swinging
    r(0, -15 + by + Math.max(0, step), 2, 6, K.shirt);
    r(0, -9 + by + Math.max(0, step), 2, 3, K.skin);
    // head (profile)
    r(-3, -26 + by, 9, 9, K.skin);
    r(-3, -26 + by, 2, 9, K.skind);
    r(4, -22 + by, 1, 1, K.outline); // eye toward facing
    r(4, -20 + by, 2, 1, K.skind); // nose
    // hair + trailing pigtail
    r(-3, -27 + by, 9, 3, K.hair);
    r(-5, -25 + by, 3, 7, K.hair);
    // hat, brim toward facing
    r(-5, -29 + by, 13, 2, K.hat);
    r(-5, -28 + by, 13, 1, K.hatd);
    r(-3, -32 + by, 8, 3, K.hat);
    r(-3, -30 + by, 8, 1, K.band);
  }
}

/** Facing from a movement heading (rad, atan2(dx,dz) convention) — down = +Z. */
export function facingFromHeading(heading: number, moving: boolean, prev: Facing): Facing {
  if (!moving) return prev;
  const dx = Math.sin(heading);
  const dz = Math.cos(heading);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? "right" : "left";
  return dz > 0 ? "down" : "up";
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
function px(ctx: CanvasRenderingContext2D, x: number, y: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}
function hexRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
