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
 * Section B drives books.html (the Home card, and the FarmGPT home card) in
 * Chrome at 390x844 and desktop with the function ROUTE-MOCKED.
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
const PORT = 8894, OL_PORT = 8895, GB_PORT = 8896, GR_PORT = 8897, XAI_PORT = 8898;
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
let xaiCalls = [];
let grMode = "good";
const GROK_JSON = JSON.stringify({
  books: [
    { title: "The Hobbit", author: "J.R.R. Tolkien", summary: "Already on the shelf.", why: "Must be dropped." },
    { title: "The Priory of the Orange Tree", author: "Samantha Shannon", summary: "A standalone epic about a queendom and a dragon.", why: "You rated The Hobbit 5 stars." },
    { title: "Lonesome Dove", author: "Larry McMurtry", summary: "Two aging Texas Rangers drive cattle north.", why: "A long road next to the naval set." },
    { title: "The Lies of Locke Lamora", author: "Scott Lynch", summary: "Gentlemen bastards con a city.", why: "Abercrombie-adjacent grit." },
    { title: "Children of Time", author: "Adrian Tchaikovsky", summary: "Spiders inherit a terraformed world.", why: "Fits the Howey and Corey stretch." },
    { title: "Shardik", author: "Richard Adams", summary: "A giant bear becomes a god to a river people.", why: "A different Adams than Hitchhiker." },
  ],
});

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
function serveXAI() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        let body = {};
        try { body = JSON.parse(raw || "{}"); } catch (e) { body = {}; }
        xaiCalls.push({ url: req.url, body });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          choices: [{ message: { role: "assistant", content: GROK_JSON } }],
        }));
      });
    });
    srv.listen(XAI_PORT, "127.0.0.1", () => resolve(srv));
  });
}

function readKeptJson(text) {
  const raw = String(text || "");
  const cut = raw.lastIndexOf("\n");
  const slice = (cut >= 0 ? raw.slice(cut + 1) : raw).trim();
  return JSON.parse(slice || "{}");
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
  process.env.BOOKS_XAI_BASE = `http://127.0.0.1:${XAI_PORT}`;
  process.env.XAI_API_KEY = "test-xai";
  process.env.BOOKS_GROK_MODEL = "grok-4.7";

  const mod = await import("file://" + path.join(ROOT, "netlify", "functions", "books.mjs").replace(/\\/g, "/"));
  const handler = mod.default;
  ok(typeof handler === "function", "books.mjs exports a handler");
  ok(typeof mod.scorePolitics === "function", "scorePolitics is exported");
  ok(typeof mod.recommendScore === "function", "recommendScore is exported");
  ok(typeof mod.parseGoodreadsHtml === "function", "parseGoodreadsHtml is exported");
  ok(typeof mod.buildRecommendPrompt === "function" && typeof mod.parseGrokRecs === "function",
    "the Grok recommend prompt and parser are exported");

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

  const canPrompt = typeof mod.buildRecommendPrompt === "function" && typeof mod.sanitizeShelf === "function" && typeof mod.parseGrokRecs === "function";
  let prompt41 = "";
  let ratedZero = "";
  let parsedGrok = [];
  if (canPrompt) {
    const fortyOne = [];
    for (let i = 1; i <= 41; i++) fortyOne.push({ title: "Book " + i, author: "Author " + i, rating: i === 1 ? 5 : null });
    prompt41 = mod.buildRecommendPrompt(mod.sanitizeShelf(fortyOne), { interests: ["fantasy"], maxPolitical: 5, maxWoke: 0 });
    ratedZero = mod.buildRecommendPrompt(mod.sanitizeShelf([
      { title: "Zero", author: "Zed", rating: 0 },
      { title: "Blank", author: "Bee", rating: null },
    ]), {});
    parsedGrok = mod.parseGrokRecs(GROK_JSON, [{ title: "The Hobbit", author: "J.R.R. Tolkien" }]);
  }
  ok(/Book 41 — Author 41 — unrated/.test(prompt41) && /Book 1 — Author 1 — 5\/5/.test(prompt41),
    "the Grok prompt keeps the 41st shelf row and a 5-star user rating (40 used to drop it)");
  ok(/Zero — Zed — 0\/5/.test(ratedZero) && /Blank — Bee — unrated/.test(ratedZero),
    "a real 0-star review stays 0/5; a missing review stays unrated (Number(null) is 0)");
  ok(/Woke cap: 0 of 5/.test(prompt41), "…and still states the woke cap of 0");
  ok(parsedGrok.length === 5 && parsedGrok[0].title === "The Priory of the Orange Tree" && parsedGrok.every((b) => b.title !== "The Hobbit"),
    "parseGrokRecs keeps five picks and drops a title already on the shelf");
  ok(parsedGrok[0] && parsedGrok[0].summary.indexOf("queendom") >= 0 && parsedGrok[0].why.indexOf("Hobbit 5") >= 0,
    "…and each pick carries a summary and a why");

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

  xaiCalls = [];
  const recShelf = [{ title: "The Hobbit", author: "J.R.R. Tolkien", subjects: ["Fantasy"], rating: 5 }];
  for (let i = 2; i <= 41; i++) recShelf.push({ title: "Book " + i, author: "Author " + i, rating: null });
  const rec = await callHandler(handler, {
    secret: SECRET, action: "recommend",
    shelf: recShelf,
    interests: ["fantasy"],
    maxPolitical: 5,
    maxWoke: 0,
  });
  const recText = await rec.text();
  const recBody = readKeptJson(recText);
  ok(rec.status === 200, "recommend returns 200");
  ok(/^\s/.test(recText) && recText.indexOf("\n{") >= 0,
    "recommend sends a keepalive byte before the JSON so a slow Grok call is not a 30s 504");
  const grokReq = xaiCalls[0] && xaiCalls[0].body;
  ok(!!grokReq && grokReq.model === "grok-4.7", "recommend asks grok-4.7, not the catalog ranker");
  ok(!!grokReq && grokReq.reasoning_effort === "low",
    "recommend asks grok-4.7 for low effort so a full shelf finishes inside the function");
  ok(!!grokReq && grokReq.max_tokens === 6000,
    "recommend leaves 6000 tokens so reasoning cannot eat the JSON");
  const grokUser = grokReq && grokReq.messages && grokReq.messages.find((m) => m.role === "user");
  ok(grokUser && /The Hobbit — J\.R\.R\. Tolkien — 5\/5/.test(grokUser.content) && /Book 41 — Author 41 — unrated/.test(grokUser.content),
    "the Grok turn includes the whole shelf and the reader's stars");
  ok((recBody.books || []).length === 5 && recBody.books[0].title === "The Priory of the Orange Tree",
    "…and returns the five Grok picks");
  ok(!(recBody.books || []).some((b) => b.title === "The Hobbit"), "…without repeating the shelf");
  ok((recBody.books || [])[0].summary && (recBody.books || [])[0].why, "…each pick has a summary and a why");

  const savedKey = process.env.XAI_API_KEY;
  delete process.env.XAI_API_KEY;
  const noKey = await callHandler(handler, {
    secret: SECRET, action: "recommend",
    shelf: [{ title: "The Hobbit", author: "J.R.R. Tolkien", rating: 5 }],
  });
  const noKeyBody = readKeptJson(await noKey.text());
  process.env.XAI_API_KEY = savedKey;
  ok(noKey.status === 200 && (noKeyBody.books || []).length === 0 && noKeyBody.reason === "no-key",
    "a missing Grok key is an empty list, not a invented catalog pick");

  const pageSrc = fs.readFileSync(path.join(ROOT, "books.html"), "utf8");
  ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/i.test(pageSrc), "books.html restates [hidden]{display:none}");
  ok(/Number\.isFinite\(Number\(political\)\)/.test(pageSrc) && /Number\.isFinite\(Number\(woke\)\)/.test(pageSrc),
    "the meters treat 0 as 0, not as missing");
  ok(/data-feature="books"/.test(pageSrc), "the activity beacon is on the page");
  ok(/var DAD_SEED = \[/.test(pageSrc), "Dad's Kindle/Audible list is seeded in the page");
  ok(/title: "Oathbringer"/.test(pageSrc) && /title: "The Blade Itself"/.test(pageSrc),
    "…includes a Kindle Stormlight title and an Audible First Law title");
  ok(/title: "The Two Towers"/.test(pageSrc) && /title: "Benjamin Franklin: An American Life"/.test(pageSrc),
    "…includes the Sept 2014 Audible credit haul (Two Towers, Isaacson)");
  ok(/title: "Rhythm of War"/.test(pageSrc) && /title: "Last Argument of Kings"/.test(pageSrc) && /title: "Master and Commander"/.test(pageSrc),
    "…includes the later library (Rhythm of War, Last Argument, Aubrey)");
  ok(/title: "Oathbringer"[\s\S]{0,180}communityRating: 4\.5111/.test(pageSrc),
    "Oathbringer carries its Open Library snapshot rating (4.5111 from search.json)");
  ok(/title: "We Are Legion \(We Are Bob\)"[\s\S]{0,180}communityRating: 4\.1053/.test(pageSrc),
    "We Are Legion carries its Open Library work rating after search.json left it blank");
  ok(/ratingSource: "open-library"/.test(pageSrc) && /covers\.openlibrary\.org\/b\/id\//.test(pageSrc),
    "…and the seed points at Open Library covers + ratingSource");
  ok(!/Harry Potter/.test(pageSrc) && !/Name of the Wind/.test(pageSrc),
    "…omits the two refunded Audible titles");
  ok(!/Cowboy of Convenience/.test(pageSrc) && !/Dakota Brides/.test(pageSrc),
    "…omits the struck romance titles");
  ok(!/Witness Wore Red/.test(pageSrc) && !/Whole-Brain Child/.test(pageSrc) && !/NurtureShock/.test(pageSrc),
    "…omits the two memoirs and two parenting-science titles Dad cut");
  ok(!/Trivia Storm/.test(pageSrc) && !/Great Book of Trivia/.test(pageSrc) && !/Cash Cab/.test(pageSrc),
    "…omits the quiz books Dad cut");
  ok(!/Les Mis/.test(pageSrc) && !/Shepherding a Child/.test(pageSrc) && !/Chicken Health/.test(pageSrc),
    "…omits the Ask pile");
  ok(!/choreUser[\s\S]{0,160}state\.currentId = p\.id/.test(pageSrc),
    "importDadSeed does not switch the open profile to Dad when choreUser is Dad");
  ok(/function authorSortKey/.test(pageSrc) && /sortedShelf\(p\.shelf\)/.test(pageSrc),
    "the shelf is painted in author-last-name order, not seed order");
  ok(/classList\.add\("embedded"\)/.test(pageSrc) && /\.embedded #buckyNav/.test(pageSrc),
    "framed Bookshelf hides its own bottom nav so the AI tab does not double the icons");
  ok(/BOOKS_GROK_MODEL \|\| "grok-4\.7"/.test(src) && /buildRecommendPrompt/.test(src),
    "recommend sends the shelf to grok-4.7");
  ok(/GROK_TIMEOUT_MS = 50000/.test(src) && /reasoning_effort:\s*"low"/.test(src),
    "the Grok call waits 50s at low effort (20s aborted a full shelf)");
  ok(/A full shelf takes about half a minute/.test(pageSrc),
    "the button tells the reader a full shelf takes about half a minute");
  ok(/KEEPALIVE_MS = 8000/.test(src) && /GROK_MAX_TOKENS = 6000/.test(src),
    "the Grok call keeps the edge alive and leaves 6000 tokens of headroom");
  const intAt = pageSrc.indexOf('id="intLabel"');
  const recAt = pageSrc.indexOf('id="recLabel"');
  const shelfAt = pageSrc.indexOf('id="shelfLabel"');
  ok(intAt >= 0 && recAt > intAt && shelfAt > recAt,
    "Next to read is under Interests and above the shelf in the page");
  ok(/lastIndexOf\("\\n"\)/.test(pageSrc) && /Could not recommend right now\./.test(pageSrc),
    "the page reads the JSON after the keepalive and shows a failure");

  const gptSrc = fs.readFileSync(path.join(ROOT, "farmgpt.html"), "utf8");
  ok(/id="cardBooks"/.test(gptSrc), "FarmGPT home has a Bookshelf card");
  ok(/id="cardBooks"[\s\S]{0,400}<div class="nm">Bookshelf<\/div>/.test(gptSrc),
    "…labeled Bookshelf, not the story-shelf renderer");
  ok(/<a class="bigCard" id="cardBooks" href="books\.html"/.test(gptSrc),
    "the card is a real link to books.html so it works even if FarmGPT's script never finishes");
  ok(/window\.top\.location\.href\s*=\s*['\"]books\.html['\"]/.test(gptSrc),
    "the AI-tab card climbs to the top window so it does not nest inside the FarmGPT iframe");
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
      if (href.indexOf("/.netlify/functions/farmgpt") !== -1) {
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
  id: "ol-sil", title: "The Priory of the Orange Tree", author: "Samantha Shannon", year: "2019",
  isbn: "", cover: "", description: "A standalone epic about a queendom and a dragon.", subjects: ["Fantasy"],
  rating: null, ratingsCount: null, ratingSource: "",
  goodreadsUrl: "https://www.goodreads.com/search?q=The%20Priory%20of%20the%20Orange%20Tree",
  political: 0, woke: 0, evidence: [], confidence: "high",
  summary: "A standalone epic about a queendom and a dragon.",
  why: "You rated The Hobbit 5 stars.",
  reasons: ["You rated The Hobbit 5 stars."],
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
  ok(await page.evaluate(() => {
    const el = document.getElementById("buckyNav");
    const r = el && el.getBoundingClientRect();
    return !!(el && getComputedStyle(el).display !== "none" && r && r.height > 0);
  }), "standalone Bookshelf keeps the bottom nav");
  ok(await page.evaluate(() => window.__BOOKS__.current().name === "Dad"), "the default profile is the choreUser");
  ok(await page.evaluate(() => {
    const first = document.querySelector("#shelfList .book .t");
    return first && first.textContent === "Before They Are Hanged";
  }), "Dad's shelf opens sorted by author last name (Abercrombie before Sanderson)");
  ok(await page.evaluate(() => {
    const rec = document.getElementById("recLabel").closest("section").getBoundingClientRect();
    const ints = document.getElementById("intLabel").closest("section").getBoundingClientRect();
    const shelf = document.getElementById("shelfLabel").closest("section").getBoundingClientRect();
    return rec.top > ints.top && rec.top < shelf.top && rec.height > 0;
  }), "Next to read sits under Interests and above the shelf");

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
  ok(await page.evaluate(() => /Priory of the Orange Tree/.test(document.querySelector("#recs .t").textContent)), "Recommend paints the Grok pick");
  ok(await page.evaluate(() => {
    const sum = document.querySelector("#recs .summary");
    const why = document.querySelector("#recs .why");
    return !!(sum && why && /queendom/.test(sum.textContent) && /Hobbit 5/.test(why.textContent));
  }), "…with a summary and a why from the reader's stars");

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
  const dadTitles = await page.evaluate(() => {
    const dad = window.__BOOKS__.state().profiles.find((p) => p.name === "Dad");
    return dad ? dad.shelf.map((b) => b.title) : [];
  });
  ok(dadTitles.indexOf("Oathbringer") >= 0, "Dad's shelf received the Kindle Stormlight books");
  ok(dadTitles.indexOf("The Blade Itself") >= 0, "…and the Audible First Law books");
  ok(dadTitles.indexOf("A Game of Thrones") >= 0, "…and the Audible Ice and Fire set");
  ok(dadTitles.indexOf("The Mueller Report") >= 0, "…and the later Audible nonfiction");
  ok(dadTitles.indexOf("The Two Towers") >= 0 && dadTitles.indexOf("The Rise and Fall of the Third Reich") >= 0,
    "…and the Sept 2014 Audible credit haul");
  ok(dadTitles.indexOf("Rhythm of War") >= 0 && dadTitles.indexOf("Last Argument of Kings") >= 0 && dadTitles.indexOf("Master and Commander") >= 0,
    "…and the later Audible Stormlight, First Law, and Aubrey titles");
  ok(await page.evaluate(() => {
    const dad = window.__BOOKS__.state().profiles.find((p) => p.name === "Dad");
    const b = dad && dad.shelf.find((x) => x.title === "Oathbringer");
    return !!(b && b.ratingSource === "open-library" && Math.abs(Number(b.communityRating) - 4.5111) < 0.0002 && String(b.cover).indexOf("covers.openlibrary.org") >= 0);
  }), "Dad's Oathbringer row has the Open Library rating and cover");
  await page.evaluate(() => {
    const chips = [...document.querySelectorAll("#profileChips .chip")];
    const dad = chips.find((c) => c.textContent === "Dad");
    if (dad) dad.click();
  });
  await sleep(80);
  ok(await page.evaluate(() => {
    const metas = [...document.querySelectorAll("#shelfList .meta")].map((el) => el.textContent);
    return metas.some((t) => /4\.51 from Open Library \(90\)/.test(t));
  }), "the shelf paints 4.51 from Open Library (90), not No community rating");
  ok(await page.evaluate(() => {
    const metas = [...document.querySelectorAll("#shelfList .meta")].map((el) => el.textContent);
    return metas.some((t) => /4\.11 from Open Library \(19\)/.test(t));
  }), "…and We Are Legion paints 4.11 from Open Library (19)");
  ok(await page.evaluate(() => {
    const first = document.querySelector("#shelfList .book .t");
    return first && first.textContent === "Before They Are Hanged";
  }), "re-opening Dad still sorts Abercrombie ahead of Sanderson");

  await page.evaluate(() => {
    const dad = window.__BOOKS__.state().profiles.find((p) => p.name === "Dad");
    const b = dad.shelf.find((x) => x.title === "Oathbringer");
    b.communityRating = null;
    b.cover = "";
    b.ratingSource = "";
    localStorage.setItem("books_profiles_v1", JSON.stringify(window.__BOOKS__.state()));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__BOOKS__, { timeout: 15000 });
  ok(await page.evaluate(() => {
    const dad = window.__BOOKS__.state().profiles.find((p) => p.name === "Dad");
    const b = dad && dad.shelf.find((x) => x.title === "Oathbringer");
    return !!(b && Math.abs(Number(b.communityRating) - 4.5111) < 0.0002 && b.cover);
  }), "an older seed row missing the Open Library snapshot is backfilled on reload");
  ok(dadTitles.every((t) => !/Harry Potter|Name of the Wind|Cowboy of Convenience|Witness Wore|Whole-Brain|NurtureShock|Trivia Storm|Les Mis|Shepherding/.test(t)),
    "…without refunded, struck, cut, or Ask titles");
  ok(await page.evaluate(() => {
    const joy = window.__BOOKS__.state().profiles.find((p) => p.name === "Joy");
    return joy && joy.shelf.length === 1 && joy.shelf[0].title === "The Hobbit";
  }), "Joy's shelf is not filled with Dad's library");

  await page.evaluate(() => {
    const dad = window.__BOOKS__.state().profiles.find((p) => p.name === "Dad");
    dad.shelf = dad.shelf.filter((b) => b.title !== "Oathbringer");
    localStorage.setItem("books_profiles_v1", JSON.stringify(window.__BOOKS__.state()));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__BOOKS__, { timeout: 15000 });
  ok(await page.evaluate(() => {
    const dad = window.__BOOKS__.state().profiles.find((p) => p.name === "Dad");
    return dad && !dad.shelf.some((b) => b.title === "Oathbringer") && dad.shelf.some((b) => b.title === "The Blade Itself");
  }), "a removed seed title stays off after reload (import keys remember it)");

  await page.evaluate(() => {
    const dad = window.__BOOKS__.state().profiles.find((p) => p.name === "Dad");
    dad.shelf.push({
      id: "seed-cut-quiz", title: "Trivia Storm", author: "", isbn: "", cover: "",
      description: "", subjects: [], rating: null, communityRating: null,
      political: 0, woke: 0, evidence: [], goodreadsUrl: "", ratingSource: "", ratingsCount: null,
    });
    localStorage.setItem("books_profiles_v1", JSON.stringify(window.__BOOKS__.state()));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__BOOKS__, { timeout: 15000 });
  ok(await page.evaluate(() => {
    const dad = window.__BOOKS__.state().profiles.find((p) => p.name === "Dad");
    return dad && !dad.shelf.some((b) => b.title === "Trivia Storm") && dad.shelf.some((b) => b.title === "The Blade Itself");
  }), "a cut seed title is pruned on reload");

  if (WANT_SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "books_mobile.png") });
  }

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors[0] : ""));

  const host = await newPage(browser, mock, { user: "Dad" });
  await host.page.goto(BASE + "/books.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await host.page.evaluate((src) => {
    document.documentElement.className = "";
    document.body.innerHTML = "<iframe id=\"f\" src=\"" + src + "\" style=\"width:390px;height:844px;border:0\"></iframe>";
  }, BASE + "/books.html");
  const framed = await host.page.waitForFunction(() => {
    const f = document.getElementById("f");
    try { return !!(f && f.contentWindow && f.contentWindow.__BOOKS__); } catch (e) { return false; }
  }, { timeout: 15000 }).then(() => true).catch(() => false);
  ok(framed, "Bookshelf loads inside a same-origin iframe");
  if (framed) {
    ok(await host.page.evaluate(() => {
      const w = document.getElementById("f").contentWindow;
      const nav = w.document.getElementById("buckyNav");
      const r = nav && nav.getBoundingClientRect();
      return w.document.documentElement.classList.contains("embedded")
        && getComputedStyle(nav).display === "none"
        && !(r && r.height > 0);
    }), "…and hides #buckyNav so the parent tab does not show two icon rows");
  }
  await host.page.close();

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

  // Phone AI tab: FarmGPT home is the place people actually look. The card must
  // sit on the first screen at 390x844 (no scroll) and open books.html.
  const gpt = await newPage(browser, mock, { user: "Dad" });
  await gpt.page.goto(BASE + "/farmgpt.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  const gptHasCard = await gpt.page.waitForFunction(() => document.getElementById("cardBooks"), { timeout: 4000 }).then(() => true).catch(() => false);
  ok(gptHasCard, "FarmGPT home paints #cardBooks");
  if (!gptHasCard) {
    await gpt.page.close();
    return;
  }
  const gptGeom = await gpt.page.evaluate(() => {
    const cards = [...document.querySelectorAll("#homeCards .bigCard")].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.id, top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom), name: (el.querySelector(".nm") || {}).textContent || "" };
    });
    const books = cards.find((c) => c.id === "cardBooks");
    const story = cards.find((c) => c.id === "cardStory");
    const research = cards.find((c) => c.id === "cardResearch");
    const teacher = cards.find((c) => c.id === "cardTeacher");
    const el = document.getElementById("cardBooks");
    return {
      cards,
      books,
      story,
      research,
      teacher,
      inLayout: !!(el && el.offsetParent),
      onFirstScreen: !!(books && books.top >= 0 && books.bottom <= window.innerHeight && books.bottom > books.top),
      twoByTwo: !!(story && research && teacher && books
        && story.top === research.top
        && teacher.top === books.top
        && books.top > story.top
        && story.left === teacher.left
        && research.left === books.left),
      label: books ? books.name : "",
      homeOn: document.getElementById("viewHome").classList.contains("on"),
    };
  });
  ok(gptGeom.homeOn, "FarmGPT opens on the home cards");
  ok(gptGeom.inLayout && gptGeom.label === "Bookshelf", "the Bookshelf card is in the layout and labeled Bookshelf");
  ok(gptGeom.onFirstScreen, "the Bookshelf card is on the first 390×844 screen (no scroll to find it)");
  ok(gptGeom.twoByTwo, "Story/Research and Teacher/Bookshelf sit as a 2×2 on a phone");

  await Promise.all([
    gpt.page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }),
    gpt.page.evaluate(() => document.getElementById("cardBooks").click()),
  ]);
  ok(/\/books\.html$/.test(gpt.page.url()), "tapping Bookshelf on FarmGPT opens books.html");
  await gpt.page.waitForFunction(() => window.__BOOKS__, { timeout: 15000 });
  ok(await gpt.page.evaluate(() => document.querySelector("#bar .t").textContent === "Bookshelf"),
    "…and that page is the family Bookshelf, not Story Time's shelf");
  await gpt.page.close();
}

(async () => {
  const ol = await serveOL();
  const gb = await serveGB();
  const gr = await serveGR();
  const xai = await serveXAI();
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
    srv.close(); ol.close(); gb.close(); gr.close(); xai.close();
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  if (failures.length) failures.forEach((f) => console.log("  - " + f));
  process.exit(fail ? 1 : 0);
})();
