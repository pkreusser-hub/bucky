#!/usr/bin/env node
"use strict";
/**
 * Drive onto grass hills and assert the kart mesh stays above the ground sample.
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8848;
const BASE = `http://127.0.0.1:${PORT}`;

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
          http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); })
            .on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}

async function main() {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS);
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], {
      cwd: ROOT, stdio: "ignore", shell: true,
    });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  await page.goto(BASE + "/farmkart.html", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
  await page.waitForFunction(() => {
    const v = window.__KART__.kartViews && window.__KART__.kartViews.local;
    return !!(v && v.kartRoot);
  }, { timeout: 15000 });

  await page.evaluate(() => {
    const K = window.__KART__;
    K.forceRace();
  });
  await new Promise((r) => setTimeout(r, 400));

  // Teleport onto rolling grass hills (far off the road) and let a few frames settle
  const report = await page.evaluate(() => {
    const K = window.__KART__;
    const p = K.state;
    const v = K.kartViews.local;
    const THREE = window.THREE;
    // Find a grassy hill sample: walk outward from start until sampleHeight ≈ groundHills
    let best = null;
    for (let r = 20; r <= 70; r += 5) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const sh = K.sampleHeight(x, z);
        const gh = K.groundSampleHeight(x, z);
        // Prefer spots where ground mesh ≈ sampleHeight (true grass, not under a bridge)
        if (Math.abs(sh - gh) < 0.15 && Math.abs(sh) > 0.8) {
          best = { x, z, sh, gh };
          break;
        }
      }
      if (best) break;
    }
    if (!best) best = { x: 45, z: 35, sh: K.sampleHeight(45, 35), gh: K.groundSampleHeight(45, 35) };
    p.pos.x = best.x; p.pos.z = best.z; p.theta = 0.7;
    p.v.x = 0; p.v.z = 0; p.airborne = false;
    p.y = K.maxHeightUnderKart(best.x, best.z, p.theta, best.sh);
    p.vy = 0;
    // One sync tick via exposed helpers isn't enough — nudge group like the game would
    const mx = K.maxHeightUnderKart(p.pos.x, p.pos.z, p.theta, p.y);
    v.group.position.set(p.pos.x, Math.max(p.y, mx) + 0.12, p.pos.z);
    // Build orientation from slope so tilt is realistic
    const e = 1.5, cy = p.y;
    const dHdx = (K.sampleHeight(p.pos.x+e, p.pos.z) - K.sampleHeight(p.pos.x-e, p.pos.z)) / (2*e);
    const dHdz = (K.sampleHeight(p.pos.x, p.pos.z+e) - K.sampleHeight(p.pos.x, p.pos.z-e)) / (2*e);
    const up = new THREE.Vector3(-dHdx, 1, -dHdz).normalize();
    const fwd = new THREE.Vector3(Math.sin(p.theta), 0, Math.cos(p.theta));
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const m = new THREE.Matrix4().makeBasis(right, up, fwd);
    v.group.quaternion.setFromRotationMatrix(m);
    v.kartRoot.updateWorldMatrix(true, true);

    const pts = [
      [0, 0], [0.95, 0.62], [0.95, -0.62], [-0.95, 0.62], [-0.95, -0.62],
      [0.62, 0.58], [0.62, -0.58], [-0.58, 0.58], [-0.58, -0.58],
    ];
    const fx = Math.sin(p.theta), fz = Math.cos(p.theta);
    let worst = Infinity, worstPt = null, maxGround = -Infinity;
    const samples = [];
    for (const [fl, rw] of pts) {
      const sx = p.pos.x + fx * fl + fz * rw;
      const sz = p.pos.z + fz * fl - fx * rw;
      const gh = K.groundSampleHeight(sx, sz);
      if (gh > maxGround) maxGround = gh;
      const clear = v.group.position.y - gh;
      samples.push({ fl, rw, gh: +gh.toFixed(3), clear: +clear.toFixed(3) });
      if (clear < worst) { worst = clear; worstPt = { fl, rw, gh }; }
    }
    const box = new THREE.Box3().setFromObject(v.kartRoot);
    const meshClear = box.min.y - maxGround;
    return {
      spot: best,
      surface: p.surface,
      airborne: p.airborne,
      posY: +p.y.toFixed(3),
      seatY: +v.group.position.y.toFixed(3),
      maxGround: +maxGround.toFixed(3),
      worstClear: +worst.toFixed(3),
      worstPt,
      meshMinY: +box.min.y.toFixed(3),
      meshClear: +meshClear.toFixed(3),
      samples,
    };
  });

  // Pin on the grass spot while the real game loop seats/tilts for ~1.2s
  await page.evaluate((spot) => {
    const K = window.__KART__;
    window.__grassPin = setInterval(() => {
      const p = K.state;
      p.pos.x = spot.x; p.pos.z = spot.z; p.theta = 0.7;
      p.v.x = 0; p.v.z = 0; p.airborne = false;
      p.y = K.maxHeightUnderKart(spot.x, spot.z, 0.7, spot.sh);
      p.vy = 0;
    }, 16);
  }, report.spot);
  await new Promise((r) => setTimeout(r, 1200));
  // Sample WHILE still pinned (one more frame), then clear
  const settled = await page.evaluate(() => {
    const K = window.__KART__;
    const p = K.state;
    const v = K.kartViews.local;
    const THREE = window.THREE;
    // Force one sync with current pin state
    if (K.syncKartView) K.syncKartView(p, v, 0.016);
    v.group.updateMatrixWorld(true);
    v.kartRoot.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(v.kartRoot);
    const e = 1.5;
    const dHdx = (K.sampleHeight(p.pos.x+e, p.pos.z) - K.sampleHeight(p.pos.x-e, p.pos.z)) / (2*e);
    const dHdz = (K.sampleHeight(p.pos.x, p.pos.z+e) - K.sampleHeight(p.pos.x, p.pos.z-e)) / (2*e);
    let maxGround = -Infinity;
    let worstTire = Infinity;
    const corners = [];
    for (const [fl, rw] of [[0,0],[0.95,0.62],[0.95,-0.62],[-0.95,0.62],[-0.95,-0.62],[0.5,0.5],[-0.5,-0.5]]) {
      const local = new THREE.Vector3(rw, 0, fl);
      v.group.localToWorld(local);
      const gh = Math.max(K.sampleHeight(local.x, local.z), K.groundSampleHeight(local.x, local.z));
      if (gh > maxGround) maxGround = gh;
      const clear = local.y - gh;
      corners.push({ fl, rw, wy: +local.y.toFixed(3), gh: +gh.toFixed(3), clear: +clear.toFixed(3) });
      if (clear < worstTire) worstTire = clear;
    }
    return {
      surface: p.surface,
      seatY: +v.group.position.y.toFixed(3),
      posY: +p.y.toFixed(3),
      slope: +Math.hypot(dHdx, dHdz).toFixed(3),
      kn: v.kartNormal ? [+v.kartNormal.x.toFixed(3), +v.kartNormal.y.toFixed(3), +v.kartNormal.z.toFixed(3)] : null,
      maxGround: +maxGround.toFixed(3),
      meshMinY: +box.min.y.toFixed(3),
      meshClear: +(box.min.y - maxGround).toFixed(3),
      originClear: +(v.group.position.y - maxGround).toFixed(3),
      worstTireClear: +worstTire.toFixed(3),
      footMax: +K.maxHeightUnderKart(p.pos.x, p.pos.z, p.theta, p.y).toFixed(3),
      corners,
    };
  });
  await page.evaluate(() => { clearInterval(window.__grassPin); });

  await page.screenshot({ path: path.join(SHOTS, "fk-grass-clear.png"), type: "png" });
  console.log("TELEPORT", JSON.stringify(report, null, 2));
  console.log("SETTLED", JSON.stringify(settled, null, 2));
  console.log("PAGEERRORS", errors.length ? errors : "none");

  // Tire patches must clear the ground; mesh bbox may include slight lug overhang
  const ok = settled.worstTireClear > 0.02 && settled.originClear > 0.02 && settled.meshClear > -0.08;
  console.log(ok ? "PASS" : "FAIL");

  await browser.close();
  if (server) server.kill();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
