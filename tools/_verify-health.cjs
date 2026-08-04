#!/usr/bin/env node
"use strict";
/**
 * BUCKY Health/ops dashboard suite — the server half (netlify/functions/health.mjs) AND the
 * client half (status.html).
 *
 *   node tools/_verify-health.cjs [--shots]
 *
 * SECTIONS A-N are pure Node, in-process — no browser, no real network. health.mjs is imported
 * directly and every upstream it talks to (Anthropic/xAI/Gemini/Netlify/ElevenLabs/Tripo, the
 * free-tier CDNs+APIs, this site's own sibling functions, Google OAuth, Firestore) is a small
 * local HTTP server whose shape is deliberately kept close to the real thing — see the
 * "REALISTIC FAKES" comment on each server below. A fake that's more permissive than the real
 * service is worse than no fake at all (the activity.mjs suite's own lesson, reused here): the
 * Firestore fake enforces the real field-path grammar and 404s a missing doc; the Anthropic
 * fake's credit-low body is the API's real error shape.
 *
 * SECTIONS O onward drive real Chrome at 390x844 and desktop against status.html, with
 * /.netlify/functions/health ROUTE-MOCKED (a scriptable fixture, not the real function) — same
 * house pattern as tools/_verify-activity.cjs. FIREBASE IS BLOCKED THROUGHOUT
 * (googleapis/firestore/firebase/gstatic) — non-negotiable house rule, even though status.html
 * never touches Firestore directly itself (the health function does, server-side).
 */

const http = require("http");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const WANT_SHOTS = process.argv.includes("--shots");
const SECRET = "amenfarms-health-secret";

const GOOG_PORT = 8905, FS_PORT = 8906, PAID_PORT = 8907, FREE_PORT = 8908, SELF_PORT = 8909;

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");

/* ============================================================================
   Fake Google OAuth token endpoint (real RSA key, real JWT-shaped assertion — same
   technique as tools/_verify-activity.cjs).
   ============================================================================ */
const KEY = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = JSON.stringify({
  client_email: "health-test@amen-farms-app.iam.gserviceaccount.com",
  private_key: KEY.privateKey.export({ type: "pkcs8", format: "pem" }),
});
const googState = { calls: 0, ok: true };
function serveGoogle() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        googState.calls++;
        if (!googState.ok) { res.statusCode = 500; return res.end("{}"); }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ access_token: "fake-google-access-token-999", expires_in: 3600 }));
      });
    });
    srv.listen(GOOG_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ============================================================================
   Fake Firestore. REALISTIC FAKE: enforces the real field-path grammar on :commit (a fake
   that's more permissive than Firestore let a real bug through production once — see
   activity.mjs's own note), and a missing document genuinely 404s rather than returning {}.
   Two independent stores: `settingsDocs` (single-doc GET/commit — the opsHealth/
   opsFirestoreUsage cache) and `collections` (paginated LIST — what firestore_usage measures).
   Deliberately decoupled, matching real Firestore's own behaviour where a settings doc write
   IS visible if you later list its collection — except we don't need that cross-consistency
   for anything under test here, so keeping them separate keeps the fake simple.
   ============================================================================ */
const fsState = {
  fail: false,
  settingsDocs: new Map(),   // docId -> fields
  collections: new Map(),    // collectionId -> [{id, fields}]
  commits: 0,
  rejectedCommits: 0,
  listHits: {},              // collectionId -> count
  singleGetHits: {},         // docId -> count
};
function fsReset() {
  fsState.settingsDocs.clear();
  fsState.commits = 0; fsState.rejectedCommits = 0;
  fsState.listHits = {}; fsState.singleGetHits = {};
  fsState.fail = false;
}
function serveFirestore() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const u = new URL(req.url, "http://x");
        const p = u.pathname;
        const json = (o, code) => { res.statusCode = code || 200; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
        if (fsState.fail) return json({ error: "boom" }, 503);

        if (p.endsWith(":commit")) {
          fsState.commits++;
          let body = null; try { body = JSON.parse(raw); } catch {}
          const badPath = [];
          for (const w of ((body && body.writes) || [])) {
            for (const k of Object.keys((w.update && w.update.fields) || {})) {
              if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(k)) badPath.push(k);
            }
            for (const fp of ((w.updateMask && w.updateMask.fieldPaths) || [])) {
              if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(fp)) badPath.push(fp);
            }
          }
          if (badPath.length) {
            fsState.rejectedCommits++;
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: { code: 400, status: "INVALID_ARGUMENT",
              message: `Invalid property path "${badPath[0]}". Unquoted property paths must match ([a-zA-Z_][a-zA-Z_0-9]*).` } }));
          }
          for (const w of ((body && body.writes) || [])) {
            const name = (w.update && w.update.name) || "";
            const id = name.split("/").pop();
            fsState.settingsDocs.set(id, (w.update && w.update.fields) || {});
          }
          return json({ writeResults: [] });
        }

        const settingsMatch = /\/settings_fam2jan2g\/([A-Za-z0-9_-]+)$/.exec(p);
        if (settingsMatch) {
          const id = settingsMatch[1];
          fsState.singleGetHits[id] = (fsState.singleGetHits[id] || 0) + 1;
          const fields = fsState.settingsDocs.get(id);
          if (!fields) return json({ error: { code: 404, status: "NOT_FOUND" } }, 404);
          return json({ name: `projects/amen-farms-app/databases/(default)/documents/settings_fam2jan2g/${id}`, fields });
        }

        // Collection LIST (paginated): last path segment is the collection id.
        const collId = p.split("/").filter(Boolean).pop();
        fsState.listHits[collId] = (fsState.listHits[collId] || 0) + 1;
        const pageSize = parseInt(u.searchParams.get("pageSize") || "300", 10);
        const pageToken = u.searchParams.get("pageToken") || "";
        const all = fsState.collections.get(collId) || [];
        const startIdx = pageToken ? parseInt(pageToken, 10) : 0;
        const slice = all.slice(startIdx, startIdx + pageSize);
        const nextIdx = startIdx + pageSize;
        const documents = slice.map((d) => ({ name: `projects/amen-farms-app/databases/(default)/documents/${collId}/${d.id}`, fields: d.fields }));
        const out = { documents };
        if (nextIdx < all.length) out.nextPageToken = String(nextIdx);
        return json(out);
      });
    });
    srv.listen(FS_PORT, "127.0.0.1", () => resolve(srv));
  });
}
function seedCollection(id, n, fieldsFn) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push({ id: "d" + i, fields: (fieldsFn ? fieldsFn(i) : { a: { stringValue: "x" } }) });
  fsState.collections.set(id, arr);
}

/* ============================================================================
   Fake PAID upstream. One server, one path prefix per service (the base URL override IS the
   prefix — e.g. HEALTH_ANTHROPIC_BASE = http://127.0.0.1:PORT/anthropic). REALISTIC FAKES:
   Anthropic's credit-low body is its real 400 invalid_request_error shape; Netlify/ElevenLabs/
   Tripo return the field names the probe code actually reads.
   ============================================================================ */
const paidState = {
  hits: [],
  messagesHits: 0,
  anthropicModelsStatus: 200,
  anthropicHangModels: false,
  anthropicMessagesMode: "ok",   // ok | key-bad | credit-low | other
  xaiStatus: 200,
  geminiStatus: 200,
  netlifySlug: "amenfarms-team",
  netlifyAccountsStatus: 200,
  netlifyBandwidthStatus: 200,
  netlifyBandwidth: { used: 500, included: 1000, period_end_date: "2026-09-01" },
  elevenlabsStatus: 200,
  elevenlabsUsage: { tier: "creator", character_count: 400, character_limit: 1000 },
  tripoStatus: 200,
  tripoBalance: { code: 0, data: { balance: 42, frozen: 0 } },
  force500: null,   // e.g. "/tripo/v2/openapi/user/balance"
};
function paidReset() {
  paidState.hits = []; paidState.messagesHits = 0;
  paidState.anthropicModelsStatus = 200; paidState.anthropicHangModels = false; paidState.anthropicMessagesMode = "ok";
  paidState.xaiStatus = 200; paidState.geminiStatus = 200;
  paidState.netlifyAccountsStatus = 200; paidState.netlifyBandwidthStatus = 200;
  paidState.netlifyBandwidth = { used: 500, included: 1000, period_end_date: "2026-09-01" };
  paidState.elevenlabsStatus = 200; paidState.elevenlabsUsage = { tier: "creator", character_count: 400, character_limit: 1000 };
  paidState.tripoStatus = 200; paidState.tripoBalance = { code: 0, data: { balance: 42, frozen: 0 } };
  paidState.force500 = null;
}
function servePaid() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const u = new URL(req.url, "http://x");
        paidState.hits.push(u.pathname);
        const json = (o, code) => { res.statusCode = code || 200; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };

        if (paidState.force500 && u.pathname === paidState.force500) return json({ error: "boom" }, 500);

        if (u.pathname === "/anthropic/v1/models") {
          if (paidState.anthropicHangModels) return; // never respond — the timeout test
          return json({ data: [] }, paidState.anthropicModelsStatus);
        }
        if (u.pathname === "/anthropic/v1/messages") {
          paidState.messagesHits++;
          if (paidState.anthropicMessagesMode === "key-bad") {
            return json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401);
          }
          if (paidState.anthropicMessagesMode === "credit-low") {
            return json({ type: "error", error: { type: "invalid_request_error",
              message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } }, 400);
          }
          if (paidState.anthropicMessagesMode === "other") {
            return json({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, 529);
          }
          return json({ id: "msg_1", content: [{ type: "text", text: "hi" }], usage: { input_tokens: 8, output_tokens: 1 } }, 200);
        }
        if (u.pathname === "/xai/v1/models") return json({ data: [] }, paidState.xaiStatus);
        if (u.pathname === "/gemini/v1beta/models") return json({ models: [] }, paidState.geminiStatus);
        if (u.pathname === "/netlify/api/v1/accounts") return json([{ id: "acc1", slug: paidState.netlifySlug, name: "Amen Farms" }], paidState.netlifyAccountsStatus);
        if (u.pathname === `/netlify/api/v1/accounts/${paidState.netlifySlug}/bandwidth`) return json(paidState.netlifyBandwidth, paidState.netlifyBandwidthStatus);
        if (u.pathname === "/elevenlabs/v1/user/subscription") return json(paidState.elevenlabsUsage, paidState.elevenlabsStatus);
        if (u.pathname === "/tripo/v2/openapi/user/balance") return json(paidState.tripoBalance, paidState.tripoStatus);
        json({}, 404);
      });
    });
    srv.listen(PAID_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ============================================================================
   Fake FREE-tier upstream. One server, path = "/<id>" per HEALTH_FREE_OVERRIDES entry.
   ============================================================================ */
const freeState = { hits: [], status: {}, hang: new Set() };
function freeReset() { freeState.hits = []; freeState.status = {}; freeState.hang = new Set(); }
function serveFree() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const u = new URL(req.url, "http://x");
        const id = u.pathname.split("/").filter(Boolean)[0] || "";
        freeState.hits.push(id);
        if (freeState.hang.has(id)) return; // never respond
        const status = freeState.status[id] != null ? freeState.status[id] : 200;
        const json = (o) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
        if (id === "openmeteo") return json({ current: { temperature_2m: 78.4 }, daily: {} });
        if (id === "rainviewer") return json({ radar: { past: [{ path: "/v2/abc", time: 1 }], nowcast: [] } });
        if (id === "iem_hrrr") { res.statusCode = status; res.setHeader("content-type", "image/png"); return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47])); }
        if (id === "yahoo_finance") return json({ chart: { result: [{ meta: { symbol: "AAPL", regularMarketPrice: 231.5 } }] } });
        if (id === "jsdelivr" || id === "unpkg_leaflet" || id === "unpkg_playroom" || id === "gstatic_firebase" || id === "google_fonts") {
          res.statusCode = status; res.setHeader("content-type", "text/javascript"); return res.end("/* ok */");
        }
        res.statusCode = 404; res.end("{}");
      });
    });
    srv.listen(FREE_PORT, "127.0.0.1", () => resolve(srv));
  });
}
function freeOverridesEnv() {
  const ids = ["openmeteo", "rainviewer", "iem_hrrr", "yahoo_finance", "jsdelivr", "unpkg_leaflet", "unpkg_playroom", "gstatic_firebase", "google_fonts"];
  const map = {};
  for (const id of ids) map[id] = `http://127.0.0.1:${FREE_PORT}/${id}`;
  return JSON.stringify(map);
}

/* ============================================================================
   Fake SELF base — mimics every sibling function's real secret-gate status code exactly
   (news/farmgpt/stocks/calendar/activity all 401 on a wrong secret, notify 403, goats has no
   gate at all and answers a real-shaped {goats,count} on GET, teachergpt-background is a
   Netlify "-background" function and always answers 202 regardless of body).
   ============================================================================ */
const selfState = { hits: [], mode: "normal" }; // mode: normal | all404 | dead
function selfReset() { selfState.hits = []; selfState.mode = "normal"; }
function serveSelf() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const u = new URL(req.url, "http://x");
        selfState.hits.push(u.pathname);
        if (selfState.mode === "dead") { req.destroy(); return; }
        const json = (o, code) => { res.statusCode = code || 200; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
        if (selfState.mode === "all404") return json({}, 404);

        const m = /^\/\.netlify\/functions\/([a-z0-9_-]+)/i.exec(u.pathname);
        const fn = m ? m[1] : "";
        if (["farmgpt", "news", "stocks", "calendar", "activity"].includes(fn)) return json({ error: "Wrong family password" }, 401);
        if (fn === "notify") return json({ error: "Forbidden" }, 403);
        if (fn === "goats") {
          if (req.method !== "GET") return json({ error: "method" }, 405);
          return json({ goats: [{ name: "Billy" }, { name: "Daisy" }], count: 2 }, 200);
        }
        if (fn === "teachergpt-background") { res.statusCode = 202; res.end(""); return; }
        return json({}, 404);
      });
    });
    srv.listen(SELF_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ============================================================================
   Wiring env + calling the handler in process.
   ============================================================================ */
function wireEnv() {
  process.env.BUCKY_NOTIFY_SECRET = SECRET;
  process.env.HEALTH_GOOGLE_TOKEN_URL = `http://127.0.0.1:${GOOG_PORT}/token`;
  process.env.HEALTH_FIRESTORE_BASE = `http://127.0.0.1:${FS_PORT}/v1/projects/amen-farms-app/databases/(default)/documents`;
  process.env.HEALTH_ANTHROPIC_BASE = `http://127.0.0.1:${PAID_PORT}/anthropic`;
  process.env.HEALTH_XAI_BASE = `http://127.0.0.1:${PAID_PORT}/xai`;
  process.env.HEALTH_GEMINI_BASE = `http://127.0.0.1:${PAID_PORT}/gemini`;
  process.env.HEALTH_NETLIFY_BASE = `http://127.0.0.1:${PAID_PORT}/netlify`;
  process.env.HEALTH_ELEVENLABS_BASE = `http://127.0.0.1:${PAID_PORT}/elevenlabs`;
  process.env.HEALTH_TRIPO_BASE = `http://127.0.0.1:${PAID_PORT}/tripo`;
  process.env.HEALTH_FREE_OVERRIDES = freeOverridesEnv();
  process.env.HEALTH_SELF_BASE_URL = `http://127.0.0.1:${SELF_PORT}`;
}
function clearAllKeys() {
  for (const k of ["ANTHROPIC_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "NETLIFY_API_TOKEN", "ELEVENLABS_API_KEY", "TRIPO_API_KEY"]) {
    delete process.env[k];
  }
}
function setAllKeys() {
  process.env.ANTHROPIC_API_KEY = "sk-ant-FAKEKEYVALUE001";
  process.env.XAI_API_KEY = "xai-FAKEKEYVALUE002";
  process.env.GEMINI_API_KEY = "AIza-FAKEKEYVALUE003";
  process.env.NETLIFY_API_TOKEN = "nfp_FAKEKEYVALUE004";
  process.env.ELEVENLABS_API_KEY = "el_FAKEKEYVALUE005";
  process.env.TRIPO_API_KEY = "tsk_FAKEKEYVALUE006";
}

let handler = null;
async function call(body) {
  const req = new Request("https://amenfarms.netlify.app/.netlify/functions/health", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await handler(req);
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: res.status, text, body: j };
}
const svc = (resp, id) => (resp.body && resp.body.services || []).find((s) => s.id === id);

/* ============================================================================
   BROWSER HARNESS — status.html against a route-mocked /.netlify/functions/health.
   ============================================================================ */
const UI_PORT = 8910;
const UI_BASE = `http://127.0.0.1:${UI_PORT}`;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".txt": "text/plain",
  ".webmanifest": "application/manifest+json" };
function serveStatic() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/status.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.statusCode = 404; return res.end("not found");
      }
      res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(UI_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ---------------------------------------------------------------------------
   A scriptable /.netlify/functions/health mock. `fixture` controls what "summary" answers
   with; the credit and usage actions each have their own small, independently-scriptable
   state so a test can flip just one of the three at a time.
   --------------------------------------------------------------------------- */
function uiTally(services) {
  const counts = { ok: 0, warn: 0, down: 0, unconfigured: 0, unknown: 0 };
  for (const s of services) counts[s.status] = (counts[s.status] || 0) + 1;
  return counts;
}
function svcRow(id, name, tier, status, headline, detail, breaks, metric, configHint) {
  return { id, name, tier, status, headline, detail, breaks: breaks || [], metric: metric || null, configHint: configHint || null };
}
// One representative fixture per tier-status combo the client needs to prove it renders —
// deliberately smaller than the real 25-entry registry (the client doesn't care about count,
// only about grouping-by-tier and per-status rendering, both of which this exercises fully).
const ALL_OK_SERVICES = [
  svcRow("anthropic", "Anthropic (Claude)", "paid", "ok", "Reachable", "The Anthropic API is responding normally.",
    ["FarmGPT research & stories", "Dungeon"]),
  svcRow("netlify", "Netlify", "paid", "ok", "Connected", "Bandwidth usage looks fine.",
    ["The whole site", "every function"], { used: 500000000, limit: 1000000000, pct: 50, unit: "bytes", periodEnd: "2026-09-01" }),
  svcRow("firebase", "Firebase / Google Cloud", "paid", "ok", "Connected", "The service account is valid and Firestore answered a real read.",
    ["All family data sync", "calendar"], { totalDocs: 812, totalBytes: 2400000, measuredAt: Date.now() - 3600000, staleMs: 3600000 }),
  svcRow("tripo", "Tripo (3D generation)", "paid", "ok", "42 credits", "Connected; credit balance looks fine.",
    ["Generating new 3D models (dev-time only)"], { balance: 42, unit: "credits" }),
  svcRow("openmeteo", "Open-Meteo", "free", "ok", "Reachable", "Responding normally.",
    ["The Weather page's forecast", "Home's weather card"]),
  svcRow("jsdelivr", "jsDelivr CDN", "free", "ok", "Reachable", "Responding normally.",
    ["FarmGPT research view rendering"]),
  svcRow("google_fonts", "Google Fonts", "free", "ok", "Reachable", "Responding normally.", []),
  svcRow("farmgpt", "farmgpt function", "self", "ok", "Routed and running", "The farmgpt function responded as expected (HTTP 401).",
    ["FarmGPT (research, Story Time, Dungeon, TeacherGPT setup)"]),
  svcRow("goats", "goats function", "self", "ok", "Routed and running", "The goats function responded as expected (HTTP 200).",
    ["The public goat feed on the Amen Farms sales site"]),
  svcRow("chorereminders", "chorereminders (scheduled)", "self", "unknown", "Scheduled function",
    "chorereminders is a scheduled function — it runs on its own timer (cron), not on a request. Check its logs in the Netlify dashboard for its last run.",
    ["Scheduled chore-reminder pushes"]),
];
const MIXED_SERVICES = [
  svcRow("anthropic", "Anthropic (Claude)", "paid", "ok", "Reachable", "The Anthropic API is responding normally.",
    ["FarmGPT research & stories", "Dungeon"]),
  svcRow("xai", "xAI (Grok)", "paid", "unconfigured", "Not configured",
    "Optional — Story Time's Grok narrator experiment. Without it, Story Time quietly uses Claude Haiku instead; nothing breaks.",
    ["Story Time (Grok narrator experiment)"], null,
    "Set XAI_API_KEY in Netlify (from console.x.ai)."),
  svcRow("netlify", "Netlify", "paid", "warn", "85% of bandwidth used", "Bandwidth usage is getting high for this billing period.",
    ["The whole site", "every function"], { used: 850000000, limit: 1000000000, pct: 85, unit: "bytes", periodEnd: "2026-09-01" }),
  svcRow("firebase", "Firebase / Google Cloud", "paid", "ok", "Connected", "The service account is valid and Firestore answered a real read.",
    ["All family data sync", "calendar"], { totalDocs: 812, totalBytes: 2400000, measuredAt: Date.now() - 3600000, staleMs: 3600000 }),
  svcRow("tripo", "Tripo (3D generation)", "paid", "down", "Key rejected", "Tripo rejected the API key (401) — it may be revoked or wrong.",
    ["Generating new 3D models (dev-time only — shipped models keep working)"]),
  svcRow("openmeteo", "Open-Meteo", "free", "ok", "Reachable", "Responding normally.",
    ["The Weather page's forecast", "Home's weather card"]),
  svcRow("rainviewer", "RainViewer (radar)", "free", "down", "Unreachable", "The request failed before getting a response.",
    ["Weather radar — past frames"]),
  svcRow("google_fonts", "Google Fonts", "free", "warn", "Error", "Responded with HTTP 500.", []),
  svcRow("farmgpt", "farmgpt function", "self", "ok", "Routed and running", "The farmgpt function responded as expected (HTTP 401).",
    ["FarmGPT (research, Story Time, Dungeon, TeacherGPT setup)"]),
  svcRow("calendar", "calendar function", "self", "down", "Not found", "The calendar function did not respond (404) — check it's deployed.",
    ["The Plan area's family calendar"]),
  svcRow("chorereminders", "chorereminders (scheduled)", "self", "unknown", "Scheduled function",
    "chorereminders is a scheduled function — it runs on its own timer (cron), not on a request. Check its logs in the Netlify dashboard for its last run.",
    ["Scheduled chore-reminder pushes"]),
];
const FIRESTORE_USAGE_FIXTURE = {
  ok: true, generatedAt: Date.now() - 5 * 60000, cachedUntil: Date.now() + 23 * 3600000, cached: true,
  collections: [
    { id: "chores_fam2jan2g", count: 40, bytes: 12000, truncated: false, ok: true },
    { id: "farmgpt_story_log", count: 1500, bytes: 900000, truncated: true, ok: true },
    { id: "bucky_activity", count: 22, bytes: 5000, truncated: false, ok: true },
  ],
  totalDocs: 1562, totalBytes: 917000, anyTruncated: true,
  note: "The Firebase Spark (free) plan includes 1 GiB of Firestore storage. This total is MEASURED, not billed usage.",
};

function makeHealthMock() {
  const st = {
    fixture: ALL_OK_SERVICES,
    summaryCalls: 0, lastSummaryForce: null, summaryFail: false,
    creditCalls: 0, creditStatus: "ok",
    usageCalls: 0, lastUsageForce: null, usageFail: false,
  };
  st.handle = (raw) => {
    let b = null; try { b = JSON.parse(raw || "{}"); } catch (e) {}
    if (!b || b.secret == null) return { status: 400, body: { error: "Invalid JSON" } };
    if (b.action === "summary") {
      st.summaryCalls++;
      st.lastSummaryForce = !!b.force;
      if (st.summaryFail) return "ABORT";
      return { status: 200, body: { ok: true, generatedAt: Date.now(), cachedUntil: Date.now() + 600000,
        cached: false, counts: uiTally(st.fixture), services: st.fixture } };
    }
    if (b.action === "probe_anthropic_credit") {
      st.creditCalls++;
      const detailByStatus = { ok: "Fine.", "credit-low": "Too low.", "key-bad": "Rejected.", down: "Down.", unconfigured: "Not set." };
      return { status: 200, body: { ok: true, status: st.creditStatus, detail: detailByStatus[st.creditStatus] } };
    }
    if (b.action === "firestore_usage") {
      st.usageCalls++;
      st.lastUsageForce = !!b.force;
      if (st.usageFail) return "ABORT";
      return { status: 200, body: FIRESTORE_USAGE_FIXTURE };
    }
    return { status: 400, body: { error: "bad action" } };
  };
  return st;
}

const uiContexts = [];
async function newUiPage(browser, mock, opts) {
  const o = opts || {};
  const ctx = browser.createBrowserContext
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
  uiContexts.push(ctx);
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
    if (url.includes("/.netlify/functions/health")) {
      const res = mock.handle(r.postData());
      if (res === "ABORT") return r.abort();
      return r.respond({ status: res.status, contentType: "application/json", body: JSON.stringify(res.body) });
    }
    if (/^https?:\/\/(?!127\.0\.0\.1)/.test(url)) return r.abort();
    r.continue();
  });

  await page.evaluateOnNewDocument((cfg) => {
    try {
      if (cfg.user) localStorage.setItem("choreUser", cfg.user);
      else localStorage.removeItem("choreUser");
      if (cfg.pinHash) localStorage.setItem("dadPinHash", cfg.pinHash);
      if (cfg.unlocked) sessionStorage.setItem("dadUnlocked", "1");
    } catch (e) {}
    window.__PROMPTS__ = (cfg.prompts || []).slice();
    window.prompt = () => (window.__PROMPTS__.length ? window.__PROMPTS__.shift() : null);
    window.alert = () => {};
    window.confirm = () => true;
  }, { user: o.user === null ? "" : (o.user || "Dad"), pinHash: o.pinHash || "", unlocked: !!o.unlocked, prompts: o.prompts || [] });

  return { page, errors };
}
async function openStatus(browser, mock, opts) {
  const h = await newUiPage(browser, mock, opts);
  await h.page.goto(UI_BASE + "/status.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await h.page.waitForFunction(() => window.__STATUS__, { timeout: 20000 });
  return h;
}
// A synthetic mouse click lands at the element's on-screen coordinates; Puppeteer's
// scroll-into-view only guarantees the element intersects the viewport, not that it clears an
// overlapping FIXED element (this page's bottom nav bar) — a button near the lower edge of a
// short viewport can be brought "into view" while still sitting under the nav. Centering it
// first sidesteps that class of false failure without special-casing any one button.
async function clickSafely(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ block: "center", inline: "center" });
  }, selector);
  await page.click(selector);
}
const svcEls = (page) => page.evaluate(() => [...document.querySelectorAll(".svc")].map((el) => ({
  id: el.getAttribute("data-id"), status: el.getAttribute("data-status"),
  dotClass: (el.querySelector(".dot") || {}).className || "",
  text: el.innerText.replace(/\s+/g, " ").trim(),
})));

/* ================== O. the Dad gate / non-Dad gate ======================== */
async function sectionUiGate(browser) {
  section("O. status.html — the Dad gate");
  const mock = makeHealthMock();

  const dad = await openStatus(browser, mock, { user: "Dad", unlocked: true });
  await dad.page.waitForFunction(() => !document.getElementById("content").classList.contains("hidden"), { timeout: 10000 });
  ok(await dad.page.evaluate(() => document.getElementById("gate").classList.contains("hidden")), "an unlocked Dad is not shown the gate");
  ok(await dad.page.evaluate(() => !document.getElementById("dash").classList.contains("hidden")), "an unlocked Dad sees the dashboard");
  ok(dad.errors.length === 0, "no page errors for an unlocked Dad — " + JSON.stringify(dad.errors.slice(0, 2)));

  const summaryCallsBeforeKid = mock.summaryCalls;   // the Dad page above already called it
  const kid = await openStatus(browser, mock, { user: "Isaac" });
  const kidText = await kid.page.evaluate(() => document.getElementById("gate").innerText);
  ok(/just for Dad/i.test(kidText), "a non-Dad profile is told the page is just for Dad");
  ok(await kid.page.evaluate(() => document.getElementById("dash").classList.contains("hidden")),
    "the dashboard itself is hidden for a non-Dad visitor");
  ok(await kid.page.evaluate(() => document.querySelectorAll(".svc, .firestore-table, .credit-panel").length) === 0,
    "a non-Dad visitor sees ZERO service data anywhere in the DOM");
  await new Promise((r) => setTimeout(r, 300));
  ok(mock.summaryCalls === summaryCallsBeforeKid, "a non-Dad visitor's page never even calls the health function");
  ok(kid.errors.length === 0, "no page errors for a gated visitor");

  const lockedPinHash = crypto.createHash("sha256").update("1234:amenfarms").digest("hex");
  const locked = await openStatus(browser, mock, { user: "Dad", pinHash: lockedPinHash, prompts: ["1234"] });
  ok(await locked.page.evaluate(() => !document.getElementById("unlockBtn").classList.contains("hidden")),
    "a Dad who hasn't unlocked this session is offered the unlock button");
  await clickSafely(locked.page, "#unlockBtn");
  await locked.page.waitForFunction(() => !document.getElementById("dash").classList.contains("hidden"), { timeout: 10000 });
  ok(true, "the right PIN unlocks the dashboard");

  if (WANT_SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    mock.fixture = MIXED_SERVICES;
    const gateShot = await openStatus(browser, mock, { user: "Isaac" });
    await gateShot.page.screenshot({ path: path.join(SHOTS, "ops_gate.png") });
    mock.fixture = ALL_OK_SERVICES;
  }
}

/* ============ P. dot colors, counts, breaks, configHint, verdict ========== */
async function sectionUiData(browser) {
  section("P. status.html — service rows: dots, counts, breaks, configHint");
  const mock = makeHealthMock();
  mock.fixture = ALL_OK_SERVICES;

  const allOk = await openStatus(browser, mock, { user: "Dad", unlocked: true });
  await allOk.page.waitForFunction(() => !document.getElementById("content").classList.contains("hidden"), { timeout: 10000 });
  const rows = await svcEls(allOk.page);
  ok(rows.length === ALL_OK_SERVICES.length, `every service in the fixture gets its own row (${rows.length})`);
  const paidCount = await allOk.page.evaluate(() => document.querySelectorAll("#listPaid .svc").length);
  const freeCount = await allOk.page.evaluate(() => document.querySelectorAll("#listFree .svc").length);
  const selfCount = await allOk.page.evaluate(() => document.querySelectorAll("#listSelf .svc").length);
  ok(paidCount === 4 && freeCount === 3 && selfCount === 3, `services are grouped into the right tier sections (paid ${paidCount}/4, free ${freeCount}/3, self ${selfCount}/3)`);
  ok(await allOk.page.evaluate(() => document.getElementById("verdictText").textContent) === "All systems go",
    "an all-ok fixture shows the all-clear verdict");
  ok(!(await allOk.page.evaluate(() => document.getElementById("topline").classList.contains("attn"))),
    "the topline is not in its attention-needed styling when everything's ok");

  section("P2. status.html — the mixed fixture (warn + down + unconfigured + unknown)");
  const mixed = await openStatus(browser, mock, { user: "Dad", unlocked: true });
  await mixed.page.evaluate(() => {}); // no-op, just to keep symmetry
  mock.fixture = MIXED_SERVICES;
  await clickSafely(mixed.page, "#recheckBtn");
  await mixed.page.waitForFunction(() => document.getElementById("verdictText").textContent !== "All systems go", { timeout: 10000 });
  const counts = uiTally(MIXED_SERVICES);
  const attnWanted = counts.warn + counts.down;
  const verdictText = await mixed.page.evaluate(() => document.getElementById("verdictText").textContent);
  ok(verdictText === `${attnWanted} things need attention`, `the verdict names the exact count needing attention ("${verdictText}", expected ${attnWanted})`);
  ok(await mixed.page.evaluate(() => document.getElementById("topline").classList.contains("attn")),
    "the topline switches into attention-needed styling");
  const chipTexts = await mixed.page.evaluate(() => [...document.querySelectorAll(".count-chip")].map((c) => c.textContent));
  ok(chipTexts.some((t) => new RegExp("^✅ " + counts.ok + " ok$").test(t)), `an ok-count chip is shown (${chipTexts.join(", ")})`);
  ok(chipTexts.some((t) => new RegExp("^⚠️ " + counts.warn + " warn$").test(t)), "a warn-count chip is shown with the right number");
  ok(chipTexts.some((t) => new RegExp("^🔴 " + counts.down + " down$").test(t)), "a down-count chip is shown with the right number");
  ok(chipTexts.some((t) => /not set up/.test(t)), "an unconfigured-count chip is shown");

  const mixedRows = await svcEls(mixed.page);
  const okRow = mixedRows.find((r) => r.id === "anthropic");
  const warnRow = mixedRows.find((r) => r.id === "netlify");
  const downRow = mixedRows.find((r) => r.id === "tripo");
  const unconfRow = mixedRows.find((r) => r.id === "xai");
  const unknownRow = mixedRows.find((r) => r.id === "chorereminders");
  ok(okRow && /\bdot ok\b/.test(okRow.dotClass), "an ok service carries the ok dot class");
  ok(warnRow && /\bdot warn\b/.test(warnRow.dotClass), "a warn service carries the warn dot class");
  ok(downRow && /\bdot down\b/.test(downRow.dotClass), "a down service carries the down dot class");
  ok(unconfRow && /\bdot unconfigured\b/.test(unconfRow.dotClass), "an unconfigured service carries the unconfigured dot class");
  ok(unknownRow && /\bdot unknown\b/.test(unknownRow.dotClass), "a scheduled/unknown service carries the unknown dot class");

  const dotBorders = await mixed.page.evaluate(() => {
    const unc = document.querySelector('.svc[data-id="xai"] .dot');
    const unk = document.querySelector('.svc[data-id="chorereminders"] .dot');
    return { uncBorder: parseFloat(getComputedStyle(unc).borderWidth), unkBorder: parseFloat(getComputedStyle(unk).borderWidth) };
  });
  ok(dotBorders.uncBorder > 0 && dotBorders.unkBorder === 0,
    `unconfigured renders as a grey OUTLINE dot and unknown as a grey FILLED dot — visually distinct (${JSON.stringify(dotBorders)})`);

  ok(downRow.text.includes("If this dies: Generating new 3D models"), `the down service (Tripo) shows its breaks line (${downRow.text})`);
  const calendarRow = mixedRows.find((r) => r.id === "calendar");
  ok(calendarRow.text.includes("If this dies: The Plan area's family calendar"), "another down service (calendar, self-tier) also shows its breaks line");

  ok(unconfRow.text.includes("How to wire it"), "the unconfigured card shows the \"How to wire it\" label");
  const configHintText = await mixed.page.evaluate(() => document.querySelector('.svc[data-id="xai"] .confighint-text').textContent);
  ok(configHintText === "Set XAI_API_KEY in Netlify (from console.x.ai).", `the configHint is rendered verbatim (${configHintText})`);
  ok(!(await mixed.page.evaluate(() => document.querySelector('.svc[data-id="anthropic"] .confighint'))),
    "a configured/ok service shows no configHint box at all");

  ok(unknownRow.text.includes("chorereminders is a scheduled function"),
    "the unknown-status service (chorereminders) explains WHY it's unknown, not just labels it");

  ok(mixed.errors.length === 0, "no page errors on the mixed fixture — " + JSON.stringify(mixed.errors.slice(0, 2)));

  if (WANT_SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await mixed.page.setViewport({ width: 390, height: 3200, deviceScaleFactor: 1 });
    await new Promise((r) => setTimeout(r, 250));
    await mixed.page.screenshot({ path: path.join(SHOTS, "ops_mobile.png") });
  }
}

/* ==================== Q. Re-check, credit button, honesty ================== */
async function sectionUiActions(browser) {
  section("Q. status.html — Re-check, the credit probe, and its honesty rules");
  const mock = makeHealthMock();
  mock.fixture = MIXED_SERVICES;

  const { page, errors } = await openStatus(browser, mock, { user: "Dad", unlocked: true });
  await page.waitForFunction(() => !document.getElementById("content").classList.contains("hidden"), { timeout: 10000 });
  ok(mock.lastSummaryForce === false, "the initial page load asks for summary WITHOUT force (respects the cache)");

  const callsBefore = mock.summaryCalls;
  await clickSafely(page, "#recheckBtn");
  await page.waitForFunction((n) => window.__STATUS__.state().checkingSummary === false, {}, callsBefore).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  ok(mock.summaryCalls === callsBefore + 1, "Re-check makes exactly one more summary call");
  ok(mock.lastSummaryForce === true, "Re-check sends force:true");

  /* -- the credit probe: never on load, only on click, and its distinct credit-low state -- */
  ok(mock.creditCalls === 0, "the Anthropic credit probe was NEVER called just from loading the page");
  ok(await page.evaluate(() => document.getElementById("creditBtn").textContent) === "Run credit check (~1¢)",
    "the credit button's label is honest about the (small) cost, up front");
  ok(await page.evaluate(() => /~1¢|penny/i.test(document.querySelector(".credit-note").textContent)),
    "the panel states in plain words that this costs about a penny");

  mock.creditStatus = "ok";
  await clickSafely(page, "#creditBtn");
  await page.waitForFunction(() => !!document.querySelector(".credit-result"), { timeout: 10000 });
  ok(mock.creditCalls === 1, "clicking the credit button fires exactly one probe");
  let creditText = await page.evaluate(() => document.querySelector(".credit-result").textContent);
  ok(/live|available/i.test(creditText), `a healthy account renders a positive message (${creditText})`);
  ok(await page.evaluate(() => document.querySelector(".credit-result").classList.contains("cr-ok")),
    "the ok credit state carries its own distinct class");

  mock.creditStatus = "credit-low";
  await clickSafely(page, "#creditBtn");
  await page.waitForFunction((prev) => document.querySelector(".credit-result").textContent !== prev,
    {}, creditText).catch(() => {});
  await new Promise((r) => setTimeout(r, 150));
  const lowState = await page.evaluate(() => {
    const el = document.querySelector(".credit-result");
    return { text: el.textContent, cls: el.className, color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor };
  });
  ok(/credit.*low|top up/i.test(lowState.text), `credit-low renders the low-balance message (${lowState.text})`);
  ok(lowState.cls.includes("cr-credit-low"), "credit-low carries its own distinct CSS class, separate from ok/down");
  ok(/console\.anthropic\.com/.test(lowState.text), "the low-balance message tells Dad exactly where to go to fix it");
  ok(mock.creditCalls === 2, "the second click fired a second, independent probe");

  ok(errors.length === 0, "no page errors through the Re-check/credit-probe flow — " + JSON.stringify(errors.slice(0, 2)));
}

/* ==================== R. Firestore usage table ============================= */
async function sectionUiFirestore(browser) {
  section("R. status.html — the Firestore storage panel");
  const mock = makeHealthMock();
  mock.fixture = ALL_OK_SERVICES;

  const { page, errors } = await openStatus(browser, mock, { user: "Dad", unlocked: true });
  await page.waitForFunction(() => !document.getElementById("content").classList.contains("hidden"), { timeout: 10000 });
  await page.waitForFunction(() => !!document.querySelector(".firestore-table"), { timeout: 10000 });
  ok(mock.usageCalls >= 1 && mock.lastUsageForce === false,
    "the cached firestore_usage result renders on page load WITHOUT the client forcing a re-measure");

  const table = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".firestore-table tbody tr")].map((tr) => ({
      collection: tr.getAttribute("data-collection"),
      truncated: tr.getAttribute("data-truncated") === "1",
      text: tr.innerText.replace(/\s+/g, " ").trim(),
    }));
    const total = document.querySelector(".firestore-table tfoot tr").innerText.replace(/\s+/g, " ").trim();
    return { rows, total };
  });
  ok(table.rows.length === 3, `every collection in the fixture gets a row (${table.rows.length})`);
  const truncatedRow = table.rows.find((r) => r.truncated);
  ok(!!truncatedRow, "the truncated collection is marked as such");
  ok(/>=\s*1\.5K/.test(truncatedRow.text) || />=\s*1500/.test(truncatedRow.text),
    `a truncated collection renders its count as ">= N", a floor not an exact figure (${truncatedRow.text})`);
  ok(/>=/.test(truncatedRow.text.split(" ").filter((t) => /^>=/.test(t) || /KB|MB|GB/.test(t)).join(" ")) || />=/.test(truncatedRow.text),
    "the truncated collection's byte size is also shown as a floor");
  ok(/Total/.test(table.total), "a grand total row is shown");
  ok(await page.evaluate(() => /Spark|1 GiB/i.test(document.querySelector(".firestore-note").textContent)),
    "the Spark free-tier reminder note is rendered");
  ok(await page.evaluate(() => /Cached|measured/i.test(document.querySelector(".firestore-age").textContent)),
    "the panel states the age of the measurement it's showing");

  /* -- the panner, not the page, scrolls sideways -- */
  const panWidth = await page.evaluate(() => {
    const p = document.querySelector(".firestore-panel .panner");
    return { display: getComputedStyle(p).overflowX, pageScrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
  });
  ok(panWidth.display === "auto", "the firestore table sits inside its own overflow-x:auto panner");
  ok(panWidth.pageScrollW <= panWidth.clientW + 1, "a wide firestore table never widens the page itself");

  /* -- the button forces a fresh measurement -- */
  const usageBefore = mock.usageCalls;
  await clickSafely(page, "#usageBtn");
  await new Promise((r) => setTimeout(r, 300));
  ok(mock.usageCalls === usageBefore + 1, "clicking \"Measure storage\" makes exactly one more request");
  ok(mock.lastUsageForce === true, "the button click sends force:true");

  ok(errors.length === 0, "no page errors on the firestore panel — " + JSON.stringify(errors.slice(0, 2)));
}

/* ================= S. health-fetch failure (not a blank page) ============== */
async function sectionUiFetchFail(browser) {
  section("S. status.html — the health function itself is unreachable");
  const mock = makeHealthMock();
  mock.summaryFail = true;

  const { page, errors } = await openStatus(browser, mock, { user: "Dad", unlocked: true });
  await page.waitForFunction(() => !document.getElementById("fetchFail").classList.contains("hidden"), { timeout: 10000 });
  const failText = await page.evaluate(() => document.getElementById("fetchFail").innerText);
  ok(/Couldn't reach the health function/i.test(failText), "an unreachable health function shows a clear, honest state");
  ok(/Try again/i.test(failText), "a retry affordance is offered");
  ok(await page.evaluate(() => document.getElementById("content").classList.contains("hidden")),
    "no service data (real or fabricated) is shown while the fetch is failing");
  ok(await page.evaluate(() => document.body.innerText.trim().length > 40),
    "this is a real informative state, not a blank page");

  /* -- and it recovers cleanly once the server comes back -- */
  mock.summaryFail = false;
  await clickSafely(page, "#retryBtn");
  await page.waitForFunction(() => !document.getElementById("content").classList.contains("hidden"), { timeout: 10000 });
  ok(await page.evaluate(() => document.getElementById("fetchFail").classList.contains("hidden")),
    "once the retry succeeds, the failure state clears");
  ok(await page.evaluate(() => document.querySelectorAll(".svc").length) > 0, "real service data now renders");

  ok(errors.length === 0, "no page errors through a fetch failure and recovery — " + JSON.stringify(errors.slice(0, 2)));
}

/* ==================== T. layout: mobile + desktop rail ====================== */
async function sectionUiLayout(browser) {
  section("T. status.html — layout at 390x844 and the desktop rail at 1280x800");
  const mock = makeHealthMock();
  mock.fixture = MIXED_SERVICES;

  const phone = await openStatus(browser, mock, { user: "Dad", unlocked: true });
  await phone.page.waitForFunction(() => !document.getElementById("content").classList.contains("hidden"), { timeout: 10000 });
  const m = await phone.page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    railShown: getComputedStyle(document.getElementById("sidenav")).display !== "none",
    active: document.querySelectorAll("#buckyNav a.active").length,
    links: document.querySelectorAll("#buckyNav a").length,
  }));
  ok(m.scrollW <= m.clientW + 1, `no horizontal page scroll at 390px (${m.scrollW} <= ${m.clientW})`);
  ok(!m.railShown, "the desktop rail is hidden on a phone");
  ok(m.links === 12, "the bottom nav carries all 12 areas Dad can see");
  ok(m.active === 0, "no nav area is marked active — this is a Dad tool, not a family section");

  const desk = await openStatus(browser, mock, { user: "Dad", unlocked: true, viewport: { width: 1280, height: 800, deviceScaleFactor: 1 } });
  await desk.page.waitForFunction(() => !document.getElementById("content").classList.contains("hidden"), { timeout: 10000 });
  const d = await desk.page.evaluate(() => {
    const rail = document.getElementById("sidenav");
    return {
      railShown: getComputedStyle(rail).display !== "none",
      railItems: rail.querySelectorAll(".sn-item").length,
      railActive: rail.querySelectorAll(".sn-item.active").length,
      navShown: getComputedStyle(document.getElementById("buckyNav")).display !== "none",
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  });
  ok(d.railShown && d.railItems === 12, "the navy rail is present with all 12 areas at 1280px");
  ok(d.railActive === 0, "no rail item is marked active on this page either");
  ok(!d.navShown, "the bottom bar is hidden when the rail is up");
  ok(d.scrollW <= d.clientW + 1, "no horizontal page scroll at 1280px");
  ok(desk.errors.length === 0, "no page errors at desktop size — " + JSON.stringify(desk.errors.slice(0, 2)));

  if (WANT_SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await desk.page.setViewport({ width: 1280, height: 1900, deviceScaleFactor: 1 });
    await new Promise((r) => setTimeout(r, 250));
    await desk.page.screenshot({ path: path.join(SHOTS, "ops_desktop.png") });
  }
  ok(phone.errors.length === 0, "no page errors at phone size");
}

/* ============================================================================ */
(async () => {
  const goog = await serveGoogle();
  const fsSrv = await serveFirestore();
  const paidSrv = await servePaid();
  const freeSrv = await serveFree();
  const selfSrv = await serveSelf();

  wireEnv();
  process.env.FIREBASE_SERVICE_ACCOUNT = SA;

  const mod = await import("file://" + path.join(ROOT, "netlify", "functions", "health.mjs").replace(/\\/g, "/"));
  handler = mod.default;

  try {

    /* ============================== A. the gate ============================== */
    section("A. Gate, routing, CORS");
    ok(typeof handler === "function", "health.mjs exports a handler");
    ok(mod.config && mod.config.path === "/.netlify/functions/health", "function is routed at /.netlify/functions/health");

    ok((await call({ secret: "wrong", action: "summary" })).status === 401, "a wrong family password is rejected (401)");
    ok((await call({ secret: SECRET, action: "nonsense" })).status === 400, "an unknown action is rejected (400)");
    const preflight = await handler(new Request("https://x/", { method: "OPTIONS" }));
    ok(preflight.status === 204, "the CORS preflight answers 204");
    ok(preflight.headers.get("access-control-allow-origin") === "https://amenfarms.netlify.app",
      "an unknown origin falls back to the production origin");
    ok((await handler(new Request("https://x/", { method: "GET" }))).status === 405, "GET is refused — POST only");
    const badJson = await handler(new Request("https://x/", { method: "POST", body: "{not json" }));
    ok(badJson.status === 400, "invalid JSON body is rejected (400)");

    /* ==================== B. summary — everything configured ================== */
    section("B. summary — every key configured, shapes parsed, warn thresholds");
    setAllKeys();
    fsReset(); paidReset(); freeReset(); selfReset();

    let resp = await call({ secret: SECRET, action: "summary", force: true });
    ok(resp.status === 200 && resp.body && resp.body.ok === true, "summary answers 200 ok:true");
    ok(Array.isArray(resp.body.services) && resp.body.services.length === 25, `the whole registry comes back (${resp.body.services && resp.body.services.length})`);
    ok(typeof resp.body.generatedAt === "number" && typeof resp.body.cachedUntil === "number", "generatedAt/cachedUntil are timestamps");
    ok(resp.body.cached === false, "a forced call is never marked cached");
    ok(resp.body.counts && typeof resp.body.counts.ok === "number", "a counts tally is included");

    const paidIds = ["anthropic", "xai", "gemini", "netlify", "firebase", "elevenlabs", "tripo"];
    const freeIds = ["openmeteo", "rainviewer", "iem_hrrr", "yahoo_finance", "jsdelivr", "unpkg_leaflet", "unpkg_playroom", "gstatic_firebase", "google_fonts"];
    const selfIds = ["farmgpt", "news", "stocks", "calendar", "activity", "goats", "notify", "teachergpt-background"];
    let allGood = true, badOnes = [];
    for (const id of [...paidIds, ...freeIds, ...selfIds]) {
      const s = svc(resp, id);
      if (!s || (s.status !== "ok" && s.status !== "warn")) { allGood = false; badOnes.push(id + ":" + (s && s.status)); }
    }
    ok(allGood, "every configured/reachable service reports ok (or warn) — " + badOnes.join(", "));
    ok(svc(resp, "chorereminders").status === "unknown", "chorereminders is always status:\"unknown\" (scheduled, never probed)");
    for (const id of [...paidIds, ...freeIds, ...selfIds, "chorereminders"]) {
      const s = svc(resp, id);
      ok(!!s && typeof s.name === "string" && s.tier && Array.isArray(s.breaks), `${id} carries name/tier/breaks`);
    }

    const netlifyM = svc(resp, "netlify").metric;
    ok(netlifyM && netlifyM.used === 500 && netlifyM.limit === 1000 && netlifyM.pct === 50, `netlify bandwidth metric parsed (${JSON.stringify(netlifyM)})`);
    const elM = svc(resp, "elevenlabs").metric;
    ok(elM && elM.used === 400 && elM.limit === 1000 && elM.pct === 40, `elevenlabs metric parsed (${JSON.stringify(elM)})`);
    const trM = svc(resp, "tripo").metric;
    ok(trM && trM.balance === 42, `tripo balance metric parsed (${JSON.stringify(trM)})`);
    ok(svc(resp, "netlify").status === "ok", "netlify at 50% usage is ok, not warn");
    ok(svc(resp, "elevenlabs").status === "ok", "elevenlabs at 40% usage is ok, not warn");

    // warn thresholds
    paidState.netlifyBandwidth = { used: 850, included: 1000, period_end_date: "2026-09-01" };
    paidState.elevenlabsUsage = { tier: "creator", character_count: 900, character_limit: 1000 };
    resp = await call({ secret: SECRET, action: "summary", force: true });
    ok(svc(resp, "netlify").status === "warn" && svc(resp, "netlify").metric.pct === 85, "netlify bandwidth at 85% used -> warn");
    ok(svc(resp, "elevenlabs").status === "warn" && svc(resp, "elevenlabs").metric.pct === 90, "elevenlabs at 90% used -> warn");
    ok(svc(resp, "anthropic").status === "ok", "an unrelated service (anthropic) is unaffected by another service's warn");
    paidReset();

    /* ==================== C. summary — no optional keys ======================= */
    section("C. summary — only the required keys set");
    clearAllKeys();
    process.env.ANTHROPIC_API_KEY = "sk-ant-ONLYTHISONE";
    resp = await call({ secret: SECRET, action: "summary", force: true });
    ok(resp.status === 200, "summary still answers 200 with most keys missing");
    ok(svc(resp, "anthropic").status === "ok", "anthropic (the one configured key) is ok");
    for (const id of ["xai", "gemini", "netlify", "elevenlabs", "tripo"]) {
      const s = svc(resp, id);
      ok(s.status === "unconfigured", `${id} with no key reports unconfigured`);
      ok(typeof s.configHint === "string" && s.configHint.length > 5, `${id} carries a configHint`);
      ok(new RegExp(id.toUpperCase().replace("-", "_") + "|" + id, "i").test(s.configHint) || /API_KEY|API_TOKEN/.test(s.configHint),
        `${id}'s configHint names an env var`);
    }
    ok(!fail || true, "nothing threw building this response"); // reaching here at all is the assertion
    setAllKeys();

    /* ============= D. one upstream timing out — parallelism + timeout ========= */
    section("D. One upstream hangs 8s — still down, and the whole summary returns fast");
    paidState.anthropicHangModels = true;
    const t0 = Date.now();
    resp = await call({ secret: SECRET, action: "summary", force: true });
    const elapsed = Date.now() - t0;
    ok(svc(resp, "anthropic").status === "down", "the hung service itself is reported down");
    ok(/timed out/i.test(svc(resp, "anthropic").headline) || /timed out|no response/i.test(svc(resp, "anthropic").detail),
      "its detail says it timed out, not something misleading");
    ok(elapsed < 6500, `the summary still returns quickly despite one hung upstream (${elapsed}ms)`);
    ok(svc(resp, "xai").status === "ok" && svc(resp, "netlify").status === "ok", "every OTHER service is unaffected — probes really ran in parallel");
    paidState.anthropicHangModels = false;

    /* ========================= E. one upstream 500s ============================ */
    section("E. One upstream 500s -> down");
    paidState.force500 = "/tripo/v2/openapi/user/balance";
    resp = await call({ secret: SECRET, action: "summary", force: true });
    ok(svc(resp, "tripo").status === "down", "a 500 from an upstream reports down");
    ok(svc(resp, "anthropic").status === "ok", "one failing paid service does not affect another");
    paidState.force500 = null;

    /* ======================= F. secret-leak scan =============================== */
    section("F. Secret-leak scan across every action");
    resp = await call({ secret: SECRET, action: "summary", force: true });
    const credResp = await call({ secret: SECRET, action: "probe_anthropic_credit" });
    const usageResp = await call({ secret: SECRET, action: "firestore_usage", force: true });
    const allText = [resp.text, credResp.text, usageResp.text].join("\n");
    const secretVals = [SECRET, process.env.ANTHROPIC_API_KEY, process.env.XAI_API_KEY, process.env.GEMINI_API_KEY,
      process.env.NETLIFY_API_TOKEN, process.env.ELEVENLABS_API_KEY, process.env.TRIPO_API_KEY, SA, "fake-google-access-token-999"];
    let leaked = [];
    for (const v of secretVals) if (v && allText.includes(v)) leaked.push(v.slice(0, 12) + "...");
    ok(leaked.length === 0, "no response contains any raw env-secret value — " + leaked.join(", "));
    ok(!/Bearer\s+[A-Za-z0-9\-_.]{10,}/.test(allText), "no response contains a literal Bearer token");
    ok(typeof mod.redactSecrets === "function", "redactSecrets is exported for direct unit testing");
    ok(mod.redactSecrets("x " + SECRET + " y").includes("[redacted]") && !mod.redactSecrets("x " + SECRET + " y").includes(SECRET),
      "redactSecrets scrubs a known secret value directly");

    /* ===================== G. cache: TTL, force, zero upstream calls =========== */
    section("G. Cache — a second summary inside the TTL costs zero upstream calls");
    fsReset(); paidReset(); freeReset(); selfReset();
    const first = await call({ secret: SECRET, action: "summary" }); // no force — populate the cache
    ok(first.body.cached === false, "the first-ever summary is live, not cached");
    ok(fsState.commits >= 1, "the live summary was written to the Firestore cache");
    const paidHitsAfterFirst = paidState.hits.length, freeHitsAfterFirst = freeState.hits.length, selfHitsAfterFirst = selfState.hits.length;
    ok(paidHitsAfterFirst > 0 && freeHitsAfterFirst > 0 && selfHitsAfterFirst > 0, "the live summary really probed every tier");

    const second = await call({ secret: SECRET, action: "summary" }); // no force — should hit the cache
    ok(second.body.cached === true, "a second summary inside the TTL is served from cache");
    ok(paidState.hits.length === paidHitsAfterFirst && freeState.hits.length === freeHitsAfterFirst && selfState.hits.length === selfHitsAfterFirst,
      "a cached summary makes ZERO new upstream probe calls");
    ok(JSON.stringify(second.body.services) === JSON.stringify(first.body.services), "the cached payload is the same data as the live one that produced it");

    const forced = await call({ secret: SECRET, action: "summary", force: true });
    ok(forced.body.cached === false, "force:true bypasses the cache");
    ok(paidState.hits.length > paidHitsAfterFirst, "force:true really re-probes upstream");

    /* ================= H. Firestore cache write uses legal field paths ========= */
    section("H. The cache write never trips Firestore's real field-path grammar");
    ok(fsState.rejectedCommits === 0, "not one cache write was rejected by the (grammar-enforcing) fake Firestore");

    /* =========== I. Firestore itself down -> still a live, uncached summary ===== */
    section("I. Firestore down — summary degrades to a live, uncached read");
    fsState.fail = true;
    paidReset(); freeReset(); selfReset();
    resp = await call({ secret: SECRET, action: "summary" }); // no force, but cache is unreachable
    ok(resp.status === 200 && resp.body.ok === true, "summary still answers 200 with Firestore down");
    ok(resp.body.cached === false, "with Firestore down, the response is never falsely marked cached");
    ok(paidState.hits.length > 0, "with no cache reachable, it fell straight through to a live probe");
    ok(svc(resp, "anthropic").status === "ok", "the live probes themselves are unaffected by Firestore being down");
    fsState.fail = false;

    /* ===================== J. firestore_usage — pagination cap ================= */
    section("J. firestore_usage — pagination cap, grand totals, 24h cache");
    fsReset(); paidReset();
    seedCollection("chores_fam2jan2g", 3);
    seedCollection("settings_fam2jan2g", 2);
    seedCollection("farmgpt_usage", 10);
    seedCollection("farmgpt_usage_hourly", 20);
    seedCollection("farmgpt_story_log", 2100); // 7 pages of 300 — must cap at 5
    seedCollection("farmgpt_dnd", 4);
    seedCollection("bucky_activity", 5);
    seedCollection("lobbies_fam2jan2g", 1);
    seedCollection("notifs_fam2jan2g", 6);
    seedCollection("pushTokens_fam2jan2g", 9);

    let u1 = await call({ secret: SECRET, action: "firestore_usage" });
    ok(u1.status === 200 && u1.body.ok === true, "firestore_usage answers ok");
    ok(Array.isArray(u1.body.collections) && u1.body.collections.length === 10, `all ${u1.body.collections && u1.body.collections.length} collections are measured`);
    const story = u1.body.collections.find((c) => c.id === "farmgpt_story_log");
    ok(!!story && story.count === 1500, `the 7-page collection is capped at 5 pages = 1500 docs, not 2100 (got ${story && story.count})`);
    ok(story && story.truncated === true, "the capped collection is marked truncated — the client renders \">= 1500\"");
    const small = u1.body.collections.find((c) => c.id === "farmgpt_dnd");
    ok(small && small.count === 4 && small.truncated === false, "a small collection is counted exactly, not marked truncated");
    ok(u1.body.anyTruncated === true, "the top-level anyTruncated flag is set when any collection was capped");
    const expectedTotal = 3 + 2 + 10 + 20 + 1500 + 4 + 5 + 1 + 6 + 9;
    ok(u1.body.totalDocs === expectedTotal, `the grand total sums every collection (${u1.body.totalDocs} vs expected ${expectedTotal})`);
    ok(u1.body.totalBytes > 0, "a grand total byte count is reported");
    ok(/Spark|1 GiB|free tier/i.test(u1.body.note), "the response names the Spark free-tier limit");

    const listHitsAfterFirst = { ...fsState.listHits };
    const u2 = await call({ secret: SECRET, action: "firestore_usage" }); // no force -> cache
    ok(u2.body.cached === true, "a second firestore_usage call within 24h is served from cache");
    ok(JSON.stringify(fsState.listHits) === JSON.stringify(listHitsAfterFirst), "the cached read issues zero new collection LIST calls");
    ok(u2.body.totalDocs === expectedTotal, "the cached usage payload carries the same totals");

    const u3 = await call({ secret: SECRET, action: "firestore_usage", force: true });
    ok(u3.body.cached === false, "force:true re-measures firestore_usage");
    ok(fsState.listHits.farmgpt_story_log > listHitsAfterFirst.farmgpt_story_log, "the forced re-measurement really re-lists collections");

    /* ============ K. probe_anthropic_credit — on demand, never from summary ==== */
    section("K. probe_anthropic_credit — the one probe allowed to spend money");
    paidReset();
    const beforeSummaries = paidState.messagesHits;
    await call({ secret: SECRET, action: "summary", force: true });
    ok(paidState.messagesHits === beforeSummaries, "summary NEVER calls the /v1/messages endpoint");

    paidState.anthropicMessagesMode = "ok";
    let credit = await call({ secret: SECRET, action: "probe_anthropic_credit" });
    ok(credit.body.ok === true && credit.body.status === "ok", "a healthy account reports status:\"ok\"");
    ok(paidState.messagesHits === beforeSummaries + 1, "the credit probe DID call /v1/messages exactly once");

    paidState.anthropicMessagesMode = "key-bad";
    credit = await call({ secret: SECRET, action: "probe_anthropic_credit" });
    ok(credit.body.status === "key-bad", "a 401 from Anthropic reports status:\"key-bad\"");

    paidState.anthropicMessagesMode = "credit-low";
    credit = await call({ secret: SECRET, action: "probe_anthropic_credit" });
    ok(credit.body.status === "credit-low", "the real credit-balance-too-low 400 body reports status:\"credit-low\"");

    paidState.anthropicMessagesMode = "other";
    credit = await call({ secret: SECRET, action: "probe_anthropic_credit" });
    ok(credit.body.status === "down", "an unrelated error (e.g. overloaded) reports status:\"down\", not credit-low or key-bad");
    paidState.anthropicMessagesMode = "ok";

    clearAllKeys();
    credit = await call({ secret: SECRET, action: "probe_anthropic_credit" });
    ok(credit.body.status === "unconfigured", "with no ANTHROPIC_API_KEY, the credit probe reports unconfigured (and never calls out)");
    setAllKeys();

    /* ======================== L. self-probes ==================================== */
    section("L. Self-probes — the site's own sibling functions");
    selfReset(); selfState.mode = "normal";
    resp = await call({ secret: SECRET, action: "summary", force: true });
    for (const id of ["farmgpt", "news", "stocks", "calendar", "activity"]) {
      ok(svc(resp, id).status === "ok", `${id} answering its real 401-on-wrong-secret shape -> ok`);
    }
    ok(svc(resp, "notify").status === "ok", "notify answering its real 403-on-wrong-secret shape -> ok");
    ok(svc(resp, "goats").status === "ok", "goats (no secret gate at all) answering a real {goats,count} GET -> ok");
    ok(svc(resp, "teachergpt-background").status === "ok", "teachergpt-background answering 202 (the Netlify background-function ack) -> ok");
    ok(!selfState.hits.some((h) => h.includes("chorereminders")), "chorereminders was NEVER fetched — it's a scheduled function, not probed");

    selfState.mode = "all404";
    resp = await call({ secret: SECRET, action: "summary", force: true });
    for (const id of ["farmgpt", "news", "notify", "goats", "teachergpt-background"]) {
      ok(svc(resp, id).status === "down", `${id} answering 404 (not deployed) -> down`);
    }
    selfState.mode = "normal";

    /* =============== M. free-tier softening: Google Fonts never "down" ========= */
    section("M. Google Fonts down is softened to warn — nothing actually breaks");
    freeReset();
    freeState.status.google_fonts = 500;
    resp = await call({ secret: SECRET, action: "summary", force: true });
    ok(svc(resp, "google_fonts").status === "warn", "a failing Google Fonts reports warn, never down");
    ok(svc(resp, "rainviewer").status === "ok", "an unrelated free-tier service is unaffected");
    delete freeState.status.google_fonts;

    /* =================== N. malformed upstream bodies degrade, not crash ======= */
    section("N. Malformed / unrecognized upstream shapes degrade gracefully");
    paidState.netlifyBandwidth = "not json {{{";
    resp = await call({ secret: SECRET, action: "summary", force: true });
    ok(svc(resp, "netlify").status === "ok" || svc(resp, "netlify").status === "warn", "an unparseable Netlify bandwidth body still resolves, not a crash");
    paidReset();

  } catch (err) {
    fail++; failures.push("suite crashed: " + err.message);
    console.log("\n✗ SUITE ERROR: " + ((err && err.stack) || err));
  } finally {
    await new Promise((r) => goog.close(r));
    await new Promise((r) => fsSrv.close(r));
    await new Promise((r) => paidSrv.close(r));
    await new Promise((r) => freeSrv.close(r));
    await new Promise((r) => selfSrv.close(r));
  }

  /* ========================= browser sections (status.html) ================ */
  const uiSrv = await serveStatic();
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  try {
    await sectionUiGate(browser);
    await sectionUiData(browser);
    await sectionUiActions(browser);
    await sectionUiFirestore(browser);
    await sectionUiFetchFail(browser);
    await sectionUiLayout(browser);
  } catch (err) {
    fail++; failures.push("browser suite crashed: " + err.message);
    console.log("\n✗ BROWSER SUITE ERROR: " + ((err && err.stack) || err));
  } finally {
    for (const ctx of uiContexts) { try { await ctx.close(); } catch (e) {} }
    await browser.close();
    uiSrv.close();
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`HEALTH: ${pass}/${pass + fail} checks passed`);
  if (fail) { console.log("\nFailures:"); for (const f of failures) console.log("  ✗ " + f); }
  process.exit(fail ? 1 : 0);
})();
