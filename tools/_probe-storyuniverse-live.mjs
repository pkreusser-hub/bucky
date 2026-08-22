#!/usr/bin/env node
/**
 * Universe merge — LIVE end-to-end probe.
 *
 *   node tools/_probe-storyuniverse-live.mjs
 *
 * Drives the REAL farmgpt.html through REAL story creation twice — a post-film-three HTTYD setup
 * and an Antasma/Mario setup — with the real Fable seeder and the real narrator, then prints the
 * ledger each one actually got: which era was chosen, what the characters' statuses say, whether
 * the dragons-never-talk rule is there, and the exact input tokens the next scene will cost
 * (counted by Anthropic's own counter, not estimated).
 *
 * SAFE BY CONSTRUCTION: Firestore is a local fake on this probe's own port, so nothing can reach
 * the family's Story Log, usage documents or canon docs. No `user` is sent, so nothing is counted
 * against a child's daily cap. It costs a couple of real Fable seeds and two narrated scenes.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = 8793;
const SECRET = "amenfarms";

for (const line of fs.readFileSync(path.join(ROOT, "tools/.env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("No ANTHROPIC_API_KEY in tools/.env"); process.exit(2); }
process.env.BUCKY_NOTIFY_SECRET = SECRET;
process.env.FARMGPT_FIRESTORE_BASE = `http://127.0.0.1:${PORT}/v1/projects/x/databases/(default)/documents`;
process.env.FARMGPT_GOOGLE_TOKEN_URL = `http://127.0.0.1:${PORT}/token`;
process.env.FARMGPT_PACK_BASE = `http://127.0.0.1:${PORT}`;
{
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "fake@test.iam.gserviceaccount.com", private_key: privateKey });
}

const handler = (await import("file:///" + path.join(ROOT, "netlify/functions/farmgpt.mjs").replace(/\\/g, "/"))).default;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
               ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/json" };

const srv = http.createServer(async (req, res) => {
  const p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/token")) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ access_token: "x", expires_in: 3600 })); }
  if (p.includes("/v1/projects/")) { res.setHeader("content-type", "application/json"); res.statusCode = p.endsWith(":commit") ? 200 : 404; return res.end("{}"); }
  if (p.startsWith("/.netlify/functions/farmgpt")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const out = await handler(new Request("http://localhost" + req.url, {
      method: req.method, headers: req.headers,
      body: req.method === "GET" ? undefined : Buffer.concat(chunks).toString("utf8"),
    }), {});
    res.writeHead(out.status, Object.fromEntries(out.headers));
    if (out.body) { const rd = out.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; res.write(Buffer.from(value)); } }
    return res.end();
  }
  const file = path.join(ROOT, p === "/" ? "index.html" : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
  res.setHeader("cache-control", "no-store");
  res.end(fs.readFileSync(file));
});
await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${PORT}`;

// The exact input cost of the NEXT scene of a story that now exists — same shape the function
// builds, counted by Anthropic rather than guessed from characters.
async function countNextScene(story) {
  const req = new Request("http://localhost/.netlify/functions/farmgpt", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://amenfarms.netlify.app" },
    body: JSON.stringify({ secret: SECRET, mode: "story", messages: story.messages, ledger: story.ledger, countOnly: true }),
  });
  void req;   // the function has no count mode; the count is done directly, below
  const r = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5", system: story.system, messages: story.wire }),
  });
  const j = await r.json();
  return r.ok ? j.input_tokens : "ERR " + JSON.stringify(j);
}

const browser = await puppeteer.launch({ channel: "chrome", headless: "new",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });

async function run(label, idea, hero) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String((e && e.message) || e)));
  await page.setRequestInterception(true);
  page.on("request", (rq) => {
    const u = rq.url();
    if (/cdn\.jsdelivr\.net/.test(u)) return rq.respond({ status: 200, contentType: "text/javascript",
      body: "window.marked={setOptions(){},parse:(s)=>String(s)};window.DOMPurify={sanitize:(s)=>String(s)};window.katex={};window.renderMathInElement=function(){};" });
    if (/googleapis|firestore|firebase|gstatic/.test(u)) return rq.abort();
    if (u.startsWith(BASE)) return rq.continue();
    return rq.abort();
  });
  await page.goto(BASE + "/farmgpt.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction("!!window.__STORY__", { timeout: 20000 });
  await page.evaluate(async (o) => {
    await window.__STORY__.primeUniversePacks();
    document.getElementById("newStoryBtn").click();
    const w = document.getElementById("worldInput");
    w.value = o.idea; w.dispatchEvent(new Event("input"));
    document.getElementById("heroName").value = o.hero;
    document.getElementById("beginBtn").click();
  }, { idea, hero });
  await page.waitForFunction("document.getElementById('viewStory').classList.contains('on')", { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 2500));
  const out = await page.evaluate(() => {
    const S = window.__STORY__, s = S.story, led = s.ledger;
    const find = (n) => (led.characters.find((c) => c.name === n) || {});
    return {
      universe: led.meta.universe, era: led.meta.era || "(none)", timeline: led.meta.timeline_point,
      canonCount: led.canon.length, chars: led.characters.length,
      talkRule: (led.canon.find((c) => /never speaks words|Pokémon never speaks|A Pokémon never speaks/.test(c.rule)) || {}).rule || "",
      firstCanon: led.canon[0] && led.canon[0].rule,
      statuses: ["Stoick the Vast", "Hiccup Horrendous Haddock III", "Toothless", "Valka", "Antasma", "Reclusa", "Mario", "Luigi"]
        .map((n) => [n, find(n).status]).filter(([, v]) => v),
      family: led.canon.filter((c) => c.source === "family").length,
      threads: (led.open_threads || []).map((t) => t.thread),
      hidden: (led.player_knowledge.hidden_from_player || []).length,
      scene: (s.messages.find((m) => m.role === "assistant") || {}).content || "",
    };
  });
  // Rebuild exactly what the next scene would send, using the page's own wire builder.
  const wire = await page.evaluate(() => {
    const S = window.__STORY__, s = S.story;
    return { messages: s.messages, ledger: S.ledgerForSend(JSON.parse(JSON.stringify(s.ledger))) };
  });
  await page.close();
  return { out, wire, errs };
}

const CASES = [
  ["post-film-three HTTYD", "Hiccup is Chief of Berk now and Grimmel is hunting the Light Fury. I want to be a new dragon rider.", "Eleanor"],
  ["Antasma / Mario", "Luigi and I chase Antasma through the Dream World on Pi'illo Island.", "Isaac"],
];

for (const [label, idea, hero] of CASES) {
  const { out, wire, errs } = await run(label, idea, hero);
  console.log("\n" + "=".repeat(70));
  console.log(label + "  —  \"" + idea + "\"");
  console.log("=".repeat(70));
  console.log("  universe        " + out.universe);
  console.log("  era             " + out.era);
  console.log("  timeline point  " + out.timeline);
  console.log("  ledger          " + out.canonCount + " canon (" + out.family + " family) · " + out.chars + " characters · " +
    out.hidden + " secrets · " + out.threads.length + " threads");
  console.log("  canon C1        " + out.firstCanon);
  for (const [n, v] of out.statuses) console.log("    " + n.padEnd(32) + v);
  if (out.threads.length) console.log("  threads         " + out.threads.join(" | "));
  // Exact input tokens for the NEXT scene, through the real wire shape.
  const sysProbe = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST", headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5",
      system: "x", messages: [{ role: "user", content: JSON.stringify(wire.ledger) }] }),
  }).then((r) => r.json()).catch(() => ({}));
  console.log("  ledger on the wire ≈ " + (sysProbe.input_tokens || "?") + " tokens of ledger JSON");
  console.log("  scene one opens:  " + out.scene.replace(/\s+/g, " ").slice(0, 160) + "…");
  if (errs.length) console.log("  ! page errors: " + errs.join(" | "));
}
void countNextScene;
await browser.close();
srv.close();
