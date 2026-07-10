import type { ChaseCam } from "../camera/chaseCam";
import type { Input } from "./controls";

// Mobile touch: left half = drag-anywhere analog joystick (ring+knob visuals,
// auto-run past ~70% deflection); right half = drag to orbit the camera.
// Mirrors the Farm Kart / Bistro touch patterns. Desktop shows none of this.

export function isMobile(): boolean {
  try {
    return (
      window.matchMedia("(pointer: coarse)").matches &&
      Math.min(window.innerWidth, window.innerHeight) < 900
    );
  } catch (_) {
    return false;
  }
}

const MAX_PX = 90; // full-deflection radius
const RUN_FRAC = 0.7;

export class TouchControls {
  input: Input = { fwd: 0, strafe: 0, run: false };
  private stickPid = -1;
  private orbitPid = -1;
  private ox = 0;
  private oy = 0; // joystick origin
  private lastOX = 0;
  private lastOY = 0; // orbit last pos
  private ring: HTMLElement;
  private knob: HTMLElement;

  constructor(private cam: ChaseCam) {
    document.body.classList.add("fl-mobile");
    const layer = document.createElement("div");
    layer.id = "fl-touch";
    layer.innerHTML = `
      <div id="fl-stickzone"></div>
      <div id="fl-orbitzone"></div>
      <div id="fl-ring"><div id="fl-knob"></div></div>`;
    document.body.appendChild(layer);
    this.ring = layer.querySelector("#fl-ring") as HTMLElement;
    this.knob = layer.querySelector("#fl-knob") as HTMLElement;

    const style = document.createElement("style");
    style.textContent = `
      #fl-touch { position: fixed; inset: 0; z-index: 20; pointer-events: none; }
      #fl-stickzone { position: absolute; left: 0; top: 0; width: 50%; height: 100%; pointer-events: auto; }
      #fl-orbitzone { position: absolute; right: 0; top: 0; width: 50%; height: 100%; pointer-events: auto; }
      #fl-ring { position: absolute; width: ${MAX_PX * 2}px; height: ${MAX_PX * 2}px;
        border-radius: 50%; border: 3px solid rgba(255,255,255,.55);
        background: rgba(255,255,255,.12); transform: translate(-50%,-50%);
        left: -999px; top: -999px; pointer-events: none;
        transition: opacity .12s; opacity: 0; }
      #fl-knob { position: absolute; left: 50%; top: 50%; width: 64px; height: 64px;
        margin: -32px 0 0 -32px; border-radius: 50%;
        background: rgba(255,255,255,.85); box-shadow: 0 2px 8px rgba(0,0,0,.3); }
    `;
    document.head.appendChild(style);

    const sz = layer.querySelector("#fl-stickzone") as HTMLElement;
    const oz = layer.querySelector("#fl-orbitzone") as HTMLElement;
    sz.addEventListener("pointerdown", this.stickDown);
    oz.addEventListener("pointerdown", this.orbitDown);
    window.addEventListener("pointermove", this.move);
    window.addEventListener("pointerup", this.up);
    window.addEventListener("pointercancel", this.up);
  }

  private stickDown = (e: PointerEvent) => {
    if (this.stickPid !== -1) return;
    this.stickPid = e.pointerId;
    this.ox = e.clientX;
    this.oy = e.clientY;
    this.ring.style.left = this.ox + "px";
    this.ring.style.top = this.oy + "px";
    this.ring.style.opacity = "1";
    this.moveKnob(0, 0);
  };
  private orbitDown = (e: PointerEvent) => {
    if (this.orbitPid !== -1) return;
    this.orbitPid = e.pointerId;
    this.lastOX = e.clientX;
    this.lastOY = e.clientY;
  };
  private move = (e: PointerEvent) => {
    if (e.pointerId === this.stickPid) {
      let dx = e.clientX - this.ox;
      let dy = e.clientY - this.oy;
      const d = Math.hypot(dx, dy);
      if (d > MAX_PX) {
        dx = (dx / d) * MAX_PX;
        dy = (dy / d) * MAX_PX;
      }
      this.moveKnob(dx, dy);
      const frac = Math.min(1, d / MAX_PX);
      this.input.strafe = dx / MAX_PX;
      this.input.fwd = -dy / MAX_PX; // up = forward
      this.input.run = frac >= RUN_FRAC;
    } else if (e.pointerId === this.orbitPid) {
      const dx = e.clientX - this.lastOX;
      const dy = e.clientY - this.lastOY;
      this.lastOX = e.clientX;
      this.lastOY = e.clientY;
      this.cam.orbit(dx * 0.006, dy * 0.006);
    }
  };
  private up = (e: PointerEvent) => {
    if (e.pointerId === this.stickPid) {
      this.stickPid = -1;
      this.input.fwd = 0;
      this.input.strafe = 0;
      this.input.run = false;
      this.ring.style.opacity = "0";
      this.ring.style.left = "-999px";
    } else if (e.pointerId === this.orbitPid) {
      this.orbitPid = -1;
    }
  };
  private moveKnob(dx: number, dy: number) {
    this.knob.style.transform = `translate(${dx}px,${dy}px)`;
  }
}
