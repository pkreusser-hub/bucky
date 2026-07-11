import * as THREE from "three";
import { EMOTES, type EmoteKind } from "./emoteConst";

// ---------------------------------------------------------------------------
// Emotes (P3) — THREE sprite/texture builders ONLY. The emote SET + kinds moved
// to emoteConst.ts (THREE-free) so the 2D bundle imports them from there; this
// module (emojiTexture / makeEmoteBubble) is the DEPRECATED 3D bubble path and
// is not reachable from the 2D render core. emoteConst re-exported below so any
// legacy importer of emote.ts is unchanged.
// ---------------------------------------------------------------------------

export * from "./emoteConst";

const BUBBLE_MS = 2000;

/** A CanvasTexture of a single emoji, drawn crisp and centered. Cached per
 * character so repeated bubbles/avatars share one GPU texture. */
const emojiCache = new Map<string, THREE.CanvasTexture>();
export function emojiTexture(char: string): THREE.CanvasTexture {
  const hit = emojiCache.get(char);
  if (hit) return hit;
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  // soft rounded white bubble backing so the emoji reads on any terrain
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  roundRect(ctx, 8, 8, size - 16, size - 16, 26);
  ctx.fill();
  ctx.font = `${Math.round(size * 0.62)}px "Segoe UI Emoji", "Apple Color Emoji", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(char, size / 2, size / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  emojiCache.set(char, tex);
  return tex;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface EmoteBubble {
  sprite: THREE.Sprite;
  /** Show the given emote's bubble for ~2s (re-showing restarts the timer). */
  show(kind: EmoteKind): void;
  /** Per-frame fade/pop + auto-hide. */
  update(dt: number): void;
  dispose(): void;
}

/** Build an emote bubble sprite. Caller parents `sprite` to the avatar root at
 * head height (~y 2.5). Hidden until `show()`. */
export function makeEmoteBubble(): EmoteBubble {
  const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, opacity: 0 });
  mat.map = emojiTexture(EMOTES.wave);
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.9, 0.9, 1);
  sprite.visible = false;
  sprite.renderOrder = 999;

  let t = 0; // remaining ms

  return {
    sprite,
    show(kind) {
      mat.map = emojiTexture(EMOTES[kind]);
      mat.needsUpdate = true;
      t = BUBBLE_MS;
      sprite.visible = true;
    },
    update(dt) {
      if (t <= 0) return;
      t -= dt * 1000;
      if (t <= 0) {
        sprite.visible = false;
        mat.opacity = 0;
        return;
      }
      // pop-in over the first 140ms, gentle fade-out over the last 400ms
      const inK = Math.min(1, (BUBBLE_MS - t) / 140);
      const outK = Math.min(1, t / 400);
      const k = Math.min(inK, outK);
      mat.opacity = k;
      const s = 0.72 + 0.22 * Math.min(1, (BUBBLE_MS - t) / 220);
      sprite.scale.set(s, s, 1);
    },
    dispose() {
      mat.dispose();
    },
  };
}
