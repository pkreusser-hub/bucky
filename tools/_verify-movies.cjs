#!/usr/bin/env node
"use strict";
/**
 * BUCKY Movies suite — owned library, Wikidata search, Grok recommendations.
 *
 *   node tools/_verify-movies.cjs
 *
 * Section A runs netlify/functions/movies.mjs against a fake Wikidata search
 * and a fake xAI chat completion. iTunes media=movie returned resultCount 0
 * for Inception, Toy Story, and The Iron Giant on 2026-09-21, so the catalog
 * checks are Wikidata, not iTunes. Section B drives movies.html and the
 * FarmGPT card. Firebase hosts are not loaded.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const SECRET = "amenfarms";
const WIKI_PORT = 8905;
const XAI_PORT = 8906;
const STATIC_PORT = 8904;
const BASE = "http://127.0.0.1:" + STATIC_PORT;

const GROK_JSON = JSON.stringify({
  movies: [
    { title: "The Iron Giant", director: "Brad Bird", summary: "A boy hides a giant robot from the army.", why: "Fits the family animation already owned." },
    { title: "Paddington 2", director: "Paul King", summary: "A bear goes to prison for a theft he did not commit.", why: "Warm family comedy beside the ones they own." },
    { title: "The Sandlot 2", director: "David Mickey Evans", summary: "A new group of kids takes over the sandlot.", why: "They already own the first Sandlot." },
    { title: "Spies in Disguise", director: "Troy Quane", summary: "A spy is turned into a pigeon.", why: "Buddy action next to the animated adventures." },
    { title: "Luca", director: "Enrico Casarosa", summary: "Two sea monsters spend a summer on land.", why: "A Pixar they do not own, beside Toy Story and Finding Nemo." },
    { title: "Toy Story", director: "John Lasseter", summary: "Already owned.", why: "Must be dropped." },
  ],
});

let pass = 0, fail = 0;
const failures = [];
function section(name) { console.log("\n=== " + name + " ==="); }
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
}

let wikiCalls = [];
let xaiCalls = [];

function qid(id, label, description, claims) {
  return {
    id: id,
    labels: { en: { value: label } },
    descriptions: description ? { en: { value: description } } : {},
    claims: claims || {},
  };
}
function snakItem(id) {
  return { mainsnak: { datavalue: { value: { id: id } } } };
}
function snakTime(time) {
  return { mainsnak: { datavalue: { value: { time: time } } } };
}
function snakString(value) {
  return { mainsnak: { datavalue: { value: value } } };
}

function serveWiki() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      wikiCalls.push(req.url);
      const u = new URL(req.url, "http://127.0.0.1");
      let body = {};
      if (u.searchParams.get("action") === "wbsearchentities") {
        body = {
          search: [
            { id: "Q867283", label: "The Iron Giant", description: "1999 film by Brad Bird" },
            { id: "Q3820039", label: "The Iron Man", description: "novel by Ted Hughes" },
            { id: "Q2", label: "Plain Film", description: "2001 film" },
          ],
        };
      } else if ((u.searchParams.get("ids") || "").indexOf("Q310960") >= 0) {
        body = {
          entities: {
            Q310960: qid("Q310960", "Brad Bird", ""),
            Q188473: qid("Q188473", "science fiction", ""),
          },
        };
      } else {
        body = {
          entities: {
            Q867283: qid("Q867283", "The Iron Giant", "1999 film by Brad Bird", {
              P31: [snakItem("Q11424")],
              P57: [snakItem("Q310960")],
              P577: [snakTime("+1999-07-31T00:00:00Z")],
              P136: [snakItem("Q188473")],
              P18: [snakString("Iron Giant.jpg")],
            }),
            Q2: qid("Q2", "Plain Film", "2001 film", {
              P31: [snakItem("Q11424")],
              P577: [snakTime("+2001-01-01T00:00:00Z")],
            }),
          },
        };
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    });
    srv.listen(WIKI_PORT, "127.0.0.1", () => resolve(srv));
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
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: GROK_JSON } }] }));
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
  const req = new Request("http://127.0.0.1/.netlify/functions/movies", {
    method: method || "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:8080" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  return handler(req);
}

async function sectionServer() {
  section("A. Search, prompt, recommend");
  process.env.BUCKY_NOTIFY_SECRET = SECRET;
  process.env.MOVIES_WIKI_BASE = "http://127.0.0.1:" + WIKI_PORT;
  process.env.MOVIES_XAI_BASE = "http://127.0.0.1:" + XAI_PORT;
  process.env.XAI_API_KEY = "test-xai";
  process.env.MOVIES_GROK_MODEL = "grok-4.7";

  const mod = await import("file://" + path.join(ROOT, "netlify", "functions", "movies.mjs").replace(/\\/g, "/"));
  const handler = mod.default;
  ok(typeof handler === "function", "movies.mjs exports a handler");
  ok(typeof mod.buildRecommendPrompt === "function" && typeof mod.parseGrokRecs === "function" && typeof mod.sanitizeShelf === "function",
    "the Grok prompt and parser are exported");
  ok(typeof mod.mapWikiFilm === "function", "mapWikiFilm is exported");

  // iTunes media=movie returned resultCount 0 (measured 2026-09-21). Wikidata
  // has no star count, so a mapped film stays null rather than a score of 0.
  const film = mod.mapWikiFilm({
    labels: { en: { value: "The Iron Giant" } },
    descriptions: { en: { value: "1999 film by Brad Bird" } },
    claims: {
      P31: [{ mainsnak: { datavalue: { value: { id: "Q11424" } } } }],
      P57: [{ mainsnak: { datavalue: { value: { id: "Q310960" } } } }],
      P577: [{ mainsnak: { datavalue: { value: { time: "+1999-07-31T00:00:00Z" } } } }],
    },
  }, { Q310960: "Brad Bird" });
  ok(film && film.communityRating == null && film.ratingsCount == null,
    "a Wikidata film has no invented star rating");
  ok(film && film.director === "Brad Bird" && film.year === 1999 && film.title === "The Iron Giant",
    "a film keeps its director and release year");
  ok(mod.mapWikiFilm({
    labels: { en: { value: "The Iron Man" } },
    descriptions: { en: { value: "novel by Ted Hughes" } },
    claims: { P31: [{ mainsnak: { datavalue: { value: { id: "Q8261" } } } }] },
  }, {}) == null, "a novel is not mapped as a movie");

  const bad = await callHandler(handler, { secret: "nope", action: "search", q: "toy" });
  ok(bad.status === 401, "wrong secret is 401");
  const get = await callHandler(handler, null, "GET");
  ok(get.status === 405, "GET is 405");
  const noAct = await callHandler(handler, { secret: SECRET, action: "explode" });
  ok(noAct.status === 400, "unknown action is 400");

  const canPrompt = typeof mod.buildRecommendPrompt === "function" && typeof mod.sanitizeShelf === "function" && typeof mod.parseGrokRecs === "function";
  let prompt41 = "";
  let ratedZero = "";
  let parsed = [];
  if (canPrompt) {
    const fortyOne = [];
    for (let i = 1; i <= 41; i++) fortyOne.push({ title: "Movie " + i, rating: i === 1 ? 5 : null });
    prompt41 = mod.buildRecommendPrompt(mod.sanitizeShelf(fortyOne), { interests: ["family"] });
    ratedZero = mod.buildRecommendPrompt(mod.sanitizeShelf([
      { title: "Zero", rating: 0 },
      { title: "Blank", rating: null },
    ]), {});
    parsed = mod.parseGrokRecs(GROK_JSON, [{ title: "Toy Story" }]);
  }
  ok(/Movie 41 — unrated/.test(prompt41) && /Movie 1 — 5\/5/.test(prompt41),
    "the Grok prompt keeps the 41st owned movie and a 5-star rating");
  ok(/Zero — 0\/5/.test(ratedZero) && /Blank — unrated/.test(ratedZero),
    "a real 0-star stays 0/5; a missing star stays unrated (Number(null) is 0)");
  ok(/Interests they named: family/.test(prompt41), "the prompt names the interest");
  ok(parsed.length === 5 && parsed[0].title === "The Iron Giant" && parsed.every((m) => m.title !== "Toy Story"),
    "parseGrokRecs keeps five picks and drops a title already owned");
  ok(parsed[0] && parsed[0].summary.indexOf("robot") >= 0 && parsed[0].why.indexOf("animation") >= 0 && parsed[0].director === "Brad Bird",
    "each pick carries a director, a summary, and a why");

  wikiCalls = [];
  const search = await callHandler(handler, { secret: SECRET, action: "search", q: "iron giant" });
  const searchBody = await search.json();
  ok(search.status === 200, "search returns 200");
  const iron = (searchBody.movies || []).find((m) => m.title === "The Iron Giant");
  ok(!!iron && iron.director === "Brad Bird" && iron.year === 1999 && iron.genre === "science fiction",
    "search maps the Wikidata film");
  ok(iron && iron.cover.indexOf("Special:FilePath") >= 0 && iron.communityRating == null,
    "search keeps the poster and does not invent a rating");
  ok((searchBody.movies || []).some((m) => m.title === "Plain Film") && !(searchBody.movies || []).some((m) => m.title === "The Iron Man"),
    "search drops a novel that shares the name");
  ok(wikiCalls.some((u) => u.indexOf("/w/api.php") === 0 && /action=wbsearchentities/.test(u) && /search=iron%20giant/.test(u) && u.indexOf("http") < 0),
    "search hits the Wikidata search path, not a host from the query");

  xaiCalls = [];
  const shelf = [{ title: "Toy Story", rating: 5 }];
  for (let i = 2; i <= 41; i++) shelf.push({ title: "Movie " + i, rating: null });
  const rec = await callHandler(handler, { secret: SECRET, action: "recommend", shelf: shelf, interests: ["family"] });
  const recText = await rec.text();
  const recBody = readKeptJson(recText);
  ok(rec.status === 200, "recommend returns 200");
  ok(/^\s/.test(recText) && recText.indexOf("\n{") >= 0,
    "recommend sends a keepalive byte before the JSON");
  const grokReq = xaiCalls[0] && xaiCalls[0].body;
  ok(!!grokReq && grokReq.model === "grok-4.7" && grokReq.reasoning_effort === "low" && grokReq.max_tokens === 6000,
    "recommend asks grok-4.7 at low effort with 6000 tokens");
  const grokUser = grokReq && grokReq.messages && grokReq.messages.find((m) => m.role === "user");
  ok(grokUser && /Toy Story — 5\/5/.test(grokUser.content) && /Movie 41 — unrated/.test(grokUser.content),
    "the Grok turn includes the whole owned list and the viewer's stars");
  ok((recBody.movies || []).length === 5 && recBody.movies[0].title === "The Iron Giant",
    "recommend returns the five Grok picks");
  ok(!(recBody.movies || []).some((m) => m.title === "Toy Story"), "recommend does not repeat an owned title");

  const savedKey = process.env.XAI_API_KEY;
  delete process.env.XAI_API_KEY;
  const noKey = await callHandler(handler, { secret: SECRET, action: "recommend", shelf: [{ title: "Toy Story", rating: 5 }] });
  const noKeyBody = readKeptJson(await noKey.text());
  process.env.XAI_API_KEY = savedKey;
  ok(noKey.status === 200 && (noKeyBody.movies || []).length === 0 && noKeyBody.reason === "no-key",
    "a missing Grok key is an empty list, not a invented pick");

  const src = fs.readFileSync(path.join(ROOT, "netlify", "functions", "movies.mjs"), "utf8");
  const pageSrc = fs.readFileSync(path.join(ROOT, "movies.html"), "utf8");
  ok(/MOVIES_GROK_MODEL \|\| "grok-4\.7"/.test(src) && /KEEPALIVE_MS = 8000/.test(src) && /GROK_MAX_TOKENS = 6000/.test(src),
    "the function defaults to grok-4.7, a keepalive, and 6000 tokens");
  ok(/\[hidden\]\s*\{\s*display:\s*none\s*!important/i.test(pageSrc), "movies.html restates [hidden]{display:none}");
  ok(/var OWNED = \[/.test(pageSrc) && /"Toy Story"/.test(pageSrc) && /"The Princess Bride"/.test(pageSrc) && /"A Bug's Life"/.test(pageSrc),
    "the owned library is seeded, including Toy Story, The Princess Bride, and A Bug's Life");
  ok(!/Bonus Material/.test(pageSrc) && !/Bonus Features/.test(pageSrc),
    "bonus-material discs are not a second copy of the feature");
  ok((pageSrc.match(/Cinderella III/g) || []).length === 1, "Cinderella III is one owned title, not the bonus duplicate");
  ok(/function titleSortKey/.test(pageSrc) && /sortedShelf\(p\.shelf\)/.test(pageSrc),
    "the owned list is painted in title order, ignoring a leading article");
  const importBody = pageSrc.split("function importOwned")[1].split("function titleSortKey")[0];
  ok(/function importOwned/.test(pageSrc) && importBody.indexOf("state.currentId") < 0,
    "importOwned does not switch the open profile");
  const intAt = pageSrc.indexOf('id="intLabel"');
  const recAt = pageSrc.indexOf('id="recLabel"');
  const shelfAt = pageSrc.indexOf('id="shelfLabel"');
  ok(intAt >= 0 && recAt > intAt && shelfAt > recAt, "Next to watch sits under Interests and above Owned");
  ok(/lastIndexOf\("\\n"\)/.test(pageSrc) && /Could not recommend right now\./.test(pageSrc),
    "the page reads the JSON after the keepalive and shows a failure");
  ok(/classList\.add\("embedded"\)/.test(pageSrc) && /\.embedded #buckyNav/.test(pageSrc),
    "framed Movies hides its own bottom nav");

  const gptSrc = fs.readFileSync(path.join(ROOT, "farmgpt.html"), "utf8");
  ok(/<a class="bigCard" id="cardMovies" href="movies\.html"/.test(gptSrc),
    "FarmGPT home has a real Movies link");
  // The film mark is an inline SVG, so "Movies" sits ~530 characters
  // after id="cardMovies". A 500-character window misses the label.
  const moviesCard = gptSrc.slice(gptSrc.indexOf('id="cardMovies"'), gptSrc.indexOf('id="cardMovies"') + 1600);
  ok(/<div class="nm">Movies<\/div>/.test(moviesCard),
    "the AI-tab card is labeled Movies");
  ok(/window\.top\.location\.href\s*=\s*['\"]movies\.html['\"]/.test(gptSrc),
    "the AI-tab card climbs to the top window");

  const idx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const bookAt = idx.indexOf('bookw.className = "bookcard"');
  const movieAt = idx.indexOf('moview.className = "moviecard"');
  const sportsAt = idx.indexOf("renderSportsCards(nflC, ffC)");
  ok(movieAt > bookAt && bookAt > sportsAt && sportsAt > 0, "the Home Movies card is after Bookshelf, which stays after sports");
  ok(/location\.href = "movies\.html"/.test(idx) && /textContent = "Movies"/.test(idx),
    "the Home card opens movies.html and is labeled Movies");
  const act = fs.readFileSync(path.join(ROOT, "activity.html"), "utf8");
  ok(/movies: "Movies"/.test(act), "activity names the movies feature Movies");
}

function serveStatic() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, BASE);
      let rel = decodeURIComponent(u.pathname);
      if (rel === "/") rel = "/movies.html";
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
    srv.listen(STATIC_PORT, "127.0.0.1", () => resolve(srv));
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function newPage(browser, user) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const url = r.url();
    try {
      if (/googleapis|firestore|firebase|gstatic/i.test(url) && !/fonts\.(googleapis|gstatic)/.test(url)) return r.abort();
      if (/^https?:\/\/(?!127\.0\.0\.1)/.test(url) && !/fonts\.(googleapis|gstatic)/.test(url)) return r.abort();
      return r.continue();
    } catch (e) {
      try { r.continue(); } catch (_) {}
    }
  });
  // Do not clear storage here. evaluateOnNewDocument runs again on
  // reload, and a clear would wipe the owned list the reload check
  // is supposed to keep. A fresh page starts empty.
  await page.evaluateOnNewDocument((who) => {
    localStorage.setItem("choreUnlocked", "amenfarms");
    if (who) { if (!localStorage.getItem("choreUser")) localStorage.setItem("choreUser", who); }
    else localStorage.removeItem("choreUser");
    const realFetch = window.fetch.bind(window);
    window.fetch = async function (url, init) {
      const href = String(url);
      if (href.indexOf("/.netlify/functions/activity") !== -1) {
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (href.indexOf("/.netlify/functions/movies") !== -1) {
        let body = {};
        try { body = JSON.parse((init && init.body) || "{}"); } catch (e) { body = {}; }
        if (body.action === "search") {
          return new Response(JSON.stringify({
            movies: [{
              title: "The Iron Giant",
              director: "Brad Bird",
              year: 1999,
              genre: "Kids & Family",
              cover: "",
              description: "A boy befriends a giant metal man.",
              communityRating: 4.5,
              ratingsCount: 120,
              ratingSource: "itunes",
            }],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (body.action === "recommend") {
          const text = " \n" + JSON.stringify({
            movies: [{ title: "The Iron Giant", director: "Brad Bird", summary: "A boy hides a giant robot.", why: "Fits the family animation already owned." }],
          });
          return new Response(text, { status: 200, headers: { "Content-Type": "text/plain" } });
        }
        return new Response(JSON.stringify({ error: "unknown" }), { status: 400 });
      }
      return realFetch(url, init);
    };
  }, user || "");
  return { page, errors };
}

async function sectionUi(browser) {
  section("B. The page, the owned list, the AI tab");
  const { page, errors } = await newPage(browser, "Joy");
  await page.goto(BASE + "/movies.html", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => window.__MOVIES__ && document.querySelector("#shelfList .t"), { timeout: 15000 });
  ok(await page.evaluate(() => document.querySelector("#bar .t").textContent === "Movies"), "the page titles itself Movies");
  ok(await page.evaluate(() => {
    const el = document.getElementById("buckyNav");
    const r = el && el.getBoundingClientRect();
    return !!(el && getComputedStyle(el).display !== "none" && r && r.height > 0);
  }), "standalone Movies keeps the bottom nav");
  ok(await page.evaluate(() => window.__MOVIES__.current().name === "Joy"), "the open profile stays the choreUser");
  ok(await page.evaluate(() => document.querySelector("#shelfList .t").textContent === "Air Bud"),
    "the owned list opens on Air Bud, ahead of titles with a leading The");
  ok(await page.evaluate(() => {
    const titles = [...document.querySelectorAll("#shelfList .t")].map((el) => el.textContent);
    return titles.indexOf("Toy Story") >= 0 && titles.indexOf("The Princess Bride") >= 0
      && titles.filter((t) => t === "Cinderella III: A Twist in Time").length === 1
      && titles.every((t) => t.indexOf("Bonus") < 0);
  }), "Joy's list has the owned features once, and no bonus discs");
  ok(await page.evaluate(() => {
    const rec = document.getElementById("recLabel").closest("section").getBoundingClientRect();
    const ints = document.getElementById("intLabel").closest("section").getBoundingClientRect();
    const shelf = document.getElementById("shelfLabel").closest("section").getBoundingClientRect();
    return rec.top > ints.top && rec.top < shelf.top && rec.height > 0;
  }), "Next to watch sits under Interests and above Owned");
  ok(await page.evaluate(() => {
    const meta = document.querySelector("#shelfList .meta").textContent;
    return meta.indexOf("0.00") < 0;
  }), "a seed row with no community rating does not paint 0.00");

  await page.evaluate(() => {
    const row = document.querySelector("#shelfList .movie");
    const star = row.querySelector('[aria-label="Rate 5"]');
    star.click();
  });
  await sleep(40);
  ok(await page.evaluate(() => window.__MOVIES__.current().shelf.find((m) => m.title === "Air Bud").rating === 5),
    "a 5-star rating sticks on Air Bud");

  await page.evaluate(() => {
    const row = [...document.querySelectorAll("#shelfList .movie")].find((el) => el.querySelector(".t").textContent === "Toy Story");
    row.querySelector("button.ghost").click();
  });
  await sleep(40);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__MOVIES__ && document.querySelector("#shelfList .t"), { timeout: 15000 });
  ok(await page.evaluate(() => {
    const titles = [...document.querySelectorAll("#shelfList .t")].map((el) => el.textContent);
    const air = window.__MOVIES__.current().shelf.find((m) => m.title === "Air Bud");
    return window.__MOVIES__.current().name === "Joy" && titles.indexOf("Toy Story") < 0 && air && air.rating === 5;
  }), "Joy stays Joy after reload, the 5-star remains, and a removed title stays off");

  await page.type("#newProfile", "Dad");
  await page.click("#addProfile");
  await sleep(40);
  ok(await page.evaluate(() => {
    const dad = window.__MOVIES__.current();
    return dad.name === "Dad" && dad.shelf.some((m) => m.title === "Toy Story") && dad.shelf.some((m) => m.title === "Air Bud");
  }), "a new person gets the owned library, including a title someone else removed");

  await page.evaluate(() => {
    const joy = [...document.querySelectorAll("#profileChips .chip")].find((b) => b.textContent === "Joy");
    joy.click();
  });
  await sleep(40);
  ok(await page.evaluate(() => {
    const titles = [...document.querySelectorAll("#shelfList .t")].map((el) => el.textContent);
    return window.__MOVIES__.current().name === "Joy" && titles.indexOf("Toy Story") < 0;
  }), "switching back to Joy still hides the title she removed");

  await page.evaluate(() => {
    document.getElementById("searchQ").value = "iron giant";
    document.getElementById("searchBtn").click();
  });
  await page.waitForFunction(() => document.querySelectorAll("#searchHits .movie").length >= 1, { timeout: 8000 });
  await page.evaluate(() => document.querySelector("#searchHits .movie").click());
  await sleep(40);
  ok(await page.evaluate(() => {
    const row = [...document.querySelectorAll("#shelfList .movie")].find((el) => el.querySelector(".t").textContent === "The Iron Giant");
    return !!row && /4\.50 from iTunes \(120\)/.test(row.querySelector(".meta").textContent);
  }), "adding a search hit keeps the iTunes 4.50 from 120 ratings");

  await page.evaluate(() => {
    document.getElementById("searchQ").value = "toy story";
    document.getElementById("searchBtn").click();
  });
  await page.waitForFunction(() => document.querySelectorAll("#searchHits .movie").length >= 1, { timeout: 8000 });
  const before = await page.evaluate(() => window.__MOVIES__.current().shelf.length);
  await page.evaluate(() => document.querySelector("#searchHits .movie").click());
  await sleep(40);
  ok(await page.evaluate((n) => document.getElementById("searchErr").textContent === "Already owned." && window.__MOVIES__.current().shelf.length === n, before),
    "tapping a movie already on the list does not add a second copy");

  await page.type("#newInterest", "family");
  await page.click("#addInterest");
  await sleep(40);
  ok(await page.evaluate(() => window.__MOVIES__.current().interests.join() === "family"), "an interest sticks");

  await page.evaluate(() => document.getElementById("recBtn").click());
  await page.waitForFunction(() => document.querySelectorAll("#recs .movie").length >= 1, { timeout: 8000 });
  ok(await page.evaluate(() => {
    const sum = document.querySelector("#recs .summary");
    const why = document.querySelector("#recs .why");
    return document.querySelector("#recs .t").textContent === "The Iron Giant"
      && sum && /robot/.test(sum.textContent)
      && why && /animation/.test(why.textContent);
  }), "Recommend paints the Grok pick with a summary and a why");

  ok(errors.length === 0, "no page errors");

  const frame = await newPage(browser, "Dad");
  await frame.page.goto(BASE + "/movies.html", { waitUntil: "domcontentloaded", timeout: 30000 });
  await frame.page.evaluate(() => {
    document.body.innerHTML = '<iframe id="f" src="movies.html" style="width:390px;height:700px;border:0"></iframe>';
  });
  await frame.page.waitForFunction(() => {
    const f = document.getElementById("f");
    return f && f.contentDocument && f.contentDocument.getElementById("buckyNav");
  }, { timeout: 15000 });
  ok(await frame.page.evaluate(() => {
    const doc = document.getElementById("f").contentDocument;
    const nav = doc.getElementById("buckyNav");
    const cs = doc.defaultView.getComputedStyle(nav);
    return doc.documentElement.classList.contains("embedded") && cs.display === "none";
  }), "Movies inside a same-origin frame hides #buckyNav");
  await frame.page.close();

  const gpt = await newPage(browser, "Dad");
  await gpt.page.goto(BASE + "/farmgpt.html", { waitUntil: "domcontentloaded", timeout: 30000 });
  const has = await gpt.page.waitForFunction(() => document.getElementById("cardMovies"), { timeout: 8000 }).then(() => true).catch(() => false);
  ok(has, "FarmGPT home paints #cardMovies");
  if (has) {
    ok(await gpt.page.evaluate(() => {
      const el = document.getElementById("cardMovies");
      const books = document.getElementById("cardBooks");
      return el && el.getAttribute("href") === "movies.html"
        && (el.querySelector(".nm") || {}).textContent === "Movies"
        && books && (books.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), "the Movies card follows Bookshelf and links to movies.html");
    await Promise.all([
      gpt.page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }),
      gpt.page.evaluate(() => document.getElementById("cardMovies").click()),
    ]);
    ok(/\/movies\.html$/.test(gpt.page.url()), "tapping Movies on FarmGPT opens movies.html");
    await gpt.page.waitForFunction(() => window.__MOVIES__, { timeout: 15000 });
    ok(await gpt.page.evaluate(() => document.querySelector("#bar .t").textContent === "Movies"),
      "that page is Movies, not Story Time");
  }
  await gpt.page.close();
  await page.close();
}

(async () => {
  const wiki = await serveWiki();
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
    srv.close();
    wiki.close();
    xai.close();
  }
  console.log("\n" + pass + " passed, " + fail + " failed");
  if (failures.length) {
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
})();
