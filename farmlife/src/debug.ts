import type { Tune } from "./tune";
import type { Input } from "./player2d/input";

// window.__FL__ — headless tests + future phases depend on this shape. Decoupled
// from any 3D camera/controls (2D conversion): `cam` is now the 2D follow camera
// (world centre + integer display scale). main.ts augments __FL__ with the farm/
// avatar/animals/… sub-hooks as before.

export interface PlayerState {
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  airborne: boolean;
}

export interface CamState {
  x: number;
  z: number;
  scale: number;
}

export interface FLDebug {
  player: PlayerState;
  cam: CamState;
  setInput(partial: Partial<Input>): void;
  tune: Tune;
}

export function installDebug(opts: {
  player: PlayerState;
  getCam: () => CamState;
  setInput: (p: Partial<Input>) => void;
  tune: Tune;
}): void {
  const dbg: FLDebug = {
    player: opts.player,
    get cam() {
      return opts.getCam();
    },
    setInput: opts.setInput,
    tune: opts.tune,
  };
  (window as unknown as { __FL__: FLDebug }).__FL__ = dbg;
}
