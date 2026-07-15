#!/usr/bin/env node
"use strict";
/**
 * Web Goat — Stage W1 headless verify.
 * Boots webgoat.html, drives the pure physics/picker via window.__WEBGOAT__,
 * and asserts the swing pendulum, auto-anchor picker, ground/roof landing,
 * wall slide, minSwingHeight bail-out, zip, TUNE persistence, and 0 pageerrors.
 * Also captures two sanity screenshots into ../shots/.
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8871;
const BASE = `http://127.0.0.1:${PORT}`;

// prefer the Playwright chromium bundled in this env; fall back to system Chrome channel
function chromeLaunchOpts() {
  const candidates = [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
  ];
  const args = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"];
  for (const c of candidates) { if (fs.existsSync(c)) return { executablePath: c, headless: "new", args }; }
  return { channel: "chrome", headless: "new", args };
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
          http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}
let PASS = 0;
function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); PASS++; console.log("  ✓ " + msg); }
const near = (a, b, eps) => Math.abs(a - b) <= eps;

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    const bin = path.join(__dirname, "node_modules", ".bin", "http-server");
    server = spawn(bin, [ROOT, "-p", String(PORT), "-c-1", "-s"], { cwd: ROOT, stdio: "ignore" });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch(chromeLaunchOpts());
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  // three.js CDN (jsdelivr) is policy-blocked in this env — serve the npm copy locally.
  // Also block cloud domains (defensive — this page never calls them; keep the house rule).
  const THREE_JS = fs.readFileSync(path.join(__dirname, "node_modules", "three", "build", "three.min.js"), "utf8");
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (/three(@|\/).*three(\.min)?\.js/.test(url) || /cdn\.jsdelivr\.net\/npm\/three/.test(url)) {
      req.respond({ status: 200, contentType: "application/javascript", body: THREE_JS });
    } else if (/googleapis|firestore|firebase|gstatic/.test(url)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.goto(BASE + "/webgoat.html", { waitUntil: "networkidle0", timeout: 90000 });
  await page.waitForFunction(() => !!window.__WEBGOAT__, { timeout: 30000 });

  // ── 1) BOOT / TITLE / CITY ──
  console.log("\n[1] boot / title / city");
  const boot = await page.evaluate(() => {
    const el = document.getElementById("title");
    return {
      titleVis: el && !el.classList.contains("hidden"),
      logo: document.querySelector(".logo").textContent.includes("WEB GOAT"),
      bar: !!(document.querySelector("#bar a") && document.querySelector("#bar .t")),
      phase: window.__WEBGOAT__.phase,
    };
  });
  check(boot.titleVis, "title screen visible");
  check(boot.logo, "logo reads WEB GOAT");
  check(boot.bar, "Bucky back bar present");
  check(boot.phase === "title", "starts in phase title");

  await page.click("#playBtn");
  await page.waitForFunction(() => window.__WEBGOAT__.phase === "play", { timeout: 8000 });
  const afterPlay = await page.evaluate(() => {
    const cv = document.querySelector("#stage canvas");
    return { phase: window.__WEBGOAT__.phase, cw: cv.clientWidth, ch: cv.clientHeight };
  });
  check(afterPlay.phase === "play", "PLAY → phase play");
  check(afterPlay.cw > 0 && afterPlay.ch > 0, `canvas has size (${afterPlay.cw}×${afterPlay.ch})`);

  const city = await page.evaluate(() => {
    const b = window.__WEBGOAT__.buildings();
    let tall = 0, minH = Infinity, maxH = -Infinity;
    for (const x of b) {
      const h = x.maxY - x.minY;
      if (h >= 55) tall++;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
    return { n: b.length, tall, minH, maxH };
  });
  check(city.n >= 100, `CITY length ≥ 100 (${city.n})`);
  check(city.minH >= 14 - 1e-6 && city.maxH <= 65 + 1e-6, `heights in [14,65] (${city.minH.toFixed(1)}..${city.maxH.toFixed(1)})`);
  check(city.tall >= 6, `≥ 6 tall (≥55 m) buildings (${city.tall})`);

  // ── 2) PICKER ──
  console.log("\n[2] auto-anchor picker");
  const pick = await page.evaluate(() => {
    const H = window.__WEBGOAT__;
    H.setPlayer(0, 30, 0, 18, 0, 0);            // mid-air, moving +x
    const a = H.pickAnchor(0, 30, 0, 18, 0, 0, {});
    if (!a) return { a: null };
    // verify anchor sits ON some AABB face
    let onFace = false;
    for (const b of H.buildings()) {
      const onX = (Math.abs(a.x - b.minX) < 1e-3 || Math.abs(a.x - b.maxX) < 1e-3) &&
        a.z >= b.minZ - 1e-3 && a.z <= b.maxZ + 1e-3 && a.y >= b.minY - 1e-3 && a.y <= b.maxY + 1e-3;
      const onZ = (Math.abs(a.z - b.minZ) < 1e-3 || Math.abs(a.z - b.maxZ) < 1e-3) &&
        a.x >= b.minX - 1e-3 && a.x <= b.maxX + 1e-3 && a.y >= b.minY - 1e-3 && a.y <= b.maxY + 1e-3;
      const onTop = (Math.abs(a.y - b.maxY) < 1e-3) &&
        a.x >= b.minX - 1e-3 && a.x <= b.maxX + 1e-3 && a.z >= b.minZ - 1e-3 && a.z <= b.maxZ + 1e-3;
      if (onX || onZ || onTop) { onFace = true; break; }
    }
    return { a, onFace, py: 30 };
  });
  check(pick.a, "picker returns an anchor mid-air");
  check(pick.onFace, "anchor lies ON an AABB face");
  check(pick.a.y >= 30 + 6 - 1e-6, `anchor.y ≥ py + 6 (${pick.a.y.toFixed(2)})`);

  const noSky = await page.evaluate(() => {
    const H = window.__WEBGOAT__;
    let top = 0; for (const b of H.buildings()) top = Math.max(top, b.maxY);
    const a = H.pickAnchor(0, top + 25, 0, 18, 0, 0, {});
    return { a, top };
  });
  check(noSky.a === null, `no anchor above tallest+25 (top ${noSky.top.toFixed(0)})`);

  // ── 3) ROPE CONSTRAINT + PUMP ──
  console.log("\n[3] rope constraint / pump");
  const rope = await page.evaluate(() => {
    const H = window.__WEBGOAT__;
    H.setTestDriving(true);
    // find an air spot near a tall building with a good anchor, moving forward
    H.setPlayer(-30, 34, 0, 16, 0, 0);
    H.webPress();
    if (H.state !== "swing") return { attached: false };
    const attachSp = Math.hypot(H.vel.vx, H.vel.vy, H.vel.vz);
    const g = H.G.players.local;
    const anchor = { x: g.anchor.x, y: g.anchor.y, z: g.anchor.z };
    const ropeLen = g.ropeLen;
    let maxOver = -Infinity, nan = false, lowY = Infinity, lowSp = 0;
    for (let i = 0; i < 20; i++) {
      H.stepPhysics(0.1);
      const p = H.pos, v = H.vel;
      if ([p.x, p.y, p.z, v.vx, v.vy, v.vz].some((n) => !isFinite(n))) nan = true;
      const d = Math.hypot(p.x - anchor.x, p.y - anchor.y, p.z - anchor.z);
      maxOver = Math.max(maxOver, d - ropeLen);
      const sp = Math.hypot(v.vx, v.vy, v.vz);
      if (p.y < lowY) { lowY = p.y; lowSp = sp; }
    }
    return { attached: true, ropeLen, attachSp, maxOver, nan, lowSp };
  });
  check(rope.attached, "webPress → swing");
  check(rope.ropeLen > 0, `ropeLen > 0 (${rope.ropeLen.toFixed(1)})`);
  check(!rope.nan, "no NaN during swing");
  check(rope.maxOver <= 0.02, `dist ≤ ropeLen+0.02 (maxOver ${rope.maxOver.toFixed(4)})`);
  check(rope.lowSp > rope.attachSp, `pump: bottom speed ${rope.lowSp.toFixed(1)} > attach ${rope.attachSp.toFixed(1)}`);

  // ── 4) RELEASE BALLISTICS ──
  console.log("\n[4] release ballistics");
  const rel = await page.evaluate(() => {
    const H = window.__WEBGOAT__;
    H.setTestDriving(true);
    H.setPlayer(-30, 34, 0, 16, 0, 0);
    H.webPress();
    H.stepPhysics(0.6);                    // build some arc velocity
    H.TUNE.dragAir = 0;
    H.webRelease();
    const st = H.state;
    const p0 = H.pos, v0 = H.vel;
    H.stepPhysics(0.5);
    const p1 = H.pos;
    const g = H.TUNE.gravity;
    const yPred = p0.y + v0.vy * 0.5 - 0.5 * g * 0.25;
    return { st, y1: p1.y, yPred };
  });
  check(rel.st === "air", "release → air");
  check(near(rel.y1, rel.yPred, Math.max(0.05, Math.abs(rel.yPred) * 0.01)),
    `y matches projectile (${rel.y1.toFixed(3)} vs ${rel.yPred.toFixed(3)})`);
  await page.evaluate(() => { window.__WEBGOAT__.TUNE.dragAir = 0.06; });   // restore

  // ── 5) GROUND landing + run + rooftop ──
  console.log("\n[5] ground / run / rooftop");
  const grd = await page.evaluate(() => {
    const H = window.__WEBGOAT__;
    H.setTestDriving(true);
    // a street point: midway between two block centres, well clear of footprints
    const P = 42;                          // pitch (block+street)
    const sx = (-5.5 + 0) * P + P / 2;     // between block 0 and 1 in x
    const sz = (-5.5 + 5) * P + P / 2;     // between block 5 and 6 in z (near centre)
    // ensure clear of every footprint
    let clear = true;
    for (const b of H.buildings()) {
      if (sx > b.minX - 1 && sx < b.maxX + 1 && sz > b.minZ - 1 && sz < b.maxZ + 1) { clear = false; break; }
    }
    H.setPlayer(sx, 30, sz, 0, 0, 0);
    let t = 0; while (H.state !== "ground" && t < 5) { H.stepPhysics(0.05); t += 0.05; }
    const yGround = H.pos.y;
    return { clear, grounded: H.state === "ground", yGround, sx, sz };
  });
  check(grd.clear, "chosen street point is clear of footprints");
  check(grd.grounded, "falls to ground within 5 s");
  check(near(grd.yGround, 0, 0.05), `street landing y ≈ 0 (${grd.yGround.toFixed(3)})`);

  // stash the street point onto window for later evals
  await page.evaluate((sx, sz) => { window.__wgSX = sx; window.__wgSZ = sz; }, grd.sx, grd.sz);
  const run2 = await page.evaluate(() => {
    const H = window.__WEBGOAT__;
    H.setTestDriving(true);
    H.setPlayer(window.__wgSX, 30, window.__wgSZ, 0, 0, 0);
    let t = 0; while (H.state !== "ground" && t < 5) { H.stepPhysics(0.05); t += 0.05; }
    const start = { x: H.pos.x, z: H.pos.z };
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
    H.stepPhysics(1.0);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW", bubbles: true }));
    return { moved: Math.hypot(H.pos.x - start.x, H.pos.z - start.z), state: H.state };
  });
  check(run2.moved >= 3, `run: moved ≥ 3 m holding W (${run2.moved.toFixed(2)})`);

  const roof = await page.evaluate(() => {
    const H = window.__WEBGOAT__;
    H.setTestDriving(true);
    const bs = H.buildings();
    const b = bs.find((x) => x.spine) || bs[0];
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    H.setPlayer(cx, b.maxY + 12, cz, 0, 0, 0);
    let t = 0; while (H.state !== "ground" && t < 6) { H.stepPhysics(0.05); t += 0.05; }
    return { grounded: H.state === "ground", y: H.pos.y, maxY: b.maxY };
  });
  check(roof.grounded, "drop above a building lands (ground)");
  check(near(roof.y, roof.maxY, 0.05), `rooftop landing y ≈ maxY (${roof.y.toFixed(2)} vs ${roof.maxY.toFixed(2)})`);

  // ── 6) WALL SLIDE ──
  console.log("\n[6] wall collision / slide");
  const wall = await page.evaluate(() => {
    const H = window.__WEBGOAT__;
    H.setTestDriving(true);
    // pick a tall building, aim straight at its -x face at mid height with big +x velocity
    const bs = H.buildings();
    const b = bs.find((x) => x.spine) || bs.reduce((a, c) => (c.maxY > a.maxY ? c : a));
    const cz = (b.minZ + b.maxZ) / 2;
    const startX = b.minX - 6, midY = Math.min(b.maxY - 2, 20);
    H.setPlayer(startX, midY, cz, 30, 0, 0);   // barreling toward the wall
    H.stepPhysics(1.0);
    const p = H.pos, v = H.vel;
    // is the player inside any AABB expanded by (r - 0.01) = 0.49 ?
    let inside = false;
    for (const bb of bs) {
      const r = 0.49;
      if (p.x > bb.minX - r && p.x < bb.maxX + r && p.z > bb.minZ - r && p.z < bb.maxZ + r &&
        p.y > bb.minY - r && p.y < bb.maxY - 0.1) { inside = true; break; }
    }
    return { inside, vx: v.vx, px: p.x, faceX: b.minX };
  });
  check(!wall.inside, "player ends outside every AABB (expanded by r−0.01)");
  check(Math.abs(wall.vx) < 0.5, `velocity into the face ≈ 0 (vx ${wall.vx.toFixed(3)})`);

  // ── 7) minSwingHeight bail-out ──
  console.log("\n[7] minSwingHeight");
  const low = await page.evaluate(() => {
    const H = window.__WEBGOAT__;
    H.setTestDriving(true);
    // over a street: attach to a nearby building with a rope long enough that the
    // pendulum's arc bottom dips under the ground threshold — the bail-out must fire.
    H.setPlayer(-30, 20, 0, 14, 0, 0);
    H.webPress();                                // real attach via the picker code path
    const attached = H.state === "swing";
    // re-seat as a low pendulum (anchor overhead) whose arc bottom sits just under the
    // ground threshold — so the minSwingHeight bail-out must fire on the way down.
    const g = H.G.players.local;
    g.x = -30; g.y = 2.4; g.z = 0; g.vx = 12; g.vy = 0; g.vz = 0;
    g.anchor = { x: -30, y: 10.4, z: 0 };
    g.ropeLen = 8;                               // bottom = anchor.y − ropeLen = 2.4 (< 2.5, ≥ 2.0)
    let released = false, releaseY = 0;
    for (let i = 0; i < 600 && H.state === "swing"; i++) {
      H.stepPhysics(1 / 240);
      if (H.state !== "swing") { released = true; releaseY = H.pos.y; }
    }
    return { attached, released, releaseY, state: H.state };
  });
  check(low.attached, "low attach → swing");
  check(low.state !== "swing", "swing auto-releases near the ground");
  check(low.released && low.releaseY >= 2.0, `left swing before y < 2.0 (release y ${low.releaseY.toFixed(2)})`);

  // ── 8) TUNE panel + persistence ──
  console.log("\n[8] TUNE panel / persistence");
  const hiddenByDefault = await page.evaluate(() => !window.__WEBGOAT__.tunePanelVisible());
  check(hiddenByDefault, "tune panel hidden by default");
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote", bubbles: true })));
  const vis = await page.evaluate(() => window.__WEBGOAT__.tunePanelVisible());
  check(vis, "backtick shows the tune panel");
  await page.evaluate(() => {
    window.__WEBGOAT__.TUNE.gravity = 33.5;
    localStorage.setItem("wg_tune_v1", JSON.stringify(window.__WEBGOAT__.TUNE));
  });
  await page.goto(BASE + "/webgoat.html?n=" + Date.now(), { waitUntil: "networkidle0", timeout: 90000 });
  await page.waitForFunction(() => !!window.__WEBGOAT__, { timeout: 30000 });
  const restored = await page.evaluate(() => window.__WEBGOAT__.TUNE.gravity);
  check(near(restored, 33.5, 1e-6), `gravity restored from localStorage (${restored})`);
  await page.evaluate(() => localStorage.removeItem("wg_tune_v1"));   // clean up

  // ── 9) ZIP ──
  console.log("\n[9] zip");
  const zip = await page.evaluate(async () => {
    const H = window.__WEBGOAT__;
    H.startPlay();
    H.setTestDriving(true);
    H.setPlayer(-30, 34, 0, 6, 0, 0);
    const sp0 = Math.hypot(H.vel.vx, H.vel.vy, H.vel.vz);
    H.zipPress();
    const stZip = H.state;
    const sp1 = Math.hypot(H.vel.vx, H.vel.vy, H.vel.vz);
    H.stepPhysics(0.5);                     // > 0.4 s zip lock
    const stAfter = H.state;
    return { sp0, sp1, stZip, stAfter };
  });
  check(zip.stZip === "zip", "zipPress → state zip");
  check(zip.sp1 > zip.sp0, `zip increases speed (${zip.sp0.toFixed(1)} → ${zip.sp1.toFixed(1)})`);
  check(zip.stAfter === "air", "zip reverts to air after ~0.4 s");

  // ── 10) SCREENSHOTS ──
  console.log("\n[10] screenshots");
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  // mid-swing over the city
  await page.evaluate(() => {
    const H = window.__WEBGOAT__;
    H.setTestDriving(false);
    H.setPlayer(-30, 40, 0, 22, 2, 4);
    H.webPress();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(SHOTS, "webgoat-w1-city.png") });
  const cityShot = fs.statSync(path.join(SHOTS, "webgoat-w1-city.png")).size;
  check(cityShot > 8000, `city screenshot rendered (${cityShot} bytes)`);
  // street level — drop onto a central avenue with buildings flanking, facing +x
  await page.evaluate(() => {
    const H = window.__WEBGOAT__;
    H.setTestDriving(true);
    H.setPlayer(0, 6, -6, 7, 0, 0);
    let t = 0; while (H.state !== "ground" && t < 3) { H.stepPhysics(0.05); t += 0.05; }
    H.setTestDriving(false);                        // resume so the chase camera settles behind
  });
  await new Promise((r) => setTimeout(r, 1400));
  await page.screenshot({ path: path.join(SHOTS, "webgoat-w1-ground.png") });
  const groundShot = fs.statSync(path.join(SHOTS, "webgoat-w1-ground.png")).size;
  check(groundShot > 8000, `ground screenshot rendered (${groundShot} bytes)`);

  // ── 11) 0 pageerrors ──
  console.log("\n[11] errors");
  check(errors.length === 0, "0 pageerrors" + (errors.length ? ": " + errors.join("; ") : ""));

  console.log("\nWeb Goat W1 verify: PASS (" + PASS + " checks)");
  await browser.close();
  if (server) server.kill();
  process.exit(0);
}
main().catch(async (err) => { console.error("\n" + err.message); process.exitCode = 1; process.exit(1); });
