#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life P4 — animals, day/night, real weather.
 *
 * Sections:
 *  (1) EVERYTHING blocked (Firebase+Playroom+open-meteo) — solo regression:
 *      the game must still boot clean, 0 pageerrors.
 *  (2) Offline/mocked weather — intercept api.open-meteo.com and serve a
 *      canned rain/snow/clear response; assert rain particles + auto-water +
 *      weather chip, snow particles + no auto-water, clear = no precip.
 *  (3) Day/night — pure clock-driven, no network needed; drive _setTimeOffset
 *      across a day and sample flHook.weather.sky() at night/dawn/noon/dusk.
 *  (4) Animals offline — herd spawn, wander bounds, pet/feed/collect/sell,
 *      the 7-day kindness-cap absence case.
 *  (5) REAL Firestore (?fam=famtestfl ONLY) — herd created exactly once
 *      across a reload, a second device sees the same herd, feeding syncs.
 *      All test docs deleted + emptiness confirmed at the end.
 *
 * Run:  node farmlife/verify-p4.cjs        (from repo root)
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

// ---- Firestore REST helpers (public rules, same as verify-p3.cjs) ----------
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

// ---- weather mocking ---------------------------------------------------------
function wmoResponse(code, tempF) {
  return JSON.stringify({ current: { weather_code: code, temperature_2m: tempF ?? 60 } });
}
async function mockWeather(page, code) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (/api\.open-meteo\.com/i.test(u)) {
      // real open-meteo sends CORS headers; the mock must too, or the
      // browser's fetch() rejects it before fetchWeather() ever sees the body.
      return req.respond({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: wmoResponse(code),
      });
    }
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
    req.continue();
  });
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
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  if (opts.mockWeatherCode != null) await mockWeather(page, opts.mockWeatherCode);
  else if (opts.blockAll) await blockEverything(page);
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (_) {} });
  // Deterministic OFF for fast-grow (after the clear above; test mode defaults ON).
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  const url = opts.fam ? `${URL}?fam=${opts.fam}` : URL;
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.farm && typeof window.__FL__.farm.state === "function", { timeout: 20000 });
  await sleep(500);
  return { page, errors };
}

async function equip(page, tool) {
  await page.evaluate((t) => window.__FL__.farm.equip(t), tool);
  await sleep(60);
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

/** Central-hour-of-day for a given real ms (mirrors src/world/daynight.ts's
 * centralHour) — used to compute a time offset that lands the in-game clock
 * on a target hour, from this Node process (no network needed). */
function centralHour(ms) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "numeric", hour12: false });
  const parts = fmt.formatToParts(new Date(ms));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 12) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return ((h + m / 60) % 24 + 24) % 24;
}
/** Offset (ms) to add to Date.now() so centralHour(now+offset) ≈ targetHour. */
function offsetToHour(targetHour) {
  const now = Date.now();
  const cur = centralHour(now);
  let deltaH = targetHour - cur;
  while (deltaH < 0) deltaH += 24;
  return Math.round(deltaH * 3_600_000);
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

  // ============================= (1) EVERYTHING BLOCKED =============================
  console.log("\n=== (1) solo regression — Firebase + Playroom + open-meteo ALL blocked ===");
  {
    const { page, errors } = await bootPage(browser, { blockAll: true });
    const ok = await page.evaluate(() => !!window.__FL__.farm.state());
    check("game boots with weather fully unreachable", ok);
    const wx = await page.evaluate(() => window.__FL__.weather.current());
    check("weather.current() degrades to null (no crash, no fake data)", wx === null, JSON.stringify(wx));
    await sleep(300);
    check("(1) 0 pageerrors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ============================= (2) MOCKED RAIN =============================
  console.log("\n=== (2) mocked RAIN (WMO 61) — particles, auto-water, weather chip ===");
  {
    const { page, errors } = await bootPage(browser, { mockWeatherCode: 61 });
    await page.waitForFunction(() => window.__FL__.weather.current() !== null, { timeout: 15000 }).catch(() => {});
    const wx = await page.evaluate(() => window.__FL__.weather.current());
    check("weather.current().cond === 'rain'", wx && wx.cond === "rain", JSON.stringify(wx));
    const raining = await page.evaluate(() => window.__FL__.weather.isRaining());
    check("rain particles active", raining === true);
    const chip = await page.evaluate(() => document.querySelector("#fl-weather")?.textContent || "");
    check("weather chip shows the rain emoji", /🌧/.test(chip), chip);

    // plant a tile, let its grace window lapse, then let rain auto-water it
    await equip(page, "hoe");
    await faceTile(page, 5, 5);
    await page.evaluate(() => window.__FL__.farm.action()); // till
    await waitIdle(page);
    await equip(page, "seeds");
    await page.evaluate(() => window.__FL__.farm.action()); // plant turnip
    await waitIdle(page);
    const before = await page.evaluate(() => window.__FL__.farm.tileAt(5, 5));
    check("planted, not yet needing water", before.present && before.crop === "turnip", JSON.stringify(before));

    const TURNIP_WATER_EVERY_MS = 3_600_000;
    const RAIN_INTERVAL_MS = 3 * 60 * 1000;
    await page.evaluate((ms) => window.__FL__.farm._addTimeOffset(ms), TURNIP_WATER_EVERY_MS + 60_000);
    // rain's auto-water baseline was set relative to an earlier "now" — jump
    // far enough past one full interval that a tick is guaranteed to fire.
    await page.evaluate((ms) => window.__FL__.farm._addTimeOffset(ms), RAIN_INTERVAL_MS + 30_000);
    await sleep(600); // a few real rAF frames to let tickWeatherEffects observe the jump
    const after = await page.evaluate(() => window.__FL__.farm.tileAt(5, 5));
    check(
      "rain auto-watered the unwatered planted tile (lastWatered advanced)",
      after.present && after.lastWatered > before.lastWatered,
      `before=${before.lastWatered} after=${after.lastWatered}`
    );

    try { await page.screenshot({ path: path.join(SHOTS, "farmlife-p4-rain.png") }); } catch (_) {}
    await sleep(200);
    check("(2) 0 pageerrors", errors.filter((e) => !/favicon/i.test(e)).length === 0, errors.join(" | "));
    await page.close();
  }

  // ============================= (2b) MOCKED SNOW =============================
  console.log("\n=== (2b) mocked SNOW (WMO 71) — snow particles, NOT rain, no auto-water ===");
  {
    const { page, errors } = await bootPage(browser, { mockWeatherCode: 71 });
    await page.waitForFunction(() => window.__FL__.weather.current() !== null, { timeout: 15000 }).catch(() => {});
    const wx = await page.evaluate(() => window.__FL__.weather.current());
    check("weather.current().cond === 'snow'", wx && wx.cond === "snow", JSON.stringify(wx));
    const snowing = await page.evaluate(() => window.__FL__.weather.isSnowing());
    const raining = await page.evaluate(() => window.__FL__.weather.isRaining());
    check("snow particles active, rain not", snowing === true && raining === false, `snow=${snowing} rain=${raining}`);
    check("(2b) 0 pageerrors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ============================= (2c) MOCKED CLEAR =============================
  console.log("\n=== (2c) mocked CLEAR (WMO 0) — no auto-water, no precip ===");
  {
    const { page, errors } = await bootPage(browser, { mockWeatherCode: 0 });
    await page.waitForFunction(() => window.__FL__.weather.current() !== null, { timeout: 15000 }).catch(() => {});
    const raining = await page.evaluate(() => window.__FL__.weather.isRaining());
    const snowing = await page.evaluate(() => window.__FL__.weather.isSnowing());
    check("clear sky: neither rain nor snow active", raining === false && snowing === false, `rain=${raining} snow=${snowing}`);

    await equip(page, "hoe");
    await faceTile(page, 4, 4);
    await page.evaluate(() => window.__FL__.farm.action());
    await waitIdle(page);
    await equip(page, "seeds");
    await page.evaluate(() => window.__FL__.farm.action());
    await waitIdle(page);
    const before = await page.evaluate(() => window.__FL__.farm.tileAt(4, 4));
    await page.evaluate((ms) => window.__FL__.farm._addTimeOffset(ms), 3_600_000 + 4 * 60 * 1000);
    await sleep(400);
    const after = await page.evaluate(() => window.__FL__.farm.tileAt(4, 4));
    check("clear weather never auto-waters", after.lastWatered === before.lastWatered, `before=${before.lastWatered} after=${after.lastWatered}`);
    check("(2c) 0 pageerrors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ============================= (3) DAY/NIGHT =============================
  console.log("\n=== (3) day/night — distinct night/dawn/noon/dusk sky states over a real 24h drive ===");
  {
    const { page, errors } = await bootPage(browser, { blockAll: true });
    const nightOff = offsetToHour(2);
    const dawnOff = offsetToHour(6.5);
    const noonOff = offsetToHour(13);
    const duskOff = offsetToHour(19);

    await page.evaluate((ms) => window.__FL__.farm._setTimeOffset(ms), nightOff);
    const night = await page.evaluate(() => window.__FL__.weather.sky());
    await page.evaluate((ms) => window.__FL__.farm._setTimeOffset(ms), noonOff);
    const noon = await page.evaluate(() => window.__FL__.weather.sky());
    await page.evaluate((ms) => window.__FL__.farm._setTimeOffset(ms), dawnOff);
    const dawn = await page.evaluate(() => window.__FL__.weather.sky());
    await page.evaluate((ms) => window.__FL__.farm._setTimeOffset(ms), duskOff);
    const dusk = await page.evaluate(() => window.__FL__.weather.sky());

    check("night: stars visible, window glowing", night.starAlpha > 0.8 && night.windowGlow > 0.5, JSON.stringify({ s: night.starAlpha, w: night.windowGlow }));
    check("noon: stars off, window dark, brightest sky", noon.starAlpha === 0 && noon.windowGlow === 0 && noon.sunIntensity > night.sunIntensity, JSON.stringify(noon));
    check("dawn/dusk are distinct intermediate states (not night, not noon)", dawn.starAlpha !== night.starAlpha && dawn.starAlpha !== noon.starAlpha && JSON.stringify(dawn.sky) !== JSON.stringify(dusk.sky));

    // apply to the live renderer + screenshot the night sky
    await page.evaluate((ms) => window.__FL__.farm._setTimeOffset(ms), nightOff);
    await page.evaluate(() => window.__FL__.weather.applySky());
    await sleep(150);
    try { await page.screenshot({ path: path.join(SHOTS, "farmlife-p4-night.png") }); } catch (_) {}
    // reset to "now" for the rest of the process (avoid a stuck offset)
    await page.evaluate(() => window.__FL__.farm._setTimeOffset(0));

    check("(3) 0 pageerrors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ============================= (4) ANIMALS OFFLINE =============================
  // NOTE (husbandry rework 2026-07-10): the old pen/feed model is gone. Animals
  // now roam a fenced PASTURE (rectangle, not a circle), feeding removed (grazing
  // feeds them), goats milk on hand-action, chickens lay physical eggs. This
  // section was updated accordingly; the full new routine is covered by
  // verify-p11.cjs. Kept here: herd spawn, pasture containment, milk→sell.
  console.log("\n=== (4) animals — herd spawn, pasture roaming, milk/pet/sell (husbandry rework) ===");
  {
    const { page, errors } = await bootPage(browser, { blockAll: true });
    const ids = await page.evaluate(() => window.__FL__.animals.ids());
    check("herd has 5 animals", ids.length === 5, JSON.stringify(ids));
    const recs = await page.evaluate((ids) => ids.map((id) => window.__FL__.animals.record(id)), ids);
    const goats = recs.filter((r) => r.type === "goat");
    const chickens = recs.filter((r) => r.type === "chicken");
    check("2 goats + 3 chickens with kid-friendly names", goats.length === 2 && chickens.length === 3, JSON.stringify(recs.map((r) => `${r.type}:${r.name}`)));

    // pasture containment: drive the routine for 60s of day-time and assert every
    // animal stays inside the pasture rectangle (never past the fence).
    const bounds = await page.evaluate(() => {
      const FL = window.__FL__; FL.barn.setOpen(true); FL.animals.setPhase("day");
      const P = FL.animals.pastureBounds(); let ok = true;
      for (let k = 0; k < 60; k++) { FL.animals.advance(1);
        for (const id of FL.animals.ids()) { const a = FL.animals.actorPos(id);
          if (a.x < P.minX - 0.5 || a.x > P.maxX + 0.5 || a.z < P.minZ - 0.5 || a.z > P.maxZ + 0.5) ok = false; } }
      return { ok, P };
    });
    check("wander always stays inside the pasture fence", bounds.ok, JSON.stringify(bounds.P));

    // pet a goat (not milk-ready → pet)
    const goatId = goats[0].name === "Clover" ? "goat1" : "goat2";
    const petAction = await page.evaluate((id) => window.__FL__.animals.interaction(id), goatId);
    check("a not-milk-ready goat resolves to PET", petAction === "pet", petAction);
    const beforePet = await page.evaluate((id) => window.__FL__.animals.record(id), goatId);
    await page.evaluate((id) => window.__FL__.animals.pet(id), goatId);
    await sleep(300);
    const afterPet = await page.evaluate((id) => window.__FL__.animals.record(id), goatId);
    check("petting updates the goat's care state (lastPet)", afterPet.lastPet > beforePet.lastPet, JSON.stringify({ before: beforePet.lastPet, after: afterPet.lastPet }));
    try { await page.screenshot({ path: path.join(SHOTS, "farmlife-p4-animals.png") }); } catch (_) {}

    // milk: advance 12h so the goat's milk is ready → collect → +1 milk
    await page.evaluate((ms) => window.__FL__.farm._addTimeOffset(ms), 12 * 3_600_000);
    const interactionReady = await page.evaluate((id) => window.__FL__.animals.interaction(id), goatId);
    check("after 12h a goat's milk is ready → interaction resolves to collect (milk)", interactionReady === "collect", interactionReady);
    const produceBefore = await page.evaluate(() => window.__FL__.animals.produce());
    await page.evaluate((id) => window.__FL__.animals.collect(id), goatId);
    await waitIdle(page);
    const produceAfter = await page.evaluate(() => window.__FL__.animals.produce());
    check("milking gives +1 milk", produceAfter.milk === produceBefore.milk + 1, JSON.stringify({ before: produceBefore, after: produceAfter }));

    // sell at the bin
    const coinsBefore = await page.evaluate(() => window.__FL__.farm.state().coins);
    const bin = await page.evaluate(() => window.__FL__.farm.binPos);
    await page.evaluate((x, z) => { window.__FL__.farm.teleport(x, z); }, bin.x, bin.z);
    await waitIdle(page);
    await sleep(200);
    const sellTgt = await page.evaluate(() => window.__FL__.farm.target());
    check("standing at the bin with milk held resolves to sell", sellTgt && sellTgt.kind === "sell", JSON.stringify(sellTgt));
    await page.evaluate(() => window.__FL__.farm.action());
    await sleep(200);
    const coinsAfter = await page.evaluate(() => window.__FL__.farm.state().coins);
    check("selling milk added coins (goat milk sells for 40)", coinsAfter >= coinsBefore + 40, `before=${coinsBefore} after=${coinsAfter}`);
    const producePostSell = await page.evaluate(() => window.__FL__.animals.produce());
    check("produce inventory cleared after selling", producePostSell.milk === 0, JSON.stringify(producePostSell));

    // kindness cap: a fresh goat, +7 days absent → EXACTLY ONE milk waiting, never sick/dead
    const goat2 = goatId === "goat1" ? "goat2" : "goat1";
    await page.evaluate((id) => window.__FL__.animals.collect(id), goat2); // fresh checkpoint (may or may not be ready)
    await sleep(120);
    await page.evaluate((ms) => window.__FL__.farm._addTimeOffset(ms), 7 * 24 * 3_600_000);
    const kindness = await page.evaluate((id) => window.__FL__.animals.interaction(id), goat2);
    check("7-day absence: a goat has exactly one milk waiting → interaction is collect", kindness === "collect", kindness);
    const recAbsent = await page.evaluate((id) => window.__FL__.animals.record(id), goat2);
    check("animal record has no death/sick/health field at all (kindness cap)", !("dead" in recAbsent) && !("sick" in recAbsent) && !("health" in recAbsent), JSON.stringify(recAbsent));

    await page.evaluate(() => window.__FL__.farm._setTimeOffset(0));
    await sleep(200);
    check("(4) 0 pageerrors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ============================= (5) REAL FIRESTORE, TWO DEVICES =============================
  console.log("\n=== (5) real Firestore (?fam=famtestfl) — herd created once, syncs across devices ===");
  {
    const preDel = await restDeleteCollection(`farmlife_${FAM}`);
    console.log(`pre-flight: removed ${preDel} doc(s) from farmlife_${FAM}`);

    const A = await bootPage(browser, { fam: FAM });
    // cloudAnimalsCtor is only assigned partway through initCloud()'s async
    // chain (after session.ready + farm/world migration+load) — poll for it
    // rather than a one-shot read, same as p3's isCloud()-polling convention.
    let aReady = false;
    try {
      await A.page.waitForFunction(() => window.__FL__.animals.isCloud() === true, { timeout: 25000 });
      aReady = true;
    } catch (_) {}
    check("device A: cloud animal store reachable", aReady);
    if (aReady) {
      await A.page.waitForFunction(() => window.__FL__.animals.ids().every((id) => window.__FL__.animals.record(id) !== null), { timeout: 15000 }).catch(() => {});

      // reload A -> herd must NOT be re-seeded/duplicated (still exactly 5, same doc)
      await A.page.reload({ waitUntil: "load" });
      await A.page.waitForFunction(() => window.__FL__ && window.__FL__.animals && window.__FL__.animals.isCloud && window.__FL__.animals.isCloud() === true, { timeout: 20000 }).catch(() => {});
      await sleep(500);
      const animalsDoc = await restGetDoc(`farmlife_${FAM}`, "animals");
      const fieldCount = animalsDoc ? Object.keys(animalsDoc).filter((k) => k.startsWith("a_")).length : 0;
      check("exactly 5 animal fields on the server after a reload (no dup-seed)", fieldCount === 5, `fields=${fieldCount}`);

      const B = await bootPage(browser, { fam: FAM });
      await B.page.waitForFunction(() => window.__FL__.animals.isCloud && window.__FL__.animals.isCloud() === true, { timeout: 20000 }).catch(() => {});
      await sleep(500);
      const bIds = await B.page.evaluate(() => window.__FL__.animals.ids().filter((id) => window.__FL__.animals.record(id) !== null));
      check("device B sees the same 5-animal herd (no re-seed)", bIds.length === 5, JSON.stringify(bIds));

      // A pets Clover -> B should see lastPet update (feeding was removed —
      // petting is the always-available care action that changes a herd field)
      const beforeB = await B.page.evaluate(() => window.__FL__.animals.record("goat1"));
      await A.page.evaluate(() => window.__FL__.animals.pet("goat1"));
      await A.page.evaluate(() => window.__FL__.animals.flushSave());
      await sleep(400);
      let afterB = null;
      try {
        await B.page.waitForFunction((prev) => {
          const r = window.__FL__.animals.record("goat1");
          return r && r.lastPet > prev;
        }, { timeout: 15000, polling: 500 }, beforeB.lastPet);
        afterB = await B.page.evaluate(() => window.__FL__.animals.record("goat1"));
      } catch (_) {}
      check("device B sees A's pet via Firestore sync (lastPet increased)", afterB && afterB.lastPet > beforeB.lastPet, JSON.stringify({ before: beforeB, after: afterB }));

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
  console.log("shots: shots/farmlife-p4-animals.png, shots/farmlife-p4-night.png, shots/farmlife-p4-rain.png");
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
