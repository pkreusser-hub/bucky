#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Barnyard Bistro mobile-portrait safe-area fix (2026-07-13).
 *
 * The 4 thumb buttons + EXIT/VIEW sat under the iOS home indicator and the back-bar under
 * the notch/Dynamic Island. Fix = CSS safe-area vars (--sat/--sar/--sab/--sal =
 * env(safe-area-inset-*)) wired into every flagged edge offset via calc().
 *
 * Headless Chrome reports env(safe-area-inset-*) = 0 (no notch emulation), so this suite
 * INJECTS nonzero insets by overriding the :root vars inline, then asserts each flagged
 * element MOVED by the injected amount and now clears the injected band.
 *
 * 5 portrait sizes, deviceScaleFactor 2, isMobile/hasTouch, matchMedia(coarse) stubbed so
 * the game sets body.touchAware (the touch layer is display:none otherwise). Firebase +
 * Playroom blocked (three.js CDN allowed). 0 pageerrors.
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8871;
const BASE = `http://127.0.0.1:${PORT}`;

const SIZES = [
  { w: 390, h: 844, name: "390x844 iPhone14" },
  { w: 390, h: 664, name: "390x664 short" },
  { w: 412, h: 915, name: "412x915 Pixel" },
  { w: 360, h: 640, name: "360x640 small" },
  { w: 320, h: 568, name: "320x568 SE" },
];

// flagged elements: {sel, edge:'top'|'bottom'}
const TOP_ELS = ["#bar a", "#sunClock", "#muteBtn", "#musicBtn"];
const BOTTOM_ELS = ["#grabWrap", "#workWrap", "#throwWrap", "#lobWrap", "#exitBtn", "#camBtn"];
const LABELS = ["#grabWrap .touchBtnLabel", "#workWrap .touchBtnLabel"];

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
          http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}

// page-side: measure an element's viewport rect (or null if not laid out / hidden)
const MEASURE = `(function(sel){
  var el = document.querySelector(sel);
  if(!el) return null;
  var cs = getComputedStyle(el);
  if(cs.display === 'none' || cs.visibility === 'hidden') return null;
  var r = el.getBoundingClientRect();
  if(r.width === 0 && r.height === 0) return null;
  return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, w:r.width, h:r.height };
})`;

async function measure(page, sel) { return page.evaluate(`${MEASURE}(${JSON.stringify(sel)})`); }
async function setInsets(page, obj) {
  await page.evaluate((o) => {
    for (const k in o) document.documentElement.style.setProperty(k, o[k]);
  }, obj);
}
async function clearInsets(page) {
  await page.evaluate(() => {
    ["--sat", "--sar", "--sab", "--sal"].forEach((k) => document.documentElement.style.removeProperty(k));
  });
}

async function runSize(browser, size) {
  const checks = [];
  const errors = [];
  const V = (n, c, d) => checks.push({ name: `[${size.name}] ${n}`, pass: !!c, detail: d == null ? "" : String(d) });

  const page = await browser.newPage();
  await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  await page.evaluateOnNewDocument(() => {
    const orig = window.matchMedia ? window.matchMedia.bind(window) : null;
    window.matchMedia = (q) => {
      if (/coarse/i.test(q)) return { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
      if (orig) return orig(q);
      return { matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
    };
  });

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/googleapis|firestore|firebase|gstatic|playroom/i.test(req.url())) return req.abort();
    req.continue();
  });

  await page.goto(BASE + "/barnyardbistro.html", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!window.__BB_AUDIO__, { timeout: 20000 });

  // touchAware should be on from the coarse stub
  const touchAware = await page.evaluate(() => document.body.classList.contains("touchAware"));
  V("body.touchAware set (coarse-pointer stub)", touchAware, touchAware);

  // enter the kitchen: close title, start level 0 (Salad Days) solo
  await page.evaluate(() => {
    const H = window.__BB_AUDIO__;
    H.G.titleOpen = false;
    H.hostStartLevel(0, false);
  });
  // wait for frame loop to drop body.titleUp so #touchLayer becomes display:block
  await page.waitForFunction(
    () => !document.body.classList.contains("titleUp") && getComputedStyle(document.getElementById("touchLayer")).display === "block",
    { timeout: 15000 }
  ).catch(() => {});
  const inGame = await page.evaluate(() => !document.body.classList.contains("titleUp") && getComputedStyle(document.getElementById("touchLayer")).display === "block");
  V("entered kitchen — touch layer visible", inGame, inGame);

  // ---- baseline (insets 0) ----
  await clearInsets(page);
  const base = {};
  for (const s of [...TOP_ELS, ...BOTTOM_ELS, ...LABELS]) base[s] = await measure(page, s);

  // ---- inject iOS insets ----
  const SAT = 47, SAB = 34;
  await setInsets(page, { "--sat": SAT + "px", "--sab": SAB + "px" });
  const inj = {};
  for (const s of [...TOP_ELS, ...BOTTOM_ELS, ...LABELS]) inj[s] = await measure(page, s);

  const vh = size.h, vw = size.w;

  for (const sel of TOP_ELS) {
    const b = base[sel], i = inj[sel];
    V(`top ${sel} present`, b && i, b ? "ok" : "MISSING");
    if (!b || !i) continue;
    V(`top ${sel} content top >= injectedSat (${SAT})`, i.top >= SAT - 0.5, i.top.toFixed(1));
    V(`top ${sel} moved by ~sat`, Math.abs((i.top - b.top) - SAT) < 2, `${b.top.toFixed(1)}->${i.top.toFixed(1)} (Δ${(i.top - b.top).toFixed(1)})`);
  }

  for (const sel of BOTTOM_ELS) {
    const b = base[sel], i = inj[sel];
    V(`bottom ${sel} present`, b && i, b ? "ok" : "MISSING");
    if (!b || !i) continue;
    V(`bottom ${sel} bottom edge <= vh-injectedSab (${vh - SAB})`, i.bottom <= vh - SAB + 0.5, i.bottom.toFixed(1));
    V(`bottom ${sel} moved up by ~sab`, Math.abs((b.bottom - i.bottom) - SAB) < 2, `${b.bottom.toFixed(1)}->${i.bottom.toFixed(1)} (Δ${(b.bottom - i.bottom).toFixed(1)})`);
  }

  // GRAB & WORK labels fully visible above the injected home-indicator band
  for (const sel of LABELS) {
    const i = inj[sel];
    V(`label ${sel} present`, !!i, i ? "ok" : "MISSING");
    if (!i) continue;
    const inView = i.top >= 0 && i.left >= 0 && i.right <= vw + 0.5 && i.bottom <= vh - SAB + 0.5;
    V(`label ${sel} fully visible above band`, inView, `t${i.top.toFixed(0)} l${i.left.toFixed(0)} r${i.right.toFixed(0)} b${i.bottom.toFixed(0)} (vw${vw} band${vh - SAB})`);
  }

  // ---- Android pass: bigger bottom inset only ----
  const SAB2 = 48;
  await setInsets(page, { "--sat": SAT + "px", "--sab": SAB2 + "px" });
  for (const sel of BOTTOM_ELS) {
    const i2 = await measure(page, sel);
    const b = base[sel];
    if (!i2 || !b) { V(`android ${sel} measurable`, false, "MISSING"); continue; }
    V(`android ${sel} bottom <= vh-${SAB2}`, i2.bottom <= vh - SAB2 + 0.5, i2.bottom.toFixed(1));
    V(`android ${sel} moved up by ~${SAB2}`, Math.abs((b.bottom - i2.bottom) - SAB2) < 2, `Δ${(b.bottom - i2.bottom).toFixed(1)}`);
  }

  // screenshot the flagship fixed case (iOS insets restored)
  if (size.w === 390 && size.h === 844) {
    await setInsets(page, { "--sat": SAT + "px", "--sab": SAB + "px" });
    try { fs.mkdirSync(path.join(ROOT, "shots"), { recursive: true }); } catch (_) {}
    await page.screenshot({ path: path.join(ROOT, "shots", "bistromobile-fixed-390x844.png") });
  }

  V("0 pageerrors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
  return { checks, errors };
}

function staticChecks() {
  const out = [];
  const V = (n, c, d) => out.push({ name: `[static] ${n}`, pass: !!c, detail: d == null ? "" : String(d) });
  const src = fs.readFileSync(path.join(ROOT, "barnyardbistro.html"), "utf8");
  V(":root defines --sat env", /--sat:\s*env\(safe-area-inset-top/.test(src), "");
  V(":root defines --sab env", /--sab:\s*env\(safe-area-inset-bottom/.test(src), "");
  V(":root defines --sar env", /--sar:\s*env\(safe-area-inset-right/.test(src), "");
  V(":root defines --sal env", /--sal:\s*env\(safe-area-inset-left/.test(src), "");
  V("#bar padding-top var(--sat)", /#bar\{[^}]*padding:\s*var\(--sat\)/.test(src), "");
  V("#bar height grows by var(--sat)", /#bar\{[^}]*height:\s*calc\(46px \+ var\(--sat\)\)/.test(src), "");
  V("#grabWrap bottom var(--sab)", /#grabWrap\{[^}]*bottom:calc\(var\(--sab\)/.test(src), "");
  V("#grabWrap right var(--sar)", /#grabWrap\{[^}]*right:calc\(var\(--sar\)/.test(src), "");
  V("#workWrap bottom var(--sab)", /#workWrap\{[^}]*bottom:calc\(var\(--sab\)/.test(src), "");
  V("#throwWrap bottom var(--sab)", /#throwWrap\{[^}]*bottom:calc\(var\(--sab\)/.test(src), "");
  V("#lobWrap bottom var(--sab)", /#lobWrap\{[^}]*bottom:calc\(var\(--sab\)/.test(src), "");
  V("#exitBtn bottom var(--sab)", /#exitBtn\{[^}]*bottom:calc\(var\(--sab\)/.test(src), "");
  V("#camBtn bottom var(--sab)", /#camBtn\{[^}]*bottom:calc\(var\(--sab\)/.test(src), "");
  V("#muteBtn top var(--sat) (base)", /#muteBtn\{[^}]*top:calc\(var\(--sat\)/.test(src), "");
  V("#musicBtn top var(--sat) (base)", /#musicBtn\{[^}]*top:calc\(var\(--sat\)/.test(src), "");
  V("#sunClock top var(--sat) (base)", /#sunClock\{[^}]*top:calc\(var\(--sat\)/.test(src), "");
  // mobile media overrides also wired (they win at all tested widths <=520)
  V("mobile @media #muteBtn top var(--sat)", /#muteBtn\{[^}]*top:calc\(var\(--sat\) \+ 9px\)/.test(src), "");
  V("mobile @media #sunClock top var(--sat)", /#sunClock\{[^}]*top:calc\(var\(--sat\) \+ 8px\)/.test(src), "");
  return out;
}

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

  let totalPass = 0, totalFail = 0;

  const st = staticChecks();
  console.log("\n=== STATIC (CSS wiring) ===");
  for (const c of st) { console.log("  " + (c.pass ? "✓" : "✗ FAIL") + " " + c.name + (c.detail ? "  [" + c.detail + "]" : "")); if (c.pass) totalPass++; else totalFail++; }

  for (const size of SIZES) {
    const { checks, errors } = await runSize(browser, size);
    console.log(`\n=== ${size.name} ===`);
    for (const c of checks) { console.log("  " + (c.pass ? "✓" : "✗ FAIL") + " " + c.name + (c.detail ? "  [" + c.detail + "]" : "")); if (c.pass) totalPass++; else totalFail++; }
    if (errors.length) totalFail += errors.length;
  }

  await browser.close();
  if (server) server.kill();

  console.log(`\n${totalPass} passed, ${totalFail} failed`);
  if (totalFail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
