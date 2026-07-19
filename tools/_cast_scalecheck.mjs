// Check whether animation scale tracks are constant ~1.0 (safe to strip).
import { NodeIO } from "@gltf-transform/core";
const io = new NodeIO();
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  let lo = Infinity, hi = -Infinity, tracks = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      if (ch.getTargetPath() !== "scale") continue;
      tracks++;
      const arr = ch.getSampler().getOutput().getArray();
      for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  console.log(`${f}: scaleTracks=${tracks} min=${lo.toFixed(6)} max=${hi.toFixed(6)}`);
}
