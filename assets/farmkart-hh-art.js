// Farm Kart — HARVEST HOLLOW premium art pass (Storybook toon).
// window.FK_HH_ART.build(scene, ctx) is called by farmkart.html ONLY when ACTIVE_TRACK_ID === 'harvest-hollow';
// window.FK_HH_ART.update(dt, t) runs once per frame from the main loop. Everything added here is
// MeshToonMaterial (via FK_TOON) or MeshBasicMaterial, ink-outlined, merged into spatial chunks (or
// instanced when it animates), and kept OFF the drivable corridor. No physics, no track data, no
// gameplay state is touched: this file only adds scenery and re-colours the existing ground/road meshes.
// The Kit below bakes many small primitives (boxes, cylinders, spheres...) into per-chunk BufferGeometries
// with vertex colours, a per-vertex ink thickness (the outline hull is extruded in the vertex shader) and
// a per-vertex sway weight (the wind wobble is a vertex-shader sin, so animated crops/flags/bunting cost
// no CPU). Registry of every placed item (kind,x,y,z,r) is exposed for the verify suite.
(function(){
  'use strict';
  const A = window.FK_HH_ART = window.FK_HH_ART || {};
  const T = window.FK_TOON;
  let ART = null;

  A.build = function(scene, ctx){
    if (ART && ART.dispose) ART.dispose();
    ART = make(scene, ctx);
    return ART;
  };
  A.update = function(dt, t){ if (ART) ART.update(dt, t); };
  Object.defineProperty(A, 'art', { get(){ return ART; } });

  function make(scene, ctx){
    const THREE = window.THREE;
    const camera = ctx.camera;
    const hw = ctx.TRACK_WIDTH / 2;
    const C = ctx.centerPts, TG = ctx.tangents, AS = ctx.arcS, N = C.length, TLEN = ctx.TRACK_LEN;
    const TR = ctx.ACTIVE_TRACK;
    const MOBILE = !!ctx.IS_MOBILE;
    const DEN = MOBILE ? 0.5 : 1;          // density multiplier for decorative scatter (phone cut)
    const rng = T.rng(0x4a3b2c1d);
    const rr = (a, b) => a + (b - a) * rng();
    const pick = arr => arr[Math.floor(rng() * arr.length) % arr.length];
    const H = (x, z) => ctx.sampleHeight(x, z);
    const GH = (x, z) => (ctx.groundSampleHeight || ctx.sampleHeight)(x, z);
    const root = new THREE.Group(); root.name = 'hhArt'; scene.add(root);
    const registry = [];              // {kind,x,y,z,r,overhead?,minY?}
    const animators = [];             // fn(dt,t)
    const U = { uHT: { value: 0 } };  // shared time uniform for the wind wobble
    const col = (hex) => new THREE.Color(hex);
    const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    // cheap value noise for painted variation (deterministic)
    const hash2 = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const vnoise = (x, z) => { const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
      return lerp(lerp(hash2(i, j), hash2(i + 1, j), u), lerp(hash2(i, j + 1), hash2(i + 1, j + 1), u), v); };

    // ------------------------------------------------------------------------------------------
    //  ROAD GEOMETRY QUERIES (own spatial hash — the placement code asks thousands of times)
    // ------------------------------------------------------------------------------------------
    const HC = 32, rhash = new Map();
    for (let i = 0; i < N; i++){ const k = Math.floor(C[i].x / HC) + ',' + Math.floor(C[i].z / HC); (rhash.get(k) || rhash.set(k, []).get(k)).push(i); }
    // nearest point on the closed centreline polyline: {d, i, u, side, px, pz, tx, tz}. d = 99 beyond ~HC.
    function roadNear(x, z){
      const cx = Math.floor(x / HC), cz = Math.floor(z / HC);
      let bd = 1e9, bi = -1, bu = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++){
        const lst = rhash.get((cx + a) + ',' + (cz + b)); if (!lst) continue;
        for (const i of lst){
          for (const j0 of [(i - 1 + N) % N, i]){      // both segments touching sample i
            const p = C[j0], q = C[(j0 + 1) % N];
            const dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz || 1e-9;
            let u = ((x - p.x) * dx + (z - p.z) * dz) / l2; u = u < 0 ? 0 : u > 1 ? 1 : u;
            const ex = x - (p.x + dx * u), ez = z - (p.z + dz * u), d = ex * ex + ez * ez;
            if (d < bd){ bd = d; bi = j0; bu = u; }
          }
        }
      }
      if (bi < 0) return { d: 99, i: 0, u: 0, side: 1, px: 0, pz: 0, tx: 0, tz: 1 };
      const p = C[bi], q = C[(bi + 1) % N];
      const px = p.x + (q.x - p.x) * bu, pz = p.z + (q.z - p.z) * bu;
      const tx = TG[bi].x, tz = TG[bi].z;
      const side = ((x - px) * (-tz) + (z - pz) * tx) >= 0 ? 1 : -1;   // +1 = left of travel
      return { d: Math.sqrt(bd), i: bi, u: bu, side, px, pz, tx, tz };
    }
    const roadD = (x, z) => roadNear(x, z).d;
    // index at arc distance s (wraps)
    function idxAtS(s){ s = ((s % TLEN) + TLEN) % TLEN; let lo = 0, hi = N - 1; while (lo < hi){ const m = (lo + hi + 1) >> 1; if (AS[m] <= s) lo = m; else hi = m - 1; } return lo; }
    // point at arc s, lateral offset off (+left): {x,z,y,tx,tz,nx,nz,i}
    function atS(s, off){ const i = idxAtS(s), p = C[i], t = TG[i], nx = -t.z, nz = t.x; return { x: p.x + nx * (off || 0), z: p.z + nz * (off || 0), y: p.y, tx: t.x, tz: t.z, nx, nz, i }; }
    // signed curvature (rad per unit, + = turning to the left of travel? computed from heading change) averaged over +-win
    function curvAt(i, win){ const k = Math.max(1, Math.round(win / (TLEN / N))); const a = TG[(i - k + N) % N], b = TG[(i + k) % N];
      const cr = a.x * b.z - a.z * b.x, dt = a.x * b.x + a.z * b.z; return Math.atan2(cr, dt) / (2 * k * TLEN / N); }
    const MARGIN = 2.0;   // placement margin off the road edge (suite asserts >= 1.5)

    // ------------------------------------------------------------------------------------------
    //  OBSTACLES: existing objects / fences / rails / pastures / water — dressing keeps clear of all
    // ------------------------------------------------------------------------------------------
    const OBJ_R = { farm_silo_house: 9, farm_small_barn: 7.5, farm_barn: 9, west_haystack: 2.6, surv_box: 1.8, farm_fence: 3.0, crops_cornStageD: 1.3,
      crops_cornStageC: 1.3, crops_wheatStageB: 1.3, crop_pumpkin: 1.5, crops_dirtRow: 2.2, farm_tower_windmill: 0, farm_open_barn: 0, farm_silo: 7, farm_chickencoop: 4.2,
      surv_barrel: 1.4, surv_box_large: 2.0, path_wood: 3, canoe: 3.5, grass_large: 1.2 };
    const obst = [];            // {x,z,r}
    for (const o of (TR.objects || [])){
      let r = OBJ_R[o.model];
      if (r == null){ r = /^tree/.test(o.model || '') ? 0.38 * o.sx : /^rock/.test(o.model || '') ? 0.34 * o.sx : 0.4 * o.sx; }
      if (o.type === 'ramp') r = 11;
      if (r > 0) obst.push({ x: o.x, z: o.z, r });
    }
    const fenceSegs = [];       // polylines of the pasture fences
    for (const f of (TR.fences || [])){ for (let i = 0; i + 1 < f.points.length; i++) fenceSegs.push([f.points[i], f.points[i + 1]]); }
    for (const p of (TR.pastures || [])) obst.push({ x: p.x, z: p.z, r: p.r + 2.5 });
    // train loop: same closed Catmull-Rom the game uses
    const railPts = [];
    for (const tr of (TR.trains || [])){
      const cv = new THREE.CatmullRomCurve3(tr.points.map(p => new THREE.Vector3(p.x, 0, p.z)), true, 'catmullrom', 0.5);
      for (let i = 0; i < 240; i++){ const p = cv.getPoint(i / 240); railPts.push({ x: p.x, z: p.z }); }
    }
    function segDist(px, pz, a, b){ const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9; let u = ((px - a.x) * dx + (pz - a.z) * dz) / l2; u = u < 0 ? 0 : u > 1 ? 1 : u; return Math.hypot(px - (a.x + dx * u), pz - (a.z + dz * u)); }
    function railD(x, z){ let m = 1e9; for (let i = 0; i < railPts.length; i++){ const d = Math.hypot(x - railPts[i].x, z - railPts[i].z); if (d < m) m = d; } return m; }
    function fenceD(x, z){ let m = 1e9; for (const s of fenceSegs){ const d = segDist(x, z, s[0], s[1]); if (d < m) m = d; } return m; }
    const wet = (x, z) => ctx.waterSurfaceAt ? ctx.waterSurfaceAt(x, z) != null : false;
    // spatial hash for own claimed circles
    const OH = 14, ohash = new Map();
    function claim(x, z, r, kind, extra){
      const k = Math.floor(x / OH) + ',' + Math.floor(z / OH);
      (ohash.get(k) || ohash.set(k, []).get(k)).push({ x, z, r });
      registry.push(Object.assign({ kind, x, y: H(x, z), z, r }, extra || {}));
    }
    function ownFree(x, z, r){
      const cx = Math.floor(x / OH), cz = Math.floor(z / OH);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++){ const l = ohash.get((cx + a) + ',' + (cz + b)); if (!l) continue;
        for (const o of l) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false; }
      return true;
    }
    // is a circle of radius r at (x,z) a legal spot for solid, off-road dressing?
    function ok(x, z, r, o){
      o = o || {};
      if (roadD(x, z) < hw + MARGIN + r) return false;
      if (!o.noRail && railPts.length && railD(x, z) < 5.5 + r) return false;
      if (!o.noFence && fenceSegs.length && fenceD(x, z) < 2.2 + r) return false;
      if (!o.noObj) for (const b of obst){ if (Math.hypot(b.x - x, b.z - z) < b.r + r + 1.2) return false; }
      if (!o.wet && (wet(x, z) || wet(x + r, z) || wet(x - r, z) || wet(x, z + r) || wet(x, z - r))) return false;
      if (!o.noOwn && !ownFree(x, z, r)) return false;
      return true;
    }
    // bounds of the played world (for scatter + skirt)
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const c of C){ minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z); }
    const GM = (TR.groundMargin != null) ? TR.groundMargin : 55;
    const GX0 = minX - GM, GX1 = maxX + GM, GZ0 = minZ - GM, GZ1 = maxZ + GM;
    const CXW = (GX0 + GX1) / 2, CZW = (GZ0 + GZ1) / 2;

    // ------------------------------------------------------------------------------------------
    //  MATERIALS
    // ------------------------------------------------------------------------------------------
    const swayInject = (sh, ink) => {
      sh.uniforms.uHT = U.uHT;
      sh.vertexShader = (ink ? 'attribute float aInk;\n' : '') + 'attribute float aSway;\nuniform float uHT;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        (ink ? 'vec3 transformed = vec3(position) + normalize(normal) * aInk;\n' : 'vec3 transformed = vec3(position);\n') +
        'float hhPh = transformed.x*0.31 + transformed.z*0.23;\n' +
        'transformed.x += sin(uHT*1.9 + hhPh)*aSway;\n' +
        'transformed.z += cos(uHT*1.5 + hhPh*1.3)*aSway*0.7;\n' +
        'transformed.y += sin(uHT*2.3 + hhPh)*aSway*0.12;\n');
    };
    function toonVC(extra){
      const m = T.mat(0xffffff, Object.assign({ vertexColors: true }, extra || {}));
      m.onBeforeCompile = sh => swayInject(sh, false);
      m.customProgramCacheKey = () => 'hhToonSway';
      m.userData.hhArt = true; return m;
    }
    const MAT = { solid: toonVC(), decal: toonVC({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), cloud: toonVC({ emissive: 0x5d6a96 }) };
    const INKMAT = new THREE.MeshBasicMaterial({ color: T.INK, side: THREE.BackSide });
    INKMAT.onBeforeCompile = sh => swayInject(sh, true);
    INKMAT.customProgramCacheKey = () => 'hhInkSway';
    INKMAT.userData.noToon = true; INKMAT.userData.fkOutline = true; INKMAT.userData.hhArt = true;

    // ------------------------------------------------------------------------------------------
    //  KIT: bake primitives into spatial chunks
    // ------------------------------------------------------------------------------------------
    const CH = 110; let CH_OVERRIDE = 0; const ART_STATS = {};
    function Kit(single){ this.single = !!single; this.b = new Map(); this.base = new THREE.Matrix4(); this._m = new THREE.Matrix4(); this._e = new THREE.Euler(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); }
    const GEO = {};
    const gBox = () => GEO.box || (GEO.box = new THREE.BoxGeometry(1, 1, 1));
    const gCyl = (rt, rb, seg) => { const k = 'c' + rt.toFixed(3) + '_' + rb.toFixed(3) + '_' + seg; return GEO[k] || (GEO[k] = new THREE.CylinderGeometry(rt, rb, 1, seg, 1)); };
    const gSph = (ws, hs) => { const k = 's' + ws + '_' + hs; return GEO[k] || (GEO[k] = new THREE.SphereGeometry(1, ws, hs)); };
    // base transform stack: place(x,y,z,ry,scale?) then primitives are local to it
    Kit.prototype.place = function(x, y, z, ry, fn, s){
      const prev = this.base.clone();
      const m = new THREE.Matrix4().makeRotationY(ry || 0).setPosition(x, y, z);
      if (s) m.multiply(new THREE.Matrix4().makeScale(s, s, s));
      this.base.multiply(m); fn(this); this.base.copy(prev);
    };
    // generic add: geo (unit-ish), local matrix, colour, ink thickness, opts{sway, swayAxis, decal}
    Kit.prototype.addGeo = function(geo, lm, color, ink, o){
      o = o || {};
      const mw = this._m.multiplyMatrices(this.base, lm);
      const g = geo.index ? geo.toNonIndexed() : geo;
      const pa = g.attributes.position, na = g.attributes.normal, n = pa.count;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2;
      const hx = Math.max(1e-4, (bb.max.x - bb.min.x) / 2), hy = Math.max(1e-4, (bb.max.y - bb.min.y) / 2), hz = Math.max(1e-4, (bb.max.z - bb.min.z) / 2);
      const nm = new THREE.Matrix3().getNormalMatrix(mw);
      const e = mw.elements;
      const wc = V3(cx, cy, cz).applyMatrix4(mw);
      const ch = CH_OVERRIDE || CH;
      const key = (o.decal ? 'd' : 's') + '|' + (this.single ? '0|0' : Math.floor(wc.x / ch) + '|' + Math.floor(wc.z / ch));
      let b = this.b.get(key); if (!b){ b = { P: [], Nn: [], Hn: [], Cc: [], S: [], I: [], decal: !!o.decal }; this.b.set(key, b); }
      const cattr = g.attributes.color, sattr = g.attributes.aSway;
      const cc = color != null ? col(color) : null;
      const sw = o.sway || 0, ax = o.swayAxis || 'y';
      const tv = V3(0, 0, 0), nv = V3(0, 0, 0);
      for (let i = 0; i < n; i++){
        const lx = pa.getX(i), ly = pa.getY(i), lz = pa.getZ(i);
        tv.set(lx, ly, lz).applyMatrix4(mw); b.P.push(tv.x, tv.y, tv.z);
        nv.set(na.getX(i), na.getY(i), na.getZ(i)).applyMatrix3(nm).normalize(); b.Nn.push(nv.x, nv.y, nv.z);
        // hull normal: ellipsoid-style radial direction — watertight for any convex primitive
        const rx = (lx - cx) / hx, ry = (ly - cy) / hy, rz = (lz - cz) / hz;
        nv.set(rx, ry, rz); if (nv.lengthSq() < 1e-8) nv.set(na.getX(i), na.getY(i), na.getZ(i));
        nv.normalize().applyMatrix3(nm).normalize(); b.Hn.push(nv.x, nv.y, nv.z);
        if (cattr) b.Cc.push(cattr.getX(i), cattr.getY(i), cattr.getZ(i)); else b.Cc.push(cc.r, cc.g, cc.b);
        let sv = 0;
        if (sattr) sv = sattr.getX(i) * (sw || 1);
        else if (sw){ let f = ax === 'x' ? (lx - bb.min.x) / (2 * hx) : ax === 'z' ? (lz - bb.min.z) / (2 * hz) : (ly - bb.min.y) / (2 * hy); if (o.swayInv) f = 1 - f; sv = sw * f * f; }
        b.S.push(sv); b.I.push(MOBILE && ink < 0.07 ? 0 : (ink || 0));   // phones: small props lose their ink hull (halves their triangles)
      }
      return this;
    };
    const _lm = new THREE.Matrix4(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(), _sv = new THREE.Vector3(), _pv = new THREE.Vector3();
    function lmat(x, y, z, rx, ry, rz, sx, sy, sz){ _eu.set(rx || 0, ry || 0, rz || 0, 'YXZ'); _q.setFromEuler(_eu); return _lm.compose(_pv.set(x, y, z), _q, _sv.set(sx, sy, sz)); }
    // box centred at (x,y,z)
    Kit.prototype.box = function(w, h, d, x, y, z, color, ink, o){ o = o || {}; return this.addGeo(gBox(), lmat(x, y, z, o.rx, o.ry, o.rz, w, h, d), color, ink == null ? 0.05 : ink, o); };
    // straight cylinder: radius r, height h, base at y
    Kit.prototype.cyl = function(r, h, x, y, z, color, ink, seg, o){ o = o || {}; return this.addGeo(gCyl(1, 1, seg || 8), lmat(x, y + h / 2, z, o.rx, o.ry, o.rz, r, h, r), color, ink == null ? 0.05 : ink, o); };
    // cylinder centred at yc (for rotated pieces such as laid-down hay bales)
    Kit.prototype.cylC = function(r, h, x, yc, z, color, ink, seg, o){ o = o || {}; return this.addGeo(gCyl(1, 1, seg || 8), lmat(x, yc, z, o.rx, o.ry, o.rz, r, h, r), color, ink == null ? 0.05 : ink, o); };
    // tapered cylinder / cone: bottom radius rb, top radius rt, height h, base at y (cached geometry)
    Kit.prototype.cone = function(rb, rt, h, x, y, z, color, ink, seg, o){ o = o || {}; return this.addGeo(gCyl(rt, rb, seg || 8), lmat(x, y + h / 2, z, o.rx, o.ry, o.rz, 1, h, 1), color, ink == null ? 0.05 : ink, o); };
    // ellipsoid centred at (x,y,z)
    Kit.prototype.sph = function(rx, ry, rz, x, y, z, color, ink, o){ o = o || {}; return this.addGeo(gSph(o.ws || 10, o.hs || 7), lmat(x, y, z, o.rx, o.ry, o.rz, rx, ry, rz), color, ink == null ? 0.05 : ink, o); };
    Kit.prototype.finish = function(parent, opts){
      opts = opts || {};
      const out = [];
      for (const [key, b] of this.b){
        const n = b.P.length / 3; if (!n) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(b.P, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(b.Nn, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(b.Cc, 3));
        g.setAttribute('aSway', new THREE.Float32BufferAttribute(b.S, 1));
        g.setAttribute('aInk', new THREE.Float32BufferAttribute(b.I, 1));
        g.computeBoundingSphere(); g.boundingSphere.radius += 3;      // padding for the wind wobble + ink hull
        const mesh = new THREE.Mesh(g, b.decal ? MAT.decal : (opts.mat || MAT.solid));
        mesh.userData.hhKit = true; mesh.userData.noOutline = true; mesh.name = 'hh_' + key;
        parent.add(mesh); out.push(mesh);
        if (!b.decal && !opts.noInk){
          // hull only for triangles that asked for ink (ink 0 = double-winding leaves/flags, which a BackSide hull would paint black)
          const HP = [], HN = [], HS = [], HI = [];
          for (let t = 0; t + 2 < n; t += 3){
            if (!(b.I[t] > 0)) continue;
            for (let q = 0; q < 3; q++){ const v = t + q; HP.push(b.P[v * 3], b.P[v * 3 + 1], b.P[v * 3 + 2]); HN.push(b.Hn[v * 3], b.Hn[v * 3 + 1], b.Hn[v * 3 + 2]); HS.push(b.S[v]); HI.push(b.I[v]); }
          }
          if (HP.length){
            const hg = new THREE.BufferGeometry();
            hg.setAttribute('position', new THREE.Float32BufferAttribute(HP, 3));
            hg.setAttribute('normal', new THREE.Float32BufferAttribute(HN, 3));
            hg.setAttribute('aSway', new THREE.Float32BufferAttribute(HS, 1)); hg.setAttribute('aInk', new THREE.Float32BufferAttribute(HI, 1));
            hg.boundingSphere = g.boundingSphere;
            const h = new THREE.Mesh(hg, INKMAT); h.userData.noOutline = true; h.userData.noToon = true; h.userData.fkOutline = true; h.name = 'hh_ink_' + key;
            parent.add(h); out.push(h);
          }
        }
      }
      this.b.clear();
      return out;
    };
    const kit = new Kit();      // the main static dressing kit (finished at the end of build)
    // ground-decal helper: a quad strip / polygon draped on the terrain
    function ribbonGeo(pts, widths, yfn, colors){
      // pts: [{x,z}], widths: number or fn(i)->[left,right] offsets; yfn(x,z)->y ; colors: fn(i)->hex or single
      const pos = [], cl = [], idx = []; const n = pts.length;
      for (let i = 0; i < n; i++){
        const p = pts[i], q = pts[Math.min(n - 1, i + 1)], o = pts[Math.max(0, i - 1)];
        let tx = q.x - o.x, tz = q.z - o.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const w = typeof widths === 'function' ? widths(i) : [widths / 2, -widths / 2];
        const nx = -tz, nz = tx;
        for (const off of w){ const x = p.x + nx * off, z = p.z + nz * off; pos.push(x, yfn(x, z, p), z); }
        const c = col(typeof colors === 'function' ? colors(i) : colors); cl.push(c.r, c.g, c.b, c.r, c.g, c.b);
        if (i > 0){ const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
      g.setIndex(idx); g.computeVertexNormals(); return g;
    }
    // add an arbitrary prebuilt (vertex-coloured) decal geometry into a kit as a decal piece
    function addDecalGeo(k, g, sway){
      if (!g.attributes.normal) g.computeVertexNormals();
      // force up-facing normals so toon shading on draped decals is uniform
      const na = g.attributes.normal; for (let i = 0; i < na.count; i++) na.setXYZ(i, 0, 1, 0);
      k.addGeo(g, new THREE.Matrix4(), null, 0, { decal: true });
    }

    // ------------------------------------------------------------------------------------------
    //  SKY: golden-afternoon storybook dome, light + fog, cumulus clusters, gumdrop hill rings
    // ------------------------------------------------------------------------------------------
    const HAZE = 0xf3dfba;                                  // horizon haze == fog colour (distant hills melt into it)
    const SUNDIR = V3(0.62, 0.40, -0.55).normalize();       // low warm sun, behind-left of the start heading
    let hemiL = null, sunL = null;
    scene.traverse(o => { if (o.isHemisphereLight && !hemiL) hemiL = o; else if (o.isDirectionalLight && !sunL) sunL = o; });
    // Toon ramp tops out at 1.0, so the lit band should land near the picked colour: sun+hemi ~ 1.0 on a sunlit top.
    if (hemiL){ hemiL.color.setHex(0xe6f2ff); hemiL.groundColor.setHex(0xb59a62); hemiL.intensity = 0.52; }
    if (sunL){ sunL.color.setHex(0xffe0a6); sunL.intensity = 0.68; sunL.position.set(SUNDIR.x * 120, SUNDIR.y * 120, SUNDIR.z * 120); }
    scene.fog = new THREE.Fog(HAZE, 250, 880);
    const prevSky = ctx.getSkyObj ? ctx.getSkyObj() : null;
    if (prevSky) prevSky.visible = false;                   // the generic 'sun' preset glare sprite is replaced by the dome's own disc
    const dome = T.skyDome([[-1, HAZE], [0.0, HAZE], [0.045, 0xffdca4], [0.17, 0xd8e8ea], [0.40, 0x93cdf2], [0.75, 0x57aeea], [1, 0x3f93e2]],
      { sunDir: SUNDIR, sunColor: 0xfff3c4, sunSize: 0.0032, glow: 0.62, radius: 700 });
    dome.userData.hhFar = true; root.add(dome);

    // clouds: merged outlined cumulus clusters on a ring that follows the camera (reads as infinitely far) and drifts
    const cloudRoot = new THREE.Group(); root.add(cloudRoot);
    {
      const ck = new Kit(); const crng = T.rng(77);
      const n = MOBILE ? 9 : 16;
      for (let i = 0; i < n; i++){
        const a = (i / n) * TAU + crng() * 0.25, rad = 360 + crng() * 220, y = 95 + crng() * 120, s = 0.55 + crng() * 0.75;
        const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad;
        const puffs = 5 + Math.floor(crng() * 4);
        const dir = a + Math.PI / 2;                          // cluster stretches tangentially
        for (let j = 0; j < puffs; j++){
          const u = (j / (puffs - 1) - 0.5) * 2, r = (14 + crng() * 10) * s * (1 - 0.4 * Math.abs(u));
          const px = cx + Math.cos(dir) * u * 30 * s, pz = cz + Math.sin(dir) * u * 30 * s;
          ck.sph(r, r * 0.88, r, px, y + (1 - Math.abs(u)) * 8 * s + crng() * 4, pz, j % 2 ? 0xffffff : 0xfffaf0, 0.55, { ws: 8, hs: 5 });
        }
        // flat-ish belly so the base reads as a cloud, not a bunch of balls
        ck.sph(32 * s, 11 * s, 14 * s, cx, y - 5 * s, cz, 0xf1f4ff, 0.55, { ws: 10, hs: 5, ry: -dir });
      }
      CH_OVERRIDE = 1e7; ck.finish(cloudRoot, { mat: MAT.cloud }); CH_OVERRIDE = 0;
      cloudRoot.traverse(o => { if (o.isMesh){ o.frustumCulled = false; o.renderOrder = -5; o.userData.hhFar = true; } });
      // clouds are lit by the same toon ramp; keep their shaded undersides light (storybook, not storm)
    }
    // rolling gumdrop hills: three atmospheric layers sitting on the skirt below
    // ------------------------------------------------------------------------------------------
    //  SKIRT: continues the played ground past its edge, rising into rolling far hills (analytic height)
    // ------------------------------------------------------------------------------------------
    const HXW = (GX1 - GX0) / 2, HZW = (GZ1 - GZ0) / 2;
    const rectNorm = (x, z) => Math.max(Math.abs(x - CXW) / HXW, Math.abs(z - CZW) / HZW);
    function skirtH(x, z){
      const f = rectNorm(x, z);
      if (f <= 1){ return GH(x, z); }
      const pin = { x: CXW + (x - CXW) / f, z: CZW + (z - CZW) / f };
      const edge = GH(pin.x, pin.z);
      const t = sstep(1.0, 1.7, f);
      const hill = 3 + 26 * Math.pow(vnoise(x * 0.0085 + 4.1, z * 0.0085 - 2.7), 1.3) * (0.35 + 0.65 * sstep(1.25, 2.4, f));
      return lerp(edge, hill, t);
    }
    // the ground colour palette (shared by the played ground, the skirt and the hills)
    const GR = { mowA: col(0x7ccf3d), mowB: col(0x69bf33), medA: col(0x86d045), medB: col(0x6cba37), lite: col(0xa6dc54), deep: col(0x4fa63a), shoulder: col(0xd3a864),
      field: col(0x8f5c33), fieldDry: col(0xa5703e), yard: col(0xc9a06a), sand: col(0xe7cf94), haze: col(HAZE) };
    const _tmpc = new THREE.Color();
    function grassColor(x, z, d, hgt){
      const c = new THREE.Color();
      // broad cartoon meadow patches (thresholded value noise = hard-edged storybook patches)
      const n1 = vnoise(x * 0.022 + 9.3, z * 0.022 + 1.7), n2 = vnoise(x * 0.07 - 3.1, z * 0.07 + 7.7);
      // soft thresholds: vertex colours interpolate over the 2.5u mesh, so hard steps would stair-step
      const base = new THREE.Color().copy(GR.medB).lerp(GR.medA, sstep(0.44, 0.56, n2)).lerp(GR.lite, sstep(0.58, 0.72, n1)).lerp(GR.deep, 1 - sstep(0.2, 0.34, n1));
      if (d < 46){
        // mown verge: stripes parallel to the road, alternating every 6.5u, fading into meadow
        const band = Math.floor(d / 6.5) & 1, w = 1 - sstep(30, 46, d);
        c.copy(base).lerp(band ? GR.mowB : GR.mowA, 0.85 * w);
      } else c.copy(base);
      if (hgt != null) c.multiplyScalar(0.94 + 0.012 * clamp(hgt, -2, 8));   // sun-kissed hilltops
      return c;
    }

    // ------------------------------------------------------------------------------------------
    //  GROUND: re-colour the played grass mesh (mown stripes, meadow patches, tilled fields, yard, shoreline sand)
    // ------------------------------------------------------------------------------------------
    let groundMesh = null, roadMesh = null, curbMeshes = [];
    root.parent.traverse(o => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const pc = o.geometry.attributes.position.count;
      if (o.userData.hhKit) return;
      if (pc > 9000 && o.geometry.attributes.color && (!groundMesh || pc > groundMesh.geometry.attributes.position.count)) groundMesh = o;
      // flat roads build the bed as ONE span (N*2 verts) and each curb the same; draped roads subdivide the bed to 9 columns.
      // buildRibbonGeometry adds [road, curbL, curbR] in that order, so the first N*2 mesh is the road bed.
      if (pc === N * 9 && !o.geometry.attributes.color) roadMesh = o;
      else if (pc === N * 2 && !o.geometry.attributes.color && o.geometry.index) curbMeshes.push(o);
    });
    const BASE_G = [0x86a862 >> 16 & 255, 0x86a862 >> 8 & 255, 0x86a862 & 255].map(v => v / 255);
    if (groundMesh){
      const g = groundMesh.geometry, pa = g.attributes.position, ca = g.attributes.color, n = pa.count;
      const fieldTile = (x, z) => { const s = Math.floor(x / 2.2) & 1; return s ? GR.field : GR.fieldDry; };
      for (let i = 0; i < n; i++){
        const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
        const old = [ca.getX(i), ca.getY(i), ca.getZ(i)];
        const m = 0.9 + 0.1 * (0.5 + 0.5 * Math.sin(x * 0.021 + z * 0.013) * Math.cos(z * 0.017 - x * 0.009));
        const diff = Math.abs(old[0] - BASE_G[0] * m) + Math.abs(old[1] - BASE_G[1] * m) + Math.abs(old[2] - BASE_G[2] * m);
        const pw = sstep(0.04, 0.2, diff);                          // paint weight at this vertex (borders are soft)
        const rd = roadD(x, z);
        const c = grassColor(x, z, rd, y);
        if (pw > 0){
          const r = old[0], gg = old[1];
          let tone;
          if (r > 0.7 && gg > 0.58) tone = fieldTile(x, z);           // gold paint = the crop fields: tilled soil
          else if (r < 0.58) tone = GR.yard;                          // dark brown paint = barnyard dirt
          else tone = GR.sand;                                        // light brown paint = ford banks
          c.lerp(tone, pw);
        }
        // packed-dirt shoulder hugging the road edge
        if (rd < hw + 2.4) c.lerp(GR.shoulder, 1 - sstep(hw + 0.2, hw + 2.4, rd));
        ca.setXYZ(i, c.r, c.g, c.b);
      }
      ca.needsUpdate = true;
      groundMesh.material = T.mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide });
      groundMesh.material.userData.hhArt = true;
    }
    // skirt mesh
    {
      const per = []; const step = 5;
      const nx = Math.ceil((GX1 - GX0) / 2.5), nz = Math.ceil((GZ1 - GZ0) / 2.5);
      const X1 = GX0 + nx * 2.5, Z1 = GZ0 + nz * 2.5;
      // inner border points of the played ground, walked around the rectangle
      for (let x = GX0; x < X1; x += step) per.push([x, GZ0]);
      for (let z = GZ0; z < Z1; z += step) per.push([X1, z]);
      for (let x = X1; x > GX0; x -= step) per.push([x, Z1]);
      for (let z = Z1; z > GZ0; z -= step) per.push([GX0, z]);
      const F = [1, 1.03, 1.08, 1.16, 1.28, 1.45, 1.7, 2.0, 2.4, 2.9];
      const K = F.length, M = per.length;
      const pos = [], cl = [], idx = [];
      const cx = (GX0 + X1) / 2, cz = (GZ0 + Z1) / 2;
      for (let k = 0; k < K; k++) for (let j = 0; j < M; j++){
        const px = cx + (per[j][0] - cx) * F[k], pz = cz + (per[j][1] - cz) * F[k];
        const y = k === 0 ? GH(per[j][0], per[j][1]) : skirtH(px, pz);
        pos.push(px, y, pz);
        const c = grassColor(px, pz, 99, y);
        c.lerp(GR.haze, sstep(1.3, 3.2, F[k]) * 0.38);
        cl.push(c.r, c.g, c.b);
      }
      for (let k = 0; k + 1 < K; k++) for (let j = 0; j < M; j++){
        const a = k * M + j, b = k * M + (j + 1) % M, c = (k + 1) * M + j, d = (k + 1) * M + (j + 1) % M;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, T.mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
      m.name = 'hhSkirt'; m.userData.hhKit = true; m.userData.hhFar = true; m.frustumCulled = false; m.userData.noOutline = true; root.add(m);
    }
    // gumdrop hills sitting on the skirt: near / mid / far layers, tinted toward the haze
    {
      const hk = new Kit(); const hr = T.rng(311);
      const layers = [[1.95, 2.25, 0x6cc044, 0.9, 16], [2.35, 2.6, 0x57b072, 0.7, 14], [2.75, 2.95, 0x7fb6c8, 0.5, 12]];
      layers.forEach(([f0, f1, hex, ink, cnt], li) => {
        const n = Math.round(cnt * (MOBILE ? 0.7 : 1));
        for (let i = 0; i < n; i++){
          const a = ((i + hr() * 0.8) / n) * TAU;
          const f = lerp(f0, f1, hr());
          // point on the scaled rectangle in direction a
          const dx = Math.cos(a), dz = Math.sin(a), t = Math.min(HXW / Math.abs(dx || 1e-6), HZW / Math.abs(dz || 1e-6));
          const x = CXW + dx * t * f, z = CZW + dz * t * f;
          const s = 38 + hr() * 46, y = skirtH(x, z);
          const c = col(hex).lerp(GR.haze, li * 0.1 + 0.05);
          hk.sph(s, s * (0.5 + hr() * 0.25), s * (0.9 + hr() * 0.3), x, y - s * 0.12, z, c, ink * 1.4, { ws: 14, hs: 8, ry: hr() * 3 });
        }
      });
      // far farm silhouettes on the nearest hill ring: barn, silo, windmill, tree clumps
      const fr = T.rng(91);
      for (let i = 0; i < (MOBILE ? 5 : 9); i++){
        const a = (i / 9) * TAU + 0.2 + fr() * 0.3, dx = Math.cos(a), dz = Math.sin(a), t = Math.min(HXW / Math.abs(dx || 1e-6), HZW / Math.abs(dz || 1e-6));
        const f = 1.72 + fr() * 0.12, x = CXW + dx * t * f, z = CZW + dz * t * f, y = skirtH(x, z);
        hk.place(x, y, z, a + Math.PI / 2, k => {
          k.box(7, 5, 10, 0, 2.5, 0, 0xc9473a, 0.35); k.box(7.6, 0.8, 10.6, 0, 5.3, 0, 0x6d5560, 0.35); k.cyl(1.7, 9, 6, 0, 0, 0xd9d2c4, 0.35, 10); k.sph(1.8, 1.3, 1.8, 6, 9.3, 0, 0xc9473a, 0.3);
          for (let q = 0; q < 4; q++) k.sph(3 + fr() * 2, 4 + fr() * 2, 3 + fr() * 2, -10 + q * 5 - 14, 4, 6 + fr() * 6, 0x4f9e48, 0.4);
          k.cyl(0.4, 3, -10, 0, 5, 0x7a5a38, 0.3, 6);
        });
      }
      CH_OVERRIDE = 1e7; hk.finish(root).forEach(m => { m.userData.hhFar = true; }); CH_OVERRIDE = 0;
    }

    // ------------------------------------------------------------------------------------------
    //  ROAD: packed dirt with wheel ruts + pebbles (canvas texture, tiled along the arc), candy curbs, centre dashes
    // ------------------------------------------------------------------------------------------
    function makeRoadTexture(){
      const W = 512, Hh = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const g = cv.getContext('2d'); const tr = T.rng(4242);
      g.fillStyle = '#cf9a58'; g.fillRect(0, 0, W, Hh);
      // storybook mottling: flat patches, wrapped so the tile is seamless along v
      const blob = (x, y, rx, ry, rot, style) => { g.fillStyle = style; for (const oy of [-Hh, 0, Hh]){ g.beginPath(); g.ellipse(x, y + oy, rx, ry, rot, 0, TAU); g.fill(); } };
      for (let i = 0; i < 60; i++) blob(tr() * W, tr() * Hh, 20 + tr() * 60, 8 + tr() * 22, tr() * 3, tr() > 0.5 ? '#d8a561' : '#c28d4d');
      // wheel ruts (periodic wobble so the tile joins), with a pale ridge on both sides
      const rut = (u0, wd) => {
        for (let pass = 0; pass < 3; pass++){
          g.beginPath();
          const k = 2, half = pass === 0 ? wd / 2 + 6 : pass === 1 ? wd / 2 : wd / 2 - 7;
          const style = pass === 0 ? '#dcb272' : pass === 1 ? '#a8723a' : '#936230';
          for (let y = 0; y <= Hh; y += 8){ const x = u0 * W + Math.sin(y / Hh * TAU * k) * 5 - half; y === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
          for (let y = Hh; y >= 0; y -= 8){ const x = u0 * W + Math.sin(y / Hh * TAU * k) * 5 + half; g.lineTo(x, y); }
          g.closePath(); g.fillStyle = style; g.fill();
        }
      };
      rut(0.30, 30); rut(0.70, 30);
      // pebbles with a dark underside (cartoon stones)
      for (let i = 0; i < 120; i++){
        const x = tr() * W, y = tr() * Hh, r = 1.4 + tr() * 2.6;
        blob(x + 1.2, y + 1.2, r, r * 0.7, tr() * 3, '#8a5a2c');
        blob(x, y, r, r * 0.7, tr() * 3, tr() > 0.5 ? '#e8cf9a' : '#d9b676');
      }
      // grass-seed speckle in the crown between the ruts
      for (let i = 0; i < 40; i++){ blob(W * 0.5 + (tr() - 0.5) * 70, tr() * Hh, 2, 5, tr() * 3, '#9bb445'); }
      // edge dark line
      g.fillStyle = '#b98543'; g.fillRect(0, 0, 9, Hh); g.fillRect(W - 9, 0, 9, Hh);
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = Math.min(8, ctx.renderer ? ctx.renderer.capabilities.getMaxAnisotropy() : 4);
      tex.needsUpdate = true; return tex;
    }
    const TILE = TLEN / Math.max(1, Math.round(TLEN / 24));
    let roadTex = null;
    if (!roadMesh && curbMeshes.length >= 3) roadMesh = curbMeshes.shift();
    // remember what the track data asked for (the suite checks roadColor/curbColor plumbing through these)
    ART_STATS.origRoadHex = roadMesh ? roadMesh.material.color.getHex() : null; ART_STATS.origCurbHex = curbMeshes.length ? curbMeshes[0].material.color.getHex() : null;
    if (roadMesh){
      roadTex = makeRoadTexture();
      const op = roadMesh.geometry.attributes.position, cols = op.count / N;
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= N; i++){
        const ii = i % N;
        for (let w = 0; w < cols; w++){
          const vi = ii * cols + w; pos.push(op.getX(vi), op.getY(vi), op.getZ(vi));
          uv.push(w / (cols - 1), (i === N ? TLEN : AS[ii]) / TILE);
        }
      }
      for (let i = 0; i < N; i++) for (let w = 0; w < cols - 1; w++){ const a = i * cols + w, b = a + 1, c = (i + 1) * cols + w, d = c + 1; idx.push(a, b, c, b, d, c); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      roadMesh.geometry.dispose(); roadMesh.geometry = g;
      roadMesh.material = T.mat(0xffffff, { map: roadTex, side: THREE.DoubleSide });
      roadMesh.material.userData.hhArt = true;
    }
    for (const cm of curbMeshes){ cm.material = T.mat(0xa8763c, { side: THREE.DoubleSide }); cm.material.userData.hhArt = true; }

    // road edge helpers
    const curv = new Float32Array(N); for (let i = 0; i < N; i++) curv[i] = curvAt(i, 10);
    const inRampZone = (x, z) => TR.objects && TR.objects.some(o => o.type === 'ramp' && Math.hypot(o.x - x, o.z - z) < 16);
    // candy-stripe curbs on the inside (and, in tight bends, outside) edge of corners
    {
      const stripeL = 2.2, CT = 0.012, CT2 = 0.026;
      const prism = (a, b, c, d, y0, y1, topc, sidec) => {   // quad (a,b,c,d) top at y1 (per-vertex y), skirt down to y0
        const P = [], N3 = [], Cc = [];
        const tri = (p, q, r, cc) => { P.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z); const ux = q.x - p.x, uy = q.y - p.y, uz = q.z - p.z, vx = r.x - p.x, vy = r.y - p.y, vz = r.z - p.z;
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; for (let q2 = 0; q2 < 3; q2++){ N3.push(nx / l, ny / l, nz / l); Cc.push(cc.r, cc.g, cc.b); } };
        const top = [a, b, c, d];
        tri(a, c, b, topc); tri(b, c, d, topc);
        const lo = pt => ({ x: pt.x, y: pt.y - 0.5, z: pt.z });
        // outer side (c,d are the outer edge) and the two ends
        tri(c, lo(c), d, sidec); tri(d, lo(c), lo(d), sidec);
        tri(a, lo(a), c, sidec); tri(c, lo(a), lo(c), sidec);
        tri(b, d, lo(b), sidec); tri(d, lo(d), lo(b), sidec);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N3, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
        return g;
      };
      const RED = col(0xe8392d), WHITE = col(0xfff4e2), REDS = col(0xb5251d), WHITES = col(0xd8cdb8);
      const curbK = new Kit();
      let nCurb = 0;
      for (const side of [1, -1]){                // +1 left edge, -1 right edge
        // a corner's INSIDE edge is on the side the road turns toward: curv>0 turns left (cross>0)
        let s = 0;
        while (s < TLEN){
          const i = idxAtS(s + stripeL / 2), cv = curv[i];
          const inside = (cv > 0 ? 1 : -1) === side;
          const want = Math.abs(cv) > (inside ? CT : CT2);
          if (want){
            const stripeIdx = Math.round(s / stripeL);
            const p0 = atS(s, 0), p1 = atS(s + stripeL, 0);
            const o0 = side * (hw - 0.45), o1 = side * (hw + 0.75);
            const mk = (p, o) => { const xx = p.x + p.nx * o, zz = p.z + p.nz * o; return { x: xx, y: p.y + 0.2, z: zz }; };
            const A0 = mk(p0, o0), B0 = mk(p1, o0), A1 = mk(p0, o1), B1 = mk(p1, o1);
            const red = (stripeIdx & 1) === 0;
            // winding: keep the top facing up whichever edge we are on
            const g = side > 0 ? prism(A0, B0, A1, B1, 0, 0, red ? RED : WHITE, red ? REDS : WHITES) : prism(B0, A0, B1, A1, 0, 0, red ? RED : WHITE, red ? REDS : WHITES);
            curbK.addGeo(g, new THREE.Matrix4(), null, 0.05); nCurb++;
            registry.push({ kind: 'curb', x: (p0.x + p1.x) / 2 + p0.nx * side * hw, y: p0.y, z: (p0.z + p1.z) / 2 + p0.nz * side * hw, r: 1.1, road: true });
          }
          s += stripeL;
        }
      }
      curbK.finish(root).forEach(m => { m.userData.hhRoad = true; });
      ART_STATS.curbStripes = nCurb;
    }
    // painted centre dashes on the straights (cream, drawn as decals above the road)
    {
      const dk = new Kit(); let nd = 0;
      for (let s = 6; s < TLEN - 6; s += 8){
        const i0 = idxAtS(s), i1 = idxAtS(s + 3);
        if (Math.abs(curv[i0]) > 0.011 || Math.abs(curv[i1]) > 0.011) continue;
        const pts = [atS(s, 0), atS(s + 1.5, 0), atS(s + 3, 0)];
        if (pts.some(p => wet(p.x, p.z) || railD(p.x, p.z) < 10 || inRampZone(p.x, p.z))) continue;
        const g = ribbonGeo(pts, 0.5, (x, z, p) => p.y + 0.15, 0xfff3d2);
        addDecalGeo(dk, g); nd++;
      }
      dk.finish(root).forEach(m => { m.userData.hhRoad = true; }); ART_STATS.dashes = nd;
    }

    // the track's hay-jump ramp (object type 'ramp'): re-skin it as a toon hay-bale ramp with ink (it stays exactly where/what it was)
    for (const o of (TR.objects || [])){
      if (o.type !== 'ramp') continue;
      for (const g of scene.children){
        if (!g.isGroup || g.name === 'hhArt' || Math.hypot(g.position.x - o.x, g.position.z - o.z) > 0.6) continue;
        g.traverse(m => { if (m.isMesh && m.material && !m.userData.fkOutline){ m.material = T.mat(m.material.color ? m.material.color.getHex() : 0xe6b85a, { side: THREE.DoubleSide }); m.material.color.lerp(col(0xf4c455), 0.7); m.material.userData.hhArt = true; } });
        T.outlineTree(g, 0.09);
      }
    }
    // ------------------------------------------------------------------------------------------
    //  SMALL TOOLKIT FOR LANDMARKS
    // ------------------------------------------------------------------------------------------
    const PAL = { red: 0xe5392f, redD: 0xb02a22, cream: 0xfff1d0, wood: 0xa8703a, woodD: 0x7a4e28, woodL: 0xd29a5a, hay: 0xf2c24a, hayD: 0xd9a233, green: 0x4cb043, greenD: 0x2f8a3a,
      stone: 0xcfc6b4, stoneD: 0xa89f8e, sky: 0x4fb4e8, yellow: 0xffd23d, teal: 0x2ec4b6, pink: 0xff7aa8, white: 0xffffff, orange: 0xff8a2a, brown: 0x6a4630, plum: 0x8a5bd6 };
    function findSpot(x, z, r, maxRad, o){
      for (let k = 0; k < 160; k++){
        const a = k * 2.399963, d = Math.sqrt(k) * (maxRad / 12.6);
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        if (ok(px, pz, r, o)) return { x: px, z: pz };
      }
      return null;
    }
    // draw a canvas sign texture
    function signTexture(lines, w, h, bg, fg, border){
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.strokeStyle = border || '#2b1a12'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      const n = lines.length;
      lines.forEach((ln, i) => {
        const fs = Math.floor((h / (n + 0.5)) * (i === 0 ? 0.78 : 0.62));
        g.font = '900 ' + fs + 'px "Trebuchet MS", "Arial Black", sans-serif';
        g.lineWidth = Math.max(3, fs * 0.12); g.strokeStyle = 'rgba(43,26,18,.9)';
        const yy = (i + 0.75) * h / (n + 0.5);
        g.strokeText(ln, w / 2, yy); g.fillText(ln, w / 2, yy);
      });
      const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; t.needsUpdate = true; return t;
    }
    const signMeshes = [];
    // sign on two posts: centre (x,z), facing yaw ry (local +z = front), panel w x h, bottom at clearance cy
    function addSign(x, z, ry, w, h, lines, bg, fg, cy, kitUse){
      const y0 = H(x, z); const kk = kitUse || kit;
      cy = cy == null ? 1.1 : cy;
      kk.place(x, y0, z, ry, k => {
        k.cyl(0.14, cy + h + 0.4, -w / 2 + 0.25, 0, -0.1, PAL.woodD, 0.04, 6); k.cyl(0.14, cy + h + 0.4, w / 2 - 0.25, 0, -0.1, PAL.woodD, 0.04, 6);
        k.box(w + 0.35, h + 0.3, 0.2, 0, cy + h / 2, -0.12, PAL.woodL, 0.05);
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), T.mat(0xffffff, { map: signTexture(lines, 256, Math.round(256 * h / w), bg || '#fff1d0', fg || '#c9362b') }));
      m.position.set(x, y0 + cy + h / 2, z); m.rotation.y = ry; m.translateZ(0.01);
      m.userData.noOutline = true; root.add(m); signMeshes.push(m);
      const bk = new THREE.Mesh(new THREE.PlaneGeometry(w, h), T.mat(PAL.woodL)); bk.position.copy(m.position); bk.rotation.y = ry + Math.PI; bk.translateZ(0.01); bk.userData.noOutline = true; root.add(bk);   // plain back so the sign is never see-through
      registry.push({ kind: 'sign', x, y: y0, z, r: w / 2 });
    }
    // bunting string between two world points (sags; triangular pennants that wave in the wind)
    function bunting(a, b, sag, count, cols, yTag){
      const P = [], Cc = [], S = [], Nn = [];
      const pts = [];
      for (let i = 0; i <= count; i++){ const u = i / count; pts.push(V3(lerp(a.x, b.x, u), lerp(a.y, b.y, u) - Math.sin(u * Math.PI) * sag, lerp(a.z, b.z, u))); }
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, fx = -dz / L, fz = dx / L;   // flutter normal
      let minY = 1e9;
      for (let i = 0; i < count; i++){
        const p = pts[i], q = pts[i + 1]; const c = col(cols[i % cols.length]);
        const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, mz = (p.z + q.z) / 2, drop = 1.25 * Math.min(1, L / (count * 1.7));
        const tri = [[p.x, p.y, p.z, 0], [q.x, q.y, q.z, 0], [mx, my - drop, mz, 1]];
        for (const t of tri){ P.push(t[0], t[1], t[2]); Cc.push(c.r, c.g, c.b); S.push(t[3] * 0.32); Nn.push(fx, 0.2, fz); minY = Math.min(minY, t[1]); }
        // reverse face so it reads from both sides under the FrontSide material
        for (const t of [tri[1], tri[0], tri[2]]){ P.push(t[0], t[1], t[2]); Cc.push(c.r, c.g, c.b); S.push(t[3] * 0.32); Nn.push(-fx, 0.2, -fz); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setAttribute('aSway', new THREE.Float32BufferAttribute(S, 1));
      kit.addGeo(g, new THREE.Matrix4(), null, 0);
      // the string itself
      for (let i = 0; i < count; i++){ const p = pts[i], q = pts[i + 1]; const len = p.distanceTo(q);
        const yaw = Math.atan2(q.x - p.x, q.z - p.z), pitch = -Math.atan2(q.y - p.y, Math.hypot(q.x - p.x, q.z - p.z));
        kit.box(0.07, 0.07, len + 0.05, (p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2, 0x6a4630, 0, { ry: yaw, rx: pitch }); }
      return minY;
    }
    // glowing lantern bulbs (Basic, unlit) are collected and instanced at the end
    const glows = [];
    // ------------------------------------------------------------------------------------------
    //  START / FINISH GANTRY (overhead, >= 6u clear of the road) + bunting + flags
    // ------------------------------------------------------------------------------------------
    const FIN = ctx.FINISH;
    const fnx = -FIN.tz, fnz = FIN.tx, fry = Math.atan2(FIN.tx, FIN.tz);
    let gantryMinClear = 0;
    {
      const SPAN = 16.2;             // pillar centres at +-SPAN laterally: outside the 12.5u fence line and 7u off the road edge
      const baseY = FIN.cy != null ? FIN.cy : H(FIN.cx, FIN.cz);
      const gpos = (lat) => ({ x: FIN.cx + fnx * lat, z: FIN.cz + fnz * lat });
      for (const sgn of [-1, 1]){
        const p = gpos(sgn * SPAN), y0 = H(p.x, p.z);
        kit.place(p.x, y0, p.z, fry, k => {
          // hay-bale plinth (3 horizontal bales), tall painted post, red cap + pennant mast
          for (let i = 0; i < 3; i++) k.cyl(1.05, 2.0, 0, i * 1.45 + 0.1, i % 2 ? 0.25 : -0.2, i % 2 ? PAL.hay : PAL.hayD, 0.07, 10, { rz: Math.PI / 2, ry: 0.2 * i });
          k.cyl(0.6, 12.8, 0, 3.9, 0, PAL.cream, 0.08, 10);
          for (let i = 0; i < 5; i++) k.cyl(0.62, 0.8, 0, 4.4 + i * 1.9, 0, PAL.red, 0.0, 10);
          k.cone(1.15, 0.2, 1.6, 0, 16.5, 0, PAL.red, 0.08, 10);
          k.cyl(0.07, 3.0, 0, 17.8, 0, PAL.woodD, 0.03, 5);
          // big waving pennant flag on the mast
          const fl = []; k.box(2.6, 1.4, 0.06, sgn * -1.4, 19.6, 0, sgn > 0 ? PAL.yellow : PAL.sky, 0.04, { sway: 0.5, swayAxis: 'x' });
        });
        registry.push({ kind: 'gantry-post', x: p.x, y: y0, z: p.z, r: 1.3 });
        claim(p.x, p.z, 2.4, 'gantry-post-claim');
      }
      // cross beam (overhead): clearance = beam underside above the road
      const bY = baseY + 12.6;
      kit.place(FIN.cx, bY, FIN.cz, fry, k => {
        k.box(SPAN * 2 + 1.6, 1.3, 1.3, 0, 0, 0, PAL.red, 0.08);
        for (let i = -7; i <= 7; i++) k.box(1.15, 1.31, 1.31, i * 2.2, 0, 0, i & 1 ? PAL.white : PAL.red, 0);
        k.box(SPAN * 2 + 0.4, 0.5, 0.5, 0, 1.0, 0, PAL.woodD, 0.05);
      });
      gantryMinClear = bY - 0.65 - baseY;
      registry.push({ kind: 'gantry-beam', overhead: true, x: FIN.cx, y: bY, z: FIN.cz, r: SPAN, minY: bY - 0.65 });
      // chequered strip hanging under the beam: a real black/white check made of quads (sways a little)
      {
        const cols = 28, rows = 2, w = SPAN * 2 - 1.2, cw = w / cols, ch = 0.85, y1 = bY - 0.7;
        const P = [], Cc = [], S = [], Nn = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++){
          const x0 = -w / 2 + c * cw, x1 = x0 + cw, ya = y1 - r * ch, yb = ya - ch, cc = col(((r + c) & 1) ? 0x1c1410 : 0xffffff);
          const qv = [[x0, ya], [x1, ya], [x0, yb], [x1, yb]];
          const w3 = (q) => { const wx = FIN.cx + fnx * q[0]; const wz = FIN.cz + fnz * q[0]; return [wx, q[1], wz]; };
          const A_ = w3(qv[0]), B_ = w3(qv[1]), C_ = w3(qv[2]), D_ = w3(qv[3]);
          // both windings per cell so the check reads from either side under the FrontSide material
          const sw = (yy) => (y1 - yy) / (rows * ch) * 0.18;
          for (const [t, ys, fl] of [[[A_, C_, B_], [ya, yb, ya], 1], [[B_, C_, D_], [ya, yb, yb], 1], [[A_, B_, C_], [ya, ya, yb], -1], [[B_, D_, C_], [ya, yb, yb], -1]]){
            t.forEach((v, i) => { P.push(v[0], v[1], v[2]); Cc.push(cc.r, cc.g, cc.b); S.push(sw(ys[i])); Nn.push(FIN.tx * fl, 0.2, FIN.tz * fl); });
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setAttribute('aSway', new THREE.Float32BufferAttribute(S, 1));
        kit.addGeo(g, new THREE.Matrix4(), null, 0);
        gantryMinClear = Math.min(gantryMinClear, y1 - rows * ch - baseY);
      }
      // textured banner board under the check
      {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 3.2), T.mat(0xffffff, { map: signTexture(['HARVEST HOLLOW', 'START  /  FINISH'], 512, 102, '#ffd23d', '#c9362b'), side: THREE.DoubleSide }));
        const by = bY - 0.7 - 1.7 - 1.65;
        m.position.set(FIN.cx, by, FIN.cz); m.rotation.y = fry + Math.PI; root.add(m); signMeshes.push(m);
        registry.push({ kind: 'gantry-banner', overhead: true, x: FIN.cx, y: by, z: FIN.cz, r: 8, minY: by - 1.6 });
        gantryMinClear = Math.min(gantryMinClear, by - 1.6 - baseY);
      }
      // bunting: along the beam and off the pillars to the posts down the lane
      const cl4 = [0xe5392f, 0xffd23d, 0x2ec4b6, 0xffffff, 0xff7aa8];
      const topL = { x: FIN.cx + fnx * -SPAN, y: bY + 1.5, z: FIN.cz + fnz * -SPAN }, topR = { x: FIN.cx + fnx * SPAN, y: bY + 1.5, z: FIN.cz + fnz * SPAN };
      bunting(topL, topR, 1.4, 26, cl4);
      ART_STATS.gantryClear = gantryMinClear;
      // chequered-flag marshals' posts + bale chicane markers at grid
    }
    // ------------------------------------------------------------------------------------------
    //  CHEERING CROWD (instanced critters; each part is one InstancedMesh, matrices animated per frame)
    // ------------------------------------------------------------------------------------------
    const crowd = { list: [] };
    function buildCrowd(){
      const n = crowd.list.length; if (!n) return;
      const gBody = new THREE.SphereGeometry(0.5, 8, 6), gHead = new THREE.SphereGeometry(0.34, 8, 6), gArm = new THREE.CylinderGeometry(0.07, 0.09, 0.6, 5), gEar = new THREE.ConeGeometry(0.1, 0.34, 5);
      gArm.translate(0, 0.3, 0);
      const mk = (g, c) => { const m = new THREE.InstancedMesh(g, T.mat(0xffffff), n); m.frustumCulled = false; root.add(m); T.outline(m, 0.035); return m; };
      const body = mk(gBody), head = mk(gHead), armL = mk(gArm), armR = mk(gArm), ear = mk(gEar);
      // after outline(): the hull instance shares matrices; colours are per source instance
      const palettes = [[0xfff6e8, 0xff5a4a], [0xffb3c7, 0xff9ab4], [0xe8d9b8, 0x8a5a32], [0xf2f2f2, 0x3a3a3a], [0xd9a066, 0xc97a35], [0xfff0a0, 0xffa000]];
      crowd.list.forEach((c, i) => { const p = palettes[c.kind % palettes.length]; body.setColorAt(i, col(c.shirt)); head.setColorAt(i, col(p[0])); armL.setColorAt(i, col(p[0])); armR.setColorAt(i, col(p[0])); ear.setColorAt(i, col(p[1])); });
      [body, head, armL, armR, ear].forEach(m => { m.instanceColor.needsUpdate = true; });
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S1 = new THREE.Vector3(1, 1, 1), P1 = new THREE.Vector3();
      crowd.meshes = [body, head, armL, armR, ear];
      crowd.update = (t) => {
        for (let i = 0; i < n; i++){
          const c = crowd.list[i];
          const ph = t * c.rate + c.ph, hop = Math.max(0, Math.sin(ph)) * 0.42;
          const y = c.y + 0.55 + hop, sq = 1 + Math.sin(ph * 2) * 0.04;
          const cs = Math.cos(c.ry), sn = Math.sin(c.ry);
          const put = (mesh, lx, ly, lz, rx, rz, sx, sy, sz) => {
            P1.set(c.x + cs * lx + sn * lz, y + ly, c.z - sn * lx + cs * lz);
            E.set(rx, c.ry, rz, 'YXZ'); Q.setFromEuler(E); M.compose(P1, Q, S1.set(sx, sy, sz)); mesh.setMatrixAt(i, M);
          };
          put(body, 0, 0, 0, 0, 0, 1 * c.s, 1.0 * c.s * sq, 0.9 * c.s);
          put(head, 0, 0.68 * c.s, 0.05, 0, 0, c.s, c.s, c.s);
          const w = 0.9 + Math.sin(ph) * 0.9;     // arms pump up and down
          put(armL, -0.48 * c.s, 0.12 * c.s, 0, 0, 2.7 - w * 0.5, c.s, c.s, c.s);
          put(armR, 0.48 * c.s, 0.12 * c.s, 0, 0, -2.7 + w * 0.5, c.s, c.s, c.s);
          put(ear, 0, 1.05 * c.s, 0.05, 0, 0, c.s, c.s, c.s);
        }
        [body, head, armL, armR, ear].forEach(m => { m.instanceMatrix.needsUpdate = true; });
      };
      crowd.update(0);
    }
    function addCritter(x, y, z, ry, s, kind, shirt, tier){
      crowd.list.push({ x, y, z, ry, s, kind, shirt, ph: rng() * 6.28, rate: 5 + rng() * 3, tier });
      registry.push({ kind: 'crowd', x, y, z, r: 0.5 * s });
    }
    // ------------------------------------------------------------------------------------------
    //  HAY-BALE GRANDSTAND beside the start straight (west side), with a striped awning and a cheering crowd
    // ------------------------------------------------------------------------------------------
    {
      const sP = atS(FIN.idx !== undefined ? AS[FIN.idx] + 14 : 14, 0);
      // east/west: choose the side whose spot is free (prefer the +n side = the world-west lane)
      let best = null;
      for (const side of [1, -1]) for (const lat of [26, 30, 34, 22]){
        const x = sP.x + sP.nx * lat * side, z = sP.z + sP.nz * lat * side;
        if (ok(x, z, 10, { noObj: false })){ best = { x, z, side, lat }; break; }
        if (best) break;
      }
      if (!best){ const sp = findSpot(sP.x + sP.nx * 28, sP.z + sP.nz * 28, 9, 22); if (sp) best = { x: sp.x, z: sp.z, side: 1, lat: 28 }; }
      if (best){
        const face = Math.atan2(-sP.nx * best.side, -sP.nz * best.side);     // front faces the road
        const y0 = H(best.x, best.z);
        const cs = Math.cos(face), sn = Math.sin(face);
        claim(best.x, best.z, 11, 'grandstand');
        kit.place(best.x, y0, best.z, face, k => {
          const per = [7, 6, 5];
          for (let t = 0; t < 3; t++) for (let lv = 0; lv <= t; lv++) for (let i = 0; i < per[t]; i++){
            const lx = (i - (per[t] - 1) / 2) * 2.3 + (lv & 1 ? 0.3 : 0);
            k.cylC(0.92, 2.15, lx, 0.92 + lv * 1.84, -t * 1.9, (i + t + lv) & 1 ? PAL.hay : PAL.hayD, 0.07, 10, { rx: Math.PI / 2 });
          }
          // posts + striped awning
          for (const px of [-8.0, 8.0]){ k.cyl(0.2, 7.3, px, 0, -5.9, PAL.woodD, 0.05, 6); k.cyl(0.2, 5.7, px, 0, 2.3, PAL.woodD, 0.05, 6); }
          for (let i = 0; i < 9; i++) k.box(1.9, 0.14, 8.6, -7.6 + i * 1.9, 6.5, -1.8, i & 1 ? PAL.red : PAL.white, 0.04, { rx: 0.18 });
          k.box(18.2, 0.35, 0.35, 0, 5.75, 2.3, PAL.redD, 0.04);
          // score board
          k.box(4.4, 1.7, 0.2, 0, 8.6, -6.2, PAL.woodL, 0.05);
        });
        // crowd on the three tiers
        const shirtC = [0xe5392f, 0x2ec4b6, 0xffd23d, 0x8a5bd6, 0xff8a2a, 0x4fb4e8, 0xff7aa8];
        for (let t = 0; t < 3; t++) for (let i = 0; i < [7, 6, 5][t]; i++){
          if (rng() < 0.12) continue;
          const lx = (i - ([7, 6, 5][t] - 1) / 2) * 2.3 + (t & 1 ? 0.3 : 0), ly = 1.84 * (t + 1), lz = -t * 1.9;
          const wx = best.x + cs * lx + sn * lz, wz = best.z - sn * lx + cs * lz;
          addCritter(wx, y0 + ly, wz, face, 0.95 + rng() * 0.2, Math.floor(rng() * 6), pick(shirtC), t);
        }
        // a few more cheering on the ground at the rail
        for (let i = 0; i < 6; i++){
          const lx = -7 + i * 2.8 + rng(), lz = 3.6 + rng();
          const wx = best.x + cs * lx + sn * lz, wz = best.z - sn * lx + cs * lz;
          if (ok(wx, wz, 0.6, { noOwn: true })) addCritter(wx, H(wx, wz), wz, face, 1.0, Math.floor(rng() * 6), pick(shirtC), 9);
        }
        // bunting from awning to awning pole + a banner
        const y1 = y0 + 5.9;
        bunting({ x: best.x + cs * -8 + sn * 2.3, y: y1 - 0.3, z: best.z - sn * -8 + cs * 2.3 }, { x: best.x + cs * 8 + sn * 2.3, y: y1 - 0.3, z: best.z - sn * 8 + cs * 2.3 }, 0.9, 14, [0xe5392f, 0xffffff, 0xffd23d]);
        ART_STATS.grandstand = { x: best.x, z: best.z };
      }
    }

    // ------------------------------------------------------------------------------------------
    //  CORNER CHEVRON BOARDS (outside edge of every real bend, pointing the way the road turns)
    // ------------------------------------------------------------------------------------------
    {
      let nCh = 0, lastS = -99;
      for (let s = 4; s < TLEN - 4; s += 3){
        const i = idxAtS(s), cv = curv[i];
        if (Math.abs(cv) < 0.015 || s - lastS < 12) continue;
        // inside of a bend is the n-side with sign(cv) (matches the curb code); boards stand on the OUTSIDE
        const side = -(cv > 0 ? 1 : -1);
        const q = atS(s, side * (hw + 4.3));
        if (!ok(q.x, q.z, 1.7)) continue;
        const dir = cv > 0 ? 1 : -1;               // +1: bend toward +n side
        // driver looks along +t; panel faces the driver (local +z = -t); local +x = driver's right = -n side
        const ry = Math.atan2(-q.tx, -q.tz), y0 = H(q.x, q.z);
        const pointRight = dir > 0;                // +n is the driver's right-hand side (facing +z, n = (-tz,tx) = -x = right)
        kit.place(q.x, y0, q.z, ry, k => {
          k.cyl(0.13, 2.7, -0.95, 0, -0.1, PAL.woodD, 0.04, 6); k.cyl(0.13, 2.7, 0.95, 0, -0.1, PAL.woodD, 0.04, 6);
          k.box(2.9, 1.9, 0.2, 0, 2.3, 0, 0x2b2b3a, 0.05);
          k.box(2.6, 1.6, 0.22, 0, 2.3, 0.02, PAL.yellow, 0.0);
          const sg = pointRight ? 1 : -1;
          k.box(1.05, 0.3, 0.24, -sg * 0.05, 2.3 + 0.38, 0.06, PAL.red, 0.0, { rz: sg * -0.8 });
          k.box(1.05, 0.3, 0.24, -sg * 0.05, 2.3 - 0.38, 0.06, PAL.red, 0.0, { rz: sg * 0.8 });
        });
        claim(q.x, q.z, 1.8, 'chevron'); nCh++; lastS = s;
      }
      ART_STATS.chevrons = nCh;
    }
    // ------------------------------------------------------------------------------------------
    //  WINDMILL ON THE HILLTOP TURN (animated sails). The track's static GLB windmill is hidden (it cannot spin).
    // ------------------------------------------------------------------------------------------
    let rotor = null;
    const hideTargets = [];
    {
      const old = (TR.objects || []).find(o => o.model === 'farm_tower_windmill');
      const tx0 = old ? old.x : -6, tz0 = old ? old.z : -128;
      const sp = findSpot(tx0, tz0 - 6, 11.5, 36) || findSpot(tx0, tz0 - 6, 9, 46);
      if (sp){
        const near = roadNear(sp.x, sp.z);
        const ry = Math.atan2(near.px - sp.x, near.pz - sp.z);        // sails face the road
        const y0 = H(sp.x, sp.z);
        claim(sp.x, sp.z, 11.5, 'windmill', { rotor: true });
        const BR = { stone: 0xefe0bf, band: 0xd9b777, roof: 0xc8423a, wood: PAL.wood };
        kit.place(sp.x, y0, sp.z, ry, k => {
          k.cone(5.0, 4.4, 1.4, 0, -0.1, 0, 0xb9ad98, 0.1, 12);
          k.cone(4.3, 3.7, 4.4, 0, 1.2, 0, BR.stone, 0.1, 12);
          k.cone(3.75, 3.2, 0.9, 0, 5.5, 0, BR.band, 0.06, 12);
          k.cone(3.25, 2.75, 4.4, 0, 6.3, 0, BR.stone, 0.1, 12);
          k.cone(2.8, 2.5, 0.8, 0, 10.6, 0, BR.band, 0.06, 12);
          k.cone(2.55, 2.3, 2.6, 0, 11.3, 0, BR.stone, 0.1, 12);
          k.cyl(3.1, 0.35, 0, 9.4, 0, BR.wood, 0.05, 14);            // gallery
          k.cone(3.1, 0.5, 3.8, 0, 13.7, 0, BR.roof, 0.12, 12);       // cap
          k.sph(0.5, 0.5, 0.5, 0, 17.6, 0, PAL.yellow, 0.05);
          k.box(1.5, 2.5, 0.35, 0, 2.6, 4.05, PAL.woodD, 0.06); k.box(0.9, 0.9, 0.1, 0.0, 9.0, 3.1, 0x6fc4f0, 0.04);   // door + window
          k.box(0.9, 0.9, 0.1, 1.9, 7.2, 2.6, 0x6fc4f0, 0.04, { ry: 0.6 }); k.box(0.9, 0.9, 0.1, -1.9, 7.2, 2.6, 0x6fc4f0, 0.04, { ry: -0.6 });
          // tail fan + shaft stub
          k.box(0.3, 3.2, 0.12, 0, 13.1, -3.6, BR.wood, 0.04); k.cyl(0.35, 1.2, 0, 12.0, 3.0, PAL.woodD, 0.05, 8, { rx: Math.PI / 2 });
        });
        // rotor: built around its own origin, then spun about the shaft (local z)
        rotor = new THREE.Group(); rotor.position.set(sp.x + Math.sin(ry) * 3.7, y0 + 12.0, sp.z + Math.cos(ry) * 3.7); rotor.rotation.y = ry;
        const rk = new Kit(true);
        rk.sph(0.95, 0.95, 0.95, 0, 0, 0.3, PAL.red, 0.07);
        for (let a = 0; a < 4; a++){
          const ang = a * Math.PI / 2;
          const along = (r, w, h, d, x, yy, z, c, ink) => {   // helper: place a box at (x, yy) in arm-local coords rotated by ang
            const cx = Math.cos(ang) * x - Math.sin(ang) * yy, cy = Math.sin(ang) * x + Math.cos(ang) * yy;
            rk.box(w, h, d, cx, cy, z, c, ink, { rz: ang });
          };
          along(0, 0.36, 10.2, 0.3, 0, 5.4, 0.1, BR.wood, 0.05);                   // spar
          along(0, 2.0, 7.2, 0.1, 1.3, 6.2, 0.12, 0xffffff, 0.05);                  // canvas
          along(0, 0.22, 7.3, 0.18, 2.35, 6.2, 0.12, BR.wood, 0.04);                // outer rail
          for (let q = 0; q < 4; q++) along(0, 2.1, 0.2, 0.2, 1.3, 3.1 + q * 1.9, 0.14, BR.wood, 0.03);
        }
        rk.finish(rotor); root.add(rotor);
        registry.push({ kind: 'windmill-rotor', x: rotor.position.x, y: rotor.position.y, z: rotor.position.z, r: 10.5, animated: true, rotor: true });
        ART_STATS.windmill = { x: sp.x, z: sp.z };
        animators.push((dt, t) => { rotor.rotation.z += dt * 0.55; });
        // hide the original static windmill GLB (its instanced sub-meshes load asynchronously)
        if (old) hideTargets.push({ x: old.x, z: old.z, r: 10 });
      }
    }
    function hideStatic(){
      if (!hideTargets.length) return;
      const m = new THREE.Matrix4(), bb = new THREE.Box3();
      scene.traverse(o => {
        if (!o.isInstancedMesh || o.userData.hhHidden || o.userData.hhKit || o.count !== 1 || !o.geometry) return;
        o.getMatrixAt(0, m); if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        bb.copy(o.geometry.boundingBox).applyMatrix4(m);
        const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
        for (const h of hideTargets) if (Math.hypot(cx - h.x, cz - h.z) < h.r && bb.max.y - bb.min.y > 0.4 && bb.max.x - bb.min.x < 16){ o.visible = false; o.userData.hhHidden = true; hideTargets.found = (hideTargets.found || 0) + 1; }
      });
    }

    // ------------------------------------------------------------------------------------------
    //  THE BARN CHICANE: lanterns, crates, barrels, milk cans, hay + signs (outside the road corridor)
    // ------------------------------------------------------------------------------------------
    {
      const bo = (TR.objects || []).find(o => o.model === 'farm_open_barn');
      if (bo){
        // road samples inside the barn footprint
        const inb = (i) => Math.hypot(C[i].x - bo.x, C[i].z - bo.z) < 22;
        let sMin = 1e9, sMax = -1e9;
        for (let i = 0; i < N; i++) if (inb(i)){ sMin = Math.min(sMin, AS[i]); sMax = Math.max(sMax, AS[i]); }
        if (sMax - sMin > 80) { sMin = 1e9; sMax = -1e9; for (let i = 0; i < N; i++) if (inb(i)){ const a = AS[i] > TLEN / 2 ? AS[i] - TLEN : AS[i]; sMin = Math.min(sMin, a); sMax = Math.max(sMax, a); } }
        // warning boards on approach
        for (const [ds, side, lines] of [[-30, 1, ['BARN', 'CHICANE']], [-30, -1, ['SLOW', 'COWS']]]){
          const q = atS(sMin + ds, side * (hw + 4.6));
          if (ok(q.x, q.z, 2.0)){ addSign(q.x, q.z, Math.atan2(-q.tx, -q.tz), 3.2, 1.8, lines, '#fff1d0', '#c9362b'); claim(q.x, q.z, 2.2, 'sign'); }
        }
        // lantern posts on both edges across the barn span
        let nL = 0;
        for (let s = sMin - 4; s <= sMax + 4; s += 11) for (const side of [1, -1]){
          const q = atS(s, side * (hw + 3.4));
          if (!ok(q.x, q.z, 0.8)) continue;
          const y0 = H(q.x, q.z);
          kit.place(q.x, y0, q.z, 0, k => { k.cyl(0.13, 3.6, 0, 0, 0, PAL.woodD, 0.04, 6); k.box(0.9, 0.12, 0.12, 0.35, 3.4, 0, PAL.woodD, 0.03); k.cyl(0.02, 0.25, 0.7, 3.2, 0, 0x2b1a12, 0, 4); k.box(0.34, 0.1, 0.34, 0.7, 3.2, 0, 0x2b1a12, 0.02); k.box(0.34, 0.1, 0.34, 0.7, 3.62, 0, 0x2b1a12, 0.02); });
          glows.push({ x: q.x + 0.7, y: y0 + 3.43, z: q.z, r: 0.2, c: 0xffd266 }); claim(q.x, q.z, 1.0, 'lantern'); nL++;
        }
        ART_STATS.lanterns = nL;
        // clutter around the barn mouth: crates, barrels, cans, bales
        const cluster = (cx, cz) => {
          for (let i = 0; i < 9; i++){
            const sp = findSpot(cx + (rng() - 0.5) * 8, cz + (rng() - 0.5) * 8, 1.3, 7); if (!sp) continue;
            const y0 = H(sp.x, sp.z), ry = rng() * 3, kind = Math.floor(rng() * 4);
            kit.place(sp.x, y0, sp.z, ry, k => {
              if (kind === 0){ k.box(1.5, 1.5, 1.5, 0, 0.75, 0, PAL.woodL, 0.06); k.box(1.56, 0.16, 1.56, 0, 0.3, 0, PAL.woodD, 0); k.box(1.56, 0.16, 1.56, 0, 1.2, 0, PAL.woodD, 0); }
              else if (kind === 1){ k.cyl(0.62, 1.3, 0, 0, 0, 0xa66a38, 0.06, 10); k.cyl(0.64, 0.12, 0, 0.25, 0, 0x4a4a52, 0, 10); k.cyl(0.64, 0.12, 0, 0.95, 0, 0x4a4a52, 0, 10); }
              else if (kind === 2){ k.cyl(0.32, 0.9, 0, 0, 0, 0xc9d3dc, 0.05, 8); k.cone(0.34, 0.2, 0.3, 0, 0.9, 0, 0xc9d3dc, 0.04, 8); }
              else { k.cylC(0.9, 1.4, 0, 0.9, 0, PAL.hay, 0.07, 10, { rx: Math.PI / 2, rz: rng() }); }
            });
            claim(sp.x, sp.z, 1.3, 'barn-clutter');
          }
        };
        cluster(bo.x + 17, bo.z + 20); cluster(bo.x - 24, bo.z + 14); cluster(bo.x + 16, bo.z - 22);
      }
    }

    // ------------------------------------------------------------------------------------------
    //  WATER: ford bridge + stepping stones, reeds/cattails, lily pads, sparkles, drifting foam, pond ducks + dock
    // ------------------------------------------------------------------------------------------
    const WSTEP = 2;
    const waters = [];
    for (const w of (TR.waters || [])){
      const cells = [], set = new Set(); const key = (i, j) => i + ',' + j;
      for (let x = w.x - 56; x <= w.x + 56; x += WSTEP) for (let z = w.z - 56; z <= w.z + 56; z += WSTEP){
        const lv = ctx.waterSurfaceAt ? ctx.waterSurfaceAt(x, z) : null;
        if (lv != null){ cells.push({ x, z, lvl: lv, rd: roadD(x, z), i: Math.round(x / WSTEP), j: Math.round(z / WSTEP) }); set.add(key(Math.round(x / WSTEP), Math.round(z / WSTEP))); }
      }
      let mr = 1e9; for (const c of cells) mr = Math.min(mr, c.rd);
      waters.push({ id: w.id, seed: w, cells, set, key, minRoad: mr, lvl: w.y });
    }
    const wetC = (W, x, z) => W.set.has(W.key(Math.round(x / WSTEP), Math.round(z / WSTEP)));
    for (const W of waters){
      for (const c of W.cells){ c.shore = !(W.set.has(W.key(c.i + 1, c.j)) && W.set.has(W.key(c.i - 1, c.j)) && W.set.has(W.key(c.i, c.j + 1)) && W.set.has(W.key(c.i, c.j - 1))); }
    }
    const ford = waters.find(W => W.minRoad < hw) || waters[0];
    const pond = waters.find(W => W !== ford) || null;
    // principal axis of the water cells around (cx,cz)
    function creekAxis(W, cx, cz, R){
      let sx = 0, sz = 0, n = 0; for (const c of W.cells) if (Math.hypot(c.x - cx, c.z - cz) < R){ sx += c.x; sz += c.z; n++; }
      if (n < 6) return null; const mx = sx / n, mz = sz / n; let a = 0, b = 0, d = 0;
      for (const c of W.cells) if (Math.hypot(c.x - cx, c.z - cz) < R){ const dx = c.x - mx, dz = c.z - mz; a += dx * dx; b += dx * dz; d += dz * dz; }
      const th = 0.5 * Math.atan2(2 * b, a - d); return { x: Math.cos(th), z: Math.sin(th) };
    }
    // find a crossing: returns {cx,cz,ax,az (across), len}
    function findCrossing(W, minRoadD, maxRoadD, avoid, avoidR){
      let best = null; const dbg = { cells: W.cells.length, inRange: 0, axis: 0, len: 0, end: 0 }; ART_STATS.crossDbg = dbg;
      for (const c of W.cells){
        if (c.rd < minRoadD || c.rd > maxRoadD) continue;
        dbg.inRange++;
        if (avoid && Math.hypot(c.x - avoid.x, c.z - avoid.z) < (avoidR || 14)) continue;
        // the creek runs across the road, so a footbridge BESIDE the road spans it along the road's own direction
        const rn0 = roadNear(c.x, c.z); const px = rn0.tx, pz = rn0.tz;
        let a = 0, b = 0;
        while (a < 30 && wetC(W, c.x + px * (a + 1), c.z + pz * (a + 1))) a++;
        while (b < 30 && wetC(W, c.x - px * (b + 1), c.z - pz * (b + 1))) b++;
        const len = a + b + 1;
        dbg.lens = (dbg.lens || []).concat(len); if (len < 4 || len > 26){ dbg.len++; continue; }
        const e1 = { x: c.x + px * (a + 3.5), z: c.z + pz * (a + 3.5) }, e2 = { x: c.x - px * (b + 3.5), z: c.z - pz * (b + 3.5) };
        if (roadD(e1.x, e1.z) < hw + MARGIN + 1.6 || roadD(e2.x, e2.z) < hw + MARGIN + 1.6) continue;
        if (!ok(e1.x, e1.z, 1.4, { wet: true, noObj: true }) || !ok(e2.x, e2.z, 1.4, { wet: true, noObj: true })){ dbg.end++; continue; }
        const score = c.rd + len * 0.3;
        if (!best || score < best.score){ best = { score, e1, e2, mid: { x: (e1.x + e2.x) / 2, z: (e1.z + e2.z) / 2 }, len: len + 7, px, pz, lvl: c.lvl }; }
      }
      return best;
    }
    let bridgeAt = null;
    if (ford){
      const br = findCrossing(ford, hw + 3, hw + 20, null); const dbg1 = ART_STATS.crossDbg;
      if (br){
        bridgeAt = br;
        const L = br.len, ry = Math.atan2(br.px, br.pz) + Math.PI / 2;      // deck runs along the crossing axis
        const yb = br.lvl + 0.55, yEnd = Math.max(H(br.e1.x, br.e1.z), H(br.e2.x, br.e2.z), br.lvl + 0.1);
        kit.place(br.mid.x, 0, br.mid.z, Math.atan2(br.e1.x - br.e2.x, br.e1.z - br.e2.z), k => {
          const n = Math.ceil(L / 1.05), half = L / 2;
          for (let i = 0; i < n; i++){
            const u = (i + 0.5) / n, z = -half + u * L, arch = Math.sin(u * Math.PI) * 0.75;
            k.box(3.2, 0.2, 0.92, 0, yb + 0.6 + arch, z, i & 1 ? PAL.woodL : 0xc58a4d, 0.05, { rx: Math.cos(u * Math.PI) * 0.22 });
          }
          for (const sx of [-1, 1]){
            // side rails and posts that follow the arch
            for (let i = 0; i <= 6; i++){
              const u = i / 6, z = -half + u * L, arch = Math.sin(u * Math.PI) * 0.75;
              k.cyl(0.13, 1.5 + (yb + 0.6 + arch - (yb - 1.2)), sx * 1.55, yb - 1.2, z, PAL.woodD, 0.04, 6);
              k.box(0.14, 0.16, L / 6 + 0.2, sx * 1.55, yb + 0.6 + arch + 1.0, z + L / 12, PAL.wood, 0.04, { rx: -Math.cos((i + 0.5) / 6 * Math.PI) * 0.22 });
            }
          }
        });
        glows.push({ x: br.mid.x, y: yb + 2.4, z: br.mid.z, r: 0.22, c: 0xffd266 });
        claim(br.mid.x, br.mid.z, L / 2, 'bridge'); registry.push({ kind: 'bridge', x: br.mid.x, y: yb, z: br.mid.z, r: L / 2 });
        // a sign by the bridge: FORD
        const rn = roadNear(br.mid.x, br.mid.z);
        const sp = findSpot(rn.px + (br.mid.x - rn.px) * 0.4, rn.pz + (br.mid.z - rn.pz) * 0.4, 1.8, 8, { wet: false });
        if (sp){ const q = roadNear(sp.x, sp.z); addSign(sp.x, sp.z, Math.atan2(-q.tx, -q.tz), 3.0, 1.7, ['FORD', 'SPLASH!'], '#bfeaff', '#1c6fb0'); claim(sp.x, sp.z, 2.0, 'sign'); }
      }
      // stepping stones across another reach of the creek
      const st = findCrossing(ford, hw + 3, hw + 20, bridgeAt ? bridgeAt.mid : null, 7); ART_STATS.crossDbg1 = dbg1;
      if (st){
        const dx = st.e1.x - st.e2.x, dz = st.e1.z - st.e2.z, L = Math.hypot(dx, dz), n = Math.max(4, Math.round(L / 1.9));
        for (let i = 0; i < n; i++){
          const u = (i + 0.5) / n, x = st.e2.x + dx * u + (rng() - 0.5) * 0.5, z = st.e2.z + dz * u + (rng() - 0.5) * 0.5;
          const lvl = ctx.waterSurfaceAt(x, z); const base = lvl != null ? lvl : H(x, z);
          kit.place(x, base - 0.3, z, rng() * 3, k => k.cyl(0.75 + rng() * 0.25, 0.65, 0, 0, 0, i & 1 ? 0xc9c1b0 : 0xb1a897, 0.06, 9));
          registry.push({ kind: 'stone', x, y: base, z, r: 0.9 });
        }
        claim(st.mid.x, st.mid.z, L / 2, 'stones');
      }
    }
    // reeds + cattails along every shoreline, lily pads on the open water
    {
      for (const W of waters){
        let nr = 0, np = 0;
        for (const c of W.cells){
          if (c.rd < hw + 3) continue;
          if (c.shore && rng() < 0.5 * DEN + 0.1){
            const cx = c.x + (rng() - 0.5) * 1.6, cz = c.z + (rng() - 0.5) * 1.6;
            if (roadD(cx, cz) < hw + MARGIN + 0.8) continue;
            const y0 = Math.max(GH(cx, cz), c.lvl - 0.25);
            const nst = 3 + Math.floor(rng() * 3);
            for (let q = 0; q < nst; q++){
              const ox = (rng() - 0.5) * 1.0, oz = (rng() - 0.5) * 1.0, h = 1.6 + rng() * 1.5, lean = (rng() - 0.5) * 0.25;
              kit.cyl(0.045, h, cx + ox, y0, cz + oz, 0x4fa83c, 0, 4, { rx: lean, rz: lean, sway: 0.4 });
              if (rng() < 0.7) kit.cyl(0.1, 0.5, cx + ox + lean * h * 0.9, y0 + h - 0.25, cz + oz - lean * h * 0.9, 0x7a4a2a, 0.0, 5, { sway: 0.4 });
            }
            nr++;
          } else if (!c.shore && rng() < 0.2 * DEN + 0.04){
            const x = c.x + (rng() - 0.5), z = c.z + (rng() - 0.5);
            kit.place(x, c.lvl + 0.03, z, rng() * 6, k => { k.cyl(0.55 + rng() * 0.3, 0.05, 0, 0, 0, 0x3fae49, 0.03, 8); if (rng() < 0.35) k.cone(0.2, 0.02, 0.22, 0.1, 0.05, 0, 0xff7aa8, 0.02, 6); });
            np++;
          }
        }
        W.nReeds = nr; W.nPads = np;
      }
    }
    // sparkles + drifting foam streaks over the water (instanced Basic quads, animated in update)
    const sparkle = { n: 0 };
    {
      const cand = []; for (const W of waters) for (const c of W.cells) if (c.rd > hw + 3.4) cand.push(c);   // sparkles stay off the ford's drivable stretch
      const n = Math.min(cand.length, MOBILE ? 36 : 80);
      if (n){
        const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff }); mat.userData.hhArt = true;
        const im = new THREE.InstancedMesh(geo, mat, n); im.frustumCulled = false; root.add(im);
        const lst = []; for (let i = 0; i < n; i++){ const c = cand[Math.floor(rng() * cand.length)]; lst.push({ x: c.x + (rng() - 0.5) * 2, z: c.z + (rng() - 0.5) * 2, y: c.lvl + 0.09, ph: rng() * 6.28, sp: 1.2 + rng() * 1.6, sz: 0.35 + rng() * 0.5, rot: rng() * 3 }); }
        sparkle.n = n; sparkle.im = im; sparkle.lst = lst;
        const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), Pp = new THREE.Vector3(), Ss = new THREE.Vector3();
        sparkle.update = (t) => { for (let i = 0; i < n; i++){ const s = lst[i], v = Math.max(0, Math.sin(t * s.sp + s.ph)); const z = Math.pow(v, 4) * s.sz;
          E.set(0, s.rot + t * 0.3, 0); Q.setFromEuler(E); M.compose(Pp.set(s.x, s.y, s.z), Q, Ss.set(z * 1.5, 1, z * 0.5 + 0.001)); im.setMatrixAt(i, M); } im.instanceMatrix.needsUpdate = true; };
        sparkle.update(0);
      }
    }
    // pond: dock, rocks, ducks
    const ducks = { list: [] };
    if (pond){
      // dock on the road-facing shore
      let best = null; for (const c of pond.cells) if (c.shore && c.rd > hw + 8 && (!best || c.rd < best.rd)) best = c;
      if (best){
        const ax = Math.atan2(pond.seed.x - best.x, pond.seed.z - best.z);
        const sx = best.x - Math.sin(ax) * 3.5, sz = best.z - Math.cos(ax) * 3.5;
        if (ok(sx, sz, 2.2, { wet: true })){
          kit.place(sx, 0, sz, ax, k => {
            const y1 = pond.lvl + 0.55;
            for (let i = 0; i < 9; i++) k.box(1.7, 0.16, 0.5, 0, y1, 0.5 + i * 0.55, i & 1 ? PAL.woodL : 0xc58a4d, 0.04);
            for (const sx2 of [-0.8, 0.8]) for (const zz of [0.6, 2.6, 4.6]) k.cyl(0.11, 1.8, sx2, y1 - 1.6, zz, PAL.woodD, 0.04, 6);
          });
          claim(sx, sz, 3.2, 'dock');
        }
      }
      // ducks: orbit circles inside the open water
      const inner = pond.cells.filter(c => !c.shore && pond.set.has(pond.key(c.i + 2, c.j)) && pond.set.has(pond.key(c.i - 2, c.j)) && pond.set.has(pond.key(c.i, c.j + 2)) && pond.set.has(pond.key(c.i, c.j - 2)) && c.rd > hw + 6);
      const nDuck = Math.min(inner.length ? 6 : 0, 6);
      for (let i = 0; i < nDuck; i++){
        const c = inner[Math.floor(rng() * inner.length)];
        const rad = 1.2 + rng() * 1.8; let okc = true;
        for (let a = 0; a < 8; a++) if (!wetC(pond, c.x + Math.cos(a * 0.785) * (rad + 1), c.z + Math.sin(a * 0.785) * (rad + 1))) okc = false;
        if (!okc) continue;
        ducks.list.push({ cx: c.x, cz: c.z, r: rad, w: (rng() < 0.5 ? -1 : 1) * (0.25 + rng() * 0.25), ph: rng() * 6.28, lvl: c.lvl, s: i >= 4 ? 0.6 : 1, col: i === 3 ? 0x8a5a32 : 0xfff6e8 });
      }
      if (ducks.list.length){
        const n = ducks.list.length;
        const mk = (g) => { const m = new THREE.InstancedMesh(g, T.mat(0xffffff), n); m.frustumCulled = false; root.add(m); T.outline(m, 0.03); return m; };
        const dBody = mk(new THREE.SphereGeometry(0.42, 8, 6)), dHead = mk(new THREE.SphereGeometry(0.22, 8, 6)), dBeak = mk(new THREE.ConeGeometry(0.1, 0.28, 5).rotateX(Math.PI / 2));
        ducks.list.forEach((d, i) => { dBody.setColorAt(i, col(d.col)); dHead.setColorAt(i, col(d.col === 0x8a5a32 ? 0x2e7d4f : 0x2e9a6a)); dBeak.setColorAt(i, col(0xffa21a)); });
        [dBody, dHead, dBeak].forEach(m => { m.instanceColor.needsUpdate = true; });
        const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), Pp = new THREE.Vector3(), Ss = new THREE.Vector3();
        ducks.meshes = [dBody, dHead, dBeak];
        ducks.update = (t) => {
          for (let i = 0; i < n; i++){
            const d = ducks.list[i], a = d.ph + t * d.w, x = d.cx + Math.cos(a) * d.r, z = d.cz + Math.sin(a) * d.r;
            const hd = Math.atan2(-Math.sin(a) * d.w, Math.cos(a) * d.w);      // heading along the orbit
            const bob = Math.sin(t * 2.4 + d.ph) * 0.04, y = d.lvl + 0.16 + bob, s = d.s;
            const cs = Math.sin(hd), cc = Math.cos(hd);
            const put = (m, fx, fy, fz, sx, sy, sz) => { E.set(0, hd, 0); Q.setFromEuler(E); M.compose(Pp.set(x + cs * fz, y + fy, z + cc * fz), Q, Ss.set(sx * s, sy * s, sz * s)); m.setMatrixAt(i, M); };
            put(dBody, 0, 0, 0, 0.95, 0.7, 1.35); put(dHead, 0, 0.34 * s, 0.38 * s, 1, 1, 1); put(dBeak, 0, 0.32 * s, 0.62 * s, 1, 1, 1);
          }
          [dBody, dHead, dBeak].forEach(m => { m.instanceMatrix.needsUpdate = true; });
        };
        ducks.update(0);
        for (const d of ducks.list) registry.push({ kind: 'duck', x: d.cx, y: d.lvl, z: d.cz, r: d.r + 0.5, animated: true });
      }
    }

    // ------------------------------------------------------------------------------------------
    //  CROP FIELDS: tilled furrow strips + planted rows of corn / sunflowers / pumpkins inside the painted crop esses
    // ------------------------------------------------------------------------------------------
    // hand-built low-poly plant geometries (vertex colours + wind weight baked in): ~16-40 tris each
    function plantGeo(parts){
      const P = [], Nn = [], Cc = [], S = [];
      for (const pt of parts){ for (let i = 0; i < pt.p.length; i += 9){
        const ax = pt.p[i + 3] - pt.p[i], ay = pt.p[i + 4] - pt.p[i + 1], az = pt.p[i + 5] - pt.p[i + 2], bx = pt.p[i + 6] - pt.p[i], by = pt.p[i + 7] - pt.p[i + 1], bz = pt.p[i + 8] - pt.p[i + 2];
        let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        for (let q = 0; q < 3; q++){ P.push(pt.p[i + q * 3], pt.p[i + q * 3 + 1], pt.p[i + q * 3 + 2]); Nn.push(nx * 0.35, ny * 0.35 + 0.9, nz * 0.35); const c = col(pt.c); Cc.push(c.r, c.g, c.b); S.push(pt.sw ? pt.sw * pt.p[i + q * 3 + 1] : 0); }
      } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setAttribute('aSway', new THREE.Float32BufferAttribute(S, 1)); return g;
    }
    // helpers producing triangle soup (double-sided so the FrontSide material shows both faces)
    function dblQuad(a, b, c, d){ return [...a, ...c, ...b, ...b, ...c, ...d, ...a, ...b, ...c, ...b, ...d, ...c]; }
    function prismTube(r0, r1, h, seg, y0){      // tapered tube without caps
      const o = []; for (let i = 0; i < seg; i++){ const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU;
        const A = [Math.cos(a0) * r0, y0, Math.sin(a0) * r0], B = [Math.cos(a1) * r0, y0, Math.sin(a1) * r0], Cc = [Math.cos(a0) * r1, y0 + h, Math.sin(a0) * r1], D = [Math.cos(a1) * r1, y0 + h, Math.sin(a1) * r1];
        o.push(...A, ...Cc, ...B, ...B, ...Cc, ...D); } return o; }
    const GEO_CORN = plantGeo([
      { p: prismTube(0.12, 0.05, 2.5, 5, 0), c: 0x5fb83a, sw: 0.06 },
      { p: dblQuad([-0.75, 1.3, 0], [0.75, 1.9, 0], [-0.05, 1.0, 0], [0.05, 1.35, 0]), c: 0x3f9e35, sw: 0.08 },
      { p: dblQuad([0, 1.6, -0.7], [0, 2.1, 0.7], [0, 1.2, -0.05], [0, 1.4, 0.05]), c: 0x4fae3a, sw: 0.08 },
      { p: prismTube(0.15, 0.0, 0.7, 5, 1.4), c: 0xffd23d, sw: 0.06 },
      { p: prismTube(0.04, 0.0, 0.55, 4, 2.45), c: 0xc9a23a, sw: 0.06 }]);
    const GEO_SUN = plantGeo([
      { p: prismTube(0.1, 0.07, 2.3, 5, 0), c: 0x4fa83a, sw: 0.05 },
      { p: dblQuad([-0.55, 1.0, 0], [0.55, 1.2, 0], [-0.05, 0.8, 0], [0.05, 0.95, 0]), c: 0x3f9e35, sw: 0.06 },
      { p: prismTube(0.62, 0.62, 0.12, 9, 2.25), c: 0xffcf1f, sw: 0.06 },
      { p: prismTube(0.3, 0.3, 0.16, 8, 2.27), c: 0x6a3c1e, sw: 0.06 }]);
    const GEO_WHEAT = plantGeo([
      { p: prismTube(0.05, 0.03, 1.5, 4, 0), c: 0xd8b84a, sw: 0.08 },
      { p: prismTube(0.13, 0.0, 0.5, 4, 1.4), c: 0xf0cf5a, sw: 0.08 }]);
    const furrowCol = 0x6b4326;
    const paint = TR.paint && TR.paint.cells ? TR.paint : null;
    const goldCell = (x, z) => { if (!paint) return 0; const v = paint.cells[Math.floor(x / paint.cell) + ',' + Math.floor(z / paint.cell)]; return v === 0xcaa63e ? 1 : v === 0xc19a3a ? 2 : 0; };
    let nPlants = 0, nPump = 0;
    function plantFields(){
      const fk = new Kit();           // fields in their own kit (chunked like the rest)
      const spacingX = 2.6, spacingZ = MOBILE ? 2.7 : 1.7;
      const bands = ['corn', 'corn', 'sun', 'corn', 'corn', 'wheat', 'pump'];
      if (paint){
        // sweep the world in row columns; plant where the paint says "field" and the spot is legal
        for (let x = GX0 + 1; x < GX1; x += spacingX){
          let run = [];
          const flush = () => { if (run.length > 2){ const g = ribbonGeo(run, 0.95, (xx, zz) => GH(xx, zz) + 0.1, furrowCol); addDecalGeo(fk, g); } run = []; };
          for (let z = GZ0; z < GZ1; z += 1.5){
            const fld = goldCell(x, z);
            if (!fld){ flush(); continue; }
            if (roadD(x, z) < hw + MARGIN + 0.6){ flush(); continue; }
            run.push({ x, z });
          }
          flush();
        }
        for (let x = GX0 + 1; x < GX1; x += spacingX){
          const bandKind = bands[((Math.floor(x / spacingX) % bands.length) + bands.length) % bands.length];
          for (let z = GZ0; z < GZ1; z += spacingZ){
            const fld = goldCell(x + 1.3, z); if (!fld) continue;
            const px = x + (rng() - 0.5) * 0.4, pz = z + (rng() - 0.5) * 0.5;
            if (roadD(px, pz) < hw + MARGIN + 0.6) continue;
            if (!ownFreePlant(px, pz)) continue;
            const y0 = GH(px, pz) + 0.05, sc = 0.85 + rng() * 0.4;
            let kind = bandKind;
            if (kind === 'pump'){ if (rng() < 0.55) continue; }
            const m = new THREE.Matrix4().compose(V3(px, y0, pz), new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), rng() * 6.28), V3(sc, sc * (0.9 + rng() * 0.3), sc));
            if (kind === 'corn'){ if (MOBILE && rng() < 0.2) continue; fk.addGeo(GEO_CORN, m, null, 0); }
            else if (kind === 'sun'){ fk.addGeo(GEO_SUN, m, null, 0); }
            else if (kind === 'wheat'){ for (let q = 0; q < 3; q++){ const m2 = new THREE.Matrix4().compose(V3(px + (rng() - 0.5) * 0.8, y0, pz + (rng() - 0.5) * 0.8), new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), rng() * 6.28), V3(sc, sc, sc)); fk.addGeo(GEO_WHEAT, m2, null, 0); } }
            else { fk.place(px, y0, pz, rng() * 6, k => { k.sph(0.62, 0.48, 0.62, 0, 0.42, 0, PAL.orange, 0.04, { ws: 8, hs: 5 }); k.cyl(0.07, 0.3, 0, 0.8, 0, 0x4a7a2a, 0.0, 5); }); nPump++; }
            nPlants++;
          }
        }
      }
      fk.finish(root);
      ART_STATS.plants = nPlants; ART_STATS.pumpkins = nPump;
    }
    function ownFreePlant(x, z){        // crops only keep clear of solid dressing, not of one another
      if (!ownFree(x, z, 0.3)) return false;
      if (railPts.length && railD(x, z) < 5) return false;
      if (wet(x, z)) return false;
      for (const b of obst){ if (b.r > 1.6 && Math.hypot(b.x - x, b.z - z) < b.r + 0.6) return false; }
      return true;
    }
    // scarecrows in the middle of each field, a tractor + wagon, hay bales
    {
      const fieldCentres = [];
      if (paint){
        const acc = {}; for (const k in paint.cells){ const v = paint.cells[k]; if (v !== 0xcaa63e && v !== 0xc19a3a) continue; const [i, j] = k.split(',').map(Number); const a = acc[v] || (acc[v] = { x: 0, z: 0, n: 0 }); a.x += (i + 0.5) * paint.cell; a.z += (j + 0.5) * paint.cell; a.n++; }
        for (const v in acc) fieldCentres.push({ x: acc[v].x / acc[v].n, z: acc[v].z / acc[v].n });
      }
      for (const fc of fieldCentres){
        const sp = findSpot(fc.x, fc.z, 1.4, 16, { noOwn: false }); if (!sp) continue;
        const y0 = H(sp.x, sp.z);
        kit.place(sp.x, y0, sp.z, rng() * 6, k => {
          k.cyl(0.1, 3.3, 0, 0, 0, PAL.woodD, 0.04, 6);
          k.box(2.6, 0.14, 0.14, 0, 2.5, 0, PAL.woodD, 0.04);
          k.box(0.9, 1.15, 0.5, 0, 2.2, 0, 0xd8402f, 0.05, { sway: 0.1 });
          k.box(0.6, 0.18, 0.18, -0.9, 2.15, 0, 0xd8402f, 0.03, { sway: 0.3 }); k.box(0.6, 0.18, 0.18, 0.9, 2.15, 0, 0xd8402f, 0.03, { sway: 0.3 });
          k.sph(0.38, 0.4, 0.38, 0, 3.15, 0, 0xf2cf8a, 0.05);
          k.cyl(0.62, 0.06, 0, 3.4, 0, 0x7a4e28, 0.04, 8); k.cone(0.34, 0.2, 0.42, 0, 3.45, 0, 0x7a4e28, 0.04, 8);
          k.box(0.1, 0.1, 0.1, -0.12, 3.18, 0.35, 0x2b1a12, 0); k.box(0.1, 0.1, 0.1, 0.12, 3.18, 0.35, 0x2b1a12, 0);
        });
        claim(sp.x, sp.z, 1.6, 'scarecrow');
      }
      // tractor beside the east field
      const tsp = findSpot(274, 56, 3.0, 26) || findSpot(240, 70, 3.0, 22);
      if (tsp){
        const y0 = H(tsp.x, tsp.z), ry = Math.atan2(-(tsp.x - 236), -(tsp.z - 60)) + 0.4;
        kit.place(tsp.x, y0, tsp.z, ry, k => {
          k.box(2.0, 1.3, 3.4, 0, 1.55, 0.4, 0x3aa84a, 0.09);              // hood + body
          k.box(1.9, 1.5, 1.6, 0, 2.7, -0.9, 0x3aa84a, 0.09);              // cab
          k.box(1.6, 1.0, 1.4, 0, 2.8, -0.9, 0x9fe0ff, 0.04);
          k.box(2.1, 0.12, 1.9, 0, 3.55, -0.9, 0xffd23d, 0.05);
          k.cyl(0.12, 1.1, 0.5, 2.2, 1.6, 0x2b2b2b, 0.03, 6);
          for (const sx of [-1.15, 1.15]){ k.cylC(0.95, 0.5, sx, 0.95, -1.0, 0x2a2a2e, 0.07, 14, { rz: Math.PI / 2 }); k.cylC(0.5, 0.52, sx, 0.95, -1.0, 0xffd23d, 0.04, 10, { rz: Math.PI / 2 });
            k.cylC(0.55, 0.4, sx * 0.95, 0.55, 1.7, 0x2a2a2e, 0.06, 12, { rz: Math.PI / 2 }); k.cylC(0.3, 0.42, sx * 0.95, 0.55, 1.7, 0xffd23d, 0.04, 8, { rz: Math.PI / 2 }); }
          k.sph(0.22, 0.22, 0.22, 0.6, 1.7, 2.15, 0xfff3b0, 0.03);
          k.sph(0.22, 0.22, 0.22, -0.6, 1.7, 2.15, 0xfff3b0, 0.03);
          // hay wagon behind it
          k.box(2.2, 0.25, 3.6, 0, 1.0, -4.6, PAL.woodD, 0.06);
          for (const sx of [-1.05, 1.05]) k.box(0.16, 0.8, 3.6, sx, 1.5, -4.6, PAL.woodL, 0.05);
          k.box(2.0, 1.0, 3.2, 0, 1.55, -4.6, PAL.hay, 0.07);
          for (const sx of [-1.15, 1.15]) for (const zz of [-3.6, -5.6]) k.cylC(0.55, 0.3, sx, 0.55, zz, 0x2a2a2e, 0.05, 10, { rz: Math.PI / 2 });
        });
        claim(tsp.x, tsp.z, 5.2, 'tractor');
      }
      // round hay bales left in the stubble fields
      for (let i = 0; i < 9; i++){
        const fc = pick(fieldCentres.length ? fieldCentres : [{ x: 250, z: 20 }]);
        const sp = findSpot(fc.x + (rng() - 0.5) * 50, fc.z + (rng() - 0.5) * 50, 1.3, 10); if (!sp) continue;
        kit.place(sp.x, H(sp.x, sp.z), sp.z, rng() * 6, k => k.cylC(0.95, 1.7, 0, 0.95, 0, (i & 1) ? PAL.hay : PAL.hayD, 0.08, 12, { rx: Math.PI / 2 }));
        claim(sp.x, sp.z, 1.4, 'hay');
      }
    }
    plantFields();      // after the scarecrows/tractor/bales have claimed their spots
    // ------------------------------------------------------------------------------------------
    //  THE FARMYARD: mailbox, beehives, laundry line, picket fence
    // ------------------------------------------------------------------------------------------
    {
      const mb = findSpot(19, 50, 0.8, 7);
      if (mb){
        const q = roadNear(mb.x, mb.z);
        kit.place(mb.x, H(mb.x, mb.z), mb.z, Math.atan2(-q.tx, -q.tz) + 0.2, k => {
          k.cyl(0.1, 1.5, 0, 0, 0, PAL.woodD, 0.04, 6); k.box(0.5, 0.42, 0.9, 0, 1.7, 0, PAL.red, 0.05); k.sph(0.25, 0.21, 0.45, 0, 1.91, 0, PAL.red, 0.05, { ws: 8, hs: 4 }); k.box(0.06, 0.3, 0.1, 0.32, 1.95, 0.15, PAL.yellow, 0.02);
        }); claim(mb.x, mb.z, 1.0, 'mailbox');
      }
      const hv = findSpot(150, -128, 3.2, 26);
      if (hv){
        for (let i = 0; i < 4; i++){
          const sp = findSpot(hv.x + (i % 2) * 2.4 - 1.2, hv.z + Math.floor(i / 2) * 2.4, 1.0, 4, { noOwn: true }); if (!sp) continue;
          kit.place(sp.x, H(sp.x, sp.z), sp.z, rng() * 0.6, k => {
            k.box(1.3, 0.12, 1.3, 0, 0.55, 0, PAL.woodD, 0.04);
            for (let l = 0; l < 3; l++) k.box(1.1, 0.42, 1.1, 0, 0.82 + l * 0.44, 0, l & 1 ? 0xf6f0e2 : 0xfffaf0, 0.05);
            k.box(1.35, 0.14, 1.35, 0, 2.2, 0, PAL.red, 0.05); k.box(0.3, 0.14, 0.05, 0, 0.9, 0.56, 0x2b1a12, 0.0);
            for (const lx of [-0.5, 0.5]) k.cyl(0.07, 0.5, lx, 0, -0.5, PAL.woodD, 0.0, 5);
          });
          claim(sp.x, sp.z, 1.0, 'beehive');
        }
      }
      // laundry line near the farmhouse
      const ln = findSpot(53, 44, 4.5, 24);
      if (ln){
        const ry = rng() * 3;
        kit.place(ln.x, H(ln.x, ln.z), ln.z, ry, k => {
          for (const sx of [-4, 4]) k.cyl(0.12, 3.2, sx, 0, 0, PAL.woodD, 0.04, 6);
          k.box(8.4, 0.05, 0.05, 0, 3.0, 0, 0x6a4630, 0.0);
          const cc = [0xe5392f, 0xffd23d, 0x4fb4e8, 0xffffff, 0xff7aa8, 0x8a5bd6];
          for (let i = 0; i < 6; i++) k.box(0.8, 0.9 + (i % 3) * 0.2, 0.06, -3.3 + i * 1.3, 2.4, 0, cc[i], 0.03, { sway: 0.28, swayAxis: 'y', swayInv: true });
        });
        claim(ln.x, ln.z, 4.8, 'laundry');
      }
      // white picket garden fence by the house
      const pf = findSpot(26, 66, 5, 18);
      if (pf){
        kit.place(pf.x, H(pf.x, pf.z), pf.z, rng() * 3, k => {
          for (let i = 0; i < 20; i++) { const x = -5 + i * 0.52; k.box(0.14, 1.0, 0.06, x, 0.5, 0, 0xffffff, 0.025); k.cone(0.08, 0.0, 0.14, x, 1.0, 0, 0xffffff, 0.0, 4); }
          k.box(10.5, 0.1, 0.07, 0, 0.3, 0.02, 0xf2eadb, 0.02); k.box(10.5, 0.1, 0.07, 0, 0.75, 0.02, 0xf2eadb, 0.02);
        });
        claim(pf.x, pf.z, 5.4, 'picket');
      }
    }
    // ------------------------------------------------------------------------------------------
    //  ORCHARD with fruit trees, hedgerows, stone walls, bushes, rocks
    // ------------------------------------------------------------------------------------------
    function fruitTree(k, kindIdx){
      const fruit = [0xe5392f, 0xff9a2a, 0xffd23d, 0xd94d8a][kindIdx % 4], leaf = [0x4fb043, 0x3fa04a, 0x6cc044][kindIdx % 3];
      k.cyl(0.35, 2.4, 0, 0, 0, 0x7a4e28, 0.07, 6);
      k.sph(2.5, 2.1, 2.5, 0, 3.7, 0, leaf, 0.1, { ws: 8, hs: 5 });
      k.sph(1.7, 1.5, 1.7, 1.4, 4.6, 0.5, leaf, 0.09, { ws: 7, hs: 4 });
      k.sph(1.6, 1.4, 1.6, -1.2, 4.4, -0.7, 0x58b94a, 0.09, { ws: 7, hs: 4 });
      for (let i = 0; i < 7; i++){ const a = i * 0.9 + 0.3, r = 2.1 + (i % 2) * 0.3; k.sph(0.22, 0.22, 0.22, Math.cos(a) * r, 3.2 + (i % 3) * 0.8, Math.sin(a) * r, fruit, 0, { ws: 5, hs: 3 }); }
    }
    {
      let nTree = 0; const ox0 = 92, ox1 = 212, oz0 = -88, oz1 = -50;
      for (let x = ox0; x <= ox1; x += 9.5) for (let z = oz0; z <= oz1; z += 9.5){
        const px = x + (rng() - 0.5) * 1.5, pz = z + (rng() - 0.5) * 1.5;
        if (!ok(px, pz, 3.0)) continue;
        if (nTree > (MOBILE ? 26 : 70)) break;
        kit.place(px, H(px, pz), pz, rng() * 6, k => fruitTree(k, nTree));
        claim(px, pz, 3.0, 'fruit-tree'); nTree++;
      }
      // a few fruit trees in the home yard and by the barn too
      for (const [tx, tz] of [[60, 50], [8, 140], [250, 100], [-60, -100], [110, 60], [-20, -20], [180, -20]]){
        const sp = findSpot(tx, tz, 3.0, 22); if (sp){ kit.place(sp.x, H(sp.x, sp.z), sp.z, rng() * 6, k => fruitTree(k, nTree)); claim(sp.x, sp.z, 3.0, 'fruit-tree'); nTree++; }
      }
      ART_STATS.fruitTrees = nTree;
    }
    // hedgerows: chains of leaf balls with a darker base, along long stretches on the outer side of the straights
    {
      let nH = 0;
      for (let s = 0; s < TLEN; s += 41){
        const side = rng() < 0.5 ? 1 : -1, off = hw + 10 + rng() * 6, len = 18 + rng() * 14;
        const i0 = idxAtS(s); if (Math.abs(curv[i0]) > 0.01) continue;
        let placed = 0;
        for (let d = 0; d < len; d += 2.6){
          const q = atS(s + d, side * off); if (!ok(q.x, q.z, 1.6)) continue;
          const y0 = H(q.x, q.z), r = 1.25 + rng() * 0.4;
          kit.sph(r * 1.2, r, r * 1.1, q.x, y0 + r * 0.8, q.z, rng() < 0.5 ? 0x3f9a3a : 0x4cae3f, 0.07, { ws: 8, hs: 5 });
          if (rng() < 0.2) kit.sph(0.16, 0.16, 0.16, q.x + (rng() - 0.5), y0 + r * 1.2, q.z + (rng() - 0.5), 0xe5392f, 0.0, { ws: 4, hs: 3 });
          claim(q.x, q.z, 1.6, 'hedge'); placed++;
        }
        nH += placed ? 1 : 0;
      }
      ART_STATS.hedges = nH;
      // stone walls (low, chunky, mossy)
      let nW = 0;
      for (let s = 20; s < TLEN; s += 53){
        const side = rng() < 0.5 ? 1 : -1, off = hw + 5.5 + rng() * 2, len = 14 + rng() * 10;
        let placed = 0;
        for (let d = 0; d < len; d += 1.7){
          const q = atS(s + d, side * off); if (!ok(q.x, q.z, 1.0)) continue;
          const y0 = H(q.x, q.z);
          kit.sph(1.0, 0.55, 0.62, q.x, y0 + 0.4, q.z, (placed & 1) ? 0xc9c1b0 : 0xb4ab98, 0.06, { ws: 7, hs: 4, ry: Math.atan2(q.tx, q.tz) + (rng() - 0.5) * 0.3 });
          if (placed % 3 === 0) kit.sph(0.7, 0.4, 0.5, q.x, y0 + 0.95, q.z, 0xc9c1b0, 0.05, { ws: 6, hs: 4, ry: Math.atan2(q.tx, q.tz) });
          claim(q.x, q.z, 1.0, 'wall'); placed++;
        }
        nW += placed ? 1 : 0;
      }
      ART_STATS.walls = nW;
    }
    // bushes / flowers / boulders scattered along the corridor (density halves on phones)
    {
      const FL = [0xff5a7a, 0xffd23d, 0xffffff, 0xb07bff, 0xff9a2a, 0x6fd4ff];
      let nB = 0, nF = 0, nR = 0;
      const nBush = Math.round(130 * DEN), nPatch = Math.round(100 * DEN), nRock = Math.round(34 * DEN);
      for (let i = 0; i < nBush; i++){
        const q = atS(rng() * TLEN, (rng() < 0.5 ? 1 : -1) * (hw + 5 + rng() * 34)); if (!ok(q.x, q.z, 1.4)) continue;
        const y0 = H(q.x, q.z), s = 0.8 + rng() * 0.9, c = rng() < 0.5 ? 0x3fa13b : 0x57b844;
        kit.sph(1.4 * s, 1.0 * s, 1.3 * s, q.x, y0 + 0.7 * s, q.z, c, 0.07, { ws: 8, hs: 5 });
        kit.sph(0.9 * s, 0.75 * s, 0.9 * s, q.x + 0.9 * s, y0 + 0.55 * s, q.z + 0.3 * s, 0x6cc044, 0.06, { ws: 7, hs: 4 });
        if (rng() < 0.4) for (let b = 0; b < 4; b++) kit.sph(0.14, 0.14, 0.14, q.x + (rng() - 0.5) * 2 * s, y0 + (0.6 + rng() * 0.9) * s, q.z + (rng() - 0.5) * 2 * s, rng() < 0.5 ? 0xe5392f : 0x7a4bd6, 0.0, { ws: 4, hs: 3 });
        claim(q.x, q.z, 1.5 * s, 'bush'); nB++;
      }
      for (let i = 0; i < nPatch; i++){
        const q = atS(rng() * TLEN, (rng() < 0.5 ? 1 : -1) * (hw + 4 + rng() * 26)); if (!ok(q.x, q.z, 1.2, { noOwn: true })) continue;
        const base = pick(FL), n = 5 + Math.floor(rng() * 5);
        for (let f = 0; f < n; f++){
          const fx = q.x + (rng() - 0.5) * 3.2, fz = q.z + (rng() - 0.5) * 3.2; if (roadD(fx, fz) < hw + MARGIN + 0.3 || wet(fx, fz)) continue;
          const y0 = GH(fx, fz);
          kit.cyl(0.025, 0.45, fx, y0, fz, 0x3f9e35, 0.0, 3, { sway: 0.1 });
          kit.sph(0.17, 0.12, 0.17, fx, y0 + 0.5, fz, rng() < 0.75 ? base : pick(FL), 0, { ws: 5, hs: 3, sway: 0.1, swayAxis: 'y' });
          nF++;
        }
        registry.push({ kind: 'flowers', x: q.x, y: H(q.x, q.z), z: q.z, r: 1.6 });
      }
      for (let i = 0; i < nRock; i++){
        const q = atS(rng() * TLEN, (rng() < 0.5 ? 1 : -1) * (hw + 4 + rng() * 40)); if (!ok(q.x, q.z, 1.6)) continue;
        const y0 = H(q.x, q.z), s = 0.9 + rng() * 1.5;
        kit.sph(1.2 * s, 0.8 * s, 1.0 * s, q.x, y0 + 0.4 * s, q.z, rng() < 0.5 ? 0xb9b5aa : 0xa9a69b, 0.08, { ws: 7, hs: 4, ry: rng() * 3 });
        claim(q.x, q.z, 1.4 * s, 'boulder'); nR++;
      }
      ART_STATS.bushes = nB; ART_STATS.flowers = nF; ART_STATS.boulders = nR;
    }

    // ------------------------------------------------------------------------------------------
    //  LIFE: circling birds, butterflies over the flower patches, drifting leaves + pollen
    // ------------------------------------------------------------------------------------------
    // flapping creatures: instanced custom geometry whose wing vertices (aWing=1) beat in the vertex shader
    function flapMaterial(speed, amp){
      const m = T.mat(0xffffff, { side: THREE.DoubleSide });
      m.onBeforeCompile = sh => {
        sh.uniforms.uHT = U.uHT;
        sh.vertexShader = 'attribute float aWing;\nuniform float uHT;\n' + sh.vertexShader.replace('#include <begin_vertex>',
          'vec3 transformed = vec3(position);\n#ifdef USE_INSTANCING\nfloat fph = instanceMatrix[3][0]*0.7 + instanceMatrix[3][2]*0.5;\n#else\nfloat fph = 0.0;\n#endif\n' +
          'transformed.y += sin(uHT*' + speed.toFixed(1) + ' + fph) * aWing * ' + amp.toFixed(2) + ';\n');
      };
      m.customProgramCacheKey = () => 'hhFlap' + speed + '_' + amp; m.userData.hhArt = true; return m;
    }
    function flapGeo(tris){        // tris: [[x,y,z,wing] x3, ...]
      const P = [], W = [], Nn = [];
      for (const t of tris){ for (const v of t){ P.push(v[0], v[1], v[2]); W.push(v[3]); Nn.push(0, 1, 0); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1)); return g;
    }
    const birds = { list: [] }, flies = { list: [] }, leaves = { list: [] };
    {
      // birds: dark swallow with a pointed tail
      const g = flapGeo([
        [[0, 0, 0.5, 0], [0, 0, -0.5, 0], [0, 0.12, 0, 0]],
        [[0, 0, 0.3, 0], [1.1, 0.05, -0.2, 1], [0, 0, -0.3, 0]], [[0, 0, 0.3, 0], [0, 0, -0.3, 0], [1.1, 0.05, -0.2, 1]],
        [[0, 0, 0.3, 0], [0, 0, -0.3, 0], [-1.1, 0.05, -0.2, 1]], [[0, 0, 0.3, 0], [-1.1, 0.05, -0.2, 1], [0, 0, -0.3, 0]],
        [[0, 0, -0.3, 0], [0.25, 0, -0.8, 0], [-0.25, 0, -0.8, 0]]]);
      const nB = MOBILE ? 8 : 15;
      const im = new THREE.InstancedMesh(g, flapMaterial(11, 0.45), nB); im.frustumCulled = false; im.userData.hhDynamic = true; root.add(im);
      const centres = [[240, 40], [60, 40], [140, 125], [-40, -70], [160, -90], [-70, -38], [30, -120], [100, 20]];
      for (let i = 0; i < nB; i++){ const c = centres[i % centres.length]; birds.list.push({ cx: c[0] + (rng() - 0.5) * 20, cz: c[1] + (rng() - 0.5) * 20, r: 14 + rng() * 26, y: 24 + rng() * 22, w: (rng() < 0.5 ? -1 : 1) * (0.15 + rng() * 0.2), ph: rng() * 6.28, s: 1.8 + rng() * 0.7 }); im.setColorAt(i, col(i % 3 === 0 ? 0xfff6e8 : i % 3 === 1 ? 0x35406e : 0x2b2b3a)); }
      im.instanceColor.needsUpdate = true; birds.im = im;
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), Pp = new THREE.Vector3(), Ss = new THREE.Vector3();
      birds.update = (t) => { for (let i = 0; i < birds.list.length; i++){ const b = birds.list[i], a = b.ph + t * b.w;
        const x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a) * b.r, y = b.y + Math.sin(t * 0.6 + b.ph) * 2;
        const hd = Math.atan2(-Math.sin(a) * b.w, Math.cos(a) * b.w); E.set(0, hd, -b.w * 2.2); Q.setFromEuler(E);
        M.compose(Pp.set(x, y, z), Q, Ss.set(b.s, b.s, b.s)); im.setMatrixAt(i, M); } im.instanceMatrix.needsUpdate = true; };
      birds.update(0);
      // butterflies
      const gb = flapGeo([
        [[0, 0, 0.12, 0], [0, 0, -0.12, 0], [0.5, 0, 0.0, 1]], [[0, 0, 0.12, 0], [0.5, 0, 0.0, 1], [0, 0, -0.12, 0]],
        [[0, 0, 0.12, 0], [0, 0, -0.12, 0], [-0.5, 0, 0.0, 1]], [[0, 0, 0.12, 0], [-0.5, 0, 0.0, 1], [0, 0, -0.12, 0]]]);
      const fl = registry.filter(r => r.kind === 'flowers');
      const nF = fl.length ? (MOBILE ? 8 : 18) : 0;
      if (nF){
        const mf = new THREE.InstancedMesh(gb, flapMaterial(26, 0.22), nF); mf.frustumCulled = false; mf.userData.hhDynamic = true; root.add(mf);
        const cols = [0xffd23d, 0xff7aa8, 0x6fd4ff, 0xffffff, 0xff9a2a];
        for (let i = 0; i < nF; i++){ const f = fl[Math.floor(rng() * fl.length)]; flies.list.push({ cx: f.x, cz: f.z, y: f.y, ph: rng() * 6.28, sp: 0.5 + rng() * 0.6, r: 1.5 + rng() * 2.5 }); mf.setColorAt(i, col(cols[i % cols.length])); }
        mf.instanceColor.needsUpdate = true; flies.im = mf;
        flies.update = (t) => { for (let i = 0; i < nF; i++){ const b = flies.list[i], a = b.ph + t * b.sp;
          const x = b.cx + Math.cos(a) * b.r + Math.sin(a * 2.3) * 0.8, z = b.cz + Math.sin(a * 1.3) * b.r, y = b.y + 1.2 + Math.sin(a * 3.1) * 0.5;
          const vx = -Math.sin(a) * b.r + Math.cos(a * 2.3) * 1.8, vz = Math.cos(a * 1.3) * 1.3 * b.r; E.set(0.15, Math.atan2(vx, vz), Math.sin(a * 4) * 0.2); Q.setFromEuler(E);
          M.compose(Pp.set(x, y, z), Q, Ss.set(1, 1, 1)); mf.setMatrixAt(i, M); } mf.instanceMatrix.needsUpdate = true; };
        flies.update(0);
      }
      // drifting leaves + pollen: tiny diamonds recycled in a box around the camera
      const nL = MOBILE ? 22 : 44;
      const gl = new THREE.OctahedronGeometry(0.11, 0); gl.scale(1.5, 0.45, 1);
      const lm = new THREE.MeshBasicMaterial({ color: 0xffffff }); lm.userData.hhArt = true;
      const ml = new THREE.InstancedMesh(gl, lm, nL); ml.frustumCulled = false; ml.userData.hhDynamic = true; root.add(ml);
      const lc = [0xffd23d, 0xff9a2a, 0xe5392f, 0xfff3b0, 0x9bd64a];
      for (let i = 0; i < nL; i++){ leaves.list.push({ ox: (rng() - 0.5) * 90, oy: rng() * 22, oz: (rng() - 0.5) * 90, ph: rng() * 6.28, fall: 0.5 + rng() * 0.7, drift: 0.8 + rng() * 1.3 }); ml.setColorAt(i, col(lc[i % lc.length])); }
      ml.instanceColor.needsUpdate = true; leaves.im = ml;
      leaves.update = (t) => {
        const cx = camera.position.x, cz = camera.position.z, cy = camera.position.y;
        for (let i = 0; i < nL; i++){ const l = leaves.list[i];
          const yy = ((l.oy - t * l.fall) % 24 + 24) % 24, x = cx + ((l.ox + Math.sin(t * 0.4 + l.ph) * 4 + t * l.drift + 135) % 90 + 90) % 90 - 45, z = cz + ((l.oz + Math.cos(t * 0.33 + l.ph) * 3 + 135) % 90 + 90) % 90 - 45;
          E.set(t * 1.3 + l.ph, t * 0.9 + l.ph, t * 1.7); Q.setFromEuler(E);
          M.compose(Pp.set(x, GH(x, z) + 0.6 + yy, z), Q, Ss.set(1, 1, 1)); ml.setMatrixAt(i, M); }
        ml.instanceMatrix.needsUpdate = true; };
      leaves.update(0);
    }
    // lantern / lamp bulbs (unlit, so they glow at any light level) — instanced
    if (glows.length){
      const g = new THREE.SphereGeometry(1, 8, 6), m = new THREE.MeshBasicMaterial({ color: 0xffffff }); m.userData.hhArt = true;
      const im = new THREE.InstancedMesh(g, m, glows.length); im.frustumCulled = false; root.add(im);
      const M = new THREE.Matrix4(), Ss = new THREE.Vector3(), Pp = new THREE.Vector3(), Q = new THREE.Quaternion();
      glows.forEach((gl, i) => { M.compose(Pp.set(gl.x, gl.y, gl.z), Q, Ss.set(gl.r, gl.r * 1.2, gl.r)); im.setMatrixAt(i, M); im.setColorAt(i, col(gl.c)); registry.push({ kind: 'lantern-bulb', x: gl.x, y: gl.y, z: gl.z, r: gl.r }); });
      im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
    }

    // ------------------------------------------------------------------------------------------
    //  FINISH: bake the static kit, build the crowd, wire the per-frame update
    // ------------------------------------------------------------------------------------------
    const kitMeshes = kit.finish(root);
    buildCrowd();
    ART_STATS.kitMeshes = kitMeshes.length;
    let hideTimer = 0, hideTries = 0;
    function update(dt, t){
      U.uHT.value = t;
      dome.position.copy(camera.position);
      cloudRoot.position.set(camera.position.x, 0, camera.position.z); cloudRoot.rotation.y += dt * 0.004; cloudRoot.visible = camera.position.y < 70;   // an overhead camera would see the ring below it
      for (const a of animators) a(dt, t);
      if (crowd.update) crowd.update(t);
      if (sparkle.update) sparkle.update(t);
      if (ducks.update) ducks.update(t);
      if (birds.update) birds.update(t);
      if (flies.update) flies.update(t);
      if (leaves.update) leaves.update(t);
      if (hideTargets.length && hideTries < 40){ hideTimer -= dt; if (hideTimer <= 0){ hideTimer = 0.5; hideTries++; hideStatic(); if ((hideTargets.found || 0) >= 6) hideTries = 99; } }
    }
    // test hooks: advance the animation clock without the game loop
    const art = { root, registry, stats: ART_STATS, update, rotor, crowd, ducks, birds, flies, leaves, sparkle, signMeshes, dome, cloudRoot, hw, hideStatic,
      roadD, ok, uniforms: U, kitMeshes, MOBILE,
      dispose(){ scene.remove(root); root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); } };
    hideStatic();
    return art;
  }
})();
