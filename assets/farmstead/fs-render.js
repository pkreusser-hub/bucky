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
  const pools = {};                 // kind -> { mesh, cap, top, free[] }
  const vertSlot = new Map();       // vertex -> { key, idx }
  const bldViews = new Map();       // building id -> Object3D
  let hoverV = -1, hoverPend = null;
  const keys = Object.create(null);
  let drag = null;                  // { mode:'pan'|'orbit', x, y, id }
  const cam = { tx: 0, tz: 0, ty: 0, dist: CAM.DIST_START, yaw: 0.6, pitch: CAM.PITCH_START };
  const stats = { fps: 0, drawCalls: 0, tris: 0, frames: 0, ms: 0 };
  let fpsAcc = 0, fpsFrames = 0, tAccum = 0;
  const ray = new THREE.Raycaster();
  const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3(), tmpC = new THREE.Color(), tmpE = new THREE.Euler();
  const blendC = new THREE.Color();   // lerp target — MUST NOT alias the `out` colour
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const xz = [0, 0];

  function hash01(v, salt) {
    let a = (Math.imul(v ^ (salt || 0), 2246822519) ^ 0x9e3779b9) >>> 0;
    a = Math.imul(a ^ (a >>> 15), 2654435761) >>> 0;
    return (a >>> 8) / 16777216;
  }

  // ------------------------------------------------------------------- terrain
  function terrainColor(v, out) {
    const t = map.terr[v], h = map.height[v];
    out.set(COL.TERR[t]);
    if (t === FSC.TERR.WATER) {
      // lake bed: shallow sand fading to deep blue-grey
      blendC.set(COL.BEACH);
      const k = Math.max(0, Math.min(1, (h + 2.2) / 2.2));
      out.lerp(blendC, k * 0.55);
    } else {
      if (t === FSC.TERR.MOUNTAIN) {
        // bare rock low down, a dusting of snow only near the peaks
        const k = Math.max(0, Math.min(1, (h - FSC.GEN.MOUNTAIN_Y) / Math.max(0.1, FSC.GEN.SNOW_Y - FSC.GEN.MOUNTAIN_Y)));
        blendC.set(COL.TERR[5]); out.lerp(blendC, Math.max(0, k - 0.5) * 0.7);
      } else if (t === FSC.TERR.GRASS) {
        // meadows dry out as they climb, so big pastures never read as one flat green
        blendC.set(COL.GRASS_DRY);
        out.lerp(blendC, Math.max(0, Math.min(0.5, h / (FSC.GEN.PLAIN_H * 1.6))));
      }
      const wd = waterDist ? waterDist[v] : 9;
      if (wd <= 2) { blendC.set(COL.BEACH); out.lerp(blendC, wd === 1 ? 0.6 : 0.22); }
    }
    // slope darkening + a little per-vertex noise so big fields never read flat
    let dh = 0, dn = 0;
    for (let d = 0; d < 6; d++) { const u = FSMap.nbr(map, v, d); if (u >= 0) { dh += Math.abs(map.height[u] - h); dn++; } }
    if (dn) dh /= dn;
    const rocky = (t === FSC.TERR.MOUNTAIN || t === FSC.TERR.SNOW) ? 1.9 : 1;
    const shade = 1 - Math.min(0.26, dh * 0.13) + (hash01(v, 7) - 0.5) * 0.10 * rocky;
    out.multiplyScalar(shade);
    return out;
  }

  function buildTerrain() {
    const W = map.W, H = map.H, N = W * H;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    for (let v = 0; v < N; v++) {
      FSMap.worldXZ(map, v, xz);
      pos[v * 3] = xz[0]; pos[v * 3 + 1] = map.height[v]; pos[v * 3 + 2] = xz[1];
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
    geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, k), 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    posAttr = geo.attributes.position;
    colAttr = geo.attributes.color;
    const m = FSModels.mat(0xffffff, { vertexColors: true, emissiveOf: 0x6d8b5c, emissiveK: 0.18 });
    terrainMesh = new THREE.Mesh(geo, m);
    terrainMesh.name = "terrain";
    scene.add(terrainMesh);
  }

  function buildWater() {
    const w = map.W * FSC.TILE, d = map.H * FSC.TILE * FSC.ROW_Z;
    const geo = new THREE.PlaneGeometry(w * 1.6, d * 1.6, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const tex = FSModels.canvasTex("water", 64, 64, (g) => {
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, 64, 64);
      g.strokeStyle = "rgba(210,235,255,0.55)"; g.lineWidth = 2;
      for (let i = 0; i < 10; i++) {
        g.beginPath();
        const y = i * 6.4 + 2;
        g.moveTo(0, y);
        for (let x = 0; x <= 64; x += 8) g.lineTo(x, y + Math.sin((x + i * 9) * 0.22) * 1.6);
        g.stroke();
      }
    }, 26);
    const m = FSModels.mat(COL.WATER_SURF, {
      transparent: true, opacity: 0.82, depthWrite: false, map: tex, emissiveK: 0.26,
    });
    waterMesh = new THREE.Mesh(geo, m);
    waterMesh.position.set(w / 2, FSC.WATER_Y, d / 2);
    waterMesh.renderOrder = 2;
    waterMesh.name = "water";
    scene.add(waterMesh);
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

  function objMatrix(v, key, out) {
    FSMap.worldXZ(map, v, xz);
    const s = key.indexOf("field") === 0 ? 1 : 0.86 + hash01(v, 3) * 0.3;
    tmpV.set(xz[0], map.height[v], xz[1]);
    tmpE.set(0, hash01(v, 11) * Math.PI * 2, 0);
    tmpQ.setFromEuler(tmpE);
    tmpS.set(s, s, s);
    return out.compose(tmpV, tmpQ, tmpS);
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
      const key = FSModels.kindForObj(map.obj[v], FSMap.species(v));
      if (key) counts[key] = (counts[key] || 0) + 1;
    }
    for (const key in counts) makePool(key, counts[key] + 16 + Math.ceil(counts[key] * 0.25));
    for (let v = 0; v < N; v++) {
      const key = FSModels.kindForObj(map.obj[v], FSMap.species(v));
      if (!key) continue;
      const a = allocSlot(key);
      vertSlot.set(v, { key, idx: a.idx });
      setSlot(v, key, a.p, a.idx);
    }
  }

  /** Re-sync ONE vertex (object + terrain height/colour) — the Phase B/C hook. */
  FSRender.refreshVertex = function (v) {
    if (!scene || v < 0 || v >= map.W * map.H) return false;
    // terrain
    posAttr.setY(v, map.height[v]);
    terrainColor(v, tmpC);
    colAttr.setXYZ(v, tmpC.r, tmpC.g, tmpC.b);
    dirtyPos = true; dirtyCol = true;
    // object
    const key = FSModels.kindForObj(map.obj[v], FSMap.species(v));
    const cur = vertSlot.get(v);
    if (cur && cur.key === key) { setSlot(v, key, pools[key], cur.idx); return true; }
    if (cur) {
      const p = pools[cur.key];
      p.mesh.setMatrixAt(cur.idx, ZERO);
      p.mesh.instanceMatrix.needsUpdate = true;
      p.free.push(cur.idx);
      vertSlot.delete(v);
    }
    if (key) {
      const a = allocSlot(key);
      vertSlot.set(v, { key, idx: a.idx });
      setSlot(v, key, a.p, a.idx);
    }
    return true;
  };

  FSRender.refreshArea = function (v, r) {
    FSMap.forRadius(map, v, r === undefined ? 1 : r, (u) => FSRender.refreshVertex(u));
  };

  // ----------------------------------------------------------------- buildings
  function buildingView(b) {
    const g = b.type === "castle" ? FSModels.castle(b.p) : FSModels.placeholderBuilding(b.type, undefined, b.p);
    FSMap.worldXZ(map, b.v, xz);
    g.position.set(xz[0], map.height[b.v], xz[1]);
    g.rotation.y = Math.PI / 6;         // face the SE door flag
    g.name = "bld:" + b.id;
    return g;
  }

  /** Sync building meshes with G.buildings (Phase B calls this when sites appear). */
  FSRender.refreshBuildings = function () {
    if (!scene) return 0;
    const seen = new Set();
    for (const id in G.buildings) {
      const b = G.buildings[id];
      seen.add(b.id);
      if (!bldViews.has(b.id)) {
        const view = buildingView(b);
        bldViews.set(b.id, view);
        bldGroup.add(view);
      }
    }
    bldViews.forEach((view, id) => {
      if (seen.has(id)) return;
      bldGroup.remove(view);
      disposeTree(view);
      bldViews.delete(id);
    });
    return bldViews.size;
  };

  function disposeTree(o) {
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
        else c.material.dispose();
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
  FSRender.setCam = function (o) { Object.assign(cam, o); applyCamera(); return FSRender.camState(); };

  FSRender.focusVertex = function (v, dist) {
    if (v < 0) return;
    FSMap.worldXZ(map, v, xz);
    cam.tx = xz[0]; cam.tz = xz[1];
    cam.ty = Math.max(FSC.WATER_Y, map.height[v]);
    if (dist) cam.dist = dist;
    applyCamera();
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

  FSRender.setHover = function (v) {
    hoverV = v;
    if (!hoverRing) return;
    if (v < 0) { hoverRing.visible = false; return; }
    FSMap.worldXZ(map, v, xz);
    hoverRing.position.set(xz[0], map.height[v] + 0.07, xz[1]);
    hoverRing.visible = true;
  };
  FSRender.hoverVertex = function () { return hoverV; };

  // --------------------------------------------------------------------- input
  function onPointerDown(e) {
    if (drag) return;
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
      cam.pitch += dy * CAM.ORBIT_PITCH;
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
  function onWheel(e) {
    e.preventDefault();
    cam.dist *= Math.exp(e.deltaY * CAM.ZOOM_RATE);
    applyCamera();
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
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COL.SKY);
    scene.fog = new THREE.Fog(COL.SKY, COL.FOG_NEAR, COL.FOG_FAR);

    const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x4c5836, 0.62);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d4, 0.62);
    sun.position.set(0.55, 1.0, 0.35).multiplyScalar(100);
    scene.add(sun);

    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const t0 = now();
    buildTerrain();
    stats.terrainMs = now() - t0;
    buildWater();
    buildObjects();
    stats.worldMs = now() - t0;

    bldGroup = new THREE.Group(); bldGroup.name = "buildings";
    scene.add(bldGroup);
    FSRender.refreshBuildings();

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
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", FSRender._kd = (e) => onKey(e, true));
    window.addEventListener("keyup", FSRender._ku = (e) => onKey(e, false));
    window.addEventListener("resize", FSRender._rs = () => FSRender.resize());
    window.addEventListener("blur", FSRender._bl = () => { for (const k in keys) keys[k] = false; drag = null; });
    return FSRender;
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
    if (hoverPend) { FSRender.setHover(FSRender.pickVertex(hoverPend.x, hoverPend.y)); hoverPend = null; }
    if (dirtyPos) { posAttr.needsUpdate = true; terrainMesh.geometry.computeVertexNormals(); dirtyPos = false; }
    if (dirtyCol) { colAttr.needsUpdate = true; dirtyCol = false; }
    tAccum += dt;
    if (waterMesh) {
      waterMesh.position.y = FSC.WATER_Y + Math.sin(tAccum * 0.7) * 0.035;
      if (waterMesh.material.map) {
        waterMesh.material.map.offset.x = (tAccum * 0.01) % 1;
        waterMesh.material.map.offset.y = (tAccum * 0.006) % 1;
      }
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
  FSRender.objectCount = function () {
    let n = 0;
    for (const k in pools) n += pools[k].top - pools[k].free.length;
    return n;
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
    if (FSRender._kd) window.removeEventListener("keydown", FSRender._kd);
    if (FSRender._ku) window.removeEventListener("keyup", FSRender._ku);
    if (FSRender._rs) window.removeEventListener("resize", FSRender._rs);
    if (FSRender._bl) window.removeEventListener("blur", FSRender._bl);
    bldViews.forEach((v) => disposeTree(v));
    bldViews.clear();
    for (const k in pools) { objGroup.remove(pools[k].mesh); pools[k].mesh.dispose(); delete pools[k]; }
    vertSlot.clear();
    if (terrainMesh) { terrainMesh.geometry.dispose(); terrainMesh.material.dispose(); }
    if (waterMesh) { waterMesh.geometry.dispose(); waterMesh.material.dispose(); }
    if (hoverRing) { hoverRing.geometry.dispose(); hoverRing.material.dispose(); }
    scene = null; terrainMesh = null; waterMesh = null; hoverRing = null; objGroup = null; bldGroup = null;
    for (const k in keys) delete keys[k];
    drag = null; hoverV = -1;
  };

  window.FSRender = FSRender;
})();
