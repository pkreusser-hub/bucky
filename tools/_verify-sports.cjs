// _verify-sports.cjs — verification for the NFL sports feature (sports.mjs + sports.html).
//
//   node tools/_verify-sports.cjs [--shots]
//
// Section A runs the REAL netlify/functions/sports.mjs in process against a fake
// ESPN upstream serving tools/_sports_fixtures.cjs (ESPN is egress-blocked from the
// dev sandbox — tools/_probe-sports.mjs re-checks real shapes post-deploy).
// Sections B+ drive the REAL sports.html in headless Chrome; the browser's calls to
// /.netlify/functions/sports are answered by the SAME in-process handler, so the
// UI is tested end-to-end through the real slimming code. All other external hosts
// (fonts, espncdn logos, firebase) are aborted.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { pathToFileURL } = require("url");
const FIX = require("./_sports_fixtures.cjs");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const UP_PORT = 8813;
const SRV_PORT = 8814;
const FF_PORT = 8815;
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

// Field-geometry expectations, computed independently of the page's own code.
const EZ = 83.33, PER_YD = 8.3334;
const fx = (pos) => EZ + pos * PER_YD;
function near(a, b, tol) { return a != null && Math.abs(a - b) <= (tol || 0.7); }

// ---------------- fake ESPN upstream ----------------
const upstream = { mode: "normal", sbVariant: "live", lastUrl: "", calls: 0 };
function startUpstream() {
  const srv = http.createServer((req, res) => {
    upstream.calls++;
    upstream.lastUrl = req.url;
    if (upstream.mode === "http500") { res.writeHead(500); res.end("nope"); return; }
    if (upstream.mode === "badjson") { res.writeHead(200, { "Content-Type": "application/json" }); res.end("{oops"); return; }
    if (upstream.mode === "drop") { req.socket.destroy(); return; }
    const u = new URL(req.url, "http://x");
    if (u.pathname.endsWith("/scoreboard")) {
      const data = upstream.sbVariant === "idle" ? FIX.scoreboardIdle() : FIX.scoreboardLive();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      return;
    }
    if (u.pathname.endsWith("/summary")) {
      const id = u.searchParams.get("event");
      const f = FIX.SUMMARIES[id];
      if (!f) { res.writeHead(404); res.end("{}"); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(f()));
      return;
    }
    res.writeHead(404); res.end("not found");
  });
  return new Promise((resolve) => srv.listen(UP_PORT, "127.0.0.1", () => resolve(srv)));
}

// ---------------- fake ESPN fantasy upstream ----------------
const ffUp = { mode: "normal", lastUrl: "", lastCookie: "", calls: 0 };
function startFfUpstream() {
  const srv = http.createServer((req, res) => {
    ffUp.calls++;
    ffUp.lastUrl = req.url;
    ffUp.lastCookie = req.headers.cookie || "";
    if (ffUp.mode === "http500") { res.writeHead(500); res.end("nope"); return; }
    // A private league answers 401 unless BOTH cookies are the good pair.
    const okAuth = ffUp.lastCookie.includes("espn_s2=" + GOOD_S2) && ffUp.lastCookie.includes("SWID={" + GOOD_SWID + "}");
    if (!okAuth) { res.writeHead(401, { "Content-Type": "application/json" }); res.end('{"messages":["You are not authorized"]}'); return; }
    if (!/\/apis\/v3\/games\/ffl\/seasons\/\d{4}\/segments\/0\/leagues\/705063/.test(req.url)) {
      res.writeHead(404); res.end("{}"); return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(FIX.ffLeagueDoc()));
  });
  return new Promise((resolve) => srv.listen(FF_PORT, "127.0.0.1", () => resolve(srv)));
}
function ffAuthGood() { process.env.ESPN_S2 = GOOD_S2; process.env.ESPN_SWID = GOOD_SWID; }   // unbraced SWID on purpose
function ffAuthWrong() { process.env.ESPN_S2 = "stale-cookie"; process.env.ESPN_SWID = GOOD_SWID; }
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
async function call(body, opts) {
  opts = opts || {};
  const method = opts.method || "POST";
  const init = { method, headers: { "content-type": "application/json", origin: opts.origin || "https://amenfarms.netlify.app" } };
  if (method === "POST") init.body = JSON.stringify(body || {});
  const resp = await handler(new Request("http://localhost/.netlify/functions/sports", init));
  const text = await resp.text();
  let j = null; try { j = JSON.parse(text); } catch (e) {}
  return { status: resp.status, headers: resp.headers, text, json: j };
}

// ---------------- section A: the function ----------------
async function sectionA() {
  section("A · sports.mjs in process (fake ESPN upstream)");

  let r = await call(null, { method: "OPTIONS" });
  ok(r.status === 204 && r.text === "", "OPTIONS preflight answers 204 with an empty body");
  r = await call(null, { method: "GET" });
  ok(r.status === 405, "GET is refused (405)");
  r = await call({ secret: "wrong", action: "nfl_scoreboard" });
  ok(r.status === 401, "a wrong family password is refused (401)");
  r = await call({ secret: "amenfarms", action: "nope" });
  ok(r.status === 400, "an unknown action is refused (400)");
  {
    const resp = await handler(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" }));
    ok(resp.status === 400, "invalid JSON is refused (400)");
  }

  // scoreboard
  const rawSb = JSON.stringify(FIX.scoreboardLive());
  r = await call({ secret: "amenfarms", action: "nfl_scoreboard" });
  const sb = r.json;
  ok(r.status === 200 && sb && sb.ok === true && sb.events.length === 5, "nfl_scoreboard returns ok with all 5 events");
  const live = sb && sb.events.find((e) => e.id === "401770001");
  ok(!!live && live.status.state === "in" && live.status.detail === "8:42 - 3rd" && live.status.period === 3,
    "a live event carries state/detail/period");
  ok(!!live && live.teams.length === 2 && live.teams[0].abbrev === "KC" && live.teams[0].score === "17"
    && live.teams[0].record === "0-0" && /espncdn\.com/.test(live.teams[0].logo) && live.teams[0].color === "e31837",
    "teams are slimmed with abbrev/score/record/logo/color");
  ok(!!live && live.situation && live.situation.possession === "12" && live.situation.down === 2
    && live.situation.distance === 7 && live.situation.downDistanceText === "2nd & 7"
    && /Pacheco/.test(live.situation.lastPlay),
    "the live situation carries possession, down & distance and the last play");
  const fin = sb && sb.events.find((e) => e.id === "401770004");
  ok(!!fin && fin.status.state === "post" && fin.status.completed === true
    && fin.teams.find((t) => t.abbrev === "HOU").winner === true && fin.situation === null,
    "a final event is completed with the winner flagged and no situation");
  ok(!!sb && !/odds|pickcenter|geoBroadcasts|headlines|"leaders"/.test(r.text),
    "odds / leaders / headline junk never reaches the client");
  ok(r.text.length < rawSb.length / 2, `the slimmed scoreboard is under half the raw payload (${r.text.length} vs ${rawSb.length} bytes)`);
  ok(!!sb && sb.calendar.length === 2 && sb.calendar[1].label === "Regular Season"
    && sb.calendar[1].weeks.length === 3 && sb.calendar[1].weeks[0].label === "Week 1",
    "the season calendar is flattened for the week picker");
  ok(!!sb && sb.week === 1 && sb.season.year === 2026 && sb.season.type === 2, "week/season identify the response");

  await call({ secret: "amenfarms", action: "nfl_scoreboard", week: 2, seasontype: 2, year: 2026 });
  ok(/week=2/.test(upstream.lastUrl) && /seasontype=2/.test(upstream.lastUrl) && /dates=2026/.test(upstream.lastUrl),
    "week/seasontype/year forward to the upstream query");
  await call({ secret: "amenfarms", action: "nfl_scoreboard", week: "x", seasontype: 99, year: 12 });
  ok(!/week=|seasontype=|dates=/.test(upstream.lastUrl), "invalid week params are dropped, not forwarded");

  // game (home team possessing)
  r = await call({ secret: "amenfarms", action: "nfl_game", eventId: "401770001" });
  const g = r.json;
  ok(!!g && g.ok === true && g.id === "401770001" && /Arrowhead/.test(g.venue), "nfl_game returns the slimmed summary");
  ok(!!g && g.situation && g.situation.possessionId === "12" && g.situation.possessionAbbrev === "KC"
    && g.situation.down === 2 && g.situation.distance === 7 && g.situation.yardsToEndzone === 31
    && /Pacheco/.test(g.situation.lastPlay),
    "the live situation is DERIVED from the current drive's last play (summary has no top-level situation)");
  ok(!!g && g.drives.current && g.drives.current.teamAbbrev === "KC" && g.drives.current.startYardsToEndzone === 75
    && g.drives.current.plays.length === 5 && g.drives.current.plays[4].end.yardsToEndzone === 31
    && g.drives.current.plays[0].downDistanceText === "1st & 10",
    "the current drive keeps its start spot and slimmed plays");
  ok(!!g && g.drives.previous.length === 3 && g.drives.previous[0].result === "Punt"
    && g.drives.previous[2].result === "Touchdown" && g.drives.previous[2].scoring === true,
    "previous drives are newest-first with results");
  ok(!!g && g.winprob.length <= 81 && Math.abs(g.winprob[g.winprob.length - 1] - 0.68) < 0.001,
    `win probability is thinned (${g.winprob.length} pts) and keeps the final value`);
  const kcStats = g && g.boxscore.teams.find((t) => t.abbrev === "KC");
  ok(!!kcStats && kcStats.stats.some((s) => s.name === "totalYards" && s.value === "289"),
    "team stats are mapped by name for the stat bars");
  const kcPlayers = g && g.boxscore.players.find((t) => t.abbrev === "KC");
  ok(!!kcPlayers && kcPlayers.groups.some((x) => x.name === "passing" && x.labels[0] === "C/ATT"
    && x.athletes[0].name === "P. Mahomes" && x.athletes[0].stats[1] === "212"),
    "player box-score groups keep labels + stat rows");
  ok(!!g && g.scoringPlays.length === 5 && g.scoringPlays[4].home === 17 && g.scoringPlays[4].team === "KC",
    "scoring plays carry period/clock/text/score");
  const kcTeam = g && g.teams.find((t) => t.abbrev === "KC");
  ok(!!kcTeam && kcTeam.homeAway === "home" && kcTeam.linescores.join(",") === "7,3,7" && kcTeam.score === "17",
    "teams carry linescores for the quarter table");
  ok(!!g && !/pickcenter|odds|"news"|standings/.test(r.text), "no odds/pickcenter/news junk in the game payload");

  // final + pregame shapes
  r = await call({ secret: "amenfarms", action: "nfl_game", eventId: "401770004" });
  ok(!!r.json && r.json.ok && r.json.status.state === "post" && r.json.status.completed === true
    && r.json.situation === null && r.json.drives.current === null
    && r.json.teams.find((t) => t.abbrev === "HOU").winner === true,
    "a final game has no situation/current drive and flags the winner");
  r = await call({ secret: "amenfarms", action: "nfl_game", eventId: "401770003" });
  ok(!!r.json && r.json.ok && r.json.status.state === "pre" && r.json.situation === null
    && r.json.scoringPlays.length === 0 && /U\.S\. Bank/.test(r.json.venue),
    "a pregame summary is ok with venue and empty sections");

  // failure modes
  const callsBefore = upstream.calls;
  r = await call({ secret: "amenfarms", action: "nfl_game", eventId: "DROP TABLE" });
  ok(!!r.json && r.json.ok === false && r.json.reason === "bad-event-id" && upstream.calls === callsBefore,
    "a bad event id is refused before any upstream call");
  upstream.mode = "http500";
  r = await call({ secret: "amenfarms", action: "nfl_scoreboard" });
  ok(!!r.json && r.json.ok === false && r.json.reason === "http-500", "an upstream 500 becomes ok:false http-500");
  upstream.mode = "badjson";
  r = await call({ secret: "amenfarms", action: "nfl_game", eventId: "401770001" });
  ok(!!r.json && r.json.ok === false && r.json.reason === "bad-json", "upstream garbage becomes ok:false bad-json");
  upstream.mode = "drop";
  r = await call({ secret: "amenfarms", action: "nfl_scoreboard" });
  ok(!!r.json && r.json.ok === false && r.json.reason === "unreachable", "a dead upstream becomes ok:false unreachable");
  upstream.mode = "normal";

  // origin behavior
  r = await call({ secret: "amenfarms", action: "nfl_scoreboard" }, { origin: "http://localhost:8080" });
  ok(r.headers.get("access-control-allow-origin") === "http://localhost:8080", "an allowed origin is echoed");
  r = await call({ secret: "amenfarms", action: "nfl_scoreboard" }, { origin: "https://evil.example" });
  ok(r.headers.get("access-control-allow-origin") === "https://amenfarms.netlify.app", "a foreign origin falls back to the site origin");
}

// ---------------- section E: the fantasy actions ----------------
async function sectionFantasy() {
  section("E · ff_* fantasy actions (private league, fake ESPN fantasy upstream)");

  // no cookies configured -> honest reason, no upstream call
  ffAuthNone();
  let calls0 = ffUp.calls;
  let r = await call({ secret: "amenfarms", action: "ff_league" });
  ok(r.json && r.json.ok === false && r.json.reason === "fantasy-not-configured" && ffUp.calls === calls0,
    "with no cookies set, ff_* answers fantasy-not-configured without calling ESPN");

  ffAuthGood();
  r = await call({ secret: "amenfarms", action: "ff_league" });
  const lg = r.json;
  ok(!!lg && lg.ok === true && lg.leagueName === "Kreusser Family League" && lg.teams.length === 4,
    "ff_league returns the league with all 4 teams");
  ok(ffUp.lastCookie.includes("espn_s2=" + GOOD_S2) && ffUp.lastCookie.includes("SWID={" + GOOD_SWID + "}"),
    "the espn_s2 + SWID cookies go upstream, SWID braced even when stored bare");
  ok(!r.text.includes(GOOD_S2), "the cookie value is never echoed to the client");
  ok(new RegExp("/seasons/" + (new Date().getUTCMonth() < 2 ? new Date().getUTCFullYear() - 1 : new Date().getUTCFullYear()) + "/").test(ffUp.lastUrl),
    "the current fantasy season is derived (Jan/Feb still belong to last season)");
  ok(lg.familyTeamId === 1, "the family team resolves by name (\"battle kreussers\" → Battle Kreussers)");
  const bat = lg.teams.find((t) => t.id === 1);
  ok(!!bat && bat.wins === 1 && bat.losses === 0 && bat.pointsFor === 121.4 && bat.owner === "pkreusser",
    "teams carry record/points-for/owner for the standings");
  ok(!/draftDetail|transactions/.test(r.text), "draft/transaction junk never reaches the client");

  await call({ secret: "amenfarms", action: "ff_league", year: 2025 });
  ok(/\/seasons\/2025\//.test(ffUp.lastUrl), "a year override reaches the upstream URL");

  // scoreboard: current week by default, live totals; past week decided
  r = await call({ secret: "amenfarms", action: "ff_scoreboard" });
  const sc = r.json;
  ok(!!sc && sc.ok && sc.week === 2 && sc.matchups.length === 2, "ff_scoreboard defaults to the current matchup week");
  const famM = sc.matchups.find((m) => m.home && m.home.teamId === 1);
  ok(!!famM && famM.home.points === 87.4 && famM.home.live === true && famM.home.proj === 112.6
    && famM.away.points === 76.2 && famM.away.record === "0-1",
    "matchup sides carry live points, projections and records");
  r = await call({ secret: "amenfarms", action: "ff_scoreboard", week: 1 });
  ok(!!r.json && r.json.week === 1 && r.json.matchups.length === 2 && r.json.matchups[0].winner === "HOME"
    && r.json.matchups[0].home.points === 121.4 && r.json.matchups[0].home.live === false,
    "a past week shows decided matchups with final totals");

  // the family matchup with lineups + the pro-game join
  r = await call({ secret: "amenfarms", action: "ff_matchup" });
  const fm = r.json;
  ok(!!fm && fm.ok && fm.week === 2 && fm.anyProLive === true && fm.matchup
    && fm.matchup.home.name === "Battle Kreussers" && fm.matchup.away.name === "Waffle House Warriors",
    "ff_matchup finds the family matchup by default");
  const ros = fm.matchup.home.roster;
  const starters = ros.filter((p) => p.starter);
  ok(starters.length === 9 && ros.length === 11 && starters[0].slot === "QB" && starters[0].name === "Josh Allen"
    && starters[8].slot === "K" && ros[9].slot === "Bench",
    "the lineup sorts QB→K then bench");
  const allen = starters[0];
  ok(allen.proTeam === "BUF" && allen.actual === 22.4 && allen.proj === 21.3
    && allen.game && allen.game.state === "in" && /8:42/.test(allen.game.detail),
    "a live player joins his real NFL game (BUF, in progress, clock)");
  const jj = starters.find((p) => p.name === "Justin Jefferson");
  ok(!!jj && jj.game && jj.game.state === "pre" && jj.injury === "QUESTIONABLE",
    "a yet-to-play player carries kickoff state + injury tag");
  const dst = starters.find((p) => p.slot === "D/ST");
  ok(!!dst && dst.game && dst.game.state === "post", "a finished player's game reads post");
  const conner = fm.matchup.away.roster.find((p) => p.name === "James Conner");
  ok(!!conner && conner.game === null, "a player whose team isn't on the scoreboard (bye) has no game");
  ok(fm.matchup.home.points === 87.4 && fm.matchup.home.proj === 112.6
    && fm.matchup.away.points === 76.2 && fm.matchup.away.proj === 98.1,
    "team totals + projected totals (Σ of starters) are exact");

  r = await call({ secret: "amenfarms", action: "ff_matchup", teamId: 3 });
  ok(!!r.json && r.json.matchup && r.json.matchup.home.teamId === 3 && r.json.matchup.away.teamId === 4,
    "ff_matchup can target another team's matchup");
  r = await call({ secret: "amenfarms", action: "ff_matchup", teamId: 99 });
  ok(!!r.json && r.json.matchup && (r.json.matchup.home.teamId === 1 || r.json.matchup.away.teamId === 1),
    "an unknown teamId falls back to the family team");

  // failure modes
  ffAuthWrong();
  r = await call({ secret: "amenfarms", action: "ff_matchup" });
  ok(!!r.json && r.json.ok === false && r.json.reason === "fantasy-auth-expired",
    "a stale espn_s2 cookie becomes fantasy-auth-expired (ESPN 401)");
  ffAuthGood();
  ffUp.mode = "http500";
  r = await call({ secret: "amenfarms", action: "ff_league" });
  ok(!!r.json && r.json.ok === false && r.json.reason === "http-500", "an upstream 500 becomes ok:false http-500");
  ffUp.mode = "normal";
}

// ---------------- static server ----------------
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
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
  const opts = {
    headless: true,
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  };
  if (exe) opts.executablePath = exe; else opts.channel = "chrome";
  return puppeteer.launch(opts);
}

async function newPage(ctx, o) {
  o = o || {};
  const page = await ctx.newPage();
  await page.setViewport(o.vw || { width: 390, height: 844 });
  await page.evaluateOnNewDocument((user) => {
    try {
      localStorage.setItem("choreUnlocked", "amenfarms");
      if (!localStorage.getItem("choreUser") && user) localStorage.setItem("choreUser", user);
    } catch (e) {}
    // index.html auto-prompts for Dad's PIN on load — a native prompt() wedges
    // headless Chrome (chore-care harness lesson). Stub all three dialogs.
    window.prompt = () => null;
    window.alert = () => {};
    window.confirm = () => true;
  }, o.choreUser === undefined ? "Dad" : o.choreUser);
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
      // Abort external http(s) (fonts, espncdn logos); data:/blob:/same-origin continue —
      // aborting data: URLs wedges index.html's boot (chore-care harness lesson).
      if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) { await req.abort(); return; }
      await req.continue();
    } catch (e) { /* request already handled */ }
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

// ---------------- section B: week list + game detail ----------------
async function sectionWeekGame(browser) {
  section("B · sports.html week list + click-through (390×844)");
  const ctx = await browser.createBrowserContext();
  const page = await newPage(ctx);
  await page.goto(BASE + "/sports.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SPORTS__ && window.__SPORTS__.state().hasSb, { timeout: 20000 });
  await page.waitForSelector(".dayhead.live", { timeout: 10000 });

  const wk = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#wkGroups .card")];
    const liveCard = cards.find((c) => c.querySelector(".dayhead.live"));
    const kcRow = [...document.querySelectorAll(".gbtn")].find((b) => b.dataset.eid === "401770001");
    const finRow = [...document.querySelectorAll(".gbtn")].find((b) => b.dataset.eid === "401770004");
    const preRow = [...document.querySelectorAll(".gbtn")].find((b) => b.dataset.eid === "401770003");
    return {
      cards: cards.length,
      liveFirst: cards[0] === liveCard,
      liveRows: liveCard ? liveCard.querySelectorAll(".gbtn").length : 0,
      totalRows: document.querySelectorAll("#wkGroups .gbtn").length,
      kcClock: kcRow ? (kcRow.querySelector(".clock") || {}).textContent : "",
      kcSitu: kcRow ? (kcRow.querySelector(".situ") || {}).textContent : "",
      kcPoss: kcRow ? [...kcRow.querySelectorAll(".tm")].some((t) => t.classList.contains("poss") && /Chiefs/.test(t.textContent)) : false,
      awayFirst: kcRow ? /Bills/.test(kcRow.querySelector(".tm").textContent) : false,
      finLoserDim: finRow ? [...finRow.querySelectorAll(".tm")].some((t) => t.classList.contains("dim") && /Colts/.test(t.textContent)) : false,
      finDetail: finRow ? finRow.querySelector(".st").textContent : "",
      preHasTime: preRow ? /\d{1,2}:\d{2}/.test(preRow.querySelector(".st").textContent) : false,
      preTV: preRow ? /NBC/.test(preRow.querySelector(".st").textContent) : false,
      title: document.getElementById("wkTitle").textContent,
      dates: document.getElementById("wkDates").textContent,
      updated: document.getElementById("wkUpdated").textContent,
      prevOn: !document.getElementById("wkPrev").disabled,
      nextOn: !document.getElementById("wkNext").disabled,
      cached: !!localStorage.getItem("bucky_nfl_sb"),
      pollIv: window.__SPORTS__.state().pollIv,
    };
  });
  ok(wk.cards >= 3 && wk.liveFirst, `games grouped into ${wk.cards} cards, LIVE NOW pinned first`);
  ok(wk.liveRows === 2 && wk.totalRows === 5, "both live games in LIVE NOW, all 5 games listed");
  ok(/8:42 - 3rd/.test(wk.kcClock), "a live row shows the red clock");
  ok(/2nd & 7/.test(wk.kcSitu), "a live row carries the down & distance situation line");
  ok(wk.kcPoss, "the possession marker sits on the team with the ball");
  ok(wk.awayFirst, "rows list the away team first (BUF @ KC)");
  ok(wk.finLoserDim && /Final/.test(wk.finDetail), "a final dims the loser and says Final");
  ok(wk.preHasTime && wk.preTV, "an upcoming game shows kickoff time + TV");
  ok(wk.title === "Week 1" && wk.dates.length > 3, `the week header reads "${wk.title}" (${wk.dates})`);
  ok(/updated .*↻/.test(wk.updated), "the updated stamp doubles as a refresh button");
  ok(wk.prevOn && wk.nextOn, "week arrows are enabled (calendar has weeks both ways)");
  ok(wk.cached, "the default-week scoreboard is cached for instant paint");
  ok(wk.pollIv === 25000, "with live games the week view polls every 25s");
  await shot(page, "sports_week_390.png");

  // week stepping forwards + back
  await page.click("#wkNext");
  await page.waitForFunction(() => window.__SPORTS__.state().cur.week === 2 && window.__SPORTS__.state().hasSb, { timeout: 8000 });
  await sleep(80);
  ok(/week=2/.test(upstream.lastUrl) && /seasontype=2/.test(upstream.lastUrl) && /dates=2026/.test(upstream.lastUrl),
    "the › arrow requests the next week from the server");
  ok(await page.evaluate(() => document.getElementById("wkTitle").textContent) === "Week 2", "the header follows to Week 2");
  await page.click("#wkPrev");
  await page.waitForFunction(() => window.__SPORTS__.state().cur.week === 1, { timeout: 8000 });
  await page.waitForSelector('.gbtn[data-eid="401770001"]', { timeout: 8000 });

  // click a live game -> detail
  await page.click('.gbtn[data-eid="401770001"]');
  await page.waitForFunction(() => window.__SPORTS__.state().view === "game" && window.__SPORTS__.state().hasGame, { timeout: 8000 });
  const gm = await page.evaluate(() => {
    const svg = document.querySelector(".fieldwrap svg");
    const lines = svg ? [...svg.querySelectorAll("line")] : [];
    const los = lines.find((l) => l.getAttribute("stroke") === "#eaf2ff");
    const fd = lines.find((l) => l.getAttribute("stroke") === "var(--gold)");
    const band = svg ? [...svg.querySelectorAll("rect")].find((r) => r.getAttribute("opacity") === "0.16") : null;
    const ballG = svg ? [...svg.querySelectorAll("g")].find((x) => /^translate\(/.test(x.getAttribute("transform") || "") && x.querySelector("ellipse")) : null;
    const plays = [...document.querySelectorAll(".play")];
    return {
      hidden: document.getElementById("weekView").hidden === true && document.getElementById("gameView").hidden === false,
      chip: document.getElementById("gameChip").textContent,
      venue: document.getElementById("gameMeta").textContent,
      bigs: [...document.querySelectorAll(".scorehead .big")].map((b) => b.textContent),
      linescore: !!document.querySelector("table.line"),
      possdot: !!document.querySelector(".scorehead .possdot"),
      losX: los ? parseFloat(los.getAttribute("x1")) : null,
      fdX: fd ? parseFloat(fd.getAttribute("x1")) : null,
      band: band ? { x: parseFloat(band.getAttribute("x")), w: parseFloat(band.getAttribute("width")) } : null,
      ballX: ballG ? parseFloat(/translate\(([\d.]+)/.exec(ballG.getAttribute("transform"))[1]) : null,
      situDD: (document.querySelector(".situline .dd") || {}).textContent || "",
      situSp: (document.querySelector(".situline .sp") || {}).textContent || "",
      lastplay: (document.querySelector(".lastplay") || {}).textContent || "",
      firstPlay: plays.length ? plays[0].children[1].textContent : "",
      playCount: plays.length,
      drvResults: [...document.querySelectorAll(".drv .res")].map((d) => d.textContent),
      wp: (document.querySelector(".wp .val b") || {}).textContent || "",
      statVals: (document.querySelector(".statbars") || {}).textContent || "",
      boxTables: document.querySelectorAll("table.box").length,
      boxHasQB: /P\. Mahomes/.test(document.getElementById("gameBody").textContent),
      scRows: document.querySelectorAll(".sc").length,
      pollIv: window.__SPORTS__.state().pollIv,
    };
  });
  ok(gm.hidden, "tapping a game swaps to the detail view");
  ok(/LIVE/.test(gm.chip) && /Arrowhead/.test(gm.venue), "the detail header shows LIVE + venue");
  ok(gm.bigs.join(",") === "14,17" && gm.linescore && gm.possdot, "score header: away-first scores, linescore, possession dot");
  // KC (home) possesses at the BUF 31 driving LEFT: ball 31yds from the left goal.
  ok(near(gm.losX, fx(31)), `line of scrimmage lands at the BUF 31 (x=${gm.losX} ≈ ${fx(31).toFixed(1)})`);
  ok(near(gm.fdX, fx(24)), `the gold first-down line is 7 yards on (x=${gm.fdX} ≈ ${fx(24).toFixed(1)})`);
  ok(near(gm.ballX, fx(31)), "the ball marker sits on the line of scrimmage");
  ok(!!gm.band && near(gm.band.x, fx(31), 1) && near(gm.band.w, fx(75) - fx(31), 1.5),
    "the drive band spans the drive start (KC 25) to the ball");
  ok(/2nd & 7/.test(gm.situDD) && /←/.test(gm.situSp), "the situation line reads 2nd & 7, driving ← (home team drives left)");
  ok(/Pacheco/.test(gm.lastplay) && /LAST PLAY/.test(gm.lastplay), "the last play callout is filled");
  ok(gm.playCount === 5 && /tackled by T\. Bernard/.test(gm.firstPlay), "this-drive plays list newest first");
  ok(gm.drvResults.length === 3 && gm.drvResults[0] === "Punt", "previous drives newest-first with results");
  ok(gm.wp === "KC 68%", "the win-probability sparkline names the leader");
  ok(/289/.test(gm.statVals) && /241/.test(gm.statVals), "team stat bars carry both totals");
  ok(gm.boxTables === 6 && gm.boxHasQB, "box score renders 3 groups × 2 teams with player rows");
  ok(gm.scRows === 5, "all 5 scoring plays listed");
  ok(gm.pollIv === 15000, "a live game polls every 15s");
  await shot(page, "sports_game_390.png");

  // hidden tab pauses polling; returning refreshes immediately
  const callsBeforeHide = upstream.calls;
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get() { return window.__hid === true; } });
    window.__hid = true;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  ok(await page.evaluate(() => window.__SPORTS__.state().pollScheduled === false), "hiding the tab stops the poll");
  await page.evaluate(() => { window.__hid = false; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => window.__SPORTS__.state().pollScheduled === true, { timeout: 8000 });
  ok(upstream.calls > callsBeforeHide, "returning to the tab refreshes immediately and re-arms the poll");

  // back to the week
  await page.click("#gameBack");
  await page.waitForFunction(() => window.__SPORTS__.state().view === "week", { timeout: 8000 });
  ok(await page.evaluate(() => !document.getElementById("weekView").hidden && document.querySelectorAll("#wkGroups .gbtn").length === 5),
    "‹ Scores returns to the week list");

  // stale-copy honesty: a failed refresh keeps the scores + shows the note.
  // (Retry-driven: the route's own in-flight loadWeek can make a single explicit
  // call a guarded no-op — poll until a failure actually lands.)
  upstream.mode = "http500";
  await page.waitForFunction(() => {
    window.__SPORTS__.loadWeek();
    return !document.getElementById("wkStale").hidden;
  }, { polling: 250, timeout: 8000 });
  ok(await page.evaluate(() => document.querySelectorAll("#wkGroups .gbtn").length === 5),
    "a failed refresh keeps the last scores and says so");
  upstream.mode = "normal";
  await page.waitForFunction(() => {
    window.__SPORTS__.loadWeek();
    return document.getElementById("wkStale").hidden;
  }, { polling: 250, timeout: 8000 });
  ok(true, "the stale note clears on the next good refresh");

  // deep links: away-possession live game (mirrored field), pregame, final
  await page.evaluate(() => { location.hash = "game=401770002"; });
  await page.waitForFunction(() => window.__SPORTS__.state().gameId === "401770002" && window.__SPORTS__.state().hasGame, { timeout: 8000 });
  const g2 = await page.evaluate(() => {
    const svg = document.querySelector(".fieldwrap svg");
    const lines = svg ? [...svg.querySelectorAll("line")] : [];
    const los = lines.find((l) => l.getAttribute("stroke") === "#eaf2ff");
    const fd = lines.find((l) => l.getAttribute("stroke") === "var(--gold)");
    return {
      losX: los ? parseFloat(los.getAttribute("x1")) : null,
      fdX: fd ? parseFloat(fd.getAttribute("x1")) : null,
      sp: (document.querySelector(".situline .sp") || {}).textContent || "",
    };
  });
  // PHI (away) possesses at the DAL 40 driving RIGHT: pos = 100-40 = 60; 1st & 10 -> 70.
  ok(near(g2.losX, fx(60)), `away possession mirrors the field (LOS x=${g2.losX} ≈ ${fx(60).toFixed(1)})`);
  ok(near(g2.fdX, fx(70)), "the first-down line is 10 yards to the right");
  ok(/→/.test(g2.sp), "the away team drives →");

  await page.evaluate(() => { location.hash = "game=401770003"; });
  await page.waitForFunction(() => window.__SPORTS__.state().gameId === "401770003" && window.__SPORTS__.state().hasGame, { timeout: 8000 });
  const g3 = await page.evaluate(() => ({
    kick: /Kickoff:/.test(document.getElementById("gameBody").textContent),
    field: !!document.querySelector(".fieldwrap"),
    box: document.querySelectorAll("table.box").length,
    pollIv: window.__SPORTS__.state().pollIv,
    chip: document.getElementById("gameChip").textContent,
  }));
  ok(g3.kick && !g3.field && g3.box === 0 && g3.chip === "", "a pregame shows the kickoff card, no field/box score");
  ok(g3.pollIv === 120000, "a pregame polls gently (2 min)");

  await page.evaluate(() => { location.hash = "game=401770004"; });
  await page.waitForFunction(() => window.__SPORTS__.state().gameId === "401770004" && window.__SPORTS__.state().hasGame, { timeout: 8000 });
  const g4 = await page.evaluate(() => ({
    chip: document.getElementById("gameChip").textContent,
    field: !!document.querySelector(".fieldwrap"),
    losing: [...document.querySelectorAll(".scorehead .big")].map((b) => b.className),
    drvLabel: (document.querySelector("#gameBody .seclabel b") || {}).textContent || "",
    polled: window.__SPORTS__.state().pollScheduled,
  }));
  ok(/FINAL/.test(g4.chip) && !g4.field, "a final shows the FINAL chip and no live field");
  ok(g4.losing[0].indexOf("losing") < 0 && g4.losing[1].indexOf("losing") >= 0, "the loser's score is dimmed (HOU 31 beat IND 24)");
  ok(g4.polled === false, "a finished game stops polling entirely");

  // nav on this page
  const nav = await page.evaluate(() => {
    const links = [...document.querySelectorAll("#buckyNav a")];
    return {
      count: links.length,
      active: (links.find((a) => a.classList.contains("active")) || {}).title || "",
      rows: new Set(links.map((a) => Math.round(a.getBoundingClientRect().top))).size,
      clipped: links.filter((a) => { const l = a.querySelector(".blabel"); return l && l.scrollWidth > l.clientWidth + 1; }).length,
    };
  });
  ok(nav.count === 13 && nav.active === "Sports", `the nav shows all 13 areas with Sports active (Dad)`);
  ok(nav.rows === 2 && nav.clipped === 0, "two balanced nav rows, no clipped labels at 390px");

  ok(page._errs.length === 0, "0 page errors on sports.html" + (page._errs.length ? " — " + page._errs[0] : ""));
  await ctx.close();
}

// ---------------- section C: quiet week + error paths ----------------
async function sectionQuietAndErrors(browser) {
  section("C · quiet week cadence + honest failure states");

  upstream.sbVariant = "idle";
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx);
    await page.goto(BASE + "/sports.html", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SPORTS__ && window.__SPORTS__.state().hasSb, { timeout: 20000 });
    const st = await page.evaluate(() => ({
      s: window.__SPORTS__.state(),
      liveGroup: !!document.querySelector(".dayhead.live"),
      rows: document.querySelectorAll("#wkGroups .gbtn").length,
    }));
    ok(st.rows === 2 && !st.liveGroup, "a quiet week lists games with no LIVE group");
    ok(st.s.anyLive === false && st.s.pollIv === 300000, "with nothing live the poll relaxes to 5 min");
    ok(page._errs.length === 0, "0 page errors on the quiet week");
    await ctx.close();
  }
  upstream.sbVariant = "live";

  // Total failure on a fresh device: honest error card + working retry.
  upstream.mode = "http500";
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx);
    await page.goto(BASE + "/sports.html", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".errcard", { timeout: 20000 });
    ok(await page.evaluate(() => /Couldn’t load NFL scores/.test(document.querySelector(".errcard").textContent)),
      "a fresh device with the API down gets an honest error card");
    upstream.mode = "normal";
    await page.click("#wkRetry");
    await page.waitForFunction(() => window.__SPORTS__ && window.__SPORTS__.state().hasSb, { timeout: 20000 });
    ok(await page.evaluate(() => document.querySelectorAll("#wkGroups .gbtn").length === 5), "Try again recovers to the full week");

    // Game detail failure (bad id upstream 404 -> bad shape)
    upstream.mode = "http500";
    await page.evaluate(() => { location.hash = "game=999999999"; });
    await page.waitForFunction(() => !!document.querySelector("#gameBody .errcard"), { timeout: 20000 });
    ok(true, "a game that can't load gets its own error card");
    upstream.mode = "normal";
    await page.click("#gmRetry");
    await sleep(300);   // 999999999 has no fixture: stays failed but the card re-renders
    ok(await page.evaluate(() => !!document.querySelector("#gameBody .errcard") || !!document.querySelector("#gameBody .loadrow")),
      "retry re-attempts without crashing on an unknown game");
    ok(page._errs.length === 0, "0 page errors through the failure paths");
    await ctx.close();
  }
}

// ---------------- section F: the fantasy view ----------------
async function sectionFantasyUI(browser) {
  section("F · the Fantasy view (390×844)");
  ffAuthGood();
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx);
    await page.goto(BASE + "/sports.html#fantasy", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SPORTS__ && window.__SPORTS__.state().hasFf, { timeout: 20000 });
    await page.waitForFunction(() => window.__SPORTS__.state().hasFfLg, { timeout: 20000 });
    const ff = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".ffrow")];
      const firstRow = rows[0];
      const standRows = [...document.querySelectorAll("table.stand tr")].slice(1);
      const jj = rows.map((r) => r.textContent).find((t) => /Justin Jefferson/.test(t)) || "";
      return {
        view: window.__SPORTS__.state().view,
        pillOn: document.getElementById("pillFf").classList.contains("on"),
        league: (document.querySelector(".ffleague") || {}).textContent || "",
        week: (document.querySelector(".ffweek") || {}).textContent || "",
        famNames: [...document.querySelectorAll(".fftm")].slice(0, 2).map((t) => t.textContent),
        famPts: [...document.querySelectorAll(".fftm .pts")].slice(0, 2).map((t) => t.textContent),
        rowCount: rows.length,
        firstSlot: firstRow ? firstRow.querySelector(".slot").textContent : "",
        firstText: firstRow ? firstRow.textContent : "",
        benchHead: rows.some((r) => r.classList.contains("benchhead")),
        liveDots: document.querySelectorAll(".gdot.in").length,
        projStyled: document.querySelectorAll(".ffp .nm b.projpts").length,
        jjHasInjury: /Q/.test(jj) && /proj 16\.4/.test(jj),
        others: (document.querySelectorAll(".card") .length && [...document.querySelectorAll(".card")].some((c) => /Around the league/.test(c.textContent) && /Draft Punks/.test(c.textContent))),
        standCount: standRows.length,
        standFirst: standRows.length ? standRows[0].textContent : "",
        famBold: !!document.querySelector("table.stand td.fam"),
        pollIv: window.__SPORTS__.state().pollIv,
      };
    });
    ok(ff.view === "ff" && ff.pillOn, "#fantasy deep-links straight into the Fantasy view");
    ok(ff.league === "Kreusser Family League" && /Week 2/.test(ff.week), "the league name + week head the page");
    ok(/Battle Kreussers/.test(ff.famNames[0]) && /Waffle House Warriors/.test(ff.famNames[1]),
      "the family matchup is pinned first, family side on top");
    ok(ff.famPts[0] === "87.4" && ff.famPts[1] === "76.2", "live matchup totals are the big numbers");
    ok(ff.rowCount === 12 && ff.firstSlot === "QB" && /Josh Allen/.test(ff.firstText) && /22\.4/.test(ff.firstText),
      "lineups render slot by slot — QB first with live points");
    ok(ff.benchHead, "the bench sits under its own divider");
    ok(ff.liveDots >= 5, `in-play players carry live dots (${ff.liveDots})`);
    ok(ff.projStyled >= 3 && ff.jjHasInjury, "yet-to-play players show muted projections (+ injury tag on Jefferson)");
    ok(ff.others, "the rest of the league's matchups render");
    ok(ff.standCount === 4 && /Battle Kreussers/.test(ff.standFirst) && ff.famBold,
      "standings sort wins→points-for with the family row bold");
    ok(ff.pollIv === 60000, "with NFL games live, fantasy polls every 60s");
    await shot(page, "sports_ff_390.png");

    // pill back to NFL
    await page.click("#pillNfl");
    await page.waitForFunction(() => window.__SPORTS__.state().view === "week" && window.__SPORTS__.state().hasSb, { timeout: 20000 });
    ok(await page.evaluate(() => !document.getElementById("weekView").hidden && document.getElementById("pillNfl").classList.contains("on")),
      "the NFL pill switches back to the week list");
    await page.click("#pillFf");
    await page.waitForFunction(() => window.__SPORTS__.state().view === "ff", { timeout: 20000 });
    ok(true, "…and the Fantasy pill returns");
    ok(page._errs.length === 0, "0 page errors on the fantasy view");
    await ctx.close();
  }

  // Not configured: an honest setup card for Dad, nothing scary.
  ffAuthNone();
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx);
    await page.goto(BASE + "/sports.html#fantasy", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SPORTS__ && window.__SPORTS__.state().ffState === "fantasy-not-configured", { timeout: 20000 });
    const t = await page.evaluate(() => document.getElementById("ffBody").textContent);
    ok(/one-time setup by Dad/.test(t) && /ESPN_S2/.test(t) && /ESPN_SWID/.test(t) && /705063/.test(t),
      "an unconfigured league walks Dad through the cookie setup");
    ok(await page.evaluate(() => window.__SPORTS__.state().pollScheduled === false),
      "an unconfigured fantasy view doesn't poll");
    ok(page._errs.length === 0, "0 page errors on the setup card");
    await ctx.close();
  }

  // Expired cookie: names the fix.
  ffAuthWrong();
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx);
    await page.goto(BASE + "/sports.html#fantasy", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SPORTS__ && window.__SPORTS__.state().ffState === "fantasy-auth-expired", { timeout: 20000 });
    ok(await page.evaluate(() => /signed us out/.test(document.getElementById("ffBody").textContent)
      && /ESPN_S2/.test(document.getElementById("ffBody").textContent)),
      "an expired cookie names the exact fix");
    ok(page._errs.length === 0, "0 page errors on the expired card");
    await ctx.close();
  }
  ffAuthGood();
}

// ---------------- section D: desktop + index.html nav ----------------
async function sectionDesktopIndex(browser) {
  section("D · desktop rail + the Sports area on index.html");
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx, { vw: { width: 1280, height: 900 } });
    await page.goto(BASE + "/sports.html", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SPORTS__ && window.__SPORTS__.state().hasSb, { timeout: 20000 });
    const d = await page.evaluate(() => ({
      rail: getComputedStyle(document.getElementById("sidenav")).display !== "none",
      railItems: document.querySelectorAll("#sidenav .sn-item").length,
      railActive: (document.querySelector("#sidenav .sn-item.active .sn-label") || {}).textContent || "",
      bnavGone: document.getElementById("buckyNav").getBoundingClientRect().height === 0
        || getComputedStyle(document.getElementById("buckyNav")).display === "none",
    }));
    ok(d.rail && d.railItems === 13 && d.railActive === "Sports", "the desktop rail lists 13 areas with Sports active");
    ok(d.bnavGone, "the bottom nav is gone on desktop");
    await shot(page, "sports_desktop.png");
    ok(page._errs.length === 0, "0 page errors on desktop");
    await ctx.close();
  }
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx);
    await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#bnav .bnav-btn", { timeout: 20000 });
    await sleep(400);
    const n = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("#bnav .bnav-btn")];
      const sports = btns.find((b) => b.dataset.gid === "sports");
      return {
        count: btns.length,
        hasSports: !!sports,
        rows: new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top))).size,
        clipped: btns.filter((b) => { const l = b.querySelector(".blabel"); return l && l.scrollWidth > l.clientWidth + 1; }).length,
      };
    });
    ok(n.hasSports && n.count === 13, "index.html's bottom nav gained the Sports area (13 for Dad)");
    ok(n.rows === 2 && n.clipped === 0, "index.html still lays out two clean rows, no clipped labels");
    const navigated = await page.evaluate(() => new Promise((res) => {
      const b = [...document.querySelectorAll("#bnav .bnav-btn")].find((x) => x.dataset.gid === "sports");
      const orig = location.href;
      b.click();
      setTimeout(() => res(location.href !== orig ? location.pathname : ""), 400);
    })).catch(() => "");
    // click() triggers a real navigation — confirm it landed on sports.html
    await sleep(300);
    const where = await page.evaluate(() => location.pathname).catch(() => "");
    ok(where.endsWith("/sports.html") || String(navigated).endsWith("sports.html"),
      "tapping Sports on index.html lands on sports.html");
    ok(page._errs.length === 0, "0 page errors on index.html (Firebase blocked)" + (page._errs.length ? " — " + page._errs[0] : ""));
    await ctx.close();
  }
}

// ---------------- run ----------------
(async () => {
  const up = await startUpstream();
  const ffSrv = await startFfUpstream();
  await initHandler();
  try {
    await sectionA();
    await sectionFantasy();
  } catch (e) {
    fail++; failures.push("server sections crashed: " + e.message);
    console.log("\n✗ SERVER SECTION ERROR: " + (e && e.stack || e));
  }

  const srv = await startStatic();
  const browser = await launchBrowser();
  try {
    await sectionWeekGame(browser);
    await sectionQuietAndErrors(browser);
    await sectionFantasyUI(browser);
    await sectionDesktopIndex(browser);
  } catch (e) {
    fail++; failures.push("suite crashed: " + e.message);
    console.log("\n✗ SUITE ERROR: " + (e && e.stack || e));
  } finally {
    await browser.close();
    srv.close(); up.close(); ffSrv.close();
  }

  console.log("\n" + "=".repeat(52));
  console.log(`SPORTS: ${pass}/${pass + fail} checks passed`);
  if (fail) { console.log("\nFailures:"); for (const f of failures) console.log("  ✗ " + f); }
  process.exit(fail ? 1 : 0);
})();
