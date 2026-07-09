#!/usr/bin/env node
"use strict";
/**
 * Pin the kart on a grass hill and assert it tilts with the slope (not flat / hilltop-pinned).
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
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

  await page.goto(`http://127.0.0.1:${PORT}/farmkart.html`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
  await page.evaluate(() => window.__KART__.forceRace());
  await new Promise((r) => setTimeout(r, 400));

  const report = await page.evaluate(async () => {
    const K = window.__KART__;
    const p = K.state;
    const v = K.kartViews.local;
    // Find a MODERATE grass slope (what players feel) — skip cliff-edge discontinuities
    let best = null, bestScore = -1;
    for (let r = 22; r <= 70; r += 4) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const plane = K.sampleKartPlane(x, z, a + 0.4, K.sampleHeight(x, z));
        const slope = Math.hypot(plane.dHdx, plane.dHdz);
        // Prefer 0.12..0.45 slopes with wheels not wildly split (yMax-yAvg small)
        const spread = (plane.yMax != null && plane.yAvg != null) ? (plane.yMax - plane.yAvg) : 0;
        if (slope < 0.12 || slope > 0.50 || spread > 0.55) continue;
        const score = slope - spread * 0.3;
        if (score > bestScore) {
          bestScore = score;
          best = { x, z, theta: a + 0.4, plane, slope };
        }
      }
    }
    if (!best) throw new Error("no moderate slope found");

    // Pin + settle so smoothed normal catches up
    for (let i = 0; i < 45; i++) {
      p.pos.x = best.x; p.pos.z = best.z; p.theta = best.theta;
      p.v.x = 0; p.v.z = 0; p.airborne = false;
      p.y = K.sampleKartPlane(best.x, best.z, best.theta, best.plane.y).y;
      p.vy = 0;
      K.syncKartView(p, v, 0.05);
    }
    v.group.updateMatrixWorld(true);

    const plane = K.sampleKartPlane(p.pos.x, p.pos.z, p.theta, p.y);
    const kn = v.kartNormal.clone();
    // Tire clearances after tilt
    let worst = Infinity;
    const tires = [];
    for (const [fl, rw] of [[0.62,-0.58],[0.62,0.58],[-0.58,-0.58],[-0.58,0.58]]) {
      const local = new THREE.Vector3(rw, 0, fl);
      v.group.localToWorld(local);
      const gh = K.rideHeight(local.x, local.z, p.y);
      const clear = local.y - gh;
      tires.push({ fl, rw, clear: +clear.toFixed(3), wy: +local.y.toFixed(3), gh: +gh.toFixed(3) });
      if (clear < worst) worst = clear;
    }
    // How much the visual normal matches the plane (should be close after settle)
    const align = kn.dot(plane.normal);
    // Seat should be near plane average, NOT near maxHeight (hilltop pin)
    const mx = K.maxHeightUnderKart(p.pos.x, p.pos.z, p.theta, p.y);
    const seatAbovePlane = v.group.position.y - plane.y;
    const seatBelowMax = mx - v.group.position.y;

    return {
      slope: +best.slope.toFixed(3),
      planeY: +plane.y.toFixed(3),
      maxY: +mx.toFixed(3),
      seatY: +v.group.position.y.toFixed(3),
      posY: +p.y.toFixed(3),
      knY: +kn.y.toFixed(3),
      align: +align.toFixed(3),
      seatAbovePlane: +seatAbovePlane.toFixed(3),
      seatBelowMax: +seatBelowMax.toFixed(3),
      worstTire: +worst.toFixed(3),
      tires,
      spot: { x: +best.x.toFixed(1), z: +best.z.toFixed(1) },
    };
  });

  await page.screenshot({ path: path.join(SHOTS, "fk-slope-conform.png"), type: "png" });
  console.log("REPORT", JSON.stringify(report, null, 2));

  // Must tilt (kn.y clearly < 1 on a real slope), stay near plane avg (not hilltop), tires clear
  const ok =
    report.slope > 0.08 &&
    report.knY < 0.995 &&
    report.align > 0.97 &&
    report.seatAbovePlane < 0.35 &&
    report.seatAbovePlane > 0 &&
    report.worstTire > -0.02;
  console.log(ok ? "PASS" : "FAIL");

  await browser.close();
  if (server) server.kill();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
