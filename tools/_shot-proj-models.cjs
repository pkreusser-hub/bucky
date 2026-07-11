#!/usr/bin/env node
"use strict";
/**
 * Screenshot close-up of tomato (lettuce GLB) + chicken projectile meshes in front of the kart.
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8854;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(SHOTS, "fk_proj_models_close.png");

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
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/playroom|firebase|googleapis|gstatic/i.test(req.url())) req.abort();
    else req.continue();
  });

  await page.goto(BASE + "/farmkart.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 20000 });
  await page.waitForFunction(() => {
    const T = window.__KART__.projTpl;
    return !!(T && T.lettuce && T.chicken);
  }, { timeout: 20000 });

  await page.evaluate(() => { window.__KART__.forceRace(); });
  await new Promise((r) => setTimeout(r, 200));

  const info = await page.evaluate(() => {
    const K = window.__KART__;
    const THREE = window.THREE;
    const p = K.G.players.local;
    const fx = Math.sin(p.theta);
    const fz = Math.cos(p.theta);

    const tomato = K.makeProjMesh("tomato");
    const chicken = K.makeProjMesh("chicken");
    tomato.scale.setScalar(2);
    chicken.scale.setScalar(2);

    const place = (mesh, dist) => {
      const x = p.pos.x + fx * dist;
      const z = p.pos.z + fz * dist;
      const y = K.sampleHeight(x, z) + 1.2;
      mesh.position.set(x, y, z);
      K.scene.add(mesh);
      return { x, y, z };
    };
    const tPos = place(tomato, 6);
    const cPos = place(chicken, 4);

    const meshInfo = (root, label) => {
      let hasMap = false, meshCount = 0;
      root.traverse((o) => {
        if (!o.isMesh) return;
        meshCount++;
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) if (m && m.map) hasMap = true;
        }
      });
      const b = new THREE.Box3().setFromObject(root);
      const sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
      const mx = Math.max(sx, sy, sz), mn = Math.min(sx, sy, sz);
      return {
        label,
        type: root.type,
        childCount: root.children ? root.children.length : 0,
        meshCount,
        hasMap,
        bbox: { sx, sy, sz },
        bboxRatio: mx / Math.max(mn, 1e-6),
      };
    };

    const midX = (tPos.x + cPos.x) / 2;
    const midY = (tPos.y + cPos.y) / 2;
    const midZ = (tPos.z + cPos.z) / 2;
    const sideX = -fz;
    const sideZ = fx;
    const cam = {
      x: midX + sideX * 4 + fx * (-2),
      y: midY + 2.2,
      z: midZ + sideZ * 4 + fz * (-2),
      lx: midX, ly: midY, lz: midZ,
    };
    K.camera.position.set(cam.x, cam.y, cam.z);
    K.camera.lookAt(cam.lx, cam.ly, cam.lz);
    K.camera.updateMatrixWorld(true);
    if (K.renderer) K.renderer.render(K.scene, K.camera);

    return {
      tomato: meshInfo(tomato, "tomato"),
      chicken: meshInfo(chicken, "chicken"),
      tPos, cPos, cam,
    };
  });

  await page.evaluate(async (camSnap) => {
    const K = window.__KART__;
    const pin = () => {
      K.camera.position.set(camSnap.x, camSnap.y, camSnap.z);
      K.camera.lookAt(camSnap.lx, camSnap.ly, camSnap.lz);
      K.camera.updateMatrixWorld(true);
      K.renderer.render(K.scene, K.camera);
    };
    window.__fkPinCam = setInterval(pin, 16);
    for (let i = 0; i < 8; i++) {
      pin();
      await new Promise((r) => requestAnimationFrame(r));
    }
  }, info.cam);
  await new Promise((r) => setTimeout(r, 200));

  await page.screenshot({ path: OUT, type: "png" });
  await page.evaluate(() => { if (window.__fkPinCam) clearInterval(window.__fkPinCam); });

  console.log("MESH tomato:", JSON.stringify(info.tomato));
  console.log("MESH chicken:", JSON.stringify(info.chicken));
  console.log("POS tomato:", JSON.stringify(info.tPos), "chicken:", JSON.stringify(info.cPos));
  console.log("CAM:", JSON.stringify(info.cam));

  const pngOk = fs.existsSync(OUT) && fs.statSync(OUT).size > 1000;
  const mapsOk = info.tomato.hasMap && info.chicken.hasMap;
  const errOk = errors.length === 0;

  console.log(mapsOk ? "PASS  hasMap both" : "FAIL  hasMap", "tomato=" + info.tomato.hasMap, "chicken=" + info.chicken.hasMap);
  console.log("INFO  bboxRatio tomato=" + info.tomato.bboxRatio.toFixed(3) + " chicken=" + info.chicken.bboxRatio.toFixed(3));
  console.log("INFO  childCount tomato=" + info.tomato.childCount + " chicken=" + info.chicken.childCount);
  console.log(pngOk ? "PASS  PNG exists " + OUT + " (" + fs.statSync(OUT).size + " bytes)" : "FAIL  PNG missing/tiny");
  console.log(errOk ? "PASS  0 pageerrors" : "FAIL  pageerrors " + errors.slice(0, 3).join(" | "));

  const pass = pngOk && mapsOk && errOk;
  console.log("\n" + (pass ? "PASS" : "FAIL") + " overall");

  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });