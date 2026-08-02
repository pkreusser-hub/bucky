/* sprite-world.js — FROZEN SNAPSHOT of Farmstead's world render layer.
 *
 * Extracted 2026-08-01 from assets/farmstead/fs-render.js + fs-models.js at the
 * commit in the working tree that day. This file is a *copy*: the sprite demo
 * must never runtime-import the live modules (another agent is editing them).
 *
 * What is reproduced verbatim (values + math):
 *   - the lighting rig            (FSC.VIS HEMI/SUN/FILL + positions)
 *   - the fog + sky background    (FSC.VIS FOG_COL/NEAR/FAR + SKY_MID)
 *   - terrainColor()              (per-vertex grade: strata, beach, slope, patch noise)
 *   - buildTerrain()              (lattice -> vertex-coloured Lambert + blade-noise map)
 *   - groundTex()                 (the blade sheet)
 *   - the house emissive lift     (FSModels.mat / FSC.EMISSIVE_LIFT)
 *   - the camera rig              (FSC.CAM: FOV/near/far, pitch+dist clamps, orbit/pan/zoom)
 *
 * What is simplified (this is a viability demo, not the game):
 *   - water is one flat plane, no shimmer/foam/skirt
 *   - no roads, buildings, decor, tufts, flowers, boats
 */
(function () {
  "use strict";
  const FSC = window.FSC, FSMap = window.FSMap, COL = FSC.COL, CAM = FSC.CAM;
  const W = {};
  window.SpriteWorld = W;

  const CACHE = {};
  const tmpC = new THREE.Color(), blendC = new THREE.Color();
  const xz = [0, 0];
  let map = null, waterDist = null;

  // ---------------------------------------------------------------- helpers
  function hash01(v, salt) {
    let a = (Math.imul(v ^ (salt || 0), 2246822519) ^ 0x9e3779b9) >>> 0;
    a = Math.imul(a ^ (a >>> 15), 2654435761) >>> 0;
    return (a >>> 8) / 16777216;
  }
  function jr(seed) {
    let a = (seed * 2654435761) >>> 0;
    return function () { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  }
  /* house rule: unlit faces never render black (FSC.EMISSIVE_LIFT = 0.3) */
  function lift(hex, k) {
    const c = new THREE.Color(hex);
    c.multiplyScalar(k === undefined ? FSC.EMISSIVE_LIFT : k);
    return c;
  }
  function mat(color, opts) {
    opts = opts || {};
    const props = {
      color: color === undefined ? 0xffffff : color,
      emissive: lift(opts.emissiveOf !== undefined ? opts.emissiveOf
        : (color === undefined ? 0x808080 : color), opts.emissiveK),
    };
    for (const k in opts) { if (k === "emissiveK" || k === "emissiveOf") continue; props[k] = opts[k]; }
    return new THREE.MeshLambertMaterial(props);
  }
  W.mat = mat; W.lift = lift;

  function canvasTex(key, w, h, draw, repeat) {
    if (CACHE[key]) return CACHE[key];
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    draw(cv.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(cv);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
    t.anisotropy = 2;
    CACHE[key] = t;
    return t;
  }

  /* the blade sheet — verbatim from FSModels.groundTex */
  function groundTex() {
    const V = FSC.VIS, P = V.GROUND_TEX_PX;
    return canvasTex("tex:ground", P, P, (g) => {
      const rnd = jr(1337);
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, P, P);
      for (let i = 0; i < 70; i++) {
        const x = rnd() * P, y = rnd() * P, r = P * (0.04 + rnd() * 0.14);
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        const dark = rnd() < 0.5;
        grd.addColorStop(0, dark ? "rgba(104,110,86,0.26)" : "rgba(255,255,255,0.28)");
        grd.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
      }
      g.lineCap = "round";
      for (let i = 0; i < V.GROUND_BLADES; i++) {
        const x = rnd() * P, y = rnd() * P;
        const L = P * (0.008 + rnd() * 0.022), a = -Math.PI / 2 + (rnd() - 0.5) * 1.5;
        const light = rnd() < 0.45;
        g.strokeStyle = light ? "rgba(255,255,255," + (0.20 + rnd() * 0.32).toFixed(3) + ")"
          : "rgba(56,60,44," + (0.12 + rnd() * 0.24).toFixed(3) + ")";
        g.lineWidth = 1 + rnd() * 1.6;
        for (let wx = -1; wx <= 1; wx++) for (let wy = -1; wy <= 1; wy++) {
          const px = x + wx * P, py = y + wy * P;
          if (px < -P * 0.1 || px > P * 1.1 || py < -P * 0.1 || py > P * 1.1) continue;
          g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L); g.stroke();
        }
      }
    }, 1);
  }
  W.groundTex = groundTex;

  function patchNoise(x, z) {
    const V = FSC.VIS;
    return Math.sin(x * V.PATCH_FA + z * V.PATCH_FA * 0.63) * Math.cos(z * V.PATCH_FA * 1.31 - x * 0.017) * V.PATCH_A
      + Math.sin(x * V.PATCH_FB * 1.7 - z * V.PATCH_FB) * V.PATCH_B;
  }

  /* verbatim from fs-render.terrainColor (minus the territory tint) */
  function terrainColor(v, out) {
    const V = FSC.VIS, T = FSC.TERR;
    const t = map.terr[v], h = map.height[v];
    FSMap.worldXZ(map, v, xz);
    out.set(COL.TERR[t]);
    let dh = 0, dn = 0;
    for (let d = 0; d < 6; d++) { const u = FSMap.nbr(map, v, d); if (u >= 0) { dh += Math.abs(map.height[u] - h); dn++; } }
    if (dn) dh /= dn;
    const wd = waterDist ? waterDist[v] : 9;
    if (t === T.WATER) {
      blendC.set(COL.BEACH);
      const k = Math.max(0, Math.min(1, (h + 2.2) / 2.2));
      out.lerp(blendC, k * 0.62);
    } else {
      if (t === T.MOUNTAIN) {
        const k = Math.max(0, Math.min(1, (h - FSC.GEN.MOUNTAIN_Y) / Math.max(0.1, FSC.GEN.SNOW_Y - FSC.GEN.MOUNTAIN_Y)));
        blendC.set(COL.TERR[1]);
        out.lerp(blendC, Math.max(0, 0.34 - k * 1.7));
        const strata = Math.sin(h * 1.35 + hash01(v, 29) * 0.9) * 0.5 + 0.5;
        blendC.set(V.ROCK_WARM); out.lerp(blendC, strata * 0.30);
        blendC.set(V.ROCK_COOL); out.lerp(blendC, (1 - strata) * 0.22);
        blendC.set(V.ROCK_STEEP);
        out.lerp(blendC, Math.max(0, Math.min(0.62, (dh - 0.28) * 0.55)));
        blendC.set(COL.TERR[5]); out.lerp(blendC, Math.max(0, k - 0.62) * 1.6);
      } else if (t === T.SNOW) {
        blendC.set(V.SNOW_SHADE);
        out.lerp(blendC, Math.max(0, Math.min(0.5, (dh - 0.25) * 0.5)));
      } else if (t === T.GRASS) {
        blendC.set(COL.GRASS_DRY);
        out.lerp(blendC, Math.max(0, Math.min(0.52, h / (FSC.GEN.PLAIN_H * 1.6))));
        const p = patchNoise(xz[0], xz[1]);
        blendC.set(p > 0 ? V.GRASS_DEEP : COL.GRASS_DRY);
        out.lerp(blendC, Math.min(0.34, Math.abs(p) * 2.6));
      } else if (t === T.SWAMP) {
        blendC.set(V.SWAMP_WET);
        out.lerp(blendC, 0.18 + Math.max(0, 0.30 - dh * 0.6));
      } else if (t === T.DESERT) {
        const p = patchNoise(xz[0] * 1.4, xz[1] * 1.4);
        blendC.set(COL.BEACH);
        out.lerp(blendC, 0.18 + Math.min(0.24, Math.abs(p) * 2.0));
      }
      if (wd <= 2) { blendC.set(COL.BEACH); out.lerp(blendC, wd === 1 ? 0.72 : 0.30); }
    }
    const rocky = (t === T.MOUNTAIN || t === T.SNOW) ? 1.9 : 1;
    const shade = 1 - Math.min(0.28, dh * 0.14) + (hash01(v, 7) - 0.5) * 0.09 * rocky;
    out.multiplyScalar(shade);
    return out;
  }

  // --------------------------------------------------------------- the world
  W.build = function (scene, m) {
    map = m;
    waterDist = (function () {
      const seeds = [];
      for (let v = 0; v < map.W * map.H; v++) if (map.terr[v] === FSC.TERR.WATER) seeds.push(v);
      return FSMap.distField(map, seeds, 6);
    })();

    const V = FSC.VIS;
    scene.background = new THREE.Color(V.SKY_MID);
    scene.fog = new THREE.Fog(V.FOG_COL, V.FOG_NEAR, V.FOG_FAR);

    const hemi = new THREE.HemisphereLight(V.HEMI_SKY, V.HEMI_GND, V.HEMI_I);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(V.SUN_COL, V.SUN_I);
    sun.position.set(0.55, 1.0, 0.35).multiplyScalar(100);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(V.FILL_COL, V.FILL_I);
    fill.position.set(-0.6, 0.45, -0.55).multiplyScalar(100);
    scene.add(fill);
    W.lights = { hemi, sun, fill };
    /* unit-length world-space directions — the sprite bake and the runtime
     * facing-tint both need the same key direction the terrain is shaded by */
    W.sunDir = sun.position.clone().normalize();
    W.fillDir = fill.position.clone().normalize();

    // ---- terrain (verbatim buildTerrain) ----
    const MW = map.W, MH = map.H, N = MW * MH;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), uv = new Float32Array(N * 2);
    const uvK = 1 / V.GROUND_TEX_UV;
    for (let v = 0; v < N; v++) {
      FSMap.worldXZ(map, v, xz);
      pos[v * 3] = xz[0]; pos[v * 3 + 1] = map.height[v]; pos[v * 3 + 2] = xz[1];
      uv[v * 2] = xz[0] * uvK; uv[v * 2 + 1] = xz[1] * uvK;
      terrainColor(v, tmpC);
      col[v * 3] = tmpC.r; col[v * 3 + 1] = tmpC.g; col[v * 3 + 2] = tmpC.b;
    }
    const idx = new (N > 65000 ? Uint32Array : Uint16Array)((MW - 1) * (MH - 1) * 6);
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
    const tm = mat(0xffffff, {
      vertexColors: true, map: groundTex(),
      emissiveOf: 0x6d8b5c, emissiveK: V.TERR_EMISSIVE_K,
    });
    const terrain = new THREE.Mesh(geo, tm);
    terrain.name = "terrain";
    scene.add(terrain);
    W.terrain = terrain;

    // ---- water: one flat plane (the game's is richer; irrelevant here) ----
    const w = MW * FSC.TILE, d = MH * FSC.TILE * FSC.ROW_Z;
    const wgeo = new THREE.PlaneGeometry(w * 2.2, d * 2.2);
    wgeo.rotateX(-Math.PI / 2);
    const wmat = mat(V.WATER_DEEP, {
      transparent: true, opacity: 0.82, emissiveOf: V.WATER_SHALLOW, emissiveK: 0.22, depthWrite: true,
    });
    const water = new THREE.Mesh(wgeo, wmat);
    water.position.set(w * 0.5, FSC.WATER_Y, d * 0.5);
    water.name = "water";
    scene.add(water);
    W.water = water;
    return W;
  };

  /* smooth terrain height at an arbitrary world (x,z): inverse-square blend of
   * the 3 nearest lattice vertices, so a walking unit slides instead of stepping */
  W.heightAt = function (x, z) {
    if (!map) return 0;
    const rowH = FSC.TILE * FSC.ROW_Z;
    let r = Math.round(z / rowH);
    r = Math.max(0, Math.min(map.H - 1, r));
    // allocation-free "keep the 3 closest lattice vertices" (called per unit per frame)
    let b0 = -1, b1 = -1, b2 = -1, d0 = 1e9, d1 = 1e9, d2 = 1e9;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= map.H) continue;
      const cbase = Math.round(x / FSC.TILE - (rr & 1) * 0.5);
      const vz = rr * rowH;
      for (let dc = -1; dc <= 1; dc++) {
        const cc = cbase + dc;
        if (cc < 0 || cc >= map.W) continue;
        const vx = (cc + (rr & 1) * 0.5) * FSC.TILE;
        const dd = (vx - x) * (vx - x) + (vz - z) * (vz - z);
        const v = rr * map.W + cc;
        if (dd < d0) { d2 = d1; b2 = b1; d1 = d0; b1 = b0; d0 = dd; b0 = v; }
        else if (dd < d1) { d2 = d1; b2 = b1; d1 = dd; b1 = v; }
        else if (dd < d2) { d2 = dd; b2 = v; }
      }
    }
    if (b0 < 0) return 0;
    let sw = 0, sy = 0;
    const w0 = 1 / (d0 + 1e-4); sw += w0; sy += w0 * map.height[b0];
    if (b1 >= 0) { const w1 = 1 / (d1 + 1e-4); sw += w1; sy += w1 * map.height[b1]; }
    if (b2 >= 0) { const w2 = 1 / (d2 + 1e-4); sw += w2; sy += w2 * map.height[b2]; }
    return sy / sw;
  };
  W.terrAt = function (x, z) {
    if (!map) return FSC.TERR.GRASS;
    const rowH = FSC.TILE * FSC.ROW_Z;
    const r = Math.max(0, Math.min(map.H - 1, Math.round(z / rowH)));
    const c = Math.max(0, Math.min(map.W - 1, Math.round(x / FSC.TILE - (r & 1) * 0.5)));
    return map.terr[r * map.W + c];
  };

  // ---------------------------------------------------------------- camera
  /* the same rig as fs-render: perspective FOV 52, yaw+pitch orbit around a
   * ground target, dist zoom, screen-relative pan. Clamps from FSC.CAM. */
  W.makeCamera = function (canvas) {
    const camera = new THREE.PerspectiveCamera(CAM.FOV, 1, CAM.NEAR, CAM.FAR);
    const cam = { tx: 0, tz: 0, ty: 0, dist: CAM.DIST_START, yaw: 0.55, pitch: CAM.PITCH_START };
    function apply() {
      const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      camera.position.set(
        cam.tx + Math.sin(cam.yaw) * cp * cam.dist,
        cam.ty + sp * cam.dist,
        cam.tz + Math.cos(cam.yaw) * cp * cam.dist);
      camera.lookAt(cam.tx, cam.ty, cam.tz);
      camera.updateMatrixWorld();
    }
    let drag = null;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      drag = { mode: (e.button === 2 || e.shiftKey) ? "pan" : "orbit", x: e.clientX, y: e.clientY };
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    });
    window.addEventListener("pointerup", () => { drag = null; });
    window.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.mode === "orbit") {
        cam.yaw += dx * CAM.ORBIT_YAW;
        cam.pitch = Math.max(CAM.PITCH_MIN, Math.min(CAM.PITCH_MAX, cam.pitch + dy * CAM.ORBIT_PITCH));
      } else {
        const k = cam.dist * CAM.DRAG_PAN;
        const s = Math.sin(cam.yaw), c = Math.cos(cam.yaw);
        cam.tx -= (dx * c - dy * -s) * k;
        cam.tz -= (dx * -s - dy * -c) * k;
      }
      apply();
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      cam.dist = Math.max(CAM.DIST_MIN, Math.min(CAM.DIST_MAX, cam.dist * (1 + e.deltaY * CAM.ZOOM_RATE)));
      apply();
    }, { passive: false });
    apply();
    return { camera, cam, apply };
  };
})();
