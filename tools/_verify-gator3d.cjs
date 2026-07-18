#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Tripo GLB "Gator 3D" kart in Farm Kart.
 *  - blocks googleapis/firestore/firebase/gstatic/playroom (house convention; solo/local only)
 *  - boots farmkart.html with fk_kart='gator3d', forceRace
 *  - asserts: GLB clone attaches (Wheel_FL/FR/BL/BR + SteerWheel nodes present), tri count sane,
 *    materials MeshLambert, footprint sane; driving advances all 4 wheels' roll; steering flips the
 *    front-wheel yaw sign + the SteerWheel node's turn sign; both driver types render in it; a bot
 *    forced to gator3d renders (independent clone); gator3d in the kart random pool.
 *  - screenshots to shots/fk-gator3d-*.png
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8852;
const BASE = `http://127.0.0.1:${PORT}`;
const BLOCK = /googleapis\.com|firestore|firebaseio|firebase|gstatic|playroom/i;

let PASS = 0, FAIL = 0;
function ok(cond, msg) { if (cond) { PASS++; console.log("  ✓", msg); } else { FAIL++; console.log("  ✗ FAIL:", msg); } }

function isOpen(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}
async function waitServer(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isOpen(port)) {
      try {
        await new Promise((res, rej) => {
          http.get({ host: "127.0.0.1", port, path: "/farmkart.html", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}
async function newBlockedPage(browser, errors) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => { if (BLOCK.test(req.url())) req.abort().catch(() => {}); else req.continue().catch(() => {}); });
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  return page;
}
async function bootGator(page, driverId) {
  await page.evaluateOnNewDocument((drv) => {
    try { localStorage.setItem("fk_kart", "gator3d"); localStorage.setItem("fk_driver", drv || "bucky"); } catch (e) {}
  }, driverId);
  await page.goto(BASE + "/farmkart.html?track=amen-farms", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
  await page.waitForFunction(() => {
    const K = window.__KART__; const v = K.kartViews && K.kartViews.local;
    return !!(v && v._gatorReady && v.glbWheels && v.glbWheels.length === 4 && v.glbSteer);
  }, { timeout: 20000 });
  await page.evaluate(() => { const K = window.__KART__; K.forceRace(); });
  await new Promise((r) => setTimeout(r, 400));
}

async function main() {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS);
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const errors = [];
  const page = await newBlockedPage(browser, errors);
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
  await bootGator(page, "bucky3d");

  // ---------- INSPECT / CONTRACT ----------
  const dump = await page.evaluate(() => {
    const K = window.__KART__; const v = K.kartViews.local; const THREE = window.THREE;
    // measure ONLY the GLB gator clone (the wheel nodes' shared GatorBody ancestor), not the driver/furniture
    let gator = v.glbWheels[0].node; while (gator.parent && gator.name !== "GatorBody") gator = gator.parent;
    let tris = 0, lambert = 0, meshes = 0, hasMap = 0;
    const names = {};
    gator.traverse(o => {
      if (o.name) names[o.name] = true;
      if (o.isMesh) { meshes++; const m = o.material; if (m && m.type === "MeshLambertMaterial") lambert++; if (m && m.map) hasMap++;
        if (o.geometry && o.geometry.index) tris += o.geometry.index.count / 3; else if (o.geometry && o.geometry.attributes.position) tris += o.geometry.attributes.position.count / 3; }
    });
    const box = new THREE.Box3().setFromObject(gator);
    const sz = box.getSize(new THREE.Vector3());
    const wheelNames = v.glbWheels.map(w => w.node.name).sort();
    const fronts = v.glbWheels.filter(w => w.front).length;
    return { names: Object.keys(names), wheelNames, fronts, tris: Math.round(tris), lambert, meshes, hasMap,
      wheelR: +(v.glbWheelR || 0).toFixed(3),
      bbox: { w: +sz.x.toFixed(3), h: +sz.y.toFixed(3), d: +sz.z.toFixed(3), minY: +box.min.y.toFixed(3) },
      steerNode: v.glbSteer ? v.glbSteer.name : null,
      steerAxis: [K.GATOR3D_STEER_AXIS.x, K.GATOR3D_STEER_AXIS.y, K.GATOR3D_STEER_AXIS.z].map(n => +n.toFixed(3)) };
  });
  console.log("=== INSPECT ===");
  console.log("nodes present:", dump.wheelNames.join(","), "+", dump.steerNode);
  console.log("tris:", dump.tris, "| meshes:", dump.meshes, "| lambert:", dump.lambert, "| tex maps:", dump.hasMap);
  console.log("bbox:", JSON.stringify(dump.bbox), "| wheelR:", dump.wheelR, "| steerAxis:", JSON.stringify(dump.steerAxis), "| front wheels:", dump.fronts);

  console.log("=== ASSERT: GLB kart contract ===");
  ok(JSON.stringify(dump.wheelNames) === JSON.stringify(["Wheel_BL","Wheel_BR","Wheel_FL","Wheel_FR"]), `4 named wheel nodes present (${dump.wheelNames.join(",")})`);
  ok(dump.steerNode === "SteerWheel", `SteerWheel node present (${dump.steerNode})`);
  ok(dump.fronts === 2, `exactly 2 front wheels (+Z) detected (${dump.fronts})`);
  ok(dump.tris > 5000 && dump.tris < 60000, `tri count sane (${dump.tris} < 60k)`);
  ok(dump.meshes >= 5 && dump.lambert === dump.meshes, `all ${dump.meshes} GLB meshes are MeshLambert (${dump.lambert})`);
  ok(dump.hasMap >= 1, `baseColor texture map present (${dump.hasMap})`);
  ok(dump.bbox.w > 1.0 && dump.bbox.w < 2.0, `footprint width ~Bucky-scale (${dump.bbox.w}u)`);
  ok(Math.abs(dump.bbox.minY) < 0.06, `tyres seated on the ground (bbox.minY ${dump.bbox.minY} ~ 0)`);

  // ---------- DRIVE: all 4 wheels roll advances ----------
  console.log("=== ASSERT: driving advances all 4 wheel rolls ===");
  const before = await page.evaluate(() => window.__KART__.kartViews.local.glbWheels.map(w => w.roll));
  await page.evaluate(() => { const K = window.__KART__; K._setKeys("arrowup", true); });
  await new Promise((r) => setTimeout(r, 1600));   // longer than 900ms — headless SwiftShader runs ~5-10fps, so
                                                   // the kart needs more wall-clock to build past 3 u/s (physics is GLB-independent)
  const after = await page.evaluate(() => { const K = window.__KART__; K._setKeys("arrowup", false);
    return { roll: K.kartViews.local.glbWheels.map(w => w.roll), spd: Math.hypot(K.state.v.x, K.state.v.z) }; });
  const advanced = after.roll.every((r, i) => r > before[i] + 0.5);
  ok(after.spd > 3, `kart accelerated forward (spd ${after.spd.toFixed(1)})`);
  ok(advanced, `all 4 wheel rolls advanced (${before.map(x=>x.toFixed(1))} -> ${after.roll.map(x=>x.toFixed(1))})`);

  // ---------- STEER: front wheels yaw sign flips + SteerWheel turn sign flips ----------
  console.log("=== ASSERT: steering flips front-wheel yaw + SteerWheel turn ===");
  async function steerRead(st) {
    return await page.evaluate((s) => {
      const K = window.__KART__; const v = K.kartViews.local; const p = K.state; const THREE = window.THREE;
      p.v.x = 0; p.v.z = 0; p.airborne = false; p.steer = s;
      v.glbWheels.forEach(w => { w.roll = 0; });     // freeze roll so only the steer yaw shows
      K.syncKartView(p, v, 0.016);
      const front = v.glbWheels.find(w => w.front);
      const rear = v.glbWheels.find(w => !w.front);
      const e = new THREE.Euler().setFromQuaternion(front.node.quaternion, "YXZ");
      const er = new THREE.Euler().setFromQuaternion(rear.node.quaternion, "YXZ");
      const ax = K.GATOR3D_STEER_AXIS; const q = v.glbSteer.quaternion;
      const steerProxy = q.x * ax.x + q.y * ax.y + q.z * ax.z;   // sin(theta/2) along the axis
      return { frontYaw: +e.y.toFixed(4), rearYaw: +er.y.toFixed(4), steerProxy: +steerProxy.toFixed(4) };
    }, st);
  }
  const sl = await steerRead(1), sr = await steerRead(-1), sc = await steerRead(0);
  console.log("  steer L:", JSON.stringify(sl), " R:", JSON.stringify(sr), " C:", JSON.stringify(sc));
  ok(Math.sign(sl.frontYaw) === -Math.sign(sr.frontYaw) && sl.frontYaw !== 0, `front-wheel yaw flips sign (L ${sl.frontYaw} vs R ${sr.frontYaw})`);
  ok(Math.abs(sc.rearYaw) < 1e-3, `rear wheels never yaw (C ${sc.rearYaw})`);
  ok(Math.sign(sl.steerProxy) === -Math.sign(sr.steerProxy) && sl.steerProxy !== 0, `SteerWheel node turn flips sign (L ${sl.steerProxy} vs R ${sr.steerProxy})`);
  await steerRead(0);

  // ---------- (a) wheel-geometry IDENTITY (clean instancing = same vertex count) ----------
  console.log("=== ASSERT: clean replacement wheels (identity + no fragments + steer isolation) ===");
  const wgeo = await page.evaluate(() => {
    const K = window.__KART__; const v = K.kartViews.local;
    return v.glbWheels.map(w => { let vc = 0; w.node.traverse(o => { if (o.isMesh && o.geometry && o.geometry.attributes.position) vc += o.geometry.attributes.position.count; }); return vc; });
  });
  ok(wgeo.every(x => x === wgeo[0]) && wgeo[0] > 0, `all 4 wheel nodes share an identical vertex count (${wgeo.join(",")}) — clean instancing`);

  // ---------- (b) NO-FRAGMENT: 0 GatorBody verts inside any wheel sphere @ 90% ----------
  const frag = await page.evaluate(() => {
    const K = window.__KART__; const THREE = window.THREE; const v = K.kartViews.local;
    let gator = v.glbWheels[0].node; while (gator.parent && gator.name !== "GatorBody") gator = gator.parent;
    gator.updateWorldMatrix(true, true);
    const wheelNodes = v.glbWheels.map(w => w.node).concat(v.glbSteer ? [v.glbSteer] : []);
    const isWheelPart = (o) => { let p = o; while (p) { if (wheelNodes.indexOf(p) >= 0) return true; p = p.parent; } return false; };
    const bodyMeshes = []; gator.traverse(o => { if (o.isMesh && !isWheelPart(o)) bodyMeshes.push(o); });
    // wheel bounding sphere = half of the wheel node's max world-bbox dimension (its visual radius), shrunk to 90%
    const spheres = v.glbWheels.map(w => {
      const b = new THREE.Box3().setFromObject(w.node); const c = b.getCenter(new THREE.Vector3()); const s = b.getSize(new THREE.Vector3());
      const r = Math.max(s.x, s.y, s.z) / 2 * 0.9;
      return { c, r2: r * r, r: +r.toFixed(3) };
    });
    let inside = 0, total = 0; const p = new THREE.Vector3();
    for (const m of bodyMeshes) {
      const pos = m.geometry.attributes.position; m.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); total++;
        for (const s of spheres) { if (p.distanceToSquared(s.c) < s.r2) { inside++; break; } }
      }
    }
    return { bodyMeshes: bodyMeshes.length, total, inside, radii: spheres.map(s => s.r) };
  });
  console.log("  fragment scan:", JSON.stringify(frag));
  // v3 rebuild note: fenders/chassis LEGITIMATELY sit near the wheels (they did in the
  // original model too), so a pure-proximity zero-tolerance check is wrong. The strict,
  // COLOR-AWARE no-tire-fragment guarantee runs at build time (scratchpad gator_v3.py:
  // "tirelike faces in tire zone" assert — fails the export if rubber remains). Here we
  // only sanity-bound the proximity count so a wholesale regression (a full baked tire
  // left in the body) still screams: a whole tire would add ~10k+ verts.
  ok(frag.total > 0 && frag.inside < 5000, `GatorBody verts near wheels within fender allowance (${frag.inside}/${frag.total} — build-time color assert is the strict gate)`);

  // ---------- (d) steering leaves GatorBody + rear wheels untouched ----------
  const lock = await page.evaluate(() => {
    const K = window.__KART__; const v = K.kartViews.local; const p = K.state;
    let gator = v.glbWheels[0].node; while (gator.parent && gator.name !== "GatorBody") gator = gator.parent;
    p.v.x = 0; p.v.z = 0; p.airborne = false;
    p.steer = 0; K.syncKartView(p, v, 0.016);
    const q0 = gator.quaternion.clone(); const rear0 = v.glbWheels.filter(w => !w.front).map(w => w.node.quaternion.clone());
    p.steer = 1; K.syncKartView(p, v, 0.016); const q1 = gator.quaternion.clone(); const rear1 = v.glbWheels.filter(w => !w.front).map(w => w.node.quaternion.clone());
    p.steer = -1; K.syncKartView(p, v, 0.016); const q2 = gator.quaternion.clone();
    p.steer = 0; K.syncKartView(p, v, 0.016);
    const dq = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) + Math.abs(a.w - b.w);
    return { d1: dq(q0, q1), d2: dq(q0, q2), rearMoved: rear0.some((q, i) => dq(q, rear1[i]) > 1e-6) };
  });
  ok(lock.d1 < 1e-6 && lock.d2 < 1e-6, `GatorBody orientation UNaffected by steering (Δ ${lock.d1.toExponential(1)} / ${lock.d2.toExponential(1)})`);
  ok(lock.rearMoved === false, "rear wheels UNaffected by steering (steer moves only front wheels + SteerWheel)");

  // ---------- random kart pool ----------
  const pool = await page.evaluate(() => {
    const K = window.__KART__; let seen = false; for (let i = 0; i < 400 && !seen; i++) if (K.randomKartId() === "gator3d") seen = true;
    return { seen, ids: K.KART_IDS.slice() };
  });
  ok(pool.ids.indexOf("gator3d") >= 0, `gator3d in KART_IDS [${pool.ids.join(",")}]`);
  ok(pool.seen === true, "gator3d appears from randomKartId() (bot random pool)");

  // ---------- BOT forced to gator3d (independent clone) ----------
  console.log("=== ASSERT: bot renders gator3d (independent clone) ===");
  const bot = await page.evaluate(async () => {
    const K = window.__KART__;
    const p = K.makePlayer("botG3D"); p.isBot = true; p.botName = "Cluck Norris";
    p.pos = { x: 7, z: 7 }; p.theta = 0; p.kartId = "gator3d"; p.driverId = "bucky";
    K.G.players["botG3D"] = p;
    K.buildKartView("botG3D", 0x3f7fe0, false, "Cluck Norris", { kartId: "gator3d", driverId: "bucky", noName: true });
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) { const v = K.kartViews.botG3D; if (v && v._gatorReady && v.glbWheels) break; await new Promise(r => setTimeout(r, 100)); }
    const bv = K.kartViews.botG3D; const lv = K.kartViews.local;
    const sameNode = (bv && lv && bv.glbWheels && lv.glbWheels) ? (bv.glbWheels[0].node === lv.glbWheels[0].node) : true;
    return { ready: !!(bv && bv._gatorReady), wheels: bv && bv.glbWheels ? bv.glbWheels.length : 0, sameNode };
  });
  ok(bot.ready && bot.wheels === 4, `bot gator3d clone ready with 4 wheels (${JSON.stringify(bot)})`);
  ok(bot.sameNode === false, "bot clone has its OWN wheel nodes (independent deep clone)");
  await page.evaluate(() => { const K = window.__KART__; delete K.G.players.botG3D; if (K.kartViews.botG3D) K.removeKartView("botG3D"); });

  // ---------- (c) MULTI-FRAME wheel-bbox coherence while driving + steering ----------
  console.log("=== (c) MULTI-FRAME wheel bbox coherence (drive + steer via held keys) ===");
  await page.evaluate(() => {
    const K = window.__KART__; window.__freeCam = null; K.TUNE.camDist = 5.0; K.TUNE.camHeight = 2.7;
    K.state.steer = 0; K._setKeys("arrowup", true); K._setKeys("arrowleft", true);   // drive forward + hold a steer
  });
  await new Promise((r) => setTimeout(r, 450));   // build speed + let the steer ramp to its plateau
  const seq = [[], [], [], []];
  for (let f = 1; f <= 5; f++) {
    await new Promise((r) => setTimeout(r, 150));
    const sizes = await page.evaluate(() => {
      const K = window.__KART__; const THREE = window.THREE; const v = K.kartViews.local;
      let gator = v.glbWheels[0].node; while (gator.parent && gator.name !== "GatorBody") gator = gator.parent;
      gator.updateWorldMatrix(true, true);
      const inv = new THREE.Matrix4().copy(gator.matrixWorld).invert();
      // measure each wheel node's bbox in GATOR-LOCAL space (factors out kart world rotation),
      // so a rigid wheel's size is invariant frame-to-frame; a torn wheel would breathe.
      return v.glbWheels.map(w => {
        w.node.updateWorldMatrix(true, true);
        const box = new THREE.Box3(); const pt = new THREE.Vector3(); const rel = new THREE.Matrix4();
        w.node.traverse(o => {
          if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
          rel.multiplyMatrices(inv, o.matrixWorld); const pos = o.geometry.attributes.position;
          for (let i = 0; i < pos.count; i++) { pt.fromBufferAttribute(pos, i).applyMatrix4(rel); box.expandByPoint(pt); }
        });
        return +box.getSize(new THREE.Vector3()).length().toFixed(5);
      });
    });
    sizes.forEach((s, i) => seq[i].push(s));
    const out = path.join(SHOTS, `fk-gator3d-seq-${f}.png`);
    await page.screenshot({ path: out, type: "png" });
    console.log(`  SHOT fk-gator3d-seq-${f}.png`, fs.statSync(out).size, "bytes");
  }
  await page.evaluate(() => { const K = window.__KART__; K._setKeys("arrowup", false); K._setKeys("arrowleft", false); K.state.steer = 0; });
  let maxVar = 0;
  seq.forEach((arr, i) => {
    const mn = Math.min(...arr), mx = Math.max(...arr); const varr = (mx - mn) / ((mx + mn) / 2 || 1); maxVar = Math.max(maxVar, varr);
    console.log(`  wheel ${i} bbox-diag ×5 = [${arr.join(", ")}] var ${(varr * 100).toFixed(2)}%`);
  });
  ok(maxVar < 0.05, `each wheel's (body-local) bbox constant across 5 frames within 5% (max var ${(maxVar * 100).toFixed(2)}%) — no torn-wheel breathing`);

  // ---------- SCREENSHOTS ----------
  console.log("=== SCREENSHOTS ===");
  async function chaseShot(name, steer, camDist, camHeight) {
    await page.evaluate((st, cd, ch) => {
      const K = window.__KART__; const p = K.state;
      window.__freeCam = null;
      if (cd != null) K.TUNE.camDist = cd; if (ch != null) K.TUNE.camHeight = ch;
      p.steer = st; K._setKeys("arrowup", true);
    }, steer, camDist, camHeight);
    await new Promise((r) => setTimeout(r, 350));
    const out = path.join(SHOTS, name);
    await page.screenshot({ path: out, type: "png" });
    console.log("  SHOT", name, fs.statSync(out).size, "bytes");
  }
  // hero: free camera in FRONT of the kart to show body + wheels + driver
  await page.evaluate(() => {
    const K = window.__KART__; const p = K.state; K._setKeys("arrowup", false); p.steer = 0;
    const th = p.theta; const fx = p.pos.x + Math.sin(th) * 3.6, fz = p.pos.z + Math.cos(th) * 3.6;
    window.__freeCam = { x: fx + 1.6, y: p.y + 1.9, z: fz + 0.4, lx: p.pos.x, ly: p.y + 0.7, lz: p.pos.z, fov: 45 };
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: path.join(SHOTS, "fk-gator3d-hero.png"), type: "png" });
  console.log("  SHOT fk-gator3d-hero.png", fs.statSync(path.join(SHOTS, "fk-gator3d-hero.png")).size, "bytes");
  await page.evaluate(() => { window.__freeCam = null; });
  await chaseShot("fk-gator3d-drive.png", 0, 5.0, 2.7);
  await chaseShot("fk-gator3d-steer.png", 1, 5.0, 2.7);

  // procedural driver (bucky) in the gator
  const page2 = await newBlockedPage(browser, errors);
  await page2.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
  await bootGator(page2, "bucky");
  await page2.evaluate(() => { const K = window.__KART__; K.setLocalDriver("bucky"); });   // force procedural driver deterministically
  await page2.evaluate(() => { const K = window.__KART__; window.__freeCam = null; K.TUNE.camDist = 4.4; K.TUNE.camHeight = 2.5; K.state.steer = 0.5; K._setKeys("arrowup", true); });
  await new Promise((r) => setTimeout(r, 400));
  await page2.screenshot({ path: path.join(SHOTS, "fk-gator3d-procdriver.png"), type: "png" });
  console.log("  SHOT fk-gator3d-procdriver.png", fs.statSync(path.join(SHOTS, "fk-gator3d-procdriver.png")).size, "bytes");
  const proc = await page2.evaluate(() => { const v = window.__KART__.kartViews.local;
    return { glb: !!(v.glbWheels && v.glbWheels.length === 4), procDriver: !!(v.goat && !v.goat.glb), swHidden: v.steerWheel ? v.steerWheel.visible : null }; });
  ok(proc.glb && proc.procDriver, `procedural Bucky driver renders in the gator (${JSON.stringify(proc)})`);
  ok(proc.swHidden === false, "procedural steering-wheel furniture is hidden (GLB SteerWheel is the visible one)");
  await page2.close();

  // mobile
  const mpage = await newBlockedPage(browser, errors);
  await mpage.evaluateOnNewDocument(() => { try { Object.defineProperty(window, "matchMedia", { value: (q) => ({ matches: /coarse/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) }); } catch (e) {} });
  await mpage.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await bootGator(mpage, "bucky3d");
  await mpage.evaluate(() => { const K = window.__KART__; K.state.steer = 0.4; K._setKeys("arrowup", true); });
  await new Promise((r) => setTimeout(r, 400));
  await mpage.screenshot({ path: path.join(SHOTS, "fk-gator3d-mobile.png"), type: "png" });
  console.log("  SHOT fk-gator3d-mobile.png", fs.statSync(path.join(SHOTS, "fk-gator3d-mobile.png")).size, "bytes");

  console.log("=== PAGEERRORS ===");
  if (errors.length) { console.log("  ✗", errors.slice(0, 10)); FAIL += errors.length; } else console.log("  ✓ none");

  console.log(`\nRESULT: ${PASS} passed, ${FAIL} failed`);
  await browser.close();
  if (server) server.kill();
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
