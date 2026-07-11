#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life P5 — content pass: 4 new crops (8 total),
 * kid-placeable decorations, farm milestones + shipped totals.
 *
 * Sections:
 *  (1) OFFLINE solo (Firebase+Playroom+open-meteo blocked): shop shows 8 crops
 *      (scrollable) + 8 decorations; buy the 4 new seeds; grow/harvest/sell a
 *      strawberry; placement mode ghost valid-on-grass / invalid-on-field /
 *      invalid-on-pond; place + rotate decorations; 2-tap remove state machine;
 *      milestone flip (10th turnip) fires once, does NOT re-fire on the 11th.
 *      Screenshots: shop (Decorate tab), decorated corner, Farm Book.
 *  (1b) OFFLINE reload — a placed decoration persists to localStorage.
 *  (5) REAL Firestore (?fam=famtestfl ONLY) — two devices: A places a bench, B
 *      sees it live; A sells -> meta shipped increments (asserted on the doc);
 *      two near-simultaneous sells sum ATOMICALLY (proves increment()). All test
 *      docs deleted + emptiness confirmed.
 *
 * Run:  node farmlife/verify-p5.cjs        (from repo root)
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

const PROJECT_ID = "amen-farms-app";
const API_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const REST_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const FAM = "famtestfl";

const HOUR = 3_600_000;

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail == null ? "" : String(detail) });
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

// ---- Firestore REST helpers (public rules, same as verify-p4.cjs) ----------
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

async function blockEverything(page) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (/playroom|googleapis|firestore|firebase|gstatic|open-meteo/i.test(u)) return req.abort();
    req.continue();
  });
}

async function bootPage(browser, opts) {
  opts = opts || {};
  const page = await browser.newPage();
  await page.setViewport({ width: opts.width || 1280, height: opts.height || 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  if (opts.blockAll) await blockEverything(page);
  if (opts.persistReload) {
    // clear localStorage only on the FIRST load (sessionStorage survives reload
    // in the same tab), so a reload keeps what the app persisted.
    await page.evaluateOnNewDocument(() => {
      try {
        if (!sessionStorage.getItem("__p5cleared")) {
          localStorage.clear();
          sessionStorage.setItem("__p5cleared", "1");
        }
      } catch (_) {}
    });
  } else {
    await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (_) {} });
  }
  // Deterministic OFF for fast-grow (after any clear above; test mode defaults ON).
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  const url = opts.fam ? `${URL}?fam=${opts.fam}` : URL;
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.farm && typeof window.__FL__.farm.state === "function", { timeout: 20000 });
  await page.waitForFunction(() => window.__FL__.decor && window.__FL__.meta, { timeout: 20000 });
  await sleep(500);
  return { page, errors };
}

async function equip(page, tool) {
  await page.evaluate((t) => window.__FL__.farm.equip(t), tool);
  await sleep(50);
}
async function faceTile(page, gx, gz) {
  await page.evaluate((gx, gz) => {
    const FL = window.__FL__;
    const ORIGIN_X = -6 - 12, ORIGIN_Z = 6 - 12, TILE = 2;
    const x = ORIGIN_X + TILE * (gx + 0.5), z = ORIGIN_Z + TILE * (gz + 0.5);
    FL.farm.teleport(x, z - 1.6);
    FL.farm.setHeading(0);
  }, gx, gz);
  await sleep(120);
}
async function waitIdle(page) {
  await page.waitForFunction(() => !window.__FL__.avatar.isBusy(), { timeout: 3000 }).catch(() => {});
}
async function act(page) {
  await page.evaluate(() => window.__FL__.farm.action());
  await waitIdle(page);
}
/** Stand at the bin and wait for pending=sell before acting. bringToFront is
 * REQUIRED in multi-page tests: a backgrounded page's rAF is throttled so
 * updateTargeting never refreshes `pending` (CLAUDE.md two-tab-rAF gotcha). */
async function armSellAtBin(page) {
  await page.bringToFront();
  const bin = await page.evaluate(() => window.__FL__.farm.binPos);
  await page.evaluate((x, z) => window.__FL__.farm.teleport(x, z), bin.x, bin.z);
  await page.waitForFunction(() => {
    const t = window.__FL__.farm.target();
    return t && t.kind === "sell";
  }, { timeout: 5000 }).catch(() => {});
}
async function sellAtBin(page) {
  await armSellAtBin(page);
  await page.evaluate(() => window.__FL__.farm.action());
  await sleep(150);
}

/** Stand so the placement ghost target (2.4 m ahead, heading 0 -> +z) lands on
 * (x,z), then buy `type`, read validity, and confirm if valid (else cancel). */
async function placeDecor(page, type, x, z) {
  await page.bringToFront(); // rAF must run for updatePlacementGhost validity
  await page.evaluate((x, z) => {
    window.__FL__.farm.teleport(x, z - 2.4);
    window.__FL__.farm.setHeading(0);
  }, x, z);
  await sleep(140);
  await page.evaluate((t) => window.__FL__.decor.buy(t), type);
  await sleep(220); // a few render frames so updatePlacementGhost runs
  const valid = await page.evaluate(() => { const p = window.__FL__.decor.placing(); return p ? p.valid : null; });
  if (valid) await page.evaluate(() => window.__FL__.decor.confirm());
  else await page.evaluate(() => window.__FL__.decor.cancel());
  await sleep(100);
  return valid;
}

async function growHarvestSell(page, gx, gz, crop, growMs, waterEveryMs) {
  await equip(page, "hoe");
  await faceTile(page, gx, gz);
  await act(page); // till
  await equip(page, "seeds");
  await page.evaluate((c) => window.__FL__.farm.selectCrop(c), crop);
  const seeds = await page.evaluate((c) => window.__FL__.farm.state().seeds[c], crop);
  if (seeds < 1) await page.evaluate((c) => window.__FL__.farm.buySeed(c), crop);
  await faceTile(page, gx, gz);
  await act(page); // plant
  // water to ready: each waterEveryMs the tile goes thirsty; water banks it.
  await equip(page, "can");
  for (let t = 0; t <= growMs; t += waterEveryMs) {
    await page.evaluate((ms) => window.__FL__.farm._addTimeOffset(ms), waterEveryMs);
    await faceTile(page, gx, gz);
    await act(page); // water (no-op hint once ready)
    const tile = await page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), gx, gz);
    if (tile && tile.stage === "ready") break;
  }
  const readyTile = await page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), gx, gz);
  await equip(page, "hands");
  await faceTile(page, gx, gz);
  await act(page); // harvest
  const crops = await page.evaluate((c) => window.__FL__.farm.state().crops[c], crop);
  await sellAtBin(page);
  return { readyStage: readyTile && readyTile.stage, harvested: crops };
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
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-gpu-vsync"],
  });

  // ============================= (1) OFFLINE SOLO =============================
  console.log("\n=== (1) offline solo — crops, decorations, milestones (all networks blocked) ===");
  {
    const { page, errors } = await bootPage(browser, { blockAll: true, width: 390, height: 844 });

    // -- fund coins by selling some corn (also seeds the corn shipped total) --
    await page.evaluate(() => window.__FL__.farm.addCrop("corn", 5));
    await sellAtBin(page);
    const coins = await page.evaluate(() => window.__FL__.farm.state().coins);
    check("funded coins by selling 5 corn (>300)", coins > 300, `coins=${coins}`);

    // -- shop: 8 crops (scrollable) + 8 decorations --
    const stand = await page.evaluate(() => window.__FL__.farm.standPos);
    await page.evaluate((x, z) => window.__FL__.farm.teleport(x, z), stand.x, stand.z);
    await sleep(400);
    const shopOpen = await page.evaluate(() => window.__FL__.farm.isShopOpen());
    check("shop auto-opens near the seed stand", shopOpen === true);
    const seedRows = await page.evaluate(() => document.querySelectorAll("#fl-shop-rows .row").length);
    check("Seeds tab shows all 8 crops", seedRows === 8, `rows=${seedRows}`);
    const overflow = await page.evaluate(() => getComputedStyle(document.querySelector("#fl-shop-rows")).overflowY);
    check("shop rows container is internally scrollable (overflow-y auto/scroll)", /auto|scroll/.test(overflow), overflow);
    const notClipped = await page.evaluate(() => {
      const el = document.querySelector("#fl-shop-rows");
      const card = document.querySelector("#fl-shop .card");
      return el.getBoundingClientRect().bottom <= window.innerHeight && card.getBoundingClientRect().bottom <= window.innerHeight;
    });
    check("shop card fits within the 390×844 viewport (not clipped)", notClipped === true);
    await page.evaluate(() => document.querySelector('#fl-shop .tab[data-tab="decor"]').click());
    await sleep(120);
    const decorRows = await page.evaluate(() => document.querySelectorAll("#fl-shop-rows .row").length);
    check("Decorate tab shows all 8 decorations", decorRows === 8, `rows=${decorRows}`);
    try { await page.screenshot({ path: path.join(SHOTS, "farmlife-p5-shop.png") }); } catch (_) {}
    await page.evaluate(() => window.__FL__.farm.closeShop());
    await sleep(100);

    // -- buy the 4 NEW seed types --
    for (const c of ["strawberry", "carrot", "tomato", "sunflower"]) {
      const before = await page.evaluate((c) => window.__FL__.farm.state().seeds[c], c);
      await page.evaluate((c) => window.__FL__.farm.buySeed(c), c);
      const after = await page.evaluate((c) => window.__FL__.farm.state().seeds[c], c);
      check(`buy ${c} seed (+1)`, after === before + 1, `${before}->${after}`);
    }

    // -- grow / harvest / sell a strawberry (new crop full loop) --
    const straw = await growHarvestSell(page, 6, 6, "strawberry", 6 * HOUR, 1.5 * HOUR);
    check("strawberry reached ready via watering", straw.readyStage === "ready", JSON.stringify(straw));
    check("strawberry harvested (+1 in inventory before sale)", straw.harvested === 1, `harvested=${straw.harvested}`);
    const shippedStraw = await page.evaluate(() => window.__FL__.meta.shipped().strawberry || 0);
    check("selling the strawberry incremented shipped_strawberry", shippedStraw === 1, `shipped=${shippedStraw}`);
    const firstHarvest = await page.evaluate(() => window.__FL__.meta.milestones().firstHarvest || 0);
    check("First Harvest milestone flipped", firstHarvest > 0, `ts=${firstHarvest}`);

    // -- placement validity: grass valid, field invalid, pond invalid --
    // buy a gnome, then move around and read the live ghost validity.
    await page.evaluate(() => { window.__FL__.farm.teleport(42, 40); window.__FL__.farm.setHeading(0); });
    await sleep(120);
    await page.evaluate(() => window.__FL__.decor.buy("gnome"));
    await sleep(220);
    const validGrass = await page.evaluate(() => window.__FL__.decor.placing()?.valid);
    check("ghost is VALID (green) aimed at open grass", validGrass === true);
    // aim at the farming field (target lands inside FIELD)
    await page.evaluate(() => { window.__FL__.farm.teleport(-6, 6 - 2.4); window.__FL__.farm.setHeading(0); });
    await sleep(200);
    const invalidField = await page.evaluate(() => window.__FL__.decor.placing()?.valid);
    check("ghost is INVALID aimed at the farming field", invalidField === false);
    // aim at the pond
    const pond = await page.evaluate(() => window.__FL__.farm.pondPos);
    await page.evaluate((p) => { window.__FL__.farm.teleport(p.x, p.z - 2.4); window.__FL__.farm.setHeading(0); }, pond);
    await sleep(200);
    const invalidPond = await page.evaluate(() => window.__FL__.decor.placing()?.valid);
    check("ghost is INVALID aimed at the pond", invalidPond === false);
    // back to grass and confirm the gnome
    await page.evaluate(() => { window.__FL__.farm.teleport(42, 40); window.__FL__.farm.setHeading(0); });
    await sleep(200);
    await page.evaluate(() => window.__FL__.decor.confirm());
    await sleep(120);
    const count1 = await page.evaluate(() => window.__FL__.decor.count());
    check("placed a gnome (decor count 1)", count1 === 1, `count=${count1}`);
    const firstDecor = await page.evaluate(() => window.__FL__.meta.milestones().firstDecoration || 0);
    check("First Decoration milestone flipped", firstDecor > 0, `ts=${firstDecor}`);

    // -- rotate applies (rotY changes) --
    await page.evaluate(() => { window.__FL__.farm.teleport(44, 40); window.__FL__.farm.setHeading(0); });
    await sleep(120);
    await page.evaluate(() => window.__FL__.decor.buy("scarecrow"));
    await sleep(200);
    const rot0 = await page.evaluate(() => window.__FL__.decor.placing()?.rotY);
    await page.evaluate(() => window.__FL__.decor.rotate(1));
    await sleep(80);
    const rot1 = await page.evaluate(() => window.__FL__.decor.placing()?.rotY);
    check("rotate changes the ghost rotation", rot1 !== rot0, `${rot0}->${rot1}`);
    await page.evaluate(() => window.__FL__.decor.confirm());
    await sleep(120);

    // -- a couple more for the decorated-corner shot --
    await placeDecor(page, "bench", 41, 44);
    await placeDecor(page, "pinwheel", 45, 44);
    const count4 = await page.evaluate(() => window.__FL__.decor.count());
    check("four decorations placed for the shot", count4 === 4, `count=${count4}`);
    await page.evaluate(() => { window.__FL__.farm.teleport(43, 34); window.__FL__.farm.setHeading(0); });
    await sleep(300);
    try { await page.screenshot({ path: path.join(SHOTS, "farmlife-p5-decor.png") }); } catch (_) {}

    // -- 2-tap remove state machine (hands tool aimed at the gnome) --
    // the gnome sits 2.4 m ahead of where the player stood at confirm -> (42, 42.4);
    // stand 1.8 m south of it, facing +z, to bring it into reach.
    await equip(page, "hands");
    await page.evaluate(() => { window.__FL__.farm.teleport(42, 42.4 - 1.8); window.__FL__.farm.setHeading(0); });
    await sleep(250);
    const remTarget = await page.evaluate(() => window.__FL__.decor.target());
    check("hands near a decoration targets it for removal", remTarget && /Remove/.test(remTarget.label), JSON.stringify(remTarget));
    const beforeRemove = await page.evaluate(() => window.__FL__.decor.count());
    await page.evaluate(() => window.__FL__.decor.action()); // FIRST tap — arms, does NOT remove
    await sleep(120);
    const afterFirst = await page.evaluate(() => window.__FL__.decor.count());
    const armed = await page.evaluate(() => window.__FL__.decor.removeArmed());
    check("first tap arms the confirm, does NOT remove", afterFirst === beforeRemove && !!armed, `count ${beforeRemove}->${afterFirst} armed=${JSON.stringify(armed)}`);
    await page.evaluate(() => window.__FL__.decor.action()); // SECOND tap within window — removes
    await sleep(150);
    const afterSecond = await page.evaluate(() => window.__FL__.decor.count());
    check("second tap within the window removes it (count -1)", afterSecond === beforeRemove - 1, `count ${afterFirst}->${afterSecond}`);
    // window expiry: re-arm on a fresh target then let it lapse -> a new first tap is needed
    await page.evaluate(() => { window.__FL__.farm.teleport(44, 42.4 - 1.8); window.__FL__.farm.setHeading(0); }); // the scarecrow at (44,42.4)
    await sleep(250);
    await page.evaluate(() => window.__FL__.decor.action()); // arm
    await sleep(120);
    const armedBefore = await page.evaluate(() => !!window.__FL__.decor.removeArmed());
    // simulate the 2.5s window lapsing by NOT tapping; re-read after the window
    await sleep(2700);
    const cntBeforeLapsedTap = await page.evaluate(() => window.__FL__.decor.count());
    await page.evaluate(() => window.__FL__.decor.action()); // this is a FRESH first tap (window lapsed) -> re-arms, no remove
    await sleep(120);
    const cntAfterLapsedTap = await page.evaluate(() => window.__FL__.decor.count());
    check("an expired arm needs a fresh first tap (a lone tap after lapse does NOT remove)", armedBefore && cntAfterLapsedTap === cntBeforeLapsedTap, `armed=${armedBefore} count ${cntBeforeLapsedTap}->${cntAfterLapsedTap}`);

    // -- milestone: 10th turnip shipped flips once, 11th does NOT re-fire --
    await page.evaluate(() => window.__FL__.farm.addCrop("turnip", 10));
    await sellAtBin(page);
    const shipT = await page.evaluate(() => window.__FL__.meta.shipped().turnip || 0);
    const tenTs = await page.evaluate(() => window.__FL__.meta.milestones().tenTurnips || 0);
    check("10th turnip: shipped_turnip === 10 and 10 Turnips milestone flipped", shipT === 10 && tenTs > 0, `shipped=${shipT} ts=${tenTs}`);
    await page.evaluate(() => window.__FL__.farm.addCrop("turnip", 1));
    await sellAtBin(page);
    const shipT2 = await page.evaluate(() => window.__FL__.meta.shipped().turnip || 0);
    const tenTs2 = await page.evaluate(() => window.__FL__.meta.milestones().tenTurnips || 0);
    check("11th turnip: total 11 but milestone timestamp UNCHANGED (no re-fire)", shipT2 === 11 && tenTs2 === tenTs, `shipped=${shipT2} ts=${tenTs2}`);

    // -- Farm Book shows earned milestones --
    await page.evaluate(() => window.__FL__.meta.openBook());
    await sleep(150);
    const bookOpen = await page.evaluate(() => window.__FL__.meta.bookOpen());
    const earnedCount = await page.evaluate(() => window.__FL__.meta.bookMilestonesEarned());
    check("Farm Book opens and shows >=3 earned milestones (harvest/decoration/turnips)", bookOpen && earnedCount >= 3, `open=${bookOpen} earned=${earnedCount}`);
    try { await page.screenshot({ path: path.join(SHOTS, "farmlife-p5-book.png") }); } catch (_) {}

    await sleep(200);
    check("(1) 0 pageerrors", errors.filter((e) => !/favicon/i.test(e)).length === 0, errors.join(" | "));
    await page.close();
  }

  // ============================= (1b) OFFLINE RELOAD PERSIST =============================
  console.log("\n=== (1b) offline reload — a placed decoration persists to localStorage ===");
  {
    const { page, errors } = await bootPage(browser, { blockAll: true, persistReload: true });
    const placed = await placeDecor(page, "birdbath", 42, 40);
    check("placed a bird bath on grass (valid)", placed === true);
    const beforeReload = await page.evaluate(() => window.__FL__.decor.count());
    await page.evaluate(() => window.__FL__.decor.flushSave());
    await sleep(200);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.__FL__ && window.__FL__.decor && typeof window.__FL__.decor.count === "function", { timeout: 20000 });
    await sleep(600);
    const afterReload = await page.evaluate(() => window.__FL__.decor.count());
    const types = await page.evaluate(() => window.__FL__.decor.types());
    check("decoration survived a reload (count preserved)", afterReload === beforeReload && afterReload >= 1, `before=${beforeReload} after=${afterReload}`);
    check("the persisted decoration is a bird bath", types.includes("birdbath"), JSON.stringify(types));
    check("(1b) 0 pageerrors", errors.filter((e) => !/favicon/i.test(e)).length === 0, errors.join(" | "));
    await page.close();
  }

  // ============================= (5) REAL FIRESTORE, TWO DEVICES =============================
  console.log("\n=== (5) real Firestore (?fam=famtestfl) — decor sync + atomic shipped increments ===");
  {
    const preDel = await restDeleteCollection(`farmlife_${FAM}`);
    console.log(`pre-flight: removed ${preDel} doc(s) from farmlife_${FAM}`);

    const A = await bootPage(browser, { fam: FAM });
    let aCloud = false;
    try {
      await A.page.waitForFunction(() => window.__FL__.decor.isCloud() === true && window.__FL__.meta.isCloud() === true, { timeout: 25000 });
      aCloud = true;
    } catch (_) {}
    check("device A: cloud decor + meta stores reachable", aCloud);

    if (aCloud) {
      const B = await bootPage(browser, { fam: FAM });
      await B.page.waitForFunction(() => window.__FL__.decor.isCloud && window.__FL__.decor.isCloud() === true, { timeout: 25000 }).catch(() => {});
      await sleep(500);

      // -- A places a bench -> B sees it live --
      const placed = await placeDecor(A.page, "bench", 40, 42);
      check("device A placed a bench (valid grass)", placed === true);
      await A.page.evaluate(() => window.__FL__.decor.flushSave());
      let bSaw = false;
      try {
        await B.page.waitForFunction(() => window.__FL__.decor.types().includes("bench"), { timeout: 15000, polling: 500 });
        bSaw = true;
      } catch (_) {}
      check("device B sees A's bench via Firestore decor sync", bSaw);

      // -- A sells 3 turnips -> meta shipped_turnip increments on the doc --
      const readShip = async () => {
        const d = await restGetDoc(`farmlife_${FAM}`, "meta");
        return d && d.shipped_turnip ? d.shipped_turnip : 0;
      };
      const pollShip = async (target, ms) => {
        const t0 = Date.now();
        let v = 0;
        while (Date.now() - t0 < ms) {
          v = await readShip();
          if (v >= target) return v;
          await sleep(500);
        }
        return v;
      };
      await A.page.evaluate(() => window.__FL__.farm.addCrop("turnip", 3));
      await sellAtBin(A.page);
      await A.page.evaluate(() => window.__FL__.meta.flushSave());
      const base = await pollShip(3, 10000);
      check("meta doc shipped_turnip reflects A's 3-turnip sale", base === 3, `shipped_turnip=${base}`);

      // -- two near-simultaneous sells sum ATOMICALLY (increment() proof) --
      const cur = await readShip(); // whatever's there now (should be 3)
      await A.page.evaluate(() => window.__FL__.farm.addCrop("turnip", 2));
      await B.page.evaluate(() => window.__FL__.farm.addCrop("turnip", 3));
      // Arm BOTH pendings to 'sell' (each focused in turn); the stale-but-correct
      // 'sell' pending survives being backgrounded, so both actions still fire.
      await armSellAtBin(A.page);
      await armSellAtBin(B.page);
      await Promise.all([
        A.page.evaluate(() => window.__FL__.farm.action()),
        B.page.evaluate(() => window.__FL__.farm.action()),
      ]);
      await sleep(200);
      await Promise.all([
        A.page.evaluate(() => window.__FL__.meta.flushSave()),
        B.page.evaluate(() => window.__FL__.meta.flushSave()),
      ]);
      // if increment() weren't atomic, one write would clobber the other and this
      // would stall at cur+2 or cur+3 (5 or 6) and time out; atomic -> cur+5 (8).
      const finalT = await pollShip(cur + 5, 12000);
      check("concurrent A(+2)+B(+3) sells summed atomically to base+5 (increment() is race-free)", finalT === cur + 5, `cur=${cur} expected=${cur + 5} actual=${finalT}`);

      await B.page.close();
    }
    await A.page.close();

    // ---- cleanup ----
    console.log("\n=== cleanup ===");
    const del = await restDeleteCollection(`farmlife_${FAM}`);
    console.log(`deleted ${del} doc(s)`);
    const remaining = await restListDocs(`farmlife_${FAM}`);
    check(`cleanup: farmlife_${FAM} empty`, remaining.length === 0, `remaining=${remaining.length}`);
  }

  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  console.log("shots: shots/farmlife-p5-shop.png, shots/farmlife-p5-decor.png, shots/farmlife-p5-book.png");
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
