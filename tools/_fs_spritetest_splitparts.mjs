#!/usr/bin/env node
/* _fs_spritetest_splitparts.mjs — FARMSTEAD sprite-test LOOK TEST (exploration
 * only, never shipped/committed). Splits ONE downloaded GLB into rigid
 * body / legL / legR parts, exactly the pattern documented in
 * assets/farmstead/cast/villager/REPORT.md and consumed by
 * farmstead-proto/sprite/sprite-impostor.js (IMP.makeRig): a leg's local
 * origin is its OWN hip, so the runtime rig just parents it to a Group
 * positioned at the measured hip offset and rotates that Group for the walk
 * swing — no skinning, no armature ships.
 *
 * CLASSIFICATION (chosen per source, printed either way):
 *   skin   — dominant vertex-group (JOINTS_0/WEIGHTS_0) among the Tripo v1.0
 *            biped leg-chain joint names. Used when the source has a skin
 *            (the dwarf).
 *   plane  — geometric: worldY > cutoff -> body, else split by sign(x).
 *            Used when there is no skin at all (the knight). The cutoff is a
 *            CLI arg, chosen by eyeballing a Blender vertex-colour preview
 *            first (see tools/_fs_spritetest_splitpreview.py) — not guessed.
 *
 * ARM RE-POSE (both models ship in a T-pose — arms straight out to the sides,
 * which is fine for a rigging reference but bakes to a tiny, spread-eagle
 * sprite: the T-pose's ~1.0-unit arm SPAN, not the ~0.79-0.99-unit standing
 * HEIGHT, ends up driving the locked-scale frustum, and the character reads
 * as a starfish instead of a standing villager/knight. Found by actually
 * looking at cropped bake cells — not assumed up front, the task brief did
 * not ask for it, but a fair "does this look right" test cannot be done on a
 * T-pose). Both arms are rotated DOWN toward the sides about a per-side
 * SHOULDER PIVOT (same "closest-vertices-to-the-joint" measurement technique
 * as the leg hip pivot, just keyed on smallest |x| instead of largest y),
 * rotating in the XY plane (world Z axis) by ARM_ROT_DEG — a REST-SHAPE edit
 * baked into the exported geometry once, not an animated rig; walk/idle/work
 * poses never touch the arms. Classification is skin-weight based for the
 * dwarf (Clavicle+Upperarm+Forearm+Hand chain) and a measured |x| cutoff for
 * the un-skinned knight (see the histogram this script prints with
 * --dumpArmHist).
 *
 * Also normalizes: uniform scale to a target standing height (feet already
 * sit at y=0 and the model is already X/Z-centred on both test sources, so no
 * translation/recentring of the BODY part is needed — verified via
 * scratchpad/inspect_models.mjs before this script was written), and fixes
 * materials to the house flat-Lambert convention: metallicFactor 0, normal +
 * metallic-roughness textures DROPPED (kept only baseColor, already <=512px
 * on both sources so no resize needed — see [[gltf-linear-color-gotcha]]).
 *
 *   node tools/_fs_spritetest_splitparts.mjs \
 *     --src "C:/Users/pkreu/Downloads/cartoon+dwarf+3d+model.glb" \
 *     --name dwarf --mode skin --height 0.79 \
 *     --out assets/farmstead/cast/sprites-test/parts
 *
 *   node tools/_fs_spritetest_splitparts.mjs \
 *     --src "C:/Users/pkreu/Downloads/medieval+knight+3d+model.glb" \
 *     --name knight --mode plane --cutoff 0.32 --height 0.9985 \
 *     --armCutoff 0.24 --armYmin 0.40 --armYmax 0.90 \
 *     --out assets/farmstead/cast/sprites-test/parts
 */
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const REPO = "C:/Users/pkreu/OneDrive/Documents/BUCKY";
const CORE_URL = pathToFileURL(REPO + "/tools/node_modules/@gltf-transform/core/dist/index.js").href;
const { NodeIO, Document, Accessor } = await import(CORE_URL);

const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
}
const flag = (n) => argv.includes("--" + n);
const SRC = arg("src");
const NAME = arg("name");
const MODE = arg("mode", "skin");           // skin | plane
const CUTOFF = parseFloat(arg("cutoff", "0.32"));
const TARGET_H = parseFloat(arg("height", "0.79"));
const OUT_DIR = path.resolve(REPO, arg("out", "assets/farmstead/cast/sprites-test/parts"));
const ARM_ROT_DEG = parseFloat(arg("armRotDeg", "75"));
const ARM_CUTOFF = parseFloat(arg("armCutoff", "0.24"));      // plane mode only
const ARM_YMIN = parseFloat(arg("armYmin", "0.40"));
const ARM_YMAX = parseFloat(arg("armYmax", "0.90"));

const LEG_L = new Set(["L_Thigh", "L_Calf", "L_Foot", "L_ToeBase", "L_ThighTwist01", "L_ThighTwist02", "L_CalfTwist01", "L_CalfTwist02"]);
const LEG_R = new Set(["R_Thigh", "R_Calf", "R_Foot", "R_ToeBase", "R_ThighTwist01", "R_ThighTwist02", "R_CalfTwist01", "R_CalfTwist02"]);
const ARM_L = new Set(["L_Clavicle", "L_Upperarm", "L_Forearm", "L_Hand", "L_UpperarmTwist01", "L_UpperarmTwist02", "L_ForearmTwist01", "L_ForearmTwist02"]);
const ARM_R = new Set(["R_Clavicle", "R_Upperarm", "R_Forearm", "R_Hand", "R_UpperarmTwist01", "R_UpperarmTwist02", "R_ForearmTwist01", "R_ForearmTwist02"]);

const io = new NodeIO();
const srcDoc = await io.read(SRC);
const srcRoot = srcDoc.getRoot();

// ---- find the main mesh primitive (largest by vertex count) ----
let mainPrim = null;
for (const mesh of srcRoot.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const p = prim.getAttribute("POSITION");
    if (p && (!mainPrim || p.getCount() > mainPrim.getAttribute("POSITION").getCount())) mainPrim = prim;
  }
}
if (!mainPrim) throw new Error("no mesh primitive found in " + SRC);

const posAcc = mainPrim.getAttribute("POSITION");
const nrmAcc = mainPrim.getAttribute("NORMAL");
const uvAcc = mainPrim.getAttribute("TEXCOORD_0");
const idxAcc = mainPrim.getIndices();
const positions = posAcc.getArray();      // Float32Array, len = vcount*3 — READ ONLY from here down
const normals = nrmAcc ? nrmAcc.getArray() : null;
const uvs = uvAcc ? uvAcc.getArray() : null;
const indices = idxAcc ? idxAcc.getArray() : null;
const vcount = posAcc.getCount();
const triCount = indices ? indices.length / 3 : vcount / 3;

const srcMaterial = mainPrim.getMaterial();
const srcBaseColorTexInfo = srcMaterial ? srcMaterial.getBaseColorTexture() : null;
if (!srcBaseColorTexInfo) throw new Error("no baseColor texture found");
const baseColorImage = srcBaseColorTexInfo.getImage();
const baseColorMime = srcBaseColorTexInfo.getMimeType();

const bmin = posAcc.getMin([]), bmax = posAcc.getMax([]);
const rawHeight = bmax[1] - bmin[1];
const SCALE = TARGET_H / rawHeight;
console.log(`[${NAME}] source verts=${vcount} tris=${Math.round(triCount)} rawHeight=${rawHeight.toFixed(5)} -> target=${TARGET_H} scale=${SCALE.toFixed(5)}`);
console.log(`[${NAME}] bbox min=${bmin.map((v) => v.toFixed(4))} max=${bmax.map((v) => v.toFixed(4))}`);

/* ---- LEG region: 0 body, 1 legL, 2 legR ---- */
const region = new Uint8Array(vcount);
/* ---- ARM side: 0 none, 1 L, 2 R (independent of `region` — an arm vertex is
 * still counted as `region===0` body for the purposes of the leg split; the
 * arm rotation below is applied to the RAW position/normal arrays BEFORE any
 * region is exported, so every consumer downstream sees the re-posed shape) */
const armSide = new Uint8Array(vcount);

let jointNames = null, jArr = null, wArr = null;
if (MODE === "skin") {
  const skin = srcRoot.listSkins()[0];
  if (!skin) throw new Error("mode=skin requested but source has no skin");
  jointNames = skin.listJoints().map((j) => j.getName());
  const jAcc = mainPrim.getAttribute("JOINTS_0");
  const wAcc = mainPrim.getAttribute("WEIGHTS_0");
  if (!jAcc || !wAcc) throw new Error("mode=skin requested but primitive has no JOINTS_0/WEIGHTS_0");
  jArr = jAcc.getArray(); wArr = wAcc.getArray();
  for (let v = 0; v < vcount; v++) {
    let bestJ = -1, bestW = -1;
    for (let k = 0; k < 4; k++) {
      const w = wArr[v * 4 + k];
      if (w > bestW) { bestW = w; bestJ = jArr[v * 4 + k]; }
    }
    const jointName = jointNames[bestJ];
    region[v] = LEG_L.has(jointName) ? 1 : LEG_R.has(jointName) ? 2 : 0;
    armSide[v] = ARM_L.has(jointName) ? 1 : ARM_R.has(jointName) ? 2 : 0;
  }
} else if (MODE === "plane") {
  for (let v = 0; v < vcount; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1];
    region[v] = y > CUTOFF ? 0 : (x > 0 ? 1 : 2);
    if (y > ARM_YMIN && y < ARM_YMAX && Math.abs(x) > ARM_CUTOFF) armSide[v] = x > 0 ? 1 : 2;
  }
} else throw new Error("unknown mode " + MODE);

if (flag("dumpArmHist")) {
  const xs = [];
  for (let v = 0; v < vcount; v++) { const y = positions[v * 3 + 1]; if (y > ARM_YMIN && y < ARM_YMAX) xs.push(Math.abs(positions[v * 3])); }
  xs.sort((a, b) => a - b);
  console.log(`[${NAME}] arm-band |x| n=${xs.length} min=${xs[0]?.toFixed(3)} max=${xs[xs.length - 1]?.toFixed(3)}`);
}

const rc = [0, 0, 0];
for (let v = 0; v < vcount; v++) rc[region[v]]++;
console.log(`[${NAME}] leg region counts: body=${rc[0]} legL=${rc[1]} legR=${rc[2]}`);
const ac = [0, 0, 0];
for (let v = 0; v < vcount; v++) ac[armSide[v]]++;
console.log(`[${NAME}] arm side counts: none=${ac[0]} armL=${ac[1]} armR=${ac[2]}`);

/* ---- generic pivot finder: among vertices where `mask[v]===want`, rank by
 * key(v) ascending and average the smallest `frac` fraction (the "closest to
 * the joint" band). Used for both the leg hip pivot (key = -y, closest to the
 * torso = highest y) and the arm shoulder pivot (key = |x|, closest to the
 * torso = smallest |x|). ---- */
function pivotOf(mask, want, keyFn, frac) {
  const idxs = [];
  for (let v = 0; v < vcount; v++) if (mask[v] === want) idxs.push(v);
  if (!idxs.length) return null;
  idxs.sort((a, b) => keyFn(a) - keyFn(b));
  const n = Math.max(1, Math.round(idxs.length * frac));
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < n; i++) {
    const v = idxs[i];
    sx += positions[v * 3]; sy += positions[v * 3 + 1]; sz += positions[v * 3 + 2];
  }
  return { x: sx / n, y: sy / n, z: sz / n, n };
}
const hipL = pivotOf(region, 1, (v) => -positions[v * 3 + 1], 0.12);
const hipR = pivotOf(region, 2, (v) => -positions[v * 3 + 1], 0.12);
const shoulderL = pivotOf(armSide, 1, (v) => Math.abs(positions[v * 3]), 0.15);
const shoulderR = pivotOf(armSide, 2, (v) => Math.abs(positions[v * 3]), 0.15);
console.log(`[${NAME}] hipL(raw)=`, hipL, ` hipR(raw)=`, hipR);
console.log(`[${NAME}] shoulderL(raw)=`, shoulderL, ` shoulderR(raw)=`, shoulderR);

/* ---- REST-SHAPE ARM ROTATION, applied to RAW position/normal data before
 * any region export. Rotation is in the XY plane (about world Z) around each
 * side's shoulder pivot: L (+x side) rotates by -ARM_ROT_DEG (T-pose +x arm
 * swings toward -y = down), R (-x side) by +ARM_ROT_DEG (mirror). Derivation:
 * rotating point (r,0) by theta gives (r*cos(theta), r*sin(theta)); reaching
 * straight down (0,-r) needs theta=-90 for the +x-starting L arm and +90 for
 * the -x-starting R arm — ARM_ROT_DEG<90 leaves a natural stand-off instead
 * of glueing the hand to the hip. ---- */
const adjPos = new Float32Array(positions);
const adjNrm = normals ? new Float32Array(normals) : null;
function rotateVertex(v, pivot, deg) {
  const rad = deg * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const x = positions[v * 3], y = positions[v * 3 + 1];
  const dx = x - pivot.x, dy = y - pivot.y;
  adjPos[v * 3] = pivot.x + dx * c - dy * s;
  adjPos[v * 3 + 1] = pivot.y + dx * s + dy * c;
  // z untouched by a Z-axis rotation
  if (adjNrm) {
    const nx = normals[v * 3], ny = normals[v * 3 + 1];
    adjNrm[v * 3] = nx * c - ny * s;
    adjNrm[v * 3 + 1] = nx * s + ny * c;
  }
}
let armRotated = 0;
if (shoulderL) for (let v = 0; v < vcount; v++) if (armSide[v] === 1) { rotateVertex(v, shoulderL, -ARM_ROT_DEG); armRotated++; }
if (shoulderR) for (let v = 0; v < vcount; v++) if (armSide[v] === 2) { rotateVertex(v, shoulderR, ARM_ROT_DEG); armRotated++; }
console.log(`[${NAME}] arm-rotated ${armRotated} verts by ±${ARM_ROT_DEG}deg about the measured shoulder pivots`);

// re-measure height/bbox AFTER the arm re-pose (this is what actually gets scaled+baked)
{
  let ymin = 1e9, ymax = -1e9, xmin = 1e9, xmax = -1e9;
  for (let v = 0; v < vcount; v++) {
    const x = adjPos[v * 3], y = adjPos[v * 3 + 1];
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
  }
  console.log(`[${NAME}] POST-ARM-REPOSE bbox y=[${ymin.toFixed(4)},${ymax.toFixed(4)}] x=[${xmin.toFixed(4)},${xmax.toFixed(4)}]  (height=${(ymax - ymin).toFixed(4)}, width=${(xmax - xmin).toFixed(4)})`);
}

/* ---- per-face majority vote on the LEG region -> assign each triangle ---- */
const faceRegion = new Uint8Array(triCount);
const facesByRegion = [[], [], []];
for (let f = 0; f < triCount; f++) {
  const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2];
  const cnt = [0, 0, 0];
  cnt[region[a]]++; cnt[region[b]]++; cnt[region[c]]++;
  let best = 0;
  if (cnt[1] > cnt[best]) best = 1;
  if (cnt[2] > cnt[best]) best = 2;
  faceRegion[f] = best;
  facesByRegion[best].push([a, b, c]);
}
console.log(`[${NAME}] face region counts: body=${facesByRegion[0].length} legL=${facesByRegion[1].length} legR=${facesByRegion[2].length}`);

/* ---- build one output GLB per LEG region, reading from the ARM-ADJUSTED
 * position/normal arrays so the exported "body" already carries the re-posed
 * arms (legL/legR never intersect the arm classification, but read from the
 * adjusted arrays too for uniformity — a no-op for them in practice). ---- */
fs.mkdirSync(OUT_DIR, { recursive: true });
const measurements = {
  name: NAME, mode: MODE, cutoff: MODE === "plane" ? CUTOFF : null,
  rawHeight, targetHeight: TARGET_H, scale: SCALE, srcTris: Math.round(triCount), srcVerts: vcount,
  armRotDeg: ARM_ROT_DEG, armCutoff: MODE === "plane" ? ARM_CUTOFF : null,
  regionVertCounts: { body: rc[0], legL: rc[1], legR: rc[2] }, armSideCounts: { none: ac[0], armL: ac[1], armR: ac[2] },
  regionFaceCounts: { body: facesByRegion[0].length, legL: facesByRegion[1].length, legR: facesByRegion[2].length },
  hip: {},
};

function buildPart(regionIdx, tag, hip) {
  const faces = facesByRegion[regionIdx];
  if (!faces.length) return null;
  const remap = new Map();
  const outPos = [], outNrm = [], outUv = [];
  function mapVert(oldIdx) {
    let ni = remap.get(oldIdx);
    if (ni !== undefined) return ni;
    ni = remap.size;
    remap.set(oldIdx, ni);
    const px = adjPos[oldIdx * 3], py = adjPos[oldIdx * 3 + 1], pz = adjPos[oldIdx * 3 + 2];
    const ox = hip ? px - hip.x : px, oy = hip ? py - hip.y : py, oz = hip ? pz - hip.z : pz;
    outPos.push(ox * SCALE, oy * SCALE, oz * SCALE);
    if (adjNrm) outNrm.push(adjNrm[oldIdx * 3], adjNrm[oldIdx * 3 + 1], adjNrm[oldIdx * 3 + 2]);
    if (uvs) outUv.push(uvs[oldIdx * 2], uvs[oldIdx * 2 + 1]);
    return ni;
  }
  const outIdx = [];
  for (const [a, b, c] of faces) { outIdx.push(mapVert(a), mapVert(b), mapVert(c)); }

  const doc = new Document();
  const buffer = doc.createBuffer();
  const posA = doc.createAccessor().setType(Accessor.Type.VEC3).setArray(new Float32Array(outPos)).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute("POSITION", posA);
  if (adjNrm) {
    const nA = doc.createAccessor().setType(Accessor.Type.VEC3).setArray(new Float32Array(outNrm)).setBuffer(buffer);
    prim.setAttribute("NORMAL", nA);
  }
  if (uvs) {
    const uA = doc.createAccessor().setType(Accessor.Type.VEC2).setArray(new Float32Array(outUv)).setBuffer(buffer);
    prim.setAttribute("TEXCOORD_0", uA);
  }
  const idxA = doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(new Uint32Array(outIdx)).setBuffer(buffer);
  prim.setIndices(idxA);

  const tex = doc.createTexture(NAME + "-" + tag).setImage(baseColorImage).setMimeType(baseColorMime);
  const mat = doc.createMaterial(NAME + "-" + tag)
    .setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(1)
    .setNormalTexture(null).setMetallicRoughnessTexture(null);
  prim.setMaterial(mat);

  const mesh = doc.createMesh(NAME + "-" + tag).addPrimitive(prim);
  const node = doc.createNode(NAME + "-" + tag).setMesh(mesh);
  const scene = doc.createScene().addChild(node);
  doc.getRoot().setDefaultScene(scene);
  return { doc, vcountOut: remap.size, tris: outIdx.length / 3 };
}

const body = buildPart(0, "body", null);
const legL = buildPart(1, "legL", hipL);
const legR = buildPart(2, "legR", hipR);

for (const [tag, part] of [["body", body], ["legL", legL], ["legR", legR]]) {
  if (!part) { console.log(`[${NAME}] ${tag}: EMPTY (no faces) — skipped`); continue; }
  const file = path.join(OUT_DIR, `${NAME}-${tag}.glb`);
  const bytes = await io.writeBinary(part.doc);
  fs.writeFileSync(file, bytes);
  console.log(`[${NAME}] wrote ${file}  verts=${part.vcountOut} tris=${Math.round(part.tris)}  ${(bytes.length / 1024).toFixed(1)}KB`);
}

measurements.hip.legL = hipL ? { x: hipL.x * SCALE, y: hipL.y * SCALE, z: hipL.z * SCALE } : null;
measurements.hip.legR = hipR ? { x: hipR.x * SCALE, y: hipR.y * SCALE, z: hipR.z * SCALE } : null;
measurements.finalHeight = TARGET_H;
const mfile = path.join(OUT_DIR, `${NAME}-measurements.json`);
fs.writeFileSync(mfile, JSON.stringify(measurements, null, 2));
console.log(`[${NAME}] wrote ${mfile}`);
console.log(`[${NAME}] FINAL hip (scaled, world units): legL=`, measurements.hip.legL, ` legR=`, measurements.hip.legR);
