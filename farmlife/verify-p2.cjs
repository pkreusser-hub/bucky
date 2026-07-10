#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life P2 — the persistent shared world.
 * Runs against the REAL Firestore project (amen-farms-app), scoped ENTIRELY
 * to test family collections via the `?fam=` override (never production —
 * herd-dup lesson, see CLAUDE.md). Every doc this script creates is deleted
 * via the Firestore REST API at the end, and the test collections' emptiness
 * is asserted and printed.
 *
 * Test families used (isolated from each other and from production):
 *   famtestfl          — main flow (a-e): till/plant/water/harvest sync,
 *                         two "devices" (browser contexts) as TesterA/TesterB,
 *                         plus a world-editor round trip.
 *   famtestfl2         — migration-only (f): a fresh device with a pre-P2
 *                         local save + an empty cloud farm.
 *
 * Run:  node farmlife/verify-p2.cjs        (from repo root)
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
const GAME_URL = BASE + "/farmlife/dist/index.html";
const EDITOR_URL = BASE + "/farmlife/dist/editor.html";

require("fs").mkdirSync(SHOTS, { recursive: true });

const PROJECT_ID = "amen-farms-app";
const API_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const REST_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const FAM = "famtestfl";
const FAM_MIGRATE = "famtestfl2";

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

// ---- Firestore REST helpers (public rules, house convention — see CLAUDE.md
// "HERD DUPLICATION" entries: REST GET/DELETE with the web API key) ----------
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
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`restListDocs ${collection}: HTTP ${res.status}`);
    }
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
  if (!res.ok) throw new Error(`restGetDoc ${collection}/${id}: HTTP ${res.status}`);
  const data = await res.json();
  return decodeFields(data.fields || {});
}
async function restDeleteDoc(collection, id) {
  await fetch(`${REST_BASE}/${collection}/${id}?key=${API_KEY}`, { method: "DELETE" });
}
async function restDeleteCollection(collection) {
  const docs = await restListDocs(collection);
  for (const d of docs) {
    const id = d.name.split("/").pop();
    await restDeleteDoc(collection, id);
  }
  return docs.length;
}

// ---- page helpers (mirrors verify-p1.cjs's tile-math helpers) --------------
async function newDevice(browser, { mobile } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 });
  // P2 is a pure-Firestore test — presence (P3/Playroom) is disabled via the
  // ?nopresence flag added to the game URLs below, so no Playroom connect and
  // no lobby doc is ever created here (Firestore/gstatic untouched).
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  return { ctx, page, errors };
}
async function gotoGame(page, name, fam) {
  await page.evaluateOnNewDocument((n) => { try { localStorage.setItem("choreUser", n); } catch (_) {} }, name);
  // Deterministic OFF for fast-grow (test mode defaults ON) so growth timelines
  // read on the REAL clock in these suites.
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  await page.goto(`${GAME_URL}?fam=${fam}&nopresence=1`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.net && typeof window.__FL__.net.ready === "function", { timeout: 20000 });
}
async function waitCloud(page, timeout = 20000) {
  const ok = await page.evaluate(() => window.__FL__.net.ready());
  if (!ok) return false;
  try {
    await page.waitForFunction(() => window.__FL__.net.isCloud() === true, { timeout });
  } catch (_) {
    return false;
  }
  return true;
}
// Chrome throttles/pauses requestAnimationFrame on backgrounded tabs (house
// lesson, see CLAUDE.md Barnyard-Bistro notes: "two-tab MP tests freeze rAF
// in background tabs"). This test drives FIVE pages round-robin in one
// browser, so every interaction that depends on the live render loop
// (targeting/pending is recomputed inside frame()) must foreground its page
// first or the game's `pending` target goes stale mid-test.
async function focus(page) {
  await page.bringToFront().catch(() => {});
  await sleep(30);
}
async function faceTile(page, gx, gz) {
  await focus(page);
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
  await focus(page);
  await page.evaluate((t) => window.__FL__.farm.equip(t), tool);
  await sleep(60);
}
async function waitIdle(page) {
  await page.waitForFunction(() => !window.__FL__.avatar.isBusy(), { timeout: 3000 }).catch(() => {});
}
async function act(page) {
  await focus(page);
  await page.evaluate(() => window.__FL__.farm.action());
  await waitIdle(page);
}
async function flushCloud(page) {
  await page.evaluate(() => window.__FL__.net.flush()); // now awaits the actual network write
  await sleep(150); // small settle margin
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);

  // Pre-flight: make sure both test families start CLEAN (a stale run's docs
  // would corrupt this run's "empty on boot" assertions).
  const pre1 = await restDeleteCollection(`farmlife_${FAM}`);
  const pre2 = await restDeleteCollection(`farmlife_${FAM_MIGRATE}`);
  console.log(`pre-flight cleanup: removed ${pre1} stale doc(s) from farmlife_${FAM}, ${pre2} from farmlife_${FAM_MIGRATE}`);

  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  // ============================= (a) Device A boots empty =============================
  console.log("\n=== (a) Device A boots on an empty farm + empty local ===");
  const A = await newDevice(browser);
  await gotoGame(A.page, "TesterA", FAM);
  const aReady = await waitCloud(A.page);
  check("device A: cloud store ready + active", aReady);

  await sleep(5000); // idle — only the legitimate P4/P5 boot-time seed docs should appear
  const emptyCheck = await restListDocs(`farmlife_${FAM}`);
  const emptyIds = emptyCheck.map((d) => d.name.split("/").pop()).sort();
  const animalsDoc = emptyCheck.find((d) => d.name.split("/").pop() === "animals");
  const animalsFields = animalsDoc ? Object.keys(animalsDoc.fields || {}) : [];
  const animalsAFields = animalsFields.filter((k) => k.startsWith("a_"));
  check(
    "empty farm + empty local -> only the seeded animals+meta docs after 5s idle (no region_*/player_* writes)",
    emptyIds.length === 2 && emptyIds[0] === "animals" && emptyIds[1] === "meta" && animalsAFields.length === 5,
    `docs=${JSON.stringify(emptyIds)} animalsFields=${JSON.stringify(animalsAFields.sort())}`
  );

  // ============================= (b) A tills + plants =============================
  console.log("\n=== (b) A tills + plants a tile -> region doc gains exactly the expected fields ===");
  const GX = 6, GZ = 6;
  await equip(A.page, "hoe");
  await faceTile(A.page, GX, GZ);
  await act(A.page);
  await equip(A.page, "seeds");
  await faceTile(A.page, GX, GZ);
  await act(A.page);
  await flushCloud(A.page);

  const region00 = await restGetDoc(`farmlife_${FAM}`, "region_0_0");
  const wireTile = region00 && region00["t_6_6"];
  check(
    "region_0_0 doc has t_6_6 with exactly {crop,plantedAt,accruedMs,lastWatered}",
    wireTile && wireTile.crop === "turnip" && Object.keys(wireTile).sort().join(",") === "accruedMs,crop,lastWatered,plantedAt",
    JSON.stringify(wireTile)
  );

  // ============================= (c) Device B sees it live, waters =============================
  console.log("\n=== (c) Device B boots, sees A's planted tile, waters it; A gets the live update ===");
  const B = await newDevice(browser);
  await gotoGame(B.page, "TesterB", FAM);
  const bReady = await waitCloud(B.page);
  check("device B: cloud store ready + active", bReady);

  const bSeesTile = await B.page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), GX, GZ);
  check("device B sees A's planted turnip on boot (no reload needed)", bSeesTile && bSeesTile.crop === "turnip", JSON.stringify(bSeesTile));

  // A freshly-planted tile is within its free grace window (see growth.ts
  // docstring) — not yet "thirsty", so watering it immediately is a no-op by
  // design. Advance B's local clock hook past waterEveryMs first, same as the
  // P1 loop, so the water action actually has something to do.
  const HOUR0 = 3_600_000;
  const beforeWater = await A.page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), GX, GZ);
  await B.page.evaluate((ms) => window.__FL__.farm._addTimeOffset(ms), HOUR0 + 1);
  await equip(B.page, "can");
  await faceTile(B.page, GX, GZ);
  await act(B.page);
  await flushCloud(B.page);

  let aSawWater = false;
  try {
    await A.page.waitForFunction(
      (gx, gz, prevWatered) => {
        const t = window.__FL__.farm.tileAt(gx, gz);
        return t && t.lastWatered !== prevWatered;
      },
      { timeout: 10000 },
      GX, GZ, beforeWater.lastWatered
    );
    aSawWater = true;
  } catch (_) {}
  check("A receives B's watering live via onSnapshot (no reload)", aSawWater, JSON.stringify(beforeWater));

  // ============================= (d) Time-hook harvest on B =============================
  console.log("\n=== (d) B harvests (time-hook) -> A sees it cleared; B's player doc has the crop; A's coins unchanged ===");
  const aCoinsBefore = (await A.page.evaluate(() => window.__FL__.farm.state())).coins;
  const HOUR = 3_600_000;
  // B already banked 1h in step (c)'s watering; 3 more cycles reaches turnip's
  // full 4h growMs exactly.
  for (let i = 0; i < 3; i++) {
    await B.page.evaluate((ms) => window.__FL__.farm._addTimeOffset(ms), HOUR + 1);
    await equip(B.page, "can");
    await faceTile(B.page, GX, GZ);
    await act(B.page);
  }
  await equip(B.page, "hands");
  await faceTile(B.page, GX, GZ);
  const readyTarget = await B.page.evaluate(() => window.__FL__.farm.target());
  check("B's tile reads ready after banking 4h growth", readyTarget && readyTarget.kind === "harvest", JSON.stringify(readyTarget));
  await act(B.page);
  await flushCloud(B.page);

  let aSawHarvest = false;
  try {
    await A.page.waitForFunction(
      (gx, gz) => {
        const t = window.__FL__.farm.tileAt(gx, gz);
        return t && t.present && t.crop === null;
      },
      { timeout: 10000 },
      GX, GZ
    );
    aSawHarvest = true;
  } catch (_) {}
  check("A sees B's harvest live (tile back to bare tilled soil)", aSawHarvest);

  const playerB = await restGetDoc(`farmlife_${FAM}`, "player_TesterB");
  check("B's player doc shows +1 turnip harvested", playerB && playerB.crops && playerB.crops.turnip >= 1, JSON.stringify(playerB && playerB.crops));

  const aCoinsAfter = (await A.page.evaluate(() => window.__FL__.farm.state())).coins;
  check("A's coins unchanged by B's harvest (per-player split)", aCoinsAfter === aCoinsBefore, `${aCoinsBefore} -> ${aCoinsAfter}`);

  // Free up Firestore connections for the next devices (Chrome caps concurrent
  // connections per host — five simultaneous listeners was flaky).
  await A.page.close().catch(() => {});
  await B.page.close().catch(() => {});

  // ============================= (e) World edit round trip =============================
  console.log("\n=== (e) Editor saves a placed barn to cloud -> a fresh game context renders it ===");
  const Ed = await newDevice(browser);
  await Ed.page.goto(`${EDITOR_URL}?fam=${FAM}`, { waitUntil: "load", timeout: 60000 });
  await Ed.page.waitForFunction(() => window.__FLED__ && typeof window.__FLED__.cloudReady === "function", { timeout: 20000 });
  const edCloudOk = await Ed.page.evaluate(() => window.__FLED__.cloudReady());
  check("editor: cloud session ready", edCloudOk);
  await Ed.page.evaluate(() => {
    window.__FLED__.addProp("barn");
    window.__FLED__.tagSelected("family barn");
    window.__FLED__.transformSelected([20, 0, -25]);
  });
  await Ed.page.evaluate(() => window.__FLED__.save());
  await sleep(700);

  const worldDoc = await restGetDoc(`farmlife_${FAM}`, "world");
  let worldPayload = null;
  try { worldPayload = worldDoc && JSON.parse(worldDoc.data); } catch (_) {}
  check("cloud world doc has the barn", worldPayload && Array.isArray(worldPayload.objects) && worldPayload.objects.some((o) => o.type === "barn"), JSON.stringify(worldDoc && worldDoc.data));
  await Ed.page.close().catch(() => {});

  const D = await newDevice(browser);
  await gotoGame(D.page, "TesterD", FAM);
  const dReady = await waitCloud(D.page);
  check("device D: cloud store ready + active", dReady);
  let dSawBarn = false;
  try {
    await D.page.waitForFunction(() => window.__FL__.world.objectCount() > 0, { timeout: 12000 });
    dSawBarn = true;
  } catch (_) {}
  check("device D renders the family barn placed by the editor", dSawBarn, await D.page.evaluate(() => window.__FL__.world.types()));
  try {
    await D.page.screenshot({ path: path.join(SHOTS, "farmlife-p2-sync.png") });
  } catch (_) {}
  await D.page.close().catch(() => {});

  // ============================= (f) Migration =============================
  console.log("\n=== (f) fresh device with a pre-P2 local save migrates ONCE to an empty cloud farm ===");
  const E = await newDevice(browser);
  const localSeed = {
    tiles: { t_3_3: {} },
    seeds: { turnip: 5, potato: 0, corn: 0, pumpkin: 0 },
    crops: { turnip: 0, potato: 0, corn: 0, pumpkin: 0 },
    coins: 55,
    selectedCrop: "turnip",
    selectedTool: "hoe",
    tank: 6,
  };
  await E.page.evaluateOnNewDocument((n, seed) => {
    try {
      localStorage.setItem("choreUser", n);
      localStorage.setItem("fl_farm_v1", JSON.stringify(seed));
    } catch (_) {}
  }, "TesterE", localSeed);
  await E.page.goto(`${GAME_URL}?fam=${FAM_MIGRATE}&nopresence=1`, { waitUntil: "load", timeout: 60000 });
  await E.page.waitForFunction(() => window.__FL__ && window.__FL__.net, { timeout: 20000 });
  const eReady = await waitCloud(E.page);
  check("device E: cloud store ready + active", eReady);
  await sleep(1200); // migration runs inside initCloud, before/around the ready flip

  const migRegion1 = await restGetDoc(`farmlife_${FAM_MIGRATE}`, "region_0_0");
  const migPlayer1 = await restGetDoc(`farmlife_${FAM_MIGRATE}`, "player_TesterE");
  check("migration: region doc has the local tile t_3_3", migRegion1 && "t_3_3" in migRegion1, JSON.stringify(migRegion1));
  check("migration: player doc has coins 55", migPlayer1 && migPlayer1.coins === 55, JSON.stringify(migPlayer1 && migPlayer1.coins));

  await E.page.reload({ waitUntil: "load" });
  await E.page.waitForFunction(() => window.__FL__ && window.__FL__.net, { timeout: 20000 });
  const eReady2 = await waitCloud(E.page);
  check("device E: cloud store ready + active after reload", eReady2);
  await sleep(1200);

  const migRegion2 = await restGetDoc(`farmlife_${FAM_MIGRATE}`, "region_0_0");
  check(
    "migration ran ONCE — region doc unchanged after reload (no duplicate write)",
    JSON.stringify(migRegion2) === JSON.stringify(migRegion1),
    `before=${JSON.stringify(migRegion1)} after=${JSON.stringify(migRegion2)}`
  );

  // ============================= (g) Cleanup =============================
  console.log("\n=== (g) cleanup — delete every doc created by this run ===");
  await A.page.close().catch(() => {});
  await B.page.close().catch(() => {});
  await Ed.page.close().catch(() => {});
  await D.page.close().catch(() => {});
  await E.page.close().catch(() => {});
  await browser.close();

  const delFl = await restDeleteCollection(`farmlife_${FAM}`);
  const delFl2 = await restDeleteCollection(`farmlife_${FAM_MIGRATE}`);
  // belt-and-suspenders: Playroom is blocked above so no lobby doc should ever
  // be created here, but sweep the lobbies collections too (P3 co-tenant).
  await restDeleteCollection(`lobbies_${FAM}`);
  await restDeleteCollection(`lobbies_${FAM_MIGRATE}`);
  console.log(`deleted ${delFl} doc(s) from farmlife_${FAM}, ${delFl2} from farmlife_${FAM_MIGRATE}`);
  const finalFl = await restListDocs(`farmlife_${FAM}`);
  const finalFl2 = await restListDocs(`farmlife_${FAM_MIGRATE}`);
  check(`cleanup: farmlife_${FAM} is empty`, finalFl.length === 0, `remaining=${JSON.stringify(finalFl.map((d) => d.name))}`);
  check(`cleanup: farmlife_${FAM_MIGRATE} is empty`, finalFl2.length === 0, `remaining=${JSON.stringify(finalFl2.map((d) => d.name))}`);

  const realErrors = [...A.errors, ...B.errors, ...Ed.errors, ...D.errors, ...E.errors].filter(
    (e) => !/favicon|Failed to load resource/i.test(e)
  );
  check("0 real pageerrors across all 5 device contexts", realErrors.length === 0, realErrors.join(" | "));

  if (server) try { process.kill(server.pid); } catch (_) {}

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
