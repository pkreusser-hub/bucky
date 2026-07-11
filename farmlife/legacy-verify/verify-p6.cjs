#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life P6 — polish + release gate. ALL OFFLINE
 * (Firebase/Playroom/open-meteo blocked): every P6 feature is client-side, so
 * this suite never touches Firestore (no ?fam=famtestfl writes, nothing to
 * clean up). The P2/P4/P5 Firestore portions are exercised by their own suites.
 *
 * Sections:
 *  (A) LOADING CARD — branded card renders at boot (🌱 FARM LIFE + welcome name)
 *      then hides once the scene is live.
 *  (B) AUDIO — mute toggle persists across reload; masterGain 0 while muted;
 *      SFX playCount GATED by mute (unmuted hoe increments, muted hoe doesn't);
 *      ambient crossfade differs day vs night (+ rain bed).
 *  (C) OCCLUSION — drive the camera behind a real tree → a fadeable proxy drops
 *      below 0.3 opacity while faded; walking clear restores it (faded→0). A
 *      through-tree screenshot proves the visual.
 *  (D) HOE — reworked silhouette (taller handle + wide flat blade) has bbox
 *      proportions distinct from the old pick-like head; hotbar renders the
 *      custom inline-SVG icon (not the ⛏ emoji). Hotbar screenshot.
 *  (E) COLLIDERS — inject a barn + re-apply the world twice → obstacle count is
 *      STABLE (no stale colliders leak; the old P2 limitation is fixed).
 *  (F) PERF — renderer.info draw calls + triangles and a 5s avg frame time at
 *      desktop 1280×800 and mobile 390×844, day vs night vs rain. Flags >250
 *      draw calls.
 *  (G) BOT PLAYTEST — scripted session: till→plant→water→time-skip→harvest→sell
 *      →buy→place decor→pet goat→collect milk→emote, 0 pageerrors, 3 screenshots.
 *  Final screenshots: farmlife-final-desktop/-mobile/-night/-decorated.png.
 *
 * Run:  node farmlife/verify-p6.cjs        (from repo root)
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

async function blockAll(page) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/playroom|googleapis|firestore|firebase|gstatic|open-meteo/i.test(req.url())) return req.abort();
    req.continue();
  });
}

async function bootPage(browser, opts) {
  opts = opts || {};
  const page = await browser.newPage();
  await page.setViewport({ width: opts.width || 1280, height: opts.height || 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  const who = opts.who || "Eleanor";
  if (opts.persistReload) {
    await page.evaluateOnNewDocument((who) => {
      try {
        if (!sessionStorage.getItem("__p6cleared")) {
          localStorage.clear();
          localStorage.setItem("choreUser", who);
          sessionStorage.setItem("__p6cleared", "1");
        }
      } catch (_) {}
    }, who);
  } else {
    await page.evaluateOnNewDocument((who) => { try { localStorage.clear(); localStorage.setItem("choreUser", who); } catch (_) {} }, who);
  }
  // Deterministic OFF for fast-grow (after any clear above; test mode defaults ON).
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  await blockAll(page);
  await page.goto(opts.fresh === false ? URL : URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  return { page, errors };
}
async function waitReady(page) {
  await page.waitForFunction(
    () => window.__FL__ && window.__FL__.farm && window.__FL__.occlusion && window.__FL__.audio && window.__FL__.perf,
    { timeout: 20000 }
  );
  await sleep(500);
}

// ---- farming helpers (mirror verify-p5) ------------------------------------
async function equip(page, tool) { await page.evaluate((t) => window.__FL__.farm.equip(t), tool); await sleep(50); }
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
async function waitIdle(page) { await page.waitForFunction(() => !window.__FL__.avatar.isBusy(), { timeout: 3000 }).catch(() => {}); }
async function act(page) { await page.evaluate(() => window.__FL__.farm.action()); await waitIdle(page); }
async function armSellAtBin(page) {
  await page.bringToFront();
  const bin = await page.evaluate(() => window.__FL__.farm.binPos);
  await page.evaluate((x, z) => window.__FL__.farm.teleport(x, z), bin.x, bin.z);
  await page.waitForFunction(() => { const t = window.__FL__.farm.target(); return t && t.kind === "sell"; }, { timeout: 5000 }).catch(() => {});
}
async function sellAtBin(page) { await armSellAtBin(page); await page.evaluate(() => window.__FL__.farm.action()); await sleep(150); }

// Force the in-game clock to local noon (the day/night system is real-time
// driven; the test host is often at night, which would render dark shots).
async function forceNoon(page) {
  await page.evaluate(() => {
    const now = new Date();
    const target = new Date(now); target.setHours(12, 30, 0, 0);
    window.__FL__.farm._setTimeOffset(target.getTime() - now.getTime());
    window.__FL__.weather.applySky();
    window.__FL__.weather._inject({ cond: "clear", code: 0, fetchedAt: Date.now(), tempF: 74 });
  });
}
async function measureFrameMs(page, ms) {
  return await page.evaluate((ms) => new Promise((resolve) => {
    const times = [];
    let last = performance.now();
    const t0 = last;
    function tick(now) {
      times.push(now - last);
      last = now;
      if (now - t0 < ms) requestAnimationFrame(tick);
      else {
        times.shift(); // drop first (warm)
        const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
        resolve({ avg, frames: times.length });
      }
    }
    requestAnimationFrame(tick);
  }), ms);
}

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
    // ============================ (A) LOADING CARD =========================
    console.log("\n=== (A) branded loading card ===");
    {
      const { page, errors } = await bootPage(browser, { who: "Eleanor" });
      // read the card before the scene is ready (it's in the initial HTML)
      const card = await page.evaluate(() => {
        const c = document.getElementById("fl-load-card");
        const title = document.getElementById("fl-load-title");
        const sub = document.getElementById("fl-load-sub");
        return {
          present: !!c,
          bg: c ? getComputedStyle(c).backgroundColor : "",
          title: title ? title.textContent : "",
          sub: sub ? sub.textContent : "",
        };
      });
      check("loading card present at boot", card.present === true);
      // barn-sign styling: the card has the warm-brown backdrop (not a bare splash)
      check("loading card is the branded barn-sign card (styled bg)", /rgb\(107, 58, 46\)/.test(card.bg), card.bg);
      check("loading title reads 🌱 FARM LIFE", /FARM LIFE/.test(card.title), card.title);
      check("loading personalizes with choreUser name", /Welcome back, Eleanor/.test(card.sub), card.sub);
      await waitReady(page);
      const hidden = await page.evaluate(() => getComputedStyle(document.getElementById("loading")).display === "none");
      check("loading card hides once the scene is live", hidden === true);
      check("(A) 0 pageerrors", errors.length === 0, errors.slice(0, 3).join(" | "));
      await page.close();
    }

    // ============================ (B) AUDIO ===============================
    console.log("\n=== (B) audio: mute persistence + gating + ambient ===");
    {
      const { page, errors } = await bootPage(browser, { persistReload: true });
      await waitReady(page);
      await page.evaluate(() => window.__FL__.audio.resume());
      await sleep(150);

      const st = await page.evaluate(() => ({ muted: window.__FL__.audio.muted(), master: window.__FL__.audio.masterGain(), ctx: window.__FL__.audio.ctxState() }));
      check("audio starts unmuted", st.muted === false, JSON.stringify(st));
      check("master gain ~1 while unmuted", st.master > 0.5, `master=${st.master}`);

      // playCount gating: unmuted hoe increments; muted hoe does not
      const c0 = await page.evaluate(() => window.__FL__.audio.playCount());
      await page.evaluate(() => window.__FL__.audio.hoe());
      const c1 = await page.evaluate(() => window.__FL__.audio.playCount());
      check("unmuted SFX increments playCount", c1 > c0, `${c0}→${c1}`);
      await page.evaluate(() => window.__FL__.audio.setMuted(true));
      await sleep(60);
      const gm = await page.evaluate(() => window.__FL__.audio.masterGain());
      check("master gain →0 when muted", gm < 0.05, `master=${gm}`);
      const c2 = await page.evaluate(() => window.__FL__.audio.playCount());
      await page.evaluate(() => { window.__FL__.audio.hoe(); window.__FL__.audio.coin(); });
      const c3 = await page.evaluate(() => window.__FL__.audio.playCount());
      check("muted SFX are gated (playCount stable)", c3 === c2, `${c2}→${c3}`);

      // ambient crossfade day vs night (read the crossfade TARGETS — the live
      // gains ramp over ~1.5s and are deliberately quiet/non-fatiguing)
      await page.evaluate(() => window.__FL__.audio.setMuted(false));
      const dayAmb = await page.evaluate(() => { window.__FL__.audio.setAmbient(1, false); return window.__FL__.audio.ambientTargets(); });
      const nightAmb = await page.evaluate(() => { window.__FL__.audio.setAmbient(0, false); return window.__FL__.audio.ambientTargets(); });
      const rainAmb = await page.evaluate(() => { window.__FL__.audio.setAmbient(0.5, true); return window.__FL__.audio.ambientTargets(); });
      check("day ambient favors birds over crickets", dayAmb.day > nightAmb.day && dayAmb.night < nightAmb.night, JSON.stringify({ dayAmb, nightAmb }));
      check("rain bed engages while raining", rainAmb.rain > 0.05, JSON.stringify(rainAmb));

      // persist mute across reload
      await page.evaluate(() => window.__FL__.audio.setMuted(true));
      await sleep(60);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitReady(page);
      const persisted = await page.evaluate(() => window.__FL__.audio.muted());
      check("mute state persists across reload (fl_muted)", persisted === true);
      check("(B) 0 pageerrors", errors.length === 0, errors.slice(0, 3).join(" | "));
      await page.close();
    }

    // ============================ (C) OCCLUSION ===========================
    console.log("\n=== (C) camera occlusion fade (see-through tree) ===");
    {
      const { page, errors } = await bootPage(browser);
      await waitReady(page);
      await forceNoon(page); // well-lit so the faded tree reads in the screenshot
      // stand a couple metres in front of a real tree with the camera on its far side
      const setup = await page.evaluate(() => {
        const FL = window.__FL__;
        const spots = FL.occlusion.treeSpots();
        // pick a tree comfortably inside the map
        let t = spots[0];
        for (const s of spots) { if (Math.abs(s.x) < 30 && Math.abs(s.z) < 30) { t = s; break; } }
        const yaw = 0.6;
        FL.farm.teleport(t.x + Math.sin(yaw) * 2.2, t.z + Math.cos(yaw) * 2.2);
        FL._setYaw(yaw);
        FL._snapCam(); // jump the camera behind the player so the tree occludes now
        return { spots: spots.length, t };
      });
      check("46 tree occluder spots exposed", setup.spots === 46, `spots=${setup.spots}`);
      await sleep(1600); // camera settle + proxy fade lerp to target 0.22
      const behind = await page.evaluate(() => ({
        faded: window.__FL__.occlusion.fadedCount(),
        proxyMin: window.__FL__.occlusion.proxyMinOpacity(),
        proxies: window.__FL__.occlusion.proxyCount(),
      }));
      check("a tree proxy spawns when it occludes the player", behind.proxies >= 1, JSON.stringify(behind));
      check("occluding tree fades below 0.3 opacity", behind.proxyMin < 0.3, `proxyMin=${behind.proxyMin.toFixed(3)}`);
      await page.screenshot({ path: path.join(SHOTS, "farmlife-p6-through-tree.png") });

      // walk clear → restores
      await page.evaluate(() => window.__FL__.farm.teleport(16, 34));
      await sleep(1100);
      const clear = await page.evaluate(() => ({ faded: window.__FL__.occlusion.fadedCount(), proxies: window.__FL__.occlusion.proxyCount() }));
      check("occlusion restores when line of sight clears", clear.faded === 0 && clear.proxies === 0, JSON.stringify(clear));
      check("(C) 0 pageerrors", errors.length === 0, errors.slice(0, 3).join(" | "));
      await page.close();
    }

    // ============================ (D) HOE =================================
    console.log("\n=== (D) hoe rework + custom icon ===");
    {
      const { page, errors } = await bootPage(browser);
      await waitReady(page);
      await equip(page, "hoe");
      await sleep(120);
      const bbox = await page.evaluate(() => window.__FL__.avatar.toolLocalBBox());
      // OLD pick-like head dims (from the pre-P6 buildHoe): ~ x0.26 y0.95 z0.37.
      const OLD = { x: 0.26, y: 0.95, z: 0.37 };
      const tallerHandle = bbox.y > 1.1; // new handle is 1.18 tall (old ~0.95)
      const poleTool = bbox.y > bbox.x && bbox.y > bbox.z; // long-handled tool, not a compact pick head
      const differs = Math.abs(bbox.y - OLD.y) > 0.1 || Math.abs(bbox.x - OLD.x) > 0.05;
      check("hoe silhouette taller than the old pick head", tallerHandle, JSON.stringify(bbox));
      check("hoe reads as a long-handled tool (height is the major axis)", poleTool, JSON.stringify(bbox));
      check("hoe bbox proportions differ from the old pickaxe", differs, `new=${JSON.stringify(bbox)} old=${JSON.stringify(OLD)}`);
      const iconInfo = await page.evaluate(() => {
        const em = document.querySelector('.fl-slot[data-tool="hoe"] .em');
        return { hasSvg: !!(em && em.querySelector("svg")), noPick: !(em && /⛏/.test(em.textContent)) };
      });
      check("hotbar hoe slot renders the custom SVG icon", iconInfo.hasSvg === true);
      check("hotbar hoe slot no longer shows the ⛏ pickaxe emoji", iconInfo.noPick === true);
      await page.screenshot({ path: path.join(SHOTS, "farmlife-p6-hotbar.png"), clip: { x: 440, y: 690, width: 400, height: 110 } }).catch(() => {});
      check("(D) 0 pageerrors", errors.length === 0, errors.slice(0, 3).join(" | "));
      await page.close();
    }

    // ============================ (E) COLLIDERS ===========================
    console.log("\n=== (E) collider retract (no stale colliders) ===");
    {
      const { page, errors } = await bootPage(browser);
      await waitReady(page);
      const r = await page.evaluate(() => {
        const w = window.__FL__.world;
        const before = w.obstacleCount();
        const afterInject = w.injectTestBarn();
        const reA = w.reapplyWorld();
        const reB = w.reapplyWorld();
        return { before, afterInject, reA, reB };
      });
      check("injecting a barn adds colliders", r.afterInject > r.before, JSON.stringify(r));
      check("re-applying the world twice keeps count STABLE (no leak)", r.reA === r.afterInject && r.reB === r.afterInject, JSON.stringify(r));
      // the injected barn actually collides
      const push = await page.evaluate(() => window.__FL__.world.collidePush(6, -30));
      check("the placed barn collides (player pushed out)", push > 0.05, `push=${push.toFixed(3)}`);
      check("(E) 0 pageerrors", errors.length === 0, errors.slice(0, 3).join(" | "));
      await page.close();
    }

    // ============================ (F) PERF ================================
    console.log("\n=== (F) perf snapshot (draw calls / triangles / frame time) ===");
    const perfRows = [];
    for (const vp of [{ label: "desktop 1280×800", width: 1280, height: 800 }, { label: "mobile 390×844", width: 390, height: 844 }]) {
      const { page, errors } = await bootPage(browser, { width: vp.width, height: vp.height });
      await waitReady(page);
      for (const cond of ["day", "night", "rain"]) {
        await page.evaluate((cond) => {
          const FL = window.__FL__;
          if (cond === "day") FL.farm._setTimeOffset(0);
          else FL.farm._setTimeOffset(0);
          // force a night sky by offsetting the clock to ~2am local
          if (cond === "night") {
            const now = new Date();
            const target = new Date(now); target.setHours(2, 0, 0, 0);
            FL.farm._setTimeOffset(target.getTime() - now.getTime());
          }
          FL.weather.applySky();
          if (cond === "rain") FL.weather._inject({ cond: "rain", code: 61, fetchedAt: Date.now(), tempF: 55 });
          else FL.weather._inject({ cond: "clear", code: 0, fetchedAt: Date.now(), tempF: 70 });
        }, cond);
        await sleep(400);
        const info = await page.evaluate(() => window.__FL__.perf.info());
        const fm = await measureFrameMs(page, 5000);
        perfRows.push({ vp: vp.label, cond, calls: info.calls, tris: info.tris, ms: fm.avg });
        console.log(`   ${vp.label} · ${cond}: ${info.calls} draws · ${info.tris} tris · ${fm.avg.toFixed(2)}ms/frame`);
        check(`draw calls sane (${vp.label}/${cond} ≤250)`, info.calls <= 250, `calls=${info.calls}`);
      }
      check(`(F) 0 pageerrors (${vp.label})`, errors.length === 0, errors.slice(0, 3).join(" | "));
      await page.close();
    }

    // ============================ (G) BOT PLAYTEST ========================
    console.log("\n=== (G) scripted bot playtest (full core loop) ===");
    {
      const { page, errors } = await bootPage(browser, { width: 1280, height: 800 });
      await waitReady(page);
      await page.evaluate(() => window.__FL__.audio.resume());
      await page.bringToFront();
      // fund coins so the shop/decor steps work
      await page.evaluate(() => window.__FL__.farm.addCrop("corn", 6));
      await sellAtBin(page);
      const startCoins = await page.evaluate(() => window.__FL__.farm.state().coins);
      check("playtest funded (coins>300)", startCoins > 300, `coins=${startCoins}`);
      await page.screenshot({ path: path.join(SHOTS, "farmlife-p6-play-1.png") });

      // till → plant → water → time-skip → harvest
      const gx = 3, gz = 3;
      await equip(page, "hoe"); await faceTile(page, gx, gz); await act(page);
      const tilled = await page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), gx, gz);
      check("tilled a tile", tilled && tilled.tilled === true, JSON.stringify(tilled));
      await equip(page, "seeds");
      await page.evaluate(() => window.__FL__.farm.selectCrop("corn"));
      const seeds = await page.evaluate(() => window.__FL__.farm.state().seeds.corn);
      if (seeds < 1) await page.evaluate(() => window.__FL__.farm.buySeed("corn"));
      await faceTile(page, gx, gz); await act(page);
      const planted = await page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), gx, gz);
      check("planted corn", planted && planted.crop === "corn", JSON.stringify(planted));
      await equip(page, "can");
      // water forward through the grow window
      for (let t = 0; t < 40; t++) {
        await page.evaluate(() => window.__FL__.farm._addTimeOffset(6 * 3600000));
        await faceTile(page, gx, gz); await act(page);
        const tile = await page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), gx, gz);
        if (tile && tile.stage === "ready") break;
      }
      const ready = await page.evaluate((gx, gz) => window.__FL__.farm.tileAt(gx, gz), gx, gz);
      check("corn grew to ready via water + time-skip", ready && ready.stage === "ready", JSON.stringify(ready));
      await equip(page, "hands"); await faceTile(page, gx, gz); await act(page);
      const harvested = await page.evaluate(() => window.__FL__.farm.state().crops.corn);
      check("harvested corn (+1)", harvested >= 1, `corn=${harvested}`);
      await page.screenshot({ path: path.join(SHOTS, "farmlife-p6-play-2.png") });

      // sell → buy a decor → place it
      await sellAtBin(page);
      const afterSell = await page.evaluate(() => window.__FL__.farm.state().coins);
      check("sold harvest for coins", afterSell > 0, `coins=${afterSell}`);
      const placed = await page.evaluate(async () => {
        const FL = window.__FL__;
        FL.farm.teleport(30, -6); FL.farm.setHeading(0);
        await new Promise((r) => setTimeout(r, 140));
        FL.decor.buy("gnome");
        await new Promise((r) => setTimeout(r, 220));
        const p = FL.decor.placing();
        if (p && p.valid) { FL.decor.confirm(); return true; }
        FL.decor.cancel(); return false;
      });
      check("bought + placed a decoration", placed === true, `placed=${placed}`);

      // milk + pet a goat (feeding removed — advance 12h so milk is ready, then milk + pet)
      const animal = await page.evaluate(async () => {
        const FL = window.__FL__;
        const ids = FL.animals.ids();
        let goat = null;
        for (const id of ids) { const r = FL.animals.record(id); if (r && r.type === "goat") { goat = id; break; } }
        if (!goat) return { ok: false };
        FL.farm._addTimeOffset(12 * 3600 * 1000); // goat milk ready
        FL.animals.collect(goat); // milk
        FL.animals.pet(goat);
        FL.farm._setTimeOffset(0);
        return { ok: true, produce: FL.animals.produce() };
      });
      check("milked + petted a goat (milk collected)", animal.ok && animal.produce && animal.produce.milk >= 1, JSON.stringify(animal));

      // emote
      const emoted = await page.evaluate(() => {
        try { window.__FL__.presence.emote("wave"); return true; } catch (_) { return false; }
      });
      check("emote fired without error", emoted === true);
      await page.screenshot({ path: path.join(SHOTS, "farmlife-p6-play-3.png") });
      check("(G) bot playtest 0 pageerrors", errors.length === 0, errors.slice(0, 5).join(" | "));
      await page.close();
    }

    // ============================ FINAL SCREENSHOTS =======================
    console.log("\n=== final screenshot set ===");
    {
      // desktop (day, clear)
      const { page } = await bootPage(browser, { width: 1280, height: 800 });
      await waitReady(page);
      await forceNoon(page);
      await page.evaluate(() => window.__FL__.farm.teleport(16, 8));
      await sleep(600);
      await page.screenshot({ path: path.join(SHOTS, "farmlife-final-desktop.png") });

      // decorated corner
      await page.evaluate(async () => {
        const FL = window.__FL__;
        FL.farm.addCrop("corn", 30); // fund
        const place = async (type, x, z) => {
          FL.farm.teleport(x, z - 2.4); FL.farm.setHeading(0);
          await new Promise((r) => setTimeout(r, 120));
          FL.decor.buy(type);
          await new Promise((r) => setTimeout(r, 200));
          const p = FL.decor.placing(); if (p && p.valid) FL.decor.confirm(); else FL.decor.cancel();
        };
        await place("scarecrow", 28, -8);
        await place("pinwheel", 31, -8);
        await place("flowerbed", 29.5, -10);
        await place("bench", 26, -8);
        FL.farm.teleport(30, -3); FL.farm.setHeading(Math.PI);
      });
      await sleep(700);
      await page.screenshot({ path: path.join(SHOTS, "farmlife-final-decorated.png") });
      await page.close();

      // night
      const { page: np } = await bootPage(browser, { width: 1280, height: 800 });
      await waitReady(np);
      await np.evaluate(() => {
        const FL = window.__FL__;
        const now = new Date(); const target = new Date(now); target.setHours(1, 30, 0, 0);
        FL.farm._setTimeOffset(target.getTime() - now.getTime());
        FL.weather.applySky();
        FL.farm.teleport(20, 12);
      });
      await sleep(800);
      await np.screenshot({ path: path.join(SHOTS, "farmlife-night.png") });
      await np.close();

      // mobile
      const { page: mp } = await bootPage(browser, { width: 390, height: 844 });
      await waitReady(mp);
      await forceNoon(mp);
      await mp.evaluate(() => window.__FL__.farm.teleport(16, 8));
      await sleep(600);
      await mp.screenshot({ path: path.join(SHOTS, "farmlife-final-mobile.png") });
      await mp.close();
      check("final screenshots captured", true);
    }
  } finally {
    await browser.close();
    if (server) try { process.kill(server.pid); } catch (_) {}
  }

  // ---- summary --------------------------------------------------------------
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n${pass}/${results.length} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
  if (fail) {
    for (const r of results) if (!r.ok) console.log("  FAIL: " + r.name + (r.detail ? "  → " + r.detail : ""));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
void HOUR;
