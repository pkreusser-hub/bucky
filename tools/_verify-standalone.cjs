#!/usr/bin/env node
"use strict";
/**
 * BUCKY standalone-app suite: Bucky News (/news), Shopping (/shop), Work Orders (/workorders),
 * Calendar (/calendar) and Finance (/finance), which are index.html in app mode (html[data-app]),
 * not separate pages. See docs/bucky-app.md, 2026-10-08 (News, Shopping) and 2026-10-09 (the rest).
 *
 *   NODE_PATH=<tools/node_modules> node tools/_verify-standalone.cjs [--shots <dir>] [--only=A,B,...]
 *
 * --only runs just the named sections (letters as in the headings below), for quick iteration.
 * The count quoted in a commit is always the full run.
 *
 * The local server applies the [[redirects]] rewrites it READS FROM netlify.toml, so the path form
 * (/news, /shop/) is exercised through the real config: delete a rewrite and the path tests 404.
 * /.netlify/functions/calendar and /stocks are answered by mocks that return the shapes the real
 * functions return (calendar.mjs: {events} / {event} / {ok} / {error,detail}; stocks.mjs:
 * {series:[...]} / {quotes:[...]}), including the refusals.
 *
 * FIREBASE IS BLOCKED THROUGHOUT (googleapis / firestore / firebase / gstatic). An unblocked run
 * of index.html has twice duplicated the live goat herd. Everything runs on the LOCAL backend
 * (buckyData1 + setting_* in localStorage). push-client.js is replaced by a counting stub so
 * "never registers a push token" is measured, and Notification is a counting fake.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8961;
const BASE = `http://127.0.0.1:${PORT}`;
const shotIdx = process.argv.indexOf("--shots");
const SHOTS = shotIdx > -1 ? path.resolve(process.argv[shotIdx + 1]) : null;
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice(7).split(",").filter(Boolean) : null;
const want = (letter) => !ONLY || ONLY.includes(letter);

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ===================== server: static files + the toml rewrites ===================== */
function tomlRewrites(){
  const t = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8").replace(/\r/g, "");
  const out = [];
  for (const blk of t.split("[[redirects]]").slice(1)){
    const body = blk.split(/\n\[/)[0];
    const g = (k) => { const m = body.match(new RegExp("^\\s*" + k + "\\s*=\\s*\"?([^\"\\n#]+)\"?", "m")); return m ? m[1].trim() : null; };
    out.push({ from: g("from"), to: g("to"), status: Number(g("status")), force: g("force") === "true" });
  }
  return out;
}
const MIME = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript", ".json":"application/json",
  ".css":"text/css", ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml", ".txt":"text/plain",
  ".webmanifest":"application/manifest+json" };
function serve(){
  const rules = tomlRewrites().filter((r) => r.from && r.from.startsWith("/") && r.status === 200);
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      const rule = rules.find((r) => r.from === p);
      if (rule) p = rule.to;
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

/* ============================== fixtures ============================== */
const roster = (deny) => [
  { id:"p_dad",     frequency:"profile", name:"Dad",     email:"dad@example.com",     order:1, pid:"dad",     role:"parent", grant:["seesFit","bankAdminUI","approvePayouts"] },
  { id:"p_grandma", frequency:"profile", name:"Grandma", email:"grandma@example.com", order:2, pid:"grandma", role:"extended" },
  { id:"p_isaac",   frequency:"profile", name:"Isaac",   email:"isaac@example.com",   order:3, pid:"isaac",   role:"kid", deny: deny || [] },
];
const SOURCES = [
  { id:"s1", title:"The Daily Trumpet", url:"https://trumpet.example.com", feedUrl:"https://trumpet.example.com/rss.xml", topic:"US News" },
  { id:"s2", title:"Gazette", url:"https://gazette.example.com", feedUrl:"https://gazette.example.com/atom.xml", topic:"Sports" },
];
const SHOP_ROWS = [
  { id:"sh1", frequency:"shopping", store:"Walmart", name:"Zebra Milk", gotAt:0, gotBy:"", order:1 },
  { id:"sh2", frequency:"shopping", store:"Walmart", name:"Zebra Eggs", gotAt:0, gotBy:"", order:2 },
  { id:"sh3", frequency:"shopping", store:"Costco",  name:"Zebra Towels", gotAt:0, gotBy:"", order:3 },
];
function newsItems(){
  const now = Date.now();
  const mk = (id, sid, st, title, h) => ({ id, sourceId:sid, sourceTitle:st, title, link:"https://example.com/" + id,
    published: now - h * 3600e3, image:"", excerpt: title + ".", summary: title + ".", summarySource:"feed" });
  return [ mk("a1","s1","The Daily Trumpet","Council approves the new bridge",2), mk("a2","s1","The Daily Trumpet","Rain expected all week",5),
           mk("b1","s2","Gazette","Harvest festival returns",9) ];
}
const THEME = "#3f5c46";

/* ---- Work Orders fixture. Dates are relative to the run so the due phrases are computable. ---- */
const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dayAt = (offsetDays, h = 12, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); d.setDate(d.getDate() + offsetDays); return d; };
const woRow = (id, name, who, due, value, extra) => Object.assign({
  id, frequency:"workorder", name, assignees: who, assignee: who[0] || "", due, value, desc: "", photo:"",
  done:false, doneAt:0, doneBy:"", donePhoto:"", progress:0, milestones:[], payoutPending:false,
  createdBy:"Dad", createdAt: Date.now() - 86400000, order: 100 }, extra || {});
const WO_ROWS = [
  woRow("wo1", "Zebra fix fence",   ["Grandma"], ymd(dayAt(1)),  "10", { desc:"Replace two boards" }),   // "due tomorrow", $10
  woRow("wo2", "Zebra sweep porch", ["Grandma"], ymd(dayAt(-3)), ""),                                      // "overdue by 3 days", no money
  woRow("wo3", "Zebra feed goats",  ["Isaac"],   ymd(dayAt(10)), "4"),                                     // Isaac's group (collapsed for Grandma)
  woRow("wo4", "Zebra paint shed",  [],          "",             ""),                                      // unassigned (collapsed)
  woRow("wo5", "Zebra wash tractor",["Isaac"],   ymd(dayAt(2)),  "7", { done:true, doneAt: Date.now() - 3600e3, doneBy:"Isaac", payoutPending:true }),
];
// Counts the Work Orders tab must show for WO_ROWS: open = wo1..wo4 (4) + 1 awaiting payout = 5 active, 0 closed;
// groups = Awaiting payout, Grandma, Isaac, Unassigned (4); cards on screen = the payout card + Grandma's two (3).
const ALL_ROWS = SHOP_ROWS.concat(WO_ROWS);

/* ---- Calendar fixture: 8 timed events today (so the month agenda overflows its card and has a
   "last visible row"), one all-day event tomorrow. ---- */
function calFixture(){
  const evs = [];
  for (let i = 1; i <= 8; i++){
    const s = dayAt(0, 5 + i, 0), e = dayAt(0, 5 + i, 30);
    evs.push({ id:"ev" + i, title:"Zebra event " + i, start: s.toISOString(), end: e.toISOString(), allDay:false, notes: i === 3 ? "Bring the long ladder" : "", seriesId:null, notify:[] });
  }
  evs.push({ id:"evAD", title:"Zebra all-day", start: ymd(dayAt(1)), end: ymd(dayAt(2)), allDay:true, notes:"", seriesId:null, notify:[] });
  return evs;
}
/* The mock mirrors netlify/functions/calendar.mjs: status -> {configured,...}; list -> {events};
   create/update -> {event}; delete -> {ok:true}; a Google refusal is HTTP 200 {error,detail,status};
   a crashed function is HTTP 500. `mode` picks which one the next write gets. */
function makeCalMock(){
  const m = { events: calFixture(), mode:"ok", log:[], configured:true };
  m.handle = (bodyRaw) => {
    let b = {}; try { b = JSON.parse(bodyRaw || "{}"); } catch {}
    m.log.push(b);
    const a = b.action, ev = b.event || {};
    if (a === "status") return { body:{ configured:m.configured, saEmail:"bucky@example.iam.gserviceaccount.com", hasServiceAccount:true, hasCalendarId:m.configured } };
    if (!m.configured) return { body:{ error:"not-configured" } };
    if (a === "list") return { body:{ events: m.events } };
    if (a === "create" || a === "update" || a === "delete"){
      if (m.mode === "google-error") return { body:{ error:"google-error", detail:"Insufficient permission to edit this calendar", status:403 } };
      if (m.mode === "http500") return { status:500, body:{ error:"Function crashed" } };
      if (a === "delete") { m.events = m.events.filter((e) => e.id !== ev.id); return { body:{ ok:true } }; }
      const n = { id: ev.id || "new" + (m.log.length), title: ev.title || "", start: ev.allDay ? ev.startDate : ev.start,
        end: ev.allDay ? (ev.endDate || ev.startDate) : ev.end, allDay: !!ev.allDay, notes: ev.notes || "", seriesId:null, notify: Array.isArray(ev.notify) ? ev.notify : [] };
      m.events = m.events.filter((e) => e.id !== n.id).concat(n);
      return { body:{ event:n } };
    }
    if (a === "get") return { body:{ event: m.events.find((e) => e.id === ev.id) || null } };
    return { status:400, body:{ error:"unknown action" } };
  };
  return m;
}

/* The mock mirrors netlify/functions/stocks.mjs: action "series" -> {series:[{symbol,ok,name,price,
   day/week/month:{abs,pct},closes:[{t,c}]}]} (a bad ticker is {symbol,ok:false,reason}); action
   "quote" -> {quotes:[...]}; a wrong family password is HTTP 401 {error}. */
const STOCK_FX = {
  "^GSPC": { name:"S&P 500", price:5555.55, dayPct:1.23, weekPct:2.10, monthPct:3.40 },
  "^DJI":  { name:"Dow Jones Industrial Average", price:40012.34, dayPct:-0.62, weekPct:-1.05, monthPct:0.75 },
  "CL=F":  { name:"Crude Oil WTI", price:78.42, dayPct:0.55, weekPct:-2.30, monthPct:4.10 },
  AAPL:    { name:"Apple Inc.", price:214.32, dayPct:0.88, weekPct:1.95, monthPct:-0.55 },
  MSFT:    { name:"Microsoft Corporation", price:431.09, dayPct:-0.41, weekPct:0.60, monthPct:2.35 },
};
function makeStocksMock(){
  const m = { log:[], fail:false };
  const item = (sym, range) => {
    const f = STOCK_FX[String(sym).toUpperCase()];
    if (!f) return { symbol:sym, ok:false, reason:"not-found" };
    const n = range === "week" ? 10 : range === "year" ? 14 : 24, now = Date.now();
    const closes = []; for (let i = 0; i < n; i++) closes.push({ t: new Date(now - (n - 1 - i) * 86400000).toISOString(), c: f.price * (1 - (f.monthPct / 100) * ((n - 1 - i) / (n - 1))) });
    const ab = (p) => f.price * p / 100;
    return { symbol:sym, ok:true, name:f.name, currency:"USD", price:f.price, prevClose: f.price - ab(f.dayPct),
      day:{ abs:ab(f.dayPct), pct:f.dayPct }, week:{ abs:ab(f.weekPct), pct:f.weekPct }, month:{ abs:ab(f.monthPct), pct:f.monthPct }, closes, asOf:new Date().toISOString() };
  };
  m.handle = (bodyRaw) => {
    let b = {}; try { b = JSON.parse(bodyRaw || "{}"); } catch {}
    m.log.push(b);
    if (m.fail) return { status:500, body:{ error:"boom" } };
    if (b.action === "series") return { body:{ series:(b.symbols || []).map((s) => item(s, b.range)) } };
    if (b.action === "quote") return { body:{ quotes:(b.symbols || []).map((s) => { const it = item(s); return it.ok ? { symbol:it.symbol, ok:true, price:it.price, prevClose:it.prevClose, change:it.price - it.prevClose, changePct:it.day.pct, currency:"USD", name:it.name } : { symbol:s, ok:false, reason:it.reason }; }) } };
    // The real function never answers "analyze" with an HTTP error: it is always 200 {ok,...}.
    if (b.action === "analyze") return { body:{ ok:false, reason:"upstream-error" } };
    return { status:400, body:{ error:'action must be "quote", "series", or "analyze"' } };
  };
  return m;
}

/* ============================ browser plumbing ============================ */
const contexts = [];
const PUSH_STUB = `window.__PUSH_ENABLE__ = [];
window.BuckyPush = { enable: function(){ window.__PUSH_ENABLE__.push([].slice.call(arguments)); return Promise.resolve({ token:"t" }); },
  disable: function(){ return Promise.resolve(false); }, updateExtra: function(){ return Promise.resolve(); },
  isSupported: function(){ return true; }, status: function(){ return {}; }, notify: function(){ return Promise.resolve(null); } };`;

async function newPage(browser, { user = "Grandma", viewport = { width:390, height:844 }, perm = "default", unlocked = true } = {}){
  const cal = makeCalMock(), stocks = makeStocksMock(), fnLog = [];
  const ctx = browser.createBrowserContext ? await browser.createBrowserContext() : await browser.createIncognitoBrowserContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.setViewport({ width: viewport.width, height: viewport.height, deviceScaleFactor: 1 });
  const errors = [];
  const NOISE = /Failed to load resource|dynamically imported module|gstatic|firebase|ERR_FAILED|ERR_BLOCKED/i;
  page.on("pageerror", (e) => { if (!NOISE.test(String(e))) errors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push("console: " + m.text()); });
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (/googleapis|firestore|firebase|gstatic/i.test(u)) return r.abort();
    if (u.split("?")[0].endsWith("/push-client.js")) return r.respond({ status:200, contentType:"text/javascript", body: PUSH_STUB });
    if (u.includes("/.netlify/functions/news")){
      let b = {}; try { b = JSON.parse(r.postData() || "{}"); } catch {}
      const body = b.action === "feed"
        ? { items: newsItems(), sources: (b.sources || []).map((s) => ({ id:s.id, ok:true, count:1, reason:"" })), canSummarize:true, generatedAt: Date.now() }
        : b.action === "summarize" ? { ok:true, summaries:{} } : { ok:false, reason:"no-feed" };
      return r.respond({ status:200, contentType:"application/json", body: JSON.stringify(body) });
    }
    const fnm = u.match(/\/\.netlify\/functions\/([a-z0-9_-]+)/i);
    if (fnm){
      fnLog.push(fnm[1]);
      const mock = fnm[1] === "calendar" ? cal : fnm[1] === "stocks" ? stocks : null;
      if (mock){
        const out = mock.handle(r.postData());
        return r.respond({ status: out.status || 200, contentType:"application/json", body: JSON.stringify(out.body) });
      }
    }
    if (u.includes("/.netlify/functions/")) return r.respond({ status:200, contentType:"application/json", body:"{}" });
    if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) return r.abort();
    r.continue();
  });
  await page.evaluateOnNewDocument((u, pr, unl) => {
    if (unl) localStorage.setItem("choreUnlocked", "amenfarms");
    if (u) { if (!localStorage.getItem("choreUser")) localStorage.setItem("choreUser", u); }
    else { localStorage.removeItem("choreUser"); localStorage.removeItem("chorePid"); }
    window.__PROMPTS__ = [];
    window.__PROMPT_COUNT__ = 0; window.__PROMPT_ANSWER__ = null;
    window.prompt = () => { window.__PROMPT_COUNT__++; return window.__PROMPT_ANSWER__; };
    window.alert = () => {}; window.confirm = () => true;
    window.__NOTIF_ASK__ = 0; window.__NOTIF_SHOWN__ = 0;
    function FakeNotification(){ window.__NOTIF_SHOWN__++; }
    FakeNotification.permission = pr;
    FakeNotification.requestPermission = () => { window.__NOTIF_ASK__++; if (FakeNotification.permission === "default") FakeNotification.permission = "granted"; return Promise.resolve(FakeNotification.permission); };
    window.Notification = FakeNotification;
  }, user, perm, unlocked);
  return { page, errors, cal, stocks, fnLog };
}

/** Seed local storage on this origin (via a static file, so no Bucky code runs), then open `url`. */
async function open(page, url, { profiles = roster(), rows = ALL_ROWS, sources = SOURCES, ls = {} } = {}){
  await page.goto(BASE + "/manifest.webmanifest", { waitUntil: "domcontentloaded" });
  await page.evaluate((all, src, extra) => {
    for (const k of Object.keys(extra)) localStorage.setItem(k, extra[k]);
    localStorage.setItem("buckyData1", JSON.stringify(all));
    if (src) localStorage.setItem("setting_newsSources", JSON.stringify({ list: src }));
    // Finance's per-person watchlist (same key the finance suite seeds).
    for (const who of ["Dad", "Grandma"]) localStorage.setItem("setting_stockWatch_" + who, JSON.stringify({ symbols: ["AAPL", "MSFT"], updatedAt: Date.now() }));
  }, profiles.concat(rows), sources, ls);
  await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__STANDALONE__ && window.__NAV__, { timeout: 20000 });
}

/* One row per app. sel: something only that tab draws (used to say "its content is on screen" or
   "none of it is"). cap: the capability the profile page's checkbox turns off for the area (null:
   the app is gated by something a deny entry cannot express, see finance). heading: the visible
   h1 the app adds (null: the tab draws its own title or needs none). fab: keeps the + button. */
const APPS = {
  news: { tab:"news",     path:"/news", sel:".newswrap", cap:"seesNews", heading:null, fab:false,
    ready: () => document.querySelectorAll(".newscard").length >= 3, title:"Bucky News", denied:"News isn't turned on for this account. Ask a parent to enable it." },
  shop: { tab:"shopping", path:"/shop", sel:".store-head", cap:"seesShop", heading:"Shopping", fab:false,
    ready: () => document.querySelectorAll(".store-head").length === 6 && document.body.textContent.includes("Zebra Milk"), title:"Bucky Shopping", denied:"Shopping isn't turned on for this account. Ask a parent to enable it." },
  workorders: { tab:"workorders", path:"/workorders", sel:".wo-group-head", cap:"seesJobs", heading:"Work Orders", fab:true,
    ready: () => document.querySelectorAll("li.wo").length === 3 && document.body.textContent.includes("Zebra fix fence"), title:"Bucky Work Orders", denied:"Work Orders aren't turned on for this account. Ask a parent to enable it." },
  calendar: { tab:"calendar", path:"/calendar", sel:".cal-grid", cap:"seesPlan", heading:null, fab:true,
    ready: () => document.querySelectorAll(".cal-evrow").length === 8 && document.body.textContent.includes("Zebra event 8"), title:"Bucky Calendar", denied:"The calendar isn't turned on for this account. Ask a parent to enable it." },
  finance: { tab:"finance", path:"/finance", sel:".finwrap", cap:null, heading:null, fab:false,
    ready: () => document.querySelectorAll(".finmkt-p").length === 3 && document.querySelectorAll(".finrow .finprice").length === 2, title:"Bucky Finance", denied:"Finance isn't turned on for this account. Ask a parent to enable it." },
};
const IDS = Object.keys(APPS);
const ANY_CONTENT = IDS.map((i) => APPS[i].sel).concat([".newscard", "li.wo"]).join(", ");
// A failed wait is a failed check, not a crash, so a broken app still produces a full report.
async function ready(page, id){
  const hit = await page.waitForFunction(APPS[id].ready, { timeout: 20000 }).then(() => true, () => false);
  ok(hit, `[${id}] the app's content rendered`);
  await sleep(250);
}

function chrome(page){
  return page.evaluate(() => {
    const st = (sel) => {
      const el = document.querySelector(sel); if (!el) return { present:false };
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return { present:true, offsetParentNull: el.offsetParent === null, display: cs.display, w: r.width, h: r.height };
    };
    return { header: st("header"), bnav: st("#bnav"), sidenav: st("#sidenav"), fab: st("#addFab"), bell: st("#bellBtn"), who: st("#whoBtn"), subnav: st("#subnav") };
  });
}
// A fixed-position element has offsetParent === null even while it is on screen, so
// offsetParent alone proves nothing for #bnav / #sidenav / the FAB. Gone means all three agree.
const gone = (s) => s.present && s.offsetParentNull && s.w === 0 && s.h === 0 && s.display === "none";
// A child of a hidden container reports its OWN display (flex), so judge it by box and offsetParent.
const absent = (s) => s.present && s.offsetParentNull && s.w === 0 && s.h === 0;
const shown = (s) => s.present && s.w > 0 && s.h > 0;

function meta(page){
  return page.evaluate(() => ({
    title: document.title,
    dataApp: document.documentElement.getAttribute("data-app"),
    manifest: document.querySelector('link[rel="manifest"]').getAttribute("href"),
    theme: document.querySelector('meta[name="theme-color"]').getAttribute("content"),
    touch: document.querySelector('link[rel="apple-touch-icon"]').getAttribute("href"),
    id: window.__STANDALONE__.id,
    tab: window.__NAV__.tab(),
  }));
}
function pngSize(file){
  const b = fs.readFileSync(path.join(ROOT, file.replace(/^\//, "")));
  if (b.toString("latin1", 1, 4) !== "PNG") return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/* ================================= A. files ================================== */
function sectionFiles(){
  section("A. Manifests, icons, rewrites, proxy kit (files on disk)");
  for (const id of IDS){
    const mf = path.join(ROOT, id + ".webmanifest");
    let m = null; try { m = JSON.parse(fs.readFileSync(mf, "utf8")); } catch {}
    ok(!!m, `${id}.webmanifest exists and parses`);
    if (!m) continue;
    const name = APPS[id].title;
    ok(m.name === name && !!m.short_name, `${id}: name is "${name}" and short_name is set (got "${m.short_name}")`);
    ok(m.id === "/" + id && m.start_url === "/" + id, `${id}: id and start_url are "/${id}" (got ${m.id}, ${m.start_url})`);
    ok(m.scope === "/" && m.display === "standalone", `${id}: scope "/" and display "standalone"`);
    ok(m.background_color === "#f4f1e8" && m.theme_color === THEME, `${id}: Farmstead colours (${m.background_color}, ${m.theme_color})`);
    const want = [["any", 192], ["any", 512], ["maskable", 512]];
    for (const [purpose, size] of want){
      const ic = (m.icons || []).find((i) => i.purpose === purpose && i.sizes === size + "x" + size);
      ok(!!ic, `${id}: declares a ${purpose} ${size}px icon`);
      const dim = ic && fs.existsSync(path.join(ROOT, ic.src.replace(/^\//, ""))) ? pngSize(ic.src) : null;
      ok(dim && dim.w === size && dim.h === size, `${id}: ${ic && ic.src} exists and its PNG header says ${size}x${size} (got ${dim && dim.w + "x" + dim.h})`);
    }
    const iconSrcs = (m.icons || []).map((i) => i.src);
    ok(iconSrcs.every((s) => s.includes(id)), `${id}: its icons are its own, not Bucky's`);
    const dim = pngSize("/icons/" + id + "-apple-touch.png");
    ok(dim && dim.w === 180 && dim.h === 180, `${id}: apple-touch icon is 180x180`);
  }
  const icons512 = IDS.map((id) => fs.readFileSync(path.join(ROOT, "icons/" + id + "-512.png")).toString("base64"));
  ok(new Set(icons512).size === IDS.length, "the five apps do not share an icon (" + IDS.length + " distinct 512px files)");

  const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8").replace(/\r/g, "");
  const rw = tomlRewrites();
  for (const f of IDS.flatMap((id) => ["/" + id, "/" + id + "/"])){
    const r = rw.find((x) => x.from === f);
    ok(r && r.to === "/index.html" && r.status === 200 && !r.force, `netlify.toml rewrites ${f} to /index.html with status 200 (not forced)`);
  }
  const league = rw.filter((x) => /^https:\/\/(www\.)?goatfantasyleague\.com\/$/.test(x.from || ""));
  ok(league.length === 2 && league.every((x) => x.force && x.to === "/league.html" && x.status === 200), "the two forced goatfantasyleague.com rules are untouched");
  ok(/Content-Type = "application\/manifest\+json"/.test(toml), "the .webmanifest content-type header rule still covers the new manifests");
  const rootNames = fs.readdirSync(ROOT).map((n) => n.toLowerCase());
  // A file called calendar.html is fine (the rewrite is for the extensionless address); an
  // extensionless file or a folder called calendar, news, ... would shadow the rewrite.
  ok(!IDS.some((n) => rootNames.includes(n)), "no file or folder named " + IDS.join(", ") + " at the root to shadow the rewrites");
  ok(rw.filter((x) => IDS.some((id) => x.from === "/" + id || x.from === "/" + id + "/")).length === IDS.length * 2, "exactly two rewrites per app, no duplicates (" + IDS.length * 2 + ")");

  for (const id of IDS){
    const f = path.join(ROOT, "tools/standalone-sites", id, "_redirects");
    const lines = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split(/\r?\n/).map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean) : [];
    ok(lines.length === 2, `${id}/_redirects has exactly two rules`);
    ok(lines[0] === `/ /${id} 302`, `${id}/_redirects sends the bare address to /${id} (302)`);
    ok(lines[lines.length - 1] === "/* https://amenfarms.netlify.app/:splat 200!", `${id}/_redirects ends with the forced catch-all proxy`);
    ok(!fs.readFileSync(f, "utf8").includes("\r"), `${id}/_redirects has LF endings (Netlify reads the file as written)`);
  }
  const attrs = fs.readFileSync(path.join(ROOT, ".gitattributes"), "utf8");
  ok(/tools\/standalone-sites\/\*\*\/_redirects\s+text\s+eol=lf/.test(attrs), ".gitattributes keeps every tools/standalone-sites/**/_redirects on LF (covers the new folders)");
  const readme = path.join(ROOT, "tools/standalone-sites/README.md");
  const rtext = fs.existsSync(readme) ? fs.readFileSync(readme, "utf8") : "";
  ok(/drag/i.test(rtext), "tools/standalone-sites/README.md exists and says how to deploy");
  ok(IDS.every((id) => rtext.includes("`" + id + "`") || rtext.includes("/" + id)), "the README names all five apps (" + IDS + ")");
}

/* ============================ B. registry agreement ============================ */
async function sectionRegistry(browser){
  section("B. The head-script table and STANDALONE_APPS agree");
  const { page, errors } = await newPage(browser);
  await open(page, "/index.html");
  const r = await page.evaluate(() => ({ head: window.__STANDALONE__.head, main: window.__STANDALONE__.apps }));
  const hid = Object.keys(r.head || {}).sort(), mid = Object.keys(r.main || {}).sort();
  ok(hid.length === IDS.length && JSON.stringify(hid) === JSON.stringify(mid) && JSON.stringify(mid) === JSON.stringify(IDS.slice().sort()), `same ${IDS.length} app ids in both tables and in this suite (${hid} vs ${mid})`);
  for (const id of mid){
    const h = r.head[id] || {}, m = r.main[id];
    ok(h.name === m.name && h.manifest === m.manifest && h.icon === m.icon && h.theme === m.theme, `${id}: name, manifest, icon and theme match across the two tables`);
    ok(!!h.fab === !!m.fab && !!m.fab === APPS[id].fab, `${id}: the + button flag agrees in both tables and with this suite (head ${!!h.fab}, main ${!!m.fab})`);
    ok(m.tab === APPS[id].tab, `${id}: locked to tab "${APPS[id].tab}"`);
    ok(m.name === APPS[id].title && m.manifest === "/" + id + ".webmanifest" && m.icon === "/icons/" + id + "-apple-touch.png", `${id}: name, manifest and icon follow the id`);
  }
  // Only Finance carries an extra capability (it shares the bank area with the kids' Farm Bank).
  ok(r.main.finance.cap === "seesFinance" && mid.filter((id) => r.main[id].cap).join() === "finance", "only finance has a registry cap, and it is seesFinance");
  // The area each app names is a real NAV_GROUPS id that navGroupPermitted() answers for.
  const areas = await page.evaluate((m) => Object.fromEntries(Object.entries(m).map(([id, a]) => [id, window.__NAV__.permitted(a.area, "Grandma")])), r.main);
  ok(mid.every((id) => areas[id] === true), "every registry area is a real NAV_GROUPS id that permits Grandma (" + JSON.stringify(areas) + ")");
  // Each tab really belongs to the area the registry names (parsed from the NAV_GROUPS literal).
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const groups = {}; for (const g of html.matchAll(/\{ id:"(\w+)",\s*ico:"[^"]*",\s*name:"[^"]*",\s*def:"\w+",\s*members:\[([^\]]*)\]/g)) groups[g[1]] = g[2].replace(/["\s]/g, "").split(",");
  for (const id of mid) ok((groups[r.main[id].area] || []).includes(r.main[id].tab), `NAV_GROUPS area ${r.main[id].area} holds tab ${r.main[id].tab}`);
  // The CSS keeps the + button off an app unless the head script set html[data-fab]: the rule is
  // attribute-based, so there is no id list in the stylesheet to drift from the registry.
  ok(/html\[data-app\]:not\(\[data-fab\]\) #addFab/.test(html), "the stylesheet hides the + button for html[data-app] unless html[data-fab] is set");
  ok(errors.length === 0, "no page errors" + (errors[0] ? ": " + errors[0] : ""));
}

/* =============================== C. the matrix =============================== */
async function sectionMatrix(browser){
  section("C. Each app, both viewports, both address forms");
  const VPS = [{ w:390, h:844 }, { w:1280, h:900 }];
  for (const id of IDS){
    for (const form of ["query", "path"]){
      for (const vp of VPS){
        const tag = `${id} ${form === "query" ? "?app=" + id : APPS[id].path} @${vp.w}x${vp.h}`;
        const { page, errors } = await newPage(browser, { viewport: { width: vp.w, height: vp.h } });
        const url = form === "query" ? "/index.html?app=" + id : APPS[id].path;
        await open(page, url, { rows: ALL_ROWS });
        await ready(page, id);
        ok(await page.evaluate(() => document.documentElement.hasAttribute("data-fab")) === APPS[id].fab, `[${tag}] html[data-fab] is ${APPS[id].fab ? "set" : "absent"}, as the registry says`);

        const m = await meta(page);
        ok(m.dataApp === id && m.id === id, `[${tag}] app mode is on`);
        ok(m.title === APPS[id].title, `[${tag}] document title is "${APPS[id].title}" (got "${m.title}")`);
        ok(m.manifest === "/" + id + ".webmanifest", `[${tag}] manifest link is the app's (got ${m.manifest})`);
        ok(m.theme === THEME, `[${tag}] theme colour is set (${m.theme})`);
        ok(m.touch === "/icons/" + id + "-apple-touch.png", `[${tag}] apple-touch icon is the app's (got ${m.touch})`);
        ok(m.tab === APPS[id].tab, `[${tag}] current tab is "${APPS[id].tab}"`);

        const c = await chrome(page);
        ok(gone(c.header), `[${tag}] header is gone (display ${c.header.display}, ${c.header.w}x${c.header.h}, offsetParent null)`);
        ok(gone(c.bnav), `[${tag}] bottom nav is gone`);
        ok(gone(c.sidenav), `[${tag}] side rail is gone`);
        ok(absent(c.bell) && absent(c.who), `[${tag}] bell and profile buttons are gone with the header`);
        ok(gone(c.subnav), `[${tag}] sub-nav is gone`);
        if (!APPS[id].fab){
          ok(gone(c.fab), `[${tag}] add button is gone`);
          // The page itself hides the + on these tabs with an inline style, which would mask a
          // missing CSS rule. Clear it and look again: only the stylesheet is left to hide it.
          await page.evaluate(() => { document.getElementById("addFab").style.display = ""; });
          ok(gone((await chrome(page)).fab), `[${tag}] add button stays gone with the page's own inline hiding removed`);
        } else {
          // Work Orders and Calendar keep it (section J measures it in full).
          ok(shown(c.fab), `[${tag}] add button is on screen (${c.fab.w}x${c.fab.h})`);
        }

        const lay = await page.evaluate(() => {
          const main = document.querySelector("main"), mr = main.getBoundingClientRect();
          const first = [...main.querySelectorAll("*")].find((e) => e.getBoundingClientRect().height > 0);
          const bs = getComputedStyle(document.body);
          return {
            mainTop: mr.top, mainW: mr.width, mainLeft: mr.left, firstTop: first ? first.getBoundingClientRect().top : null,
            padL: parseFloat(bs.paddingLeft), padB: parseFloat(bs.paddingBottom), padT: parseFloat(bs.paddingTop),
            scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, scrollY: window.scrollY,
            docH: document.documentElement.scrollHeight,
          };
        });
        ok(lay.firstTop !== null && lay.firstTop >= 0 && lay.firstTop <= 20, `[${tag}] first content starts at the top: ${lay.firstTop}px (nothing reserved for the missing header)`);
        ok(lay.padL === 0, `[${tag}] no left-rail offset on the body (padding-left ${lay.padL})`);
        // Hand-computed from the stylesheet: 28px with no + button; 100px with one (58px button +
        // 20px offset + 14px air); 0 in the calendar's pinned month view (the page must not scroll).
        const wantPadB = !APPS[id].fab ? 28 : id === "calendar" ? 0 : 100;
        ok(lay.padB === wantPadB, `[${tag}] body bottom padding is ${wantPadB}px, not the bottom-nav clearance (is ${lay.padB}px)`);
        ok(lay.scrollW <= lay.innerW, `[${tag}] no horizontal scroll (${lay.scrollW} <= ${lay.innerW})`);
        if (vp.w >= 1024){
          ok(lay.mainW <= 760 && lay.mainW > 400, `[${tag}] content column capped at 760px (is ${lay.mainW})`);
          ok(Math.abs(lay.mainLeft - (lay.innerW - lay.mainW) / 2) <= 1, `[${tag}] and centred (left ${lay.mainLeft}, window ${lay.innerW}, column ${lay.mainW})`);
        } else {
          ok(Math.abs(lay.mainW - lay.innerW) <= 1, `[${tag}] column fills the phone (${lay.mainW} of ${lay.innerW})`);
        }

        // Content really rendered.
        if (id === "news"){
          const n = await page.evaluate(() => ({ cards: document.querySelectorAll(".newscard").length, head: !!document.querySelector(".newshead"), text: document.body.textContent.includes("Council approves the new bridge") }));
          ok(n.cards === 3 && n.head && n.text, `[${tag}] the three seeded stories rendered (cards ${n.cards})`);
        } else if (id === "workorders"){
          // WO_ROWS for Grandma: payout card + her two orders on screen, four group headers,
          // 4 open + 1 awaiting payout = 5 active, 0 closed.
          const w = await page.evaluate(() => ({ cards: document.querySelectorAll("li.wo").length, heads: document.querySelectorAll(".wo-group-head").length,
            count: document.getElementById("progressText").textContent, subs: [...document.querySelectorAll("li.wo .wo-sub")].map((e) => e.textContent) }));
          ok(w.cards === 3 && w.heads === 4, `[${tag}] three cards and four group headers (cards ${w.cards}, headers ${w.heads})`);
          ok(w.count === "5 open · 0 completed", `[${tag}] the count line reads "5 open · 0 completed" (got "${w.count}")`);
          ok(w.subs.some((t) => t.includes("due tomorrow")) && w.subs.some((t) => t.includes("overdue by 3 days")), `[${tag}] due phrases computed from the fixture dates: "due tomorrow" and "overdue by 3 days" (${w.subs.map((t) => t.slice(0, 30))})`);
        } else if (id === "calendar"){
          // Eight events today (agenda rows), exactly one cell marked today, the all-day event tomorrow shows as a chip/dot.
          const c2 = await page.evaluate(() => ({ rows: [...document.querySelectorAll(".cal-evrow .cal-evname")].map((e) => e.textContent), today: document.querySelectorAll(".cal-cell.today").length,
            cells: document.querySelectorAll(".cal-cell").length, title: (document.querySelector(".cal-title") || {}).textContent || "", seg: [...document.querySelectorAll(".cal-viewseg button")].map((b) => b.textContent) }));
          ok(c2.rows.length === 8 && c2.rows[0] === "Zebra event 1" && c2.rows[7] === "Zebra event 8", `[${tag}] today's eight events are in the agenda, in time order (${c2.rows[0]} .. ${c2.rows[7]})`);
          ok(c2.cells === 42 && c2.today === 1, `[${tag}] a six-week grid (42 cells) with exactly one marked today (${c2.cells}, ${c2.today})`);
          ok(c2.title.length > 3 && c2.seg.join() === "Month,Week,Day", `[${tag}] the calendar draws its own title ("${c2.title}") and the Month/Week/Day switch`);
        } else if (id === "finance"){
          // From STOCK_FX: S&P $5,555.55 +1.23%, Dow $40,012.34 -0.62%, oil $78.42 +0.55%; watchlist AAPL $214.32, MSFT $431.09.
          const f = await page.evaluate(() => ({ mk: [...document.querySelectorAll(".finmkt")].map((e) => e.textContent), rows: [...document.querySelectorAll(".finrow")].map((e) => e.textContent), h3: (document.querySelector(".finhead h3") || {}).textContent }));
          ok(f.h3 === "Finance" && f.mk.length === 3, `[${tag}] its own "Finance" heading and three market tiles`);
          ok(f.mk[0].includes("$5,555.55") && f.mk[0].includes("+1.23%") && f.mk[1].includes("$40,012.34") && f.mk[1].includes("-0.62%") && f.mk[2].includes("$78.42") && f.mk[2].includes("+0.55%"), `[${tag}] market prices and day changes match the mock (${f.mk.map((t) => t.slice(-18))})`);
          ok(f.rows.length === 2 && f.rows[0].includes("AAPL") && f.rows[0].includes("$214.32") && f.rows[1].includes("MSFT") && f.rows[1].includes("$431.09"), `[${tag}] the two watchlist rows show AAPL $214.32 and MSFT $431.09`);
        } else {
          const s = await page.evaluate(() => ({ stores: document.querySelectorAll(".store-head").length,
            items: [...document.querySelectorAll(".chore.shop .name")].map((e) => e.textContent), count: document.getElementById("progressText").textContent,
            progressShown: document.getElementById("progress").getBoundingClientRect().height > 0 }));
          ok(s.stores === 6 && s.items.includes("Zebra Milk") && s.items.includes("Zebra Eggs") && s.items.includes("Zebra Towels"), `[${tag}] six stores and the three seeded items rendered (${s.items})`);
          ok(s.count === "3 to buy" && s.progressShown, `[${tag}] the "3 to buy" count shows (got "${s.count}")`);
        }

        if (SHOTS && form === "path"){
          fs.mkdirSync(SHOTS, { recursive: true });
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: path.join(SHOTS, `${id}_${vp.w}x${vp.h}.png`) });
        }
        ok(errors.length === 0, `[${tag}] no page errors` + (errors[0] ? ": " + errors[0] : ""));
        await page.close();
      }
    }
  }
}

/* ============================== D. the tab lock ============================== */
async function sectionLock(browser){
  section("D. Locked to its tab: nothing leaves it");
  for (const id of IDS){
    const A = APPS[id];
    const { page, errors } = await newPage(browser);
    await open(page, A.path, { rows: ALL_ROWS });
    await ready(page, id);
    const content = () => page.evaluate((sel) => !!document.querySelector(sel), A.sel);
    const histLen = await page.evaluate(() => history.length);

    // Seven OTHER areas: goTo to the app's own tab is allowed (and would push a history entry), so it is not in the list.
    const others = ["dashboard", "farmbank", "calendar", "workorders", "chores", "play", "gffl", "finance", "news", "shopping"].filter((d) => d !== A.tab).slice(0, 7);
    for (const dest of others){
      await page.evaluate((d) => window.__NAV__.goTo(d), dest);
      await sleep(120);
    }
    ok(await page.evaluate(() => window.__NAV__.tab()) === A.tab, `[${id}] goTo() to seven other areas leaves it on "${A.tab}"`);
    ok(await page.evaluate(() => history.length) === histLen, `[${id}] …and pushes no history entry`);
    ok(await content(), `[${id}] …and the tab's content is still on screen`);

    await page.evaluate(() => { location.hash = "#farmbank"; });
    await sleep(250);
    await page.evaluate(() => { location.hash = "#dashboard"; });
    await sleep(250);
    ok(await page.evaluate(() => window.__NAV__.tab()) === A.tab, `[${id}] hash routes (#farmbank, #dashboard) do not move it`);

    // Notification-tap destinations assign currentTab directly and then call render().
    for (const fn of ["goToWorkOrders", "goToFarmBank", "goToCalendar", "goToPrint3D"]){
      await page.evaluate((f) => window.__STANDALONE__[f](), fn);
      await sleep(120);
    }
    ok(await page.evaluate(() => window.__NAV__.tab()) === A.tab, `[${id}] notification destinations (work orders, bank, calendar, prints) land on "${A.tab}"`);
    ok(await content(), `[${id}] …and the tab's content is still on screen`);

    // History: push an entry that claims to be another tab, step back and forward over it.
    await page.evaluate(() => { history.pushState({ buckyTab: "farmbank" }, ""); });
    await page.evaluate(() => history.back());
    await sleep(300);
    await page.evaluate(() => history.forward());
    await sleep(300);
    ok(await page.evaluate(() => window.__NAV__.tab()) === A.tab, `[${id}] history Back and Forward over a farmbank entry stay on "${A.tab}"`);
    ok(await content(), `[${id}] …and the tab's content is still on screen`);
    await page.close();

    // A deep link to another area at load time.
    for (const url of [A.path + "#farmbank", "/index.html?app=" + id + "#dashboard", "/index.html?app=" + id + "&tab=chores#calendar"]){
      const p2 = await newPage(browser);
      await open(p2.page, url, { rows: ALL_ROWS });
      await ready(p2.page, id);
      ok(await p2.page.evaluate(() => window.__NAV__.tab()) === A.tab, `[${id}] opening ${url} lands on "${A.tab}"`);
      ok(p2.errors.length === 0, `[${id}] no page errors for ${url}` + (p2.errors[0] ? ": " + p2.errors[0] : ""));
      await p2.page.close();
    }
    ok(errors.length === 0, `[${id}] no page errors` + (errors[0] ? ": " + errors[0] : ""));
  }
}

/* ============================ E. normal Bucky untouched ============================ */
async function sectionNormal(browser){
  section("E. Normal Bucky is untouched; unknown app ids are ignored");
  for (const vp of [{ w:390, h:844 }, { w:1280, h:900 }]){
    const { page, errors } = await newPage(browser, { viewport: { width: vp.w, height: vp.h } });
    await open(page, "/index.html", { rows: ALL_ROWS });
    await sleep(500);
    const m = await meta(page);
    ok(m.dataApp === null && m.id === "", `[normal @${vp.w}] no app mode`);
    ok(m.title === "Bucky" && m.manifest === "/manifest.webmanifest" && m.theme === THEME && m.touch === "/bucky.png", `[normal @${vp.w}] original title, manifest, theme and touch icon (${m.title}, ${m.manifest}, ${m.touch})`);
    let c = await chrome(page);
    ok(shown(c.header) && c.header.offsetParentNull === false, `[normal @${vp.w}] header is present (${c.header.w}x${c.header.h})`);
    if (vp.w >= 1024) ok(shown(c.sidenav) && !shown(c.bnav), `[normal @${vp.w}] desktop shows the side rail, not the bottom nav`);
    else ok(shown(c.bnav) && !shown(c.sidenav), `[normal @${vp.w}] phone shows the bottom nav (${c.bnav.h}px tall), not the side rail`);
    const pad = await page.evaluate(() => { const b = getComputedStyle(document.body); return { l: parseFloat(b.paddingLeft), b: parseFloat(b.paddingBottom) }; });
    ok(vp.w >= 1024 ? pad.l === 230 && pad.b === 28 : pad.l === 0 && pad.b === 196, `[normal @${vp.w}] body keeps the space it reserves for the nav (left ${pad.l}, bottom ${pad.b})`);
    await page.evaluate(() => window.__NAV__.goTo("chores")); await sleep(200);
    ok(shown((await chrome(page)).fab), `[normal @${vp.w}] the add button shows on Chores`);
    // The + button keeps its own offsets in normal Bucky (section J restyles them for the apps only):
    // 82px above the bottom edge on a phone (clear of the two-row nav), 28px and 32px on the desktop rail layout.
    {
      const f = await page.evaluate(() => { const r = document.getElementById("addFab").getBoundingClientRect(), de = document.documentElement; return { bottom: de.clientHeight - r.bottom, right: de.clientWidth - r.right, attr: de.hasAttribute("data-fab") || de.hasAttribute("data-app") }; });
      ok(f.attr === false, `[normal @${vp.w}] neither html[data-app] nor html[data-fab] is set`);
      ok(Math.abs(f.bottom - (vp.w >= 1024 ? 28 : 82)) <= 0.5 && Math.abs(f.right - (vp.w >= 1024 ? 32 : 18)) <= 0.5, `[normal @${vp.w}] the + button sits ${vp.w >= 1024 ? "28px up, 32px in" : "82px up, 18px in"} as before (${f.bottom}, ${f.right})`);
    }
    await page.evaluate(() => window.__NAV__.goTo("farmbank")); await sleep(200);
    ok(await page.evaluate(() => window.__NAV__.tab()) !== "chores", `[normal @${vp.w}] goTo still navigates`);
    await page.evaluate(() => window.__NAV__.goTo("dashboard")); await sleep(200);
    ok(await page.evaluate(() => window.__NAV__.tab()) === "dashboard", `[normal @${vp.w}] Home works`);
    ok(errors.length === 0, `[normal @${vp.w}] no page errors` + (errors[0] ? ": " + errors[0] : ""));
    await page.close();
  }
  for (const url of ["/index.html?app=bogus", "/index.html?app=toString", "/index.html?app=__proto__", "/index.html?app=NEWS", "/index.html?app=", "/index.html?app=news.webmanifest", "/index.html?app=Finance", "/index.html?app=calendar.html", "/index.html?app=workorders%20", "/index.html?app=wo"]){
    const { page, errors } = await newPage(browser);
    await open(page, url);
    await sleep(400);
    const m = await meta(page);
    const c = await chrome(page);
    ok(m.dataApp === null && m.id === "" && m.title === "Bucky" && shown(c.header) && shown(c.bnav), `${url} behaves as normal Bucky`);
    ok(errors.length === 0, `${url}: no page errors` + (errors[0] ? ": " + errors[0] : ""));
    await page.close();
  }
  // Each address form, trailing slash included.
  for (const [url, id] of IDS.map((i) => ["/" + i + "/", i])){
    const { page, errors } = await newPage(browser);
    await open(page, url, { rows: ALL_ROWS });
    await ready(page, id);
    const m = await meta(page);
    ok(m.dataApp === id && m.tab === APPS[id].tab, `${url} (trailing slash) is app mode on "${APPS[id].tab}"`);
    // Relative URLs resolve against /news/ here: the page's own scripts and styles must still have loaded.
    ok(await page.evaluate(() => typeof window.__STANDALONE__.toast === "function" && !!window.BuckyPush), `${url}: scripts at absolute paths (index script, push-client) still load`);
    ok(errors.length === 0, `${url}: no page errors` + (errors[0] ? ": " + errors[0] : ""));
    await page.close();
  }
  // /news is the rewrite, not a 404: assert the status the server (reading netlify.toml) returned.
  const st = await new Promise((resolve) => http.get(BASE + "/news", (r) => { r.resume(); resolve(r.statusCode); }));
  ok(st === 200, "GET /news answers 200 through the netlify.toml rewrite (got " + st + ")");
}

/* ===================== F. gates, and no notification side effects ===================== */
async function sectionGates(browser){
  section("F. Password and identity gates still run; no permission ask, no push token");
  for (const id of IDS){
    const A = APPS[id];
    // F1. password screen
    {
      const { page, errors } = await newPage(browser, { unlocked: false });
      await open(page, A.path, { rows: ALL_ROWS });
      await sleep(400);
      const lock = await page.evaluate(() => { const l = document.getElementById("lockScreen"); const r = l.getBoundingClientRect(); return { hidden: l.classList.contains("hidden"), w: r.width, h: r.height }; });
      ok(!lock.hidden && lock.w > 0 && lock.h > 0, `[${id}] the family-password screen shows (${lock.w}x${lock.h})`);
      await page.evaluate(() => { document.getElementById("lockInput").value = "amenfarms"; document.getElementById("lockBtn").click(); });
      await ready(page, id);
      ok(await page.evaluate(() => document.getElementById("lockScreen").getBoundingClientRect().height) === 0, `[${id}] the right password lets it through`);
      ok(await page.evaluate(() => window.__NAV__.tab()) === A.tab, `[${id}] …to "${A.tab}"`);
      ok(errors.length === 0, `[${id}] no page errors (password)` + (errors[0] ? ": " + errors[0] : ""));
      await page.close();
    }
    // F2. identity gate, app mode: lands on the tab, asks for nothing
    for (const appMode of id === IDS[0] ? [true, false] : [true]){   // the normal-Bucky control does not depend on the app: once is enough
      const label = appMode ? "app mode" : "normal Bucky (control)";
      const { page, errors } = await newPage(browser, { user: null });
      await open(page, appMode ? A.path : "/index.html", { rows: ALL_ROWS });
      await page.waitForFunction(() => window.__IDGATE__ && window.__IDGATE__.showing(), { timeout: 15000 }).catch(() => {});
      ok(await page.evaluate(() => window.__IDGATE__.showing()), `[${id}, ${label}] the "Who's this?" gate shows with no identity`);
      const names = await page.evaluate(() => [...document.querySelectorAll("#idGateRoster button")].map((b) => b.textContent.trim()));
      ok(names.includes("Grandma") && names.includes("Isaac"), `[${id}, ${label}] it lists the roster (${names})`);
      await page.evaluate(() => [...document.querySelectorAll("#idGateRoster button")].find((b) => b.textContent.trim() === "Grandma").click());
      await sleep(700);
      ok(!(await page.evaluate(() => window.__IDGATE__.showing())), `[${id}, ${label}] picking a person closes the gate`);
      if (appMode){
        await ready(page, id);
        ok(await page.evaluate(() => window.__NAV__.tab()) === A.tab, `[${id}, ${label}] …and lands on "${A.tab}", not Home`);
      }
      await sleep(3600);   // past the 2.5s / 3s push-refresh timers
      const n = await page.evaluate(() => ({ ask: window.__NOTIF_ASK__, push: window.__PUSH_ENABLE__.length, perm: Notification.permission }));
      if (appMode){
        ok(n.ask === 0, `[${id}, ${label}] Notification.requestPermission was never called (${n.ask})`);
        ok(n.push === 0, `[${id}, ${label}] BuckyPush.enable was never called (${n.push})`);
        ok(n.perm === "default", `[${id}, ${label}] permission is still "default"`);
      } else {
        ok(n.ask >= 1, `[${id}, ${label}] normal Bucky DOES ask for permission after the gate (${n.ask} call) — so the counter can see it`);
        ok(n.push >= 1, `[${id}, ${label}] …and registers a push token (${n.push} enable call)`);
      }
      ok(errors.length === 0, `[${id}, ${label}] no page errors` + (errors[0] ? ": " + errors[0] : ""));
      await page.close();
    }
    // F3. a device that already granted permission: Bucky refreshes its token on every visit; app mode must not
    for (const appMode of id === IDS[0] ? [true, false] : [true]){
      const label = appMode ? "app mode" : "normal Bucky (control)";
      const { page } = await newPage(browser, { perm: "granted" });
      await open(page, appMode ? A.path : "/index.html", { rows: ALL_ROWS });
      await sleep(4500);
      const n = await page.evaluate(() => ({ ask: window.__NOTIF_ASK__, push: window.__PUSH_ENABLE__.length }));
      if (appMode) ok(n.push === 0 && n.ask === 0, `[${id}, ${label}] permission already granted: no token refresh, no ask (${n.push} enable, ${n.ask} ask)`);
      else ok(n.push >= 1, `[${id}, ${label}] permission already granted: Bucky refreshes the token on visit (${n.push} enable call)`);
      await page.close();
    }
  }
}

/* ============================== G. not permitted ============================== */
async function sectionDenied(browser){
  section("G. A profile that may not see the area gets one plain card");
  for (const id of IDS){
    const A = APPS[id];
    // Finance has no deny-able cap of its own to switch off here: Isaac (a kid) is refused by the
    // registry's cap (seesFinance is false for the kid role) although the bank AREA is open to him.
    // Section K covers that in full, plus the area path with Grandma.
    const cap = A.cap;
    const profs = roster(cap ? [cap] : []);
    const { page, errors } = await newPage(browser, { user: "Isaac" });
    await open(page, A.path, { profiles: profs, rows: ALL_ROWS });
    await sleep(1200);
    const d = await page.evaluate((sel) => {
      const el = document.getElementById("appDenied"); const r = el ? el.getBoundingClientRect() : null;
      const h = document.getElementById("appHeading");
      return { text: el ? el.textContent : null, n: document.querySelectorAll("#appDenied").length, w: r && r.width, top: r && r.top,
        headBottom: (h && h.offsetParent !== null) ? h.getBoundingClientRect().bottom : 0,
        tab: window.__NAV__.tab(), content: !!document.querySelector(sel), hist: history.length, fabGone: (() => { const f = document.getElementById("addFab"); return f.offsetWidth === 0 && f.offsetHeight === 0; })() };
    }, ANY_CONTENT);
    ok(d.text === A.denied, `[${id}] the card says: "${d.text}"`);
    // RESTAGED: this asserted the card's top was within 40px of the viewport top. Shopping now
    // carries an app heading (section I), so its card correctly sits under that heading. The
    // rule that matters is unchanged — nothing but the page's own heading is above the card —
    // so the gap is measured from the heading's bottom (0 when the app has no heading).
    const gap = d.top - d.headBottom;
    ok(d.n === 1 && d.w > 200 && gap >= 0 && gap < 40, `[${id}] it is one card, on screen, directly under the page top or its heading (${d.n}, ${d.w}px wide, ${Math.round(gap)}px below)`);
    ok(d.tab === A.tab, `[${id}] it did not bounce Home (tab "${d.tab}")`);
    ok(!d.content, `[${id}] none of the tab's content is shown`);
    ok(d.fabGone, `[${id}] the + button is not drawn on the card either (it would offer to add to a tab you cannot see)`);
    await sleep(1500);
    const again = await page.evaluate(() => ({ n: document.querySelectorAll("#appDenied").length, tab: window.__NAV__.tab(), hist: history.length }));
    ok(again.n === 1 && again.tab === A.tab && again.hist === d.hist, `[${id}] no bounce loop: still one card on "${A.tab}", history unchanged`);
    const c = await chrome(page);
    ok(gone(c.header) && gone(c.bnav), `[${id}] the card page still has no chrome`);
    // A direct goTo from the card goes nowhere.
    await page.evaluate(() => window.__NAV__.goTo("dashboard")); await sleep(150);
    ok(await page.evaluate(() => window.__NAV__.tab()) === A.tab && await page.evaluate(() => !!document.getElementById("appDenied")), `[${id}] goTo("dashboard") from the card changes nothing`);
    // The deny is per area: News denied leaves Shopping open, and the other way round.
    const other = id === "news" ? "shop" : "news";
    const p2 = await newPage(browser, { user: "Isaac" });
    await open(p2.page, APPS[other].path, { profiles: profs, rows: ALL_ROWS });
    await ready(p2.page, other);
    ok(await p2.page.evaluate(() => !document.getElementById("appDenied")), `[${id}] refusing ${cap || "Isaac's role"} does not block the ${other} app`);
    // Control: the same profile in normal Bucky is bounced Home from that tab (existing behaviour).
    const p3 = await newPage(browser, { user: "Isaac" });
    await open(p3.page, "/index.html#" + A.tab, { profiles: profs, rows: ALL_ROWS });
    await sleep(900);
    ok(await p3.page.evaluate(() => window.__NAV__.tab()) === "dashboard", `[${id}] control: normal Bucky still bounces that profile Home`);
    if (SHOTS){ fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `denied_${id}_390x844.png`) }); }
    ok(errors.length === 0 && p2.errors.length === 0 && p3.errors.length === 0, `[${id}] no page errors` + ((errors.concat(p2.errors, p3.errors))[0] ? ": " + errors.concat(p2.errors, p3.errors)[0] : ""));
    await page.close(); await p2.page.close(); await p3.page.close();
  }
}

/* ================================ H. toasts =================================== */
async function sectionToasts(browser){
  section("H. Other features' toasts and desktop alerts are suppressed; the app's own still show");
  for (const id of IDS){
    const A = APPS[id];
    for (const appMode of id === IDS[0] ? [true, false] : [true]){
      const label = appMode ? "app mode" : "normal Bucky (control)";
      const { page, errors } = await newPage(browser, { perm: "granted" });
      await open(page, appMode ? A.path : "/index.html", { rows: ALL_ROWS });
      await sleep(900);
      const toasts = () => page.evaluate(() => document.querySelectorAll("#toastWrap .toast").length);
      await page.evaluate(() => window.__STANDALONE__.toast("Work order created"));
      const t1 = await toasts();
      await page.evaluate(() => { document.getElementById("toastWrap").innerHTML = ""; });
      await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true }));
      await page.evaluate(() => window.__STANDALONE__.live({ type: "cal_event", text: "Calendar: dinner at 6" }));
      const t2 = await toasts();
      const shown2 = await page.evaluate(() => window.__NOTIF_SHOWN__);
      if (appMode){
        ok(t1 === 0, `[${id}, ${label}] a plain toast from another feature is suppressed (${t1})`);
        ok(t2 === 0 && shown2 === 0, `[${id}, ${label}] a live calendar alert makes no toast and no desktop notification (${t2} toast, ${shown2} desktop)`);
        await page.evaluate((tab) => window.__STANDALONE__.toast("Saved on this tab", null, { tab }), A.tab);
        ok(await toasts() === 1, `[${id}, ${label}] a toast the app's own tab raises still shows`);
        // A tab that is NOT this app's own (work orders is itself an app now, so it cannot be the stand-in).
        await page.evaluate((tab) => window.__STANDALONE__.toast("From the bank tab", null, { tab }), "farmbank");
        ok(await toasts() === 1, `[${id}, ${label}] a toast tagged with another tab (farmbank) is still suppressed`);
        await sleep(450);   // let the slide-in animation finish
        const top = await page.evaluate(() => document.querySelector("#toastWrap .toast").getBoundingClientRect().top);
        ok(top >= 0 && top < 40, `[${id}, ${label}] the toast sits at the top where the header used to be (${top}px)`);
      } else {
        // RESTAGED: this said === 1. The fixture now seeds work orders assigned to Grandma, and normal Bucky
        // also toasts that assignment on load, so a second toast is expected there. The control only has to
        // prove a toast CAN show; app mode (above) still asserts exactly 0 with the same rows.
        ok(t1 >= 1, `[${id}, ${label}] the same plain toast DOES show (${t1} toast(s), the assignment alert may add one), so the check can see it`);
        ok(t2 === 1 && shown2 === 1, `[${id}, ${label}] …and the live alert toasts and fires a desktop notification (${t2}, ${shown2})`);
      }
      ok(errors.length === 0, `[${id}, ${label}] no page errors` + (errors[0] ? ": " + errors[0] : ""));
      await page.close();
    }
  }
}

/* ================================ I. icons plate ================================ */
/* I. Four things the first pass left running in app mode, found on review:
      - opening Bucky News cleared BUCKY's notification tray and badge (shared service worker)
      - a Dad profile got the boot-time PIN prompt as its greeting
      - the visit was logged as a bare "app" open, never as News / Shopping
      - Shopping had no title once the nav that named it was gone
   Each is asserted against a NORMAL-Bucky control so the check cannot pass vacuously. */
async function sectionReviewFixes(browser){
  section("I. Tray, PIN prompt, activity hit and page heading in app mode");
  const instrument = (page) => page.evaluateOnNewDocument(() => {
    window.__PROMPT_N__ = 0; window.prompt = () => { window.__PROMPT_N__++; return null; };
    window.__CLOSED__ = 0; window.__BADGE__ = 0; window.__HITS__ = [];
    try {
      navigator.serviceWorker.getRegistration = () => Promise.resolve({
        getNotifications: () => Promise.resolve([{ close(){ window.__CLOSED__++; } }]) });
    } catch (e) {}
    try { navigator.clearAppBadge = () => { window.__BADGE__++; return Promise.resolve(); }; } catch (e) {}
    // activity.js assigns window.BuckyActivity once; wrap hit() the moment it lands.
    Object.defineProperty(window, "BuckyActivity", { configurable: true, get(){ return undefined; },
      set(v){
        const orig = v.hit;
        v.hit = function(f){ window.__HITS__.push(String(f)); return orig.apply(this, arguments); };
        Object.defineProperty(window, "BuckyActivity", { value: v, writable: true, configurable: true });
      } });
  });
  const probe = async (url, user) => {
    const { page, errors } = await newPage(browser, { user });
    await instrument(page);
    await open(page, url, { rows: ALL_ROWS });
    await sleep(900);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));   // "came back to the page"
    await sleep(300);
    const r = await page.evaluate(() => ({
      prompts: window.__PROMPT_N__, closed: window.__CLOSED__, badge: window.__BADGE__, hits: window.__HITS__.slice(),
      heading: (() => { const h = document.getElementById("appHeading"); return h && h.offsetParent !== null ? h.textContent : null; })(),
      headingTop: (() => { const h = document.getElementById("appHeading"); return h ? Math.round(h.getBoundingClientRect().top) : null; })(),
    }));
    return Object.assign(r, { errors });
  };

  // Control: normal Bucky, Dad on a device that has not entered the PIN this session.
  const ctl = await probe("/index.html", "Dad");
  ok(ctl.prompts >= 1, `[control] normal Bucky DOES prompt a Dad profile for the PIN at boot (${ctl.prompts})`);
  ok(ctl.closed >= 1 && ctl.badge >= 1, `[control] normal Bucky DOES sweep the tray and badge (${ctl.closed} closed, ${ctl.badge} badge clears)`);
  ok(ctl.heading === null, "[control] normal Bucky has no app heading");

  for (const [id, A] of Object.entries(APPS)){
    const r = await probe(A.path, "Dad");   // WO_ROWS include a payout awaiting Dad, so the PIN prompt would have a reason to appear
    ok(r.prompts === 0, `[${id}] no PIN prompt at boot in app mode (${r.prompts})`);
    ok(r.closed === 0 && r.badge === 0, `[${id}] Bucky's tray and badge are left alone (${r.closed} closed, ${r.badge} badge clears)`);
    ok(r.hits.includes("app_" + A.tab), `[${id}] the visit is recorded as "app_${A.tab}" for the Activity page (hits: ${r.hits.join(",") || "none"})`);
    ok(r.hits.filter((h) => h === "app_" + A.tab).length === 1, `[${id}] ...exactly once per load, not once per render`);
    ok(r.errors.length === 0, `[${id}] no page errors` + (r.errors[0] ? " — " + r.errors[0] : ""));
    if (A.heading){
      ok(r.heading === A.heading, `[${id}] the page says what it is: a visible "${A.heading}" heading (${r.heading})`);
      ok(r.headingTop !== null && r.headingTop >= 0 && r.headingTop < 60, `[${id}] ...at the top of the page (${r.headingTop}px)`);
    } else {
      ok(r.heading === null, `[${id}] no extra heading, the tab opens with its own title`);
    }
  }
}

/* ============================ shared helpers (J-N) ============================ */
const R4 = (e) => { const r = e.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const toastTexts = (page) => page.evaluate(() => [...document.querySelectorAll("#toastWrap .toast")].map((t) => t.textContent));
async function waitFor(page, fn, arg, ms = 8000){ return page.waitForFunction(fn, { timeout: ms }, arg).then(() => true, () => false); }
const click = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
const clickText = (page, sel, text) => page.evaluate((s, t) => { const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().includes(t)); if (!el) return false; el.click(); return true; }, sel, text);
const fabRect = (page) => page.evaluate(() => { const el = document.getElementById("addFab"), r = el.getBoundingClientRect(), de = document.documentElement;
  const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height, gapB: de.clientHeight - r.bottom, gapR: de.clientWidth - r.right, cw: de.clientWidth, ch: de.clientHeight, onTop: mid === el }; });

/* ================================ J. the + button ================================ */
/* Work Orders and Calendar have no other way to create an item (the empty state even says "Tap the
   + button to add one"), so app mode keeps the FAB for them and for them alone. */
async function sectionFab(browser){
  section("J. The + button: on in Work Orders and Calendar only, clear of the bottom edge, opens the right sheet");
  for (const vp of [{ w:375, h:812 }, { w:1280, h:800 }]){
    for (const id of IDS){
      const A = APPS[id], tag = `${id} @${vp.w}x${vp.h}`;
      const { page, errors } = await newPage(browser, { viewport: { width: vp.w, height: vp.h } });
      await open(page, A.path); await ready(page, id);
      const f = await fabRect(page);
      if (!A.fab){
        ok(f.width === 0 && f.height === 0, `[${tag}] no + button (${f.width}x${f.height})`);
        ok(errors.length === 0, `[${tag}] no page errors${errors[0] ? ": " + errors[0] : ""}`);
        await page.close(); continue;
      }
      // 58px circle (the .fab rule); 20px above the bottom edge (no nav under it now, safe area is 0 in headless).
      ok(Math.abs(f.width - 58) < 0.5 && Math.abs(f.height - 58) < 0.5, `[${tag}] the button is 58x58 (${f.width}x${f.height})`);
      ok(Math.abs(f.gapB - 20) <= 0.5, `[${tag}] it sits 20px above the bottom edge, not the old 82px or 28px (${f.gapB}px)`);
      // Right gap: max(18, (100vw - 760) / 2 - 74): 18 on a phone; (1280 - 760) / 2 - 74 = 186 on the desktop window,
      // which parks the button in the margin beside the 760px column (column right edge = 1020, button left = 1280 - 186 - 58 = 1036).
      const wantR = Math.max(18, (vp.w - 760) / 2 - 74);
      ok(Math.abs(f.gapR - wantR) <= 0.5, `[${tag}] and ${wantR}px in from the right (${f.gapR}px)`);
      if (vp.w >= 1024) ok(f.left >= (vp.w + 760) / 2 + 16 - 0.5, `[${tag}] on a wide window it sits in the margin, clear of the 760px column (button left ${f.left} >= ${(vp.w + 760) / 2 + 16})`);
      ok(f.left >= 0 && f.top >= 0 && f.right <= f.cw && f.bottom <= f.ch, `[${tag}] entirely inside the viewport`);
      ok(f.onTop, `[${tag}] nothing is drawn over it (elementFromPoint at its centre is the button)`);
      // It opens the sheet this tab owns.
      await page.click("#addFab");
      const sheet = id === "workorders" ? { ov:"#woOverlay", title:"#woSheetTitle", text:"Add work order" } : { ov:"#calOverlay", title:"#calSheetTitle", text:"Add event" };
      const s = await page.evaluate((x) => { const o = document.querySelector(x.ov), r = o.getBoundingClientRect(); return { w:r.width, h:r.height, title:document.querySelector(x.title).textContent, shown:getComputedStyle(o).display !== "none" }; }, sheet);
      ok(s.shown && s.w > 200 && s.h > 200 && s.title === sheet.text, `[${tag}] tapping it opens "${sheet.text}" (${s.title}, ${s.w}x${s.h})`);
      await page.keyboard.press("Escape");
      await page.evaluate((x) => { document.querySelector(x).click(); }, id === "workorders" ? "#woCancelBtn" : "#calCancelBtn");
      await sleep(150);
      ok(await page.evaluate((o) => getComputedStyle(document.querySelector(o)).display === "none", sheet.ov), `[${tag}] and the sheet closes again`);

      if (id === "workorders"){
        // The last card's controls must be reachable: open the last group's last card, scroll to the end.
        await clickText(page, ".wo-group-head", "Unassigned"); await sleep(150);
        await page.evaluate(() => { const c = [...document.querySelectorAll("li.wo")]; c[c.length - 1].querySelector(".wo-sum").click(); }); await sleep(150);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(200);
        const g = await page.evaluate(() => { const last = [...document.querySelectorAll("li.wo")].pop(); const b = [...last.querySelectorAll("button")];
          const fr = document.getElementById("addFab").getBoundingClientRect(), r4 = (e) => { const r = e.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom }; };
          return { names: b.map((x) => x.textContent.trim()), rects: b.map(r4), fab: r4(document.getElementById("addFab")), y: window.scrollY, max: document.documentElement.scrollHeight - window.innerHeight }; });
        ok(g.names.some((n) => n.includes("Claim this job")) && g.rects.length >= 3, `[${tag}] the last card is open with its controls (${g.names.join(" | ")})`);
        ok(Math.abs(g.y - g.max) <= 1, `[${tag}] scrolled to the very end (y ${g.y}, max ${g.max})`);
        ok(g.rects.every((r) => !hit(r, g.fab)) && g.rects.every((r) => r.bottom <= g.fab.top), `[${tag}] no control of the last card is under the + button or below its top edge (lowest control bottom ${Math.max(...g.rects.map((r) => r.bottom))}, button top ${g.fab.top})`);
      }
      if (id === "calendar"){
        // Week and Day must scroll like any page, with the controls pinned at the top.
        for (const v of ["week", "day"]){
          await page.evaluate((x) => document.querySelector('.cal-viewseg button[data-view="' + x + '"]').click(), v); await sleep(500);
          const w = await page.evaluate(() => { window.scrollTo(0, 0); window.scrollTo(0, 300); return { h: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, y: window.scrollY, top: document.querySelector(".cal-controls").getBoundingClientRect().top }; });
          ok(w.h > w.ch && w.y === 300, `[${tag}] ${v} view scrolls (document ${w.h}px in a ${w.ch}px window, scrollY ${w.y})`);
          ok(Math.abs(w.top) <= 0.5, `[${tag}] ${v} view: the controls stay pinned at the very top while scrolled (top ${w.top})`);
          if (v === "day"){
            await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await sleep(150);
            const d = await page.evaluate(() => ({ wrap: document.querySelector(".cal-daywrap").getBoundingClientRect().bottom, fab: document.getElementById("addFab").getBoundingClientRect().top }));
            ok(d.wrap <= d.fab, `[${tag}] day view: the last slot ends above the + button (${d.wrap} <= ${d.fab})`);
          }
        }
      }
      ok(errors.length === 0, `[${tag}] no page errors${errors[0] ? ": " + errors[0] : ""}`);
      await page.close();
    }
  }
  // Denied: a fab app's card page must not offer the +.
  for (const id of ["workorders", "calendar"]){
    const { page } = await newPage(browser, { user:"Isaac", viewport:{ width:375, height:812 } });
    await open(page, APPS[id].path, { profiles: roster([APPS[id].cap]) });
    await sleep(900);
    const f = await fabRect(page);
    ok(f.width === 0 && f.height === 0 && await page.evaluate(() => !!document.getElementById("appDenied")), `[${id}] the denied card has no + button (${f.width}x${f.height})`);
    await page.close();
  }
}

/* ============================== K. Finance and the bank area ============================== */
async function sectionFinanceCap(browser){
  section("K. Finance shares the bank area with the kids' Farm Bank: a kid is refused, and nothing is fetched for them");
  const stocksCount = (fnLog) => fnLog.filter((n) => n === "stocks").length;

  // K1. Isaac is a kid: the AREA (bank) is open to him, seesFinance is not.
  {
    const { page, errors, fnLog, stocks } = await newPage(browser, { user:"Isaac", viewport:{ width:375, height:812 } });
    await open(page, "/finance");
    await sleep(3500);
    const d = await page.evaluate(() => ({ nav: window.__NAV__.permitted("bank", "Isaac"), card: (document.getElementById("appDenied") || {}).textContent || null, wrap: !!document.querySelector(".finwrap, .finmkt, .finrow"), tab: window.__NAV__.tab() }));
    ok(d.nav === true, "[kid] premise: navGroupPermitted(bank) is TRUE for Isaac (kidBank), so the area check alone would let him in");
    ok(d.card === APPS.finance.denied, `[kid] /finance shows: "${d.card}"`);
    ok(!d.wrap && d.tab === "finance", "[kid] none of Finance is drawn, and the app did not bounce Home");
    ok(stocksCount(fnLog) === 0 && stocks.log.length === 0, `[kid] no /.netlify/functions/stocks request was made in 3.5s (${stocksCount(fnLog)} seen, ${stocks.log.length} reached the mock)`);
    ok(errors.length === 0, `[kid] no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }
  // K2. Identity gate first: nothing fires while nobody is picked, nor after Isaac is.
  {
    const { page, errors, fnLog } = await newPage(browser, { user:null });
    await open(page, "/finance");
    await page.waitForFunction(() => window.__IDGATE__ && window.__IDGATE__.showing(), { timeout: 15000 }).catch(() => {});
    await sleep(1200);
    ok(stocksCount(fnLog) === 0 && await page.evaluate(() => !document.querySelector(".finwrap")), "[gate] while the \"Who's this?\" screen is up, Finance is not drawn and nothing is fetched");
    await page.evaluate(() => [...document.querySelectorAll("#idGateRoster button")].find((b) => b.textContent.trim() === "Isaac").click());
    await sleep(3500);
    ok(await page.evaluate(() => (document.getElementById("appDenied") || {}).textContent) === APPS.finance.denied && stocksCount(fnLog) === 0, "[gate] picking Isaac gives the denied card and still no stocks request");
    ok(errors.length === 0, `[gate] no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }
  // K3. Control: the same gate, picking Grandma, DOES draw Finance and DOES fetch (so the counter can see a request).
  {
    const { page, fnLog } = await newPage(browser, { user:null });
    await open(page, "/finance");
    await page.waitForFunction(() => window.__IDGATE__ && window.__IDGATE__.showing(), { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => [...document.querySelectorAll("#idGateRoster button")].find((b) => b.textContent.trim() === "Grandma").click());
    await ready(page, "finance");
    ok(stocksCount(fnLog) >= 1, `[gate control] picking Grandma draws Finance and the stocks function is called (${stocksCount(fnLog)} calls)`);
    await page.close();
  }
  // K4. Dad (parent) and Grandma (extended) get Finance.
  for (const user of ["Dad", "Grandma"]){
    const { page, errors, fnLog } = await newPage(browser, { user, viewport:{ width:375, height:812 } });
    await open(page, "/finance"); await ready(page, "finance");
    ok(await page.evaluate(() => !document.getElementById("appDenied")) && stocksCount(fnLog) >= 1, `[${user}] gets Finance (markets drawn, stocks called ${stocksCount(fnLog)}x)`);
    ok(errors.length === 0, `[${user}] no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }
  // K5. The gate is the profile's own capability, not the role name: a kid GRANTED seesFinance gets in;
  //     Grandma with seesFinance denied is refused through the area check (bank = kidBank || bankAdminUI || seesFinance).
  {
    const granted = roster().map((p) => p.pid === "isaac" ? Object.assign({}, p, { grant:["seesFinance"] }) : p);
    const a = await newPage(browser, { user:"Isaac" });
    await open(a.page, "/finance", { profiles: granted });
    // Isaac has no watchlist seeded, so wait for the three market tiles rather than the two watchlist rows.
    ok(await waitFor(a.page, () => document.querySelectorAll(".finmkt-p").length === 3), "[kid + grant] a kid whose profile grants seesFinance is let in: the three market tiles draw (the check is can(), not the role)");
    ok(await a.page.evaluate(() => !document.getElementById("appDenied")), "[kid + grant] and no denied card");
    await a.page.close();
    const denied = roster().map((p) => p.pid === "grandma" ? Object.assign({}, p, { deny:["seesFinance"] }) : p);
    const b = await newPage(browser, { user:"Grandma" });
    await open(b.page, "/finance", { profiles: denied });
    await sleep(2500);
    ok(await b.page.evaluate(() => (document.getElementById("appDenied") || {}).textContent) === APPS.finance.denied && stocksCount(b.fnLog) === 0, "[grandma - seesFinance] refused with the same card, nothing fetched");
    await b.page.close();
  }
  // K6. Normal Bucky is unchanged: the kid still reaches Farm Bank (kidBank), and is still bounced from Finance.
  {
    const { page, errors } = await newPage(browser, { user:"Isaac" });
    await open(page, "/index.html#farmbank"); await sleep(1500);
    ok(await page.evaluate(() => window.__NAV__.tab()) === "farmbank", "[normal Bucky] a kid opening #farmbank stays on Farm Bank");
    await page.evaluate(() => window.__NAV__.goTo("finance")); await sleep(400);
    ok(await page.evaluate(() => window.__NAV__.tab()) !== "finance", "[normal Bucky] a kid sent to Finance is still bounced off it");
    ok(errors.length === 0, `[normal Bucky] no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }
}

/* =================== L. the calendar's pinned month view, with no header or nav =================== */
async function sectionCalendarGeometry(browser){
  section("L. Calendar month view: pinned page, controls under the safe area, agenda card above the + button");
  for (const vp of [{ w:375, h:812 }, { w:1280, h:800 }]){
    const tag = `calendar @${vp.w}x${vp.h}`;
    const { page, errors } = await newPage(browser, { viewport: { width: vp.w, height: vp.h } });
    await open(page, "/calendar"); await ready(page, "calendar");
    await sleep(400);
    const m = await page.evaluate(() => {
      const de = document.documentElement, card = document.querySelector(".cal-agenda .cal-daycard.scrolly"), ctl = document.querySelector(".cal-controls");
      const fab = document.getElementById("addFab").getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      window.scrollTo(0, 500);
      const rows = [...card.querySelectorAll(".cal-evrow")].map((row) => {
        const rr = row.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(row.querySelector(".cal-evname")); const t = rg.getBoundingClientRect();
        const visible = rr.bottom > cr.top && rr.top < cr.bottom;
        return { visible, text: { left:t.left, right:t.right, top:t.top, bottom:t.bottom }, name: row.querySelector(".cal-evname").textContent };
      });
      return {
        docH: de.scrollHeight, winH: window.innerHeight, scrollY: window.scrollY,
        ctlTop: ctl.getBoundingClientRect().top, ctlPos: getComputedStyle(ctl).position, stickyVar: de.style.getPropertyValue("--cal-sticky-top"),
        cardTop: cr.top, cardBottom: cr.bottom, cardLeft: cr.left, cardRight: cr.right, cardH: cr.height, cardScroll: card.scrollHeight, cardClient: card.clientHeight,
        fab: { left:fab.left, right:fab.right, top:fab.top, bottom:fab.bottom }, rows, padB: parseFloat(getComputedStyle(document.body).paddingBottom),
        bnavH: document.getElementById("bnav").getBoundingClientRect().height, hdrH: document.querySelector("header").getBoundingClientRect().height,
      };
    });
    ok(m.hdrH === 0 && m.bnavH === 0, `[${tag}] premise: header and bottom nav both measure 0 (${m.hdrH}, ${m.bnavH}), so the nav-based sizing sees nothing to subtract`);
    ok(m.docH <= m.winH, `[${tag}] the document does not scroll in month view (scrollHeight ${m.docH} <= window ${m.winH})`);
    ok(m.scrollY === 0, `[${tag}] and scrollTo(0, 500) does not move it (scrollY ${m.scrollY})`);
    ok(m.padB === 0, `[${tag}] the body keeps no bottom padding in the pinned view (${m.padB}px)`);
    ok(m.ctlPos === "sticky" && m.stickyVar === "0px", `[${tag}] controls are sticky at --cal-sticky-top = ${m.stickyVar} (the safe-area inset, 0 here), not a stale header height`);
    ok(m.cardBottom <= m.winH, `[${tag}] the agenda card's bottom (${Math.round(m.cardBottom)}) is inside the window (${m.winH})`);
    // Phone: the button floats over the card's column, so the card must stop 10px above it. Desktop: it is in the margin, beside the card.
    const overX = m.fab.left < m.cardRight && m.fab.right > m.cardLeft;
    ok(overX === (vp.w < 1024), `[${tag}] the button ${vp.w < 1024 ? "overlaps" : "does not overlap"} the card's columns (button ${Math.round(m.fab.left)}-${Math.round(m.fab.right)}, card ${Math.round(m.cardLeft)}-${Math.round(m.cardRight)})`);
    ok(!overX || m.cardBottom <= m.fab.top - 9.5, `[${tag}] and where it does, the card stops at least 10px above it (card bottom ${Math.round(m.cardBottom)}, button top ${Math.round(m.fab.top)})`);
    ok(m.cardH >= 150, `[${tag}] and is still usable (${Math.round(m.cardH)}px tall, the 150px floor)`);
    ok(m.cardScroll > m.cardClient, `[${tag}] eight events do not fit, so the card scrolls inside itself (content ${m.cardScroll}px in ${m.cardClient}px)`);
    const vis = m.rows.filter((r) => r.visible);
    ok(vis.length >= 1 && vis.every((r) => !hit(r.text, m.fab)), `[${tag}] the text of every visible agenda row (${vis.length}) is clear of the + button`);
    // Scroll the card to its end: the last row (Zebra event 8) is the last visible one, and still clear.
    await page.evaluate(() => { const c = document.querySelector(".cal-agenda .cal-daycard.scrolly"); c.scrollTop = c.scrollHeight; });
    await sleep(150);
    const last = await page.evaluate(() => { const card = document.querySelector(".cal-agenda .cal-daycard.scrolly"), cr = card.getBoundingClientRect(), rows = [...card.querySelectorAll(".cal-evrow")], row = rows[rows.length - 1];
      const rg = document.createRange(); rg.selectNodeContents(row.querySelector(".cal-evname")); const t = rg.getBoundingClientRect(), f = document.getElementById("addFab").getBoundingClientRect();
      return { name: row.querySelector(".cal-evname").textContent, inCard: t.bottom <= cr.bottom + 0.5 && t.top >= cr.top, t: { left:t.left, right:t.right, top:t.top, bottom:t.bottom }, f: { left:f.left, right:f.right, top:f.top, bottom:f.bottom } }; });
    ok(last.name === "Zebra event 8" && last.inCard && !hit(last.t, last.f), `[${tag}] scrolled to the end, the last row "${last.name}" is fully inside the card and not under the + button`);

    // The safe-area inset: headless has none, so give the body one and let the calendar re-sync.
    await page.evaluate(() => { const s = document.createElement("style"); s.id = "fakeSafe"; s.textContent = "html[data-app] body{padding-top:47px}"; document.head.appendChild(s); });
    await page.evaluate(() => document.querySelector('.cal-viewseg button[data-view="week"]').click()); await sleep(500);
    const sa = await page.evaluate(() => { window.scrollTo(0, 0); window.scrollTo(0, 400); const ctl = document.querySelector(".cal-controls");
      return { y: window.scrollY, top: ctl.getBoundingClientRect().top, cssTop: getComputedStyle(ctl).top, v: document.documentElement.style.getPropertyValue("--cal-sticky-top") }; });
    ok(sa.v === "47px" && sa.cssTop === "47px", `[${tag}] with a 47px top safe area the sticky offset becomes 47px (var ${sa.v}, computed top ${sa.cssTop})`);
    ok(sa.y === 400 && Math.abs(sa.top - 47) <= 0.5, `[${tag}] and the scrolled controls stop 47px from the top, below the status bar (top ${sa.top})`);
    ok(errors.length === 0, `[${tag}] no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }
  // Control: normal Bucky's month view is sized by the bottom nav exactly as before.
  {
    const { page, errors } = await newPage(browser, { viewport:{ width:375, height:812 } });
    await open(page, "/index.html#calendar"); await sleep(1800);
    const n = await page.evaluate(() => { const card = document.querySelector(".cal-agenda .cal-daycard.scrolly"), de = document.documentElement; if (!card) return null;
      return { docH: de.scrollHeight, winH: window.innerHeight, cardBottom: card.getBoundingClientRect().bottom, bnavH: document.getElementById("bnav").getBoundingClientRect().height, fabShown: document.getElementById("addFab").offsetWidth > 0 }; });
    ok(!!n && n.docH <= n.winH && n.bnavH > 0 && n.cardBottom <= n.winH - n.bnavH, `[normal Bucky] month view still pins to the bottom nav (doc ${n && n.docH} <= ${n && n.winH}, card bottom ${n && Math.round(n.cardBottom)} <= ${n && Math.round(n.winH - n.bnavH)})`);
    ok(errors.length === 0, `[normal Bucky calendar] no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }
}

/* ===================== M. the three apps still do their jobs without the chrome ===================== */
async function sectionFlows(browser){
  section("M. Work Orders, Calendar and Finance: add, edit, close, payout, save, notify, markets");
  const here = (page, id) => page.evaluate((p, t) => location.pathname === p && window.__NAV__.tab() === t, APPS[id].path, APPS[id].tab);
  const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("buckyData1") || "[]"));

  /* ---- Work Orders, as Grandma ---- */
  {
    const { page, errors } = await newPage(browser, { viewport:{ width:375, height:812 } });
    await open(page, "/workorders"); await ready(page, "workorders");
    // add: the + button, a name, Save.
    await page.click("#addFab"); await sleep(200);
    await page.type("#woName", "Zebra new job");
    await click(page, "#woSaveBtn");
    ok(await waitFor(page, () => document.getElementById("progressText").textContent === "6 open · 0 completed"), "[wo add] saving a new order raises the count from 5 to 6 open");
    const t = await toastTexts(page);
    ok(t.length === 1 && t[0].startsWith("Work order created"), `[wo add] the app's own "Work order created" toast shows (${JSON.stringify(t)})`);
    ok((await stored(page)).some((r) => r.frequency === "workorder" && r.name === "Zebra new job" && r.createdBy === "Grandma" && r.done === false), "[wo add] it is stored as an open work order created by Grandma");
    await clickText(page, ".wo-group-head", "Unassigned"); await sleep(150);
    ok(await page.evaluate(() => [...document.querySelectorAll("li.wo .name")].some((e) => e.textContent === "Zebra new job")), "[wo add] it appears under Unassigned");
    // edit: open Grandma's "Zebra fix fence", Edit, rename.
    await page.evaluate(() => [...document.querySelectorAll("li.wo")].find((l) => l.textContent.includes("Zebra fix fence")).querySelector(".wo-sum").click()); await sleep(150);
    ok(await page.evaluate(() => { const l = [...document.querySelectorAll("li.wo")].find((x) => x.textContent.includes("Zebra fix fence")); return !!l.querySelector(".wo-desc") && l.querySelector(".wo-desc").textContent === "Replace two boards" && l.querySelector(".wo-amt").textContent === "$10"; }), "[wo edit] the opened card shows its description and its $10");
    await page.evaluate(() => [...document.querySelectorAll("li.wo")].find((x) => x.textContent.includes("Zebra fix fence")).querySelectorAll(".wo-link"));
    await page.evaluate(() => { const l = [...document.querySelectorAll("li.wo")].find((x) => x.textContent.includes("Zebra fix fence")); [...l.querySelectorAll(".wo-link")].find((b) => b.textContent === "Edit").click(); }); await sleep(200);
    const e1 = await page.evaluate(() => ({ title: document.getElementById("woSheetTitle").textContent, name: document.getElementById("woName").value, value: document.getElementById("woValue").value }));
    ok(e1.title === "Edit work order" && e1.name === "Zebra fix fence" && e1.value === "10", `[wo edit] the sheet opens on the order (${e1.title}, "${e1.name}", $${e1.value})`);
    await page.evaluate(() => { document.getElementById("woName").value = "Zebra fix gate"; });
    await click(page, "#woSaveBtn"); await sleep(400);
    ok(await page.evaluate(() => [...document.querySelectorAll("li.wo .name")].some((e) => e.textContent === "Zebra fix gate") && ![...document.querySelectorAll("li.wo .name")].some((e) => e.textContent === "Zebra fix fence")), "[wo edit] the card now reads \"Zebra fix gate\"");
    ok((await toastTexts(page)).some((x) => x.startsWith("Work order updated")), "[wo edit] and the \"Work order updated\" toast shows");
    ok(await here(page, "workorders"), "[wo] after add and edit it is still /workorders on the workorders tab");
    ok(errors.length === 0, `[wo add/edit] no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }
  // mark done (no money: no payout step). Fresh page so the counts are the fixture's.
  {
    const { page, errors } = await newPage(browser, { viewport:{ width:375, height:812 } });
    await open(page, "/workorders"); await ready(page, "workorders");
    await page.evaluate(() => [...document.querySelectorAll("li.wo")].find((l) => l.textContent.includes("Zebra sweep porch")).querySelector(".wo-sum").click()); await sleep(150);
    ok(await page.evaluate(() => { const l = [...document.querySelectorAll("li.wo")].find((x) => x.textContent.includes("Zebra sweep porch")); return l.querySelector(".wo-primary").textContent.includes("Close work order"); }), "[wo close] the opened card offers \"Close work order\"");
    await page.evaluate(() => [...document.querySelectorAll("li.wo")].find((l) => l.textContent.includes("Zebra sweep porch")).querySelector(".wo-primary").click()); await sleep(200);
    ok(await page.evaluate(() => getComputedStyle(document.getElementById("woCompleteOverlay")).display !== "none"), "[wo close] the completion sheet opens");
    await click(page, "#woCompleteBtn");
    // before: 5 active (wo1..wo4 + the payout card). Closing wo2, assigned to an adult with no value: 4 open, 1 completed.
    ok(await waitFor(page, () => document.getElementById("progressText").textContent === "4 open · 1 completed"), "[wo close] closing it moves the count from \"5 open · 0 completed\" to \"4 open · 1 completed\"");
    const row = (await stored(page)).find((r) => r.id === "wo2");
    ok(row && row.done === true && row.doneBy === "Grandma" && row.payoutPending === false, "[wo close] stored as done by Grandma with no payout pending (an adult's order has no payout step)");
    ok(await here(page, "workorders") && errors.length === 0, `[wo close] still /workorders, no page errors${errors[0] ? ": " + errors[0] : ""}`);
    // Grandma cannot approve payouts: no PIN button for her, and no prompt.
    ok(await page.evaluate(() => !document.getElementById("woPinBtn") && !document.querySelector(".payout-confirm-btn")) && await page.evaluate(() => window.__PROMPT_COUNT__) === 0, "[wo payout] Grandma (no approvePayouts) sees the payout card read-only: no PIN button, no Confirm, no prompt");
    await page.close();
  }
  // The Dad payout: the boot-time PIN greeting is off in app mode, so the on-demand prompt is the only way.
  {
    const { page, errors } = await newPage(browser, { user:"Dad", viewport:{ width:375, height:812 } });
    await page.evaluateOnNewDocument(() => { window.__PROMPT_ANSWER__ = "1234"; });
    await open(page, "/workorders");
    // Dad has no orders of his own, so only the payout card is open (not Grandma's three).
    ok(await waitFor(page, () => document.querySelectorAll("li.wo").length === 1 && !!document.getElementById("woPinBtn")), "[wo payout] Dad sees one open card: the payout awaiting him");
    await sleep(600);
    const pre = await page.evaluate(() => ({ prompts: window.__PROMPT_COUNT__, pin: (document.getElementById("woPinBtn") || {}).textContent || null, confirm: [...document.querySelectorAll(".payout-confirm-btn")].map((b) => b.textContent) }));
    ok(pre.prompts === 0, `[wo payout] Dad is not asked for a PIN at boot (${pre.prompts} prompts)`);
    ok(pre.pin === "Enter Dad PIN to confirm $7" && pre.confirm.length === 1, `[wo payout] the payout card offers "${pre.pin}" instead of a dead end (buttons: ${pre.confirm})`);
    await click(page, "#woPinBtn");
    ok(await waitFor(page, () => !document.getElementById("woPinBtn") && !!document.querySelector(".payout-confirm-btn")), "[wo payout] after the PIN is accepted the Confirm button replaces it");
    const post = await page.evaluate(() => ({ prompts: window.__PROMPT_COUNT__, confirm: (document.querySelector(".payout-confirm-btn") || {}).textContent || "" }));
    ok(post.prompts === 2 && post.confirm.startsWith("Confirm $7") && post.confirm.includes("Isaac"), `[wo payout] on-demand: the PIN was asked for twice (set and re-enter, no PIN existed yet), and the button reads "${post.confirm}"`);
    await click(page, ".payout-confirm-btn");
    // before: 5 active (wo1..wo4 + payout). Confirmed: the card closes, so 4 open · 1 completed.
    ok(await waitFor(page, () => document.getElementById("progressText").textContent === "4 open · 1 completed"), "[wo payout] confirming closes the payout card: \"4 open · 1 completed\"");
    const st = await stored(page);
    const led = st.filter((r) => r.frequency === "kidbank" && r.kid === "Isaac" && r.kind === "workorder");
    ok(led.length === 1 && led[0].amount === 7 && led[0].by === "Dad", `[wo payout] exactly one ledger entry: Isaac +$7 by Dad (${led.map((l) => l.amount + "/" + l.by)})`);
    ok(st.find((r) => r.id === "wo5").payoutPending === false, "[wo payout] and the order no longer awaits a payout");
    ok(await here(page, "workorders") && errors.length === 0, `[wo payout] still /workorders, no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }
  // Same, with a PIN already set: a wrong PIN keeps the button, the right one opens it.
  {
    const hash = require("crypto").createHash("sha256").update("1234:amenfarms").digest("hex");
    const { page, errors } = await newPage(browser, { user:"Dad", viewport:{ width:375, height:812 } });
    await open(page, "/workorders", { ls: { dadPinHash: hash } });
    await waitFor(page, () => !!document.getElementById("woPinBtn"));
    await page.evaluate(() => { window.__PROMPT_ANSWER__ = "0000"; });
    await click(page, "#woPinBtn"); await sleep(500);
    ok(await page.evaluate(() => window.__PROMPT_COUNT__) === 1 && await page.evaluate(() => !!document.getElementById("woPinBtn")), "[wo payout, PIN set] a wrong PIN asks once and leaves the PIN button in place");
    await page.evaluate(() => { window.__PROMPT_ANSWER__ = "1234"; });
    await click(page, "#woPinBtn");
    ok(await waitFor(page, () => !!document.querySelector(".payout-confirm-btn") && !document.getElementById("woPinBtn")), "[wo payout, PIN set] the right PIN reveals Confirm");
    ok(errors.length === 0, `[wo payout, PIN set] no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }
  // Empty state: its own words point at the + button, and the + button is there.
  {
    const { page } = await newPage(browser, { viewport:{ width:375, height:812 } });
    await open(page, "/workorders", { rows: [] });
    await waitFor(page, () => document.getElementById("empty").offsetHeight > 0);
    const em = await page.evaluate(() => ({ text: document.getElementById("empty").innerText.replace(/\s+/g, " ").trim(), shown: document.getElementById("empty").offsetHeight > 0, fab: document.getElementById("addFab").offsetWidth > 0, count: document.getElementById("progressText").textContent }));
    ok(em.shown && em.text === "No work orders yet. Tap the + button to add one." && em.fab, `[wo empty] "${em.text}" is shown and the + button it mentions is on screen`);
    ok(em.count === "No work orders", `[wo empty] count line: "${em.count}"`);
    await page.close();
  }

  /* ---- Calendar, as Grandma ---- */
  {
    const { page, errors, cal } = await newPage(browser, { viewport:{ width:375, height:812 } });
    await open(page, "/calendar"); await ready(page, "calendar");
    const today = ymd(new Date());
    await page.click("#addFab"); await sleep(250);
    const sh = await page.evaluate(() => ({ title: document.getElementById("calSheetTitle").textContent, date: document.getElementById("calEvDate").value, notify: [...document.querySelectorAll("#calNotifyList input[type=checkbox]")].map((c) => c.dataset.name + ":" + c.dataset.pid + ":" + c.checked) }));
    ok(sh.title === "Add event" && sh.date === today, `[cal add] the + button opens "Add event" on the selected day (${sh.date} = ${today})`);
    ok(sh.notify.join() === "Dad:dad:false,Grandma:grandma:false,Isaac:isaac:false", `[cal add] the per-event Notify picker lists the three family members, none ticked (${sh.notify})`);
    await page.type("#calEvTitle", "Zebra picnic");
    await page.evaluate(() => { const s = document.getElementById("calEvStart"), e = document.getElementById("calEvEnd"); s.value = "14:00"; s.dispatchEvent(new Event("input", { bubbles:true })); e.value = "15:00"; e.dispatchEvent(new Event("input", { bubbles:true }));
      [...document.querySelectorAll("#calNotifyList input[type=checkbox]")].find((c) => c.dataset.name === "Isaac").click(); });
    await click(page, "#calSaveBtn");
    ok(await waitFor(page, () => document.querySelectorAll(".cal-evrow").length === 9), "[cal add] the saved event joins today's agenda (8 -> 9 rows)");
    const create = cal.log.filter((b) => b.action === "create");
    ok(create.length === 1 && create[0].event.title === "Zebra picnic" && create[0].event.start === today + "T14:00:00" && create[0].event.end === today + "T15:00:00" && create[0].event.allDay === false, `[cal add] one create request: title, ${today}T14:00:00 to T15:00:00, not all-day`);
    ok(JSON.stringify(create[0].event.notify) === '["isaac"]' && create[0].secret === "amenfarms", `[cal add] the Notify tick travels as the pid ["isaac"] with the family password (${JSON.stringify(create[0].event.notify)})`);
    const tt = await toastTexts(page);
    ok(tt.some((x) => x.startsWith("Event added")), `[cal add] the app's own "Event added" toast shows (${JSON.stringify(tt)})`);
    ok(await here(page, "calendar"), "[cal add] still /calendar on the calendar tab");
    // preview -> edit
    await page.evaluate(() => document.querySelector(".cal-evrow").click()); await sleep(200);
    const pv = await page.evaluate(() => ({ open: getComputedStyle(document.getElementById("calPreviewOverlay")).display !== "none", title: document.getElementById("calPvTitle").textContent }));
    ok(pv.open && pv.title === "Zebra event 1", `[cal preview] tapping an agenda row opens its preview (${pv.title})`);
    await click(page, "#calPvEditBtn"); await sleep(250);
    const ed = await page.evaluate(() => ({ title: document.getElementById("calSheetTitle").textContent, name: document.getElementById("calEvTitle").value, start: document.getElementById("calEvStart").value }));
    ok(ed.title === "Edit event" && ed.name === "Zebra event 1" && ed.start === "06:00", `[cal edit] the preview's Edit opens the editor on the event (${ed.title}, "${ed.name}", ${ed.start})`);
    ok(errors.length === 0, `[cal add/edit] no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }
  // Refusals, with the shapes calendar.mjs returns.
  for (const [mode, want, label] of [["google-error", "Google wouldn't accept that change (Insufficient permission to edit this calendar)", "Google refuses (HTTP 200 {error, detail})"], ["http500", "Couldn't save — check your connection (HTTP 500)", "the function crashes (HTTP 500)"]]){
    const { page, errors, cal } = await newPage(browser, { viewport:{ width:375, height:812 } });
    await open(page, "/calendar"); await ready(page, "calendar");
    cal.mode = mode;
    await page.click("#addFab"); await sleep(200);
    await page.type("#calEvTitle", "Zebra refused");
    await click(page, "#calSaveBtn");
    ok(await waitFor(page, (w) => [...document.querySelectorAll("#toastWrap .toast")].some((t) => t.textContent.includes(w)), want), `[cal error] ${label}: the toast says "${want}"`);
    ok(await page.evaluate(() => !document.querySelector(".cal-evrow .cal-evname") || ![...document.querySelectorAll(".cal-evname")].some((e) => e.textContent === "Zebra refused")), "[cal error] and the refused event is not shown");
    ok(errors.length === 0, `[cal error ${mode}] no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }
  // Not set up yet: status says configured:false, the tab shows the setup card (and the + button is still just a button).
  {
    const { page, errors, cal } = await newPage(browser, { viewport:{ width:375, height:812 } });
    cal.configured = false;
    await open(page, "/calendar");
    ok(await waitFor(page, () => !!document.querySelector(".cal-setup")), "[cal unconfigured] status {configured:false} shows the setup card");
    ok(await page.evaluate(() => !document.querySelector(".cal-evrow")) && errors.length === 0, `[cal unconfigured] no events drawn, no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }

  /* ---- Finance, as Dad ---- */
  {
    const { page, errors, stocks } = await newPage(browser, { user:"Dad", viewport:{ width:375, height:812 } });
    await open(page, "/finance"); await ready(page, "finance");
    const first = stocks.log.filter((b) => b.action === "series");
    const sy = (first[first.length - 1].symbols || []).slice().sort();
    ok(first.length >= 1 && JSON.stringify(sy) === JSON.stringify(["AAPL", "CL=F", "MSFT", "^DJI", "^GSPC"]), `[fin] one series request carries the 3 market symbols and the 2 watchlist symbols (${sy})`);
    ok(first.every((b) => b.secret === "amenfarms" && !b.range), "[fin] sent with the family password and no range (the default 3-month series)");
    // open a row, the range pills
    await page.evaluate(() => [...document.querySelectorAll(".finrow")].find((r) => r.dataset.sym === "AAPL").querySelector(".finrow-open").click());
    ok(await waitFor(page, () => getComputedStyle(document.getElementById("finSheetOverlay")).display !== "none" && document.querySelectorAll(".finrangepills button").length === 4), "[fin range] tapping AAPL opens its sheet with four range pills");
    const p0 = await page.evaluate(() => [...document.querySelectorAll(".finrangepills button")].map((b) => b.textContent + (b.classList.contains("sel") ? "*" : "")));
    ok(p0.join() === "Day,Week,Month*,Year", `[fin range] Month is selected first (${p0})`);
    for (const [label, key] of [["Week", "week"], ["Year", "year"], ["Day", "day"]]){
      const before = stocks.log.filter((b) => b.action === "series" && b.range === key).length;
      await clickText(page, ".finrangepills button", label);
      ok(await waitFor(page, (l) => [...document.querySelectorAll(".finrangepills button")].find((b) => b.textContent === l).classList.contains("sel"), label), `[fin range] tapping ${label} selects it`);
      await waitFor(page, () => !!document.querySelector(".finchartbox svg"));
      const after = stocks.log.filter((b) => b.action === "series" && b.range === key);
      ok(after.length === before + 1 && after[after.length - 1].symbols.join() === "AAPL", `[fin range] ${label} fetched exactly one AAPL series with range "${key}" (${after.length - before} request)`);
    }
    const svg = await page.evaluate(() => { const s = document.querySelector(".finchartbox svg"); return s ? s.getBoundingClientRect().width : 0; });
    ok(svg > 200, `[fin range] a chart is drawn in the sheet (${Math.round(svg)}px wide)`);
    await page.evaluate(() => window.__FIN__.closeDetail());
    ok(await here(page, "finance") && errors.length === 0, `[fin] still /finance on the finance tab, no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }
  // A failing upstream: the tab says so and does not crash.
  {
    const { page, errors, stocks } = await newPage(browser, { user:"Dad", viewport:{ width:375, height:812 } });
    stocks.fail = true;
    await open(page, "/finance");
    ok(await waitFor(page, () => document.body.textContent.includes("Couldn't load market data just now.")), "[fin error] a 500 from the stocks function shows \"Couldn't load market data just now.\"");
    ok(errors.length === 0, `[fin error] no page errors${errors[0] ? ": " + errors[0] : ""}`);
    await page.close();
  }
}

/* ===================== N. dead-end audit: nothing in these tabs leaves the tab ===================== */
function sectionAudit(){
  section("N. Audit of the three tabs' code: no control goes to another tab, the bell, or hidden chrome");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").replace(/\r/g, "");
  const body = (name) => { const m = html.match(new RegExp("\\n(?:async )?function " + name + "\\(")); if (!m) return null; const i = m.index; const j = html.indexOf("\n}\n", i); return html.slice(i, j + 3); };
  const FNS = ["renderWorkOrders", "buildWoCard", "woGroupHeader", "openWorkOrderSheet", "saveWorkOrder", "openCompleteSheet", "markWorkOrderComplete", "reopenWorkOrder", "confirmPayout", "notYetPayout", "openProgressSheet", "saveProgress", "openMilestonesView", "openCopySheet", "createWorkOrderCopy",
    "renderCalendar", "buildCalMonth", "buildCalWeek", "buildCalDay", "buildCalAgendaList", "buildCalSetup", "openCalEventPreview", "openCalEventSheet", "saveCalEvent", "doCalDelete", "renderCalNotifyList", "notifyCalEvent",
    "renderFinance", "finBuildMarkets", "finBuildRow", "finBuildWatchlist", "finOpenDetail", "finBuildChartSection", "finPaintDetail"];
  const missing = FNS.filter((f) => !body(f));
  ok(missing.length === 0, "all " + FNS.length + " functions audited were found in index.html" + (missing.length ? " (missing: " + missing + ")" : ""));
  const bad = [];
  for (const f of FNS){
    const b = body(f); if (!b) continue;
    for (const re of [/\bgoTo\(/, /location\.href/, /location\.assign/, /window\.location/, /notifOverlay/, /bellBtn/, /whoBtn/, /openNotif/, /subnav/i, /goTo(WorkOrders|Calendar|FarmBank|Print3D)/, /\bwindow\.open\(/]){
      if (re.test(b)) bad.push(f + " ~ " + re);
    }
  }
  ok(bad.length === 0, "none of them calls goTo, assigns location, opens the bell or touches the sub-nav" + (bad.length ? " (found: " + bad + ")" : ""));
  // The only links are the news/citation/linkify ones, and they open a new tab.
  const links = [];
  for (const f of FNS){ const b = body(f); if (!b) continue; for (const m of b.matchAll(/\.href\s*=\s*([^;\n]+)/g)) links.push(f + ": " + m[1].slice(0, 40)); }
  ok(links.every((l) => /c\.url|m\[0\]/.test(l)), "every href these tabs assign is an external link (citation url, linkified text): " + links.join(" | "));
  const targets = ["finPaintDetail", "finBuildChartSection", "openMilestonesView"].map(body).filter(Boolean).join("\n") + (html.match(/function linkify[\s\S]*?\n}\n/) || [""])[0];
  ok(/a\.target = "_blank"/.test(targets) && /noopener/.test(targets), "and each of those anchors opens in a new tab with rel=noopener (it leaves the app, it does not replace it)");
}

/* =============================== S. screenshot plates (--shots) =============================== */
async function shotPlates(browser){
  if (!SHOTS) return;
  section("S. Screenshot plates (" + SHOTS + ")");
  fs.mkdirSync(SHOTS, { recursive: true });
  const plates = [
    { name:"workorders_orders", id:"workorders", url:"/workorders", act: async (p) => { await clickText(p, ".wo-group-head", "Unassigned"); await sleep(150);
        await p.evaluate(() => [...document.querySelectorAll("li.wo")].find((l) => l.textContent.includes("Zebra fix fence")).querySelector(".wo-sum").click()); } },
    { name:"workorders_empty", id:"workorders", url:"/workorders", rows:[], noReady:true, act: async (p) => { await waitFor(p, () => document.getElementById("empty").offsetHeight > 0); } },
    { name:"workorders_dad_payout", id:"workorders", url:"/workorders", user:"Dad", noReady:true, act: async (p) => { await waitFor(p, () => !!document.getElementById("woPinBtn")); } },
    { name:"calendar_month", id:"calendar", url:"/calendar" },
    { name:"calendar_addsheet", id:"calendar", url:"/calendar", act: async (p) => { await p.click("#addFab"); await sleep(400); } },
    { name:"finance_data", id:"finance", url:"/finance", user:"Dad" },
    { name:"finance_kid_denied", id:"finance", url:"/finance", user:"Isaac", noReady:true, act: async (p) => { await waitFor(p, () => !!document.getElementById("appDenied")); } },
  ];
  for (const vp of [{ w:375, h:812 }, { w:1280, h:800 }]){
    for (const pl of plates){
      const { page } = await newPage(browser, { user: pl.user || "Grandma", viewport:{ width: vp.w, height: vp.h } });
      await open(page, pl.url, pl.rows ? { rows: pl.rows } : {});
      if (!pl.noReady) await ready(page, pl.id);
      if (pl.act) await pl.act(page);
      await sleep(500);
      await page.evaluate(() => window.scrollTo(0, 0));
      const file = path.join(SHOTS, `${pl.name}_${vp.w}x${vp.h}.png`);
      await page.screenshot({ path: file });
      ok(fs.existsSync(file) && fs.statSync(file).size > 3000, `plate ${path.basename(file)} written`);
      await page.close();
    }
  }
}

async function shotIcons(browser){
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const { page } = await newPage(browser, { viewport: { width: 1000, height: 1700 } });
  const imgs = IDS.flatMap((id) => [id + "-192", id + "-512", id + "-maskable-512", id + "-apple-touch"])
    .map((n) => `<figure style="margin:0;text-align:center;font:12px sans-serif"><img src="${BASE}/icons/${n}.png" width="200" height="200" style="background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/20px 20px"><div>${n}</div></figure>`).join("");
  const circles = IDS.map((id) => id + "-maskable-512")
    .map((n) => `<figure style="margin:0;text-align:center;font:12px sans-serif"><div style="width:200px;height:200px;border-radius:50%;overflow:hidden"><img src="${BASE}/icons/${n}.png" width="200" height="200"></div><div>${n} cropped to a circle</div></figure>`).join("");
  await page.goto(BASE + "/manifest.webmanifest");
  await page.setContent(`<body style="margin:0;padding:16px;background:#fff"><div style="display:grid;grid-template-columns:repeat(4,200px);gap:16px 24px">${imgs}${circles}</div></body>`);
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, "icons.png") });
  await page.close();
}

(async () => {
  const srv = await serve();
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
  try {
    if (want("A")) sectionFiles();
    if (want("B")) await sectionRegistry(browser);
    if (want("C")) await sectionMatrix(browser);
    if (want("D")) await sectionLock(browser);
    if (want("E")) await sectionNormal(browser);
    if (want("F")) await sectionGates(browser);
    if (want("G")) await sectionDenied(browser);
    if (want("H")) await sectionToasts(browser);
    if (want("I")) await sectionReviewFixes(browser);
    if (want("J")) await sectionFab(browser);
    if (want("K")) await sectionFinanceCap(browser);
    if (want("L")) await sectionCalendarGeometry(browser);
    if (want("M")) await sectionFlows(browser);
    if (want("N")) sectionAudit();
    if (want("S")) await shotPlates(browser);
    await shotIcons(browser);
  } finally {
    for (const c of contexts) { try { await c.close(); } catch {} }
    await browser.close();
    srv.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail){ console.log("Failures:\n  - " + failures.join("\n  - ")); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
