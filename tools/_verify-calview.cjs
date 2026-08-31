#!/usr/bin/env node
"use strict";
/**
 * BUCKY Plan-calendar landing suite — opening Plan lands on the month, on today, and the
 * Week chip puts TODAY'S OWN CARD at the top of the screen (user spec, 2026-08-10).
 *
 *   node tools/_verify-calview.cjs [--shots]
 *
 * Drives the REAL page in Chrome at 390x844 and 1280x900, with the calendar Netlify
 * function ROUTE-MOCKED (this suite never touches netlify/functions/* or Google).
 *
 * FIREBASE IS BLOCKED THROUGHOUT (googleapis / firestore / firebase / gstatic). Not
 * optional hygiene: an unblocked headless run against index.html has twice duplicated the
 * live family herd, and blocking it is also what forces the app onto its local backend,
 * which is what makes these runs deterministic and per-context.
 *
 * THE CHECK THAT MATTERS MOST is the negative one in section D: a data-driven repaint
 * while the reader is browsing another month must NOT snap them back to today. The reset
 * lives in goTo() precisely so that render() — which also runs on every calendar refresh —
 * is never a seam that can yank someone out of the month they are reading.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8874;
const BASE = "http://127.0.0.1:" + PORT;
const SHOT = process.argv.includes("--shots");

let pass = 0;
const fails = [];
const ok = (c, m) => (c ? (pass++, console.log("  ✓ " + m)) : (fails.push(m), console.log("  ✗ " + m)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".json":"application/json", ".css":"text/css", ".png":"image/png", ".jpg":"image/jpeg",
  ".webmanifest":"application/manifest+json" };

function serve(){
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/index.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
        res.statusCode = 404; return res.end("not found");
      }
      res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

const NOISE = /Failed to load resource|dynamically imported module|gstatic|firebase|ERR_FAILED|ERR_BLOCKED/i;
const contexts = [];

async function newPage(browser, viewport){
  const ctx = await browser.createBrowserContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on("pageerror", (e) => { if (!NOISE.test(String(e))) errors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push("console: " + m.text()); });

  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const url = r.url();
    if (/googleapis|firestore|firebase|gstatic/i.test(url)) return r.abort();
    if (url.includes("/.netlify/functions/calendar")){
      return r.respond({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, events: [], status: { configured: true, saEmail: "x@y.z" } }) });
    }
    if (url.includes("/.netlify/functions/")){
      return r.respond({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (/^https?:\/\/(?!127\.0\.0\.1)/.test(url)) return r.abort();
    r.continue();
  });

  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("choreUnlocked", "amenfarms");
    if (!localStorage.getItem("choreUser")) localStorage.setItem("choreUser", "Mom");
    window.prompt = () => null; window.alert = () => {}; window.confirm = () => true;
  });
  return { page, errors };
}

async function boot(page){
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__NAV__ && window.__CAL__, { timeout: 20000 });
  await sleep(600);
}

const gotoTab = async (page, tab) => {
  await page.evaluate((t) => window.__NAV__.goTo(t), tab);
  await sleep(350);
};
const calState = (page) => page.evaluate(() => window.__CAL__.state());
const todayKey = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};

/**
 * Where today's own week card sits relative to the sticky controls above it.
 * Selected by `.today` — the class the week feed has ALWAYS put on today's card — and not
 * by this change's own data-today-anchor, so the measurement is of the user-visible
 * position and stays meaningful against a build that predates the anchor.
 */
const weekAnchorGap = (page) => page.evaluate(() => {
  const card = document.querySelector(".cal-daycard.today");
  const ctl = document.querySelector(".cal-controls");
  if (!card) return { found: false };
  return {
    found: true,
    top: card.getBoundingClientRect().top,
    ctlBottom: ctl ? ctl.getBoundingClientRect().bottom : null,
    vh: window.innerHeight,
  };
});

async function run(){
  const srv = await serve();
  // RESTAGED 2026-08-31: this suite was authored in a CLOUD session and hardcoded that
  // environment's browser (/opt/pw-browsers/chromium — a Linux path). It had never run on
  // the family's own machine in this form; the first local run failed at launch, which is
  // an environment bug, not a calendar one. channel:"chrome" is how every sibling suite
  // (calnotify, news, the whole index battery) finds the locally installed Chrome;
  // BUCKY_CHROME stays honored for anyone pinning a specific binary, cloud included.
  const browser = await puppeteer.launch({
    ...(process.env.BUCKY_CHROME ? { executablePath: process.env.BUCKY_CHROME } : { channel: "chrome" }),
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  const TODAY = todayKey();
  const otherMonth = (() => {           // a month that is definitely not this one
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 2);
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-15";
  })();

  try {
    /* ---- A · a fresh open lands on the month, on today ---------------------- */
    console.log("\nA. Opening Plan lands on the month, on today");
    const { page, errors } = await newPage(browser, { width: 390, height: 844, deviceScaleFactor: 1 });
    await boot(page);
    await gotoTab(page, "calendar");
    let s = await calState(page);
    ok(s.view === "month", `the calendar opens on the month view (got "${s.view}")`);
    ok(s.selected === TODAY, `today is the selected day (${s.selected})`);
    ok(s.focus === TODAY, `the month is anchored on today (${s.focus})`);
    const monthCells = await page.evaluate(() =>
      document.querySelectorAll(".cal-cell, .cal-day").length > 20);
    ok(monthCells, "a month grid is actually on screen");
    if (SHOT) await page.screenshot({ path: path.join(SHOTS, "cal_open_month_390.png") });

    /* ---- B · the view does not survive leaving the tab ---------------------- */
    console.log("\nB. A week/day view lasts only as long as the visit that chose it");
    await page.evaluate(() => window.__CAL__.setView("week"));
    await sleep(400);
    ok((await calState(page)).view === "week", "switching to the week view works");
    await gotoTab(page, "chores");
    await gotoTab(page, "calendar");
    s = await calState(page);
    ok(s.view === "month", `coming back through the nav is the month again (got "${s.view}")`);
    ok(s.selected === TODAY, "…with today selected");

    await page.evaluate(() => window.__CAL__.setView("day"));
    await sleep(300);
    await gotoTab(page, "dashboard");
    await gotoTab(page, "calendar");
    ok((await calState(page)).view === "month", "the same is true of the day view");

    ok(await page.evaluate(() => localStorage.getItem("bucky_cal_view") === null),
      "no view is persisted — nothing to restore a stale one from");

    /* ---- C · every entry point, not just the nav button --------------------- */
    console.log("\nC. Every way into the calendar lands the same");
    // Both are REAL DOM clicks. index.html's script is type="module", so its functions are
    // not globals — a test cannot call goToCalendar() (or any of them) off window, and
    // trying reads as "the click did nothing". Driving the actual controls is also what
    // catches a wiring regression, which calling the function directly never would.
    for (const [label, jump] of [
      ["the Home calendar widget", () => document.querySelector(".home2 .calwidget")?.click()],
      ["the Plan sub-nav chip", () => {
        const c = [...document.querySelectorAll("#subnav .sub")].find(b => b.dataset.key === "calendar");
        c && c.click();
      }],
    ]){
      await gotoTab(page, "calendar");
      await page.evaluate(() => { window.__CAL__.setView("week"); });
      await sleep(300);
      // Leave to a sibling of the SAME area for the chip (that is how a chip is reached),
      // and to Home for the widget.
      await gotoTab(page, label.includes("chip") ? "animalcare" : "dashboard");
      await page.evaluate(jump);
      await sleep(400);
      const arrived = await page.evaluate(() => window.__NAV__.tab());
      if (arrived !== "calendar"){ ok(false, `${label} reaches the calendar (got "${arrived}")`); continue; }
      const st = await calState(page);
      ok(st.view === "month" && st.selected === TODAY, `${label} lands on the month, on today`);
    }

    /* ---- D · THE NEGATIVE: a repaint must not move a reader ------------------ */
    console.log("\nD. A data refresh never yanks a reader out of the month they are browsing");
    await gotoTab(page, "calendar");
    await page.evaluate((k) => window.__CAL__.setFocus(k), otherMonth);
    await sleep(300);
    ok((await calState(page)).focus === otherMonth, `browsed forward to ${otherMonth}`);
    await page.evaluate(() => window.__CAL__.setEvents([
      { id: "e1", title: "Feed run", start: new Date().toISOString(), end: new Date(Date.now()+3600e3).toISOString(), allDay: false, notes: "" },
    ]));
    await sleep(350);
    ok((await calState(page)).focus === otherMonth,
      "events arriving (a real renderCalendar) leaves the browsed month alone");
    await page.evaluate(() => window.__CAL__.setStatus({ configured: true, saEmail: "x@y.z" }));
    await sleep(300);
    ok((await calState(page)).focus === otherMonth, "…and so does a status refresh");
    await gotoTab(page, "chores");
    await gotoTab(page, "calendar");
    ok((await calState(page)).focus === TODAY, "but a real navigation does bring it back to today");

    /* ---- E · the week feed opens with TODAY at the top ---------------------- */
    console.log("\nE. The Week chip puts today's own card at the top of the screen");
    await page.evaluate(() => window.__CAL__.setView("week"));
    await sleep(700);
    let g = await weekAnchorGap(page);
    ok(g.found, "today's card is rendered in the week feed");
    ok(await page.evaluate(() =>
      document.querySelectorAll('.cal-daycard[data-today-anchor="1"]').length === 1),
      "exactly one card carries the scroll anchor");
    // A sanity bound only, and a DATE-DEPENDENT one: weeks start Sunday, so run this on a
    // Monday and even the old separator-anchored feed put today inside 40% of the screen.
    // The date-independent check is the "FIRST card below the controls" one below — that is
    // the assertion that actually fails on a build without this fix, on any day of the week.
    ok(g.found && g.top > 0 && g.top < g.vh * 0.4,
      `today's card is at the top of the screen (${Math.round(g.top || -1)}px of ${g.vh})`);
    ok(g.found && g.ctlBottom !== null && Math.abs(g.top - g.ctlBottom) < 24,
      `it sits right under the sticky controls (card ${Math.round(g.top)}, controls end ${Math.round(g.ctlBottom)})`);
    // The property that matters is "today is the first thing you see", not any particular
    // coordinate for the week label: weeks start on Sunday, so on a Monday the label sits a
    // few px up, tucked BEHIND the sticky controls rather than off the top of the document.
    // So ask the question directly — is any other day's card above today's, in view?
    const firstVisible = await page.evaluate(() => {
      const ctl = document.querySelector(".cal-controls");
      const y = ctl ? ctl.getBoundingClientRect().bottom : 0;
      const cards = [...document.querySelectorAll(".cal-daycard")]
        .map((c) => ({ today: c.dataset.todayAnchor === "1", top: c.getBoundingClientRect().top }))
        .filter((c) => c.top >= y - 2)
        .sort((a, b) => a.top - b.top);
      return cards.length ? cards[0].today : null;
    });
    ok(firstVisible === true,
      "today's card is the FIRST one below the controls — no earlier day of the week is in the way");
    if (SHOT) await page.screenshot({ path: path.join(SHOTS, "cal_week_today_390.png") });

    /* ---- F · Today re-anchors after scrolling away -------------------------- */
    console.log("\nF. Today re-anchors the week feed");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(400);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll(".cal-controls button")].find(x => /today/i.test(x.textContent));
      if (b) b.click();
    });
    await sleep(700);
    g = await weekAnchorGap(page);
    ok(g.found && g.top > 0 && g.top < g.vh * 0.4,
      `after scrolling away, Today brings it back to the top (${Math.round(g.top || -1)}px)`);

    ok(errors.length === 0, "no page errors" + (errors[0] ? " — " + errors[0] : ""));

    /* ---- G · desktop ------------------------------------------------------- */
    console.log("\nG. Desktop");
    const { page: dp, errors: derr } = await newPage(browser, { width: 1280, height: 900, deviceScaleFactor: 1 });
    await boot(dp);
    await gotoTab(dp, "calendar");
    s = await calState(dp);
    ok(s.view === "month" && s.selected === TODAY, "desktop opens on the month, on today");
    await dp.evaluate(() => window.__CAL__.setView("week"));
    await sleep(700);
    g = await weekAnchorGap(dp);
    ok(g.found && g.top > 0 && g.top < g.vh * 0.4,
      `desktop week lands on today too (${Math.round(g.top || -1)}px of ${g.vh})`);
    ok(derr.length === 0, "no page errors at desktop size" + (derr[0] ? " — " + derr[0] : ""));
    if (SHOT) await dp.screenshot({ path: path.join(SHOTS, "cal_week_today_desktop.png") });
  } finally {
    for (const c of contexts){ try { await c.close(); } catch {} }
    await browser.close();
    srv.close();
  }

  console.log("\n====================================================");
  console.log(`CALVIEW: ${pass}/${pass + fails.length} checks passed`);
  fails.forEach((f) => console.log("  FAIL " + f));
  process.exit(fails.length ? 1 : 0);
}

if (SHOT) fs.mkdirSync(SHOTS, { recursive: true });
run().catch((e) => { console.error(e); process.exit(1); });
