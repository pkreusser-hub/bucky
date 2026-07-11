// ---------------------------------------------------------------------------
// remote2d (R3) — 2D remote farmers ("see your family"). Positions come
// interpolated from the SAME Presence layer (net/presence.ts, wire format
// UNTOUCHED: x,y,z,h,tool,anim-seq,emote-seq); the RENDER side is 2D. Each remote
// renders as the SAME puppet farmer as the local player with a per-name shirt
// tint (the P3 tint rules ported to the pixel parts: clothes tint toward the
// player color via lookFromColor, skin/hair stay natural — see farmer2d), plus:
//   · a crisp DOM-free pixel name tag (drawn on the native buffer so it scales
//     with the art; chosen over DOM labels so it's occluded/tinted identically),
//   · velocity-derived facing + walk/run gait (presence.sample speed),
//   · the equipped TOOL held in hand (r.tool → farmer.draw), and
//   · tool-action REPLAY: onRemoteAnim(kind) → playAnim maps the synced anim
//     kinds to the R2 farmer2d playAction tweens (hoe/water/plant/harvest/refill;
//     "pet" plays no swing — matching the LOCAL player, which also emits "pet"
//     over the wire but runs no farmer2d action for it).
// Emotes render as pixel SPEECH BUBBLES (drawSpeechBubble, shared with the local
// player). Cosmetic only — remotes never touch farm state or collision.
// ---------------------------------------------------------------------------

import { Farmer2D, lookFromColor, facingFromHeading, type Facing, type FarmerLook, type ActionKind } from "./farmer2d";
import { shirtTint } from "../net/presenceUtil";
import { EMOTES, type EmoteKind } from "../player/emoteConst";
import type { ToolId } from "../farm/action";
import type { Presence } from "../net/presence";
import type { Renderer2D } from "./renderer";

/** The synced tool-use anim kinds (presence "a" field). Structurally identical
 * to player.ts's ToolAnimKind, kept local so remote2d never references the 3D
 * player module. "pet" has no farmer2d tween (see header). */
export type RemoteAnimKind = ActionKind | "pet";

interface Remote {
  id: string;
  name: string;
  look: FarmerLook;
  color: string;
  x: number;
  z: number;
  heading: number;
  speed: number;
  facing: Facing;
  tool: ToolId;
  farmer: Farmer2D;
  emote: { kind: EmoteKind; until: number } | null;
}

const MAX_SPEED = 10; // for gait fraction (walk/run threshold)
const RUN_FRAC = 0.6;
const EMOTE_MS = 2000;

export class Remote2D {
  private map = new Map<string, Remote>();

  add(id: string, name: string): void {
    if (this.map.has(id)) return;
    const color = shirtTint(name);
    this.map.set(id, {
      id,
      name,
      color,
      look: lookFromColor(color),
      x: 0,
      z: -100,
      heading: 0,
      speed: 0,
      facing: "down",
      tool: "hoe",
      farmer: new Farmer2D(),
      emote: null,
    });
  }
  remove(id: string): void {
    this.map.delete(id);
  }
  showEmote(id: string, kind: EmoteKind): void {
    const r = this.map.get(id);
    if (r) r.emote = { kind, until: performance.now() + EMOTE_MS };
  }
  /** Replay a remote's tool-use animation (synced via presence anim seq). Maps
   * the wire anim kind to the R2 farmer2d playAction tween; "pet" is a no-op
   * swing (the local player emits it too but plays no farmer action). */
  playAnim(id: string, kind: RemoteAnimKind): void {
    const r = this.map.get(id);
    if (!r) return;
    if (kind === "pet") return; // no swing tween — matches the local player
    r.farmer.playAction(kind);
  }

  ids(): string[] {
    return [...this.map.keys()];
  }
  count(): number {
    return this.map.size;
  }
  pos(id: string): { x: number; z: number } | null {
    const r = this.map.get(id);
    return r ? { x: r.x, z: r.z } : null;
  }
  /** Test/debug: a remote's current render state (position, facing, held tool,
   * gait, whether a tool-swing tween is playing, the live emote kind, and the
   * shirt tint — what the MP verify samples on the other device). */
  state(id: string): { x: number; z: number; name: string; color: string; facing: Facing; tool: ToolId; moving: boolean; acting: boolean; emote: EmoteKind | null } | null {
    const r = this.map.get(id);
    if (!r) return null;
    return {
      x: r.x,
      z: r.z,
      name: r.name,
      color: r.color,
      facing: r.facing,
      tool: r.tool,
      moving: r.speed > 0.3,
      acting: r.farmer.isActing(),
      emote: r.emote && performance.now() < r.emote.until ? r.emote.kind : null,
    };
  }

  update(dt: number, presence: Presence): void {
    for (const r of this.map.values()) {
      const s = presence.sample(r.id);
      if (s) {
        r.x = s.x;
        r.z = s.z;
        r.heading = s.heading;
        r.speed = s.speed;
        r.tool = s.tool; // equipped-tool display (wire "t" field)
      }
      const moving = r.speed > 0.3;
      r.facing = facingFromHeading(r.heading, moving, r.facing);
      r.farmer.update(dt, Math.min(1, r.speed / MAX_SPEED));
    }
  }

  /** Push each remote into the y-sort list (draw with the local player). */
  forEach(cb: (z: number, draw: (rr: Renderer2D) => void) => void): void {
    for (const r of this.map.values()) {
      if (r.z < -50) continue; // not seated yet
      cb(r.z, (rr) => {
        const moving = r.speed > 0.3;
        r.farmer.draw(rr.ctx, rr.sx(r.x), rr.sy(r.z), r.facing, moving, r.speed / MAX_SPEED > RUN_FRAC, 0, 1, r.look, r.tool);
      });
    }
  }

  /** Name tags + emote bubbles over each remote (effects overlay, above props). */
  drawOverlay(rr: Renderer2D): void {
    const ctx = rr.ctx;
    const now = performance.now();
    for (const r of this.map.values()) {
      if (r.z < -50) continue;
      const cx = rr.sx(r.x);
      const top = rr.sy(r.z) - 34;
      // name tag — crisp pixel-buffer text (scales with the art, tints/occludes
      // identically to the sprites; a color underline keys it to the shirt tint).
      ctx.font = "6px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const w = ctx.measureText(r.name).width + 6;
      ctx.fillStyle = "rgba(20,16,8,0.72)";
      ctx.fillRect(Math.round(cx - w / 2), top - 5, Math.round(w), 8);
      ctx.fillStyle = r.color;
      ctx.fillRect(Math.round(cx - w / 2), top - 5, Math.round(w), 1);
      ctx.fillStyle = "#fff";
      ctx.fillText(r.name, cx, top - 1);
      // emote — pixel speech bubble
      if (r.emote && now < r.emote.until) {
        drawSpeechBubble(ctx, cx, top - 8, EMOTES[r.emote.kind]);
      } else if (r.emote) {
        r.emote = null;
      }
    }
  }
}

/**
 * Draw a pixel-art speech bubble containing `emoji`, centred at `cx`, with its
 * downward tail tip at `baseY` (just above the head). Shared by remote farmers
 * and the local player so every emote reads the same. Crisp on the native
 * buffer: a white rounded body with a 1px warm-dark outline + a small tail.
 */
export function drawSpeechBubble(ctx: CanvasRenderingContext2D, cx: number, baseY: number, emoji: string): void {
  ctx.save();
  ctx.font = "11px 'Segoe UI Emoji', 'Apple Color Emoji', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const ew = Math.max(11, ctx.measureText(emoji).width);
  const w = Math.round(ew + 8);
  const h = 15;
  const x = Math.round(cx - w / 2);
  const y = Math.round(baseY - h - 3); // bubble body sits above the tail
  // outline (drawn 1px larger), then white body — a chunky pixel bubble
  ctx.fillStyle = "#3b2f22";
  fillRound(ctx, x - 1, y - 1, w + 2, h + 2, 4);
  ctx.fillStyle = "#fdfbf4";
  fillRound(ctx, x, y, w, h, 3);
  // tail: a little triangle poking down toward the head
  ctx.fillStyle = "#3b2f22";
  ctx.beginPath();
  ctx.moveTo(cx - 3, y + h - 1);
  ctx.lineTo(cx + 3, y + h - 1);
  ctx.lineTo(cx, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fdfbf4";
  ctx.beginPath();
  ctx.moveTo(cx - 2, y + h - 1);
  ctx.lineTo(cx + 2, y + h - 1);
  ctx.lineTo(cx, baseY - 1);
  ctx.closePath();
  ctx.fill();
  // the emoji
  ctx.fillStyle = "#222";
  ctx.fillText(emoji, cx, y + h / 2 + 1);
  ctx.restore();
}

/** Fill a rounded rect (pixel-friendly small radius). */
function fillRound(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}
