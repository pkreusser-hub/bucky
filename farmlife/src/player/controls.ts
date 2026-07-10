import type { ChaseCam } from "../camera/chaseCam";

// Desktop controls: WASD/arrows = camera-relative move, Shift = run,
// drag-anywhere = orbit (no pointer lock), wheel = zoom.

export interface Input {
  fwd: number; // -1..1 (forward is +, into the screen)
  strafe: number; // -1..1 (right is +)
  run: boolean;
}

export class Controls {
  private keys = new Set<string>();
  private override: Partial<Input> | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private uiEls: HTMLElement[];

  constructor(
    dom: HTMLElement,
    private cam: ChaseCam,
    uiEls: HTMLElement[] = []
  ) {
    this.uiEls = uiEls;
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    dom.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    dom.addEventListener("wheel", this.onWheel, { passive: false });
  }

  private overUI(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    return !!el && this.uiEls.some((u) => u.contains(el));
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
    this.keys.add(k);
    this.override = null; // real input resumes control
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.overUI(e.target)) return;
    if (e.button === 2) return; // right button = action (wired in main.ts), never orbit
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.cam.orbit(dx * 0.005, dy * 0.005);
  };
  private onPointerUp = () => {
    this.dragging = false;
  };
  private onWheel = (e: WheelEvent) => {
    if (this.overUI(e.target)) return;
    e.preventDefault();
    this.cam.zoom(e.deltaY * 0.01);
  };

  /** Debug/test hook: force input until the next real key press. */
  setInput(partial: Partial<Input>): void {
    this.override = { ...(this.override || {}), ...partial };
  }

  sample(): Input {
    let fwd = 0;
    let strafe = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) fwd += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) fwd -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) strafe += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) strafe -= 1;
    let run = this.keys.has("shift");
    if (this.override) {
      if (typeof this.override.fwd === "number") fwd = this.override.fwd;
      if (typeof this.override.strafe === "number") strafe = this.override.strafe;
      if (typeof this.override.run === "boolean") run = this.override.run;
    }
    return { fwd, strafe, run };
  }
}
