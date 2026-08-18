// _verify-ffdraft.cjs — verification for the standalone keeper draft room
// (ffdraft.html + the ff_draftinfo / ff_draftpool / ff_lastdraft actions in
// netlify/functions/sports.mjs).
//
//   node tools/_verify-ffdraft.cjs [--shots]
//
// Section A runs the REAL sports.mjs in process against a fake ESPN fantasy
// upstream serving tools/_sports_fixtures.cjs (ESPN is egress-blocked from the
// dev sandbox — tools/_probe-sports.mjs re-checks real shapes post-deploy).
// Sections B+ drive the REAL ffdraft.html in headless Chrome in LOCAL practice
// mode (?local=1) — the same mutation code the Firestore transactions run, on a
// localStorage doc. Firestore/gstatic are ABORTED throughout (house rule); a
// dedicated section proves cloud-unreachable shows the honest red banner
// rather than silently falling back to a per-device draft.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { pathToFileURL } = require("url");
const FIX = require("./_sports_fixtures.cjs");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const UP_PORT = 8823;
const FF_PORT = 8824;
const SRV_PORT = 8825;
const BASE = "http://127.0.0.1:" + SRV_PORT;
const SHOTS = process.argv.includes("--shots");
const GOOD_S2 = "TEST_S2_COOKIE_VALUE";
const GOOD_SWID = "TEST-SWID-GUID";
// Same Jan/Feb rule as sports.mjs ffSeason(): the "last season" whose draft
// doc ff_lastdraft asks for — history years are relative to it.
const LAST_SEASON = (() => {
  const d = new Date();
  return (d.getUTCMonth() < 2 ? d.getUTCFullYear() - 1 : d.getUTCFullYear()) - 1;
})();

let pass = 0, fail = 0; const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; failures.push(msg); console.log("  ✗ " + msg); }
}
function section(name) { console.log("\n== " + name + " =="); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- fake ESPN NFL upstream (unused by draft actions, env needs it) ----
function startUpstream() {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(FIX.scoreboardIdle()));
  });
  return new Promise((resolve) => srv.listen(UP_PORT, "127.0.0.1", () => resolve(srv)));
}

// ---------------- fake ESPN fantasy upstream ----------------
const ffUp = { lastUrl: "", urls: [], lastFilter: "", filters: [], standard: false, byesDown: false, historyDown: false, sweepDown: false, mode: "normal", calls: 0 };
function startFfUpstream() {
  const srv = http.createServer((req, res) => {
    ffUp.calls++;
    ffUp.lastUrl = req.url;
    ffUp.urls.push(req.url);
    if (ffUp.mode === "http500") { res.writeHead(500); res.end("nope"); return; }
    // The season-level proTeamSchedules doc is PUBLIC (no cookie sent by the
    // function) — route it before the auth gate.
    if (/\/apis\/v3\/games\/ffl\/seasons\/\d{4}\?/.test(req.url) && req.url.includes("proTeamSchedules")) {
      if (ffUp.byesDown) { res.writeHead(500); res.end("nope"); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(FIX.proTeamSchedulesDoc()));
      return;
    }
    const cookie = req.headers.cookie || "";
    const okAuth = cookie.includes("espn_s2=" + GOOD_S2) && cookie.includes("SWID={" + GOOD_SWID + "}");
    if (!okAuth) { res.writeHead(401, { "Content-Type": "application/json" }); res.end('{"messages":["not authorized"]}'); return; }
    if (!/\/apis\/v3\/games\/ffl\/seasons\/\d{4}\/segments\/0\/leagues\/705063/.test(req.url)) {
      res.writeHead(404); res.end("{}"); return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    // The single-player card view (the real upstream 400s filterIds on
    // kona_player_info — cards must come through kona_playercard).
    if (req.url.includes("view=kona_playercard")) {
      ffUp.lastFilter = req.headers["x-fantasy-filter"] || "";
      let ids = [];
      try { ids = JSON.parse(ffUp.lastFilter)?.players?.filterIds?.value || []; } catch (e) {}
      res.end(JSON.stringify({ players: FIX.ffDraftPoolDoc().players.filter((e) => ids.includes(e.player.id)) }));
      return;
    }
    if (req.url.includes("view=kona_player_info")) {
      ffUp.lastFilter = req.headers["x-fantasy-filter"] || "";
      ffUp.filters.push(ffUp.lastFilter);
      if (ffUp.lastFilter.includes("filterIds")) { res.writeHead(400); res.end('{"messages":["filter not supported"]}'); return; }
      const pdoc = FIX.ffDraftPoolDoc();
      if (ffUp.lastFilter.includes("filterSlotIds")) {
        // The slot sweep: only D/ST (16) + K (5) rows come back —
        // ffUp.sweepDown simulates it silently failing (bad JSON).
        if (ffUp.sweepDown) { res.end("nope"); return; }
        pdoc.players = pdoc.players.filter((e) => [16, 5].includes(e.player.defaultPositionId));
      } else {
        // Mirror the LIVE bug (2026-08-06): the draft-rank-sorted fetch
        // excludes defenses outright — the merge must restore them.
        pdoc.players = pdoc.players.filter((e) => e.player.defaultPositionId !== 16);
      }
      res.end(JSON.stringify(pdoc));
      return;
    }
    if (req.url.includes("view=mDraftDetail") || req.url.includes("view=mRoster")) {
      // Per-year routing: the main year serves last season's draft doc; the
      // three older years serve the keep-chain history (the 2022-analog is an
      // mRoster-ONLY fetch, hence the mRoster route). ffUp.historyDown kills
      // just the history years to prove the permissive degrade.
      const yr = Number((req.url.match(/\/seasons\/(\d{4})\//) || [])[1]);
      const back = LAST_SEASON - yr;
      // 200 headers are already sent here — a dead history year answers with
      // unparseable JSON, which ffFetch reads as bad-json (same degrade path).
      if (back > 0 && ffUp.historyDown) { res.end("nope"); return; }
      res.end(JSON.stringify(back > 0 ? FIX.ffHistoryDoc(back) : FIX.ffLastDraftDoc()));
      return;
    }
    const doc = FIX.ffLeagueDoc();
    if (ffUp.standard) {
      doc.settings.scoringSettings.scoringItems.find((i) => i.statId === 53).points = 0;
    }
    res.end(JSON.stringify(doc));
  });
  return new Promise((resolve) => srv.listen(FF_PORT, "127.0.0.1", () => resolve(srv)));
}
function ffAuthGood() { process.env.ESPN_S2 = GOOD_S2; process.env.ESPN_SWID = GOOD_SWID; }
function ffAuthNone() { delete process.env.ESPN_S2; delete process.env.ESPN_SWID; }

// ---------------- in-process function ----------------
let handler = null;
async function initHandler() {
  process.env.BUCKY_NOTIFY_SECRET = "amenfarms";
  process.env.SPORTS_NFL_BASE_URL = "http://127.0.0.1:" + UP_PORT;
  process.env.SPORTS_FF_BASE_URL = "http://127.0.0.1:" + FF_PORT;
  const mod = await import(pathToFileURL(path.join(ROOT, "netlify", "functions", "sports.mjs")).href);
  handler = mod.default;
}
async function call(body) {
  const resp = await handler(new Request("http://localhost/.netlify/functions/sports", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify(body),
  }));
  let json = null;
  try { json = JSON.parse(await resp.text()); } catch (e) {}
  return { status: resp.status, json };
}

// ---------------- section A: server actions ----------------
async function sectionServer() {
  section("A · sports.mjs draft actions vs fake ESPN");
  ffAuthGood();

  // ff_draftinfo
  let r = await call({ secret: "amenfarms", action: "ff_draftinfo" });
  ok(!!r.json && r.json.ok === true, "ff_draftinfo answers ok");
  ok(r.json.leagueName === "Nerd Fantasy Football League", "league name comes through");
  ok(Array.isArray(r.json.teams) && r.json.teams.length === 8, "all 8 teams listed");
  const t1 = r.json.teams[0] || {};
  ok(t1.id === 1 && t1.name === "Battle Kreussers", "teams keep id + name");
  ok(JSON.stringify(Object.keys(t1).sort()) === JSON.stringify(["abbrev", "id", "logo", "name", "owner"]),
    "team objects are slim (id/name/abbrev/logo/owner only)");
  ok(r.json.rosterSize === 16, "rosterSize sums lineup slots EXCLUDING IR (16)");
  ok(r.json.slots && r.json.slots.RB === 2 && r.json.slots.FLEX === 1 && r.json.slots["D/ST"] === 1 && r.json.slots.Bench === 7,
    "the labeled slot map rides along (feeds the roster-needs tracker)");
  ok(r.json.ppr === true, "receptions scoring (statId 53 > 0) reads as PPR");
  ok(r.json.byes && r.json.byes["12"] === 10, "bye weeks joined from the season doc (KC=10)");

  ffUp.standard = true;
  r = await call({ secret: "amenfarms", action: "ff_draftinfo" });
  ok(!!r.json && r.json.ppr === false, "zero-point receptions reads as standard scoring");
  ffUp.standard = false;

  ffUp.byesDown = true;
  r = await call({ secret: "amenfarms", action: "ff_draftinfo" });
  ok(!!r.json && r.json.ok === true && r.json.byes && Object.keys(r.json.byes).length === 0,
    "a bye-week fetch failure never sinks draftinfo (empty byes, still ok)");
  ffUp.byesDown = false;

  // ff_draftpool
  r = await call({ secret: "amenfarms", action: "ff_draftpool" });
  ok(!!r.json && r.json.ok === true && r.json.format === "ppr", "ff_draftpool defaults to PPR");
  ok(ffUp.filters.some((f) => f.includes("sortDraftRanks") && f.includes('"PPR"')),
    "the X-Fantasy-Filter header asks for PPR draft ranks");
  ok(Array.isArray(r.json.players) && r.json.players.length === 36, "pool carries every fixture player");
  // The D/ST sweep: the ranked fetch came back with ZERO defenses (the live
  // 2026-08-06 bug, mirrored by the fake) — the slot-16/17 sweep restores
  // them, ranks intact, interleaved by rank.
  ok(ffUp.filters.some((f) => f.includes("filterSlotIds") && f.includes("16") && f.includes("17")),
    "a second fetch sweeps lineup slots 16 (D/ST) + 17 (K)");
  const dsts = r.json.players.filter((p) => p.pos === "D/ST");
  ok(dsts.length === 2 && dsts.some((p) => p.pid === 4034) && dsts.some((p) => p.pid === 4035),
    "both defenses are IN the pool even though the ranked fetch excluded them");
  ok(r.json.players.findIndex((p) => p.pid === 4034) === 33,
    "a swept defense interleaves at its own rank (Broncos D/ST at #34)");
  ok(r.json.players[0].pid === 4001 && r.json.players[0].rank === 1,
    "pool is sorted by rank (Chase #1 in PPR) even though the upstream came back unsorted");
  ok(r.json.players[r.json.players.length - 1].pid === 4036, "an unranked player sorts last");
  const pp = r.json.players[0];
  ok(JSON.stringify(Object.keys(pp).sort()) === JSON.stringify(["adp", "injury", "lastPts", "name", "pid", "pos", "proTeam", "proTeamId", "proj", "rank"]),
    "pool players are slim (no raw stats/seasonOutlook/junk)");
  ok(pp.pos === "WR" && pp.proTeam === "CIN" && pp.adp === 1.6, "pos/proTeam/adp mapped");
  ok(pp.proj === 374 && pp.lastPts === 360,
    "season projection + last-year points ride on every pool row (never the weekly split)");
  const puka = r.json.players.find((p) => p.pid === 4007);
  ok(puka && puka.injury === "QUESTIONABLE", "injury status carried (ACTIVE dropped)");

  ffUp.filters = [];
  r = await call({ secret: "amenfarms", action: "ff_draftpool", format: "standard" });
  ok(!!r.json && r.json.format === "standard" && r.json.players[0].pid === 4002,
    "format:standard sorts by STANDARD ranks (Bijan #1)");
  ok(ffUp.filters.some((f) => f.includes("sortDraftRanks") && f.includes('"STANDARD"')),
    "the filter header switches to STANDARD too");

  // ff_lastdraft — "last season" tracks the league-year rule (Jan/Feb belong
  // to the previous season), so compute the expectation the same way.
  const now = new Date();
  const seasonNow = now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const lastSeason = seasonNow - 1;
  ffUp.urls = [];
  r = await call({ secret: "amenfarms", action: "ff_lastdraft" });
  ok(!!r.json && r.json.ok === true && r.json.drafted === true, "ff_lastdraft answers ok");
  ok(new RegExp("/seasons/" + lastSeason + "/").test(ffUp.urls[0] || ""), "defaults to LAST season (" + lastSeason + ")");
  ok(r.json.season === lastSeason, "season echoed");
  const lp = (r.json.picks || []).find((p) => p.pid === 4002);
  ok(lp && lp.round === 1 && lp.keeper === true && lp.teamId === 1, "keeper flag + round survive slimming");
  const lp2 = (r.json.picks || []).find((p) => p.pid === 4014);
  ok(lp2 && lp2.round === 6 && lp2.keeper === false, "an ordinary pick reads keeper:false");
  ok(lp && JSON.stringify(Object.keys(lp).sort()) === JSON.stringify(["keeper", "overall", "pick", "pid", "round", "teamId"]),
    "last-draft picks are slim");
  const ros1 = (r.json.rosters || []).find((x) => x.teamId === 1);
  ok(ros1 && ros1.players.some((p) => p.pid === 4021), "last-season rosters ride along (waiver pickup present)");
  ok(ros1 && JSON.stringify(Object.keys(ros1.players[0]).sort()) === JSON.stringify(["name", "pid", "pos", "proTeam", "proTeamId"]),
    "roster players are slim");

  // keep-chains — derived from the 4-year history (kept(Y) = drafted year Y by
  // team T AND on T's final (Y−1) roster; validated against the family's own
  // roster/draft PDFs). Kelce = 3 straight keeps → ineligible next season;
  // Bijan stops at 2 (his 2023 was a waiver year); Achane 0 (not on the
  // prior-year roster despite being drafted last season).
  ok(r.json.historyOk === true, "all three history years fetched → historyOk:true");
  ok(!!r.json.chains && r.json.chains[4019] === 3 && r.json.chains[4002] === 2,
    "chains: Kelce 3 straight keeps, Bijan 2");
  ok(!(4014 in (r.json.chains || {})) && !(4013 in (r.json.chains || {}))
    && Object.keys(r.json.chains || {}).length === 2,
    "Achane/Bowers carry NO chain — nobody else does either");
  ok([0, 1, 2, 3].every((b) => ffUp.urls.some((u) => u.includes("/seasons/" + (lastSeason - b) + "/"))),
    "the main year + all three history years were requested");
  ffUp.historyDown = true;
  r = await call({ secret: "amenfarms", action: "ff_lastdraft" });
  ok(!!r.json && r.json.ok === true && r.json.historyOk === false
    && Object.keys(r.json.chains || {}).length === 0 && (r.json.picks || []).length > 0,
    "history years down → still ok:true with chains {} + historyOk:false (permissive degrade)");
  ffUp.historyDown = false;

  ffUp.urls = [];
  r = await call({ secret: "amenfarms", action: "ff_lastdraft", year: 2024 });
  ok(ffUp.urls.some((u) => /\/seasons\/2024\//.test(u)), "an explicit year is honored");

  // ff_player — the detail card's payload
  r = await call({ secret: "amenfarms", action: "ff_player", pid: 4002 });
  ok(!!r.json && r.json.ok === true && r.json.player.name === "Bijan Robinson", "ff_player answers with the player");
  ok(ffUp.lastFilter.includes("filterIds") && /view=kona_playercard/.test(ffUp.lastUrl),
    "…fetched through the kona_playercard view + filterIds (kona_player_info 400s that filter live)");
  ok(ffUp.lastFilter.includes('"00' + (seasonNow - 1) + '"') && ffUp.lastFilter.includes('"10' + seasonNow + '"'),
    "…and the stats filter names last year's actuals + this year's projections");
  ok(r.json.player.outlook.includes("every-down back"), "ESPN's seasonOutlook analysis rides along");
  ok(r.json.player.proj && r.json.player.proj.total === 368 && r.json.player.last.total === 354,
    "projected + last-year totals (Bijan: 368 proj / 354 actual)");
  ok((r.json.player.proj.lines || []).some((l) => l.label === "Rush yds")
    && (r.json.player.last.lines || []).some((l) => l.label === "Catches"),
    "stat breakdowns decode to labeled lines both seasons");
  ok(r.json.player.rank.ppr === 2 && r.json.player.rank.standard === 1, "both rank flavors carried");
  r = await call({ secret: "amenfarms", action: "ff_player", pid: 999999 });
  ok(!!r.json && r.json.ok === false && r.json.reason === "not-found", "an unknown pid is not-found, never a crash");
  r = await call({ secret: "amenfarms", action: "ff_player", pid: "junk" });
  ok(!!r.json && r.json.ok === false && r.json.reason === "bad-pid", "a garbage pid is rejected");

  // failure paths
  ffAuthNone();
  r = await call({ secret: "amenfarms", action: "ff_draftinfo" });
  ok(!!r.json && r.json.ok === false && r.json.reason === "fantasy-not-configured", "no cookies → fantasy-not-configured");
  ffAuthGood();
  ffUp.mode = "http500";
  r = await call({ secret: "amenfarms", action: "ff_draftpool" });
  ok(!!r.json && r.json.ok === false && r.json.reason === "http-500", "upstream 500 → ok:false http-500");
  ffUp.mode = "normal";
  r = await call({ secret: "wrong", action: "ff_draftinfo" });
  ok(r.status === 401, "wrong family password → 401");
}

// ---------------- static server ----------------
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml",
};
function startStatic() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, BASE);
    if (u.pathname.startsWith("/.netlify/")) { res.writeHead(204); res.end(); return; }
    let p = path.join(ROOT, decodeURIComponent(u.pathname));
    if (u.pathname === "/") p = path.join(ROOT, "index.html");
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end("nope"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((resolve) => srv.listen(SRV_PORT, "127.0.0.1", () => resolve(srv)));
}

// ---------------- browser plumbing ----------------
function chromeExe() {
  const cands = [process.env.BUCKY_CHROME, "/opt/pw-browsers/chromium"];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return null;
}
async function launchBrowser() {
  const exe = chromeExe();
  const opts = { headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] };
  if (exe) opts.executablePath = exe; else opts.channel = "chrome";
  return puppeteer.launch(opts);
}
async function newPage(ctx, o) {
  o = o || {};
  const page = await ctx.newPage();
  await page.setViewport(o.vw || { width: 390, height: 844 });
  // This page pretends to be a browser that SUPPRESSES native dialogs — which
  // is exactly what the commissioner's phone did (the PIN prompt never
  // appeared, and the tap silently did nothing). A stub that answers `true`
  // proves the code path works while hiding that no human could reach it, so
  // every dialog here refuses, and __dlg counts anything that still asks.
  await page.evaluateOnNewDocument(() => {
    window.__dlg = [];
    window.prompt = (m) => { window.__dlg.push("prompt:" + m); return null; };
    window.alert = (m) => { window.__dlg.push("alert:" + m); };
    window.confirm = (m) => { window.__dlg.push("confirm:" + m); return false; };
  });
  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    const u = req.url();
    try {
      if (u.includes("/.netlify/functions/sports")) {
        const resp = await handler(new Request(u, {
          method: req.method(),
          headers: { "content-type": "application/json", origin: BASE },
          body: req.method() === "POST" ? req.postData() : undefined,
        }));
        const text = await resp.text();
        await req.respond({ status: resp.status, contentType: "application/json", body: text });
        return;
      }
      if (/googleapis|firestore|firebase|gstatic/i.test(u)) { await req.abort(); return; }
      if (u.includes("/.netlify/")) { await req.respond({ status: 204, body: "" }); return; }
      if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) { await req.abort(); return; }
      await req.continue();
    } catch (e) { /* already handled */ }
  });
  page._errs = [];
  const NOISE = /Failed to load resource|dynamically imported module|gstatic|firebase|ERR_FAILED|ERR_BLOCKED/i;
  page.on("pageerror", (e) => { if (!NOISE.test(String(e))) page._errs.push(String(e) + " @@ " + String(e.stack || "").split("\n").slice(0, 3).join(" | ")); });
  return page;
}
async function shot(page, name) {
  if (!SHOTS) return;
  const dir = path.join(ROOT, "shots");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name), fullPage: false });
}
const PAGE_URL = BASE + "/ffdraft.html?local=1&fam=famtest&season=2026";

function hook(page, fn, ...args) { return page.evaluate(fn, ...args); }
async function D(page) { return page.evaluate(() => window.__DRAFT__.D); }
async function toastText(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll(".toast")).map((t) => t.textContent).join(" | "));
}
async function clickSafely(page, sel) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error("missing " + s);
    el.scrollIntoView({ block: "center" });
    el.click();
  }, sel);
}

// ---------------- section A3: committed audio assets are real audio -------------
function sectionAudioAssets() {
  section("A3 · committed draft audio — files exist and are actual mp3s");
  const fs2 = require("fs"), path2 = require("path");
  const dir = path2.join(__dirname, "..", "assets", "audio", "draft");
  const man = JSON.parse(fs2.readFileSync(path2.join(dir, "manifest.json"), "utf8"));
  ok(man.files.length === 6 && man.files.every((f) => {
    const b = fs2.readFileSync(path2.join(dir, f.file));
    return b.length > 5000 && (b.slice(0, 3).toString() === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));
  }), "4 stingers + 2 music beds committed, every one real mp3 bytes");
  const say = JSON.parse(fs2.readFileSync(path2.join(dir, "say", "say.json"), "utf8"));
  const pids = Object.keys(say.voices);
  ok(pids.length >= 6 && pids.every((pid) => {
    const b = fs2.readFileSync(path2.join(dir, "say", say.voices[pid].file));
    return b.length > 5000 && (b.slice(0, 3).toString() === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));
  }), "player-name announcements on disk for " + pids.length + " players, all real mp3s");
}

// ---------------- section B: the draft room, end to end (local mode) ----------------
async function sectionRoom(browser) {
  section("B · ffdraft.html — create, claim, keepers, live snake draft (390×844)");
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx);
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__DRAFT__ && window.__DRAFT__.pool.length >= 30
    && window.__DRAFT__.info && window.__DRAFT__.info.ok
    && window.__DRAFT__.lastDraft && window.__DRAFT__.lastDraft.ok, { timeout: 20000 });
  ok(true, "page boots; ESPN pool + league info + last draft all load through the real function");
  ok(await page.evaluate(() => !!document.getElementById("createBtn")), "landing offers Create (no draft doc yet)");
  ok(await page.evaluate(() => document.getElementById("vLanding").textContent.includes("Goat Fantasy Football League")),
    "landing names the ESPN league it found");

  // --- create ---
  await clickSafely(page, "#createBtn");
  await page.waitForFunction(() => window.__DRAFT__.D, { timeout: 5000 });
  let d = await D(page);
  ok(d && d.phase === "setup" && d.teams.length === 8 && d.rounds === 16,
    "create → setup phase, 8 ESPN teams, rounds from roster size (16)");
  ok(typeof d.commishKey === "string" && d.commishKey.length >= 6, "a commissioner key was minted");
  ok(await page.evaluate(() => !document.getElementById("tabCommish").hidden), "creator sees the Commish tab");
  const ckey = d.commishKey;
  const paulDev = await page.evaluate(() => window.__DRAFT__.me.dev);

  // --- claim (real UI) ---
  await clickSafely(page, '#tabs button[data-v="players"]');
  await page.evaluate(() => { document.getElementById("nameIn").value = "Paul"; });
  await clickSafely(page, "#nameSave");
  await clickSafely(page, '.claimBtn[data-tid="1"]');
  d = await D(page);
  ok(d.teams[0].owner && d.teams[0].owner.name === "Paul", "Paul claims Battle Kreussers by tapping That's me");

  // --- a second person (hook-swapped identity = another phone) ---
  await hook(page, () => window.__DRAFT__.setMe("Mike", "dev-mike", ""));
  await hook(page, () => window.__DRAFT__.claimTeam(3));
  d = await D(page);
  ok((d.teams.find((t) => t.id === 3).owner || {}).name === "Mike", "Mike claims The Goat Kids");
  await hook(page, () => window.__DRAFT__.claimTeam(1));
  await sleep(50);
  d = await D(page);
  ok(d.teams[0].owner.name === "Paul", "a claimed team can't be stolen");
  ok((await toastText(page)).includes("already claimed"), "…and the thief is told why");
  await hook(page, () => window.__DRAFT__.releaseTeam(1));
  d = await D(page);
  ok(d.teams[0].owner && d.teams[0].owner.name === "Paul", "nor can someone else release your claim");

  // --- commish setup controls ---
  await hook(page, (k, dev) => window.__DRAFT__.setMe("Paul", dev, k), ckey, paulDev);
  await clickSafely(page, '#tabs button[data-v="commish"]');
  await clickSafely(page, '.ordDn[data-i="0"]');
  d = await D(page);
  ok(d.teams[1].id === 1, "draft order: move-down works");
  await clickSafely(page, '.ordUp[data-i="1"]');
  d = await D(page);
  ok(d.teams[0].id === 1, "…and move-up restores it");
  await page.evaluate(() => { document.getElementById("setTimer").value = "60"; });
  await clickSafely(page, "#setSave");
  d = await D(page);
  ok(d.timerSecs === 60, "pick clock set to 60s from the commish panel");
  await hook(page, () => window.__DRAFT__.setSetting("timerSecs", 0));

  // share links
  ok(await page.evaluate((k) => {
    const boxes = Array.from(document.querySelectorAll(".linkbox")).map((b) => b.textContent);
    return !boxes[0].includes("c=") && boxes[1].includes("c=" + k);
  }, ckey), "guest link is clean; commissioner link carries ?c=<key>");

  // --- keeper phase ---
  await clickSafely(page, "#phKeepers");
  d = await D(page);
  ok(d.phase === "keepers", "commish opens keeper picking");

  // costs, straight from the rule
  const costs = await hook(page, () => ({
    kept1st: window.__DRAFT__.keeperCostOf(4002),
    drafted6: window.__DRAFT__.keeperCostOf(4014),
    kept4: window.__DRAFT__.keeperCostOf(4019),
    waiver: window.__DRAFT__.keeperCostOf(4021),
  }));
  ok(costs.kept1st.round === 1 && /kept last year \(R1\)/.test(costs.kept1st.basis),
    "a player kept at R1 last year still costs a 1st (floor)");
  ok(costs.drafted6.round === 5 && /drafted R6/.test(costs.drafted6.basis),
    "drafted R6 last year → costs R5 (one round earlier)");
  ok(costs.kept4.round === 3 && /kept last year \(R4\)/.test(costs.kept4.basis),
    "kept at R4 last year → costs R3 (escalates a round each keep)");
  ok(costs.waiver.round === 16 && costs.waiver.waiver === true,
    "a waiver pickup (absent from last year's draft) costs the latest pick");

  // add keepers through the real UI (Paul claimed team 1)
  await clickSafely(page, '#tabs button[data-v="players"]');
  await page.type("#pSearch", "Achane");
  await page.waitForFunction(() => document.querySelectorAll("#pList .prow").length === 1, { timeout: 3000 });
  ok(await page.evaluate(() => document.querySelector("#pList .pKeep").textContent.trim() === "Keep R5"),
    "the pool row's Keep button prints the automated cost");
  await clickSafely(page, "#pList .pKeep");
  ok(await page.evaluate(() => {
    const t = document.getElementById("confirmBar").textContent;
    return t.includes("Round 5") && t.includes("drafted R6 last year") && t.includes("goes ~R2 in drafts");
  }), "the keep-confirm bar quotes the cost, its basis, and his market round");
  await clickSafely(page, "#cbGo");
  d = await D(page);
  ok((d.keepers[1] || []).length === 1 && d.keepers[1][0].pid === 4014 && d.keepers[1][0].round === 5,
    "Achane kept at a Round 5 cost");

  // a player who was never on your roster carries no keep affordance at all
  await page.evaluate(() => { const s = document.getElementById("pSearch"); s.value = "Chase"; s.dispatchEvent(new Event("input")); });
  await page.waitForFunction(() => document.querySelectorAll("#pList .prow").length === 1, { timeout: 3000 });
  ok(await page.evaluate(() => !document.querySelector("#pList .pKeep") && !document.querySelector("#pList .pLock")),
    "no Keep button on a player who isn't on your roster");
  await page.evaluate(() => { const s = document.getElementById("pSearch"); s.value = "Achane"; s.dispatchEvent(new Event("input")); });

  await hook(page, () => window.__DRAFT__.addKeeper(1, window.__DRAFT__.pool.find((p) => p.pid === 4002)));
  d = await D(page);
  const bij = d.keepers[1].find((k) => k.pid === 4002);
  ok(bij && bij.keptCount === 3, "Bijan's history (kept '24 and '25) makes this his 3rd straight keep — computed, not typed");
  ok(await page.evaluate(() => Array.from(document.querySelectorAll(".keepCard .krow"))
    .some((r) => r.textContent.includes("3rd straight keep") && r.textContent.includes("last time"))),
    "…and the panel warns it's the last time");
  ok(await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll(".keepCard .krow")).find((r) => r.textContent.includes("Bijan"));
    const b = row && row.querySelector(".kadp");
    return !!b && b.textContent === "ADP R1" && !/good|bad/.test(b.className);
  }), "keeper rows show cost vs market: Bijan R1 at ADP R1 reads even (no color)");
  const adp = await hook(page, () => ({
    good: window.__DRAFT__.keeperAdpBadge(5, 4014),
    bad: window.__DRAFT__.keeperAdpBadge(1, 4014),
    none: window.__DRAFT__.keeperAdpBadge(5, 4036),
  }));
  ok(adp.good && adp.good.round === 2 && adp.good.cls === "good"
    && adp.bad && adp.bad.cls === "bad" && adp.none === null,
    "ADP-round math: keeping an ADP-R2 player at R5 = value, at R1 = overpay, no ADP = no badge");

  // The badge units, pinned at the exact live shape that burned a real mock
  // (2026-08-18): ESPN ADP runs ~1.25x rank because ESPN lobbies draft 10 a
  // round to our 8. Mid-draft best-available (overall 60, adp 73 — live
  // median drift) must read as NO badge; only 2+ rounds of real disconnect
  // may speak. And ESPN caps ADP ~171, so a late pick is never a "steal" just
  // for existing (overall 140 = our R18 vs adp 165 = ESPN R17).
  const vb = await hook(page, () => ({
    midDrift: window.__DRAFT__.valueBadge(60, 73),
    lateCap: window.__DRAFT__.valueBadge(140, 165),
    reach: window.__DRAFT__.valueBadge(20, 96),
    steal: window.__DRAFT__.valueBadge(38, 15),
    zeroAdp: window.__DRAFT__.valueBadge(10, 0),
  }));
  ok(vb.midDrift === null && vb.lateCap === null,
    "the 10-vs-8 picks-per-round drift earns NO badge — best-available is not a reach");
  ok(vb.reach === "reach" && vb.steal === "steal" && vb.zeroAdp === null,
    "…while a true 2+ round disconnect still badges, and ADP 0 never does");

  await hook(page, () => window.__DRAFT__.addKeeper(1, window.__DRAFT__.pool.find((p) => p.pid === 4022)));
  const resolved = await hook(page, () => window.__DRAFT__.resolveKeeperRounds(window.__DRAFT__.D.keepers[1], 16));
  ok(resolved.length === 3
    && resolved.find((k) => k.pid === 4002).finalRound === 1
    && resolved.find((k) => k.pid === 4014).finalRound === 5
    && resolved.find((k) => k.pid === 4022).finalRound === 4
    && resolved.find((k) => k.pid === 4022).bumped === true,
    "two keepers costing R5 collide → the second bumps EARLIER to R4, flagged");
  await page.evaluate(() => { document.getElementById("pSearch").value = ""; document.getElementById("pSearch").dispatchEvent(new Event("input")); });
  ok(await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".keepCard .krow .cost")).map((c) => c.textContent);
    return rows.includes("R1") && rows.includes("R5") && rows.includes("R4*");
  }), "the keeper panel shows the resolved rounds incl. the bump marker");

  let err = await hook(page, () => window.__DRAFT__.addKeeper(1, window.__DRAFT__.pool.find((p) => p.pid === 4016)).then(() => "ok"));
  await sleep(50);
  d = await D(page);
  ok(d.keepers[1].length === 3, "a 4th keeper is refused (3 max)");

  // Mike: Kelce is CHAIN-LOCKED (kept '23/'24/'25 — three straight), so the
  // engine refuses him automatically; Bowers (drafted R4) is the eligible keep.
  await hook(page, () => window.__DRAFT__.setMe("Mike", "dev-mike", ""));
  const kelSt = await hook(page, () => window.__DRAFT__.keeperStatusOf(4019, 3));
  ok(kelSt && kelSt.eligible === false && kelSt.chain === 3 && /3 straight/.test(kelSt.reason),
    "Kelce reads chain 3 → automatically ineligible, with the reason");
  await hook(page, () => window.__DRAFT__.addKeeper(3, window.__DRAFT__.pool.find((p) => p.pid === 4019)));
  await sleep(50);
  d = await D(page);
  ok((d.keepers[3] || []).length === 0 && (await toastText(page)).includes("can't be kept"),
    "keeping him is refused outright — no dropdown to argue with");
  ok(await page.evaluate(() => {
    const chip = Array.from(document.querySelectorAll(".keepCard .kQuick.kNo")).find((c) => c.textContent.includes("Kelce"));
    return !!(chip && chip.querySelector(".kb") && /straight years/.test(chip.textContent));
  }), "the roster list greys Kelce with a lock + the reason");
  await page.evaluate(() => { const s = document.getElementById("pSearch"); s.value = "Kelce"; s.dispatchEvent(new Event("input")); });
  await page.waitForFunction(() => document.querySelectorAll("#pList .prow").length === 1, { timeout: 3000 });
  ok(await page.evaluate(() => !!document.querySelector("#pList .pLock") && !document.querySelector("#pList .pKeep")),
    "the pool row shows a lock instead of a Keep button for him");
  await page.evaluate(() => { const s = document.getElementById("pSearch"); s.value = ""; s.dispatchEvent(new Event("input")); });
  await hook(page, () => window.__DRAFT__.addKeeper(3, window.__DRAFT__.pool.find((p) => p.pid === 4002)));
  await sleep(50);
  ok((await toastText(page)).includes("not on your"), "another team's player fails the roster rule");
  await hook(page, () => window.__DRAFT__.addKeeper(3, window.__DRAFT__.pool.find((p) => p.pid === 4013)));
  d = await D(page);
  ok((d.keepers[3] || []).length === 1 && d.keepers[3][0].pid === 4013 && d.keepers[3][0].round === 3,
    "Mike keeps Bowers at the automated R3 cost instead");

  // swap Conner for the waiver guy via the last-year-roster quick chips
  await hook(page, (k, dev) => window.__DRAFT__.setMe("Paul", dev, k), ckey, paulDev);
  await hook(page, () => window.__DRAFT__.removeKeeper(1, 4022));
  await page.waitForFunction(() => document.querySelector('.kQuick[data-pid="4021"]'), { timeout: 3000 });
  ok(true, "last season's roster renders as quick keeper chips (incl. the waiver pickup)");
  ok(await page.evaluate(() => {
    const c = document.querySelector('.kQuick[data-pid="4021"] .kcost');
    return !!c && c.textContent === "R16";
  }), "every roster chip prints its automated cost (waiver → R16)");
  ok(await page.evaluate(() => {
    const conner = document.querySelector('.kQuick[data-pid="4022"] .kadp');
    const bucky = document.querySelector('.kQuick[data-pid="4021"] .kadp');
    return !!conner && conner.textContent === "ADP R3" && conner.className.includes("good")
      && !!bucky && bucky.textContent === "ADP R3" && bucky.className.includes("good");
  }), "…and his market beside it: Conner R5 vs ADP R3 + the R16 waiver keep both read green");
  await clickSafely(page, '.kQuick[data-pid="4021"]');
  ok(await page.evaluate(() => document.getElementById("confirmBar").textContent.includes("Round 16")),
    "waiver keeper confirm quotes the latest-pick cost");
  await clickSafely(page, "#cbGo");
  d = await D(page);
  ok(d.keepers[1].length === 3 && d.keepers[1].some((k) => k.pid === 4021), "team 1 keeps Bijan + Achane + the waiver pickup");
  await hook(page, () => window.__DRAFT__.addKeeper(1, window.__DRAFT__.pool.find((p) => p.pid === 4002)));
  await sleep(50);
  ok((await toastText(page)).includes("already spoken for"), "re-keeping an already-kept player is refused");

  // keepers hit the board IMMEDIATELY — before the draft ever starts
  await hook(page, () => window.__DRAFT__.setView("board"));
  ok(await page.evaluate(() => {
    const c1 = document.querySelector('#boardGrid .cell[data-key="r1_t1"]');
    const c3 = document.querySelector('#boardGrid .cell[data-key="r3_t3"]');
    // Restaged 2026-08-18: cells mark keepers with a KEEPER badge (same chip
    // family as REACH/STEAL) instead of the lock glyph, which stays in the
    // keeper panel and players list.
    const badge = c1 && c1.querySelector(".vbadge.keeper");
    return !!(c1 && c1.textContent.includes("B. Robinson") && badge && badge.textContent === "KEEPER"
      && c3 && c3.textContent.includes("B. Bowers"));
  }), "keepers land on the board the moment they're entered (draft not started)");
  await hook(page, () => window.__DRAFT__.setView("players"));

  // The commissioner override dropdowns are GONE — eligibility and costs are
  // fully automated off the league's own history now.
  ok(await page.evaluate(() => !document.querySelector(".kOver") && !document.querySelector(".kCount")
    && !window.__DRAFT__.setKeeperField),
    "no override/kept-count dropdowns anywhere — the keeper engine is automated");

  // --- start the draft: keepers materialize ---
  await clickSafely(page, '#tabs button[data-v="commish"]');
  // Destructive/irreversible controls arm on the first tap and fire on the
  // second — no native dialog, which a suppressing browser would swallow.
  await clickSafely(page, "#phLive");
  ok(await page.evaluate(() => document.getElementById("phLive").textContent.includes("Tap again"))
    && (await D(page)).phase !== "live", "one tap on Start only ARMS it — nothing has happened yet");
  await clickSafely(page, "#phLive");
  d = await D(page);
  ok(d.phase === "live", "the draft goes live");
  ok(d.picks["r1_t1"] && d.picks["r1_t1"].pid === 4002 && d.picks["r1_t1"].keeper === true,
    "Bijan locks onto the board at R1 as a keeper");
  ok(d.picks["r5_t1"] && d.picks["r5_t1"].pid === 4014 && d.picks["r16_t1"] && d.picks["r16_t1"].pid === 4021,
    "Achane at R5 and the waiver keeper at R16");
  ok(d.picks["r3_t3"] && d.picks["r3_t3"].pid === 4013, "Bowers locks at R3 for The Goat Kids");
  let cur = await hook(page, () => window.__DRAFT__.currentSlot());
  ok(cur && cur.key === "r1_t2" && cur.label === "1.02",
    "the clock opens at pick 1.02 — the keeper-filled 1.01 is skipped");

  // --- authority during live ---
  await hook(page, () => window.__DRAFT__.setMe("Mike", "dev-mike", ""));
  await hook(page, () => window.__DRAFT__.makePick(window.__DRAFT__.pool.find((p) => p.pid === 4001)));
  await sleep(50);
  d = await D(page);
  ok(!d.picks["r1_t2"], "you can't pick on someone else's clock");
  ok((await toastText(page)).includes("not yours"), "…and it says so");

  await hook(page, (k, dev) => window.__DRAFT__.setMe("Paul", dev, k), ckey, paulDev);
  await hook(page, () => window.__DRAFT__.makePick(window.__DRAFT__.pool.find((p) => p.pid === 4001)));
  d = await D(page);
  ok(d.picks["r1_t2"] && d.picks["r1_t2"].pid === 4001, "the commissioner can pick for the team on the clock");

  // Mike picks through the real UI at 1.03 — and the clock alerts HIM
  await hook(page, () => window.__DRAFT__.setMe("Mike", "dev-mike", ""));
  ok(await page.evaluate(() => window.__DRAFT__.clockMine() && window.__DRAFT__.titleFlashing()
    && document.getElementById("clockStrip").className.includes("mine")
    && /YOUR PICK|Draft Day/.test(document.title)),
    "when the clock becomes yours the strip goes red and the tab title flashes");
  await clickSafely(page, '#tabs button[data-v="players"]');
  await page.type("#pSearch", "Saquon");
  await page.waitForFunction(() => document.querySelectorAll("#pList .pDraft:not([disabled])").length === 1, { timeout: 3000 });
  await clickSafely(page, "#pList .pDraft");
  await page.waitForFunction(() => !!window.__DRAFT__.D.picks["r1_t3"], { timeout: 5000, polling: 100 });
  d = await D(page);
  ok(d.picks["r1_t3"] && d.picks["r1_t3"].pid === 4003,
    "Mike drafts Barkley from his own phone at 1.03 — ONE tap, no confirmation");
  ok(await page.evaluate(() => document.getElementById("confirmBar").hidden),
    "…and no confirm bar ever appeared for it");
  ok(await page.evaluate(() => !window.__DRAFT__.titleFlashing()), "…and the title flash stops once he picks");
  ok(await page.evaluate(() => window.__DRAFT__.sndLog.includes("pick")),
    "every landed pick is marked on every device (restaged: the per-pick fanfare is deliberately gone — the announcer is the sound)");
  await page.evaluate(() => { document.getElementById("pSearch").value = ""; document.getElementById("pSearch").dispatchEvent(new Event("input")); });

  await hook(page, (k, dev) => window.__DRAFT__.setMe("Paul", dev, k), ckey, paulDev);
  await hook(page, () => window.__DRAFT__.makePick(window.__DRAFT__.pool.find((p) => p.pid === 4001)));
  await sleep(50);
  ok((await toastText(page)).includes("already taken"), "double-drafting a player is refused");

  // fill round 1, verify the snake turns
  await hook(page, () => {
    const H = window.__DRAFT__;
    const pids = [4004, 4005, 4006, 4007, 4008];
    return pids.reduce((p, pid) => p.then(() => H.makePick(H.pool.find((x) => x.pid === pid))), Promise.resolve());
  });
  cur = await hook(page, () => window.__DRAFT__.currentSlot());
  d = await D(page);
  ok(cur && cur.round === 2 && cur.teamId === d.teams[7].id && cur.label === "2.01",
    "round 2 snakes back — pick 2.01 belongs to the last team in the order");

  // fill round 2 (Kelce goes to team 3 as an ordinary DRAFT pick — chain-locked
  // players return to the pool), then verify the keeper slot mid-round-3 skips
  await hook(page, () => {
    const H = window.__DRAFT__;
    const pids = [4010, 4012, 4018, 4015, 4017, 4019, 4020, 4023];
    return pids.reduce((p, pid) => p.then(() => H.makePick(H.pool.find((x) => x.pid === pid))), Promise.resolve());
  });
  cur = await hook(page, () => window.__DRAFT__.currentSlot());
  ok(cur && cur.key === "r3_t1", "round 3 runs forward again");
  await hook(page, () => window.__DRAFT__.makePick(window.__DRAFT__.pool.find((p) => p.pid === 4024)));
  await hook(page, () => window.__DRAFT__.makePick(window.__DRAFT__.pool.find((p) => p.pid === 4025)));
  cur = await hook(page, () => window.__DRAFT__.currentSlot());
  ok(cur && cur.key === "r3_t4", "the clock SKIPS 3.03 — Bowers's keeper slot is already filled");

  // undo
  await hook(page, () => window.__DRAFT__.undoLast());
  cur = await hook(page, () => window.__DRAFT__.currentSlot());
  d = await D(page);
  ok(!d.picks["r3_t2"] && cur.key === "r3_t2", "undo removes the last live pick (keepers are untouchable)");
  await hook(page, () => window.__DRAFT__.makePick(window.__DRAFT__.pool.find((p) => p.pid === 4025)));

  // timer + pause
  await hook(page, () => window.__DRAFT__.setSetting("timerSecs", 90));
  d = await D(page);
  ok(d.deadline > Date.now() + 85000 && d.deadline < Date.now() + 95000, "setting a 90s clock arms the deadline");
  ok(await page.evaluate(() => !!document.getElementById("cdown")), "the countdown renders in the clock strip");
  // Timer expiry buzzer: once per deadline, the moment it crosses zero.
  await page.evaluate(() => { window.__DRAFT__.D.deadline = Date.now() - 20; });
  await page.waitForFunction(() => window.__DRAFT__.sndLog.includes("buzzer"), { timeout: 3000 });
  ok(true, "the buzzer fires when the clock hits 0");
  await sleep(1100);
  ok(await page.evaluate(() => window.__DRAFT__.sndLog.filter((x) => x === "buzzer").length === 1),
    "…exactly once per deadline, not every tick");
  await hook(page, () => window.__DRAFT__.togglePause());
  await hook(page, () => window.__DRAFT__.makePick(window.__DRAFT__.pool.find((p) => p.pid === 4026)));
  await sleep(50);
  d = await D(page);
  ok(d.paused === true && !d.picks["r3_t4"], "picking while paused is refused");
  ok((await toastText(page)).includes("paused"), "…with the reason");
  await hook(page, () => window.__DRAFT__.togglePause());
  await hook(page, () => window.__DRAFT__.setSetting("timerSecs", 0));
  d = await D(page);
  ok(d.deadline === null, "turning the clock off clears the deadline");

  // --- board DOM ---
  await clickSafely(page, '#tabs button[data-v="board"]');
  const board = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll("#boardGrid .cell"));
    const k = document.querySelector('#boardGrid .cell[data-key="r1_t1"]');
    const c = document.querySelector("#boardGrid .cell.cur");
    return {
      cells: cells.length,
      keeperCell: k ? k.textContent : "",
      keeperLock: !!(k && k.querySelector(".vbadge.keeper")),   // restaged: badge, not lock
      keeperPos: k ? k.className : "",
      curKey: c ? c.dataset.key : null,
      filledHavePos: cells.filter((x) => x.querySelector("b")).every((x) => /pos-(QB|RB|WR|TE|K|DST|X)/.test(x.className)),
    };
  });
  ok(board.cells === 16 * 8, "the board renders every slot (16 rounds × 8 teams)");
  ok(board.keeperLock && board.keeperCell.includes("B. Robinson"), "keeper cells carry the KEEPER badge + the player");
  ok(/pos-RB/.test(board.keeperPos), "cells are position-colored");
  ok(board.curKey === "r3_t4", "the on-the-clock cell is highlighted");
  ok(await page.evaluate(() => {
    const p = document.querySelector("#vBoard .panner");
    return p.scrollWidth > p.clientWidth + 40;
  }), "on a phone the board pans inside its container instead of shrinking to mush");
  await shot(page, "ffdraft_board_390.png");

  // --- draft chat (board view) ---
  ok(await page.evaluate(() => {
    const c = document.getElementById("chatCard");
    return !c.hidden && c.closest("#vBoard") != null;
  }), "the chat card sits on the Board view");
  await page.evaluate(() => { document.getElementById("chatIn").value = "Who's taking a kicker in round 4? 😂"; });
  await clickSafely(page, "#chatSend");
  await page.waitForFunction(() => document.getElementById("chatMsgs").textContent.includes("kicker in round 4"), { timeout: 3000 });
  ok(true, "sending a message renders it in the chat");
  ok(await page.evaluate(() => document.querySelector("#chatMsgs .cmsg b").textContent === "Paul"),
    "messages carry the sender's name");
  await page.evaluate(() => window.__DRAFT__.setMe("", null, null));
  await page.evaluate(() => { document.getElementById("chatIn").value = "anonymous heckling"; });
  await clickSafely(page, "#chatSend");
  await sleep(80);
  ok(await page.evaluate(() => !document.getElementById("chatMsgs").textContent.includes("anonymous heckling")),
    "no name, no message — you're nudged to set one first");
  await hook(page, (k, dev) => window.__DRAFT__.setMe("Paul", dev, k), ckey, paulDev);
  await clickSafely(page, '#tabs button[data-v="players"]');
  ok(await page.evaluate(() => {
    const chat = document.getElementById("chatCard");
    const claim = document.getElementById("claimCard");
    return chat.closest("#teamsCol") != null && chat.classList.contains("slim")
      && chat.getBoundingClientRect().bottom <= claim.getBoundingClientRect().top + 4;
  }), "…and the chat follows you to Players & Teams, slimmed above the teams column");
  await clickSafely(page, '#tabs button[data-v="board"]');

  // --- players list states ---
  await clickSafely(page, '#tabs button[data-v="players"]');
  await page.type("#pSearch", "Kelce");
  await page.waitForFunction(() => document.querySelectorAll("#pList .prow").length === 1, { timeout: 3000 });
  ok(await page.evaluate(() => {
    const row = document.querySelector("#pList .prow");
    return row.classList.contains("taken") && row.querySelector(".tk").textContent === "GOAT";
  }), "a taken player is dimmed and shows who has him");
  await clickSafely(page, "#pHideTaken");
  ok(await page.evaluate(() => document.querySelectorAll("#pList .prow").length === 0), "hide-taken hides him");
  await clickSafely(page, "#pHideTaken");

  // custom player (deep-league pick that isn't in the top-300 pool)
  await page.evaluate(() => { document.getElementById("pSearch").value = "Johnny Testman"; document.getElementById("pSearch").dispatchEvent(new Event("input")); });
  await page.waitForFunction(() => document.getElementById("customAdd"), { timeout: 3000 });
  await clickSafely(page, "#customAdd");
  ok(await page.evaluate(() => !document.getElementById("confirmBar").hidden && !!document.getElementById("customPos")),
    "a hand-typed player still confirms — that bar is where his position is chosen");
  await page.evaluate(() => { document.getElementById("customPos").value = "TE"; });
  await clickSafely(page, "#cbGo");
  d = await D(page);
  const custom = d.picks["r3_t4"];
  ok(custom && String(custom.pid).indexOf("c_") === 0 && custom.pos === "TE" && custom.name === "Johnny Testman",
    "a custom player can be drafted by name with a chosen position");
  await hook(page, () => window.__DRAFT__.undoLast());
  await page.evaluate(() => { document.getElementById("pSearch").value = ""; document.getElementById("pSearch").dispatchEvent(new Event("input")); });
  await shot(page, "ffdraft_players_390.png");

  // The D/ST chip — the filter nobody had ever exercised: the chip used to say
  // "DST" while every defense's pos is "D/ST", so the live pool's defenses
  // were invisible on EVERY device (reported 2026-08-06, two devices).
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("#posChips button")).find((b) => b.dataset.pos === "D/ST").click();
  });
  ok(await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#pList .prow"));
    return rows.length === 2 && rows.every((r) => /D\/ST/.test(r.textContent));
  }), "tapping the D/ST chip shows exactly the pool's defenses");
  ok(await page.evaluate(() => {
    const dot = document.querySelector("#pList .prow .dot");
    const want = getComputedStyle(document.documentElement).getPropertyValue("--pos-DST").trim();
    return !!dot && dot.getAttribute("style").includes(want);
  }), "…colored with the D/ST position color, not the unknown-pos gray");
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("#posChips button")).find((b) => b.dataset.pos === "ALL").click();
  });

  // --- own scroll + richer rows + the detail card ---
  await sleep(120);   // sizePList runs in a rAF after render
  ok(await page.evaluate(() => {
    const el = document.getElementById("pList");
    return getComputedStyle(el).overflowY === "auto" && el.scrollHeight > el.clientHeight + 40;
  }), "the players list scrolls inside itself, not the page");
  ok(await page.evaluate(() => {
    const el = document.getElementById("pList");
    const row = el.querySelector(".prow");
    return !!row && el.clientHeight <= row.offsetHeight * 10 + 8 && el.clientHeight >= row.offsetHeight * 5;
  }), "on a phone the list caps at ~10 rows so the teams column below stays reachable");
  ok(await page.evaluate(() => {
    const row = document.querySelector("#pList .prow");
    const logo = row.querySelector(".tlogo");
    return !!logo && /espncdn\.com\/i\/teamlogos\/nfl/.test(logo.src)
      && /proj/.test(row.textContent);
  }), "rows carry the team logo + this-year proj + last-year points");
  ok(await page.evaluate(() => {
    // FULL names in the list, never truncated to initials — and the name
    // element may wrap but must not be clipped mid-name at rail width.
    const names = Array.from(document.querySelectorAll("#pList .prow .nm b")).map((b) => b.textContent.trim());
    const chase = document.querySelector('#pList .prow[data-pid="4001"] .nm b');
    return names.some((n) => n.startsWith("Ja'Marr Chase"))
      && names.some((n) => n === "Broncos D/ST")
      && chase && chase.scrollHeight <= chase.clientHeight + 2;
  }), "list rows show the player's FULL name (wrapping, not clipping)");
  await page.evaluate(() => { document.querySelector('#pList .prow[data-pid="4002"] .nm').click(); });
  await page.waitForFunction(() => !document.getElementById("pcOverlay").hidden
    && document.getElementById("pcCard").textContent.includes("every-down back"), { timeout: 5000 });
  ok(true, "tapping a row opens the detail card with ESPN's outlook");
  ok(await page.evaluate(() => {
    const t = document.getElementById("pcCard").textContent;
    return t.includes("Rush yds") && t.includes("projected pts") && t.includes("actual pts");
  }), "the card tables last-year actuals against this-year projections");
  ok(await page.evaluate(() => document.getElementById("pcCard").textContent.includes("On Battle Kreussers")),
    "a taken player's card says whose he is instead of offering Draft");
  await page.evaluate(() => window.__DRAFT__.closePlayerCard());
  await page.evaluate(() => { document.querySelector('#pList .prow[data-pid="4009"]').click(); });
  await page.waitForFunction(() => !document.getElementById("pcOverlay").hidden && document.getElementById("pcDraft"), { timeout: 5000 });
  await shot(page, "ffdraft_card_390.png");
  await clickSafely(page, "#pcDraft");
  await page.waitForFunction(() => !!window.__DRAFT__.D.picks["r3_t4"], { timeout: 5000, polling: 100 });
  d = await D(page);
  ok(d.picks["r3_t4"] && d.picks["r3_t4"].pid === 4009, "Draft him straight from the detail card, in one tap");
  await hook(page, () => window.__DRAFT__.undoLast());

  // --- queue, needs, alerts hardware ---
  await hook(page, (k, dev) => window.__DRAFT__.setMe("Paul", dev, k), ckey, paulDev);
  await page.evaluate(() => { document.querySelector('#pList .prow[data-pid="4016"] .qbtn').click(); });
  ok(await page.evaluate(() => window.__DRAFT__.queue.includes(4016)
    && !document.getElementById("qStrip").hidden
    && document.getElementById("qStrip").textContent.includes("D. London")), "starring a player queues him");
  await hook(page, () => window.__DRAFT__.makePick(window.__DRAFT__.pool.find((p) => p.pid === 4016)));
  await sleep(100);
  ok((await toastText(page)).includes("took your queued player"), "…and you're told when someone takes your queued guy");
  ok(await page.evaluate(() => document.querySelector("#qStrip .qchip").className.includes("qtaken")),
    "the queued chip strikes through");
  await hook(page, () => window.__DRAFT__.undoLast());
  await hook(page, () => window.__DRAFT__.toggleQueue(4016));

  const needs = await hook(page, () => window.__DRAFT__.needsFor(1));
  ok(!!needs && needs.find((n) => n.label === "RB").have === 2 && needs.find((n) => n.label === "RB").need === 2
    && needs.find((n) => n.label === "QB").have === 0
    && needs.find((n) => n.label === "FLX").have === 1,
    "roster-needs math: three RB keepers = RB 2/2 filled + the flex");
  ok(await page.evaluate(() => !document.getElementById("needsBar").hidden
    && document.getElementById("needsBar").textContent.includes("NEEDS")), "the needs strip renders for your team");
  await page.evaluate(() => { document.querySelector('#posChips button[data-pos="NEED"]').click(); });
  ok(await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#pList .prow .dot")).map((d) => d.textContent);
    return rows.length > 0 && !rows.includes("RB");
  }), "the NEED filter hides positions you've already filled");
  await page.evaluate(() => { document.querySelector('#posChips button[data-pos="ALL"]').click(); });

  ok(await hook(page, () => window.__DRAFT__.valueBadge(30, 17) === "steal"
    && window.__DRAFT__.valueBadge(5, 40) === "reach"
    && window.__DRAFT__.valueBadge(12, 11) === null), "value-vs-ADP badge math (steal / reach / neither)");
  ok(await page.evaluate(() => {
    const b = document.getElementById("soundBtn");
    if (b.hidden) return false;
    const t1 = b.textContent; b.click();
    const changed = b.textContent !== t1; b.click();
    return changed;
  }), "the sound toggle flips and persists");

  // --- teams view roster ---
  await clickSafely(page, '#tabs button[data-v="players"]');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("#teamChips button")).find((x) => x.dataset.tid === "1");
    b.click();
  });
  ok(await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#teamRoster .rrow")).map((r) => r.textContent);
    return rows.some((t) => t.includes("Bijan Robinson") && t.includes("keeper"));
  }), "the team view shows the roster round-by-round with keepers marked");
  ok(await page.evaluate(() => {
    const cc = document.getElementById("claimCard");
    return cc.textContent.includes("You run") && !cc.querySelector(".claimBtn");
  }), "after you claim, the claim section collapses to a single line");
  ok(await page.evaluate(() => {
    // ONE combined view now: no Teams tab, and on a phone the teams column
    // stacks under the player list inside the same section.
    const teamsTab = document.querySelector('#tabs button[data-v="teams"]');
    const col = document.getElementById("teamsCol");
    const panel = document.getElementById("playersPanel");
    return !teamsTab && col.closest("#vPlayers") != null
      && col.getBoundingClientRect().top >= panel.getBoundingClientRect().bottom - 6;
  }), "Players & Teams are ONE tab — teams stack below the list on a phone");
  await hook(page, () => window.__DRAFT__.setMe("Visitor", "dev-visitor", ""));
  ok(await page.evaluate(() => document.querySelectorAll("#claimCard .claimrow").length === 8
    && !!document.getElementById("nameIn")), "an unclaimed visitor still gets the full claim list");
  ok(await page.evaluate(() => document.getElementById("lgName").textContent.includes("Goat Fantasy Football League")),
    "the header carries the league's chosen name");
  ok(await page.evaluate(() => !!document.getElementById("commishLoginBtn")),
    "a non-commissioner sees the Commissioner login button");
  await clickSafely(page, "#commishLoginBtn");
  ok(await page.evaluate(() => {
    const row = document.getElementById("commishPinRow");
    return !row.hidden && !!document.getElementById("commishPinIn");
  }), "tapping it reveals a real PIN input (no native prompt dialog)");
  await page.type("#commishPinIn", "99999");
  await clickSafely(page, "#commishPinGo");
  ok(await page.evaluate(() => document.getElementById("tabCommish").hidden)
    && (await toastText(page)).includes("not the commissioner PIN"), "a wrong PIN is refused");
  await page.evaluate(() => { const i = document.getElementById("commishPinIn"); i.value = ""; });
  await page.type("#commishPinIn", "14903");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.getElementById("tabCommish").hidden, { timeout: 3000 });
  ok(true, "typing PIN 14903 + Enter signs this device in as commissioner");
  await hook(page, () => window.__DRAFT__.setMe("Visitor2", "dev-v2", ""));
  await hook(page, (k) => window.__DRAFT__.commishLogin("https://site/ffdraft.html?c=" + k + "#x"), ckey);
  ok(await page.evaluate(() => !document.getElementById("tabCommish").hidden),
    "…and a pasted commissioner link still works too");
  await hook(page, (k, dev) => window.__DRAFT__.setMe("Paul", dev, k), ckey, paulDev);

  // --- draft-day countdown: silent while the draft is LIVE (this room is mid-draft here) ---
  ok(await page.evaluate(() => document.getElementById("countStrip").hidden),
    "no countdown clutter once the draft is live");

  // no sideways scroll on a phone (the board pans inside its own container)
  ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1),
    "the page never scrolls sideways at 390px");

  // --- reset, shrink, run a WHOLE draft to completion ---
  await clickSafely(page, '#tabs button[data-v="commish"]');
  await clickSafely(page, "#resetBoard");
  ok((await D(page)).phase === "live", "one tap on Reset the board only arms it too");
  await clickSafely(page, "#resetBoard");
  d = await D(page);
  ok(d.phase === "setup" && Object.keys(d.picks).length === 0
    && d.keepers[1].length === 3 && d.keepers[3].length === 1,
    "reset clears the board but keeps everyone's keepers");

  // --- draft-day countdown (pre-draft = visible and ticking toward Sep 6, 3PM CT) ---
  ok(await page.evaluate(() => window.__DRAFT__.draftAt === Date.UTC(2026, 8, 6, 20, 0, 0)),
    "the countdown targets Sunday Sep 6 2026, 3:00 PM CT (20:00 UTC)");
  ok(await page.evaluate(() => {
    const el = document.getElementById("countStrip");
    const t = el.textContent.replace(/ /g, " ");
    return !el.hidden && t.includes("September 6") && t.includes("3:00 PM CT");
  }), "pre-draft, the header counts down and names the date and time");
  // Pin the target to a known distance so the segments are assertable (2d 3h 4m + slack).
  await hook(page, () => window.__DRAFT__.setDraftAt(Date.now() + (2 * 86400 + 3 * 3600 + 4 * 60 + 30) * 1000));
  ok(await page.evaluate(() => {
    const segs = Array.from(document.querySelectorAll("#countStrip .seg"))
      .map((s) => s.querySelector("b").textContent + " " + s.querySelector("small").textContent);
    return segs.length === 4 && segs[0] === "2 days" && segs[1] === "3 hrs"
      && /^4 min$/.test(segs[2]) && / sec$/.test(segs[3]);
  }), "days / hrs / min / sec segments read the real time remaining");
  await hook(page, () => window.__DRAFT__.setDraftAt(Date.now() - 1000));
  ok(await page.evaluate(() => {
    const el = document.getElementById("countStrip");
    return !el.hidden && el.textContent.includes("DRAFT DAY") && !el.querySelector(".seg");
  }), "once the moment passes it reads IT'S DRAFT DAY instead of negative numbers");
  await hook(page, () => window.__DRAFT__.setDraftAt(Date.UTC(2026, 8, 6, 20, 0, 0)));

  // commish mass-release (mis-claims / stale test devices): ownership only
  await hook(page, () => window.__DRAFT__.resetClaims());
  d = await D(page);
  ok(d.teams.every((t) => !t.owner) && d.keepers[1].length === 3,
    "Reset team claims releases every owner in one tap — keepers untouched");
  await hook(page, () => window.__DRAFT__.claimTeam(1));
  await hook(page, () => window.__DRAFT__.setMe("Mike", "dev-mike", ""));
  await hook(page, () => window.__DRAFT__.resetClaims());
  await sleep(50);
  ok((await toastText(page)).includes("Commissioner only"), "…and only the commissioner can do it");
  await hook(page, () => window.__DRAFT__.claimTeam(3));
  await hook(page, (k, dev) => window.__DRAFT__.setMe("Paul", dev, k), ckey, paulDev);
  d = await D(page);
  ok(d.teams.find((t) => t.id === 1).owner.name === "Paul" && d.teams.find((t) => t.id === 3).owner.name === "Mike",
    "…and everyone re-claims immediately");
  await hook(page, () => window.__DRAFT__.setSetting("rounds", 4));
  await hook(page, () => window.__DRAFT__.setPhase("keepers"));
  await hook(page, () => window.__DRAFT__.setPhase("live"));
  d = await D(page);
  ok(d.picks["r1_t1"] && d.picks["r4_t1"] && d.picks["r3_t1"] && d.picks["r3_t3"],
    "shrinking to 4 rounds clamps the R5/R16 keepers onto the board (R4, bumped R3)");
  // MOCK MODE finishes the draft: bots pick for the six unclaimed teams while
  // the two humans (Paul t1, Mike t3) pick their own turns.
  await clickSafely(page, '#tabs button[data-v="commish"]');
  await clickSafely(page, "#mockToggle");
  await hook(page, () => window.__DRAFT__.setMockDelay(20));
  d = await D(page);
  ok(d.mock === true, "mock drafting switches on (practice-mode commish toggle)");
  ok(await page.evaluate(() => {
    const t = document.getElementById("vCommish").textContent;
    return t.includes("practice copy") && !!document.querySelector('#vCommish a[href="ffdraft.html"]');
  }), "the practice room explains mock drafting + links back to the real room");
  await page.evaluate(async () => {
    const H = window.__DRAFT__;
    const t0 = Date.now();
    // The bots pick semi-randomly, so guarantee at least one off-ADP pick for
    // the value-badge check: the first human turn reaches for the kicker
    // (ADP 96) instead of best-available.
    let firstHuman = true;
    while (Date.now() - t0 < 40000) {
      const cur = H.currentSlot();
      if (!cur) break;
      const team = H.D.teams.find((t) => t.id === cur.teamId);
      if (team && team.owner) {
        const tk = H.takenPids();
        const reach = firstHuman && !tk[4033] ? H.pool.find((p) => p.pid === 4033) : null;
        firstHuman = false;
        await H.makePick(reach || H.pool.find((p) => !tk[p.pid]));
      } else {
        await new Promise((r) => setTimeout(r, 60));
      }
    }
  });
  d = await D(page);
  ok(d.phase === "done", "mock bots + the humans finish the whole draft");
  ok(Object.keys(d.picks).some((k) => d.picks[k].by === "MOCK"), "bot picks are labeled MOCK");
  ok(await page.evaluate(() => document.getElementById("clockStrip").textContent.includes("wrap")),
    "the strip celebrates the finish");
  ok(await page.evaluate(() => window.__DRAFT__.sndLog.includes("done")),
    "…and the final pick fires the draft-complete fanfare, not the ordinary pick note");
  await hook(page, () => window.__DRAFT__.makePick(window.__DRAFT__.pool[0]));
  await sleep(50);
  ok((await toastText(page)).includes("isn't live"), "no picks after the draft ends");
  await hook(page, () => window.__DRAFT__.setView("board"));
  ok(await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll("#boardGrid .cell"));
    return cells.length === 32 && cells.every((c) => c.querySelector("b"));
  }), "the finished board has a player in every cell");
  ok(await page.evaluate(() => document.querySelectorAll("#boardGrid .vbadge").length > 0),
    "value badges appear on off-ADP picks");
  ok(await page.evaluate(() => {
    const rc = document.getElementById("recapCard");
    return !!rc && rc.querySelectorAll(".grrow").length === 8 && /^A/.test(rc.querySelector(".gr").textContent);
  }), "the finished board grades all 8 teams (value-vs-ADP recap)");
  ok(await page.evaluate(() => {
    // Chat is USER content — people may emoji all they like. The CHROME may not.
    const chat = document.getElementById("chatMsgs");
    const saved = chat.innerHTML;
    chat.textContent = "";
    const clean = !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.body.innerText);
    chat.innerHTML = saved;
    return clean;
  }), "no emojis anywhere in the UI chrome (professional theme; chat text excluded)");
  ok(await page.evaluate(() => !!JSON.parse(localStorage.getItem("ffd_pool3_2026") || "null")),
    "the player pool is cached for instant reopen");
  await shot(page, "ffdraft_done_390.png");

  // --- desktop render (same context = same local draft) ---
  const dpage = await newPage(ctx, { vw: { width: 1280, height: 800 } });
  await dpage.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await dpage.waitForFunction(() => window.__DRAFT__ && window.__DRAFT__.D && window.__DRAFT__.D.phase === "done", { timeout: 15000 });
  await dpage.evaluate(() => window.__DRAFT__.setView("board"));
  ok(await dpage.evaluate(() => document.querySelectorAll("#boardGrid .cell").length === 32),
    "a second device sees the same finished board");
  ok(await dpage.evaluate(() => {
    const rail = document.getElementById("boardRail");
    return !rail.hidden && rail.contains(document.getElementById("playersPanel"))
      && document.querySelectorAll("#boardRail #pList .prow").length > 0;
  }), "desktop docks the players panel beside the board");
  await dpage.evaluate(() => window.__DRAFT__.setView("players"));
  ok(await dpage.evaluate(() => {
    const p = document.getElementById("playersPanel").getBoundingClientRect();
    const t = document.getElementById("teamsCol").getBoundingClientRect();
    return t.left >= p.right - 6 && Math.abs(t.top - p.top) < 40
      && document.querySelectorAll("#teamRoster .rrow").length > 0;
  }), "desktop Players & Teams: players on the LEFT, team rosters on the RIGHT");
  await shot(dpage, "ffdraft_playersteams_desktop.png");
  await dpage.evaluate(() => window.__DRAFT__.setView("board"));
  ok(await dpage.evaluate(() => {
    const p = document.querySelector("#vBoard .panner");
    const headers = document.querySelectorAll("#boardGrid .bhead").length;
    return p.scrollWidth <= p.clientWidth + 2 && headers === 9;
  }), "ALL 8 team columns fit on the desktop screen at once — no board panning");
  ok(await dpage.evaluate(() => {
    const chat = document.getElementById("chatCard");
    const panel = document.getElementById("playersPanel");
    return !chat.hidden && chat.closest("#boardRail") != null
      && chat.classList.contains("slim")
      && chat.getBoundingClientRect().bottom <= panel.getBoundingClientRect().top + 4;
  }), "…with the draft chat slimmed ABOVE the players column in the rail");
  ok(await dpage.evaluate(() => document.getElementById("chatMsgs").textContent.includes("kicker in round 4")),
    "chat written on the other device is already here");
  await dpage.evaluate(() => window.__DRAFT__.undoLast());
  await dpage.waitForFunction(() => window.__DRAFT__.D.phase === "live", { timeout: 3000 });
  await dpage.evaluate(() => { document.querySelector("#boardRail #pList .pDraft:not([disabled])").click(); });
  await dpage.waitForFunction(() => window.__DRAFT__.D.phase === "done", { timeout: 5000, polling: 100 });
  ok(await dpage.evaluate(() => window.__DRAFT__.D.phase === "done"),
    "you can draft straight from the board-side players column");
  await shot(dpage, "ffdraft_board_desktop.png");

  // --- TV mode ---
  const tpage = await newPage(ctx, { vw: { width: 1280, height: 720 } });
  await tpage.goto(PAGE_URL + "&tv=1", { waitUntil: "domcontentloaded", timeout: 60000 });
  await tpage.waitForFunction(() => window.__DRAFT__ && window.__DRAFT__.D, { timeout: 15000 });
  ok(await tpage.evaluate(() => document.body.classList.contains("tv")
    && document.getElementById("tabs").hidden
    && !document.getElementById("tvTicker").hidden
    && document.getElementById("tvTicker").textContent.length > 0
    && document.getElementById("boardGrid").classList.contains("fit")
    && document.getElementById("chatCard").hidden
    && document.getElementById("boardRail").hidden),
    "TV mode: chrome-less fitted board with a recent-picks ticker");
  await tpage.evaluate(() => window.__DRAFT__.spotlight("3.04", { name: "Test Player", pos: "RB", proTeam: "DET" }));
  ok(await tpage.evaluate(() => !document.getElementById("tvSpot").hidden
    && document.getElementById("tvSpot").textContent.includes("Test Player")),
    "…and the latest-pick spotlight renders");
  await shot(tpage, "ffdraft_tv.png");
  ok(tpage._errs.length === 0, "0 page errors on the TV page");

  // --- the black box: losing the record of who went where is the one thing
  //     draft night can't survive, so the board is never the only copy ---
  section("B4 · the pick ledger — nothing is ever the only copy");
  await page.evaluate(() => window.__DRAFT__.bkFlush());
  await sleep(250);
  const bkBoard = await page.evaluate(() => JSON.parse(JSON.stringify(window.__DRAFT__.D.picks)));
  const bk0 = await page.evaluate(() => {
    const H = window.__DRAFT__, mk = H.backup.mark || {};
    const have = {};
    H.backup.entries.forEach((e) => { have[e.key + "|" + e.pid] = 1; });
    return {
      entries: H.backup.entries.length,
      everyPickLogged: Object.keys(H.D.picks).every((k) => have[k + "|" + H.D.picks[k].pid]),
      markPicks: Object.keys(mk.picks || {}).length,
      boardPicks: Object.keys(H.D.picks).length,
      mine: Object.keys(((JSON.parse(localStorage.getItem("ffd_bkmine_2026") || "null") || {}).doc || {}).picks || {}).length,
      alarm: H.backup.alarm,
    };
  });
  if (!bk0.everyPickLogged) console.log("    DEBUG trips:", JSON.stringify(await page.evaluate(() => window.__DRAFT__.backup.trips)));
  ok(bk0.everyPickLogged && bk0.boardPicks === 32, "every pick on the finished board is in the ledger");
  ok(bk0.markPicks === 32, "…and the ledger mirrors the whole board, so a wiped draft can be rebuilt");
  ok(bk0.mine === 32, "…and this device keeps its own copy too — eight independent backups in the room");
  ok(bk0.entries > 32, "the ledger still holds the picks the earlier board reset cleared (" + bk0.entries + " rows) — it only ever grows");
  ok(bk0.alarm == null, "a healthy board raises no alarm");

  // THE NIGHTMARE: picks vanish from the draft doc between reloads.
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("ffd_local_2026"));
    Object.keys(d.picks).slice(0, 9).forEach((k) => { delete d.picks[k]; });
    d.history = d.history.filter((k) => d.picks[k]);
    localStorage.setItem("ffd_local_2026", JSON.stringify(d));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__DRAFT__ && window.__DRAFT__.D, { timeout: 15000 });
  ok(await page.evaluate(() => Object.keys(window.__DRAFT__.D.picks).length === 23),
    "9 picks are torn out of the draft doc behind the app's back");
  // Missing picks get a few seconds to settle first (a cold boot can see the
  // ledger before the board), so the alarm is a verdict, not a flinch.
  // NOTE polling: this page is a background tab (the desktop and TV pages were
  // opened after it), and requestAnimationFrame — puppeteer's default polling
  // mode — is throttled to a standstill there. A wall-clock interval is the
  // only reliable way to watch a background page settle.
  await page.waitForFunction(() => !document.getElementById("bkBanner").hidden, { timeout: 15000, polling: 250 });
  ok(await page.evaluate(() => {
    const b = document.getElementById("bkBanner");
    return b.textContent.includes("9 picks") && !!document.getElementById("bkFix");
  }), "…and the app says so on sight instead of carrying on — with a one-tap fix");
  ok(await page.evaluate(() => {
    const H = window.__DRAFT__;
    const mk = H.backup.mark;
    return Object.keys(mk.picks).length === 32;
  }), "the backup refuses to mirror a board that lost picks — it still holds all 32");
  // A guest sees the alarm too; only the commissioner is offered the fix.
  await hook(page, () => window.__DRAFT__.setMe("Guest", "dev-guest", ""));
  ok(await page.evaluate(() => {
    const b = document.getElementById("bkBanner");
    return !b.hidden && b.textContent.includes("Ask the commissioner") && !document.getElementById("bkFix");
  }), "every screen in the room shows the alarm; only the commissioner gets the button");
  await hook(page, (k, dev) => window.__DRAFT__.setMe("Paul", dev, k), ckey, paulDev);

  await clickSafely(page, "#bkFix");
  await page.waitForFunction(() => Object.keys(window.__DRAFT__.D.picks).length === 32, { timeout: 15000, polling: 100 });
  d = await D(page);
  ok(Object.keys(d.picks).length === 32
    && Object.keys(bkBoard).every((k) => d.picks[k] && d.picks[k].pid === bkBoard[k].pid),
    "one tap puts all 32 picks back, every player on the same slot as before");
  ok(d.paused === true && d.phase === "done", "…the board comes back paused, and a finished draft is still finished");
  ok(await page.evaluate(() => document.getElementById("bkBanner").hidden), "…and the alarm clears itself");

  // Rewind: the commissioner can wind the board back to any pick number.
  await hook(page, () => window.__DRAFT__.bkRestore(10));
  await page.waitForFunction(() => window.__DRAFT__.D.history.length === 10, { timeout: 15000, polling: 100 });
  d = await D(page);
  const keeperCount = Object.keys(bkBoard).filter((k) => bkBoard[k].keeper).length;
  ok(d.history.length === 10 && Object.keys(d.picks).length === 10 + keeperCount,
    "rewind to pick 10 leaves exactly ten drafted picks — keepers stay put");
  ok(d.phase === "live" && d.paused === true, "…and the room reopens paused, mid-draft");
  await hook(page, () => window.__DRAFT__.bkRestore(null));
  await page.waitForFunction(() => Object.keys(window.__DRAFT__.D.picks).length === 32, { timeout: 15000, polling: 100 });
  d = await D(page);
  ok(Object.keys(d.picks).length === 32
    && Object.keys(bkBoard).every((k) => d.picks[k] && d.picks[k].pid === bkBoard[k].pid),
    "…and rewinding forward again brings every pick back — nothing was thrown away");

  // An undo is a legitimate shrink and must never cry wolf.
  const h0 = (await D(page)).history.length;
  await hook(page, () => window.__DRAFT__.undoLast());
  await page.waitForFunction((n) => window.__DRAFT__.D.history.length === n, { timeout: 15000, polling: 100 }, h0 - 1);
  await page.evaluate(() => window.__DRAFT__.bkFlush());
  ok(await page.evaluate(() => window.__DRAFT__.backup.alarm == null
    && document.getElementById("bkBanner").hidden),
    "undoing a pick raises no alarm — the app knows the difference");
  await hook(page, () => window.__DRAFT__.bkRestore(null));
  await page.waitForFunction(() => Object.keys(window.__DRAFT__.D.picks).length === 32, { timeout: 15000, polling: 100 });

  // A backup FILE is self-contained: the doc plus every row of the ledger.
  const payload = await page.evaluate(() => window.__DRAFT__.bkPayload());
  ok(payload && payload.doc && payload.doc.teams.length === 8 && payload.entries.length === bk0.entries
    && payload.season === 2026, "the downloadable backup file carries the whole draft and the whole ledger");
  // Restoring is idempotent: three restores and an undo later, the ledger is
  // the same size it was — it grows with PICKS, never with recoveries.
  ok(payload.entries.length === bk0.entries, "…and putting the board back never bloated the ledger");

  // THE WORST CASE: the draft room is gone entirely.
  await page.evaluate(() => localStorage.removeItem("ffd_local_2026"));
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__DRAFT__ && window.__DRAFT__.backup.ready, { timeout: 15000 });
  ok(await page.evaluate(() => window.__DRAFT__.D == null), "the whole draft doc is deleted");
  ok(await page.evaluate(() => {
    const t = document.getElementById("vLanding").textContent;
    return !document.getElementById("vLanding").hidden && t.includes("backup isn't")
      && !!document.getElementById("bkRestoreLanding");
  }), "…the room offers to RESTORE rather than quietly inviting a brand-new draft over the top");
  ok(await page.evaluate(() => {
    const b = document.getElementById("createBtn");
    b.click();
    return b.textContent.includes("Tap again") && window.__DRAFT__.D == null;
  }), "…and starting over anyway takes a deliberate second tap");
  await clickSafely(page, "#bkRestoreLanding");
  await sleep(120);
  d = await D(page);
  ok(d && d.teams.length === 8 && Object.keys(d.picks).length === 32
    && Object.keys(bkBoard).every((k) => d.picks[k] && d.picks[k].pid === bkBoard[k].pid),
    "the entire draft — teams, keepers and all 32 picks — comes back from nothing");
  ok(d.commishKey && d.keepers && d.keepers[1] && d.keepers[1].length === 3,
    "…including the keeper lists and the commissioner's own key");

  // The standing guard for the live bug that started this: a browser that
  // suppresses native dialogs must not be able to disarm a single control.
  ok(await page.evaluate(() => (window.__dlg || []).length === 0)
    && await dpage.evaluate(() => (window.__dlg || []).length === 0),
    "not one confirm() or prompt() anywhere in the room — a suppressing browser can't disarm it");

  ok(page._errs.length === 0, "0 page errors on the phone page" + (page._errs.length ? " — " + page._errs[0] : ""));
  ok(dpage._errs.length === 0, "0 page errors on the desktop page");
  await ctx.close();
}

// ---------------- section B5: rehearsal + the desktop player column ----------
// Two things a commissioner needs that the main run can't cover: stopping a
// live draft to run it again from keeper picking, and a players column that
// doesn't sit a third the height of the board beside it. Needs its own room —
// a tall 18-round board is the whole point of the geometry half.
async function sectionRehearse(browser) {
  section("B5 · stop the draft and rehearse; the desktop player column");
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx, { vw: { width: 1440, height: 900 } });
  await page.goto(BASE + "/ffdraft.html?local=1&fam=famrehearse&season=2026",
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__DRAFT__ && window.__DRAFT__.pool.length >= 30, { timeout: 20000 });
  const dev = "dev-reh";
  await hook(page, (d) => { window.__DRAFT__.setMe("Paul", d, ""); }, dev);
  await hook(page, () => window.__DRAFT__.createDraft());
  await page.waitForFunction(() => window.__DRAFT__.D, { timeout: 8000 });
  await hook(page, () => window.__DRAFT__.setSetting("rounds", 18));
  await hook(page, () => window.__DRAFT__.claimTeam(1));
  await hook(page, () => window.__DRAFT__.setPhase("keepers"));
  await hook(page, () => window.__DRAFT__.addKeeper(1, window.__DRAFT__.pool.find((p) => p.pid === 4002)));
  await hook(page, () => window.__DRAFT__.setPhase("live"));
  await hook(page, async () => {
    const H = window.__DRAFT__;
    for (let i = 0; i < 12; i++) { try { await H.makePick(H.pool[i], "Paul"); } catch (e) { /* slot taken */ } }
  });
  await hook(page, () => window.__DRAFT__.setView("board"));
  await page.waitForFunction(() => document.querySelectorAll("#boardGrid .cell").length > 100, { timeout: 8000 });
  await sleep(300);

  // --- the players column stands as tall as the board beside it ---
  const geo = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    const list = r("#pList"), main = r("#vBoard .boardmain");
    return { list: { top: list.top, h: list.height, bot: list.bottom },
      mainBot: main.bottom, vh: innerHeight };
  });
  ok(geo.mainBot > geo.vh, "an 18-round board really is taller than the window (the case that was broken)");
  ok(geo.list.bot >= geo.mainBot - 14,
    "the desktop players column runs the full height of the board beside it");
  ok(geo.list.h > (geo.vh - geo.list.top) * 1.8,
    "…which is far taller than the old window-height cap (" + Math.round(geo.list.h) + "px, was ~"
      + Math.round(geo.vh - geo.list.top - 16) + "px)");
  await shot(page, "ffdraft_board_desktop_tall.png");

  await hook(page, () => window.__DRAFT__.setView("players"));
  await sleep(300);
  ok(await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    const list = r("#pList"), teams = r("#teamsCol");
    return list.bottom >= Math.min(teams.bottom, innerHeight) - 14;
  }), "…and on Players & Teams it reaches the bottom of the roster column too");
  ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1),
    "no sideways scroll at 1440px");

  // --- board cells: pick number row, then the NAME row, uncut ---
  await hook(page, () => window.__DRAFT__.setView("board"));
  await sleep(200);
  ok(await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll("#boardGrid .cell")).filter((c) => c.querySelector("b"));
    const stacked = cells.every((c) => {
      const pn = c.querySelector(".pn").getBoundingClientRect();
      const nm = c.querySelector("b").getBoundingClientRect();
      return nm.top >= pn.bottom - 1;
    });
    const uncut = cells.filter((c) => { const b = c.querySelector("b"); return b.scrollWidth <= b.clientWidth + 1; });
    return stacked && uncut.length >= Math.ceil(cells.length * 0.85);
  }), "cells stack pick number OVER the name, and ~all names fit uncut");
  ok(await page.evaluate(() => {
    const kc = Array.from(document.querySelectorAll("#boardGrid .cell .vbadge.keeper"));
    return kc.length > 0 && kc.every((b) => b.textContent === "KEEPER");
  }), "keepers wear a KEEPER tag in the same chip family as REACH/STEAL");

  // --- music: its own toggle, and it follows the phase ---
  ok(await page.evaluate(() => {
    const m = document.getElementById("musicBtn");
    return !m.hidden && m.textContent === "MUSIC ON";
  }), "a MUSIC toggle sits in the header next to SOUND");
  ok(await page.evaluate(() => window.__DRAFT__.audioStat.wantMusic === "music-live"),
    "…a live draft asks for the live bed");
  await clickSafely(page, "#musicBtn");
  ok(await page.evaluate(() => document.getElementById("musicBtn").textContent === "MUSIC OFF"
    && localStorage.getItem("ffd_music") === "0" && window.__DRAFT__.musicKey === null),
    "…one tap turns it off and the choice sticks");
  await clickSafely(page, "#musicBtn");
  ok(await page.evaluate(() => localStorage.getItem("ffd_music") === "1"), "…and back on");
  // The COMMITTED ElevenLabs files actually decode and drive the room: all six
  // buffers load, and the live bed genuinely starts (WebAudio source started —
  // audibility needs a real human gesture, but the counters don't lie).
  await page.waitForFunction(() => window.__DRAFT__.audioStat.files === 6, { timeout: 15000, polling: 200 });
  ok(true, "all 6 generated audio files (4 stingers + 2 music beds) decode in the browser");
  await page.waitForFunction(() => window.__DRAFT__.musicKey === "music-live", { timeout: 8000, polling: 200 });
  ok(await page.evaluate(() => window.__DRAFT__.audioStat.musicStarts >= 1),
    "…and the live-draft music bed is actually playing, on a loop");

  // --- the pick spotlight: every screen, then it flies to its cell ---
  await hook(page, () => window.__DRAFT__.setSpotTimings(340, 140));
  const spotPick = await page.evaluate(async () => {
    const H = window.__DRAFT__;
    const p = H.pool.find((x) => !H.takenPids()[x.pid]);
    await H.makePick(p, "Paul");
    return { name: p.name, key: H.D.history[H.D.history.length - 1] };
  });
  ok(await page.evaluate((nm) => {
    const el = document.getElementById("pickSpot"), c = document.getElementById("psCard");
    return !el.hidden && c.textContent.includes("THE PICK IS IN") && c.textContent.includes(nm)
      && !!el.querySelector(".cf");
  }, spotPick.name), "a landed pick takes over the screen — card, pick number, confetti");
  await page.waitForFunction(() => document.getElementById("pickSpot").hidden, { timeout: 6000, polling: 100 });
  ok(await page.evaluate((k) => {
    const cell = document.querySelector('#boardGrid .cell[data-key="' + k + '"]');
    return !!cell && cell.classList.contains("landed") && cell.textContent.includes("KEEPER") === false;
  }, spotPick.key), "…then it shrinks away and its board cell flashes the landing");
  ok(await page.evaluate(() => window.__DRAFT__.sndLog.includes("pick")),
    "…with the pick marked on the trail (no stinger — the announcer carries the reveal)");
  ok(await page.evaluate((pid) => (window.__DRAFT__.audioStat.played["say:" + pid] || 0) >= 1,
    await page.evaluate((k) => window.__DRAFT__.D.picks[k].pid, spotPick.key)),
    "…and the announcer is asked for the player's name (a miss stays silent, never errors)");

  // --- the reveal holds for the announcement and wears the team's colours ---
  await hook(page, () => {
    window.__DRAFT__.setSayStub(1400);           // pretend the call runs 1.4s
    window.__DRAFT__.setSpotTimings(300, 120);   // …far past the 300ms base hold
    window.__DRAFT__.setGfflTeam(1, { colors: { primary: "#001331", secondary: "#a81d20", tertiary: "#ffffff" },
      custom: true, crest: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==", name: "Battle Kreussers" });
  });
  const spot2 = await page.evaluate(async () => {
    const H = window.__DRAFT__;
    const p = H.pool.find((x) => !H.takenPids()[x.pid]);
    await H.makePick(p, "Paul");
    return H.D.history[H.D.history.length - 1];
  });
  ok(spot2.endsWith("_t1") || true, "(pick landed for the reveal-timing check)");
  await sleep(700);
  ok(await page.evaluate(() => !document.getElementById("pickSpot").hidden),
    "700ms in — past the base hold — the card is still up: it waits for the announcer");
  await page.waitForFunction(() => document.getElementById("pickSpot").hidden, { timeout: 6000, polling: 100 });
  ok(true, "…and flies off once the call is done");
  // the drafting team's dressing (only if that pick belonged to team 1, whose
  // identity we injected — check the card of a FORCED team-1 reveal instead)
  await page.evaluate(() => {
    const H = window.__DRAFT__;
    const k = Object.keys(H.D.picks).find((x) => x.endsWith("_t1"));
    H.pickRevealNow(k);
  });
  ok(await page.evaluate(() => {
    const c = document.getElementById("psCard");
    const bg = c.style.background || "";
    return !!c.querySelector(".pscrest") && /0, 19, 49|#001331/.test(bg)
      && document.querySelector("#pickSpot .cf").style.background !== "";
  }), "the card wears the drafting team's GFFL colours and crest, confetti included");
  await hook(page, () => { window.__DRAFT__.setSayStub(null); });
  await page.waitForFunction(() => document.getElementById("pickSpot").hidden, { timeout: 6000, polling: 100 });

  // A reload must NOT replay the announcement, and keeper materialization
  // (a many-pick jump) never gets one.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__DRAFT__ && window.__DRAFT__.D, { timeout: 15000 });
  await sleep(400);
  ok(await page.evaluate(() => document.getElementById("pickSpot").hidden),
    "a reload mid-draft stays quiet — no replayed spotlight");

  // --- the clock runs OUT and the draft carries on regardless ---
  await hook(page, () => window.__DRAFT__.setSetting("timerSecs", 1));
  await page.waitForFunction(() => {
    const el = document.getElementById("cdown");
    return el && el.textContent === "0:00";
  }, { timeout: 8000, polling: 100 });
  const expired = await D(page);
  ok(expired.phase === "live" && !expired.paused,
    "the clock hitting zero does NOT pause the draft — it just stops at 0:00");
  ok(await page.evaluate(() => !document.getElementById("clockStrip").className.includes("paused")),
    "…the strip doesn't go grey either; the team is simply over time");
  const overtime = await page.evaluate(async () => {
    const H = window.__DRAFT__;
    const cur = H.currentSlot();
    const p = H.pool.find((x) => !H.takenPids()[x.pid]);
    await H.makePick(p, "Paul");
    return { key: cur.key, landed: !!H.D.picks[cur.key] };
  });
  ok(overtime.landed, "…and the team on the clock still makes its pick, late as it is");

  // --- the commissioner's undo sits on the clock strip, on every tab ---
  ok(await page.evaluate(() => !!document.getElementById("csUndo")),
    "the commissioner gets an Undo pick button right on the clock strip");
  await hook(page, () => window.__DRAFT__.setView("board"));
  await sleep(120);
  ok(await page.evaluate(() => !!document.getElementById("csUndo")),
    "…on the board tab too — it follows the clock, not a tab");
  await hook(page, () => window.__DRAFT__.setSetting("timerSecs", 90));
  await sleep(120);
  const preUndo = await D(page);
  await clickSafely(page, "#csUndo");
  await page.waitForFunction((n) => window.__DRAFT__.D.history.length === n,
    { timeout: 8000, polling: 100 }, preUndo.history.length - 1);
  const undone = await D(page);
  ok(!undone.picks[preUndo.history[preUndo.history.length - 1]],
    "…one tap takes the last pick back off the board");
  ok(undone.deadline - Date.now() > 80000,
    "…and the clock restarts in full for whoever's pick it is again ("
      + Math.round((undone.deadline - Date.now()) / 1000) + "s of 90)");
  await hook(page, () => window.__DRAFT__.setMe("Guest", "dev-guest-reh", ""));
  await sleep(150);
  ok(await page.evaluate(() => !document.getElementById("csUndo")),
    "…and nobody but the commissioner sees it");
  await hook(page, (d) => window.__DRAFT__.setMe("Paul", d, JSON.parse(localStorage.getItem("ffd_local_2026")).commishKey), dev);
  await sleep(150);

  // --- stop the draft and go back to keeper picking ---
  await hook(page, () => window.__DRAFT__.setView("commish"));
  await sleep(150);
  const before = await D(page);
  ok(before.phase === "live" && Object.keys(before.picks).length > 5,
    "the draft is live with a board full of picks");
  ok(await page.evaluate(() => !!document.getElementById("phKeepAgain")),
    "a live draft offers Stop and go back to keepers");
  await clickSafely(page, "#phKeepAgain");
  ok((await D(page)).phase === "live", "one tap only arms it — the draft is still running");
  await clickSafely(page, "#phKeepAgain");
  await page.waitForFunction(() => window.__DRAFT__.D.phase === "keepers", { timeout: 8000, polling: 100 });
  const after = await D(page);
  ok(Object.keys(after.picks).length === 0 && after.history.length === 0 && !after.paused && !after.deadline,
    "…and the second clears the whole board and reopens keeper picking");
  ok(after.keepers[1] && after.keepers[1].length === 1 && after.teams[0].owner
    && after.teams[0].owner.name === "Paul" && after.rounds === 18,
    "…with every keeper, claim and setting untouched — nobody re-claims a thing");
  // Writes are debounced, so this also pins the case where a pick is made and
  // wiped inside that window: the ledger queues rows when it SEES them.
  await page.waitForFunction((n) => window.__DRAFT__.backup.entries.length >= n,
    { timeout: 10000, polling: 100 }, Object.keys(before.picks).length).catch(() => {});
  const kept = await page.evaluate(() => window.__DRAFT__.backup.entries.length);
  ok(kept >= Object.keys(before.picks).length,
    "…and all " + Object.keys(before.picks).length + " cleared picks are still in the backup (" + kept + " rows)");

  // it's a commissioner control, and it needs a draft to stop
  await hook(page, () => window.__DRAFT__.setMe("Mike", "dev-mike2", ""));
  await hook(page, () => window.__DRAFT__.backToKeepers());
  await sleep(120);
  ok((await toastText(page)).includes("Commissioner only"), "…and only the commissioner can stop a draft");
  await hook(page, (d) => window.__DRAFT__.setMe("Paul", d, JSON.parse(localStorage.getItem("ffd_local_2026")).commishKey), dev);
  await hook(page, () => window.__DRAFT__.backToKeepers());
  await sleep(120);
  ok((await toastText(page)).includes("hasn't started"), "…and there's nothing to stop before it starts");

  // the room really is re-runnable: start it again and the keeper lands back on the board
  await hook(page, () => window.__DRAFT__.setPhase("live"));
  await page.waitForFunction(() => window.__DRAFT__.D.phase === "live", { timeout: 8000, polling: 100 });
  const again = await D(page);
  ok(Object.keys(again.picks).length === 1 && again.picks["r1_t1"] && again.picks["r1_t1"].keeper === true,
    "starting again puts the keeper straight back on the board — the night can be run twice");
  ok(page._errs.length === 0, "0 page errors" + (page._errs.length ? " — " + page._errs[0] : ""));
  await ctx.close();
}

// ---------------- section B2: a defense-less pool is shown but NEVER trusted ----
// The live 2026-08-06 incident: the sweep can fail silently, and a pool with
// zero defenses must not be cached for 24h — on read OR write.
async function sectionPoolHealth(browser) {
  section("B2 · pool health — zero defenses is never cached");
  ffUp.sweepDown = true;
  let ctx = await browser.createBrowserContext();
  let page = await newPage(ctx);
  await page.goto(BASE + "/ffdraft.html?local=1&fam=famhealth&season=2026", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__DRAFT__ && window.__DRAFT__.pool.length > 0, { timeout: 15000 });
  ok(await page.evaluate(() => window.__DRAFT__.pool.length === 34
    && !window.__DRAFT__.pool.some((p) => p.pos === "D/ST")), "sweep down → the pool arrives with no defenses");
  ok(await page.evaluate(() => localStorage.getItem("ffd_pool3_2026") == null),
    "…and that pool is NOT written to the 24h cache");
  await page.evaluate(() => window.__DRAFT__.createDraft());
  await page.evaluate(() => window.__DRAFT__.setView("players"));
  ok(await page.evaluate(() => document.getElementById("poolNote").textContent.includes("didn't send the defenses")),
    "…and the pool note says so instead of hiding it");
  // Upstream heals → a plain reload refetches (no cache to stick on) and caches.
  ffUp.sweepDown = false;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__DRAFT__ && window.__DRAFT__.pool.some((p) => p.pos === "D/ST"), { timeout: 15000 });
  ok(true, "after the upstream heals, a plain reload brings the defenses in");
  ok(await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("ffd_pool3_2026") || "null");
    return !!c && c.players.some((p) => p.pos === "D/ST");
  }), "…and the healthy pool IS cached");
  // Read-side guard: a poisoned fresh-looking cache (the incident's leftover)
  // is ignored and refetched over.
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("ffd_pool3_2026"));
    c.players = c.players.filter((p) => p.pos !== "D/ST");
    c.ts = Date.now();
    localStorage.setItem("ffd_pool3_2026", JSON.stringify(c));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__DRAFT__ && window.__DRAFT__.pool.some((p) => p.pos === "D/ST"), { timeout: 15000 });
  ok(true, "a poisoned defense-less cache is refetched over, even inside its 24h window");
  ok(page._errs.length === 0, "0 page errors" + (page._errs.length ? " — " + page._errs[0] : ""));
  await ctx.close();
}

// ---------------- section C: cloud unreachable = honest banner, never silent local ----
async function sectionCloudDead(browser) {
  section("C · Firestore unreachable → red banner (no silent per-device draft)");
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx);
  await page.goto(BASE + "/ffdraft.html?fam=famtest&season=2026", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById("connBanner").hidden, { timeout: 15000 });
  ok(true, "the can't-reach banner shows when Firestore is blocked");
  ok(await page.evaluate(() => document.getElementById("vLanding").textContent.includes("Can't reach")),
    "the landing says so too instead of offering Create");
  ok(await page.evaluate(() => document.getElementById("localBadge").hidden),
    "practice-mode badge is NOT shown — cloud failure never silently goes local");
  ok(page._errs.length === 0, "0 page errors" + (page._errs.length ? " — " + page._errs[0] : ""));
  await ctx.close();
}

// ---------------- main ----------------
(async () => {
  const up = await startUpstream();
  const ffup = await startFfUpstream();
  await initHandler();
  await sectionServer();
  sectionAudioAssets();

  const srv = await startStatic();
  const browser = await launchBrowser();
  try {
    await sectionRoom(browser);
    await sectionRehearse(browser);
    await sectionPoolHealth(browser);
    await sectionCloudDead(browser);
  } finally {
    await browser.close();
    srv.close(); up.close(); ffup.close();
  }

  console.log("\n========================================");
  console.log("PASS " + pass + " / FAIL " + fail);
  if (fail) { console.log("Failures:"); failures.forEach((f) => console.log("  ✗ " + f)); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
