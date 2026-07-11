// ---------------------------------------------------------------------------
// input — desktop keyboard for the 2D top-down build. Same Input contract as the
// old player/controls.ts (WASD / arrows / Shift-run + a setInput test override),
// but with NO camera coupling (top-down has no orbit/zoom). fwd = +1 moves
// up-screen (−Z, north); strafe = +1 moves right (+X).
// ---------------------------------------------------------------------------

export interface Input {
  fwd: number; // -1..1 (up-screen / north is +)
  strafe: number; // -1..1 (east is +)
  run: boolean;
}

export class Input2D {
  private keys = new Set<string>();
  private override: Partial<Input> | null = null;

  constructor() {
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", () => this.keys.clear());
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
