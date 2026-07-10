import * as THREE from "three";
import { sampleHeight, FIELD } from "../world/terrain";
import { addBox } from "../world/collision";

// Shipping bin (sell) + seed stand (buy) — chunky procedural props, placed
// beside the field gate / farmhouse path. Proximity radii are generous
// (kid-friendly — no fussy precise standing required).

export interface Station {
  x: number;
  z: number;
  radius: number;
  group: THREE.Group;
}

function mat(color: string) {
  return new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
}

// Field gate sits on the east edge, at (FIELD.cx+FIELD.half, FIELD.cz) — see
// scenery.ts buildFieldFence's isGapSide (i===1) + buildPath's matching entry.
export const BIN_POS = { x: FIELD.cx + FIELD.half + 2.6, z: FIELD.cz };
// Beside the house<->field path waypoint (16,14 in scenery.ts buildPath), clear
// of the farmhouse footprint (24,20, 4x3 half) and clear of the open bee-line
// spawn->pond corridor used by the P0 collision test.
export const STAND_POS = { x: 14, z: 13 };

export function buildShippingBin(): Station {
  const g = new THREE.Group();
  const baseY = sampleHeight(BIN_POS.x, BIN_POS.z);

  const crate = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.2), mat("#8a6236"));
  crate.position.y = 0.5;
  crate.castShadow = true;
  crate.receiveShadow = true;
  g.add(crate);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.3), mat("#6b4a26"));
  rim.position.y = 1.02;
  g.add(rim);
  // X crossbrace on the front face
  for (const s of [-1, 1]) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.35, 0.05), mat("#6b4a26"));
    brace.position.set(0, 0.5, 0.61);
    brace.rotation.z = s * 0.62;
    g.add(brace);
  }
  // coin sign
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: coinTexture(), transparent: true }));
  sign.scale.set(0.55, 0.55, 0.55);
  sign.position.set(0, 1.55, 0);
  g.add(sign);

  g.position.set(BIN_POS.x, baseY, BIN_POS.z);
  addBox(BIN_POS.x, BIN_POS.z, 0.9, 0.7);
  return { x: BIN_POS.x, z: BIN_POS.z, radius: 2.6, group: g };
}

export function buildSeedStand(): Station {
  const g = new THREE.Group();
  const baseY = sampleHeight(STAND_POS.x, STAND_POS.z);

  const postMat = mat("#7a5230");
  const postGeo = new THREE.BoxGeometry(0.14, 1.5, 0.14);
  const posts: [number, number][] = [
    [-0.75, -0.55],
    [0.75, -0.55],
    [-0.75, 0.55],
    [0.75, 0.55],
  ];
  for (const [px, pz] of posts) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(px, 0.75, pz);
    post.castShadow = true;
    g.add(post);
  }
  const counter = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 1.3), mat("#9c7a52"));
  counter.position.y = 0.85;
  counter.receiveShadow = true;
  g.add(counter);
  // striped awning roof
  for (let i = 0; i < 5; i++) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 1.5), mat(i % 2 === 0 ? "#c9483a" : "#f0e6d0"));
    stripe.position.set(-0.76 + i * 0.38, 1.55, 0);
    stripe.rotation.z = -0.12;
    stripe.castShadow = true;
    g.add(stripe);
  }
  // seed sign
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: seedTexture(), transparent: true }));
  sign.scale.set(0.5, 0.5, 0.5);
  sign.position.set(0, 2.05, 0);
  g.add(sign);

  g.position.set(STAND_POS.x, baseY, STAND_POS.z);
  addBox(STAND_POS.x, STAND_POS.z, 1.0, 0.8);
  return { x: STAND_POS.x, z: STAND_POS.z, radius: 3.2, group: g };
}

function coinTexture(): THREE.Texture {
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = "#f4c542";
  ctx.fill();
  ctx.strokeStyle = "#b8891f";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = "#8a5f10";
  ctx.font = "bold 30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("$", s / 2, s / 2 + 2);
  return new THREE.CanvasTexture(cv);
}

function seedTexture(): THREE.Texture {
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = "#7fbf5a";
  ctx.fill();
  ctx.strokeStyle = "#4a7a34";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.font = "30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🌱", s / 2, s / 2 + 2);
  return new THREE.CanvasTexture(cv);
}

export function distanceTo(px: number, pz: number, st: Station): number {
  return Math.hypot(px - st.x, pz - st.z);
}
