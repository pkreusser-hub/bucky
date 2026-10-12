// Farm Kart — STORYBOOK TOON shared library (cel shading + ink outlines).
// Picked from the farmkart-styles.html prototypes (2026-10-12). Used by farmkart.html (global
// toonify + karts/drivers), assets/farmkart-items.js (items/VFX) and the hero-course art.
// three.js r128 (global THREE). No modules. Renderer stays LinearEncoding: hex colours render as picked.
(function(){
  'use strict';
  const T = window.FK_TOON = window.FK_TOON || {};
  T.INK = 0x2b1a12;                // warm dark-brown ink, never pure black
  T.RAMP_STEPS = [0.42, 0.72, 1.0]; // shadow / mid / lit bands

  let _ramp = null;
  T.ramp = function(){
    if (_ramp) return _ramp;
    const s = T.RAMP_STEPS, d = new Uint8Array(s.length*4);
    s.forEach((v,i)=>{ const b = Math.round(v*255); d[i*4]=b; d[i*4+1]=b; d[i*4+2]=b; d[i*4+3]=255; });
    _ramp = new THREE.DataTexture(d, s.length, 1, THREE.RGBAFormat);
    _ramp.minFilter = _ramp.magFilter = THREE.NearestFilter; _ramp.generateMipmaps = false; _ramp.needsUpdate = true;
    return _ramp;
  };
  // Toon material: T.mat(0xff0000) or T.mat(0xff0000, { map, emissive, transparent, ... })
  T.mat = function(color, extra){
    const m = new THREE.MeshToonMaterial(Object.assign({ color: color == null ? 0xffffff : color, gradientMap: T.ramp() }, extra || {}));
    m.userData.fkToon = true;
    return m;
  };

  // ---- convert existing materials to toon, preserving everything that affects the look ----
  const LIT = { MeshLambertMaterial:1, MeshPhongMaterial:1, MeshStandardMaterial:1, MeshPhysicalMaterial:1 };
  const _conv = new WeakMap();
  T.convertMaterial = function(m){
    if (!m || !LIT[m.type] || (m.userData && m.userData.noToon)) return m;
    const hit = _conv.get(m); if (hit) return hit;
    const t = new THREE.MeshToonMaterial({ gradientMap: T.ramp() });
    t.color.copy(m.color);
    for (const k of ['map','alphaMap','emissiveMap','vertexColors','transparent','opacity','side','alphaTest','fog',
                     'depthWrite','depthTest','skinning','morphTargets','polygonOffset','polygonOffsetFactor','polygonOffsetUnits','visible','wireframe'])
      if (m[k] !== undefined) t[k] = m[k];
    if (m.emissive) t.emissive.copy(m.emissive);
    if (m.emissiveIntensity != null) t.emissiveIntensity = m.emissiveIntensity;
    t.name = m.name; t.userData = Object.assign({}, m.userData, { fkToon:true, fkToonFrom:m.type });
    _conv.set(m, t);
    return t;
  };
  // Walk a subtree and toonify every lit material. Skips Points/Sprites/Lines, ShaderMaterial,
  // MeshBasicMaterial (decals, glows, sky) and anything flagged userData.noToon on the object.
  T.toonify = function(root){
    let n = 0;
    root.traverse(o=>{
      if (!o.isMesh || !o.material || (o.userData && o.userData.noToon)) return;
      if (Array.isArray(o.material)){
        const next = o.material.map(T.convertMaterial);
        if (next.some((x,i)=>x!==o.material[i])){ o.material = next; n++; }
      } else {
        const next = T.convertMaterial(o.material);
        if (next !== o.material){ o.material = next; n++; }
      }
    });
    return n;
  };

  // ---- inverted-hull ink outlines ----
  // Back faces pushed out along the vertex normal in object space BEFORE skinning/instancing, so the
  // outline deforms with skinned meshes and follows every instance of an InstancedMesh for free.
  const _olMats = {};
  T.outlineMaterial = function(thickness, color, skinning){
    color = color == null ? T.INK : color;
    const key = thickness.toFixed(4)+'_'+color+'_'+(skinning?1:0);
    if (_olMats[key]) return _olMats[key];
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
    m.skinning = !!skinning;
    m.onBeforeCompile = (sh)=>{
      sh.uniforms.uOutline = { value: thickness };
      sh.vertexShader = 'uniform float uOutline;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        'vec3 transformed = vec3(position) + normalize(normal) * uOutline;');
    };
    m.customProgramCacheKey = () => 'fkOutline' + (skinning?1:0);
    m.userData.noToon = true; m.userData.fkOutline = true;
    return (_olMats[key] = m);
  };
  // Add an outline child to one mesh (Mesh, SkinnedMesh or InstancedMesh). Returns the outline.
  T.outline = function(mesh, thickness, color){
    if (!mesh || !mesh.isMesh || !mesh.geometry || mesh.userData.fkOutlined) return null;
    if (!mesh.geometry.attributes.normal) return null;
    const t = thickness == null ? 0.02 : thickness;
    let o;
    if (mesh.isInstancedMesh){
      o = new THREE.InstancedMesh(mesh.geometry, T.outlineMaterial(t, color, false), mesh.count);
      o.instanceMatrix = mesh.instanceMatrix;            // shared buffer: moves with its source
      o.position.copy(mesh.position); o.quaternion.copy(mesh.quaternion); o.scale.copy(mesh.scale);
      if (mesh.parent) mesh.parent.add(o);
      o.frustumCulled = mesh.frustumCulled;
      if (mesh.geometry.boundingSphere) o.geometry.boundingSphere = mesh.geometry.boundingSphere;
    } else if (mesh.isSkinnedMesh){
      o = new THREE.SkinnedMesh(mesh.geometry, T.outlineMaterial(t, color, true));
      o.bind(mesh.skeleton, mesh.bindMatrix);
      o.frustumCulled = false;
      mesh.add(o);
      // SkinnedMesh children inherit the mesh transform; the skeleton already lives in world space
      o.bindMode = mesh.bindMode;
    } else {
      o = new THREE.Mesh(mesh.geometry, T.outlineMaterial(t, color, false));
      mesh.add(o);
    }
    o.castShadow = false; o.receiveShadow = false;
    o.userData.noToon = true; o.userData.noExport = true; o.userData.fkOutline = true;
    o.name = (mesh.name || 'mesh') + '_ink';
    o.renderOrder = mesh.renderOrder;
    mesh.userData.fkOutlined = o;
    return o;
  };
  // Outline every mesh in a subtree. thickness may be a number or fn(mesh) -> number|null (null = skip).
  // Meshes with flat/split normals (hard-edged boxes) get gaps at the corners; that reads as ink
  // brush breaks and is fine, but tiny meshes (< minSize world units) are skipped to avoid noise.
  T.outlineTree = function(root, thickness, opts){
    opts = opts || {};
    const list = [];
    root.traverse(o=>{
      if (!o.isMesh || o.userData.fkOutline || o.userData.noOutline) return;
      if (o.material && (Array.isArray(o.material) ? o.material.every(m=>m.transparent && m.opacity < 0.6) : (o.material.transparent && o.material.opacity < 0.6))) return;
      if (o.material && !Array.isArray(o.material) && (o.material.type === 'MeshBasicMaterial' || o.material.type === 'ShaderMaterial') && !opts.includeBasic) return;
      list.push(o);
    });
    let n = 0;
    for (const m of list){
      if (opts.minSize){
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        const s = m.geometry.boundingSphere.radius * Math.max(m.scale.x, m.scale.y, m.scale.z);
        if (s < opts.minSize) continue;
      }
      const t = typeof thickness === 'function' ? thickness(m) : thickness;
      if (t == null) continue;
      if (T.outline(m, t, opts.color)) n++;
    }
    return n;
  };

  // ---- shared looks ----
  // Gradient sky dome (writes at the far plane, ignores fog). stops: [[dirY -1..1, hex], ...]
  T.skyDome = function(stops, opts){
    opts = opts || {};
    const n = stops.length;
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uCols: { value: stops.map(s=>new THREE.Color(s[1])) }, uH: { value: stops.map(s=>s[0]) },
        uSunDir: { value: (opts.sunDir || new THREE.Vector3(0.3,0.5,-1)).clone().normalize() },
        uSunCol: { value: new THREE.Color(opts.sunColor || 0xfff8d0) },
        uSunSize: { value: opts.sunSize || 0 }, uGlow: { value: opts.glow || 0 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 uCols[${n}]; uniform float uH[${n}]; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunSize; uniform float uGlow; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float h = d.y; vec3 c = uCols[0];
          for (int i=1;i<${n};i++){ float t = clamp((h - uH[i-1])/(uH[i]-uH[i-1]), 0.0, 1.0); if (h > uH[i-1]) c = mix(c, uCols[i], t); }
          float s = dot(d, uSunDir);
          if (uSunSize > 0.0){ float disc = smoothstep(1.0-uSunSize, 1.0-uSunSize*0.8, s); c = mix(c, uSunCol, clamp(disc + pow(max(s,0.0), 14.0)*uGlow, 0.0, 1.0)); }
          gl_FragColor = vec4(c, 1.0); }`,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(opts.radius || 600, 40, 20), mat);
    m.name = 'fkSkyDome'; m.renderOrder = -10; m.frustumCulled = false; m.userData.noToon = true;
    return m;
  };
  // Value noise (deterministic art)
  T.rng = function(seed){ let s = (seed>>>0) || 1; return () => { s ^= s<<13; s>>>=0; s ^= s>>17; s ^= s<<5; s>>>=0; return s/4294967296; }; };
})();
