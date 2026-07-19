// Print per-node translation ranges for animation channels (find root motion).
import { NodeIO } from "@gltf-transform/core";
const io = new NodeIO();
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  console.log("==", f);
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      if (ch.getTargetPath() !== "translation") continue;
      const name = ch.getTargetNode().getName();
      const arr = ch.getSampler().getOutput().getArray();
      const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < arr.length; i += 3)
        for (let k = 0; k < 3; k++) { mins[k] = Math.min(mins[k], arr[i+k]); maxs[k] = Math.max(maxs[k], arr[i+k]); }
      const rng = [0,1,2].map(k => (maxs[k]-mins[k]).toFixed(4));
      if (Math.max(...rng.map(Number)) > 0.001)
        console.log(`  ${anim.getName()} ${name}: range x=${rng[0]} y=${rng[1]} z=${rng[2]}`);
    }
  }
}
