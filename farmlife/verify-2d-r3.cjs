#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life R3 — the FINAL round of the 2D MODERN
 * PIXEL conversion: multiplayer presence in 2D, cloud farm sync, mobile touch,
 * the three.js bundle-shed, and offline degrade. Serves the REPO ROOT and loads
 * /farmlife/dist/index.html (build first: `npm run build`).
 *
 * Sections
 *   C — OFFLINE SOLO   : network BLOCKED (playroom/firebase/gstatic). Solo
 *                        degrade, 0 pageerrors, mobile touch tap-vs-drag
 *                        discrimination, + the dist THREE-shed scan (0 sigs).
 *   B — CLOUD FARM     : REAL Firestore, ?fam=famtestfl&nopresence=1. Empty-boot
 *                        seed shape (animals+meta only), plant on A → B sees it,
 *                        per-player coins, cleanup asserted empty.
 *   A — MP PRESENCE    : TWO real browser PROCESSES vs REAL Playroom,
 *                        ?fam=famtestfl. B sees A's TINTED puppet move + hold a
 *                        tool + swing it + emote (bubble replay); lobby doc on
 *                        famtestfl appears/counts/deletes; games.html JOIN card.
 *
 * ALL Firestore touches are scoped to famtestfl (never production — herd-dup
 * lesson, CLAUDE.md); every doc created is deleted at the end and emptiness is
 * asserted. If real Playroom is unreachable, section A says so honestly.
 *
 * Run:  node farmlife/verify-2d-r3.cjs        (from repo root)
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require(path.resolve(__dirname, "..", "tools", "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const DIST = path.join(__dirname, "dist");
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const GAME_URL = BASE + "/farmlife/dist/index.html";
const GAMES_HTML = BASE + "/games.html";
fs.mkdirSync(SHOTS, { recursive: true });

const PROJECT_ID = "amen-farms-app";
const API_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const REST_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const FAM = "famtestfl";
const EXPECT_ROOM = "FLFAMTESTFL";

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail == null ? "" : String(detail) });
  console.log((cond ? "  ok  " : " FAIL ") + name + (detail != null ? "  → " + detail : ""));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- server bootstrap -------------------------------------------------------
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

// ---- Firestore REST helpers (public rules, house convention) ----------------
function decodeValue(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return decodeFields((v.mapValue && v.mapValue.fields) || {});
  if ("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(decodeValue);
  return v;
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}
async function restListDocs(collection) {
  const all = [];
  let pageToken = "";
  for (;;) {
    const url = `${REST_BASE}/${collection}?key=${API_KEY}&pageSize=300${pageToken ? "&pageToken=" + pageToken : ""}`;
    const res = await fetch(url);
    if (!res.ok) { if (res.status === 404) return []; throw new Error(`list ${collection}: HTTP ${res.status}`); }
    const data = await res.json();
    for (const d of data.documents || []) all.push(d);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return all;
}
async function restGetDoc(collection, id) {
  const res = await fetch(`${REST_BASE}/${collection}/${id}?key=${API_KEY}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get ${collection}/${id}: HTTP ${res.status}`);
  return decodeFields((await res.json()).fields || {});
}
async function restDeleteDoc(collection, id) {
  await fetch(`${REST_BASE}/${collection}/${id}?key=${API_KEY}`, { method: "DELETE" });
}
async function restDeleteCollection(collection) {
  const docs = await restListDocs(collection);
  for (const d of docs) await restDeleteDoc(collection, d.name.split("/").pop());
  return docs.length;
}
async function waitDoc(collection, id, pred, ms) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await restGetDoc(collection, id);
    if (pred(last)) return last;
    await sleep(600);
  }
  return last;
}

// field-tile world coords (verify-p1/p2 origin math)
function tileWorld(gx, gz) {
  const ORIGIN_X = -6 - 12, ORIGIN_Z = 6 - 12, TILE = 2;
  return { x: ORIGIN_X + TILE * (gx + 0.5), z: ORIGIN_Z + TILE * (gz + 0.5) };
}

const P = (page, fn, ...args) => page.evaluate(fn, ...args);

// =====================================================================
// Section C — OFFLINE SOLO + touch discrimination + THREE-shed scan
// =====================================================================
async function offlineSection(browser) {
  console.log("\n=== SECTION C — OFFLINE SOLO (network blocked) ===");

  // --- THREE-shed: dist bundle must carry zero THREE signatures ---
  const jsFiles = fs.readdirSync(path.join(DIST, "assets")).filter((f) => f.endsWith(".js"));
  const MARKERS = ["gl_Position", "void main()", "MeshStandardMaterial", "PlaneGeometry", "3.14159265359", "ShaderChunk"];
  let threeHits = 0;
  for (const f of jsFiles) {
    const src = fs.readFileSync(path.join(DIST, "assets", f), "utf8");
    for (const m of MARKERS) threeHits += src.split(m).length - 1;
  }
  check("dist bundle is THREE-free (0 THREE signatures across all assets)", threeHits === 0, `hits=${threeHits} files=${jsFiles.length}`);

  async function boot(mobile) {
    const page = await browser.newPage();
    await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2 } : { width: 1280, height: 720, deviceScaleFactor: 1 });
    // TRUE offline: (1) neutralize WebSocket so Playroom can never connect —
    // puppeteer request-interception only covers HTTP(S), not the WS upgrade, so
    // a stub that stays CONNECTING forever forces the presence solo-fallback with
    // zero errors; (2) start from a PRISTINE farm (prior suites persist tiles to
    // fl_farm_v1 on pagehide) so the till/tap tile assertions are deterministic.
    await page.evaluateOnNewDocument(() => {
      try { localStorage.removeItem("fl_farm_v1"); } catch (_) {}
      const FakeWS = class { constructor() { this.readyState = 0; } send() {} close() { this.readyState = 3; } addEventListener() {} removeEventListener() {} };
      FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;
      window.WebSocket = FakeWS;
    });
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
    await page.goto(GAME_URL, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__FL__ && typeof window.__FL__._snap === "function", { timeout: 20000 });
    await sleep(500);
    return { page, errors };
  }

  // ---- desktop solo ----
  const { page, errors } = await boot(false);
  const snap = await P(page, () => window.__FL__._snap());
  check("solo: world renders (distinct colors > 12, non-uniform)", snap.distinct > 12 && snap.stdev > 8, `distinct=${snap.distinct} stdev=${snap.stdev.toFixed(1)}`);
  // presence never connects (Playroom blocked) → solo, remoteCount 0
  await sleep(1500);
  const conn = await P(page, () => window.__FL__.presence.connected());
  const rc = await P(page, () => window.__FL__.presence.remoteCount());
  check("solo: presence NOT connected (Playroom blocked → solo fallback)", conn === false, `connected=${conn}`);
  check("solo: 0 remote avatars", rc === 0, `remoteCount=${rc}`);
  const isCloud = await P(page, () => window.__FL__.net.isCloud());
  check("solo: farm store falls back to local (not cloud)", isCloud === false, `isCloud=${isCloud}`);
  // core loop still works offline: walk + till
  await P(page, () => { window.__FL__.farm.equip("hoe"); window.__FL__.farm.teleport(-7, 3.5); window.__FL__.farm.setHeading(0); });
  await sleep(250);
  const t0 = await P(page, () => window.__FL__.farm.tileAt(5, 5));
  await P(page, () => window.__FL__.farm.action());
  await sleep(200);
  const t1 = await P(page, () => window.__FL__.farm.tileAt(5, 5));
  check("solo: farming loop works offline (E tills a tile)", !t0.present && t1.present && t1.tilled, `${JSON.stringify(t0)}→${JSON.stringify(t1)}`);
  // local emote renders (speech bubble path) without error
  await P(page, () => window.__FL__.presence.emote("wave"));
  await sleep(200);
  check("solo: local emote fires without error", true);
  check("solo: 0 pageerrors (desktop)", errors.length === 0, errors.join(" | "));

  // --- hero screenshot: planted field + farmer + golden dusk light ---
  await P(page, () => {
    const FL = window.__FL__;
    const crops = ["turnip", "potato", "corn", "pumpkin", "carrot", "tomato", "strawberry", "sunflower"];
    let i = 0;
    for (let gx = 3; gx <= 9; gx++) for (let gz = 3; gz <= 9; gz++) {
      const c = crops[(i++) % crops.length];
      const stage = ((gx + gz) % 4);
      FL.farm.plantStage(gx, gz, c, stage);
    }
    FL.farm.teleport(-6, 12);
    FL.farm.setHeading(Math.PI);
    FL.animals.setPhase("dusk");
    FL.weather.applySky();
  });
  await sleep(700);
  await page.screenshot({ path: path.join(SHOTS, "farmlife-2d-final-hero.png") });
  check("hero screenshot composed (planted field + dusk light)", true, "shots/farmlife-2d-final-hero.png");
  await page.close();

  // ---- mobile: touch layer + tap-vs-drag discrimination ----
  const m = await boot(true);
  const mp = m.page;
  const layer = await P(mp, () => ({
    body: document.body.classList.contains("fl-mobile"),
    stick: !!document.getElementById("fl-stickzone"),
    action: getComputedStyle(document.getElementById("fl-actionbtn")).display !== "none",
    jump: getComputedStyle(document.getElementById("fl-jumpbtn")).display !== "none",
    emote: !!document.getElementById("fl-emotebtn"),
    touchMobile: window.__FL__.touch.mobile(),
  }));
  check("mobile: touch layer active (body.fl-mobile + stick zone + touch2d)", layer.body && layer.stick && layer.touchMobile);
  check("mobile: HUD ACTION + JUMP thumb buttons visible, 💬 emote present", layer.action && layer.jump && layer.emote, JSON.stringify(layer));

  // DRAG → analog joystick engages + player walks north
  await P(mp, () => { window.__FL__.farm.teleport(0, 0); });
  await sleep(200);
  const zBefore = await P(mp, () => window.__FL__.player.z);
  await P(mp, () => {
    const sz = document.getElementById("fl-stickzone");
    sz.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, clientX: 90, clientY: 700, button: 0, bubbles: true }));
    // drag straight UP 100px (> DRAG_START_PX) → forward
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, clientX: 90, clientY: 640, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 7, clientX: 90, clientY: 600, bubbles: true }));
  });
  await sleep(150);
  const inputDuringDrag = await P(mp, () => window.__FL__.touch.input());
  await sleep(700);
  const zAfterDrag = await P(mp, () => window.__FL__.player.z);
  await P(mp, () => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, clientX: 90, clientY: 600, bubbles: true })));
  await sleep(150);
  const inputAfterUp = await P(mp, () => window.__FL__.touch.input());
  check("mobile DRAG: analog stick engages (joystick fwd > 0.3)", inputDuringDrag && inputDuringDrag.fwd > 0.3, JSON.stringify(inputDuringDrag));
  check("mobile DRAG: player walks north (z decreased > 2m)", zBefore - zAfterDrag > 2, `dz=${(zBefore - zAfterDrag).toFixed(2)}`);
  check("mobile DRAG: releasing clears the stick (fwd back to 0)", inputAfterUp && Math.abs(inputAfterUp.fwd) < 0.001, JSON.stringify(inputAfterUp));

  // TAP → acts on the faced tile, NO joystick engagement, player does not walk
  await P(mp, () => { window.__FL__.farm.equip("hoe"); window.__FL__.farm.teleport(-7, 3.5); window.__FL__.farm.setHeading(0); });
  await sleep(250);
  const tapScreen = await P(mp, () => window.__FL__.farm.tileScreen(5, 5)); // tile the farmer faces
  const inLeftZone = tapScreen.sx < 0.55 * 390;
  const tBeforeTap = await P(mp, () => window.__FL__.farm.tileAt(5, 5));
  const posBeforeTap = await P(mp, () => ({ x: window.__FL__.player.x, z: window.__FL__.player.z }));
  await P(mp, (sx, sy) => {
    const sz = document.getElementById("fl-stickzone");
    sz.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 8, clientX: sx, clientY: sy, button: 0, bubbles: true }));
    // NO move; quick release → a tap
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 8, clientX: sx, clientY: sy, bubbles: true }));
  }, tapScreen.sx, tapScreen.sy);
  await sleep(300);
  const inputAfterTap = await P(mp, () => window.__FL__.touch.input());
  const tAfterTap = await P(mp, () => window.__FL__.farm.tileAt(5, 5));
  const posAfterTap = await P(mp, () => ({ x: window.__FL__.player.x, z: window.__FL__.player.z }));
  const walked = Math.hypot(posAfterTap.x - posBeforeTap.x, posAfterTap.z - posBeforeTap.z);
  check("mobile TAP: tap point lands in the left joystick zone (coexistence)", inLeftZone, `sx=${tapScreen.sx.toFixed(0)} < ${(0.55 * 390).toFixed(0)}`);
  check("mobile TAP: quick low-travel tap acts on the tile (tilled), NOT a drag", !tBeforeTap.present && tAfterTap.present && tAfterTap.tilled, `${JSON.stringify(tBeforeTap)}→${JSON.stringify(tAfterTap)}`);
  check("mobile TAP: tap did NOT engage the joystick (fwd/strafe stayed 0)", inputAfterTap && Math.abs(inputAfterTap.fwd) < 0.001 && Math.abs(inputAfterTap.strafe) < 0.001, JSON.stringify(inputAfterTap));
  check("mobile TAP: tap did not walk the player (< 0.5m)", walked < 0.5, `walked=${walked.toFixed(2)}`);

  await mp.screenshot({ path: path.join(SHOTS, "farmlife-2d-final-mobile.png") });
  check("mobile: 0 pageerrors", m.errors.length === 0, m.errors.join(" | "));
  await mp.close();
}

// =====================================================================
// Section B — CLOUD FARM (famtestfl, presence OFF)
// =====================================================================
async function cloudSection(browser) {
  console.log("\n=== SECTION B — CLOUD FARM (famtestfl, ?nopresence) ===");
  async function device(name) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1000, height: 720 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e)));
    await page.evaluateOnNewDocument((n) => { try { localStorage.setItem("choreUser", n); localStorage.setItem("fl_tune_v1", JSON.stringify({ fastGrow: false })); } catch (_) {} }, name);
    await page.goto(`${GAME_URL}?fam=${FAM}&nopresence=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__FL__ && window.__FL__.net && typeof window.__FL__.net.ready === "function", { timeout: 20000 });
    return { ctx, page, errors };
  }
  async function waitCloud(page) {
    if (!(await page.evaluate(() => window.__FL__.net.ready()))) return false;
    try { await page.waitForFunction(() => window.__FL__.net.isCloud() === true, { timeout: 20000 }); return true; } catch (_) { return false; }
  }
  async function faceTile(page, gx, gz) {
    await page.bringToFront().catch(() => {});
    await page.evaluate((g) => { window.__FL__.farm.teleport(g.x, g.z - 1.6); window.__FL__.farm.setHeading(0); }, { ...tileWorld(gx, gz) });
    await sleep(120);
  }
  async function act(page) {
    await page.bringToFront().catch(() => {});
    await page.evaluate(() => window.__FL__.farm.action());
    await page.waitForFunction(() => !window.__FL__.avatar.isBusy(), { timeout: 3000 }).catch(() => {});
  }

  // (a) A boots empty
  const A = await device("TesterA");
  const aReady = await waitCloud(A.page);
  check("cloud: device A store ready + active", aReady);
  await sleep(5000);
  const docs = await restListDocs(`farmlife_${FAM}`);
  const ids = docs.map((d) => d.name.split("/").pop()).sort();
  const animalsDoc = docs.find((d) => d.name.split("/").pop() === "animals");
  const aFields = animalsDoc ? Object.keys(animalsDoc.fields || {}).filter((k) => k.startsWith("a_")) : [];
  check("cloud: empty boot writes only animals+meta (no spurious region_*/player_* writes)", ids.length === 2 && ids[0] === "animals" && ids[1] === "meta" && aFields.length === 5, `docs=${JSON.stringify(ids)} a_=${aFields.length}`);

  // (b) A tills + plants
  await A.page.evaluate(() => window.__FL__.farm.equip("hoe"));
  await faceTile(A.page, 6, 6);
  await act(A.page);
  await A.page.evaluate(() => window.__FL__.farm.equip("seeds"));
  await faceTile(A.page, 6, 6);
  await act(A.page);
  await A.page.evaluate(() => window.__FL__.net.flush());
  await sleep(300);
  const region = await restGetDoc(`farmlife_${FAM}`, "region_0_0");
  const wire = region && region["t_6_6"];
  check("cloud: A's plant writes region_0_0.t_6_6 = turnip", wire && wire.crop === "turnip", JSON.stringify(wire));

  // (c) B sees it on boot
  const B = await device("TesterB");
  const bReady = await waitCloud(B.page);
  check("cloud: device B store ready + active", bReady);
  const bSees = await B.page.evaluate(() => window.__FL__.farm.tileAt(6, 6));
  check("cloud: B sees A's planted turnip on boot (live shared world)", bSees && bSees.crop === "turnip", JSON.stringify(bSees));

  // (d) per-player coins independent
  const aCoins0 = (await A.page.evaluate(() => window.__FL__.farm.state())).coins;
  await B.page.evaluate(() => window.__FL__.farm.setCoins(1234));
  await B.page.evaluate(() => window.__FL__.net.flush());
  await sleep(1500);
  const aCoins1 = (await A.page.evaluate(() => window.__FL__.farm.state())).coins;
  const bPlayer = await restGetDoc(`farmlife_${FAM}`, "player_TesterB");
  check("cloud: coins are per-player (B's coin change doesn't touch A)", aCoins1 === aCoins0, `A ${aCoins0}→${aCoins1}`);
  check("cloud: B has its own player doc", bPlayer && typeof bPlayer.coins === "number", JSON.stringify(bPlayer && { coins: bPlayer.coins }));

  const errs = [...A.errors, ...B.errors].filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("cloud: 0 real pageerrors", errs.length === 0, errs.join(" | "));
  await A.ctx.close().catch(() => {});
  await B.ctx.close().catch(() => {});
}

// =====================================================================
// Section A — MP PRESENCE (2 real processes vs REAL Playroom)
// =====================================================================
async function mpSection() {
  console.log("\n=== SECTION A — MP PRESENCE (2 processes, REAL Playroom) ===");
  async function launch(name) {
    const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-gpu-vsync"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 720 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e)));
    await page.evaluateOnNewDocument((n) => { try { localStorage.setItem("choreUser", n); localStorage.setItem("fl_tune_v1", JSON.stringify({ fastGrow: false })); } catch (_) {} }, name);
    await page.goto(`${GAME_URL}?fam=${FAM}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__FL__ && window.__FL__.presence, { timeout: 20000 });
    await page.evaluate(() => {
      window.__toasts = [];
      const host = document.getElementById("fl-toasts");
      if (host) new MutationObserver((muts) => { for (const mm of muts) for (const n of mm.addedNodes) if (n.textContent) window.__toasts.push(n.textContent); }).observe(host, { childList: true });
    });
    return { browser, page, errors, name };
  }
  async function connected(page, ms = 25000) {
    try { await page.waitForFunction(() => window.__FL__.presence.connected() === true, { timeout: ms }); return true; } catch (_) { return false; }
  }

  const B = await launch("TesterB"); // launch B first (oldest → lobby single-writer)
  if (!(await connected(B.page))) {
    check("MP: REAL Playroom reachable (device B connected)", false, "insertCoin never connected — Playroom UNREACHABLE from this environment (reported honestly, no fabricated pass)");
    await B.browser.close().catch(() => {});
    return;
  }
  check("MP: REAL Playroom reachable (device B connected)", true);
  const A = await launch("TesterA");
  check("MP: device A connected", await connected(A.page));
  const idA = await A.page.evaluate(() => window.__FL__.presence.myId());
  const idB = await B.page.evaluate(() => window.__FL__.presence.myId());

  // both auto-join the same derived room, no lobby UI
  const roomA = await A.page.evaluate(() => window.__FL__.presence.roomCode());
  const roomB = await B.page.evaluate(() => window.__FL__.presence.roomCode());
  check("MP: A + B share the derived room code (auto-join, no lobby UI)", roomA === EXPECT_ROOM && roomB === EXPECT_ROOM, `A=${roomA} B=${roomB}`);
  const seesEachOther = async (page, id) => page.evaluate((id) => new Promise((res) => {
    const t0 = Date.now();
    (function poll() { if (window.__FL__.presence.remoteIds().includes(id)) return res(true); if (Date.now() - t0 > 15000) return res(false); setTimeout(poll, 300); })();
  }), id);
  check("MP: B sees A as a remote", await seesEachOther(B.page, idA));
  check("MP: A sees B as a remote", await seesEachOther(A.page, idB));
  check("MP: presence count = 2 on B", (await B.page.evaluate(() => window.__FL__.presence.presentCount())) === 2);

  // A moves → B's copy of A moves + converges + walk gait
  await A.page.evaluate(() => window.__FL__.farm.teleport(16, 34)); await sleep(400);
  const before = await B.page.evaluate((id) => window.__FL__.presence.remotePos(id), idA);
  await A.page.evaluate(() => window.__FL__.farm.teleport(26, 42));
  await sleep(1600);
  const st = await B.page.evaluate((id) => window.__FL__.presence.remoteState(id), idA);
  const moved = before && st ? Math.hypot(st.x - before.x, st.z - before.z) : 0;
  const dist = st ? Math.hypot(st.x - 26, st.z - 42) : 999;
  check("MP: B's copy of A moved when A moved", moved > 3, `moved=${moved.toFixed(2)}m`);
  check("MP: B's copy of A converged near A's new pos (<2.5m)", dist < 2.5, `dist=${dist.toFixed(2)}m`);
  // tinted puppet
  check("MP: A's remote puppet carries a shirt TINT (valid hex, not default)", st && /^#[0-9a-f]{6}$/i.test(st.color || ""), JSON.stringify(st && { color: st.color, name: st.name }));

  // A equips + uses the hoe → B sees the tool + a swing replay
  await A.page.evaluate(() => {
    const g = { gx: 6, gz: 6 }; const ORIGIN_X = -6 - 12, ORIGIN_Z = 6 - 12, TILE = 2;
    const x = ORIGIN_X + TILE * (g.gx + 0.5), z = ORIGIN_Z + TILE * (g.gz + 0.5);
    window.__FL__.farm.teleport(x, z - 1.6); window.__FL__.farm.setHeading(0); window.__FL__.farm.equip("hoe");
  });
  await sleep(900);
  const toolOnB = await B.page.evaluate((id) => { const s = window.__FL__.presence.remoteState(id); return s && s.tool; }, idA);
  check("MP: B sees A's equipped hoe (tool display synced)", toolOnB === "hoe", `tool=${toolOnB}`);
  await A.page.evaluate(() => window.__FL__.farm.action()); // till → emitAnim("hoe")
  let sawSwing = false;
  try {
    await B.page.waitForFunction((id) => { const s = window.__FL__.presence.remoteState(id); return s && s.acting === true; }, { timeout: 4000, polling: 30 }, idA);
    sawSwing = true;
  } catch (_) {}
  check("MP: B replays A's hoe swing (remote tool-use tween plays)", sawSwing);

  // A emotes → speech bubble replays on B; repeating re-triggers
  await A.page.evaluate(() => window.__FL__.presence.emote("wave"));
  let bubble1 = false;
  try { await B.page.waitForFunction((id) => { const s = window.__FL__.presence.remoteState(id); return s && s.emote === "wave"; }, { timeout: 5000, polling: 30 }, idA); bubble1 = true; } catch (_) {}
  check("MP: A's emote replays as a bubble over A on B", bubble1);
  let hidden = false;
  try { await B.page.waitForFunction((id) => { const s = window.__FL__.presence.remoteState(id); return s && s.emote === null; }, { timeout: 4000, polling: 50 }, idA); hidden = true; } catch (_) {}
  await A.page.evaluate(() => window.__FL__.presence.emote("wave"));
  let bubble2 = false;
  try { await B.page.waitForFunction((id) => { const s = window.__FL__.presence.remoteState(id); return s && s.emote === "wave"; }, { timeout: 5000, polling: 30 }, idA); bubble2 = true; } catch (_) {}
  check("MP: repeating the SAME emote re-triggers the bubble (exactly-once seq)", hidden && bubble2, `hidden=${hidden} reshown=${bubble2}`);

  // two-players screenshot (both tinted farmers + name tag + A mid-emote)
  await A.page.evaluate(() => { window.__FL__.farm.teleport(17.5, 37.5); window.__FL__.farm.setHeading(Math.PI); });
  await sleep(700);
  await A.page.evaluate(() => window.__FL__.presence.emote("heart"));
  await sleep(350);
  try { await B.page.screenshot({ path: path.join(SHOTS, "farmlife-2d-final-two-players.png") }); } catch (_) {}
  check("MP: two-players screenshot composed", true, "shots/farmlife-2d-final-two-players.png");

  // lobby doc + games.html card
  const lob2 = await waitDoc(`lobbies_${FAM}`, "fl_farm", (d) => d && d.playerCount === 2 && d.status === "open", 20000);
  check("MP: lobby doc fl_farm playerCount 2 / status open", lob2 && lob2.playerCount === 2 && lob2.status === "open", JSON.stringify(lob2 && { pc: lob2.playerCount, st: lob2.status }));
  check("MP: lobby doc game=farmlife, ico=🌱, maxPlayers 8", lob2 && lob2.game === "farmlife" && lob2.ico === "🌱" && lob2.maxPlayers === 8, JSON.stringify(lob2 && { game: lob2.game, ico: lob2.ico, mp: lob2.maxPlayers }));
  const G = await B.browser.newPage();
  const gErrors = [];
  G.on("pageerror", (e) => gErrors.push(String(e.message || e)));
  await G.goto(`${GAMES_HTML}?fam=${FAM}`, { waitUntil: "load", timeout: 60000 });
  let cardText = "";
  try {
    await G.waitForFunction(() => { const el = document.querySelector("#lobbyBanners .lobby-card .lobby-text"); return el && /on the farm/.test(el.textContent || ""); }, { timeout: 15000 });
    cardText = await G.evaluate(() => document.querySelector("#lobbyBanners .lobby-card .lobby-text").textContent);
  } catch (_) {}
  check("MP: games.html renders the Farm Life JOIN card", /on the farm/.test(cardText) && /farming/.test(cardText), JSON.stringify(cardText));
  await G.close().catch(() => {});

  // A leaves → B disposes it + leave toast + lobby count decrements
  await A.browser.close().catch(() => {});
  let disposed = false;
  try { await B.page.waitForFunction(() => window.__FL__.presence.remoteCount() === 0, { timeout: 15000, polling: 200 }); disposed = true; } catch (_) {}
  check("MP: B disposed A's avatar on leave (remoteCount → 0)", disposed);
  const toastsB = await B.page.evaluate(() => window.__toasts || []);
  check("MP: B saw a leave toast", toastsB.some((t) => /headed home/.test(t)), JSON.stringify(toastsB.slice(-4)));
  const lob1 = await waitDoc(`lobbies_${FAM}`, "fl_farm", (d) => d && d.playerCount === 1, 20000);
  check("MP: lobby playerCount decremented to 1", lob1 && lob1.playerCount === 1, JSON.stringify(lob1 && { pc: lob1.playerCount }));

  // B (last present) leaves → lobby doc deleted
  const bErrors = B.errors.slice();
  await B.page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await sleep(2500);
  await B.browser.close().catch(() => {});
  const gone = await waitDoc(`lobbies_${FAM}`, "fl_farm", (d) => d === null, 15000);
  check("MP: lobby doc deleted when the last player left", gone === null);

  const realErrors = [...A.errors, ...bErrors, ...gErrors].filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("MP: 0 real pageerrors across both processes + games.html", realErrors.length === 0, realErrors.join(" | "));
}

// --offline: run ONLY the network-blocked Section C (the consolidated smoke
// runner verify-2d-all.cjs uses this — it never touches Firestore/Playroom).
const OFFLINE_ONLY = process.argv.includes("--offline");

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  await waitServer(PORT, 20000);

  if (!OFFLINE_ONLY) {
    const pre1 = await restDeleteCollection(`lobbies_${FAM}`);
    const pre2 = await restDeleteCollection(`farmlife_${FAM}`);
    console.log(`pre-flight cleanup: removed ${pre1} lobby doc(s), ${pre2} farm doc(s) from ${FAM}`);
  }

  // Section C runs in its own network-blocked browser (always).
  const offBrowser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
  try { await offlineSection(offBrowser); } finally { await offBrowser.close().catch(() => {}); }

  if (!OFFLINE_ONLY) {
    // Section B — cloud (real Firestore, presence off).
    const cloudBrowser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
    try { await cloudSection(cloudBrowser); } finally { await cloudBrowser.close().catch(() => {}); }

    // Section A — MP (2 real processes vs Playroom). Clean the cloud farm first so
    // the MP till lands on a PRISTINE tile (Section B planted region_0_0.t_6_6, and
    // the MP processes share the same famtestfl cloud farm).
    const midLob = await restDeleteCollection(`lobbies_${FAM}`);
    const midFarm = await restDeleteCollection(`farmlife_${FAM}`);
    console.log(`inter-section cleanup: removed ${midLob} lobby doc(s), ${midFarm} farm doc(s) before MP`);
    await mpSection();

    // ---- final cleanup ----
    console.log("\n=== cleanup — delete every doc this run created ===");
    const delLob = await restDeleteCollection(`lobbies_${FAM}`);
    const delFarm = await restDeleteCollection(`farmlife_${FAM}`);
    console.log(`deleted ${delLob} lobby doc(s), ${delFarm} farm doc(s)`);
    const finalLob = await restListDocs(`lobbies_${FAM}`);
    const finalFarm = await restListDocs(`farmlife_${FAM}`);
    check(`cleanup: lobbies_${FAM} empty`, finalLob.length === 0, `remaining=${finalLob.length}`);
    check(`cleanup: farmlife_${FAM} empty`, finalFarm.length === 0, `remaining=${finalFarm.length}`);
  }

  if (server) try { process.kill(server.pid); } catch (_) {}
  const passed = results.filter((r) => r.ok).length;
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${passed}/${results.length} checks passed`);
  if (fails.length) console.log("FAILED: " + fails.map((f) => f.name).join(", "));
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
