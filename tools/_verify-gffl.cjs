// _verify-gffl.cjs — verification for GFFL S1+S2 (league.html + lg-*.js + league.mjs).
//
//   node tools/_verify-gffl.cjs [--shots]
//
// Section A runs the REAL netlify/functions/league.mjs in process against a
// fake ESPN fantasy upstream. Sections B+ drive the REAL league.html in
// headless Chrome: Firebase/gstatic aborted (local backend), Sleeper + ESPN
// site API answered by fixtures with HAND-COMPUTED scoring expectations,
// /.netlify/functions/league answered by the same in-process handler.
// Everything runs under ?fam=test1 — the suite never touches family data.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { pathToFileURL } = require("url");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const SRV_PORT = 8843;
const FF_PORT = 8844;
const TENOR_PORT = 8845;
const BASE = "http://127.0.0.1:" + SRV_PORT;
const SHOTS = process.argv.includes("--shots");

let pass = 0, fail = 0; const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; failures.push(msg); console.log("  ✗ " + msg); }
}
function section(name) { console.log("\n== " + name + " =="); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- fixtures ----------------
const fixture = { phase: 1, sleeperDown: false, espnDown: false };

// -- fake ESPN fantasy upstream (league.mjs import source) --
function ffSettingsDoc() {
  return {
    settings: {
      name: "Nerd Fantasy Football League",
      scoringSettings: { scoringItems: [
        { statId: 53, points: 1 }, { statId: 3, points: 0.04 }, { statId: 4, points: 4 },
        { statId: 20, points: -2 }, { statId: 24, points: 0.1 }, { statId: 25, points: 6 },
        { statId: 42, points: 0.1 }, { statId: 43, points: 6 }, { statId: 72, points: -2 },
        { statId: 80, points: 3 }, { statId: 77, points: 4 }, { statId: 74, points: 5 },
        { statId: 86, points: 1 }, { statId: 99, points: 1 }, { statId: 95, points: 2 },
        { statId: 89, points: 5 }, { statId: 999, points: 7 },
        // Live-league additions (diag 2026-08-07): yardage game bonuses,
        // distance FG misses, offensive fumble-recovery TD.
        { statId: 17, points: 3 }, { statId: 18, points: 4 },
        { statId: 37, points: 3 }, { statId: 38, points: 4 },
        { statId: 56, points: 3 }, { statId: 57, points: 4 },
        { statId: 79, points: -1 }, { statId: 82, points: -1 },
        { statId: 63, points: 6 },
      ]},
      rosterSettings: { lineupSlotCounts: { "0": 1, "2": 2, "4": 2, "6": 1, "23": 1, "16": 1, "17": 1, "20": 7, "21": 1 } },
      scheduleSettings: { matchupPeriodCount: 14, playoffTeamCount: 4 },
      tradeSettings: { revisionHours: 48, vetoVotesRequired: 4 },
      acquisitionSettings: { acquisitionType: "WAIVERS_TRADITIONAL", acquisitionBudget: 100 },
    },
    teams: [
      { id: 1, name: "Battle Kreussers", abbrev: "BK", logo: "https://x.test/bk.png", owners: ["o1"] },
      { id: 2, name: "End Zone Goats", abbrev: "EZG", owners: ["o2"] },
      { id: 3, name: "Wyoming Cowboys", abbrev: "WYO", owners: ["o3"] },
      { id: 4, name: "Waffle House Warriors", abbrev: "WHW", owners: ["o4"] },
      { id: 5, name: "Nails  For Breakfast", abbrev: "NAIL", owners: ["o5"] },
      { id: 6, name: "Team Six", abbrev: "SIX", owners: ["o6"] },
      { id: 7, name: "Team Seven", abbrev: "SEV", owners: ["o7"] },
      // Real ESPN ids are arbitrary (the family league uses 12/3/5); the GFFL
      // team set is DEFINED by the import, so in practice import runs first.
      // The fixture mirrors the seeded ids so merge-by-id is what's tested.
      { id: 8, name: "The Goat Kids", abbrev: "GK", owners: ["o8"] },
    ],
    members: [{ id: "o1", firstName: "Peter", lastName: "K" }],
  };
}
function ffRosterDoc() {
  return {
    teams: [
      { id: 1, name: "Battle Kreussers", roster: { entries: [
        { lineupSlotId: 0, playerPoolEntry: { player: { id: 3915511, fullName: "P. Passer", defaultPositionId: 1, proTeamId: 21, injuryStatus: "ACTIVE" } } },
        { lineupSlotId: 21, playerPoolEntry: { player: { id: 111666, fullName: "I. Injured", defaultPositionId: 3, proTeamId: 12, injuryStatus: "OUT" } } },
      ] } },
    ],
  };
}
function startFfUpstream() {
  const srv = http.createServer((req, res) => {
    const u = req.url;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (u.includes("view=mRoster")) res.end(JSON.stringify(ffRosterDoc()));
    else res.end(JSON.stringify(ffSettingsDoc()));
  });
  return new Promise((r) => srv.listen(FF_PORT, "127.0.0.1", () => r(srv)));
}

// -- fake Tenor (S4 chat GIF search) — 2 fixture results, any query --
function startTenorUpstream() {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ results: [
      { media_formats: { tinygif: { url: "http://tenor.test/goat1.gif" }, nanogif: { url: "http://tenor.test/goat1n.gif" } } },
      { media_formats: { tinygif: { url: "http://tenor.test/goat2.gif" }, nanogif: { url: "http://tenor.test/goat2n.gif" } } },
    ] }));
  });
  return new Promise((r) => srv.listen(TENOR_PORT, "127.0.0.1", () => r(srv)));
}

// -- live-data fixtures (site API + sleeper) --
// Hand-computed vs the GFFL default scoring:
//   Passer  150yd·1TD·1INT·1×2pt      = 6+4-2+2         = 10.0   (p2: 175yd·2TD = 15.0)
//   Receiver 4rec·50yd·1×2pt          = 4+5+2           = 11.0   (p2: 5rec·62yd = 13.2)
//   Rusher  40yd                      = 4.0
//   Kicker  FG 2/3 (one 47yd)·XP 1/1  = 3+4-1+1         = 7.0
//   PHI DST sack2·int1·fum1·pa10      = 2+2+2+3         = 9.0
//   DAL DST sack1·int1·pa14           = 1+2+1           = 4.0
//   Team 1 total (dual OR either-source-alone) = 41.0 → p2 (espn leads) 48.2
const KICK_FUTURE = "2027-01-01T01:00Z";
function sbFix() {
  const mk = (id, awayAb, homeAb, state, extra) => ({
    id, shortName: awayAb + " @ " + homeAb, date: extra.date,
    competitions: [{
      status: { type: { state, shortDetail: extra.detail || "" }, period: extra.period || 0, displayClock: extra.clock || "" },
      competitors: [
        { homeAway: "home", team: { abbreviation: homeAb }, score: extra.hs },
        { homeAway: "away", team: { abbreviation: awayAb }, score: extra.as },
      ],
    }],
  });
  return { events: [
    mk("401900001", "DAL", "PHI", "in", { date: "2026-08-07T00:15Z", detail: "Q2 5:00", period: 2, clock: "5:00", hs: "14", as: "10" }),
    mk("401900002", "KC", "DEN", "pre", { date: KICK_FUTURE, detail: "Sun 12:00 PM" }),
  ] };
}
function ath(id, name, pos, stats) {
  return { athlete: { id, displayName: name, position: { abbreviation: pos } }, stats };
}
function sumAFix() {
  const p2 = fixture.phase >= 2;
  return {
    header: { competitions: [{
      competitors: [
        { homeAway: "home", team: { abbreviation: "PHI" }, score: "14" },
        { homeAway: "away", team: { abbreviation: "DAL" }, score: "10" },
      ],
      status: { period: 2, displayClock: "5:00", type: { state: "in", shortDetail: "Q2 5:00" } },
    }] },
    boxscore: {
      teams: [
        { team: { abbreviation: "DAL" }, statistics: [
          { name: "interceptions", displayValue: "1" }, { name: "sacksYardsLost", displayValue: "2-13" }, { name: "fumblesLost", displayValue: "1" }] },
        { team: { abbreviation: "PHI" }, statistics: [
          { name: "interceptions", displayValue: "1" }, { name: "sacksYardsLost", displayValue: "1-7" }, { name: "fumblesLost", displayValue: "0" }] },
      ],
      players: [
        { team: { abbreviation: "PHI" }, statistics: [
          { name: "passing", labels: ["C/ATT", "YDS", "AVG", "TD", "INT"],
            athletes: [ath("3915511", "P. Passer", "QB", p2 ? ["14/20", "175", "8.8", "2", "1"] : ["12/18", "150", "8.3", "1", "1"])] },
          { name: "receiving", labels: ["REC", "YDS", "AVG", "TD", "LONG", "TGTS"],
            athletes: [ath("4361741", "W. Receiver", "WR", p2 ? ["5", "62", "12.4", "0", "24", "7"] : ["4", "50", "12.5", "0", "24", "6"])] },
        ] },
        { team: { abbreviation: "DAL" }, statistics: [
          { name: "rushing", labels: ["CAR", "YDS", "AVG", "TD"],
            athletes: [ath("4241457", "R. Rusher", "RB", ["9", "40", "4.4", "0"])] },
          { name: "kicking", labels: ["FG", "PCT", "LONG", "XP", "PTS"],
            athletes: [ath("2473037", "K. Kicker", "K", ["2/3", "66.7", "47", "1/1", "8"])] },
        ] },
      ],
    },
    scoringPlays: [
      { type: "FG", text: "K. Kicker 47 Yd Field Goal", team: { abbreviation: "DAL" } },
      { type: "TD", text: "W. Receiver 12 Yd Pass From P. Passer (P. Passer Pass to W. Receiver for Two-Point Conversion)", team: { abbreviation: "PHI" } },
    ],
    drives: { current: { team: { abbreviation: "PHI" }, plays: [{ end: { yardsToEndzone: 12 } }] } },
  };
}
function sumBFix() {
  return { header: { competitions: [{ competitors: [], status: { type: { state: "pre" } } }] }, boxscore: { players: [], teams: [] }, scoringPlays: [] };
}
const slpStateFix = { season: "2026", season_type: "regular", week: 1 };
const slpPlayersFix = {
  "6904": { full_name: "P. Passer", team: "PHI", position: "QB", espn_id: 3915511 },
  "7564": { full_name: "W. Receiver", team: "PHI", position: "WR", espn_id: 4361741 },
  "4866": { full_name: "R. Rusher", team: "DAL", position: "RB", espn_id: 4241457 },
  "1266": { full_name: "K. Kicker", team: "DAL", position: "K", espn_id: 2473037 },
  "9001": { full_name: "T. Tight", team: "KC", position: "TE", espn_id: 111222 },
  "9002": { full_name: "B. Backup", team: "KC", position: "RB", espn_id: 111333 },
  "9003": { full_name: "F. Flexman", team: "DEN", position: "RB", espn_id: 111444 },
  "9004": { full_name: "W. Two", team: "DEN", position: "WR", espn_id: 111555 },
  "9005": { full_name: "I. Injured", team: "KC", position: "WR", espn_id: 111666, injury_status: "Out" },
  "9006": { full_name: "H. Healthy", team: "DEN", position: "WR", espn_id: 111777 },
  "9007": { full_name: "S. Second", team: "DEN", position: "RB", espn_id: 111888 },
  "9101": { full_name: "Q. Rival", team: "DAL", position: "QB", espn_id: 222111 },
  "9102": { full_name: "X. Wideout", team: "PHI", position: "WR", espn_id: 222333 },
  PHI: { first_name: "Philadelphia", last_name: "Eagles", team: "PHI", position: "DEF" },
  DAL: { first_name: "Dallas", last_name: "Cowboys", team: "DAL", position: "DEF" },
  KC: { first_name: "Kansas City", last_name: "Chiefs", team: "KC", position: "DEF" },
  DEN: { first_name: "Denver", last_name: "Broncos", team: "DEN", position: "DEF" },
};
function slpStatsFix() {
  return {
    "6904": { pass_yd: 150, pass_td: 1, pass_int: 1, pass_2pt: 1, pts_ppr: 12 },
    "7564": { rec: 4, rec_yd: 50, rec_2pt: 1, pts_ppr: 11 },
    "4866": { rush_yd: 40, pts_ppr: 4 },
    "1266": { fgm_20_29: 1, fgm_40_49: 1, fgmiss: 1, xpm: 1 },
    PHI: { pts_allow: 10, sack: 2, int: 1, fum_rec: 1 },
    DAL: { pts_allow: 14, sack: 1, int: 1 },
  };
}
const slpProjFix = { "9001": { rec: 4, rec_yd: 45 } }; // TE proj 4 + 4.5 = 8.5

// ---------------- seeds (the local backend's docs) ----------------
const FAM = "test1";
const LSPFX = "lg_gffl_" + FAM + "_";
const SEED_RULES = null; // page defaults are used; suite reads them back via hook
function seedTeams() {
  const names = ["Battle Kreussers", "End Zone Goats", "Wyoming Cowboys", "Waffle House Warriors",
    "Nails  For Breakfast", "Team Six", "Team Seven", "The Goat Kids"];
  const out = {};
  names.forEach((n, i) => { out["team_" + (i + 1)] = { kind: "team", teamId: i + 1, name: n, abbrev: "T" + (i + 1), owner: "" }; });
  return out;
}
function seedSchedule() {
  return { kind: "sched", season: 2026, weeks: [[[1, 2], [3, 4], [5, 6], [7, 8]]] };
}
function seedRosterT1() {
  return { kind: "roster", week: 1, teamId: 1, players: [
    { key: "3915511", name: "P. Passer", pos: "QB", team: "PHI", slot: "QB" },
    { key: "4241457", name: "R. Rusher", pos: "RB", team: "DAL", slot: "RB" },
    { key: "111888", name: "S. Second", pos: "RB", team: "DEN", slot: "RB" },
    { key: "4361741", name: "W. Receiver", pos: "WR", team: "PHI", slot: "WR" },
    { key: "111555", name: "W. Two", pos: "WR", team: "DEN", slot: "WR" },
    { key: "111222", name: "T. Tight", pos: "TE", team: "KC", slot: "TE" },
    { key: "111444", name: "F. Flexman", pos: "RB", team: "DEN", slot: "FLEX" },
    { key: "dst_PHI", name: "PHI D/ST", pos: "DST", team: "PHI", slot: "DST" },
    { key: "2473037", name: "K. Kicker", pos: "K", team: "DAL", slot: "K" },
    { key: "111333", name: "B. Backup", pos: "RB", team: "KC", slot: "BENCH" },
    { key: "111666", name: "I. Injured", pos: "WR", team: "KC", slot: "BENCH", injury: "Out" },
    { key: "111777", name: "H. Healthy", pos: "WR", team: "DEN", slot: "BENCH" },
  ] };
}
function seedRosterT2() {
  return { kind: "roster", week: 1, teamId: 2, players: [
    { key: "222111", name: "Q. Rival", pos: "QB", team: "DAL", slot: "QB" },
    { key: "222333", name: "X. Wideout", pos: "WR", team: "PHI", slot: "WR" },
    { key: "dst_DAL", name: "DAL D/ST", pos: "DST", team: "DAL", slot: "DST" },
  ] };
}
function fullSeed(opts) {
  opts = opts || {};
  const docs = { settings: undefined, ...seedTeams(), ["sched_2026"]: seedSchedule(), ["roster_2026_w1_t1"]: seedRosterT1(), ["roster_2026_w1_t2"]: seedRosterT2() };
  delete docs.settings;
  return {
    docs, pass: opts.gate ? null : "amenfarms",
    team: opts.claim ? null : 1, who: opts.claim ? null : "Peter",
  };
}

// ---------------- plumbing ----------------
function startStatic() {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html");
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end("nope"); return; }
    const mime = { ".html": "text/html", ".js": "text/javascript" }[path.extname(p)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(fs.readFileSync(p));
  });
  return new Promise((r) => srv.listen(SRV_PORT, "127.0.0.1", () => r(srv)));
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

let leagueFn; // in-process handler
async function newTestPage(browser, seed, opts) {
  opts = opts || {};
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(opts.vw || { width: 390, height: 844 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument((seed, pfx) => {
    window.__prompts = ["Peter"]; // claim name; later prompts (PIN) fall to "1234"
    window.prompt = () => (window.__prompts.length ? window.__prompts.shift() : "1234");
    window.alert = () => {}; window.confirm = () => true;
    try {
      if (seed.pass) localStorage.setItem("gffl_pass", seed.pass);
      if (seed.team) localStorage.setItem("gffl_team", String(seed.team));
      if (seed.who) localStorage.setItem("gffl_who", seed.who);
      for (const id of Object.keys(seed.docs || {})) localStorage.setItem(pfx + id, JSON.stringify(seed.docs[id]));
    } catch (e) {}
  }, seed || { docs: {} }, LSPFX);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    const cors = { "Access-Control-Allow-Origin": "*" };
    const json = (obj, status) => req.respond({ status: status || 200, contentType: "application/json", headers: cors, body: JSON.stringify(obj) });
    (async () => {
      try {
        if (u.includes("/.netlify/functions/league")) {
          const r = await leagueFn(new Request("http://fn/league", { method: "POST", body: req.postData() || "{}" }));
          return req.respond({ status: r.status, contentType: "application/json", headers: cors, body: await r.text() });
        }
        if (u.startsWith(BASE)) return req.continue();
        if (/gstatic|googleapis|firebase/.test(u)) return req.abort();
        if (u.includes("site.api.espn.com")) {
          if (fixture.espnDown) return req.respond({ status: 503, headers: cors, body: "{}" });
          if (u.includes("/scoreboard")) return json(sbFix());
          if (u.includes("event=401900001")) return json(sumAFix());
          if (u.includes("event=401900002")) return json(sumBFix());
          return json({});
        }
        if (u.includes("api.sleeper.app")) {
          if (fixture.sleeperDown) return req.respond({ status: 503, headers: cors, body: "{}" });
          if (u.endsWith("/state/nfl")) return json(slpStateFix);
          if (u.endsWith("/players/nfl")) return json(slpPlayersFix);
          if (u.includes("/stats/nfl/")) return json(slpStatsFix());
          if (u.includes("/projections/nfl/")) return json(slpProjFix);
          return json({});
        }
        return req.abort();
      } catch (e) { /* page closed mid-flight */ }
    })();
  });
  return { ctx, page, errors };
}
async function bootPage(page) {
  await page.goto(BASE + "/league.html?fam=" + FAM, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__GFFL__ && window.__GFFL__.LG.rules, { timeout: 9000 });
}
const poll = (page) => page.evaluate(() => window.__GFFL__.D.pollOnce());
const stopPolling = (page) => page.evaluate(() => window.__GFFL__.D.stop());
async function waitLive(page) {
  try {
    await page.waitForFunction(() => {
      const d = window.__GFFL__.D;
      return d && d.S.players.size > 0 && d.S.slpSeeded && d.S.espnSeeded;
    }, { timeout: 10000 });
  } catch (e) {
    const dump = await page.evaluate(() => {
      const d = window.__GFFL__.D;
      return {
        players: d.S.players.size, slpSeeded: d.S.slpSeeded, espnSeeded: d.S.espnSeeded,
        tracked: [...d.S.tracked], games: [...d.S.games.entries()].map(([k, g]) => k + ":" + g.state),
        bucket: d.S.slpBucket, health: d.S.health,
        eps: Object.fromEntries(Object.entries(d.EP).map(([k, v]) => [k, v.status + " n" + v.n + " " + (v.err || "")])),
        teams: window.__GFFL__.LG.teams.length,
      };
    }).catch(() => "page gone");
    console.log("  DEBUG waitLive:", JSON.stringify(dump, null, 1));
    throw e;
  }
  await stopPolling(page);
  await poll(page); // one controlled extra pass so merge/paint settle
}
const text = (page, sel) => page.$eval(sel, (el) => el.textContent).catch(() => null);
const readDoc = (page, id) => page.evaluate((k) => { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }, LSPFX + id);
// Whole-dataset snapshot — the local backend is per-context storage, so a
// "second device" (chat/lockers spanning two browser contexts) is simulated
// by handing a fresh context the FULL current doc set, same trick Section I
// already uses for a single claims doc, generalized to every doc kind
// (chat messages have dynamic ids, so a single readDoc() can't target them).
const snapshotAllDocs = (page) => page.evaluate((pfx) => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(pfx)) out[k.slice(pfx.length)] = JSON.parse(localStorage.getItem(k));
  }
  return out;
}, LSPFX);
// A snapshot MERGE (used above) can't represent a deletion — a key simply
// absent from the snapshot is left untouched on the target. This clears the
// target's whole doc set first, so a delete propagates like it would through
// a real shared store.
const replaceAllDocs = (page, docs) => page.evaluate((docs, pfx) => {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(pfx)) localStorage.removeItem(k);
  }
  for (const id of Object.keys(docs)) localStorage.setItem(pfx + id, JSON.stringify(docs[id]));
}, docs, LSPFX);
const clickIn = (page, sel, filterText) => page.evaluate((sel, ft) => {
  const els = [...document.querySelectorAll(sel)];
  const el = ft ? els.find((e) => e.textContent.includes(ft)) : els[0];
  if (!el) return false;
  el.click(); return true;
}, sel, filterText || null);

// ---------------- main ----------------
(async () => {
  // Section A: the real function, in process, against the fake upstream.
  section("A · league.mjs — ESPN import actions");
  const ffSrv = await startFfUpstream();
  const tenorSrv = await startTenorUpstream();
  process.env.SPORTS_FF_BASE_URL = "http://127.0.0.1:" + FF_PORT;
  process.env.BUCKY_NOTIFY_SECRET = "amenfarms";
  process.env.ESPN_S2 = "s2test"; process.env.ESPN_SWID = "{SWID-TEST}";
  const mod = await import(pathToFileURL(path.join(ROOT, "netlify/functions/league.mjs")).href);
  leagueFn = mod.default;
  const call = async (body) => { const r = await leagueFn(new Request("http://fn/", { method: "POST", body: JSON.stringify(body) })); return { status: r.status, j: JSON.parse(await r.text()) }; };
  {
    const { j } = await call({ secret: "amenfarms", action: "lg_espn_settings" });
    ok(j.ok === true && j.leagueName === "Nerd Fantasy Football League", "settings import reaches the league (" + j.leagueName + ")");
    ok(j.scoring.rec === 1 && j.scoring.pass_yd === 0.04 && j.scoring.fg_50 === 5 && j.scoring.dst_sack === 1 && j.scoring.dst_pa_0 === 5,
      "scoring items map to normalized keys (rec/pass_yd/fg_50/dst_sack/dst_pa_0)");
    ok(j.unmapped.length === 1 && j.unmapped[0].statId === 999, "unknown scoring item surfaces in `unmapped`, never dropped");
    ok(j.scoring.bonus_pass_300 === 3 && j.scoring.bonus_pass_400 === 4 && j.scoring.bonus_rush_100 === 3 &&
       j.scoring.bonus_rec_200 === 4 && j.scoring.fg_miss === -1 && j.scoring.off_fum_td === 6,
      "live-league additions map: yardage game bonuses + distance FG misses + off fum TD");
    ok(j.slots.QB === 1 && j.slots.RB === 2 && j.slots.FLEX === 1 && j.slots.BENCH === 7 && j.slots.IR === 1,
      "roster slots decoded from ESPN slot ids (incl. their 1 IR — we override to 3 client-side)");
    ok(j.regularSeasonWeeks === 14 && j.trade.reviewHours === 48 && j.trade.vetoVotesRequired === 4,
      "season length + ESPN-standard trade rules come through");
    ok(j.teams.length === 8 && j.teams.some((t) => t.name === "Nails  For Breakfast"),
      "8 teams incl. the literal double-space name, untouched");
    const bad = await call({ secret: "wrong", action: "lg_espn_settings" });
    ok(bad.status === 401, "wrong secret → 401");
    const s2 = process.env.ESPN_S2; delete process.env.ESPN_S2;
    const noCookie = await call({ secret: "amenfarms", action: "lg_espn_settings" });
    ok(noCookie.j.ok === false && noCookie.j.reason === "fantasy-not-configured", "missing cookies → fantasy-not-configured");
    process.env.ESPN_S2 = s2;
    const ros = await call({ secret: "amenfarms", action: "lg_espn_rosters" });
    ok(ros.j.ok && ros.j.teams[0].players[0].espnId === 3915511 && ros.j.teams[0].players[0].proTeam === "PHI",
      "roster import: espn ids + pro teams decoded");
    ok(ros.j.teams[0].players[1].lineupSlot === "IR" && ros.j.teams[0].players[1].injury === "OUT",
      "roster import: IR slot + injury status carried");
    const unk = await call({ secret: "amenfarms", action: "nope" });
    ok(unk.j.ok === false && unk.j.reason === "unknown-action", "unknown action refused");

    // S4 · Tenor GIF search proxy — no key, then keyed against the fake upstream.
    const noKey = await call({ secret: "amenfarms", action: "lg_gif_search", q: "goat" });
    ok(noKey.j.ok === false && noKey.j.reason === "gif-not-configured", "gif search with no TENOR_API_KEY -> gif-not-configured, never a 500");
    process.env.TENOR_API_KEY = "testkey";
    process.env.TENOR_BASE_URL = "http://127.0.0.1:" + TENOR_PORT;
    const empty = await call({ secret: "amenfarms", action: "lg_gif_search", q: "" });
    ok(empty.j.ok === true && Array.isArray(empty.j.gifs) && empty.j.gifs.length === 0, "empty query short-circuits to an empty result without hitting Tenor");
    const gif = await call({ secret: "amenfarms", action: "lg_gif_search", q: "goat" });
    ok(gif.j.ok === true && gif.j.gifs.length === 2 && gif.j.gifs[0].url === "http://tenor.test/goat1.gif" && gif.j.gifs[0].preview === "http://tenor.test/goat1n.gif",
      "gif search maps tenor's tinygif/nanogif into {url,preview}");
    delete process.env.TENOR_API_KEY;
  }

  const srv = await startStatic();
  const browser = await launchBrowser();

  // ---- B: gate + claim ----
  section("B · gate + team claim");
  {
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed({ gate: true, claim: true }));
    await page.goto(BASE + "/league.html?fam=" + FAM, { waitUntil: "networkidle0" });
    await page.waitForSelector("#gatePass", { timeout: 9000 });
    ok(true, "locked device lands on the passphrase gate");
    await page.type("#gatePass", "wrong");
    await page.click("#gateGo");
    ok(!(await page.$eval("#gateErr", (e) => e.hidden)), "wrong passphrase is refused");
    await page.$eval("#gatePass", (e) => { e.value = ""; });
    await page.type("#gatePass", "amenfarms");
    await page.click("#gateGo");
    await page.waitForSelector(".teamrow", { timeout: 9000 });
    ok((await page.$$eval(".teamrow", (els) => els.length)) === 8, "claim screen lists all 8 teams");
    await clickIn(page, ".teamrow", "Battle Kreussers");
    await page.waitForSelector(".mucard", { timeout: 9000 });
    ok(true, "claiming a team (prompted name) lands in the league");
    const persisted = await page.evaluate(() => [localStorage.getItem("gffl_team"), localStorage.getItem("gffl_who")]);
    ok(persisted[0] === "1" && persisted[1] === "Peter", "claim persisted (team 1, Peter)");
    ok(errors.length === 0, "0 page errors through gate + claim");
    await ctx.close();
  }

  // ---- B2: first run — an EMPTY league must guide, not blank ----
  // Live 2026-08-07: a fresh device (no teams doc yet) skipped the claim
  // screen (nothing to claim) and landed on an empty home with no way in.
  section("B2 · first run — empty league → import → claim");
  {
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: null, who: null });
    await page.goto(BASE + "/league.html?fam=" + FAM, { waitUntil: "networkidle0" });
    await page.waitForSelector("#firstImport", { timeout: 9000 });
    ok(true, "empty league lands on the setup card, not a blank home");
    const body0 = await page.evaluate(() => document.body.textContent);
    ok(/isn't set up yet/.test(body0), "…and says why in plain words");
    // Prompt order: commissioner PIN (create-on-first-use), then the claim name.
    await page.evaluate(() => { window.__prompts = ["4321", "Peter"]; });
    await clickIn(page, "#firstImport");
    await page.waitForSelector("#importApply", { timeout: 9000 });
    ok(true, "setup button gates the PIN and walks straight into the ESPN import preview");
    await clickIn(page, "#importApply");
    await page.waitForSelector(".teamrow", { timeout: 9000 });
    ok((await page.$$eval(".teamrow", (els) => els.length)) === 8, "Apply lands on the CLAIM screen with all 8 imported teams");
    await clickIn(page, ".teamrow", "Battle Kreussers");
    await page.waitForSelector(".mucard, .tbl", { timeout: 9000 });
    const persisted = await page.evaluate(() => [localStorage.getItem("gffl_team"), localStorage.getItem("gffl_who")]);
    ok(persisted[0] === "1" && persisted[1] === "Peter", "claim persisted after the first-run flow (team 1, Peter)");
    ok(errors.length === 0, "0 page errors through import-then-claim");
    await ctx.close();
  }

  // ---- C: league home, live totals ----
  section("C · league home — matchup cards + standings + hand-computed totals");
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    ok((await page.$$eval(".mucard", (els) => els.length)) === 4, "week 1 shows 4 matchup cards");
    ok(await page.$(".mucard.mine"), "my matchup is outlined");
    ok((await page.$$eval(".tbl tbody tr", (els) => els.length)) >= 8, "standings list all 8 teams");
    await waitLive(page);
    await page.evaluate(() => window.__GFFL__.UI.renderLeague());
    await sleep(60);
    const score = await text(page, ".mucard.mine .muscore");
    ok(score === "4.0 — 41.0", "my card totals hand-computed: away 4.0 — home 41.0 (" + score + ")");
    const chip = await text(page, "#healthChip");
    ok(/● live/.test(chip || ""), "health chip reads live in dual mode");
    ok(errors.length === 0, "0 page errors on league home");
    await ctx.close();
  }

  // ---- D: matchup page ----
  section("D · matchup — the heart");
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await clickIn(page, ".mucard.mine");
    await page.waitForSelector(".muhead", { timeout: 9000 });
    const pts = await page.$$eval(".bigpts", (els) => els.map((e) => e.textContent));
    ok(pts[0] === "4.0" && pts[1] === "41.0", "header totals away 4.0 / home 41.0 (" + pts.join("/") + ")");
    ok((await page.$$eval(".mutable tbody tr", (els) => els.length)) === 9, "9 slot rows (QB RB RB WR WR TE FLEX DST K)");
    const passerCell = await page.evaluate(() => {
      const tr = [...document.querySelectorAll(".mutable tbody tr")].find((r) => r.textContent.includes("P. Passer"));
      return tr ? tr.textContent : "";
    });
    ok(/10\.0/.test(passerCell), "Passer live points 10.0 (150yd+TD-INT+2pt, hand-computed)");
    ok(/Q2 5:00/.test(passerCell), "Passer cell carries the live clock");
    ok(/🔴/.test(passerCell), "red-zone flag on the PHI starter (drive inside the 20)");
    ok(!/⚠/.test(passerCell), "no conflict flag during ordinary live source lag");
    const remain = await page.evaluate(() => [...document.querySelectorAll(".muhteam")].map((e) => e.textContent).join("|"));
    ok(/4 to play · 5 live/.test(remain), "players-remaining clock: 4 to play · 5 live");
    const wp = await page.$eval(".wpfill", (e) => parseFloat(e.style.width));
    ok(wp >= 1 && wp < 40, "win-prob bar: away side trailing 4.0-41.0 reads a low chance (" + wp + "%)");
    // Phase 2: ESPN reports new stats.
    fixture.phase = 2;
    await poll(page);
    const pts2 = await page.$$eval(".bigpts", (els) => els.map((e) => e.textContent));
    ok(pts2[1] === "48.2", "totals move with the freshest source: home now 48.2");
    const feed = await text(page, "#mufeed");
    ok(/P\. Passer/.test(feed) && /pass TD 1→2/.test(feed) && /\+4\.0/.test(feed),
      "feed logs the TD with its fantasy delta (+4.0)");
    ok(/rec yds 50→62/.test(feed) && /\+1\.2/.test(feed), "feed logs the catch yardage (+1.2)");
    ok(errors.length === 0, "0 page errors on the matchup page");
    if (SHOTS) { fs.mkdirSync(path.join(ROOT, "shots"), { recursive: true }); await page.screenshot({ path: path.join(ROOT, "shots", "gffl_matchup_390.png"), fullPage: true }); console.log("  📸 shots/gffl_matchup_390.png"); }
    await ctx.close();
  }

  // ---- E: team page — lineup, locks, IR ----
  section("E · my team — lineup editing, kickoff locks, 3 IR spots");
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(() => window.__GFFL__.UI.show("team"));
    await page.waitForSelector(".lrow", { timeout: 9000 });
    const starters = await page.$$eval(".card:nth-of-type(2) .lrow", (els) => els.length);
    ok(starters === 9, "9 starter slots rendered");
    const locked = await page.$$eval(".lrow.locked", (els) => els.map((e) => e.textContent));
    ok(locked.length === 5 && locked.every((t) => t.includes("🔒")), "5 starters locked (their game is live) with 🔒");
    ok(/0\/3/.test(await page.evaluate(() => document.body.textContent)), "IR shows 0/3 — the league's 3 IR spots");
    const tightRow = await page.evaluate(() => {
      const el = [...document.querySelectorAll(".lrow")].find((r) => r.textContent.includes("T. Tight"));
      return el ? el.textContent : "";
    });
    ok(/proj 8\.5/.test(tightRow), "projection column league-scored from Sleeper proj stats (TE 8.5)");
    // Locked tap refuses.
    await page.evaluate(() => { [...document.querySelectorAll(".lrow")].find((r) => r.textContent.includes("P. Passer")).click(); });
    ok(/🔒/.test(await text(page, "#toast")), "tapping a locked starter toasts instead of opening the sheet");
    // Injured bench player -> IR.
    await page.evaluate(() => { [...document.querySelectorAll(".lrow")].find((r) => r.textContent.includes("I. Injured")).click(); });
    await page.waitForSelector(".swaprow", { timeout: 5000 });
    const opts1 = await page.$$eval(".swaprow", (els) => els.map((e) => e.textContent));
    ok(opts1.some((t) => t.includes("→ IR")), "OUT player's move sheet offers IR");
    await page.evaluate(() => { [...document.querySelectorAll(".swaprow")].find((r) => r.textContent.includes("→ IR")).click(); });
    await page.waitForFunction(() => document.body.textContent.includes("1/3"), { timeout: 5000 });
    ok(true, "moved to IR — 1/3");
    const irDoc = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LSPFX + "roster_2026_w1_t1");
    ok(irDoc.players.find((p) => p.name === "I. Injured").slot === "IR", "IR move persisted to the roster doc");
    // Healthy bench player gets no IR option.
    await page.evaluate(() => { [...document.querySelectorAll(".lrow")].find((r) => r.textContent.includes("H. Healthy")).click(); });
    await page.waitForSelector(".swaprow", { timeout: 5000 });
    const opts2 = await page.$$eval(".swaprow", (els) => els.map((e) => e.textContent));
    ok(!opts2.some((t) => t.includes("→ IR")), "healthy player is NOT IR-eligible");
    ok(opts2.some((t) => t.includes("→ WR")), "…but can move into a WR slot");
    await page.evaluate(() => { [...document.querySelectorAll(".swaprow")].find((r) => r.textContent.includes("Cancel")).click(); });
    // FLEX swap: unlocked starter <-> eligible bench.
    await page.evaluate(() => { [...document.querySelectorAll(".lrow")].find((r) => r.textContent.includes("F. Flexman")).click(); });
    await page.waitForSelector(".swaprow", { timeout: 5000 });
    const cands = await page.$$eval(".swaprow", (els) => els.map((e) => e.textContent));
    ok(cands.some((t) => t.includes("B. Backup")), "FLEX swap sheet offers the RB on the bench");
    ok(!cands.some((t) => t.includes("P. Passer")), "…and never a QB (ineligible for FLEX)");
    await page.evaluate(() => { [...document.querySelectorAll(".swaprow")].find((r) => r.textContent.includes("B. Backup")).click(); });
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll(".lrow")];
      const flex = rows.find((r) => r.textContent.includes("FLEX"));
      return flex && flex.textContent.includes("B. Backup");
    }, { timeout: 5000 });
    const doc2 = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LSPFX + "roster_2026_w1_t1");
    ok(doc2.players.find((p) => p.name === "B. Backup").slot === "FLEX" &&
       doc2.players.find((p) => p.name === "F. Flexman").slot === "BENCH",
      "FLEX swap persisted both directions");
    ok(errors.length === 0, "0 page errors on the team page");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_team_390.png"), fullPage: true }); console.log("  📸 shots/gffl_team_390.png"); }
    await ctx.close();
  }

  // ---- F: rules — view, edit, versioning, import, schedule ----
  section("F · rules — editable, versioned, ESPN-importable");
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(() => window.__GFFL__.UI.show("rules"));
    await page.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 5000 });
    const summary = await page.evaluate(() => document.body.textContent);
    ok(/FAAB \$100/.test(summary), "summary: FAAB $100");
    ok(/5-team playoffs \(top 3 get byes, 4v5 play-in\)/.test(summary), "summary: the decided 5-team playoff format");
    ok(/max 3, cost = last round −1/.test(summary), "summary: the family keeper rule from the draft app");
    ok(/48h review, 4 votes veto/.test(summary), "summary: ESPN-standard trade rules");
    // Edit (commissioner PIN prompt -> stub "1234" creates + unlocks).
    await clickIn(page, "#rulesEdit");
    await page.waitForSelector(".redit", { timeout: 5000 });
    await page.evaluate(() => {
      const inp = [...document.querySelectorAll(".redit")].find((i) => i.dataset.k === "scoring.rec");
      inp.value = "0.5";
    });
    await clickIn(page, "#rulesEdit"); // now Save
    await page.waitForFunction(() => (window.__GFFL__.LG.rulesDoc || {}).v >= 1, { timeout: 5000 });
    const doc = await page.evaluate(() => window.__GFFL__.LG.rulesDoc);
    ok(doc.rules.scoring.rec === 0.5, "scoring edit saved (rec 1 → 0.5)");
    ok(doc.log.length >= 1 && doc.log[doc.log.length - 1].changes.some((c) => /scoring\.rec: 1 → 0\.5/.test(c)),
      "change logged with before → after");
    const newPts = await page.evaluate(() => {
      const d = window.__GFFL__.D;
      return d.score(d.S.players.get("4361741").slp.stats);
    });
    ok(newPts === 9, "the scoring engine reads the edited doc live (Receiver 11.0 → 9.0 at half-PPR)");
    // Yardage game bonuses: mutually-exclusive brackets, exactly as ESPN
    // applies them (a 410-yd game earns the 400 bonus, NOT 300+400).
    const bonusChecks = await page.evaluate(() => {
      const d = window.__GFFL__.D;
      const sc = { bonus_pass_300: 3, bonus_pass_400: 4, bonus_rush_100: 3, bonus_rush_200: 4, bonus_rec_100: 3, bonus_rec_200: 4 };
      return [
        d.score({ pass_yd: 299 }, sc),
        d.score({ pass_yd: 320 }, sc),
        d.score({ pass_yd: 410 }, sc),
        d.score({ rush_yd: 150, rec_yd: 205 }, sc),
      ].join(",");
    });
    ok(bonusChecks === "0,3,4,7", "yardage bonuses bracket correctly (299→0 · 320→+3 · 410→+4 only · 150ru+205rec→3+4) [" + bonusChecks + "]");
    // ESPN import.
    await page.waitForFunction(() => document.body.textContent.includes("Change log"), { timeout: 5000 });
    await clickIn(page, "#rulesImport");
    await page.waitForSelector("#importApply", { timeout: 8000 });
    const impText = await page.evaluate(() => document.querySelector("#importOut").textContent);
    ok(/Nerd Fantasy Football League/.test(impText), "import previews the real league by name");
    ok(/Unmapped scoring items/.test(impText) && /999/.test(impText), "unmapped scoring items surfaced for review");
    await clickIn(page, "#importApply");
    await page.waitForFunction(() => window.__GFFL__.LG.rules.scoring.rec === 1, { timeout: 8000 });
    const r2 = await page.evaluate(() => window.__GFFL__.LG.rules);
    ok(r2.roster.IR === 3, "import keeps the GFFL decision: 3 IR spots (ESPN said 1)");
    ok(r2.playoffs.teams === 5, "import never touches the decided 5-team playoff format");
    ok(r2.trades.reviewHours === 48 && r2.trades.vetoVotes === 4, "ESPN-standard trade rules adopted from the real league");
    const teams2 = await page.evaluate(() => window.__GFFL__.LG.teams.map((t) => t.name));
    ok(teams2.includes("Nails  For Breakfast") && teams2.length === 8, "teams refreshed from ESPN (8, double-space intact)");
    // Schedule regenerate + validity.
    await clickIn(page, "#schedGen");
    await page.waitForFunction(() => document.body.textContent.includes("Schedule saved"), { timeout: 6000 });
    const sched = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).weeks, LSPFX + "sched_2026");
    ok(sched.length === 14, "schedule: 14 weeks");
    ok(sched.every((w) => w.length === 4), "schedule: 4 games every week");
    const pairCount = {}; let everyTeamOnce = true;
    for (const wk of sched) {
      const seen = new Set();
      for (const [h, a] of wk) {
        seen.add(h); seen.add(a);
        const key = [Math.min(h, a), Math.max(h, a)].join("-");
        pairCount[key] = (pairCount[key] || 0) + 1;
      }
      if (seen.size !== 8) everyTeamOnce = false;
    }
    ok(everyTeamOnce, "schedule: every team plays exactly once per week");
    ok(Object.values(pairCount).every((n) => n === 2) && Object.keys(pairCount).length === 28,
      "schedule: true double round robin (every pair exactly twice)");
    ok(errors.length === 0, "0 page errors through rules/import/schedule");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_rules_390.png"), fullPage: true }); console.log("  📸 shots/gffl_rules_390.png"); }
    await ctx.close();
  }

  // ---- G: failover ----
  section("G · resilience — either source alone runs the league");
  {
    // Sleeper down from the start -> espn-only, same hand-computed totals.
    fixture.phase = 1; fixture.sleeperDown = true; fixture.espnDown = false;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await page.waitForFunction(() => window.__GFFL__.D.S.espnSeeded, { timeout: 10000 });
    await stopPolling(page);
    await poll(page); await poll(page); await poll(page);
    const mode = await page.evaluate(() => window.__GFFL__.D.S.health.mode);
    ok(mode === "espn-only", "3 failed Sleeper polls flip the state machine to espn-only");
    await page.evaluate(() => window.__GFFL__.UI.renderLeague());
    await sleep(60);
    ok(/ESPN only/.test(await text(page, "#healthChip")), "degraded mode announces itself in the health chip");
    const score = await text(page, ".mucard.mine .muscore");
    ok(score === "4.0 — 41.0", "ESPN ALONE reproduces the exact totals — incl. derived DST + FG distances + 2-pt (" + score + ")");
    const dst = await page.evaluate(() => { const r = window.__GFFL__.D.S.players.get("dst_PHI"); return r && r.pts; });
    ok(dst === 9, "PHI D/ST = 9.0 derived from the opponent's box + scoring plays + score");
    ok(errors.length === 0, "0 page errors in espn-only mode");
    await ctx.close();
  }
  {
    // ESPN down from the start -> sleeper-only.
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = true;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForFunction(() => window.__GFFL__.D.S.slpSeeded, { timeout: 10000 });
    await stopPolling(page);
    await poll(page); await poll(page); await poll(page);
    ok((await page.evaluate(() => window.__GFFL__.D.S.health.mode)) === "sleeper-only", "ESPN dead → sleeper-only mode");
    await page.evaluate(() => window.__GFFL__.UI.renderLeague());
    await sleep(60);
    ok(/Sleeper only/.test(await text(page, "#healthChip")), "banner names the surviving source");
    const score = await text(page, ".mucard.mine .muscore");
    ok(score === "4.0 — 41.0", "Sleeper ALONE also reproduces the exact totals (" + score + ")");
    ok(errors.length === 0, "0 page errors in sleeper-only mode");
    await ctx.close();
  }
  {
    // Both down -> honest STALE state, never fabricated numbers.
    fixture.sleeperDown = true; fixture.espnDown = true;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await stopPolling(page);
    await poll(page); await poll(page); await poll(page);
    ok((await page.evaluate(() => window.__GFFL__.D.S.health.mode)) === "none", "both sources dead → mode none");
    await page.evaluate(() => window.__GFFL__.UI.renderLeague());
    await sleep(60);
    ok(/STALE/.test(await text(page, "#healthChip")), "the page says STALE out loud");
    ok(errors.length === 0, "0 page errors with everything down");
    await ctx.close();
    fixture.sleeperDown = false; fixture.espnDown = false;
  }

  // ---- H: desktop ----
  section("H · desktop");
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed(), { vw: { width: 1280, height: 900 } });
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await clickIn(page, ".mucard.mine");
    await page.waitForSelector(".muhead", { timeout: 9000 });
    const scroll = await page.evaluate(() => ({ b: document.body.scrollWidth, w: window.innerWidth }));
    ok(scroll.b <= scroll.w + 1, "no sideways scroll at 1280px (" + scroll.b + "/" + scroll.w + ")");
    ok(errors.length === 0, "0 page errors on desktop");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_matchup_desktop.png"), fullPage: true }); console.log("  📸 shots/gffl_matchup_desktop.png"); }
    await ctx.close();
  }
  {
    const { ctx, page } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const scroll = await page.evaluate(() => ({ b: document.body.scrollWidth, w: window.innerWidth }));
    ok(scroll.b <= scroll.w + 1, "no sideways scroll at 390px (" + scroll.b + "/" + scroll.w + ")");
    await ctx.close();
  }

  // ---- I: waivers (FAAB) — blind claims, tie-break, FAAB math, auto-process ----
  section("I · waivers — blind claims, FAAB bids, deadline, idempotency");
  {
    // I1: claim → MY PENDING on the claiming device; the other team's own
    // device (same underlying claims doc, seeded independently) never shows
    // it pre-processing — blind by UI convention, not storage isolation.
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    const { ctx: ctx1, page: page1, errors: err1 } = await newTestPage(browser, fullSeed());
    await bootPage(page1);
    await page1.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page1);
    await page1.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page1.waitForSelector("#faSearch", { timeout: 9000 });
    await page1.type("#faSearch", "dst");
    await page1.waitForFunction(() => document.querySelectorAll("#faResults [data-fi]").length > 0, { timeout: 5000 });
    await clickIn(page1, "#faResults [data-fi]", "KC D/ST");
    await page1.waitForSelector("#claimSheet [data-di]", { timeout: 5000 });
    await clickIn(page1, "#claimSheet [data-di]", "B. Backup");
    await page1.$eval("#claimBid", (el) => { el.value = "25"; });
    await clickIn(page1, "#claimGo");
    await page1.waitForFunction(() => (document.querySelector("#mvMyClaims") || {}).textContent && document.querySelector("#mvMyClaims").textContent.includes("KC D/ST"), { timeout: 5000 });
    ok(true, "claim submitted via search+sheet shows in MY PENDING on the claiming device");
    ok(/\$25/.test(await text(page1, "#mvMyClaims")), "…with the bid amount shown");
    const claimsDoc = await readDoc(page1, "claims_2026_w1");
    ok(claimsDoc && claimsDoc.claims.length === 1 && claimsDoc.claims[0].bid === 25 && claimsDoc.claims[0].teamId === 1,
      "claims doc persisted (team 1, $25, unprocessed)");

    const base2 = fullSeed();
    const { ctx: ctx2, page: page2, errors: err2 } = await newTestPage(browser,
      { docs: { ...base2.docs, claims_2026_w1: claimsDoc }, pass: "amenfarms", team: 2, who: "Rival" });
    await bootPage(page2);
    await page2.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page2);
    await page2.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page2.waitForSelector("#faSearch", { timeout: 9000 });
    ok(/No pending claims/.test((await text(page2, "#mvMyClaims")) || ""), "the OTHER team's own device shows nothing pending (blind)");
    const p2body = await page2.evaluate(() => document.body.textContent);
    ok(!p2body.includes("$25"), "…and the bid amount never leaks to their screen");
    ok(err1.length === 0 && err2.length === 0, "0 page errors across both devices");
    await ctx1.close(); await ctx2.close();
  }

  // I2: processWaivers correctness — bid comparison, standings tie-break,
  // insufficient FAAB, idempotency. Direct core calls (single page = single
  // shared truth) rather than simulating two logged-in devices for pure
  // algorithm checks.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });

    // Higher bid wins; the lower bid on the SAME player is "outbid".
    const r1 = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      await LG.addClaim(1, { id: "c1", teamId: 1, addKey: "dst_KC", addName: "KC D/ST", addPos: "DST", addTeam: "KC", dropKey: "111333", dropName: "B. Backup", bid: 30, t: 1 });
      await LG.addClaim(1, { id: "c2", teamId: 2, addKey: "dst_KC", addName: "KC D/ST", addPos: "DST", addTeam: "KC", dropKey: "dst_DAL", dropName: "DAL D/ST", bid: 20, t: 2 });
      const doc = await LG.processWaivers(1);
      const t1 = await LG.db.get("team_1");
      const ros1 = await LG.loadRoster(1, 1);
      const ros2 = await LG.loadRoster(1, 2);
      return { doc, faab1: LG.teamFaab(t1), hasKcT1: ros1.some((p) => p.key === "dst_KC"), hasBackupT1: ros1.some((p) => p.key === "111333"), ros2keys: ros2.map((p) => p.key) };
    });
    ok(r1.doc.processed === true, "claims doc marked processed");
    const res1 = r1.doc.results.find((x) => x.id === "c1"), res2 = r1.doc.results.find((x) => x.id === "c2");
    ok(res1 && res1.ok === true && res1.reason === "won", "higher bid ($30) wins");
    ok(res2 && res2.ok === false && res2.reason === "outbid", "lower bid ($20) on the SAME player loses as 'outbid'");
    ok(r1.hasKcT1 && !r1.hasBackupT1, "winner's roster gains the player (BENCH) and loses the drop");
    ok(r1.faab1 === 70, "winner's FAAB deducted by the winning bid (100 → 70)");
    ok(r1.ros2keys.includes("dst_DAL"), "loser's roster is untouched");
    const txAfter1 = await page.evaluate(() => window.__GFFL__.LG.loadTx());
    ok(txAfter1.length === 1 && txAfter1[0].type === "waiver" && txAfter1[0].teamId === 1, "exactly one waiver tx logged, for the winner only");

    // Idempotent re-run.
    const r2 = await page.evaluate(() => window.__GFFL__.LG.processWaivers(1));
    ok(r2.processed === true && r2.results.length === 2, "re-processing an already-processed week is a no-op");
    const txAfter2 = await page.evaluate(() => window.__GFFL__.LG.loadTx());
    ok(txAfter2.length === 1, "…no duplicate tx entries from re-processing");
    const faabAfter2 = await page.evaluate(async () => { const LG = window.__GFFL__.LG; return LG.teamFaab(await LG.db.get("team_1")); });
    ok(faabAfter2 === 70, "…and FAAB isn't deducted twice");

    // Tie bid: worse-standing team wins, NOT lower teamId (team1 < team2, but
    // team1 has the winning record here — team2 must still win the tie).
    await page.evaluate(() => window.__GFFL__.LG.db.set("weekly_x", { kind: "weekly", matchups: [{ home: 1, away: 2, homePts: 50, awayPts: 10 }] }));
    const r3 = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      await LG.addClaim(2, { id: "c3", teamId: 1, addKey: "dst_DEN", addName: "DEN D/ST", addPos: "DST", addTeam: "DEN", dropKey: "111777", dropName: "H. Healthy", bid: 20, t: 10 });
      await LG.addClaim(2, { id: "c4", teamId: 2, addKey: "dst_DEN", addName: "DEN D/ST", addPos: "DST", addTeam: "DEN", dropKey: "222333", dropName: "X. Wideout", bid: 20, t: 11 });
      return LG.processWaivers(2);
    });
    const res3 = r3.results.find((x) => x.id === "c3"), res4 = r3.results.find((x) => x.id === "c4");
    ok(res4 && res4.ok === true && res4.reason === "won", "equal bids: the WORSE-standing team (0-1) wins the tie");
    ok(res3 && res3.ok === false && res3.reason === "outbid", "…and the better-standing team (1-0) loses despite the lower teamId");

    // Insufficient FAAB: team1 has $70 left; a $999 bid can't win.
    const r4 = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      await LG.addClaim(3, { id: "c5", teamId: 1, addKey: "111333", addName: "B. Backup", addPos: "RB", addTeam: "KC", dropKey: "dst_KC", dropName: "KC D/ST", bid: 999, t: 20 });
      const doc = await LG.processWaivers(3);
      const t1 = await LG.db.get("team_1");
      const ros1 = await LG.loadRoster(3, 1);
      return { doc, faab1: LG.teamFaab(t1), hasBackup: ros1.some((p) => p.key === "111333") };
    });
    const res5 = r4.doc.results.find((x) => x.id === "c5");
    ok(res5 && res5.ok === false && res5.reason === "insufficient-faab", "a bid over remaining FAAB loses as 'insufficient-faab'");
    ok(!r4.hasBackup && r4.faab1 === 70, "…nothing moved, FAAB unchanged");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // I3: auto-process on boot, once the deadline has passed.
  {
    const claimsSeed = { kind: "claims", week: 1, claims: [
      { id: "cX", teamId: 1, addKey: "dst_KC", addName: "KC D/ST", addPos: "DST", addTeam: "KC", dropKey: "111333", dropName: "B. Backup", bid: 15, t: 1 },
    ], processed: false, results: null };
    const base = fullSeed();
    const { ctx, page, errors } = await newTestPage(browser, { docs: { ...base.docs, claims_2026_w1: claimsSeed }, pass: base.pass, team: base.team, who: base.who });
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const pre = await page.evaluate(() => window.__GFFL__.LG.loadClaims(1));
    ok(pre.processed === false, "a normal boot (before the deadline) leaves the pending claim untouched");
    const deadline = await page.evaluate(() => window.__GFFL__.LG.waiverDeadline(1));
    const post = await page.evaluate(async (ts) => {
      const LG = window.__GFFL__.LG;
      LG.nowOverride = ts;
      await window.__GFFL__.UI.boot();
      return LG.loadClaims(1);
    }, deadline + 3600000);
    ok(post.processed === true, "re-booting past the deadline auto-processes the pending claims doc (any client)");
    const won = (post.results || []).find((r) => r.id === "cX");
    ok(won && won.ok === true, "…and the claim actually resolved (won, the only claim on the board)");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // I4: FAAB shown in the UI, and never goes negative.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForSelector("#mvFaab", { timeout: 9000 });
    ok((await text(page, "#mvFaab")) === "100", "FAAB remaining shown in the Waivers card (starts at $100)");
    await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      await LG.addClaim(1, { id: "d1", teamId: 1, addKey: "dst_KC", addName: "KC D/ST", addPos: "DST", addTeam: "KC", dropKey: "111333", dropName: "B. Backup", bid: 100, t: 1 });
      await LG.processWaivers(1);
    });
    const faabAfter = await page.evaluate(() => { const LG = window.__GFFL__.LG; return LG.teamFaab(LG.teamById(1)); });
    ok(faabAfter === 0, "a full-budget win leaves FAAB at exactly 0 (not negative)");
    const tryMore = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      await LG.addClaim(2, { id: "d2", teamId: 1, addKey: "dst_DEN", addName: "DEN D/ST", addPos: "DST", addTeam: "DEN", dropKey: "111777", dropName: "H. Healthy", bid: 1, t: 2 });
      const doc = await LG.processWaivers(2);
      return { doc, faab: LG.teamFaab(await LG.db.get("team_1")) };
    });
    ok(tryMore.doc.results[0].ok === false && tryMore.doc.results[0].reason === "insufficient-faab", "even a $1 bid fails once FAAB is exhausted");
    ok(tryMore.faab === 0, "FAAB never goes negative");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // I5: cancelling a claim.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForSelector("#faSearch", { timeout: 9000 });
    await page.type("#faSearch", "dst");
    await page.waitForFunction(() => document.querySelectorAll("#faResults [data-fi]").length > 0, { timeout: 5000 });
    await clickIn(page, "#faResults [data-fi]", "KC D/ST");
    await page.waitForSelector("#claimSheet [data-di]", { timeout: 5000 });
    await clickIn(page, "#claimSheet [data-di]", "B. Backup");
    await clickIn(page, "#claimGo");
    await page.waitForFunction(() => (document.querySelector("#mvMyClaims") || {}).textContent && document.querySelector("#mvMyClaims").textContent.includes("KC D/ST"), { timeout: 5000 });
    await clickIn(page, ".mvcancel");
    await page.waitForFunction(() => (document.querySelector("#mvMyClaims") || {}).textContent && document.querySelector("#mvMyClaims").textContent.includes("No pending claims"), { timeout: 5000 });
    ok(true, "cancelling a pending claim removes it from MY PENDING");
    const doc = await readDoc(page, "claims_2026_w1");
    ok(doc.claims.length === 0, "…and from the claims doc itself");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // ---- J: trades — offer/accept/review/execute, veto, decline/cancel, deadline ----
  section("J · trades — offer/accept/review/execute, veto, decline/cancel, deadline");
  {
    // J1: UI flow both directions — team1 proposes via the form, team2 (a
    // separate device) accepts via the form; review holds; past the window,
    // opening Moves executes the swap both ways + logs the tx.
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    const { ctx: ctx1, page: page1, errors: err1 } = await newTestPage(browser, fullSeed());
    await bootPage(page1);
    await page1.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page1);
    await page1.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page1.waitForSelector("#mvTradeTeam", { timeout: 9000 });
    await page1.select("#mvTradeTeam", "2");
    await page1.waitForFunction(() => document.querySelectorAll("#mvGet .pickchip").length > 0, { timeout: 5000 });
    await clickIn(page1, "#mvGive .pickchip", "B. Backup");
    await clickIn(page1, "#mvGet .pickchip", "X. Wideout");
    await clickIn(page1, "#mvTradeSend");
    await page1.waitForFunction(() => (document.querySelector("#mvMyTrades") || {}).textContent && document.querySelector("#mvMyTrades").textContent.includes("X. Wideout"), { timeout: 5000 });
    ok(true, "trade offer sent from the UI form and shows in MY PENDING");
    const trades1 = await page1.evaluate(() => window.__GFFL__.LG.loadTrades());
    ok(trades1.length === 1 && trades1[0].status === "offered" && trades1[0].give[0] === "111333" && trades1[0].get[0] === "222333",
      "trade doc: give/get are the picked player keys, status offered");
    const tradeId = trades1[0].id;

    const seed2 = fullSeed();
    const { ctx: ctx2, page: page2, errors: err2 } = await newTestPage(browser,
      { docs: { ...seed2.docs, [tradeId]: trades1[0] }, pass: "amenfarms", team: 2, who: "Rival" });
    await bootPage(page2);
    await page2.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page2);
    await page2.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page2.waitForSelector(".mvaccept", { timeout: 9000 });
    ok(true, "the counterparty sees Accept/Decline for the offer on their own device");
    await clickIn(page2, ".mvaccept");
    await page2.waitForFunction(() => document.body.textContent.includes("reviews until"), { timeout: 5000 });
    const accepted = await page2.evaluate((id) => window.__GFFL__.LG.loadTrade(id), tradeId);
    ok(accepted.status === "accepted" && accepted.reviewEndsAt > accepted.acceptedAt, "accepting starts the review window");

    await page2.evaluate(() => window.__GFFL__.UI.renderMoves());
    const stillAccepted = await page2.evaluate((id) => window.__GFFL__.LG.loadTrade(id), tradeId);
    ok(stillAccepted.status === "accepted", "review window holds — reopening Moves before it ends does NOT execute");

    await page2.evaluate((ts) => { window.__GFFL__.LG.nowOverride = ts; }, accepted.reviewEndsAt + 1000);
    await page2.evaluate(() => window.__GFFL__.UI.renderMoves());
    const executed = await page2.evaluate((id) => window.__GFFL__.LG.loadTrade(id), tradeId);
    ok(executed.status === "executed", "past the review window, opening Moves auto-executes the trade");
    const ros1 = await page2.evaluate(() => window.__GFFL__.LG.loadRoster(1, 1));
    const ros2 = await page2.evaluate(() => window.__GFFL__.LG.loadRoster(1, 2));
    ok(ros1.some((p) => p.key === "222333") && !ros1.some((p) => p.key === "111333"), "team1's roster gained the GET player and lost the GIVE player");
    ok(ros2.some((p) => p.key === "111333") && !ros2.some((p) => p.key === "222333"), "team2's roster gained the GIVE player and lost the GET player — swap both directions");
    const tx = await page2.evaluate(() => window.__GFFL__.LG.loadTx());
    ok(tx.some((t) => t.type === "trade" && t.detail.result === "executed" && t.detail.tradeId === tradeId), "executed trade logged to the transactions log");
    ok(err1.length === 0 && err2.length === 0, "0 page errors across both devices");
    await ctx1.close(); await ctx2.close();
  }

  // J2: veto path — enough OTHER owners kill an accepted trade before it executes.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const r = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      const off = await LG.offerTrade(1, 2, ["111333"], ["222333"], "veto test");
      const acc = await LG.acceptTrade(off.trade.id, 2);
      const selfVeto1 = await LG.vetoTrade(off.trade.id, 1);
      const selfVeto2 = await LG.vetoTrade(off.trade.id, 2);
      await LG.vetoTrade(off.trade.id, 3);
      const v4 = await LG.vetoTrade(off.trade.id, 4);
      const dup = await LG.vetoTrade(off.trade.id, 3); // repeat vote while still under review
      await LG.vetoTrade(off.trade.id, 5);
      const v6 = await LG.vetoTrade(off.trade.id, 6); // 4th distinct vote -> vetoed
      return { off, acc, selfVeto1, selfVeto2, v4, dup, v6, tx: await LG.loadTx(), ros1: await LG.loadRoster(1, 1) };
    });
    ok(r.off.ok && r.acc.status === "accepted", "second trade offered + accepted");
    ok(r.selfVeto1.vetoes.length === 0 && r.selfVeto2.vetoes.length === 0, "a party to the trade can't veto their own trade");
    ok(r.v4.status === "accepted" && r.v4.vetoes.length === 2, "2 distinct outside vetoes: still under review, not enough yet");
    ok(r.dup.vetoes.length === 2, "a repeat vote from the same team doesn't double-count");
    ok(r.v6.status === "vetoed" && r.v6.vetoes.length === 4, "4 distinct outside vetoes (the league's rule) kills the trade");
    ok(!r.ros1.some((p) => p.key === "222333"), "a vetoed trade never executes — roster untouched");
    ok(r.tx.some((t) => t.type === "trade" && t.detail.result === "vetoed"), "the veto is logged to the transactions log");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // J3: decline + cancel paths.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const r = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      const off1 = await LG.offerTrade(1, 2, ["111333"], ["222333"], "");
      const declined = await LG.declineTrade(off1.trade.id, 2);
      const acceptAfterDecline = await LG.acceptTrade(off1.trade.id, 2);
      const off2 = await LG.offerTrade(1, 2, ["111777"], ["222111"], "");
      const cancelled = await LG.cancelTrade(off2.trade.id, 1);
      const acceptAfterCancel = await LG.acceptTrade(off2.trade.id, 2);
      const wrongCancel = await LG.cancelTrade(off1.trade.id, 3);
      return { declined, acceptAfterDecline, cancelled, acceptAfterCancel, wrongCancel };
    });
    ok(r.declined.status === "declined", "counterparty can decline an offer");
    ok(r.acceptAfterDecline === null, "a declined offer can no longer be accepted");
    ok(r.cancelled.status === "cancelled", "the offerer can cancel their own pending offer");
    ok(r.acceptAfterCancel === null, "a cancelled offer can no longer be accepted");
    ok(r.wrongCancel === null, "only the offering team may cancel it");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // J4: trade deadline week blocks new offers.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const r = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      const deadlineWeek = LG.rules.trades.deadlineWeek;
      const start = new Date(LG.SEASON_START + "T05:00:00-05:00").getTime();
      const wk = deadlineWeek + 1;
      LG.nowOverride = start + (wk - 1) * 7 * 24 * 3600 * 1000 + 3600000;
      const blocked = await LG.offerTrade(1, 2, ["111333"], ["222333"], "");
      LG.nowOverride = null;
      const allowed = await LG.offerTrade(1, 2, ["111333"], ["222333"], "");
      return { blocked, allowed, deadlineWeek };
    });
    ok(r.blocked.ok === false && r.blocked.reason === "deadline-passed", "offers are blocked after the trade deadline week (wk " + r.deadlineWeek + ")");
    ok(r.allowed.ok === true, "…and allowed again once nowOverride resets to a normal in-season time");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // ---- K: chat — text/reactions/reply/delete/images/gifs/sys posts/threads ----
  section("K · chat — gifs, memes, event posts, reactions, threads");
  {
    // K1: post text -> renders on the posting device + persists to the store.
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    const { ctx: ctx1, page: page1, errors: err1 } = await newTestPage(browser, fullSeed());
    await bootPage(page1);
    await page1.waitForSelector(".mucard", { timeout: 9000 });
    await page1.evaluate(() => window.__GFFL__.UI.show("chat"));
    await page1.waitForSelector("#chatText", { timeout: 9000 });
    // The house [hidden]-override lesson (CLAUDE.md): a styled panel toggled
    // via the `hidden` attribute needs its `display` restated for it —
    // measure GEOMETRY, never the attribute, or a rule like `.chatmeme,
    // .chatGifGrid { display:grid }` silently un-hides it.
    const hiddenGeom = await page1.evaluate(() => ["chatMeme", "chatGifBox", "chatReplyPreview", "chatPending"]
      .map((id) => document.getElementById(id).getBoundingClientRect().height));
    ok(hiddenGeom.every((h) => h === 0), "the meme/gif/reply/pending panels are ACTUALLY hidden (0 height) before any of them is opened — not just the `hidden` attribute set (" + hiddenGeom.join(",") + ")");
    await page1.type("#chatText", "Hello league!");
    await page1.click("#chatSend");
    await page1.waitForFunction(() => document.querySelector("#chatList").textContent.includes("Hello league!"), { timeout: 5000 });
    ok(true, "typed text posts and renders in the list on the posting device");
    const msgs1 = await page1.evaluate(() => window.__GFFL__.LG.loadChat(null));
    const msg1 = msgs1.find((m) => m.text === "Hello league!");
    ok(!!msg1 && msg1.teamId === 1 && msg1.who === "Peter" && !msg1.sys, "the message doc persisted with the poster's identity");

    // K2: a second device sees it — via a fresh snapshot (the local backend's
    // per-context storage stand-in for a second real device), and again after
    // explicitly driving the refresh hook (the poll's own code path).
    const snap1 = await snapshotAllDocs(page1);
    const { ctx: ctx2, page: page2, errors: err2 } = await newTestPage(browser, { docs: snap1, pass: "amenfarms", team: 2, who: "Rival" });
    await bootPage(page2);
    await page2.waitForSelector(".mucard", { timeout: 9000 });
    await page2.evaluate(() => window.__GFFL__.UI.show("chat"));
    await page2.waitForSelector("#chatText", { timeout: 9000 });
    ok((await page2.evaluate(() => document.querySelector("#chatList").textContent)).includes("Hello league!"),
      "a second device (fresh snapshot of the store) sees the message on open");
    await page1.evaluate(() => window.__GFFL__.LG.postChat({ text: "second message" }));
    const snap1b = await snapshotAllDocs(page1);
    await page2.evaluate((docs, pfx) => { for (const id of Object.keys(docs)) localStorage.setItem(pfx + id, JSON.stringify(docs[id])); }, snap1b, LSPFX);
    await page2.evaluate(() => window.__GFFL__.UI.refreshChatList("chat", null));
    ok((await page2.evaluate(() => document.querySelector("#chatList").textContent)).includes("second message"),
      "…and a later message shows up once the refresh hook (the 8s poll's own code path) is driven");

    // K3: reactions toggle on/off and render counts.
    const mid = await page1.evaluate(() => window.__GFFL__.LG.loadChat(null).then((m) => m.find((x) => x.text === "Hello league!").id));
    await page1.evaluate((id) => document.querySelector(`.chatReact[data-mid="${id}"][data-e="🔥"]`).click(), mid);
    await page1.waitForFunction((id) => document.querySelector(`.chatReact[data-mid="${id}"][data-e="🔥"]`).textContent.includes("1"), { timeout: 5000 }, mid);
    ok(true, "tapping a reaction toggles it on and the count renders");
    const after1 = await page1.evaluate((id) => window.__GFFL__.LG.loadChat(null).then((m) => m.find((x) => x.id === id).reactions["🔥"]), mid);
    ok(Array.isArray(after1) && after1.includes(1), "reaction doc carries the reacting team's id");
    await page1.evaluate((id) => document.querySelector(`.chatReact[data-mid="${id}"][data-e="🔥"]`).click(), mid);
    await page1.waitForFunction((id) => !document.querySelector(`.chatReact[data-mid="${id}"][data-e="🔥"]`).textContent.includes("1"), { timeout: 5000 }, mid);
    ok(true, "tapping the same reaction again toggles it back off");

    // K4: reply renders a quote of the original.
    await page1.evaluate((id) => document.querySelector(`.chatReply[data-mid="${id}"]`).click(), mid);
    await page1.waitForSelector("#chatReplyPreview:not([hidden])", { timeout: 5000 });
    await page1.type("#chatText", "totally agree");
    await page1.click("#chatSend");
    await page1.waitForFunction(() => document.querySelectorAll(".chatQuote").length > 0, { timeout: 5000 });
    const quoteTxt = await page1.evaluate(() => [...document.querySelectorAll(".chatQuote")].map((e) => e.textContent).join("|"));
    ok(/Hello league!/.test(quoteTxt), "a reply renders a quoted snippet of the message it replies to");

    // K5: delete — own-only for a regular team, absent for someone else's
    // message, and present for the commissioner on ANY message.
    const ownDelPresent = await page1.evaluate((id) => !!document.querySelector(`.chatDel[data-mid="${id}"]`), mid);
    ok(ownDelPresent, "the poster sees a delete button on their own message");
    await page2.evaluate(() => window.__GFFL__.UI.refreshChatList("chat", null));
    const otherHasDelete = await page2.evaluate((id) => !!document.querySelector(`.chatDel[data-mid="${id}"]`), mid);
    ok(!otherHasDelete, "a non-owner, non-commissioner device has NO delete button on someone else's message");
    const delAsOther = await page2.evaluate((id, tid) => window.__GFFL__.LG.deleteChat(id, tid, false), mid, 2);
    ok(delAsOther.ok === false && delAsOther.reason === "not-yours", "…and the core call refuses it too, defense in depth");
    await page2.evaluate(() => window.__GFFL__.LG.gateCommish()); // stubbed prompt "1234" creates+unlocks
    await page2.evaluate(() => window.__GFFL__.UI.show("chat"));
    await page2.waitForSelector("#chatText", { timeout: 9000 });
    const commishHasDelete = await page2.evaluate((id) => !!document.querySelector(`.chatDel[data-mid="${id}"]`), mid);
    ok(commishHasDelete, "once commissioner-unlocked, delete appears on every message, not just their own");
    await page2.evaluate((id) => document.querySelector(`.chatDel[data-mid="${id}"]`).click(), mid);
    await page2.waitForFunction((id) => !document.querySelector(`.chatRowMsg[data-mid="${id}"]`), { timeout: 5000 }, mid);
    const goneOnDeleter = await page2.evaluate((id) => window.__GFFL__.LG.loadChat(null).then((m) => !m.some((x) => x.id === id)), mid);
    ok(goneOnDeleter, "commissioner delete calls LG.db.del — the doc is gone from the store, not just hidden client-side");
    // Propagate (this suite's stand-in for the shared cloud store — see K2)
    // to prove a real LG.db.del, not a per-context filter.
    const snapAfterDel = await snapshotAllDocs(page2);
    await replaceAllDocs(page1, snapAfterDel);
    const goneFor1 = await page1.evaluate((id) => window.__GFFL__.LG.loadChat(null).then((m) => !m.some((x) => x.id === id)), mid);
    ok(goneFor1, "…so once propagated, the message is gone for everyone else too");
    ok(err1.length === 0 && err2.length === 0, "0 page errors across both devices through post/react/reply/delete");
    if (SHOTS) { await page1.screenshot({ path: path.join(ROOT, "shots", "gffl_chat_390.png"), fullPage: true }); console.log("  📸 shots/gffl_chat_390.png"); }
    await ctx1.close(); await ctx2.close();
  }

  // K6: images — file-pick resize path lands under the cap; the oversized
  // path is exercised directly (no need for a real >320px source image).
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await page.evaluate(() => window.__GFFL__.UI.show("chat"));
    await page.waitForSelector("#chatText", { timeout: 9000 });
    const bigOk = await page.evaluate(() => window.__GFFL__.UI.attachImage("chat", "data:image/jpeg;base64," + "A".repeat(90000)));
    ok(bigOk === false, "an oversized (~90KB) dataURL is refused");
    ok(/too big/.test((await text(page, "#toast")) || ""), "…with a toast telling the family why");
    ok((await page.evaluate(() => document.getElementById("chatPending").hidden)) === true, "…and no pending-image preview is shown");
    const smallOk = await page.evaluate(() => window.__GFFL__.UI.attachImage("chat", "data:image/jpeg;base64,AAAA"));
    ok(smallOk === true, "a small dataURL is accepted");
    ok((await page.evaluate(() => document.getElementById("chatPending").hidden)) === false, "…and shows a pending preview before sending");
    await page.click("#chatSend");
    await page.waitForFunction(() => !!document.querySelector(".chatImg"), { timeout: 5000 });
    ok(true, "the accepted image posts and renders inline");
    const posted = await page.evaluate(() => window.__GFFL__.LG.loadChat(null).then((m) => m.find((x) => x.img)));
    ok(posted && posted.img === "data:image/jpeg;base64,AAAA", "the posted doc carries the exact image dataURL");
    // Tap-to-zoom overlay, and the meme library re-posts a distinct recent image.
    await page.evaluate(() => document.querySelector(".chatImg").click());
    ok((await page.evaluate(() => document.getElementById("imgOverlay").hidden)) === false, "tapping a posted image opens the full-size overlay");
    await page.evaluate(() => document.getElementById("imgOverlay").click());
    ok((await page.evaluate(() => document.getElementById("imgOverlay").hidden)) === true, "…and tapping the overlay closes it again");
    const recents = await page.evaluate(() => window.__GFFL__.LG.recentChatImages(12));
    ok(recents.includes("data:image/jpeg;base64,AAAA"), "the meme library (recent distinct images) picks up what was just posted");
    ok(errors.length === 0, "0 page errors through the image path");
    await ctx.close();
  }

  // K7: GIF search — probed on first tap; hides itself permanently on
  // gif-not-configured; a configured key returns real results end to end.
  {
    delete process.env.TENOR_API_KEY;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await page.evaluate(() => window.__GFFL__.UI.show("chat"));
    await page.waitForSelector("#chatGifBtn", { timeout: 9000 });
    ok((await page.evaluate(() => document.getElementById("chatGifBtn").hidden)) === false, "the GIF button starts visible — no proactive/uninvited probe");
    await page.click("#chatGifBtn");
    await page.waitForFunction(() => document.getElementById("chatGifBtn").hidden === true, { timeout: 5000 });
    ok(true, "tapping it with no TENOR_API_KEY configured probes once and hides the button for the rest of the session");
    ok((await page.evaluate(() => document.getElementById("chatGifBox").hidden)) === true, "…and the search box never opens");
    ok(errors.length === 0, "0 page errors on the unconfigured GIF path");
    await ctx.close();

    process.env.TENOR_API_KEY = "testkey";
    process.env.TENOR_BASE_URL = "http://127.0.0.1:" + TENOR_PORT;
    const { ctx: ctx2, page: page2, errors: err2 } = await newTestPage(browser, fullSeed());
    await bootPage(page2);
    await page2.waitForSelector(".mucard", { timeout: 9000 });
    await page2.evaluate(() => window.__GFFL__.UI.show("chat"));
    await page2.waitForSelector("#chatGifBtn", { timeout: 9000 });
    await page2.click("#chatGifBtn");
    await page2.waitForSelector("#chatGifBox:not([hidden])", { timeout: 5000 });
    ok(true, "with a key configured, the search box opens on tap");
    await page2.type("#chatGifQ", "goat");
    await page2.waitForFunction(() => document.querySelectorAll("#chatGifGrid .gifThumb").length === 2, { timeout: 5000 });
    ok(true, "the (debounced) query returns the fake Tenor upstream's 2 results as thumbnails");
    await page2.click("#chatGifGrid .gifThumb");
    await page2.waitForSelector("#chatPending:not([hidden])", { timeout: 5000 });
    await page2.click("#chatSend");
    await page2.waitForFunction(() => !!document.querySelector(".chatImg"), { timeout: 5000 });
    const gifMsg = await page2.evaluate(() => window.__GFFL__.LG.loadChat(null).then((m) => m.find((x) => x.gif)));
    ok(gifMsg && gifMsg.gif.url === "http://tenor.test/goat1.gif", "picking a GIF posts the message carrying its {url,preview}");
    ok(err2.length === 0, "0 page errors on the configured GIF path");
    await ctx2.close();
    delete process.env.TENOR_API_KEY; // restore: no key by default for every other section
  }

  // K8: event posts — rules save, waiver processing, executed + vetoed trades.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const r = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      // Rules save.
      const next = JSON.parse(JSON.stringify(LG.rules));
      next.scoring.rec = 0.5;
      await LG.saveRules(next, "Peter");
      // Waivers (a real winning claim, so the summary has something to say).
      await LG.addClaim(1, { id: "kchat1", teamId: 1, addKey: "dst_KC", addName: "KC D/ST", addPos: "DST", addTeam: "KC", dropKey: "111333", dropName: "B. Backup", bid: 10, t: 1 });
      await LG.processWaivers(1);
      // Executed trade.
      const off = await LG.offerTrade(1, 2, ["4361741"], ["222333"], "");
      const acc = await LG.acceptTrade(off.trade.id, 2);
      LG.nowOverride = acc.reviewEndsAt + 1000;
      await LG.executeTrade(off.trade.id);
      LG.nowOverride = null;
      // Vetoed trade.
      const off2 = await LG.offerTrade(1, 2, ["111777"], ["dst_DAL"], "");
      await LG.acceptTrade(off2.trade.id, 2);
      await LG.vetoTrade(off2.trade.id, 3); await LG.vetoTrade(off2.trade.id, 4);
      await LG.vetoTrade(off2.trade.id, 5); await LG.vetoTrade(off2.trade.id, 6);
      const chat = await LG.loadChat(null);
      return chat.filter((m) => m.sys).map((m) => m.text);
    });
    ok(r.some((t) => /updated the rules/.test(t) && /scoring\.rec/.test(t)), "a rules save posts an event with the change summary (" + JSON.stringify(r) + ")");
    ok(r.some((t) => /Waivers processed/.test(t) && /KC D\/ST/.test(t)), "waiver processing posts a summary naming the winner");
    ok(r.some((t) => /^🔁 Trade:/.test(t) && /W\. Receiver/.test(t)), "an executed trade posts the trade sentence with the real player names");
    ok(r.some((t) => /vetoed by the league/.test(t)), "a vetoed trade posts its own event too");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // K9: matchup trash-talk thread is a genuinely separate channel.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    const week = await page.evaluate(() => window.__GFFL__.UI.week);
    ok(week === 1, "sanity: viewing week 1");
    await clickIn(page, ".mucard.mine");
    await page.waitForSelector(".muhead", { timeout: 9000 });
    await page.waitForSelector("#muThreadText", { timeout: 9000 });
    const threadKey = await page.evaluate(() => `w${window.__GFFL__.UI.week}_${window.__GFFL__.UI.matchup[0]}-${window.__GFFL__.UI.matchup[1]}`);
    await page.type("#muThreadText", "smack talk only here");
    await page.click("#muThreadSend");
    await page.waitForFunction(() => document.querySelector("#muThreadList").textContent.includes("smack talk only here"), { timeout: 5000 });
    ok(true, "the trash-talk thread renders on the matchup page and posts to it");
    const [main, thread] = await page.evaluate((tk) => Promise.all([window.__GFFL__.LG.loadChat(null), window.__GFFL__.LG.loadChat(tk)]), threadKey);
    ok(!main.some((m) => m.text === "smack talk only here"), "a thread message never shows up in the main league channel");
    ok(thread.some((m) => m.text === "smack talk only here"), "…only in its own thread, keyed by week+matchup");
    // And the reverse: a main-channel post doesn't leak into the thread.
    await page.evaluate(() => window.__GFFL__.LG.postChat({ text: "main channel only" }));
    await page.evaluate(() => window.__GFFL__.UI.refreshChatList("muThread", window.__GFFL__.UI.matchup ? `w${window.__GFFL__.UI.week}_${window.__GFFL__.UI.matchup[0]}-${window.__GFFL__.UI.matchup[1]}` : null));
    ok(!(await page.evaluate(() => document.querySelector("#muThreadList").textContent)).includes("main channel only"),
      "…and a main-channel post never leaks into the thread's own list");
    ok(errors.length === 0, "0 page errors");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_matchup_thread_390.png"), fullPage: true }); console.log("  📸 shots/gffl_matchup_thread_390.png"); }
    await ctx.close();
  }

  // ---- L: locker rooms — team pages ----
  section("L · locker rooms — record, roster, schedule, transactions, the wall, owner editing, palette");
  {
    const seedWithExtras = () => {
      const base = fullSeed();
      return {
        docs: {
          ...base.docs,
          weekly_1: { kind: "weekly", week: 1, matchups: [{ home: 1, away: 2, homePts: 41, awayPts: 4 }] },
        },
        pass: base.pass, team: base.team, who: base.who,
      };
    };
    const { ctx: ctx1, page: page1, errors: err1 } = await newTestPage(browser, seedWithExtras());
    await bootPage(page1);
    await page1.waitForSelector(".mucard", { timeout: 9000 });
    // Seed a tx + a wall-mention chat message before opening the locker.
    await page1.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      await LG.logTx("fa_add", 1, 1, { addKey: "999", addName: "Someone New" });
      await LG.postChat({ text: "Battle Kreussers are going all the way this year!" });
    });
    await page1.evaluate(() => window.__GFFL__.UI.openLocker(1));
    await page1.waitForSelector(".lockerhead", { timeout: 9000 });
    const body1 = await page1.evaluate(() => document.body.textContent);
    ok(/Battle Kreussers/.test(body1), "locker header shows the team name");
    ok(/#1/.test(body1) && /41\.0/.test(body1), "locker header shows place + record derived from the weekly doc");
    ok(/P\. Passer/.test(body1), "locker roster lists the current week's players");
    ok(/End Zone Goats/.test(body1) && /W 41\.0-4\.0/.test(body1), "locker schedule shows the week-1 opponent and the finalized result");
    ok(/Someone New/.test(body1), "locker transactions list shows the team's own tx history");
    ok((await page1.$$eval(".chatRowMsg", (els) => els.length)) >= 1 && /going all the way/.test(body1),
      "the wall picks up a chat message that mentions the team by name");
    ok(/Add a motto/.test(body1), "no motto set yet — the owner-only placeholder invites them to add one");
    ok(!!(await page1.$("#lockerEditName")) && !!(await page1.$("#lockerEditMotto")) && !!(await page1.$("#lockerEditLogo")),
      "the OWNER (team 1, on their own locker) sees Name/Motto/Logo edit affordances");

    // Owner edits the motto.
    await page1.evaluate(() => { window.__prompts = ["Go Kreussers!"]; });
    await clickIn(page1, "#lockerEditMotto");
    await page1.waitForFunction(() => document.body.textContent.includes("Go Kreussers!"), { timeout: 5000 });
    ok(true, "owner motto edit saves and re-renders");
    const savedTeam = await page1.evaluate(() => window.__GFFL__.LG.teamById(1).motto);
    ok(savedTeam === "Go Kreussers!", "…and persists to the team doc (max 80 chars enforced client-side)");

    // Palette: real upload path (resize + extract + save), a solid-red PNG.
    await page1.evaluate(() => document.getElementById("lockerEditLogo").click());
    const uploaded = await page1.evaluate(async () => {
      const cv = document.createElement("canvas");
      cv.width = 16; cv.height = 16;
      const c2 = cv.getContext("2d");
      c2.fillStyle = "#e21e1e"; c2.fillRect(0, 0, 16, 16);
      const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
      const file = new File([blob], "logo.png", { type: "image/png" });
      const dt = new DataTransfer(); dt.items.add(file);
      const input = document.getElementById("lockerLogoInput");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });
    ok(uploaded, "a red logo PNG is assigned to the hidden file input via a real change event");
    await page1.waitForFunction(() => {
      const el = document.querySelector(".lockerhead");
      return el && /rgb\(\d/.test(getComputedStyle(el).backgroundColor);
    }, { timeout: 9000 });
    const bg = await page1.evaluate(() => getComputedStyle(document.querySelector(".lockerhead")).backgroundColor);
    const rgb = (bg.match(/\d+/g) || []).map(Number);
    ok(rgb.length === 3 && rgb[0] > rgb[1] + 30 && rgb[0] > rgb[2] + 30, "the extracted palette makes the header background REDDISH, not the default green (" + bg + ")");
    const savedColors = await page1.evaluate(() => window.__GFFL__.LG.teamById(1).colors);
    ok(savedColors && typeof savedColors.primary === "string", "the extracted colour is stored on the team doc (computed once at upload, not per render)");

    // Non-owner viewing the SAME locker: no edit affordances at all.
    const snap = await snapshotAllDocs(page1);
    const { ctx: ctx2, page: page2, errors: err2 } = await newTestPage(browser, { docs: snap, pass: "amenfarms", team: 2, who: "Rival" });
    await bootPage(page2);
    await page2.waitForSelector(".mucard", { timeout: 9000 });
    await page2.evaluate(() => window.__GFFL__.UI.openLocker(1));
    await page2.waitForSelector(".lockerhead", { timeout: 9000 });
    ok(/Go Kreussers!/.test(await page2.evaluate(() => document.body.textContent)), "the non-owner sees the same saved motto");
    ok(!(await page2.$("#lockerEditName")) && !(await page2.$("#lockerEditMotto")) && !(await page2.$("#lockerEditLogo")),
      "…but NO edit affordances on someone else's locker");

    // Tap-through from standings / matchup header / "My locker".
    await page2.evaluate(() => window.__GFFL__.UI.show("league"));
    await page2.waitForSelector(".teamlink", { timeout: 9000 });
    await clickIn(page2, ".teamlink", "Battle Kreussers");
    await page2.waitForFunction(() => document.body.textContent.includes("Go Kreussers!"), { timeout: 5000 });
    ok(true, "tapping a team name in the standings opens their locker");
    await page2.evaluate(() => window.__GFFL__.UI.show("team"));
    await page2.waitForSelector("#myLockerBtn", { timeout: 9000 });
    await clickIn(page2, "#myLockerBtn");
    await page2.waitForSelector(".lockerhead", { timeout: 9000 });
    const lockerId2 = await page2.evaluate(() => window.__GFFL__.UI.lockerTeamId);
    ok(lockerId2 === 2, "\"My locker\" on the team page opens the VIEWER's own locker (team 2)");

    ok(err1.length === 0 && err2.length === 0, "0 page errors through the whole locker flow");
    if (SHOTS) { await page1.screenshot({ path: path.join(ROOT, "shots", "gffl_locker_390.png"), fullPage: true }); console.log("  📸 shots/gffl_locker_390.png"); }
    await ctx1.close(); await ctx2.close();
  }

  await browser.close();
  srv.close(); ffSrv.close(); tenorSrv.close();
  console.log("\n================================");
  console.log(`PASS ${pass} · FAIL ${fail}`);
  if (fail) { console.log("Failures:"); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
})().catch((e) => { console.error("SUITE CRASH:", e); process.exit(1); });
