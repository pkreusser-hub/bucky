// Style 2 — GOLDEN-HOUR LOW-POLY. Every surface is flat-shaded facets with per-triangle colour
// variation baked into vertex colours, no outlines. Late-afternoon sun low on the horizon throws long
// shadows; the sky is a violet-to-orange dusk gradient over layered faceted mountains and pink clouds.
(function(){
  'use strict';
  const G = FKS.geo, V3 = (x,y,z)=>new THREE.Vector3(x,y,z), J = FKS.joint, rnd = FKS.rng;
  const PI = Math.PI;
  const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));

  // ---------------------------------------------------------------- facet painting helpers
  const _c = new THREE.Color(), _hsl = {};
  // Convert to flat facets and bake one colour per triangle. base: hex or fn(cx,cy,cz,nx,ny,nz)->hex.
  // vr = lightness variation per triangle (+-fraction), shade = optional fn(nx,ny,nz)->lightness factor.
  function fp(geo, base, vr, seed, shade){
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count, a = new Float32Array(n*3), r = rnd((seed||1)*2654435761>>>0);
    for (let i=0;i+2<n;i+=3){
      const cx=(pos.getX(i)+pos.getX(i+1)+pos.getX(i+2))/3, cy=(pos.getY(i)+pos.getY(i+1)+pos.getY(i+2))/3, cz=(pos.getZ(i)+pos.getZ(i+1)+pos.getZ(i+2))/3;
      const nx=nor.getX(i), ny=nor.getY(i), nz=nor.getZ(i);
      const hex = typeof base === 'function' ? base(cx,cy,cz,nx,ny,nz) : base;
      _c.setHex(hex).getHSL(_hsl);
      let l = _hsl.l * (1 + (r()*2-1)*(vr||0));
      if (shade) l *= shade(nx,ny,nz);
      _c.setHSL(_hsl.h + (r()-0.5)*0.016, clamp(_hsl.s*(1+(r()-0.5)*0.12),0,1), clamp(l,0,1));
      for (let k=0;k<3;k++){ a[(i+k)*3]=_c.r; a[(i+k)*3+1]=_c.g; a[(i+k)*3+2]=_c.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(a,3));
    return g;
  }
  const mat4 = (x,y,z,rx,ry,rz,sx,sy,sz)=> new THREE.Matrix4().compose(V3(x,y,z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx||0,ry||0,rz||0)), V3(sx==null?1:sx, sy==null?(sx==null?1:sx):sy, sz==null?(sx==null?1:sx):sz));
  const put = (g,x,y,z,rx,ry,rz)=> G.at(g,x,y,z,rx,ry,rz);
  const ico = (r,d,sx,sy,sz,jit,seed)=>{ const g = new THREE.IcosahedronGeometry(r,d); g.scale(sx||1,sy||1,sz||1); return G.facet(g, jit||0, seed||3); };
  const boxg = (w,h,d,hex,vr,seed)=> fp(new THREE.BoxGeometry(w,h,d), hex, vr==null?0.08:vr, seed);
  // tapered box: front (+z) narrowed in x by fx and its top dropped by drop (kart wedges, boots)
  function wedge(w,h,d,fx,drop,hex,vr,seed){
    const g = new THREE.BoxGeometry(w,h,d), p = g.attributes.position;
    for (let i=0;i<p.count;i++) if (p.getZ(i) > 0){ p.setX(i, p.getX(i)*fx); if (p.getY(i) > 0) p.setY(i, p.getY(i)-drop); }
    return fp(g, hex, vr==null?0.07:vr, seed);
  }
  // frustum from p0 to p1
  function frus(p0,p1,r0,r1,seg,hex,vr,seed){
    const len = p0.distanceTo(p1), g = new THREE.CylinderGeometry(r1, r0, len, seg||5, 1).translate(0,len/2,0);
    G.alignY(g, p0, p1); return fp(g, hex, vr==null?0.1:vr, seed);
  }
  // closed tetrahedron from four points (faces wound outward)
  function tetra(a,b,c,d,hex,vr,seed){
    const pts = [a,b,c,d], cen = a.clone().add(b).add(c).add(d).multiplyScalar(0.25), pos = [];
    for (const f of [[0,1,2],[0,3,1],[1,3,2],[2,3,0]]){
      let [i,j,k] = f; const A=pts[i], B=pts[j], C=pts[k];
      const n = B.clone().sub(A).cross(C.clone().sub(A)), fc = A.clone().add(B).add(C).multiplyScalar(1/3);
      if (n.dot(fc.sub(cen)) < 0){ const t=j; j=k; k=t; }
      for (const q of [i,j,k]) pos.push(pts[q].x, pts[q].y, pts[q].z);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
    return fp(g, hex, vr==null?0.08:vr, seed);
  }
  const merge = (list)=> G.merge(list);
  const stdMat = (extra)=> new THREE.MeshStandardMaterial(Object.assign({ vertexColors:true, flatShading:true, roughness:0.95, metalness:0 }, extra||{}));

  const SUN_DIR = V3(-0.56, 0.358, -0.747).normalize();   // ~21 degrees up, raking across the course
  const PALETTE = {
    wheat:[0xeacb7e,0xd9a843,0xc98a35,0xcdb064], sage:0x9aa064, dust:0xb8683a,
    pine:[0x2a5a49,0x2f6a50,0x3a7a54], gold:[0xe0a23a,0xeab24c,0xc88a30,0xa9923a],
    wood:0x9c7a5a, rail:0xb48d66, barn:0xb5452f, plum:0x5a3a52,
    flags:[0xe8553a,0xf6a23a,0xf4d06f,0xd96a8a,0x59a5a0,0xfff0d6],
  };

  // ------------------------------------------------------------------ kart
  function pumpkin(rad, seed, withStem){
    const g = new THREE.IcosahedronGeometry(rad, 1), p = g.attributes.position;
    for (let i=0;i<p.count;i++){ const x=p.getX(i), z=p.getZ(i), f = 1 + 0.08*Math.cos(Math.atan2(z,x)*7); p.setXYZ(i, x*f, p.getY(i)*0.76, z*f); }
    const parts = [fp(G.facet(g, rad*0.07, seed), (cx,cy,cz)=> cy > rad*0.5 ? 0xf29a2e : 0xe8741c, 0.1, seed)];
    if (withStem !== false) parts.push(fp(new THREE.ConeGeometry(rad*0.14, rad*0.45, 5).translate(0, rad*0.76+rad*0.12, 0), 0x6a8a3a, 0.12, seed+1));
    return merge(parts);
  }

  function buildKart(color){
    const k = FKS.newKart(), B = k.body;
    const paint = stdMat({ color, roughness:0.8 }), trim = stdMat(), lamp = stdMat({ color:0xffe3a0, emissive:0xffb050, emissiveIntensity:0.9 });
    k.paint.push(paint);
    const mesh = (geo, m, parent)=>{ const me = new THREE.Mesh(geo, m); me.castShadow = true; me.receiveShadow = true; (parent||B).add(me); return me; };
    const W = 0xffffff;
    // painted shell: long wedge tub, tapering nose, angular side pods and rear fender slabs
    const shell = [
      put(wedge(1.18,0.40,1.90,1,0, W,0.05,1), 0,0.48,-0.10),
      put(wedge(1.00,0.34,1.00,0.45,0.12, W,0.05,2), 0,0.51,0.95),
      put(wedge(1.04,0.20,0.5,1,0.1, W,0.05,3), 0,0.70,-0.98),
    ];
    for (const sx of [-1,1]){
      shell.push(put(wedge(0.26,0.22,0.86,0.55,0.07, W,0.06,4+sx), sx*0.70,0.40,0.10));
      // faceted arch fenders: five plates stepping round each wheel's arc (flat slabs read as flaps)
      const arch = (x, y, z, r, w, seed) => {
        for (let i=0;i<5;i++){
          const a = -Math.PI*0.42 + i*(Math.PI*0.84/4), rr = r + 0.09, len = 2*rr*Math.sin(Math.PI*0.84/8) + 0.03;
          shell.push(put(boxg(w, 0.07, len, W, 0.06, seed+i), x, y + Math.cos(a)*rr, z + Math.sin(a)*rr, a, 0, 0));
        }
      };
      arch(sx*0.68, 0.36, -0.72, 0.36, 0.42, 7+sx*3);
      arch(sx*0.64, 0.28,  0.80, 0.28, 0.32, 20+sx*3);
    }
    mesh(merge(shell), paint);
    // trim: cream stripe, dark floor, seat, backrest, dash, nose ornament, steering column
    const cream = 0xffe8c4, dark = 0x3a2a48, wood = 0xa86f3e, mustard = 0xf0b23a;
    const tr = [];
    for (const sx of [-1,1]) tr.push(put(boxg(0.05,0.07,1.45, cream,0.06,11), sx*0.60,0.50,-0.05));
    tr.push(put(boxg(1.0,0.10,2.3, dark,0.08,12), 0,0.30,0.0));
    tr.push(put(boxg(0.52,0.12,0.46, dark,0.08,13), 0,0.80,-0.10));
    tr.push(put(boxg(0.54,0.56,0.12, cream,0.07,14), 0,1.04,-0.37, -0.14,0,0));
    tr.push(put(wedge(0.78,0.20,0.30,0.8,0.06, dark,0.08,15), 0,0.90,0.46));
    tr.push(put(new THREE.ConeGeometry(0.07,0.30,4).rotateX(PI/2).toNonIndexed(), 0,0.62,1.52));
    tr[tr.length-1] = fp(tr[tr.length-1], mustard, 0.08, 16);
    // pumpkin crate in the back
    const cz = -0.86, cy = 0.84;
    tr.push(put(boxg(0.88,0.04,0.52, wood,0.1,17), 0,cy-0.12,cz));
    for (const sx of [-1,1]) tr.push(put(boxg(0.05,0.26,0.52, wood,0.1,18+sx), sx*0.44,cy,cz));
    for (const sz of [-1,1]) tr.push(put(boxg(0.88,0.26,0.05, wood,0.1,20+sz), 0,cy,cz+sz*0.26));
    for (const sx of [-1,1]) for (const sz of [-1,1]) tr.push(put(boxg(0.07,0.32,0.07, 0x7a4a2a,0.1,22), sx*0.44,cy+0.01,cz+sz*0.26));
    const pk = [[-0.2,0.13,0.1,0.19],[0.2,0.13,0.08,0.18],[0,0.15,-0.12,0.2],[-0.18,0.1,-0.16,0.15],[0.2,0.12,-0.14,0.16]];
    pk.forEach((q,i)=> tr.push(put(pumpkin(q[3], 30+i), q[0], cy+q[1]-0.02, cz+q[2], 0, i*1.3, 0)));
    // exhaust: hexagonal stacks, tilted back
    const pipes = [];
    for (const sx of [-1,1]){
      pipes.push(frus(V3(sx*0.44,0.60,-1.02), V3(sx*0.46,1.06,-1.20), 0.075,0.055, 6, 0x9aa0b4, 0.12, 40));
      pipes.push(frus(V3(sx*0.46,1.04,-1.19), V3(sx*0.46,1.12,-1.22), 0.07,0.07, 6, 0x3a2a48, 0.1, 41));
      k.addExhaust(sx*0.46, 1.14, -1.23);
    }
    mesh(merge(tr), trim); mesh(merge(pipes), trim);
    // headlights
    for (const sx of [-1,1]){
      const hl = new THREE.Mesh(new THREE.ConeGeometry(0.1,0.14,4).rotateX(PI/2).rotateZ(PI/4), lamp); hl.position.set(sx*0.2,0.55,1.43); B.add(hl);
    }
    // pennant on a rear whip (flair: flutters with speed and steering)
    const pole = new THREE.Group(); pole.position.set(-0.40,0.95,-1.12); k.chassis.add(pole);
    mesh(fp(new THREE.CylinderGeometry(0.014,0.02,1.0,5).translate(0,0.5,0), dark, 0.05, 50), trim, pole);
    const flag = new THREE.Group(); flag.position.set(0,0.92,0); pole.add(flag);
    const fg = merge([tetra(V3(0,0.07,0), V3(0,-0.07,0), V3(-0.36,0,0), V3(0,0,0.03), 0xf0658a, 0.1, 51)]);
    flag.add(new THREE.Mesh(fg, trim));
    k.flair.push((dt, s)=>{ const sp = Math.min(1, Math.abs(s.speed||0)/20), t = s.t||0; pole.rotation.x = -0.2*sp + Math.sin(t*9)*0.04*sp; pole.rotation.z = (s.steer||0)*0.2*sp; flag.rotation.y = Math.sin(t*14)*0.4*(0.25+sp); });
    // steering column + octagonal wheel
    const col = mesh(boxg(0.05,0.42,0.05, dark,0.05,60), trim, k.chassis); col.position.set(0,1.07,0.30); col.rotation.x = -0.9;
    const sw = new THREE.Group();
    mesh(fp(new THREE.TorusGeometry(0.17,0.032,4,8), 0x3a2a48, 0.12, 61), trim, sw);
    for (let i=0;i<3;i++){ const sp = mesh(boxg(0.035,0.17,0.025, 0xc9ccd8,0.1,62+i), trim, sw); sp.geometry.translate(0,0.085,0); sp.rotation.z = i*PI*2/3 + PI; }
    mesh(fp(new THREE.OctahedronGeometry(0.055), 0xe8553a, 0.1, 66), trim, sw);
    k.setSteeringWheel(V3(0,1.25,0.16), 0.55, 0.17, sw);
    // wheels: chamfered octagonal tyres, mustard rims with four raised spokes so the roll reads
    const mkWheel = (r, w, seed)=>{
      const parts = [], tire = 0x3b3040, rim = 0xf0b23a;
      parts.push(fp(new THREE.CylinderGeometry(r,r,w*0.7,8).rotateZ(PI/2).rotateX(PI/8), tire, 0.22, seed));
      for (const sx of [-1,1]) parts.push(fp(new THREE.CylinderGeometry(r*0.82,r*0.98,w*0.15,8).rotateZ(PI/2*sx).translate(sx*w*0.425,0,0).rotateX(PI/8), tire, 0.18, seed+1));
      for (const sx of [-1,1]){
        parts.push(fp(new THREE.CylinderGeometry(r*0.5,r*0.5,0.03,8).rotateZ(PI/2).translate(sx*(w*0.5+0.0),0,0), rim, 0.1, seed+2));
        for (let i=0;i<4;i++){ const b = boxg(0.035,r*0.9,r*0.14, 0xe8553a, 0.12, seed+3+i); b.rotateX(i*PI/4); b.translate(sx*(w*0.5+0.02),0,0); parts.push(b); }
      }
      return merge(parts);
    };
    const wm = stdMat();
    const mkW = (r,w,s)=>{ const g = new THREE.Group(); const m = new THREE.Mesh(mkWheel(r,w,s), wm); m.castShadow = true; m.receiveShadow = true; g.add(m); return g; };
    k.addWheel( 0.64,0.28, 0.80,0.28,true,  mkW(0.28,0.24,70));
    k.addWheel(-0.64,0.28, 0.80,0.28,true,  mkW(0.28,0.24,75));
    k.addWheel( 0.68,0.36,-0.72,0.36,false, mkW(0.36,0.34,80));
    k.addWheel(-0.68,0.36,-0.72,0.36,false, mkW(0.36,0.34,85));
    k.setColor = (hex)=>{ paint.color.setHex(hex); };
    return k;
  }

  // ------------------------------------------------------------------ racer (faceted Bucky, skinned)
  function buildRacer(){
    const sk = FKS.skinBuilder(), H = J('head');
    const FUR = 0x9a6438, CREAM = 0xf3e3c0, DARK = 0x3a2418, WHITE = 0xfff4e6;
    const hy = H.y+0.13, hz = H.z+0.02;
    // head: jittered icosahedron + wedge snout
    sk.rigid(put(fp(ico(0.2,1,1.04,0.97,1,0.028,5), FUR, 0.11, 101), 0,hy,hz), 'fur', 'head');
    sk.rigid(put(fp(ico(0.1,1,0.92,0.78,1.4,0.012,6), CREAM, 0.07, 102), 0,H.y+0.07,H.z+0.17), 'cream', 'head');
    sk.rigid(put(fp(ico(0.036,0,1.25,0.8,0.8,0.0,7), DARK, 0.1, 103), 0,H.y+0.085,H.z+0.305), 'nose', 'head');
    sk.rigid(put(fp(new THREE.ConeGeometry(0.042,0.13,5).rotateX(PI), CREAM, 0.1, 104), 0,H.y-0.02,H.z+0.15), 'cream', 'head');   // goatee
    for (const sx of [-1,1]){
      // eyes: diamond whites with dark diamond pupils, angular brows
      const ew = new THREE.OctahedronGeometry(0.056); ew.scale(1,1.25,0.5);
      sk.rigid(put(fp(ew, 0xffffff, 0.05, 105), sx*0.088,H.y+0.17,H.z+0.197), 'eyeW', 'head');
      const ep = new THREE.OctahedronGeometry(0.03); ep.scale(1,1.35,0.6);
      sk.rigid(put(fp(ep, 0x1d1410, 0.1, 106), sx*0.084,H.y+0.165,H.z+0.222), 'eye', 'head');
      sk.rigid(put(fp(new THREE.BoxGeometry(0.08,0.018,0.022), 0x5a3a22, 0.1, 107).rotateZ(-sx*0.3), sx*0.09,H.y+0.255,H.z+0.185), 'nose', 'head');
      // cone horns: a chain of tapering faceted segments sweeping back and curling down
      const h0 = V3(sx*0.08,H.y+0.28,H.z-0.01), h1 = V3(sx*0.115,H.y+0.37,H.z-0.06), h2 = V3(sx*0.15,H.y+0.40,H.z-0.17), h3 = V3(sx*0.175,H.y+0.355,H.z-0.26), h4 = V3(sx*0.18,H.y+0.29,H.z-0.30);
      sk.rigid(merge([frus(h0,h1,0.048,0.038,5,0xf1deb4,0.08,110), frus(h1,h2,0.038,0.028,5,0xe8d3a0,0.08,111), frus(h2,h3,0.028,0.018,5,0xdfc58e,0.08,112), frus(h3,h4,0.018,0.004,5,0x8a6a48,0.1,113)]), 'horn', 'head');
      // folded-paper ears on their own bones: a creased tetrahedron, pink underside
      const s = sx>0 ? 'L' : 'R', E = J('ear_'+s), out = V3(sx,-0.32,0).normalize();
      const A = E.clone().add(V3(0,0,0.065)), Bp = E.clone().add(V3(0,0,-0.065)), R = E.clone().addScaledVector(out,0.07).add(V3(0,0.05,0)), T = E.clone().addScaledVector(out,0.24).add(V3(0,-0.05,0));
      sk.rigid(tetra(A,Bp,R,T, FUR, 0.12, 114), 'fur', 'ear_'+s);
      const A2 = E.clone().add(V3(0,-0.012,0.04)), B2 = E.clone().add(V3(0,-0.012,-0.04)), R2 = E.clone().addScaledVector(out,0.07).add(V3(0,0.01,0)), T2 = E.clone().addScaledVector(out,0.2).add(V3(0,-0.075,0));
      sk.rigid(tetra(A2,B2,R2,T2, 0xf0a0a4, 0.1, 115), 'pink', 'ear_'+s);
    }
    // angular chef toque: octagonal band, flared pleated body, faceted cap
    const ty = H.y+0.30;
    sk.rigid(put(merge([
      fp(new THREE.CylinderGeometry(0.108,0.100,0.09,8), WHITE, 0.05, 120).translate(0,0,0),
      fp(new THREE.CylinderGeometry(0.165,0.108,0.14,8), WHITE, 0.07, 121).translate(0,0.115,0),
      fp(G.facet(new THREE.IcosahedronGeometry(0.15,0).scale(1,0.55,1), 0.012, 9), WHITE, 0.06, 122).translate(0,0.215,0),
    ]), 0,ty,H.z-0.02), 'shirt', 'head');
    // neck scarf: faceted ring + a triangular knot
    sk.along(put(fp(new THREE.TorusGeometry(0.1,0.036,4,8), 0xe8553a, 0.1, 130).rotateX(PI/2), 0,0.585,0), 'scarf', [[0.55,'chest'],[0.62,'neck']]);
    sk.rigid(tetra(V3(0.03,0.58,0.1), V3(0.09,0.56,0.11), V3(0.06,0.5,0.1), V3(0.065,0.55,0.15), 0xd9442a, 0.1, 131), 'scarf', 'chest');
    // torso: white jacket as a jittered icosahedron, hips in indigo
    sk.along(put(fp(ico(1,1,0.17,0.25,0.15,0.014,11), WHITE, 0.07, 132), 0,0.36,-0.03), 'shirt', [[0.14,'hips'],[0.30,'spine'],[0.46,'chest'],[0.6,'neck']]);
    for (let i=0;i<3;i++) sk.rigid(put(fp(new THREE.OctahedronGeometry(0.018), 0xd6a64a, 0.1, 133+i), 0.04,0.46-i*0.08,0.118), 'scarf', i===0?'chest':'spine');
    sk.along(put(fp(ico(1,1,0.18,0.09,0.16,0.01,12), 0x3d4a8a, 0.1, 140), 0,0.14,-0.03), 'pants', [[0.1,'hips'],[0.2,'spine']]);
    // limbs: hexagonal capsules so facets stay crisp while elbows and knees bend
    for (const s of ['L','R']){
      const f = J('foot_'+s), h = J('hand_'+s), dir = h.clone().sub(J('foreArm_'+s)).normalize();
      sk.limb(fp(G.capsule(J('upperArm_'+s), J('foreArm_'+s), 0.062, 0.052, 6, 5), WHITE, 0.07, 150), 'shirt', 'upperArm_'+s, 'foreArm_'+s, { blendParent:true });
      sk.limb(fp(G.capsule(J('foreArm_'+s), J('hand_'+s), 0.046, 0.04, 6, 5), FUR, 0.1, 151), 'fur', 'foreArm_'+s, 'hand_'+s);
      sk.rigid(put(fp(new THREE.DodecahedronGeometry(0.055,0), WHITE, 0.07, 152), h.x+dir.x*0.04, h.y+dir.y*0.04, h.z+dir.z*0.04), 'glove', 'hand_'+s);
      sk.limb(fp(G.capsule(J('thigh_'+s), J('shin_'+s), 0.076, 0.062, 6, 5), 0x3d4a8a, 0.1, 153), 'pants', 'thigh_'+s, 'shin_'+s, { blendParent:true });
      sk.limb(fp(G.capsule(J('shin_'+s), J('foot_'+s), 0.056, 0.05, 6, 5), 0x3d4a8a, 0.1, 154), 'pants', 'shin_'+s, 'foot_'+s);
      sk.rigid(put(wedge(0.12,0.1,0.22,0.7,0.04, 0x4a3426,0.1,155), f.x, f.y-0.01, f.z+0.05), 'hoof', 'foot_'+s);
    }
    const T = J('tail');
    sk.rigid(put(fp(new THREE.ConeGeometry(0.045,0.13,4).rotateX(-2.2), CREAM, 0.08, 160), T.x,T.y+0.04,T.z-0.02), 'cream', 'tail');
    return sk.build({
      fur:stdMat(), cream:stdMat(), nose:stdMat(), eyeW:stdMat(), eye:stdMat(), horn:stdMat(), pink:stdMat(), shirt:stdMat(),
      scarf:stdMat(), pants:stdMat(), glove:stdMat(), hoof:stdMat(),
    });
  }

  // ------------------------------------------------------------------ world
  function buildWorld(scene, track){
    const W = { hills: 4 };
    scene.fog = new THREE.Fog(0xf59a72, 55, 420);
    scene.add(FKS.skyDome([
      [-0.3,0xf09a6a],[0.0,0xf7a070],[0.03,0xff8466],[0.10,0xffa27c],[0.22,0xffc79a],[0.34,0xe49aa6],[0.52,0x9a6aa8],[0.78,0x4a3a8c],[1,0x241d64],
    ], { sunDir:SUN_DIR, sunColor:0xffe2a8, sunSize:0.022, glow:0.9, radius:430 }));
    scene.add(new THREE.HemisphereLight(0xb4a4ee, 0x7a5646, 0.7));
    const sun = new THREE.DirectionalLight(0xffc27a, 1.7);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -34; sc.right = sc.top = 34; sc.near = 1; sc.far = 220;
    sun.shadow.bias = -0.0012; sun.shadow.normalBias = 0.18;
    scene.add(sun); scene.add(sun.target);
    W.sun = sun; W.sunOffset = SUN_DIR.clone().multiplyScalar(90);

    const std = stdMat();
    const tm = new THREE.Matrix4();
    const addMesh = (geo, material, cast, recv)=>{ const m = new THREE.Mesh(geo, material || std); m.castShadow = !!cast; m.receiveShadow = recv !== false; scene.add(m); return m; };

    // ---------------- terrain: non-uniform grid (fine near the road, huge facets far away), wheat-gold fields
    {
      const S = 190, X = u => 400*(0.5*u + 0.5*u*u*u);
      const verts = (S+1)*(S+1), px = new Float32Array(verts), py = new Float32Array(verts), pz = new Float32Array(verts), pd = new Float32Array(verts);
      for (let j=0;j<=S;j++) for (let i=0;i<=S;i++){
        const v = j*(S+1)+i, x = X(i/S*2-1), z = X(j/S*2-1), n = track.nearest(x,z);
        let y = track.groundY(x,z,W.hills);
        const open = FKS.smooth(track.width/2+3, track.width/2+10, n.d);
        y += (FKS.noise3(x*0.7,3,z*0.7))*0.2*open - 0.09*(1-FKS.smooth(track.width/2-0.5, track.width/2+1.5, n.d));
        px[v]=x; py[v]=y; pz[v]=z; pd[v]=n.d;
      }
      const tris = S*S*2, pos = new Float32Array(tris*9), colr = new Float32Array(tris*9), r = rnd(4242);
      let o = 0;
      const tri = (a,b,c)=>{
        for (const q of [a,b,c]){ pos[o++]=px[q]; pos[o++]=py[q]; pos[o++]=pz[q]; }
        const cx=(px[a]+px[b]+px[c])/3, cz=(pz[a]+pz[b]+pz[c])/3, d=(pd[a]+pd[b]+pd[c])/3;
        const n1 = FKS.noise3(cx*0.022,2,cz*0.022), n2 = FKS.noise3(cx*0.07,5,cz*0.07);
        let hex = n1 > 0.28 ? PALETTE.wheat[0] : n1 > 0.0 ? PALETTE.wheat[1] : n1 > -0.28 ? PALETTE.wheat[3] : PALETTE.wheat[2];
        if (n2 > 0.45 && n1 < -0.1) hex = PALETTE.sage;
        _c.setHex(hex);
        const dust = 1 - FKS.smooth(track.width/2+0.5, track.width/2+3.5, d);
        if (dust > 0) _c.lerp(new THREE.Color(PALETTE.dust), dust*0.95);
        _c.getHSL(_hsl);
        _c.setHSL(_hsl.h + (r()-0.5)*0.015, _hsl.s, clamp(_hsl.l*(1+(r()*2-1)*0.1 + n2*0.05),0,1));
        for (let k=0;k<3;k++){ colr[o-9+k*3]=_c.r; colr[o-9+k*3+1]=_c.g; colr[o-9+k*3+2]=_c.b; }
      };
      for (let j=0;j<S;j++) for (let i=0;i<S;i++){
        const a=j*(S+1)+i, b=a+1, c=a+S+1, e=c+1;
        tri(a,c,b); tri(b,c,e);
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(pos,3)); gg.setAttribute('color', new THREE.BufferAttribute(colr,3)); gg.computeVertexNormals();
      addMesh(gg, std, false, true);
    }
    const gy = (x,z)=> track.groundY(x,z,W.hills);

    // ---------------- road: terracotta packed dirt with a slight crown, darker ruts, sandy shoulders
    {
      const rg = track.ribbon(track.width, 0.03, { uvScale: track.width, across: 8, crown: 0.07 });
      const road = fp(rg, ()=>0, 0, 1);  // placeholder replaced below
      const uv = road.attributes.uv, col = road.attributes.color, r = rnd(77);
      for (let i=0;i+2<uv.count;i+=3){
        const v = (uv.getX(i)+uv.getX(i+1)+uv.getX(i+2))/3, j = Math.floor(v*8);
        const hex = (j===2||j===5) ? 0xa84f30 : (j===0||j===7) ? 0xd48c5a : (j===3||j===4) ? 0xc8683f : 0xbc5e38;
        _c.setHex(hex).getHSL(_hsl); _c.setHSL(_hsl.h+(r()-0.5)*0.014, _hsl.s, clamp(_hsl.l*(1+(r()*2-1)*0.09),0,1));
        for (let k=0;k<3;k++) col.setXYZ(i+k,_c.r,_c.g,_c.b);
      }
      addMesh(road, std, false, true);
      for (const sgn of [-1,1]){
        const sh = fp(track.ribbon(1.6, 0.015, { offset: sgn*(track.width/2+0.75), uvScale: 2, across: 2 }), 0xc8784a, 0.1, 5+sgn);
        addMesh(sh, std, false, true);
      }
    }
    // ---------------- start line (checker) + boost pads (raised chevrons)
    {
      const cg = fp(track.ribbon(track.width, 0.04, { u0: 0, u1: 6/track.N, uvScale: 1, across: 10 }), 0xffffff, 0, 1);
      const cc = cg.attributes.color;
      for (let t=0;t<cc.count/3;t++){
        // non-indexed triangles come in quad pairs in ribbon order: quad q = floor(t/2), segment i, column j
        const q = Math.floor(t/2), i = Math.floor(q/10), j = q%10, dark = (Math.floor(i/2)+j)%2;
        _c.setHex(dark ? 0x2a2038 : 0xfff0d6);
        for (let k=0;k<3;k++) cc.setXYZ(t*3+k,_c.r,_c.g,_c.b);
      }
      addMesh(cg, new THREE.MeshBasicMaterial({ vertexColors:true }), false, false);
    }
    const chevShape = new THREE.Shape(); [[-1.4,0.5],[0,-0.5],[1.4,0.5],[1.4,1.15],[0,0.15],[-1.4,1.15]].forEach((p,i)=> i ? chevShape.lineTo(p[0],p[1]) : chevShape.moveTo(p[0],p[1]));
    const padMat = new THREE.MeshBasicMaterial({ vertexColors:true });
    track.boostPads.forEach((pu, pi)=>{
      const base = fp(track.ribbon(3.8, 0.05, { u0: pu, u1: pu + 6.5/track.length, uvScale: 3.8, across: 4, crown: 0.07 }), 0xe85a28, 0.1, 200+pi);
      addMesh(base, padMat, false, false);
      const parts = [];
      for (let c=0;c<3;c++){
        const f = track.at(pu + (1.2 + c*1.9)/track.length), up = f.tan.clone().cross(f.side).normalize();
        const g = new THREE.ExtrudeGeometry(chevShape, { depth:0.06, bevelEnabled:false }); g.rotateX(-PI/2);
        const m = new THREE.Matrix4().makeBasis(f.side, up, f.tan); m.setPosition(f.p.x+up.x*0.14, f.p.y+0.13, f.p.z+up.z*0.14);
        g.applyMatrix4(m); parts.push(fp(g, 0xffd84a, 0.1, 210+c+pi*3));
      }
      addMesh(merge(parts), padMat, false, false);
    });

    // ---------------- props merged into a few big meshes
    const bag = [];
    const addTo = (list, geo, x, y, z, ry, s)=>{ geo.applyMatrix4(mat4(x,y,z,0,ry||0,0,s||1)); list.push(geo); };
    const farFromLandmarks = (x,z)=> Math.hypot(x-72,z+4) > 18 && Math.hypot(x+78,z+34) > 12;

    // pines and poplars
    const trees = FKS.scatter(track, 110, 11, track.width/2 + 6, 1e9, 170).filter(t=>farFromLandmarks(t.x,t.z));
    trees.forEach((t, i)=>{
      const y = gy(t.x,t.z) - 0.1, s = 0.9 + t.r*0.9, rr = rnd(1000+i), parts = [];
      if (t.r2 < 0.62){
        parts.push(fp(new THREE.CylinderGeometry(0.16,0.25,1.4,5).translate(0,0.7,0), 0x5b3b2c, 0.1, i));
        const tiers = 4 + (rr()*2|0);
        for (let q=0;q<tiers;q++){
          const rad = 1.9 - q*0.3, h = 2.1, g = new THREE.ConeGeometry(rad, h, 6, 1).translate(0,h/2,0);
          g.rotateY(rr()*6); const f = G.facet(g, 0.22, i*7+q);
          parts.push(put(fp(f, PALETTE.pine[(rr()*3)|0], 0.15, i*11+q), 0, 1.15 + q*1.05, 0));
        }
      } else {
        parts.push(fp(new THREE.CylinderGeometry(0.12,0.2,1.8,5).translate(0,0.9,0), 0x6b4a36, 0.1, i));
        parts.push(put(fp(ico(1,1,0.95,3.4,0.95,0.2,i), PALETTE.gold[(rr()*4)|0], 0.16, i*3), 0, 4.6, 0));
        parts.push(put(fp(ico(1,0,0.7,1.7,0.7,0.12,i+1), PALETTE.gold[(rr()*4)|0], 0.16, i*3+1), 0.1, 3.1, 0.15));
      }
      const g = merge(parts); addTo(bag, g, t.x, y, t.z, t.r3*6.28, s);
    });
    // bushes along the fence line
    const bushes = FKS.scatter(track, 60, 13, track.width/2 + 3.4, 14, 120);
    bushes.forEach((b,i)=>{
      const c = [0x8c8a3a, 0xc0762f, 0x9a5a34, 0x6f7a3a][(b.r*4)|0], s = 0.7 + b.r2*0.9;
      addTo(bag, fp(ico(0.8,1,1.2,0.75,1,0.12,i), c, 0.16, 300+i), b.x, gy(b.x,b.z)+0.25*s, b.z, b.r3*6, s);
    });
    // rocks on the shoulders
    FKS.scatter(track, 70, 17, track.width/2 + 1.6, 9, 110).forEach((b,i)=>{
      const s = 0.3 + b.r2*0.7;
      addTo(bag, fp(G.facet(new THREE.DodecahedronGeometry(0.6,0).scale(1.2,0.7,1), 0.12, i), [0x8a6a78,0x9a7a80,0x7a5a6c][(b.r*3)|0], 0.14, 400+i), b.x, gy(b.x,b.z)+0.12*s, b.z, b.r3*6, s);
    });
    // wheat clumps
    const wheat = FKS.scatter(track, 280, 21, track.width/2 + 2.4, 42, 110);
    wheat.forEach((w,i)=>{
      const rr = rnd(2000+i), parts = [], x0 = w.x, z0 = w.z;
      for (let q=0;q<5;q++){
        const a = rr()*6.28, off = rr()*0.28, h = 0.9 + rr()*0.5, lean = (rr()-0.5)*0.35;
        const stalk = fp(new THREE.ConeGeometry(0.05,h,4,1,true).translate(0,h/2,0), 0xd8b055, 0.12, i*5+q);
        const head = fp(new THREE.ConeGeometry(0.075,0.34,4).translate(0,h+0.12,0), 0xe8a838, 0.18, i*5+q+99);
        const m = mat4(Math.cos(a)*off, 0, Math.sin(a)*off, lean, 0, lean*0.7);
        stalk.applyMatrix4(m); head.applyMatrix4(m); parts.push(stalk, head);
      }
      addTo(bag, merge(parts), x0, gy(x0,z0)-0.05, z0, w.r3*6, 0.8 + w.r*0.7);
    });
    // pumpkin patches
    FKS.scatter(track, 7, 29, track.width/2 + 6, 22, 100).forEach((c,ci)=>{
      const rr = rnd(3000+ci);
      for (let q=0;q<9;q++){
        const a = rr()*6.28, d = rr()*3.4, x = c.x + Math.cos(a)*d, z = c.z + Math.sin(a)*d, rad = 0.4 + rr()*0.35;
        addTo(bag, pumpkin(rad, ci*20+q), x, gy(x,z)+rad*0.62, z, rr()*6);
      }
    });
    // round hay bales
    FKS.scatter(track, 18, 33, track.width/2 + 5, 38, 110).forEach((b,i)=>{
      const g = fp(G.facet(new THREE.CylinderGeometry(0.9,0.9,1.3,8).rotateZ(PI/2), 0.05, i), (cx,cy,cz,nx)=> Math.abs(nx) > 0.8 ? 0xc99a3a : 0xe8c060, 0.12, 500+i);
      addTo(bag, g, b.x, gy(b.x,b.z)+0.85, b.z, b.r3*6);
    });
    // wooden fence (posts + two rails) beside the road
    {
      const step = 4.2, n = Math.floor(track.length/step), posts = [], rails = [];
      for (const sgn of [-1,1]){
        let prev = null;
        for (let i=0;i<=n;i++){
          const f = track.at(i/n), p = f.p.clone().addScaledVector(f.side, sgn*(track.width/2 + 2.6)); p.y = gy(p.x,p.z);
          if (track.nearest(p.x,p.z).d < track.width/2 + 2.0){ prev = null; continue; }
          posts.push(p); if (prev && prev.distanceTo(p) < step*1.6) rails.push([prev,p]); prev = p;
        }
      }
      posts.forEach((p,i)=>{
        const post = fp(new THREE.BoxGeometry(0.15,1.1,0.15).translate(0,0.55,0), PALETTE.wood, 0.14, 600+i);
        const tip = fp(new THREE.ConeGeometry(0.11,0.18,4).rotateY(PI/4).translate(0,1.19,0), PALETTE.rail, 0.14, 700+i);
        addTo(bag, merge([post, tip]), p.x, p.y-0.05, p.z, (i*1.7)%0.4-0.2);
      });
      const q = new THREE.Quaternion();
      rails.forEach(([a,b],i)=>{
        const d = b.clone().sub(a), mid = a.clone().add(b).multiplyScalar(0.5);
        q.setFromUnitVectors(V3(1,0,0), d.clone().normalize());
        for (const hgt of [0.5, 0.88]){
          const g = fp(new THREE.BoxGeometry(1,0.11,0.06), PALETTE.rail, 0.14, 800+i*2+(hgt>0.6));
          g.applyMatrix4(tm.compose(mid.clone().add(V3(0,hgt,0)), q, V3(d.length(),1,1))); bag.push(g);
        }
      });
    }
    // bunting: tall poles every ~24m with triangular flags on drooping strings, plus a start gantry
    {
      const gap = 24, nn = Math.floor(track.length/gap), flagParts = [], lineParts = [];
      const poleTop = (u, sgn)=>{ const f = track.at(u), p = f.p.clone().addScaledVector(f.side, sgn*(track.width/2+1.7)); p.y = gy(p.x,p.z); return p; };
      const bunting = (a, b, seed)=>{
        const rr = rnd(seed), cnt = 9, dir = b.clone().sub(a), len = dir.length(); dir.normalize();
        let prevP = null;
        for (let k=0;k<=cnt+1;k++){
          const t = k/(cnt+1), sag = 4*t*(1-t)*Math.min(1.3, len*0.06), P = a.clone().lerp(b,t); P.y -= sag;
          if (prevP) lineParts.push(lineSeg(prevP, P));
          prevP = P;
          if (k>0 && k<=cnt){
            const hex = PALETTE.flags[(k+((rr()*3)|0))%6], hw = 0.24;
            const A = P.clone().addScaledVector(dir,-hw), Bq = P.clone().addScaledVector(dir,hw), C = P.clone().add(V3(0,-0.6,0)).addScaledVector(dir,(rr()-0.5)*0.06);
            for (const flip of [false,true]){
              const g = new THREE.BufferGeometry(); const pts = flip ? [Bq,A,C] : [A,Bq,C];
              g.setAttribute('position', new THREE.Float32BufferAttribute([].concat(...pts.map(v=>[v.x,v.y,v.z])),3)); flagParts.push(fp(g, hex, 0.08, seed*13+k));
            }
          }
        }
      };
      const lineSeg = (a,b)=>{ const d=b.clone().sub(a), m=a.clone().add(b).multiplyScalar(0.5), q=new THREE.Quaternion().setFromUnitVectors(V3(1,0,0), d.clone().normalize());
        const g = fp(new THREE.BoxGeometry(1,0.02,0.02), 0x3a2a48, 0.05, 1); g.applyMatrix4(tm.compose(m,q,V3(d.length(),1,1))); return g; };
      for (const sgn of [-1,1]){
        const tops = [];
        for (let i=0;i<nn;i++){
          const u = i/nn + 0.013, p = poleTop(u, sgn);
          if (track.nearest(p.x,p.z).d < track.width/2 + 1.2) { tops.push(null); continue; }
          addTo(bag, merge([fp(new THREE.CylinderGeometry(0.07,0.11,3.8,6).translate(0,1.9,0), 0x6b4a36, 0.12, 900+i), fp(new THREE.ConeGeometry(0.14,0.3,6).translate(0,3.95,0), 0xe8553a, 0.1, 901+i)]), p.x, p.y-0.05, p.z, 0);
          tops.push(p.clone().add(V3(0,3.7,0)));
        }
        for (let i=0;i<nn;i++){ const a = tops[i], b = tops[(i+1)%nn]; if (a && b && a.distanceTo(b) < gap*1.5) bunting(a,b,40+i+(sgn>0?100:0)); }
      }
      // start gantry
      const f = track.at(0), off = track.width/2+1.3, base = f.p.clone(), up = V3(0,1,0), basis = new THREE.Matrix4().makeBasis(f.side, up, f.tan);
      basis.setPosition(base.x, base.y, base.z);
      const gant = [];
      for (const sx of [-1,1]) gant.push(fp(new THREE.CylinderGeometry(0.18,0.26,6,6).translate(sx*off,3,0), 0x5a3a52, 0.1, 950+sx));
      gant.push(fp(new THREE.BoxGeometry(off*2+0.8,0.4,0.4).translate(0,6.1,0), 0xe8553a, 0.1, 953));
      for (let c=0;c<12;c++) for (let rw=0;rw<2;rw++) gant.push(fp(new THREE.BoxGeometry((off*2)/12-0.02,0.4,0.1).translate(-off+(c+0.5)*(off*2/12),5.5-rw*0.4,0.0), (c+rw)%2 ? 0x2a2038 : 0xfff0d6, 0.04, 960+c*2+rw));
      gant.forEach(g=>{ g.applyMatrix4(basis); bag.push(g); });
      const topA = V3(-off,6.0,0).applyMatrix4(basis), topB = V3(off,6.0,0).applyMatrix4(basis);
      bunting(topA.clone().add(V3(0,0.4,0)), topB.clone().add(V3(0,0.4,0)), 777);
      bag.push(merge(flagParts), merge(lineParts));
    }
    // red barn + silo, and a water tower
    const landmark = (x, z, faceY, build)=>{
      const parts = []; build(parts);
      const m = mat4(x, gy(x,z)-0.35, z, 0, Math.atan2(-x,-z)+faceY, 0, 1);
      parts.forEach(g=>{ g.applyMatrix4(m); bag.push(g); });
    };
    landmark(72, -4, 0, P=>{
      const wall = (hex,s)=> (cx,cy,cz,nx,ny,nz)=> hex;
      P.push(fp(new THREE.BoxGeometry(10,5,8).translate(0,2.5,0), PALETTE.barn, 0.1, 1100));
      const gb = new THREE.CylinderGeometry(2.5,2.5,8,3).rotateX(-PI/2); gb.scale(2.3,1,1); gb.translate(0,6.25,0);
      P.push(fp(gb, 0xa83e2c, 0.1, 1101));
      for (const sx of [-1,1]) P.push(fp(new THREE.BoxGeometry(6.6,0.28,9.2), PALETTE.plum, 0.12, 1102+sx).rotateZ(-sx*0.644).translate(sx*2.55,6.92+0.1,0));
      P.push(fp(new THREE.BoxGeometry(3.2,3.6,0.2).translate(0,1.8,4.08), 0xf2e2c4, 0.06, 1104));
      for (const sg of [-1,1]) P.push(fp(new THREE.BoxGeometry(0.22,4.2,0.12).rotateZ(sg*0.82).translate(0,1.8,4.2), 0x8a3a2a, 0.08, 1105+sg));
      P.push(fp(new THREE.BoxGeometry(1.5,1.4,0.2).translate(0,6.0,4.08), 0xf2e2c4, 0.06, 1107));
      // silo
      P.push(fp(new THREE.CylinderGeometry(1.8,1.8,11,8).translate(8.5,5.5,-1), (cx,cy)=> cy > 7 ? 0xb8b0c0 : 0xcfc6c8, 0.1, 1108));
      P.push(fp(new THREE.ConeGeometry(2.0,2.4,8).translate(8.5,12.2,-1), 0xc4503a, 0.1, 1109));
      // haystacks
      P.push(fp(new THREE.ConeGeometry(1.6,2.6,7).translate(-9,1.3,2), 0xdca94a, 0.14, 1110));
      P.push(fp(new THREE.ConeGeometry(1.3,2.1,7).translate(-11.5,1.05,0), 0xd09a40, 0.14, 1111));
    });
    landmark(-78, -34, 0, P=>{
      const wood = 0x5a3a2c, legs = [[-2,-2],[2,-2],[2,2],[-2,2]];
      legs.forEach(([lx,lz],i)=> P.push(frus(V3(lx*1.35,0,lz*1.35), V3(lx,11,lz), 0.28,0.22,5,wood,0.12,1200+i)));
      for (const hy of [3.5,7]) for (let i=0;i<4;i++){
        const a = legs[i], b = legs[(i+1)%4], s = 1.35 - hy/11*0.35 + 0.0;
        P.push(frus(V3(a[0]*s,hy,a[1]*s), V3(b[0]*s,hy,b[1]*s), 0.1,0.1,4,wood,0.12,1210+i+hy));
        P.push(frus(V3(a[0]*s,hy,a[1]*s), V3(b[0]*s,hy+3.2,b[1]*s), 0.07,0.07,4,wood,0.12,1220+i+hy));
      }
      P.push(fp(new THREE.CylinderGeometry(3.2,3.2,3.8,8).translate(0,13,0), (cx,cy)=> Math.abs(cy-13) < 0.6 ? 0xf2e2c4 : 0xc55a3a, 0.1, 1230));
      P.push(fp(new THREE.CylinderGeometry(3.2,2.4,0.8,8).translate(0,10.7,0), 0x9a4a34, 0.1, 1231));
      P.push(fp(new THREE.ConeGeometry(3.7,2.6,8).translate(0,16.3,0), PALETTE.plum, 0.12, 1232));
      P.push(frus(V3(0,17.5,0), V3(0,19.2,0), 0.05,0.05,4,0x2a2038,0.05,1233));
    });
    // flat prop meshes cast shadows; chunk the big merge so a single mesh isn't one 40k-tri bounding sphere
    {
      const chunk = 400, total = bag.length;
      for (let i=0;i<total;i+=chunk) addMesh(merge(bag.slice(i, i+chunk)), std, true, true);
    }

    // ---------------- distant faceted mountains and mesas in layered atmospheric tones
    {
      const layers = [ { r:345, n:30, h:[22,40], c:0xc2809e }, { r:300, n:28, h:[26,46], c:0xa06c98 }, { r:258, n:26, h:[28,52], c:0x7a5a94 }, { r:218, n:24, h:[24,48], c:0x56467e } ];
      const sunAz = Math.atan2(SUN_DIR.z, SUN_DIR.x), parts = [];
      const rr = rnd(555);
      layers.forEach((L,li)=>{
        for (let i=0;i<L.n;i++){
          const a = (i + rr()*0.8)/L.n*PI*2, bw = 22 + rr()*30, mesa = rr() < 0.3;
          let h = L.h[0] + rr()*(L.h[1]-L.h[0]);
          let da = Math.abs(((a - sunAz + PI*3) % (PI*2)) - PI); // angular distance from sun azimuth (0 = toward sun)
          da = PI - da; if (da < 0.45) h *= 0.5 + da/0.9;
          const g = mesa ? new THREE.CylinderGeometry(bw*0.4, bw, h, 6, 2) : new THREE.ConeGeometry(bw, h, 5 + (rr()*3|0), 3);
          g.translate(0, h/2, 0); g.rotateY(rr()*6);
          const f = G.facet(g, bw*0.22, li*100+i);
          f.applyMatrix4(mat4(Math.cos(a)*(L.r + (rr()-0.5)*16), -8, Math.sin(a)*(L.r + (rr()-0.5)*16), 0, 0, 0, 1, 1 + (rr()-0.5)*0.3, 1.4));
          parts.push(fp(f, L.c, 0.13, li*200+i));
        }
      });
      const ring = new THREE.Mesh(merge(parts), std); ring.castShadow = false; ring.receiveShadow = false; scene.add(ring);
    }

    // ---------------- faceted clouds in pinks and oranges (baked shading, unlit)
    const clouds = new THREE.Group(); scene.add(clouds);
    {
      const cr = rnd(9), cmat = new THREE.MeshBasicMaterial({ vertexColors:true, fog:false });
      const cols = [0xffb8a0, 0xffcf9c, 0xf58f7c, 0xe99ab8, 0xffd9b0];
      const shade = (nx,ny,nz)=> 0.72 + 0.4*Math.max(-0.3, nx*SUN_DIR.x + ny*SUN_DIR.y + nz*SUN_DIR.z) + (ny < -0.5 ? -0.08 : 0);
      for (let i=0;i<22;i++){
        const strata = i > 14, n = strata ? 3 : 3 + (cr()*3|0), parts = [], base = cols[(cr()*5)|0];
        for (let j=0;j<n;j++){
          const s = strata ? 18 + cr()*14 : 7 + cr()*7;
          const g = ico(1, 0, s*(strata?2.4:1), s*(strata?0.12:0.32), s*(strata?0.5:0.7), s*0.1, i*10+j);
          g.applyMatrix4(mat4((j-n/2)*s*(strata?1.8:1.1) + cr()*3, cr()*(strata?2:4), cr()*5, 0, cr()*0.3));
          parts.push(fp(g, base, 0.1, i*30+j, shade));
        }
        const m = new THREE.Mesh(merge(parts), cmat); m.castShadow = false; m.receiveShadow = false;
        const a = cr()*PI*2, r = strata ? 300 + cr()*60 : 150 + cr()*150;
        m.position.set(Math.cos(a)*r, strata ? 26 + cr()*18 : 48 + cr()*60, Math.sin(a)*r); m.rotation.y = -a + PI/2;
        clouds.add(m);
      }
    }
    W.update = (dt)=>{ clouds.rotation.y += dt*0.003; };
    return W;
  }

  // ------------------------------------------------------------------ puffs: faceted dust and flame shards
  function makePuff(){
    const dust = fp(ico(0.13,0,1,0.9,1,0.03,21), 0xffffff, 0.14, 300);
    const rr = rnd(66), shards = [];
    for (let i=0;i<6;i++){
      const dir = V3(rr()-0.5, rr()-0.5, rr()-0.5).normalize(), len = 0.3 + rr()*0.22, side = V3(0,1,0).cross(dir); if (side.lengthSq() < 0.01) side.set(1,0,0); side.normalize();
      const up = dir.clone().cross(side).normalize(), w = 0.07;
      shards.push(tetra(dir.clone().multiplyScalar(0.06).addScaledVector(side,w), dir.clone().multiplyScalar(0.06).addScaledVector(side,-w), dir.clone().multiplyScalar(0.06).addScaledVector(up,w), dir.clone().multiplyScalar(len), [0xffe45a,0xffb02e,0xff7a1c][i%3], 0.12, 400+i));
    }
    const dg = merge([dust]), sg = merge(shards), geo = new THREE.BufferGeometry();
    for (const a of ['position','normal','uv','color']){
      const A = dg.attributes[a].array, B = sg.attributes[a].array, out = new Float32Array(A.length + B.length);
      out.set(A,0); out.set(B,A.length); geo.setAttribute(a, new THREE.BufferAttribute(out, dg.attributes[a].itemSize));
    }
    geo.addGroup(0, dg.attributes.position.count, 0); geo.addGroup(dg.attributes.position.count, sg.attributes.position.count, 1);
    const m = new THREE.Mesh(geo, [ stdMat({ color:0xd8b8a8, roughness:1 }), new THREE.MeshBasicMaterial({ vertexColors:true }) ]);
    m.castShadow = false; m.userData.seed = Math.random()*6.28; return m;
  }
  function animPuff(m, a, boost){
    const mats = m.material;
    mats[0].visible = !boost; mats[1].visible = !!boost;
    const sd = m.userData.seed;
    m.rotation.set(a*4 + sd, a*5 + sd*0.7, a*3);
    if (boost){
      const s = (0.9 + a*0.7) * (1 - a*a);
      m.scale.setScalar(Math.max(0.01, s * 1.4));
      mats[1].color.setHex(a < 0.45 ? 0xffffff : 0xff9a70);
    } else {
      const s = (0.55 + Math.sin(Math.min(1,a*1.4)*PI*0.5)*1.0) * (a > 0.65 ? (1-a)/0.35 : 1);
      m.scale.setScalar(Math.max(0.01, s));
      mats[0].color.setHex(a < 0.3 ? 0xd9a890 : 0xb08a86);
    }
  }

  FKS.styles.lowpoly = {
    id:'lowpoly', name:'Golden-Hour Low-Poly',
    blurb:'Flat-shaded facets with a different tint on every triangle, no outlines. A low sun throws long shadows over wheat fields, dirt road, pines and a faceted dusk sky.',
    fov: 58, toneMapping: THREE.ACESFilmicToneMapping, exposure: 0.85, shadowType: THREE.PCFSoftShadowMap,
    buildWorld, buildKart, buildRacer, makePuff, animPuff,
  };
})();
