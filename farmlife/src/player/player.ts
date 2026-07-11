import * as THREE from "three";
import { sampleHeight } from "../world/terrain";
import { loadModel, instantiateSized, findClip, modelUrl, type LoadedModel } from "../world/gltfAssets";

// ---------------------------------------------------------------------------
// The player farmer (Stage 2 art swap). Two interchangeable implementations
// behind ONE stable `Farmer` interface:
//
//   • RIGGED (default when the GLB is available): "Sunny"
//     (public/models/character/sunny.glb) — the user's Meshy-generated, Blender-
//     colored, Meshy-rigged chibi girl (24-bone Mixamo-style rig, one SkinnedMesh
//     with 6 flat FL_* material slots, embedded Idle/Walk/Run/HoeChop clips). An
//     AnimationMixer crossfades Idle/Walk/Run by speed (the Stage-1 chicken
//     pattern, scaled up; walk/run timeScaled to plant the feet at the game's fast
//     move speeds). The HOE action plays a SUBRANGE of the long HoeChop clip
//     (raise→slam) fitted into the input-block window; every OTHER tool gesture
//     (water POUR, refill DIP, plant scatter, harvest scoop + HOLD-UP, pet, the
//     JUMP tuck) is procedural bone animation layered ON TOP of the mixer (Sunny
//     ships no generic Interact clip).
//
//   • PROCEDURAL (fallback when the GLB fails to load — offline/404, and the
//     boot state before the async load resolves): the original chunky straw-hat
//     farmer. Never a blank avatar.
//
// THE FROZEN-ARM LESSON (Chef Bucky): procedural overlays are applied as
// ADDITIVE QUATERNION DELTAS multiplied onto each bone AFTER mixer.update, and
// recomputed fresh every frame. We NEVER write bone.rotation.x directly — that
// rebuilds the quaternion from a stale euler and silently freezes the arm.
// verify-p9 samples the arm bone's quaternion mid-animation to prove it moves.
// ---------------------------------------------------------------------------

function m(color: string, opts: THREE.MeshLambertMaterialParameters = {}) {
  return new THREE.MeshLambertMaterial({ color: new THREE.Color(color), ...opts });
}

export type ToolAnimKind = "hoe" | "water" | "plant" | "harvest" | "refill" | "pet";

/** Duration each use-animation blocks input (seconds). Tuned so they read. */
export const ANIM_DUR: Record<ToolAnimKind, number> = {
  hoe: 0.55,
  water: 0.6,
  plant: 0.5,
  harvest: 0.62,
  refill: 0.55,
  pet: 0.5, // P4: gentle crouch + reach for feed/pet/collect on an animal
};

export interface Farmer {
  root: THREE.Group;
  /** Per-frame gait/idle + active tool-anim tick. airborne = jump pose. */
  update(dt: number, speed: number, maxSpeed: number, airborne?: boolean): void;
  /** Attach (or detach with null) a held-tool object under the right hand. */
  setHeldTool(obj: THREE.Object3D | null): void;
  /** Start a tool-use animation; returns its duration (s). Blocks input while busy. */
  playToolAnim(kind: ToolAnimKind): number;
  /** True while a tool-use animation is playing (movement + action input ignored). */
  isBusy(): boolean;
  /** Progress 0..1 of the active tool-use animation, or -1 when idle — the
   * framerate-independent input-block-timing probe. */
  actionProgress(): number;
  /** Briefly show a harvested produce mesh raised overhead (the HM hold-up beat). */
  showHarvestProduce(mesh: THREE.Object3D, dur: number): void;
  /** Trigger the landing squash (called by main on touchdown). */
  land(): void;
  /** True during the brief post-land squash window (test/feel hook). */
  squashActive(): boolean;
  /** Monotonic count of landings (robust test hook). */
  landCount(): number;
  /** Right-arm shoulder pivot — tests sample its quaternion. */
  armPivot: THREE.Object3D;
  /** Right-hand anchor — tools parent here; tests read its world position. */
  handAnchor: THREE.Object3D;
  /** True once the rigged GLB model is driving the avatar (else procedural). */
  usesModel(): boolean;
  /** Swap the procedural body for the rigged GLB in place (idempotent). No-op if
   * already rigged. Re-attaches the currently held tool to the new hand. */
  upgradeToModel(tpl: LoadedModel): void;
  /** Sample a named skeleton bone's quaternion (rigged only; null otherwise) —
   * verify-p9's mixer-runs check. */
  boneQuat(name: string): [number, number, number, number] | null;
  /** Current locomotion crossfade weights (rigged only; null for procedural) —
   * verify-p9's walk/run-by-speed check. */
  locoWeights(): { idle: number; walk: number; run: number } | null;
  /** Names of every skeleton bone (rigged only; [] for procedural) — diagnostic. */
  boneNames(): string[];
}

// ---- shared math ------------------------------------------------------------
function ease(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}
function lerpTo(cur: number, target: number, k: number): number {
  return cur + (target - cur) * k;
}
function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function smooth01(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export interface FarmerOptions {
  /** Shirt/outfit tint. Undefined → the LOCAL player (Sunny's natural blue-
   * overalls / yellow-sleeves palette). Defined → a REMOTE avatar (P3 presence):
   * her FL_Overall + FL_Shirt materials are multiplied toward this deterministic
   * per-player colour so players read as distinct (skin/hair stay natural). The
   * procedural fallback uses it as the shirt colour. */
  shirt?: string;
}

// ---------------------------------------------------------------------------
// AvatarImpl — the swappable guts. The Farmer wrapper delegates to the current
// one; on upgrade the old group is removed and the new one added under the same
// wrapper root, so every external reference (player.root, and the getters for
// armPivot/handAnchor) stays valid.
// ---------------------------------------------------------------------------
interface AvatarImpl {
  group: THREE.Group;
  usesModel: boolean;
  update(dt: number, speed: number, maxSpeed: number, airborne: boolean): void;
  setHeldTool(obj: THREE.Object3D | null): void;
  playToolAnim(kind: ToolAnimKind): number;
  isBusy(): boolean;
  showHarvestProduce(mesh: THREE.Object3D, dur: number): void;
  land(): void;
  squashActive(): boolean;
  actionProgress(): number;
  armPivot: THREE.Object3D;
  handAnchor: THREE.Object3D;
  boneQuat(name: string): [number, number, number, number] | null;
  locoWeights(): { idle: number; walk: number; run: number } | null;
  boneNames(): string[];
  dispose(): void;
}

// ===========================================================================
// PROCEDURAL farmer (fallback) — the original chunky straw-hat body.
// ===========================================================================
function buildProceduralImpl(opts: FarmerOptions): AvatarImpl {
  const group = new THREE.Group();
  group.name = "farmer-proc";

  const SKIN = "#e8b48c";
  const HAIR = "#6b4423";
  const SHIRT = opts.shirt ?? "#d24b4b"; // warm red (local); remotes get a tint
  const DENIM = "#3f5e8c";
  const DENIM_DK = "#33507a";
  const BOOT = "#5a3a22";
  const STRAW = "#e8c56a";
  const STRAWBAND = "#8a5a2b";

  const bob = new THREE.Group();
  group.add(bob);

  const legGeo = new THREE.BoxGeometry(0.19, 0.5, 0.2);
  const bootGeo = new THREE.BoxGeometry(0.22, 0.16, 0.3);
  interface Leg { pivot: THREE.Group }
  const legs: Leg[] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.15, 0.6, 0);
    const leg = new THREE.Mesh(legGeo, m(DENIM_DK));
    leg.position.y = -0.28;
    leg.castShadow = true;
    pivot.add(leg);
    const boot = new THREE.Mesh(bootGeo, m(BOOT));
    boot.position.set(0, -0.55, 0.05);
    boot.castShadow = true;
    pivot.add(boot);
    bob.add(pivot);
    legs.push({ pivot });
  }

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.32), m(DENIM));
  hips.position.y = 0.78;
  hips.castShadow = true;
  bob.add(hips);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.42, 0.34), m(SHIRT));
  chest.position.y = 1.14;
  chest.castShadow = true;
  bob.add(chest);
  const bib = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.36), m(DENIM));
  bib.position.set(0, 1.06, 0.01);
  bob.add(bib);
  for (const s of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.06), m(DENIM_DK));
    strap.position.set(s * 0.14, 1.24, 0.17);
    bob.add(strap);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.5, 0);
  bob.add(head);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.12, 8), m(SKIN));
  neck.position.y = -0.12;
  head.add(neck);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), m(SKIN));
  skull.position.y = 0.08;
  skull.castShadow = true;
  head.add(skull);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.36), m(HAIR));
  hair.position.y = 0.22;
  head.add(hair);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), m("#241608"));
    eye.position.set(s * 0.09, 0.08, 0.18);
    head.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), m("#d99f78"));
  nose.position.set(0, 0.01, 0.19);
  head.add(nose);
  const smile = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), m("#a8593f"));
  smile.position.set(0, -0.07, 0.18);
  head.add(smile);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 14), m(STRAW));
  brim.position.y = 0.27;
  brim.castShadow = true;
  head.add(brim);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.21, 0.2, 12), m(STRAW));
  crown.position.y = 0.37;
  crown.castShadow = true;
  head.add(crown);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.215, 0.06, 12), m(STRAWBAND));
  band.position.y = 0.3;
  head.add(band);

  function buildArm(side: number) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.31, 1.3, 0);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.14), m(SHIRT));
    upper.position.y = -0.17;
    upper.castShadow = true;
    shoulder.add(upper);
    const fore = new THREE.Group();
    fore.position.y = -0.34;
    shoulder.add(fore);
    const foreArm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.32, 0.12), m(SKIN));
    foreArm.position.y = -0.16;
    foreArm.castShadow = true;
    fore.add(foreArm);
    const hand = new THREE.Group();
    hand.position.set(0, -0.34, 0.02);
    fore.add(hand);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), m(SKIN));
    hand.add(fist);
    return { shoulder, fore, hand };
  }
  const armL = buildArm(-1);
  const armR = buildArm(1);
  armL.shoulder.name = "armL";
  armR.shoulder.name = "armR";
  bob.add(armL.shoulder, armR.shoulder);

  const produceAnchor = new THREE.Group();
  produceAnchor.position.set(0, 1.95, 0.1);
  bob.add(produceAnchor);

  let t = 0;
  let carryPose = false;
  let action: { kind: ToolAnimKind; t: number; dur: number } | null = null;
  let squashT = 0;
  let produce: { mesh: THREE.Object3D; t: number; dur: number } | null = null;

  const CARRY = { shoulderX: -0.6, foreX: -0.85 };

  function driveLegs(dt: number, speed: number, gait: number, airborne: boolean): void {
    if (airborne) {
      for (const l of legs) l.pivot.rotation.x = lerpTo(l.pivot.rotation.x, -0.5, Math.min(1, dt * 10));
      return;
    }
    const moving = speed > 0.05;
    if (moving) {
      const freq = 6 + gait * 7;
      const amp = 0.45 + gait * 0.35;
      const phase = t * freq;
      legs[0].pivot.rotation.x = Math.sin(phase) * amp;
      legs[1].pivot.rotation.x = Math.sin(phase + Math.PI) * amp;
    } else {
      for (const l of legs) l.pivot.rotation.x = lerpTo(l.pivot.rotation.x, 0, Math.min(1, dt * 8));
    }
  }

  function setArm(arm: typeof armR, sx: number, fx: number, sz = 0): void {
    arm.shoulder.rotation.x = sx;
    arm.shoulder.rotation.z = sz;
    arm.fore.rotation.x = fx;
  }

  function driveIdleArms(dt: number, speed: number, gait: number): void {
    const moving = speed > 0.05;
    const k = Math.min(1, dt * 10);
    if (carryPose) {
      armR.shoulder.rotation.x = lerpTo(armR.shoulder.rotation.x, CARRY.shoulderX, k);
      armR.shoulder.rotation.z = lerpTo(armR.shoulder.rotation.z, 0, k);
      armR.fore.rotation.x = lerpTo(armR.fore.rotation.x, CARRY.foreX, k);
      const swing = moving ? Math.sin(t * (6 + gait * 7) + Math.PI) * (0.4 + gait * 0.4) : Math.sin(t * 1.6) * 0.05;
      armL.shoulder.rotation.x = lerpTo(armL.shoulder.rotation.x, swing, k);
      armL.shoulder.rotation.z = lerpTo(armL.shoulder.rotation.z, -0.08, k);
      armL.fore.rotation.x = lerpTo(armL.fore.rotation.x, -0.25, k);
    } else {
      const swingR = moving ? Math.sin(t * (6 + gait * 7)) * (0.45 + gait * 0.4) : Math.sin(t * 1.6) * 0.05;
      const swingL = moving ? Math.sin(t * (6 + gait * 7) + Math.PI) * (0.45 + gait * 0.4) : Math.sin(t * 1.6 + Math.PI) * 0.05;
      setArm(armR, lerpTo(armR.shoulder.rotation.x, swingR, k), lerpTo(armR.fore.rotation.x, -0.15, k), lerpTo(armR.shoulder.rotation.z, 0.08, k));
      setArm(armL, lerpTo(armL.shoulder.rotation.x, swingL, k), lerpTo(armL.fore.rotation.x, -0.15, k), lerpTo(armL.shoulder.rotation.z, -0.08, k));
    }
  }

  function driveActionArms(kind: ToolAnimKind, p: number): void {
    const e = ease(p);
    let lean = 0;
    if (kind === "hoe") {
      if (p < 0.4) {
        const q = ease(p / 0.4);
        setArm(armR, -0.6 - q * 1.7, -0.85 + q * 0.5);
        lean = -0.12 * q;
      } else if (p < 0.64) {
        const q = ease((p - 0.4) / 0.24);
        setArm(armR, -2.3 + q * 3.0, -0.35 + q * 0.3);
        lean = -0.12 + q * 0.42;
      } else {
        const q = ease((p - 0.64) / 0.36);
        setArm(armR, 0.7 - q * 1.3, -0.05 - q * 0.8);
        lean = 0.3 - q * 0.3;
      }
      armL.shoulder.rotation.x = lerpTo(armL.shoulder.rotation.x, -0.3, 0.3);
    } else if (kind === "water") {
      if (p < 0.35) {
        const q = ease(p / 0.35);
        setArm(armR, -0.6 - q * 0.5, -0.85 + q * 0.45);
      } else if (p < 0.8) {
        const q = Math.sin(((p - 0.35) / 0.45) * Math.PI);
        setArm(armR, -1.1, -0.4 + q * 0.55);
        lean = 0.06 * q;
      } else {
        const q = ease((p - 0.8) / 0.2);
        setArm(armR, -1.1 + q * 0.5, 0.15 - q * 1.0);
      }
    } else if (kind === "plant") {
      lean = 0.35 * Math.sin(Math.min(1, p / 0.85) * Math.PI);
      if (p < 0.5) {
        const q = ease(p / 0.5);
        setArm(armR, -0.6 + q * 1.1, -0.85 + q * 0.55);
      } else {
        const q = Math.sin(((p - 0.5) / 0.5) * Math.PI * 2);
        setArm(armR, 0.5 + q * 0.25, -0.3 + q * 0.2);
      }
      for (const l of legs) l.pivot.rotation.x = lerpTo(l.pivot.rotation.x, 0.2, 0.2);
    } else if (kind === "harvest") {
      if (p < 0.5) {
        const q = ease(p / 0.5);
        setArm(armR, -0.6 + q * 1.3, -0.85 + q * 0.6);
        lean = 0.3 * q;
      } else {
        const q = ease((p - 0.5) / 0.5);
        setArm(armR, 0.7 - q * 3.0, -0.25 - q * 0.5);
        lean = 0.3 - q * 0.42;
      }
      armL.shoulder.rotation.x = lerpTo(armL.shoulder.rotation.x, -0.2, 0.25);
    } else if (kind === "refill") {
      const dip = Math.sin(Math.min(1, p / 0.9) * Math.PI);
      for (const l of legs) l.pivot.rotation.x = lerpTo(l.pivot.rotation.x, 0.5 * dip, 0.3);
      bob.position.y -= 0.18 * dip;
      lean = 0.28 * dip;
      setArm(armR, -0.6 + 1.0 * dip, -0.85 + 0.5 * dip);
    } else if (kind === "pet") {
      const dip = Math.sin(Math.min(1, p / 0.9) * Math.PI);
      for (const l of legs) l.pivot.rotation.x = lerpTo(l.pivot.rotation.x, 0.35 * dip, 0.3);
      lean = 0.22 * dip;
      setArm(armR, -0.4 + 0.5 * dip, -0.6 + 0.35 * dip);
      armL.shoulder.rotation.x = lerpTo(armL.shoulder.rotation.x, -0.4 * dip, 0.3);
    }
    void e;
    bob.rotation.x = lean;
  }

  return {
    group,
    usesModel: false,
    armPivot: armR.shoulder,
    handAnchor: armR.hand,
    boneQuat: () => null,
    locoWeights: () => null,
    boneNames: () => [],
    update(dt, speed, maxSpeed, airborne) {
      t += dt;
      const gait = Math.min(1, speed / (maxSpeed || 1));
      const moving = speed > 0.05;
      driveLegs(dt, speed, gait, airborne);
      bob.position.y = moving ? Math.abs(Math.sin(t * (6 + gait * 7))) * 0.05 * gait : Math.sin(t * 1.8) * 0.015;
      bob.rotation.x = moving ? -0.08 * gait : lerpTo(bob.rotation.x, 0, Math.min(1, dt * 6));
      bob.rotation.z = moving ? 0 : Math.sin(t * 1.2) * 0.01;
      if (action) {
        action.t += dt;
        const p = Math.min(1, action.t / action.dur);
        driveActionArms(action.kind, p);
        if (action.t >= action.dur) action = null;
      } else {
        driveIdleArms(dt, speed, gait);
      }
      head.rotation.z = Math.sin(t * (moving ? 6 : 1.5)) * (moving ? 0.02 : 0.015);
      if (squashT > 0) {
        squashT = Math.max(0, squashT - dt / 0.2);
        const c = squashT;
        bob.scale.y = 1 - 0.24 * c;
        bob.scale.x = bob.scale.z = 1 + 0.14 * c;
      } else {
        bob.scale.set(1, 1, 1);
      }
      if (produce) {
        produce.t += dt;
        const q = Math.min(1, produce.t / produce.dur);
        const s = 1.6 * Math.sin(Math.min(1, q * 2) * Math.PI * 0.5);
        produce.mesh.scale.setScalar(Math.max(0.01, s));
        if (produce.t >= produce.dur) {
          produceAnchor.remove(produce.mesh);
          produce = null;
        }
      }
    },
    setHeldTool(obj) {
      for (let i = armR.hand.children.length - 1; i >= 0; i--) {
        const c = armR.hand.children[i];
        if (c.name.startsWith("tool-")) armR.hand.remove(c);
      }
      carryPose = !!obj;
      if (obj) armR.hand.add(obj);
    },
    playToolAnim(kind) {
      const dur = ANIM_DUR[kind];
      action = { kind, t: 0, dur };
      return dur;
    },
    isBusy() {
      return action !== null;
    },
    actionProgress() {
      return action ? Math.min(1, action.t / action.dur) : -1;
    },
    showHarvestProduce(mesh, dur) {
      if (produce) produceAnchor.remove(produce.mesh);
      mesh.scale.setScalar(0.01);
      produceAnchor.add(mesh);
      produce = { mesh, t: 0, dur };
    },
    land() {
      squashT = 1;
    },
    squashActive() {
      return squashT > 0;
    },
    dispose() {
      disposeTree(group);
    },
  };
}

// ===========================================================================
// RIGGED farmer — the Quaternius GLB driven by an AnimationMixer + procedural
// overlays.
// ===========================================================================

const CHAR_HEIGHT = 1.75; // world units, ≈ the procedural farmer (fences/doors eyeball).
// Sunny's native GLB is 0.9 units tall (max bbox dim) → instantiateSized scales
// her ×1.94 to this game height.
// Sunny faces +Z natively (the "headfront" node sits at +Z in bone space, and the
// Armature scale is +0.01 so no axis flip) = the game's forward (movement
// direction, matching the procedural farmer). Verified via the -idle screenshot
// (camera north-looking-south sees her FACE). No rotation.
const MODEL_YAW = 0;

// HoeChop subrange — Sunny's HoeChop clip is a 7.67s charged-chop PERFORMANCE
// (several sweeps). Full-skeleton FK of the RightHand world-Y over the clip
// found the cleanest single raise→slam beat: the hand rises to its high point at
// t≈4.00s (y≈0.79) then chops DOWN to its low point at t≈4.50s (y≈0.44), settling
// by 4.55. We play just [START,END] fitted into the ANIM_DUR.hoe input-block
// window via AnimationAction.time offsets + timeScale — reads as a decisive hoe
// swing (short raise + slam) without the surrounding idle-charge frames.
const HOE_CLIP_START = 3.7;
const HOE_CLIP_END = 4.55;

// Which stock clip (if any) plays under each tool action. null → the gesture is
// carried entirely by the procedural overlay below. Sunny ships only Idle/Walk/
// Run/HoeChop, so ONLY the hoe rides a clip; every other action is procedural.
const TOOL_CLIP: Record<ToolAnimKind, string | null> = {
  hoe: "HoeChop", // charged-chop subrange (see HOE_CLIP_START/END) reads as a hoe swing
  plant: null, // bend/reach scatter — procedural
  harvest: null, // reach-down scoop + overhead HOLD-UP — procedural
  pet: null, // gentle reach toward the animal — procedural
  water: null, // POUR — procedural (raise + tilt the can)
  refill: null, // DIP — procedural (crouch + dip at the pond)
};

// three's GLTFLoader sanitizes node names — reserved chars [].:/  are stripped
// and whitespace → "_" (PropertyBinding.sanitizeNodeName). So the rig's
// "UpperArm.R" bone is named "UpperArmR" once loaded. Match by the sanitized
// form (first hit wins; harmless if a multi-skin export suffixed duplicates).
function sanitizeBoneName(n: string): string {
  return n.replace(/\s/g, "_").replace(/[[\].:/]/g, "");
}
function findBone(root: THREE.Object3D, name: string): THREE.Bone | null {
  const want = sanitizeBoneName(name);
  let hit: THREE.Bone | null = null;
  root.traverse((o) => {
    if (!hit && (o as THREE.Bone).isBone && sanitizeBoneName(o.name) === want) hit = o as THREE.Bone;
  });
  return hit;
}

/** World position where the VISIBLE hand renders, found by picking the skinned
 * vertex most weighted to `wrist` and running three's own skinning transform on
 * it. Returns null if no skinned mesh weights that bone. Used to attach a held
 * tool at the true hand (the raw bone origin is off in bind-matrix space). */
function visibleHandWorld(root: THREE.Object3D, wrist: THREE.Bone): THREE.Vector3 | null {
  const meshes: THREE.SkinnedMesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });
  const _si = new THREE.Vector4();
  const _sw = new THREE.Vector4();
  const _v = new THREE.Vector3();
  for (const sm of meshes) {
    const skel = sm.skeleton;
    const wi = skel.bones.indexOf(wrist);
    if (wi < 0) continue;
    const geo = sm.geometry;
    const si = geo.attributes.skinIndex as THREE.BufferAttribute | undefined;
    const sw = geo.attributes.skinWeight as THREE.BufferAttribute | undefined;
    const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
    if (!si || !sw || !pos) continue;
    let bestV = -1, bestW = 0;
    for (let v = 0; v < pos.count; v++) {
      _si.fromBufferAttribute(si, v);
      _sw.fromBufferAttribute(sw, v);
      for (let k = 0; k < 4; k++) {
        if (_si.getComponent(k) === wi && _sw.getComponent(k) > bestW) {
          bestW = _sw.getComponent(k);
          bestV = v;
        }
      }
    }
    if (bestV < 0) continue;
    _v.fromBufferAttribute(pos, bestV);
    sm.applyBoneTransform(bestV, _v); // → mesh-local skinned position
    return _v.applyMatrix4(sm.matrixWorld); // → world
  }
  return null;
}

function buildRiggedImpl(opts: FarmerOptions, tpl: LoadedModel): AvatarImpl {
  const group = new THREE.Group();
  group.name = "farmer-glb";

  // squashGroup carries the landing-squash scale pulse; the model sits inside it.
  const squashGroup = new THREE.Group();
  group.add(squashGroup);

  const inst = instantiateSized(tpl, CHAR_HEIGHT); // base at y=0, scaled to height
  const modelGroup = inst.root;
  modelGroup.rotation.y = MODEL_YAW;
  squashGroup.add(modelGroup);

  const mixer = inst.mixer ?? new THREE.AnimationMixer(modelGroup);
  const clips = inst.clips;

  // ---- per-instance material clone + optional outfit tint -------------------
  // SkeletonUtils.clone shares materials across clones; clone them here so a
  // tint on one avatar never bleeds to another. Then, for a REMOTE avatar
  // (opts.shirt set), multiply Sunny's two CLOTHING materials (FL_Overall +
  // FL_Shirt) toward the player colour so players read as distinct — her skin,
  // hair, shoes and dark trim (FL_Skin/FL_Hair/FL_Shoe/FL_Dark) stay natural so
  // she still reads as the same girl.
  const TINT_MATS = /overall|shirt/i;
  const tint = opts.shirt ? new THREE.Color(opts.shirt) : null;
  modelGroup.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = mats.map((mat) => {
      const c = mat.clone() as THREE.MeshLambertMaterial;
      if (tint && TINT_MATS.test(mat.name || "")) {
        // blend toward the tint (keeps a hint of the original for variation)
        c.color.lerp(tint, 0.62);
        if (c.emissive) c.emissive.copy(c.color).multiplyScalar(0.12);
      }
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });

  // ---- locomotion actions ---------------------------------------------------
  const idleClip = findClip(clips, "idle") ?? clips[0] ?? null; // plain "Idle" = breathing
  const walkClip = findClip(clips, "walk") ?? idleClip;
  const runClip = findClip(clips, "run", "walk") ?? walkClip;
  const idleAct = idleClip ? mixer.clipAction(idleClip) : null;
  const walkAct = walkClip ? mixer.clipAction(walkClip) : null;
  const runAct = runClip && runClip !== walkClip ? mixer.clipAction(runClip) : null;
  for (const a of [idleAct, walkAct, runAct]) {
    if (a) {
      a.play();
      a.enabled = true;
      a.setEffectiveWeight(0);
    }
  }
  if (idleAct) idleAct.setEffectiveWeight(1);
  let wIdle = 1, wWalk = 0, wRun = 0;

  // Anti-skate: Sunny's game move speeds (walk 5.2 / run ~9.9 m/s) are fast for
  // her small stride, so the walk/run clips are timeScaled UP to plant the feet.
  // Natural world speed of each clip at this render scale, measured via full-
  // skeleton FK of the toe over one cycle: Walk ≈ 1.13 m/s, Run ≈ 2.19 m/s.
  // playbackRate = commanded worldSpeed / natural, clamped so the legs never
  // whirl. At the default 5.2/9.9 speeds this lands ~4.5× (feet planted).
  const WALK_NATURAL = 1.13, RUN_NATURAL = 2.19;
  const clampR = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

  // ---- one-shot tool-action clip --------------------------------------------
  let action: { kind: ToolAnimKind; t: number; dur: number } | null = null;
  let actClip: THREE.AnimationAction | null = null;
  let actW = 0;

  // ---- bones for overlays + anchors -----------------------------------------
  // Sunny's rig uses Mixamo-style bone names (no dots): RightArm/RightForeArm/
  // RightHand for the right arm chain, Left*/Right*UpLeg for legs, Spine02 for the
  // upper chest, Head. (The old Quaternius "UpperArm.R"/"Chest" names are gone.)
  const bUpperR = findBone(modelGroup, "RightArm");
  const bLowerR = findBone(modelGroup, "RightForeArm");
  const bWristR = findBone(modelGroup, "RightHand");
  const bUpperL = findBone(modelGroup, "LeftArm");
  const bLegL = findBone(modelGroup, "LeftUpLeg");
  const bLegR = findBone(modelGroup, "RightUpLeg");
  const bChest = findBone(modelGroup, "Spine02") ?? findBone(modelGroup, "Spine");
  const bHead = findBone(modelGroup, "Head");
  // Root-motion strip: several clips (Sword_Slash/Interact lunge, Run drifts)
  // TRANSLATE the character forward via the root/spine bones — which slides the
  // whole rig (and any hand-attached tool) metres across the world. In a skeletal
  // clip only the root translates; limb bones are pure ROTATION, so snapping
  // every bone's HORIZONTAL position back to its rest each frame kills root
  // motion while keeping all pose rotation AND vertical bob (y is untouched).
  // Every bone: pin horizontal rest (limbs only rotate, so this is a no-op for
  // them and kills root DRIFT). The skeleton ROOT bone(s) additionally pin
  // VERTICAL rest — Sword_Slash/Roll lunge the root UP metres, which would
  // rocket the whole rig skyward; child spine/hips keep their y for walk bounce.
  const restBones: { bone: THREE.Bone; x: number; y: number; z: number; root: boolean }[] = [];
  modelGroup.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    const isRoot = !((o.parent as THREE.Bone | null)?.isBone);
    restBones.push({ bone: o as THREE.Bone, x: o.position.x, y: o.position.y, z: o.position.z, root: isRoot });
  });
  const boneByName = new Map<string, THREE.Bone>();
  for (const b of [bUpperR, bLowerR, bWristR, bUpperL, bLegL, bLegR, bChest, bHead]) {
    if (b) boneByName.set(b.name, b);
  }

  // hand anchor — a child of the right wrist bone (RightHand) that holds the tool.
  //
  // CAUTION (this rig's bind-matrix trap): Sunny's Armature node has scale 0.01
  // (the INVERSE of the Quaternius farmer's ×100 — the skeleton is authored in a
  // ×100-larger internal space that the 0.01 Armature scale collapses back to the
  // mesh's real 0.9-unit size). So the wrist bone's WORLD scale is ~0.01 and its
  // local frame is ×100 magnified. The generic fix used for both rigs still
  // applies unchanged: find where the VISIBLE hand actually renders (via three's
  // own skinning, applyBoneTransform on a wrist-weighted vertex), express that as
  // a constant offset in the wrist bone's local frame (rigid → valid every pose),
  // and counter the bone's world scale (handAnchor.scale = 1/ws ≈ 100 here, ≈0.01
  // on the farmer) so the tool renders life-size. Self-correcting either way.
  const handAnchor = new THREE.Group();
  handAnchor.name = "handAnchor";
  const armPivotFallback = new THREE.Group();
  const armPivot: THREE.Object3D = bUpperR ?? armPivotFallback;
  if (bWristR) {
    bWristR.add(handAnchor);
    modelGroup.updateWorldMatrix(true, true);
    const ws = new THREE.Vector3();
    bWristR.getWorldScale(ws);
    handAnchor.scale.setScalar(ws.x !== 0 ? 1 / ws.x : 1);
    const visible = visibleHandWorld(modelGroup, bWristR);
    if (visible) {
      // offset that maps the wrist bone frame → the visible hand
      const invBone = new THREE.Matrix4().copy(bWristR.matrixWorld).invert();
      handAnchor.position.copy(visible.applyMatrix4(invBone));
    } else {
      handAnchor.position.set(0, 0, 0);
    }
    handAnchor.rotation.set(-1.4, 0, 0.15); // grip up/forward out of the fist
  } else {
    squashGroup.add(handAnchor);
    handAnchor.position.set(0.35, 1.0, 0.2);
  }

  // produce hold-up anchor — outer group (unscaled by squash), above the head.
  const produceAnchor = new THREE.Group();
  produceAnchor.position.set(0, CHAR_HEIGHT * 1.12, 0.12);
  group.add(produceAnchor);

  let squashT = 0;
  let produce: { mesh: THREE.Object3D; t: number; dur: number } | null = null;
  let carry = false;

  const _eul = new THREE.Euler();
  const _q = new THREE.Quaternion();
  /** Additive overlay: post-multiply a small rotation delta onto a bone AFTER
   * mixer.update. Frozen-arm-safe (never touches bone.rotation.x). */
  function overlay(bone: THREE.Bone | null, ex: number, ey: number, ez: number): void {
    if (!bone) return;
    _q.setFromEuler(_eul.set(ex, ey, ez));
    bone.quaternion.multiply(_q);
  }

  function applyOverlays(airborne: boolean): void {
    // CARRY pose — when holding a tool and not mid-action, bend the right elbow
    // up so the tool reads in front of the body (the Idle clip rests arms at the
    // sides, which would bury a held hoe against the leg).
    if (carry && !action) {
      overlay(bUpperR, -0.42, 0, 0);
      overlay(bLowerR, -0.95, 0, 0);
    }
    // JUMP tuck — legs swing back while airborne (independent of tool actions).
    if (airborne) {
      overlay(bLegL, -0.5, 0, 0);
      overlay(bLegR, -0.5, 0, 0);
      overlay(bUpperR, -0.35, 0, 0);
      overlay(bUpperL, -0.35, 0, 0);
    }
    if (!action) return;
    const p = clamp01(action.t / action.dur);
    const env = Math.sin(clamp01(p) * Math.PI); // 0→1→0 ease for standalone gestures
    // NOTE on Sunny's arm axes (measured via FK on the RightArm bone): its local
    // frame is oblique — +Y is the dominant RAISE axis (hand up), −Z swings the
    // arm FORWARD, +X drops it slightly. Overlays below use that convention.
    if (action.kind === "water") {
      // raise the right arm up-and-forward and tilt the wrist to pour
      overlay(bUpperR, -0.25 * env, 1.25 * env, -0.35 * env);
      overlay(bLowerR, -0.7 * env, 0, 0);
      overlay(bWristR, 0.6 * env, 0, 0.4 * env);
      overlay(bChest, 0.06 * env, 0, 0);
    } else if (action.kind === "refill") {
      // crouch + dip the can low toward the pond (reach DOWN-forward = −Y/+X)
      const dip = env;
      squashGroup.position.y = -0.18 * dip;
      overlay(bLegL, 0.5 * dip, 0, 0);
      overlay(bLegR, 0.5 * dip, 0, 0);
      overlay(bChest, 0.35 * dip, 0, 0);
      overlay(bUpperR, 0.45 * dip, -0.7 * dip, 0);
    } else if (action.kind === "harvest") {
      // reach DOWN to scoop in the first half, then RAISE both arms overhead so
      // the held produce (fixed produceAnchor) reads as lifted high — the HM beat.
      const reach = smooth01(0, 0.45, p);
      const lift = smooth01(0.5, 1, p);
      overlay(bUpperR, 0.35 * reach, -0.55 * reach + 2.1 * lift, 0);
      overlay(bUpperL, 0.35 * reach, 0.55 * reach - 2.1 * lift, 0); // mirror (left raise ≈ −Y)
      overlay(bChest, 0.24 * reach - 0.12 * lift, 0, 0);
    } else if (action.kind === "plant") {
      // bend + scatter: sweep the right arm forward-and-down over the tile
      overlay(bUpperR, 0.5 * env, -0.5 * env, 0);
      overlay(bLowerR, -0.5 * env, 0, 0);
      overlay(bChest, 0.28 * env, 0, 0);
    } else if (action.kind === "pet") {
      // gentle crouch + reach the right arm forward toward the animal
      overlay(bUpperR, 0.4 * env, -0.45 * env, 0);
      overlay(bLowerR, -0.35 * env, 0, 0);
      overlay(bChest, 0.14 * env, 0, 0);
      overlay(bLegL, 0.25 * env, 0, 0);
      overlay(bLegR, 0.25 * env, 0, 0);
    }
  }

  return {
    group,
    usesModel: true,
    armPivot,
    handAnchor,
    boneQuat(name) {
      const b = boneByName.get(name) ?? findBone(modelGroup, name);
      if (!b) return null;
      const q = b.quaternion;
      return [q.x, q.y, q.z, q.w];
    },
    locoWeights: () => ({ idle: wIdle, walk: wWalk, run: wRun }),
    boneNames: () => {
      const out: string[] = [];
      modelGroup.traverse((o) => {
        if ((o as THREE.Bone).isBone) out.push(o.name);
      });
      return out;
    },
    update(dt, speed, maxSpeed, airborne) {
      const gait = Math.min(1, speed / (maxSpeed || 1));
      const moving = speed > 0.05;
      // target locomotion weights (idle / walk↔run by gait)
      const move = moving ? 1 : 0;
      const runFrac = smooth01(0.45, 0.95, gait);
      const tIdle = 1 - move;
      const tWalk = move * (1 - runFrac);
      const tRun = move * runFrac;
      const k = Math.min(1, dt * 9);
      wIdle = lerpTo(wIdle, tIdle, k);
      wWalk = lerpTo(wWalk, tWalk, k);
      wRun = lerpTo(wRun, tRun, k);

      // advance the tool action + its clip-weight envelope
      if (action) {
        action.t += dt;
        const p = clamp01(action.t / action.dur);
        actW = p < 0.15 ? p / 0.15 : p > 0.85 ? Math.max(0, (1 - p) / 0.15) : 1;
        if (action.t >= action.dur) {
          action = null;
          actW = 0;
          actClip?.stop();
          actClip = null;
        }
      } else if (actW > 0) {
        actW = Math.max(0, actW - dt * 6);
      }

      // only cross-fade OUT of locomotion when a replacement CLIP is playing;
      // clip-less procedural overlays (water/refill) keep idle running underneath.
      const locoScale = actClip ? 1 - actW : 1;
      if (idleAct) idleAct.setEffectiveWeight(wIdle * locoScale);
      if (walkAct) walkAct.setEffectiveWeight(wWalk * locoScale);
      if (runAct) runAct.setEffectiveWeight((runAct === walkAct ? 0 : wRun) * locoScale);
      if (actClip) actClip.setEffectiveWeight(actW);
      // anti-skate: match clip cadence to commanded ground speed
      if (walkAct && walkAct !== idleAct) walkAct.timeScale = clampR(speed / WALK_NATURAL, 0.7, 4.8);
      if (runAct && runAct !== walkAct) runAct.timeScale = clampR(speed / RUN_NATURAL, 0.7, 4.8);

      mixer.update(dt);
      // strip root motion (horizontal for all; vertical for the root bone), then overlays
      for (const r of restBones) { r.bone.position.x = r.x; r.bone.position.z = r.z; if (r.root) r.bone.position.y = r.y; }
      applyOverlays(airborne); // post-mixer additive bone deltas

      // landing squash (pulse the model, about the feet)
      if (squashT > 0) {
        squashT = Math.max(0, squashT - dt / 0.2);
        const c = squashT;
        squashGroup.scale.set(1 + 0.14 * c, 1 - 0.24 * c, 1 + 0.14 * c);
      } else {
        squashGroup.scale.set(1, 1, 1);
        if (!action || action.kind !== "refill") squashGroup.position.y = 0;
      }

      if (produce) {
        produce.t += dt;
        const q = Math.min(1, produce.t / produce.dur);
        const s = 1.6 * Math.sin(Math.min(1, q * 2) * Math.PI * 0.5);
        produce.mesh.scale.setScalar(Math.max(0.01, s));
        if (produce.t >= produce.dur) {
          produceAnchor.remove(produce.mesh);
          produce = null;
        }
      }
    },
    setHeldTool(obj) {
      for (let i = handAnchor.children.length - 1; i >= 0; i--) {
        const c = handAnchor.children[i];
        if (c.name.startsWith("tool-")) handAnchor.remove(c);
      }
      carry = !!obj;
      void carry;
      if (obj) handAnchor.add(obj);
    },
    playToolAnim(kind) {
      const dur = ANIM_DUR[kind];
      action = { kind, t: 0, dur };
      const clipName = TOOL_CLIP[kind];
      actClip?.stop();
      actClip = null;
      if (clipName) {
        const clip = findClip(clips, clipName);
        if (clip) {
          const a = mixer.clipAction(clip);
          a.reset();
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
          if (kind === "hoe") {
            // Play only the raise→slam SUBRANGE of the long HoeChop performance.
            // Start the action clock at HOE_CLIP_START and scale so it advances
            // exactly (END−START) of clip time across the `dur`-second window —
            // it lands on END right as the input block releases (END < clip
            // length, so LoopOnce never wraps back to the idle-charge frames).
            a.time = HOE_CLIP_START;
            a.timeScale = (HOE_CLIP_END - HOE_CLIP_START) / dur;
          } else {
            a.timeScale = clip.duration / dur; // fit the whole gesture into the window
          }
          a.setEffectiveWeight(0);
          a.play();
          actClip = a;
        }
      }
      return dur;
    },
    isBusy() {
      return action !== null;
    },
    actionProgress() {
      return action ? clamp01(action.t / action.dur) : -1;
    },
    showHarvestProduce(mesh, dur) {
      if (produce) produceAnchor.remove(produce.mesh);
      mesh.scale.setScalar(0.01);
      produceAnchor.add(mesh);
      produce = { mesh, t: 0, dur };
    },
    land() {
      squashT = 1;
    },
    squashActive() {
      return squashT > 0;
    },
    dispose() {
      mixer.stopAllAction();
      disposeTree(group);
    },
  };
}

// ===========================================================================
// The public Farmer wrapper — delegates to whichever impl is current.
// ===========================================================================
export function buildFarmer(opts: FarmerOptions = {}): Farmer {
  const root = new THREE.Group();
  root.name = "farmer";

  // If the character template is already loaded (remote avatars built after
  // preload), go straight to the rig; otherwise start procedural and let
  // upgradeToModel() swap it in when the load resolves.
  let impl: AvatarImpl = characterTemplate ? buildRiggedImpl(opts, characterTemplate) : buildProceduralImpl(opts);
  root.add(impl.group);

  let heldTool: THREE.Object3D | null = null;
  let landCounter = 0;

  const farmer: Farmer = {
    root,
    update: (dt, speed, maxSpeed, airborne = false) => impl.update(dt, speed, maxSpeed, airborne),
    setHeldTool(obj) {
      heldTool = obj;
      impl.setHeldTool(obj);
    },
    playToolAnim: (kind) => impl.playToolAnim(kind),
    isBusy: () => impl.isBusy(),
    actionProgress: () => impl.actionProgress(),
    showHarvestProduce: (mesh, dur) => impl.showHarvestProduce(mesh, dur),
    land() {
      landCounter++;
      impl.land();
    },
    squashActive: () => impl.squashActive(),
    landCount: () => landCounter,
    get armPivot() {
      return impl.armPivot;
    },
    get handAnchor() {
      return impl.handAnchor;
    },
    usesModel: () => impl.usesModel,
    upgradeToModel(tpl) {
      if (impl.usesModel) return;
      root.remove(impl.group);
      impl.dispose();
      impl = buildRiggedImpl(opts, tpl);
      root.add(impl.group);
      if (heldTool) impl.setHeldTool(heldTool); // re-parent the held tool to the new hand
    },
    boneQuat: (name) => impl.boneQuat(name),
    locoWeights: () => impl.locoWeights(),
    boneNames: () => impl.boneNames(),
  };

  root.userData.seatOnTerrain = () => {
    root.position.y = sampleHeight(root.position.x, root.position.z);
  };

  return farmer;
}

// ---------------------------------------------------------------------------
// Character model preload (mirrors animals3d.preloadAnimalModels). Resolves
// after the GLB settles (success OR failure). On success, buildFarmer() built
// BEFORE the load can be upgraded in place via farmer.upgradeToModel().
// ---------------------------------------------------------------------------
let characterTemplate: LoadedModel | null = null;
let characterPreloaded = false;

export function preloadCharacterModel(): Promise<LoadedModel | null> {
  return loadModel(modelUrl("character/sunny.glb")).then((mdl) => {
    characterTemplate = mdl;
    characterPreloaded = true;
    return mdl;
  });
}
export function characterModelReady(): boolean {
  return characterPreloaded && !!characterTemplate;
}
export function getCharacterTemplate(): LoadedModel | null {
  return characterTemplate;
}

function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
    else if (mat) mat.dispose();
  });
}
