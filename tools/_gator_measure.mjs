// Measure the ORIGINAL gator GLB in raw glTF space (Y-up): body bbox, the four
// baked-in wheels' axle centers + radii (corner clustering of low, dark-side verts).
// No Blender frames involved — these numbers are ground truth for the rebuild.
import { NodeIO } from "@gltf-transform/core";

const io = new NodeIO();
const doc = await io.read(process.argv[2]);
const mesh = doc.getRoot().listMeshes()[0];
const prim = mesh.listPrimitives()[0];
const pos = prim.getAttribute("POSITION").getArray();

let min = [1e9,1e9,1e9], max = [-1e9,-1e9,-1e9];
for (let i = 0; i < pos.length; i += 3)
  for (let k = 0; k < 3; k++){ min[k] = Math.min(min[k], pos[i+k]); max[k] = Math.max(max[k], pos[i+k]); }
const size = max.map((v,k) => v - min[k]);
console.log("body bbox min", min.map(v=>v.toFixed(3)), "max", max.map(v=>v.toFixed(3)), "size", size.map(v=>v.toFixed(3)));

// Long axis = forward axis (X or Z). Wheels sit low (bottom 45% of height).
const longAxis = size[0] > size[2] ? 0 : 2;
const latAxis = longAxis === 0 ? 2 : 0;
console.log("long (forward) axis:", longAxis === 0 ? "X" : "Z");

const yCut = min[1] + size[1] * 0.45;
// 4 corner seeds: (±long extent*0.32, low, ±lat extent*0.5)
const seeds = [];
for (const sl of [-1, 1]) for (const st of [-1, 1]) {
  const c = [0,0,0];
  c[longAxis] = (min[longAxis]+max[longAxis])/2 + sl * size[longAxis] * 0.30;
  c[latAxis]  = (min[latAxis]+max[latAxis])/2 + st * size[latAxis] * 0.38;
  c[1] = min[1] + size[1] * 0.18;
  seeds.push({ sl, st, c, pts: [] });
}
// assign low verts to nearest seed if within a generous radius
const maxR = Math.min(size[longAxis], size[latAxis]) * 0.30;
for (let i = 0; i < pos.length; i += 3){
  const p = [pos[i], pos[i+1], pos[i+2]];
  if (p[1] > yCut) continue;
  let best = null, bd = 1e9;
  for (const s of seeds){
    const d = Math.hypot(p[0]-s.c[0], p[1]-s.c[1], p[2]-s.c[2]);
    if (d < bd){ bd = d; best = s; }
  }
  if (bd < maxR) best.pts.push(p);
}
for (const s of seeds){
  if (!s.pts.length){ console.log("seed", s.sl, s.st, "EMPTY"); continue; }
  const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
  for (const p of s.pts) for (let k=0;k<3;k++){ mn[k]=Math.min(mn[k],p[k]); mx[k]=Math.max(mx[k],p[k]); }
  const ctr = mn.map((v,k)=>(v+mx[k])/2);
  const dia = Math.max(mx[longAxis]-mn[longAxis], mx[1]-mn[1]); // wheel diameter in long/vertical plane
  const width = mx[latAxis]-mn[latAxis];
  console.log(`wheel long=${s.sl>0?"+":"-"} lat=${s.st>0?"+":"-"}: center [${ctr.map(v=>v.toFixed(3))}] dia ${dia.toFixed(3)} width ${width.toFixed(3)} verts ${s.pts.length}`);
}

// steering wheel: tall geometry forward of the seat (orig frame: up=Y, fwd=+X)
{
  let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9], n = 0;
  for (let i = 0; i < pos.length; i += 3){
    const x = pos[i], y = pos[i+1], z = pos[i+2];
    if (y < 0.14 || y > 0.30 || x < 0.02 || x > 0.35 || Math.abs(z) > 0.2) continue;
    mn[0]=Math.min(mn[0],x); mn[1]=Math.min(mn[1],y); mn[2]=Math.min(mn[2],z);
    mx[0]=Math.max(mx[0],x); mx[1]=Math.max(mx[1],y); mx[2]=Math.max(mx[2],z);
    n++;
  }
  const c = mn.map((v,k)=>(v+mx[k])/2);
  console.log(`steer cluster: n=${n} center orig[${c.map(v=>v.toFixed(3))}] size [${mx.map((v,k)=>(v-mn[k]).toFixed(3))}]`);
  console.log(`steer center blender-final: (${(-c[2]).toFixed(3)}, ${(-c[0]).toFixed(3)}, ${c[1].toFixed(3)})`);
}
