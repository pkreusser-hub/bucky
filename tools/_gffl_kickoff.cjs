// _gffl_kickoff.cjs — the two readiness rehearsals for the real GFFL kickoff (2026-09-02).
//
//   node tools/_gffl_kickoff.cjs
//
// PART A — THE DRAFT -> IMPORT CROSS-APP SEAM. Drives ffdraft.html's own mock-bot draft
// headlessly (?local=1, the same localStorage-doc mechanism tools/_verify-ffdraft.cjs's section
// B uses) against a FAKE ESPN fantasy upstream carrying the REAL 8 GFFL team ids
// (1,2,3,4,5,9,11,12 — names/abbrevs lifted verbatim from tools/_verify-gffl.cjs's own
// REAL_TEAM_IDS fixture, section F2), 16 rounds, two keepers. The finished draft doc (the exact
// shape ffdraft.html would have written to Firestore doc ffdraft_<fam>/draft_<season>) is then
// injected into a SECOND page — league.html, booted LOCAL-backend (the same
// localStorage["lg_ffdraft_<fam>_draft_<season>"] injection tools/_verify-gffl.cjs's AI14
// section uses to fake LG.db.foreignGet) — with EMPTY rosters (post-reset state), and the
// commissioner's real Draft Day Import button is driven end to end.
//
// PART B — THE CALENDAR DRY-RUN. Continues on the SAME post-import league.html page. Drives
// LG.nowOverride through the real 2026 week-1 slate's kickoff instants (Thu Sep 10 7:20pm CT,
// Sun Sep 13 12:00/3:25/7:20pm CT, Mon Sep 14 7:15pm CT) and asserts locking, waivers and
// finalizeWeek at each, every number hand-computed from the fixture.
//
// Both parts intentionally avoid a Firestore-REST simulator (tools/_gffl_race_kit.cjs's own
// tool): league.html's LOCAL backend (assets/league/lg-core.js's `local` object) already IS a
// fake store, and tools/_verify-gffl.cjs's own AI14 section proves this exact
// localStorage-injection technique is how this codebase tests the Draft Day Import today. House
// rule honoured: gstatic|googleapis|firestore|firebase is aborted for both pages throughout.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { pathToFileURL } = require("url");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const SRV_PORT = 8861;
const FF_PORT = 8862;
const BASE = "http://127.0.0.1:" + SRV_PORT;
const FAM = "kickoff2026";
const SEASON = 2026;
const S2 = "TEST_S2_KICKOFF";
const SWID = "TEST-SWID-KICKOFF";

let PASS = 0; const FAILS = [];
function ok(cond, msg) {
  if (cond) { PASS++; console.log("  ok   " + msg); }
  else { FAILS.push(msg); console.log("  FAIL " + msg); }
  return !!cond;
}
function head(t) { console.log("\n" + t + "\n" + "=".repeat(t.length)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ================================================================== fixtures: the 8 real teams
// Verbatim from tools/_verify-gffl.cjs L2906-2910 (section F2, "the REAL, non-contiguous team-id
// shape a years-old ESPN league actually produces").
const REAL_TEAM_IDS = [1, 2, 3, 4, 5, 9, 11, 12];
const REAL_TEAM_NAMES = ["Battle Kreussers", "End Zone Goats", "Wyoming Cowboys", "Waffle House Warriors",
  "Nails  For Breakfast", "Team Six", "Team Seven", "The Goat Kids"];
const REAL_TEAMS = REAL_TEAM_IDS.map((id, i) => ({ id, name: REAL_TEAM_NAMES[i], abbrev: "T" + id }));

// The representative week-1 slate: real 2026 kickoff windows (Thu/Sun x3/Mon), fourteen synthetic
// pro teams spread across them so every drafted player resolves to a real, testable kickoff. Not
// the full 16-game NFL slate — a deliberate scope cut (see the report) that keeps every
// assertion hand-computable while covering the SHAPE the task asked for.
const CT = "-05:00"; // CDT (Sep-early Nov); the DST check at the bottom probes the winter case
function ctMs(y, m, d, hh, mm) { return Date.parse(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${CT}`); }
const KICKOFFS = {
  THU: ctMs(2026, 9, 10, 19, 20),   // Thu Sep 10, 7:20 PM CT
  SUN_NOON: ctMs(2026, 9, 13, 12, 0),  // Sun Sep 13, 12:00 PM CT
  SUN_325: ctMs(2026, 9, 13, 15, 25), // Sun Sep 13, 3:25 PM CT
  SUN_720: ctMs(2026, 9, 13, 19, 20), // Sun Sep 13, 7:20 PM CT
  MON: ctMs(2026, 9, 14, 19, 15),  // Mon Sep 14, 7:15 PM CT
};
// pro-team-abbrev -> kickoff window. Abbrevs + proTeamId must match sports.mjs's own PRO_ABBREV.
const SLATE = {
  PHI: { id: 21, k: "THU" }, KC: { id: 12, k: "THU" },
  BUF: { id: 2, k: "SUN_NOON" }, DAL: { id: 6, k: "SUN_NOON" }, SF: { id: 25, k: "SUN_NOON" }, DET: { id: 8, k: "SUN_NOON" },
  MIA: { id: 15, k: "SUN_325" }, GB: { id: 9, k: "SUN_325" }, CIN: { id: 4, k: "SUN_325" }, BAL: { id: 33, k: "SUN_325" },
  LAR: { id: 14, k: "SUN_720" }, NYJ: { id: 20, k: "SUN_720" },
  SEA: { id: 26, k: "MON" }, ARI: { id: 22, k: "MON" },
};
const PRO_TEAMS = Object.keys(SLATE);
const GAME_LEN_MS = 190 * 60 * 1000; // 3h10m — long enough Thu stays "in" 1min post-kickoff,
// short enough the Monday game (7:15pm CT) reads "post" by 10:30pm CT (7:15+3:10=10:25pm).

// ================================================================== fixtures: the draft pool
// 238 synthetic players, generously oversized for a 128-pick (16 rounds x 8 teams) draft with
// caps on QB(2)/TE(2)/K(1)/D-ST(1) per mockChoice's own filter (ffdraft.html) so the pool can
// never run dry. Ranked 1..238 in generation order (QB block first) — an unrealistic ADP shape
// (every bot wants a top-ranked QB first) but harmless: it never blocks the draft, and this
// rehearsal doesn't grade value-vs-ADP.
let PID = 6001;
function rawEntry(name, posId, proTeamId, rank) {
  const pid = PID++;
  return {
    onTeamId: 0, status: "FREEAGENT",
    player: {
      id: pid, fullName: name, defaultPositionId: posId, proTeamId,
      injuryStatus: "ACTIVE",
      ownership: { averageDraftPosition: rank, percentOwned: 50, percentChange: 0 },
      draftRanksByRankType: {
        PPR: { rank, rankType: "PPR", auctionValue: 1, published: true },
        STANDARD: { rank, rankType: "STANDARD", auctionValue: 1, published: true },
      },
      stats: [
        { seasonId: SEASON, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 150, appliedAverage: 10 },
        { seasonId: SEASON - 1, statSourceId: 0, statSplitTypeId: 0, appliedTotal: 140, appliedAverage: 9 },
      ],
      seasonOutlook: "x", eligibleSlots: [],
    },
  };
}
function buildPool() {
  const rows = [];
  let rank = 1;
  // QB/RB/WR/TE are built in FIXED index order (poolPlayer(i) below indexes by generation
  // order, and the two keeper picks are pinned to specific indices) but ranked INTERLEAVED —
  // each block spread proportionally across the whole skill-position rank range by fractional
  // position, not stacked block-after-block. A first attempt ranked QB 1-40/RB 41-110/WR
  // 111-180/TE 181-210 in solid blocks; since mockChoice always takes the best-available
  // eligible player, that produced a real bot draft with ZERO TEs taken at all (RB, uniformly
  // better-ranked than WR and TE, absorbed every "flex" pick before WR was ever touched, and
  // WR alone absorbed the rest before TE's rank range was ever reached) — an artifact of this
  // fixture's rank shape, not of the app, and it would have silently confounded the D/ST
  // finding below (a roster missing its TE is unfillable for an unrelated reason). Interleaving
  // guarantees a realistic mix and keeps that finding isolated to D/ST alone.
  const blockDefs = [
    { n: 40, label: "QB", posId: 1 }, { n: 70, label: "RB", posId: 2 },
    { n: 70, label: "WR", posId: 3 }, { n: 30, label: "TE", posId: 4 },
  ];
  const skillEntries = [];
  for (const b of blockDefs) {
    for (let i = 0; i < b.n; i++) {
      const team = PRO_TEAMS[i % PRO_TEAMS.length];
      skillEntries.push({ frac: i / b.n, order: blockDefs.indexOf(b), name: b.label + (i + 1) + "-" + team, posId: b.posId, proTeamId: SLATE[team].id });
    }
  }
  skillEntries.sort((a, b) => a.frac - b.frac || a.order - b.order);
  for (const e of skillEntries) rows.push(rawEntry(e.name, e.posId, e.proTeamId, rank++));
  // K/DST stay ranked worst (unaffected — mockChoice force-fills them from the pool regardless
  // of rank once a team's remaining rounds run short, see the comment at mockChoice below).
  const block = (n, label, posId) => {
    for (let i = 0; i < n; i++) {
      const team = PRO_TEAMS[i % PRO_TEAMS.length];
      rows.push(rawEntry(label + (i + 1) + "-" + team, posId, SLATE[team].id, rank++));
    }
  };
  block(14, "K", 5);
  // One D/ST per pro team (14) — ESPN's own convention: a team defense is a "player" too,
  // POS_LABEL[16] = "D/ST" (sports.mjs L388) — see the FATAL finding this fixture is built to
  // surface, in the report.
  for (const team of PRO_TEAMS) rows.push(rawEntry(team + " D/ST", 16, SLATE[team].id, rank++));
  return rows;
}
const POOL_RAW = buildPool();
// Found by NAME (stable regardless of interleaving/rank order) — NOT by generation index, which
// interleaving above deliberately scrambled.
function poolPlayerNamed(prefix) {
  const e = POOL_RAW.find((r) => r.player.fullName.startsWith(prefix));
  if (!e) throw new Error("fixture bug: no pool player named " + prefix + "*");
  return e.player;
}

// ---- keepers: two real, hand-computable ones ----
// KEEPER_A: team 1 (Battle Kreussers) drafted him R5 last season -> keeper cost R4 (round-1).
// KEEPER_B: team 12 (The Goat Kids) drafted him R8 last season -> keeper cost R7.
const KEEPER_A = poolPlayerNamed("QB1-");   // first QB generated
const KEEPER_B = poolPlayerNamed("RB11-");  // 11th RB generated
const LAST_SEASON_YEAR = SEASON - 1;
function lastRosterEntry(p) {
  return { playerId: p.id, playerPoolEntry: { player: { id: p.id, fullName: p.fullName, defaultPositionId: p.defaultPositionId, proTeamId: p.proTeamId } } };
}
function lastDraftDoc() {
  return {
    id: 705063, seasonId: LAST_SEASON_YEAR,
    draftDetail: {
      drafted: true, inProgress: false,
      picks: [
        { id: 1, overallPickNumber: 1, roundId: 5, roundPickNumber: 1, playerId: KEEPER_A.id, teamId: 1, keeper: false, bidAmount: 0, autoDraftTypeId: 0, reservedForKeeper: false, memberId: "{AAAA-1}" },
        { id: 2, overallPickNumber: 2, roundId: 8, roundPickNumber: 1, playerId: KEEPER_B.id, teamId: 12, keeper: false, bidAmount: 0, autoDraftTypeId: 0, reservedForKeeper: false, memberId: "{AAAA-12}" },
      ],
    },
    teams: [
      { id: 1, abbrev: "T1", roster: { entries: [lastRosterEntry(KEEPER_A)] } },
      { id: 12, abbrev: "T12", roster: { entries: [lastRosterEntry(KEEPER_B)] } },
    ],
    members: [], positionAgainstOpponent: { positionalRatings: {} },
  };
}
// mTeam+mSettings — ff_draftinfo's own upstream doc. lineupSlotCounts sums (excl. IR/21) to 16,
// matching LG.DEFAULT_RULES.roster's own non-IR total (1+2+2+1+1+1+1+7=16) — the two fixtures
// agree on purpose, since a mismatch here would make Part A's "cap 19 / fillable lineup"
// assertions meaningless.
function leagueInfoDoc() {
  return {
    id: 705063, seasonId: SEASON, scoringPeriodId: 1,
    status: { currentMatchupPeriod: 1, latestScoringPeriod: 1 },
    settings: {
      name: "Goat Fantasy Football League", size: 8,
      rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 1, 17: 1, 20: 7, 21: 3 } },
      scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] }, // PPR
    },
    members: [],
    teams: REAL_TEAMS.map((t) => ({ id: t.id, abbrev: t.abbrev, name: t.name, logo: "", owners: [], playoffSeed: 1, record: { overall: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 } } })),
  };
}

// ================================================================== fake ESPN fantasy upstream
function startFfUpstream() {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const respond = (obj, status) => { res.writeHead(status || 200, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (u.pathname.endsWith("/seasons/" + SEASON) && u.searchParams.get("view") === "proTeamSchedules_wl") {
      return respond({ settings: { proTeams: [] } }); // byes: empty is fine, degrades gracefully
    }
    const cookie = req.headers.cookie || "";
    const okAuth = cookie.includes("espn_s2=" + S2) && cookie.includes("SWID={" + SWID + "}");
    if (!okAuth) return respond({ messages: ["not authorized"] }, 401);
    if (!/\/leagues\/705063/.test(u.pathname)) return respond({}, 404);
    const views = u.searchParams.getAll("view");
    if (views.includes("kona_player_info") || views.includes("kona_playercard")) {
      let filt = {};
      try { filt = JSON.parse(req.headers["x-fantasy-filter"] || "{}"); } catch (e) { /* malformed */ }
      if (filt.players && filt.players.filterSlotIds) return respond({ players: [] }); // D/ST+K sweep: main pool is already complete
      return respond({ players: POOL_RAW });
    }
    if (views.includes("mDraftDetail") || views.includes("mRoster")) {
      const ym = /\/seasons\/(\d+)\//.exec(u.pathname);
      const yr = ym ? Number(ym[1]) : null;
      if (yr === LAST_SEASON_YEAR) return respond(lastDraftDoc());
      return respond({ error: "no history" }, 500); // older years: permissive degrade (historyOk=false)
    }
    return respond(leagueInfoDoc()); // mTeam+mSettings -> ff_draftinfo
  });
  return new Promise((resolve) => srv.listen(FF_PORT, "127.0.0.1", () => resolve(srv)));
}

// ================================================================== static server + in-process fn
function startStatic() {
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, BASE);
    if (u.pathname.startsWith("/.netlify/")) { res.writeHead(204); res.end(); return; }
    let p = path.join(ROOT, decodeURIComponent(u.pathname));
    if (u.pathname === "/") p = path.join(ROOT, "index.html");
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end("nope"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(SRV_PORT, "127.0.0.1", () => r(srv)));
}
let sportsHandler = null;
async function initSportsHandler() {
  process.env.BUCKY_NOTIFY_SECRET = "amenfarms";
  process.env.SPORTS_FF_BASE_URL = "http://127.0.0.1:" + FF_PORT;
  process.env.SPORTS_NFL_BASE_URL = "http://127.0.0.1:" + FF_PORT; // unused by draft actions; must exist
  process.env.ESPN_S2 = S2;
  process.env.ESPN_SWID = SWID;
  process.env.ESPN_SEASON = String(SEASON); // deterministic ffSeason(), independent of wall-clock date
  const mod = await import(pathToFileURL(path.join(ROOT, "netlify", "functions", "sports.mjs")).href);
  sportsHandler = mod.default;
}

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
// Shared request routing for both pages: same-origin continues, /.netlify/functions/sports goes
// to the real in-process handler, gstatic|googleapis|firestore|firebase is ALWAYS aborted (house
// rule), everything else external is aborted too (no real network, ever).
async function newPage(browser, vw) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(vw || { width: 390, height: 844 });
  await page.evaluateOnNewDocument(() => {
    window.__dlg = [];
    window.prompt = () => "1234";
    window.alert = () => {}; window.confirm = () => true;
  });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    (async () => {
      try {
        if (u.includes("/.netlify/functions/sports")) {
          const resp = await sportsHandler(new Request(u, { method: req.method(), headers: { "content-type": "application/json", origin: BASE }, body: req.method() === "POST" ? req.postData() : undefined }));
          const text = await resp.text();
          return req.respond({ status: resp.status, contentType: "application/json", body: text });
        }
        if (u.includes("/.netlify/functions/")) return req.respond({ status: 200, contentType: "application/json", body: '{"ok":true}' }); // booth, notify, etc — harmless canned ok
        if (/googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
        if (u.startsWith(BASE)) return req.continue();
        return req.abort();
      } catch (e) { /* page closed mid-flight */ }
    })();
  });
  page._errs = [];
  const NOISE = /Failed to load resource|gstatic|firebase|ERR_FAILED|ERR_BLOCKED/i;
  page.on("pageerror", (e) => { if (!NOISE.test(String(e))) page._errs.push(String(e)); });
  return { ctx, page };
}

// ================================================================== helpers
function fmtMs(ms) {
  return new Date(ms).toISOString() + " (" + new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ms)) + " real-CT)";
}
// dropBlocked needs {slot, team} too, not just a key — a starting-slot player on an untracked
// team always reads "not started" (D.gameStarted's safe default), so a fake player object
// missing `team` would silently pass every lock check regardless of the real answer.
function fakeStarter(s) { return { key: s.key, slot: "QB", team: s.team }; }
async function dropBlockedFor(page, list) {
  return page.evaluate((players) => players.map((p) => window.__GFFL__.LG.dropBlocked(p)), list.map(fakeStarter));
}
// D.S.games rebuild for a given instant — mirrors a real poll: REBUILT, never merged (docs,
// 2026-08-26 season-reset entry). state derives from kickoff + a fixed game length.
function gamesAt(nowMs) {
  const out = {};
  for (const team of PRO_TEAMS) {
    const kickoff = KICKOFFS[SLATE[team].k];
    const state = nowMs < kickoff ? "pre" : (nowMs < kickoff + GAME_LEN_MS ? "in" : "post");
    out[team] = { state, kickoff: new Date(kickoff).toISOString(), period: state === "in" ? 1 : 0, clock: "" };
  }
  return out;
}

// ================================================================== PART A: the draft
async function runDraft(browser) {
  head("PART A.1 — the mock-bot draft (ffdraft.html, ?local=1)");
  const { ctx, page } = await newPage(browser);
  const url = BASE + "/ffdraft.html?local=1&fam=" + FAM + "&season=" + SEASON;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__DRAFT__, { timeout: 15000 });

  const loaded = await page.evaluate(async () => {
    await window.__DRAFT__.loads();
    const D = window.__DRAFT__;
    return { info: D.info, poolLen: D.pool.length, lastDraft: D.lastDraft };
  });
  ok(loaded.info && loaded.info.ok === true, "ff_draftinfo answered ok");
  ok(loaded.info && Array.isArray(loaded.info.teams) && loaded.info.teams.length === 8, "8 teams loaded");
  const idsSeen = (loaded.info.teams || []).map((t) => t.id).slice().sort((a, b) => a - b);
  ok(JSON.stringify(idsSeen) === JSON.stringify(REAL_TEAM_IDS.slice().sort((a, b) => a - b)),
    "the REAL, non-contiguous GFFL team ids loaded: " + JSON.stringify(idsSeen));
  ok(loaded.info.rosterSize === 16, "rosterSize (draft rounds) reads 16, matching the league's own non-IR roster total (" + loaded.info.rosterSize + ")");
  ok(loaded.poolLen === POOL_RAW.length, "the full pool loaded (" + loaded.poolLen + "/" + POOL_RAW.length + ")");
  ok(loaded.lastDraft && loaded.lastDraft.ok === true, "ff_lastdraft answered ok (for the keeper costs)");

  await page.evaluate(() => window.__DRAFT__.createDraft());
  const created = await page.evaluate(() => ({ rounds: window.__DRAFT__.D.rounds, phase: window.__DRAFT__.D.phase }));
  ok(created.rounds === 16, "the draft room opened at 16 rounds (" + created.rounds + ")");
  ok(created.phase === "setup", "phase starts at setup");

  await page.evaluate(() => window.__DRAFT__.setPhase("keepers"));
  await page.evaluate((aPid, bPid) => {
    const H = window.__DRAFT__;
    H.addKeeper(1, H.pool.find((p) => p.pid === aPid));
    H.addKeeper(12, H.pool.find((p) => p.pid === bPid));
  }, KEEPER_A.id, KEEPER_B.id);
  const keeperCosts = await page.evaluate((aPid, bPid) => ({
    a: window.__DRAFT__.D.keepers[1].find((k) => k.pid === aPid),
    b: window.__DRAFT__.D.keepers[12].find((k) => k.pid === bPid),
  }), KEEPER_A.id, KEEPER_B.id);
  ok(keeperCosts.a && keeperCosts.a.round === 4, "keeper A (team 1, drafted R5 last year) costs R4 — hand-computed max(1,5-1) (got R" + (keeperCosts.a && keeperCosts.a.round) + ")");
  ok(keeperCosts.b && keeperCosts.b.round === 7, "keeper B (team 12, drafted R8 last year) costs R7 — hand-computed max(1,8-1) (got R" + (keeperCosts.b && keeperCosts.b.round) + ")");

  await page.evaluate(() => window.__DRAFT__.setPhase("live"));
  const materialized = await page.evaluate(() => ({
    r4t1: window.__DRAFT__.D.picks.r4_t1, r7t12: window.__DRAFT__.D.picks.r7_t12,
    pickCount: Object.keys(window.__DRAFT__.D.picks).length,
  }));
  ok(materialized.r4t1 && materialized.r4t1.keeper === true && materialized.r4t1.pid === KEEPER_A.id, "keeper A materialized onto the board at r4_t1");
  ok(materialized.r7t12 && materialized.r7t12.keeper === true && materialized.r7t12.pid === KEEPER_B.id, "keeper B materialized onto the board at r7_t12");
  ok(materialized.pickCount === 2, "exactly 2 picks on the board before the bots start (the 2 keepers)");

  // Nobody claims a team — every one of the 8 stays owner-less, so mock mode (commissioner-only,
  // LOCAL-only per ffdraft.html L2462) drafts literally the whole room.
  await page.evaluate(() => window.__DRAFT__.setMockDelay(15));
  await page.evaluate(() => { document.querySelector('#tabs button[data-v="commish"]').click(); });
  await page.evaluate(() => { document.getElementById("mockToggle").click(); });
  const mockOn = await page.evaluate(() => window.__DRAFT__.D.mock === true);
  ok(mockOn, "mock drafting switched on");

  const t0 = Date.now();
  try {
    await page.waitForFunction(() => window.__DRAFT__.D.phase === "done", { timeout: 120000, polling: 150 });
  } catch (e) {
    const dbg = await page.evaluate(() => ({ phase: window.__DRAFT__.D.phase, picks: Object.keys(window.__DRAFT__.D.picks).length, cur: window.__DRAFT__.currentSlot() }));
    ok(false, "draft did not finish in time: " + JSON.stringify(dbg));
  }
  const drove = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("  (mock draft finished in " + drove + "s)");

  const draftDoc = await page.evaluate(() => window.__DRAFT__.D);
  ok(draftDoc.phase === "done", "draft phase reached done");
  const pickKeys = Object.keys(draftDoc.picks || {});
  ok(pickKeys.length === 128, "128 total picks — 16 rounds x 8 teams (got " + pickKeys.length + ")");
  const perTeam = {};
  for (const k of pickKeys) { const t = k.split("_t")[1]; perTeam[t] = (perTeam[t] || 0) + 1; }
  ok(REAL_TEAM_IDS.every((id) => perTeam[String(id)] === 16), "every one of the 8 real teams has exactly 16 picks — " + JSON.stringify(perTeam));
  const botPicks = pickKeys.filter((k) => draftDoc.picks[k].by === "MOCK").length;
  ok(botPicks === 126, "126 bot picks + 2 keepers = 128 (bot picks: " + botPicks + ")");
  ok(page._errs.length === 0, "0 page errors through the whole mock draft (" + page._errs.join(" | ") + ")");

  await ctx.close();
  return draftDoc;
}

// ================================================================== PART A: the import
async function runImport(browser, draftDoc) {
  head("PART A.2 — league.html, empty rosters, the commissioner's Draft Day Import");
  const { ctx, page } = await newPage(browser);
  const lsPfx = "lg_gffl_" + FAM + "_";
  await page.evaluateOnNewDocument((fam, pfx, teams, draft) => {
    localStorage.setItem("gffl_pass", "amenfarms");
    localStorage.setItem("gffl_team", "1");
    localStorage.setItem("gffl_who", "Peter");
    for (const t of teams) localStorage.setItem(pfx + "team_" + t.id, JSON.stringify({ kind: "team", teamId: t.id, name: t.name, abbrev: t.abbrev, owner: "" }));
    localStorage.setItem(pfx + "sched_" + 2026, JSON.stringify({ kind: "sched", season: 2026, weeks: [[[1, 2], [3, 4], [5, 9], [11, 12]]] }));
    // The Draft Day Import's own foreign read: LG.db.foreignGet("ffdraft_"+fam, "draft_2026")
    // resolves to localStorage["lg_ffdraft_<fam>_draft_2026"] on the LOCAL backend (lg-core.js
    // L299-302) — the exact key tools/_verify-gffl.cjs's AI14 section injects under (DRAFT_KEY).
    localStorage.setItem("lg_ffdraft_" + fam + "_draft_2026", JSON.stringify(draft));
    // POST-RESET STATE: deliberately NO roster_2026_w1_t<id> docs for any team.
  }, FAM, lsPfx, REAL_TEAMS, draftDoc);

  await page.goto(BASE + "/league.html?fam=" + FAM + "&sim=0", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => window.__GFFL__ && window.__GFFL__.LG.rules, { timeout: 20000 });
  await page.waitForSelector(".mucard", { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => { try { window.__GFFL__.D.stop(); } catch (e) {} });

  const idsSeen = await page.evaluate(() => window.__GFFL__.LG.teams.map((t) => t.id));
  ok(JSON.stringify(idsSeen.slice().sort((a, b) => a - b)) === JSON.stringify(REAL_TEAM_IDS.slice().sort((a, b) => a - b)),
    "league.html booted with the same real team ids: " + JSON.stringify(idsSeen));
  const preRosters = await page.evaluate(async (ids) => {
    const out = {};
    for (const id of ids) out[id] = (await window.__GFFL__.LG.loadRoster(1, id)) || null;
    return out;
  }, REAL_TEAM_IDS);
  ok(REAL_TEAM_IDS.every((id) => preRosters[id] == null), "pre-import: every roster is genuinely empty (post-reset state)");

  await page.evaluate(() => window.__GFFL__.LG.gateCommish());
  await page.evaluate(() => window.__GFFL__.UI.show("rules"));
  await page.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 10000 });
  const btn = await page.$("#draftRostersImport");
  ok(!!btn, "the commissioner sees the Import rosters from Draft Day button");
  await page.evaluate(() => document.getElementById("draftRostersImport").click());
  await page.waitForSelector("#draftGo", { timeout: 10000 });
  const confirmTxt = (await page.evaluate(() => (document.querySelector("#importOut") || {}).textContent || "")).replace(/\s+/g, " ");
  ok(/128 picks across 8 teams/.test(confirmTxt), "confirm names 128 picks across 8 teams (" + confirmTxt.slice(0, 90) + ")");
  ok(/week 1/.test(confirmTxt), "confirm names week 1");

  await page.evaluate(() => document.getElementById("draftGo").click());
  // FINDING (see report): runDraftImport (lg-ui.js) sets the "Draft imported" success message
  // into #importOut and then, with no await in between, calls UI.show("rules") — which
  // unconditionally re-renders main()'s whole innerHTML from scratch, destroying the just-set
  // message (and #importOut itself) before the browser ever paints it. The underlying data
  // write already completed by that point (applyImportedRosters is awaited first), so the
  // import itself is NOT broken — only its on-screen confirmation is unobservable. The existing
  // suite (tools/_verify-gffl.cjs AI14) never caught this because its own wait helper
  // (waitFnOr) is deliberately TOLERANT of a timeout and asserts nothing on its own; the real
  // sync point below is the roster write itself, not the vanished message.
  await page.waitForFunction((id) => {
    try { return JSON.parse(localStorage.getItem("lg_gffl_" + id.fam + "_roster_2026_w1_t" + id.team) || "null") != null; }
    catch (e) { return false; }
  }, { timeout: 15000 }, { fam: FAM, team: REAL_TEAM_IDS[0] });
  const msgVisible = await page.evaluate(() => /Draft imported/.test(document.body.textContent)).catch(() => false);
  ok(msgVisible, "FINDING (see report): the on-screen 'Draft imported' confirmation is observable after the click — expected to FAIL (it is wiped by the import's own UI.show('rules') call before paint; lg-ui.js runDraftImport)");

  const after = await page.evaluate(async (ids) => {
    const LG = window.__GFFL__.LG;
    const out = {};
    for (const id of ids) out[id] = await LG.loadRoster(1, id);
    return out;
  }, REAL_TEAM_IDS);
  ok(page._errs.length === 0, "0 page errors through the import (" + page._errs.join(" | ") + ")");

  return { ctx, page, after, lsPfx };
}

function assertPartAResults(draftDoc, after) {
  head("PART A.3 — hand-computed assertions against the imported rosters");
  // Expected per-team players, from the draft doc itself (ground truth).
  const expected = {};
  for (const id of REAL_TEAM_IDS) expected[id] = [];
  for (const k of Object.keys(draftDoc.picks)) {
    const m = /^r(\d+)_t(\d+)$/.exec(k);
    if (!m) continue;
    expected[Number(m[2])].push(draftDoc.picks[k]);
  }
  for (const id of REAL_TEAM_IDS) {
    const ros = after[id] || [];
    ok(ros.length === 16, "team " + id + ": exactly 16 drafted players landed (" + ros.length + ")");
    // Classified by PID identity from the draft doc (ground truth), not by re-deriving "is this
    // the DST" from the (possibly buggy) resulting key — that keeps this check isolated from
    // the D/ST keying finding asserted explicitly in PART A.4 below.
    const dstPids = new Set(expected[id].filter((p) => p.pos === "D/ST").map((p) => String(p.pid)));
    const wantNonDst = expected[id].filter((p) => !dstPids.has(String(p.pid))).map((p) => String(p.pid)).sort();
    const gotNonDst = ros.filter((p) => !dstPids.has(p.key)).map((p) => p.key).sort();
    ok(JSON.stringify(gotNonDst) === JSON.stringify(wantNonDst),
      "team " + id + ": every non-DST player keyed by ESPN id, matching the draft exactly");
  }

  // No player on two teams.
  const allKeys = REAL_TEAM_IDS.flatMap((id) => (after[id] || []).map((p) => p.key));
  const dupes = allKeys.filter((k, i) => allKeys.indexOf(k) !== i);
  ok(dupes.length === 0, "no player key appears on two rosters (dupes: " + JSON.stringify(dupes) + ")");

  // Roster cap.
  head("cap + lineup fillability (LG.canFillLineup)");
  // (These two checks run inside the page — see the caller, which passes canFillLineup results.)
}

// ================================================================== PART B: the calendar dry-run
async function partB(page, lsPfx, draftDoc) {
  head("PART B — the calendar dry-run (LG.nowOverride through week 1)");

  // Every drafted starter's pro team, resolved from the ACTUAL post-import rosters (not
  // hand-picked) — this is what makes the per-instant lock assertions a real test of THIS
  // draft's output rather than a fixture I wrote to already agree with itself.
  const rosterInfo = await page.evaluate(async (ids) => {
    const LG = window.__GFFL__.LG;
    const out = {};
    for (const id of ids) out[id] = await LG.loadRoster(1, id);
    return out;
  }, REAL_TEAM_IDS);
  const starters = [];
  for (const id of REAL_TEAM_IDS) {
    for (const p of rosterInfo[id] || []) if (p.slot !== "BENCH" && p.slot !== "IR") starters.push({ teamId: id, ...p });
  }
  const knownTeams = starters.filter((p) => SLATE[p.team]).length;
  ok(starters.length > 0, "at least one starter exists across the 8 rosters (" + starters.length + ")");
  console.log("  (" + starters.length + " total starters, " + knownTeams + " on a pro team this fixture's slate covers)");

  // Seed D.S.players with a hand-computed live score for EVERY rostered player (starters +
  // bench), so D.livePts/finalizeWeek have real, known numbers instead of "no row yet". Score =
  // 10 * (index+1) mod 23 + 3 — arbitrary but FIXED and reproducible, so every total below is
  // hand-checkable against this same formula.
  const seedResult = await page.evaluate(async (ids) => {
    const LG = window.__GFFL__.LG, D = window.__GFFL__.D;
    let i = 0;
    const rows = [];
    for (const id of ids) {
      const ros = (await LG.loadRoster(1, id)) || [];
      for (const p of ros) {
        const pts = ((i * 7 + 3) % 23) + 1; // 1..23, deterministic
        D.S.players.set(p.key, { key: p.key, name: p.name, pos: p.pos, team: p.team, espn: null, slp: null, pts, official: true });
        rows.push({ key: p.key, pts });
        i++;
      }
    }
    return rows;
  }, REAL_TEAM_IDS);
  const ptsByKey = {}; for (const r of seedResult) ptsByKey[r.key] = r.pts;

  // Also seed a projection for every rostered player (LG.data.setAdjProj) — hand-computed as
  // pts+1 so it is trivially distinguishable from the live score in the assertions below.
  await page.evaluate((rows) => {
    const D = window.__GFFL__.D;
    const players = {};
    for (const r of rows) players[r.key] = { p: r.pts + 1 };
    D.setAdjProj({ kind: "proj", week: 1, at: Date.now(), players });
  }, seedResult);

  // ---------------------------------------------------------------- Sat Sep 5, 12:00 CT (pre-draft calendar)
  {
    head("Sat Sep 5 12:00 CT — pre-season calendar arithmetic");
    const now = ctMs(2026, 9, 5, 12, 0);
    const r = await page.evaluate((nowMs) => {
      const LG = window.__GFFL__.LG;
      LG.nowOverride = nowMs;
      return { week: LG.currentWeek(), deadline: LG.waiverDeadline(1) };
    }, now);
    // Hand-computed: SEASON_START = 2026-09-08T05:00:00-05:00 (a Tuesday). now (Sep5) is BEFORE
    // that, so currentWeek()'s floor((now-start)/7d) is negative -> clamped to 1.
    ok(r.week === 1, "LG.currentWeek() clamps to 1 before the season starts (got " + r.week + ")");
    const expectDeadline = ctMs(2026, 9, 9, 8, 0); // Wed after the Tue start, 8am (processDow=3,processHour=8)
    ok(r.deadline === expectDeadline, "week 1's waiver deadline hand-computes to Wed Sep 9 08:00 CT (" + fmtMs(r.deadline) + ")");
    // Nothing has polled yet in this fixture at this instant (D.S.espnWeek/slpWeek still null) —
    // the honest "unknown" state. finalizeWeek must refuse rather than guess.
    const fz = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(1));
    ok(fz.ok === false && fz.reason === "no-live-data", "finalizeWeek(1) honestly refuses no-live-data with nothing polled yet (" + JSON.stringify(fz) + ")");
  }

  // ---------------------------------------------------------------- Mon Sep 7, 09:00 CT (post-draft)
  {
    head("Mon Sep 7 09:00 CT — post-draft: free agency, matchup rows, projections");
    const now = ctMs(2026, 9, 7, 9, 0);
    await page.evaluate((nowMs) => { window.__GFFL__.LG.nowOverride = nowMs; }, now);
    // An undrafted player: any pool pid never used by any of the 128 picks.
    const draftedIds = new Set(Object.values(draftDoc.picks).map((p) => p.pid));
    const undrafted = POOL_RAW.map((r) => r.player).find((p) => !draftedIds.has(p.id) && p.defaultPositionId !== 16);
    ok(!!undrafted, "an undrafted free agent exists in the pool (id " + (undrafted && undrafted.id) + ")");
    const addRes = await page.evaluate(async (p) => {
      const LG = window.__GFFL__.LG;
      return LG.faAdd(1, 1, { key: String(p.id), name: p.fullName, pos: "WR", team: "PHI" }, null);
    }, undrafted);
    ok(addRes.ok === true, "LG.faAdd of an undrafted free agent succeeds instantly (" + JSON.stringify(addRes) + ")");
    const afterAdd = await page.evaluate(() => window.__GFFL__.LG.loadRoster(1, 1));
    ok((afterAdd || []).some((p) => p.key === String(undrafted.id)), "…and lands on the roster immediately");
    // clean up so this add doesn't distort the later cap/idempotence checks
    await page.evaluate(async (key) => {
      const LG = window.__GFFL__.LG;
      const ros = await LG.loadRoster(1, 1, { fresh: true });
      await LG.saveRoster(1, 1, ros.filter((p) => p.key !== key));
    }, String(undrafted.id));

    // Matchup rows show week-1 kickoffs, nothing locked yet (games not built in D.S at all yet).
    const gamesEmpty = await page.evaluate(() => window.__GFFL__.D.S.games.size === 0);
    ok(gamesEmpty, "no games tracked yet at this instant — every starter reads not-started");
    const lockCheck = (await dropBlockedFor(page, starters.slice(0, 5))).every((v) => v === false);
    ok(lockCheck, "nothing is locked pre-slate (dropBlocked false for a sample of starters)");

    // Projections non-null for every rostered starter (D.projFor reads D.S.adjProj, seeded above).
    const projRes = await page.evaluate((keys) => keys.map((k) => window.__GFFL__.D.projFor(k)), starters.map((s) => s.key));
    ok(projRes.every((v) => v != null && Number.isFinite(v)), "every starter's projection is non-null (" + projRes.filter((v) => v == null).length + " null of " + projRes.length + ")");
  }

  // ---------------------------------------------------------------- Wed Sep 9, 07:59 / 08:01 CT
  {
    head("Wed Sep 9 07:59/08:01 CT — the quiet waiver run (zero claims)");
    await page.evaluate(() => { window.__GFFL__.LG.nowOverride = null; }); // clear before re-arming season type below
    // Mark the engine "live and regular" from here on, as a real poll would once the season
    // regularizes (see the report on why this is deliberately NOT set at the Sep 5 instant).
    await page.evaluate((games) => {
      const D = window.__GFFL__.D;
      D.S.espnWeek = 1; D.S.slpWeek = 1; D.S.espnSeasonType = "regular"; D.S.slpSeasonType = "regular";
      D.S.games = new Map(Object.entries(games));
    }, gamesAt(ctMs(2026, 9, 9, 7, 59)));

    const before = ctMs(2026, 9, 9, 7, 59);
    await page.evaluate((nowMs) => { window.__GFFL__.LG.nowOverride = nowMs; }, before);
    const rosterBefore1 = await page.evaluate(() => window.__GFFL__.LG.loadRoster(1, 1, { fresh: true }));
    const wk = await page.evaluate(() => window.__GFFL__.LG.processWaivers(1));
    // LG.processWaivers's return has no `ok` field (lg-core.js L2354/L2381) — `processed:true`
    // is the success signal, on both the zero-claims fast path and the full run.
    ok(wk.processed === true, "processWaivers(1) with zero claims marks the week processed (" + JSON.stringify(wk) + ")");
    ok(Array.isArray(wk.claims) && wk.claims.length === 0, "…and zero claims/results, since none were ever submitted");
    const rosterAfter1 = await page.evaluate(() => window.__GFFL__.LG.loadRoster(1, 1, { fresh: true }));
    ok(JSON.stringify(rosterBefore1) === JSON.stringify(rosterAfter1), "team 1's roster is byte-for-byte untouched by the quiet run");
    // finalizeWeek must NOT succeed at 07:59 — games haven't kicked off; "empty-week" is not
    // reachable here (rosters are filled), so the honest reason is "not-final".
    const fz1 = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(1));
    ok(fz1.ok === false && fz1.reason === "not-final", "finalizeWeek(1) at 07:59 Wed refuses not-final, not empty-week (rosters are filled) — " + JSON.stringify({ ok: fz1.ok, reason: fz1.reason }));

    const after8 = ctMs(2026, 9, 9, 8, 1);
    await page.evaluate((nowMs) => { window.__GFFL__.LG.nowOverride = nowMs; }, after8);
    const wk2 = await page.evaluate(() => window.__GFFL__.LG.processWaivers(1));
    ok(wk2.processed === true, "processWaivers(1) still processes cleanly one minute later (08:01)");
  }

  // ---------------------------------------------------------------- Thu Sep 10, 19:19 vs 19:21 CT
  {
    head("Thu Sep 10 19:19 vs 19:21 CT — the Thursday game's lock, to the millisecond");
    const thuStarters = starters.filter((p) => SLATE[p.team] && SLATE[p.team].k === "THU");
    const otherStarters = starters.filter((p) => SLATE[p.team] && SLATE[p.team].k !== "THU");
    ok(thuStarters.length > 0, "at least one rostered starter plays in the Thursday game (" + thuStarters.length + ")");

    const before = ctMs(2026, 9, 10, 19, 19);
    await page.evaluate((games, nowMs) => {
      window.__GFFL__.D.S.games = new Map(Object.entries(games));
      window.__GFFL__.LG.nowOverride = nowMs;
    }, gamesAt(before), before);
    const preLock = await dropBlockedFor(page, thuStarters);
    ok(preLock.every((v) => v === false), "19:19 — one minute before kickoff, every Thursday starter is still unlocked");

    const at = ctMs(2026, 9, 10, 19, 21);
    await page.evaluate((games, nowMs) => {
      window.__GFFL__.D.S.games = new Map(Object.entries(games));
      window.__GFFL__.LG.nowOverride = nowMs;
    }, gamesAt(at), at);
    const postLock = await dropBlockedFor(page, thuStarters);
    ok(postLock.every((v) => v === true), "19:21 — one minute after kickoff, every Thursday starter is locked (dropBlocked)");
    const othersStillFree = await dropBlockedFor(page, otherStarters);
    ok(othersStillFree.every((v) => v === false), "…while every starter NOT in the Thursday game stays unlocked (" + otherStarters.length + " checked)");
  }

  // ---------------------------------------------------------------- Sun Sep 13, 12:01 CT
  {
    head("Sun Sep 13 12:01 CT — noon games locked, 3:25 games not");
    const at = ctMs(2026, 9, 13, 12, 1);
    await page.evaluate((games, nowMs) => {
      window.__GFFL__.D.S.games = new Map(Object.entries(games));
      window.__GFFL__.LG.nowOverride = nowMs;
    }, gamesAt(at), at);
    const noonStarters = starters.filter((p) => SLATE[p.team] && SLATE[p.team].k === "SUN_NOON");
    const laterStarters = starters.filter((p) => SLATE[p.team] && ["SUN_325", "SUN_720", "MON"].includes(SLATE[p.team].k));
    ok(noonStarters.length > 0, "at least one starter plays in a Sunday-noon game (" + noonStarters.length + ")");
    const noonLocked = await dropBlockedFor(page, noonStarters);
    ok(noonLocked.every((v) => v === true), "every Sunday-noon starter is locked one minute after kickoff");
    const laterFree = await dropBlockedFor(page, laterStarters);
    ok(laterFree.every((v) => v === false), "every 3:25/7:20/Monday starter is still unlocked at Sunday noon");
  }

  // ---------------------------------------------------------------- Mon Sep 14, 22:30 CT — finalize
  {
    head("Mon Sep 14 22:30 CT — every game post, finalizeWeek(1) succeeds");
    const at = ctMs(2026, 9, 14, 22, 30);
    await page.evaluate((games, nowMs) => {
      window.__GFFL__.D.S.games = new Map(Object.entries(games));
      window.__GFFL__.LG.nowOverride = nowMs;
    }, gamesAt(at), at);
    const allPost = await page.evaluate(() => [...window.__GFFL__.D.S.games.values()].every((g) => g.state === "post"));
    ok(allPost, "every tracked game reads post by 22:30 CT Monday (game length 3h10m, latest kickoff 7:15pm CT)");

    // Hand-compute expected matchup totals from the pts I seeded, using the SAME roster the
    // engine will score (starters only).
    const expectedTotals = {};
    for (const id of REAL_TEAM_IDS) {
      let sum = 0;
      for (const p of rosterInfo[id] || []) if (p.slot !== "BENCH" && p.slot !== "IR") sum += ptsByKey[p.key] || 0;
      expectedTotals[id] = Math.round(sum * 100) / 100;
    }

    const fz = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(1));
    ok(fz.ok === true, "finalizeWeek(1) succeeds at Monday 22:30 CT (" + JSON.stringify({ ok: fz.ok, reason: fz.reason }) + ")");
    if (fz.ok) {
      let allMatch = true;
      for (const m of fz.matchups || []) {
        const wantH = expectedTotals[m.home], wantA = expectedTotals[m.away];
        if (m.homePts !== wantH || m.awayPts !== wantA) allMatch = false;
      }
      ok(allMatch, "every matchup total matches the hand-computed sum of seeded starter points — " + JSON.stringify(fz.matchups));
      // Standings derived straight from the weekly doc's own matchups (the source every
      // standings render is built from) rather than a second, possibly-async UI helper.
      const rec = {};
      for (const m of fz.matchups) {
        rec[m.home] = rec[m.home] || { w: 0, l: 0 };
        rec[m.away] = rec[m.away] || { w: 0, l: 0 };
        if (m.homePts > m.awayPts) { rec[m.home].w++; rec[m.away].l++; }
        else if (m.awayPts > m.homePts) { rec[m.away].w++; rec[m.home].l++; }
      }
      const allOneAndZero = Object.values(rec).every((r) => r.w + r.l === 1);
      ok(allOneAndZero, "every team is 1-0 or 0-1 after week 1 (" + JSON.stringify(rec) + ")");
      const wroteDoc = await page.evaluate(async () => !!(await window.__GFFL__.LG.db.get("weekly_2026_w1")));
      ok(wroteDoc, "the write-once weekly doc exists");
      const fz2 = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(1));
      ok(fz2.ok === true && JSON.stringify(fz2.matchups) === JSON.stringify(fz.matchups), "a second finalizeWeek(1) returns the identical write-once doc, unchanged");
    }
  }

  // ---------------------------------------------------------------- Tue Sep 15, 06:00 CT
  {
    head("Tue Sep 15 06:00 CT — week 2, carried forward via ensureRoster");
    const at = ctMs(2026, 9, 15, 6, 0);
    await page.evaluate((nowMs) => {
      const D = window.__GFFL__.D;
      window.__GFFL__.LG.nowOverride = nowMs;
      D.S.espnWeek = 2; D.S.slpWeek = 2; // the engine has rolled with the calendar
      D.S.games = new Map(); // a fresh week — nothing tracked yet
    }, at);
    const wk = await page.evaluate(() => window.__GFFL__.LG.currentWeek());
    ok(wk === 2, "LG.currentWeek() reads 2 (7 days after SEASON_START's Tuesday) — got " + wk);
    const carried = await page.evaluate(async (id) => {
      const LG = window.__GFFL__.LG;
      const w1 = await LG.loadRoster(1, id);
      const w2 = await LG.ensureRoster(2, id);
      return { w1, w2 };
    }, REAL_TEAM_IDS[0]);
    ok(JSON.stringify(carried.w1.map((p) => p.key).sort()) === JSON.stringify(carried.w2.map((p) => p.key).sort()),
      "team " + REAL_TEAM_IDS[0] + "'s week-2 roster (via ensureRoster) is week 1's roster carried forward, same player set");
    const w2persisted = await page.evaluate((id) => window.__GFFL__.LG.loadRoster(2, id, { fresh: true }), REAL_TEAM_IDS[0]);
    ok(Array.isArray(w2persisted) && w2persisted.length === carried.w1.length, "…and the carry-forward was actually persisted (a real roster_2026_w2 doc now exists)");
    const lockedNow = await dropBlockedFor(page, starters.slice(0, 5));
    ok(lockedNow.every((v) => v === false), "nothing is locked at the top of week 2 (fresh D.S.games, nothing tracked yet)");
  }

  // ---------------------------------------------------------------- Wed Sep 16, 08:00 CT — real waiver claim
  {
    head("Wed Sep 16 08:00 CT — a real waiver claim: priority/purse hand-computed");
    const at = ctMs(2026, 9, 16, 8, 0);
    await page.evaluate((nowMs) => { window.__GFFL__.LG.nowOverride = nowMs; }, at);
    const draftedIds = new Set(Object.values(draftDoc.picks).map((p) => p.pid));
    const POS_NAME = { 1: "QB", 2: "RB", 3: "WR", 4: "TE" };
    // Any undrafted skill-position free agent — position 2 (RB) preferred for realism, but the
    // mock draft's own demand for RB (uncapped in mockChoice) can exhaust the whole RB pool, so
    // this falls back to whichever skill position genuinely has one left, rather than assume.
    const undrafted = [2, 3, 4, 1].map((posId) =>
      POOL_RAW.map((r) => r.player).find((p) => !draftedIds.has(p.id) && p.defaultPositionId === posId)
    ).find(Boolean);
    ok(!!undrafted, "an undrafted skill-position free agent exists for the claim test");
    const teamId = REAL_TEAM_IDS[0];
    const dropKey = (rosterInfo[teamId] || []).find((p) => p.slot === "BENCH");
    const budget = 100; // DEFAULT_RULES.waivers.budget
    const BID = 17;
    const claim = {
      id: "claim_kickoff_test_1", teamId, addKey: String(undrafted.id), addName: undrafted.fullName,
      addPos: POS_NAME[undrafted.defaultPositionId], addTeam: "PHI",
      dropKey: dropKey ? dropKey.key : null, dropName: dropKey ? dropKey.name : null,
      bid: BID, t: Date.now(),
    };
    const claimRes = await page.evaluate((c) => window.__GFFL__.LG.addClaim(2, c), claim);
    ok(claimRes && claimRes.ok === true, "the claim submits (week 2, team " + teamId + ", bid " + BID + ") — " + JSON.stringify(claimRes));
    const wk = await page.evaluate(() => window.__GFFL__.LG.processWaivers(2));
    ok(wk.processed === true, "processWaivers(2) runs with the one seeded claim (" + JSON.stringify({ processed: wk.processed }) + ")");
    const results = wk.results || [];
    const mine = results.find((r) => String(r.teamId) === String(teamId));
    ok(!!mine, "the run recorded a result for team " + teamId + " (" + JSON.stringify(mine) + ")");
    if (mine) {
      ok(mine.ok === true && mine.reason === "won", "the lone claim wins — nobody else was bidding against it (" + JSON.stringify(mine) + ")");
    }
    const rosterAfter = await page.evaluate((id) => window.__GFFL__.LG.loadRoster(2, id, { fresh: true }), teamId);
    ok((rosterAfter || []).some((p) => p.key === String(undrafted.id)), "the won player landed on team " + teamId + "'s week-2 roster");
    // Purse arithmetic: budget(100) - BID should be the remaining FAAB, hand-computed.
    const purse = await page.evaluate((id) => (window.__GFFL__.LG.teamById(id) || {}).faab, teamId);
    if (purse != null) {
      ok(purse === budget - BID, "FAAB purse debited exactly the bid: " + budget + " - " + BID + " = " + (budget - BID) + " (got " + purse + ")");
    } else {
      console.log("  (no team.faab field found on this build — purse arithmetic not asserted; see report)");
    }
  }

  // ---------------------------------------------------------------- Sun Nov 1 (DST) -> Wed Nov 4 08:00 CT
  {
    head("Sun Nov 1 (DST fall-back) -> Wed Nov 4 waiver deadline");
    // Week 9's Tuesday is Nov 3, 2026 (SEASON_START Sep 8 + 8*7 days = Nov 3) — its Wednesday
    // deadline is the first one computed entirely AFTER the real America/Chicago DST fall-back
    // (2026-11-01, 2am local). LG.waiverDeadline builds every week from ONE fixed "-05:00"
    // anchor (lg-core.js's own comment: "the same fixed -05:00 clock reading"), so this is the
    // hand-computable probe for whether that fixed offset still reads 8am in REAL Chicago time
    // once the real timezone has moved to -06:00.
    const deadlineMs = await page.evaluate(() => window.__GFFL__.LG.waiverDeadline(9));
    const chicago = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", hour12: false, weekday: "short", month: "short", day: "numeric" }).format(new Date(deadlineMs));
    console.log("  LG.waiverDeadline(9) = " + new Date(deadlineMs).toISOString() + " = " + chicago + " real America/Chicago time");
    const hourInChicago = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }).format(new Date(deadlineMs)));
    ok(hourInChicago === 8, "week 9's (Wed Nov 4) waiver deadline still reads 8am in REAL America/Chicago wall-clock time (got " + hourInChicago + ":00) — see FINDING in the report if this fails");
  }
}

// ================================================================== run
async function main() {
  await initSportsHandler();
  const staticSrv = await startStatic();
  const ffSrv = await startFfUpstream();
  const browser = await launchBrowser();
  let exitCode = 0;
  // DEV-ITERATION CACHE ONLY: the mock draft (Part A.1) takes ~75s and its output is a pure
  // function of the fixtures above. GFFL_KICKOFF_CACHE=<path> skips re-running it if a cached
  // doc exists there — never used in a real run (unset in CI/normal invocation).
  const cachePath = process.env.GFFL_KICKOFF_CACHE;
  try {
    let draftDoc;
    if (cachePath && fs.existsSync(cachePath)) {
      head("PART A.1 — SKIPPED, using cached draft doc: " + cachePath);
      draftDoc = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    } else {
      draftDoc = await runDraft(browser);
      if (cachePath) fs.writeFileSync(cachePath, JSON.stringify(draftDoc));
    }
    const { ctx, page, after } = await runImport(browser, draftDoc);
    assertPartAResults(draftDoc, after);

    // ---- the D/ST shape-drift check, run explicitly and reported as its own section ----
    head("PART A.4 — D/ST shape check (sports.mjs vs applyImportedRosters)");
    const dstReport = REAL_TEAM_IDS.map((id) => {
      const ros = after[id] || [];
      const dst = ros.find((p) => p.pos === "D/ST" || p.pos === "DST" || p.key.startsWith("dst_"));
      return { id, dst };
    }).filter((r) => r.dst);
    ok(dstReport.length > 0, "at least one team drafted a D/ST (" + dstReport.length + " of 8)");
    for (const { id, dst } of dstReport) {
      ok(dst.key.startsWith("dst_"), "team " + id + "'s drafted D/ST is keyed dst_<team> (got key=\"" + dst.key + "\", pos=\"" + dst.pos + "\") — FATAL if failing, see report");
      ok(dst.pos === "DST", "team " + id + "'s drafted D/ST carries pos \"DST\" (got \"" + dst.pos + "\") — FATAL if failing, see report");
    }
    // Cascading consequence: can every team fill its lineup?
    const fillable = await page.evaluate(async (ids) => {
      const LG = window.__GFFL__.LG;
      const out = {};
      for (const id of ids) out[id] = LG.canFillLineup(await LG.loadRoster(1, id));
      return out;
    }, REAL_TEAM_IDS);
    for (const id of REAL_TEAM_IDS) {
      ok(fillable[id] === true, "team " + id + "'s imported roster can fill every starting slot (LG.canFillLineup) — FATAL if failing, see report");
    }
    // Cap + IR-eligibility, unconditionally (these should hold regardless of the D/ST finding).
    const capAndIr = await page.evaluate(async (ids) => {
      const LG = window.__GFFL__.LG;
      const out = {};
      for (const id of ids) {
        const ros = await LG.loadRoster(1, id);
        out[id] = { len: ros.length, cap: LG.rosterCap(), irOk: ros.filter((p) => p.slot === "IR").every((p) => LG.irEligible(LG.injuryOf ? LG.injuryOf(p) : p.injury)) };
      }
      return out;
    }, REAL_TEAM_IDS);
    for (const id of REAL_TEAM_IDS) {
      ok(capAndIr[id].len <= capAndIr[id].cap, "team " + id + ": " + capAndIr[id].len + " players <= cap " + capAndIr[id].cap);
      ok(capAndIr[id].irOk, "team " + id + ": every IR slot (if any) holds only an IR-eligible player");
    }

    // ---- idempotence: running the import a second time changes nothing (canonical key-sorted compare) ----
    head("PART A.5 — idempotence: the import run twice");
    const canon = (ros) => JSON.stringify((ros || []).map((p) => ({ key: p.key, pos: p.pos, team: p.team, slot: p.slot })).sort((a, b) => a.key.localeCompare(b.key)));
    const before2 = {};
    for (const id of REAL_TEAM_IDS) before2[id] = canon(after[id]);
    await page.evaluate(() => window.__GFFL__.UI.show("rules"));
    await page.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 10000 });
    await page.evaluate(() => document.getElementById("draftRostersImport").click());
    await page.waitForSelector("#draftGo", { timeout: 10000 });
    // Sync point: the roster's own version key (bumped by every LG.db.set, lg-core.js's
    // local.bump) rather than the "Draft imported" text — see the FINDING above, the same
    // message-wiped-before-paint bug applies to this second run too.
    const verKey = "lgv_gffl_" + FAM + "_roster_2026_w1_t" + REAL_TEAM_IDS[0];
    const verBefore = await page.evaluate((k) => localStorage.getItem(k), verKey);
    await page.evaluate(() => document.getElementById("draftGo").click());
    await page.waitForFunction((k, v0) => localStorage.getItem(k) !== v0, { timeout: 15000 }, verKey, verBefore);
    const after2 = await page.evaluate(async (ids) => {
      const LG = window.__GFFL__.LG;
      const out = {};
      for (const id of ids) out[id] = await LG.loadRoster(1, id, { fresh: true });
      return out;
    }, REAL_TEAM_IDS);
    let allIdempotent = true;
    for (const id of REAL_TEAM_IDS) if (canon(after2[id]) !== before2[id]) allIdempotent = false;
    ok(allIdempotent, "running the Draft Day Import a second time is a no-op (canonical key-sorted compare, all 8 teams)");

    // ---- PART B, on the same post-import page ----
    await partB(page, "lg_gffl_" + FAM + "_", draftDoc);

    await ctx.close();
  } catch (e) {
    console.error("FATAL harness error:", e && e.stack || e);
    exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
    await new Promise((r) => staticSrv.close(r));
    await new Promise((r) => ffSrv.close(r));
  }

  head("SUITE TOTAL");
  console.log(PASS + " passed, " + FAILS.length + " failed");
  if (FAILS.length) { console.log("\nFAILURES:"); for (const f of FAILS) console.log("  - " + f); }

  // ---- run tools/_gffl_seams.cjs to prove nothing else moved ----
  head("node tools/_gffl_seams.cjs (must stay 121/0 — this file touched no app code)");
  const { spawnSync } = require("child_process");
  const seams = spawnSync(process.execPath, [path.join(__dirname, "_gffl_seams.cjs")], { cwd: ROOT, encoding: "utf8" });
  console.log(seams.stdout || "");
  if (seams.stderr) console.error(seams.stderr);
  const seamsOk = seams.status === 0;
  console.log("_gffl_seams.cjs exit code: " + seams.status);

  process.exit(exitCode || FAILS.length || (seamsOk ? 0 : 1));
}

main();
