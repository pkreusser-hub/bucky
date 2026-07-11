#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life P0 (walkable farm, feel gate).
 * Serves the REPO ROOT and loads /farmlife/dist/index.html. Blocks Firebase/
 * Playroom out of habit (P0 touches neither). Desktop + mobile passes.
 *
 * Run:  node farmlife/verify-p0.cjs        (from repo root)
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require(path.resolve(__dirname, "..", "tools", "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8790; // house static-server port
const BASE = `http://127.0.0.1:${PORT}`;
const URL = BASE + "/farmlife/dist/index.html";

require("fs").mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail == null ? "" : String(detail) });
  console.log((cond ? "  ok  " : " FAIL ") + name + (detail != null ? "  → " + detail : ""));
}

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
          http.get({ host: "127.0.0.1", port, path: "/farmlife/dist/index.html", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootPage(browser, mobile) {
  const page = await browser.newPage();
  await page.setViewport(
    mobile ? { width: 390, height: 844, deviceScaleFactor: 2 } : { width: 1280, height: 800, deviceScaleFactor: 1 }
  );
  if (mobile) {
    await page.evaluateOnNewDocument(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        if (String(q).includes("pointer: coarse") || String(q).includes("pointer:coarse")) {
          return { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent() { return false; } };
        }
        return real(q);
      };
    });
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  // Deterministic OFF for fast-grow (test mode defaults ON) so growth timelines
  // read on the REAL clock in these suites. Merges over any existing tune.
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  page.on("request", (req) => {
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(req.url())) return req.abort();
    req.continue();
  });
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__FL__ && typeof window.__FL__._snap === "function", { timeout: 20000 });
  await sleep(300);
  return { page, errors };
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  // ============================= DESKTOP =============================
  console.log("\n=== DESKTOP 1280×800 ===");
  const { page, errors } = await bootPage(browser, false);

  // canvas non-blank
  const snap = await page.evaluate(() => window.__FL__._snap());
  check("canvas renders (distinct colors > 12)", snap.distinct > 12, `distinct=${snap.distinct} stdev=${snap.stdev.toFixed(1)} ${snap.w}x${snap.h}`);
  check("canvas non-uniform (luma stdev > 8)", snap.stdev > 8, snap.stdev.toFixed(1));

  // camera-relative forward movement for ~1.2s moves the player
  const before = await page.evaluate(() => ({ x: window.__FL__.player.x, z: window.__FL__.player.z, yaw: window.__FL__.cam.yaw }));
  await page.evaluate(() => window.__FL__.setInput({ fwd: 1, strafe: 0, run: false }));
  await sleep(1300);
  const afterFwd = await page.evaluate(() => ({ x: window.__FL__.player.x, z: window.__FL__.player.z, heading: window.__FL__.player.heading, speed: window.__FL__.player.speed }));
  const moved = Math.hypot(afterFwd.x - before.x, afterFwd.z - before.z);
  check("forward input moves player (>2m in 1.3s)", moved > 2, `moved=${moved.toFixed(2)}m speed=${afterFwd.speed.toFixed(2)}`);

  // heading responds to camera-relative direction: forward should head along cam forward (yaw)
  const expectedHeading = Math.atan2(Math.sin(before.yaw), Math.cos(before.yaw)); // = yaw
  let dH = Math.abs(((afterFwd.heading - expectedHeading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  check("heading aligns with camera-relative forward", dH < 0.4, `Δ=${dH.toFixed(3)} rad`);
  await page.evaluate(() => window.__FL__.setInput({ fwd: 0, strafe: 0, run: false }));

  // STRAFE DIRECTION (playtest fix — controls were reversed): pressing D /
  // strafe:+1 must move the player toward the camera's SCREEN-RIGHT, not left.
  // Screen-right for the chase cam = (-cos(yaw), 0, sin(yaw)); the old
  // (cos,0,-sin) rightVec was its negation, so D strafed screen-LEFT.
  await sleep(600); // let residual forward velocity settle
  const stBefore = await page.evaluate(() => ({ x: window.__FL__.player.x, z: window.__FL__.player.z, yaw: window.__FL__.cam.yaw }));
  await page.evaluate(() => window.__FL__.setInput({ fwd: 0, strafe: 1, run: false }));
  await sleep(900);
  const stAfter = await page.evaluate(() => ({ x: window.__FL__.player.x, z: window.__FL__.player.z }));
  await page.evaluate(() => window.__FL__.setInput({ fwd: 0, strafe: 0, run: false }));
  const sdx = stAfter.x - stBefore.x, sdz = stAfter.z - stBefore.z;
  const smag = Math.hypot(sdx, sdz);
  const rx = -Math.cos(stBefore.yaw), rz = Math.sin(stBefore.yaw); // camera screen-right unit
  const dotRight = smag > 0 ? (sdx * rx + sdz * rz) / smag : 0;
  check("strafe D/right moves player toward camera SCREEN-RIGHT (not reversed)", smag > 1 && dotRight > 0.9, `moved=${smag.toFixed(2)}m dot(right)=${dotRight.toFixed(2)}`);

  // orbit via simulated drag changes cam.yaw
  const yaw0 = await page.evaluate(() => window.__FL__.cam.yaw);
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(500, 400, { steps: 8 });
  await page.mouse.move(360, 400, { steps: 8 });
  await page.mouse.up();
  await sleep(60);
  const yaw1 = await page.evaluate(() => window.__FL__.cam.yaw);
  check("mouse drag orbits camera (yaw changed)", Math.abs(yaw1 - yaw0) > 0.2, `yaw ${yaw0.toFixed(2)}→${yaw1.toFixed(2)}`);

  // camera stays above terrain at low pitch while orbiting a full circle
  const camClear = await page.evaluate(async () => {
    const FL = window.__FL__;
    let minClear = 999;
    let worstYaw = 0;
    for (let i = 0; i < 48; i++) {
      const y = (i / 48) * Math.PI * 2;
      FL._setPitch(0.17); // ~10° low pitch
      FL._setYaw(y);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const p = FL._probe();
      const clr = p.camY - p.groundY;
      if (clr < minClear) { minClear = clr; worstYaw = y; }
    }
    return { minClear, worstYaw };
  });
  check("camera never under terrain at low pitch (min clearance > 0)", camClear.minClear > 0, `minClear=${camClear.minClear.toFixed(2)}m`);

  // TUNE panel toggles + slider persists
  const tuneRes = await page.evaluate(async () => {
    const dispatch = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
    // open panel with T
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "t" }));
    await new Promise((r) => setTimeout(r, 60));
    const panel = document.getElementById("fl-tune");
    const openNow = panel.classList.contains("open");
    // change moveSpeed slider
    const inp = panel.querySelector('input[data-key="moveSpeed"]');
    const oldVal = inp.value;
    inp.value = String(Math.min(parseFloat(inp.max), parseFloat(inp.value) + 1.3));
    dispatch(inp, "input");
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("fl_tune_v1")); } catch (e) {}
    return { openNow, oldVal, newVal: inp.value, savedMoveSpeed: saved && saved.moveSpeed, tuneMoveSpeed: window.__FL__.tune.moveSpeed };
  });
  check("TUNE panel opens with T key", tuneRes.openNow, `open=${tuneRes.openNow}`);
  check("TUNE slider change persists to localStorage", Math.abs(tuneRes.savedMoveSpeed - parseFloat(tuneRes.newVal)) < 0.001 && tuneRes.savedMoveSpeed === tuneRes.tuneMoveSpeed, `saved=${tuneRes.savedMoveSpeed}`);

  // Deterministic pond collision: aim camera-forward at the pond each frame, run in.
  const pondHit = await page.evaluate(async () => {
    const FL = window.__FL__;
    const PX = 30, PZ = -26, R = 10; // pond in terrain.ts
    let minD = 999;
    const start = performance.now();
    return new Promise((resolve) => {
      function tick() {
        const dx = PX - FL.player.x, dz = PZ - FL.player.z;
        const d = Math.hypot(dx, dz);
        if (d < minD) minD = d;
        // set camera forward to point exactly at the pond, then push forward+run
        FL._setYaw(Math.atan2(dx, dz));
        FL.setInput({ fwd: 1, strafe: 0, run: true });
        if (performance.now() - start < 9000) requestAnimationFrame(tick);
        else { FL.setInput({ fwd: 0, strafe: 0, run: false }); resolve({ minD, r: R, px: FL.player.x, pz: FL.player.z }); }
      }
      requestAnimationFrame(tick);
    });
  });
  check("collision blocks entering pond (min dist ≥ pond edge)", pondHit.minD >= pondHit.r - 0.9, `minDist=${pondHit.minD.toFixed(2)} pondR=${pondHit.r} final=(${pondHit.px.toFixed(1)},${pondHit.pz.toFixed(1)})`);

  await page.screenshot({ path: path.join(SHOTS, "farmlife-p0-desktop.png") });
  const realErr = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("desktop: 0 pageerrors", realErr.length === 0, realErr.join(" | "));
  await page.close();

  // ============================= MOBILE =============================
  console.log("\n=== MOBILE 390×844 (coarse pointer) ===");
  const m = await bootPage(browser, true);
  const mp = m.page;

  const mobileUI = await mp.evaluate(() => ({
    bodyMobile: document.body.classList.contains("fl-mobile"),
    touchLayer: !!document.getElementById("fl-touch"),
    stickzone: !!document.getElementById("fl-stickzone"),
    orbitzone: !!document.getElementById("fl-orbitzone"),
    cog: (getComputedStyle(document.getElementById("fl-cog") || document.body).display),
  }));
  check("mobile: touch UI present (body.fl-mobile + zones)", mobileUI.bodyMobile && mobileUI.touchLayer && mobileUI.stickzone && mobileUI.orbitzone, JSON.stringify(mobileUI));

  // joystick drag moves player: simulate pointer events on the stick zone (left half)
  const beforeM = await mp.evaluate(() => ({ x: window.__FL__.player.x, z: window.__FL__.player.z }));
  await mp.evaluate(async () => {
    const sz = document.getElementById("fl-stickzone");
    const send = (type, id, x, y) => {
      const ev = new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true });
      (type === "pointerdown" ? sz : window).dispatchEvent(ev);
    };
    send("pointerdown", 1, 100, 500);
    for (let i = 0; i < 20; i++) { send("pointermove", 1, 100, 500 - i * 6); await new Promise((r) => setTimeout(r, 16)); }
    await new Promise((r) => setTimeout(r, 900));
  });
  const afterM = await mp.evaluate(() => ({ x: window.__FL__.player.x, z: window.__FL__.player.z, speed: window.__FL__.player.speed }));
  const movedM = Math.hypot(afterM.x - beforeM.x, afterM.z - beforeM.z);
  await mp.evaluate(() => { window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true })); });
  check("mobile: joystick drag moves player", movedM > 1.5, `moved=${movedM.toFixed(2)}m`);

  // right-side drag orbits camera
  const myaw0 = await mp.evaluate(() => window.__FL__.cam.yaw);
  await mp.evaluate(async () => {
    const oz = document.getElementById("fl-orbitzone");
    const send = (type, id, x, y) => {
      const ev = new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true });
      (type === "pointerdown" ? oz : window).dispatchEvent(ev);
    };
    send("pointerdown", 2, 300, 400);
    for (let i = 0; i < 20; i++) { send("pointermove", 2, 300 - i * 8, 400); await new Promise((r) => setTimeout(r, 16)); }
    send("pointerup", 2, 140, 400);
  });
  const myaw1 = await mp.evaluate(() => window.__FL__.cam.yaw);
  check("mobile: right-side drag orbits camera", Math.abs(myaw1 - myaw0) > 0.2, `yaw ${myaw0.toFixed(2)}→${myaw1.toFixed(2)}`);

  await mp.screenshot({ path: path.join(SHOTS, "farmlife-p0-mobile.png") });
  const realErrM = m.errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("mobile: 0 pageerrors", realErrM.length === 0, realErrM.join(" | "));
  await mp.close();

  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  console.log("shots: shots/farmlife-p0-desktop.png, shots/farmlife-p0-mobile.png");
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
