#!/usr/bin/env node
"use strict";
/**
 * BUCKY Bookshelf suite — profiles, catalog search, Goodreads reviews,
 * recommendations, and the political / woke rating.
 *
 *   node tools/_verify-books.cjs [--shots]
 *
 * Section A runs netlify/functions/books.mjs IN PROCESS against fake Open
 * Library / Google Books / Goodreads servers. The Goodreads HTML is the shape
 * the live book page shipped on 2026-09-21 (JSON-LD Book + __NEXT_DATA__
 * apolloState Review:* objects), including a 403 refusal. Nothing here
 * touches the real internet.
 *
 * Section B drives books.html (and the Home card) in Chrome at 390x844 and
 * desktop with the function ROUTE-MOCKED.
 *
 * FIREBASE IS BLOCKED on any index.html load (googleapis / firestore / firebase / gstatic).
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const WANT_SHOTS = process.argv.includes("--shots");
const PORT = 8894, OL_PORT = 8895, GB_PORT = 8896, GR_PORT = 8897;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "amenfarms";

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ fixtures =================================== */
const HOBBIT_DESC = "Bilbo Baggins is a hobbit who enjoys a comfortable, unambitious life, rarely traveling farther than his pantry.";
const FRAGILITY_DESC = "Antiracist educator Robin DiAngelo examines white fragility and white privilege in the United States.";
const ANIMAL_DESC = "A farm of animals overthrow their farmer in a revolution that becomes a totalitarian state. A political allegory.";
const HATE_DESC = "A teenage girl speaks out after police shoot her unarmed friend, against systemic racism and in a wave of protest activism.";
const MOCKINGBIRD_DESC = "A lawyer in a small town defends a Black man accused of rape. A story about justice, childhood, and racial prejudice in the American South.";
const QUEER_DESC = "A memoir about gender identity.";

// Hand-computed from POLITICAL_PHRASES / WOKE_PHRASES in books.mjs:
// Fragility: "white fragility"(3) + "white privilege"(3) = 6 → woke 5, political 0
// Animal Farm: revolution(1)+totalitarian(1)+political(1) = political 3, woke 0
// Hate U Give: protest(1) political; systemic racism(2)+activism(1) woke 3
// Queer: "gender queer"(3 from title)+ "gender identity"(2) = woke 5
// Hobbit / Mockingbird: no listed phrases → 0 / 0

const GR_HOBBIT_HTML = `<!doctype html><html><head>
<meta property="og:title" content="The Hobbit"/>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Book","name":"The Hobbit","isbn":"9780547928227","author":[{"@type":"Person","name":"J.R.R. Tolkien"}],"aggregateRating":{"@type":"AggregateRating","ratingValue":4.3,"ratingCount":4635081,"reviewCount":95173}}</script>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: { pageProps: { apolloState: {
    "User:1": { __typename: "User", name: "Matt", id: 1 },
    "User:2": { __typename: "User", name: "Priya", id: 2 },
    "Review:kca://review:goodreads/amzn1.gr.review:goodreads.v1.aaa": {
      __typename: "Review", rating: 5, creator: { __ref: "User:1" },
      text: "Some books are almost impossible to review. If a book is bad, how easily can we dwell on its flaws! But if the book is good, how do you give any recommendation that is equal the book.",
    },
    "Review:kca://review:goodreads/amzn1.gr.review:goodreads.v1.bbb": {
      __typename: "Review", rating: 4, creator: { __ref: "User:2" },
      text: "In a hole in the ground there lived a hobbit. That sentence still works, every time, and the road goes on from there.",
    },
  } } },
})}</script>
</head><body><div class="RatingStatistics__rating">4.30</div></body></html>`;

const GR_CAPTCHA_HTML = `<!doctype html><html><head><title>Robot Check</title></head><body>Please confirm you are not a robot.</body></html>`;

const OL_DOCS = {
  hobbit: { key: "/works/OL262758W", title: "The Hobbit", author_name: ["J.R.R. Tolkien"], first_publish_year: 1937, isbn: ["9780547928227"], subject: ["Fantasy", "Hobbits"], cover_i: 14625765, ratings_average: 4.2, ratings_count: 1200 },
  silmarillion: { key: "/works/OL27482W", title: "The Silmarillion", author_name: ["J.R.R. Tolkien"], first_publish_year: 1977, isbn: ["9780544338012"], subject: ["Fantasy"], ratings_average: 3.9, ratings_count: 400 },
  fragility: { key: "/works/OL17930368W", title: "White Fragility", author_name: ["Robin DiAngelo"], first_publish_year: 2018, isbn: ["9780807047415"], subject: ["Racism"] },
  cookbook: { key: "/works/OL111W", title: "Farm Cookbook", author_name: ["Aunt June"], first_publish_year: 1999, isbn: ["9780000000001"], subject: ["Cooking"] },
};

function gbVolume(id, title, author, extra) {
  extra = extra || {};
  return {
    id,
    volumeInfo: {
      title,
      authors: [author],
      publishedDate: extra.year || "2000",
      description: extra.description || "",
      averageRating: extra.rating,
      ratingsCount: extra.ratingsCount,
      categories: extra.subjects || [],
      industryIdentifiers: extra.isbn ? [{ type: "ISBN_13", identifier: extra.isbn }] : [],
      imageLinks: extra.cover ? { thumbnail: extra.cover } : undefined,
    },
  };
}

let olCalls = [];
let gbCalls = [];
let grCalls = [];
let grMode = "good";

function serveOL() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      olCalls.push(u.searchParams.get("q") || "");
      res.setHeader("content-type", "application/json");
      const q = (u.searchParams.get("q") || "").toLowerCase();
      const docs = [];
      if (/hobbit|tolkien|fantasy/.test(q)) docs.push(OL_DOCS.hobbit, OL_DOCS.silmarillion);
      if (/fragility|diangelo/.test(q)) docs.push(OL_DOCS.fragility);
      if (/cookbook|cooking/.test(q)) docs.push(OL_DOCS.cookbook);
      res.end(JSON.stringify({ numFound: docs.length, docs }));
    });
    srv.listen(OL_PORT, "127.0.0.1", () => resolve(srv));
  });
}
function serveGB() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      gbCalls.push(u.searchParams.get("q") || "");
      res.setHeader("content-type", "application/json");
      const q = (u.searchParams.get("q") || "").toLowerCase();
      const items = [];
      if (/hobbit|tolkien|fantasy/.test(q)) {
        items.push(gbVolume("gb-hobbit", "The Hobbit", "J.R.R. Tolkien", {
          year: "1937", isbn: "9780547928227", description: HOBBIT_DESC, rating: 4.5, ratingsCount: 200, subjects: ["Fiction / Fantasy"],
        }));
        items.push(gbVolume("gb-sil", "The Silmarillion", "J.R.R. Tolkien", {
          year: "1977", isbn: "9780544338012", description: "The history of the First Age of Middle-earth, the Silmarils, and the wars of the elves.", subjects: ["Fantasy"],
        }));
      }
      if (/fragility|diangelo/.test(q)) {
        items.push(gbVolume("gb-frag", "White Fragility", "Robin DiAngelo", {
          year: "2018", isbn: "9780807047415", description: FRAGILITY_DESC, rating: 4.0, ratingsCount: 80,
        }));
      }
      res.end(JSON.stringify({ items }));
    });
    srv.listen(GB_PORT, "127.0.0.1", () => resolve(srv));
  });
}
function serveGR() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      grCalls.push(req.url);
      if (grMode === "forbid") {
        res.statusCode = 403;
        return res.end(GR_CAPTCHA_HTML);
      }
      if (grMode === "empty") {
        res.setHeader("content-type", "text/html");
        return res.end(GR_CAPTCHA_HTML);
      }
      if (/\/book\/isbn\/9780547928227/.test(req.url) || /\/book\/show\//.test(req.url)) {
        res.setHeader("content-type", "text/html");
        return res.end(GR_HOBBIT_HTML);
      }
      res.statusCode = 404;
      res.end("not found");
    });
    srv.listen(GR_PORT, "127.0.0.1", () => resolve(srv));
  });
}

function callHandler(handler, body, method) {
  const req = new Request("http://127.0.0.1/.netlify/functions/books", {
    method: method || "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:8080" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  return handler(req);
}

async function sectionServer() {
  section("A. Function, scoring, Goodreads parse, recommend");

  process.env.BUCKY_NOTIFY_SECRET = SECRET;
  process.env.BOOKS_OL_BASE = `http://127.0.0.1:${OL_PORT}`;
  process.env.BOOKS_GB_BASE = `http://127.0.0.1:${GB_PORT}`;
  process.env.BOOKS_GR_BASE = `http://127.0.0.1:${GR_PORT}`;

  const mod = await import("file://" + path.join(ROOT, "netlify", "functions", "books.mjs").replace(/\\/g, "/"));
  const handler = mod.default;
  ok(typeof handler === "function", "books.mjs exports a handler");
  ok(typeof mod.scorePolitics === "function", "scorePolitics is exported");
  ok(typeof mod.recommendScore === "function", "recommendScore is exported");
  ok(typeof mod.parseGoodreadsHtml === "function", "parseGoodreadsHtml is exported");

  const src = fs.readFileSync(path.join(ROOT, "netlify", "functions", "books.mjs"), "utf8");
  ok(/civil rights/.test(src) && /deliberately absent/.test(src),
    "the rubric names the false-positives it refuses (civil rights / race-as-identity)");
  ok(/function asNum/.test(src) && /Number\(null\) is 0/.test(src),
    "missing community ratings go through asNum, not Number(null)");

  const bad = await callHandler(handler, { secret: "nope", action: "search", q: "hobbit" });
  ok(bad.status === 401, "wrong secret is 401");
  const get = await callHandler(handler, null, "GET");
  ok(get.status === 405, "GET is 405");
  const noAct = await callHandler(handler, { secret: SECRET, action: "explode" });
  ok(noAct.status === 400, "unknown action is 400");

  // --- politics: hand-computed ---
  const frag = mod.scorePolitics({ title: "White Fragility", description: FRAGILITY_DESC, subjects: [] });
  ok(frag.woke === 5 && frag.political === 0, "White Fragility is woke 5 / political 0 (3+3 capped)");
  ok(frag.evidence.indexOf("white fragility") >= 0 && frag.evidence.indexOf("white privilege") >= 0,
    "…and names the two phrases that produced it");
  ok(frag.evidence.indexOf("privilege") < 0,
    "…without also counting the shorter 'privilege' inside 'white privilege'");
  ok(frag.confidence === "high", "two hits / raw 6 is high confidence");

  const farm = mod.scorePolitics({ title: "Animal Farm", description: ANIMAL_DESC, subjects: [] });
  ok(farm.political === 3 && farm.woke === 0, "Animal Farm is political 3 / woke 0 (revolution+totalitarian+political)");

  const hate = mod.scorePolitics({ title: "The Hate U Give", description: HATE_DESC, subjects: [] });
  ok(hate.political === 1 && hate.woke === 3, "Hate U Give is political 1 (protest) / woke 3 (systemic racism+activism)");

  const queer = mod.scorePolitics({ title: "Gender Queer", description: QUEER_DESC, subjects: [] });
  ok(queer.woke === 5 && queer.political === 0, "Gender Queer is woke 5 (title 3 + gender identity 2)");

  const hobbit = mod.scorePolitics({ title: "The Hobbit", description: HOBBIT_DESC, subjects: ["Fantasy", "Hobbits"] });
  ok(hobbit.political === 0 && hobbit.woke === 0, "The Hobbit is 0 / 0 — a zero is a real score, not a miss");
  ok(hobbit.confidence === "high", "a long unmarked description is high-confidence 0, not 'unknown'");

  const mock = mod.scorePolitics({ title: "To Kill a Mockingbird", description: MOCKINGBIRD_DESC, subjects: ["Race relations"] });
  ok(mock.political === 0 && mock.woke === 0, "Mockingbird is not woke: race/justice/slavery-adjacent history is not on the list");

  const baby = mod.scorePolitics({ title: "Antiracist Baby", description: "A board book.", subjects: [] });
  ok(baby.woke === 3, "Antiracist Baby title alone is woke 3");

  // --- recommend arithmetic ---
  const shelf = [{ title: "The Hobbit", author: "J.R.R. Tolkien", subjects: ["Fantasy", "Hobbits"], rating: 5 }];
  const sil = { title: "The Silmarillion", author: "J.R.R. Tolkien", subjects: ["Fantasy"], description: "", political: 0, woke: 0 };
  const recSil = mod.recommendScore(sil, { shelf, interests: ["fantasy"], maxPolitical: 5, maxWoke: 5 });
  // author liked +3, one shared subject +1, interest "fantasy" in subjects +2 = 6
  ok(recSil.score === 6 && !recSil.excluded, "Silmarillion scores 3+1+2=6 against a liked Hobbit + fantasy interest");
  ok(recSil.reasons.length === 3, "…and states all three reasons");

  const recSelf = mod.recommendScore({ title: "The Hobbit", author: "J.R.R. Tolkien", subjects: [], political: 0, woke: 0 }, { shelf, interests: [], maxPolitical: 5, maxWoke: 5 });
  ok(recSelf.excluded && recSelf.excludeReason === "already-on-shelf", "a book already on the shelf is excluded");

  const recWoke = mod.recommendScore({ title: "White Fragility", author: "Robin DiAngelo", subjects: [], political: 0, woke: 5 }, { shelf, interests: [], maxPolitical: 5, maxWoke: 2 });
  ok(recWoke.excluded && recWoke.excludeReason === "over-woke", "maxWoke 2 drops a woke-5 book");

  const keepZero = mod.recommendScore({ title: "Charlotte's Web", author: "E.B. White", subjects: ["Animals"], political: 0, woke: 0 }, { shelf: [], interests: [], maxPolitical: 0, maxWoke: 0 });
  ok(!keepZero.excluded, "maxWoke 0 / maxPolitical 0 KEEPS a 0/0 book (`>` not `>=`, and 0 is not treated as unset)");
  const dropOne = mod.recommendScore({ title: "A tract", author: "X", subjects: [], political: 0, woke: 1 }, { shelf: [], interests: [], maxPolitical: 0, maxWoke: 0 });
  ok(dropOne.excluded && dropOne.excludeReason === "over-woke", "maxWoke 0 drops a woke-1 book");

  const zeroRated = [{ title: "The Hobbit", author: "J.R.R. Tolkien", subjects: ["Fantasy"], rating: 0 }];
  const recZeroLike = mod.recommendScore(sil, { shelf: zeroRated, interests: [], maxPolitical: 5, maxWoke: 5 });
  ok(recZeroLike.score === 1 && recZeroLike.reasons.indexOf("same author as a book you liked") < 0,
    "a 0-star shelf rating is not a like (author bonus stays off; the shared subject still scores 1)");

  // --- Goodreads parse against the LIVE shape ---
  const parsed = mod.parseGoodreadsHtml(GR_HOBBIT_HTML);
  ok(parsed.ok && parsed.rating === 4.3, "JSON-LD aggregateRating 4.3 is read");
  ok(parsed.ratingsCount === 4635081 && parsed.reviewCount === 95173, "ratingCount and reviewCount come along");
  ok(parsed.reviews.length === 2 && parsed.reviews[0].author === "Matt" && parsed.reviews[0].rating === 5,
    "NEXT_DATA Review:* objects resolve the User: ref to a name");
  ok(/impossible to review/.test(parsed.reviews[0].body), "review body text is stripped and kept");
  const empty = mod.parseGoodreadsHtml(GR_CAPTCHA_HTML);
  ok(!empty.ok && empty.reviews.length === 0 && empty.rating == null, "a captcha/empty page is a miss, not a 0 rating");

  // --- live handler against fakes ---
  olCalls = []; gbCalls = []; grCalls = []; grMode = "good";
  const search = await callHandler(handler, { secret: SECRET, action: "search", q: "hobbit" });
  ok(search.status === 200, "search returns 200");
  const searchBody = await search.json();
  const foundHobbit = (searchBody.books || []).find((b) => b.title === "The Hobbit");
  ok(!!foundHobbit, "search merges Open Library + Google Books onto The Hobbit");
  ok(foundHobbit && foundHobbit.isbn === "9780547928227", "…keeps the ISBN_13");
  ok(foundHobbit && /pantry/.test(foundHobbit.description), "…prefers the Google Books description when OL had none");
  ok(foundHobbit && foundHobbit.political === 0 && foundHobbit.woke === 0, "search scores the Hobbit 0/0");
  ok(foundHobbit && /isbn\/9780547928227/.test(foundHobbit.goodreadsUrl), "Goodreads URL is the ISBN form");
  ok(foundHobbit && foundHobbit.rating === 4.2, "OL rating (first) is kept when both sources rate — 4.2 is not dropped as falsy");

  const cook = await callHandler(handler, { secret: SECRET, action: "search", q: "cookbook" });
  const cookBody = await cook.json();
  const foundCook = (cookBody.books || []).find((b) => b.title === "Farm Cookbook");
  ok(foundCook && foundCook.rating === null, "a catalog miss is rating:null, not 0 (Number(null) is 0)");

  const fragSearch = await callHandler(handler, { secret: SECRET, action: "search", q: "fragility" });
  const fragBody = await fragSearch.json();
  const foundFrag = (fragBody.books || []).find((b) => b.title === "White Fragility");
  ok(foundFrag && foundFrag.rating === 4, "when OL has no rating, the Google Books 4.0 is taken — not a sticky 0");
  ok(foundFrag && foundFrag.woke === 5, "White Fragility search result is scored woke 5");

  const rate = await callHandler(handler, { secret: SECRET, action: "rate", title: "White Fragility", description: FRAGILITY_DESC });
  const rateBody = await rate.json();
  ok(rate.status === 200 && rateBody.woke === 5 && rateBody.political === 0, "action:rate returns the same hand-computed pair");

  const reviews = await callHandler(handler, { secret: SECRET, action: "reviews", isbn: "9780547928227" });
  const revBody = await reviews.json();
  ok(reviews.status === 200 && revBody.ok && revBody.rating === 4.3, "reviews action reads the Goodreads fixture rating");
  ok(revBody.reviews && revBody.reviews.length === 2, "…and both review objects");
  ok(grCalls.some((u) => /isbn\/9780547928227/.test(u)), "reviews fetched the ISBN URL, not a user-supplied host");

  grMode = "forbid";
  const denied = await callHandler(handler, { secret: SECRET, action: "reviews", isbn: "9780547928227" });
  const deniedBody = await denied.json();
  ok(denied.status === 200 && deniedBody.ok === false && deniedBody.reason === "http-403",
    "a Goodreads 403 is reported, not turned into a fake 0-star book");
  grMode = "good";

  const rec = await callHandler(handler, {
    secret: SECRET, action: "recommend",
    shelf: [{ title: "The Hobbit", author: "J.R.R. Tolkien", subjects: ["Fantasy"], rating: 5 }],
    interests: ["fantasy"],
    maxPolitical: 5,
    maxWoke: 0,
  });
  const recBody = await rec.json();
  ok(rec.status === 200, "recommend returns 200");
  ok((recBody.books || []).every((b) => b.woke === 0), "maxWoke 0 keeps only woke-0 picks");
  ok((recBody.books || []).some((b) => b.title === "The Silmarillion"), "…and still recommends the Silmarillion");
  ok(!(recBody.books || []).some((b) => b.title === "The Hobbit"), "…without repeating the shelf");
  ok(!(recBody.books || []).some((b) => b.title === "White Fragility"), "…and the woke-5 book stays out");

  const pageSrc = fs.readFileSync(path.join(ROOT, "books.html"), "utf8");
  ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/i.test(pageSrc), "books.html restates [hidden]{display:none}");
  ok(/Number\.isFinite\(Number\(political\)\)/.test(pageSrc) && /Number\.isFinite\(Number\(woke\)\)/.test(pageSrc),
    "the meters treat 0 as 0, not as missing");
  ok(/data-feature="books"/.test(pageSrc), "the activity beacon is on the page");
}

function serveStatic() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, BASE);
      let rel = decodeURIComponent(u.pathname);
      if (rel === "/") rel = "/index.html";
      const file = path.join(ROOT, rel.replace(/^\/+/, ""));
      if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.statusCode = 404; return res.end("not found"); }
        const ext = path.extname(file);
        const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
        res.setHeader("content-type", types[ext] || "application/octet-stream");
        res.end(buf);
      });
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

async function newPage(browser, mock, opts) {
  opts = opts || {};
  const page = await browser.newPage();
  await page.setViewport(opts.viewport || { width: 390, height: 844, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  // Interception is only a firewall (Firebase / the open internet). Mocking the
  // books function INSIDE the page — a hung r.respond() deadlocked this suite
  // for three minutes and then CDP itself timed out.
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    try {
      const url = r.url();
      if (/googleapis|firestore|firebase|gstatic/i.test(url) && !/fonts\.(googleapis|gstatic)/.test(url)) return r.abort();
      if (/^https?:\/\/(?!127\.0\.0\.1)/.test(url) && !/fonts\.(googleapis|gstatic)/.test(url)) return r.abort();
      return r.continue();
    } catch (e) {
      try { r.continue(); } catch (_) {}
    }
  });
  await page.evaluateOnNewDocument((u, canned) => {
    localStorage.setItem("choreUnlocked", "amenfarms");
    if (u) { if (!localStorage.getItem("choreUser")) localStorage.setItem("choreUser", u); }
    else localStorage.removeItem("choreUser");
    window.__BOOK_CALLS__ = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async function (url, init) {
      const href = String(url);
      if (href.indexOf("/.netlify/functions/activity") !== -1) {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (href.indexOf("/.netlify/functions/books") !== -1) {
        let body = {};
        try { body = JSON.parse((init && init.body) || "{}"); } catch (e) { body = {}; }
        window.__BOOK_CALLS__.push(body);
        let data = { error: "unknown" };
        if (body.action === "search") data = { books: canned.searchBooks };
        else if (body.action === "recommend") data = { books: canned.recBooks };
        else if (body.action === "reviews") data = canned.reviews;
        else if (body.action === "rate") data = { political: 0, woke: 0, evidence: [], confidence: "high" };
        return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return realFetch(url, init);
    };
  }, opts.user || "Dad", {
    searchBooks: mock.searchBooks,
    recBooks: mock.recBooks,
    reviews: mock.reviews,
  });
  return { page, errors };
}

const MOCK_HOBBIT = {
  id: "ol-hobbit", title: "The Hobbit", author: "J.R.R. Tolkien", year: "1937",
  isbn: "9780547928227", cover: "", description: HOBBIT_DESC, subjects: ["Fantasy"],
  rating: 4.2, ratingsCount: 1200, ratingSource: "open-library",
  goodreadsUrl: "https://www.goodreads.com/book/isbn/9780547928227",
  political: 0, woke: 0, evidence: [], confidence: "high",
};
const MOCK_SIL = {
  id: "ol-sil", title: "The Silmarillion", author: "J.R.R. Tolkien", year: "1977",
  isbn: "9780544338012", cover: "", description: "First Age.", subjects: ["Fantasy"],
  rating: 3.9, ratingsCount: 400, ratingSource: "open-library",
  goodreadsUrl: "https://www.goodreads.com/book/isbn/9780544338012",
  political: 0, woke: 0, evidence: [], confidence: "high",
  recommendScore: 6, reasons: ["same author as a book you liked", "shares subjects with your shelf", "matches an interest"],
};

async function sectionUi(browser) {
  section("B. The page: profiles, shelf, recommend, meters");

  const mock = {
    calls: [],
    searchBooks: [MOCK_HOBBIT],
    recBooks: [MOCK_SIL],
    reviews: {
      ok: true, title: "The Hobbit", author: "J.R.R. Tolkien", rating: 4.3,
      ratingsCount: 4635081, reviewCount: 95173,
      reviews: [{ author: "Matt", rating: 5, body: "Some books are almost impossible to review." }],
      goodreadsUrl: "https://www.goodreads.com/book/isbn/9780547928227", source: "goodreads",
    },
  };

  const { page, errors } = await newPage(browser, mock, { user: "Dad" });
  await page.goto(BASE + "/books.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__BOOKS__, { timeout: 15000 });

  ok(await page.evaluate(() => document.querySelector("#bar .t").textContent === "Bookshelf"), "the page titles itself Bookshelf");
  ok(await page.evaluate(() => window.__BOOKS__.current().name === "Dad"), "the default profile is the choreUser");

  await page.type("#newProfile", "Joy");
  await page.click("#addProfile");
  await sleep(80);
  ok(await page.evaluate(() => window.__BOOKS__.current().name === "Joy"), "Add creates and selects the new profile");

  await page.type("#newInterest", "fantasy");
  await page.click("#addInterest");
  await sleep(80);
  ok(await page.evaluate(() => window.__BOOKS__.current().interests.join() === "fantasy"), "an interest sticks on the current profile");

  await page.$eval("#maxWoke", (el) => { el.value = "0"; el.dispatchEvent(new Event("input")); });
  ok(await page.evaluate(() => window.__BOOKS__.current().maxWoke === 0), "woke-max 0 is stored as 0, not coerced to 5");
  ok(await page.evaluate(() => document.getElementById("maxWokeVal").textContent === "0"), "…and the label shows 0");

  await page.evaluate(() => {
    document.getElementById("searchQ").value = "hobbit";
    document.getElementById("searchBtn").click();
  });
  await page.waitForFunction(() => document.querySelectorAll("#searchHits .book").length >= 1, { timeout: 10000 });
  const hitZero = await page.evaluate(() => {
    const ns = [...document.querySelectorAll("#searchHits .meter .n")].map((n) => n.textContent);
    return ns;
  });
  ok(hitZero.indexOf("0") >= 0, "a 0 political/woke score is printed as 0, not blank");

  await page.evaluate(() => { const b = document.querySelector("#searchHits .book"); if (b) b.click(); });
  await sleep(80);
  ok(await page.evaluate(() => window.__BOOKS__.current().shelf.length === 1), "tapping a hit adds it to the shelf");
  ok(await page.evaluate(() => window.__BOOKS__.current().shelf[0].woke === 0), "the shelf keeps the 0 woke score");
  ok(await page.evaluate(() => {
    const meta = document.querySelector("#shelfList .meta").textContent.replace(/\s+/g, " ");
    return /4\.20/.test(meta) && !/0\.00/.test(meta);
  }), "the shelf keeps the community 4.20; a null user rating is not Number(null)→0.00");

  await page.evaluate(() => { document.getElementById("recBtn").click(); });
  await page.waitForFunction(() => document.querySelectorAll("#recs .book").length >= 1, { timeout: 10000 });
  ok(await page.evaluate(() => /Silmarillion/.test(document.querySelector("#recs .t").textContent)), "Recommend paints the pick");
  ok(await page.evaluate(() => /same author/.test(document.querySelector("#recs .why").textContent)), "…and the reason line");

  await page.evaluate(() => { const b = document.querySelector("#recs .book"); if (b) b.click(); });
  await page.waitForFunction(() => document.getElementById("detail").hidden === false, { timeout: 10000 });
  ok(await page.evaluate(() => /impossible to review/.test(document.getElementById("detailInner").textContent)), "the sheet shows a Goodreads review");
  ok(await page.evaluate(() => /Goodreads 4\.30/.test(document.getElementById("detailInner").textContent)), "…and the Goodreads aggregate");
  await page.evaluate(() => { const b = document.getElementById("detailClose"); if (b) b.click(); });
  await sleep(80);
  ok(await page.evaluate(() => document.getElementById("detail").hidden === true), "Close hides the sheet");
  ok(await page.evaluate(() => document.getElementById("detail").offsetParent === null),
    "the closed sheet is not in the layout (offsetParent null, not just a hidden attribute)");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__BOOKS__, { timeout: 15000 });
  ok(await page.evaluate(() => window.__BOOKS__.current().name === "Joy" && window.__BOOKS__.current().shelf.length === 1),
    "profile, interest, and shelf survive a reload");

  if (WANT_SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "books_mobile.png") });
  }

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));

  // Home card is asserted from source, not by booting index.html. That page's identity
  // gate + the live-Firebase-block dance is already owned by other suites; this one
  // only needs to prove the card is wired in the slot the sports suite cares about
  // (after the NFL/GFFL cards, so weather stays the NFL card's previous sibling).
  const idx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const sportsAt = idx.indexOf("renderSportsCards(nflC, ffC)");
  const bookAt = idx.indexOf("bookw.className = \"bookcard\"");
  ok(bookAt > sportsAt && sportsAt > 0, "Home Bookshelf card is created after the sports cards");
  ok(/location\.href = \"books\.html\"/.test(idx), "the Home card opens books.html");
  ok(/textContent = \"Bookshelf\"/.test(idx), "the Home card is labeled Bookshelf");
}

(async () => {
  const ol = await serveOL();
  const gb = await serveGB();
  const gr = await serveGR();
  try {
    await sectionServer();
  } catch (err) {
    fail++; failures.push("section A crashed: " + err.message);
    console.log("\n✗ SECTION A ERROR: " + (err && err.stack || err));
  }

  const srv = await serveStatic();
  let browser;
  try {
    browser = await puppeteer.launch({
      channel: "chrome",
      headless: "new",
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
    });
    await sectionUi(browser);
  } catch (err) {
    fail++; failures.push("section B crashed: " + err.message);
    console.log("\n✗ SECTION B ERROR: " + (err && err.stack || err));
  } finally {
    if (browser) await browser.close();
    srv.close(); ol.close(); gb.close(); gr.close();
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  if (failures.length) failures.forEach((f) => console.log("  - " + f));
  process.exit(fail ? 1 : 0);
})();
