// ---------------------------------------------------------------------------
// animals2d — AnimalField2D. Ports world/animals3d.ts's pasture-roaming state
// machine VERBATIM (it is pure XZ steering over farm/pasture.ts helpers) and
// swaps the THREE meshes for 2D goat/chicken sprites. The husbandry sim is a
// "gameplay comes in R2" system but its wander/routine keeps the world alive in
// the R1 walking build, so main.ts's animal wiring (update/actorAt/nearestFacing/
// wake/isInside/isSleeping/allInsideBarn) is preserved unchanged.
// ---------------------------------------------------------------------------

import { hashSeed, mulberry32, type AnimalType } from "../farm/animals";
import {
  containAnimal,
  insideBarn,
  grazeSpot,
  barnSleepSpot,
  doorWaitSpot,
  funnelTarget,
  type DayPhase,
} from "../farm/pasture";
import { Sprites } from "./sprites";
import type { Renderer2D } from "./renderer";

export type Pose = "walk" | "idle" | "graze" | "sleep";

const WANDER_SPEED = 0.55;
const HOME_SPEED = 0.85;
const IDLE_MIN = 2.5,
  IDLE_MAX = 6;
const WALK_MIN = 1.5,
  WALK_MAX = 3.5;
const ANIMAL_R = 0.42;

interface RuntimeState {
  mode: "roam" | "idle";
  until: number;
  tx: number;
  tz: number;
  sleeping: boolean;
  inside: boolean;
  wakeUntil: number;
}

export interface Actor2D {
  id: string;
  type: AnimalType;
  x: number;
  z: number;
  pose: Pose;
  flip: boolean; // facing left
  sleeping: boolean;
  zzzVisible: boolean;
}

export class AnimalField2D {
  actors: Actor2D[] = [];
  private rngs = new Map<string, () => number>();
  private state = new Map<string, RuntimeState>();
  private tSec = 0;

  constructor(herdSpecs: { id: string; type: AnimalType }[]) {
    for (const spec of herdSpecs) {
      const rng = mulberry32(hashSeed(spec.id) ^ 0x9e3779b9);
      this.rngs.set(spec.id, rng);
      const home = grazeSpot(rng);
      this.actors.push({ id: spec.id, type: spec.type, x: home.x, z: home.z, pose: "idle", flip: false, sleeping: false, zzzVisible: false });
      this.state.set(spec.id, { mode: "idle", until: 0, tx: home.x, tz: home.z, sleeping: false, inside: false, wakeUntil: 0 });
    }
  }

  actorAt(id: string): Actor2D | undefined {
    return this.actors.find((a) => a.id === id);
  }
  usesModels(): boolean {
    return false;
  }
  boneSample(): null {
    return null;
  }
  swapToModels(): void {}

  isInside(id: string): boolean {
    return this.state.get(id)?.inside ?? false;
  }
  isSleeping(id: string): boolean {
    return this.state.get(id)?.sleeping ?? false;
  }
  anyInsideBarn(): boolean {
    return this.actors.some((a) => this.state.get(a.id)?.inside);
  }
  allInsideBarn(): boolean {
    return this.actors.every((a) => this.state.get(a.id)?.inside);
  }
  wake(id: string): void {
    const st = this.state.get(id);
    if (st) st.wakeUntil = this.tSec + 3.5;
  }

  nearestFacing(px: number, pz: number, heading: number, maxDist: number, maxAngleRad: number): Actor2D | null {
    const fwdX = Math.sin(heading),
      fwdZ = Math.cos(heading);
    let best: Actor2D | null = null;
    let bestDist = Infinity;
    for (const a of this.actors) {
      const dx = a.x - px,
        dz = a.z - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > maxDist || dist < 0.001) continue;
      const dot = (dx / dist) * fwdX + (dz / dist) * fwdZ;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle > maxAngleRad) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = a;
      }
    }
    return best;
  }

  /** Advance the herd one frame (ported from animals3d.ts). */
  update(dt: number, phase: DayPhase, doorOpen: boolean): void {
    this.tSec += dt;
    for (const actor of this.actors) {
      const st = this.state.get(actor.id)!;
      const rng = this.rngs.get(actor.id)!;

      const homeMode = phase === "dusk" || phase === "night";
      const stuckInside = (phase === "day" || phase === "dawn") && st.inside && !doorOpen;

      let finalTarget: { x: number; z: number };
      let speed = WANDER_SPEED;
      let arriving = false;

      if (homeMode) {
        finalTarget = doorOpen || st.inside ? barnSleepSpot(actor.id) : doorWaitSpot(actor.id);
        speed = HOME_SPEED;
        arriving = true;
      } else if (stuckInside) {
        finalTarget = { x: doorWaitSpot(actor.id).x, z: barnSleepSpot(actor.id).z };
        arriving = true;
      } else {
        if (this.tSec >= st.until) {
          if (st.mode === "idle") {
            let picked = grazeSpot(rng);
            if (doorOpen && rng() < 0.14) picked = barnSleepSpot(actor.id);
            st.mode = "roam";
            st.tx = picked.x;
            st.tz = picked.z;
            st.until = this.tSec + WALK_MIN + rng() * (WALK_MAX - WALK_MIN);
          } else {
            st.mode = "idle";
            st.until = this.tSec + IDLE_MIN + rng() * (IDLE_MAX - IDLE_MIN);
          }
        }
        finalTarget = { x: st.tx, z: st.tz };
      }

      const target = funnelTarget(actor.x, actor.z, finalTarget, doorOpen);
      let moving = false;
      const dx = target.x - actor.x,
        dz = target.z - actor.z;
      const dist = Math.hypot(dx, dz);
      const distFinal = Math.hypot(finalTarget.x - actor.x, finalTarget.z - actor.z);
      const wantMove = arriving ? distFinal > 0.35 : st.mode === "roam" && distFinal > 0.05;
      if (wantMove && dist > 1e-4) {
        const stepD = Math.min(dist, speed * dt);
        const nx = actor.x + (dx / dist) * stepD;
        const nz = actor.z + (dz / dist) * stepD;
        const c = containAnimal(nx, nz, ANIMAL_R, doorOpen);
        actor.x = c.x;
        actor.z = c.z;
        moving = true;
        if (Math.abs(dx) > 0.02) actor.flip = dx < 0;
      } else {
        const c = containAnimal(actor.x, actor.z, ANIMAL_R, doorOpen);
        actor.x = c.x;
        actor.z = c.z;
      }

      st.inside = insideBarn(actor.x, actor.z);

      let pose: Pose = moving ? "walk" : "idle";
      const settledHome = homeMode && !moving;
      const awake = st.wakeUntil > this.tSec;
      if (phase === "night" && settledHome && !awake) {
        pose = "sleep";
        st.sleeping = true;
      } else {
        st.sleeping = false;
        if (!moving && !homeMode && !stuckInside) pose = "graze";
      }
      actor.pose = pose;
      actor.sleeping = st.sleeping;
      actor.zzzVisible = st.sleeping;
    }
  }

  /** Draw one actor (called from main's y-sorted pass). 2-frame puppet motion:
   * walk = stride swap + bob · graze = peck (chicken) / tail-flick (goat) on a
   * gentle cycle · idle = occasional flick. */
  drawActor(rr: Renderer2D, a: Actor2D): void {
    const off = a.x * 0.7 + a.z * 0.3; // per-actor phase offset
    const bob = a.pose === "walk" ? Math.round(Math.abs(Math.sin(this.tSec * 8 + a.x)) * 2) : 0;
    let frame: 0 | 1 = 0;
    if (a.pose === "walk") frame = Math.sin(this.tSec * 9 + off) > 0 ? 1 : 0;
    else if (a.pose === "graze") frame = Math.sin(this.tSec * 3 + off) > 0.2 ? 1 : 0; // head-down peck / grazing dip
    else if (a.pose === "idle") frame = Math.sin(this.tSec * 1.4 + off) > 0.82 ? 1 : 0; // occasional tail flick
    if (a.type === "goat") {
      const pose = a.pose === "sleep" ? "sleep" : a.pose === "graze" ? "graze" : "stand";
      rr.drawSprite(Sprites.goat(a.flip, pose, frame), a.x, a.z, -bob);
    } else {
      rr.drawSprite(Sprites.chicken(a.flip, a.pose === "sleep", frame), a.x, a.z, -bob);
    }
  }

  /** 💤 over sleeping animals (drawn in the effects overlay). */
  drawZzz(rr: Renderer2D): void {
    const ctx = rr.ctx;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "9px system-ui, sans-serif";
    for (const a of this.actors) {
      if (!a.zzzVisible) continue;
      const px = rr.sx(a.x) + 8;
      const py = rr.sy(a.z) - (a.type === "goat" ? 26 : 14) + Math.sin(this.tSec * 1.5) * 2;
      ctx.fillText("💤", px, py);
    }
  }
}
