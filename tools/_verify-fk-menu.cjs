#!/usr/bin/env node
"use strict";
/**
 * Farm Kart — TITLE SCREEN + MENU v3 (2026-10-12).
 *
 * What it proves:
 *   - a bare boot opens the title (attract mode) with the flyover camera actually moving,
 *     and ANY key / tap / pad button drops into home — never into a race;
 *   - deep links (?track=), ?notitle=1 and returning from a race never show the title;
 *   - keyboard + gamepad focus navigation (arrows / d-pad move, Enter / A select, Esc / B back,
 *     Esc never leaves the MP lobby);
 *   - the menu camera geometry: the parked kart is projected exactly `shift` px right of centre on
 *     desktop (0.17·W garage, 0.21·W showroom) and 0.30·H below centre on phones — hand-computed
 *     from the viewport, not read back from the page;
 *   - starting a race hands the camera back cleanly (no view offset, chase FOV, chase distance);
 *   - the menu chrome carries no emoji (house rule), the RACE bar stays on-screen on long grids,
 *     no horizontal scroll on a phone, 0 pageerrors.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8962;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function check(cond, msg, detail) {
  if (cond) { pass++; console.log("  ok   " + msg); }
  else { fail++; console.log("  FAIL " + msg + (detail !== undefined ? "  -> " + JSON.stringify(detail) : "")); }
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
          http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await sleep(200);
  }
  throw new Error("server timeout");
}

// Optional fake gamepad (window.__pad.buttons[i] = true to press). Installed before page scripts.
function padStub() {
  window.__pad = { buttons: new Array(17).fill(false), axes: [0, 0, 0, 0] };
  navigator.getGamepads = () => [{
    id: "fake", index: 0, connected: true, mapping: "standard",
    axes: window.__pad.axes,
    buttons: window.__pad.buttons.map((p) => ({ pressed: p, value: p ? 1 : 0 })),
  }];
}
function coarseStub() {
  const m = window.matchMedia.bind(window);
  window.matchMedia = (q) => /coarse/.test(q)
    ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
    : m(q);
}

async function openPage(browser, url, { w = 1280, h = 800, mobile = false, pad = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    // never touch production Firestore / Playroom (and keep the font CDN out — fallback type is fine)
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(req.url())) return req.abort();
    req.continue();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
  if (mobile) await page.evaluateOnNewDocument(coarseStub);
  if (pad) await page.evaluateOnNewDocument(padStub);
  await page.goto(BASE + url, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.MenuFlow), { timeout: 30000 });
  await sleep(600);
  return { page, errors };
}

const frames = (page, n) => page.evaluate((n) => new Promise((r) => {
  let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
// wait until the menu camera has glided onto its target (shift eased in, position/look converged)
async function settle(page, shiftX, shiftY) {
  await page.waitForFunction((sx, sy) => {
    const M = window.__KART__.MenuCam;
    return Math.abs(M.shift - sx) < 0.5 && Math.abs(M.shiftY - sy) < 0.5;
  }, { timeout: 60000 }, shiftX, shiftY);
  await frames(page, 2);
}
// projected screen position of the menu camera's look target (the parked kart, +0.9 up)
const PROJECT_LOOK = () => {
  const K = window.__KART__, cam = K.camera, M = K.MenuCam;
  const v = M.look.clone().project(cam);
  return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, mode: M.mode, shift: M.shift, shiftY: M.shiftY };
};

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    // detached = own process group, so the cleanup below takes down npx AND the http-server under it
    // (killing only the shell wrapper leaves a server squatting the port, serving this ROOT to the
    // next run — which once made a run against a different checkout silently test this one).
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1", "-s"], { cwd: ROOT, stdio: "ignore", shell: true, detached: true });
  }
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  try {
    // ======================= DESKTOP: title → home → navigation =======================
    console.log("desktop 1280x800, bare boot");
    const { page, errors } = await openPage(browser, "/farmkart.html");
    const t0 = await page.evaluate(() => ({
      titleShown: document.getElementById("fkTitle").offsetParent !== null,
      overlayTitle: document.getElementById("startOverlay").classList.contains("title"),
      mode: window.__KART__.MenuCam.mode, phase: window.__KART__.G.phase,
      anyScreen: !!document.querySelector(".mfScreen.on"),
      prompt: document.getElementById("fkTitlePrompt").textContent,
      cam: window.__KART__.camera.position.toArray(),
    }));
    check(t0.titleShown && t0.overlayTitle, "bare boot shows the title screen", t0);
    check(t0.mode === "title" && t0.phase === "menu", "title runs the flyover camera on the menu phase", t0);
    check(!t0.anyScreen, "no menu screen is live behind the title");
    check(t0.prompt === "Press any button", "desktop prompt reads 'Press any button'", t0.prompt);
    // flyover runs 12 u/s of SIM time along the racing line. Swiftshader frame pacing makes wall
    // time meaningless, so wait for one sim-second of travel (MenuCam.s += 12) and measure the camera.
    const s0 = await page.evaluate(() => window.__KART__.MenuCam.s);
    await page.waitForFunction((s0) => window.__KART__.MenuCam.s >= s0 + 12, { timeout: 30000 }, s0);
    const cam1 = await page.evaluate(() => window.__KART__.camera.position.toArray());
    const moved = Math.hypot(cam1[0] - t0.cam[0], cam1[2] - t0.cam[2]);
    check(moved > 6, "flyover camera actually travels (>6u per 12u of track)", moved);

    // ---- no emoji anywhere in the menu chrome (all screens are built at boot, just hidden) ----
    // #legacyMenu is the pre-2026-07-10 control set kept hidden (display:none) only so its JS wiring
    // stays valid (docs/farm-kart.md MENU OVERHAUL) — never rendered, so it is not menu chrome.
    const emoji = await page.evaluate(() => {
      const ov = document.getElementById("startOverlay").cloneNode(true);
      const lg = ov.querySelector("#legacyMenu"); if (lg) lg.remove();
      const txt = ov.textContent;
      const ex = txt.match(/\p{Extended_Pictographic}/gu) || [];
      return ex.filter((c) => !/[©®™]/.test(c));
    });
    check(emoji.length === 0, "menu chrome contains no emoji", emoji.slice(0, 12).join(" "));

    // ---- any key dismisses the title (Enter must NOT also reach advance()) ----
    await page.keyboard.press("Enter");
    await sleep(800);
    const h0 = await page.evaluate(() => ({
      cur: MenuFlow._cur, titleHidden: document.getElementById("fkTitle").hidden,
      active: MenuFlow.Title.active, mode: window.__KART__.MenuCam.mode, phase: window.__KART__.G.phase,
      overlayHome: document.getElementById("startOverlay").classList.contains("home"),
    }));
    check(h0.cur === "home" && h0.titleHidden && !h0.active, "Enter on the title opens home", h0);
    check(h0.phase === "menu", "dismissing the title never starts a race", h0.phase);
    check(h0.mode === "garage" && h0.overlayHome, "home uses the garage orbit + home chrome", h0);

    // ---- keyboard focus navigation ----
    const focusName = () => page.evaluate(() => {
      const a = document.activeElement; return a ? (a.textContent || "").trim().slice(0, 14) : null;
    });
    await page.keyboard.press("ArrowDown");
    const f1 = await focusName();
    await page.keyboard.press("ArrowDown");
    const f2 = await focusName();
    await page.keyboard.press("ArrowUp");
    const f3 = await focusName();
    check(/^Single Player/.test(f1), "first ArrowDown focuses the first item", f1);
    check(/^Multiplayer/.test(f2), "ArrowDown moves to the next item", f2);
    check(/^Single Player/.test(f3), "ArrowUp moves back", f3);
    await page.keyboard.press("Enter");
    await sleep(400);
    const s1 = await page.evaluate(() => ({ cur: MenuFlow._cur, crumbs: document.getElementById("mfCrumbs").textContent,
      hints: document.getElementById("mfHints").textContent, phase: window.__KART__.G.phase }));
    check(s1.cur === "sp" && s1.phase === "menu", "Enter activates the focused item (Single Player)", s1);
    check(s1.crumbs === "Single Player", "breadcrumb shows the screen", s1.crumbs);
    check(/Esc\s*Back/i.test(s1.hints), "hint bar offers Esc = Back on a deep screen", s1.hints);
    const kbFocus = await focusName();
    check(/^Time Trial/.test(kbFocus), "keyboard users land focused on the new screen's first item", kbFocus);
    await page.keyboard.press("Escape");
    await sleep(300);
    const s2 = await page.evaluate(() => ({ cur: MenuFlow._cur, hints: document.getElementById("mfHints").textContent }));
    check(s2.cur === "home", "Esc goes back to home", s2.cur);
    check(!/Back/i.test(s2.hints), "home hint bar has no Back", s2.hints);

    // ---- garage camera geometry (hand-computed: kart at W/2 + 0.17·W, vertical centre) ----
    await settle(page, 0.17 * 1280, 0);
    const g = await page.evaluate(PROJECT_LOOK);
    const W = 1280, H = 800;
    check(Math.abs(g.x - (W / 2 + 0.17 * W)) < 6, "garage: kart projected at W/2 + 0.17W = 857.6px", g);
    check(Math.abs(g.y - H / 2) < 6, "garage: kart projected at vertical centre", g);
    const panelRight = await page.evaluate(() => document.querySelector('.mfScreen.on .mfBig').getBoundingClientRect().right);
    check(g.x > panelRight + 150, "garage: kart sits clear of the menu panel", { kart: g.x, panelRight });

    // ---- showroom on racer select + live recolour ----
    await page.evaluate(() => { MenuFlow._selCourse("wario-stadium"); MenuFlow._openRacer("trial"); });
    await settle(page, 0.21 * 1280, 0);
    const r = await page.evaluate(PROJECT_LOOK);
    check(r.mode === "showroom", "racer select switches to the showroom orbit", r.mode);
    check(Math.abs(r.x - (W / 2 + 0.21 * W)) < 6, "showroom: kart projected at W/2 + 0.21W = 908.8px", r);
    const raceBtn = await page.evaluate(() => {
      const b = document.querySelector('.mfScreen.on .mfRace').getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, ih: innerHeight };
    });
    check(raceBtn.bottom <= raceBtn.ih && raceBtn.top >= 0, "RACE button is on-screen without scrolling (sticky bar)", raceBtn);

    // ---- sound toggle in the top bar ----
    const snd = await page.evaluate(() => {
      const b = document.getElementById("mfSoundBtn"); const before = localStorage.getItem("fk_muted");
      b.click(); const after = localStorage.getItem("fk_muted"); const off = b.classList.contains("off");
      b.click(); return { before, after, off, back: localStorage.getItem("fk_muted"), visible: b.offsetParent !== null };
    });
    check(snd.visible && snd.after === "1" && snd.off && snd.back === "0", "top-bar sound button toggles fk_muted", snd);
    const legacyHidden = await page.evaluate(() => document.getElementById("muteBtn").offsetParent === null);
    check(legacyHidden, "the race mute button is hidden while the menu is up (no duplicate)");

    // ---- RACE: the camera is handed back to the chase cam cleanly ----
    await page.evaluate(() => document.querySelector('.mfScreen.on .mfRace').click());
    await sleep(500);
    const c = await page.evaluate(() => {
      const K = window.__KART__, cam = K.camera, p = K.G.players.local;
      return { phase: K.G.phase, view: !!(cam.view && cam.view.enabled), fov: cam.fov, fovEff: K.fovEff(),
        dist: Math.hypot(cam.position.x - p.pos.x, cam.position.z - p.pos.z),
        overlay: getComputedStyle(document.getElementById("startOverlay")).display,
        bodyMenu: document.body.classList.contains("fkMenu") };
    });
    check(c.phase === "countdown", "RACE starts the countdown", c.phase);
    check(!c.view, "projection shift is cleared once racing", c);
    check(Math.abs(c.fov - c.fovEff) < 0.5, "chase FOV restored", c);
    check(c.dist > 1.5 && c.dist < 6, "camera is back behind the kart (chase distance)", c.dist);
    check(c.overlay === "none" && !c.bodyMenu, "menu chrome is gone in the race", c);

    // ---- back to the menu: home, never the title ----
    await page.evaluate(() => window.__KART__.toMenu());
    await sleep(500);
    const m = await page.evaluate(() => ({ cur: MenuFlow._cur, title: MenuFlow.Title.active, mode: window.__KART__.MenuCam.mode }));
    check(m.cur === "home" && !m.title && m.mode === "garage", "returning from a race lands on home (no title)", m);
    check(errors.length === 0, "desktop: 0 pageerrors", errors);
    await page.close();

    // ======================= GAMEPAD =======================
    console.log("gamepad");
    {
      const { page: gp, errors: ge } = await openPage(browser, "/farmkart.html", { pad: true });
      // hold each press for 3 rendered frames (the pad is polled per rAF; swiftshader frames are slow)
      const tap = async (i) => { await gp.evaluate((i) => { window.__pad.buttons[i] = true; }, i); await frames(gp, 3);
        await gp.evaluate((i) => { window.__pad.buttons[i] = false; }, i); await frames(gp, 3); };
      const pr = await gp.evaluate(() => document.getElementById("fkTitlePrompt").textContent);
      check(pr === "Press A", "title prompt switches to 'Press A' with a pad connected", pr);
      await tap(0);
      await sleep(700);
      check(await gp.evaluate(() => MenuFlow._cur === "home"), "pad A dismisses the title");
      // d-pad: hold ONE frame — held past 380ms of wall time it auto-repeats (by design), and a
      // swiftshader frame can be ~150ms
      const nudge = async (i) => { await gp.evaluate((i) => { window.__pad.buttons[i] = true; }, i); await frames(gp, 1);
        await gp.evaluate((i) => { window.__pad.buttons[i] = false; }, i); await frames(gp, 2); };
      // a pad user lands ALREADY focused on the first item (like keyboard users), so one nudge = item 2
      const f0 = await gp.evaluate(() => (document.activeElement.textContent || "").trim().slice(0, 13));
      check(/^Single Player/.test(f0), "after pad A, home opens focused on the first item", f0);
      await nudge(13);
      const f = await gp.evaluate(() => (document.activeElement.textContent || "").trim().slice(0, 11));
      check(/^Multiplayer/.test(f), "d-pad down moves focus to the second item", f);
      await tap(0);
      await sleep(300);
      check(await gp.evaluate(() => MenuFlow._cur === "mp-home"), "pad A opens the focused item");
      await tap(1);
      await sleep(300);
      check(await gp.evaluate(() => MenuFlow._cur === "home"), "pad B goes back");
      const hints = await gp.evaluate(() => document.getElementById("mfHints").textContent);
      check(/Select/.test(hints) && /A/.test(hints), "hint bar shows pad buttons", hints);
      // Esc / B must never leave the MP lobby (that would drop the room)
      await gp.evaluate(() => MenuFlow.show("mp-wait"));
      await tap(1);
      await gp.keyboard.press("Escape");
      await sleep(200);
      check(await gp.evaluate(() => MenuFlow._cur === "mp-wait"), "B / Esc never leave the MP lobby");
      check(ge.length === 0, "gamepad: 0 pageerrors", ge);
      await gp.close();
    }

    // ======================= skips: ?notitle=1 and ?track= deep link =======================
    console.log("skips");
    {
      const { page: p2, errors: e2 } = await openPage(browser, "/farmkart.html?notitle=1");
      const s = await p2.evaluate(() => ({ cur: MenuFlow._cur, title: MenuFlow.Title.active }));
      check(s.cur === "home" && !s.title, "?notitle=1 boots straight to home", s);
      check(e2.length === 0, "notitle: 0 pageerrors", e2);
      await p2.close();
      const { page: p3, errors: e3 } = await openPage(browser, "/farmkart.html?track=amen-farms");
      const d = await p3.evaluate(() => ({ phase: window.__KART__.G.phase, title: MenuFlow.Title.active,
        shown: document.getElementById("fkTitle").offsetParent !== null }));
      check(d.phase !== "menu" && !d.title && !d.shown, "a ?track= deep link races without the title", d);
      check(e3.length === 0, "deep link: 0 pageerrors", e3);
      await p3.close();
    }

    // ======================= MOBILE 390x844 =======================
    console.log("mobile 390x844 (coarse pointer)");
    {
      const { page: mp, errors: me } = await openPage(browser, "/farmkart.html", { w: 390, h: 844, mobile: true });
      const pr = await mp.evaluate(() => document.getElementById("fkTitlePrompt").textContent);
      check(pr === "Tap to start", "phone prompt reads 'Tap to start'", pr);
      await mp.tap("#fkTitle");
      await settle(mp, 0, 0.3 * 844);
      const s = await mp.evaluate(() => ({ cur: MenuFlow._cur, sw: document.documentElement.scrollWidth,
        hints: document.getElementById("mfHints").offsetParent === null,
        focused: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest("#menuFlow")) }));
      check(s.cur === "home", "tap on the title opens home", s);
      check(s.sw <= 390, "no horizontal scroll on a phone", s.sw);
      check(s.hints, "control hints are hidden on touch");
      check(!s.focused, "touch never leaves a focus highlight", s);
      const g2 = await mp.evaluate(PROJECT_LOOK);
      // phones: kart dropped into the lower third → centre + 0.30·H = 422 + 253.2 = 675.2px
      check(Math.abs(g2.x - 195) < 6 && Math.abs(g2.y - (844 / 2 + 0.3 * 844)) < 6,
        "phone garage: kart projected at (W/2, H/2 + 0.30H) = (195, 675.2)", g2);
      const listBottom = await mp.evaluate(() => document.querySelector(".mfScreen.on .mfBig").getBoundingClientRect().bottom);
      check(listBottom < g2.y - 60, "phone: the home list ends above the kart", { listBottom, kart: g2.y });
      // touch input never stays latched when the page loses focus (2026-10-12 review fix): hold
      // DRIFT + slide-steer in a race, then blur the window like an app switch would
      await mp.evaluate(() => window.__KART__.startCountdown());
      const held = await mp.evaluate(() => {
        const z = document.getElementById("tcSteer"), d = document.getElementById("tcDrift");
        const pe = (t, x, id) => new PointerEvent(t, { pointerId: id, clientX: x, clientY: 600, bubbles: true, cancelable: true, pointerType: "touch" });
        z.dispatchEvent(pe("pointerdown", 100, 7)); z.dispatchEvent(pe("pointermove", 180, 7));
        d.dispatchEvent(pe("pointerdown", 330, 8));
        const T = window.__KART__.touch; const before = { steer: T.steer, drift: T.drift };
        window.dispatchEvent(new Event("blur"));
        return { before, after: { steer: T.steer, drift: T.drift, press: d.classList.contains("press") } };
      });
      check(held.before.steer === -1 && held.before.drift === true, "phone: slide-right steer + DRIFT register as held", held.before);
      check(held.after.steer === 0 && held.after.drift === false && !held.after.press, "phone: losing focus releases steer + drift", held.after);
      check(me.length === 0, "mobile: 0 pageerrors", me);
      await mp.close();
    }
  } finally {
    await browser.close();
    if (server) { try { process.kill(-server.pid, "SIGTERM"); } catch (e) {} }
  }
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
