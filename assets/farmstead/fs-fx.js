/* FARMSTEAD fs-fx.js — PHASE-V ambient effects layer (window.FSFX).
 *
 * Everything here is DECORATION. It reads G (map heights, terrain, fish stock,
 * serfs) and never writes a byte of it, and it draws its randomness from its
 * OWN mulberry32 stream seeded off G.seed — the sim's FSC.rng is never touched,
 * so two machines in co-op stay bit-identical no matter what the fish do.
 *
 * Everything is pooled + instanced: one InstancedMesh per effect kind, a fixed
 * cap from FSC.VIS, zero allocations once warm. FSRender.frame() calls
 * FSFX.frame(dt, G) once per frame and FSRender.dispose() calls FSFX.dispose().
 */
(function () {
  "use strict";
  const FSC = window.FSC, FSMap = window.FSMap, FSModels = window.FSModels;
  const FSFX = {};

  let scene = null, map = null, G = null, group = null, cam = null;
  let rng = null, ready = false;
  let tAcc = 0, lastMs = 0;
  const pools = {};                 // key -> { mesh, cap, n }
  const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3(), tmpE = new THREE.Euler(), tmpC = new THREE.Color();
  const xz = [0, 0];

  /** our own stream — deterministic per world, never the sim's */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------------ pools
  function pool(key, geo, material, cap, order) {
    let p = pools[key];
    if (p) return p;
    const mesh = new THREE.InstancedMesh(geo, material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = "fx:" + key;
    mesh.renderOrder = order || 5;
    mesh.setColorAt(0, tmpC.setScalar(1));
    mesh.count = 0;
    group.add(mesh);
    p = { key, mesh, cap, n: 0 };
    pools[key] = p;
    return p;
  }
  function push(p, m, color) {
    if (p.n >= p.cap) return;
    p.mesh.setMatrixAt(p.n, m);
    p.mesh.setColorAt(p.n, color || WHITE);
    p.n++;
  }
  const WHITE = new THREE.Color(1, 1, 1);
  function flush() {
    for (const k in pools) {
      const p = pools[k];
      p.mesh.count = p.n;
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      p.n = 0;
    }
  }

  // ------------------------------------------------------------- live things
  const V = () => FSC.VIS;
  const fish = [];          // { x, z, y0, t, T, dx, dz, spin, peak }
  const rings = [];         // { x, y, z, t, T, r0, r1, col }
  const drops = [];         // { x, y, z, vx, vy, vz, t, T }
  const birds = [];         // { cx, cz, r, a, spd, y, flap }
  const flies = [];         // { x, y, z, a, t, life, col, sp }
  const leaves = [];        // { x, y, z, t, T, spin, drift, col }
  const dust = [];          // { x, y, z, t, T }
  let waterCand = null;     // sampled water vertices, refreshed lazily
  let forestCand = null;    // vertices with several mature trees around them
  let fishT = 0, flyT = 0, leafT = 0, dustT = 0, siteDustT = 0, candT = 0;

  function resetLive() {
    fish.length = 0; rings.length = 0; drops.length = 0;
    birds.length = 0; flies.length = 0; leaves.length = 0; dust.length = 0;
    waterCand = null; forestCand = null;
    fishT = 0; flyT = 0; leafT = 0; dustT = 0; siteDustT = 0; candT = 0;
    deliverSeenTick = -1; sparkleCooldown = 0;   /* ===== PHASE F ===== */
  }

  /**
   * Where can a fish jump, and where do leaves fall?
   * WATER never moves, so its list is built ONCE per world. WOODS are felled and
   * replanted, so their list is refreshed — but in SLICES, walking a rolling
   * cursor over at most SCAN_SLICE vertices per call, because a full sweep of a
   * large map inside one frame is most of the ambience budget on its own.
   */
  const SCAN_SLICE = 700;
  let scanCursor = 0, forestNext = null;
  function scanWater() {
    const N = map.W * map.H, T = FSC.TERR;
    waterCand = [];
    const stride = Math.max(1, Math.floor(N / 2400));
    for (let v = 0; v < N; v += stride) {
      if (map.terr[v] !== T.WATER) continue;
      // only open water — a jump wants room, not a puddle against the shore
      let wet = 0;
      for (let d = 0; d < 6; d++) { const u = FSMap.nbr(map, v, d); if (u >= 0 && map.terr[u] === T.WATER) wet++; }
      if (wet >= 4) waterCand.push(v);
    }
  }
  function scanForestSlice() {
    const N = map.W * map.H;
    if (!forestNext) { forestNext = []; scanCursor = 0; }
    const stride = Math.max(1, Math.floor(N / 2400));
    let done = 0;
    while (scanCursor < N && done < SCAN_SLICE) {
      const v = scanCursor;
      scanCursor += stride;
      done++;
      if (!FSMap.isTree(map.obj[v])) continue;
      let trees = 0;
      for (let d = 0; d < 6; d++) { const u = FSMap.nbr(map, v, d); if (u >= 0 && FSMap.isTree(map.obj[u])) trees++; }
      if (trees >= 3) forestNext.push(v);
    }
    if (scanCursor >= N) { forestCand = forestNext; forestNext = null; }
  }
  function scanCandidates() { scanWater(); forestNext = null; scanCursor = 0; forestCand = []; while (forestNext !== null || scanCursor === 0) { scanForestSlice(); if (forestCand.length || forestNext === null) break; } }

  /** pick a candidate near where the player is looking (off-screen life is wasted) */
  function nearCam(list, tries) {
    if (!list || !list.length) return -1;
    const c = window.FSRender && FSRender.camState ? FSRender.camState() : null;
    const cx = c ? c.tx : 0, cz = c ? c.tz : 0;
    const reach = c ? Math.max(28, c.dist * 1.5) : 60;
    let best = -1;
    for (let i = 0; i < (tries || 6); i++) {
      const v = list[(rng() * list.length) | 0];
      FSMap.worldXZ(map, v, xz);
      const dx = xz[0] - cx, dz = xz[1] - cz;
      if (dx * dx + dz * dz < reach * reach) { best = v; break; }
      if (best < 0) best = v;
    }
    return best;
  }

  /**
   * A jump. `v` is a water vertex; the odds a candidate is CHOSEN scale with the
   * real fish stock there, so a shoal-rich bay boils with them and a fished-out
   * one lies flat.
   */
  function trySpawnFish() {
    if (!waterCand || !waterCand.length || fish.length >= V().FISH_MAX) return false;
    for (let k = 0; k < 8; k++) {
      const v = nearCam(waterCand, 4);
      if (v < 0) return false;
      const stock = map.fish[v] || 0;
      if (stock <= 0) continue;
      if (rng() > stock / (FSC.GEN.FISH_MAX + 1)) continue;
      return spawnFishAt(v);
    }
    return false;
  }
  function spawnFishAt(v) {
    // guard: FSRender.dispose() unbinds the layer, and FSMap.worldXZ would then
    // silently fall through to its bound-map overload and write into a number
    if (!ready || !map || v < 0 || v >= map.W * map.H) return false;
    if (fish.length >= V().FISH_MAX) return false;
    FSMap.worldXZ(map, v, xz);
    const a = rng() * 6.283, d = 0.55 + rng() * 0.55;
    const f = {
      x: xz[0] + (rng() - 0.5) * 1.2, z: xz[1] + (rng() - 0.5) * 1.2,
      dx: Math.cos(a) * d, dz: Math.sin(a) * d,
      t: 0, T: V().FISH_ARC_T * (0.82 + rng() * 0.4),
      peak: 0.55 + rng() * 0.55, spin: (rng() - 0.5) * 5, yaw: a,
      roll: (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.7),   /* ===== PHASE P ===== */
      v: v, splashed: false,
    };
    fish.push(f);
    ring(f.x, FSC.WATER_Y + 0.05, f.z, 0.55, 1.5, 0.5, 0xdff2ff);
    return true;
  }
  FSFX.spawnFish = function (v) { return spawnFishAt(v); };

  function ring(x, y, z, r0, r1, T, col) {
    if (rings.length >= V().SPLASH_MAX) rings.shift();
    rings.push({ x, y, z, r0, r1, t: 0, T, col: col === undefined ? 0xffffff : col });
  }
  function drop(x, y, z, vx, vy, vz, T) {
    if (drops.length >= V().DROP_MAX) drops.shift();
    drops.push({ x, y, z, vx, vy, vz, t: 0, T });
  }

  /* ===== PHASE F: a subtle golden sparkle over a warehouse (castle/stock)
   * when a good is actually delivered into its inventory — reuses the same
   * "ring" particle the fish splashes use, just warmer-coloured and smaller,
   * so it costs nothing new. Reads G.events with the same tick-watermark
   * pattern fs-audio.js uses (safe against the ring buffer's own splice-cap),
   * rate-limited to one sparkle per short cooldown so a busy 4x economy
   * reads as gentle periodic glimmer, never a strobe. */
  let deliverSeenTick = -1, sparkleCooldown = 0;
  const DELIVER_SCAN_CAP = 50;
  function drainDeliverySparkle(g, dt) {
    if (deliverSeenTick < 0) deliverSeenTick = g.tick;   // fresh world — skip its boot history
    sparkleCooldown -= dt;
    const evs = g.events;
    if (evs && evs.length) {
      let scanned = 0, spawned = false;
      for (let i = evs.length - 1; i >= 0 && scanned < DELIVER_SCAN_CAP; i--) {
        const e = evs[i];
        if (e.t <= deliverSeenTick) break;
        scanned++;
        if (spawned || sparkleCooldown > 0 || e.type !== "itemDeliver") continue;
        const def = FSC.BLD[e.btype];
        if (!def || !def.warehouse) continue;
        const b = g.buildings[e.bld];
        if (!b) continue;
        FSMap.worldXZ(map, b.v, xz);
        ring(xz[0] + (rng() - 0.5) * 0.9, map.height[b.v] + 0.85 + rng() * 0.5, xz[1] + (rng() - 0.5) * 0.9,
          0.10, 0.36, 0.55, 0xffe6a0);
        sparkleCooldown = 0.35 + rng() * 0.3;
        spawned = true;
      }
    }
    deliverSeenTick = g.tick;
  }

  function advanceFish(dt) {
    const wy = FSC.WATER_Y;
    for (let i = fish.length - 1; i >= 0; i--) {
      const f = fish[i];
      f.t += dt;
      if (f.t >= f.T) {
        /* PLAYTEST 2026-08-02: the landing RING is gone. It expanded to 1.9
         * world units — the widest particle in the game — while `advanceRings`
         * faded it by multiplying its colour toward BLACK on an ordinary
         * (non-additive) material, so the last two-thirds of its life was a big
         * dark annulus sitting on bright water: the reported "black circle".
         * The white spray below is the splash now, and the ring particle that
         * remains (the take-off ripple, the delivery glimmer) fades ADDITIVELY,
         * which is what that colour ramp always meant. */
        for (let k = 0; k < 5; k++) {
          const a = rng() * 6.283, s = 0.7 + rng() * 1.1;
          drop(f.x + f.dx, wy + 0.12, f.z + f.dz, Math.cos(a) * s, 1.5 + rng() * 1.4, Math.sin(a) * s, 0.55);
        }
        fish.splice(i, 1);
        continue;
      }
      const u = f.t / f.T;
      const y = wy + Math.sin(u * Math.PI) * (f.peak + 0.35);
      const x = f.x + f.dx * u, z = f.z + f.dz * u;
      // pitch follows the tangent of the arc: nose up on the way out, down on entry
      const pitch = Math.cos(u * Math.PI) * 1.05;
      /* ===== PHASE P: a leaping fish is not a rigid banana. It BEATS its
       * tail (a yaw wiggle through the body's long axis, fastest at the top
       * of the arc where it is fighting the air) and ROLLS onto its side as
       * it turns over to re-enter — the two things that read as "alive"
       * rather than "a prop on a sine". ===== */
      const beat = Math.sin(f.t * 26 + f.spin);
      const roll = Math.sin(u * Math.PI * 1.15) * f.roll;
      tmpV.set(x, y, z);
      tmpE.set(roll, f.yaw + beat * 0.30, pitch);
      tmpQ.setFromEuler(tmpE);
      const wobble = 1 + beat * 0.05;
      tmpS.set(wobble, 1 - beat * 0.03, 1);
      push(pools.fish, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.setRGB(1, 1, 1));
    }
  }

  function advanceRings(dt) {
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt;
      if (r.t >= r.T) { rings.splice(i, 1); continue; }
      const u = r.t / r.T;
      const s = r.r0 + (r.r1 - r.r0) * (1 - (1 - u) * (1 - u));
      tmpV.set(r.x, r.y, r.z);
      tmpQ.identity();
      tmpS.set(s, 1, s);
      tmpC.set(r.col).multiplyScalar(1 - u);
      push(pools.ring, tmpM.compose(tmpV, tmpQ, tmpS), tmpC);
    }
  }

  function advanceDrops(dt) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.t += dt;
      if (d.t >= d.T) { drops.splice(i, 1); continue; }
      d.vy -= 9.2 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const s = 0.075 * (1 - d.t / d.T * 0.4);
      tmpV.set(d.x, d.y, d.z);
      tmpQ.identity();
      tmpS.set(s, s * 1.5, s);
      push(pools.drop, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.setRGB(0.86, 0.95, 1));
    }
  }

  // ------------------------------------------------------------------ birds
  function ensureBirds() {
    const n = V().BIRD_N;
    while (birds.length < n) {
      const c = window.FSRender && FSRender.camState ? FSRender.camState() : { tx: 0, tz: 0 };
      birds.push({
        cx: c.tx + (rng() - 0.5) * 40, cz: c.tz + (rng() - 0.5) * 40,
        r: V().BIRD_R * (0.5 + rng() * 0.8), a: rng() * 6.283,
        spd: V().BIRD_SPD * (0.6 + rng() * 0.9) * (rng() < 0.5 ? -1 : 1),
        y: V().BIRD_Y * (0.75 + rng() * 0.6), flap: rng() * 6.283,
        drift: 0.6 + rng() * 0.8,
      });
    }
  }
  function advanceBirds(dt) {
    const c = window.FSRender && FSRender.camState ? FSRender.camState() : { tx: 0, tz: 0, ty: 0 };
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      b.a += b.spd * dt;
      // the flock drifts lazily back toward whatever the player is looking at
      b.cx += (c.tx - b.cx) * Math.min(1, dt * 0.05);
      b.cz += (c.tz - b.cz) * Math.min(1, dt * 0.05);
      const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r;
      b.flap += dt * 9.5;
      /* ===== PHASE P: a real flap. The wings hinge at the shoulder (down
       * stroke well below the body, up stroke well above); the body RISES a
       * little on each down-stroke instead of squashing, and banks into the
       * turn. Nothing scales any more. ===== */
      const s = Math.sin(b.flap);
      const y = (c.ty || 0) + b.y + Math.sin(b.a * 1.7) * 1.3 + s * 0.10;
      const yaw = -b.a + (b.spd > 0 ? -Math.PI / 2 : Math.PI / 2);
      const bank = 0.34 * (b.spd > 0 ? 1 : -1);
      tmpV.set(x, y, z);
      tmpE.set(0, yaw, bank);
      tmpQ.setFromEuler(tmpE);
      tmpS.set(1, 1, 1);
      push(pools.bird, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.setScalar(0.95));
      pushWings(pools.birdwing, tmpM, s * 0.85, 0.055, tmpC.setScalar(0.92 + 0.08 * s));
    }
  }

  /* ===== PHASE P: hinge a pair of wings under an already-composed body
   * matrix. `flap` is the shoulder angle in radians (+ = up-stroke); the two
   * wings mirror each other about the body's long axis. ===== */
  const wM = new THREE.Matrix4(), wM2 = new THREE.Matrix4(), wM3 = new THREE.Matrix4();
  const wV = new THREE.Vector3(), wZero = new THREE.Vector3(0, 0, 0);
  const wQ = new THREE.Quaternion(), wQ2 = new THREE.Quaternion();
  const wE = new THREE.Euler(), wOne = new THREE.Vector3(1, 1, 1);
  function pushWings(pool, body, flap, lift, color) {
    if (!pool) return;
    for (let s = -1; s <= 1; s += 2) {
      // side flip is a 180° YAW, never a negative scale — a mirrored instance
      // would flip the winding and vanish under front-face culling
      wV.set(0, lift, 0);
      wE.set(0, s < 0 ? Math.PI : 0, 0); wQ.setFromEuler(wE);
      wM.compose(wV, wQ, wOne);
      wE.set(-flap, 0, 0); wQ2.setFromEuler(wE);
      wM3.compose(wZero, wQ2, wOne);
      wM.multiply(wM3);                      // T · Ryaw · Rhinge
      wM2.multiplyMatrices(body, wM);
      push(pool, wM2, color);
    }
  }

  // ------------------------------------------------------------- butterflies
  function trySpawnFly() {
    if (flies.length >= V().BFLY_MAX) return;
    const c = window.FSRender && FSRender.camState ? FSRender.camState() : { tx: 0, tz: 0 };
    if (c.dist !== undefined && c.dist > 46) return;      // too far out to read
    const a = rng() * 6.283, d = rng() * V().BFLY_R;
    const x = c.tx + Math.cos(a) * d, z = c.tz + Math.sin(a) * d;
    const v = FSMap.nearestVertex(map, x, z);
    if (v < 0 || map.terr[v] !== FSC.TERR.GRASS) return;
    flies.push({
      x: x, y: map.height[v] + 0.45 + rng() * 0.5, z: z,
      a: rng() * 6.283, t: 0, life: 9 + rng() * 9,
      col: V().FLOWER_COL[(rng() * V().FLOWER_COL.length) | 0],
      sp: 0.45 + rng() * 0.5, bob: rng() * 6.283, gy: map.height[v],
    });
  }
  function advanceFlies(dt) {
    for (let i = flies.length - 1; i >= 0; i--) {
      const f = flies[i];
      f.t += dt;
      if (f.t >= f.life) { flies.splice(i, 1); continue; }
      f.a += (rng() - 0.5) * dt * 3.2;
      f.x += Math.cos(f.a) * f.sp * dt;
      f.z += Math.sin(f.a) * f.sp * dt;
      f.bob += dt * 5.5;
      const y = f.gy + 0.42 + Math.sin(f.bob) * 0.20 + Math.sin(f.t * 0.7) * 0.12;
      const fade = Math.min(1, Math.min(f.t, f.life - f.t) * 1.6);
      /* ===== PHASE P: butterflies clap their wings nearly shut and open them
       * flat again — the biggest, most readable flap in nature. It was a
       * scale.z squash, which just made the whole insect narrower. ===== */
      const flap = 0.15 + 1.15 * (0.5 + 0.5 * Math.sin(f.bob * 2.4));
      tmpV.set(f.x, y, f.z);
      tmpE.set(0, -f.a, Math.sin(f.bob) * 0.25);
      tmpQ.setFromEuler(tmpE);
      tmpS.set(1, 1, 1);
      push(pools.fly, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.set(f.col).multiplyScalar(fade));
      pushWings(pools.flywing, tmpM, flap, 0.014, tmpC.set(f.col).multiplyScalar(fade));
    }
  }

  // ------------------------------------------------------------- forest leaves
  function trySpawnLeaf() {
    if (!forestCand || !forestCand.length || leaves.length >= V().LEAF_FALL_MAX) return;
    const v = nearCam(forestCand, 4);
    if (v < 0) return;
    FSMap.worldXZ(map, v, xz);
    const sp = FSMap.species(v);
    const col = sp === 2 ? FSC.VIS.LEAF_B[2] : (sp === 1 ? FSC.VIS.LEAF_B[1] : FSC.VIS.LEAF_A[0]);
    leaves.push({
      x: xz[0] + (rng() - 0.5) * 1.6, z: xz[1] + (rng() - 0.5) * 1.6,
      y: map.height[v] + 1.6 + rng() * 1.2, gy: map.height[v],
      t: 0, T: 3.4 + rng() * 2.6, spin: (rng() - 0.5) * 4,
      drift: rng() * 6.283, col: col,
    });
  }
  function advanceLeaves(dt) {
    for (let i = leaves.length - 1; i >= 0; i--) {
      const L = leaves[i];
      L.t += dt;
      if (L.t >= L.T || L.y <= L.gy + 0.03) { leaves.splice(i, 1); continue; }
      L.y -= 0.42 * dt;
      L.drift += dt * 2.1;
      const x = L.x + Math.sin(L.drift) * 0.32, z = L.z + Math.cos(L.drift * 0.7) * 0.26;
      const fade = Math.min(1, (L.T - L.t) * 1.2);
      tmpV.set(x, L.y, z);
      tmpE.set(L.drift * 0.8, L.t * L.spin, Math.sin(L.drift) * 0.9);
      tmpQ.setFromEuler(tmpE);
      tmpS.set(1, 1, 1);
      push(pools.leaf, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.set(L.col).multiplyScalar(0.75 + 0.25 * fade));
    }
  }

  // ------------------------------------------------------------- road dust
  function trySpawnDust() {
    if (!G || !G.serfs || dust.length >= V().DUST_MAX) return;
    const ids = Object.keys(G.serfs);
    if (!ids.length) return;
    for (let k = 0; k < 4; k++) {
      const s = G.serfs[ids[(rng() * ids.length) | 0]];
      if (!s || !s.carry || s.from === s.to) continue;
      if (map.terr[s.from] === FSC.TERR.WATER) continue;
      FSMap.worldXZ(map, s.from, xz);
      dust.push({ x: xz[0] + (rng() - 0.5) * 0.5, y: map.height[s.from] + 0.06, z: xz[1] + (rng() - 0.5) * 0.5, t: 0, T: 1.1 + rng() * 0.6 });
      return;
    }
  }
  /* ===== PHASE F: construction dust — a building actively being hammered on
   * (state 'build' with a builder crew present, same condition fs-audio.js
   * gates its hammer-tap SFX on) puffs a little dust now and then. Reuses the
   * SAME pool/particle as road dust — one more spawn SOURCE feeding the
   * existing system rather than a whole new pool. */
  function trySpawnSiteDust() {
    if (!G || !G.buildings || dust.length >= V().DUST_MAX) return;
    const ids = Object.keys(G.buildings);
    if (!ids.length) return;
    for (let k = 0; k < 5; k++) {
      const b = G.buildings[ids[(rng() * ids.length) | 0]];
      if (!b || b.state !== "build" || !b.crew) continue;
      FSMap.worldXZ(map, b.v, xz);
      dust.push({ x: xz[0] + (rng() - 0.5) * 1.5, y: map.height[b.v] + 0.05, z: xz[1] + (rng() - 0.5) * 1.5, t: 0, T: 1.3 + rng() * 0.7 });
      return;
    }
  }
  function advanceDust(dt) {
    for (let i = dust.length - 1; i >= 0; i--) {
      const d = dust[i];
      d.t += dt;
      if (d.t >= d.T) { dust.splice(i, 1); continue; }
      const u = d.t / d.T;
      const s = 0.26 + u * 0.7;
      tmpV.set(d.x, d.y + u * 0.22, d.z);
      tmpE.set(-Math.PI / 2, 0, u * 1.4); tmpQ.setFromEuler(tmpE);
      tmpS.set(s, s, s);
      push(pools.dust, tmpM.compose(tmpV, tmpQ, tmpS), tmpC.setRGB(0.80, 0.73, 0.58).multiplyScalar(0.55 * (1 - u)));
    }
  }

  // ------------------------------------------------------------------- setup
  function build(g) {
    FSFX.dispose();
    G = g;
    map = g.map;
    scene = window.FSRender ? FSRender.scene() : null;
    if (!scene) return false;
    rng = mulberry32(((g.seed || 1) ^ 0xBEEF) >>> 0);
    group = new THREE.Group();
    group.name = "fx";
    scene.add(group);
    const B = V();
    pool("ring", FSModels.ringGeo(), FSModels.ringMat(), B.SPLASH_MAX, 6);
    pool("fish", FSModels.fishGeo(), FSModels.vcMat("fx:fish", 0xcfe2f0, 0.5), B.FISH_MAX, 6);
    pool("drop", FSModels.moteGeo(), FSModels.vcMat("fx:drop", 0xcfe8ff, 0.6), B.DROP_MAX, 6);
    pool("bird", FSModels.birdGeo(), FSModels.vcMat("fx:bird", 0x50596a, 0.42), B.BIRD_N + 2, 5);
    /* ===== PHASE P: wings are their own instanced pools so they can hinge ===== */
    pool("birdwing", FSModels.birdWingGeo(), FSModels.vcMat("fx:bird", 0x50596a, 0.42), (B.BIRD_N + 2) * 2, 5);
    pool("fly", FSModels.butterflyGeo(), FSModels.vcMat("fx:fly", 0xf0e0c0, 0.62), B.BFLY_MAX, 5);
    pool("flywing", FSModels.butterflyWingGeo(), FSModels.vcMat("fx:fly", 0xf0e0c0, 0.62), B.BFLY_MAX * 2, 5);
    pool("leaf", FSModels.leafGeo(), FSModels.vcMat("fx:leaf", 0x6f9440, 0.5), B.LEAF_FALL_MAX, 5);
    pool("dust", FSModels.puffGeo(), FSModels.puffMat("dust", 0xd8cbaa), B.DUST_MAX, 5);
    resetLive();
    scanWater();
    scanCandidates();
    ensureBirds();
    ready = true;
    return true;
  }

  /**
   * One frame of ambient life. Cheap by construction: fixed pools, integer
   * loops over a handful of live effects, no allocation once warm.
   */
  FSFX.frame = function (dt, g) {
    if (!g || !g.map) return 0;
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (!ready || g !== G || !scene || (window.FSRender && FSRender.scene() !== scene)) {
      if (!build(g)) return 0;
    }
    /* PLAYTEST 2026-08-02: fs-render now hands this GAME time, not wall time
     * (dt x the sim speed), so the world's ambient life runs at 4x when the
     * game does and stops dead when it is paused. `dt || 0.016` used to turn a
     * genuine ZERO into a sixtieth of a second — a paused world kept boiling
     * with jumping fish — so the default is only applied when dt is absent. */
    dt = Math.min(0.1, dt === undefined || dt === null ? 0.016 : dt);
    tAcc += dt;
    const B = V();
    // spawn clocks — everything is rate limited so a slow frame cannot burst
    fishT -= dt;
    if (fishT <= 0) {
      fishT = 1 / Math.max(0.02, B.FISH_BASE_HZ + B.FISH_STOCK_K * 4);
      trySpawnFish();
    }
    flyT -= dt;
    if (flyT <= 0) { flyT = 1.6 + rng() * 2.2; trySpawnFly(); }
    leafT -= dt;
    if (leafT <= 0) { leafT = 0.55 + rng() * 1.1; trySpawnLeaf(); }
    dustT -= dt;
    if (dustT <= 0) { dustT = 0.9 + rng() * 1.4; trySpawnDust(); }
    siteDustT -= dt;                                          /* ===== PHASE F ===== */
    if (siteDustT <= 0) { siteDustT = 1.1 + rng() * 1.6; trySpawnSiteDust(); }
    drainDeliverySparkle(g, dt);                                /* ===== PHASE F ===== */
    // forests grow and are felled: refresh their list a slice at a time
    scanForestSlice();

    advanceFish(dt);
    advanceRings(dt);
    advanceDrops(dt);
    advanceBirds(dt);
    advanceFlies(dt);
    advanceLeaves(dt);
    advanceDust(dt);
    flush();
    lastMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    return lastMs;
  };

  FSFX.dispose = function () {
    if (group && scene) scene.remove(group);
    for (const k in pools) { if (group) group.remove(pools[k].mesh); pools[k].mesh.dispose(); delete pools[k]; }
    group = null; scene = null; G = null; map = null; ready = false;
    resetLive();
  };

  /** live counts + last frame cost — the visuals suite reads this */
  FSFX.info = function () {
    return {
      ready: ready, ms: lastMs,
      fish: fish.length, rings: rings.length, drops: drops.length,
      birds: birds.length, flies: flies.length, leaves: leaves.length, dust: dust.length,
      waterCand: waterCand ? waterCand.length : 0,
      forestCand: forestCand ? forestCand.length : 0,
      pools: Object.keys(pools),
      draws: (function () { let n = 0; for (const k in pools) if (pools[k].mesh.count > 0) n++; return n; })(),
    };
  };
  /** test hook: force the candidate scan (e.g. right after felling a wood) */
  FSFX.rescan = function () { if (ready) { scanWater(); scanCandidates(); } return FSFX.info(); };
  /** test hook: how likely is a jump at this vertex right now (0 = dead water) */
  FSFX.fishOdds = function (v) {
    if (!map || map.terr[v] !== FSC.TERR.WATER) return 0;
    return (map.fish[v] || 0) / (FSC.GEN.FISH_MAX + 1);
  };

  window.FSFX = FSFX;
})();
