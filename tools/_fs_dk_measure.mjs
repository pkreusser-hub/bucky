#!/usr/bin/env node
/* _fs_dk_measure.mjs — FARMSTEAD dwarf+knight look adoption, STEP 1.
 *
 * Measures both source GLBs in NATIVE glTF space (Y-up, no Blender axis remap —
 * the class of bug tools/_fs_spritetest_splitparts.mjs already documented) and
 * writes one JSON of landmarks that every later step reads:
 *
 *   node tools/_fs_dk_measure.mjs            -> assets/farmstead/cast/dwarfknight/landmarks.json
 *   node tools/_fs_dk_measure.mjs --tex      -> …also dumps the baseColor textures for eyeballing
 *
 * WHY LANDMARKS AND NOT A UNIFORM SCALE: the dwarf's hip sits at 39% of his
 * standing height, a normally-proportioned knight's crotch at ~47%. Scaling the
 * dwarf's armature uniformly onto the knight would bury the pelvis inside his
 * thighs and hand automatic weights a leg-shaped torso. Every fit below is
 * measured off the mesh instead.
 */
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CORE_URL = pathToFileURL(path.join(REPO, "tools/node_modules/@gltf-transform/core/dist/index.js")).href;
const { NodeIO } = await import(CORE_URL);

const OUT_DIR = path.join(REPO, "assets/farmstead/cast/dwarfknight");
const SRC = {
  dwarf: path.join(OUT_DIR, "src/dwarf.glb"),
  knight: path.join(OUT_DIR, "src/knight.glb"),
};
const DUMP_TEX = process.argv.includes("--tex");

const io = new NodeIO();
const report = { generated: new Date().toISOString().slice(0, 19) + "Z", models: {} };

let m_profile = null;
for (const name of Object.keys(SRC)) {
  const doc = await io.read(SRC[name]);
  const root = doc.getRoot();

  /* the real body mesh = the primitive with the most vertices (the dwarf file
   * also carries a stray 42-vertex Icosphere, a marketplace leftover) */
  let main = null, prims = [];
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const p = prim.getAttribute("POSITION");
      if (!p) continue;
      prims.push({ mesh: mesh.getName(), verts: p.getCount() });
      if (!main || p.getCount() > main.getAttribute("POSITION").getCount()) main = prim;
    }
  }
  const pos = main.getAttribute("POSITION");
  const N = pos.getCount();
  const idx = main.getIndices();
  const P = pos.getArray();

  const min = pos.getMin([]), max = pos.getMax([]);
  const H = max[1] - min[1];

  /* ---- crotch: the lowest height at which the body is SOLID across the
   * midline. Between the legs x≈0 is empty air; in the torso the front and
   * back surfaces both pass through it. Counting vertices in a narrow midline
   * band per y-slice separates the two cleanly (a "min |x|" test does not — a
   * chunky cartoon dwarf's inner thighs sit only a hair off the midline). ---- */
  const SL = 120;                                   // y slices
  const slice = Array.from({ length: SL }, () => ({ mid: 0, n: 0, maxAbsX: 0, minZ: 1e9, maxZ: -1e9, legL: 0, legR: 0, sumL: 0, sumR: 0 }));
  for (let v = 0; v < N; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const s = Math.min(SL - 1, Math.max(0, Math.floor((y - min[1]) / H * SL)));
    const S = slice[s];
    S.n++;
    const ax = Math.abs(x);
    if (ax > S.maxAbsX) S.maxAbsX = ax;
    if (x > 0) { S.legL++; S.sumL += x; } else { S.legR++; S.sumR += x; }
    if (z < S.minZ) S.minZ = z;
    if (z > S.maxZ) S.maxZ = z;
  }
  /* TRIANGLES that straddle x=0, per slice. This — not a vertex count near the
   * midline — is what tells legs from torso: these sculpts simply have no
   * vertices at x≈0 (an irregular photogrammetry-ish triangulation with the UV
   * seam routed off the midline), so a "count verts with |x|<ε" test reported
   * the crotch at 55% of height on BOTH models, which is nonsense. A surface
   * crossing the midline always has triangles crossing it. */
  if (idx) {
    const I = idx.getArray();
    for (let f = 0; f < I.length; f += 3) {
      const a = I[f], b = I[f + 1], c = I[f + 2];
      const xs = [P[a * 3], P[b * 3], P[c * 3]];
      if (Math.min(...xs) < 0 && Math.max(...xs) > 0) {
        const y = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3;
        const s = Math.min(SL - 1, Math.max(0, Math.floor((y - min[1]) / H * SL)));
        slice[s].mid++;
      }
    }
  }
  const yOf = (s) => min[1] + (s + 0.5) / SL * H;
  /* walk DOWN from mid-height; the crotch is where the midline stops being
   * crossed at all (three empty slices in a row, so one stray tri cannot end
   * the scan early) */
  const midS = Math.floor(SL * 0.55);
  /* scan UP from the ground for the first sustained run of straddling slices.
   * (Scanning DOWN from mid-height and stopping at the first empty run is
   * wrong: both torsos are sparse enough to leave 1-2 empty slices in the
   * middle of a perfectly solid chest, which parked the knight's "crotch" at
   * 50% of his height.) */
  let crotchS = 0;
  for (let s = 1; s < midS; s++) {
    if (slice[s].mid > 2 && slice[s + 1] && slice[s + 1].mid > 2) { crotchS = s - 1; break; }
  }
  const crotchY = yOf(crotchS);
  /* leg centre x, measured in the lower quarter (well clear of the fauld) */
  let lc = 0, rc = 0, lcn = 0, rcn = 0;
  for (let s = 0; s < Math.floor(SL * 0.22); s++) { lc += slice[s].sumL; lcn += slice[s].legL; rc += slice[s].sumR; rcn += slice[s].legR; }
  const legCentreX = lcn && rcn ? { L: r4(lc / lcn), R: r4(rc / rcn) } : null;
  m_profile = slice.map((S, s) => ({ y: r4(yOf(s)), n: S.n, mid: S.mid, maxAbsX: r4(S.maxAbsX) }));

  /* ---- widest slice above mid-height = the T-pose arm span ---- */
  let armS = midS, armHalf = 0;
  for (let s = midS; s < SL; s++) if (slice[s].n && slice[s].maxAbsX > armHalf) { armHalf = slice[s].maxAbsX; armS = s; }
  const armY = yOf(armS);

  /* ---- head: scan down from the top for the first slice noticeably wider
   * than the crown, and take the head's own half-width as the max |x| in the
   * band between the shoulder line and the top (excluding the arm slices,
   * which is why we look near the midline: |x| < armHalf*0.55) ---- */
  let headHalf = 0, headDepth = 0;
  const headBandMin = armY;                          // above the arms
  for (let v = 0; v < N; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (y < headBandMin) continue;
    if (Math.abs(x) > armHalf * 0.55) continue;      // still an arm/pauldron
    headHalf = Math.max(headHalf, Math.abs(x));
    headDepth = Math.max(headDepth, Math.abs(z));
  }

  /* ---- torso half-width + depth at the belt band (0.42..0.52 of height) ---- */
  let beltHalf = 0, beltDepth = 0, beltN = 0;
  for (let v = 0; v < N; v++) {
    const y = (P[v * 3 + 1] - min[1]) / H;
    if (y < 0.42 || y > 0.52) continue;
    beltN++;
    beltHalf = Math.max(beltHalf, Math.abs(P[v * 3]));
    beltDepth = Math.max(beltDepth, Math.abs(P[v * 3 + 2]));
  }

  const m = {
    file: path.relative(REPO, SRC[name]).replace(/\\/g, "/"),
    prims, verts: N, tris: Math.round((idx ? idx.getCount() : N) / 3),
    bbox: { min: min.map(r4), max: max.map(r4) },
    height: r4(H),
    crotchY: r4(crotchY), crotchFrac: r4((crotchY - min[1]) / H), legCentreX,
    armY: r4(armY), armFrac: r4((armY - min[1]) / H), armHalfSpan: r4(armHalf),
    headHalfWidth: r4(headHalf), headHalfDepth: r4(headDepth),
    beltHalfWidth: r4(beltHalf), beltHalfDepth: r4(beltDepth), beltVerts: beltN,
    skinned: root.listSkins().length > 0,
  };

  /* ---- skin: joint list + the joints' WORLD BIND positions.
   * Summing local translations up the parent chain is WRONG for this rig — the
   * Tripo v1.0 skeleton carries rotations on every joint, so a naive sum gives
   * each bone's distance-along-its-chain instead of a position (measured: it
   * put the dwarf's `Head` at y=0.355 and both hands at y=0.7, i.e. bone
   * lengths, not coordinates). The inverse bind matrix IS the ground truth:
   * jointWorldBind = inverse(IBM), so the position is −R⁻¹·t. ---- */
  const skin = root.listSkins()[0];
  if (skin) {
    const joints = skin.listJoints();
    m.jointCount = joints.length;
    m.joints = joints.map((j) => j.getName());
    const ibmAcc = skin.getInverseBindMatrices();
    const wp = {};
    if (ibmAcc) {
      const A = ibmAcc.getArray();
      for (let i = 0; i < joints.length; i++) {
        const M = A.subarray(i * 16, i * 16 + 16);          // column-major
        const R = [M[0], M[1], M[2], M[4], M[5], M[6], M[8], M[9], M[10]];
        const t = [M[12], M[13], M[14]];
        const Ri = inv3(R);
        wp[joints[i].getName()] = [
          -(Ri[0] * t[0] + Ri[3] * t[1] + Ri[6] * t[2]),
          -(Ri[1] * t[0] + Ri[4] * t[1] + Ri[7] * t[2]),
          -(Ri[2] * t[0] + Ri[5] * t[1] + Ri[8] * t[2]),
        ].map(r4);
      }
    }
    m.jointWorld = wp;
  }

  /* ---- textures ---- */
  const mat = main.getMaterial();
  const bc = mat ? mat.getBaseColorTexture() : null;
  if (bc) {
    m.baseColor = { mime: bc.getMimeType(), bytes: bc.getImage().byteLength };
    if (DUMP_TEX) {
      const ext = bc.getMimeType().indexOf("png") >= 0 ? "png" : "jpg";
      const f = path.join(OUT_DIR, "src", name + "-basecolor." + ext);
      fs.writeFileSync(f, Buffer.from(bc.getImage()));
      m.baseColor.dumped = path.relative(REPO, f).replace(/\\/g, "/");
    }
  }
  m.otherTextures = root.listTextures().map((t) => ({ name: t.getName(), mime: t.getMimeType(), bytes: t.getImage() ? t.getImage().byteLength : 0 }));

  /* ---- facing check: is the nose at +Z? (head band, z extremes) ---- */
  {
    let zmin = 1e9, zmax = -1e9;
    for (let v = 0; v < N; v++) {
      const y = P[v * 3 + 1];
      if (y < headBandMin) continue;
      const z = P[v * 3 + 2];
      if (z < zmin) zmin = z; if (z > zmax) zmax = z;
    }
    m.headZ = { min: r4(zmin), max: r4(zmax), facesPlusZ: zmax > -zmin };
  }

  m.profile = m_profile;
  report.models[name] = m;
  console.log(`[${name}] verts=${N} tris=${m.tris} H=${m.height} crotch=${m.crotchY} (${(m.crotchFrac * 100).toFixed(1)}%) ` +
    `armY=${m.armY} (${(m.armFrac * 100).toFixed(1)}%) armHalf=${m.armHalfSpan} headHalfW=${m.headHalfWidth} ` +
    `beltHalfW=${m.beltHalfWidth} skinned=${m.skinned}`);
  if (m.prims.length > 1) console.log(`   primitives:`, JSON.stringify(m.prims));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const outFile = path.join(OUT_DIR, "landmarks.json");
fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log("wrote " + path.relative(REPO, outFile).replace(/\\/g, "/"));

function r4(v) { return Math.round(v * 1e4) / 1e4; }
/** 3x3 inverse, column-major [c0r0,c0r1,c0r2, c1r0,…] */
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const s = 1 / det;
  return [A * s, (c * h - b * i) * s, (b * f - c * e) * s,
    B * s, (a * i - c * g) * s, (c * d - a * f) * s,
    C * s, (b * g - a * h) * s, (a * e - b * d) * s];
}
