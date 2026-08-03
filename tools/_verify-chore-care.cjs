#!/usr/bin/env node
"use strict";
/**
 * BUCKY chore-rota suite — chores follow the animal-care schedule.
 *
 *   node tools/_verify-chore-care.cjs [--shots]
 *
 * The daily chores ARE the animal chores, so they only belong to the kids on the days the
 * Kreussers are actually covering. Morning chores follow the am slot; noon AND night
 * chores both follow the pm slot. Off-duty chores are hidden, and the $2 allowance only
 * mints once the slots we DO have are finished.
 *
 * Also covers the 2026-08-03 chrome rework (half-height header, two-row bottom nav) and
 * the Fitness area being hidden for anyone outside FITNESS_USERS.
 *
 * FIREBASE IS BLOCKED THROUGHOUT (googleapis / firestore / firebase / gstatic). Not
 * optional: an unblocked headless run against index.html has twice seeded duplicates into
 * the live family herd, and this suite writes chores and allowance docs.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const WANT_SHOTS = process.argv.includes("--shots");
const PORT = 8879;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
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
async function newPage(browser, { user = "Isaac", viewport = { width:390, height:844, deviceScaleFactor:1 } } = {}){
  const ctx = browser.createBrowserContext
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  const errors = [];
  const NOISE = /Failed to load resource|dynamically imported module|gstatic|firebase|ERR_FAILED|ERR_BLOCKED/i;
  page.on("pageerror", (e) => { if (!NOISE.test(String(e))) errors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push("console: " + m.text()); });

  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (/googleapis|firestore|firebase|gstatic/i.test(u)) return r.abort();
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
  return { page, errors };
}

/** Seed the animal-care rota and a known set of daily chores, then open the app. */
async function boot(page, { care, chores } = {}){
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate((careData, choreList) => {
    if (careData) localStorage.setItem("setting_animalCare", JSON.stringify({ json: JSON.stringify(careData) }));
    // The local backend keeps EVERY chore in one array under buckyData1 (allowance docs
    // live there too, as frequency:"kidbank"). Seeding it directly leaves the rota as the
    // only variable under test — and a non-empty array also suppresses the herd seed.
    if (choreList) localStorage.setItem("buckyData1", JSON.stringify(choreList));
  }, care || null, chores || null);
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__NAV__ && window.__CARE__, { timeout: 20000 });
  await sleep(900);
}

/** A rota where every slot on every weekday belongs to `group`, optionally overridden. */
function rota(group, overrides){
  const defaults = {};
  for (const d of ["sun","mon","tue","wed","thu","fri","sat"]) defaults[d] = { am: group, pm: group };
  return { defaults, overrides: overrides || {} };
}
function todayKeyLocal(){
  const d = new Date();
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
/** A chore is done when donePeriod matches today's period key and doneLog fills its target. */
function doneFields(){
  return { donePeriod: todayKeyLocal(), doneLog: [{ at: Date.now(), by: "Isaac" }] };
}

/* ===================== A. the rota decides the chore list ================= */
async function sectionRota(browser){
  section("A. Daily chores follow the animal-care rota");

  const daily = [
    { id:"d1", name:"Feed the goats",      frequency:"daily", timeOfDay:"morning", target:1, order:1, lastPeriod:"", lastBy:"", lastAt:0, log:[] },
    { id:"d2", name:"Collect eggs",        frequency:"daily", timeOfDay:"noon",    target:1, order:2, lastPeriod:"", lastBy:"", lastAt:0, log:[] },
    { id:"d3", name:"Refill water",        frequency:"daily", timeOfDay:"night",   target:1, order:3, lastPeriod:"", lastBy:"", lastAt:0, log:[] },
    { id:"w1", name:"Muck out the barn",   frequency:"weekly",                     target:1, order:4, lastPeriod:"", lastBy:"", lastAt:0, log:[] },
  ];

  /* -- all ours -- */
  {
    const { page, errors } = await newPage(browser);
    await boot(page, { care: rota("Kreussers"), chores: daily });
    await page.evaluate(() => window.__NAV__.goTo("chores"));
    await sleep(400);
    const seen = await page.evaluate(() => [...document.querySelectorAll("#list li")].map(li => li.textContent));
    ok(seen.some(t => /Feed the goats/.test(t)), "on a full Kreusser day the morning chore shows");
    ok(seen.some(t => /Collect eggs/.test(t)), "…the noon chore shows");
    ok(seen.some(t => /Refill water/.test(t)), "…and the night chore shows");
    ok(await page.evaluate(() => document.querySelectorAll(".care-off").length === 0), "…with no 'someone else has it' note");
    ok(errors.length === 0, "no page errors (full day)" + (errors.length ? ": " + errors[0] : ""));
  }

  /* -- Joy has the night -- */
  {
    const { page, errors } = await newPage(browser);
    const care = rota("Kreussers", { [todayKeyLocal()]: { pm: "Joy" } });
    await boot(page, { care, chores: daily });
    await page.evaluate(() => window.__NAV__.goTo("chores"));
    await sleep(400);
    const seen = await page.evaluate(() => [...document.querySelectorAll("#list li")].map(li => li.textContent).join("|"));
    ok(/Feed the goats/.test(seen), "with Joy on nights the MORNING chore still shows");
    ok(!/Collect eggs/.test(seen), "…the noon chore is hidden (noon follows the pm slot)");
    ok(!/Refill water/.test(seen), "…and the night chore is hidden");
    ok(/Muck out the barn/.test(seen), "…while the weekly chore is unaffected by the rota");
    const note = await page.evaluate(() => {
      const el = document.querySelector('.care-off[data-slot="pm"]');
      return el ? el.textContent : "";
    });
    ok(/Joy/.test(note) && /tonight/i.test(note), "…and a quiet line says Joy has the animals tonight");
    ok(await page.evaluate(() => !document.querySelector('.care-off[data-slot="am"]')), "…with no note for the slot that IS ours");

    // The Home ring must count the same set, or it disagrees with the list.
    await page.evaluate(() => window.__NAV__.goTo("dashboard"));
    await sleep(400);
    const ring = await page.evaluate(() => {
      const v = document.querySelector(".home2 .ring .val");
      return v ? v.textContent.replace(/\s+/g, "") : "";
    });
    // Ours today = the morning daily + the weekly (the Home ring counts every frequency,
    // not just dailies — pre-existing behaviour). The two pm dailies must NOT be in it.
    ok(/\/2$/.test(ring), `the Home ring counts only the chores that are ours (${ring})`);
    ok(errors.length === 0, "no page errors (partial day)" + (errors.length ? ": " + errors[0] : ""));
  }

  /* -- Grandparents have the whole day -- */
  {
    const { page, errors } = await newPage(browser);
    await boot(page, { care: rota("Grandparents"), chores: daily });
    await page.evaluate(() => window.__NAV__.goTo("chores"));
    await sleep(400);
    const seen = await page.evaluate(() => [...document.querySelectorAll("#list li")].map(li => li.textContent).join("|"));
    ok(!/Feed the goats|Collect eggs|Refill water/.test(seen), "on a full Grandparents day no daily chore shows");
    ok(await page.evaluate(() => document.querySelectorAll(".care-off").length === 2), "…and both slots are explained");
    ok(/Muck out the barn/.test(seen), "…but the weekly chore is still ours");
    if (WANT_SHOTS){ fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, "chores_offduty.png") }); }
    ok(errors.length === 0, "no page errors (off day)" + (errors.length ? ": " + errors[0] : ""));
  }
}

/* ======================= B. the allowance follows too ===================== */
async function sectionAllowance(browser){
  section("B. The $2 only lands on days we actually covered");

  const mk = (done) => ([
    { id:"d1", name:"Feed the goats", frequency:"daily", timeOfDay:"morning", target:1, order:1,
      lastPeriod:"", lastBy:"", lastAt:0, ...(done ? doneFields() : {}) },
    { id:"d3", name:"Refill water",   frequency:"daily", timeOfDay:"night",   target:1, order:2,
      lastPeriod:"", lastBy:"", lastAt:0, ...(done ? doneFields() : {}) },
  ]);

  // Allowance docs are rows in the same buckyData1 array, id allowance_<kid>_<day>.
  const allowanceCount = (page) => page.evaluate(() => {
    try {
      return (JSON.parse(localStorage.getItem("buckyData1")) || [])
        .filter(c => c && c.kind === "allowance").length;
    } catch { return -1; }
  });

  /* -- our day, chores unfinished -> nothing -- */
  {
    const { page } = await newPage(browser);
    await boot(page, { care: rota("Kreussers"), chores: mk(false) });
    await sleep(700);
    ok(await allowanceCount(page) === 0, "unfinished chores on our own day pay nothing");
  }

  /* -- our day, all done -> pays -- */
  {
    const { page } = await newPage(browser);
    // rota("Kreussers") is byte-identical to the SHIPPED DEFAULT, which is what makes this
    // the important case: the repaint used to be gated on the rota having *changed*, so the
    // most ordinary family — everything covered by them, nothing overridden — silently
    // never minted. No forced mint here; this has to happen on its own.
    await boot(page, { care: rota("Kreussers"), chores: mk(true) });
    await sleep(1200);
    const n = await allowanceCount(page);
    const why = n > 0 ? "" : " — " + JSON.stringify(await page.evaluate(() => ({
      careLoaded: window.__CHORES__.careLoaded(),
      allDone: window.__CHORES__.allDone(),
      mine: window.__CHORES__.mine(),
    })));
    ok(n > 0, "a finished day on the DEFAULT rota pays out without any prompting" + why);
  }

  /* -- someone else's day entirely -> never pays, however 'done' it looks -- */
  {
    const { page } = await newPage(browser);
    await boot(page, { care: rota("Joy"), chores: mk(true) });
    await sleep(900);
    ok(await allowanceCount(page) === 0, "a day with no Kreusser slot pays nothing at all");
  }

  /* -- partial day: we have the morning only, and its chore is done -> pays -- */
  {
    const { page } = await newPage(browser);
    const care = rota("Kreussers", { [todayKeyLocal()]: { pm: "Grandparents" } });
    const chores = [
      { id:"d1", name:"Feed the goats", frequency:"daily", timeOfDay:"morning", target:1, order:1,
        lastPeriod:"", lastBy:"", lastAt:0, ...doneFields() },
      // Deliberately NOT done — but it is the Grandparents' slot, so it must not block us.
      { id:"d3", name:"Refill water",   frequency:"daily", timeOfDay:"night",   target:1, order:2,
        lastPeriod:"", lastBy:"", lastAt:0 },
    ];
    await boot(page, { care, chores });
    await sleep(900);
    ok(await allowanceCount(page) > 0, "finishing OUR slot pays even when someone else has the other");
  }
}

/* ========================= C. chrome + gating ============================= */
async function sectionChrome(browser){
  section("C. Half-height header, two-row nav, Fitness gated");

  const { page, errors } = await newPage(browser, { user: "Isaac" });
  await boot(page, { care: rota("Kreussers") });

  const geo = await page.evaluate(() => {
    const h = document.querySelector("header").getBoundingClientRect();
    const n = document.getElementById("bnav").getBoundingClientRect();
    const btns = [...document.querySelectorAll("#bnav .bnav-btn")];
    const rows = new Set(btns.map(b => Math.round(b.getBoundingClientRect().top)));
    return {
      header: Math.round(h.height), nav: Math.round(n.height), rows: rows.size,
      count: btns.length, minW: Math.min(...btns.map(b => Math.round(b.getBoundingClientRect().width))),
      logo: !!document.querySelector("header .logo"),
      clipped: btns.filter(b => { const l = b.querySelector(".blabel"); return l && l.scrollWidth > l.clientWidth + 1; }).length,
      title: (document.querySelector("header h1") || {}).textContent || "",
      subtitle: (document.querySelector("header .subtitle") || {}).textContent || "",
    };
  });
  ok(!geo.logo, "the goat logo is gone from the header");
  ok(geo.title === "Bucky" && /Family Farm Hub/.test(geo.subtitle), "…but the name and subtitle survive");
  ok(geo.header <= 60, `the header is about half its old height (${geo.header}px, was 90px)`);
  ok(geo.rows === 2, `the bottom nav is two rows (${geo.rows})`);
  ok(geo.minW >= 60, `nav buttons are no longer cramped (${geo.minW}px, was 38px)`);
  ok(geo.clipped === 0, "no nav label is clipped");
  ok(geo.header + geo.nav <= 152, `total chrome is unchanged (${geo.header + geo.nav}px, was 149px)`);

  // The FAB and the last of the page must clear a taller nav.
  await page.evaluate(() => window.__NAV__.goTo("chores"));
  await sleep(400);
  const clears = await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    const nav = document.getElementById("bnav").getBoundingClientRect();
    const items = [...document.querySelectorAll("#list li")];
    const last = items[items.length - 1];
    return !last || last.getBoundingClientRect().bottom <= nav.top + 1;
  });
  ok(clears, "the page's last row is not hidden behind the taller nav");

  ok(await page.evaluate(() => [...document.querySelectorAll("#bnav .bnav-btn")].some(b => b.dataset.gid === "fit")),
    "Isaac sees the Fitness area");

  if (WANT_SHOTS){ fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, "chrome_2row.png") }); }

  /* -- who does NOT see Fitness -- */
  for (const [who, shouldSee] of [["Eleanor", true], ["Dad", true], ["Mom", false], ["Grandma", false]]){
    const { page: p } = await newPage(browser, { user: who });
    await boot(p, { care: rota("Kreussers") });
    const has = await p.evaluate(() => [...document.querySelectorAll("#bnav .bnav-btn")].some(b => b.dataset.gid === "fit"));
    ok(has === shouldSee, `${who} ${shouldSee ? "sees" : "does not see"} the Fitness area`);
    if (!shouldSee){
      const bounced = await p.evaluate(() => { window.__NAV__.goTo("fitness"); return window.__NAV__.tab(); });
      ok(bounced !== "fitness", `…and a stale #fitness deep-link bounces ${who} to Home`);
      const rows = await p.evaluate(() => new Set([...document.querySelectorAll("#bnav .bnav-btn")].map(b => Math.round(b.getBoundingClientRect().top))).size);
      ok(rows === 2, `…and the nav still balances into two rows for ${who}`);
    }
  }

  // Desktop keeps ONE row — the two-row layout solves a phone problem.
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await sleep(400);
  const deskRows = await page.evaluate(() => new Set([...document.querySelectorAll("#bnav .bnav-btn")].map(b => Math.round(b.getBoundingClientRect().top))).size);
  ok(deskRows === 1, `desktop keeps a single nav row (${deskRows})`);

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ================================ run ===================================== */
(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  try {
    await sectionRota(browser);
    await sectionAllowance(browser);
    await sectionChrome(browser);
  } catch (err) {
    fail++; failures.push("suite crashed: " + err.message);
    console.log("\n✗ SUITE ERROR: " + (err && err.stack || err));
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(`\n${"=".repeat(52)}`);
  console.log(`CHORE-CARE: ${pass}/${pass + fail} checks passed`);
  if (fail){ console.log("\nFailures:"); for (const f of failures) console.log("  ✗ " + f); }
  process.exit(fail ? 1 : 0);
})();
