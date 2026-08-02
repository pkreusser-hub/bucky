/* forkb-preview-test.js — LOOK TEST preview for the sprite-test pipeline.
 *
 * Sibling of forkb-preview.js (never edited, never imported — this file owns
 * its own copy of the small generic pieces: the instanced billboard shader,
 * unit spawn/step, the yaw-locked camera). Draws the SAME real Farmstead
 * terrain (fs-map.js + sprite-world.js, shared read-only files, unmodified)
 * under the SAME yaw-locked camera contract as Fork B, with a SOURCE toggle:
 *
 *   "minifig" — the shipped production sheets (assets/farmstead/cast/sprites/)
 *               serf + knight, full tint + hat/tool/pip overlays. This is
 *               forkb.html's existing look, reproduced here so it sits right
 *               next to the alternative for a fair side-by-side.
 *   "test"    — the sprite-test sheets (assets/farmstead/cast/sprites-test/)
 *               villager (walking, true leg-split) + knight (idling and
 *               periodically striking, whole-body fallback). No tint, no
 *               overlays — the test manifest carries none (see its
 *               subjects.<kind>.mask === null and overlays === {}).
 *
 * Both manifests + all sheets load up front so the toggle is instant, no
 * reload. Everything else — spawn/step, the camera, the terrain — is shared
 * between the two modes; only syncUnits()'s per-instance draw calls branch.
 */
(function () {
  "use strict";
  const FSC = window.FSC, FSMap = window.FSMap, W = window.SpriteWorld;
  const Q = new URLSearchParams(location.search);
  const qn = (k, d) => { const v = parseFloat(Q.get(k)); return isFinite(v) ? v : d; };

  const MINIFIG_SHEETS = "../../assets/farmstead/cast/sprites/";
  const TEST_SHEETS = "../../assets/farmstead/cast/sprites-test/";
  const S = {
    source: Q.get("source") === "test" ? "test" : "minifig",
    count: qn("count", 90) | 0,
    scene: Q.get("scene") || "crowd",     // crowd | knight (strike-loop demo, both sources)
    walk: Q.get("walk") !== "0",
    seed: qn("seed", 7) | 0,
    maxUnits: 400,
  };
  const D = { ready: false, notes: [] };
  window.__FORKB_TEST__ = { S, D };

  let renderer, scene, camera, cam, map, clock;
  let MANM = null, MANT = null;             // minifig / test manifests
  const layers = {};                        // serf, knight, villagerT, knightT
  const units = [];
  let _r = 0;
  function rnd() { _r = (_r * 1664525 + 1013904223) >>> 0; return _r / 4294967296; }
  function hud(m) { const e = document.getElementById("boot"); if (e) e.textContent = m; }
  function wrapPi(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  /* ================================================================== */
  /* SPRITE LAYER — identical shader contract to forkb-preview.js's        */
  /* makeLayer (own copy, kept self-contained per the isolation rule).     */
  /* ================================================================== */
  function makeLayer(tex, maskTex, grid, quadWorld, opts) {
    opts = opts || {};
    const max = opts.max || S.maxUnits;
    const geo = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    geo.index = plane.index;
    geo.attributes.position = plane.attributes.position;
    geo.attributes.uv = plane.attributes.uv;
    geo.attributes.normal = plane.attributes.normal;
    const frames = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    const tints = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    const offs = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    for (let i = 0; i < max; i++) tints.setXYZ(i, 1, 1, 1);
    [frames, tints, offs].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aFrame", frames);
    geo.setAttribute("aTint", tints);
    geo.setAttribute("aOff", offs);

    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: false, alphaTest: 0.4, side: THREE.DoubleSide, fog: true });
    const U = {
      uGrid: { value: new THREE.Vector2(grid.cols, grid.rows) },
      uQuad: { value: quadWorld },
      uAnchor: { value: new THREE.Vector2(opts.anchorX || 0, opts.anchorY || 0) },
      uBias: { value: opts.bias || 0.22 },
      uMask: { value: maskTex || tex },
      uHasMask: { value: maskTex ? 1 : 0 },
      uTintEm: { value: new THREE.Vector3().fromArray(opts.tintEmissive || [0, 0, 0]) },
    };
    mat.onBeforeCompile = function (sh) {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `
#include <common>
attribute float aFrame; attribute vec3 aTint; attribute vec2 aOff;
uniform vec2 uGrid; uniform float uQuad; uniform vec2 uAnchor; uniform float uBias;
varying vec2 vAtlas; varying vec3 vTint;`)
        .replace("#include <project_vertex>", `
  vec3 ipos = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);
  vec3 wpos = (modelMatrix * vec4(ipos, 1.0)).xyz;
  vec3 R = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 U2 = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 F = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec3 wp = wpos + F * uBias
          - R * uAnchor.x - U2 * uAnchor.y
          + R * aOff.x + U2 * aOff.y
          + R * (position.x * uQuad) + U2 * (position.y * uQuad);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float col = mod(aFrame, uGrid.x);
  float row = floor(aFrame / uGrid.x + 0.0001);
  vAtlas = (vec2(col, row) + vec2(uv.x, 1.0 - uv.y)) / uGrid;
  vTint = aTint;`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `
#include <common>
uniform sampler2D uMask; uniform float uHasMask; uniform vec3 uTintEm;
varying vec2 vAtlas; varying vec3 vTint;`)
        .replace("#include <map_fragment>", `
  vec4 texel = texture2D(map, vAtlas);
  float mr = 0.0;
  if (uHasMask > 0.5) { vec4 mk = texture2D(uMask, vAtlas); mr = mk.r; }
  vec3 rgb = texel.rgb * mix(vec3(1.0), vTint, mr) + uTintEm * mr;
  diffuseColor = vec4(rgb, texel.a);`);
    };
    mat.customProgramCacheKey = () => "forkbTestSprite";
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.userData = { frames, tints, offs, grid, quadWorld };
    return mesh;
  }

  function pushInst(layer, x, y, z, frame, tint) {
    const i = layer.count;
    if (i >= layer.instanceMatrix.count) return;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    layer.setMatrixAt(i, m);
    layer.userData.frames.setX(i, frame);
    layer.userData.offs.setXY(i, 0, 0);
    const u = layer.userData;
    if (tint) u.tints.setXYZ(i, tint.r, tint.g, tint.b); else u.tints.setXYZ(i, 1, 1, 1);
    layer.count = i + 1;
  }
  function finishLayer(layer) {
    layer.instanceMatrix.needsUpdate = true;
    layer.userData.frames.needsUpdate = true;
    layer.userData.tints.needsUpdate = true;
    layer.userData.offs.needsUpdate = true;
  }

  /* ================================================================== */
  /* MANIFEST HELPERS — same lookup rules the README documents, generic   */
  /* across both manifests (identical bake.azimuthOrder/schema).          */
  /* ================================================================== */
  function azIndex(man, yaw) {
    const A = man.bake.azimuths, step = Math.PI * 2 / A;
    let d = yaw - man.bake.cameraYaw;
    d = ((d % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.round(d / step) % A;
  }
  function walkFrame(phase, n) {
    const step = Math.PI * 2 / n;
    let p = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.round(p / step) % n;
  }
  function workFrame(swing, n) { return Math.max(0, Math.min(n - 1, Math.round(swing * (n - 1)))); }
  function fightFrame(man, l) {
    const P = man.subjects.knight.poses;
    let best = { row: P.guard.frames[0].row, k: -1, d: Math.abs(l) };
    P.fight.frames.forEach((f, k) => { const d = Math.abs(l - f.l); if (d < best.d) best = { row: f.row, k, d }; });
    return best;
  }
  function bodyCell(man, row, az) { return row * man.bake.azimuths + az; }

  /* ================================================================== */
  /* UNITS — generic sim, shared by both sources (adapted from            */
  /* forkb-preview.js; mechanical, not sheet-specific).                   */
  /* ================================================================== */
  const TURN_RATE = 7.5, STRIDE = 0.46;
  const JOBS = Object.keys(FSC.JOB_TOOLS).filter((j) => j !== "knight");

  function spawn(n) {
    units.length = 0;
    const W2 = map.W * FSC.TILE, H2 = map.H * FSC.TILE * FSC.ROW_Z;
    let guard = 0;
    while (units.length < n && guard++ < n * 60) {
      const x = 6 + rnd() * (W2 - 12), z = 6 + rnd() * (H2 - 12);
      if (W.terrAt(x, z) === FSC.TERR.WATER) continue;
      const job = JOBS[(rnd() * JOBS.length) | 0];
      const knight = rnd() < 0.22;
      units.push({
        x, z, y: W.heightAt(x, z),
        yaw: ((rnd() * 6) | 0) * (Math.PI / 3),
        head: ((rnd() * 6) | 0) * (Math.PI / 3),
        leg: 2 + rnd() * 5, phase: rnd() * 6.28, speed: 0,
        knight, job: knight ? "knight" : job,
        player: (rnd() * FSC.PLAYER_COLORS.length) | 0,
        work: 0, working: false, workT: 0,
        fightL: 0, fightT: rnd() * 3,
      });
    }
    return units.length;
  }
  function stepUnit(u, dt) {
    if (!S.walk) { u.speed = 0; return; }
    u.leg -= dt;
    if (u.leg <= 0) {
      let h;
      do { h = ((rnd() * 6) | 0) * (Math.PI / 3); } while (Math.abs(wrapPi(h - u.head)) > 2.7);
      u.head = h;
      u.leg = 1.6 + rnd() * 4;
      if (!u.knight && rnd() < 0.3) { u.working = true; u.workT = 1.2 + rnd() * 2.5; }
    }
    if (u.working) {
      u.workT -= dt;
      const p = 0.75, w = 1 - ((u.workT % p) + p) % p / p, RAISE = 0.72;
      u.work = w < RAISE ? w / RAISE : Math.max(0, 1 - (w - RAISE) / (1 - RAISE));
      u.speed = 0;
      if (u.workT <= 0) u.working = false;
      return;
    }
    const d = wrapPi(u.head - u.yaw), mx = TURN_RATE * dt;
    u.yaw += Math.abs(d) <= mx ? d : (d < 0 ? -mx : mx);
    const v = 1.35;
    const nx = u.x + Math.sin(u.yaw) * v * dt, nz = u.z + Math.cos(u.yaw) * v * dt;
    const W2 = map.W * FSC.TILE, H2 = map.H * FSC.TILE * FSC.ROW_Z;
    if (nx > 4 && nz > 4 && nx < W2 - 4 && nz < H2 - 4 && W.terrAt(nx, nz) !== FSC.TERR.WATER) {
      const walked = Math.hypot(nx - u.x, nz - u.z);
      u.x = nx; u.z = nz; u.speed = walked / dt;
      u.phase += (walked / STRIDE) * Math.PI;
    } else { u.leg = 0; u.speed = 0; }
    u.y = W.heightAt(u.x, u.z);
  }

  /* ================================================================== */
  /* DRAW — branches on S.source                                          */
  /* ================================================================== */
  const tc = new THREE.Color();

  function syncUnits() {
    for (const k in layers) layers[k].count = 0;
    if (S.source === "minifig") drawMinifig(); else drawTest();
    for (const k in layers) finishLayer(layers[k]);
  }

  function drawMinifig() {
    const man = MANM, A = man.bake.azimuths;
    const nWalk = man.subjects.serf.poses.walk.rows, nWork = man.subjects.serf.poses.work.rows;
    for (const u of units) {
      const az = azIndex(man, u.yaw);
      if (u.knight) {
        let f;
        if (u.fightL !== 0) {
          const ff = fightFrame(man, u.fightL);
          f = ff.k < 0 ? man.subjects.knight.poses.guard.frames[0] : man.subjects.knight.poses.fight.frames[ff.k];
        } else if (u.speed > 0.02) {
          f = man.subjects.knight.poses.walk.frames[walkFrame(u.phase, man.subjects.knight.poses.walk.rows)];
        } else f = man.subjects.knight.poses.guard.frames[0];
        const rt = new THREE.Color(FSC.RANK_COLOR[0]);
        pushInst(layers.knight, u.x, u.y, u.z, bodyCell(man, f.row, az), tc.set(FSC.PLAYER_COLORS[u.player]));
        continue;
      }
      let f;
      if (u.working) f = man.subjects.serf.poses.work.frames[workFrame(u.work, nWork)];
      else if (u.speed > 0.02) f = man.subjects.serf.poses.walk.frames[walkFrame(u.phase, nWalk)];
      else f = man.subjects.serf.poses.idle.frames[0];
      pushInst(layers.serf, u.x, u.y, u.z, bodyCell(man, f.row, az), tc.set(FSC.PLAYER_COLORS[u.player]));
    }
  }

  function drawTest() {
    const man = MANT, A = man.bake.azimuths;
    const nWalk = man.subjects.villager.poses.walk.rows, nWork = man.subjects.villager.poses.work.rows;
    for (const u of units) {
      const az = azIndex(man, u.yaw);
      if (u.knight) {
        let f;
        if (u.fightL !== 0) {
          const ff = fightFrame(man, u.fightL);
          f = ff.k < 0 ? man.subjects.knight.poses.guard.frames[0] : man.subjects.knight.poses.fight.frames[ff.k];
        } else if (u.speed > 0.02) {
          f = man.subjects.knight.poses.walk.frames[walkFrame(u.phase, man.subjects.knight.poses.walk.rows)];
        } else f = man.subjects.knight.poses.guard.frames[0];
        pushInst(layers.knightT, u.x, u.y, u.z, bodyCell(man, f.row, az), null);
        continue;
      }
      let f;
      if (u.working) f = man.subjects.villager.poses.work.frames[workFrame(u.work, nWork)];
      else if (u.speed > 0.02) f = man.subjects.villager.poses.walk.frames[walkFrame(u.phase, nWalk)];
      else f = man.subjects.villager.poses.idle.frames[0];
      pushInst(layers.villagerT, u.x, u.y, u.z, bodyCell(man, f.row, az), null);
    }
  }

  /* ================================================================== */
  /* CAMERA — YAW LOCKED, same contract as forkb.html.                    */
  /* ================================================================== */
  function applyCam() {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    camera.position.set(cam.tx + Math.sin(cam.yaw) * cp * cam.dist, cam.ty + sp * cam.dist, cam.tz + Math.cos(cam.yaw) * cp * cam.dist);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    camera.updateMatrixWorld();
  }
  function bindCamera(canvas) {
    let drag = null;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); });
    window.addEventListener("pointerup", () => { drag = null; });
    window.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      const k = cam.dist * FSC.CAM.DRAG_PAN;
      const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
      cam.tx -= (dx * c - dy * -s) * k;
      cam.tz -= (dx * -s - dy * -c) * k;
      cam.ty = W.heightAt(cam.tx, cam.tz);
      applyCam();
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      cam.dist = Math.max(FSC.CAM.DIST_MIN, Math.min(FSC.CAM.DIST_MAX, cam.dist * (1 + e.deltaY * FSC.CAM.ZOOM_RATE)));
      applyCam();
    }, { passive: false });
  }

  /* ================================================================== */
  /* BOOT                                                                */
  /* ================================================================== */
  function loadTex(url) {
    return new Promise((res, rej) => {
      new THREE.TextureLoader().load(url, (t) => {
        t.flipY = false;
        t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        t.encoding = THREE.LinearEncoding;
        t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        res(t);
      }, undefined, rej);
    });
  }

  async function boot() {
    const canvas = document.getElementById("view");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    clock = new THREE.Clock();

    hud("loading manifests…");
    MANM = await (await fetch(MINIFIG_SHEETS + "manifest.json")).json();
    MANT = await (await fetch(TEST_SHEETS + "manifest-test.json")).json();
    D.manifestMinifig = { azimuths: MANM.bake.azimuths, pitchDeg: MANM.bake.pitchDeg };
    D.manifestTest = { azimuths: MANT.bake.azimuths, pitchDeg: MANT.bake.pitchDeg };

    hud("generating terrain…");
    _r = S.seed >>> 0;
    map = FSMap.generate({ size: 48, seed: S.seed, players: 2 });
    W.build(scene, map);

    camera = new THREE.PerspectiveCamera(FSC.CAM.FOV, 1, FSC.CAM.NEAR, FSC.CAM.FAR);
    cam = { tx: 0, tz: 0, ty: 0, dist: FSC.CAM.DIST_START, yaw: MANM.bake.cameraYaw, pitch: MANM.bake.pitchDeg * Math.PI / 180 };
    bindCamera(canvas);

    hud("loading sheets…");
    const [serfBody, serfMask, knightBody, knightMask, villagerT, knightTTex] = await Promise.all([
      loadTex(MINIFIG_SHEETS + "serf-body.png"), loadTex(MINIFIG_SHEETS + "serf-mask.png"),
      loadTex(MINIFIG_SHEETS + "knight-body.png"), loadTex(MINIFIG_SHEETS + "knight-mask.png"),
      loadTex(TEST_SHEETS + "villager-body.png"), loadTex(TEST_SHEETS + "knight-body.png"),
    ]);

    function layerFor(man, tex, maskTex, kind, opts) {
      const ppu = man.bake.pxPerCameraUnit;
      const bodyQuad = man.bake.bodyCell / ppu;
      const anchorX = (man.footPx.x - man.bake.bodyCell / 2) / ppu;
      const anchorY = -(man.footPx.y - man.bake.bodyCell / 2) / ppu;
      const grid = { cols: man.sheets[kind + "-body"].cols, rows: man.sheets[kind + "-body"].rows };
      return makeLayer(tex, maskTex, grid, bodyQuad, Object.assign({ anchorX, anchorY, bias: 0.22 * bodyQuad }, opts));
    }
    layers.serf = layerFor(MANM, serfBody, serfMask, "serf", { tintEmissive: MANM.tintEmissive });
    layers.knight = layerFor(MANM, knightBody, knightMask, "knight", { tintEmissive: MANM.tintEmissive });
    layers.villagerT = layerFor(MANT, villagerT, null, "villager", {});
    layers.knightT = layerFor(MANT, knightTTex, null, "knight", {});
    scene.add(layers.serf); scene.add(layers.knight); scene.add(layers.villagerT); scene.add(layers.knightT);
    layers.serf.visible = layers.knight.visible = S.source === "minifig";
    layers.villagerT.visible = layers.knightT.visible = S.source === "test";

    D.spawned = spawn(S.count);
    const c0 = units[0] || { x: 20, z: 20, y: 0 };
    cam.tx = c0.x; cam.tz = c0.z; cam.ty = c0.y;
    applyCam();
    resize();
    window.addEventListener("resize", resize);
    D.ready = true;
    hud("");
    frame();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  let acc = 0;
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    acc += dt;
    if (S.scene === "knight") {
      for (const u of units) {
        if (!u.knight) continue;
        const w = (acc * 0.8 + u.fightT) % 1;
        u.fightL = w < 0.6 ? -0.34 * Math.sin((w / 0.6) * Math.PI) : Math.pow((w - 0.6) / 0.4, 1.6);
        u.speed = 0;
      }
    } else {
      for (const u of units) stepUnit(u, dt);
    }
    syncUnits();
    renderer.render(scene, camera);
    D.stats = {
      calls: renderer.info.render.calls, tris: renderer.info.render.triangles,
      serf: layers.serf.count, knight: layers.knight.count, villagerT: layers.villagerT.count, knightT: layers.knightT.count,
    };
  }

  /* ---------------------------------------------------------------- hook */
  Object.assign(window.__FORKB_TEST__, {
    state: () => ({
      ready: D.ready, spawned: D.spawned, stats: D.stats,
      source: S.source, manifestMinifig: D.manifestMinifig, manifestTest: D.manifestTest,
      camYaw: cam ? cam.yaw : null, camDist: cam ? +cam.dist.toFixed(2) : null,
      layerVisible: { serf: layers.serf && layers.serf.visible, knight: layers.knight && layers.knight.visible, villagerT: layers.villagerT && layers.villagerT.visible, knightT: layers.knightT && layers.knightT.visible },
    }),
    /* "flip between looks IN PLACE" (the task's own wording) means the SAME
     * units, at the SAME positions/poses, just re-skinned through the other
     * layer set on the next frame — respawning here was a real bug (this
     * session's take_shots.cjs caught it: toggling source right before a
     * screenshot silently teleported every unit back to fresh random spawns,
     * because this used to call spawn() on every toggle). units[] is
     * source-agnostic (job/knight/pose fields have no per-source meaning),
     * so a toggle only ever needs to flip layer visibility. */
    setSource: (src) => {
      S.source = src === "test" ? "test" : "minifig";
      layers.serf.visible = layers.knight.visible = S.source === "minifig";
      layers.villagerT.visible = layers.knightT.visible = S.source === "test";
      return S.source;
    },
    set: (k, v) => {
      if (k === "source") return window.__FORKB_TEST__.setSource(v);
      S[k] = (v === "0" || v === "1") ? v === "1" : (isFinite(+v) ? +v : v);
      if (k === "count") D.spawned = spawn(S.count | 0);
      return S[k];
    },
    cam: () => cam,
    applyCam,
    units: () => units,
    /** park the camera on one unit — the QA/screenshot helper */
    focusUnit: (u, dist) => { cam.tx = u.x; cam.tz = u.z; cam.ty = u.y; cam.dist = dist || 9; applyCam(); },
    render: () => renderer.render(scene, camera),
  });

  boot().catch((e) => { hud("boot failed: " + e.message); console.error(e); });
})();
