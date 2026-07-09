#!/usr/bin/env node
"use strict";
/**
 * Headless verify: procedural goat driver in the custom Bucky Kart.
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8847;
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
    const K = window.__KART__;
    const v = K.kartViews && K.kartViews.local;
    return !!(v && v.kartRoot && v.goat && v.driverRoot && v.steerWheel && v.pedals);
  }, { timeout: 15000 });

  await page.evaluate(() => {
    const K = window.__KART__;
    Object.assign(K.TUNE, {
      driverX: 0, driverY: 0.78, driverZ: -0.08, driverScale: 1.0,
      driverLeanSteer: 0.40, driverLeanDrift: 0.50, driverLeanSmooth: 14,
      steerWheelX: 0, steerWheelY: 1.00, steerWheelZ: 0.36,
      steerWheelScale: 1.05, steerWheelTurn: 1.35,
      pedalX: 0, pedalY: 0.42, pedalZ: 0.55, pedalSpread: 0.16,
      camDist: 4.2, camHeight: 2.5,
    });
    const v = K.kartViews.local;
    if (v && v.bodyMat) v.bodyMat.color.setHex(0x3d8b3d);
    if (K.fillKartModel) K.fillKartModel(v);
    K.forceRace();
  });
  await new Promise((r) => setTimeout(r, 600));

  const info = await page.evaluate(() => {
    const v = window.__KART__.kartViews.local;
    const g = v.goat;
    return {
      hasDriver: !!v.driverRoot,
      hasGoat: !!g,
      hasWheel: !!v.steerWheel,
      hasPedals: !!v.pedals,
      handsOnWheel: !!(g && g.handL.parent && g.handR.parent && g.handL.parent === v.steerWheel.userData.gripL),
      feetOnPedals: !!(g && g.footL.parent && g.footL.parent === v.pedals.userData.footL),
      driverPos: v.driverRoot ? [v.driverRoot.position.x, v.driverRoot.position.y, v.driverRoot.position.z] : null,
    };
  });
  console.log("INFO", JSON.stringify(info, null, 2));

  async function shot(name, steer, driftAngle) {
    await page.evaluate((st, da) => {
      const K = window.__KART__;
      const p = K.state;
      p.steer = st;
      p.driftAngle = da || 0;
      p.drift.active = !!da;
      const v = K.kartViews.local;
      if (v) v.driverLean = st * K.TUNE.driverLeanSteer + (da || 0) * K.TUNE.driverLeanDrift;
      K._setKeys("ArrowUp", true);
    }, steer, driftAngle);
    await new Promise((r) => setTimeout(r, 350));
    const out = path.join(SHOTS, name);
    await page.screenshot({ path: out, type: "png" });
    console.log("SHOT", name, fs.statSync(out).size, "bytes");
  }

  await shot("fk-driver-straight.png", 0, 0);
  await shot("fk-driver-left.png", 1, 0);
  await shot("fk-driver-right.png", -1, 0);
  await shot("fk-driver-drift-left.png", 0.6, 0.45);

  // Cabin three-quarter: beside + slightly ahead, looking at Bucky + wheel + pedals
  await page.evaluate(() => {
    const K = window.__KART__;
    const p = K.state;
    const x = p.pos.x, y = (p.y || 0), z = p.pos.z;
    const fx = Math.sin(p.theta), fz = Math.cos(p.theta);
    const rx = fz, rz = -fx;
    window.__freeCam = {
      x: x + fx * 1.1 - rx * 2.2,
      y: y + 1.25,
      z: z + fz * 1.1 - rz * 2.2,
      lx: x - fx * 0.05 - rx * 0.15,
      ly: y + 0.95,
      lz: z - fz * 0.05 - rz * 0.15,
      fov: 42,
    };
    p.steer = -0.85;
    const v = K.kartViews.local;
    if (v) v.driverLean = p.steer * K.TUNE.driverLeanSteer;
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(SHOTS, "fk-driver-cabin.png"), type: "png" });
  console.log("SHOT fk-driver-cabin.png", fs.statSync(path.join(SHOTS, "fk-driver-cabin.png")).size, "bytes");

  if (errors.length) console.log("PAGEERRORS", errors.slice(0, 10));
  else console.log("PAGEERRORS none");

  await browser.close();
  if (server) server.kill();
}

main().catch((e) => { console.error(e); process.exit(1); });
