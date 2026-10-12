// Farm Kart art-style prototypes — shared rig, skinning, clips, IK, kart contract, track.
// Every style (fks-toon.js, fks-lowpoly.js, fks-clay.js) builds its own GEOMETRY and MATERIALS
// on top of the same skeleton, the same clip library and the same kart node contract, so any
// one of them can drop into farmkart.html without touching animation or physics code.
//
// Conventions (match farmkart.html): +Z forward, +Y up, +X = the racer's LEFT, ground at y=0.
// Racer space: origin on the seat surface. Kart space: origin on the ground under the axle midpoint.
(function(){
  'use strict';
  const FKS = window.FKS = window.FKS || {};
  FKS.styles = FKS.styles || {};
  const V3 = (x,y,z) => new THREE.Vector3(x,y,z);
  const DEG = Math.PI/180;

  // ---------------------------------------------------------------------------------------------
  // Seeded random + value noise (deterministic art: the same style always builds the same model)
  // ---------------------------------------------------------------------------------------------
  function rng(seed){ let s = (seed>>>0) || 1; return () => { s ^= s<<13; s>>>=0; s ^= s>>17; s ^= s<<5; s>>>=0; return s/4294967296; }; }
  function hash3(x,y,z){ let h = Math.sin(x*127.1 + y*311.7 + z*74.7)*43758.5453; return h - Math.floor(h); }
  function noise3(x,y,z){
    const xi=Math.floor(x), yi=Math.floor(y), zi=Math.floor(z);
    const xf=x-xi, yf=y-yi, zf=z-zi;
    const u=xf*xf*(3-2*xf), v=yf*yf*(3-2*yf), w=zf*zf*(3-2*zf);
    const L=(a,b,t)=>a+(b-a)*t;
    const c = (i,j,k)=>hash3(xi+i,yi+j,zi+k);
    return L(L(L(c(0,0,0),c(1,0,0),u),L(c(0,1,0),c(1,1,0),u),v), L(L(c(0,0,1),c(1,0,1),u),L(c(0,1,1),c(1,1,1),u),v), w)*2-1;
  }
  FKS.rng = rng; FKS.noise3 = noise3;

  // ---------------------------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------------------------
  const G = FKS.geo = {};
  // Rounded box: subdivided box whose verts are pushed onto an inner box + radius (smooth normals).
  G.roundedBox = function(w,h,d,r,seg){
    seg = seg || 4; r = Math.min(r, w/2-1e-3, h/2-1e-3, d/2-1e-3);
    const g = new THREE.BoxGeometry(w,h,d, seg*2,seg*2,seg*2);
    const p = g.attributes.position, n = g.attributes.normal;
    const hx=w/2-r, hy=h/2-r, hz=d/2-r, v=new THREE.Vector3(), c=new THREE.Vector3();
    for (let i=0;i<p.count;i++){
      v.fromBufferAttribute(p,i);
      c.set(Math.max(-hx,Math.min(hx,v.x)), Math.max(-hy,Math.min(hy,v.y)), Math.max(-hz,Math.min(hz,v.z)));
      v.sub(c); if (v.lengthSq()<1e-12) v.set(0,1,0); v.normalize();
      n.setXYZ(i, v.x,v.y,v.z);
      v.multiplyScalar(r).add(c); p.setXYZ(i, v.x,v.y,v.z);
    }
    return G.weld(g);
  };
  // Box seams duplicate verts per face; weld so smooth normals + inverted-hull outlines stay closed.
  G.weld = function(g){
    if (g.index) g = g.toNonIndexed();
    const p = g.attributes.position, map = new Map(), idx = [], keep = [];
    for (let i=0;i<p.count;i++){
      const k = Math.round(p.getX(i)*1e4)+'_'+Math.round(p.getY(i)*1e4)+'_'+Math.round(p.getZ(i)*1e4);
      let j = map.get(k); if (j === undefined){ j = keep.length; map.set(k,j); keep.push(i); }
      idx.push(j);
    }
    const out = new THREE.BufferGeometry();
    const pos = new Float32Array(keep.length*3);
    keep.forEach((i,j)=>{ pos[j*3]=p.getX(i); pos[j*3+1]=p.getY(i); pos[j*3+2]=p.getZ(i); });
    out.setAttribute('position', new THREE.BufferAttribute(pos,3));
    if (g.attributes.uv){ const uv=new Float32Array(keep.length*2); keep.forEach((i,j)=>{ uv[j*2]=g.attributes.uv.getX(i); uv[j*2+1]=g.attributes.uv.getY(i); }); out.setAttribute('uv', new THREE.BufferAttribute(uv,2)); }
    out.setIndex(idx); out.computeVertexNormals();
    return out;
  };
  // Ellipsoid
  G.blob = function(rx,ry,rz,ws,hs){ const g=new THREE.SphereGeometry(1, ws||24, hs||16); g.scale(rx,ry,rz); return g; };
  // Tapered capsule from p0 (radius r0) to p1 (radius r1), smooth, closed.
  G.capsule = function(p0,p1,r0,r1,radial,rings){
    radial = radial||16; rings = rings||6;
    const len = p0.distanceTo(p1), pts = [];
    const capN = Math.max(3, rings>>1);
    for (let i=0;i<=capN;i++){ const a=-Math.PI/2 + (i/capN)*(Math.PI/2); pts.push(new THREE.Vector2(Math.cos(a)*r0, Math.sin(a)*r0)); }
    for (let i=1;i<rings;i++){ const t=i/rings; pts.push(new THREE.Vector2(r0+(r1-r0)*t, len*t)); }
    for (let i=0;i<=capN;i++){ const a=(i/capN)*(Math.PI/2); pts.push(new THREE.Vector2(Math.cos(a)*r1, len+Math.sin(a)*r1)); }
    pts[0].x = 0; pts[pts.length-1].x = 0;
    const g = new THREE.LatheGeometry(pts, radial);
    G.alignY(g, p0, p1);
    return G.weld(g);
  };
  // Tube along a point list with a radius taper r0 -> r1 (horns, pipes, tails). Ends capped.
  G.taperTube = function(points, r0, r1, radial, seg){
    radial = radial||10; seg = seg||12;
    const curve = new THREE.CatmullRomCurve3(points);
    const fr = curve.computeFrenetFrames(seg, false);
    const pos = [], idx = [];
    for (let i=0;i<=seg;i++){
      const t = i/seg, p = curve.getPointAt(t), r = r0 + (r1-r0)*t, N = fr.normals[i], B = fr.binormals[i];
      for (let j=0;j<radial;j++){ const a = j/radial*Math.PI*2, c=Math.cos(a), s=Math.sin(a);
        pos.push(p.x + r*(c*N.x + s*B.x), p.y + r*(c*N.y + s*B.y), p.z + r*(c*N.z + s*B.z)); }
    }
    for (let i=0;i<seg;i++) for (let j=0;j<radial;j++){ const a=i*radial+j, b=i*radial+(j+1)%radial, c=a+radial, d=b+radial; idx.push(a,c,b, b,c,d); }
    const p0 = curve.getPointAt(0), p1 = curve.getPointAt(1), c0 = pos.length/3; pos.push(p0.x,p0.y,p0.z); const c1 = pos.length/3; pos.push(p1.x,p1.y,p1.z);
    for (let j=0;j<radial;j++){ idx.push(c0, j, (j+1)%radial); idx.push(c1, seg*radial+(j+1)%radial, seg*radial+j); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  // Tire: rounded-rectangle profile lathed around X (width w, radius r, corner c).
  G.tire = function(r, w, c, radial, hole){
    radial = radial||28; c = Math.min(c, w/2, r*0.4); hole = hole == null ? r*0.45 : hole;
    const pts = [];
    pts.push(new THREE.Vector2(hole, -w/2));
    for (let i=0;i<=5;i++){ const a = -Math.PI/2 + i/5*Math.PI/2; pts.push(new THREE.Vector2(r - c + Math.cos(a)*c, -w/2 + c + Math.sin(a)*c)); }
    for (let i=0;i<=5;i++){ const a = i/5*Math.PI/2; pts.push(new THREE.Vector2(r - c + Math.cos(a)*c, w/2 - c + Math.sin(a)*c)); }
    pts.push(new THREE.Vector2(hole, w/2));
    const g = new THREE.LatheGeometry(pts, radial);
    g.rotateZ(Math.PI/2); // lathe axis Y -> X
    return G.weld(g);
  };
  // Move a +Y-authored geometry so its origin sits at p0 and +Y points at p1.
  G.alignY = function(g,p0,p1){
    const dir = p1.clone().sub(p0); const len = dir.length(); if (len<1e-6) { g.translate(p0.x,p0.y,p0.z); return g; }
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0,1,0), dir.normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(p0, q, V3(1,1,1)));
    return g;
  };
  G.at = function(g,x,y,z,rx,ry,rz){
    const m = new THREE.Matrix4().compose(V3(x,y,z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx||0,ry||0,rz||0)), V3(1,1,1));
    g.applyMatrix4(m); return g;
  };
  // Displace verts along their normal by 3D value noise (clay lumps / organic wobble).
  G.lumpy = function(g, amp, freq, seed){
    seed = seed||0; const p=g.attributes.position; if(!g.attributes.normal) g.computeVertexNormals(); const n=g.attributes.normal;
    for (let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
      const d = noise3(x*freq+seed, y*freq+seed*1.7, z*freq-seed)*amp + noise3(x*freq*2.3, y*freq*2.3+seed, z*freq*2.3)*amp*0.4;
      p.setXYZ(i, x+n.getX(i)*d, y+n.getY(i)*d, z+n.getZ(i)*d);
    }
    g.computeVertexNormals(); return g;
  };
  // Random per-vertex jitter, then split into flat facets (low-poly look).
  G.facet = function(g, amp, seed){
    const r = rng(seed||7);
    if (amp){
      const wg = g.index ? g : G.weld(g); const p = wg.attributes.position;
      for (let i=0;i<p.count;i++) p.setXYZ(i, p.getX(i)+(r()-0.5)*amp, p.getY(i)+(r()-0.5)*amp, p.getZ(i)+(r()-0.5)*amp);
      g = wg;
    }
    g = g.index ? g.toNonIndexed() : g; g.computeVertexNormals(); return g;
  };
  // Concatenate geometries (non-indexed, position/normal/uv/color only).
  G.merge = function(list){
    const parts = list.map(g => g.index ? g.toNonIndexed() : g);
    let n = 0; parts.forEach(g => n += g.attributes.position.count);
    const pos=new Float32Array(n*3), nor=new Float32Array(n*3), uv=new Float32Array(n*2); let col=null;
    if (parts.some(g=>g.attributes.color)) col = new Float32Array(n*3).fill(1);
    let o=0;
    parts.forEach(g=>{
      if(!g.attributes.normal) g.computeVertexNormals();
      const c=g.attributes.position.count;
      pos.set(g.attributes.position.array, o*3); nor.set(g.attributes.normal.array, o*3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o*2);
      if (col && g.attributes.color) col.set(g.attributes.color.array, o*3);
      o+=c;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos,3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor,3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv,2));
    if (col) out.setAttribute('color', new THREE.BufferAttribute(col,3));
    return out;
  };
  G.paint = function(g, hex){ // flat vertex color
    const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n*3);
    for (let i=0;i<n;i++){ a[i*3]=c.r; a[i*3+1]=c.g; a[i*3+2]=c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a,3)); return g;
  };

  // ---------------------------------------------------------------------------------------------
  // Shared racer skeleton. Bind pose IS the seated driving pose, and every bind rotation is
  // identity, so a clip key is just an euler offset from rest. Positions are racer-space joints.
  // ---------------------------------------------------------------------------------------------
  const BONE_SPEC = [
    ['root',       null,         [0, 0.00, 0.00]],
    ['hips',       'root',       [0, 0.12,-0.04]],
    ['spine',      'hips',       [0, 0.27,-0.04]],
    ['chest',      'spine',      [0, 0.42,-0.02]],
    ['neck',       'chest',      [0, 0.58, 0.00]],
    ['head',       'neck',       [0, 0.68, 0.03]],
    ['ear_L',      'head',       [ 0.12, 0.80, 0.00]],
    ['ear_R',      'head',       [-0.12, 0.80, 0.00]],
    ['tail',       'hips',       [0, 0.14,-0.20]],
    ['upperArm_L', 'chest',      [ 0.17, 0.54,-0.01]],
    ['foreArm_L',  'upperArm_L', [ 0.22, 0.40, 0.15]],
    ['hand_L',     'foreArm_L',  [ 0.16, 0.42, 0.33]],
    ['upperArm_R', 'chest',      [-0.17, 0.54,-0.01]],
    ['foreArm_R',  'upperArm_R', [-0.22, 0.40, 0.15]],
    ['hand_R',     'foreArm_R',  [-0.16, 0.42, 0.33]],
    ['thigh_L',    'hips',       [ 0.09, 0.10, 0.02]],
    ['shin_L',     'thigh_L',    [ 0.11, 0.12, 0.30]],
    ['foot_L',     'shin_L',     [ 0.11,-0.16, 0.36]],
    ['thigh_R',    'hips',       [-0.09, 0.10, 0.02]],
    ['shin_R',     'thigh_R',    [-0.11, 0.12, 0.30]],
    ['foot_R',     'shin_R',     [-0.11,-0.16, 0.36]],
  ];
  FKS.BONE_SPEC = BONE_SPEC;
  FKS.joint = function(name){ const b = BONE_SPEC.find(s=>s[0]===name); return V3(b[2][0],b[2][1],b[2][2]); };

  FKS.makeSkeleton = function(){
    const bones = {}, list = [];
    for (const [name, parent, p] of BONE_SPEC){
      const b = new THREE.Bone(); b.name = name;
      const pp = parent ? BONE_SPEC.find(s=>s[0]===parent)[2] : [0,0,0];
      b.position.set(p[0]-pp[0], p[1]-pp[1], p[2]-pp[2]);
      if (parent) bones[parent].add(b);
      bones[name] = b; list.push(b);
    }
    bones.root.updateMatrixWorld(true);
    return { root: bones.root, bones, list, skeleton: new THREE.Skeleton(list) };
  };

  // Skin builder: add geometry authored in racer space, bound to bones by a weight function.
  FKS.skinBuilder = function(){
    const boneIndex = {}; BONE_SPEC.forEach((s,i)=> boneIndex[s[0]] = i);
    const groups = {}; // matKey -> [geom]
    function push(matKey, geom){ (groups[matKey] = groups[matKey] || []).push(geom); }
    function setWeights(geom, fn){
      geom = geom.index ? geom.toNonIndexed() : geom;
      const p = geom.attributes.position, n = p.count;
      const si = new Float32Array(n*4), sw = new Float32Array(n*4), v = new THREE.Vector3();
      for (let i=0;i<n;i++){
        v.fromBufferAttribute(p,i);
        const ws = fn(v).filter(w=>w[1]>1e-4).sort((a,b)=>b[1]-a[1]).slice(0,4);
        let tot = 0; ws.forEach(w=>tot+=w[1]);
        ws.forEach((w,k)=>{ si[i*4+k] = boneIndex[w[0]]; sw[i*4+k] = w[1]/tot; });
      }
      geom.setAttribute('skinIndex', new THREE.BufferAttribute(si,4));
      geom.setAttribute('skinWeight', new THREE.BufferAttribute(sw,4));
      return geom;
    }
    const api = {
      // rigid: every vertex follows one bone
      rigid(geom, matKey, bone){ push(matKey, setWeights(geom, ()=>[[bone,1]])); return api; },
      // limb: geometry spanning joint(bone) -> joint(child); verts blend into child near the far
      // end and into the parent near the near end, so elbows/knees/shoulders bend smoothly.
      limb(geom, matKey, bone, child, opts){
        opts = opts || {};
        const a = FKS.joint(bone), b = FKS.joint(child), ab = b.clone().sub(a), L2 = ab.lengthSq();
        const parent = BONE_SPEC.find(s=>s[0]===bone)[1];
        const soft = opts.soft == null ? 0.5 : opts.soft;
        push(matKey, setWeights(geom, (v)=>{
          const t = Math.max(0, Math.min(1.2, v.clone().sub(a).dot(ab)/L2));
          const wEnd = soft * smooth(0.65, 1.05, t);
          const wStart = opts.blendParent && parent ? soft * (1 - smooth(-0.05, 0.3, t)) : 0;
          const out = [[bone, 1 - wEnd - wStart]];
          if (wEnd>0) out.push([child, wEnd]);
          if (wStart>0) out.push([parent, wStart]);
          return out;
        }));
        return api;
      },
      // along: piecewise-linear blend between bones by height (torso: hips -> spine -> chest -> neck)
      along(geom, matKey, stops){
        push(matKey, setWeights(geom, (v)=>{
          const y = v.y;
          if (y <= stops[0][0]) return [[stops[0][1],1]];
          for (let i=0;i<stops.length-1;i++){
            const [y0,b0] = stops[i], [y1,b1] = stops[i+1];
            if (y <= y1){ const t = smooth(0,1,(y-y0)/(y1-y0)); return [[b0,1-t],[b1,t]]; }
          }
          return [[stops[stops.length-1][1],1]];
        }));
        return api;
      },
      custom(geom, matKey, fn){ push(matKey, setWeights(geom, fn)); return api; },
      // Build one SkinnedMesh (material groups) bound to a fresh skeleton. Optional inverted-hull
      // outline shares the geometry + skeleton, so it deforms with the body for free.
      build(materials, opts){
        opts = opts || {};
        const rig = FKS.makeSkeleton();
        const keys = Object.keys(groups);
        const geoms = [], mats = [];
        const merged = new THREE.BufferGeometry();
        let total = 0; keys.forEach(k => groups[k].forEach(g => total += g.attributes.position.count));
        const A = { position:3, normal:3, uv:2, skinIndex:4, skinWeight:4, color:3 };
        const buf = {}; for (const k in A) buf[k] = new Float32Array(total*A[k]);
        if (!keys.some(k=>groups[k].some(g=>g.attributes.color))) delete buf.color; else buf.color.fill(1);
        let o = 0;
        keys.forEach((k, gi)=>{
          const start = o;
          groups[k].forEach(g=>{
            if (!g.attributes.normal) g.computeVertexNormals();
            const c = g.attributes.position.count;
            for (const a in buf){ if (g.attributes[a]) buf[a].set(g.attributes[a].array.subarray(0, c*A[a]), o*A[a]); }
            o += c;
          });
          merged.addGroup(start, o-start, gi);
          const m = materials[k]; if (!m) throw new Error('fks: no material for '+k);
          m.skinning = true; mats.push(m);
        });
        for (const a in buf) merged.setAttribute(a, new THREE.BufferAttribute(buf[a], A[a]));
        const mesh = new THREE.SkinnedMesh(merged, mats);
        mesh.name = 'racerBody'; mesh.castShadow = true; mesh.receiveShadow = !opts.noReceive;
        mesh.add(rig.root); mesh.bind(rig.skeleton);
        mesh.frustumCulled = false;
        const group = new THREE.Group(); group.name = 'racer'; group.add(mesh);
        if (opts.outline){
          const om = FKS.outlineMaterial(opts.outline.color, opts.outline.thickness, true);
          const outline = new THREE.SkinnedMesh(merged, om);
          outline.name = 'racerOutline'; outline.userData.noExport = true; outline.frustumCulled = false;
          outline.bind(rig.skeleton, mesh.bindMatrix);
          group.add(outline);
        }
        return { group, mesh, bones: rig.bones, skeleton: rig.skeleton, root: rig.root };
      }
    };
    return api;
  };
  function smooth(e0,e1,x){ const t=Math.max(0,Math.min(1,(x-e0)/(e1-e0))); return t*t*(3-2*t); }
  FKS.smooth = smooth;

  // Inverted-hull outline: back faces pushed out along the BIND normal before skinning.
  FKS.outlineMaterial = function(color, thickness, skinning){
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    m.skinning = !!skinning;
    m.onBeforeCompile = (sh)=>{
      sh.uniforms.uOutline = { value: thickness };
      sh.vertexShader = 'uniform float uOutline;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3(position) + normalize(normal) * uOutline;');
    };
    m.customProgramCacheKey = () => 'fksOutline' + (skinning?1:0);
    return m;
  };
  FKS.addOutline = function(mesh, color, thickness){
    const o = new THREE.Mesh(mesh.geometry, FKS.outlineMaterial(color, thickness, false));
    o.userData.noExport = true; o.name = (mesh.name||'')+'Outline';
    mesh.add(o); return o;
  };

  // ---------------------------------------------------------------------------------------------
  // Clip library — shared by all three styles. Keys are euler-degree offsets from bind (identity),
  // plus '<bone>.p' position offsets. clip.ik = {L,R} says how much hand IK owns each arm.
  // ---------------------------------------------------------------------------------------------
  function makeClip(name, dur, keys, ik){
    const bonesUsed = new Set();
    keys.forEach(([,pose]) => Object.keys(pose).forEach(k => bonesUsed.add(k)));
    const tracks = [];
    const times = keys.map(k=>k[0]);
    bonesUsed.forEach(k=>{
      if (k.endsWith('.p')){
        const bone = k.slice(0,-2), bp = FKS.joint(bone), parent = BONE_SPEC.find(s=>s[0]===bone)[1];
        const pp = parent ? FKS.joint(parent) : V3(0,0,0), base = bp.sub(pp);
        const vals = []; keys.forEach(([,pose])=>{ const d = pose[k]||[0,0,0]; vals.push(base.x+d[0], base.y+d[1], base.z+d[2]); });
        tracks.push(new THREE.VectorKeyframeTrack(bone+'.position', times, vals));
      } else {
        const vals = [], q = new THREE.Quaternion(), e = new THREE.Euler();
        keys.forEach(([,pose])=>{ const d = pose[k]||[0,0,0]; q.setFromEuler(e.set(d[0]*DEG, d[1]*DEG, d[2]*DEG, 'YXZ')); vals.push(q.x,q.y,q.z,q.w); });
        tracks.push(new THREE.QuaternionKeyframeTrack(k+'.quaternion', times, vals));
      }
    });
    const clip = new THREE.AnimationClip(name, dur, tracks);
    clip.ik = ik || { L:1, R:1 };
    return clip;
  }
  FKS.makeClip = makeClip;

  FKS.buildClips = function(){
    const C = {};
    // seated rest with life: breathing, a glance left then right, an ear flick, a tail wag
    C.idle = makeClip('idle', 4, [
      [0,   { chest:[0,0,0],  head:[0,0,0],   ear_L:[0,0,0],  ear_R:[0,0,0],  tail:[0,0,0],  'hips.p':[0,0,0] }],
      [1,   { chest:[-3,0,0], head:[-4,18,4], ear_L:[0,0,-8], ear_R:[0,0,6],  tail:[0,25,0], 'hips.p':[0,0.008,0] }],
      [1.3, { chest:[-3,0,0], head:[-4,18,4], ear_L:[0,0,25], ear_R:[0,0,6],  tail:[0,-25,0],'hips.p':[0,0.008,0] }],
      [1.6, { chest:[-3,0,0], head:[-4,18,4], ear_L:[0,0,-8], ear_R:[0,0,6],  tail:[0,25,0], 'hips.p':[0,0.008,0] }],
      [2,   { chest:[0,0,0],  head:[2,0,0],   ear_L:[0,0,0],  ear_R:[0,0,0],  tail:[0,0,0],  'hips.p':[0,0,0] }],
      [3,   { chest:[-3,0,0], head:[-2,-20,-4], ear_L:[0,0,-6], ear_R:[0,0,8], tail:[0,25,0], 'hips.p':[0,0.008,0] }],
      [3.3, { chest:[-3,0,0], head:[-2,-20,-4], ear_L:[0,0,-6], ear_R:[0,0,-25], tail:[0,-25,0], 'hips.p':[0,0.008,0] }],
      [4,   { chest:[0,0,0],  head:[0,0,0],   ear_L:[0,0,0],  ear_R:[0,0,0],  tail:[0,0,0],  'hips.p':[0,0,0] }],
    ]);
    // driving: engine-buzz bounce, ears streaming back, tail flutter
    C.drive = makeClip('drive', 0.5, [
      [0,    { 'hips.p':[0,0,0],     chest:[4,0,0],  head:[-6,0,0], ear_L:[-35,0,10], ear_R:[-35,0,-10], tail:[30,15,0] }],
      [0.125,{ 'hips.p':[0,0.012,0], chest:[5,0,1],  head:[-8,0,1], ear_L:[-45,0,16], ear_R:[-40,0,-12], tail:[35,-15,0] }],
      [0.25, { 'hips.p':[0,0,0],     chest:[4,0,0],  head:[-6,0,0], ear_L:[-38,0,8],  ear_R:[-45,0,-16], tail:[30,15,0] }],
      [0.375,{ 'hips.p':[0,0.010,0], chest:[5,0,-1], head:[-8,0,-1],ear_L:[-42,0,14], ear_R:[-38,0,-9],  tail:[35,-15,0] }],
      [0.5,  { 'hips.p':[0,0,0],     chest:[4,0,0],  head:[-6,0,0], ear_L:[-35,0,10], ear_R:[-35,0,-10], tail:[30,15,0] }],
    ]);
    // steering leans: body into the turn, head looks through it (layered by steer amount)
    C.steerL = makeClip('steerL', 1, [
      [0, { spine:[0,6,-6], chest:[4,10,-10], head:[-4,20,-8], ear_L:[-30,0,-10], ear_R:[-40,0,-25] }],
      [1, { spine:[0,6,-6], chest:[4,10,-10], head:[-4,20,-8], ear_L:[-30,0,-10], ear_R:[-40,0,-25] }],
    ]);
    C.steerR = makeClip('steerR', 1, [
      [0, { spine:[0,-6,6], chest:[4,-10,10], head:[-4,-20,8], ear_L:[-40,0,25], ear_R:[-30,0,10] }],
      [1, { spine:[0,-6,6], chest:[4,-10,10], head:[-4,-20,8], ear_L:[-40,0,25], ear_R:[-30,0,10] }],
    ]);
    // drift: hard lean, the outside leg kicks out, ears whipping
    C.drift = makeClip('drift', 0.4, [
      [0,   { spine:[0,10,-12], chest:[6,14,-16], head:[-6,28,-12], ear_L:[-60,0,-30], ear_R:[-70,0,-40], tail:[40,30,0], thigh_R:[0,-25,-20], shin_R:[20,0,0] }],
      [0.2, { spine:[0,10,-13], chest:[6,14,-17], head:[-6,30,-12], ear_L:[-70,0,-40], ear_R:[-60,0,-30], tail:[40,-30,0], thigh_R:[0,-28,-22], shin_R:[25,0,0] }],
      [0.4, { spine:[0,10,-12], chest:[6,14,-16], head:[-6,28,-12], ear_L:[-60,0,-30], ear_R:[-70,0,-40], tail:[40,30,0], thigh_R:[0,-25,-20], shin_R:[20,0,0] }],
    ]);
    // boost: pinned back in the seat, chin up, ears flat out behind
    C.boost = makeClip('boost', 1.2, [
      [0,   { spine:[0,0,0],   chest:[0,0,0],   head:[0,0,0],    ear_L:[-35,0,10], ear_R:[-35,0,-10], 'hips.p':[0,0,0] }],
      [0.15,{ spine:[-12,0,0], chest:[-14,0,0], head:[-22,0,0],  ear_L:[-95,0,4],  ear_R:[-95,0,-4],  'hips.p':[0,0,-0.03], tail:[70,0,0] }],
      [1.0, { spine:[-10,0,0], chest:[-12,0,0], head:[-18,0,0],  ear_L:[-90,0,8],  ear_R:[-90,0,-8],  'hips.p':[0,0,-0.025], tail:[65,0,0] }],
      [1.2, { spine:[0,0,0],   chest:[4,0,0],   head:[-6,0,0],   ear_L:[-35,0,10], ear_R:[-35,0,-10], 'hips.p':[0,0,0], tail:[30,0,0] }],
    ]);
    // hit: arms fly up, head wobbles, ears shoot straight up, then settle back to the wheel
    C.hit = makeClip('hit', 1.4, [
      [0,   { upperArm_L:[0,0,0],     upperArm_R:[0,0,0],     foreArm_L:[0,0,0],   foreArm_R:[0,0,0],  head:[0,0,0],    chest:[0,0,0],  ear_L:[0,0,0],   ear_R:[0,0,0] }],
      [0.12,{ upperArm_L:[-115,0,40], upperArm_R:[-115,0,-40],foreArm_L:[30,0,0],  foreArm_R:[30,0,0] ,head:[-20,0,15], chest:[-10,0,0],ear_L:[0,0,60],  ear_R:[0,0,-60] }],
      [0.35,{ upperArm_L:[-130,0,60], upperArm_R:[-100,0,-30],foreArm_L:[10,0,0],  foreArm_R:[40,0,0] ,head:[-10,25,-15],chest:[-6,10,0],ear_L:[0,0,70],  ear_R:[0,0,-40] }],
      [0.6, { upperArm_L:[-100,0,30], upperArm_R:[-130,0,-60],foreArm_L:[40,0,0],  foreArm_R:[10,0,0] ,head:[-10,-25,15],chest:[-6,-10,0],ear_L:[0,0,40], ear_R:[0,0,-70] }],
      [0.9, { upperArm_L:[-60,0,20],  upperArm_R:[-60,0,-20], foreArm_L:[-10,0,0], foreArm_R:[-10,0,0],head:[0,10,0],   chest:[0,0,0],  ear_L:[0,0,20],  ear_R:[0,0,-20] }],
      [1.4, { upperArm_L:[0,0,0],     upperArm_R:[0,0,0],     foreArm_L:[0,0,0],   foreArm_R:[0,0,0],  head:[0,0,0],    chest:[0,0,0],  ear_L:[0,0,0],   ear_R:[0,0,0] }],
    ], { L:0, R:0 });
    // cheer: both fists pumping overhead (victory lap / podium)
    // The arm's bind direction sits 41° below forward, so an X offset of θ aims it at (-41° - θ):
    // -125..-140 puts the upper arm overhead, and +35 on the forearm keeps the fist pointing up.
    const up = (k)=>({ upperArm_L:[-125-k,0,22+k], upperArm_R:[-125-k,0,-22-k], foreArm_L:[35-k,0,0], foreArm_R:[35-k,0,0] });
    C.cheer = makeClip('cheer', 1.0, [
      [0,   Object.assign(up(0),  { 'hips.p':[0,0,0],    chest:[-8,0,0],  head:[-15,0,0], ear_L:[0,0,30], ear_R:[0,0,-30], tail:[0,30,0] })],
      [0.25,Object.assign(up(15), { 'hips.p':[0,0.04,0], chest:[-12,0,0], head:[-25,0,0], ear_L:[0,0,55], ear_R:[0,0,-55], tail:[0,-30,0] })],
      [0.5, Object.assign(up(0),  { 'hips.p':[0,0,0],    chest:[-8,0,0],  head:[-15,0,0], ear_L:[0,0,30], ear_R:[0,0,-30], tail:[0,30,0] })],
      [0.75,Object.assign(up(15), { 'hips.p':[0,0.04,0], chest:[-12,0,0], head:[-25,0,0], ear_L:[0,0,55], ear_R:[0,0,-55], tail:[0,-30,0] })],
      [1.0, Object.assign(up(0),  { 'hips.p':[0,0,0],    chest:[-8,0,0],  head:[-15,0,0], ear_L:[0,0,30], ear_R:[0,0,-30], tail:[0,30,0] })],
    ], { L:0, R:0 });
    // wave: right hand off the wheel, waving at the camera; left stays on the wheel
    C.wave = makeClip('wave', 1.2, [
      [0,   { upperArm_R:[-120,0,-70], foreArm_R:[30,0,-30], hand_R:[0,0,0],  head:[0,-25,-8], chest:[0,-10,0] }],
      [0.3, { upperArm_R:[-125,0,-70], foreArm_R:[30,0,15],  hand_R:[0,0,20], head:[0,-25,-8], chest:[0,-10,0] }],
      [0.6, { upperArm_R:[-120,0,-70], foreArm_R:[30,0,-30], hand_R:[0,0,0],  head:[0,-25,-8], chest:[0,-10,0] }],
      [0.9, { upperArm_R:[-125,0,-70], foreArm_R:[30,0,15],  hand_R:[0,0,20], head:[0,-25,-8], chest:[0,-10,0] }],
      [1.2, { upperArm_R:[-120,0,-70], foreArm_R:[30,0,-30], hand_R:[0,0,0],  head:[0,-25,-8], chest:[0,-10,0] }],
    ], { L:1, R:0 });
    // airborne trick: tuck, spin the head round, ears flare
    C.trick = makeClip('trick', 0.8, [
      [0,   { spine:[0,0,0],   chest:[0,0,0],   head:[0,0,0],   ear_L:[0,0,0],  ear_R:[0,0,0],   upperArm_L:[0,0,0],     upperArm_R:[0,0,0], foreArm_L:[0,0,0], foreArm_R:[0,0,0] }],
      [0.2, { spine:[18,0,0],  chest:[16,0,0],  head:[10,0,0],  ear_L:[0,0,70], ear_R:[0,0,-70],  upperArm_L:[-70,0,70],  upperArm_R:[-70,0,-70] }],
      [0.5, { spine:[10,0,0],  chest:[6,0,0],   head:[-25,0,0], ear_L:[0,0,80], ear_R:[0,0,-80],  upperArm_L:[-125,0,30], upperArm_R:[-125,0,-30], foreArm_L:[30,0,0], foreArm_R:[30,0,0] }],
      [0.8, { spine:[0,0,0],   chest:[0,0,0],   head:[0,0,0],   ear_L:[0,0,0],  ear_R:[0,0,0],   upperArm_L:[0,0,0],     upperArm_R:[0,0,0], foreArm_L:[0,0,0], foreArm_R:[0,0,0] }],
    ], { L:0, R:0 });
    return C;
  };

  // ---------------------------------------------------------------------------------------------
  // Analytic two-bone IK (shoulder -> elbow -> wrist) with a pole hint, blended by weight.
  // ---------------------------------------------------------------------------------------------
  const _a=V3(), _b=V3(), _c=V3(), _t=V3(), _x=V3(), _y=V3(), _ax=V3(), _pq=new THREE.Quaternion(), _dq=new THREE.Quaternion(), _tmpq=new THREE.Quaternion();
  const _saveA=new THREE.Quaternion(), _saveB=new THREE.Quaternion();
  function wp(o,v){ return v.setFromMatrixPosition(o.matrixWorld); }
  function rotateWorld(bone, q){
    bone.parent.getWorldQuaternion(_pq);
    _tmpq.copy(_pq).invert().multiply(q).multiply(_pq);
    bone.quaternion.premultiply(_tmpq).normalize();
    bone.updateMatrixWorld(true);
  }
  FKS.solveTwoBone = function(A, B, C, target, pole, weight){
    if (weight <= 0.001) return;
    _saveA.copy(A.quaternion); _saveB.copy(B.quaternion);
    A.updateMatrixWorld(true);
    wp(A,_a); wp(B,_b); wp(C,_c); _t.copy(target);
    const lab = _a.distanceTo(_b), lbc = _b.distanceTo(_c);
    const lat = Math.max(1e-4, Math.min(lab+lbc-1e-4, _a.distanceTo(_t)));
    // 1) elbow angle by the law of cosines
    _x.copy(_a).sub(_b).normalize(); _y.copy(_c).sub(_b).normalize();
    const cur = Math.acos(Math.max(-1, Math.min(1, _x.dot(_y))));
    const des = Math.acos(Math.max(-1, Math.min(1, (lab*lab + lbc*lbc - lat*lat)/(2*lab*lbc))));
    _ax.crossVectors(_y, _x);
    if (_ax.lengthSq() < 1e-10){ _ax.copy(pole).sub(_a).cross(_c.clone().sub(_a)); }
    _ax.normalize();
    rotateWorld(B, _dq.setFromAxisAngle(_ax, cur - des));
    // 2) swing the shoulder so the wrist points at the target
    wp(C,_c); _x.copy(_c).sub(_a).normalize(); _y.copy(_t).sub(_a).normalize();
    rotateWorld(A, _dq.setFromUnitVectors(_x, _y));
    // 3) twist about shoulder->target so the elbow faces the pole
    wp(B,_b); _ax.copy(_t).sub(_a).normalize();
    _x.copy(_b).sub(_a); _x.sub(_ax.clone().multiplyScalar(_x.dot(_ax)));
    _y.copy(pole).sub(_a); _y.sub(_ax.clone().multiplyScalar(_y.dot(_ax)));
    if (_x.lengthSq() > 1e-10 && _y.lengthSq() > 1e-10){
      _x.normalize(); _y.normalize();
      let ang = Math.acos(Math.max(-1, Math.min(1, _x.dot(_y))));
      if (_x.clone().cross(_y).dot(_ax) < 0) ang = -ang;
      rotateWorld(A, _dq.setFromAxisAngle(_ax, ang));
    }
    if (weight < 0.999){
      A.quaternion.copy(_saveA.slerp(A.quaternion, weight));
      B.quaternion.copy(_saveB.slerp(B.quaternion, weight));
      A.updateMatrixWorld(true);
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Racer animator: base layer (idle <-> drive) + steer lean layer + one-shot / looped overlays,
  // then hand IK onto the steering-wheel grips, weighted by whichever clips currently own the arms.
  // ---------------------------------------------------------------------------------------------
  FKS.RacerAnimator = function(racer, clips){
    const mixer = new THREE.AnimationMixer(racer.mesh);
    const act = {};
    for (const k in clips){ act[k] = mixer.clipAction(clips[k]); act[k].play(); act[k].setEffectiveWeight(0); }
    act.idle.setEffectiveWeight(1);
    const B = racer.bones;
    const st = { base:'idle', baseW:{ idle:1, drive:0 }, steer:0, drift:0, boost:0, overlay:null, overlayW:0, overlayT:0, ikL:1, ikR:1 };
    const ONESHOT = { hit:1, boost:1, trick:1 };
    const self = {
      mixer, actions: act, state: st, grips: null,
      setBase(name){ st.base = name; },
      // play an overlay clip: one-shots (hit/boost/trick) fade back out on their own; loops hold
      play(name){
        if (!act[name]) return;
        if (name === 'idle' || name === 'drive'){ st.overlay = null; st.base = name; return; }
        st.overlay = name; st.overlayT = 0; act[name].reset().play(); act[name].setEffectiveWeight(0);
        act[name].time = 0;
      },
      stop(){ st.overlay = null; },
      update(dt, input){
        input = input || {};
        const k = 1 - Math.exp(-dt*8);
        st.baseW.idle += ((st.base==='idle'?1:0) - st.baseW.idle)*k;
        st.baseW.drive += ((st.base==='drive'?1:0) - st.baseW.drive)*k;
        st.steer += ((input.steer||0) - st.steer)*k;
        st.drift += ((input.drift?1:0) - st.drift)*k;
        // overlay timing
        if (st.overlay){
          st.overlayT += dt;
          const d = clips[st.overlay].duration;
          if (ONESHOT[st.overlay] && st.overlayT >= d){ st.overlay = null; }
        }
        const wantO = st.overlay ? 1 : 0;
        st.overlayW += (wantO - st.overlayW) * (1 - Math.exp(-dt*14));
        const ow = st.overlayW, rest = 1 - ow;
        const s = st.steer, dr = st.drift * (1-ow);
        const steerAmt = Math.min(1, Math.abs(s)) * (1-dr);
        const baseScale = rest * (1 - dr);
        act.idle.setEffectiveWeight(st.baseW.idle * baseScale * (1 - steerAmt*0.6));
        act.drive.setEffectiveWeight(st.baseW.drive * baseScale * (1 - steerAmt*0.6));
        act.steerL.setEffectiveWeight(baseScale * Math.max(0, s) * 0.6 + 1e-6);
        act.steerR.setEffectiveWeight(baseScale * Math.max(0, -s) * 0.6 + 1e-6);
        act.drift.setEffectiveWeight(rest * dr);
        for (const n of ['hit','boost','cheer','wave','trick']){
          if (!act[n]) continue;
          act[n].setEffectiveWeight(st.overlay === n ? ow : (act[n].getEffectiveWeight() * (1-k)));
        }
        if (st.overlay && ONESHOT[st.overlay]){ act[st.overlay].setLoop(THREE.LoopOnce); act[st.overlay].clampWhenFinished = true; }
        mixer.update(dt);
        // IK weight = weighted average of each active clip's claim on each arm
        let wl = 0, wr = 0, wt = 0;
        for (const n in act){ const w = act[n].getEffectiveWeight(); if (w < 1e-4) continue; wt += w; wl += w*clips[n].ik.L; wr += w*clips[n].ik.R; }
        const tl = wt ? wl/wt : 1, tr = wt ? wr/wt : 1;
        st.ikL += (tl - st.ikL)*(1-Math.exp(-dt*16)); st.ikR += (tr - st.ikR)*(1-Math.exp(-dt*16));
        if (self.grips){
          racer.root.updateMatrixWorld(true);
          const poleL = V3(0.55, -0.15, -0.25), poleR = V3(-0.55, -0.15, -0.25);
          racer.mesh.localToWorld(poleL); racer.mesh.localToWorld(poleR);
          FKS.solveTwoBone(B.upperArm_L, B.foreArm_L, B.hand_L, self.grips.L.getWorldPosition(V3()), poleL, st.ikL);
          FKS.solveTwoBone(B.upperArm_R, B.foreArm_R, B.hand_R, self.grips.R.getWorldPosition(V3()), poleR, st.ikR);
        }
      }
    };
    return self;
  };

  // ---------------------------------------------------------------------------------------------
  // Kart rig contract. Styles fill kart.body with meshes, then call addWheel / setSteeringWheel.
  //   root -> chassis (suspension roll/pitch/bob/squash) -> body, seat, column -> steerWheel -> grips
  //        -> wheel[i].pivot (front steer yaw) -> wheel[i].spin (roll about local X)
  // ---------------------------------------------------------------------------------------------
  FKS.newKart = function(){
    const root = new THREE.Group(); root.name = 'kart';
    const chassis = new THREE.Group(); chassis.name = 'chassis'; root.add(chassis);
    const body = new THREE.Group(); body.name = 'body'; chassis.add(body);
    const seat = new THREE.Group(); seat.name = 'seat'; seat.position.set(0, 0.85, -0.10); chassis.add(seat);
    const column = new THREE.Group(); column.name = 'steerColumn'; chassis.add(column);
    const steerWheel = new THREE.Group(); steerWheel.name = 'steerWheel'; column.add(steerWheel);
    const gripL = new THREE.Object3D(); gripL.name = 'grip_L'; steerWheel.add(gripL);
    const gripR = new THREE.Object3D(); gripR.name = 'grip_R'; steerWheel.add(gripR);
    const k = {
      root, chassis, body, seat, column, steerWheel, grips:{ L:gripL, R:gripR }, wheels:[], exhausts:[], paint:[], spin:0,
      wheelLock: 1.2, // steering-wheel rotation at full lock (rad); 1.2 keeps both wrists in arm reach (measured)
      flair:[], // style-owned extra animated bits: fn(dt, state)
      addWheel(x, y, z, r, front, mesh){
        const pivot = new THREE.Group(); pivot.name = 'wheelPivot_'+k.wheels.length; pivot.position.set(x,y,z);
        const spin = new THREE.Group(); spin.name = 'wheelSpin_'+k.wheels.length; pivot.add(spin);
        spin.add(mesh); chassis.add(pivot);
        k.wheels.push({ pivot, spin, r, front, x, y, z }); return k;
      },
      // wheel center in racer-seat-relative terms comes out of seat + offset; tilt leans the column back
      setSteeringWheel(center, tilt, radius, mesh){
        column.position.copy(center); column.rotation.x = -tilt;
        if (mesh) steerWheel.add(mesh);
        const a = 58*DEG, back = 0.035;
        gripL.position.set( Math.sin(a)*radius, Math.cos(a)*radius*0.9, -back);
        gripR.position.set(-Math.sin(a)*radius, Math.cos(a)*radius*0.9, -back);
        return k;
      },
      addExhaust(x,y,z){ const o = new THREE.Object3D(); o.position.set(x,y,z); o.name='exhaust_'+k.exhausts.length; chassis.add(o); k.exhausts.push(o); return o; },
      // drive the rig from kart state: {speed m/s, steer -1..1 (+left), drift bool, boost 0..1, air bool, t}
      update(dt, s){
        k.spin += (s.speed||0) * dt;
        for (const w of k.wheels){
          w.spin.rotation.x = k.spin / w.r;
          if (w.front) w.pivot.rotation.y = (s.steer||0) * 0.42;
        }
        steerWheel.rotation.z = -(s.steer||0) * k.wheelLock;
        const spd = Math.min(1, Math.abs(s.speed||0)/20);
        const t = s.t || 0;
        const targRoll = -(s.steer||0) * spd * (s.drift ? 0.14 : 0.07);
        const targPitch = -(s.accel||0) * 0.02 + (s.boost||0) * -0.05;
        chassis.rotation.z += (targRoll - chassis.rotation.z) * (1 - Math.exp(-dt*8));
        chassis.rotation.x += (targPitch - chassis.rotation.x) * (1 - Math.exp(-dt*6));
        chassis.position.y = Math.sin(t*31)*0.006*spd + Math.sin(t*13.7)*0.004*spd + (s.squash||0)*-0.06;
        const sq = 1 + (s.squash||0)*0.12;
        chassis.scale.set(sq, 1/sq, sq);
        for (const f of k.flair) f(dt, s);
      }
    };
    return k;
  };

  // Clip export for the kart (GLB): wheels roll + chassis buzz, steer left/right holds.
  FKS.kartClips = function(kart){
    const T = []; const n = 9, times = [], spinVals = [];
    for (let i=0;i<n;i++){ times.push(i*(0.5/(n-1))); const q=new THREE.Quaternion().setFromAxisAngle(V3(1,0,0), (i/(n-1))*Math.PI*2); spinVals.push(q.x,q.y,q.z,q.w); }
    kart.wheels.forEach(w => T.push(new THREE.QuaternionKeyframeTrack(w.spin.name+'.quaternion', times, spinVals)));
    T.push(new THREE.VectorKeyframeTrack('chassis.position', [0,0.125,0.25,0.375,0.5], [0,0,0, 0,0.01,0, 0,0,0, 0,0.008,0, 0,0,0]));
    const drive = new THREE.AnimationClip('kart_drive', 0.5, T);
    const steer = (sgn, name) => {
      const tr = [];
      kart.wheels.filter(w=>w.front).forEach(w=>{ const q=new THREE.Quaternion().setFromAxisAngle(V3(0,1,0), sgn*0.42); tr.push(new THREE.QuaternionKeyframeTrack(w.pivot.name+'.quaternion', [0,1], [q.x,q.y,q.z,q.w,q.x,q.y,q.z,q.w])); });
      const qs = new THREE.Quaternion().setFromAxisAngle(V3(0,0,1), -sgn*1.5); tr.push(new THREE.QuaternionKeyframeTrack('steerWheel.quaternion',[0,1],[qs.x,qs.y,qs.z,qs.w,qs.x,qs.y,qs.z,qs.w]));
      const qc = new THREE.Quaternion().setFromAxisAngle(V3(0,0,1), -sgn*0.07); tr.push(new THREE.QuaternionKeyframeTrack('chassis.quaternion',[0,1],[qc.x,qc.y,qc.z,qc.w,qc.x,qc.y,qc.z,qc.w]));
      return new THREE.AnimationClip(name, 1, tr);
    };
    return [drive, steer(1,'kart_steerL'), steer(-1,'kart_steerR')];
  };

  // ---------------------------------------------------------------------------------------------
  // Demo course: one closed loop shared by every style (hairpin, S-bend, a crest, two boost pads).
  // ---------------------------------------------------------------------------------------------
  FKS.makeTrack = function(){
    const P = [
      [0,0,-46],[24,0,-48],[44,1,-38],[52,2.5,-18],[46,3.5,4],[30,3,14],[18,1.5,26],[22,0.5,44],
      [8,0,56],[-14,0,52],[-22,0.5,36],[-34,1,26],[-50,1.5,18],[-56,1,-4],[-46,0.5,-24],[-26,0,-40],
    ].map(p=>V3(p[0],p[1],p[2]));
    const curve = new THREE.CatmullRomCurve3(P, true, 'centripetal');
    const N = 600, pts = curve.getSpacedPoints(N); pts.pop();
    const length = curve.getLength();
    const width = 9;
    const frames = pts.map((p,i)=>{
      const nx = pts[(i+1)%N], pv = pts[(i-1+N)%N];
      const tan = nx.clone().sub(pv).normalize();
      const side = V3(0,1,0).cross(tan).normalize(); // +X side = left of travel (matches racer +X)
      return { p, tan, side };
    });
    // signed curvature (+ = turning left) for steering + drift
    frames.forEach((f,i)=>{
      const a = frames[(i-6+N)%N].tan, b = frames[(i+6)%N].tan;
      const cr = a.x*b.z - a.z*b.x; // y of a×b... sign: left turn -> positive below
      f.curv = -cr / ( (length/N)*12 );
    });
    function at(u){
      u = ((u%1)+1)%1; const x = u*N, i = Math.floor(x), t = x-i, a = frames[i], b = frames[(i+1)%N];
      return { p: a.p.clone().lerp(b.p, t), tan: a.tan.clone().lerp(b.tan, t).normalize(), side: a.side.clone().lerp(b.side,t).normalize(), curv: a.curv+(b.curv-a.curv)*t };
    }
    // ribbon geometry along the loop; v runs across [0..1], u runs along distance
    function ribbon(w, y, opts){
      opts = opts || {};
      const across = opts.across || 2, pos = [], uv = [], idx = [];
      // optional sub-range [u0,u1] of the loop (start line, boost pads); uv.y then restarts at 0
      const i0 = opts.u0 != null ? Math.floor(opts.u0*N) : 0;
      const iN = opts.u1 != null ? Math.max(1, Math.ceil(opts.u1*N) - i0) : N;
      for (let ii=0;ii<=iN;ii++){
        const i = i0 + ii;
        const f = frames[((i%N)+N)%N], d = (ii/N)*length;
        for (let j=0;j<=across;j++){
          const v = j/across, off = (v-0.5)*w + (opts.offset||0);
          pos.push(f.p.x + f.side.x*off, f.p.y + y + (opts.crown ? (1-Math.pow(2*v-1,2))*opts.crown : 0), f.p.z + f.side.z*off);
          uv.push(v, d/(opts.uvScale||w));
        }
      }
      const row = across+1;
      for (let i=0;i<iN;i++) for (let j=0;j<across;j++){ const a=i*row+j, b=a+row; idx.push(a,b,a+1, a+1,b,b+1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
      g.setIndex(idx); g.computeVertexNormals(); return g;
    }
    // nearest centerline sample (XZ) — used to flatten terrain under the road
    function nearest(x,z){
      let best = 1e9, bi = 0;
      for (let i=0;i<N;i+=2){ const p = frames[i].p, d=(p.x-x)*(p.x-x)+(p.z-z)*(p.z-z); if (d<best){best=d;bi=i;} }
      for (let i=bi-3;i<=bi+3;i++){ const f=frames[(i+N)%N], d=(f.p.x-x)*(f.p.x-x)+(f.p.z-z)*(f.p.z-z); if (d<best){best=d;bi=(i+N)%N;} }
      return { i:bi, d:Math.sqrt(best), y: frames[bi].p.y, f: frames[bi] };
    }
    // terrain height: rolling hills, flattened to the road bed within reach of the road edge
    function groundY(x, z, hills){
      const n = nearest(x,z);
      const hill = (hills||0) * (noise3(x*0.025, 0, z*0.025)*0.6 + noise3(x*0.06, 3, z*0.06)*0.25 + 0.4);
      const bed = n.y - 0.05;
      return bed + (hill - bed) * FKS.smooth(width*0.5 + 1.0, width*0.5 + 16, n.d);
    }
    const boostPads = [0.11, 0.62];
    return { curve, frames, N, length, width, at, ribbon, nearest, groundY, boostPads };
  };

  // Gradient sky dome: stops [[height -1..1, hex], ...] + optional sun glow.
  FKS.skyDome = function(stops, opts){
    opts = opts || {};
    const cols = stops.map(s=>new THREE.Color(s[1]));
    const H = stops.map(s=>s[0]);
    const n = stops.length;
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uCols: { value: cols }, uH: { value: H },
        uSunDir: { value: (opts.sunDir || V3(0.3,0.4,-1)).clone().normalize() },
        uSunCol: { value: new THREE.Color(opts.sunColor || 0xffffff) },
        uSunSize: { value: opts.sunSize || 0.0 }, uGlow: { value: opts.glow || 0.0 },
        uBands: { value: opts.bands || 0.0 }, uDither: { value: opts.dither || 0.0 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }',
      fragmentShader: `
        uniform vec3 uCols[${n}]; uniform float uH[${n}];
        uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunSize; uniform float uGlow; uniform float uBands; uniform float uDither;
        varying vec3 vDir;
        void main(){
          float h = normalize(vDir).y;
          if (uBands > 0.0) h = floor(h*uBands)/uBands;
          vec3 c = uCols[0];
          for (int i=1;i<${n};i++){ float t = clamp((h - uH[i-1])/(uH[i]-uH[i-1]), 0.0, 1.0); if (h > uH[i-1]) c = mix(c, uCols[i], t); }
          float d = dot(normalize(vDir), uSunDir);
          if (uSunSize > 0.0){
            float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize*0.85, d);
            float glow = pow(max(d,0.0), 12.0) * uGlow;
            c = mix(c, uSunCol, clamp(disc + glow, 0.0, 1.0));
          }
          if (uDither > 0.0){ float r = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453); c += (r-0.5)*uDither; }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(opts.radius || 400, 48, 24), mat);
    m.name = 'skyDome'; m.renderOrder = -10; m.frustumCulled = false;
    return m;
  };

  // Toon gradient ramp (NearestFilter so the bands stay hard)
  FKS.toonRamp = function(steps){
    steps = steps || [0.35, 0.7, 1.0];
    const d = new Uint8Array(steps.length*4);
    steps.forEach((s,i)=>{ const v = Math.round(s*255); d[i*4]=v; d[i*4+1]=v; d[i*4+2]=v; d[i*4+3]=255; });
    const t = new THREE.DataTexture(d, steps.length, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  };

  // Canvas texture helper
  FKS.canvasTex = function(w, h, draw, opts){
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (opts && opts.nearest){ t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
    else t.anisotropy = 4;
    return t;
  };

  // Scatter helper: positions beside the road (not on it), deterministic.
  FKS.scatter = function(track, count, seed, minD, maxD, extent){
    const r = rng(seed), out = []; let guard = 0;
    while (out.length < count && guard++ < count*40){
      const x = (r()*2-1)*(extent||90), z = (r()*2-1)*(extent||90);
      const n = track.nearest(x,z);
      if (n.d < (minD||track.width*0.5+3) || n.d > (maxD||1e9)) continue;
      out.push({ x, z, d:n.d, r:r(), r2:r(), r3:r() });
    }
    return out;
  };
})();
