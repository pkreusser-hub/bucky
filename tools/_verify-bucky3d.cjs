#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Tripo GLB "Bucky 3D" driver in Farm Kart.
 *  - blocks googleapis/firestore/firebase/gstatic (house convention; solo/local only)
 *  - boots farmkart.html with fk_driver='bucky3d', forceRace
 *  - dumps the seated-pose bone frame (for tuning) then asserts:
 *      glb:true, SkinnedMesh with >50 bones, MeshLambert+skinning mats, model visible & sane size
 *      steer lean flips spine/head bone rotation sign
 *      a bot forced to 'bucky3d' also renders (2+ SkeletonUtils clones)
 *      bucky3d is in the random driver pool
 *  - screenshots to shots/fk-bucky3d-*.png
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8849;
const BASE = `http://127.0.0.1:${PORT}`;
const BLOCK = /googleapis\.com|firestore|firebaseio|firebase|gstatic/i;

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

async function bootBucky3d(page) {
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem("fk_driver", "bucky3d"); localStorage.setItem("fk_kart", "bucky"); } catch (e) {}
  });
  await page.goto(BASE + "/farmkart.html?track=amen-farms", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
  // wait for the skinned clone to attach + pose
  await page.waitForFunction(() => {
    const K = window.__KART__; const v = K.kartViews && K.kartViews.local; const g = v && v.goat;
    return !!(g && g.glb && g._ready && g.bones);
  }, { timeout: 20000 });
  await page.evaluate(() => {
    const K = window.__KART__;
    Object.assign(K.TUNE, {
      driverX: 0, driverY: 0.78, driverZ: -0.08, driverScale: 1.0,
      driverLeanSteer: 0.40, driverLeanDrift: 0.50, driverLeanSmooth: 14,
      steerWheelX: 0, steerWheelY: 1.00, steerWheelZ: 0.36, steerWheelScale: 1.05, steerWheelTurn: 1.35,
      pedalX: 0, pedalY: 0.42, pedalZ: 0.55, pedalSpread: 0.16,
      camDist: 4.2, camHeight: 2.5,
    });
    const v = K.kartViews.local; if (v && v.bodyMat) v.bodyMat.color.setHex(0x3d8b3d);
    K.reposeBucky3dLocal();
    K.forceRace();
  });
  await new Promise((r) => setTimeout(r, 500));
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
  await bootBucky3d(page);

  // ---------- INSPECT dump (for pose tuning) ----------
  const dump = await page.evaluate(() => {
    const K = window.__KART__; const v = K.kartViews.local; const g = v.goat;
    const kr = v.kartRoot; kr.updateMatrixWorld(true);
    const THREE = window.THREE; const tv = new THREE.Vector3();
    const local = (b) => { if (!b) return null; b.getWorldPosition(tv); kr.worldToLocal(tv); return [ +tv.x.toFixed(3), +tv.y.toFixed(3), +tv.z.toFixed(3) ]; };
    const names = Object.keys(g.bones);
    let boneCount = 0, skinned = 0, skinMat = 0, hasMap = 0, tris = 0;
    v.group.traverse((o) => {
      if (o.isBone) boneCount++;
      if (o.isSkinnedMesh) { skinned++; const m = o.material; if (m && m.type === "MeshLambertMaterial" && m.skinning) skinMat++; if (m && m.map) hasMap++; if (o.geometry && o.geometry.index) tris += o.geometry.index.count / 3; }
    });
    // bbox of just the driver clone
    const box = new THREE.Box3().setFromObject(g._clone);
    const sz = box.getSize(new THREE.Vector3());
    // wheel grip + pedal anchors in kartRoot-local (targets for hands/feet)
    const gripL = v.steerWheel.userData.gripL, gripR = v.steerWheel.userData.gripR;
    const footL = v.pedals.userData.footL, footR = v.pedals.userData.footR;
    return {
      boneNames: names, boneCount, skinned, skinMat, hasMap, tris: Math.round(tris),
      nativeH: +K.bucky3dNativeH.toFixed(3), wrapperScale: +g.wrapper.scale.x.toFixed(4),
      cloneBBox: { h: +sz.y.toFixed(3), w: +sz.x.toFixed(3), d: +sz.z.toFixed(3),
                   minY: +box.min.y.toFixed(3), maxY: +box.max.y.toFixed(3) },
      key: {
        Hip: local(g.bones.Hip), Head: local(g.bones.Head),
        L_Hand: local(g.bones.L_Hand), R_Hand: local(g.bones.R_Hand),
        L_Foot: local(g.bones.L_Foot), R_Foot: local(g.bones.R_Foot),
        L_ToeBase: local(g.bones.L_ToeBase), R_ToeBase: local(g.bones.R_ToeBase),
        L_Thigh: local(g.bones.L_Thigh), L_Calf: local(g.bones.L_Calf),
        L_Upperarm: local(g.bones.L_Upperarm), L_Forearm: local(g.bones.L_Forearm),
      },
      target: { gripL: local(gripL), gripR: local(gripR), footL: local(footL), footR: local(footR) },
    };
  });
  console.log("=== INSPECT ===");
  console.log("bones:", dump.boneCount, "| skinnedMesh:", dump.skinned, "| lambert+skinning mats:", dump.skinMat, "| tex maps:", dump.hasMap, "| tris:", dump.tris);
  console.log("nativeH:", dump.nativeH, "| wrapperScale:", dump.wrapperScale, "| cloneBBox:", JSON.stringify(dump.cloneBBox));
  console.log("KEY bones (kartRoot-local xyz):");
  for (const k in dump.key) console.log("   ", k.padEnd(11), JSON.stringify(dump.key[k]));
  console.log("TARGETS (hands→grip, feet→pedal):");
  for (const k in dump.target) console.log("   ", k.padEnd(11), JSON.stringify(dump.target[k]));
  console.log("boneNames:", dump.boneNames.join(","));

  // ---------- ASSERTIONS ----------
  console.log("=== ASSERT: driver contract & visuals ===");
  ok(dump.boneCount > 50, `SkinnedMesh skeleton has >50 bones (${dump.boneCount})`);
  ok(dump.skinned >= 1, `has a SkinnedMesh (${dump.skinned})`);
  ok(dump.skinMat >= 1 && dump.skinMat === dump.skinned, `all skinned meshes are MeshLambert+skinning (${dump.skinMat}/${dump.skinned})`);
  ok(dump.hasMap >= 1, `baseColor texture map present (${dump.hasMap})`);
  ok(dump.cloneBBox.h > 0.9 && dump.cloneBBox.h < 2.2, `seated clone height sane (${dump.cloneBBox.h}u, not ~10u, not collapsed)`);

  // non-dark pixel sample (model visible, not black) — center-ish of the frame
  const contract = await page.evaluate(() => {
    const v = window.__KART__.kartViews.local; const g = v.goat;
    return { glb: !!g.glb, ready: !!g._ready, hasWheel: !!v.steerWheel, hasPedals: !!v.pedals, hasHat: !!v._hatMesh, headIsBone: !!(g.head && g.head.isBone) };
  });
  ok(contract.glb === true, "driver contract glb === true");
  ok(contract.ready === true, "driver clone ready");
  ok(contract.hasWheel && contract.hasPedals, "steering wheel + pedals still built for glb driver");
  ok(contract.headIsBone === true, "driver.head points at the Head bone");
  ok(contract.hasHat === false, "no hat mesh on glb driver (hats gated off)");

  // ---------- STEER LEAN ----------
  console.log("=== ASSERT: steer lean flips bone rotation ===");
  async function leanRead(steer) {
    return await page.evaluate((st) => {
      const K = window.__KART__; const p = K.state; const v = K.kartViews.local; const g = v.goat;
      p.steer = st; p.driftAngle = 0; p.drift.active = false;
      // drive the smoothed lean straight to target so one frame suffices
      v.driverLean = st * K.TUNE.driverLeanSteer;
      K.syncKartDriver(p, v, 0.2);
      return { spineZ: g._spine ? +g._spine.rotation.z.toFixed(4) : null, headZ: g._headBone ? +g._headBone.rotation.z.toFixed(4) : null, lean: +v.driverLean.toFixed(4) };
    }, steer);
  }
  const leanL = await leanRead(1), leanR = await leanRead(-1), leanC = await leanRead(0);
  console.log("  lean left:", JSON.stringify(leanL), " right:", JSON.stringify(leanR), " center:", JSON.stringify(leanC));
  ok(leanL.spineZ !== null && leanR.spineZ !== null && Math.sign(leanL.spineZ - leanC.spineZ) === -Math.sign(leanR.spineZ - leanC.spineZ) && (leanL.spineZ - leanC.spineZ) !== 0,
     `spine bone rotation.z flips sign with steer (L ${leanL.spineZ} vs R ${leanR.spineZ}, C ${leanC.spineZ})`);
  await leanRead(0); // reset

  // ---------- random pool membership ----------
  const inPool = await page.evaluate(() => {
    const K = window.__KART__;
    let seen = false; for (let i = 0; i < 400 && !seen; i++) if (K.randomDriverId() === "bucky3d") seen = true;
    return { seen, ids: K.DRIVER_IDS.slice() };
  });
  ok(inPool.ids.indexOf("bucky3d") >= 0, `bucky3d in DRIVER_IDS [${inPool.ids.join(",")}]`);
  ok(inPool.seen === true, "bucky3d appears from randomDriverId() (bot random pool)");

  // ---------- BOT forced to bucky3d (2nd SkeletonUtils clone) ----------
  console.log("=== ASSERT: bot renders bucky3d (2+ clones) ===");
  const bot = await page.evaluate(async () => {
    const K = window.__KART__;
    const p = K.makePlayer("botB3D"); p.isBot = true; p.botName = "Cluck Norris";
    p.pos = { x: 6, z: 6 }; p.theta = 0; p.kartId = "bucky"; p.driverId = "bucky3d";
    K.G.players["botB3D"] = p;
    K.buildKartView("botB3D", 0x3f7fe0, false, "Cluck Norris", { kartId: "bucky", driverId: "bucky3d", noName: true });
    // give the async clone time to land
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) { const g = K.kartViews.botB3D && K.kartViews.botB3D.goat; if (g && g.glb && g._ready) break; await new Promise(r => setTimeout(r, 100)); }
    const vg = K.kartViews.botB3D && K.kartViews.botB3D.goat;
    let botSkinned = 0; if (K.kartViews.botB3D) K.kartViews.botB3D.group.traverse(o => { if (o.isSkinnedMesh) botSkinned++; });
    // local + bot skinned meshes coexisting (independent skeletons)
    let localSkinned = 0; K.kartViews.local.group.traverse(o => { if (o.isSkinnedMesh) localSkinned++; });
    const sameSkel = (vg && K.kartViews.local.goat && vg.bones && K.kartViews.local.goat.bones)
      ? (vg.bones.Hip === K.kartViews.local.goat.bones.Hip) : true;
    return { glb: !!(vg && vg.glb), ready: !!(vg && vg._ready), botSkinned, localSkinned, sameSkel };
  });
  ok(bot.glb && bot.ready, `bot driver is glb + ready (${JSON.stringify({ glb: bot.glb, ready: bot.ready })})`);
  ok(bot.botSkinned >= 1 && bot.localSkinned >= 1, `both local & bot have a SkinnedMesh (local ${bot.localSkinned}, bot ${bot.botSkinned})`);
  ok(bot.sameSkel === false, "bot clone has its OWN skeleton (SkeletonUtils clone, not shared bones)");

  // ---------- SCREENSHOTS (all on the LEVEL chase cam — __freeCam forces up=-Z which rolls the frame) ----------
  console.log("=== SCREENSHOTS ===");
  await page.evaluate(() => { const K = window.__KART__; delete K.G.players.botB3D; if (K.kartViews.botB3D) K.removeKartView("botB3D"); });
  async function shot(name, steer, camDist, camHeight, faceCam) {
    await page.evaluate((st, cd, ch, fc) => {
      const K = window.__KART__; const p = K.state; const v = K.kartViews.local;
      window.__freeCam = null;
      if (cd != null) K.TUNE.camDist = cd; if (ch != null) K.TUNE.camHeight = ch;
      K._bucky3dYaw = fc ? Math.PI / 2 : -Math.PI / 2;   // face-camera hero shot vs normal forward-facing
      p.steer = st; p.driftAngle = 0; p.drift.active = false;
      v.driverLean = st * K.TUNE.driverLeanSteer;
      K._setKeys("ArrowUp", true);
    }, steer, camDist == null ? null : camDist, camHeight == null ? null : camHeight, !!faceCam);
    await new Promise((r) => setTimeout(r, 350));
    const out = path.join(SHOTS, name);
    await page.screenshot({ path: out, type: "png" });
    console.log("  SHOT", name, fs.statSync(out).size, "bytes");
  }
  await shot("fk-bucky3d-straight.png", 0, 4.2, 2.5, false);
  await shot("fk-bucky3d-left.png", 1, 4.2, 2.5, false);
  await shot("fk-bucky3d-right.png", -1, 4.2, 2.5, false);
  await shot("fk-bucky3d-closeup.png", 0, 2.7, 1.95, false);   // close-up behind (driver back + horns + wheel grip)
  await shot("fk-bucky3d-hero.png", 0, 3.2, 2.0, true);        // face-camera hero shot (yaw flip → driver visible front)
  await page.evaluate(() => { window.__KART__._bucky3dYaw = -Math.PI / 2; });  // restore forward facing

  // mobile
  const mpage = await newBlockedPage(browser, errors);
  await mpage.evaluateOnNewDocument(() => { try { Object.defineProperty(window, "matchMedia", { value: (q) => ({ matches: /coarse/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) }); } catch (e) {} });
  await mpage.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await bootBucky3d(mpage);
  await mpage.evaluate(() => { const K = window.__KART__; const p = K.state; p.steer = 0.4; K.kartViews.local.driverLean = 0.16; K._setKeys("ArrowUp", true); });
  await new Promise((r) => setTimeout(r, 400));
  await mpage.screenshot({ path: path.join(SHOTS, "fk-bucky3d-mobile.png"), type: "png" });
  console.log("  SHOT fk-bucky3d-mobile.png", fs.statSync(path.join(SHOTS, "fk-bucky3d-mobile.png")).size, "bytes");

  console.log("=== PAGEERRORS ===");
  if (errors.length) { console.log("  ✗", errors.slice(0, 10)); FAIL += errors.length; } else console.log("  ✓ none");

  console.log(`\nRESULT: ${PASS} passed, ${FAIL} failed`);
  await browser.close();
  if (server) server.kill();
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
