// ---------------------------------------------------------------------------
// touch2d (R3) — mobile controls, left half of the screen.
//
// LEFT-HALF ZONE, TAP vs DRAG (coexists with R2 tap-to-act):
//   The zone captures the left 55% of the screen. A pointer that stays within a
//   small DEAD-ZONE and releases quickly is a TAP → forwarded via onTap so it
//   acts on the tile under the finger (the R2 walk-then-act path, same as a
//   right-45% canvas tap). A pointer that moves past the dead-zone becomes the
//   ANALOG joystick (ring + knob appear anchored at the touch-down point; walk
//   direction is proportional — analog is right for a cozy farm game, so the
//   binary-full-lock Farm Kart steering lesson does NOT apply here). Diagonal
//   walk is true 45° because fwd/strafe are independent normalized components
//   (main.ts renormalizes the vector).
//
//   Discrimination thresholds (documented for the QA suite):
//     DRAG_START_PX = 12  — finger travel before the stick engages (a tap never
//                           crosses this, so a tap never flashes the ring)
//     TAP_MAX_MS    = 260 — a tap must also release within this window
//
// The RIGHT-side ACTION / JUMP / 💬 buttons and the tool hotbar live in the HUD
// (body.fl-mobile, higher z-index) and route through the same doAction/jump/
// emote pipeline as the keyboard — nothing here overlaps them.
// ---------------------------------------------------------------------------

import type { Input } from "./input";

export function isMobile(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches && Math.min(window.innerWidth, window.innerHeight) < 900;
  } catch (_) {
    return false;
  }
}

const MAX_PX = 90; // full-lock stick radius
const RUN_FRAC = 0.7; // drag fraction that flips to run
const DRAG_START_PX = 12; // travel before a touch becomes a joystick drag (tap dead-zone)
const TAP_MAX_MS = 260; // a tap must release within this

export class TouchControls2D {
  input: Input = { fwd: 0, strafe: 0, run: false };
  /** Tap-to-act: called with client coords when a left-zone touch is a tap
   * (not a drag). main.ts routes it to the same walk-then-act path as a canvas
   * tap. */
  onTap: ((clientX: number, clientY: number) => void) | null = null;

  private pid = -1;
  private ox = 0;
  private oy = 0;
  private downAt = 0;
  private dragging = false;
  private ring: HTMLElement;
  private knob: HTMLElement;

  constructor() {
    document.body.classList.add("fl-mobile");
    const layer = document.createElement("div");
    layer.id = "fl-touch";
    layer.innerHTML = `<div id="fl-stickzone"></div><div id="fl-ring"><div id="fl-knob"></div></div>`;
    document.body.appendChild(layer);
    this.ring = layer.querySelector("#fl-ring") as HTMLElement;
    this.knob = layer.querySelector("#fl-knob") as HTMLElement;

    const style = document.createElement("style");
    style.textContent = `
      #fl-touch { position: fixed; inset: 0; z-index: 20; pointer-events: none; }
      #fl-stickzone { position: absolute; left: 0; top: 0; width: 55%; height: 100%; pointer-events: auto; }
      #fl-ring { position: absolute; width: ${MAX_PX * 2}px; height: ${MAX_PX * 2}px;
        border-radius: 50%; border: 3px solid rgba(255,255,255,.55);
        background: rgba(255,255,255,.12); transform: translate(-50%,-50%);
        left: -999px; top: -999px; pointer-events: none; transition: opacity .12s; opacity: 0; }
      #fl-knob { position: absolute; left: 50%; top: 50%; width: 64px; height: 64px;
        margin: -32px 0 0 -32px; border-radius: 50%; background: rgba(255,255,255,.85);
        box-shadow: 0 2px 8px rgba(0,0,0,.3); }`;
    document.head.appendChild(style);

    const sz = layer.querySelector("#fl-stickzone") as HTMLElement;
    sz.addEventListener("pointerdown", this.down);
    window.addEventListener("pointermove", this.move);
    window.addEventListener("pointerup", this.up);
    window.addEventListener("pointercancel", this.up);
  }

  private down = (e: PointerEvent) => {
    if (this.pid !== -1) return;
    this.pid = e.pointerId;
    this.ox = e.clientX;
    this.oy = e.clientY;
    this.downAt = performance.now();
    this.dragging = false;
    // ring stays hidden until the drag threshold is crossed (so a tap never flashes it)
    this.knob.style.transform = "translate(0,0)";
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pid) return;
    let dx = e.clientX - this.ox;
    let dy = e.clientY - this.oy;
    const d = Math.hypot(dx, dy);
    if (!this.dragging) {
      if (d < DRAG_START_PX) return; // still within the tap dead-zone
      // engage the analog stick anchored at the touch-down point
      this.dragging = true;
      this.ring.style.left = this.ox + "px";
      this.ring.style.top = this.oy + "px";
      this.ring.style.opacity = "1";
    }
    if (d > MAX_PX) {
      dx = (dx / d) * MAX_PX;
      dy = (dy / d) * MAX_PX;
    }
    this.knob.style.transform = `translate(${dx}px,${dy}px)`;
    const frac = Math.min(1, d / MAX_PX);
    this.input.strafe = dx / MAX_PX;
    this.input.fwd = -dy / MAX_PX; // up = forward (north / −Z)
    this.input.run = frac >= RUN_FRAC;
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pid) return;
    const wasDragging = this.dragging;
    const dt = performance.now() - this.downAt;
    const cx = e.clientX;
    const cy = e.clientY;
    this.pid = -1;
    this.dragging = false;
    this.input.fwd = 0;
    this.input.strafe = 0;
    this.input.run = false;
    this.ring.style.opacity = "0";
    this.ring.style.left = "-999px";
    // a quick, low-travel release that never engaged the stick = a tap
    if (!wasDragging && e.type === "pointerup" && dt <= TAP_MAX_MS) {
      this.onTap?.(cx, cy);
    }
  };
}
