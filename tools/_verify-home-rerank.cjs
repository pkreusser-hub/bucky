#!/usr/bin/env node
"use strict";
/**
 * BUCKY Home rerank suite — the 2026-08-31 content-order rebuild of index.html's Home tab
 * against "1a: Bucky Home · Option A Re-ranked · mobile", the commissioner's approved
 * Claude Design canvas mockup. See docs/bucky-app.md's dated entry for the full mapping.
 *
 *   node tools/_verify-home-rerank.cjs [--shots]
 *
 * Covers what's genuinely NEW about the rerank, not what other suites already own:
 * chore-care/fitness/finance/sports/news/activity/beacon-safety/calnotify/calview keep
 * testing their own features' Home cards unchanged (reused verbatim — paintFfCard,
 * paintFitCard, the chore ring's data source). This suite is the one that would have
 * caught the rerank itself being wrong: greeting-ring arithmetic, the accent card's
 * presence rule, the chores card's 3-row cap, stocks/news really being gone from Home,
 * no emoji in the chrome this rerank authored, and — THE LAW ABOVE ALL OTHERS — that this
 * harness genuinely blocks Firebase rather than merely declaring that it does. An
 * unblocked headless run against index.html has twice duplicated the live family goat
 * herd; Section F proves the block is live, not just documented.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SCRATCHPAD = "C:/Users/pkreu/AppData/Local/Temp/claude/C--Users-pkreu-OneDrive-Documents-BUCKY/3975c6b5-997c-4420-be77-bbe51e7e6e8d/scratchpad";
const WANT_SHOTS = process.argv.includes("--shots");
const PORT = 8893;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; failures.push(name); console.log("  \u2717 FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".json":"application/json", ".css":"text/css", ".png":"image/png", ".jpg":"image/jpeg",
  ".webp":"image/webp", ".svg":"image/svg+xml", ".txt":"text/plain",
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

const contexts = [];
const FIREBASE_RE = /googleapis|firestore|firebase|gstatic/i;
/** Every page gets its own isolated context (shared localStorage across "fresh" pages has
 *  bitten this app's suites before — see CLAUDE.md). Firebase/gstatic is ABORTED, and every
 *  abort is counted so Section F can prove the block is live, not just declared. */
async function newPage(browser, { user = "Isaac", viewport = { width: 390, height: 844, deviceScaleFactor: 1 } } = {}){
  const ctx = await browser.createBrowserContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  const errors = [];
  const NOISE = /Failed to load resource|dynamically imported module|gstatic|firebase|ERR_FAILED|ERR_BLOCKED/i;
  page.on("pageerror", (e) => { if (!NOISE.test(String(e))) errors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push("console: " + m.text()); });

  let firebaseBlocked = 0;
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (FIREBASE_RE.test(u)) { firebaseBlocked++; return r.abort(); }
    if (u.includes("/.netlify/functions/")) return r.respond({ status: 200, contentType: "application/json", body: "{}" });
    if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) return r.abort();
    r.continue();
  });

  await page.evaluateOnNewDocument((u) => {
    localStorage.setItem("choreUnlocked", "amenfarms");
    if (u) localStorage.setItem("choreUser", u); else localStorage.removeItem("choreUser");
    window.prompt = () => null;
    window.alert = () => {};
    window.confirm = () => true;
  }, user);
  return { page, errors, firebaseBlocked: () => firebaseBlocked };
}

const pad = (n) => (n < 10 ? "0" + n : "" + n);
function todayKeyLocal(){
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

/** Seed chores (buckyData1, the local backend's one array — allowance rows share it),
 *  the animal-care rota, a weather cache, and (optionally) the GFFL home-card cache,
 *  then boot. All local-backend/localStorage, no Firestore. */
async function boot(page, { chores, care, wx, gffl } = {}){
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((choreList, careData, wxData, gfflData) => {
    if (choreList) localStorage.setItem("buckyData1", JSON.stringify(choreList));
    if (careData) localStorage.setItem("setting_animalCare", JSON.stringify({ json: JSON.stringify(careData) }));
    if (wxData) localStorage.setItem("bucky_wx2", JSON.stringify(wxData));
    if (gfflData) localStorage.setItem("bucky_gffl_home", JSON.stringify(gfflData));
  }, chores || null, care || null, wx || null, gffl || null);
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__NAV__ && window.__CAL__ && window.__CHORES__, { timeout: 20000 });
  await sleep(700);
}

/** A daily chore fixture. `doneToday` writes a donePeriod/doneLog that curPeriodLog()
 *  reads back as complete for TODAY, the same shape the real app writes. */
function chore(id, name, { timeOfDay = "morning", order = 1, doneToday = false } = {}){
  const today = todayKeyLocal();
  return {
    id, name, frequency: "daily", target: 1, timeOfDay, order,
    lastPeriod: doneToday ? today : "", lastBy: doneToday ? "Isaac" : "", lastAt: doneToday ? Date.now() : 0,
    donePeriod: doneToday ? today : "", doneLog: doneToday ? [{ at: Date.now(), by: "Isaac" }] : [],
  };
}
/** A rota where every slot on every weekday belongs to `group` (chore-care.cjs's fixture). */
function rota(group){
  const defaults = {};
  for (const d of ["sun","mon","tue","wed","thu","fri","sat"]) defaults[d] = { am: group, pm: group };
  return { defaults, overrides: {} };
}
function wxFixture(){
  const today = new Date().toISOString().slice(0, 10);
  return { ts: Date.now(), days: [
    { date: today, code: 0, hi: 88, lo: 64, pp: 5 },
    { date: today, code: 95, hi: 79, lo: 61, pp: 60 },   // "tomorrow" (test only reads index/code, not real date math)
    { date: today, code: 1, hi: 80, lo: 60, pp: 10 },
    { date: today, code: 1, hi: 81, lo: 62, pp: 15 },
    { date: today, code: 1, hi: 82, lo: 63, pp: 5 },
  ] };
}

// The GFFL home-card cache (bucky_gffl_home) — same shape sportsHomeRefresh() writes after
// a real gfflHomeFetch(). team:12 matches gfflMyTeamId() for user "Isaac" (the fixture user
// every other section already uses), so paintFfCard reads it as fresh, not stale-by-profile.
function gfflFixture(){
  return {
    ts: Date.now(), team: 12,
    data: { week: 1, draftAt: null, final: true,
      my: { id: 12, name: "The GOAT Kids", pts: 101.5 },
      opp: { id: 3, name: "Wyoming Cowboys", pts: 88.2 } },
  };
}

const EMOJI_RE = /\p{Extended_Pictographic}/u;

/* ==========================================================================
   A. Greeting: the ring is stroke-dasharray/stroke-dashoffset ARITHMETIC
   ========================================================================== */
async function sectionGreeting(browser){
  section("A. Greeting ring — hand-computed arithmetic, not a screenshot");
  // 6 chores, 3 done: the ring should read done=3/total=6, offset = CIRC*(1-3/6).
  const chores = [
    chore("c1", "Feed the goats", { timeOfDay: "morning", order: 1, doneToday: true }),
    chore("c2", "Refill water",   { timeOfDay: "morning", order: 2, doneToday: true }),
    chore("c3", "Collect eggs",   { timeOfDay: "noon",    order: 3, doneToday: true }),
    chore("c4", "Muck the barn",  { timeOfDay: "morning", order: 4, doneToday: false }),
    chore("c5", "Check fencing",  { timeOfDay: "noon",    order: 5, doneToday: false }),
    chore("c6", "Lock the coop",  { timeOfDay: "night",   order: 6, doneToday: false }),
  ];
  const { page, errors } = await newPage(browser, { user: "Isaac" });
  await boot(page, { chores, care: rota("Kreussers") });
  const geo = await page.evaluate(() => {
    const fg = document.querySelector(".home2 .ring .ringfg");
    const val = document.querySelector(".home2 .ring .val");
    return {
      dasharray: fg ? fg.getAttribute("stroke-dasharray") : null,
      dashoffset: fg ? fg.getAttribute("stroke-dashoffset") : null,
      valText: val ? val.textContent.replace(/\s+/g, "") : null,
    };
  });
  const CIRC = 2 * Math.PI * 30;
  const done = 3, total = 6;
  const expectOffset = CIRC * (1 - done / total);
  ok(geo.dasharray !== null, "the ring's foreground circle is on screen");
  ok(Math.abs(parseFloat(geo.dasharray) - CIRC) < 0.5,
    `stroke-dasharray is the circle's own circumference 2\u03c0r (got ${geo.dasharray}, expected ${CIRC.toFixed(1)})`);
  ok(Math.abs(parseFloat(geo.dashoffset) - expectOffset) < 0.5,
    `stroke-dashoffset is CIRC\u00d7(1\u2212done/total) = ${expectOffset.toFixed(1)} (got ${geo.dashoffset})`);
  ok(geo.valText === "3/6", `the ring's own number reads 3/6 (got "${geo.valText}")`);

  // All-done and none-done text states (the greeting sub-line's own copy).
  const allDoneChores = chores.map((c) => chore(c.id, c.name, { timeOfDay: c.timeOfDay, order: c.order, doneToday: true }));
  const { page: p2 } = await newPage(browser, { user: "Isaac" });
  await boot(p2, { chores: allDoneChores, care: rota("Kreussers") });
  const allDoneSub = await p2.evaluate(() => (document.querySelector(".home2 .hero .hsub") || {}).textContent || "");
  ok(/all done/i.test(allDoneSub), `all-done state reads sensibly ("${allDoneSub}")`);

  const noneDoneChores = chores.map((c) => chore(c.id, c.name, { timeOfDay: c.timeOfDay, order: c.order, doneToday: false }));
  const { page: p3 } = await newPage(browser, { user: "Isaac" });
  await boot(p3, { chores: noneDoneChores, care: rota("Kreussers") });
  const noneDoneSub = await p3.evaluate(() => (document.querySelector(".home2 .hero .hsub") || {}).textContent || "");
  ok(/6 chores.*left/i.test(noneDoneSub), `0-left (i.e. none done yet) state names the count ("${noneDoneSub}")`);

  // The time-of-day icon is SVG, not the old \u2600\ufe0f/\ud83c\udf24\ufe0f/\ud83c\udf19 emoji.
  const iconHtml = await page.evaluate(() => (document.querySelector(".home2 .hero h1 .hicon") || {}).innerHTML || "");
  ok(/<svg/.test(iconHtml) && !EMOJI_RE.test(iconHtml), `the greeting's time-of-day icon is an inline SVG, not emoji (${iconHtml.slice(0, 40)})`);

  if (WANT_SHOTS){ try { fs.mkdirSync(SCRATCHPAD, { recursive: true }); } catch {} }
  ok(errors.length === 0, "no page errors" + (errors[0] ? " \u2014 " + errors[0] : ""));
}

/* ==========================================================================
   B. The "Up next" accent card — absent when nothing is upcoming today,
      present and correct when something is.
   ========================================================================== */
async function sectionAccentCard(browser){
  section("B. The accent card is absent when empty, present+correct when not");
  const NOW = new Date("2026-08-31T15:00:00").getTime();   // a Monday afternoon, fixed

  // B1 — nothing scheduled today: the card must be genuinely gone, not just an
  // attribute (CLAUDE.md #2 \u2014 measure geometry, never the [hidden] attribute alone).
  {
    const { page, errors } = await newPage(browser, { user: "Mom" });
    await boot(page);
    await page.evaluate((now) => { window.__CAL__.setEvents([]); window.__CAL__.setHomeNow(now); }, NOW);
    await sleep(200);
    const geo = await page.evaluate(() => {
      const el = document.querySelector(".home2 .calwidget");
      return el ? { hidden: el.hidden, offsetParent: el.offsetParent !== null, display: getComputedStyle(el).display } : null;
    });
    ok(geo && geo.hidden === true, "the accent card is [hidden] when nothing is upcoming today");
    ok(geo && geo.offsetParent === false && geo.display === "none",
      `\u2026and it is ACTUALLY invisible \u2014 offscreen geometry + display:none (${JSON.stringify(geo)})`);
    ok(errors.length === 0, "no page errors (B1)" + (errors[0] ? " \u2014 " + errors[0] : ""));
  }

  // B2 — an event later today: present, correctly timed, titled, and it never stacks
  // beside a second accent card (there is exactly one accent-colored element on Home).
  {
    const { page, errors } = await newPage(browser, { user: "Mom" });
    await boot(page);
    await page.evaluate((now) => {
      window.__CAL__.setEvents([
        { id: "e1", title: "Church potluck", start: new Date(now + 3 * 3600e3).toISOString(),
          end: new Date(now + 4 * 3600e3).toISOString(), allDay: false, notes: "" },
      ]);
      window.__CAL__.setHomeNow(now);
    }, NOW);
    await sleep(300);
    const card = await page.evaluate(() => {
      const el = document.querySelector(".home2 .calwidget");
      return el ? {
        hidden: el.hidden,
        title: (el.querySelector(".cn-title") || {}).textContent,
        lab: (el.querySelector(".cn-lab") || {}).textContent,
        accentCount: document.querySelectorAll(".home2 .accent-next").length,
      } : null;
    });
    ok(card && card.hidden === false, "the accent card shows once something is upcoming today");
    ok(card && card.title === "Church potluck", `\u2026with the right title ("${card && card.title}")`);
    ok(card && /up next/i.test(card.lab || ""), `\u2026and the "Up next" label`);
    ok(card && card.accentCount === 1, "never two accent cards on screen at once");

    const goesTo = await page.evaluate(() => { document.querySelector(".home2 .calwidget").click(); return window.__NAV__.tab(); });
    ok(goesTo === "calendar", "tapping the accent card opens the Plan/Calendar tab");
    ok(errors.length === 0, "no page errors (B2)" + (errors[0] ? " \u2014 " + errors[0] : ""));
  }

  // B3 — an event that ALREADY passed today must not count as "up next".
  {
    const { page, errors } = await newPage(browser, { user: "Mom" });
    await boot(page);
    await page.evaluate((now) => {
      window.__CAL__.setEvents([
        { id: "past1", title: "Morning chores", start: new Date(now - 3 * 3600e3).toISOString(),
          end: new Date(now - 2 * 3600e3).toISOString(), allDay: false, notes: "" },
      ]);
      window.__CAL__.setHomeNow(now);
    }, NOW);
    await sleep(200);
    const hidden = await page.evaluate(() => (document.querySelector(".home2 .calwidget") || {}).hidden);
    ok(hidden === true, "an already-past event today does not count as \"up next\"");
    ok(errors.length === 0, "no page errors (B3)" + (errors[0] ? " \u2014 " + errors[0] : ""));
  }
}

/* ==========================================================================
   C. Today's chores: exactly the first THREE not-done rows, and they still
      DO what the Chores tab's own rows do.
   ========================================================================== */
async function sectionChoresCard(browser){
  section("C. Today's chores card \u2014 first 3 not-done, rows really toggle");
  const chores = [
    chore("m1", "Feed the goats",     { timeOfDay: "morning", order: 1 }),
    chore("m2", "Refill water",       { timeOfDay: "morning", order: 2 }),
    chore("n1", "Collect eggs",       { timeOfDay: "noon",    order: 3 }),
    chore("n2", "Check fencing",      { timeOfDay: "noon",    order: 4 }),
    chore("z1", "Lock the coop",      { timeOfDay: "night",   order: 5 }),
  ];
  const { page, errors } = await newPage(browser, { user: "Isaac" });
  await boot(page, { chores, care: rota("Kreussers") });

  const before = await page.evaluate(() => ({
    rowCount: document.querySelectorAll(".home2 .card2 .crow").length,
    names: [...document.querySelectorAll(".home2 .card2 .crow .cbody .t")].map((e) => e.textContent),
    seeAll: (document.querySelector(".home2 .card2 .chd .more") || {}).textContent,
    ringVal: (document.querySelector(".home2 .ring .val") || {}).textContent.replace(/\s+/g, ""),
  }));
  ok(before.rowCount === 3, `exactly 3 rows show even though 5 chores are not done (got ${before.rowCount})`);
  ok(JSON.stringify(before.names) === JSON.stringify(["Feed the goats", "Refill water", "Collect eggs"]),
    `\u2026the first 3 by time-of-day/order, not just any 3 (${before.names.join(", ")})`);
  ok(/see all/i.test(before.seeAll || ""), '"See all \u2192" opens the Chores tab');
  ok(before.ringVal === "0/5", `the ring still counts ALL 5, not just the 3 shown (got "${before.ringVal}")`);

  // Tap the first row \u2014 it must DO what the Chores tab's own row does (toggle done),
  // AND the 4th chore should now slide into the visible 3.
  const afterTap = await page.evaluate(() => {
    document.querySelector(".home2 .card2 .crow").click();
    return true;
  });
  await sleep(300);
  const after = await page.evaluate(() => ({
    rowCount: document.querySelectorAll(".home2 .card2 .crow").length,
    names: [...document.querySelectorAll(".home2 .card2 .crow .cbody .t")].map((e) => e.textContent),
    ringVal: (document.querySelector(".home2 .ring .val") || {}).textContent.replace(/\s+/g, ""),
  }));
  ok(afterTap, "the row is tappable");
  ok(after.ringVal === "1/5", `tapping a row completes it for real \u2014 the ring moves to 1/5 (got "${after.ringVal}")`);
  ok(after.rowCount === 3 && !after.names.includes("Feed the goats") && after.names.includes("Check fencing"),
    `\u2026and the 4th chore slides into the now-open 3rd slot (${after.names.join(", ")})`);

  await page.evaluate(() => window.__NAV__.goTo("chores"));
  await sleep(300);
  // Completed chores collapse into one group by default (defaultCollapse) \u2014 "Feed the
  // goats" itself is not a visible <li> until that group is expanded, so the honest check
  // here is that the group header now counts it.
  const choresTabState = await page.evaluate(() => {
    const heads = [...document.querySelectorAll(".list .group-head")].map((e) => e.textContent);
    return heads.find((t) => /Completed/i.test(t)) || "not-found";
  });
  ok(/Completed.*\(1\)/.test(choresTabState),
    `the Chores tab agrees \u2014 the Completed group now counts 1 ("${choresTabState}")`);

  ok(errors.length === 0, "no page errors" + (errors[0] ? " \u2014 " + errors[0] : ""));

  // A non-chore user (Mom) gets no chores card at all, and no ring.
  const { page: momPage, errors: momErrors } = await newPage(browser, { user: "Mom" });
  await boot(momPage, { chores, care: rota("Kreussers") });
  const momView = await momPage.evaluate(() => ({
    card: !!document.querySelector(".home2 .card2"),
    ring: !!document.querySelector(".home2 .ring"),
  }));
  ok(!momView.card && !momView.ring, "a non-chore profile (Mom) gets neither the chores card nor the ring");
  ok(momErrors.length === 0, "no page errors (Mom)" + (momErrors[0] ? " \u2014 " + momErrors[0] : ""));
}

/* ==========================================================================
   D. Stocks and news: gone from Home, still reachable in their own tabs.
   ========================================================================== */
async function sectionStocksNewsGone(browser){
  section("D. Stocks & news left Home entirely \u2014 code untouched, still reachable elsewhere");
  const { page, errors } = await newPage(browser, { user: "Dad" });
  await boot(page);
  const homeState = await page.evaluate(() => ({
    stockcard: !!document.querySelector(".home2 .stockcard"),
    newscard: !!document.querySelector(".home2 .newscard, .home2 .newswrap"),
    farmline: !!document.querySelector(".home2 .farmline"),
  }));
  ok(!homeState.stockcard, "no stock watchlist card on Home");
  ok(!homeState.newscard, "no news card on Home");
  ok(homeState.farmline, "the rotating farm one-liner IS on Home, in that slot");

  await page.evaluate(() => window.__NAV__.goTo("finance"));
  await sleep(400);
  const financeOk = await page.evaluate(() => !!document.querySelector(".finwrap"));
  ok(financeOk, "the stock watchlist is still there \u2014 the Bank/Finance tab renders");

  await page.evaluate(() => window.__NAV__.goTo("news"));
  await sleep(400);
  const newsOk = await page.evaluate(() => !!document.querySelector(".newswrap"));
  ok(newsOk, "news is still there \u2014 the News tab renders");

  ok(errors.length === 0, "no page errors" + (errors[0] ? " \u2014 " + errors[0] : ""));
}

/* ==========================================================================
   D2. The GFFL half of glance row 1 \u2014 WITH league data it sits beside
       weather as a real two-up row (the mockup's actual picture); WITHOUT
       data, weather spanning alone is the pinned, deliberate fallback
       (paintFfCard's own pre-existing "no league to show \u2014 never paint a
       guess" rule, untouched by this rerank, not a rerank bug).
   ========================================================================== */
async function sectionGffl(browser){
  section("D2. GFFL glance card \u2014 two-up WITH league data, weather-spans WITHOUT (deliberate)");
  {
    const { page, errors } = await newPage(browser, { user: "Isaac" });
    await boot(page, { wx: wxFixture(), gffl: gfflFixture() });
    await page.waitForFunction(() => {
      const f = document.querySelector(".home2 .ffcard");
      return f && !f.hidden;
    }, { timeout: 10000 });
    const two = await page.evaluate(() => {
      const f = document.querySelector(".home2 .ffcard");
      const row = f.closest(".glancerow");
      const wx = row ? row.querySelector(".wxcard") : null;
      const names = [...f.querySelectorAll(".ffhome .fhn")].map((e) => e.textContent);
      return {
        rowCols: row ? getComputedStyle(row).gridTemplateColumns.split(" ").length : 0,
        hasWeatherSibling: !!wx,
        names,
      };
    });
    ok(two.hasWeatherSibling, "with league data, the GFFL card sits in the SAME glance row as weather");
    ok(two.rowCols === 2, `\u2026and the row is genuinely two columns wide (${two.rowCols})`);
    ok(two.names[0] === "The GOAT Kids" && /Wyoming Cowboys/.test(two.names[1] || ""),
      `\u2026showing this account's real matchup (${two.names.join(", ")})`);
    if (WANT_SHOTS){
      fs.mkdirSync(SCRATCHPAD, { recursive: true });
      await page.screenshot({ path: path.join(SCRATCHPAD, "home_rerank_gffl_glancerow_390.png") });
    }
    ok(errors.length === 0, "no page errors (with data)" + (errors[0] ? " \u2014 " + errors[0] : ""));
  }
  {
    // No gffl fixture at all (the plain boot() every other section uses) \u2014 Firestore is
    // blocked in this harness, gfflHomeFetch() fails safely, and with no cache to fall
    // back on paintFfCard's OWN rule ("no league to show \u2014 never paint a guess") hides
    // the card. That is pre-existing, correct behavior, not something this rerank broke \u2014
    // pinned here so a future change can't silently make it regress unnoticed.
    const { page, errors } = await newPage(browser, { user: "Isaac" });
    await boot(page, { wx: wxFixture() });
    await sleep(600);
    const solo = await page.evaluate(() => {
      const wx = document.querySelector(".home2 .wxcard");
      const ff = document.querySelector(".home2 .ffcard");
      const row = wx ? wx.closest(".glancerow") : null;
      return {
        ffHidden: ff ? ff.hidden : "no-ff-element",
        rowCols: row ? getComputedStyle(row).gridTemplateColumns.split(" ").length : 0,
      };
    });
    ok(solo.ffHidden === true, "without league data, the GFFL card is hidden (paintFfCard's own pre-existing rule)");
    ok(solo.rowCols === 1, `\u2026and weather takes the FULL row width instead of sitting beside a blank column (${solo.rowCols})`);
    ok(errors.length === 0, "no page errors (without data)" + (errors[0] ? " \u2014 " + errors[0] : ""));
  }
}

/* ==========================================================================
   E. No emoji ANYWHERE in Home's rendered chrome \u2014 scans the WHOLE .home2
      subtree's text, not a hand-picked list of elements. (2026-08-31, hardened
      after review: the original narrow per-element version passed while
      "let's get started \ud83d\udcaa" and a \ud83d\udcaa-prefixed workout-card title were both on
      screen, because it never looked at .hsub or .fitc-title at all \u2014 a
      curated allowlist of what to check is exactly as blind as it is
      convenient.) TWO documented exemptions only, both pre-existing and
      EXPLICITLY kept unchanged by the brief itself, not this suite's call:
        - .wxg-ic \u2014 the weather condition glyph; wxIcon() is untouched, same
          convention weather.html already uses ("the weather condition icon
          follows whatever the existing weather section already does").
        - .ffcard \u2014 the GFFL card; paintFfCard's data AND presentation are
          reused byte-for-byte ("keep whatever quiet-repaint behavior it has").
      Nothing else on Home may carry emoji. Proven to catch a real regression:
      stashed back to the pre-fix copy (\ud83d\udcaa/\ud83c\udf33/\ud83d\udd25/\ud83c\udf3b/\ud83c\udf89 restored) this check
      failed exactly here before the fix landed \u2014 see the docs entry.
   ========================================================================== */
async function sectionNoEmoji(browser){
  section("E. No emoji ANYWHERE in Home's rendered chrome (2 documented, pre-existing exemptions)");
  const chores = [chore("m1", "Feed the goats", { timeOfDay: "morning", order: 1 })];
  const { page, errors } = await newPage(browser, { user: "Isaac" });
  await boot(page, { chores, care: rota("Kreussers"), wx: wxFixture() });
  await page.evaluate((now) => {
    window.__CAL__.setEvents([{ id: "e1", title: "Vet visit", start: new Date(now + 3600e3).toISOString(),
      end: new Date(now + 7200e3).toISOString(), allDay: false, notes: "" }]);
    window.__CAL__.setHomeNow(now);
  }, Date.now());
  await sleep(300);
  // A second, all-done pass over the SAME page's hero (via a fresh boot) exercises the
  // "let's get started"/"All done" sub-line branches too \u2014 a static single-state fixture
  // is exactly the kind of narrow check that missed this the first time.
  const scan = await page.evaluate(() => {
    const home = document.querySelector(".home2");
    const clone = home.cloneNode(true);
    clone.querySelectorAll(".wxg-ic, .ffcard").forEach((el) => el.remove());
    return { text: clone.textContent, html: clone.innerHTML };
  });
  ok(scan.text.length > 200, "there is real Home content to scan (not an empty page)");
  const hit = scan.text.match(EMOJI_RE);
  ok(!hit, `no emoji anywhere in Home's rendered text outside the 2 documented exemptions` + (hit ? ` (found "${hit[0]}")` : ""));

  const { page: p2, errors: e2 } = await newPage(browser, { user: "Isaac" });
  await boot(p2, { chores: [chore("m1", "Feed the goats", { timeOfDay: "morning", order: 1, doneToday: true })], care: rota("Kreussers") });
  const scan2 = await p2.evaluate(() => {
    const home = document.querySelector(".home2");
    const clone = home.cloneNode(true);
    clone.querySelectorAll(".wxg-ic, .ffcard").forEach((el) => el.remove());
    return clone.textContent;
  });
  const hit2 = scan2.match(EMOJI_RE);
  ok(!hit2, `\u2026including the all-done state of the greeting sub-line` + (hit2 ? ` (found "${hit2[0]}")` : ""));

  ok(errors.length === 0, "no page errors" + (errors[0] ? " \u2014 " + errors[0] : ""));
  ok(e2.length === 0, "no page errors (all-done pass)" + (e2[0] ? " \u2014 " + e2[0] : ""));
}

/* ==========================================================================
   F. THE GOAT-HERD LAW: this harness genuinely blocks Firebase, not just on
      paper. index.html loads the Firebase SDK unconditionally, so booting the
      app for real should trip the interceptor at least once, every time.
   ========================================================================== */
async function sectionGoatHerdLaw(browser){
  section("F. The Firebase block is LIVE, not just declared (the goat-herd law)");
  const { page, errors, firebaseBlocked } = await newPage(browser, { user: "Isaac" });
  await boot(page);
  ok(firebaseBlocked() > 0, `index.html really did try to reach Firebase, and this harness really did abort it (${firebaseBlocked()} aborted)`);
  ok(errors.length === 0, "no page errors" + (errors[0] ? " \u2014 " + errors[0] : ""));
}

/* ==========================================================================
   G. Desktop (\u22651024px): the rerank lands in the established two-column
      home2-main/home2-rail convention, not a new desktop system.
   ========================================================================== */
async function sectionDesktop(browser){
  section("G. Desktop \u2014 the established rail convention, re-ranked content in it");
  const chores = [
    chore("m1", "Feed the goats", { timeOfDay: "morning", order: 1 }),
    chore("n1", "Collect eggs",   { timeOfDay: "noon",    order: 2 }),
  ];
  const { page, errors } = await newPage(browser, { user: "Isaac", viewport: { width: 1280, height: 900, deviceScaleFactor: 1 } });
  await boot(page, { chores, care: rota("Kreussers") });
  await page.evaluate((now) => {
    window.__CAL__.setEvents([{ id: "e1", title: "Church potluck", start: new Date(now + 3600e3).toISOString(),
      end: new Date(now + 7200e3).toISOString(), allDay: false, notes: "" }]);
    window.__CAL__.setHomeNow(now);
  }, Date.now());
  await sleep(400);
  const desk = await page.evaluate(() => {
    const main = document.querySelector(".home2-main"), rail = document.querySelector(".home2-rail");
    return {
      wrappers: !!main && !!rail,
      accentInMain: !!(main && main.querySelector(".accent-next")),
      choresInMain: !!(main && main.querySelector(".card2")),
      askInMain: !!(main && main.querySelector(".askbar")),
      farmlineInMain: !!(main && main.querySelector(".farmline")),
      glanceRowsInRail: rail ? rail.querySelectorAll(".glancerow").length : 0,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  });
  ok(desk.wrappers, "the desktop two-column home2-main/home2-rail split still builds");
  ok(desk.accentInMain && desk.choresInMain && desk.askInMain && desk.farmlineInMain,
    `the actionable stack (accent/chores/ask/one-liner) sits in the wide main column (${JSON.stringify(desk)})`);
  ok(desk.glanceRowsInRail >= 1, "the glance-card rows sit in the narrow rail, same convention as the old calwidget/carewidget/wxcard");
  ok(desk.scrollW <= desk.clientW + 1, `no horizontal page scroll at 1280px (${desk.scrollW} vs ${desk.clientW})`);

  // Every card is a bare <button>/<div> with its OWN background painted by CSS — none of
  // them may silently fall back to the browser's UA button chrome. This is exactly the bug
  // a DOM-only "does .cc-row exist" check cannot see: a real one shipped here once (the
  // 7-day care grid's CSS block got replaced and the compact card's base background/border
  // rule went with it), invisible to every assertion above until a screenshot was actually
  // looked at. rgb(240,240,240) is Chrome's default <button> face; rgb(0,0,0) its default
  // border — a themed card must be neither.
  const cardBg = await page.evaluate(() => {
    const grab = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { bg: cs.backgroundColor, border: cs.borderColor }; };
    return { wx: grab(".home2 .wxcard"), fit: grab(".home2 .fitcard"), care: grab(".home2 .carewidget"), ff: grab(".home2 .ffcard") };
  });
  for (const [name, style] of Object.entries(cardBg)){
    if (!style) continue;   // ffcard can legitimately be absent/hidden this fixture
    ok(style.bg !== "rgb(240, 240, 240)" && style.border !== "rgb(0, 0, 0)",
      `${name} card is themed, not the browser's default button chrome (${JSON.stringify(style)})`);
  }

  if (WANT_SHOTS){
    fs.mkdirSync(SCRATCHPAD, { recursive: true });
    await page.screenshot({ path: path.join(SCRATCHPAD, "home_rerank_desktop_1280.png") });
  }
  ok(errors.length === 0, "no page errors" + (errors[0] ? " \u2014 " + errors[0] : ""));

  // ...and back at 390px the mobile order is the mockup's: hero, accent, chores, glance
  // row 1, glance row 2, ask bar, one-liner \u2014 a flat column, no rail wrappers.
  const { page: mp, errors: mErrors } = await newPage(browser, { user: "Isaac" });
  await boot(mp, { chores, care: rota("Kreussers") });
  await mp.evaluate((now) => {
    window.__CAL__.setEvents([{ id: "e1", title: "Church potluck", start: new Date(now + 3600e3).toISOString(),
      end: new Date(now + 7200e3).toISOString(), allDay: false, notes: "" }]);
    window.__CAL__.setHomeNow(now);
  }, Date.now());
  await sleep(400);
  const mobileOrder = await mp.evaluate(() => {
    const home = document.querySelector(".home2");
    const classesOf = (el) => el.className;
    return [...home.children].map(classesOf);
  });
  const idx = (needle) => mobileOrder.findIndex((c) => c.includes(needle));
  ok(mobileOrder.length && idx("hero") === 0, `hero is first (${mobileOrder.join(" | ")})`);
  ok(idx("accent-next") > idx("hero") && idx("card2") > idx("accent-next"),
    "accent card comes right after the hero, chores card after that");
  ok(idx("askbar") > idx("card2") && idx("farmline") > idx("askbar"),
    "the ask bar and the one-liner are the last two elements, in that order");
  if (WANT_SHOTS){
    await mp.screenshot({ path: path.join(SCRATCHPAD, "home_rerank_mobile_390.png") });
  }
  ok(mErrors.length === 0, "no page errors (mobile)" + (mErrors[0] ? " \u2014 " + mErrors[0] : ""));
}

/* ==================================== run =================================== */
(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    await sectionGreeting(browser);
    await sectionAccentCard(browser);
    await sectionChoresCard(browser);
    await sectionStocksNewsGone(browser);
    await sectionGffl(browser);
    await sectionNoEmoji(browser);
    await sectionGoatHerdLaw(browser);
    await sectionDesktop(browser);
  } catch (e) {
    fail++; failures.push("suite crashed: " + e.message);
    console.log("\n\u2717 SUITE ERROR: " + (e && e.stack || e));
  } finally {
    for (const c of contexts){ try { await c.close(); } catch {} }
    await browser.close();
    srv.close();
  }

  console.log("\n====================================================");
  console.log(`HOME-RERANK: ${pass}/${pass + fail} checks passed`);
  if (fail) for (const f of failures) console.log("  FAIL " + f);
  process.exit(fail ? 1 : 0);
})();
