/* fs-goods-bake.js — bake every carried/stacked GOOD into one impostor sheet.
 *
 * WHY: all 26 goods used to draw as the same 0.30-unit crate in a different
 * colour (FSModels.crateGeo tinted per resource). You could not tell a loaf
 * from a pig at a flag, and a settler crossing the map told you nothing about
 * what he was carrying. Each good now has its own sculpt (FSModels.goodGeo),
 * and this bakes those sculpts down to sprite cells so the game pays 1 draw
 * call and 2 triangles per good instead of a mesh pool per kind.
 *
 * THE RULES ARE THE CAST SHEETS' RULES — same pitch, same camera-relative key
 * light, same dPR-1 discipline, same top-left PNG origin — so a good sits with
 * the people rather than looking like it came from a different game:
 *   · ONE locked frustum for all goods, measured over every model at every
 *     azimuth, so the sheet's cells are directly comparable and a plank really
 *     is bigger than a lump of coal.
 *   · 8 azimuths, not the cast's 16. A good is near-rotationally-simple and
 *     ~24 px on screen; the measured stepping signature (see the driver's
 *     --report) does not justify doubling the sheet.
 *   · CAMERA-RELATIVE key light, because the game camera turns and one cell has
 *     to serve every (object yaw, camera yaw) pair sharing that difference —
 *     exactly the argument that re-baked the cast sheets on 2026-08-01.
 *   · footPx: the projected GROUND anchor (the model's own origin), one
 *     constant for the whole sheet. Not the lowest opaque pixel — these models
 *     have depth, and a pitched camera maps depth to screen-y.
 */
(function () {
  "use strict";
  const B = {};
  window.FSGoodsBake = B;

  const DEG = Math.PI / 180;
  const DEFAULTS = {
    azimuths: 8,
    cell: 64,
    pitchDeg: 52,          // FSC.CAM.PITCH_START — the pitch the cast is baked at
    cameraYaw: 0,
    pad: 0.10,             // frustum slack, as a fraction of the measured half-span
  };

  /* the cast baker's KEY_YAW_MIX = 1.0 rule, restated: the bake camera stands
   * still and the MODEL turns, so the world sun at the bake yaw already IS a
   * camera-space direction. Goods light identically to the terrain at camera
   * yaw 0 and drift as you turn, by the same measured-negligible amount. */
  function keyDirCamera(cfg) {
    const d = new THREE.Vector3(0.55, 1.0, 0.35);
    const az = cfg.cameraYaw;
    const c = Math.cos(-az), s = Math.sin(-az);
    return new THREE.Vector3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
  }
  function makeLights(scene, cfg) {
    const V = FSC.VIS;
    scene.add(new THREE.HemisphereLight(V.HEMI_SKY, V.HEMI_GND, V.HEMI_I));
    const k = keyDirCamera(cfg);
    const sun = new THREE.DirectionalLight(V.SUN_COL, V.SUN_I);
    sun.position.copy(k).multiplyScalar(100);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(V.FILL_COL, V.FILL_I);
    fill.position.set(-0.6, 0.45, -0.55).multiplyScalar(100);
    scene.add(fill);
    return [Math.round(k.x * 1e4) / 1e4, Math.round(k.y * 1e4) / 1e4, Math.round(k.z * 1e4) / 1e4];
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

  /* EXACT camera-space bounds from real VERTICES, never from the world AABB's
   * corners: a yawed object's AABB corners are empty air, and projecting them
   * inflated the cast's shared frustum ~70%. And getX/getY/getZ, never `.array`
   * — that one is only a hazard for externally-authored GLBs, but the rule is
   * cheap and the counter-example cost a whole session once. */
  const _inv = new THREE.Matrix4(), _pv = new THREE.Vector3(), _mm = new THREE.Matrix4();
  function camBox(cam, obj, acc) {
    _inv.copy(cam.matrixWorld).invert();
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      /* `visible === false` MATTERS here: every good hangs off the same pivot
       * and they are shown one at a time, so a traversal that ignores
       * visibility measures the union of all 26 and reports every good as
       * filling exactly the same fraction of its cell (it did). */
      if (!o.isMesh || o.visible === false) return;
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
  const _cp = new THREE.Vector3();
  function camPoint(cam, v, out) {
    _inv.copy(cam.matrixWorld).invert();
    return out.copy(v).applyMatrix4(_inv);
  }

  function goodMaterial() {
    /* the game's own goods material: flat Lambert, vertex colours, with the
     * same modest emissive lift the crate pool uses so an unlit underside is
     * still a colour rather than a black hole ([[gltf-linear-color-gotcha]]'s
     * lesson, applied to procedural geometry). */
    const e = new THREE.Color(0x808080).multiplyScalar(0.34);
    return new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, emissive: e });
  }

  B.bake = function (renderer, userCfg) {
    const cfg = Object.assign({}, DEFAULTS, userCfg || {});
    const t0 = performance.now();
    const ids = (cfg.goods && cfg.goods.length) ? cfg.goods : FSC.RES_LIST.slice();
    const A = cfg.azimuths, cell = cfg.cell;

    const scene = new THREE.Scene();
    const keyDir = makeLights(scene, cfg);
    const cam = makeCamera(cfg);
    const mat = goodMaterial();

    // one pivot per good; the pivot YAWS through the azimuth grid
    const pivot = new THREE.Group();
    scene.add(pivot);
    const meshes = {};
    for (const id of ids) {
      const m = new THREE.Mesh(FSModels.goodGeo(id), mat);
      m.visible = false;
      pivot.add(m);
      meshes[id] = m;
    }

    /* ---- ONE frustum for every good at every azimuth ------------------- */
    const acc = { xmin: 1e9, xmax: -1e9, ymin: 1e9, ymax: -1e9 };
    const perGood = {};
    for (const id of ids) {
      meshes[id].visible = true;
      const a2 = { xmin: 1e9, xmax: -1e9, ymin: 1e9, ymax: -1e9 };
      for (let a = 0; a < A; a++) {
        pivot.rotation.y = (a / A) * Math.PI * 2;
        camBox(cam, pivot, a2);
      }
      meshes[id].visible = false;
      perGood[id] = a2;
      acc.xmin = Math.min(acc.xmin, a2.xmin); acc.xmax = Math.max(acc.xmax, a2.xmax);
      acc.ymin = Math.min(acc.ymin, a2.ymin); acc.ymax = Math.max(acc.ymax, a2.ymax);
    }
    const cx = (acc.xmin + acc.xmax) / 2, cy = (acc.ymin + acc.ymax) / 2;
    const halfSpan = Math.max(acc.xmax - acc.xmin, acc.ymax - acc.ymin) / 2 * (1 + cfg.pad);
    setFrustum(cam, cx, cy, halfSpan);
    const pxPerUnit = cell / (halfSpan * 2);

    /* the ground anchor: the model origin (0,0,0), projected once. Every good
     * is authored standing ON y=0, so this is where the sprite touches down. */
    const foot = projectWorld(cam, new THREE.Vector3(0, 0, 0), cx, cy, halfSpan, pxPerUnit, cell);

    /* ---- render the grid: one ROW per good, one COLUMN per azimuth ----- */
    const w = A * cell, h = ids.length * cell;
    const rt = makeRT(w, h);
    const st = pushRendererState(renderer);
    renderer.setRenderTarget(rt);
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    renderer.setScissorTest(true);
    const rows = {};
    for (let r = 0; r < ids.length; r++) {
      const id = ids[r];
      meshes[id].visible = true;
      /* GL's viewport origin is BOTTOM-left and the PNG's is TOP-left, so row r
       * of the sheet is written at gy = h - (r+1)*cell and the whole buffer is
       * flipped once at the end. */
      const gy = h - (r + 1) * cell;
      for (let a = 0; a < A; a++) {
        pivot.rotation.y = (a / A) * Math.PI * 2;
        renderer.setViewport(a * cell, gy, cell, cell);
        renderer.setScissor(a * cell, gy, cell, cell);
        renderer.render(scene, cam);
      }
      meshes[id].visible = false;
      const bb = perGood[id];
      rows[id] = {
        row: r,
        // how much of its cell this good's silhouette actually fills (a review number)
        fill: Math.round(Math.max(bb.xmax - bb.xmin, bb.ymax - bb.ymin) / (halfSpan * 2) * 100) / 100,
        h: Math.round((bb.ymax - bb.ymin) * 1e3) / 1e3,
      };
    }
    const buf = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    popRendererState(renderer, st);
    rt.dispose();

    const manifest = {
      kind: "farmstead-goods-impostors",
      version: 1,
      sheet: { file: "goods.png", w: w, h: h, cell: cell },
      bake: {
        azimuths: A,
        pitchDeg: cfg.pitchDeg,
        cameraYaw: cfg.cameraYaw,
        lighting: { mode: "camera-relative", keyDir: keyDir },
        frustum: { cx: r4(cx), cy: r4(cy), halfSpan: r4(halfSpan) },
        pxPerCameraUnit: r4(pxPerUnit),
        footPx: { x: r2(foot.x), y: r2(foot.y) },
        ms: Math.round(performance.now() - t0),
      },
      goods: ids,
      rows: rows,
    };
    return { manifest: manifest, sheet: { w: w, h: h, rgba: flipRows(buf, w, h) } };
  };

  function r4(v) { return Math.round(v * 1e4) / 1e4; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function setFrustum(cam, cx, cy, S) {
    cam.left = cx - S; cam.right = cx + S; cam.bottom = cy - S; cam.top = cy + S;
    cam.updateProjectionMatrix();
  }
  function projectWorld(cam, v, cx, cy, S, pxPerUnit, cell) {
    camPoint(cam, v, _cp);
    return { x: (_cp.x - (cx - S)) * pxPerUnit, y: cell - (_cp.y - (cy - S)) * pxPerUnit };
  }
  function makeRT(w, h) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, generateMipmaps: false, encoding: THREE.LinearEncoding,
    });
  }
  /* dPR 1, always: setViewport/setScissor take LOGICAL pixels and multiply by
   * the renderer's pixel ratio (VIABILITY.md's longest debugging session). */
  function pushRendererState(renderer) {
    const s = {
      rt: renderer.getRenderTarget(), auto: renderer.autoClear,
      clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
      scissorTest: renderer.getScissorTest(), pr: renderer.getPixelRatio(),
      vp: renderer.getViewport(new THREE.Vector4()), sc: renderer.getScissor(new THREE.Vector4()),
    };
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    return s;
  }
  function popRendererState(renderer, s) {
    renderer.setScissorTest(s.scissorTest);
    renderer.autoClear = s.auto;
    renderer.setRenderTarget(s.rt);
    renderer.setClearColor(s.clear, s.alpha);
    renderer.setPixelRatio(s.pr);
    renderer.setViewport(s.vp);
    renderer.setScissor(s.sc);
  }
  /** GL reads bottom-up; PNGs are written top-down. */
  function flipRows(buf, w, h) {
    const out = new Uint8Array(buf.length);
    const stride = w * 4;
    for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * stride, (h - y) * stride), y * stride);
    return out;
  }
  /** RGBA -> a data: PNG via canvas (sharp's native binding is broken here). */
  B.toPNG = function (sheet) {
    const c = document.createElement("canvas");
    c.width = sheet.w; c.height = sheet.h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(sheet.w, sheet.h);
    img.data.set(sheet.rgba);
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  };
})();
