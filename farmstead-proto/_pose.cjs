#!/usr/bin/env node
"use strict";
/** Camera-pose contact sheet — ONE page load, many poses. Used to dial the hero
 *  composition without paying a browser boot per try. Writes farmstead-proto/tmp/. */
const path = require("path");
const fs = require("fs");
const H = require(path.resolve(__dirname, "..", "tools", "_fs_harness.cjs"));
const PORT = 8873;

const POSES = JSON.parse(process.argv[3] || "[]");
const STYLE = process.argv[2] || "1";

(async () => {
  const server = await H.serveStatic(PORT);
  const browser = await H.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("  !! " + e.message));
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith(`http://127.0.0.1:${PORT}`) ? r.continue() : r.abort()));
  await page.goto(`http://127.0.0.1:${PORT}/farmstead-proto/proto.html?style=${STYLE}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__PROTO_READY__, { timeout: 60000 });

  const dir = path.resolve(__dirname, "tmp");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < POSES.length; i++) {
    const p = POSES[i];
    await page.evaluate((p) => {
      const P = window.__PROTO__, FSMap = P.FSMap, map = P.G.map;
      const c = P.info.cxz, yaw = p.yaw, push = p.push;
      P.FSRender.setCam({
        tx: c[0] - Math.sin(yaw + Math.PI) * push,
        tz: c[1] - Math.cos(yaw + Math.PI) * push,
        ty: map.height[P.info.castle.v] + 0.9,
        dist: p.dist, yaw, pitch: p.pitch * Math.PI / 180,
      });
      for (let k = 0; k < 4; k++) P.FSRender.frame(1e-5);
    }, p);
    const f = path.join(dir, `pose_${i}.png`);
    await page.screenshot({ path: f });
    console.log(`pose_${i}`, JSON.stringify(p));
  }
  await browser.close();
  server.close();
  process.exit(0);
})();
