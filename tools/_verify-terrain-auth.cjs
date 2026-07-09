#!/usr/bin/env node
"use strict";
/**
 * Stage A terrain authority: on single-level road/grass, sampleHeight === groundSampleHeight.
 * Under true multi-level bridges they may diverge (mesh stays low, kart rides high).
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

  // Default Amen Farms GP (single-level) — mesh must match sampleHeight everywhere we sample
  await page.goto(`http://127.0.0.1:${PORT}/farmkart.html`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
  await page.evaluate(() => window.__KART__.forceRace());
  await new Promise((r) => setTimeout(r, 300));

  const defaultReport = await page.evaluate(() => {
    const K = window.__KART__;
    const pts = [];
    // Centerline samples + road-edge + blend skirt + far grass
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r = 8 + (i % 5) * 6;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    for (let r = 15; r <= 55; r += 10) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
    }
    let maxDiff = 0, nDisagree = 0, n = 0;
    const worst = [];
    for (const [x, z] of pts) {
      const sh = K.sampleHeight(x, z);
      const gh = K.groundSampleHeight(x, z);
      const d = Math.abs(sh - gh);
      n++;
      if (d > maxDiff) maxDiff = d;
      if (d > 0.05) {
        nDisagree++;
        if (worst.length < 8) worst.push({ x: +x.toFixed(1), z: +z.toFixed(1), sh: +sh.toFixed(3), gh: +gh.toFixed(3), d: +d.toFixed(3) });
      }
    }
    // Edge stress: walk perpendicular off a centerline point into the blend margin
    const p = K.state;
    const cx = p.pos.x, cz = p.pos.z;
    let edgeMax = 0;
    for (let off = 0; off <= 14; off += 0.5) {
      const x = cx + off, z = cz;
      const d = Math.abs(K.sampleHeight(x, z) - K.groundSampleHeight(x, z));
      if (d > edgeMax) edgeMax = d;
    }
    return { n, maxDiff: +maxDiff.toFixed(4), nDisagree, edgeMax: +edgeMax.toFixed(4), worst };
  });

  await page.screenshot({ path: path.join(SHOTS, "fk-terrain-auth-default.png"), type: "png" });

  // Royal Raceway has synthesized bridge elevation — expect SOME multi-level divergence
  await page.goto(`http://127.0.0.1:${PORT}/farmkart.html?track=royal-raceway`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
  await page.evaluate(() => window.__KART__.forceRace());
  await new Promise((r) => setTimeout(r, 400));

  const royalReport = await page.evaluate(() => {
    const K = window.__KART__;
    let maxDiff = 0, nBridge = 0, nMatch = 0, n = 0;
    for (let x = -160; x <= 220; x += 8) {
      for (let z = -100; z <= 250; z += 8) {
        const sh = K.sampleHeight(x, z);
        const gh = K.groundSampleHeight(x, z);
        const d = Math.abs(sh - gh);
        n++;
        if (d > maxDiff) maxDiff = d;
        if (d > 1.0) nBridge++;
        else if (d < 0.05) nMatch++;
      }
    }
    // Kart on elevated start should sit near sampleHeight, not buried in low ground
    const p = K.state;
    const sh = K.sampleHeight(p.pos.x, p.pos.z);
    const gh = K.groundSampleHeight(p.pos.x, p.pos.z);
    const plane = K.sampleKartPlane(p.pos.x, p.pos.z, p.theta, p.y);
    return {
      n, maxDiff: +maxDiff.toFixed(3), nBridge, nMatch,
      start: { sh: +sh.toFixed(3), gh: +gh.toFixed(3), planeY: +plane.y.toFixed(3), py: +p.y.toFixed(3) },
    };
  });

  await page.screenshot({ path: path.join(SHOTS, "fk-terrain-auth-royal.png"), type: "png" });

  console.log("DEFAULT", JSON.stringify(defaultReport, null, 2));
  console.log("ROYAL", JSON.stringify(royalReport, null, 2));
  console.log("PAGEERRORS", errors.length ? errors : "none");

  const okDefault = defaultReport.maxDiff < 0.08 && defaultReport.nDisagree === 0 && defaultReport.edgeMax < 0.08;
  // Royal: most cells match; at least one real bridge gap; kart seated near high sample
  const okRoyal =
    royalReport.nMatch > royalReport.n * 0.7 &&
    royalReport.nBridge >= 1 &&
    Math.abs(royalReport.start.planeY - royalReport.start.sh) < 0.6 &&
    royalReport.start.py + 0.3 >= Math.min(royalReport.start.sh, royalReport.start.planeY) - 0.5;
  const ok = okDefault && okRoyal && errors.length === 0;
  console.log(okDefault ? "DEFAULT PASS" : "DEFAULT FAIL");
  console.log(okRoyal ? "ROYAL PASS" : "ROYAL FAIL");
  console.log(ok ? "PASS" : "FAIL");

  await browser.close();
  if (server) server.kill();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
