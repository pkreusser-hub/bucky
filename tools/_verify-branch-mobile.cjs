#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Branch Manager mobile-portrait fixes (2026-07-13).
 *
 * Three bugs fixed:
 *   A) Safe-area: back-bar under the notch, touch band under the home indicator. Fixed with
 *      --sat/--sab (env(safe-area-inset-*)) wired into #bar padding-top + grown height (with
 *      #hud/#layout shifted down) and #touchControls padding-bottom + grown height.
 *   B) WIDTH bug 1 (notch-independent): rotate-CW button clipped off the right edge at 320px
 *      (two button groups ~310px + 40px padding > 320). Fixed with a <=360px media query
 *      (smaller buttons/gaps, space-around). All 5 buttons must be fully on-screen at 320.
 *   C) WIDTH bug 2 (notch-independent): the top-bar title wrapped to 2 lines at <=360px and
 *      spilled into the score HUD. Fixed with .t{flex:1;min-width:0;white-space:nowrap;
 *      overflow:hidden;text-overflow:ellipsis} + a narrow font shrink. Must stay ONE line.
 *
 * Headless Chrome reports env(safe-area-inset-*) = 0, so this suite INJECTS nonzero insets
 * by overriding the :root vars inline, then asserts each flagged element moved + clears the
 * band. 5 portrait sizes, deviceScaleFactor 2, isMobile/hasTouch. Firebase/Playroom blocked
 * (Branch has no external scripts anyway). 0 pageerrors.
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8872;
const BASE = `http://127.0.0.1:${PORT}`;

const SIZES = [
  { w: 390, h: 844, name: "390x844 iPhone14" },
  { w: 390, h: 664, name: "390x664 short" },
  { w: 412, h: 915, name: "412x915 Pixel" },
  { w: 360, h: 640, name: "360x640 small" },
  { w: 320, h: 568, name: "320x568 SE" },
];

const TOP_ELS = ["#bar a", "#muteBtn"];
const BTNS = ['button[data-act="left"]', 'button[data-act="down"]', 'button[data-act="right"]', 'button[data-act="ccw"]', 'button[data-act="cw"]'].map((s) => "#touchControls " + s);

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

const MEASURE = `(function(sel){
  var el = document.querySelector(sel);
  if(!el) return null;
  var cs = getComputedStyle(el);
  if(cs.display === 'none' || cs.visibility === 'hidden') return null;
  var r = el.getBoundingClientRect();
  return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, w:r.width, h:r.height, oh:el.offsetHeight };
})`;
async function measure(page, sel) { return page.evaluate(`${MEASURE}(${JSON.stringify(sel)})`); }
async function setInsets(page, obj) {
  await page.evaluate((o) => { for (const k in o) document.documentElement.style.setProperty(k, o[k]); }, obj);
}
async function clearInsets(page) {
  await page.evaluate(() => { ["--sat", "--sar", "--sab", "--sal"].forEach((k) => document.documentElement.style.removeProperty(k)); });
}

async function runSize(browser, size) {
  const checks = [];
  const errors = [];
  const V = (n, c, d) => checks.push({ name: `[${size.name}] ${n}`, pass: !!c, detail: d == null ? "" : String(d) });

  const page = await browser.newPage();
  await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/googleapis|firestore|firebase|gstatic|playroom/i.test(req.url())) return req.abort();
    req.continue();
  });

  await page.goto(BASE + "/branchmanager.html", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector("#startBtn", { timeout: 15000 });
  // enter gameplay so the start overlay stops covering the touch band
  await page.click("#startBtn");
  await new Promise((r) => setTimeout(r, 150));
  const playing = await page.evaluate(() => !document.getElementById("startOverlay").classList.contains("show"));
  V("entered gameplay (start overlay hidden)", playing, playing);

  const vh = size.h, vw = size.w;

  // ---- WIDTH bug B: all 5 touch buttons fully on-screen (insets 0, notch-independent) ----
  await clearInsets(page);
  for (const sel of BTNS) {
    const r = await measure(page, sel);
    V(`button ${sel.split('"')[1]} present`, !!r, r ? "ok" : "MISSING");
    if (!r) continue;
    const onscreen = r.left >= -0.5 && r.right <= vw + 0.5 && r.top >= -0.5 && r.bottom <= vh + 0.5;
    V(`button ${sel.split('"')[1]} fully on-screen (right<=${vw})`, onscreen, `l${r.left.toFixed(0)} r${r.right.toFixed(0)} t${r.top.toFixed(0)} b${r.bottom.toFixed(0)}`);
  }

  // ---- WIDTH bug C: title bar ONE line, no spill into HUD (insets 0) ----
  {
    const t = await measure(page, "#bar .t");
    const bar = await measure(page, "#bar");
    const hud = await measure(page, "#hud");
    V("title .t present", t && bar && hud, "");
    if (t && bar && hud) {
      V("title .t is one line (offsetHeight<=24)", t.oh <= 24, t.oh);
      V("title .t stays within bar (bottom<=bar.bottom)", t.bottom <= bar.bottom + 0.5, `t.bottom ${t.bottom.toFixed(1)} bar.bottom ${bar.bottom.toFixed(1)}`);
      V("title .t does not spill into HUD (bottom<=hud.top)", t.bottom <= hud.top + 0.5, `t.bottom ${t.bottom.toFixed(1)} hud.top ${hud.top.toFixed(1)}`);
    }
  }

  // ---- SAFE-AREA: baseline then inject ----
  const base = {};
  for (const s of [...TOP_ELS, ...BTNS]) base[s] = await measure(page, s);

  const SAT = 47, SAB = 34;
  await setInsets(page, { "--sat": SAT + "px", "--sab": SAB + "px" });
  const inj = {};
  for (const s of [...TOP_ELS, ...BTNS]) inj[s] = await measure(page, s);

  for (const sel of TOP_ELS) {
    const b = base[sel], i = inj[sel];
    V(`top ${sel} present`, b && i, b ? "ok" : "MISSING");
    if (!b || !i) continue;
    V(`top ${sel} content top >= injectedSat (${SAT})`, i.top >= SAT - 0.5, i.top.toFixed(1));
    V(`top ${sel} moved down by ~sat`, Math.abs((i.top - b.top) - SAT) < 2, `${b.top.toFixed(1)}->${i.top.toFixed(1)} (Δ${(i.top - b.top).toFixed(1)})`);
  }
  for (const sel of BTNS) {
    const b = base[sel], i = inj[sel];
    if (!b || !i) { V(`bottom ${sel} measurable`, false, "MISSING"); continue; }
    V(`bottom ${sel.split('"')[1]} bottom <= vh-injectedSab (${vh - SAB})`, i.bottom <= vh - SAB + 0.5, i.bottom.toFixed(1));
    V(`bottom ${sel.split('"')[1]} moved up by ~sab`, Math.abs((b.bottom - i.bottom) - SAB) < 2, `Δ${(b.bottom - i.bottom).toFixed(1)}`);
    // still on-screen after inset injection
    V(`bottom ${sel.split('"')[1]} still right<=${vw} after inset`, i.right <= vw + 0.5, i.right.toFixed(1));
  }

  // ---- Android pass: larger bottom inset only ----
  const SAB2 = 48;
  await setInsets(page, { "--sat": SAT + "px", "--sab": SAB2 + "px" });
  for (const sel of BTNS) {
    const i2 = await measure(page, sel);
    const b = base[sel];
    if (!i2 || !b) { V(`android ${sel} measurable`, false, "MISSING"); continue; }
    V(`android ${sel.split('"')[1]} bottom <= vh-${SAB2}`, i2.bottom <= vh - SAB2 + 0.5, i2.bottom.toFixed(1));
    V(`android ${sel.split('"')[1]} moved up by ~${SAB2}`, Math.abs((b.bottom - i2.bottom) - SAB2) < 2, `Δ${(b.bottom - i2.bottom).toFixed(1)}`);
  }

  // screenshot the tightest fixed case at 320x568 (with iOS insets)
  if (size.w === 320 && size.h === 568) {
    await setInsets(page, { "--sat": SAT + "px", "--sab": SAB + "px" });
    try { fs.mkdirSync(path.join(ROOT, "shots"), { recursive: true }); } catch (_) {}
    await page.screenshot({ path: path.join(ROOT, "shots", "branchmobile-fixed-320x568.png") });
  }

  V("0 pageerrors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.close();
  return { checks, errors };
}

function staticChecks() {
  const out = [];
  const V = (n, c, d) => out.push({ name: `[static] ${n}`, pass: !!c, detail: d == null ? "" : String(d) });
  const src = fs.readFileSync(path.join(ROOT, "branchmanager.html"), "utf8");
  V(":root defines --sat env", /--sat:\s*env\(safe-area-inset-top/.test(src), "");
  V(":root defines --sab env", /--sab:\s*env\(safe-area-inset-bottom/.test(src), "");
  V("#bar padding-top var(--sat)", /#bar\{[^}]*padding:\s*var\(--sat\)/.test(src), "");
  V("#bar height grows by var(--sat)", /#bar\{[^}]*height:\s*calc\(46px \+ var\(--sat\)\)/.test(src), "");
  V("#hud top shifts by var(--sat)", /#hud\{[^}]*top:calc\(46px \+ var\(--sat\)\)/.test(src), "");
  V("#touchControls padding-bottom var(--sab)", /#touchControls\{[^}]*padding:0 20px var\(--sab\)/.test(src), "");
  V("#touchControls height grows by var(--sab)", /#touchControls\{[^}]*height:calc\(150px \+ var\(--sab\)\)/.test(src), "");
  V(".t nowrap+ellipsis (one-line fix)", /#bar \.t\{[^}]*white-space:nowrap;\s*overflow:hidden;\s*text-overflow:ellipsis/.test(src), "");
  V(".t flex:1 min-width:0", /#bar \.t\{[^}]*flex:1 1 auto;\s*min-width:0/.test(src), "");
  V("narrow @media shrinks touch buttons", /@media \(max-width:360px\)\{[\s\S]*?#touchControls button\{[^}]*width:48px/.test(src), "");
  V("narrow @media space-around", /@media \(max-width:360px\)\{[\s\S]*?#touchControls\{[^}]*justify-content:space-around/.test(src), "");
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
