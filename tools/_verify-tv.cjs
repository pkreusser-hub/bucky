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

// Goat photos are JPEG data URLs on the goat doc, resized to 500 px wide by index.html.
const JPEG = (i) => "data:image/jpeg;base64," + fs.readFileSync(path.join(__dirname, "fixtures", "tv", "goat-" + i + ".jpg")).toString("base64");
const GOATS = [
  { id: "g1", name: "Daisy", frequency: "goathooves", photos: [JPEG(0), JPEG(1)] },
  { id: "g2", name: "Pepper", frequency: "goathooves", photo: JPEG(2) },
  { id: "g3", name: "No Photo Yet", frequency: "goathooves" },
];

// Calendar for the week: a timed event later today, one that already ended, an all-day one,
// one tomorrow, a three-day all-day trip starting in 3 days, and one 9 days out that the real
// function would not return for a 7-day window (the mock applies the same range).
const minsToMidnight = (dayAt(1, 0) - NOW) / 60000;
const LATER = new Date(NOW.getTime() + Math.max(2, Math.min(90, minsToMidnight / 2)) * 60000);
const ENDED_START = new Date(Math.max(dayAt(0, 0).getTime(), NOW.getTime() - 3 * 3600e3));
const ENDED_END = new Date(NOW.getTime() - 60e3);
const EVENTS = [
  { id: "e1", title: "Soccer practice", start: LATER.toISOString(), end: new Date(LATER.getTime() + 3600e3).toISOString(), allDay: false },
  { id: "e2", title: "Dentist (already over)", start: ENDED_START.toISOString(), end: ENDED_END.toISOString(), allDay: false },
  { id: "e3", title: "Grandma visiting", start: TODAY, end: keyOf(dayAt(1, 0)), allDay: true },
  { id: "e4", title: "Vet for the goats", start: dayAt(1, 10).toISOString(), end: dayAt(1, 11).toISOString(), allDay: false },
  { id: "e5", title: "Camping trip", start: keyOf(dayAt(3, 0)), end: keyOf(dayAt(6, 0)), allDay: true },
  { id: "e6", title: "Too far out", start: dayAt(9, 9).toISOString(), end: dayAt(9, 10).toISOString(), allDay: false },
];
// Overlap with [timeMin, timeMax), the way Google Calendar's list answers.
const evRange = (ev) => ev.allDay ? [new Date(ev.start + "T00:00:00"), new Date(ev.end + "T00:00:00")] : [new Date(ev.start), new Date(ev.end)];

const WX = {
  current: { time: "2026-10-20T19:00", temperature_2m: 61.6, weather_code: 2 },
  daily: {
    time: [0, 1, 2, 3, 4, 5, 6].map((i) => keyOf(dayAt(i, 0))),
    weather_code: [2, 61, 0, 3, 95, 71, 45],
    temperature_2m_max: [72.4, 66.1, 70.0, 68.5, 64.2, 38.6, 55.5],
    temperature_2m_min: [50.2, 52.7, 48.9, 47.0, 45.5, 28.4, 41.0],
    precipitation_probability_max: [5, 80, 0, 20, 65, 40, 10],
  },
};

const SUMMARY = JSON.parse(fs.readFileSync(path.join(FIX, "atl-gb-w3-summary.json"), "utf8"));
const espnEvent = (id, away, home, state) => ({
  id, date: "2026-09-21T17:00Z", status: { type: { state, completed: state === "post" }, period: state === "pre" ? 0 : 4, displayClock: "0:00" },
  competitions: [{ id, status: { type: { state } }, competitors: [{ homeAway: "home", team: { abbreviation: home } }, { homeAway: "away", team: { abbreviation: away } }], broadcasts: [{ names: ["FOX"] }] }],
});
const BOARD = { events: [espnEvent("401872948", "ATL", "GB", "post"), espnEvent("401872999", "KC", "BUF", "pre")] };

// This week's games for the MNF and SNF tiles (ESPN's default scoreboard, no week). Kickoffs are
// set in Central time, the TV's zone: the next Sunday at 7:20 pm and Monday at 7:15 pm. Decoys:
// last week's Sunday night game (final, so skipped) and a Sunday 3:25 pm game (not a night game).
const centralYmd = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d);
const centralDow = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(d);
function centralAt(ymd, hh, mm) {
  for (const off of ["-05:00", "-06:00"]) {
    const d = new Date(ymd + "T" + pad(hh) + ":" + pad(mm) + ":00" + off);
    const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(d));
    if (h === hh) return d;
  }
  throw new Error("no Central instant for " + ymd);
}
function nextCentral(dow) { for (let i = 0; i < 8; i++) { const d = new Date(NOW.getTime() + i * 864e5); if (centralDow(d) === dow) return centralYmd(d); } }
const nightEvent = (id, at, away, home, state, net) => ({
  id, date: at.toISOString(), status: { type: { state, completed: state === "post" } },
  competitions: [{ id, status: { type: { state } }, competitors: [{ homeAway: "home", team: { abbreviation: home } }, { homeAway: "away", team: { abbreviation: away } }], broadcasts: [{ names: [net] }] }],
});
const SUN = nextCentral("Sun"), MON = nextCentral("Mon");
const NIGHT_BOARD = { events: [
  nightEvent("900", new Date(centralAt(SUN, 19, 20).getTime() - 7 * 864e5), "PHI", "DAL", "post", "NBC"),
  nightEvent("901", centralAt(SUN, 15, 25), "DEN", "LV", "pre", "CBS"),
  nightEvent("902", centralAt(SUN, 19, 20), "KC", "BUF", "pre", "NBC"),
  nightEvent("903", centralAt(MON, 19, 15), "DAL", "NYG", "pre", "ESPN"),
] };

// TVmaze /shows/<id>/images, in the API's shape. Voyager (492): two backgrounds, neither main,
// so the rule takes the one nearest 1920 wide; a poster that is main must be ignored (portrait).
// TNG (491): a main background at 1280 wins over a 1920 one that isn't main.
const tvImg = (id, type, main, w, h) => ({ id, type, main, resolutions: { original: { url: "https://static.tvmaze.com/uploads/images/original_untouched/9/" + id + ".jpg", width: w, height: h } } });
const TVMAZE = {
  492: [tvImg(907309, "poster", true, 680, 1000), tvImg(907310, "background", false, 3840, 2160), tvImg(556981, "background", false, 1920, 1080)],
  491: [tvImg(556352, "background", false, 1920, 1080), tvImg(756780, "background", true, 1280, 720), tvImg(756776, "banner", false, 758, 140)],
};
const ART_WANT = { voyager: "https://static.tvmaze.com/uploads/images/original_untouched/9/556981.jpg", tng: "https://static.tvmaze.com/uploads/images/original_untouched/9/756780.jpg" };

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
    // Goat photos are data: URLs inside the Firestore reply; loading one never leaves the page.
    if (url.startsWith("data:")) return req.continue();
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
        if (opts.cal) opts.cal.push(b);
        const t0 = new Date(b.timeMin), t1 = new Date(b.timeMax);
        return json({ events: EVENTS.filter((ev) => { const [a, z] = evRange(ev); return a < t1 && z > t0; }) });
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
          const src = val === "goathooves" ? GOATS : [];
          const rows = src.map((c) => { const { id, ...rest } = c; return row(coll, id, rest); });
          return json(rows.length ? rows : [{ readTime: new Date().toISOString() }]);
        }
        if (coll === "gffl_fam2jan2g") return json(JSON.parse(fs.readFileSync(path.join(FIX, "fs-teams.json"), "utf8")));
        return json([{ readTime: new Date().toISOString() }]);
      }
      const m = url.match(/documents\/([^?]+)/);
      const p = m ? decodeURIComponent(m[1]) : "";
      if (p.startsWith("gffl_fam2jan2g/")) {
        const f = fsDocFile(p.split("/")[1]);
        if (f) return json(JSON.parse(fs.readFileSync(f, "utf8")));
      }
      return json({ error: { code: 404, message: "No document to update", status: "NOT_FOUND" } }, 404);
    }
    if (/api\.open-meteo\.com/.test(url)) return json(WX);
    // Channel logos (Wikimedia) and show art (TVmaze), or their failures when the test asks.
    if (/^https:\/\/upload\.wikimedia\.org\//.test(url)) {
      if (opts.logosDown) return req.respond({ status: 404, contentType: "text/html", body: "Not Found" });
      return req.respond({ status: 200, contentType: "image/png", body: fs.readFileSync(path.join(ROOT, "bucky.png")) });
    }
    if (/^https:\/\/api\.tvmaze\.com\/shows\/(\d+)\/images/.test(url)) {
      if (opts.tvmaze) opts.tvmaze.push(url);
      if (opts.tvmazeDown) return json({ name: "Service Unavailable" }, 503);
      return json(TVMAZE[url.match(/shows\/(\d+)/)[1]] || []);
    }
    if (/^https:\/\/static\.tvmaze\.com\//.test(url)) return req.respond({ status: 200, contentType: "image/jpeg", body: fs.readFileSync(path.join(__dirname, "fixtures", "tv", "goat-0.jpg")) });
    if (/site\.api\.espn\.com\/.*\/scoreboard/.test(url)) return json(/week=/.test(url) ? BOARD : NIGHT_BOARD);
    if (/site\.api\.espn\.com\/.*\/summary\?event=401872948/.test(url)) return json(SUMMARY);
    if (/api\.sleeper\.com/.test(url)) return json([]);
    escaped.push(url);
    return req.abort();
  });
  await page.evaluateOnNewDocument((withBridge, bridgeV2, homeOn, bannerUrl) => {
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
        banner: () => bannerUrl || "",
      };
      // Version 2 of the app adds the Home-button setup (HomeWatcher). Version 1 has neither
      // method, which is what a TV still running the first install exposes.
      if (bridgeV2) {
        window.__homeOn = !!homeOn;
        window.BuckyTV.version = () => 2;
        window.BuckyTV.homeOverride = () => window.__homeOn;
        window.BuckyTV.openAccessibilitySettings = () => { window.__calls.push(["accessibility"]); return true; };
      }
    }
  }, !!opts.bridge, !!opts.v2, !!opts.homeOn, opts.banners ? "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "bucky.png")).toString("base64") : "");
  return { page, ctx, errors, escaped, seen };
}
const NOISE = /fonts\.g|Failed to load resource|ERR_FAILED/i;

async function boot(page, query) {
  await page.goto(BASE + "/tv.html" + (query || "?week=3"), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.getElementById("gfflSec").hidden && !document.getElementById("wx").hidden && document.querySelector("#calList .ev") && document.getElementById("goatCap").textContent && /·/.test(document.querySelector('[data-show="snf"] [data-sub]').textContent), { timeout: 15000 });
  await sleep(150);
}
const active = (page) => page.evaluate(() => { const a = document.activeElement; return a ? (a.dataset.show || a.dataset.act || "") + (a.dataset.pkg ? ":" + a.dataset.pkg : "") : ""; });
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
    const calReqs = [];
    const A = await newPage(browser, { width: 960, height: 540, deviceScaleFactor: 2 }, { bridge: true, cal: calReqs });
    await boot(A.page);
    ok(A.errors.length === 0, "no page errors (" + A.errors.join(" | ") + ")");
    ok((await active(A.page)) === "prime", "Prime Video has focus on open (" + (await active(A.page)) + ")");
    ok(!(await shown(A.page, "#homeSetup")), "an app from before version 2 (no homeOverride) gets no Home setup tile");
    ok(/^\d{1,2}:\d{2}$/.test(await text(A.page, "#clock")), "the clock shows the time (" + (await text(A.page, "#clock")) + ")");

    console.log("\nA2. The week's weather");
    // Each card's lines joined with a space, as read on screen (the day name is its own line).
    const days = await A.page.evaluate(() => [...document.querySelectorAll(".wx-day")].map((d) => [...d.children].map((c) => c.textContent.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ")));
    const wd = (i) => dayAt(i, 12).toLocaleDateString("en-US", { weekday: "short" });
    ok(days.length === 7, "seven days of weather (" + days.length + ")");
    // Hand-computed from the fixture: now 61.6 -> 62; tomorrow 66.1/52.7 -> 66/53 at 80%; day 2 is 0%.
    ok(days[0] === "Today 62° now", "today shows the temperature now ('" + days[0] + "')");
    ok(days[1] === wd(1) + " 66° 53° 80% rain", "tomorrow reads '" + wd(1) + " 66° 53° 80% rain' ('" + days[1] + "')");
    ok(days[2] === wd(2) + " 70° 49°", "a 0% day shows no rain line ('" + days[2] + "')");
    ok(days[5] === wd(5) + " 39° 28° 40% rain", "day 5: 38.6/28.4 -> 39/28, 40% ('" + days[5] + "')");
    ok(days[6] === wd(6) + " 56° 41°", "day 6: 55.5 rounds to 56; 10% is under the 30% shown ('" + days[6] + "')");

    console.log("\nB. This week's calendar");
    const req = calReqs[0] || {};
    ok(req.timeMin === dayAt(0, 0).toISOString() && req.timeMax === dayAt(7, 0).toISOString(), "it asks for today's midnight to 7 days on (" + req.timeMin + " .. " + req.timeMax + ")");
    // Each row as on screen: a day heading, or "when what" (spans joined with a space;
    // textContent alone would glue "All day" to the title).
    const calRows = () => A.page.evaluate(() => [...document.querySelectorAll("#calList > *")].map((e) => (e.classList.contains("ev") ? [...e.children].map((c) => c.textContent).join(" ") : e.textContent).replace(/\s+/g, " ").trim()));
    const cal = await calRows();
    const d3 = dayAt(3, 12).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const thru = "Thru " + dayAt(5, 12).toLocaleDateString("en-US", { weekday: "short" });
    const soccer = cal.find((l) => /Soccer practice$/.test(l)) || "";
    const want = ["Today", "All day Grandma visiting", soccer, "Tomorrow", "10:00 am Vet for the goats", d3, thru + " Camping trip"];
    ok(JSON.stringify(cal) === JSON.stringify(want), "grouped by day: " + cal.join(" | "));
    ok(/^\d{1,2}:\d{2} (am|pm) Soccer practice$/.test(soccer), "a timed event shows its time (" + soccer + ")");
    ok(!cal.some((l) => /already over|Too far out/.test(l)), "an event already over today, and one past the week, are not listed");
    // Line cap, hand-computed: 6 all-day events today, 6 tomorrow, 3 the day after (15). Today is
    // 1 heading + 6 = 7 lines; Tomorrow's heading + 1 event = 9; one more = 10, the cap. So 8
    // events show and the remaining 7 are counted.
    const capped = await A.page.evaluate((keys) => {
      const saved = calEvents;
      calEvents = [];
      keys.forEach(([k, k2, n]) => { for (let i = 0; i < n; i++) calEvents.push({ id: k + i, title: "Event " + k + " " + i, start: k, end: k2, allDay: true }); });
      renderCalendar();
      const out = { rows: document.querySelectorAll("#calList .cal-day, #calList .ev").length, evs: document.querySelectorAll("#calList .ev").length, more: (document.querySelector("#calList .more") || {}).textContent || "" };
      calEvents = []; renderCalendar(); out.empty = document.getElementById("calList").textContent.trim();
      calEvents = saved; renderCalendar();
      return out;
    }, [[keyOf(dayAt(0, 0)), keyOf(dayAt(1, 0)), 6], [keyOf(dayAt(1, 0)), keyOf(dayAt(2, 0)), 6], [keyOf(dayAt(2, 0)), keyOf(dayAt(3, 0)), 3]]);
    ok(capped.rows === 10 && capped.evs === 8 && capped.more === "+7 more this week", "a busy week stops at 10 lines and counts the rest (" + JSON.stringify(capped) + ")");
    ok(capped.empty === "Nothing on the calendar this week", "an empty week says so");

    console.log("\nC. The goat slideshow");
    const g = await A.page.evaluate(() => ({ bg: document.querySelector("#goats .ph.on .im")?.style.backgroundImage || "", cap: document.getElementById("goatCap").textContent }));
    ok(/data:image\/jpeg/.test(g.bg) && ["Daisy", "Pepper"].includes(g.cap), "a goat photo with the goat's name (" + g.cap + ")");
    const gn = await A.page.evaluate(() => { const seen = new Set(); for (let i = 0; i < 6; i++) { goatSlide(); seen.add(document.getElementById("goatCap").textContent); } return [...seen].sort().join(","); });
    ok(gn === "Daisy,Pepper", "it cycles both goats' photos, and the goat with none is skipped (" + gn + ")");
    ok(await A.page.evaluate(() => document.querySelectorAll("#goats .ph.on").length === 1), "one frame showing at a time (the other fades out)");

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

    console.log("\nD2. The Watch row: two apps, then the shows");
    const row = await A.page.evaluate(() => [...document.querySelectorAll("#watchRow .tile")].filter((t) => t.offsetParent !== null).map((t) => ({ id: t.dataset.show || t.dataset.act, chip: (t.querySelector(".app") || {}).textContent || "", sub: (t.querySelector("[data-sub]") || {}).textContent || "" })));
    ok(row.map((r) => r.id).join(",") === "prime,yttv,redzone,mnf,snf,voyager,tng", "Prime Video, YouTube TV, RedZone, MNF, SNF, Voyager, TNG (" + row.map((r) => r.id).join(",") + ")");
    ok(row.slice(2, 5).every((r) => r.chip === "YouTube TV") && row.slice(5).every((r) => r.chip === "Prime Video"), "each show names the app it opens in");
    // From the fixture's Central kickoffs: next Sunday 7:20 pm KC at BUF, Monday 7:15 pm DAL at NYG.
    // Written short for one line on the tile: no day (the tile names it), no am/pm, "@".
    const sub = (id) => (row.find((r) => r.id === id) || {}).sub;
    ok(sub("snf") === "7:20 · KC @ BUF", "SNF names this week's Sunday night game, skipping the final and the 3:25 game ('" + sub("snf") + "')");
    ok(sub("mnf") === "7:15 · DAL @ NYG", "MNF names Monday's game ('" + sub("mnf") + "')");
    ok(sub("redzone") === "Sundays from noon", "RedZone says when it's on");
    const liveSub = await A.page.evaluate((at) => nightGame([{ date: at, status: { type: { state: "in" } }, competitions: [{ competitors: [{ homeAway: "home", team: { abbreviation: "NYG" } }, { homeAway: "away", team: { abbreviation: "DAL" } }] }] }], "Mon"), centralAt(MON, 19, 15).toISOString());
    ok(liveSub === "On now · DAL @ NYG", "during the game it reads 'On now' ('" + liveSub + "')");
    const noGame = await A.page.evaluate(() => nightGame([], "Mon"));
    ok(noGame === null, "no game in the slot: the tile keeps its network name");

    console.log("\nD3. Logos and show art");
    await A.page.waitForFunction(() => document.querySelectorAll(".t-show.has-logo").length === 3 && document.querySelectorAll(".t-show.has-art").length === 2, { timeout: 8000 }).catch(() => {});
    const pics = await A.page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".t-show")].map((t) => {
      const img = t.querySelector("img");
      return [t.dataset.show, { cls: t.classList.contains("has-logo") ? "logo" : t.classList.contains("has-art") ? "art" : "text", src: img ? img.src : "", w: img ? img.naturalWidth : 0 }];
    })));
    ok(["redzone", "mnf", "snf"].every((id) => pics[id].cls === "logo" && pics[id].w > 0), "RedZone, MNF and SNF show their channel logos (" + ["redzone", "mnf", "snf"].map((id) => pics[id].cls).join(",") + ")");
    ok(/NFL_Network_Redzone\.png$/.test(pics.redzone.src) && /ESPN_wordmark\.svg$/.test(pics.mnf.src) && /NBC_logo\.svg$/.test(pics.snf.src), "each the right logo: RedZone, ESPN, NBC");
    const appTile = (page) => page.evaluate(() => Object.fromEntries(["prime", "yttv"].map((a) => { const t = document.querySelector('[data-act="' + a + '"]'); const lg = t.querySelector("img.logo"), bn = t.querySelector("img.banner"); return [a, { logo: t.classList.contains("has-logo") && lg && lg.naturalWidth > 0 ? lg.src : "", banner: !!bn, label: getComputedStyle(t.querySelector(":scope > span")).display }]; })));
    const at = await appTile(A.page);
    ok(/Amazon_Prime_Video_logo\.svg$/.test(at.prime.logo) && /YouTube_TV_logo\.svg$/.test(at.yttv.logo), "with no app banner from the TV, Prime Video and YouTube TV show their logos (" + [at.prime.logo, at.yttv.logo].map((u) => u.split("/").pop()).join(", ") + ")");
    ok(at.prime.label === "none" && at.yttv.label === "none", "…in place of the text label, which the logo already says");
    ok(pics.voyager.cls === "art" && pics.voyager.src === ART_WANT.voyager, "Voyager: no main background, so the one nearest 1920 wide, not the 4K one or the portrait poster (" + pics.voyager.src.split("/").pop() + ")");
    ok(pics.tng.cls === "art" && pics.tng.src === ART_WANT.tng, "TNG: the main background wins over a wider one that isn't main (" + pics.tng.src.split("/").pop() + ")");
    const picFit = await A.page.evaluate(() => [...document.querySelectorAll(".t-show")].map((t) => {
      const box = (el) => el.getBoundingClientRect(), chip = box(t.querySelector(".app")), tile = box(t);
      const r = document.createRange(); r.selectNodeContents((t.querySelector(".ttl") || t.children[1]).firstChild); const title = r.getBoundingClientRect();
      const logo = t.classList.contains("has-logo") ? box(t.querySelector("img.logo")) : null;
      return { id: t.dataset.show, ok: title.bottom <= tile.bottom && (logo ? logo.top >= chip.bottom && title.top >= logo.bottom : title.top >= chip.bottom) };
    }));
    ok(picFit.every((f) => f.ok), "chip, logo and title stack without touching, inside the tile (" + picFit.filter((f) => !f.ok).map((f) => f.id).join(",") + ")");
    const nameCut = await A.page.evaluate(() => [...document.querySelectorAll(".t-show.has-logo .ttl")].filter((t) => t.scrollWidth > t.clientWidth).map((t) => t.closest(".t-show").dataset.show));
    ok(nameCut.length === 0, "the one-line show name under each logo is not cut short (" + nameCut.join(",") + ")");
    const logoText = await A.page.evaluate(() => { if (!document.querySelector(".t-show.has-logo")) return 0;
      const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const t = document.querySelector(".t-show.has-logo"), bg = rgb(getComputedStyle(t).backgroundColor);
      return Math.min(cr(rgb(getComputedStyle(t.querySelector(".ttl")).color), bg), cr(rgb(getComputedStyle(t.querySelector(".sub")).color), bg), cr(rgb(getComputedStyle(t.querySelector(".app")).color), rgb(getComputedStyle(t.querySelector(".app")).backgroundColor)));
    });
    ok(logoText >= 4.5, "text on the white logo tiles clears 4.5:1 (lowest " + logoText.toFixed(2) + ")");
    if (SHOT) await A.page.screenshot({ path: path.join(SHOTS, "tv-logos-960.png") });

    console.log("\nE. Remote-control navigation and launching");
    await A.page.keyboard.press("ArrowRight");
    ok((await active(A.page)) === "yttv", "Right moves to YouTube TV");
    await A.page.keyboard.press("ArrowRight");
    ok((await active(A.page)) === "redzone", "Right again moves to RedZone");
    await A.page.keyboard.press("Enter");
    let calls = await A.page.evaluate(() => window.__calls.slice());
    // The family's links (2026-10-20): RedZone's YouTube TV channel page, ESPN's and NBC's live
    // streams, Voyager's and TNG's Prime Video pages.
    const YTTV = "com.google.android.youtube.tvunplugged", PRIME = "com.amazon.amazonvideo.livingroom";
    ok(calls.length === 1 && JSON.stringify(calls[0]) === JSON.stringify(["openUrl", "https://tv.youtube.com/browse/UC2P9QOChMRn6kPUpBcjVlWw", YTTV]), "RedZone opens its channel page in YouTube TV (" + JSON.stringify(calls[0]) + ")");
    const linked = [["mnf", "https://tv.youtube.com/watch/PFuNFGzJDE4", YTTV, "MNF opens ESPN in YouTube TV"],
      ["snf", "https://tv.youtube.com/watch/5-T6_ZU9bmA", YTTV, "SNF opens NBC in YouTube TV"],
      ["voyager", "https://www.amazon.com/gp/video/detail/B00C16V4B0", PRIME, "Voyager opens its page in Prime Video"],
      ["tng", "https://www.amazon.com/gp/video/detail/B0CQ7XDXSJ", PRIME, "TNG opens its page in Prime Video"]];
    for (const [id, url, pkg, msg] of linked) {
      await A.page.keyboard.press("ArrowRight");
      await A.page.keyboard.press("Enter");
      calls = await A.page.evaluate(() => window.__calls.slice());
      ok((await active(A.page)) === id && JSON.stringify(calls[calls.length - 1]) === JSON.stringify(["openUrl", url, pkg]), msg + " (" + JSON.stringify(calls[calls.length - 1]) + ")");
    }
    // Every show is linked now, so the "not linked yet" path is exercised by clearing one: a show
    // whose link is removed later must still open its app, not do nothing.
    await A.page.evaluate(() => { SHOWS.find((x) => x.id === "tng").url = ""; });
    await A.page.keyboard.press("Enter");
    calls = await A.page.evaluate(() => window.__calls.slice());
    ok(JSON.stringify(calls[5]) === JSON.stringify(["launch", PRIME]), "a show with no link opens its app (" + JSON.stringify(calls[5]) + ")");
    ok(await shown(A.page, "#toast") && (await text(A.page, "#toast")) === "Star Trek: TNG isn't linked yet. Opening Prime Video.", "…and says the show isn't linked yet");
    ok(await A.page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), "the last tile is fully on screen");
    await A.page.keyboard.press("ArrowRight");
    ok((await active(A.page)) === "tng", "Right at the end of the row stays put");
    for (let i = 0; i < 6; i++) await A.page.keyboard.press("ArrowLeft");
    ok((await active(A.page)) === "prime", "Left walks back to Prime Video");
    await A.page.keyboard.press("Enter");
    calls = await A.page.evaluate(() => window.__calls.slice());
    ok(calls[6] && calls[6][1] === "com.amazon.amazonvideo.livingroom", "Enter on Prime Video launches its Android TV package");
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
    ok(["prime", "yttv", "redzone", "mnf", "snf", "voyager", "tng"].includes((await active(A.page)).split(":")[0]), "Up returns to the Watch row (" + (await active(A.page)) + ")");
    ok(await A.page.evaluate(() => document.getElementById("home").scrollTop === 0), "…scrolled back to the top so the clock is visible");
    await A.page.evaluate(() => window.dispatchEvent(new Event("buckytv-home")));
    ok((await active(A.page)) === "prime", "the wrapper's Home event puts focus back on the first tile");

    console.log("\nF. Layout at the TV's 960x540");
    const lay = await A.page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight, rem = vw / 120;
      const watch = [...document.querySelectorAll("#watchRow .tile")].filter((t) => t.offsetParent !== null).map((t) => t.getBoundingClientRect());
      const boxes = [...document.querySelectorAll(".panel, .goats, .mu, .wx-day")].map((p) => p.getBoundingClientRect());
      // Ink, not boxes: the clock's own text, measured with a Range.
      const rg = document.createRange(); rg.selectNodeContents(document.getElementById("clock"));
      const clockInk = rg.getBoundingClientRect();
      // A show's title must start below its app chip. Measured on the title's own text.
      const clash = [...document.querySelectorAll(".t-show")].filter((t) => {
        const chip = t.querySelector(".app").getBoundingClientRect();
        const r = document.createRange(); r.selectNodeContents((t.querySelector(".ttl") || t.children[1]).firstChild);
        return r.getBoundingClientRect().top < chip.bottom;
      }).map((t) => t.dataset.show);
      const wordInk = (() => { const r = document.createRange(); r.selectNodeContents(document.querySelector(".wordmark").firstChild); return r.getBoundingClientRect(); })();
      const wx = document.getElementById("wx").getBoundingClientRect(), right = document.querySelector(".top .right").getBoundingClientRect();
      return { vw, vh, rem, docW: document.documentElement.scrollWidth, watchBottom: Math.max(...watch.map((r) => r.bottom)), watchRight: Math.max(...watch.map((r) => r.right)),
        boxRight: Math.max(...boxes.map((r) => r.right)), clockH: clockInk.height, clash,
        wxClear: wx.left >= wordInk.right && wx.right <= right.left,
        mark: document.querySelector(".brand .mark").getBoundingClientRect().width,
        weekBottom: document.querySelector(".week").getBoundingClientRect().bottom, gffl: document.getElementById("gfflSec").getBoundingClientRect().bottom };
    });
    ok(lay.docW <= lay.vw, "no horizontal overflow (" + lay.docW + " <= " + lay.vw + ")");
    ok(lay.watchRight <= lay.vw && lay.boxRight <= lay.vw, "all seven Watch tiles, the cards and the weather sit inside the width");
    ok(lay.wxClear, "the weather sits between the wordmark and the clock, overlapping neither");
    ok(lay.clash.length === 0, "no show title runs into its app chip (" + lay.clash.join(",") + ")");
    // Found by looking at the plate after the suite went green: a three-line title pushed the
    // game line out of the MNF tile, and the SNF and TNG lines were cut to "…".
    const fit = await A.page.evaluate(() => [...document.querySelectorAll(".t-show")].map((t) => {
      const tile = t.getBoundingClientRect(), sub = t.querySelector(".sub"), sr = sub.getBoundingClientRect();
      return { id: t.dataset.show, inside: !sub.textContent || sr.bottom <= tile.bottom - 2, whole: sub.scrollWidth <= sub.clientWidth };
    }));
    ok(fit.every((f) => f.inside), "every show's second line sits inside its tile (" + fit.filter((f) => !f.inside).map((f) => f.id).join(",") + ")");
    ok(fit.every((f) => f.whole), "no show's second line is cut short (" + fit.filter((f) => !f.whole).map((f) => f.id).join(",") + ")");
    ok(lay.watchBottom < lay.vh, "the Watch row is on screen without scrolling (" + Math.round(lay.watchBottom) + " < " + lay.vh + ")");
    const safe960 = Math.floor(lay.vh * 0.975);
    ok(lay.weekBottom <= safe960 && lay.gffl <= safe960, "calendar, goats and the GFFL strip all fit the first screen inside a 2.5% overscan margin (" + Math.round(lay.gffl) + " <= " + safe960 + ")");
    // 1rem = 960/120 = 8 CSS px here; the clock is 5.2rem type.
    ok(lay.clockH >= 40, "the clock's ink is TV-sized (" + Math.round(lay.clockH) + " CSS px at 960 wide)");
    // "a larger bucky logo": 6.4rem, against the 3.4rem mark it replaced.
    ok(lay.mark >= 6 * lay.rem, "the Bucky mark is at least 6rem across (" + Math.round(lay.mark) + " px, 6rem = " + 6 * lay.rem + ")");
    if (SHOT) await A.page.screenshot({ path: path.join(SHOTS, "tv-960.png") });

    console.log("\nF2. The Bucky look: brand, legible colours");
    const look = await A.page.evaluate(() => {
      const mark = document.querySelector(".brand .mark");
      const q = (sel) => document.querySelector(sel);
      const fam = (sel) => (q(sel) ? getComputedStyle(q(sel)).fontFamily : "");
      return { markW: mark ? mark.naturalWidth : 0, word: q(".wordmark") ? q(".wordmark").textContent : "",
        hub: /Family Farm Hub/i.test(document.body.innerText), title: document.title,
        fonts: [fam(".clock"), fam(".wordmark"), fam(".panel h2"), fam(".t-show"), fam(".goats .cap")] };
    });
    ok(look.markW === 256, "the Bucky goat mark (bucky.png) loads");
    ok(look.word === "Bucky TV" && look.title === "Bucky TV", "it's called Bucky TV");
    ok(!look.hub, "'Family Farm Hub' is gone from the screen");
    ok(look.fonts.every((f) => /^Fraunces/.test(f)), "clock, wordmark, card titles, show titles and goat names are set in Fraunces");
    // WCAG contrast of the text the family reads from the couch, from computed colours. Text on
    // the page ground is measured against the LIGHTEST point of it: the top of the pine gradient
    // under the 6% cream highlight. Weather text against today's card, the lightest of the seven
    // (12% cream over that). Card text against the card's own cream.
    const pairs = await A.page.evaluate(() => {
      const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const pine = [0x3f, 0x5c, 0x46], ground = pine.map((v) => v * 0.94 + 255 * 0.06), todayCard = ground.map((v) => v * 0.88 + 255 * 0.12);
      const col = (sel) => (document.querySelector(sel) ? rgb(getComputedStyle(document.querySelector(sel)).color) : [255, 255, 255]);
      const cardBg = rgb(getComputedStyle(document.querySelector(".panel")).backgroundColor);
      const out = {};
      for (const sel of [".row-label", ".date", ".gffl-h .note"]) out[sel + " on pine"] = cr(col(sel), ground);
      for (const sel of [".wx-day b", ".wx-day .t", ".wx-day .t span", ".wx-day .pp"]) out[sel + " on today's card"] = cr(col(sel), todayCard);
      for (const sel of [".panel h2", ".ev .when", ".ev .what", ".cal-day", ".mu .meta"]) out[sel + " on cream"] = cr(col(sel), cardBg);
      return out;
    });
    const low = Object.entries(pairs).filter(([, v]) => v < 4.5);
    ok(low.length === 0, "every text colour clears 4.5:1 (lowest " + Object.entries(pairs).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([k, v]) => k + " " + v.toFixed(2)).join(", ") + ")" + (low.length ? " FAILING: " + low.map(([k, v]) => k + " " + v.toFixed(2)).join(", ") : ""));
    ok(A.escaped.filter((u) => !NOISE.test(u)).length === 0, "nothing left the mocks (" + A.escaped.filter((u) => !NOISE.test(u)).join(", ") + ")");
    await A.ctx.close();

    /* ---- G · no screensaver --------------------------------------------------------- */
    // User, 2026-10-20: "get rid of the screensaver view, I just want it to show the bucky tv
    // page at all times". Restaged from the old section G, which checked the photo screen.
    console.log("\nG. No screensaver: the page stays up");
    const G = await newPage(browser, { width: 960, height: 540, deviceScaleFactor: 1 }, { bridge: true });
    await boot(G.page, "?week=3&idle=1");
    await sleep(2500);
    const gs = await G.page.evaluate(() => { const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return { idleEl: !!document.getElementById("idle"), onHome: !!(el && el.closest("#home")), act: document.activeElement.dataset.act }; });
    ok(!gs.idleEl && gs.onHome, "well past the idle time, nothing covers the page (the middle of the screen is still Bucky TV)");
    ok(gs.act === "prime", "focus is where it was");
    await G.page.keyboard.press("ArrowRight");
    ok((await active(G.page)) === "yttv", "the first button press after a quiet spell does its job, it isn't spent waking a screensaver");
    ok(G.errors.length === 0, "no page errors (" + G.errors.join(" | ") + ")");
    await G.ctx.close();

    /* ---- H · a plain browser (no wrapper) ------------------------------------------- */
    console.log("\nH. Desktop browser preview at 1920x1080, no wrapper");
    const H = await newPage(browser, { width: 1920, height: 1080, deviceScaleFactor: 1 });
    await boot(H.page);
    ok(H.errors.length === 0, "no page errors (" + H.errors.join(" | ") + ")");
    ok(!(await shown(H.page, "#appsSec")), "no Apps row without the wrapper (geometry, not the attribute)");
    await H.page.waitForFunction(() => document.querySelectorAll(".t-prime.has-logo, .t-yttv.has-logo").length === 2, { timeout: 8000 }).catch(() => {});
    const ht = await appTile(H.page);
    ok(ht.prime.logo && ht.yttv.logo, "in a browser, Prime Video and YouTube TV show their logos (a web page can't read the TV's apps)");
    await H.page.keyboard.press("Enter");
    ok((await H.page.evaluate(() => window.__opened[0])) === "https://www.primevideo.com", "Prime Video falls back to its website");
    for (let i = 0; i < 3; i++) await H.page.keyboard.press("ArrowRight");
    await H.page.keyboard.press("Enter");
    ok((await H.page.evaluate(() => window.__opened[1])) === "https://tv.youtube.com/watch/PFuNFGzJDE4", "in a browser a linked show (MNF) opens its own link");
    for (let i = 0; i < 3; i++) await H.page.keyboard.press("ArrowRight");
    await H.page.evaluate(() => { SHOWS.find((x) => x.id === "tng").url = ""; });
    await H.page.keyboard.press("Enter");
    ok((await H.page.evaluate(() => window.__opened[2])) === "https://www.primevideo.com", "a Prime Video show with no link falls back to primevideo.com");
    const hl = await H.page.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: innerWidth, gffl: document.getElementById("gfflSec").getBoundingClientRect().bottom, vh: innerHeight }));
    // Some TVs still crop the picture edge (overscan); 2.5% of the height is kept clear below
    // the strip. Restaged with the Farmstead header: "<= the viewport" passed at 1074 of 1080,
    // which a cropping set would cut.
    const safe = Math.floor(hl.vh * 0.975);
    ok(hl.docW <= hl.vw && hl.gffl <= safe, "everything through the GFFL strip fits one 1080p screen inside a 2.5% overscan margin (" + Math.round(hl.gffl) + " <= " + safe + ")");
    if (SHOT) await H.page.screenshot({ path: path.join(SHOTS, "tv-1920.png") });
    await H.ctx.close();

    /* ---- J · picking up a new deploy -------------------------------------------------- */
    console.log("\nK. Making Home open Bucky (app version 2's HomeWatcher)");
    const K = await newPage(browser, { width: 960, height: 540, deviceScaleFactor: 1 }, { bridge: true, v2: true, homeOn: false });
    await boot(K.page);
    ok(K.errors.length === 0, "no page errors (" + K.errors.join(" | ") + ")");
    ok(await shown(K.page, "#homeSetup"), "with the switch still off, a 'Make Home open Bucky' tile shows");
    ok((await active(K.page)) === "prime", "focus still opens on Prime Video, not on the setup tile");
    for (let i = 0; i < 7; i++) await K.page.keyboard.press("ArrowRight");
    ok((await active(K.page)) === "homesetup", "it is the last tile of the Watch row, after the shows");
    // Restaged with the five show tiles (2026-10-20): the Watch row is now full at 960, so the
    // setup tile starts past the right edge. What matters is that reaching it brings it into view.
    // The row scrolls smoothly (scroll-behavior), so measure once the scroll has settled.
    await K.page.waitForFunction(() => { const r = document.getElementById("watchRow"); const v = r.scrollLeft; return new Promise((ok) => setTimeout(() => ok(v > 0 && r.scrollLeft === v), 150)); }, { timeout: 3000 }).catch(() => {});
    ok(await K.page.evaluate(() => { const t = document.getElementById("homeSetup"); if (!t) return false; const r = t.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }), "…and focusing it scrolls it fully on screen (" + await K.page.evaluate(() => { const r = document.getElementById("homeSetup").getBoundingClientRect(); return [r.left, r.right, r.bottom, innerWidth, document.getElementById("watchRow").scrollLeft].map(Math.round).join(","); }) + ")");
    if (SHOT) await K.page.screenshot({ path: path.join(SHOTS, "tv-homesetup.png") });
    await K.page.keyboard.press("Enter");
    ok(JSON.stringify(await K.page.evaluate(() => window.__calls)) === JSON.stringify([["accessibility"]]), "Enter opens the TV's Accessibility settings and launches nothing else");
    // The family flips the switch and comes back: the wrapper's resume event re-checks.
    await K.page.evaluate(() => { window.__homeOn = true; window.dispatchEvent(new Event("buckytv-resume")); });
    ok(!(await shown(K.page, "#homeSetup")), "once it's on, coming back to Bucky hides the tile");
    ok((await active(K.page)) === "prime", "…and focus that was on the tile moves to the first tile instead of vanishing");
    await K.ctx.close();
    const K2 = await newPage(browser, { width: 960, height: 540, deviceScaleFactor: 1 }, { bridge: true, v2: true, homeOn: true, banners: true });
    await boot(K2.page);
    ok(!(await shown(K2.page, "#homeSetup")), "already switched on: no tile at all");
    await sleep(500);
    const kt = await appTile(K2.page);
    ok(kt.prime.banner && kt.yttv.banner && !kt.prime.logo && !kt.yttv.logo, "on a TV whose apps have banners, the tiles use the apps' own banners, not the logos (user's choice, option 1)");
    await K2.ctx.close();

    console.log("\nJ. A new deploy reaches the TV without a restart");
    const site = { deployed: false, down: false, docLoads: 0 };
    const J = await newPage(browser, { width: 960, height: 540, deviceScaleFactor: 1 }, { bridge: true, site });
    // The page counts 3 s without a button press as nobody using it (?idle=3), and checks for a
    // new version every second (?check=1). Restaged when the screensaver went: the reload used to
    // wait for the screensaver to come up; now it waits for the remote to go quiet.
    await boot(J.page, "?week=3&check=1&idle=3");
    await J.page.evaluate(() => { window.__mark = 1; });
    await sleep(2500);
    ok(await J.page.evaluate(() => window.__mark === 1 && typeof updatePending !== "undefined" && updatePending === false), "nothing deployed: no update pending, no reload");
    site.down = true;
    await sleep(2500);
    ok(await J.page.evaluate(() => window.__mark === 1 && typeof updatePending !== "undefined" && updatePending === false), "the site briefly failing (503) is not mistaken for a new version");
    site.down = false;
    // Someone is using the remote: a press every 0.7 s, before and after the deploy lands.
    let pressing = true;
    const presser = (async () => { while (pressing) { await J.page.keyboard.press("ArrowRight").catch(() => {}); await sleep(700); } })();
    await sleep(800);
    site.deployed = true;
    await sleep(3500);
    ok(await J.page.evaluate(() => typeof updatePending !== "undefined" && updatePending === true).catch(() => false), "after a deploy the page notices within one check");
    ok(await J.page.evaluate(() => window.__mark === 1).catch(() => false) && site.docLoads === 1, "…but does not reload while the remote is in use");
    pressing = false;
    await presser;
    await J.page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => null);
    await J.page.waitForFunction(() => document.querySelector("#calList .ev"), { timeout: 10000 }).catch(() => {});
    ok(site.docLoads === 2 && (await J.page.evaluate(() => window.__mark)) === undefined, "once the remote goes quiet it reloads into the new version (" + site.docLoads + " loads)");
    ok(/deploy 2/.test(await J.page.content()), "the reloaded page is the new deploy");
    await sleep(4000);
    ok(site.docLoads === 2 && (await J.page.evaluate(() => updatePending === false)), "the new version doesn't keep reloading itself");
    ok(J.errors.length === 0, "no page errors (" + J.errors.join(" | ") + ")");
    await J.ctx.close();

    console.log("\nL. Pictures unavailable, and kept for a week");
    const L = await newPage(browser, { width: 960, height: 540, deviceScaleFactor: 1 }, { bridge: true, logosDown: true, tvmazeDown: true });
    await boot(L.page);
    await sleep(800);
    const lp = await L.page.evaluate(() => [...document.querySelectorAll(".t-show")].map((t) => ({ id: t.dataset.show, pic: t.classList.contains("has-logo") || t.classList.contains("has-art"), imgs: t.querySelectorAll("img").length, chip: !!t.querySelector(".app"), title: (t.querySelector(".ttl") || t.children[1]).firstChild.textContent })));
    ok(lp.every((t) => !t.pic && t.imgs === 0), "with the logo host and TVmaze both failing, every show tile stays a text tile with no broken image (" + lp.filter((t) => t.pic || t.imgs).map((t) => t.id).join(",") + ")");
    ok(lp.every((t) => t.chip && t.title), "…still naming the show and the app it opens in");
    ok(L.errors.length === 0, "no page errors (" + L.errors.join(" | ") + ")");
    await L.ctx.close();
    const tvReqs = [];
    const L2 = await newPage(browser, { width: 960, height: 540, deviceScaleFactor: 1 }, { bridge: true, tvmaze: tvReqs });
    await boot(L2.page);
    await L2.page.waitForFunction(() => document.querySelectorAll(".t-show.has-art").length === 2, { timeout: 8000 }).catch(() => {});
    const firstAsk = tvReqs.length;
    await L2.page.reload({ waitUntil: "domcontentloaded" });
    await L2.page.waitForFunction(() => document.querySelectorAll(".t-show.has-art").length === 2, { timeout: 8000 }).catch(() => {});
    ok(firstAsk === 2 && tvReqs.length === 2, "TVmaze is asked once per show; a restart within the week uses the kept picture (" + firstAsk + " then " + (tvReqs.length - firstAsk) + ")");
    ok(await L2.page.evaluate((want) => (document.querySelector('[data-show="voyager"] img.art') || {}).src === want, ART_WANT.voyager), "…and shows the same art from it");
    await L2.ctx.close();

    /* ---- I · upstreams down ---------------------------------------------------------- */
    console.log("\nI. Everything upstream failing");
    const I = await newPage(browser, { width: 960, height: 540, deviceScaleFactor: 1 }, { bridge: true });
    I.page.removeAllListeners("request");
    I.page.on("request", (req) => (req.url().startsWith(BASE) && !req.url().includes("/.netlify/") ? req.continue() : req.abort()));
    await I.page.goto(BASE + "/tv.html", { waitUntil: "domcontentloaded" });
    await sleep(1500);
    ok(I.errors.length === 0, "no page errors with every upstream down (" + I.errors.join(" | ") + ")");
    ok(/Couldn't reach the calendar/.test(await text(I.page, "#calList")), "the calendar says it couldn't load");
    const gi = await I.page.evaluate(() => document.querySelector("#goats .ph.on .im")?.style.backgroundImage || "");
    ok(/Goat1\.png|Goat2\.png|logo\.png/.test(gi), "with no goat photos to fetch, the slideshow uses the farm's own pictures (" + gi.slice(0, 40) + ")");
    ok(!/·/.test(await text(I.page, '[data-show="snf"] [data-sub]')), "SNF keeps its network name with no scoreboard");
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
