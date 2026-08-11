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
const upstream = { mode: "normal", sbVariant: "live", lastUrl: "", lastUA: "", calls: 0 };
function startUpstream() {
  const srv = http.createServer((req, res) => {
    upstream.calls++;
    upstream.lastUrl = req.url;
    upstream.lastUA = req.headers["user-agent"] || "";
    if (upstream.mode === "http500") { res.writeHead(500); res.end("nope"); return; }
    if (upstream.mode === "badjson") { res.writeHead(200, { "Content-Type": "application/json" }); res.end("{oops"); return; }
    if (upstream.mode === "drop") { req.socket.destroy(); return; }
    const u = new URL(req.url, "http://x");
    const college = u.pathname.includes("/college-football/");
    if (u.pathname.endsWith("/scoreboard")) {
      const data = college
        ? FIX.cfbScoreboard(u.searchParams.get("groups"))
        : (upstream.sbVariant === "idle" ? FIX.scoreboardIdle() : FIX.scoreboardLive());
      // Preseason reality (measured live 2026-08-05): every curatedRank is 99.
      if (college && upstream.cfbUnranked) {
        data.events.forEach((ev) => ev.competitions[0].competitors.forEach((c) => { c.curatedRank = { current: 99 }; }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      return;
    }
    if (u.pathname.endsWith("/summary")) {
      const id = u.searchParams.get("event");
      const f = college ? FIX.CFB_SUMMARIES[id] : FIX.SUMMARIES[id];
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
const ffUp = { mode: "normal", lastUrl: "", lastCookie: "", lastFilter: "", calls: 0 };
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
    // The free-agent pool is its own view, filtered through the X-Fantasy-Filter HEADER.
    if (req.url.includes("view=kona_player_info")) {
      ffUp.lastFilter = req.headers["x-fantasy-filter"] || "";
      res.end(JSON.stringify(FIX.ffFreeAgentsDoc()));
      return;
    }
    // S10: percent-owned by id. A DIFFERENT view (kona_playercard) — kona_player_info 400s on
    // a filterIds filter — and the fixture answers only the ids the filter actually asked for,
    // so "an id ESPN doesn't know is absent from the answer" is the fixture's own behaviour
    // rather than something the test asserts about itself.
    if (req.url.includes("view=kona_playercard")) {
      ffUp.lastFilter = req.headers["x-fantasy-filter"] || "";
      let ids = [];
      try { ids = (JSON.parse(ffUp.lastFilter).players.filterIds.value || []).map(Number); } catch (e) {}
      ffUp.lastIds = ids;
      res.end(JSON.stringify(FIX.ffPctOwnedDoc(ids)));
      return;
    }
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
  ok(!!sb && sb.events.find((e) => e.id === "401770003").spread === "MIN -2.5"
    && !/provider|ESPN BET|overUnder/.test(r.text),
    "the betting line survives as a display string only — provider/prices never leak");
  ok(r.text.length < rawSb.length / 2, `the slimmed scoreboard is under half the raw payload (${r.text.length} vs ${rawSb.length} bytes)`);
  ok(!!sb && sb.calendar.length === 2 && sb.calendar[1].label === "Regular Season"
    && sb.calendar[1].weeks.length === 3 && sb.calendar[1].weeks[0].label === "Week 1",
    "the season calendar is flattened for the week picker");
  ok(!!sb && sb.week === 1 && sb.season.year === 2026 && sb.season.type === 2, "week/season identify the response");
  // ESPN's edge 403s browser UAs from datacenter IPs but allows curl (measured
  // live 2026-08-05, twice) — the NFL upstream MUST identify as curl.
  ok(/^curl\//.test(upstream.lastUA), `the NFL upstream request identifies as curl (${upstream.lastUA})`);

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
  ok(r.json.spread === "MIN -2.5" && !/pickcenter|provider/.test(r.text),
    "the pregame detail carries the line from pickcenter, as a string only");

  // college football: the same slimmer, plus AP ranks + the conference groups param
  r = await call({ secret: "amenfarms", action: "ncaa_scoreboard" });
  const cfb = r.json;
  ok(!!cfb && cfb.ok === true && cfb.events.length === 4 && !/groups=/.test(upstream.lastUrl)
    && /college-football\/scoreboard/.test(upstream.lastUrl),
    "ncaa_scoreboard fetches the college endpoint's default full slate (no groups param)");
  {
    const uga = cfb.events.find((e) => e.id === "401820001").teams.find((t) => t.abbrev === "UGA");
    const wyo = cfb.events.find((e) => e.id === "401820003").teams.find((t) => t.abbrev === "WYO");
    ok(uga.rank === 1 && wyo.rank === null, "AP ranks slim to 1-25; unranked (curatedRank 99) reads null");
    const nflKc = sb.events.find((e) => e.id === "401770001").teams.find((t) => t.abbrev === "KC");
    ok(nflKc.rank === null, "NFL teams (no curatedRank) carry rank null, never a junk value");
  }
  r = await call({ secret: "amenfarms", action: "ncaa_scoreboard", group: 8 });
  ok(/groups=8/.test(upstream.lastUrl) && r.json.events.length === 2
    && r.json.events.every((e) => ["UGA @ ALA", "VAN @ UK"].includes(e.shortName)),
    "a conference group forwards as groups= and narrows to the SEC slate");
  await call({ secret: "amenfarms", action: "nfl_scoreboard", group: 8 });
  ok(!/groups=/.test(upstream.lastUrl), "the NFL scoreboard NEVER forwards a groups param");
  await call({ secret: "amenfarms", action: "ncaa_scoreboard", group: 12345 });
  ok(!/groups=/.test(upstream.lastUrl), "an out-of-range group id is dropped, not forwarded");
  r = await call({ secret: "amenfarms", action: "ncaa_game", eventId: "401820004" });
  ok(!!r.json && r.json.ok && r.json.status.state === "post" && /Kroger/.test(r.json.venue)
    && r.json.teams.find((t) => t.abbrev === "VAN").winner === true
    && r.json.teams.find((t) => t.abbrev === "UK").linescores.join(",") === "7,3,3,7",
    "ncaa_game slims a college summary through the same game code");

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
  r = await call({ secret: "amenfarms", action: "ff_pct_owned", ids: [3915511] });
  ok(r.json && r.json.ok === false && r.json.reason === "fantasy-not-configured" && ffUp.calls === calls0,
    "…ff_pct_owned included (S10) — the drop card's OWN column simply reads \"—\"");

  ffAuthGood();
  r = await call({ secret: "amenfarms", action: "ff_league" });
  const lg = r.json;
  ok(!!lg && lg.ok === true && lg.leagueName === "Nerd Fantasy Football League" && lg.teams.length === 8,
    "ff_league returns the league with all 8 teams");
  ok(ffUp.lastCookie.includes("espn_s2=" + GOOD_S2) && ffUp.lastCookie.includes("SWID={" + GOOD_SWID + "}"),
    "the espn_s2 + SWID cookies go upstream, SWID braced even when stored bare");
  ok(!r.text.includes(GOOD_S2), "the cookie value is never echoed to the client");
  ok(new RegExp("/seasons/" + (new Date().getUTCMonth() < 2 ? new Date().getUTCFullYear() - 1 : new Date().getUTCFullYear()) + "/").test(ffUp.lastUrl),
    "the current fantasy season is derived (Jan/Feb still belong to last season)");
  ok(lg.familyTeamId === 1, "the family team resolves by name (\"battle kreussers\" → Battle Kreussers)");
  const bat = lg.teams.find((t) => t.id === 1);
  ok(!!bat && bat.wins === 1 && bat.losses === 0 && bat.pointsFor === 121.4 && bat.owner === "KreusserFTW",
    "teams carry record/points-for/owner for the standings");
  ok(!/draftDetail|transactions/.test(r.text), "draft/transaction junk never reaches the client");

  // per-user teams: the client names who it follows, the server resolves it
  r = await call({ secret: "amenfarms", action: "ff_league", teamName: "The Goat Kids" });
  ok(r.json.familyTeamId === 3, "teamName \"The Goat Kids\" resolves Isaac's team (id 3)");
  r = await call({ secret: "amenfarms", action: "ff_league", teamName: "wyoming COWBOYS" });
  ok(r.json.familyTeamId === 5, "teamName matching is case-insensitive (Wyoming Cowboys → id 5)");
  r = await call({ secret: "amenfarms", action: "ff_league", teamName: "End Zone Goats" });
  ok(r.json.familyTeamId === 4, "an exact name beats the near-name trap (End Zone Goats ≠ The Goat Kids)");
  r = await call({ secret: "amenfarms", action: "ff_league", teamName: "Nails for Breakfast" });
  ok(r.json.familyTeamId === 7,
    "whitespace normalizes: \"Nails for Breakfast\" matches the league's literal \"Nails  For Breakfast\" (the live double-space)");
  r = await call({ secret: "amenfarms", action: "ff_league", teamName: "No Such Team" });
  ok(r.json.familyTeamId === 1, "an unknown teamName falls back to the default family team");

  await call({ secret: "amenfarms", action: "ff_league", year: 2025 });
  ok(/\/seasons\/2025\//.test(ffUp.lastUrl), "a year override reaches the upstream URL");

  // scoreboard: current week by default, EVERY matchup, live totals; past week decided
  r = await call({ secret: "amenfarms", action: "ff_scoreboard" });
  const sc = r.json;
  ok(!!sc && sc.ok && sc.week === 2 && sc.matchups.length === 4,
    "ff_scoreboard defaults to the current matchup week with all 4 matchups (8 teams)");
  const famM = sc.matchups.find((m) => m.home && m.home.teamId === 1);
  ok(!!famM && famM.home.points === 87.4 && famM.home.live === true && famM.home.proj === 112.6
    && famM.away.points === 76.2 && famM.away.record === "0-1",
    "matchup sides carry live points, projections and records");
  const goatM = sc.matchups.find((m) => m.home && m.home.teamId === 3);
  ok(!!goatM && goatM.home.name === "The Goat Kids" && goatM.away.name === "Draft Punks"
    && goatM.home.points === 65 && goatM.away.points === 55.1,
    "the other matchups carry their own live totals (Goat Kids vs Draft Punks)");
  r = await call({ secret: "amenfarms", action: "ff_scoreboard", week: 1 });
  ok(!!r.json && r.json.week === 1 && r.json.matchups.length === 4 && r.json.matchups[0].winner === "HOME"
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
  ok(!!r.json && r.json.matchup && r.json.matchup.home.teamId === 3 && r.json.matchup.away.teamId === 6
    && r.json.familyTeamId === 3 && r.json.matchup.home.roster.length > 0,
    "ff_matchup can target ANY matchup by teamId (the scoreboard's click-through)");
  r = await call({ secret: "amenfarms", action: "ff_matchup", teamName: "Wyoming Cowboys" });
  ok(!!r.json && r.json.matchup && r.json.matchup.home.name === "Wyoming Cowboys"
    && r.json.matchup.away.name === "Hay Bale Hail Marys",
    "with no teamId, teamName picks whose matchup is \"mine\" (Grandpa)");
  r = await call({ secret: "amenfarms", action: "ff_matchup", teamId: 99 });
  ok(!!r.json && r.json.matchup && (r.json.matchup.home.teamId === 1 || r.json.matchup.away.teamId === 1),
    "an unknown teamId falls back to the family team");

  // free agents (the waiver-advice AI's payload): X-Fantasy-Filter header + slim shape
  r = await call({ secret: "amenfarms", action: "ff_freeagents" });
  const fa = r.json;
  ok(!!fa && fa.ok === true && fa.scoringPeriodId === 2 && Array.isArray(fa.players) && fa.players.length === 7,
    "ff_freeagents returns the filtered player pool");
  ok(/view=kona_player_info/.test(ffUp.lastUrl), "…through the kona_player_info view");
  let filt = null; try { filt = JSON.parse(ffUp.lastFilter); } catch (e) {}
  ok(!!filt && filt.players && filt.players.filterStatus.value.join(",") === "FREEAGENT,WAIVERS"
    && filt.players.sortPercOwned && filt.players.sortPercOwned.sortAsc === false && filt.players.limit === 75,
    "the X-Fantasy-Filter HEADER carries the FA/waivers filter, sorted by percent-owned, capped 75");
  const spears = fa.players[0];
  ok(spears.name === "Tyjae Spears" && spears.pos === "RB" && spears.proTeam === "TEN"
    && spears.pctOwned === 61.2 && spears.proj === 11.8 && spears.seasonProj === 152.4,
    "each player slims to {name,pos,proTeam,pctOwned,proj,seasonProj} with the pro-team abbrev resolved");
  const mims = fa.players.find((p) => /Mims/.test(p.name));
  ok(!!mims && mims.injury === "QUESTIONABLE" && spears.injury === "",
    "injuries tag through; ACTIVE reads as no tag");
  ok(!/seasonOutlook|draftRanksByRankType|ownership/.test(r.text), "player-card junk never reaches the client");

  // S10 (2026-08-11): ff_pct_owned — the GFFL drop/swap card's percent-owned column. One
  // batched call, ownership ONLY, and every failure mode the card degrades on.
  r = await call({ secret: "amenfarms", action: "ff_pct_owned", ids: [3915511, 4241457, 999999] });
  const po = r.json;
  ok(!!po && po.ok === true && po.own && po.own["3915511"] === 61.2 && po.own["4241457"] === 8.4,
    "ff_pct_owned returns one percentage per known id");
  ok(!!po && !("999999" in po.own), "…and an id ESPN doesn't know is ABSENT, never a fabricated 0");
  ok(/view=kona_playercard/.test(ffUp.lastUrl),
    "…through the kona_playerCARD view — kona_player_info 400s on a filterIds filter (measured live 2026-08-06)");
  let pf = null; try { pf = JSON.parse(ffUp.lastFilter); } catch (e) {}
  ok(!!pf && pf.players && Array.isArray(pf.players.filterIds.value) && pf.players.filterIds.value.length === 3
     && pf.players.limit === 40,
    "…with the ids in the X-Fantasy-Filter HEADER's filterIds, capped at 40");
  ok(!/seasonOutlook|draftRanksByRankType|appliedTotal|averageDraftPosition/.test(r.text),
    "…and NOTHING but ownership comes back — no stat lines, no outlook, no draft rank, no ADP");
  r = await call({ secret: "amenfarms", action: "ff_pct_owned", ids: [3915511, 3915511, "3915511", "slp_9201", "dst_KC", 0, -4, null, 1.5] });
  ok(!!r.json && r.json.ok === true && ffUp.lastIds.length === 1 && ffUp.lastIds[0] === 3915511,
    "ids are deduped and validated as positive integers — a slp_/dst_ key, a zero, a negative and a fraction are all dropped ("
    + JSON.stringify(ffUp.lastIds) + ")");
  {
    const calls0 = ffUp.calls;
    r = await call({ secret: "amenfarms", action: "ff_pct_owned", ids: [] });
    ok(!!r.json && r.json.ok === true && Object.keys(r.json.own).length === 0 && ffUp.calls === calls0,
      "nothing to ask about is answered ok with an empty map, and ESPN is never called");
    r = await call({ secret: "amenfarms", action: "ff_pct_owned" });
    ok(!!r.json && r.json.ok === true, "…as is a request with no ids field at all");
    const many = await call({ secret: "amenfarms", action: "ff_pct_owned", ids: Array.from({ length: 90 }, (_, i) => 5000 + i) });
    ok(many.json.ok === true && ffUp.lastIds.length === 40, "a 90-id request is capped at 40 (" + ffUp.lastIds.length + ")");
  }

  // failure modes
  ffAuthWrong();
  r = await call({ secret: "amenfarms", action: "ff_matchup" });
  ok(!!r.json && r.json.ok === false && r.json.reason === "fantasy-auth-expired",
    "a stale espn_s2 cookie becomes fantasy-auth-expired (ESPN 401)");
  r = await call({ secret: "amenfarms", action: "ff_freeagents" });
  ok(!!r.json && r.json.ok === false && r.json.reason === "fantasy-auth-expired",
    "ff_freeagents rides the same cookie gate");
  r = await call({ secret: "amenfarms", action: "ff_pct_owned", ids: [3915511] });
  ok(!!r.json && r.json.ok === false && r.json.reason === "fantasy-auth-expired",
    "…and so does ff_pct_owned — the card's column reads \"—\" rather than breaking");
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

// ---------------- fake farmgpt (the fantasy AI + weekly column) ----------------
// sports.html POSTs /.netlify/functions/farmgpt for Grok advice (mode "fantasy") and
// the Nerd Report column (mode "ffrecap"). The mock answers with canned text and
// records every call NODE-SIDE so "one recap generation per week" is countable.
const gpt = { calls: [] };
const GPT_ADVICE = "**Bottom line:** start De'Von Achane over Justin Jefferson.\n\n- Jefferson is Questionable and Achane projects 13.1.\n- Everyone else checks out.";
const GPT_COLUMN = "**Week 1: the Kreussers strike first.** Battle Kreussers rolled End Zone Goats 121.4-87.9 while The Goat Kids stunned the Waffle House Warriors.";

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
    // farmgpt.html (embedded in the AI tab) references CDN globals at script top
    // level; with external hosts aborted the whole script would die unstubbed
    // (storyledger harness lesson). Harmless on every other page.
    window.marked = { parse: (s) => s, setOptions: () => {} };
    window.DOMPurify = { sanitize: (s) => s };
    window.renderMathInElement = () => {};
  }, o.choreUser === undefined ? "Dad" : o.choreUser);
  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    const u = req.url();
    try {
      if (u.includes("/.netlify/functions/sports")) {
        if (o.sportsEmpty) {
          // Simulates the OTHER suites' blanket "/.netlify/ -> 200 {}" mocks — the
          // home cards must treat that as nothing-to-show, never an error.
          await req.respond({ status: 200, contentType: "application/json", body: "{}" });
          return;
        }
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
      if (u.includes("/.netlify/functions/farmgpt")) {
        let body = {}; try { body = JSON.parse(req.postData() || "{}"); } catch (e) {}
        gpt.calls.push(body);
        if (o.gptDown) { await req.respond({ status: 502, contentType: "application/json", body: '{"error":"down"}' }); return; }
        const text = body.mode === "ffrecap" ? GPT_COLUMN : GPT_ADVICE;
        await req.respond({ status: 200, contentType: "text/plain; charset=utf-8", body: text });
        return;
      }
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

  // Records next to names + the betting line on upcoming rows.
  const extras = await page.evaluate(() => {
    const kcRow = [...document.querySelectorAll(".gbtn")].find((b) => b.dataset.eid === "401770001");
    const gbRow = [...document.querySelectorAll(".gbtn")].find((b) => b.dataset.eid === "401770003");
    return {
      recs: kcRow ? kcRow.querySelectorAll(".tn .trec").length : 0,
      recText: kcRow ? (kcRow.querySelector(".tn .trec") || {}).textContent : "",
      preSitu: gbRow ? (gbRow.querySelector(".situ") || {}).textContent || "" : "",
      liveSpreadless: kcRow ? !/-3\.5/.test((kcRow.querySelector(".situ") || {}).textContent || "") : false,
    };
  });
  ok(extras.recs === 2 && extras.recText === "0-0", "team records sit next to the names");
  ok(/MIN -2\.5/.test(extras.preSitu), "an upcoming row shows the spread");
  ok(extras.liveSpreadless, "a live row shows the situation, not the stale pregame line");

  // My fantasy starters badge each NFL game (loads in the background from ff_matchup).
  await page.waitForFunction(() => !!window.__SPORTS__.state().ffMine, { timeout: 20000 });
  const badges = await page.evaluate(() => {
    const get = (id) => {
      const b = [...document.querySelectorAll(".gbtn")].find((x) => x.dataset.eid === id);
      const f = b && b.querySelector(".ffct");
      return f ? f.textContent : "";
    };
    return { kc: get("401770001"), gb: get("401770003"), fin: get("401770004") };
  });
  ok(/🏆 5 of yours/.test(badges.kc), "the featured game counts my 5 starters (BUF 2 + KC 3)");
  ok(/🏆 1 of yours/.test(badges.gb) && /MIN -2\.5/.test(extras.preSitu),
    "an upcoming row carries both the spread and my starter count");
  ok(/🏆 1 of yours/.test(badges.fin), "a final still notes my starters who played");
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

// ---------------- section H: the College (NCAA FB) view ----------------
async function sectionCollege(browser) {
  section("H · the College view (390×844)");
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx);
    await page.goto(BASE + "/sports.html", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SPORTS__ && window.__SPORTS__.state().hasSb, { timeout: 20000 });
    await page.click("#pillCfb");
    await page.waitForFunction(() => window.__SPORTS__.state().view === "cfb" && window.__SPORTS__.state().hasCfb, { timeout: 20000 });
    const c = await page.evaluate(() => ({
      hash: location.hash,
      pillOn: document.getElementById("pillCfb").classList.contains("on"),
      swapped: !document.getElementById("cfbView").hidden && document.getElementById("weekView").hidden,
      group: document.getElementById("cfbGroup").value,
      title: document.getElementById("cfbTitle").textContent,
      rows: [...document.querySelectorAll("#cfbGroups .gbtn")].map((b) => b.dataset.eid),
      sports: [...document.querySelectorAll("#cfbGroups .gbtn")].map((b) => b.dataset.sport),
      liveFirst: !!document.querySelector("#cfbGroups .card .dayhead.live"),
      ranks: [...document.querySelectorAll("#cfbGroups .rk")].map((r) => r.textContent),
      situ: (document.querySelector("#cfbGroups .situ") || {}).textContent || "",
      pollIv: window.__SPORTS__.state().pollIv,
      nflCurUntouched: window.__SPORTS__.state().cur.week === null,
    }));
    ok(c.hash === "#college" && c.pillOn && c.swapped, "the College pill routes to #college and swaps views");
    ok(c.group === "top25" && c.rows.length === 2 && c.rows.includes("401820001") && c.rows.includes("401820002"),
      "Top 25 (the default) is a client-side cut — 2 ranked games of the 4-game slate");
    ok(c.sports.every((s) => s === "ncaa"), "college rows are tagged ncaa for the click-through");
    ok(c.liveFirst && /1st & 10/.test(c.situ), "the live UGA game pins LIVE NOW first with its situation line");
    ok(c.ranks.includes("#1") && c.ranks.includes("#4") && c.ranks.includes("#2") && c.ranks.includes("#12"),
      "AP ranks render beside the ranked teams");
    ok(c.title === "Week 1", "the college week header reads its own calendar");
    ok(c.pollIv === 25000, "a live college slate polls every 25s");
    ok(c.nflCurUntouched, "the NFL week picker is untouched by the college view");
    await shot(page, "sports_cfb_390.png");

    // conference dropdown → the SEC narrows via the server
    await page.select("#cfbGroup", "8");
    await page.waitForFunction(() => {
      const s = window.__SPORTS__.state();
      return s.cfbGroup === "8" && s.hasCfb && s.cfbEvents === 2;
    }, { timeout: 20000 });
    const sec = await page.evaluate(() => ({
      persisted: localStorage.getItem("bucky_cfb_group"),
      names: document.getElementById("cfbGroups").textContent,
      rows: document.querySelectorAll("#cfbGroups .gbtn").length,
    }));
    ok(/groups=8/.test(upstream.lastUrl), "picking the SEC refetches with groups=8");
    ok(sec.rows === 2 && /Vanderbilt/.test(sec.names) && /Kentucky/.test(sec.names) && !/Ohio State/.test(sec.names),
      "the SEC slate keeps VAN @ UK (unranked!) and drops OSU @ MICH");
    ok(sec.persisted === "8", "the filter choice persists per device");

    // All FBS
    await page.select("#cfbGroup", "80");
    await page.waitForFunction(() => window.__SPORTS__.state().cfbGroup === "80"
      && document.querySelectorAll("#cfbGroups .gbtn").length === 4, { timeout: 20000 });
    ok(/groups=80/.test(upstream.lastUrl), "All FBS refetches with groups=80 and lists the whole slate");

    // click a college game → detail through ncaa_game
    await page.click('.gbtn[data-eid="401820004"]');
    await page.waitForFunction(() => window.__SPORTS__.state().view === "game" && window.__SPORTS__.state().hasGame, { timeout: 20000 });
    const g = await page.evaluate(() => ({
      hash: location.hash, sport: window.__SPORTS__.state().gameSport,
      chip: document.getElementById("gameChip").textContent,
      venue: document.getElementById("gameMeta").textContent,
      bigs: [...document.querySelectorAll(".scorehead .big")].map((b) => b.textContent),
      back: document.getElementById("gameBack").textContent,
      boxTables: document.querySelectorAll("table.box").length,
    }));
    ok(g.hash === "#cgame=401820004" && g.sport === "ncaa", "a college game deep-links as #cgame= (never colliding with NFL ids)");
    ok(/FINAL/.test(g.chip) && /Kroger Field/.test(g.venue), "the college final renders through the same detail view");
    ok(g.bigs.join(",") === "27,20", "away-first scores (VAN 27 @ UK 20)");
    ok(/College/.test(g.back), "the back button reads ‹ College");
    ok(g.boxTables === 6, "the college box score renders 3 groups × 2 teams");
    await shot(page, "sports_cgame_390.png");

    // back returns to the college list with the filter intact
    await page.click("#gameBack");
    await page.waitForFunction(() => window.__SPORTS__.state().view === "cfb", { timeout: 20000 });
    ok(await page.evaluate(() => !document.getElementById("cfbView").hidden
      && document.getElementById("cfbGroup").value === "80"
      && document.querySelectorAll("#cfbGroups .gbtn").length === 4),
      "‹ College returns to the list with the All FBS filter intact");

    // Top 25 again — a fresh default fetch, groups param gone. (The refetch can
    // trail an in-flight groups=80 request — the reload latch re-runs it — so
    // poll for the URL to settle rather than reading lastUrl once.)
    await page.select("#cfbGroup", "top25");
    await page.waitForFunction(() => window.__SPORTS__.state().cfbGroup === "top25"
      && document.querySelectorAll("#cfbGroups .gbtn").length === 2, { timeout: 20000 });
    let top25Url = false;
    for (let i = 0; i < 30 && !top25Url; i++) {
      top25Url = /college-football\/scoreboard/.test(upstream.lastUrl) && !/groups=/.test(upstream.lastUrl);
      if (!top25Url) await sleep(150);
    }
    ok(top25Url, "Top 25 fetches the default slate (no groups param)");

    // college week stepping is its own picker
    await page.click("#cfbNext");
    await page.waitForFunction(() => document.getElementById("cfbTitle").textContent === "Week 2"
      && window.__SPORTS__.state().hasCfb, { timeout: 20000 });
    ok(/college-football/.test(upstream.lastUrl) && /week=2/.test(upstream.lastUrl),
      "the › arrow requests college week 2 from the college endpoint");
    ok(await page.evaluate(() => window.__SPORTS__.state().cur.week === null),
      "…without touching the NFL picker");
    await page.click("#cfbPrev");
    await page.waitForFunction(() => document.getElementById("cfbTitle").textContent === "Week 1", { timeout: 20000 });

    // Preseason: no AP ranks anywhere -> Top 25 falls back to the full slate
    // with a note instead of an empty tab (the live slate reads exactly this
    // way until the first rankings publish).
    upstream.cfbUnranked = true;
    await page.waitForFunction(() => {
      window.__SPORTS__.loadCfb();
      return document.querySelectorAll("#cfbGroups .gbtn").length === 4
        && /No AP Top 25 rankings yet/.test(document.getElementById("cfbGroups").textContent);
    }, { polling: 250, timeout: 8000 });
    ok(true, "an unranked (preseason) week shows every game with a friendly note, never an empty Top 25");
    upstream.cfbUnranked = false;
    await page.waitForFunction(() => {
      window.__SPORTS__.loadCfb();
      return document.querySelectorAll("#cfbGroups .gbtn").length === 2;
    }, { polling: 250, timeout: 8000 });
    ok(true, "…and the rank filter comes back once rankings exist");

    // a failed refresh keeps the stale slate + says so
    upstream.mode = "http500";
    await page.waitForFunction(() => {
      window.__SPORTS__.loadCfb();
      return !document.getElementById("cfbStale").hidden;
    }, { polling: 250, timeout: 8000 });
    ok(await page.evaluate(() => document.querySelectorAll("#cfbGroups .gbtn").length === 2),
      "a failed college refresh keeps the last scores and says so");
    upstream.mode = "normal";
    ok(page._errs.length === 0, "0 page errors on the college view");
    await ctx.close();
  }

  // Fresh device with the API down: honest error card + working retry, via deep link.
  upstream.mode = "http500";
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx);
    await page.goto(BASE + "/sports.html#college", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#cfbGroups .errcard", { timeout: 20000 });
    ok(await page.evaluate(() => window.__SPORTS__.state().view === "cfb"
      && /Couldn’t load college scores/.test(document.querySelector("#cfbGroups .errcard").textContent)),
      "#college deep-links straight in; a fresh device with the API down gets an honest error card");
    upstream.mode = "normal";
    await page.click("#cfbRetry");
    await page.waitForFunction(() => window.__SPORTS__.state().hasCfb, { timeout: 20000 });
    ok(await page.evaluate(() => document.querySelectorAll("#cfbGroups .gbtn").length === 2),
      "Try again recovers the college slate");
    ok(page._errs.length === 0, "0 page errors through the college failure path");
    await ctx.close();
  }
}

// ---------------- section F: the fantasy view ----------------
async function sectionFantasyUI(browser) {
  section("F · the Fantasy view (390×844)");
  ffAuthGood();
  gpt.calls.length = 0;
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx);
    await page.goto(BASE + "/sports.html#fantasy", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SPORTS__ && window.__SPORTS__.state().hasFf, { timeout: 20000 });
    await page.waitForFunction(() => window.__SPORTS__.state().hasFfLg, { timeout: 20000 });
    const ff = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("#ffBody .card")];
      const mineCard = cards.find((c) => /Your matchup/.test(c.textContent));
      const othersCard = cards.find((c) => /Around the league/.test(c.textContent));
      const btns = [...document.querySelectorAll("#ffBody .gbtn[data-ffteam]")];
      const standRows = [...document.querySelectorAll("table.stand tr")].slice(1);
      return {
        view: window.__SPORTS__.state().view,
        pillOn: document.getElementById("pillFf").classList.contains("on"),
        league: (document.querySelector(".ffleague") || {}).textContent || "",
        week: (document.querySelector(".ffweek") || {}).textContent || "",
        btnCount: btns.length,
        mineBtnTeam: mineCard && mineCard.querySelector(".gbtn") ? mineCard.querySelector(".gbtn").dataset.ffteam : "",
        mineText: mineCard ? mineCard.textContent : "",
        mineLive: mineCard ? !!mineCard.querySelector(".stat.live") : false,
        othersText: othersCard ? othersCard.textContent : "",
        othersBtns: othersCard ? othersCard.querySelectorAll(".gbtn[data-ffteam]").length : 0,
        lineupRows: document.querySelectorAll("#ffBody .ffrow").length,
        minePcts: mineCard ? [...mineCard.querySelectorAll(".wpct")].map((w) => w.textContent) : [],
        pctCount: document.querySelectorAll("#ffBody .wpct").length,
        // separation: every matchup row is padded, and stacked rows get a divider
        vsPad: parseFloat(getComputedStyle(document.querySelector("#ffBody .ffvs")).paddingTop) || 0,
        vsDivider: (() => {
          const stacked = [...document.querySelectorAll("#ffBody .gbtn + .gbtn .ffvs")];
          return stacked.length && stacked.every((v) => parseFloat(getComputedStyle(v).borderTopWidth) >= 1);
        })(),
        standCount: standRows.length,
        standFirst: standRows.length ? standRows[0].textContent : "",
        famBoldName: (document.querySelector("table.stand td.fam") || {}).textContent || "",
        // the W-L cell must never wrap "1-0" onto two lines
        wlNowrap: (() => {
          const td = standRows[0] && standRows[0].children[2];
          if (!td) return false;
          return getComputedStyle(td).whiteSpace === "nowrap" && td.getBoundingClientRect().height < 30;
        })(),
        owners: /KreusserFTW|isaac|grandpa/.test(document.querySelector("table.stand").textContent),
        pollIv: window.__SPORTS__.state().pollIv,
      };
    });
    ok(ff.view === "ff" && ff.pillOn, "#fantasy deep-links straight into the Fantasy view");
    ok(ff.league === "Nerd Fantasy Football League" && /Week 2/.test(ff.week), "the league name + week head the page");
    ok(ff.btnCount === 4, "the scoreboard lists ALL 4 matchups (8 teams) as tappable rows");
    ok(ff.mineBtnTeam === "1" && /Battle Kreussers/.test(ff.mineText) && /Waffle House Warriors/.test(ff.mineText),
      "the family matchup is pinned under \"Your matchup\"");
    ok(/87\.4/.test(ff.mineText) && /76\.2/.test(ff.mineText) && ff.mineLive,
      "it carries both live totals and a LIVE tag");
    ok(ff.othersBtns === 3 && /The Goat Kids/.test(ff.othersText) && /Draft Punks/.test(ff.othersText)
      && /Wyoming Cowboys/.test(ff.othersText) && /Hay Bale Hail Marys/.test(ff.othersText)
      && /Nails\s+For Breakfast/.test(ff.othersText) && /End Zone Goats/.test(ff.othersText),
      "the other 3 matchups (all 6 remaining teams) render under Around the league");
    ok(ff.lineupRows === 0, "the scoreboard itself carries NO lineups — those live in the matchup detail");
    // 112.6 vs 98.1 projected finals -> Φ((112.6-98.1)/30) ≈ 69% (hand-computed)
    ok(ff.minePcts.join(",") === "31%,69%", `win chances sit next to the scores (${ff.minePcts.join("/")})`);
    ok(ff.pctCount === 8, "every live matchup carries a chance for both sides");
    ok(ff.vsPad >= 8 && ff.vsDivider, "matchups get breathing room + a divider between stacked rows");
    ok(ff.standCount === 8 && /Battle Kreussers/.test(ff.standFirst) && /Battle Kreussers/.test(ff.famBoldName),
      "standings list all 8 teams, wins→points-for, family row bold");
    ok(!ff.owners, "standings show team names only — no usernames");
    ok(ff.wlNowrap, "the W-L record renders on one line");
    ok(ff.pollIv === 60000, "with matchups live, fantasy polls every 60s");

    // -------- the lineup guard (needs ffMyM, which loads in the background) --------
    await page.waitForSelector("#ffBody .guardcard", { timeout: 20000 });
    const guard = await page.evaluate(() => {
      const g = document.querySelector("#ffBody .guardcard");
      const cards = [...document.querySelectorAll("#ffBody .card")];
      return {
        rows: g.querySelectorAll(".gw").length,
        text: g.textContent,
        first: cards.indexOf(g) === 0,
        sub: (g.querySelector(".gwsub") || {}).textContent || "",
      };
    });
    ok(guard.rows === 1 && /Justin Jefferson/.test(guard.text) && /Questionable/.test(guard.text)
      && /still in your lineup/.test(guard.text) && /🟡/.test(guard.text),
      "the lineup guard flags the Questionable starter (Jefferson), soft-marked 🟡");
    ok(!/Josh Allen|Achane|Bijan/.test(guard.text),
      "…and ONLY him: live starters, healthy pre-game starters and the bench-bye are never flagged");
    ok(guard.first && /Battle Kreussers/.test(guard.text), "the guard card leads the page, named to my team");
    ok(/Fix it in the ESPN app/.test(guard.sub) && /ask the AI below/.test(guard.sub),
      "…and says where the fix actually happens");

    // -------- the Nerd Report (mode ffrecap, generated for the finished week 1) --------
    await page.waitForSelector("#ffBody details.recapcard", { timeout: 20000 });
    const recap = await page.evaluate(() => {
      const d = document.querySelector("#ffBody details.recapcard");
      d.open = true;
      let cached = null; try { cached = JSON.parse(localStorage.getItem("bucky_ffrecap") || "null"); } catch (e) {}
      return {
        summary: d.querySelector("summary").textContent,
        body: (d.querySelector(".recapbody") || {}).textContent || "",
        bolded: d.querySelectorAll(".recapbody b").length,
        openByDefault: false,
        cached,
      };
    });
    ok(/The Nerd Report — Week 1/.test(recap.summary), "the weekly column renders as a collapsed card, titled to the FINISHED week");
    ok(/Kreussers strike first/.test(recap.body) && recap.bolded >= 1,
      "…with the column text inside, **bold** formatted");
    ok(!!recap.cached && recap.cached.week === 1 && /Kreussers strike first/.test(recap.cached.text),
      "the column caches to localStorage bucky_ffrecap for an instant paint next open");
    const recapCalls = gpt.calls.filter((c) => c.mode === "ffrecap");
    ok(recapCalls.length === 1 && recapCalls[0].week === 1 && recapCalls[0].season === 2026
      && Array.isArray(recapCalls[0].matchups) && recapCalls[0].matchups.length === 4
      && recapCalls[0].matchups.every((m) => m.winner === "HOME" || m.winner === "AWAY"),
      "ONE ffrecap call across every repaint, carrying week 1's four DECIDED matchups");

    // -------- the Grok advice card --------
    const aiCard = await page.evaluate(() => ({
      btns: [...document.querySelectorAll("#ffAiCard .aibtn")].map((b) => b.dataset.ffai),
      hasForm: !!document.querySelector("#ffAiForm #ffAiQ"),
      ansHidden: document.getElementById("ffAiAns").hidden,
    }));
    ok(aiCard.btns.join(",") === "lineup,waivers" && aiCard.hasForm && aiCard.ansHidden,
      "the Fantasy AI card offers lineup check + waiver ideas + a free question, answer box hidden until asked");
    await page.click('#ffAiCard .aibtn[data-ffai="lineup"]');
    await page.waitForFunction(() => /start De'Von Achane/.test((document.getElementById("ffAiAns") || {}).textContent || ""), { timeout: 20000 });
    const lineupCall = gpt.calls.filter((c) => c.mode === "fantasy").pop();
    ok(!!lineupCall && lineupCall.kind === "lineup" && lineupCall.matchup && lineupCall.matchup.familyTeamId === 1
      && lineupCall.matchup.matchup.home.roster.length === 11 && (lineupCall.freeAgents || []).length === 0,
      "🩺 Check my lineup posts mode fantasy/kind lineup with my FULL matchup payload and NO free agents");
    ok(await page.evaluate(() => document.querySelectorAll("#ffAiAns b").length >= 1
      && document.querySelectorAll("#ffAiAns li").length >= 2),
      "the streamed advice renders **bold** + bullets in the answer box");
    // The mock answers instantly, so waiting on the DOM can't distinguish the second
    // ask from the first — wait NODE-SIDE for the recorded call instead.
    const gptWait = async (pred) => {
      for (let i = 0; i < 100; i++) {
        if (gpt.calls.filter((c) => c.mode === "fantasy").some(pred)) return true;
        await sleep(50);
      }
      return false;
    };
    await page.click('#ffAiCard .aibtn[data-ffai="waivers"]');
    ok(await gptWait((c) => c.kind === "waivers"), "🔎 Waiver ideas reaches the AI");
    const wCall = gpt.calls.filter((c) => c.mode === "fantasy" && c.kind === "waivers").pop();
    ok(!!wCall && Array.isArray(wCall.freeAgents) && wCall.freeAgents.length === 7
      && wCall.freeAgents[0].name === "Tyjae Spears" && wCall.freeAgents[0].pctOwned === 61.2,
      "…fetching ff_freeagents first and shipping the slim FA list to Grok");
    await page.type("#ffAiQ", "Should I trade Kelce?");
    await page.evaluate(() => document.getElementById("ffAiForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    ok(await gptWait((c) => c.kind === "question"), "the free-text ask reaches the AI");
    const qCall = gpt.calls.filter((c) => c.mode === "fantasy" && c.kind === "question").pop();
    ok(!!qCall && qCall.question === "Should I trade Kelce?", "…as kind question with the typed question");
    await shot(page, "sports_ff_390.png");

    // tap the family matchup -> lineup detail
    await page.click('#ffBody .gbtn[data-ffteam="1"]');
    await page.waitForFunction(() => window.__SPORTS__.state().view === "ffm" && window.__SPORTS__.state().hasFfm, { timeout: 20000 });
    const fm = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#ffmBody .ffrow")];
      const firstRow = rows[0];
      const jj = rows.map((r) => r.textContent).find((t) => /Justin Jefferson/.test(t)) || "";
      return {
        hash: location.hash,
        // Geometry, not the attribute: .pills' display:flex used to beat the UA
        // [hidden] rule, leaving "hidden" pills painted on every detail view.
        pillsHidden: document.getElementById("topPills").hidden
          && document.getElementById("topPills").offsetParent === null,
        meta: document.getElementById("ffmMeta").textContent,
        famNames: [...document.querySelectorAll("#ffmBody .fftm")].slice(0, 2).map((t) => t.textContent),
        famPts: [...document.querySelectorAll("#ffmBody .fftm .pts")].slice(0, 2).map((t) => t.textContent),
        rowCount: rows.length,
        firstSlot: firstRow ? firstRow.querySelector(".slot").textContent : "",
        firstText: firstRow ? firstRow.textContent : "",
        benchHead: rows.some((r) => r.classList.contains("benchhead")),
        liveDots: document.querySelectorAll("#ffmBody .gdot.in").length,
        projStyled: document.querySelectorAll("#ffmBody .ffp .nm b.projpts").length,
        jjHasInjury: /Q/.test(jj) && /proj 16\.4/.test(jj),
        pollIv: window.__SPORTS__.state().pollIv,
      };
    });
    ok(fm.hash === "#ffm=1" && fm.pillsHidden, "tapping a matchup deep-links #ffm=<teamId> and hides the pills");
    ok(/Nerd Fantasy Football League/.test(fm.meta) && /Week 2/.test(fm.meta), "the detail header names the league + week");
    ok(/Battle Kreussers/.test(fm.famNames[0]) && /Waffle House Warriors/.test(fm.famNames[1])
      && fm.famPts[0] === "87.4" && fm.famPts[1] === "76.2",
      "the tapped team leads the matchup card with live totals");
    ok(fm.rowCount === 12 && fm.firstSlot === "QB" && /Josh Allen/.test(fm.firstText) && /22\.4/.test(fm.firstText),
      "lineups render slot by slot — QB first with live points");
    ok(fm.benchHead, "the bench sits under its own divider");
    ok(fm.liveDots >= 5, `in-play players carry live dots (${fm.liveDots})`);
    ok(fm.projStyled >= 3 && fm.jjHasInjury, "yet-to-play players show muted projections (+ injury tag on Jefferson)");
    ok(fm.pollIv === 60000, "the matchup detail keeps the live cadence");
    await shot(page, "sports_ffm_390.png");

    // back to the scoreboard, then open a DIFFERENT matchup
    await page.click("#ffmBack");
    await page.waitForFunction(() => window.__SPORTS__.state().view === "ff", { timeout: 20000 });
    ok(await page.evaluate(() => !document.getElementById("ffView").hidden
      && document.querySelectorAll('#ffBody .gbtn[data-ffteam]').length === 4),
      "‹ Fantasy returns to the scoreboard");
    await page.click('#ffBody .gbtn[data-ffteam="3"]');
    await page.waitForFunction(() => window.__SPORTS__.state().view === "ffm" && window.__SPORTS__.state().ffmTeamId === 3
      && window.__SPORTS__.state().hasFfm, { timeout: 20000 });
    const fm3 = await page.evaluate(() => ({
      names: [...document.querySelectorAll("#ffmBody .fftm")].slice(0, 2).map((t) => t.textContent),
      hasLamar: /Lamar Jackson/.test(document.getElementById("ffmBody").textContent),
    }));
    ok(/The Goat Kids/.test(fm3.names[0]) && /Draft Punks/.test(fm3.names[1]) && fm3.hasLamar,
      "ANY matchup opens with its own lineups (Goat Kids vs Draft Punks)");

    // deep link straight to a third matchup
    await page.evaluate(() => { location.hash = "ffm=5"; });
    await page.waitForFunction(() => window.__SPORTS__.state().ffmTeamId === 5 && window.__SPORTS__.state().hasFfm, { timeout: 20000 });
    ok(await page.evaluate(() => /Wyoming Cowboys/.test(document.getElementById("ffmBody").textContent)
      && /Hay Bale Hail Marys/.test(document.getElementById("ffmBody").textContent)),
      "#ffm=<id> deep-links straight into that matchup");

    // pill back to NFL
    await page.evaluate(() => { location.hash = "fantasy"; });
    await page.waitForFunction(() => window.__SPORTS__.state().view === "ff", { timeout: 20000 });
    await page.click("#pillNfl");
    await page.waitForFunction(() => window.__SPORTS__.state().view === "week" && window.__SPORTS__.state().hasSb, { timeout: 20000 });
    ok(await page.evaluate(() => !document.getElementById("weekView").hidden && document.getElementById("pillNfl").classList.contains("on")),
      "the NFL pill switches back to the week list");
    await page.click("#pillFf");
    await page.waitForFunction(() => window.__SPORTS__.state().view === "ff", { timeout: 20000 });
    ok(true, "…and the Fantasy pill returns");
    ok(page._errs.length === 0, "0 page errors on the fantasy views");
    await ctx.close();
  }

  // Per-user teams: Isaac follows The Goat Kids, Grandpa the Wyoming Cowboys,
  // Mom the Nails for Breakfast (whose LEAGUE name carries the double space — the
  // pinned card shows the league's own spelling, the app's config the natural one).
  for (const [who, team, disp, oppo] of [
    ["Isaac", "The Goat Kids", /The Goat Kids/, "Draft Punks"],
    ["Grandpa", "Wyoming Cowboys", /Wyoming Cowboys/, "Hay Bale Hail Marys"],
    ["Mom", "Nails for Breakfast", /Nails\s+For Breakfast/, "End Zone Goats"],
  ]) {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx, { choreUser: who });
    await page.goto(BASE + "/sports.html#fantasy", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SPORTS__ && window.__SPORTS__.state().hasFf, { timeout: 20000 });
    const p = await page.evaluate(() => {
      const mineCard = [...document.querySelectorAll("#ffBody .card")].find((c) => /Your matchup/.test(c.textContent));
      return {
        teamName: window.__SPORTS__.state().ffTeamName,
        famId: window.__SPORTS__.state().ffFamilyTeamId,
        mineText: mineCard ? mineCard.textContent : "",
      };
    });
    ok(p.teamName === team && /Your matchup/.test(p.mineText) && disp.test(p.mineText) && p.mineText.includes(oppo),
      `${who}'s scoreboard pins ${team} (vs ${oppo}) as "Your matchup"`);
    ok(page._errs.length === 0, `0 page errors as ${who}`);
    await ctx.close();
  }

  // The AI down: a friendly line in the answer box, the recap simply absent — the
  // scoreboard itself must stand untouched.
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx, { gptDown: true });
    await page.goto(BASE + "/sports.html#fantasy", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SPORTS__ && window.__SPORTS__.state().hasFf, { timeout: 20000 });
    // Background loads (ffMyM, the league doc) repaint #ffBody and replace the button
    // node — a coordinate click can land on a stale spot. Wait for the guard card
    // (ffMyM landed) and dispatch el.click() so delegation catches it regardless.
    await page.waitForSelector("#ffBody .guardcard", { timeout: 20000 });
    await page.evaluate(() => document.querySelector('#ffAiCard .aibtn[data-ffai="lineup"]').click());
    await page.waitForFunction(() => /couldn.t answer right now/.test((document.getElementById("ffAiAns") || {}).textContent || ""), { timeout: 20000 });
    ok(true, "a dead AI answers with a friendly try-again line, never a raw error");
    const after = await page.evaluate(() => ({
      recap: !!document.querySelector("#ffBody .recapcard"),
      matchups: document.querySelectorAll("#ffBody .gbtn[data-ffteam]").length,
      btnEnabled: !document.querySelector('#ffAiCard .aibtn[data-ffai="lineup"]').disabled,
    }));
    ok(!after.recap && after.matchups === 4 && after.btnEnabled,
      "no column card when the AI is down, the scoreboard stands, and the buttons re-enable");
    ok(page._errs.length === 0, "0 page errors with the AI down");
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
    // a matchup deep link is gated the same way
    await page.evaluate(() => { location.hash = "ffm=3"; });
    await page.waitForFunction(() => /one-time setup by Dad/.test(document.getElementById("ffmBody").textContent), { timeout: 20000 });
    ok(true, "an unconfigured matchup deep link shows the same setup card");
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

    // Sports is an IN-APP tab now: tapping it hosts sports.html in a persistent
    // iframe — index.html itself never navigates (the "reconnect" fix).
    await page.evaluate(() => {
      [...document.querySelectorAll("#bnav .bnav-btn")].find((x) => x.dataset.gid === "sports").click();
    });
    await page.waitForFunction(() => {
      const w = document.getElementById("embed_sports");
      return w && !w.hidden && w.querySelector("iframe");
    }, { timeout: 20000 });
    ok(await page.evaluate(() => location.pathname).then((p) => !p.endsWith("/sports.html")),
      "tapping Sports does NOT navigate away — the app stays loaded");
    const sportsFrame = () => page.frames().find((f) => f.url().includes("sports.html"));
    await page.waitForFunction(() => {
      const f = document.getElementById("embed_sports").querySelector("iframe");
      try { return f.contentWindow.__SPORTS__ && f.contentWindow.__SPORTS__.state().hasSb; } catch { return false; }
    }, { timeout: 20000 });
    const emb = await sportsFrame().evaluate(() => ({
      embedded: document.documentElement.classList.contains("embedded"),
      headerGone: getComputedStyle(document.querySelector("header")).display === "none",
      navGone: getComputedStyle(document.getElementById("buckyNav")).display === "none",
      rows: document.querySelectorAll("#wkGroups .gbtn").length,
    }));
    ok(emb.embedded && emb.headerGone && emb.navGone,
      "the framed page knows it's embedded and hides its own header + nav");
    ok(emb.rows === 5, "the embedded Sports tab shows the full week");
    const geo = await page.evaluate(() => {
      const w = document.getElementById("embed_sports").getBoundingClientRect();
      const h = document.querySelector("header").getBoundingClientRect();
      const b = document.getElementById("bnav").getBoundingClientRect();
      const bOn = getComputedStyle(document.getElementById("bnav")).display !== "none";
      return { top: w.top, hBottom: h.bottom, bottom: w.bottom, bTop: bOn ? b.top : innerHeight, vw: innerWidth, w: w.width };
    });
    ok(Math.abs(geo.top - geo.hBottom) < 2 && Math.abs(geo.bottom - geo.bTop) < 2,
      "the frame fills exactly the space between the header and the bottom nav");

    // Leaving pauses the frame (kept alive, not reloaded); returning resumes it.
    await sportsFrame().evaluate(() => { window.__embedMarker = "alive"; });
    await page.evaluate(() => {
      [...document.querySelectorAll("#bnav .bnav-btn")].find((x) => x.dataset.gid === "home").click();
    });
    await sleep(300);
    const hidden = await page.evaluate(() => document.getElementById("embed_sports").hidden === true);
    const paused = await sportsFrame().evaluate(() => ({
      flag: window.__buckyEmbedVisible === false,
      poll: window.__SPORTS__.state().pollScheduled,
    }));
    ok(hidden && paused.flag && paused.poll === false,
      "switching to Home hides the frame and pauses its polling");
    await page.evaluate(() => {
      [...document.querySelectorAll("#bnav .bnav-btn")].find((x) => x.dataset.gid === "sports").click();
    });
    await page.waitForFunction(() => !document.getElementById("embed_sports").hidden, { timeout: 8000 });
    await sleep(300);
    const back = await sportsFrame().evaluate(() => ({
      marker: window.__embedMarker,
      poll: window.__SPORTS__.state().pollScheduled,
    }));
    ok(back.marker === "alive" && back.poll === true,
      "returning shows the SAME frame (state preserved, no reload) and re-arms polling");
    await shot(page, "sports_embed_390.png");

    // The AI tab embeds the same way — farmgpt keeps its slim toolbar (the view
    // title + 🧹 Clear live there) but loses the wordmark + its own navs.
    await page.evaluate(() => {
      [...document.querySelectorAll("#bnav .bnav-btn")].find((x) => x.dataset.gid === "gpt").click();
    });
    await page.waitForFunction(() => {
      const w = document.getElementById("embed_farmgpt");
      return w && !w.hidden && w.querySelector("iframe");
    }, { timeout: 20000 });
    await sleep(700);
    const gptFrame = page.frames().find((f) => f.url().includes("farmgpt.html"));
    const ai = await gptFrame.evaluate(() => ({
      embedded: document.documentElement.classList.contains("embedded"),
      navGone: getComputedStyle(document.getElementById("buckyNav")).display === "none",
      wordmarkGone: getComputedStyle(document.querySelector("#bar a#backLink")).display === "none",
      barKept: getComputedStyle(document.querySelector("header")).display !== "none",
      home: !!document.getElementById("viewHome"),
    }));
    ok(ai.embedded && ai.navGone && ai.wordmarkGone && ai.barKept && ai.home,
      "the AI tab embeds farmgpt: slim toolbar kept, wordmark + navs gone, home view up");
    await shot(page, "ai_embed_390.png");

    // Desktop: the frame sits right of the rail and reaches the bottom (no bottom nav).
    await page.setViewport({ width: 1280, height: 900 });
    await sleep(400);
    await page.evaluate(() => {
      [...document.querySelectorAll("#sidenav .sn-item")].find((x) => x.dataset.gid === "sports").click();
    });
    await page.waitForFunction(() => !document.getElementById("embed_sports").hidden, { timeout: 8000 });
    await sleep(400);
    const dgeo = await page.evaluate(() => {
      const w = document.getElementById("embed_sports").getBoundingClientRect();
      return { left: w.left, bottom: w.bottom, ih: innerHeight, railW: document.getElementById("sidenav").getBoundingClientRect().width };
    });
    ok(dgeo.railW > 100 && Math.abs(dgeo.left - dgeo.railW) < 2 && Math.abs(dgeo.bottom - dgeo.ih) < 2,
      "desktop: the frame sits right of the rail and reaches the bottom");
    await shot(page, "sports_embed_desktop.png");
    ok(page._errs.length === 0, "0 page errors on index.html (Firebase blocked)" + (page._errs.length ? " — " + page._errs[0] : ""));
    await ctx.close();
  }
}

// ---------------- section G: the Home snapshot cards ----------------
async function sectionHomeCards(browser) {
  section("G · the Home snapshot cards on index.html");
  ffAuthGood();
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx);
    await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => {
      const n = document.querySelector(".home2 .nflcard"), f = document.querySelector(".home2 .ffcard");
      return n && !n.hidden && f && !f.hidden;
    }, { timeout: 20000 });
    const h = await page.evaluate(() => {
      const n = document.querySelector(".home2 .nflcard"), f = document.querySelector(".home2 .ffcard");
      const rows = [...n.querySelectorAll(".spg")];
      const ffRows = [...f.querySelectorAll(".ffhome")];
      return {
        nflHead: n.querySelector(".sph").textContent,
        rowCount: rows.length,
        firstRow: rows[0] ? rows[0].textContent : "",
        liveClock: n.querySelector(".sps.live") ? n.querySelector(".sps.live").textContent : "",
        situ: n.querySelector(".spsitu") ? n.querySelector(".spsitu").textContent : "",
        foot: n.querySelector(".spfoot") ? n.querySelector(".spfoot").textContent : "",
        ffHead: f.querySelector(".sph").textContent,
        ffNames: ffRows.map((r) => r.querySelector(".fhn").textContent),
        ffPts: ffRows.map((r) => r.querySelector(".fhp").textContent),
        oppDim: ffRows[1] ? ffRows[1].classList.contains("down") : false,
        ffSub: f.querySelector(".ffhsub") ? f.querySelector(".ffhsub").textContent : "",
        afterWeather: n.previousElementSibling && n.previousElementSibling.classList.contains("wxcard"),
      };
    });
    ok(/🏈 NFL · Week 1/.test(h.nflHead) && /LIVE/.test(h.nflHead), "the NFL card heads with the week + LIVE");
    ok(h.rowCount === 2 && /BUF 14/.test(h.firstRow) && /KC 17/.test(h.firstRow) && /◂/.test(h.firstRow),
      "live games render away @ home with scores + possession");
    ok(/8:42 - 3rd/.test(h.liveClock), "the live clock is on the row");
    ok(/2nd & 7/.test(h.situ), "the featured game carries its situation line");
    ok(/\+ 3 more this week/.test(h.foot), "the rest of the week folds into the footer");
    ok(h.afterWeather, "the cards slot in right after the weather card");
    ok(/🏆 Fantasy · Week 2/.test(h.ffHead) && /LIVE/.test(h.ffHead), "the fantasy card heads with its week + LIVE");
    ok(/Battle Kreussers/.test(h.ffNames[0]) && h.ffPts[0] === "87.4" && h.ffPts[1] === "76.2" && h.oppDim,
      "the family matchup shows live scores with the trailing side dimmed");
    ok(/proj 112\.6 – 98\.1/.test(h.ffSub) && /2 starters yet to play/.test(h.ffSub),
      "projections + the yet-to-play count read at a glance");
    // The home-card lineup guard (same rules as sports.html's — keep in sync):
    // Jefferson is the only fixable problem, so it names him in the single form.
    ok(await page.evaluate(() => {
      const w = document.querySelector(".home2 .ffcard .ffwarnline");
      return !!w && /⚠️ Justin Jefferson is questionable and still in your lineup/.test(w.textContent);
    }), "the ⚠️ lineup-guard line warns about the Questionable starter right on Home");
    await shot(page, "sports_home_390.png");

    await page.click(".home2 .nflcard");
    await page.waitForFunction(() => {
      const w = document.getElementById("embed_sports");
      return w && !w.hidden;
    }, { timeout: 20000 });
    ok(await page.evaluate(() => !location.pathname.endsWith("/sports.html")),
      "tapping the NFL card opens the embedded Sports tab (no navigation)");
    ok(page._errs.length === 0, "0 page errors with the cards live");
    await ctx.close();
  }
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx);
    await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => { const f = document.querySelector(".home2 .ffcard"); return f && !f.hidden; }, { timeout: 20000 });
    await page.click(".home2 .ffcard");
    await page.waitForFunction(() => {
      const w = document.getElementById("embed_sports");
      if (!w || w.hidden) return false;
      try {
        const s = w.querySelector("iframe").contentWindow.__SPORTS__;
        return s && s.state().view === "ff";
      } catch { return false; }
    }, { timeout: 20000 });
    ok(true, "tapping the fantasy card opens the embedded Sports tab on the Fantasy view");
    await ctx.close();
  }
  // Per-user home card: Isaac's dashboard shows HIS team's matchup.
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx, { choreUser: "Isaac" });
    await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => { const f = document.querySelector(".home2 .ffcard"); return f && !f.hidden; }, { timeout: 20000 });
    const i = await page.evaluate(() => {
      const f = document.querySelector(".home2 .ffcard");
      return {
        names: [...f.querySelectorAll(".ffhome .fhn")].map((r) => r.textContent),
        pts: [...f.querySelectorAll(".ffhome .fhp")].map((r) => r.textContent),
      };
    });
    ok(i.names[0] === "The Goat Kids" && i.names[1] === "Draft Punks" && i.pts[0] === "65.0" && i.pts[1] === "55.1",
      "Isaac's home card shows The Goat Kids' matchup, his side first");
    ok(page._errs.length === 0, "0 page errors on Isaac's dashboard");
    await ctx.close();
  }

  // Fantasy unconfigured -> the fantasy card simply isn't there; NFL unaffected.
  ffAuthNone();
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx);
    await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => { const n = document.querySelector(".home2 .nflcard"); return n && !n.hidden; }, { timeout: 20000 });
    ok(await page.evaluate(() => document.querySelector(".home2 .ffcard").hidden === true),
      "an unconfigured fantasy league leaves no card (setup lives on the sports page)");
    ok(page._errs.length === 0, "0 page errors with fantasy unconfigured");
    await ctx.close();
  }
  ffAuthGood();
  // Everything down + no cache -> no cards, no shells, no errors.
  upstream.mode = "http500"; ffUp.mode = "http500";
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx);
    await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(1200);
    ok(await page.evaluate(() =>
      document.querySelector(".home2 .nflcard").hidden === true
      && document.querySelector(".home2 .ffcard").hidden === true
      && !!document.querySelector(".home2 .hero")),
      "with the API down and no cache, the dashboard simply has no sports cards");
    ok(page._errs.length === 0, "0 page errors with the API down");
    await ctx.close();
  }
  upstream.mode = "normal"; ffUp.mode = "normal";
  // The other suites mock every function as 200 {} — cards must read that as nothing.
  {
    const ctx = await browser.createBrowserContext();
    const page = await newPage(ctx, { sportsEmpty: true });
    await page.goto(BASE + "/index.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(1200);
    ok(await page.evaluate(() =>
      document.querySelector(".home2 .nflcard").hidden === true
      && document.querySelector(".home2 .ffcard").hidden === true),
      "a blanket {} function mock (other suites' harness) hides the cards cleanly");
    ok(page._errs.length === 0, "0 page errors under the {} mock");
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
    await sectionCollege(browser);
    await sectionFantasyUI(browser);
    await sectionDesktopIndex(browser);
    await sectionHomeCards(browser);
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
