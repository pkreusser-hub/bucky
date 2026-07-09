#!/usr/bin/env node
"use strict";
/**
 * Verify wall body-pad + drift sparks (no body recolor).
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

  await page.goto(`http://127.0.0.1:${PORT}/farmkart.html`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
  await page.evaluate(() => window.__KART__.forceRace());
  await new Promise((r) => setTimeout(r, 400));

  // Shove past wall; physics RAF will clamp
  await page.evaluate(() => {
    const K = window.__KART__;
    const p = K.state;
    const wallLine = K.TRACK_WIDTH / 2 + K.effWallMargin();
    let x = p.pos.x, z = p.pos.z;
    for (let step = 0; step < 50; step++) {
      const e = 0.5;
      const dx = K.nearestCenterInfo(x + e, z).dist - K.nearestCenterInfo(x - e, z).dist;
      const dz = K.nearestCenterInfo(x, z + e).dist - K.nearestCenterInfo(x, z - e).dist;
      const L = Math.hypot(dx, dz) || 1;
      x += (dx / L) * 2;
      z += (dz / L) * 2;
      if (K.nearestCenterInfo(x, z).dist > wallLine + 4) break;
    }
    p.pos.x = x; p.pos.z = z; p.v.x = 0; p.v.z = 0; p.airborne = false;
    window.__wallMeta = {
      wallLine,
      pad: Math.max(0.55, K.TUNE.kartRadius),
      shoved: K.nearestCenterInfo(x, z).dist,
    };
  });
  await new Promise((r) => setTimeout(r, 1200));

  const wallResult = await page.evaluate(() => {
    const K = window.__KART__;
    const p = K.state;
    const v = K.kartViews.local;
    const THREE = window.THREE;
    const m = window.__wallMeta;
    const info = K.nearestCenterInfo(p.pos.x, p.pos.z);
    v.group.updateMatrixWorld(true);
    let maxCornerDist = 0;
    for (const [lx, lz] of [[0.62, 0.62], [0.62, -0.62], [-0.62, 0.62], [-0.62, -0.62], [0.7, 0], [-0.7, 0], [0, 0.85], [0, -0.85]]) {
      const w = new THREE.Vector3(lx, 0, lz);
      v.group.localToWorld(w);
      const d = K.nearestCenterInfo(w.x, w.z).dist;
      if (d > maxCornerDist) maxCornerDist = d;
    }
    return {
      centerDist: +info.dist.toFixed(3),
      maxCornerDist: +maxCornerDist.toFixed(3),
      wallLine: +m.wallLine.toFixed(3),
      pad: m.pad,
      expectedMaxCenter: +(m.wallLine - m.pad).toFixed(3),
      shoved: +m.shoved.toFixed(2),
      centerOk: info.dist <= m.wallLine - m.pad + 0.1,
      // Body may kiss the inner face; must not sink deep into the 0.5u-thick ribbon
      bodySink: +(maxCornerDist - m.wallLine).toFixed(3),
      bodyOk: maxCornerDist <= m.wallLine + 0.15,
    };
  });
  await page.screenshot({ path: path.join(SHOTS, "fk-wall-clear.png"), type: "png" });

  // Drift body + spark colors
  const drift = await page.evaluate(() => {
    const K = window.__KART__;
    const p = K.state;
    const v = K.kartViews.local;
    K.forceRace();

    function chargeForTier(want) {
      const t1 = K.TUNE.mtTier1;
      if (want === 0) return Math.max(1, t1 * 0.1);
      if (want === 1) return t1 + 1;
      return 2 * t1 + 1;
    }

    const bodyByTier = [0, 1, 2].map((want) => {
      const charge = chargeForTier(want);
      p.drift.active = true;
      p.drift.charge = charge;
      p.boostT = 0;
      // kill live particles
      for (const part of K.particles) { part.live = false; part.mat.opacity = 0; part.m.visible = false; }
      p.v.x = 12; p.v.z = 0; p.airborne = false;
      for (let i = 0; i < 25; i++) K.syncKartView(p, v, 0.04);
      const cols = [];
      for (const part of K.particles) {
        if (part.live && part.mat.opacity > 0.2) cols.push(part.mat.color.getHex());
      }
      const uniq = [...new Set(cols)];
      return {
        want,
        charge,
        bodyEmissive: v.bodyMat.emissive.getHex(),
        sparkColors: uniq.map((c) => "0x" + c.toString(16).padStart(6, "0")),
        sparkCount: cols.length,
      };
    });

    p.drift.active = false; p.drift.charge = 0; p.boostT = 0.4;
    K.syncKartView(p, v, 0.016);
    const boostEm = v.bodyMat.emissive.getHex();
    p.boostT = 0;
    K.syncKartView(p, v, 0.016);
    const idleEm = v.bodyMat.emissive.getHex();

    return { bodyByTier, boostEm, idleEm };
  });
  await page.screenshot({ path: path.join(SHOTS, "fk-drift-sparks.png"), type: "png" });

  console.log("WALL", JSON.stringify(wallResult, null, 2));
  console.log("DRIFT", JSON.stringify(drift, null, 2));
  console.log("PAGEERRORS", errors.length ? errors : "none");

  const wallOk = wallResult.centerOk && wallResult.bodyOk && wallResult.bodySink < 0.2;
  // Tier 0 dust beige, tier 1 cyan, tier 2 orange — body always 0 while drifting
  const expect = { 0: 0xcdb98a, 1: 0x18b6ff, 2: 0xff7a1a };
  const driftOk =
    drift.bodyByTier.every((t) => t.bodyEmissive === 0) &&
    drift.bodyByTier.every((t) => t.sparkColors.includes("0x" + expect[t.want].toString(16).padStart(6, "0"))) &&
    drift.idleEm === 0 &&
    drift.boostEm === 0xff7a1a;

  console.log(wallOk ? "WALL PASS" : "WALL FAIL");
  console.log(driftOk ? "DRIFT PASS" : "DRIFT FAIL");
  const ok = wallOk && driftOk;
  console.log(ok ? "PASS" : "FAIL");

  await browser.close();
  if (server) server.kill();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
