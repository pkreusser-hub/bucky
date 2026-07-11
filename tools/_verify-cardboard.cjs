#!/usr/bin/env node
"use strict";
/** Quick verify: cardboard item boxes spin + bob. */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8853;
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
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/playroom|firebase|googleapis|gstatic/i.test(req.url())) req.abort();
    else req.continue();
  });

  await page.goto(BASE + "/farmkart.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 20000 });

  const info = await page.evaluate(() => {
    const K = window.__KART__;
    K.forceRace();
    const boxes = K.G.itemBoxes || [];
    if (!boxes.length) return { ok: false, reason: "no boxes" };
    const b = boxes[0];
    const p = K.state;
    p.pos.x = b.x; p.pos.z = b.z - 7; p.theta = 0;
    p.y = K.sampleHeight(p.pos.x, p.pos.z);
    Object.assign(K.TUNE, { camDist: 9, camHeight: 4, camLag: 40 });
    return { ok: true, n: boxes.length };
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: path.join(SHOTS, "fk_cardboard_boxes.png"), type: "png" });
  console.log("SHOT fk_cardboard_boxes.png");

  const anim = await page.evaluate(() => {
    const K = window.__KART__;
    const b = K.G.itemBoxes[0];
    let hit = null;
    K.scene.traverse((o) => {
      if (hit) return;
      if (o.type === "Group" && o.children && o.children.length >= 2 &&
          Math.hypot(o.position.x - b.x, o.position.z - b.z) < 0.6) hit = o;
    });
    if (!hit) return { found: false };
    const y0 = hit.position.y, ry0 = hit.rotation.y;
    return new Promise((res) => {
      setTimeout(() => {
        res({
          found: true,
          kids: hit.children.length,
          dy: Math.abs(hit.position.y - y0),
          dry: Math.abs(hit.rotation.y - ry0),
          rx: hit.rotation.x,
          rz: hit.rotation.z,
          hasTex: !!(hit.children[0] && hit.children[0].material && hit.children[0].material.map),
        });
      }, 700);
    });
  });

  let n = 0, fails = 0;
  const assert = (name, ok, d) => {
    n++; console.log((ok ? "PASS" : "FAIL") + "  " + name + (d != null ? " — " + d : ""));
    if (!ok) fails++;
  };
  assert("boxes present", info.ok, JSON.stringify(info));
  assert("cardboard group found", anim.found, JSON.stringify(anim));
  assert("tape + body parts", anim.kids >= 2, anim.kids);
  assert("yaw spin", anim.dry > 0.02, anim.dry);
  assert("bob moves", anim.dy > 0.02, anim.dy);
  assert("upright (no tumble)", anim.rx === 0 && anim.rz === 0);
  assert("cardboard texture", anim.hasTex);
  assert("0 pageerrors", errors.length === 0, errors.slice(0, 2).join(" | "));

  console.log("\n" + (n - fails) + "/" + n + " passed");
  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
