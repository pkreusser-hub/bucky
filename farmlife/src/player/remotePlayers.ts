import * as THREE from "three";
import { buildFarmer, type Farmer, type ToolAnimKind } from "./player";
import type { LoadedModel } from "../world/gltfAssets";
import { buildTool } from "./tools";
import { makeNameTag, type NameTag } from "./nameTag";
import { makeEmoteBubble, type EmoteBubble, type EmoteKind } from "./emote";
import { sampleHeight } from "../world/terrain";
import { shirtTint } from "../net/presenceUtil";
import type { ToolId } from "../farm/action";
import type { Presence } from "../net/presence";

// ---------------------------------------------------------------------------
// RemotePlayers (P3 render layer) — builds/updates/disposes a chunky farmer
// avatar per remote presence. Each gets a deterministic shirt TINT, a floating
// NAME TAG, and an EMOTE bubble. Positions come interpolated from Presence
// (~120ms buffer); gait is derived from interpolated speed; tool-use anims and
// emotes replay via Presence's exactly-once seqs. Remote avatars are cosmetic:
// they do NOT collide with the local player (cozy, no griefing) and never
// touch farm state.
// ---------------------------------------------------------------------------

interface Avatar {
  farmer: Farmer;
  nameTag: NameTag;
  bubble: EmoteBubble;
  tool: ToolId | null;
  toolMesh: THREE.Object3D | null;
}

export class RemotePlayers {
  private avatars = new Map<string, Avatar>();
  private _camPos = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private maxSpeed: number
  ) {}

  add(id: string, name: string): void {
    if (this.avatars.has(id)) return;
    const farmer = buildFarmer({ shirt: shirtTint(name) });
    const nameTag = makeNameTag(name, shirtTint(name));
    nameTag.sprite.position.set(0, 2.35, 0);
    farmer.root.add(nameTag.sprite);
    const bubble = makeEmoteBubble();
    bubble.sprite.position.set(0, 2.75, 0);
    farmer.root.add(bubble.sprite);
    // start off-screen until the first snapshot seats it
    farmer.root.position.set(0, -50, 0);
    this.scene.add(farmer.root);
    this.avatars.set(id, { farmer, nameTag, bubble, tool: null, toolMesh: null });
  }

  /** Upgrade every current avatar (and any built later — buildFarmer picks up
   * the loaded template automatically) to the rigged GLB. The held tool mesh is
   * re-attached to the new hand by upgradeToModel; re-apply it here defensively. */
  upgradeAll(tpl: LoadedModel): void {
    for (const a of this.avatars.values()) {
      a.farmer.upgradeToModel(tpl);
      if (a.toolMesh) a.farmer.setHeldTool(a.toolMesh);
    }
  }

  remove(id: string): void {
    const a = this.avatars.get(id);
    if (!a) return;
    this.scene.remove(a.farmer.root);
    a.nameTag.dispose();
    a.bubble.dispose();
    disposeTree(a.farmer.root);
    this.avatars.delete(id);
  }

  playAnim(id: string, kind: ToolAnimKind): void {
    this.avatars.get(id)?.farmer.playToolAnim(kind);
  }

  showEmote(id: string, kind: EmoteKind): void {
    this.avatars.get(id)?.bubble.show(kind);
  }

  has(id: string): boolean {
    return this.avatars.has(id);
  }
  count(): number {
    return this.avatars.size;
  }

  // ---- test/debug read hooks (verify-p3) ------------------------------------
  ids(): string[] {
    return [...this.avatars.keys()];
  }
  pos(id: string): { x: number; y: number; z: number } | null {
    const a = this.avatars.get(id);
    if (!a) return null;
    const p = a.farmer.root.position;
    return { x: p.x, y: p.y, z: p.z };
  }
  tool(id: string): ToolId | null {
    return this.avatars.get(id)?.tool ?? null;
  }
  armQuat(id: string): [number, number, number, number] | null {
    const a = this.avatars.get(id);
    if (!a) return null;
    const q = a.farmer.armPivot.quaternion;
    return [q.x, q.y, q.z, q.w];
  }
  busy(id: string): boolean {
    return this.avatars.get(id)?.farmer.isBusy() ?? false;
  }
  usesModel(id: string): boolean {
    return this.avatars.get(id)?.farmer.usesModel() ?? false;
  }
  /** Hex colours of every mesh material under the avatar (tint-distinctness
   * check: two differently-tinted avatars return different colour sets). */
  bodyColors(id: string): number[] {
    const a = this.avatars.get(id);
    if (!a) return [];
    const out: number[] = [];
    a.farmer.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mt of mats) {
        const c = (mt as THREE.MeshLambertMaterial).color;
        if (c) out.push(c.getHex());
      }
    });
    return out;
  }
  /** World-space Y of the name tag sprite minus the avatar's feet — proves the
   * tag floats above the head regardless of rig height. */
  nameTagLiftY(id: string): number | null {
    const a = this.avatars.get(id);
    if (!a) return null;
    const w = new THREE.Vector3();
    a.nameTag.sprite.getWorldPosition(w);
    return w.y - a.farmer.root.position.y;
  }
  emoteVisible(id: string): boolean {
    return this.avatars.get(id)?.bubble.sprite.visible ?? false;
  }

  update(dt: number, presence: Presence, camera: THREE.Camera): void {
    camera.getWorldPosition(this._camPos);
    for (const [id, a] of this.avatars) {
      const s = presence.sample(id);
      if (s) {
        a.farmer.root.position.set(s.x, s.y, s.z);
        a.farmer.root.rotation.y = s.heading;
        const groundY = sampleHeight(s.x, s.z);
        const airborne = s.y > groundY + 0.2;
        a.farmer.update(dt, s.speed, this.maxSpeed, airborne);
        // swap held tool mesh when the equipped tool changes
        if (s.tool !== a.tool) {
          a.tool = s.tool;
          const mesh = buildTool(s.tool);
          a.toolMesh = mesh;
          a.farmer.setHeldTool(mesh);
        }
      } else {
        // no data yet — keep animating idle in place (still off-screen)
        a.farmer.update(dt, 0, this.maxSpeed, false);
      }
      a.nameTag.update(this._camPos);
      a.bubble.update(dt);
    }
  }
}

function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}
