import * as THREE from "three";
import type { Tune } from "../tune";
import { sampleHeight } from "../world/terrain";

// Orbit-follow chase camera. Yaw is free; pitch clamped ~10°–60°; wheel zoom
// within clamps. Orbit angles persist while moving. The camera NEVER goes under
// the terrain: we sample the ground under the camera and clamp above it (the
// Farm Kart camera-under-grass incident is the cautionary tale).

const PITCH_MIN = 0.17; // ~10°
const PITCH_MAX = 1.05; // ~60°
const DIST_MIN = 3;
const DIST_MAX = 20;

export class ChaseCam {
  yaw = 0; // radians, around +Y
  pitch: number;
  dist: number;
  private target = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private tune: Tune;

  constructor(public cam: THREE.PerspectiveCamera, tune: Tune) {
    this.tune = tune;
    this.pitch = tune.camPitchDefault;
    this.dist = tune.camDist;
  }

  orbit(dxRad: number, dyRad: number): void {
    this.yaw -= dxRad;
    this.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, this.pitch + dyRad));
  }

  zoom(delta: number): void {
    this.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, this.dist + delta));
  }

  /** Direction the camera faces horizontally (for camera-relative movement). */
  forwardVec(out: THREE.Vector3): THREE.Vector3 {
    // camera looks toward the player; forward (into screen) is -offset dir
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
  }
  rightVec(out: THREE.Vector3): THREE.Vector3 {
    // Screen-right = cross(forward, up) with forward=(sinYaw,0,cosYaw), up=+Y
    // → (-cosYaw, 0, sinYaw). (The earlier (cosYaw,0,-sinYaw) was its NEGATION,
    // so pressing D/right strafed screen-LEFT — the reversed-controls bug.)
    return out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)).normalize();
  }

  update(dt: number, focusX: number, focusY: number, focusZ: number): void {
    // desired look target = a bit above the player
    this.target.set(focusX, focusY + 1.2, focusZ);

    const cp = Math.cos(this.pitch);
    const desired = new THREE.Vector3(
      focusX - Math.sin(this.yaw) * this.dist * cp,
      focusY + this.tune.camHeight * (this.dist / this.tune.camDist) + Math.sin(this.pitch) * this.dist * 0.4,
      focusZ - Math.cos(this.yaw) * this.dist * cp
    );

    // never under terrain: keep at least 0.8 m above the ground beneath the cam
    const groundHere = sampleHeight(desired.x, desired.z);
    if (desired.y < groundHere + 0.8) desired.y = groundHere + 0.8;

    // smooth follow (camLag = snappiness)
    const k = 1 - Math.exp(-this.tune.camLag * dt);
    this.camPos.lerp(desired, k);
    // re-clamp after lerp (target could still be below a lip we lerped through)
    const gLerp = sampleHeight(this.camPos.x, this.camPos.z);
    if (this.camPos.y < gLerp + 0.6) this.camPos.y = gLerp + 0.6;

    this.cam.position.copy(this.camPos);
    this.cam.lookAt(this.target);

    if (this.cam.fov !== this.tune.fov) {
      this.cam.fov = this.tune.fov;
      this.cam.updateProjectionMatrix();
    }
  }

  snapBehind(focusX: number, focusY: number, focusZ: number): void {
    const cp = Math.cos(this.pitch);
    this.camPos.set(
      focusX - Math.sin(this.yaw) * this.dist * cp,
      focusY + this.tune.camHeight,
      focusZ - Math.cos(this.yaw) * this.dist * cp
    );
    this.cam.position.copy(this.camPos);
  }
}
