// Farm Kart — YETI RIDGE art pass (Storybook toon). Lead-authored 2026-10-12.
// window.FK_YETI_ART.build(scene, ctx) runs ONLY on ?track=yeti-ridge (farmkart.html hook); .update(dt, t) every frame.
// Scenery only: no physics, no track data, no gameplay state. Everything is MeshToon (FK_TOON) or MeshBasic, ink-outlined,
// baked into spatial chunks by the Kit (or instanced when it animates) and kept off the drivable corridor.
// The engine half of this file (road queries, obstacle claims, the Kit, decals, signs, bunting, the crowd) is copied from
// assets/farmkart-hh-art.js on purpose — each course module stays self-contained.
(function(){
  'use strict';
  const A = window.FK_YETI_ART = window.FK_YETI_ART || {};
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
    const rng = T.rng(0x7e71b0b0);
    const rr = (a, b) => a + (b - a) * rng();
    const pick = arr => arr[Math.floor(rng() * arr.length) % arr.length];
    const H = (x, z) => ctx.sampleHeight(x, z);
    const GH = (x, z) => (ctx.groundSampleHeight || ctx.sampleHeight)(x, z);
    const root = new THREE.Group(); root.name = 'yrArt'; scene.add(root);
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
      m.customProgramCacheKey = () => 'yrToonSway';
      m.userData.yrArt = true; return m;
    }
    const MAT = { solid: toonVC(), decal: toonVC({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), cloud: toonVC({ emissive: 0x5d6a96 }) };
    const INKMAT = new THREE.MeshBasicMaterial({ color: T.INK, side: THREE.BackSide });
    INKMAT.onBeforeCompile = sh => swayInject(sh, true);
    INKMAT.customProgramCacheKey = () => 'yrInkSway';
    INKMAT.userData.noToon = true; INKMAT.userData.fkOutline = true; INKMAT.userData.yrArt = true;

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
        mesh.userData.yrKit = true; mesh.userData.noOutline = true; mesh.name = 'yr_' + key;
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
            const h = new THREE.Mesh(hg, INKMAT); h.userData.noOutline = true; h.userData.noToon = true; h.userData.fkOutline = true; h.name = 'yr_ink_' + key;
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

    // ==========================================================================================
    //  YETI RIDGE — everything below is this course's own art (the engine above is shared with
    //  assets/farmkart-hh-art.js by copy, per the house convention of self-contained page modules)
    // ==========================================================================================
    const PAL = { red: 0xe5392f, redD: 0xb02a22, cream: 0xfff1d0, wood: 0xa8703a, woodD: 0x7a4e28, woodL: 0xd29a5a, snow: 0xf4f8ff, snowS: 0xd6e4f5,
      ice: 0x9fdcf5, iceD: 0x5fb8e6, iceL: 0xd8f4ff, rock: 0x8d9ab0, rockD: 0x67738a, pine: 0x2f7f5a, white: 0xffffff, yellow: 0xffd23d, orange: 0xff8a2a,
      teal: 0x2ec4b6, plum: 0x8a5bd6, pink: 0xff7aa8, blue: 0x3f7fe0, navy: 0x2d3e6e, cocoa: 0x6b3f26, gold: 0xf2b630 };
    const skyBlue = 0x8fc8f2, HAZE = 0xe7eef8;

    // ------------------------------------------------------------------------------------------
    //  SKY + LIGHT: crisp winter blue to a pale pink horizon; the 'snow' preset keeps falling
    // ------------------------------------------------------------------------------------------
    const SUNDIR = V3(-0.45, 0.46, -0.76).normalize();
    let hemiL = null, sunL = null;
    scene.traverse(o => { if (o.isHemisphereLight && !hemiL) hemiL = o; else if (o.isDirectionalLight && !sunL) sunL = o; });
    // snow is near-white: keep the lit band at ~1.0 so it reads white, and tint the shadow band cold blue
    if (hemiL){ hemiL.color.setHex(0xeaf3ff); hemiL.groundColor.setHex(0x8fa6c8); hemiL.intensity = 0.5; }
    if (sunL){ sunL.color.setHex(0xfff6e8); sunL.intensity = 0.62; sunL.position.set(SUNDIR.x * 120, SUNDIR.y * 120, SUNDIR.z * 120); }
    scene.fog = new THREE.Fog(HAZE, 200, 820);
    const prevSky = ctx.getSkyObj ? ctx.getSkyObj() : null;
    // keep the snowfall from the 'snow' preset; hide only its grey toon dome + generic clouds
    if (prevSky) prevSky.traverse(o => { if (o.name === 'fkToonSky' || o.name === 'fkSkyDome') o.visible = false; });
    const dome = T.skyDome([[-1, HAZE], [0.0, HAZE], [0.05, 0xfbe3ea], [0.16, 0xe3eefb], [0.38, 0xa9d6f7], [0.72, 0x6fb5ee], [1, 0x4c9be6]],
      { sunDir: SUNDIR, sunColor: 0xfffaf0, sunSize: 0.0028, glow: 0.45, radius: 700 });
    dome.userData.yrFar = true; root.add(dome);
    const cloudRoot = new THREE.Group(); root.add(cloudRoot);
    {
      const ck = new Kit(); const crng = T.rng(1717);
      const n = MOBILE ? 8 : 14;
      for (let i = 0; i < n; i++){
        const a = (i / n) * TAU + crng() * 0.3, rad = 380 + crng() * 200, y = 110 + crng() * 110, s = 0.5 + crng() * 0.7;
        const cx = Math.cos(a) * rad, cz = Math.sin(a) * rad, dir = a + Math.PI / 2, puffs = 5 + Math.floor(crng() * 4);
        for (let j = 0; j < puffs; j++){
          const u = (j / (puffs - 1) - 0.5) * 2, r = (14 + crng() * 9) * s * (1 - 0.4 * Math.abs(u));
          ck.sph(r, r * 0.85, r, cx + Math.cos(dir) * u * 30 * s, y + (1 - Math.abs(u)) * 8 * s, cz + Math.sin(dir) * u * 30 * s, j % 2 ? 0xffffff : 0xf3f0ff, 0.55, { ws: 8, hs: 5 });
        }
        ck.sph(32 * s, 10 * s, 14 * s, cx, y - 5 * s, cz, 0xe6ecff, 0.55, { ws: 10, hs: 5, ry: -dir });
      }
      CH_OVERRIDE = 1e7; ck.finish(cloudRoot, { mat: MAT.cloud }); CH_OVERRIDE = 0;
      cloudRoot.traverse(o => { if (o.isMesh){ o.frustumCulled = false; o.renderOrder = -5; o.userData.yrFar = true; } });
    }

    // ------------------------------------------------------------------------------------------
    //  GROUND: snow, with cold-blue drifts, wind-scoured rock on steep slopes, plowed banks by the road
    // ------------------------------------------------------------------------------------------
    const SN = { a: col(0xf6f9ff), b: col(0xe4eefb), drift: col(0xcfdff3), deep: col(0xb9cde9), rock: col(0x8f9bb0), rockD: col(0x6f7b92), bank: col(0xffffff),
      slush: col(0x9aa3ad), ice: col(0xa9e0f5), haze: col(HAZE) };
    function snowColor(x, z, d, slope){
      const n1 = vnoise(x * 0.025 + 3.1, z * 0.025 - 1.3), n2 = vnoise(x * 0.09 + 7.7, z * 0.09 + 2.2);
      const c = new THREE.Color().copy(SN.a).lerp(SN.b, sstep(0.45, 0.6, n2)).lerp(SN.drift, sstep(0.6, 0.78, n1) * 0.8).lerp(SN.deep, (1 - sstep(0.18, 0.32, n1)) * 0.5);
      if (slope != null) c.lerp(slope > 0.9 ? SN.rockD : SN.rock, sstep(0.55, 0.85, slope));   // wind-scoured rock on steep faces
      if (d != null && d < hw + 3.2) c.lerp(SN.bank, 1 - sstep(hw + 0.3, hw + 3.2, d));         // plowed snowbank hugging the road
      return c;
    }
    let groundMesh = null, roadMesh = null, curbMeshes = [];
    root.parent.traverse(o => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const pc = o.geometry.attributes.position.count;
      if (o.userData.yrKit) return;
      if (pc > 9000 && o.geometry.attributes.color && (!groundMesh || pc > groundMesh.geometry.attributes.position.count)) groundMesh = o;
      if (pc === N * 9 && !o.geometry.attributes.color) roadMesh = o;
      else if (pc === N * 2 && !o.geometry.attributes.color && o.geometry.index) curbMeshes.push(o);
    });
    // green grass blades have no place on a glacier: hide the corridor + painted tuft fields on this track
    root.parent.traverse(o => { if (o.isInstancedMesh && !o.userData.yrKit && o.count > 300 && o.geometry){ if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); if (o.geometry.boundingSphere.radius < 1.6){ o.visible = false; ART_STATS.tuftsHidden = (ART_STATS.tuftsHidden || 0) + 1; } } });
    if (groundMesh){
      const g = groundMesh.geometry, pa = g.attributes.position, ca = g.attributes.color, n = pa.count;
      for (let i = 0; i < n; i++){
        const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
        const old = [ca.getX(i), ca.getY(i), ca.getZ(i)];
        const e = 1.5, sx = (GH(x + e, z) - GH(x - e, z)) / (2 * e), sz = (GH(x, z + e) - GH(x, z - e)) / (2 * e);
        const c = snowColor(x, z, roadD(x, z), Math.hypot(sx, sz));
        // painted physics surfaces: ICE (pale blue) and SLUSH (the reserved mud brown) — show them as ice / grey slush
        const di = Math.abs(old[0] - SN.ice.r) + Math.abs(old[1] - SN.ice.g) + Math.abs(old[2] - SN.ice.b);
        if (di < 0.25) c.lerp(SN.ice, 1 - di / 0.25);
        if (old[0] < 0.4 && old[1] < 0.3) c.lerp(SN.slush, 0.85);
        ca.setXYZ(i, c.r, c.g, c.b);
      }
      ca.needsUpdate = true;
      groundMesh.material = T.mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide });
      groundMesh.material.userData.yrArt = true;
    }
    // skirt: the snowfield continues past the played ground and climbs into the mountain ring
    const HXW = (GX1 - GX0) / 2, HZW = (GZ1 - GZ0) / 2;
    const rectNorm = (x, z) => Math.max(Math.abs(x - CXW) / HXW, Math.abs(z - CZW) / HZW);
    function skirtH(x, z){
      const f = rectNorm(x, z);
      if (f <= 1) return GH(x, z);
      const pin = { x: CXW + (x - CXW) / f, z: CZW + (z - CZW) / f };
      const edge = GH(pin.x, pin.z);
      const hill = 8 + 40 * Math.pow(vnoise(x * 0.008 + 1.3, z * 0.008 - 5.1), 1.2) * (0.4 + 0.6 * sstep(1.2, 2.2, f));
      return lerp(edge, hill, sstep(1.0, 1.6, f));
    }
    {
      const per = [], step = 5;
      const nx = Math.ceil((GX1 - GX0) / 2.5), nz = Math.ceil((GZ1 - GZ0) / 2.5), X1 = GX0 + nx * 2.5, Z1 = GZ0 + nz * 2.5;
      for (let x = GX0; x < X1; x += step) per.push([x, GZ0]);
      for (let z = GZ0; z < Z1; z += step) per.push([X1, z]);
      for (let x = X1; x > GX0; x -= step) per.push([x, Z1]);
      for (let z = Z1; z > GZ0; z -= step) per.push([GX0, z]);
      const F = [1, 1.03, 1.08, 1.16, 1.28, 1.45, 1.7, 2.0, 2.4, 2.9], K = F.length, M = per.length, pos = [], cl = [], idx = [];
      const cx = (GX0 + X1) / 2, cz = (GZ0 + Z1) / 2;
      for (let k = 0; k < K; k++) for (let j = 0; j < M; j++){
        const px = cx + (per[j][0] - cx) * F[k], pz = cz + (per[j][1] - cz) * F[k];
        const y = k === 0 ? GH(per[j][0], per[j][1]) : skirtH(px, pz);
        pos.push(px, y, pz);
        const c = snowColor(px, pz, 99, null); c.lerp(SN.haze, sstep(1.3, 3.0, F[k]) * 0.35); cl.push(c.r, c.g, c.b);
      }
      for (let k = 0; k + 1 < K; k++) for (let j = 0; j < M; j++){ const a = k * M + j, b = k * M + (j + 1) % M, c = (k + 1) * M + j, d = (k + 1) * M + (j + 1) % M; idx.push(a, c, b, b, c, d); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, T.mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
      m.name = 'yrSkirt'; m.userData.yrKit = true; m.userData.yrFar = true; m.frustumCulled = false; m.userData.noOutline = true; root.add(m);
    }
    // the mountain ring: jagged blue-grey peaks with fat snow caps (three atmospheric layers)
    {
      const mk = new Kit(); const mr = T.rng(4401);
      const layers = [[1.85, 2.1, 0x7f8fae, 1.0, 14], [2.25, 2.5, 0x93a6c6, 0.8, 12], [2.65, 2.9, 0xb3c4dd, 0.6, 11]];
      layers.forEach(([f0, f1, hex, ink, cnt], li) => {
        const n = Math.round(cnt * (MOBILE ? 0.7 : 1));
        for (let i = 0; i < n; i++){
          const a = ((i + mr() * 0.8) / n) * TAU, f = lerp(f0, f1, mr());
          const dx = Math.cos(a), dz = Math.sin(a), t = Math.min(HXW / Math.abs(dx || 1e-6), HZW / Math.abs(dz || 1e-6));
          const x = CXW + dx * t * f, z = CZW + dz * t * f, y = skirtH(x, z) - 6;
          const h = 70 + mr() * 90 - li * 10, r = h * (0.55 + mr() * 0.25);
          const rock = col(hex).lerp(SN.haze, li * 0.12);
          mk.cone(r, r * 0.06, h, x, y, z, rock, ink, 7, { ry: mr() * 3 });
          // snow cap: a squat cone over the top 45% plus a lumpy drip ring
          mk.cone(r * 0.5, r * 0.05, h * 0.46, x, y + h * 0.56, z, col(0xffffff).lerp(SN.haze, li * 0.1), ink * 0.8, 7, { ry: mr() * 3 });
          for (let q = 0; q < 5; q++){ const qa = q / 5 * TAU + mr(); mk.sph(r * 0.16, r * 0.1, r * 0.16, x + Math.cos(qa) * r * 0.44, y + h * 0.56, z + Math.sin(qa) * r * 0.44, 0xffffff, 0, { ws: 6, hs: 4 }); }
          // a shoulder peak beside it
          if (mr() < 0.6){ const sxo = (mr() - 0.5) * r * 1.4, szo = (mr() - 0.5) * r * 1.4, h2 = h * (0.45 + mr() * 0.25);
            mk.cone(r * 0.6, r * 0.05, h2, x + sxo, y, z + szo, rock, ink, 6); mk.cone(r * 0.3, r * 0.04, h2 * 0.42, x + sxo, y + h2 * 0.6, z + szo, 0xffffff, ink * 0.8, 6); }
        }
      });
      CH_OVERRIDE = 1e7; mk.finish(root).forEach(m => { m.userData.yrFar = true; }); CH_OVERRIDE = 0;
    }

    // ------------------------------------------------------------------------------------------
    //  ROAD: packed snow with blue tyre ruts and sparkle; glassy cracked ice across the frozen lake
    // ------------------------------------------------------------------------------------------
    function roadTexture(){
      const W = 512, Hh = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const g = cv.getContext('2d'); const tr = T.rng(9090);
      g.fillStyle = '#eef3fb'; g.fillRect(0, 0, W, Hh);
      const blob = (x, y, rx, ry, rot, style) => { g.fillStyle = style; for (const oy of [-Hh, 0, Hh]){ g.beginPath(); g.ellipse(x, y + oy, rx, ry, rot, 0, TAU); g.fill(); } };
      for (let i = 0; i < 55; i++) blob(tr() * W, tr() * Hh, 22 + tr() * 60, 8 + tr() * 22, tr() * 3, tr() > 0.5 ? '#f7faff' : '#dde7f5');
      const rut = (u0, wd) => {
        for (let pass = 0; pass < 3; pass++){
          g.beginPath(); const half = pass === 0 ? wd / 2 + 6 : pass === 1 ? wd / 2 : wd / 2 - 7;
          const style = pass === 0 ? '#ffffff' : pass === 1 ? '#b9cce6' : '#a3badb';
          for (let y = 0; y <= Hh; y += 8){ const x = u0 * W + Math.sin(y / Hh * TAU * 2) * 5 - half; y === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
          for (let y = Hh; y >= 0; y -= 8){ const x = u0 * W + Math.sin(y / Hh * TAU * 2) * 5 + half; g.lineTo(x, y); }
          g.closePath(); g.fillStyle = style; g.fill();
        }
        // tyre-tread chevrons pressed into the rut
        g.strokeStyle = 'rgba(140,165,205,.55)'; g.lineWidth = 3;
        for (let y = 0; y < Hh; y += 14){ const x = u0 * W + Math.sin(y / Hh * TAU * 2) * 5; g.beginPath(); g.moveTo(x - wd / 2 + 6, y + 6); g.lineTo(x, y); g.lineTo(x + wd / 2 - 6, y + 6); g.stroke(); }
      };
      rut(0.3, 34); rut(0.7, 34);
      for (let i = 0; i < 160; i++){ const x = tr() * W, y = tr() * Hh; g.fillStyle = tr() > 0.4 ? '#ffffff' : '#c8f0ff'; g.fillRect(x, y, 2, 2); }   // sparkle
      g.fillStyle = '#d3dff0'; g.fillRect(0, 0, 10, Hh); g.fillRect(W - 10, 0, 10, Hh);
      const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = Math.min(8, ctx.renderer ? ctx.renderer.capabilities.getMaxAnisotropy() : 4); tex.needsUpdate = true; return tex;
    }
    function iceTexture(){
      const W = 512, Hh = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const g = cv.getContext('2d'); const tr = T.rng(7171);
      const grd = g.createLinearGradient(0, 0, W, 0); grd.addColorStop(0, '#8fd3f2'); grd.addColorStop(0.5, '#bfeaff'); grd.addColorStop(1, '#8fd3f2');
      g.fillStyle = grd; g.fillRect(0, 0, W, Hh);
      for (let i = 0; i < 26; i++){ g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); const x = tr() * W, y = tr() * Hh; g.ellipse(x, y, 40 + tr() * 80, 6 + tr() * 10, -0.5, 0, TAU); g.fill(); }   // glossy streaks
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2.5;
      for (let i = 0; i < 18; i++){ let x = tr() * W, y = tr() * Hh; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++){ x += (tr() - 0.5) * 70; y += (tr() - 0.3) * 50; g.lineTo(x, y); } g.stroke(); }   // cracks
      g.strokeStyle = 'rgba(70,140,190,.5)'; g.lineWidth = 1.5;
      for (let i = 0; i < 12; i++){ let x = tr() * W, y = tr() * Hh; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++){ x += (tr() - 0.5) * 50; y += (tr() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
      const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.needsUpdate = true; return tex;
    }
    const TILE = TLEN / Math.max(1, Math.round(TLEN / 24));
    if (!roadMesh && curbMeshes.length >= 3) roadMesh = curbMeshes.shift();
    ART_STATS.origRoadHex = roadMesh ? roadMesh.material.color.getHex() : null;
    if (roadMesh){
      const op = roadMesh.geometry.attributes.position, cols = op.count / N, pos = [], uv = [], idx = [];
      for (let i = 0; i <= N; i++){ const ii = i % N; for (let w = 0; w < cols; w++){ const vi = ii * cols + w; pos.push(op.getX(vi), op.getY(vi), op.getZ(vi)); uv.push(w / (cols - 1), (i === N ? TLEN : AS[ii]) / TILE); } }
      for (let i = 0; i < N; i++) for (let w = 0; w < cols - 1; w++){ const a = i * cols + w, b = a + 1, c = (i + 1) * cols + w, d = c + 1; idx.push(a, b, c, b, d, c); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      roadMesh.geometry.dispose(); roadMesh.geometry = g;
      roadMesh.material = T.mat(0xffffff, { map: roadTexture(), side: THREE.DoubleSide }); roadMesh.material.userData.yrArt = true;
    }
    for (const cm of curbMeshes){ cm.material = T.mat(0xdfe9f6, { side: THREE.DoubleSide }); cm.material.userData.yrArt = true; }
    // ICE ROAD: a glassy cracked overlay wherever the track paints physics ice on the road
    const paintF = TR.paint;
    const iceAt = (x, z) => { if (!paintF) return false; const v = paintF.cells[Math.round(x / paintF.cell) + ',' + Math.round(z / paintF.cell)]; return v === 0xa9e0f5; };
    let iceRange = null;
    {
      let s0 = -1, s1 = -1;
      for (let i = 0; i < N; i++) if (iceAt(C[i].x, C[i].z)){ if (s0 < 0) s0 = AS[i]; s1 = AS[i]; }
      if (s0 >= 0){
        iceRange = [s0, s1];
        const pts = []; for (let s = s0; s <= s1; s += 1.6) pts.push(atS(s, 0));
        const g = ribbonGeo(pts, hw * 2 + 0.6, (x, z, p) => p.y + 0.06, 0xffffff);
        const uv = []; for (let i = 0; i < pts.length; i++){ const v = (i * 1.6) / 14; uv.push(0, v, 1, v); }
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        const m = new THREE.Mesh(g, T.mat(0xffffff, { map: iceTexture(), transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, depthWrite: false }));
        m.userData.yrKit = true; m.userData.noOutline = true; m.name = 'yrIceRoad'; m.renderOrder = 2; root.add(m);
        ART_STATS.iceRoad = [Math.round(s0), Math.round(s1)];
      }
    }
    // candy-cane curbs on the corners (inside edge; both edges in the tight hairpins)
    const curv = new Float32Array(N); for (let i = 0; i < N; i++) curv[i] = curvAt(i, 10);
    const inRampZone = (x, z) => TR.objects && TR.objects.some(o => o.type === 'ramp' && Math.hypot(o.x - x, o.z - z) < 16);
    {
      const stripeL = 2.2, CT = 0.014, CT2 = 0.03;
      const RED = col(0xe8392d), WHITE = col(0xffffff), REDS = col(0xb5251d), WHITES = col(0xd5dfee);
      const prism = (a, b, c, d, topc, sidec) => {
        const P = [], N3 = [], Cc = [];
        const tri = (p, q, r, cc) => { P.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z); const ux = q.x - p.x, uy = q.y - p.y, uz = q.z - p.z, vx = r.x - p.x, vy = r.y - p.y, vz = r.z - p.z;
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; for (let q2 = 0; q2 < 3; q2++){ N3.push(nx / l, ny / l, nz / l); Cc.push(cc.r, cc.g, cc.b); } };
        const lo = pt => ({ x: pt.x, y: pt.y - 0.5, z: pt.z });
        tri(a, c, b, topc); tri(b, c, d, topc);
        tri(c, lo(c), d, sidec); tri(d, lo(c), lo(d), sidec); tri(a, lo(a), c, sidec); tri(c, lo(a), lo(c), sidec); tri(b, d, lo(b), sidec); tri(d, lo(d), lo(b), sidec);
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N3, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); return g;
      };
      const ck = new Kit(); let nCurb = 0;
      for (const side of [1, -1]){
        for (let s = 0; s < TLEN; s += stripeL){
          const i = idxAtS(s + stripeL / 2), cv = curv[i], inside = (cv > 0 ? 1 : -1) === side;
          if (!(Math.abs(cv) > (inside ? CT : CT2))) continue;
          if (iceRange && s > iceRange[0] - 4 && s < iceRange[1] + 4) continue;
          const p0 = atS(s, 0), p1 = atS(s + stripeL, 0), o0 = side * (hw - 0.45), o1 = side * (hw + 0.75);
          const mk = (p, o) => ({ x: p.x + p.nx * o, y: p.y + 0.2, z: p.z + p.nz * o });
          const A0 = mk(p0, o0), B0 = mk(p1, o0), A1 = mk(p0, o1), B1 = mk(p1, o1), red = (Math.round(s / stripeL) & 1) === 0;
          const g = side > 0 ? prism(A0, B0, A1, B1, red ? RED : WHITE, red ? REDS : WHITES) : prism(B0, A0, B1, A1, red ? RED : WHITE, red ? REDS : WHITES);
          ck.addGeo(g, new THREE.Matrix4(), null, 0.05); nCurb++;
          registry.push({ kind: 'curb', x: (p0.x + p1.x) / 2 + p0.nx * side * hw, y: p0.y, z: (p0.z + p1.z) / 2 + p0.nz * side * hw, r: 1.1, road: true });
        }
      }
      ck.finish(root).forEach(m => { m.userData.yrRoad = true; }); ART_STATS.curbStripes = nCurb;
    }
    // the two jump ramps: the ski jump in white with blue racing stripes, the gorge jump as packed-snow over timber
    for (const o of (TR.objects || [])){
      if (o.type !== 'ramp') continue;
      for (const g of scene.children){
        if (!g.isGroup || g.name === 'yrArt' || Math.hypot(g.position.x - o.x, g.position.z - o.z) > 0.6) continue;
        g.traverse(m => { if (m.isMesh && m.material && !m.userData.fkOutline){ m.material = T.mat(o.id === 'yr_skijump' ? 0xf4f8ff : 0xe9eef6, { side: THREE.DoubleSide }); m.material.userData.yrArt = true; } });
        T.outlineTree(g, 0.09);
      }
    }

    // ------------------------------------------------------------------------------------------
    //  LANDMARK TOOLKIT (copied from the Harvest Hollow pass) + snow-specific pieces
    // ------------------------------------------------------------------------------------------
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
    // a snow-laden pine (procedural; the GLB pines carry the bulk, these fill the art set-pieces)
    function pine(k, x, z, s, tone){
      const y = H(x, z);
      k.place(x, y, z, rng() * TAU, q => {
        q.cyl(0.35 * s, 1.4 * s, 0, 0, 0, PAL.woodD, 0.04, 6);
        for (let t = 0; t < 3; t++){ const r = (2.3 - t * 0.6) * s, h = (2.4 - t * 0.3) * s, y0 = (1.1 + t * 1.55) * s;
          q.cone(r, r * 0.08, h, 0, y0, 0, tone || PAL.pine, 0.07, 8); q.cone(r * 0.82, r * 0.1, h * 0.36, 0, y0 + h * 0.62, 0, PAL.snow, 0.0, 8); }
      });
    }
    // a log cabin with a fat snow roof, chimney (smoke emitter) and glowing windows
    const chimneys = [];
    function cabin(x, z, ry, s, wall){
      const y = H(x, z);
      claim(x, z, 6 * s, 'cabin');
      kit.place(x, y, z, ry, k => {
        for (let r = 0; r < 6; r++){ k.cylC(0.32 * s, 7.4 * s, 0, (0.35 + r * 0.6) * s, 2.6 * s, r & 1 ? PAL.wood : PAL.woodD, 0.05, 8, { rz: Math.PI / 2 }); k.cylC(0.32 * s, 7.4 * s, 0, (0.35 + r * 0.6) * s, -2.6 * s, r & 1 ? PAL.wood : PAL.woodD, 0.05, 8, { rz: Math.PI / 2 });
          k.cylC(0.32 * s, 5.6 * s, 3.5 * s, (0.65 + r * 0.6) * s, 0, r & 1 ? PAL.woodD : PAL.wood, 0.05, 8, { rx: Math.PI / 2 }); k.cylC(0.32 * s, 5.6 * s, -3.5 * s, (0.65 + r * 0.6) * s, 0, r & 1 ? PAL.woodD : PAL.wood, 0.05, 8, { rx: Math.PI / 2 }); }
        k.box(6.6 * s, 3.5 * s, 4.8 * s, 0, 1.8 * s, 0, wall || PAL.woodL, 0.0);
        // roof: two slabs + a pillowy snow load overhanging the eaves
        for (const sd of [-1, 1]){ k.box(8.6 * s, 0.35 * s, 3.9 * s, 0, 4.6 * s, sd * 1.55 * s, PAL.redD, 0.06, { rx: -sd * 0.62 });
          k.box(8.9 * s, 0.6 * s, 3.8 * s, 0, 4.95 * s, sd * 1.5 * s, PAL.snow, 0.07, { rx: -sd * 0.62 }); }
        k.sph(4.7 * s, 0.7 * s, 0.9 * s, 0, 6.05 * s, 0, PAL.snow, 0.06);
        k.box(1.1 * s, 2.4 * s, 1.1 * s, 2.2 * s, 5.6 * s, -0.9 * s, 0xb7553f, 0.06); k.box(1.35 * s, 0.4 * s, 1.35 * s, 2.2 * s, 6.9 * s, -0.9 * s, PAL.snow, 0.05);
        k.box(1.4 * s, 2.3 * s, 0.2 * s, 0, 1.2 * s, 2.75 * s, PAL.redD, 0.04);
        for (const wx of [-2.3, 2.3]){ k.box(1.3 * s, 1.1 * s, 0.15 * s, wx * s, 2.2 * s, 2.72 * s, PAL.woodD, 0.03); }
      });
      // warm windows (unlit glow) + the chimney mouth for smoke
      const cs = Math.cos(ry), sn = Math.sin(ry);
      for (const wx of [-2.3, 2.3]){ const lx = wx * s, lz = 2.85 * s; glows.push({ x: x + cs * lx + sn * lz, y: y + 2.2 * s, z: z - sn * lx + cs * lz, r: 0.45 * s, c: 0xffc85a }); }
      { const lx = 2.2 * s, lz = -0.9 * s; chimneys.push({ x: x + cs * lx + sn * lz, y: y + 7.2 * s, z: z - sn * lx + cs * lz }); }
    }

    // ------------------------------------------------------------------------------------------
    //  LODGE VILLAGE: start gantry of ice crystals, snowbank grandstand + crowd, cabins, cocoa stand, string lights
    // ------------------------------------------------------------------------------------------
    const FIN = ctx.FINISH;
    const fnx = -FIN.tz, fnz = FIN.tx, fry = Math.atan2(FIN.tx, FIN.tz);
    let gantryMinClear = 0;
    {
      const SPAN = 17.5, baseY = H(FIN.cx, FIN.cz);
      const gpos = lat => ({ x: FIN.cx + fnx * lat, z: FIN.cz + fnz * lat });
      for (const sgn of [-1, 1]){
        const p = gpos(sgn * SPAN), y0 = H(p.x, p.z);
        claim(p.x, p.z, 3, 'gantry-pillar', { overhead: true });
        kit.place(p.x, y0, p.z, fry, k => {
          // a cluster of chunky ice crystals as the pillar, a snowball base and a gold star on top
          k.sph(2.6, 1.4, 2.6, 0, 0.6, 0, PAL.snow, 0.08);
          k.cone(1.3, 0.25, 12.5, 0, 0, 0, PAL.ice, 0.08, 6);
          k.cone(0.8, 0.12, 8.0, 0.9, 0, 0.4, PAL.iceL, 0.06, 6, { rz: -0.18 }); k.cone(0.7, 0.1, 6.5, -0.8, 0, -0.5, PAL.iceD, 0.06, 6, { rz: 0.2 });
          k.sph(0.9, 0.9, 0.35, 0, 13.4, 0, PAL.gold, 0.06, { ws: 5, hs: 4 });
        });
      }
      // the beam: a thick snow-capped log with a checker strip, 7.6u over the road
      const BEAM_Y = baseY + 9.8;
      kit.place(FIN.cx, BEAM_Y, FIN.cz, fry, k => {
        k.cylC(0.75, SPAN * 2 + 1.5, 0, 0, 0, PAL.wood, 0.08, 10, { rz: Math.PI / 2 });
        k.sph(SPAN + 0.6, 0.55, 0.85, 0, 0.75, 0, PAL.snow, 0.06, { ws: 16, hs: 5 });
        for (let i = 0; i < 18; i++) for (let r = 0; r < 2; r++) k.box(SPAN * 2 / 18, 0.6, 0.12, -SPAN + (i + 0.5) * SPAN * 2 / 18, -1.1 - r * 0.6, 0.0, (i + r) & 1 ? 0x1d1410 : PAL.white, 0.0);
        // icicles hanging under the beam (kept above 6u clearance)
        for (let i = 0; i < 26; i++){ const lx = -SPAN + 0.6 + i * (SPAN * 2 - 1.2) / 25; k.cone(0.18, 0.02, 0.6 + ((i * 37) % 7) * 0.08, lx, -2.2 - 0.6, 0, PAL.iceL, 0.0, 5, { rx: Math.PI }); }
      });
      gantryMinClear = BEAM_Y - 2.2 - 1.2 - baseY;
      registry.push({ kind: 'gantry', x: FIN.cx, y: BEAM_Y, z: FIN.cz, r: SPAN, overhead: true, minY: BEAM_Y - 3.4 });
      // banner
      const bm = new THREE.Mesh(new THREE.PlaneGeometry(13, 2.6), T.mat(0xffffff, { map: signTexture(['YETI RIDGE'], 512, 102, '#2d3e6e', '#ffffff', '#2b1a12'), side: THREE.DoubleSide }));
      bm.position.set(FIN.cx, BEAM_Y + 2.4, FIN.cz); bm.rotation.y = fry; bm.userData.noOutline = true; root.add(bm); signMeshes.push(bm);
      kit.place(FIN.cx, BEAM_Y, FIN.cz, fry, k => { k.box(13.6, 3.1, 0.3, 0, 2.4, -0.2, PAL.woodL, 0.06); k.cyl(0.14, 1.3, -5.6, 0.7, -0.2, PAL.woodD, 0.04, 6); k.cyl(0.14, 1.3, 5.6, 0.7, -0.2, PAL.woodD, 0.04, 6); });
      ART_STATS.gantryClear = +gantryMinClear.toFixed(2);
    }
    // snowbank grandstand with a cheering crowd of critters in bobble hats
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
    {
      const sP = atS(AS[FIN.idx] + 18, 0);
      let best = null;
      for (const side of [-1, 1]) for (const lat of [26, 30, 34, 22]){ const x = sP.x + sP.nx * lat * side, z = sP.z + sP.nz * lat * side; if (ok(x, z, 10)){ best = { x, z, side }; break; } }
      if (best){
        const face = Math.atan2(-sP.nx * best.side, -sP.nz * best.side), y0 = H(best.x, best.z), cs = Math.cos(face), sn = Math.sin(face);
        claim(best.x, best.z, 11, 'grandstand');
        kit.place(best.x, y0, best.z, face, k => {
          for (let t = 0; t < 3; t++) k.box(17 - t * 1.5, 1.84 * (t + 1), 2.1, 0, 0.92 * (t + 1), -t * 1.9, t & 1 ? PAL.snowS : PAL.snow, 0.08);
          for (let t = 0; t < 3; t++) k.sph(8.6 - t * 0.7, 0.45, 1.2, 0, 1.84 * (t + 1), -t * 1.9 + 0.2, PAL.white, 0.0, { ws: 14, hs: 4 });   // soft snow lips
          for (const px of [-8.4, 8.4]){ k.cyl(0.22, 7.6, px, 0, -5.9, 0x2d3e6e, 0.05, 6); k.cyl(0.22, 6.0, px, 0, 2.2, 0x2d3e6e, 0.05, 6); }
          for (let i = 0; i < 9; i++) k.box(1.95, 0.16, 8.8, -7.8 + i * 1.95, 6.7, -1.8, i & 1 ? PAL.blue : PAL.white, 0.04, { rx: 0.18 });
          k.sph(9.6, 0.5, 4.8, 0, 7.25, -1.8, PAL.snow, 0.05, { ws: 14, hs: 4, rx: 0.18 });
        });
        const shirt = [0xe5392f, 0x2ec4b6, 0xffd23d, 0x8a5bd6, 0xff8a2a, 0x4fb4e8, 0xff7aa8];
        for (let t = 0; t < 3; t++) for (let i = 0; i < 7 - t; i++){
          if (rng() < 0.1) continue;
          const lx = (i - (7 - t - 1) / 2) * 2.2 + (t & 1 ? 0.3 : 0), ly = 1.84 * (t + 1), lz = -t * 1.9;
          addCritter(best.x + cs * lx + sn * lz, y0 + ly, best.z - sn * lx + cs * lz, face, 1.15 + rng() * 0.2, Math.floor(rng() * 6), pick(shirt), t);
        }
      }
    }
    // cabins + cocoa stand + string lights along the village straight
    {
      const sides = [];
      for (let s = AS[FIN.idx] - 50; s < AS[FIN.idx] + 70; s += 15) for (const side of [1, -1]) sides.push({ s, side });
      let nCab = 0;
      const walls = [0xe9c79a, 0xf1d4ae, 0xd9b48a];
      for (const q of sides){
        const lat = 30 + rng() * 18, p = atS(q.s, lat * q.side);
        if (!ok(p.x, p.z, 7)) continue;
        cabin(p.x, p.z, Math.atan2(-p.nx * q.side, -p.nz * q.side), 0.95 + rng() * 0.2, pick(walls)); nCab++;
      }
      ART_STATS.cabins = nCab;
      // cocoa stand: striped awning, steaming pot, mugs
      const cp = findSpot(atS(AS[FIN.idx] - 22, 0).x + atS(AS[FIN.idx] - 22, 0).nx * 19, atS(AS[FIN.idx] - 22, 0).z + atS(AS[FIN.idx] - 22, 0).nz * 19, 3.5, 14);
      if (cp){ const p = atS(AS[FIN.idx] - 22, 0), face = Math.atan2(-p.nx, -p.nz), y = H(cp.x, cp.z); claim(cp.x, cp.z, 4, 'cocoa');
        kit.place(cp.x, y, cp.z, face, k => {
          k.box(4.6, 1.2, 1.8, 0, 0.6, 0, PAL.woodL, 0.06); k.box(4.8, 0.2, 2.0, 0, 1.3, 0, PAL.woodD, 0.04);
          for (const px of [-2.2, 2.2]) k.cyl(0.1, 3.1, px, 0, -0.8, PAL.woodD, 0.03, 6);
          for (let i = 0; i < 6; i++) k.box(0.8, 0.12, 2.6, -2.0 + i * 0.8, 3.15, -0.2, i & 1 ? PAL.red : PAL.white, 0.03, { rx: 0.2 });
          k.cyl(0.55, 0.7, -1.2, 1.4, 0, 0x3a3a46, 0.04, 10); k.cyl(0.5, 0.06, -1.2, 2.08, 0, PAL.cocoa, 0, 10);
          for (let i = 0; i < 4; i++) k.cyl(0.16, 0.3, 0.3 + i * 0.5, 1.4, 0.5, [PAL.red, PAL.teal, PAL.yellow, PAL.plum][i], 0.02, 8);
        });
        chimneys.push({ x: cp.x, y: y + 2.2, z: cp.z, small: true });
        addSign(cp.x + Math.cos(face) * 3.2, cp.z - Math.sin(face) * 3.2, face, 2.6, 1.1, ['HOT COCOA'], '#fff1d0', '#6b3f26', 0.4);
      }
      // string lights: bulb garlands between posts down both sides of the straight
      for (const side of [1, -1]){
        let prev = null;
        for (let s = AS[FIN.idx] - 44; s <= AS[FIN.idx] + 70; s += 14){
          const p = atS(s, side * (hw + 6.2));
          if (!ok(p.x, p.z, 0.6, { noOwn: true })) { prev = null; continue; }
          const y = H(p.x, p.z); kit.cyl(0.12, 4.4, p.x, y, p.z, 0x2d3e6e, 0.03, 6); claim(p.x, p.z, 0.8, 'light-post');
          const top = V3(p.x, y + 4.3, p.z);
          if (prev){ for (let i = 1; i < 8; i++){ const u = i / 8; glows.push({ x: lerp(prev.x, top.x, u), y: lerp(prev.y, top.y, u) - Math.sin(u * Math.PI) * 0.9, z: lerp(prev.z, top.z, u), r: 0.17, c: [0xff5a4a, 0xffd23d, 0x5ad1ff, 0x7dff8a][i % 4] }); }
            const d = prev.distanceTo(top), yaw = Math.atan2(top.x - prev.x, top.z - prev.z); kit.box(0.05, 0.05, d, (prev.x + top.x) / 2, (prev.y + top.y) / 2 - 0.6, (prev.z + top.z) / 2, 0x2b1a12, 0, { ry: yaw }); }
          prev = top;
        }
      }
    }

    // ------------------------------------------------------------------------------------------
    //  CHEVRON BOARDS on the sharp corners (outside edge, facing the approaching karts)
    // ------------------------------------------------------------------------------------------
    {
      const chevTex = (dir) => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const g = cv.getContext('2d');
        g.fillStyle = '#e8392d'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#2b1a12'; g.lineWidth = 10; g.strokeRect(5, 5, 246, 118);
        g.fillStyle = '#ffffff'; for (let k = 0; k < 3; k++){ const x0 = 40 + k * 64; g.beginPath(); if (dir > 0){ g.moveTo(x0 + 34, 22); g.lineTo(x0, 64); g.lineTo(x0 + 34, 106); g.lineTo(x0 + 52, 106); g.lineTo(x0 + 18, 64); g.lineTo(x0 + 52, 22); } else { g.moveTo(x0, 22); g.lineTo(x0 + 34, 64); g.lineTo(x0, 106); g.lineTo(x0 + 18, 106); g.lineTo(x0 + 52, 64); g.lineTo(x0 + 18, 22); } g.closePath(); g.fill(); }
        const t = new THREE.CanvasTexture(cv); t.needsUpdate = true; return t; };
      const TEX = { L: chevTex(1), R: chevTex(-1) };
      let nCh = 0, lastS = -1e9;
      for (let s = 0; s < TLEN; s += 4){
        const i = idxAtS(s), cv = curvAt(i, 14);
        if (Math.abs(cv) < 0.03 || s - lastS < 22) continue;
        const outer = cv > 0 ? -1 : 1;                 // the board stands on the OUTSIDE of the bend
        let q = null;   // just behind the road-edge wall (hw + 7); try a few spots round the bend
        for (const ds of [6, 0, 12, -6]){ for (const lat of [9.5, 12, 15]){ const c = atS(s + ds, outer * (hw + lat)); if (ok(c.x, c.z, 1.6)){ q = c; break; } } if (q) break; }
        if (!q) continue;
        const face = Math.atan2(-q.tx, -q.tz), y = H(q.x, q.z);
        kit.place(q.x, y, q.z, face, k => { k.cyl(0.12, 2.6, -1.1, 0, -0.1, PAL.woodD, 0.04, 6); k.cyl(0.12, 2.6, 1.1, 0, -0.1, PAL.woodD, 0.04, 6); k.box(3.0, 1.6, 0.16, 0, 1.9, -0.12, PAL.woodL, 0.05); k.box(3.2, 0.3, 0.5, 0, 2.85, -0.1, PAL.snow, 0.04); });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), T.mat(0xffffff, { map: cv > 0 ? TEX.L : TEX.R }));
        m.position.set(q.x, y + 1.9, q.z); m.rotation.y = face; m.translateZ(0.02); m.userData.noOutline = true; root.add(m); signMeshes.push(m);
        claim(q.x, q.z, 1.8, 'chevron'); nCh++; lastS = s;
      }
      ART_STATS.chevrons = nCh;
    }

    // ------------------------------------------------------------------------------------------
    //  SKI LIFT: towers from the village up the mountain to the summit massif; chairs ride the cable
    // ------------------------------------------------------------------------------------------
    const lift = { chairs: [], path: [], len: 0, mesh: null, minRoadClear: 1e9 };
    {
      const A0 = { x: 72, z: 28 }, A1 = { x: 214, z: 214 };
      const nT = 7, towers = [];
      for (let i = 0; i < nT; i++){
        let x = lerp(A0.x, A1.x, i / (nT - 1)), z = lerp(A0.z, A1.z, i / (nT - 1));
        const sp = findSpot(x, z, 1.5, 14, { noOwn: false }) || { x, z };
        towers.push({ x: sp.x, z: sp.z });
      }
      // cable height: high enough everywhere along each span (sample ground + road under it)
      for (let i = 0; i < nT; i++){ const t = towers[i]; t.y0 = H(t.x, t.z); }
      const CLEAR = 9;
      for (let i = 0; i < nT; i++){ towers[i].top = towers[i].y0 + 11; }
      for (let pass = 0; pass < 3; pass++) for (let i = 0; i + 1 < nT; i++){
        const a = towers[i], b = towers[i + 1];
        for (let u = 0; u <= 1; u += 0.05){ const x = lerp(a.x, b.x, u), z = lerp(a.z, b.z, u), cy = lerp(a.top, b.top, u), need = H(x, z) + (roadD(x, z) < hw + 2 ? CLEAR + 2 : CLEAR);
          if (cy < need){ const d = need - cy; a.top += d; b.top += d; } }
      }
      for (const t of towers){ claim(t.x, t.z, 1.6, 'lift-tower', { overhead: true });
        kit.place(t.x, t.y0, t.z, Math.atan2(A1.x - A0.x, A1.z - A0.z), k => { const h = t.top - t.y0; k.box(0.7, h, 0.7, 0, h / 2, 0, 0x2d3e6e, 0.06); k.box(4.2, 0.45, 0.5, 0, h, 0, 0x2d3e6e, 0.05); k.sph(0.5, 0.5, 0.5, -1.9, h + 0.1, 0, PAL.yellow, 0.04); k.sph(0.5, 0.5, 0.5, 1.9, h + 0.1, 0, PAL.yellow, 0.04); k.box(1.4, 0.4, 1.4, 0, 0.2, 0, PAL.rockD, 0.05); }); }
      // two cables (up + down line) as thin boxes per span
      for (let i = 0; i + 1 < nT; i++) for (const off of [-1.9, 1.9]){
        const a = towers[i], b = towers[i + 1], yaw = Math.atan2(b.x - a.x, b.z - a.z), cx = Math.cos(yaw), sx = Math.sin(yaw);
        const ax = a.x + cx * off, az = a.z - sx * off, bx = b.x + cx * off, bz = b.z - sx * off;
        const d = Math.hypot(bx - ax, bz - az, b.top - a.top), pitch = -Math.atan2(b.top - a.top, Math.hypot(bx - ax, bz - az));
        kit.box(0.08, 0.08, d, (ax + bx) / 2, (a.top + b.top) / 2 + 0.1, (az + bz) / 2, 0x2b1a12, 0, { ry: yaw, rx: pitch });
      }
      // path for the chairs: up on one cable, down on the other
      const up = towers.map(t => ({ x: t.x, z: t.z, y: t.top })), L1 = [];
      let len = 0; for (let i = 0; i + 1 < up.length; i++) len += Math.hypot(up[i + 1].x - up[i].x, up[i + 1].z - up[i].z, up[i + 1].y - up[i].y);
      lift.path = up; lift.len = len;
      // chairs (instanced, toon + ink), hanging 2.4 under the cable
      const nChairs = MOBILE ? 10 : 18;
      const gSeat = new THREE.BoxGeometry(1.6, 0.25, 0.9), gBack = new THREE.BoxGeometry(1.6, 0.9, 0.2), gBar = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5);
      const mkI = (g, c) => { const m = new THREE.InstancedMesh(g, T.mat(c), nChairs); m.frustumCulled = false; root.add(m); T.outline(m, 0.04); return m; };
      lift.mesh = [mkI(gSeat, PAL.red), mkI(gBack, PAL.red), mkI(gBar, 0x2d3e6e)];
      for (let i = 0; i < nChairs; i++) lift.chairs.push({ u: i / nChairs });
      ART_STATS.liftTowers = nT;
      // record the lowest clearance of a chair over the road (chairs hang 2.4 + 0.5 under the cable)
      for (let i = 0; i + 1 < nT; i++){ const a = towers[i], b = towers[i + 1];
        for (let u = 0; u <= 1; u += 0.02){ const x = lerp(a.x, b.x, u), z = lerp(a.z, b.z, u); const rn = roadNear(x, z);
          if (rn.d < hw + 1){ const cy = lerp(a.top, b.top, u) - 3.0; lift.minRoadClear = Math.min(lift.minRoadClear, cy - C[rn.i].y); } } }
      ART_STATS.liftRoadClear = +lift.minRoadClear.toFixed(2);
    }
    const _lm4 = new THREE.Matrix4(), _lq = new THREE.Quaternion(), _le = new THREE.Euler(), _ls = new THREE.Vector3(1, 1, 1), _lp = new THREE.Vector3();
    function liftAt(u, out){ // u in [0,1): 0..0.5 rides up the +side cable, 0.5..1 back down the -side
      const P = lift.path, n = P.length; const goingUp = u < 0.5; let w = goingUp ? u * 2 : (1 - u) * 2;
      const f = w * (n - 1), i = Math.min(n - 2, Math.floor(f)), t = f - i, a = P[i], b = P[i + 1];
      const yaw = Math.atan2(b.x - a.x, b.z - a.z), off = goingUp ? 1.9 : -1.9;
      out.x = lerp(a.x, b.x, t) + Math.cos(yaw) * off; out.z = lerp(a.z, b.z, t) - Math.sin(yaw) * off; out.y = lerp(a.y, b.y, t); out.yaw = yaw + (goingUp ? 0 : Math.PI); return out;
    }

    // ------------------------------------------------------------------------------------------
    //  GLACIER CAVE: ice-crystal portals and icicles along the tunnel mouths
    // ------------------------------------------------------------------------------------------
    // the cave shell itself: recolour the tunnel's brown rock as glacier ice (blue walls, white frost bands)
    if (ctx.tunnelGroup) ctx.tunnelGroup.traverse(m => {
      if (!m.isMesh || !m.geometry || !m.geometry.attributes.color) return;
      const pa = m.geometry.attributes.position, ca = m.geometry.attributes.color;
      for (let i = 0; i < ca.count; i++){ const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i), n = vnoise(x * 0.3, z * 0.3 + y * 0.5);
        const c = col(0x5fb8e6).lerp(col(0xbfeaff), n).lerp(col(0xffffff), sstep(0.78, 0.92, vnoise(y * 0.8, x * 0.1))); ca.setXYZ(i, c.r, c.g, c.b); }
      ca.needsUpdate = true;
      const om = Array.isArray(m.material) ? m.material[0] : m.material;
      m.material = T.mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide, emissive: 0x1d4a6e }); m.material.userData.yrArt = true;
      ART_STATS.caveIce = (ART_STATS.caveIce || 0) + 1;
    });
    for (const tn of (TR.tunnels || [])){
      const s0 = tn.s * TLEN - tn.len / 2, s1 = tn.s * TLEN + tn.len / 2;
      for (const sEnd of [s0 - 1.5, s1 + 1.5]){
        const p = atS(sEnd, 0), y = p.y;
        for (const side of [1, -1]){
          for (let q = 0; q < 4; q++){ const lat = side * (hw + 2.4 + q * 1.3), x = p.x + p.nx * lat, z = p.z + p.nz * lat;
            kit.cone(0.9 + rng() * 0.5, 0.1, 3 + rng() * 4.5, x, H(x, z) - 0.3, z, pick([PAL.ice, PAL.iceL, PAL.iceD]), 0.06, 6, { rx: (rng() - 0.5) * 0.4, rz: side * (0.15 + rng() * 0.2) }); }
          claim(p.x + p.nx * side * (hw + 4.4), p.z + p.nz * side * (hw + 4.4), 2.4, 'cave-crystal');
        }
        // icicles hanging across the portal mouth (above the 4.5u tunnel clearance line)
        for (let i = 0; i < 14; i++){ const lat = -hw + 0.6 + i * (hw * 2 - 1.2) / 13, x = p.x + p.nx * lat, z = p.z + p.nz * lat; kit.cone(0.22, 0.02, 0.9 + rng() * 0.8, x, y + 6.4, z, PAL.iceL, 0.0, 5, { rx: Math.PI }); }
        // glowing cyan crystals (unlit)
        for (const side of [1, -1]) glows.push({ x: p.x + p.nx * side * (hw + 2.2), y: y + 1.3, z: p.z + p.nz * side * (hw + 2.2), r: 0.55, c: 0x7fe9ff });
      }
      ART_STATS.cave = true;
    }

    // ------------------------------------------------------------------------------------------
    //  SKI JUMP: a timber start tower beside the run-up, flags, a JUMP banner and a crevasse full of ice
    // ------------------------------------------------------------------------------------------
    const flags = [];
    {
      const rampO = (TR.objects || []).find(o => o.id === 'yr_skijump');
      if (rampO){
        const sR = AS[roadNear(rampO.x, rampO.z).i];
        const t = findSpot(atS(sR - 24, 0).x + atS(sR - 24, 0).nx * (hw + 9), atS(sR - 24, 0).z + atS(sR - 24, 0).nz * (hw + 9), 4, 14);
        if (t){ const y = H(t.x, t.z); claim(t.x, t.z, 4.5, 'jump-tower');
          kit.place(t.x, y, t.z, 0, k => { for (const [px, pz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) k.box(0.45, 14, 0.45, px, 7, pz, PAL.woodD, 0.05);
            for (let r = 1; r < 5; r++) k.box(4.6, 0.3, 4.6, 0, r * 3.3, 0, PAL.wood, 0.05);
            k.box(5.4, 0.5, 5.4, 0, 14.2, 0, PAL.redD, 0.06); k.sph(3.3, 0.6, 3.3, 0, 14.7, 0, PAL.snow, 0.05); }); }
        // flag gates along the run-up and at the lip
        for (const ds of [-30, -16, -4]) for (const side of [1, -1]){
          const p = atS(sR + ds, side * (hw + 2.4)); if (!ok(p.x, p.z, 0.4, { noObj: true })) continue;
          const y = H(p.x, p.z); kit.cyl(0.09, 4.2, p.x, y, p.z, 0xffffff, 0.03, 6);
          flags.push({ x: p.x, y: y + 3.5, z: p.z, c: side > 0 ? PAL.red : PAL.blue });
        }
        // crevasse: blue ice crystals poking up out of the trench on both sides of the flight path
        const cr = atS(sR + 26, 0);
        for (let q = 0; q < 26; q++){ const side = q & 1 ? 1 : -1, lat = side * (hw + 4 + rng() * 26), along = (rng() - 0.5) * 12;
          const x = cr.x + cr.nx * lat + cr.tx * along, z = cr.z + cr.nz * lat + cr.tz * along;
          if (roadD(x, z) < hw + 2) continue;
          kit.cone(0.8 + rng() * 1.6, 0.1, 3 + rng() * 6, x, H(x, z) - 0.5, z, pick([PAL.ice, PAL.iceD, PAL.iceL]), 0.07, 6, { rx: (rng() - 0.5) * 0.5, rz: (rng() - 0.5) * 0.5 }); }
        ART_STATS.skiJump = true;
      }
    }

    // ------------------------------------------------------------------------------------------
    //  FROZEN LAKE: an ice sheet inside the sweep, fishing huts, skating penguins
    // ------------------------------------------------------------------------------------------
    const penguins = { list: [], meshes: null };
    let lakeCentre = null;
    if (iceRange){
      // centre of the sweep, pushed to the inside of the bend
      const mid = atS((iceRange[0] + iceRange[1]) / 2, 0), cvm = curv[mid.i], inside = cvm > 0 ? 1 : -1;
      const c0 = { x: mid.x + mid.nx * inside * 38, z: mid.z + mid.nz * inside * 38 };
      lakeCentre = c0;
      const RX = 34, RZ = 20, yaw = Math.atan2(mid.tx, mid.tz);
      const yL = Math.min(H(c0.x, c0.z), H(c0.x + 15, c0.z), H(c0.x - 15, c0.z)) + 0.12;
      // draped ellipse (follows the snow gently so it never floats)
      const pos = [], cl = [], idx = [], R = 18, A = 36;
      for (let r = 0; r <= R; r++) for (let a = 0; a < A; a++){
        const rr2 = r / R, ang = a / A * TAU, lx = Math.cos(ang) * RX * rr2, lz = Math.sin(ang) * RZ * rr2;
        const x = c0.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z = c0.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz;
        const y = Math.max(yL, GH(x, z) + 0.1) + (r === R ? 0 : 0.02);
        pos.push(x, y, z); const c = col(0x6cc6ee).lerp(col(0xbfeaff), 0.35 + 0.35 * Math.sin(lx * 0.2 + lz * 0.31)).lerp(col(0xffffff), r === R ? 0.6 : 0); cl.push(c.r, c.g, c.b);
      }
      for (let r = 0; r < R; r++) for (let a = 0; a < A; a++){ const p = r * A + a, q = r * A + (a + 1) % A, s2 = (r + 1) * A + a, t2 = (r + 1) * A + (a + 1) % A; idx.push(p, s2, q, q, s2, t2); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3)); g.setIndex(idx); g.computeVertexNormals();
      const na = g.attributes.normal; for (let i = 0; i < na.count; i++) na.setXYZ(i, 0, 1, 0);
      const lm = new THREE.Mesh(g, T.mat(0xffffff, { vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
      lm.userData.yrKit = true; lm.userData.noOutline = true; lm.name = 'yrLake'; root.add(lm);
      registry.push({ kind: 'lake', x: c0.x, y: yL, z: c0.z, r: RX, decal: true });
      // snowbank rim
      for (let a = 0; a < 40; a++){ const ang = a / 40 * TAU, lx = Math.cos(ang) * (RX + 1.5), lz = Math.sin(ang) * (RZ + 1.5);
        const x = c0.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z = c0.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz; if (roadD(x, z) < hw + 2.5) continue;
        kit.sph(2.4, 0.7, 2.0, x, GH(x, z) + 0.1, z, PAL.snow, 0.05, { ry: ang }); }
      // ice-fishing huts with little stovepipes
      for (let i = 0; i < 3; i++){ const ang = 0.5 + i * 1.9, lx = Math.cos(ang) * RX * 0.55, lz = Math.sin(ang) * RZ * 0.5;
        const x = c0.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, z = c0.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz; if (roadD(x, z) < hw + 6) continue;
        const y = yL; claim(x, z, 2.5, 'fishing-hut');
        kit.place(x, y, z, ang * 2, k => { k.box(2.4, 2.2, 2.6, 0, 1.1, 0, [PAL.red, PAL.blue, PAL.yellow][i], 0.06); k.box(2.8, 0.35, 3.0, 0, 2.4, 0, PAL.snow, 0.05); k.box(0.7, 1.4, 0.1, 0, 0.9, 1.31, PAL.woodD, 0.03); k.cyl(0.14, 0.9, 0.7, 2.4, -0.6, 0x3a3a46, 0.03, 6); });
        chimneys.push({ x: x + 0.7, y: y + 3.3, z: z - 0.6, small: true });
      }
      // penguins skating loops on the ice (instanced; body / belly / beak / feet)
      const nP = MOBILE ? 4 : 7;
      for (let i = 0; i < nP; i++) penguins.list.push({ r: 6 + rng() * (RZ * 0.6), ph: rng() * TAU, w: (rng() < 0.5 ? 1 : -1) * (0.35 + rng() * 0.3), s: 0.9 + rng() * 0.3 });
      const mkP = (geo, c) => { const m = new THREE.InstancedMesh(geo, T.mat(c), nP); m.frustumCulled = false; root.add(m); T.outline(m, 0.03); return m; };
      penguins.meshes = [mkP(new THREE.SphereGeometry(0.55, 10, 8), 0x1f2433), mkP(new THREE.SphereGeometry(0.4, 10, 8), 0xffffff), mkP(new THREE.ConeGeometry(0.12, 0.35, 6).rotateX(Math.PI / 2), PAL.orange)];
      penguins.c0 = c0; penguins.yL = yL; penguins.rx = RX / RZ; penguins.yaw = yaw;
    }

    // ------------------------------------------------------------------------------------------
    //  GORGE: a frozen waterfall upstream of the jump, icicle cliffs, a rope-rail fence on the lip
    // ------------------------------------------------------------------------------------------
    {
      const W = (TR.waters || [])[0];
      if (W){
        const fx = W.x - 34, fz = W.z;                      // upstream along the creek channel
        const y0 = W.y - 0.2;
        claim(fx, fz, 6, 'frozen-falls');
        kit.place(fx, y0, fz, Math.PI / 2, k => {
          k.box(14, 13, 5, 0, 6.5, -3.5, PAL.rock, 0.1);                         // cliff face
          k.sph(7.5, 2, 3.5, 0, 13.2, -3.5, PAL.snow, 0.08);
          for (let i = 0; i < 9; i++){ const lx = -4 + i, h = 8 + ((i * 53) % 5); k.cone(0.9, 0.35, h, lx, 0.2, -0.6 + (i & 1) * 0.4, i & 1 ? PAL.iceL : PAL.ice, 0.06, 7); }   // the frozen fall
          for (let i = 0; i < 6; i++) k.sph(1.6, 0.8, 1.2, -4 + i * 1.6, 0.4, 0.6, PAL.iceL, 0.05);
        });
        // icicle-hung boulders along the creek banks
        for (let i = 0; i < 12; i++){ const x = W.x + (rng() - 0.5) * 70, z = W.z + (rng() < 0.5 ? -1 : 1) * (9 + rng() * 5);
          if (!ok(x, z, 1.8, { wet: true })) continue; const y = H(x, z);
          kit.sph(1.8 + rng(), 1.3, 1.6, x, y + 0.6, z, PAL.rock, 0.07); kit.sph(1.6, 0.5, 1.4, x, y + 1.7, z, PAL.snow, 0.05);
          for (let q = 0; q < 3; q++) kit.cone(0.15, 0.02, 0.7, x + (q - 1) * 0.6, y + 0.4, z + 1.4, PAL.iceL, 0, 5, { rx: Math.PI }); claim(x, z, 2, 'boulder'); }
        ART_STATS.gorge = true;
      }
    }

    // ------------------------------------------------------------------------------------------
    //  YETI'S CAVE: a rock arch on the outside of Yeti's Elbow with a big friendly yeti who waves
    // ------------------------------------------------------------------------------------------
    const yeti = { root: null, armL: null, armR: null, head: null, wave: 0, pos: null };
    {
      // the tightest corner of the last third of the lap
      let bi = -1, bc = 0;
      for (let i = Math.floor(N * 0.9); i < N; i++){ const c = Math.abs(curvAt(i, 16)); if (c > bc){ bc = c; bi = i; } }
      if (bi >= 0){
        const outer = curv[bi] > 0 ? -1 : 1, p = atS(AS[bi], 0);
        let spot = null;
        for (const lat of [24, 28, 32, 36, 20]){ const x = p.x + p.nx * outer * lat, z = p.z + p.nz * outer * lat; if (ok(x, z, 7)){ spot = { x, z }; break; } }
        if (spot){
          const face = Math.atan2(p.x - spot.x, p.z - spot.z), y0 = H(spot.x, spot.z);
          claim(spot.x, spot.z, 9, 'yeti-cave');
          kit.place(spot.x, y0, spot.z, face, k => {
            k.sph(9, 8, 6, 0, 3, -6, PAL.rock, 0.12, { ws: 10, hs: 7 }); k.sph(6.5, 6, 5, -6, 2, -3, PAL.rockD, 0.1); k.sph(6.5, 6, 5, 6, 2, -3, PAL.rockD, 0.1);
            k.sph(9.5, 2.4, 6.5, 0, 10, -6, PAL.snow, 0.09); k.sph(4, 3.4, 1, 0, 3.2, -1.2, 0x1d2333, 0.0);          // dark cave mouth
            for (let i = 0; i < 8; i++) k.cone(0.3, 0.03, 1.2 + (i % 3) * 0.4, -3 + i * 0.85, 6.6, -1.4, PAL.iceL, 0, 5, { rx: Math.PI });
          });
          // the yeti (its own meshes: the arms animate)
          const Y = new THREE.Group(); Y.position.set(spot.x, y0, spot.z); Y.rotation.y = face; root.add(Y); yeti.root = Y; yeti.pos = spot;
          const fur = T.mat(0xf3f6ff), face_ = T.mat(0x7fb8e8), dark = T.mat(0x1d2333), horn = T.mat(0xd9c9a6), mouthM = T.mat(0xd84a5a), teeth = T.mat(0xffffff);
          const add = (geo, mat, x, y, z, par, ink) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); (par || Y).add(m); if (ink !== 0) T.outline(m, ink || 0.08); m.castShadow = true; return m; };
          add(new THREE.SphereGeometry(3.2, 18, 14).scale(1, 1.25, 0.9), fur, 0, 4.4, 0.6);                          // body
          for (const sx of [-1, 1]) add(new THREE.SphereGeometry(1.2, 12, 10).scale(1, 0.8, 1.3), fur, sx * 1.4, 0.8, 1.2);   // feet
          const head = new THREE.Group(); head.position.set(0, 8.4, 0.9); Y.add(head); yeti.head = head;
          add(new THREE.SphereGeometry(2.3, 18, 14), fur, 0, 0, 0, head);
          add(new THREE.SphereGeometry(1.55, 16, 12).scale(1.15, 1, 0.6), face_, 0, -0.2, 1.75, head);
          for (const sx of [-1, 1]){ add(new THREE.SphereGeometry(0.34, 10, 8), teeth, sx * 0.62, 0.35, 2.55, head, 0.03); add(new THREE.SphereGeometry(0.17, 8, 6), dark, sx * 0.6, 0.38, 2.82, head, 0);
            add(new THREE.ConeGeometry(0.45, 1.8, 8).rotateZ(-sx * 0.5), horn, sx * 1.6, 1.9, 0, head, 0.05); }
          add(new THREE.SphereGeometry(0.75, 12, 8).scale(1.3, 0.55, 0.5), mouthM, 0, -0.75, 2.2, head, 0.03);
          for (const sx of [-0.35, 0.35]) add(new THREE.BoxGeometry(0.28, 0.32, 0.12), teeth, sx, -0.55, 2.45, head, 0);
          const mkArm = (sx) => { const a = new THREE.Group(); a.position.set(sx * 2.9, 6.2, 0.6); Y.add(a);
            add(new THREE.CylinderGeometry(0.9, 0.8, 4.6, 10), fur, 0, -2.3, 0, a);   // (r128 has no usable CapsuleGeometry)
            add(new THREE.SphereGeometry(1.0, 12, 10), face_, 0, -4.6, 0.2, a, 0.05); return a; };
          yeti.armL = mkArm(-1); yeti.armR = mkArm(1); yeti.armR.rotation.z = 0.2; yeti.armL.rotation.z = -0.2;
          registry.push({ kind: 'yeti', x: spot.x, y: y0, z: spot.z, r: 4 });
          ART_STATS.yeti = true;
        }
      }
    }

    // ------------------------------------------------------------------------------------------
    //  LIFE: bunnies hopping in the forest, birds wheeling over the summit, chimney smoke
    // ------------------------------------------------------------------------------------------
    const bunnies = { list: [], meshes: null };
    {
      const nB = MOBILE ? 5 : 10;
      for (let i = 0; i < nB * 6 && bunnies.list.length < nB; i++){
        const x = -20 + (rng() - 0.5) * 120, z = 290 + (rng() - 0.5) * 90; if (!ok(x, z, 1.2)) continue;
        bunnies.list.push({ x, z, ph: rng() * TAU, ry: rng() * TAU, rate: 3 + rng() * 2 });
      }
      const n = bunnies.list.length;
      if (n){
        const mkB = (geo, c) => { const m = new THREE.InstancedMesh(geo, T.mat(c), n); m.frustumCulled = false; root.add(m); T.outline(m, 0.025); return m; };
        bunnies.meshes = [mkB(new THREE.SphereGeometry(0.45, 10, 8), 0xffffff), mkB(new THREE.SphereGeometry(0.3, 10, 8), 0xffffff), mkB(new THREE.ConeGeometry(0.09, 0.55, 6), 0xffd6e0)];
      }
    }
    const birds = { list: [], mesh: null };
    {
      const nb = MOBILE ? 4 : 8;
      for (let i = 0; i < nb; i++) birds.list.push({ cx: 200 + (rng() - 0.5) * 60, cz: 210 + (rng() - 0.5) * 60, r: 16 + rng() * 20, y: 52 + rng() * 18, ph: rng() * TAU, w: 0.3 + rng() * 0.2 });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1.4, 0, 0, 0, 0.1, -0.4, 0, 0.1, 0.4, 1.4, 0, 0, 0, 0.1, 0.4, 0, 0.1, -0.4], 3)); g.computeVertexNormals();
      birds.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x2d3e6e, side: THREE.DoubleSide }), nb); birds.mesh.frustumCulled = false; root.add(birds.mesh);
    }
    const smoke = { puffs: [], mesh: null, acc: 0 };
    {
      const n = Math.max(1, chimneys.length) * 6;
      smoke.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.7, 8, 6), T.mat(0xffffff), n); smoke.mesh.frustumCulled = false; root.add(smoke.mesh);
      for (let i = 0; i < n; i++) smoke.puffs.push({ c: i % Math.max(1, chimneys.length), t: (i / n) * 3.0 });
    }

    // ------------------------------------------------------------------------------------------
    //  extra pines inside the hairpins and around the cabins (procedural, merged)
    // ------------------------------------------------------------------------------------------
    {
      let n = 0;
      const tries = Math.round(220 * DEN);
      for (let i = 0; i < tries; i++){
        const x = lerp(GX0 + 20, GX1 - 20, rng()), z = lerp(GZ0 + 20, GZ1 - 20, rng());
        const d = roadD(x, z); if (d > 70 || !ok(x, z, 2.4)) continue;
        if (lakeCentre && Math.hypot(x - lakeCentre.x, z - lakeCentre.z) < 40) continue;
        pine(kit, x, z, 1.1 + rng() * 0.9, pick([PAL.pine, 0x3a8f63, 0x2a6e52])); claim(x, z, 2.6, 'pine'); n++;
      }
      ART_STATS.pines = n;
    }

    // ------------------------------------------------------------------------------------------
    //  FINISH: bake the kit, instance the glows + flags, wire the animation
    // ------------------------------------------------------------------------------------------
    const kitMeshes = kit.finish(root);
    const glowMesh = (() => { if (!glows.length) return null; const m = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), glows.length);
      const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(); glows.forEach((gl, i) => { M4.compose(V3(gl.x, gl.y, gl.z), Q, V3(gl.r, gl.r * 1.2, gl.r)); m.setMatrixAt(i, M4); m.setColorAt(i, col(gl.c)); registry.push({ kind: 'glow', x: gl.x, y: gl.y, z: gl.z, r: gl.r }); });
      m.instanceColor.needsUpdate = true; m.userData.noOutline = true; root.add(m); return m; })();
    const flagMesh = (() => { if (!flags.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.4, 0, 0, -0.4, 0, 1.4, 0, 0], 3)); g.computeVertexNormals();
      const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), flags.length); flags.forEach((f, i) => m.setColorAt(i, col(f.c))); m.instanceColor.needsUpdate = true; m.frustumCulled = false; root.add(m); return m; })();
    buildCrowd();
    root.traverse(o => { if (o.isMesh){ o.userData.yrKit = true; if (o.material && o.material.userData) o.material.userData.yrArt = true; } });

    const M4 = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), E4 = new THREE.Euler(), S4 = new THREE.Vector3(), P4 = new THREE.Vector3();
    let clock = 0;
    function update(dt, t){
      clock = t; U.uHT.value = t;
      if (crowd.update) crowd.update(t);
      cloudRoot.rotation.y += dt * 0.004;
      if (camera){ dome.position.copy(camera.position); cloudRoot.position.set(camera.position.x, 0, camera.position.z); }
      // ski-lift chairs
      if (lift.mesh){ const [seat, back, bar] = lift.mesh, o = {};
        lift.chairs.forEach((c, i) => { const u = ((c.u + t * 0.012) % 1 + 1) % 1; liftAt(u, o);
          E4.set(0, o.yaw, Math.sin(t * 1.3 + i) * 0.05, 'YXZ'); Q4.setFromEuler(E4);
          M4.compose(P4.set(o.x, o.y - 1.2, o.z), Q4, S4.set(1, 1, 1)); bar.setMatrixAt(i, M4);
          M4.compose(P4.set(o.x, o.y - 2.6, o.z), Q4, S4.set(1, 1, 1)); seat.setMatrixAt(i, M4);
          P4.set(o.x - Math.sin(o.yaw) * 0.4, o.y - 2.15, o.z - Math.cos(o.yaw) * 0.4); M4.compose(P4, Q4, S4.set(1, 1, 1)); back.setMatrixAt(i, M4); });
        lift.mesh.forEach(m => { m.instanceMatrix.needsUpdate = true; }); }
      // penguins skate loops; belly faces the direction of travel
      if (penguins.meshes){ const [body, belly, beak] = penguins.meshes, pc = penguins.c0;
        penguins.list.forEach((p, i) => { const a = p.ph + t * p.w, lx = Math.cos(a) * p.r * penguins.rx * 0.8, lz = Math.sin(a) * p.r * 0.8;
          const x = pc.x + Math.cos(penguins.yaw) * lx + Math.sin(penguins.yaw) * lz, z = pc.z - Math.sin(penguins.yaw) * lx + Math.cos(penguins.yaw) * lz;
          const heading = Math.atan2(-Math.sin(a) * Math.sign(p.w), Math.cos(a) * Math.sign(p.w)) + penguins.yaw, lean = Math.sin(t * 3 + i) * 0.15;
          E4.set(0, heading, lean, 'YXZ'); Q4.setFromEuler(E4); const y = penguins.yL + 0.6 * p.s;
          M4.compose(P4.set(x, y, z), Q4, S4.set(p.s, p.s * 1.25, p.s)); body.setMatrixAt(i, M4);
          M4.compose(P4.set(x + Math.sin(heading) * 0.22 * p.s, y - 0.05, z + Math.cos(heading) * 0.22 * p.s), Q4, S4.set(p.s, p.s * 1.2, p.s * 0.7)); belly.setMatrixAt(i, M4);
          M4.compose(P4.set(x + Math.sin(heading) * 0.5 * p.s, y + 0.45 * p.s, z + Math.cos(heading) * 0.5 * p.s), Q4, S4.set(p.s, p.s, p.s)); beak.setMatrixAt(i, M4); });
        penguins.meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; }); }
      // bunnies hop in place, turning now and then
      if (bunnies.meshes){ const [b, h, e] = bunnies.meshes;
        bunnies.list.forEach((q, i) => { const ph = t * q.rate + q.ph, hop = Math.max(0, Math.sin(ph)) * 0.5, y = H(q.x, q.z) + 0.4 + hop, ry = q.ry + Math.floor(ph / TAU) * 0.9;
          E4.set(0, ry, 0, 'YXZ'); Q4.setFromEuler(E4);
          M4.compose(P4.set(q.x, y, q.z), Q4, S4.set(1, 0.9, 1.2)); b.setMatrixAt(i, M4);
          M4.compose(P4.set(q.x + Math.sin(ry) * 0.42, y + 0.32, q.z + Math.cos(ry) * 0.42), Q4, S4.set(1, 1, 1)); h.setMatrixAt(i, M4);
          M4.compose(P4.set(q.x + Math.sin(ry) * 0.42, y + 0.75, q.z + Math.cos(ry) * 0.42), Q4, S4.set(1, 1, 1)); e.setMatrixAt(i, M4); });
        bunnies.meshes.forEach(m => { m.instanceMatrix.needsUpdate = true; }); }
      // birds
      if (birds.mesh){ birds.list.forEach((b, i) => { const a = b.ph + t * b.w; E4.set(0, -a, Math.sin(t * 6 + i) * 0.5, 'YXZ'); Q4.setFromEuler(E4);
        M4.compose(P4.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(t * 0.7 + i) * 2, b.cz + Math.sin(a) * b.r), Q4, S4.set(1, 1, 1)); birds.mesh.setMatrixAt(i, M4); }); birds.mesh.instanceMatrix.needsUpdate = true; }
      // chimney smoke: puffs rise, drift, grow, then shrink away (toon puffs never alpha-fade)
      if (smoke.mesh && chimneys.length){ smoke.puffs.forEach((p, i) => { p.t += dt; if (p.t > 3) p.t -= 3; const c = chimneys[p.c], u = p.t / 3, s = (c.small ? 0.5 : 0.9) * (0.4 + u * 1.4) * (u > 0.75 ? (1 - u) / 0.25 : 1);
        M4.compose(P4.set(c.x + u * 2.5 + Math.sin(u * 6 + i) * 0.4, c.y + u * 6, c.z + u * 1.2), Q4.identity(), S4.set(s, s, s)); smoke.mesh.setMatrixAt(i, M4); }); smoke.mesh.instanceMatrix.needsUpdate = true; }
      // flags flutter
      if (flagMesh){ flags.forEach((f, i) => { E4.set(0, Math.sin(t * 3 + i) * 0.6 + i, Math.sin(t * 7 + i * 2) * 0.12, 'YXZ'); Q4.setFromEuler(E4); M4.compose(P4.set(f.x, f.y, f.z), Q4, S4.set(1, 1, 1)); flagMesh.setMatrixAt(i, M4); }); flagMesh.instanceMatrix.needsUpdate = true; }
      // the yeti waves both arms (bigger, faster when a kart is close), head bobs and turns to watch
      if (yeti.root){
        let near = 1e9; const G = ctx.getPlayers ? ctx.getPlayers() : null;
        if (G) for (const id in G){ const p = G[id]; if (p && p.pos) near = Math.min(near, Math.hypot(p.pos.x - yeti.pos.x, p.pos.z - yeti.pos.z)); }
        else if (camera) near = Math.hypot(camera.position.x - yeti.pos.x, camera.position.z - yeti.pos.z);
        const k = 1 - sstep(25, 70, near); yeti.wave += ((k > 0.05 ? 1 : 0.2) - yeti.wave) * Math.min(1, dt * 3);
        const w = yeti.wave;
        yeti.armR.rotation.z = lerp(0.2, 2.5, w) + Math.sin(t * (4 + 3 * w)) * 0.45 * w;
        yeti.armL.rotation.z = -lerp(0.2, 1.1, w) - Math.sin(t * 3 + 1) * 0.25 * w;
        yeti.head.rotation.z = Math.sin(t * 2.2) * 0.08 * (0.5 + w); yeti.head.position.y = 8.4 + Math.abs(Math.sin(t * 2.2)) * 0.25;
        yeti.root.scale.y = 1 + Math.sin(t * 4.4) * 0.015;
      }
    }
    const art = { root, registry, stats: ART_STATS, update, crowd, lift, penguins, bunnies, birds, smoke, yeti, signMeshes, dome, cloudRoot, hw, roadD, ok, uniforms: U, kitMeshes, MOBILE,
      get clock(){ return clock; },
      dispose(){ scene.remove(root); root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); } };
    return art;
  }
})();
