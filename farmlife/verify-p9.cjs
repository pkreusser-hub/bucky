#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life STAGE 2 art swap — the PLAYER CHARACTER
 * (procedural farmer → Quaternius CC0 rigged "Farmer" GLB, AnimationMixer +
 * procedural overlays). Serves the REPO ROOT, loads /farmlife/dist/index.html.
 * Network ON for the model GLB (same-origin static); Firebase/Playroom BLOCKED
 * (goat-dup house rule). A final section BLOCKS the character URL to prove the
 * procedural fallback + 0 pageerrors.
 *
 * Screenshots: shots/farmlife-p9-{farmer,action,holdup,two-players,family}.png
 *
 * Run:  node farmlife/verify-p9.cjs        (from repo root)
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require(path.resolve(__dirname, "..", "tools", "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const URL = BASE + "/farmlife/dist/index.html";
require("fs").mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond });
  console.log((cond ? "  ok  " : " FAIL ") + name + (detail != null ? "  → " + detail : ""));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isOpen(port) {
  return new Promise((res) => { const s = net.createConnection({ port, host: "127.0.0.1" }); s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); s.setTimeout(700, () => { s.destroy(); res(false); }); });
}
async function waitServer(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isOpen(port)) { try { await new Promise((res, rej) => http.get({ host: "127.0.0.1", port, path: "/farmlife/dist/index.html", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej)); return; } catch (_) {} }
    await sleep(200);
  }
  throw new Error("server timeout");
}

// angle between two quaternions (rad)
const QANG = (a, b) => { let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; d = Math.min(1, Math.abs(d)); return 2 * Math.acos(d); };

async function boot(browser, { blockChar, mobile } = {}) {
  const page = await browser.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2 } : { width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  // Deterministic OFF for fast-grow (test mode defaults ON) so growth timelines
  // read on the REAL clock in these suites. Merges over any existing tune.
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  page.on("request", (req) => {
    const u = req.url();
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
    if (blockChar && /\/models\/character\/.*\.glb(\?|$)/i.test(u)) return req.abort();
    req.continue();
  });
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.avatar && window.__FL__.models, { timeout: 20000 });
  await page.evaluate(() => localStorage.removeItem("fl_farm_v1"));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.avatar && window.__FL__.models, { timeout: 20000 });
  await sleep(400);
  return { page, errors };
}

async function equip(page, tool) { await page.evaluate((t) => window.__FL__.farm.equip(t), tool); await sleep(60); }
async function waitIdle(page) { await page.waitForFunction(() => !window.__FL__.avatar.isBusy(), { timeout: 3000 }).catch(() => {}); }

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });

  // ==================== A. MODEL LOADS + REPLACES PROCEDURAL ====================
  console.log("\n=== A. RIGGED FARMER LOADS ===");
  const { page, errors } = await boot(browser, {});
  await page.waitForFunction(() => window.__FL__.models.characterReady(), { timeout: 20000 }).catch(() => {});
  check("character model preloaded (characterReady)", await page.evaluate(() => window.__FL__.models.characterReady()));
  check("player uses the GLB rig (not procedural fallback)", await page.evaluate(() => window.__FL__.models.playerUsesModel()));

  // ---- MIXER RUNS: a bone quaternion changes across ~1s of idle ----
  await page.evaluate(() => window.__FL__.farm.teleport(16, 34));
  await equip(page, "hands");
  await waitIdle(page);
  const names = await page.evaluate(() => window.__FL__.avatar.boneNames());
  check("rig skeleton exposes named bones", names.length > 20, `bones=${names.length} e.g. ${names.slice(0, 6).join(",")}`);
  const idleMove = await page.evaluate(async () => {
    const QANG = (a, b) => { let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; d = Math.min(1, Math.abs(d)); return 2 * Math.acos(d); };
    const BN = ["Hips", "Spine", "Chest", "Head", "Neck", "UpperArm.R", "UpperArm.L"];
    const base = {}; BN.forEach((n) => (base[n] = window.__FL__.avatar.boneQuat(n)));
    let maxA = 0;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      for (const n of BN) { const b = window.__FL__.avatar.boneQuat(n); if (base[n] && b) maxA = Math.max(maxA, QANG(base[n], b)); }
    }
    return maxA;
  });
  check("mixer runs: an idle bone quaternion changes over ~1.5s (Δ>0.008 rad)", idleMove > 0.008, `Δ=${idleMove.toFixed(4)} rad`);

  // ---- WALK/RUN CROSSFADE by speed: the locomotion weights respond to the
  // commanded speed — idle at rest, walk-dominant at low speed, run-dominant at
  // full speed. driveLoco ticks the farmer synchronously (no rAF interleave).
  const loco = await page.evaluate(() => ({
    idle: window.__FL__.avatar.driveLoco(0.0),
    walk: window.__FL__.avatar.driveLoco(0.32),
    run: window.__FL__.avatar.driveLoco(1.0),
  }));
  check("idle at rest (idle weight dominant)", loco.idle && loco.idle.idle > 0.8, JSON.stringify(loco.idle));
  check("walk speed → walk weight dominates", loco.walk && loco.walk.walk > loco.walk.run && loco.walk.walk > 0.5, JSON.stringify(loco.walk));
  check("run speed → run weight dominates (crossfade)", loco.run && loco.run.run > loco.run.walk && loco.run.run > 0.5, JSON.stringify(loco.run));

  // ---- EACH TOOL ANIM produces real arm-bone motion + input-block timing ----
  console.log("\n=== B. TOOL ANIMS (frozen-arm guard + timing) ===");
  const toolDur = { hoe: 0.55, water: 0.6, plant: 0.5, harvest: 0.62, refill: 0.55, pet: 0.5 };
  for (const kind of ["hoe", "water", "plant", "harvest", "refill", "pet"]) {
    const r = await page.evaluate(async (kind) => {
      const QANG = (a, b) => { let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; d = Math.min(1, Math.abs(d)); return 2 * Math.acos(d); };
      while (window.__FL__.avatar.isBusy()) await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => setTimeout(r, 120));
      const idle = window.__FL__.avatar.boneQuat("UpperArm.R");
      window.__FL__.avatar.playAnim(kind);
      // busy iff progress<1 — tied to the animation duration, framerate-independent.
      const busyStart = window.__FL__.avatar.isBusy();
      const p0 = window.__FL__.avatar.actionProgress();
      let maxA = 0, midBusy = false, sawEnd = false;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        maxA = Math.max(maxA, QANG(idle, window.__FL__.avatar.boneQuat("UpperArm.R")));
        const pr = window.__FL__.avatar.actionProgress();
        if (pr > 0.2 && pr < 0.85 && window.__FL__.avatar.isBusy()) midBusy = true;
        if (!window.__FL__.avatar.isBusy()) { sawEnd = window.__FL__.avatar.actionProgress() === -1; break; }
      }
      return { maxA, busyStart, p0, midBusy, sawEnd };
    }, kind);
    await waitIdle(page);
    check(`tool '${kind}': arm bone moves (Δquat>0.2 rad — not frozen)`, r.maxA > 0.2, `Δ=${r.maxA.toFixed(2)} rad`);
    // input-block timing, framerate-independent: busy the instant it starts
    // (progress ~0), stays busy through the middle of the clip, and releases
    // exactly when progress completes (isBusy tracks actionProgress<1).
    check(`tool '${kind}': input blocked for the whole animation then released`, r.busyStart && r.p0 < 0.2 && r.midBusy && r.sawEnd, `busyStart=${r.busyStart} p0=${r.p0.toFixed(2)} mid=${r.midBusy} end=${r.sawEnd}`);
  }

  // ---- HELD HOE tracks the hand bone through a swing (dist ≈ 0) ----
  console.log("\n=== C. HELD TOOL TRACKS HAND ===");
  await equip(page, "hoe");
  check("hoe mesh parented under the hand anchor", await page.evaluate(() => window.__FL__.avatar.toolAttachedToHand()));
  const track = await page.evaluate(async () => {
    window.__FL__.avatar.playAnim("hoe");
    let maxD = 0, minY = 1e9, maxY = -1e9;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const h = window.__FL__.avatar.handWorld();
      const t = window.__FL__.avatar.toolWorld();
      if (h && t) { maxD = Math.max(maxD, Math.hypot(t.x - h.x, t.y - h.y, t.z - h.z)); minY = Math.min(minY, h.y); maxY = Math.max(maxY, h.y); }
    }
    return { maxD, travel: maxY - minY };
  });
  await waitIdle(page);
  check("held hoe stays with the hand bone through the swing (dist < 0.35m)", track.maxD < 0.35, `maxDist=${track.maxD.toFixed(3)}m`);
  // realistic arm arc — not a metres-tall root-motion lunge (root-strip guard)
  check("the hand travels a realistic arc during the swing (0.25–4m)", track.travel > 0.25 && track.travel < 4, `travel=${track.travel.toFixed(2)}m`);

  // ---- HARVEST HOLD-UP shows the produce OVERHEAD ----
  console.log("\n=== D. HARVEST HOLD-UP BEAT ===");
  await equip(page, "hands");
  // Real harvest: plant + water a turnip to ready, then harvest → produceLiftY.
  const realHold = await page.evaluate(async () => {
    const ORIGIN_X = -6 - 12, ORIGIN_Z = 6 - 12, TILE = 2;
    const gx = 6, gz = 6;
    const x = ORIGIN_X + TILE * (gx + 0.5), z = ORIGIN_Z + TILE * (gz + 0.5);
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    async function face() { window.__FL__.farm.teleport(x, z - 1.6); window.__FL__.farm.setHeading(0); await raf(); await raf(); }
    async function idle() { while (window.__FL__.avatar.isBusy()) await raf(); }
    window.__FL__.farm.selectCrop("turnip");
    for (let i = 0; i < 3; i++) window.__FL__.farm.buySeed("turnip");
    window.__FL__.farm.equip("hoe"); await face(); window.__FL__.farm.action(); await idle();
    window.__FL__.farm.equip("seeds"); await face(); window.__FL__.farm.action(); await idle();
    window.__FL__.farm.equip("can");
    for (let i = 0; i < 4; i++) { window.__FL__.farm._addTimeOffset(3600001); await face(); window.__FL__.farm.action(); await idle(); }
    const ready = window.__FL__.farm.tileAt(gx, gz).stage;
    window.__FL__.farm.equip("hands"); await face();
    window.__FL__.farm.action(); // harvest → hold-up
    let maxLift = -1e9;
    for (let i = 0; i < 40; i++) { await new Promise((r) => requestAnimationFrame(r)); const l = window.__FL__.avatar.produceLiftY(); if (l != null) maxLift = Math.max(maxLift, l); }
    return { ready, maxLift };
  });
  check("harvest ripened the turnip", realHold.ready === "ready", realHold.ready);
  check("harvest hold-up raises produce overhead (>1.6m above feet)", realHold.maxLift > 1.6, `lift=${realHold.maxLift.toFixed(2)}m`);

  // ---- JUMP + LANDING SQUASH ----
  console.log("\n=== E. JUMP + LAND ===");
  await page.evaluate(() => window.__FL__.farm.teleport(0, 40));
  await sleep(200);
  const jump = await page.evaluate(async () => {
    const y0 = window.__FL__.player.y, l0 = window.__FL__.avatar.landCount();
    window.__FL__.avatar.jump();
    let maxY = -1e9, sawAir = false, sawSquash = false;
    for (let i = 0; i < 90; i++) { await new Promise((r) => requestAnimationFrame(r)); const p = window.__FL__.player; maxY = Math.max(maxY, p.y); if (p.airborne) sawAir = true; if (window.__FL__.avatar.squashActive()) sawSquash = true; }
    return { rise: maxY - y0, sawAir, sawSquash, land: window.__FL__.avatar.landCount() - l0, airborneNow: window.__FL__.player.airborne };
  });
  check("jump: rises ≥0.5m and lands (airborne cleared)", jump.rise >= 0.5 && !jump.airborneNow, `rise=${jump.rise.toFixed(2)} air=${jump.sawAir}`);
  check("landing squash fires (landCount +1, squash window seen)", jump.land === 1 && jump.sawSquash, `land=${jump.land} squash=${jump.sawSquash}`);

  // ---- SHIRT TINT: two remote avatars read as distinct colours ----
  console.log("\n=== F. REMOTE AVATARS + SHIRT TINT ===");
  const two = await page.evaluate(async () => {
    window.__FL__.presence.addTestRemote("t1", "Eleanor", 13, 34);
    window.__FL__.presence.addTestRemote("t2", "Isaac", 19, 34);
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
    return {
      m1: window.__FL__.presence.remoteUsesModel("t1"),
      m2: window.__FL__.presence.remoteUsesModel("t2"),
      tag1: window.__FL__.presence.remoteNameTagLiftY("t1"),
      tag2: window.__FL__.presence.remoteNameTagLiftY("t2"),
    };
  });
  check("both remote avatars build from the same rig", two.m1 && two.m2, JSON.stringify(two));
  check("remote name tag floats above the head (>1.8m above feet)", two.tag1 > 1.8 && two.tag2 > 1.8, `tag1=${two.tag1?.toFixed(2)} tag2=${two.tag2?.toFixed(2)}`);

  // Material-colour assert: the two remotes' tinted clothing colours differ.
  const tint = await page.evaluate(() => ({
    c1: window.__FL__.presence.remoteBodyColors("t1"),
    c2: window.__FL__.presence.remoteBodyColors("t2"),
  }));
  const set1 = new Set(tint.c1), set2 = new Set(tint.c2);
  const diff = [...set1].filter((c) => !set2.has(c)).length + [...set2].filter((c) => !set1.has(c)).length;
  check("two shirt tints produce DIFFERENT material colours (distinct players)", diff >= 2 && tint.c1.length > 0, `distinctColours=${diff} n1=${tint.c1.length}`);

  // FAMILY / TWO-PLAYER screenshots (visual tint distinctness + cohesion). All
  // three at heading 0 (facing +Z); camera to the NORTH (yaw π) looking south so
  // we see their fronts + tints.
  await page.evaluate(() => {
    window.__FL__.farm.teleport(16, 34); window.__FL__.farm.setHeading(0);
    window.__FL__._setYaw(Math.PI); window.__FL__._setPitch(0.22); window.__FL__._snapCam();
  });
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, "farmlife-p9-two-players.png") });

  // close farmer holding a hoe (front hero view)
  await equip(page, "hoe");
  await page.evaluate(() => { window.__FL__.farm.teleport(16, 34); window.__FL__.farm.setHeading(0); window.__FL__._setYaw(Math.PI); window.__FL__._setPitch(0.26); window.__FL__._snapCam(); });
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, "farmlife-p9-farmer.png") });

  // mid-swing action
  await page.evaluate(() => { window.__FL__.avatar.playAnim("hoe"); });
  await sleep(220);
  await page.screenshot({ path: path.join(SHOTS, "farmlife-p9-action.png") });
  await waitIdle(page);

  // holdup shot: re-harvest another tile quickly for the beat
  await page.evaluate(async () => {
    const ORIGIN_X = -6 - 12, ORIGIN_Z = 6 - 12, TILE = 2; const gx = 7, gz = 6;
    const x = ORIGIN_X + TILE * (gx + 0.5), z = ORIGIN_Z + TILE * (gz + 0.5);
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    async function face() { window.__FL__.farm.teleport(x, z - 1.6); window.__FL__.farm.setHeading(0); await raf(); await raf(); }
    async function idle() { while (window.__FL__.avatar.isBusy()) await raf(); }
    window.__FL__.farm.selectCrop("turnip");
    for (let i = 0; i < 3; i++) window.__FL__.farm.buySeed("turnip");
    window.__FL__.farm.equip("hoe"); await face(); window.__FL__.farm.action(); await idle();
    window.__FL__.farm.equip("seeds"); await face(); window.__FL__.farm.action(); await idle();
    window.__FL__.farm.equip("can");
    for (let i = 0; i < 4; i++) { window.__FL__.farm._addTimeOffset(3600001); await face(); window.__FL__.farm.action(); await idle(); }
    window.__FL__.farm.equip("hands"); await face();
    window.__FL__._setYaw(Math.PI); window.__FL__._setPitch(0.3); window.__FL__._snapCam();
    window.__FL__.farm.action();
  });
  await sleep(340);
  await page.screenshot({ path: path.join(SHOTS, "farmlife-p9-holdup.png") });
  await waitIdle(page);

  // wide FAMILY shot: farmer + animals + barn (does it cohere?)
  await page.evaluate(() => { window.__FL__.farm.teleport(9, 46); window.__FL__.farm.setHeading(Math.PI); window.__FL__._snapCam(); window.__FL__._setYaw(Math.PI); window.__FL__._setPitch(0.42); });
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, "farmlife-p9-family.png") });

  const realErr = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("A-F: 0 pageerrors (model on)", realErr.length === 0, realErr.join(" | "));
  await page.close();

  // ==================== G. FALLBACK (character URL blocked) ====================
  console.log("\n=== G. FALLBACK (character GLB blocked) ===");
  const fb = await boot(browser, { blockChar: true });
  await sleep(2500);
  const fbState = await fb.page.evaluate(() => ({ ready: window.__FL__.models.characterReady(), uses: window.__FL__.models.playerUsesModel() }));
  check("blocked: character stays procedural (playerUsesModel false)", fbState.uses === false, JSON.stringify(fbState));
  // full loop still works procedurally: jump + a tool anim
  const fbLoop = await fb.page.evaluate(async () => {
    window.__FL__.farm.teleport(0, 40); await new Promise((r) => setTimeout(r, 150));
    const y0 = window.__FL__.player.y, l0 = window.__FL__.avatar.landCount();
    window.__FL__.avatar.jump();
    let maxY = -1e9; for (let i = 0; i < 90; i++) { await new Promise((r) => requestAnimationFrame(r)); maxY = Math.max(maxY, window.__FL__.player.y); }
    // tool anim moves the procedural arm
    const QANG = (a, b) => { let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; d = Math.min(1, Math.abs(d)); return 2 * Math.acos(d); };
    while (window.__FL__.avatar.isBusy()) await new Promise((r) => requestAnimationFrame(r));
    const q0 = window.__FL__.avatar.armQuat(); window.__FL__.avatar.playAnim("hoe");
    let maxA = 0; for (let i = 0; i < 26; i++) { await new Promise((r) => requestAnimationFrame(r)); maxA = Math.max(maxA, QANG(q0, window.__FL__.avatar.armQuat())); }
    return { rise: maxY - y0, land: window.__FL__.avatar.landCount() - l0, armMove: maxA };
  });
  check("blocked: procedural jump+land still works", fbLoop.rise >= 0.5 && fbLoop.land === 1, `rise=${fbLoop.rise.toFixed(2)} land=${fbLoop.land}`);
  check("blocked: procedural tool anim still moves the arm", fbLoop.armMove > 0.2, `Δ=${fbLoop.armMove.toFixed(2)}`);
  const fbErr = fb.errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("blocked: 0 pageerrors (fallback clean)", fbErr.length === 0, fbErr.join(" | "));
  await fb.page.close();

  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n==== P9 RESULT: ${passed}/${results.length} passed ====`);
  console.log("shots: shots/farmlife-p9-{farmer,action,holdup,two-players,family}.png");
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
