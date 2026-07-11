// ---------------------------------------------------------------------------
// Renderer2D — the Canvas2D pixel core that replaces the three.js render layer.
//
// NATIVE RESOLUTION: PPM = 8 px/metre (mockup-faithful density). The native
// buffer FILLS the viewport at an INTEGER display scale, so pixels stay crisp
// on every device — chosen over a fixed-16:9-letterbox because black bars waste
// a portrait phone (mobile is first-class). scale = round(viewportH / NATIVE_H)
// (NATIVE_H≈270-class reference; 480×270 on a 16:9 desktop at scale 4); the
// backing store = ceil(viewport / scale), so the buffer covers the window with
// at most a sub-scale symmetric crop (no wasted bars). image-rendering:pixelated
// + integer scale = pixel-perfect. Camera offset floors to whole pixels.
//
// DAY/NIGHT is a full-frame tint overlay driven by daynight.ts's sun elevation
// (warm at dusk/dawn, a CAPPED deep-blue at night so it stays readable — the
// user flagged the old 3D night as too dark).
// ---------------------------------------------------------------------------

import { PPM, MAP_PX, worldToMap } from "./coords";

const NATIVE_H_TARGET = 270; // reference native height (16:9 → ~480×270 desktop)

export class Renderer2D {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  scale = 1;
  nativeW = 480;
  nativeH = 270;

  // camera centre (world metres) + smoothed follow
  camX = 0;
  camZ = 0;
  private smoothX = 0;
  private smoothZ = 0;
  // integer top-left of the visible slice in MAP pixels
  camMapX = 0;
  camMapY = 0;
  // optional camera clamp (map px) — set for interior scenes; null = full valley
  private camClamp: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(parent: HTMLElement) {
    const cv = document.createElement("canvas");
    cv.id = "fl-canvas";
    cv.style.position = "absolute";
    cv.style.imageRendering = "pixelated";
    (cv.style as CSSStyleDeclaration & { imageRendering: string }).imageRendering = "pixelated";
    cv.style.transformOrigin = "top left";
    parent.appendChild(cv);
    this.canvas = cv;
    this.ctx = cv.getContext("2d", { alpha: false })!;
    this.resize();
  }

  /** Recompute the integer scale + native buffer for the current viewport. */
  resize(): void {
    const vw = window.innerWidth || 960;
    const vh = window.innerHeight || 540;
    this.scale = Math.max(1, Math.round(vh / NATIVE_H_TARGET));
    this.nativeW = Math.max(64, Math.ceil(vw / this.scale));
    this.nativeH = Math.max(64, Math.ceil(vh / this.scale));
    this.canvas.width = this.nativeW;
    this.canvas.height = this.nativeH;
    const cssW = this.nativeW * this.scale;
    const cssH = this.nativeH * this.scale;
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
    // centre the (fill) buffer so any sub-scale overflow crops symmetrically
    this.canvas.style.left = Math.round((vw - cssW) / 2) + "px";
    this.canvas.style.top = Math.round((vh - cssH) / 2) + "px";
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Snap the camera to a world point immediately (spawn / teleport). */
  snapCamera(x: number, z: number): void {
    this.smoothX = this.camX = x;
    this.smoothZ = this.camZ = z;
    this.recomputeSlice();
  }

  /** Follow a world target with a soft lerp, then clamp to world + integer-snap. */
  follow(x: number, z: number, dt: number): void {
    const k = Math.min(1, dt * 7);
    this.smoothX += (x - this.smoothX) * k;
    this.smoothZ += (z - this.smoothZ) * k;
    this.camX = this.smoothX;
    this.camZ = this.smoothZ;
    this.recomputeSlice();
  }

  /** Clamp the camera to a world rect (interior scenes centre a small room, or
   * scroll a big one) — or null to restore the full-valley clamp. */
  setCamClamp(rect: { minX: number; maxX: number; minZ: number; maxZ: number } | null): void {
    this.camClamp = rect
      ? { x0: worldToMap(rect.minX), y0: worldToMap(rect.minZ), x1: worldToMap(rect.maxX), y1: worldToMap(rect.maxZ) }
      : null;
    this.recomputeSlice();
  }

  private recomputeSlice(): void {
    // desired top-left in map px, clamped so we never show past the baked map
    let mx = worldToMap(this.camX) - this.nativeW / 2;
    let my = worldToMap(this.camZ) - this.nativeH / 2;
    const c = this.camClamp;
    if (c) {
      const w = c.x1 - c.x0;
      const h = c.y1 - c.y0;
      mx = this.nativeW >= w ? c.x0 + (w - this.nativeW) / 2 : Math.max(c.x0, Math.min(c.x1 - this.nativeW, mx));
      my = this.nativeH >= h ? c.y0 + (h - this.nativeH) / 2 : Math.max(c.y0, Math.min(c.y1 - this.nativeH, my));
    } else {
      mx = this.nativeW >= MAP_PX ? (MAP_PX - this.nativeW) / 2 : Math.max(0, Math.min(MAP_PX - this.nativeW, mx));
      my = this.nativeH >= MAP_PX ? (MAP_PX - this.nativeH) / 2 : Math.max(0, Math.min(MAP_PX - this.nativeH, my));
    }
    this.camMapX = Math.floor(mx);
    this.camMapY = Math.floor(my);
  }

  /** World (x,z) → integer native-screen pixel. */
  sx(x: number): number {
    return Math.round(worldToMap(x) - this.camMapX);
  }
  sy(z: number): number {
    return Math.round(worldToMap(z) - this.camMapY);
  }

  /** Window client px → world metres (for click-to-act). Inverts the CSS
   * offset + integer scale + camera slice. */
  clientToWorld(clientX: number, clientY: number): { x: number; z: number } {
    const left = parseFloat(this.canvas.style.left || "0");
    const top = parseFloat(this.canvas.style.top || "0");
    const nx = (clientX - left) / this.scale;
    const ny = (clientY - top) / this.scale;
    return {
      x: (nx + this.camMapX) / PPM - 60,
      z: (ny + this.camMapY) / PPM - 60,
    };
  }

  /** Visible world rectangle (for culling), in metres. */
  viewBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    return {
      minX: this.camMapX / PPM - 60,
      maxX: (this.camMapX + this.nativeW) / PPM - 60,
      minZ: this.camMapY / PPM - 60,
      maxZ: (this.camMapY + this.nativeH) / PPM - 60,
    };
  }

  clear(): void {
    this.ctx.fillStyle = "#8fc0e8";
    this.ctx.fillRect(0, 0, this.nativeW, this.nativeH);
  }

  /** Blit the visible slice of the pre-baked static map canvas. */
  blitMap(map: HTMLCanvasElement): void {
    this.ctx.drawImage(
      map,
      this.camMapX,
      this.camMapY,
      this.nativeW,
      this.nativeH,
      0,
      0,
      this.nativeW,
      this.nativeH
    );
  }

  /** Draw a baked sprite at a world position (anchor = its ground point). */
  drawSprite(
    sprite: { canvas: HTMLCanvasElement; ax: number; ay: number },
    worldX: number,
    worldZ: number,
    dy = 0,
    alpha = 1
  ): void {
    const dx = this.sx(worldX) - sprite.ax;
    const dyy = this.sy(worldZ) - sprite.ay + dy;
    if (alpha < 1) {
      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      this.ctx.drawImage(sprite.canvas, Math.round(dx), Math.round(dyy));
      this.ctx.restore();
    } else {
      this.ctx.drawImage(sprite.canvas, Math.round(dx), Math.round(dyy));
    }
  }

  /** Full-frame day/night tint from the sun's elevation (deg). */
  applyDayNight(sunElevDeg: number): void {
    const t = nightTint(sunElevDeg);
    if (t.a <= 0.001) return;
    this.ctx.save();
    this.ctx.globalAlpha = t.a;
    this.ctx.fillStyle = `rgb(${t.r},${t.g},${t.b})`;
    this.ctx.fillRect(0, 0, this.nativeW, this.nativeH);
    this.ctx.restore();
  }
}

interface Tint {
  r: number;
  g: number;
  b: number;
  a: number;
}
const TINT_KEYS: { e: number; t: Tint }[] = [
  { e: 8, t: { r: 0, g: 0, b: 0, a: 0 } },
  { e: 2, t: { r: 255, g: 150, b: 70, a: 0.1 } },
  { e: -2, t: { r: 240, g: 120, b: 60, a: 0.2 } }, // dusk/dawn glow
  { e: -8, t: { r: 60, g: 66, b: 118, a: 0.34 } },
  { e: -16, t: { r: 26, g: 36, b: 78, a: 0.44 } }, // deep night — CAPPED (readable)
];

/** PURE. Interpolated tint colour+alpha for a sun elevation (deg). Capped dark
 * so night stays readable (the flagged too-dark-3D-night lesson). */
export function nightTint(elev: number): Tint {
  if (elev >= TINT_KEYS[0].e) return TINT_KEYS[0].t;
  if (elev <= TINT_KEYS[TINT_KEYS.length - 1].e) return TINT_KEYS[TINT_KEYS.length - 1].t;
  for (let i = 0; i < TINT_KEYS.length - 1; i++) {
    const a = TINT_KEYS[i];
    const b = TINT_KEYS[i + 1];
    if (elev <= a.e && elev >= b.e) {
      const k = (a.e - elev) / (a.e - b.e);
      return {
        r: Math.round(a.t.r + (b.t.r - a.t.r) * k),
        g: Math.round(a.t.g + (b.t.g - a.t.g) * k),
        b: Math.round(a.t.b + (b.t.b - a.t.b) * k),
        a: a.t.a + (b.t.a - a.t.a) * k,
      };
    }
  }
  return TINT_KEYS[0].t;
}
