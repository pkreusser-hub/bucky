/* sprite-impostor.js — in-engine impostor baking + the instanced billboard renderer.
 *
 * BAKE: assemble the villager (body + two hip-pivoted legs) exactly the way
 * fs-render's pushLegs() poses it, then render it into ONE WebGLRenderTarget
 * atlas from N azimuths x P poses with an ORTHOGRAPHIC camera pitched to match
 * the game camera.
 *
 * DRAW: one InstancedMesh of unit quads. Billboarding is CYLINDRICAL (world-up
 * stays up, the quad only yaws to face the viewer) so feet stay planted on the
 * terrain; a spherical billboard would tilt units off the ground under the
 * game's 52-degree pitch. Frame selection is a per-instance float attribute.
 */
(function () {
  "use strict";
  const IMP = {};
  window.SpriteImpostor = IMP;

  /* ---- rig constants: measured hips from assets/farmstead/cast/villager/REPORT.md.
   * The leg GLBs already have their origin AT their own hip joint, so parenting
   * a leg to an empty at the measured hip reconstructs the source pose exactly. */
  const HIP_L = { x: 0.127, y: 0.256, z: 0.031 };
  const HIP_R = { x: -0.120, y: 0.254, z: 0.025 };
  const LEG_SWING = 0.52;          // fs-render pushLegs: rad at full stride
  const BOB = 0.052;               // fs-render drawSerf: |cos(phase)| * 0.052
  const MODEL_H = 0.7907;          // measured standing height
  IMP.MODEL_H = MODEL_H;
  IMP.LEG_SWING = LEG_SWING;

  const BASE = "../../assets/farmstead/cast/villager/";
  /* see houseStyle(): the vc GLB's COLOR_0 is already display-referred here */
  IMP.SRGB_VC = /[?&]srgbvc=1/.test(location.search);
  IMP.DBG_UV = /[?&]dbguv=1/.test(location.search);   // paint vAtlas instead of the atlas
  /* DEMO-SIDE EXPOSURE CALIBRATION (an integration note, not a sprite finding).
   * The Tripo villager is authored much brighter than the procedural minifig it
   * replaces: its COLOR_0 modal value is ~(0.75,0.50,0.38) against a grass base
   * of ~(0.42,0.58,0.31). Under the farm's hemi 0.58 + sun 0.72 + fill 0.20 rig
   * plus the standard 0.34 serf emissive lift it clips to a white blob. Gain +
   * a gentler warm lift put him back in the palette the Blender preview shows.
   * Whoever integrates this asset for real has to make the same call somewhere
   * (re-bake the vc colours, or per-kind material constants). */
  IMP.VC_GAIN = 0.72;
  IMP.EMISSIVE_BASE = 0x8a7458;
  IMP.EMISSIVE_K = 0.22;

  // ------------------------------------------------------------ GLB loading
  /** Convert a loaded GLB subtree to the game's flat-Lambert house style.
   * Mirrors FSModels.vcMat("serf", 0x9a9a9a, 0.34) + [[gltf-linear-color-gotcha]]:
   * this repo renders with outputEncoding = Linear, so glTF COLOR_0 (spec:
   * LINEAR) and sRGB-tagged baseColor maps both need un-managing by hand. */
  function houseStyle(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const src = o.material;
      const g = o.geometry;
      /* GOTCHA: the TEXTURED villager GLBs also ship a COLOR_0 attribute, and it
       * is all-zero — a leftover of the split/vc pipeline. Honouring it would
       * multiply the baseColor map to black (measured: baked luminance 55.9,
       * i.e. the emissive lift alone). Vertex colours are only trusted on the
       * untextured (-vc) variant. */
      const hasMap = !!(src && src.map);
      const hasVC = !hasMap && !!(g.attributes && g.attributes.color);
      /* MEASURED, not assumed. villager-body-vc.glb COLOR_0 mean = (0.69,0.49,0.33)
       * — already the tan the Blender preview shows, i.e. DISPLAY values stored
       * raw, not scene-linear. This repo renders with outputEncoding = Linear,
       * so the right move is to pass them through untouched. Running the usual
       * convertLinearToSRGB ([[gltf-linear-color-gotcha]]) pushes the mean to
       * ~0.85 and the peasant blows out to a white blob under the farm's
       * hemi 0.58 + sun 0.72 + fill 0.20 rig. Kept behind a flag as evidence. */
      if (hasVC && IMP.SRGB_VC && !g.userData._srgb) {
        const a = g.attributes.color;
        const c = new THREE.Color();
        for (let i = 0; i < a.count; i++) {
          c.setRGB(a.getX(i), a.getY(i), a.getZ(i)).convertLinearToSRGB();
          a.setXYZ(i, c.r, c.g, c.b);
        }
        a.needsUpdate = true;
        g.userData._srgb = true;
      }
      if (hasVC && !g.userData._gain) {
        const a = g.attributes.color;
        for (let i = 0; i < a.count; i++) {
          a.setXYZ(i, a.getX(i) * IMP.VC_GAIN, a.getY(i) * IMP.VC_GAIN, a.getZ(i) * IMP.VC_GAIN);
        }
        a.needsUpdate = true;
        g.userData._gain = true;
      }
      const map = hasMap ? src.map : null;
      if (map) { map.encoding = THREE.LinearEncoding; map.needsUpdate = true; }
      const base = new THREE.Color(IMP.EMISSIVE_BASE);
      const m = new THREE.MeshLambertMaterial({
        color: hasMap ? new THREE.Color(IMP.VC_GAIN, IMP.VC_GAIN, IMP.VC_GAIN) : 0xffffff,
        map: map,
        vertexColors: hasVC,
        emissive: base.clone().multiplyScalar(IMP.EMISSIVE_K),
      });
      o.material = m;
      if (src && src.dispose) src.dispose();
    });
  }

  function loadGLB(loader, file) {
    return new Promise((res, rej) => loader.load(BASE + file, (g) => res(g.scene), undefined, rej));
  }

  /** Load one variant ("" = textured, "-vc" = vertex-coloured) and return
   * { body, legL, legR, tris } as ready-to-clone Object3Ds. */
  IMP.loadVariant = async function (suffix) {
    const loader = new THREE.GLTFLoader();
    const [body, legL, legR] = await Promise.all([
      loadGLB(loader, "villager-body" + suffix + ".glb"),
      loadGLB(loader, "villager-legL" + suffix + ".glb"),
      loadGLB(loader, "villager-legR" + suffix + ".glb"),
    ]);
    [body, legL, legR].forEach(houseStyle);
    let tris = 0;
    [body, legL, legR].forEach((r) => r.traverse((o) => {
      if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    }));
    return { body, legL, legR, tris: Math.round(tris) };
  };

  /** Build a poseable rig: root -> (bodyPivot, hipL -> legL, hipR -> legR).
   * `parts` may be shared geometry-wise (clone(true) keeps materials shared). */
  IMP.makeRig = function (parts) {
    const root = new THREE.Group();
    const bodyPivot = new THREE.Group();
    bodyPivot.add(parts.body.clone(true));
    root.add(bodyPivot);
    const hipL = new THREE.Group(); hipL.position.set(HIP_L.x, HIP_L.y, HIP_L.z);
    hipL.add(parts.legL.clone(true));
    const hipR = new THREE.Group(); hipR.position.set(HIP_R.x, HIP_R.y, HIP_R.z);
    hipR.add(parts.legR.clone(true));
    bodyPivot.add(hipL); bodyPivot.add(hipR);
    return { root, bodyPivot, hipL, hipR };
  };

  /** Pose the rig for pose index p.  p === 0 -> idle, else walk phase.
   * Swing / bob / torso twist copied from fs-render drawSerf + pushLegs. */
  IMP.poseRig = function (rig, p, poseCount) {
    if (p === 0) {
      rig.bodyPivot.position.set(0, 0, 0);
      rig.bodyPivot.rotation.set(0, 0, 0);
      rig.hipL.rotation.x = 0; rig.hipR.rotation.x = 0;
      return;
    }
    const walkN = poseCount - 1;
    const phase = ((p - 1) / walkN) * Math.PI * 2;
    const step = Math.sin(phase);
    const bob = Math.abs(Math.cos(phase)) * BOB;
    rig.bodyPivot.position.set(0, bob, 0);
    // fs-render: lean 0.06 forward while moving, twist yaw +/-0.10, roll -/+0.055
    rig.bodyPivot.rotation.set(0.06, step * 0.10, -step * 0.055);
    // legs counter-phase about their own hip on X (pushLegs, brace = 0)
    rig.hipL.rotation.x = step * LEG_SWING;
    rig.hipR.rotation.x = -step * LEG_SWING;
  };

  // ------------------------------------------------------------------ bake
  /**
   * bake(renderer, parts, opts) -> {
   *   texture, rt, angles, poses, cell, atlasW, atlasH, bytes, ms,
   *   quadW, footFrac, bakePitch, scaleV
   * }
   * opts: { angles, poses, cell, pitch, lightMode: 'lit'|'flat', sunFlip }
   */
  IMP.bake = function (renderer, parts, opts) {
    const rig = IMP.makeRig(parts);
    return IMP.bakeObject(renderer, rig.root,
      (p, poses) => IMP.poseRig(rig, p, poses), opts);
  };

  /** the general baker: any Object3D + an optional per-pose poser. */
  IMP.bakeObject = function (renderer, subject, poseFn, opts) {
    const t0 = performance.now();
    const angles = opts.angles || 16;
    const poses = opts.poses || 7;
    const cell = opts.cell || 128;
    const pitch = opts.pitch !== undefined ? opts.pitch : (52 * Math.PI / 180);
    const lightMode = opts.lightMode || "lit";
    const V = window.FSC.VIS;

    const scene = new THREE.Scene();
    scene.background = null;
    const rig = { root: subject };
    scene.add(rig.root);
    if (!poseFn) poseFn = function () {};

    /* LIGHTING — the experiment.
     *  'lit'  : the game's hemi + sun + fill, but the two directionals are placed
     *           in the BAKE CAMERA's frame (they rotate with the bake azimuth).
     *           A Delta-indexed atlas (frame = camYaw - unitYaw) provably cannot
     *           carry a world-fixed sun: one frame serves every (facing, camera)
     *           pair with the same difference, and those pairs have different
     *           sun-relative geometry. Camera-relative light is the consistent
     *           choice - what Doom/AoE-era sprite sheets effectively did.
     *  'flat' : hemi only (no directional). Form comes from the model's own
     *           vertex colours; the renderer then multiplies each instance by a
     *           world lambert term for that unit's facing, so the light still
     *           tracks the world's sun. */
    const hemi = new THREE.HemisphereLight(V.HEMI_SKY, V.HEMI_GND,
      lightMode === "flat" ? V.HEMI_I + V.SUN_I * 0.55 + V.FILL_I * 0.5 : V.HEMI_I);
    scene.add(hemi);
    let sun = null, fill = null;
    if (lightMode === "lit") {
      sun = new THREE.DirectionalLight(V.SUN_COL, V.SUN_I);
      fill = new THREE.DirectionalLight(V.FILL_COL, V.FILL_I);
      scene.add(sun); scene.add(fill);
    }

    // ---- framing: camera-space AABB over every pose x azimuth, then a SQUARE
    // frustum (tiles are square, so pixels stay square).
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    const R = 6;
    function placeCam(az) {
      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      cam.position.set(Math.sin(az) * cp * R, sp * R, Math.cos(az) * cp * R);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld();
    }
    const inv = new THREE.Matrix4();
    let xmin = 1e9, xmax = -1e9, ymin = 1e9, ymax = -1e9;
    const pv = new THREE.Vector3();
    const probe = [];
    rig.root.updateMatrixWorld(true);
    for (let p = 0; p < poses; p++) {
      poseFn(p, poses);
      rig.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rig.root);
      probe.push(box.clone());
    }
    for (let a = 0; a < angles; a++) {
      placeCam((a / angles) * Math.PI * 2);
      inv.copy(cam.matrixWorld).invert();
      for (const box of probe) {
        for (let i = 0; i < 8; i++) {
          pv.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
          pv.applyMatrix4(inv);
          if (pv.x < xmin) xmin = pv.x; if (pv.x > xmax) xmax = pv.x;
          if (pv.y < ymin) ymin = pv.y; if (pv.y > ymax) ymax = pv.y;
        }
      }
    }
    const PAD = 0.06;                       // transparent gutter, fraction of the tile
    const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
    let S = Math.max(xmax - xmin, ymax - ymin) / 2;
    S = S / (1 - 2 * PAD);
    cam.left = cx - S; cam.right = cx + S; cam.bottom = cy - S; cam.top = cy + S;
    cam.updateProjectionMatrix();

    /* where does the FEET point (world origin) land inside the tile?
     * (camera-space y of world origin is the same for every azimuth at a fixed
     * pitch, because the orbit is about the world Y axis through the origin) */
    placeCam(0);
    inv.copy(cam.matrixWorld).invert();
    pv.set(0, 0, 0).applyMatrix4(inv);
    const footFrac = (pv.y - (cy - S)) / (2 * S);

    // ---- render target atlas ----
    const atlasW = angles * cell, atlasH = poses * cell;
    const rt = new THREE.WebGLRenderTarget(atlasW, atlasH, {
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      generateMipmaps: true,
      encoding: THREE.LinearEncoding,
    });
    rt.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

    const oldRT = renderer.getRenderTarget();
    const oldAuto = renderer.autoClear;
    const oldClear = renderer.getClearColor(new THREE.Color());
    const oldAlpha = renderer.getClearAlpha();
    const oldScissor = renderer.getScissorTest();
    /* THE BAKE MUST RUN AT PIXEL RATIO 1.
     * WebGLRenderer.setViewport/setScissor take LOGICAL pixels and multiply by
     * the renderer's pixelRatio internally. Baking a 128px tile on a dPR-2
     * display would place it at 2x the offset and 2x the size inside the atlas,
     * and — worse — the "restore" at the end (setViewport(0,0,canvas.width,...)
     * with canvas.width already in DEVICE pixels) doubles again and leaves the
     * MAIN scene rendering into a viewport 2x the framebuffer, i.e. the whole
     * game drawn into the bottom-left quadrant, magnified. That is exactly the
     * bug this comment exists to stop someone re-introducing. */
    const oldPR = renderer.getPixelRatio();
    const oldVp = renderer.getViewport(new THREE.Vector4());
    const oldSc = renderer.getScissor(new THREE.Vector4());
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rt);
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    renderer.autoClear = false;
    renderer.setScissorTest(true);

    const sunFlip = opts.sunFlip ? -1 : 1;
    for (let p = 0; p < poses; p++) {
      poseFn(p, poses);
      for (let a = 0; a < angles; a++) {
        const az = (a / angles) * Math.PI * 2;
        placeCam(az);
        if (sun) {
          /* key over the viewer's LEFT shoulder, fill from the opposite side:
           * both expressed in the bake camera's basis so every frame agrees */
          const rgt = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
          const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
          const fwd = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2); // toward camera
          sun.position.copy(rgt).multiplyScalar(-0.55 * sunFlip)
            .addScaledVector(up, 0.72).addScaledVector(fwd, 0.42).multiplyScalar(50);
          fill.position.copy(rgt).multiplyScalar(0.62 * sunFlip)
            .addScaledVector(up, 0.30).addScaledVector(fwd, 0.20).multiplyScalar(50);
        }
        const x = a * cell, y = p * cell;      // row 0 at the BOTTOM (GL convention)
        renderer.setViewport(x, y, cell, cell);
        renderer.setScissor(x, y, cell, cell);
        renderer.render(scene, cam);
      }
    }

    renderer.setScissorTest(oldScissor);
    renderer.autoClear = oldAuto;
    renderer.setRenderTarget(oldRT);
    renderer.setClearColor(oldClear, oldAlpha);
    renderer.setPixelRatio(oldPR);
    renderer.setViewport(oldVp);
    renderer.setScissor(oldSc);
    /* GL commands are queued, so performance.now() around the submit loop
     * measures almost nothing. Reading a single pixel back off the atlas forces
     * the whole pipeline to drain — without it a 4096px atlas "bakes in 2.7 ms". */
    renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, new Uint8Array(4));
    renderer.getContext().finish();

    // tidy the bake scene (the rig clones own nothing the caller needs)
    scene.remove(rig.root);

    const bytes = Math.round(atlasW * atlasH * 4 * 1.34);   // RGBA8 + mip chain
    return {
      texture: rt.texture, rt, angles, poses, cell, atlasW, atlasH, bytes,
      ms: performance.now() - t0,
      /* runtime quad metrics (see VIABILITY.md "the pitch problem"):
       *   quadW  = tile's world-space horizontal span
       *   scaleV = tile's world-space vertical span BEFORE un-foreshortening;
       *            the drawer divides it by cos(current view pitch)
       *   footFrac = where world y=0 sits inside the tile, 0 = bottom */
      quadW: 2 * S, scaleV: 2 * S, footFrac, bakePitch: pitch, lightMode,
    };
  };

  // ------------------------------------------------- instanced billboard mesh
  /**
   * makeSprites(max, atlas) -> THREE.InstancedMesh with per-instance
   * `aFrame` (float atlas index) and `aTint` (vec3 multiply).
   * Billboarding + atlas UV are injected into MeshBasicMaterial via
   * onBeforeCompile, so fog / alphaTest / tone mapping come along for free.
   */
  /* BILLBOARD MODES — the single most consequential choice in the whole system.
   *
   * 'view'  (default) the quad lies in the CAMERA'S IMAGE PLANE. Because the
   *         bake camera is orthographic and pitched, this reproduces the baked
   *         tile 1:1 at the bake pitch, with no aspect correction anywhere.
   * 'axis'  classic cylindrical billboard: world-up stays up, the quad only
   *         yaws. Never tips when the player changes pitch, but the tile's
   *         vertical span is foreshortened world height, so it needs a
   *         1/cos(pitch) stretch and the result is a card standing in a hole.
   *
   * DEPTH BIAS is required by BOTH. An ortho bake at pitch p contains pixels
   * BELOW the model's ground anchor (the near-side foot, seen from above), and
   * on any plane through the anchor those pixels land at or under the ground —
   * so the terrain z-tests them away and every unit renders with its feet
   * sliced off. Nudging the whole quad toward the camera by roughly half the
   * character's depth puts it in front of the ground it stands on.
   */
  IMP.makeSprites = function (max, atlas, alphaTest) {
    const geo = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.translate(0, 0.5, 0);                  // origin at the quad's BOTTOM centre
    geo.index = plane.index;
    geo.attributes.position = plane.attributes.position;
    geo.attributes.uv = plane.attributes.uv;
    geo.attributes.normal = plane.attributes.normal;
    const frames = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    const tints = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    for (let i = 0; i < max; i++) { tints.setXYZ(i, 1, 1, 1); }
    frames.setUsage(THREE.DynamicDrawUsage);
    tints.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aFrame", frames);
    geo.setAttribute("aTint", tints);

    const mat = new THREE.MeshBasicMaterial({
      map: atlas.texture,
      transparent: false,
      alphaTest: alphaTest === undefined ? 0.3 : alphaTest,
      side: THREE.DoubleSide,
      fog: true,
    });
    mat.userData.uGrid = { value: new THREE.Vector2(atlas.angles, atlas.poses) };
    mat.userData.uFoot = { value: atlas.footFrac };
    mat.userData.uMode = { value: 0 };            // 0 = view-aligned, 1 = cylindrical
    mat.userData.uBias = { value: 0.34 };         // world units toward the camera
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uGrid = mat.userData.uGrid;
      shader.uniforms.uFoot = mat.userData.uFoot;
      shader.uniforms.uMode = mat.userData.uMode;
      shader.uniforms.uBias = mat.userData.uBias;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `
#include <common>
attribute float aFrame;
attribute vec3 aTint;
uniform vec2 uGrid;
uniform float uFoot;
uniform float uMode;
uniform float uBias;
varying vec2 vAtlas;
varying vec3 vTint;
`)
        .replace("#include <project_vertex>", `
  vec3 ipos = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);
  float sx = length(instanceMatrix[0].xyz);
  float sy = length(instanceMatrix[1].xyz);
  vec3 wpos = (modelMatrix * vec4(ipos, 1.0)).xyz;
  // camera world basis straight off the view matrix (rows of its rotation part)
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 camF = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]); // toward the camera
  vec3 R = camR, U = camU;
  if (uMode > 0.5) {
    vec3 toCam = cameraPosition - wpos;
    R = normalize(vec3(toCam.z, 0.0, -toCam.x));
    U = vec3(0.0, 1.0, 0.0);
  }
  vec3 wp = wpos + camF * uBias
          + R * (position.x * sx)
          + U * ((position.y - uFoot) * sy);
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float col = mod(aFrame, uGrid.x);
  float row = floor(aFrame / uGrid.x);
  vAtlas = (vec2(col, row) + uv) / uGrid;
  vTint = aTint;
`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `
#include <common>
varying vec2 vAtlas;
varying vec3 vTint;
`)
        .replace("#include <map_fragment>", IMP.DBG_UV ? `
  diffuseColor = vec4(fract(vAtlas.x * 16.0), fract(vAtlas.y * 7.0), 0.5, 1.0);
` : `
  vec4 texel = texture2D(map, vAtlas);
  diffuseColor *= texel;
  diffuseColor.rgb *= vTint;
`);
      mat.userData.vs = shader.vertexShader;
      mat.userData.fs = shader.fragmentShader;
      mat.userData.compiled = (mat.userData.compiled || 0) + 1;
    };
    mat.customProgramCacheKey = () => "spriteImpostor";

    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.frustumCulled = false;                   // billboards leave their AABB
    mesh.count = 0;
    mesh.userData.frames = frames;
    mesh.userData.tints = tints;
    return mesh;
  };
})();
