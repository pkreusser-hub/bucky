import * as THREE from "three";
import { sampleHeight } from "../world/terrain";
import { GRID, TILE_SIZE, tileKey, tileCenter, worldToTile } from "./grid";
import { CROPS, GrowthTile, growthStage, needsWater, effectiveCrop } from "./growth";
import { buildCropMesh } from "./cropVisuals";
import type { FarmState, TileRecord } from "./store";
import type { TileState } from "./action";

// ---------------------------------------------------------------------------
// Field3D — owns the 12x12 tile grid's visuals (tilled soil, crop meshes by
// stage, ready-sparkle) and the facing-aware targeting/action resolution.
// Rebuild granularity is PER TILE: syncTile() only touches the one tile whose
// state changed, never the whole grid (Bistro-proven pattern: cheap, no perf
// surprise as the field fills up).
// ---------------------------------------------------------------------------

const REACH = 2.2; // m, max action distance
const FACING_COS_MIN = 0.35; // ~70deg half-angle in front of the player

const SOIL_COLOR = new THREE.Color("#5b3d24");
const SOIL_RIDGE = new THREE.Color("#432c19");

function toGrowthTile(rec: TileRecord): GrowthTile | null {
  if (rec.crop == null) return null;
  return {
    plantedAt: rec.plantedAt ?? 0,
    accruedMs: rec.accruedMs ?? 0,
    lastWatered: rec.lastWatered ?? rec.plantedAt ?? 0,
  };
}

function sparkleTexture(): THREE.Texture {
  const s = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  const ctx = cv.getContext("2d")!;
  const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(255,244,180,0.95)");
  grad.addColorStop(0.5, "rgba(255,224,120,0.55)");
  grad.addColorStop(1, "rgba(255,224,120,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(cv);
}

export class Field3D {
  group = new THREE.Group();
  private soilGeo: THREE.BufferGeometry;
  private soilMat = new THREE.MeshLambertMaterial({ color: SOIL_COLOR });
  private soilMeshes = new Map<string, THREE.Mesh>();
  private cropGroups = new Map<string, THREE.Group>();
  private sparkles = new Map<string, THREE.Sprite>();
  private sparkleMat: THREE.SpriteMaterial;
  private highlight: THREE.Mesh;

  constructor() {
    this.soilGeo = new THREE.PlaneGeometry(TILE_SIZE * 0.92, TILE_SIZE * 0.92, 3, 3);
    this.soilGeo.rotateX(-Math.PI / 2);
    // ridge tint via vertex colors (alternating rows) for a tilled-furrow look
    const pos = this.soilGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const row = Math.round((pos.getZ(i) / (TILE_SIZE * 0.92) + 0.5) * 3);
      c.copy(row % 2 === 0 ? SOIL_RIDGE : SOIL_COLOR);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    this.soilGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.soilMat.vertexColors = true;

    this.sparkleMat = new THREE.SpriteMaterial({
      map: sparkleTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.8,
    });

    this.highlight = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE_SIZE * 0.98, TILE_SIZE * 0.98),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false })
    );
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.visible = false;
    this.highlight.renderOrder = 6;
    this.group.add(this.highlight);
  }

  /** Rebuild the visuals for exactly one tile from its current stored state. */
  syncTile(gx: number, gz: number, rec: TileRecord | undefined, now: number): void {
    const key = tileKey(gx, gz);
    const { x, z } = tileCenter(gx, gz);
    const y = sampleHeight(x, z);

    // soil
    let soil = this.soilMeshes.get(key);
    if (rec) {
      if (!soil) {
        soil = new THREE.Mesh(this.soilGeo, this.soilMat);
        soil.receiveShadow = true;
        soil.position.set(x, y + 0.02, z);
        this.group.add(soil);
        this.soilMeshes.set(key, soil);
      }
    } else if (soil) {
      this.group.remove(soil);
      this.soilMeshes.delete(key);
    }

    // crop
    const old = this.cropGroups.get(key);
    if (old) {
      this.group.remove(old);
      old.traverse((o) => {
        // geometries/materials are cached module-wide in cropVisuals; nothing to dispose here
        void o;
      });
      this.cropGroups.delete(key);
    }
    const gTile = rec ? toGrowthTile(rec) : null;
    let ready = false;
    if (rec && rec.crop && gTile) {
      const stage = growthStage(gTile, effectiveCrop(CROPS[rec.crop]), now);
      ready = stage === "ready";
      const visualStage: 0 | 1 | 2 = stage === "ready" ? 2 : stage;
      const cg = buildCropMesh(rec.crop, visualStage);
      cg.position.set(x, y + 0.02, z);
      this.group.add(cg);
      this.cropGroups.set(key, cg);
    }

    // sparkle
    const oldSpark = this.sparkles.get(key);
    if (ready) {
      if (!oldSpark) {
        const spr = new THREE.Sprite(this.sparkleMat);
        spr.scale.set(0.55, 0.55, 0.55);
        spr.position.set(x, y + 0.75, z);
        spr.renderOrder = 7;
        this.group.add(spr);
        this.sparkles.set(key, spr);
      }
    } else if (oldSpark) {
      this.group.remove(oldSpark);
      this.sparkles.delete(key);
    }
  }

  /** Re-sync every stored tile (boot / reload / full state swap). */
  syncAll(state: FarmState, now: number): void {
    for (let gx = 0; gx < GRID; gx++) {
      for (let gz = 0; gz < GRID; gz++) {
        const key = tileKey(gx, gz);
        const rec = state.tiles[key];
        this.syncTile(gx, gz, rec, now);
        this.lastVisual.set(key, this.visualSig(rec, now));
      }
    }
  }

  private lastVisual = new Map<string, string>();
  private visualSig(rec: TileRecord | undefined, now: number): string {
    if (!rec) return "none";
    if (!rec.crop) return "tilled";
    const g = toGrowthTile(rec);
    if (!g) return "tilled";
    return `${rec.crop}:${growthStage(g, effectiveCrop(CROPS[rec.crop]), now)}`;
  }

  /**
   * Per-frame(ish): tiles can change STAGE purely from the clock ticking (no
   * player action) — e.g. a planted turnip silently crosses into "ready"
   * while nobody is looking at it. Only touches state.tiles entries (sparse,
   * cheap) and only rebuilds a tile's mesh when its visual signature changed.
   */
  tick(state: FarmState, now: number): void {
    for (const key of Object.keys(state.tiles)) {
      const rec = state.tiles[key];
      const sig = this.visualSig(rec, now);
      if (this.lastVisual.get(key) !== sig) {
        const m = /^t_(\d+)_(\d+)$/.exec(key);
        if (!m) continue;
        this.syncTile(parseInt(m[1], 10), parseInt(m[2], 10), rec, now);
        this.lastVisual.set(key, sig);
      }
    }
  }

  // ---- transient "pop" effects (harvest/water/sell juice) -------------------
  private pops: { sprite: THREE.Sprite; born: number; life: number }[] = [];
  private popTexCache = new Map<string, THREE.Texture>();
  private popTexture(emoji: string): THREE.Texture {
    let t = this.popTexCache.get(emoji);
    if (t) return t;
    const s = 64;
    const cv = document.createElement("canvas");
    cv.width = cv.height = s;
    const ctx = cv.getContext("2d")!;
    ctx.font = "44px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, s / 2, s / 2 + 2);
    t = new THREE.CanvasTexture(cv);
    this.popTexCache.set(emoji, t);
    return t;
  }

  spawnPop(x: number, y: number, z: number, emoji: string): void {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.popTexture(emoji), transparent: true, depthWrite: false }));
    spr.position.set(x, y, z);
    spr.scale.set(0.01, 0.01, 0.01);
    spr.renderOrder = 8;
    this.group.add(spr);
    this.pops.push({ sprite: spr, born: performance.now(), life: 650 });
  }

  private animatePops(): void {
    const t = performance.now();
    this.pops = this.pops.filter((p) => {
      const age = t - p.born;
      if (age > p.life) {
        this.group.remove(p.sprite);
        return false;
      }
      const f = age / p.life;
      const s = 0.55 * Math.min(1, f * 3.2) * (1 - 0.15 * f);
      p.sprite.scale.set(s, s, s);
      p.sprite.position.y += 0.01; // gentle rise, ~called once per rendered frame
      (p.sprite.material as THREE.SpriteMaterial).opacity = 1 - Math.max(0, f - 0.6) / 0.4;
      return true;
    });
  }

  // ---- pooled particle bursts (dirt flecks / water droplets / seed specks) ---
  private bursts: { mesh: THREE.Mesh; vx: number; vy: number; vz: number; born: number; life: number }[] = [];
  private burstGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  private burstMatCache = new Map<number, THREE.MeshBasicMaterial>();

  /** Fire a small burst of `count` particles from (x,y,z). up biases upward velocity. */
  spawnBurst(x: number, y: number, z: number, color: number, count = 8, up = 1): void {
    let mat = this.burstMatCache.get(color);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color });
      this.burstMatCache.set(color, mat);
    }
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.burstGeo, mat);
      mesh.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const spd = 0.03 + Math.random() * 0.05;
      this.group.add(mesh);
      this.bursts.push({
        mesh,
        vx: Math.cos(a) * spd,
        vz: Math.sin(a) * spd,
        vy: (0.06 + Math.random() * 0.06) * up,
        born: performance.now(),
        life: 500 + Math.random() * 250,
      });
    }
  }

  private animateBursts(): void {
    const t = performance.now();
    this.bursts = this.bursts.filter((p) => {
      const age = t - p.born;
      if (age > p.life) {
        this.group.remove(p.mesh);
        return false;
      }
      p.vy -= 0.006; // gravity per frame
      p.mesh.position.x += p.vx;
      p.mesh.position.y += p.vy;
      p.mesh.position.z += p.vz;
      const f = age / p.life;
      p.mesh.scale.setScalar(Math.max(0.05, 1 - f));
      return true;
    });
  }

  /** Per-frame: pulse ready-tile sparkles + advance pop/burst effects. Cheap. */
  animate(t: number): void {
    this.animatePops();
    this.animateBursts();
    for (const spr of this.sparkles.values()) {
      const s = 0.45 + 0.15 * (0.5 + 0.5 * Math.sin(t * 3.2));
      spr.scale.set(s, s, s);
      (spr.material as THREE.SpriteMaterial).opacity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3.2 + 1));
    }
  }

  setHighlightTile(gx: number | null, gz: number | null, color: number): void {
    if (gx == null || gz == null) {
      this.highlight.visible = false;
      return;
    }
    const { x, z } = tileCenter(gx, gz);
    const y = sampleHeight(x, z);
    this.highlight.position.set(x, y + 0.05, z);
    (this.highlight.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.highlight.visible = true;
  }
}

/**
 * Facing-aware tile targeting (Bistro lesson: distance-only resolution picks
 * the wrong corner-adjacent tile). Only tiles within REACH *and* roughly in
 * front of the player (dot product with heading above FACING_COS_MIN) are
 * candidates; among those, prefer the most aligned, then the closest.
 */
export function findTargetTile(px: number, pz: number, heading: number): { gx: number; gz: number } | null {
  const fwd = { x: Math.sin(heading), z: Math.cos(heading) };
  const aimX = px + fwd.x * (REACH * 0.55);
  const aimZ = pz + fwd.z * (REACH * 0.55);
  const near = worldToTile(aimX, aimZ);

  let best: { gx: number; gz: number } | null = null;
  let bestScore = -Infinity;
  const searchGx = near ? [near.gx - 1, near.gx, near.gx + 1] : [];
  const searchGz = near ? [near.gz - 1, near.gz, near.gz + 1] : [];
  const candidates: { gx: number; gz: number }[] = [];
  if (near) {
    for (const gx of searchGx) for (const gz of searchGz) candidates.push({ gx, gz });
  } else {
    // player standing just outside the field: still allow targeting the nearest
    // edge row/col within reach by scanning the whole grid (12x12, cheap).
    for (let gx = 0; gx < GRID; gx++) for (let gz = 0; gz < GRID; gz++) candidates.push({ gx, gz });
  }

  for (const { gx, gz } of candidates) {
    if (gx < 0 || gx >= GRID || gz < 0 || gz >= GRID) continue;
    const { x, z } = tileCenter(gx, gz);
    const dx = x - px;
    const dz = z - pz;
    const dist = Math.hypot(dx, dz);
    if (dist > REACH) continue;
    const dirx = dist > 1e-4 ? dx / dist : fwd.x;
    const dirz = dist > 1e-4 ? dz / dist : fwd.z;
    const align = dirx * fwd.x + dirz * fwd.z;
    if (dist > 0.15 && align < FACING_COS_MIN) continue; // require roughly in front
    const score = align - dist * 0.06;
    if (score > bestScore) {
      bestScore = score;
      best = { gx, gz };
    }
  }
  return best;
}

/**
 * Derive a tile's gameplay-facing TileState from its stored record + the clock.
 * The tool/auto action resolver (farm/action.ts) consumes this — keeping the
 * "what state is this tile in" logic here (with growth math) and the "what does
 * the equipped tool do about it" logic pure and separately testable.
 */
export function computeTileState(rec: TileRecord | undefined, now: number): TileState {
  if (!rec) return "untouched";
  if (!rec.crop) return "tilled";
  const gTile = toGrowthTile(rec)!;
  const crop = effectiveCrop(CROPS[rec.crop]);
  const stage = growthStage(gTile, crop, now);
  if (stage === "ready") return "ready";
  if (needsWater(gTile, crop, now)) return "thirsty";
  return "growing";
}
