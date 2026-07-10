#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life P1.5a (human farmer + jump + tool system
 * + watering-can tank + tool-use animations). Serves the REPO ROOT and loads
 * /farmlife/dist/index.html. Blocks Firebase/Playroom out of habit. Desktop +
 * mobile passes. Screenshots into shots/.
 *
 * Covers: jump (rise ≥0.5m, lands on terrain, squash flag) · tank empties after
 * N waters + pond refill to capacity · wrong-tool hint appears & rate-limits ·
 * tool visibly attached to the hand + tracks it through a swing · each use-anim
 * actually moves the arm (the Chef Bucky frozen-arm cautionary tale) · mobile
 * jump button + tool slots + action-uses-equipped-tool · 0 pageerrors.
 *
 * Run:  node farmlife/verify-p15.cjs        (from repo root)
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
  results.push({ name, ok: !!cond, detail: detail == null ? "" : String(detail) });
  console.log((cond ? "  ok  " : " FAIL ") + name + (detail != null ? "  → " + detail : ""));
}

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
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootPage(browser, mobile) {
  const page = await browser.newPage();
  await page.setViewport(
    mobile ? { width: 390, height: 844, deviceScaleFactor: 2 } : { width: 1280, height: 800, deviceScaleFactor: 1 }
  );
  if (mobile) {
    await page.evaluateOnNewDocument(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        if (String(q).includes("pointer: coarse") || String(q).includes("pointer:coarse")) {
          return { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent() { return false; } };
        }
        return real(q);
      };
    });
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  // Deterministic OFF for fast-grow (test mode defaults ON) so growth timelines
  // read on the REAL clock in these suites. Merges over any existing tune.
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  page.on("request", (req) => {
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(req.url())) return req.abort();
    req.continue();
  });
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.farm && window.__FL__.avatar, { timeout: 20000 });
  // start each run from a clean farm
  await page.evaluate(() => localStorage.removeItem("fl_farm_v1"));
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.farm && window.__FL__.avatar, { timeout: 20000 });
  await sleep(400);
  return { page, errors };
}

async function faceTile(page, gx, gz) {
  await page.evaluate((gx, gz) => {
    const FL = window.__FL__;
    const ORIGIN_X = -6 - 12, ORIGIN_Z = 6 - 12, TILE = 2;
    const x = ORIGIN_X + TILE * (gx + 0.5);
    const z = ORIGIN_Z + TILE * (gz + 0.5);
    FL.farm.teleport(x, z - 1.6);
    FL.farm.setHeading(0);
  }, gx, gz);
  await sleep(120);
}
async function equip(page, tool) {
  await page.evaluate((t) => window.__FL__.farm.equip(t), tool);
  await sleep(60);
}
async function waitIdle(page) {
  await page.waitForFunction(() => !window.__FL__.avatar.isBusy(), { timeout: 3000 }).catch(() => {});
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  // ============================= DESKTOP =============================
  console.log("\n=== DESKTOP 1280×800 — farmer, jump, tools, animations ===");
  const { page, errors } = await bootPage(browser, false);

  // ---- JUMP ----
  await page.evaluate(() => window.__FL__.farm.teleport(0, 40)); // open grass
  await sleep(250);
  const jBefore = await page.evaluate(() => ({ y: window.__FL__.player.y, land: window.__FL__.avatar.landCount() }));
  const jump = await page.evaluate(async () => {
    window.__FL__.avatar.jump();
    let maxY = -1e9, sawAir = false;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const p = window.__FL__.player;
      maxY = Math.max(maxY, p.y);
      if (p.airborne) sawAir = true;
    }
    return { maxY, sawAir, groundNow: window.__FL__.player.y, airborneNow: window.__FL__.player.airborne, land: window.__FL__.avatar.landCount() };
  });
  check("jump: player rises ≥ 0.5m off the ground", jump.maxY - jBefore.y >= 0.5, `rise=${(jump.maxY - jBefore.y).toFixed(2)}m sawAir=${jump.sawAir}`);
  check("jump: lands back on terrain (airborne false, y ≈ ground)", !jump.airborneNow && Math.abs(jump.groundNow - jBefore.y) < 0.05, `groundNow=${jump.groundNow.toFixed(2)} before=${jBefore.y.toFixed(2)}`);
  check("jump: landing squash triggered (landCount +1)", jump.land === jBefore.land + 1, `land ${jBefore.land}->${jump.land}`);

  // ---- TOOL ATTACHED TO HAND + tracks during a swing ----
  await equip(page, "hoe");
  const attached = await page.evaluate(() => window.__FL__.avatar.toolAttachedToHand());
  check("tool mesh is parented under the hand anchor (scene graph)", attached, attached);
  const track = await page.evaluate(async () => {
    window.__FL__.avatar.playAnim("hoe");
    let maxD = 0, minHY = 1e9, maxHY = -1e9;
    for (let i = 0; i < 22; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const h = window.__FL__.avatar.handWorld();
      const t = window.__FL__.avatar.toolWorld();
      maxD = Math.max(maxD, Math.hypot(t.x - h.x, t.y - h.y, t.z - h.z));
      minHY = Math.min(minHY, h.y);
      maxHY = Math.max(maxHY, h.y);
    }
    return { maxD, handTravel: maxHY - minHY };
  });
  await waitIdle(page);
  check("held tool tracks the hand through the swing (dist < 0.4m)", track.maxD < 0.4, `maxDist=${track.maxD.toFixed(3)}m`);
  check("the hand actually travels during the hoe swing (> 0.3m)", track.handTravel > 0.3, `handTravel=${track.handTravel.toFixed(2)}m`);

  // ---- EACH USE-ANIMATION actually moves the arm (frozen-arm guard) ----
  const animDev = await page.evaluate(async () => {
    const ang = (a, b) => { let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; d = Math.min(1, Math.abs(d)); return 2 * Math.acos(d); };
    const out = {};
    for (const k of ["hoe", "water", "plant", "harvest", "refill"]) {
      while (window.__FL__.avatar.isBusy()) await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => setTimeout(r, 130));
      const idle = window.__FL__.avatar.armQuat();
      window.__FL__.avatar.playAnim(k);
      let maxAng = 0;
      for (let i = 0; i < 26; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        maxAng = Math.max(maxAng, ang(idle, window.__FL__.avatar.armQuat()));
      }
      out[k] = maxAng;
    }
    return out;
  });
  await waitIdle(page);
  for (const k of ["hoe", "water", "plant", "harvest", "refill"]) {
    check(`use-anim '${k}' actually animates the arm (Δquat > 0.2 rad)`, animDev[k] > 0.2, `Δ=${animDev[k].toFixed(2)} rad`);
  }

  // ---- WATERING-CAN TANK: empties after `cap` waters, refills at the pond ----
  // One turnip ripens in ~4 waterings, so drain the tank across `cap` freshly
  // planted turnips (each watered once) — one water = one tank unit consumed.
  const cap = await page.evaluate(() => window.__FL__.farm.tankCap());
  // buy just enough turnip seeds to plant `cap` tiles (start with 5) — keeps
  // coins high enough to afford the pumpkin for the harvest hold-up shot later
  await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__FL__.farm.buySeed("turnip"); }, Math.max(1, cap - 3));
  const tankTiles = [];
  for (let i = 0; i < cap; i++) tankTiles.push([7, 3 + i]); // gz 3..(3+cap-1), all in-grid
  for (const [gx, gz] of tankTiles) {
    await equip(page, "hoe");
    await faceTile(page, gx, gz);
    await page.evaluate(() => window.__FL__.farm.action()); // till
    await waitIdle(page);
    await equip(page, "seeds");
    await faceTile(page, gx, gz);
    await page.evaluate(() => window.__FL__.farm.action()); // plant turnip
    await waitIdle(page);
  }
  await equip(page, "can");
  await page.evaluate(() => window.__FL__.farm._addTimeOffset(3600001)); // all thirsty at once
  let waters = 0;
  for (const [gx, gz] of tankTiles) {
    await faceTile(page, gx, gz);
    const tgt = await page.evaluate(() => window.__FL__.farm.target());
    if (!tgt || tgt.kind !== "water") continue;
    await page.evaluate(() => window.__FL__.farm.action());
    await waitIdle(page);
    waters++;
  }
  const tankEmpty = await page.evaluate(() => window.__FL__.farm.tank());
  check(`tank empties after ${cap} waters (tank now 0)`, tankEmpty === 0 && waters === cap, `waters=${waters} tank=${tankEmpty}`);

  // empty-can hint on a thirsty crop: make the first tile thirsty again
  await page.evaluate(() => window.__FL__.farm._addTimeOffset(3600001));
  await faceTile(page, 7, 3);
  const emptyTgt = await page.evaluate(() => window.__FL__.farm.target());
  check("empty can on a thirsty crop resolves to a refill hint", emptyTgt && emptyTgt.kind === "hint" && /empty|pond/i.test(emptyTgt.label), JSON.stringify(emptyTgt));

  // refill at the pond edge
  const pond = await page.evaluate(() => window.__FL__.farm.pondPos);
  await page.evaluate((x, z) => window.__FL__.farm.teleport(x, z - (10 + 1.5)), pond.x, pond.z); // stand just south of the pond edge
  await sleep(140);
  const refillTgt = await page.evaluate(() => window.__FL__.farm.target());
  check("standing at the pond with the can: action resolves to refill", refillTgt && refillTgt.kind === "refill", JSON.stringify(refillTgt));
  await page.evaluate(() => window.__FL__.farm.action());
  await waitIdle(page);
  const tankFull = await page.evaluate(() => window.__FL__.farm.tank());
  check(`refill fills the tank back to capacity (${cap})`, tankFull === cap, `tank=${tankFull}`);

  // ---- WRONG-TOOL HINT appears + rate-limits ----
  await equip(page, "hands");
  await faceTile(page, 10, 10); // untouched -> hands is the wrong tool (wants hoe)
  const hintTarget = await page.evaluate(() => window.__FL__.farm.target());
  check("wrong tool on a tile: target is a hint", hintTarget && hintTarget.kind === "hint" && hintTarget.hint === true, JSON.stringify(hintTarget));
  const hintRL = await page.evaluate(async () => {
    const h0 = window.__FL__.farm.hintFires();
    window.__FL__.farm.action(); // fires
    window.__FL__.farm.action(); // rate-limited (within 1.5s)
    const h1 = window.__FL__.farm.hintFires();
    const toasts = [...document.querySelectorAll("#fl-toasts .fl-toast")];
    const toastText = toasts.length ? toasts[toasts.length - 1].textContent : ""; // newest toast = the hint
    await new Promise((r) => setTimeout(r, 1650));
    window.__FL__.farm.action(); // fires again after cooldown
    const h2 = window.__FL__.farm.hintFires();
    return { h0, h1, h2, toastText };
  });
  check("wrong-tool hint fires a toast", hintRL.h1 === hintRL.h0 + 1 && /hoe/i.test(hintRL.toastText), `fires ${hintRL.h0}->${hintRL.h1} toast="${hintRL.toastText}"`);
  check("hint is rate-limited (2 rapid presses = 1 toast)", hintRL.h1 === hintRL.h0 + 1, `h1=${hintRL.h1}`);
  check("hint fires again after the cooldown", hintRL.h2 === hintRL.h1 + 1, `h1=${hintRL.h1} h2=${hintRL.h2}`);

  // ---- SHOT: mid hoe-swing (tools hotbar visible) ----
  await equip(page, "hoe");
  await faceTile(page, 6, 8);
  await page.evaluate(() => window.__FL__.farm.action()); // till + starts the hoe swing
  await page.evaluate(() => {
    window.__FL__.farm.setHeading(0);
    window.__FL__._setYaw(-0.6);
    window.__FL__._setPitch(0.45);
  });
  await sleep(180); // catch the swing mid-animation
  await page.screenshot({ path: path.join(SHOTS, "farmlife-p15-desktop.png") });

  // ---- SHOT: harvest hold-up beat ----
  // A crop only ripens if it's WATERED (unwatered pauses at the grace window),
  // so plant a turnip and water it 4× to ready, then harvest for the hold-up.
  await page.evaluate(() => window.__FL__.farm.selectCrop("turnip"));
  await equip(page, "hoe");
  await faceTile(page, 9, 9);
  await page.evaluate(() => window.__FL__.farm.action()); // till
  await waitIdle(page);
  await equip(page, "seeds");
  await faceTile(page, 9, 9);
  await page.evaluate(() => window.__FL__.farm.action()); // plant turnip
  await waitIdle(page);
  await equip(page, "can");
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.__FL__.farm._addTimeOffset(3600001)); // 1h window
    await faceTile(page, 9, 9);
    await page.evaluate(() => window.__FL__.farm.action()); // water
    await waitIdle(page);
  }
  const readyTile = await page.evaluate(() => window.__FL__.farm.tileAt(9, 9));
  check("harvest-shot turnip watered to ready", readyTile.stage === "ready", JSON.stringify(readyTile));
  await equip(page, "hands");
  await faceTile(page, 9, 9);
  await page.evaluate(() => { window.__FL__._setYaw(-0.5); window.__FL__._setPitch(0.42); });
  await page.evaluate(() => window.__FL__.farm.action()); // harvest -> hold-up beat
  await sleep(320); // produce raised overhead ~mid hold-up
  await page.screenshot({ path: path.join(SHOTS, "farmlife-p15-harvest.png") });

  const realErr = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("desktop: 0 pageerrors", realErr.length === 0, realErr.join(" | "));
  await page.close();

  // ============================= MOBILE =============================
  console.log("\n=== MOBILE 390×844 (coarse pointer) ===");
  const m = await bootPage(browser, true);
  const mp = m.page;

  const btns = await mp.evaluate(() => ({
    jump: getComputedStyle(document.getElementById("fl-jumpbtn")).display,
    action: getComputedStyle(document.getElementById("fl-actionbtn")).display,
  }));
  check("mobile: jump + action buttons visible", btns.jump === "flex" && btns.action === "flex", JSON.stringify(btns));

  // jump button works
  await mp.evaluate(() => window.__FL__.farm.teleport(0, 40));
  await sleep(250);
  const mjBefore = await mp.evaluate(() => ({ y: window.__FL__.player.y, land: window.__FL__.avatar.landCount() }));
  const mjump = await mp.evaluate(async () => {
    document.getElementById("fl-jumpbtn").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    let maxY = -1e9;
    for (let i = 0; i < 90; i++) { await new Promise((r) => requestAnimationFrame(r)); maxY = Math.max(maxY, window.__FL__.player.y); }
    return { maxY, land: window.__FL__.avatar.landCount(), airborneNow: window.__FL__.player.airborne };
  });
  check("mobile: jump button lifts the player ≥ 0.5m and lands", mjump.maxY - mjBefore.y >= 0.5 && !mjump.airborneNow && mjump.land === mjBefore.land + 1, `rise=${(mjump.maxY - mjBefore.y).toFixed(2)} land ${mjBefore.land}->${mjump.land}`);

  // tool slots tappable
  await mp.evaluate(() => document.querySelector('.fl-slot[data-tool="seeds"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await sleep(60);
  const mtool = await mp.evaluate(() => window.__FL__.farm.selectedTool());
  check("mobile: tool slot tap equips the tool (seeds)", mtool === "seeds", mtool);

  // action button uses the equipped tool (hoe -> till)
  await equip(mp, "hoe");
  await faceTile(mp, 5, 5);
  await mp.evaluate(() => document.getElementById("fl-actionbtn").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await waitIdle(mp);
  const mtile = await mp.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), 5, 5);
  check("mobile: action button uses the equipped tool (hoe tills)", mtile.present && mtile.tilled, JSON.stringify(mtile));

  await mp.evaluate(() => { window.__FL__.farm.teleport(-9, -1); window.__FL__.farm.setHeading(0); window.__FL__._setYaw(0); window.__FL__._setPitch(0.5); });
  await sleep(300);
  await mp.screenshot({ path: path.join(SHOTS, "farmlife-p15-mobile.png") });
  const realErrM = m.errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("mobile: 0 pageerrors", realErrM.length === 0, realErrM.join(" | "));
  await mp.close();

  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  console.log("shots: shots/farmlife-p15-desktop.png, shots/farmlife-p15-harvest.png, shots/farmlife-p15-mobile.png");
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
