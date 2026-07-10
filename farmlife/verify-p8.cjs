#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life STAGE 1 art swap (procedural → Quaternius
 * CC0 GLB models: crops, animals, buildings). Serves the REPO ROOT and loads
 * /farmlife/dist/index.html. Network is ON for the model GLBs (same-origin
 * static files); Firebase/Playroom are BLOCKED (goat-dup house rule). A final
 * section BLOCKS the model URLs to prove the procedural fallback + 0 pageerrors.
 *
 * Also produces the review screenshots: shots/farmlife-p8-{field,animals,farm,night}.png
 *
 * Run:  node farmlife/verify-p8.cjs        (from repo root)
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
  return new Promise((res) => { const s = net.createConnection({ port, host: "127.0.0.1" }); s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); s.setTimeout(700, () => { s.destroy(); res(false); }); });
}
async function waitServer(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isOpen(port)) { try { await new Promise((res, rej) => http.get({ host: "127.0.0.1", port, path: "/farmlife/dist/index.html", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej)); return; } catch (_) {} }
    await sleep(200);
  }
  throw new Error("server timeout");
}

const CROPS = ["turnip", "potato", "corn", "pumpkin", "strawberry", "carrot", "tomato", "sunflower"];

async function boot(browser, { blockModels } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  // Deterministic OFF for fast-grow (test mode defaults ON) so growth timelines
  // read on the REAL clock in these suites. Merges over any existing tune.
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  page.on("request", (req) => {
    const u = req.url();
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
    if (blockModels && /\/models\/.*\.glb(\?|$)/i.test(u)) return req.abort();
    req.continue();
  });
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.models, { timeout: 20000 });
  return { page, errors };
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });

  // ==================== A. MODELS LOAD (network on) ====================
  console.log("\n=== A. CROPS ===");
  const { page, errors } = await boot(browser, {});
  await page.waitForFunction(() => window.__FL__.models.cropsReady(), { timeout: 20000 }).catch(() => {});
  const cropsReady = await page.evaluate(() => window.__FL__.models.cropsReady());
  check("crop models preloaded (cropsReady)", cropsReady);
  const cropUses = await page.evaluate((cs) => cs.map((c) => window.__FL__.models.cropUsesModel(c)), CROPS);
  check("all 8 crops resolve to a GLB template", cropUses.every(Boolean), CROPS.map((c, i) => c + ":" + cropUses[i]).join(" "));

  // plant every crop at young + ready → assert GLB-derived crop groups appear.
  const glbGroups = await page.evaluate((cs) => {
    const F = window.__FL__.farm;
    cs.forEach((c, i) => { F.plantStage(3 + i, 5, c, 1); F.plantStage(3 + i, 6, c, 3); });
    return window.__FL__.models.cropGlbGroups();
  }, CROPS);
  check("planted crops render GLB meshes (swap happened, not fallback)", glbGroups >= 16, `glbGroups=${glbGroups}`);

  // FIELD screenshot
  await page.evaluate(() => { const F = window.__FL__.farm; F.teleport(1, 13); F.setHeading(Math.PI); window.__FL__._snapCam(); window.__FL__._setYaw(Math.PI); window.__FL__._setPitch(0.32); });
  await sleep(600);
  await page.screenshot({ path: path.join(SHOTS, "farmlife-p8-field.png") });

  // ==================== B. ANIMALS ====================
  console.log("\n=== B. ANIMALS ===");
  await page.waitForFunction(() => window.__FL__.models.animalsUseModel(), { timeout: 20000 }).catch(() => {});
  const goatKind = await page.evaluate(() => window.__FL__.models.animalMeshKind("goat1"));
  const chickKind = await page.evaluate(() => window.__FL__.models.animalMeshKind("chicken1"));
  check("goat swapped to GLB (glb-goat)", goatKind === "glb-goat", goatKind);
  check("chicken swapped to GLB (glb-chicken)", chickKind === "glb-chicken", chickKind);

  // FROZEN-BIND-POSE GUARD: sample the chicken's skinned bone across ~1.2s of
  // rendered frames; a skinned mesh whose material lost `skinning` (r128 bug)
  // would freeze in bind pose → zero movement. Assert it MOVES.
  const bone0 = await page.evaluate(() => window.__FL__.models.animalBoneSample("chicken1"));
  await sleep(1200);
  const bone1 = await page.evaluate(() => window.__FL__.models.animalBoneSample("chicken1"));
  const boneMove = bone0 && bone1 ? Math.hypot(bone1.x - bone0.x, bone1.y - bone0.y, bone1.z - bone0.z) : 0;
  check("chicken animates (skinned bone moves over time — not frozen bind pose)", boneMove > 0.0005, `Δbone=${boneMove.toFixed(5)}`);

  // ANIMALS screenshot (south of the pen looking north)
  await page.evaluate(() => { const F = window.__FL__.farm; F.teleport(24, 2); F.setHeading(0); window.__FL__._snapCam(); window.__FL__._setYaw(0); window.__FL__._setPitch(0.14); });
  await sleep(800);
  await page.screenshot({ path: path.join(SHOTS, "farmlife-p8-animals.png") });

  // ==================== C. BUILDINGS ====================
  console.log("\n=== C. BUILDINGS ===");
  await page.waitForFunction(() => window.__FL__.models.buildingsReady && window.__FL__.models.buildingsReady(), { timeout: 20000 }).catch(() => {});
  check("farmhouse swapped to GLB", await page.evaluate(() => window.__FL__.models.farmhouseUsesModel()));
  const barnUses = await page.evaluate(() => window.__FL__.models.propUsesModel("barn"));
  check("barn/shed/silo prop types resolve to GLB", barnUses && await page.evaluate(() => window.__FL__.models.propUsesModel("silo")));
  // decorative farmstead (barn+silo) rebuilt as GLB — worldProps are editor-only,
  // so inject a test barn via the world hook and assert it renders GLB + collides.
  const barn = await page.evaluate(() => {
    window.__FL__.world.injectTestBarn();
    return { glb: window.__FL__.models.worldPropGlbCount(), push: window.__FL__.world.collidePush(6, -30) };
  });
  check("editor-placed barn renders as GLB", barn.glb >= 1, `worldPropGlb=${barn.glb}`);
  check("placed barn still collides (footprint intact)", barn.push > 0.05, `push=${barn.push.toFixed(2)}m`);

  // FARM wide screenshot
  await page.evaluate(() => { const F = window.__FL__.farm; F.teleport(9, 46); F.setHeading(Math.PI); window.__FL__._snapCam(); window.__FL__._setYaw(Math.PI); window.__FL__._setPitch(0.40); });
  await sleep(600);
  await page.screenshot({ path: path.join(SHOTS, "farmlife-p8-farm.png") });

  // ==================== D. NIGHT WINDOW GLOW ====================
  console.log("\n=== D. NIGHT GLOW ===");
  const glow = await page.evaluate(() => {
    const d = new Date(); const t = new Date(); t.setHours(22, 30, 0, 0);
    window.__FL__.farm._setTimeOffset(t.getTime() - d.getTime());
    window.__FL__.weather.applySky();
    return window.__FL__.models.windowGlow();
  });
  check("farmhouse windows glow at night (emissive > 0)", Array.isArray(glow) && glow.length >= 1 && glow.every((v) => v > 0), JSON.stringify(glow));
  await page.evaluate(() => { const F = window.__FL__.farm; F.teleport(24, 30); const h = Math.atan2(0, -10); F.setHeading(h); window.__FL__._snapCam(); window.__FL__._setYaw(h); window.__FL__._setPitch(0.16); });
  await sleep(900);
  await page.screenshot({ path: path.join(SHOTS, "farmlife-p8-night.png") });

  const realErr = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("A-D: 0 pageerrors (models on)", realErr.length === 0, realErr.join(" | "));
  await page.close();

  // ==================== E. 404 / OFFLINE FALLBACK ====================
  console.log("\n=== E. FALLBACK (model URLs blocked) ===");
  const fb = await boot(browser, { blockModels: true });
  await sleep(2500); // let the (aborted) loads settle
  const fbState = await fb.page.evaluate((cs) => ({
    crops: cs.map((c) => window.__FL__.models.cropUsesModel(c)),
    animalsUse: window.__FL__.models.animalsUseModel(),
    goatKind: window.__FL__.models.animalMeshKind("goat1"),
    farmhouse: window.__FL__.models.farmhouseUsesModel(),
    barn: window.__FL__.models.propUsesModel("barn"),
  }), CROPS);
  check("blocked: no crop uses a model (procedural fallback)", fbState.crops.every((v) => v === false));
  check("blocked: animals stay procedural", fbState.animalsUse === false && fbState.goatKind === "proc-goat", `goat=${fbState.goatKind}`);
  check("blocked: buildings stay procedural", fbState.farmhouse === false && fbState.barn === false);
  // farming still works with fallback: plant + it renders (procedural), no GLB groups
  const fbPlant = await fb.page.evaluate(() => {
    window.__FL__.farm.plantStage(4, 4, "corn", 2);
    return { glb: window.__FL__.models.cropGlbGroups(), state: !!window.__FL__.farm.tileAt(4, 4).crop };
  });
  check("blocked: crops still plant (procedural, 0 GLB groups)", fbPlant.state && fbPlant.glb === 0, `glb=${fbPlant.glb}`);
  const fbErr = fb.errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("blocked: 0 pageerrors (fallback is clean)", fbErr.length === 0, fbErr.join(" | "));
  await fb.page.close();

  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n==== P8 RESULT: ${passed}/${results.length} passed ====`);
  console.log("shots: shots/farmlife-p8-{field,animals,farm,night}.png");
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
