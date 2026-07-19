// One-off cast-pipeline helper: shrink converted GLBs into the house pattern
// (base GLB = mesh+skeleton only · clip GLBs = animation+nodes only, no mesh).
// usage: node tools/_cast_split.mjs strip-mesh  in.glb out.glb
//        node tools/_cast_split.mjs strip-anims in.glb out.glb
import { NodeIO } from "@gltf-transform/core";
import { prune } from "@gltf-transform/functions";

const [mode, src, dst] = process.argv.slice(2);
if (!mode || !src || !dst) {
  console.error("usage: _cast_split.mjs strip-mesh|strip-anims in.glb out.glb");
  process.exit(1);
}

const io = new NodeIO();
const doc = await io.read(src);
const root = doc.getRoot();

if (mode === "strip-mesh") {
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const m of root.listMaterials()) m.dispose();
  for (const t of root.listTextures()) t.dispose();
} else if (mode === "strip-anims") {
  for (const a of root.listAnimations()) a.dispose();
} else if (mode === "strip-scale") {
  // constant-1.0 scale tracks from the Blender FBX round-trip: pure bloat.
  // NEVER strip position tracks here — Tripo bakes meaningful per-bone positions.
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      if (ch.getTargetPath() === "scale") ch.dispose();
    }
  }
} else {
  console.error("unknown mode " + mode);
  process.exit(1);
}

await doc.transform(prune());
await io.write(dst, doc);

const anims = root.listAnimations().map(a => a.getName());
console.log(`${dst}: meshes=${root.listMeshes().length} skins=${root.listSkins().length} anims=[${anims.join(",")}]`);
