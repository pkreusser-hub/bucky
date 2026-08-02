/* fs-cast-bake-test.js — FARMSTEAD Fork B sprite pipeline, TEST BAKE ONLY.
 *
 * LOOK TEST for two user-downloaded GLBs (a "cartoon dwarf" -> tried as a test
 * VILLAGER, a "medieval knight" -> tried as a test KNIGHT), bit-for-bit
 * following the same recipe tools/_fs_bake_sprites.cjs + fs-cast-bake.js use
 * for the shipped minifig sheets (same 12-azimuth grid, same 52deg pitch, same
 * world-fixed sun read live off the shared FSC.VIS, same one-locked-world-
 * scale + footPx-baseline maths, same manifest schema) — EXCEPT this file is
 * a free-standing SIBLING, never imported by and never importing from
 * fs-cast-bake.js, so it cannot collide with whatever the production pipeline
 * is doing in parallel. Nothing here ships; assets/farmstead/cast/sprites-test/
 * is a throwaway exploration directory.
 *
 * TWO POSING PATHS, chosen per-subject after a real visual check
 * (tools/_fs_spritetest_assemblecheck.py rendered both candidates at the
 * production LEG_SWING=0.52 before this file was written):
 *
 *   "split"      — the villager (dwarf) has a clean Tripo-biped skin, so
 *                  tools/_fs_spritetest_splitparts.mjs cut it into rigid
 *                  body / legL / legR parts (skin-weight classified, origin
 *                  baked at each leg's own hip — same shape as the shipped
 *                  villager's sprite-impostor.js IMP.makeRig). Full idle +
 *                  walk(8) + work(4) rows, legs genuinely swing.
 *   "wholeBodyBob" — the knight has NO skin at all, and a geometric hip-line
 *                  split (tools/_fs_spritetest_splitpreview.py) showed a real
 *                  gap between the tabard hem and the greaves at full swing
 *                  (plate armor has no "give" the way cloth reads) — the
 *                  FALLBACK the task brief pre-authorizes for exactly this
 *                  case. guard(1, whole body) + walk(3, vertical bob + a
 *                  gentle lean only, NO leg articulation because there is no
 *                  spare leg mesh) + strike(4): the production "fight" pose
 *                  is a pure TORSO transform (bob/pitch/roll off duelPose's
 *                  lunge scalar, see fs-cast-bake.js knightPose) with no leg
 *                  requirement, so it is fully achievable on whole-body
 *                  geometry and is applied here VERBATIM off the same lunge
 *                  values (fightL) as production.
 */
(function () {
  "use strict";
  const FSC = window.FSC;
  const DEG = Math.PI / 180;
  const B = {};
  window.FSCastBakeTest = B;

  const PARTS_BASE = "../../assets/farmstead/cast/sprites-test/parts/";
  const LEG_SWING = 0.52;              // fs-render pushLegs, verbatim (also FSCastBake.LEG_SWING)
  const BOB_WALK = 0.052;              // drawSerf: |cos(phase)| * 0.052 — reused for the villager
  const BOB_WORK = 0.045;
  const KNIGHT_BOB_FALLBACK = 0.03;    // gentler than BOB_WALK — a bob-only "walk" reads best subtle

  B.DEFAULTS = {
    azimuths: 12,
    cameraYaw: 0,
    pitchDeg: 52,               // FSC.CAM.PITCH_START, read live below — this is only the fallback
    bodyCell: 128,
    pad: 0.06,
    walkFramesVillager: 8,
    workFramesVillager: 4,
    walkFramesKnight: 3,
    fightL: [-0.34, -0.17, 0.25, 0.50, 0.75, 1.00],   // production's exact list — safe now that poseListKnight excludes "fight" from the fit sweep (see its comment)
  };

  /* ==================================================================== */
  /* PART LOADING                                                          */
  /* ==================================================================== */
  function loadGLB(loader, file) {
    return new Promise((res, rej) => loader.load(PARTS_BASE + file, (g) => res(g.scene), undefined, rej));
  }

  /** Mirrors sprite-impostor.js houseStyle(): convert every mesh to the house
   * flat-Lambert material. The exported parts already have metallicFactor 0
   * and no normal/MR texture (see _fs_spritetest_splitparts.mjs), so this is
   * mostly a MeshStandard->MeshLambert swap + the standard emissive lift; kept
   * defensive (same belt-and-suspenders posture as the real villager loader)
   * in case a future re-export ever regresses that. */
  function houseStyle(root, emissiveHex, emissiveK) {
    const base = new THREE.Color(emissiveHex);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const src = o.material;
      const map = src && src.map ? src.map : null;
      if (map) { map.encoding = THREE.LinearEncoding; map.needsUpdate = true; }
      o.material = new THREE.MeshLambertMaterial({
        color: 0xffffff, map: map,
        emissive: base.clone().multiplyScalar(emissiveK),
      });
      if (src && src.dispose) src.dispose();
    });
  }

  /** Load the villager (split) parts. */
  B.loadVillager = async function () {
    const loader = new THREE.GLTFLoader();
    const [body, legL, legR] = await Promise.all([
      loadGLB(loader, "dwarf-body.glb"), loadGLB(loader, "dwarf-legL.glb"), loadGLB(loader, "dwarf-legR.glb"),
    ]);
    [body, legL, legR].forEach((r) => houseStyle(r, 0x9a9a9a, 0.34));   // same lift as the serf
    let tris = 0;
    [body, legL, legR].forEach((r) => r.traverse((o) => { if (o.isMesh) tris += triCount(o.geometry); }));
    return { body, legL, legR, tris: Math.round(tris) };
  };

  /** Load the knight (whole-body-only) part. */
  B.loadKnightTest = async function () {
    const loader = new THREE.GLTFLoader();
    const body = await loadGLB(loader, "knight-body.glb");
    houseStyle(body, 0x9a9a9a, 0.34);
    let tris = 0;
    body.traverse((o) => { if (o.isMesh) tris += triCount(o.geometry); });
    return { body, tris: Math.round(tris) };
  };

  function triCount(g) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }

  /* measured hips, written by _fs_spritetest_splitparts.mjs (already scaled to
   * the villager's final 0.79 standing height — see
   * assets/farmstead/cast/sprites-test/parts/dwarf-measurements.json). Copied
   * here as plain constants (same convention as sprite-impostor.js HIP_L/HIP_R)
   * rather than fetched at runtime, so the bake has no dependency ordering. */
  B.HIP_L = { x: 0.1468053389870262, y: 0.36250045715017265, z: -0.034241346410198124 };
  B.HIP_R = { x: -0.1476892437079832, y: 0.37430463597295455, z: 0.003755292459933269 };

  /* ==================================================================== */
  /* RIGS                                                                  */
  /* ==================================================================== */
  /** split-rig: root -> bodyPivot -> (body mesh, hipL -> legL, hipR -> legR).
   * Identical shape to sprite-impostor.js IMP.makeRig / fs-cast-bake.js
   * makeVillagerRig. */
  B.makeSplitRig = function (parts) {
    const root = new THREE.Group();
    const bodyPivot = new THREE.Group();
    root.add(bodyPivot);
    bodyPivot.add(parts.body.clone(true));
    const hipL = new THREE.Group(); hipL.position.set(B.HIP_L.x, B.HIP_L.y, B.HIP_L.z);
    hipL.add(parts.legL.clone(true));
    const hipR = new THREE.Group(); hipR.position.set(B.HIP_R.x, B.HIP_R.y, B.HIP_R.z);
    hipR.add(parts.legR.clone(true));
    bodyPivot.add(hipL); bodyPivot.add(hipR);
    return { root, bodyPivot, hips: [hipL, hipR], tris: parts.tris, mode: "split" };
  };

  /** whole-body rig: root -> bodyPivot -> body mesh. No hips — legs never
   * separate, so "walk" can only ever be a bob/lean, never a stride. */
  B.makeWholeBodyRig = function (parts) {
    const root = new THREE.Group();
    const bodyPivot = new THREE.Group();
    root.add(bodyPivot);
    bodyPivot.add(parts.body.clone(true));
    return { root, bodyPivot, hips: [], tris: parts.tris, mode: "wholeBodyBob" };
  };

  /* ==================================================================== */
  /* POSES                                                                 */
  /* ==================================================================== */
  /** villager pose — VERBATIM copy of fs-cast-bake.js serfPose's walk/work
   * branches (the whole point of a clean split is that this math needs no
   * changes at all to drive a different body). */
  function villagerPose(pose, k, cfg) {
    if (pose === "idle") return { bob: 0, rx: 0, twist: 0, rz: 0, stride: 0, brace: 0, meta: {} };
    if (pose === "walk") {
      const phase = (k / cfg.walkFramesVillager) * Math.PI * 2;
      const step = Math.sin(phase);
      return {
        bob: Math.abs(Math.cos(phase)) * BOB_WALK,
        rx: 0.06, twist: step * 0.10, rz: -step * 0.055,
        stride: step, brace: 0, meta: { phase: round4(phase), step: round4(step) },
      };
    }
    const swing = cfg.workFramesVillager > 1 ? k / (cfg.workFramesVillager - 1) : 0;
    return {
      bob: swing * BOB_WORK, rx: -swing * 0.42, twist: 0, rz: 0,
      stride: 0, brace: swing, meta: { swing: round4(swing) },
    };
  }

  /** knight FALLBACK pose. guard = identity (matches production). walk = a
   * gentle bob + lean ONLY (KNIGHT_BOB_FALLBACK, well under BOB_WALK — there
   * is no leg to swing so a big bob reads as "floating", not "walking"; kept
   * deliberately subtle). fight = the REAL production knightPose('fight')
   * formula off duelPose's lunge scalar `l` — this branch needs no legs, so
   * it is not a fallback at all, it is the genuine production maths. */
  function knightTestPose(pose, k, cfg) {
    if (pose === "guard") return { bob: 0, rx: 0, twist: 0, rz: 0, meta: { l: 0 } };
    if (pose === "walk") {
      const phase = (k / cfg.walkFramesKnight) * Math.PI * 2;
      return {
        bob: Math.abs(Math.cos(phase)) * KNIGHT_BOB_FALLBACK,
        rx: 0.03 * Math.sin(phase), twist: 0, rz: 0,
        meta: { phase: round4(phase), fallback: "wholeBodyBob" },
      };
    }
    const l = cfg.fightL[k];
    const lunge = l * 0.34;      // fs-cast-bake.js knightPose, verbatim
    return {
      bob: Math.max(0, l) * 0.16, rx: lunge * 1.5, twist: 0, rz: -lunge * 0.45,
      meta: { l: round4(l), lungeOffset: round4(lunge) },
    };
  }
  B.villagerPose = villagerPose; B.knightTestPose = knightTestPose;

  /** apply a pose to a rig. Split rigs also rotate their hips (real stride);
   * whole-body rigs have no hips to rotate — `stride`/`brace` are silently
   * inert for them, which is the fallback's entire mechanism. */
  B.applyPose = function (rig, p, az) {
    rig.bodyPivot.position.set(0, p.bob, 0);
    rig.bodyPivot.rotation.set(p.rx, az + (p.twist || 0), p.rz);
    if (rig.hips.length === 2) {
      const stride = p.stride || 0, brace = p.brace || 0;
      rig.hips[0].rotation.x = stride * LEG_SWING * 1 + brace * 0.22 * -1;   // hipL, side -1 semantics per pushLegs
      rig.hips[1].rotation.x = stride * LEG_SWING * -1 + brace * 0.22 * 1;   // hipR, side +1
    }
    rig.root.updateMatrixWorld(true);
  };

  function round4(v) { return Math.round(v * 1e4) / 1e4; }
  function round2(v) { return Math.round(v * 100) / 100; }

  B.poseListVillager = function (cfg) {
    return [{ pose: "idle", n: 1 }, { pose: "walk", n: cfg.walkFramesVillager }, { pose: "work", n: cfg.workFramesVillager }];
  };
  /* `fit:false` on "fight" — MEASURED (scratchpad diag_frustum*.cjs, this
   * session): production's knightBodyParts() is compact/boxy with no arm
   * geometry, so its own full-lunge fight pose (l up to 1.00) barely grows the
   * bbox past the resting knight at all. This TEST knight has real arms +
   * pauldrons even after the T-pose repose, so the SAME lunge-rotation formula
   * — rotating the whole rigid body about a pivot near the feet — swings that
   * extra mass much further in camera space (measured: including fight in the
   * fit sweep dragged pxPerCameraUnit from a healthy ~113 down to ~34, wasting
   * most of every cell as padding for one rare frame). Excluding "fight" from
   * the SCALE-FITTING sweep only (it still renders normally, in whatever
   * frustum the calmer poses established) was verified NOT to clip: the
   * fight pose's own worst-case width/height both come in under the
   * guard+walk-fitted frustum. */
  B.poseListKnight = function (cfg) {
    return [{ pose: "guard", n: 1 }, { pose: "walk", n: cfg.walkFramesKnight }, { pose: "fight", n: cfg.fightL.length, fit: false }];
  };

  /* ==================================================================== */
  /* CAMERA / LIGHTS — read LIVE off the shared FSC.VIS + FSC.CAM so the bake
   * cannot silently drift from whatever the production rig currently uses.  */
  /* ==================================================================== */
  function makeLights(scene) {
    const V = FSC.VIS;
    const hemi = new THREE.HemisphereLight(V.HEMI_SKY, V.HEMI_GND, V.HEMI_I);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(V.SUN_COL, V.SUN_I);
    sun.position.set(0.55, 1.0, 0.35).multiplyScalar(100);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(V.FILL_COL, V.FILL_I);
    fill.position.set(-0.6, 0.45, -0.55).multiplyScalar(100);
    scene.add(fill);
  }
  function makeCamera(cfg) {
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    const pitch = cfg.pitchDeg * DEG, az = cfg.cameraYaw, R = 6;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    cam.position.set(Math.sin(az) * cp * R, sp * R, Math.cos(az) * cp * R);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    return cam;
  }

  const _inv = new THREE.Matrix4(), _pv = new THREE.Vector3(), _mm = new THREE.Matrix4();
  /* MUST read via getX/getY/getZ, never raw `.array` indexing. The exported
   * test-part GLBs (tools/_fs_spritetest_splitparts.mjs, via @gltf-transform)
   * pack POSITION+NORMAL+TEXCOORD_0 into ONE INTERLEAVED bufferView
   * (byteStride 32) — a perfectly valid, common glTF layout that the
   * production procedural geometries never produce (mergeColored builds each
   * attribute its own plain Float32Array), which is why this class of bug
   * never showed up there. THREE's GLTFLoader correctly parses it into a
   * THREE.InterleavedBufferAttribute, whose raw `.array` is the WHOLE
   * interleaved buffer (8 floats/vertex here), not a clean [x,y,z,x,y,z,...]
   * run — indexing it with `i*3` silently reads a cascading MIX of position/
   * normal/uv floats from neighbouring vertices. Measured impact before this
   * fix: pxPerCameraUnit collapsed from a healthy ~113 to 33.66 because a
   * handful of near-±1 "position" values (actually normal components) blew
   * out the locked-scale frustum by ~3x. getX/Y/Z are stride-aware on EVERY
   * BufferAttribute subtype, so this is correct for both interleaved and
   * plain geometry without needing to know which one a given mesh uses. */
  function camBox(cam, obj, acc) {
    _inv.copy(cam.matrixWorld).invert();
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      if (!pos) return;
      _mm.multiplyMatrices(_inv, o.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        _pv.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(_mm);
        if (_pv.x < acc.xmin) acc.xmin = _pv.x; if (_pv.x > acc.xmax) acc.xmax = _pv.x;
        if (_pv.y < acc.ymin) acc.ymin = _pv.y; if (_pv.y > acc.ymax) acc.ymax = _pv.y;
      }
    });
    return acc;
  }
  function newAcc() { return { xmin: 1e9, xmax: -1e9, ymin: 1e9, ymax: -1e9 }; }
  function camPoint(cam, v, out) { _inv.copy(cam.matrixWorld).invert(); out.copy(v).applyMatrix4(_inv); return out; }
  function setFrustum(cam, cx, cy, S) { cam.left = cx - S; cam.right = cx + S; cam.bottom = cy - S; cam.top = cy + S; cam.updateProjectionMatrix(); }
  function makeRT(w, h) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, generateMipmaps: false, encoding: THREE.LinearEncoding,
    });
  }
  function pushRendererState(renderer) {
    const s = {
      rt: renderer.getRenderTarget(), auto: renderer.autoClear,
      clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
      scissorTest: renderer.getScissorTest(), pr: renderer.getPixelRatio(),
      vp: renderer.getViewport(new THREE.Vector4()), sc: renderer.getScissor(new THREE.Vector4()),
    };
    renderer.setPixelRatio(1);          // see fs-cast-bake.js's comment — load-bearing at dPR!=1
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    return s;
  }
  function popRendererState(renderer, s) {
    renderer.setScissorTest(s.scissorTest); renderer.autoClear = s.auto;
    renderer.setRenderTarget(s.rt); renderer.setClearColor(s.clear, s.alpha);
    renderer.setPixelRatio(s.pr); renderer.setViewport(s.vp); renderer.setScissor(s.sc);
  }
  function beginPass(renderer, rt) {
    renderer.setRenderTarget(rt); renderer.setScissorTest(false);
    renderer.clear(true, true, true); renderer.setScissorTest(true);
  }
  function flipRows(buf, w, h) {
    const out = new Uint8Array(buf.length); const stride = w * 4;
    for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * stride, (h - y) * stride), y * stride);
    return out;
  }
  B.toPNG = function (sheet) {
    const c = document.createElement("canvas");
    c.width = sheet.w; c.height = sheet.h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(sheet.w, sheet.h);
    img.data.set(sheet.rgba);
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  };

  /* ==================================================================== */
  /* THE BAKE                                                              */
  /* ==================================================================== */
  B.bakeAll = async function (renderer, userCfg) {
    const cfg = Object.assign({}, B.DEFAULTS, userCfg || {});
    cfg.pitchDeg = FSC.CAM.PITCH_START / DEG;   // LIVE off the shared const, not the fallback default
    const t0 = performance.now();
    const A = cfg.azimuths;
    const cam = makeCamera(cfg);
    const scene = new THREE.Scene();
    scene.background = null;
    makeLights(scene);

    const villagerParts = await B.loadVillager();
    const knightParts = await B.loadKnightTest();
    const subjects = [
      { kind: "villager", rig: B.makeSplitRig(villagerParts), poseList: B.poseListVillager(cfg), poseFn: villagerPose },
      { kind: "knight", rig: B.makeWholeBodyRig(knightParts), poseList: B.poseListKnight(cfg), poseFn: knightTestPose },
    ];

    /* ---- ONE locked world scale across BOTH subjects (matches production —
     * a knight must come out bigger than a villager on a shared pixel scale,
     * not independently normalized) ---- */
    const acc = newAcc();
    for (const s of subjects) {
      for (const row of s.poseList) {
        if (row.fit === false) continue;   // see poseListKnight's comment on "fight"
        for (let k = 0; k < row.n; k++) {
          const p = s.poseFn(row.pose, k, cfg);
          for (let a = 0; a < A; a++) {
            B.applyPose(s.rig, p, (a / A) * Math.PI * 2);
            camBox(cam, s.rig.root, acc);
          }
        }
      }
    }
    const cx = (acc.xmin + acc.xmax) / 2, cy = (acc.ymin + acc.ymax) / 2;
    let S = Math.max(acc.xmax - acc.xmin, acc.ymax - acc.ymin) / 2;
    S = S / (1 - 2 * cfg.pad);
    const pxPerUnit = cfg.bodyCell / (2 * S);

    const gp = camPoint(cam, new THREE.Vector3(0, 0, 0), new THREE.Vector3());
    const footPx = {
      x: round2((gp.x - (cx - S)) * pxPerUnit),
      y: round2(cfg.bodyCell - (gp.y - (cy - S)) * pxPerUnit),
    };

    const sheets = {};
    function newSheet(name, w, h) { sheets[name] = { w, h, rgba: null, rt: null }; return sheets[name]; }
    const rowsOf = {};
    for (const s of subjects) {
      rowsOf[s.kind] = s.poseList.reduce((n, r) => n + r.n, 0);
      newSheet(s.kind + "-body", A * cfg.bodyCell, rowsOf[s.kind] * cfg.bodyCell);
    }

    const saved = pushRendererState(renderer);
    const manifest = {
      schema: "farmstead-cast-sprites-test/1",
      generated: new Date().toISOString().slice(0, 19) + "Z",
      note: "TEST/exploration bake — user-downloaded GLBs, look-test only, never shipped. " +
        "Same 12-azimuth/52deg-pitch/world-fixed-sun/one-locked-scale recipe as the production " +
        "Fork B sheets (assets/farmstead/cast/sprites/), driven by a self-contained sibling " +
        "harness (farmstead-proto/sprite/fs-cast-bake-test.js) so it never touches or depends on " +
        "the production fs-cast-bake.js. Masks/overlays intentionally ABSENT (see manifest.overlays " +
        "= {} and each subject's mask = null) — team tint and job overlays are out of scope for a look test.",
      bake: {
        azimuths: A, azimuthStepDeg: round4(360 / A),
        azimuthOrder: "index a = round(wrap(facingYaw - cameraYaw) / (2PI/A)) mod A; a=0 is facing +Z (toward the camera at cameraYaw=0)",
        cameraYaw: round4(cfg.cameraYaw), pitchDeg: cfg.pitchDeg, pitchSource: "FSC.CAM.PITCH_START (live)",
        projection: "orthographic", pxPerCameraUnit: round2(pxPerUnit), bodyCell: cfg.bodyCell, pad: cfg.pad,
        frustum: { cx: round4(cx), cy: round4(cy), halfSpan: round4(S) },
        lighting: {
          mode: "world-fixed (live off FSC.VIS)",
          hemi: { sky: FSC.VIS.HEMI_SKY, ground: FSC.VIS.HEMI_GND, intensity: FSC.VIS.HEMI_I },
          sun: { color: FSC.VIS.SUN_COL, intensity: FSC.VIS.SUN_I, dir: [0.55, 1.0, 0.35] },
          fill: { color: FSC.VIS.FILL_COL, intensity: FSC.VIS.FILL_I, dir: [-0.6, 0.45, -0.55] },
          emissive: { of: 0x9a9a9a, k: 0.34 },
        },
      },
      footPx: footPx,
      sheets: {}, subjects: {}, overlays: {},   // overlays ALWAYS empty — see note above
    };

    for (const s of subjects) {
      const rows = s.poseList;
      const poses = {};
      let rowIdx = 0;
      for (const row of rows) {
        const frames = [];
        for (let k = 0; k < row.n; k++) {
          const p = s.poseFn(row.pose, k, cfg);
          const cells = [];
          for (let a = 0; a < A; a++) { cells.push({ col: a }); }
          frames.push(Object.assign({ row: rowIdx, cells: cells }, p.meta));
          rowIdx++;
        }
        poses[row.pose] = { rows: row.n, frames: frames };
      }
      manifest.subjects[s.kind] = {
        sheet: s.kind + "-body", mask: null, tris3d: s.rig.tris, posingMethod: s.rig.mode, poses: poses,
      };
    }

    for (const s of subjects) {
      const sheet = sheets[s.kind + "-body"];
      sheet.rt = makeRT(sheet.w, sheet.h);
      scene.add(s.rig.root);
      s.rig.tris = s.rig.tris;
      beginPass(renderer, sheet.rt);
      setFrustum(cam, cx, cy, S);
      let rowIdx = 0;
      for (const row of s.poseList) {
        for (let k = 0; k < row.n; k++) {
          const p = s.poseFn(row.pose, k, cfg);
          for (let a = 0; a < A; a++) {
            B.applyPose(s.rig, p, (a / A) * Math.PI * 2);
            const gx = a * cfg.bodyCell, gy = sheet.h - (rowIdx + 1) * cfg.bodyCell;
            renderer.setViewport(gx, gy, cfg.bodyCell, cfg.bodyCell);
            renderer.setScissor(gx, gy, cfg.bodyCell, cfg.bodyCell);
            renderer.render(scene, cam);
          }
          rowIdx++;
        }
      }
      scene.remove(s.rig.root);
    }

    popRendererState(renderer, saved);
    let totalPngBytes = 0;
    for (const name in sheets) {
      const s = sheets[name];
      const buf = new Uint8Array(s.w * s.h * 4);
      renderer.readRenderTargetPixels(s.rt, 0, 0, s.w, s.h, buf);
      s.rgba = flipRows(buf, s.w, s.h);
      const subj = name.replace(/-body$/, "");
      manifest.sheets[name] = {
        file: name + ".png", w: s.w, h: s.h, cell: cfg.bodyCell, cols: A, rows: rowsOf[subj],
        origin: "top-left", kind: "colour",
      };
    }
    renderer.getContext().finish();
    manifest.bake.ms = Math.round(performance.now() - t0);
    manifest.bake.totalCells = subjects.reduce((n, s) => n + rowsOf[s.kind] * A, 0);
    return { manifest, sheets };
  };
})();
