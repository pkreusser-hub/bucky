#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Time Trial / Grand Prix modes, staggered 12-grid,
 * tractor red, mower small wheels.
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8852;
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
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail != null ? " — " + detail : ""));
  return !!ok;
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
    const u = req.url();
    if (/playroom|joinplayroom|cloudflare|firebase|googleapis|gstatic/i.test(u)) req.abort();
    else req.continue();
  });

  await page.evaluateOnNewDocument(() => {
    try { localStorage.removeItem("fk_mode"); localStorage.removeItem("fk_bots"); } catch (e) {}
  });
  await page.goto(BASE + "/farmkart.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.startCountdown), { timeout: 20000 });

  let n = 0, fails = 0;
  const assert = (name, ok, detail) => { n++; if (!check(name, ok, detail)) fails++; };

  const boot = await page.evaluate(() => {
    const K = window.__KART__;
    const on = [...document.querySelectorAll("#modeBtns button.on")].map((b) => b.dataset.mode);
    const modes = [...document.querySelectorAll("#modeBtns button")].map((b) => b.dataset.mode);
    return {
      mode: K.G.raceMode,
      maxRacers: K.MAX_RACERS,
      modeOn: on,
      modes,
      noBotBtns: !document.getElementById("botBtns"),
    };
  });
  assert("default Grand Prix", boot.mode === "prix", boot.mode);
  assert("MAX_RACERS 12", boot.maxRacers === 12);
  assert("mode buttons trial+prix", boot.modes.join(",") === "trial,prix");
  assert("prix selected in UI", boot.modeOn.join() === "prix");
  assert("old bot picker gone", boot.noBotBtns);

  // Time Trial = solo
  const trial = await page.evaluate(() => {
    const K = window.__KART__;
    K.setRaceMode("trial");
    K.startCountdown();
    const ids = Object.keys(K.G.players);
    const bots = ids.filter((id) => K.G.players[id].isBot);
    return { mode: K.G.raceMode, total: ids.length, bots: bots.length, ls: localStorage.getItem("fk_mode") };
  });
  assert("time trial solo field", trial.total === 1 && trial.bots === 0, JSON.stringify(trial));
  assert("fk_mode=trial persisted", trial.ls === "trial");

  // Grand Prix = 12 staggered
  const prix = await page.evaluate(() => {
    const K = window.__KART__;
    K.setRaceMode("prix");
    K.G.phase = "menu";
    K.startCountdown();
    const ids = Object.keys(K.G.players);
    const bots = ids.filter((id) => K.G.players[id].isBot);
    const poses = [];
    for (let s = 0; s < 12; s++) {
      const g = K.gridSlotPose(s);
      poses.push({ s, x: +g.x.toFixed(2), z: +g.z.toFixed(2), backDot: null });
    }
    // Stagger check: for each row, right (odd) is further behind than left (even)
    // "behind" = more negative along finish tangent from the line
    const F = K.FINISH;
    const behind = (p) => -( (p.x - F.cx) * F.tx + (p.z - F.cz) * F.tz );
    let staggerOk = true;
    const rows = [];
    for (let r = 0; r < 6; r++) {
      const L = K.gridSlotPose(r * 2), R = K.gridSlotPose(r * 2 + 1);
      const bL = behind(L), bR = behind(R);
      rows.push({ r, bL: +bL.toFixed(2), bR: +bR.toFixed(2) });
      if (!(bR > bL + 1.0)) staggerOk = false;
    }
    // rows get progressively further back
    let rowsOk = true;
    for (let r = 1; r < 6; r++) {
      if (!(behind(K.gridSlotPose(r * 2)) > behind(K.gridSlotPose((r - 1) * 2)) + 3)) rowsOk = false;
    }
    return {
      total: ids.length,
      bots: bots.length,
      ls: localStorage.getItem("fk_mode"),
      staggerOk,
      rowsOk,
      rows,
      views: ids.filter((id) => K.kartViews[id] && K.kartViews[id].kartRoot).length,
    };
  });
  assert("grand prix 12 racers", prix.total === 12 && prix.bots === 11, JSON.stringify({ total: prix.total, bots: prix.bots }));
  assert("all 12 have views", prix.views === 12, prix.views);
  assert("stagger: right behind left", prix.staggerOk, JSON.stringify(prix.rows));
  assert("stagger: rows deepen", prix.rowsOk);
  assert("fk_mode=prix persisted", prix.ls === "prix");

  // Tractor red
  const tractor = await page.evaluate(() => {
    const K = window.__KART__;
    K.setLocalKart("tractor");
    const c = K.kartViews.local.bodyMat.color.getHex();
    return { color: c, expect: K.TRACTOR_RED, kart: K.kartViews.local.kartId };
  });
  assert("tractor body red", tractor.color === tractor.expect && tractor.kart === "tractor",
    "0x" + tractor.color.toString(16) + " vs 0x" + tractor.expect.toString(16));

  // Mower small wheels
  const mower = await page.evaluate(() => {
    const K = window.__KART__;
    K.setLocalKart("mower");
    const v = K.kartViews.local;
    K.setLocalKart("bucky");
    const v2 = K.kartViews.local;
    return {
      mowerMul: v.wheelSizeMul,
      mowerR: v.wheelR,
      buckyMul: v2.wheelSizeMul,
      buckyR: v2.wheelR,
    };
  });
  // re-read after mower set — setLocalKart to bucky overwrote. Fix: capture before switch.
  const mower2 = await page.evaluate(() => {
    const K = window.__KART__;
    K.setLocalKart("mower");
    const v = K.kartViews.local;
    return { mul: v.wheelSizeMul, r: v.wheelR };
  });
  const buckyW = await page.evaluate(() => {
    const K = window.__KART__;
    K.setLocalKart("bucky");
    const v = K.kartViews.local;
    return { mul: v.wheelSizeMul, r: v.wheelR };
  });
  assert("mower wheel mul ~0.48", Math.abs(mower2.mul - 0.48) < 0.01, mower2.mul);
  assert("mower wheelR smaller", mower2.r < buckyW.r * 0.6, mower2.r + " vs " + buckyW.r);
  assert("bucky wheel mul 1", buckyW.mul === 1);

  // Shots
  await page.evaluate(() => {
    const K = window.__KART__;
    K.setRaceMode("prix");
    K.G.phase = "menu";
    K.setLocalKart("tractor");
    K.setLocalDriver("otis");
    K.startCountdown();
    Object.assign(K.TUNE, { camDist: 8, camHeight: 4.5 });
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: path.join(SHOTS, "fk_prix_grid.png"), type: "png" });
  console.log("SHOT fk_prix_grid.png");

  await page.evaluate(() => {
    const K = window.__KART__;
    K.setLocalKart("mower");
    K.setLocalDriver("boots");
    Object.assign(K.TUNE, { camDist: 5, camHeight: 2.6 });
    // peek just the local kart — remove bot views for a clean wheel shot
    for (const id of Object.keys(K.G.players)) {
      if (id !== "local") { K.removeKartView(id); delete K.G.players[id]; }
    }
    K.forceRace();
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(SHOTS, "fk_mower_wheels.png"), type: "png" });
  console.log("SHOT fk_mower_wheels.png");

  assert("0 pageerrors", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log("\n" + (n - fails) + "/" + n + " passed" + (fails ? (" · " + fails + " FAILED") : ""));
  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
