/* sprite-demo.js — the viability demo itself.
 *
 * Real Farmstead terrain + real Farmstead camera, populated with wandering
 * villagers that can be drawn THREE ways:
 *    sprite  — billboarded impostors from a baked azimuth x pose atlas
 *    mesh    — the actual 6000-tri villager GLB, instanced (body + 2 legs)
 *    split   — sprites west of the board's midline, meshes east
 *
 * Everything gameplay-ish here is deliberately thin: this measures RENDERING.
 */
(function () {
  "use strict";
  const FSC = window.FSC, FSMap = window.FSMap;
  const W = window.SpriteWorld, IMP = window.SpriteImpostor;

  const Q = new URLSearchParams(location.search);
  const qn = (k, d) => { const v = parseFloat(Q.get(k)); return isFinite(v) ? v : d; };

  const S = {
    mode: Q.get("mode") || "split",       // sprite | mesh | split
    count: qn("count", 200) | 0,
    angles: qn("angles", 16) | 0,
    cell: qn("cell", 128) | 0,
    walk: Q.get("walk") !== "0",
    shadows: Q.get("shadows") !== "0",
    statics: Q.get("statics") || "off",   // off | mesh | sprite
    lightMode: Q.get("light") || "lit",   // lit | flat
    /* which cut of the sculpt: "-vc" 7600 tris (default) · "" textured 7600 ·
     * "-lo-vc" the 2039-tri decimation the game itself now loads */
    variant: { tex: "", lo: "-lo-vc" }[Q.get("variant")] !== undefined
      ? { tex: "", lo: "-lo-vc" }[Q.get("variant")] : "-vc",
    tint: Q.get("tint") === "1",
    pitchFix: Q.get("pitchfix") !== "0",
    billboard: Q.get("bb") === "axis" ? "axis" : "view",   // view-aligned | cylindrical
    bias: qn("bias", 0.22),                                // x quadW, toward the camera
    seed: qn("seed", 7) | 0,
    poses: 7,                             // 1 idle + 6 walk
    maxUnits: 1000,
  };
  const D = { ready: false, stats: {}, notes: [] };
  window.__SPRITE__ = { S, D };

  let renderer, scene, camRig, camera, map, clock;
  let parts = null, partsAlt = null, atlas = null;
  let sprites = null, meshBody = null, meshLegL = null, meshLegR = null, shadowMesh = null;
  let staticGroup = null, staticSprites = null, staticAtlas = null, staticMeshGroup = null;
  const units = [];
  let midX = 0;

  const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpM3 = new THREE.Matrix4();
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion();
  const tmpE = new THREE.Euler(), tmpE2 = new THREE.Euler();
  const ONE = new THREE.Vector3(1, 1, 1);

  // deterministic PRNG for the demo's own scatter (never touches FSC.rng)
  let _r = 0;
  function rnd() { _r = (_r * 1664525 + 1013904223) >>> 0; return _r / 4294967296; }

  // ---------------------------------------------------------------- helpers
  function hud(msg) { const el = document.getElementById("boot"); if (el) el.textContent = msg; }
  function wrapPi(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  /** flatten a loaded GLB part to ONE geometry with its transform baked in,
   * so an InstancedMesh's instanceMatrix alone can place it. */
  function flatten(root) {
    root.updateMatrixWorld(true);
    let geo = null, mat = null;
    root.traverse((o) => {
      if (!o.isMesh || geo) return;
      geo = o.geometry.clone();
      geo.applyMatrix4(o.matrixWorld);
      mat = o.material;
    });
    return { geo, mat };
  }

  // ------------------------------------------------------------------ units
  function spawnUnits() {
    _r = (S.seed * 2654435761) >>> 0;
    units.length = 0;
    const wW = map.W * FSC.TILE, wD = map.H * FSC.TILE * FSC.ROW_Z;
    const cxw = wW * 0.5, czw = wD * 0.5;
    midX = cxw;
    const R = Math.min(wW, wD) * 0.30;
    let guard = 0;
    while (units.length < S.maxUnits && guard < S.maxUnits * 200) {
      guard++;
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R;
      const x = cxw + Math.cos(a) * r, z = czw + Math.sin(a) * r;
      const t = W.terrAt(x, z);
      if (t === FSC.TERR.WATER) continue;
      units.push({
        x, z, y: W.heightAt(x, z), yaw: rnd() * Math.PI * 2,
        tx: x, tz: z, phase: rnd() * Math.PI * 2, moving: true,
        speed: 0.72 + rnd() * 0.22, idleT: 0,
        tint: new THREE.Color(FSC.PLAYER_COLORS[(units.length % 4)]).lerp(new THREE.Color(0xffffff), 0.62),
      });
    }
    D.spawned = units.length;
  }

  function pickTarget(u) {
    for (let k = 0; k < 12; k++) {
      const a = rnd() * Math.PI * 2, r = 3 + rnd() * 12;
      const x = u.x + Math.cos(a) * r, z = u.z + Math.sin(a) * r;
      if (x < 2 || z < 2 || x > map.W * FSC.TILE - 2 || z > map.H * FSC.TILE * FSC.ROW_Z - 2) continue;
      if (W.terrAt(x, z) === FSC.TERR.WATER) continue;
      u.tx = x; u.tz = z; return;
    }
    u.tx = u.x; u.tz = u.z;
  }

  const TURN_RATE = 4.2;                  // rad/s cap, mirrors the game's bounded turn
  function updateUnits(dt) {
    if (D.paused) return;                 // freeze the sim without changing poses
    const n = Math.min(S.count, units.length);
    for (let i = 0; i < n; i++) {
      const u = units[i];
      if (!S.walk) { u.moving = false; continue; }
      let dx = u.tx - u.x, dz = u.tz - u.z;
      let d = Math.hypot(dx, dz);
      if (d < 0.35) {
        if (u.idleT > 0) { u.idleT -= dt; u.moving = false; continue; }
        pickTarget(u);
        u.idleT = rnd() < 0.25 ? 0.6 + rnd() * 1.8 : 0;
        dx = u.tx - u.x; dz = u.tz - u.z; d = Math.hypot(dx, dz);
        if (d < 0.35) { u.moving = false; continue; }
      }
      u.moving = true;
      const want = Math.atan2(dx, dz);
      const dy = wrapPi(want - u.yaw), cap = TURN_RATE * dt;
      u.yaw += Math.abs(dy) <= cap ? dy : (dy < 0 ? -cap : cap);
      const step = u.speed * dt;
      u.x += Math.sin(u.yaw) * step;
      u.z += Math.cos(u.yaw) * step;
      u.y = W.heightAt(u.x, u.z);
      u.phase += (step / 0.55) * Math.PI;      // pi per stride -> 2pi per cycle
      if (u.phase > Math.PI * 2) u.phase -= Math.PI * 2;
    }
  }

  // ------------------------------------------------------------------- draw
  function frameIndexFor(u, camYaw) {
    const N = atlas.angles;
    let rel = camYaw - u.yaw;
    rel = rel % (Math.PI * 2); if (rel < 0) rel += Math.PI * 2;
    const col = Math.round(rel / (Math.PI * 2) * N) % N;
    let row = 0;
    if (u.moving) {
      const walkN = atlas.poses - 1;
      row = 1 + (Math.floor(u.phase / (Math.PI * 2) * walkN) % walkN);
    }
    return row * N + col;
  }

  function draw() {
    const n = Math.min(S.count, units.length);
    const camYaw = camRig.cam.yaw;
    const pitch = camRig.cam.pitch;
    /* view-aligned: the quad IS the bake's image plane, so the tile maps 1:1.
     * cylindrical: the tile's vertical span is world height foreshortened by
     * cos(bakePitch), so it needs a 1/cos stretch to occupy the same screen
     * height the mesh would (pitchFix uses the LIVE pitch, raw uses the bake's). */
    const axisMode = S.billboard === "axis";
    const hDiv = S.pitchFix ? Math.cos(pitch) : Math.cos(atlas.bakePitch);
    const qh = axisMode ? atlas.scaleV / Math.max(0.2, hDiv) : atlas.scaleV;
    const qw = atlas.quadW;
    sprites.material.userData.uMode.value = axisMode ? 1 : 0;
    sprites.material.userData.uFoot.value = atlas.footFrac;
    sprites.material.userData.uBias.value = S.bias * atlas.quadW;

    let ns = 0, nm = 0, nsh = 0;
    const fA = sprites.userData.frames, tA = sprites.userData.tints;
    const shadowOffX = -W.sunDir.x * FSC.VIS.SHADOW_OFF, shadowOffZ = -W.sunDir.z * FSC.VIS.SHADOW_OFF;

    for (let i = 0; i < n; i++) {
      const u = units[i];
      const asSprite = S.mode === "sprite" || (S.mode === "split" && u.x < midX);
      if (asSprite) {
        tmpV.set(u.x, u.y, u.z);              // anchor = the unit's ground point
        tmpQ.identity();
        tmpV2.set(qw, qh, 1);
        sprites.setMatrixAt(ns, tmpM.compose(tmpV, tmpQ, tmpV2));
        fA.setX(ns, frameIndexFor(u, camYaw));
        if (S.tint) tA.setXYZ(ns, u.tint.r, u.tint.g, u.tint.b);
        else if (atlas.lightMode === "flat") {
          /* flat bake: put the world's key light back by facing. Same lambert
           * term the terrain gets, folded to a scalar per instance. */
          const nx = Math.sin(u.yaw), nz = Math.cos(u.yaw);
          const k = 0.72 + 0.34 * Math.max(0, nx * W.sunDir.x + nz * W.sunDir.z);
          tA.setXYZ(ns, k, k, k);
        } else tA.setXYZ(ns, 1, 1, 1);
        ns++;
      } else {
        const step = Math.sin(u.phase);
        const bob = u.moving ? Math.abs(Math.cos(u.phase)) * 0.052 : 0;
        tmpV.set(u.x, u.y + bob, u.z);
        tmpE.set(u.moving ? 0.06 : 0, u.yaw + (u.moving ? step * 0.10 : 0), u.moving ? -step * 0.055 : 0);
        tmpQ.setFromEuler(tmpE);
        tmpM.compose(tmpV, tmpQ, ONE);
        meshBody.setMatrixAt(nm, tmpM);
        // legs: hip offset + swing about X, composed under the body (pushLegs)
        const sw = u.moving ? step * IMP.LEG_SWING : 0;
        tmpV2.set(0.127, 0.256, 0.031); tmpE2.set(sw, 0, 0); tmpQ2.setFromEuler(tmpE2);
        meshLegL.setMatrixAt(nm, tmpM3.multiplyMatrices(tmpM, tmpM2.compose(tmpV2, tmpQ2, ONE)));
        tmpV2.set(-0.120, 0.254, 0.025); tmpE2.set(-sw, 0, 0); tmpQ2.setFromEuler(tmpE2);
        meshLegR.setMatrixAt(nm, tmpM3.multiplyMatrices(tmpM, tmpM2.compose(tmpV2, tmpQ2, ONE)));
        nm++;
      }
      if (S.shadows) {
        tmpV.set(u.x + shadowOffX, u.y + 0.035, u.z + shadowOffZ);
        tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        tmpV2.set(1, 1, 1);
        shadowMesh.setMatrixAt(nsh++, tmpM.compose(tmpV, tmpQ, tmpV2));
      }
    }
    sprites.count = ns; meshBody.count = nm; meshLegL.count = nm; meshLegR.count = nm;
    shadowMesh.count = nsh;
    sprites.instanceMatrix.needsUpdate = true;
    fA.needsUpdate = true; tA.needsUpdate = true;
    meshBody.instanceMatrix.needsUpdate = true;
    meshLegL.instanceMatrix.needsUpdate = true;
    meshLegR.instanceMatrix.needsUpdate = true;
    shadowMesh.instanceMatrix.needsUpdate = true;
    D.spriteCount = ns; D.meshCount = nm;

    // statics
    if (staticGroup) {
      staticMeshGroup.visible = S.statics === "mesh";
      if (staticSprites) {
        staticSprites.visible = S.statics === "sprite";
        if (staticSprites.visible) {
          const sf = staticSprites.userData.frames;
          const N2 = staticAtlas.angles;
          const sqh = axisMode ? staticAtlas.scaleV / Math.max(0.2, hDiv) : staticAtlas.scaleV;
          staticSprites.material.userData.uMode.value = axisMode ? 1 : 0;
          staticSprites.material.userData.uFoot.value = staticAtlas.footFrac;
          staticSprites.material.userData.uBias.value = S.bias * staticAtlas.quadW;
          for (let i = 0; i < staticGroup.length; i++) {
            const o = staticGroup[i];
            tmpV.set(o.x, o.y, o.z);
            tmpQ.identity();
            tmpV2.set(staticAtlas.quadW * o.s, sqh * o.s, 1);
            staticSprites.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpV2));
            let rel = camYaw - o.yaw; rel = rel % (Math.PI * 2); if (rel < 0) rel += Math.PI * 2;
            sf.setX(i, (o.kind * N2) + (Math.round(rel / (Math.PI * 2) * N2) % N2));
          }
          staticSprites.count = staticGroup.length;
          staticSprites.instanceMatrix.needsUpdate = true;
          sf.needsUpdate = true;
        }
      }
    }
  }

  // ----------------------------------------------------------------- boot
  async function boot() {
    const canvas = document.getElementById("view");
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();

    hud("generating map…");
    map = FSMap.generate({ size: 48, seed: S.seed, players: 2 });
    FSMap.bind(map);
    W.build(scene, map);

    camRig = W.makeCamera(canvas);
    camera = camRig.camera;
    const wW = map.W * FSC.TILE, wD = map.H * FSC.TILE * FSC.ROW_Z;
    camRig.cam.tx = wW * 0.5; camRig.cam.tz = wD * 0.5;
    camRig.cam.ty = W.heightAt(wW * 0.5, wD * 0.5);
    camRig.apply();
    resize();

    hud("loading villager GLBs…");
    const t0 = performance.now();
    parts = await IMP.loadVariant(S.variant);
    D.loadMs = Math.round(performance.now() - t0);
    D.tris = parts.tris;

    hud("baking impostors…");
    rebake();
    // objective bake-quality comparisons (cheap, once, at boot)
    try { await bakeComparisons(); } catch (e) { D.notes.push("comparison skipped: " + e.message); }

    buildDrawables();
    buildStatics();
    spawnUnits();

    D.ready = true;
    hud("");
    document.getElementById("ui").classList.remove("hidden");
    syncUI();
    clock = new THREE.Clock();
    loop();
  }

  function rebake() {
    if (atlas && atlas.rt) atlas.rt.dispose();
    atlas = IMP.bake(renderer, parts, {
      angles: S.angles, poses: S.poses, cell: S.cell,
      pitch: camRig ? camRig.cam.pitch : FSC.CAM.PITCH_START,
      lightMode: S.lightMode,
    });
    D.bake = {
      ms: Math.round(atlas.ms * 10) / 10, angles: atlas.angles, poses: atlas.poses,
      cell: atlas.cell, atlas: atlas.atlasW + "x" + atlas.atlasH,
      mb: Math.round(atlas.bytes / 1048576 * 100) / 100,
      pitchDeg: Math.round(atlas.bakePitch * 180 / Math.PI),
      light: atlas.lightMode, footFrac: Math.round(atlas.footFrac * 1000) / 1000,
      quadW: Math.round(atlas.quadW * 1000) / 1000, scaleV: Math.round(atlas.scaleV * 1000) / 1000,
    };
    if (sprites) {
      sprites.material.map = atlas.texture;
      sprites.material.userData.uGrid.value.set(atlas.angles, atlas.poses);
      sprites.material.needsUpdate = true;
    }
  }

  /* ---- objective bake experiments, reported in VIABILITY.md ----
   * 1) textured vs vertex-coloured: which carries more detail at sprite size?
   * 2) how much does the key-light SIDE actually matter to the baked pixels? */
  function readAtlas(a) {
    const buf = new Uint8Array(a.atlasW * a.atlasH * 4);
    renderer.readRenderTargetPixels(a.rt, 0, 0, a.atlasW, a.atlasH, buf);
    return buf;
  }
  function statsOf(buf, w, h) {
    let cov = 0, lum = 0, grad = 0, gn = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (buf[i + 3] < 128) continue;
      cov++;
      const L = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
      lum += L;
      const j = (y * w + x + 1) * 4, k = ((y + 1) * w + x) * 4;
      if (buf[j + 3] > 128 && buf[k + 3] > 128) {
        const Lx = 0.299 * buf[j] + 0.587 * buf[j + 1] + 0.114 * buf[j + 2];
        const Ly = 0.299 * buf[k] + 0.587 * buf[k + 1] + 0.114 * buf[k + 2];
        grad += Math.abs(L - Lx) + Math.abs(L - Ly); gn++;
      }
    }
    return { coverage: cov / (w * h), lum: cov ? lum / cov : 0, sharp: gn ? grad / gn : 0 };
  }
  async function bakeComparisons() {
    const cfg = { angles: 8, poses: 2, cell: 128, pitch: 52 * Math.PI / 180, lightMode: "lit" };
    const a1 = IMP.bake(renderer, parts, cfg);
    const s1 = statsOf(readAtlas(a1), a1.atlasW, a1.atlasH);
    const other = S.variant === "-vc" ? "" : "-vc";
    partsAlt = await IMP.loadVariant(other);
    D.altTris = partsAlt.tris;
    const a2 = IMP.bake(renderer, partsAlt, cfg);
    const s2 = statsOf(readAtlas(a2), a2.atlasW, a2.atlasH);
    // key-light side sensitivity on the SAME variant
    const a3 = IMP.bake(renderer, parts, Object.assign({}, cfg, { sunFlip: true }));
    const b1 = readAtlas(a1), b3 = readAtlas(a3);
    let dsum = 0, dn = 0;
    for (let i = 0; i < b1.length; i += 4) {
      if (b1[i + 3] < 128 || b3[i + 3] < 128) continue;
      dsum += (Math.abs(b1[i] - b3[i]) + Math.abs(b1[i + 1] - b3[i + 1]) + Math.abs(b1[i + 2] - b3[i + 2])) / 3;
      dn++;
    }
    const flat = IMP.bake(renderer, parts, Object.assign({}, cfg, { lightMode: "flat" }));
    const sf = statsOf(readAtlas(flat), flat.atlasW, flat.atlasH);
    const NAME = { "": "textured 7600", "-vc": "vertex-coloured 7600", "-lo-vc": "vertex-coloured 2039 (lo)" };
    D.compare = {
      variantUsed: NAME[S.variant],
      used: { sharp: +s1.sharp.toFixed(2), lum: +s1.lum.toFixed(1), coverage: +s1.coverage.toFixed(4) },
      other: { name: NAME[other], sharp: +s2.sharp.toFixed(2), lum: +s2.lum.toFixed(1), coverage: +s2.coverage.toFixed(4) },
      flatBake: { sharp: +sf.sharp.toFixed(2), lum: +sf.lum.toFixed(1) },
      keyLightSideDelta: dn ? +(dsum / dn).toFixed(2) : 0,
      keyLightSideDeltaPct: dn ? +((dsum / dn) / Math.max(1, s1.lum) * 100).toFixed(1) : 0,
    };
    a1.rt.dispose(); a2.rt.dispose(); a3.rt.dispose(); flat.rt.dispose();
  }

  function buildDrawables() {
    sprites = IMP.makeSprites(S.maxUnits, atlas);
    sprites.name = "sprites";
    scene.add(sprites);

    const b = flatten(parts.body), l = flatten(parts.legL), r = flatten(parts.legR);
    meshBody = new THREE.InstancedMesh(b.geo, b.mat, S.maxUnits);
    meshLegL = new THREE.InstancedMesh(l.geo, l.mat, S.maxUnits);
    meshLegR = new THREE.InstancedMesh(r.geo, r.mat, S.maxUnits);
    [meshBody, meshLegL, meshLegR].forEach((m) => {
      m.frustumCulled = false; m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    });
    meshBody.name = "meshBody";

    const sgeo = new THREE.CircleGeometry(0.26, 10);
    const smat = new THREE.MeshBasicMaterial({
      color: FSC.VIS.SHADOW_COL, transparent: true, opacity: FSC.VIS.SHADOW_OP,
      depthWrite: false, fog: true,
    });
    shadowMesh = new THREE.InstancedMesh(sgeo, smat, S.maxUnits);
    shadowMesh.frustumCulled = false; shadowMesh.count = 0;
    shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shadowMesh.renderOrder = -1;
    scene.add(shadowMesh);
  }

  // ------------------------------------------------------- statics (stretch)
  function treeGeoGroup() {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.16, 1.0, 7),
      W.mat(0x6a4a2c, { emissiveK: 0.3 }));
    trunk.position.y = 0.5; g.add(trunk);
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(1.05 - i * 0.26, 1.25, 9),
        W.mat(i === 0 ? 0x2f5a34 : 0x437a45, { emissiveK: 0.3 }));
      c.position.y = 1.05 + i * 0.62; g.add(c);
    }
    return g;
  }
  function barnGeoGroup() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.7, 3.6), W.mat(0xa8493c, { emissiveK: 0.3 }));
    body.position.y = 0.85; g.add(body);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3.8, 4, 1, false, 0, Math.PI),
      W.mat(0x54606b, { emissiveK: 0.3 }));
    roof.rotation.z = Math.PI / 2; roof.rotation.y = Math.PI / 2;
    roof.position.y = 1.7; roof.scale.set(1, 1, 0.72); g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 1.1), W.mat(0x3a2c22, { emissiveK: 0.3 }));
    door.position.set(1.32, 0.5, 0); g.add(door);
    return g;
  }
  function buildStatics() {
    _r = ((S.seed + 91) * 2654435761) >>> 0;
    const wW = map.W * FSC.TILE, wD = map.H * FSC.TILE * FSC.ROW_Z;
    staticGroup = [];
    for (let i = 0; i < 60; i++) {
      const a = rnd() * Math.PI * 2, r = 6 + Math.sqrt(rnd()) * 26;
      const x = wW * 0.5 + Math.cos(a) * r, z = wD * 0.5 + Math.sin(a) * r;
      if (W.terrAt(x, z) === FSC.TERR.WATER) continue;
      staticGroup.push({ x, z, y: W.heightAt(x, z), yaw: rnd() * Math.PI * 2, s: 0.8 + rnd() * 0.5, kind: i % 12 === 0 ? 1 : 0 });
    }

    // ---- mesh version
    staticMeshGroup = new THREE.Group();
    const tree = treeGeoGroup(), barn = barnGeoGroup();
    for (const o of staticGroup) {
      const c = (o.kind === 0 ? tree : barn).clone(true);
      c.position.set(o.x, o.y, o.z); c.rotation.y = o.yaw; c.scale.setScalar(o.s);
      staticMeshGroup.add(c);
    }
    staticMeshGroup.visible = false;
    scene.add(staticMeshGroup);

    // ---- impostor version: 2 "poses" == 2 KINDS (tree row 0, barn row 1)
    const subject = new THREE.Group();
    const t2 = treeGeoGroup(), b2 = barnGeoGroup();
    subject.add(t2); subject.add(b2);
    staticAtlas = IMP.bakeObject(renderer, subject, (p) => {
      t2.visible = p === 0; b2.visible = p === 1;
    }, { angles: S.angles, poses: 2, cell: S.cell, pitch: camRig.cam.pitch, lightMode: S.lightMode });
    staticSprites = IMP.makeSprites(staticGroup.length, staticAtlas);
    staticSprites.visible = false;
    staticSprites.name = "staticSprites";
    scene.add(staticSprites);
    D.staticBake = { ms: Math.round(staticAtlas.ms * 10) / 10, atlas: staticAtlas.atlasW + "x" + staticAtlas.atlasH, n: staticGroup.length };
  }

  // ------------------------------------------------------------------- loop
  let fpsAcc = 0, fpsN = 0, fpsShown = 0, lastHud = 0;
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    updateUnits(dt);
    draw();
    renderer.info.reset();
    renderer.render(scene, camera);
    const info = renderer.info.render;
    D.calls = info.calls; D.triangles = info.triangles;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.4) { fpsShown = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    D.fps = fpsShown;
    const now = performance.now();
    if (now - lastHud > 200) { lastHud = now; paintStats(); }
  }

  function paintStats() {
    const el = document.getElementById("stats");
    if (!el) return;
    el.innerHTML =
      "<b>" + D.calls + "</b> draw calls &nbsp; <b>" + D.triangles.toLocaleString() + "</b> tris &nbsp; <b>" + D.fps + "</b> fps<br>" +
      "sprites " + D.spriteCount + " &nbsp; meshes " + D.meshCount +
      " &nbsp; (mesh = " + (D.meshCount * parts.tris).toLocaleString() + " tris)<br>" +
      "atlas " + D.bake.atlas + " &nbsp; " + D.bake.mb + " MB &nbsp; bake " + D.bake.ms + " ms" +
      " &nbsp; pitch " + D.bake.pitchDeg + "&deg; &nbsp; " + D.bake.light;
  }

  function resize() {
    if (!renderer || !camera) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, true);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);

  /* draw + render + read the middle of the back buffer (test plumbing) */
  function readFrame() {
    draw();
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const w = Math.min(480, gl.drawingBufferWidth), h = Math.min(300, gl.drawingBufferHeight);
    const x = ((gl.drawingBufferWidth - w) / 2) | 0, y = ((gl.drawingBufferHeight - h) / 2) | 0;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { buf, w, h };
  }

  // --------------------------------------------------------------------- UI
  function syncUI() {
    document.querySelectorAll("[data-k]").forEach((b) => {
      const k = b.getAttribute("data-k"), v = b.getAttribute("data-v");
      const cur = String(S[k]);
      b.classList.toggle("on", cur === v || (v === "1" && S[k] === true) || (v === "0" && S[k] === false));
    });
  }
  function setOpt(k, v) {
    if (v === "1" || v === "0") { if (k === "walk" || k === "shadows" || k === "tint" || k === "pitchFix") v = (v === "1"); }
    if (k === "count" || k === "angles" || k === "cell") v = parseInt(v, 10);
    if (k === "bias") v = parseFloat(v);
    S[k] = v;
    if (k === "angles" || k === "cell" || k === "lightMode") { rebake(); rebakeStatics(); }
    syncUI();
  }
  function rebakeStatics() {
    if (!staticAtlas) return;
    staticAtlas.rt.dispose();
    const subject = new THREE.Group();
    const t2 = treeGeoGroup(), b2 = barnGeoGroup();
    subject.add(t2); subject.add(b2);
    staticAtlas = IMP.bakeObject(renderer, subject, (p) => { t2.visible = p === 0; b2.visible = p === 1; },
      { angles: S.angles, poses: 2, cell: S.cell, pitch: camRig.cam.pitch, lightMode: S.lightMode });
    staticSprites.material.map = staticAtlas.texture;
    staticSprites.material.userData.uGrid.value.set(staticAtlas.angles, staticAtlas.poses);
    staticSprites.material.needsUpdate = true;
  }
  window.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-k]");
    if (b) { setOpt(b.getAttribute("data-k"), b.getAttribute("data-v")); return; }
    const act = e.target.closest && e.target.closest("[data-act]");
    if (act) {
      const a = act.getAttribute("data-act");
      if (a === "rebake") { rebake(); rebakeStatics(); }
      if (a === "panel") document.getElementById("ui").classList.toggle("small");
    }
  });

  // ------------------------------------------------------------- test hook
  Object.assign(window.__SPRITE__, {
    set: setOpt,
    rebake: () => { rebake(); rebakeStatics(); },
    state: () => ({
      ready: D.ready, mode: S.mode, count: S.count, angles: S.angles, cell: S.cell,
      walk: S.walk, statics: S.statics, light: S.lightMode, pitchFix: S.pitchFix,
      calls: D.calls, triangles: D.triangles, fps: D.fps,
      spriteCount: D.spriteCount, meshCount: D.meshCount,
      bake: D.bake, staticBake: D.staticBake, compare: D.compare,
      glbTris: parts ? parts.tris : 0, loadMs: D.loadMs, spawned: D.spawned,
      camYaw: camRig ? camRig.cam.yaw : 0, camPitch: camRig ? camRig.cam.pitch : 0,
      camDist: camRig ? camRig.cam.dist : 0,
    }),
    /* the frame attribute the shader reads — the orbit test asserts these change */
    frames: (n) => {
      const a = sprites.userData.frames.array, out = [];
      for (let i = 0; i < Math.min(n || 24, sprites.count); i++) out.push(a[i]);
      return out;
    },
    setCam: (o) => { Object.assign(camRig.cam, o); camRig.apply(); draw(); },
    camera: () => camera,
    /* render one frame and read the back buffer BEFORE it is swapped away
     * (the canvas has no preserveDrawingBuffer, so this must be inline) */
    renderOnce: () => {
      const f = readFrame();
      let hash = 0, sum = 0;
      for (let i = 0; i < f.buf.length; i += 4) {
        hash = (Math.imul(hash, 31) + f.buf[i] + f.buf[i + 1] * 3 + f.buf[i + 2] * 7) >>> 0;
        sum += f.buf[i] + f.buf[i + 1] + f.buf[i + 2];
      }
      return { hash, mean: Math.round(sum / (f.buf.length / 4) / 3 * 100) / 100 };
    },
    freeze: () => { S.walk = false; syncUI(); },
    pause: (v) => { D.paused = v !== false; },
    stepSim: (dt) => { const p = D.paused; D.paused = false; updateUnits(dt); D.paused = p; },
    /* capture the current frame, then diff a later frame against it — the
     * objective "do sprites look like the meshes" number in VIABILITY.md */
    capture: () => { D.cap = readFrame(); return D.cap.w + "x" + D.cap.h; },
    diffFromCapture: () => {
      const now = readFrame(), old = D.cap;
      if (!old || old.buf.length !== now.buf.length) return null;
      let sum = 0, n = 0, big = 0;
      for (let i = 0; i < now.buf.length; i += 4) {
        const d = (Math.abs(now.buf[i] - old.buf[i]) + Math.abs(now.buf[i + 1] - old.buf[i + 1])
          + Math.abs(now.buf[i + 2] - old.buf[i + 2])) / 3;
        sum += d; n++; if (d > 12) big++;
      }
      return { mean: +(sum / n).toFixed(3), pctDiffer: +(big / n * 100).toFixed(2) };
    },
    units: () => units,
    midX: () => midX,
    /* debug: alphaTest 0 makes the whole quad opaque so its extent is visible */
    setAlphaTest: (v) => { sprites.material.alphaTest = v; sprites.material.needsUpdate = true; },
    atlas: () => atlas,
    staticAtlas: () => staticAtlas,
    renderer: () => renderer,
    scene: () => scene,
    spritesMesh: () => sprites,
    meshes: () => ({ body: meshBody, legL: meshLegL, legR: meshLegR, shadow: shadowMesh }),
  });

  resize();
  boot().catch((e) => { hud("BOOT FAILED: " + e.message); console.error(e); });
})();
