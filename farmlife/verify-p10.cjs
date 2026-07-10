#!/usr/bin/env node
"use strict";
/**
 * Headless verification for the 2026-07-10 farmlife features:
 *  (1) RIGHT-CLICK WALK-THEN-ACT — right-clicking a field tile out of reach
 *      auto-walks the farmer to a stand point within reach, then acts on the
 *      CLICKED tile; cancels on manual input / retargets on a new right-click;
 *      an in-reach right-click acts immediately; right-drag never orbits.
 *  (2) FAST-GROW test mode — fastGrow ON matures every crop in ~60s; OFF reads
 *      the real timeline; the TUNE toggle persists across reload.
 *
 * Serves the REPO ROOT and loads /farmlife/dist/index.html. Blocks Firebase/
 * Playroom (pure localStorage). NOTE: unlike the other suites this one does NOT
 * seed fastGrow OFF at boot — it drives fastGrow explicitly to test both states.
 *
 * Run:  node farmlife/verify-p10.cjs        (from repo root)
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

// tile grid math (mirrors grid.ts: ORIGIN (-18,-6), TILE 2)
const ORIGIN_X = -18, ORIGIN_Z = -6, TILE = 2, ACT_REACH = 2.2;
function tileCenter(gx, gz) {
  return { x: ORIGIN_X + TILE * (gx + 0.5), z: ORIGIN_Z + TILE * (gz + 0.5) };
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

async function boot(page) {
  await page.waitForFunction(() => window.__FL__ && window.__FL__.farm && typeof window.__FL__.farm.state === "function", { timeout: 20000 });
  await sleep(400);
}
async function place(page, x, z, h) {
  await page.evaluate((x, z, h) => { window.__FL__.farm.teleport(x, z); window.__FL__.farm.setHeading(h); }, x, z, h == null ? 0 : h);
  await sleep(120);
}
// stand 1.6m south of a tile, facing +Z (for the fast-grow plant/water flow)
async function faceTile(page, gx, gz) {
  const c = tileCenter(gx, gz);
  await place(page, c.x, c.z - 1.6, 0);
}
async function equip(page, tool) {
  await page.evaluate((t) => window.__FL__.farm.equip(t), tool);
  await sleep(60);
}
async function act(page) {
  await page.evaluate(() => window.__FL__.farm.action());
}
async function waitIdle(page) {
  await page.waitForFunction(() => !window.__FL__.avatar.isBusy(), { timeout: 3000 }).catch(() => {});
}
async function tileAt(page, gx, gz) {
  return page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), gx, gz);
}
async function autoWalk(page) {
  return page.evaluate(() => window.__FL__.farm.autoWalk());
}
async function playerPos(page) {
  return page.evaluate(() => ({ x: window.__FL__.player.x, z: window.__FL__.player.z }));
}
async function resetFarm(page) {
  // Wipe on the NEXT document load, AFTER the old page's pagehide-flush would
  // otherwise re-save the current field (that flush is why a plain removeItem +
  // reload doesn't actually reset — see the p1 migration-test note).
  await page.evaluateOnNewDocument(() => { try { localStorage.removeItem("fl_farm_v1"); } catch (_) {} });
  await page.reload({ waitUntil: "load" });
  await boot(page);
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

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/playroom|googleapis|firestore|firebase|gstatic|open-meteo/i.test(req.url())) return req.abort();
    req.continue();
  });
  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await boot(page);
  await resetFarm(page);

  // ===================== (A) FAST-GROW TEST MODE =====================
  console.log("\n=== (A) fast-grow test mode ===");
  const defFast = await page.evaluate(() => window.__FL__.farm.fastGrow());
  check("A0 fastGrow defaults ON (dev test mode)", defFast === true, `fastGrow=${defFast}`);

  // A1 — ON: plant + water carries a turnip to READY in ~60s.
  await page.evaluate(() => window.__FL__.farm.setFastGrow(true));
  await equip(page, "hoe");
  await faceTile(page, 6, 6);
  await act(page); await waitIdle(page); // till
  await equip(page, "seeds");
  await faceTile(page, 6, 6);
  await act(page); await waitIdle(page); // plant turnip
  const planted = await tileAt(page, 6, 6);
  check("A1 fastGrow ON: freshly planted turnip is stage 0", planted.crop === "turnip" && planted.stage === 0, JSON.stringify(planted));
  // grace window (30s) banks, then PAUSES unwatered -> still not ready at +61s w/o water
  await page.evaluate(() => window.__FL__.farm._addTimeOffset(61000));
  const pausedOn = await tileAt(page, 6, 6);
  check("A1b fastGrow ON: UNWATERED crop pauses (not ready at +61s — water-pause testable)", pausedOn.stage !== "ready", JSON.stringify(pausedOn));
  // one watering after the grace window carries it to maturity by ~60s
  await equip(page, "can");
  await faceTile(page, 6, 6);
  await act(page); await waitIdle(page); // water (banks the grace window, opens a fresh 30s one)
  await page.evaluate(() => window.__FL__.farm._addTimeOffset(31000));
  const ripeOn = await tileAt(page, 6, 6);
  check("A2 fastGrow ON: plant + water → ~60s later READY", ripeOn.stage === "ready", JSON.stringify(ripeOn));

  // A3 — OFF: the same real time (61s) leaves a turnip at stage 0.
  await page.evaluate(() => window.__FL__.farm.setFastGrow(false));
  await equip(page, "hoe");
  await faceTile(page, 3, 3);
  await act(page); await waitIdle(page); // till
  await equip(page, "seeds");
  await faceTile(page, 3, 3);
  await act(page); await waitIdle(page); // plant turnip
  await page.evaluate(() => window.__FL__.farm._addTimeOffset(61000));
  const offTile = await tileAt(page, 3, 3);
  check("A3 fastGrow OFF: +61s leaves a turnip at stage 0 (real 4h timeline)", offTile.stage === 0, JSON.stringify(offTile));

  // A4 — TUNE toggle persists across reload (drive the real DOM button).
  const beforeToggle = await page.evaluate(() => window.__FL__.farm.fastGrow());
  const clicked = await page.evaluate(() => {
    const b = document.getElementById("fl-tune-fastgrow");
    if (!b) return false;
    b.click();
    return true;
  });
  const afterToggle = await page.evaluate(() => window.__FL__.farm.fastGrow());
  check("A4a TUNE fast-grow button flips the flag", clicked && afterToggle === !beforeToggle, `${beforeToggle} -> ${afterToggle}`);
  await page.reload({ waitUntil: "load" });
  await boot(page);
  const afterReload = await page.evaluate(() => window.__FL__.farm.fastGrow());
  check("A4b fast-grow choice persists across reload", afterReload === afterToggle, `reloaded=${afterReload} expected=${afterToggle}`);

  // ===================== (B) WALK-THEN-ACT =====================
  console.log("\n=== (B) right-click walk-then-act ===");
  await resetFarm(page);
  await equip(page, "hoe");

  // B1 — in-reach right-click acts IMMEDIATELY (no walk).
  {
    const c = tileCenter(7, 7);
    await place(page, c.x, c.z - 1.5, 0); // 1.5m away, within ACT_REACH
    await page.evaluate(() => window.__FL__.farm.rightClickTile(7, 7));
    await waitIdle(page);
    const aw = await autoWalk(page);
    const t = await tileAt(page, 7, 7);
    check("B1 in-reach right-click acts immediately (no auto-walk, tile tilled)", aw === null && t.present && t.tilled && t.crop === null, JSON.stringify({ aw, t }));
  }

  // B2 — distant right-click auto-walks then tills the CLICKED tile.
  {
    const c = tileCenter(5, 5);
    await place(page, c.x + 12, c.z + 6, 0); // ~13.4m away, out of reach
    const start = await playerPos(page);
    await page.evaluate(() => window.__FL__.farm.rightClickTile(5, 5));
    const aw0 = await autoWalk(page);
    check("B2a distant right-click starts an auto-walk to the clicked tile", aw0 && aw0.gx === 5 && aw0.gz === 5, JSON.stringify(aw0));
    check("B2b stand point is within action reach of the tile", aw0 && Math.hypot(aw0.standX - c.x, aw0.standZ - c.z) <= ACT_REACH, aw0 && Math.hypot(aw0.standX - c.x, aw0.standZ - c.z).toFixed(2));
    await sleep(400); // mid-walk — label should be on the clicked tile
    await page.screenshot({ path: path.join(SHOTS, "farmlife-walkact.png") });
    await sleep(2600); // finish the walk + act
    const end = await playerPos(page);
    const distToTile = Math.hypot(end.x - c.x, end.z - c.z);
    const startDist = Math.hypot(start.x - c.x, start.z - c.z);
    const aw1 = await autoWalk(page);
    const t = await tileAt(page, 5, 5);
    check("B2c farmer converged to within reach of the clicked tile", distToTile <= ACT_REACH + 0.15 && distToTile < startDist, `dist ${startDist.toFixed(1)}→${distToTile.toFixed(2)}m`);
    check("B2d the CLICKED tile (5,5) became tilled; auto-walk cleared", t.present && t.tilled && aw1 === null, JSON.stringify({ t, aw1 }));
  }

  // B3 — manual input mid-walk CANCELS (no action fires).
  {
    const c = tileCenter(9, 2);
    await place(page, c.x, c.z + 13, 0); // ~13m south, out of reach
    await page.evaluate(() => window.__FL__.farm.rightClickTile(9, 2));
    const aw0 = await autoWalk(page);
    check("B3a auto-walk started toward (9,2)", aw0 && aw0.gx === 9 && aw0.gz === 2, JSON.stringify(aw0));
    await sleep(220); // mid-walk (still far from the tile)
    await page.evaluate(() => window.__FL__.setInput({ fwd: 1 })); // manual WASD-equivalent
    await sleep(220); // let a couple of frames process the cancel
    const awMid = await autoWalk(page);
    await page.evaluate(() => window.__FL__.setInput({ fwd: 0 })); // stop
    await sleep(200);
    const t = await tileAt(page, 9, 2);
    check("B3b manual input cancels the auto-walk", awMid === null, JSON.stringify(awMid));
    check("B3c no action fired on the cancelled tile (never tilled)", t.present === false, JSON.stringify(t));
  }

  // B4 — a new right-click mid-walk RETARGETS the goal. Fresh field + B2's
  // proven SE approach to the (reachable) retarget tile (5,5).
  {
    await resetFarm(page);
    await equip(page, "hoe");
    const cf = tileCenter(5, 5);
    await place(page, cf.x + 12, cf.z + 6, 0); // SE of the field, out of reach
    await page.evaluate(() => window.__FL__.farm.rightClickTile(2, 2));
    const awA = await autoWalk(page);
    check("B4a first right-click targets the far tile (2,2)", awA && awA.gx === 2 && awA.gz === 2, JSON.stringify(awA));
    await sleep(220); // mid-walk
    await page.evaluate(() => window.__FL__.farm.rightClickTile(5, 5));
    const awB = await autoWalk(page);
    check("B4b second right-click retargets to (5,5) mid-walk", awB && awB.gx === 5 && awB.gz === 5, JSON.stringify(awB));
    await sleep(3000); // finish the (retargeted) walk + act
    const t22 = await tileAt(page, 2, 2);
    const t55 = await tileAt(page, 5, 5);
    check("B4c only the retargeted tile (5,5) was freshly tilled — (2,2) never was", t55.present && t55.tilled && t55.crop === null && t22.present === false, JSON.stringify({ t22, t55 }));
  }

  // B5 — right-DRAG must not orbit the camera.
  {
    await page.evaluate(() => window.__FL__.farm.cancelAutoWalk());
    const yaw0 = await page.evaluate(() => window.__FL__.cam.yaw);
    await page.evaluate(async () => {
      const cv = document.querySelector("#app canvas");
      const send = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { button: 2, pointerId: 9, clientX: x, clientY: y, bubbles: true }));
      send("pointerdown", 640, 400);
      for (let i = 0; i < 12; i++) { window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 9, clientX: 640 - i * 12, clientY: 400, bubbles: true })); await new Promise((r) => setTimeout(r, 12)); }
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 9, bubbles: true }));
    });
    const yaw1 = await page.evaluate(() => window.__FL__.cam.yaw);
    await page.evaluate(() => window.__FL__.farm.cancelAutoWalk());
    check("B5 right-drag does NOT orbit the camera (yaw unchanged)", Math.abs(yaw1 - yaw0) < 0.001, `yaw ${yaw0.toFixed(4)}→${yaw1.toFixed(4)}`);
  }

  // B6 — the REAL right-click raycast path picks the tile under the cursor.
  {
    await resetFarm(page);
    await equip(page, "hoe");
    await place(page, -6, 24, Math.PI); // south of the field, avatar facing it (-z)
    // orient the CAMERA south-of-field looking north (yaw π) so the field is in view
    await page.evaluate(() => { window.__FL__._setYaw(Math.PI); if (window.__FL__._snapCam) window.__FL__._snapCam(); });
    await sleep(300);
    const GX = 6, GZ = 6;
    // Project + dispatch ATOMICALLY in one evaluate so the chase cam can't drift
    // between them. The ground-plane parallax at a tilted camera can still land
    // the ray on a tile ±1 from the projected center — that's inherent to the
    // camera angle, so the assertion checks the raycast picked a tile NEAR the
    // cursor (proving the raycast→worldToTile→walk wiring), within 1 tile.
    const sc = await page.evaluate((gx, gz) => {
      const s = window.__FL__.farm.tileScreen(gx, gz);
      if (!(s.sx > 4 && s.sx < 1276 && s.sy > 4 && s.sy < 796)) return { onScreen: false, s };
      document.querySelector("#app canvas").dispatchEvent(
        new PointerEvent("pointerdown", { button: 2, pointerId: 11, clientX: s.sx, clientY: s.sy, bubbles: true })
      );
      return { onScreen: true, s };
    }, GX, GZ);
    await sleep(120);
    const aw = await autoWalk(page);
    const tilledNow = await tileAt(page, GX, GZ);
    const nearCursor = aw && Math.abs(aw.gx - GX) <= 1 && Math.abs(aw.gz - GZ) <= 1;
    const ok = sc.onScreen && (nearCursor || (tilledNow.present && tilledNow.tilled));
    check("B6 real right-click raycast targets the field tile under the cursor", ok, JSON.stringify({ sc, aw }));
  }

  const realErr = errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("0 pageerrors across the whole suite", realErr.length === 0, realErr.join(" | "));

  await page.close();
  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  console.log("shot: shots/farmlife-walkact.png");
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
