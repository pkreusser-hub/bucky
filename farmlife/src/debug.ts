import type { Tune } from "./tune";
import type { ChaseCam } from "./camera/chaseCam";
import type { Controls, Input } from "./player/controls";

// window.__FL__ — headless tests and future phases depend on this shape.

export interface PlayerState {
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  airborne: boolean;
}

export interface FLDebug {
  player: PlayerState;
  cam: { dist: number; yaw: number; pitch: number };
  setInput(partial: Partial<Input>): void;
  tune: Tune;
}

export function installDebug(opts: {
  player: PlayerState;
  cam: ChaseCam;
  controls: Controls;
  tune: Tune;
}): void {
  const dbg: FLDebug = {
    player: opts.player,
    get cam() {
      return { dist: opts.cam.dist, yaw: opts.cam.yaw, pitch: opts.cam.pitch };
    },
    setInput: (p: Partial<Input>) => opts.controls.setInput(p),
    tune: opts.tune,
  };
  (window as unknown as { __FL__: FLDebug }).__FL__ = dbg;
}
