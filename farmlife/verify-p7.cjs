#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life P7 — Farm Map 🗺 + Inventory 🎒.
 * ALL OFFLINE (Firebase/Playroom/open-meteo blocked): both features are pure
 * client-side reads of FarmState/world data, so this suite never touches
 * Firestore (nothing to clean up). "Live update" is proven by mutating local
 * state while the panel is open — the same code path a remote-sync echo takes
 * (applyRemoteFarm mutates farmState; the open panel re-reads it per frame).
 *
 * Sections:
 *  (A) MAP OPEN/CLOSE — 🗺 button, Tab key, ✖ button, tap-outside.
 *  (B) MAP RENDER — canvas non-blank; grass/pond/field palette pixels at
 *      projected coords; station markers + legend present.
 *  (C) MAP LIVE DATA — planted tile appears (growing green), flips to
 *      pulsing GOLD after a time-skip makes it ready; player arrow tracks
 *      position + facing across a teleport; animal dots inside the pen.
 *  (D) INVENTORY — 🎒 button + I key open/close; rows match a seeded
 *      FarmState exactly; tapping a seed row selects crop + equips seeds
 *      (hotbar reflects it); produce total-value math; tank meter; LIVE
 *      update while open.
 *  (E) MOBILE 390x844 — both panels usable, no overlap between the new HUD
 *      buttons and the hotbar/action/jump/emote controls, 0 pageerrors.
 *  Screenshots: shots/farmlife-map-desktop/-mobile.png,
 *               shots/farmlife-inventory-desktop/-mobile.png.
 *
 * Run:  node farmlife/verify-p7.cjs        (from repo root)
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

const HOUR = 3_600_000;
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

async function bootPage(browser, opts) {
  opts = opts || {};
  const page = await browser.newPage();
  await page.setViewport({ width: opts.width || 1280, height: opts.height || 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.evaluateOnNewDocument((mobile) => {
    try { localStorage.clear(); localStorage.setItem("choreUser", "Eleanor"); } catch (_) {}
    if (mobile) {
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : orig(q));
    }
  }, !!opts.mobile);
  await page.setRequestInterception(true);
  // Deterministic OFF for fast-grow (test mode defaults ON) so growth timelines
  // read on the REAL clock in these suites. Merges over any existing tune.
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  page.on("request", (req) => {
    if (/playroom|googleapis|firestore|firebase|gstatic|open-meteo/i.test(req.url())) return req.abort();
    req.continue();
  });
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.farm && window.__FL__.mapinv, { timeout: 20000 });
  await sleep(600);
  // force local noon so shots aren't night-dark (verify-p6 convention)
  await page.evaluate(() => {
    const now = new Date();
    const target = new Date(now); target.setHours(12, 30, 0, 0);
    window.__FL__.farm._setTimeOffset(target.getTime() - now.getTime());
    window.__FL__.weather.applySky();
  });
  return { page, errors };
}

// projection math mirror (must match src/ui/mapProjection.ts + farmMap's pad = size*0.03)
function projFor(size, half) {
  const pad = size * 0.03;
  const scale = (size - pad * 2) / (half * 2);
  return { toX: (x) => pad + (x + half) * scale, toY: (z) => pad + (z + half) * scale };
}

async function mapPixel(page, wx, wz) {
  return page.evaluate((wx, wz) => {
    const cv = document.getElementById("fl-map-canvas");
    const size = cv.width;
    const pad = size * 0.03, half = 60;
    const scale = (size - pad * 2) / (half * 2);
    const mx = Math.round(pad + (wx + half) * scale);
    const my = Math.round(pad + (wz + half) * scale);
    const d = cv.getContext("2d").getImageData(mx, my, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  }, wx, wz);
}

// farming helpers (verify-p5/p6 pattern)
async function faceTile(page, gx, gz) {
  await page.evaluate((gx, gz) => {
    const ORIGIN_X = -6 - 12, ORIGIN_Z = 6 - 12, TILE = 2;
    const x = ORIGIN_X + TILE * (gx + 0.5), z = ORIGIN_Z + TILE * (gz + 0.5);
    window.__FL__.farm.teleport(x, z - 1.6);
    window.__FL__.farm.setHeading(0);
  }, gx, gz);
  // settle long enough for a fresh rAF updateTargeting to set `pending` on the
  // faced tile before act() fires (the helper otherwise races the frame loop —
  // this was a timing-margin flake, not a product bug; the ripen path is sound).
  await sleep(230);
}
async function act(page) {
  await page.evaluate(() => window.__FL__.farm.action());
  await page.waitForFunction(() => !window.__FL__.avatar.isBusy(), { timeout: 3000 }).catch(() => {});
  await sleep(120);
}
async function equip(page, tool) { await page.evaluate((t) => window.__FL__.farm.equip(t), tool); await sleep(60); }

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-gpu-vsync", "--autoplay-policy=no-user-gesture-required"],
  });

  try {
    // ======================= DESKTOP: MAP =======================
    console.log("\n=== (A) map open/close ===");
    const { page, errors } = await bootPage(browser, {});

    await page.click("#fl-mapbtn");
    await sleep(300);
    check("A1 map opens via 🗺 button", await page.evaluate(() => window.__FL__.mapinv.isMapOpen()));
    await page.click("#fl-map .x");
    await sleep(150);
    check("A2 map closes via ✖", !(await page.evaluate(() => window.__FL__.mapinv.isMapOpen())));
    await page.keyboard.press("Tab");
    await sleep(200);
    check("A3 map opens via Tab", await page.evaluate(() => window.__FL__.mapinv.isMapOpen()));
    await page.keyboard.press("Tab");
    await sleep(200);
    check("A4 map closes via Tab (toggle)", !(await page.evaluate(() => window.__FL__.mapinv.isMapOpen())));
    // tap-outside: open, then pointerdown on the backdrop itself
    await page.evaluate(() => window.__FL__.mapinv.openMap());
    await sleep(100);
    await page.evaluate(() => {
      const m = document.getElementById("fl-map");
      m.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    await sleep(100);
    check("A5 map closes via tap-outside", !(await page.evaluate(() => window.__FL__.mapinv.isMapOpen())));

    console.log("\n=== (B) map render ===");
    await page.evaluate(() => { window.__FL__.mapinv.openMap(); window.__FL__.mapinv.drawMapNow(); });
    await sleep(250);
    const blank = await page.evaluate(() => {
      const cv = document.getElementById("fl-map-canvas");
      const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4 * 53) seen.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
      return seen.size;
    });
    check("B1 canvas non-blank (distinct colors > 4)", blank > 4, blank);
    const grass = await mapPixel(page, -40, 40);
    check("B2 grass pixel green", grass.g > grass.r && grass.g > grass.b, JSON.stringify(grass));
    const pond = await mapPixel(page, 30, -26);
    check("B3 pond pixel blue", pond.b > pond.r && pond.b > 100, JSON.stringify(pond));
    const fieldPx = await mapPixel(page, -6, 6);
    check("B4 field footprint dirt-brown", fieldPx.r > fieldPx.b && fieldPx.r > 120, JSON.stringify(fieldPx));
    // grid inset: scan a horizontal line across the field — the 11 interior
    // tile-boundary lines each darken the dirt fill (visible "dips").
    const gridDips = await page.evaluate(() => {
      const cv = document.getElementById("fl-map-canvas");
      const size = cv.width, pad = size * 0.03, half = 60;
      const scale = (size - pad * 2) / (half * 2);
      const y = Math.round(pad + (5 + half) * scale); // mid-tile row (z=6 is itself a grid line)
      const x0 = Math.ceil(pad + (-6 - 12 + half) * scale) + 2;
      const x1 = Math.floor(pad + (-6 + 12 + half) * scale) - 2;
      const row = cv.getContext("2d").getImageData(x0, y, x1 - x0, 1).data;
      let dips = 0, inDip = false;
      for (let i = 0; i < row.length; i += 4) {
        const dark = row[i] < 150; // dirt fill r=169; grid-shaded ~<150
        if (dark && !inDip) { dips++; inDip = true; }
        if (!dark) inDip = false;
      }
      return dips;
    });
    check("B4b field tile-grid lines visible", gridDips >= 8, gridDips);
    const snap = await page.evaluate(() => window.__FL__.mapinv.mapSnapshot());
    check("B5 station markers present (stand+bin+house)", snap.stations.length === 3 && snap.stations.map((s) => s.emoji).join("") === "🏪📦🏠", JSON.stringify(snap.stations.map((s) => s.emoji)));
    check("B6 animals in snapshot (5 herd)", snap.animals.length === 5, snap.animals.length);
    const legend = await page.evaluate(() => document.querySelectorAll("#fl-map-legend > span").length);
    check("B7 legend rendered", legend >= 6, legend);

    console.log("\n=== (C) map live data ===");
    // plant tile (2,2): till -> plant turnip (5 starter seeds)
    await page.evaluate(() => window.__FL__.mapinv.closeMap());
    await faceTile(page, 2, 2);
    await equip(page, "hoe"); await act(page);
    await equip(page, "seeds"); await act(page);
    const tileState = await page.evaluate(() => window.__FL__.farm.tileAt(2, 2));
    check("C1 tile (2,2) planted turnip", tileState.crop === "turnip", JSON.stringify(tileState));
    // move the player clear of the field so the self-arrow doesn't cover the
    // sampled tile pixel (the arrow is ~17px, the tile ~9px on the map).
    await page.evaluate(() => { window.__FL__.farm.teleport(30, 30); window.__FL__.mapinv.openMap(); window.__FL__.mapinv.drawMapNow(); });
    // tile (2,2) world center: (-13, -1)  [ORIGIN(-18,-6) + 2*(2+0.5)]
    const growPx = await mapPixel(page, -13, -1);
    check("C2 planted tile shows growing-green on map", growPx.g > growPx.r && growPx.g > 100, JSON.stringify(growPx));
    // ripen the turnip (4h grow, 1h water window): growth PAUSES unwatered, so
    // bank 4 windows — advance the clock ~1h then water, four times.
    await page.evaluate(() => window.__FL__.mapinv.closeMap());
    await equip(page, "can");
    for (let i = 0; i < 4; i++) {
      await page.evaluate((h) => window.__FL__.farm._addTimeOffset(h), Math.round(1.05 * HOUR));
      await faceTile(page, 2, 2);
      await act(page); // water (banks the elapsed window)
    }
    const ripe = await page.evaluate(() => window.__FL__.farm.tileAt(2, 2));
    check("C2b turnip is ready after 4 watered hours", ripe.stage === "ready", JSON.stringify(ripe));
    await page.evaluate(() => { window.__FL__.farm.teleport(30, 30); window.__FL__.mapinv.openMap(); window.__FL__.mapinv.drawMapNow(); });
    const goldPx = await mapPixel(page, -13, -1);
    check("C3 ready tile flips to GOLD", goldPx.r > 190 && goldPx.g > 150 && goldPx.b < 140, JSON.stringify(goldPx));
    // pulsing: sample two phases via drawMapNow at different times — alpha varies with tSec;
    // prove via snapshot state rather than raced pixels:
    const snap2 = await page.evaluate(() => window.__FL__.mapinv.mapSnapshot());
    const readyTiles = snap2.tiles.filter((t) => t.state === "ready").length;
    check("C4 snapshot reports the ready tile", readyTiles === 1, readyTiles);

    // player arrow tracks position + facing
    await page.evaluate(() => { window.__FL__.farm.teleport(20, 30); window.__FL__.farm.setHeading(Math.PI / 2); window.__FL__.mapinv.drawMapNow(); });
    let selfDot = (await page.evaluate(() => window.__FL__.mapinv.mapSnapshot())).players.find((p) => p.self);
    check("C5 self dot at teleported pos", Math.abs(selfDot.x - 20) < 0.01 && Math.abs(selfDot.z - 30) < 0.01, JSON.stringify(selfDot));
    check("C6 self dot heading tracks facing", Math.abs(selfDot.heading - Math.PI / 2) < 0.01, selfDot.heading);
    await page.evaluate(() => { window.__FL__.farm.teleport(-30, -20); window.__FL__.farm.setHeading(3.0); window.__FL__.mapinv.drawMapNow(); });
    selfDot = (await page.evaluate(() => window.__FL__.mapinv.mapSnapshot())).players.find((p) => p.self);
    check("C7 self dot tracks a second move + turn", Math.abs(selfDot.x + 30) < 0.01 && Math.abs(selfDot.heading - 3.0) < 0.01, JSON.stringify(selfDot));
    // arrow pixel visible at the projected spot (white ring / red fill)
    const arrowPx = await mapPixel(page, -30, -20);
    check("C8 arrow drawn at player map spot", arrowPx.r > 150 || arrowPx.g > 200, JSON.stringify(arrowPx));
    // animals inside the pasture bounds (husbandry rework: rectangle, not a pen circle)
    const P = await page.evaluate(() => window.__FL__.animals.pastureBounds());
    const snap3 = await page.evaluate(() => window.__FL__.mapinv.mapSnapshot());
    const inPasture = snap3.animals.filter((a) => a.x >= P.minX - 0.5 && a.x <= P.maxX + 0.5 && a.z >= P.minZ - 0.5 && a.z <= P.maxZ + 0.5).length;
    check("C9 all animal dots within the pasture bounds", inPasture === snap3.animals.length, `${inPasture}/${snap3.animals.length}`);

    await page.evaluate(() => window.__FL__.mapinv.drawMapNow());
    await page.screenshot({ path: path.join(SHOTS, "farmlife-map-desktop.png") });
    console.log("  shot farmlife-map-desktop.png");
    await page.evaluate(() => window.__FL__.mapinv.closeMap());

    console.log("\n=== (D) inventory ===");
    // seed a known state: harvest the ready turnip; add crops/produce via hooks; buy nothing.
    await equip(page, "hands");
    await faceTile(page, 2, 2);
    await page.waitForFunction(() => {
      const t = window.__FL__.farm.target();
      return t && t.kind === "harvest";
    }, { timeout: 5000 }).catch(() => {});
    await act(page);
    const harvested = await page.evaluate(() => window.__FL__.farm.state().crops.turnip);
    check("D0 turnip harvested into inventory", harvested === 1, harvested);
    await page.evaluate(() => {
      window.__FL__.farm.addCrop("tomato", 3);
      window.__FL__.farm.addCrop("corn", 2);
    });
    // collect produce via animal hooks: force-ready by time offset already +5h; feed/collect goat
    await page.evaluate(() => window.__FL__.farm.equip("hands"));
    await page.click("#fl-invbtn");
    await sleep(250);
    check("D1 inventory opens via 🎒 button", await page.evaluate(() => window.__FL__.mapinv.isInventoryOpen()));
    // counts match FarmState exactly
    const inv = await page.evaluate(() => window.__FL__.mapinv.inventoryData());
    const st = await page.evaluate(() => window.__FL__.farm.state());
    const seedsMatch = inv.seeds.every((s) => s.count === st.seeds[s.id]);
    check("D2 seed rows match FarmState", seedsMatch, JSON.stringify(inv.seeds.map((s) => [s.id, s.count])));
    const turnipRow = inv.produce.find((p) => p.name === "Turnip");
    const tomatoRow = inv.produce.find((p) => p.name === "Tomato");
    check("D3 produce rows match (turnip 1, tomato 3, corn 2)",
      turnipRow && turnipRow.count === st.crops.turnip && tomatoRow && tomatoRow.count === 3 &&
      inv.produce.find((p) => p.name === "Corn").count === 2, JSON.stringify(inv.produce));
    const expectedTotal = st.crops.turnip * 18 + 3 * 62 + 2 * 75 +
      st.crops.potato * 42 + st.crops.pumpkin * 150 + st.crops.strawberry * 26 + st.crops.carrot * 32 + st.crops.sunflower * 110 +
      st.produce.milk * 40 + st.produce.egg * 15;
    check("D4 produce total-value math", inv.produceTotalValue === expectedTotal, `${inv.produceTotalValue} vs ${expectedTotal}`);
    const totalDom = await page.evaluate(() => (document.getElementById("fl-inv-total") || {}).textContent || "");
    check("D5 total line rendered in DOM", totalDom.includes(String(expectedTotal)), totalDom);
    check("D6 tank level in data", inv.tank === st.tank && inv.tankCap >= inv.tank, `${inv.tank}/${inv.tankCap}`);
    const tankDom = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("#fl-inv [data-tool='can']"));
      return rows.length ? rows[0].textContent : "";
    });
    check("D7 tank meter shown on can row", tankDom.includes("💧"), tankDom);

    // tap tomato seed row (must own; buy one first while shop closed via hook)
    await page.evaluate(() => window.__FL__.farm.buySeed("tomato"));
    await sleep(100);
    await page.evaluate(() => {
      const row = document.querySelector("#fl-inv [data-seed='tomato']");
      row.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    await sleep(200);
    const afterSel = await page.evaluate(() => ({
      tool: window.__FL__.farm.selectedTool(),
      crop: window.__FL__.farm.state().selectedCrop,
      hotbar: document.querySelector('.fl-slot[data-tool="seeds"] .em').textContent,
      open: window.__FL__.mapinv.isInventoryOpen(),
    }));
    check("D8 seed tap selects crop + equips seeds", afterSel.tool === "seeds" && afterSel.crop === "tomato", JSON.stringify(afterSel));
    check("D9 hotbar seed slot reflects tomato", afterSel.hotbar === "🍅", afterSel.hotbar);
    check("D10 panel closes after seed tap (documented UX)", afterSel.open === false);

    // I key toggle + live update while open
    await page.keyboard.press("i");
    await sleep(200);
    check("D11 inventory opens via I key", await page.evaluate(() => window.__FL__.mapinv.isInventoryOpen()));
    const beforeLive = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("#fl-inv .row"));
      const r = rows.find((x) => x.textContent.includes("Tomato") && x.textContent.includes("×"));
      return r ? r.textContent : "";
    });
    await page.evaluate(() => window.__FL__.farm.addCrop("tomato", 4)); // 3 -> 7
    await sleep(400); // frame loop refresh
    const afterLive = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("#fl-inv .row"));
      const r = rows.find((x) => x.textContent.includes("Tomato") && x.textContent.includes("×"));
      return r ? r.textContent : "";
    });
    check("D12 live update while open (tomato ×3 → ×7)", beforeLive.includes("×3") && afterLive.includes("×7"), `${beforeLive} → ${afterLive}`);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-inventory-desktop.png") });
    console.log("  shot farmlife-inventory-desktop.png");
    await page.keyboard.press("i");
    await sleep(150);
    check("D13 inventory closes via I key", !(await page.evaluate(() => window.__FL__.mapinv.isInventoryOpen())));
    // tool equip row
    await page.evaluate(() => window.__FL__.mapinv.openInventory());
    await sleep(150);
    await page.evaluate(() => {
      document.querySelector("#fl-inv [data-tool='hoe']").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    await sleep(150);
    check("D14 tool row equips + closes", (await page.evaluate(() => window.__FL__.farm.selectedTool())) === "hoe" && !(await page.evaluate(() => window.__FL__.mapinv.isInventoryOpen())));

    check("D15 desktop 0 pageerrors", errors.length === 0, errors.join(" | "));
    await page.close();

    // ======================= MOBILE 390x844 =======================
    console.log("\n=== (E) mobile 390x844 ===");
    const m = await bootPage(browser, { width: 390, height: 844, mobile: true });
    check("E1 mobile mode active", await m.page.evaluate(() => document.body.classList.contains("fl-mobile")));
    // buttons visible + not overlapping the core touch controls
    const rects = await m.page.evaluate(() => {
      const r = (id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return b.width > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
      };
      return { inv: r("fl-invbtn"), map: r("fl-mapbtn"), hotbar: r("fl-hotbar"), action: r("fl-actionbtn"), jump: r("fl-jumpbtn"), emote: r("fl-emotebtn"), book: r("fl-bookbtn") };
    });
    const overlap = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    check("E2 🎒 present, clear of hotbar", rects.inv && !overlap(rects.inv, rects.hotbar), JSON.stringify([rects.inv, rects.hotbar]));
    check("E3 🎒 clear of action/jump (right thumb)", !overlap(rects.inv, rects.action) && !overlap(rects.inv, rects.jump));
    check("E4 🗺 present, clear of book/emote", rects.map && !overlap(rects.map, rects.book) && !overlap(rects.map, rects.emote), JSON.stringify([rects.map, rects.book]));

    await m.page.click("#fl-mapbtn");
    await sleep(250);
    await m.page.evaluate(() => window.__FL__.mapinv.drawMapNow());
    const mapCard = await m.page.evaluate(() => {
      const c = document.querySelector("#fl-map .card").getBoundingClientRect();
      return { w: c.width, h: c.height, vw: innerWidth, vh: innerHeight };
    });
    check("E5 map is full-screen-ish sheet on mobile", mapCard.w >= mapCard.vw - 2 && mapCard.h >= mapCard.vh - 2, JSON.stringify(mapCard));
    await m.page.screenshot({ path: path.join(SHOTS, "farmlife-map-mobile.png") });
    console.log("  shot farmlife-map-mobile.png");
    await m.page.evaluate(() => window.__FL__.mapinv.closeMap());
    await sleep(150);

    await m.page.evaluate(() => { window.__FL__.farm.addCrop("corn", 2); window.__FL__.mapinv.openInventory(); });
    await sleep(250);
    const invCard = await m.page.evaluate(() => {
      const c = document.querySelector("#fl-inv .card").getBoundingClientRect();
      const close = document.querySelector("#fl-inv button.close").getBoundingClientRect();
      return { w: c.width, h: c.height, vw: innerWidth, vh: innerHeight, closeH: close.height, closeVisible: close.bottom <= innerHeight };
    });
    check("E6 inventory fits mobile viewport, close reachable", invCard.w <= invCard.vw && invCard.h <= invCard.vh && invCard.closeVisible && invCard.closeH >= 30, JSON.stringify(invCard));
    await m.page.screenshot({ path: path.join(SHOTS, "farmlife-inventory-mobile.png") });
    console.log("  shot farmlife-inventory-mobile.png");
    check("E7 mobile 0 pageerrors", m.errors.length === 0, m.errors.join(" | "));
    await m.page.close();
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  const fails = results.filter((r) => !r.ok);
  console.log(`\n==== P7 RESULT: ${results.length - fails.length}/${results.length} passed ====`);
  if (fails.length) {
    for (const f of fails) console.log("  FAILED: " + f.name);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
