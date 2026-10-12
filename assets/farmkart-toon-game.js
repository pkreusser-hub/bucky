// Farm Kart — STORYBOOK TOON, game side (2026-10-12). Makes the cel-shaded look of
// farmkart-styles.html "Storybook Toon" THE look of farmkart.html on every track:
//   1. live toonify: every lit material that reaches the scene becomes MeshToon (3-band ramp), the
//      moment it is added (Object3D.add hook) plus a slow sweep for materials swapped at runtime.
//      The toon copy is LIVE-LINKED to its source (shared Color objects, forwarded opacity/visible/
//      maps/version), so game code that still holds the original material keeps working.
//   2. ink outlines on karts, drivers, entities (critters/cows/crows/item boxes/turrets...), trains,
//      traffic and the instanced GLB props; toon-aware light retune; real sun shadows; toon sky.
//   3. toon karts (bucky/tractor/mower) + skinned toon drivers (bucky/otis/boots) on the shared
//      21-bone rig (assets/farmkart-styles/fks-rig.js) with clip + hand-IK animation.
// Depends on: THREE r128 (global), FK_TOON (assets/farmkart-toon.js), FKS (fks-rig.js).
// Conventions match farmkart.html: kart space +Z forward, +Y up, +X = the driver's LEFT.
(function(){
  'use strict';
  const T = window.FK_TOON, FKS = window.FKS, G = FKS.geo;
  const TG = window.FK_TOON_GAME = window.FK_TOON_GAME || {};
  const V3 = (x,y,z) => new THREE.Vector3(x,y,z);
  const MOBILE = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  TG.mobile = MOBILE;
  TG.stats = { converted: 0, inked: 0, sweeps: 0 };

  // ===========================================================================================
  // 1. LIVE TOONIFY
  // ===========================================================================================
  // Properties game code mutates on the ORIGINAL material after we have swapped it out (ghost fade,
  // star/boost glows, balloon pops, muzzle flashes, tank night lifts...). The toon copy reads them
  // through to the source, so both stay one material as far as the game is concerned.
  const LIVE_KEYS = ['opacity','transparent','visible','map','emissiveMap','alphaMap','emissiveIntensity',
    'depthWrite','depthTest','alphaTest','side','colorWrite','polygonOffset','polygonOffsetFactor',
    'polygonOffsetUnits','wireframe','vertexColors','fog'];
  function link(src, t){
    if (t.userData.fkLive) return t;
    t.color = src.color;                                   // shared Color: setHex on either is seen by both
    if (src.emissive) t.emissive = src.emissive;
    for (const k of LIVE_KEYS){
      if (!(k in src)) continue;
      Object.defineProperty(t, k, { get(){ return src[k]; }, set(v){ src[k] = v; }, configurable:true, enumerable:true });
    }
    // src.needsUpdate = true (e.g. after flipping transparent / swapping a map) bumps src.version;
    // the renderer compares the TOON material's version, so fold the source's into it.
    let own = t.version;
    Object.defineProperty(t, 'version', { get(){ return own + src.version; }, set(v){ own = v - src.version; }, configurable:true });
    src.addEventListener('dispose', () => t.dispose());
    t.userData.fkLive = true;
    return t;
  }
  function convertLive(m){
    const t = T.convertMaterial(m);
    if (t !== m){ link(m, t); if (!t.userData._fkCounted){ t.userData._fkCounted = true; TG.stats.converted++; } }
    return t;
  }
  TG.convertLive = convertLive;
  // Toonify one subtree. Returns the number of meshes whose material changed.
  function toonifyLive(root){
    let n = 0;
    root.traverse(o => {
      if (!o.isMesh || !o.material || (o.userData && o.userData.noToon)) return;
      if (Array.isArray(o.material)){
        const next = o.material.map(convertLive);
        if (next.some((x,i) => x !== o.material[i])){ o.material = next; n++; }
      } else {
        const next = convertLive(o.material);
        if (next !== o.material){ o.material = next; n++; }
      }
      // every toon surface takes the sun's shadow (kart shadows land on road, grass, bridges, props)
      if (TG.shadows && !o.userData.fkOutline && !o.isSkinnedMesh) o.receiveShadow = true;
    });
    return n;
  }
  TG.toonifyLive = toonifyLive;

  // ===========================================================================================
  // 2. INK
  // ===========================================================================================
  // Outline child with its OWN geometry (lets a merged mesh skip ink on tiny parts — bolts, straps,
  // catch-lights — while the big shapes keep a clean hull).
  function inkWith(mesh, geo, t){
    const o = new THREE.Mesh(geo, T.outlineMaterial(t, null, false));
    o.userData.noToon = true; o.userData.noExport = true; o.userData.fkOutline = true;
    o.castShadow = false; o.receiveShadow = false; o.name = (mesh.name || 'mesh') + '_ink';
    mesh.add(o); mesh.userData.fkOutlined = o; TG.stats.inked++;
    return o;
  }
  function ink(mesh, t){ const o = T.outline(mesh, t); if (o) TG.stats.inked++; return o; }
  TG.ink = ink;
  // World-space radius of a mesh's geometry (instanced: largest instance scale). Used to size ink.
  const _s = V3(0,0,0), _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = V3(0,0,0);
  function worldRadius(mesh){
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    let r = mesh.geometry.boundingSphere.radius;
    mesh.updateWorldMatrix(true, false); mesh.matrixWorld.decompose(_p, _q, _s);
    r *= Math.max(Math.abs(_s.x), Math.abs(_s.y), Math.abs(_s.z));
    if (mesh.isInstancedMesh){
      let mx = 0;
      for (let i = 0; i < mesh.count; i++){ mesh.getMatrixAt(i, _m4); _m4.decompose(_p, _q, _s); mx = Math.max(mx, _s.x, _s.y, _s.z); }
      r *= mx || 1;
    }
    return r;
  }
  // Ink a whole entity/prop subtree. Thickness is in GEOMETRY space, so per-instance scale and the
  // parent's scale grow the line with the object — a calf gets a thinner line than a barn.
  // opts: { k: thickness as a fraction of the mesh's geometry radius, min/max world thickness,
  //         minR: skip meshes smaller than this (world radius), maxR: skip larger (ground-sized) }
  function inkTree(root, opts){
    opts = opts || {};
    const k = opts.k || 0.035, minW = opts.min || 0.012, maxW = opts.max || 0.09, minR = opts.minR || 0.12, maxR = opts.maxR || 1e9;
    const list = [];
    root.traverse(o => {
      if (!o.isMesh || !o.geometry || o.userData.fkOutline || o.userData.noOutline || o.userData.fkOutlined) return;
      if (o.isPoints || o.isSprite || o.isLine) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || !(m.isMeshToonMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshStandardMaterial)) return;
      if (m.transparent && m.opacity < 0.6) return;
      if (!o.geometry.attributes.normal) return;
      list.push(o);
    });
    let n = 0;
    for (const o of list){
      const wr = worldRadius(o);
      if (wr < minR || wr > maxR) continue;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const gr = o.geometry.boundingSphere.radius || 1;
      const wscale = wr / gr;                                   // geometry -> world
      const tw = Math.max(minW, Math.min(maxW, wr * k));        // wanted world thickness
      const h = ink(o, tw / Math.max(1e-4, wscale));
      if (h){ n++; if (opts.thin) h.userData.fkInkThin = true; }
    }
    return n;
  }
  TG.inkTree = inkTree;

  // ===========================================================================================
  // 3. INSTALL: renderer, add-hook, shadows, lights
  // ===========================================================================================
  let SCENE = null, RENDERER = null, HEMI = null, SUN = null;
  TG.entityInk = false;   // flipped on once the world is built: later scene-level adds are entities
  TG.install = function(scene, renderer, hemi, sun){
    SCENE = scene; RENDERER = renderer; HEMI = hemi; SUN = sun;
    TG.shadows = true;
    renderer.toneMapping = THREE.NoToneMapping;   // LinearEncoding stays (hex colours render as picked)
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    sun.castShadow = true;
    const sz = MOBILE ? 1024 : 2048;
    sun.shadow.mapSize.set(sz, sz);
    // texel = 2*half/size: desktop 56/2048 = 2.7 cm, phone 36/1024 = 3.5 cm (28 on a 1024 map read blocky)
    const sc = sun.shadow.camera, half = MOBILE ? 18 : 28;
    sc.left = sc.bottom = -half; sc.right = sc.top = half; sc.near = 1; sc.far = 220; sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
    TG.shadowHalf = half;
    scene.add(sun.target);
    // Every add anywhere toonifies the incoming subtree (track builders, async GLB props, entities,
    // item pools — nothing has to opt in). Scene-level adds after the world is built are entities
    // (critters, cows, crows, item boxes, turrets, balloons, gates) and also get ink + cast shadows.
    const _add = THREE.Object3D.prototype.add;
    THREE.Object3D.prototype.add = function(){
      const r = _add.apply(this, arguments);
      for (let i = 0; i < arguments.length; i++){
        const o = arguments[i];
        if (!o || o === this || !o.traverse) continue;
        toonifyLive(o);
        if (this === SCENE && TG.entityInk && !o.userData.fkKart && !o.userData.noOutline) decorateEntity(o);
      }
      return r;
    };
  };
  function decorateEntity(o){
    if (o.userData._fkEntity) return;
    o.userData._fkEntity = true;
    // entity-sized only: a whole tank-arena city block or a ground plane is not an entity
    inkTree(o, { k:0.04, min:0.014, max:0.05, minR:0.12, maxR:4.5 });
    lodRegister(o);
    o.traverse(c => { if (c.isMesh && !c.userData.fkOutline){ const m = c.material; if (m && m.isMeshToonMaterial && !(m.transparent && m.opacity < 0.95)) c.castShadow = true; } });
  }
  TG.decorateEntity = decorateEntity;
  // World built (called once after the local kart view exists): from now on scene adds are entities.
  TG.worldBuilt = function(){ TG.entityInk = true; };

  // Ink + shadow the boot-time moving set pieces (trains + traffic) — they are the "characters" of
  // the world, unlike fences/roads/terrain which stay line-free.
  TG.decorateMovers = function(groups){
    // minR 0.35: the wheels/couplers/lamps of a train are a dozen tiny meshes each — ink on those is
    // a draw call per bit for lines nobody sees at chase distance
    for (const g of groups){ if (!g) continue; toonifyLive(g); inkTree(g, { k:0.035, min:0.02, max:0.06, minR:0.35, maxR:12 }); lodRegister(g);
      g.traverse(c => { if (c.isMesh && !c.userData.fkOutline && c.material && c.material.isMeshToonMaterial && !c.material.transparent) c.castShadow = true; }); }
  };
  // Async GLB props (instanced per template submesh): toon + ink scaled to each instance. Tiny/thin
  // submeshes (grass blades, flower heads, pebbles) skip ink — at chase distance it is just noise.
  TG.decorateProps = function(group){
    toonifyLive(group);
    // The prop kit's emissive LIFT (×0.25-0.34 of base) was a fix for dark PBR side faces under the
    // old Lambert rig. The toon ramp's 0.42 floor already lifts those faces, so the old lift on top
    // washed the bands flat — keep ~40% of it (measured: shadow band reads, colours do not wash).
    group.traverse(o => {
      if (!o.isMesh) return;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms){ if (m && m.isMeshToonMaterial && m.emissive && !m.userData._fkLiftCut){ m.userData._fkLiftCut = true; m.emissive.multiplyScalar(0.4); } }
    });
    return inkTree(group, { k:0.03, min:0.02, max:0.08, minR:0.35 });
  };

  // ---- lights: toon-aware retune of whatever the preset (+ per-track overrides) produced ----
  // MeshToon = albedo * (hemi + sun * ramp(N.L)), ramp bands 0.42 / 0.72 / 1.0. The Lambert-era
  // presets put hemi+sun at 1.3-2.0 on sun-facing faces (day: 0.85+0.75 = 1.6 — blown out once the
  // ramp no longer falls off). Rule: hemi carries less (the ramp floor now lights the shadow side),
  // then both scale so the lit band is min(1.18, the preset's old top): day lands on the prototype's
  // 0.45 / 0.73. Shadow band warmth: the hemisphere ground colour leans 35% toward warm tan.
  const WARM = new THREE.Color(0xb08a5a);
  TG.retuneLights = function(preset){
    const h0 = HEMI.intensity, s0 = SUN.intensity;
    let h = h0 * 0.53, s = s0;
    const target = Math.min(1.18, h0 + s0);
    const k = target / Math.max(1e-3, h + s);
    h *= k; s *= k;
    HEMI.intensity = h; SUN.intensity = s;
    HEMI.groundColor.lerp(WARM, 0.35);
    if (preset === 'day') SUN.color.setHex(0xfff2d6);
    TG.lighting = { preset, hemi0:h0, sun0:s0, hemi:h, sun:s, top:h + s, shadowBand:h + s*T.RAMP_STEPS[0] };
    return TG.lighting;
  };

  // ===========================================================================================
  // 4. SKY: toon gradient dome + puffy outlined clouds, per preset
  // ===========================================================================================
  const DOMES = {
    day:    { stops:[[-0.2,0xbfe8ff],[0.0,0xdaf4ff],[0.18,0x8fd3ff],[0.6,0x45a2f0],[1,0x2f7fe0]], sun:true,  clouds:16, cloudCol:0xffffff },
    clouds: { stops:[[-0.2,0xcfe0ec],[0.0,0xe6eff6],[0.2,0xb2cfe6],[0.6,0x8db4d8],[1,0x739fcb]], sun:false, clouds:26, cloudCol:0xf4f7fb, replaceSprites:true },
    snow:   { stops:[[-0.2,0xdde5ec],[0.0,0xf0f4f7],[0.3,0xd2dce5],[1,0xaabdce]],                 sun:false, clouds:9,  cloudCol:0xf7f9fc },
    sun:    { stops:[[-0.2,0xc8ecff],[0.0,0xfff0d0],[0.15,0x9fdcff],[0.6,0x4aa8f0],[1,0x2a7ad8]], sun:false, clouds:6,  cloudCol:0xffffff },
    night:  { stops:[[-0.2,0x070c1c],[0.0,0x1a2650],[0.22,0x101c40],[1,0x060b20]],                sun:false, clouds:0 },
  };
  // Puffy clouds: one merged mesh + one ink hull for the whole ring (2 draw calls for every cloud).
  function buildClouds(n, col){
    const r = T.rng(9), parts = [];
    for (let i = 0; i < n; i++){
      const a = r()*Math.PI*2, d = 360 + r()*150, y = 95 + r()*95, k = 4 + (r()*4|0), s0 = 0.9 + r()*0.8;
      const cx = Math.cos(a)*d, cz = Math.sin(a)*d, tx = -Math.sin(a), tz = Math.cos(a);   // tangent: clouds stretch along the ring
      for (let j = 0; j < k; j++){
        const s = (9 + r()*9) * s0, along = (j - k/2) * 10 * s0 + r()*4;
        parts.push(G.blob(s, s*0.72, s, 11, 7).translate(cx + tx*along, y + r()*5*s0 - (j===0||j===k-1 ? 3 : 0), cz + tz*along + r()*5));
      }
    }
    const geo = G.merge(parts);
    const mesh = new THREE.Mesh(geo, T.mat(col, { fog:false, emissive:0x5a6474 }));   // lift: white lit band, blue-grey shadow band
    mesh.name = 'fkToonClouds'; mesh.frustumCulled = false; mesh.renderOrder = -9;
    mesh.userData.noOutline = true;
    const o = inkWith(mesh, geo, 1.4); o.frustumCulled = false; o.renderOrder = -9;
    return mesh;
  }
  // Returns a group to add into SKY_OBJ: dome (+ clouds) that follows the camera. skyObj is the
  // FK_TRACK sky group (stars/moon/snow/sun-disc stay; the soft alpha cloud sprites are replaced).
  TG.buildSky = function(preset, skyObj){
    const D = DOMES[preset] || DOMES.day;
    const grp = new THREE.Group(); grp.name = 'fkToonSky';
    // light direction (setSky has just placed the sun from the preset): drives the dome's sun disc
    // and the per-frame shadow follow (which moves sun.position, so it is captured here, once)
    const dir = TG.sunDir = (SUN ? SUN.position.clone() : V3(40,80,20)).normalize();
    const dome = T.skyDome(D.stops, { sunDir: dir, sunColor: 0xfff8d0, sunSize: D.sun ? 0.012 : 0, glow: D.sun ? 0.5 : 0, radius: 640 });
    grp.add(dome);
    let clouds = null;
    if (D.clouds){ clouds = buildClouds(D.clouds, D.cloudCol); grp.add(clouds); }
    if (D.replaceSprites && skyObj) skyObj.children.forEach(c => { c.visible = false; });
    grp.userData.dome = dome; grp.userData.clouds = clouds;
    TG.sky = grp;
    return grp;
  };

  // ---- per-frame: sky follows the camera, clouds drift, shadow box follows the view, slow sweep ----
  const _fwd = V3(0,0,0), _ctr = V3(0,0,0);
  let _sweepT = 0;
  // Ink LOD. On-screen ink width = t * 514 / d px at 720 px tall (fov 70): a 2 cm kart line is
  // 0.37 px at 28 u, a 1.2 cm GLB-driver line 0.39 px at 16 u — invisible, but each hull still costs a
  // draw call and its whole vertex load (a GLB driver's hull is ~47k skinned triangles). So hulls
  // switch off past those ranges. Hysteresis ±2 u.
  const INK_FAR = 28, INK_FAR_THIN = 16;
  TG.INK_FAR = INK_FAR; TG.INK_FAR_THIN = INK_FAR_THIN;
  TG.inkLod = function(view){
    const cam = TG._cam; if (!cam || !view || !view.group) return;
    const d = view.group.position.distanceTo(cam.position);
    const band = (far, was) => was ? d < far + 2 : d < far - 2;
    const on = band(INK_FAR, view._inkOn !== false), near = band(INK_FAR_THIN, view._inkNear !== false);
    // re-walk only when a band flips or new hulls appeared anywhere (async GLB clones ink on arrival)
    if (on === view._inkOn && near === view._inkNear && view._inkStamp === TG.stats.inked) return;
    view._inkOn = on; view._inkNear = near; view._inkStamp = TG.stats.inked;
    view.group.traverse(o => { if (o.userData.fkOutline) o.visible = o.userData.fkInkThin ? near : on; });
  };
  // the same rule for entity / mover hulls (per hull: trains and traffic are one group at the origin)
  const _lodInks = [], _wp = V3(0,0,0);
  let _lodTick = 0;
  function lodRegister(root){ root.traverse(o => { if (o.userData.fkOutline) _lodInks.push(o); }); }
  function lodWorld(cam){
    if ((++_lodTick) % 4) return;
    for (let i = _lodInks.length - 1; i >= 0; i--){
      const o = _lodInks[i], m = o.parent;
      if (!m){ _lodInks.splice(i, 1); continue; }
      m.getWorldPosition(_wp);
      const d = _wp.distanceTo(cam.position);
      let on = o.visible ? d < INK_FAR + 2 : d < INK_FAR - 2;
      // a hull is its own material: when game code hides or fades the SOURCE material (balloon pops,
      // item-box respawn fades) the ink must go with it, or a bare outline floats in the air
      const sm = m.isMesh && (Array.isArray(m.material) ? m.material[0] : m.material);
      if (sm && (sm.visible === false || (sm.transparent && sm.opacity < 0.6))) on = false;
      o.visible = on;
    }
  }
  TG._lodInks = _lodInks;
  TG.frame = function(dt, camera){
    TG._cam = camera;
    if (camera) lodWorld(camera);
    if (TG.sky && camera){
      TG.sky.position.copy(camera.position);
      const c = TG.sky.userData.clouds; if (c) c.rotation.y += (dt || 0) * 0.004;
    }
    if (SUN && SUN.castShadow && camera){
      camera.getWorldDirection(_fwd); _fwd.y = 0; if (_fwd.lengthSq() < 1e-6) _fwd.set(0,0,1); _fwd.normalize();
      _ctr.copy(camera.position).addScaledVector(_fwd, TG.shadowHalf * 0.45);
      const snap = (TG.shadowHalf * 2) / SUN.shadow.mapSize.x;   // whole shadow texels: no edge crawl
      _ctr.x = Math.round(_ctr.x / snap) * snap; _ctr.z = Math.round(_ctr.z / snap) * snap;
      _ctr.y = camera.position.y - 4;
      SUN.target.position.copy(_ctr); SUN.target.updateMatrixWorld();
      SUN.position.copy(_ctr).addScaledVector(TG.sunDir || V3(0.4,0.8,0.2), 100);
    }
    // safety net for materials SWAPPED at runtime (mesh.material = new Lambert...): the add hook
    // only sees new objects. 1.5 s cadence; a full traverse is ~2 ms on a 2.5k-object scene.
    _sweepT += dt || 0;
    if (SCENE && _sweepT > 1.5){ _sweepT = 0; TG.stats.sweeps++; toonifyLive(SCENE); }
  };

  // ===========================================================================================
  // 5. TOON KARTS
  // ===========================================================================================
  const KM = {};   // shared kart materials (vertex-coloured: one draw call per merged part set)
  function kmats(){
    if (KM.vc) return KM;
    KM.vc = T.mat(0xffffff, { vertexColors:true });
    KM.lamp = T.mat(0xffffff, { vertexColors:true, emissive:0x3a3000 });
    KM.flag = T.mat(0xffffff, { vertexColors:true, side:THREE.DoubleSide });
    KM.pedal = T.mat(0x3a3340);
    for (const k in KM) KM[k].userData.fkShared = true;
    return KM;
  }
  TG.kartMats = kmats;
  const C = { cream:0xfff1d0, dark:0x3a3340, chrome:0xd9dde6, hay:0xf2c74a, strap:0x8a4b22, lamp:0xfff59a,
              tire:0x34303a, hub:0xffd34d, bolt:0xe5392f, white:0xffffff, grille:0x2a2530, seat:0xe5392f };
  // part collector: geometry in kart space, a flat colour, ink on/off
  function parts(){
    const L = { paint:[], base:[], lamp:[], flag:[] };
    L.add = (bucket, geo, hex, x, y, z, rx, ry, rz, inked) => {
      let g = geo.index ? geo.toNonIndexed() : geo;
      G.at(g, x||0, y||0, z||0, rx||0, ry||0, rz||0);
      if (hex != null) G.paint(g, hex);
      L[bucket].push({ g, ink: inked !== false });
      return g;
    };
    return L;
  }
  const RB = (w,h,d,r,seg) => G.roundedBox(w,h,d,r,seg||2);
  // FKS.geo.taperTube winds its quads INWARD (T x circumferential = -N), so lit from inside it read as
  // a dark hollow pipe with a pale rim and its ink hull shrank into the surface. Flip the winding and
  // recompute the normals (horns, tails, exhausts, roll bar all go through here).
  function tube(points, r0, r1, radial, seg){
    const g = G.taperTube(points, r0, r1, radial, seg), ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3){ const t = ix[i+1]; ix[i+1] = ix[i+2]; ix[i+2] = t; }
    g.index.needsUpdate = true; g.computeVertexNormals();
    return g;
  }
  TG.tube = tube;
  function mergeBucket(list, inkOnly){
    const src = inkOnly ? list.filter(p => p.ink) : list;
    return src.length ? G.merge(src.map(p => p.g)) : null;
  }
  // ---- shapes (kart space). Physics footprint is fixed by farmkart.html: wheels at x ±0.58·spread,
  // z +0.62 / -0.58, radius 0.26·wheelSize. Driver seat surface sits at (0, 0.60, 0.10) — that puts the
  // TUNE steering wheel (0, 1.00, 0.36) exactly where the prototype measured clean two-hand IK.
  function seatAndDash(L, dashZ){
    L.add('base', RB(0.48, 0.10, 0.42, 0.045), C.dark, 0, 0.55, 0.07);                    // cushion (top = 0.60)
    L.add('base', RB(0.50, 0.46, 0.12, 0.06), C.cream, 0, 0.83, -0.20);                    // backrest
    L.add('paint', RB(0.62, 0.13, 0.20, 0.06), null, 0, 0.74, dashZ);                       // dash (body colour)
    L.add('base', RB(0.30, 0.05, 0.08, 0.02), C.dark, 0, 0.815, dashZ - 0.02, 0, 0, 0, false);   // gauge strip
    L.add('base', new THREE.CylinderGeometry(0.03, 0.035, 0.36, 8), C.dark, 0, 0.86, dashZ - 0.10, -0.9, 0, 0);   // column
  }
  function headlightFace(L, y, z, sep, r){
    for (const sx of [-1, 1]){
      L.add('lamp', G.blob(r, r, r*0.5, 14, 10), C.lamp, sx*sep, y, z);
      L.add('lamp', G.blob(r*0.3, r*0.3, r*0.18, 8, 6), C.white, sx*sep + 0.03, y + 0.035, z + r*0.45, 0, 0, 0, false);   // catch-light
    }
  }
  function pennant(L, x, y, z, flagHex){
    // whip antenna + pennant: built at the pivot's origin (it sways as one piece in flair())
    L.add('flag', new THREE.CylinderGeometry(0.012, 0.018, 0.9, 5).translate(0, 0.45, 0), C.dark, 0, 0, 0);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute([0,0.86,0, 0,0.68,0, 0,0.77,-0.32], 3)); fg.computeVertexNormals();
    L.add('flag', fg, flagHex, 0, 0, 0);
    return V3(x, y, z);
  }
  const SHAPES = {
    bucky(L){
      L.add('base', RB(1.00, 0.10, 1.70, 0.04), C.dark, 0, 0.22, 0.02);                                  // floor pan
      L.add('paint', RB(0.92, 0.36, 1.22, 0.14, 3), null, 0, 0.44, -0.06);                                // tub
      L.add('paint', RB(0.80, 0.30, 0.62, 0.14, 3), null, 0, 0.43, 0.78);                                 // bubbly nose
      for (const sx of [-1, 1]){
        L.add('paint', RB(0.28, 0.15, 0.56, 0.07), null, sx*0.62, 0.62, 0.62);                            // front pod over the wheel
        L.add('paint', RB(0.32, 0.16, 0.62, 0.075), null, sx*0.63, 0.63, -0.58);                          // chunky rear fender
        L.add('base', RB(0.06, 0.08, 1.00, 0.03), C.cream, sx*0.465, 0.47, 0.0, 0, 0, 0, false);          // side stripe
        L.add('base', RB(0.30, 0.06, 0.12, 0.03), C.dark, sx*0.62, 0.52, 0.02);                           // pod strut
      }
      // cream bumper smile under the headlight eyes
      L.add('base', new THREE.TorusGeometry(0.40, 0.06, 8, 22, Math.PI*0.62), C.cream, 0, 0.27, 0.74, Math.PI/2, 0, Math.PI + Math.PI*0.19);
      headlightFace(L, 0.47, 1.06, 0.22, 0.10);
      L.add('base', RB(0.30, 0.10, 0.03, 0.02), C.grille, 0, 0.36, 1.085, 0, 0, 0, false);               // nostril grille
      seatAndDash(L, 0.58);
      // hay bale on the back deck, two straps
      L.add('base', RB(0.72, 0.32, 0.36, 0.07), C.hay, 0, 0.70, -0.64);
      for (const sx of [-0.2, 0.2]) L.add('base', RB(0.05, 0.34, 0.38, 0.02), C.strap, sx, 0.70, -0.64, 0, 0, 0, false);
      // twin exhaust stacks
      for (const sx of [-1, 1]) L.add('base', tube([V3(sx*0.30,0.46,-0.84), V3(sx*0.33,0.66,-0.98), V3(sx*0.35,0.92,-1.02)], 0.045, 0.07, 10, 8), C.chrome, 0, 0, 0);
      return { flagAt: pennant(L, 0.62, 0.70, -0.80, 0xffd34d) };
    },
    tractor(L){
      L.add('base', RB(0.98, 0.12, 1.62, 0.04), C.dark, 0, 0.24, 0.0);
      L.add('paint', RB(0.62, 0.46, 0.66, 0.14, 3), null, 0, 0.58, 0.80);                                 // tall hood
      L.add('base', RB(0.64, 0.05, 0.68, 0.025), C.cream, 0, 0.815, 0.80);                                // hood trim
      L.add('base', RB(0.46, 0.30, 0.04, 0.02), C.grille, 0, 0.52, 1.13, 0, 0, 0, false);                // radiator
      for (let i = 0; i < 4; i++) L.add('base', RB(0.42, 0.025, 0.02, 0.01), C.chrome, 0, 0.42 + i*0.065, 1.155, 0, 0, 0, false);
      headlightFace(L, 0.70, 1.12, 0.20, 0.085);
      L.add('paint', RB(0.88, 0.34, 0.86, 0.12, 3), null, 0, 0.44, -0.12);                                // cab tub
      for (const sx of [-1, 1]){
        L.add('paint', RB(0.30, 0.10, 0.52, 0.05), null, sx*0.62, 0.61, 0.62);                            // front fenders
        L.add('paint', RB(0.34, 0.34, 0.66, 0.10, 3), null, sx*0.64, 0.66, -0.58);                        // big rear fenders
      }
      // vertical stack with a dark cap — the tractor silhouette
      L.add('base', new THREE.CylinderGeometry(0.045, 0.055, 0.46, 10), C.chrome, 0.27, 1.02, 1.00);
      L.add('base', new THREE.CylinderGeometry(0.08, 0.055, 0.07, 10), C.dark, 0.27, 1.28, 1.00);
      L.add('base', RB(0.55, 0.08, 0.10, 0.03), C.dark, 0, 0.36, -0.92);                                  // hitch bar
      L.add('base', RB(0.10, 0.10, 0.22, 0.03), C.chrome, 0, 0.36, -1.04);
      seatAndDash(L, 0.56);
      return { flagAt: pennant(L, -0.66, 0.84, -0.80, 0xfff1d0) };
    },
    mower(L){
      L.add('paint', RB(1.32, 0.10, 1.42, 0.05), null, 0, 0.20, 0.05);                                   // cutting deck
      L.add('base', RB(1.38, 0.05, 1.48, 0.02), C.dark, 0, 0.13, 0.05);
      for (const sx of [-1, 1]) L.add('paint', RB(0.08, 0.15, 1.36, 0.035), null, sx*0.68, 0.25, 0.05);   // skirts
      L.add('paint', RB(0.66, 0.24, 0.52, 0.10, 3), null, 0, 0.38, 0.66);                                 // engine hump
      L.add('base', RB(0.52, 0.06, 0.40, 0.025), C.dark, 0, 0.52, 0.66);
      headlightFace(L, 0.40, 0.93, 0.20, 0.07);
      L.add('base', RB(0.22, 0.08, 0.28, 0.03), C.dark, 0.72, 0.22, 0.20);                                // discharge chute
      L.add('base', RB(0.36, 0.30, 0.34, 0.06), C.dark, 0, 0.38, 0.06);                                   // seat pedestal
      // roll bar: one smooth hoop behind the seat
      L.add('base', tube([V3(0.30,0.26,-0.34), V3(0.31,0.95,-0.36), V3(0.18,1.18,-0.36), V3(-0.18,1.18,-0.36), V3(-0.31,0.95,-0.36), V3(-0.30,0.26,-0.34)], 0.035, 0.035, 8, 20), C.chrome, 0, 0, 0);
      seatAndDash(L, 0.54);
      L.add('base', RB(0.70, 0.36, 0.36, 0.12, 3), 0x5fb048, 0, 0.44, -0.62);                             // grass catcher
      L.add('base', RB(0.72, 0.06, 0.06, 0.025), C.cream, 0, 0.62, -0.62, 0, 0, 0, false);               // catcher rim
      for (const sx of [-1, 1]) L.add('base', RB(0.06, 0.03, 1.2, 0.012), C.cream, sx*0.5, 0.255, 0.05, 0, 0, 0, false);   // deck stripes
      return { flagAt: pennant(L, 0.31, 0.95, -0.40, 0xff7aa8) };
    },
  };
  const _kartGeo = {};
  function kartGeo(id){
    if (_kartGeo[id]) return _kartGeo[id];
    const L = parts(); const meta = SHAPES[id](L);
    const out = { meta };
    for (const b of ['paint','base','lamp','flag']){ out[b] = mergeBucket(L[b], false); out[b+'Ink'] = mergeBucket(L[b], true); }
    return (_kartGeo[id] = out);
  }
  TG.KART_IDS = Object.keys(SHAPES);
  // Build a toon kart body. Returns { root, bodyMat } (farmkart.html's buildKartBody contract):
  // every mesh drawn with bodyMat is swapped for the view's own paint material by fillKartModel.
  TG.buildKart = function(id, bodyMat, opts){
    opts = opts || {};
    const M = kmats(), K = kartGeo(id);
    const root = new THREE.Group(); root.name = id + 'Kart'; root.userData.fkToonKart = true;
    const add = (geo, mat, inkGeo, t, name) => {
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = true; m.receiveShadow = true;
      root.add(m);
      if (inkGeo && !opts.noInk) inkWith(m, inkGeo, t);
      return m;
    };
    add(K.paint, bodyMat, K.paintInk, 0.022, 'kartPaint');
    add(K.base, M.vc, K.baseInk, 0.018, 'kartBody');
    const lamps = add(K.lamp, M.lamp, K.lampInk, 0.012, 'kartLamps');
    if (lamps) lamps.castShadow = false;   // inside the body's shadow anyway: one less shadow-pass call per kart
    // pennant flair: sways with speed, flutters, leans with steer
    const piv = new THREE.Group(); piv.position.copy(K.meta.flagAt); piv.name = 'kartPennant'; root.add(piv);
    const fm = new THREE.Mesh(K.flag, M.flag); fm.name = 'pennant'; fm.userData.noOutline = true; piv.add(fm);   // a paper-thin flag: no ink, no shadow call
    let t = Math.random() * 10;
    root.userData.flair = (dt, p) => {
      t += dt || 0.016;
      const spd = p ? Math.min(1, Math.hypot(p.v.x, p.v.z) / 20) : 0, st = p ? (p.steer || 0) : 0;
      piv.rotation.x = -0.32*spd + Math.sin(t*9)*0.05*spd;
      piv.rotation.z = st * 0.22 * spd;
      fm.rotation.y = Math.sin(t*14) * 0.3 * (0.3 + spd);
    };
    return { root, bodyMat };
  };

  // ---- wheel: fat cartoon tire + cream/yellow hubcaps + big red bolts (spin reads at speed) ----
  // Axle along local Z (farmkart.html's fillKartModel turns the tire π/2 into its mount). Outer
  // radius = 0.26 (_TIRE_ROUT) so the per-frame tread planting stays exact.
  let _wheelGeo = null;
  function wheelGeo(){
    if (_wheelGeo) return _wheelGeo;
    const r = 0.26, w = 0.25, L = [], inkL = [];
    const push = (g, hex, inked) => { g = g.index ? g.toNonIndexed() : g; G.paint(g, hex); L.push(g); if (inked) inkL.push(g); };
    push(G.tire(r, w, r*0.36, 16, r*0.42), C.tire, true);
    for (const sx of [-1, 1]){
      push(new THREE.CylinderGeometry(r*0.50, r*0.56, 0.04, 14).rotateZ(Math.PI/2).translate(sx*w*0.47, 0, 0), C.hub, true);
      push(G.blob(0.05, r*0.2, r*0.2, 8, 6).translate(sx*(w*0.5+0.012), 0, 0), C.cream, false);          // centre cap
      for (let b = 0; b < 3; b++){ const a = b*Math.PI*2/3;
        push(G.blob(0.03, 0.03, 0.03, 6, 4).translate(sx*(w*0.5+0.02), Math.cos(a)*r*0.30, Math.sin(a)*r*0.30), C.bolt, false); }
    }
    const geo = G.merge(L), ig = G.merge(inkL);
    geo.rotateY(-Math.PI/2); ig.rotateY(-Math.PI/2);   // axle X -> Z
    return (_wheelGeo = { geo, ink: ig });
  }
  TG.buildWheel = function(noInk){
    const W = wheelGeo(), g = new THREE.Group();
    const m = new THREE.Mesh(W.geo, kmats().vc); m.name = 'tire'; m.castShadow = true; m.receiveShadow = true; g.add(m);
    if (!noInk) inkWith(m, W.ink, 0.02);
    return g;
  };

  // ---- steering wheel: same contract as buildSteerWheel (userData rim / gripL / gripR) ----
  // Grips sit where the prototype measured a clean wrist reach: 58° off top, 0.9·r high, 3.5 cm
  // toward the driver. gripL = the driver's LEFT hand = +X.
  let _swGeo = null;
  TG.buildSteerWheel = function(noInk){
    if (!_swGeo){
      const L = [], inkL = [], push = (g, hex, inked) => { g = g.index ? g.toNonIndexed() : g; G.paint(g, hex); L.push(g); if (inked) inkL.push(g); };
      push(new THREE.TorusGeometry(0.16, 0.03, 8, 22), C.dark, true);
      for (let i = 0; i < 3; i++){ const sp = RB(0.03, 0.16, 0.02, 0.01, 1); sp.translate(0, 0.08, 0); sp.rotateZ(i*Math.PI*2/3 + Math.PI); push(sp, C.chrome, false); }
      push(G.blob(0.048, 0.048, 0.03, 10, 8), C.bolt, true);
      _swGeo = { geo: G.merge(L), ink: G.merge(inkL) };
    }
    const g = new THREE.Group(); g.name = 'steerWheelToon';
    const rim = new THREE.Group(); g.add(rim);
    const m = new THREE.Mesh(_swGeo.geo, kmats().vc); m.name = 'steerRim'; rim.add(m);
    if (!noInk) inkWith(m, _swGeo.ink, 0.012);
    const a = 58 * Math.PI/180, rr = 0.16, back = 0.035;
    const gripL = new THREE.Object3D(); gripL.name = 'grip_L'; gripL.position.set( Math.sin(a)*rr, Math.cos(a)*rr*0.9, -back); rim.add(gripL);
    const gripR = new THREE.Object3D(); gripR.name = 'grip_R'; gripR.position.set(-Math.sin(a)*rr, Math.cos(a)*rr*0.9, -back); rim.add(gripR);
    g.userData.rim = rim; g.userData.gripL = gripL; g.userData.gripR = gripR;
    return g;
  };

  // ===========================================================================================
  // 6. TOON DRIVERS — skinned on the shared 21-bone rig, one vertex-coloured material, one ink hull
  // ===========================================================================================
  const J = FKS.joint;
  const DRIVER_PAL = {
    // fur/cream/nose/eye from farmkart.html's _DRIVER_MATS (the characters' established palettes)
    bucky: { fur:0x8a5c36, cream:0xf3e6c8, nose:0x3a2a20, eye:0x1a1410, eyeW:0xffffff, horn:0xe8d8b0, pink:0xf3a0a8,
             shirt:0xffffff, scarf:0xe5392f, pants:0x3c6fd1, glove:0xfff1d0, hoof:0x4a3426 },
    otis:  { fur:0xf0e4c8, ear:0xd9b07a, cream:0xfff8ee, nose:0x1a1410, eye:0x1a1410, eyeW:0xffffff, pink:0xf08a9a,
             shirt:0xffffff, scarf:0x3f7fe0, pants:0x5a6f8c, glove:0xfff8ee, hoof:0x7a5a3c },
    boots: { fur:0x8a8e96, dark:0x6c7078, cream:0xf5f0e8, nose:0xe88a9a, eye:0x1a1410, eyeW:0xffffff, pink:0xf3a0a8,
             shirt:0xffffff, scarf:0xb03a2e, bell:0xf2c200, pants:0x8a8e96, glove:0xffffff, hoof:0xffffff },
  };
  TG.DRIVER_PAL = DRIVER_PAL;
  function eyes(sk, H, z0){
    for (const sx of [-1, 1]){
      sk.rigid(G.blob(0.056, 0.07, 0.03, 12, 9).translate(sx*0.086, H.y+0.17, H.z+z0), 'eyeW', 'head');
      sk.rigid(G.blob(0.031, 0.044, 0.02, 10, 8).translate(sx*0.082, H.y+0.165, H.z+z0+0.023), 'eye', 'head');
      sk.rigid(G.blob(0.012, 0.014, 0.008, 6, 5).translate(sx*0.072, H.y+0.185, H.z+z0+0.039), 'eyeW', 'head');
      sk.rigid(RB(0.07, 0.016, 0.02, 0.007, 1).rotateZ(-sx*0.25).translate(sx*0.088, H.y+0.262, H.z+z0-0.025), 'nose', 'head');   // brow
    }
  }
  function bodyAndLimbs(sk, pal, opts){
    opts = opts || {};
    // neck scarf / collar
    sk.along(new THREE.TorusGeometry(0.1, 0.035, 7, 16).rotateX(Math.PI/2).translate(0, 0.585, 0.0), 'scarf', [[0.55,'chest'],[0.62,'neck']]);
    if (opts.scarfTail) sk.rigid(new THREE.ConeGeometry(0.05, 0.12, 6).rotateX(Math.PI*0.6).translate(0.05, 0.56, -0.12), 'scarf', 'chest');
    // torso: round and short
    sk.along(G.blob(0.17, 0.25, 0.15, 18, 12).translate(0, 0.36, -0.03), 'shirt', [[0.14,'hips'],[0.30,'spine'],[0.46,'chest'],[0.6,'neck']]);
    if (opts.buttons) for (let i = 0; i < 3; i++) sk.rigid(G.blob(0.016,0.016,0.01,6,5).translate(0.05, 0.46-i*0.08, 0.115), 'scarf', i===0?'chest':'spine');
    if (opts.chest) sk.along(G.blob(0.10, 0.13, 0.05, 12, 8).translate(0, 0.42, 0.10), 'cream', [[0.30,'spine'],[0.46,'chest']]);
    sk.along(G.blob(0.18, 0.09, 0.16, 16, 9).translate(0, 0.14, -0.03), 'pants', [[0.1,'hips'],[0.2,'spine']]);
    for (const s of ['L','R']){
      sk.limb(G.capsule(J('upperArm_'+s), J('foreArm_'+s), 0.06, 0.05, 10, 5), opts.bareArms ? 'fur' : 'shirt', 'upperArm_'+s, 'foreArm_'+s, { blendParent:true });
      sk.limb(G.capsule(J('foreArm_'+s), J('hand_'+s), 0.045, 0.04, 10, 5), 'fur', 'foreArm_'+s, 'hand_'+s);
      const h = J('hand_'+s), dir = J('hand_'+s).sub(J('foreArm_'+s)).normalize();
      sk.rigid(G.blob(0.055, 0.05, 0.06, 10, 8).translate(h.x+dir.x*0.04, h.y+dir.y*0.04, h.z+dir.z*0.04), 'glove', 'hand_'+s);
      sk.limb(G.capsule(J('thigh_'+s), J('shin_'+s), 0.075, 0.06, 10, 5), 'pants', 'thigh_'+s, 'shin_'+s, { blendParent:true });
      sk.limb(G.capsule(J('shin_'+s), J('foot_'+s), 0.055, 0.05, 10, 5), 'pants', 'shin_'+s, 'foot_'+s);
      const f = J('foot_'+s);
      sk.rigid(G.blob(0.065, 0.05, 0.10, 10, 8).translate(f.x, f.y-0.01, f.z+0.05), 'hoof', 'foot_'+s);
    }
  }
  const DRIVER_BUILD = {
    // Bucky — the prototype's chibi goat: horns, floppy ears, goatee, chef jacket + red scarf.
    // (The chef toque is a separate rigid mesh on the head bone so a hat can replace it.)
    bucky(sk){
      const H = J('head');
      sk.rigid(G.blob(0.21, 0.19, 0.20, 20, 14).translate(H.x, H.y+0.13, H.z+0.02), 'fur', 'head');
      sk.rigid(G.blob(0.12, 0.095, 0.12, 14, 10).translate(0, H.y+0.07, H.z+0.17), 'cream', 'head');
      sk.rigid(G.blob(0.05, 0.03, 0.03, 10, 6).translate(0, H.y+0.11, H.z+0.285), 'nose', 'head');
      const sm = new THREE.TorusGeometry(0.045, 0.008, 5, 10, Math.PI*0.8); sm.rotateZ(Math.PI + Math.PI*0.1); sm.translate(0, H.y+0.06, H.z+0.285);
      sk.rigid(sm, 'nose', 'head');
      eyes(sk, H, 0.195);
      for (const sx of [-1, 1]){
        sk.rigid(tube([V3(sx*0.08,H.y+0.27,H.z-0.02), V3(sx*0.12,H.y+0.35,H.z-0.08), V3(sx*0.15,H.y+0.34,H.z-0.18), V3(sx*0.17,H.y+0.27,H.z-0.20)], 0.04, 0.012, 8, 10), 'horn', 'head');
        const E = J(sx>0?'ear_L':'ear_R'), eb = sx>0?'ear_L':'ear_R';
        sk.rigid(G.blob(0.12, 0.035, 0.06, 12, 8).rotateZ(-sx*0.45).translate(E.x+sx*0.09, E.y-0.04, E.z), 'fur', eb);
        sk.rigid(G.blob(0.08, 0.02, 0.035, 10, 6).rotateZ(-sx*0.45).translate(E.x+sx*0.09, E.y-0.03, E.z+0.03), 'pink', eb);
      }
      sk.rigid(new THREE.ConeGeometry(0.04, 0.12, 8).rotateX(Math.PI).translate(0, H.y-0.04, H.z+0.15), 'cream', 'head');   // goatee
      bodyAndLimbs(sk, DRIVER_PAL.bucky, { scarfTail:true, buttons:true });
      const Tl = J('tail');
      sk.rigid(G.blob(0.04, 0.07, 0.04, 8, 6).rotateX(-0.6).translate(Tl.x, Tl.y+0.04, Tl.z-0.02), 'cream', 'tail');
    },
    // Otis — cream golden retriever: long muzzle, black button nose, long floppy ears, blue bandana.
    otis(sk){
      const H = J('head');
      sk.rigid(G.blob(0.20, 0.185, 0.20, 20, 14).translate(H.x, H.y+0.13, H.z+0.01), 'fur', 'head');
      sk.rigid(G.blob(0.105, 0.085, 0.14, 14, 10).translate(0, H.y+0.075, H.z+0.18), 'cream', 'head');      // muzzle
      sk.rigid(G.blob(0.055, 0.04, 0.04, 10, 7).translate(0, H.y+0.115, H.z+0.315), 'nose', 'head');        // button nose
      const sm = new THREE.TorusGeometry(0.04, 0.008, 5, 10, Math.PI*0.8); sm.rotateZ(Math.PI + Math.PI*0.1); sm.translate(0, H.y+0.05, H.z+0.30);
      sk.rigid(sm, 'nose', 'head');
      sk.rigid(G.blob(0.03, 0.012, 0.035, 8, 5).translate(0, H.y+0.025, H.z+0.29), 'pink', 'head');         // tongue
      eyes(sk, H, 0.18);
      for (const sx of [-1, 1]){
        // long floppy ears hanging from the ear bones (the clips stream them back at speed)
        const E = J(sx>0?'ear_L':'ear_R'), eb = sx>0?'ear_L':'ear_R';
        sk.rigid(G.blob(0.06, 0.15, 0.08, 12, 9).rotateZ(sx*0.25).translate(E.x+sx*0.07, E.y-0.13, E.z-0.01), 'ear', eb);
      }
      bodyAndLimbs(sk, DRIVER_PAL.otis, { scarfTail:true, chest:false });
      const Tl = J('tail');
      sk.rigid(tube([V3(Tl.x, Tl.y, Tl.z), V3(Tl.x, Tl.y+0.08, Tl.z-0.10), V3(Tl.x, Tl.y+0.20, Tl.z-0.14)], 0.045, 0.02, 8, 8), 'fur', 'tail');
    },
    // Boots — grey cat: pointy ears with pink insides, pink nose, whiskers, red collar + gold bell,
    // white paws and white boots, a long tail with a white tip.
    boots(sk){
      const H = J('head');
      sk.rigid(G.blob(0.22, 0.18, 0.19, 20, 14).translate(H.x, H.y+0.13, H.z+0.01), 'fur', 'head');
      sk.rigid(G.blob(0.10, 0.07, 0.08, 12, 9).translate(0, H.y+0.07, H.z+0.16), 'cream', 'head');          // muzzle
      sk.rigid(G.blob(0.035, 0.025, 0.025, 8, 6).translate(0, H.y+0.105, H.z+0.235), 'nose', 'head');
      const sm = new THREE.TorusGeometry(0.03, 0.007, 5, 10, Math.PI*0.8); sm.rotateZ(Math.PI + Math.PI*0.1); sm.translate(0, H.y+0.06, H.z+0.235);
      sk.rigid(sm, 'dark', 'head');
      eyes(sk, H, 0.17);
      for (const sx of [-1, 1]){
        const E = J(sx>0?'ear_L':'ear_R'), eb = sx>0?'ear_L':'ear_R';
        // pointy ears standing clear of the round head (head top ~ y 0.99 here)
        sk.rigid(new THREE.ConeGeometry(0.08, 0.17, 8).rotateZ(-sx*0.32).translate(E.x+sx*0.03, E.y+0.16, E.z), 'fur', eb);
        sk.rigid(new THREE.ConeGeometry(0.045, 0.10, 6).rotateZ(-sx*0.32).translate(E.x+sx*0.025, E.y+0.145, E.z+0.04), 'pink', eb);
        for (const dy of [-0.012, 0.014]) sk.rigid(RB(0.16, 0.008, 0.008, 0.003, 1).rotateZ(sx*dy*8).translate(sx*0.17, H.y+0.08+dy, H.z+0.17), 'cream', 'head');   // whiskers
        // dark tabby stripes over the brow
        sk.rigid(RB(0.03, 0.07, 0.02, 0.01, 1).rotateX(-0.75).translate(sx*0.055, H.y+0.265, H.z+0.135), 'dark', 'head');
      }
      bodyAndLimbs(sk, DRIVER_PAL.boots, { chest:true, bareArms:true });
      sk.rigid(G.blob(0.04, 0.04, 0.04, 8, 6).translate(0, 0.53, 0.115), 'bell', 'chest');                  // collar bell
      const Tl = J('tail');
      sk.rigid(tube([V3(Tl.x, Tl.y, Tl.z), V3(Tl.x+0.04, Tl.y+0.10, Tl.z-0.16), V3(Tl.x+0.02, Tl.y+0.30, Tl.z-0.22), V3(Tl.x-0.04, Tl.y+0.40, Tl.z-0.16)], 0.035, 0.03, 8, 12), 'fur', 'tail');
      sk.rigid(G.blob(0.04, 0.05, 0.04, 8, 6).translate(Tl.x-0.04, Tl.y+0.42, Tl.z-0.15), 'cream', 'tail');
    },
  };
  TG.DRIVER_IDS = Object.keys(DRIVER_BUILD);
  // Chef toque (Bucky): built in HEAD-BONE space (racer space minus the head joint; every bind
  // rotation is identity so that is exact) and parented to the head bone.
  let _toqueGeo = null;
  function toqueGeo(){
    if (_toqueGeo) return _toqueGeo;
    const H = J('head'), L = [];
    L.push(new THREE.CylinderGeometry(0.11, 0.10, 0.10, 14).translate(0, 0.33, -0.02));
    for (let i = 0; i < 5; i++){ const a = i/5*Math.PI*2; L.push(G.blob(0.07,0.07,0.07,10,8).translate(Math.cos(a)*0.06, 0.42, -0.02+Math.sin(a)*0.06)); }
    L.push(G.blob(0.08,0.08,0.08,10,8).translate(0, 0.45, -0.02));
    // authored like the prototype (y offsets from the head joint, z in racer space) -> head-bone local
    const g = G.merge(L); g.translate(0, 0, -H.z);
    return (_toqueGeo = g);
  }
  const _drvGeo = {};
  function driverGeo(id){
    if (_drvGeo[id]) return _drvGeo[id];
    const sk = FKS.skinBuilder(), pal = DRIVER_PAL[id];
    DRIVER_BUILD[id](sk);
    const dummy = {}; for (const k in pal) dummy[k] = new THREE.MeshBasicMaterial();
    const r = sk.build(dummy, {});
    const geo = r.mesh.geometry;
    // groups -> vertex colours (one material, one draw call); keys follow skinBuilder's insertion order
    const matKeys = r.mesh.material.map(m => Object.keys(dummy).find(k => dummy[k] === m));
    const col = new Float32Array(geo.attributes.position.count * 3), c = new THREE.Color();
    for (const gr of geo.groups){
      c.setHex(pal[matKeys[gr.materialIndex]]);
      for (let i = gr.start; i < gr.start + gr.count; i++){ col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b; }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.clearGroups();
    geo.computeBoundingSphere(); geo.boundingSphere.radius *= 1.25;
    return (_drvGeo[id] = geo);
  }
  let _drvMat = null, _clips = null;
  TG.clips = () => _clips || (_clips = FKS.buildClips());
  function drvMat(){ if (!_drvMat){ _drvMat = T.mat(0xffffff, { vertexColors:true, skinning:true }); _drvMat.userData.fkShared = true; } return _drvMat; }
  // Seat offset inside farmkart.html's driverRoot (which TUNE places at driverX/Y/Z = 0, 0.78, -0.08):
  // racer origin (seat surface) lands at kart (0, 0.60, 0.10) — the prototype's wheel-to-seat relation
  // for the TUNE steering wheel at (0, 1.00, 0.36). Sliders still move driver and wheel as before.
  TG.SEAT_OFF = V3(0, -0.18, 0.18);
  // Build a skinned toon driver. Contract fields farmkart.html reads: kind, root, head (hat anchor).
  TG.buildDriver = function(id, opts){
    opts = opts || {};
    const geo = driverGeo(id);
    const root = new THREE.Group(); root.name = 'driver_' + id;
    const racer = new THREE.Group(); racer.name = 'racer'; racer.position.copy(TG.SEAT_OFF); root.add(racer);
    const rig = FKS.makeSkeleton();
    const mesh = new THREE.SkinnedMesh(geo, drvMat());
    // frustum culling stays ON (main + shadow pass): the rig never leaves the seat by more than the
    // bind-pose bounding sphere's slack, so the bind sphere (grown 25% for the cheer arms) is safe
    mesh.name = 'racerBody'; mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.add(rig.root); mesh.bind(rig.skeleton);
    racer.add(mesh);
    if (!opts.noInk){ const h = ink(mesh, 0.014); if (h) h.frustumCulled = true; }
    // hat anchor on the head bone: centre of the chibi head, scaled so the procedural hats (built
    // for the old 0.30 box skull) sit on a 0.42-wide head
    const head = new THREE.Object3D(); head.name = 'hatAnchor';
    head.position.set(0, 0.11, 0.02); head.scale.setScalar(1.3); rig.bones.head.add(head);
    let toque = null;
    if (id === 'bucky'){
      toque = new THREE.Mesh(toqueGeo(), T.mat(0xffffff)); toque.name = 'toque'; toque.castShadow = true;
      rig.bones.head.add(toque); if (!opts.noInk) ink(toque, 0.014);
    }
    const anim = FKS.RacerAnimator({ mesh, bones: rig.bones, root: rig.root }, TG.clips());
    return { kind:id, toon:true, root, racer, mesh, bones: rig.bones, skeleton: rig.skeleton, head, toque, anim,
             _ev:{ boost:false, spin:false, airT:0, tricked:false, fin:false } };
  };
  // Per-frame: drive the clip layers from the REAL kart state, then IK both hands onto the grips.
  // Call after the kart group's transform for this frame is final (syncKartView does).
  TG.syncDriver = function(view, g, p, dt, steerWheel){
    dt = Math.min(0.1, dt || 0.016);
    const A = g.anim, ev = g._ev;
    if (steerWheel && steerWheel.userData.gripL) A.grips = { L: steerWheel.userData.gripL, R: steerWheel.userData.gripR };
    const spd = p.v ? Math.hypot(p.v.x, p.v.z) : 0;   // remote / podium players may carry no velocity
    A.setBase(spd > 1.2 ? 'drive' : 'idle');
    // one-shots on rising edges: boost kick, spin-out (hit), airborne trick; cheer holds on finish
    const boosting = (p.boostT || 0) > 0, spinning = (p.spinT || 0) > 0;
    if (boosting && !ev.boost && A.state.overlay !== 'hit') A.play('boost');
    if (spinning && !ev.spin) A.play('hit');
    if (p.airborne){ ev.airT += dt; if (ev.airT > 0.3 && !ev.tricked && !spinning){ A.play('trick'); ev.tricked = true; } }
    else { ev.airT = 0; ev.tricked = false; }
    if (p.finished && !ev.fin) A.play('cheer');
    if (!p.finished && ev.fin && A.state.overlay === 'cheer') A.stop();
    ev.boost = boosting; ev.spin = spinning; ev.fin = !!p.finished;
    if (g.toque) g.toque.visible = !view._hatMesh;   // a worn hat replaces Bucky's toque
    view.group.updateMatrixWorld(true);
    A.update(dt, { steer: p.steer || 0, drift: !!(p.drift && p.drift.active) });
  };
  // Podium ceremony: the static podium karts never go through syncKartView after placement, so the
  // ceremony ticks their animators directly — cheer on loop, no steering, no IK pull.
  TG.podiumCheer = function(view, dt){
    const g = view.goat, A = g && g.anim; if (!A) return;
    if (A.state.overlay !== 'cheer') A.play('cheer');
    view.group.updateMatrixWorld(true);
    A.update(Math.min(0.1, dt || 0.016), { steer: 0, drift: false });
  };
})();
