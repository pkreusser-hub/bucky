#!/usr/bin/env node
"use strict";
/**
 * BUCKY Movies suite — owned library, Wikidata search, Grok recommendations.
 *
 *   node tools/_verify-movies.cjs
 *
 * Section A runs netlify/functions/movies.mjs against a fake Wikidata search
 * and a fake xAI chat completion. iTunes media=movie returned resultCount 0
 * for Inception, Toy Story, and The Iron Giant on 2026-09-21, so a live
 * lookup is still Wikidata, not iTunes. Owned posters and scores are the
 * saved file assets/movies/owned.json. Section B drives movies.html and the
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
const RT_PORT = 8907;
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
let rtCalls = [];
let wiki429Left = 0;

// Measured 2026-09-21 on the Iron Giant scorecard: user 4.3/5, popcorn 90,
// critic 8.50/10, tomatometer 96. The fixture is the script, not the page.
const IRON_SCORECARD = '<!doctype html><script id="media-scorecard-json" data-json="mediaScorecard" type="application/json">'
  + '{"audienceScore":{"averageRating":"4.3","score":"90"},"criticsScore":{"averageRating":"8.50","score":"96"}}'
  + "</script>";

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

function rtClaim(score, method) {
  return {
    mainsnak: { datavalue: { value: score } },
    qualifiers: {
      P447: [{ datavalue: { value: { id: "Q105584" } } }],
      P459: [{ datavalue: { value: { id: method } } }],
    },
  };
}

function serveWiki() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      wikiCalls.push(req.url);
      if (wiki429Left > 0) {
        wiki429Left--;
        res.statusCode = 429;
        res.setHeader("retry-after", "0");
        res.end("rate");
        return;
      }
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname.indexOf("/api/rest_v1/page/summary/") === 0) {
        const slug = decodeURIComponent(u.pathname.split("/api/rest_v1/page/summary/")[1] || "");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          title: slug.replace(/_/g, " "),
          thumbnail: { source: "https://upload.wikimedia.org/wikipedia/en/d/d3/" + slug + "_poster.JPG" },
        }));
        return;
      }
      let body = {};
      const searchQ = (u.searchParams.get("search") || "").toLowerCase();
      if (u.searchParams.get("action") === "wbsearchentities" && searchQ === "toy story") {
        body = {
          search: [
            { id: "Q2316015", label: "Toy Story", description: "CGI-animated film series and Disney media franchise" },
            { id: "Q171048", label: "Toy Story", description: "1995 animated film directed by John Lasseter" },
          ],
        };
      } else if (u.searchParams.get("action") === "wbsearchentities" && searchQ === "cheaper by the dozen") {
        body = {
          search: [
            { id: "Q1950", label: "Cheaper by the Dozen", description: "1950 film" },
            { id: "Q2003", label: "Cheaper by the Dozen", description: "2003 film" },
          ],
        };
      } else if (u.searchParams.get("action") === "wbsearchentities") {
        body = {
          search: [
            { id: "Q867283", label: "The Iron Giant", description: "1999 film by Brad Bird" },
            { id: "Q3820039", label: "The Iron Man", description: "novel by Ted Hughes" },
            { id: "Q2", label: "Plain Film", description: "2001 film" },
          ],
        };
      } else if ((u.searchParams.get("ids") || "").indexOf("Q2003") >= 0) {
        body = {
          entities: {
            Q1950: qid("Q1950", "Cheaper by the Dozen", "1950 film", {
              P31: [snakItem("Q11424")],
              P577: [snakTime("+1950-04-01T00:00:00Z")],
              P444: [rtClaim("83%", "Q108403393")],
            }),
            Q2003: qid("Q2003", "Cheaper by the Dozen", "2003 film", {
              P31: [snakItem("Q11424")],
              P577: [snakTime("+2003-12-25T00:00:00Z")],
              P1258: [snakString("m/cheaper_by_the_dozen_2003")],
              P444: [rtClaim("41%", "Q108403393")],
            }),
          },
        };
      } else if ((u.searchParams.get("ids") || "").indexOf("Q171048") >= 0) {
        // Q171048 had no English label on 2026-09-21. languages=en came back {}.
        // The search hit is still "Toy Story". The series item is not a film.
        const toy = qid("Q171048", "", "1995 animated film directed by John Lasseter", {
          P31: [snakItem("Q202866")],
          P577: [snakTime("+1995-11-22T00:00:00Z")],
        });
        toy.labels = {};
        toy.sitelinks = { enwiki: { title: "Toy Story" } };
        body = { entities: { Q171048: toy } };
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
            Q867283: Object.assign(qid("Q867283", "The Iron Giant", "1999 film by Brad Bird", {
              P31: [snakItem("Q11424")],
              P57: [snakItem("Q310960")],
              P577: [snakTime("+1999-07-31T00:00:00Z")],
              P136: [snakItem("Q188473")],
              P18: [snakString("Iron Giant.jpg")],
              P1258: [snakString("m/iron_giant")],
              // 8.1/10 is IMDb (Q37312), not Rotten Tomatoes. 88% is the
              // Popcornmeter qualifier. 96% and 8.2/10 are the Tomatometer
              // and the critic average. Live Iron Giant on 2026-09-21 was
              // 96% and 8.2/10 with no Popcornmeter; 88 is fixture-only.
              P444: [
                rtClaim("96%", "Q108403393"),
                rtClaim("8.2/10", "Q108403540"),
                rtClaim("88%", "Q131100566"),
                {
                  mainsnak: { datavalue: { value: "8.1/10" } },
                  qualifiers: {
                    P447: [{ datavalue: { value: { id: "Q37312" } } }],
                    P459: [{ datavalue: { value: { id: "Q107218751" } } }],
                  },
                },
              ],
            }), { sitelinks: { enwiki: { title: "The Iron Giant" } } }),
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

function serveRt() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      rtCalls.push(req.url);
      const pathOnly = String(req.url || "").split("?")[0];
      if (pathOnly !== "/m/iron_giant") {
        res.statusCode = 403;
        res.end("denied");
        return;
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(IRON_SCORECARD);
    });
    srv.listen(RT_PORT, "127.0.0.1", () => resolve(srv));
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
  process.env.MOVIES_ENWIKI_BASE = "http://127.0.0.1:" + WIKI_PORT;
  process.env.MOVIES_RT_BASE = "http://127.0.0.1:" + RT_PORT;
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
  const passed = mod.parseGrokRecs(GROK_JSON, [{ title: "Toy Story" }], [
    { title: "Paddington 2" },
    { title: "Luca" },
  ]);
  const passedPrompt = mod.buildRecommendPrompt(mod.sanitizeShelf([{ title: "Toy Story", rating: 5 }]), {
    skipped: [{ title: "Paddington 2", director: "Paul King" }],
    watched: [{ title: "The Iron Giant", director: "Brad Bird" }],
  });
  ok(/NOT INTERESTED/.test(passedPrompt) && /Paddington 2 — Paul King/.test(passedPrompt)
    && /ALREADY WATCHED/.test(passedPrompt) && /The Iron Giant — Brad Bird/.test(passedPrompt),
    "the Grok prompt names movies already watched and movies the viewer is not interested in");
  ok(passed.length === 3 && passed[0].title === "The Iron Giant"
    && passed.every((m) => m.title !== "Paddington 2" && m.title !== "Luca" && m.title !== "Toy Story"),
    "parseGrokRecs drops a not-interested title and an already-watched title");
  const watchPrompt = mod.buildRecommendPrompt(mod.sanitizeShelf([{ title: "Toy Story", rating: 5 }]), {
    watchlist: [{ title: "The Sandlot 2", director: "David Mickey Evans" }],
  });
  const watchParsed = mod.parseGrokRecs(GROK_JSON, [{ title: "Toy Story" }], [
    { title: "The Sandlot 2", director: "David Mickey Evans" },
  ]);
  const watchCapped = [];
  for (let i = 0; i < 81; i++) watchCapped.push({ title: "Watch " + i, director: "Dir" });
  const watchCapPrompt = mod.buildRecommendPrompt(mod.sanitizeShelf([]), { watchlist: watchCapped });
  ok(/WATCH LIST \(do not recommend these\)/.test(watchPrompt) && /The Sandlot 2 — David Mickey Evans/.test(watchPrompt)
    && /not on the watch list/.test(watchPrompt),
    "the Grok prompt names a saved watch-list movie");
  ok(!/WATCH LIST/.test(passedPrompt),
    "an empty watch list does not add a watch-list block");
  ok(watchParsed.length === 4 && watchParsed.every((m) => m.title !== "The Sandlot 2" && m.title !== "Toy Story"),
    "parseGrokRecs drops a watch-list title even when Grok returns it");
  ok(/Watch 0 — Dir/.test(watchCapPrompt) && !/Watch 80 — Dir/.test(watchCapPrompt),
    "the watch list sent to Grok stops at 80");
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

  const zeroRt = typeof mod.parseRtScores === "function"
    ? mod.parseRtScores({ claims: { P444: [rtClaim("0%", "Q108403393")] } })
    : null;
  ok(!!zeroRt && zeroRt.tomatoMeter === 0 && zeroRt.tomatoAverage === null && zeroRt.popcornMeter === null,
    "a real 0% Tomatometer stays 0; a missing average stays null");

  const ironCard = typeof mod.parseRtScorecard === "function" ? mod.parseRtScorecard(IRON_SCORECARD) : null;
  ok(!!ironCard && ironCard.userAverage === 4.3 && ironCard.tomatoAverage === 8.5 && ironCard.popcornMeter === 90 && ironCard.tomatoMeter === 96,
    "the scorecard user average is out of 5 and the critic average is out of 10");
  const zeroCard = typeof mod.parseRtScorecard === "function"
    ? mod.parseRtScorecard('<script data-json="mediaScorecard" type="application/json">{"audienceScore":{"averageRating":"0","score":"0"},"criticsScore":{"averageRating":"0.0","score":"0"}}</script>')
    : null;
  ok(!!zeroCard && zeroCard.userAverage === 0 && zeroCard.tomatoAverage === 0 && zeroCard.tomatoMeter === 0 && zeroCard.popcornMeter === 0,
    "a real 0 on the Rotten Tomatoes scorecard stays 0");
  const deniedCard = typeof mod.parseRtScorecard === "function" ? mod.parseRtScorecard("<html>Access Denied</html>") : "missing";
  ok(deniedCard === null, "a page with no scorecard does not invent scores");
  const swapped = typeof mod.parseRtScorecard === "function"
    ? mod.parseRtScorecard('<script data-json="mediaScorecard">{"audienceScore":{"averageRating":"8.5","score":"90"},"criticsScore":{"averageRating":"4.3","score":"96"}}</script>')
    : null;
  ok(!!swapped && swapped.userAverage === null && swapped.tomatoAverage === 4.3,
    "a user average above 5 is dropped; a 4.3 critic average stays out of 10");

  wikiCalls = [];
  rtCalls = [];
  const detail = await callHandler(handler, { secret: SECRET, action: "detail", title: "The Iron Giant", year: 1999 });
  const detailBody = await detail.json();
  ok(detail.status === 200 && detailBody.found === true && detailBody.director === "Brad Bird" && detailBody.year === 1999,
    "detail resolves The Iron Giant");
  // Wikidata still says critic 8.2/10 and the fixture popcorn is 88.
  // The page scorecard measured 2026-09-21 is 8.50/10, popcorn 90, user 4.3/5,
  // tomatometer 96. Those page numbers replace Wikidata. 8.1/10 is IMDb.
  ok(detailBody.tomatoMeter === 96 && detailBody.tomatoAverage === 8.5 && detailBody.popcornMeter === 90 && detailBody.userAverage === 4.3,
    "the Rotten Tomatoes page replaces the Wikidata critic average and adds the user average");
  ok(detailBody.tomatoAverage === 8.5, "an IMDb claim is not the Rotten Tomatoes average");
  ok(rtCalls.length === 1 && rtCalls[0].split("?")[0] === "/m/iron_giant" && rtCalls[0].indexOf("http") < 0,
    "the scorecard request is the film id, not a host from the title");
  ok(!!detailBody.cover && detailBody.cover.indexOf("https://upload.wikimedia.org/") === 0 && detailBody.cover.indexOf("The_Iron_Giant_poster") >= 0,
    "the poster is the Wikipedia sitelink image, not a host from the title");
  ok(detailBody.rtPath === "m/iron_giant", "the Rotten Tomatoes path is the film id");
  ok(wikiCalls.some((u) => u.indexOf("/api/rest_v1/page/summary/The_Iron_Giant") === 0) && wikiCalls.every((u) => u.indexOf("http") < 0),
    "the poster request is the Wikipedia summary path");

  const plain = await callHandler(handler, { secret: SECRET, action: "detail", title: "Plain Film" });
  const plainBody = await plain.json();
  ok(plain.status === 200 && plainBody.found === true && plainBody.tomatoMeter === null && plainBody.tomatoAverage === null && plainBody.userAverage === null && plainBody.popcornMeter === null && plainBody.cover === "",
    "a film with no Rotten Tomatoes claim stays null, not 0, and gets no invented poster");

  const dozen = await callHandler(handler, { secret: SECRET, action: "detail", title: "Cheaper By The Dozen (2003)" });
  const dozenBody = await dozen.json();
  ok(dozen.status === 200 && dozenBody.year === 2003 && dozenBody.tomatoMeter === 41 && dozenBody.userAverage === null,
    "a refused Rotten Tomatoes page keeps that film's Wikidata Tomatometer and does not invent a user average");

  // Measured 2026-09-21: the shelf asked Wikidata for every visible film at
  // once. After the first two (the Air Buds, which sort first) Wikidata
  // answered 429 and those misses were stored as "no cover".
  wiki429Left = 1;
  const bounced = await callHandler(handler, { secret: SECRET, action: "detail", title: "The Iron Giant", year: 1999 });
  const bouncedBody = await bounced.json();
  ok(bounced.status === 200 && bouncedBody.found === true && bouncedBody.director === "Brad Bird" && bouncedBody.userAverage === 4.3 && wiki429Left === 0,
    "one Wikidata 429 is retried and the film still resolves");
  wiki429Left = 3;
  const limited = await callHandler(handler, { secret: SECRET, action: "detail", title: "The Iron Giant", year: 1999 });
  const limitedBody = await limited.json();
  ok(limitedBody.found === false && limitedBody.reason === "rate-limit" && limitedBody.userAverage === null && limitedBody.cover === "",
    "a Wikidata rate limit stays a rate limit, not a missing film and not a blank zero");
  wiki429Left = 0;

  rtCalls = [];
  const posterOnly = await callHandler(handler, { secret: SECRET, action: "detail", title: "The Iron Giant", year: 1999, coverOnly: true });
  const posterBody = await posterOnly.json();
  ok(posterOnly.status === 200 && posterBody.found === true && !!posterBody.cover && posterBody.cover.indexOf("https://upload.wikimedia.org/") === 0
    && posterBody.tomatoAverage === 8.2 && posterBody.popcornMeter === 88 && posterBody.userAverage === null && rtCalls.length === 0,
    "a shelf poster skips the Rotten Tomatoes page and keeps the Wikidata scores");

  const toy = await callHandler(handler, { secret: SECRET, action: "detail", title: "Toy Story", coverOnly: true });
  const toyBody = await toy.json();
  ok(toy.status === 200 && toyBody.found === true && toyBody.title === "Toy Story" && !!toyBody.cover && toyBody.cover.indexOf("Toy_Story") >= 0,
    "Toy Story matches when its Wikidata item has no English label");
  const toySearch = await callHandler(handler, { secret: SECRET, action: "search", q: "toy story" });
  const toySearchBody = await toySearch.json();
  ok((toySearchBody.movies || []).some((m) => m.title === "Toy Story") && !(toySearchBody.movies || []).some((m) => /series/.test(m.description || "")),
    "search keeps the Toy Story film and drops the film series");

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

  xaiCalls = [];
  const skipRec = await callHandler(handler, {
    secret: SECRET,
    action: "recommend",
    shelf: [{ title: "Toy Story", rating: 5 }],
    skipped: [{ title: "Paddington 2", director: "Paul King" }],
    watched: [{ title: "Luca", director: "Enrico Casarosa" }],
  });
  const skipBody = readKeptJson(await skipRec.text());
  const skipUser = xaiCalls[0] && xaiCalls[0].body && xaiCalls[0].body.messages.find((m) => m.role === "user");
  ok(skipUser && /NOT INTERESTED/.test(skipUser.content) && /Paddington 2/.test(skipUser.content)
    && /ALREADY WATCHED/.test(skipUser.content) && /Luca/.test(skipUser.content),
    "recommend tells Grok which movies were passed on");
  ok(!(skipBody.movies || []).some((m) => m.title === "Paddington 2" || m.title === "Luca")
    && (skipBody.movies || []).some((m) => m.title === "The Iron Giant"),
    "a passed movie is left out of the picks Grok sent back");

  xaiCalls = [];
  const watchRec = await callHandler(handler, {
    secret: SECRET,
    action: "recommend",
    shelf: [{ title: "Toy Story", rating: 5 }],
    watchlist: [{ title: "The Sandlot 2", director: "David Mickey Evans" }],
  });
  const watchBody = readKeptJson(await watchRec.text());
  const watchUser = xaiCalls[0] && xaiCalls[0].body && xaiCalls[0].body.messages.find((m) => m.role === "user");
  ok(watchUser && /WATCH LIST/.test(watchUser.content) && /The Sandlot 2/.test(watchUser.content)
    && !/NOT INTERESTED/.test(watchUser.content),
    "recommend tells Grok which movies are on the watch list");
  ok(!(watchBody.movies || []).some((m) => m.title === "The Sandlot 2")
    && (watchBody.movies || []).some((m) => m.title === "The Iron Giant"),
    "a watch-list movie is left out of the picks Grok sent back");

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
  ok(/function placeOnShelf/.test(pageSrc) && /function adoptWatched/.test(pageSrc) && !/id="watchedList"/.test(pageSrc),
    "Already watched is placed on Owned, and a saved watched list is folded in on load");
  ok(/Q108403393/.test(src) && /Q131100566/.test(src) && /api\/rest_v1\/page\/summary/.test(src),
    "scores come from the Rotten Tomatoes claims and the poster from the Wikipedia sitelink");
  ok(/id="detail"/.test(pageSrc) && /Tomatometer/.test(pageSrc) && /User average/.test(pageSrc) && /#detail\[hidden\]/.test(pageSrc),
    "clicking a movie opens a sheet for the Tomatometer and the user average");
  ok(/mediaScorecard/.test(src) && /MOVIES_RT_BASE/.test(src),
    "the user average is read from the Rotten Tomatoes scorecard");
  ok(/coverOnly:\s*true/.test(pageSrc) && /"rate-limit"/.test(src) && /coverOnly/.test(src),
    "the shelf loads posters without the scorecard, and a 429 is not a missing film");
  ok(/assets\/movies\/owned\.json/.test(pageSrc) && /function absorbCatalog/.test(pageSrc) && /function loadCatalog/.test(pageSrc),
    "owned posters and scores are painted from the saved catalog");
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/movies/owned.json"), "utf8"));
  const ownedTitles = [...pageSrc.match(/var OWNED = \[([\s\S]*?)\];/)[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((m) => JSON.parse('"' + m[1] + '"'));
  ok(ownedTitles.length === 158 && ownedTitles.every((t) => catalog[t] && String(catalog[t].poster || "").indexOf("https://") === 0),
    "all 158 owned titles have an https poster in the catalog");
  ok(ownedTitles.every((t) => {
    const row = catalog[t] || {};
    const tomato = Number.isFinite(row.tomatoMeter) && Number.isFinite(row.tomatoAverage);
    const user = Number.isFinite(row.userAverage);
    const imdb = Number.isFinite(row.imdbRating);
    return tomato || user || imdb;
  }), "all 158 owned titles have a score in the catalog");
  const toyStory = catalog["Toy Story"];
  ok(!!toyStory && toyStory.year === 1995 && toyStory.tomatoMeter === 100 && toyStory.tomatoAverage === 9.4 && toyStory.userAverage === 3.8 && toyStory.rtPath === "m/toy_story",
    "Toy Story is the 1995 film: Tomatometer 100, critic 9.4, user 3.8");
  const lionKing = catalog["The Lion King"];
  ok(!!lionKing && lionKing.year === 1994 && lionKing.tomatoMeter === 92 && lionKing.tomatoAverage === 8.7 && lionKing.userAverage === 4 && lionKing.rtPath === "m/the_lion_king",
    "The Lion King is the 1994 film, not the 2019 remake");
  const insideOut = catalog["Inside Out"];
  ok(!!insideOut && insideOut.year === 2015 && insideOut.tomatoMeter === 98 && insideOut.tomatoAverage === 8.9 && insideOut.userAverage === 4.3 && insideOut.rtPath === "m/inside_out_2015",
    "Inside Out is the 2015 film, not the unscored 2005 one");
  const beauty = catalog["Beauty and the Beast"];
  ok(!!beauty && beauty.year === 1991 && beauty.tomatoMeter === 95 && beauty.tomatoAverage === 9 && beauty.userAverage === 4.4 && beauty.rtPath === "m/beauty_and_the_beast_1991",
    "Beauty and the Beast is the 1991 film");
  const cloudy = catalog["Cloudy with a Chance of Meatballs"];
  ok(!!cloudy && cloudy.year === 2009 && cloudy.tomatoMeter === 85 && cloudy.tomatoAverage === 7.3 && cloudy.userAverage === 3.7 && cloudy.rtPath === "m/1196077-cloudy_with_a_chance_of_meatballs",
    "Cloudy with a Chance of Meatballs uses the scored page, not the empty duplicate");
  const airBud = catalog["Air Bud"];
  ok(!!airBud && airBud.tomatoMeter === 50 && airBud.tomatoAverage === 5 && airBud.userAverage === 3 && airBud.popcornMeter === 38 && airBud.rtPath === "m/air_bud",
    "Air Bud is Tomatometer 50, critic 5, user 3, audience 38");
  const father = catalog["Father of the Bride"];
  ok(!!father && father.year === 1991 && father.tomatoMeter === 73 && father.userAverage === 3.7 && father.rtPath === "m/1037864-father_of_the_bride",
    "Father of the Bride is the 1991 film that Part II follows");
  const dozenRow = catalog["Cheaper By The Dozen (2003)"];
  ok(!!dozenRow && dozenRow.year === 2003 && dozenRow.tomatoMeter === 25 && dozenRow.tomatoAverage === 4.6 && dozenRow.userAverage === 3.4,
    "Cheaper By The Dozen (2003) keeps that year");
  const superBuddies = catalog["Super Buddies"];
  ok(!!superBuddies && superBuddies.userAverage === 3.2 && superBuddies.tomatoMeter == null && superBuddies.tomatoAverage == null && String(superBuddies.poster || "").indexOf("https://") === 0,
    "Super Buddies keeps the user average and does not invent a critic score");
  const pixie = catalog["Pixie Hollow Games, Disney Fairies"];
  ok(!!pixie && pixie.imdbRating === 7.4 && pixie.year === 2011 && pixie.tomatoMeter == null && String(pixie.poster || "").indexOf("https://") === 0,
    "Pixie Hollow Games has a poster and an IMDb score, because Rotten Tomatoes has no page");
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
    window.__MOVIE_CALLS__ = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async function (url, init) {
      const href = String(url);
      if (href.indexOf("/.netlify/functions/activity") !== -1) {
        return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (href.indexOf("/.netlify/functions/movies") !== -1) {
        let body = {};
        try { body = JSON.parse((init && init.body) || "{}"); } catch (e) { body = {}; }
        window.__MOVIE_CALLS__.push(body);
        if (body.action === "detail" && body.coverOnly) {
          window.__COVER_TRIES__ = (window.__COVER_TRIES__ || 0) + 1;
          if (window.__COVER_TRIES__ === 1) {
            return new Response(JSON.stringify({ found: false, reason: "rate-limit", title: body.title, cover: "" }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response(JSON.stringify({
            found: true,
            title: body.title,
            cover: "https://upload.wikimedia.org/wikipedia/en/2/2b/air_bud_poster.jpg",
            tomatoMeter: null,
            tomatoAverage: null,
            userAverage: null,
            popcornMeter: null,
            rtPath: "",
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (body.action === "detail") {
          return new Response(JSON.stringify({
            found: true,
            title: body.title,
            year: 1997,
            director: "Charles Martin Smith",
            cover: "https://upload.wikimedia.org/wikipedia/en/2/2b/air_bud_poster.jpg",
            tomatoMeter: 48,
            tomatoAverage: 4.8,
            userAverage: 3,
            popcornMeter: null,
            rtPath: "m/air_bud",
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
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
            }, {
              title: "Wolfwalkers",
              director: "Tomm Moore",
              year: 2020,
              genre: "Kids & Family",
              cover: "",
              description: "A hunter's daughter runs with the wolves.",
              communityRating: null,
              ratingsCount: null,
              ratingSource: "",
            }],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (body.action === "recommend") {
          const movies = [
            { title: "The Iron Giant", director: "Brad Bird", summary: "A boy hides a giant robot.", why: "Fits the family animation already owned." },
            { title: "Paddington 2", director: "Paul King", summary: "A bear goes to prison for a theft he did not commit.", why: "Warm family comedy beside the ones they own." },
            { title: "Luca", director: "Enrico Casarosa", summary: "Two sea monsters spend a summer on land.", why: "A Pixar they do not own." },
          ];
          // Coco and Soul exist so the watch-list checks have a title to save.
          // A page without that section still gets the original three, so the
          // "recs length === 0" check after Already watched still holds there.
          if (document.getElementById("watchLabel")) {
            movies.push(
              { title: "Coco", director: "Lee Unkrich", summary: "A boy visits the land of the dead.", why: "A family musical beside the ones they own." },
              { title: "Soul", director: "Pete Docter", summary: "A musician finds out what a soul is for.", why: "Another Pixar they do not own." },
            );
          }
          const text = " \n" + JSON.stringify({ movies });
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
    const label = document.getElementById("watchLabel");
    if (!label) return false;
    const watch = label.closest("section").getBoundingClientRect();
    const rec = document.getElementById("recLabel").closest("section").getBoundingClientRect();
    const shelf = document.getElementById("shelfLabel").closest("section").getBoundingClientRect();
    return watch.top > rec.top && watch.top < shelf.top
      && document.getElementById("watchList").textContent === "Nothing saved yet.";
  }), "Watch list sits under Next to watch and starts empty");
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

  // A live lookup left every film but the first two without a poster, and a
  // 429 was remembered as a miss. That rule no longer holds. The owned shelf
  // is painted from assets/movies/owned.json, so these rows do not ask the
  // function for a poster.
  ok(await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#shelfList .movie")];
    const calls = (window.__MOVIE_CALLS__ || []).filter((c) => c.action === "detail");
    return rows.length === 158 && calls.length === 0 && (window.__COVER_TRIES__ || 0) === 0 && rows.every((row) => {
      const img = row.querySelector("img");
      const text = row.textContent;
      const scored = /Tomatometer \d/.test(text) || /Users \d/.test(text) || /IMDb \d/.test(text);
      return !!(img && String(img.getAttribute("src") || "").indexOf("https://") === 0 && scored);
    });
  }), "all 158 owned rows show a poster and a score without a live lookup");

  await page.evaluate(() => document.querySelector("#shelfList .movie").click());
  await sleep(400);
  ok(await page.evaluate(() => {
    const d = document.getElementById("detail");
    if (!d) return false;
    const img = d.querySelector("img");
    const link = d.querySelector("#rtLink");
    const lines = [...d.querySelectorAll(".score")].map((el) => el.textContent);
    const calls = (window.__MOVIE_CALLS__ || []).filter((c) => c.action === "detail");
    return d.hidden === false
      && calls.length === 0
      && lines[0] === "Tomatometer 50%"
      && lines[1] === "Critic average 5/10"
      && lines[2] === "User average 3/5"
      && lines[3] === "Audience 38%"
      && img && img.getAttribute("src").indexOf("flixster.com") >= 0
      && link && link.getAttribute("href") === "https://www.rottentomatoes.com/m/air_bud";
  }), "clicking Air Bud opens the catalog poster and scores without a live lookup");
  await page.evaluate(() => { const b = document.getElementById("detailClose"); if (b) b.click(); });
  await sleep(40);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("#shelfList .movie")].find((el) => el.querySelector(".t").textContent === "The Lion King");
    row.click();
  });
  await sleep(200);
  ok(await page.evaluate(() => {
    const d = document.getElementById("detail");
    const lines = [...d.querySelectorAll(".score")].map((el) => el.textContent);
    const link = d.querySelector("#rtLink");
    return d.hidden === false
      && lines[0] === "Tomatometer 92%"
      && lines[1] === "Critic average 8.7/10"
      && lines[2] === "User average 4/5"
      && link && link.getAttribute("href") === "https://www.rottentomatoes.com/m/the_lion_king";
  }), "clicking The Lion King shows the 1994 critic average and user average");
  await page.evaluate(() => { const b = document.getElementById("detailClose"); if (b) b.click(); });
  await sleep(40);
  ok(await page.evaluate(() => {
    const d = document.getElementById("detail");
    return !!(d && d.hidden === true && d.offsetParent === null);
  }), "Close hides the movie sheet (offsetParent null, not just a hidden attribute)");

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

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.type("#newProfile", "Dad");
  await page.evaluate(() => {
    const b = document.getElementById("addProfile");
    if (b && b.scrollIntoView) b.scrollIntoView({ block: "center" });
  });
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

  await page.evaluate(() => {
    document.getElementById("searchQ").value = "wolfwalkers";
    document.getElementById("searchBtn").click();
  });
  await page.waitForFunction(() => document.querySelectorAll("#searchHits .movie").length >= 2, { timeout: 8000 });
  const shelfBeforeWatch = await page.evaluate(() => window.__MOVIES__.current().shelf.length);
  const ownedWatch = await page.evaluate(() => {
    const row = [...document.querySelectorAll("#searchHits .movie")].find((el) => el.querySelector(".t").textContent === "The Iron Giant");
    const btn = row && [...row.querySelectorAll("button")].find((b) => b.textContent === "Watch list");
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(40);
  ok(ownedWatch && await page.evaluate((n) => {
    const joy = window.__MOVIES__.current();
    return document.getElementById("searchErr").textContent === "Already owned."
      && !(joy.watchlist || []).some((m) => m.title === "The Iron Giant")
      && joy.shelf.length === n
      && document.getElementById("detail").hidden === true;
  }, shelfBeforeWatch), "Watch list does not save a movie already owned");
  const savedSearch = await page.evaluate(() => {
    const row = [...document.querySelectorAll("#searchHits .movie")].find((el) => el.querySelector(".t").textContent === "Wolfwalkers");
    const btn = row && [...row.querySelectorAll("button")].find((b) => b.textContent === "Watch list");
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(40);
  ok(savedSearch && await page.evaluate((n) => {
    const joy = window.__MOVIES__.current();
    const painted = [...document.querySelectorAll("#watchList .t")].map((el) => el.textContent);
    const onShelf = [...document.querySelectorAll("#shelfList .t")].map((el) => el.textContent);
    return joy.watchlist.some((m) => m.title === "Wolfwalkers" && m.director === "Tomm Moore")
      && joy.watchlist.length === 1
      && painted.indexOf("Wolfwalkers") >= 0
      && onShelf.indexOf("Wolfwalkers") < 0
      && joy.shelf.length === n
      && document.getElementById("detail").hidden === true;
  }, shelfBeforeWatch), "Watch list on a search hit saves it without owning it");
  const shelvedWatch = await page.evaluate(() => {
    const row = [...document.querySelectorAll("#searchHits .movie")].find((el) => el.querySelector(".t").textContent === "Wolfwalkers");
    if (!row || !(window.__MOVIES__.current().watchlist || []).some((m) => m.title === "Wolfwalkers")) return false;
    row.click();
    return true;
  });
  await sleep(40);
  ok(shelvedWatch && await page.evaluate(() => {
    const joy = window.__MOVIES__.current();
    const painted = [...document.querySelectorAll("#shelfList .t")].map((el) => el.textContent);
    return joy.shelf.some((m) => m.title === "Wolfwalkers")
      && !(joy.watchlist || []).some((m) => m.title === "Wolfwalkers")
      && painted.indexOf("Wolfwalkers") >= 0
      && document.getElementById("watchList").textContent === "Nothing saved yet.";
  }), "adding a saved title to Owned takes it off the watch list");

  await page.type("#newInterest", "family");
  await page.click("#addInterest");
  await sleep(40);
  ok(await page.evaluate(() => window.__MOVIES__.current().interests.join() === "family"), "an interest sticks");

  await page.evaluate(() => document.getElementById("recBtn").click());
  await page.waitForFunction(() => document.querySelectorAll("#recs .movie").length >= 1, { timeout: 8000 });
  // The fixture still returns The Iron Giant after it was added to Owned.
  // The page now hides a pick that is owned, already watched, or not interested,
  // so the first painted title is Paddington 2.
  ok(await page.evaluate(() => {
    const titles = [...document.querySelectorAll("#recs .t")].map((el) => el.textContent);
    const row = [...document.querySelectorAll("#recs .movie")].find((el) => el.querySelector(".t").textContent === "Paddington 2");
    const sum = row && row.querySelector(".summary");
    const why = row && row.querySelector(".why");
    return titles.indexOf("The Iron Giant") < 0 && titles[0] === "Paddington 2"
      && sum && /prison/.test(sum.textContent)
      && why && /comedy/.test(why.textContent)
      && !!row.querySelector("button") && [...row.querySelectorAll("button")].some((b) => b.textContent === "Already watched")
      && [...row.querySelectorAll("button")].some((b) => b.textContent === "Not interested");
  }), "Recommend paints a pick they do not own, with Already watched and Not interested");
  ok(await page.evaluate(() => {
    const row = [...document.querySelectorAll("#recs .movie")].find((el) => el.querySelector(".t").textContent === "Paddington 2");
    return !!(row && [...row.querySelectorAll("button")].some((b) => b.textContent === "Watch list"));
  }), "a recommendation has a Watch list button");

  const savedRecs = await page.evaluate(() => {
    const titles = ["Coco", "Soul"];
    for (let i = 0; i < titles.length; i++) {
      const row = [...document.querySelectorAll("#recs .movie")].find((el) => el.querySelector(".t").textContent === titles[i]);
      const btn = row && [...row.querySelectorAll("button")].find((b) => b.textContent === "Watch list");
      if (!btn) return false;
      btn.click();
    }
    return true;
  });
  await sleep(40);
  const ownedAtSave = await page.evaluate(() => window.__MOVIES__.current().shelf.length);
  ok(savedRecs && await page.evaluate((n) => {
    const joy = window.__MOVIES__.current();
    const recs = [...document.querySelectorAll("#recs .t")].map((el) => el.textContent);
    const saved = [...document.querySelectorAll("#watchList .t")].map((el) => el.textContent);
    const owned = [...document.querySelectorAll("#shelfList .t")].map((el) => el.textContent);
    const coco = (joy.watchlist || []).find((m) => m.title === "Coco");
    return (joy.watchlist || []).length === 2
      && !!coco && coco.director === "Lee Unkrich"
      && saved.indexOf("Coco") >= 0 && saved.indexOf("Soul") >= 0
      && recs.indexOf("Coco") < 0 && recs.indexOf("Soul") < 0
      && owned.indexOf("Coco") < 0 && owned.indexOf("Soul") < 0
      && joy.shelf.length === n
      && recs.indexOf("Paddington 2") >= 0 && recs.indexOf("Luca") >= 0;
  }, ownedAtSave), "Watch list saves the pick, hides it from Next to watch, and leaves it off Owned");

  const ownedBefore = await page.evaluate(() => window.__MOVIES__.current().shelf.length);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("#recs .movie")].find((el) => el.querySelector(".t").textContent === "Luca");
    [...row.querySelectorAll("button")].find((b) => b.textContent === "Not interested").click();
  });
  await sleep(40);
  ok(await page.evaluate((n) => {
    const joy = window.__MOVIES__.current();
    const titles = [...document.querySelectorAll("#recs .t")].map((el) => el.textContent);
    return joy.skipped.some((m) => m.title === "Luca")
      && titles.indexOf("Luca") < 0
      && joy.shelf.length === n
      && !joy.shelf.some((m) => m.title === "Luca");
  }, ownedBefore), "Not interested drops the pick and does not add it to Owned");

  // Already watched used to stay off Owned, because Owned was the purchase
  // library. That rule no longer holds: a watched title joins Owned, which
  // is the list Recommend already excludes, and that row is brought into view.
  await page.evaluate(() => {
    window.__shelfScroll = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (arg) {
      const t = this.querySelector && this.querySelector(".t");
      const onShelf = !!(this.closest && this.closest("#shelfList"));
      if (t && onShelf) window.__shelfScroll.push(t.textContent);
      return orig.call(this, arg);
    };
    const row = [...document.querySelectorAll("#recs .movie")].find((el) => el.querySelector(".t").textContent === "Paddington 2");
    [...row.querySelectorAll("button")].find((b) => b.textContent === "Already watched").click();
  });
  await sleep(40);
  ok(await page.evaluate((n) => {
    const joy = window.__MOVIES__.current();
    const painted = [...document.querySelectorAll("#shelfList .t")].map((el) => el.textContent);
    const row = joy.shelf.find((m) => m.title === "Paddington 2");
    return !(joy.watched || []).some((m) => m.title === "Paddington 2")
      && joy.shelf.length === n + 1
      && !!row && String(row.id || "").indexOf("add-") === 0 && row.director === "Paul King"
      && painted.indexOf("Paddington 2") >= 0
      && (window.__shelfScroll || []).indexOf("Paddington 2") >= 0
      && document.querySelectorAll("#recs .movie").length === 0
      && !document.getElementById("watchedList");
  }, ownedBefore), "Already watched adds the pick to Owned and brings that row into view");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__MOVIES__ && document.querySelector("#shelfList .t"), { timeout: 15000 });
  ok(await page.evaluate(() => {
    const joy = window.__MOVIES__.current();
    const painted = [...document.querySelectorAll("#shelfList .t")].map((el) => el.textContent);
    return joy.name === "Joy"
      && !(joy.watched || []).some((m) => m.title === "Paddington 2")
      && joy.shelf.some((m) => m.title === "Paddington 2")
      && painted.indexOf("Paddington 2") >= 0
      && joy.skipped.some((m) => m.title === "Luca")
      && !joy.shelf.some((m) => m.title === "Luca");
  }), "an already-watched title stays in Owned after reload, and not-interested stays off it");
  ok(await page.evaluate(() => {
    const joy = window.__MOVIES__.current();
    const painted = [...document.querySelectorAll("#watchList .t")].map((el) => el.textContent);
    const owned = [...document.querySelectorAll("#shelfList .t")].map((el) => el.textContent);
    return painted.indexOf("Coco") >= 0 && painted.indexOf("Soul") >= 0
      && owned.indexOf("Coco") < 0 && owned.indexOf("Soul") < 0
      && (joy.watchlist || []).length === 2;
  }), "the watch list is still there after reload, and those titles stay off Owned");

  await page.evaluate(() => {
    const dad = [...document.querySelectorAll("#profileChips .chip")].find((b) => b.textContent === "Dad");
    dad.click();
  });
  await sleep(40);
  ok(await page.evaluate(() => {
    const dad = window.__MOVIES__.current();
    const skipped = dad.skipped || [];
    const watched = dad.watched || [];
    return dad.name === "Dad" && skipped.length === 0 && watched.length === 0;
  }), "Dad does not inherit Joy's passed movies");
  ok(await page.evaluate(() => {
    const dad = window.__MOVIES__.current();
    const joy = window.__MOVIES__.state().profiles.find((p) => p.name === "Joy");
    return dad.name === "Dad"
      && !(dad.watchlist || []).length
      && document.getElementById("watchList")
      && document.getElementById("watchList").textContent === "Nothing saved yet."
      && !!(joy && (joy.watchlist || []).some((m) => m.title === "Coco"));
  }), "Dad does not inherit Joy's watch list");

  await page.evaluate(() => {
    const joy = [...document.querySelectorAll("#profileChips .chip")].find((b) => b.textContent === "Joy");
    joy.click();
  });
  await sleep(40);
  await page.evaluate(() => document.getElementById("recBtn").click());
  await page.waitForFunction(() => {
    const calls = window.__MOVIE_CALLS__ || [];
    return calls.some((c) => c.action === "recommend" && c.skipped && c.skipped.some((m) => m.title === "Luca"));
  }, { timeout: 8000 });
  ok(await page.evaluate(() => {
    const calls = window.__MOVIE_CALLS__.filter((c) => c.action === "recommend");
    const last = calls[calls.length - 1];
    const titles = [...document.querySelectorAll("#recs .t")].map((el) => el.textContent);
    return last.skipped.some((m) => m.title === "Luca")
      && last.shelf.some((m) => m.title === "Paddington 2")
      && !(last.watched || []).some((m) => m.title === "Paddington 2")
      && titles.indexOf("Luca") < 0
      && titles.indexOf("Paddington 2") < 0
      && titles.indexOf("The Iron Giant") < 0;
  }), "the next recommend sends the owned title and the not-interested title and does not paint them");
  ok(await page.evaluate(() => {
    const calls = window.__MOVIE_CALLS__.filter((c) => c.action === "recommend");
    const last = calls[calls.length - 1];
    const titles = [...document.querySelectorAll("#recs .t")].map((el) => el.textContent);
    const saved = (last.watchlist || []).map((m) => m.title);
    return saved.indexOf("Coco") >= 0 && saved.indexOf("Soul") >= 0
      && titles.indexOf("Coco") < 0 && titles.indexOf("Soul") < 0;
  }), "the next recommend sends the watch list and does not paint those titles");

  const openedWatch = await page.evaluate(() => {
    const row = [...document.querySelectorAll("#watchList .movie")].find((el) => el.querySelector(".t") && el.querySelector(".t").textContent === "Coco");
    if (!row) return false;
    row.click();
    return true;
  });
  if (openedWatch) {
    await page.waitForFunction(() => document.getElementById("detail").hidden === false, { timeout: 8000 });
  }
  ok(openedWatch && await page.evaluate(() => document.getElementById("detailTitle").textContent === "Coco"),
    "a watch-list row opens that movie");
  await page.evaluate(() => { const b = document.getElementById("detailClose"); if (b) b.click(); });
  await sleep(40);

  const removedWatch = await page.evaluate(() => {
    const row = [...document.querySelectorAll("#watchList .movie")].find((el) => el.querySelector(".t") && el.querySelector(".t").textContent === "Coco");
    const btn = row && [...row.querySelectorAll("button")].find((b) => b.textContent === "Remove");
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(40);
  ok(removedWatch && await page.evaluate(() => {
    const joy = window.__MOVIES__.current();
    const recs = [...document.querySelectorAll("#recs .t")].map((el) => el.textContent);
    const saved = [...document.querySelectorAll("#watchList .t")].map((el) => el.textContent);
    return !(joy.watchlist || []).some((m) => m.title === "Coco")
      && saved.indexOf("Coco") < 0
      && recs.indexOf("Coco") >= 0
      && saved.indexOf("Soul") >= 0
      && document.getElementById("detail").hidden === true;
  }), "Remove puts the title back in the picks and leaves the rest of the watch list");

  const watchedFromList = await page.evaluate(() => {
    window.__shelfScroll = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (arg) {
      const t = this.querySelector && this.querySelector(".t");
      const onShelf = !!(this.closest && this.closest("#shelfList"));
      if (t && onShelf) window.__shelfScroll.push(t.textContent);
      return orig.call(this, arg);
    };
    const row = [...document.querySelectorAll("#watchList .movie")].find((el) => el.querySelector(".t") && el.querySelector(".t").textContent === "Soul");
    const btn = row && [...row.querySelectorAll("button")].find((b) => b.textContent === "Already watched");
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(40);
  ok(watchedFromList && await page.evaluate(() => {
    const joy = window.__MOVIES__.current();
    const painted = [...document.querySelectorAll("#shelfList .t")].map((el) => el.textContent);
    const saved = [...document.querySelectorAll("#watchList .t")].map((el) => el.textContent);
    return joy.shelf.some((m) => m.title === "Soul")
      && !(joy.watchlist || []).some((m) => m.title === "Soul")
      && painted.indexOf("Soul") >= 0
      && saved.indexOf("Soul") < 0
      && (window.__shelfScroll || []).indexOf("Soul") >= 0;
  }), "Already watched on the watch list moves that title to Owned");

  // Someone who already tapped Already watched, before that title joined
  // Owned, still has it in watched[]. The next load moves it onto the shelf
  // and clears the chip list. Not interested stays off Owned.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("movies_profiles_v1"));
    const joy = raw.profiles.find((p) => p.name === "Joy");
    joy.watched = [{ title: "Spies in Disguise", director: "Troy Quane" }];
    joy.shelf = joy.shelf.filter((m) => m.title !== "Spies in Disguise");
    localStorage.setItem("movies_profiles_v1", JSON.stringify(raw));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__MOVIES__ && document.querySelector("#shelfList .t"), { timeout: 15000 });
  ok(await page.evaluate(() => {
    const joy = window.__MOVIES__.current();
    const painted = [...document.querySelectorAll("#shelfList .t")].map((el) => el.textContent);
    const row = joy.shelf.find((m) => m.title === "Spies in Disguise");
    return joy.name === "Joy"
      && !!row && row.director === "Troy Quane" && String(row.id || "").indexOf("add-") === 0
      && painted.indexOf("Spies in Disguise") >= 0
      && !(joy.watched || []).length
      && joy.skipped.some((m) => m.title === "Luca")
      && !joy.shelf.some((m) => m.title === "Luca")
      && joy.shelf.some((m) => m.title === "Paddington 2");
  }), "a saved Already watched list moves onto Owned on the next load");

  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("movies_profiles_v1"));
    const joy = raw.profiles.find((p) => p.name === "Joy");
    joy.watchlist = [];
    for (let i = 0; i < 81; i++) joy.watchlist.push({ title: "Extra " + i, director: "Dir" });
    localStorage.setItem("movies_profiles_v1", JSON.stringify(raw));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__MOVIES__ && document.querySelector("#shelfList .t"), { timeout: 15000 });
  ok(await page.evaluate(() => {
    const joy = window.__MOVIES__.current();
    const titles = (joy.watchlist || []).map((m) => m.title);
    return joy.name === "Joy"
      && titles.length === 80
      && titles[0] === "Extra 1"
      && titles.indexOf("Extra 0") < 0
      && titles.indexOf("Extra 80") >= 0;
  }), "a watch list longer than 80 drops the oldest on the next load");

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
  const rt = await serveRt();
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
    rt.close();
  }
  console.log("\n" + pass + " passed, " + fail + " failed");
  if (failures.length) {
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
})();
