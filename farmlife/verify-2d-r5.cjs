#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life R5 — the 3 playtest changes:
 *   1. FADE-BEHIND   — trees (+ tall decor) fade when the LOCAL player stands
 *                      behind them; restore on walk-out; BUILDINGS never fade.
 *   2. SOLID BUILDINGS — footprints expand to the full base (Stardew rule):
 *                      cells behind farmhouse/silo are blocked; the door approach
 *                      stays open; a saved position inside a collider is nudged out.
 *   3. FREE-FORM FARMING — the grid is gone: till organic PATCHES at arbitrary
 *                      coords, plant with a 0.7 m spacing rule (+ red ghost when
 *                      too close), water the nearest plant with a splash credit,
 *                      harvest the exact plant, map shows dots. Overlapping tills
 *                      merge into one blob. Legacy tile saves migrate once (local).
 * Network BLOCKED (playroom/firebase/gstatic) — the CLOUD migration is in r3.
 *
 * Run:  node farmlife/verify-2d-r5.cjs        (from repo root)
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require(path.resolve(__dirname, "..", "tools", "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8790;
const URL = `http://127.0.0.1:${PORT}/farmlife/dist/index.html`;
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
async function waitServer(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isOpen(PORT)) {
      try { await new Promise((res, rej) => http.get({ host: "127.0.0.1", port: PORT, path: "/farmlife/dist/index.html", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej)); return; } catch (_) {}
    }
    await sleep(200);
  }
  throw new Error("server timeout");
}
async function bootPage(browser, mobile, saveJson) {
  const page = await browser.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2 } : { width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((sv) => {
    try {
      if (sv === "__keep__") return; // reload: read whatever the last boot saved
      if (sv === null) localStorage.removeItem("fl_farm_v1"); // pristine
      else if (sv) localStorage.setItem("fl_farm_v1", sv); // seed a legacy save
    } catch (_) {}
  }, saveJson === undefined ? "__keep__" : saveJson);
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
  await page.waitForFunction(() => window.__FL__ && window.__FL__.render && window.__FL__.farm && typeof window.__FL__.farm.patchCount === "function", { timeout: 20000 });
  await sleep(400);
  return { page, errors };
}
const P = (page, fn, ...a) => page.evaluate(fn, ...a);

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  await waitServer(20000);
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--no-sandbox"] });

  try {
    console.log("\n=== DESKTOP 1280×720 ===");
    const { page, errors } = await bootPage(browser, false, null);
    await P(page, () => { window.__FL__.animals.setPhase("day"); window.__FL__.weather.applySky(); window.__FL__.farm.clearFarm(); });

    // ==================== 1. FADE-BEHIND ====================
    const tree = await P(page, () => window.__FL__.render.trees().filter((t) => t.size === 2 && Math.abs(t.x) < 45 && Math.abs(t.z) < 45).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0] || window.__FL__.render.trees()[0]);
    const fadeBaseline = await P(page, (t) => window.__FL__.render.fade("tree" + t.i), tree);
    // stand just NORTH of the trunk (behind it): the canopy covers the player
    await P(page, (t) => { window.__FL__.farm.teleport(t.x + 0.2, t.z - 1.5); window.__FL__.farm.setHeading(0); }, tree);
    for (let i = 0; i < 22; i++) await sleep(40);
    const fadeBehind = await P(page, (t) => window.__FL__.render.fade("tree" + t.i), tree);
    check("fade: a tree is fully opaque when the player is not behind it", fadeBaseline > 0.95, `alpha=${fadeBaseline.toFixed(2)}`);
    check("fade: the tree fades (< 0.6) when the player stands behind it", fadeBehind < 0.6, `alpha=${fadeBehind.toFixed(2)}`);
    // walk OUT (south of the tree, still on-screen) → restores
    await P(page, (t) => window.__FL__.farm.teleport(t.x, t.z + 4), tree);
    for (let i = 0; i < 26; i++) await sleep(40);
    const fadeOut = await P(page, (t) => window.__FL__.render.fade("tree" + t.i), tree);
    check("fade: restores (> 0.9) when the player walks out from behind", fadeOut > 0.9, `alpha=${fadeOut.toFixed(2)}`);
    // BUILDINGS never fade (they're solid — the player can never be behind them,
    // and the fade system never tracks them).
    await P(page, () => { window.__FL__.farm.teleport(24, 22); window.__FL__.farm.setHeading(Math.PI); });
    for (let i = 0; i < 15; i++) await sleep(40);
    const houseFade = await P(page, () => window.__FL__.render.fade("farmhouse"));
    const siloFade = await P(page, () => window.__FL__.render.fade("silo"));
    check("fade: BUILDINGS never fade (farmhouse + silo stay opaque)", houseFade === 1 && siloFade === 1, `house=${houseFade} silo=${siloFade}`);

    // ==================== 2. SOLID BUILDINGS ====================
    // cells directly BEHIND (north of) the farmhouse base are blocked (pushed out)
    const behindHouse = await P(page, () => window.__FL__.farm.resolveAt(24, 17)); // inside the footprint
    check("solid: a cell behind the farmhouse is blocked (resolves outside)", Math.abs(behindHouse.z - 17) > 0.3, `resolved z=${behindHouse.z.toFixed(2)}`);
    // walk north into the farmhouse from the front → blocked south of the base
    await P(page, () => { window.__FL__.farm.teleport(24, 22.5); });
    await P(page, () => window.__FL__.setInput({ fwd: 1, strafe: 0, run: true }));
    await sleep(1400);
    await P(page, () => window.__FL__.setInput({ fwd: 0, strafe: 0 }));
    const houseZ = await P(page, () => window.__FL__.farm.pos().z);
    check("solid: player can't walk behind the farmhouse (blocked z > 20.5)", houseZ > 20.5, `z=${houseZ.toFixed(2)}`);
    // a cell behind the silo is blocked too
    const behindSilo = await P(page, () => window.__FL__.farm.resolveAt(46.5, 7)); // inside the silo footprint
    check("solid: a cell behind the silo is blocked (resolves outside)", Math.abs(behindSilo.z - 7) > 0.2, `resolved z=${behindSilo.z.toFixed(2)}`);
    // door approach stays OPEN: the ⏎ enter prompt is reachable in front of the door
    await P(page, () => { window.__FL__.farm.teleport(24, 22); window.__FL__.farm.setHeading(Math.PI); });
    await sleep(300);
    const doorTgt = await P(page, () => window.__FL__.farm.target());
    check("solid: the farmhouse door approach stays open (⏎ enter prompt reachable)", doorTgt && doorTgt.kind === "enter", JSON.stringify(doorTgt && { kind: doorTgt.kind }));
    // saved-position-inside-collider nudge: place the player inside a building, nudge
    await P(page, () => window.__FL__.farm.teleport(24, 17)); // inside the farmhouse footprint
    const inColl = await P(page, () => window.__FL__.farm.pos());
    await P(page, () => window.__FL__.farm.nudgeFromCollider());
    const nudged = await P(page, () => window.__FL__.farm.pos());
    const moved = Math.hypot(nudged.x - inColl.x, nudged.z - inColl.z);
    const nowClear = await P(page, () => { const p = window.__FL__.farm.pos(); const r = window.__FL__.farm.resolveAt(p.x, p.z); return Math.hypot(r.x - p.x, r.z - p.z) < 0.02; });
    check("solid: a saved position inside a collider is nudged to open ground", moved > 0.3 && nowClear, `moved=${moved.toFixed(2)} clear=${nowClear}`);

    // ==================== 3. FREE-FORM LOOP ====================
    await P(page, () => { window.__FL__.farm.setFastGrow(true); window.__FL__.farm.clearFarm(); window.__FL__.farm.setCoins(200); window.__FL__.farm.selectCrop("turnip"); });
    // TILL a patch at an arbitrary NON-GRID coord
    await P(page, () => window.__FL__.farm.tillAt(-3.37, 8.11));
    await sleep(50);
    const tilledArb = await P(page, () => ({ n: window.__FL__.farm.patchCount(), covered: window.__FL__.farm.patchCoverageAt(-3.37, 8.11) > 0 }));
    check("free-form: hoe tills an organic PATCH at arbitrary non-grid coords", tilledArb.n === 1 && tilledArb.covered, JSON.stringify(tilledArb));
    // extend the patch (a wider area) so 2 plants fit ≥0.7 m apart
    await P(page, () => { window.__FL__.farm.addPatch(-3.37, 8.11, 1.6); });
    // PLANT two plants 0.9 m apart (≥ 0.7 spacing, ≤ 1.0 splash)
    await P(page, () => window.__FL__.farm.plantAt(-3.9, 8.11, "turnip"));
    await P(page, () => window.__FL__.farm.plantAt(-3.0, 8.11, "turnip"));
    const twoPlants = await P(page, () => window.__FL__.farm.plantCount());
    check("free-form: two plants 0.9 m apart both take (spacing ok)", twoPlants === 2, `plants=${twoPlants}`);
    // a THIRD plant too CLOSE (0.2 m from one) is rejected + shows a red ghost
    await P(page, () => { window.__FL__.farm.equip("seeds"); window.__FL__.farm.teleport(-3.0, 6.9); window.__FL__.farm.setHeading(0); }); // aim ≈ (-3.0, 8.1) — on top of a plant
    await sleep(250);
    const tooCloseTgt = await P(page, () => window.__FL__.farm.target());
    await P(page, () => window.__FL__.farm.plantAt(-2.8, 8.11, "turnip")); // 0.2 m from a plant
    const stillTwo = await P(page, () => window.__FL__.farm.plantCount());
    check("free-form: a too-close 3rd plant is rejected (red ghost, count stays 2)", stillTwo === 2 && tooCloseTgt && tooCloseTgt.kind === "hint" && tooCloseTgt.invalid === true, `count=${stillTwo} tgt=${JSON.stringify(tooCloseTgt && { kind: tooCloseTgt.kind, invalid: tooCloseTgt.invalid })}`);
    // WATER the nearest plant → the SPLASH also credits the adjacent one
    await P(page, () => window.__FL__.farm._addTimeOffset(31000)); // both go thirsty
    await sleep(80);
    const w0a = await P(page, () => window.__FL__.farm.plantInfoAt(-3.9, 8.11).waterings);
    const w0b = await P(page, () => window.__FL__.farm.plantInfoAt(-3.0, 8.11).waterings);
    await P(page, () => window.__FL__.farm.waterAt(-3.9, 8.11)); // water plant A
    const w1a = await P(page, () => window.__FL__.farm.plantInfoAt(-3.9, 8.11).waterings);
    const w1b = await P(page, () => window.__FL__.farm.plantInfoAt(-3.0, 8.11).waterings);
    check("free-form: watering a plant SPLASH-credits the adjacent one", w1a === w0a + 1 && w1b === w0b + 1, `A ${w0a}→${w1a}  B ${w0b}→${w1b}`);
    // fastGrow → ready → HARVEST the exact plant
    await P(page, () => window.__FL__.farm._addTimeOffset(31000));
    await sleep(120);
    const readyA = await P(page, () => window.__FL__.farm.plantInfoAt(-3.9, 8.11).stage);
    const crops0 = await P(page, () => window.__FL__.farm.state().crops.turnip);
    await P(page, () => window.__FL__.farm.harvestAt(-3.9, 8.11));
    await sleep(80);
    const crops1 = await P(page, () => window.__FL__.farm.state().crops.turnip);
    const gone = await P(page, () => window.__FL__.farm.plantInfoAt(-3.9, 8.11, 0.3).present);
    const stillB = await P(page, () => window.__FL__.farm.plantInfoAt(-3.0, 8.11, 0.3).present);
    check("free-form: harvest the EXACT ready plant (+1 crop, that plant gone, neighbour kept)", readyA === "ready" && crops1 === crops0 + 1 && !gone && stillB, `ready=${readyA} crops ${crops0}→${crops1} gone=${gone} neighbour=${stillB}`);
    // map shows plant DOTS
    const mapSnap = await P(page, () => window.__FL__.mapinv.mapSnapshot());
    check("free-form: farm map shows plant dots + patch blobs (no tile grid)", mapSnap.plants.length >= 1 && (mapSnap.patches || []).length >= 1 && mapSnap.tiles === undefined, `plants=${mapSnap.plants.length} patches=${(mapSnap.patches || []).length}`);

    // ==================== 4. PATCH MERGING ====================
    await P(page, () => { window.__FL__.farm.clearFarm(); window.__FL__.farm.tillAt(-8, 12); window.__FL__.farm.tillAt(-7, 12); });
    await P(page, () => { window.__FL__.farm.teleport(-8, 20); });
    await sleep(300);
    const merge = await P(page, () => ({
      n: window.__FL__.farm.patchCount(),
      // the midpoint between the two overlapping tills is covered (one blob)
      mid: window.__FL__.farm.patchCoverageAt(-7.5, 12) > 0,
      // and a soil pixel renders there
      pix: window.__FL__._pixel(-7.5, 12),
    }));
    const midSoil = merge.pix && merge.pix.r > merge.pix.b && merge.pix.r > 60 && merge.pix.g < merge.pix.r; // brownish
    check("patch merge: two overlapping tills form ONE continuous blob (midpoint covered + soil)", merge.n === 2 && merge.mid && midSoil, `n=${merge.n} mid=${merge.mid} pix=${JSON.stringify(merge.pix)}`);

    check("0 pageerrors (desktop)", errors.length === 0, errors.slice(0, 4).join(" | "));

    // ==================== SCREENSHOTS ====================
    await P(page, () => {
      const FL = window.__FL__;
      FL.farm.clearFarm();
      const crops = ["turnip", "carrot", "tomato", "strawberry", "pumpkin", "corn", "sunflower", "potato"];
      let seed = 9, i = 0;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      for (let c = 0; c < 10; c++) {
        const cx = -14 + rnd() * 16, cz = -1 + rnd() * 14, n = 3 + Math.floor(rnd() * 4);
        for (let k = 0; k < n; k++) {
          const px = cx + (rnd() - 0.5) * 3.2, pz = cz + (rnd() - 0.5) * 3.2;
          FL.farm.addPatch(px, pz, 0.8 + rnd() * 0.6);
          FL.farm.plantStageAt(px, pz, crops[i++ % crops.length], Math.floor(rnd() * 4));
        }
      }
      FL.farm.teleport(-6, 12); FL.farm.setHeading(Math.PI); FL.animals.setPhase("day"); FL.weather.applySky();
    });
    await sleep(600);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r5-freeform.png") });
    await P(page, () => { const t = window.__FL__.render.trees().filter((t) => t.size === 2 && Math.abs(t.x) < 45 && Math.abs(t.z) < 45)[0] || window.__FL__.render.trees()[0]; window.__FL__.farm.clearFarm(); window.__FL__.farm.teleport(t.x + 0.2, t.z - 1.6); window.__FL__.farm.setHeading(0); });
    for (let i = 0; i < 22; i++) await sleep(40);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r5-fade.png") });
    await P(page, () => { window.__FL__.farm.teleport(24, 22); window.__FL__.farm.setHeading(Math.PI); });
    await sleep(200);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r5-solid.png") });
    await page.close();

    // ==================== 5. LOCAL MIGRATION (legacy tiles → free-form) ====================
    console.log("\n=== LOCAL MIGRATION (legacy fl_farm_v1 tiles) ===");
    const legacySave = JSON.stringify({
      tiles: {
        t_3_3: { crop: "turnip", plantedAt: 0, accruedMs: 0, lastWatered: 0 }, // → plant + patch at (-11,1)
        t_5_5: { crop: "corn", plantedAt: 0, accruedMs: 0, lastWatered: 0 }, // → plant + patch at (-7,5)
        t_7_7: {}, // bare tilled → patch only, no plant
      },
      coins: 137,
    });
    const mig = await bootPage(browser, false, legacySave);
    await sleep(400);
    const migState = await P(mig.page, () => ({
      plants: window.__FL__.farm.plantCount(),
      patches: window.__FL__.farm.patchCount(),
      t33: window.__FL__.farm.plantInfoAt(-11, 1),
      t55: window.__FL__.farm.plantInfoAt(-7, 5),
      t77: window.__FL__.farm.patchCoverageAt(-3, 9) > 0, // tileCentre(7,7) = (-3,9)
      rawTiles: Object.keys(window.__FL__.farm.state().tiles).length,
      coins: window.__FL__.farm.state().coins,
    }));
    check("migration: 2 planted tiles → 2 plants at tile centres, 3 tilled tiles → 3 patches", migState.plants === 2 && migState.patches === 3, JSON.stringify({ plants: migState.plants, patches: migState.patches }));
    check("migration: plants land at the exact tile centres with the right crop", migState.t33.present && migState.t33.crop === "turnip" && migState.t55.present && migState.t55.crop === "corn", `t33=${migState.t33.crop} t55=${migState.t55.crop}`);
    check("migration: a bare tilled tile becomes a patch (no plant)", migState.t77, `covered=${migState.t77}`);
    check("migration: legacy tiles are cleared from the live state (never surfaced)", migState.rawTiles === 0, `rawTiles=${migState.rawTiles}`);
    check("migration: other fields survive (coins 137)", migState.coins === 137, `coins=${migState.coins}`);
    await P(mig.page, () => window.__FL__.farm.flushSave());
    await sleep(250);
    check("migration: 0 pageerrors", mig.errors.length === 0, mig.errors.slice(0, 3).join(" | "));
    await mig.page.close();
    // reload (the migrated NEW-shape save now persists) → NO duplicates
    const rel = await bootPage(browser, false); // no saveJson → reads what migration saved
    await sleep(400);
    const relState = await P(rel.page, () => ({ plants: window.__FL__.farm.plantCount(), patches: window.__FL__.farm.patchCount() }));
    check("migration: reload does NOT re-migrate / duplicate (still 2 plants, 3 patches)", relState.plants === 2 && relState.patches === 3, JSON.stringify(relState));
    await rel.page.close();

    // ==================== MOBILE ====================
    console.log("\n=== MOBILE 390×844 ===");
    const m = await bootPage(browser, true, null);
    await P(m.page, () => { window.__FL__.farm.clearFarm(); window.__FL__.farm.equip("hoe"); window.__FL__.farm.teleport(-7, 3.8); window.__FL__.farm.setHeading(0); });
    await sleep(150);
    await P(m.page, () => window.__FL__.farm.action());
    await sleep(150);
    const mTill = await P(m.page, () => ({ n: window.__FL__.farm.patchCount(), covered: window.__FL__.farm.patchCoverageAt(-7, 5) > 0 }));
    check("mobile: free-form till works", mTill.n === 1 && mTill.covered, JSON.stringify(mTill));
    // fade works on mobile too
    const mtree = await P(m.page, () => window.__FL__.render.trees()[0]);
    await P(m.page, (t) => window.__FL__.farm.teleport(t.x + 0.2, t.z - 1.4), mtree);
    for (let i = 0; i < 22; i++) await sleep(40);
    const mFade = await P(m.page, (t) => window.__FL__.render.fade("tree" + t.i), mtree);
    check("mobile: fade-behind works (tree alpha < 0.6 when behind)", mFade < 0.6, `alpha=${mFade.toFixed(2)}`);
    await m.page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r5-mobile.png") });
    check("mobile: 0 pageerrors", m.errors.length === 0, m.errors.slice(0, 3).join(" | "));
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
