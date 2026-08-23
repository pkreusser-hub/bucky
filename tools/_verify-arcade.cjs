#!/usr/bin/env node
"use strict";
/**
 * BUCKY Arcade suite — arcade.html, the standalone public games page with no password
 * and no Firebase.
 *
 *   node tools/_verify-arcade.cjs
 *
 * FIREBASE IS BLOCKED THROUGHOUT (googleapis / firestore / firebase / gstatic). Not
 * optional hygiene: an unblocked headless run against this repo has twice seeded
 * duplicates into the live family herd. This suite's single most important check is that
 * arcade.html makes ZERO requests to any host but 127.0.0.1 in the first place — the
 * block list is belt-and-braces on top of that.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8933;
const BASE = `http://127.0.0.1:${PORT}`;

// RESTAGED (2026-08-19): the page originally made ZERO off-host requests, which meant dropping the
// Farmstead web fonts the rest of the site uses. Fonts are now the one permitted exception — and
// ONLY fonts.googleapis.com / fonts.gstatic.com. This is an ALLOWLIST, so the sabotage check (a
// Firebase bundle from www.gstatic.com) still fails: same parent domain, different host.
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
function forbiddenOffHost(requests){
  return requests.filter((u) => {
    try { const h = new URL(u).hostname; return h !== "127.0.0.1" && !FONT_HOSTS.has(h); } catch (e) { return false; }
  });
}


let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; failures.push(name); console.log("  \u2717 FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");

/* ============================ static server =============================== */
const MIME = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript",
  ".json":"application/json", ".css":"text/css", ".png":"image/png", ".jpg":"image/jpeg",
  ".webp":"image/webp", ".svg":"image/svg+xml", ".txt":"text/plain",
  ".webmanifest":"application/manifest+json" };
function serve(){
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/arcade.html";
      if (p.endsWith("/")) p = p + "index.html";
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

const EXPECTED = [
  ["Hay Haul", "hayhaul.html"],
  ["Branch Manager", "branchmanager.html"],
  ["Hayhem", "hayhem.html"],
  ["Pasture Panic", "pasturepanic.html?fam=arcade"],   // own lobby namespace — never the family hub's
  ["Baby Bucky", "goatcare.html"],
  ["Castle Kruzer", "castlekruzer.html"],
  ["Farm Life", "farmlife/dist/"],
];

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

async function launchBrowser(){
  return puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
}

async function newGuardedPage(browser, requests){
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    requests.push(url);
    if (/googleapis|firestore|firebase|gstatic/i.test(url)) {
      return req.abort();
    }
    req.continue();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.__pageErrors = errors;
  return page;
}

async function run(){
  const srv = await serve();
  const browser = await launchBrowser();

  try {
    /* ===================== phone pass ===================== */
    section("phone 390x844");
    let requests = [];
    let page = await newGuardedPage(browser, requests);
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(BASE + "/arcade.html", { waitUntil: "networkidle0" });

    const offHostReqs = forbiddenOffHost(requests);
    ok(offHostReqs.length === 0, "no network request to any host but itself and the two Google Fonts hosts (" + offHostReqs.length + " found)");
    if (offHostReqs.length) console.log("      offenders: " + offHostReqs.slice(0, 5).join(", "));

    const tiles = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a.tile")).map((a) => ({
        href: a.getAttribute("href"),
        name: a.querySelector(".tile-name") ? a.querySelector(".tile-name").textContent : "",
        h: a.getBoundingClientRect().height,
      }));
    });
    ok(tiles.length === 7, "exactly 7 game tiles render (found " + tiles.length + ")");
    const orderOk = EXPECTED.every((exp, i) => tiles[i] && tiles[i].name === exp[0] && tiles[i].href === exp[1]);
    ok(orderOk, "tiles are the specified 7, in the specified order, each href matching");
    if (!orderOk) console.log("      got: " + JSON.stringify(tiles.map((t) => [t.name, t.href])));

    const allTapSize = tiles.every((t) => t.h >= 44);
    ok(allTapSize, "every tile at least 44px tall (tap target)");

    const badLinks = await page.evaluate(() => {
      const banned = ["index.html", "games.html", "farmgpt.html"];
      return Array.from(document.querySelectorAll("a[href]"))
        .map((a) => a.getAttribute("href"))
        .filter((href) => banned.some((b) => href === b || href.endsWith("/" + b)));
    });
    ok(badLinks.length === 0, "no element links to index.html, games.html, farmgpt.html, or any other non-game page");
    if (badLinks.length) console.log("      offenders: " + badLinks.join(", "));

    const nonGameHrefs = await page.evaluate((allowed) => {
      return Array.from(document.querySelectorAll("a[href]"))
        .map((a) => a.getAttribute("href"))
        .filter((href) => !allowed.includes(href));
    }, EXPECTED.map((e) => e[1]));
    ok(nonGameHrefs.length === 0, "every anchor on the page is one of the 7 game hrefs (found " + nonGameHrefs.length + " extra)");
    if (nonGameHrefs.length) console.log("      extra: " + nonGameHrefs.join(", "));

    const lsCount = await page.evaluate(() => Object.keys(window.localStorage).length);
    ok(lsCount === 0, "localStorage is empty after load (found " + lsCount + " keys)");

    const emojiHit = await page.evaluate((reSrc) => {
      const re = new RegExp(reSrc, "u");
      const els = document.querySelectorAll("h1, h2, h3, button, .tile-name, .tile-desc, a.tile");
      for (const el of els) {
        if (re.test(el.textContent)) return el.textContent;
      }
      return null;
    }, EMOJI_RE.source);
    ok(emojiHit === null, "no emoji characters in headings, buttons, or tile labels");
    if (emojiHit) console.log("      offender text: " + JSON.stringify(emojiHit));

    const robots = await page.evaluate(() => {
      const m = document.querySelector('meta[name="robots"]');
      return m ? m.getAttribute("content") : null;
    });
    ok(robots === "noindex", "meta[name=robots] is noindex (got " + JSON.stringify(robots) + ")");

    const phoneScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    ok(phoneScroll, "no horizontal scroll at 390x844");

    const labelClip = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".tile-name, .tile-desc")).every(
        (el) => el.scrollWidth <= el.clientWidth + 1
      );
    });
    ok(labelClip, "no tile label is clipped at 390x844");

    ok(page.__pageErrors.length === 0, "zero page errors (phone pass)");
    if (page.__pageErrors.length) console.log("      " + page.__pageErrors.join(" | "));

    fs.mkdirSync(path.join(process.env.TEMP || "/tmp", "arcade-shots"), { recursive: true });
    const scratch = "C:/Users/pkreu/AppData/Local/Temp/claude/C--Users-pkreu-OneDrive-Documents-BUCKY/eb05c698-f366-44e8-8bc6-b40abba1d187/scratchpad";
    fs.mkdirSync(scratch, { recursive: true });
    await page.screenshot({ path: path.join(scratch, "arcade_phone.png") });
    await page.close();

    /* ===================== desktop pass ===================== */
    section("desktop 1280x900");
    requests = [];
    page = await newGuardedPage(browser, requests);
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(BASE + "/arcade.html", { waitUntil: "networkidle0" });

    const offHost2 = forbiddenOffHost(requests);
    ok(offHost2.length === 0, "no forbidden off-host requests at 1280x900 (" + offHost2.length + " found)");

    const deskScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    ok(deskScroll, "no horizontal scroll at 1280x900");

    const mainWidth = await page.evaluate(() => {
      const m = document.querySelector("main");
      return m ? m.getBoundingClientRect().width : 0;
    });
    ok(mainWidth > 0 && mainWidth <= 720, "content width is capped, not absurdly wide (main width " + mainWidth + "px)");

    ok(page.__pageErrors.length === 0, "zero page errors (desktop pass)");

    await page.screenshot({ path: path.join(scratch, "arcade_desktop.png") });
    await page.close();

    /* ===================== source-level checks ===================== */
    section("source belt-and-braces");
    const src = fs.readFileSync(path.join(ROOT, "arcade.html"), "utf8");
    const banned = ["choreUnlocked", "FAMILY_PASSWORD", "choreUser", "firebase", "firestore", "gstatic", "index.html"];
    banned.forEach((needle) => {
      // "gstatic" legitimately appears in a fonts.gstatic.com preconnect for Google Fonts,
      // which every other Farmstead page also does and which carries no family data — so
      // that one substring is expected. Flag it only if it's NOT the preconnect line.
      if (needle === "gstatic") {
        const lines = src.split("\n").filter((l) => l.includes("gstatic"));
        const onlyPreconnect = lines.every((l) => l.includes("fonts.gstatic.com"));
        ok(onlyPreconnect, "arcade.html's only 'gstatic' reference is the Google Fonts preconnect (" + lines.length + " line(s))");
        return;
      }
      ok(!src.includes(needle), "arcade.html source does not contain '" + needle + "'");
    });

  } finally {
    await browser.close();
    await new Promise((r) => srv.close(r));
  }

  console.log("\n" + pass + "/" + (pass + fail) + " passed.");
  if (fail) {
    console.log("\nFailed:");
    failures.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
