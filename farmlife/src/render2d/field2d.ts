// ---------------------------------------------------------------------------
// Field2D — the 2D replacement for Field3D's visuals. It renders the 12×12
// gameplay grid straight from FarmState each frame (144 tiles max — cheap and
// always correct, so an E-till or a remote edit repaints with zero bookkeeping;
// the "bake into the static map + per-tile dirty redraw" optimisation is a
// documented R2 hook). Also owns the tile HIGHLIGHT + the pop/burst juice.
// Same method names as Field3D (syncTile/syncAll/tick/setHighlightTile/spawnPop/
// spawnBurst/animate) so main.ts's wiring is unchanged; the sync/tick calls are
// now no-ops (state is read live at draw time). Crop sprites are placeholders in
// the mockup's sprout/soil language until R2.
// ---------------------------------------------------------------------------

import { TILE_SIZE, tileCenter } from "../farm/grid";
import { CROPS, growthStage, effectiveCrop, type GrowthTile } from "../farm/growth";
import type { FarmState, TileRecord } from "../farm/store";
import { Sprites } from "./sprites";
import { SOIL } from "./palette";
import { PPM } from "./coords";
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

function toGrowthTile(rec: TileRecord): GrowthTile | null {
  if (rec.crop == null) return null;
  return { plantedAt: rec.plantedAt ?? 0, accruedMs: rec.accruedMs ?? 0, lastWatered: rec.lastWatered ?? rec.plantedAt ?? 0 };
}

export class Field2D {
  private highlight: { gx: number; gz: number; color: string } | null = null;
  private pops: Pop[] = [];
  private bursts: Burst[] = [];
  private tSec = 0;

  // no-op sync hooks (kept so main.ts's Field3D wiring is untouched) ----------
  syncTile(): void {}
  syncAll(): void {}
  tick(): void {}

  setHighlightTile(gx: number | null, gz: number | null, color: number): void {
    if (gx == null || gz == null) {
      this.highlight = null;
      return;
    }
    this.highlight = { gx, gz, color: "#" + (color >>> 0).toString(16).padStart(6, "0").slice(-6) };
  }

  spawnPop(x: number, _y: number, z: number, emoji: string): void {
    this.pops.push({ x, z, emoji, born: performance.now(), life: 750 });
  }

  spawnBurst(x: number, _y: number, z: number, color: number, count = 8, up = 1): void {
    const c = "#" + (color >>> 0).toString(16).padStart(6, "0").slice(-6);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 0.4 + Math.random() * 0.7;
      this.bursts.push({
        x,
        z,
        vx: Math.cos(a) * spd,
        vz: Math.sin(a) * spd,
        vy: (1.2 + Math.random() * 1.2) * up,
        y: 0.4,
        color: c,
        born: performance.now(),
        life: 550 + Math.random() * 250,
      });
    }
  }

  animate(tSec: number): void {
    this.tSec = tSec;
  }

  // ---- draws ----------------------------------------------------------------
  /** Tilled/watered soil rects (flat ground overlay — drawn before y-sorted props). */
  drawSoil(rr: Renderer2D, state: FarmState, now: number): void {
    const ctx = rr.ctx;
    const half = (TILE_SIZE * 0.92 * PPM) / 2;
    for (const key of Object.keys(state.tiles)) {
      const m = /^t_(\d+)_(\d+)$/.exec(key);
      if (!m) continue;
      const rec = state.tiles[key];
      const { x, z } = tileCenter(parseInt(m[1], 10), parseInt(m[2], 10));
      const cx = rr.sx(x);
      const cy = rr.sy(z);
      let damp = false;
      if (rec.crop) {
        const crop = effectiveCrop(CROPS[rec.crop]);
        damp = now - (rec.lastWatered ?? 0) < crop.waterEveryMs * 0.4;
      }
      const base = damp ? SOIL.wet : SOIL.base;
      const ridge = damp ? SOIL.wetridge : SOIL.ridge;
      ctx.fillStyle = SOIL.dk2;
      ctx.fillRect(Math.round(cx - half - 1), Math.round(cy - half - 1), Math.round(half * 2 + 2), Math.round(half * 2 + 2));
      ctx.fillStyle = base;
      ctx.fillRect(Math.round(cx - half), Math.round(cy - half), Math.round(half * 2), Math.round(half * 2));
      // furrow ridges (top-lit lines + shadow line between = the mockup's rows)
      ctx.fillStyle = ridge;
      for (let ry = -half + 2; ry < half - 1; ry += 4) ctx.fillRect(Math.round(cx - half + 1), Math.round(cy + ry), Math.round(half * 2 - 2), 1);
      ctx.fillStyle = SOIL.dk;
      for (let ry = -half + 4; ry < half - 1; ry += 4) ctx.fillRect(Math.round(cx - half + 1), Math.round(cy + ry), Math.round(half * 2 - 2), 1);
      // watered soil: subtle damp sheen dots (deterministic per tile, gentle shimmer)
      if (damp) {
        const seed = ((parseInt(m[1], 10) * 31 + parseInt(m[2], 10) * 17) & 15) / 15;
        ctx.fillStyle = `rgba(150,190,225,${0.14 + 0.06 * Math.sin(this.tSec * 3 + seed * 6)})`;
        for (let k = 0; k < 4; k++) {
          const a = seed * 6.28 + k * 1.7;
          const rx = Math.round(cx + Math.cos(a) * half * 0.55);
          const ry = Math.round(cy + Math.sin(a) * half * 0.5);
          ctx.fillRect(rx, ry, 1, 1);
        }
      }
    }
  }

  /** Crop sprites for the y-sorted pass (short plants; the player can stand in front). */
  cropItems(state: FarmState, now: number): CropItem[] {
    const out: CropItem[] = [];
    for (const key of Object.keys(state.tiles)) {
      const rec = state.tiles[key];
      if (!rec.crop) continue;
      const g = toGrowthTile(rec);
      if (!g) continue;
      const stage = growthStage(g, effectiveCrop(CROPS[rec.crop]), now);
      const vis: 0 | 1 | 2 | 3 = stage === "ready" ? 3 : stage;
      const m = /^t_(\d+)_(\d+)$/.exec(key);
      if (!m) continue;
      const { x, z } = tileCenter(parseInt(m[1], 10), parseInt(m[2], 10));
      out.push({ x, z, sprite: Sprites.crop(rec.crop, vis), ready: stage === "ready" });
    }
    return out;
  }

  /** Tile highlight rect on the currently targeted tile (drawn over the soil). */
  drawHighlight(rr: Renderer2D): void {
    if (!this.highlight) return;
    const { x, z } = tileCenter(this.highlight.gx, this.highlight.gz);
    const s = TILE_SIZE * 0.96 * PPM;
    const cx = rr.sx(x);
    const cy = rr.sy(z);
    const ctx = rr.ctx;
    ctx.save();
    ctx.globalAlpha = 0.42 + 0.14 * Math.sin(this.tSec * 5);
    ctx.strokeStyle = this.highlight.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(cx - s / 2) + 0.5, Math.round(cy - s / 2) + 0.5, Math.round(s) - 1, Math.round(s) - 1);
    ctx.globalAlpha = 0.16 + 0.08 * Math.sin(this.tSec * 5);
    ctx.fillStyle = this.highlight.color;
    ctx.fillRect(Math.round(cx - s / 2), Math.round(cy - s / 2), Math.round(s), Math.round(s));
    ctx.restore();
  }

  /** Ready-crop sparkle + pops + bursts, drawn above the props. */
  drawEffects(rr: Renderer2D, readyItems: CropItem[]): void {
    const ctx = rr.ctx;
    const now = performance.now();
    // gold pulse + sparkle over ready crops (the "come harvest me!" beacon)
    for (const it of readyItems) {
      if (!it.ready) continue;
      const cx = rr.sx(it.x);
      const baseY = rr.sy(it.z);
      const topY = baseY - it.sprite.canvas.height + it.sprite.ay;
      const pulse = 0.5 + 0.5 * Math.sin(this.tSec * 3.5 + it.x);
      // soft gold halo behind/around the ripe crop
      ctx.save();
      ctx.globalAlpha = 0.1 + pulse * 0.14;
      ctx.fillStyle = "#ffe07a";
      ctx.beginPath();
      ctx.ellipse(cx, (topY + baseY) / 2, 7 + pulse * 2, (baseY - topY) / 2 + 2, 0, 0, 7);
      ctx.fill();
      ctx.restore();
      // twinkle sparkle above
      const s = 1 + 0.6 * pulse;
      const sy = topY - 2;
      ctx.fillStyle = `rgba(255,246,180,${0.55 + 0.4 * pulse})`;
      ctx.fillRect(Math.round(cx - s), Math.round(sy), Math.round(s * 2), 1);
      ctx.fillRect(Math.round(cx), Math.round(sy - s), 1, Math.round(s * 2));
    }
    // bursts
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
    // pops (emoji rising + fading)
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

export type { CropItem };
