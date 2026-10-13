// Style 1 — STORYBOOK TOON. Cel-shaded three-band ramp, ink outlines (inverted hull, skinned on the
// racer), chibi proportions, saturated Saturday-morning palette, puffy outlined clouds.
(function(){
  'use strict';
  const G = FKS.geo, V3 = (x,y,z)=>new THREE.Vector3(x,y,z), J = FKS.joint;
  const INK = 0x2b1a12;
  let RAMP = null;
  const ramp = () => RAMP || (RAMP = FKS.toonRamp([0.42, 0.72, 1.0]));
  const toon = (color, extra) => new THREE.MeshToonMaterial(Object.assign({ color, gradientMap: ramp() }, extra||{}));
  function mesh(geo, mat, outline, parent){
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
    if (outline !== 0) FKS.addOutline(m, INK, outline == null ? 0.022 : outline);
    if (parent) parent.add(m); return m;
  }

  // ------------------------------------------------------------------ kart
  function buildKart(color){
    const k = FKS.newKart(), B = k.body;
    const paint = toon(color), cream = toon(0xfff1d0), dark = toon(0x3a3340), chrome = toon(0xd9dde6),
          hay = toon(0xf2c74a), strap = toon(0x8a4b22), lamp = toon(0xfff59a, { emissive:0x554400 }), tireM = toon(0x34303a), hub = toon(0xffd34d);
    k.paint.push(paint);
    // tub + nose: soft bubbly shapes
    mesh(G.roundedBox(1.16, 0.40, 1.80, 0.16, 4), paint, null, B).position.set(0, 0.52, -0.06);
    mesh(G.roundedBox(0.92, 0.38, 0.78, 0.17, 4), paint, null, B).position.set(0, 0.62, 0.84);
    // cartoon "face": big headlight eyes + a cream bumper smile
    for (const sx of [-1,1]){
      const e = mesh(G.blob(0.12,0.12,0.06,18,12), lamp, 0.016, B); e.position.set(sx*0.24, 0.80, 1.18);
      const hl = mesh(G.blob(0.035,0.035,0.02,10,8), toon(0xffffff), 0, B); hl.position.set(sx*0.24+0.035, 0.84, 1.235);
    }
    const smile = mesh(new THREE.TorusGeometry(0.5, 0.075, 10, 28, Math.PI*0.62), cream, null, B);
    smile.rotation.set(Math.PI/2, 0, Math.PI + Math.PI*0.19); smile.position.set(0, 0.36, 0.78);
    // side pods over the front wheels + chunky rear fenders
    for (const sx of [-1,1]){
      mesh(G.roundedBox(0.30, 0.14, 0.62, 0.06, 3), paint, null, B).position.set(sx*0.64, 0.62, 0.78);
      mesh(G.roundedBox(0.36, 0.14, 0.72, 0.06, 3), paint, null, B).position.set(sx*0.66, 0.78, -0.72);
      mesh(G.roundedBox(0.08, 0.10, 1.10, 0.04, 2), cream, 0.014, B).position.set(sx*0.585, 0.52, 0.05);
    }
    // seat + dash
    mesh(G.roundedBox(0.52, 0.12, 0.46, 0.05, 3), dark, null, B).position.set(0, 0.80, -0.10);
    mesh(G.roundedBox(0.54, 0.56, 0.14, 0.07, 3), cream, null, B).position.set(0, 1.04, -0.36);
    mesh(G.roundedBox(0.78, 0.16, 0.26, 0.07, 3), dark, null, B).position.set(0, 0.92, 0.46);
    // hay bale in the back with straps
    mesh(G.roundedBox(0.86, 0.40, 0.46, 0.08, 3), hay, null, B).position.set(0, 0.86, -0.82);
    for (const sx of [-0.22, 0.22]) mesh(G.roundedBox(0.06, 0.42, 0.48, 0.02, 2), strap, 0, B).position.set(sx, 0.865, -0.82);
    // exhaust stacks
    for (const sx of [-1,1]){
      const pipe = mesh(G.taperTube([V3(sx*0.40,0.60,-0.95), V3(sx*0.44,0.80,-1.10), V3(sx*0.46,1.04,-1.16)], 0.05, 0.075, 12, 10), chrome, 0.016, B);
      k.addExhaust(sx*0.46, 1.08, -1.16);
    }
    // whip antenna + pennant flag (flair: sways with speed + steer)
    const ant = new THREE.Group(); ant.position.set(-0.40, 1.05, -1.0); k.chassis.add(ant);
    mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.9, 6).translate(0, 0.45, 0), dark, 0.01, ant);
    const flag = new THREE.Group(); flag.position.y = 0.86; ant.add(flag);
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0,-0.18,0, 0,-0.09,-0.32], 3)); fg.computeVertexNormals();
    const fm = new THREE.Mesh(fg, toon(0xffd34d, { side: THREE.DoubleSide })); flag.add(fm);
    k.flair.push((dt, s)=>{ const sp = Math.min(1, Math.abs(s.speed||0)/20); ant.rotation.x = -0.25*sp + Math.sin((s.t||0)*9)*0.05*sp; ant.rotation.z = (s.steer||0)*0.2*sp; flag.rotation.y = Math.sin((s.t||0)*14)*0.35*(0.3+sp); });
    // steering wheel + column
    const col = mesh(new THREE.CylinderGeometry(0.03,0.03,0.42,8), dark, 0.012, k.chassis);
    col.position.set(0, 1.07, 0.30); col.rotation.x = -0.9;
    const sw = new THREE.Group();
    mesh(new THREE.TorusGeometry(0.17, 0.032, 10, 24), toon(0x3a3340), 0.012, sw);
    for (let i=0;i<3;i++){ const sp = mesh(G.roundedBox(0.03, 0.17, 0.02, 0.01, 1), chrome, 0, sw); sp.geometry.translate(0, 0.085, 0); sp.rotation.z = i*Math.PI*2/3 + Math.PI; }
    mesh(G.blob(0.05,0.05,0.03,12,8), toon(0xe5392f), 0.01, sw);
    k.setSteeringWheel(V3(0, 1.25, 0.16), 0.55, 0.17, sw);
    // wheels: fat cartoon tires, cream hubcaps, big bolts so the spin reads
    const mkWheel = (r, w) => {
      const g = new THREE.Group();
      mesh(G.tire(r, w, r*0.35, 28, r*0.2), tireM, 0.02, g);
      for (const sx of [-1,1]){
        const cap = mesh(new THREE.CylinderGeometry(r*0.5, r*0.55, 0.04, 16).rotateZ(Math.PI/2), hub, 0.012, g); cap.position.x = sx*w*0.5;
        for (let b=0;b<3;b++){ const a = b*Math.PI*2/3; const bolt = mesh(G.blob(0.028,0.028,0.028,8,6), toon(0xe5392f), 0, g); bolt.position.set(sx*(w*0.5+0.02), Math.cos(a)*r*0.28, Math.sin(a)*r*0.28); }
      }
      return g;
    };
    k.addWheel( 0.64, 0.28, 0.80, 0.28, true,  mkWheel(0.28, 0.24));
    k.addWheel(-0.64, 0.28, 0.80, 0.28, true,  mkWheel(0.28, 0.24));
    k.addWheel( 0.68, 0.36,-0.72, 0.36, false, mkWheel(0.36, 0.34));
    k.addWheel(-0.68, 0.36,-0.72, 0.36, false, mkWheel(0.36, 0.34));
    k.setColor = (hex)=>{ paint.color.setHex(hex); };
    return k;
  }

  // ------------------------------------------------------------------ racer (chibi Bucky, skinned)
  function buildRacer(){
    const sk = FKS.skinBuilder();
    const H = J('head');
    // big chibi head + snout + nose
    sk.rigid(G.blob(0.21, 0.19, 0.20, 28, 20).translate(H.x, H.y+0.13, H.z+0.02), 'fur', 'head');
    sk.rigid(G.blob(0.12, 0.095, 0.12, 20, 14).translate(0, H.y+0.07, H.z+0.17), 'cream', 'head');
    sk.rigid(G.blob(0.05, 0.03, 0.03, 12, 8).translate(0, H.y+0.11, H.z+0.285), 'nose', 'head');
    // smile
    const sm = new THREE.TorusGeometry(0.045, 0.008, 6, 14, Math.PI*0.8); sm.rotateZ(Math.PI + Math.PI*0.1); sm.translate(0, H.y+0.06, H.z+0.285);
    sk.rigid(sm, 'nose', 'head');
    // eyes: tall cartoon whites, pupils looking ahead, a catch-light each
    for (const sx of [-1,1]){
      sk.rigid(G.blob(0.058, 0.072, 0.03, 16, 12).translate(sx*0.088, H.y+0.17, H.z+0.195), 'eyeW', 'head');
      sk.rigid(G.blob(0.032, 0.045, 0.02, 12, 10).translate(sx*0.084, H.y+0.165, H.z+0.218), 'eye', 'head');
      sk.rigid(G.blob(0.012, 0.014, 0.008, 8, 6).translate(sx*0.074, H.y+0.185, H.z+0.234), 'eyeW', 'head');
      // brows
      sk.rigid(G.roundedBox(0.07, 0.016, 0.02, 0.007, 1).rotateZ(-sx*0.25).translate(sx*0.09, H.y+0.265, H.z+0.17), 'nose', 'head');
      // curled horns sweeping back
      sk.rigid(G.taperTube([V3(sx*0.08,H.y+0.27,H.z-0.02), V3(sx*0.12,H.y+0.35,H.z-0.08), V3(sx*0.15,H.y+0.34,H.z-0.18), V3(sx*0.17,H.y+0.27,H.z-0.20)], 0.04, 0.012, 10, 14), 'horn', 'head');
      // floppy ears on their own bones
      const E = J(sx>0?'ear_L':'ear_R');
      sk.rigid(G.blob(0.12, 0.035, 0.06, 16, 10).rotateZ(-sx*0.45).translate(E.x+sx*0.09, E.y-0.04, E.z), 'fur', sx>0?'ear_L':'ear_R');
      sk.rigid(G.blob(0.08, 0.02, 0.035, 12, 8).rotateZ(-sx*0.45).translate(E.x+sx*0.09, E.y-0.03, E.z+0.03), 'pink', sx>0?'ear_L':'ear_R');
    }
    // goatee
    sk.rigid(new THREE.ConeGeometry(0.04, 0.12, 10).rotateX(Math.PI).translate(0, H.y-0.04, H.z+0.15), 'cream', 'head');
    // chef toque (Bucky's signature) — puffy top
    sk.rigid(new THREE.CylinderGeometry(0.11, 0.10, 0.10, 18).translate(0, H.y+0.33, H.z-0.02), 'shirt', 'head');
    for (let i=0;i<5;i++){ const a = i/5*Math.PI*2; sk.rigid(G.blob(0.07,0.07,0.07,12,10).translate(Math.cos(a)*0.06, H.y+0.42, H.z-0.02+Math.sin(a)*0.06), 'shirt', 'head'); }
    sk.rigid(G.blob(0.08,0.08,0.08,12,10).translate(0, H.y+0.45, H.z-0.02), 'shirt', 'head');
    // neck scarf
    sk.along(new THREE.TorusGeometry(0.1, 0.035, 8, 20).rotateX(Math.PI/2).translate(0, 0.585, 0.0), 'scarf', [[0.55,'chest'],[0.62,'neck']]);
    sk.rigid(new THREE.ConeGeometry(0.05, 0.12, 6).rotateX(Math.PI*0.6).translate(0.05, 0.56, -0.12), 'scarf', 'chest');
    // torso: chef jacket, round and short
    sk.along(G.blob(0.17, 0.25, 0.15, 24, 18).translate(0, 0.36, -0.03), 'shirt', [[0.14,'hips'],[0.30,'spine'],[0.46,'chest'],[0.6,'neck']]);
    for (let i=0;i<3;i++) sk.rigid(G.blob(0.016,0.016,0.01,8,6).translate(0.05, 0.46-i*0.08, 0.115), 'scarf', i===0?'chest':'spine');
    sk.along(G.blob(0.18, 0.09, 0.16, 20, 12).translate(0, 0.14, -0.03), 'pants', [[0.1,'hips'],[0.2,'spine']]);
    // arms: jacket sleeve upper, fur forearm, cream mitt
    for (const s of ['L','R']){
      const sx = s==='L'?1:-1;
      sk.limb(G.capsule(J('upperArm_'+s), J('foreArm_'+s), 0.06, 0.05, 14, 6), 'shirt', 'upperArm_'+s, 'foreArm_'+s, { blendParent:true });
      sk.limb(G.capsule(J('foreArm_'+s), J('hand_'+s), 0.045, 0.04, 12, 6), 'fur', 'foreArm_'+s, 'hand_'+s);
      const h = J('hand_'+s), dir = J('hand_'+s).sub(J('foreArm_'+s)).normalize();
      sk.rigid(G.blob(0.055, 0.05, 0.06, 14, 10).translate(h.x+dir.x*0.04, h.y+dir.y*0.04, h.z+dir.z*0.04), 'glove', 'hand_'+s);
      // legs: overall pants, hoof boots
      sk.limb(G.capsule(J('thigh_'+s), J('shin_'+s), 0.075, 0.06, 14, 6), 'pants', 'thigh_'+s, 'shin_'+s, { blendParent:true });
      sk.limb(G.capsule(J('shin_'+s), J('foot_'+s), 0.055, 0.05, 12, 6), 'pants', 'shin_'+s, 'foot_'+s);
      const f = J('foot_'+s);
      sk.rigid(G.blob(0.065, 0.05, 0.10, 14, 10).translate(f.x, f.y-0.01, f.z+0.05), 'hoof', 'foot_'+s);
    }
    const T = J('tail');
    sk.rigid(G.blob(0.04, 0.07, 0.04, 10, 8).rotateX(-0.6).translate(T.x, T.y+0.04, T.z-0.02), 'cream', 'tail');
    const r = sk.build({
      fur: toon(0x9a6438), cream: toon(0xf6e8c8), nose: toon(0x3a2418), eyeW: toon(0xffffff), eye: toon(0x1d1410),
      horn: toon(0xeedcb0), pink: toon(0xf3a0a8), shirt: toon(0xffffff), scarf: toon(0xe5392f), pants: toon(0x3c6fd1),
      glove: toon(0xfff1d0), hoof: toon(0x4a3426),
    }, { outline: { color: INK, thickness: 0.014 } });
    return r;
  }

  // ------------------------------------------------------------------ world
  function buildWorld(scene, track){
    const W = { hills: 5 };
    scene.fog = new THREE.Fog(0xcfeeff, 90, 330);
    const sunDir = V3(-0.45, 0.62, -0.65).normalize();
    scene.add(FKS.skyDome([[-0.2,0xbfe8ff],[0.0,0xdaf4ff],[0.18,0x8fd3ff],[0.6,0x45a2f0],[1,0x2f7fe0]], { sunDir, sunColor:0xfff8d0, sunSize:0.012, glow:0.5 }));
    scene.add(new THREE.HemisphereLight(0xe8f6ff, 0x6a9a4a, 0.42));
    const sun = new THREE.DirectionalLight(0xfff2d6, 0.78);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -24; sc.right = sc.top = 24; sc.near = 1; sc.far = 120;
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
    scene.add(sun); scene.add(sun.target);
    W.sun = sun; W.sunOffset = sunDir.clone().multiplyScalar(60);

    // ground: rolling hills, flattened under the road, toon green with mown-stripe variation
    const S = 320, seg = 140, gg = new THREE.PlaneGeometry(S, S, seg, seg); gg.rotateX(-Math.PI/2);
    const gp = gg.attributes.position, col = new Float32Array(gp.count*3), c = new THREE.Color();
    for (let i=0;i<gp.count;i++){
      const x = gp.getX(i), z = gp.getZ(i);
      gp.setY(i, track.groundY(x, z, W.hills));
      const n = FKS.noise3(x*0.05, 1, z*0.05);
      c.setHex(n > 0.15 ? 0x8ad65a : (n < -0.25 ? 0x6cbc44 : 0x7dcb4f));
      col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b;
    }
    gg.setAttribute('color', new THREE.BufferAttribute(col,3)); gg.computeVertexNormals();
    const ground = new THREE.Mesh(gg, toon(0xffffff, { vertexColors:true })); ground.receiveShadow = true; scene.add(ground);

    // road: warm packed dirt with two darker wheel ruts and pebbles
    const roadTex = FKS.canvasTex(128, 256, (x,w,h)=>{
      x.fillStyle = '#d9a46a'; x.fillRect(0,0,w,h);
      x.fillStyle = '#c48f55'; x.fillRect(w*0.2,0,w*0.13,h); x.fillRect(w*0.67,0,w*0.13,h);
      const r = FKS.rng(5); for (let i=0;i<70;i++){ x.fillStyle = r()<0.5?'#c48f58':'#f0caa0'; x.beginPath(); x.ellipse(r()*w, r()*h, 2+r()*3, 1.5+r()*2, 0, 0, 7); x.fill(); }
      x.fillStyle = '#fff6e0'; for (let y=0;y<h;y+=64) x.fillRect(w*0.48, y, w*0.04, 30);
    });
    const road = new THREE.Mesh(track.ribbon(track.width, 0.03, { uvScale: track.width, across: 4 }), toon(0xffffff, { map: roadTex }));
    road.receiveShadow = true; scene.add(road);
    // candy-stripe curbs
    const curbTex = FKS.canvasTex(8, 32, (x,w,h)=>{ x.fillStyle='#ffffff'; x.fillRect(0,0,w,h); x.fillStyle='#e5392f'; x.fillRect(0,0,w,h/2); }, { nearest:true });
    for (const sgn of [-1,1]){
      const cg = track.ribbon(0.9, 0.09, { offset: sgn*(track.width/2+0.35), uvScale: 2.4, across:1 });
      const cm = new THREE.Mesh(cg, toon(0xffffff, { map: curbTex })); cm.receiveShadow = true; scene.add(cm);
    }
    // start line (checker) + boost pads (chevrons)
    const chk = FKS.canvasTex(64, 16, (x,w,h)=>{ for (let i=0;i<8;i++) for (let j=0;j<2;j++){ x.fillStyle=(i+j)%2?'#1d1410':'#ffffff'; x.fillRect(i*8,j*8,8,8); } }, { nearest:true });
    scene.add(new THREE.Mesh(track.ribbon(track.width, 0.05, { u0: 0, u1: 1.6/track.length, uvScale: 1.6 }), new THREE.MeshBasicMaterial({ map: chk })));
    const chev = FKS.canvasTex(64, 64, (x,w,h)=>{ x.fillStyle='#ff9a1f'; x.fillRect(0,0,w,h); x.strokeStyle='#fff36a'; x.lineWidth=9; x.lineJoin='round'; for (let k=0;k<2;k++){ x.beginPath(); x.moveTo(8, 24+k*32); x.lineTo(32, 6+k*32); x.lineTo(56, 24+k*32); x.stroke(); } });
    for (const pu of track.boostPads) scene.add(new THREE.Mesh(track.ribbon(3.4, 0.05, { u0: pu, u1: pu + 6/track.length, uvScale: 3.4 }), new THREE.MeshBasicMaterial({ map: chev })));

    // fence posts + rails along the outside (instanced, outlined)
    const postG = G.roundedBox(0.16, 1.0, 0.16, 0.04, 2).translate(0, 0.5, 0), railG = G.roundedBox(1, 0.12, 0.07, 0.03, 2);
    const posts = [], rails = [];
    const step = 4.2, n = Math.floor(track.length/step);
    for (const sgn of [-1,1]){
      let prev = null;
      for (let i=0;i<=n;i++){
        const f = track.at(i/n), off = sgn*(track.width/2 + 2.6);
        const p = f.p.clone().addScaledVector(f.side, off); p.y = track.groundY(p.x, p.z, W.hills);
        if (track.nearest(p.x, p.z).d < track.width/2 + 2.0){ prev = null; continue; }
        posts.push(p);
        if (prev && prev.distanceTo(p) < step*1.6) rails.push([prev, p]);
        prev = p;
      }
    }
    const brown = toon(0xa0683a), mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
    const addInst = (geo, mat, list, setM, outlineT) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length); im.castShadow = true; im.receiveShadow = true;
      const om = new THREE.InstancedMesh(geo, FKS.outlineMaterial(INK, outlineT, false), list.length);
      list.forEach((it, i)=>{ setM(it, mtx); im.setMatrixAt(i, mtx); om.setMatrixAt(i, mtx); });
      scene.add(im); scene.add(om); return im;
    };
    addInst(postG, brown, posts, (p,m)=>m.makeTranslation(p.x, p.y, p.z), 0.03);
    for (const hgt of [0.45, 0.8]) addInst(railG, toon(0xc58a50), rails, ([a,b],m)=>{
      const d = b.clone().sub(a), mid = a.clone().add(b).multiplyScalar(0.5);
      q.setFromUnitVectors(V3(1,0,0), d.clone().normalize());
      m.compose(mid.add(V3(0,hgt,0)), q, V3(d.length(), 1, 1));
    }, 0.025);

    // lollipop trees
    const trees = FKS.scatter(track, 70, 11, track.width/2 + 6, 1e9, 150);
    const trunkG = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 8).translate(0, 1.1, 0);
    const crownG = G.blob(1.5, 1.4, 1.5, 18, 14);
    const crowns = [];
    trees.forEach(t => { t.y = track.groundY(t.x, t.z, W.hills); const s = 0.8 + t.r*0.9; t.s = s;
      crowns.push({ x:t.x, y:t.y + 2.6*s, z:t.z, s:s*1.05 }); if (t.r2 > 0.4) crowns.push({ x:t.x + 0.8*s, y:t.y + 2.1*s, z:t.z + 0.3*s, s:s*0.7 }); });
    addInst(trunkG, toon(0x8a5a32), trees, (t,m)=>m.compose(V3(t.x,t.y,t.z), q.identity(), V3(t.s,t.s,t.s)), 0.06);
    const crownIM = addInst(crownG, toon(0x4fb83c), crowns, (t,m)=>m.compose(V3(t.x,t.y,t.z), q.identity(), V3(t.s,t.s,t.s)), 0.07);
    // flowers dotted in the grass
    const fl = FKS.scatter(track, 500, 21, track.width/2 + 1.6, 40, 120);
    const flG = G.blob(0.12, 0.08, 0.12, 8, 6), flCols = [0xffffff, 0xffe14d, 0xff7aa8, 0xb07bff];
    const flIM = new THREE.InstancedMesh(flG, toon(0xffffff), fl.length);
    fl.forEach((f,i)=>{ mtx.makeTranslation(f.x, track.groundY(f.x,f.z,W.hills)+0.06, f.z); flIM.setMatrixAt(i, mtx); flIM.setColorAt(i, new THREE.Color(flCols[(f.r*4)|0])); });
    scene.add(flIM);

    // red barn + silo + windmill as landmarks
    const landmark = (x, z, build) => { const g = new THREE.Group(); g.position.set(x, track.groundY(x,z,W.hills), z); build(g); scene.add(g); return g; };
    landmark(74, 6, g => {
      mesh(G.roundedBox(10, 6.5, 8, 0.4, 2), toon(0xd8402f), 0.08, g).position.y = 3.25;
      const roof = new THREE.CylinderGeometry(5.6, 5.6, 9, 3, 1).rotateZ(Math.PI/2).rotateX(Math.PI/6);
      mesh(roof, toon(0x5a4a52), 0.08, g).position.set(0, 7.2, 0);
      mesh(G.roundedBox(3.2, 4, 0.3, 0.1, 1), toon(0xfff1d0), 0.06, g).position.set(0, 2, -4.1);
      mesh(G.roundedBox(1.6, 1.6, 0.3, 0.1, 1), toon(0xfff1d0), 0.05, g).position.set(0, 5.4, -4.1);
      g.rotation.y = -1.2;
      const silo = mesh(new THREE.CylinderGeometry(2, 2, 11, 18).translate(0, 5.5, 0), toon(0xbfc6cf), 0.08, g); silo.position.set(8, 0, 1);
      mesh(G.blob(2, 1.5, 2, 18, 10), toon(0xe5392f), 0.08, g).position.set(8, 11, 1);
    });
    let blades = null;
    landmark(-80, -40, g => {
      mesh(new THREE.CylinderGeometry(1.4, 2.6, 13, 8).translate(0, 6.5, 0), toon(0xfff1d0), 0.08, g);
      mesh(new THREE.ConeGeometry(2.2, 2.6, 8).translate(0, 14.2, 0), toon(0xd8402f), 0.08, g);
      blades = new THREE.Group(); blades.position.set(0, 12, 2.0); g.add(blades);
      for (let i=0;i<4;i++){ const b = mesh(G.roundedBox(1.0, 6.5, 0.12, 0.05, 1).translate(0, 3.4, 0), toon(0xffffff), 0.05, blades); b.rotation.z = i*Math.PI/2; }
      g.rotation.y = 0.9;
    });
    // hay bales
    const bales = FKS.scatter(track, 24, 33, track.width/2 + 4, 22, 110);
    addInst(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 18).rotateZ(Math.PI/2), toon(0xf2c74a), bales, (b,m)=>m.compose(V3(b.x, track.groundY(b.x,b.z,W.hills)+0.9, b.z), q.setFromAxisAngle(V3(0,1,0), b.r*6), V3(1,1,1)), 0.04);
    // distant gumdrop hills ring (two merged meshes — one per green — to keep draw calls down)
    const hillG = [[], []];
    for (let i=0;i<22;i++){
      const a = i/22*Math.PI*2, r = 210 + (i%3)*25, s = 30 + ((i*37)%20);
      hillG[i%2].push(G.blob(s, s*0.6, s, 20, 12).translate(Math.cos(a)*r, -6, Math.sin(a)*r));
    }
    hillG.forEach((list, j) => { const h = mesh(G.merge(list), toon(j ? 0x5fb048 : 0x72c257), 0.6, scene); h.castShadow = false; });
    // puffy outlined clouds
    const clouds = new THREE.Group(); scene.add(clouds);
    const cr = FKS.rng(9);
    for (let i=0;i<16;i++){
      const n = 4 + (cr()*4|0), parts = [];
      for (let j=0;j<n;j++){ const s = 5 + cr()*5; parts.push(G.blob(s, s*0.75, s, 16, 12).translate((j-n/2)*5.5 + cr()*2, cr()*3, cr()*4)); }
      const g = mesh(G.merge(parts), toon(0xffffff, { fog:false }), 0.5); g.castShadow = false; g.receiveShadow = false;
      const a = cr()*Math.PI*2, r = 140 + cr()*110; g.position.set(Math.cos(a)*r, 55 + cr()*45, Math.sin(a)*r); g.lookAt(0, g.position.y, 0);
      clouds.add(g);
    }
    W.update = (dt, t) => { if (blades) blades.rotation.z += dt*0.8; clouds.rotation.y += dt*0.004; };
    return W;
  }

  function makePuff(){ const m = new THREE.Mesh(G.blob(0.16,0.16,0.16,12,10), toon(0xffffff)); FKS.addOutline(m, INK, 0.02); return m; }
  function animPuff(m, a, boost){
    // cartoon puffs pop in, hold, then shrink away (no alpha fade — cel style)
    const s = boost ? (0.8 + a*0.5) * (1 - a*a) : (0.35 + Math.sin(Math.min(1,a*1.4)*Math.PI*0.5)*0.5) * (a > 0.7 ? (1-a)/0.3 : 1);
    m.scale.setScalar(Math.max(0.01, s));
    m.material.color.setHex(boost ? (a < 0.4 ? 0xfff36a : 0xff8a1f) : 0xffffff);
  }

  FKS.styles.toon = {
    id:'toon', name:'Storybook Toon',
    blurb:'Cel-shaded in three hard bands with hand-inked outlines. Chibi Bucky with a big head and cartoon eyes, a bubbly kart with a headlight face, candy-stripe curbs, lollipop trees and puffy clouds.',
    fov: 60, toneMapping: THREE.NoToneMapping, exposure: 1, shadowType: THREE.PCFShadowMap,
    buildWorld, buildKart, buildRacer, makePuff, animPuff,
  };
})();
