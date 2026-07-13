// ---------------------------------------------------------------------------
// Field2D — the FREE-FORM farming visuals (R5). The 12×12 grid is gone:
//   · TILLED PATCHES render as organic dithered soil BLOBS. Every patch is a
//     pre-baked soil-disc STAMP drawn into an offscreen MAP-resolution canvas;
//     overlapping stamps UNION into one blob (the runtime analog of world2d's
//     bake-time terrainCoverage dither — patches are dynamic so they can't ride
//     the static map). The layer is re-baked only when patches change (a version
//     counter), then blitted like the static map each frame.
//   · PLANTS render from FarmState.plants — each a crop sprite at its continuous
//     world point, y-sorted so the player can stand in front. Ready = gold pulse.
//   · A recently-watered plant gets a damp darkened ring drawn under it.
//   · The target HIGHLIGHT is now a small pulsing GROUND MARKER at a point (the
//     aimed spot), valid (verb colour) or invalid (red "too close" ghost).
// Keeps spawnPop / spawnBurst / animate / drawEffects so main's juice wiring is
// unchanged.
// ---------------------------------------------------------------------------

import { CROPS, growthStage, effectiveCrop } from "../farm/growth";
import { growthTileOf, patchCoverageAt, type Plant, type TilledPatch, PATCH_MAX_R } from "../farm/plots";
import { Sprites } from "./sprites";
import { SOIL } from "./palette";
import { PPM, MAP_PX } from "./coords";
import type { Renderer2D } from "./renderer";

interface Pop {
  x: number;
  z: number;
  emoji: string;
  born: number;
  life: number;
}
interface Burst {
  x: number;
  z: number;
  vx: number;
  vz: number;
  vy: number;
  y: number;
  color: string;
  born: number;
  life: number;
}
interface CropItem {
  x: number;
  z: number;
  sprite: ReturnType<typeof Sprites.crop>;
  ready: boolean;
}

// ---- soil-disc stamp (dithered edge, mottled interior) ----------------------
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
function phash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const SOIL_COLS = [toRgb(SOIL.base), toRgb(SOIL.dk), toRgb(SOIL.lt), toRgb(SOIL.ridge)];
const STAMP_PX = Math.ceil(PATCH_MAX_R * 2 * PPM) + 4; // reference stamp side (px)

let soilStamp: HTMLCanvasElement | null = null;
function buildSoilStamp(): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = STAMP_PX;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(STAMP_PX, STAMP_PX);
  const d = img.data;
  const c = STAMP_PX / 2;
  const R = STAMP_PX / 2 - 1.5;
  for (let py = 0; py < STAMP_PX; py++) {
    for (let px = 0; px < STAMP_PX; px++) {
      const dist = Math.hypot(px - c + 0.5, py - c + 0.5);
      if (dist > R) continue;
      const frac = dist / R; // 0 core .. 1 edge
      const cov = frac < 0.78 ? 1 : 1 - (frac - 0.78) / 0.22; // dither the outer 22%
      const th = (BAYER4[py & 3][px & 3] + 0.5) / 16;
      if (cov < th) continue; // dithered-out → transparent (organic edge)
      const hh = phash(px, py);
      const col = hh < 0.5 ? SOIL_COLS[0] : hh < 0.72 ? SOIL_COLS[1] : hh < 0.9 ? SOIL_COLS[3] : SOIL_COLS[2];
      const i = (py * STAMP_PX + px) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export class Field2D {
  private marker: { x: number; z: number; color: string; valid: boolean } | null = null;
  private pops: Pop[] = [];
  private bursts: Burst[] = [];
  private tSec = 0;

  // offscreen patch (tilled soil) layer, re-baked only when patches change
  private patchCanvas: HTMLCanvasElement | null = null;
  private bakedVersion = -1;

  // no-op sync hooks kept so any legacy wiring is untouched -------------------
  syncTile(): void {}
  syncAll(): void {}
  tick(): void {}

  /** Set the small ground marker at the aimed point (null = hide). `valid=false`
   * renders it red (the "too close to plant" ghost). */
  setGroundMarker(x: number | null, z: number | null, color: number, valid = true): void {
    if (x == null || z == null) {
      this.marker = null;
      return;
    }
    this.marker = { x, z, color: "#" + (color >>> 0).toString(16).padStart(6, "0").slice(-6), valid };
  }

  spawnPop(x: number, _y: number, z: number, emoji: string): void {
    this.pops.push({ x, z, emoji, born: performance.now(), life: 750 });
  }

  spawnBurst(x: number, _y: number, z: number, color: number, count = 8, up = 1): void {
    const c = "#" + (color >>> 0).toString(16).padStart(6, "0").slice(-6);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 0.4 + Math.random() * 0.7;
      this.bursts.push({ x, z, vx: Math.cos(a) * spd, vz: Math.sin(a) * spd, vy: (1.2 + Math.random() * 1.2) * up, y: 0.4, color: c, born: performance.now(), life: 550 + Math.random() * 250 });
    }
  }

  animate(tSec: number): void {
    this.tSec = tSec;
  }

  // ---- tilled-soil blob layer -----------------------------------------------
  private rebakePatches(patches: Record<string, TilledPatch>): void {
    if (!soilStamp) soilStamp = buildSoilStamp();
    if (!this.patchCanvas) {
      this.patchCanvas = document.createElement("canvas");
      this.patchCanvas.width = this.patchCanvas.height = MAP_PX;
    }
    const ctx = this.patchCanvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, MAP_PX, MAP_PX);
    for (const p of Object.values(patches)) {
      const rpx = p.r * PPM;
      const cx = (p.x + 60) * PPM;
      const cy = (p.z + 60) * PPM;
      ctx.drawImage(soilStamp, Math.round(cx - rpx), Math.round(cy - rpx), Math.round(rpx * 2), Math.round(rpx * 2));
    }
  }

  /** Blit the tilled-soil blob layer (re-bake only when `version` changed). */
  drawPatches(rr: Renderer2D, patches: Record<string, TilledPatch>, version: number): void {
    if (version !== this.bakedVersion) {
      this.rebakePatches(patches);
      this.bakedVersion = version;
    }
    if (!this.patchCanvas) return;
    rr.ctx.drawImage(this.patchCanvas, rr.camMapX, rr.camMapY, rr.nativeW, rr.nativeH, 0, 0, rr.nativeW, rr.nativeH);
  }

  /** Damp darkened ring under each recently-watered plant (drawn over the soil,
   * under the crop sprites). */
  drawDamp(rr: Renderer2D, plants: Record<string, Plant>, now: number): void {
    const ctx = rr.ctx;
    ctx.save();
    for (const p of Object.values(plants)) {
      const crop = effectiveCrop(CROPS[p.crop]);
      if (now - p.lastWatered >= crop.waterEveryMs * 0.4) continue;
      const cx = rr.sx(p.x);
      const cy = rr.sy(p.z);
      const seed = (p.x * 31 + p.z * 17) & 15;
      const a = 0.26 + 0.05 * Math.sin(this.tSec * 3 + seed);
      ctx.fillStyle = `rgba(50,34,20,${a})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 6, 3.4, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = `rgba(150,190,225,${0.12 + 0.05 * Math.sin(this.tSec * 3 + seed)})`;
      ctx.fillRect(cx - 2, cy - 1, 1, 1);
      ctx.fillRect(cx + 1, cy, 1, 1);
    }
    ctx.restore();
  }

  /** Crop sprites for the y-sorted pass, straight from FarmState.plants. */
  plantItems(plants: Record<string, Plant>, now: number): CropItem[] {
    const out: CropItem[] = [];
    for (const p of Object.values(plants)) {
      const stage = growthStage(growthTileOf(p), effectiveCrop(CROPS[p.crop]), now);
      const vis: 0 | 1 | 2 | 3 = stage === "ready" ? 3 : stage;
      out.push({ x: p.x, z: p.z, sprite: Sprites.crop(p.crop, vis), ready: stage === "ready" });
    }
    return out;
  }

  /** Small pulsing ground marker at the aimed point (replaces the tile rect). */
  drawGroundMarker(rr: Renderer2D): void {
    if (!this.marker) return;
    const ctx = rr.ctx;
    const cx = rr.sx(this.marker.x);
    const cy = rr.sy(this.marker.z);
    const pulse = 0.5 + 0.5 * Math.sin(this.tSec * 5);
    ctx.save();
    // soft filled disc
    ctx.globalAlpha = 0.18 + pulse * 0.12;
    ctx.fillStyle = this.marker.color;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 6, 3.2, 0, 0, 7);
    ctx.fill();
    // ring
    ctx.globalAlpha = 0.6 + pulse * 0.3;
    ctx.strokeStyle = this.marker.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx + 0.5, cy + 0.5, 6, 3.2, 0, 0, 7);
    ctx.stroke();
    if (!this.marker.valid) {
      // a little ✕ for the invalid (too-close) ghost
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy - 2);
      ctx.lineTo(cx + 3, cy + 2);
      ctx.moveTo(cx + 3, cy - 2);
      ctx.lineTo(cx - 3, cy + 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Ready-crop sparkle + pops + bursts, drawn above the props. */
  drawEffects(rr: Renderer2D, readyItems: CropItem[]): void {
    const ctx = rr.ctx;
    const now = performance.now();
    for (const it of readyItems) {
      if (!it.ready) continue;
      const cx = rr.sx(it.x);
      const baseY = rr.sy(it.z);
      const topY = baseY - it.sprite.canvas.height + it.sprite.ay;
      const pulse = 0.5 + 0.5 * Math.sin(this.tSec * 3.5 + it.x);
      ctx.save();
      ctx.globalAlpha = 0.1 + pulse * 0.14;
      ctx.fillStyle = "#ffe07a";
      ctx.beginPath();
      ctx.ellipse(cx, (topY + baseY) / 2, 7 + pulse * 2, (baseY - topY) / 2 + 2, 0, 0, 7);
      ctx.fill();
      ctx.restore();
      const s = 1 + 0.6 * pulse;
      const sy = topY - 2;
      ctx.fillStyle = `rgba(255,246,180,${0.55 + 0.4 * pulse})`;
      ctx.fillRect(Math.round(cx - s), Math.round(sy), Math.round(s * 2), 1);
      ctx.fillRect(Math.round(cx), Math.round(sy - s), 1, Math.round(s * 2));
    }
    this.bursts = this.bursts.filter((b) => {
      const age = now - b.born;
      if (age > b.life) return false;
      const dt = 1 / 60;
      b.vy -= 6 * dt;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.y = Math.max(0, b.y + b.vy * dt);
      const f = age / b.life;
      const px = rr.sx(b.x);
      const py = rr.sy(b.z) - b.y * PPM;
      ctx.fillStyle = b.color;
      const sz = Math.max(1, Math.round(2 * (1 - f)));
      ctx.fillRect(Math.round(px), Math.round(py), sz, sz);
      return true;
    });
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "10px system-ui, sans-serif";
    this.pops = this.pops.filter((p) => {
      const age = now - p.born;
      if (age > p.life) return false;
      const f = age / p.life;
      const px = rr.sx(p.x);
      const py = rr.sy(p.z) - 16 - f * 14;
      ctx.save();
      ctx.globalAlpha = 1 - Math.max(0, f - 0.55) / 0.45;
      ctx.fillText(p.emoji, px, py);
      ctx.restore();
      return true;
    });
  }
}

/** True if any patch covers this point (planting gate — re-exported for main). */
export { patchCoverageAt };
export type { CropItem };
