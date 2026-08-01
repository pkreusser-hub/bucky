/* FARMSTEAD fs-render.js — scene, terrain mesh, object layer, camera, picking.
 * Reads G, never mutates it. All world content comes from FSModels (procedural).
 *
 * Object layer = one THREE.InstancedMesh per object kind (tree species x stage,
 * stone size, field stage...), with a free-list allocator so a single vertex can
 * be updated later via FSRender.refreshVertex(v) — that is the Phase B/C hook for
 * felled trees, growing fields, spent stone piles and terrain levelling.
 */
(function () {
  "use strict";
  const FSC = window.FSC, FSMap = window.FSMap, FSModels = window.FSModels;
  const COL = FSC.COL, CAM = FSC.CAM;
  const FSRender = {};

  let renderer = null, scene = null, camera = null, canvas = null, G = null, map = null;
  let terrainMesh = null, waterMesh = null, objGroup = null, bldGroup = null, hoverRing = null;
  let posAttr = null, colAttr = null;
  let dirtyPos = false, dirtyCol = false;
  let waterDist = null;
  /* ===== PHASE-V: the look layer — sky, water FX, meadow decor, shadows ===== */
  let skyMesh = null, shimmerMesh = null;
  let foamMesh = null, foamV = null, foamPhase = 0;
  let sparkMesh = null, sparkV = null;
  let decorGroup = null;            // tufts + flowers + static blob shadows
  let decorRate = 1;                // thinned on big maps so the cap is never hit
  /* ===== PHASE-F: flowers were "tucked into" a tuft clump in Phase V; now that
   * tufts default OFF (FSC.VIS.TUFT_PER_VERTEX=0) they scatter independently
   * straight onto grass vertices, with their OWN big-map thinning rate. ===== */
  let flowerRate = 1;
  let quality = 1;                  // 1 = full meadow; software rasterisers get less
  const decor = {};                 // key -> { mesh, cap, top, free[], anchor:Float32Array }
  const decorSlot = new Map();      // vertex -> [{key, idx}, ...]
  let swayCursor = 0, windCursor = 0;
  let hemiLight = null, sunLight = null, fillLight = null;
  const pools = {};                 // kind -> { mesh, cap, top, free[] }
  const vertSlot = new Map();       // vertex -> { key, idx }
  const bldViews = new Map();       // building id -> Object3D
  let hoverV = -1, hoverPend = null;
  let invertY = false;              /* ===== PHASE-E: Settings → invert camera ===== */
  const keys = Object.create(null);
  let drag = null;                  // { mode:'pan'|'orbit', x, y, id }
  const cam = { tx: 0, tz: 0, ty: 0, dist: CAM.DIST_START, yaw: 0.6, pitch: CAM.PITCH_START };
  const stats = { fps: 0, drawCalls: 0, tris: 0, frames: 0, ms: 0 };
  let fpsAcc = 0, fpsFrames = 0, tAccum = 0;
  const ray = new THREE.Raycaster();
  const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3(), tmpC = new THREE.Color(), tmpE = new THREE.Euler();
  /* ===== PHASE P: a second set, for composing a LIMB matrix under an already
   * composed body matrix (legs) without clobbering the body's own scratch. */
  const tmpM2 = new THREE.Matrix4(), tmpM3 = new THREE.Matrix4();
  const tmpV2 = new THREE.Vector3(), tmpQ2 = new THREE.Quaternion();
  const tmpS2 = new THREE.Vector3(), tmpE2 = new THREE.Euler();
  /* ===== PHASE E (QoL#5): zoom-to-cursor scratch — a flat plane at the
   * camera target's own height + one more reusable Vector3 (tmpV is used
   * for the "after" read in the same call, so this needs to be distinct). ===== */
  const zoomPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tmpZoomV = new THREE.Vector3();
  const blendC = new THREE.Color();   // lerp target — MUST NOT alias the `out` colour
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const xz = [0, 0];

  function hash01(v, salt) {
    let a = (Math.imul(v ^ (salt || 0), 2246822519) ^ 0x9e3779b9) >>> 0;
    a = Math.imul(a ^ (a >>> 15), 2654435761) >>> 0;
    return (a >>> 8) / 16777216;
  }

  /* ===== PHASE-D: military render state (borders, duels, fire, flashes) ===== */
  const mil = { tint: true, gen: -1, stakes: [], evT: -1, flashes: [] };

  // ------------------------------------------------------------------- terrain
  /* ===== PHASE-V: two lazy sine fields give the meadow big soft blotches so a
   * pasture reads as ground with a history instead of one flat fill. Cheap,
   * deterministic, and completely independent of the sim RNG. ===== */
  function patchNoise(x, z) {
    const V = FSC.VIS;
    return Math.sin(x * V.PATCH_FA + z * V.PATCH_FA * 0.63) * Math.cos(z * V.PATCH_FA * 1.31 - x * 0.017) * V.PATCH_A
      + Math.sin(x * V.PATCH_FB * 1.7 - z * V.PATCH_FB) * V.PATCH_B;
  }

  function terrainColor(v, out) {
    const V = FSC.VIS, T = FSC.TERR;
    const t = map.terr[v], h = map.height[v];
    FSMap.worldXZ(map, v, xz);
    out.set(COL.TERR[t]);
    // average neighbour height drop — used for slope shading and cliff rock
    let dh = 0, dn = 0;
    for (let d = 0; d < 6; d++) { const u = FSMap.nbr(map, v, d); if (u >= 0) { dh += Math.abs(map.height[u] - h); dn++; } }
    if (dn) dh /= dn;
    const wd = waterDist ? waterDist[v] : 9;
    if (t === T.WATER) {
      // lake bed: shallow sand fading to deep blue-grey
      blendC.set(COL.BEACH);
      const k = Math.max(0, Math.min(1, (h + 2.2) / 2.2));
      out.lerp(blendC, k * 0.62);
    } else {
      if (t === T.MOUNTAIN) {
        const k = Math.max(0, Math.min(1, (h - FSC.GEN.MOUNTAIN_Y) / Math.max(0.1, FSC.GEN.SNOW_Y - FSC.GEN.MOUNTAIN_Y)));
        /* ===== PHASE-V: a mountain is not one grey lump. The lower slopes keep
         * a wash of the meadow they grew out of, bands of warm and cool strata
         * ripple across the face, the steep crags go bare slate, and only the
         * top fifth takes snow. ===== */
        blendC.set(COL.TERR[1]);
        out.lerp(blendC, Math.max(0, 0.34 - k * 1.7));                       // grass creeps up
        const strata = Math.sin(h * 1.35 + hash01(v, 29) * 0.9) * 0.5 + 0.5;
        blendC.set(V.ROCK_WARM); out.lerp(blendC, strata * 0.30);
        blendC.set(V.ROCK_COOL); out.lerp(blendC, (1 - strata) * 0.22);
        blendC.set(V.ROCK_STEEP);
        out.lerp(blendC, Math.max(0, Math.min(0.62, (dh - 0.28) * 0.55)));   // bare crag
        blendC.set(COL.TERR[5]); out.lerp(blendC, Math.max(0, k - 0.62) * 1.6);
      } else if (t === T.SNOW) {
        blendC.set(V.SNOW_SHADE);
        out.lerp(blendC, Math.max(0, Math.min(0.5, (dh - 0.25) * 0.5)));
      } else if (t === T.GRASS) {
        // meadows dry out as they climb, and pool into deep green in the hollows
        blendC.set(COL.GRASS_DRY);
        out.lerp(blendC, Math.max(0, Math.min(0.52, h / (FSC.GEN.PLAIN_H * 1.6))));
        const p = patchNoise(xz[0], xz[1]);
        blendC.set(p > 0 ? V.GRASS_DEEP : COL.GRASS_DRY);
        out.lerp(blendC, Math.min(0.34, Math.abs(p) * 2.6));
      } else if (t === T.SWAMP) {
        // marsh: standing water pools where the ground is flattest
        blendC.set(V.SWAMP_WET);
        out.lerp(blendC, 0.18 + Math.max(0, 0.30 - dh * 0.6));
      } else if (t === T.DESERT) {
        const p = patchNoise(xz[0] * 1.4, xz[1] * 1.4);
        blendC.set(COL.BEACH);
        out.lerp(blendC, 0.18 + Math.min(0.24, Math.abs(p) * 2.0));
      }
      // beach: sand creeps up the shore, brightest right at the waterline
      if (wd <= 2) { blendC.set(COL.BEACH); out.lerp(blendC, wd === 1 ? 0.72 : 0.30); }
    }
    // slope darkening + a little per-vertex noise so big fields never read flat
    const rocky = (t === T.MOUNTAIN || t === T.SNOW) ? 1.9 : 1;
    const shade = 1 - Math.min(0.28, dh * 0.14) + (hash01(v, 7) - 0.5) * 0.09 * rocky;
    out.multiplyScalar(shade);
    /* ===== PHASE-D: a whisper of the owner's colour over held ground ===== */
    if (mil.tint) {
      const p = map.owner[v];
      if (p >= 0) { blendC.set(FSC.PLAYER_COLORS[p % FSC.PLAYER_COLORS.length]); out.lerp(blendC, FSC.TERRITORY_TINT); }
    }
    return out;
  }

  function buildTerrain() {
    const V = FSC.VIS;
    const W = map.W, H = map.H, N = W * H;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    /* ===== PHASE-V: WORLD-TILED uv so the blade sheet lies over the terrain at a
     * fixed real-world scale — the texture never stretches over a hillside and
     * never shrinks on a plain. ===== */
    const uv = new Float32Array(N * 2);
    const uvK = 1 / V.GROUND_TEX_UV;
    for (let v = 0; v < N; v++) {
      FSMap.worldXZ(map, v, xz);
      pos[v * 3] = xz[0]; pos[v * 3 + 1] = map.height[v]; pos[v * 3 + 2] = xz[1];
      uv[v * 2] = xz[0] * uvK; uv[v * 2 + 1] = xz[1] * uvK;
      terrainColor(v, tmpC);
      col[v * 3] = tmpC.r; col[v * 3 + 1] = tmpC.g; col[v * 3 + 2] = tmpC.b;
    }
    // 2 triangles per lattice cell, wound counter-clockwise seen from above
    const idx = new (N > 65000 ? Uint32Array : Uint16Array)((W - 1) * (H - 1) * 6);
    let k = 0;
    for (let v = 0; v < N; v++) {
      const e = FSMap.nbr(map, v, 0), se = FSMap.nbr(map, v, 4), sw = FSMap.nbr(map, v, 5);
      if (e >= 0 && se >= 0) { idx[k++] = v; idx[k++] = se; idx[k++] = e; }
      if (sw >= 0 && se >= 0) { idx[k++] = v; idx[k++] = sw; idx[k++] = se; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, k), 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    posAttr = geo.attributes.position;
    colAttr = geo.attributes.color;
    const m = FSModels.mat(0xffffff, {
      vertexColors: true, map: FSModels.groundTex(),
      emissiveOf: 0x6d8b5c, emissiveK: V.TERR_EMISSIVE_K,
    });
    m.userData.shared = true;              // the blade sheet is cached in FSModels
    terrainMesh = new THREE.Mesh(geo, m);
    terrainMesh.name = "terrain";
    scene.add(terrainMesh);
  }

  /* ===== PHASE-V: the water is TWO layers, not four.
   * The first attempt stacked a full-size ocean plane, a depth-gradient sheet
   * and a shimmer sheet on top of each other — three screen-filling transparent
   * passes, which a software rasteriser pays for three times over. They are now
   * ONE mesh: the map lattice (vertex-coloured from the lake bed, with per-vertex
   * ALPHA so the shallows feather instead of seaming) plus a skirt of quads
   * carrying the same water out past the map edge as open sea. The scrolling
   * caustic shimmer stays its own sheet — two surfaces interfering is the whole
   * reason moving water reads as water. ===== */
  function buildWater() {
    const V = FSC.VIS, T = FSC.TERR;
    const W = map.W, H = map.H, N = W * H;
    const w = W * FSC.TILE, d = H * FSC.TILE * FSC.ROW_Z;
    const SKIRT = Math.max(w, d) * 0.6;
    const pos = [], col = [], uv = [], idx = [];
    const deep = new THREE.Color(V.WATER_DEEP), shallow = new THREE.Color(V.WATER_SHALLOW);
    const c = new THREE.Color();
    const uvK = 1 / 16;
    const wet = new Uint8Array(N);
    for (let v = 0; v < N; v++) {
      FSMap.worldXZ(map, v, xz);
      pos.push(xz[0], FSC.WATER_Y, xz[1]);
      uv.push(xz[0] * uvK, xz[1] * uvK);
      if (map.terr[v] === T.WATER) wet[v] = 1;
      /* Depth ALONE is a poor cue — a bay can be metres deep two steps off the
       * beach. Blending in the distance-to-land field is what actually draws
       * the turquoise rim a player reads as "shallow here". */
      const dep = Math.max(0, Math.min(1, -map.height[v] / 2.6));
      const off = Math.max(0, Math.min(1, ((waterDist ? waterDist[v] : 9) - 1) / 2.6));
      const k = Math.max(dep, off);
      c.copy(shallow).lerp(deep, k * k * 0.72 + k * 0.28);
      col.push(c.r, c.g, c.b, 0.58 + k * 0.32);
    }
    for (let v = 0; v < N; v++) {
      const e = FSMap.nbr(map, v, 0), se = FSMap.nbr(map, v, 4), sw = FSMap.nbr(map, v, 5);
      if (e >= 0 && se >= 0 && (wet[v] || wet[e] || wet[se])) idx.push(v, se, e);
      if (sw >= 0 && se >= 0 && (wet[v] || wet[sw] || wet[se])) idx.push(v, sw, se);
    }
    /* …and the open sea beyond the island. The skirt is stitched to the
     * lattice's OWN PERIMETER, not to a straight bounding box: the hex lattice
     * boundary is a staircase (odd rows are offset half a tile), so a box-edged
     * skirt leaves a visible zig-zag seam right where the eye follows the
     * horizon. Every perimeter vertex is pushed radially out to the horizon and
     * the ring between is filled. */
    c.copy(deep);
    const rim = [];
    for (let cc = 0; cc < W; cc++) rim.push(cc);
    for (let r = 1; r < H; r++) rim.push(r * W + (W - 1));
    for (let cc = W - 2; cc >= 0; cc--) rim.push((H - 1) * W + cc);
    for (let r = H - 2; r >= 1; r--) rim.push(r * W);
    const midX = w / 2, midZ = d / 2;
    const base = pos.length / 3;
    for (let i = 0; i < rim.length; i++) {
      FSMap.worldXZ(map, rim[i], xz);
      const dx = xz[0] - midX, dz = xz[1] - midZ;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const ox = xz[0] + (dx / len) * SKIRT, oz = xz[1] + (dz / len) * SKIRT;
      pos.push(ox, FSC.WATER_Y, oz);
      uv.push(ox * uvK, oz * uvK);
      col.push(c.r, c.g, c.b, 0.90);
    }
    for (let i = 0; i < rim.length; i++) {
      const j = (i + 1) % rim.length;
      idx.push(rim[i], base + i, base + j);
      idx.push(rim[i], base + j, rim[j]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(col), 4));
    geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    /* DoubleSide on purpose: the lattice cells and the skirt ring are wound from
     * two different walks, and a horizontal sheet only ever presents one face to
     * the camera anyway — so this costs nothing and removes a whole class of
     * "half the ocean is invisible" bugs. (It cost one screenshot to find.) */
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      map: FSModels.waterTex(), side: THREE.DoubleSide,
    });
    waterMesh = new THREE.Mesh(geo, m);
    waterMesh.renderOrder = 2;
    waterMesh.name = "water";
    scene.add(waterMesh);

    /* the caustic sheet is a second screen-filling blended pass: worth every
     * cycle on a GPU, the first thing to go on a software rasteriser */
    if (quality < 0.6) return;
    const sw2 = Math.max(w, d) * 1.25;
    const sgeo = new THREE.PlaneGeometry(sw2, sw2, 1, 1);
    sgeo.rotateX(-Math.PI / 2);
    const sm = new THREE.MeshBasicMaterial({
      color: 0xdff2ff, map: FSModels.shimmerTex(), transparent: true,
      opacity: V.SHIMMER_OP, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    });
    shimmerMesh = new THREE.Mesh(sgeo, sm);
    shimmerMesh.position.set(w / 2, FSC.WATER_Y + 0.035, d / 2);
    shimmerMesh.renderOrder = 3;
    shimmerMesh.name = "watershimmer";
    scene.add(shimmerMesh);
  }


  /* ===================================================================== */
  /* ===== PHASE-V: shoreline foam + sun glints (static scatter, animated
   * per frame through a rotating window so the CPU cost is flat) ========= */
  /* ===================================================================== */
  function buildWaterFX() {
    const V = FSC.VIS, T = FSC.TERR;
    const N = map.W * map.H;
    // foam sits on every water vertex that touches land
    const shore = [];
    const cap = Math.ceil(V.FOAM_MAX * (quality < 0.6 ? 0.5 : 1));
    for (let v = 0; v < N && shore.length < cap; v++) {
      if (map.terr[v] !== T.WATER) continue;
      if (quality < 0.6 && (v & 1)) continue;
      let land = 0;
      for (let d = 0; d < 6; d++) { const u = FSMap.nbr(map, v, d); if (u >= 0 && map.terr[u] !== T.WATER) land++; }
      if (land) shore.push([v, land]);
    }
    if (shore.length) {
      const mesh = new THREE.InstancedMesh(FSModels.foamGeo(), FSModels.foamMat(), shore.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      mesh.name = "foam";
      mesh.setColorAt(0, WHITE);
      for (let i = 0; i < shore.length; i++) {
        const sv = shore[i][0];
        FSMap.worldXZ(map, sv, xz);
        // slide the surf toward whichever side the land is on, so it hugs the
        // beach instead of floating as a puff in the middle of the bay
        let lx = 0, lz = 0, ln = 0;
        for (let d = 0; d < 6; d++) {
          const u = FSMap.nbr(map, sv, d);
          if (u < 0 || map.terr[u] === FSC.TERR.WATER) continue;
          const p2 = [0, 0]; FSMap.worldXZ(map, u, p2);
          lx += p2[0] - xz[0]; lz += p2[1] - xz[1]; ln++;
        }
        if (ln) { lx /= ln; lz /= ln; }
        const s = (1.45 + shore[i][1] * 0.18 + hash01(sv, 21) * 0.42) * FSC.VIS.FOAM_S;
        xz[0] += lx * 0.32; xz[1] += lz * 0.32;
        tmpV.set(xz[0], FSC.WATER_Y + 0.055, xz[1]);
        tmpE.set(0, Math.atan2(lx, lz), 0); tmpQ.setFromEuler(tmpE);
        tmpS.set(s * 1.4, 1, s * 0.72);
        mesh.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS));
        mesh.setColorAt(i, tmpC.setScalar(1));
      }
      mesh.count = shore.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      foamMesh = mesh;
      foamV = shore;
      scene.add(mesh);
    }
    // glints scatter over open water, brightest where it is deepest
    if (quality < 0.6) return;
    const open = [];
    for (let v = 0; v < N; v++) {
      if (map.terr[v] !== T.WATER) continue;
      if (hash01(v, 33) > 0.10) continue;
      open.push(v);
      if (open.length >= V.SPARK_MAX) break;
    }
    if (open.length) {
      const mesh = new THREE.InstancedMesh(FSModels.sparkGeo(), FSModels.sparkMat(), open.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      mesh.name = "sparkle";
      mesh.setColorAt(0, WHITE);
      mesh.count = open.length;
      sparkMesh = mesh;
      sparkV = open;
      scene.add(mesh);
    }
  }

  function animWaterFX(dt) {
    const V = FSC.VIS;
    if (foamMesh && foamMesh.instanceColor) {
      // the surf breathes: a travelling wave of brightness along the shore
      const n = foamMesh.count;
      const step = Math.max(1, Math.ceil(n / 6));
      for (let k = 0; k < step; k++) {
        const i = (foamPhase + k) % n;
        const v = foamV[i][0];
        const b = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(tAccum * V.FOAM_HZ * 6.283 + hash01(v, 13) * 6.283));
        foamMesh.setColorAt(i, tmpC.setScalar(b));
      }
      foamPhase = (foamPhase + step) % n;
      foamMesh.instanceColor.needsUpdate = true;
    }
    if (sparkMesh) {
      // every glint winks in and out on its own clock
      const n = sparkMesh.count;
      for (let i = 0; i < n; i++) {
        const v = sparkV[i];
        const ph = hash01(v, 41) * 6.283;
        const tw = Math.sin(tAccum * V.SPARK_HZ + ph);
        const on = Math.max(0, tw);
        FSMap.worldXZ(map, v, xz);
        const s = 0.35 + on * 1.25;
        tmpV.set(xz[0] + (hash01(v, 51) - 0.5) * 1.4, FSC.WATER_Y + 0.09, xz[1] + (hash01(v, 61) - 0.5) * 1.4);
        tmpQ.identity();
        tmpS.set(s, 1, s);
        sparkMesh.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS));
        sparkMesh.setColorAt(i, tmpC.setScalar(on * on * 0.95));
      }
      sparkMesh.instanceMatrix.needsUpdate = true;
      if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;
    }
  }

  // -------------------------------------------------------------- object layer
  function makePool(key, cap) {
    const def = FSModels.objectKinds()[key];
    const mesh = new THREE.InstancedMesh(def.geo, def.mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = "obj:" + key;
    for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, ZERO);
    mesh.setColorAt(0, tmpC.setScalar(1));
    mesh.count = 0;
    objGroup.add(mesh);
    return (pools[key] = { key, mesh, cap, top: 0, free: [] });
  }

  function growPool(p, cap) {
    const old = p.mesh;
    const def = FSModels.objectKinds()[p.key];
    const mesh = new THREE.InstancedMesh(def.geo, def.mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = old.name;
    for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, ZERO);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, Math.min(old.count, cap) * 16));
    if (old.instanceColor) {
      mesh.setColorAt(0, tmpC.setScalar(1));
      mesh.instanceColor.array.set(old.instanceColor.array.subarray(0, Math.min(old.count, cap) * 3));
    }
    mesh.count = old.count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    objGroup.remove(old);
    old.dispose();
    objGroup.add(mesh);
    p.mesh = mesh; p.cap = cap;
    return p;
  }

  function allocSlot(key) {
    let p = pools[key] || makePool(key, 16);
    if (p.free.length) return { p, idx: p.free.pop() };
    if (p.top >= p.cap) growPool(p, Math.ceil(p.cap * 1.6) + 16);
    const idx = p.top++;
    p.mesh.count = p.top;
    return { p, idx };
  }

  /* ===== PHASE P: an object that CHANGES on a live map (a felled tree turning
   * into a stump, a field ripening a stage, a cleared footprint) used to be
   * swapped in at full size on one frame — a visible pop right where the
   * player is looking. objPop holds the handful of vertices that changed in
   * the last quarter second and eases their scale in; everything the map
   * builds at BOOT still lands at full size with no animation and no cost. */
  const objPop = new Map();            // vertex -> { t, key, idx }
  const OBJ_POP_T = 0.26;
  let objPopArmed = false;             // off until the first frame is drawn

  function objMatrix(v, key, out, grow) {
    FSMap.worldXZ(map, v, xz);
    let s = key.indexOf("field") === 0 ? 1 : 0.86 + hash01(v, 3) * 0.3;
    if (grow !== undefined) s *= grow;
    tmpV.set(xz[0], map.height[v], xz[1]);
    tmpE.set(0, hash01(v, 11) * Math.PI * 2, 0);
    tmpQ.setFromEuler(tmpE);
    tmpS.set(s, s, s);
    return out.compose(tmpV, tmpQ, tmpS);
  }

  /* ===== PHASE P: …and the object that LEAVES gets a send-off too. The slot
   * it occupied is simply leased for OBJ_FADE_T before being handed back to
   * the pool's free list, which is long enough for a felled tree to topple
   * (rotate about its own base) and sink away — the "timber" beat the sim's
   * treeFelled event has always had, but the view never showed. ===== */
  const objFade = [];                  // { key, idx, x, y, z, s, yaw, t, fall }
  const OBJ_FADE_T = 0.34;

  function advanceObjPop(dt) {
    if (objPop.size) objPop.forEach((e, v) => {
      e.t += dt;
      const u = Math.min(1, e.t / OBJ_POP_T);
      const p = pools[e.key];
      if (!p) { objPop.delete(v); return; }
      // a soft overshoot: 0 → 1.06 → 1, so a stump "settles" into the ground
      const g = u >= 1 ? 1 : (u < 0.75 ? (u / 0.75) * 1.06 : 1.06 - ((u - 0.75) / 0.25) * 0.06);
      p.mesh.setMatrixAt(e.idx, objMatrix(v, e.key, tmpM, g));
      p.mesh.instanceMatrix.needsUpdate = true;
      if (u >= 1) objPop.delete(v);
    });
    for (let i = objFade.length - 1; i >= 0; i--) {
      const e = objFade[i];
      const p = pools[e.key];
      if (!p) { objFade.splice(i, 1); continue; }
      e.t += dt;
      const u = Math.min(1, e.t / OBJ_FADE_T);
      if (u >= 1) {
        p.mesh.setMatrixAt(e.idx, ZERO);
        p.mesh.instanceMatrix.needsUpdate = true;
        p.free.push(e.idx);
        objFade.splice(i, 1);
        continue;
      }
      // trees TOPPLE (accelerating, about the trunk base); everything else
      // just shrinks quietly away
      const s = e.s * (e.fall ? 1 : (1 - u * u));
      const tip = e.fall ? u * u * 1.5 : 0;
      tmpV.set(e.x, e.y, e.z);
      // every tree falls its own way (the direction is baked from its vertex)
      tmpE.set(tip * Math.cos(e.dir), e.yaw, tip * Math.sin(e.dir));
      tmpQ.setFromEuler(tmpE);
      tmpS.set(s, s * (e.fall ? Math.max(0.15, 1 - u * u * 0.85) : 1), s);
      p.mesh.setMatrixAt(e.idx, tmpM.compose(tmpV, tmpQ, tmpS));
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function setSlot(v, key, p, idx) {
    p.mesh.setMatrixAt(idx, objMatrix(v, key, tmpM));
    p.mesh.setColorAt(idx, FSModels.tintFor(key, v, tmpC));
    p.mesh.instanceMatrix.needsUpdate = true;
    if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
  }

  function buildObjects() {
    objGroup = new THREE.Group();
    objGroup.name = "objects";
    scene.add(objGroup);
    const N = map.W * map.H;
    // pre-count so every pool is allocated once, at the right size
    const counts = {};
    for (let v = 0; v < N; v++) {
      const key = FSModels.kindForObj(map.obj[v], FSMap.species(v), v);
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
    for (const key in counts) makePool(key, counts[key] + 16 + Math.ceil(counts[key] * 0.25));
    for (let v = 0; v < N; v++) {
      const key = FSModels.kindForObj(map.obj[v], FSMap.species(v), v);
      if (!key) continue;
      const a = allocSlot(key);
      vertSlot.set(v, { key, idx: a.idx });
      setSlot(v, key, a.p, a.idx);
    }
  }

  /* ===================================================================== */
  /* ===== PHASE-V: the meadow layer — grass tufts, wildflowers and the ===
   * soft contact shadows every grounded thing drops. Vertex-slotted exactly
   * like the object layer, so refreshVertex tears a clump out the moment a
   * road, a field or a house claims that ground. ========================= */
  /* ===================================================================== */
  const DECOR_STRIDE = 7;           // x, y, z, scale, yaw, phase, spare
  const SUN_DX = 0.55 / 1.24, SUN_DZ = 0.35 / 1.24;   // the key light's XZ heading

  function decorPool(key, geo, material, cap, renderOrder) {
    let p = decor[key];
    if (p) return p;
    const mesh = new THREE.InstancedMesh(geo, material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = "decor:" + key;
    mesh.renderOrder = renderOrder || 0;
    for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, ZERO);
    mesh.setColorAt(0, tmpC.setScalar(1));
    mesh.count = 0;
    decorGroup.add(mesh);
    /* lo/hi are the DIRTY SPAN of instances touched since the last upload. The
     * first version just flagged "full" and re-uploaded the whole matrix buffer
     * — and because the world sweep dirties a vertex almost every frame, that
     * turned into a few hundred KB of instance data per frame, for one tuft. */
    p = { key, mesh, cap, top: 0, free: [], anchor: new Float32Array(cap * DECOR_STRIDE),
      lo: 0, hi: cap - 1, clo: 0, chi: cap - 1, sway: 0, swayAt: 0 };
    decor[key] = p;
    return p;
  }
  function decorAlloc(p) {
    if (p.free.length) return p.free.pop();
    if (p.top >= p.cap) return -1;                 // pools are pre-sized; never grow mid-frame
    const i = p.top++;
    p.mesh.count = p.top;
    return i;
  }
  function decorTouch(p, i) { if (i < p.lo) p.lo = i; if (i > p.hi) p.hi = i; }
  function decorTouchC(p, i) { if (i < p.clo) p.clo = i; if (i > p.chi) p.chi = i; }
  function decorSet(p, i, x, y, z, s, yaw, phase, color) {
    const a = p.anchor, o = i * DECOR_STRIDE;
    a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = s; a[o + 4] = yaw; a[o + 5] = phase;
    tmpV.set(x, y, z);
    tmpE.set(0, yaw, 0); tmpQ.setFromEuler(tmpE);
    tmpS.set(s, s, s);
    p.mesh.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS));
    decorTouch(p, i);
    if (color !== undefined) { p.mesh.setColorAt(i, color); decorTouchC(p, i); }
  }
  function decorClear(p, i) {
    p.mesh.setMatrixAt(i, ZERO);
    p.anchor[i * DECOR_STRIDE + 3] = 0;
    p.free.push(i);
    decorTouch(p, i);
  }
  /** true when a vertex is free ground: no object, no road, no flag, no house */
  function decorFree(v) {
    if (map.obj[v] !== FSC.OBJ.NONE) return false;
    if (map.flagAt[v] || map.bldAt[v]) return false;
    // GOTCHA: FSMap.edgeUsed takes two VERTICES, not a vertex and a direction —
    // passing a direction silently resolves to "not adjacent" and the check
    // quietly never fires. edgeCount is the honest question here anyway.
    if (FSMap.edgeCount(map, v) > 0) return false;
    for (let d = 0; d < 6; d++) {
      // a LARGE building spills past its own vertex, so its neighbours stay bare
      const u = FSMap.nbr(map, v, d);
      if (u >= 0 && map.bldAt[u] && G && G.buildings) {
        const b = G.buildings[map.bldAt[u]];
        if (b && FSC.BLD[b.type] && (FSC.BLD[b.type].size || 0) >= 2) return false;
      }
    }
    return true;
  }
  /** how much grass this terrain grows (0 = none) */
  function tuftDensity(t) {
    const T = FSC.TERR;
    if (t === T.GRASS) return 1;
    if (t === T.SWAMP) return 0.8;
    if (t === T.DESERT) return 0.25;
    return 0;
  }
  function tuftTint(v, t, out) {
    const V = FSC.VIS, T = FSC.TERR;
    if (t === T.DESERT) out.set(V.DESERT_TUFT);
    else if (t === T.SWAMP) out.set(V.SWAMP_TUFT);
    else out.set(V.TUFT_GREEN[(hash01(v, 71) * V.TUFT_GREEN.length) | 0]);
    return out.multiplyScalar(0.82 + hash01(v, 83) * 0.36);
  }
  /** the object standing on this vertex, and how wide a shadow it casts (0 = none) */
  function shadowRadiusFor(v) {
    const o = map.obj[v], O = FSC.OBJ;
    if (o >= O.TREE1 && o <= O.TREE4) return [0.60, 0.86, 1.22, 1.66][o - O.TREE1];
    if (o === O.STUMP) return 0.60;
    if (o >= O.STONE1 && o <= O.STONE4) return 0.62 + (o - O.STONE1) * 0.16;
    if (o === O.SAPLING) return 0.38;
    return 0;
  }

  /** (re)build every decor instance owned by one vertex */
  function refreshDecor(v) {
    if (!decorGroup) return;
    const V = FSC.VIS;
    const old = decorSlot.get(v);
    if (old) {
      for (let i = 0; i < old.length; i++) decorClear(decor[old[i].key], old[i].idx);
      decorSlot.delete(v);
    }
    const list = [];
    const t = map.terr[v];
    // 1. the shadow under whatever object stands here
    const sr = shadowRadiusFor(v);
    if (sr > 0) {
      const p = decor.shadow;
      if (p) {
        const i = decorAlloc(p);
        if (i >= 0) {
          FSMap.worldXZ(map, v, xz);
          const s = sr * (0.86 + hash01(v, 3) * 0.3);
          /* the sun sits at (0.55, 1, 0.35): a shadow centred UNDER a tree is
           * hidden by the tree itself at this camera pitch, so it is thrown a
           * little down-sun where the player can actually see it. */
          const ox = -SUN_DX * s * V.SHADOW_OFF, oz = -SUN_DZ * s * V.SHADOW_OFF;
          const o = i * DECOR_STRIDE;
          p.anchor[o] = xz[0] + ox; p.anchor[o + 1] = map.height[v] + 0.03; p.anchor[o + 2] = xz[1] + oz;
          p.anchor[o + 3] = s; p.anchor[o + 4] = 0; p.anchor[o + 5] = 0;
          tmpV.set(xz[0] + ox, map.height[v] + 0.03, xz[1] + oz);
          tmpE.set(0, hash01(v, 11) * 6.283, 0); tmpQ.setFromEuler(tmpE);
          tmpS.set(s * 2.3, 1, s * 2.0);
          p.mesh.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS));
          decorTouch(p, i);
          list.push({ key: "shadow", idx: i });
        }
      }
    }
    // 2. scree — bare mountain is otherwise one smooth grey mass at any zoom
    if ((t === FSC.TERR.MOUNTAIN || t === FSC.TERR.SNOW) && decorFree(v) && hash01(v, 131) < V.SCREE_FRAC) {
      const p = decor.scree;
      if (p) {
        const i = decorAlloc(p);
        if (i >= 0) {
          FSMap.worldXZ(map, v, xz);
          const d = (hash01(v, 137) * 6) | 0;
          const u = FSMap.nbr(map, v, d);
          const f = 0.18 + hash01(v, 139) * 0.5;
          let x = xz[0], y = map.height[v], z = xz[1];
          if (u >= 0) { const q = [0, 0]; FSMap.worldXZ(map, u, q); x += (q[0] - x) * f; z += (q[1] - z) * f; y += (map.height[u] - y) * f; }
          const sc = 0.42 + hash01(v, 149) * 0.66;
          decorSet(p, i, x, y - 0.05, z, sc, hash01(v, 151) * 6.283, 0,
            tmpC.set(t === FSC.TERR.SNOW ? 0xd8dee6 : COL.STONE).multiplyScalar(0.72 + hash01(v, 157) * 0.5));
          list.push({ key: "scree", idx: i });
        }
      }
    }
    // 3. tufts, only on open ground the settlement has not claimed. PHASE-F:
    // default OFF (FSC.VIS.TUFT_PER_VERTEX===0) — this whole branch, and the
    // pools it would draw from, simply do not exist (see buildDecor), so a
    // disabled meadow costs nothing here beyond the one comparison below.
    const dens = tuftDensity(t);
    if (V.TUFT_PER_VERTEX > 0 && dens > 0 && decorFree(v) && hash01(v, 97) < dens * decorRate) {
      const n = V.TUFT_PER_VERTEX;
      for (let j = 0; j < n; j++) {
        const hj = hash01(v, 211 + j * 37);
        // walk a fraction of the way toward one neighbour: exact ground, cheap
        const d = (hash01(v, 307 + j * 53) * 6) | 0;
        const u = FSMap.nbr(map, v, d);
        let f = 0.14 + hash01(v, 401 + j * 61) * 0.52;
        let x, y, z;
        FSMap.worldXZ(map, v, xz);
        const x0 = xz[0], z0 = xz[1], y0 = map.height[v];
        if (u >= 0 && map.terr[u] !== FSC.TERR.WATER) {
          FSMap.worldXZ(map, u, xz);
          x = x0 + (xz[0] - x0) * f; z = z0 + (xz[1] - z0) * f; y = y0 + (map.height[u] - y0) * f;
        } else { x = x0; y = y0; z = z0; }
        const varr = ((hj * V.TUFT_VARIANTS) | 0) % V.TUFT_VARIANTS;
        const p = decor["tuft" + varr];
        if (!p) continue;
        const i = decorAlloc(p);
        if (i < 0) continue;
        const s = (0.78 + hash01(v, 503 + j * 17) * 0.62) * (t === FSC.TERR.DESERT ? 0.8 : 1);
        decorSet(p, i, x, y - 0.02, z, s, hash01(v, 601 + j * 23) * 6.283,
          hash01(v, 701 + j * 29) * 6.283, tuftTint(v * 7 + j, t, tmpC));
        list.push({ key: p.key, idx: i });
      }
    }
    // 3b. wildflowers — PHASE-F: INDEPENDENT of tufts (they used to be "tucked
    // into a clump"; tufts default off now, so flowers scatter straight onto
    // open grass on their own budget/rate). FLOWER_FRAC===0 disables these too.
    if (t === FSC.TERR.GRASS && V.FLOWER_FRAC > 0 && decorFree(v) && hash01(v, 1619) < V.FLOWER_FRAC * flowerRate) {
      const fp = decor.flower;
      if (fp) {
        const i = decorAlloc(fp);
        if (i >= 0) {
          FSMap.worldXZ(map, v, xz);
          const col = V.FLOWER_COL[(hash01(v, 911) * V.FLOWER_COL.length) | 0];
          decorSet(fp, i, xz[0] + (hash01(v, 1009) - 0.5) * 0.7, map.height[v], xz[1] + (hash01(v, 1103) - 0.5) * 0.7,
            0.8 + hash01(v, 1201) * 0.5, hash01(v, 1301) * 6.283, hash01(v, 1409) * 6.283, tmpC.set(col));
          list.push({ key: "flower", idx: i });
        }
      }
    }
    if (list.length) decorSlot.set(v, list);
  }

  /* ===== PHASE-V: QUALITY. The meadow is alpha-tested geometry, which is free
   * on any real GPU and murderous on a software rasteriser (headless CI, a
   * blocklisted driver, an old laptop): there it is the single most expensive
   * thing on screen. So the renderer asks the driver what it is once at boot
   * and thins the meadow when it turns out to be SwiftShader / llvmpipe /
   * Mesa software. FSRender.setQuality(q) overrides it (the art rig forces 1). */
  function detectQuality() {
    if (!FSC.VIS.QUALITY_SOFT) return 1;
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const name = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || "");
      if (/swiftshader|llvmpipe|software|softpipe/i.test(name)) return FSC.VIS.QUALITY_SOFT;
    } catch (e) { /* a driver that will not say is assumed to be real hardware */ }
    return 1;
  }
  FSRender.setQuality = function (q) {
    const was = quality;
    quality = Math.max(0.05, Math.min(1, q === undefined ? 1 : q));
    if (!scene || quality === was) return quality;
    if (decorGroup) { disposeDecor(); buildDecor(); claimed.clear(); claimSig = ""; }
    // the water layers are quality-gated too (the caustic sheet and the glints
    // are the other two screen-filling passes), so they rebuild with it
    if (waterMesh) { scene.remove(waterMesh); waterMesh.geometry.dispose(); waterMesh.material.dispose(); waterMesh = null; }
    if (shimmerMesh) { scene.remove(shimmerMesh); shimmerMesh.geometry.dispose(); shimmerMesh.material.dispose(); shimmerMesh = null; }
    if (foamMesh) { scene.remove(foamMesh); foamMesh.dispose(); foamMesh = null; foamV = null; }
    if (sparkMesh) { scene.remove(sparkMesh); sparkMesh.dispose(); sparkMesh = null; sparkV = null; }
    if (skyMesh && quality < 0.6) { scene.remove(skyMesh); skyMesh.geometry.dispose(); skyMesh.material.dispose(); skyMesh = null; }
    else if (!skyMesh && quality >= 0.6) {
      skyMesh = FSModels.skyDome(Math.max(700, (map.W + map.H) * FSC.TILE * 1.6));
      scene.add(skyMesh);
    }
    buildWater();
    buildWaterFX();
    return quality;
  };
  FSRender.quality = function () { return quality; };

  function buildDecor() {
    const V = FSC.VIS;
    decorGroup = new THREE.Group();
    decorGroup.name = "decor";
    scene.add(decorGroup);
    const N = map.W * map.H;
    // pre-count so every pool is allocated exactly once, at the right size
    let grassy = 0, shadows = 0, rocky = 0;
    for (let v = 0; v < N; v++) {
      const dens = tuftDensity(map.terr[v]);
      if (dens > 0) grassy += dens;
      if (map.terr[v] === FSC.TERR.MOUNTAIN || map.terr[v] === FSC.TERR.SNOW) rocky++;
      if (shadowRadiusFor(v) > 0) shadows++;
    }
    const cap = V.TUFT_MAX * quality;
    const wanted = grassy * V.TUFT_PER_VERTEX;
    decorRate = (wanted > cap ? cap / wanted : 1) * quality;
    /* ===== PHASE-F: tufts default OFF (TUFT_PER_VERTEX===0) — skip pool
     * creation ENTIRELY so a disabled meadow allocates nothing (no geometry,
     * no InstancedMesh, no per-frame breeze entry — animDecor's `for (const k
     * in decor)` simply never sees a "tuft*" key to sway). Re-enabling the
     * constant brings this whole path back untouched. ===== */
    if (V.TUFT_PER_VERTEX > 0) {
      const perVariant = Math.ceil((Math.min(wanted * quality, cap) / V.TUFT_VARIANTS) * 1.4) + 32;
      for (let i = 0; i < V.TUFT_VARIANTS; i++) {
        decorPool("tuft" + i, FSModels.tuftGeo(i, quality < 0.4 ? 1 : 3), FSModels.tuftMat(), perVariant, 1);
        decor["tuft" + i].sway = 1;
      }
    }
    /* ===== PHASE-F: flowers are their own independent layer now (see
     * refreshDecor 3b) — one roll per grassy vertex, not per-tuft — so they
     * get their own big-map thinning rate + pool budget, and are skipped
     * entirely (no pool at all) when FLOWER_FRAC is 0. ===== */
    const flowerCap = (V.FLOWER_MAX || 4000) * quality;
    const flowerWanted = grassy;
    flowerRate = (flowerWanted > flowerCap ? flowerCap / flowerWanted : 1) * quality;
    if (V.FLOWER_FRAC > 0) {
      decorPool("flower", FSModels.flowerGeo(), FSModels.vcMat("flower", 0xd8c46a, 0.5),
        Math.ceil(Math.min(flowerWanted * quality, flowerCap) * V.FLOWER_FRAC * 1.6) + 32, 1);
      decor.flower.sway = 1;
    }
    /* the soft contact shadows are a broad alpha-blended pass — worth it for
     * grounding, but the first thing after the meadow to go on a rasteriser */
    if (quality >= 0.4) decorPool("shadow", FSModels.shadowGeo(), FSModels.shadowMat(), Math.min(V.SHADOW_MAX, shadows + 64), 1);
    if (quality >= 0.6) decorPool("scree", FSModels.screeGeo(), FSModels.vcMat("scree", COL.STONE, 0.34), Math.ceil(rocky * V.SCREE_FRAC * 1.4) + 32, 0);
    for (let v = 0; v < N; v++) refreshDecor(v);
  }

  /**
   * The breeze. Every frame a contiguous WINDOW of tuft matrices is recomposed
   * with a fresh lean, and only that window is uploaded (BufferAttribute
   * updateRange) — so the whole meadow ripples over a couple of seconds at a
   * cost that does not grow with the size of the map.
   */
  function animDecor(dt) {
    const V = FSC.VIS;
    /* ===== PHASE-V: zoomed all the way out a tuft is smaller than a pixel and
     * only costs shimmer + fill, so the meadow layer switches itself off. ===== */
    const far = cam.dist;
    for (const k in decor) {
      const p = decor[k];
      if (k.indexOf("tuft") === 0) p.mesh.visible = far < V.TUFT_FADE_DIST;
      else if (k === "flower") p.mesh.visible = far < V.FLOWER_FADE_DIST;
      if (!p.mesh.visible) continue;
      const attr = p.mesh.instanceMatrix;
      const n = p.top;
      if (p.sway && n) {
        const a0 = Math.min(p.swayAt || 0, n);
        const a1 = Math.min(a0 + V.TUFT_WINDOW, n);
        const wob = tAccum * V.TUFT_SWAY_HZ * 6.283;
        for (let i = a0; i < a1; i++) {
          const o = i * DECOR_STRIDE, s = p.anchor[o + 3];
          if (s <= 0) continue;
          const lean = Math.sin(wob + p.anchor[o + 5]) * V.TUFT_SWAY;
          tmpV.set(p.anchor[o], p.anchor[o + 1], p.anchor[o + 2]);
          tmpE.set(lean * 0.75, p.anchor[o + 4], lean);
          tmpQ.setFromEuler(tmpE);
          tmpS.set(s, s, s);
          p.mesh.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS));
        }
        decorTouch(p, a0);
        if (a1 > a0) decorTouch(p, a1 - 1);
        p.swayAt = a1 >= n ? 0 : a1;
      }
      // ONE contiguous upload covering everything touched this frame
      if (p.lo <= p.hi) {
        attr.updateRange.offset = p.lo * 16;
        attr.updateRange.count = (p.hi - p.lo + 1) * 16;
        attr.needsUpdate = true;
        p.lo = p.cap; p.hi = -1;
      }
      if (p.mesh.instanceColor && p.clo <= p.chi) {
        p.mesh.instanceColor.updateRange.offset = p.clo * 3;
        p.mesh.instanceColor.updateRange.count = (p.chi - p.clo + 1) * 3;
        p.mesh.instanceColor.needsUpdate = true;
        p.clo = p.cap; p.chi = -1;
      }
    }
  }

  function disposeDecor() {
    if (!decorGroup) return;
    for (const k in decor) { decorGroup.remove(decor[k].mesh); decor[k].mesh.dispose(); delete decor[k]; }
    if (scene) scene.remove(decorGroup);
    decorGroup = null;
    decorSlot.clear();
  }
  FSRender.decorInfo = function () {
    const out = {};
    for (const k in decor) out[k] = { cap: decor[k].cap, top: decor[k].top, live: decor[k].top - decor[k].free.length };
    return out;
  };

  /** Re-sync ONE vertex (object + terrain height/colour) — the Phase B/C hook. */
  FSRender.refreshVertex = function (v) {
    if (!scene || v < 0 || v >= map.W * map.H) return false;
    /* ===== PHASE-C: geologist signs live on their own little layer ===== */
    if (map.sign[v]) signVerts.set(v, map.sign[v]); else signVerts.delete(v);
    // terrain
    posAttr.setY(v, map.height[v]);
    terrainColor(v, tmpC);
    colAttr.setXYZ(v, tmpC.r, tmpC.g, tmpC.b);
    dirtyPos = true; dirtyCol = true;
    // object
    const key = FSModels.kindForObj(map.obj[v], FSMap.species(v), v);
    const cur = vertSlot.get(v);
    if (cur && cur.key === key) { setSlot(v, key, pools[key], cur.idx); return true; }
    if (cur) {
      const p = pools[cur.key];
      objPop.delete(v);
      /* ===== PHASE P: lease the slot for a moment so it can topple/shrink
       * out instead of blinking away (boot-time rebuilds skip it). ===== */
      if (objPopArmed && objFade.length < 24) {
        FSMap.worldXZ(map, v, xz);
        objFade.push({ key: cur.key, idx: cur.idx, x: xz[0], y: map.height[v], z: xz[1],
          s: cur.key.indexOf("field") === 0 ? 1 : 0.86 + hash01(v, 3) * 0.3,
          yaw: hash01(v, 11) * Math.PI * 2, dir: hash01(v, 23) * Math.PI * 2,
          t: 0, fall: cur.key.indexOf("tree") === 0 });
      } else {
        p.mesh.setMatrixAt(cur.idx, ZERO);
        p.mesh.instanceMatrix.needsUpdate = true;
        p.free.push(cur.idx);
      }
      vertSlot.delete(v);
    }
    if (key) {
      const a = allocSlot(key);
      vertSlot.set(v, { key, idx: a.idx });
      setSlot(v, key, a.p, a.idx);
      /* ===== PHASE P: ease it in instead of popping it in ===== */
      if (objPopArmed) {
        objPop.set(v, { t: 0, key: key, idx: a.idx });
        a.p.mesh.setMatrixAt(a.idx, objMatrix(v, key, tmpM, 0.001));
        a.p.mesh.instanceMatrix.needsUpdate = true;
      }
    } else {
      objPop.delete(v);
    }
    /* ===== PHASE-V: the grass goes with it — a felled tree loses its shadow,
     * a ploughed field loses its tufts, a cleared vertex grows them back. ===== */
    refreshDecor(v);
    return true;
  };

  FSRender.refreshArea = function (v, r) {
    FSMap.forRadius(map, v, r === undefined ? 1 : r, (u) => FSRender.refreshVertex(u));
    /* ===== PHASE-E: keep the build-suitability overlay in step (cheap: only
     * runs at all while the overlay is switched on) ===== */
    if (suitOn) suitDirty = true;
  };

  // ----------------------------------------------------------------- buildings
  /** 0..1 progress through the hammering phase (drives the rising-wall visual).
   *  PHASE-C: b.progress is the builder's 16-bit swing accumulator. */
  function buildFrac(b) {
    if (b.state === "done") return 1;
    return Math.min(1, (b.progress || 0) / FSC.BUILD_FULL);
  }
  /** Rebuild a building's mesh only when its visible stage actually changed. */
  function bldVisKey(b) {
    if (b.state === "build") return "build" + Math.min(3, Math.floor(buildFrac(b) * 4));
    return b.state || "done";
  }

  function buildingView(b) {
    const g = FSModels.buildingModel(b.type, b.state, b.p, buildFrac(b));
    FSMap.worldXZ(map, b.v, xz);
    g.position.set(xz[0], map.height[b.v], xz[1]);
    g.rotation.y = Math.PI / 6;         // face the SE door flag
    g.name = "bld:" + b.id;
    g.userData.visKey = bldVisKey(b);
    return g;
  }

  /** Sync building meshes with G.buildings (site → scaffold → done → burn). */
  FSRender.refreshBuildings = function () {
    if (!scene) return 0;
    const seen = new Set();
    for (const id in G.buildings) {
      const b = G.buildings[id];
      seen.add(b.id);
      const cur = bldViews.get(b.id);
      if (cur && cur.userData.visKey === bldVisKey(b)) {
        FSMap.worldXZ(map, b.v, xz);
        cur.position.set(xz[0], map.height[b.v], xz[1]);   // leveling moves the ground
        continue;
      }
      if (cur) { bldGroup.remove(cur); disposeTree(cur); }
      const view = buildingView(b);
      bldViews.set(b.id, view);
      bldGroup.add(view);
    }
    bldViews.forEach((view, id) => {
      if (seen.has(id)) return;
      bldGroup.remove(view);
      disposeTree(view);
      bldViews.delete(id);
    });
    return bldViews.size;
  };

  /* ===================================================================== */
  /* ===== PHASE-B: flags, goods, roads, serfs (all instanced) ============ */
  /* ===================================================================== */
  const dyn = {
    group: null, pools: Object.create(null), roadMesh: null,
    roadSig: "", bldSig: "", tAcc: 0, serfVis: new Map(), lastSerfCount: 0,
    /* ===== PHASE P: the sub-tick clock. `tickU` is how far the renderer has
     * travelled through the CURRENT sim tick (0..1). Every animation whose
     * beat has to land on a sim event (chop impact, hammer tap, duel thrust)
     * reads its phase from a sim countdown MINUS tickU, so the beat is smooth
     * between ticks and exact on them. Purely derived from G.tick + dt. */
    lastTick: -1, tickAge: 0, tickU: 0,
  };
  const WHITE = new THREE.Color(1, 1, 1);
  const resC = new THREE.Color();

  function dynPool(key, geo, material) {
    let p = dyn.pools[key];
    if (p) return p;
    const mesh = new THREE.InstancedMesh(geo, material, 32);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = "dyn:" + key;
    mesh.setColorAt(0, WHITE);
    mesh.count = 0;
    dyn.group.add(mesh);
    p = { key, mesh, cap: 32, n: 0, geo, mat: material };
    dyn.pools[key] = p;
    return p;
  }
  function dynGrow(p, cap) {
    const mesh = new THREE.InstancedMesh(p.geo, p.mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = p.mesh.name;
    mesh.setColorAt(0, WHITE);
    mesh.count = 0;
    dyn.group.remove(p.mesh);
    p.mesh.dispose();
    dyn.group.add(mesh);
    p.mesh = mesh; p.cap = cap;
  }
  function dynPush(p, m, color) {
    if (p.n >= p.cap) dynGrow(p, Math.ceil(p.cap * 1.8) + 16);
    p.mesh.setMatrixAt(p.n, m);
    p.mesh.setColorAt(p.n, color || WHITE);
    p.n++;
  }
  function dynFlush() {
    for (const k in dyn.pools) {
      const p = dyn.pools[k];
      p.mesh.count = p.n;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      p.n = 0;
    }
  }

  function initDynamic() {
    dyn.group = new THREE.Group();
    dyn.group.name = "dynamic";
    scene.add(dyn.group);
    dyn.roadSig = ""; dyn.bldSig = "";
    dyn.serfVis.clear();
    dyn.lastTick = -1; dyn.tickAge = 0; dyn.tickU = 0;   /* ===== PHASE P ===== */
    puffs.length = 0; fireSmokeT.clear(); objPop.clear(); objFade.length = 0;
  }

  // ---- roads: one merged ribbon mesh, rebuilt only when the network changes ----
  function roadSignature() {
    let n = 0, sum = 0;
    for (const id in G.roads) { n++; sum += (id | 0) + G.roads[id].path.length * 7; }
    return n + ":" + sum + ":" + G.routeGen;
  }
  /* ===== PHASE-C: water roads ride ON the water, not on the lake bed ===== */
  function roadY(v) {
    return (map.terr[v] === FSC.TERR.WATER ? FSC.WATER_Y + 0.05 : map.height[v]) + FSC.ROAD_LIFT;
  }

  /* ===== PHASE-V: ground the settlement has claimed grows no grass. Roads and
   * flags never go through refreshVertex, so their vertices are diffed here and
   * the meadow layer is torn up (or grown back) only where it actually changed. */
  const claimed = new Set();
  let claimSig = "";
  function syncClaims() {
    if (!decorGroup) return;
    const now = new Set();
    for (const id in G.roads) {
      const r = G.roads[id];
      for (let i = 0; i < r.path.length; i++) {
        const v = r.path[i];
        now.add(v);
        for (let d = 0; d < 6; d++) { const u = FSMap.nbr(map, v, d); if (u >= 0) now.add(u); }
      }
    }
    for (const id in G.flags) now.add(G.flags[id].v);
    for (const id in G.buildings) {
      const b = G.buildings[id];
      now.add(b.v);
      for (let d = 0; d < 6; d++) { const u = FSMap.nbr(map, b.v, d); if (u >= 0) now.add(u); }
    }
    now.forEach((v) => { if (!claimed.has(v)) refreshDecor(v); });
    claimed.forEach((v) => { if (!now.has(v)) refreshDecor(v); });
    claimed.clear();
    now.forEach((v) => claimed.add(v));
  }

  function roadMat() {
    if (!dyn.roadMat) {
      dyn.roadMat = FSModels.mat(0xffffff, {
        vertexColors: true, map: FSModels.roadTex(), emissiveOf: COL.ROAD, emissiveK: 0.26,
      });
      dyn.roadMat.userData.shared = true;
    }
    return dyn.roadMat;
  }

  function rebuildRoads() {
    if (dyn.roadMesh) { dyn.group.remove(dyn.roadMesh); dyn.roadMesh.geometry.dispose(); dyn.roadMesh = null; }
    const segs = [];
    for (const id in G.roads) {
      const r = G.roads[id];
      for (let i = 0; i + 1 < r.path.length; i++) segs.push([r.path[i], r.path[i + 1], r.water ? 1 : 0]);
    }
    if (!segs.length) return;
    const quads = segs.length + segs.length + 1;      // ribbons + a patch per vertex
    const pos = new Float32Array(quads * 6 * 3);
    const col = new Float32Array(quads * 6 * 3);
    /* ===== PHASE-V: the ribbon carries its own trodden-earth sheet, tiled by
     * REAL LENGTH so a long haul road shows ruts running down it and a junction
     * patch does not smear one stretched copy across itself. ===== */
    const uvs = new Float32Array(quads * 6 * 2);
    const base = new THREE.Color(COL.ROAD), edge = new THREE.Color(COL.ROAD_EDGE);
    let o = 0;
    const a = [0, 0], b = [0, 0];
    // corners are given clockwise seen from above, so the triangles are wound
    // 0-2-1 / 0-3-2 to make the ribbon face UP (else it is backface-culled away)
    function quad(x0, z0, x1, z1, x2, z2, x3, z3, y0, y1, y2, y3, c, v0, v1) {
      const P = [[x0, y0, z0], [x2, y2, z2], [x1, y1, z1], [x0, y0, z0], [x3, y3, z3], [x2, y2, z2]];
      const U = [[0, v0], [1, v1], [1, v0], [0, v0], [0, v1], [1, v1]];
      for (let i = 0; i < 6; i++) {
        pos[o * 3] = P[i][0]; pos[o * 3 + 1] = P[i][1]; pos[o * 3 + 2] = P[i][2];
        col[o * 3] = c.r; col[o * 3 + 1] = c.g; col[o * 3 + 2] = c.b;
        uvs[o * 2] = U[i][0]; uvs[o * 2 + 1] = U[i][1];
        o++;
      }
    }
    const W = FSC.ROAD_W;
    const plank = new THREE.Color(COL.WATER_ROAD);
    const seen = new Set();
    for (let s = 0; s < segs.length; s++) {
      const va = segs[s][0], vb = segs[s][1], wet = segs[s][2];
      FSMap.worldXZ(map, va, a); FSMap.worldXZ(map, vb, b);
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const px = (-dz / len) * W, pz = (dx / len) * W;
      const ya = roadY(va), yb = roadY(vb);
      const uLen = len / 2.4;
      quad(a[0] + px, a[1] + pz, a[0] - px, a[1] - pz, b[0] - px, b[1] - pz, b[0] + px, b[1] + pz,
        ya, ya, yb, yb, wet ? plank : base, 0, uLen);
      for (let k = 0; k < 2; k++) {
        const v = k ? vb : va;
        if (seen.has(v)) continue;
        seen.add(v);
        const p = k ? b : a, y = roadY(v);
        quad(p[0] - W, p[1] - W, p[0] + W, p[1] - W, p[0] + W, p[1] + W, p[0] - W, p[1] + W, y, y, y, y, edge,
          0, (W * 2) / 2.4);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, o * 3), 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col.subarray(0, o * 3), 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs.subarray(0, o * 2), 2));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    dyn.roadMesh = new THREE.Mesh(geo, roadMat());
    dyn.roadMesh.name = "roads";
    dyn.roadMesh.renderOrder = 1;
    dyn.group.add(dyn.roadMesh);
  }

  // ---- flags + the goods stacked at their feet ----
  function syncFlags() {
    const pole = dynPool("pole", FSModels.flagPoleGeo(), FSModels.vcMat("pole", COL.FLAG_POLE, 0.3));
    const pen = dynPool("pennant", FSModels.pennantGeo(), FSModels.vcMat("pennant", 0x888888, 0.45));
    const crate = dynPool("crate", FSModels.crateGeo(), FSModels.vcMat("crate", 0x808080, 0.34));
    const wave = Math.sin(dyn.tAcc * 2.2) * 0.20 + Math.sin(dyn.tAcc * 5.1 + 1.3) * 0.07;
    for (const id in G.flags) {
      const f = G.flags[id];
      FSMap.worldXZ(map, f.v, xz);
      const y = map.height[f.v];
      tmpV.set(xz[0], y, xz[1]);
      tmpE.set(0, 0, 0); tmpQ.setFromEuler(tmpE); tmpS.set(1, 1, 1);
      dynPush(pole, tmpM.compose(tmpV, tmpQ, tmpS));
      /* ===== PHASE P: the pennant used to only YAW about its pole, which
       * reads as a signboard swinging, not cloth. A rigid instance cannot
       * ripple, but a flag DOES snap: the yaw now rides a sharpened wave
       * (fast flick, slow settle) and carries a small roll + a length
       * flutter with it, which is what sells "wind" at this scale. ===== */
      const ph = dyn.tAcc * 2.2 + f.id * 0.7;
      const snap = Math.sin(ph) * 0.62 + Math.sin(ph * 2.3 + 1.1) * 0.28 + Math.sin(ph * 4.7) * 0.10;
      tmpE.set(0, wave + f.id * 0.7 + snap * 0.16, snap * 0.13); tmpQ.setFromEuler(tmpE);
      tmpS.set(1 + snap * 0.06, 1 - snap * 0.05, 1);
      dynPush(pen, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.set(FSC.PLAYER_COLORS[f.p % FSC.PLAYER_COLORS.length]));
      tmpS.set(1, 1, 1);
      for (let i = 0; i < f.slots.length; i++) {
        const ring = (i / 4) | 0, k = i % 4;
        const ang = k * (Math.PI / 2) + ring * (Math.PI / 4);
        tmpV.set(xz[0] + Math.cos(ang) * 0.46, y + ring * 0.24, xz[1] + Math.sin(ang) * 0.46);
        tmpE.set(0, ang, 0); tmpQ.setFromEuler(tmpE);
        dynPush(crate, tmpM.compose(tmpV, tmpQ, tmpS), resC.set(FSC.RES_COLOR[f.slots[i].res] || 0xcccccc));
      }
    }
    return crate;
  }

  /* ===================================================================== */
  /* ===== PHASE P: people move like people ==============================
   * Three things were wrong and all three are motion-model problems, not
   * art problems:
   *  (1) the old exponential chase (`frac += (target-frac) * dt*16`) turned a
   *      steady 10 Hz sim into a visibly UNEVEN glide — the frame right after
   *      a tick jumped ~2.6x further than the frames between ticks (measured
   *      per-frame delta CV 0.68 on a flat straight road). Replaced by a
   *      CONSTANT-VELOCITY follow at exactly the speed the sim itself is
   *      moving him (edge length / stepN ticks), so every frame advances the
   *      same distance no matter where in the tick it lands.
   *  (2) facing SNAPPED 60° in a single frame at every lattice bend. Now the
   *      yaw turns toward the edge heading at a bounded rate.
   *  (3) the walk cycle ran off the wall clock, so feet skated whenever the
   *      ground speed and the animation disagreed (slopes, 2x/4x, catch-up).
   *      The gait phase is now driven by DISTANCE WALKED — stop moving and
   *      the feet stop, walk uphill slowly and the steps slow with you.
   * All three read sim state and never write it.
   */
  const SERF_TURN_RATE = 7.5;        // rad/s — a serf turns, he never flips
  const SERF_STRIDE = 0.46;          // world units per step (one leg swing)
  const SERF_DEFAULT_TICKS = 26;     // FSC.WALK_TICKS_TABLE's flat entry

  /* ===== PHASE P: a builder/digger stands on his site's OWN vertex, which
   * means the site's frame platform sits on top of him and the player never
   * sees anybody working. Purely visually, step him out to the door side of
   * the footprint — where a workman would stand anyway. Sim untouched; the
   * constant-velocity follow walks him there and back on its own. ===== */
  const WORK_STEP_OUT = 0.85;
  function workStepOut(s, out) {
    out[0] = 0; out[1] = 0;
    if (s.state !== "hammer" && s.state !== "level") return out;
    const b = G.buildings[s.target];
    if (!b || b.v !== s.v) return out;
    const fl = G.flags[b.flag];
    if (!fl) return out;
    FSMap.worldXZ(map, b.v, xz);
    const bxw = xz[0], bzw = xz[1];
    FSMap.worldXZ(map, fl.v, xz);
    const dx = xz[0] - bxw, dz = xz[1] - bzw;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    out[0] = (dx / len) * WORK_STEP_OUT; out[1] = (dz / len) * WORK_STEP_OUT;
    return out;
  }
  const workOff = [0, 0];

  function serfVisual(s, dt) {
    let vis = dyn.serfVis.get(s.id);
    // where the sim says he is, exactly, right now
    FSMap.worldXZ(map, s.from, xz);
    const ax = xz[0], az = xz[1], ay = serfY(s.from);
    FSMap.worldXZ(map, s.to, xz);
    const bx = xz[0], bz = xz[1], by = serfY(s.to);
    const f = s.frac || 0;
    workStepOut(s, workOff);
    const tx = ax + (bx - ax) * f + workOff[0], tz = az + (bz - az) * f + workOff[1], ty = ay + (by - ay) * f;
    const moving = s.from !== s.to;
    const tYaw = moving ? Math.atan2(bx - ax, bz - az)
      : (workOff[0] || workOff[1] ? Math.atan2(-workOff[0], -workOff[1]) : (s.id % 7) * 0.9);
    if (!vis) {
      vis = { x: tx, y: ty, z: tz, yaw: tYaw, phase: (s.id % 13) * 0.48, frac: f, from: s.from, to: s.to, speed: 0 };
      dyn.serfVis.set(s.id, vis);
      return vis;
    }
    vis.frac = f; vis.from = s.from; vis.to = s.to;
    // ---- position: move at the sim's own ground speed, never in jerks
    const px = vis.x, pz = vis.z;
    const dx = tx - vis.x, dy = ty - vis.y, dz = tz - vis.z;
    const lag = Math.sqrt(dx * dx + dz * dz);
    const edge = moving ? Math.sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az)) : FSC.TILE;
    const ticks = Math.max(1, s.stepN || SERF_DEFAULT_TICKS);
    const tickDist = edge / ticks;
    const rate = tickDist * (Math.max(0, G.speed || 0) / FSC.TICK_S);
    if (lag > edge * 1.6 || rate <= 0) {
      // a genuine teleport (spawned, stepped out of a door, world adopted) —
      // sliding one of those across the map would be far worse than a cut
      vis.x = tx; vis.y = ty; vis.z = tz;
    } else if (lag > 1e-7) {
      let step = rate * dt;
      if (lag > tickDist * 2.5) step *= 1.9;          // gentle catch-up after a stall
      const k = Math.min(1, step / lag);
      vis.x += dx * k; vis.y += dy * k; vis.z += dz * k;
    } else {
      vis.y = ty;
    }
    // ---- facing: turn toward the heading, bounded
    let dyaw = tYaw - vis.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const maxTurn = SERF_TURN_RATE * dt;
    vis.yaw += Math.abs(dyaw) <= maxTurn ? dyaw : (dyaw < 0 ? -maxTurn : maxTurn);
    // ---- gait: phase follows the ground, so feet cannot skate
    const walked = Math.sqrt((vis.x - px) * (vis.x - px) + (vis.z - pz) * (vis.z - pz));
    vis.speed = dt > 0 ? walked / dt : 0;
    vis.phase += (walked / SERF_STRIDE) * Math.PI;
    if (vis.phase > 1e6) vis.phase -= 1e6;
    return vis;
  }

  /** a serf standing on a water vertex is in his boat, not on the lake bed */
  function serfY(v) {
    return map.terr[v] === FSC.TERR.WATER ? FSC.WATER_Y + 0.06 : map.height[v];
  }

  /* ===== PHASE P: the swing. A tool stroke is not a sine — it is a slow
   * raise and a fast strike, and the strike has to land ON the tick the sim
   * actually does the work, or the sound and the tree fall arrive off the
   * beat. `rem` is the work countdown in ticks (fractional, via dyn.tickU),
   * so stroke 0 lands exactly when the sim completes the job. Returns
   * 0 (arm down) → 1 (arm fully raised); the strike is the fall back to 0. */
  function swingShape(rem, period) {
    const p = period || 8;
    let w = 1 - ((rem % p) + p) % p / p;              // 0 at stroke start → 1 at impact
    if (!isFinite(w)) w = 0;
    const RAISE = 0.72;
    return w < RAISE ? (w / RAISE) : Math.max(0, 1 - (w - RAISE) / (1 - RAISE));
  }
  /** how far through the current sim tick the renderer is (0..1) — the sub-tick
   *  clock every event-synced animation reads. */
  function serfSwing(s) {
    const st = s.state;
    if (st === "doWork" || st === "geoWork") {
      const rem = Math.max(0, (s.t || 0) - dyn.tickU);
      return swingShape(rem, s.workKind === "fish" ? 14 : 8);
    }
    if (st === "hammer") {
      // the sim's own swing clock is 5-7.7 s per CONSUMED material; a builder
      // taps far more often than that, so the visual stroke runs at the same
      // ~0.7 s cadence fs-audio.js taps at — and, because the phase is taken
      // from b.swingT, the LAST stroke of each cycle lands exactly on the tick
      // the sim banks the material.
      const b = G.buildings[s.target];
      if (!b || !b.crew) return 0;
      const rem = Math.max(0, (b.swingT || 0) - dyn.tickU);
      return swingShape(rem, 7);
    }
    if (st === "level") {
      const rem = Math.max(0, (s.t || 0) - dyn.tickU);
      return swingShape(rem, 9);
    }
    return -1;                                        // not working
  }

  /* ===== PHASE P: pose a pair of legs under an already-composed body matrix.
   * `body` is the body's world matrix; the legs hang from (±hipX, hipY) in the
   * body's own frame and swing about their hip on the X axis, so they inherit
   * the body's yaw/lean/bob for free and can never drift off the torso.
   * `stride` -1..1 drives the walk (legs counter-phase); `brace` 0..1 spreads
   * the stance a little while a tool is being swung. */
  const SERF_HIP_X = 0.075, SERF_HIP_Y = 0.255;
  const KNIGHT_HIP_X = 0.078, KNIGHT_HIP_Y = 0.255;
  const LEG_SWING = 0.52;                  // rad at full stride
  function pushLegs(geo, key, body, stride, brace, hipX, hipY) {
    const pool = dynPool(key, geo, FSModels.vcMat("serf", 0x9a9a9a, 0.34));
    for (let s2 = -1; s2 <= 1; s2 += 2) {
      const a = stride * LEG_SWING * (s2 < 0 ? 1 : -1) + brace * 0.22 * s2;
      tmpV2.set(s2 * hipX, hipY, 0);
      tmpE2.set(a, 0, 0);
      tmpQ2.setFromEuler(tmpE2);
      tmpS2.set(1, 1, 1);
      tmpM2.compose(tmpV2, tmpQ2, tmpS2);
      tmpM3.multiplyMatrices(body, tmpM2);
      dynPush(pool, tmpM3);
    }
  }

  /* ===== PHASE P: the doorway. A serf who steps inside used to be dropped
   * from the draw list on one frame and popped back at full size on another —
   * people blinking in and out of existence at every hut door. `vis.appear`
   * eases 1→0 as he goes in and 0→1 as he comes back out, and he sinks a
   * little into the doorway on the way, so the building visibly swallows him.
   * Serfs the world starts with skip it (objPopArmed is false on frame 1). */
  const DOOR_T = 0.22;
  function doorFade(vis, dt, hidden) {
    const a = vis.appear === undefined ? (objPopArmed ? (hidden ? 1 : 0) : 1) : vis.appear;
    vis.appear = Math.max(0, Math.min(1, a + (hidden ? -1 : 1) * dt / DOOR_T));
    return vis.appear;
  }

  function syncSerfs(dt) {
    const alive = new Set();
    const crate = dynPool("crate", FSModels.crateGeo(), FSModels.vcMat("crate", 0x808080, 0.34));
    const boat = dynPool("boat", FSModels.boatGeo(), FSModels.vcMat("boat", FSC.COL.BOAT, 0.3));
    for (const id in G.serfs) {
      const s = G.serfs[id];
      alive.add(s.id);
      const inside = s.state === "work" || s.state === "garrison";   // inside a building
      if (inside) {
        const v0 = dyn.serfVis.get(s.id);
        if (!v0) continue;                        // never drawn — nothing to swallow
        const a0 = doorFade(v0, dt, true);
        if (a0 <= 0.02) continue;
        if (s.job === FSC.JOB.KNIGHT) { knightVisual(s, dt, a0); continue; }
        drawSerf(s, v0, dt, a0, crate, boat);
        continue;
      }
      /* ===== PHASE-D: knights have their own rank-trimmed model + duel anim ===== */
      if (s.job === FSC.JOB.KNIGHT) {
        const vk = serfVisual(s, dt);
        knightVisual(s, dt, doorFade(vk, dt, false));
        continue;
      }
      const vis = serfVisual(s, dt);
      drawSerf(s, vis, dt, doorFade(vis, dt, false), crate, boat);
    }
    dyn.serfVis.forEach((v, id) => { if (!alive.has(id)) dyn.serfVis.delete(id); });
    dyn.lastSerfCount = alive.size;
  }

  function drawSerf(s, vis, dt, appear, crate, boat) {
      const sunk = (1 - appear) * 0.34;              /* ===== PHASE P: door ===== */
      const x = vis.x, z = vis.z, y = vis.y - sunk;
      const moving = appear > 0.98 && vis.speed > 0.02;
      const afloat = map.terr[s.from] === FSC.TERR.WATER || map.terr[s.to] === FSC.TERR.WATER;
      /* ===== PHASE P: the work stroke is event-synced (see serfSwing) and the
       * walk is driven by distance, so bob/lean/twist all follow the ground. */
      const swing = serfSwing(s);
      const working = swing >= 0;
      const step = Math.sin(vis.phase);              // ±1, one full period per 2 strides
      const bob = moving ? Math.abs(Math.cos(vis.phase)) * 0.052
        : (working ? swing * 0.045 : 0);
      const yaw = vis.yaw;
      const p = dynPool("serf:" + s.job + ":" + s.p, FSModels.serfGeo(s.job, s.p),
        FSModels.vcMat("serf", 0x9a9a9a, 0.34));
      tmpV.set(x, y + bob, z);
      /* torso: leans into the stroke when working; when walking it twists a
       * little against the leading leg (which is what reads as arm swing on a
       * one-piece minifig) and rolls onto the supporting foot. */
      tmpE.set(working ? -swing * 0.42 : (moving ? 0.06 : 0),
        yaw + (moving ? step * 0.10 : 0),
        moving ? -step * 0.055 : 0);
      tmpQ.setFromEuler(tmpE);
      tmpS.set(appear, appear, appear);
      dynPush(p, tmpM.compose(tmpV, tmpQ, tmpS));
      /* ===== PHASE P: legs. The body is still ONE merged instanced mesh per
       * (job, player) — the legs are simply lifted out of it into a SINGLE
       * shared pool (boots are the same on every serf, so all jobs and all
       * players share one geometry and one draw call) and posed per instance.
       * Cost: +1 draw call for the entire workforce. ===== */
      pushLegs(FSModels.serfLegGeo(), "serfleg", tmpM, moving ? step : 0,
        working ? swing : 0, SERF_HIP_X, SERF_HIP_Y);
      /* ===== PHASE P: record the pose the renderer actually drew, so the
       * film-strip rig / visual suite can measure per-frame world deltas
       * (walk smoothness, rotation continuity) from the OUTSIDE. ===== */
      vis.drawY = y + bob;
      if (!afloat && appear > 0.5) serfShadow.push(x, y, z);   /* ===== PHASE-V: contact shadow ===== */
      if (afloat) {                                                // the ferry itself
        /* ===== PHASE-V: a boat rides the swell — it bobs at rest and heels a
         * little into the direction it is rowing. ===== */
        const bob = Math.sin(dyn.tAcc * 1.5 + s.id * 1.7) * FSC.VIS.BOAT_BOB;
        const heel = moving ? Math.sin(dyn.tAcc * 2.6 + s.id) * 0.05 : bob * 0.5;
        tmpV.set(x, FSC.WATER_Y + 0.02 + bob, z);
        tmpE.set(bob * 0.5, yaw, heel); tmpQ.setFromEuler(tmpE);
        tmpS.set(1, 1, 1);
        dynPush(boat, tmpM.compose(tmpV, tmpQ, tmpS));
        if (moving) {
          /* a small wake: two foam quads trailing astern, spreading and fading —
           * the cue that tells a player at a glance which boats are working */
          const wake = dynPool("wake", FSModels.foamGeo(), FSModels.foamMat());
          const bx = Math.sin(yaw), bz = Math.cos(yaw);
          for (let k = 0; k < 3; k++) {
            const u = 0.30 + k * 0.34;
            const ph = Math.sin(dyn.tAcc * 3.1 + s.id + k) * 0.10;
            tmpV.set(x - bx * u * 1.5 + bz * ph, FSC.WATER_Y + 0.05, z - bz * u * 1.5 - bx * ph);
            tmpE.set(0, yaw, 0); tmpQ.setFromEuler(tmpE);
            const sw = 0.42 + u * 0.55;
            tmpS.set(sw, 1, sw * 1.5);
            dynPush(wake, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.setScalar(0.8 - u * 0.5));
          }
          tmpS.set(1, 1, 1);
        }
      }
      if (s.carry) {
        tmpV.set(x, y + bob + 0.86 * appear, z);
        tmpE.set(0, yaw, 0); tmpQ.setFromEuler(tmpE);
        tmpS.set(appear, appear, appear);
        dynPush(crate, tmpM.compose(tmpV, tmpQ, tmpS), resC.set(FSC.RES_COLOR[s.carry] || 0xcccccc));
        tmpS.set(1, 1, 1);
      }
  }

  /* ===================================================================== */
  /* ===== PHASE-C: geologist signs, chimney smoke, moving machinery ====== */
  /* ===================================================================== */

  const signVerts = new Map();          // vertex -> sign code (kept by refreshVertex)

  function scanSigns() {
    signVerts.clear();
    for (let v = 0; v < map.W * map.H; v++) if (map.sign[v]) signVerts.set(v, map.sign[v]);
  }

  function syncSigns() {
    if (!signVerts.size) return;
    const postP = dynPool("signpost", FSModels.signPostGeo(), FSModels.vcMat("signpost", COL.SIGN_POST, 0.3));
    const board = dynPool("signboard", FSModels.signBoardGeo(), FSModels.vcMat("signboard", 0x888888, 0.45));
    signVerts.forEach((code, v) => {
      FSMap.worldXZ(map, v, xz);
      tmpV.set(xz[0], map.height[v], xz[1]);
      tmpE.set(0, (v % 7) * 0.7, 0); tmpQ.setFromEuler(tmpE);
      const mineral = window.FSSim ? window.FSSim.signMineral(code) : 0;
      const big = window.FSSim ? window.FSSim.signDensity(code) : 0;
      tmpS.set(1, 1, 1);
      dynPush(postP, tmpM.compose(tmpV, tmpQ, tmpS));
      tmpS.set(big ? 1.35 : 1, big ? 1.35 : 1, 1);
      dynPush(board, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.set(COL.MINERAL[mineral] === undefined ? COL.MINERAL[0] : COL.MINERAL[mineral]));
    });
  }

  /* ═════════════════════════════════════════════════════ PHASE P: smoke ═══
   * Two things were wrong with the old chimney column.
   *  (1) It was drawn with the OPAQUE vertex-colour material on an
   *      icosahedron, so a working quarter wore a grey ROCK, not smoke. It
   *      now uses the same soft, texture-faded, depth-write-off billboard the
   *      road dust already used — the puff geometry that was sitting right
   *      there unused by the chimneys.
   *  (2) The puffs were a `% 1` modulo of the wall clock: five slots that
   *      TELEPORTED from the top of the column back to the chimney at full
   *      size and half opacity. Replaced by a real pooled spawn/age model —
   *      each puff is born small and clear at the chimney, swells, drifts on
   *      the breeze, thins out and DIES; nothing ever pops in or out.
   * Spun-up/spun-down: a chimney that stops working no longer cuts its column
   * dead — it just stops emitting, and the puffs already in the air finish
   * their lives. Sails and wheels ease their rate down over ~1.4 s instead of
   * freezing mid-turn (`view.userData.busyF`). */
  const puffs = [];                        // { x,y,z, vx,vy,vz, t,T, s0,s1, roll, col }
  function spawnPuff(x, y, z, o) {
    if (puffs.length >= (FSC.VIS.SMOKE_PUFF_MAX || 120)) puffs.shift();
    puffs.push({
      x: x, y: y, z: z,
      vx: o.vx, vy: o.vy, vz: o.vz,
      t: 0, T: o.T, s0: o.s0, s1: o.s1, roll: o.roll, col: o.col === undefined ? 1 : o.col,
      op: o.op === undefined ? 1 : o.op,
      warm: o.warm || 0,                     // 0 = wood smoke, 1 = lit by the fire below
    });
  }
  function advancePuffs(dt) {
    if (!puffs.length) return;
    /* ADDITIVE, deliberately: an InstancedMesh can only carry a per-instance
     * COLOUR, never a per-instance alpha — so with normal blending a fading
     * puff darkens toward black and reads as a soot smudge instead of
     * disappearing. Under additive blending colour IS opacity, so the same
     * per-instance scalar gives a clean birth and a clean death, and warm
     * pale wood-smoke is exactly the register this game wants. */
    const pool = dynPool("smoke", FSModels.puffGeo(), FSModels.puffMat("smoke", COL.SMOKE, "add"));
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.t += dt;
      if (p.t >= p.T) { puffs.splice(i, 1); continue; }
      const u = p.t / p.T;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vy *= 1 - dt * 0.35;                       // it slows as it cools
      const s = p.s0 + (p.s1 - p.s0) * u;
      // fade IN over the first 12% and OUT over the last 45% — a puff never pops
      const fade = Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.45);
      tmpV.set(p.x, p.y, p.z);
      billboardQuat(tmpQ, p.roll + u * 0.9);
      tmpS.set(s, s, s);
      const k = p.col * fade * p.op;
      // warm puffs keep the ember glow low down and cool to grey as they climb
      if (p.warm) { const w = p.warm * (1 - u); tmpC.setRGB(k, k * (1 - w * 0.30), k * (1 - w * 0.55)); }
      else tmpC.setScalar(k);
      dynPush(pool, tmpM.compose(tmpV, tmpQ, tmpS), tmpC);
    }
  }
  /** face the camera exactly, with a roll about the view axis for variety */
  const bbQ = new THREE.Quaternion(), bbAxis = new THREE.Vector3(0, 0, 1);
  function billboardQuat(out, roll) {
    out.copy(camera.quaternion);
    if (roll) { bbQ.setFromAxisAngle(bbAxis, roll); out.multiply(bbQ); }
    return out;
  }

  /** Turn the mill sails / mine wheel / saw blade, and puff smoke, while working. */
  const SMOKE_GAP = 0.30;                  // seconds between chimney puffs
  function syncWorking(dt) {
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.state !== "done") continue;
      const view = bldViews.get(b.id);
      if (!view) continue;
      const busy = !!b.working;
      const ud = view.userData;
      /* ===== PHASE P: machinery spins UP and DOWN, it never slams ===== */
      const target = busy ? 1 : 0;
      const rate = busy ? 2.2 : 0.7;       // ~0.45 s to spin up, ~1.4 s to coast down
      ud.busyF = (ud.busyF === undefined ? target : ud.busyF) +
        (target - (ud.busyF === undefined ? target : ud.busyF)) * Math.min(1, dt * rate);
      if (ud.busyF < 0.004) ud.busyF = 0;
      if (ud.spin && ud.busyF > 0) {
        const r = (ud.spinRate || 1) * dt * ud.busyF;
        const ax = ud.spinAxis;
        if (ax === "y") ud.spin.rotation.y += r;
        else if (ax === "x") ud.spin.rotation.x += r;
        else ud.spin.rotation.z += r;
      }
      if (ud.smoke) {
        const o = ud.smoke;
        /* the FIRE dies faster than a flywheel coasts: emission tapers over
         * ~1.4 s and then stops cleanly, while the puffs already in the air
         * live out their own 2.6-3.5 s. Nothing is ever cut dead. */
        const smokeF = busy ? 1 : Math.max(0, ud.busyF * 1.55 - 0.55);
        ud.smokeT = (ud.smokeT === undefined ? hash01(b.id, 5) * SMOKE_GAP : ud.smokeT) - dt * smokeF;
        while (ud.smokeT <= 0) {
          ud.smokeT += SMOKE_GAP;
          const j = hash01(b.id * 31 + Math.round(dyn.tAcc * 37), 9);
          spawnPuff(view.position.x + o[0] + (j - 0.5) * 0.12,
            view.position.y + o[1],
            view.position.z + o[2] + (hash01(b.id * 17 + Math.round(dyn.tAcc * 53), 3) - 0.5) * 0.12, {
              vx: 0.30 + j * 0.22, vy: 0.98 + j * 0.22, vz: 0.16,
              T: 2.6 + j * 0.9, s0: 0.26, s1: 1.70, roll: j * 6.283, col: 0.30,
            });
        }
      }
    }
  }

  /* ===== PHASE-V: standing crops. The field patch itself is a static object,
   * but ripe stalks are pushed as instances every frame so the whole harvest
   * ripples — the one thing that makes a farm quarter feel like weather. ===== */
  function syncWheat() {
    const V = FSC.VIS, O = FSC.OBJ;
    const pool = dynPool("wheat", FSModels.wheatGeo(), FSModels.vcMat("wheat", 0xc9b45c, 0.42));
    let n = 0;
    const green = tmpC, ripe = blendC;
    vertSlot.forEach((slot, v) => {
      if (n >= V.WHEAT_MAX) return;
      const o = map.obj[v];
      if (o < O.FIELD1 || o > O.FIELD4) return;
      const stage = o - O.FIELD0;                       // 1..4
      FSMap.worldXZ(map, v, xz);
      const y = map.height[v];
      green.set(V.WHEAT_GREEN); ripe.set(V.WHEAT_RIPE);
      green.lerp(ripe, (stage - 1) / 3);
      const h = 0.55 + stage * 0.16;
      for (let k = 0; k < V.WHEAT_CLUSTERS; k++) {
        const a = (k / V.WHEAT_CLUSTERS) * 6.283 + hash01(v, 17) * 6.283;
        const r = 0.30 + hash01(v * 5 + k, 23) * 0.34;
        const ph = hash01(v * 3 + k, 29) * 6.283;
        const lean = Math.sin(dyn.tAcc * 1.15 + ph) * 0.15;
        tmpV.set(xz[0] + Math.cos(a) * r, y + 0.07, xz[1] + Math.sin(a) * r);
        tmpE.set(lean * 0.7, a, lean);
        tmpQ.setFromEuler(tmpE);
        tmpS.set(h, h, h);
        dynPush(pool, tmpM.compose(tmpV, tmpQ, tmpS), green);
        n++;
      }
    });
  }

  /* ===== PHASE-V: the contact shadows that move — buildings and workers.
   * (Static object shadows live in the decor layer.) ===================== */
  function syncShadows() {
    if (quality < 0.4) { serfShadow.length = 0; return; }
    const pool = dynPool("shadowDyn", FSModels.shadowGeo(), FSModels.shadowMat());
    for (const id in G.buildings) {
      const b = G.buildings[id];
      const view = bldViews.get(b.id);
      if (!view) continue;
      const sz = (FSC.BLD[b.type] && FSC.BLD[b.type].size) || 0;
      const s = b.type === "castle" ? 4.6 : [2.0, 2.6, 3.3][sz];
      const off = FSC.VIS.SHADOW_OFF * s * 0.5;
      tmpV.set(view.position.x - SUN_DX * off, view.position.y + 0.035, view.position.z - SUN_DZ * off);
      tmpE.set(0, Math.PI / 6, 0); tmpQ.setFromEuler(tmpE);
      tmpS.set(s * 1.05, 1, s);
      dynPush(pool, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.setScalar(1));
    }
    for (let i = 0; i < serfShadow.length; i += 3) {
      tmpV.set(serfShadow[i] - SUN_DX * 0.16, serfShadow[i + 1] + 0.03, serfShadow[i + 2] - SUN_DZ * 0.16);
      tmpQ.identity();
      tmpS.set(0.70, 1, 0.62);
      dynPush(pool, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.setScalar(0.85));
    }
    serfShadow.length = 0;
  }
  const serfShadow = [];

  /* ===================================================================== */
  /* ===== PHASE-D: knights, duels, corpses, fire, frontier, captures ===== */
  /* ===================================================================== */

  /** Who is this knight crossing swords with? (drives the facing + the lunge) */
  function duelFoe(s) {
    const b = G.buildings[s.state === "fight" ? (s.defOf || s.atkTarget) : 0];
    if (!b || !b.mil || !b.mil.fight) return null;
    const f = b.mil.fight;
    const other = f.att === s.id ? f.def : (f.def === s.id ? f.att : 0);
    return other ? G.serfs[other] : null;
  }

  /**
   * Knights get their own instanced mesh per (rank, player) so the shield trim
   * reads at a glance. During a duel the pair face each other and lunge on
   * alternate beats — the classic's little sword dance.
   */
  /* ===== PHASE P: the duel used to be `max(0, sin(wallclock))` — one endless
   * beat with no wind-up, no recovery and, worse, no relationship to the sim.
   * A round is FSC.FIGHT_ROUND_T ticks long and ends with the fightRound event
   * (the clang flash, the SFX and, usually, a death). The exchange is now cut
   * into three beats inside that window, the pair take alternate beats, and
   * because the phase is read from `fight.t` the LAST thrust reaches full
   * extension on exactly the tick the blow is struck. Wind-up → thrust →
   * the other man recoils. */
  function duelPose(s, fi, isAtt, out) {
    const P = Math.max(2, (FSC.FIGHT_ROUND_T || 22) / 3);
    const rem = Math.max(0, (fi.t || 0) - dyn.tickU);
    const w = 1 - ((rem % P) + P) % P / P;             // 0 → 1 within the beat
    const beat = Math.floor(((FSC.FIGHT_ROUND_T || 22) - rem) / P + 1e-6);
    const mine = isAtt ? (beat % 2 === 0) : (beat % 2 === 1);
    let thrust;
    if (w < 0.6) thrust = -0.34 * Math.sin((w / 0.6) * Math.PI);   // settle back on guard
    else thrust = Math.pow((w - 0.6) / 0.4, 1.6);                  // and drive in
    out.l = mine ? thrust : -0.30 * Math.max(0, thrust);           // the other man recoils
    return out;
  }
  const duelOut = { l: 0 };

  function knightVisual(s, dt, appear) {
    const vis = dyn.serfVis.get(s.id) || serfVisual(s, dt);
    if (appear === undefined) appear = 1;
    const sunk = (1 - appear) * 0.34;              /* ===== PHASE P: door ===== */
    let x = vis.x, z = vis.z;
    const y = vis.y - sunk;
    const moving = appear > 0.98 && vis.speed > 0.02;
    let yaw = vis.yaw;
    const step = Math.sin(vis.phase);
    let lunge = 0, bob = moving ? Math.abs(Math.cos(vis.phase)) * 0.052 : 0;
    let stride = moving ? step : 0;
    if (s.state === "fight") {
      const foe = duelFoe(s);
      const fi = foe ? (G.buildings[s.defOf || s.atkTarget] || {}).mil : null;
      if (foe) {
        FSMap.worldXZ(map, foe.v, xz);
        const dx = xz[0] - x, dz = xz[1] - z;
        // face the foe directly: a duel is not the moment for a slow turn
        yaw = Math.atan2(dx, dz);
        vis.yaw = yaw;
        const p = duelPose(s, (fi && fi.fight) || { t: 0 }, (fi && fi.fight && fi.fight.att === s.id), duelOut);
        lunge = p.l * 0.34;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        x += (dx / len) * lunge; z += (dz / len) * lunge;
        vis.x = x; vis.z = z;
        bob = Math.max(0, p.l) * 0.16;
        stride = -p.l * 0.55;                       // the feet follow the lunge
      }
    }
    const pool = dynPool("knight:" + (s.rank | 0) + ":" + s.p,
      FSModels.knightGeo(s.rank, s.p), FSModels.vcMat("serf", 0x9a9a9a, 0.34));
    tmpV.set(x, y + bob, z);
    tmpE.set(lunge * 1.5, yaw + (moving ? step * 0.09 : 0),
      (moving ? -step * 0.05 : 0) - lunge * 0.45);
    tmpQ.setFromEuler(tmpE);
    tmpS.set(appear, appear, appear);
    dynPush(pool, tmpM.compose(tmpV, tmpQ, tmpS));
    pushLegs(FSModels.knightLegGeo(), "knightleg", tmpM, stride, 0, KNIGHT_HIP_X, KNIGHT_HIP_Y);
    vis.drawY = y + bob;                                   /* ===== PHASE P ===== */
    return { x, y, z, lunge };
  }

  /** Border posts along every ownership seam, rebuilt when the map changes hands. */
  function syncBorders() {
    if (!window.FSMil) return;
    if (mil.gen !== G.ownerGen) {
      mil.gen = G.ownerGen;
      mil.stakes = window.FSMil.borderStakes(G);
    }
    if (!mil.stakes.length) return;
    const pool = dynPool("stake", FSModels.stakeGeo(), FSModels.vcMat("stake", FSC.COL.STAKE, 0.34));
    /* ===== PHASE P: the POST keeps its own wood colour (an instance colour
     * multiplies the whole mesh, so tinting it by the owner turned every
     * frontier post near-black); only the pennant carries the player. ===== */
    const flagP = dynPool("stakeflag", FSModels.stakeFlagGeo(), FSModels.vcMat("stakeflag", 0x888888, 0.42));
    for (let i = 0; i < mil.stakes.length; i++) {
      const st = mil.stakes[i];
      FSMap.worldXZ(map, st.v, xz);
      tmpV.set(xz[0], map.height[st.v], xz[1]);
      tmpE.set(0, st.d * 1.047 + 0.4, 0); tmpQ.setFromEuler(tmpE);
      tmpS.set(1, 1, 1);
      tmpM.compose(tmpV, tmpQ, tmpS);
      dynPush(pool, tmpM);
      dynPush(flagP, tmpM, tmpC.set(FSC.PLAYER_COLORS[st.p % FSC.PLAYER_COLORS.length]));
    }
  }

  /** Fallen knights lie where they dropped and sink away over FSC.CORPSE_T. */
  function syncCorpses() {
    if (!G.corpses || !G.corpses.length) return;
    const pool = dynPool("corpse", FSModels.corpseGeo(), FSModels.vcMat("corpse", FSC.COL.CORPSE, 0.3));
    for (let i = 0; i < G.corpses.length; i++) {
      const c = G.corpses[i];
      const age = (G.tick - c.t) / FSC.CORPSE_T;
      if (age > 1) continue;
      const k = 1 - age * age;
      FSMap.worldXZ(map, c.v, xz);
      tmpV.set(xz[0], map.height[c.v] + 0.02, xz[1]);
      tmpE.set(0, (c.v % 7) * 0.9, 0); tmpQ.setFromEuler(tmpE);
      tmpS.set(k, k, k);
      dynPush(pool, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.set(FSC.PLAYER_COLORS[c.p % FSC.PLAYER_COLORS.length]).lerp(blendC.set(FSC.COL.CORPSE), 0.65));
    }
  }

  /** Flames + smoke over anything that is burning down. */
  const fireSmokeT = new Map();
  function syncFire(dt) {
    const flame = dynPool("flame", FSModels.flameGeo(), FSModels.vcMat("flame", FSC.COL.FIRE[0], 0.85));
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.state !== "burn") { if (fireSmokeT.size) fireSmokeT.delete(b.id); continue; }
      FSMap.worldXZ(map, b.v, xz);
      const y = map.height[b.v];
      const big = FSC.BLD[b.type].size >= 2 ? 1.5 : 1;
      for (let k = 0; k < 4; k++) {
        const a = k * 1.571 + dyn.tAcc * 0.6 + b.id;
        const s = (0.7 + Math.abs(Math.sin(dyn.tAcc * 6 + k * 1.9 + b.id)) * 0.6) * big;
        tmpV.set(xz[0] + Math.cos(a) * 0.34 * big, y + 0.2, xz[1] + Math.sin(a) * 0.34 * big);
        tmpE.set(0, a, 0); tmpQ.setFromEuler(tmpE);
        tmpS.set(s, s * 1.2, s);
        dynPush(flame, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.set(FSC.COL.FIRE[k & 1]));
      }
      /* ===== PHASE P: the burn column is the same pooled soft puff as a
       * chimney's, just darker, faster and fatter — so a fire reads as a
       * rolling column instead of three grey pebbles hopping on a loop. */
      let t = fireSmokeT.get(b.id);
      if (t === undefined) t = hash01(b.id, 11) * 0.18;
      t -= dt;
      while (t <= 0) {
        t += 0.16;
        const j = hash01(b.id * 13 + Math.round(dyn.tAcc * 41), 7);
        spawnPuff(xz[0] + (j - 0.5) * 0.5 * big, y + 0.9 * big, xz[1] + (j - 0.5) * 0.4 * big, {
          vx: 0.55 + j * 0.4, vy: 1.55 + j * 0.5, vz: 0.22,
          T: 2.2 + j * 0.8, s0: 0.5 * big, s1: 2.6 * big, roll: j * 6.283, col: 0.42, warm: 1,
        });
      }
      fireSmokeT.set(b.id, t);
    }
  }

  /**
   * Event-driven one-shots: a clang at every fight round, a coloured ring when a
   * building changes hands. The sim's event ring is scanned by tick stamp, so a
   * skipped frame never loses one and a replayed one is never double-counted.
   */
  function scanMilEvents() {
    if (!G.events.length) return;
    const from = mil.evT;
    for (let i = 0; i < G.events.length; i++) {
      const e = G.events[i];
      if (e.t <= from) continue;
      if (e.type === "fightRound") mil.flashes.push({ v: e.v, kind: "clang", t: 0 });
      else if (e.type === "bldCaptured") mil.flashes.push({ v: e.v, kind: "capture", t: 0, p: e.p });
      else if (e.type === "castleFell") mil.flashes.push({ v: e.v, kind: "capture", t: 0, p: e.by });
    }
    mil.evT = G.tick;
    if (mil.flashes.length > 40) mil.flashes.splice(0, mil.flashes.length - 40);
  }

  function syncFlashes(dt) {
    if (!mil.flashes.length) return;
    const clang = dynPool("clang", FSModels.clangGeo(), FSModels.vcMat("clang", FSC.COL.CLANG, 0.9));
    for (let i = mil.flashes.length - 1; i >= 0; i--) {
      const f = mil.flashes[i];
      f.t += dt;
      const life = f.kind === "clang" ? 0.35 : 1.1;
      if (f.t > life) { mil.flashes.splice(i, 1); continue; }
      const k = f.t / life;
      FSMap.worldXZ(map, f.v, xz);
      if (f.kind === "clang") {
        const s = 0.5 + k * 0.9;
        tmpV.set(xz[0], map.height[f.v] + 0.75, xz[1]);
        tmpE.set(k * 4, k * 6, 0); tmpQ.setFromEuler(tmpE);
        tmpS.set(s, s, s);
        dynPush(clang, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.set(FSC.COL.CLANG).multiplyScalar(1 - k));
      } else {
        const s = 0.6 + k * 4.5;
        tmpV.set(xz[0], map.height[f.v] + 0.35, xz[1]);
        tmpE.set(0, k * 2, 0); tmpQ.setFromEuler(tmpE);
        tmpS.set(s, 0.35, s);
        dynPush(clang, tmpM.compose(tmpV, tmpQ, tmpS),
          tmpC.set(FSC.PLAYER_COLORS[(f.p || 0) % FSC.PLAYER_COLORS.length]).multiplyScalar(1 - k * 0.8));
      }
    }
  }

  /** Repaint every terrain vertex — used when the territory tint is toggled. */
  function repaintTerrain() {
    if (!terrainMesh) return;
    const N = map.W * map.H;
    for (let v = 0; v < N; v++) {
      terrainColor(v, tmpC);
      colAttr.setXYZ(v, tmpC.r, tmpC.g, tmpC.b);
    }
    dirtyCol = true;
  }
  FSRender.setTerritoryTint = function (on) {
    mil.tint = !!on;
    repaintTerrain();
    return mil.tint;
  };
  FSRender.territoryTint = function () { return mil.tint; };
  FSRender.militaryInfo = function () {
    return { tint: mil.tint, stakes: mil.stakes.length, flashes: mil.flashes.length, gen: mil.gen };
  };

  /** Per-frame sync of everything Phase B owns. Called from FSRender.frame(). */
  function syncDynamic(dt) {
    if (!dyn.group || !G) return;
    dyn.tAcc += dt;
    /* ===== PHASE P: advance the sub-tick clock before anything reads it. */
    if (G.tick !== dyn.lastTick) {
      const n = dyn.lastTick < 0 ? 1 : (G.tick - dyn.lastTick);
      dyn.lastTick = G.tick;
      dyn.tickAge = n > 1 ? 0 : Math.max(0, dyn.tickAge - FSC.TICK_S / Math.max(0.001, G.speed || 1));
    } else {
      dyn.tickAge += dt;
    }
    dyn.tickU = Math.max(0, Math.min(1, dyn.tickAge / (FSC.TICK_S / Math.max(0.001, G.speed || 1))));
    // terrain the sim changed (digger leveling, cleared building footprints)
    let ground = false;
    if (G.dirtyV && G.dirtyV.length) {
      for (let i = 0; i < G.dirtyV.length; i++) FSRender.refreshVertex(G.dirtyV[i]);
      G.dirtyV.length = 0;
      ground = true;                    // buildings + roads sit on the ground that moved
      dyn.roadSig = "";
    }
    const rs = roadSignature();
    if (rs !== dyn.roadSig) { dyn.roadSig = rs; rebuildRoads(); }
    let bs = "";
    for (const id in G.buildings) { const b = G.buildings[id]; bs += id + b.state + bldVisKey(b) + ";"; }
    if (ground || bs !== dyn.bldSig) { dyn.bldSig = bs; FSRender.refreshBuildings(); }
    /* ===== PHASE-V: tear up / grow back the meadow where the settlement moved ===== */
    let fc = 0;
    for (const id in G.flags) fc++;
    const cs = rs + "|" + fc + "|" + bs.length;
    if (ground || cs !== claimSig) { claimSig = cs; syncClaims(); }
    syncFlags();
    syncSerfs(dt);
    syncSigns();                        /* ===== PHASE-C ===== */
    syncWorking(dt);
    syncWheat();                        /* ===== PHASE-V ===== */
    /* ===== PHASE-D: frontier, corpses, fire, duel sparks ===== */
    scanMilEvents();
    syncBorders();
    syncCorpses();
    syncFire(dt);
    syncFlashes(dt);
    /* ===== PHASE-E: congestion glow + suitability overlay upkeep ===== */
    syncCongestion(dt);
    syncSuitabilityUpkeep(dt);
    advancePuffs(dt);                   /* ===== PHASE P: pooled soft smoke ===== */
    advanceObjPop(dt);                  /* ===== PHASE P: no ground object pops ===== */
    objPopArmed = true;                 // boot's own object build never animates
    syncShadows();                      /* ===== PHASE-V: grounding, drawn last ===== */
    dynFlush();
  }
  FSRender.syncDynamic = syncDynamic;
  FSRender.dynamicInfo = function () {
    const out = { serfs: dyn.lastSerfCount, roads: dyn.roadMesh ? 1 : 0, pools: {} };
    for (const k in dyn.pools) out.pools[k] = { cap: dyn.pools[k].cap, count: dyn.pools[k].mesh.count };
    return out;
  };
  /* ===== PHASE P (read-only test hooks): what the last frame actually drew.
   * The film-strip rig and the visual suite use these to assert motion
   * continuity numerically instead of by eye. */
  FSRender.serfPose = function (id) {
    const v = dyn.serfVis.get(id | 0);
    if (!v || v.x === undefined) return null;
    return { x: v.x, y: v.y, z: v.z, yaw: v.yaw, frac: v.frac, from: v.from, to: v.to,
      phase: v.phase, speed: v.speed, appear: v.appear === undefined ? 1 : v.appear };
  };
  /** spin/smoke state of one building's machinery (spin-up/spin-down proof) */
  FSRender.machineInfo = function (id) {
    const view = bldViews.get(id | 0);
    if (!view) return null;
    const ud = view.userData, sp = ud.spin;
    return {
      busyF: ud.busyF === undefined ? null : ud.busyF,
      hasSpin: !!sp, hasSmoke: !!ud.smoke,
      spin: sp ? (ud.spinAxis === "y" ? sp.rotation.y : ud.spinAxis === "x" ? sp.rotation.x : sp.rotation.z) : null,
    };
  };
  /** live counts for the animation systems Phase P added */
  FSRender.animInfo = function () {
    return { puffs: puffs.length, objPop: objPop.size, objFade: objFade.length,
      tickU: dyn.tickU, glide: !!camGlide };
  };

  function disposeDynamic() {
    if (!dyn.group) return;
    for (const k in dyn.pools) { dyn.group.remove(dyn.pools[k].mesh); dyn.pools[k].mesh.dispose(); delete dyn.pools[k]; }
    if (dyn.roadMesh) { dyn.group.remove(dyn.roadMesh); dyn.roadMesh.geometry.dispose(); dyn.roadMesh = null; }
    if (scene) scene.remove(dyn.group);
    dyn.group = null;
    dyn.serfVis.clear();
  }

  /* ===== PHASE-V: buildings now SHARE one cached atlas material, so a view
   * teardown must dispose its own geometry but never the shared material —
   * doing so would blank every other building on screen (and leak a fresh
   * texture upload on the next rebuild). Materials that came out of FSModels'
   * cache are flagged; everything else is still disposed as before. ===== */
  function disposeMat(m) {
    if (!m || (m.userData && m.userData.shared) || m === FSModels.bldMat()) return;
    m.dispose();
  }
  function disposeTree(o) {
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(disposeMat);
        else disposeMat(c.material);
      }
    });
  }

  // -------------------------------------------------------------------- camera
  function groundY(x, z) {
    const v = FSMap.nearestVertex(map, x, z);
    return v >= 0 ? Math.max(FSC.WATER_Y, map.height[v]) : 0;
  }

  function clampCam() {
    cam.dist = Math.max(CAM.DIST_MIN, Math.min(CAM.DIST_MAX, cam.dist));
    cam.pitch = Math.max(CAM.PITCH_MIN, Math.min(CAM.PITCH_MAX, cam.pitch));
    const w = map.W * FSC.TILE, d = map.H * FSC.TILE * FSC.ROW_Z;
    cam.tx = Math.max(-10, Math.min(w + 10, cam.tx));
    cam.tz = Math.max(-10, Math.min(d + 10, cam.tz));
    if (cam.yaw > Math.PI) cam.yaw -= Math.PI * 2;
    if (cam.yaw < -Math.PI) cam.yaw += Math.PI * 2;
  }

  function applyCamera() {
    clampCam();
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    camera.position.set(
      cam.tx + Math.sin(cam.yaw) * cp * cam.dist,
      cam.ty + sp * cam.dist,
      cam.tz + Math.cos(cam.yaw) * cp * cam.dist
    );
    camera.lookAt(cam.tx, cam.ty, cam.tz);
  }

  FSRender.camState = function () { return Object.assign({}, cam); };
  FSRender.setCam = function (o) { camGlide = null; Object.assign(cam, o); applyCamera(); return FSRender.camState(); };

  /* ===== PHASE P: jumping the camera. A notification / alert / minimap jump
   * used to TELEPORT the view, which is disorienting — you lose where you
   * were. `glide` eases the target over ~0.45 s with a smoothstep, so the
   * player's eye can follow the move. Tests (and boot) keep the old instant
   * behaviour: `glide` is opt-in, and any user pan/zoom/orbit cancels it. */
  let camGlide = null;                // { t, T, x0, z0, y0, d0, x1, z1, y1, d1 }
  FSRender.focusVertex = function (v, dist, glide) {
    if (v < 0) return;
    FSMap.worldXZ(map, v, xz);
    const tx = xz[0], tz = xz[1], ty = Math.max(FSC.WATER_Y, map.height[v]);
    if (!glide) {
      camGlide = null;
      cam.tx = tx; cam.tz = tz; cam.ty = ty;
      if (dist) cam.dist = dist;
      applyCamera();
      return;
    }
    camGlide = { t: 0, T: 0.45, x0: cam.tx, z0: cam.tz, y0: cam.ty, d0: cam.dist,
      x1: tx, z1: tz, y1: ty, d1: dist || cam.dist };
  };
  FSRender.cancelGlide = function () { camGlide = null; };
  /** the touch long-press context menu opens on TOP of a finger that fs-render
   * already turned into a camera drag — this lets the shell stop that drag so
   * the world does not keep panning under the open menu. */
  FSRender.cancelDrag = function () {
    if (!drag) return false;
    drag = null;
    return true;
  };

  FSRender.pickVertex = function (clientX, clientY) {
    if (!terrainMesh) return -1;
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    if (nx < -1 || nx > 1 || ny < -1 || ny > 1) return -1;
    ray.setFromCamera({ x: nx, y: ny }, camera);
    const hit = ray.intersectObject(terrainMesh, false);
    if (!hit.length) return -1;
    return FSMap.nearestVertex(map, hit[0].point.x, hit[0].point.z);
  };

  FSRender.worldToScreen = function (x, y, z) {
    const rect = canvas.getBoundingClientRect();
    tmpV.set(x, y, z).project(camera);
    return {
      x: rect.left + (tmpV.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-tmpV.y * 0.5 + 0.5) * rect.height,
      inView: tmpV.x >= -1 && tmpV.x <= 1 && tmpV.y >= -1 && tmpV.y <= 1 && tmpV.z <= 1,
    };
  };
  FSRender.vertexScreen = function (v) {
    FSMap.worldXZ(map, v, xz);
    return FSRender.worldToScreen(xz[0], map.height[v], xz[1]);
  };

  /* ===== PHASE F: hovering a BUILDING scales the hover ring to its real
   * footprint — the closest thing to an "outline" that doesn't touch the
   * building's own material (Phase V's building material is a single shared/
   * cached atlas across every instance of that mesh — bumping ITS emissive
   * would light up every building of that kind on the map, not just the one
   * under the cursor, so a separate ground decal is the safe route). A plain
   * vertex/flag hover keeps the ring at its original small size. ===== */
  const HOVER_RING_BASE_R = 0.78;   // FSModels.ring()'s own default outer radius
  function hoverFootprintScale(v) {
    const bid = map.bldAt[v];
    if (!bid || !G || !G.buildings[bid]) return 1;
    const def = FSC.BLD[G.buildings[bid].type];
    const r = (def && def.size >= 2) ? 2.35 : 1.05;   // mirrors FOOTPRINT_R small/large below
    return r / HOVER_RING_BASE_R;
  }
  FSRender.setHover = function (v) {
    hoverV = v;
    if (!hoverRing) return;
    if (v < 0) { hoverRing.visible = false; return; }
    FSMap.worldXZ(map, v, xz);
    hoverRing.position.set(xz[0], map.height[v] + 0.07, xz[1]);
    const s = hoverFootprintScale(v);
    hoverRing.scale.set(s, 1, s);
    hoverRing.visible = true;
  };
  FSRender.hoverVertex = function () { return hoverV; };

  // --------------------------------------------------------------------- input
  function onPointerDown(e) {
    if (drag) return;
    camGlide = null;                  /* ===== PHASE P: the player takes over ===== */
    canvas.focus && canvas.focus();
    drag = { mode: e.button === 2 || e.shiftKey ? "orbit" : "pan", x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0 };
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
  }
  function onPointerMove(e) {
    if (!drag) { hoverPend = { x: e.clientX, y: e.clientY }; return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.mode === "orbit") {
      cam.yaw += dx * CAM.ORBIT_YAW;
      /* ===== PHASE-E: Settings → "invert camera" flips vertical look only ===== */
      cam.pitch += dy * CAM.ORBIT_PITCH * (invertY ? -1 : 1);
    } else {
      const k = cam.dist * CAM.DRAG_PAN;
      const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
      cam.tx += (-c * dx + -s * dy) * k;
      cam.tz += (s * dx + -c * dy) * k;
    }
    applyCamera();
  }
  function onPointerUp(e) {
    if (drag && canvas.releasePointerCapture) { try { canvas.releasePointerCapture(drag.id); } catch (_) {} }
    drag = null;
  }
  /** Raycasts the cursor onto a flat plane at the camera target's own height
   *  (the same flat-ground approximation onPointerMove's pan branch already
   *  uses — no dependency on the terrain mesh existing/being ready). Returns
   *  null if the ray can't hit the plane (near-parallel — practically never
   *  happens for this camera's pitch range, but the caller must guard it). */
  function screenGroundPoint(clientX, clientY, out) {
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera({ x: nx, y: ny }, camera);
    zoomPlane.constant = -cam.ty;
    return ray.ray.intersectPlane(zoomPlane, out);
  }
  /* ===== PHASE E (QoL#5): zoom TOWARD THE CURSOR, not just the existing
   * orbit target — a plain dist-only zoom only "feels" cursor-anchored when
   * the cursor happens to already sit on cam's target; off-target it visibly
   * drifts. Standard before/after ground-plane raycast + target-pan
   * compensation: read the world point under the cursor, apply the zoom,
   * read it again, and pan the target by the difference so that same world
   * point lands back under the cursor. ===== */
  function onWheel(e) {
    e.preventDefault();
    camGlide = null;                  /* ===== PHASE P: the player takes over ===== */
    const before = screenGroundPoint(e.clientX, e.clientY, tmpZoomV);
    const bx = before ? before.x : 0, bz = before ? before.z : 0;
    cam.dist *= Math.exp(e.deltaY * CAM.ZOOM_RATE);
    applyCamera();
    if (before) {
      const after = screenGroundPoint(e.clientX, e.clientY, tmpV);
      if (after) {
        cam.tx += bx - after.x;
        cam.tz += bz - after.z;
        applyCamera();
      }
    }
  }
  function onKey(e, down) {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if ("wasdqe".indexOf(k) >= 0 || k.indexOf("Arrow") === 0) {
      keys[k] = down;
      if (down) e.preventDefault();
    }
  }

  function tickCamera(dt) {
    /* ===== PHASE P: a smoothed jump-to (notification / alert / minimap) ===== */
    if (camGlide) {
      camGlide.t += dt;
      const u = Math.min(1, camGlide.t / camGlide.T);
      const e = u * u * (3 - 2 * u);                 // smoothstep — ease in AND out
      cam.tx = camGlide.x0 + (camGlide.x1 - camGlide.x0) * e;
      cam.tz = camGlide.z0 + (camGlide.z1 - camGlide.z0) * e;
      cam.ty = camGlide.y0 + (camGlide.y1 - camGlide.y0) * e;
      cam.dist = camGlide.d0 + (camGlide.d1 - camGlide.d0) * e;
      if (u >= 1) camGlide = null;
      applyCamera();
      return;
    }
    const pan = CAM.KEY_PAN * cam.dist * dt;
    let fx = 0, fz = 0;
    if (keys.w || keys.ArrowUp) fz -= 1;
    if (keys.s || keys.ArrowDown) fz += 1;
    if (keys.a || keys.ArrowLeft) fx -= 1;
    if (keys.d || keys.ArrowRight) fx += 1;
    if (keys.q) cam.yaw -= CAM.YAW_RATE * dt;
    if (keys.e) cam.yaw += CAM.YAW_RATE * dt;
    if (fx || fz) {
      // right = (cos yaw, 0, -sin yaw) ; forward(screen-up) = (-sin yaw, 0, -cos yaw)
      const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
      cam.tx += (c * fx + s * fz) * pan;
      cam.tz += (-s * fx + c * fz) * pan;
    }
    const gy = groundY(cam.tx, cam.tz);
    cam.ty += (gy - cam.ty) * Math.min(1, dt * CAM.LERP);
    applyCamera();
  }

  // ---------------------------------------------------------------------- init
  FSRender.init = function (canvasEl, g) {
    FSRender.dispose();
    canvas = canvasEl; G = g; map = g.map;
    objPopArmed = false;                /* ===== PHASE P: a fresh world never animates in ===== */
    FSMap.bind(map);
    waterDist = (function () {
      const seeds = [];
      for (let v = 0; v < map.W * map.H; v++) if (map.terr[v] === FSC.TERR.WATER) seeds.push(v);
      return FSMap.distField(map, seeds, 6);
    })();

    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
    const V = FSC.VIS;
    quality = detectQuality();
    scene = new THREE.Scene();
    /* ===== PHASE-V: a warm, lush grade. The fog colour is the sky's HORIZON
     * colour, so distance dissolves into the dome instead of into a flat wall,
     * and the dome itself is drawn behind everything with fog switched off. */
    scene.background = new THREE.Color(V.SKY_MID);
    scene.fog = new THREE.Fog(V.FOG_COL, V.FOG_NEAR, V.FOG_FAR);

    /* The gradient dome is a screen-sized fill even after the depth-reject
     * trick, so a software rasteriser gets the flat clear colour instead — it
     * still reads as sky under the fog, at a fraction of the cost. */
    if (quality >= 0.6) {
      skyMesh = FSModels.skyDome(Math.max(700, (map.W + map.H) * FSC.TILE * 1.6));
      scene.add(skyMesh);
    }

    hemiLight = new THREE.HemisphereLight(V.HEMI_SKY, V.HEMI_GND, V.HEMI_I);
    scene.add(hemiLight);
    sunLight = new THREE.DirectionalLight(V.SUN_COL, V.SUN_I);
    sunLight.position.set(0.55, 1.0, 0.35).multiplyScalar(100);
    scene.add(sunLight);
    // a cool bounce from the opposite side so shaded faces read blue-grey, not mud
    fillLight = new THREE.DirectionalLight(V.FILL_COL, V.FILL_I);
    fillLight.position.set(-0.6, 0.45, -0.55).multiplyScalar(100);
    scene.add(fillLight);

    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const t0 = now();
    buildTerrain();
    stats.terrainMs = now() - t0;
    buildWater();
    buildObjects();
    buildDecor();                       /* ===== PHASE-V: the meadow layer ===== */
    buildWaterFX();                     /* ===== PHASE-V: surf + glints ===== */
    stats.worldMs = now() - t0;

    bldGroup = new THREE.Group(); bldGroup.name = "buildings";
    scene.add(bldGroup);
    FSRender.refreshBuildings();
    scanSigns();                        /* ===== PHASE-C: signs on a loaded save ===== */
    /* ===== PHASE-D: a new world starts with no borders drawn and no backlog
     * of duel sparks from the last one ===== */
    mil.gen = -1; mil.stakes = []; mil.flashes.length = 0; mil.evT = G.tick;
    initDynamic();                      /* ===== PHASE-B: flags/roads/serfs ===== */

    hoverRing = FSModels.ring();
    hoverRing.visible = false;
    scene.add(hoverRing);

    camera = new THREE.PerspectiveCamera(CAM.FOV, 1, CAM.NEAR, CAM.FAR);
    cam.dist = CAM.DIST_START; cam.pitch = CAM.PITCH_START; cam.yaw = 0.55;
    const home = (G.players[0] && G.buildings[G.players[0].castleId]) ? G.buildings[G.players[0].castleId].v
      : ((map.W * map.H) >> 1);
    FSRender.focusVertex(home);
    FSRender.resize();

    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    /* every OTHER listener in this block is stored on FSRender so dispose()
     * (which runs at the top of every init(), i.e. on every New Game) can take
     * it back off the shared, long-lived <canvas>. This one used to be an
     * anonymous closure with no reference — one extra retained listener per
     * game started in a single tab session, forever. */
    canvas.addEventListener("contextmenu", FSRender._cm = (e) => e.preventDefault());
    window.addEventListener("keydown", FSRender._kd = (e) => onKey(e, true));
    window.addEventListener("keyup", FSRender._ku = (e) => onKey(e, false));
    window.addEventListener("resize", FSRender._rs = () => FSRender.resize());
    window.addEventListener("blur", FSRender._bl = () => { for (const k in keys) keys[k] = false; drag = null; });
    return FSRender;
  };

  /* ===================================================================== */
  /* ===== PHASE-M: full visual rebuild from a freshly loaded G ============ */
  /* ===================================================================== */
  /**
   * FSRender.rebuildAll(g) — swap the whole world for a loaded/received G
   * (co-op join, desync resync, Phase E save slots). Composes the existing
   * build paths through init(), which disposes every geometry/material/pool of
   * the old world first, then puts the camera back where the player left it.
   * Returns false when nothing has ever been initialised (nothing to rebuild).
   */
  FSRender.rebuildAll = function (g) {
    if (!canvas || !g) return false;
    const keep = { tx: cam.tx, tz: cam.tz, yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist };
    const tint = mil.tint;
    FSRender.init(canvas, g);
    mil.tint = tint;
    FSRender.setCam(keep);
    repaintTerrain();
    return true;
  };

  FSRender.resize = function () {
    if (!renderer || !canvas) return;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h);          // updateStyle stays default (true) — house gotcha
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };

  /** One render step. Returns live stats. */
  FSRender.frame = function (dt) {
    if (!renderer || !scene) return stats;
    dt = Math.min(0.1, dt || 0.016);
    tickCamera(dt);
    syncDynamic(dt);                    /* ===== PHASE-B: flags/roads/serfs ===== */
    if (hoverPend) { FSRender.setHover(FSRender.pickVertex(hoverPend.x, hoverPend.y)); hoverPend = null; }
    if (dirtyPos) { posAttr.needsUpdate = true; terrainMesh.geometry.computeVertexNormals(); dirtyPos = false; }
    if (dirtyCol) { colAttr.needsUpdate = true; dirtyCol = false; }
    tAccum += dt;
    if (waterMesh) {
      if (waterMesh.material.map) {
        waterMesh.material.map.offset.x = (tAccum * 0.01) % 1;
        waterMesh.material.map.offset.y = (tAccum * 0.006) % 1;
      }
    }
    /* ===== PHASE-V: the shimmer sheet scrolls the other way and breathes on a
     * sine, so the two layers interfere and the surface never reads as a
     * repeating tile sliding past. ===== */
    if (shimmerMesh) {
      const V = FSC.VIS;
      const m = shimmerMesh.material;
      if (m.map) {
        m.map.offset.x = (-tAccum * V.SHIMMER_SPEED) % 1;
        m.map.offset.y = (tAccum * V.SHIMMER_SPEED * 0.55 + Math.sin(tAccum * 0.35) * 0.02) % 1;
      }
      m.opacity = V.SHIMMER_OP * (0.72 + 0.28 * Math.sin(tAccum * 0.55));
      shimmerMesh.position.y = FSC.WATER_Y + 0.035 + Math.sin(tAccum * 0.7 + 0.6) * 0.03;
    }
    if (skyMesh) skyMesh.position.set(camera.position.x, 0, camera.position.z);
    animDecor(dt);                      /* ===== PHASE-V: the breeze ===== */
    animWaterFX(dt);                    /* ===== PHASE-V: surf + glints ===== */
    if (window.FSFX) window.FSFX.frame(dt, G);   /* ===== PHASE-V: ambient life ===== */
    /* ===== PHASE F: a gentle pulse on the persistent selection ring — the
     * static ring read as inert; a slow scale+opacity breathe makes it clear
     * something is actively selected without being distracting. ===== */
    if (selectRing && selectRing.visible) {
      const p = 1 + Math.sin(tAccum * 3.2) * 0.08;
      selectRing.scale.set(p, 1, p);
      selectRing.material.opacity = 0.65 + Math.sin(tAccum * 3.2) * 0.20;
    }
    renderer.render(scene, camera);
    stats.frames++;
    stats.drawCalls = renderer.info.render.calls;
    stats.tris = renderer.info.render.triangles;
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) { stats.fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    return stats;
  };

  FSRender.stats = function () { return stats; };
  FSRender.scene = function () { return scene; };
  FSRender.camera = function () { return camera; };
  FSRender.renderer = function () { return renderer; };
  /* how many ground objects the MAP currently has. PHASE P leases a slot for a
   * third of a second after an object is removed so it can topple/shrink out
   * instead of blinking away — those leased slots are already gone as far as
   * the world is concerned, so they are discounted here. */
  FSRender.objectCount = function () {
    let n = 0;
    for (const k in pools) n += pools[k].top - pools[k].free.length;
    return n - objFade.length;
  };
  FSRender.poolInfo = function () {
    const out = {};
    for (const k in pools) out[k] = { cap: pools[k].cap, top: pools[k].top, free: pools[k].free.length };
    return out;
  };

  FSRender.dispose = function () {
    if (!scene) return;
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    if (FSRender._cm) canvas.removeEventListener("contextmenu", FSRender._cm);
    if (FSRender._kd) window.removeEventListener("keydown", FSRender._kd);
    if (FSRender._ku) window.removeEventListener("keyup", FSRender._ku);
    if (FSRender._rs) window.removeEventListener("resize", FSRender._rs);
    if (FSRender._bl) window.removeEventListener("blur", FSRender._bl);
    disposeDynamic();                   /* ===== PHASE-B: flags/roads/serfs ===== */
    if (window.FSFX) window.FSFX.dispose();   /* ===== PHASE-V ===== */
    disposeDecor();                     /* ===== PHASE-V: the meadow layer ===== */
    bldViews.forEach((v) => disposeTree(v));
    bldViews.clear();
    for (const k in pools) { objGroup.remove(pools[k].mesh); pools[k].mesh.dispose(); delete pools[k]; }
    vertSlot.clear();
    claimed.clear(); claimSig = "";
    if (terrainMesh) { terrainMesh.geometry.dispose(); terrainMesh.material.dispose(); }
    if (waterMesh) { waterMesh.geometry.dispose(); waterMesh.material.dispose(); }
    if (shimmerMesh) { scene.remove(shimmerMesh); shimmerMesh.geometry.dispose(); shimmerMesh.material.dispose(); shimmerMesh = null; }
    if (skyMesh) { scene.remove(skyMesh); skyMesh.geometry.dispose(); skyMesh.material.dispose(); skyMesh = null; }
    if (foamMesh) { scene.remove(foamMesh); foamMesh.dispose(); foamMesh = null; foamV = null; }
    if (sparkMesh) { scene.remove(sparkMesh); sparkMesh.dispose(); sparkMesh = null; sparkV = null; }
    if (hoverRing) { hoverRing.geometry.dispose(); hoverRing.material.dispose(); }
    /* ===== PHASE-E: selection ring / ghost / road preview / suitability ===== */
    if (selectRing) { selectRing.geometry.dispose(); selectRing.material.dispose(); selectRing = null; }
    if (ghostMesh) { ghostMesh.geometry.dispose(); ghostMesh.material.dispose(); ghostMesh = null; }
    if (roadPrevGroup) { roadPrevGroup.geometry.dispose(); roadPrevGroup.material.dispose(); roadPrevGroup = null; }
    if (suitMesh) { suitMesh.geometry.dispose(); suitMesh.material.dispose(); suitMesh = null; }
    suitOn = false; suitDirty = false;
    scene = null; terrainMesh = null; waterMesh = null; hoverRing = null; objGroup = null; bldGroup = null;
    for (const k in keys) delete keys[k];
    drag = null; hoverV = -1; selVertex = -1;
  };

  /* ===================================================================== */
  /* ===== PHASE-E: selection ring, placement ghost, road preview, ======== */
  /* ===== congestion glow, build-suitability overlay ====================== */
  /* (all ADDED functions — nothing above this block is rewritten) ========= */
  /* ===================================================================== */

  // ---- persistent selection ring: distinct from the transient hover ring,
  // stays put on whatever flag/building the context panel currently shows ----
  let selectRing = null, selVertex = -1;
  FSRender.setSelection = function (v) {
    selVertex = v === undefined ? -1 : v;
    if (!scene) return;
    if (!selectRing) {
      selectRing = FSModels.ring(0xfff2b0, 0.66, 0.92);
      selectRing.renderOrder = 9;
      scene.add(selectRing);
    }
    if (selVertex < 0) { selectRing.visible = false; return; }
    FSMap.worldXZ(map, selVertex, xz);
    selectRing.position.set(xz[0], map.height[selVertex] + 0.09, xz[1]);
    selectRing.visible = true;
  };
  FSRender.selectionVertex = function () { return selVertex; };

  // ---- placement ghost: a flat disc sized to the footprint, green/red for
  // whether FSMap says the hovered vertex is a legal spot right now ----------
  let ghostMesh = null;
  const FOOTPRINT_R = { flag: 0.5, small: 1.05, large: 2.35, mine: 1.05 };
  function ensureGhost() {
    if (ghostMesh) return ghostMesh;
    const geo = new THREE.CircleGeometry(1, 28);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({
      color: 0x6fd67a, transparent: true, opacity: 0.42, depthTest: false, side: THREE.DoubleSide,
    });
    ghostMesh = new THREE.Mesh(geo, m);
    ghostMesh.renderOrder = 7;
    ghostMesh.visible = false;
    scene.add(ghostMesh);
    return ghostMesh;
  }
  FSRender.setPlacementGhost = function (v, valid, footprint) {
    if (!scene) return;
    const g = ensureGhost();
    if (v === undefined || v < 0) { g.visible = false; return; }
    FSMap.worldXZ(map, v, xz);
    const r = FOOTPRINT_R[footprint] || FOOTPRINT_R.flag;
    g.scale.set(r, 1, r);
    g.position.set(xz[0], map.height[v] + 0.1, xz[1]);
    g.material.color.set(valid ? 0x6fd67a : 0xe2564a);
    g.visible = true;
  };
  FSRender.clearPlacementGhost = function () { if (ghostMesh) ghostMesh.visible = false; };

  // ---- road preview: a chain of small discs along a candidate path, one
  // shared colour for the whole preview (green = fully legal, red = not) -----
  let roadPrevGroup = null;
  function ensureRoadPrevPool() {
    if (roadPrevGroup) return roadPrevGroup;
    const geo = new THREE.CircleGeometry(1, 12);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({
      color: 0x6fd67a, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geo, m, 64);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = 7;
    scene.add(mesh);
    roadPrevGroup = mesh;
    return mesh;
  }
  FSRender.setRoadPreview = function (path, valid) {
    if (!scene) return;
    const mesh = ensureRoadPrevPool();
    if (!path || path.length < 2) { mesh.count = 0; mesh.instanceMatrix.needsUpdate = true; return; }
    const n = Math.min(path.length, 64);
    mesh.material.color.set(valid ? 0x6fd67a : 0xe2564a);
    for (let i = 0; i < n; i++) {
      const v = path[i];
      FSMap.worldXZ(map, v, xz);
      tmpV.set(xz[0], map.height[v] + 0.12, xz[1]);
      tmpQ.identity();
      const s = (i === 0 || i === n - 1) ? 0.32 : 0.18;
      tmpS.set(s, 1, s);
      mesh.setMatrixAt(i, tmpM.compose(tmpV, tmpQ, tmpS));
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  };
  FSRender.clearRoadPreview = function () {
    if (roadPrevGroup) { roadPrevGroup.count = 0; roadPrevGroup.instanceMatrix.needsUpdate = true; }
  };

  // ---- congestion glow: flags carrying ≥ FSC.CONGEST_GLOW_MIN queued goods
  // pulse gently — one instanced ring pool, populated fresh every frame just
  // like the sign posts / smoke puffs above it. ------------------------------
  let congestGeo = null;
  function congestionGlowGeo() {
    if (!congestGeo) { congestGeo = new THREE.RingGeometry(0.6, 0.92, 20); congestGeo.rotateX(-Math.PI / 2); }
    return congestGeo;
  }
  function syncCongestion(dt) {
    if (!dyn.group || !G) return;
    const pool = dynPool("congestGlow", congestionGlowGeo(), FSModels.vcMat("congestGlow", 0xffcf4d, 0.65));
    const pulse = 0.55 + Math.sin(dyn.tAcc * 3.4) * 0.35;
    for (const id in G.flags) {
      const f = G.flags[id];
      if (f.slots.length < FSC.CONGEST_GLOW_MIN) continue;
      FSMap.worldXZ(map, f.v, xz);
      tmpV.set(xz[0], map.height[f.v] + 0.06, xz[1]);
      tmpE.set(0, dyn.tAcc * 0.6, 0); tmpQ.setFromEuler(tmpE);
      const s = 1 + pulse * 0.22;
      tmpS.set(s, 1, s);
      dynPush(pool, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.set(0xffcf4d).multiplyScalar(0.72 + pulse * 0.5));
    }
  }
  /** Which of the player's flags are currently glowing (Phase-E idle-alerts/tests). */
  FSRender.congestedFlags = function () {
    const out = [];
    if (!G) return out;
    for (const id in G.flags) if (G.flags[id].slots.length >= FSC.CONGEST_GLOW_MIN) out.push(G.flags[id].id);
    return out;
  };

  // ---- build-suitability overlay: tint your own land by what fits there ----
  let suitOn = false, suitDirty = false, suitFilter = null, suitP = 0, suitMesh = null, suitT = 0;
  const SUIT_COLOR = { small: 0x8fe07a, large: 0x5ec9ff, mine: 0xe0a13d, flag: 0xd8cd6a, none: 0xaa5a56 };
  function classifyVertex(v, p, filterType) {
    if (map.owner[v] !== p) return null;
    if (filterType) return FSMap.whyBuilding(map, filterType, v, p) ? null : "small";  // filtered = one colour, "it fits"
    if (map.terr[v] === FSC.TERR.MOUNTAIN) {
      if (!FSMap.canPlaceBuilding("stoneMine", v, p)) return FSMap.canPlaceFlag(v, p) ? "flag" : "none";
      return "mine";
    }
    if (FSMap.canPlaceBuilding("sawmill", v, p)) return "large";
    if (FSMap.canPlaceBuilding("lumberjack", v, p)) return "small";
    if (FSMap.canPlaceFlag(v, p)) return "flag";
    return "none";
  }
  function disposeSuitMesh() {
    if (suitMesh) { scene.remove(suitMesh); suitMesh.geometry.dispose(); suitMesh.material.dispose(); suitMesh = null; }
  }
  function rebuildSuitability() {
    suitDirty = false;
    disposeSuitMesh();
    if (!scene) return;
    const N = map.W * map.H;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const kindOf = new Uint8Array(N);   // 0 = not painted; 1 small 2 large 3 mine 4 flag 5 none
    const KIND_COL = { 1: SUIT_COLOR.small, 2: SUIT_COLOR.large, 3: SUIT_COLOR.mine, 4: SUIT_COLOR.flag, 5: SUIT_COLOR.none };
    const c = new THREE.Color();
    let any = false;
    for (let v = 0; v < N; v++) {
      let k = 0;
      if (map.owner[v] === suitP) {
        const kind = classifyVertex(v, suitP, suitFilter);
        k = kind === "small" ? 1 : kind === "large" ? 2 : kind === "mine" ? 3 : kind === "flag" ? 4 : (kind === "none" ? 5 : 0);
      }
      kindOf[v] = k;
      if (k) any = true;
      FSMap.worldXZ(map, v, xz);
      pos[v * 3] = xz[0]; pos[v * 3 + 1] = map.height[v] + 0.05; pos[v * 3 + 2] = xz[1];
      c.set(k ? KIND_COL[k] : 0x000000);
      col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
    }
    if (!any) return;
    const idx = [];
    for (let v = 0; v < N; v++) {
      const e = FSMap.nbr(map, v, 0), se = FSMap.nbr(map, v, 4), sw = FSMap.nbr(map, v, 5);
      if (e >= 0 && se >= 0 && (kindOf[v] || kindOf[e] || kindOf[se])) idx.push(v, se, e);
      if (sw >= 0 && se >= 0 && (kindOf[v] || kindOf[sw] || kindOf[se])) idx.push(v, sw, se);
    }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide,
    });
    suitMesh = new THREE.Mesh(geo, m);
    suitMesh.renderOrder = 3;
    suitMesh.name = "suitability";
    scene.add(suitMesh);
  }
  function syncSuitabilityUpkeep(dt) {
    if (!suitOn) return;
    suitT += dt;
    if (suitDirty && suitT > 0.6) { suitT = 0; rebuildSuitability(); }
  }
  /**
   * FSRender.overlaySuitability(on, opts) — opts: {p, type}. `type` filters
   * to ONE building type (used while a build-panel item is armed — "does THIS
   * fit here?"); omitted shows the full 5-colour legend (large/small/mine/
   * flag-only/none) over the player's own land. Cheap: only classifies
   * OWNED vertices, and a full rebuild only happens on toggle + a throttled
   * upkeep pass while something nearby changed (see refreshArea above).
   */
  FSRender.overlaySuitability = function (on, opts) {
    opts = opts || {};
    suitOn = !!on;
    suitFilter = opts.type || null;
    suitP = opts.p === undefined ? 0 : opts.p;
    if (!scene) return suitOn;
    if (!suitOn) { disposeSuitMesh(); return false; }
    rebuildSuitability();
    return true;
  };
  FSRender.suitabilityOn = function () { return suitOn; };
  FSRender.suitabilityAt = function (v) {
    return suitOn ? classifyVertex(v, suitP, suitFilter) : null;
  };

  // ---- camera invert (Settings panel) ---------------------------------------
  FSRender.setInvertY = function (on) { invertY = !!on; return invertY; };
  FSRender.invertY = function () { return invertY; };

  window.FSRender = FSRender;
})();
