#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Farm Kart top-right minimap shows during race and plots players.
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
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
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  // Block Playroom / Firebase so we stay solo-deterministic
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
    req.continue();
  });

  await page.goto(BASE + "/farmkart.html", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });

  const menu = await page.evaluate(() => {
    const el = document.getElementById("minimap");
    const cs = getComputedStyle(el);
    return {
      exists: !!el,
      on: el.classList.contains("on"),
      display: cs.display,
      top: cs.top,
      right: cs.right,
    };
  });
  console.log("menu:", JSON.stringify(menu));
  if (!menu.exists) throw new Error("minimap element missing");
  if (menu.on || menu.display !== "none") throw new Error("minimap should be hidden on menu");

  await page.evaluate(() => {
    const K = window.__KART__;
    // forceRace wipes bots — race first, then re-add bots for multi-dot check
    K.forceRace();
    K.G.botCount = 2;
    K.setupRoster();
    K.placeAllAtGrid();
    const local = K.G.players.local;
    local.pos.x += 8; local.pos.z += 4; local.theta = Math.PI / 2;
    for (const id in K.G.players) {
      if (id === "local") continue;
      const p = K.G.players[id];
      p.pos.x -= 6; p.pos.z -= 3;
    }
    K.updateMinimap();
  });
  // let a couple frames paint
  await page.waitForFunction(() => {
    const el = document.getElementById("minimap");
    return el && el.classList.contains("on");
  }, { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 200));

  const race = await page.evaluate(() => {
    const K = window.__KART__;
    const el = K.minimapEl;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const ctx = el.getContext("2d");
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let nonClear = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 20) nonClear++;
    }
    // sample a few pixels near mapped player positions — expect opaque paint
    const mm = K._mm;
    const local = K.G.players.local;
    const lx = Math.round(mm.toX(local.pos.x));
    const ly = Math.round(mm.toY(local.pos.z));
    const li = (ly * el.width + lx) * 4;
    const localPx = { r: data[li], g: data[li + 1], b: data[li + 2], a: data[li + 3] };
    const nPlayers = Object.keys(K.G.players).length;
    return {
      on: el.classList.contains("on"),
      display: cs.display,
      width: rect.width,
      height: rect.height,
      rightEdge: Math.abs(rect.right - window.innerWidth) < 20,
      topEdge: rect.top < 40,
      nonClear,
      localPx,
      nPlayers,
      phase: K.G.phase,
      mmScale: mm.scale,
    };
  });
  console.log("race:", JSON.stringify(race));

  const fails = [];
  if (!race.on || race.display === "none") fails.push("minimap not visible in race");
  if (race.nPlayers < 2) fails.push("expected local + bots");
  if (race.nonClear < 500) fails.push("canvas mostly empty (track not drawn)");
  if (!(race.localPx.a > 100)) fails.push("no paint at local player map pos");
  if (!race.rightEdge) fails.push("minimap not near top-right");
  if (!race.topEdge) fails.push("minimap not near top");
  if (errors.length) fails.push("pageerrors: " + errors.join(" | "));

  await browser.close();
  if (server) try { server.kill(); } catch (_) {}

  if (fails.length) {
    console.error("FAIL:", fails.join("; "));
    process.exit(1);
  }
  console.log("PASS minimap " + race.nPlayers + " players, " + race.nonClear + " painted px");
}

main().catch((e) => { console.error(e); process.exit(1); });
