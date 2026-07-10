import * as THREE from "three";

// ---------------------------------------------------------------------------
// Stars + rain/snow particles — P4 cosmetic-only effects. Cheap by design:
// each is a single THREE.Points cloud built once; per-frame work is just
// updating positions/opacity, no allocation. Rain/snow re-center on the
// player each frame so the effect always reads as "around you" without a
// giant volume.
// ---------------------------------------------------------------------------

export interface Stars {
  points: THREE.Points;
  setAlpha(a: number): void;
}

export function buildStars(count = 500, radius = 140): Stars {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.9); // bias toward upper hemisphere
    const r = radius;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 20;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -1;
  return {
    points,
    setAlpha(a: number) {
      mat.opacity = a;
      points.visible = a > 0.01;
    },
  };
}

export interface Precip {
  group: THREE.Group;
  update(dt: number, centerX: number, centerZ: number, baseY: number): void;
  setVisible(v: boolean): void;
}

/** A falling-particle cloud (rain streaks or snow flecks) confined to a box
 * around (centerX, centerZ) each frame, recycled when it hits the ground. */
export function buildPrecip(opts: { count: number; color: number; size: number; fallSpeed: number; spread: number; height: number }): Precip {
  const { count, color, size, fallSpeed, spread, height } = opts;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * spread;
    pos[i * 3 + 1] = Math.random() * height;
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * spread;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: 0.75, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.add(points);
  group.visible = false;

  return {
    group,
    setVisible(v: boolean) {
      group.visible = v;
    },
    update(dt, centerX, centerZ, baseY) {
      if (!group.visible) return;
      group.position.set(centerX, baseY, centerZ);
      const arr = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        let y = arr.getY(i) - fallSpeed * dt;
        if (y < 0) y = height;
        arr.setY(i, y);
      }
      arr.needsUpdate = true;
    },
  };
}
