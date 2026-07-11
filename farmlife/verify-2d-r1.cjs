#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life R1 — the 2D MODERN PIXEL render core.
 * Serves the REPO ROOT and loads /farmlife/dist/index.html. Network BLOCKED
 * (playroom/firebase/gstatic) — this is offline renderer work.
 *
 * Run:  node farmlife/verify-2d-r1.cjs        (from repo root)
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
  await page.waitForFunction(() => window.__FL__ && typeof window.__FL__._snap === "function", { timeout: 20000 });
  await sleep(400);
  return { page, errors };
}

const P = (page, fn, ...args) => page.evaluate(fn, ...args);

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--no-sandbox"] });

  try {
    // ============================ DESKTOP ============================
    console.log("\n=== DESKTOP 1280×720 ===");
    const { page, errors } = await bootPage(browser, false);

    // --- pixelated integer scale ---
    const css = await P(page, () => window.__FL__._cssScale());
    check("canvas image-rendering: pixelated", css.pixelated === "pixelated", css.pixelated);
    check("canvas integer-scaled (cssW / backingW == scale)", Math.abs(css.ratio - css.scale) < 0.001 && css.scale >= 1, `scale=${css.scale} ratio=${css.ratio.toFixed(3)} backingW=${css.backingW}`);

    // --- world renders ---
    const snap = await P(page, () => window.__FL__._snap());
    check("world renders (distinct colors > 12)", snap.distinct > 12, `distinct=${snap.distinct} stdev=${snap.stdev.toFixed(1)} ${snap.w}x${snap.h}`);
    check("world non-uniform (luma stdev > 8)", snap.stdev > 8, snap.stdev.toFixed(1));

    // grass green at an open-grass coord
    await P(page, () => window.__FL__.farm.teleport(0, -45));
    await sleep(250);
    const grass = await P(page, () => window.__FL__._pixel(6, -45));
    check("grass reads green", grass && grass.g > grass.r && grass.g > grass.b, JSON.stringify(grass));

    // path tan on a default-path point (20,-9)
    await P(page, () => window.__FL__.farm.teleport(20, -13));
    await sleep(250);
    const pathpx = await P(page, () => window.__FL__._pixel(20, -9));
    check("path reads dirt/tan (r>g>b, bright)", pathpx && pathpx.r > 150 && pathpx.r > pathpx.b && pathpx.g > pathpx.b, JSON.stringify(pathpx));

    // barn red somewhere in the barn footprint
    await P(page, () => window.__FL__.farm.teleport(37.5, -3));
    await sleep(300);
    const barnRed = await P(page, () => {
      for (let z = 7; z <= 12; z += 1) for (const x of [34, 35, 41]) {
        const p = window.__FL__._pixel(x, z);
        if (p && p.r > 140 && p.r > p.g + 40 && p.r > p.b + 40) return p;
      }
      return null;
    });
    check("barn red in barn region", !!barnRed, JSON.stringify(barnRed));

    // --- WASD moves + facing flip ---
    await P(page, () => window.__FL__.farm.teleport(0, 0));
    await sleep(150);
    const before = await P(page, () => ({ x: window.__FL__.player.x, z: window.__FL__.player.z }));
    await P(page, () => window.__FL__.setInput({ fwd: 1, strafe: 0, run: false })); // up = −Z
    await sleep(1000);
    const afterUp = await P(page, () => ({ x: window.__FL__.player.x, z: window.__FL__.player.z, facing: window.__FL__.avatar.facing() }));
    await P(page, () => window.__FL__.setInput({ fwd: 0, strafe: 0 }));
    check("W moves player north (>2m, −Z)", before.z - afterUp.z > 2, `dz=${(before.z - afterUp.z).toFixed(2)} facing=${afterUp.facing}`);
    check("W sets facing up", afterUp.facing === "up", afterUp.facing);

    await P(page, () => window.__FL__.setInput({ fwd: 0, strafe: -1 })); // left
    await sleep(500);
    const left = await P(page, () => window.__FL__.avatar.facing());
    await P(page, () => window.__FL__.setInput({ fwd: 0, strafe: 1 })); // right
    await sleep(500);
    const right = await P(page, () => window.__FL__.avatar.facing());
    await P(page, () => window.__FL__.setInput({ fwd: 0, strafe: 0 }));
    check("A/D flip side facing (left↔right)", left === "left" && right === "right", `${left}/${right}`);

    // --- collision: pond blocks ---
    await P(page, () => window.__FL__.farm.teleport(30, -14)); // just south of pond (cx30,cz-26,r10)
    await sleep(150);
    await P(page, () => window.__FL__.setInput({ fwd: 1, strafe: 0, run: true })); // north into pond
    await sleep(1600);
    await P(page, () => window.__FL__.setInput({ fwd: 0, strafe: 0 }));
    const pondD = await P(page, () => { const p = window.__FL__.player, q = window.__FL__.farm.pondPos; return Math.hypot(p.x - q.x, p.z - q.z); });
    check("pond blocks the player (stays outside water)", pondD > 9, `dist=${pondD.toFixed(2)} (r=10)`);

    // --- collision: north field fence blocks ---
    await P(page, () => window.__FL__.farm.teleport(0, -9));
    await sleep(150);
    await P(page, () => window.__FL__.setInput({ fwd: -1, strafe: 0, run: true })); // +Z into fence @ z=-6
    await sleep(1400);
    await P(page, () => window.__FL__.setInput({ fwd: 0, strafe: 0 }));
    const fz = await P(page, () => window.__FL__.player.z);
    check("field fence blocks entry (z stays < -5.6)", fz < -5.6, `z=${fz.toFixed(2)}`);

    // --- gate PASSES: east field gate gap @ x=6,z=6 ---
    await P(page, () => window.__FL__.farm.teleport(8.5, 6));
    await sleep(150);
    await P(page, () => window.__FL__.setInput({ fwd: 0, strafe: -1, run: true })); // west through gate
    await sleep(1200);
    await P(page, () => window.__FL__.setInput({ fwd: 0, strafe: 0 }));
    const gateX = await P(page, () => window.__FL__.player.x);
    check("field gate gap PASSES (crossed to x<5.5)", gateX < 5.5, `x=${gateX.toFixed(2)}`);

    // --- barn: door gap PASSES, wall BLOCKS ---
    await P(page, () => window.__FL__.farm.teleport(38, 3)); // south of door (x36.4..39.6,z6)
    await sleep(150);
    await P(page, () => window.__FL__.setInput({ fwd: -1, strafe: 0, run: true })); // +Z into barn through door
    await sleep(1300);
    await P(page, () => window.__FL__.setInput({ fwd: 0, strafe: 0 }));
    const doorZ = await P(page, () => window.__FL__.player.z);
    check("barn door gap PASSES (entered barn, z>6.5)", doorZ > 6.5, `z=${doorZ.toFixed(2)}`);

    await P(page, () => window.__FL__.farm.teleport(34, 3)); // south of the south-LEFT wall
    await sleep(150);
    await P(page, () => window.__FL__.setInput({ fwd: -1, strafe: 0, run: true }));
    await sleep(1300);
    await P(page, () => window.__FL__.setInput({ fwd: 0, strafe: 0 }));
    const wallZ = await P(page, () => window.__FL__.player.z);
    check("barn wall BLOCKS (z stays < 6)", wallZ < 6, `z=${wallZ.toFixed(2)}`);

    // --- hop lifts + lands ---
    await P(page, () => window.__FL__.farm.teleport(0, 40));
    await sleep(150);
    const lc0 = await P(page, () => window.__FL__.avatar.landCount());
    await P(page, () => window.__FL__.avatar.jump());
    let peak = 0;
    for (let i = 0; i < 18; i++) { peak = Math.max(peak, await P(page, () => window.__FL__.avatar.hopY())); await sleep(30); }
    await sleep(400);
    const lc1 = await P(page, () => window.__FL__.avatar.landCount());
    const grounded = await P(page, () => window.__FL__.avatar.hopY());
    check("hop lifts the sprite (peak hopY > 0.5m)", peak > 0.5, `peak=${peak.toFixed(2)}`);
    check("hop lands (landCount++ and hopY back to 0)", lc1 === lc0 + 1 && grounded < 0.01, `land ${lc0}->${lc1} y=${grounded.toFixed(2)}`);

    // --- day/night tint changes pixels ---
    await P(page, () => window.__FL__.farm.teleport(0, -30));
    await P(page, () => window.__FL__.animals.setPhase("day"));
    await P(page, () => window.__FL__.weather.applySky());
    await sleep(250);
    const dayMean = (await P(page, () => window.__FL__._snap())).mean;
    const dayElev = await P(page, () => window.__FL__.weather.sunElev());
    await P(page, () => window.__FL__.animals.setPhase("night"));
    await P(page, () => window.__FL__.weather.applySky());
    await sleep(250);
    const nightMean = (await P(page, () => window.__FL__._snap())).mean;
    const nightElev = await P(page, () => window.__FL__.weather.sunElev());
    check("night is darker than day (tint applied)", nightMean < dayMean - 8, `day=${dayMean.toFixed(1)}(elev${dayElev.toFixed(0)}) night=${nightMean.toFixed(1)}(elev${nightElev.toFixed(0)})`);
    check("night stays readable (mean luma > 40, not too dark)", nightMean > 40, nightMean.toFixed(1));
    await P(page, () => window.__FL__.animals.setPhase("day"));
    await P(page, () => window.__FL__.weather.applySky());

    // --- tile highlight + E tills + repaints + persists ---
    // player 1.5m north of tile (5,5) center (-7,5), facing south (+Z)
    await P(page, () => { window.__FL__.farm.equip("hoe"); window.__FL__.farm.teleport(-7, 3.5); window.__FL__.farm.setHeading(0); });
    await sleep(250);
    const tgt = await P(page, () => window.__FL__.farm.target());
    check("tile highlight/target on the faced tile (till)", tgt && tgt.gx === 5 && tgt.gz === 5 && tgt.verb === "till", JSON.stringify(tgt));

    const px0 = await P(page, () => window.__FL__._pixel(-7, 5));
    const t0 = await P(page, () => window.__FL__.farm.tileAt(5, 5));
    await P(page, () => window.__FL__.farm.action()); // E
    await sleep(250);
    const t1 = await P(page, () => window.__FL__.farm.tileAt(5, 5));
    const px1 = await P(page, () => window.__FL__._pixel(-7, 5));
    check("E tills the untouched tile (FarmState → tilled)", !t0.present && t1.present && t1.tilled, `before=${JSON.stringify(t0)} after=${JSON.stringify(t1)}`);
    const changed = px0 && px1 && (Math.abs(px0.r - px1.r) + Math.abs(px0.g - px1.g) + Math.abs(px0.b - px1.b)) > 10;
    check("tilled tile repaints (pixel changed)", changed, `${JSON.stringify(px0)}→${JSON.stringify(px1)}`);

    await P(page, () => window.__FL__.farm.flushSave());
    await sleep(200);
    check("0 pageerrors (desktop)", errors.length === 0, errors.join(" | "));

    // screenshots — day, walk (mid-stride), night
    await P(page, () => { window.__FL__.farm.teleport(6, 12); window.__FL__.farm.setHeading(Math.PI); });
    await P(page, () => window.__FL__.animals.setPhase("day"));
    await P(page, () => window.__FL__.weather.applySky());
    await P(page, () => window.__FL__.setInput({ fwd: 1, strafe: 0.3, run: false }));
    await sleep(500);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r1-walk.png") });
    await P(page, () => window.__FL__.setInput({ fwd: 0, strafe: 0 }));
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r1-day.png") });
    await P(page, () => window.__FL__.animals.setPhase("night"));
    await P(page, () => window.__FL__.weather.applySky());
    await sleep(400);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r1-night.png") });

    // --- persist across reload ---
    const page2 = (await bootPage(browser, false)).page;
    const persisted = await page2.evaluate(() => window.__FL__.farm.tileAt(5, 5));
    check("FarmState persists across reload (tile still tilled)", persisted.present && persisted.tilled, JSON.stringify(persisted));
    await page2.close();

    // ============================ MOBILE ============================
    console.log("\n=== MOBILE 390×844 ===");
    const m = await bootPage(browser, true);
    const mcss = await m.page.evaluate(() => window.__FL__._cssScale());
    check("mobile: integer-scaled pixelated", mcss.pixelated === "pixelated" && Math.abs(mcss.ratio - mcss.scale) < 0.001, `scale=${mcss.scale} ratio=${mcss.ratio.toFixed(3)}`);
    const msnap = await m.page.evaluate(() => window.__FL__._snap());
    check("mobile: world renders", msnap.distinct > 12 && msnap.stdev > 8, `distinct=${msnap.distinct} stdev=${msnap.stdev.toFixed(1)}`);
    const mBody = await m.page.evaluate(() => document.body.classList.contains("fl-mobile"));
    check("mobile: touch layer active (body.fl-mobile)", mBody);
    await m.page.screenshot({ path: path.join(SHOTS, "farmlife-2d-r1-mobile.png") });
    check("0 pageerrors (mobile)", m.errors.length === 0, m.errors.join(" | "));
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
