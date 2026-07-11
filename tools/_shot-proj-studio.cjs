#!/usr/bin/env node
"use strict";
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8854;
const OUT = path.join(SHOTS, "fk_proj_studio.png");

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
  await page.setViewport({ width: 1000, height: 700, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/playroom|firebase|googleapis|gstatic/i.test(req.url())) req.abort();
    else req.continue();
  });

  await page.goto(`http://127.0.0.1:${PORT}/farmkart.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.projTpl && window.__KART__.projTpl.lettuce && window.__KART__.projTpl.chicken), { timeout: 20000 });

  const info = await page.evaluate(() => {
    const K = window.__KART__;
    K.G.phase = "menu";
    startOverlay.style.display = "none";
    const help = document.getElementById("help"); if (help) help.style.display = "none";
    const place = document.getElementById("placeHud"); if (place) place.style.display = "none";
    const mm = document.getElementById("minimap"); if (mm) mm.style.display = "none";
    const mute = document.getElementById("muteBtn"); if (mute) mute.style.display = "none";
    for (const id in K.kartViews) {
      const v = K.kartViews[id];
      if (v && v.root) v.root.visible = false;
    }
    K.scene.background = new THREE.Color(0x6aa8d8);
    const lettuce = K.makeProjMesh("tomato");
    const chicken = K.makeProjMesh("chicken");
    // Place high above origin so grass/track don't matter; __freeCam pins the view
    lettuce.position.set(-1.4, 40.0, 0);
    chicken.position.set(1.4, 40.0, 0);
    lettuce.scale.setScalar(3);
    chicken.scale.setScalar(3);
    K.scene.add(lettuce);
    K.scene.add(chicken);
    window.__freeCam = { x: 0, y: 41.6, z: 7.5, lx: 0, ly: 40.2, lz: 0, fov: 45 };
    const infoOf = (m) => {
      let hasMap = false, n = 0, cols = [];
      m.traverse((o) => {
        if (!o.isMesh) return;
        n++;
        const mat = o.material;
        if (mat && mat.map) hasMap = true;
        if (mat && mat.color) cols.push("#" + mat.color.getHexString());
      });
      const b = new THREE.Box3().setFromObject(m);
      return {
        n, hasMap, cols,
        size: [+(b.max.x - b.min.x).toFixed(3), +(b.max.y - b.min.y).toFixed(3), +(b.max.z - b.min.z).toFixed(3)],
      };
    };
    return { lettuce: infoOf(lettuce), chicken: infoOf(chicken) };
  });

  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: OUT, type: "png" });
  console.log(JSON.stringify(info, null, 2));
  console.log(errors.length ? "ERRORS " + errors.join(" | ") : "0 pageerrors");
  console.log("SHOT", OUT, fs.statSync(OUT).size);
  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}
}
main().catch((e) => { console.error(e); process.exit(1); });
