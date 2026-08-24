#!/usr/bin/env node
"use strict";
/**
 * REI Portfolio suite — portfolio.html, the standalone Laws Family REI LLC valuation
 * history + scenario model.
 *
 *   node tools/_verify-portfolio.cjs [--shots]
 *
 * Drives the real page headless (mobile 390x844 + desktop 1280x900 + a file:// pass,
 * because the page is delivered as a standalone file). ALL external hosts are blocked —
 * the page embeds its data and must make zero network requests beyond the page itself;
 * an external fetch is a failure, not a warning. Firebase/googleapis are blocked by
 * pattern as well per the house rule, though this page never had them.
 *
 * Arithmetic is asserted against hand-computed constants taken from the four source
 * workbooks (totals cross-checked against each workbook's own Total and Management Fee
 * cells), and the projection engine is compared against an INDEPENDENT reimplementation
 * of the documented quarter loop (grow → contribute → withdraw cash-first → fee on the
 * end-of-quarter balance) — double entry, not a copy of the page's code path.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const WANT_SHOTS = process.argv.includes("--shots");
const PORT = 8946;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "amenfarms";

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
};
const approx = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 0.01 : eps);
const section = (t) => console.log("\n=== " + t + " ===");

/* ---- hand-computed constants from the workbooks (not read from the page) ---- */
const TOTALS = { s1: 14906239, s2: 15889710.37, s3: 16378276.40, s4: 17032658 };
const FEES   = { s1: 18632.79875, s2: 19862.1379625, s3: 20472.8455, s4: 21290.8225 }; // total × 0.005/4
const START_BY_CLASS = { // latest (7/10/26) snapshot summed by class, by hand
  core: 12410312, public: 1608801, funds: 1747872, synd: 771000, cash: 283146, credit: 211527,
};
const FLOWS_LAST_WINDOW = 150000;       // BSSS +50k 4/1/26, HVG +100k 6/12/26
const DAYS_S1_S4 = 453;                 // 2025-04-13 → 2026-07-10
const YRS_S1_S4 = DAYS_S1_S4 / 365.25;
const CAGR_S1_S4 = Math.pow((TOTALS.s4 - FLOWS_LAST_WINDOW) / TOTALS.s1, 1 / YRS_S1_S4) - 1; // ≈ 10.56%

/* ============================ static server =============================== */
const MIME = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/portfolio.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.statusCode = 404; return res.end("not found");
      }
      res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ============================ browser launch ============================== */
async function launch() {
  const attempts = [
    { channel: "chrome" },
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : null,
    { executablePath: "/opt/pw-browsers/chromium" },
    { executablePath: "/usr/bin/chromium" },
    { executablePath: "/usr/bin/google-chrome" },
  ].filter(Boolean);
  let lastErr;
  for (const a of attempts) {
    try {
      return await puppeteer.launch(Object.assign({
        headless: "new",
        args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
      }, a));
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/* every page in this suite: block all external hosts, collect page errors */
async function prepPage(browser, { width, height }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const external = [];
  const errors = [];
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (/googleapis|firestore|firebase|gstatic/i.test(u)) { external.push(u); return req.abort(); }
    if (!/^(http:\/\/127\.0\.0\.1|file:|data:|about:)/.test(u)) { external.push(u); return req.abort(); }
    req.continue();
  });
  page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  return { page, external, errors };
}

async function unlockPage(page) {
  // pages share the profile's localStorage, so a later section may load already unlocked
  const locked = await page.evaluate(() => document.getElementById("pageMain").hidden);
  if (locked) {
    await page.type("#lockInput", PASSWORD);
    await page.click("#lockBtn");
  }
  await page.waitForFunction(() => document.getElementById("pageMain") && !document.getElementById("pageMain").hidden);
}

/* Independent re-statement of the documented quarter loop, written fresh here.
   Order per quarter: grow at class rate^(1/4) → distribution income (yield/4 of each
   non-cash class's value) paid into cash → contribution in → withdrawal out
   (cash first, then pro-rata) → sweep cash above the buffer into public →
   fee = rate/4 × end-of-quarter total, deducted pro-rata when feeFromPortfolio. */
function refProject(start, cfg) {
  const ids = Object.keys(start);
  const v = {};
  ids.forEach((id) => { v[id] = start[id] * (1 + ((cfg.reval && cfg.reval[id]) || 0)); });
  let cumFee = 0;
  const nq = Math.round(cfg.years * 4);
  for (let q = 1; q <= nq; q++) {
    ids.forEach((id) => { v[id] *= Math.pow(1 + (cfg.growth[id] || 0), 0.25); });
    ids.forEach((id) => {
      const yl = (cfg.yield && cfg.yield[id]) || 0;
      if (yl && id !== "cash") v.cash += v[id] * yl / 4;
    });
    if (cfg.contribAnnual) v[cfg.contribClass || "funds"] += cfg.contribAnnual / 4;
    if (cfg.withdrawAnnual) {
      let need = cfg.withdrawAnnual / 4;
      const fromCash = Math.min(need, Math.max(0, v.cash));
      v.cash -= fromCash; need -= fromCash;
      const rest = ids.reduce((s, id) => s + v[id], 0);
      if (need > 0 && rest > 0) {
        const scale = Math.max(0, 1 - need / rest);
        ids.forEach((id) => { v[id] *= scale; });
      }
    }
    if (cfg.sweep) {
      const excess = v.cash - (cfg.cashBuffer || 0);
      if (excess > 0) { v.cash -= excess; v.public += excess; }
    }
    const tot = ids.reduce((s, id) => s + v[id], 0);
    const feeQ = tot * (cfg.feeAnnual || 0) / 4;
    cumFee += feeQ;
    if (cfg.feeFromPortfolio && tot > 0) ids.forEach((id) => { v[id] -= feeQ * v[id] / tot; });
  }
  return { total: ids.reduce((s, id) => s + v[id], 0), byClass: v, cumFee };
}

/* ============================ sections ==================================== */

async function sectionGate(browser) {
  section("Family gate (geometry, not attributes)");
  const { page, errors } = await prepPage(browser, { width: 390, height: 844 });
  await page.goto(BASE + "/portfolio.html", { waitUntil: "networkidle0" });

  let g = await page.evaluate(() => ({
    lockVisible: document.getElementById("lockScreen").getClientRects().length > 0,
    mainHidden: document.getElementById("pageMain").offsetParent === null,
    headerHidden: document.getElementById("pageHeader").offsetParent === null,
  }));
  ok(g.lockVisible, "locked on first load: lock screen renders");
  ok(g.mainHidden && g.headerHidden, "locked on first load: main + header have no geometry");

  await page.type("#lockInput", "wrongpassword");
  await page.click("#lockBtn");
  g = await page.evaluate(() => ({
    err: document.getElementById("lockErr").textContent.trim(),
    mainHidden: document.getElementById("pageMain").offsetParent === null,
  }));
  ok(g.err.length > 0, "wrong password: error message shown");
  ok(g.mainHidden, "wrong password: still locked");

  await page.evaluate(() => { document.getElementById("lockInput").value = ""; });
  await unlockPage(page);
  g = await page.evaluate(() => ({
    lockGone: document.getElementById("lockScreen").getClientRects().length === 0,
    mainVisible: document.getElementById("pageMain").offsetParent !== null,
    stored: localStorage.getItem("reiPortfolioUnlock") === "1",
  }));
  ok(g.lockGone, "right password: lock screen has no geometry");
  ok(g.mainVisible, "right password: main content renders");
  ok(g.stored, "right password: unlock remembered in localStorage");

  await page.reload({ waitUntil: "networkidle0" });
  g = await page.evaluate(() => ({
    lockGone: document.getElementById("lockScreen").getClientRects().length === 0,
    mainVisible: document.getElementById("pageMain").offsetParent !== null,
  }));
  ok(g.lockGone && g.mainVisible, "reload: stays unlocked");

  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(hscroll <= 391, `mobile 390px: no horizontal page scroll (scrollWidth ${hscroll})`);
  const mfit = await page.evaluate(() => {
    const v = document.querySelector("#kpiTiles .tile.hero .val");
    const r = document.createRange();
    r.selectNodeContents(v);
    return { inkW: r.getBoundingClientRect().width, boxW: v.getBoundingClientRect().width,
             inkH: r.getBoundingClientRect().height, fontPx: parseFloat(getComputedStyle(v).fontSize) };
  });
  ok(mfit.inkW <= mfit.boxW + 0.5 && mfit.inkH < mfit.fontPx * 2, "mobile: hero AUM ink fits on one line");
  ok(errors.length === 0, "gate pass: no page errors" + (errors.length ? ": " + errors[0] : ""));
  if (WANT_SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "portfolio_mobile.png"), fullPage: true });
  }
  await page.close();
}

async function sectionData(browser) {
  section("Embedded dataset ties to the workbooks");
  const { page } = await prepPage(browser, { width: 1280, height: 900 });
  await page.goto(BASE + "/portfolio.html", { waitUntil: "networkidle0" });
  await unlockPage(page);

  const d = await page.evaluate(() => {
    const R = window.REI;
    const snaps = R.allSnapshots();
    return {
      n: snaps.length,
      dates: snaps.map((s) => s.date),
      totals: snaps.map((s) => R.snapTotal(s)),
      startByClass: R.classTotals(snaps[snaps.length - 1]),
      feeRate: R.DATA.feeRateAnnual,
      flowsLast: R.flowsBetween("2026-01-15", "2026-07-10"),
      flowsPrev: R.flowsBetween("2025-10-12", "2026-01-15"),
      flowsBsss: R.flowsBetween("2026-01-15", "2026-07-10", "bsss"),
      flowBoundaryExcl: R.flowsBetween("2026-06-12", "2026-07-10"),
      flowBoundaryIncl: R.flowsBetween("2026-06-11", "2026-06-12"),
      implied: R.impliedAnnual(100, 121, 0, 2),
      impliedFlows: R.impliedAnnual(100000, 160000, 50000, 1),
      years: R.yearsBetween("2025-04-13", "2026-07-10"),
      assets: R.allAssets().length,
    };
  });
  ok(d.n === 4, "four workbook snapshots embedded");
  ok(d.dates.join(",") === "2025-04-13,2025-10-12,2026-01-15,2026-07-10", "snapshot dates sorted: " + d.dates.join(", "));
  ok(approx(d.totals[0], TOTALS.s1), `4/13/25 total = $14,906,239 (workbook Total cell), got ${d.totals[0]}`);
  ok(approx(d.totals[1], TOTALS.s2), `10/12/25 total = $15,889,710.37, got ${d.totals[1]}`);
  ok(approx(d.totals[2], TOTALS.s3), `1/15/26 total = $16,378,276.40, got ${d.totals[2]}`);
  ok(approx(d.totals[3], TOTALS.s4), `7/10/26 total = $17,032,658, got ${d.totals[3]}`);
  ok(d.feeRate === 0.005, "fee rate 0.5%/yr as billed in the workbooks");
  for (const [cls, want] of Object.entries(START_BY_CLASS)) {
    ok(approx(d.startByClass[cls], want), `class total now, ${cls} = ${want}`);
  }
  ok(approx(Object.values(d.startByClass).reduce((a, b) => a + b, 0), TOTALS.s4), "class totals sum to AUM");
  ok(d.flowsLast === 150000, "flows in last window = $150k (BSSS 50k + HVG 100k)");
  ok(d.flowsPrev === 0, "no recorded flows 10/12/25 → 1/15/26");
  ok(d.flowsBsss === 50000, "per-asset flow filter: BSSS $50k");
  ok(d.flowBoundaryExcl === 0 && d.flowBoundaryIncl === 100000, "flow window is (after, upto]: start-date flow excluded, end-date included");
  ok(approx(d.implied, 0.1, 1e-12), "impliedAnnual: 100 → 121 over 2y = exactly 10%/yr");
  ok(approx(d.impliedFlows, 0.1, 1e-12), "impliedAnnual holds out flows: (160k−50k)/100k over 1y = 10%");
  ok(approx(d.years, YRS_S1_S4, 1e-9), `4/13/25 → 7/10/26 = ${DAYS_S1_S4} days = ${YRS_S1_S4.toFixed(4)} yrs`);
  ok(d.assets === 15, "15 assets in the register (14 in 4/25, HVG added 7/26)");
  await page.close();
}

async function sectionKPIs(browser) {
  section("Overview KPIs (rendered text vs hand math)");
  const { page } = await prepPage(browser, { width: 1280, height: 900 });
  await page.goto(BASE + "/portfolio.html", { waitUntil: "networkidle0" });
  await unlockPage(page);

  // template literals wrap across source lines; normalise whitespace before matching
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const tiles = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#kpiTiles .tile")).map((t) => t.textContent));
  const all = norm(tiles.join(" | "));

  ok(/\$17,032,658/.test(all), "hero shows current AUM $17,032,658");
  ok(/as of Jul 10, 2026/.test(all), "hero dated Jul 10, 2026 (filename date, not the stale 4.11.26 header cell)");
  // QoQ ex-flows: (17,032,658 − 16,378,276.40 − 150,000) / 16,378,276.40 = 3.0795% → +3.1%
  ok(/\+3\.1%/.test(all), "QoQ ex new capital = +3.1%");
  ok(/\$504,382|\$504,381/.test(all), "QoQ growth dollars ≈ $504,382 ex the $150k added");
  // trailing flow-adjusted CAGR ≈ 10.56% → +10.6%
  const wantCagr = "+" + (CAGR_S1_S4 * 100).toFixed(1) + "%";
  ok(all.includes(wantCagr), `trailing annualized growth tile = ${wantCagr}`);
  ok(/\$21,290\.82/.test(all), "current quarterly fee $21,290.82 (= 17,032,658 × 0.005 / 4)");

  // the hero figure clipped to "$17,032,65" on the first desktop plate: the element's
  // box was fine, the ink wasn't. Measure the rendered text itself with a Range.
  const fit = await page.evaluate(() => {
    const v = document.querySelector("#kpiTiles .tile.hero .val");
    const r = document.createRange();
    r.selectNodeContents(v);
    const ink = r.getBoundingClientRect();
    const box = v.getBoundingClientRect();
    return { inkW: ink.width, boxW: box.width, inkH: ink.height, fontPx: parseFloat(getComputedStyle(v).fontSize) };
  });
  ok(fit.inkW <= fit.boxW + 0.5, `hero AUM ink (${fit.inkW.toFixed(0)}px) fits its tile (${fit.boxW.toFixed(0)}px)`);
  ok(fit.inkH < fit.fontPx * 2, "hero AUM renders on one line, not wrapped");

  const feeNote = norm(await page.evaluate(() => document.getElementById("feeNote").textContent));
  // sum of the four workbook quarterly fees
  const totalFees = (FEES.s1 + FEES.s2 + FEES.s3 + FEES.s4).toFixed(2);
  const wantFees = "$" + Number(totalFees).toLocaleString("en-US", { minimumFractionDigits: 2 });
  ok(feeNote.includes(wantFees), `fee note quotes fees to date ${wantFees}`);
  await page.close();
}

async function sectionEngine(browser) {
  section("Projection engine identities");
  const { page } = await prepPage(browser, { width: 1280, height: 900 });
  await page.goto(BASE + "/portfolio.html", { waitUntil: "networkidle0" });
  await unlockPage(page);

  const zeroG = { core: 0, public: 0, funds: 0, synd: 0, cash: 0, credit: 0 };
  const r = await page.evaluate((zg) => {
    const R = window.REI;
    const start = R.classTotals(R.allSnapshots()[3]);
    const run = (cfg) => R.project(start, cfg);
    const noFee = { years: 3, growth: Object.assign({}, zg), reval: {}, feeAnnual: 0, feeFromPortfolio: true };
    const feeOnly = { years: 2, growth: Object.assign({}, zg), reval: {}, feeAnnual: 0.005, feeFromPortfolio: true };
    const feeOutside = { years: 2, growth: Object.assign({}, zg), reval: {}, feeAnnual: 0.005, feeFromPortfolio: false };
    const growCore = { years: 1, growth: Object.assign({}, zg, { core: 0.10 }), reval: {}, feeAnnual: 0, feeFromPortfolio: true };
    const revalSynd = { years: 1, growth: Object.assign({}, zg), reval: { synd: -0.30 }, feeAnnual: 0, feeFromPortfolio: true };
    const contrib = { years: 1, growth: Object.assign({}, zg), reval: {}, feeAnnual: 0, feeFromPortfolio: true, contribAnnual: 100000, contribClass: "funds" };
    const withdraw = { years: 1, growth: Object.assign({}, zg), reval: {}, feeAnnual: 0, feeFromPortfolio: true, withdrawAnnual: 200000 };
    const bigDraw = { years: 0.25, growth: Object.assign({}, zg), reval: {}, feeAnnual: 0, feeFromPortfolio: true, withdrawAnnual: 2000000 };
    const yieldOnly = { years: 1, growth: Object.assign({}, zg), yield: { core: 0.04 }, reval: {}, feeAnnual: 0, feeFromPortfolio: true };
    const sweepOnly = { years: 0.5, growth: Object.assign({}, zg), reval: {}, feeAnnual: 0, feeFromPortfolio: true, sweep: true, cashBuffer: 250000 };
    const yieldSweep = { years: 0.25, growth: Object.assign({}, zg), yield: { core: 0.04 }, reval: {}, feeAnnual: 0, feeFromPortfolio: true, sweep: true, cashBuffer: 250000 };
    const drawAndSweep = { years: 0.25, growth: Object.assign({}, zg), yield: { core: 0.04 }, reval: {}, feeAnnual: 0, feeFromPortfolio: true, withdrawAnnual: 400000, sweep: true, cashBuffer: 250000 };
    const A = R.defaultAssumptions();
    const baseCfg = R.scenarioCfg(A, "base");
    const bearCfg = R.scenarioCfg(A, "bear");
    const bullCfg = R.scenarioCfg(A, "bull");
    return {
      start,
      noFeeTotals: run(noFee).points.map((p) => p.total),
      feeOnlyEnd: run(feeOnly).points[8].total,
      feeOnlyCum: run(feeOnly).cumFee,
      feeOutsideEnd: run(feeOutside).points[8].total,
      feeOutsideCum: run(feeOutside).cumFee,
      growCoreEnd: run(growCore).points[4].byClass.core,
      growCoreOthers: run(growCore).points[4].byClass.public,
      revalT0: run(revalSynd).points[0].total,
      contribEnd: run(contrib).points[4],
      withdrawEnd: run(withdraw).points[4],
      bigDrawQ1: run(bigDraw).points[1],
      yieldOnlyRun: (() => { const o = run(yieldOnly); return { end: o.points[4], cumIncome: o.cumIncome, cumSwept: o.cumSwept }; })(),
      sweepOnlyRun: (() => { const o = run(sweepOnly); return { q1: o.points[1], q2: o.points[2], cumSwept: o.cumSwept }; })(),
      yieldSweepQ1: (() => { const o = run(yieldSweep); return { q1: o.points[1], cumSwept: o.cumSwept }; })(),
      drawSweepQ1: (() => { const o = run(drawAndSweep); return { q1: o.points[1], cumSwept: o.cumSwept }; })(),
      baseSwept: run(baseCfg).cumSwept,
      baseEnd: run(baseCfg).points[baseCfg.years * 4].total,
      bearEnd: run(bearCfg).points[bearCfg.years * 4].total,
      bullEnd: run(bullCfg).points[bullCfg.years * 4].total,
      baseCfg, bearCfg, bullCfg,
    };
  }, zeroG);

  ok(r.noFeeTotals.every((t) => approx(t, TOTALS.s4, 1e-6)),
    "zero growth, zero fee, no flows → AUM constant at $17,032,658 for 12 quarters");
  const feeFactor = Math.pow(1 - 0.005 / 4, 8);
  ok(approx(r.feeOnlyEnd, TOTALS.s4 * feeFactor, 0.01),
    `fee-only 2y → total × (1−0.00125)^8 = ${(TOTALS.s4 * feeFactor).toFixed(2)}`);
  let cumRef = 0, run4 = TOTALS.s4;
  for (let q = 0; q < 8; q++) { const f = run4 * 0.00125; cumRef += f; run4 -= f; }
  ok(approx(r.feeOnlyCum, cumRef, 0.01), `fee-only 2y cumulative fees = ${cumRef.toFixed(2)}`);
  ok(approx(r.feeOutsideEnd, TOTALS.s4, 1e-6), "fee billed outside → portfolio value untouched");
  ok(approx(r.feeOutsideCum, TOTALS.s4 * 0.00125 * 8, 0.01), "fee billed outside → cumFee = total × 0.125% × 8");
  ok(approx(r.growCoreEnd, START_BY_CLASS.core * 1.10, 0.01),
    "10%/yr on one class → exactly ×1.10 after 4 quarterly compounds");
  ok(approx(r.growCoreOthers, START_BY_CLASS.public, 1e-6), "other classes untouched by that growth");
  ok(approx(r.revalT0, TOTALS.s4 - 0.30 * START_BY_CLASS.synd, 0.01),
    `−30% reval on syndications → day-one total ${(TOTALS.s4 - 0.30 * START_BY_CLASS.synd).toFixed(0)}`);
  ok(approx(r.contribEnd.total, TOTALS.s4 + 100000, 1e-6) && approx(r.contribEnd.byClass.funds, START_BY_CLASS.funds + 100000, 1e-6),
    "contributions land in the chosen class: +$100k/yr → funds +$100k after 1y");
  ok(approx(r.withdrawEnd.total, TOTALS.s4 - 200000, 1e-6) && approx(r.withdrawEnd.byClass.cash, START_BY_CLASS.cash - 200000, 1e-6),
    "withdrawals come from cash first: −$200k/yr → cash 283,146 → 83,146");
  ok(approx(r.bigDrawQ1.total, TOTALS.s4 - 500000, 0.01) && approx(r.bigDrawQ1.byClass.cash, 0, 1e-6),
    "withdrawal beyond cash: cash floors at 0, remainder pro-rata, total −$500k in Q1");

  // ---- distribution income + cash sweep (the RE → cash → Schwab mechanic) ----
  // core 12,410,312 × 4%/yr, growth 0 → exactly 124,103.12/quarter into cash
  const incQ = START_BY_CLASS.core * 0.04 / 4;
  ok(approx(r.yieldOnlyRun.end.byClass.cash, START_BY_CLASS.cash + 4 * incQ, 0.01)
     && approx(r.yieldOnlyRun.end.byClass.core, START_BY_CLASS.core, 1e-6)
     && approx(r.yieldOnlyRun.end.total, TOTALS.s4 + 4 * incQ, 0.01),
    "yield, no sweep: 4%/yr on core pays $124,103.12/qtr into cash; marks untouched; AUM up by the income");
  ok(approx(r.yieldOnlyRun.cumIncome, 4 * incQ, 0.01) && r.yieldOnlyRun.cumSwept === 0,
    "yield, no sweep: cumIncome tracked, nothing swept");
  // sweep only: opening cash 283,146 vs 250,000 buffer → 33,146 to public in Q1, then nothing
  ok(approx(r.sweepOnlyRun.q1.byClass.cash, 250000, 1e-6)
     && approx(r.sweepOnlyRun.q1.byClass.public, START_BY_CLASS.public + 33146, 0.01)
     && approx(r.sweepOnlyRun.q1.total, TOTALS.s4, 1e-6),
    "sweep only: Q1 moves the $33,146 above the buffer to public; total unchanged");
  ok(approx(r.sweepOnlyRun.q2.byClass.cash, 250000, 1e-6) && approx(r.sweepOnlyRun.cumSwept, 33146, 0.01),
    "sweep only: at the buffer nothing more moves");
  // income then sweep in one quarter: cash 283,146 + 124,103.12 − 250,000 = 157,249.12 swept
  ok(approx(r.yieldSweepQ1.q1.byClass.cash, 250000, 1e-6)
     && approx(r.yieldSweepQ1.q1.byClass.public, START_BY_CLASS.public + 283146 + incQ - 250000, 0.01)
     && approx(r.yieldSweepQ1.cumSwept, 283146 + incQ - 250000, 0.01),
    "income then sweep: $157,249.12 reinvested into public in Q1");
  // withdrawal comes out before the sweep: 407,249.12 − 100,000 − 250,000 = 57,249.12 swept
  ok(approx(r.drawSweepQ1.q1.byClass.cash, 250000, 1e-6)
     && approx(r.drawSweepQ1.cumSwept, 283146 + incQ - 100000 - 250000, 0.01)
     && approx(r.drawSweepQ1.q1.total, TOTALS.s4 + incQ - 100000, 0.01),
    "withdrawal precedes sweep: only $57,249.12 left to reinvest");
  ok(r.baseSwept > 0, "default Base scenario reinvests distributions into Schwab");

  // double-entry: independent reimplementation must agree with the page engine
  for (const [name, cfg, got] of [["base", r.baseCfg, r.baseEnd], ["bear", r.bearCfg, r.bearEnd], ["bull", r.bullCfg, r.bullEnd]]) {
    const ref = refProject(r.start, cfg);
    ok(approx(got, ref.total, 1), `default ${name} 10y end ${got.toFixed(0)} matches independent reimplementation ${ref.total.toFixed(0)}`);
  }
  ok(r.bearEnd < r.baseEnd && r.baseEnd < r.bullEnd, "scenario ordering at horizon: bear < base < bull");
  await page.close();
}

async function sectionCharts(browser) {
  section("Charts & interaction");
  const { page, external, errors } = await prepPage(browser, { width: 1280, height: 900 });
  await page.goto(BASE + "/portfolio.html", { waitUntil: "networkidle0" });
  await unlockPage(page);

  const c = await page.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    return {
      aumPaths: q("#aumChart svg path"),
      allocSegs: q("#allocChart svg rect"),
      allocLegend: q("#allocLegend .li"),
      projPaths: q("#projChart svg path[stroke-dasharray]"),
      projLegend: q("#projLegend .li"),
      feePaths: q("#feeChart svg path[stroke-dasharray], #feeChart svg path:not([stroke])") + q("#feeChart svg path[stroke^='var(--s']"),
      sparks: q("#assetTable svg"),
      assetRows: q("#assetTable tr"),
      projRows: q("#projTable tr"),
      hiddenCssWorks: (() => {
        const ta = document.getElementById("ioArea");
        return ta.hidden && getComputedStyle(ta).display === "none";
      })(),
    };
  });
  ok(c.aumPaths >= 1, "AUM history chart has a line path");
  ok(c.allocSegs === 24, `allocation chart: 6 classes × 4 snapshots = 24 segments (got ${c.allocSegs})`);
  ok(c.allocLegend === 6, "allocation legend lists all 6 classes");
  ok(c.projPaths === 3, "projection chart: 3 dashed scenario lines");
  ok(c.projLegend === 4, "projection legend: history + 3 scenarios");
  ok(c.sparks === 15, "a sparkline per asset row");
  ok(c.assetRows === 17, "asset table: header + 15 assets + total row");
  ok(c.projRows === 12, "projection table: header + now + 10 year rows at default horizon");
  ok(c.hiddenCssWorks, "[hidden] carries display:none against styled containers");

  // crosshair tooltip on the AUM chart
  const aumBox = await (await page.$("#aumChart svg")).boundingBox();
  await page.mouse.move(aumBox.x + aumBox.width * 0.6, aumBox.y + aumBox.height * 0.5);
  let tip = await page.evaluate(() => {
    const t = document.querySelector("#aumChart .tooltip");
    return { shown: t && t.style.display !== "none", text: t ? t.textContent.replace(/\s+/g, " ") : "" };
  });
  ok(tip.shown && /Total AUM/.test(tip.text) && /\$\d/.test(tip.text), "AUM crosshair tooltip shows series + dollar value");

  // per-segment tooltip on the allocation chart (hover() scrolls it into view first —
  // the chart sits below the fold at 1280x900)
  const seg = await page.$("#allocChart svg rect");
  await seg.hover();
  tip = await page.evaluate(() => {
    const t = document.querySelector("#allocChart .tooltip");
    return { shown: t && t.style.display !== "none", text: t ? t.textContent.replace(/\s+/g, " ") : "" };
  });
  ok(tip.shown && /share/.test(tip.text), "allocation segment tooltip shows value + share");

  // horizon slider re-renders the projection table
  await page.evaluate(() => {
    const s = document.getElementById("horizonYears");
    s.value = 5;
    s.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const rows5 = await page.evaluate(() => document.querySelectorAll("#projTable tr").length);
  ok(rows5 === 7, "horizon 5y → projection table header + now + 5 rows");
  const out5 = await page.evaluate(() => document.getElementById("horizonOut").textContent);
  ok(out5 === "5 yr", "horizon readout tracks the slider");

  // growth/yield/reval assumptions table + sweep controls
  const gy = await page.evaluate(() => {
    const sc = document.getElementById("sweepCash"), cb = document.getElementById("cashBuffer");
    return {
      headers: document.querySelectorAll("#growthTable th").length,
      yieldInputs: Array.from(document.querySelectorAll("#growthTable input")).length,
      sweepOn: sc ? sc.checked : null,
      buffer: cb ? cb.value : null,
    };
  });
  ok(gy.headers === 12, `growth table: class + now + trailing + 3×(growth, yield, reval) = 12 headers (got ${gy.headers})`);
  // 3 scenarios × (6 growth + 5 yield + 6 reval) — cash has no yield input, it IS the cash
  ok(gy.yieldInputs === 51, `growth table carries 51 inputs (got ${gy.yieldInputs})`);
  ok(gy.sweepOn && gy.buffer === "250000", "sweep defaults: on, $250k buffer");
  const sweepPersist = await page.evaluate(() => {
    const cb = document.getElementById("sweepCash");
    if (!cb) return "missing";
    cb.checked = false;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    const v = window.REI.getAssumptions().sweep;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    return v;
  });
  ok(sweepPersist === false, "sweep toggle persists into assumptions");

  // asset table spot value, whitespace-normalised
  const mimgRow = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#assetTable tr"));
    const r = rows.find((x) => /MIMG/.test(x.textContent));
    return r ? r.textContent.replace(/\s+/g, " ") : "";
  });
  ok(/\$12,410,312/.test(mimgRow), "MIMG row shows latest $12,410,312");
  ok(/\$11,798,327/.test(mimgRow), "MIMG row shows first snapshot $11,798,327");

  ok(external.length === 0, "standalone: zero external network requests" + (external.length ? " — saw " + external[0] : ""));
  ok(errors.length === 0, "charts pass: no page errors" + (errors.length ? ": " + errors[0] : ""));
  if (WANT_SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "portfolio_desktop.png"), fullPage: true });
  }
  await page.close();
}

async function sectionUpdates(browser) {
  section("Quarterly update workflow");
  const { page, errors } = await prepPage(browser, { width: 1280, height: 900 });
  await page.goto(BASE + "/portfolio.html", { waitUntil: "networkidle0" });
  await unlockPage(page);

  // add a snapshot: prefilled values = latest, bump schwab by 100k with 100k of it new capital
  await page.evaluate(() => {
    document.getElementById("newSnapDate").value = "2026-10-12";
    document.getElementById("nsv-schwab").value = "1708801";
    document.getElementById("nsf-schwab").value = "100000";
    document.getElementById("saveSnap").click();
  });
  let s = await page.evaluate(() => ({
    msg: document.getElementById("snapMsg").textContent,
    n: window.REI.allSnapshots().length,
    total: window.REI.snapTotal(window.REI.allSnapshots()[4]),
    flows: window.REI.flowsBetween("2026-07-10", "2026-10-12"),
    hero: document.querySelector("#kpiTiles .tile.hero").textContent.replace(/\s+/g, " "),
  }));
  ok(/Saved/.test(s.msg), "save reports success");
  ok(s.n === 5, "snapshot list grows to 5");
  ok(approx(s.total, TOTALS.s4 + 100000), `new snapshot total = prior + $100k = ${(TOTALS.s4 + 100000)}`);
  ok(s.flows === 100000, "new-capital field recorded as a flow");
  ok(/\$17,132,658/.test(s.hero) && /Oct 12, 2026/.test(s.hero), "KPIs re-render from the added snapshot");

  // duplicate date is refused
  await page.evaluate(() => {
    document.getElementById("newSnapDate").value = "2026-10-12";
    document.getElementById("saveSnap").click();
  });
  s = await page.evaluate(() => ({ msg: document.getElementById("snapMsg").textContent, n: window.REI.allSnapshots().length }));
  ok(/already exists/.test(s.msg) && s.n === 5, "duplicate valuation date refused");

  // survives reload (localStorage)
  await page.reload({ waitUntil: "networkidle0" });
  s = await page.evaluate(() => ({ n: window.REI.allSnapshots().length }));
  ok(s.n === 5, "added snapshot survives reload");

  // export merges builtin + added
  await page.click("#exportBtn");
  const exp = await page.evaluate(() => document.getElementById("ioArea").value);
  let parsed = null;
  try { parsed = JSON.parse(exp); } catch (e) {}
  ok(parsed && parsed.snapshots && parsed.snapshots.length === 5, "export JSON parses and carries all 5 snapshots");
  ok(parsed && parsed.entity === "Laws Family REI LLC", "export names the entity");

  // remove the added snapshot; page returns to workbook state
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#snapList tr"));
    const r = rows.find((x) => /added on this device/.test(x.textContent));
    r.querySelector("button").click();
  });
  s = await page.evaluate(() => ({
    n: window.REI.allSnapshots().length,
    hero: document.querySelector("#kpiTiles .tile.hero").textContent.replace(/\s+/g, " "),
    flows: window.REI.flowsBetween("2026-07-10", "2026-12-31"),
  }));
  ok(s.n === 4, "remove restores the 4 workbook snapshots");
  ok(/\$17,032,658/.test(s.hero), "KPIs back to workbook values");
  ok(s.flows === 0, "the added snapshot's flow is removed with it");
  ok(errors.length === 0, "updates pass: no page errors" + (errors.length ? ": " + errors[0] : ""));
  await page.close();
}

async function sectionThemeAndFile(browser) {
  section("Dark mode + file:// standalone pass");
  const { page } = await prepPage(browser, { width: 1280, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.goto(BASE + "/portfolio.html", { waitUntil: "networkidle0" });
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(darkBg === "rgb(13, 13, 13)", `dark scheme paints its own page plane (${darkBg})`);
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(lightBg === "rgb(249, 249, 247)", `light scheme page plane (${lightBg})`);
  await page.close();

  // the deliverable is a standalone file — it must work opened straight from disk
  const { page: fp, errors: ferr } = await prepPage(browser, { width: 1280, height: 900 });
  await fp.goto("file://" + path.join(ROOT, "portfolio.html"), { waitUntil: "networkidle0" });
  await fp.type("#lockInput", PASSWORD);
  await fp.click("#lockBtn");
  await fp.waitForFunction(() => !document.getElementById("pageMain").hidden);
  const f = await fp.evaluate(() => ({
    hero: document.querySelector("#kpiTiles .tile.hero").textContent.replace(/\s+/g, " "),
    paths: document.querySelectorAll("#projChart svg path").length,
  }));
  ok(/\$17,032,658/.test(f.hero), "file://: hero AUM renders");
  ok(f.paths >= 4, "file://: projection chart renders all series");
  ok(ferr.length === 0, "file://: no page errors" + (ferr.length ? ": " + ferr[0] : ""));
  await fp.close();
}

/* ================================ run ===================================== */
(async () => {
  const srv = await serve();
  const browser = await launch();
  try {
    await sectionGate(browser);
    await sectionData(browser);
    await sectionKPIs(browser);
    await sectionEngine(browser);
    await sectionCharts(browser);
    await sectionUpdates(browser);
    await sectionThemeAndFile(browser);
  } catch (err) {
    fail++; failures.push("suite crashed: " + err.message);
    console.log("\n✗ SUITE ERROR: " + (err && err.stack || err));
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${"=".repeat(52)}`);
  console.log(`PORTFOLIO: ${pass}/${pass + fail} checks passed`);
  if (fail) { console.log("\nFailures:"); for (const f of failures) console.log("  ✗ " + f); }
  process.exit(fail ? 1 : 0);
})();
