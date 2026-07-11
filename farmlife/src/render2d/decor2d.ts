// ---------------------------------------------------------------------------
// decor2d — the 2D replacement for world/decor.ts's DecorField. Holds the shared
// placed-decoration records, answers the facing-aware "nearest decoration" query
// the removal tool needs + the spacing overlaps() check placement uses, and draws
// each as a full per-type pixel sprite (R2). The pinwheel SPINS and the flag
// WAVES via a per-frame overlay over their baked poles. Also renders the
// placement GHOST (translucent + valid/invalid tint) for placement mode.
// ---------------------------------------------------------------------------

import { DECOR, type DecorRecord } from "../world/decorConst";
import { Sprites, PINWHEEL_TOP, FLAG_TOP } from "./sprites";
import { PPM } from "./coords";
import type { Renderer2D } from "./renderer";

const VANE_COLS = ["#e23b3b", "#f2c14e", "#3f7fd0", "#4f9a3f"];

export class Decor2D {
  private records = new Map<string, DecorRecord>();
  private tSec = 0;

  count(): number {
    return this.records.size;
  }
  ids(): string[] {
    return [...this.records.keys()];
  }
  record(id: string): DecorRecord | undefined {
    return this.records.get(id);
  }

  syncAll(next: Record<string, DecorRecord>): void {
    this.records.clear();
    for (const id of Object.keys(next)) this.records.set(id, { ...next[id] });
  }
  add(rec: DecorRecord): void {
    this.records.set(rec.id, { ...rec });
  }
  remove(id: string): void {
    this.records.delete(id);
  }
  update(dt: number): void {
    this.tSec += dt;
  }

  nearestFacing(px: number, pz: number, heading: number, maxDist: number, maxAngleRad: number): DecorRecord | null {
    const fwdX = Math.sin(heading),
      fwdZ = Math.cos(heading);
    let best: DecorRecord | null = null;
    let bestDist = Infinity;
    for (const rec of this.records.values()) {
      const dx = rec.x - px,
        dz = rec.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > maxDist || dist < 0.001) continue;
      const dot = (dx / dist) * fwdX + (dz / dist) * fwdZ;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle > maxAngleRad) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = rec;
      }
    }
    return best;
  }

  overlaps(x: number, z: number, r: number, ignoreId?: string): boolean {
    for (const rec of this.records.values()) {
      if (rec.id === ignoreId) continue;
      const other = DECOR[rec.type]?.cr ?? 0.3;
      if (Math.hypot(rec.x - x, rec.z - z) < r + other) return true;
    }
    return false;
  }

  /** Push each decoration into the y-sort list. */
  forEach(cb: (z: number, draw: (rr: Renderer2D) => void) => void): void {
    for (const rec of this.records.values()) {
      cb(rec.z, (rr) => this.drawOne(rr, rec.type, rec.x, rec.z, rec.rotY, 1));
    }
  }

  /** Draw one decoration (baked body + animated overlay for pinwheel/flag). */
  drawOne(rr: Renderer2D, type: string, x: number, z: number, rotY: number, alpha: number): void {
    const ctx = rr.ctx;
    if (alpha < 1) {
      ctx.save();
      ctx.globalAlpha = alpha;
    }
    rr.drawSprite(Sprites.decor(type), x, z);
    if (type === "pinwheel") this.drawPinwheel(rr, x, z);
    else if (type === "flag") this.drawFlag(rr, x, z, rotY);
    if (alpha < 1) ctx.restore();
  }

  private drawPinwheel(rr: Renderer2D, x: number, z: number): void {
    const ctx = rr.ctx;
    const cx = rr.sx(x);
    const cy = rr.sy(z) - PINWHEEL_TOP;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.tSec * 3.2);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = VANE_COLS[i];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(5, -2);
      ctx.lineTo(5, 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = "#333";
    ctx.fillRect(cx - 1, cy - 1, 2, 2); // hub
  }

  private drawFlag(rr: Renderer2D, x: number, z: number, rotY: number): void {
    const ctx = rr.ctx;
    const px0 = rr.sx(x);
    const top = rr.sy(z) - FLAG_TOP;
    const dir = Math.cos(rotY) >= 0 ? 1 : -1; // rotY flips the banner side
    ctx.fillStyle = "#ba303e";
    ctx.beginPath();
    ctx.moveTo(px0, top);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const wav = Math.sin(this.tSec * 4 - t * 3) * 1.6 * t;
      ctx.lineTo(px0 + dir * t * 8, top + t * 2 + wav);
    }
    for (let i = 8; i >= 0; i--) {
      const t = i / 8;
      const wav = Math.sin(this.tSec * 4 - t * 3) * 1.6 * t;
      ctx.lineTo(px0 + dir * t * 8, top + 5 + t * 2 + wav);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#d8505e";
    ctx.fillRect(px0, top + 1, dir * 2, 2);
  }

  /** Placement-mode ghost: footprint tint (green valid / red invalid) + the
   * decoration sprite at reduced alpha, at a live position. */
  drawGhost(rr: Renderer2D, type: string, x: number, z: number, rotY: number, valid: boolean): void {
    const ctx = rr.ctx;
    const cr = DECOR[type]?.cr ?? 0.4;
    const cx = rr.sx(x);
    const cy = rr.sy(z);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = valid ? "#4caf50" : "#d64545";
    ctx.beginPath();
    ctx.ellipse(cx, cy, cr * PPM, cr * PPM * 0.55, 0, 0, 7);
    ctx.fill();
    ctx.restore();
    this.drawOne(rr, type, x, z, rotY, 0.6);
  }
}
