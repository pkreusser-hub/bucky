// Farm Kart — STORYBOOK TOON items, item VFX and item HUD icons (window.FK_ITEMS).
// Needs: three.js r128 (global THREE) and assets/farmkart-toon.js (FK_TOON: toon ramp + ink outlines).
// Everything here is render-only: no physics, no item rules, no networking. farmkart.html calls in through
// small hooks (model builders, per-frame syncs, edge-detected "born" effects, the particle pool, HUD icons).
// Rules of the look: MeshToon via FK_TOON.mat, warm-brown ink hull on every solid, saturated palette,
// chunky silhouettes, cartoon VFX (pop-in overshoot, shrink-out, star bursts, speed streaks, shockwave
// rings, splat decals) — never alpha-fade smoke. Pools are built once; nothing allocates per frame.
(function(){
  'use strict';
  const T = window.FK_TOON;
  const F = window.FK_ITEMS = window.FK_ITEMS || {};
  const INK = T.INK;
  const ctx = F.ctx = { scene:null, camera:null, sampleHeight:null };
  F.init = function(o){ Object.assign(ctx, o || {}); };

  // ---------------------------------------------------------------- small helpers
  const V = THREE.Vector3, M4 = THREE.Matrix4, Qn = THREE.Quaternion, Eu = THREE.Euler;
  const _m = new M4(), _q = new Qn(), _e = new Eu(), _p = new V(), _s = new V();
  const _cr = new V(), _cu = new V(), _cq = new Qn();
  const clamp = (x,a,b)=>x<a?a:(x>b?b:x);
  function easeOutBack(t){ t = clamp(t,0,1); const c1 = 1.70158, c3 = c1+1; return 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2); }
  F.easeOutBack = easeOutBack;

  // cached toon materials (one per colour/option set) — shared by every mesh that wants that look
  const _mats = {};
  function mat(color, extra){
    const key = color + (extra ? JSON.stringify(extra, (k,v)=> (v && v.isTexture) ? v.uuid : v) : '');
    return _mats[key] || (_mats[key] = T.mat(color, extra));
  }
  const vcMat = (extra)=> mat(0xffffff, Object.assign({ vertexColors:true }, extra || {}));
  function ink(mesh, t){ return T.outline(mesh, t == null ? 0.03 : t); }

  // cached primitives
  const _geo = {};
  // sphere LOD: tiny parts (comb, eyes, feet) get a 6x4 sphere; everything else the asked-for (default 10x7) — triangle budget matters, every solid is drawn twice (ink hull)
  const sph = (r,ws,hs)=>{ ws = ws || 10; hs = hs || 7; if (r < 0.16){ ws = Math.min(ws, 6); hs = Math.min(hs, 4); }
    const k = 's'+r+'_'+ws+'_'+hs; return _geo[k] || (_geo[k] = new THREE.SphereGeometry(r, ws, hs)); };
  const cone = (r,h,s)=> _geo['c'+r+'_'+h+'_'+s] || (_geo['c'+r+'_'+h+'_'+s] = new THREE.ConeGeometry(r, h, s||8));
  const cyl = (rt,rb,h,s)=> _geo['y'+rt+'_'+rb+'_'+h+'_'+s] || (_geo['y'+rt+'_'+rb+'_'+h+'_'+s] = new THREE.CylinderGeometry(rt, rb, h, s||8));

  // Merge a list of {g, p:[x,y,z], r:[x,y,z], s:[x,y,z], c: hex | fn(cx,cy,cz,nx,ny,nz)->hex} into ONE
  // non-indexed BufferGeometry with per-triangle vertex colours (flat colour bands = toon-friendly) and
  // smooth per-vertex normals preserved (the ink hull pushes along them).
  const _col = new THREE.Color(), _nm = new THREE.Matrix3(), _vt = new V(), _nt = new V();
  function merge(list){
    let tot = 0; const gs = list.map(it=>{ const g = it.g.index ? it.g.toNonIndexed() : it.g; tot += g.attributes.position.count; return g; });
    const pos = new Float32Array(tot*3), nor = new Float32Array(tot*3), col = new Float32Array(tot*3);
    let o = 0;
    list.forEach((it, k)=>{
      const g = gs[k], pa = g.attributes.position, na = g.attributes.normal, n = pa.count;
      _m.compose(_p.set.apply(_p, it.p || [0,0,0]), _q.setFromEuler(_e.set((it.r||[0,0,0])[0], (it.r||[0,0,0])[1], (it.r||[0,0,0])[2], it.o || 'XYZ')), _s.set.apply(_s, it.s || [1,1,1]));
      _nm.getNormalMatrix(_m);
      for (let i=0;i<n;i++){
        _vt.fromBufferAttribute(pa, i).applyMatrix4(_m); _nt.fromBufferAttribute(na, i).applyMatrix3(_nm).normalize();
        pos[(o+i)*3] = _vt.x; pos[(o+i)*3+1] = _vt.y; pos[(o+i)*3+2] = _vt.z;
        nor[(o+i)*3] = _nt.x; nor[(o+i)*3+1] = _nt.y; nor[(o+i)*3+2] = _nt.z;
      }
      for (let i=0;i<n;i+=3){
        const cx = (pos[(o+i)*3]+pos[(o+i+1)*3]+pos[(o+i+2)*3])/3, cy = (pos[(o+i)*3+1]+pos[(o+i+1)*3+1]+pos[(o+i+2)*3+1])/3, cz = (pos[(o+i)*3+2]+pos[(o+i+1)*3+2]+pos[(o+i+2)*3+2])/3;
        const nx = (nor[(o+i)*3]+nor[(o+i+1)*3]+nor[(o+i+2)*3])/3, ny = (nor[(o+i)*3+1]+nor[(o+i+1)*3+1]+nor[(o+i+2)*3+1])/3, nz = (nor[(o+i)*3+2]+nor[(o+i+1)*3+2]+nor[(o+i+2)*3+2])/3;
        _col.setHex(typeof it.c === 'function' ? it.c(cx,cy,cz,nx,ny,nz) : it.c);
        for (let j=0;j<3;j++){ col[(o+i+j)*3] = _col.r; col[(o+i+j)*3+1] = _col.g; col[(o+i+j)*3+2] = _col.b; }
      }
      o += n;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos,3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor,3));
    g.setAttribute('color', new THREE.BufferAttribute(col,3));
    return g;
  }
  const P = (g, c, p, r, s, o)=> ({ g, c, p, r, s, o });
  // one merged toon mesh + its ink hull
  function solid(geo, thick, extraMat){
    const m = new THREE.Mesh(geo, vcMat(extraMat)); ink(m, thick); return m;
  }

  // ---------------------------------------------------------------- canvas art
  function canvas(w,h){ const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(c){ const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.needsUpdate = true; return t; }
  const INKS = '#2b1a12';

  // ---------------------------------------------------------------- PARTICLE SHAPES (white fill, ink rim: tinted by colour)
  const _shapeTex = {};
  function shapeCanvas(kind){
    const S = 96, c = canvas(S,S), g = c.getContext('2d'); const cx = S/2, cy = S/2;
    g.lineJoin = 'round'; g.lineCap = 'round';
    if (kind === 'puff'){
      const cs = [[48,50,27],[28,56,17],[68,56,17],[38,34,16],[60,36,15]];
      g.fillStyle = INKS; for (const [x,y,r] of cs){ g.beginPath(); g.arc(x,y,r+5,0,6.2832); g.fill(); }
      g.fillStyle = '#fff'; for (const [x,y,r] of cs){ g.beginPath(); g.arc(x,y,r,0,6.2832); g.fill(); }
      // one flat shade crescent on the lower right (a single toon band, not a gradient)
      g.save(); g.beginPath(); for (const [x,y,r] of cs){ g.moveTo(x+r,y); g.arc(x,y,r,0,6.2832); } g.clip();
      g.fillStyle = '#c9d2dc'; g.beginPath(); g.arc(40,40,46,0,6.2832); g.arc(56,58,40,0,6.2832,true); g.fill('evenodd'); g.restore();
    } else if (kind === 'dot'){
      g.fillStyle = INKS; g.beginPath(); g.arc(cx,cy,34,0,6.2832); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(cx,cy,26,0,6.2832); g.fill();
      g.fillStyle = '#d6dde6'; g.beginPath(); g.arc(cx+6,cy+7,17,0,6.2832); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(cx-8,cy-9,8,0,6.2832); g.fill();
    } else if (kind === 'star'){
      const pts = []; for (let i=0;i<10;i++){ const a = -Math.PI/2 + i*Math.PI/5, r = i%2 ? 20 : 44; pts.push([cx+Math.cos(a)*r, cy+Math.sin(a)*r+2]); }
      g.beginPath(); pts.forEach((p,i)=> i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1])); g.closePath();
      g.lineWidth = 14; g.strokeStyle = INKS; g.stroke(); g.fillStyle = '#fff'; g.fill();
      g.fillStyle = '#d8dee6'; g.beginPath(); g.moveTo(cx,cy+2); g.lineTo(pts[3][0],pts[3][1]); g.lineTo(pts[4][0],pts[4][1]); g.lineTo(pts[5][0],pts[5][1]); g.closePath(); g.fill();
    } else if (kind === 'spark'){
      // long 4-point streak, long axis along x (stretched by the pool along the velocity)
      g.beginPath(); g.moveTo(4,cy); g.lineTo(cx-8,cy-13); g.lineTo(cx+8,cy-13); g.lineTo(S-4,cy); g.lineTo(cx+8,cy+13); g.lineTo(cx-8,cy+13); g.closePath();
      g.lineWidth = 12; g.strokeStyle = INKS; g.stroke(); g.fillStyle = '#fff'; g.fill();
    } else if (kind === 'ring'){
      g.lineWidth = 10; g.strokeStyle = INKS; g.beginPath(); g.arc(cx,cy,44,0,6.2832); g.stroke(); g.beginPath(); g.arc(cx,cy,26,0,6.2832); g.stroke();
      g.lineWidth = 12; g.strokeStyle = '#fff'; g.beginPath(); g.arc(cx,cy,35,0,6.2832); g.stroke();
    } else if (kind === 'leaf'){
      g.beginPath(); g.moveTo(cx,8); g.bezierCurveTo(cx+38,26,cx+30,70,cx,88); g.bezierCurveTo(cx-30,70,cx-38,26,cx,8); g.closePath();
      g.lineWidth = 12; g.strokeStyle = INKS; g.stroke(); g.fillStyle = '#fff'; g.fill();
      g.lineWidth = 5; g.strokeStyle = '#c4ccd6'; g.beginPath(); g.moveTo(cx,20); g.lineTo(cx,80); g.stroke();
    } else if (kind === 'chip'){
      const r = 10; g.beginPath(); g.moveTo(22+r,22); g.lineTo(74-r,22); g.quadraticCurveTo(74,22,74,22+r); g.lineTo(74,74-r); g.quadraticCurveTo(74,74,74-r,74);
      g.lineTo(22+r,74); g.quadraticCurveTo(22,74,22,74-r); g.lineTo(22,22+r); g.quadraticCurveTo(22,22,22+r,22); g.closePath();
      g.lineWidth = 12; g.strokeStyle = INKS; g.stroke(); g.fillStyle = '#fff'; g.fill();
    } else if (kind === 'splat'){
      // irregular blob + droplets, ink rim (ground decal)
      const blob = [[48,48,26],[30,40,15],[66,38,16],[36,64,14],[64,62,15],[48,24,12],[50,74,12]];
      g.fillStyle = INKS; for (const [x,y,r] of blob){ g.beginPath(); g.arc(x,y,r+4,0,6.2832); g.fill(); }
      for (const [x,y,r] of [[10,16,5],[86,24,5],[84,80,5],[12,82,5]]){ g.beginPath(); g.arc(x,y,r+3,0,6.2832); g.fill(); }
      g.fillStyle = '#fff'; for (const [x,y,r] of blob){ g.beginPath(); g.arc(x,y,r,0,6.2832); g.fill(); }
      for (const [x,y,r] of [[10,16,5],[86,24,5],[84,80,5],[12,82,5]]){ g.beginPath(); g.arc(x,y,r,0,6.2832); g.fill(); }
      g.fillStyle = '#d3dae3'; g.beginPath(); g.arc(54,54,12,0,6.2832); g.fill();
    } else if (kind === 'scorch'){
      g.fillStyle = INKS; g.beginPath(); g.arc(cx,cy,40,0,6.2832); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(cx,cy,24,0,6.2832); g.fill();
    }
    return c;
  }
  function shapeTex(kind){ return _shapeTex[kind] || (_shapeTex[kind] = tex(shapeCanvas(kind))); }
  F.SHAPES = ['puff','dot','star','spark','ring','leaf','chip'];

  // ---------------------------------------------------------------- POOLED TOON PARTICLES (ONE instanced draw call)
  // The whole pool renders as a single instanced quad mesh (shapes packed in one atlas, billboarded in the
  // vertex shader), so 200 live particles cost 1 draw call instead of 200. Each particle still has the record
  // the old pool had ({m, mat, live, ...}); `m` is a plain Object3D proxy (position/scale/visible) and
  // `mat.color` / `mat.opacity` are plain values, so harnesses that read them keep working. `mat.color` is
  // exactly the colour asked for (the drift-tier suites key off it).
  // Billboards pop in with overshoot, hold, then SHRINK out (shockwave rings hold longer, then pop away). Nothing alpha-blends.
  const ATLAS_COLS = 4, ATLAS_ROWS = 2, CELL = 96;
  let _atlas = null;
  function atlasTex(){
    if (_atlas) return _atlas;
    const c = canvas(ATLAS_COLS*CELL, ATLAS_ROWS*CELL), g = c.getContext('2d');
    F.SHAPES.forEach((k, i)=>{ g.drawImage(shapeCanvas(k), (i % ATLAS_COLS)*CELL, Math.floor(i / ATLAS_COLS)*CELL, CELL, CELL); });
    const t = new THREE.CanvasTexture(c); t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
    return (_atlas = t);
  }
  const P_VERT = 'attribute vec3 iPos; attribute vec2 iScale; attribute vec4 iMisc; attribute vec3 iCol;\n' +
    'uniform vec2 uAtlas; varying vec2 vUv; varying vec3 vCol; varying float vFade;\n' +
    'void main(){ float c = cos(iMisc.x), s = sin(iMisc.x); vec2 l = position.xy * iScale; l = vec2(c*l.x - s*l.y, s*l.x + c*l.y);\n' +
    '  vec3 rt = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);\n' +
    '  if (iMisc.w > 0.5){ rt = vec3(1.0,0.0,0.0); up = vec3(0.0,0.0,-1.0); }\n' +
    '  vec3 wp = iPos + rt*l.x + up*l.y; gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);\n' +
    '  vec2 cell = vec2(mod(iMisc.y, uAtlas.x), floor(iMisc.y / uAtlas.x)); vUv = (vec2(cell.x, uAtlas.y - 1.0 - cell.y) + uv) / uAtlas; vCol = iCol; vFade = iMisc.z; }';
  const P_FRAG = 'uniform sampler2D uMap; varying vec2 vUv; varying vec3 vCol; varying float vFade;\n' +
    'void main(){ vec4 t = texture2D(uMap, vUv); if (t.a < 0.3) discard;\n' +
    '  if (vFade > 0.0 && fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) < vFade) discard;\n' +
    '  gl_FragColor = vec4(t.rgb * vCol, 1.0); }';
  F.makeParticlePool = function(scene, getCamera, MAX){
    const base = new THREE.PlaneGeometry(1,1), geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index; geo.setAttribute('position', base.attributes.position); geo.setAttribute('uv', base.attributes.uv);
    const aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX*3), 3), aScale = new THREE.InstancedBufferAttribute(new Float32Array(MAX*2), 2),
          aMisc = new THREE.InstancedBufferAttribute(new Float32Array(MAX*4), 4), aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX*3), 3);
    for (const a of [aPos, aScale, aMisc, aCol]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', aPos); geo.setAttribute('iScale', aScale); geo.setAttribute('iMisc', aMisc); geo.setAttribute('iCol', aCol);
    geo.instanceCount = MAX;
    const material = new THREE.ShaderMaterial({ uniforms:{ uMap:{ value:atlasTex() }, uAtlas:{ value:new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) } }, vertexShader:P_VERT, fragmentShader:P_FRAG, side:THREE.DoubleSide, fog:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2 });
    const mesh = new THREE.Mesh(geo, material); mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.name = 'fkParticles';
    mesh.userData.noToon = true; mesh.userData.noOutline = true; scene.add(mesh);
    const particles = [];
    for (let i=0;i<MAX;i++){
      const m = new THREE.Object3D(); m.visible = false;      // proxy: position / scale / visible (not in the scene graph)
      particles.push({ m, mat:{ color:new THREE.Color(0xffffff), opacity:0 }, live:false, life:0, maxLife:1, vx:0, vy:0, vz:0, grav:0, drag:0, size:0.5, grow:0, spin:0, startOp:0.8,
                       shape:'puff', shapeIdx:0, stretch:1, thin:1, flat:false, fade:false, pop:true, rot:0 });
      aScale.array[i*2] = aScale.array[i*2+1] = 0;
    }
    let idx = 0;
    function spawn(x,y,z,o){
      const p = particles[idx]; idx = (idx + 1) % MAX;
      p.m.position.set(x,y,z); p.m.visible = true; p.live = true;
      const shape = o.shape || 'puff';
      if (p.shape !== shape){ p.shape = shape; p.shapeIdx = Math.max(0, F.SHAPES.indexOf(shape)); }
      p.mat.color.setHex(o.color != null ? o.color : 0xffffff);
      p.startOp = o.opacity != null ? o.opacity : 1; p.mat.opacity = p.startOp;
      p.life = 0; p.maxLife = o.life || 0.4;
      p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0; p.grav = o.grav || 0; p.drag = o.drag || 0;
      p.size = o.size || 0.5; p.grow = o.grow || 0; p.spin = o.spin || 0;
      p.stretch = o.stretch || (shape === 'spark' ? 2.6 : 1); p.thin = shape === 'spark' ? (o.thin || 0.42) : 1;
      p.flat = !!o.flat; p.fade = !!o.fade || shape === 'ring'; p.pop = o.pop !== false;
      p.rot = o.rot != null ? o.rot : Math.random()*6.283;
      p.m.scale.set(0.001, 0.001, 1);
      return p;
    }
    function update(dt){
      const cam = getCamera(); if (!cam) return;
      cam.updateMatrixWorld(); _cq.copy(cam.quaternion); _cr.set(1,0,0).applyQuaternion(_cq); _cu.set(0,1,0).applyQuaternion(_cq);
      const A = aPos.array, S = aScale.array, Mi = aMisc.array, C = aCol.array;
      for (let i=0;i<MAX;i++){
        const p = particles[i];
        if (p.live){
          p.life += dt;
          if (p.life >= p.maxLife){ p.live = false; p.m.visible = false; }
        }
        if (!p.live){ S[i*2] = S[i*2+1] = 0; continue; }
        const f = p.life / p.maxLife;
        p.vy -= p.grav * dt;
        if (p.drag){ const k = Math.exp(-p.drag*dt); p.vx *= k; p.vy *= k; p.vz *= k; }
        const pos = p.m.position; pos.x += p.vx*dt; pos.y += p.vy*dt; pos.z += p.vz*dt;
        const pin = p.pop ? easeOutBack(p.life / 0.09) : 1;                       // pop with overshoot
        const out = p.fade ? (f > 0.8 ? 1 - Math.pow((f-0.8)/0.2, 2) : 1) : (f > 0.6 ? 1 - Math.pow((f-0.6)/0.4, 2) : 1);   // shrink out (rings hold their size longer, then pop away: no alpha / dither fade)
        // camera-pass guard: a chase camera drives THROUGH its own kart's puffs; shrink anything within ~3.5u so it never fills the screen
        const cdx = pos.x - cam.position.x, cdy = pos.y - cam.position.y, cdz = pos.z - cam.position.z, cd2 = cdx*cdx + cdy*cdy + cdz*cdz;
        const near = cd2 < 12.25 ? Math.max(0.0, (Math.sqrt(cd2) - 0.8) / 2.7) : 1;
        const base = Math.max(0.02, p.size + p.grow*f) * pin * out * near;
        let sx = base, sy = base, rot = p.rot + (p.spin ? p.spin*p.life : 0);
        if (p.shape === 'spark' && !p.flat){
          rot = Math.atan2(p.vx*_cu.x + p.vy*_cu.y + p.vz*_cu.z, p.vx*_cr.x + p.vy*_cr.y + p.vz*_cr.z); sx = base*p.stretch; sy = base*p.thin;
        }
        p.m.scale.set(sx, sy, 1);
        A[i*3] = pos.x; A[i*3+1] = pos.y; A[i*3+2] = pos.z; S[i*2] = sx; S[i*2+1] = sy;
        Mi[i*4] = rot; Mi[i*4+1] = p.shapeIdx; Mi[i*4+2] = 0; Mi[i*4+3] = p.flat ? 1 : 0;
        C[i*3] = p.mat.color.r; C[i*3+1] = p.mat.color.g; C[i*3+2] = p.mat.color.b;
      }
      aPos.needsUpdate = aScale.needsUpdate = aMisc.needsUpdate = aCol.needsUpdate = true;
    }
    function activeCount(){ let n = 0; for (let i=0;i<particles.length;i++) if (particles[i].live) n++; return n; }
    return { particles, spawn, update, activeCount, cap:MAX, mesh };
  };

  // the pool farmkart.html created registers itself here so item effects can spawn through it
  F.pool = null;
  F.bindPool = function(pool){ F.pool = pool; };
  function sp(x,y,z,o){ return F.pool ? F.pool.spawn(x,y,z,o) : null; }
  F.spawn = sp;

  // ---- effect recipes (all pooled-particle bursts) ----
  const R = Math.random;
  function burst(x,y,z,o){
    const n = o.n || 8, cols = o.colors || [0xffffff];
    for (let i=0;i<n;i++){
      const a = (i/n)*6.2832 + R()*0.6, s = (o.speed || 5) * (0.55 + R()*0.7);
      sp(x,y,z, { shape:o.shape || 'star', color:cols[(R()*cols.length)|0], life:(o.life || 0.5)*(0.8+R()*0.4),
        vx:Math.cos(a)*s, vy:(o.up != null ? o.up : 3) * (0.5 + R()), vz:Math.sin(a)*s, grav:o.grav != null ? o.grav : 8, drag:o.drag || 0,
        size:(o.size || 0.4)*(0.8+R()*0.5), grow:o.grow || 0, spin:o.spin != null ? o.spin : (R()-0.5)*10, stretch:o.stretch });
    }
  }
  F.burst = burst;
  // flat ground shockwave ring (pooled particle, drawn flat on the road)
  function shockRing(x,y,z,color,maxSize,life){
    sp(x, y, z, { shape:'ring', flat:true, color:color, opacity:1, life:life || 0.45, size:0.5, grow:maxSize || 6, pop:false });
  }
  F.shockRing = shockRing;
  function groundY(x,z){ return ctx.sampleHeight ? ctx.sampleHeight(x,z) : 0; }

  // ---------------------------------------------------------------- GROUND DECALS (lettuce splat, scorch)
  const decals = [];
  (function(){
    const g = new THREE.PlaneGeometry(1,1); g.rotateX(-Math.PI/2);
    F._decalGeo = g;
  })();
  function ensureDecals(){
    if (decals.length || !ctx.scene) return;
    for (let i=0;i<10;i++){
      const mt = new THREE.MeshBasicMaterial({ color:0xffffff, map:shapeTex('splat'), transparent:true, alphaTest:0.3, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3 });
      const m = new THREE.Mesh(F._decalGeo, mt); m.visible = false; m.renderOrder = 2; m.frustumCulled = false;
      m.userData.noToon = true; m.userData.noOutline = true; ctx.scene.add(m);
      decals.push({ m, mt, live:false, t:0, life:1.6, size:1 });
    }
  }
  let _dIdx = 0;
  function decal(x,z,color,size,shape,life,yOff){
    ensureDecals(); if (!decals.length) return;
    const d = decals[_dIdx]; _dIdx = (_dIdx + 1) % decals.length;
    d.live = true; d.t = 0; d.life = life || 1.8; d.size = size;
    d.mt.map = shapeTex(shape || 'splat'); d.mt.color.setHex(color);
    d.m.position.set(x, groundY(x,z) + (yOff != null ? yOff : 0.07), z); d.m.rotation.y = R()*6.283; d.m.visible = true; d.m.scale.setScalar(0.01);
  }
  function updateDecals(dt){
    for (const d of decals){
      if (!d.live) continue;
      d.t += dt;
      if (d.t >= d.life){ d.live = false; d.m.visible = false; continue; }
      const f = d.t / d.life, pin = easeOutBack(d.t / 0.12), out = f > 0.7 ? 1 - Math.pow((f-0.7)/0.3, 2) : 1;
      d.m.scale.setScalar(Math.max(0.01, d.size * pin * out));
    }
  }

  // ---------------------------------------------------------------- MODELS
  // ---- rounded crate geometry (box with projected corners + smooth analytic normals) ----
  function roundedBox(w,h,d,r,seg){
    const g = new THREE.BoxGeometry(w,h,d,seg,seg,seg), pa = g.attributes.position, na = g.attributes.normal;
    const hx = w/2-r, hy = h/2-r, hz = d/2-r;
    // 5 segments per axis, re-spaced so 2 of them sit in each rounded edge (the flat middle needs only one)
    const warp = (v, half)=>{ const u = v/half, k = Math.round((u + 1) / 0.4), sgn = [-1,-1,-1,1,1,1][k], q = [0,0.5,1,1,0.5,0][k]; return sgn * (half - r*q); };
    for (let i=0;i<pa.count;i++){
      const x = warp(pa.getX(i), w/2), y = warp(pa.getY(i), h/2), z = warp(pa.getZ(i), d/2);
      const ix = clamp(x,-hx,hx), iy = clamp(y,-hy,hy), iz = clamp(z,-hz,hz);
      let dx = x-ix, dy = y-iy, dz = z-iz; const l = Math.hypot(dx,dy,dz) || 1;
      dx/=l; dy/=l; dz/=l;
      pa.setXYZ(i, ix+dx*r, iy+dy*r, iz+dz*r); na.setXYZ(i, dx, dy, dz);
    }
    return g;
  }
  let _crateGeo = null;
  const crateGeo = ()=> _crateGeo || (_crateGeo = roundedBox(1.35, 1.2, 1.35, 0.24, 5));

  function crateFaceTex(mimic){
    const S = 256, c = canvas(S,S), g = c.getContext('2d');
    g.lineJoin = 'round'; g.lineCap = 'round';
    const base = mimic ? '#ff4a35' : '#ffc61c', band = mimic ? '#8a2a68' : '#ff7a1a', badge = mimic ? '#4a1c58' : '#2f8cff';
    g.fillStyle = base; g.fillRect(0,0,S,S);
    // top + bottom bands (the glossy trim)
    g.fillStyle = band; g.fillRect(0,0,S,34); g.fillRect(0,S-34,S,34);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(0,6,S,8); g.fillRect(0,S-28,S,8);
    // panel seam ink rim (reads as crate edges)
    g.strokeStyle = INKS; g.lineWidth = 10; g.strokeRect(5,5,S-10,S-10);
    g.lineWidth = 6; g.beginPath(); g.moveTo(0,34); g.lineTo(S,34); g.moveTo(0,S-34); g.lineTo(S,S-34); g.stroke();
    // rivets
    g.fillStyle = mimic ? '#ffd9a0' : '#fff6c9';
    for (const [x,y] of [[22,22],[S-22,22],[22,S-22],[S-22,S-22]]){ g.beginPath(); g.arc(x,y,7,0,6.2832); g.fill(); g.lineWidth = 3; g.stroke(); }
    // badge + question mark
    const bx = S/2, by = mimic ? 112 : S/2, br = mimic ? 56 : 66;
    g.fillStyle = badge; g.beginPath(); g.arc(bx,by,br,0,6.2832); g.fill(); g.lineWidth = 9; g.strokeStyle = INKS; g.stroke();
    g.save(); g.translate(bx,by+4); if (mimic) g.rotate(-0.16);
    g.font = '900 ' + (mimic ? 84 : 104) + 'px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 12; g.strokeStyle = INKS; g.strokeText('?', 0, 0); g.fillStyle = mimic ? '#ffe45e' : '#fff'; g.fillText('?', 0, 0); g.restore();
    if (mimic){
      // the tell: angry eyes beside the badge + a toothy mouth seam
      for (const sx of [-1,1]){
        const ex = S/2 + sx*92, ey = 60;
        g.fillStyle = '#fff'; g.beginPath(); g.ellipse(ex,ey,17,20,0,0,6.2832); g.fill(); g.lineWidth = 6; g.strokeStyle = INKS; g.stroke();
        g.fillStyle = INKS; g.beginPath(); g.arc(ex - sx*4, ey+4, 8, 0, 6.2832); g.fill();
        g.lineWidth = 9; g.beginPath(); g.moveTo(ex - sx*26, ey - 30 + (sx>0?0:14)); g.lineTo(ex + sx*20, ey - 30 + (sx>0?14:0)); g.stroke();
      }
      g.fillStyle = '#3a0f24'; g.fillRect(14,176,S-28,36); g.lineWidth = 7; g.strokeStyle = INKS; g.strokeRect(14,176,S-28,36);
      g.fillStyle = '#fff'; g.lineWidth = 4;
      for (let i=0;i<7;i++){ const x0 = 14 + i*((S-28)/7), w = (S-28)/7;
        g.beginPath(); g.moveTo(x0,176); g.lineTo(x0+w,176); g.lineTo(x0+w/2,176+20); g.closePath(); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(x0+w/2,212); g.lineTo(x0+w*1.5 > S-14 ? S-14 : x0+w*1.5,212); g.lineTo(x0+w,212-18); g.closePath(); g.fill(); g.stroke(); }
    }
    // glossy streak
    g.fillStyle = 'rgba(255,255,255,0.34)'; g.beginPath(); g.moveTo(34,70); g.lineTo(78,34); g.lineTo(98,34); g.lineTo(34,100); g.closePath(); g.fill();
    return c;
  }
  let _crateMat = null, _mimicMat = null;
  F.buildItemBox = function(){
    _crateMat = _crateMat || T.mat(0xffffff, { map:tex(crateFaceTex(false)), emissive:0x3a2a08 });
    const g = new THREE.Group(); g.name = 'fkItemBox';
    const body = new THREE.Mesh(crateGeo(), _crateMat); ink(body, 0.045); g.add(body);
    g.userData.isItemBox = true; g.userData.body = body;
    return g;
  };
  F.buildMimicBox = function(){
    _mimicMat = _mimicMat || T.mat(0xffffff, { map:tex(crateFaceTex(true)), emissive:0x3a0c08 });
    const g = new THREE.Group(); g.name = 'fkMimic';
    const body = new THREE.Mesh(crateGeo(), _mimicMat); ink(body, 0.045); g.add(body);
    g.userData.isMimic = true; g.userData.body = body;
    return g;
  };

  // ---- lettuce head ----
  let _lettuceGeo = null;
  function lettuceGeo(){
    if (_lettuceGeo) return _lettuceGeo;
    const L = [];
    L.push(P(sph(0.34,12,9), 0xe9f58a, [0,0,0]));
    // leaves in rings, bottom ring spread flat and dark, top ring upright and pale (toon colour bands)
    const rings = [ // [count, y, radius, lean (0 flat .. 1.57 upright), leaf size, colours]
      [7, -0.16, 0.30, 0.25, 0.34, [0x2f9a34, 0x3fae3a]],
      [6, -0.02, 0.24, 0.7, 0.32, [0x4dc13f, 0x5fd048]],
      [5, 0.12, 0.16, 1.05, 0.29, [0x7fdc4d, 0x8fe65a]],
      [3, 0.22, 0.06, 1.35, 0.22, [0xc2ee70, 0xd2f58a]],
    ];
    rings.forEach((rg, ri)=>{
      for (let i=0;i<rg[0];i++){
        const a = (i/rg[0])*6.2832 + ri*0.5;
        L.push(P(sph(1,6,4), rg[5][i%2], [Math.cos(a)*rg[2], rg[1], Math.sin(a)*rg[2]], [-rg[3], Math.PI/2 - a, 0], [rg[4]*0.9, rg[4]*0.38, rg[4]*1.1], 'YXZ'));
      }
    });
    _lettuceGeo = merge(L);
    return _lettuceGeo;
  }
  F.buildLettuce = function(){
    const g = new THREE.Group(); g.name = 'fkLettuce';
    const m = new THREE.Mesh(lettuceGeo(), vcMat({ emissive:0x10300a })); ink(m, 0.035); g.add(m);
    g.userData.fx = 'lettuce'; g.userData.body = m;
    return g;
  };

  // ---- chicken ----
  let _chickenGeo = null, _wingGeo = null;
  function chickenGeo(){
    if (_chickenGeo) return _chickenGeo;
    const W = 0xfffaf0, CR = 0xe8392c, OR = 0xffa31a, L = [];
    L.push(P(sph(0.42,10,7), W, [0,0.52,0], null, [1.0,0.92,1.18]));                 // body
    L.push(P(sph(0.26,10,8), 0xf6e8c6, [0,0.86,-0.5], null, [0.7,1.1,0.8]));           // tail puff
    L.push(P(sph(0.2,8,6), 0xf6e8c6, [0.14,0.78,-0.56], [0,0,-0.5], [0.5,1.2,0.7]));
    L.push(P(sph(0.2,8,6), 0xf6e8c6, [-0.14,0.78,-0.56], [0,0,0.5], [0.5,1.2,0.7]));
    L.push(P(sph(0.3,8,6), W, [0,1.0,0.42]));                                          // head
    for (let i=0;i<3;i++) L.push(P(sph(0.1,8,6), CR, [0,1.28 - Math.abs(i-1)*0.04, 0.3 + i*0.1], null, [0.75,1.2,0.8])); // comb
    L.push(P(sph(0.075,8,6), CR, [0,0.76,0.66], null, [0.7,1.2,0.7]));                  // wattle
    L.push(P(cone(0.1,0.24,6), OR, [0,0.97,0.74], [Math.PI/2,0,0]));                    // beak
    for (const sx of [-1,1]){
      L.push(P(sph(0.085,8,6), 0xffffff, [sx*0.16,1.06,0.62]));                          // eye white
      L.push(P(sph(0.052,8,6), 0x1a1210, [sx*0.17,1.06,0.69]));                           // pupil
      L.push(P(sph(0.06,6,5), 0xff9a9a, [sx*0.24,0.93,0.6]));                             // cheek
      L.push(P(cyl(0.04,0.045,0.3,6), OR, [sx*0.15,0.15,0.04]));                          // leg
      L.push(P(sph(0.1,8,6), OR, [sx*0.15,0.04,0.1], null, [1.0,0.4,1.5]));               // foot
    }
    _chickenGeo = merge(L);
    return _chickenGeo;
  }
  function wingGeo(){
    if (_wingGeo) return _wingGeo;
    _wingGeo = merge([ P(sph(0.3,10,8), 0xffe9b0, [0,-0.16,0], null, [0.28,0.62,0.9]), P(sph(0.16,8,6), 0xf2a63a, [0,-0.3,-0.3], null, [0.24,0.8,0.9]) ]);
    return _wingGeo;
  }
  F.buildChicken = function(){
    const g = new THREE.Group(); g.name = 'fkChicken';
    const body = new THREE.Mesh(chickenGeo(), vcMat({ emissive:0x30281a })); ink(body, 0.03);
    // everything hangs off `inner`, lowered so the group origin is the bird's centre (projectiles are placed by centre)
    const inner = new THREE.Group(); inner.position.y = -0.66; g.add(inner);
    const pivot = new THREE.Group(); pivot.add(body); inner.add(pivot);
    const wings = [];
    for (const sx of [-1,1]){
      const wp = new THREE.Group(); wp.position.set(sx*0.42, 0.78, 0.0);
      const w = new THREE.Mesh(wingGeo(), vcMat({ emissive:0x30281a })); ink(w, 0.03); w.scale.x = sx; wp.add(w); inner.add(wp); wings.push(wp);
    }
    g.userData.fx = 'chicken'; g.userData.wings = wings; g.userData.pivot = pivot;
    g.scale.setScalar(0.95);
    return g;
  };

  // ---- hay bale ----
  let _hayGeo = null;
  function hayGeo(){
    if (_hayGeo) return _hayGeo;
    const Rr = 0.62, H = 0.5, c = 0.15, pts = [];
    // profile runs bottom -> top so the lathe's faces point outward (top -> bottom flips them inside out)
    pts.push(new THREE.Vector2(0.0001, -H));
    for (let i=0;i<=5;i++){ const a = (i/5)*Math.PI/2; pts.push(new THREE.Vector2(Rr - c + Math.sin(a)*c, -H + c - Math.cos(a)*c)); }
    for (let i=0;i<=5;i++){ const a = (i/5)*Math.PI/2; pts.push(new THREE.Vector2(Rr - c + Math.cos(a)*c, H - c + Math.sin(a)*c)); }
    pts.push(new THREE.Vector2(0.0001, H));
    const lathe = new THREE.LatheGeometry(pts, 12);
    const L = [];
    L.push(P(lathe, (cx,cy,cz,nx,ny,nz)=>{
      if (Math.abs(ny) > 0.7){ const r = Math.hypot(cx,cz); return (r < 0.1 || (r > 0.26 && r < 0.34) || (r > 0.46 && r < 0.52)) ? 0xd29a28 : 0xf7d878; }
      const a = Math.atan2(cz,cx); return (Math.floor((a + 7) * 3.2) % 2) ? 0xedc247 : 0xf5d160;
    }));
    for (const y of [-0.2, 0.2]) L.push(P(new THREE.TorusGeometry(Rr + 0.005, 0.05, 5, 14), 0xd9402c, [0,y,0], [Math.PI/2,0,0]));
    const rnd = T.rng(7);
    for (let i=0;i<7;i++){ const a = rnd()*6.28, y = (rnd()-0.5)*0.7;   // straw tufts poking out
      L.push(P(cone(0.05,0.22,5), 0xf7d878, [Math.cos(a)*(Rr+0.05), y, Math.sin(a)*(Rr+0.05)], [Math.sin(a)*1.1, 0, -Math.cos(a)*1.1 ], null)); }
    _hayGeo = merge(L); _hayGeo.rotateZ(Math.PI/2);   // lie on its side (axis along x)
    return _hayGeo;
  }
  F.buildHay = function(){
    const g = new THREE.Group(); g.name = 'fkHay';
    const m = new THREE.Mesh(hayGeo(), vcMat({ emissive:0x2a2008 })); ink(m, 0.035); g.add(m);
    g.userData.fx = 'hay'; g.userData.body = m;
    return g;
  };

  // ---- golden egg ----
  let _eggGeo = null;
  function eggGeo(){
    if (_eggGeo) return _eggGeo;
    const pts = [], ys = [];
    for (let i=0;i<=16;i++){ const t = (i/16)*Math.PI; const r = Math.sin(t) * (0.5 - 0.12*Math.cos(t)); ys.push(-Math.cos(t) * 0.66); pts.push(new THREE.Vector2(Math.max(0.0001, r), ys[i])); }
    const lathe = new THREE.LatheGeometry(pts, 12);
    // colour by lathe ROW (a triangle's centroid always sits inside its row), so the bands have clean ring edges
    const rowOf = (cy)=>{ let r = 0; for (let i=0;i<16;i++) if (cy >= ys[i]) r = i; return r; };
    _eggGeo = merge([ P(lathe, (cx,cy)=>{
      const r = rowOf(cy);
      if (r === 8 || r === 9) return 0xff8a1a;     // orange band
      if (r === 10) return 0xfff0a0;                // pale pin-stripe
      if (r === 6) return 0xff8a1a;
      return r >= 11 ? 0xffd23a : 0xf5b400;         // lit cap vs body
    }), P(sph(0.07,6,5), 0xffffff, [-0.22,0.32,0.3], null, [1,1.6,0.6]) ]);
    return _eggGeo;
  }
  F.buildEgg = function(){
    const g = new THREE.Group(); g.name = 'fkEgg';
    const m = new THREE.Mesh(eggGeo(), vcMat({ emissive:0x4a3000 })); ink(m, 0.035); g.add(m);
    // a pop-star "shine" that twinkles on the shell
    g.userData.fx = 'egg'; g.userData.body = m;
    g.scale.setScalar(1.15);
    return g;
  };

  // ---- tank-battle shell (nose points +z) ----
  let _shellGeo = null;
  function shellGeo(){
    if (_shellGeo) return _shellGeo;
    const pts = [[0.0001,-0.34],[0.18,-0.34],[0.22,-0.2],[0.23,0],[0.23,0.1],[0.2,0.24],[0.14,0.34],[0.07,0.44],[0.0001,0.5]].map(a=>new THREE.Vector2(a[0],a[1]));
    const lathe = new THREE.LatheGeometry(pts, 12); lathe.rotateX(Math.PI/2);   // axis -> +z (nose forward)
    // colour thresholds sit exactly on profile rows (-0.2 / 0 / 0.1 / 0.24) so band edges are clean rings
    _shellGeo = merge([ P(lathe, (cx,cy,cz)=> cz > 0.24 ? 0xff5a2a : (cz > 0.1 ? 0x7a8490 : (cz > 0 ? 0xffb02e : (cz > -0.2 ? 0x7a8490 : 0x3a3f46)))) ]);
    return _shellGeo;
  }
  F.buildShell = function(){
    const g = new THREE.Group(); g.name = 'fkShell';
    const m = new THREE.Mesh(shellGeo(), vcMat({ emissive:0x3a1c08 })); ink(m, 0.04); g.add(m);
    g.userData.fx = 'shell'; g.userData.body = m;
    g.scale.setScalar(1.25);
    return g;
  };

  // projectile / orbit bit builders (kind aware)
  F.buildProj = function(kind){
    if (kind === 'shell') return F.buildShell();
    if (kind === 'egg') return F.buildEgg();
    if (kind === 'chicken' || kind === 'chicken3') return F.buildChicken();
    if (kind === 'hay') return F.buildHay();
    if (kind === 'mimic') return F.buildMimicBox();
    return F.buildLettuce();
  };
  F.buildOrbitBit = function(kind){
    const m = F.buildProj(kind);
    if (kind === 'mimic') m.scale.setScalar(0.5);
    else if (kind === 'hay') m.scale.setScalar(0.55);
    else m.scale.multiplyScalar(0.85);
    m.userData.orbitBase = m.scale.x;
    return m;
  };

  // ---------------------------------------------------------------- per-frame model sync
  // item boxes: spin + bob + pop-in on respawn + PICKUP BURST on collection + occasional twinkle
  F.syncBox = function(m, b, i, dt, now, baseY){
    const ud = m.userData;
    if (ud.wasActive == null) ud.wasActive = b.active;
    if (ud.wasActive && !b.active) F.boxPickupBurst(m.position.x, m.position.y, m.position.z);
    if (!ud.wasActive && b.active){ ud.popT = 0; F.burst(m.position.x, baseY, m.position.z, { n:5, shape:'star', colors:[0xfff2a0,0xffffff], speed:2.5, up:2, size:0.3, life:0.4, grav:2 }); }
    ud.wasActive = b.active;
    m.visible = b.active;
    if (!b.active) return;
    m.rotation.y += dt * 0.9; m.rotation.x = 0; m.rotation.z = 0;
    const bob = Math.sin(now * 1.35 + (ud.phase || i));
    m.position.y = baseY + bob * 0.22;
    // pop-in on respawn (easeOutBack overshoot) + a gentle breathing squash while idle
    let s = 1;
    if (ud.popT != null){ ud.popT += dt; s = easeOutBack(ud.popT / 0.42); if (ud.popT > 0.42) ud.popT = null; }
    const br = 1 + Math.cos(now * 2.7 + (ud.phase || i)) * 0.03;
    m.scale.set(s * (2 - br), s * br, s * (2 - br));
    // twinkle: a little star drifts off nearby crates now and then (only close to the camera)
    if (ctx.camera && Math.random() < dt * 0.9){
      const c = ctx.camera.position, dx = c.x - m.position.x, dz = c.z - m.position.z;
      if (dx*dx + dz*dz < 1600) sp(m.position.x + (R()-0.5)*1.3, m.position.y + 0.5 + R()*0.5, m.position.z + (R()-0.5)*1.3,
        { shape:'star', color:0xfff2a0, life:0.55, vy:0.8, size:0.3, spin:3, grav:0 });
    }
  };
  F.boxPickupBurst = function(x,y,z){
    burst(x,y,z, { n:9, shape:'star', colors:[0xffd21f,0xff7a1a,0x2f8cff,0xffffff], speed:6, up:5, size:0.5, life:0.6, grav:9 });
    burst(x,y,z, { n:5, shape:'chip', colors:[0xffc61c,0xff7a1a,0x2f8cff], speed:4, up:6, size:0.3, life:0.7, grav:14, spin:9 });
    for (let i=0;i<4;i++) sp(x+(R()-0.5)*0.8, y-0.1, z+(R()-0.5)*0.8, { shape:'puff', color:0xffffff, life:0.4, vy:1+R(), vx:(R()-0.5)*3, vz:(R()-0.5)*3, size:0.55, grow:0.5 });
    shockRing(x, groundY(x,z)+0.1, z, 0xffe45e, 5, 0.4);
  };

  // projectiles — called every frame per live projectile mesh
  const _born = new WeakSet();
  function bornProj(pr, m){
    const k = pr.kind;
    if (k === 'tomato' || k === 'tomato3'){
      burst(pr.x, pr.y, pr.z, { n:5, shape:'leaf', colors:[0x4dc13f,0x8fe65a], speed:3.2, up:2, size:0.32, life:0.4, grav:6 });
      for (let i=0;i<3;i++) sp(pr.x - (pr.vx||0)*0.03, pr.y-0.2, pr.z - (pr.vz||0)*0.03, { shape:'puff', color:0xffffff, life:0.3, size:0.4, grow:0.3, vx:(R()-0.5)*2, vy:0.6, vz:(R()-0.5)*2 });
    } else if (k === 'chicken'){
      burst(pr.x, pr.y, pr.z, { n:6, shape:'leaf', colors:[0xfffaf0,0xffe9b0,0xe8392c], speed:3.2, up:2.5, size:0.3, life:0.45, grav:4 });
      for (let i=0;i<3;i++) sp(pr.x, pr.y-0.2, pr.z, { shape:'puff', color:0xffffff, life:0.3, size:0.4, grow:0.3, vx:(R()-0.5)*2, vy:0.6, vz:(R()-0.5)*2 });
    } else if (k === 'egg'){
      burst(pr.x, pr.y, pr.z, { n:9, shape:'star', colors:[0xffe45e,0xfff6c0,0xffa31a], speed:5, up:3, size:0.5, life:0.55, grav:3 });
      shockRing(pr.x, pr.y, pr.z, 0xffe45e, 4, 0.4);
    } else if (k === 'shell'){
      burst(pr.x, pr.y, pr.z, { n:4, shape:'star', colors:[0xffd070,0xff7a2a], speed:4, up:1, size:0.35, life:0.25, grav:0 });
    }
  }
  const _tmpV = new V();
  F.syncProj = function(m, pr, i, dt, now){
    const k = pr.kind || 'tomato', ud = m.userData;
    if (!_born.has(pr)){ _born.add(pr); bornProj(pr, m); ud.sq = 0; }
    m.position.set(pr.x, pr.y, pr.z);
    const spd = Math.hypot(pr.vx || 0, pr.vz || 0);
    if (k === 'chicken'){
      m.rotation.y = Math.atan2(pr.vx, pr.vz);
      const t = now * 22 + i, flap = Math.sin(t);
      const w = m.userData.wings; if (w){ w[0].rotation.z = -0.35 - 0.95*(0.5+0.5*flap); w[1].rotation.z = 0.35 + 0.95*(0.5+0.5*flap); }
      m.position.y += 0.15 * Math.sin(t*0.55) + 0.1;
      m.rotation.z = Math.sin(t*0.5) * 0.12;
      const sq = 1 + 0.07*Math.sin(t); m.scale.set(0.95/sq, 0.95*sq, 0.95/sq);
      ud.featherAcc = (ud.featherAcc || 0) + dt;
      if (ud.featherAcc > 0.11){ ud.featherAcc = 0; sp(pr.x, pr.y+0.2, pr.z, { shape:'leaf', color:R()<0.5?0xfffaf0:0xffe9b0, life:0.38, vx:-(pr.vx||0)*0.05+(R()-0.5)*1.5, vy:1+R(), vz:-(pr.vz||0)*0.05+(R()-0.5)*1.5, grav:2, size:0.26, spin:7 }); }
    } else if (k === 'egg'){
      m.rotation.y += dt * 6; m.rotation.z = Math.sin(now*9 + i)*0.18;
      m.position.y += 0.35 + 0.12 * Math.sin(now*10 + i);
      const pulse = 1.15 + 0.06*Math.sin(now*14); m.scale.setScalar(pulse);
      ud.sparkAcc = (ud.sparkAcc || 0) + dt;
      if (ud.sparkAcc > 0.045){ ud.sparkAcc = 0; sp(pr.x+(R()-0.5)*0.6, pr.y+0.2+(R()-0.5)*0.5, pr.z+(R()-0.5)*0.6, { shape:R()<0.6?'star':'dot', color:R()<0.5?0xfff2a0:0xffc928, life:0.42, vx:(R()-0.5)*1.5, vy:0.6+R()*1.4, vz:(R()-0.5)*1.5, grav:2, size:0.3, spin:5 }); }
    } else if (k === 'shell'){
      if (spd > 0.01) m.rotation.y = Math.atan2(pr.vx, pr.vz);
      ud.smokeAcc = (ud.smokeAcc || 0) + dt;
      if (ud.smokeAcc > 0.05){ ud.smokeAcc = 0; sp(pr.x - (pr.vx||0)*0.02, pr.y, pr.z - (pr.vz||0)*0.02, { shape:'puff', color:0xb6bcc6, life:0.28, size:0.3, grow:-0.1, vy:0.3 }); }
    } else {   // lettuce: tumbling head, squash-and-stretch on ricochet, little leaf trail
      m.rotation.y += dt * 7; m.rotation.x = Math.sin(now*9 + i)*0.35; m.rotation.z = Math.cos(now*7 + i)*0.25;
      m.position.y += 0.05 + 0.08*Math.sin(now*12 + i);
      const bn = pr.bounces || 0;
      if (ud.lastB == null) ud.lastB = bn;
      if (bn !== ud.lastB){ ud.lastB = bn; ud.sq = 0.25; burst(pr.x, pr.y, pr.z, { n:5, shape:'star', colors:[0xffffff,0xc8f06a], speed:3.5, up:1.5, size:0.32, life:0.3, grav:0 }); }
      let sx = 1, sy = 1;
      if (ud.sq > 0){ ud.sq -= dt; const f = Math.sin(Math.max(0,ud.sq)/0.25*Math.PI); sx = 1 + 0.35*f; sy = 1 - 0.35*f; }
      m.scale.set(sx, sy, sx);
      ud.leafAcc = (ud.leafAcc || 0) + dt;
      if (ud.leafAcc > 0.08){ ud.leafAcc = 0; sp(pr.x, pr.y, pr.z, { shape:'leaf', color:R()<0.5?0x4dc13f:0x8fe65a, life:0.35, vx:(R()-0.5)*1.2, vy:0.8+R(), vz:(R()-0.5)*1.2, grav:4, size:0.22, spin:8 }); }
    }
  };

  // hazards (hay bale / mimic crate on the road)
  const _hzSeen = new WeakSet();
  F.syncHazard = function(m, hz, i, dt, now, want){
    const ud = m.userData;
    if (ud.hzRef !== hz){
      ud.hzRef = hz; ud.dropT = 0;
      if (!_hzSeen.has(hz)){
        _hzSeen.add(hz);
        if (want === 'mimic'){ burst(hz.x, hz.y, hz.z, { n:6, shape:'star', colors:[0xff4a35,0xffe45e,0xffffff], speed:3.5, up:3, size:0.4, life:0.45 }); }
        else { burst(hz.x, hz.y, hz.z, { n:5, shape:'leaf', colors:[0xf7d878,0xedc247], speed:3, up:2.5, size:0.3, life:0.4, grav:6 }); }
        for (let k=0;k<4;k++) sp(hz.x+(R()-0.5)*1.2, hz.y-0.2, hz.z+(R()-0.5)*1.2, { shape:'puff', color:0xe9dcb0, life:0.4, size:0.5, grow:0.5, vy:0.8, vx:(R()-0.5)*2, vz:(R()-0.5)*2 });
      }
      if (want === 'hay') m.rotation.y = (i * 1.7) % 3.14;
    }
    ud.dropT += dt;
    const s = ud.dropT < 0.4 ? easeOutBack(ud.dropT / 0.4) : 1;     // plop: overshoot scale
    if (want === 'mimic'){
      m.rotation.y += dt * 0.9;
      const br = 1 + Math.cos(now * 2.7 + i) * 0.04;
      m.scale.set(s * (2 - br), s * br, s * (2 - br));
    } else m.scale.setScalar(s);
  };

  // orbit bits (held triples) + trailed shield
  F.syncOrbitBit = function(m, kind, ang, dt, now){
    if (kind === 'chicken' || kind === 'chicken3'){
      const w = m.userData.wings, f = Math.sin(now*18 + ang*3);
      if (w){ w[0].rotation.z = -0.4 - 0.8*(0.5+0.5*f); w[1].rotation.z = 0.4 + 0.8*(0.5+0.5*f); }
      m.rotation.y = -ang + Math.PI;     // face along the orbit
    } else if (kind === 'hay'){ m.rotation.y += dt * 1.5; }
    else if (m.userData.fx === 'lettuce'){ m.rotation.y += dt*5; m.rotation.x = Math.sin(now*6 + ang)*0.3; }
  };
  let _shieldGeo = null;
  F.syncTrailShield = function(m, kind, now){
    let sh = m.userData.shield;
    if (!sh){
      _shieldGeo = _shieldGeo || new THREE.RingGeometry(0.78, 0.98, 20);
      sh = new THREE.Mesh(_shieldGeo, new THREE.MeshBasicMaterial({ color:0x6ecbff, transparent:true, opacity:0.9, side:THREE.DoubleSide, depthWrite:false, depthTest:false }));
      sh.userData.noToon = true; sh.userData.noOutline = true; sh.renderOrder = 4; m.add(sh); m.userData.shield = sh;
    }
    sh.visible = true;
    sh.quaternion.copy(ctx.camera ? _qInv(m) : sh.quaternion);
    const pul = 1 + 0.08 * Math.sin(now*7); sh.scale.setScalar(pul * 0.8);
  };
  const _qw = new Qn();
  function _qInv(m){ m.getWorldQuaternion(_qw); _qw.invert().multiply(ctx.camera.quaternion); return _qw; }

  // ---------------------------------------------------------------- impact FX (replaces spawnItemExplode)
  F.spawnExplode = function(x,y,z,kind){
    const gy = groundY(x,z);
    if (kind === 'chicken' || kind === 'chicken3'){
      burst(x,y,z, { n:10, shape:'leaf', colors:[0xfffaf0,0xffe9b0,0xe8392c,0xffa31a], speed:5.5, up:5, size:0.42, life:0.65, grav:5, spin:9 });
      for (let i=0;i<3;i++) sp(x+(R()-0.5)*0.6, y, z+(R()-0.5)*0.6, { shape:'puff', color:0xffffff, life:0.4, size:0.7, grow:0.8, vy:1, vx:(R()-0.5)*3, vz:(R()-0.5)*3 });
      burst(x,y+0.3,z, { n:5, shape:'star', colors:[0xffe45e,0xffffff], speed:4, up:5, size:0.45, life:0.45 });
    } else if (kind === 'hay'){
      burst(x,y,z, { n:12, shape:'spark', colors:[0xf7d878,0xedc247,0xd29a28], speed:6, up:5, size:0.34, life:0.5, grav:12, stretch:2.2 });
      for (let i=0;i<4;i++) sp(x+(R()-0.5), y, z+(R()-0.5), { shape:'puff', color:0xe9dcb0, life:0.45, size:0.8, grow:0.9, vy:1.2, vx:(R()-0.5)*4, vz:(R()-0.5)*4 });
      shockRing(x, gy+0.1, z, 0xf7d878, 4.5, 0.4);
    } else if (kind === 'mimic'){
      burst(x,y,z, { n:9, shape:'chip', colors:[0xff4a35,0x8a2a68,0xffe45e,0x4a1c58], speed:6, up:6, size:0.4, life:0.7, grav:14, spin:10 });
      burst(x,y+0.3,z, { n:6, shape:'star', colors:[0xffe45e,0xffffff,0xff4a35], speed:5, up:5, size:0.55, life:0.5 });
      for (let i=0;i<3;i++) sp(x+(R()-0.5), y, z+(R()-0.5), { shape:'puff', color:0xffffff, life:0.4, size:0.8, grow:0.8, vy:1, vx:(R()-0.5)*3, vz:(R()-0.5)*3 });
      shockRing(x, gy+0.1, z, 0xff4a35, 5, 0.4);
    } else if (kind === 'shell'){
      burst(x,y,z, { n:6, shape:'puff', colors:[0x6b7380,0x3f454e,0x9aa2ae], speed:4.5, up:3, size:0.9, life:0.6, grav:-1, grow:0.6 });
      burst(x,y+0.2,z, { n:9, shape:'star', colors:[0xffd070,0xff7a2a,0xffffff], speed:7, up:5, size:0.5, life:0.4, grav:6 });
      shockRing(x, gy+0.1, z, 0xffb02e, 6, 0.4);
      decal(x,z,0x5a4a3c, 1.6, 'scorch', 1.4);
    } else if (kind === 'egg'){
      burst(x,y,z, { n:14, shape:'star', colors:[0xffe45e,0xffc928,0xfff6c0,0xff8f1f], speed:9, up:6, size:0.7, life:0.7, grav:6 });
      burst(x,y,z, { n:8, shape:'chip', colors:[0xffe45e,0xffc928], speed:5, up:7, size:0.3, life:0.8, grav:12, spin:9 });
      sp(x,y+0.2,z, { shape:'puff', color:0xfff6c0, life:0.35, size:1.2, grow:2.2, pop:true });
      shockRing(x, gy+0.1, z, 0xffe45e, 9, 0.5);
      shockRing(x, gy+0.12, z, 0xff8f1f, 6, 0.4);
    } else {   // lettuce
      burst(x,y,z, { n:10, shape:'leaf', colors:[0x4dc13f,0x8fe65a,0x2f9a34,0xc2ee70], speed:6, up:5, size:0.45, life:0.6, grav:12, spin:9 });
      for (let i=0;i<3;i++) sp(x+(R()-0.5)*0.6, y, z+(R()-0.5)*0.6, { shape:'puff', color:0xd8f6a0, life:0.4, size:0.7, grow:0.7, vy:1, vx:(R()-0.5)*3, vz:(R()-0.5)*3 });
      shockRing(x, gy+0.1, z, 0xb6ee60, 4.5, 0.38);
      decal(x,z,0x5dcc3f, 2.4, 'splat', 1.8);
    }
  };

  // ---------------------------------------------------------------- BARN STORM (cloud + zig-zag bolt + impact ring)
  const rigs = [];
  const BOLT_N = 8;
  function boltGeometry(){
    const g = new THREE.BufferGeometry(), n = (BOLT_N+1)*2;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n*3), 3));
    const idx = []; for (let i=0;i<BOLT_N;i++){ const a = i*2; idx.push(a,a+1,a+2, a+1,a+3,a+2); }
    g.setIndex(idx); return g;
  }
  function fillBolt(g, xs, ys, widths, scale){
    const a = g.attributes.position.array;
    for (let i=0;i<=BOLT_N;i++){ const w = widths[i]*scale;
      a[i*6] = xs[i]-w; a[i*6+1] = ys[i]; a[i*6+2] = 0; a[i*6+3] = xs[i]+w; a[i*6+4] = ys[i]; a[i*6+5] = 0; }
    g.attributes.position.needsUpdate = true; g.computeBoundingSphere();
  }
  let _cloudGeo = null;
  function cloudGeo(){
    if (_cloudGeo) return _cloudGeo;
    const L = [], shade = (cx,cy,cz,nx,ny)=> ny > 0.45 ? 0x93a8ca : (ny < -0.2 ? 0x4a5873 : 0x6f82a6);
    for (const [x,y,z,r] of [[0,0,0,1.5],[-1.5,-0.25,0.1,1.1],[1.5,-0.25,0,1.15],[-0.7,0.65,0,1.0],[0.8,0.6,0,1.05],[0,-0.55,0.4,1.0]])
      L.push(P(sph(r,10,7), shade, [x,y,z]));
    // angry face on the +z side
    for (const sx of [-1,1]){
      L.push(P(sph(0.32,10,8), 0xffffff, [sx*0.62,0.15,1.3], null, [1,1.15,0.5]));
      L.push(P(sph(0.17,8,6), 0x1a1210, [sx*0.58,0.1,1.52], null, [1,1,0.5]));
      L.push(P(new THREE.BoxGeometry(0.75,0.16,0.2), 0x2b1a12, [sx*0.62,0.55,1.35], [0,0,-sx*0.45]));
    }
    L.push(P(new THREE.BoxGeometry(0.9,0.16,0.2), 0x2b1a12, [0,-0.4,1.4]));
    _cloudGeo = merge(L); return _cloudGeo;
  }
  function makeRig(){
    const g = new THREE.Group(); g.visible = false;
    const cloud = new THREE.Mesh(cloudGeo(), vcMat({ emissive:0x1a2236 })); ink(cloud, 0.06);
    const cloudHold = new THREE.Group(); cloudHold.add(cloud); g.add(cloudHold);
    const inkBolt = boltGeometry(), fillB = boltGeometry(), coreB = boltGeometry();
    const mk = (geo, color, ro)=>{ const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side:THREE.DoubleSide, depthWrite:false, fog:false })); m.renderOrder = ro; m.frustumCulled = false; m.userData.noToon = true; m.userData.noOutline = true; return m; };
    const boltHold = new THREE.Group(); boltHold.add(mk(inkBolt, INK, 6), mk(fillB, 0xfff04a, 7), mk(coreB, 0xffffff, 8)); g.add(boltHold);
    ctx.scene.add(g);
    return { g, cloudHold, boltHold, inkBolt, fillB, coreB, live:false, t:0, x:0, y:0, z:0, ringDone:false, gy:0, topY:0 };
  }
  F.spawnLightning = function(x,y,z){
    if (!ctx.scene) return;
    if (!rigs.length) for (let i=0;i<6;i++) rigs.push(makeRig());
    let r = rigs.find(q=>!q.live);
    if (!r){ r = rigs.reduce((a,b)=> a.t > b.t ? a : b); }
    r.live = true; r.t = 0; r.ringDone = false; r.x = x; r.y = y; r.z = z; r.g.visible = true; r.g.position.set(x, 0, z);
    r.topY = y + 11; r.cloudHold.position.y = r.topY;
    // fresh zig-zag every strike (fixed vertex count, written in place)
    const xs = [], ys = [], ws = [];
    for (let i=0;i<=BOLT_N;i++){ const f = i/BOLT_N; ys.push(r.topY - 1.0 - (r.topY - 1.0 - y)*f); xs.push(i === BOLT_N ? 0 : (i%2 ? 1 : -1) * (0.6 + R()*0.9) * (1 - f*0.5)); ws.push(0.55*(1 - f*0.8) + 0.12); }
    fillBolt(r.inkBolt, xs, ys, ws, 1.55); fillBolt(r.fillB, xs, ys, ws, 1.0); fillBolt(r.coreB, xs, ys, ws, 0.42);
    r.gy = groundY(x,z);
    // sky-side crackle at the cloud
    burst(x, r.topY, z, { n:6, shape:'star', colors:[0xfff04a,0xffffff], speed:3, up:0, size:0.5, life:0.35, grav:0 });
  };
  F.updateLightning = function(dt){
    for (const r of rigs){
      if (!r.live) continue;
      r.t += dt;
      const t = r.t, TOT = 0.75;
      if (t >= TOT){ r.live = false; r.g.visible = false; continue; }
      // cloud: pop in (0..0.15), wobble, shrink out (0.6..0.75)
      const pin = easeOutBack(t / 0.15), out = t > 0.6 ? 1 - Math.pow((t-0.6)/0.15, 2) : 1;
      const s = Math.max(0.01, pin * out);
      r.cloudHold.scale.set(s, s, s); r.cloudHold.rotation.z = Math.sin(t*38) * 0.05;
      if (ctx.camera) r.g.rotation.y = Math.atan2(ctx.camera.position.x - r.x, ctx.camera.position.z - r.z);   // face the camera
      // bolt: strobes on 0.12..0.45; widths jitter by flicker
      const bt = t - 0.12, show = bt > 0 && bt < 0.33 && (Math.floor(bt/0.045) % 3 !== 2);
      r.boltHold.visible = show;
      if (show){ const k = 1 + 0.12*Math.sin(t*90); r.boltHold.scale.set(k, 1, 1); }
      if (!r.ringDone && t >= 0.12){
        r.ringDone = true;
        F.boltImpact(r.x, r.gy, r.z);
      }
    }
  };
  F.boltImpact = function(x,gy,z){
    shockRing(x, gy+0.1, z, 0xfff04a, 8, 0.5);
    shockRing(x, gy+0.12, z, 0xffffff, 4.5, 0.35);
    burst(x, gy+0.5, z, { n:10, shape:'star', colors:[0xfff04a,0xffffff,0xffa31a], speed:8, up:6, size:0.65, life:0.55, grav:9 });
    burst(x, gy+0.4, z, { n:5, shape:'puff', colors:[0x6f82a6,0x4a5873], speed:3, up:2, size:0.9, life:0.5, grav:-1, grow:0.6 });
    decal(x, z, 0x5a4a3c, 1.8, 'scorch', 1.4);
  };
  F.liveBolts = function(){ return rigs.filter(r=>r.live); };
  F.boltsLive = function(){ let n = 0; for (const r of rigs) if (r.live) n++; return n; };

  // ---------------------------------------------------------------- per-frame housekeeping
  F.update = function(dt){ updateDecals(dt); F.updateLightning(dt); };
  F.stats = function(){
    let dl = 0; for (const d of decals) if (d.live) dl++;
    return { particles: F.pool ? F.pool.activeCount() : 0, cap: F.pool ? F.pool.cap : 0, decals: dl, bolts: F.boltsLive() };
  };

  // ---------------------------------------------------------------- KART FX (star / bull / boost) — one hook from syncKartView
  const RAINBOW = [0xff3b3b, 0xff9a1f, 0xffe83a, 0x3adf5a, 0x35a7ff, 0xb25cff];
  let _petalGeo = null, _hornGeo = null, _flameGeo = null, _flameCore = null;
  function petalGeo(){
    if (_petalGeo) return _petalGeo;
    const L = [], N = 10, Rr = 1.75;
    for (let i=0;i<N;i++){ const a = (i/N)*6.2832;
      L.push(P(sph(1,10,8), i%2 ? 0xffd21f : 0xffb000, [Math.cos(a)*Rr, 0, Math.sin(a)*Rr], [0, -a, 0], [0.62, 0.12, 0.26])); }
    _petalGeo = merge(L); return _petalGeo;
  }
  function hornGeo(){
    if (_hornGeo) return _hornGeo;
    const L = [], seg = 6;
    for (let i=0;i<seg;i++){
      const a0 = (i/seg)*1.9, a1 = ((i+1)/seg)*1.9, rad = 0.55;
      const x0 = (1 - Math.cos(a0))*rad, y0 = Math.sin(a0)*rad, x1 = (1 - Math.cos(a1))*rad, y1 = Math.sin(a1)*rad;
      const len = Math.hypot(x1-x0, y1-y0), r0 = 0.17*(1 - i/seg) + 0.03, r1 = 0.17*(1 - (i+1)/seg) + 0.03;
      L.push(P(cyl(r1, r0, len*1.05, 8), i > seg-3 ? 0xe9d79a : 0xfff4d6, [(x0+x1)/2, (y0+y1)/2, 0], [0,0, -Math.atan2(x1-x0, y1-y0)]));
    }
    _hornGeo = merge(L); return _hornGeo;
  }
  function flameGeos(){
    if (_flameGeo) return;
    _flameGeo = cone(0.14, 1.2, 8).clone(); _flameGeo.rotateX(-Math.PI/2); _flameGeo.translate(0,0,-0.6);    // base at origin, apex toward -z
    _flameCore = cone(0.07, 0.8, 6).clone(); _flameCore.rotateX(-Math.PI/2); _flameCore.translate(0,0,-0.4);
  }
  function makeKartFx(view){
    const fx = { flameK:0, starK:0, hornK:0, prev:{ boost:false, star:false, bull:false }, acc:{ star:0, bull:0, steam:0, boost:0, dust:0 }, rbT:0 };
    flameGeos();
    // TWO small teardrop flames, one per exhaust, lying along -forward (kart-local -z). Unlit orange with a yellow core
    // (a lit + emissive cone blew out to white; a single big cone read as a blue disc from the chase cam); ink hull on the outer.
    const flame = new THREE.Group(); flame.visible = false; fx.flames = [];
    for (const sx of [-1,1]){
      const fg = new THREE.Group(); fg.position.set(sx*0.3, 0.5, -1.1);
      const outer = new THREE.Mesh(_flameGeo, new THREE.MeshBasicMaterial({ color:0xff7a1a })); outer.userData.noToon = true; ink(outer, 0.04);
      const innerM = new THREE.Mesh(_flameCore, new THREE.MeshBasicMaterial({ color:0xffe45e })); innerM.userData.noToon = true;
      fg.add(outer, innerM); flame.add(fg); fx.flames.push({ g:fg, outer, inner:innerM });
    }
    view.group.add(flame); fx.flame = flame; fx.flameOuter = fx.flames[0].outer; fx.flameInner = fx.flames[0].inner;
    // world-space speed streaks: thin boxes lying along the travel direction, beside/behind the kart at body height
    const sGeo = new THREE.BoxGeometry(0.06, 0.06, 1);
    fx.streaks = [];
    for (let i=0;i<8;i++){
      const m = new THREE.Mesh(sGeo, new THREE.MeshBasicMaterial({ color:0xffffff })); m.visible = false; m.frustumCulled = false; m.userData.noToon = true; m.userData.noOutline = true;
      ctx.scene.add(m); fx.streaks.push({ m, t:0, life:0, len:1, vx:0, vz:0 });
    }
    const petals = new THREE.Mesh(petalGeo(), vcMat({ emissive:0x553300 })); ink(petals, 0.04); petals.position.y = 0.16; petals.visible = false;
    view.group.add(petals); fx.petals = petals;
    const horns = new THREE.Group(); horns.visible = false;
    for (const sx of [-1,1]){ const h = new THREE.Mesh(hornGeo(), vcMat({ emissive:0x40382a })); ink(h, 0.035); h.scale.set(sx*1.15, 1.15, 1.15); h.position.set(sx*0.52, 0.95, 0.72); h.rotation.y = 0; h.rotation.z = -sx*0.0; horns.add(h); }
    view.bounce.add(horns); fx.horns = horns;
    view._fx = fx; return fx;
  }
  const _f = new V(), _r = new V();
  F.syncKartFx = function(p, view, dt){
    const fx = view._fx || makeKartFx(view);
    const now = performance.now() * 0.001;
    const ghost = !!p._isGhost, racing = !ghost;
    const f = _f.set(Math.sin(p.theta), 0, Math.cos(p.theta)), r = _r.set(Math.cos(p.theta), 0, -Math.sin(p.theta));
    const y = (p.y != null ? p.y : 0), px = p.pos.x, pz = p.pos.z;
    const boosting = racing && p.boostT > 0, star = racing && p.starT > 0, bull = racing && p.bullT > 0;
    const gy = groundY(px, pz);

    // ---- BOOST: flame cone + speed streaks + start burst ----
    fx.flameK += ((boosting ? 1 : 0) - fx.flameK) * Math.min(1, dt * 20);
    fx.flame.visible = fx.flameK > 0.03;
    if (fx.flame.visible){
      const tier = clamp(p.boostTier || 0, 0, 3), fl = 1 + 0.18*Math.sin(now*70) + 0.1*Math.sin(now*43);
      const sc = fx.flameK * (0.75 + tier*0.18);
      fx.flames.forEach((q, i)=>{
        const fl2 = 1 + 0.2*Math.sin(now*60 + i*2) + 0.1*Math.sin(now*37 + i);          // flicker (length + width), out of phase per exhaust
        q.g.scale.set(sc*(0.9 + 0.1*fl2), sc*(0.9 + 0.1*fl2), sc*fl2*(0.45 + tier*0.1));
        q.inner.scale.set(1, 1, 1 + 0.25*Math.sin(now*55 + i));
        q.outer.material.color.setHex(0xff7a1a);
        q.inner.material.color.setHex(tier >= 2 ? 0x8fd8ff : 0xffe45e);                  // tier 2+: a blue-white hot core, the flame itself stays warm
      });
    }
    // streaks: spawn beside/behind the kart at body height, long axis = travel direction (horizontal), slide back + shrink
    const vsp = Math.hypot(p.v.x, p.v.z), hx = vsp > 1 ? p.v.x/vsp : f.x, hz = vsp > 1 ? p.v.z/vsp : f.z;
    if (boosting){
      fx.acc.boost += dt;
      while (fx.acc.boost > 0.05){
        fx.acc.boost -= 0.05;
        const q = fx.streaks.find(z=>z.t >= z.life);
        if (!q) break;
        const side = (R()<0.5?-1:1) * (1.0 + R()*1.2), hgt = 0.35 + R()*0.9, ahead = -0.4 - R()*0.8;
        q.t = 0; q.life = 0.26; q.len = 1.6 + R()*1.2; q.vx = -hx*7; q.vz = -hz*7;
        q.m.position.set(px + r.x*side + hx*ahead, y + hgt, pz + r.z*side + hz*ahead);
        q.m.rotation.set(0, Math.atan2(hx, hz), 0); q.m.material.color.setHex(R()<0.5 ? 0xffffff : 0xffe45e);
      }
    }
    for (const q of fx.streaks){
      if (q.t >= q.life){ q.m.visible = false; continue; }
      q.t += dt; if (q.t >= q.life){ q.m.visible = false; continue; }
      q.m.visible = true; q.m.position.x += q.vx*dt; q.m.position.z += q.vz*dt;
      q.m.scale.set(1, 1, Math.max(0.05, q.len * (1 - q.t/q.life)));
    }
    if (boosting && !fx.prev.boost){
      burst(px - f.x*1.3, y + 0.6, pz - f.z*1.3, { n:8, shape:'star', colors:[0xffe45e,0xff9a2e,0xffffff], speed:5, up:1.5, size:0.45, life:0.4, grav:0 });
      shockRing(px - f.x*1.2, gy + 0.12, pz - f.z*1.2, 0xffe45e, 4, 0.35);
    }
    fx.prev.boost = boosting;

    // ---- STAR (sunflower): petal ring + stepped rainbow flicker + sparkles ----
    fx.starK += ((star ? 1 : 0) - fx.starK) * Math.min(1, dt * 12);
    fx.petals.visible = fx.starK > 0.03;
    if (fx.petals.visible){
      const s = easeOutBack(fx.starK) * (1 + 0.05*Math.sin(now*9));
      fx.petals.scale.set(s, s, s); fx.petals.rotation.y = now * 2.2;
    }
    if (star){
      const col = RAINBOW[Math.floor(now * 11) % RAINBOW.length];
      view.bodyMat.emissive.setHex(col); view.bodyMat.emissive.multiplyScalar(0.5);   // stepped (toon) flicker, not a smooth hue wash
      fx.acc.star += dt;
      while (fx.acc.star > 0.06){
        fx.acc.star -= 0.06;
        const a = R()*6.2832, rad = 0.9 + R()*1.1;
        sp(px + Math.cos(a)*rad, y + 0.3 + R()*1.5, pz + Math.sin(a)*rad, { shape:R()<0.7?'star':'dot', color:RAINBOW[(R()*6)|0], life:0.5, vy:1.2 + R(), size:0.34, spin:4, grav:0 });
      }
    }
    if (star && !fx.prev.star){
      burst(px, y + 0.9, pz, { n:12, shape:'star', colors:RAINBOW, speed:7, up:3, size:0.6, life:0.7, grav:3 });
      shockRing(px, gy + 0.12, pz, 0xffd21f, 8, 0.5);
    }
    fx.prev.star = star;

    // ---- BULL: horns + steam from the nostrils + dust; shockwave on start ----
    fx.hornK += ((bull ? 1 : 0) - fx.hornK) * Math.min(1, dt * 10);
    fx.horns.visible = fx.hornK > 0.03;
    if (fx.horns.visible){ const s = Math.max(0.01, easeOutBack(fx.hornK)); fx.horns.scale.set(s, s, s); }
    if (bull){
      fx.acc.steam += dt; fx.acc.dust += dt;
      const sc = p.bullScale || 1;
      while (fx.acc.steam > 0.07){
        fx.acc.steam -= 0.07;
        for (const sx of [-1,1]) sp(px + f.x*1.6*sc + r.x*sx*0.35*sc, y + 1.0*sc, pz + f.z*1.6*sc + r.z*sx*0.35*sc,
          { shape:'puff', color:0xffffff, life:0.4, vx:p.v.x*0.85 + (R()-0.5), vy:1.2 + R(), vz:p.v.z*0.85 + (R()-0.5), size:0.4*sc, grow:-0.1, grav:-1 });   // rides along with the kart (does not hang in the camera's path)
      }
      while (fx.acc.dust > 0.05){
        fx.acc.dust -= 0.05;
        const side = R()<0.5 ? -1 : 1;
        sp(px - f.x*1.0*sc + r.x*side*0.9*sc, gy + 0.25, pz - f.z*1.0*sc + r.z*side*0.9*sc,
          { shape:'puff', color:0xd8c08a, life:0.5, vx:r.x*side*1.6 - f.x*2 + (R()-0.5), vy:0.8 + R()*0.6, vz:r.z*side*1.6 - f.z*2 + (R()-0.5), size:0.55*sc, grow:0.5, grav:1 });
      }
    }
    if (bull && !fx.prev.bull){
      shockRing(px, gy + 0.12, pz, 0xff5a2a, 9, 0.5);
      burst(px, gy + 0.4, pz, { n:10, shape:'puff', colors:[0xd8c08a,0xffffff], speed:6, up:2, size:0.75, life:0.55, grav:-1, grow:0.5 });
    }
    fx.prev.bull = bull;
  };

  // ================================================================ HUD ICONS (inline SVG, toon style)
  // 64x64 viewBox, warm-brown outline, flat colour + one highlight. No emoji anywhere. Every kind has one;
  // the triples are the single icon stacked + a count badge (built by heldHTML). Readable at 48px.
  const K = '#4a2c14', SW = 3.6;
  let _uid = 0;
  const svg = (inner)=> '<svg class="fkico" viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true" focusable="false">' +
    '<g stroke="' + K + '" stroke-width="' + SW + '" stroke-linejoin="round" stroke-linecap="round">' + inner + '</g></svg>';
  const HL = 'fill="#fff" fill-opacity=".62" stroke="none"';
  const ICONS = {
    // speed burst: fat bolt with speed lines
    boost: ()=> svg(
      '<path d="M7 24h12M4 33h14M9 42h10" fill="none" stroke="#ff9a2e" stroke-width="4"/>' +
      '<path d="M40 4 L18 36 H30 L24 60 L52 24 H38 Z" fill="#ffd426"/>' +
      '<path d="M39 11 L26 31 H33 Z" ' + HL + '/><path d="M38 24h8l-12 15z" fill="#ff9a2e" stroke="none"/>'),
    // lettuce head: scalloped ruffle silhouette (ink layer under a colour layer so no inner seams) + a pale leaf rosette
    tomato: ()=> { const ring = [[32,15,13],[48,25,13],[48,43,13],[32,51,14],[16,43,13],[16,25,13]];
      const lay = (r0, fill)=> ring.map(c=>'<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + (c[2] + r0) + '" fill="' + fill + '" stroke="none"/>').join('');
      return svg(lay(3, K) + '<circle cx="32" cy="34" r="24" fill="' + K + '" stroke="none"/>' + lay(0, '#47b63b') + '<circle cx="32" cy="34" r="21" fill="#47b63b" stroke="none"/>' +
        '<path d="M13 41c3 8 10 12 19 12s16-4 19-12c-5 5-11 7-19 7s-14-2-19-7z" fill="#2f9a34" stroke="none"/>' +
        '<ellipse cx="23" cy="32" rx="8.5" ry="13" transform="rotate(-24 23 32)" fill="#9fe65e"/><ellipse cx="41" cy="32" rx="8.5" ry="13" transform="rotate(24 41 32)" fill="#9fe65e"/>' +
        '<ellipse cx="32" cy="29" rx="9.5" ry="14" fill="#c4f27c"/>' +
        '<path d="M32 19v20M23 24l4 10M41 24l-4 10" fill="none" stroke="#4aa832" stroke-width="2.4"/>' +
        '<path d="M26 20c2-3 4-4 7-4" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="3"/>'); },
    // hay: a round bale seen end-on, ring lines, twine band, straw wisps poking out of the rim
    hay: ()=> { let w = ''; for (let i=0;i<14;i++){ const a = i/14*6.2832, x1 = 32 + Math.cos(a)*24, y1 = 33 + Math.sin(a)*24, x2 = 32 + Math.cos(a+0.1)*31, y2 = 33 + Math.sin(a+0.1)*31;
        w += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + 'L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '" stroke="#f0bf40" stroke-width="5" fill="none"/>'; }
      return svg(w + '<circle cx="32" cy="33" r="25" fill="#f6cf55"/>' +
        '<circle cx="32" cy="33" r="18" fill="none" stroke="#d9a02a" stroke-width="2.6"/><circle cx="32" cy="33" r="10.5" fill="none" stroke="#d9a02a" stroke-width="2.6"/><circle cx="32" cy="33" r="3" fill="#d9a02a" stroke="none"/>' +
        '<path d="M7 33h50" fill="none" stroke="' + K + '" stroke-width="8.5"/><path d="M7 33h50" fill="none" stroke="#e0772e" stroke-width="3.6"/>' +
        '<path d="M16 19c3-5 8-8 13-9" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="3.6"/>'); },
    // chicken (side view, facing right)
    chicken: ()=> svg(
      '<path d="M11 33l-7-12 12 5z" fill="#f6e8c6"/>' +
      '<path d="M26 54l-2 6M38 54l2 6M20 60h8M34 60h8" fill="none" stroke="#ff9a1a" stroke-width="3.4"/>' +
      '<ellipse cx="31" cy="39" rx="21" ry="16" fill="#fffaf0"/>' +
      '<circle cx="47" cy="22" r="11" fill="#fffaf0"/>' +
      '<circle cx="42" cy="11" r="4.5" fill="#e8392c"/><circle cx="48" cy="9" r="4.8" fill="#e8392c"/><circle cx="53" cy="12" r="4" fill="#e8392c"/>' +
      '<path d="M57 20l7 4-7 4z" fill="#ffa31a"/><circle cx="55" cy="32" r="3.6" fill="#e8392c"/>' +
      '<circle cx="50" cy="20" r="2.5" fill="' + K + '" stroke="none"/>' +
      '<path d="M18 38c2-7 12-9 18-3-1 8-8 12-15 9z" fill="#ffe9b0"/>' +
      '<path d="M22 28c3-3 6-4 10-4" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="3.4"/>'),
    // golden egg with bands and sparkles
    egg: ()=> { const id = 'fke' + (++_uid); const body = 'M32 5C45 5 53 27 53 40C53 52 44 60 32 60C20 60 11 52 11 40C11 27 19 5 32 5Z'; return svg(
      '<defs><clipPath id="' + id + '"><path d="' + body + '"/></clipPath></defs>' +
      '<path d="' + body + '" fill="#ffc928"/>' +
      '<g clip-path="url(#' + id + ')" stroke="none"><rect x="0" y="30" width="64" height="9" fill="#ff8f1f"/><rect x="0" y="41" width="64" height="3" fill="#fff3a0"/><path d="M32 5C20 5 15 28 14 38C20 30 24 14 40 8Z" fill="#fff6c0"/></g>' +
      '<path d="' + body + '" fill="none"/>' +
      '<path d="M54 6l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff" stroke-width="2.4"/><path d="M8 20l1.5 3.5 3.5 1.5-3.5 1.5L8 30l-1.5-3.5L3 25l3.5-1.5z" fill="#fff" stroke-width="2.2"/>'); },
    // sunflower
    star: ()=> { let p = ''; for (let i=0;i<12;i++){ p += '<ellipse cx="32" cy="12" rx="6.2" ry="11" fill="' + (i%2 ? '#ffd21f' : '#ffb000') + '" transform="rotate(' + (i*30) + ' 32 32)"/>'; }
      return svg(p + '<circle cx="32" cy="32" r="12.5" fill="#7a4a1a"/><circle cx="29" cy="28" r="3" fill="#b8742a" stroke="none"/><circle cx="36" cy="30" r="1.8" fill="#b8742a" stroke="none"/><circle cx="31" cy="37" r="1.8" fill="#b8742a" stroke="none"/><circle cx="37" cy="36" r="1.5" fill="#b8742a" stroke="none"/>'); },
    // bull head with horns
    bull: ()=> svg(
      '<path d="M16 22C4 24 2 12 4 6c4 8 10 8 17 8z" fill="#fff4d6"/><path d="M48 22c12 2 14-10 12-16-4 8-10 8-17 8z" fill="#fff4d6"/>' +
      '<path d="M14 24c0-8 8-12 18-12s18 4 18 12l-2 14c-1 8-8 14-16 14s-15-6-16-14z" fill="#b8652b"/>' +
      '<path d="M14 24c4 2 8 3 18 3s14-1 18-3c0-8-8-12-18-12S14 16 14 24z" fill="#8a4a1e" stroke="none"/>' +
      '<ellipse cx="32" cy="44" rx="13" ry="9.5" fill="#ffb3a0"/><ellipse cx="26.5" cy="44" rx="2.6" ry="3.4" fill="' + K + '" stroke="none"/><ellipse cx="37.5" cy="44" rx="2.6" ry="3.4" fill="' + K + '" stroke="none"/>' +
      '<path d="M20 26l8 4M44 26l-8 4" fill="none" stroke-width="4"/><circle cx="24" cy="32" r="2.6" fill="#fff" stroke-width="2"/><circle cx="40" cy="32" r="2.6" fill="#fff" stroke-width="2"/>'),
    // barn storm: angry cloud + bolt
    storm: ()=> svg(
      '<path d="M18 40C8 40 6 26 17 25C17 14 33 11 38 20C48 16 58 26 52 36C54 41 50 44 46 42H20z" fill="#8da6c8"/>' +
      '<path d="M12 36c4 5 10 6 20 6h14c5 1 7-3 6-6-12 5-28 5-40 0z" fill="#5f7399" stroke="none"/>' +
      '<path d="M36 38 L24 54 H33 L28 63 L46 44 H37 Z" fill="#ffe83a"/>' +
      '<path d="M16 20c3-5 9-6 14-5" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3.4"/>'),
    // mimic: the crate that bites
    mimic: ()=> svg(
      '<rect x="8" y="8" width="48" height="48" rx="10" fill="#ff4a35"/>' +
      '<rect x="8" y="8" width="48" height="9" rx="5" fill="#8a2a68" stroke="none"/><path d="M8 17h48" fill="none" stroke-width="2.6"/>' +
      '<ellipse cx="22" cy="29" rx="5.4" ry="6.4" fill="#fff" stroke-width="2.6"/><ellipse cx="42" cy="29" rx="5.4" ry="6.4" fill="#fff" stroke-width="2.6"/>' +
      '<circle cx="23.5" cy="30.5" r="2.6" fill="' + K + '" stroke="none"/><circle cx="40.5" cy="30.5" r="2.6" fill="' + K + '" stroke="none"/>' +
      '<path d="M15 22l12 4M49 22l-12 4" fill="none" stroke-width="3.6"/>' +
      '<rect x="12" y="40" width="40" height="12" rx="3" fill="#3a0f24" stroke-width="3"/>' +
      '<path d="M14 41l4 6 4-6 4 6 4-6 4 6 4-6 4 6 4-6" fill="#fff" stroke-width="2"/>'),
    // shield badge (trail state)
    shield: ()=> svg(
      '<path d="M32 5L54 13V32C54 46 44 56 32 60C20 56 10 46 10 32V13z" fill="#5bb8ff"/>' +
      '<path d="M32 5L54 13V32C54 46 44 56 32 60z" fill="#2f8cff" stroke="none"/>' +
      '<path d="M32 5L54 13V32C54 46 44 56 32 60C20 56 10 46 10 32V13z" fill="none"/>' +
      '<path d="M18 17l12-5v18c-8 0-12-5-12-13z" ' + HL + '/>'),
    // empty slot: a faint dashed crate outline
    empty: ()=> svg('<rect x="14" y="14" width="36" height="36" rx="9" fill="none" stroke="#4a2c14" stroke-opacity=".28" stroke-dasharray="5 6"/>'),
  };
  ICONS.tomato3 = ICONS.tomato; ICONS.chicken3 = ICONS.chicken;
  F.ICON_KINDS = ['boost','tomato','hay','chicken','tomato3','chicken3','egg','star','bull','storm','mimic'];
  F.icon = function(kind){ const f = ICONS[kind] || ICONS.empty; return f(); };

  // Slot-content builders. states: empty | rolling | held | trail
  const single = (kind)=> kind === 'tomato3' ? 'tomato' : (kind === 'chicken3' ? 'chicken' : kind);
  F.heldHTML = function(kind, count, isTriple){
    if (!kind) return F.icon('empty');
    if (isTriple && count > 0){
      const k = single(kind);
      return '<span class="stk"><i class="b2">' + F.icon(k) + '</i><i class="b1">' + F.icon(k) + '</i><i class="b0">' + F.icon(k) + '</i></span><b class="cnt">&times;' + count + '</b>';
    }
    return F.icon(kind);
  };
  // slot-machine reel: one strip of every icon, scrolled by CSS steps() — built once per roll
  F.rollHTML = function(){
    const ks = F.ICON_KINDS.filter(k=>k !== 'tomato3' && k !== 'chicken3');
    ks.push(ks[0]);   // seamless loop: the first icon repeats at the end
    return '<span class="reel"><span class="strip" style="--n:' + (ks.length - 1) + '">' + ks.map(k=>'<i>' + F.icon(k) + '</i>').join('') + '</span></span>';
  };
  F.trailHTML = function(trailKind, queuedHTML){
    return '<span class="shl"><i class="sh">' + F.icon('shield') + '</i><i class="tk">' + F.icon(single(trailKind)) + '</i></span>' + (queuedHTML ? '<span class="queued">' + queuedHTML + '</span>' : '');
  };
})();
