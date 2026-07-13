#!/usr/bin/env node
"use strict";
/**
 * Headless: Hayhem mobile portrait SAFE-AREA fixes (2026-07-13).
 *
 * The top #bar had NO safe-area-top (title + "← Bucky" back link slid under the
 * notch); the bottom #aimControls/#fireBtn base clearance (16px) was tight vs an
 * Android nav pill. Fixes:
 *   #bar        : padding-top:var(--sat); height:calc(46px+var(--sat))
 *   top HUD     : .teamCard/#banner/#toast/#mute/#musicBtn shifted +var(--sat)
 *   bottom      : #aimControls/#fireBtn bottom:calc(var(--sab)+20px)  (was env+16)
 *
 * Method: override :root --sat/--sab via inline <html> style to simulate insets and
 * prove the wiring moved each element. Firebase/Playroom blocked.
 */
const fs = require("fs");
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8872;
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

// resolved top/bottom OFFSET (px from viewport edge) via getComputedStyle — these HUD
// controls are position:absolute against the initial containing block, so this is the
// on-screen gap and resolves regardless of #hud display state / frame loop.
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
  const html = fs.readFileSync(path.join(ROOT, "hayhem.html"), "utf8");
  check(/:root\{[^}]*--sat:\s*env\(safe-area-inset-top/.test(html), ":root defines --sat=env(safe-area-inset-top)");
  check(/:root\{[^}]*--sab:\s*env\(safe-area-inset-bottom/.test(html), ":root defines --sab=env(safe-area-inset-bottom)");
  check(html.includes("height:calc(46px + var(--sat)); z-index:40;"), "#bar height grows by var(--sat)");
  check(html.includes("padding:var(--sat) 12px 0;"), "#bar has padding-top:var(--sat)");
  check(html.includes("position:absolute; top:calc(54px + var(--sat));"), ".teamCard top uses var(--sat)");
  check(html.includes("position:absolute; top:calc(106px + var(--sat));"), "#banner top uses var(--sat)");
  check(html.includes("position:absolute; top:calc(172px + var(--sat));"), "#toast top uses var(--sat)");
  check(html.includes("position:absolute; top:calc(112px + var(--sat)); right:12px;"), "#mute top uses var(--sat)");
  check(html.includes("position:absolute; top:calc(112px + var(--sat)); right:58px;"), "#musicBtn top uses var(--sat)");
  check(html.includes("left:12px; bottom:calc(var(--sab) + 20px);"), "#aimControls bottom uses var(--sab)+20");
  check(html.includes("right:14px; bottom:calc(var(--sab) + 20px);"), "#fireBtn bottom uses var(--sab)+20");

  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  const TOP_IDS = ["teamWest", "teamEast", "mute", "musicBtn"];
  const BOT_IDS = ["aimControls", "fireBtn"];

  for (const sz of SIZES) {
    console.log(`\n[${sz.w}x${sz.h}] ${sz.name}`);
    const page = await newMobilePage(browser, sz.w, sz.h);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e)));
    await page.goto(BASE + "/hayhem.html", { waitUntil: "networkidle0", timeout: 90000 });
    await page.waitForFunction(() => !!window.__HAYHEM__, { timeout: 30000 });

    // start -> aim phase reveals the #hud (controls become visible)
    await page.click("#playBtn");
    await page.waitForFunction(() => window.__HAYHEM__.phase === "aim", { timeout: 12000 });
    const env = await page.evaluate(() => {
      const hud = document.getElementById("hud");
      const bar = document.getElementById("bar");
      const barLink = bar.querySelector("a");
      const barT = bar.querySelector(".t");
      return {
        bodyMobile: document.body.classList.contains("mobile"),
        hudDisp: getComputedStyle(hud).display,
        aimDisp: getComputedStyle(document.getElementById("aimControls")).display,
        fireDisp: getComputedStyle(document.getElementById("fireBtn")).display,
        vh: window.innerHeight,
        barLinkTop0: barLink.getBoundingClientRect().top,
        barTTop0: barT.getBoundingClientRect().top,
      };
    });
    check(env.bodyMobile, "body.mobile set (coarse + <900)");
    check(env.hudDisp === "block", "#hud visible in aim phase");
    check(env.aimDisp !== "none", "#aimControls visible");
    check(env.fireDisp !== "none", "#fireBtn visible");

    // baseline offsets (insets 0)
    const before = await page.evaluate(OFFSETS, [...TOP_IDS, ...BOT_IDS]);
    const barBefore = env.barLinkTop0;
    // inject portrait insets
    await page.evaluate((sat, sab) => {
      document.documentElement.style.setProperty("--sat", sat + "px");
      document.documentElement.style.setProperty("--sab", sab + "px");
    }, SAT, SAB);
    const after = await page.evaluate(OFFSETS, [...TOP_IDS, ...BOT_IDS]);
    const bar = await page.evaluate(() => {
      const b = document.getElementById("bar");
      return {
        link: b.querySelector("a").getBoundingClientRect().top,
        title: b.querySelector(".t").getBoundingClientRect().top,
        barH: b.getBoundingClientRect().height,
      };
    });

    // #bar content (back link + title) must sit at/below the notch after inset injection
    check(bar.link >= SAT - 0.5, `#bar back link top >= injected --sat (${Math.round(bar.link)} >= ${SAT})`);
    check(bar.title >= SAT - 0.5, `#bar title top >= injected --sat (${Math.round(bar.title)} >= ${SAT})`);
    check(bar.link - barBefore > 30, `#bar content pushed down by ~sat (Δ${Math.round(bar.link - barBefore)})`);
    check(bar.barH > 46 + SAT - 1, `#bar height grew to ~46+sat (${Math.round(bar.barH)})`);

    // top HUD stack shifted below the taller bar
    for (const id of TOP_IDS) {
      check(after[id].top - before[id].top > 30, `#${id} moved down by ~sat (Δ${Math.round(after[id].top - before[id].top)})`);
      check(after[id].top >= SAT - 0.5, `#${id} top offset >= injected --sat (${Math.round(after[id].top)})`);
    }

    // bottom controls clear the gesture band (bottom OFFSET from viewport >= inset)
    for (const id of BOT_IDS) {
      check(after[id].bottom >= SAB - 0.5, `#${id} bottom offset >= injected --sab (${Math.round(after[id].bottom)} >= ${SAB})`);
      check(after[id].bottom - before[id].bottom > 15, `#${id} moved up with sab (Δ${Math.round(after[id].bottom - before[id].bottom)})`);
    }

    // ANDROID pass: with inset 0 the base is still >=20px above the bottom edge;
    // with inset 48 the controls clear the gesture band.
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--sat", "0px");
      document.documentElement.style.setProperty("--sab", "0px");
    });
    const zeroBot = await page.evaluate(OFFSETS, BOT_IDS);
    for (const id of BOT_IDS) {
      check(zeroBot[id].bottom >= 20 - 0.5, `[inset0] #${id} keeps >=20px base clearance (${Math.round(zeroBot[id].bottom)}px)`);
    }
    await page.evaluate((sab) => { document.documentElement.style.setProperty("--sab", sab + "px"); }, SAB_ANDROID);
    const androidBot = await page.evaluate(OFFSETS, BOT_IDS);
    for (const id of BOT_IDS) {
      check(androidBot[id].bottom >= SAB_ANDROID - 0.5, `[android sab=48] #${id} bottom offset >= 48 (${Math.round(androidBot[id].bottom)})`);
    }

    check(errors.length === 0, "0 pageerrors (" + (errors.slice(0, 2).join(" | ") || "none") + ")");

    if (sz.w === 390 && sz.h === 844) {
      await page.evaluate(() => {
        document.documentElement.style.setProperty("--sat", "47px");
        document.documentElement.style.setProperty("--sab", "34px");
      });
      await page.screenshot({ path: path.join(ROOT, "shots", "hayhemmobile-fixed.png") });
      console.log("  ✓ shot -> shots/hayhemmobile-fixed.png");
    }
    await page.close();
  }

  console.log(`\nPASS: hayhem mobile safe-area — ${PASS} checks`);
  await browser.close();
  if (server) try { server.kill(); } catch (_) {}
  process.exit(0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
