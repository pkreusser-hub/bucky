// Style 3 — CLAY TOYBOX. Plasticine stop-motion set in the spirit of Aardman: soft lumpy forms,
// matte clay with a thumbprint bump, a miniature-set key light, a painted-backdrop sky with
// cotton-ball clouds, and animation that steps at 12 fps (stepFps) like frames on a rostrum.
(function(){
  'use strict';
  const G = FKS.geo, V3 = (x,y,z)=>new THREE.Vector3(x,y,z), J = FKS.joint;

  // ------------------------------------------------------------------ clay material + thumbprint bump
  let BUMP_IMG = null;
  function bumpImage(){
    if (BUMP_IMG) return BUMP_IMG;
    const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d'), r = FKS.rng(77);
    x.fillStyle = '#808080'; x.fillRect(0,0,S,S);
    // pressed dents and ridges, drawn at wrapped offsets so the tile repeats without a seam
    const blob = (px, py, rad, v, a) => {
      for (const ox of [-S,0,S]) for (const oy of [-S,0,S]){
        const g = x.createRadialGradient(px+ox, py+oy, 0, px+ox, py+oy, rad);
        g.addColorStop(0, 'rgba('+v+','+v+','+v+','+a+')'); g.addColorStop(1, 'rgba('+v+','+v+','+v+',0)');
        x.fillStyle = g; x.beginPath(); x.arc(px+ox, py+oy, rad, 0, 7); x.fill();
      }
    };
    for (let i=0;i<46;i++) blob(r()*S, r()*S, 6+r()*14, r()<0.5?40:215, 0.35);
    for (let i=0;i<60;i++) blob(r()*S, r()*S, 1.5+r()*2.5, r()<0.5?90:170, 0.35);
    // a few thumbprint whorls
    x.lineWidth = 1.2;
    for (let k=0;k<4;k++){
      const cx = 20 + r()*88, cy = 20 + r()*88, rot = r()*6;
      for (let a=3;a<15;a+=2.6){
        x.strokeStyle = 'rgba(' + (k%2?225:35) + ',' + (k%2?225:35) + ',' + (k%2?225:35) + ',0.38)';
        x.beginPath(); x.ellipse(cx, cy, a*1.15, a, rot, 0.3, 5.6); x.stroke();
      }
    }
    // soften: clay is smooth-pressed, not gritty (the raw specks read as carpet at chase distance)
    const soft = document.createElement('canvas'); soft.width = soft.height = S; const sx = soft.getContext('2d');
    sx.filter = 'blur(1.5px)'; for (const ox of [-S,0,S]) for (const oy of [-S,0,S]) sx.drawImage(c, ox, oy);
    BUMP_IMG = soft; return soft;
  }
  const BUMPS = {};
  function bumpTex(rep){
    const k = rep + ''; if (BUMPS[k]) return BUMPS[k];
    const t = new THREE.CanvasTexture(bumpImage());
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4;
    return BUMPS[k] = t;
  }
  // matte clay; bumpRep is how many tiles across a 0..1 uv span (small = big thumbprints)
  const clay = (color, extra, bumpRep, bumpScale) => new THREE.MeshStandardMaterial(Object.assign({
    color, roughness: 0.9, metalness: 0, bumpMap: bumpTex(bumpRep || 2), bumpScale: (bumpScale == null ? 1.6 : bumpScale) * 0.025, // bump is screen-space in three: keep it a whisper
  }, extra || {}));
  function mesh(geo, mat, parent, shadow){
    const m = new THREE.Mesh(geo, mat); m.castShadow = shadow !== false; m.receiveShadow = true;
    if (parent) parent.add(m); return m;
  }
  const lump = (g, amp, freq, seed) => G.lumpy(g, amp, freq, seed);
  // lumpy ellipsoid: hand-pressed unevenness scaled to the object's size
  const ball = (rx, ry, rz, amp, seed, ws, hs) => {
    const g = G.blob(rx, ry, rz, ws || 26, hs || 18), m = Math.max(rx, ry, rz);
    return lump(g, m * (amp == null ? 0.07 : amp), 3.2 / m, seed || 1);
  };
  const lumpyBox = (w, h, d, r, amp, seed) => {
    const g = G.roundedBox(w, h, d, r, 5), m = Math.max(w, h, d);
    return lump(g, m * (amp == null ? 0.03 : amp), 3 / m, seed || 1);
  };

  // ------------------------------------------------------------------ kart
  function buildKart(color){
    const k = FKS.newKart(), B = k.body, C = k.chassis;
    const paint = clay(color, {}, 6, 1.8);
    const cream = clay(0xf6e6c8, {}, 3), dark = clay(0x5a4c60, {}, 3), grey = clay(0xb9b3c4, {}, 3),
          tireM = clay(0x4a4350, {}, 2, 2.4), hub = clay(0xf2c24e, {}, 3), hay = clay(0xefc860, {}, 3),
          strap = clay(0xa4623a, {}, 3), red = clay(0xd85a48, {}, 3),
          lamp = clay(0xfff1b0, { emissive: 0x6a5a1a, roughness: 0.75 }, 3, 0.8);
    k.paint.push(paint);
    // bulbous pill body: fat tub, a rounded nose, and puffy fender pillows
    mesh(lumpyBox(1.20, 0.46, 1.86, 0.22, 0.035, 3), paint, B).position.set(0, 0.52, -0.06);
    mesh(ball(0.50, 0.28, 0.50, 0.05, 5, 24, 16), paint, B).position.set(0, 0.60, 0.80);
    for (const sx of [-1,1]){
      const fe = mesh(ball(0.26, 0.17, 0.46, 0.06, 7+sx), paint, B); fe.position.set(sx*0.64, 0.62, 0.80);
      const rf = mesh(ball(0.28, 0.20, 0.52, 0.06, 11+sx), paint, B); rf.position.set(sx*0.66, 0.80, -0.72);
      // pressed-on cream side stripe
      const st = mesh(ball(0.05, 0.07, 0.62, 0.08, 13+sx, 14, 10), cream, B); st.position.set(sx*0.595, 0.55, 0.05);
      // oversized round headlights with a little rim
      const rim = mesh(ball(0.15, 0.15, 0.07, 0.05, 17+sx, 20, 14), cream, B); rim.position.set(sx*0.27, 0.74, 1.20);
      const hl = mesh(ball(0.115, 0.115, 0.06, 0.04, 19+sx, 20, 14), lamp, B); hl.position.set(sx*0.27, 0.74, 1.245);
      const sp = mesh(G.blob(0.03, 0.03, 0.015, 10, 8), cream, B, false); sp.position.set(sx*0.27+0.04, 0.78, 1.30);
    }
    // bumper roll
    const bump = mesh(lump(new THREE.TorusGeometry(0.34, 0.065, 12, 28, Math.PI), 0.01, 6, 3), cream, B);
    bump.rotation.set(Math.PI/2, 0, Math.PI); bump.position.set(0, 0.40, 1.10);
    // seat, backrest and dash
    mesh(lumpyBox(0.54, 0.14, 0.48, 0.06, 0.03, 21), dark, B).position.set(0, 0.80, -0.10);
    mesh(lumpyBox(0.56, 0.58, 0.16, 0.08, 0.03, 23), red, B).position.set(0, 1.04, -0.38);
    mesh(lumpyBox(0.80, 0.18, 0.26, 0.08, 0.03, 25), dark, B).position.set(0, 0.90, 0.52);
    // hay bale in the back, tied with clay straps
    mesh(lumpyBox(0.86, 0.42, 0.46, 0.10, 0.04, 27), hay, B).position.set(0, 0.88, -0.82);
    for (const sx of [-0.22, 0.22]) mesh(lumpyBox(0.07, 0.45, 0.50, 0.03, 0.03, 29), strap, B).position.set(sx, 0.885, -0.82);
    // stubby exhaust pipes
    for (const sx of [-1,1]){
      mesh(lump(G.taperTube([V3(sx*0.40,0.62,-0.95), V3(sx*0.44,0.82,-1.10), V3(sx*0.46,1.00,-1.16)], 0.065, 0.085, 12, 10), 0.008, 6, 5), grey, B);
      const lip = mesh(lump(new THREE.TorusGeometry(0.085, 0.032, 8, 16), 0.006, 8, 2), grey, B);
      lip.position.set(sx*0.46, 1.01, -1.16); lip.rotation.x = Math.PI/2 - 0.2;
      k.addExhaust(sx*0.46, 1.06, -1.16);
    }
    // bendy antenna: three clay segments that lag each other, topped with a floppy flag
    const ant = new THREE.Group(); ant.position.set(-0.40, 1.00, -1.0); C.add(ant);
    const segs = [], flagMat = clay(0xe9805a, { side: THREE.DoubleSide }, 6);
    let parent = ant;
    for (let i=0;i<3;i++){
      const s = new THREE.Group(); s.position.y = i ? 0.30 : 0; parent.add(s);
      mesh(lump(new THREE.CylinderGeometry(0.02, 0.026, 0.32, 8).translate(0, 0.16, 0), 0.004, 12, 2+i), dark, s);
      segs.push(s); parent = s;
    }
    const top = new THREE.Group(); top.position.y = 0.32; parent.add(top);
    mesh(ball(0.04, 0.04, 0.04, 0.08, 31, 10, 8), red, top);
    const flag = new THREE.Group(); flag.position.y = -0.04; top.add(flag);
    const fl = mesh(lump(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 3, 1).rotateX(Math.PI/2).rotateZ(Math.PI/2).scale(1, 0.7, 1.35).translate(0, 0, -0.17), 0.006, 10, 4), flagMat, flag);
    fl.castShadow = false;
    let bendX = 0, bendZ = 0;
    k.flair.push((dt, s)=>{
      const sp = Math.min(1, Math.abs(s.speed||0)/20), t = s.t||0;
      const tx = -0.28*sp + Math.sin(t*9)*0.06*sp, tz = (s.steer||0)*0.22*sp;
      const a = 1 - Math.exp(-dt*9); bendX += (tx - bendX)*a; bendZ += (tz - bendZ)*a;
      segs.forEach((sg, i)=>{ sg.rotation.x = bendX*(i?1.0:0.5) + Math.sin(t*7 + i*1.3)*0.05*(0.3+sp); sg.rotation.z = bendZ*(i?1.0:0.5); });
      flag.rotation.y = Math.sin(t*13)*0.4*(0.3+sp);
    });
    // steering wheel + column: a fat clay donut
    const col = mesh(lump(new THREE.CylinderGeometry(0.04, 0.04, 0.42, 10), 0.006, 10, 6), dark, C);
    col.position.set(0, 1.07, 0.30); col.rotation.x = -0.9;
    const sw = new THREE.Group();
    mesh(lump(new THREE.TorusGeometry(0.17, 0.042, 12, 26), 0.006, 10, 7), clay(0x6a5878, {}, 3), sw);
    for (let i=0;i<3;i++){ const sp = mesh(G.roundedBox(0.04, 0.17, 0.035, 0.016, 2).translate(0, 0.085, 0), grey, sw, false); sp.rotation.z = i*Math.PI*2/3 + Math.PI; }
    mesh(ball(0.06, 0.06, 0.04, 0.08, 9, 12, 10), red, sw, false);
    k.setSteeringWheel(V3(0, 1.25, 0.16), 0.55, 0.17, sw);
    // wheels: fat donut tires, yellow hubs with three thumb-pressed studs so the spin reads
    const mkWheel = (r, w, seed) => {
      const g = new THREE.Group(), R = r*0.68, t = r*0.36;
      const tg = new THREE.TorusGeometry(R, t, 18, 30).rotateY(Math.PI/2).scale(w/(t*2) < 1 ? 1 : 1, 1, 1);
      tg.scale(Math.max(0.8, w/(t*2)), 1, 1);
      mesh(lump(tg, r*0.045, 3.2/r, seed), tireM, g);
      const hb = mesh(ball(w*0.5, R*0.95, R*0.95, 0.04, seed+1, 16, 14), hub, g); hb.scale.x = 0.9;
      for (const sx of [-1,1]) for (let b=0;b<3;b++){
        const a = b*Math.PI*2/3, stud = mesh(G.blob(0.035, 0.035, 0.035, 10, 8), cream, g, false);
        stud.position.set(sx*w*0.42, Math.cos(a)*R*0.55, Math.sin(a)*R*0.55);
      }
      return g;
    };
    k.addWheel( 0.64, 0.28, 0.80, 0.28, true,  mkWheel(0.28, 0.26, 41));
    k.addWheel(-0.64, 0.28, 0.80, 0.28, true,  mkWheel(0.28, 0.26, 42));
    k.addWheel( 0.68, 0.36,-0.72, 0.36, false, mkWheel(0.36, 0.36, 43));
    k.addWheel(-0.68, 0.36,-0.72, 0.36, false, mkWheel(0.36, 0.36, 44));
    k.setColor = (hex)=>{ paint.color.setHex(hex); };
    return k;
  }

  // ------------------------------------------------------------------ racer (plasticine Bucky, skinned)
  function buildRacer(){
    const sk = FKS.skinBuilder();
    const H = J('head');
    const L = (g, amp, seed, f) => lump(g, amp, f || 14, seed);
    // big round head, snout, nose
    sk.rigid(L(G.blob(0.215, 0.20, 0.205, 28, 20), 0.007, 1).translate(H.x, H.y+0.13, H.z+0.02), 'fur', 'head');
    sk.rigid(L(G.blob(0.125, 0.10, 0.125, 22, 16), 0.005, 2).translate(0, H.y+0.07, H.z+0.17), 'cream', 'head');
    sk.rigid(L(G.blob(0.055, 0.04, 0.04, 14, 10), 0.003, 3).translate(0, H.y+0.115, H.z+0.285), 'nose', 'head');
    const sm = new THREE.TorusGeometry(0.05, 0.011, 6, 14, Math.PI*0.8); sm.rotateZ(Math.PI + Math.PI*0.1); sm.translate(0, H.y+0.06, H.z+0.285);
    sk.rigid(sm, 'nose', 'head');
    for (const sx of [-1,1]){
      // button eyes: a cream ring, a shiny dark button, and a pressed clay highlight
      sk.rigid(L(G.blob(0.066, 0.07, 0.03, 18, 12), 0.003, 4+sx).translate(sx*0.088, H.y+0.17, H.z+0.19), 'eyeW', 'head');
      sk.rigid(G.blob(0.045, 0.048, 0.025, 16, 12).translate(sx*0.086, H.y+0.168, H.z+0.212), 'eye', 'head');
      sk.rigid(G.blob(0.013, 0.013, 0.008, 8, 6).translate(sx*0.074, H.y+0.188, H.z+0.232), 'eyeW', 'head');
      // brows: little clay sausages
      sk.rigid(G.roundedBox(0.075, 0.022, 0.025, 0.01, 2).rotateZ(-sx*0.25).translate(sx*0.09, H.y+0.265, H.z+0.17), 'brow', 'head');
      // curled horns, pinched from a clay roll
      sk.rigid(L(G.taperTube([V3(sx*0.08,H.y+0.27,H.z-0.02), V3(sx*0.12,H.y+0.35,H.z-0.08), V3(sx*0.15,H.y+0.34,H.z-0.18), V3(sx*0.17,H.y+0.27,H.z-0.20)], 0.048, 0.016, 10, 14), 0.004, 5+sx), 'horn', 'head');
      // floppy ears on their own bones
      const E = J(sx>0?'ear_L':'ear_R'), eb = sx>0?'ear_L':'ear_R';
      sk.rigid(L(G.blob(0.125, 0.04, 0.07, 18, 12), 0.004, 6+sx).rotateZ(-sx*0.45).translate(E.x+sx*0.09, E.y-0.04, E.z), 'fur', eb);
      sk.rigid(G.blob(0.085, 0.025, 0.04, 12, 8).rotateZ(-sx*0.45).translate(E.x+sx*0.09, E.y-0.03, E.z+0.03), 'pink', eb);
    }
    sk.rigid(L(new THREE.ConeGeometry(0.045, 0.13, 12, 3).rotateX(Math.PI), 0.004, 7).translate(0, H.y-0.04, H.z+0.15), 'cream', 'head');
    // chunky toque: fat band and a big lumpy cloud on top
    sk.rigid(L(new THREE.CylinderGeometry(0.125, 0.115, 0.11, 22, 3), 0.005, 8).translate(0, H.y+0.335, H.z-0.02), 'shirt', 'head');
    sk.rigid(L(G.blob(0.17, 0.12, 0.17, 24, 16), 0.012, 9).translate(0, H.y+0.45, H.z-0.02), 'shirt', 'head');
    for (let i=0;i<6;i++){ const a = i/6*Math.PI*2; sk.rigid(L(G.blob(0.07,0.07,0.07,14,10), 0.005, 10+i).translate(Math.cos(a)*0.095, H.y+0.43, H.z-0.02+Math.sin(a)*0.095), 'shirt', 'head'); }
    // neck scarf, a fat clay roll
    sk.along(L(new THREE.TorusGeometry(0.105, 0.045, 10, 22).rotateX(Math.PI/2), 0.005, 20).translate(0, 0.585, 0.0), 'scarf', [[0.55,'chest'],[0.62,'neck']]);
    sk.rigid(L(new THREE.ConeGeometry(0.055, 0.13, 8).rotateX(Math.PI*0.6), 0.004, 21).translate(0.05, 0.56, -0.12), 'scarf', 'chest');
    // torso: round chef jacket
    sk.along(L(G.blob(0.185, 0.26, 0.165, 26, 20), 0.008, 22).translate(0, 0.36, -0.03), 'shirt', [[0.14,'hips'],[0.30,'spine'],[0.46,'chest'],[0.6,'neck']]);
    for (let i=0;i<3;i++) sk.rigid(G.blob(0.02,0.02,0.012,8,6).translate(0.05, 0.46-i*0.08, 0.13), 'scarf', i===0?'chest':'spine');
    sk.along(L(G.blob(0.195, 0.10, 0.175, 22, 14), 0.006, 23).translate(0, 0.14, -0.03), 'pants', [[0.1,'hips'],[0.2,'spine']]);
    // sausage arms and legs on limb() so elbows and knees bend
    for (const s of ['L','R']){
      sk.limb(L(G.capsule(J('upperArm_'+s), J('foreArm_'+s), 0.07, 0.058, 16, 6), 0.004, 30), 'shirt', 'upperArm_'+s, 'foreArm_'+s, { blendParent:true });
      sk.limb(L(G.capsule(J('foreArm_'+s), J('hand_'+s), 0.055, 0.048, 14, 6), 0.004, 31), 'fur', 'foreArm_'+s, 'hand_'+s);
      const h = J('hand_'+s), dir = J('hand_'+s).sub(J('foreArm_'+s)).normalize();
      sk.rigid(L(G.blob(0.065, 0.058, 0.07, 16, 12), 0.005, 32).translate(h.x+dir.x*0.04, h.y+dir.y*0.04, h.z+dir.z*0.04), 'glove', 'hand_'+s);
      sk.limb(L(G.capsule(J('thigh_'+s), J('shin_'+s), 0.085, 0.07, 16, 6), 0.004, 33), 'pants', 'thigh_'+s, 'shin_'+s, { blendParent:true });
      sk.limb(L(G.capsule(J('shin_'+s), J('foot_'+s), 0.065, 0.058, 14, 6), 0.004, 34), 'pants', 'shin_'+s, 'foot_'+s);
      const f = J('foot_'+s);
      sk.rigid(L(G.blob(0.075, 0.058, 0.115, 16, 12), 0.005, 35).translate(f.x, f.y-0.01, f.z+0.05), 'hoof', 'foot_'+s);
    }
    const T = J('tail');
    sk.rigid(L(G.blob(0.05, 0.08, 0.05, 12, 10), 0.004, 36).rotateX(-0.6).translate(T.x, T.y+0.04, T.z-0.02), 'cream', 'tail');
    const m = (c, extra) => clay(c, extra, 1.6, 1.4);
    return sk.build({
      fur: m(0x9a6a44), cream: m(0xf2e0bc), nose: m(0x4a3024), eyeW: m(0xfaf0dc), eye: m(0x2a1c16, { roughness: 0.45 }),
      brow: m(0x6a4630), horn: m(0xe9d6a8), pink: m(0xeaa0a0), shirt: m(0xfaf3e6), scarf: m(0xd85a48), pants: m(0x6f8fc8),
      glove: m(0xf6e6c8), hoof: m(0x5c4232),
    }, {});
  }

  // ------------------------------------------------------------------ world
  function buildWorld(scene, track){
    const W = { hills: 5 };
    const q = new THREE.Quaternion(), mtx = new THREE.Matrix4();
    const gy = (x, z) => track.groundY(x, z, W.hills);
    scene.fog = new THREE.Fog(0xf2e2cc, 90, 340);
    const sunDir = V3(-0.45, 0.58, -0.62).normalize();
    // painted-backdrop sky: cream at the horizon up to a pale cyan
    scene.add(FKS.skyDome([[-0.3,0xf3e3cc],[0.0,0xf6e8d2],[0.12,0xe2ecdc],[0.4,0xb8e0e6],[1,0x8ccfe0]], { dither: 0.012 }));
    scene.add(new THREE.HemisphereLight(0xdcecf4, 0x9a8a5e, 0.75));
    const fill = new THREE.DirectionalLight(0xc6d8f0, 0.25); fill.position.set(60, 40, 70); scene.add(fill);
    const sun = new THREE.DirectionalLight(0xffe6c0, 1.35);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 4;
    const sc = sun.shadow.camera; sc.left = sc.bottom = -24; sc.right = sc.top = 24; sc.near = 1; sc.far = 120;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);
    W.sun = sun; W.sunOffset = sunDir.clone().multiplyScalar(60);

    // ground: lumpy green clay, flattened under the road, with big soft colour patches
    const S = 320, seg = 160, gg = new THREE.PlaneGeometry(S, S, seg, seg); gg.rotateX(-Math.PI/2);
    const gp = gg.attributes.position, col = new Float32Array(gp.count*3), c = new THREE.Color();
    for (let i=0;i<gp.count;i++){
      const x = gp.getX(i), z = gp.getZ(i);
      const n = FKS.noise3(x*0.07, 1, z*0.07), l = FKS.noise3(x*0.9, 4, z*0.9) * 0.14; // l: thumb-pressed lumps
      gp.setY(i, gy(x, z) + l * Math.min(1, track.nearest(x, z).d / 12));
      c.setHex(n > 0.18 ? 0xa4c068 : (n < -0.2 ? 0x82aa5c : 0x93b762));
      col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b;
    }
    gg.setAttribute('color', new THREE.BufferAttribute(col,3)); gg.computeVertexNormals();
    const ground = new THREE.Mesh(gg, clay(0xffffff, { vertexColors:true }, 90, 2.4)); ground.receiveShadow = true; scene.add(ground);

    // road: flattened grey-lilac clay with white clay "snakes" for the dashes
    const rnd = FKS.rng(5);
    const dashes = [];
    for (let y=0; y<256; y+=64) dashes.push([y + (rnd()-0.5)*6, 30 + rnd()*8, (rnd()-0.5)*2.4, (rnd()-0.5)*0.12]);
    const drawDashes = (x, w, fill, wob) => {
      x.fillStyle = fill; x.lineCap = 'round'; x.lineJoin = 'round';
      for (const [y, len, dx, tilt] of dashes){
        x.lineWidth = w*0.07 + 1; x.beginPath();
        const cx = w*0.5 + dx, y0 = y + 4, y1 = y + len;
        x.strokeStyle = fill; x.moveTo(cx, y0);
        x.bezierCurveTo(cx + wob + tilt*30, y0 + len*0.3, cx - wob + tilt*30, y0 + len*0.6, cx + tilt*40, y1); x.stroke();
      }
    };
    const roadTex = FKS.canvasTex(256, 512, (x,w,h)=>{
      x.scale(2,2); w/=2; h/=2;
      x.fillStyle = '#b4adc2'; x.fillRect(0,0,w,h);
      const r = FKS.rng(6);
      for (let i=0;i<46;i++){ x.fillStyle = r()<0.5 ? 'rgba(150,142,170,0.35)' : 'rgba(210,204,224,0.35)'; x.beginPath(); x.ellipse(r()*w, r()*h, 4+r()*12, 3+r()*8, r()*3, 0, 7); x.fill(); }
      drawDashes(x, w, '#fbf6ec', 3);
    });
    const roadBump = FKS.canvasTex(256, 512, (x,w,h)=>{
      x.scale(2,2); w/=2; h/=2;
      x.fillStyle = '#808080'; x.fillRect(0,0,w,h); x.globalAlpha = 0.35; x.drawImage(bumpImage(), 0, 0, 128, 128); x.drawImage(bumpImage(), 0, 128, 128, 128);
      x.globalAlpha = 0.9; drawDashes(x, w, '#ffffff', 3);
    });
    const road = new THREE.Mesh(track.ribbon(track.width, 0.03, { uvScale: track.width, across: 4 }),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: roadTex, bumpMap: roadBump, bumpScale: 0.06, roughness: 0.92, metalness: 0 }));
    road.receiveShadow = true; scene.add(road);
    // rolled clay road edges, wobbled by hand
    const edgeMat = clay(0xd8b8a0, {}, 4, 1.6);
    for (const sgn of [-1,1]){
      const eg = track.ribbon(1.0, 0.03, { offset: sgn*(track.width/2 + 0.35), uvScale: 2.5, across: 4, crown: 0.16 });
      const p = eg.attributes.position;
      for (let i=0;i<p.count;i++){ const x = p.getX(i), z = p.getZ(i); p.setY(i, p.getY(i) + Math.max(0, FKS.noise3(x*0.6, 2, z*0.6)*0.05 + 0.02)); }
      eg.computeVertexNormals();
      const em = new THREE.Mesh(eg, edgeMat); em.receiveShadow = true; em.castShadow = true; scene.add(em);
    }
    // start line: pressed clay checkers (raised dark squares)
    const chkDraw = (a, b) => (x,w,h)=>{ for (let i=0;i<8;i++) for (let j=0;j<2;j++){ x.fillStyle=(i+j)%2?a:b; x.fillRect(i*8,j*8,8,8); } };
    const chkTex = FKS.canvasTex(64, 16, chkDraw('#4a3f52', '#fbf4e4'), { nearest:true });
    const chkBump = FKS.canvasTex(64, 16, chkDraw('#ffffff', '#303030'), { nearest:true });
    scene.add(Object.assign(new THREE.Mesh(track.ribbon(track.width, 0.045, { u0: 0, u1: 1.6/track.length, uvScale: 1.6 }),
      new THREE.MeshStandardMaterial({ map: chkTex, bumpMap: chkBump, bumpScale: 0.06, roughness: 0.9, metalness: 0 })), { receiveShadow: true }));
    // boost pads: orange clay with raised yellow chevron arrows
    const chevDraw = (bg, fg) => (x,w,h)=>{ x.fillStyle=bg; x.fillRect(0,0,w,h); x.strokeStyle=fg; x.lineWidth=11; x.lineJoin='round'; x.lineCap='round'; for (let k=0;k<2;k++){ x.beginPath(); x.moveTo(10, 24+k*32); x.lineTo(32, 7+k*32); x.lineTo(54, 24+k*32); x.stroke(); } };
    const chevTex = FKS.canvasTex(64, 64, chevDraw('#e88a40', '#fbe27a'));
    const chevBump = FKS.canvasTex(64, 64, chevDraw('#303030', '#ffffff'));
    const padMat = new THREE.MeshStandardMaterial({ map: chevTex, bumpMap: chevBump, bumpScale: 0.08, roughness: 0.85, metalness: 0, emissive: 0x3a1c06 });
    for (const pu of track.boostPads){
      const m = new THREE.Mesh(track.ribbon(3.4, 0.06, { u0: pu, u1: pu + 6/track.length, uvScale: 3.4 }), padMat); m.receiveShadow = true; scene.add(m);
    }

    const addInst = (geo, mat, list, setM, tint) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length); im.castShadow = true; im.receiveShadow = true;
      list.forEach((it, i)=>{ setM(it, mtx); im.setMatrixAt(i, mtx); if (tint) im.setColorAt(i, new THREE.Color(tint(it, i))); });
      im.frustumCulled = false; scene.add(im); return im;
    };

    // picket fence made of clay (posts with rounded tops + two sausage rails)
    const postG = lump(G.roundedBox(0.2, 1.0, 0.16, 0.08, 4), 0.012, 4, 3).translate(0, 0.5, 0), railG = lump(G.roundedBox(1, 0.13, 0.08, 0.04, 3), 0.008, 3, 4);
    const posts = [], rails = [];
    const step = 4.2, n = Math.floor(track.length/step);
    for (const sgn of [-1,1]){
      let prev = null;
      for (let i=0;i<=n;i++){
        const f = track.at(i/n), off = sgn*(track.width/2 + 2.7);
        const p = f.p.clone().addScaledVector(f.side, off); p.y = gy(p.x, p.z);
        if (track.nearest(p.x, p.z).d < track.width/2 + 2.0){ prev = null; continue; }
        posts.push(p);
        if (prev && prev.distanceTo(p) < step*1.6) rails.push([prev, p]);
        prev = p;
      }
    }
    addInst(postG, clay(0xf4ead6, {}, 2), posts, (p,m)=>{ q.setFromAxisAngle(V3(0,1,0), (p.x*7.3 + p.z*3.1)%0.3 - 0.15); m.compose(p, q, V3(1, 0.95 + ((p.x*13)%1+1)%1*0.15, 1)); });
    for (const hgt of [0.4, 0.78]) addInst(railG, clay(0xf0dfc4, {}, 2), rails, ([a,b],m)=>{
      const d = b.clone().sub(a), mid = a.clone().add(b).multiplyScalar(0.5);
      q.setFromUnitVectors(V3(1,0,0), d.clone().normalize());
      m.compose(mid.add(V3(0,hgt,0)), q, V3(d.length(), 1, 1));
    });

    // trees: lumpy cone / blob canopies on stubby trunks
    const trees = FKS.scatter(track, 75, 11, track.width/2 + 6, 1e9, 150);
    const trunkG = lump(new THREE.CylinderGeometry(0.28, 0.4, 1.8, 12, 4).translate(0, 0.9, 0), 0.04, 1.6, 8);
    const crownBlob = ball(1.5, 1.35, 1.5, 0.1, 12, 30, 20), crownCone = lump(new THREE.ConeGeometry(1.5, 3.2, 22, 8).translate(0, 1.6, 0), 0.12, 1.2, 13);
    trees.forEach(t => { t.y = gy(t.x, t.z); t.s = 0.8 + t.r*0.9; t.rot = t.r3*6.28; });
    const treeMat = (c) => clay(c, {}, 3, 2);
    const blobTrees = trees.filter(t => t.r2 >= 0.4), coneTrees = trees.filter(t => t.r2 < 0.4);
    addInst(trunkG, clay(0x9a6e4a, {}, 3), trees, (t,m)=>m.compose(V3(t.x,t.y,t.z), q.identity(), V3(t.s,t.s,t.s)));
    const greens = [0x7fae5c, 0x8bb868, 0x6e9e58, 0x96b868];
    addInst(crownBlob, treeMat(0xffffff), blobTrees, (t,m)=>{ q.setFromAxisAngle(V3(0,1,0), t.rot); m.compose(V3(t.x,t.y+2.5*t.s,t.z), q, V3(t.s,t.s,t.s)); }, t => greens[(t.r3*4)|0]);
    addInst(crownBlob, treeMat(0xffffff), blobTrees, (t,m)=>{ q.setFromAxisAngle(V3(0,1,0), t.rot); m.compose(V3(t.x+0.9*t.s,t.y+2.0*t.s,t.z+0.3*t.s), q, V3(t.s*0.62,t.s*0.62,t.s*0.62)); }, t => greens[((t.r3*4)|0)^1]);
    addInst(crownCone, treeMat(0xffffff), coneTrees, (t,m)=>{ q.setFromAxisAngle(V3(0,1,0), t.rot); m.compose(V3(t.x,t.y+1.5*t.s,t.z), q, V3(t.s*0.95,t.s,t.s*0.95)); }, t => greens[((t.r3*4)|0)^2]);
    addInst(crownCone, treeMat(0xffffff), coneTrees, (t,m)=>{ q.setFromAxisAngle(V3(0,1,0), t.rot+1); m.compose(V3(t.x,t.y+3.0*t.s,t.z), q, V3(t.s*0.65,t.s*0.7,t.s*0.65)); }, t => greens[((t.r3*4)|0)^2]);

    // grass tufts, pressed dots and clay flowers dotted over the ground
    const tuft = FKS.scatter(track, 420, 21, track.width/2 + 1.5, 40, 120);
    const tuftG = G.merge([-1,0,1].map(i => lump(new THREE.ConeGeometry(0.07, 0.4, 7, 2).translate(i*0.07, 0.2, 0), 0.01, 8, i+4).rotateZ(-i*0.35)));
    addInst(tuftG, clay(0xffffff, {}, 1, 1), tuft, (f,m)=>{ q.setFromAxisAngle(V3(0,1,0), f.r3*6.28); m.compose(V3(f.x, gy(f.x,f.z)+0.02, f.z), q, V3(1+f.r, 0.8+f.r2, 1+f.r)); }, f => (f.r2 < 0.5 ? 0x6f9a4c : 0x86ae58));
    const fl = FKS.scatter(track, 380, 23, track.width/2 + 1.6, 40, 120);
    const flowerCols = [0xfaf0dc, 0xf2cf5a, 0xeb8fa6, 0xa99ae0];
    const flG = ball(0.14, 0.1, 0.14, 0.12, 14, 12, 8);
    addInst(flG, clay(0xffffff, {}, 1, 1), fl, (f,m)=>m.compose(V3(f.x, gy(f.x,f.z)+0.07, f.z), q.identity(), V3(1,1,1)), f => flowerCols[(f.r*4)|0]);
    const dots = FKS.scatter(track, 300, 25, track.width/2 + 1.3, 30, 110);
    addInst(ball(0.1, 0.05, 0.1, 0.1, 15, 10, 6), clay(0xffffff, {}, 1, 1), dots, (f,m)=>m.compose(V3(f.x, gy(f.x,f.z)+0.02, f.z), q.identity(), V3(1+f.r,1,1+f.r2)), f => (f.r3 < 0.5 ? 0x7fa656 : 0xb2c872));

    // clay sheep (instanced: wool + face/legs), and mushrooms
    const sheepWool = G.merge([
      ball(0.55, 0.42, 0.7, 0.1, 40, 18, 12).translate(0, 0.78, 0), ball(0.36, 0.32, 0.4, 0.1, 41, 14, 10).translate(0.22, 1.0, -0.2),
      ball(0.34, 0.3, 0.4, 0.1, 42, 14, 10).translate(-0.22, 0.98, 0.15), ball(0.3, 0.28, 0.32, 0.1, 43, 14, 10).translate(0, 1.0, 0.45),
    ]);
    const sheepDark = G.merge([
      ball(0.2, 0.22, 0.26, 0.06, 44, 14, 10).translate(0, 0.95, 0.85),
      ...[[-0.25,-0.4],[0.25,-0.4],[-0.25,0.35],[0.25,0.35]].map(([x,z]) => new THREE.CylinderGeometry(0.075, 0.09, 0.5, 8).translate(x, 0.25, z)),
      ball(0.12, 0.05, 0.08, 0.05, 45, 8, 6).translate(0.24, 1.0, 0.75), ball(0.12, 0.05, 0.08, 0.05, 46, 8, 6).translate(-0.24, 1.0, 0.75),
    ]);
    const sheep = FKS.scatter(track, 16, 51, track.width/2 + 5, 28, 110);
    const sheepSetM = (f,m)=>{ q.setFromAxisAngle(V3(0,1,0), f.r3*6.28); const s = 1.0 + f.r*0.3; m.compose(V3(f.x, gy(f.x,f.z), f.z), q, V3(s,s,s)); };
    addInst(sheepWool, clay(0xfbf4e6, {}, 2, 2.2), sheep, sheepSetM);
    addInst(sheepDark, clay(0x5e4c52, {}, 2), sheep, sheepSetM);
    const shroom = FKS.scatter(track, 34, 61, track.width/2 + 3.5, 30, 110);
    const stemG = lump(new THREE.CylinderGeometry(0.1, 0.14, 0.5, 10, 3).translate(0, 0.25, 0), 0.015, 5, 47);
    const capG = lump(G.blob(0.38, 0.24, 0.38, 20, 12).translate(0, 0.55, 0), 0.025, 3, 48);
    const shSetM = (f,m)=>{ q.setFromAxisAngle(V3(0,1,0), f.r3*6.28); const s = 0.8 + f.r*0.9; m.compose(V3(f.x, gy(f.x,f.z), f.z), q, V3(s,s,s)); };
    addInst(stemG, clay(0xf4e8d0, {}, 2), shroom, shSetM);
    addInst(capG, clay(0xffffff, {}, 2, 2), shroom, shSetM, f => (f.r2 < 0.55 ? 0xd9604e : 0xe8a64e));

    // small clay farmhouse + a haystack and a windmill as landmarks
    const landmark = (x, z, build) => { const g = new THREE.Group(); g.position.set(x, gy(x,z), z); build(g); scene.add(g); return g; };
    landmark(74, 6, g => {
      mesh(lumpyBox(10, 6, 8, 1.0, 0.02, 60), clay(0xe6c8a4, {}, 3, 2), g).position.y = 3.0;
      const roof = lump(new THREE.CylinderGeometry(5.6, 5.6, 9.6, 3, 1).rotateZ(Math.PI/2).rotateX(Math.PI/6), 0.18, 0.3, 61);
      mesh(roof, clay(0xc4604e, {}, 3, 2), g).position.set(0, 6.8, 0);
      mesh(lumpyBox(2.0, 3.4, 0.5, 0.4, 0.03, 62), clay(0x9a6e4a, {}, 3), g).position.set(0, 1.7, -4.05);
      for (const sx of [-1,1]) mesh(lumpyBox(1.6, 1.6, 0.5, 0.3, 0.03, 63), clay(0xa6d2dc, {}, 3), g).position.set(sx*3.2, 3.6, -4.05);
      mesh(lumpyBox(1.2, 3, 1.2, 0.35, 0.03, 64), clay(0xd9806a, {}, 3), g).position.set(2.8, 8.2, 0);
      g.rotation.y = -1.2;
      const hs = mesh(ball(2.2, 1.9, 2.2, 0.06, 65, 24, 16), clay(0xefc860, {}, 3), g); hs.position.set(10, 1.6, 2);
    });
    let blades = null;
    landmark(-80, -40, g => {
      mesh(lump(new THREE.CylinderGeometry(1.4, 2.6, 13, 14, 6).translate(0, 6.5, 0), 0.18, 0.4, 66), clay(0xf0e0c0, {}, 3), g);
      mesh(lump(new THREE.ConeGeometry(2.3, 2.8, 14, 4).translate(0, 14.2, 0), 0.12, 0.5, 67), clay(0xd9806a, {}, 3), g);
      blades = new THREE.Group(); blades.position.set(0, 12, 2.0); g.add(blades);
      for (let i=0;i<4;i++){ const b = mesh(lumpyBox(1.1, 6.5, 0.35, 0.16, 0.03, 68+i).translate(0, 3.4, 0), clay(0xfaf3e6, {}, 3), blades); b.rotation.z = i*Math.PI/2; }
      g.rotation.y = 0.9;
    });
    // distant pastel clay hills, hand-pressed
    const hillCols = [0x9fbe7a, 0xb4c786, 0x8fb480];
    for (let i=0;i<22;i++){
      const a = i/22*Math.PI*2, r = 215 + (i%3)*25, s = 30 + ((i*37)%20);
      const h = mesh(ball(s, s*0.55, s, 0.05, 80+i, 28, 14), clay(hillCols[i%3], {}, 4, 2), scene, false);
      h.position.set(Math.cos(a)*r, -6, Math.sin(a)*r);
    }
    // cotton-ball clay clouds and a clay sun hung in the backdrop
    const clouds = new THREE.Group(); scene.add(clouds);
    const cloudMat = clay(0xfffaf0, { emissive: 0x6a645c, fog: false, roughness: 0.95 }, 3, 1.4);
    const cr = FKS.rng(9), cloudGeos = [0,1,2].map(i => ball(6, 4.6, 6, 0.1, 90+i, 20, 14));
    for (let i=0;i<16;i++){
      const g = new THREE.Group(), n = 4 + (cr()*4|0);
      for (let j=0;j<n;j++){ const s = 0.6 + cr()*0.7; const b = mesh(cloudGeos[j%3], cloudMat, g, false); b.receiveShadow = false; b.scale.set(s, s*0.9, s); b.position.set((j-n/2)*5 + cr()*2, cr()*3 + (j%2)*1.5, cr()*4); }
      const a = cr()*Math.PI*2, r = 150 + cr()*110; g.position.set(Math.cos(a)*r, 55 + cr()*45, Math.sin(a)*r); g.lookAt(0, g.position.y, 0);
      clouds.add(g);
    }
    const sunG = new THREE.Group(); sunG.position.copy(sunDir).multiplyScalar(330); sunG.lookAt(0, 0, 0); scene.add(sunG);
    const sunMat = new THREE.MeshStandardMaterial({ color: 0xffd860, emissive: 0xf0b030, roughness: 0.9, metalness: 0, fog: false, bumpMap: bumpTex(2), bumpScale: 0.04 });
    const sunBall = mesh(ball(16, 16, 8, 0.05, 99, 24, 18), sunMat, sunG, false); sunBall.receiveShadow = false;
    const rays = new THREE.Group(); sunG.add(rays);
    for (let i=0;i<12;i++){
      const a = i/12*Math.PI*2, r = mesh(ball(3.2, 7, 2.6, 0.1, 100+i, 12, 10), sunMat, rays, false); r.receiveShadow = false;
      r.position.set(Math.cos(a)*26, Math.sin(a)*26, 0); r.rotation.z = a - Math.PI/2;
    }
    let lastStep = -1;
    W.update = (dt, t) => {
      if (blades) blades.rotation.z += dt*0.8;
      clouds.rotation.y += dt*0.004;
      // the sun's rays wobble in 12 fps steps, like a hand-nudged set piece
      const st = Math.floor(t*12); if (st !== lastStep){ lastStep = st; rays.rotation.z = Math.sin(st*1.9)*0.05; sunBall.scale.setScalar(1 + (st%3 - 1)*0.012); }
    };
    return W;
  }

  // ------------------------------------------------------------------ puffs (lumpy clay balls)
  let PUFF_GEO = null;
  function makePuff(){
    PUFF_GEO = PUFF_GEO || ball(0.17, 0.17, 0.17, 0.16, 120, 14, 10);
    return new THREE.Mesh(PUFF_GEO, clay(0xf0e8e0, {}, 2, 1.4));
  }
  function animPuff(m, a, boost){
    // stop-motion: growth happens in visible 1/6th-of-life steps rather than smoothly
    const sa = Math.min(1, Math.floor(a*7)/7);
    const s = boost ? (1.0 + sa*0.6) * (1 - sa*sa) : (0.5 + Math.sin(Math.min(1, sa*1.4)*Math.PI*0.5)*0.9) * (sa > 0.7 ? (1-sa)/0.3 : 1);
    m.scale.setScalar(Math.max(0.01, s));
    if (boost){
      m.scale.y *= 1.35;
      m.material.color.setHex(sa < 0.3 ? 0xffe27a : (sa < 0.6 ? 0xf5a23c : 0xd9603a));
      m.material.emissive.setHex(sa < 0.6 ? 0x70380a : 0x2a0e04);
    } else {
      m.material.color.setHex(sa < 0.5 ? 0xf2ebe2 : 0xd6cdc6);
      m.material.emissive.setHex(0x000000);
    }
  }

  FKS.styles.clay = {
    id:'clay', name:'Clay Toybox',
    blurb:'Modelled in plasticine, with soft lumpy shapes, thumbprints in the surface and a miniature-set light. Everything moves in 12 frames a second, like a stop-motion film.',
    fov: 60, toneMapping: THREE.ACESFilmicToneMapping, exposure: 0.92, shadowType: THREE.PCFSoftShadowMap, stepFps: 12,
    buildWorld, buildKart, buildRacer, makePuff, animPuff,
  };
})();
