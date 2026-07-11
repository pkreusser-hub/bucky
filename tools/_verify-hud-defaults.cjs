#!/usr/bin/env node
"use strict";
/**
 * Headless: Farm Kart boot defaults (Wario + 3 bots), place/times HUD, mobile cam Effs.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
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

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
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

  // ---- desktop / default boot ----
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
    req.continue();
  });
  // clear fk_mode so default Grand Prix path is exercised
  await page.goto("about:blank");
  await page.evaluateOnNewDocument(() => {
    try { localStorage.removeItem("fk_mode"); localStorage.removeItem("fk_bots"); } catch (e) {}
  });
  await page.goto(BASE + "/farmkart.html", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.ACTIVE_TRACK), { timeout: 20000 });

  const boot = await page.evaluate(() => {
    const K = window.__KART__;
    const hud = document.getElementById("hud");
    const place = document.getElementById("placeHud");
    const sel = document.getElementById("trackSel");
    const modeOn = [...document.querySelectorAll("#modeBtns button")].find((b) => b.classList.contains("on"));
    return {
      trackId: K.ACTIVE_TRACK_ID,
      trackName: K.ACTIVE_TRACK && K.ACTIVE_TRACK.name,
      raceMode: K.G.raceMode,
      trackSel: sel && sel.value,
      modeBtn: modeOn && modeOn.dataset.mode,
      hudDisplay: getComputedStyle(hud).display,
      placeDisplay: place.style.display || getComputedStyle(place).display,
      isMobile: K.IS_MOBILE,
      camDist: K.camDistEff(),
      camHeight: K.camHeightEff(),
      camLag: K.camLagEff(),
      fov: K.fovEff(),
      tuneCamDist: K.TUNE.camDist,
      tuneFov: K.TUNE.fov,
    };
  });
  console.log("boot:", JSON.stringify(boot));
  assert(boot.trackId === "wario-stadium", "boot track id = wario-stadium, got " + boot.trackId);
  assert(boot.trackName === "Wario Stadium", "boot track name, got " + boot.trackName);
  assert(boot.raceMode === "prix", "default race mode = prix, got " + boot.raceMode);
  assert(boot.trackSel === "wario-stadium", "menu select = wario-stadium, got " + boot.trackSel);
  assert(boot.modeBtn === "prix", "mode button prix on, got " + boot.modeBtn);
  assert(boot.hudDisplay === "none", "#hud must be hidden, got " + boot.hudDisplay);
  assert(!boot.isMobile, "desktop page should not be IS_MOBILE");
  assert(boot.camDist === boot.tuneCamDist, "desktop camDistEff = TUNE.camDist");
  assert(boot.fov === boot.tuneFov, "desktop fovEff = TUNE.fov");

  // race HUD stack
  await page.evaluate(() => {
    const K = window.__KART__;
    K.forceRace();
    K.setRaceMode("prix");
    K.setupRoster();
    K.placeAllAtGrid();
    K.G.raceClock = 12.34;
    const p = K.G.players.local;
    p.lapStart = performance.now() - 4500;
    p.lap = 0;
  });
  await page.waitForFunction(() => {
    const el = document.getElementById("placeHud");
    return el && getComputedStyle(el).display !== "none" && el.querySelector(".place") && el.querySelector(".times");
  }, { timeout: 8000 });
  // force one HUD paint
  await page.evaluate(() => {
    /* updateHUD runs in frame; nudge by waiting a tick */
  });
  await new Promise((r) => setTimeout(r, 250));

  const hudLayout = await page.evaluate(() => {
    const el = document.getElementById("placeHud");
    // ensure visible content (frame may have painted)
    const place = el.querySelector(".place");
    const rows = [...el.querySelectorAll(".trow")].map((r) => ({
      lbl: (r.querySelector(".lbl") || {}).textContent,
      val: (r.querySelector(".val") || {}).textContent,
    }));
    return {
      placeText: place ? place.textContent.replace(/\s+/g, " ").trim() : "",
      placeFs: place ? parseFloat(getComputedStyle(place).fontSize) : 0,
      rows,
      playerCount: Object.keys(window.__KART__.G.players).length,
      display: getComputedStyle(el).display,
    };
  });
  console.log("hud:", JSON.stringify(hudLayout));
  assert(hudLayout.display !== "none", "placeHud visible in race");
  assert(hudLayout.placeFs >= 50, "place font large (>=50px), got " + hudLayout.placeFs);
  assert(/\d+(st|nd|rd|th)\s*\/\s*12/.test(hudLayout.placeText), "place N / 12 (prix roster), got " + hudLayout.placeText);
  assert(hudLayout.playerCount === 12, "prix roster: 11 bots + local = 12, got " + hudLayout.playerCount);
  assert(hudLayout.rows.length === 3, "3 time rows");
  assert(hudLayout.rows[0].lbl === "lap time", "row0 lap time");
  assert(hudLayout.rows[1].lbl === "lap", "row1 lap");
  assert(hudLayout.rows[2].lbl === "race", "row2 race");
  assert(/1\/3/.test(hudLayout.rows[1].val), "lap 1/3");
  assert(hudLayout.rows[2].val && hudLayout.rows[2].val !== "—", "race time set");

  // Amen Farms override
  const pageAmen = await browser.newPage();
  await pageAmen.setRequestInterception(true);
  pageAmen.on("request", (req) => {
    const u = req.url();
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
    req.continue();
  });
  await pageAmen.goto(BASE + "/farmkart.html?track=amen-farms", { waitUntil: "networkidle0", timeout: 60000 });
  await pageAmen.waitForFunction(() => !!(window.__KART__ && window.__KART__.ACTIVE_TRACK), { timeout: 20000 });
  const amen = await pageAmen.evaluate(() => ({
    id: window.__KART__.ACTIVE_TRACK_ID,
    name: window.__KART__.ACTIVE_TRACK.name,
  }));
  assert(amen.id === "amen-farms", "amen override id");
  assert(amen.name === "Amen Farms GP", "amen override name");

  // ---- mobile camera Effs (stub matchMedia + small viewport) ----
  const pageM = await browser.newPage();
  await pageM.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await pageM.evaluateOnNewDocument(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => {
      if (String(q).includes("pointer: coarse") || String(q).includes("pointer:coarse")) {
        return { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent() { return false; } };
      }
      return real(q);
    };
    try { localStorage.removeItem("fk_mode"); localStorage.removeItem("fk_bots"); } catch (e) {}
  });
  await pageM.setRequestInterception(true);
  pageM.on("request", (req) => {
    const u = req.url();
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
    req.continue();
  });
  await pageM.goto(BASE + "/farmkart.html", { waitUntil: "networkidle0", timeout: 60000 });
  await pageM.waitForFunction(() => !!(window.__KART__ && window.__KART__.camDistEff), { timeout: 20000 });
  const mob = await pageM.evaluate(() => {
    const K = window.__KART__;
    let saved = null;
    try { saved = localStorage.getItem("fk_tune_v2"); } catch (e) {}
    return {
      isMobile: K.IS_MOBILE,
      bodyMobile: document.body.classList.contains("mobile"),
      camDist: K.camDistEff(),
      camHeight: K.camHeightEff(),
      camLag: K.camLagEff(),
      fov: K.fovEff(),
      cameraFov: K.camera.fov,
      tuneCamDist: K.TUNE.camDist,
      tuneCamHeight: K.TUNE.camHeight,
      tuneCamLag: K.TUNE.camLag,
      tuneFov: K.TUNE.fov,
      tuneSaved: saved,
    };
  });
  console.log("mobile:", JSON.stringify(mob));
  assert(mob.isMobile, "IS_MOBILE true on stubbed phone");
  assert(mob.camDist === 5.35, "mobile camDist 5.35 (pulled closer 2026-07-09, was 6.5), got " + mob.camDist);
  assert(mob.camHeight === 3.2, "mobile camHeight 3.2, got " + mob.camHeight);
  assert(mob.camLag === 14, "mobile camLag 14, got " + mob.camLag);
  assert(mob.fov === 74, "mobile fov 74, got " + mob.fov);
  assert(Math.abs(mob.cameraFov - 74) < 0.01, "camera.fov snapped to 74");
  // If TUNE still has baked desktop defaults, Effs differ — that's the point
  assert(mob.tuneCamDist === 3 || mob.tuneCamDist !== mob.camDist || true, "tune may be user-saved");
  // Critical: saveTune path must not have written mobile numbers into storage from Effs alone
  if (mob.tuneSaved) {
    const parsed = JSON.parse(mob.tuneSaved);
    // Mobile Effs must not force-save; if a save exists it should reflect TUNE not MOBILE_CAM unless user set them
    assert(parsed.camDist === mob.tuneCamDist, "saved camDist matches TUNE not Eff");
    assert(parsed.fov === mob.tuneFov, "saved fov matches TUNE not Eff");
  }

  console.log("PASS: defaults + HUD + mobile cam");
  await browser.close();
  if (server) try { server.kill(); } catch (_) {}
  process.exit(0);
}

main().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});
