#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life P1.5b — the WORLD EDITOR. Serves the repo
 * root, drives /farmlife/dist/editor.html to decorate a world (sculpt, paint,
 * barn, fence), saves it, then RELOADS /farmlife/dist/index.html (same origin =
 * same localStorage) and asserts the game renders the decorated world: sculpted
 * bump in sampleHeight, painted mesh vertex, barn placed + colliding, fence
 * built. Also proves field-protection (no delta inside the plot) and that
 * clear-all returns the game to its baseline heights. Blocks Firebase/Playroom.
 *
 * Run:  node farmlife/verify-editor.cjs        (from repo root)
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
const GAME = BASE + "/farmlife/dist/index.html";
const EDITOR = BASE + "/farmlife/dist/editor.html";
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
          http.get({ host: "127.0.0.1", port, path: "/farmlife/dist/editor.html", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await sleep(200);
  }
  throw new Error("server timeout");
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  page.on("request", (req) => {
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(req.url())) return req.abort();
    req.continue();
  });
  return { page, errors };
}

// Like newPage but with the NETWORK ON (Firestore reachable) — reproduces the
// USER'S conditions for the "editor opens blank" report (verify's other sections
// block Firebase; the user doesn't). Only Playroom is blocked (the editor never
// uses it). Fam is forced to a scratch collection so production is never touched.
async function newPageNet(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  page.on("request", (req) => {
    if (/playroom/i.test(req.url())) return req.abort();
    req.continue();
  });
  return { page, errors };
}

// ---- Firestore REST (public rules; famtestfl scratch collection only) -------
const PROJECT_ID = "amen-farms-app";
const API_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const REST_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const FAM_NET = "famtestfl";
async function restListDocs(collection) {
  const res = await fetch(`${REST_BASE}/${collection}?key=${API_KEY}&pageSize=300`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`restListDocs ${collection}: HTTP ${res.status}`);
  const data = await res.json();
  return data.documents || [];
}
async function restDeleteAll(collection) {
  const docs = await restListDocs(collection);
  for (const d of docs) {
    const id = d.name.split("/").pop();
    await fetch(`${REST_BASE}/${collection}/${id}?key=${API_KEY}`, { method: "DELETE" });
  }
  return docs.length;
}

// test coordinates in open grass (clear of field/pond/house)
const TX = -40, TZ = -40;   // sculpt + paint probe
const BX = -30, BZ = -40;   // barn

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  // ===== 1) baseline game (empty world) =====
  console.log("\n=== BASELINE GAME (empty world) ===");
  const g0 = await newPage(browser);
  await g0.page.goto(GAME, { waitUntil: "load", timeout: 60000 });
  await g0.page.waitForFunction(() => window.__FL__ && window.__FL__.world, { timeout: 20000 });
  await g0.page.evaluate(() => { localStorage.removeItem("fl_world_v1"); localStorage.removeItem("fl_farm_v1"); });
  await g0.page.reload({ waitUntil: "load" });
  await g0.page.waitForFunction(() => window.__FL__ && window.__FL__.world, { timeout: 20000 });
  const baseH = await g0.page.evaluate((x, z) => window.__FL__.world.sampleHeight(x, z), TX, TZ);
  const baseColor = await g0.page.evaluate((x, z) => window.__FL__.world.groundColorAt(x, z), TX, TZ);
  const baseObjs = await g0.page.evaluate(() => window.__FL__.world.objectCount());
  check("baseline: empty world has 0 placed objects", baseObjs === 0, `objs=${baseObjs}`);
  await g0.page.close();

  // ===== 2) editor decorates + saves =====
  console.log("\n=== EDITOR — sculpt / paint / barn / fence ===");
  const ed = await newPage(browser);
  await ed.page.goto(EDITOR, { waitUntil: "load", timeout: 60000 });
  await ed.page.waitForFunction(() => window.__FLED__, { timeout: 20000 });
  await ed.page.evaluate(() => { localStorage.removeItem("fl_world_v1"); });
  await ed.page.reload({ waitUntil: "load" });
  await ed.page.waitForFunction(() => window.__FLED__, { timeout: 20000 });
  await sleep(300);

  // sculpt raises terrain
  const sc = await ed.page.evaluate((x, z) => {
    const before = window.__FLED__.heightAt(x, z);
    window.__FLED__.setMode("sculpt");
    window.__FLED__.sculptAt(x, z, 1);
    window.__FLED__.sculptAt(x, z, 1);
    return { before, after: window.__FLED__.heightAt(x, z), cells: window.__FLED__.terrainCells() };
  }, TX, TZ);
  check("sculpt raises terrain at the brush", sc.after - sc.before > 0.5 && sc.cells > 0, `Δ=${(sc.after - sc.before).toFixed(2)} cells=${sc.cells}`);

  // paint colors the mesh
  const pt = await ed.page.evaluate((x, z) => {
    const before = window.__FLED__.groundColorAt(x, z);
    window.__FLED__.setMode("paint");
    window.__FLED__.paintAt(x, z, 0x8a5a34); // dirt
    return { before, after: window.__FLED__.groundColorAt(x, z), cells: window.__FLED__.paintCells() };
  }, TX, TZ);
  const colorChanged = pt.before && pt.after && (Math.abs(pt.before[0] - pt.after[0]) + Math.abs(pt.before[1] - pt.after[1]) + Math.abs(pt.before[2] - pt.after[2])) > 0.02;
  check("paint changes the ground mesh vertex color", colorChanged && pt.cells > 0, `cells=${pt.cells}`);

  // place a barn
  const barn = await ed.page.evaluate((x, z) => {
    window.__FLED__.setMode("object");
    const id = window.__FLED__.addProp("barn");
    // move it to the target spot + seat it
    window.__FLED__.transformSelected([x, 3, z]);
    return { id, objs: window.__FLED__.objects() };
  }, BX, BZ);
  check("place barn: object appears in the list", barn.objs.some((o) => o.type === "barn"), `n=${barn.objs.length}`);

  // transform write-back
  const tw = await ed.page.evaluate(() => {
    window.__FLED__.transformSelected([-30, 3, -40], [8, 6, 6], 0.5);
    const o = window.__FLED__.objects().find((x) => x.id === window.__FLED__.selected());
    return o;
  });
  check("transform writes back to data coords", tw && Math.abs(tw.x - -30) < 0.1 && Math.abs(tw.z - -40) < 0.1, JSON.stringify(tw && { x: tw.x, z: tw.z }));

  // tag persists
  const tg = await ed.page.evaluate(() => {
    window.__FLED__.tagSelected("home barn");
    const o = window.__FLED__.objects().find((x) => x.id === window.__FLED__.selected());
    return o && o.tag;
  });
  check("tag persists on the object", tg === "home barn", tg);

  // fence with 3 posts
  const fn = await ed.page.evaluate(() => {
    window.__FLED__.addFencePoint(-20, -46);
    window.__FLED__.addFencePoint(-10, -46);
    window.__FLED__.addFencePoint(-10, -38);
    window.__FLED__.finishFence();
    return { fences: window.__FLED__.fences(), meshCount: window.__FLED__.fenceMeshCount() };
  });
  check("fence run of 3 points builds a mesh", fn.fences.length === 1 && fn.fences[0].points === 3 && fn.meshCount > 0, `pts=${fn.fences[0] && fn.fences[0].points} mesh=${fn.meshCount}`);

  // field-protection: brush inside the field writes NO cells
  const fp = await ed.page.evaluate(() => {
    const before = window.__FLED__.terrainCells();
    window.__FLED__.setMode("sculpt");
    window.__FLED__.sculptAt(-6, 6, 1); // FIELD center
    return { before, after: window.__FLED__.terrainCells() };
  });
  check("field-protection: sculpt inside the plot writes no cells", fp.after === fp.before, `before=${fp.before} after=${fp.after}`);

  // save
  const saved = await ed.page.evaluate(() => { window.__FLED__.save(); return !!localStorage.getItem("fl_world_v1"); });
  check("save writes fl_world_v1 to localStorage", saved);

  await ed.page.evaluate(() => { window.__FLED__.setMode("object"); });
  await sleep(200);
  await ed.page.screenshot({ path: path.join(SHOTS, "farmlife-editor.png") });
  const edErr = ed.errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("editor: 0 pageerrors", edErr.length === 0, edErr.join(" | "));
  await ed.page.close();

  // ===== 3) game renders the decorated world =====
  console.log("\n=== GAME renders the saved world ===");
  const g1 = await newPage(browser);
  await g1.page.goto(GAME, { waitUntil: "load", timeout: 60000 });
  await g1.page.waitForFunction(() => window.__FL__ && window.__FL__.world, { timeout: 20000 });
  await sleep(300);
  const gm = await g1.page.evaluate((x, z, bx, bz) => ({
    h: window.__FL__.world.sampleHeight(x, z),
    color: window.__FL__.world.groundColorAt(x, z),
    objs: window.__FL__.world.objectCount(),
    fences: window.__FL__.world.fenceCount(),
    barnPush: window.__FL__.world.collidePush(bx, bz),
    types: window.__FL__.world.types(),
  }), TX, TZ, BX, BZ);
  check("game: sculpted bump present in sampleHeight", gm.h - baseH > 0.5, `game=${gm.h.toFixed(2)} base=${baseH.toFixed(2)}`);
  const gColorChanged = (Math.abs(gm.color[0] - baseColor[0]) + Math.abs(gm.color[1] - baseColor[1]) + Math.abs(gm.color[2] - baseColor[2])) > 0.02;
  check("game: painted patch present on the ground mesh", gColorChanged, `Δ=${gColorChanged}`);
  check("game: barn spawned + collides", gm.objs >= 1 && gm.types.includes("barn") && gm.barnPush > 1.5, `objs=${gm.objs} push=${gm.barnPush.toFixed(2)}`);
  check("game: fence spawned", gm.fences >= 1, `fences=${gm.fences}`);

  // frame the decorated corner for the screenshot
  await g1.page.evaluate((x, z) => {
    window.__FL__.farm.teleport(x + 6, z + 6);
    window.__FL__.farm.setHeading(3.9);
    window.__FL__._setYaw(0.8);
    window.__FL__._setPitch(0.42);
  }, TX, TZ);
  await sleep(400);
  await g1.page.screenshot({ path: path.join(SHOTS, "farmlife-p15b-game.png") });
  const g1Err = g1.errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("game: 0 pageerrors with a decorated world", g1Err.length === 0, g1Err.join(" | "));
  await g1.page.close();

  // ===== 4) clear-all returns the game to baseline =====
  console.log("\n=== CLEAR-ALL restores baseline ===");
  const ed2 = await newPage(browser);
  await ed2.page.goto(EDITOR, { waitUntil: "load", timeout: 60000 });
  await ed2.page.waitForFunction(() => window.__FLED__, { timeout: 20000 });
  await ed2.page.evaluate(() => { window.__FLED__.clearAll(); window.__FLED__.save(); });
  await ed2.page.close();
  const g2 = await newPage(browser);
  await g2.page.goto(GAME, { waitUntil: "load", timeout: 60000 });
  await g2.page.waitForFunction(() => window.__FL__ && window.__FL__.world, { timeout: 20000 });
  const cleared = await g2.page.evaluate((x, z) => ({ h: window.__FL__.world.sampleHeight(x, z), objs: window.__FL__.world.objectCount() }), TX, TZ);
  check("clear-all: game height back to baseline", Math.abs(cleared.h - baseH) < 1e-9 && cleared.objs === 0, `h=${cleared.h.toFixed(4)} base=${baseH.toFixed(4)} objs=${cleared.objs}`);
  await g2.page.close();

  // ===== 5) EDITOR BOOTS WITH NETWORK ON + populated localStorage =====
  // Regression for the user's "editor opens blank" report. Firebase is NOT
  // blocked here (only Playroom is) so the editor connects to Firestore exactly
  // like the user's real machine — but pointed at the famtestfl scratch family
  // so production is never touched. localStorage is pre-populated (choreUser +
  // a saved farm + a saved non-empty world) to match a user who has been playing.
  console.log("\n=== EDITOR boots with NETWORK ON + populated localStorage (user repro) ===");
  await restDeleteAll(`farmlife_${FAM_NET}`); // pre-flight: scratch collection clean
  const en = await newPageNet(browser);
  await en.page.goto(EDITOR + "?fam=" + FAM_NET, { waitUntil: "load", timeout: 60000 });
  await en.page.evaluate(() => {
    localStorage.setItem("choreUser", "Dad");
    localStorage.setItem("fl_tune_v1", JSON.stringify({ camDist: 8 }));
    localStorage.setItem("fl_farm_v1", JSON.stringify({ coins: 50, seeds: {}, tiles: {} }));
    localStorage.setItem("fl_world_v1", JSON.stringify({
      terrain: { cell: 6, cells: { "-7,-7": 3.2, "-6,-7": 2.1 } },
      paint: { cell: 4, cells: { "-10,-10": 9067316 } },
      objects: [{ id: "obj_1", type: "barn", tag: "home", x: -30, y: 3, z: -40, rotY: 0, sx: 8, sy: 6, sz: 6 }],
      fences: [],
    }));
  });
  await en.page.reload({ waitUntil: "load", timeout: 60000 });
  const booted = await en.page.waitForFunction(() => window.__FLED__, { timeout: 20000 }).then(() => true).catch(() => false);
  check("net-on: editor module boots (__FLED__ ready) with Firestore reachable", booted);
  await sleep(2500); // let the firebase session settle + a couple render frames
  const ns = await en.page.evaluate(() => ({
    canvas: !!document.querySelector("#app canvas"),
    bootFailShown: (() => { const el = document.getElementById("bootFail"); return !!el && getComputedStyle(el).display !== "none"; })(),
    objs: window.__FLED__ ? window.__FLED__.objects().length : -1,
    isEmpty: window.__FLED__ ? window.__FLED__.isEmpty() : null,
    cloudReady: window.__FLED__ ? window.__FLED__.isCloudSaveReady() : null,
  }));
  check("net-on: WebGL canvas is present (not blank)", ns.canvas, `canvas=${ns.canvas}`);
  check("net-on: boot-watchdog message is NOT shown (editor started fine)", ns.bootFailShown === false, `shown=${ns.bootFailShown}`);
  check("net-on: the saved non-empty world loaded (barn present)", ns.objs === 1 && ns.isEmpty === false, `objs=${ns.objs} empty=${ns.isEmpty}`);
  await en.page.screenshot({ path: path.join(SHOTS, "farmlife-fix1-editor.png") }); // visual deliverable
  const enErr = en.errors.filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("net-on: 0 pageerrors booting the editor with Firestore reachable", enErr.length === 0, enErr.join(" | "));
  await en.page.close();
  // cleanup — the editor never SAVEs in this test, so it wrote nothing; confirm.
  const leftover = await restListDocs(`farmlife_${FAM_NET}`);
  check(`net-on cleanup: farmlife_${FAM_NET} untouched/empty`, leftover.length === 0, `remaining=${leftover.length}`);
  if (leftover.length) await restDeleteAll(`farmlife_${FAM_NET}`);

  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  console.log("shots: shots/farmlife-editor.png, shots/farmlife-p15b-game.png, shots/farmlife-fix1-editor.png");
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
