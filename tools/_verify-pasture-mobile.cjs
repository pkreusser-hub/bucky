#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Pasture Panic MOBILE PORTRAIT UI visibility fixes (2026-07-13).
 *
 * The game was LIVE and UNSTARTABLE on iPhone. Two critical bugs, both fixed here:
 *   1. The tall title menu (#titleOverlay, ~900-990px) did not scroll — .overlay was
 *      justify-content:center with no overflow-y, so on a 390x664 phone the "Start Game"
 *      button + Barn/Quests/Daily/Sprout/Pact + top char cards ran off-screen, unreachable.
 *   2. The bottom HUD (ability chip, co-op chips, loadout/passives rows, xp bar) and the top
 *      nav bar sat UNDER the iOS home-indicator / Android nav band and the notch — untappable.
 *
 * Fix pattern: :root safe-area vars (--sat/--sar/--sab/--sal = env(safe-area-inset-*)) and
 * every flagged fixed element's edge offset rewritten through the matching var
 * (e.g. #abilityChip bottom:calc(var(--sab) + 18px)); .overlay made scrollable
 * (overflow-y:auto + auto-margin ::before/::after pseudo spacers = centered when it fits,
 * scroll-from-top when it overflows). Insets resolve to 0 on desktop so nothing changes there.
 *
 * env(safe-area-inset-*) is 0 in headless Chrome (no device insets), so we SIMULATE insets by
 * overriding the CSS custom properties on <html> after load and re-measuring. That also proves
 * each element's offset is genuinely WIRED to the var (it MOVES when the var changes), not just
 * that the var exists.
 *
 * Firebase/Playroom/gstatic blocked (offline "this phone only" mode, per the herd-dup lesson).
 */
const fs = require("fs");
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PAGE = path.join(ROOT, "pasturepanic.html");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8879;
const BASE = `http://127.0.0.1:${PORT}`;

const SIZES = [
  { w: 390, h: 844, name: "iphone14" },
  { w: 390, h: 664, name: "iphone-safari-toolbar" },
  { w: 412, h: 915, name: "pixel" },
  { w: 360, h: 640, name: "small-android" },
  { w: 320, h: 568, name: "iphone-se" },
];
// bottom-anchored elements that must clear the OS band; xpBarWrap included (thin strip).
const BOTTOM_IDS = ["abilityChip", "abilityChipP1", "abilityChipP2", "hudBottomLeft", "hudBottomRight", "xpBarWrap"];

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

async function openPage(browser, size) {
  const page = await browser.newPage();
  await page.setViewport({ width: size.w, height: size.h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // coarse-pointer stub (matches the game's IS_TOUCH probe at line ~6074)
  await page.evaluateOnNewDocument(() => {
    const orig = window.matchMedia ? window.matchMedia.bind(window) : null;
    const mk = (q, m) => ({ matches: m, media: q, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } });
    window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? mk(q, true) : (orig ? orig(q) : mk(q, false)));
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/googleapis|firestore|firebase|gstatic|playroom|joinplayroom/i.test(req.url())) return req.abort();
    req.continue();
  });
  // domcontentloaded + explicit hook-wait (NOT networkidle0): the ~4.8MB of new intensity-music
  // mp3s keep the connection busy long past the 60s nav cap on a dsf-2 software-GL mobile viewport,
  // so networkidle0 never settles. The page itself is domReady in ~1s; __PP__ is the real readiness
  // signal and audio streams in the background without blocking any check below.
  await page.goto(BASE + "/pasturepanic.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__PP__, { timeout: 20000 });
  // one gesture (audio unlock)
  await page.mouse.move(size.w / 2, size.h / 2);
  await page.mouse.down(); await page.mouse.up();
  return { page, errors };
}

function setInsets(page, sab, sat, sal, sar) {
  return page.evaluate((sab, sat, sal, sar) => {
    const d = document.documentElement.style;
    d.setProperty("--sab", sab); d.setProperty("--sat", sat);
    d.setProperty("--sal", sal); d.setProperty("--sar", sar);
  }, sab, sat, sal || "0px", sar || "0px");
}
function measure(page) {
  return page.evaluate((ids) => {
    const out = { vh: window.innerHeight, vw: window.innerWidth, el: {} };
    for (const id of ids) {
      const e = document.getElementById(id);
      if (!e) { out.el[id] = null; continue; }
      const r = e.getBoundingClientRect();
      out.el[id] = { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height };
    }
    const barA = document.querySelector("#bar a");
    out.barTop = barA ? barA.getBoundingClientRect().top : null;
    return out;
  }, BOTTOM_IDS);
}

// ---------------- per-size HUD / inset checks ----------------
async function runHudSize(browser, size) {
  const { page, errors } = await openPage(browser, size);
  const checks = [];
  const C = (name, cond, detail) => checks.push({ name: `[${size.name} ${size.w}x${size.h}] ${name}`, pass: !!cond, detail: detail == null ? "" : String(detail) });

  // start a real solo game so #hud shows, then force-display the flagged HUD elements for a
  // deterministic rect (position CSS resolves the same whether display was forced or natural).
  await page.evaluate(() => window.__PP__.startGame());
  await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 6000 });
  await page.evaluate(() => {
    for (const id of ["abilityChip", "abilityChipP1", "abilityChipP2"]) { const e = document.getElementById(id); if (e) e.style.display = "flex"; }
    const xp = document.getElementById("xpBarWrap"); if (xp) xp.style.display = "block";
  });

  // baseline (no insets — env() -> 0 in headless)
  await setInsets(page, "0px", "0px", "0px", "0px");
  const B = await measure(page);

  // iOS home-indicator (34) + notch (47)
  const SAB = 34, SAT = 47;
  await setInsets(page, SAB + "px", SAT + "px", "0px", "0px");
  const I = await measure(page);
  const vh = I.vh;

  for (const id of BOTTOM_IDS) {
    const b = B.el[id], i = I.el[id];
    if (!b || !i) { C(`${id} present`, false, "element missing"); continue; }
    const moved = b.bottom - i.bottom; // lifted UP by ~SAB
    C(`${id} moved up ~${SAB}px when --sab injected (wired)`, Math.abs(moved - SAB) <= 2, `Δ=${moved.toFixed(1)}`);
    C(`${id} bottom edge clears the ${SAB}px band`, i.bottom <= vh - SAB + 0.6, `bottom=${i.bottom.toFixed(1)} <= ${vh - SAB}`);
  }
  // ability chip + co-op chips top below the notch (trivially true for bottom chips, asserted per spec)
  for (const id of ["abilityChip", "abilityChipP1", "abilityChipP2"]) {
    const i = I.el[id];
    if (i) C(`${id} top >= injected --sat (${SAT})`, i.top >= SAT - 0.6, `top=${i.top.toFixed(1)}`);
  }
  // top bar content pushed below the notch
  C(`#bar content top moved down ~${SAT}px when --sat injected (wired)`, I.barTop != null && B.barTop != null && Math.abs((I.barTop - B.barTop) - SAT) <= 3, `${B.barTop && B.barTop.toFixed(1)} -> ${I.barTop && I.barTop.toFixed(1)}`);
  C(`#bar content top >= injected --sat (${SAT})`, I.barTop != null && I.barTop >= SAT - 0.6, `barTop=${I.barTop && I.barTop.toFixed(1)}`);

  // Android nav band (48) — second pass
  const A_SAB = 48;
  await setInsets(page, A_SAB + "px", "0px", "0px", "0px");
  const A = await measure(page);
  for (const id of BOTTOM_IDS) {
    const b = B.el[id], a = A.el[id];
    if (!b || !a) continue;
    const moved = b.bottom - a.bottom;
    C(`${id} lifted for ${A_SAB}px android nav band`, a.bottom <= A.vh - A_SAB + 0.6 && Math.abs(moved - A_SAB) <= 2, `bottom=${a.bottom.toFixed(1)} <= ${A.vh - A_SAB}, Δ=${moved.toFixed(1)}`);
  }

  await page.close();
  return { checks, errors };
}

// ---------------- title-scroll checks ----------------
async function reach(page, sel) {
  return page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return { ok: false, reason: "missing" };
    const before = e.getBoundingClientRect();
    e.scrollIntoView({ block: "center", inline: "nearest" });
    const r = e.getBoundingClientRect();
    const vh = window.innerHeight;
    return { ok: r.top >= 0 && r.bottom <= vh + 0.6 && r.width > 0 && r.height > 0, top: r.top, bottom: r.bottom, vh, beforeBottom: before.bottom };
  }, sel);
}
async function runTitleSize(browser, size) {
  const { page, errors } = await openPage(browser, size);
  const checks = [];
  const C = (name, cond, detail) => checks.push({ name: `[title ${size.w}x${size.h}] ${name}`, pass: !!cond, detail: detail == null ? "" : String(detail) });

  // simulate iOS insets on the title too — padding must still keep everything reachable
  await setInsets(page, "34px", "47px", "0px", "0px");
  await page.waitForFunction(() => document.querySelector("#charRow .charcard"), { timeout: 8000 });

  // the overlay MUST be scrollable (overflow-y:auto) and taller-than-viewport at these sizes
  const scrollable = await page.evaluate(() => {
    const o = document.getElementById("titleOverlay");
    const cs = getComputedStyle(o);
    return { overflowY: cs.overflowY, scrollH: o.scrollHeight, clientH: o.clientHeight };
  });
  C("titleOverlay overflow-y is auto/scroll", /auto|scroll/.test(scrollable.overflowY), scrollable.overflowY);
  C("titleOverlay content overflows the viewport (scroll needed)", scrollable.scrollH > scrollable.clientH + 1, `scrollH=${scrollable.scrollH} clientH=${scrollable.clientH}`);

  // Start Game reachable (in viewport OR scrollable into view)
  const start = await reach(page, "#startBtn");
  C("Start Game button reachable (scrollable into view)", start.ok, JSON.stringify(start));

  // every title control reachable via scroll
  for (const [label, sel] of [
    ["Barn Upgrades", "#barnBtn"], ["Quests", "#questsBtn"], ["Daily Run", "#dailyBtn"],
    ["Little Sprout", "#sproutBtn"], ["Stampede Pact", "#pactBtn"], ["first char card", "#charRow .charcard"],
  ]) {
    const r = await reach(page, sel);
    C(`${label} reachable via scroll`, r.ok, JSON.stringify(r));
  }

  // enter a game via the char flow (select a char, scroll Start into view, real click)
  await page.evaluate(() => { const c = document.querySelector("#charRow .charcard"); if (c) c.click(); });
  await page.evaluate(() => document.getElementById("startBtn").scrollIntoView({ block: "center" }));
  const box = await page.evaluate(() => { const r = document.getElementById("startBtn").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(box.x, box.y);
  let started = false;
  try { await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 6000 }); started = true; } catch (_) {}
  C("Start actually launches the game (char flow -> click)", started, `state=${await page.evaluate(() => window.__PP__.state)}`);

  await page.close();
  return { checks, errors };
}

// ---------------- static source checks ----------------
function runStaticChecks() {
  const src = fs.readFileSync(PAGE, "utf8");
  const checks = [];
  const C = (name, cond, detail) => checks.push({ name: `[static] ${name}`, pass: !!cond, detail: detail == null ? "" : String(detail) });
  // :root defines all four safe-area vars from env(safe-area-inset-*)
  const rootBlock = (src.match(/:root\{[\s\S]*?\}/) || [""])[0];
  for (const [v, prop] of [["--sat", "top"], ["--sar", "right"], ["--sab", "bottom"], ["--sal", "left"]]) {
    C(`:root defines ${v} = env(safe-area-inset-${prop})`, new RegExp(`${v}\\s*:\\s*env\\(safe-area-inset-${prop}`).test(rootBlock), "");
  }
  // each flagged selector's offset references the matching var
  const flagged = [
    ["#bar padding uses --sat", /#bar\{[^}]*padding:\s*var\(--sat\)/],
    ["#bar height uses --sat", /#bar\{[^}]*height:\s*calc\(46px \+ var\(--sat\)\)/],
    ["#stage top uses --sat", /#stage\{[^}]*top:\s*calc\(46px \+ var\(--sat\)\)/],
    [".overlay scrolls (overflow-y:auto)", /\.overlay\{[^}]*overflow-y:\s*auto/],
    ["#abilityChip bottom uses --sab", /#abilityChip\{[^}]*bottom:\s*calc\(var\(--sab\)/],
    ["#abilityChip mobile bottom uses --sab", /#abilityChip\{[^}]*bottom:\s*calc\(var\(--sab\) \+ 18px\)/],
    [".abChipCoop bottom uses --sab", /\.abChipCoop\{[^}]*bottom:\s*calc\(var\(--sab\)/],
    [".abChipCoop left uses --sal", /\.abChipCoop\{[^}]*left:\s*calc\(var\(--sal\)/],
    [".abChipCoop.abR right uses --sar", /\.abChipCoop\.abR\{[^}]*right:\s*calc\(var\(--sar\)/],
    ["#hudBottomLeft bottom uses --sab", /#hudBottomLeft\{[^}]*bottom:\s*calc\(var\(--sab\)/],
    ["#hudBottomRight bottom uses --sab", /#hudBottomRight\{[^}]*bottom:\s*calc\(var\(--sab\)/],
    ["#xpBarWrap bottom uses --sab", /#xpBarWrap\{[^}]*bottom:\s*var\(--sab\)/],
  ];
  for (const [name, re] of flagged) C(name, re.test(src), "");
  return { checks, errors: [] };
}

// ---------------- screenshots ----------------
async function shots(browser) {
  const checks = [];
  const C = (name, cond, detail) => checks.push({ name: `[shots] ${name}`, pass: !!cond, detail: detail == null ? "" : String(detail) });
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  // fixed title @ 390x664
  {
    const { page } = await openPage(browser, { w: 390, h: 664, name: "shot-title" });
    await setInsets(page, "34px", "47px", "0px", "0px");
    await page.waitForFunction(() => document.querySelector("#charRow .charcard"), { timeout: 8000 });
    const out = path.join(SHOTS, "ppmobile-fixed-title.png");
    await page.screenshot({ path: out });
    C("title screenshot written", fs.existsSync(out), out);
    await page.close();
  }
  // fixed play HUD w/ insets @ 390x844
  {
    const { page } = await openPage(browser, { w: 390, h: 844, name: "shot-play" });
    await page.evaluate(() => window.__PP__.startGame());
    await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 6000 });
    await setInsets(page, "34px", "47px", "0px", "0px");
    await page.evaluate(() => { const e = document.getElementById("abilityChip"); if (e) e.style.display = "flex"; });
    await new Promise((r) => setTimeout(r, 400));
    const out = path.join(SHOTS, "ppmobile-fixed-play.png");
    await page.screenshot({ path: out });
    C("play HUD screenshot written", fs.existsSync(out), out);
    await page.close();
  }
  return { checks, errors: [] };
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
    args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  });

  let allOk = true;
  const runOne = (label, r) => {
    console.log(`\n=== ${label} ===`);
    let passOk = true;
    for (const c of r.checks) {
      const mark = c.pass ? "PASS" : "FAIL";
      if (!c.pass) passOk = false;
      console.log(`  [${mark}] ${c.name}${c.detail !== "" ? "  (" + c.detail + ")" : ""}`);
    }
    if (r.errors && r.errors.length) {
      passOk = false;
      console.log(`  PAGE ERRORS (${r.errors.length}):`);
      for (const e of r.errors) console.log("    " + e);
    }
    const total = r.checks.length, pass_ = r.checks.filter((c) => c.pass).length;
    console.log(`  -> ${pass_}/${total} checks passed, ${r.errors ? r.errors.length : 0} pageerrors`);
    if (!passOk) allOk = false;
  };

  try {
    runOne("STATIC source checks", runStaticChecks());
    for (const size of SIZES) runOne(`HUD / inset checks ${size.name}`, await runHudSize(browser, size));
    for (const size of [{ w: 390, h: 664 }, { w: 320, h: 568 }]) runOne(`TITLE scroll checks ${size.w}x${size.h}`, await runTitleSize(browser, size));
    runOne("SCREENSHOTS", await shots(browser));
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  console.log(allOk ? "\nALL PASSES GREEN" : "\nSOME CHECKS FAILED");
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
