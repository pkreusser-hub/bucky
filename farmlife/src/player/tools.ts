import * as THREE from "three";
import type { ToolId } from "../farm/action";

// Procedural chunky low-poly tool models, authored so their ORIGIN is the grip
// point and they point "forward/up" out of a closed fist — setHeldTool() just
// adds them to the farmer's hand anchor at local (0,0,0). Sized to read at the
// chase-cam distance (farmer ~1.7 tall, cam ~8.5m).

function m(color: string, opts: THREE.MeshLambertMaterialParameters = {}) {
  return new THREE.MeshLambertMaterial({ color: new THREE.Color(color), ...opts });
}

const WOOD = "#8a5a2b";
const WOOD_DK = "#6b4423";
const METAL = "#b8bcc4";

/** Hoe (P6 rework — reads as a HOE, not a pickaxe): a long wood handle running
 * up +Y from the grip, and a short perpendicular FLAT blade at the top that
 * juts forward and hangs down — the classic hoe L-silhouette (wide in x, thin in
 * z), distinct from the old small angled head that read like a pick. */
export function buildHoe(): THREE.Group {
  const g = new THREE.Group();
  g.name = "tool-hoe";
  // long handle
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 1.18, 6), m(WOOD));
  handle.position.y = 0.52;
  handle.castShadow = true;
  g.add(handle);
  // ferrule at the head
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), m(WOOD_DK));
  ferrule.position.y = 1.08;
  g.add(ferrule);
  // short neck bending forward off the top of the handle
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), m(METAL, { emissive: new THREE.Color("#20242a") }));
  neck.position.set(0, 1.12, 0.09);
  neck.rotation.x = -0.9; // lean forward
  neck.castShadow = true;
  g.add(neck);
  // the flat blade: wide (x), tall (y), THIN (z) — hangs down, perpendicular to
  // the handle. This broad flat plate is the hoe read.
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.045), m(METAL, { emissive: new THREE.Color("#20242a") }));
  blade.position.set(0, 1.0, 0.2);
  blade.rotation.x = 0.35; // slight downward tilt of the cutting face
  blade.castShadow = true;
  g.add(blade);
  return g;
}

/**
 * Watering can: body + spout + handle. userData.setFilled(bool) tints the body
 * water-blue when the tank has water, dull tin when empty.
 */
export function buildWateringCan(): THREE.Group {
  const g = new THREE.Group();
  g.name = "tool-can";
  const bodyMat = m("#4aa3d6");
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.28, 10), bodyMat);
  body.position.y = 0.18;
  body.castShadow = true;
  g.add(body);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.06, 10), m("#3f8ab8"));
  lid.position.y = 0.34;
  g.add(lid);
  // spout — angled tube out the front
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.34, 6), m("#3f8ab8"));
  spout.position.set(0, 0.26, 0.22);
  spout.rotation.x = 1.15;
  g.add(spout);
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.05, 8), m("#356f96"));
  rose.position.set(0, 0.37, 0.36);
  rose.rotation.x = 1.15;
  g.add(rose);
  // top loop handle
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI), m("#3f8ab8"));
  handle.position.set(0, 0.36, -0.02);
  handle.rotation.x = Math.PI / 2;
  g.add(handle);

  g.userData.setFilled = (filled: boolean) => {
    bodyMat.color.set(filled ? "#4aa3d6" : "#8f9aa0");
  };
  return g;
}

/** Seed pouch: a small drawstring sack. */
export function buildSeedPouch(): THREE.Group {
  const g = new THREE.Group();
  g.name = "tool-seeds";
  const sack = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 7), m("#c8a15a"));
  sack.scale.set(1, 1.15, 1);
  sack.position.y = 0.13;
  sack.castShadow = true;
  g.add(sack);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.09, 8), m("#a5813f"));
  neck.position.y = 0.27;
  g.add(neck);
  // a couple of seeds peeking out
  for (const s of [-1, 1]) {
    const seed = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), m("#6b8f3a"));
    seed.position.set(s * 0.03, 0.32, 0);
    g.add(seed);
  }
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 5, 10), m("#7a5a2b"));
  tie.position.y = 0.27;
  tie.rotation.x = Math.PI / 2;
  g.add(tie);
  return g;
}

export function buildTool(tool: ToolId): THREE.Group | null {
  switch (tool) {
    case "hoe":
      return buildHoe();
    case "can":
      return buildWateringCan();
    case "seeds":
      return buildSeedPouch();
    default:
      return null; // hands = nothing held
  }
}
