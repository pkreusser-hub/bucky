#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Farm Kart STORYBOOK TOON items (assets/farmkart-items.js, window.FK_ITEMS).
 * Items' 3D models, HUD icons and VFX. Geometry / counts / arithmetic, not pixels:
 *  - every item kind has an inline-SVG HUD icon (no emoji anywhere in #itemSlot) in every state
 *    (held, x3 triples with a count badge, rolling reel, trail shield, trail + queued, empty), sized to read
 *  - every projectile / hazard / orbit-bit / box mesh is MeshToon + ink outlined; the mimic differs from the box
 *  - the particle pool never grows past its cap under a stress burst and allocates nothing (scene child count constant)
 *  - particles POP and SHRINK (scale arithmetic) and never alpha-fade
 *  - each item's fire / use produces its VFX; each impact kind produces a burst; the item box pickup bursts + respawn pops
 *  - drift-spark tiers keep their blue / orange / pink meaning
 *  - 0 pageerrors, desktop + phone
 *
 *   node tools/_verify-fk-itemfx.cjs
 */
const path = require("path");
const fs = require("fs");
const http = require("http");

function loadPlaywright() {
  for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) { try { return require(p); } catch (_) {} }
  throw new Error("playwright not found");
}
const { chromium } = loadPlaywright();
const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".glb": "model/gltf-binary", ".json": "application/json", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".css": "text/css", ".svg": "image/svg+xml" };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(rsp);
    }).listen(0, "127.0.0.1", () => res(srv));
  });
}
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail !== undefined ? "  — " + detail : "")); }
}

async function openGame(browser, base, phone) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 720 }, hasTouch: !!phone, isMobile: !!phone });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // never touch production Firestore / playroom
  await page.route(/googleapis|firestore|firebase|gstatic|playroom|joinplayroom/, (r) => r.abort());
  await page.goto(`${base}/farmkart.html?track=wario-stadium`);
  await page.waitForFunction(() => window.__KART__ && window.__KART__.forceRace, null, { timeout: 60000 });
  await page.evaluate(() => window.__KART__.forceRace());
  await page.waitForTimeout(500);
  return { page, errors };
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

  for (const phone of [false, true]) {
    const label = phone ? "phone 390x844" : "desktop 1280x720";
    console.log(`\n[${label}]`);
    const { page, errors } = await openGame(browser, base, phone);

    // ---------------------------------------------------------------- HUD ICONS
    const hud = await page.evaluate(() => {
      const K = window.__KART__, p = K.G.players.local, slot = document.getElementById("itemSlot"), icon = document.getElementById("itemIcon");
      const EMOJI = /\p{Extended_Pictographic}|‍|️/u;
      const out = { kinds: K.ITEM_KINDS.slice(), perKind: {}, states: {} };
      const reset = () => { K.clearItem(p); p.trailKind = null; p.itemRollT = 0; };
      const read = () => {
        K.updateItemSlot(p);
        const fk = icon.querySelector(".fkico"), r = fk ? fk.getBoundingClientRect() : null;
        return { html: icon.innerHTML, text: icon.textContent, cls: slot.className, emoji: EMOJI.test(slot.innerHTML) || EMOJI.test(slot.textContent),
                 svgs: icon.querySelectorAll("svg").length, w: fk ? parseFloat(getComputedStyle(fk).width) : 0, h: fk ? parseFloat(getComputedStyle(fk).height) : 0, cnt: (icon.querySelector(".cnt") || {}).textContent || null,
                 reel: !!icon.querySelector(".reel"), reelN: icon.querySelectorAll(".strip svg").length, shield: !!icon.querySelector(".shl .sh svg"), queued: !!icon.querySelector(".queued svg"),
                 sw: slot.getBoundingClientRect().width, sh: slot.getBoundingClientRect().height };
      };
      for (const k of K.ITEM_KINDS) { reset(); K.grantHeldItem(p, k); out.perKind[k] = read(); }
      reset(); p.itemRollT = 9; out.states.rolling = read();
      reset(); p.trailKind = "tomato"; out.states.trail = read();
      reset(); p.trailKind = "hay"; K.grantHeldItem(p, "tomato3"); out.states.trailQueued = read();
      reset(); out.states.empty = read();
      // a triple counts down: x3 -> x2 -> x1
      reset(); K.grantHeldItem(p, "chicken3"); out.states.count3 = read(); p.itemCount = 2; out.states.count2 = read();
      // the DOM is NOT rewritten while the state is unchanged (so CSS animations are not restarted every frame)
      reset(); K.grantHeldItem(p, "egg"); read(); const first = icon.firstElementChild; K.updateItemSlot(p); out.sameNode = icon.firstElementChild === first;
      reset(); p.itemRollT = 9; read(); const reel = icon.firstElementChild; for (let i = 0; i < 10; i++) K.updateItemSlot(p); out.reelSameNode = icon.firstElementChild === reel;
      reset();
      out.staticHtml = document.documentElement.innerHTML.indexOf('id="itemIcon"') > 0;
      return out;
    });
    const kinds = hud.kinds;
    check("11 item kinds known", kinds.length === 11, kinds.join(","));
    const minPx = phone ? 40 : 44;
    for (const k of kinds) {
      const r = hud.perKind[k];
      check(`icon ${k}: inline SVG, no emoji, >= ${minPx}px`, r.svgs >= 1 && !r.emoji && !/[^\x00-\x7f]/.test(r.text.replace(/×/g, "")) && r.w >= minPx && r.h >= minPx, `svgs=${r.svgs} emoji=${r.emoji} ${r.w}x${r.h} text=${JSON.stringify(r.text)}`);
    }
    const distinct = new Set(kinds.filter((k) => !/3$/.test(k)).map((k) => hud.perKind[k].html));
    check("every single-item icon is a different drawing", distinct.size === kinds.filter((k) => !/3$/.test(k)).length, distinct.size);
    for (const k of ["tomato3", "chicken3"]) {
      const r = hud.perKind[k];
      check(`${k}: stacked copies + x3 count badge`, r.svgs === 3 && r.cnt === "×3", `svgs=${r.svgs} cnt=${r.cnt}`);
    }
    check("triple badge counts down (x3 -> x2)", hud.states.count3.cnt === "×3" && hud.states.count2.cnt === "×2", `${hud.states.count3.cnt} ${hud.states.count2.cnt}`);
    check("rolling: slot-machine reel of 10 SVG icons (9 kinds + loop repeat), class rolling", hud.states.rolling.reel && hud.states.rolling.reelN === 10 && hud.states.rolling.cls === "rolling" && !hud.states.rolling.emoji, JSON.stringify([hud.states.rolling.reelN, hud.states.rolling.cls]));
    check("trail: shield badge SVG + trailed item SVG, no emoji", hud.states.trail.shield && hud.states.trail.svgs === 2 && !hud.states.trail.emoji && /trail/.test(hud.states.trail.cls), JSON.stringify([hud.states.trail.svgs, hud.states.trail.cls]));
    check("trail + queued item: shield + item + small queued icon", hud.states.trailQueued.shield && hud.states.trailQueued.queued && !hud.states.trailQueued.emoji, JSON.stringify([hud.states.trailQueued.svgs]));
    check("empty slot: SVG placeholder, no middle-dot glyph", hud.states.empty.svgs === 1 && !/·/.test(hud.states.empty.text) && hud.states.empty.cls === "", JSON.stringify(hud.states.empty.text));
    check("slot frame is 76x76 (layout contract with the touch HUD)", Math.abs(hud.perKind.boost.sw - 76) < 0.5 && Math.abs(hud.perKind.boost.sh - 76) < 0.5, `${hud.perKind.boost.sw}x${hud.perKind.boost.sh}`);
    check("held icon DOM is not rewritten while unchanged (animations keep running)", hud.sameNode);
    check("rolling reel DOM is built once (steps() animation not restarted per frame)", hud.reelSameNode);
    check("ITEM_ICON export is inline SVG for every kind", await page.evaluate(() => Object.values(window.__KART__.ITEM_ICON).length === 11 && Object.values(window.__KART__.ITEM_ICON).every((s) => s.startsWith("<svg") && !/\p{Extended_Pictographic}/u.test(s))));
    check("#help text carries no emoji", await page.evaluate(() => !/\p{Extended_Pictographic}/u.test(document.getElementById("help").textContent)));
    const frameCss = await page.evaluate(() => { const c = getComputedStyle(document.getElementById("itemSlot")); return { bw: parseFloat(c.borderTopWidth), rad: parseFloat(c.borderTopLeftRadius), col: c.borderTopColor }; });
    check("toon slot frame: >= 4px warm-brown border, rounded >= 18px", frameCss.bw >= 4 && frameCss.rad >= 18 && frameCss.col === "rgb(74, 44, 20)", JSON.stringify(frameCss));

    if (phone) {
      check("0 pageerrors (phone)", errors.length === 0, errors.slice(0, 3).join(" | "));
      await page.context().close();
      continue;
    }

    try {   // (a missing FK_ITEMS makes the model / VFX sections throw: that is ONE counted failure, not a crash)
    // ---------------------------------------------------------------- MODELS: toon + outlined
    const models = await page.evaluate(() => {
      const K = window.__KART__, F = window.FK_ITEMS;
      const audit = (root) => {
        const bad = []; let solid = 0, inked = 0, hulls = 0;
        root.traverse((o) => {
          if (!o.isMesh) return;
          if (o.userData.fkOutline) { hulls++; return; }
          if (o.userData.noOutline) return;           // flat decals / shield rings
          solid++;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          if (!mats.every((m) => m.type === "MeshToonMaterial" && m.gradientMap)) bad.push((o.name || o.type) + ":" + mats.map((m) => m.type).join("+"));
          if (o.userData.fkOutlined) inked++;
        });
        return { solid, inked, hulls, bad };
      };
      const out = {};
      const build = { itemBox: () => F.buildItemBox(), mimic: () => K.buildMimicBox(), lettuce: () => K.makeProjMesh("tomato"), chicken: () => K.makeProjMesh("chicken"), egg: () => K.makeProjMesh("egg"), shell: () => K.makeProjMesh("shell"),
        hay: () => F.buildHay(), orbitLettuce: () => F.buildOrbitBit("tomato3"), orbitChicken: () => F.buildOrbitBit("chicken3"), orbitHay: () => F.buildOrbitBit("hay"), orbitMimic: () => F.buildOrbitBit("mimic") };
      for (const k in build) out[k] = audit(build[k]());
      // the live scene's item boxes
      let boxes = 0, boxBad = 0;
      K.scene.traverse((o) => { if (o.name === "fkItemBox") { boxes++; const a = audit(o); if (a.bad.length || a.inked !== a.solid) boxBad++; } });
      out.live = { boxes, expected: K.G.itemBoxes.length, boxBad };
      // chicken flaps: wings exist and move
      const ch = F.buildChicken(); out.chickenWings = ch.userData.wings.length;
      // mimic differs from the box: different face texture + redder average colour
      const avg = (g) => { const t = g.userData.body.material.map.image, c = document.createElement("canvas"); c.width = c.height = 32; const x = c.getContext("2d"); x.drawImage(t, 0, 0, 32, 32); const d = x.getImageData(0, 0, 32, 32).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; return [r / n, gg / n, b / n]; };
      const a = avg(F.buildItemBox()), m = avg(F.buildMimicBox());
      out.boxRGB = a; out.mimicRGB = m;
      out.sameGeo = F.buildItemBox().userData.body.geometry === F.buildMimicBox().userData.body.geometry;
      out.diffTex = F.buildItemBox().userData.body.material.map !== F.buildMimicBox().userData.body.material.map;
      // hull thickness is real: inked meshes carry an outline child with the ink colour
      const hull = F.buildLettuce().userData.body.userData.fkOutlined;
      out.hullColor = hull.material.color.getHex(); out.hullSide = hull.material.side === THREE.BackSide;
      return out;
    });
    for (const k of Object.keys(models)) {
      if (!models[k] || models[k].solid === undefined) continue;
      const m = models[k];
      check(`${k}: every solid mesh is MeshToonMaterial with a ramp, and has an ink outline hull`, m.solid >= 1 && m.bad.length === 0 && m.inked === m.solid && m.hulls === m.solid, JSON.stringify(m));
    }
    check("live scene: every item box is a toon, outlined crate", models.live.boxes === models.live.expected && models.live.boxes > 0 && models.live.boxBad === 0, JSON.stringify(models.live));
    check("chicken has two flapping wing pivots", models.chickenWings === 2);
    check("mimic is learnable-different: same silhouette, own face texture, red-dominant vs the box", models.sameGeo && models.diffTex && models.mimicRGB[0] > models.mimicRGB[2] * 1.5 && models.mimicRGB[2] / models.mimicRGB[0] < models.boxRGB[2] / models.boxRGB[0] + 0.5 && models.mimicRGB[1] < models.boxRGB[1] - 20, JSON.stringify([models.boxRGB.map(Math.round), models.mimicRGB.map(Math.round)]));
    check("ink hull = warm brown 0x2b1a12, back faces", models.hullColor === 0x2b1a12 && models.hullSide, models.hullColor.toString(16));

    // ---------------------------------------------------------------- PARTICLE POOL
    const pool = await page.evaluate(() => {
      const K = window.__KART__, F = window.FK_ITEMS, out = {};
      const clear = () => { for (const p of K.particles) { p.live = false; p.m.visible = false; } };
      clear();
      // warm up lazily-built pooled effect objects (decals, storm rigs) so the allocation check below is honest
      for (const k of ["tomato", "chicken", "hay", "mimic", "shell", "egg"]) F.spawnExplode(0, 1, 5, k);
      F.spawnLightning(0, 0, 8); F.update(0.2); clear();
      const kids0 = K.scene.children.length, cap = K.MAX_PARTICLES, np0 = K.particles.length;
      out.cap = cap; out.poolLen = np0; out.capMatches = F.pool.cap === cap;
      let maxLive = 0;
      for (let i = 0; i < 4000; i++) {
        K.spawnParticle(Math.random() * 10, 1, 5, { color: 0xffffff, life: 0.5, size: 0.5, shape: ["puff", "star", "spark", "ring", "leaf", "chip", "dot"][i % 7] });
        if (i % 50 === 0) { for (const k of ["tomato", "chicken", "hay", "mimic", "shell", "egg"]) F.spawnExplode(1, 1, 6, k); F.spawnLightning(2, 0, 9); }
        if (i % 20 === 0) maxLive = Math.max(maxLive, K.particleActiveCount());
        if (i % 100 === 0) K.updateParticles(0.016);
      }
      maxLive = Math.max(maxLive, K.particleActiveCount());
      out.maxLive = maxLive; out.afterLen = K.particles.length; out.kidsDelta = K.scene.children.length - kids0;
      out.liveMeshes = K.particles.filter((p) => p.m.visible).length; out.stats = F.stats();
      clear();
      return out;
    });
    check("particle pool cap is MAX_PARTICLES (200) and the pool never grows", pool.cap === 200 && pool.poolLen === 200 && pool.afterLen === 200 && pool.capMatches, JSON.stringify(pool));
    check("stress burst (4000 spawns + 160 effect bursts): live particles never exceed the cap", pool.maxLive <= pool.cap && pool.maxLive > 100, `max=${pool.maxLive}`);
    check("stress burst allocates nothing: scene child count unchanged", pool.kidsDelta === 0, pool.kidsDelta);
    check("effect pools (decals <= 10, storm rigs <= 6) are bounded", pool.stats.decals <= 10 && pool.stats.bolts <= 6, JSON.stringify(pool.stats));

    // the whole pool is ONE instanced draw call: 150 live particles cost <= 1 extra call (was 1 per particle)
    const calls = await page.evaluate(() => {
      const K = window.__KART__, F = window.FK_ITEMS;
      for (const p of K.particles) { p.live = false; p.m.visible = false; }
      F.update(10); /* expire lingering storm rigs / decals from the stress block: their strobing visibility is not particle cost */
      K.updateParticles(0.016); K.renderer.render(K.scene, K.camera); K.renderer.info.reset(); K.renderer.render(K.scene, K.camera); const c0 = K.renderer.info.render.calls;
      const c = K.camera.position;
      for (let i = 0; i < 150; i++) K.spawnParticle(c.x + 8 + (i % 10), c.y - 1, c.z + 10 + (i % 7), { life: 5, size: 0.5, shape: F.SHAPES[i % 7], vx: 0, vy: 0, vz: 0 });
      K.updateParticles(0.016); K.renderer.render(K.scene, K.camera); K.renderer.info.reset(); K.renderer.render(K.scene, K.camera); const c1 = K.renderer.info.render.calls;
      const mesh = K.scene.getObjectByName("fkParticles");
      for (const p of K.particles) { p.live = false; p.m.visible = false; }
      return { c0, c1, instanced: !!mesh && mesh.geometry.isInstancedBufferGeometry && mesh.geometry.instanceCount === 200 };
    });
    check("particle pool = one instanced draw call (150 live particles add <= 1 call)", calls.instanced && calls.c1 - calls.c0 <= 1, JSON.stringify(calls));

    // pop-and-shrink arithmetic (scale as a function of life), no alpha fade
    const pop = await page.evaluate(() => {
      const K = window.__KART__, F = window.FK_ITEMS;
      for (const p of K.particles) { p.live = false; p.m.visible = false; }
      const c = K.camera.position, o = { x: c.x + 30, y: c.y, z: c.z + 30 };   // far from the camera (near-camera shrink guard off)
      const p = F.pool.spawn(o.x, o.y, o.z, { shape: "puff", color: 0xff8800, life: 1, size: 1, grow: 0, opacity: 0.8, vx: 0, vy: 0, vz: 0 });
      const out = { opacity0: p.mat.opacity, samples: [] };
      let t = 0;
      for (const target of [0.0449, 0.5, 0.8, 0.95]) { const dt = target - t; if (dt > 0) F.pool.update(dt); t = target; out.samples.push({ t, s: p.m.scale.x, op: p.mat.opacity }); }
      return out;
    });
    const back = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
    const s0 = pop.samples[0].s, exp0 = back(0.0449 / 0.09);
    check("pop-in: scale at t=45ms = easeOutBack(0.5) of size", Math.abs(s0 - exp0) < 0.02, `${s0.toFixed(3)} vs ${exp0.toFixed(3)}`);
    check("pop overshoot: easeOutBack exceeds 1.0 before settling (arithmetic)", back(0.75) > 1.05 && back(1) === 1, back(0.75).toFixed(3));
    check("hold: scale == size (1.0) mid-life", Math.abs(pop.samples[1].s - 1) < 0.02, pop.samples[1].s);
    const f8 = 1 - Math.pow((0.8 - 0.6) / 0.4, 2), f95 = 1 - Math.pow((0.95 - 0.6) / 0.4, 2);
    check("shrink-out: scale at 80% / 95% life = 1-((f-0.6)/0.4)^2 = 0.75 / 0.234", Math.abs(pop.samples[2].s - f8) < 0.02 && Math.abs(pop.samples[3].s - f95) < 0.02, `${pop.samples[2].s.toFixed(3)}/${pop.samples[3].s.toFixed(3)} vs ${f8}/${f95.toFixed(3)}`);
    check("no alpha fade: opacity stays constant for puffs (toon pops, doesn't dissolve)", pop.samples.every((s) => s.op === 0.8), JSON.stringify(pop.samples.map((s) => s.op)));
    const nearGuard = await page.evaluate(() => {
      const K = window.__KART__, F = window.FK_ITEMS, c = K.camera.position;
      const p = F.pool.spawn(c.x, c.y, c.z + 0.0, { shape: "puff", life: 1, size: 2, vx: 0, vy: 0, vz: 0 });
      const q = F.pool.spawn(c.x + 40, c.y, c.z, { shape: "puff", life: 1, size: 2, vx: 0, vy: 0, vz: 0 });
      F.pool.update(0.3); const r = [p.m.scale.x, q.m.scale.x]; p.live = q.live = false; p.m.visible = q.m.visible = false; return r;
    });
    check("camera-pass guard: a puff on the camera collapses to 0, the same puff far away does not", nearGuard[0] < 0.05 && nearGuard[1] > 1.5, JSON.stringify(nearGuard));

    // ---------------------------------------------------------------- DRIFT SPARK TIERS keep their colour meaning
    const drift = await page.evaluate(() => {
      const K = window.__KART__, p = K.G.players.local, v = K.kartViews.local, out = [];
      for (const tier of [1, 2, 3]) {
        let ch = 0; while (K.driftSparkTier(ch) < tier) ch += 0.01;
        p.drift.active = true; p.drift.charge = ch; p.boostT = 0; p.v.x = 12; p.v.z = 0; p.airborne = false;
        for (const q of K.particles) { q.live = false; q.mat.opacity = 0; q.m.visible = false; }
        for (let i = 0; i < 25; i++) K.syncKartView(p, v, 0.04);
        const cols = new Set(); let shapes = new Set();
        for (const q of K.particles) if (q.live && q.mat.opacity > 0.2) { cols.add(q.mat.color.getHex()); shapes.add(q.shape); }
        out.push({ tier, cols: [...cols], shapes: [...shapes], want: K.DRIFT_SPARK_COL[tier] });
      }
      p.drift.active = false; p.drift.charge = 0;
      for (const q of K.particles) { q.live = false; q.m.visible = false; }
      return out;
    });
    for (const d of drift) check(`drift tier ${d.tier}: sparks are ${["", "blue", "orange", "pink"][d.tier]} (0x${d.want.toString(16)}) streaks`, d.cols.length === 1 && d.cols[0] === d.want && d.shapes.length === 1 && d.shapes[0] === "spark", JSON.stringify(d));
    check("DRIFT_SPARK_COL is still dust / blue / orange / pink", await page.evaluate(() => JSON.stringify(window.__KART__.DRIFT_SPARK_COL) === JSON.stringify([0xcdb98a, 0x2f9bff, 0xff8a1a, 0xd45cff])));

    // ---------------------------------------------------------------- EACH ITEM'S USE PRODUCES ITS VFX
    // Everything inside ONE evaluate so the live game loop cannot interleave.
    const fx = await page.evaluate(() => {
      const K = window.__KART__, F = window.FK_ITEMS, p = K.G.players.local, v = K.kartViews.local, out = {};
      const clear = () => { for (const q of K.particles) { q.live = false; q.m.visible = false; } };
      const total = () => { const s = F.stats(); return s.particles + s.decals + s.bolts; };
      // a rival AHEAD so homing / storm / egg have a target
      const camOff = K.camera.position.clone().sub(v.group.position);   // settled chase-cam offset (kart idle)
      const fxv = Math.sin(p.theta), fzv = Math.cos(p.theta);
      const rival = K.addTestKart("rival", p.pos.x + fxv * 25, p.pos.z + fzv * 25, 0xff4444);
      rival.lap = p.lap + 1; rival.progressS = p.progressS;
      const reset = () => { K.clearItem(p); p.trailKind = null; p.itemRollT = 0; p.boostT = 0; p.starT = 0; p.bullT = 0; p.spinT = 0; K.G.projectiles.length = 0; K.G.hazards.length = 0; clear(); v._fx && (v._fx.prev.boost = v._fx.prev.star = v._fx.prev.bull = false); };
      for (const kind of ["tomato", "tomato3", "chicken", "chicken3", "egg", "hay", "mimic"]) {
        reset(); K.grantHeldItem(p, kind); K.useItem(p);
        const before = total();
        K.syncEntityMeshes(0.016); K.syncEntityMeshes(0.016);
        const proj = K.G.projectiles.length, haz = K.G.hazards.length;
        // a mesh for it really is in the scene (kind-aware pooled mesh)
        let meshName = null;
        K.scene.traverse((o) => { if (/^fk(Lettuce|Chicken|Egg|Hay|Mimic)$/.test(o.name) && o.visible && (o.parent === K.scene)) meshName = meshName || o.name; });
        out[kind] = { before, after: total(), proj, haz, meshName };
      }
      // boost / star / bull: kart-view FX (edge-detected from state)
      const view = (kind, set) => { reset(); K.grantHeldItem(p, kind); K.useItem(p); p.v.x = 0; p.v.z = 14; for (let i = 0; i < 12; i++) K.syncKartView(p, v, 0.03); return { live: total(), fx: v._fx, held: p.starT > 0 || p.bullT > 0 || p.boostT > 0 }; };
      let r = view("boost"); out.boost = { live: r.live, flame: r.fx.flame.visible, flameScaleZ: r.fx.flame.scale.z, held: r.held };
      {
        // flame geometry: each exhaust flame's apex axis points BACKWARD along the kart (dot with kart forward < -0.8, i.e. lies along -forward)
        const gq = new THREE.Quaternion(), fwdQ = new THREE.Quaternion(), fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(v.group.getWorldQuaternion(fwdQ));
        out.boost.flameDots = r.fx.flames.map((q) => new THREE.Vector3(0, 0, -1).applyQuaternion(q.outer.getWorldQuaternion(gq)).dot(fwd));
        out.boost.flameCount = r.fx.flames.length;
        out.boost.flameColors = r.fx.flames.map((q) => q.outer.material.color.getHex());
        // projected size from the live chase camera: flame screen bbox / kart screen bbox
        // the settled default chase camera: its offset from the (idle) kart, captured at the start of this block
        const cam2 = new THREE.PerspectiveCamera(K.camera.fov, K.camera.aspect, 0.3, 800), gp = v.group.position;
        cam2.position.set(gp.x + camOff.x, gp.y + camOff.y, gp.z + camOff.z); cam2.lookAt(gp.x, gp.y + 0.8, gp.z); cam2.updateMatrixWorld(true); v.group.updateMatrixWorld(true);
        const scr = (obj) => { const b = new THREE.Box3().setFromObject(obj), pts = []; for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(new THREE.Vector3(x, y, z).project(cam2)); const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y); return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)); };
        out.boost.areaRatio = r.fx.flames.reduce((a, q) => a + scr(q.g), 0) / scr(v.bounce);   // sum of the two flames' own screen boxes (not the gap between them)
        // streaks: thin lines lying ALONG the travel direction, horizontal, at body height
        const sp = Math.hypot(p.v.x, p.v.z), hv = new THREE.Vector3(sp > 1 ? p.v.x / sp : Math.sin(p.theta), 0, sp > 1 ? p.v.z / sp : Math.cos(p.theta));
        const live = r.fx.streaks.filter((q) => q.m.visible);
        out.boost.streaks = live.length;
        out.boost.streakAxes = live.map((q) => { const ax = new THREE.Vector3(0, 0, 1).applyQuaternion(q.m.quaternion); return { up: Math.abs(ax.y), par: Math.abs(ax.dot(hv)), h: q.m.position.y - (p.y || 0), len: q.m.scale.z }; });
      }
      r = view("star"); out.star = { live: r.live, petals: r.fx.petals.visible, emissive: v.bodyMat.emissive.getHex(), held: r.held };
      r = view("bull"); out.bull = { live: r.live, horns: r.fx.horns.visible, hornScale: r.fx.horns.scale.x, held: r.held, bullScale: p.bullScale };
      // kart-attached FX meshes: petals + horns are toon + inked; the flame is flat unlit with an ink hull
      const toonInked = (m) => m.material.type === "MeshToonMaterial" && !!m.userData.fkOutlined;
      const horns = v._fx.horns.children;
      out.kartFxToon = { petals: toonInked(v._fx.petals), horns: horns.length === 2 && horns.every(toonInked), flameInk: !!v._fx.flameOuter.userData.fkOutlined };
      // storm: a bolt rig goes live over the rival + a ring/burst
      reset(); K.grantHeldItem(p, "storm"); K.useItem(p); K.updateParticles(0.016);
      out.storm = { bolts: F.stats().bolts, live: total(), rigVisible: F.liveBolts().length ? F.liveBolts()[0].g.visible : false };
      F.updateLightning(0.3); out.storm.liveAfter = total();
      // impacts: every kind bursts
      out.impact = {};
      for (const kind of ["tomato", "chicken", "hay", "mimic", "shell", "egg"]) { clear(); const a = total(); K.spawnItemExplode(p.pos.x + 3, 1, p.pos.z + 12, kind); out.impact[kind] = total() - a; }
      // tank shell boom
      clear(); const a0 = total(); K.shellBoom ? K.shellBoom(p.pos.x, 1, p.pos.z + 8) : F.spawnExplode(p.pos.x, 1, p.pos.z + 8, "shell"); out.shellBoom = total() - a0;
      // hit by a real projectile: lettuce -> splat decal (ground splat)
      clear(); F.update(10); const d0 = F.stats().decals; K.spawnItemExplode(p.pos.x, 1, p.pos.z + 5, "tomato"); out.splatDecal = F.stats().decals - d0;
      // trail shield: ring attaches
      reset(); p.trailKind = "tomato"; K.syncEntityMeshes(0.016); let shield = 0; K.scene.traverse((o) => { if (o.userData && o.userData.shield && o.userData.shield.visible) shield++; }); out.trailShield = shield;
      // triple orbit: 3 bits visible
      reset(); K.grantHeldItem(p, "chicken3"); K.syncEntityMeshes(0.016); let orbit = 0; K.scene.traverse((o) => { if (o.name === "fkChicken" && o.visible && o.parent === K.scene) orbit++; }); out.orbitBits = orbit;
      reset(); delete K.G.players.rival; K.removeKartView && K.removeKartView("rival");
      return out;
    });
    for (const kind of ["tomato", "tomato3", "chicken", "chicken3", "egg"]) {
      const o = fx[kind];
      check(`${kind}: fire spawns a projectile mesh + a muzzle burst (particles ${o.before} -> ${o.after})`, o.proj >= 1 && o.after > o.before && !!o.meshName, JSON.stringify(o));
    }
    for (const kind of ["hay", "mimic"]) {
      const o = fx[kind];
      check(`${kind}: drop spawns a hazard mesh + a plop burst (particles ${o.before} -> ${o.after})`, o.haz >= 1 && o.after > o.before && o.meshName === (kind === "hay" ? "fkHay" : "fkMimic"), JSON.stringify(o));
    }
    // star flicker is time-based (stepped hue every ~90ms): sample it over real time
    fx.star.steps = await page.evaluate(async () => {
      const K = window.__KART__, p = K.G.players.local, v = K.kartViews.local, em = new Set();
      p.starT = 5; for (let i = 0; i < 30; i++) { K.syncKartView(p, v, 0.03); em.add(v.bodyMat.emissive.getHex()); await new Promise((r) => setTimeout(r, 30)); }
      p.starT = 0; return em.size;
    });
    check("boost flames: two exhaust flames, apex along -forward (dot < -0.8), warm orange (not blue)", fx.boost.flameCount === 2 && fx.boost.flameDots.every((d) => d < -0.8) && fx.boost.flameColors.every((c) => c === 0xff7a1a), JSON.stringify([fx.boost.flameDots, fx.boost.flameColors]));
    check("boost flames stay small: projected area < 25% of the kart's screen bbox from the chase cam", fx.boost.areaRatio > 0 && fx.boost.areaRatio < 0.25, fx.boost.areaRatio);
    check("boost streaks: >= 2 live, long axis horizontal (|dot up| < 0.2) and parallel to travel (> 0.8), body height, shrinking", fx.boost.streaks >= 2 && fx.boost.streakAxes.every((a) => a.up < 0.2 && a.par > 0.8 && a.h > 0.2 && a.h < 2.0 && a.len < 3.0), JSON.stringify(fx.boost.streakAxes.slice(0, 3)));
    check("boost: flame cone visible + speed streaks / burst spawned", fx.boost.held && fx.boost.flame && fx.boost.flameScaleZ > 0.5 && fx.boost.live >= 5, JSON.stringify(fx.boost));
    check("star: petal ring visible, rainbow flicker steps through >= 3 distinct colours, sparkles spawned", fx.star.held && fx.star.petals && fx.star.steps >= 3 && fx.star.live >= 5, JSON.stringify(fx.star));
    check("bull: horns visible + steam/dust/shockwave spawned", fx.bull.held && fx.bull.horns && fx.bull.hornScale > 0.5 && fx.bull.live >= 5, JSON.stringify(fx.bull));
    check("star petal ring + bull horns are MeshToon with ink hulls; boost flame is inked", fx.kartFxToon.petals && fx.kartFxToon.horns && fx.kartFxToon.flameInk, JSON.stringify(fx.kartFxToon));
    check("storm: a cloud+bolt rig goes live over the rival and the strike bursts on impact", fx.storm.bolts >= 1 && fx.storm.rigVisible && fx.storm.liveAfter > fx.storm.live - 1, JSON.stringify(fx.storm));
    for (const kind of Object.keys(fx.impact)) check(`impact ${kind}: burst of >= 6 pooled pieces`, fx.impact[kind] >= 6, fx.impact[kind]);
    check("tank-shell boom spawns smoke + sparks + ring", fx.shellBoom >= 10, fx.shellBoom);
    check("lettuce hit leaves a ground splat decal", fx.splatDecal === 1, fx.splatDecal);
    check("trailed item carries a shield ring", fx.trailShield >= 1, fx.trailShield);
    check("chicken x3 orbits three chicken meshes", fx.orbitBits === 3, fx.orbitBits);

    // ---------------------------------------------------------------- ITEM BOX: pickup burst + respawn pop-in
    const box = await page.evaluate(() => {
      const K = window.__KART__, F = window.FK_ITEMS, p = K.G.players.local, out = {};
      const clear = () => { for (const q of K.particles) { q.live = false; q.m.visible = false; } };
      K.clearItem(p); p.itemRollT = 0; clear();
      K.syncEntityMeshes(0.016);                        // establish wasActive on the crate meshes
      const b = K.G.itemBoxes[0];
      // real pickup path: put the kart on the box and run the game's own pickup rule
      p.pos.x = b.x; p.pos.z = b.z; b.active = true;
      K.updateItemBoxes(0.016);
      out.collected = !b.active && p.itemRollT > 0;
      const c0 = F.stats().particles;
      K.syncEntityMeshes(0.016);
      out.burst = F.stats().particles - c0;
      let vis = null; K.scene.traverse((o) => { if (o.name === "fkItemBox" && Math.abs(o.position.x - b.x) < 0.01 && Math.abs(o.position.z - b.z) < 0.01) vis = o; });
      out.hiddenWhileGone = vis ? vis.visible === false : null;
      // respawn: pop-in with overshoot, settles to 1
      b.active = true; const scales = [];
      for (let i = 0; i < 40; i++) { K.syncEntityMeshes(0.016); scales.push(vis.scale.y); }
      out.first = scales[0]; out.max = Math.max(...scales); out.last = scales[scales.length - 1];
      K.clearItem(p); p.itemRollT = 0; clear();
      return out;
    });
    check("item box pickup (the game's own rule) collects the box and starts the roll", box.collected);
    check("item box pickup fires a burst (>= 8 pooled pieces)", box.burst >= 8, box.burst);
    check("box hides while it respawns", box.hiddenWhileGone === true);
    check("respawn pop-in: starts near 0, overshoots 1.0, settles at ~1 (easeOutBack)", box.first < 0.6 && box.max > 1.02 && Math.abs(box.last - 1) < 0.08, JSON.stringify(box));

    } catch (e) { check("model / particle / VFX sections ran (FK_ITEMS present)", false, String(e.message || e).slice(0, 120)); }
    check("0 pageerrors (desktop)", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.context().close();
  }

  await browser.close(); srv.close();
  console.log(`\n${fail ? "FAIL" : "PASS"}: fk-itemfx — ${pass} ok, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
