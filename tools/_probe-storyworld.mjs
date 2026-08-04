#!/usr/bin/env node
/**
 * World-creation wait screen — LIVE probe.
 *
 *   node tools/_probe-storyworld.mjs                    # one real new story, timed
 *   node tools/_probe-storyworld.mjs --runs 3           # three, for a spread
 *   node tools/_probe-storyworld.mjs --universe httyd   # with a pack (default: original)
 *
 * Drives the REAL farmgpt.html through a REAL new-story creation: Fable builds the world, Grok
 * writes scene one, and the page is watched from the outside the whole way through — so what is
 * reported here is what a child at the iPad actually experiences, not what the code intends.
 *
 * It hosts netlify/functions/farmgpt.mjs in process with the keys from tools/.env and Firestore
 * pointed at a dead host, so nothing touches the family's Story Log and the daily-cap query
 * fails open exactly as designed. It costs a few cents per run (one Fable seed, one Grok scene,
 * one background Haiku keeper).
 *
 * THE PROBE IS DAD — STORY_DAILY_CAP is 15 and the client counts every scene it renders. It
 * sends no `user` on the wire either, so the server neither counts nor logs it.
 *
 * WHAT IT MEASURES, and why each one is the number that matters:
 *   tap → first byte   how long the screen is a promise with nothing behind it. The worst
 *                      number on the page, and the reason the screen exists at all.
 *   first byte → 1st   when the first NAME lands. From here the child has something to watch,
 *      revealed name   so this is the real end of "is it broken?".
 *   → world done       the seed finished and the cast/counts are complete.
 *   → first word       the storyteller's own latency, ending at the handoff into the book.
 *   TOTAL              tap to reading.
 * It also asserts, live, the one rule that must never bend: no planted secret ever reached the
 * DOM. Same sentinel as the suite — every mutation plus a 25ms paint poll.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const args = process.argv.slice(2);
const flagN = (n, d) => { const i = args.indexOf("--" + n); if (i === -1) return d; const v = +args[i + 1]; return Number.isFinite(v) && v > 0 ? v : d; };
const flagS = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : (args[i + 1] || d); };
const PORT = flagN("port", 8799);
const RUNS = flagN("runs", 1);
const UNIVERSE = flagS("universe", "original");
const SECRET = "amenfarms";

for (const line of fs.readFileSync(path.join(ROOT, "tools/.env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
if (!process.env.ANTHROPIC_API_KEY) { console.error("No ANTHROPIC_API_KEY in tools/.env"); process.exit(2); }
if (!process.env.XAI_API_KEY) console.warn("! No XAI_API_KEY — the narrator will fall back off Grok.");
process.env.BUCKY_NOTIFY_SECRET = SECRET;
process.env.FARMGPT_FIRESTORE_BASE = "http://127.0.0.1:9/dead";
process.env.FARMGPT_GOOGLE_TOKEN_URL = "http://127.0.0.1:9/dead";

const handler = (await import("file:///" + path.join(ROOT, "netlify/functions/farmgpt.mjs").replace(/\\/g, "/"))).default;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
               ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      if (req.url.startsWith("/.netlify/functions/farmgpt")) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const fReq = new Request("http://localhost" + req.url, {
          method: req.method, headers: req.headers,
          body: req.method === "GET" ? undefined : Buffer.concat(chunks).toString("utf8"),
        });
        const out = await handler(fReq, {});
        res.writeHead(out.status, Object.fromEntries(out.headers));
        if (out.body) {
          const rd = out.body.getReader();
          // Flush every chunk the instant it arrives — the whole point of this probe is the
          // TIMING of bytes, and buffering here would measure the probe, not the product.
          for (;;) { const { done, value } = await rd.read(); if (done) break; res.write(Buffer.from(value)); }
        }
        return res.end();
      }
      const p = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(ROOT, p === "/" ? "index.html" : p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.statusCode = 404; return res.end("not found");
      }
      res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      res.end(fs.readFileSync(file));
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

const IDEAS = [
  "A cosy mystery in a little harbour town where the lamps keep going out.",
  "I look after the animals at a mountain rescue station, and something new just arrived.",
  "A story about a lost puppy who has to find her way home across one very big city.",
];

async function openPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (/cdn\.jsdelivr\.net/.test(url)) {
      return req.respond({ status: 200, contentType: "text/javascript",
        body: "window.marked={setOptions(){},parse:(s)=>String(s)};window.DOMPurify={sanitize:(s)=>String(s)};window.katex={};window.renderMathInElement=function(){};" });
    }
    if (/googleapis|firestore|firebase|gstatic/.test(url)) return req.abort();
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return req.continue();
    return req.abort();
  });
  // The outside observer. It timestamps the screen's own state every 25ms — stage states, how
  // many names are up, which view is on — so the report is a record of what was on screen, not
  // of what the code believed.
  await page.evaluateOnNewDocument(() => {
    window.__WATCH__ = { marks: {}, chips: [], leak: [], samples: 0 };
    const mark = (k) => { if (!(k in window.__WATCH__.marks)) window.__WATCH__.marks[k] = Date.now(); };
    window.__MARK__ = mark;
    const start = () => {
      setInterval(() => {
        const W = window.__WATCH__;
        W.samples++;
        const S = window.__STORY__;
        if (!S) return;
        const seed = S.worldWait.stageState("seed"), scene = S.worldWait.stageState("scene");
        if (seed === "doing") mark("seedStart");
        if (seed === "done") mark("seedDone");
        if (scene === "doing") mark("sceneStart");
        const sub = document.getElementById("wStage_seed");
        if (sub && /on paper/.test(sub.querySelector(".wSub").textContent)) mark("firstByte");
        const chips = [...document.querySelectorAll("#worldReveal .wChip")].map((c) => c.textContent);
        if (chips.length > W.chips.length) {
          if (!W.chips.length) mark("firstName");
          W.chips = chips;
        }
        if (document.getElementById("viewStory").classList.contains("on")) mark("firstWord");
        // The rule that may never bend. The secrets are read from whichever copy of the world
        // exists yet — the screen's, then the story's — so the sentinel is armed from the very
        // moment there is anything to leak.
        const led = (S.story && S.story.ledger) || S.worldWait.builtLedger();
        const secrets = (led && led.player_knowledge && led.player_knowledge.hidden_from_player) || [];
        const txt = document.body.innerText || "";
        for (const s of secrets) if (s && txt.includes(s)) W.leak.push(s.slice(0, 40));
      }, 25);
    };
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start, { once: true });
  });
  await page.goto(`http://127.0.0.1:${PORT}/farmgpt.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("!!window.__STORY__", { timeout: 15000 });
  await page.evaluate(() => {
    localStorage.setItem("choreUser", "Dad");            // never capped, never logged
    localStorage.removeItem("farmgpt_story_count_v1");
    localStorage.removeItem("farmgpt_stories_v1");
  });
  page.__errors = errors;
  return page;
}

const ms = (n) => (n == null ? "  —  " : (n / 1000).toFixed(1).padStart(5) + "s");

async function oneRun(browser, n) {
  const idea = IDEAS[n % IDEAS.length];
  const page = await openPage(browser);
  console.log(`\n--- run ${n + 1}/${RUNS} — universe "${UNIVERSE}" ---`);
  console.log(`    idea: ${idea}`);

  await page.evaluate(() => document.getElementById("cardStory").click());
  await page.waitForSelector("#viewStorySetup.on");
  await page.evaluate((u, idea) => {
    const chip = document.querySelector('#universeChips .chip[data-u="' + u + '"]');
    if (chip) chip.click();
    document.getElementById("heroName").value = "Wren";
    document.getElementById("worldInput").value = idea;
  }, UNIVERSE, idea);

  const t0 = await page.evaluate(() => {
    window.__MARK__("tap");
    document.getElementById("beginBtn").click();
    return window.__WATCH__.marks.tap;
  });

  // Wait for the book, generously: a real Fable seed can run to its 75s abort.
  await page.waitForSelector("#viewStory.on", { timeout: 150000 });
  // …and let the scene finish so the whole experience is measured, not just its first word.
  await page.waitForFunction("window.__STORY__.story && window.__STORY__.story.messages.length >= 2", { timeout: 150000 });
  const tEnd = Date.now();

  const r = await page.evaluate(() => {
    const S = window.__STORY__, W = window.__WATCH__;
    const led = S.story.ledger;
    return {
      marks: W.marks, chips: W.chips, leak: W.leak, samples: W.samples,
      reveal: S.worldReveal(led),
      canon: led.canon.length,
      chars: led.characters.length,
      places: led.locations.length,
      threads: led.open_threads.length,
      secrets: led.player_knowledge.hidden_from_player,
      valid: S.validateLedger(led).ok,
      scene: (S.story.messages[1] || {}).content || "",
      body: document.body.innerText,
    };
  });

  const m = r.marks;
  const at = (k) => (m[k] ? m[k] - t0 : null);
  const gap = (a, b) => (m[a] && m[b] ? m[b] - m[a] : null);
  const row = (label, v) => console.log("      " + label.padEnd(34) + ms(v));

  console.log("\n    WHAT THE CHILD SEES (elapsed from the Begin tap)");
  row("world screen up", 0);
  row("→ seeder's first byte", at("firstByte"));
  row("→ first name on screen", at("firstName"));
  row("→ world finished", at("seedDone"));
  row("→ storyteller starts", at("sceneStart"));
  row("→ FIRST WORD (into the book)", at("firstWord"));
  row("→ scene finished streaming", tEnd - t0);
  console.log("\n    STAGE COSTS");
  row("Fable: think before writing", gap("seedStart", "firstByte"));
  row("Fable: writing the world", gap("firstByte", "seedDone"));
  row("Grok: to the first word", gap("sceneStart", "firstWord"));
  row("Grok: rest of the scene", m.firstWord ? tEnd - m.firstWord : null);
  const dead = at("firstName");
  console.log(`\n    Longest stretch with nothing to look at: ${ms(dead)}` +
    (dead != null && dead > 25000 ? "   ← the number to watch" : ""));

  console.log(`\n    THE WORLD FABLE BUILT: ${r.canon} rules · ${r.chars} characters · ` +
    `${r.places} places · ${r.threads} threads · ${r.secrets.length} secrets`);
  console.log("    shown on screen: " + (r.chips.length ? r.chips.map((c) => c.trim()).join(" | ") : "(nothing)"));
  console.log("    kept back:");
  for (const s of r.secrets) console.log("      🔒 " + s);

  const leaked = r.secrets.filter((s) => r.body.includes(s));
  console.log(`\n    SECRETS ON SCREEN: ${r.leak.length + leaked.length === 0 ? "none, over " + r.samples + " sampled frames ✓" : "*** LEAK *** " + JSON.stringify(r.leak.concat(leaked))}`);
  console.log(`    ledger valid: ${r.valid ? "yes" : "NO"} · page errors: ${page.__errors.length}`);
  console.log("\n    scene one opens:  " + r.scene.replace(/^===CHAPTER===\n[^\n]*\n/, "").trim().slice(0, 180).replace(/\n/g, " ") + "…");

  await page.close();
  return { at: { firstByte: at("firstByte"), firstName: at("firstName"), seedDone: at("seedDone"), firstWord: at("firstWord"), total: tEnd - t0 },
           ok: r.valid && r.leak.length + leaked.length === 0 && page.__errors.length === 0 };
}

const srv = await serve();
const puppeteer = createRequire(path.join(ROOT, "tools/_probe-storyworld.mjs"))("puppeteer-core");
const browser = await puppeteer.launch({
  channel: "chrome", headless: "new",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
console.log("=".repeat(84));
console.log("WORLD-CREATION WAIT — LIVE, against real Fable + real Grok");
console.log("=".repeat(84));
const results = [];
try {
  for (let i = 0; i < RUNS; i++) results.push(await oneRun(browser, i));
} finally {
  await browser.close();
  srv.close();
}
if (RUNS > 1) {
  const avg = (k) => Math.round(results.reduce((s, r) => s + (r.at[k] || 0), 0) / results.length);
  console.log("\n" + "=".repeat(84));
  console.log("AVERAGE OVER " + RUNS + " RUNS");
  for (const k of ["firstByte", "firstName", "seedDone", "firstWord", "total"]) {
    console.log("      " + k.padEnd(34) + ms(avg(k)));
  }
}
console.log("\n" + (results.every((r) => r.ok) ? "ALL RUNS CLEAN ✓" : "*** A RUN FAILED ***"));
process.exit(results.every((r) => r.ok) ? 0 : 1);
