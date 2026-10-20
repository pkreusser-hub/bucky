#!/usr/bin/env node
"use strict";
/**
 * BUCKY TV suite — tv.html, the TV home screen the Bucky TV Android app (android-tv/) shows.
 *
 *   node tools/_verify-tv.cjs [--shots]
 *
 * Drives the real page in Chrome at the two sizes it actually meets: 960x540 (what a 1080p
 * Google TV's WebView reports) and 1920x1080 (a desktop preview). Every upstream is
 * route-mocked in the shape the real service returns:
 *   - Firestore REST (typed `fields`, integerValue for whole numbers, runQuery's array of
 *     {document, readTime} rows) — NOTHING reaches production; any googleapis / firestore /
 *     firebase / gstatic URL that isn't one of the fixtures below is aborted.
 *   - Open-Meteo, the calendar function, ESPN's scoreboard + game summary, Sleeper.
 * The GFFL fixtures are the real week-3 captures under tools/fixtures/sunday-ff/.
 *
 * The Android bridge (window.BuckyTV) is faked with a recorder so the tiles' launches are
 * asserted as calls, the way the wrapper's MainActivity.Bridge would receive them.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const FIX = path.join(__dirname, "fixtures", "sunday-ff");
const PORT = 8891;
const BASE = "http://127.0.0.1:" + PORT;
const SHOT = process.argv.includes("--shots");

let pass = 0;
const fails = [];
const ok = (c, m) => (c ? (pass++, console.log("  ✓ " + m)) : (fails.push(m), console.log("  ✗ " + m)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
      res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

// ------------------------------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, "0");
const NOW = new Date();
const TODAY = NOW.getFullYear() + "-" + pad(NOW.getMonth() + 1) + "-" + pad(NOW.getDate());
const dayAt = (offsetDays, h, m) => { const d = new Date(NOW); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offsetDays); d.setHours(h, m || 0); return d; };
const keyOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

// Firestore typed encoding, the way the REST API returns it (whole numbers as integerValue strings).
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(enc) } : {} };
  const fields = {}; for (const k of Object.keys(v)) fields[k] = enc(v[k]);
  return { mapValue: { fields } };
}
const encFields = (o) => enc(o).mapValue.fields;
const DOCS = "projects/amen-farms-app/databases/(default)/documents/";
const row = (coll, id, obj) => ({ document: { name: DOCS + coll + "/" + id, fields: encFields(obj), createTime: "2026-08-01T00:00:00Z", updateTime: "2026-10-01T00:00:00Z" }, readTime: new Date().toISOString() });

// Today's night slot is covered by Joy, so the night chore must drop off the TV.
const CARE = { defaults: { sun: { am: "Kreussers", pm: "Kreussers" }, mon: { am: "Kreussers", pm: "Kreussers" }, tue: { am: "Kreussers", pm: "Kreussers" }, wed: { am: "Kreussers", pm: "Kreussers" }, thu: { am: "Kreussers", pm: "Kreussers" }, fri: { am: "Kreussers", pm: "Kreussers" }, sat: { am: "Kreussers", pm: "Kreussers" } }, overrides: { [TODAY]: { pm: "Joy" } } };
const CHORES = [
  { id: "c1", name: "Feed the goats", frequency: "daily", target: 1, order: 1, timeOfDay: "morning", donePeriod: TODAY, doneLog: [{ at: Date.now() - 3600e3, by: "Emma" }] },
  { id: "c2", name: "Collect eggs", frequency: "daily", target: 1, order: 2, timeOfDay: "morning", donePeriod: "2026-01-01", doneLog: [{ at: 1, by: "Old" }] },
  { id: "c3", name: "Close the barn", frequency: "daily", target: 1, order: 3, timeOfDay: "night" },
  // Legacy single-completion fields (lastPeriod/lastAt/lastBy), still on older docs.
  { id: "c4", name: "Water the garden", frequency: "daily", target: 1, order: 4, timeOfDay: "morning", lastPeriod: TODAY, lastAt: Date.now() - 600e3, lastBy: "Sam" },
];
// Goat photos are JPEG data URLs on the goat doc, resized to 500 px wide by index.html.
const JPEG = (i) => "data:image/jpeg;base64," + fs.readFileSync(path.join(__dirname, "fixtures", "tv", "goat-" + i + ".jpg")).toString("base64");
const GOATS = [
  { id: "g1", name: "Daisy", frequency: "goathooves", photos: [JPEG(0), JPEG(1)] },
  { id: "g2", name: "Pepper", frequency: "goathooves", photo: JPEG(2) },
  { id: "g3", name: "No Photo Yet", frequency: "goathooves" },
];

// Calendar: a timed event later today, one that already ended, an all-day one, one tomorrow.
const minsToMidnight = (dayAt(1, 0) - NOW) / 60000;
const LATER = new Date(NOW.getTime() + Math.max(2, Math.min(90, minsToMidnight / 2)) * 60000);
const ENDED_START = new Date(Math.max(dayAt(0, 0).getTime(), NOW.getTime() - 3 * 3600e3));
const ENDED_END = new Date(NOW.getTime() - 60e3);
const EVENTS = [
  { id: "e1", title: "Soccer practice", start: LATER.toISOString(), end: new Date(LATER.getTime() + 3600e3).toISOString(), allDay: false },
  { id: "e2", title: "Dentist (already over)", start: ENDED_START.toISOString(), end: ENDED_END.toISOString(), allDay: false },
  { id: "e3", title: "Grandma visiting", start: TODAY, end: keyOf(dayAt(1, 0)), allDay: true },
  { id: "e4", title: "Vet for the goats", start: dayAt(1, 10).toISOString(), end: dayAt(1, 11).toISOString(), allDay: false },
];

const WX = {
  current: { time: "2026-10-20T19:00", temperature_2m: 61.6, weather_code: 2 },
  daily: {
    time: [0, 1, 2, 3, 4].map((i) => keyOf(dayAt(i, 0))),
    weather_code: [2, 61, 0, 3, 95],
    temperature_2m_max: [72.4, 66.1, 70.0, 68.5, 64.2],
    temperature_2m_min: [50.2, 52.7, 48.9, 47.0, 45.5],
    precipitation_probability_max: [5, 80, 0, 20, 65],
  },
};

const SUMMARY = JSON.parse(fs.readFileSync(path.join(FIX, "atl-gb-w3-summary.json"), "utf8"));
const espnEvent = (id, away, home, state) => ({
  id, date: "2026-09-21T17:00Z", status: { type: { state, completed: state === "post" }, period: state === "pre" ? 0 : 4, displayClock: "0:00" },
  competitions: [{ id, status: { type: { state } }, competitors: [{ homeAway: "home", team: { abbreviation: home } }, { homeAway: "away", team: { abbreviation: away } }], broadcasts: [{ names: ["FOX"] }] }],
});
const BOARD = { events: [espnEvent("401872948", "ATL", "GB", "post"), espnEvent("401872999", "KC", "BUF", "pre")] };

// ------------------------------------------------------------------------------------------
// Routing
// ------------------------------------------------------------------------------------------
function fsDocFile(id) {
  const m = { settings: "fs-settings.json", sched_2026: "fs-sched-2026.json", roster_2026_w3_t1: "fs-roster-2026-w3-t1.json" }[id];
  return m ? path.join(FIX, m) : null;
}
async function newPage(browser, viewport, opts) {
  opts = opts || {};
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  const errors = [], escaped = [], seen = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    seen.push(url);
    const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST" };
    const json = (body, status) => req.respond({ status: status || 200, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
    // A cross-origin POST with a JSON body is preflighted, as it is against the real Firestore.
    if (req.method() === "OPTIONS" && !url.startsWith(BASE)) return req.respond({ status: 204, headers: CORS, body: "" });
    if (url.startsWith(BASE)) {
      // A "deploy" while the page is open: from now on the server hands out a changed tv.html.
      if (opts.site && /\/tv\.html(\?|$)/.test(url)) {
        if (req.resourceType() === "document") opts.site.docLoads++;
        if (opts.site.down && req.resourceType() !== "document") return req.respond({ status: 503, contentType: "text/plain", body: "deploying" });
        if (opts.site.deployed) return req.respond({ status: 200, contentType: "text/html", body: fs.readFileSync(path.join(ROOT, "tv.html"), "utf8") + "\n<!-- deploy 2 -->\n" });
      }
      if (url.includes("/.netlify/functions/calendar")) {
        const b = JSON.parse(req.postData() || "{}");
        if (b.secret !== "amenfarms" || b.action !== "list") return json({ error: "unauthorized" }, 401);
        return json({ events: EVENTS });
      }
      return req.continue();
    }
    if (/firestore\.googleapis\.com/.test(url)) {
      if (/documents:runQuery/.test(url)) {
        const q = JSON.parse(req.postData() || "{}").structuredQuery || {};
        const coll = q.from && q.from[0] && q.from[0].collectionId;
        const ff = q.where && q.where.fieldFilter;
        const val = ff && ff.value && ff.value.stringValue;
        if (coll === "chores_fam2jan2g" && ff.field.fieldPath === "frequency") {
          const src = val === "daily" ? CHORES : val === "goathooves" ? GOATS : [];
          const rows = src.map((c) => { const { id, ...rest } = c; return row(coll, id, rest); });
          return json(rows.length ? rows : [{ readTime: new Date().toISOString() }]);
        }
        if (coll === "gffl_fam2jan2g") return json(JSON.parse(fs.readFileSync(path.join(FIX, "fs-teams.json"), "utf8")));
        return json([{ readTime: new Date().toISOString() }]);
      }
      const m = url.match(/documents\/([^?]+)/);
      const p = m ? decodeURIComponent(m[1]) : "";
      if (p === "settings_fam2jan2g/animalCare") return json({ name: DOCS + p, fields: encFields({ json: JSON.stringify(CARE) }) });
      if (p.startsWith("gffl_fam2jan2g/")) {
        const f = fsDocFile(p.split("/")[1]);
        if (f) return json(JSON.parse(fs.readFileSync(f, "utf8")));
      }
      return json({ error: { code: 404, message: "No document to update", status: "NOT_FOUND" } }, 404);
    }
    if (/api\.open-meteo\.com/.test(url)) return json(WX);
    if (/site\.api\.espn\.com\/.*\/scoreboard/.test(url)) return json(BOARD);
    if (/site\.api\.espn\.com\/.*\/summary\?event=401872948/.test(url)) return json(SUMMARY);
    if (/api\.sleeper\.com/.test(url)) return json([]);
    escaped.push(url);
    return req.abort();
  });
  await page.evaluateOnNewDocument((withBridge) => {
    window.__opened = [];
    window.open = (u) => { window.__opened.push(u); return null; };
    if (withBridge) {
      window.__calls = [];
      window.BuckyTV = {
        version: () => 1,
        launch: (p) => { window.__calls.push(["launch", p]); return p !== "com.example.gone"; },
        openUrl: (u, p) => { window.__calls.push(["openUrl", u, p]); return true; },
        openSettings: () => { window.__calls.push(["settings"]); return true; },
        installed: () => true,
        apps: () => JSON.stringify([
          { pkg: "com.amazon.amazonvideo.livingroom", label: "Prime Video" },
          { pkg: "com.netflix.ninja", label: "Netflix" },
          { pkg: "com.google.android.youtube.tvunplugged", label: "YouTube TV" },
          { pkg: "com.google.android.youtube.tv", label: "YouTube" },
          { pkg: "com.example.gone", label: "Gone App" },
        ]),
        banner: () => "",
      };
    }
  }, !!opts.bridge);
  return { page, ctx, errors, escaped, seen };
}
const NOISE = /fonts\.g|Failed to load resource|ERR_FAILED/i;

async function boot(page, query) {
  await page.goto(BASE + "/tv.html" + (query || "?week=3"), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.getElementById("gfflSec").hidden && document.querySelector("#choreList .chore") && document.querySelector("#calList .ev"), { timeout: 15000 });
  await sleep(150);
}
const active = (page) => page.evaluate(() => { const a = document.activeElement; return a ? (a.dataset.act || "") + (a.dataset.pkg ? ":" + a.dataset.pkg : "") : ""; });
const shown = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== "none" && r.width > 0 && r.height > 0; }, sel);
const text = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent : ""; }, sel);

// The GFFL total the TV should show for team 1, computed here by the same engine against the
// same fixtures, then checked independently for being a real number off the box score.
async function expectedTeam1() {
  const FF = require(path.join(ROOT, "assets/sunday/sd-fantasy.js"));
  const fetchFix = async (url) => {
    const res = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (/runQuery/.test(url)) return res(200, JSON.parse(fs.readFileSync(path.join(FIX, "fs-teams.json"), "utf8")));
    if (/sleeper/.test(url)) return res(200, []);
    const id = decodeURIComponent((url.match(/gffl_fam2jan2g\/([^?]+)/) || [])[1] || "");
    const f = fsDocFile(id);
    return f ? res(200, JSON.parse(fs.readFileSync(f, "utf8"))) : res(404, {});
  };
  await FF.load({ week: 3, fetch: fetchFix });
  FF.ingestBoard(BOARD.events);
  FF.ingestSummary("401872948", SUMMARY);
  const t = FF.teamScore(1);
  // Hand check off the box score: the starters of team 1 who played in ATL @ GB, each priced.
  const inGame = t.starters.filter((s) => s.eventId === "401872948");
  return { pts: t.pts, inGame: inGame.length, name: FF.teams.get(1).name, opp: FF.teams.get(FF.matchups.find((m) => m.home === 1 || m.away === 1)[FF.matchups.find((m) => m.home === 1 || m.away === 1).home === 1 ? "away" : "home"]).name };
}

// ------------------------------------------------------------------------------------------
async function run() {
  const srv = await serve();
  const browser = await puppeteer.launch({
    ...(process.env.BUCKY_CHROME ? { executablePath: process.env.BUCKY_CHROME } : { channel: "chrome" }),
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
  });
  if (SHOT) fs.mkdirSync(SHOTS, { recursive: true });
  const exp = await expectedTeam1();

  try {
    /* ---- A · boot inside the Android wrapper, at the TV's own CSS size --------------- */
    console.log("\nA. Boot at 960x540 inside the wrapper");
    const A = await newPage(browser, { width: 960, height: 540, deviceScaleFactor: 2 }, { bridge: true });
    await boot(A.page);
    ok(A.errors.length === 0, "no page errors (" + A.errors.join(" | ") + ")");
    ok((await active(A.page)) === "prime", "Prime Video has focus on open (" + (await active(A.page)) + ")");
    ok(/^\d{1,2}:\d{2}$/.test(await text(A.page, "#clock")), "the clock shows the time (" + (await text(A.page, "#clock")) + ")");
    // Hand-computed from the fixture: 61.6 rounds to 62; today's 72.4/50.2 -> 72/50; code 2 is partly cloudy.
    ok((await text(A.page, "#wxTemp")) === "62°", "current temperature 61.6 shows as 62° (" + (await text(A.page, "#wxTemp")) + ")");
    ok(norm(await text(A.page, "#wxDesc")) === "Partly cloudy · 72° / 50°", "today's line reads 'Partly cloudy · 72° / 50°' (" + norm(await text(A.page, "#wxDesc")) + ")");
    const days = await A.page.evaluate(() => [...document.querySelectorAll(".wx-day")].map((d) => d.textContent.replace(/\s+/g, " ").trim()));
    ok(days.length === 4, "four forecast days after today (" + days.length + ")");
    // Day 1: 66.1/52.7 -> 66/53 with an 80% rain chance shown; day 2's 0% chance is not shown.
    ok(/66° 53°\s*80%/.test(days[0] || "") && !/%/.test(days[1] || ""), "tomorrow 66°/53° shows its 80% rain chance; a 0% day shows none (" + days.slice(0, 2).join(" / ") + ")");

    console.log("\nB. Calendar");
    // Spans are separate boxes on screen, so join them with a space (textContent would glue
    // "All day" to the title and the check would fail on copy that is plainly on screen).
    const cal = await A.page.evaluate(() => [...document.querySelectorAll("#calList .ev, #calList .ev-day")].map((e) => (e.children.length ? [...e.children].map((c) => c.textContent).join(" ") : e.textContent).replace(/\s+/g, " ").trim()));
    ok(cal.some((l) => /^All day Grandma visiting$/.test(l)), "the all-day event shows as 'All day' (" + cal.join(" | ") + ")");
    ok(cal.some((l) => /Soccer practice$/.test(l) && /\d{1,2}:\d{2} (am|pm)/.test(l)), "the later timed event shows with its time");
    ok(!cal.some((l) => /already over/.test(l)), "an event that already ended today is gone");
    ok(cal.includes("Tomorrow") && cal.some((l) => /Vet for the goats/.test(l)), "tomorrow's event shows under 'Tomorrow' while today has room");
    const allDayIx = cal.findIndex((l) => /Grandma/.test(l)), soccerIx = cal.findIndex((l) => /Soccer/.test(l));
    ok(allDayIx >= 0 && allDayIx < soccerIx, "all-day comes before the timed events of the same day");

    console.log("\nC. Chores and the animal-care rota");
    const care = await A.page.evaluate(() => [...document.querySelectorAll("#care span")].map((c) => c.textContent));
    ok(care.join(" | ") === "Morning: Kreussers | Night: Joy", "today's rota: Kreussers in the morning, Joy tonight (" + care.join(" | ") + ")");
    const ch = await A.page.evaluate(() => [...document.querySelectorAll("#choreList .chore")].map((c) => ({ t: c.querySelector(".nm").textContent, done: c.classList.contains("done"), by: (c.querySelector(".by") || {}).textContent || "" })));
    ok(!ch.some((c) => c.t === "Close the barn"), "the night chore is off the list because Joy has tonight");
    ok(ch.length === 3 && ch[0].t === "Collect eggs" && !ch[0].done, "three chores on duty, the open one first (" + ch.map((c) => c.t + (c.done ? "*" : "")).join(", ") + ")");
    ok(ch.some((c) => c.t === "Feed the goats" && c.done && c.by === "Emma"), "done today shows who did it (Emma)");
    ok(ch.some((c) => c.t === "Water the garden" && c.done && c.by === "Sam"), "legacy lastPeriod/lastBy still counts as done (Sam)");
    ok(norm(await text(A.page, ".chore-sum")) === "2 of 3 done", "summary reads '2 of 3 done' (" + norm(await text(A.page, ".chore-sum")) + ")");
    ok(!ch.some((c) => c.t === "Collect eggs" && c.done), "a doneLog from an old period does not count today");

    console.log("\nD. GFFL strip");
    ok(norm(await text(A.page, "#gfflTitle")) === "GFFL · Week 3", "title is 'GFFL · Week 3'");
    const mus = await A.page.evaluate(() => [...document.querySelectorAll(".mu")].map((m) => ({ teams: [...m.querySelectorAll(".tm")].map((t) => [t.querySelector(".nm").textContent, t.querySelector(".pts").textContent]), meta: m.querySelector(".meta").textContent.replace(/\s+/g, " ").trim() })));
    ok(mus.length === 4, "four matchups on the strip (" + mus.length + ")");
    const mine = mus.find((m) => m.teams.some((t) => t[0] === exp.name));
    const shownPts = mine ? Number(mine.teams.find((t) => t[0] === exp.name)[1]) : NaN;
    ok(exp.inGame > 0 && exp.pts > 0, "fixture sanity: team 1 has " + exp.inGame + " starters in ATL @ GB scoring " + exp.pts);
    ok(mine && Math.abs(shownPts - Math.round(exp.pts * 10) / 10) < 0.051, exp.name + " shows " + shownPts + ", the engine's " + exp.pts + " to one decimal");
    ok(mine && mine.teams.some((t) => t[0] === exp.opp), "paired with the week-3 schedule's opponent (" + exp.opp + ")");
    ok(mine && /^In progress/.test(mine.meta) && /Proj/.test(mine.meta), "a matchup with points and games still to come reads 'In progress' with a projection (" + (mine && mine.meta) + ")");
    const summaries = A.seen.filter((u) => /summary\?event=/.test(u));
    ok(summaries.length >= 1 && summaries.every((u) => /401872948/.test(u)), "only the started game's summary was fetched, not the pregame one (" + summaries.length + ")");

    console.log("\nE. Remote-control navigation and launching");
    await A.page.keyboard.press("ArrowRight");
    ok((await active(A.page)) === "yttv", "Right moves to YouTube TV");
    await A.page.keyboard.press("ArrowRight");
    ok((await active(A.page)) === "redzone", "Right again moves to RedZone");
    await A.page.keyboard.press("ArrowRight");
    ok((await active(A.page)) === "redzone", "Right at the end of the row stays put");
    await A.page.keyboard.press("Enter");
    let calls = await A.page.evaluate(() => window.__calls.slice());
    ok(calls.length === 1 && calls[0][0] === "launch" && calls[0][1] === "com.google.android.youtube.tvunplugged", "RedZone with no link set opens YouTube TV (" + JSON.stringify(calls) + ")");
    ok(await shown(A.page, "#toast") && /RedZone isn't linked yet/.test(await text(A.page, "#toast")), "…and says the RedZone link isn't set yet");
    await A.page.keyboard.press("ArrowLeft"); await A.page.keyboard.press("ArrowLeft");
    await A.page.keyboard.press("Enter");
    calls = await A.page.evaluate(() => window.__calls.slice());
    ok(calls[1] && calls[1][1] === "com.amazon.amazonvideo.livingroom", "Enter on Prime Video launches its Android TV package");
    await A.page.keyboard.press("ArrowDown");
    const apps = await A.page.evaluate(() => [...document.querySelectorAll("#appsRow .tile")].map((t) => t.dataset.pkg || t.dataset.act));
    ok((await active(A.page)).startsWith("app:"), "Down from the Watch row lands in Apps (" + (await active(A.page)) + ")");
    ok(!apps.includes("com.amazon.amazonvideo.livingroom") && !apps.includes("com.google.android.youtube.tvunplugged"), "Apps leaves out the two already featured");
    ok(apps.includes("com.netflix.ninja") && apps[apps.length - 1] === "settings", "Apps lists the TV's other apps and ends with TV settings (" + apps.join(", ") + ")");
    ok(await shown(A.page, "#appsSec") && await A.page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), "the focused Apps tile is scrolled fully into view");
    for (let i = 0; i < 10; i++) await A.page.keyboard.press("ArrowRight");
    ok((await active(A.page)) === "settings", "Right walks the Apps row to TV settings");
    await A.page.keyboard.press("Enter");
    calls = await A.page.evaluate(() => window.__calls.slice());
    ok(calls[calls.length - 1][0] === "settings", "Enter on TV settings opens the TV's settings");
    await A.page.keyboard.press("ArrowLeft");
    ok((await active(A.page)) === "app:com.example.gone", "Left steps back one tile");
    await A.page.keyboard.press("Enter");
    ok(/isn't installed/.test(await text(A.page, "#toast")), "an app that won't launch says so instead of doing nothing");
    await A.page.keyboard.press("ArrowUp");
    ok(["prime", "yttv", "redzone"].includes((await active(A.page)).split(":")[0]), "Up returns to the Watch row (" + (await active(A.page)) + ")");
    ok(await A.page.evaluate(() => document.getElementById("home").scrollTop === 0), "…scrolled back to the top so the clock is visible");
    await A.page.evaluate(() => window.dispatchEvent(new Event("buckytv-home")));
    ok((await active(A.page)) === "prime", "the wrapper's Home event puts focus back on the first tile");

    console.log("\nF. Layout at the TV's 960x540");
    const lay = await A.page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      const watch = [...document.querySelectorAll("#watchRow .tile")].map((t) => t.getBoundingClientRect());
      const panels = [...document.querySelectorAll(".panel, .mu")].map((p) => p.getBoundingClientRect());
      // Ink, not boxes: the clock's own text, measured with a Range.
      const rg = document.createRange(); rg.selectNodeContents(document.getElementById("clock"));
      const clockInk = rg.getBoundingClientRect();
      const wx = document.getElementById("wx").getBoundingClientRect();
      return { vw, vh, docW: document.documentElement.scrollWidth, watchBottom: Math.max(...watch.map((r) => r.bottom)), watchRight: Math.max(...watch.map((r) => r.right)),
        panelRight: Math.max(...panels.map((r) => r.right)), clockH: clockInk.height, wxRight: wx.right, todayBottom: document.querySelector(".today").getBoundingClientRect().bottom };
    });
    ok(lay.docW <= lay.vw, "no horizontal overflow (" + lay.docW + " <= " + lay.vw + ")");
    ok(lay.watchRight <= lay.vw && lay.panelRight <= lay.vw && lay.wxRight <= lay.vw, "Watch tiles, panels and weather sit inside the width");
    ok(lay.watchBottom < lay.vh, "the Watch row is on screen without scrolling (" + Math.round(lay.watchBottom) + " < " + lay.vh + ")");
    ok(lay.todayBottom <= lay.vh, "Today (calendar + chores) is on the first screen too (" + Math.round(lay.todayBottom) + " <= " + lay.vh + ")");
    // 1rem = 960/120 = 8 CSS px here; the clock is 6rem = 48 px type, i.e. 96 device px on the TV.
    ok(lay.clockH >= 40, "the clock's ink is TV-sized (" + Math.round(lay.clockH) + " CSS px at 960 wide)");
    if (SHOT) await A.page.screenshot({ path: path.join(SHOTS, "tv-960.png") });
    ok(A.escaped.filter((u) => !NOISE.test(u)).length === 0, "nothing left the mocks (" + A.escaped.filter((u) => !NOISE.test(u)).join(", ") + ")");
    await A.ctx.close();

    /* ---- G · idle screen ------------------------------------------------------------ */
    console.log("\nG. Idle screen");
    const G = await newPage(browser, { width: 960, height: 540, deviceScaleFactor: 1 }, { bridge: true });
    await boot(G.page, "?week=3&idle=1");
    await G.page.waitForFunction(() => !document.getElementById("idle").hidden, { timeout: 5000 }).catch(() => {});
    ok(await shown(G.page, "#idle"), "after the idle time the photo screen covers the page");
    const ph = await G.page.evaluate(() => ({ bg: document.querySelector("#idle .ph.on .im")?.style.backgroundImage || "", cap: document.getElementById("idleCap").textContent, line: document.getElementById("idleLine").textContent }));
    ok(/data:image\/jpeg/.test(ph.bg) && ["Daisy", "Pepper"].includes(ph.cap), "it shows a goat photo with the goat's name (" + ph.cap + ")");
    ok(/62° partly cloudy/.test(ph.line) && /Soccer practice at/.test(ph.line), "the corner line has the weather and the next event (" + ph.line + ")");
    const n = await G.page.evaluate(async () => { const seen = new Set(); for (let i = 0; i < 6; i++) { showSlide(); seen.add(document.getElementById("idleCap").textContent); } return [...seen].sort().join(","); });
    ok(n === "Daisy,Pepper", "the slideshow cycles both goats' photos, a goat with none is skipped (" + n + ")");
    await G.page.keyboard.press("Enter");
    ok(!(await shown(G.page, "#idle")), "any button wakes the home screen");
    ok((await G.page.evaluate(() => window.__calls.length)) === 0, "…and that wake-up press launched nothing");
    await G.page.evaluate(() => startIdle());
    await sleep(50);
    await G.page.evaluate(() => window.dispatchEvent(new Event("buckytv-back")));
    ok(!(await shown(G.page, "#idle")), "Back on the remote also leaves the photo screen");
    if (SHOT) { await G.page.evaluate(() => startIdle()); await sleep(1700); await G.page.screenshot({ path: path.join(SHOTS, "tv-idle.png") }); }
    await G.ctx.close();

    /* ---- H · a plain browser (no wrapper) ------------------------------------------- */
    console.log("\nH. Desktop browser preview at 1920x1080, no wrapper");
    const H = await newPage(browser, { width: 1920, height: 1080, deviceScaleFactor: 1 });
    await boot(H.page);
    ok(H.errors.length === 0, "no page errors (" + H.errors.join(" | ") + ")");
    ok(!(await shown(H.page, "#appsSec")), "no Apps row without the wrapper (geometry, not the attribute)");
    await H.page.keyboard.press("Enter");
    ok((await H.page.evaluate(() => window.__opened[0])) === "https://www.primevideo.com", "Prime Video falls back to its website");
    const hl = await H.page.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: innerWidth, gffl: document.getElementById("gfflSec").getBoundingClientRect().bottom, vh: innerHeight }));
    ok(hl.docW <= hl.vw && hl.gffl <= hl.vh, "everything through the GFFL strip fits one 1080p screen (" + Math.round(hl.gffl) + " <= " + hl.vh + ")");
    if (SHOT) await H.page.screenshot({ path: path.join(SHOTS, "tv-1920.png") });
    await H.ctx.close();

    /* ---- J · picking up a new deploy -------------------------------------------------- */
    console.log("\nJ. A new deploy reaches the TV without a restart");
    const site = { deployed: false, down: false, docLoads: 0 };
    const J = await newPage(browser, { width: 960, height: 540, deviceScaleFactor: 1 }, { bridge: true, site });
    await boot(J.page, "?week=3&check=1&idle=600");
    await J.page.evaluate(() => { window.__mark = 1; });
    await sleep(2500);
    ok(await J.page.evaluate(() => window.__mark === 1 && typeof updatePending !== "undefined" && updatePending === false), "nothing deployed: no update pending, no reload");
    site.down = true;
    await sleep(2500);
    ok(await J.page.evaluate(() => window.__mark === 1 && typeof updatePending !== "undefined" && updatePending === false), "the site briefly failing (503) is not mistaken for a new version");
    site.down = false;
    site.deployed = true;
    await sleep(2500);
    ok(await J.page.evaluate(() => typeof updatePending !== "undefined" && updatePending === true), "after a deploy the page notices within one check");
    ok(await J.page.evaluate(() => window.__mark === 1) && site.docLoads === 1, "…but does not reload while someone may be using it");
    await Promise.all([J.page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => null), J.page.evaluate(() => startIdle())]);
    await J.page.waitForFunction(() => document.querySelector("#calList .ev"), { timeout: 10000 }).catch(() => {});
    ok(site.docLoads === 2 && (await J.page.evaluate(() => window.__mark)) === undefined, "when the idle screen comes up it reloads into the new version (" + site.docLoads + " loads)");
    ok(/deploy 2/.test(await J.page.content()), "the reloaded page is the new deploy");
    await sleep(2500);
    ok(site.docLoads === 2 && (await J.page.evaluate(() => updatePending === false)), "the new version doesn't keep reloading itself");
    ok(J.errors.length === 0, "no page errors (" + J.errors.join(" | ") + ")");
    await J.ctx.close();

    /* ---- I · upstreams down ---------------------------------------------------------- */
    console.log("\nI. Everything upstream failing");
    const I = await newPage(browser, { width: 960, height: 540, deviceScaleFactor: 1 }, { bridge: true });
    I.page.removeAllListeners("request");
    I.page.on("request", (req) => (req.url().startsWith(BASE) && !req.url().includes("/.netlify/") ? req.continue() : req.abort()));
    await I.page.goto(BASE + "/tv.html", { waitUntil: "domcontentloaded" });
    await sleep(1500);
    ok(I.errors.length === 0, "no page errors with every upstream down (" + I.errors.join(" | ") + ")");
    ok(/Couldn't reach the calendar/.test(await text(I.page, "#calList")) && /Couldn't load chores/.test(await text(I.page, "#choreList")), "calendar and chores say they couldn't load");
    ok(!(await shown(I.page, "#wx")) && !(await shown(I.page, "#gfflSec")), "weather and GFFL stay hidden rather than showing blanks");
    ok((await active(I.page)) === "prime", "the Watch tiles still work offline");
    await I.ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  console.log("\n" + pass + "/" + (pass + fails.length) + " passed" + (fails.length ? "\nFAILED:\n  - " + fails.join("\n  - ") : ""));
  process.exit(fails.length ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
