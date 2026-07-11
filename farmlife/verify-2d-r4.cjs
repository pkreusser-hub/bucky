#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life R4 — the USER-FEEDBACK round:
 *   1. SCALE PASS      — buildings/doors sized against the 28 px farmer.
 *   2. INTERIOR SCENES — walk to the farmhouse door → enter → cosy room →
 *                        exit back to the door; fade + day/night + mobile enter.
 *   3. PATH AUTO-TILE  — dithered grass↔dirt/soil/sand transitions.
 * Serves the REPO ROOT + loads /farmlife/dist/index.html. Network BLOCKED
 * (playroom/firebase/gstatic) — this is offline render/scene work.
 *
 * Run:  node farmlife/verify-2d-r4.cjs        (from repo root)
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require(path.resolve(__dirname, "..", "tools", "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const URL = BASE + "/farmlife/dist/index.html";
require("fs").mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond });
  console.log((cond ? "  ok  " : " FAIL ") + name + (detail != null ? "  → " + detail : ""));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
          http.get({ host: "127.0.0.1", port, path: "/farmlife/dist/index.html", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await sleep(200);
  }
  throw new Error("server timeout");
}
async function bootPage(browser, mobile) {
  const page = await browser.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2 } : { width: 1280, height: 720, deviceScaleFactor: 1 });
  if (mobile) {
    await page.evaluateOnNewDocument(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => (String(q).includes("coarse") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } } : real(q));
    });
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => (/playroom|googleapis|firestore|firebase|gstatic/i.test(req.url()) ? req.abort() : req.continue()));
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.scene && window.__FL__.art, { timeout: 20000 });
  await sleep(400);
  return { page, errors };
}
const P = (page, fn, ...args) => page.evaluate(fn, ...args);
// classifiers for pixel triples [r,g,b]
const isDirt = (p) => p && p[0] > 130 && p[0] > p[2] + 20 && p[0] >= p[1];
const isGrass = (p) => p && p[1] > 90 && p[1] > p[0];

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--no-sandbox"] });

  try {
    console.log("\n=== DESKTOP 1280×720 ===");
    const { page, errors } = await bootPage(browser, false);
    await P(page, () => { window.__FL__.animals.setPhase("day"); window.__FL__.weather.applySky(); });

    // ============================ 1. SCALE ============================
    const art = await P(page, () => {
      const A = window.__FL__.art;
      const names = ["farmhouse", "barn", "silo", "bin", "stand", "tree0", "tree1", "tree2"];
      const size = {};
      for (const n of names) size[n] = A.size(n);
      return { farmerPx: A.farmerPx, barnDoorH: A.barnDoorH, houseDoorH: A.houseDoorH, size };
    });
    const fp = art.farmerPx;
    check("scale: farmer reference (FARMER_PX) is ~28 px", fp >= 24 && fp <= 34, `farmerPx=${fp}`);
    check("scale: BARN door ≥ 1.25× farmer (entering feels like entering)", art.barnDoorH >= 1.25 * fp, `door=${art.barnDoorH} vs 1.25×${fp}=${(1.25 * fp).toFixed(0)}`);
    check("scale: FARMHOUSE door ≥ 1.25× farmer", art.houseDoorH >= 1.25 * fp, `door=${art.houseDoorH} vs ${(1.25 * fp).toFixed(0)}`);
    const ratio = (n) => art.size[n].h / fp;
    check("scale: farmhouse 4.8–6.2× farmer", ratio("farmhouse") >= 4.8 && ratio("farmhouse") <= 6.2, `${ratio("farmhouse").toFixed(2)}× (h=${art.size.farmhouse.h})`);
    check("scale: barn 3.8–5.2× farmer (chunky cutaway)", ratio("barn") >= 3.8 && ratio("barn") <= 5.2, `${ratio("barn").toFixed(2)}× (h=${art.size.barn.h})`);
    check("scale: silo 4.5–6.2× farmer", ratio("silo") >= 4.5 && ratio("silo") <= 6.2, `${ratio("silo").toFixed(2)}×`);
    check("scale: trees 2.4–4.2× farmer (3 sizes ascending)", ratio("tree0") >= 2.4 && ratio("tree2") <= 4.2 && art.size.tree0.h < art.size.tree1.h && art.size.tree1.h < art.size.tree2.h, `${ratio("tree0").toFixed(1)}/${ratio("tree1").toFixed(1)}/${ratio("tree2").toFixed(1)}×`);
    check("scale: stations (bin/stand) 1.2–1.6× farmer", ratio("bin") >= 1.2 && ratio("bin") <= 1.6 && ratio("stand") >= 1.3 && ratio("stand") <= 1.65, `bin=${ratio("bin").toFixed(2)}× stand=${ratio("stand").toFixed(2)}×`);

    // ===================== 2. INTERIOR SCENE FLOW =====================
    // walk up to the farmhouse door + face it → the ⏎ enter prompt
    await P(page, () => { window.__FL__.farm.teleport(24, 24.3); window.__FL__.farm.setHeading(Math.PI); });
    await sleep(300);
    const enterTgt = await P(page, () => window.__FL__.farm.target());
    check("interior: at the door → 'enter' target + ⏎ prompt", enterTgt && enterTgt.kind === "enter" && /Enter/.test(enterTgt.label), JSON.stringify(enterTgt));
    const labelShown = await P(page, () => { const el = document.getElementById("fl-actionlabel"); return { op: el.style.opacity, txt: el.textContent }; });
    check("interior: the on-screen prompt bubble is visible", labelShown.op === "1" && /Enter/.test(labelShown.txt), JSON.stringify(labelShown));

    // press action → fade runs → scene switches to the farmhouse interior
    const sceneBefore = await P(page, () => window.__FL__.scene.current());
    await P(page, () => window.__FL__.farm.action());
    await sleep(60);
    const fadingMid = await P(page, () => window.__FL__.scene.fading());
    await sleep(500);
    const sceneAfter = await P(page, () => window.__FL__.scene.current());
    const fadingDone = await P(page, () => window.__FL__.scene.fading());
    check("interior: action starts the fade transition (black dip)", fadingMid === true, `fadingMid=${fadingMid}`);
    check("interior: enters the farmhouse (scene id switches)", sceneBefore === "exterior" && sceneAfter === "farmhouse", `${sceneBefore}→${sceneAfter}`);
    check("interior: fade completes", fadingDone === false, `fading=${fadingDone}`);

    // the interior actually renders — floor + rug + fire pixel samples
    const floor = await P(page, () => window.__FL__._pixel(6, 4));
    check("interior: plank floor renders (warm brown)", floor && floor.r > 90 && floor.r > floor.g && floor.g > floor.b, JSON.stringify(floor));
    const rugReg = await P(page, () => window.__FL__._region(0, 3.6, 18, 2));
    const rugRed = rugReg.some((p) => p[0] > 140 && p[0] > p[1] + 30 && p[0] > p[2] + 30);
    check("interior: rug renders (a red pixel present)", rugRed, `sampled ${rugReg.length}px`);
    const fireReg = await P(page, () => window.__FL__._region(0, -8, 22, 1));
    const fireOrange = fireReg.some((p) => p[0] > 215 && p[1] > 60 && p[1] < 205 && p[2] < 135);
    check("interior: fireplace flame glows (an orange pixel present)", fireOrange, `sampled ${fireReg.length}px`);

    // MP representation: while inside, presence publishes the DOOR world coords
    const pres = await P(page, () => window.__FL__.scene.presencePos());
    const doorSpot = await P(page, () => window.__FL__.scene.doors()[0]);
    check("interior: MP presence publishes the door coords (renders at the door)", Math.hypot(pres.x - doorSpot.x, pres.z - doorSpot.z) < 0.5, `pres=${JSON.stringify(pres)} door=${doorSpot.x},${doorSpot.z}`);

    // DAY vs NIGHT inside: the window pane changes (blue day → dark night)
    const winDay = await P(page, () => window.__FL__._region(-6, -9.4, 14, 1));
    const dayBlue = winDay.reduce((s, p) => s + (p[2] > p[0] && p[2] > 150 ? 1 : 0), 0);
    await P(page, () => { window.__FL__.animals.setPhase("night"); window.__FL__.weather.applySky(); });
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r4-interior.png") });
    const winNight = await P(page, () => window.__FL__._region(-6, -9.4, 14, 1));
    const nightBlue = winNight.reduce((s, p) => s + (p[2] > p[0] && p[2] > 150 ? 1 : 0), 0);
    check("interior: windows reflect day/night (bright day panes → dark night)", dayBlue > nightBlue, `dayBluePx=${dayBlue} nightBluePx=${nightBlue}`);
    await P(page, () => { window.__FL__.animals.setPhase("day"); window.__FL__.weather.applySky(); });

    // EXIT: on the mat → action → back at the exterior door, facing away
    await P(page, () => { const m = window.__FL__.scene.exitMat(); window.__FL__.farm.teleport(m.x, m.z); });
    await sleep(120);
    const promptOnMat = await P(page, () => window.__FL__.scene.prompt());
    await P(page, () => window.__FL__.farm.action());
    await sleep(500);
    const backOut = await P(page, () => ({ scene: window.__FL__.scene.current(), x: window.__FL__.player.x, z: window.__FL__.player.z, facing: window.__FL__.avatar.facing() }));
    check("interior: standing on the exit mat shows a leave prompt", promptOnMat != null && /Leave|⏎/.test(promptOnMat), JSON.stringify(promptOnMat));
    check("interior: exit returns to the door spot facing AWAY", backOut.scene === "exterior" && Math.hypot(backOut.x - doorSpot.x, backOut.z - doorSpot.z) < 0.6 && backOut.facing === "down", JSON.stringify(backOut));

    // map marks the enterable building with a door icon
    const mapDoors = await P(page, () => window.__FL__.mapinv.mapSnapshot().doors);
    check("interior: map marks the enterable building with a 🚪 door icon", Array.isArray(mapDoors) && mapDoors.some((d) => d.emoji === "🚪"), JSON.stringify(mapDoors));

    // ===================== 3. PATH AUTO-TILE =====================
    // (sample points sit in exclusion zones that keep them tree-free, and the
    // player is teleported ~8 m clear of each so the farmer never covers it.)
    const cDirt = (a) => a.filter((p) => p[0] > 130 && p[0] > p[2] + 20 && p[0] >= p[1]).length;
    const cGrass = (a) => a.filter((p) => p[1] > 90 && p[1] > p[0]).length;
    // path core is solid dirt (path spine at (16,14), inside the house tree-exclusion)
    const pcore = await P(page, () => { window.__FL__.farm.teleport(16, 22); return null; });
    await sleep(200);
    const coreReg = await P(page, () => window.__FL__._region(16, 14, 6, 1));
    check("auto-tile: path core is solid dirt", cDirt(coreReg) >= 0.55 * coreReg.length, `dirt=${cDirt(coreReg)}/${coreReg.length}${pcore || ""}`);
    // field OUTER edge is a DITHERED soil↔grass boundary (tree-free, unoccluded);
    // a region straddling the edge holds BOTH soil (dirt) and grass px (dithered)
    await P(page, () => window.__FL__.farm.teleport(-6, 25));
    await sleep(200);
    const edgeReg = await P(page, () => window.__FL__._region(-6, 17.5, 11, 1));
    check("auto-tile: field/soil edge is DITHERED (both dirt+grass px in the band)", cDirt(edgeReg) >= 4 && cGrass(edgeReg) >= 4, `dirt=${cDirt(edgeReg)} grass=${cGrass(edgeReg)} of ${edgeReg.length}`);
    // open pasture grass (tree-free) reads green
    await P(page, () => window.__FL__.farm.teleport(26, 4));
    await sleep(200);
    const grassReg = await P(page, () => window.__FL__._region(26, -4, 10, 1));
    check("auto-tile: open grass reads green", cGrass(grassReg) >= 0.4 * grassReg.length, `grass=${cGrass(grassReg)}/${grassReg.length}`);
    // pond bank: a wet-sand rim between water and grass
    await P(page, () => window.__FL__.farm.teleport(30, -6));
    await sleep(200);
    const sandReg = await P(page, () => window.__FL__._region(30, -14.6, 9, 1));
    const sandPx = sandReg.filter((p) => p[0] > 150 && p[0] > p[2] + 15 && Math.abs(p[0] - p[1]) < 60 && p[1] > p[2]).length;
    check("auto-tile: pond bank has a sand rim (tan pixels at the waterline)", sandPx >= 3, `sandPx=${sandPx} of ${sandReg.length}`);

    check("0 pageerrors (desktop)", errors.length === 0, errors.slice(0, 4).join(" | "));

    // ---- SCREENSHOTS: scale (farmer beside house+barn), paths, hero ----
    // pose in the tree-free pasture between the house (S) and barn (N) so the
    // farmer reads cleanly against both resized buildings
    await P(page, () => { window.__FL__.animals.setPhase("day"); window.__FL__.weather.applySky(); window.__FL__.farm.equip("hands"); });
    await P(page, () => { window.__FL__.farm.teleport(33, 22); window.__FL__.farm.setHeading(Math.PI); });
    await sleep(500);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r4-scale.png") });
    await P(page, () => { window.__FL__.farm.teleport(16, -2); });
    await sleep(400);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r4-paths.png") });
    // hero: planted field + farmer + dusk light
    await P(page, () => {
      const FL = window.__FL__;
      const crops = ["turnip", "potato", "corn", "pumpkin", "carrot", "tomato", "strawberry", "sunflower"];
      let i = 0;
      for (let gx = 3; gx <= 9; gx++) for (let gz = 3; gz <= 9; gz++) FL.farm.plantStage(gx, gz, crops[i++ % crops.length], (gx + gz) % 4);
      FL.farm.teleport(-6, 12); FL.farm.setHeading(Math.PI); FL.animals.setPhase("dusk"); FL.weather.applySky();
    });
    await sleep(600);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r4-hero.png") });
    await page.close();

    // ===================== MOBILE =====================
    console.log("\n=== MOBILE 390×844 ===");
    const m = await bootPage(browser, true);
    const mBody = await m.page.evaluate(() => document.body.classList.contains("fl-mobile"));
    check("mobile: touch layer active (body.fl-mobile)", mBody);
    // walk to the door, tap the ACTION button → enters
    await m.page.evaluate(() => { window.__FL__.farm.teleport(24, 24.3); window.__FL__.farm.setHeading(Math.PI); });
    await sleep(300);
    const mBefore = await m.page.evaluate(() => window.__FL__.scene.current());
    await m.page.evaluate(() => { const b = document.getElementById("fl-actionbtn"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
    await sleep(500);
    const mAfter = await m.page.evaluate(() => window.__FL__.scene.current());
    check("mobile: the ACTION button enters the building too", mBefore === "exterior" && mAfter === "farmhouse", `${mBefore}→${mAfter}`);
    await m.page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r4-interior-mobile.png") });
    check("mobile: 0 pageerrors", m.errors.length === 0, m.errors.slice(0, 4).join(" | "));
    await m.page.close();
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
  if (fails.length) { console.log("FAILED: " + fails.map((f) => f.name).join(", ")); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
