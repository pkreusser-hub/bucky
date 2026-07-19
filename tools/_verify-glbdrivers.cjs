#!/usr/bin/env node
"use strict";
/**
 * Headless verify: the GLB (Tripo cast) driver REGISTRY in Farm Kart.
 * Parameterized over every id in GLB_DRIVER_DEFS (bucky3d/otis3d/boots3d/huey3d).
 *  - blocks googleapis/firestore/firebase/gstatic/playroom (house convention; solo/local only)
 *  - per char: boots farmkart.html with fk_driver=<id>, forceRace, waits for the skinned clone, then
 *      asserts glb:true, SkinnedMesh >50 bones, all mats MeshLambert+skinning, seated bbox height in a
 *      sane band around the entry's targetH, steer lean flips the spine bone sign, and screenshots the
 *      driver in BOTH the Bucky kart and the Gator 3D kart (wheel/pedal placement sane in the gator).
 *  - a bot forced onto each id renders an INDEPENDENT SkeletonUtils clone.
 *  - all 4 ids are in the random driver pool.
 *  - measures renderer.info.triangles in a race with 3 GLB-driver bots (perf note).
 * Screenshots: shots/fk-drivers-{otis,boots,gus}-{hero,gator}.png (+ bucky for completeness).
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8851;
const BASE = `http://127.0.0.1:${PORT}`;
const BLOCK = /googleapis\.com|firestore|firebaseio|firebase|gstatic|playroom/i;

const IDS = ["bucky3d", "otis3d", "boots3d", "huey3d"];
const SHOTNAME = { bucky3d: "bucky", otis3d: "otis", boots3d: "boots", huey3d: "huey" };

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
// shared GLB-driver TUNE framing (same as the bucky3d suite — placement is per-rig, not per-char)
async function applyFraming(page) {
  await page.evaluate(() => {
    const K = window.__KART__;
    Object.assign(K.TUNE, {
      driverX: 0, driverY: 0.78, driverZ: -0.08, driverScale: 1.0,
      driverLeanSteer: 0.40, driverLeanDrift: 0.50, driverLeanSmooth: 14,
      steerWheelX: 0, steerWheelY: 1.00, steerWheelZ: 0.36, steerWheelScale: 1.05, steerWheelTurn: 1.35,
      pedalX: 0, pedalY: 0.42, pedalZ: 0.55, pedalSpread: 0.16,
      camDist: 4.2, camHeight: 2.5,
    });
    K.reposeGlbDriverLocal();
  });
}
async function bootDriver(page, id, kartId) {
  await page.evaluateOnNewDocument((d, k) => {
    // clear fk_racer: loadLoadout() reads it FIRST and would otherwise pin the driver to whatever a
    // previous page in this shared browser persisted; with it gone the fk_driver fallback is used.
    try { localStorage.removeItem("fk_racer"); localStorage.setItem("fk_driver", d); localStorage.setItem("fk_kart", k); } catch (e) {}
  }, id, kartId);
  await page.goto(BASE + "/farmkart.html?track=amen-farms", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
  await page.waitForFunction(() => {
    const K = window.__KART__; const v = K.kartViews && K.kartViews.local; const g = v && v.goat;
    return !!(g && g.glb && g._ready && g.bones);
  }, { timeout: 20000 });
  await applyFraming(page);
  await page.evaluate(() => { const K = window.__KART__; const v = K.kartViews.local; if (v && v.bodyMat) v.bodyMat.color.setHex(0x3d8b3d); K.forceRace(); });
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

  // registry sanity from a first page
  const probe = await newBlockedPage(browser, errors);
  await probe.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
  await bootDriver(probe, "bucky3d", "bucky");
  console.log("=== REGISTRY ===");
  const reg = await probe.evaluate(() => {
    const K = window.__KART__; const defs = K.GLB_DRIVER_DEFS;
    const ids = Object.keys(defs);
    return {
      ids, driverIds: K.DRIVER_IDS.slice(),
      kinds: K.DRIVER_KINDS.map(x => x.id),
      entries: ids.map(id => ({ id, name: defs[id].name, ico: defs[id].ico, targetH: defs[id].targetH, url: defs[id].url })),
    };
  });
  for (const e of reg.entries) console.log(`   ${e.id.padEnd(8)} "${e.name}" ${e.ico}  targetH=${e.targetH}  ${e.url}`);
  ok(reg.ids.length === 4 && IDS.every(i => reg.ids.includes(i)), `GLB_DRIVER_DEFS has all 4 ids [${reg.ids.join(",")}]`);
  ok(IDS.every(i => reg.driverIds.includes(i)), `all 4 in DRIVER_IDS (picker/persistence/random pool)`);
  ok(IDS.every(i => reg.kinds.includes(i)), `all 4 in DRIVER_KINDS (picker cards)`);
  // random-pool membership for each
  const pool = await probe.evaluate((ids) => {
    const K = window.__KART__; const seen = {};
    for (const id of ids) seen[id] = false;
    for (let i = 0; i < 3000; i++) { const r = K.randomDriverId(); if (seen[r] === false) seen[r] = true; }
    return seen;
  }, IDS);
  for (const id of IDS) ok(pool[id] === true, `${id} appears from randomDriverId()`);
  await probe.close();

  // ---- per-character pass ----
  for (const id of IDS) {
    console.log(`\n=== ${id} ===`);
    const page = await newBlockedPage(browser, errors);
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
    await bootDriver(page, id, "bucky");

    const dump = await page.evaluate(() => {
      const K = window.__KART__; const v = K.kartViews.local; const g = v.goat; const THREE = window.THREE;
      let boneCount = 0, skinned = 0, skinMat = 0, hasMap = 0, tris = 0;
      v.group.traverse((o) => {
        if (o.isBone) boneCount++;
        if (o.isSkinnedMesh) { skinned++; const m = o.material; if (m && m.type === "MeshLambertMaterial" && m.skinning) skinMat++; if (m && m.map) hasMap++; if (o.geometry && o.geometry.index) tris += o.geometry.index.count / 3; }
      });
      const box = new THREE.Box3().setFromObject(g._clone); const sz = box.getSize(new THREE.Vector3());
      return {
        glb: !!g.glb, ready: !!g._ready, glbId: g._glbId, targetH: g._def ? g._def.targetH : null,
        baseYaw: g._def ? +g._def.baseYaw.toFixed(4) : null,
        boneCount, skinned, skinMat, hasMap, tris: Math.round(tris),
        h: +sz.y.toFixed(3), w: +sz.x.toFixed(3), d: +sz.z.toFixed(3),
        headIsBone: !!(g.head && g.head.isBone), hasHat: !!v._hatMesh,
        hasWheel: !!v.steerWheel, hasPedals: !!v.pedals,
      };
    });
    console.log(`   bones=${dump.boneCount} skinned=${dump.skinned} lambert+skin=${dump.skinMat} map=${dump.hasMap} tris=${dump.tris}`);
    console.log(`   seated bbox h=${dump.h} w=${dump.w} d=${dump.d} | targetH=${dump.targetH} baseYaw=${dump.baseYaw} glbId=${dump.glbId}`);
    ok(dump.glb === true && dump.ready === true, `${id}: contract glb:true + ready`);
    ok(dump.glbId === id, `${id}: contract._glbId matches`);
    ok(dump.boneCount > 50, `${id}: >50 bones (${dump.boneCount})`);
    ok(dump.skinned >= 1 && dump.skinMat === dump.skinned, `${id}: all skinned meshes MeshLambert+skinning (${dump.skinMat}/${dump.skinned})`);
    ok(dump.hasMap >= 1, `${id}: baseColor texture present (${dump.hasMap})`);
    // seated bbox height within a sane band around targetH (seated pose folds limbs, so allow 0.55..1.15x)
    ok(dump.h > dump.targetH * 0.55 && dump.h < dump.targetH * 1.2, `${id}: seated height ${dump.h}u sane vs targetH ${dump.targetH} (0.55..1.2x)`);
    ok(dump.headIsBone === true, `${id}: driver.head points at Head bone`);
    ok(dump.hasHat === false, `${id}: no hat mesh (hats gated off for glb)`);
    ok(dump.hasWheel && dump.hasPedals, `${id}: steering wheel + pedals still built`);

    // steer lean flips spine sign
    async function leanRead(steer) {
      return await page.evaluate((st) => {
        const K = window.__KART__; const p = K.state; const v = K.kartViews.local; const g = v.goat;
        p.steer = st; p.driftAngle = 0; p.drift.active = false; v.driverLean = st * K.TUNE.driverLeanSteer;
        K.syncKartDriver(p, v, 0.2);
        return { spineZ: g._spine ? +g._spine.rotation.z.toFixed(4) : null };
      }, steer);
    }
    const lL = await leanRead(1), lR = await leanRead(-1), lC = await leanRead(0);
    ok(lL.spineZ !== null && Math.sign(lL.spineZ - lC.spineZ) === -Math.sign(lR.spineZ - lC.spineZ) && (lL.spineZ - lC.spineZ) !== 0,
      `${id}: spine lean flips sign (L ${lL.spineZ} vs R ${lR.spineZ}, C ${lC.spineZ})`);
    await leanRead(0);

    // bot forced onto this id → independent clone
    const bot = await page.evaluate(async (drvId) => {
      const K = window.__KART__;
      const p = K.makePlayer("botG"); p.isBot = true; p.botName = "Cluck Norris";
      p.pos = { x: 6, z: 6 }; p.theta = 0; p.kartId = "bucky"; p.driverId = drvId;
      K.G.players["botG"] = p;
      K.buildKartView("botG", 0x3f7fe0, false, "Cluck Norris", { kartId: "bucky", driverId: drvId, noName: true });
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) { const g = K.kartViews.botG && K.kartViews.botG.goat; if (g && g.glb && g._ready) break; await new Promise(r => setTimeout(r, 100)); }
      const vg = K.kartViews.botG && K.kartViews.botG.goat;
      let botSkinned = 0; if (K.kartViews.botG) K.kartViews.botG.group.traverse(o => { if (o.isSkinnedMesh) botSkinned++; });
      const local = K.kartViews.local.goat;
      const sameSkel = (vg && local && vg.bones && local.bones) ? (vg.bones.Hip === local.bones.Hip) : true;
      K.removeKartView("botG"); delete K.G.players["botG"];
      return { glb: !!(vg && vg.glb), ready: !!(vg && vg._ready), botSkinned, sameSkel };
    }, id);
    ok(bot.glb && bot.ready && bot.botSkinned >= 1, `${id}: bot renders an independent clone (skinned ${bot.botSkinned})`);
    ok(bot.sameSkel === false, `${id}: bot clone has its OWN skeleton (SkeletonUtils clone)`);

    // screenshot — Bucky kart (hero)
    await page.evaluate(() => {
      const K = window.__KART__; const p = K.state; const v = K.kartViews.local; window.__freeCam = null;
      K.TUNE.camDist = 3.2; K.TUNE.camHeight = 2.0; K._bucky3dYaw = Math.PI / 2;  // face-camera hero (flip only affects bucky3d yaw hook; per-char yaw same)
      K.GLB_DRIVER_DEFS[v.driverId] && (K.GLB_DRIVER_DEFS[v.driverId].baseYaw = Math.PI / 2); K.reposeGlbDriverLocal();
      p.steer = 0; p.driftAngle = 0; p.drift.active = false; v.driverLean = 0; K._setKeys("ArrowUp", true);
    });
    await new Promise((r) => setTimeout(r, 350));
    { const out = path.join(SHOTS, `fk-drivers-${SHOTNAME[id]}-hero.png`); await page.screenshot({ path: out, type: "png" }); console.log(`   SHOT ${path.basename(out)} ${fs.statSync(out).size}b`); }
    // restore forward facing
    await page.evaluate(() => { const K = window.__KART__; const v = K.kartViews.local; K.GLB_DRIVER_DEFS[v.driverId].baseYaw = -Math.PI / 2; K._bucky3dYaw = -Math.PI / 2; K.reposeGlbDriverLocal(); });

    // switch to gator3d kart, screenshot (wheel/pedal/driver placement sane)
    await page.evaluate((drvId) => {
      const K = window.__KART__; const v = K.kartViews.local;
      K.applyKartLoadout(v, "gator3d", drvId);
    }, id);
    await page.waitForFunction(() => { const v = window.__KART__.kartViews.local; return !!(v.goat && v.goat.glb && v.goat._ready && v._gatorReady); }, { timeout: 20000 }).catch(() => {});
    const gator = await page.evaluate(() => {
      const K = window.__KART__; const v = K.kartViews.local; const g = v.goat; const THREE = window.THREE;
      const box = new THREE.Box3().setFromObject(g._clone); const sz = box.getSize(new THREE.Vector3());
      return { kartId: v.kartId, gatorReady: !!v._gatorReady, wheels: (v.glbWheels || []).length, driverReady: !!g._ready, h: +sz.y.toFixed(3) };
    });
    ok(gator.kartId === "gator3d" && gator.driverReady, `${id}: rides the Gator 3D kart (driver ready)`);
    ok(gator.gatorReady && gator.wheels === 4, `${id}: gator kart wheels present (${gator.wheels}) + seated`);
    await page.evaluate(() => {
      const K = window.__KART__; const p = K.state; const v = K.kartViews.local; window.__freeCam = null;
      K.TUNE.camDist = 3.4; K.TUNE.camHeight = 2.1;
      K.GLB_DRIVER_DEFS[v.driverId].baseYaw = Math.PI / 2; K.reposeGlbDriverLocal();
      p.steer = 0; v.driverLean = 0; K._setKeys("ArrowUp", true);
    });
    await new Promise((r) => setTimeout(r, 350));
    { const out = path.join(SHOTS, `fk-drivers-${SHOTNAME[id]}-gator.png`); await page.screenshot({ path: out, type: "png" }); console.log(`   SHOT ${path.basename(out)} ${fs.statSync(out).size}b`); }
    await page.evaluate(() => { const K = window.__KART__; const v = K.kartViews.local; K.GLB_DRIVER_DEFS[v.driverId].baseYaw = -Math.PI / 2; K.reposeGlbDriverLocal(); });

    await page.close();
  }

  // ---- perf: race with 3 GLB-driver bots ----
  console.log("\n=== PERF (3 GLB-driver bots) ===");
  const perfPage = await newBlockedPage(browser, errors);
  await perfPage.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
  await bootDriver(perfPage, "bucky3d", "bucky");
  const tris = await perfPage.evaluate(async () => {
    const K = window.__KART__; const drivers = ["otis3d", "boots3d", "huey3d"];
    for (let i = 0; i < 3; i++) {
      const key = "botP" + i; const p = K.makePlayer(key); p.isBot = true; p.botName = ["Archie", "Daisy", "Steffi"][i];
      p.pos = { x: 4 + i * 2, z: 4 + i * 2 }; p.theta = 0; p.kartId = "bucky"; p.driverId = drivers[i];
      K.G.players[key] = p;
      K.buildKartView(key, 0x3f7fe0, false, p.botName, { kartId: "bucky", driverId: drivers[i], noName: true });
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 9000) {
      let allReady = true;
      for (let i = 0; i < 3; i++) { const g = K.kartViews["botP" + i] && K.kartViews["botP" + i].goat; if (!(g && g._ready)) allReady = false; }
      if (allReady) break; await new Promise(r => setTimeout(r, 120));
    }
    // NOTE: do NOT forceRace() here — it rebuilds the roster from menu state and would drop these
    // hand-injected bots. The local kart is already racing (bootDriver forced it); the frame loop
    // renders any G.players entry that has a kartView, so a short wait is enough to measure.
    K._setKeys("ArrowUp", true);
    await new Promise(r => setTimeout(r, 600));
    let skinned = 0; for (const k in K.kartViews) K.kartViews[k].group && K.kartViews[k].group.traverse(o => { if (o.isSkinnedMesh) skinned++; });
    return { triangles: K.renderer ? K.renderer.info.render.triangles : null, skinnedMeshes: skinned };
  });
  console.log(`   renderer triangles (local + 3 GLB bots, mid-race): ${tris.triangles} | skinned meshes: ${tris.skinnedMeshes}`);
  ok(tris.skinnedMeshes >= 4, `4 GLB drivers coexist (local + 3 bots) skinned=${tris.skinnedMeshes}`);
  ok(tris.triangles != null && tris.triangles < 3_000_000, `triangle count not catastrophic (${tris.triangles})`);
  await perfPage.close();

  console.log("\n=== PAGEERRORS ===");
  if (errors.length) { console.log("  ✗", errors.slice(0, 12)); FAIL += errors.length; } else console.log("  ✓ none");

  console.log(`\nRESULT: ${PASS} passed, ${FAIL} failed`);
  await browser.close();
  if (server) server.kill();
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
