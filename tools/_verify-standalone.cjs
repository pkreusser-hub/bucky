#!/usr/bin/env node
"use strict";
/**
 * BUCKY standalone-app suite: "Bucky News" (/news) and "Bucky Shopping" (/shop), which are
 * index.html in app mode (html[data-app]), not separate pages. See docs/bucky-app.md, 2026-10-08.
 *
 *   NODE_PATH=<tools/node_modules> node tools/_verify-standalone.cjs [--shots <dir>]
 *
 * The local server applies the [[redirects]] rewrites it READS FROM netlify.toml, so the path form
 * (/news, /shop/) is exercised through the real config: delete a rewrite and the path tests 404.
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

/* ============================ browser plumbing ============================ */
const contexts = [];
const PUSH_STUB = `window.__PUSH_ENABLE__ = [];
window.BuckyPush = { enable: function(){ window.__PUSH_ENABLE__.push([].slice.call(arguments)); return Promise.resolve({ token:"t" }); },
  disable: function(){ return Promise.resolve(false); }, updateExtra: function(){ return Promise.resolve(); },
  isSupported: function(){ return true; }, status: function(){ return {}; }, notify: function(){ return Promise.resolve(null); } };`;

async function newPage(browser, { user = "Grandma", viewport = { width:390, height:844 }, perm = "default", unlocked = true } = {}){
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
    if (u.includes("/.netlify/functions/")) return r.respond({ status:200, contentType:"application/json", body:"{}" });
    if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) return r.abort();
    r.continue();
  });
  await page.evaluateOnNewDocument((u, pr, unl) => {
    if (unl) localStorage.setItem("choreUnlocked", "amenfarms");
    if (u) { if (!localStorage.getItem("choreUser")) localStorage.setItem("choreUser", u); }
    else { localStorage.removeItem("choreUser"); localStorage.removeItem("chorePid"); }
    window.__PROMPTS__ = [];
    window.prompt = () => null; window.alert = () => {}; window.confirm = () => true;
    window.__NOTIF_ASK__ = 0; window.__NOTIF_SHOWN__ = 0;
    function FakeNotification(){ window.__NOTIF_SHOWN__++; }
    FakeNotification.permission = pr;
    FakeNotification.requestPermission = () => { window.__NOTIF_ASK__++; if (FakeNotification.permission === "default") FakeNotification.permission = "granted"; return Promise.resolve(FakeNotification.permission); };
    window.Notification = FakeNotification;
  }, user, perm, unlocked);
  return { page, errors };
}

/** Seed local storage on this origin (via a static file, so no Bucky code runs), then open `url`. */
async function open(page, url, { profiles = roster(), rows = [], sources = SOURCES } = {}){
  await page.goto(BASE + "/manifest.webmanifest", { waitUntil: "domcontentloaded" });
  await page.evaluate((all, src) => {
    localStorage.setItem("buckyData1", JSON.stringify(all));
    if (src) localStorage.setItem("setting_newsSources", JSON.stringify({ list: src }));
  }, profiles.concat(rows), sources);
  await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__STANDALONE__ && window.__NAV__, { timeout: 20000 });
}

const APPS = {
  news: { tab:"news",     path:"/news", ready: () => document.querySelectorAll(".newscard").length >= 3, title:"Bucky News",     denied:"News isn't turned on for this account. Ask a parent to enable it." },
  shop: { tab:"shopping", path:"/shop", ready: () => document.querySelectorAll(".store-head").length === 6 && document.body.textContent.includes("Zebra Milk"), title:"Bucky Shopping", denied:"Shopping isn't turned on for this account. Ask a parent to enable it." },
};
async function ready(page, id){ await page.waitForFunction(APPS[id].ready, { timeout: 20000 }); await sleep(250); }

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
  for (const id of ["news", "shop"]){
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
  const newsIcon = fs.readFileSync(path.join(ROOT, "icons/news-512.png")), shopIcon = fs.readFileSync(path.join(ROOT, "icons/shop-512.png"));
  ok(!newsIcon.equals(shopIcon), "the two apps do not share an icon");

  const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8").replace(/\r/g, "");
  const rw = tomlRewrites();
  for (const f of ["/news", "/news/", "/shop", "/shop/"]){
    const r = rw.find((x) => x.from === f);
    ok(r && r.to === "/index.html" && r.status === 200 && !r.force, `netlify.toml rewrites ${f} to /index.html with status 200 (not forced)`);
  }
  const league = rw.filter((x) => /^https:\/\/(www\.)?goatfantasyleague\.com\/$/.test(x.from || ""));
  ok(league.length === 2 && league.every((x) => x.force && x.to === "/league.html" && x.status === 200), "the two forced goatfantasyleague.com rules are untouched");
  ok(/Content-Type = "application\/manifest\+json"/.test(toml), "the .webmanifest content-type header rule still covers the new manifests");
  const rootNames = fs.readdirSync(ROOT).map((n) => n.toLowerCase());
  ok(!["news", "news.html", "shop", "shop.html"].some((n) => rootNames.includes(n)), "no file or folder named news or shop at the root to shadow the rewrites");

  for (const id of ["news", "shop"]){
    const f = path.join(ROOT, "tools/standalone-sites", id, "_redirects");
    const lines = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split(/\r?\n/).map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean) : [];
    ok(lines.length === 2, `${id}/_redirects has exactly two rules`);
    ok(lines[0] === `/ /${id} 302`, `${id}/_redirects sends the bare address to /${id} (302)`);
    ok(lines[lines.length - 1] === "/* https://amenfarms.netlify.app/:splat 200!", `${id}/_redirects ends with the forced catch-all proxy`);
  }
  const readme = path.join(ROOT, "tools/standalone-sites/README.md");
  ok(fs.existsSync(readme) && /drag/i.test(fs.readFileSync(readme, "utf8")), "tools/standalone-sites/README.md exists and says how to deploy");
}

/* ============================ B. registry agreement ============================ */
async function sectionRegistry(browser){
  section("B. The head-script table and STANDALONE_APPS agree");
  const { page, errors } = await newPage(browser);
  await open(page, "/index.html");
  const r = await page.evaluate(() => ({ head: window.__STANDALONE__.head, main: window.__STANDALONE__.apps }));
  const hid = Object.keys(r.head || {}).sort(), mid = Object.keys(r.main || {}).sort();
  ok(hid.length === 2 && JSON.stringify(hid) === JSON.stringify(mid), `same app ids in both tables (${hid} vs ${mid})`);
  for (const id of mid){
    const h = r.head[id] || {}, m = r.main[id];
    ok(h.name === m.name && h.manifest === m.manifest && h.icon === m.icon && h.theme === m.theme, `${id}: name, manifest, icon and theme match across the two tables`);
    ok(m.tab === APPS[id].tab, `${id}: locked to tab "${APPS[id].tab}"`);
  }
  // The capability each app is gated by is the nav area's own, not a new one.
  const caps = await page.evaluate(() => ({ news: window.__NAV__.permitted("news", "Isaac"), shop: window.__NAV__.permitted("shop", "Isaac") }));
  ok(caps.news === true && caps.shop === true, "the registry's areas (news, shop) are real NAV_GROUPS ids that navGroupPermitted() answers for");
  // Each tab really belongs to the area the registry names.
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok(/id:"news",\s*ico:"[^"]*",\s*name:"News",\s*def:"news",\s*members:\["news"\]/.test(html), "NAV_GROUPS area news holds tab news");
  ok(/id:"shop",\s*ico:"[^"]*",\s*name:"Shop",\s*def:"shopping",\s*members:\["shopping"\]/.test(html), "NAV_GROUPS area shop holds tab shopping");
  ok(errors.length === 0, "no page errors" + (errors[0] ? ": " + errors[0] : ""));
}

/* =============================== C. the matrix =============================== */
async function sectionMatrix(browser){
  section("C. Each app, both viewports, both address forms");
  const VPS = [{ w:390, h:844 }, { w:1280, h:900 }];
  for (const id of ["news", "shop"]){
    for (const form of ["query", "path"]){
      for (const vp of VPS){
        const tag = `${id} ${form === "query" ? "?app=" + id : APPS[id].path} @${vp.w}x${vp.h}`;
        const { page, errors } = await newPage(browser, { viewport: { width: vp.w, height: vp.h } });
        const url = form === "query" ? "/index.html?app=" + id : APPS[id].path;
        await open(page, url, { rows: SHOP_ROWS });
        await ready(page, id);

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
        ok(gone(c.fab), `[${tag}] add button is gone`);
        ok(absent(c.bell) && absent(c.who), `[${tag}] bell and profile buttons are gone with the header`);
        ok(gone(c.subnav), `[${tag}] sub-nav is gone`);
        // The page itself hides the + on these tabs with an inline style, which would mask a
        // missing CSS rule. Clear it and look again: only the stylesheet is left to hide it.
        await page.evaluate(() => { document.getElementById("addFab").style.display = ""; });
        ok(gone((await chrome(page)).fab), `[${tag}] add button stays gone with the page's own inline hiding removed`);

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
        ok(lay.padB <= 40, `[${tag}] no bottom-nav clearance on the body (padding-bottom ${lay.padB}px)`);
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
  for (const id of ["news", "shop"]){
    const A = APPS[id];
    const { page, errors } = await newPage(browser);
    await open(page, A.path, { rows: SHOP_ROWS });
    await ready(page, id);
    const content = () => page.evaluate((sel) => !!document.querySelector(sel), id === "news" ? ".newswrap" : ".store-head");
    const histLen = await page.evaluate(() => history.length);

    for (const dest of ["dashboard", "farmbank", "calendar", "workorders", "chores", "play", "gffl"]){
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
      await open(p2.page, url, { rows: SHOP_ROWS });
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
    await open(page, "/index.html", { rows: SHOP_ROWS });
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
    await page.evaluate(() => window.__NAV__.goTo("farmbank")); await sleep(200);
    ok(await page.evaluate(() => window.__NAV__.tab()) !== "chores", `[normal @${vp.w}] goTo still navigates`);
    await page.evaluate(() => window.__NAV__.goTo("dashboard")); await sleep(200);
    ok(await page.evaluate(() => window.__NAV__.tab()) === "dashboard", `[normal @${vp.w}] Home works`);
    ok(errors.length === 0, `[normal @${vp.w}] no page errors` + (errors[0] ? ": " + errors[0] : ""));
    await page.close();
  }
  for (const url of ["/index.html?app=bogus", "/index.html?app=toString", "/index.html?app=__proto__", "/index.html?app=NEWS", "/index.html?app=", "/index.html?app=news.webmanifest"]){
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
  for (const [url, id] of [["/news/", "news"], ["/shop/", "shop"]]){
    const { page, errors } = await newPage(browser);
    await open(page, url, { rows: SHOP_ROWS });
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
  for (const id of ["news", "shop"]){
    const A = APPS[id];
    // F1. password screen
    {
      const { page, errors } = await newPage(browser, { unlocked: false });
      await open(page, A.path, { rows: SHOP_ROWS });
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
    for (const appMode of [true, false]){
      const label = appMode ? "app mode" : "normal Bucky (control)";
      const { page, errors } = await newPage(browser, { user: null });
      await open(page, appMode ? A.path : "/index.html", { rows: SHOP_ROWS });
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
    for (const appMode of [true, false]){
      const label = appMode ? "app mode" : "normal Bucky (control)";
      const { page } = await newPage(browser, { perm: "granted" });
      await open(page, appMode ? A.path : "/index.html", { rows: SHOP_ROWS });
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
  for (const id of ["news", "shop"]){
    const A = APPS[id];
    const cap = id === "news" ? "seesNews" : "seesShop";
    const { page, errors } = await newPage(browser, { user: "Isaac" });
    await open(page, A.path, { profiles: roster([cap]), rows: SHOP_ROWS });
    await sleep(1200);
    const d = await page.evaluate(() => {
      const el = document.getElementById("appDenied"); const r = el ? el.getBoundingClientRect() : null;
      return { text: el ? el.textContent : null, n: document.querySelectorAll("#appDenied").length, w: r && r.width, top: r && r.top,
        tab: window.__NAV__.tab(), content: !!document.querySelector(".newswrap, .store-head, .newscard"), hist: history.length };
    });
    ok(d.text === A.denied, `[${id}] the card says: "${d.text}"`);
    ok(d.n === 1 && d.w > 200 && d.top >= 0 && d.top < 40, `[${id}] it is one card, on screen, at the top (${d.n}, ${d.w}px wide, top ${d.top})`);
    ok(d.tab === A.tab, `[${id}] it did not bounce Home (tab "${d.tab}")`);
    ok(!d.content, `[${id}] none of the tab's content is shown`);
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
    await open(p2.page, APPS[other].path, { profiles: roster([cap]), rows: SHOP_ROWS });
    await ready(p2.page, other);
    ok(await p2.page.evaluate(() => !document.getElementById("appDenied")), `[${id}] denying ${cap} does not block the ${other} app`);
    // Control: the same profile in normal Bucky is bounced Home from that tab (existing behaviour).
    const p3 = await newPage(browser, { user: "Isaac" });
    await open(p3.page, "/index.html#" + A.tab, { profiles: roster([cap]), rows: SHOP_ROWS });
    await sleep(900);
    ok(await p3.page.evaluate(() => window.__NAV__.tab()) === "dashboard", `[${id}] control: normal Bucky still bounces that profile Home`);
    if (SHOTS && id === "news"){ fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, "denied_390x844.png") }); }
    ok(errors.length === 0 && p2.errors.length === 0 && p3.errors.length === 0, `[${id}] no page errors` + ((errors.concat(p2.errors, p3.errors))[0] ? ": " + errors.concat(p2.errors, p3.errors)[0] : ""));
    await page.close(); await p2.page.close(); await p3.page.close();
  }
}

/* ================================ H. toasts =================================== */
async function sectionToasts(browser){
  section("H. Other features' toasts and desktop alerts are suppressed; the app's own still show");
  for (const id of ["news", "shop"]){
    const A = APPS[id];
    for (const appMode of [true, false]){
      const label = appMode ? "app mode" : "normal Bucky (control)";
      const { page, errors } = await newPage(browser, { perm: "granted" });
      await open(page, appMode ? A.path : "/index.html", { rows: SHOP_ROWS });
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
        await page.evaluate((tab) => window.__STANDALONE__.toast("From the work orders tab", null, { tab }), "workorders");
        ok(await toasts() === 1, `[${id}, ${label}] a toast tagged with another tab is still suppressed`);
        await sleep(450);   // let the slide-in animation finish
        const top = await page.evaluate(() => document.querySelector("#toastWrap .toast").getBoundingClientRect().top);
        ok(top >= 0 && top < 40, `[${id}, ${label}] the toast sits at the top where the header used to be (${top}px)`);
      } else {
        ok(t1 === 1, `[${id}, ${label}] the same plain toast DOES show (${t1}), so the check can see it`);
        ok(t2 === 1 && shown2 === 1, `[${id}, ${label}] …and the live alert toasts and fires a desktop notification (${t2}, ${shown2})`);
      }
      ok(errors.length === 0, `[${id}, ${label}] no page errors` + (errors[0] ? ": " + errors[0] : ""));
      await page.close();
    }
  }
}

/* ================================ I. icons plate ================================ */
async function shotIcons(browser){
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  const { page } = await newPage(browser, { viewport: { width: 1000, height: 760 } });
  const imgs = ["news-192", "news-512", "news-maskable-512", "news-apple-touch", "shop-192", "shop-512", "shop-maskable-512", "shop-apple-touch"]
    .map((n) => `<figure style="margin:0;text-align:center;font:12px sans-serif"><img src="${BASE}/icons/${n}.png" width="200" height="200" style="background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/20px 20px"><div>${n}</div></figure>`).join("");
  const circles = ["news-maskable-512", "shop-maskable-512"]
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
    sectionFiles();
    await sectionRegistry(browser);
    await sectionMatrix(browser);
    await sectionLock(browser);
    await sectionNormal(browser);
    await sectionGates(browser);
    await sectionDenied(browser);
    await sectionToasts(browser);
    await shotIcons(browser);
  } finally {
    for (const c of contexts) { try { await c.close(); } catch {} }
    await browser.close();
    srv.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail){ console.log("Failures:\n  - " + failures.join("\n  - ")); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
