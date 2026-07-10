import * as THREE from "three";
import { sampleHeight } from "./terrain";
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
import { loadModel, instantiateSized, findClip, modelUrl, type LoadedModel } from "./gltfAssets";

// ---------------------------------------------------------------------------
// Animal meshes + pasture roaming (husbandry rework). Animals now live in a
// FENCED PASTURE enclosing the barn and follow a shared DAY/NIGHT routine
// (derived from the shared clock in main.ts, passed in as `phase`):
//   day/dawn : graze — wander the open pasture, occasional head-down graze;
//              may wander into the barn & back when the door is open.
//   dusk     : walk to the barn (inside if the door is open, else settle just
//              outside the closed door — a gentle wait, never a penalty).
//   night    : sleep at the barn (lying/hunkered pose + drifting 💤).
// Containment (farm/pasture.ts containAnimal) keeps them inside the fence and
// only lets them cross the barn's south wall through the OPEN door. Positions
// stay COSMETIC/LOCAL (never synced); wander is seeded per animal id so every
// device looks similar. Both the GLB and procedural fallback meshes support
// the walk / idle / graze / sleep poses.
// ---------------------------------------------------------------------------

export type Pose = "walk" | "idle" | "graze" | "sleep";

function lam(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export type AnimalMeshKind = "proc-goat" | "proc-chicken" | "glb-goat" | "glb-chicken";

export interface AnimalMesh {
  group: THREE.Group;
  kind: AnimalMeshKind;
  mixer?: THREE.AnimationMixer;
  boneSample?(): { x: number; y: number; z: number } | null;
  update(dt: number, tSec: number, moving: boolean, pose: Pose): void;
}

function buildGoat(color: number): AnimalMesh {
  const g = new THREE.Group();
  const bodyY = 0.62;
  const body = box(0.95, 0.62, 0.42, color);
  body.position.set(0, bodyY, 0);
  g.add(body);

  const headGroup = new THREE.Group();
  const headBase = new THREE.Vector3(0.52, bodyY + 0.18, 0);
  headGroup.position.copy(headBase);
  const head = box(0.32, 0.32, 0.28, color);
  headGroup.add(head);
  const snout = box(0.16, 0.14, 0.16, 0xf0e6cf);
  snout.position.set(0.22, -0.06, 0);
  headGroup.add(snout);
  for (const s of [-1, 1]) {
    const ear = box(0.05, 0.16, 0.2, color);
    ear.position.set(0.06, 0.12, s * 0.2);
    ear.rotation.z = s * 0.5;
    headGroup.add(ear);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 5), lam(0xd8cba0));
    horn.position.set(0.08, 0.22, s * 0.08);
    horn.rotation.x = s * 0.15;
    headGroup.add(horn);
  }
  g.add(headGroup);

  const tail = box(0.08, 0.14, 0.08, color);
  tail.position.set(-0.5, bodyY + 0.2, 0);
  tail.rotation.x = -0.4;
  g.add(tail);

  const legs: THREE.Mesh[] = [];
  for (const [lx, lz] of [[0.32, 0.16], [0.32, -0.16], [-0.32, 0.16], [-0.32, -0.16]] as [number, number][]) {
    const leg = box(0.12, 0.5, 0.12, 0x3b342b);
    leg.position.set(lx, bodyY - 0.56, lz);
    g.add(leg);
    legs.push(leg);
  }

  return {
    group: g,
    kind: "proc-goat",
    update(_dt, tSec, moving, pose) {
      if (pose === "sleep") {
        const breathe = Math.sin(tSec * 1.4) * 0.02;
        body.position.y = bodyY - 0.34 + breathe;
        headGroup.position.set(headBase.x - 0.05, bodyY - 0.28, 0.16); // head tucked down + aside
        headGroup.rotation.z = 0.5;
        legs.forEach((leg) => (leg.rotation.x = 1.35)); // tucked flat
        g.rotation.z = 0.08;
        return;
      }
      g.rotation.z = 0;
      headGroup.rotation.z = 0;
      if (pose === "graze") {
        body.position.y = bodyY - 0.04;
        headGroup.position.set(headBase.x + 0.06, bodyY - 0.34, 0);
        headGroup.rotation.z = 0; headGroup.rotation.x = 0;
        // nod while grazing
        headGroup.position.y += Math.sin(tSec * 3) * 0.03;
        legs.forEach((leg) => (leg.rotation.x *= 0.85));
        return;
      }
      const bob = Math.sin(tSec * (moving ? 7 : 1.6)) * (moving ? 0.05 : 0.02);
      body.position.y = bodyY + bob;
      headGroup.position.set(headBase.x, bodyY + 0.18 + bob * 0.6, 0);
      if (moving) {
        legs.forEach((leg, i) => {
          leg.rotation.x = Math.sin(tSec * 7 + (i % 2 === 0 ? 0 : Math.PI)) * 0.5;
        });
      } else {
        legs.forEach((leg) => (leg.rotation.x *= 0.85));
      }
    },
  };
}

function buildChicken(color: number): AnimalMesh {
  const g = new THREE.Group();
  const bodyY = 0.26;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), lam(color));
  body.scale.set(1.15, 1, 1);
  body.position.set(0, bodyY, 0);
  body.castShadow = true;
  g.add(body);

  const headGroup = new THREE.Group();
  const headBase = new THREE.Vector3(0.26, bodyY + 0.16, 0);
  headGroup.position.copy(headBase);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), lam(color));
  headGroup.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 5), lam(0xe0a23a));
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.13, 0, 0);
  headGroup.add(beak);
  const comb = box(0.03, 0.08, 0.1, 0xc23b3b);
  comb.position.set(0, 0.11, 0);
  headGroup.add(comb);
  g.add(headGroup);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 6), lam(color));
  tail.position.set(-0.24, bodyY + 0.16, 0);
  tail.rotation.z = -Math.PI / 2.3;
  g.add(tail);

  const legs: THREE.Mesh[] = [];
  for (const lz of [-0.06, 0.06]) {
    const leg = box(0.03, 0.16, 0.03, 0xe0a23a);
    leg.position.set(0, bodyY - 0.2, lz);
    g.add(leg);
    legs.push(leg);
  }

  return {
    group: g,
    kind: "proc-chicken",
    update(_dt, tSec, moving, pose) {
      if (pose === "sleep") {
        body.position.y = bodyY - 0.12 + Math.sin(tSec * 1.8) * 0.015; // hunkered
        headGroup.position.set(headBase.x - 0.12, bodyY - 0.02, 0); // head drawn in
        legs.forEach((leg) => (leg.rotation.x = 0));
        return;
      }
      if (pose === "graze") {
        // pecking at the ground
        body.position.y = bodyY;
        const peck = Math.abs(Math.sin(tSec * 6));
        headGroup.position.set(headBase.x + 0.05, bodyY + 0.16 - peck * 0.22, 0);
        return;
      }
      const bob = Math.sin(tSec * (moving ? 9 : 2.4)) * (moving ? 0.045 : 0.02);
      body.position.y = bodyY + Math.abs(bob);
      headGroup.position.set(headBase.x, bodyY + 0.16 + bob * 1.3, 0);
      if (moving) {
        legs.forEach((leg, i) => {
          leg.rotation.x = Math.sin(tSec * 10 + (i % 2 === 0 ? 0 : Math.PI)) * 0.6;
        });
      }
    },
  };
}

// ---- Quaternius GLB animal meshes -------------------------------------------
const GOAT_SIZE = 1.25;
const CHICKEN_SIZE = 0.62;
const GOAT_YAW = Math.PI / 2;
const CHICKEN_YAW = Math.PI;

const animalTemplates = new Map<AnimalType, LoadedModel | null>();
let animalsPreloaded = false;

export function preloadAnimalModels(): Promise<void> {
  return Promise.all([
    loadModel(modelUrl("animals/goat.glb")).then((m) => animalTemplates.set("goat", m)),
    loadModel(modelUrl("animals/chicken.glb")).then((m) => animalTemplates.set("chicken", m)),
  ]).then(() => {
    animalsPreloaded = true;
  });
}

export function animalModelsReady(): boolean {
  return animalsPreloaded;
}

function firstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let sk: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!sk && (o as THREE.SkinnedMesh).isSkinnedMesh) sk = o as THREE.SkinnedMesh;
  });
  return sk;
}

function buildGlbChicken(tpl: LoadedModel): AnimalMesh {
  const inst = instantiateSized(tpl, CHICKEN_SIZE);
  const inner = new THREE.Group();
  inst.root.rotation.y = CHICKEN_YAW;
  inner.add(inst.root);
  const group = new THREE.Group();
  group.add(inner);

  const mixer = inst.mixer;
  const idle = findClip(inst.clips, "idle") ?? inst.clips[0] ?? null;
  const walk = findClip(inst.clips, "walk", "run") ?? idle;
  const idleAct = mixer && idle ? mixer.clipAction(idle) : null;
  const walkAct = mixer && walk ? mixer.clipAction(walk) : null;
  idleAct?.play();
  walkAct?.play();
  if (idleAct) idleAct.weight = 1;
  if (walkAct) walkAct.weight = 0;

  const sk = firstSkinnedMesh(inst.root);
  const _v = new THREE.Vector3();

  return {
    group,
    kind: "glb-chicken",
    mixer,
    boneSample() {
      const bone = sk?.skeleton?.bones?.[Math.min(2, (sk.skeleton.bones.length || 1) - 1)];
      if (!bone) return null;
      bone.getWorldPosition(_v);
      return { x: _v.x, y: _v.y, z: _v.z };
    },
    update(dt, tSec, moving, pose) {
      if (idleAct && walkAct) {
        const target = moving && pose !== "sleep" ? 1 : 0;
        walkAct.weight += (target - walkAct.weight) * Math.min(1, dt * 8);
        idleAct.weight = 1 - walkAct.weight;
      }
      // hunker down + tuck for sleep; slight peck-dip for graze
      const sleepY = pose === "sleep" ? -0.1 + Math.sin(tSec * 1.8) * 0.01 : 0;
      const grazeY = pose === "graze" ? -0.04 : 0;
      inner.position.y = sleepY + grazeY;
      inner.scale.setScalar(pose === "sleep" ? 0.9 : 1);
      mixer?.update(dt);
    },
  };
}

function buildGlbGoat(tpl: LoadedModel): AnimalMesh {
  const inst = instantiateSized(tpl, GOAT_SIZE);
  const inner = new THREE.Group();
  inst.root.rotation.y = GOAT_YAW;
  inner.add(inst.root);
  const group = new THREE.Group();
  group.add(inner);
  return {
    group,
    kind: "glb-goat",
    update(_dt, tSec, moving, pose) {
      if (pose === "sleep") {
        inner.position.y = -0.34 + Math.sin(tSec * 1.4) * 0.015; // lying down
        inner.rotation.z = 0.12;
        inner.rotation.x = 0;
        return;
      }
      inner.rotation.z = 0;
      if (pose === "graze") {
        inner.position.y = -0.05;
        inner.rotation.x = 0.18; // nose to the ground
        return;
      }
      inner.rotation.x = 0;
      const hop = moving ? Math.abs(Math.sin(tSec * 6)) * 0.09 : 0;
      const bob = Math.sin(tSec * (moving ? 6 : 1.6)) * (moving ? 0.02 : 0.015);
      inner.position.y = hop + bob;
      inner.rotation.z = moving ? Math.sin(tSec * 6) * 0.05 : 0;
    },
  };
}

export function buildAnimalMesh(type: AnimalType): AnimalMesh {
  const tpl = animalTemplates.get(type);
  if (tpl) return type === "goat" ? buildGlbGoat(tpl) : buildGlbChicken(tpl);
  return type === "goat"
    ? buildGoat(Math.random() < 0.5 ? 0xcabb92 : 0x8a6a45)
    : buildChicken(Math.random() < 0.5 ? 0xf4ecd8 : 0xb5754a);
}

// ---- 💤 sleep sprite --------------------------------------------------------
let zzzTex: THREE.Texture | null = null;
function zzzTexture(): THREE.Texture {
  if (zzzTex) return zzzTex;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d")!;
  ctx.font = "44px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("💤", 32, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  zzzTex = t;
  return t;
}

// ---- wander ------------------------------------------------------------------

const WANDER_SPEED = 0.55; // m/s, gentle graze wander
const HOME_SPEED = 0.85; // m/s, purposeful walk to the barn at dusk
const IDLE_MIN = 2.5, IDLE_MAX = 6;
const WALK_MIN = 1.5, WALK_MAX = 3.5;
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

export interface Actor {
  id: string;
  type: AnimalType;
  mesh: AnimalMesh;
  x: number;
  z: number;
  zzz: THREE.Sprite;
}

export class AnimalField {
  group = new THREE.Group();
  actors: Actor[] = [];
  private rngs = new Map<string, () => number>();
  private state = new Map<string, RuntimeState>();
  private tSec = 0;

  constructor(herdSpecs: { id: string; type: AnimalType }[]) {
    for (const spec of herdSpecs) {
      const rng = mulberry32(hashSeed(spec.id) ^ 0x9e3779b9);
      this.rngs.set(spec.id, rng);
      const home = grazeSpot(rng);
      const mesh = buildAnimalMesh(spec.type);
      mesh.group.position.set(home.x, sampleHeight(home.x, home.z), home.z);
      this.group.add(mesh.group);
      const zzz = new THREE.Sprite(new THREE.SpriteMaterial({ map: zzzTexture(), transparent: true, depthWrite: false }));
      zzz.scale.set(0.7, 0.7, 0.7);
      zzz.visible = false;
      this.group.add(zzz);
      const actor: Actor = { id: spec.id, type: spec.type, mesh, x: home.x, z: home.z, zzz };
      this.actors.push(actor);
      this.state.set(spec.id, { mode: "idle", until: 0, tx: home.x, tz: home.z, sleeping: false, inside: false, wakeUntil: 0 });
    }
  }

  actorAt(id: string): Actor | undefined {
    return this.actors.find((a) => a.id === id);
  }

  usesModels(): boolean {
    return this.actors.some((a) => a.mesh.kind.startsWith("glb"));
  }

  boneSample(id: string): { x: number; y: number; z: number } | null {
    const a = this.actorAt(id);
    return a && a.mesh.boneSample ? a.mesh.boneSample() : null;
  }

  /** True when this actor is currently standing inside the barn interior. */
  isInside(id: string): boolean {
    return this.state.get(id)?.inside ?? false;
  }
  /** True when this actor is asleep (night, settled at the barn). */
  isSleeping(id: string): boolean {
    return this.state.get(id)?.sleeping ?? false;
  }
  anyInsideBarn(): boolean {
    return this.actors.some((a) => this.state.get(a.id)?.inside);
  }
  allInsideBarn(): boolean {
    return this.actors.every((a) => this.state.get(a.id)?.inside);
  }
  /** Nudge an animal awake briefly (an interaction stirs a sleeping animal). */
  wake(id: string): void {
    const st = this.state.get(id);
    if (st) st.wakeUntil = this.tSec + 3.5;
  }

  swapToModels(): void {
    for (const actor of this.actors) {
      const nm = buildAnimalMesh(actor.type);
      if (!nm.kind.startsWith("glb")) continue;
      this.group.remove(actor.mesh.group);
      actor.mesh = nm;
      nm.group.position.set(actor.x, sampleHeight(actor.x, actor.z), actor.z);
      this.group.add(nm.group);
    }
  }

  nearestFacing(px: number, pz: number, heading: number, maxDist: number, maxAngleRad: number): Actor | null {
    const fwdX = Math.sin(heading), fwdZ = Math.cos(heading);
    let best: Actor | null = null;
    let bestDist = Infinity;
    for (const a of this.actors) {
      const dx = a.x - px, dz = a.z - pz;
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

  /** Advance the herd one frame. `phase` (from the shared clock) drives the
   * day/night routine; `doorOpen` gates barn access (the only fence passage). */
  update(dt: number, phase: DayPhase, doorOpen: boolean): void {
    this.tSec += dt;
    for (const actor of this.actors) {
      const st = this.state.get(actor.id)!;
      const rng = this.rngs.get(actor.id)!;

      const homeMode = phase === "dusk" || phase === "night";
      const stuckInside = (phase === "day" || phase === "dawn") && st.inside && !doorOpen;

      let finalTarget: { x: number; z: number };
      let speed = WANDER_SPEED;
      let arriving = false; // fixed-destination behaviors settle on arrival

      if (homeMode) {
        // door open → sleep inside; door shut → animals already inside sleep
        // inside (they're home), animals outside settle by the shut door.
        finalTarget = doorOpen || st.inside ? barnSleepSpot(actor.id) : doorWaitSpot(actor.id);
        speed = HOME_SPEED;
        arriving = true;
      } else if (stuckInside) {
        // door shut while inside during the day → mill by the door, wait to be let out
        finalTarget = { x: doorWaitSpot(actor.id).x, z: barnSleepSpot(actor.id).z };
        arriving = true;
      } else {
        // free graze (day/dawn): roam/idle waypoint machine
        if (this.tSec >= st.until) {
          if (st.mode === "idle") {
            let picked = grazeSpot(rng);
            if (doorOpen && rng() < 0.14) picked = barnSleepSpot(actor.id); // wander into the barn & back
            st.mode = "roam";
            st.tx = picked.x; st.tz = picked.z;
            st.until = this.tSec + WALK_MIN + rng() * (WALK_MAX - WALK_MIN);
          } else {
            st.mode = "idle";
            st.until = this.tSec + IDLE_MIN + rng() * (IDLE_MAX - IDLE_MIN);
          }
        }
        finalTarget = { x: st.tx, z: st.tz };
      }

      // funnel through the door if the final target is on the far side of a wall
      const target = funnelTarget(actor.x, actor.z, finalTarget, doorOpen);

      // steer toward target (arrival judged against the FINAL target)
      let moving = false;
      const dx = target.x - actor.x, dz = target.z - actor.z;
      const dist = Math.hypot(dx, dz);
      const distFinal = Math.hypot(finalTarget.x - actor.x, finalTarget.z - actor.z);
      const wantMove = arriving ? distFinal > 0.35 : st.mode === "roam" && Math.hypot(finalTarget.x - actor.x, finalTarget.z - actor.z) > 0.05;
      if (wantMove) {
        const step = Math.min(dist, speed * dt);
        const nx = actor.x + (dx / dist) * step;
        const nz = actor.z + (dz / dist) * step;
        const c = containAnimal(nx, nz, ANIMAL_R, doorOpen);
        actor.x = c.x; actor.z = c.z;
        moving = true;
        actor.mesh.group.rotation.y = Math.atan2(dx, dz);
      } else {
        // hold position but still respect containment (e.g. door just shut)
        const c = containAnimal(actor.x, actor.z, ANIMAL_R, doorOpen);
        actor.x = c.x; actor.z = c.z;
      }

      st.inside = insideBarn(actor.x, actor.z);

      // pose selection
      let pose: Pose = moving ? "walk" : "idle";
      const settledHome = homeMode && !moving; // arrived at (or waiting near) the barn
      const awake = st.wakeUntil > this.tSec;
      if (phase === "night" && settledHome && !awake) {
        pose = "sleep";
        st.sleeping = true;
      } else {
        st.sleeping = false;
        if (!moving && !homeMode && !stuckInside) pose = "graze"; // idle graze in the pasture
      }

      const y = sampleHeight(actor.x, actor.z);
      actor.mesh.group.position.set(actor.x, y, actor.z);
      actor.mesh.update(dt, this.tSec + hashSeed(actor.id) * 1e-9, moving, pose);

      // 💤 sprite drifts above sleeping animals
      actor.zzz.visible = st.sleeping;
      if (st.sleeping) {
        const lift = actor.type === "goat" ? 1.1 : 0.7;
        actor.zzz.position.set(actor.x + 0.2, y + lift + 0.15 + Math.sin(this.tSec * 1.5) * 0.05, actor.z);
      }
    }
  }
}
