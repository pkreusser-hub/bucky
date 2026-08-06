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
const ffUp = { lastUrl: "", lastFilter: "", standard: false, byesDown: false, mode: "normal", calls: 0 };
function startFfUpstream() {
  const srv = http.createServer((req, res) => {
    ffUp.calls++;
    ffUp.lastUrl = req.url;
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
    if (req.url.includes("view=kona_player_info")) {
      ffUp.lastFilter = req.headers["x-fantasy-filter"] || "";
      let doc = FIX.ffDraftPoolDoc();
      // Honor a filterIds filter the way the real upstream does (ff_player).
      try {
        const ids = JSON.parse(ffUp.lastFilter)?.players?.filterIds?.value;
        if (Array.isArray(ids)) doc = { players: doc.players.filter((e) => ids.includes(e.player.id)) };
      } catch (e) {}
      res.end(JSON.stringify(doc));
      return;
    }
    if (req.url.includes("view=mDraftDetail")) {
      res.end(JSON.stringify(FIX.ffLastDraftDoc()));
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
  ok(ffUp.lastFilter.includes("sortDraftRanks") && ffUp.lastFilter.includes('"PPR"'),
    "the X-Fantasy-Filter header asks for PPR draft ranks");
  ok(Array.isArray(r.json.players) && r.json.players.length === 36, "pool carries every fixture player");
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

  r = await call({ secret: "amenfarms", action: "ff_draftpool", format: "standard" });
  ok(!!r.json && r.json.format === "standard" && r.json.players[0].pid === 4002,
    "format:standard sorts by STANDARD ranks (Bijan #1)");
  ok(ffUp.lastFilter.includes('"STANDARD"'), "the filter header switches to STANDARD too");

  // ff_lastdraft — "last season" tracks the league-year rule (Jan/Feb belong
  // to the previous season), so compute the expectation the same way.
  const now = new Date();
  const seasonNow = now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const lastSeason = seasonNow - 1;
  r = await call({ secret: "amenfarms", action: "ff_lastdraft" });
  ok(!!r.json && r.json.ok === true && r.json.drafted === true, "ff_lastdraft answers ok");
  ok(new RegExp("/seasons/" + lastSeason + "/").test(ffUp.lastUrl), "defaults to LAST season (" + lastSeason + ")");
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
  r = await call({ secret: "amenfarms", action: "ff_lastdraft", year: 2024 });
  ok(/\/seasons\/2024\//.test(ffUp.lastUrl), "an explicit year is honored");

  // ff_player — the detail card's payload
  r = await call({ secret: "amenfarms", action: "ff_player", pid: 4002 });
  ok(!!r.json && r.json.ok === true && r.json.player.name === "Bijan Robinson", "ff_player answers with the player");
  ok(ffUp.lastFilter.includes("filterIds"), "…fetched through a filterIds filter (one player, not the whole pool)");
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
  await page.evaluateOnNewDocument(() => {
    window.prompt = () => null;
    window.alert = () => {};
    window.confirm = () => true;
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
  page.on("pageerror", (e) => { if (!NOISE.test(String(e))) page._errs.push(String(e)); });
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
  ok(await page.evaluate(() => document.getElementById("vLanding").textContent.includes("Nerd Fantasy Football League")),
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
  await clickSafely(page, '#tabs button[data-v="teams"]');
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
  await clickSafely(page, "#pList .pKeep");
  ok(await page.evaluate(() => {
    const t = document.getElementById("confirmBar").textContent;
    return t.includes("Round 5") && t.includes("drafted R6 last year");
  }), "the keep-confirm bar quotes the cost and its basis");
  await clickSafely(page, "#cbGo");
  d = await D(page);
  ok((d.keepers[1] || []).length === 1 && d.keepers[1][0].pid === 4014 && d.keepers[1][0].round === 5,
    "Achane kept at a Round 5 cost");

  await hook(page, () => window.__DRAFT__.addKeeper(1, window.__DRAFT__.pool.find((p) => p.pid === 4002)));
  d = await D(page);
  const bij = d.keepers[1].find((k) => k.pid === 4002);
  ok(bij && bij.keptCount === 2, "a player ESPN flags as last year's keeper starts at kept ×2");

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

  // Mike keeps Kelce; can't keep someone already spoken for
  await hook(page, () => window.__DRAFT__.setMe("Mike", "dev-mike", ""));
  await hook(page, () => window.__DRAFT__.addKeeper(3, window.__DRAFT__.pool.find((p) => p.pid === 4019)));
  await hook(page, () => window.__DRAFT__.addKeeper(3, window.__DRAFT__.pool.find((p) => p.pid === 4002)));
  await sleep(50);
  d = await D(page);
  ok((d.keepers[3] || []).length === 1 && d.keepers[3][0].round === 3, "Mike keeps Kelce at R3");
  ok((await toastText(page)).includes("already spoken for"), "keeping another team's keeper is refused");

  // swap Conner for the waiver guy via the last-year-roster quick chips
  await hook(page, (k, dev) => window.__DRAFT__.setMe("Paul", dev, k), ckey, paulDev);
  await hook(page, () => window.__DRAFT__.removeKeeper(1, 4022));
  await page.waitForFunction(() => document.querySelector('.kQuick[data-pid="4021"]'), { timeout: 3000 });
  ok(true, "last season's roster renders as quick keeper chips (incl. the waiver pickup)");
  await clickSafely(page, '.kQuick[data-pid="4021"]');
  ok(await page.evaluate(() => document.getElementById("confirmBar").textContent.includes("Round 16")),
    "waiver keeper confirm quotes the latest-pick cost");
  await clickSafely(page, "#cbGo");
  d = await D(page);
  ok(d.keepers[1].length === 3 && d.keepers[1].some((k) => k.pid === 4021), "team 1 keeps Bijan + Achane + the waiver pickup");

  // commish keeper override
  await hook(page, () => window.__DRAFT__.setKeeperField(3, 4019, "overrideRound", 2));
  d = await D(page);
  ok(d.keepers[3][0].overrideRound === 2, "commish can override a keeper's round");
  await hook(page, () => window.__DRAFT__.setKeeperField(3, 4019, "overrideRound", null));

  // --- start the draft: keepers materialize ---
  await clickSafely(page, '#tabs button[data-v="commish"]');
  await clickSafely(page, "#phLive");
  d = await D(page);
  ok(d.phase === "live", "the draft goes live");
  ok(d.picks["r1_t1"] && d.picks["r1_t1"].pid === 4002 && d.picks["r1_t1"].keeper === true,
    "Bijan locks onto the board at R1 as a keeper");
  ok(d.picks["r5_t1"] && d.picks["r5_t1"].pid === 4014 && d.picks["r16_t1"] && d.picks["r16_t1"].pid === 4021,
    "Achane at R5 and the waiver keeper at R16");
  ok(d.picks["r3_t3"] && d.picks["r3_t3"].pid === 4019, "Kelce locks at R3 for The Goat Kids");
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

  // Mike picks through the real UI at 1.03
  await hook(page, () => window.__DRAFT__.setMe("Mike", "dev-mike", ""));
  await clickSafely(page, '#tabs button[data-v="players"]');
  await page.type("#pSearch", "Saquon");
  await page.waitForFunction(() => document.querySelectorAll("#pList .pDraft:not([disabled])").length === 1, { timeout: 3000 });
  await clickSafely(page, "#pList .pDraft");
  await clickSafely(page, "#cbGo");
  d = await D(page);
  ok(d.picks["r1_t3"] && d.picks["r1_t3"].pid === 4003, "Mike drafts Barkley from his own phone at 1.03");
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

  // fill round 2, then verify the keeper slot mid-round-3 is skipped
  await hook(page, () => {
    const H = window.__DRAFT__;
    const pids = [4010, 4012, 4013, 4015, 4017, 4018, 4020, 4023];
    return pids.reduce((p, pid) => p.then(() => H.makePick(H.pool.find((x) => x.pid === pid))), Promise.resolve());
  });
  cur = await hook(page, () => window.__DRAFT__.currentSlot());
  ok(cur && cur.key === "r3_t1", "round 3 runs forward again");
  await hook(page, () => window.__DRAFT__.makePick(window.__DRAFT__.pool.find((p) => p.pid === 4024)));
  await hook(page, () => window.__DRAFT__.makePick(window.__DRAFT__.pool.find((p) => p.pid === 4025)));
  cur = await hook(page, () => window.__DRAFT__.currentSlot());
  ok(cur && cur.key === "r3_t4", "the clock SKIPS 3.03 — Kelce's keeper slot is already filled");

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
      keeperPos: k ? k.className : "",
      curKey: c ? c.dataset.key : null,
      filledHavePos: cells.filter((x) => x.querySelector("b")).every((x) => /pos-(QB|RB|WR|TE|K|DST|X)/.test(x.className)),
    };
  });
  ok(board.cells === 16 * 8, "the board renders every slot (16 rounds × 8 teams)");
  ok(board.keeperCell.includes("🔒") && board.keeperCell.includes("B. Robinson"), "keeper cells carry the lock + the player");
  ok(/pos-RB/.test(board.keeperPos), "cells are position-colored");
  ok(board.curKey === "r3_t4", "the on-the-clock cell is highlighted");
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
  ok(await page.evaluate(() => document.getElementById("chatCard").closest("#vPlayers") != null),
    "…and the chat follows you to the Players view");
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
  await page.evaluate(() => { document.getElementById("customPos").value = "TE"; });
  await clickSafely(page, "#cbGo");
  d = await D(page);
  const custom = d.picks["r3_t4"];
  ok(custom && String(custom.pid).indexOf("c_") === 0 && custom.pos === "TE" && custom.name === "Johnny Testman",
    "a custom player can be drafted by name with a chosen position");
  await hook(page, () => window.__DRAFT__.undoLast());
  await page.evaluate(() => { document.getElementById("pSearch").value = ""; document.getElementById("pSearch").dispatchEvent(new Event("input")); });
  await shot(page, "ffdraft_players_390.png");

  // --- own scroll + richer rows + the detail card ---
  await sleep(120);   // sizePList runs in a rAF after render
  ok(await page.evaluate(() => {
    const el = document.getElementById("pList");
    return getComputedStyle(el).overflowY === "auto" && el.scrollHeight > el.clientHeight + 40;
  }), "the players list scrolls inside itself, not the page");
  ok(await page.evaluate(() => {
    const row = document.querySelector("#pList .prow");
    const logo = row.querySelector(".tlogo");
    return !!logo && /espncdn\.com\/i\/teamlogos\/nfl/.test(logo.src)
      && /proj/.test(row.querySelector(".pstat").textContent);
  }), "rows carry the team logo + this-year proj + last-year points");
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
  await clickSafely(page, "#cbGo");
  d = await D(page);
  ok(d.picks["r3_t4"] && d.picks["r3_t4"].pid === 4009, "Draft him straight from the detail card");
  await hook(page, () => window.__DRAFT__.undoLast());

  // --- teams view roster ---
  await clickSafely(page, '#tabs button[data-v="teams"]');
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
  await hook(page, () => window.__DRAFT__.setMe("Visitor", "dev-visitor", ""));
  ok(await page.evaluate(() => document.querySelectorAll("#claimCard .claimrow").length === 8
    && !!document.getElementById("nameIn")), "an unclaimed visitor still gets the full claim list");
  await hook(page, (k, dev) => window.__DRAFT__.setMe("Paul", dev, k), ckey, paulDev);

  // no sideways scroll on a phone (the board pans inside its own container)
  ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1),
    "the page never scrolls sideways at 390px");

  // --- reset, shrink, run a WHOLE draft to completion ---
  await clickSafely(page, '#tabs button[data-v="commish"]');
  await clickSafely(page, "#resetBoard");
  d = await D(page);
  ok(d.phase === "setup" && Object.keys(d.picks).length === 0
    && d.keepers[1].length === 3 && d.keepers[3].length === 1,
    "reset clears the board but keeps everyone's keepers");
  await hook(page, () => window.__DRAFT__.setSetting("rounds", 4));
  await hook(page, () => window.__DRAFT__.setPhase("keepers"));
  await hook(page, () => window.__DRAFT__.setPhase("live"));
  d = await D(page);
  ok(d.picks["r1_t1"] && d.picks["r4_t1"] && d.picks["r3_t1"] && d.picks["r3_t3"],
    "shrinking to 4 rounds clamps the R5/R16 keepers onto the board (R4, bumped R3)");
  await hook(page, () => {
    const H = window.__DRAFT__;
    function step() {
      const cur = H.currentSlot();
      if (!cur) return Promise.resolve();
      const taken = H.takenPids();
      const p = H.pool.find((x) => !taken[x.pid]);
      return H.makePick(p).then(step);
    }
    return step();
  });
  d = await D(page);
  ok(d.phase === "done", "picking every open slot completes the draft");
  ok(await page.evaluate(() => document.getElementById("clockStrip").textContent.includes("wrap")),
    "the strip celebrates the finish");
  await hook(page, () => window.__DRAFT__.makePick(window.__DRAFT__.pool[0]));
  await sleep(50);
  ok((await toastText(page)).includes("isn't live"), "no picks after the draft ends");
  await hook(page, () => window.__DRAFT__.setView("board"));
  ok(await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll("#boardGrid .cell"));
    return cells.length === 32 && cells.every((c) => c.querySelector("b"));
  }), "the finished board has a player in every cell");
  ok(await page.evaluate(() => !!JSON.parse(localStorage.getItem("ffd_pool_2026") || "null")),
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
  ok(await dpage.evaluate(() => !document.getElementById("chatCard").hidden
    && document.getElementById("chatCard").closest("#vBoard") != null),
    "…with the draft chat under the board");
  ok(await dpage.evaluate(() => document.getElementById("chatMsgs").textContent.includes("kicker in round 4")),
    "chat written on the other device is already here");
  await dpage.evaluate(() => window.__DRAFT__.undoLast());
  await dpage.waitForFunction(() => window.__DRAFT__.D.phase === "live", { timeout: 3000 });
  await dpage.evaluate(() => { document.querySelector("#boardRail #pList .pDraft:not([disabled])").click(); });
  await clickSafely(dpage, "#cbGo");
  ok(await dpage.evaluate(() => window.__DRAFT__.D.phase === "done"),
    "you can draft straight from the board-side players column");
  await shot(dpage, "ffdraft_board_desktop.png");

  ok(page._errs.length === 0, "0 page errors on the phone page" + (page._errs.length ? " — " + page._errs[0] : ""));
  ok(dpage._errs.length === 0, "0 page errors on the desktop page");
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

  const srv = await startStatic();
  const browser = await launchBrowser();
  try {
    await sectionRoom(browser);
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
