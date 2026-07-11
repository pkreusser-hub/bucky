#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Farm Kart 3×3 kart + driver loadout (picker, bodies, bots).
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

function check(name, ok, detail) {
  const pass = !!ok;
  console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail != null ? " — " + detail : ""));
  return pass;
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

  // Block Playroom so we stay solo
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (/playroom|joinplayroom|cloudflare|firebase|googleapis|gstatic/i.test(u)) req.abort();
    else req.continue();
  });

  await page.goto(BASE + "/farmkart.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 20000 });

  let n = 0, fails = 0;
  const assert = (name, ok, detail) => { n++; if (!check(name, ok, detail)) fails++; };

  // Catalogs present
  const cats = await page.evaluate(() => ({
    karts: (window.__KART__.KART_KINDS || []).map((k) => k.id),
    drivers: (window.__KART__.DRIVER_KINDS || []).map((k) => k.id),
  }));
  assert("3 kart kinds", cats.karts.join(",") === "bucky,tractor,mower", cats.karts.join(","));
  assert("3 driver kinds", cats.drivers.join(",") === "bucky,otis,boots", cats.drivers.join(","));

  // Picker UI
  const ui = await page.evaluate(() => {
    const kp = document.querySelectorAll("#kartPick button");
    const dp = document.querySelectorAll("#drvPick button");
    return {
      kartBtns: kp.length,
      drvBtns: dp.length,
      kartOn: [...kp].filter((b) => b.classList.contains("on")).map((b) => b.dataset.id),
      drvOn: [...dp].filter((b) => b.classList.contains("on")).map((b) => b.dataset.id),
      labels: [...kp].map((b) => b.textContent.trim()).concat([...dp].map((b) => b.textContent.trim())),
    };
  });
  assert("kart picker 3 btns", ui.kartBtns === 3);
  assert("driver picker 3 btns", ui.drvBtns === 3);
  assert("default kart selected", ui.kartOn.join() === "bucky");
  assert("default driver selected", ui.drvOn.join() === "bucky");

  // Cycle every kart + driver; mesh name + driver.kind update; localStorage persists
  for (const kid of cats.karts) {
    const info = await page.evaluate((id) => {
      window.__KART__.setLocalKart(id);
      const v = window.__KART__.kartViews.local;
      const p = window.__KART__.G.players.local;
      return {
        viewKart: v.kartId,
        playerKart: p.kartId,
        rootName: v.kartRoot && v.kartRoot.name,
        ls: localStorage.getItem("fk_kart"),
        meshCount: (() => { let c = 0; v.kartRoot.traverse((o) => { if (o.isMesh) c++; }); return c; })(),
        hasDriver: !!(v.goat && v.driverRoot && v.steerWheel && v.pedals),
      };
    }, kid);
    assert("kart " + kid + " applied", info.viewKart === kid && info.playerKart === kid && info.ls === kid,
      JSON.stringify(info));
    assert("kart " + kid + " has meshes+driver", info.meshCount >= 8 && info.hasDriver, info.meshCount);
  }
  for (const did of cats.drivers) {
    const info = await page.evaluate((id) => {
      window.__KART__.setLocalDriver(id);
      const v = window.__KART__.kartViews.local;
      const p = window.__KART__.G.players.local;
      return {
        viewDrv: v.driverId,
        playerDrv: p.driverId,
        kind: v.goat && v.goat.kind,
        ls: localStorage.getItem("fk_driver"),
        handsOn: !!(v.goat && v.goat.handL.parent === v.steerWheel.userData.gripL),
      };
    }, did);
    assert("driver " + did + " applied", info.viewDrv === did && info.playerDrv === did && info.kind === did && info.ls === did,
      JSON.stringify(info));
    assert("driver " + did + " hands on wheel", info.handsOn);
  }

  // Combo: tractor + otis, screenshot
  await page.evaluate(() => {
    const K = window.__KART__;
    K.setLocalKart("tractor");
    K.setLocalDriver("otis");
    Object.assign(K.TUNE, { camDist: 5.5, camHeight: 2.8 });
    K.forceRace();
  });
  await new Promise((r) => setTimeout(r, 500));
  const combo = await page.evaluate(() => {
    const v = window.__KART__.kartViews.local;
    return { kart: v.kartId, drv: v.driverId, root: v.kartRoot.name, kind: v.goat.kind };
  });
  assert("tractor+otis combo", combo.kart === "tractor" && combo.drv === "otis" && combo.kind === "otis",
    JSON.stringify(combo));
  await page.screenshot({ path: path.join(SHOTS, "fk_loadout_tractor_otis.png"), type: "png" });
  console.log("SHOT fk_loadout_tractor_otis.png");

  // mower + boots
  await page.evaluate(() => {
    window.__KART__.setLocalKart("mower");
    window.__KART__.setLocalDriver("boots");
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: path.join(SHOTS, "fk_loadout_mower_boots.png"), type: "png" });
  console.log("SHOT fk_loadout_mower_boots.png");

  // Bots get random loadouts across the pool (Grand Prix field)
  const botInfo = await page.evaluate(() => {
    const K = window.__KART__;
    K.setRaceMode("prix");
    K.G.phase = "menu";
    K.setupRoster();
    const bots = [];
    for (const id of Object.keys(K.G.players)) {
      if (!K.G.players[id].isBot) continue;
      const p = K.G.players[id];
      const v = K.kartViews[id];
      bots.push({
        id,
        kart: p.kartId,
        drv: p.driverId,
        viewKart: v && v.kartId,
        viewDrv: v && v.driverId,
        kind: v && v.goat && v.goat.kind,
        hasRoot: !!(v && v.kartRoot),
      });
    }
    return { count: bots.length, bots: bots.slice(0, 3) };
  });
  assert("GP spawns 11 bots", botInfo.count === 11, botInfo.count);
  for (const b of botInfo.bots) {
    assert(b.id + " has view", b.hasRoot && b.viewKart === b.kart && b.viewDrv === b.drv && b.kind === b.drv,
      JSON.stringify(b));
    assert(b.id + " kart in pool", cats.karts.includes(b.kart), b.kart);
    assert(b.id + " driver in pool", cats.drivers.includes(b.drv), b.drv);
  }

  // Persist: reload and check localStorage selection restored on picker
  await page.evaluate(() => {
    localStorage.setItem("fk_kart", "mower");
    localStorage.setItem("fk_driver", "boots");
  });
  await page.goto(BASE + "/farmkart.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.kartViews && window.__KART__.kartViews.local), { timeout: 20000 });
  const restored = await page.evaluate(() => {
    const K = window.__KART__;
    const v = K.kartViews.local;
    const p = K.G.players.local;
    const kartOn = [...document.querySelectorAll("#kartPick button.on")].map((b) => b.dataset.id);
    const drvOn = [...document.querySelectorAll("#drvPick button.on")].map((b) => b.dataset.id);
    return { vKart: v.kartId, vDrv: v.driverId, pKart: p.kartId, pDrv: p.driverId, kartOn, drvOn, kind: v.goat && v.goat.kind };
  });
  assert("reload restores mower", restored.vKart === "mower" && restored.pKart === "mower" && restored.kartOn.join() === "mower",
    JSON.stringify(restored));
  assert("reload restores boots", restored.vDrv === "boots" && restored.pDrv === "boots" && restored.kind === "boots" && restored.drvOn.join() === "boots",
    JSON.stringify(restored));

  assert("0 pageerrors", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log("\n" + (n - fails) + "/" + n + " passed" + (fails ? (" · " + fails + " FAILED") : ""));
  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
