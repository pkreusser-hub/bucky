#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Farm Kart STORYBOOK TOON pass (assets/farmkart-toon-game.js + farmkart.html hooks).
 * Asserts structure, arithmetic and geometry in world units — never pixels:
 *   A  per track (wario-stadium = boot default, harvest-hollow, amen-farms, moo-moo-farm), 12-kart race:
 *      zero lit non-toon materials after the async GLB props land; every kart/driver toon mesh carries
 *      an ink hull (except the ones flagged ink-free); procedural drivers are SkinnedMesh on the 21-bone
 *      rig with skinning:true materials (body AND ink); toon sky dome; light top band <= 1.2; draw calls
 *      within the per-track budget; sun shadow map on and the karts cast.
 *   B  live link: game code mutating an ORIGINAL (pre-toon) material still drives what renders.
 *   C  footprint: wheel mounts, tire radius and KART_RIDER_H unchanged from the pre-toon game.
 *   D  hand IK in a real race (bucky/tractor/mower x bucky/otis/boots): both wrists within 2 cm of
 *      their steering-wheel grips while steering left and right.
 *   E  clips from real kart state: spin-out -> hit, boost -> boost, airborne -> trick, finish -> cheer
 *      (fists above the head); hats replace Bucky's toque; menu loadout swap rebuilds the right pair.
 *   F  entities + props inked (critters, cows, train, instanced GLB props); GLB drivers + Gator toon
 *      and inked; the time-trial ghost carries no ink; 0 pageerrors.
 *
 *   node tools/_verify-fk-toon.cjs
 */
const path = require("path");
const fs = require("fs");
const http = require("http");

function loadPlaywright() {
  for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try { return require(p); } catch (_) {}
  }
  throw new Error("playwright not found");
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary", ".json": "application/json", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav" };
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
  if (ok) { pass++; console.log("  ok   " + name + (detail ? "  — " + detail : "")); }
  else { fail++; console.log("  FAIL " + name + (detail ? "  — " + detail : "")); }
}

// Draw-call budget per track, measured in the suite's own 12-kart race (seeded roster, worst case:
// the whole field bunched at the start). Pre-toon game, this harness: wario 923 · harvest 350 ·
// amen 208 · moo 688 (box karts were ~85 calls each, ink doubles what it touches). Toon game: see the
// report lines. Budget: an absolute 450 everywhere, and never above the pre-toon 394 measured on
// harvest-hollow by the probe harness (its dense props + critters + train make it the heaviest).
// harvest-hollow RESTAGED (2026-10-12 merge): 394 was the pre-toon count with the old scenery. The hero-course art pass
// (assets/farmkart-hh-art.js) legitimately adds up to +260 calls on this track; tools/_verify-fk-hh.cjs owns that allowance.
const BUDGET = { "wario-stadium": 450, "harvest-hollow": 394 + 260, "amen-farms": 450, "moo-moo-farm": 450 };
const BLOCK = /googleapis|firestore|firebase|gstatic|playroom|joinplayroom/;
const ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

async function boot(browser, base, track, opts) {
  opts = opts || {};
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route(BLOCK, (r) => r.abort());
  // seeded roster (kart/driver picks) so the call counts are reproducible run to run
  await page.addInitScript((lo) => {
    let s = 4242; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    if (lo) localStorage.setItem("fk_racer", JSON.stringify(lo));
  }, opts.loadout || null);
  page._errs = [];
  page.on("pageerror", (e) => page._errs.push(e.message));
  await page.goto(`${base}/farmkart.html${track ? "?track=" + track : ""}`);
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), null, { timeout: 60000 });
  return page;
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ args: ARGS });
  const allErrs = [];
  const hasToon = async (page) => page.evaluate(() => !!window.FK_TOON_GAME);

  // =========================================================================================== A
  for (const track of ["wario-stadium", "harvest-hollow", "amen-farms", "moo-moo-farm"]) {
    console.log(`\n[A ${track}]`);
    // wario-stadium is the boot default: load it with NO ?track= so the default path is what's tested
    const page = await boot(browser, base, track === "wario-stadium" ? null : track);
    const isToon = await hasToon(page);
    await page.evaluate(() => { const K = __KART__; K.forceRace(); K.G.raceMode = "prix"; K.setupRoster(); K.G.phase = "racing"; K._setKeys("w", true); });
    // wait for the async GLB props + GLB drivers to land: poll until the lit count is 0 (or 20 s)
    const t0 = Date.now(); let lit = -1;
    while (Date.now() - t0 < 20000) {
      lit = await page.evaluate(() => { let n = 0; __KART__.scene.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material)) if (m && /Lambert|Phong|Standard|Physical/.test(m.type)) n++; }); return n; });
      if (lit === 0 && Date.now() - t0 > 6000) break;
      await page.waitForTimeout(1000);
    }
    const r = await page.evaluate(() => {
      const K = __KART__, out = { track: K.ACTIVE_TRACK_ID };
      out.trackId = (K.MenuFlow && K.MenuFlow.trackId) || null;
      let toon = 0; K.scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m && m.isMeshToonMaterial) toon++; });
      out.toon = toon;
      // ---- ink on every kart/driver toon mesh (flagged noOutline parts excepted)
      let need = 0, have = 0; const missing = [];
      let drivers = 0, skinnedOk = 0, inkSkinOk = 0, bones21 = 0;
      for (const id in K.kartViews) {
        const v = K.kartViews[id];
        v.group.traverse((o) => {
          if (!o.isMesh || o.userData.fkOutline || o.userData.noOutline || o.isSprite) return;
          const m = Array.isArray(o.material) ? o.material[0] : o.material;
          if (!m || !m.isMeshToonMaterial) return;
          if (!o.visible) return;
          // pedal pads are hidden on the closed toon footwell; anything invisible needs no ink
          let vis = true; for (let a = o; a; a = a.parent) if (!a.visible) { vis = false; break; }
          if (!vis) return;
          need++; if (o.userData.fkOutlined) have++; else if (missing.length < 6) missing.push(id + ":" + (o.name || o.type));
        });
        const g = v.goat;
        if (g && g.toon) {
          drivers++;
          const mesh = g.mesh;
          if (mesh && mesh.isSkinnedMesh && mesh.material.skinning === true) skinnedOk++;
          if (mesh && mesh.skeleton && mesh.skeleton.bones.length === 21) bones21++;
          const ink = mesh && mesh.userData.fkOutlined;
          if (ink && ink.isSkinnedMesh && ink.material.skinning === true && ink.skeleton === mesh.skeleton) inkSkinOk++;
        }
      }
      Object.assign(out, { need, have, missing, drivers, skinnedOk, bones21, inkSkinOk });
      const procDrivers = Object.values(K.kartViews).filter((v) => ["bucky", "otis", "boots"].includes(v.driverId)).length;
      out.procDrivers = procDrivers;
      // ---- sky + lights + shadows
      const sky = K.SKY_OBJ; let dome = null, clouds = null;
      if (sky) sky.traverse((o) => { if (o.name === "fkSkyDome") dome = o; if (o.name === "fkToonClouds") clouds = o; });
      out.dome = !!(dome && dome.material && dome.material.type === "ShaderMaterial");
      out.clouds = clouds ? { inked: !!clouds.userData.fkOutlined } : null;
      out.light = window.FK_TOON_GAME ? FK_TOON_GAME.lighting : null;
      out.shadowMap = K.renderer.shadowMap.enabled; out.sunCast = K.sunLight.castShadow;
      const lv = K.kartViews.local; let castN = 0, meshN = 0;
      lv.group.traverse((o) => { if (o.isMesh && !o.userData.fkOutline && /kartPaint|kartBody|tire|racerBody/.test(o.name)) { meshN++; if (o.castShadow) castN++; } });
      out.cast = [castN, meshN];
      out.karts = Object.keys(K.kartViews).length;
      K.renderer.render(K.scene, K.camera);
      out.calls = K.renderer.info.render.calls; out.tris = K.renderer.info.render.triangles;
      return out;
    });
    check(`${track}: zero lit non-toon materials after props load`, lit === 0, `lit=${lit} toon=${r.toon}`);
    check(`${track}: 12 karts racing`, r.karts === 12, `${r.karts}`);
    check(`${track}: every visible kart/driver toon mesh is inked`, r.need > 0 && r.have === r.need, `${r.have}/${r.need} missing=${r.missing.join(",")}`);
    check(`${track}: procedural drivers are skinned toon (skinning:true) on the 21-bone rig`, r.procDrivers > 0 && r.drivers === r.procDrivers && r.skinnedOk === r.drivers && r.bones21 === r.drivers, `proc=${r.procDrivers} toon=${r.drivers} skin=${r.skinnedOk} bones21=${r.bones21}`);
    check(`${track}: driver ink is a SkinnedMesh on the same skeleton (skinning:true)`, r.drivers > 0 && r.inkSkinOk === r.drivers, `${r.inkSkinOk}/${r.drivers}`);
    check(`${track}: toon sky dome`, r.dome);
    if (track !== "wario-stadium") check(`${track}: day/sun/clouds sky has inked puffy clouds`, !!(r.clouds && r.clouds.inked), JSON.stringify(r.clouds));
    check(`${track}: toon light top band <= 1.2 and shadow band >= 0.4 x top`, !!(r.light && r.light.top <= 1.2 + 1e-6 && r.light.shadowBand >= 0.4 * r.light.top), JSON.stringify(r.light));
    check(`${track}: sun shadow map on + local kart body/tires/driver cast`, r.shadowMap && r.sunCast && r.cast[1] >= 7 && r.cast[0] === r.cast[1], JSON.stringify(r.cast));
    check(`${track}: draw calls within budget (<= ${BUDGET[track]})`, r.calls <= BUDGET[track], `calls=${r.calls} tris=${r.tris}`);
    check(`${track}: 0 pageerrors`, page._errs.length === 0, page._errs.slice(0, 3).join(" | "));
    allErrs.push(...page._errs);
    if (track === "harvest-hollow") {
      // ---- F: entities, train and instanced props carry ink
      await page.waitForTimeout(1500);
      const e = await page.evaluate(() => {
        const K = __KART__, inked = (root) => { let n = 0; root.traverse((o) => { if (o.userData && o.userData.fkOutline) n++; }); return n; };
        // critters only exist mid-crossing: start every crossing, then let the view sync build them
        for (const ch of K.chickens) K.spawnCrossingChicken(ch);
        K.syncChickenViews(1 / 30);
        const cows = Object.values(K.cowViews || {}).filter(Boolean), crit = Object.values(K.chickenViews || {}).filter(Boolean);
        let props = 0, propsInk = 0;
        K.scene.traverse((o) => { if (o.isInstancedMesh && !o.userData.fkOutline && o.material && o.material.isMeshToonMaterial) { props++; if (o.userData.fkOutlined) propsInk++; } });
        return { cows: cows.length, cowsInked: cows.filter((c) => inked(c) > 0).length, crit: crit.length, critInked: crit.filter((c) => inked(c) > 0).length,
                 train: K.TRAIN_GROUP ? inked(K.TRAIN_GROUP) : -1, props, propsInk };
      });
      check("F harvest: every cow view is inked", e.cows > 0 && e.cowsInked === e.cows, `${e.cowsInked}/${e.cows}`);
      check("F harvest: every critter view is inked", e.crit > 0 && e.critInked === e.crit, `${e.critInked}/${e.crit}`);
      check("F harvest: the train carries ink", e.train > 0, `${e.train}`);
      check("F harvest: instanced GLB props inked (some submeshes; tiny ones skip)", e.propsInk > 0, `${e.propsInk}/${e.props}`);
    }
    await page.close();
  }

  // =========================================================================================== B..E
  console.log("\n[B-E amen-farms, solo]");
  const page = await boot(browser, base, "amen-farms", { loadout: { driverId: "bucky", kartId: "bucky", color: 0x3f7fe0, hatId: "none" } });
  // ---- B: live link
  const live = await page.evaluate(() => {
    const K = __KART__, THREE = window.THREE;
    const src = new THREE.MeshLambertMaterial({ color: 0x112233, emissive: 0x000000 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), src); K.scene.add(m);
    const t = m.material, r = { toon: t.type, same: t === src };
    src.color.setHex(0xabcdef); src.emissive.setHex(0x101010); src.opacity = 0.4; src.transparent = true;
    const v0 = t.version; src.needsUpdate = true;
    r.color = t.color.getHex() === 0xabcdef; r.emissive = t.emissive.getHex() === 0x101010; r.opacity = t.opacity === 0.4 && t.transparent === true; r.version = t.version === v0 + 1;
    t.opacity = 0.9; r.back = src.opacity === 0.9;
    K.scene.remove(m);
    return r;
  });
  check("B live link: an added Lambert mesh renders MeshToon", live.toon === "MeshToonMaterial" && !live.same, live.toon);
  check("B live link: colour/emissive/opacity/transparent/needsUpdate on the ORIGINAL reach the toon copy", live.color && live.emissive && live.opacity && live.version, JSON.stringify(live));
  check("B live link: writes on the toon copy reach the original", live.back === true);

  // ---- C: footprint
  const fp = await page.evaluate(() => {
    const K = __KART__, v = K.kartViews.local, THREE = window.THREE;
    const mounts = v.wheels.map((w) => [w.userData.bx, w.userData.by, w.userData.bz].map((n) => +n.toFixed(3)));
    let tireR = 0; const tire = v.wheels[0] && v.wheels[0].children[0] && v.wheels[0].children[0].children[0];
    if (tire && tire.geometry) { const p = tire.geometry.attributes.position; for (let i = 0; i < p.count; i++) tireR = Math.max(tireR, Math.hypot(p.getX(i), p.getY(i))); }
    return { mounts, tireR: +tireR.toFixed(4), H: K.KART_RIDER_H, kartIds: K.KART_IDS, plane: K.sampleKartPlane(0, 20, 0, 0).y };
  });
  const WANT = [[-0.58, 0.26, 0.62], [0.58, 0.26, 0.62], [-0.58, 0.26, -0.58], [0.58, 0.26, -0.58]];   // pre-toon KART_WHEEL_POS
  check("C wheel mounts unchanged (KART_WHEEL_POS)", JSON.stringify(fp.mounts) === JSON.stringify(WANT), JSON.stringify(fp.mounts));
  check("C tire outer radius = 0.26 (_TIRE_ROUT: tread planting stays exact)", Math.abs(fp.tireR - 0.26) < 0.003, `${fp.tireR}`);
  check("C KART_RIDER_H = 1.57 (the pre-toon measured kart+rider height; water depths unchanged)", Math.abs(fp.H - 1.57) < 1e-6 /* the pre-toon value was a float32 bbox read (1.5700000059604644) */, `${fp.H}`);
  check("C kart roster unchanged", JSON.stringify(fp.kartIds) === JSON.stringify(["bucky", "tractor", "mower", "gator3d"]), JSON.stringify(fp.kartIds));

  // ---- D: hand IK in a real race
  const isToon = await hasToon(page);
  await page.evaluate(() => { const K = __KART__; K.forceRace(); K.G.phase = "racing"; K._setKeys("w", true); });
  for (const [kart, drv] of [["bucky", "bucky"], ["tractor", "otis"], ["mower", "boots"]]) {
    await page.evaluate(([k, d]) => { const K = __KART__; K.applyKartLoadout(K.kartViews.local, k, d); }, [kart, drv]);
    const samples = [];
    for (const key of ["a", "d"]) {
      await page.evaluate((k) => { const K = __KART__; K._setKeys("a", false); K._setKeys("d", false); K._setKeys(k, true); }, key);
      // hold the key until 3 on-wheel samples steer that way (a wall bump / spin can eat a few), max ~6 s
      let got = 0;
      for (let i = 0; i < 24 && got < 3; i++) {
        await page.waitForTimeout(250);
        const s = await page.evaluate(() => {
          const K = __KART__, v = K.kartViews.local, g = v.goat, THREE = window.THREE, p = K.state;
          if (!g || !g.bones || !v.steerWheel) return { err: "no rig" };
          const sw = v.steerWheel.userData, a = new THREE.Vector3(), b = new THREE.Vector3();
          const dL = g.bones.hand_L.getWorldPosition(a).distanceTo(sw.gripL.getWorldPosition(b));
          const dR = g.bones.hand_R.getWorldPosition(a).distanceTo(sw.gripR.getWorldPosition(b));
          const st = g.anim.state;
          // hands leave the wheel BY DESIGN during hit/trick/cheer (clip.ik = 0) and landing squash
          // scales the kart non-uniformly for 0.2 s — only "hands on the wheel" frames are judged
          const onWheel = !st.overlay && st.ikL > 0.99 && st.ikR > 0.99 && !p.airborne && !(p.landT > 0) && !(p.spinT > 0);
          return { steer: +p.steer.toFixed(2), rim: +sw.rim.rotation.z.toFixed(2), dL: +dL.toFixed(4), dR: +dR.toFixed(4), onWheel, ov: st.overlay };
        });
        samples.push(s);
        if (s.onWheel && (key === "a" ? s.steer > 0.3 : s.steer < -0.3)) got++;
      }
      // reset onto the road between directions so a wall never pins the kart
      await page.evaluate(() => { const K = __KART__; K._setKeys("a", false); K._setKeys("d", false); K.forceRace(); K.G.phase = "racing"; });
      await page.waitForTimeout(600);
    }
    const steered = samples.filter((s) => s.steer !== undefined && Math.abs(s.steer) > 0.3 && s.onWheel);
    const worst = steered.reduce((m, s) => Math.max(m, s.dL, s.dR), 0);
    const both = steered.some((s) => s.steer > 0.3) && steered.some((s) => s.steer < -0.3);
    check(`D ${kart}/${drv}: steering both ways in a real race (rim turns)`, both && steered.every((s) => Math.abs(s.rim) > 0.3), JSON.stringify(samples.map((s) => s.steer + (s.onWheel ? "" : "*"))));
    check(`D ${kart}/${drv}: both wrists within 2 cm of their grips while steering`, steered.length >= 4 && worst < 0.02, `worst=${(worst * 100).toFixed(2)} cm over ${steered.length} on-wheel samples`);
  }
  await page.evaluate(() => { const K = __KART__; K._setKeys("a", false); K._setKeys("d", false); K._setKeys("w", false); });

  // ---- E: clips driven from the real kart state (syncKartView, the game's own per-frame path)
  const clip = await page.evaluate(() => {
    const K = __KART__, v = K.kartViews.local, p = K.state, out = {};
    K.applyKartLoadout(v, "bucky", "bucky");
    const g = v.goat; if (!g || !g.anim) return { err: "no animator" };
    const run = (n) => { for (let i = 0; i < n; i++) K.syncKartView(p, v, 1 / 30); };
    const ov = () => g.anim.state.overlay;
    p.spinT = K.TUNE.spinT; run(3); out.hit = ov(); p.spinT = 0; run(60);
    p.boostT = 1.0; run(3); out.boost = ov(); p.boostT = 0; run(60);
    p.airborne = true; run(14); out.trick = ov(); p.airborne = false; run(40);
    p.finished = true; run(40); out.cheer = ov();
    const THREE = window.THREE, a = new THREE.Vector3(), h = new THREE.Vector3();
    g.bones.head.getWorldPosition(h);
    out.fistsUp = g.bones.hand_L.getWorldPosition(a).y > h.y && g.bones.hand_R.getWorldPosition(a).y > h.y;
    out.cheerW = +g.anim.actions.cheer.getEffectiveWeight().toFixed(2);
    p.finished = false; run(40); out.after = ov();
    // hats: a worn hat replaces the toque
    K.setViewHat(v, "crown"); run(2);
    const hat = v._hatMesh; out.hat = !!(hat && hat.parent === g.head); out.toqueHidden = !!(g.toque && !g.toque.visible);
    if (hat) { hat.getWorldPosition(a); out.hatAbove = a.y > h.y; }
    K.setViewHat(v, "none"); run(2); out.toqueBack = !!(g.toque && g.toque.visible);
    return out;
  });
  check("E spin-out plays the hit clip", clip.hit === "hit", JSON.stringify(clip.hit));
  check("E boost plays the boost clip", clip.boost === "boost", JSON.stringify(clip.boost));
  check("E airborne > 0.3 s plays the trick clip", clip.trick === "trick", JSON.stringify(clip.trick));
  check("E finish plays the cheer clip, fists above the head", clip.cheer === "cheer" && clip.fistsUp && clip.cheerW > 0.8, JSON.stringify({ c: clip.cheer, up: clip.fistsUp, w: clip.cheerW }));
  check("E cheer stops when the race resets", clip.after !== "cheer", JSON.stringify(clip.after));
  check("E a hat sits on the head anchor above the head bone and hides the toque", clip.hat && clip.toqueHidden && clip.hatAbove, JSON.stringify(clip));
  check("E removing the hat brings the toque back", clip.toqueBack);

  // ---- menu loadout swap rebuilds the right kart + driver (the menu preview IS the local view)
  const menu = await page.evaluate(() => {
    const K = __KART__, v = K.kartViews.local;
    K.applyKartLoadout(v, "tractor", "otis");
    return { kart: v.kartId, root: v.kartRoot && v.kartRoot.name, drv: v.goat && v.goat.kind, toon: !!(v.goat && v.goat.toon), paint: v.kartRoot ? (() => { let n = 0; v.kartRoot.traverse((o) => { if (o.isMesh && o.material === v.bodyMat) n++; }); return n; })() : 0 };
  });
  check("E loadout swap: tractor + Otis rebuilt (paint mesh uses the view's bodyMat)", menu.kart === "tractor" && menu.root === "tractorKart" && menu.drv === "otis" && menu.toon && menu.paint >= 1, JSON.stringify(menu));

  // ---- F: GLB driver + Gator toon + ink; ghost has no ink
  const glb = await page.evaluate(async () => {
    const K = __KART__, v = K.kartViews.local;
    K.applyKartLoadout(v, "gator3d", "bucky3d");
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) { if (v.goat && v.goat._ready && v._gatorReady) break; await new Promise((r) => setTimeout(r, 200)); }
    let skin = 0, skinToon = 0, skinInk = 0, gatorMesh = 0, gatorToon = 0, gatorInk = 0;
    v.goat.root.traverse((o) => { if (o.isSkinnedMesh && !o.userData.fkOutline) { skin++; if (o.material.isMeshToonMaterial && o.material.skinning) skinToon++; if (o.userData.fkOutlined) skinInk++; } });
    v.kartRoot.traverse((o) => { if (o.isMesh && !o.userData.fkOutline && o.material && o.material.map) { gatorMesh++; if (o.material.isMeshToonMaterial) gatorToon++; if (o.userData.fkOutlined) gatorInk++; } });
    const gv = K.buildKartView("__ghost", 0x3f7fe0, false, null, { kartId: "bucky", driverId: "bucky", noName: true });
    let ghostInk = 0; gv.group.traverse((o) => { if (o.userData.fkOutline) ghostInk++; });
    K.removeKartView("__ghost");
    return { ready: !!(v.goat._ready && v._gatorReady), skin, skinToon, skinInk, gatorMesh, gatorToon, gatorInk, ghostInk };
  });
  check("F GLB driver (bucky3d): every skinned mesh MeshToon + skinning, inked", glb.ready && glb.skin > 0 && glb.skinToon === glb.skin && glb.skinInk === glb.skin, JSON.stringify(glb));
  check("F Gator 3D kart: textured meshes toon + inked", glb.gatorMesh > 0 && glb.gatorToon === glb.gatorMesh && glb.gatorInk === glb.gatorMesh, JSON.stringify(glb));
  check("F the translucent time-trial ghost carries no ink hulls", glb.ghostInk === 0, `${glb.ghostInk}`);
  check("B-F 0 pageerrors", page._errs.length === 0, page._errs.slice(0, 3).join(" | "));
  allErrs.push(...page._errs);
  await page.close();

  await browser.close(); srv.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
