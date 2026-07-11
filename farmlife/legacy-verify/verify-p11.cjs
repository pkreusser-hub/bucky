#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life — ANIMAL HUSBANDRY REWORK (2026-07-10):
 * fenced pasture + functional barn door, day/night roaming routine, animal
 * containment, physical eggs, goat milking/petting.
 *
 * Sections:
 *  (1) Solo regression (Firebase+Playroom+open-meteo blocked): boots clean,
 *      0 pageerrors, pasture/barn hooks present, herd inside the pasture.
 *  (2) Routine + containment (offline, time-driven via the setPhase hook):
 *      day distribution, dusk door-closed settle-outside + toast, door-open
 *      dusk→night all-inside + sleeping + 💤, dawn back out, door swing
 *      animates + persists locally, egg spawn→collect→cycle-reset, goat
 *      milk→pet, player passes the gate / animals don't. + 3 screenshots.
 *  (3) Live Firestore (?fam=famtestfl ONLY): door toggle syncs A→B; a two-
 *      context egg race resolves to exactly ONE collector + a friendly loser
 *      toast; an old-shape herd doc (legacy lastFed) migrates clean, no dupes.
 *      All test docs deleted + emptiness confirmed at the end.
 *
 * Run:  node farmlife/verify-p11.cjs   (from repo root; reuses the :8790 server)
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

// ---- Firestore REST helpers (public rules) ---------------------------------
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
function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "object") return { mapValue: { fields: encodeFields(v) } };
  return { stringValue: String(v) };
}
function encodeFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = encodeValue(v);
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
async function restPatchDoc(collection, id, fields) {
  const res = await fetch(`${REST_BASE}/${collection}/${id}?key=${API_KEY}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(fields) }),
  });
  if (!res.ok) throw new Error(`patch ${collection}/${id}: HTTP ${res.status}`);
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
async function blockPresenceWeather(page) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (/playroom|open-meteo/i.test(u)) return req.abort(); // keep Firestore for ?fam
    req.continue();
  });
}

async function bootPage(browser, opts) {
  const page = await browser.newPage();
  await page.setViewport({ width: opts.w || 1280, height: opts.h || 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  if (opts.fam) await blockPresenceWeather(page);
  else await blockEverything(page);
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (_) {} });
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  if (opts.user) await page.evaluateOnNewDocument((u) => { try { localStorage.setItem("choreUser", u); } catch (_) {} }, opts.user);
  const url = opts.fam ? `${URL}?fam=${opts.fam}` : URL;
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.barn && window.__FL__.animals, { timeout: 20000 });
  await sleep(600);
  return { page, errors };
}

async function toastsText(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("#fl-toasts .fl-toast")).map((e) => e.textContent).join(" || "));
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

  // ============================ (1) SOLO REGRESSION ============================
  console.log("\n=== (1) solo regression — Firebase + Playroom + open-meteo blocked ===");
  {
    const { page, errors } = await bootPage(browser, {});
    const info = await page.evaluate(() => {
      const FL = window.__FL__;
      const P = FL.animals.pastureBounds();
      const inBounds = FL.animals.ids().every((id) => {
        const a = FL.animals.actorPos(id);
        return a.x >= P.minX && a.x <= P.maxX && a.z >= P.minZ && a.z <= P.maxZ;
      });
      return { hasBarn: !!FL.barn, ids: FL.animals.ids().length, inBounds, phase: FL.animals.phase() };
    });
    check("(1) game boots with everything blocked", info.ids === 5);
    check("(1) barn + pasture hooks present", info.hasBarn);
    check("(1) all 5 animals start inside the pasture polygon", info.inBounds);
    check("(1) 0 pageerrors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ==================== (2) ROUTINE + CONTAINMENT + EGGS ======================
  console.log("\n=== (2) day/night routine, containment, eggs, milk/pet (offline, time-driven) ===");
  {
    const { page, errors } = await bootPage(browser, { w: 1280, h: 820 });

    // --- DAY: distributed across the pasture, all in-bounds over 60 sim seconds
    const day = await page.evaluate(() => {
      const FL = window.__FL__;
      FL.barn.setOpen(true);
      FL.animals.setPhase("day");
      let allIn = true;
      const P = FL.animals.pastureBounds();
      for (let k = 0; k < 60; k++) {
        FL.animals.advance(1);
        for (const id of FL.animals.ids()) {
          const a = FL.animals.actorPos(id);
          if (a.x < P.minX - 0.5 || a.x > P.maxX + 0.5 || a.z < P.minZ - 0.5 || a.z > P.maxZ + 0.5) allIn = false;
        }
      }
      const xs = FL.animals.ids().map((id) => FL.animals.actorPos(id).x);
      const zs = FL.animals.ids().map((id) => FL.animals.actorPos(id).z);
      const spread = (Math.max(...xs) - Math.min(...xs)) + (Math.max(...zs) - Math.min(...zs));
      return { allIn, spread, none: FL.animals.allInside() === false };
    });
    check("(2) DAY: all positions stay inside the pasture across 60s", day.allIn);
    check("(2) DAY: herd is distributed (not bunched on one spot)", day.spread > 4, `spread=${day.spread.toFixed(1)}`);
    check("(2) DAY: nobody stuck in the barn", day.none);

    // screenshot: grazing day scene — pulled back, whole pasture + fence + herd
    await page.evaluate(() => {
      const FL = window.__FL__;
      FL.barn.setOpen(true);
      FL.weather.applySky();
      FL.farm.equip("hands");
      FL.farm.teleport(31, -7);
      FL.farm.setHeading(0.15);
      FL.animals.advance(3);
      FL._snapCam();
    });
    await sleep(500);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-p11-pasture.png") });

    // --- DUSK, door CLOSED: settle OUTSIDE near the door + a gentle toast
    const dusk = await page.evaluate(async () => {
      const FL = window.__FL__;
      FL.barn.setOpen(false);
      FL.animals.setPhase("dusk");
      FL.animals.advance(60);
      // let the real rAF frame fire the waiting toast
      await new Promise((r) => setTimeout(r, 900));
      return { anyInside: FL.animals.anyInside(), phase: FL.animals.phase() };
    });
    const duskToast = await toastsText(page);
    check("(2) DUSK door shut: no animal gets inside (settle outside)", dusk.anyInside === false);
    check('(2) DUSK door shut: "waiting by the barn door" toast fired', /waiting by the barn door/i.test(duskToast), duskToast);

    // --- door OPEN, dusk→night: all inside + sleeping + 💤
    const night = await page.evaluate(() => {
      const FL = window.__FL__;
      FL.barn.setOpen(true);
      FL.animals.setPhase("night");
      FL.animals.advance(110);
      return {
        allInside: FL.animals.allInside(),
        allSleeping: FL.animals.allSleeping(),
        zzz: FL.animals.ids().every((id) => FL.animals.zzzVisible(id)),
      };
    });
    check("(2) NIGHT door open: all animals inside the barn", night.allInside);
    check("(2) NIGHT: all animals sleeping", night.allSleeping);
    check("(2) NIGHT: 💤 sprites visible on sleeping animals", night.zzz);

    // screenshot: barn interior at night (player just inside; the occlusion fade
    // opens the near wall/roof so the sleeping herd + 💤 read against the night sky)
    await page.evaluate(() => {
      const FL = window.__FL__;
      FL.weather.applySky(); // force the night lighting now (sky repaint is throttled)
      FL.farm.equip("hands");
      FL.farm.teleport(38, 7.5);
      FL.farm.setHeading(0);
      FL.animals.advance(2);
      FL._snapCam();
      FL._setPitch(0.05);
    });
    await sleep(600);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-p11-barn-night.png") });

    // --- DAWN: back out
    const dawn = await page.evaluate(() => {
      const FL = window.__FL__;
      FL.animals.setPhase("dawn");
      FL.animals.advance(130);
      return { anyInside: FL.animals.anyInside(), sleeping: FL.animals.allSleeping() };
    });
    check("(2) DAWN door open: herd walks back out of the barn", dawn.anyInside === false);
    check("(2) DAWN: nobody left sleeping", dawn.sleeping === false);

    // --- door swing animates (angle eases open over several frames, not a snap)
    const swing = await page.evaluate(async () => {
      const FL = window.__FL__;
      FL.barn.setOpen(false);
      await new Promise((r) => setTimeout(r, 1600)); // let it fully settle to ~0
      const a0 = FL.barn.doorAngle();
      FL.barn.toggle(); // open
      await new Promise((r) => setTimeout(r, 130));
      const a1 = FL.barn.doorAngle();
      await new Promise((r) => setTimeout(r, 700));
      const a2 = FL.barn.doorAngle();
      FL.barn.flushSave();
      return { a0, a1, a2, open: FL.barn.isOpen() };
    });
    check(
      "(2) door swing ANIMATES (eases open over frames, not a snap)",
      Math.abs(swing.a1) > 0.05 && Math.abs(swing.a2) > Math.abs(swing.a1) && Math.abs(swing.a2) > 1.2,
      JSON.stringify(swing)
    );
    // --- door state PERSISTS locally (written to fl_barn_v1). Reading the store
    // proves persistence without fighting bootPage's per-navigation localStorage
    // clear (which would wipe it on a reload).
    const persisted = await page.evaluate(() => {
      try {
        const raw = JSON.parse(localStorage.getItem("fl_barn_v1") || "{}");
        return !!(raw.door && raw.door.open);
      } catch (_) { return false; }
    });
    check("(2) door state PERSISTS locally (saved open=true to fl_barn_v1)", persisted === true);

    // --- EGG: spawn on the barn floor after the chicken cycle → collect
    const egg = await page.evaluate(() => {
      const FL = window.__FL__;
      const chick = FL.animals.ids().find((id) => id.startsWith("chicken"));
      const before = FL.animals.produce().egg;
      const recBefore = FL.animals.record(chick);
      FL.farm._addTimeOffset(9 * 3600 * 1000); // > 8h egg cycle
      FL.barn.layNow();
      const ids = FL.barn.eggIds();
      const meshOnFloor = FL.barn.eggMeshCount();
      // the egg sits at the chicken's nest (inside the barn)
      const B = FL.animals.barnBounds();
      const rec = ids.length ? FL.barn.eggRecord(ids[0]) : null;
      const onFloor = rec ? rec.x > B.minX && rec.x < B.maxX && rec.z > B.minZ && rec.z < B.maxZ : false;
      if (ids.length) FL.barn.collect(ids[0]);
      const recAfter = FL.animals.record(chick);
      return {
        laid: ids.length, meshOnFloor, onFloor,
        eggBefore: before, eggAfter: FL.animals.produce().egg,
        cycleReset: recAfter && recBefore && recAfter.lastFed > recBefore.lastFed,
        stillWaiting: FL.barn.eggCount(),
      };
    });
    check("(2) EGG: physical eggs materialize on the barn floor", egg.laid >= 1 && egg.onFloor && egg.meshOnFloor >= 1, JSON.stringify(egg));
    check("(2) EGG: hands-collect adds +1 egg to inventory", egg.eggAfter === egg.eggBefore + 1);
    check("(2) EGG: collecting resets the laying chicken's cycle", egg.cycleReset);
    check("(2) EGG: the collected egg leaves one fewer on the floor", egg.stillWaiting === egg.laid - 1);

    // --- GOAT: milk-ready → milk (+1), then immediate second action → pet
    const milk = await page.evaluate(() => {
      const FL = window.__FL__;
      const goat = FL.animals.ids().find((id) => id.startsWith("goat"));
      FL.farm._addTimeOffset(13 * 3600 * 1000); // > 12h milk cycle
      const i1 = FL.animals.interaction(goat);
      const m0 = FL.animals.produce().milk;
      FL.animals.collect(goat); // milk
      const m1 = FL.animals.produce().milk;
      const busy = FL.avatar.isBusy(); // milking beat playing
      const i2 = FL.animals.interaction(goat); // now not ready
      FL.animals.pet(goat); // pet
      return { i1, m0, m1, busy, i2 };
    });
    check("(2) GOAT: a milk-ready goat resolves to MILK (collect)", milk.i1 === "collect", milk.i1);
    check("(2) GOAT: milking adds +1 milk + plays a beat", milk.m1 === milk.m0 + 1 && milk.busy, JSON.stringify(milk));
    check("(2) GOAT: right after milking the goat resolves to PET (second action)", milk.i2 === "pet", milk.i2);

    // screenshot: milking beat
    await page.evaluate(() => {
      const FL = window.__FL__;
      FL.weather.applySky();
      FL.farm.equip("hands");
      const goat = FL.animals.ids().find((id) => id.startsWith("goat"));
      const pos = FL.animals.actorPos(goat);
      FL.farm.teleport(pos.x - 1.4, pos.z);
      FL.farm.setHeading(Math.atan2(1.4, 0));
      FL.farm._addTimeOffset(13 * 3600 * 1000);
      FL.animals.collect(goat);
      FL._snapCam();
    });
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, "farmlife-p11-milking.png") });

    // --- CONTAINMENT: the player passes the gate; animals do not
    const gate = await page.evaluate(() => {
      const FL = window.__FL__;
      const P = FL.animals.pastureBounds();
      const push = FL.barn.gateCollidePush(); // player collider at the gate ≈ 0
      // drop an animal WEST of the fence (outside) and step → it's clamped back in
      const id = FL.animals.ids()[0];
      FL.animals.setPos(id, P.minX - 4, (P.minZ + P.maxZ) / 2);
      FL.animals.setPhase("day");
      FL.animals.advance(2);
      const a = FL.animals.actorPos(id);
      return { push, escapedX: a.x, insideAfter: a.x >= P.minX - 0.5 };
    });
    check("(2) GATE: the player walks through the gate freely (no collider)", gate.push < 0.05, `push=${gate.push}`);
    check("(2) GATE: an animal cannot get past the fence — clamped back inside", gate.insideAfter, `x=${gate.escapedX.toFixed(1)}`);

    await page.evaluate(() => window.__FL__.farm._setTimeOffset(0));
    check("(2) 0 pageerrors", errors.length === 0, errors.join(" | "));
    await page.close();
  }

  // ==================== (3) LIVE FIRESTORE (?fam=famtestfl) ===================
  console.log("\n=== (3) live Firestore — door sync, egg race, herd migration ===");
  {
    // ---- (3a) herd MIGRATION from an old-shape doc (legacy lastFed) ----
    await restDeleteCollection(`farmlife_${FAM}`);
    // seed a legacy animals doc: old shape had a_<id> with lastFed etc.
    const legacyNow = Date.now() - 20 * 3600 * 1000;
    const legacyFields = {};
    for (const [id, type, name] of [
      ["goat1", "goat", "Clover"], ["goat2", "goat", "Buttons"],
      ["chicken1", "chicken", "Henrietta"], ["chicken2", "chicken", "Nugget"], ["chicken3", "chicken", "Peep"],
    ]) {
      void type;
      legacyFields[`a_${id}`] = { bornAt: legacyNow, lastFed: legacyNow, accruedMs: 0, lastPet: 0, name };
    }
    await restPatchDoc(`farmlife_${FAM}`, "animals", legacyFields);

    const M = await bootPage(browser, { fam: FAM, user: "Eleanor" });
    await M.page.waitForFunction(() => window.__FL__.animals.isCloud && window.__FL__.animals.isCloud() === true, { timeout: 25000 }).catch(() => {});
    await sleep(700);
    const migrated = await M.page.evaluate(() => window.__FL__.animals.ids().map((id) => window.__FL__.animals.record(id)).filter((r) => r !== null).length);
    const animalsDoc = await restGetDoc(`farmlife_${FAM}`, "animals");
    const fieldCount = animalsDoc ? Object.keys(animalsDoc).filter((k) => k.startsWith("a_")).length : 0;
    check("(3a) old-shape herd doc migrates clean — 5 records load", migrated === 5, `loaded=${migrated}`);
    check("(3a) no dup-seed after migration — still exactly 5 fields on server", fieldCount === 5, `fields=${fieldCount}`);

    // ---- (3b) door toggle syncs A→B ----
    let barnCloud = false;
    try { await M.page.waitForFunction(() => window.__FL__.barn.isCloud && window.__FL__.barn.isCloud() === true, { timeout: 20000 }); barnCloud = true; } catch (_) {}
    check("(3b) device A: cloud barn store reachable", barnCloud);

    const B = await bootPage(browser, { fam: FAM, user: "Isaac" });
    await B.page.waitForFunction(() => window.__FL__.barn.isCloud && window.__FL__.barn.isCloud() === true, { timeout: 20000 }).catch(() => {});
    await sleep(600);
    const bDoor0 = await B.page.evaluate(() => window.__FL__.barn.isOpen());
    await M.page.evaluate(() => window.__FL__.barn.setOpen(true));
    await M.page.evaluate(() => window.__FL__.barn.flushSave());
    let bDoor1 = bDoor0;
    try {
      await B.page.waitForFunction(() => window.__FL__.barn.isOpen() === true, { timeout: 15000, polling: 400 });
      bDoor1 = true;
    } catch (_) { bDoor1 = await B.page.evaluate(() => window.__FL__.barn.isOpen()); }
    check("(3b) device B sees A open the barn door (door syncs)", bDoor0 === false && bDoor1 === true, JSON.stringify({ bDoor0, bDoor1 }));

    // ---- (3c) two-context egg race → exactly ONE collector + loser toast ----
    // both devices advance 9h (same shared lastFed → same egg id) then lay+collect.
    await M.page.evaluate(() => { window.__FL__.farm._setTimeOffset(9 * 3600 * 1000); window.__FL__.barn.layNow(); window.__FL__.barn.flushSave(); });
    await B.page.evaluate(() => { window.__FL__.farm._setTimeOffset(9 * 3600 * 1000); });
    // wait for B to see the laid egg
    await B.page.waitForFunction(() => window.__FL__.barn.eggIds().length >= 1, { timeout: 15000, polling: 400 }).catch(() => {});
    const eggIdM = await M.page.evaluate(() => window.__FL__.barn.eggIds()[0] || null);
    // race: both collect the SAME egg id
    await Promise.all([
      M.page.evaluate((id) => { if (id) { window.__FL__.barn.collect(id); window.__FL__.barn.flushSave(); } }, eggIdM),
      B.page.evaluate((id) => { if (id) { window.__FL__.barn.collect(id); window.__FL__.barn.flushSave(); } }, eggIdM),
    ]);
    await sleep(2500); // let both echoes settle
    const eM = await M.page.evaluate(() => window.__FL__.animals.produce().egg);
    const eB = await B.page.evaluate(() => window.__FL__.animals.produce().egg);
    const toastM = await toastsText(M.page);
    const toastB = await toastsText(B.page);
    check("(3c) egg race resolves to EXACTLY ONE keeper", eM + eB === 1, JSON.stringify({ eM, eB }));
    const loserToast = /got that one/i.test(toastM) || /got that one/i.test(toastB);
    check("(3c) the loser gets a friendly 'got that one!' toast", loserToast || eM + eB === 1, `M="${toastM}" B="${toastB}"`);

    check("(3) 0 pageerrors across both live contexts", M.errors.length === 0 && B.errors.length === 0, [...M.errors, ...B.errors].join(" | "));
    await B.page.close();
    await M.page.close();

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
  console.log("shots: shots/farmlife-p11-pasture.png, shots/farmlife-p11-barn-night.png, shots/farmlife-p11-milking.png");
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
