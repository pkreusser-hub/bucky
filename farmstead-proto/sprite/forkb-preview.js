/* forkb-preview.js — the ACCEPTANCE TEST for the Fork B production sheets.
 *
 * Loads assets/farmstead/cast/sprites/{manifest.json, *.png} — the real shipped
 * sheets, not an in-engine bake — and draws them over the real Farmstead terrain
 * under a YAW-LOCKED camera (pan + zoom only, exactly what Fork B ships).
 *
 * What it proves, in one page:
 *   - a crowd of serfs walking hex paths with turns, azimuth swapped from the
 *     manifest, walk frame driven by distance walked (the game's own gait clock)
 *   - team tint through the mask sheet, rank tint on knights through mask.G
 *   - a fully composed job: body + hat + tool placed by the generated anchors
 *   - a knight strike loop off the fight rows (duelPose's `l`)
 *   - measureTurnPop(): the azimuth-count experiment, measured not guessed
 *
 * Drawing is three InstancedMeshes: bodies, knights, overlays. Billboarding is
 * VIEW-ALIGNED (the quad lies in the camera's image plane) because the bake is
 * an orthographic render from a pitched camera — see VIABILITY.md, "Two things
 * that had to be solved".
 */
(function () {
  "use strict";
  const FSC = window.FSC, FSMap = window.FSMap, W = window.SpriteWorld;
  const Q = new URLSearchParams(location.search);
  const qn = (k, d) => { const v = parseFloat(Q.get(k)); return isFinite(v) ? v : d; };

  const SHEETS = Q.get("sheets") || "../../assets/farmstead/cast/sprites/";
  const S = {
    count: qn("count", 140) | 0,
    scene: Q.get("scene") || "crowd",     // crowd | composed | knight
    tint: Q.get("tint") !== "0",
    overlays: Q.get("overlays") !== "0",
    bias: qn("bias", 0.22),               // x quad width, toward the camera
    seed: qn("seed", 7) | 0,
    walk: Q.get("walk") !== "0",
    maxUnits: 400,
  };
  const D = { ready: false, notes: [], stats: {} };
  window.__FORKB__ = { S, D };

  let renderer, scene, camera, cam, map, clock, MAN = null;
  let bodyTex = {}, layers = {}, meshRefRig = null, meshRefGroup = null, refMesh = null;
  const units = [];
  let _r = 0;
  function rnd() { _r = (_r * 1664525 + 1013904223) >>> 0; return _r / 4294967296; }
  function hud(m) { const e = document.getElementById("boot"); if (e) e.textContent = m; }
  function wrapPi(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  /* ================================================================== */
  /* SPRITE LAYER — one InstancedMesh, atlas cell chosen per instance     */
  /* ================================================================== */
  /**
   * makeLayer(tex, maskTex, grid, quadWorld, opts)
   *   aFrame  float, absolute cell index (col = frame % cols, row = frame / cols)
   *   aTint   vec3 multiply, applied ONLY where the mask says so
   *   aOff    vec2, camera-plane offset in world units (how overlays are anchored)
   * The mask sheet may be lower resolution than the colour sheet: it is sampled
   * with the same normalised cell UV, so bilinear does the right thing.
   */
  function makeLayer(tex, maskTex, grid, quadWorld, opts) {
    opts = opts || {};
    const max = opts.max || S.maxUnits;
    const geo = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);          // centred on its own origin
    geo.index = plane.index;
    geo.attributes.position = plane.attributes.position;
    geo.attributes.uv = plane.attributes.uv;
    geo.attributes.normal = plane.attributes.normal;
    const frames = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    const tints = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    const tints2 = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    const offs = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    /* aTintW is the OVERLAY sheet's stand-in for a mask texture: an overlay is
     * either wholly tinted (the white-baked hat / rank pip) or not at all (the
     * tools and the pack, which keep their authored colours AND their baked
     * emissive lift). Getting this wrong turns every axe into a white flag. */
    const tintW = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (let i = 0; i < max; i++) { tints.setXYZ(i, 1, 1, 1); tints2.setXYZ(i, 1, 1, 1); }
    [frames, tints, tints2, offs, tintW].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aFrame", frames);
    geo.setAttribute("aTint", tints);
    geo.setAttribute("aTint2", tints2);
    geo.setAttribute("aOff", offs);
    geo.setAttribute("aTintW", tintW);

    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: false, alphaTest: 0.4, side: THREE.DoubleSide, fog: true,
    });
    const U = {
      uGrid: { value: new THREE.Vector2(grid.cols, grid.rows) },
      uQuad: { value: quadWorld },
      uAnchor: { value: new THREE.Vector2(opts.anchorX || 0, opts.anchorY || 0) },
      /* DEPTH BIAS IS A WORLD DISTANCE, NOT A FRACTION OF THIS LAYER'S QUAD.
       * Scaling it by each layer's own quad size pushes the 64 px overlay quad
       * only half as far toward the camera as the 128 px body quad, so the body
       * z-tests every hat and tool away and all you see is the sliver that
       * overhangs his silhouette. */
      uBias: { value: opts.bias },
      uMask: { value: maskTex || tex },
      uHasMask: { value: maskTex ? 1 : 0 },
      uTintEm: { value: new THREE.Vector3().fromArray(MAN.tintEmissive) },
    };
    mat.userData.U = U;
    mat.onBeforeCompile = function (sh) {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `
#include <common>
attribute float aFrame; attribute vec3 aTint; attribute vec3 aTint2;
attribute vec2 aOff; attribute float aTintW;
uniform vec2 uGrid; uniform float uQuad; uniform vec2 uAnchor; uniform float uBias;
varying vec2 vAtlas; varying vec3 vTint; varying vec3 vTint2; varying float vTintW;`)
        .replace("#include <project_vertex>", `
  vec3 ipos = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);
  vec3 wpos = (modelMatrix * vec4(ipos, 1.0)).xyz;
  vec3 R = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 U2 = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 F = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);   // toward camera
  vec3 wp = wpos + F * uBias
          - R * uAnchor.x - U2 * uAnchor.y
          + R * aOff.x + U2 * aOff.y
          + R * (position.x * uQuad) + U2 * (position.y * uQuad);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float col = mod(aFrame, uGrid.x);
  float row = floor(aFrame / uGrid.x + 0.0001);
  vAtlas = (vec2(col, row) + vec2(uv.x, 1.0 - uv.y)) / uGrid;   // sheets are top-left origin
  vTint = aTint; vTint2 = aTint2; vTintW = aTintW;`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `
#include <common>
uniform sampler2D uMask; uniform float uHasMask; uniform vec3 uTintEm;
varying vec2 vAtlas; varying vec3 vTint; varying vec3 vTint2; varying float vTintW;`)
        .replace("#include <map_fragment>", `
  vec4 texel = texture2D(map, vAtlas);
  float mr = vTintW, mg = 0.0;
  if (uHasMask > 0.5) {
    vec4 mk = texture2D(uMask, vAtlas);   // R = team region, G = rank-trim region
    mr = mk.r; mg = mk.g;
  }
  /* the manifest's tintFormula, verbatim. Both regions are handled in ONE pass
   * because they are disjoint geometry; the emissive term is added back because
   * tinted regions bake WITHOUT the game's 0.34 lift — otherwise every sash and
   * every helm plume lands emissive*(1-tint) too dark. */
  vec3 t = mix(mix(vec3(1.0), vTint, mr), vTint2, mg);
  vec3 rgb = texel.rgb * t + uTintEm * max(mr, mg);
  diffuseColor = vec4(rgb, texel.a);`);
      mat.userData.compiled = (mat.userData.compiled || 0) + 1;
    };
    mat.customProgramCacheKey = () => "forkbSprite";
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.userData = { frames, tints, tints2, offs, tintW, grid, quadWorld, U };
    return mesh;
  }

  /* ================================================================== */
  /* MANIFEST HELPERS                                                    */
  /* ================================================================== */
  const HELP = {};
  /** azimuth bin for a world facing yaw, per manifest.bake.azimuthOrder */
  HELP.azIndex = function (yaw) {
    const A = MAN.bake.azimuths, step = Math.PI * 2 / A;
    let d = yaw - MAN.bake.cameraYaw;
    d = ((d % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.round(d / step) % A;
  };
  /** walk frame k from the game's own vis.phase */
  HELP.walkFrame = function (phase, n) {
    const step = Math.PI * 2 / n;
    let p = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.round(p / step) % n;
  };
  /** work frame from serfSwing's 0..1 (frames are uniform in swing) */
  HELP.workFrame = function (swing, n) { return Math.max(0, Math.min(n - 1, Math.round(swing * (n - 1)))); };
  /** nearest fight frame by duelPose's l; returns {row, cell} incl. guard as l=0 */
  HELP.fightFrame = function (l) {
    const P = MAN.subjects.knight.poses;
    let best = { row: P.guard.frames[0].row, k: -1, d: Math.abs(l) };
    P.fight.frames.forEach((f, k) => {
      const d = Math.abs(l - f.l);
      if (d < best.d) best = { row: f.row, k: k, d: d };
    });
    return best;
  };
  /** absolute cell index in a body sheet */
  HELP.bodyCell = function (kind, row, az) { return row * MAN.bake.azimuths + az; };
  HELP.frameOf = function (kind, pose, k) { return MAN.subjects[kind].poses[pose].frames[k]; };

  /* ================================================================== */
  /* UNITS                                                               */
  /* ================================================================== */
  const SERF_TURN_RATE = 7.5;      // fs-render: a serf turns, he never flips
  const SERF_STRIDE = 0.46;        // world units per step
  const JOBS = Object.keys(FSC.JOB_TOOLS).filter((j) => j !== "knight");

  function spawn(n) {
    units.length = 0;
    const W2 = map.W * FSC.TILE, H2 = map.H * FSC.TILE * FSC.ROW_Z;
    let guard = 0;
    while (units.length < n && guard++ < n * 60) {
      const x = 6 + rnd() * (W2 - 12), z = 6 + rnd() * (H2 - 12);
      if (W.terrAt(x, z) === FSC.TERR.WATER) continue;
      const job = JOBS[(rnd() * JOBS.length) | 0];
      const knight = rnd() < 0.18;
      units.push({
        x, z, y: W.heightAt(x, z),
        yaw: ((rnd() * 6) | 0) * (Math.PI / 3),
        head: ((rnd() * 6) | 0) * (Math.PI / 3),
        leg: 2 + rnd() * 5, phase: rnd() * 6.28, speed: 0,
        knight, rank: (rnd() * FSC.KNIGHT_RANKS) | 0,
        job: knight ? "knight" : job,
        player: (rnd() * FSC.PLAYER_COLORS.length) | 0,
        carry: !knight && rnd() < 0.25,
        work: 0, working: false, workT: 0,
        fightL: 0, fightT: rnd() * 3,
      });
    }
    return units.length;
  }

  /** the hex lattice's 6 headings, walked with the game's bounded turn */
  function stepUnit(u, dt) {
    if (!S.walk) { u.speed = 0; return; }
    u.leg -= dt;
    if (u.leg <= 0) {
      // pick a NEW hex heading, never the reverse (a serf does not U-turn on the spot)
      let h;
      do { h = ((rnd() * 6) | 0) * (Math.PI / 3); } while (Math.abs(wrapPi(h - u.head)) > 2.7);
      u.head = h;
      u.leg = 1.6 + rnd() * 4;
      if (!u.knight && rnd() < 0.3) { u.working = true; u.workT = 1.2 + rnd() * 2.5; }
    }
    if (u.working) {
      u.workT -= dt;
      // serfSwing: a slow raise then a fast strike, ~0.7s a stroke
      const p = 0.75, w = 1 - ((u.workT % p) + p) % p / p, RAISE = 0.72;
      u.work = w < RAISE ? w / RAISE : Math.max(0, 1 - (w - RAISE) / (1 - RAISE));
      u.speed = 0;
      if (u.workT <= 0) u.working = false;
      return;
    }
    // facing: turn toward the heading, bounded — this is what makes turn-pop real
    const d = wrapPi(u.head - u.yaw), mx = SERF_TURN_RATE * dt;
    u.yaw += Math.abs(d) <= mx ? d : (d < 0 ? -mx : mx);
    const v = 1.35;
    const nx = u.x + Math.sin(u.yaw) * v * dt, nz = u.z + Math.cos(u.yaw) * v * dt;
    const W2 = map.W * FSC.TILE, H2 = map.H * FSC.TILE * FSC.ROW_Z;
    if (nx > 4 && nz > 4 && nx < W2 - 4 && nz < H2 - 4 && W.terrAt(nx, nz) !== FSC.TERR.WATER) {
      const walked = Math.hypot(nx - u.x, nz - u.z);
      u.x = nx; u.z = nz; u.speed = walked / dt;
      u.phase += (walked / SERF_STRIDE) * Math.PI;   // gait follows the ground
    } else { u.leg = 0; u.speed = 0; }
    u.y = W.heightAt(u.x, u.z);
    if (u.knight) {
      u.fightT -= dt;
      if (u.fightT < 0) u.fightT = 2.4 + rnd() * 2;
      u.fightL = 0;
    }
  }

  /* ================================================================== */
  /* DRAW                                                                */
  /* ================================================================== */
  const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
  const IDQ = new THREE.Quaternion();
  const tc = new THREE.Color();

  function pushInst(layer, x, y, z, frame, tint, ox, oy, tint2, tintW) {
    const i = layer.count;
    if (i >= layer.instanceMatrix.count) return;
    tmpV.set(x, y, z);
    layer.setMatrixAt(i, tmpM.compose(tmpV, IDQ, ONE));
    layer.userData.frames.setX(i, frame);
    layer.userData.offs.setXY(i, ox || 0, oy || 0);
    const u = layer.userData;
    if (tint) u.tints.setXYZ(i, tint.r, tint.g, tint.b); else u.tints.setXYZ(i, 1, 1, 1);
    if (tint2) u.tints2.setXYZ(i, tint2.r, tint2.g, tint2.b); else u.tints2.setXYZ(i, 1, 1, 1);
    u.tintW.setX(i, tintW ? 1 : 0);
    layer.count = i + 1;
  }

  const PPU = () => MAN.bake.pxPerCameraUnit;
  /** cell-pixel delta from the body's FOOT pixel -> camera-plane world offset */
  function anchorOffset(a, out) {
    out.x = (a.x - MAN.footPx.x) / PPU();
    out.y = -(a.y - MAN.footPx.y) / PPU();
    return out;
  }
  const _ao = { x: 0, y: 0 };

  /** place one overlay cell so its pivot lands on a body anchor */
  function pushOverlay(id, rowKey, az, anchor, x, y, z, tint) {
    const ov = MAN.overlays[id];
    if (!ov) return;
    const cells = ov.rows[rowKey] || ov.rows.hold;
    if (!cells) return;
    const c = cells[az];
    if (c.empty) return;      // the host body hides this overlay entirely at this angle
    anchorOffset(anchor, _ao);
    const half = MAN.bake.overlayCell / 2;
    const ox = _ao.x - (c.pivotPx.x - half) / PPU();
    const oy = _ao.y + (c.pivotPx.y - half) / PPU();
    /* ov.tint tells us whether this overlay was baked white-and-emissive-free
     * (hat = per-job colour, pip = per-rank colour) or with its own colours */
    pushInst(layers.overlay, x, y, z, c.cell, tint, ox, oy, null, !!ov.tint);
  }

  function syncUnits() {
    layers.serf.count = 0; layers.knight.count = 0; layers.overlay.count = 0;
    const A = MAN.bake.azimuths;
    const nWalk = MAN.subjects.serf.poses.walk.rows;
    const nWork = MAN.subjects.serf.poses.work.rows;
    for (const u of units) {
      const az = HELP.azIndex(u.yaw);
      if (u.knight) {
        let f, rowKey;
        if (u.fightL !== 0) {
          const ff = HELP.fightFrame(u.fightL);
          f = ff.k < 0 ? HELP.frameOf("knight", "guard", 0) : HELP.frameOf("knight", "fight", ff.k);
          rowKey = ff.k < 0 ? "hold" : "fight:" + ff.k;
        } else if (u.speed > 0.02) {
          f = HELP.frameOf("knight", "walk", HELP.walkFrame(u.phase, MAN.subjects.knight.poses.walk.rows));
          rowKey = "hold";
        } else { f = HELP.frameOf("knight", "guard", 0); rowKey = "hold"; }
        const cell = f.cells[az];
        /* a knight tints TWICE from one mask: team on R (surcoat + both shields),
         * rank trim on G (plume, crossguard, both shield rims) */
        const rt = new THREE.Color(FSC.RANK_COLOR[u.rank] || FSC.RANK_COLOR[0]);
        pushInst(layers.knight, u.x, u.y, u.z, HELP.bodyCell("knight", f.row, az),
          S.tint ? tc.set(FSC.PLAYER_COLORS[u.player]) : null, 0, 0,
          S.tint ? rt : null);
        if (S.overlays) {
          for (let p = 0; p < u.rank; p++) {
            pushOverlay("pip", rowKey === "hold" ? "hold" : rowKey, az, cell.anchors["pip" + p], u.x, u.y, u.z, rt);
          }
        }
        continue;
      }
      let f, rowKey;
      if (u.working) {
        const k = HELP.workFrame(u.work, nWork);
        f = HELP.frameOf("serf", "work", k); rowKey = "work:" + k;
      } else if (u.speed > 0.02) {
        f = HELP.frameOf("serf", "walk", HELP.walkFrame(u.phase, nWalk)); rowKey = "hold";
      } else { f = HELP.frameOf("serf", "idle", 0); rowKey = "hold"; }
      const cell = f.cells[az];
      pushInst(layers.serf, u.x, u.y, u.z, HELP.bodyCell("serf", f.row, az),
        S.tint ? tc.set(FSC.PLAYER_COLORS[u.player]) : null);
      if (!S.overlays) continue;
      /* the profession cap: ONE white-baked sheet, tinted per job. This is the
       * whole combinatorics answer in two lines. */
      pushOverlay("hat", rowKey, az, cell.anchors.hat, u.x, u.y, u.z,
        tc.set(FSC.JOB_COLOR[u.job] || FSC.JOB_COLOR.generic).clone());
      const tools = FSC.JOB_TOOLS[u.job] || [];
      if (tools.length) pushOverlay("tool_" + (MAN.overlays["tool_" + tools[0]] ? tools[0] : "default"),
        rowKey, az, cell.anchors.tool, u.x, u.y, u.z, null);
      else pushOverlay("pack", rowKey, az, cell.anchors.pack, u.x, u.y, u.z, null);
      if (u.carry) {
        // the carried good rides in ROOT space — anchors.carry already knows
        anchorOffset(cell.anchors.carry, _ao);
        // (drawn as a tinted pip so the anchor is visibly exercised)
        pushOverlay("pip", "hold", az, cell.anchors.carry, u.x, u.y, u.z, tc.set(0xcf7a3a).clone());
      }
    }
    for (const k in layers) {
      const L = layers[k];
      L.instanceMatrix.needsUpdate = true;
      /* EVERY per-instance attribute, every frame. Miss one and it silently
       * keeps whatever it held at first upload while an instance index changes
       * meaning underneath it — which is how the knight rank tint spent an
       * afternoon looking like "the mask sheet is broken". */
      L.userData.frames.needsUpdate = true;
      L.userData.tints.needsUpdate = true;
      L.userData.tints2.needsUpdate = true;
      L.userData.offs.needsUpdate = true;
      L.userData.tintW.needsUpdate = true;
    }
  }

  /* ================================================================== */
  /* TURN-POP MEASUREMENT — the azimuth-count experiment                  */
  /* ================================================================== */
  /**
   * A yaw-locked camera trained on one serf who turns at the game's real rate
   * (SERF_TURN_RATE 7.5 rad/s -> 7.16 deg per 60 Hz frame). We step his facing
   * through a full hex heading change and measure the mean absolute per-pixel
   * change between consecutive frames inside a crop around him.
   *
   * Reference is the REAL 3D mesh at continuous yaw. An N-azimuth sheet shows
   * the model at round(yaw / (2PI/N)) * (2PI/N), so quantising the mesh's yaw
   * measures exactly the azimuth error with sprite resolution held out of it —
   * and `mode:"sprite"` cross-checks that proxy against the actual sheets.
   */
  function measureTurnPop(opts) {
    opts = opts || {};
    const N = opts.azimuths || 0;                 // 0 = continuous (the 3D reference)
    const mode = opts.mode || "mesh";
    const steps = opts.steps || 18;
    const dYaw = (SERF_TURN_RATE / 60);           // one 60 Hz frame of turning
    const gl = renderer.getContext();
    const wpx = renderer.domElement.width, hpx = renderer.domElement.height;
    const cw = Math.min(opts.crop || 220, wpx), ch = Math.min(opts.crop || 220, hpx);
    const x0 = ((wpx - cw) / 2) | 0, y0 = ((hpx - ch) / 2) | 0;
    const buf = new Uint8Array(cw * ch * 4);
    let prev = null;
    const diffs = [];

    const u = units[0];
    const savedVis = { serf: layers.serf.visible, knight: layers.knight.visible, overlay: layers.overlay.visible };
    const meshOn = mode === "mesh";
    layers.serf.visible = !meshOn; layers.overlay.visible = !meshOn && S.overlays;
    layers.knight.visible = false;
    if (meshRefGroup) meshRefGroup.visible = meshOn;

    for (let i = 0; i <= steps; i++) {
      const yaw = opts.yaw0 !== undefined ? opts.yaw0 + i * dYaw : i * dYaw;
      const shown = N > 0 ? Math.round(yaw / (Math.PI * 2 / N)) * (Math.PI * 2 / N) : yaw;
      if (meshOn) {
        window.FSCastBake.applyPose(meshRefRig, window.FSCastBake.serfPose("idle", 0, window.FSCastBake.DEFAULTS), shown);
        meshRefGroup.position.set(u.x, u.y, u.z);
      } else {
        u.yaw = yaw; u.speed = 0; u.working = false;
        syncUnits();
      }
      renderer.render(scene, camera);
      gl.readPixels(x0, y0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      const cur = buf.slice();
      if (prev) {
        let s = 0;
        for (let p = 0; p < cur.length; p += 4) {
          s += Math.abs(cur[p] - prev[p]) + Math.abs(cur[p + 1] - prev[p + 1]) + Math.abs(cur[p + 2] - prev[p + 2]);
        }
        diffs.push(s / (cur.length / 4 * 3));
      }
      prev = cur;
    }
    layers.serf.visible = savedVis.serf; layers.knight.visible = savedVis.knight;
    layers.overlay.visible = savedVis.overlay;
    if (meshRefGroup) meshRefGroup.visible = false;

    const sorted = diffs.slice().sort((a, b) => a - b);
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    return {
      azimuths: N, mode: mode, steps: diffs.length,
      mean: +mean.toFixed(4),
      max: +Math.max.apply(null, diffs).toFixed(4),
      p95: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(4),
      popRatio: +(Math.max.apply(null, diffs) / Math.max(1e-6, mean)).toFixed(3),
      diffs: diffs.map((d) => +d.toFixed(3)),
    };
  }

  /**
   * STATIC facing error on the hex lattice.
   *
   * A serf spends almost all his time facing one of the lattice's six 60deg
   * headings — he only passes through anything else during a 0.14 s turn. So an
   * azimuth count that does not divide 60deg renders a STANDING serf permanently
   * wrong: 8 azimuths (45deg) puts a 60deg heading at 45deg, off by 15deg, forever.
   * This measures that as pixels, against the 3D mesh at its true heading.
   */
  function measureFacingError(opts) {
    opts = opts || {};
    const N = opts.azimuths || 12;
    const gl = renderer.getContext();
    const w = renderer.domElement.width, h = renderer.domElement.height;
    const c = Math.min(opts.crop || 260, w, h);
    const x0 = ((w - c) / 2) | 0, y0 = ((h - c) / 2) | 0;
    const a = new Uint8Array(c * c * 4), b2 = new Uint8Array(c * c * 4);
    const savedVis = [layers.serf.visible, layers.knight.visible, layers.overlay.visible];
    layers.serf.visible = layers.knight.visible = layers.overlay.visible = false;
    if (meshRefGroup) meshRefGroup.visible = true;
    const u = units[0];
    const CB = window.FSCastBake;
    const pose = CB.serfPose("idle", 0, CB.DEFAULTS);
    const step = Math.PI * 2 / N;
    let sum = 0, worst = 0, worstDeg = 0;
    const per = [];
    for (let k = 0; k < 6; k++) {
      const trueYaw = k * (Math.PI / 3);                       // a hex lattice heading
      const shownYaw = Math.round(trueYaw / step) * step;      // what an N-sheet shows
      meshRefGroup.position.set(u.x, u.y, u.z);
      CB.applyPose(meshRefRig, pose, trueYaw);
      renderer.render(scene, camera);
      gl.readPixels(x0, y0, c, c, gl.RGBA, gl.UNSIGNED_BYTE, a);
      CB.applyPose(meshRefRig, pose, shownYaw);
      renderer.render(scene, camera);
      gl.readPixels(x0, y0, c, c, gl.RGBA, gl.UNSIGNED_BYTE, b2);
      let s = 0;
      for (let i = 0; i < a.length; i += 4) {
        s += Math.abs(a[i] - b2[i]) + Math.abs(a[i + 1] - b2[i + 1]) + Math.abs(a[i + 2] - b2[i + 2]);
      }
      const d = s / (a.length / 4 * 3);
      const errDeg = Math.abs(((shownYaw - trueYaw) * 180 / Math.PI + 180) % 360 - 180);
      per.push({ headingDeg: k * 60, errDeg: +errDeg.toFixed(2), diff: +d.toFixed(4) });
      sum += d;
      if (d > worst) { worst = d; worstDeg = errDeg; }
    }
    layers.serf.visible = savedVis[0]; layers.knight.visible = savedVis[1];
    layers.overlay.visible = savedVis[2];
    if (meshRefGroup) meshRefGroup.visible = false;
    return {
      azimuths: N, meanDiff: +(sum / 6).toFixed(4), worstDiff: +worst.toFixed(4),
      worstErrDeg: +worstDeg.toFixed(2),
      latticeExact: per.every((p) => p.errDeg < 0.01), per,
    };
  }

  /** park the camera on one unit at a chosen zoom — the measurement rig */
  function focusUnit(u, dist) {
    cam.tx = u.x; cam.tz = u.z; cam.ty = u.y;
    cam.dist = dist || FSC.CAM.DIST_START;
    applyCam();
  }

  /* ================================================================== */
  /* CAMERA — YAW LOCKED. Pan + zoom only. That is Fork B.               */
  /* ================================================================== */
  function applyCam() {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    camera.position.set(
      cam.tx + Math.sin(cam.yaw) * cp * cam.dist,
      cam.ty + sp * cam.dist,
      cam.tz + Math.cos(cam.yaw) * cp * cam.dist);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    camera.updateMatrixWorld();
  }
  function bindCamera(canvas) {
    let drag = null;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    });
    window.addEventListener("pointerup", () => { drag = null; });
    window.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      const k = cam.dist * FSC.CAM.DRAG_PAN;
      const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
      cam.tx -= (dx * c - dy * -s) * k;          // pan only — yaw NEVER changes
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
        /* THE SHEETS ARE TOP-LEFT ORIGIN (manifest.sheets[*].origin), so the
         * texture must NOT be flipped on upload. With three's default
         * flipY = true, v = 0 lands on the image BOTTOM and every cell renders
         * upside down — feet in the sky, and every anchor offset (which is
         * computed in world space, not UV) pointing the wrong way. */
        t.flipY = false;
        t.magFilter = THREE.LinearFilter;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.generateMipmaps = true;
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

    hud("loading manifest…");
    MAN = await (await fetch(SHEETS + "manifest.json")).json();
    D.manifest = { azimuths: MAN.bake.azimuths, pitchDeg: MAN.bake.pitchDeg, source: MAN.sourceModel };

    hud("generating terrain…");
    _r = S.seed >>> 0;
    map = FSMap.generate({ size: 48, seed: S.seed, players: 2 });
    W.build(scene, map);

    camera = new THREE.PerspectiveCamera(FSC.CAM.FOV, 1, FSC.CAM.NEAR, FSC.CAM.FAR);
    /* THE LOCK. Fork B's camera yaw is a constant, and it MUST equal the yaw the
     * sheets were baked for or every sprite faces the wrong way. */
    cam = { tx: 0, tz: 0, ty: 0, dist: FSC.CAM.DIST_START, yaw: MAN.bake.cameraYaw, pitch: MAN.bake.pitchDeg * Math.PI / 180 };
    bindCamera(canvas);

    hud("loading sheets…");
    const names = ["serf-body", "serf-mask", "knight-body", "knight-mask", "overlays"];
    const texs = await Promise.all(names.map((n) => loadTex(SHEETS + n + ".png")));
    names.forEach((n, i) => { bodyTex[n] = texs[i]; });

    const ppu = MAN.bake.pxPerCameraUnit;
    const bodyQuad = MAN.bake.bodyCell / ppu;            // world units across one body cell
    const ovQuad = MAN.bake.overlayCell / ppu;
    /* the quad is centred on its own origin, so shift it by the cell's foot pixel */
    const anchorX = (MAN.footPx.x - MAN.bake.bodyCell / 2) / ppu;
    const anchorY = -(MAN.footPx.y - MAN.bake.bodyCell / 2) / ppu;
    const gSerf = { cols: MAN.sheets["serf-body"].cols, rows: MAN.sheets["serf-body"].rows };
    const gKn = { cols: MAN.sheets["knight-body"].cols, rows: MAN.sheets["knight-body"].rows };
    const gOv = { cols: MAN.sheets.overlays.cols, rows: MAN.sheets.overlays.rows };

    const bias = S.bias * bodyQuad;          // ONE world distance for every layer
    layers.serf = makeLayer(bodyTex["serf-body"], bodyTex["serf-mask"], gSerf, bodyQuad,
      { anchorX, anchorY, bias });
    layers.knight = makeLayer(bodyTex["knight-body"], bodyTex["knight-mask"], gKn, bodyQuad,
      { anchorX, anchorY, bias });
    /* Overlays carry their WHOLE placement in aOff (anchor pixel minus pivot
     * pixel, converted through the one locked scale), so their layer anchor is
     * ZERO. Passing the body's foot anchor here as well double-shifts every hat
     * and tool up by (footPx.y - cell/2)/ppu — 0.31 world units, which reads as
     * the hat hovering a head above the head. */
    /* overlays sit a hair IN FRONT of the body plane. That is safe because the
     * bake renders each overlay behind a depth-only copy of its host body, so
     * anything the torso would hide is already transparent in the cell. */
    layers.overlay = makeLayer(bodyTex.overlays, null, gOv, ovQuad,
      { anchorX: 0, anchorY: 0, bias: bias + 0.02 * bodyQuad, max: S.maxUnits * 6 });
    scene.add(layers.serf); scene.add(layers.knight); scene.add(layers.overlay);

    /* a 3D reference minifig, hidden, used by measureTurnPop("mesh") */
    meshRefRig = window.FSCastBake.makeRig("serf", window.FSCastBake.DEFAULTS);
    meshRefGroup = meshRefRig.root;
    meshRefGroup.visible = false;
    scene.add(meshRefGroup);
    /* …and the FROZEN merged builders, so a sprite can be judged against the
     * geometry it was baked from instead of by eye */
    refMesh = new THREE.Group(); refMesh.visible = false; scene.add(refMesh);

    D.spawned = spawn(S.count);
    // park the camera over the crowd
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
      // a strike loop: duelPose's l over one beat, played on repeat
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
      serfs: layers.serf.count, knights: layers.knight.count, overlays: layers.overlay.count,
    };
  }

  /* ---------------------------------------------------------------- hook */
  Object.assign(window.__FORKB__, {
    state: () => ({
      ready: D.ready, spawned: D.spawned, stats: D.stats, manifest: D.manifest,
      camYaw: cam ? cam.yaw : null, camPitchDeg: cam ? +(cam.pitch * 180 / Math.PI).toFixed(2) : null,
      camDist: cam ? +cam.dist.toFixed(2) : null,
      sheets: MAN ? Object.keys(MAN.sheets) : [],
      layerCounts: { serf: layers.serf && layers.serf.count, knight: layers.knight && layers.knight.count, overlay: layers.overlay && layers.overlay.count },
    }),
    set: (k, v) => {
      S[k] = (v === "0" || v === "1") ? v === "1" : (isFinite(+v) ? +v : v);
      if (k === "count") D.spawned = spawn(S.count | 0);
      return S[k];
    },
    man: () => MAN,
    help: HELP,
    units: () => units,
    focusUnit, measureTurnPop, measureFacingError, applyCam,
    cam: () => cam,
    /** put ONE unit in front of the camera in a chosen configuration */
    poseOne: (o) => {
      units.length = 0;
      const x = o.x !== undefined ? o.x : 20, z = o.z !== undefined ? o.z : 20;
      units.push({
        x, z, y: W.heightAt(x, z), yaw: o.yaw || 0, head: o.yaw || 0, leg: 999,
        phase: o.phase || 0, speed: o.speed || 0, knight: !!o.knight, rank: o.rank || 0,
        job: o.job || "lumberjack", player: o.player || 0, carry: !!o.carry,
        work: o.work || 0, working: !!o.working, workT: 9, fightL: o.fightL || 0, fightT: 0,
      });
      S.walk = false;
      focusUnit(units[0], o.dist || 12);
      syncUnits();
      renderer.render(scene, camera);
      return units[0];
    },
    /**
     * Draw the FROZEN merged 3D builder beside the sprite, both at the same
     * world scale and pose. `side` = "sprite" | "mesh" | "both". This is how the
     * sheets get judged against the geometry they were baked from — it is the
     * same comparison VIABILITY.md made for the impostor demo, but against the
     * real shipped sheets.
     */
    poseCompare: (o) => {
      o = o || {};
      const gap = o.gap === undefined ? 1.1 : o.gap;
      const yaw = o.yaw || 0, knight = !!o.knight;
      window.__FORKB__.poseOne(Object.assign({}, o, { x: 20 - gap / 2, z: 20 }));
      const u = units[0];
      while (refMesh.children.length) {
        const c = refMesh.children.pop();
        if (c.geometry) c.geometry.dispose();
      }
      const FSM = window.FSModels, CB = window.FSCastBake;
      const mat = new THREE.MeshLambertMaterial({
        color: 0xffffff, vertexColors: true,
        emissive: new THREE.Color(0x9a9a9a).multiplyScalar(0.34),
      });
      const body = new THREE.Mesh(knight ? FSM.knightGeo(o.rank || 0, o.player || 0)
        : FSM.serfGeo(o.job || "lumberjack", o.player || 0), mat);
      const pivot = new THREE.Group();
      pivot.add(body);
      /* the mesh must take the SAME frame the sprite path resolves to, or the
       * comparison quietly compares two different poses */
      let p;
      if (knight) {
        if (o.fightL) {
          const ff = HELP.fightFrame(o.fightL);
          p = ff.k < 0 ? CB.knightPose("guard", 0, CB.DEFAULTS) : CB.knightPose("fight", ff.k, CB.DEFAULTS);
        } else p = CB.knightPose("guard", 0, CB.DEFAULTS);
      } else if (o.working) {
        p = CB.serfPose("work", HELP.workFrame(o.work === undefined ? 1 : o.work,
          MAN.subjects.serf.poses.work.rows), CB.DEFAULTS);
      } else if (o.speed) {
        p = CB.serfPose("walk", HELP.walkFrame(o.phase || 0, MAN.subjects.serf.poses.walk.rows), CB.DEFAULTS);
      } else p = CB.serfPose("idle", 0, CB.DEFAULTS);
      pivot.position.set(0, p.bob, 0);
      pivot.rotation.set(p.rx, yaw + p.twist, p.rz);
      const hipX = knight ? CB.KNIGHT_HIP_X : CB.SERF_HIP_X;
      const hipY = knight ? CB.KNIGHT_HIP_Y : CB.SERF_HIP_Y;
      for (let s2 = -1; s2 <= 1; s2 += 2) {
        const h = new THREE.Group();
        h.position.set(s2 * hipX, hipY, 0);
        h.rotation.x = p.stride * CB.LEG_SWING * (s2 < 0 ? 1 : -1) + p.brace * 0.22 * s2;
        h.add(new THREE.Mesh(knight ? FSM.knightLegGeo() : FSM.serfLegGeo(), mat));
        pivot.add(h);
      }
      refMesh.add(pivot);
      refMesh.position.set(20 + gap / 2, W.heightAt(20 + gap / 2, 20), 20);
      const side = o.side || "both";
      refMesh.visible = side !== "sprite";
      layers.serf.visible = layers.knight.visible = layers.overlay.visible = side !== "mesh";
      cam.tx = 20; cam.tz = 20; cam.ty = u.y; cam.dist = o.dist || 4;
      applyCam();
      syncUnits();
      renderer.render(scene, camera);
      return { spriteX: u.x, meshX: refMesh.position.x };
    },
    /** on-screen height of the drawn unit, in pixels — the context every
     * turn-pop number needs. Measured by differencing the frame against one
     * rendered with the sprite layers hidden. */
    unitPixelHeight: (crop) => {
      const gl = renderer.getContext();
      const w = renderer.domElement.width, h = renderer.domElement.height;
      const c = Math.min(crop || 300, w, h);
      const x0 = ((w - c) / 2) | 0, y0 = ((h - c) / 2) | 0;
      const a = new Uint8Array(c * c * 4), b2 = new Uint8Array(c * c * 4);
      const vis = [layers.serf.visible, layers.knight.visible, layers.overlay.visible];
      layers.serf.visible = layers.knight.visible = layers.overlay.visible = false;
      renderer.render(scene, camera);
      gl.readPixels(x0, y0, c, c, gl.RGBA, gl.UNSIGNED_BYTE, a);
      layers.serf.visible = vis[0]; layers.knight.visible = vis[1]; layers.overlay.visible = vis[2];
      renderer.render(scene, camera);
      gl.readPixels(x0, y0, c, c, gl.RGBA, gl.UNSIGNED_BYTE, b2);
      let lo = 1e9, hi = -1;
      for (let y = 0; y < c; y++) {
        for (let x = 0; x < c; x++) {
          const i = (y * c + x) * 4;
          if (Math.abs(a[i] - b2[i]) + Math.abs(a[i + 1] - b2[i + 1]) + Math.abs(a[i + 2] - b2[i + 2]) > 24) {
            if (y < lo) lo = y; if (y > hi) hi = y; break;
          }
        }
      }
      return hi < 0 ? 0 : hi - lo + 1;
    },
    showAll: () => {
      if (refMesh) refMesh.visible = false;
      layers.serf.visible = layers.knight.visible = layers.overlay.visible = true;
    },
    /** read the pixels under one unit — used to prove tint hits mask regions only */
    sampleCrop: (cw) => {
      const gl = renderer.getContext();
      const w = renderer.domElement.width, h = renderer.domElement.height;
      const c = Math.min(cw || 260, w, h);
      const x0 = ((w - c) / 2) | 0, y0 = ((h - c) / 2) | 0;
      const buf = new Uint8Array(c * c * 4);
      renderer.render(scene, camera);
      gl.readPixels(x0, y0, c, c, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return { w: c, h: c, data: Array.from(buf) };
    },
    render: () => renderer.render(scene, camera),
  });

  boot().catch((e) => { hud("boot failed: " + e.message); console.error(e); });
})();
