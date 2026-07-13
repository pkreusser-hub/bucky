#!/usr/bin/env node
"use strict";
/**
 * Headless: Farm Kart mobile portrait SAFE-AREA fixes (2026-07-13).
 *
 * Verifies the additive safe-area CSS closes the gaps on interactive controls that
 * env()-only HUD did NOT cover:
 *   top-left  : #muteBtn #musicBtn #pauseBtn (top:calc(var(--sat)+12px))
 *   top-center: #itemSlot                    (top:calc(var(--sat)+14px))
 *   bottom    : #tcDrift #tcItem #tcHorn      (bottom:calc(var(--sab)+N))
 * Previously-safe elements (#minimap uses raw env(), #placeHud) must be untouched.
 *
 * Method: the flagged offsets read the :root vars --sat/--sab (which default to
 * env(...)=0 headless). Overriding the vars via inline style on <html> simulates a
 * device inset and proves the wiring moved each element. Firebase/Playroom blocked.
 */
const fs = require("fs");
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8871;
const BASE = `http://127.0.0.1:${PORT}`;
const SAT = 47, SAB = 34, SAB_ANDROID = 48;

const SIZES = [
  { w: 390, h: 844, name: "iPhone 14/15" },
  { w: 390, h: 664, name: "short portrait" },
  { w: 412, h: 915, name: "Pixel-ish" },
  { w: 360, h: 640, name: "small Android" },
  { w: 320, h: 568, name: "iPhone SE" },
];

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
let PASS = 0;
function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); PASS++; console.log("  ✓ " + msg); }

async function newMobilePage(browser, w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => {
      if (String(q).replace(/\s/g, "").includes("pointer:coarse")) {
        return { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent() { return false; } };
      }
      return real(q);
    };
  });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(req.url())) return req.abort();
    req.continue();
  });
  return page;
}

// Resolve each element's used top/bottom OFFSET (px from the viewport's top/bottom edge)
// via getComputedStyle. These controls are position:absolute against the initial
// containing block, so the computed offset == the on-screen gap from that edge — and it
// resolves regardless of the frame loop toggling display/`.on`, which getBoundingClientRect
// cannot survive on the menu screen. bottomOffset>=inset <=> rect.bottom<=vh-inset.
const OFFSETS = (ids) => {
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { out[id] = null; continue; }
    const cs = getComputedStyle(el);
    out[id] = { topRaw: cs.top, botRaw: cs.bottom, top: parseFloat(cs.top), bottom: parseFloat(cs.bottom) };
  }
  return out;
};

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);

  // ---------- STATIC (source) checks ----------
  console.log("\n[static] :root vars + flagged selectors reference vars");
  const html = fs.readFileSync(path.join(ROOT, "farmkart.html"), "utf8");
  check(/:root\{[^}]*--sat:\s*env\(safe-area-inset-top/.test(html), ":root defines --sat=env(safe-area-inset-top)");
  check(/:root\{[^}]*--sab:\s*env\(safe-area-inset-bottom/.test(html), ":root defines --sab=env(safe-area-inset-bottom)");
  check(html.includes("#muteBtn{ position:absolute; left:12px; top:calc(var(--sat) + 12px)"), "#muteBtn top uses var(--sat)");
  check(html.includes("#musicBtn{ position:absolute; left:56px; top:calc(var(--sat) + 12px)"), "#musicBtn top uses var(--sat)");
  check(html.includes("#pauseBtn{ position:absolute; left:100px; top:calc(var(--sat) + 12px)"), "#pauseBtn top uses var(--sat)");
  check(html.includes("#itemSlot{ position:absolute; left:50%; top:calc(var(--sat) + 14px)"), "#itemSlot top uses var(--sat)");
  check(/#tcDrift\{ right:20px;\s+bottom:calc\(var\(--sab\) \+ 24px\)/.test(html), "#tcDrift bottom uses var(--sab)");
  check(/#tcItem\{\s+right:140px; bottom:calc\(var\(--sab\) \+ 44px\)/.test(html), "#tcItem bottom uses var(--sab)");
  check(/#tcHorn\{ left:20px; bottom:calc\(var\(--sab\) \+ 30px\)/.test(html), "#tcHorn bottom uses var(--sab)");

  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  const TOP_IDS = ["muteBtn", "musicBtn", "pauseBtn", "itemSlot"];
  const BOT_IDS = ["tcDrift", "tcItem", "tcHorn"];

  for (const sz of SIZES) {
    console.log(`\n[${sz.w}x${sz.h}] ${sz.name}`);
    const page = await newMobilePage(browser, sz.w, sz.h);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e)));
    await page.goto(BASE + "/farmkart.html", { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.IS_MOBILE !== undefined), { timeout: 20000 });

    // mobile mode + prove the touch layer CAN show (same evaluate as the add, before a frame toggles it)
    const env = await page.evaluate(() => {
      const K = window.__KART__;
      const tc = document.getElementById("touchCtl");
      tc.classList.add("on");
      return { isMobile: K.IS_MOBILE, bodyMobile: document.body.classList.contains("mobile"),
        touchDisp: getComputedStyle(tc).display, vh: window.innerHeight };
    });
    check(env.isMobile, "IS_MOBILE true (coarse + <900)");
    check(env.bodyMobile, "body.mobile class set");
    check(env.touchDisp === "block", "#touchCtl.on can display:block (mobile touch layer)");

    // baseline offsets (insets 0), then inject portrait insets
    const before = await page.evaluate(OFFSETS, [...TOP_IDS, ...BOT_IDS, "minimap"]);
    await page.evaluate((sat, sab) => {
      document.documentElement.style.setProperty("--sat", sat + "px");
      document.documentElement.style.setProperty("--sab", sab + "px");
    }, SAT, SAB);
    const after = await page.evaluate(OFFSETS, [...TOP_IDS, ...BOT_IDS, "minimap"]);

    for (const id of TOP_IDS) {
      check(after[id] && after[id].top >= SAT - 0.5, `#${id} top offset >= injected --sat (${Math.round(after[id].top)} >= ${SAT})`);
      check(after[id].top - before[id].top > 30, `#${id} moved down by ~sat (Δ${Math.round(after[id].top - before[id].top)})`);
    }
    for (const id of BOT_IDS) {
      // bottom OFFSET from viewport >= inset  <=>  rect.bottom <= vh - inset (clears gesture band)
      check(after[id] && after[id].bottom >= SAB - 0.5, `#${id} bottom offset >= injected --sab (${Math.round(after[id].bottom)} >= ${SAB})`);
      check(after[id].bottom - before[id].bottom > 30, `#${id} moved up by ~sab (Δ${Math.round(after[id].bottom - before[id].bottom)})`);
    }
    // previously-safe: #minimap reads raw env() (not the vars) -> unmoved by --sat injection
    check(before.minimap.topRaw === after.minimap.topRaw, "#minimap top unaffected by --sat injection (still safe, " + after.minimap.topRaw + ")");

    // ANDROID nav-pill pass: --sab 48 -> bottom buttons keep >=48px offset above the gesture band
    await page.evaluate((sab) => { document.documentElement.style.setProperty("--sab", sab + "px"); }, SAB_ANDROID);
    const androidBot = await page.evaluate(OFFSETS, BOT_IDS);
    for (const id of BOT_IDS) {
      check(androidBot[id].bottom >= SAB_ANDROID - 0.5, `[android sab=48] #${id} bottom offset >= 48 (${Math.round(androidBot[id].bottom)})`);
    }

    check(errors.length === 0, "0 pageerrors (" + (errors.slice(0, 2).join(" | ") || "none") + ")");

    // screenshot the primary size with insets applied + touch layer forced on (visual reference)
    if (sz.w === 390 && sz.h === 844) {
      await page.evaluate(() => {
        document.getElementById("touchCtl").style.setProperty("display", "block", "important");
        document.documentElement.style.setProperty("--sat", "47px");
        document.documentElement.style.setProperty("--sab", "34px");
      });
      await page.screenshot({ path: path.join(ROOT, "shots", "farmkartmobile-fixed.png") });
      console.log("  ✓ shot -> shots/farmkartmobile-fixed.png");
    }
    await page.close();
  }

  console.log(`\nPASS: farmkart mobile safe-area — ${PASS} checks`);
  await browser.close();
  if (server) try { server.kill(); } catch (_) {}
  process.exit(0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
