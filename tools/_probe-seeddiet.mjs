#!/usr/bin/env node
/**
 * SEED LATENCY — live measurement of the world-builder's own request.
 *
 *   node tools/_probe-seeddiet.mjs [--models fable,opus] [--cases httyd,original] [--runs 1]
 *
 * Why this exists: the HTTYD seed was measured at 63.6s to its first byte and 86s to done, past
 * the client's 75s abort, so every HTTYD story seeded nothing. This probe isolates the seed —
 * no narrator, no page — and reports, per run: model first byte, completion, input/output tokens
 * (Anthropic's own usage, not an estimate), dollars, whether the seed VALIDATES and MERGES into
 * the pack, the era chosen, thread/secret counts, and the statuses the merged ledger ends up with
 * for Stoick and Hiccup (the era's own tell).
 *
 * The pack ledger is built by the REAL page (puppeteer, __STORY__) once and cached, so every
 * timed run posts exactly the bytes the browser would post. Firestore is a local fake; no user is
 * sent, so nothing touches the family's Story Log, usage docs, or anyone's daily cap.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = 8797;
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

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const MODELS = String(argOf("--models", "fable")).split(",").filter(Boolean);
const CASES = String(argOf("--cases", "httyd,original")).split(",").filter(Boolean);
const RUNS = Math.max(1, +argOf("--runs", 1) || 1);
const MODEL_IDS = { fable: "claude-fable-5", opus: "claude-opus-5" };
// $/Mtok — in/out. Keep in step with the API's published prices.
const PRICE = { "claude-fable-5": [3, 15], "claude-opus-5": [5, 25] };

// ---- what the seeder is actually asked to build ------------------------------------------
const SETUPS = {
  httyd: {
    universe: "httyd",
    setup: "A How to Train Your Dragon story set after the third movie, when the dragons have gone " +
      "to the Hidden World and Hiccup is Chief of New Berk. I want to find a dragon nobody thought " +
      "was still around. My name is Wren.",
    heroName: "Wren",
  },
  original: {
    universe: "original",
    setup: "A story about a girl who finds a door in the back of her grandmother's barn that only " +
      "opens when it rains. My name is Wren.",
    heroName: "Wren",
  },
};

// ---- the local wrapper: the real function, a fake Firestore, the real static files ---------
const handler = (await import("file:///" + path.join(ROOT, "netlify/functions/farmgpt.mjs").replace(/\\/g, "/"))).default;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml",
  ".webmanifest": "application/json" };

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

// ---- the upstream tap ---------------------------------------------------------------------
// The seeder's own request to Anthropic, intercepted in-process: the exact user turn it sends
// (so the input can be counted and INSPECTED), and the usage the API reports back. A clone of
// the response is read in parallel, so the tap never changes what the function itself sees.
const realFetch = globalThis.fetch;
let tap = null;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input && input.url) || "";
  if (tap && /api\.anthropic\.com\/v1\/messages/.test(url) && init && typeof init.body === "string") {
    try { tap.req = JSON.parse(init.body); } catch { tap.req = null; }
    const resp = await realFetch(input, init);
    const t = tap;
    resp.clone().text().then((txt) => {
      // SSE: usage rides message_start (input) and message_delta (final output).
      for (const line of txt.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        let ev = null; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        const u = (ev && ev.usage) || (ev && ev.message && ev.message.usage);
        if (!u) continue;
        if (u.input_tokens != null) t.inTok = u.input_tokens;
        if (u.output_tokens != null) t.outTok = u.output_tokens;
      }
    }).catch(() => {});
    return resp;
  }
  return realFetch(input, init);
};

// ---- the pack ledger, built by the real page ----------------------------------------------
const CACHE = path.join(HERE, "_seeddiet_base.json");
async function baseLedgers() {
  if (fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new",
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/farmgpt.html`, { waitUntil: "networkidle2" });
  const out = await page.evaluate(async (SETUPS) => {
    const S = window.__STORY__;
    await S.primeUniversePacks();
    const res = {};
    for (const key of Object.keys(SETUPS)) {
      const c = SETUPS[key];
      let pack = null;
      if (c.universe !== "original") pack = (await S.loadUniversePack(c.universe)).pack;
      const era = pack ? S.pickEra(pack, c.setup) : "";
      const eras = S.packEras(pack).map((e) => ({ id: e.id, label: e.label, timeline_point: e.timeline_point }));
      const led = S.seedLedger({ title: "probe", universe: pack ? c.universe : "original",
        genre: "adventure", heroName: c.heroName, pack, era });
      res[key] = { ledger: led, era, eras, hasPack: !!pack };
    }
    return res;
  }, SETUPS);
  await browser.close();
  fs.writeFileSync(CACHE, JSON.stringify(out, null, 1));
  return out;
}

// ---- one timed seed ------------------------------------------------------------------------
async function runSeed(caseKey, base, modelKey) {
  const c = SETUPS[caseKey];
  process.env.STORY_SEED_MODEL = MODEL_IDS[modelKey];
  tap = { req: null, inTok: null, outTok: null };
  const t0 = Date.now();
  let firstByte = null, raw = "";
  const resp = await realFetch(`http://127.0.0.1:${PORT}/.netlify/functions/farmgpt`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: SECRET, mode: "storyseed",
      setup: c.setup, heroName: c.heroName,
      packLedger: base.hasPack ? base.ledger : null,
      era: base.era, eras: base.eras }),
  });
  const rd = resp.body.getReader(); const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    raw += chunk;
    // The heartbeat is whitespace; the model's own first byte is the first non-blank one.
    if (firstByte === null && raw.trim()) firstByte = Date.now() - t0;
  }
  const doneMs = Date.now() - t0;
  const sent = tap.req && tap.req.messages && tap.req.messages[0] ? String(tap.req.messages[0].content) : "";
  const usage = { inTok: tap.inTok, outTok: tap.outTok };
  const price = PRICE[MODEL_IDS[modelKey]] || [0, 0];
  const cost = ((usage.inTok || 0) / 1e6) * price[0] + ((usage.outTok || 0) / 1e6) * price[1];
  return { raw, sent, firstByte, doneMs, usage, cost };
}

// ---- merge the seed the way the browser does, and read the result --------------------------
async function mergeInPage(caseKey, base, raw) {
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new",
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/farmgpt.html`, { waitUntil: "networkidle2" });
  const out = await page.evaluate(async (arg) => {
    const S = window.__STORY__;
    await S.primeUniversePacks();
    const c = arg.setup;
    let pack = null;
    if (arg.hasPack) pack = (await S.loadUniversePack(arg.universe)).pack;
    const patch = S.parseKeeperJSON(arg.raw);
    if (!patch) return { ok: false, why: "unparseable" };
    const chosen = patch && typeof patch.era === "string" ? patch.era.trim() : "";
    let led = arg.ledger;
    if (chosen && chosen !== arg.era && pack && arg.eras.some((e) => e.id === chosen)) {
      led = S.seedLedger({ title: "probe", universe: arg.universe, genre: "adventure",
        heroName: arg.heroName, pack, era: chosen });
    }
    if (arg.hasPack && patch.meta && typeof patch.meta === "object") delete patch.meta.timeline_point;
    const diff = S.seedPatchToDiff(patch);
    if (!diff) return { ok: false, why: "empty", chosen };
    const res = S.applyLedgerDiff(led, diff);
    if (!res.ok) return { ok: false, why: res.reason, chosen };
    const L = res.ledger;
    const find = (n) => (L.characters || []).concat(L.roster || [])
      .find((x) => x && typeof x.name === "string" && x.name.toLowerCase().includes(n));
    const sheetOf = (x) => (x ? { name: x.name, status: x.status || "",
      hasVoice: !!x.voice, hasKnows: Array.isArray(x.knows) && x.knows.length > 0 } : null);
    return {
      ok: true, chosen: chosen || arg.era,
      timeline_point: (L.meta || {}).timeline_point || "",
      threads: (L.open_threads || []).length,
      secrets: ((L.player_knowledge || {}).hidden_from_player || []).length,
      chars: (L.characters || []).length, roster: (L.roster || []).length,
      canon: (L.canon || []).length,
      newNames: (patch.characters || []).map((x) => x && x.name).filter(Boolean),
      hiccup: sheetOf(find("hiccup")), stoick: sheetOf(find("stoick")),
      valid: S.validateLedger(L).ok !== false,
    };
  }, { ...base, universe: SETUPS[caseKey].universe, heroName: SETUPS[caseKey].heroName,
       setup: SETUPS[caseKey].setup, raw });
  await browser.close();
  return out;
}

// ---- go --------------------------------------------------------------------------------------
const bases = await baseLedgers();
if (argv.includes("--base-only")) {
  console.log("base ledgers cached:", Object.keys(bases).map((k) =>
    k + " (era " + bases[k].era + ", " + (bases[k].ledger.characters || []).length + " chars, " +
    (bases[k].ledger.canon || []).length + " canon)").join(" · "));
  srv.close(); process.exit(0);
}
const rows = [];
for (const caseKey of CASES) {
  for (const modelKey of MODELS) {
    for (let i = 0; i < RUNS; i++) {
      const r = await runSeed(caseKey, bases[caseKey], modelKey);
      const m = await mergeInPage(caseKey, bases[caseKey], r.raw);
      rows.push({ caseKey, modelKey, run: i + 1, ...r, merged: m });
      const dump = path.join(HERE, `_seeddiet_sent_${caseKey}.txt`);
      if (!fs.existsSync(dump)) fs.writeFileSync(dump, r.sent);
      console.log(`\n=== ${caseKey} · ${MODEL_IDS[modelKey]} · run ${i + 1}`);
      console.log(`  first byte ${(r.firstByte / 1000).toFixed(1)}s · done ${(r.doneMs / 1000).toFixed(1)}s`);
      console.log(`  tokens in ${r.usage.inTok} out ${r.usage.outTok} · $${r.cost.toFixed(4)}`);
      console.log(`  merged: ${JSON.stringify(m)}`);
    }
  }
}
fs.writeFileSync(path.join(HERE, "_seeddiet_last.json"), JSON.stringify(rows, null, 1));
console.log("\n---- summary");
for (const r of rows) {
  console.log([r.caseKey, MODEL_IDS[r.modelKey], "run" + r.run,
    (r.firstByte / 1000).toFixed(1) + "s", (r.doneMs / 1000).toFixed(1) + "s",
    r.usage.inTok + "in", r.usage.outTok + "out", "$" + r.cost.toFixed(4),
    r.merged.ok ? "OK" : "FAIL:" + r.merged.why, r.merged.chosen,
    (r.merged.threads || 0) + "thr", (r.merged.secrets || 0) + "sec"].join(" · "));
}
srv.close();
process.exit(0);
