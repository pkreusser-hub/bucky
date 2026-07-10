import * as THREE from "three";

// ---------------------------------------------------------------------------
// Floating name tag for a remote avatar (P3). A canvas SpriteMaterial rendered
// above the head, distance-scaled each frame so it stays legible near and far
// (the farm3d photo-pin polaroid pattern). Colour-matched to the farmer's
// shirt tint so name + avatar read as one person.
// ---------------------------------------------------------------------------

export interface NameTag {
  sprite: THREE.Sprite;
  /** Scale the sprite for the current camera distance so it reads at any range. */
  update(cameraPos: THREE.Vector3): void;
  dispose(): void;
}

export function makeNameTag(name: string, accent: string): NameTag {
  const label = (name || "Farmer").slice(0, 14);
  const pad = 20;
  const fontPx = 44;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.font = `700 ${fontPx}px system-ui, "Segoe UI", Roboto, sans-serif`;
  const textW = Math.ceil(ctx.measureText(label).width);
  c.width = textW + pad * 2;
  c.height = fontPx + pad * 2;
  const ctx2 = c.getContext("2d")!;
  // pill background
  ctx2.fillStyle = "rgba(18,14,8,0.82)";
  roundRect(ctx2, 0, 0, c.width, c.height, c.height / 2);
  ctx2.fill();
  // accent underline dot to tie name to shirt colour
  ctx2.fillStyle = accent;
  roundRect(ctx2, 6, c.height - 12, c.width - 12, 6, 3);
  ctx2.fill();
  // text
  ctx2.font = `700 ${fontPx}px system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx2.fillStyle = "#ffffff";
  ctx2.textAlign = "center";
  ctx2.textBaseline = "middle";
  ctx2.fillText(label, c.width / 2, c.height / 2 - 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 998;
  const aspect = c.width / c.height;

  const _p = new THREE.Vector3();
  return {
    sprite,
    update(cameraPos) {
      sprite.getWorldPosition(_p);
      const dist = _p.distanceTo(cameraPos);
      // base height ~0.42 world units, grow gently with distance so it never
      // shrinks to nothing (clamped) — the polaroid distance-adaptive scale.
      const h = THREE.MathUtils.clamp(0.28 + dist * 0.035, 0.42, 1.6);
      sprite.scale.set(h * aspect, h, 1);
    },
    dispose() {
      tex.dispose();
      mat.dispose();
    },
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
