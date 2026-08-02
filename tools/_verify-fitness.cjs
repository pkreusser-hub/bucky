#!/usr/bin/env node
"use strict";
/**
 * BUCKY Fitness suite — the daily 10-minute workout.
 *
 *   node tools/_verify-fitness.cjs [--shots]
 *
 * Section A is pure Node: the baked library and the default week have to be internally
 * consistent before any browser opens.
 * Sections B/C drive the real page in Chrome at 390x844 and at desktop.
 *
 * FIREBASE IS BLOCKED THROUGHOUT (googleapis / firestore / firebase / gstatic). This is
 * not optional hygiene: an unblocked headless run against index.html has twice seeded
 * duplicates into the live family herd, and this suite deliberately exercises first-run
 * paths. Blocking forces the local (localStorage) backend, which is what we want anyway.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const FIT = path.join(ROOT, "assets", "fitness");
const SHOTS = path.join(ROOT, "shots");
const WANT_SHOTS = process.argv.includes("--shots");
const PORT = 8871;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");

/* Mirrors of the app's own constants — deliberately re-implemented here so the suite
   checks the DATA independently instead of asking the app to grade its own homework. */
const REP_SECS = 3, MIN_REP_SECS = 20, BLOCK_CARD_S = 5, BAND = [540, 660];
const EXCLUDED = [
  "Band_Good_Morning", "Band_Good_Morning_Pull_Through", "Dumbbell_Clean",
  "Hyperextensions_With_No_Hyperextension_Bench", "Isometric_Neck_Exercise_-_Front_And_Back",
  "Isometric_Neck_Exercise_-_Sides", "Side_Neck_Stretch", "Chin_To_Chest_Stretch",
  "Stiff-Legged_Dumbbell_Deadlift",
];

const MIME = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".json":"application/json", ".css":"text/css", ".webp":"image/webp", ".png":"image/png",
  ".jpg":"image/jpeg", ".svg":"image/svg+xml", ".txt":"text/plain", ".webmanifest":"application/manifest+json" };

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

/** A page with Firebase blocked, the family lock pre-opened, and prompt() scriptable.
 *
 *  Each page gets its OWN browser context. Pages in a shared context share localStorage
 *  for the origin, so without this a "fresh" page inherits the previous section's saved
 *  plan and completion log — one section marks Monday done and the next can't find its
 *  own Start button. (Same trap the meal-plan suite documented.) */
async function newPage(browser, { user = "Isaac", viewport = { width:390, height:844, deviceScaleFactor:1 }, prompts = [] } = {}){
  const ctx = browser.createBrowserContext
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  const errors = [];
  // The blocked Firebase CDN import is this suite's OWN doing (see the header note) and
  // surfaces as a console error on every offline run — it is expected, not a page fault.
  const EXPECTED_NOISE = /Failed to load resource|dynamically imported module|gstatic|firebase/i;
  page.on("pageerror", (e) => { if (!EXPECTED_NOISE.test(String(e))) errors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error" && !EXPECTED_NOISE.test(m.text())) errors.push("console: " + m.text()); });

  await page.setRequestInterception(true);
  page.on("request", (r) => {
    if (/googleapis|firestore|firebase|gstatic/i.test(r.url())) return r.abort();
    r.continue();
  });

  await page.evaluateOnNewDocument((u, pr) => {
    localStorage.setItem("choreUnlocked", "amenfarms");
    if (u) localStorage.setItem("choreUser", u); else localStorage.removeItem("choreUser");
    window.__PROMPTS__ = pr.slice();
    window.__PROMPTED__ = [];
    window.prompt = (msg) => { window.__PROMPTED__.push(msg); return window.__PROMPTS__.length ? window.__PROMPTS__.shift() : null; };
    window.alert = (msg) => { (window.__ALERTS__ = window.__ALERTS__ || []).push(msg); };
    window.confirm = () => true;
  }, user, prompts);

  return { page, errors };
}

async function gotoApp(page, hash = ""){
  await page.goto(BASE + "/index.html" + (hash ? "#" + hash : "") + "?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__FIT__ && window.__NAV__, { timeout: 20000 });
  await page.evaluate(() => window.__FIT__.ensure());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pin the app clock to the next day that actually HAS a workout.
    Without this, a suite run on a Sunday tests the rest day and reads as broken. */
async function pinWorkoutDay(page){
  return page.evaluate(async () => {
    await window.__FIT__.ensure();
    const add = (k, n) => { const d = new Date(Date.parse(k + "T12:00:00Z")); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    let k = window.__FIT__.today();
    for (let i = 0; i < 8; i++){
      const d = window.__FIT__.dayOf(k);
      if (d && !d.rest) break;
      k = add(k, 1);
    }
    window.__FIT__.setNow(Date.parse(k + "T12:00:00Z"));
    return k;
  });
}

/* ============================== A. LIBRARY (pure Node) ====================== */
function sectionLibrary(){
  section("A. Library integrity (no browser)");

  const libPath = path.join(FIT, "exercises.json");
  const planPath = path.join(FIT, "default-plan.json");
  ok(fs.existsSync(libPath), "exercises.json exists");
  ok(fs.existsSync(planPath), "default-plan.json exists");
  ok(fs.existsSync(path.join(FIT, "LICENSE.txt")), "LICENSE.txt exists");
  if (!fs.existsSync(libPath) || !fs.existsSync(planPath)) return null;

  const lib = JSON.parse(fs.readFileSync(libPath, "utf8"));
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const license = fs.readFileSync(path.join(FIT, "LICENSE.txt"), "utf8");

  ok(/unlicense/i.test(license) && /free-exercise-db/.test(license), "LICENSE.txt records the Unlicense + upstream project");
  ok(Array.isArray(lib.exercises) && lib.exercises.length > 200, `library has a real catalogue (${lib.exercises.length} exercises)`);
  ok(Array.isArray(lib.groups) && lib.groups.length >= 7, `library declares muscle groups (${(lib.groups||[]).length})`);

  const byId = new Map(lib.exercises.map((x) => [x.id, x]));
  ok(byId.size === lib.exercises.length, "no duplicate exercise ids");

  const groupIds = new Set(lib.groups.map((g) => g.id));
  ok(lib.exercises.every((x) => groupIds.has(x.group)), "every exercise maps to a declared group");
  ok(lib.exercises.every((x) => x.name && Array.isArray(x.steps)), "every exercise has a name and instructions");

  const shippedExcluded = EXCLUDED.filter((id) => byId.has(id));
  ok(shippedExcluded.length === 0, "no excluded (unsafe-for-kids) exercise shipped" + (shippedExcluded.length ? ": " + shippedExcluded.join(", ") : ""));

  const badEquip = lib.exercises.filter((x) => !["none","body only","dumbbell","bands"].includes(x.equipment));
  ok(badEquip.length === 0, "every exercise is within the equipment we own" + (badEquip.length ? ` (${badEquip.length} bad)` : ""));
  ok(lib.exercises.every((x) => x.level !== "expert"), "no expert-level exercises shipped");

  // Images for the whole library, not just the plan — the picker shows all of them.
  let missingImg = 0, emptyImg = 0;
  for (const x of lib.exercises){
    for (const f of [0, 1]){
      const p = path.join(FIT, "img", x.id, `${f}.webp`);
      if (!fs.existsSync(p)) missingImg++;
      else if (fs.statSync(p).size < 200) emptyImg++;
    }
  }
  ok(missingImg === 0, `both animation frames exist for all ${lib.exercises.length} exercises` + (missingImg ? ` (${missingImg} missing)` : ""));
  ok(emptyImg === 0, "no truncated/empty image files" + (emptyImg ? ` (${emptyImg} bad)` : ""));

  // ---- default plan
  const days = ["mon","tue","wed","thu","fri","sat","sun"];
  ok(days.every((d) => plan.days && plan.days[d]), "default plan covers all 7 weekdays");
  ok(typeof plan.rest === "number" && plan.rest > 0, "default plan declares a rest interval");

  const itemSecs = (it) => it.mode === "time" ? it.secs : Math.max(MIN_REP_SECS, it.reps * REP_SECS);
  let planMissing = [], outOfBand = [], workDays = 0;
  for (const d of days){
    const day = plan.days[d];
    if (!day || day.rest) continue;
    workDays++;
    let n = 0, work = 0;
    for (const b of day.blocks){
      ok_groupKnown(b, groupIds, d);
      for (const it of b.items){
        n++; work += itemSecs(it);
        if (!byId.has(it.id)) planMissing.push(`${d}:${it.id}`);
        const valid = (it.mode === "time" && it.secs > 0) || (it.mode === "reps" && it.reps > 0);
        if (!valid) planMissing.push(`${d}:${it.id} (bad amount)`);
      }
    }
    const total = work + plan.rest * (n - 1) + day.blocks.length * BLOCK_CARD_S;
    if (total < BAND[0] || total > BAND[1]) outOfBand.push(`${d}=${Math.floor(total/60)}:${String(total%60).padStart(2,"0")}`);
  }
  ok(workDays >= 5, `default plan has a real week of workouts (${workDays} work days)`);
  ok(planMissing.length === 0, "every default-plan exercise exists in the library" + (planMissing.length ? ": " + planMissing.slice(0,5).join(", ") : ""));
  ok(outOfBand.length === 0, "every default workout lands in the 9:00–11:00 band" + (outOfBand.length ? ": " + outOfBand.join(", ") : ""));

  return { lib, plan, byId };
}
let groupWarned = false;
function ok_groupKnown(b, groupIds, d){
  if (groupIds.has(b.group) || groupWarned) return;
  groupWarned = true;
  ok(false, `default plan block on ${d} uses unknown group "${b.group}"`);
}

/* ================================ B. THE APP =============================== */
async function sectionApp(browser){
  section("B. Section, nav and Home card (390x844, Isaac)");
  const { page, errors } = await newPage(browser, { user: "Isaac" });
  await gotoApp(page);

  // ---- nav
  const nav = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#bnav .bnav-btn")];
    return {
      count: btns.length,
      ids: btns.map((b) => b.dataset.gid),
      clipped: btns.filter((b) => { const l = b.querySelector(".blabel"); return l && l.scrollWidth > l.clientWidth + 1; }).map((b) => b.dataset.gid),
      widths: btns.map((b) => Math.round(b.getBoundingClientRect().width)),
    };
  });
  ok(nav.ids.includes("fit"), "a 💪 Fit area is in the bottom nav");
  ok(nav.count === 9, `nav shows 9 areas (got ${nav.count})`);
  ok(nav.clipped.length === 0, "0 clipped nav labels at 390px" + (nav.clipped.length ? ": " + nav.clipped.join(",") : ""));
  ok(Math.min(...nav.widths) >= 34, `nav buttons stay tappable (min ${Math.min(...nav.widths)}px)`);

  // ---- section renders
  await page.evaluate(() => window.__NAV__.goTo("fitness"));
  await page.waitForFunction(() => document.querySelector(".fitwrap .fitcard2"), { timeout: 10000 });
  const today = await page.evaluate(() => {
    const d = window.__FIT__.dayOf();
    return {
      tab: window.__NAV__.tab(),
      pills: [...document.querySelectorAll(".fitpills button")].map((b) => b.textContent),
      title: (document.querySelector(".fithead h3") || {}).textContent,
      chips: [...document.querySelectorAll(".fitchips .fitchip")].map((c) => c.textContent.trim()),
      rows: document.querySelectorAll(".fitwrap .fitrow").length,
      hasStart: !!document.getElementById("fitStartBtn"),
      thumbs: [...document.querySelectorAll(".fitwrap .fitthumb")].map((i) => i.getAttribute("src")),
      secs: window.__FIT__.duration(),
      items: window.__FIT__.items().length,
      isRest: !!(d && d.rest),
    };
  });
  ok(today.tab === "fitness", "the Fitness tab is active");
  ok(today.pills.join("|") === "Today|Week|Progress", "Today / Week / Progress pages exist");
  if (!today.isRest){
    ok(today.hasStart, "a Start workout button is shown");
    ok(today.rows === today.items, `the day's exercises are all listed (${today.rows})`);
    ok(today.chips.length >= 2, `muscle-group blocks are labelled (${today.chips.join(" ")})`);
    ok(today.secs >= 540 && today.secs <= 660, `today is a ~10-minute workout (${today.secs}s)`);
    ok(today.thumbs.every((s) => /assets\/fitness\/img\/.+\/0\.webp$/.test(s)), "every row shows its exercise's own frame");
  } else {
    ok(!today.hasStart, "a rest day offers no Start button");
  }

  // images really resolve (a 404 thumb would be invisible in a DOM-only check)
  const imgOk = await page.evaluate(async () => {
    const src = document.querySelector(".fitwrap .fitthumb");
    if (!src) return true;
    const r = await fetch(src.getAttribute("src"));
    return r.ok && Number(r.headers.get("content-length") || 1) > 200;
  });
  ok(imgOk, "exercise images are served (not 404)");

  // ---- Home card
  await page.evaluate(() => window.__NAV__.goTo("dashboard"));
  await page.waitForFunction(() => document.querySelector(".home2 .fitcard"), { timeout: 10000 });
  const card = await page.evaluate(() => {
    const c = document.querySelector(".home2 .fitcard");
    return { tag: c.tagName, aria: c.getAttribute("aria-label"),
             title: (c.querySelector(".fitc-title")||{}).textContent,
             sub: (c.querySelector(".fitc-sub")||{}).textContent,
             go: (c.querySelector(".fitc-go")||{}).textContent };
  });
  ok(card.tag === "BUTTON" && !!card.aria, "the Home card is a real button with an aria-label");
  ok(/workout|Full Body|Core|Legs|Upper|Play|Rest/i.test(card.title || ""), `Home card names today's workout ("${card.title}")`);
  ok(today.isRest ? true : /START|RESUME|Done/.test(card.go || ""), "Home card offers a call to action");

  const goesTo = await page.evaluate(() => { document.querySelector(".home2 .fitcard").click(); return window.__NAV__.tab(); });
  ok(goesTo === "fitness", "tapping the Home card opens Fitness");

  // ---- non-kid profile gets no card. Needs its OWN page: the harness re-seeds
  // choreUser on every navigation, so switching it in-page then reloading won't stick.
  {
    const { page: g } = await newPage(browser, { user: "Grandma" });
    await gotoApp(g);
    const grandma = await g.evaluate(() => ({
      card: !!document.querySelector(".home2 .fitcard"),
      navHasFit: [...document.querySelectorAll("#bnav .bnav-btn")].some((b) => b.dataset.gid === "fit"),
    }));
    ok(!grandma.card, "a non-kid profile gets no Home workout card");
    ok(grandma.navHasFit, "…but the Fitness tab is still reachable for parents/guests");
    await g.close();
  }

  if (WANT_SHOTS){
    // Pin to a workout day so the review shots show the state that matters (START),
    // not whatever rest day the calendar happens to be on when the suite runs.
    await pinWorkoutDay(page);
    await page.evaluate(() => window.__NAV__.goTo("dashboard"));
    await sleep(400);
    await page.screenshot({ path: path.join(SHOTS, "fit_home_card.png") });
    await page.evaluate(() => window.__NAV__.goTo("fitness"));
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, "fit_today.png") });
    await page.evaluate(() => { window.__FIT__.setNow(Date.now()); document.querySelector('.fitpills button[data-page="week"]').click(); });
    await sleep(250);
    await page.screenshot({ path: path.join(SHOTS, "fit_week.png") });
    await page.evaluate(() => document.querySelector('.fitpills button[data-page="progress"]').click());
    await sleep(250);
    await page.screenshot({ path: path.join(SHOTS, "fit_progress.png") });
    await page.evaluate(() => document.querySelector('.fitpills button[data-page="today"]').click());
  }

  ok(errors.length === 0, "0 JS page errors" + (errors.length ? ": " + errors.slice(0,3).join(" | ") : ""));
  await page.close();
}

/* ================================ C. THE PLAYER ============================ */
async function sectionPlayer(browser){
  section("C. The workout player");
  const { page, errors } = await newPage(browser, { user: "Isaac" });
  await gotoApp(page);

  const mondayKey = await pinWorkoutDay(page);
  ok(!!mondayKey, `clock pinned to a workout day (${mondayKey})`);

  await page.evaluate(() => window.__NAV__.goTo("fitness"));
  await page.waitForFunction(() => document.getElementById("fitStartBtn"), { timeout: 10000 });

  // ---- start via a real tap
  await page.click("#fitStartBtn");
  await page.waitForFunction(() => document.getElementById("fitPlayOverlay").classList.contains("open"), { timeout: 5000 });
  const opened = await page.evaluate(() => {
    const r = window.__FIT__.run();
    return { phase: r.phase, steps: window.__FIT__.steps(), total: r.total,
             fullscreen: getComputedStyle(document.getElementById("fitPlayOverlay")).alignItems };
  });
  ok(opened.phase === "block", "the workout opens on a muscle-group block card");
  ok(opened.steps[opened.steps.length - 1] === "finish", "the step list ends with a finish screen");
  ok(opened.steps.filter((s) => s === "rest").length === opened.total - 1, "there is a rest between every pair of exercises (and not after the last)");
  ok(opened.fullscreen === "stretch", "the player is full-screen, not a bottom sheet");

  // ---- block card auto-advances on its own timer
  await page.evaluate(() => { window.__FIT__.warp(9999); window.__FIT__.tick(); });
  let st = await page.evaluate(() => window.__FIT__.run());
  ok(st.phase === "ex", "the block card advances to the first exercise");

  // ---- exercise screen contents
  const exUI = await page.evaluate(() => {
    const anim = document.querySelector("#fitPlayInner .fitp-anim");
    return {
      name: (document.querySelector(".fitp-name")||{}).textContent,
      amt: (document.querySelector(".fitp-amt")||{}).textContent,
      sub: (document.querySelector(".fitp-amtsub")||{}).textContent,
      block: (document.querySelector(".fitp-block")||{}).textContent,
      prog: (document.querySelector(".fitp-progtext")||{}).textContent,
      frames: anim ? [...anim.querySelectorAll("img")].map((i) => i.getAttribute("src")) : [],
      hasSteps: !!document.querySelector(".fitp-steps"),
      hasDone: !!document.getElementById("fitDoneBtn"),
      hasSkip: !!document.getElementById("fitSkipBtn"),
    };
  });
  ok(!!exUI.name, `the exercise is named ("${exUI.name}")`);
  ok(/^\d+$/.test(exUI.amt || "") && /seconds|reps/.test(exUI.sub || ""), `an amount to do is shown (${exUI.amt} ${exUI.sub})`);
  ok(/1 of \d+/.test(exUI.prog || ""), `progress reads "${exUI.prog}"`);
  ok(exUI.frames.length === 2 && /\/0\.webp$/.test(exUI.frames[0]) && /\/1\.webp$/.test(exUI.frames[1]),
     "both animation frames are mounted (start + end position)");
  ok(exUI.hasSteps, "the how-to instructions are available");
  ok(exUI.hasDone && exUI.hasSkip, "Done and Skip are both offered");

  // ---- the 2-frame cross-fade actually animates
  const flips = await page.evaluate(async () => {
    const a = document.querySelector("#fitPlayInner .fitp-anim");
    const seen = new Set();
    for (let i = 0; i < 14; i++){ seen.add(a.classList.contains("flip")); await new Promise(r => setTimeout(r, 200)); }
    return [...seen];
  });
  ok(flips.length === 2, "the animation cross-fades between the two frames");

  // ---- pause on hide, never fast-forward
  const beforeHide = await page.evaluate(() => window.__FIT__.run().i);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hidden = await page.evaluate(() => { window.__FIT__.warp(600000); window.__FIT__.tick(); return window.__FIT__.run(); });
  ok(hidden.paused === true, "backgrounding the tab pauses the workout");
  ok(hidden.i === beforeHide, "a backgrounded tab never auto-completes exercises nobody did");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    window.__FIT__.pause();      // resume
  });
  st = await page.evaluate(() => window.__FIT__.run());
  ok(st.paused === false, "it resumes where it left off");

  // ---- walk the whole workout to the finish screen
  const walked = await page.evaluate(async () => {
    let guard = 0;
    while (guard++ < 400){
      const r = window.__FIT__.run();
      if (!r || r.finished) break;
      if (r.phase === "ex" && r.step.it.mode === "reps"){
        const b = document.getElementById("fitDoneBtn"); if (b) b.click(); else window.__FIT__.advance("done");
      } else {
        window.__FIT__.warp(999999); window.__FIT__.tick();
      }
      await new Promise(res => setTimeout(res, 5));
    }
    const r = window.__FIT__.run();
    return { done: r ? r.done.length : -1, skipped: r ? r.skipped.length : -1, total: r ? r.total : -1, finished: r ? r.finished : false, guard };
  });
  ok(walked.finished, "the workout reaches its finish screen");
  ok(walked.done === walked.total, `every exercise was completed (${walked.done}/${walked.total})`);
  ok(walked.skipped === 0, "nothing was skipped in a clean run");

  const finishUI = await page.evaluate(() => ({
    body: !!document.getElementById("fitFinishBody"),
    stats: [...document.querySelectorAll(".fitp-finish-stats .v")].map((v) => v.textContent),
    labels: [...document.querySelectorAll(".fitp-finish-stats .l")].map((v) => v.textContent),
  }));
  ok(finishUI.body, "a finish screen is shown");
  ok(finishUI.labels.join("|") === "exercises|minutes|day streak", "the finish screen reports exercises, time and streak");

  if (WANT_SHOTS) await page.screenshot({ path: path.join(SHOTS, "fit_finish.png") });

  // ---- the completion is recorded and survives a reload
  await page.evaluate(async () => { document.getElementById("fitFinishBtn").click(); await window.__FIT__.saveNow("Isaac"); });
  const rec = await page.evaluate(() => window.__FIT__.record("Isaac"));
  ok(rec && rec.finished === true, "the workout is written to the log as finished");
  ok(rec && rec.secs >= 0 && Array.isArray(rec.done) && rec.done.length > 0, "the record keeps what was done and how long it took");

  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("setting_fitLog_")));
  ok(stored.length > 0 && stored.some((k) => k.includes("Isaac")), `it persists to a per-kid month shard (${stored[0] || "none"})`);

  await gotoApp(page);
  const afterReload = await page.evaluate(async (key) => {
    window.__FIT__.setNow(Date.parse(key + "T12:00:00Z"));
    await window.__FIT__.ensure();
    window.__NAV__.goTo("fitness");
    await new Promise(r => setTimeout(r, 300));
    return { complete: window.__FIT__.complete("Isaac", key),
             banner: !!document.querySelector(".fitdone-banner"),
             noStart: !document.getElementById("fitStartBtn") };
  }, mondayKey);
  ok(afterReload.complete, "after a reload the day still reads as done");
  ok(afterReload.banner && afterReload.noStart, "…and the section shows the done banner instead of Start");

  ok(errors.length === 0, "0 JS page errors" + (errors.length ? ": " + errors.slice(0,3).join(" | ") : ""));
  await page.close();
}

/* =========================== D. QUIT, STREAK =============================== */
async function sectionStreak(browser){
  section("D. Quitting part-way, and the streak");
  const { page, errors } = await newPage(browser, { user: "Eleanor" });
  await gotoApp(page);

  const key = await pinWorkoutDay(page);

  // ---- quit after two exercises: progress kept, day NOT marked done
  await page.evaluate(() => window.__NAV__.goTo("fitness"));
  await page.waitForFunction(() => document.getElementById("fitStartBtn"), { timeout: 10000 });
  await page.click("#fitStartBtn");
  await page.evaluate(async () => {
    let did = 0, guard = 0;
    while (did < 2 && guard++ < 60){
      const r = window.__FIT__.run();
      if (!r) break;
      if (r.phase === "ex"){ window.__FIT__.advance("done"); did++; }
      else { window.__FIT__.warp(999999); window.__FIT__.tick(); }
      await new Promise(res => setTimeout(res, 5));
    }
  });
  await page.evaluate(async () => { document.getElementById("fitQuitBtn").click(); await new Promise(r => setTimeout(r, 60)); await window.__FIT__.saveNow("Eleanor"); });
  const partial = await page.evaluate((k) => ({ rec: window.__FIT__.record("Eleanor", k), complete: window.__FIT__.complete("Eleanor", k),
                                                open: document.getElementById("fitPlayOverlay").classList.contains("open") }), key);
  ok(!partial.open, "quitting closes the player");
  ok(partial.rec && partial.rec.done.length === 2, "the two finished exercises are kept");
  ok(partial.complete === false, "a part-way quit does not count as a completed day");
  const resumeLabel = await page.evaluate(() => (document.getElementById("fitStartBtn")||{}).textContent);
  ok(/Keep going/.test(resumeLabel || ""), `the button invites them back ("${(resumeLabel||"").trim()}")`);

  /* Streak counts WORKOUT days; rest days are stepped over, neither counted nor
     treated as a break. So the fixture seeds the last four days that actually have a
     workout on them — seeding four CALENDAR days would span Sunday and correctly
     yield 3, which reads as a bug and isn't one. */
  const seeded = await page.evaluate(async () => {
    const add = (k, n) => { const d = new Date(Date.parse(k + "T12:00:00Z")); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); };
    const t = window.__FIT__.today();
    const keys = [];
    for (let i = 0; keys.length < 4 && i < 30; i++){
      const k = add(t, -i);
      const d = window.__FIT__.dayOf(k);
      if (d && !d.rest) keys.push(k);
    }
    for (const k of keys) await window.__FIT__.seedLog("Eleanor", k);
    return { keys, streak: window.__FIT__.streak("Eleanor"), spanned: (Date.parse(keys[0]) - Date.parse(keys[3])) / 86400000 };
  });
  ok(seeded.streak === 4, `four straight workout days read as a 4-day streak (got ${seeded.streak})`);
  ok(seeded.spanned >= 3, `…even though they span ${seeded.spanned} calendar days including a rest day`);

  // ---- grace: today not finished yet must not zero yesterday's chain
  const grace = await page.evaluate(async (keys) => {
    await window.__FIT__.seedLog("Eleanor", keys[0], { finished: false, done: [] });
    return { streak: window.__FIT__.streak("Eleanor"), todayDone: window.__FIT__.complete("Eleanor", keys[0]) };
  }, seeded.keys);
  ok(grace.todayDone === false, "today's record is genuinely unfinished");
  ok(grace.streak === 3, `an unfinished today doesn't zero the streak (${grace.streak} — the three days before it)`);

  // ---- a genuine gap breaks it
  const broken = await page.evaluate(async (keys) => {
    await window.__FIT__.seedLog("Eleanor", keys[2], { finished: false, done: [] });
    return window.__FIT__.streak("Eleanor");
  }, seeded.keys);
  ok(broken === 1, `a missed workout day breaks the streak (${broken})`);

  // ---- a REST day between two workouts must not break the chain (proved above by
  // `spanned`, asserted directly here against the plan's own rest weekday)
  const restSafe = await page.evaluate((keys) => {
    const add = (k, n) => { const d = new Date(Date.parse(k + "T12:00:00Z")); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); };
    let restBetween = false;
    for (let k = add(keys[3], 1); k < keys[0]; k = add(k, 1)){
      const d = window.__FIT__.dayOf(k);
      if (d && d.rest) restBetween = true;
    }
    return restBetween;
  }, seeded.keys);
  ok(restSafe, "the seeded run really does contain a rest day (so the rule above was exercised)");

  ok(errors.length === 0, "0 JS page errors" + (errors.length ? ": " + errors.slice(0,3).join(" | ") : ""));
  await page.close();
}

/* ========================= E. DAD GATE, BUILDER, PICKER ==================== */
async function sectionBuilder(browser){
  section("E. The Dad gate, the builder and the picker");

  // ---- a kid gets read-only, and is never asked for a PIN
  {
    const { page, errors } = await newPage(browser, { user: "Isaac", prompts: ["9999"] });
    await gotoApp(page);
    await pinWorkoutDay(page);   // never test the builder against a rest day
    await page.evaluate(() => window.__NAV__.goTo("fitness"));
    await page.waitForFunction(() => document.getElementById("fitEditLink"), { timeout: 10000 });
    await page.click("#fitEditLink");
    await page.waitForFunction(() => document.getElementById("fitSheetOverlay").classList.contains("open"), { timeout: 5000 });
    const kid = await page.evaluate(() => ({
      ro: window.__FIT__.readOnly(),
      prompted: window.__PROMPTED__.length,
      save: !!document.getElementById("fitSaveBtn"),
      addBlock: !!document.getElementById("fitAddBlockBtn"),
      close: (document.getElementById("fitCancelBtn")||{}).textContent,
      rowsShown: document.querySelectorAll("#fitSheetInner .fitrow").length,
    }));
    ok(kid.ro === true, "a kid opening the builder gets it read-only");
    ok(kid.prompted === 0, "a kid is never asked for Dad's PIN");
    ok(!kid.save && !kid.addBlock, "read-only mode offers no Save and no Add");
    ok(kid.rowsShown > 0, "…but they can still see the day's exercises");
    ok(errors.length === 0, "0 JS page errors (kid pass)" + (errors.length ? ": " + errors.slice(0,2).join(" | ") : ""));
    await page.close();
  }

  // ---- Dad with the WRONG pin gets nothing
  {
    const { page } = await newPage(browser, { user: "Dad", prompts: ["1234", "1234", "9999"] });
    await gotoApp(page);
    // first two prompts create the PIN (1234); then re-lock and try 9999
    await page.evaluate(() => window.__NAV__.goTo("fitness"));
    await page.waitForFunction(() => document.getElementById("fitEditLink"), { timeout: 10000 });
    await page.click("#fitEditLink");
    await page.waitForFunction(() => document.getElementById("fitSheetOverlay").classList.contains("open"), { timeout: 5000 });
    const created = await page.evaluate(() => ({ ro: window.__FIT__.readOnly(), save: !!document.getElementById("fitSaveBtn") }));
    ok(created.ro === false && created.save, "Dad who sets a PIN gets an editable builder");

    // re-lock the session and try a wrong PIN
    await page.evaluate(() => { window.__FIT__.closeSheet(); sessionStorage.removeItem("dadUnlocked"); localStorage.removeItem("dadUnlockedDevice"); });
    await page.click("#fitEditLink");
    await sleep(300);
    const wrong = await page.evaluate(() => ({
      open: document.getElementById("fitSheetOverlay").classList.contains("open"),
      alerted: (window.__ALERTS__ || []).some((a) => /wrong pin/i.test(a)),
    }));
    ok(!wrong.open, "a wrong PIN does not open the builder");
    ok(wrong.alerted, "a wrong PIN says so");
    await page.close();
  }

  // ---- Dad edits: picker, add, amount, remove, save, persist
  {
    const { page, errors } = await newPage(browser, { user: "Dad", prompts: ["1234", "1234"] });
    await gotoApp(page);
    await pinWorkoutDay(page);   // never test the builder against a rest day
    await page.evaluate(() => window.__NAV__.goTo("fitness"));
    await page.waitForFunction(() => document.getElementById("fitEditLink"), { timeout: 10000 });
    await page.click("#fitEditLink");
    await page.waitForFunction(() => document.getElementById("fitSaveBtn"), { timeout: 5000 });

    const meter0 = await page.evaluate(() => {
      const m = document.getElementById("fitMeter");
      return { secs: Number(m.dataset.secs), warn: m.classList.contains("warn"), label: m.querySelector(".fitmeter-l b").textContent };
    });
    ok(meter0.secs > 0 && !meter0.warn, `the budget meter reads on-target (${meter0.label})`);

    // open the picker from a block
    await page.evaluate(() => document.querySelector("[data-add-block]").click());
    await page.waitForFunction(() => window.__FIT__.sheetMode() === "picker", { timeout: 5000 });
    const pick0 = await page.evaluate(() => ({
      groups: [...document.querySelectorAll("#fitPickGroups .fitpick-chip")].map((c) => c.dataset.group),
      equip: [...document.querySelectorAll("#fitPickEquip .fitpick-chip")].map((c) => c.dataset.equip),
      headers: [...document.querySelectorAll("#fitPickList .fitpick-h")].map((h) => h.dataset.group),
      items: document.querySelectorAll("#fitPickList .fitpick-item").length,
      search: !!document.getElementById("fitPickSearch"),
    }));
    ok(pick0.search && pick0.groups.includes("all"), "the picker has search and a muscle-group filter");
    ok(pick0.equip.join(",") === "any,none,dumbbell,bands", "the picker filters by equipment");
    ok(pick0.items > 0, `the picker lists exercises (${pick0.items})`);

    // grouped under muscle-group headers, and filtering really filters
    const grouped = await page.evaluate(() => {
      window.__FIT__.setPick({ group: "all", q: "", equip: "any" });
      const heads = [...document.querySelectorAll("#fitPickList .fitpick-h")].map((h) => h.dataset.group);
      // every item must sit under a header of its own group
      let mismatched = 0, cur = null;
      for (const el of document.querySelectorAll("#fitPickList > *")){
        if (el.classList.contains("fitpick-h")) cur = el.dataset.group;
        else if (el.dataset.group !== cur) mismatched++;
      }
      return { heads, mismatched };
    });
    ok(grouped.heads.length >= 5, `exercises are grouped under muscle-group headers (${grouped.heads.length} groups)`);
    ok(grouped.mismatched === 0, "every exercise sits under its own muscle group");

    const filtered = await page.evaluate(() => {
      window.__FIT__.setPick({ group: "core" });
      const heads = [...document.querySelectorAll("#fitPickList .fitpick-h")].map((h) => h.dataset.group);
      const n = document.querySelectorAll("#fitPickList .fitpick-item").length;
      return { heads, n };
    });
    ok(filtered.heads.length === 1 && filtered.heads[0] === "core", "filtering to a muscle group shows only that group");
    ok(filtered.n > 0, `…with real results (${filtered.n})`);

    const searched = await page.evaluate(() => {
      window.__FIT__.setPick({ group: "all", q: "plank" });
      return [...document.querySelectorAll("#fitPickList .fitpick-item .fitrow-name")].map((n) => n.textContent);
    });
    ok(searched.length > 0 && searched.every((n) => /plank/i.test(n)), `search narrows to matches (${searched.length} for "plank")`);

    const equipFiltered = await page.evaluate(() => {
      window.__FIT__.setPick({ q: "", equip: "dumbbell" });
      return [...document.querySelectorAll("#fitPickList .fitpick-item .fitrow-sub")].map((s) => s.textContent);
    });
    ok(equipFiltered.length > 0 && equipFiltered.every((s) => /dumbbell/i.test(s)), "the equipment filter is honoured");

    if (WANT_SHOTS){
      await page.evaluate(() => window.__FIT__.setPick({ equip: "any", group: "core", q: "" }));
      await sleep(200);
      await page.screenshot({ path: path.join(SHOTS, "fit_picker.png") });
    }

    // add one, back in the builder
    const added = await page.evaluate(async () => {
      window.__FIT__.setPick({ group: "core", q: "plank", equip: "any" });
      const before = window.__FIT__.draft().blocks[0].items.length;
      document.querySelector("#fitPickList .fitpick-item").click();
      await new Promise(r => setTimeout(r, 50));
      const d = window.__FIT__.draft();
      return { mode: window.__FIT__.sheetMode(), before, after: d.blocks[0].items.length,
               last: d.blocks[0].items[d.blocks[0].items.length - 1] };
    });
    ok(added.mode === "builder", "picking an exercise returns to the builder");
    ok(added.after === added.before + 1, "the exercise is added to the block");
    ok(added.last.mode === "time" && added.last.secs > 0, "a hold (Plank) is added as a timed set, not reps");

    // the meter reacts
    const meter1 = await page.evaluate(() => Number(document.getElementById("fitMeter").dataset.secs));
    ok(meter1 > meter0.secs, `the budget meter grows when work is added (${meter0.secs}s → ${meter1}s)`);

    // change an amount, remove a row
    const edited = await page.evaluate(async () => {
      const row = document.querySelector("#fitSheetInner .fitrow");
      const num = row.querySelector("input[type=number]");
      num.value = "99"; num.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(r => setTimeout(r, 20));
      const d = window.__FIT__.draft();
      const it = d.blocks[0].items[0];
      return { amount: it.mode === "time" ? it.secs : it.reps, meter: Number(document.getElementById("fitMeter").dataset.secs),
               warn: document.getElementById("fitMeter").classList.contains("warn") };
    });
    ok(edited.amount === 99, "editing an amount updates the plan");
    ok(edited.warn, "the meter warns when the day runs long");

    const removed = await page.evaluate(async () => {
      const before = window.__FIT__.draft().blocks[0].items.length;
      document.querySelector("#fitSheetInner .fitrow .fitrow-x").click();
      await new Promise(r => setTimeout(r, 30));
      return { before, after: window.__FIT__.draft().blocks[0].items.length };
    });
    ok(removed.after === removed.before - 1, "an exercise can be removed");

    // rename + save, then confirm it persisted
    await page.evaluate(async () => {
      const t = document.getElementById("fitTitleInput");
      t.value = "Dad Test Day"; t.dispatchEvent(new Event("input", { bubbles: true }));
      document.getElementById("fitSaveBtn").click();
      await new Promise(r => setTimeout(r, 200));
    });
    const saved = await page.evaluate(() => ({
      open: document.getElementById("fitSheetOverlay").classList.contains("open"),
      title: window.__FIT__.dayOf().title,
      storedPlan: !!localStorage.getItem("setting_fitPlan"),
    }));
    ok(!saved.open, "saving closes the sheet");
    ok(saved.title === "Dad Test Day", "the edit is applied to the plan");
    ok(saved.storedPlan, "the plan is persisted");

    // The test clock does not survive a reload, so re-pin before asking about the day
    // that was edited — otherwise this reads the real (Sunday) rest day.
    await gotoApp(page);
    await pinWorkoutDay(page);
    const persisted = await page.evaluate(() => window.__FIT__.dayOf().title);
    ok(persisted === "Dad Test Day", "the edit survives a reload");

    // Cancel really cancels
    const cancelled = await page.evaluate(async () => {
      await window.__FIT__.openBuilder();
      await new Promise(r => setTimeout(r, 150));
      const t = document.getElementById("fitTitleInput");
      t.value = "Should Not Stick"; t.dispatchEvent(new Event("input", { bubbles: true }));
      document.getElementById("fitCancelBtn").click();
      await new Promise(r => setTimeout(r, 60));
      return window.__FIT__.dayOf().title;
    });
    ok(cancelled === "Dad Test Day", "Cancel discards the draft");

    if (WANT_SHOTS){
      await page.evaluate(async () => { await window.__FIT__.openBuilder(); });
      await sleep(300);
      await page.screenshot({ path: path.join(SHOTS, "fit_builder.png") });
      await page.evaluate(() => window.__FIT__.closeSheet());
    }

    ok(errors.length === 0, "0 JS page errors (Dad pass)" + (errors.length ? ": " + errors.slice(0,3).join(" | ") : ""));
    await page.close();
  }
}

/* ============================ C2. THE DEMO ================================= */
async function sectionDemo(browser){
  section("C2. The big looping 'show me how' demo");
  const { page, errors } = await newPage(browser, { user: "Isaac" });
  await gotoApp(page);
  const key = await pinWorkoutDay(page);
  await page.evaluate(() => window.__NAV__.goTo("fitness"));
  await page.waitForFunction(() => document.querySelector(".fitwrap .fitrow.tap"), { timeout: 10000 });

  // ---- every exercise in the day list is tappable
  const rows = await page.evaluate(() => {
    const rs = [...document.querySelectorAll(".fitwrap .fitrow.tap")];
    return { n: rs.length, tags: [...new Set(rs.map((r) => r.tagName))],
             labelled: rs.filter((r) => /Show me how/i.test(r.getAttribute("aria-label") || "")).length,
             looks: document.querySelectorAll(".fitwrap .fitrow-look").length };
  });
  ok(rows.n > 0 && rows.tags.join() === "BUTTON", `every exercise row is a real button (${rows.n})`);
  ok(rows.labelled === rows.n, "each row says it will show you how");
  ok(rows.looks === rows.n, "each row carries a visible 🔍 affordance");

  // ---- tapping one opens the demo
  const firstId = await page.evaluate(() => document.querySelector(".fitwrap .fitrow.tap").dataset.ex);
  await page.click(".fitwrap .fitrow.tap");
  await page.waitForFunction(() => document.getElementById("fitDemoOverlay").classList.contains("open"), { timeout: 5000 });
  const demo = await page.evaluate(() => {
    const a = document.getElementById("fitDemoAnim");
    // Measure the rendered PHOTO, not its container — a container bigger than the image
    // is dead letterbox space and must not count as "large".
    const r = a.querySelector("img.f0").getBoundingClientRect();
    const box = a.getBoundingClientRect();
    const thumb = document.querySelector(".fitwrap .fitthumb");
    const tr = thumb ? thumb.getBoundingClientRect() : { width: 1, height: 1 };
    return {
      id: window.__FIT__.demo().id,
      name: (document.querySelector(".fitdemo-name") || {}).textContent,
      meta: (document.querySelector(".fitdemo-meta") || {}).textContent,
      frames: [...a.querySelectorAll("img")].map((i) => i.getAttribute("src")),
      w: Math.round(r.width), h: Math.round(r.height),
      vw: window.innerWidth, vh: window.innerHeight,
      areaVsThumb: Math.round((r.width * r.height) / (tr.width * tr.height)),
      // how much of the container is NOT the photo — i.e. wasted letterbox
      deadSpace: Math.round(100 - (r.width * r.height) / (box.width * box.height) * 100),
      steps: document.querySelectorAll(".fitdemo-steps li").length,
      badge: (document.getElementById("fitDemoBadge") || {}).textContent,
      overlayZ: Number(getComputedStyle(document.getElementById("fitDemoOverlay")).zIndex),
      playerZ: Number(getComputedStyle(document.getElementById("fitPlayOverlay")).zIndex),
    };
  });
  ok(demo.id === firstId, `tapping an exercise opens its own demo (${demo.name})`);
  ok(demo.frames.length === 2 && /\/0\.webp$/.test(demo.frames[0]) && /\/1\.webp$/.test(demo.frames[1]),
     "the demo mounts both animation frames");
  ok(demo.w >= demo.vw * 0.95, `the animation is full-bleed — ${demo.w}px wide on a ${demo.vw}px screen`);
  ok(demo.h >= 180, `…and tall enough to read (${demo.h}px)`);
  ok(demo.areaVsThumb >= 20, `…roughly ${demo.areaVsThumb}× the area of the list thumbnail`);
  ok(demo.deadSpace <= 5, `the photo fills its frame — ${demo.deadSpace}% dead letterbox space`);
  ok(demo.steps > 0, `the how-to steps are shown (${demo.steps})`);
  ok(demo.overlayZ > demo.playerZ, "the demo layers above the workout player");
  ok(/pause/i.test(demo.badge || ""), "it says how to pause the loop");

  // ---- it actually LOOPS
  const looped = await page.evaluate(async () => {
    const a = document.getElementById("fitDemoAnim");
    const seen = new Set();
    for (let i = 0; i < 16; i++){ seen.add(a.classList.contains("flip")); await new Promise(r => setTimeout(r, 180)); }
    return [...seen].length;
  });
  ok(looped === 2, "the demo animation loops continuously between the two frames");

  // ---- tap to freeze, tap to play
  const frozen = await page.evaluate(async () => {
    document.getElementById("fitDemoAnim").click();
    const state = document.getElementById("fitDemoAnim").classList.contains("frozen");
    const badge = document.getElementById("fitDemoBadge").textContent;
    const before = document.getElementById("fitDemoAnim").classList.contains("flip");
    const seen = new Set();
    for (let i = 0; i < 10; i++){ seen.add(document.getElementById("fitDemoAnim").classList.contains("flip")); await new Promise(r => setTimeout(r, 180)); }
    return { state, badge, held: seen.size === 1 && [...seen][0] === before };
  });
  ok(frozen.state && /play/i.test(frozen.badge), "tapping the picture freezes the loop");
  ok(frozen.held, "…and it really holds that frame");
  await page.evaluate(() => document.getElementById("fitDemoAnim").click());
  const unfrozen = await page.evaluate(() => window.__FIT__.demo().frozen);
  ok(!unfrozen, "tapping again resumes the loop");

  await page.evaluate(() => document.getElementById("fitDemoClose").click());
  const closed = await page.evaluate(() => window.__FIT__.demo());
  ok(!closed.open && closed.id === null, "the demo closes cleanly");

  // ---- mid-workout: opens, pauses the clock, resumes on close
  await page.click("#fitStartBtn");
  await page.evaluate(() => { window.__FIT__.warp(9999); window.__FIT__.tick(); });
  await sleep(150);
  const beforeTap = await page.evaluate(() => {
    const r = window.__FIT__.run();
    return { phase: r.phase, paused: r.paused, i: r.i, remain: r.remain,
             tappable: !!document.querySelector(".fitp-anim.tappable"),
             hint: (document.querySelector(".fitp-animhint") || {}).textContent };
  });
  ok(beforeTap.phase === "ex" && !beforeTap.paused, "the workout is running on an exercise");
  ok(beforeTap.tappable && /closer look/i.test(beforeTap.hint || ""), "the player's picture invites a closer look");

  await page.evaluate(() => document.querySelector(".fitp-anim.tappable").click());
  await page.waitForFunction(() => document.getElementById("fitDemoOverlay").classList.contains("open"), { timeout: 5000 });
  const during = await page.evaluate(() => ({ demo: window.__FIT__.demo(), run: window.__FIT__.run(),
                                              btn: (document.getElementById("fitDemoDone") || {}).textContent }));
  ok(during.demo.open && during.demo.id === during.run.step.it.id, "tapping mid-set opens THAT exercise's demo");
  ok(during.run.paused, "the workout pauses while they study it");
  ok(during.demo.willResume && /keep going/i.test(during.btn || ""), "…and the button offers to carry on");

  /* The countdown must not drain while the demo is up. Measured with REAL elapsed time,
     not the warp hook — warp rewinds the step clock to fake elapsed seconds, which is
     exactly what pause accounting is supposed to ignore, so warping here would test the
     harness rather than the product. */
  const held = await page.evaluate(async (i) => {
    const r0 = window.__FIT__.run().remain;
    await new Promise(r => setTimeout(r, 900));          // a real 0.9s of "looking at it"
    const r = window.__FIT__.run();
    return { sameStep: r.i === i, stillPaused: r.paused, r0, r1: r.remain, drift: Math.abs((r.remain || 0) - (r0 || 0)) };
  }, beforeTap.i);
  ok(held.sameStep && held.stillPaused, "no exercise is skipped while the demo is open");
  ok(held.drift < 100, `the countdown is frozen behind the demo (${held.drift}ms drift over 900ms)`);

  await page.evaluate(() => document.getElementById("fitDemoDone").click());
  await sleep(150);
  const after = await page.evaluate(() => ({ demo: window.__FIT__.demo(), run: window.__FIT__.run() }));
  ok(!after.demo.open, "closing returns to the workout");
  ok(!after.run.paused && after.run.i === beforeTap.i, "…resumed, on the same exercise");
  ok(Math.abs((after.run.remain || 0) - (held.r1 || 0)) < 400,
     `…with the time they had left intact (${Math.round((held.r1||0)/1000)}s before, ${Math.round((after.run.remain||0)/1000)}s after)`);

  if (WANT_SHOTS){
    await page.evaluate(() => document.querySelector(".fitp-anim.tappable").click());
    await sleep(500);
    await page.screenshot({ path: path.join(SHOTS, "fit_demo.png") });
    await page.evaluate(() => window.__FIT__.closeDemo());
  }

  await page.evaluate(() => window.__FIT__.quit());
  ok(errors.length === 0, "0 JS page errors" + (errors.length ? ": " + errors.slice(0,3).join(" | ") : ""));
  await page.close();
}

/* ========================== E2. PER-KID PLANS ============================== */
async function sectionPerKid(browser){
  section("E2. Separate plans per kid");

  const { page, errors } = await newPage(browser, { user: "Dad", prompts: ["1234", "1234"] });
  await gotoApp(page);
  await pinWorkoutDay(page);
  await page.evaluate(() => window.__NAV__.goTo("fitness"));
  await page.waitForFunction(() => document.getElementById("fitWhoRow"), { timeout: 10000 });

  // NB: read dataset STRINGS, never the DOMStringMap itself — it doesn't survive
  // puppeteer's structured-clone and arrives as an empty object.
  const sel = await page.evaluate(() => ({
    options: [...document.querySelectorAll("#fitWhoRow .fitwho-b")].map((b) => b.dataset.who),
    labels: [...document.querySelectorAll("#fitWhoRow .fitwho-b")].map((b) => b.textContent),
    selected: (document.querySelector("#fitWhoRow .fitwho-b.sel") || { dataset:{} }).dataset.who,
    selCount: document.querySelectorAll("#fitWhoRow .fitwho-b.sel").length,
  }));
  ok(sel.options.join(",") === ",Isaac,Eleanor", `a parent can pick whose plan to look at (${sel.labels.join(" / ")})`);
  ok(sel.selCount === 1 && sel.selected === "", "it starts on the shared plan");

  // ---- both kids start out on the shared plan
  const start = await page.evaluate(() => ({
    isaac: window.__FIT__.hasOwnPlan("Isaac"),
    eleanor: window.__FIT__.hasOwnPlan("Eleanor"),
  }));
  ok(!start.isaac && !start.eleanor, "out of the box both kids follow one shared plan");

  // ---- viewing a kid says so, and offers the fork
  await page.evaluate(() => window.__FIT__.setView("Isaac"));
  await sleep(200);
  const beforeFork = await page.evaluate(() => ({
    own: (document.getElementById("fitForkNote") || { dataset:{} }).dataset.own,
    text: (document.querySelector("#fitForkNote .fitfork-t") || {}).textContent,
    btn: (document.getElementById("fitForkBtn") || {}).textContent,
    editLabel: (document.getElementById("fitEditLink") || {}).textContent,
  }));
  ok(beforeFork.own === "0" && /follows the shared plan/.test(beforeFork.text || ""),
     `viewing Isaac says he follows the shared plan ("${(beforeFork.text||"").trim()}")`);
  ok(/Give Isaac their own plan/.test(beforeFork.btn || ""), "…and offers to give him his own");
  ok(/shared plan/.test(beforeFork.editLabel || ""), `the edit button names what it will change ("${(beforeFork.editLabel||"").trim()}")`);

  // ---- fork Isaac
  await page.evaluate(() => document.getElementById("fitForkBtn").click());
  await page.waitForFunction(() => window.__FIT__.hasOwnPlan("Isaac"), { timeout: 5000 });
  const forked = await page.evaluate(() => ({
    isaac: window.__FIT__.hasOwnPlan("Isaac"),
    eleanor: window.__FIT__.hasOwnPlan("Eleanor"),
    own: (document.getElementById("fitForkNote") || {}).dataset.own,
    btn: (document.getElementById("fitForkBtn") || {}).textContent,
    editLabel: (document.getElementById("fitEditLink") || {}).textContent,
    stored: !!localStorage.getItem("setting_fitPlan_Isaac"),
  }));
  ok(forked.isaac, "Isaac now has his own plan");
  ok(!forked.eleanor, "…and Eleanor is untouched by that");
  ok(forked.own === "1" && /Use the shared plan/.test(forked.btn || ""), "the banner flips to offer going back");
  ok(/Isaac's plan/.test(forked.editLabel || ""), `the edit button now names Isaac ("${(forked.editLabel||"").trim()}")`);
  ok(forked.stored, "Isaac's plan is persisted to its own doc");

  if (WANT_SHOTS){
    await sleep(250);
    await page.screenshot({ path: path.join(SHOTS, "fit_perkid.png") });
  }

  // ---- editing Isaac's plan does NOT change the shared one
  const shared0 = await page.evaluate(() => window.__FIT__.plan("").days[Object.keys(window.__FIT__.plan("").days)[0]] && JSON.stringify(window.__FIT__.plan("")));
  await page.evaluate(async () => {
    await window.__FIT__.openBuilder();
    await new Promise(r => setTimeout(r, 200));
  });
  const scope = await page.evaluate(() => ({
    who: (document.getElementById("fitScopeNote") || {}).dataset.who,
    text: (document.getElementById("fitScopeNote") || {}).textContent,
    draftWho: window.__FIT__.draftWho(),
  }));
  ok(scope.who === "Isaac" && /Isaac's own plan/.test(scope.text || ""), "the builder states it is editing Isaac's own plan");

  await page.evaluate(async () => {
    const t = document.getElementById("fitTitleInput");
    t.value = "Isaac Only"; t.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("fitSaveBtn").click();
    await new Promise(r => setTimeout(r, 250));
  });
  const afterEdit = await page.evaluate(() => ({
    isaacTitle: window.__FIT__.dayOf(undefined, "Isaac").title,
    sharedTitle: window.__FIT__.dayOf(undefined, "").title,
    eleanorTitle: window.__FIT__.dayOf(undefined, "Eleanor").title,
  }));
  ok(afterEdit.isaacTitle === "Isaac Only", "the edit lands on Isaac's plan");
  ok(afterEdit.sharedTitle !== "Isaac Only", `the shared plan is unchanged ("${afterEdit.sharedTitle}")`);
  ok(afterEdit.eleanorTitle === afterEdit.sharedTitle, "Eleanor still follows the shared plan");

  // ---- and it survives a reload
  await gotoApp(page);
  await pinWorkoutDay(page);
  const reloaded = await page.evaluate(() => ({
    isaac: window.__FIT__.dayOf(undefined, "Isaac").title,
    shared: window.__FIT__.dayOf(undefined, "").title,
    hasOwn: window.__FIT__.hasOwnPlan("Isaac"),
  }));
  ok(reloaded.hasOwn && reloaded.isaac === "Isaac Only", "Isaac's own plan survives a reload");
  ok(reloaded.shared !== "Isaac Only", "…still without touching the shared plan");

  // ---- editing the SHARED plan doesn't leak into Isaac's
  await page.evaluate(async () => {
    window.__FIT__.setView("");
    await new Promise(r => setTimeout(r, 120));
    await window.__FIT__.openBuilder();
    await new Promise(r => setTimeout(r, 200));
    const t = document.getElementById("fitTitleInput");
    t.value = "Everyone Else"; t.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("fitSaveBtn").click();
    await new Promise(r => setTimeout(r, 250));
  });
  const bothWays = await page.evaluate(() => ({
    shared: window.__FIT__.dayOf(undefined, "").title,
    isaac: window.__FIT__.dayOf(undefined, "Isaac").title,
    eleanor: window.__FIT__.dayOf(undefined, "Eleanor").title,
  }));
  ok(bothWays.shared === "Everyone Else", "the shared plan can still be edited");
  ok(bothWays.isaac === "Isaac Only", "…without disturbing Isaac's own plan");
  ok(bothWays.eleanor === "Everyone Else", "Eleanor, still on the shared plan, follows the change");

  // ---- reverting Isaac puts him back
  await page.evaluate(async () => { window.__FIT__.setView("Isaac"); await new Promise(r => setTimeout(r, 150)); await window.__FIT__.unfork("Isaac"); });
  await sleep(150);
  const reverted = await page.evaluate(() => ({ hasOwn: window.__FIT__.hasOwnPlan("Isaac"), title: window.__FIT__.dayOf(undefined, "Isaac").title }));
  ok(!reverted.hasOwn, "Isaac can be put back on the shared plan");
  ok(reverted.title === "Everyone Else", "…and immediately follows it again");

  // the revert is a tombstone, not a delete — it must survive a reload
  await gotoApp(page);
  await pinWorkoutDay(page);
  const revertStuck = await page.evaluate(() => ({ hasOwn: window.__FIT__.hasOwnPlan("Isaac"), title: window.__FIT__.dayOf(undefined, "Isaac").title }));
  ok(!revertStuck.hasOwn && revertStuck.title === "Everyone Else", "the revert survives a reload (tombstoned, not silently restored)");

  ok(errors.length === 0, "0 JS page errors (per-kid pass)" + (errors.length ? ": " + errors.slice(0,3).join(" | ") : ""));
  await page.close();

  // ---- a KID never sees the selector and always gets their own plan
  {
    const { page: k, errors: kErr } = await newPage(browser, { user: "Isaac" });
    await gotoApp(k);
    await pinWorkoutDay(k);
    // give Isaac an override behind the scenes, then confirm he lands on it
    await k.evaluate(async () => {
      await window.__FIT__.fork("Isaac");
      const p = window.__FIT__.rawPlan("Isaac");
      p.days[Object.keys(p.days)[0]].title = "Isaac Only";
      window.__FIT__.setView("Eleanor");        // a kid must be immune to this
      window.__NAV__.goTo("fitness");
      await new Promise(r => setTimeout(r, 250));
    });
    const kid = await k.evaluate(() => ({
      selector: !!document.getElementById("fitWhoRow"),
      forkNote: !!document.getElementById("fitForkNote"),
      whose: window.__FIT__.whose(),
    }));
    ok(!kid.selector, "a kid never sees the whose-plan selector");
    ok(!kid.forkNote, "…nor the shared-vs-own banner");
    ok(kid.whose === "Isaac", "a kid always gets their own plan, whatever the selector says");
    ok(kErr.length === 0, "0 JS page errors (kid pass)" + (kErr.length ? ": " + kErr.slice(0,2).join(" | ") : ""));
    await k.close();
  }
}

/* ============================== F. LAYOUT ================================== */
async function sectionLayout(browser){
  section("F. Mobile + desktop layout");

  const { page, errors } = await newPage(browser, { user: "Isaac" });
  await gotoApp(page);
  await page.evaluate(() => window.__NAV__.goTo("fitness"));
  await page.waitForFunction(() => document.querySelector(".fitwrap"), { timeout: 10000 });

  const m = await page.evaluate(() => ({
    hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    smallTargets: [...document.querySelectorAll(".fitwrap button, #bnav button")]
      .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 40; })
      .map((b) => (b.textContent || b.dataset.gid || "?").trim().slice(0, 18)),
  }));
  ok(!m.hScroll, "no horizontal scroll on the Fitness tab at 390px");
  ok(m.smallTargets.length === 0, "every control is at least 40px tall" + (m.smallTargets.length ? ": " + m.smallTargets.join(", ") : ""));

  // the player must fit a phone without scrolling
  await pinWorkoutDay(page);
  await page.evaluate(() => window.__NAV__.goTo("fitness"));
  await page.waitForFunction(() => document.getElementById("fitStartBtn"), { timeout: 10000 });
  await page.click("#fitStartBtn");
  await page.evaluate(() => { window.__FIT__.warp(9999); window.__FIT__.tick(); });
  await sleep(200);

  const p = await page.evaluate(() => {
    const inner = document.getElementById("fitPlayInner");
    const act = document.querySelector(".fitp-act");
    return {
      overflows: inner.scrollHeight > window.innerHeight + 2,
      actionsVisible: act ? act.getBoundingClientRect().bottom <= window.innerHeight + 1 : false,
      animVisible: (() => { const a = document.querySelector(".fitp-anim"); if (!a) return false; const r = a.getBoundingClientRect(); return r.height > 60 && r.bottom <= window.innerHeight; })(),
      hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  ok(!p.overflows, "the player fits a 390x844 phone without scrolling");
  ok(p.actionsVisible, "the Done/Skip buttons are on screen");
  ok(p.animVisible, "the animation is visible above the fold");
  ok(!p.hScroll, "no horizontal scroll in the player");

  if (WANT_SHOTS){
    await page.screenshot({ path: path.join(SHOTS, "fit_player.png") });
    await page.evaluate(() => { window.__FIT__.advance("done"); });
    await sleep(250);
    await page.screenshot({ path: path.join(SHOTS, "fit_rest.png") });
  }
  await page.evaluate(() => window.__FIT__.quit());
  ok(errors.length === 0, "0 JS page errors (mobile)" + (errors.length ? ": " + errors.slice(0,3).join(" | ") : ""));
  await page.close();

  // ---- desktop
  const { page: d, errors: dErrors } = await newPage(browser, { user: "Isaac", viewport: { width: 1280, height: 800, deviceScaleFactor: 1 } });
  await gotoApp(d);
  await pinWorkoutDay(d);
  await d.evaluate(() => window.__NAV__.goTo("fitness"));
  await d.waitForFunction(() => document.querySelector(".fitwrap .fitcard2"), { timeout: 10000 });
  const dd = await d.evaluate(() => ({
    hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    rows: document.querySelectorAll(".fitwrap .fitrow").length,
  }));
  ok(!dd.hScroll, "no horizontal scroll on desktop");
  ok(dd.rows > 0, "the section renders on desktop");
  if (WANT_SHOTS) await d.screenshot({ path: path.join(SHOTS, "fit_desktop.png") });
  ok(dErrors.length === 0, "0 JS page errors (desktop)" + (dErrors.length ? ": " + dErrors.slice(0,3).join(" | ") : ""));
  await d.close();
}

/* ================================== main =================================== */
(async () => {
  if (WANT_SHOTS && !fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  const libData = sectionLibrary();
  if (!libData){ console.log("\nLibrary missing — run: node tools/_fit_build_library.mjs"); process.exit(1); }

  const srv = await serve();
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });

  try {
    await sectionApp(browser);
    await sectionPlayer(browser);
    await sectionDemo(browser);
    await sectionStreak(browser);
    await sectionBuilder(browser);
    await sectionPerKid(browser);
    await sectionLayout(browser);
  } catch (err) {
    fail++; failures.push("suite crashed: " + err.message);
    console.log("\n✗ SUITE ERROR: " + (err && err.stack || err));
  } finally {
    await browser.close();
    srv.close();
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`FITNESS: ${pass}/${pass + fail} checks passed`);
  if (fail){ console.log("\nFailures:"); for (const f of failures) console.log("  ✗ " + f); }
  process.exit(fail ? 1 : 0);
})();
