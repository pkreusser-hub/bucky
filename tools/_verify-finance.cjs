#!/usr/bin/env node
"use strict";
/**
 * BUCKY Finance suite — the shared Bank/Finance nav area, the per-account watchlist, and
 * the Finance section (markets strip + watchlist + AI-analysis detail sheet).
 *
 *   node tools/_verify-finance.cjs [--shots]
 *
 * Drives the real page in Chrome at 390x844 (+ a desktop pass at 1280x800), with
 * /.netlify/functions/stocks ROUTE-MOCKED (scriptable fixtures: series ok, one bad
 * ticker, a fetch failure + retry, analyze ok, analyze fail) so the client's own audience
 * gating, per-account storage, caching and rendering are what's under test — not the real
 * server (owned by a parallel agent; contract only, never imported here).
 *
 * FIREBASE IS BLOCKED THROUGHOUT (googleapis / firestore / firebase / gstatic). Not
 * optional hygiene: an unblocked headless run against index.html has twice seeded
 * duplicates into the live family herd, and this suite exercises first-run paths
 * (a brand-new per-person watchlist doc, the legacy-device migration).
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const WANT_SHOTS = process.argv.includes("--shots");
const PORT = 8931;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ static server =============================== */
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

/* ========================= the mocked /stocks function ===================== */
/* Fixture prices/percents are arbitrary but deterministic, so specific values can be
   asserted against rather than eyeballed. `partial:true` fixtures simulate a series too
   short for a real week/month window; `noCloses` simulates a symbol with no history at
   all (proves the sparkline degrades to nothing rather than throwing). */
const FIXTURES = {
  "^GSPC": { name: "S&P 500",                     price: 5555.55,  dayPct: 1.23,  weekPct: 2.10,  monthPct: 3.40 },
  "^DJI":  { name: "Dow Jones Industrial Average", price: 40012.34, dayPct: -0.62, weekPct: -1.05, monthPct: 0.75 },
  "CL=F":  { name: "Crude Oil WTI",                price: 78.42,   dayPct: 0.55,  weekPct: -2.30, monthPct: 4.10 },
  AAPL:    { name: "Apple Inc.",                   price: 214.32,  dayPct: 0.88,  weekPct: 1.95,  monthPct: -0.55 },
  MSFT:    { name: "Microsoft Corporation",        price: 431.09,  dayPct: -0.41, weekPct: 0.60,  monthPct: 2.35 },
  GOOGL:   { name: "Alphabet Inc.",                price: 176.20,  dayPct: 1.05,  weekPct: 0.40,  monthPct: 1.80 },
  TSLA:    { name: "Tesla, Inc.",                  price: 245.10,  dayPct: 2.10,  weekPct: 3.30,  monthPct: -1.20 },
  NEWCO:   { name: "Newco Holdings",                price: 12.50,   dayPct: 3.20,  weekPct: 5.00,  monthPct: 5.00, partial: true },
  FLATCO:  { name: "Flatline Co.",                  price: 50.00,   dayPct: 0,     weekPct: 0,     monthPct: 0,    noCloses: true },
};

function makeStocksMock(){
  const state = {
    seriesCalls: 0, seriesCallLog: [], rangeCallLog: [], analyzeCalls: [],
    seriesFail: false, analyzeFail: false, analyzeDelayMs: 0, rangeDelayMs: 0,
    badSymbols: new Set(["NOPE", "ZZZZ"]),
    analyzeText: "Shares moved with the broader market today, drifting inside a normal daily range with no single headline explaining the change.",
    // Two sources sharing nothing but this mock — the client only ever needs {url,host}.
    analyzeCitations: [
      { url: "https://www.marketwatch.com/story/example", host: "marketwatch.com" },
      { url: "https://www.reuters.com/markets/example", host: "reuters.com" },
    ],
  };
  state.itemFor = (symRaw) => {
    const sym = String(symRaw || "").toUpperCase();
    if (state.badSymbols.has(sym)) return { symbol: sym, ok: false, reason: "not-found" };
    const f = FIXTURES[sym] || { name: sym + " Co.", price: 100, dayPct: 0.5, weekPct: 1, monthPct: 1.5 };
    let closes = [];
    if (!f.noCloses){
      const days = f.partial ? 6 : 24;
      const now = Date.now();
      for (let i = 0; i < days; i++){
        const t = new Date(now - (days - 1 - i) * 86400000).toISOString();
        const c = f.price * (1 - (f.monthPct / 100) * ((days - 1 - i) / (days - 1)));
        closes.push({ t, c });
      }
    }
    const dayAbs = f.price * f.dayPct / 100, weekAbs = f.price * f.weekPct / 100, monthAbs = f.price * f.monthPct / 100;
    return {
      symbol: sym, ok: true, name: f.name, currency: "USD", price: f.price,
      prevClose: f.price - dayAbs,
      day:   { abs: dayAbs,   pct: f.dayPct },
      week:  { abs: weekAbs,  pct: f.weekPct,  partial: !!f.partial },
      month: { abs: monthAbs, pct: f.monthPct, partial: !!f.partial },
      closes,
      asOf: new Date().toISOString(),
    };
  };
  // The detail-sheet chart's OWN range-specific fetch (action:"series" + range). Deliberately
  // built from a DIFFERENT point-count/trend per range key (not a real Yahoo interval, this is
  // a mock) so a test can prove a range switch genuinely redraws the chart with different data,
  // not just relabels the same Month line. Honors `noCloses` the same way the default does.
  state.rangedClosesFor = (symRaw, range) => {
    const sym = String(symRaw || "").toUpperCase();
    const f = FIXTURES[sym] || { price: 100, monthPct: 1.5 };
    if (f.noCloses) return [];
    const cfg = {
      day:   { n: 8,  stepMin: 15 },
      week:  { n: 10, stepMin: 60 * 6 },
      month: { n: 12, stepMin: 60 * 24 },
      year:  { n: 14, stepMin: 60 * 24 * 14 },
    }[range] || { n: 24, stepMin: 60 * 24 };
    const trendPct = ({ day: 0.4, week: 1.3, month: f.monthPct, year: -2.6 })[range];
    const trend = typeof trendPct === "number" ? trendPct : f.monthPct;
    const now = Date.now();
    const closes = [];
    for (let i = 0; i < cfg.n; i++){
      const t = new Date(now - (cfg.n - 1 - i) * cfg.stepMin * 60000).toISOString();
      const c = f.price * (1 - (trend / 100) * ((cfg.n - 1 - i) / (cfg.n - 1)));
      closes.push({ t, c });
    }
    return closes;
  };
  state.handle = (bodyRaw) => {
    let b = null; try { b = JSON.parse(bodyRaw || "{}"); } catch {}
    const action = b && b.action;
    if (action === "series"){
      state.seriesCalls++;
      state.seriesCallLog.push((b.symbols || []).slice());
      if (b.range){
        state.rangeCallLog.push({ symbols: (b.symbols || []).slice(), range: b.range });
        return { series: (b.symbols || []).map((symRaw) => {
          const base = state.itemFor(symRaw);
          if (!base.ok) return base;
          return Object.assign({}, base, { closes: state.rangedClosesFor(symRaw, b.range) });
        }) };
      }
      return { series: (b.symbols || []).map(state.itemFor) };
    }
    if (action === "analyze"){
      state.analyzeCalls.push(b.symbol);
      if (state.analyzeFail) return { ok: false, reason: "upstream-error" };
      return { ok: true, symbol: b.symbol, text: state.analyzeText, citations: state.analyzeCitations };
    }
    if (action === "quote"){
      // The Home card's pre-existing action — untouched contract, exercised here too since
      // the Home-card assertions in this suite reuse this same mock.
      const quotes = (b.symbols || []).map((s) => {
        const it = state.itemFor(s);
        return it.ok
          ? { symbol: it.symbol, ok: true, price: it.price, prevClose: it.prevClose,
              change: it.price - it.prevClose, changePct: it.day.pct, currency: it.currency,
              marketState: "REGULAR", name: it.name }
          : { symbol: s, ok: false, reason: it.reason };
      });
      return { quotes };
    }
    return { error: "bad action" };
  };
  return state;
}

/* ============================ browser plumbing ============================ */
const contexts = [];

async function newPage(browser, mock, { user = "Dad", viewport = { width:390, height:844, deviceScaleFactor:1 }, watchlists = {} } = {}){
  const ctx = browser.createBrowserContext
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  const errors = [];
  const EXPECTED_NOISE = /Failed to load resource|dynamically imported module|gstatic|firebase|ERR_FAILED|ERR_BLOCKED/i;
  page.on("pageerror", (e) => { if (!EXPECTED_NOISE.test(String(e))) errors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error" && !EXPECTED_NOISE.test(m.text())) errors.push("console: " + m.text()); });

  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const url = r.url();
    if (/googleapis|firestore|firebase|gstatic/i.test(url)) return r.abort();
    if (url.includes("/.netlify/functions/stocks")){
      const raw = r.postData();
      let b = null; try { b = JSON.parse(raw || "{}"); } catch {}
      if (b && b.action === "series" && mock.seriesFail){
        return r.respond({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) });
      }
      const respond = () => {
        const res = mock.handle(raw);
        r.respond({ status: 200, contentType: "application/json", body: JSON.stringify(res) });
      };
      if (b && b.action === "analyze" && mock.analyzeDelayMs) setTimeout(respond, mock.analyzeDelayMs);
      else if (b && b.action === "series" && b.range && mock.rangeDelayMs) setTimeout(respond, mock.rangeDelayMs);
      else respond();
      return;
    }
    if (/^https?:\/\/(?!127\.0\.0\.1)/.test(url)) return r.abort();   // no real network, ever
    r.continue();
  });

  await page.evaluateOnNewDocument((u, wl) => {
    localStorage.setItem("choreUnlocked", "amenfarms");
    // evaluateOnNewDocument re-runs on EVERY navigation in this page/context, so a plain
    // unconditional setItem would stomp a mid-test change (a reload meant to prove
    // something PERSISTED) right back to the seed. Only seed when nothing is there yet —
    // i.e. the context's first navigation (same guard the News suite uses for choreUser).
    if (u){ if (!localStorage.getItem("choreUser")) localStorage.setItem("choreUser", u); }
    for (const name of Object.keys(wl || {})){
      const key = "setting_stockWatch_" + name;
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ symbols: wl[name], updatedAt: Date.now() }));
    }
    // The "Dad" profile triggers afterBackendReady()'s gateDad() at boot (Dad has no PIN
    // configured in a fresh test profile), which calls the REAL window.prompt() — headless
    // Chrome has nothing to answer that dialog, so it blocks the page's JS thread forever
    // without this stub (same reason every other suite in this repo stubs these).
    window.prompt = () => null;
    window.alert = () => {};
    window.confirm = () => true;
  }, user, watchlists);

  return { page, errors };
}

async function boot(page){
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__NAV__ && window.__FIN__, { timeout: 20000 });
}
async function gotoFinance(page){
  await page.evaluate(() => window.__NAV__.goTo("finance"));
  await page.waitForFunction(() => document.querySelector(".finwrap"), { timeout: 10000 });
}
async function tap(page, sel){
  await page.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: "center" }); }, sel);
  await sleep(80);
  await page.click(sel);
}
async function navGeo(page){
  return page.evaluate(() => {
    const btns = [...document.querySelectorAll("#bnav .bnav-btn")];
    const tops = btns.map((b) => Math.round(b.getBoundingClientRect().top));
    const rowSet = [...new Set(tops)];
    return {
      rows: rowSet.length,
      rowCounts: rowSet.map((t) => tops.filter((x) => x === t).length),
      clipped: btns.filter((b) => { const l = b.querySelector(".blabel"); return l && l.scrollWidth > l.clientWidth + 1; }).length,
    };
  });
}
async function openStock(page, sym){
  await tap(page, `.finrow[data-sym="${sym}"] .finrow-open`);
  await page.waitForFunction(() => document.getElementById("finSheetOverlay").classList.contains("open"), { timeout: 5000 });
  await page.waitForFunction(() => {
    const b = document.querySelector(".finai-body");
    return b && !b.classList.contains("finai-loading");
  }, { timeout: 10000 });
  // The chart fetch runs in parallel with the analysis fetch (finOpenDetail) — wait for it to
  // settle too, so a caller landing right after openStock() sees a fully-loaded sheet rather
  // than racing the chart's own async repaint.
  await page.waitForFunction(() => {
    const box = document.querySelector(".finchartbox");
    return !box || !box.querySelector(".finchartloading");
  }, { timeout: 10000 });
}

/* ==================================================================================
   A. Nav audience — kids see Bank only, Mom/Dad/guests see Finance, Dad sees both
   ================================================================================== */
async function sectionAudience(browser, mock){
  section("A. Nav audience — Bank for the two kids, Finance for everyone else, Dad gets both");

  const bankLabel = (page) => page.evaluate(() => {
    const b = document.querySelector('#bnav .bnav-btn[data-gid="bank"]');
    const l = b && b.querySelector(".blabel");
    return { label: l ? l.textContent : null, aria: b ? b.getAttribute("aria-label") : null };
  });

  /* -- Isaac: Bank only -- */
  {
    const { page, errors } = await newPage(browser, mock, { user: "Isaac" });
    await boot(page);
    const nav = await bankLabel(page);
    ok(nav.label === "Bank", `Isaac's shared nav area reads "Bank" (got "${nav.label}")`);
    ok(nav.aria === "Bank", "…and the aria-label agrees");
    await tap(page, '#bnav .bnav-btn[data-gid="bank"]');
    await sleep(300);
    ok(await page.evaluate(() => window.__NAV__.tab() === "farmbank"), "…and tapping it opens Farm Bank");
    ok(await page.evaluate(() => !document.querySelector(".finmkts")), "…no markets strip anywhere on screen for Isaac");
    ok(await page.evaluate(() => document.querySelectorAll("#subnav .sub").length === 0),
      "…no Bank/Finance sub-nav chips (Isaac only has the one side)");

    const bounced = await page.evaluate(() => { window.__NAV__.goTo("finance"); return window.__NAV__.tab(); });
    ok(bounced !== "finance", `a stale #finance deep-link bounces Isaac away (landed on "${bounced}")`);

    const geo = await navGeo(page);
    ok(geo.rows === 2, `Isaac: bottom nav is two rows (${geo.rows})`);
    ok(geo.rowCounts.length === 2 && Math.abs(geo.rowCounts[0] - geo.rowCounts[1]) <= 1,
      `…balanced (${geo.rowCounts.join(" vs ")})`);
    ok(geo.clipped === 0, "…and no nav label is clipped for Isaac");

    if (WANT_SHOTS){
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, "fin_bank_kid.png") });
    }
    ok(errors.length === 0, "Isaac: no page errors" + (errors.length ? ": " + errors[0] : ""));
  }

  /* -- Eleanor: same as Isaac -- */
  {
    const { page, errors } = await newPage(browser, mock, { user: "Eleanor" });
    await boot(page);
    const nav = await bankLabel(page);
    ok(nav.label === "Bank", `Eleanor's shared nav area reads "Bank" too (got "${nav.label}")`);
    const bounced = await page.evaluate(() => { window.__NAV__.goTo("finance"); return window.__NAV__.tab(); });
    ok(bounced !== "finance", `a stale #finance deep-link bounces Eleanor away (landed on "${bounced}")`);
    ok(errors.length === 0, "Eleanor: no page errors" + (errors.length ? ": " + errors[0] : ""));
  }

  /* -- Mom: Finance, NOT Bank -- */
  {
    const { page, errors } = await newPage(browser, mock, { user: "Mom" });
    await boot(page);
    const nav = await bankLabel(page);
    ok(nav.label === "Finance", `Mom's shared nav area reads "Finance" (got "${nav.label}")`);
    await tap(page, '#bnav .bnav-btn[data-gid="bank"]');
    await sleep(300);
    ok(await page.evaluate(() => window.__NAV__.tab() === "finance"), "…and tapping it opens Finance");
    ok(await page.evaluate(() => !!document.querySelector(".finmkts")), "…the markets strip renders for Mom");

    const bounced = await page.evaluate(() => { window.__NAV__.goTo("farmbank"); return window.__NAV__.tab(); });
    ok(bounced !== "farmbank", `a stale #farmbank deep-link bounces Mom away (landed on "${bounced}") — Mom lost Bank in this change`);
    ok(errors.length === 0, "Mom: no page errors" + (errors.length ? ": " + errors[0] : ""));
  }

  /* -- Grandma (an unrecognized guest): Finance only, same as Mom -- */
  {
    const { page, errors } = await newPage(browser, mock, { user: "Grandma" });
    await boot(page);
    const nav = await bankLabel(page);
    ok(nav.label === "Finance", `Grandma (a guest) reads "Finance" (got "${nav.label}")`);
    const bounced = await page.evaluate(() => { window.__NAV__.goTo("farmbank"); return window.__NAV__.tab(); });
    ok(bounced !== "farmbank", `a stale #farmbank deep-link bounces Grandma away (landed on "${bounced}")`);
    ok(errors.length === 0, "Grandma: no page errors" + (errors.length ? ": " + errors[0] : ""));
  }

  /* -- Dad: BOTH, with a working sub-nav -- */
  {
    const { page, errors } = await newPage(browser, mock, { user: "Dad", watchlists: { Dad: ["AAPL"] } });
    await boot(page);
    const nav = await bankLabel(page);
    ok(nav.label === "Finance", `Dad's shared nav area defaults to reading "Finance" (got "${nav.label}")`);
    await tap(page, '#bnav .bnav-btn[data-gid="bank"]');
    await sleep(400);
    ok(await page.evaluate(() => window.__NAV__.tab() === "finance"), "Dad's default landing on the shared area is Finance");

    const subnav = await page.evaluate(() => [...document.querySelectorAll("#subnav .subseg .sub")].map((b) => ({ key: b.dataset.key, text: b.textContent.trim() })));
    ok(subnav.length === 2, `Dad sees a 2-chip sub-nav (${subnav.map((s) => s.text).join(", ")})`);
    ok(subnav.some((s) => s.key === "farmbank" && /Bank/.test(s.text)), "…one chip is Bank");
    ok(subnav.some((s) => s.key === "finance" && /Finance/.test(s.text)), "…the other is Finance");

    await tap(page, '#subnav .sub[data-key="farmbank"]');
    await sleep(300);
    ok(await page.evaluate(() => window.__NAV__.tab() === "farmbank"), "…tapping the Bank chip switches to Farm Bank");
    await tap(page, '#subnav .sub[data-key="finance"]');
    await sleep(300);
    ok(await page.evaluate(() => window.__NAV__.tab() === "finance"), "…and the Finance chip switches back");

    ok(errors.length === 0, "Dad: no page errors" + (errors.length ? ": " + errors[0] : ""));
  }
}

/* ==================================================================================
   B. Markets, watchlist rendering, fetch failure, add/remove, layout — one Dad page
   ================================================================================== */
async function sectionFinanceTab(browser, mock){
  section("B. Markets strip, watchlist (day/week/month/partial/sparkline), fetch failure, add/remove");

  // seriesCallLog is never cleared automatically (it's meant to be a full history for
  // debugging) — reset it here too, or [0] below would read a stray call from Section A's
  // Dad-visits-Finance-via-the-subnav-toggle test rather than this section's own fetch.
  mock.seriesCalls = 0; mock.seriesCallLog = []; mock.seriesFail = false; mock.analyzeFail = false;
  const { page, errors } = await newPage(browser, mock, {
    user: "Dad",
    watchlists: { Dad: ["AAPL", "MSFT", "NEWCO", "FLATCO"] },
  });
  await boot(page);
  await gotoFinance(page);
  await page.waitForFunction(() => document.querySelector('.finmkt[data-sym="^GSPC"] .finmkt-p'), { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll(".finrow").length >= 4, { timeout: 10000 });

  /* -- markets strip -- */
  const mkts = await page.evaluate(() => [...document.querySelectorAll(".finmkt")].map((t) => ({
    sym: t.dataset.sym,
    label: (t.querySelector(".finmkt-n") || {}).textContent || "",
    price: (t.querySelector(".finmkt-p") || {}).textContent || "",
    chgCls: ((t.querySelector(".finmkt-c") || {}).className || ""),
    chgText: (t.querySelector(".finmkt-c") || {}).textContent || "",
  })));
  ok(mkts.length === 3, `three market tiles render regardless of the person's own picks (${mkts.length})`);
  ok(mkts.some((m) => m.sym === "^GSPC") && mkts.some((m) => m.sym === "^DJI") && mkts.some((m) => m.sym === "CL=F"),
    "…S&P 500, Dow and Crude oil specifically");
  ok(mkts.some((m) => /Crude oil \(WTI\)/.test(m.label)), 'the oil tile is labelled "Crude oil (WTI)"');
  const gspc = mkts.find((m) => m.sym === "^GSPC"), dji = mkts.find((m) => m.sym === "^DJI");
  ok(/\$5,555\.55/.test(gspc.price), `S&P price formats correctly (${gspc.price})`);
  ok(gspc.chgCls.includes("up") && /\+1\.23%/.test(gspc.chgText), `a positive day% renders green/up (${gspc.chgText})`);
  ok(dji.chgCls.includes("down") && /-0\.62%/.test(dji.chgText), `a negative day% renders red/down (${dji.chgText})`);

  ok(mock.seriesCalls === 1, "the markets strip + watchlist ride ONE series request, not several");
  const firstCallSyms = mock.seriesCallLog[0] || [];
  ok(["AAPL","MSFT","NEWCO","FLATCO"].every((s) => firstCallSyms.includes(s)) && firstCallSyms.includes("^GSPC"),
    "…and that one request carries both the market symbols and the person's own picks");

  /* -- watchlist rows: day/week/month, name, price -- */
  const rows = await page.evaluate(() => [...document.querySelectorAll(".finrow")].map((r) => {
    const chips = [...r.querySelectorAll(".finperf-i")].map((c) => ({
      label: (c.querySelector(".finperf-l") || {}).textContent || "",
      val: (c.querySelector(".finperf-v") || {}).textContent || "",
      cls: (c.querySelector(".finperf-v") || {}).className || "",
    }));
    return {
      sym: r.dataset.sym,
      name: (r.querySelector(".finname") || {}).textContent || "",
      price: (r.querySelector(".finprice") || {}).textContent || "",
      chips,
      hasSpark: !!r.querySelector(".finspark"),
    };
  }));
  const aapl = rows.find((r) => r.sym === "AAPL");
  ok(aapl && aapl.name === "Apple Inc." && /\$214\.32/.test(aapl.price), `AAPL shows its name and price (${aapl && aapl.name}, ${aapl && aapl.price})`);
  ok(aapl && aapl.chips.length === 3 && aapl.chips.map((c) => c.label).join("|") === "Day|Week|Month",
    `AAPL shows exactly Day/Week/Month (${aapl && aapl.chips.map((c) => c.label).join(", ")})`);
  const aaplMonth = aapl.chips.find((c) => c.label === "Month");
  ok(aaplMonth.cls.includes("down") && /-0\.55%/.test(aaplMonth.val), `AAPL's month figure is negative/red (${aaplMonth.val})`);
  ok(aapl.hasSpark, "AAPL has a sparkline (its closes[] has real history)");

  const newco = rows.find((r) => r.sym === "NEWCO");
  const newcoMonth = newco.chips.find((c) => c.label.startsWith("Month"));
  ok(newcoMonth.label !== "Month", `NEWCO's month figure is labelled honestly, not plain "Month" (got "${newcoMonth.label}")`);
  ok(/since/i.test(newcoMonth.label), `…it says "since <date>" (got "${newcoMonth.label}")`);
  const newcoDay = newco.chips.find((c) => c.label === "Day");
  ok(newcoDay && newcoDay.label === "Day", "…but NEWCO's Day figure (not partial) is still plain \"Day\"");

  const flatco = rows.find((r) => r.sym === "FLATCO");
  ok(flatco && !flatco.hasSpark, "FLATCO (no closes[] history) has no sparkline — degrades to nothing, not a crash");
  ok(flatco && /\$50\.00/.test(flatco.price), "…but its price/day/week/month still render fine");

  if (WANT_SHOTS){
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "fin_finance.png") });
  }

  /* -- fetch failure + retry (never a blank tab) -- */
  mock.seriesFail = true;
  await page.evaluate(() => window.__FIN__.refresh(true));
  await page.waitForFunction(() => document.querySelector(".finerr"), { timeout: 8000 });
  const failState = await page.evaluate(() => ({
    hasRetry: !!document.querySelector(".finerr button"),
    mktsStillShow: !!document.querySelector('.finmkt[data-sym="^GSPC"] .finmkt-p'),
    rowsStillShow: document.querySelectorAll(".finrow").length,
  }));
  ok(failState.hasRetry, "a failed fetch shows a Retry button, not a blank tab");
  ok(failState.mktsStillShow, "…the markets strip keeps showing the last good data through the failure");
  ok(failState.rowsStillShow >= 4, "…and the watchlist rows are still there too (stale, not gone)");

  mock.seriesFail = false;
  await tap(page, ".finerr button");
  await page.waitForFunction(() => !document.querySelector(".finerr"), { timeout: 8000 });
  ok(true, "tapping Retry recovers once the fetch succeeds again");

  /* -- add a ticker: good one -- */
  await tap(page, ".finadd");
  await page.waitForFunction(() => document.querySelector(".finaddrow input"), { timeout: 3000 });
  await page.click(".finaddrow input");
  await page.type(".finaddrow input", "googl");
  await page.click(".finaddrow button");
  await page.waitForFunction(() => document.querySelector('.finrow[data-sym="GOOGL"]'), { timeout: 8000 });
  ok(true, "adding a real ticker (typed lowercase) lands it on the watchlist, uppercased");
  const googlRow = await page.evaluate(() => {
    const r = document.querySelector('.finrow[data-sym="GOOGL"]');
    return r ? (r.querySelector(".finname") || {}).textContent : null;
  });
  ok(googlRow === "Alphabet Inc.", `…with real data attached immediately (${googlRow})`);

  /* -- add a ticker: bad one, refused -- */
  await tap(page, ".finadd");
  await page.waitForFunction(() => document.querySelector(".finaddrow input"), { timeout: 3000 });
  await page.click(".finaddrow input");
  await page.type(".finaddrow input", "nope");
  await page.click(".finaddrow button");
  await page.waitForFunction(() => {
    const h = document.querySelector(".finaddhint.err");
    return h && /couldn.?t find/i.test(h.textContent);
  }, { timeout: 8000 });
  ok(true, 'a bad ticker ("NOPE") is refused with a plain message');
  ok(await page.evaluate(() => !document.querySelector('.finrow[data-sym="NOPE"]')), "…and it is NOT added to the watchlist");
  await tap(page, ".finadd");   // close the add row

  /* -- remove -- */
  await tap(page, '.finrow[data-sym="GOOGL"] .finrm');
  await sleep(300);
  ok(await page.evaluate(() => !document.querySelector('.finrow[data-sym="GOOGL"]')), "removing a row takes it off the watchlist");

  /* -- detail sheet: open, analyze once, disclaimer, loading state, cache, failure -- */
  section("B2. Detail sheet — analyze exactly once, cached same-day, disclaimer always present");

  mock.analyzeDelayMs = 350;
  await tap(page, '.finrow[data-sym="NEWCO"] .finrow-open');
  await page.waitForFunction(() => document.getElementById("finSheetOverlay").classList.contains("open"), { timeout: 5000 });
  await sleep(90);   // well inside the 350ms mock delay
  const midFlight = await page.evaluate(() => ({
    loading: (document.querySelector(".finai-body") || {}).textContent || "",
    hasDisc: !!document.querySelector(".findisclaimer"),
  }));
  ok(/Reading the numbers/.test(midFlight.loading), `while analysis is in flight, a loading message shows ("${midFlight.loading}")`);
  ok(midFlight.hasDisc, "…and the disclaimer is ALREADY in the DOM during loading, not just after");
  mock.analyzeDelayMs = 0;
  await page.waitForFunction(() => { const b = document.querySelector(".finai-body"); return b && !b.classList.contains("finai-loading"); }, { timeout: 8000 });
  await tap(page, ".finsheet-x");
  await sleep(150);

  await openStock(page, "AAPL");
  ok(mock.analyzeCalls.filter((s) => s === "AAPL").length === 1, "opening AAPL fires analyze exactly ONCE");
  const detail1 = await page.evaluate(() => ({
    price: (document.querySelector(".finsheet-price") || {}).textContent || "",
    text: (document.querySelector(".finai-body") || {}).textContent || "",
    disc: (document.querySelector(".findisclaimer") || {}).textContent || "",
  }));
  ok(/\$214\.32/.test(detail1.price), `the sheet shows the big price (${detail1.price})`);
  ok(detail1.text.length > 20 && !/Reading the numbers/.test(detail1.text), "the analysis text renders");
  ok(/not investment advice/i.test(detail1.disc), `the disclaimer text is present and correct ("${detail1.disc}")`);

  const sources1 = await page.evaluate(() => [...document.querySelectorAll(".finai-source")].map((a) => ({ text: a.textContent, href: a.href, target: a.target })));
  ok(sources1.length === 2, `the two mocked citations render as source links (${sources1.length})`);
  ok(sources1[0].text === "marketwatch.com" && sources1[1].text === "reuters.com", `sources show as plain hostnames, not full URLs (${sources1.map((s) => s.text).join(", ")})`);
  ok(sources1.every((s) => s.target === "_blank"), "source links open in a new tab (target=_blank)");

  if (WANT_SHOTS){
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "fin_detail.png") });
  }

  await tap(page, ".finsheet-x");
  await sleep(200);
  ok(await page.evaluate(() => !document.getElementById("finSheetOverlay").classList.contains("open")), "the ✕ closes the sheet");

  await openStock(page, "AAPL");
  ok(mock.analyzeCalls.filter((s) => s === "AAPL").length === 1, "re-opening AAPL the SAME day fires analyze ZERO more times (cached)");
  const detail2 = await page.evaluate(() => (document.querySelector(".finai-body") || {}).textContent || "");
  ok(detail2 === detail1.text, "…and shows the identical cached text instantly");
  await tap(page, ".finsheet-x");
  await sleep(150);

  mock.analyzeFail = true;
  await openStock(page, "MSFT");
  mock.analyzeFail = false;
  ok(mock.analyzeCalls.filter((s) => s === "MSFT").length === 1, "MSFT's analyze was attempted once");
  const failDetail = await page.evaluate(() => ({
    text: (document.querySelector(".finai-body") || {}).textContent || "",
    hasDisc: !!document.querySelector(".findisclaimer"),
  }));
  ok(failDetail.text === "Couldn't write an analysis just now.", `analyze failure shows the exact fallback copy (got "${failDetail.text}")`);
  ok(failDetail.hasDisc, "…and the disclaimer is STILL present even on failure");
  await tap(page, ".finsheet-x");
  await sleep(150);

  /* -- chart: real x/y axes, Day/Week/Month/Year toggle actually redraws it -- */
  section("B2b. Chart — real x/y axes, Day/Week/Month/Year toggle");

  await openStock(page, "AAPL");
  // A direct state check (via the __FIN__ hook), not a network-log check: AAPL's month chart
  // may have been fetched fresh OR served from this session's own TTL cache (it was already
  // opened earlier in B2's analyze tests) — either is correct, and the state hook is immune to
  // that ambiguity where inspecting the LAST logged network call would not be. The mechanism
  // that actually sends "range" over the wire is verified below by the Day/Week/Year taps,
  // each of which is guaranteed fresh (never fetched earlier in this test run).
  const chartState = await page.evaluate(() => {
    const item = window.__FIN__.chartItem("AAPL", "month");
    return { hasItem: !!item, closesLen: item && Array.isArray(item.closes) ? item.closes.length : 0, activeRange: window.__FIN__.chartRange() };
  });
  ok(chartState.hasItem && chartState.closesLen > 0, `opening the sheet auto-loads the chart's default range (Month) with real data (${chartState.closesLen} points)`);
  ok(chartState.activeRange === "month", "…and Month is the active range");

  const monthGeo = await page.evaluate(() => {
    const svg = document.querySelector(".finaxischart");
    const poly = svg && svg.querySelector("polyline");
    return {
      hasChart: !!svg,
      yLabels: svg ? [...svg.querySelectorAll(".fin-axislabel-y")].map((t) => t.textContent) : [],
      xLabels: svg ? [...svg.querySelectorAll(".fin-axislabel-x")].map((t) => t.textContent) : [],
      axisLines: svg ? svg.querySelectorAll(".fin-axisline").length : 0,
      gridlines: svg ? svg.querySelectorAll(".fin-gridline").length : 0,
      points: poly ? poly.getAttribute("points") : null,
      activeRange: (document.querySelector(".finrangepills button.sel") || {}).dataset && document.querySelector(".finrangepills button.sel").dataset.range,
      pillLabels: [...document.querySelectorAll(".finrangepills button")].map((b) => b.textContent),
    };
  });
  ok(monthGeo.hasChart, "the detail sheet draws a real chart (not the old bare sparkline)");
  ok(monthGeo.pillLabels.join(",") === "Day,Week,Month,Year", `the range toggle shows exactly Day/Week/Month/Year, in order (got ${monthGeo.pillLabels.join(",")})`);
  ok(monthGeo.activeRange === "month", `the sheet opens on the Month range by default (got "${monthGeo.activeRange}")`);
  ok(monthGeo.yLabels.length >= 3, `chart has real Y-AXIS price labels (${monthGeo.yLabels.length}: ${monthGeo.yLabels.join(" | ")})`);
  ok(monthGeo.yLabels.every((l) => /\$/.test(l)), "…formatted as prices, same style as the rest of the sheet");
  ok(monthGeo.xLabels.length >= 3, `chart has real X-AXIS date labels (${monthGeo.xLabels.length}: ${monthGeo.xLabels.join(" | ")})`);
  ok(new Set(monthGeo.xLabels).size > 1, "…and they are not all the same repeated label");
  ok(monthGeo.axisLines === 2, "chart draws both axis lines (x and y)");
  ok(monthGeo.gridlines >= 3, "chart draws horizontal gridlines tied to the Y labels");
  ok(!!monthGeo.points, "chart draws the actual price line");

  /* -- tapping Day: pill highlights immediately, a loading state shows, then a DIFFERENT
        chart (different data, not just a relabeled Month line) replaces it -- */
  mock.rangeDelayMs = 300;
  await tap(page, '.finrangepills button[data-range="day"]');
  await sleep(90);   // well inside the 300ms mock delay
  const chartMidFlight = await page.evaluate(() => ({
    activeRange: (document.querySelector(".finrangepills button.sel") || {}).dataset && document.querySelector(".finrangepills button.sel").dataset.range,
    msg: (document.querySelector(".finchartmsg") || {}).textContent || "",
    hasOldChart: !!document.querySelector(".finaxischart"),
    hasDisc: !!document.querySelector(".findisclaimer"),
  }));
  ok(chartMidFlight.activeRange === "day", "the Day pill highlights the INSTANT it's tapped, before its own data has arrived");
  ok(/Loading chart/.test(chartMidFlight.msg), `…and an honest loading message shows while Day's data is in flight ("${chartMidFlight.msg}")`);
  ok(!chartMidFlight.hasOldChart, "…the stale Month chart is replaced by the loading message, not left showing under a wrong label");
  ok(chartMidFlight.hasDisc, "…and — same rule as the AI section — the disclaimer survives the chart's loading state too");
  mock.rangeDelayMs = 0;
  await page.waitForFunction(() => document.querySelector(".finaxischart"), { timeout: 8000 });

  const dayGeo = await page.evaluate(() => {
    const svg = document.querySelector(".finaxischart");
    return {
      points: svg.querySelector("polyline").getAttribute("points"),
      xLabels: [...svg.querySelectorAll(".fin-axislabel-x")].map((t) => t.textContent),
    };
  });
  ok(dayGeo.points !== monthGeo.points, "switching to Day actually redraws the line with DIFFERENT data, not the same Month geometry relabeled");
  ok(dayGeo.xLabels.join("|") !== monthGeo.xLabels.join("|"), `Day's x-axis labels read differently from Month's (Day: ${dayGeo.xLabels.join(" | ")})`);
  ok(mock.rangeCallLog[mock.rangeCallLog.length - 1].range === "day", "tapping Day actually sent range:\"day\" to the server");

  /* -- Week and Year: same mechanism, lighter check -- */
  for (const key of ["week", "year"]){
    await tap(page, `.finrangepills button[data-range="${key}"]`);
    await page.waitForFunction((k) => {
      const b = document.querySelector(".finrangepills button.sel");
      return b && b.dataset.range === k;
    }, {}, key);
    // Wait for a SETTLED chart state. ".finchartmsg" also covers the in-flight "Loading chart…"
    // message, so accepting it here resolved the wait instantly on the loading state and the
    // assertion below then read the DOM mid-flight — the failure moved between week/year run to
    // run, which is the signature of a race rather than a real defect. Settled = a drawn chart, or
    // a message that is NOT the loading one.
    await page.waitForFunction(() => {
      if (document.querySelector(".finaxischart")) return true;
      const m = document.querySelector(".finchartmsg");
      return !!m && !/loading/i.test(m.textContent || "");
    }, { timeout: 8000 });
    ok(mock.rangeCallLog[mock.rangeCallLog.length - 1].range === key, `tapping ${key} sends range:"${key}" to the server`);
    ok(await page.evaluate(() => !!document.querySelector(".finaxischart")), `${key}'s own data renders a real chart (not a "no data" message — the mock always supplies closes for AAPL)`);
  }

  /* -- switching between ranges within one open re-uses the cache: exactly one request per
        range, not one per tap -- */
  const monthReqs = mock.rangeCallLog.filter((r) => r.range === "month").length;
  await tap(page, '.finrangepills button[data-range="month"]');
  await sleep(150);
  const monthReqsAfter = mock.rangeCallLog.filter((r) => r.range === "month").length;
  ok(monthReqsAfter === monthReqs, "flipping back to a range already fetched THIS sheet-open session reuses the cache — no new request");
  ok(await page.evaluate(() => (document.querySelector(".finrangepills button.sel") || {}).dataset.range === "month"), "…and the Month pill/chart are back instantly");

  /* -- a symbol with genuinely no history says so honestly, never an empty box -- */
  await tap(page, ".finsheet-x");
  await sleep(150);
  await openStock(page, "FLATCO");
  const flatGeo = await page.evaluate(() => ({
    hasChart: !!document.querySelector(".finaxischart"),
    msg: (document.querySelector(".finchartmsg") || {}).textContent || "",
  }));
  ok(!flatGeo.hasChart, "FLATCO (no history in any range) never draws an empty/broken chart");
  ok(/no chart data/i.test(flatGeo.msg), `…it says so honestly instead ("${flatGeo.msg}")`);
  await tap(page, ".finsheet-x");
  await sleep(150);

  if (WANT_SHOTS){
    fs.mkdirSync(SHOTS, { recursive: true });
    await openStock(page, "AAPL");
    await page.screenshot({ path: path.join(SHOTS, "fin_chart.png") });
    await tap(page, ".finsheet-x");
    await sleep(150);
  }

  /* -- layout: no horizontal scroll, nav still balanced for Dad -- */
  section("B3. Layout — no horizontal scroll, nav still two balanced rows for Dad");
  const layout = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  ok(layout.scrollW <= layout.clientW + 1, `no horizontal page scroll on Finance at 390px (scrollWidth ${layout.scrollW} vs clientWidth ${layout.clientW})`);
  const geo = await navGeo(page);
  ok(geo.rows === 2, `Dad: bottom nav is two rows (${geo.rows})`);
  ok(geo.rowCounts.length === 2 && Math.abs(geo.rowCounts[0] - geo.rowCounts[1]) <= 1,
    `…balanced (${geo.rowCounts.join(" vs ")})`);
  ok(geo.clipped === 0, "…and no nav label is clipped for Dad (who sees every area)");

  ok(errors.length === 0, "Dad: no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ==================================================================================
   C. Per-account proof — two profiles, two different lists, Home card + persistence
   ================================================================================== */
async function sectionAccounts(browser, mock){
  section("C. Per-account watchlist — different profiles, different lists, Home card, persistence");

  mock.seriesCalls = 0;

  /* -- Dad and Mom have DIFFERENT lists; the Home card shows the logged-in person's own -- */
  {
    const { page: dadPage, errors: dadErr } = await newPage(browser, mock, { user: "Dad", watchlists: { Dad: ["AAPL"] } });
    await boot(dadPage);
    await dadPage.waitForFunction(() => document.querySelector(".home2 .stockcard"), { timeout: 10000 });
    await dadPage.waitForFunction(() => document.querySelector(".home2 .stockcard .stsym"), { timeout: 10000 });
    const dadHome = await dadPage.evaluate(() => [...document.querySelectorAll(".home2 .stockcard .stsym")].map((e) => e.textContent));
    ok(dadHome.includes("AAPL") && !dadHome.includes("MSFT"), `Dad's Home card shows only Dad's own picks (${dadHome.join(",")})`);
    ok(dadErr.length === 0, "Dad Home: no page errors" + (dadErr.length ? ": " + dadErr[0] : ""));

    const { page: momPage, errors: momErr } = await newPage(browser, mock, { user: "Mom", watchlists: { Mom: ["MSFT"] } });
    await boot(momPage);
    await momPage.waitForFunction(() => document.querySelector(".home2 .stockcard .stsym"), { timeout: 10000 });
    const momHome = await momPage.evaluate(() => [...document.querySelectorAll(".home2 .stockcard .stsym")].map((e) => e.textContent));
    ok(momHome.includes("MSFT") && !momHome.includes("AAPL"), `Mom's Home card shows a DIFFERENT list — her own (${momHome.join(",")})`);
    ok(momErr.length === 0, "Mom Home: no page errors" + (momErr.length ? ": " + momErr[0] : ""));

    // Same proof from the Finance tab side, for Mom.
    await gotoFinance(momPage);
    await momPage.waitForFunction(() => document.querySelectorAll(".finrow").length >= 1, { timeout: 10000 });
    const momFin = await momPage.evaluate(() => [...document.querySelectorAll(".finrow")].map((r) => r.dataset.sym));
    ok(momFin.includes("MSFT") && !momFin.includes("AAPL"), `Mom's Finance watchlist matches her account, not Dad's (${momFin.join(",")})`);
  }

  /* -- migration: a legacy per-DEVICE list seeds a person's first-ever cloud list -- */
  {
    const { page, errors } = await newPage(browser, mock, { user: "Dad" });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem("bucky_stocks", JSON.stringify(["TSLA"]));
    });
    await boot(page);
    await gotoFinance(page);
    await page.waitForFunction(() => document.querySelectorAll(".finrow").length >= 1, { timeout: 10000 });
    const migrated = await page.evaluate(() => [...document.querySelectorAll(".finrow")].map((r) => r.dataset.sym));
    ok(migrated.includes("TSLA"), `a person with no saved account list yet is migrated from the legacy device list (${migrated.join(",")})`);
    const legacyStillThere = await page.evaluate(() => !!localStorage.getItem("bucky_stocks"));
    ok(legacyStillThere, "…and the legacy device key is NOT deleted (another profile on this device might still want it)");
    ok(errors.length === 0, "migration: no page errors" + (errors.length ? ": " + errors[0] : ""));
  }

  /* -- persistence across reload -- */
  {
    const { page, errors } = await newPage(browser, mock, { user: "Dad", watchlists: { Dad: ["AAPL"] } });
    await boot(page);
    await gotoFinance(page);
    await page.waitForFunction(() => document.querySelectorAll(".finrow").length >= 1, { timeout: 10000 });

    await tap(page, ".finadd");
    await page.waitForFunction(() => document.querySelector(".finaddrow input"), { timeout: 3000 });
    await page.click(".finaddrow input");
    await page.type(".finaddrow input", "TSLA");
    await page.click(".finaddrow button");
    await page.waitForFunction(() => document.querySelector('.finrow[data-sym="TSLA"]'), { timeout: 8000 });

    await boot(page);   // a fresh navigation to the same origin — the reload-equivalent
    await gotoFinance(page);
    await page.waitForFunction(() => document.querySelectorAll(".finrow").length >= 1, { timeout: 10000 });
    const afterReload = await page.evaluate(() => [...document.querySelectorAll(".finrow")].map((r) => r.dataset.sym));
    ok(afterReload.includes("TSLA") && afterReload.includes("AAPL"), `an added ticker PERSISTS across a reload (${afterReload.join(",")})`);
    ok(errors.length === 0, "persistence: no page errors" + (errors.length ? ": " + errors[0] : ""));
  }
}

/* ==================================================================================
   D. Desktop
   ================================================================================== */
async function sectionDesktop(browser, mock){
  section("D. Desktop (≥1024px rail)");

  const { page, errors } = await newPage(browser, mock, {
    user: "Dad", viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
    watchlists: { Dad: ["AAPL", "MSFT"] },
  });
  await boot(page);
  await gotoFinance(page);
  await page.waitForFunction(() => document.querySelectorAll(".finrow").length >= 2, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.finmkt[data-sym="^GSPC"] .finmkt-p'), { timeout: 10000 });

  const desk = await page.evaluate(() => ({
    bnav: getComputedStyle(document.getElementById("bnav")).display,
    railVisible: getComputedStyle(document.getElementById("sidenav")).display !== "none",
    active: (document.querySelector("#sidenav .sn-item.active .sn-label") || {}).textContent,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    mkts: document.querySelectorAll(".finmkt").length,
    rows: document.querySelectorAll(".finrow").length,
  }));
  ok(desk.bnav === "none" && desk.railVisible, "desktop: bottom bar is gone, the left rail is up");
  ok(desk.active === "Finance", `…and the rail highlights "Finance" for Dad (got "${desk.active}")`);
  ok(desk.scrollW <= desk.clientW + 1, `no horizontal scroll at 1280px (scrollWidth ${desk.scrollW} vs clientWidth ${desk.clientW})`);
  ok(desk.mkts === 3 && desk.rows === 2, "…and the markets strip + watchlist both render correctly under the rail");

  if (WANT_SHOTS){
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "fin_desktop.png") });
  }
  ok(errors.length === 0, "desktop: no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ================================ run ===================================== */
(async () => {
  const srv = await serve();
  const mock = makeStocksMock();
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  try {
    await sectionAudience(browser, mock);
    await sectionFinanceTab(browser, mock);
    await sectionAccounts(browser, mock);
    await sectionDesktop(browser, mock);
  } catch (err) {
    fail++; failures.push("suite crashed: " + err.message);
    console.log("\n✗ SUITE ERROR: " + (err && err.stack || err));
  } finally {
    await browser.close();
    srv.close();
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`FINANCE: ${pass}/${pass + fail} checks passed`);
  if (fail){ console.log("\nFailures:"); for (const f of failures) console.log("  ✗ " + f); }
  process.exit(fail ? 1 : 0);
})();
