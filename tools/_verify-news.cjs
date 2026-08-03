#!/usr/bin/env node
"use strict";
/**
 * BUCKY News suite — the family daily feed.
 *
 *   node tools/_verify-news.cjs [--shots]
 *
 * Section A runs netlify/functions/news.mjs IN PROCESS against fake servers: a fake
 * publisher (RSS + Atom + a homepage that advertises its feed) and a fake Anthropic.
 * Nothing here touches the real internet, real publishers or the real API — the point is
 * to prove the parser, the discovery ladder, the SSRF guard and the batching contract
 * without spending a cent or depending on anyone's uptime.
 *
 * Sections B-E drive the real page in Chrome at 390x844 and desktop, with the news
 * function ROUTE-MOCKED so the client's own caching, gating and two-phase summary flow
 * are what's under test.
 *
 * FIREBASE IS BLOCKED THROUGHOUT (googleapis / firestore / firebase / gstatic). Not
 * optional hygiene: an unblocked headless run against index.html has twice seeded
 * duplicates into the live family herd, and this suite exercises first-run paths.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const WANT_SHOTS = process.argv.includes("--shots");
const PORT = 8874, PUB_PORT = 8875, NOFEED_PORT = 8876, ANTH_PORT = 8877;
const BASE = `http://127.0.0.1:${PORT}`;
const PUB = `http://127.0.0.1:${PUB_PORT}`;
const NOFEED = `http://127.0.0.1:${NOFEED_PORT}`;
const SECRET = "amenfarms";
/* Header + bottom nav, MEASURED at 390x844 before the 2026-08-03 chrome rework:
   header 90px + one-row nav 59px = 149px. The rework moves space from the header to a
   two-row nav and must not spend more of the screen than it started with (+3px slack for
   sub-pixel rounding). */
const CHROME_BUDGET_PX = 152;

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ fake publisher ============================== */
const RSS_XML = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>The Daily Trumpet</title>
  <link>${PUB}</link>
  <item>
    <title><![CDATA[Council approves the new bridge]]></title>
    <link>${PUB}/a/bridge</link>
    <pubDate>__FRESH1__</pubDate>
    <description>&lt;p&gt;The council voted 7&amp;ndash;2 on Tuesday to fund the bridge.&lt;/p&gt; It has been debated for years and construction starts in spring.</description>
    <media:thumbnail url="https://cdn.example.com/bridge.jpg" />
  </item>
  <item>
    <title>Rain expected all week</title>
    <link>/a/rain</link>
    <pubDate>__FRESH2__</pubDate>
    <description><![CDATA[<div>Forecasters say <b>steady rain</b> will continue through Friday.</div>]]></description>
  </item>
  <item>
    <title>An older story from last month</title>
    <link>${PUB}/a/old</link>
    <pubDate>__OLD__</pubDate>
    <description>Something that happened a while ago.</description>
  </item>
</channel>
</rss>`;

const ATOM_XML = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Gazette Atom</title>
  <entry>
    <title>Harvest festival returns</title>
    <link rel="alternate" href="${PUB}/g/harvest"/>
    <published>__FRESH1__</published>
    <summary type="html">&lt;p&gt;The festival is back after three years away.&lt;/p&gt;</summary>
  </entry>
  <entry>
    <title>New library hours</title>
    <link href="${PUB}/g/library"/>
    <updated>__FRESH2__</updated>
    <content type="html">The library will open an hour earlier on weekdays.</content>
  </entry>
</feed>`;

const ALT_FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>Discovered Feed</title>
<item><title>Found via a link tag</title><link>${PUB}/alt/1</link><pubDate>__FRESH1__</pubDate>
<description>Proof the alternate link was followed.</description></item></channel></rss>`;

/* A weekly that has posted nothing recently — the fallback path. */
const QUIET_XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>The Weekly Quiet</title>
<item><title>Last month's edition</title><link>${PUB}/q/1</link><pubDate>__OLD__</pubDate>
<description>Nothing has happened here in a while.</description></item></channel></rss>`;

function stamped(xml){
  const now = Date.now();
  return xml
    .replace(/__FRESH1__/g, new Date(now - 2 * 3600e3).toUTCString())
    .replace(/__FRESH2__/g, new Date(now - 5 * 3600e3).toUTCString())
    .replace(/__OLD__/g, new Date(now - 40 * 24 * 3600e3).toUTCString());
}

let pubHits = 0;
function servePublisher(){
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      pubHits++;
      const p = req.url.split("?")[0];
      const xml = (body) => { res.setHeader("content-type", "application/rss+xml"); res.end(stamped(body)); };
      if (p === "/rss.xml") return xml(RSS_XML);
      if (p === "/atom.xml"){ res.setHeader("content-type", "application/atom+xml"); return res.end(stamped(ATOM_XML)); }
      if (p === "/alt-feed.xml") return xml(ALT_FEED);
      if (p === "/quiet.xml") return xml(QUIET_XML);
      if (p === "/home"){
        res.setHeader("content-type", "text/html");
        return res.end(`<html><head><title>Home</title>
          <link rel="alternate" type="application/rss+xml" title="Trumpet" href="/alt-feed.xml">
          </head><body>hello</body></html>`);
      }
      if (p === "/"){ res.setHeader("content-type", "text/html"); return res.end("<html><body>no link tag here</body></html>"); }
      if (p === "/notxml"){ res.setHeader("content-type", "text/html"); return res.end("<html><body>definitely not a feed</body></html>"); }
      res.statusCode = 404; res.end("nope");
    });
    srv.listen(PUB_PORT, "127.0.0.1", () => resolve(srv));
  });
}
function serveNoFeed(){
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url.split("?")[0] === "/"){ res.setHeader("content-type","text/html"); return res.end("<html><body>a site with no feed</body></html>"); }
      res.statusCode = 404; res.end("nope");
    });
    srv.listen(NOFEED_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ============================ fake Anthropic ============================== */
let anthMode = "good", anthCalls = 0, anthLastBody = null;
function serveAnthropic(){
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        anthCalls++;
        let body = null; try { body = JSON.parse(raw); } catch {}
        anthLastBody = body;
        if (anthMode === "http500"){ res.statusCode = 500; return res.end("{}"); }
        res.setHeader("content-type", "application/json");
        if (anthMode === "garbage"){
          return res.end(JSON.stringify({ content: [{ type:"text", text:"I'm afraid I can't do that." }], usage:{} }));
        }
        // Count the articles the prompt carried and answer one line each.
        const user = ((body && body.messages && body.messages[0] && body.messages[0].content) || "");
        const n = (user.match(/### Article /g) || []).length;
        const arr = [];
        for (let i = 1; i <= n; i++) arr.push({ i, s: `Written summary number ${i}.` });
        res.end(JSON.stringify({ content: [{ type:"text", text: "```json\n" + JSON.stringify(arr) + "\n```" }], usage:{ input_tokens: 100, output_tokens: 50 } }));
      });
    });
    srv.listen(ANTH_PORT, "127.0.0.1", () => resolve(srv));
  });
}

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

/* ====================== A. the function, in process ======================= */
let handler = null;
async function call(body, origin){
  const req = new Request("https://amenfarms.netlify.app/.netlify/functions/news", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
  const res = await handler(req);
  let j = null; try { j = await res.json(); } catch {}
  return { status: res.status, body: j };
}

async function sectionServer(){
  section("A. The news function (in process, fake publisher + fake Anthropic)");

  process.env.BUCKY_NOTIFY_SECRET = SECRET;
  process.env.NEWS_ALLOW_PRIVATE = "1";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.NEWS_ANTHROPIC_BASE_URL = `http://127.0.0.1:${ANTH_PORT}`;

  const mod = await import("file://" + path.join(ROOT, "netlify", "functions", "news.mjs").replace(/\\/g, "/"));
  handler = mod.default;
  ok(typeof handler === "function", "news.mjs exports a handler");
  ok(mod.config && mod.config.path === "/.netlify/functions/news", "function is routed at /.netlify/functions/news");

  /* -- the gate -- */
  ok((await call({ secret: "wrong", action: "feed", sources: [] })).status === 401, "a wrong family password is rejected (401)");
  ok((await call({ secret: SECRET, action: "nonsense" })).status === 400, "an unknown action is rejected (400)");
  const preflight = await handler(new Request("https://x/", { method: "OPTIONS" }));
  ok(preflight.status === 204, "the CORS preflight answers 204");
  ok(preflight.headers.get("access-control-allow-origin") === "https://amenfarms.netlify.app",
    "an unknown origin falls back to the production origin");

  /* -- discovery -- */
  const dRoot = await call({ secret: SECRET, action: "discover", url: PUB + "/" });
  ok(dRoot.body.ok && /\/rss\.xml$/.test(dRoot.body.feedUrl), "discovery finds a feed at a well-known path");
  ok(dRoot.body.title === "The Daily Trumpet", "discovery reads the publication's own title, not an article's");

  const dHome = await call({ secret: SECRET, action: "discover", url: PUB + "/home" });
  ok(dHome.body.ok && /alt-feed\.xml$/.test(dHome.body.feedUrl), "discovery follows a <link rel=alternate> feed tag");

  const dDirect = await call({ secret: SECRET, action: "discover", url: PUB + "/atom.xml" });
  ok(dDirect.body.ok && /atom\.xml$/.test(dDirect.body.feedUrl), "a URL that is already a feed is accepted as-is");

  const dNone = await call({ secret: SECRET, action: "discover", url: NOFEED + "/" });
  ok(dNone.body.ok === false && dNone.body.reason === "no-feed", "a site with no feed reports no-feed, not a crash");

  const dHtml = await call({ secret: SECRET, action: "discover", url: PUB + "/notxml" });
  ok(dHtml.body.ok === true, "an HTML page on a site that HAS a feed still resolves (falls through to the guesses)");

  ok((await call({ secret: SECRET, action: "discover", url: "file:///etc/passwd" })).body.reason === "bad-scheme",
    "a non-http scheme is refused");
  ok((await call({ secret: SECRET, action: "discover", url: "not a url at all" })).body.reason !== undefined,
    "junk input is refused rather than fetched");

  /* -- SSRF guard, with the test escape hatch OFF -- */
  process.env.NEWS_ALLOW_PRIVATE = "";
  // An ALLOWED port, so this exercises the address guard rather than the port guard.
  const priv = await call({ secret: SECRET, action: "discover", url: "http://127.0.0.1:8080/rss.xml" });
  ok(priv.body.ok === false && priv.body.reason === "private", "a loopback address is refused (SSRF guard)");
  const priv10 = await call({ secret: SECRET, action: "discover", url: "http://10.0.0.5/feed" });
  ok(priv10.body.ok === false && priv10.body.reason === "private", "a private LAN address is refused");
  const meta = await call({ secret: SECRET, action: "discover", url: "http://169.254.169.254/latest/meta-data/" });
  ok(meta.body.ok === false && meta.body.reason === "private", "the cloud metadata address is refused");
  const localh = await call({ secret: SECRET, action: "discover", url: "http://localhost/feed" });
  ok(localh.body.ok === false && localh.body.reason === "private", "localhost is refused by name as well as by number");
  const port = await call({ secret: SECRET, action: "discover", url: "http://example.com:22/feed" });
  ok(port.body.ok === false && port.body.reason === "bad-port", "a non-web port is refused");
  process.env.NEWS_ALLOW_PRIVATE = "1";

  /* -- feed: RSS -- */
  const rss = await call({ secret: SECRET, action: "feed",
    sources: [{ id: "trumpet", title: "The Daily Trumpet", feedUrl: PUB + "/rss.xml" }] });
  const items = rss.body.items || [];
  ok(items.length === 2, `only articles inside the window are taken (${items.length} of 3; the month-old one is dropped)`);
  ok(items[0].title === "Council approves the new bridge", "the newest article sorts first");
  ok(items[0].link === PUB + "/a/bridge", "an absolute article link survives");
  ok(items[1].link === PUB + "/a/rain", "a relative article link is resolved against the feed");
  ok(items[0].sourceId === "trumpet" && items[0].sourceTitle === "The Daily Trumpet", "each article carries its publication");
  ok(items[0].image === "https://cdn.example.com/bridge.jpg", "a media:thumbnail becomes the card image");
  ok(items[0].published > 0, "the publish time is parsed");
  ok(!/[<>]/.test(items[0].excerpt) && /council voted 7–2/i.test(items[0].excerpt),
    "escaped HTML is stripped and entities decoded in the excerpt");
  ok(/steady rain/i.test(items[1].excerpt) && !/<b>/.test(items[1].excerpt), "CDATA-wrapped HTML is reduced to plain text");
  ok(items[0].summary && items[0].summarySource === "feed",
    "feed responses ship the publisher's own blurb so the first paint is readable");
  ok(rss.body.canSummarize === true, "the response says whether written summaries are available");
  const rep = (rss.body.sources || [])[0];
  ok(rep && rep.ok === true && rep.count === 2, "the per-publication report counts what it contributed");

  /* -- feed: Atom -- */
  const atom = await call({ secret: SECRET, action: "feed",
    sources: [{ id: "gaz", title: "Gazette", feedUrl: PUB + "/atom.xml" }] });
  const aItems = atom.body.items || [];
  ok(aItems.length === 2, "Atom entries parse as well as RSS items");
  ok(aItems[0].title === "Harvest festival returns", "an Atom title parses");
  ok(aItems[0].link === PUB + "/g/harvest", "an Atom rel=alternate link is preferred");
  ok(aItems[1].link === PUB + "/g/library", "a bare Atom link href is used when there is no rel");
  ok(/festival is back/i.test(aItems[0].excerpt), "an Atom summary becomes the excerpt");

  /* -- feed: caps, mixed health, ids -- */
  const capped = await call({ secret: SECRET, action: "feed", perSource: 1,
    sources: [{ id: "trumpet", title: "T", feedUrl: PUB + "/rss.xml" }] });
  ok((capped.body.items || []).length === 1, "perSource caps how much one publication contributes");

  const mixed = await call({ secret: SECRET, action: "feed", sources: [
    { id: "trumpet", title: "T", feedUrl: PUB + "/rss.xml" },
    { id: "dead", title: "Dead", feedUrl: PUB + "/does-not-exist.xml" },
  ] });
  ok((mixed.body.items || []).length === 2, "a broken publication does not sink the healthy ones");
  const deadRep = (mixed.body.sources || []).find((s) => s.id === "dead");
  ok(deadRep && deadRep.ok === false && /404/.test(deadRep.reason), "the broken publication is reported with its reason");

  const notFeed = await call({ secret: SECRET, action: "feed",
    sources: [{ id: "x", title: "x", feedUrl: PUB + "/notxml" }] });
  ok(((notFeed.body.sources || [])[0] || {}).reason === "not-a-feed", "an HTML page served as a feed is reported, not parsed");

  const again = await call({ secret: SECRET, action: "feed",
    sources: [{ id: "trumpet", title: "T", feedUrl: PUB + "/rss.xml" }] });
  ok(again.body.items[0].id === items[0].id, "an article's id is stable across fetches (so 'read' sticks)");
  ok(items[0].id !== items[1].id, "different articles get different ids");

  const dupe = await call({ secret: SECRET, action: "feed", sources: [
    { id: "trumpet", title: "T", feedUrl: PUB + "/rss.xml" },
    { id: "trumpet", title: "T again", feedUrl: PUB + "/rss.xml" },
  ] });
  ok((dupe.body.items || []).length === 2, "a duplicate publication id is collapsed, not fetched twice");

  ok((await call({ secret: SECRET, action: "feed", sources: [] })).body.items.length === 0,
    "no publications yields an empty feed, not an error");

  /* -- a quiet publication still contributes -- */
  const quiet = await call({ secret: SECRET, action: "feed",
    sources: [{ id: "weekly", title: "The Weekly Quiet", feedUrl: PUB + "/quiet.xml" }] });
  ok((quiet.body.items || []).length > 0, "a publication with nothing inside the window still shows its newest");
  ok(((quiet.body.sources || [])[0] || {}).reason === "nothing-recent", "…and says that is what happened");
  ok(((quiet.body.items || [])[0] || {}).stale === true, "…and that article is flagged as not-from-today");

  /* -- summarize -- */
  anthCalls = 0; anthMode = "good";
  const arts = items.map((it) => ({ id: it.id, sourceTitle: it.sourceTitle, title: it.title, excerpt: it.excerpt }));
  const sum = await call({ secret: SECRET, action: "summarize", articles: arts });
  ok(sum.body.ok === true, "summarize reports success");
  ok(Object.keys(sum.body.summaries || {}).length === 2, "every article in the batch comes back with a summary");
  ok(sum.body.summaries[items[0].id] === "Written summary number 1.", "summaries are keyed back to the right article");
  ok(anthCalls === 1, "a batch of articles costs ONE model call, not one per article");
  ok(anthLastBody && anthLastBody.model === "claude-sonnet-5", "summaries are written by Sonnet 5");
  ok(anthLastBody && /Publication: The Daily Trumpet/.test(anthLastBody.messages[0].content),
    "the prompt carries the publication name and headline");
  ok(anthLastBody && /never add facts/i.test(anthLastBody.system), "the system prompt forbids inventing facts");
  ok(anthLastBody && /children/i.test(anthLastBody.system), "the system prompt says a whole family reads this");

  const many = Array.from({ length: 20 }, (_, i) => ({ id: "x" + i, title: "T" + i, excerpt: "e", sourceTitle: "S" }));
  const capSum = await call({ secret: SECRET, action: "summarize", articles: many });
  ok(Object.keys(capSum.body.summaries || {}).length <= 8, "a summarize call is capped so it cannot outrun the function timeout");

  anthMode = "garbage";
  const bad = await call({ secret: SECRET, action: "summarize", articles: arts });
  ok(bad.body.ok === false && Object.keys(bad.body.summaries || {}).length === 0,
    "a model reply with no JSON array fails cleanly instead of writing nonsense onto cards");
  anthMode = "http500";
  const err5 = await call({ secret: SECRET, action: "summarize", articles: arts });
  ok(err5.body.ok === false && /500/.test(err5.body.reason || ""), "an upstream error is reported, not thrown");
  anthMode = "good";

  delete process.env.ANTHROPIC_API_KEY;
  const noKey = await call({ secret: SECRET, action: "summarize", articles: arts });
  ok(noKey.body.ok === false && noKey.body.reason === "no-key", "with no API key, summarize declines rather than failing the feed");
  const noKeyFeed = await call({ secret: SECRET, action: "feed",
    sources: [{ id: "trumpet", title: "T", feedUrl: PUB + "/rss.xml" }] });
  ok(noKeyFeed.body.canSummarize === false && noKeyFeed.body.items[0].summary,
    "…and the feed still delivers articles with the publisher's blurb");
  process.env.ANTHROPIC_API_KEY = "test-key";
}

/* ============================ browser plumbing ============================ */
const contexts = [];

/** The mocked news endpoint. Counts calls so caching can be proven, not assumed. */
function makeNewsMock(){
  const state = {
    feedCalls: 0, sumCalls: 0, discoverCalls: 0,
    feedFails: false, discoverOk: true, discoverReason: "no-feed", summarizeOk: true,
    items: null,
  };
  // What a real Sonnet summary reads like — the screenshots are the design review, so a
  // placeholder string here would review the wrong thing.
  state.written = {
    a1: "Councillors voted 7-2 on Tuesday to fund the Mill Road bridge after four years of debate. Construction is due to start in the spring and will close the ford crossing.",
    a2: "Steady rain is forecast every day through Friday, with the heaviest falls on Wednesday afternoon. Forecasters expect standing water on low-lying roads.",
    b1: "The harvest festival returns to the fairground this weekend after a three-year gap. Organisers have added a livestock show and moved the parade to Sunday morning.",
  };
  state.defaultItems = () => ([
    { id:"a1", sourceId:"s1", sourceTitle:"The Daily Trumpet", title:"Council approves the new bridge",
      link:"https://example.com/a/bridge", published: Date.now() - 2*3600e3, image:"",
      excerpt:"The council voted 7-2 on Tuesday to fund the bridge.", summary:"The council voted 7-2 on Tuesday to fund the bridge.", summarySource:"feed" },
    { id:"a2", sourceId:"s1", sourceTitle:"The Daily Trumpet", title:"Rain expected all week",
      link:"https://example.com/a/rain", published: Date.now() - 5*3600e3, image:"",
      excerpt:"Forecasters say steady rain will continue through Friday.", summary:"Forecasters say steady rain will continue through Friday.", summarySource:"feed" },
    { id:"b1", sourceId:"s2", sourceTitle:"Gazette", title:"Harvest festival returns",
      link:"https://example.com/g/harvest", published: Date.now() - 9*3600e3, image:"",
      excerpt:"The festival is back after three years away.", summary:"The festival is back after three years away.", summarySource:"feed" },
  ]);

  state.handle = (bodyRaw) => {
    let b = null; try { b = JSON.parse(bodyRaw || "{}"); } catch {}
    const action = b && b.action;
    if (action === "discover"){
      state.discoverCalls++;
      return state.discoverOk
        ? { ok:true, feedUrl:"https://trumpet.example.com/rss.xml", title:"The Daily Trumpet", siteUrl:"https://trumpet.example.com" }
        : { ok:false, reason: state.discoverReason };
    }
    if (action === "feed"){
      state.feedCalls++;
      if (state.feedFails) return { items: [], sources: (b.sources||[]).map(s => ({ id:s.id, ok:false, count:0, reason:"unreachable" })), canSummarize:true, generatedAt: Date.now() };
      // Serve the scripted articles for the two known publications, and synthesise a
      // couple for any other id — Dad's newly-added source gets a generated id, so a
      // fixed lookup would silently hand it an empty feed.
      const pool = state.items || state.defaultItems();
      const items = [];
      for (const s of (b.sources || [])){
        const mine = pool.filter(it => it.sourceId === s.id);
        if (mine.length){ items.push(...mine); continue; }
        for (let i = 1; i <= 2; i++){
          items.push({ id: s.id + "_" + i, sourceId: s.id, sourceTitle: s.title || "Untitled",
            title: `Story ${i} from ${s.title || s.id}`, link: `https://example.com/${s.id}/${i}`,
            published: Date.now() - i * 3600e3, image: "",
            excerpt: `Something happened, number ${i}.`, summary: `Something happened, number ${i}.`, summarySource: "feed" });
        }
      }
      return { items, sources: (b.sources||[]).map(s => ({ id:s.id, ok:true, count:1, reason:"" })), canSummarize:true, generatedAt: Date.now() };
    }
    if (action === "summarize"){
      state.sumCalls++;
      if (!state.summarizeOk) return { ok:false, reason:"http-500", summaries:{} };
      const summaries = {};
      for (const a of (b.articles || [])) summaries[a.id] = state.written[a.id] || ("A written summary of " + a.title + ".");
      return { ok:true, summaries };
    }
    return { error: "bad action" };
  };
  return state;
}

async function newPage(browser, mock, { user = "Dad", viewport = { width:390, height:844, deviceScaleFactor:1 }, prompts = [] } = {}){
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
    if (url.includes("/.netlify/functions/news")){
      const res = mock.handle(r.postData());
      return r.respond({ status: 200, contentType: "application/json", body: JSON.stringify(res) });
    }
    if (/^https?:\/\/(?!127\.0\.0\.1)/.test(url)) return r.abort();   // no real network, ever
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
    window.__OPENED__ = [];
    window.open = (href) => { window.__OPENED__.push(href); return null; };
  }, user, prompts);

  return { page, errors };
}

async function gotoNews(page){
  // Query BEFORE the hash. "#news?n=1" makes location.hash "news?n=1", which is not a
  // deep-link tab, so boot lands on Home and re-highlights it after we navigate.
  await page.goto(BASE + "/index.html?n=" + Date.now() + "#news", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__NEWS__, { timeout: 20000 });
  await page.evaluate(() => { window.__NAV__ ? window.__NAV__.goTo("news") : null; });
  await page.waitForFunction(() => document.querySelector(".newswrap"), { timeout: 10000 });
}
async function settle(page, ms){ await sleep(ms || 500); }
async function tap(page, sel){
  await page.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ block: "center" }); }, sel);
  await sleep(80);
  await page.click(sel);
}
/** Seed the subscription list straight into the local settings backend. */
async function seedSources(page, list){
  await page.evaluate((l) => {
    localStorage.setItem("setting_newsSources", JSON.stringify({ list: l }));
  }, list);
}
const TWO_SOURCES = [
  { id:"s1", title:"The Daily Trumpet", url:"https://trumpet.example.com", feedUrl:"https://trumpet.example.com/rss.xml" },
  { id:"s2", title:"Gazette", url:"https://gazette.example.com", feedUrl:"https://gazette.example.com/atom.xml" },
];

/* ========================= B. the section + nav =========================== */
async function sectionShell(browser, mock){
  section("B. The section, the nav, and the empty state");

  const { page, errors } = await newPage(browser, mock, { user: "Dad" });
  await gotoNews(page);

  const nav = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#bnav .bnav-btn")];
    return btns.map(b => {
      const l = b.querySelector(".blabel");
      return { gid: b.dataset.gid || "", label: l ? l.textContent : "", clipped: l ? (l.scrollWidth > l.clientWidth + 1) : false };
    });
  });
  ok(nav.some(b => /news/i.test(b.label)), "News has its own bottom-nav area");
  const clipped = nav.filter(b => b.clipped).map(b => b.label);
  ok(clipped.length === 0, "no bottom-nav label is clipped at 390px with ten areas" + (clipped.length ? ": " + clipped.join(", ") : ""));

  // The real user path: tap the nav button, don't call the navigator. This is what
  // catches an area that renders its section but never lights up in the bar.
  await page.evaluate(() => { window.__NAV__.goTo("dashboard"); });
  await settle(page, 250);
  await tap(page, '#bnav .bnav-btn[data-gid="news"]');
  await settle(page, 400);
  ok(await page.evaluate(() => window.__NAV__.tab() === "news"), "tapping the News nav button opens News");
  ok(await page.evaluate(() => document.querySelector('#bnav .bnav-btn[data-gid="news"]').classList.contains("active")),
    "…and the News button is the one lit up");
  ok(await page.evaluate(() => [...document.querySelectorAll("#bnav .bnav-btn.active")].length === 1),
    "…and it is the only one lit up");

  ok(await page.$(".newswrap") !== null, "the News section renders");
  ok(await page.evaluate(() => !!document.querySelector("#newsSourcesBtn")), "there is a way in to the publications list");
  ok(await page.evaluate(() => document.getElementById("addFab").style.display === "none"), "the + button is hidden on News");

  await settle(page, 400);
  ok(await page.evaluate(() => !!document.querySelector(".newsempty")), "with no publications, an empty state shows");
  ok(await page.evaluate(() => !!document.querySelector("#newsAddFirstBtn")), "Dad is offered a way to add one");
  ok(mock.feedCalls === 0, "no articles are fetched while there is nothing subscribed");

  if (WANT_SHOTS){ fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, "news_empty.png") }); }

  // A kid sees the same section, but is pointed at Dad rather than an Add button.
  const kid = await newPage(browser, mock, { user: "Isaac" });
  await gotoNews(kid.page);
  await settle(kid.page, 400);
  ok(await kid.page.evaluate(() => !!document.querySelector(".newsempty")), "a kid sees the News section too");
  ok(await kid.page.evaluate(() => !document.querySelector("#newsAddFirstBtn")), "…but is not offered the Add button");
  ok(await kid.page.evaluate(() => /ask dad/i.test(document.querySelector(".newsempty").textContent)), "…they are told to ask Dad");

  ok(errors.length === 0 && kid.errors.length === 0, "no page errors" + (errors.concat(kid.errors).length ? ": " + errors.concat(kid.errors)[0] : ""));
}

/* ============================ C. the feed ================================= */
async function sectionFeed(browser, mock){
  section("C. The daily feed");

  mock.feedCalls = 0; mock.sumCalls = 0;
  const { page, errors } = await newPage(browser, mock, { user: "Dad" });
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await seedSources(page, TWO_SOURCES);
  await gotoNews(page);
  await page.waitForFunction(() => document.querySelectorAll(".newscard").length >= 3, { timeout: 15000 });

  ok(mock.feedCalls === 1, "opening News fetches the day's articles exactly once");
  const cards = await page.evaluate(() => [...document.querySelectorAll(".newscard")].map(c => ({
    id: c.dataset.newsId,
    src: (c.querySelector(".newsc-src") || {}).textContent || "",
    title: (c.querySelector(".newsc-title") || {}).textContent || "",
    sum: (c.querySelector(".newsc-sum") || {}).textContent || "",
  })));
  ok(cards.length === 3, `every article from every publication is in one feed (${cards.length})`);
  ok(cards.every(c => c.title), "each card shows a headline");
  ok(cards.every(c => c.sum), "each card shows a summary");
  ok(cards[0].src.includes("The Daily Trumpet"), "each card names the publication it came from");
  ok(/ago/.test(cards[0].src), "…and how long ago it ran");

  // The two-phase flow: publisher blurbs paint first, written summaries swap in behind
  // them. Asserted as "the text CHANGED from the blurb it arrived with", not by sniffing
  // for a magic string — that stays true whatever the summariser actually writes.
  // The blurb each article ARRIVED with, taken from the mock rather than read off the
  // screen — the mock answers instantly, so a "before" snapshot can already be the after.
  const blurb = Object.fromEntries(mock.defaultItems().map(i => [i.id, i.summary]));
  await page.waitForFunction(() => !window.__NEWS__.busy(), { timeout: 20000 });
  ok(mock.sumCalls >= 1, "summaries are requested after the headlines are already on screen");
  const finals = await page.evaluate(() => [...document.querySelectorAll(".newscard")].map(c => ({
    id: c.dataset.newsId, sum: (c.querySelector(".newsc-sum") || {}).textContent || "",
  })));
  ok(finals.every(f => f.sum && f.sum !== blurb[f.id]), "every card's blurb is replaced by a written summary");
  ok(finals.every(f => f.sum.length > 40), "…and those summaries are real sentences, not stubs");
  ok(await page.evaluate(() => window.__NEWS__.digest().items.every(i => i.summarySource === "ai")),
    "the digest records that those summaries were written, not scraped");
  ok(await page.evaluate(() => window.__NEWS__.digest().items.every(i => !i.excerpt)),
    "raw article text is dropped once summarised, keeping the shared doc lean");

  if (WANT_SHOTS){ fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, "news_feed.png") }); }

  /* -- the filter -- */
  ok(await page.evaluate(() => !!document.querySelector("#newsFilter")), "a publication filter shows once there is more than one");
  await tap(page, '#newsFilter button[data-src="s2"]');
  await settle(page, 200);
  const only = await page.evaluate(() => [...document.querySelectorAll(".newscard")].map(c => c.dataset.src));
  ok(only.length === 1 && only[0] === "s2", "filtering to one publication shows only its articles");
  await tap(page, '#newsFilter button[data-src=""]');
  await settle(page, 200);
  ok(await page.evaluate(() => document.querySelectorAll(".newscard").length === 3), "All brings the whole feed back");

  /* -- reading -- */
  await tap(page, '.newscard[data-news-id="a1"]');
  await settle(page, 200);
  ok(await page.evaluate(() => (window.__OPENED__[0] || "").includes("/a/bridge")), "tapping a card opens that article");
  ok(await page.evaluate(() => document.querySelector('.newscard[data-news-id="a1"]').classList.contains("read")), "…and marks it read");
  const readAfterReload = await (async () => {
    await gotoNews(page);
    await page.waitForFunction(() => document.querySelectorAll(".newscard").length >= 3, { timeout: 15000 });
    return page.evaluate(() => document.querySelector('.newscard[data-news-id="a1"]').classList.contains("read"));
  })();
  ok(readAfterReload, "read articles stay read across a reload");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ========================= D. caching + the day roll ====================== */
async function sectionCache(browser, mock){
  section("D. One fetch a day for the whole family");

  mock.feedCalls = 0; mock.sumCalls = 0;
  const { page, errors } = await newPage(browser, mock, { user: "Dad" });
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await seedSources(page, TWO_SOURCES);
  await gotoNews(page);
  await page.waitForFunction(() => window.__NEWS__.digest() && window.__NEWS__.digest().items.length >= 3, { timeout: 15000 });
  await page.waitForFunction(() => !window.__NEWS__.busy(), { timeout: 15000 });
  const firstFeed = mock.feedCalls, firstSum = mock.sumCalls;
  ok(firstFeed === 1, "the first open of the day fetches once");

  await gotoNews(page);
  await settle(page, 900);
  ok(mock.feedCalls === firstFeed, "re-opening the app re-uses the cached digest — no second fetch");
  ok(mock.sumCalls === firstSum, "…and pays for no further summaries");
  ok(await page.evaluate(() => document.querySelectorAll(".newscard").length === 3), "…while still showing the full feed");
  ok(await page.evaluate(() => !!localStorage.getItem("setting_newsDigest")),
    "the finished digest is shared through the family settings doc, not kept per-device");

  // Refresh is the manual override.
  await tap(page, "#newsRefreshBtn");
  await page.waitForFunction(() => !window.__NEWS__.busy(), { timeout: 15000 });
  ok(mock.feedCalls === firstFeed + 1, "the refresh button forces a fresh fetch");

  // Tomorrow.
  const before = mock.feedCalls;
  await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    window.__NEWS__.setNow(d.toISOString());
  });
  await page.waitForFunction((b) => window.__NEWS__ && !window.__NEWS__.busy() && window.__NEWS__.fresh(), { timeout: 15000 }, before);
  ok(mock.feedCalls === before + 1, "when the day rolls over the feed refetches on its own");

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ======================= E. the publications sheet ======================== */
async function sectionSources(browser, mock){
  section("E. Publications — Dad edits, everyone reads");

  /* -- a kid gets a read-only list and is never asked for a PIN -- */
  const kid = await newPage(browser, mock, { user: "Isaac" });
  await kid.page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await seedSources(kid.page, TWO_SOURCES);
  await gotoNews(kid.page);
  await settle(kid.page, 600);
  await tap(kid.page, "#newsSourcesBtn");
  await settle(kid.page, 300);
  ok(await kid.page.evaluate(() => document.getElementById("newsSheetOverlay").classList.contains("open")), "a kid can open the publications list");
  ok(await kid.page.evaluate(() => document.querySelectorAll("#newsSrcList .newssrc").length === 2), "…and see what the family follows");
  ok(await kid.page.evaluate(() => !document.querySelector("#newsAddInput")), "…but gets no add box");
  ok(await kid.page.evaluate(() => !document.querySelector(".newssrc-x")), "…and no remove buttons");
  ok(await kid.page.evaluate(() => window.__PROMPTED__.length === 0), "…and is never asked for Dad's PIN");
  ok(await kid.page.evaluate(() => /dad's pin/i.test(document.getElementById("newsSheetInner").textContent)), "…the sheet says why it is read-only");

  /* -- Dad with the wrong PIN gets the same read-only list -- */
  const wrong = await newPage(browser, mock, { user: "Dad", prompts: ["1234", "1234"] });
  await wrong.page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await wrong.page.evaluate(() => localStorage.setItem("dadPinHash", "not-a-real-hash"));
  await seedSources(wrong.page, TWO_SOURCES);
  await gotoNews(wrong.page);
  await settle(wrong.page, 600);
  await tap(wrong.page, "#newsSourcesBtn");
  await settle(wrong.page, 400);
  ok(await wrong.page.evaluate(() => window.__PROMPTED__.length > 0), "Dad is asked for his PIN");
  ok(await wrong.page.evaluate(() => !document.querySelector("#newsAddInput")), "a wrong PIN leaves the list read-only");

  /* -- Dad with the right PIN can add and remove -- */
  mock.feedCalls = 0; mock.discoverCalls = 0;
  const { page, errors } = await newPage(browser, mock, { user: "Dad" });
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => { sessionStorage.setItem("dadUnlocked", "1"); });
  await gotoNews(page);
  await settle(page, 500);
  await tap(page, "#newsSourcesBtn");
  await settle(page, 300);
  ok(await page.evaluate(() => !!document.querySelector("#newsAddInput")), "an unlocked Dad gets the add box");

  await page.type("#newsAddInput", "trumpet.example.com");
  await tap(page, "#newsAddBtn");
  await page.waitForFunction(() => window.__NEWS__.sources().length === 1, { timeout: 10000 });
  ok(mock.discoverCalls === 1, "adding a publication asks the server to find its feed");
  const added = await page.evaluate(() => window.__NEWS__.sources()[0]);
  ok(added.title === "The Daily Trumpet", "the publication is stored under its real name, not the typed address");
  ok(added.feedUrl === "https://trumpet.example.com/rss.xml", "…and remembers the discovered feed");
  ok(await page.evaluate(() => !!localStorage.getItem("setting_newsSources")), "the subscription list is saved for the whole family");

  // Adding the same one twice is refused rather than duplicated.
  await page.evaluate(() => { document.querySelector("#newsAddInput").value = ""; });
  await page.type("#newsAddInput", "trumpet.example.com");
  await tap(page, "#newsAddBtn");
  await settle(page, 600);
  ok(await page.evaluate(() => window.__NEWS__.sources().length === 1), "the same publication cannot be added twice");
  ok(await page.evaluate(() => /already following/i.test(document.getElementById("newsAddHint").textContent)), "…and says so");

  // A site with no feed is explained, not silently dropped.
  mock.discoverOk = false; mock.discoverReason = "no-feed";
  await page.evaluate(() => { document.querySelector("#newsAddInput").value = ""; });
  await page.type("#newsAddInput", "nofeed.example.com");
  await tap(page, "#newsAddBtn");
  await settle(page, 600);
  ok(await page.evaluate(() => window.__NEWS__.sources().length === 1), "a site with no feed is not added");
  ok(await page.evaluate(() => /news feed/i.test(document.getElementById("newsAddHint").textContent)), "…and the reason is in plain English");
  mock.discoverOk = true;

  if (WANT_SHOTS){ fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, "news_sources.png") }); }

  // Done -> the new publication's articles load.
  await tap(page, "#newsSrcDone");
  await page.waitForFunction(() => document.querySelectorAll(".newscard").length >= 2, { timeout: 15000 });
  ok(mock.feedCalls >= 1, "closing the sheet loads the newly-followed publication");

  // Removing one drops its articles immediately, without waiting for a refetch.
  await page.evaluate(() => window.__NEWS__.sources());
  await tap(page, "#newsSourcesBtn");
  await settle(page, 300);
  await tap(page, ".newssrc-x");
  await settle(page, 400);
  ok(await page.evaluate(() => window.__NEWS__.sources().length === 0), "a publication can be removed");
  await tap(page, "#newsSrcDone");
  await settle(page, 500);
  ok(await page.evaluate(() => document.querySelectorAll(".newscard").length === 0), "…and its articles leave the feed at once");

  ok(errors.length === 0 && kid.errors.length === 0 && wrong.errors.length === 0,
    "no page errors" + ([...errors, ...kid.errors, ...wrong.errors].length ? ": " + [...errors, ...kid.errors, ...wrong.errors][0] : ""));
}

/* ====================== F. when things go wrong ========================== */
async function sectionResilience(browser, mock){
  section("F. When the publications are down");

  mock.feedCalls = 0; mock.sumCalls = 0;
  const { page, errors } = await newPage(browser, mock, { user: "Dad" });
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await seedSources(page, TWO_SOURCES);
  await gotoNews(page);
  await page.waitForFunction(() => !window.__NEWS__.busy() && window.__NEWS__.digest(), { timeout: 15000 });
  const good = await page.evaluate(() => window.__NEWS__.digest().items.length);
  ok(good === 3, "a good digest is in hand first");

  // Everything goes down, and the reader keeps yesterday's paper.
  mock.feedFails = true;
  await tap(page, "#newsRefreshBtn");
  await page.waitForFunction(() => !window.__NEWS__.busy(), { timeout: 15000 });
  ok(await page.evaluate(() => document.querySelectorAll(".newscard").length === 3), "a total outage leaves the last feed on screen");
  ok(await page.evaluate(() => /couldn't reach/i.test(window.__NEWS__.error())), "…and says what happened");
  ok(await page.evaluate(() => !!document.querySelector("#newsErrNote")), "…visibly, under the feed");

  // The stale digest must not spin the retry loop.
  const spun = mock.feedCalls;
  await settle(page, 1500);
  await page.evaluate(() => { window.__NAV__ ? window.__NAV__.goTo("dashboard") : null; });
  await page.evaluate(() => { window.__NAV__ ? window.__NAV__.goTo("news") : null; });
  await settle(page, 800);
  ok(mock.feedCalls <= spun + 1, `a failing fetch is not retried in a loop (${mock.feedCalls - spun} extra call(s))`);
  mock.feedFails = false;

  // Summaries failing leaves the publisher's blurb rather than blank cards.
  mock.summarizeOk = false;
  await page.evaluate(() => { localStorage.removeItem("bucky_news_cache"); localStorage.removeItem("setting_newsDigest"); });
  await page.evaluate(() => window.__NEWS__.reload());
  await tap(page, "#newsRefreshBtn");
  await page.waitForFunction(() => !window.__NEWS__.busy(), { timeout: 20000 });
  ok(await page.evaluate(() => document.querySelectorAll(".newscard").length === 3), "articles still arrive when the summariser is down");
  ok(await page.evaluate(() => [...document.querySelectorAll(".newsc-sum")].every(e => e.textContent.trim().length > 10)),
    "…and no card is left without text");
  mock.summarizeOk = true;

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ============================ G. layout =================================== */
async function sectionLayout(browser, mock){
  section("G. Layout");

  const { page, errors } = await newPage(browser, mock, { user: "Dad" });
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await seedSources(page, TWO_SOURCES);
  await gotoNews(page);
  await page.waitForFunction(() => document.querySelectorAll(".newscard").length >= 3, { timeout: 15000 });

  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(noHScroll, "the page does not scroll sideways at 390px");

  /* THE CHROME BUDGET. The header lost its logo and half its height to pay for a
     two-row bottom nav; the deal was that the total space spent on app chrome stays
     the same. That is only true if it is measured, so it is measured. */
  const chrome = await page.evaluate(() => {
    const h = document.querySelector("header").getBoundingClientRect();
    const n = document.getElementById("bnav").getBoundingClientRect();
    const rows = new Set([...document.querySelectorAll("#bnav .bnav-btn")].map(b => Math.round(b.getBoundingClientRect().top)));
    return {
      header: Math.round(h.height), nav: Math.round(n.height),
      total: Math.round(h.height + n.height),
      navRows: rows.size,
      buttons: document.querySelectorAll("#bnav .bnav-btn").length,
      logo: !!document.querySelector("header .logo"),
      minBtnW: Math.min(...[...document.querySelectorAll("#bnav .bnav-btn")].map(b => Math.round(b.getBoundingClientRect().width))),
    };
  });
  console.log(`    · header ${chrome.header}px + nav ${chrome.nav}px = ${chrome.total}px, ${chrome.navRows} nav row(s), ${chrome.buttons} buttons, min ${chrome.minBtnW}px wide`);
  ok(chrome.total <= CHROME_BUDGET_PX, `app chrome stays within its budget (${chrome.total}px of ${CHROME_BUDGET_PX}px)`);

  const clipped = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll(".newsc-title, .newsc-sum")){
      if (el.scrollHeight > el.clientHeight + 2) bad.push(el.textContent.slice(0, 30));
    }
    return bad;
  });
  ok(clipped.length === 0, "no headline or summary is cut off" + (clipped.length ? ": " + clipped[0] : ""));

  const overlap = await page.evaluate(() => {
    const nav = document.getElementById("bnav").getBoundingClientRect();
    const cards = [...document.querySelectorAll(".newscard")];
    const last = cards[cards.length - 1];
    last.scrollIntoView({ block: "end" });
    return { navTop: nav.top, bodyBottom: document.querySelector("#newsBody").getBoundingClientRect().bottom };
  });
  ok(typeof overlap.navTop === "number", "the bottom nav is measurable over the feed");

  // Desktop.
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await settle(page, 300);
  await page.evaluate(() => { window.__NAV__ ? window.__NAV__.goTo("news") : null; });
  await settle(page, 400);
  ok(await page.evaluate(() => document.querySelectorAll(".newscard").length >= 3), "the feed renders on desktop too");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "…with no sideways scroll");

  if (WANT_SHOTS){
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "news_desktop.png") });
  }

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));
}

/* ================================ run ===================================== */
(async () => {
  const pub = await servePublisher();
  const nofeed = await serveNoFeed();
  const anth = await serveAnthropic();

  try {
    await sectionServer();
  } catch (err) {
    fail++; failures.push("section A crashed: " + err.message);
    console.log("\n✗ SECTION A ERROR: " + (err && err.stack || err));
  }

  const srv = await serve();
  const mock = makeNewsMock();
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  browser.on("targetcreated", () => {});

  try {
    await sectionShell(browser, mock);
    await sectionFeed(browser, mock);
    await sectionCache(browser, mock);
    await sectionSources(browser, mock);
    await sectionResilience(browser, mock);
    await sectionLayout(browser, mock);
  } catch (err) {
    fail++; failures.push("suite crashed: " + err.message);
    console.log("\n✗ SUITE ERROR: " + (err && err.stack || err));
  } finally {
    await browser.close();
    srv.close(); pub.close(); nofeed.close(); anth.close();
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`NEWS: ${pass}/${pass + fail} checks passed`);
  if (fail){ console.log("\nFailures:"); for (const f of failures) console.log("  ✗ " + f); }
  process.exit(fail ? 1 : 0);
})();
