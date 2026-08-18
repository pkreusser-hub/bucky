// _gffl_race_kit.cjs — the two-device shared-store harness the three GFFL race repros run on.
//
// NOT A TEST. It is the smallest thing that can stage a genuine multi-device race against the
// REAL app: a static server, a NODE-SIDE Firestore REST fixture that every browser context
// answers out of (so two pages really do share one store, rather than two copies of one), and
// a page factory that boots league.html against it.
//
// WHY A SHARED FILE RATHER THAN THREE STANDALONE SCRIPTS: each repro's own file is then only
// the race it exists to reproduce — the staging, the two devices' actions, and the one
// assertion — which is what makes a repro readable as evidence. Every script still runs on its
// own (`node tools/_gffl_race_<name>.cjs`) and needs nothing but this file beside it.
//
// The REST fixture and its wire codec deliberately MIRROR tools/_verify-gffl.cjs's own
// (sections AB / AR7) rather than importing them: that file is a 15k-line suite whose exports
// are its checks, and an independent implementation of the encoding is what keeps a round-trip
// assertion from being a function agreeing with itself.
//
// SCRATCH NAMESPACE: ?fam=racekit. Nothing here can reach family data — and every upstream
// (gstatic/googleapis/firebase, ESPN, Sleeper) is answered or aborted inside the browser, so
// there is no real network at all.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.GFFL_RACE_PORT || 8884);
const BASE = "http://127.0.0.1:" + PORT;
const FAM = "racekit";
const SEASON = 2026;
const FS_DOC_ROOT = "projects/amen-farms-app/databases/(default)/documents";

// ---------------------------------------------------------------------------- reporting
let PASS = 0; const FAILS = [];
function ok(cond, msg) {
  if (cond) { PASS++; console.log("  ok   " + msg); }
  else { FAILS.push(msg); console.log("  FAIL " + msg); }
  return !!cond;
}
function head(t) { console.log("\n" + t + "\n" + "-".repeat(t.length)); }
function done(title) {
  console.log("\n" + title + ": " + PASS + " passed, " + FAILS.length + " failed");
  if (FAILS.length) { console.log("\nFAILURES:"); for (const f of FAILS) console.log("  · " + f); }
  return FAILS.length ? 1 : 0;
}

// ---------------------------------------------------------------------------- static server
function startStatic() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0].split("#")[0]).replace(/^\/+/, "");
      const file = path.join(ROOT, rel || "index.html");
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end("no");
      }
      res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(fs.readFileSync(file));
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

// ---------------------------------------------------------------------------- wire codec
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === "object") { const f = {}; for (const k of Object.keys(v)) f[k] = enc(v[k]); return { mapValue: { fields: f } }; }
  return { nullValue: null };
}
function dec(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return !!v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("mapValue" in v) { const o = {}; const f = v.mapValue.fields || {}; for (const k of Object.keys(f)) o[k] = dec(f[k]); return o; }
  return null;
}
// ---------------------------------------------------------------------------- updateTime
// THE FIXTURE MUST BE ABLE TO REFUSE (2026-08-18, the CAS rework). Firestore returns an
// `updateTime` on every read and honours `currentDocument.updateTime` / `currentDocument.exists`
// on every write — that precondition is the entire mechanism lg-core's LG.db.update is built
// on. A fixture that answered reads with no updateTime and accepted every PATCH would make
// every compare-and-swap check here pass for the wrong reason, which is the house's own
// "a fixture kinder than reality hides bugs" law. So this store versions each doc, stamps the
// version on every read, and answers a stale write with the real FAILED_PRECONDITION shape.
//
// The version is a MONOTONIC COUNTER rendered as a timestamp string. Firestore's own value is
// a wall-clock timestamp, which cannot distinguish two writes inside the same millisecond —
// and this harness exists precisely to stage writes inside the same millisecond.
let VER = 0;
const stamp = () => "2026-01-01T00:00:00." + String(++VER).padStart(9, "0") + "Z";
const wireDoc = (id, d, S) => {
  const fields = {};
  for (const k of Object.keys(d || {})) fields[k] = enc(d[k]);
  const out = { name: FS_DOC_ROOT + "/gffl_" + FAM + "/" + id, fields };
  if (S && S.vers) out.updateTime = S.vers[id] || (S.vers[id] = stamp());
  return out;
};
// The body Firestore really answers a failed precondition with.
const PRECON_FAIL = {
  error: { code: 409, message: "the stored version does not match the required base version", status: "FAILED_PRECONDITION" },
};
// Reads the precondition off the PATCH's own query string, the way the REST API takes it.
function precondition(u) {
  const mUt = /[?&]currentDocument\.updateTime=([^&]+)/.exec(u);
  if (mUt) return { updateTime: decodeURIComponent(mUt[1]) };
  const mEx = /[?&]currentDocument\.exists=(true|false)/.exec(u);
  if (mEx) return { exists: mEx[1] === "true" };
  return null;
}

// ---------------------------------------------------------------------------- the shared store
// ONE object, in NODE — which is what makes two browser contexts two DEVICES sharing a league
// rather than two leagues. `writes` is an ordered log of every PATCH that reached it, so a
// repro can say WHICH device clobbered WHAT, not merely that a value is wrong.
// `vers` is the per-doc updateTime — see the note at wireDoc. `ignorePreconditions` is the
// BITE PROOF switch: flipping it on makes this store behave like the pre-CAS one (accept
// everything), which is how a CAS check proves it is testing the fix rather than passing by
// coincidence. It must never be on in a committed suite run.
function makeStore(docs) {
  return { docs: JSON.parse(JSON.stringify(docs || {})), writes: [], reads: 0, vers: {}, ignorePreconditions: false, conflicts: 0 };
}
function respond(req, u, S, label) {
  const method = req.method();
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
  const json = (o, st) => req.respond({ status: st || 200, contentType: "application/json", headers: cors, body: JSON.stringify(o) });
  if (method === "OPTIONS") return req.respond({ status: 200, headers: cors, body: "" });
  if (u.includes(":runQuery")) {
    S.reads++;
    let q = {};
    try { q = (JSON.parse(req.postData() || "{}").structuredQuery) || {}; } catch (e) { /* malformed */ }
    const kind = q.where && q.where.fieldFilter ? q.where.fieldFilter.value.stringValue : null;
    const rows = Object.entries(S.docs).filter(([, d]) => !kind || d.kind === kind)
      .map(([id, d]) => ({ document: wireDoc(id, d, S), readTime: "2026-01-01T00:00:00Z" }));
    // A zero-result runQuery really answers with one document-LESS row, not an empty array.
    return json(rows.length ? rows : [{ readTime: "2026-01-01T00:00:00Z" }]);
  }
  const m = /\/documents\/([^/?]+)\/([^/?]+)/.exec(u);
  const id = m ? decodeURIComponent(m[2]) : null;
  if (method === "GET") {
    S.reads++;
    const d = S.docs[id];
    if (!d) return json({ error: { code: 404, status: "NOT_FOUND", message: "Document not found." } }, 404);
    return json(wireDoc(id, d, S));
  }
  if (method === "PATCH") {
    let payload = {};
    try { payload = JSON.parse(req.postData() || "{}"); } catch (e) { /* malformed */ }
    // THE PRECONDITION, evaluated the way the real service evaluates it: against the document
    // as it stands RIGHT NOW, inside the same synchronous turn as the write it guards.
    const pre = precondition(u);
    if (pre && !S.ignorePreconditions) {
      const have = S.docs[id] ? (S.vers[id] || null) : null;
      const wanted = "exists" in pre ? (pre.exists ? "any" : null) : pre.updateTime;
      const bad = "exists" in pre
        ? (pre.exists ? !S.docs[id] : !!S.docs[id])
        : (!S.docs[id] || have !== wanted);
      if (bad) {
        S.conflicts++;
        S.writes.push({ id, by: label, at: Date.now(), refused: true });
        return json(PRECON_FAIL, 409);
      }
    }
    const patch = {};
    for (const k of Object.keys(payload.fields || {})) patch[k] = dec(payload.fields[k]);
    S.docs[id] = { ...(S.docs[id] || {}), ...patch }; // updateMask semantics
    S.vers[id] = stamp();                             // every accepted write moves the version
    S.writes.push({ id, by: label, at: Date.now(), patch });
    return json(wireDoc(id, S.docs[id], S));
  }
  if (method === "DELETE") { delete S.docs[id]; delete S.vers[id]; S.writes.push({ id, by: label, at: Date.now(), deleted: true }); return json({}); }
  return json({});
}

// ---------------------------------------------------------------------------- sleeper directory
// Every rostered player in seedDocs, so the app can resolve who is OWNED, plus a handful who
// are on nobody's roster — those are the free agents the Moves table offers.
//
// ⚠ A ROSTERED PLAYER NEEDS HIS espn_id HERE. D.searchFA keys a directory entry as
// `espn_id || "slp_" + pid` and excludes what the rosters own — so an entry with no espn_id
// gets the key `slp_<pid>`, never matches the roster's own key, and the Moves table offers
// somebody else's starter as a free agent. A repro that grabs "the first available row" would
// then quietly be testing the wrong player. Names match the roster docs too, which is what
// makes D.pidForKey's name+team fallback resolve the same way the live feeds do.
const SLEEPER_DIR = (() => {
  const dir = {};
  const put = (pid, full_name, position, team, rank) =>
    (dir[pid] = { player_id: pid, full_name, position, team, search_rank: rank, fantasy_positions: [position],
      // Rostered players (p1xx / p2xx) carry the roster's own key as their espn_id; the free
      // agents (p9xx) deliberately do not, so they key as slp_<pid> and stay unowned.
      ...(/^p9/.test(pid) ? {} : { espn_id: pid }) });
  put("p101", "P. Passer", "QB", "PHI", 10); put("p102", "R. Rusher", "RB", "DAL", 11);
  put("p103", "S. Second", "RB", "DEN", 12); put("p104", "W. Receiver", "WR", "PHI", 13);
  put("p105", "W. Two", "WR", "DEN", 14); put("p106", "T. Tight", "TE", "KC", 15);
  put("p107", "F. Flexman", "RB", "DEN", 16); put("p109", "K. Kicker", "K", "DAL", 17);
  put("p110", "B. Backup", "RB", "KC", 18); put("p201", "Q. Rival", "QB", "DAL", 19);
  put("p202", "X. Wideout", "WR", "PHI", 20); put("p203", "Z. Spare", "RB", "KC", 21);
  // The free agents — on nobody's roster in seedDocs.
  put("p901", "N. Newman", "RB", "SF", 1); put("p902", "A. Available", "WR", "KC", 2);
  put("p903", "O. Open", "TE", "SF", 3);
  return dir;
})();

// ---------------------------------------------------------------------------- a device
async function newDevice(browser, S, label, seed) {
  seed = seed || {};
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument((s) => {
    window.prompt = () => "1234"; window.alert = () => {}; window.confirm = () => true;
    try {
      localStorage.setItem("gffl_pass", "amenfarms");
      if (s.team) localStorage.setItem("gffl_team", String(s.team));
      if (s.who) localStorage.setItem("gffl_who", s.who);
    } catch (e) {}
  }, seed);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    const cors = { "Access-Control-Allow-Origin": "*" };
    const json = (o) => req.respond({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(o) });
    (async () => {
      try {
        if (u.includes("/.netlify/functions/")) return json({ ok: true, sent: 0 });
        if (u.startsWith(BASE)) return req.continue();
        if (/firestore\.googleapis\.com/.test(u)) return respond(req, u, S, label);
        if (/gstatic|googleapis|firebase/.test(u)) return req.abort();
        // The live feeds. A race repro is about the STORE, never about scoring, so every
        // upstream answers empty — the app degrades to "no live data" and every roster,
        // claim and purse behaves exactly as it does with the feeds up. The ONE exception is
        // the Sleeper player DIRECTORY: the Moves page's free-agent table is derived from it,
        // so a repro that has to reach a real MOVE button needs it to hold somebody.
        if (/api\.sleeper\.app\/.*\/players\/nfl$/.test(u)) return json(SLEEPER_DIR);
        if (/espn|sleeper/i.test(u)) return json({});
        return req.abort();
      } catch (e) { /* page closed mid-flight */ }
    })();
  });
  return { ctx, page, errors, label };
}
async function boot(dev) {
  await dev.page.goto(BASE + "/league.html?fam=" + FAM + "&sim=0", { waitUntil: "networkidle0" });
  await dev.page.waitForFunction(() => window.__GFFL__ && window.__GFFL__.LG.rules, { timeout: 20000 });
  // Polling off: a repro's phases must be attributable, and the 8s live poll is the one thing
  // that can write a roster nobody asked it to (the suite's waitLive does the same).
  await dev.page.evaluate(() => { try { window.__GFFL__.D.stop(); } catch (e) {} });
  return dev;
}
const ev = (dev, fn, ...a) => dev.page.evaluate(fn, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const exe = [process.env.BUCKY_CHROME, "/opt/pw-browsers/chromium"].find((c) => c && fs.existsSync(c));
  return puppeteer.launch(exe
    ? { headless: true, executablePath: exe, args: ["--no-sandbox"] }
    : { headless: true, channel: "chrome", args: ["--no-sandbox"] });
}

// ---------------------------------------------------------------------------- seed
// Eight teams, a one-week schedule, and week-1 rosters for the two teams the repros act as.
// Every purse starts at the rules default (100) unless a repro says otherwise.
function seedDocs(extra) {
  const names = ["Battle Kreussers", "End Zone Goats", "Wyoming Cowboys", "Waffle House Warriors",
    "Nails For Breakfast", "Team Six", "Team Seven", "The Goat Kids"];
  const docs = {};
  names.forEach((n, i) => { docs["team_" + (i + 1)] = { kind: "team", teamId: i + 1, name: n, abbrev: "T" + (i + 1), owner: "" }; });
  docs["sched_" + SEASON] = { kind: "sched", season: SEASON, weeks: [[[1, 2], [3, 4], [5, 6], [7, 8]]] };
  docs["roster_" + SEASON + "_w1_t1"] = { kind: "roster", week: 1, teamId: 1, players: [
    { key: "p101", name: "P. Passer", pos: "QB", team: "PHI", slot: "QB" },
    { key: "p102", name: "R. Rusher", pos: "RB", team: "DAL", slot: "RB" },
    { key: "p103", name: "S. Second", pos: "RB", team: "DEN", slot: "RB" },
    { key: "p104", name: "W. Receiver", pos: "WR", team: "PHI", slot: "WR" },
    { key: "p105", name: "W. Two", pos: "WR", team: "DEN", slot: "WR" },
    { key: "p106", name: "T. Tight", pos: "TE", team: "KC", slot: "TE" },
    { key: "p107", name: "F. Flexman", pos: "RB", team: "DEN", slot: "FLEX" },
    { key: "dst_PHI", name: "PHI D/ST", pos: "DST", team: "PHI", slot: "DST" },
    { key: "p109", name: "K. Kicker", pos: "K", team: "DAL", slot: "K" },
    { key: "p110", name: "B. Backup", pos: "RB", team: "KC", slot: "BENCH" },
  ] };
  docs["roster_" + SEASON + "_w1_t2"] = { kind: "roster", week: 1, teamId: 2, players: [
    { key: "p201", name: "Q. Rival", pos: "QB", team: "DAL", slot: "QB" },
    { key: "p202", name: "X. Wideout", pos: "WR", team: "PHI", slot: "WR" },
    { key: "p203", name: "Z. Spare", pos: "RB", team: "KC", slot: "BENCH" },
  ] };
  return { ...docs, ...(extra || {}) };
}

module.exports = {
  ROOT, BASE, FAM, SEASON, PORT,
  ok, head, done, get fails() { return FAILS.length; },
  startStatic, makeStore, newDevice, boot, launch, ev, sleep, seedDocs,
};
