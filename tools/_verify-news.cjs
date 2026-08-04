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
const PORT = 8874, PUB_PORT = 8875, NOFEED_PORT = 8876, ANTH_PORT = 8877, GOOG_PORT = 8878;
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

/* A publication that puts the REAL article body in content:encoded rather than a teaser.
   ~2,600 characters, so it is long enough to be cut by EXCERPT_CHARS at either the old 700
   or the new 1800 — which is what makes it able to tell them apart. */
const LONG_BODY = ("The county commission voted on Tuesday evening to advance the Mill Road bridge "
  + "replacement to a final reading in September. ").repeat(1)
  + ("Officials presented a forty-page report covering costs, timelines and the objections raised at "
  + "three earlier public hearings, and the plan would be funded through a mix of state grants and a "
  + "small increase in the local levy phased in over four years. Commissioner Alvarez said the plan "
  + "had been revised twice since March to address concerns about traffic on the eastern approach. A "
  + "representative from the regional planning office told the meeting that construction could begin "
  + "next spring if the permits clear by January. Several residents spoke against the timeline, saying "
  + "it did not leave enough room for the seasonal closure of the ford crossing. ").repeat(2)
  + "The county administrator confirmed that the existing structure would remain open throughout "
  + "construction, and copies of the full report have been posted to the county website.";
const LONG_XML = `<?xml version="1.0"?><rss version="2.0"><channel><title>The County Record</title>
<item><title>Commission advances the bridge plan</title><link>${PUB}/c/bridge</link><pubDate>__FRESH1__</pubDate>
<description>A short teaser the publisher shows in a reader.</description>
<content:encoded><![CDATA[<p>${LONG_BODY}</p>]]></content:encoded></item></channel></rss>`;

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
      if (p === "/long.xml") return xml(LONG_XML);
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
        if (anthMode === "long"){
          // A real 4-5 sentence, 110-word summary — ~700 characters, which the pre-2026-08-04
          // 400-char cap would have lopped the last two sentences off, silently and mid-word.
          const long = ("Councillors voted seven to two on Tuesday evening to fund the Mill Road bridge "
            + "replacement after four years of debate. The work is due to begin in the spring and will "
            + "close the ford crossing for the whole of the season. Funding comes from a mix of state "
            + "grants and a small rise in the local levy, phased in over four years. Two councillors who "
            + "voted against said they wanted an independent review of the cost estimates first. The "
            + "existing bridge will stay open until the new one is finished, and the full report has been "
            + "posted to the county website and left at the library.");
          for (let i = 1; i <= n; i++) arr.push({ i, s: long });
          return res.end(JSON.stringify({ content: [{ type:"text", text: JSON.stringify(arr) }], usage:{ input_tokens: 2151, output_tokens: 743 } }));
        }
        for (let i = 1; i <= n; i++) arr.push({ i, s: `Written summary number ${i}.` });
        res.end(JSON.stringify({ content: [{ type:"text", text: "```json\n" + JSON.stringify(arr) + "\n```" }], usage:{ input_tokens: 100, output_tokens: 50 } }));
      });
    });
    srv.listen(ANTH_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ==================== fake Google token + fake Firestore ==================
   News had no telemetry at all until 2026-08-04, which is why its running cost could only
   be estimated. It now writes into the SAME farmgpt_usage docs as everything else, under
   bucket "n". Proving that needs a service account, so the suite mints a throwaway RSA
   key and stands up the two endpoints news.mjs talks to — nothing here touches Google. */
let usageCommits = [];
let googleTokenCalls = 0;
function makeServiceAccount(){
  const crypto = require("crypto");
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return JSON.stringify({ client_email: "news-test@amen-farms-app.iam.gserviceaccount.com", private_key: privateKey });
}
function serveGoogle(port){
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        const p = req.url.split("?")[0];
        if (p === "/token"){
          googleTokenCalls++;
          // A real JWT arrives here; the point is that news.mjs got far enough to sign one.
          return res.end(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }));
        }
        if (p.endsWith(":commit")){
          let b = null; try { b = JSON.parse(raw); } catch {}
          usageCommits.push({ auth: req.headers.authorization || "", body: b });
          return res.end(JSON.stringify({ writeResults: [] }));
        }
        res.statusCode = 404; res.end("{}");
      });
    });
    srv.listen(port, "127.0.0.1", () => resolve(srv));
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
  // 2026-08-03: switched Sonnet 5 -> Haiku (user call — a 40-word compression doesn't need
  // the bigger model, and Haiku is ~a third the price).
  ok(anthLastBody && anthLastBody.model === "claude-haiku-4-5", "summaries are written by Haiku");
  ok(anthLastBody && /Publication: The Daily Trumpet/.test(anthLastBody.messages[0].content),
    "the prompt carries the publication name and headline");
  ok(anthLastBody && /never add facts/i.test(anthLastBody.system), "the system prompt forbids inventing facts");
  ok(anthLastBody && /children/i.test(anthLastBody.system), "the system prompt says a whole family reads this");

  const many = Array.from({ length: 20 }, (_, i) => ({ id: "x" + i, title: "T" + i, excerpt: "e", sourceTitle: "S" }));
  const capSum = await call({ secret: SECRET, action: "summarize", articles: many });
  const batchCap = Object.keys(capSum.body.summaries || {}).length;
  ok(batchCap <= 8, "a summarize call is capped so it cannot outrun the function timeout");

  /* ---------------------------------------------------------------------------
     A2. THE LONGER SUMMARIES (2026-08-04). The brief moved from 1-2 sentences to 4-5,
     and three separate caps sized for the SHORT version sat between the model and the
     screen. Every one of them fails the same silent way: the reader just gets less.
     --------------------------------------------------------------------------- */
  section("A2. Longer summaries — the length target and the caps that used to clip it");

  const sys = anthLastBody.system;
  ok(/4-5 plain sentences/.test(sys) && /80-110 words/.test(sys),
    "the brief asks for 4-5 sentences, 80-110 words");
  ok(!/1-2 plain sentences/.test(sys) && !/25-45 words/.test(sys),
    "…and the old 1-2 sentence / 25-45 word target is gone, not left alongside it");
  // The invent-nothing rule matters MORE at this length, not less: a model asked for 95
  // words from a teaser will pad, and padding in a news summary is fabrication.
  ok(/Never add facts, figures, names, dates, causes, reactions or outcomes that are not there/.test(sys),
    "the invent-nothing rule is stated in full and covers dates, causes and outcomes too");
  ok(/LENGTH IS A CEILING, NOT A QUOTA/.test(sys), "the length is explicitly a ceiling rather than a quota");
  ok(/do not speculate about what the rest of the article probably says in order to reach four sentences/i.test(sys),
    "…and the model is told in as many words not to pad a thin excerpt up to the target");
  ok(/write ONE neutral sentence/.test(sys) && /That is the right answer, not a failure/.test(sys),
    "the thin-excerpt escape hatch is explicit and easy to take");
  // Everything the prompt already promised, still promised.
  ok(/Lead with the substance/.test(sys) && /Never open with "This article/.test(sys), "lead-with-substance survives");
  ok(/Neutral and factual/.test(sys) && /No opinion, no editorialising/.test(sys), "neutral / no-editorialising survives");
  ok(/whole family including children/.test(sys) && /plainly and gently rather than vividly/.test(sys),
    "the family-safe rule survives, difficult news plain rather than vivid");
  ok(/Plain prose only\. No markdown/.test(sys), "no-markdown survives");
  ok(/Reply with ONLY a JSON array/.test(sys) && /\{"i":1,"s":"\.\.\."\}/.test(sys), "the strict JSON reply shape survives");

  /* THE HARD BLOCKER. A full batch at maximum plausible length must fit under max_tokens,
     or the reply is cut off mid-JSON and the WHOLE batch silently reverts to publisher
     blurbs. The old formula did not: measured against real Haiku, a batch of 8 rich
     articles produced 995 output tokens against a cap of 940. */
  const src = fs.readFileSync(path.join(ROOT, "netlify", "functions", "news.mjs"), "utf8");
  const maxBatch = Number(/const MAX_SUMMARIZE = (\d+)/.exec(src)[1]);
  const capOf = (n) => {
    const base = Number(/const SUMMARY_BASE_TOKENS = (\d+)/.exec(src)[1]);
    const per = Number(/const SUMMARY_TOKENS_PER_ARTICLE = (\d+)/.exec(src)[1]);
    return Math.min(4096, base + n * per);
  };
  // 110 words at ~1.4 tokens/word (news prose, names and figures included) = 154, plus ~12
  // for the {"i":n,"s":"…"} wrapper. That is the worst case the brief can legitimately ask for.
  const WORST_PER_ARTICLE = 166;
  ok(capOf(maxBatch) >= maxBatch * WORST_PER_ARTICLE,
    `a FULL batch of ${maxBatch} at the top of the length band (${maxBatch * WORST_PER_ARTICLE} tokens) fits under the cap (${capOf(maxBatch)})`);
  ok(capOf(maxBatch) >= maxBatch * WORST_PER_ARTICLE * 1.3,
    "…with real headroom for a model that overshoots the word target, not a hairline fit");
  ok(capOf(maxBatch) <= 4096, "…and the ceiling is still sane (4096)");
  ok(220 + maxBatch * 90 < maxBatch * WORST_PER_ARTICLE,
    "the OLD formula (220 + n*90) provably could not have carried this length — this is the regression tripwire");

  anthMode = "long";
  const longArts = [{ id: "L1", sourceTitle: "The County Record", title: "Commission advances the bridge plan", excerpt: LONG_BODY.slice(0, 900) }];
  const longSum = await call({ secret: SECRET, action: "summarize", articles: longArts });
  ok(anthLastBody.max_tokens === capOf(1), "the cap on the wire is the one the constants derive, not a literal");
  const written = (longSum.body.summaries || {}).L1 || "";
  // 400 is the exact bar — that was the old cap, sized for 25-45 words. A measured live
  // summary at the top of the new band ran 610 characters; this fixture is 574.
  ok(written.length > 500, `a real 4-5 sentence summary survives whole (${written.length} chars; the old 400 cap would have cut it)`);
  ok(/posted to the county website and left at the library\.$/.test(written),
    "…right down to its last sentence — no silent mid-word truncation");
  ok(written.split(/(?<=[.!?])\s+/).filter(Boolean).length >= 4, "…and it really is 4+ sentences on the card");
  anthMode = "good";

  /* THE RICHER SOURCE TEXT. A publication that ships its real body in content:encoded now
     hands the summariser ~300 words instead of ~120. */
  const longFeed = await call({ secret: SECRET, action: "feed",
    sources: [{ id: "rec", title: "The County Record", feedUrl: PUB + "/long.xml" }] });
  const longItem = (longFeed.body.items || [])[0];
  ok(longItem && longItem.excerpt.length > 700,
    `a full-text article now reaches the summariser past the old 700-char cut (${longItem ? longItem.excerpt.length : 0} chars)`);
  ok(longItem && longItem.excerpt.length <= 1800, "…and is still capped, so one verbose publisher cannot flood a batch");
  ok(longItem && /forty-page report/.test(longItem.excerpt),
    "…and the text that arrives is the article body, not the teaser");
  // The FALLBACK card is a different question and must NOT have grown with it: 1800
  // characters of raw article body on a phone card is not a fallback, it is a wall.
  ok(longItem && longItem.summary.length <= 240,
    `the no-model fallback card is still trimmed short (${longItem ? longItem.summary.length : 0} chars) even from a long excerpt`);
  ok(longItem && longItem.summarySource === "feed", "…and still says it came from the publisher, not from Bucky");

  // A long excerpt has to survive the summarize endpoint's own input sanitiser too.
  await call({ secret: SECRET, action: "summarize",
    articles: [{ id: "L2", sourceTitle: "S", title: "T", excerpt: "z".repeat(4000) }] });
  const sent = /Excerpt: (z+)/.exec(anthLastBody.messages[0].content);
  ok(sent && sent[1].length === 1800, `the endpoint passes the excerpt through at the full length and clamps there (${sent ? sent[1].length : 0})`);

  // THE CROSS-FILE ONE. Ask the server for more than it will take and the overflow is
  // dropped with nothing said — those cards would never be summarised at all.
  const clientSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const chunk = Number(/const NEWS_SUM_CHUNK = (\d+)/.exec(clientSrc)[1]);
  ok(chunk === maxBatch, `the client's batch size (${chunk}) matches the server's MAX_SUMMARIZE (${maxBatch})`);
  ok(batchCap === maxBatch, "…and the server really does clamp there");

  /* ---------------------------------------------------------------------------
     A3. USAGE TELEMETRY. News burned tokens invisibly; it now writes bucket "n" into the
     same farmgpt_usage docs everything else uses.
     --------------------------------------------------------------------------- */
  section("A3. Usage telemetry — the news line on the cost dashboard");

  usageCommits = []; googleTokenCalls = 0;
  process.env.FIREBASE_SERVICE_ACCOUNT = makeServiceAccount();
  process.env.FARMGPT_GOOGLE_TOKEN_URL = `http://127.0.0.1:${GOOG_PORT}/token`;
  process.env.FARMGPT_FIRESTORE_BASE = `http://127.0.0.1:${GOOG_PORT}/v1/projects/amen-farms-app/databases/(default)/documents`;
  // Re-import under a fresh specifier: the module reads these at load time.
  const mod2 = await import("file://" + path.join(ROOT, "netlify", "functions", "news.mjs").replace(/\\/g, "/") + "?usage=1");
  const prevHandler = handler;
  handler = mod2.default;

  const uSum = await call({ secret: SECRET, action: "summarize", articles: arts });
  ok(uSum.body.ok === true && Object.keys(uSum.body.summaries).length === 2, "summaries still land with telemetry wired in");
  ok(uSum.body.usage && uSum.body.usage.in === 100 && uSum.body.usage.out === 50,
    "the response reports what the batch actually cost, so a run can be measured rather than estimated");
  ok(googleTokenCalls === 1, "a service-account token is minted for the write");
  ok(usageCommits.length === 1, "one commit per summarize call");
  const writes = ((usageCommits[0] || {}).body || {}).writes || [];
  ok(writes.length === 2, "…carrying both the daily rollup and the hourly bucket, in ONE commit");
  ok(/farmgpt_usage\/\d{4}-\d{2}-\d{2}$/.test(writes[0].transform.document), "the daily doc is keyed by the farm's own date");
  ok(/farmgpt_usage_hourly\/\d{4}-\d{2}-\d{2}-\d{2}$/.test(writes[1].transform.document), "the hourly doc is keyed by the farm's own hour");
  const paths = writes[0].transform.fieldTransforms.map((f) => f.fieldPath);
  ok(paths.includes("n_in") && paths.includes("n_out") && paths.includes("n_req"),
    "the tokens land in bucket n — free when this shipped; s u r d k a g c l x t f were taken");
  ok(paths.includes("n_claudehaiku45_in") && paths.includes("n_claudehaiku45_out"),
    "…and again under the model that produced them, so a model change can't silently rewrite old costs");
  const inTf = writes[0].transform.fieldTransforms.find((f) => f.fieldPath === "n_in");
  ok(inTf && inTf.increment.integerValue === "100", "the increment is the real token count, not a placeholder");
  ok((usageCommits[0].auth || "").startsWith("Bearer "), "the commit is authenticated");

  // Telemetry must never be able to break a summary — that is the whole point of the try/catch.
  process.env.FARMGPT_GOOGLE_TOKEN_URL = `http://127.0.0.1:${GOOG_PORT}/nope`;
  const mod3 = await import("file://" + path.join(ROOT, "netlify", "functions", "news.mjs").replace(/\\/g, "/") + "?usage=2");
  handler = mod3.default;
  const brokenLog = await call({ secret: SECRET, action: "summarize", articles: arts });
  ok(brokenLog.body.ok === true && Object.keys(brokenLog.body.summaries).length === 2,
    "with the usage backend down the summaries still arrive — telemetry never breaks a reply");

  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FARMGPT_GOOGLE_TOKEN_URL;
  delete process.env.FARMGPT_FIRESTORE_BASE;
  handler = prevHandler;

  // The dashboard has to know the bucket exists, in both halves, or the row reads zero forever.
  const fgSrc = fs.readFileSync(path.join(ROOT, "netlify", "functions", "farmgpt.mjs"), "utf8");
  ok(/const USAGE_BUCKETS = \[[^\]]*"n"/.test(fgSrc), "farmgpt.mjs's reader knows about bucket n");
  const fgHtml = fs.readFileSync(path.join(ROOT, "farmgpt.html"), "utf8");
  ok(/\{ p: "n", icon: "📰", name: "News summaries"/.test(fgHtml), "the usage dashboard carries a News row");

  section("A. (continued)");

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
  // What a real summary reads like — the screenshots ARE the design review, so a placeholder
  // string here would review the wrong thing. Lengthened 2026-08-04 with the move to 4-5
  // sentences: these are 85-100 words, matching the live measurements, because the whole
  // question the screenshot has to answer is what that does to the feed's density.
  state.written = {
    a1: "Councillors voted seven to two on Tuesday evening to fund the Mill Road bridge replacement, "
      + "ending four years of debate. Construction is due to start in the spring and will close the ford "
      + "crossing for the season. The money comes from a mix of state grants and a small rise in the "
      + "local levy, phased in over four years. Two councillors who voted against said they wanted an "
      + "independent review of the cost estimates first. The existing bridge stays open until the new "
      + "one is finished.",
    a2: "Steady rain is forecast every day through Friday, with the heaviest falls expected on Wednesday "
      + "afternoon. Forecasters say up to two inches could arrive in the space of six hours across the "
      + "eastern half of the county. Standing water is likely on low-lying roads, and the ford crossing "
      + "may be impassable by Thursday morning. The rain is expected to clear on Saturday, though the "
      + "ground will stay saturated into next week.",
    b1: "The harvest festival returns to the fairground this weekend after a three-year gap. Organisers "
      + "have added a livestock show and moved the parade to Sunday morning so it no longer clashes with "
      + "the judging. Entry is free for children, and the produce tent opens at nine on Saturday. The "
      + "committee says it has doubled the number of stalls after the last festival sold out its pitches "
      + "within a fortnight.",
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
    // evaluateOnNewDocument re-runs on EVERY navigation in this page/context, so a plain
    // unconditional setItem would stomp a mid-test profile switch (e.g. Task 3's per-user
    // News preference check, which sets choreUser then reloads) back to the original user
    // on the very reload meant to prove the switch stuck. Only seed it when nothing is
    // already there — i.e. the context's first navigation.
    if (u) { if (!localStorage.getItem("choreUser")) localStorage.setItem("choreUser", u); }
    else localStorage.removeItem("choreUser");
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
// 2026-08-03 restage: the feed's filter chips became TOPICS, not publication names (a
// topic can be shared by several publications). These two carry DIFFERENT topics so the
// filter-chip checks below exercise the real feature instead of the old per-publication
// picker.
const TWO_SOURCES = [
  { id:"s1", title:"The Daily Trumpet", url:"https://trumpet.example.com", feedUrl:"https://trumpet.example.com/rss.xml", topic:"US News" },
  { id:"s2", title:"Gazette", url:"https://gazette.example.com", feedUrl:"https://gazette.example.com/atom.xml", topic:"Sports" },
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

  /* -- the topic filter (2026-08-03: chips are TOPICS now, not publication names — the
     two seeded sources carry different topics, "US News" and "Sports") -- */
  ok(await page.evaluate(() => !!document.querySelector("#newsFilter")), "a topic filter shows once there is more than one topic");
  const chipLabels = await page.evaluate(() => [...document.querySelectorAll("#newsFilter button")].map(b => b.textContent));
  ok(chipLabels.includes("All") && chipLabels.includes("US News") && chipLabels.includes("Sports"),
    "the chips are All + each publication's topic, not the publication names (" + chipLabels.join(", ") + ")");
  ok(await page.evaluate(() => document.querySelector('.newsfilter').scrollWidth <= document.querySelector('.newsfilter').clientWidth + 1),
    "the topic row wraps rather than scrolling sideways");
  await tap(page, '#newsFilter button[data-topic="Sports"]');
  await settle(page, 200);
  const only = await page.evaluate(() => [...document.querySelectorAll(".newscard")].map(c => c.dataset.src));
  ok(only.length === 1 && only[0] === "s2", "filtering to one topic shows only that topic's articles");
  await tap(page, '#newsFilter button[data-topic=""]');
  await settle(page, 200);
  ok(await page.evaluate(() => document.querySelectorAll(".newscard").length === 3), "All brings the whole feed back");

  /* -- the 📰 per-user publication toggle -- */
  ok(await page.evaluate(() => !!document.querySelector("#newsPubBtn")), "the 📰 publication toggle button exists");
  await tap(page, "#newsPubBtn");
  await settle(page, 200);
  ok(await page.evaluate(() => document.querySelectorAll("#newsPubMenu .newspubrow").length === 2), "…and lists both publications");
  ok(await page.evaluate(() => [...document.querySelectorAll('#newsPubMenu input[type="checkbox"]')].every(c => c.checked)),
    "…both start on");
  await tap(page, '#newsPubMenu input[data-pub="s2"]');
  await settle(page, 250);
  ok(await page.evaluate(() => [...document.querySelectorAll(".newscard")].every(c => c.dataset.src === "s1")),
    "turning off a publication hides its articles from the feed");
  ok(await page.evaluate(() => ![...document.querySelectorAll("#newsFilter button")].some(b => b.dataset.topic === "Sports")),
    "…and its topic disappears from the chips since no enabled source carries it any more");
  // The dropdown stays OPEN across the toggle's re-render (newsTogglePub only repaints
  // News, it never touches newsPubMenuOpen) — re-tapping #newsPubBtn here would CLOSE it.
  await tap(page, '#newsPubMenu input[data-pub="s2"]');
  await settle(page, 250);
  ok(await page.evaluate(() => document.querySelectorAll(".newscard").length === 3), "re-enabling it restores its articles");
  ok(await page.evaluate(() => [...document.querySelectorAll("#newsFilter button")].some(b => b.dataset.topic === "Sports")),
    "…and its topic chip comes back");

  // Outside tap closes the dropdown. The re-enable step above left it OPEN, so close it
  // first rather than assuming its state — a stray tap on #newsPubBtn here would toggle
  // it the wrong way depending on what ran before.
  if (await page.evaluate(() => !!document.getElementById("newsPubMenu"))){
    await page.click(".newshead-t");
    await settle(page, 150);
  }
  await tap(page, "#newsPubBtn");
  await settle(page, 150);
  ok(await page.evaluate(() => !!document.getElementById("newsPubMenu")), "the dropdown is open");
  await page.click(".newshead-t");
  await settle(page, 150);
  ok(await page.evaluate(() => !document.getElementById("newsPubMenu")), "…and a tap outside it closes it");

  // The preference is PER-USER: switching profiles on the same device must not carry
  // Dad's "Gazette off" choice to Isaac.
  await tap(page, "#newsPubBtn");
  await settle(page, 150);
  await tap(page, '#newsPubMenu input[data-pub="s2"]');
  await settle(page, 250);
  ok(await page.evaluate(() => document.querySelectorAll(".newscard").length === 2), "Dad's own preference took effect");
  await page.evaluate(() => localStorage.setItem("choreUser", "Isaac"));
  await gotoNews(page);
  await page.waitForFunction(() => document.querySelectorAll(".newscard").length >= 1, { timeout: 15000 });
  ok(await page.evaluate(() => document.querySelectorAll(".newscard").length === 3), "…but Isaac still sees every publication, unaffected");
  await page.evaluate(() => localStorage.setItem("choreUser", "Dad"));
  await gotoNews(page);
  await page.waitForFunction(() => document.querySelectorAll(".newscard").length >= 1, { timeout: 15000 });
  ok(await page.evaluate(() => document.querySelectorAll(".newscard").length === 2), "…and Dad's own preference is still there when he comes back");
  // Restore both on for the rest of this section.
  await tap(page, "#newsPubBtn");
  await settle(page, 150);
  await tap(page, '#newsPubMenu input[data-pub="s2"]');
  await settle(page, 250);
  ok(await page.evaluate(() => document.querySelectorAll(".newscard").length === 3), "restored to the full feed for the rest of the section");

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

  // 2026-08-03: a source saved before the topic feature (no `topic` field at all) reads
  // as the default "News" in the read-only sheet, never "undefined".
  await tap(kid.page, "#newsSrcDone");
  await settle(kid.page, 200);
  await seedSources(kid.page, [...TWO_SOURCES, { id:"s3", title:"Old Paper", url:"https://old.example.com", feedUrl:"https://old.example.com/rss.xml" }]);
  await gotoNews(kid.page);
  await settle(kid.page, 400);
  await tap(kid.page, "#newsSourcesBtn");
  await settle(kid.page, 300);
  const legacyTopicText = await kid.page.evaluate(() => {
    const row = [...document.querySelectorAll("#newsSrcList .newssrc")].find(r => r.textContent.includes("Old Paper"));
    const t = row && row.querySelector(".newssrc-topic");
    return t ? t.textContent : null;
  });
  ok(legacyTopicText === "News", "a topic-less legacy source reads \"News\" (" + legacyTopicText + ")");
  await tap(kid.page, "#newsSrcDone");
  await settle(kid.page, 200);
  await seedSources(kid.page, TWO_SOURCES);   // restore for the rest of this section

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

  // 2026-08-03: an unlocked Dad gets an editable topic <select> per source, and picking
  // one saves it immediately (no separate Save button — same pattern as everything else
  // in this sheet).
  const topicSaved = await page.evaluate(async () => {
    const sel = document.querySelector(".newssrc-topicsel");
    if (!sel) return null;
    sel.value = "Sports";
    sel.dispatchEvent(new Event("change"));
    await new Promise(r => setTimeout(r, 400));
    return window.__NEWS__.sources()[0].topic;
  });
  ok(topicSaved === "Sports", "the topic select in the sheet saves (" + topicSaved + ")");

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

  /* DENSITY (2026-08-04). 4-5 sentences per card is roughly three times the text the feed
     carried at 1-2, and that is a real change to how far a reader scrolls. Measured rather
     than eyeballed, and REPORTED as well as asserted — the number is the point. */
  const density = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".newscard")].map(c => Math.round(c.getBoundingClientRect().height));
    const sums = [...document.querySelectorAll(".newsc-sum")].map(s => s.textContent.trim().split(/\s+/).length);
    return { cards, sums, viewport: window.innerHeight, feed: Math.round(document.querySelector("#newsBody").getBoundingClientRect().height) };
  });
  console.log(`    · card heights ${density.cards.join("/")}px on a ${density.viewport}px screen; summaries ${density.sums.join("/")} words; ${density.cards.length} cards = ${density.feed}px of feed`);
  ok(Math.max(...density.cards) < density.viewport,
    `a whole card still fits on the screen at once (tallest ${Math.max(...density.cards)}px of ${density.viewport}px)`);
  ok(Math.max(...density.sums) >= 60, `the cards really are carrying the longer summaries (up to ${Math.max(...density.sums)} words)`);

  const overlap = await page.evaluate(() => {
    const nav = document.getElementById("bnav").getBoundingClientRect();
    const cards = [...document.querySelectorAll(".newscard")];
    const last = cards[cards.length - 1];
    last.scrollIntoView({ block: "end" });
    return { navTop: nav.top, bodyBottom: document.querySelector("#newsBody").getBoundingClientRect().bottom };
  });
  ok(typeof overlap.navTop === "number", "the bottom nav is measurable over the feed");

  if (WANT_SHOTS){
    fs.mkdirSync(SHOTS, { recursive: true });
    // The density review: the top of the feed as a phone sees it, and the whole scroll
    // length, because "how heavy does this feel" is a question about both.
    await page.screenshot({ path: path.join(SHOTS, "news_long_390.png") });
    await page.screenshot({ path: path.join(SHOTS, "news_long_390_full.png"), fullPage: true });
  }

  // Desktop.
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await settle(page, 300);
  await page.evaluate(() => { window.__NAV__ ? window.__NAV__.goTo("news") : null; });
  await settle(page, 400);
  ok(await page.evaluate(() => document.querySelectorAll(".newscard").length >= 3), "the feed renders on desktop too");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "…with no sideways scroll");

  /* 2026-08-03 — at ≥1024px the app is a website: a fixed left rail carries the nav and
     the feed lives in the content column beside it, never underneath it. */
  const deskGeo = await page.evaluate(() => {
    const sn = document.getElementById("sidenav").getBoundingClientRect();
    const cards = [...document.querySelectorAll(".newscard")].map(c => c.getBoundingClientRect());
    return {
      railRight: Math.round(sn.right),
      railVisible: getComputedStyle(document.getElementById("sidenav")).display !== "none",
      feedLeft: Math.round(Math.min(...cards.map(c => c.left))),
      feedRight: Math.round(Math.max(...cards.map(c => c.right))),
      bnav: getComputedStyle(document.getElementById("bnav")).display,
      viewport: window.innerWidth,
    };
  });
  ok(deskGeo.railVisible && deskGeo.bnav === "none", "the bottom bar has become a left rail");
  ok(deskGeo.feedLeft > deskGeo.railRight,
    `the feed sits in the content column right of the rail (${deskGeo.feedLeft} > ${deskGeo.railRight})`);
  ok(deskGeo.feedRight <= deskGeo.viewport, `…and inside the viewport (${deskGeo.feedRight} ≤ ${deskGeo.viewport})`);

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
  const goog = await serveGoogle(GOOG_PORT);

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
    srv.close(); pub.close(); nofeed.close(); anth.close(); goog.close();
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`NEWS: ${pass}/${pass + fail} checks passed`);
  if (fail){ console.log("\nFailures:"); for (const f of failures) console.log("  ✗ " + f); }
  process.exit(fail ? 1 : 0);
})();
