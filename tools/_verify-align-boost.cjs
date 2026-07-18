#!/usr/bin/env node
"use strict";
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8856;

function isOpen(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(500, () => { s.destroy(); resolve(false); });
  });
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], {
      cwd: ROOT, stdio: "ignore", shell: true,
    });
  }
  for (let i = 0; i < 50; i++) {
    if (await isOpen(PORT)) {
      try {
        await new Promise((res, rej) => {
          http.get({ host: "127.0.0.1", port: PORT, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); })
            .on("error", rej);
        });
        break;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/playroom|firebase|googleapis|gstatic/i.test(req.url())) req.abort();
    else req.continue();
  });

  await page.goto(`http://127.0.0.1:${PORT}/farmkart.html?track=wario-stadium`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 20000 });

  const info = await page.evaluate(() => {
    const K = window.__KART__;
    const sampled = FK_TRACK.resample(K.ACTIVE_TRACK, THREE);
    const c = sampled.centerPts[30];
    const t = sampled.tangents[30];
    const ramp = {
      id: "r2", type: "ramp",
      x: c.x, y: 3, z: c.z, rotY: 9.9,
      sx: 12, sy: 3, sz: 18,
    };
    K.ACTIVE_TRACK.objects = [ramp];
    FK_TRACK.alignRampsToTrack(K.ACTIVE_TRACK, sampled);
    const dir = FK_TRACK.trackDirectionAt(sampled, ramp.x, ramp.z);
    let dYaw = Math.abs(ramp.rotY - dir.yaw);
    while (dYaw > Math.PI) dYaw = Math.abs(dYaw - Math.PI * 2);
    const aligned = dYaw < 1e-6;

    K.ACTIVE_TRACK.boostPads = [{ s: 0.1, lane: 0 }, { s: 0.4, lane: -0.5 }];
    K.buildBoostPads();
    K.buildBoostPadVisuals();
    const pad = (K.boostPads && K.boostPads[0]) || null;
    const p = K.G.players.local;
    p.v.x = 0; p.v.z = 0;
    if (pad) K.firePadBoost(p, pad);
    const kickDot = pad ? (p.v.x * pad.tx + p.v.z * pad.tz) : 0;
    return {
      aligned, rotY: ramp.rotY, expect: dir.yaw, dYaw,
      padOk: !!(pad && Math.hypot(pad.tx, pad.tz) > 0.5),
      kickAlongTrack: kickDot > 1,
      kickDot,
      padTan: pad ? { tx: pad.tx, tz: pad.tz } : null,
      tan: t,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  console.log(errors.length ? "ERRORS " + errors.join(" | ") : "0 pageerrors");
  const pass = info.aligned && info.padOk && info.kickAlongTrack && !errors.length;
  console.log(pass ? "PASS" : "FAIL");
  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
