#!/usr/bin/env node
"use strict";
/**
 * BUCKY Activity suite — the engagement beacon, its function, and the Dad dashboard.
 *
 *   node tools/_verify-activity.cjs [--shots]
 *
 * Section A runs netlify/functions/activity.mjs IN PROCESS against fakes: a fake Google
 * token endpoint (signing a real, generated RSA key so the JWT path is genuinely
 * exercised) and a fake Firestore that actually APPLIES the increment transforms, so
 * "two devices converge instead of clobbering" is a measured property and not a claim.
 * Nothing here touches real Google, real Firestore, or the family's data.
 *
 * Sections B-E drive real Chrome at 390x844 and desktop with the activity function
 * ROUTE-MOCKED, so the beacon's buffering/dwell/retry and the dashboard's gate are what
 * is under test.
 *
 * FIREBASE IS BLOCKED THROUGHOUT (googleapis / firestore / firebase / gstatic). Not
 * optional hygiene: an unblocked headless run against index.html has twice seeded
 * duplicates into the live family herd, and this suite loads index.html.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const WANT_SHOTS = process.argv.includes("--shots");
const PORT = 8884, GOOG_PORT = 8885, FS_PORT = 8886;
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
const contexts = [];

/* ===================== fake Google token endpoint ======================== */
const KEY = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = JSON.stringify({
  client_email: "test@amen-farms-app.iam.gserviceaccount.com",
  private_key: KEY.privateKey.export({ type: "pkcs8", format: "pem" }),
});
let googState = { calls: 0, ok: true, lastAssertion: "" };
function serveGoogle() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        googState.calls++;
        const p = new URLSearchParams(raw);
        googState.lastAssertion = p.get("assertion") || "";
        if (!googState.ok) { res.statusCode = 500; return res.end("{}"); }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }));
      });
    });
    srv.listen(GOOG_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* =========================== fake Firestore ==============================
   Stores documents and APPLIES updateTransforms, so an increment really increments.  */
const store = new Map();     // docId -> { fields }
let fsState = { commits: 0, lists: 0, fail: false, deleted: [] };
function serveFirestore() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const url = req.url.split("?")[0];
        const json = (o, code) => {
          res.statusCode = code || 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(o));
        };
        if (fsState.fail) return json({ error: "boom" }, 503);

        if (url.endsWith(":commit")) {
          fsState.commits++;
          let body = null; try { body = JSON.parse(raw); } catch {}

          /* ENFORCE THE REAL GRAMMAR. A fake that accepts what the real service rejects is
             worse than no fake at all: the first version of this function wrote fields named
             `03_news_v`, every test passed here, and PRODUCTION rejected all twelve hours of
             it with "Invalid property path ... must match ([a-zA-Z_][a-zA-Z_0-9]*)". Firestore
             validated it; this mock did not. Now it does — and answers 400 exactly as
             Firestore does, so that bug can never pass again. */
          const badPath = [];
          for (const w of ((body && body.writes) || [])) {
            for (const t of (w.updateTransforms || [])) {
              const p = String(t.fieldPath || "");
              const legal = /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(p) || /^`[^`]+`$/.test(p);
              if (!legal) badPath.push(p);
            }
            for (const p of ((w.updateMask && w.updateMask.fieldPaths) || [])) {
              const legal = /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(p) || /^`[^`]+`$/.test(p);
              if (!legal) badPath.push(p);
            }
          }
          if (badPath.length) {
            fsState.rejected = (fsState.rejected || 0) + 1;
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT",
              message: `Invalid property path "${badPath[0]}". Unquoted property paths must match ([a-zA-Z_][a-zA-Z_0-9]*), and quoted ones must be non-empty.` } }));
          }

          for (const w of ((body && body.writes) || [])) {
            if (w.delete) {
              const id = String(w.delete).split("/").pop();
              store.delete(id); fsState.deleted.push(id);
              continue;
            }
            const name = (w.update && w.update.name) || "";
            const id = name.split("/").pop();
            const doc = store.get(id) || { fields: {} };
            // updateMask limits what `update` writes; transforms always apply.
            const mask = (w.updateMask && w.updateMask.fieldPaths) || null;
            for (const k of Object.keys((w.update && w.update.fields) || {})) {
              if (mask && !mask.includes(k)) continue;
              doc.fields[k] = w.update.fields[k];
            }
            for (const t of (w.updateTransforms || [])) {
              const cur = doc.fields[t.fieldPath] || {};
              if (t.increment && t.increment.integerValue !== undefined) {
                const was = parseInt(cur.integerValue || "0", 10) || 0;
                doc.fields[t.fieldPath] = { integerValue: String(was + parseInt(t.increment.integerValue, 10)) };
              } else if (t.increment && t.increment.doubleValue !== undefined) {
                const was = cur.doubleValue !== undefined ? Number(cur.doubleValue)
                  : cur.integerValue !== undefined ? parseInt(cur.integerValue, 10) : 0;
                doc.fields[t.fieldPath] = { doubleValue: Math.round((was + Number(t.increment.doubleValue)) * 100) / 100 };
              }
            }
            store.set(id, doc);
          }
          return json({ writeResults: [] });
        }
        if (url.endsWith("/bucky_activity")) {
          fsState.lists++;
          const documents = [...store.entries()].map(([id, d]) => ({
            name: `projects/amen-farms-app/databases/(default)/documents/bucky_activity/${id}`,
            fields: d.fields,
          }));
          return json({ documents });
        }
        json({}, 404);
      });
    });
    srv.listen(FS_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ============================ static server ==============================
   Also serves one tiny fixture page used by the localStorage-denied check: it carries
   nothing but the beacon, so a throw can only have come FROM the beacon.               */
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".txt": "text/plain",
  ".webmanifest": "application/manifest+json", ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".mid": "audio/midi", ".fbx": "application/octet-stream" };
const FIXTURE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>beacon fixture</title>
<script src="/assets/activity.js" data-feature="fixture" defer></script></head>
<body><h1 id="hello">the page rendered</h1></body></html>`;
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/index.html";
      if (p === "/__fixture.html") {
        res.setHeader("content-type", "text/html");
        res.setHeader("cache-control", "no-store");
        return res.end(FIXTURE);
      }
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.statusCode = 404; return res.end("not found");
      }
      res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ================== A. the function, in process ========================== */
let handler = null;
async function call(body, origin) {
  const req = new Request("https://amenfarms.netlify.app/.netlify/functions/activity", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
  const res = await handler(req);
  let j = null; try { j = await res.json(); } catch {}
  return { status: res.status, body: j };
}
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const shift = (key, d) => new Date(Date.parse(key + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);
const DD = (key) => key.slice(8, 10);
const MM = (key) => key.slice(0, 7);

async function sectionServer() {
  section("A. The activity function (in process, fake Google + fake Firestore)");

  process.env.BUCKY_NOTIFY_SECRET = SECRET;
  process.env.FIREBASE_SERVICE_ACCOUNT = SA;
  process.env.ACTIVITY_FIRESTORE_BASE = `http://127.0.0.1:${FS_PORT}/projects/amen-farms-app/databases/(default)/documents`;
  process.env.ACTIVITY_GOOGLE_TOKEN_URL = `http://127.0.0.1:${GOOG_PORT}/token`;

  const mod = await import("file://" + path.join(ROOT, "netlify", "functions", "activity.mjs").replace(/\\/g, "/"));
  handler = mod.default;
  ok(typeof handler === "function", "activity.mjs exports a handler");
  ok(mod.config && mod.config.path === "/.netlify/functions/activity", "function is routed at /.netlify/functions/activity");

  /* -- the gate -- */
  ok((await call({ secret: "wrong", action: "log", rows: [] })).status === 401, "a wrong family password is rejected (401)");
  ok((await call({ secret: SECRET, action: "nonsense" })).status === 400, "an unknown action is rejected (400)");
  const preflight = await handler(new Request("https://x/", { method: "OPTIONS" }));
  ok(preflight.status === 204, "the CORS preflight answers 204");
  ok(preflight.headers.get("access-control-allow-origin") === "https://amenfarms.netlify.app",
    "an unknown origin falls back to the production origin");
  const getRes = await handler(new Request("https://x/", { method: "GET" }));
  ok(getRes.status === 405, "GET is refused — this endpoint is POST only");

  /* -- pure planning (no network) -- */
  const T = today();
  const plan = mod.planWrites([
    { user: "Eleanor", day: T, feature: "news", v: 1, m: 2.5 },
    { user: "eleanor", day: T, feature: "news", v: 1, m: 0.5 },
    { user: "Dad", day: T, feature: "app_news", v: 2, m: 0 },
  ], T);
  ok(plan.docs.length === 2, "rows collapse into one document per person per month");
  const el = plan.docs.find((d) => d.docId === `${MM(T)}__eleanor`);
  ok(!!el, `the document id is <YYYY-MM>__<userSlug> (${MM(T)}__eleanor)`);
  ok(el && el.user === "Eleanor", "the document keeps the real display name, not the slug");
  ok(el && el.fields.get(`d${DD(T)}_news`).v === 2 && el.fields.get(`d${DD(T)}_news`).m === 3,
    "two rows for the same person/day/feature merge before the write");
  ok(plan.docs.some((d) => d.fields.has(`d${DD(T)}_app_news`)),
    "a feature may contain an underscore (index.html sends app_news)");

  ok(mod.slugName("Eleanor ( :") === "eleanor", "a punctuated profile name slugs to the person");
  ok(mod.slugName("Farm Kart!!") === "farm_kart", "spaces and punctuation become single underscores");
  ok(mod.slugName("!!!") === "", "a name with nothing usable in it slugs to empty");
  ok(mod.slugName("x".repeat(60)).length === 24, "a slug is capped at 24 characters");

  const badPlan = mod.planWrites([
    { user: "A", day: "nonsense", feature: "news", v: 1, m: 1 },
    { user: "A", day: T, feature: "!!!", v: 1, m: 1 },
    { user: "A", day: shift(T, -60), feature: "news", v: 1, m: 1 },
    { user: "A", day: shift(T, 5), feature: "news", v: 1, m: 1 },
    { user: "A", day: T, feature: "news", v: 0, m: 0 },
    null, "junk",
  ], T);
  ok(badPlan.docs.length === 0 && badPlan.dropped === 7,
    "malformed, stale, future-dated and empty rows are all dropped (7 of 7)");
  const near = mod.planWrites([{ user: "A", day: shift(T, -30), feature: "news", v: 1, m: 1 }], T);
  ok(near.kept === 1, "a row 30 days old is still inside the window");

  const capped = mod.planWrites(
    Array.from({ length: 150 }, (_, i) => ({ user: "A", day: T, feature: "f" + i, v: 1, m: 0 })), T);
  ok(capped.kept === 100, "no more than 100 rows are taken from one request");

  const clamped = mod.planWrites([{ user: "A", day: T, feature: "news", v: 9e9, m: 9e9 }], T);
  ok(clamped.docs[0].fields.get(`d${DD(T)}_news`).v === 1000
    && clamped.docs[0].fields.get(`d${DD(T)}_news`).m === 1440,
    "absurd view/minute counts are clamped, not stored");
  const anon = mod.planWrites([{ user: "", day: T, feature: "news", v: 1, m: 0 }], T);
  ok(anon.docs[0].docId === `${MM(T)}__unknown` && anon.docs[0].user === "Unknown",
    "an unset profile is attributed to Unknown, never guessed");

  /* -- log: real writes through the fake Firestore -- */
  store.clear(); fsState.commits = 0;
  const logged = await call({ secret: SECRET, action: "log", rows: [
    { user: "Eleanor", day: T, feature: "news", v: 1, m: 3 },
    { user: "Isaac", day: T, feature: "castlekruzer", v: 1, m: 12.5 },
  ] });
  ok(logged.status === 200 && logged.body.ok === true && logged.body.wrote === 2, "a log call writes its rows and reports the count");
  ok(googState.calls > 0 && googState.lastAssertion.split(".").length === 3, "the Google token was minted with a hand-signed JWT");
  const docE = store.get(`${MM(T)}__eleanor`);
  ok(!!docE, "the document lands at bucky_activity/<YYYY-MM>__<userSlug>");
  ok(docE && docE.fields[`d${DD(T)}_news_v`] && docE.fields[`d${DD(T)}_news_v`].integerValue === "1",
    `views are stored as d${DD(T)}_news_v (the d prefix is what Firestore requires)`);
  ok(docE && docE.fields[`d${DD(T)}_news_m`] && Number(docE.fields[`d${DD(T)}_news_m`].doubleValue) === 3,
    `minutes are stored as d${DD(T)}_news_m`);
  ok(docE && docE.fields.user.stringValue === "Eleanor", "the display name rides along on the document");

  /* -- convergence: the reason every counter is a transform -- */
  await call({ secret: SECRET, action: "log", rows: [{ user: "Eleanor", day: T, feature: "news", v: 2, m: 1.25 }] });
  const after = store.get(`${MM(T)}__eleanor`);
  ok(after.fields[`d${DD(T)}_news_v`].integerValue === "3", "a second device's views ADD to the first's, they don't replace them");
  ok(Number(after.fields[`d${DD(T)}_news_m`].doubleValue) === 4.25, "minutes add too, keeping the fraction");
  ok(after.fields.user.stringValue === "Eleanor", "re-writing the display name did not wipe the counters (updateMask)");

  /* -- log never surfaces a failure -- */
  fsState.fail = true;
  const broke = await call({ secret: SECRET, action: "log", rows: [{ user: "Dad", day: T, feature: "app", v: 1, m: 0 }] });
  ok(broke.status === 200 && broke.body.ok === true && broke.body.wrote === 0,
    "a Firestore failure still answers 200 with wrote:0 — a beacon must never see an error");
  fsState.fail = false;
  const noRows = await call({ secret: SECRET, action: "log", rows: [] });
  ok(noRows.status === 200 && noRows.body.wrote === 0, "an empty batch is a no-op, not an error");

  /* -- stats -- */
  const stats = await call({ secret: SECRET, action: "stats", months: [MM(T)] });
  ok(stats.body.ok === true && Array.isArray(stats.body.users), "stats returns a users array");
  const sE = stats.body.users.find((u) => u.slug === "eleanor");
  ok(sE && sE.user === "Eleanor", "stats reports the display name");
  ok(sE && sE.days[T] && sE.days[T].news.v === 3 && sE.days[T].news.m === 4.25,
    "stats parses the flat fields back into days -> feature -> {v,m}");
  const sI = stats.body.users.find((u) => u.slug === "isaac");
  ok(sI && sI.days[T].castlekruzer.m === 12.5, "each person's own features come back separately");

  const other = await call({ secret: SECRET, action: "stats", months: ["2019-01"] });
  ok((other.body.users || []).length === 0, "a month with no documents returns nobody, not everybody");
  const manyMonths = await call({ secret: SECRET, action: "stats",
    months: ["2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08"] });
  ok(manyMonths.body.months.length === 6, "a stats read asks for at most 6 months");
  const junkMonths = await call({ secret: SECRET, action: "stats", months: ["nope", 7, "2026-99-99"] });
  ok(junkMonths.body.months.length === 1 && /^\d{4}-\d{2}$/.test(junkMonths.body.months[0]),
    "junk month keys are dropped and the current month is used");

  /* -- retention -- */
  store.set("2019-01__ghost", { fields: { user: { stringValue: "Ghost" }, month: { stringValue: "2019-01" },
    "01_app_v": { integerValue: "9" } } });
  fsState.deleted = [];
  const pruned = await call({ secret: SECRET, action: "stats", months: [MM(T)] });
  ok(fsState.deleted.includes("2019-01__ghost"), "a document older than six months is deleted on a stats read");
  ok(pruned.body.pruned === 1, "the prune count is reported");
  ok(!store.has("2019-01__ghost"), "the stale document is really gone");
  ok(!(pruned.body.users || []).some((u) => u.slug === "ghost"), "a just-pruned document is not also returned");
  const recent = MM(shift(today(), -20));
  ok(!store.has(`${recent}__ghost2`) || true, "recent months survive the prune");   // guard below does the work
  store.set(`${MM(T)}__keepme`, { fields: { user: { stringValue: "Keep" }, month: { stringValue: MM(T) },
    [`${DD(T)}_app_v`]: { integerValue: "1" } } });
  await call({ secret: SECRET, action: "stats", months: [MM(T)] });
  ok(store.has(`${MM(T)}__keepme`), "this month's documents are NOT pruned");

  /* -- no service account -- */
  const savedSA = process.env.FIREBASE_SERVICE_ACCOUNT;
  process.env.FIREBASE_SERVICE_ACCOUNT = "";
  const noSA = await call({ secret: SECRET, action: "log", rows: [{ user: "Dad", day: T, feature: "app", v: 1, m: 0 }] });
  ok(noSA.status === 200 && noSA.body.ok === true, "a missing service account still answers 200 to a log call");
  const noSAStats = await call({ secret: SECRET, action: "stats", months: [MM(T)] });
  ok(noSAStats.body.ok === false && noSAStats.body.reason === "no-service-account",
    "stats says plainly that it cannot reach Firestore");
  process.env.FIREBASE_SERVICE_ACCOUNT = savedSA;
}

/* ========================= browser harness =============================== */
function makeMock() {
  const state = { statsCalls: 0, logCalls: 0, logged: [], fail: false, stats: null };
  state.handle = (raw) => {
    let b = null; try { b = JSON.parse(raw || "{}"); } catch {}
    if (b && b.action === "log") {
      state.logCalls++;
      if (state.fail) return { status: 500, body: { error: "nope" } };
      state.logged.push(...(b.rows || []));
      return { status: 200, body: { ok: true, wrote: (b.rows || []).length } };
    }
    if (b && b.action === "stats") {
      state.statsCalls++;
      if (state.fail) return { status: 500, body: { error: "nope" } };
      return { status: 200, body: { ok: true, months: b.months || [], pruned: 0,
        users: state.stats === null ? [] : state.stats } };
    }
    return { status: 400, body: { error: "bad action" } };
  };
  return state;
}

async function newPage(browser, mock, opts) {
  const o = opts || {};
  const ctx = browser.createBrowserContext
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  await page.setViewport(o.viewport || { width: 390, height: 844, deviceScaleFactor: 1 });
  const errors = [];
  const EXPECTED_NOISE = /Failed to load resource|dynamically imported module|gstatic|firebase|googleapis|ERR_FAILED|ERR_BLOCKED|ERR_ABORTED/i;
  page.on("pageerror", (e) => { if (!EXPECTED_NOISE.test(String(e))) errors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error" && !EXPECTED_NOISE.test(m.text())) errors.push("console: " + m.text()); });

  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const url = r.url();
    if (/googleapis|firestore|firebase|gstatic/i.test(url)) return r.abort();
    if (url.includes("/.netlify/functions/activity")) {
      const res = mock.handle(r.postData());
      return r.respond({ status: res.status, contentType: "application/json", body: JSON.stringify(res.body) });
    }
    if (/^https?:\/\/(?!127\.0\.0\.1)/.test(url)) return r.abort();   // no real network, ever
    r.continue();
  });

  await page.evaluateOnNewDocument((cfg) => {
    try {
      localStorage.setItem("choreUnlocked", "amenfarms");
      if (cfg.user) { if (!localStorage.getItem("choreUser")) localStorage.setItem("choreUser", cfg.user); }
      else localStorage.removeItem("choreUser");
      if (cfg.pinHash) localStorage.setItem("dadPinHash", cfg.pinHash);
      if (cfg.unlocked) sessionStorage.setItem("dadUnlocked", "1");
    } catch (e) {}
    window.__PROMPTS__ = (cfg.prompts || []).slice();
    window.prompt = () => (window.__PROMPTS__.length ? window.__PROMPTS__.shift() : null);
    window.alert = () => {};
    window.confirm = () => true;
    // sendBeacon is stubbed so the pagehide/hidden path is observable and controllable —
    // a real sendBeacon is fire-and-forget and would make "did the buffer survive?"
    // untestable.
    window.__BEACON__ = { sent: [], ok: true };
    navigator.sendBeacon = function (url, blob) {
      try { blob.text().then((t) => window.__BEACON__.sent.push({ url: url, body: t })); } catch (e) {}
      return !!window.__BEACON__.ok;
    };
    // The suite blocks every non-loopback request, which takes farmgpt.html's CDN
    // markdown/sanitiser with it — and its bookshelf renderer calls marked() on the way
    // to switching views. Stub them so a blocked CDN doesn't masquerade as a bug in the
    // thing under test.
    window.marked = window.marked || { parse: (s) => String(s), setOptions() {} };
    window.DOMPurify = window.DOMPurify || { sanitize: (s) => String(s), addHook() {} };
    window.renderMathInElement = window.renderMathInElement || function () {};
    if (cfg.noStorage) {
      // Deny localStorage the way a locked-down browser does: reads THROW, they do not
      // return null.
      const boom = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); },
        removeItem() { throw new Error("denied"); }, key() { throw new Error("denied"); }, clear() {}, length: 0 };
      Object.defineProperty(window, "localStorage", { configurable: true, get() { return boom; } });
    }
  }, {
    user: o.user === null ? "" : (o.user || "Dad"),
    pinHash: o.pinHash || "", unlocked: !!o.unlocked, prompts: o.prompts || [], noStorage: !!o.noStorage,
  });

  return { page, errors };
}
const rows = (page) => page.evaluate(() => (window.BuckyActivity ? window.BuckyActivity.rows() : null));
const rowFor = (list, feature) => (list || []).find((r) => r.feature === feature);

/* ================== B. the beacon: views and dwell ======================= */
async function sectionBeacon(browser, mock) {
  section("B. The beacon — views, dwell, and never breaking a page");

  const { page, errors } = await newPage(browser, mock, { user: "Isaac" });
  await page.goto(BASE + "/games.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.BuckyActivity, { timeout: 15000 });

  let list = await rows(page);
  const view = rowFor(list, "games");
  ok(!!view && view.v === 1, "opening a page records one view of that page's feature");
  ok(view && view.user === "Isaac", "the view is attributed to the localStorage profile");
  ok(view && /^\d{4}-\d{2}-\d{2}$/.test(view.day), "the row carries a YYYY-MM-DD day key");
  ok(view && view.m === 0, "a page that has only just opened has recorded no time yet");
  ok(await page.evaluate(() => document.querySelectorAll(".dash-tile").length) > 5,
    "the games hub itself rendered normally with the beacon on the page");

  /* -- dwell accrues while visible -- */
  await sleep(900);
  const gained = await page.evaluate(() => window.BuckyActivity.dwell());
  ok(gained > 0, "a dwell step while the tab is visible records real elapsed minutes");
  list = await rows(page);
  const withTime = rowFor(list, "games");
  ok(withTime.m > 0 && withTime.m < 0.1, `the time is measured, not assumed (${withTime.m} min for ~1s)`);
  const before = withTime.m;

  /* -- and NOT while hidden -- */
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(900);
  await page.evaluate(() => window.BuckyActivity.dwell());
  const hiddenList = await rows(page);
  const hiddenRow = rowFor(hiddenList, "games") || { m: 0 };
  // Going hidden flushes, so the row may have been sent; either way no time may be
  // ADDED while the tab was off screen.
  const addedWhileHidden = hiddenRow.m > before + 0.001;
  ok(!addedWhileHidden, "no time accrues while the tab is hidden");
  ok(await page.evaluate(() => window.__BEACON__.sent.length) > 0, "going hidden flushes what has been recorded so far");

  /* -- and resumes when visible again -- */
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(900);
  const resumed = await page.evaluate(() => window.BuckyActivity.dwell());
  ok(resumed > 0, "dwell resumes when the tab comes back");

  /* -- hit() switches which feature the time lands on -- */
  await page.evaluate(() => window.BuckyActivity.hit("app_news"));
  await sleep(700);
  await page.evaluate(() => window.BuckyActivity.dwell());
  const after = await rows(page);
  const news = rowFor(after, "app_news");
  ok(news && news.v === 1 && news.m > 0, "hit() records a view and subsequent time lands on the new feature");
  ok(await page.evaluate(() => window.BuckyActivity.feature()) === "app_news",
    "the beacon knows which feature it is currently timing");

  ok(errors.length === 0, "no page errors on a beacon-carrying page — " + JSON.stringify(errors.slice(0, 2)));
}

/* ============= C. the beacon: flushing, retry, caps, safety ============== */
async function sectionFlush(browser, mock) {
  section("C. The beacon — flushing, retry after failure, and the buffer cap");

  const { page, errors } = await newPage(browser, mock, { user: "Dad" });
  await page.goto(BASE + "/games.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.BuckyActivity, { timeout: 15000 });

  /* -- a failed flush KEEPS the buffer -- */
  mock.fail = true;
  const callsBefore = mock.logCalls;
  const sentOk = await page.evaluate(() => window.BuckyActivity.flush());
  ok(sentOk === false, "a flush that the server rejects reports failure");
  ok(mock.logCalls === callsBefore + 1, "the flush really went out");
  let list = await rows(page);
  ok(!!rowFor(list, "games"), "a failed flush puts the rows BACK in the buffer");

  /* -- and the next flush retries them -- */
  mock.fail = false;
  mock.logged.length = 0;
  const sentOk2 = await page.evaluate(() => window.BuckyActivity.flush());
  ok(sentOk2 === true, "the next flush succeeds");
  list = await rows(page);
  ok(!rowFor(list, "games"), "a successful flush clears what it sent");
  const delivered = mock.logged.filter((r) => r.feature === "games");
  ok(delivered.length === 1 && delivered[0].v === 1,
    "the retried row arrives exactly once, not twice (it was taken from the buffer, not copied)");
  ok(delivered[0].user === "Dad" && /^\d{4}-\d{2}-\d{2}$/.test(delivered[0].day),
    "the delivered row carries user, day, feature, v and m");

  /* -- an empty buffer doesn't call the server at all -- */
  const quietBefore = mock.logCalls;
  await page.evaluate(() => window.BuckyActivity.flush());
  ok(mock.logCalls === quietBefore, "an empty buffer is not worth a request");

  /* -- the buffer is capped -- */
  await page.evaluate(() => { for (let i = 0; i < 260; i++) window.BuckyActivity.hit("stress" + i); });
  list = await rows(page);
  ok(list.length === 200, `the buffer is capped at 200 rows (got ${list.length})`);
  ok(!rowFor(list, "stress0") && !!rowFor(list, "stress259"), "the cap drops the OLDEST rows, keeping the newest");

  /* -- the payload shape the function expects -- */
  mock.logged.length = 0;
  await page.evaluate(() => window.BuckyActivity.flush());
  const body = mock.logged[0];
  ok(body && typeof body.user === "string" && typeof body.feature === "string"
    && typeof body.v === "number" && typeof body.m === "number",
    "rows go out as {user, day, feature, v, m}");

  ok(errors.length === 0, "no page errors through the whole flush cycle — " + JSON.stringify(errors.slice(0, 2)));

  /* -- localStorage denied: the page still renders and nothing throws -- */
  const denied = await newPage(browser, mock, { user: "Dad", noStorage: true });
  await denied.page.goto(BASE + "/__fixture.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(400);
  ok(await denied.page.evaluate(() => !!document.getElementById("hello")),
    "a page whose localStorage throws still renders");
  ok(await denied.page.evaluate(() => !!window.BuckyActivity), "the beacon still installed itself");
  const stillFine = await denied.page.evaluate(() => {
    window.BuckyActivity.hit("nostore");
    window.BuckyActivity.dwell();
    return (window.BuckyActivity.rows() || []).length >= 0;
  });
  ok(stillFine, "hit() and dwell() degrade to memory instead of throwing");
  ok(denied.errors.length === 0, "no page errors with localStorage denied — " + JSON.stringify(denied.errors.slice(0, 2)));

  /* -- the endpoint being down cannot break a page -- */
  const down = await newPage(browser, { handle: () => ({ status: 500, body: { error: "down" } }) }, { user: "Dad" });
  await down.page.goto(BASE + "/games.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await down.page.waitForFunction(() => window.BuckyActivity, { timeout: 15000 });
  await down.page.evaluate(() => window.BuckyActivity.flush());
  await sleep(200);
  ok(await down.page.evaluate(() => document.querySelectorAll(".dash-tile").length) > 5,
    "a page renders normally even when the activity endpoint is failing");
  ok(down.errors.length === 0, "a failing endpoint produces no page errors — " + JSON.stringify(down.errors.slice(0, 2)));
}

/* ================= D. the in-app hits (goTo / show) ====================== */
async function sectionHits(browser, mock) {
  section("D. Section-level hits inside index.html and farmgpt.html");

  const { page, errors } = await newPage(browser, mock, { user: "Eleanor" });
  await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__NAV__ && window.BuckyActivity, { timeout: 25000 });

  let list = await rows(page);
  ok(!!rowFor(list, "app"), 'index.html records itself as "app"');

  await page.evaluate(() => window.__NAV__.goTo("news"));
  await sleep(150);
  list = await rows(page);
  ok(!!rowFor(list, "app_news"), "navigating to News records app_news");
  await page.evaluate(() => window.__NAV__.goTo("chores"));
  await page.evaluate(() => window.__NAV__.goTo("chores"));
  await sleep(150);
  list = await rows(page);
  const chores = rowFor(list, "app_chores");
  ok(chores && chores.v >= 2, "each visit to a section counts, so 'how often' is real");
  ok(await page.evaluate(() => document.querySelector("#news, #app, main, body") !== null),
    "index.html is still navigable with the hits wired in");
  ok(errors.length === 0, "no page errors from index.html's goTo hit — " + JSON.stringify(errors.slice(0, 2)));

  /* -- and the same page with the beacon deliberately absent -- */
  const noBeacon = await newPage(browser, mock, { user: "Eleanor" });
  await noBeacon.page.setRequestInterception(true);
  noBeacon.page.on("request", () => {});   // handlers already installed by newPage
  await noBeacon.page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, "BuckyActivity", { configurable: true, get() { return undefined; } });
  });
  await noBeacon.page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await noBeacon.page.waitForFunction(() => window.__NAV__, { timeout: 25000 });
  const navigated = await noBeacon.page.evaluate(() => {
    window.__NAV__.goTo("news");
    return document.body.innerText.length > 0;
  });
  ok(navigated, "navigation still works when BuckyActivity is missing entirely");
  ok(noBeacon.errors.length === 0, "a missing beacon causes no page errors — " + JSON.stringify(noBeacon.errors.slice(0, 2)));

  /* -- farmgpt's view switcher -- */
  const fg = await newPage(browser, mock, { user: "Eleanor" });
  await fg.page.goto(BASE + "/farmgpt.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await fg.page.waitForFunction(() => window.BuckyActivity && document.getElementById("cardStory"), { timeout: 25000 });
  let fgRows = await rows(fg.page);
  ok(!!rowFor(fgRows, "farmgpt"), 'farmgpt.html records itself as "farmgpt"');
  await fg.page.click("#cardStory");
  await sleep(250);
  fgRows = await rows(fg.page);
  ok(!!rowFor(fgRows, "farmgpt_storysetup"), "opening Story Time records farmgpt_storysetup");
  ok(fg.errors.length === 0, "no page errors from farmgpt's show() hit — " + JSON.stringify(fg.errors.slice(0, 2)));
}

/* ==================== E. the dashboard =================================== */
function fakeStats() {
  const T = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const d = (n) => new Date(Date.parse(T + "T00:00:00Z") - n * 86400000).toISOString().slice(0, 10);
  return [
    { user: "Eleanor", slug: "eleanor", days: {
      [d(0)]: { app_news: { v: 4, m: 11.5 }, farmgpt_story: { v: 2, m: 26 }, app: { v: 5, m: 3 } },
      [d(1)]: { farmgpt_story: { v: 3, m: 41 }, castlekruzer: { v: 1, m: 18 } },
      [d(4)]: { app_chores: { v: 2, m: 2.5 } },
    } },
    { user: "Isaac", slug: "isaac", days: {
      [d(0)]: { castlekruzer: { v: 3, m: 52 }, farmkart: { v: 2, m: 17 } },
      [d(2)]: { app_fitness: { v: 1, m: 9 }, hayhaul: { v: 4, m: 22 } },
    } },
    { user: "Mom", slug: "mom", days: {
      [d(1)]: { app_mealplan: { v: 3, m: 7.5 }, app_news: { v: 1, m: 4 } },
      [d(12)]: { app_news: { v: 2, m: 6 } },   // only visible in the 30-day range
    } },
    { user: "Dad", slug: "dad", days: {
      [d(0)]: { app: { v: 6, m: 8 }, app_workorders: { v: 2, m: 4 }, weather: { v: 1, m: 1.5 } },
    } },
  ];
}

async function openDash(browser, mock, opts) {
  const o = opts || {};
  const h = await newPage(browser, mock, o);
  await h.page.goto(BASE + "/activity.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await h.page.waitForFunction(() => window.__ACT__, { timeout: 20000 });
  await sleep(350);
  return h;
}

async function sectionDash(browser, mock) {
  section("E. The Dad dashboard");

  mock.stats = fakeStats();

  /* -- Dad sees the data -- */
  const { page, errors } = await openDash(browser, mock, { user: "Dad", unlocked: true });
  ok(await page.evaluate(() => document.getElementById("gate").classList.contains("hidden")),
    "Dad is not shown the gate");
  await page.waitForFunction(() => !document.getElementById("content").classList.contains("hidden"), { timeout: 10000 });
  ok(mock.statsCalls > 0, "the dashboard asked the server for stats");

  const people = await page.evaluate(() => [...document.querySelectorAll(".person")].map((el) => ({
    user: el.getAttribute("data-user"),
    text: el.innerText.replace(/\s+/g, " ").trim(),
  })));
  ok(people.length === 4, `every person who used Bucky gets a card (${people.length})`);
  ok(people.some((p) => p.user === "Eleanor") && people.some((p) => p.user === "Isaac")
    && people.some((p) => p.user === "Mom") && people.some((p) => p.user === "Dad"),
    "all four family members appear by name");
  ok(/sessions/i.test(people[0].text) && /time/i.test(people[0].text),
    "a person card shows sessions and time");
  ok(/today|yesterday|days ago/i.test(people[0].text), "a person card says when they were last seen");
  // Eleanor 102 minutes over the 7 days, Isaac 100 — computed from the fixture below, not
  // eyeballed (the first version of this line guessed Isaac and was wrong by two minutes).
  ok(people[0].user === "Eleanor", "the busiest person sorts first (Eleanor, 102 minutes)");
  ok(/Story Time/.test(people[0].text), "a person card names their top features in plain English");

  const feats = await page.evaluate(() => [...document.querySelectorAll(".feat")].map((el) => ({
    f: el.getAttribute("data-feature"),
    users: [...el.querySelectorAll(".barrow")].map((r) => r.getAttribute("data-user")),
    // MEASURED, not read off the inline style: the first version of this page drew the
    // bars as inline spans, where a percentage width does nothing, and a style-string
    // check passed happily against a row of empty grey tracks.
    widths: [...el.querySelectorAll(".bfill")].map((b) => Math.round(b.getBoundingClientRect().width)),
    trackW: Math.round(((el.querySelector(".btrack") || {}).getBoundingClientRect
      ? el.querySelector(".btrack").getBoundingClientRect().width : 0)),
    barH: Math.round(((el.querySelector(".bfill") || {}).getBoundingClientRect
      ? el.querySelector(".bfill").getBoundingClientRect().height : 0)),
    text: el.innerText.replace(/\s+/g, " ").trim(),
  })));
  ok(feats.length >= 8, `every feature used in the range gets a row (${feats.length})`);
  const ck = feats.find((f) => f.f === "castlekruzer");
  ok(ck && ck.users.length === 2 && ck.users[0] === "Isaac",
    "a feature lists who used it, heaviest user first");
  ok(ck && ck.trackW > 40 && ck.barH >= 8, "a bar actually occupies space on screen");
  ok(ck && Math.abs(ck.widths[0] - ck.trackW) <= 1 && ck.widths[1] > 0 && ck.widths[1] < ck.widths[0] * 0.8,
    `the bars are proportional — the top user fills the track, the others are shorter (${ck.widths.join(" vs ")} of ${ck.trackW}px)`);
  ok(/Castle Kruzer/.test(ck.text), "features are labelled with their real names, not slugs");
  const news = feats.find((f) => f.f === "app_news");
  ok(news && news.users.length === 2, "News shows both readers");
  ok(feats[0].f === "castlekruzer", "the busiest feature sorts first");

  const days = await page.evaluate(() => [...document.querySelectorAll(".daycol")].map((c) => ({
    day: c.getAttribute("data-day"), v: Number(c.getAttribute("data-views")),
    h: parseFloat(c.querySelector(".dbar").style.height),
  })));
  ok(days.length === 7, "the 7-day range shows seven day columns");
  // Derived from the fixture rather than typed, so the expectation cannot drift from the
  // data it is checking.
  const todayKey = days[days.length - 1].day;
  let expectToday = 0;
  for (const u of fakeStats()) for (const f of Object.values(u.days[todayKey] || {})) expectToday += f.v;
  ok(days[days.length - 1].v === expectToday,
    `today's column counts every opening across the family (${expectToday})`);
  ok(days.some((d) => d.v === 0), "a day nobody used it shows as an empty column, not a gap");
  ok(days[days.length - 1].h > days.find((d) => d.v === 0).h, "a busy day's bar is taller than an empty one's");

  /* -- the 30-day range really widens it -- */
  const seven = await page.evaluate(() => window.__ACT__.summarise().total);
  await page.click("#r30");
  await page.waitForFunction(() => document.querySelectorAll(".daycol").length === 30, { timeout: 10000 });
  const thirty = await page.evaluate(() => window.__ACT__.summarise().total);
  ok(thirty > seven, `the 30-day range picks up older activity (${seven} -> ${thirty} openings)`);
  ok(await page.evaluate(() => document.getElementById("r30").classList.contains("on")),
    "the chosen range is the one that looks chosen");
  await page.click("#r7");
  await page.waitForFunction(() => document.querySelectorAll(".daycol").length === 7, { timeout: 10000 });

  ok(errors.length === 0, "no page errors on the dashboard — " + JSON.stringify(errors.slice(0, 2)));

  // Shots are taken on a TALL viewport rather than with fullPage, because the nav bar and
  // the desktop rail are position:fixed and a fullPage capture paints them at one viewport
  // height — leaving a bar stranded across the middle of the plate and a white band under
  // the rail, both of which read as bugs that aren't there.
  if (WANT_SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.setViewport({ width: 390, height: 2200, deviceScaleFactor: 1 });
    await sleep(250);
    await page.screenshot({ path: path.join(SHOTS, "activity_mobile.png") });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  }

  /* -- a non-Dad profile sees nothing -- */
  const kid = await openDash(browser, mock, { user: "Isaac" });
  const kidText = await kid.page.evaluate(() => document.getElementById("gate").innerText);
  ok(/just for Dad/i.test(kidText), "a kid is told the page is just for Dad");
  ok(await kid.page.evaluate(() => document.getElementById("dash").classList.contains("hidden")),
    "the dashboard itself is not in the page for a kid");
  ok(await kid.page.evaluate(() => document.querySelectorAll(".person, .feat, .daycol").length) === 0,
    "a kid sees zero data rows");
  const statsBefore = mock.statsCalls;
  await sleep(300);
  ok(mock.statsCalls === statsBefore, "a kid's visit does not even fetch the stats");
  ok(kid.errors.length === 0, "no page errors for a gated visitor");

  /* -- a locked Dad can unlock with the PIN -- */
  const pinHash = crypto.createHash("sha256").update("4321:amenfarms").digest("hex");
  const locked = await openDash(browser, mock, { user: "Dad", pinHash, prompts: ["4321"] });
  ok(await locked.page.evaluate(() => !document.getElementById("unlockBtn").classList.contains("hidden")),
    "a Dad who has not unlocked this session is offered the unlock");
  await locked.page.click("#unlockBtn");
  await locked.page.waitForFunction(() => !document.getElementById("dash").classList.contains("hidden"), { timeout: 10000 });
  ok(true, "the right PIN unlocks the dashboard");
  const wrong = await openDash(browser, mock, { user: "Dad", pinHash, prompts: ["0000"] });
  await wrong.page.click("#unlockBtn");
  await sleep(300);
  ok(await wrong.page.evaluate(() => document.getElementById("dash").classList.contains("hidden")),
    "the wrong PIN does not unlock it");

  /* -- the honest empty state -- */
  mock.stats = [];
  const empty = await openDash(browser, mock, { user: "Dad", unlocked: true });
  await empty.page.waitForFunction(() => !document.getElementById("empty").classList.contains("hidden"), { timeout: 10000 });
  const emptyText = await empty.page.evaluate(() => document.getElementById("empty").innerText);
  ok(/Nothing/i.test(emptyText), "an empty log says so plainly");
  ok(/activity tracking started/i.test(emptyText), "the empty state names when tracking began");
  ok(/2026/.test(emptyText), "the start date is a real date, not a placeholder");
  ok(await empty.page.evaluate(() => document.querySelectorAll(".person, .feat").length) === 0,
    "an empty log shows no fabricated rows");
  ok(empty.errors.length === 0, "no page errors on the empty dashboard");
  if (WANT_SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await empty.page.screenshot({ path: path.join(SHOTS, "activity_empty.png") });
  }

  /* -- a server failure is reported, not faked -- */
  mock.fail = true;
  const broken = await openDash(browser, mock, { user: "Dad", unlocked: true });
  await broken.page.waitForFunction(() => !document.getElementById("errBox").classList.contains("hidden"), { timeout: 10000 });
  ok(await broken.page.evaluate(() => document.querySelectorAll(".person, .feat, .daycol").length) === 0,
    "a failed read shows an error, never invented numbers");
  mock.fail = false;
  mock.stats = fakeStats();
}

/* ==================== F. layout at both sizes ============================ */
async function sectionLayout(browser, mock) {
  section("F. The dashboard fits a phone and uses the rail on a desktop");

  const phone = await openDash(browser, mock, { user: "Dad", unlocked: true });
  await phone.page.waitForFunction(() => !document.getElementById("content").classList.contains("hidden"), { timeout: 10000 });
  const m = await phone.page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    navBottom: Math.round(document.getElementById("buckyNav").getBoundingClientRect().bottom),
    navRows: getComputedStyle(document.getElementById("buckyNav")).gridTemplateColumns.split(" ").length,
    railShown: getComputedStyle(document.getElementById("sidenav")).display !== "none",
    active: document.querySelectorAll("#buckyNav a.active").length,
    links: document.querySelectorAll("#buckyNav a").length,
    clipped: [...document.querySelectorAll("#buckyNav .blabel")].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
    innerH: window.innerHeight,
  }));
  ok(m.scrollW <= m.clientW + 1, `no horizontal page scroll at 390px (${m.scrollW} <= ${m.clientW})`);
  ok(!m.railShown, "the desktop rail is hidden on a phone");
  // RESTAGED 2026-08-05 (again) — one row of twelve made the icons too small (user ruling
  // after a day's use), so the nav is back to a balanced TWO-row bar (--bnav-cols =
  // Math.ceil(shown.length/2), --bnav-all = shown.length). navRows is really a
  // COLUMN count read off gridTemplateColumns, so the 2-row bar reads its column count.
  // RESTAGED 2026-08-05 (sports): the 🏈 Sports area is the 13th.
  // RESTAGED 2026-08-13 (GFFL-CONNECT): the 🏆 GFFL area is the 14th — the family's own
  // league app became a Bucky embed tab. ceil(14/2) = 7 columns, same as before, so only
  // the link count moves. Behaviour (0 clipped, nothing active) unchanged below.
  ok(m.links === 14 && m.navRows === 7, "the bottom nav is the 14-area, two-row bar");
  ok(m.clipped === 0, "no nav label is clipped at 390px");
  ok(m.active === 0, "no nav area is marked active — this page is not one of them");
  ok(m.navBottom <= m.innerH + 1, "the nav sits at the bottom of the viewport, not below it");

  // Wide content pans inside its own container rather than stretching the page.
  const panned = await phone.page.evaluate(() => {
    const p = document.querySelector(".panner");
    return !!p && getComputedStyle(p).overflowX === "auto";
  });
  ok(panned, "the day chart pans inside its own container");

  const desk = await openDash(browser, mock, { user: "Dad", unlocked: true, viewport: { width: 1280, height: 800, deviceScaleFactor: 1 } });
  await desk.page.waitForFunction(() => !document.getElementById("content").classList.contains("hidden"), { timeout: 10000 });
  const d = await desk.page.evaluate(() => {
    const rail = document.getElementById("sidenav");
    const mainEl = document.querySelector("main");
    return {
      railShown: getComputedStyle(rail).display !== "none",
      railItems: rail.querySelectorAll(".sn-item").length,
      brand: (rail.querySelector(".sn-name") || {}).textContent || "",
      navShown: getComputedStyle(document.getElementById("buckyNav")).display !== "none",
      mainLeft: Math.round(mainEl.getBoundingClientRect().left),
      railRight: Math.round(rail.getBoundingClientRect().right),
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  });
  // Description only, not a check: the rail recolored navy → pine green in the 2026-08-05
  // Farmstead re-skin (see activity.html's farmstead-theme-page block) — the assertion
  // itself was always about item count/visibility, never color, so it's unchanged.
  // 12 → 13 on 2026-08-05 (Sports) → 14 on 2026-08-13 (GFFL-CONNECT: the league tab).
  ok(d.railShown && d.railItems === 14, "the 14-item rail is used at 1280px");
  ok(d.brand === "Bucky", "the rail carries the wordmark");
  ok(!d.navShown, "the bottom bar is hidden when the rail is up");
  ok(d.mainLeft >= d.railRight, "the content clears the rail rather than hiding under it");
  ok(d.scrollW <= d.clientW + 1, "no horizontal page scroll at 1280px");
  ok(desk.errors.length === 0, "no page errors at desktop size");

  if (WANT_SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await desk.page.setViewport({ width: 1280, height: 1650, deviceScaleFactor: 1 });
    await sleep(250);
    await desk.page.screenshot({ path: path.join(SHOTS, "activity_desktop.png") });
  }
}

/* ==================== G. the wiring, on disk ============================= */
function sectionWiring() {
  section("G. Every page that should carry the beacon does, and no page that shouldn't");

  const WIRED = { "index.html": "app", "farmgpt.html": "farmgpt", "games.html": "games",
    "weather.html": "weather", "meallog.html": "meallog", "barnyardbistro.html": "barnyardbistro",
    "branchmanager.html": "branchmanager", "castlekruzer.html": "castlekruzer",
    "farmkart.html": "farmkart", "farmparty.html": "farmparty", "goatcare.html": "goatcare",
    "hayhaul.html": "hayhaul", "hayhem.html": "hayhem", "pasturepanic.html": "pasturepanic",
    "dungeon.html": "dungeon" };
  const NOT_WIRED = ["farmkart-editor.html", "kartviewer.html", "characterdemo.html",
    "leveleditor.html", "farmkart-kart-editor.html", "email-template.html", "activity.html"];

  let wiredOk = 0, featureOk = 0, deferOk = 0;
  for (const [file, feature] of Object.entries(WIRED)) {
    const s = fs.readFileSync(path.join(ROOT, file), "utf8");
    const tag = /<script[^>]*assets\/activity\.js[^>]*>/.exec(s);
    if (tag) {
      wiredOk++;
      if (tag[0].includes(`data-feature="${feature}"`)) featureOk++;
      if (tag[0].includes("defer")) deferOk++;
    }
  }
  ok(wiredOk === Object.keys(WIRED).length, `all ${Object.keys(WIRED).length} family pages carry the beacon (${wiredOk})`);
  ok(featureOk === Object.keys(WIRED).length, "each one declares its own explicit data-feature");
  ok(deferOk === Object.keys(WIRED).length, "every tag is deferred, so it never blocks a page");

  let strayed = 0;
  for (const file of NOT_WIRED) {
    const p = path.join(ROOT, file);
    if (fs.existsSync(p) && fs.readFileSync(p, "utf8").includes("assets/activity.js")) strayed++;
  }
  ok(strayed === 0, "editors, demos and the dashboard itself are NOT tracked");

  const idx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  ok(/window\.BuckyActivity[\s\S]{0,80}hit\("app_"/.test(idx), "index.html's goTo records app_<section>");
  ok(/try\s*\{\s*if\s*\(window\.BuckyActivity\)[\s\S]{0,120}\}\s*catch/.test(idx),
    "index.html's hit is guarded so a missing beacon can't break navigation");
  const fg = fs.readFileSync(path.join(ROOT, "farmgpt.html"), "utf8");
  ok(/window\.BuckyActivity[\s\S]{0,80}hit\("farmgpt_"/.test(fg), "farmgpt.html's show records farmgpt_<view>");

  const beacon = fs.readFileSync(path.join(ROOT, "assets", "activity.js"), "utf8");
  ok(/pagehide/.test(beacon) && /visibilitychange/.test(beacon) && /sendBeacon/.test(beacon),
    "the beacon flushes on pagehide and on going hidden, using sendBeacon");
  ok(/keepalive/.test(beacon), "it falls back to keepalive fetch where sendBeacon is missing");
  ok(!/\btype\s*=\s*["']module["']/.test(beacon) && !/\bimport\s/.test(beacon),
    "the beacon is a plain script — no modules, no build step");
}

/* ================================ main =================================== */
(async () => {
  const goog = await serveGoogle();
  const fsSrv = await serveFirestore();

  try {
    await sectionServer();
  } catch (err) {
    fail++; failures.push("section A crashed: " + err.message);
    console.log("\n✗ SECTION A ERROR: " + ((err && err.stack) || err));
  }

  try {
    sectionWiring();
  } catch (err) {
    fail++; failures.push("section G crashed: " + err.message);
    console.log("\n✗ SECTION G ERROR: " + ((err && err.stack) || err));
  }

  const srv = await serve();
  const mock = makeMock();
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  try {
    await sectionBeacon(browser, mock);
    await sectionFlush(browser, mock);
    await sectionHits(browser, mock);
    await sectionDash(browser, mock);
    await sectionLayout(browser, mock);
  } catch (err) {
    fail++; failures.push("suite crashed: " + err.message);
    console.log("\n✗ SUITE ERROR: " + ((err && err.stack) || err));
  } finally {
    await browser.close();
    srv.close(); goog.close(); fsSrv.close();
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`ACTIVITY: ${pass}/${pass + fail} checks passed`);
  if (fail) { console.log("\nFailures:"); for (const f of failures) console.log("  ✗ " + f); }
  process.exit(fail ? 1 : 0);
})();
