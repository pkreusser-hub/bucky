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
const XAI_PORT = 8846;
const SPORTS_FF_PORT = 8847; // dedicated fantasy-upstream fixture for netlify/functions/sports.mjs
                              // (item 5's Scores tab) — kept SEPARATE from FF_PORT above, which
                              // league.mjs's own history importer already uses for a differently-
                              // shaped fixture (mMatchupScore there means "a past season", not
                              // "this week's live matchups" — sharing a port would collide).
const BASE = "http://127.0.0.1:" + SRV_PORT;
const SHOTS = process.argv.includes("--shots");

let pass = 0, fail = 0; const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; failures.push(msg); console.log("  ✗ " + msg); }
}
function section(name) { console.log("\n== " + name + " =="); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Section X — a plain JSON.stringify comparison of two doc-collection snapshots is sensitive
// to key INSERTION ORDER (localStorage iteration order can legitimately differ between two
// reads of the identical content — e.g. a doc re-set to the SAME value doesn't move, but which
// order the browser enumerates keys in isn't a content guarantee), so it's the wrong tool for
// "are these two collections byte-identical". canon() recursively sorts every object's keys
// (top-level doc ids AND each doc's own fields) before stringifying, so the comparison is
// robust to ordering and only fails on a REAL content difference.
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}
const stableStr = (v) => JSON.stringify(canon(v));

// ---------------- fixtures ----------------
const fixture = {
  phase: 1, sleeperDown: false, espnDown: false, tenorDown: false,
  // Section V knobs (adversarial review 2026-08-08) — every one defaults OFF, so sections
  // A-U see exactly the fixture they always did.
  espnWeekNum: null,      // what /scoreboard says its own week is (finding 1/3/7's provenance)
  sleeperWeek: null,      // what /state/nfl says the current week is (finding 9)
  emptyWeekBucket: null,  // a stats week that legitimately has nothing in it yet (finding 9)
  noFgBuckets: false,     // the real league's shape: FG scored ONLY by made-yards (finding 11)
  bigSlate: false,        // >8 concurrent games, so the summary cap actually bites (finding 13)
  pregame: false,         // adds a not-yet-kicked-off game to the slate (finding 14)
  pregameState: "pre",
  // Section X (2025 test-season mode) — OFF by default, so section Q's own lg_espn_rosters_
  // season(2025) fixture (1 team, 2 players) is completely untouched. When true, the season-
  // 2025 mRoster retry branch serves ffRosterDoc2025Rich() (2 teams, enough real 2025-labeled
  // players to fill starters + a trade partner) instead of the generic 1-team ffRosterDoc().
  test2025Rich: false,
};

// -- fake ESPN fantasy upstream (league.mjs import source) --
function ffSettingsDoc() {
  const doc = {
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
        // Kicker audit (2026-08-07): FG made yards + the two rare plays.
        { statId: 214, points: 0.1 }, { statId: 206, points: 2 }, { statId: 209, points: 1 },
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
  // The REAL family league's actual shape (recorded live 2026-08-07 by lgEspnKickerAudit):
  // it carries NO conventional FG-made ids (74/77/80) at all — field goals are scored ONLY
  // by made YARDS, statId 214 at 0.1/yd, and Badgley's season reconciled to the penny at
  // that rate. Finding 11 is that the import MERGED over the GFFL defaults, so those three
  // absent keys kept paying 3/4/5 alongside the 0.1/yd — every made FG scored roughly twice.
  if (fixture.noFgBuckets) {
    doc.settings.scoringSettings.scoringItems =
      doc.settings.scoringSettings.scoringItems.filter((it) => ![74, 77, 80].includes(it.statId));
  }
  return doc;
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
// Section X (2025 test-season mode, 2026-08-08) — a RICHER 2-team past-season roster, served
// only when fixture.test2025Rich is true (never touches section Q's own 1-team fixture above).
// Every player id here is one already in slpPlayersFix (below), so Sleeper's real archived-
// stats endpoint (D.weekStats, keyed purely off the URL's WEEK — season-agnostic in this fixture
// server, same as the real Sleeper API) scores them meaningfully — the exact same fixture data
// section V's WEEK_STATS_FIX/slpStatsFix already serve, reused rather than duplicated.
function ffRosterDoc2025Rich() {
  const e = (slot, id, name, pos, team, injury) => ({
    lineupSlotId: slot,
    playerPoolEntry: { player: { id, fullName: name, defaultPositionId: pos, proTeamId: team, injuryStatus: injury || "ACTIVE" } },
  });
  return {
    teams: [
      { id: 1, name: "Battle Kreussers", roster: { entries: [
        e(0, 3915511, "P. Passer", 1, 21),    // QB PHI
        e(2, 4241457, "R. Rusher", 2, 6),     // RB DAL
        e(4, 4361741, "W. Receiver", 3, 21),  // WR PHI
        e(6, 111222, "T. Tight", 4, 12),      // TE KC
        e(17, 2473037, "K. Kicker", 5, 6),    // K DAL
        e(16, 0, "PHI D/ST", 16, 21),         // DST PHI
        e(20, 111333, "B. Backup", 2, 12),    // RB KC (bench-tagged; slotting is re-derived)
        e(21, 111666, "I. Injured", 3, 12, "OUT"), // WR KC -> IR
      ] } },
      { id: 2, name: "End Zone Goats", roster: { entries: [
        e(0, 222111, "Q. Rival", 1, 6),       // QB DAL
        e(4, 222333, "X. Wideout", 3, 21),    // WR PHI
        e(2, 111444, "F. Flexman", 2, 7),     // RB DEN
        e(4, 111555, "W. Two", 3, 7),         // WR DEN
        e(20, 111777, "H. Healthy", 3, 7),    // WR DEN
        e(20, 111888, "S. Second", 2, 7),     // RB DEN
        e(16, 0, "DAL D/ST", 16, 6),          // DST DAL
      ] } },
    ],
  };
}
// -- history fixtures (S6) — two hand-built past seasons + one empty one.
// Every fixture team carries record.overall + rankCalculatedFinal (the
// action's "place"/champion source); numbers below are chosen so every
// record-book superlative (highest week, biggest blowout, best season PF,
// all-time standings) has exactly one correct answer to hand-compute against.
function ffHistTeams(list) {
  return list.map((s) => ({
    id: s.id, name: s.name, abbrev: s.abbrev, owners: ["o" + s.id],
    record: { overall: { wins: s.w, losses: s.l, ties: s.t || 0, pointsFor: s.pf, pointsAgainst: s.pa } },
    rankCalculatedFinal: s.place,
  }));
}
const HIST_FIX = {
  2024: {
    settings: { name: "Nerd Fantasy Football League" }, members: [],
    teams: ffHistTeams([
      { id: 1, name: "Battle Kreussers", abbrev: "BK", w: 9, l: 5, pf: 1450.4, pa: 1300.1, place: 2 },
      { id: 2, name: "End Zone Goats", abbrev: "EZG", w: 11, l: 3, pf: 1620.8, pa: 1355.0, place: 1 },
      { id: 3, name: "Wyoming Cowboys", abbrev: "WYO", w: 4, l: 10, pf: 1180.2, pa: 1502.9, place: 8 },
    ]),
    schedule: [
      { matchupPeriodId: 1, home: { teamId: 1, totalPoints: 182.4 }, away: { teamId: 2, totalPoints: 88.2 } },
      { matchupPeriodId: 2, home: { teamId: 2, totalPoints: 130.0 }, away: { teamId: 3, totalPoints: 125.0 } },
      { matchupPeriodId: 3, home: { teamId: 1, totalPoints: 0 }, away: { teamId: 3, totalPoints: 0 } }, // bye/unplayed — must be skipped
    ],
  },
  2023: {
    settings: { name: "Nerd Fantasy Football League" }, members: [],
    teams: ffHistTeams([
      { id: 1, name: "Battle Kreussers", abbrev: "BK", w: 12, l: 2, pf: 1710.6, pa: 1290.4, place: 1 },
      { id: 2, name: "End Zone Goats", abbrev: "EZG", w: 6, l: 8, pf: 1390.0, pa: 1440.0, place: 5 },
      { id: 3, name: "Wyoming Cowboys", abbrev: "WYO", w: 5, l: 9, pf: 1250.0, pa: 1480.0, place: 7 },
    ]),
    schedule: [
      { matchupPeriodId: 1, home: { teamId: 1, totalPoints: 145.0 }, away: { teamId: 2, totalPoints: 100.0 } },
      { matchupPeriodId: 2, home: { teamId: 1, totalPoints: 160.0 }, away: { teamId: 3, totalPoints: 60.0 } },
    ],
  },
  // 2022 deliberately absent -> HIST_FIX[2022] undefined -> always empty/no-season below.
};
function startFfUpstream() {
  const srv = http.createServer((req, res) => {
    const u = req.url;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (u.includes("view=mRoster")) {
      // Item 2 (2026-08-08): a season-aware branch, mirroring the mMatchupScore one below —
      // season 2025's PLAIN url comes back with a real team but EMPTY rosters on purpose, so a
      // passing test of lg_espn_rosters_season genuinely proves its own scoringPeriodId=0 retry
      // fired, not just that the happy path works. Every OTHER season (incl. the live-season
      // lg_espn_rosters action's implicit "current year" call, which never sets a season param
      // matching 2025) is completely unaffected — same ffRosterDoc() as always.
      const seasonRosterM = /\/seasons\/(\d+)\//.exec(u);
      if (seasonRosterM && Number(seasonRosterM[1]) === 2025 && !u.includes("scoringPeriodId=0")) {
        res.end(JSON.stringify({ teams: [{ id: 1, roster: { entries: [] } }] }));
        return;
      }
      // Section X: the season-2025 retry (scoringPeriodId=0) serves the RICHER 2-team fixture
      // when explicitly armed — section Q's own 1-team happy-path test never sets this flag, so
      // it (and every other caller of this action) sees exactly ffRosterDoc() as always.
      if (seasonRosterM && Number(seasonRosterM[1]) === 2025 && fixture.test2025Rich) {
        res.end(JSON.stringify(ffRosterDoc2025Rich()));
        return;
      }
      res.end(JSON.stringify(ffRosterDoc()));
      return;
    }
    const seasonM = /\/seasons\/(\d+)\//.exec(u);
    if (seasonM && u.includes("view=mMatchupScore")) {
      const doc = HIST_FIX[Number(seasonM[1])];
      // Mirrors the real kicker audit's finding (past-season kona reads want
      // scoringPeriodId=0): the PLAIN url comes back empty on purpose here,
      // so a passing test genuinely proves the action's retry ladder fired,
      // not just that the happy path works.
      const ready = doc && u.includes("scoringPeriodId=0");
      res.end(JSON.stringify(ready ? doc : { settings: {}, teams: [], schedule: [] }));
      return;
    }
    res.end(JSON.stringify(ffSettingsDoc()));
  });
  return new Promise((r) => srv.listen(FF_PORT, "127.0.0.1", () => r(srv)));
}

// -- fake sports.mjs fantasy upstream (item 5's Scores tab, ff_scoreboard) — a small, real
// mMatchupScore/mTeam/mSettings-shaped week-1 slate. Distinct from HIST_FIX/startFfUpstream
// above (which fixture PAST-season history reads and deliberately returns empty without
// scoringPeriodId=0 — colliding semantics if shared with a "this week, live" request).
function ffScoreboardFix() {
  return {
    settings: { name: "Nerd Fantasy Football League" },
    status: { currentMatchupPeriod: 1 },
    members: [],
    teams: [
      { id: 1, name: "Battle Kreussers", abbrev: "BK", record: { overall: { wins: 1, losses: 0 } } },
      { id: 2, name: "End Zone Goats", abbrev: "EZG", record: { overall: { wins: 0, losses: 1 } } },
      { id: 3, name: "Wyoming Cowboys", abbrev: "WYO", record: { overall: { wins: 1, losses: 0 } } },
      { id: 4, name: "Waffle House Warriors", abbrev: "WHW", record: { overall: { wins: 0, losses: 1 } } },
    ],
    schedule: [
      { id: 101, matchupPeriodId: 1,
        home: { teamId: 1, totalPointsLive: 88.4, totalProjectedPointsLive: 95.0 },
        away: { teamId: 2, totalPointsLive: 61.2, totalProjectedPointsLive: 70.0 }, winner: "" },
      { id: 102, matchupPeriodId: 1,
        home: { teamId: 3, totalPointsLive: 70.0, totalProjectedPointsLive: 70.0 },
        away: { teamId: 4, totalPointsLive: 40.0, totalProjectedPointsLive: 40.0 }, winner: "" },
    ],
  };
}
function startSportsFfUpstream() {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(ffScoreboardFix()));
  });
  return new Promise((r) => srv.listen(SPORTS_FF_PORT, "127.0.0.1", () => r(srv)));
}

// -- fake Tenor (S4/item 4 chat GIF search) — mirrors Tenor's REAL documented v2 /search
// response shape (developers.google.com/tenor/guides/response-objects-and-errors), not just
// the two fields the server happens to read: id/title/content_description/itemurl/url/tags/
// flags/hasaudio/created + every OTHER media_formats size (gif/mediumgif/nanogif/tinygif/mp4/
// webp/…), plus a top-level "next" pagination cursor. The point is a fixture that could only
// pass if the server maps real Tenor fields correctly — a fixture shaped to match whatever the
// server happens to read (and nothing else) proves nothing about the real integration.
// fixture.tenorDown flips it to a transient 500 (item 4's "GIF search hiccuped" retry path).
function startTenorUpstream() {
  const srv = http.createServer((req, res) => {
    if (fixture.tenorDown) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "upstream unavailable" })); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    const gifResult = (n) => ({
      id: "tid_" + n, title: "goat gif " + n, content_description: "a goat GIF, number " + n,
      itemurl: "https://tenor.com/view/goat-" + n, url: "https://tenor.com/view/goat-" + n,
      tags: ["goat", "gffl"], flags: [], hasaudio: false, created: 1700000000 + n,
      media_formats: {
        gif: { url: "http://tenor.test/goat" + n + ".gif", dims: [498, 372], size: 900000, duration: 0 },
        mediumgif: { url: "http://tenor.test/goat" + n + "m.gif", dims: [300, 224], size: 400000, duration: 0 },
        tinygif: { url: "http://tenor.test/goat" + n + ".gif", dims: [220, 164], size: 90000, duration: 0 },
        nanogif: { url: "http://tenor.test/goat" + n + "n.gif", dims: [120, 90], size: 25000, duration: 0 },
        mp4: { url: "http://tenor.test/goat" + n + ".mp4", dims: [498, 372], size: 300000, duration: 3.1 },
        tinymp4: { url: "http://tenor.test/goat" + n + "t.mp4", dims: [220, 164], size: 60000, duration: 3.1 },
        webp: { url: "http://tenor.test/goat" + n + ".webp", dims: [498, 372], size: 200000, duration: 0 },
      },
    });
    res.end(JSON.stringify({ results: [gifResult(1), gifResult(2)], next: "0" }));
  });
  return new Promise((r) => srv.listen(TENOR_PORT, "127.0.0.1", () => r(srv)));
}

function readBody(req) {
  return new Promise((r) => { let b = ""; req.on("data", (c) => { b += c; }); req.on("end", () => r(b)); });
}
// -- fake xAI (S5 mode "gfflproj" — the AI read) — records every request, answers a canned
// {"players":[...]} JSON as one SSE text delta (same shape _verify-ffai.cjs uses). T. Tight is
// the shared fixture's ONLY player with a real Sleeper projection (slpProjFix pid "9001"), which
// is what lets the UI test assert a real, non-null proj → adjusted-proj computation.
const xaiReqs = [];
function xaiSse(text) {
  const esc = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return [
    'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"' + esc + '"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":500,"completion_tokens":60}}\n\n',
    "data: [DONE]\n\n",
  ].join("");
}
function startXaiUpstream() {
  const srv = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    let b = null; try { b = JSON.parse(raw); } catch { b = { parseError: raw }; }
    xaiReqs.push(b);
    res.setHeader("content-type", "text/event-stream");
    res.end(xaiSse(JSON.stringify({ players: [{ name: "T. Tight", mult: 1.25, why: "KC up big, feeding the tight end in garbage time" }] })));
  });
  return new Promise((r) => srv.listen(XAI_PORT, "127.0.0.1", () => r(srv)));
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
  // Item 2 (2026-08-08): broadcasts[0].names[0] + odds[0].details, the SAME real ESPN
  // scoreboard fields netlify/functions/sports.mjs already reads for the standalone app's
  // score strip — the live game carries a network only (odds markets are commonly gone once
  // a game is underway), the upcoming one carries both a network and a spread.
  const mk = (id, awayAb, homeAb, state, extra) => ({
    id, shortName: awayAb + " @ " + homeAb, date: extra.date,
    competitions: [{
      status: { type: { state, shortDetail: extra.detail || "" }, period: extra.period || 0, displayClock: extra.clock || "" },
      broadcasts: extra.net ? [{ names: [extra.net] }] : [],
      odds: extra.spread ? [{ details: extra.spread }] : [],
      competitors: [
        { homeAway: "home", team: { abbreviation: homeAb }, score: extra.hs },
        { homeAway: "away", team: { abbreviation: awayAb }, score: extra.as },
      ],
    }],
  });
  const events = [
    mk("401900001", "DAL", "PHI", "in", { date: "2026-08-07T00:15Z", detail: "Q2 5:00", period: 2, clock: "5:00", hs: "14", as: "10", net: "FOX" }),
    mk("401900002", "KC", "DEN", "pre", { date: KICK_FUTURE, detail: "Sun 12:00 PM", net: "CBS", spread: "DEN -3.5" }),
  ];
  if (fixture.pregame) {
    events.push(mk("401900777", "SF", "SEA", fixture.pregameState,
      { date: KICK_FUTURE, detail: "Sun 3:25 PM", hs: fixture.pregameState === "post" ? "10" : "0", as: fixture.pregameState === "post" ? "24" : "0" }));
  }
  if (fixture.bigSlate) {
    // 12 concurrent live games — an 8-team league's starters routinely span this many on a
    // Sunday, which is exactly when the ≤8-summaries-per-cycle cap starves the tail (finding 13).
    const abs = ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "GB", "HOU", "IND", "JAX",
      "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PIT", "SEA", "SF"];
    for (let i = 0; i < 12; i++) {
      events.push(mk("40199" + (100 + i), abs[i * 2], abs[i * 2 + 1], "in",
        { date: "2026-08-07T00:15Z", detail: "Q1 10:00", period: 1, clock: "10:00", hs: "3", as: "0" }));
    }
  }
  // The bare /scoreboard endpoint always means "the current week" and says which one — the
  // provenance finalizeWeek now refuses to guess at (findings 1/3/7).
  const out = { events };
  if (fixture.espnWeekNum != null) out.week = { number: fixture.espnWeekNum };
  return out;
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
  // Item 1 (2026-08-08): two genuinely UNROSTERED, non-D/ST free agents (no espn_id — proves
  // the slp_<pid> key fallback still round-trips through the browse table) so the position-chip
  // filter has more than one position to actually narrow between — without these, every free
  // agent in this fixture happens to be a D/ST and the chips would only ever prove "empty vs.
  // the same 2 rows".
  "9201": { full_name: "F. Agent", team: "KC", position: "WR" },
  "9202": { full_name: "A. Vail", team: "DEN", position: "K" },
  PHI: { first_name: "Philadelphia", last_name: "Eagles", team: "PHI", position: "DEF" },
  DAL: { first_name: "Dallas", last_name: "Cowboys", team: "DAL", position: "DEF" },
  KC: { first_name: "Kansas City", last_name: "Chiefs", team: "KC", position: "DEF" },
  DEN: { first_name: "Denver", last_name: "Broncos", team: "DEN", position: "DEF" },
};
// Section V (adversarial review 2026-08-08) needs Sleeper's stats endpoint to answer
// DIFFERENTLY per week — the whole point of findings 1/3/7 is that week N and week N+1 hold
// different numbers, and the pre-fix suite could not tell them apart because every week
// returned the same fixture. Week 1 is byte-identical to what it always was, so every
// hand-computed expectation in sections C-U is untouched.
//   week 3: P. Passer (team1's QB) 300yd 2TD = 12 + 8 = 20.0 · Q. Rival (team2's QB) 50yd = 2.0
//   week 4: P. Passer 25yd = 1.0             · Q. Rival 400yd 3TD = 16 + 12 = 28.0
// i.e. team1 wins week 3 and team2 wins week 4 — the exact "opposite result" shape the
// finding's own repro uses to prove a week was scored from the wrong week's board.
const WEEK_STATS_FIX = {
  3: { "6904": { pass_yd: 300, pass_td: 2 }, "9101": { pass_yd: 50 } },
  4: { "6904": { pass_yd: 25 }, "9101": { pass_yd: 400, pass_td: 3 } },
};
function slpStatsFix(week) {
  const w = Number(week);
  if (WEEK_STATS_FIX[w]) return WEEK_STATS_FIX[w];
  if (fixture.emptyWeekBucket && w === fixture.emptyWeekBucket) return {};
  return {
    "6904": { pass_yd: 150, pass_td: 1, pass_int: 1, pass_2pt: 1, pts_ppr: 12 },
    "7564": { rec: 4, rec_yd: 50, rec_2pt: 1, pts_ppr: 11 },
    "4866": { rush_yd: 40, pts_ppr: 4 },
    "1266": { fgm_20_29: 1, fgm_40_49: 1, fgmiss: 1, xpm: 1 },
    PHI: { pts_allow: 10, sack: 2, int: 1, fum_rec: 1 },
    DAL: { pts_allow: 14, sack: 1, int: 1 },
  };
}
// A PRE-GAME summary that nonetheless carries a populated boxscore.teams block and a header
// score of "0" — the shape finding 14 turns on. Before the fix this credited every starting
// D/ST a 5-point shutout (dst_pa 0 -> dst_pa_0) and consumed the game's one "fetch the final
// box" token, so its REAL final box was never read.
function sumPreFix(state) {
  const teamBlock = (ab) => ({ team: { abbreviation: ab }, statistics: [
    { name: "sacksYardsLost", displayValue: state === "post" ? "3-21" : "0-0" },
    { name: "interceptions", displayValue: state === "post" ? "2" : "0" },
    { name: "fumblesLost", displayValue: "0" },
  ] });
  const score = (ab) => (state === "post" ? (ab === "SF" ? "24" : "10") : "0");
  return {
    header: { competitions: [{ status: { type: { state } }, competitors: [
      { homeAway: "home", team: { abbreviation: "SEA" }, score: score("SEA") },
      { homeAway: "away", team: { abbreviation: "SF" }, score: score("SF") },
    ] }] },
    boxscore: { teams: [teamBlock("SF"), teamBlock("SEA")], players: [] },
    scoringPlays: [],
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

// ---------------- S7 fixtures — a hand-designed 14-week regular season ----------------
// FOUR pairings, each played every week 1-14 (not a realistic round robin — the point is
// exact, hand-verifiable win/loss/PF totals, including ONE deliberate wins-TIE broken only by
// points-for). Written directly as "weekly" docs (bypassing LG.finalizeWeek entirely — same
// "synthetic weekly docs, independent of the live-data guard" technique section M4 already
// uses for power rankings), so a whole 14-week season seeds in one shot.
//   Pair A: team5 dominant over team2 (12-2)   Pair B: team7 dominant over team8 (11-3)
//   Pair C: team1 dominant over team6 (10-4)   Pair D: team4 vs team3 — SAME 7-7 record,
//   decided ONLY by points-for (team4 wins by a lot, loses by a little -> higher aggregate PF).
// Final standings (wins desc, PF desc, teamId asc): team5(12,1620) > team7(11,1590) >
// team1(10,1560) > team4(7,1575) > team3(7,1190) > team6(4,1380) > team8(3,1350) > team2(2,1320)
// -> seeds = [5,7,1,4,3,6,8,2]. DELIBERATELY not team-id order, so a "seed by id" shortcut bug
// would fail every check below.
function regularSeasonWeeklyDocs() {
  const docs = {};
  for (let w = 1; w <= 14; w++) {
    const matchups = [
      w <= 12 ? { home: 5, away: 2, homePts: 120, awayPts: 90 } : { home: 5, away: 2, homePts: 90, awayPts: 120 },
      w <= 11 ? { home: 7, away: 8, homePts: 120, awayPts: 90 } : { home: 7, away: 8, homePts: 90, awayPts: 120 },
      w <= 10 ? { home: 1, away: 6, homePts: 120, awayPts: 90 } : { home: 1, away: 6, homePts: 90, awayPts: 120 },
      w <= 7 ? { home: 4, away: 3, homePts: 130, awayPts: 70 } : { home: 4, away: 3, homePts: 95, awayPts: 100 },
    ];
    docs["weekly_2026_w" + w] = { kind: "weekly", week: w, matchups, awards: {}, power: [], accuracy: null, finalizedAt: 1000 + w };
  }
  return docs;
}
function seedFor7Playoffs() {
  const base = fullSeed();
  return { ...base, docs: { ...base.docs, ...regularSeasonWeeklyDocs() } };
}
// Section V (findings 1/3/7): a 4-week schedule with a week-3 lineup of exactly ONE starter
// per side, so each team's week-3 total IS that quarterback's score and the difference
// between "scored from week 3" and "scored from week 4" is unmissable.
function seedWeekProvenance() {
  const base = fullSeed();
  const wk = [[1, 2], [3, 4], [5, 6], [7, 8]];
  return { ...base, docs: { ...base.docs,
    sched_2026: { kind: "sched", season: 2026, weeks: [wk, wk, wk, wk] },
    roster_2026_w3_t1: { kind: "roster", week: 3, teamId: 1, players: [
      { key: "3915511", name: "P. Passer", pos: "QB", team: "PHI", slot: "QB" }] },
    roster_2026_w3_t2: { kind: "roster", week: 3, teamId: 2, players: [
      { key: "222111", name: "Q. Rival", pos: "QB", team: "DAL", slot: "QB" }] },
  } };
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
let farmgptFn; // in-process handler (S5's mode "gfflproj" — the AI read)
let sportsFn; // in-process handler (item 5's Scores tab — /.netlify/functions/sports)
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
        // S5's "gfflproj" AI read. farmgpt.mjs streams plain text; answered here as one
        // complete body (same simplification the /league route above already uses) — the
        // page's own reader.getReader() loop is happy either way.
        if (u.includes("/.netlify/functions/farmgpt")) {
          const r = await farmgptFn(new Request("http://fn/farmgpt", { method: "POST", body: req.postData() || "{}" }));
          return req.respond({ status: r.status, contentType: r.headers.get("content-type") || "text/plain", headers: cors, body: await r.text() });
        }
        // Item 5's Scores tab — league.html's ff_scoreboard calls go to the DEPLOYED sports
        // function; answered here by the real sports.mjs handler in process against the
        // dedicated fixture above (startSportsFfUpstream).
        if (u.includes("/.netlify/functions/sports")) {
          const r = await sportsFn(new Request("http://fn/sports", { method: "POST", body: req.postData() || "{}" }));
          return req.respond({ status: r.status, contentType: "application/json", headers: cors, body: await r.text() });
        }
        if (u.startsWith(BASE)) return req.continue();
        if (/gstatic|googleapis|firebase/.test(u)) return req.abort();
        if (u.includes("site.api.espn.com")) {
          if (fixture.espnDown) return req.respond({ status: 503, headers: cors, body: "{}" });
          if (u.includes("/scoreboard")) return json(sbFix());
          if (u.includes("event=401900001")) return json(sumAFix());
          if (u.includes("event=401900002")) return json(sumBFix());
          if (u.includes("event=401900777")) return json(sumPreFix(fixture.pregameState));
          return json({});
        }
        if (u.includes("api.sleeper.app")) {
          if (fixture.sleeperDown) return req.respond({ status: 503, headers: cors, body: "{}" });
          if (u.endsWith("/state/nfl")) return json(fixture.sleeperWeek != null ? { ...slpStateFix, week: fixture.sleeperWeek } : slpStateFix);
          if (u.endsWith("/players/nfl")) return json(slpPlayersFix);
          if (u.includes("/stats/nfl/")) return json(slpStatsFix(u.split("/").pop()));
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
// Section X (2025 test-season mode) — LSPFX ("lg_gffl_test1_") is a PREFIX of the test
// collection's own keys too ("lg_gffl_test1_t25_..."), so a plain startsWith(LSPFX) snapshot
// (snapshotAllDocs above) can't tell the two apart. These two split them: real-collection docs
// are everything under LSPFX that ISN'T also under the "_t25_" sub-prefix, and vice versa.
const snapshotRealDocs = (page) => page.evaluate((pfx) => {
  const out = {}, tpfx = pfx + "t25_";
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(pfx) && !k.startsWith(tpfx)) out[k.slice(pfx.length)] = JSON.parse(localStorage.getItem(k));
  }
  return out;
}, LSPFX);
const snapshotTestDocs = (page) => page.evaluate((pfx) => {
  const out = {}, tpfx = pfx + "t25_";
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(tpfx)) out[k.slice(tpfx.length)] = JSON.parse(localStorage.getItem(k));
  }
  return out;
}, LSPFX);
const clickIn = (page, sel, filterText) => page.evaluate((sel, ft) => {
  const els = [...document.querySelectorAll(sel)];
  const el = ft ? els.find((e) => e.textContent.includes(ft)) : els[0];
  if (!el) return false;
  el.click(); return true;
}, sel, filterText || null);
// Boot-speed pass (2026-08-08): record book / recent moves / league chat now load their real
// data lazily, only once opened (see wireLazyLeagueDetails in lg-ui.js) — this opens the given
// <details id="..."> (firing its "toggle" listener) and waits for its placeholder text ("Tap
// to load…") to be gone before returning, instead of assuming the async fetch-then-repaint
// already finished. Generic enough for all three lazy cards since they share that one tell.
async function openDetails(page, id) {
  await page.evaluate((id) => { const el = document.getElementById(id); if (el) el.open = true; }, id);
  await page.waitForFunction((id) => {
    const el = document.getElementById(id);
    return !!el && !/Tap to load/.test(el.textContent);
  }, { timeout: 9000 }, id);
}

// ---------------- main ----------------
(async () => {
  // Section A: the real function, in process, against the fake upstream.
  section("A · league.mjs — ESPN import actions");
  const ffSrv = await startFfUpstream();
  const tenorSrv = await startTenorUpstream();
  const xaiSrv = await startXaiUpstream();
  const sportsFfSrv = await startSportsFfUpstream();
  process.env.SPORTS_FF_BASE_URL = "http://127.0.0.1:" + FF_PORT;
  process.env.BUCKY_NOTIFY_SECRET = "amenfarms";
  process.env.ESPN_S2 = "s2test"; process.env.ESPN_SWID = "{SWID-TEST}";
  process.env.XAI_API_KEY = "test-xai-key";
  process.env.XAI_BASE_URL = "http://127.0.0.1:" + XAI_PORT;
  const mod = await import(pathToFileURL(path.join(ROOT, "netlify/functions/league.mjs")).href);
  leagueFn = mod.default;
  const gptMod = await import(pathToFileURL(path.join(ROOT, "netlify/functions/farmgpt.mjs")).href);
  farmgptFn = gptMod.default;
  // sports.mjs's FF_BASE is a module-level const captured AT IMPORT TIME — point it at the
  // dedicated fixture above just for this one import, then restore SPORTS_FF_BASE_URL to
  // FF_PORT (league.mjs already captured its own copy of the env var at ITS import above, so
  // this never affects league.mjs — purely hygiene for anything imported later).
  const sportsFfBaseSaved = process.env.SPORTS_FF_BASE_URL;
  process.env.SPORTS_FF_BASE_URL = "http://127.0.0.1:" + SPORTS_FF_PORT;
  const sportsMod = await import(pathToFileURL(path.join(ROOT, "netlify/functions/sports.mjs")).href);
  sportsFn = sportsMod.default;
  process.env.SPORTS_FF_BASE_URL = sportsFfBaseSaved;
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
    ok(j.scoring.fg_made_yd === 0.1 && j.scoring.dst_2pt_ret === 2 && j.scoring.one_pt_safety === 1,
      "kicker-audit ids map: 214 FG made yards (0.1/yd) + 206 2-pt return TD + 209 1-pt safety");
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

    // Item 2 (2026-08-08) — lg_espn_rosters_season: the "🧪 test run" past-season roster
    // importer. The fixture's 2025 branch deliberately returns a real team with an EMPTY
    // roster on the plain URL and only a real roster once scoringPeriodId=0 is appended, so a
    // passing check here genuinely proves the retry ladder fired.
    const rosSeason = await call({ secret: "amenfarms", action: "lg_espn_rosters_season", season: 2025 });
    ok(rosSeason.j.ok && rosSeason.j.season === 2025 && rosSeason.j.teams[0].players[0].espnId === 3915511,
      "lg_espn_rosters_season(2025): the plain URL's empty roster is REJECTED and the scoringPeriodId=0 retry's real roster is used (" + JSON.stringify(rosSeason.j.season) + ")");
    ok(rosSeason.j.teams[0].players[1].lineupSlot === "IR" && rosSeason.j.teams[0].players[1].injury === "OUT",
      "…same mapRosterTeams() shape as the live-season importer (IR slot + injury carried)");
    // A season NOT deliberately faked to need the retry (e.g. any other year) still resolves
    // via the plain URL — the ladder never over-fires against a season that didn't need it.
    const rosOther = await call({ secret: "amenfarms", action: "lg_espn_rosters_season", season: 2024 });
    ok(rosOther.j.ok && rosOther.j.season === 2024 && rosOther.j.teams[0].players[0].espnId === 3915511,
      "…a different season resolves on the plain URL alone (no retry needed)");
    const rosBadRange = await call({ secret: "amenfarms", action: "lg_espn_rosters_season", season: 1899 });
    ok(rosBadRange.j.ok && rosBadRange.j.season === 2025, "…an out-of-range season clamps to the 2025 default rather than erroring");
    const s2b = process.env.ESPN_S2; delete process.env.ESPN_S2;
    const rosNoCookie = await call({ secret: "amenfarms", action: "lg_espn_rosters_season", season: 2025 });
    ok(rosNoCookie.j.ok === false && rosNoCookie.j.reason === "fantasy-not-configured",
      "…missing cookies → fantasy-not-configured, same as every other ESPN action (never a 500)");
    process.env.ESPN_S2 = s2b;
    // Live-season lg_espn_rosters (no `season` param at all) is completely unaffected by the
    // 2025 fixture branch — proves the two actions are genuinely independent, not aliases.
    const rosLiveAgain = await call({ secret: "amenfarms", action: "lg_espn_rosters" });
    ok(rosLiveAgain.j.ok && rosLiveAgain.j.teams[0].players.length === 2,
      "…and the ORIGINAL lg_espn_rosters action still reads the live-season fixture untouched");

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
    // Kicker audit follow-through: the ESPN play parser accumulates FG made
    // YARDS, consistent with its own distance buckets (17-39 / 40-49 / 50-63).
    const fgy = await page.evaluate(() => {
      const d = window.__GFFL__.D;
      for (const row of d.S.players.values()) {
        const s = row.espn && row.espn.stats;
        if (s && (s.fg_0_39 + s.fg_40_49 + s.fg_50) > 0)
          return { yd: s.fg_made_yd, lo: s.fg_0_39 * 17 + s.fg_40_49 * 40 + s.fg_50 * 50, hi: s.fg_0_39 * 39 + s.fg_40_49 * 49 + s.fg_50 * 63 };
      }
      return null;
    });
    ok(!!fgy && fgy.yd >= fgy.lo && fgy.yd <= fgy.hi,
      "ESPN scoring plays accumulate FG made YARDS within the distance-bucket bounds (" + JSON.stringify(fgy) + ")");
    ok(/Q2 5:00/.test(passerCell), "Passer cell carries the live clock");
    // Restaged (item 3/10): red zone is a CSS-drawn dot now, not a 🔴 pictograph; conflict is a
    // plain-text ".conflictflag" badge, not an ⚠ pictograph — same underlying signals, no emoji.
    const passerHtml = await page.evaluate(() => {
      const tr = [...document.querySelectorAll(".mutable tbody tr")].find((r) => r.textContent.includes("P. Passer"));
      return tr ? tr.innerHTML : "";
    });
    ok(/class="rzdot"/.test(passerHtml), "red-zone flag on the PHI starter (drive inside the 20) — a CSS dot, not an emoji");
    ok(!/class="conflictflag"/.test(passerHtml), "no conflict flag during ordinary live source lag");
    const remain = await page.evaluate(() => [...document.querySelectorAll(".muhteam")].map((e) => e.textContent).join("|"));
    ok(/4 to play · 5 live/.test(remain), "players-remaining clock: 4 to play · 5 live");
    const wp = await page.$eval(".wpfill", (e) => parseFloat(e.style.width));
    ok(wp >= 1 && wp < 40, "win-prob bar: away side trailing 4.0-41.0 reads a low chance (" + wp + "%)");
    // Item 3 (2026-08-08): a strict, symmetric slot-paired grid — a TOTAL row at the bottom of
    // the starters table (matching the header's own totals), and a Bench section paired by
    // roster order. Team2 (away, "Rival") has NO bench players on file at all — that's the real
    // test of the "Empty" placeholder: 3 bench rows exist (team1/home has 3), every one of them
    // shows "Empty" on the away half and a real name on the home half, so both sides stay the
    // SAME LENGTH and row-aligned even though one team has nobody on the bench.
    const totalRow = await page.$eval(".totalrow", (el) => el.textContent.replace(/\s+/g, " ").trim());
    ok(/4\.0/.test(totalRow) && /41\.0/.test(totalRow) && /TOTAL/.test(totalRow),
      "a TOTAL row at the bottom of the lineup table carries both teams' totals (" + totalRow + ")");
    const benchRows = await page.$$eval(".benchtable tbody tr", (els) => els.map((tr) => tr.textContent.replace(/\s+/g, " ").trim()));
    ok(benchRows.length === 3, "bench section has exactly 3 rows — paired to the LONGER side (home's 3 bench players; away has none) (" + benchRows.length + ")");
    ok(benchRows.every((t) => /Empty/.test(t)), "…every bench row's away half reads \"Empty\" (away has zero bench players) — never a bare dash (" + JSON.stringify(benchRows) + ")");
    ok(/B\. Backup/.test(benchRows.join("|")) && /I\. Injured/.test(benchRows.join("|")) && /H\. Healthy/.test(benchRows.join("|")),
      "…while the home half of each row shows the real bench player");
    const benchHalfHeights = await page.evaluate(() => [...document.querySelectorAll(".benchtable tbody tr")].map((tr) => {
      const cells = tr.querySelectorAll(".pcellgrid");
      return Math.abs(cells[0].getBoundingClientRect().height - cells[1].getBoundingClientRect().height) <= 1;
    }));
    ok(benchHalfHeights.every(Boolean), "…and both halves of every bench row render the SAME height (Empty vs a real player) — equal-height, aligned rows");
    const muScroll390 = await page.evaluate(() => ({ b: document.body.scrollWidth, w: window.innerWidth }));
    ok(muScroll390.b <= muScroll390.w + 1, "the symmetric lineup grid fits 390px with no sideways scroll (" + muScroll390.b + "/" + muScroll390.w + ")");
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

  // ---- E: "My Team" = the owner's own locker (merged 2026-08-07) — lineup, locks, IR ----
  // RESTAGED: "team" is no longer its own page — UI.show("team") now opens the owner's OWN
  // locker with the lineup editor embedded as its roster section (item 3). The mechanic itself
  // (tap-to-swap .lrow/.swaprow, locks, IR) is byte-identical to the old standalone team page —
  // only the selector for "which card holds the starters" changed, since the header is now
  // .lockerhead (not a .card), so the old ".card:nth-of-type(2)" no longer points at the same
  // place. #lockerStarters is the new, explicit container id.
  section("E · my team — lineup editing, kickoff locks, 3 IR spots (now the owner's own locker)");
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(() => window.__GFFL__.UI.show("team"));
    await page.waitForSelector(".lrow", { timeout: 9000 });
    ok(await page.$(".lockerhead"), "\"My Team\" now renders the locker page (header present) — no separate team view any more");
    ok((await page.evaluate(() => window.__GFFL__.UI.view)) === "locker" && (await page.evaluate(() => window.__GFFL__.UI.lockerTeamId)) === 1,
      "UI.view is \"locker\", scoped to MY OWN team id");
    ok(await page.evaluate(() => document.querySelector('.bnav button[data-v="team"]').classList.contains("on")),
      "the bottom-nav \"My Team\" button still lights up as active, even though the underlying view is \"locker\"");
    const starters = await page.$$eval("#lockerStarters .lrow", (els) => els.length);
    ok(starters === 9, "9 starter slots rendered");
    // Restaged (item 10, no emoji in app chrome): the lock marker is plain text ("LOCKED") now.
    const locked = await page.$$eval(".lrow.locked", (els) => els.map((e) => e.textContent));
    ok(locked.length === 5 && locked.every((t) => t.includes("LOCKED")), "5 starters locked (their game is live) with a LOCKED marker");
    ok(/0\/3/.test(await page.evaluate(() => document.body.textContent)), "IR shows 0/3 — the league's 3 IR spots");
    const tightRow = await page.evaluate(() => {
      const el = [...document.querySelectorAll(".lrow")].find((r) => r.textContent.includes("T. Tight"));
      return el ? el.textContent : "";
    });
    ok(/proj 8\.5/.test(tightRow), "projection column league-scored from Sleeper proj stats (TE 8.5)");
    // Locked tap refuses.
    await page.evaluate(() => { [...document.querySelectorAll(".lrow")].find((r) => r.textContent.includes("P. Passer")).click(); });
    ok(/already started/.test(await text(page, "#toast")), "tapping a locked starter toasts instead of opening the sheet");
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
    // Item 7 (2026-08-08): the whole page reads like ESPN's settings page — grouped, plain
    // English, no raw underscore rule codes anywhere in view mode.
    const RAW_KEYS = ["bonus_pass_300", "bonus_pass_400", "bonus_rush_100", "bonus_rec_200", "dst_pa_0", "dst_pa_18_27",
      "pass_yd", "rush_yd", "rec_yd", "fg_0_39", "dst_sack", "off_fum_td", "one_pt_safety", "fg_made_yd", "processDow"];
    ok(RAW_KEYS.every((k) => !summary.includes(k)), "no raw underscore/camelCase rule key is visible in view mode (" + RAW_KEYS.filter((k) => summary.includes(k)).join(",") + ")");
    ok(/Passing yards/.test(summary) && /Passing TD/.test(summary) && /Interception thrown/.test(summary),
      "Scoring → Passing subgroup renders plain-English labels");
    ok(/Reception/.test(summary), "Scoring → Receiving subgroup renders (\"Reception\", not \"rec\")");
    ok(/Field goal made, 0-39 yds/.test(summary), "Scoring → Kicking subgroup renders plain-English labels");
    ok(/0 points allowed/.test(summary) && /1-6 points allowed/.test(summary), "Scoring → the points-allowed bracket table renders as readable ranges");
    ok(/300-399 yd passing game bonus/.test(summary) === false, "a ZERO-valued scoring key (the 300-yd passing bonus, off by default) is hidden in view mode — noise");
    ok(/Passing/.test(summary) && /Rushing/.test(summary) && /Receiving/.test(summary) && /Kicking/.test(summary) && /Defense \/ Special Teams/.test(summary),
      "all the expected Scoring subgroup headings are present");
    // Mirrors lg-ui.js's rosterSummaryLine() against DEFAULT_RULES.roster (QB1/RB2/WR2/TE1/
    // FLEX1/DST1/K1/BENCH7/IR3) — a plain substring check (no regex metachars in this string).
    ok(summary.replace(/\s+/g, " ").includes("1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 D/ST, 1 K · 7 bench · 3 IR"),
      "Roster renders as a derived plain-English lineup summary, not a key/value table");
    ok(/claims process Wednesday 8 AM, ties go to the worse record/.test(summary), "Waivers renders in plain English (day name + 12h clock + tie rule)");
    ok(/starts week 15, week-by-week single elimination/.test(summary), "Playoffs summary describes the week-by-week format");
    ok(/14-week regular season, double round robin/.test(summary), "a Schedule section renders its own plain-English summary");
    // Edit (commissioner PIN prompt -> stub "1234" creates + unlocks).
    await clickIn(page, "#rulesEdit");
    await page.waitForSelector(".redit", { timeout: 5000 });
    // Item 7: a ZERO-valued scoring key — hidden in view mode above — is still present and
    // editable now that we're in edit mode, with the same friendly label (not the raw key).
    const zeroKeyEdit = await page.evaluate(() => {
      const inp = document.querySelector('.redit[data-k="scoring.bonus_pass_300"]');
      return inp ? { present: true, value: inp.value, label: inp.closest("tr").firstElementChild.textContent } : { present: false };
    });
    ok(zeroKeyEdit.present && zeroKeyEdit.value === "0" && /300-399 yd passing game bonus/.test(zeroKeyEdit.label),
      "the zero-valued 300-yd passing bonus IS editable once in edit mode, with its plain-English label (" + JSON.stringify(zeroKeyEdit) + ")");
    ok(await page.evaluate(() => document.getElementById("rulesCancel") != null), "edit mode offers a Cancel button back to view");
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
    // Kicker model (the audit's finding): a 445-yd season at 0.1/yd = 44.5,
    // and Sleeper's fgm_yds normalizes into the same key (dual-source parity).
    const kick = await page.evaluate(() => window.__GFFL__.D.score({ fg_made_yd: 445 }, { fg_made_yd: 0.1 }));
    ok(kick === 44.5, "FG made yards score: 445 yds × 0.1 = 44.5 (" + kick + ")");
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
    // Schedule regenerate + validity. Read back through LG.loadSchedule() (the sanctioned
    // accessor — decodes the Firestore-safe on-disk shape into the plain [[h,a],...][]
    // every reader in the app expects), NOT raw localStorage — see the nested-array note below.
    await clickIn(page, "#schedGen");
    await page.waitForFunction(() => document.body.textContent.includes("Schedule saved"), { timeout: 6000 });
    // Cloud Firestore rejects a document field that's an array directly containing another
    // array (verified live against the real project: "Nested arrays are not allowed") — the
    // raw on-disk doc must never regress to weeks:[[[h,a],...],...] (2 levels of array-in-
    // array) or a real deployed click silently throws with no toast, exactly the live bug
    // report ("the generate schedule button doesn't work"). Every week must be a map ({g:[...]}),
    // never an array, and every game inside it must be a map ({h,a}), never a bare [h,a] pair.
    const rawShape = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).weeks, LSPFX + "sched_2026");
    ok(rawShape.every((wk) => !Array.isArray(wk) && Array.isArray(wk.g) && wk.g.every((g) => !Array.isArray(g) && typeof g.h === "number" && typeof g.a === "number")),
      "on-disk schedule shape has NO array directly containing another array (Firestore-safe — real cloud proven live to reject the raw [[h,a],...][] shape)");
    const sched = await page.evaluate(() => window.__GFFL__.LG.loadSchedule());
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

  // ---- F2: live-bug repro — "the Generate schedule button doesn't work" ----
  // ROOT CAUSE (live 2026-08-07): LG.generateSchedule's in-memory shape ([week][game] =
  // [homeId, awayId]) is an array DIRECTLY containing arrays two levels deep — Cloud
  // Firestore's document model explicitly forbids that ("an array value cannot directly
  // contain another array value"), verified live against the real amen-farms-app project:
  // a setDoc with this exact shape throws "Nested arrays are not allowed" (400). Every
  // suite run before this section stayed in LOCAL mode (gstatic/firebase requests are
  // aborted per house convention), so localStorage's plain JSON.stringify never caught
  // it — the deployed (cloud-backend) site's #schedGen click handler had no try/catch, so
  // the click silently did nothing: no toast, no saved schedule, no visible error at all.
  // This section drives the REAL click path (gate → claim → Rules → tap Generate schedule,
  // with the actual gateCommish() PIN-prompt sequence, not a shortcut) against a fake cloud
  // that enforces the SAME rule real Firestore does, over the REAL, non-contiguous team-id
  // shape a years-old ESPN league actually produces (ruled OUT as a separate hypothesis —
  // LG.generateSchedule is pure array-permutation over whatever ids it's given and works
  // fine with them; confirmed the schedule saves correctly with these ids under the LOCAL
  // backend too, isolating the bug to the cloud/local storage boundary specifically).
  section("F2 · schedGen against a Firestore-faithful cloud backend — the live bug repro");
  {
    const REAL_TEAM_IDS = [1, 2, 3, 4, 5, 9, 11, 12]; // non-contiguous, exactly like the real league
    const names = ["Battle Kreussers", "End Zone Goats", "Wyoming Cowboys", "Waffle House Warriors",
      "Nails  For Breakfast", "Team Six", "Team Seven", "The Goat Kids"];
    const docs = {};
    REAL_TEAM_IDS.forEach((id, i) => { docs["team_" + id] = { kind: "team", teamId: id, name: names[i], abbrev: "T" + id, owner: "" }; });
    const { ctx, page, errors } = await newTestPage(browser, { docs, pass: "amenfarms", team: REAL_TEAM_IDS[0], who: "Peter" });
    await bootPage(page);
    await page.waitForSelector(".mucard, .tbl", { timeout: 9000 });
    const idsSeen = await page.evaluate(() => window.__GFFL__.LG.teams.map((t) => t.id));
    ok(JSON.stringify(idsSeen) === JSON.stringify(REAL_TEAM_IDS), "booted with the real, non-contiguous ESPN team ids " + JSON.stringify(REAL_TEAM_IDS));
    // Install a fake cloud whose .set() enforces Cloud Firestore's REAL "an array can't
    // directly contain another array" rule — proven live against the actual project (a
    // curl PATCH with this exact 3-level-nested weeks shape returned HTTP 400 "Nested
    // arrays are not allowed"; the fixed shape — weeks:[{g:[{h,a},...]},...], array of
    // MAPS only — was separately proven to round-trip through the real project with 200).
    await page.evaluate(() => {
      const LG = window.__GFFL__.LG;
      function assertNoNestedArrays(v, p) {
        if (Array.isArray(v)) {
          for (const item of v) if (Array.isArray(item)) throw new Error("Nested arrays are not allowed" + (p ? " (found in field " + p + ")" : ""));
          for (const item of v) assertNoNestedArrays(item, p);
        } else if (v && typeof v === "object") {
          for (const k of Object.keys(v)) assertNoNestedArrays(v[k], (p ? p + "." : "") + k);
        }
      }
      const store = new Map();
      window.__cloudRejected = false;
      LG.db._installFakeCloud({
        async get(id) { return store.get(id) || null; },
        async set(id, data) {
          try { assertNoNestedArrays(data, id); } catch (e) { window.__cloudRejected = true; throw e; }
          const cur = store.get(id) || {}; store.set(id, { ...cur, ...data });
        },
        async del(id) { store.delete(id); },
        async list(kind) { const out = []; for (const [id, d] of store) if (!kind || d.kind === kind) out.push({ id, ...d }); return out; },
        watch(id, cb) { cb(store.get(id) || null); return () => {}; },
      });
    });
    await page.evaluate(() => window.__GFFL__.UI.show("rules"));
    await page.waitForSelector("#schedGen", { timeout: 9000 });
    ok((await text(page, "#schedGen")).includes("Generate"), "no schedule yet — button reads 'Generate schedule'");
    // Real PIN-prompt sequence (create-on-first-use, exactly like a fresh commissioner) —
    // no shortcut unlock. Also fires a genuine background "onChange" repaint (the perf
    // batch's cloud-only quiet-refresh path) at the same macrotask boundary the prompt
    // resolves on, to rule out a race between the async click handler and a mid-flight
    // re-render replacing #schedGen with a new DOM node underneath it.
    await page.evaluate(() => { window.__prompts = ["9876"]; });
    const renderCountBefore = await page.evaluate(() => {
      let n = 0;
      const orig = window.__GFFL__.UI.show;
      window.__GFFL__.UI.show = function (name) { n++; return orig.call(window.__GFFL__.UI, name); };
      window.__renderCount = () => n;
      setTimeout(() => { window.__GFFL__.LG.db.onChange && window.__GFFL__.LG.db.onChange("team"); }, 0);
      return n;
    });
    await page.evaluate(() => document.querySelector("#schedGen").click());
    await new Promise((r) => setTimeout(r, 400));
    ok((await page.evaluate(() => window.__renderCount())) > renderCountBefore, "an interleaved background repaint (onChange -> UI.show) fired during the click, same as production's perf-batch quiet-refresh path");
    const bodyTxt = await page.evaluate(() => document.body.textContent);
    ok(/Schedule saved: 14 weeks\./.test(bodyTxt), "clicking Generate schedule against a Firestore-faithful cloud backend succeeds and toasts — THIS is the check that fails against the pre-fix code (verified: pre-fix it throws \"Nested arrays are not allowed\" as an unhandled rejection and the toast never appears)");
    ok((await text(page, "#schedGen")).includes("Regenerate"), "button text flips to 'Regenerate schedule' — the module-level `schedule` var was actually updated, not just the toast shown");
    const decoded = await page.evaluate(() => window.__GFFL__.LG.loadSchedule());
    ok(decoded.length === 14, "LG.loadSchedule() reads back 14 weeks through the fake-cloud round trip");
    const pairCount2 = {}; let every8 = true;
    for (const wk of decoded) {
      const seen = new Set();
      for (const [h, a] of wk) { seen.add(h); seen.add(a); const key = [Math.min(h, a), Math.max(h, a)].join("-"); pairCount2[key] = (pairCount2[key] || 0) + 1; }
      if (seen.size !== 8) every8 = false;
    }
    ok(every8, "every week: all 8 real (non-contiguous) team ids appear exactly once");
    ok(Object.keys(pairCount2).length === 28 && Object.values(pairCount2).every((n) => n === 2), "true double round robin over the real team ids, saved through the Firestore-faithful backend (28 pairs x2)");
    ok((await page.evaluate(() => window.__cloudRejected)) === false, "the fake cloud's nested-array guard was never tripped — the saved doc really is Firestore-safe");
    ok(errors.length === 0, "0 page errors — no uncaught \"Nested arrays are not allowed\" rejection reaches the console");
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
    // H2: the re-skin's own desktop breakpoint (1024px+) — the design's mockup is drawn at
    // 1440px, so that's what's screenshotted; asserts the top-nav bar (header + #bnav sharing
    // one strip) and the league-home multi-column treatment are actually live at this width,
    // not just present in the stylesheet.
    const { ctx, page, errors } = await newTestPage(browser, fullSeed(), { vw: { width: 1440, height: 900 } });
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    const scroll = await page.evaluate(() => ({ b: document.body.scrollWidth, w: window.innerWidth }));
    ok(scroll.b <= scroll.w + 1, "no sideways scroll at 1440px (" + scroll.b + "/" + scroll.w + ")");
    const geom = await page.evaluate(() => {
      const bnav = getComputedStyle(document.querySelector("#bnav"));
      const main = getComputedStyle(document.querySelector("main"));
      const hMeta = document.querySelector("#hMeta");
      return { bnavPos: bnav.position, mainCols: main.columnCount, hMetaVisible: hMeta && getComputedStyle(hMeta).display !== "none" };
    });
    ok(geom.bnavPos === "sticky", "desktop nav reads as a persistent top strip (position:sticky), not the mobile fixed bottom bar");
    // 1440px clears the stylesheet's own 1360px "go to 3 columns" step, so 3 is correct here —
    // ">= 2" is the real invariant (any desktop width picks up SOME multi-column treatment).
    ok(Number(geom.mainCols) >= 2, "league home picks up the desktop multi-column treatment (" + geom.mainCols + ")");
    ok(geom.hMetaVisible === true, "the header's WEEK N · YEAR + avatar meta is visible at this width");
    ok(errors.length === 0, "0 page errors on the 1440px league home");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_league_desktop_1440.png"), fullPage: true }); console.log("  📸 shots/gffl_league_desktop_1440.png"); }
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
    // I0 (item 1, 2026-08-08): a real, browsable free-agent table — position chips + an
    // OPTIONAL search box, sorted by search_rank, both feeding one panner'd table. This
    // fixture's whole unowned pool is exactly 4 players: KC D/ST, DEN D/ST (DST), F. Agent
    // (WR, KC), A. Vail (K, DEN) — every other slpPlayersFix entry is already on team1's or
    // team2's roster.
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForSelector("#faPosChips", { timeout: 9000 });
    // Browse mode: no query typed at all — the table is populated by DEFAULT, not empty until
    // someone types (the old behavior: nothing shown under 3 characters).
    await page.waitForFunction(() => document.querySelectorAll("#faResults [data-fi]").length > 0, { timeout: 5000 });
    const browseNames = await page.$$eval("#faResults [data-fi]", (els) => els.map((e) => e.textContent));
    ok(browseNames.length === 4, "browse mode (no query) lists all 4 unowned free agents by default (" + browseNames.length + ")");
    ok(browseNames.some((t) => /KC D\/ST/.test(t)) && browseNames.some((t) => /DEN D\/ST/.test(t)) &&
       browseNames.some((t) => /F\. Agent/.test(t)) && browseNames.some((t) => /A\. Vail/.test(t)),
      "…and it's genuinely all four (both D/STs, the free WR, the free K)");
    // Position chips narrow the SAME table without typing anything.
    await clickIn(page, ".poschip", "WR");
    await page.waitForFunction(() => document.querySelectorAll("#faResults [data-fi]").length === 1, { timeout: 5000 });
    const wrOnly = await page.$$eval("#faResults [data-fi]", (els) => els.map((e) => e.textContent).join("|"));
    ok(/F\. Agent/.test(wrOnly) && !/D\/ST/.test(wrOnly) && !/A\. Vail/.test(wrOnly), "WR chip narrows to exactly the one free WR (" + wrOnly + ")");
    await clickIn(page, ".poschip", "K");
    await page.waitForFunction(() => document.querySelectorAll("#faResults [data-fi]").length === 1, { timeout: 5000 });
    ok(/A\. Vail/.test(await page.$eval("#faResults", (e) => e.textContent)), "K chip narrows to exactly the one free kicker");
    await clickIn(page, ".poschip", "DST");
    await page.waitForFunction(() => document.querySelectorAll("#faResults [data-fi]").length === 2, { timeout: 5000 });
    const dstOnly = await page.$eval("#faResults", (e) => e.textContent);
    ok(/KC D\/ST/.test(dstOnly) && /DEN D\/ST/.test(dstOnly) && !/F\. Agent/.test(dstOnly), "DST chip narrows to exactly the two free D/STs");
    ok(await page.$eval('.poschip[data-pos="DST"]', (e) => e.classList.contains("on")), "the active chip carries the visual \"on\" state");
    await clickIn(page, ".poschip", "ALL");
    await page.waitForFunction(() => document.querySelectorAll("#faResults [data-fi]").length === 4, { timeout: 5000 });
    ok(true, "ALL chip resets back to the full browse list");
    // Every row shows a projection (or the honest "—" — none of this fixture's free agents has
    // a Sleeper projection on file, so "—" IS the correct, exercised path here).
    const projTexts = await page.$$eval("#faResults .faproj", (els) => els.map((e) => e.textContent.trim()));
    ok(projTexts.length === 4 && projTexts.every((t) => t === "—"), "every browsed row renders a PROJ column (all \"—\" here — no projections on file for these four)");
    // ADD works from browse mode too (not just after typing a search) — pre-deadline = a queued
    // claim with a bid, exactly the same claim-sheet flow as a typed search.
    await clickIn(page, "#faResults [data-fi]", "A. Vail");
    await page.waitForSelector("#claimSheet [data-di]", { timeout: 5000 });
    ok(/Claim A\. Vail/.test(await page.$eval("#claimSheet", (e) => e.textContent)), "tapping a browsed row (no search typed) opens the claim sheet for that player");
    await clickIn(page, "#claimSheet [data-di]", "B. Backup");
    await clickIn(page, "#claimGo");
    await page.waitForFunction(() => (document.querySelector("#mvMyClaims") || {}).textContent && document.querySelector("#mvMyClaims").textContent.includes("A. Vail"), { timeout: 5000 });
    ok(true, "claiming straight from the browse table (pre-deadline) queues a claim exactly like a searched one");
    // Post-deadline: ADD (not Claim) instant-adds, same as the old search-driven flow — proven
    // once already for the search path in I1 below; here proven from browse mode specifically.
    await page.evaluate((ts) => { window.__GFFL__.LG.nowOverride = ts; }, Date.now() + 365 * 24 * 3600 * 1000);
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForSelector("#faPosChips", { timeout: 9000 });
    await page.waitForFunction(() => document.querySelectorAll("#faResults [data-fi]").length > 0, { timeout: 5000 });
    const addBtnTxt = await page.$eval("#faResults .faAddBtn", (e) => e.textContent.trim());
    ok(addBtnTxt === "Add", "past the waiver deadline the row button reads \"Add\", not \"Claim\"");
    await clickIn(page, "#faResults [data-fi]", "F. Agent");
    await page.waitForSelector("#claimSheet [data-di]", { timeout: 5000 });
    await clickIn(page, "#claimSheet [data-di]", "H. Healthy");
    await clickIn(page, "#claimGo");
    await sleep(300);
    const rosterAfterAdd = await page.evaluate(() => window.__GFFL__.LG.loadRoster(1, 1));
    ok(rosterAfterAdd.some((p) => p.name === "F. Agent"), "instant ADD from browse mode (post-deadline) lands on the roster immediately");
    await page.evaluate(() => { window.__GFFL__.LG.nowOverride = null; });
    ok(errors.length === 0, "0 page errors through the browse/chip/ADD-and-CLAIM flow");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_moves_fa_390.png"), fullPage: true }); console.log("  📸 shots/gffl_moves_fa_390.png"); }
    await ctx.close();
  }
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
    // Not one of the brief's required shots, but Moves is the app's densest page
    // (pending claims + FAAB + free-agent search + trade builder + tx log all at
    // once) — a quick visual QA capture of the re-skin there too, cheap to keep.
    if (SHOTS) { await page1.screenshot({ path: path.join(ROOT, "shots", "gffl_moves_390.png"), fullPage: true }); console.log("  📸 shots/gffl_moves_390.png"); }
    // RESTAGED 2026-08-08 (adversarial review, findings 2/5/12): a claim is its OWN document
    // now (`claim_<season>_w<week>_<claimId>`), not an entry in a shared array inside the
    // weekly doc — a shared array is a read-modify-write, and both backends replace an array
    // field wholesale, so two owners submitting from two phones erased each other's FAAB bids
    // with no trace. Same assertion, at the doc the claim actually lives in now.
    const allDocs1 = await snapshotAllDocs(page1);
    const claimKeys = Object.keys(allDocs1).filter((k) => k.startsWith("claim_2026_w1_"));
    const claimDoc = claimKeys.length === 1 ? allDocs1[claimKeys[0]] : null;
    ok(claimDoc && claimDoc.kind === "claim" && claimDoc.week === 1 && claimDoc.bid === 25 && claimDoc.teamId === 1,
      "the claim persisted as its OWN doc (team 1, $25, unprocessed) — " + JSON.stringify(claimKeys));
    ok(!allDocs1.claims_2026_w1 || !(allDocs1.claims_2026_w1.claims || []).length,
      "…and the shared weekly claims doc holds no claims array for anyone to overwrite");

    const base2 = fullSeed();
    const { ctx: ctx2, page: page2, errors: err2 } = await newTestPage(browser,
      { docs: { ...base2.docs, ...Object.fromEntries(claimKeys.map((k) => [k, allDocs1[k]])) }, pass: "amenfarms", team: 2, who: "Rival" });
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
    // RESTAGED 2026-08-08: a cancel DELETES that claim's own doc (see I1's note).
    const afterCancel = await snapshotAllDocs(page);
    ok(Object.keys(afterCancel).filter((k) => k.startsWith("claim_2026_w1_")).length === 0,
      "…and the claim's own doc is gone from storage");
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
    await page1.evaluate((id) => document.querySelector(`.chatReact[data-mid="${id}"][data-e="FIRE"]`).click(), mid);
    await page1.waitForFunction((id) => document.querySelector(`.chatReact[data-mid="${id}"][data-e="FIRE"]`).textContent.includes("1"), { timeout: 5000 }, mid);
    ok(true, "tapping a reaction toggles it on and the count renders");
    const after1 = await page1.evaluate((id) => window.__GFFL__.LG.loadChat(null).then((m) => m.find((x) => x.id === id).reactions["FIRE"]), mid);
    ok(Array.isArray(after1) && after1.includes(1), "reaction doc carries the reacting team's id");
    await page1.evaluate((id) => document.querySelector(`.chatReact[data-mid="${id}"][data-e="FIRE"]`).click(), mid);
    await page1.waitForFunction((id) => !document.querySelector(`.chatReact[data-mid="${id}"][data-e="FIRE"]`).textContent.includes("1"), { timeout: 5000 }, mid);
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
    ok(r.some((t) => /^Trade:/.test(t) && /W\. Receiver/.test(t)), "an executed trade posts the trade sentence with the real player names");
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
    // Regression guard for the cache-corruption bug this test caught: cacheUpsert() used to
    // build its list-cache row as {id, ...doc} (id spread FIRST), so a stray numeric `.id`
    // field already sitting inside `doc` (every in-memory team object carries one — see
    // LG.loadTeams()) silently clobbered the real string doc-id, the next upsert's own
    // findIndex could no longer find the row it had just written, and a stale DUPLICATE got
    // pushed instead of updating in place — LG.teamById kept returning the pre-edit team
    // forever. Prove logoData survived the round trip too (same object, same bug class).
    const savedLogo = await page1.evaluate(() => window.__GFFL__.LG.teamById(1).logoData);
    ok(typeof savedLogo === "string" && savedLogo.startsWith("data:image/"),
      "…and the logo image itself (not just the colour) survives — no stale duplicate shadowing the edited team");
    const listedOnce = await page1.evaluate(() => window.__GFFL__.LG.teams.filter((t) => t.id === 1).length);
    ok(listedOnce === 1, "…and LG.teams has exactly ONE row for team 1 after two consecutive saves — no duplicate left behind in the list cache");

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

    // Tap-through from standings / "My Team" nav (item 3, 2026-08-07: "My Team" IS the locker
    // now, so there's no separate "My locker" button on a team page to click through any more —
    // RESTAGED to prove the nav itself lands on the viewer's OWN locker directly).
    await page2.evaluate(() => window.__GFFL__.UI.show("league"));
    await page2.waitForSelector(".teamlink", { timeout: 9000 });
    await clickIn(page2, ".teamlink", "Battle Kreussers");
    await page2.waitForFunction(() => document.body.textContent.includes("Go Kreussers!"), { timeout: 5000 });
    ok(true, "tapping a team name in the standings opens their locker");
    ok((await page2.evaluate(() => window.__GFFL__.UI.lockerTeamId)) === 1, "…someone else's locker (team 1), while viewing as team 2");
    await page2.evaluate(() => window.__GFFL__.UI.show("team"));
    await page2.waitForSelector(".lockerhead", { timeout: 9000 });
    const lockerId2 = await page2.evaluate(() => window.__GFFL__.UI.lockerTeamId);
    ok(lockerId2 === 2, "…and tapping \"My Team\" nav from there jumps straight to the VIEWER's own locker (team 2)");

    ok(err1.length === 0 && err2.length === 0, "0 page errors through the whole locker flow");
    if (SHOTS) { await page1.screenshot({ path: path.join(ROOT, "shots", "gffl_locker_390.png"), fullPage: true }); console.log("  📸 shots/gffl_locker_390.png"); }
    await ctx1.close(); await ctx2.close();
  }

  // ---- M: weekly finalization + projections + power rankings + weekly awards (S5) ----
  section("M · finalization — official scores, accuracy, power rankings, awards, AI read");

  // M1: the whole finalize flow, hand-computed end to end — guard, force, real numbers,
  // awards, accuracy, power snapshot, standings, the sys chat post, and idempotency.
  {
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    // Real fixture data loads, then polling STOPS (waitLive's own contract) — everything from
    // here on is deterministic direct manipulation, safe from any further background poll.
    await waitLive(page);

    // Guard: every one of week 1's starters' games is still "in" -> refuse.
    await page.evaluate(() => {
      const D = window.__GFFL__.D;
      ["PHI", "DAL", "DEN", "KC"].forEach((ab) => D.S.games.set(ab, { state: "in", period: 3, clock: "5:00" }));
    });
    const guarded = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(1));
    ok(guarded.ok === false && guarded.reason === "not-final" && guarded.pending.length === 12,
      "finalizeWeek refuses while starters' games are still live (12 pending — team1's 9 + team2's 3)");
    ok(!(await page.evaluate(() => window.__GFFL__.LG.loadWeekly(1))), "…and no weekly doc was written");

    // force:true bypasses the guard (still computes from whatever's currently on the board).
    const forced = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(1, { force: true }));
    ok(forced.ok === true && forced.kind === "weekly", "force:true bypasses the guard and finalizes anyway");
    // Undo the force-finalize (doc AND its own sys chat post) so the rest of this test
    // exercises the real, un-forced numbers against a clean slate.
    await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      await LG.db.del("weekly_2026_w1");
      const chats = await LG.loadAllChat();
      const forceMsg = chats.find((m) => m.sys && /Week 1 is official/.test(m.text || ""));
      if (forceMsg) await LG.db.del(forceMsg.id);
    });
    ok(!(await page.evaluate(() => window.__GFFL__.LG.loadWeekly(1))), "…the doc is gone again, ready for the real run");

    // The hand-computable scenario: every relevant game final, exact per-player points, a
    // seeded bench player (B. Backup, 50 pts) who should have started over the actual FLEX
    // (F. Flexman, 2 pts) — the Bench Blunder case — and a pre-game projection snapshot for
    // the accuracy scoreboard to grade against.
    await page.evaluate(() => {
      const D = window.__GFFL__.D;
      const setP = (key, name, team, pos, pts) =>
        D.S.players.set(key, { key, name, team, pos, pts, espn: null, slp: null, official: null, injury: "", src: "", conflict: false, last: 0 });
      setP("3915511", "P. Passer", "PHI", "QB", 25);
      setP("4241457", "R. Rusher", "DAL", "RB", 10);
      setP("111888", "S. Second", "DEN", "RB", 8);
      setP("4361741", "W. Receiver", "PHI", "WR", 15);
      setP("111555", "W. Two", "DEN", "WR", 6);
      setP("111222", "T. Tight", "KC", "TE", 5);
      setP("111444", "F. Flexman", "DEN", "RB", 2);
      setP("dst_PHI", "PHI D/ST", "PHI", "DST", 9);
      setP("2473037", "K. Kicker", "DAL", "K", 7);
      setP("111333", "B. Backup", "KC", "RB", 50);
      setP("111666", "I. Injured", "KC", "WR", 1);
      setP("111777", "H. Healthy", "DEN", "WR", 3);
      setP("222111", "Q. Rival", "DAL", "QB", 20);
      setP("222333", "X. Wideout", "PHI", "WR", 12);
      setP("dst_DAL", "DAL D/ST", "DAL", "DST", 4);
      ["PHI", "DAL", "DEN", "KC"].forEach((ab) => D.S.games.set(ab, { state: "post", period: 4, clock: "0:00" }));
      const table = { "3915511": 20, "4361741": 10, "111444": 12, "111888": 9, "2473037": 5, "222111": 15, "222333": 8 };
      D.projFor = (key) => (key in table ? table[key] : null);
    });
    await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      await LG.db.set(LG.projSnapId(LG.SEASON, 1), { kind: "projsnap", week: 1, players: [
        { key: "3915511", name: "P. Passer", teamId: 1, proj: 20 },
        { key: "4361741", name: "W. Receiver", teamId: 1, proj: 10 },
        { key: "111444", name: "F. Flexman", teamId: 1, proj: 12 },
        { key: "222111", name: "Q. Rival", teamId: 2, proj: 15 },
      ] });
    });

    const chatBefore = (await page.evaluate(() => window.__GFFL__.LG.loadAllChat())).length;
    const r1 = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(1));
    ok(r1.ok === true, "finalizeWeek succeeds once every relevant game reads post");
    ok(r1.matchups.length === 4, "4 matchups written for week 1");
    const m1 = r1.matchups.find((m) => m.home === 1 && m.away === 2);
    ok(!!m1 && m1.homePts === 87 && m1.awayPts === 36, "hand-computed totals: team1 87.0, team2 36.0 (" + JSON.stringify(m1) + ")");
    const m2 = r1.matchups.find((m) => m.home === 3);
    ok(!!m2 && m2.homePts === 0 && m2.awayPts === 0, "an empty-roster matchup finalizes at 0-0, not an error");

    ok(!!r1.awards.topScore && r1.awards.topScore.teamId === 1 && r1.awards.topScore.pts === 87,
      "🏅 Top Score: team1 (87.0)");
    ok(!!r1.awards.bust && r1.awards.bust.name === "F. Flexman" && r1.awards.bust.shortfall === 10,
      "💀 Bust of the Week: F. Flexman, proj 12 → actual 2, shortfall 10.0 — the biggest of anyone with proj ≥8 (" + JSON.stringify(r1.awards.bust) + ")");
    ok(!!r1.awards.benchBlunder && r1.awards.benchBlunder.teamId === 1 && r1.awards.benchBlunder.diff === 48,
      "🪑 Bench Blunder: team1 left 48.0 on the bench (optimal 135.0 vs actual 87.0 — B. Backup(50) should have started over F. Flexman(2))");

    ok(!!r1.accuracy && r1.accuracy.n === 4 && r1.accuracy.ours === 6.25,
      "📈 accuracy: mean |proj-actual| over the 4 snapshotted starters = 6.25 (" + JSON.stringify(r1.accuracy) + ")");

    const p1 = r1.power.find((p) => p.teamId === 1), p2 = r1.power.find((p) => p.teamId === 2);
    ok(r1.power.length === 8 && !!p1 && p1.rank === 1 && !!p2 && p2.rank === 2,
      "🏆 power rankings snapshot written into the doc — team1 #1, team2 #2");
    ok(p1.score === 10.35, "team1's power score hand-computed: 4×1 + 0.05×87 + 2×1 = 10.35 (" + p1.score + ")");
    ok(p2.score === 1.8, "team2's power score hand-computed: 4×0 + 0.05×36 + 2×0 = 1.8 (" + p2.score + ")");

    const stAfter = await page.evaluate(() => window.__GFFL__.LG.loadStandings());
    ok(stAfter[1].w === 1 && stAfter[1].pf === 87 && stAfter[2].l === 1 && stAfter[2].pf === 36,
      "LG.loadStandings() reflects the finalized week — nothing else needed to change");

    const chat1 = await page.evaluate(() => window.__GFFL__.LG.loadAllChat());
    ok(chat1.length === chatBefore + 1, "exactly one new chat message was posted");
    const sys = chat1.filter((m) => m.sys && /Week 1 is official/.test(m.text || ""));
    ok(sys.length === 1, "…and it's the sys announcement");
    ok(/Top score: Battle Kreussers \(87\.0\)/.test(sys[0].text) && /Bust of the week: F\. Flexman/.test(sys[0].text)
      && /Bench blunder: Battle Kreussers left 48\.0/.test(sys[0].text),
      "…naming the top score, the bust, and the bench blunder (" + sys[0].text + ")");

    // Idempotent: a second call returns the SAME doc, untouched — no recomputation, no
    // duplicate chat post.
    const r2 = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(1));
    ok(r2.ok === true && r2.finalizedAt === r1.finalizedAt, "re-calling finalizeWeek returns the SAME doc untouched (idempotent)");
    const chat2 = await page.evaluate(() => window.__GFFL__.LG.loadAllChat());
    ok(chat2.length === chat1.length, "…and posts no duplicate chat message");

    ok(errors.length === 0, "0 page errors through the finalize flow");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_league_390.png"), fullPage: true }); console.log("  📸 shots/gffl_league_390.png"); }
    await ctx.close();
  }

  // M2: auto-finalize on boot only ever touches a PAST week (week < currentWeek()) — never the
  // live/current one, even when that week's own data would otherwise pass the guard too.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    // A real 2-week schedule (both weeks share the same pairings — fine for this boundary
    // check) so week 2 genuinely COULD be finalized if the week<currentWeek() guard were wrong.
    await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      const wk1 = [[1, 2], [3, 4], [5, 6], [7, 8]];
      await LG.saveSchedule([wk1, wk1]);
    });
    await page.evaluate(() => {
      const D = window.__GFFL__.D;
      const keys = ["3915511", "4241457", "111888", "4361741", "111555", "111222", "111444", "dst_PHI", "2473037", "222111", "222333", "dst_DAL"];
      keys.forEach((k) => { const row = D.S.players.get(k) || { key: k, name: k, team: "", pos: "" }; row.pts = 10; D.S.players.set(k, row); });
      ["PHI", "DAL", "DEN", "KC"].forEach((ab) => D.S.games.set(ab, { state: "post", period: 4, clock: "0:00" }));
    });
    await page.evaluate(() => {
      const LG = window.__GFFL__.LG;
      const start = new Date(LG.SEASON_START + "T05:00:00-05:00").getTime();
      LG.nowOverride = start + 8 * 24 * 3600 * 1000; // 8 days into the season -> week 2
    });
    const cw = await page.evaluate(() => window.__GFFL__.LG.currentWeek());
    ok(cw === 2, "currentWeek() reads 2 under the simulated clock (8 days into the season)");
    ok(!(await page.evaluate(() => window.__GFFL__.LG.loadWeekly(1))), "week 1's weekly doc doesn't exist yet");
    await page.evaluate(() => window.__GFFL__.UI.maybeAutoFinalizeWeeks());
    const after1 = await page.evaluate(() => window.__GFFL__.LG.loadWeekly(1));
    ok(!!after1 && after1.kind === "weekly", "week 1 (< currentWeek()) got auto-finalized");
    const after2 = await page.evaluate(() => window.__GFFL__.LG.loadWeekly(2));
    ok(!after2, "week 2 (== currentWeek(), the LIVE week) was never touched, even though its own data would have passed the guard too");
    await page.evaluate(() => { window.__GFFL__.LG.nowOverride = null; });
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // M3: projection snapshot — once per week, per device-first-in; skips already-started games.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    // startData() ALSO fires this at boot (device-first-in, chained off initSleeper()'s own
    // promise) — by now it's had time to run and already claimed week 1's snapshot slot using
    // whatever the real fixture's projections were. That's the feature working, not a bug —
    // prove it, then clear the slot so the rest of THIS test can drive snapshotProjections in
    // isolation against its own hand-picked scenario.
    const autoSnap = await page.evaluate(() => window.__GFFL__.LG.loadProjSnap(1));
    ok(!!autoSnap && autoSnap.kind === "projsnap" && autoSnap.players.length > 0,
      "the boot-time auto-snapshot already claimed week 1's slot on its own, using real fixture data");
    await page.evaluate(() => window.__GFFL__.LG.db.del(window.__GFFL__.LG.projSnapId(window.__GFFL__.LG.SEASON, 1)));

    // Seed + call atomically in ONE evaluate — a stray timer/promise continuation from the
    // (stopped) poll loop must never land BETWEEN the seed and the call and race it.
    const snap1 = await page.evaluate(() => {
      const D = window.__GFFL__.D;
      D.S.games.set("PHI", { state: "pre" });
      D.S.games.set("DAL", { state: "in", period: 2, clock: "5:00" }); // Rusher + Kicker already live
      D.S.games.set("DEN", { state: "pre" });
      D.S.games.set("KC", { state: "pre" });
      const table = { "3915511": 20, "4361741": 12, "111888": 9, "111555": 6, "111222": 5, "111444": 8, "4241457": 11, "2473037": 6, "222111": 15, "222333": 8 };
      D.projFor = (key) => (key in table ? table[key] : null);
      return window.__GFFL__.LG.snapshotProjections(1);
    });
    ok(!!snap1 && snap1.kind === "projsnap", "the first attempt writes a snapshot");
    const keys1 = snap1.players.map((p) => p.key);
    ok(!keys1.includes("4241457") && !keys1.includes("2473037"), "starters whose game already started (DAL) are excluded");
    ok(keys1.includes("3915511") && keys1.includes("4361741"), "still-pre-game starters ARE captured");
    ok(snap1.players.find((p) => p.key === "3915511").proj === 20, "the captured proj matches D.projFor at the moment of the snapshot");

    // A second attempt, with the data now looking totally different, must NOT overwrite it.
    const snap2 = await page.evaluate(() => {
      const D = window.__GFFL__.D;
      D.S.games.set("PHI", { state: "post" });
      D.projFor = () => 999;
      return window.__GFFL__.LG.snapshotProjections(1);
    });
    ok(snap2.at === snap1.at && snap2.players.length === snap1.players.length,
      "a second call returns the SAME snapshot untouched — one device wins, for the whole week");
    ok(!snap2.players.some((p) => p.proj === 999), "…the later (wrong) data never leaked in");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // M4: power rankings ordering + movement arrows against the prior finalized week's own
  // snapshot (synthetic weekly docs — direct data, independent of the live-data guard above).
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      await LG.db.set(LG.weeklyId(2026, 1), { kind: "weekly", week: 1, matchups: [],
        power: [{ teamId: 1, score: 10, rank: 1 }, { teamId: 2, score: 8, rank: 2 }, { teamId: 3, score: 5, rank: 3 }] });
      await LG.db.set(LG.weeklyId(2026, 2), { kind: "weekly", week: 2, matchups: [],
        power: [{ teamId: 3, score: 20, rank: 1 }, { teamId: 1, score: 9, rank: 2 }, { teamId: 2, score: 8, rank: 3 }] });
    });
    await page.evaluate(() => { window.__GFFL__.UI.week = 2; });
    await page.evaluate(() => window.__GFFL__.UI.renderLeague());
    await page.waitForFunction(() => document.body.textContent.includes("Power rankings"), { timeout: 5000 });
    const rows = await page.evaluate(() => {
      const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.includes("Power rankings"));
      const card = h2.closest(".card");
      return [...card.querySelectorAll(".rowline")].map((el) => el.textContent.replace(/\s+/g, " ").trim());
    });
    ok(rows.length === 3, "power rankings card lists the 3 teams that have a snapshot for week 2 (" + rows.length + ")");
    ok(/^#1/.test(rows[0]) && /Wyoming Cowboys/.test(rows[0]) && /▲2/.test(rows[0]), "team3 climbed #3→#1 — ▲2 shown (" + rows[0] + ")");
    ok(/^#2/.test(rows[1]) && /Battle Kreussers/.test(rows[1]) && /▼1/.test(rows[1]), "team1 dropped #1→#2 — ▼1 shown (" + rows[1] + ")");
    ok(/^#3/.test(rows[2]) && /End Zone Goats/.test(rows[2]) && /▼1/.test(rows[2]), "team2 dropped #2→#3 — ▼1 shown (" + rows[2] + ")");
    ok(/through week 2/.test(await page.evaluate(() => document.body.textContent)), "the card labels which week it's through — always the LATEST finalized week, independent of which week you happen to be browsing");
    // With only week 1 on file, there's no PRIOR week to compare against — a dash, not an arrow.
    await page.evaluate(() => window.__GFFL__.LG.db.del(window.__GFFL__.LG.weeklyId(2026, 2)));
    await page.evaluate(() => window.__GFFL__.UI.renderLeague());
    await page.waitForFunction(() => document.body.textContent.includes("through week 1"), { timeout: 5000 });
    const rows1 = await page.evaluate(() => {
      const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.includes("Power rankings"));
      const card = h2.closest(".card");
      return [...card.querySelectorAll(".rowline")].map((el) => el.textContent.replace(/\s+/g, " ").trim());
    });
    ok(rows1.length === 3 && !rows1.some((r) => /[▲▼]/.test(r)),
      "…and week 1 alone (no prior week on file) shows no movement arrows for anyone (" + JSON.stringify(rows1) + ")");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // M5a: the AI read degrades silently when the model is unreachable/unconfigured — a toast,
  // never a broken card, never a page error.
  {
    const savedKey = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY; // and no ANTHROPIC_API_KEY is configured in this suite either
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await clickIn(page, ".mucard.mine");
    await page.waitForSelector("#aiReadBtn", { timeout: 9000 });
    await clickIn(page, "#aiReadBtn");
    await page.waitForFunction(() => /isn.t available/.test(document.querySelector("#aiReadOut").textContent), { timeout: 9000 });
    ok(true, "with the model fully unreachable, the card shows a friendly note instead of hanging or breaking");
    ok(!(await page.$("#aiReadBtn[disabled]")), "…and the button re-enables itself for another try");
    ok(errors.length === 0, "0 page errors even on a total AI outage");
    process.env.XAI_API_KEY = savedKey;
    await ctx.close();
  }

  // M5b: the wire + applying the returned multiplier to a REAL rendered projection.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await clickIn(page, ".mucard.mine");
    await page.waitForSelector("#aiReadBtn", { timeout: 9000 });
    ok(/Tap for live adjustments/.test((await text(page, "#aiReadOut")) || ""), "an inviting placeholder shows before the button is used");

    const xaiBefore = xaiReqs.length;
    await clickIn(page, "#aiReadBtn");
    await page.waitForFunction(() => {
      const el = document.querySelector("#aiReadOut");
      return el && /T\. Tight/.test(el.textContent) && !/Reading the game/.test(el.textContent);
    }, { timeout: 9000 });
    ok(xaiReqs.length === xaiBefore + 1, "the button fires exactly one request to the AI");
    const w = xaiReqs[xaiReqs.length - 1];
    ok(w && w.model === "grok-4.5", "…on Grok 4.5");
    const sysMsg = (w.messages && w.messages[0] && w.messages[0].content) || "";
    ok(/live in-game fantasy football projection adjuster/.test(sysMsg) && /STRICT JSON ONLY/.test(sysMsg), "GFFLPROJ_SYSTEM is stamped server-side");
    const turn = (w.messages && w.messages[1] && w.messages[1].content) || "";
    ok(/CURRENT MATCHUP — week 1/.test(turn) && turn.includes('"T. Tight"') && turn.includes('"gameState"'),
      "the request carries the real matchup — week number, real player names, real game state");

    const mult = await page.evaluate(() => (window.__GFFL__.UI._aiRead && window.__GFFL__.UI._aiRead.mults) || {})
      .then((m) => m["T. Tight"]);
    ok(!!mult && mult.mult === 1.25, "the parsed multiplier is exactly 1.25");
    ok(mult.proj != null && mult.adj === Math.round(mult.proj * 1.25 * 100) / 100,
      "the CLIENT computes the adjusted projection = proj × mult (proj " + mult.proj + " → adj " + mult.adj + ")");
    const rendered = (await text(page, "#aiReadOut")) || "";
    const projTxt = await page.evaluate((p) => window.__GFFL__.LG.fmtPts(p), mult.proj);
    const adjTxt = await page.evaluate((p) => window.__GFFL__.LG.fmtPts(p), mult.adj);
    ok(rendered.includes(projTxt) && rendered.includes(adjTxt) && rendered.includes("×1.25"),
      "…and BOTH the original and the adjusted projection are on the rendered card, with the multiplier (" + projTxt + " → " + adjTxt + ")");
    ok(/garbage time/.test(rendered), "the model's one-line reason renders too");

    // A second tap within the 5-minute cache window doesn't re-spend.
    const xaiAfter1 = xaiReqs.length;
    await clickIn(page, "#aiReadBtn");
    await sleep(150);
    ok(xaiReqs.length === xaiAfter1, "a second tap inside the 5-minute cache window fires no new request");

    ok(errors.length === 0, "0 page errors through the AI read flow");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_ai_read_390.png"), fullPage: true }); console.log("  📸 shots/gffl_ai_read_390.png"); }
    await ctx.close();
  }

  // ---- N: ESPN history import + record book + rivalries (S6) ----
  section("N · ESPN history import + record book + rivalries");

  // N1: the raw action, in process — slimming, the retry ladder, champion/place, the
  // 0-0-skip rule, and the no-season/out-of-range refusals. No browser needed.
  {
    const callHist = async (season) => {
      const r = await leagueFn(new Request("http://fn/", { method: "POST", body: JSON.stringify({ secret: "amenfarms", action: "lg_espn_history", season }) }));
      return JSON.parse(await r.text());
    };
    const h2024 = await callHist(2024);
    ok(h2024.ok === true && h2024.leagueName === "Nerd Fantasy Football League", "2024 import reaches the league (" + h2024.leagueName + ")");
    const bk24 = h2024.teams.find((t) => t.id === 1), ezg24 = h2024.teams.find((t) => t.id === 2);
    ok(!!bk24 && bk24.w === 9 && bk24.l === 5 && bk24.pf === 1450.4 && bk24.pa === 1300.1 && bk24.place === 2,
      "team slims record.overall + place from rankCalculatedFinal (Battle Kreussers 9-5, pf 1450.4, place 2)");
    ok(!!ezg24 && ezg24.place === 1, "End Zone Goats' place is 1 (rankCalculatedFinal)");
    ok(h2024.champion && h2024.champion.teamId === 2 && h2024.champion.name === "End Zone Goats",
      "champion = the rankCalculatedFinal===1 team (End Zone Goats)");
    ok(h2024.matchups.length === 2, "the 0-0 bye/unplayed matchup is skipped (2 real matchups, not 3)");
    const m1 = h2024.matchups.find((m) => m.week === 1);
    ok(!!m1 && m1.home === 1 && m1.away === 2 && m1.homePts === 182.4 && m1.awayPts === 88.2,
      "matchup fields: week = matchupPeriodId, home/away = teamId, homePts/awayPts = totalPoints");
    // 2023's fixture is only readable via the scoringPeriodId=0 retry (the plain URL
    // deliberately comes back empty) — proves the retry ladder actually fires, not
    // just that the happy path works.
    const h2023 = await callHist(2023);
    ok(h2023.ok === true && h2023.champion.teamId === 1, "2023 import succeeds via the retry ladder — champion Battle Kreussers");
    const noSeason = await callHist(2022);
    ok(noSeason.ok === false && noSeason.reason === "no-season", "an empty league season -> ok:false, reason:no-season");
    const badRange = await callHist(1999);
    ok(badRange.ok === false && badRange.reason === "no-season", "an out-of-range season is refused before ever touching the network");
  }

  // N2-N6: the client — import loop, record book, head-to-head, matchup line, locker.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });

    // N2: the client import loop — writes hist_2024 + hist_2023, STOPS at the first
    // miss (2022) because by then it already has a success; 2025 (the league's
    // current-year-minus-1 starting point) misses FIRST with zero successes yet, so
    // it correctly keeps trying older seasons instead of giving up right away.
    await page.evaluate(() => window.__GFFL__.UI.show("rules"));
    await page.waitForSelector("#historyImport", { timeout: 5000 });
    await clickIn(page, "#historyImport"); // gates the commissioner PIN (create-on-first-use)
    await page.waitForFunction(() => /Imported \d+ season/.test(document.querySelector("#importOut").textContent), { timeout: 15000 });
    const impText = await page.evaluate(() => document.querySelector("#importOut").textContent);
    ok(/Imported 2 seasons/.test(impText) && /2023/.test(impText) && /2024/.test(impText),
      "import summary names both seasons + the range (" + impText.trim() + ")");
    const hist2024 = await readDoc(page, "hist_2024"), hist2023 = await readDoc(page, "hist_2023"), hist2022 = await readDoc(page, "hist_2022");
    ok(!!hist2024 && hist2024.kind === "hist" && hist2024.season === 2024, "hist_2024 doc written");
    ok(!!hist2023 && hist2023.kind === "hist" && hist2023.season === 2023, "hist_2023 doc written");
    ok(!hist2022, "the loop stopped at 2022 — no hist_2022 doc");

    // N3: the record book — every superlative hand-computed against the two imported seasons.
    await page.evaluate(() => window.__GFFL__.UI.show("league"));
    await page.waitForSelector(".recordbook", { timeout: 9000 });
    // Boot-speed pass (2026-08-08): the record book's data now loads lazily, only once its
    // <details> is actually opened — wait for the real table to land before reading text.
    await page.evaluate(() => { document.querySelector(".recordbook").open = true; });
    await page.waitForFunction(() => !!document.querySelector(".recordbook table.tbl"), { timeout: 9000 });
    const rbText = await page.evaluate(() => document.querySelector(".recordbook").textContent.replace(/\s+/g, " ").trim());
    ok(/2023: Battle Kreussers/.test(rbText) && /2024: End Zone Goats/.test(rbText), "champions by year, both seasons (" + rbText.slice(0, 140) + ")");
    ok(/Battle Kreussers.*182\.4.*wk 1, 2024/.test(rbText), "highest single-week score ever: Battle Kreussers 182.4, wk1 2024");
    ok(/160\.0.*60\.0.*Wyoming Cowboys.*margin 100\.0.*wk 2, 2023/.test(rbText),
      "biggest blowout: Battle Kreussers 160.0 — 60.0 Wyoming Cowboys, margin 100.0, wk2 2023");
    ok(/1710\.6.*2023/.test(rbText), "best season PF: Battle Kreussers 1710.6 in 2023");
    const rbRows = await page.evaluate(() => [...document.querySelectorAll(".recordbook table.tbl tbody tr")]
      .map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent.trim())));
    ok(rbRows.length === 3, "all-time standings: 3 franchises with any recorded history (of 8 teams)");
    ok(rbRows[0][1] === "Battle Kreussers" && rbRows[0][2] === "21" && rbRows[0][3] === "7" && rbRows[0][4] === "3161.0" && rbRows[0][5] === "1",
      "row1: Battle Kreussers 21-7, 3161.0 PF, 1 title (" + JSON.stringify(rbRows[0]) + ")");
    ok(rbRows[1][1] === "End Zone Goats" && rbRows[1][2] === "17" && rbRows[1][3] === "11" && rbRows[1][4] === "3010.8" && rbRows[1][5] === "1",
      "row2: End Zone Goats 17-11, 3010.8 PF, 1 title (aggregate across BOTH seasons) (" + JSON.stringify(rbRows[1]) + ")");
    ok(rbRows[2][1] === "Wyoming Cowboys" && rbRows[2][2] === "9" && rbRows[2][3] === "19" && rbRows[2][4] === "2430.2" && rbRows[2][5] === "0",
      "row3: Wyoming Cowboys 9-19, 2430.2 PF, 0 titles (" + JSON.stringify(rbRows[2]) + ")");

    // N4: head-to-head — hand-checked directly against LG.headToHead.
    const h2h12 = await page.evaluate(() => window.__GFFL__.LG.headToHead(1, 2));
    ok(h2h12.aWins === 2 && h2h12.bWins === 0 && h2h12.aPts === 327.4 && h2h12.bPts === 188.2,
      "headToHead(1,2): Battle Kreussers lead 2-0, 327.4-188.2 across both seasons (" + JSON.stringify(h2h12) + ")");
    const h2h13 = await page.evaluate(() => window.__GFFL__.LG.headToHead(1, 3));
    ok(h2h13.aWins === 1 && h2h13.bWins === 0 && h2h13.aPts === 160 && h2h13.bPts === 60,
      "headToHead(1,3): 1-0, 160-60 (the 2024 0-0 bye between them correctly contributes nothing)");
    const h2h31 = await page.evaluate(() => window.__GFFL__.LG.headToHead(3, 1));
    ok(h2h31.aWins === 0 && h2h31.bWins === 1, "headToHead(3,1) reads the exact mirror of (1,3) — argument order sets perspective, not the answer");
    const h2h45 = await page.evaluate(() => window.__GFFL__.LG.headToHead(4, 5));
    ok(h2h45.aWins === 0 && h2h45.bWins === 0 && h2h45.ties === 0, "two teams with no shared history read all-zero, not an error");

    // N5: matchup page — "All-time series" line (this week's real matchup is team1 vs team2).
    await page.waitForSelector(".mucard", { timeout: 5000 });
    await clickIn(page, ".mucard.mine");
    await page.waitForSelector(".muhead", { timeout: 9000 });
    const seriesLine = await text(page, ".h2hline");
    ok(!!seriesLine && /All-time series: Battle Kreussers leads 2.0/.test(seriesLine), "matchup header: All-time series line (" + seriesLine + ")");

    // N6: locker — championship banner (2023 only — they didn't win 2024) + rivalries table
    // (only opponents with shared history show, not all 7 other teams).
    await page.evaluate(() => window.__GFFL__.UI.openLocker(1));
    await page.waitForSelector(".lockerhead", { timeout: 9000 });
    const lockerText = await page.evaluate(() => document.body.textContent);
    // Restaged (item 10): the trophy banner rows carry a dedicated ".trophyline" class now (no
    // leading emoji to anchor a regex on) — read those rows directly instead.
    const trophyLines = await page.evaluate(() => [...document.querySelectorAll(".trophyline")].map((e) => e.textContent.trim()));
    ok(/Championships/.test(lockerText) && trophyLines.includes("2023") && !trophyLines.includes("2024"),
      "Battle Kreussers' locker shows their 2023 title banner, and only that one (" + JSON.stringify(trophyLines) + ")");
    const rivRows = await page.evaluate(() => {
      const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent === "Rivalries");
      return h2 ? [...h2.closest(".card").querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent.trim())) : null;
    });
    ok(!!rivRows && rivRows.length === 2, "rivalries table lists only the 2 opponents with shared history (of 7 possible) (" + JSON.stringify(rivRows) + ")");
    const ezgRow = rivRows.find((r) => r[0] === "End Zone Goats"), wyoRow = rivRows.find((r) => r[0] === "Wyoming Cowboys");
    ok(!!ezgRow && ezgRow[1] === "2" && ezgRow[2] === "0" && ezgRow[3] === "0", "rivalry vs End Zone Goats: 2-0-0");
    ok(!!wyoRow && wyoRow[1] === "1" && wyoRow[2] === "0" && wyoRow[3] === "0", "rivalry vs Wyoming Cowboys: 1-0-0");

    ok(errors.length === 0, "0 page errors through import + record book + rivalries");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_recordbook_390.png"), fullPage: true }); console.log("  📸 shots/gffl_recordbook_390.png"); }
    await ctx.close();
  }

  // N7: empty state — a league with no history imported (and no titles) shows the
  // guiding message, not an empty table; a non-commissioner never sees the import hint.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await page.waitForSelector(".recordbook", { timeout: 5000 });
    // Boot-speed pass (2026-08-08): the record book's data — even "there's genuinely nothing
    // here yet" — now loads lazily, only once its <details> is actually opened. Open it and
    // wait for the real (empty-state) content to land before reading it.
    await page.evaluate(() => { document.querySelector(".recordbook").open = true; });
    await page.waitForFunction(() => /No history imported yet/.test(document.querySelector(".recordbook").textContent), { timeout: 9000 });
    const rbEmptyBefore = await page.evaluate(() => document.querySelector(".recordbook").textContent);
    ok(/No history imported yet/.test(rbEmptyBefore), "record book empty state (no hist docs): 'No history imported yet'");
    ok(!(await page.$(".recordbook table.tbl")), "…and no standings table renders with nothing imported");
    ok(!/Import it from the Rules page/.test(rbEmptyBefore), "…no commissioner hint shown to a non-commissioner viewer");
    await page.evaluate(() => window.__GFFL__.LG.gateCommish()); // create-on-first-use, consumes the stub prompt
    // renderLeague() called directly (not via UI.show) is still a genuine !repaint render —
    // it re-arms the lazy record-book card too (boot-speed pass), so it must be opened again.
    await page.evaluate(() => window.__GFFL__.UI.renderLeague());
    await page.waitForSelector(".recordbook", { timeout: 5000 });
    await page.evaluate(() => { document.querySelector(".recordbook").open = true; });
    await page.waitForFunction(() => /No history imported yet/.test(document.querySelector(".recordbook").textContent), { timeout: 9000 });
    const rbEmptyAfter = await page.evaluate(() => document.querySelector(".recordbook").textContent);
    ok(/Import it from the Rules page/.test(rbEmptyAfter), "…the commissioner DOES see a hint pointing at Rules");
    await page.evaluate(() => window.__GFFL__.UI.openLocker(1));
    await page.waitForSelector(".lockerhead", { timeout: 9000 });
    const lockerEmptyText = await page.evaluate(() => document.body.textContent);
    ok(!/Championships/.test(lockerEmptyText), "no championships card renders when nobody's won anything yet");
    ok(/No history against current opponents yet/.test(lockerEmptyText), "rivalries card shows the empty-history message");
    ok(errors.length === 0, "0 page errors on the empty-history state");
    await ctx.close();
  }

  // ---- O: playoffs, bracket, trophies (S7) ----
  section("O · playoffs — bracket build/advance, champion, Toilet Bowl, trophies");

  // O1: the whole chain, one context — auto-build off the hand-designed 14-week season, the
  // exact seed order (incl. the PF tiebreak), the play-in/semis/championship shape, byes, the
  // league-home matchup-card list at both playoff weeks, the bracket page's placeholders,
  // gamesForWeek's week<=14-vs->14 boundary, and that playoff weeks never leak into the
  // (regular-season-only) standings.
  {
    const { ctx, page, errors } = await newTestPage(browser, seedFor7Playoffs());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });

    // Regular season -> gamesForWeek(1) is just the seeded schedule's week 1.
    const gfw1 = await page.evaluate(() => window.__GFFL__.LG.gamesForWeek(1));
    ok(JSON.stringify(gfw1) === JSON.stringify([[1, 2], [3, 4], [5, 6], [7, 8]]), "gamesForWeek(1) reads straight off the regular schedule (" + JSON.stringify(gfw1) + ")");
    // No bracket week yet -> nothing to play there.
    const gfw15before = await page.evaluate(() => window.__GFFL__.LG.gamesForWeek(15));
    ok(Array.isArray(gfw15before) && gfw15before.length === 0, "gamesForWeek(15) is empty before any bracket exists");

    const stBefore = await page.evaluate(() => window.__GFFL__.LG.loadStandings());
    ok(stBefore[5].w === 12 && stBefore[5].pf === 1620 && stBefore[4].w === 7 && stBefore[4].pf === 1575 && stBefore[3].w === 7 && stBefore[3].pf === 1190,
      "hand-designed standings read back exactly (team5 12-2/1620, team4 7-7/1575, team3 7-7/1190)");

    // Jump the clock past the regular season and run the SAME chain boot() and every live poll
    // run — this is the "auto-builds on its own" contract, no button involved.
    await page.evaluate(() => {
      const LG = window.__GFFL__.LG;
      const start = new Date(LG.SEASON_START + "T05:00:00-05:00").getTime();
      LG.nowOverride = start + 14 * 7 * 24 * 3600 * 1000 + 3600000; // 1h into week 15
      window.__GFFL__.UI.week = LG.currentWeek();
    });
    const cw = await page.evaluate(() => window.__GFFL__.LG.currentWeek());
    ok(cw === 15, "currentWeek() reads 15 under the simulated clock");
    ok(!(await page.evaluate(() => window.__GFFL__.LG.loadBracket())), "no bracket exists yet");
    await page.evaluate(() => window.__GFFL__.UI.maybeAdvanceLeague());
    const bracket = await page.evaluate(() => window.__GFFL__.LG.loadBracket());
    ok(!!bracket && bracket.kind === "bracket", "the bracket auto-built the moment week > seasonWeeks");
    ok(JSON.stringify(bracket.seeds) === JSON.stringify([5, 7, 1, 4, 3, 6, 8, 2]),
      "seeds = final standings, wins -> PF, exactly [5,7,1,4,3,6,8,2] — the PF tiebreak (team4 over team3) landed correctly (" + JSON.stringify(bracket.seeds) + ")");
    ok(bracket.byes === 3 && bracket.playoffCount === 5, "byes/playoffCount read straight off LG.rules.playoffs (3, 5)");

    const playIn = bracket.rounds.r1.find((g) => g.kind === "playin");
    ok(!!playIn && playIn.home === 4 && playIn.away === 3 && playIn.seedHome === 4 && playIn.seedAway === 5,
      "play-in: seed4 (team4) vs seed5 (team3) — " + JSON.stringify(playIn));
    const consR1 = bracket.rounds.r1.find((g) => g.kind === "consolation");
    ok(!!consR1 && consR1.home === 2 && consR1.away === 8, "consolation game A (week 15): team2 vs team8 — the round-robin's own bye rotation (" + JSON.stringify(consR1) + ")");
    const semi1 = bracket.rounds.r2.find((g) => g.id === "semi1"), semi2 = bracket.rounds.r2.find((g) => g.id === "semi2");
    ok(!!semi1 && semi1.home === 5 && semi1.away == null && semi1.awayFrom && semi1.awayFrom.game === "playin1" && /Winner of #4\/#5/.test(semi1.awayLabel),
      "semi1 = seed1 (team5) vs the play-in winner, unresolved — " + JSON.stringify(semi1));
    ok(!!semi2 && semi2.home === 7 && semi2.away === 1, "semi2 = seed2 vs seed3 (team7 vs team1) — BOTH already known at build time (" + JSON.stringify(semi2) + ")");
    const champG = bracket.rounds.r3.find((g) => g.kind === "championship"), thirdG = bracket.rounds.r3.find((g) => g.kind === "third");
    ok(!!champG && champG.home == null && champG.away == null && champG.homeFrom.game === "semi1" && champG.awayFrom.game === "semi2", "championship unresolved, references both semis");
    ok(!!thirdG && thirdG.homeFrom.result === "loser" && thirdG.awayFrom.result === "loser", "3rd-place game references the semis' LOSERS");

    // Consolation round robin — every team plays 2 of the 3 weeks, one bye each week.
    ok(bracket.rounds.r2.find((g) => g.kind === "consolation" && g.home === 6 && g.away === 2), "consolation game B (week 16): team6 vs team2");
    ok(bracket.rounds.r3.find((g) => g.kind === "consolation" && g.home === 8 && g.away === 6), "consolation game C (week 17): team8 vs team6");

    // League home at week 15: both fully-known games show as ordinary matchup cards.
    await page.evaluate(() => window.__GFFL__.UI.renderLeague());
    await page.waitForSelector(".mucard", { timeout: 5000 });
    const wk15cards = await page.$$eval(".mucard", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
    ok(wk15cards.length === 2, "week 15's matchup-card list: exactly the play-in + consolation A games (" + wk15cards.length + ")");
    ok(wk15cards.some((t) => /Waffle House Warriors/.test(t) && /Wyoming Cowboys/.test(t)), "…the play-in game (team4 vs team3)");
    ok(wk15cards.some((t) => /End Zone Goats/.test(t) && /The Goat Kids/.test(t)), "…the consolation game (team2 vs team8)");

    // Week 16: semi2 was ALREADY fully known at build time (both bye seeds — #2 vs #3), so it
    // shows normally right alongside the consolation B game; semi1 (still waiting on the
    // play-in winner) is simply omitted — no half-known matchup card for it.
    await page.evaluate(() => { window.__GFFL__.UI.week = 16; });
    await page.evaluate(() => window.__GFFL__.UI.renderLeague());
    await page.waitForSelector(".mucard", { timeout: 5000 });
    const wk16cards = await page.$$eval(".mucard", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
    ok(wk16cards.length === 2, "week 16's list: exactly semi2 (already known) + consolation B — semi1 is skipped, not guessed at (" + JSON.stringify(wk16cards) + ")");
    ok(wk16cards.some((t) => /Battle Kreussers/.test(t) && /Team Seven/.test(t)), "…semi2, fully resolved (team7 vs team1)");
    ok(wk16cards.some((t) => /Team Six/.test(t) && /End Zone Goats/.test(t)), "…the resolved consolation B game (team6 vs team2)");

    // The bracket page: byes, the "Winner of #4/#5" placeholder for the still-open semi.
    await page.evaluate(() => window.__GFFL__.UI.openBracket());
    await page.waitForSelector(".bracketrounds", { timeout: 5000 });
    // .replace(/\s+/g," ") collapses the team's own literal double space too — match single.
    const bracketText = await page.evaluate(() => document.querySelector(".bracketrounds").textContent.replace(/\s+/g, " "));
    ok(/#1 Nails For Breakfast — bye/.test(bracketText) && /#2 Team Seven — bye/.test(bracketText) && /#3 Battle Kreussers — bye/.test(bracketText),
      "byes shown for seeds 1-3 (the top 3 regular-season finishers) in the week 15 column (" + bracketText.slice(0, 200) + ")");
    ok(/Winner of #4\/#5/.test(bracketText), "the still-open semi shows its 'Winner of #4/#5' placeholder in the week 16 column");
    ok(!(await page.$(".champbanner")) && !(await page.$(".toiletbanner")), "no champion/Toilet Bowl banner yet — nothing's been decided");

    // Standings stay REGULAR-SEASON-ONLY — building the bracket (which only reads standings,
    // never writes weekly docs itself) must not have moved anyone's record.
    const stAfter = await page.evaluate(() => window.__GFFL__.LG.loadStandings());
    ok(stAfter[5].w === 12 && stAfter[5].pf === 1620, "standings are exactly as before — building the bracket doesn't touch them");

    // Idempotent: calling buildBracket again (still no playoff weeks final) returns the SAME
    // doc and posts no second announcement.
    const chatBefore = (await page.evaluate(() => window.__GFFL__.LG.loadAllChat())).length;
    const rebuild = await page.evaluate(() => window.__GFFL__.LG.buildBracket());
    ok(rebuild.ok === true, "re-calling buildBracket succeeds");
    ok(JSON.stringify(rebuild.seeds) === JSON.stringify(bracket.seeds), "…and returns the SAME bracket, untouched");
    const chatAfter = (await page.evaluate(() => window.__GFFL__.LG.loadAllChat())).length;
    ok(chatAfter === chatBefore, "…with no duplicate 'bracket is set' chat post (idempotent)");

    ok(errors.length === 0, "0 page errors through the build + week-15/16 display flow");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_bracket_390.png"), fullPage: true }); console.log("  📸 shots/gffl_bracket_390.png"); }

    // O2 continues in the SAME context/state — seed wk15 -> advance -> wk16 -> advance ->
    // wk17 -> advance, hand-verifying every resolution, the trophy, and both sys posts.
    // Team names, for reference: 1 Battle Kreussers · 2 End Zone Goats · 3 Wyoming Cowboys ·
    // 4 Waffle House Warriors · 5 Nails  For Breakfast · 6 Team Six · 7 Team Seven · 8 The Goat Kids.

    // Week 15 final: the LOWER seed (team3) upsets the play-in; team8 takes consolation A.
    await page.evaluate(() => window.__GFFL__.LG.db.set(window.__GFFL__.LG.weeklyId(2026, 15), {
      kind: "weekly", week: 15, matchups: [
        { home: 4, away: 3, homePts: 80, awayPts: 95 },   // play-in: team3 wins
        { home: 2, away: 8, homePts: 60, awayPts: 70 },   // consolation A: team8 wins
      ], awards: {}, power: [], accuracy: null, finalizedAt: 2000,
    }));
    const adv1 = await page.evaluate(() => window.__GFFL__.LG.advanceBracket());
    ok(adv1.ok === true, "advanceBracket succeeds once week 15 is final");
    const semi1After = adv1.rounds.r2.find((g) => g.id === "semi1");
    ok(semi1After.home === 5 && semi1After.away === 3, "semi1 fills in correctly: seed1 (team5) vs the play-in WINNER (team3, the upset) — " + JSON.stringify(semi1After));
    ok(adv1.rounds.r2.find((g) => g.id === "semi2").away === 1, "semi2 is untouched (was already fully known)");

    // Week 16: seed1 wins as expected; seed3 upsets seed2 in the OTHER semi; team6 takes
    // consolation B.
    await page.evaluate(() => window.__GFFL__.LG.db.set(window.__GFFL__.LG.weeklyId(2026, 16), {
      kind: "weekly", week: 16, matchups: [
        { home: 5, away: 3, homePts: 110, awayPts: 90 },  // semi1: team5 wins
        { home: 7, away: 1, homePts: 85, awayPts: 100 },  // semi2: team1 upsets team7
        { home: 6, away: 2, homePts: 75, awayPts: 60 },   // consolation B: team6 wins
      ], awards: {}, power: [], accuracy: null, finalizedAt: 3000,
    }));
    const adv2 = await page.evaluate(() => window.__GFFL__.LG.advanceBracket());
    const champAfter = adv2.rounds.r3.find((g) => g.kind === "championship"), thirdAfter = adv2.rounds.r3.find((g) => g.kind === "third");
    ok(champAfter.home === 5 && champAfter.away === 1, "championship fills in: the two semi WINNERS, team5 vs team1 — " + JSON.stringify(champAfter));
    ok(thirdAfter.home === 3 && thirdAfter.away === 7, "3rd-place game fills in: the two semi LOSERS, team3 vs team7");
    ok(adv2.champion == null, "champion still unset — week 17 hasn't happened yet");

    // Week 17: seed3 (team1) upsets the top overall seed for the title, putting up the
    // highest single score anyone's posted all season (140, topping the regular season's own
    // max of 130); team3 takes 3rd; team6 sweeps consolation C, leaving team2 with the
    // league's only 0-win cons record.
    await page.evaluate(() => window.__GFFL__.LG.db.set(window.__GFFL__.LG.weeklyId(2026, 17), {
      kind: "weekly", week: 17, matchups: [
        { home: 5, away: 1, homePts: 95, awayPts: 140 },  // championship: team1 wins it all
        { home: 3, away: 7, homePts: 90, awayPts: 80 },   // 3rd place: team3
        { home: 8, away: 6, homePts: 50, awayPts: 65 },   // consolation C: team6 wins
      ], awards: {}, power: [], accuracy: null, finalizedAt: 4000,
    }));
    const chatBeforeChamp = (await page.evaluate(() => window.__GFFL__.LG.loadAllChat())).length;
    const adv3 = await page.evaluate(() => window.__GFFL__.LG.advanceBracket());
    ok(adv3.champion === 1 && adv3.thirdPlace === 3, "champion = team1 (Battle Kreussers), 3rd place = team3 (Wyoming Cowboys) — " + JSON.stringify({ champion: adv3.champion, thirdPlace: adv3.thirdPlace }));
    // Toilet Bowl: team8 1-1, team6 2-0, team2 0-2 — fewest wins loses it, no tie to break.
    ok(adv3.toilet === 2, "Toilet Bowl: team2 (0-2 across the 3 consolation games — the league's only winless consolation record) — toilet=" + adv3.toilet);

    const champTeamDoc = await page.evaluate(() => window.__GFFL__.LG.teamById(1));
    ok(!!champTeamDoc.trophies && champTeamDoc.trophies.length === 1 && champTeamDoc.trophies[0].year === 2026 && champTeamDoc.trophies[0].kind === "champion",
      "the champion's TEAM doc records the trophy: {year:2026, kind:'champion'} (" + JSON.stringify(champTeamDoc.trophies) + ")");

    const chatFinal = await page.evaluate(() => window.__GFFL__.LG.loadAllChat());
    ok(chatFinal.length === chatBeforeChamp + 2, "exactly 2 new chat messages posted (champion + Toilet Bowl)");
    ok(chatFinal.some((m) => m.sys && /^Battle Kreussers are the 2026 GFFL CHAMPIONS!/.test(m.text)), "…the champion announcement, by name");
    ok(chatFinal.some((m) => m.sys && /^End Zone Goats finish the season in the Toilet Bowl/.test(m.text)), "…and the Toilet Bowl announcement, by name");

    // Idempotent: re-calling advanceBracket after the champion's crowned is a pure no-op —
    // no more chat, no re-write.
    const adv4 = await page.evaluate(() => window.__GFFL__.LG.advanceBracket());
    ok(adv4.champion === 1 && adv4.toilet === 2, "re-calling advanceBracket returns the same resolved bracket");
    const chatAfterIdempotent = await page.evaluate(() => window.__GFFL__.LG.loadAllChat());
    ok(chatAfterIdempotent.length === chatFinal.length, "…and posts nothing new (idempotent once fully resolved)");
    await page.evaluate(() => window.__GFFL__.UI.maybeAutoAdvanceBracket());
    const chatAfterAutoNoop = await page.evaluate(() => window.__GFFL__.LG.loadAllChat());
    ok(chatAfterAutoNoop.length === chatFinal.length, "…and UI.maybeAutoAdvanceBracket() is a safe no-op too, once a champion exists");

    // Regular-season standings are STILL untouched — even a fully-played-out postseason never
    // leaks into them.
    const stFinal = await page.evaluate(() => window.__GFFL__.LG.loadStandings());
    ok(stFinal[5].w === 12 && stFinal[1].w === 10 && stFinal[3].w === 7,
      "regular-season standings unchanged after the ENTIRE postseason is finalized (team5 still 12, team1 still 10, team3 still 7)");
    // ...but the record book (which reads ALL weekly docs) picks the playoff games up — the
    // championship's 140 is now the season's highest single recorded score.
    const rb = await page.evaluate(() => window.__GFFL__.LG.recordBook());
    ok(!!rb.highestWeek && rb.highestWeek.pts === 140 && rb.highestWeek.week === 17 && rb.highestWeek.teamId === 1,
      "the record book's 'highest week' picks up the championship score (140, wk17, Battle Kreussers) — playoff weeks are real weekly docs too, and this one topped even the regular season's own max of 130 (" + JSON.stringify(rb.highestWeek) + ")");

    // The bracket page, fully resolved: champion banner, Toilet Bowl banner, every game a
    // clickable card with the winner bolded.
    await page.evaluate(() => window.__GFFL__.UI.openBracket());
    await page.waitForSelector(".champbanner", { timeout: 5000 });
    const champBannerTxt = await text(page, ".champbanner");
    ok(/Battle Kreussers/.test(champBannerTxt) && /2026 GFFL CHAMPIONS/.test(champBannerTxt), "champion banner reads correctly (" + champBannerTxt + ")");
    const toiletBannerTxt = await text(page, ".toiletbanner");
    ok(/Toilet Bowl: End Zone Goats/.test(toiletBannerTxt), "Toilet Bowl banner reads correctly (" + toiletBannerTxt + ")");
    const winners = await page.$$eval(".bside.winner", (els) => els.map((e) => e.textContent));
    ok(winners.some((t) => /Battle Kreussers/.test(t)) && winners.length >= 6, "every decided bracket game bolds its winner (" + winners.length + " winner-marked sides)");

    // Locker: the trophy from THIS season shows up immediately (S7), not just after a January
    // history import (S6) — the two are additive, not either/or.
    await page.evaluate(() => window.__GFFL__.UI.openLocker(1));
    await page.waitForSelector(".lockerhead", { timeout: 9000 });
    const lockerTxt = await page.evaluate(() => document.body.textContent);
    const trophyLines2 = await page.evaluate(() => [...document.querySelectorAll(".trophyline")].map((e) => e.textContent.trim()));
    ok(/Championships/.test(lockerTxt) && trophyLines2.includes("2026"), "Battle Kreussers' locker shows the 2026 trophy right away (" + JSON.stringify(trophyLines2) + ")");

    ok(errors.length === 0, "0 page errors through the full three-round advance + trophy + bracket-page flow");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_bracket_final_390.png"), fullPage: true }); console.log("  📸 shots/gffl_bracket_final_390.png"); }
    await ctx.close();
  }

  // O3: the commissioner's "Build bracket" button — a fresh context, past the regular season,
  // no bracket yet (the auto-chain hasn't run because this context's own boot() happened at
  // the real, pre-season "now" and nothing has touched maybeAdvanceLeague since). Also proves
  // the card's own commissioner gate: a non-commissioner viewer sees the "not built yet" note
  // with NO button at all (same posture as the pre-existing ✅ Finalize-week button).
  {
    const { ctx, page, errors } = await newTestPage(browser, seedFor7Playoffs());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await page.evaluate(() => {
      const LG = window.__GFFL__.LG;
      const start = new Date(LG.SEASON_START + "T05:00:00-05:00").getTime();
      LG.nowOverride = start + 14 * 7 * 24 * 3600 * 1000 + 3600000;
      window.__GFFL__.UI.week = LG.currentWeek();
    });
    await page.evaluate(() => window.__GFFL__.UI.renderLeague());
    await page.waitForFunction(() => document.body.textContent.includes("hasn't been built yet"), { timeout: 5000 });
    ok(!(await page.$("#buildBracketBtn")), "a NON-commissioner sees the 'not built yet' card with no button at all");
    ok(!(await page.evaluate(() => window.__GFFL__.LG.loadBracket())), "…and indeed no bracket exists before anything happens");

    await page.evaluate(() => window.__GFFL__.LG.gateCommish()); // create-on-first-use, consumes the stub prompt
    await page.evaluate(() => window.__GFFL__.UI.renderLeague());
    await page.waitForSelector("#buildBracketBtn", { timeout: 5000 });
    ok(true, "once commissioner-unlocked, the Playoffs card shows the 'Build bracket' button");
    await clickIn(page, "#buildBracketBtn");
    await page.waitForFunction(() => document.body.textContent.includes("View the bracket"), { timeout: 9000 });
    const built = await page.evaluate(() => window.__GFFL__.LG.loadBracket());
    ok(!!built && built.kind === "bracket" && JSON.stringify(built.seeds) === JSON.stringify([5, 7, 1, 4, 3, 6, 8, 2]),
      "the commissioner button built the exact same bracket the auto-chain would have");
    ok(!(await page.$("#buildBracketBtn")), "…and the button is replaced by a 'View the bracket' link now that one exists");
    await clickIn(page, "#openBracketBtn");
    await page.waitForSelector(".bracketrounds", { timeout: 5000 });
    ok(true, "…which opens the bracket page");
    ok(errors.length === 0, "0 page errors through the commissioner build-button flow");
    await ctx.close();
  }

  // O4: LG.gamesForWeek + LG.finalizeWeek's REAL flow (the live guard, real per-player scoring,
  // awards, power rankings) driven for a PLAYOFF week — the same hand-computed live fixture
  // section M1 uses (team1's roster 87.0 vs team2's roster 36.0), just with a minimal
  // hand-built bracket doc standing in for a full 14-week build so the live-engine mechanics
  // are what's under test here, not the seeding math (already proven in O1/O2).
  {
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);

    await page.evaluate(() => window.__GFFL__.LG.db.set("bracket_2026", {
      kind: "bracket", season: 2026, seeds: [1, 2, 3, 4, 5, 6, 7, 8], playoffCount: 5, byes: 3,
      rounds: { r1: [{ id: "playin1", kind: "playin", week: 15, home: 1, away: 2, seedHome: 4, seedAway: 5 }], r2: [], r3: [] },
      champion: null, thirdPlace: null, toilet: null,
    }));
    const gfw15 = await page.evaluate(() => window.__GFFL__.LG.gamesForWeek(15));
    ok(JSON.stringify(gfw15) === JSON.stringify([[1, 2]]), "gamesForWeek(15) reads the bracket's resolved play-in pairing (" + JSON.stringify(gfw15) + ")");
    const gfw1still = await page.evaluate(() => window.__GFFL__.LG.gamesForWeek(1));
    ok(JSON.stringify(gfw1still) === JSON.stringify([[1, 2], [3, 4], [5, 6], [7, 8]]), "gamesForWeek(1) is completely unaffected — still the regular schedule");

    // Exactly M1's hand-computed live scenario, aimed at week 15 instead of week 1.
    await page.evaluate(() => {
      const D = window.__GFFL__.D;
      const setP = (key, name, team, pos, pts) =>
        D.S.players.set(key, { key, name, team, pos, pts, espn: null, slp: null, official: null, injury: "", src: "", conflict: false, last: 0 });
      setP("3915511", "P. Passer", "PHI", "QB", 25);
      setP("4241457", "R. Rusher", "DAL", "RB", 10);
      setP("111888", "S. Second", "DEN", "RB", 8);
      setP("4361741", "W. Receiver", "PHI", "WR", 15);
      setP("111555", "W. Two", "DEN", "WR", 6);
      setP("111222", "T. Tight", "KC", "TE", 5);
      setP("111444", "F. Flexman", "DEN", "RB", 2);
      setP("dst_PHI", "PHI D/ST", "PHI", "DST", 9);
      setP("2473037", "K. Kicker", "DAL", "K", 7);
      setP("222111", "Q. Rival", "DAL", "QB", 20);
      setP("222333", "X. Wideout", "PHI", "WR", 12);
      setP("dst_DAL", "DAL D/ST", "DAL", "DST", 4);
      ["PHI", "DAL", "DEN", "KC"].forEach((ab) => D.S.games.set(ab, { state: "post", period: 4, clock: "0:00" }));
      // RESTAGED 2026-08-08 (adversarial review, findings 1/3/7): finalizeWeek now refuses
      // unless the LIVE ENGINE'S OWN WEEK is the week being written — it used to take `week`
      // for the roster lookup only and multiply it by whatever the engine happened to be
      // polling, which is how week N's permanent record got stamped with week N+1's points.
      // The fixture's providers say week 1; this section is finalizing week 15, so it must
      // say so. (Both providers are set: they must AGREE or the engine reports "unknown".)
      D.S.espnWeek = 15; D.S.slpWeek = 15;
    });
    const r15 = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(15));
    ok(r15.ok === true, "finalizeWeek(15) succeeds on a REAL playoff week driven by the live engine");
    ok(r15.matchups.length === 1 && r15.matchups[0].home === 1 && r15.matchups[0].away === 2 && r15.matchups[0].homePts === 87 && r15.matchups[0].awayPts === 36,
      "…the exact same hand-computed totals as M1 (team1 87.0, team2 36.0) — " + JSON.stringify(r15.matchups[0]));
    ok(!!r15.awards.topScore && r15.awards.topScore.teamId === 1, "…awards still compute normally on a playoff week (Top Score: team1)");

    const adv = await page.evaluate(() => window.__GFFL__.LG.advanceBracket());
    ok(adv.ok === true && adv.rounds.r1.find((g) => g.id === "playin1") && adv.rounds.r2.length === 0 && adv.rounds.r3.length === 0,
      "advanceBracket runs cleanly against a minimal hand-built bracket — nothing references r1's game, so nothing to fill and nothing crashes");

    ok(errors.length === 0, "0 page errors driving finalizeWeek on a real playoff week");
    await ctx.close();
  }

  // ---- P: performance — LG.db caching + throttled auto-checks (playtest: "laggy tabs") ----
  section("P · performance — doc cache + throttled auto-checks");
  {
    // P1: a second full visit to a view makes ZERO additional real .get() calls (teams/rosters/
    // settings/weekly/bracket — everything a full renderLeague() reads) — the exact "tab switch
    // completes without awaiting network" property, measured via LG.db.stats rather than
    // wall-clock timing so it's deterministic even under CI load.
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForSelector("#faSearch", { timeout: 9000 }); // moves view fully settled
    const statsBefore = await page.evaluate(() => ({ ...window.__GFFL__.LG.db.stats }));
    await page.evaluate(() => window.__GFFL__.UI.show("league"));
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const statsAfter = await page.evaluate(() => ({ ...window.__GFFL__.LG.db.stats }));
    ok(statsAfter.gets === statsBefore.gets,
      "a second full League render makes ZERO additional real .get() calls — every roster/team/settings/weekly/bracket doc served from cache (" + JSON.stringify({ statsBefore, statsAfter }) + ")");
    ok(statsAfter.lists - statsBefore.lists <= 1,
      "…and at most ONE additional .list() call — \"chat\" is the one kind deliberately EXEMPTED from caching (so the league home's own new 'recent chat' preview, and the live Chat tab, never go stale); every other kind (team/weekly/hist/tx/bracket) is cache-served");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }
  {
    // P2: idempotency guards still see the REAL backend, not this page's own STALE cache —
    // LG.db.getFresh(id), used by processWaivers/executeTrade/finalizeWeek/buildBracket/
    // snapshotProjections. Proven against finalizeWeek (the cleanest of the five — it computes
    // entirely in memory and does its ONE write only after the guard, so there's nothing else
    // in play): warm the page's knowledge of "no weekly doc yet", then have "another device"
    // finalize the week via a RAW localStorage write that bypasses THIS page's LG.db entirely
    // (the K-section's cross-device technique). finalizeWeek's own getFresh-backed guard is
    // proven to see the real doc and skip recomputing/re-writing/re-announcing it.
    //
    // RESTAGED 2026-08-08 (adversarial review, findings 2/4/5/12): this section used to say
    // "LG.db caches nulls too" and assert that a plain get() keeps reading a stale "missing".
    // A cached null is exactly the mechanism those findings turn on, so nulls are NEVER cached
    // any more — absence is DERIVED from a cached list() of that doc's own kind instead, which
    // carries its own 15s cloud background refresh. That derivation is still a SNAPSHOT, which
    // is precisely why the five idempotency guards use getFresh, so the point this section
    // makes is unchanged: below, the page's own list("weekly") snapshot still reports the doc
    // as absent while getFresh sees the truth.
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const warmMissing = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      await LG.db.list("weekly");          // the snapshot absence is derived from
      const warm = await LG.loadWeekly(1);
      return warm == null;
    });
    ok(warmMissing, "week 1's weekly doc reads as NOT YET existing on this page");
    const chatBefore = (await page.evaluate(() => window.__GFFL__.LG.loadAllChat())).length;
    const finalDoc = { kind: "weekly", week: 1, matchups: [{ home: 1, away: 2, homePts: 55, awayPts: 30 }], awards: {}, power: [], accuracy: null, finalizedAt: 999000 };
    await page.evaluate((k, doc) => localStorage.setItem(k, JSON.stringify(doc)), LSPFX + "weekly_2026_w1", finalDoc);
    const staleMissing = await page.evaluate(() => window.__GFFL__.LG.db.get(window.__GFFL__.LG.weeklyId(2026, 1)).then((d) => d == null));
    ok(staleMissing, "…and a PLAIN LG.db.get() still reads that from the page's own list snapshot — proving there's something real for getFresh to fix");
    // force:true bypasses the (unrelated) "every game must read post" guard — this test is
    // about the get-vs-getFresh idempotency guard specifically, not about live-game state.
    const r1 = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(1, { force: true }));
    ok(r1.ok === true && r1.finalizedAt === 999000 && r1.matchups[0].homePts === 55,
      "…yet finalizeWeek's own idempotency guard (LG.db.getFresh) sees the ALREADY-finalized doc and returns it verbatim, not a freshly recomputed one");
    const chatAfter = await page.evaluate(() => window.__GFFL__.LG.loadAllChat());
    ok(chatAfter.length === chatBefore, "…and posts no duplicate \"week is official\" announcement — the getFresh guard fired BEFORE the write+announce block ever ran");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }
  {
    // P3: auto-checks (waivers/trades/finalize/bracket) run once at boot, then at most once per
    // AUTO_CHECK_MS thereafter — never once per render. Driven directly through the exposed
    // UI._runAutoChecks/UI._autoCheckRuns test hooks so the assertion is about the THROTTLE
    // itself, not about any one downstream side effect.
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    // Boot-speed pass (2026-08-08): the forced auto-check chain now runs AFTER the first
    // paint (.mucard existing no longer implies it's finished) — UI.boot() still doesn't
    // RESOLVE until it's done, but nothing here awaits UI.boot() itself, so wait for the
    // counter directly rather than assuming it settled by the time .mucard appeared.
    await page.waitForFunction(() => window.__GFFL__.UI._autoCheckRuns >= 1, { timeout: 9000 });
    const afterBoot = await page.evaluate(() => window.__GFFL__.UI._autoCheckRuns);
    ok(afterBoot === 1, "boot runs the auto-check chain exactly once (forced, bypassing the throttle)");
    // Two more unforced calls, same wall-clock window (< AUTO_CHECK_MS since boot) — both throttled.
    await page.evaluate(() => window.__GFFL__.UI._runAutoChecks(false));
    await page.evaluate(() => window.__GFFL__.UI._runAutoChecks(false));
    // …and the two integration points that used to run it every time — d.onUpdate (a live poll
    // tick) and renderMoves() — are ALSO throttled now, not just the raw hook.
    await page.evaluate(() => window.__GFFL__.D.onUpdate());
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForSelector("#faSearch", { timeout: 9000 });
    const stillThrottled = await page.evaluate(() => window.__GFFL__.UI._autoCheckRuns);
    ok(stillThrottled === afterBoot, "…none of those (2 direct calls + a poll tick + a Moves visit) ran the chain again — still throttled");
    // Once AUTO_CHECK_MS has genuinely passed, it runs again.
    await page.evaluate(() => { window.__GFFL__.LG.nowOverride = Date.now() + 70000; });
    await page.evaluate(() => window.__GFFL__.UI._runAutoChecks(false));
    const afterWindow = await page.evaluate(() => window.__GFFL__.UI._autoCheckRuns);
    ok(afterWindow === afterBoot + 1, "…but DOES run again once the 60s window has passed");
    await page.evaluate(() => { window.__GFFL__.LG.nowOverride = null; });
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }
  {
    // P4: the cloud-only background-refresh path — LG.db._installFakeCloud (test-only hook) —
    // proves the SAME view paints synchronously-from-cache even against a genuinely slow (60ms/
    // call) backend once warm, while the FIRST (cold) visit really does await it.
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    // Switch AWAY first (so .mucard is genuinely absent from the DOM) before installing the
    // fake cloud — otherwise a STALE .mucard left over from the earlier local-mode render would
    // make the next waitForSelector resolve instantly, timing nothing real.
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForSelector("#faSearch", { timeout: 9000 });
    const snap = await snapshotAllDocs(page);
    await page.evaluate((docs) => {
      const LG = window.__GFFL__.LG;
      const store = new Map(Object.entries(docs));
      window.__cloudCalls = 0;
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      LG.db._installFakeCloud({
        async get(id) { window.__cloudCalls++; await delay(60); return store.get(id) || null; },
        async set(id, data) { const cur = store.get(id) || {}; store.set(id, { ...cur, ...data }); },
        async del(id) { store.delete(id); },
        async list(kind) {
          window.__cloudCalls++; await delay(60);
          const out = []; for (const [id, d] of store) if (!kind || d.kind === kind) out.push({ id, ...d });
          return out;
        },
        watch(id, cb) { cb(store.get(id) || null); return () => {}; },
      });
    }, snap);
    // Cold: the fake cloud is freshly installed, its cache is empty — a full League render
    // genuinely has to await the slow backend. waitForSelector only resolves once renderLeague()
    // has actually finished (main().innerHTML is the LAST line of its async body), so this is a
    // reliable full-completion signal, not just "the button was clicked."
    const t0 = Date.now();
    await page.evaluate(() => window.__GFFL__.UI.show("league"));
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const coldMs = Date.now() - t0;
    ok(coldMs >= 100, "the FIRST visit under a slow (60ms/call) fake cloud backend genuinely awaits it (" + coldMs + "ms, several distinct docs × 60ms)");
    // Warm: switch away (forces main() to lose .mucard) and back — the SAME slow backend, but
    // everything is now cached (the cold render above fully completed before this starts).
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForSelector("#faSearch", { timeout: 9000 });
    const t1 = Date.now();
    await page.evaluate(() => window.__GFFL__.UI.show("league"));
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const warmMs = Date.now() - t1;
    ok(warmMs < 100, "a second visit paints from cache almost instantly, even against the same 60ms/call backend (" + warmMs + "ms)");
    ok(errors.length === 0, "0 page errors against the fake cloud backend");
    await ctx.close();
  }

  // ---- Q: item 2 — the "🧪 Import 2025 rosters (test run)" commissioner button ----
  section("Q · 2025 test-data import — commissioner button, coherent Rules presentation");
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    // Before import: the seeded fixture roster (12 players, none of them the real 2025 fixture's
    // single QB+IR pair) — this is the baseline the import has to visibly change.
    const before = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).players.length, LSPFX + "roster_2026_w1_t1");
    ok(before === 12, "before import: the seeded week-1 roster has its usual 12 players");
    await page.evaluate(() => window.__GFFL__.UI.show("rules"));
    await page.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 5000 });
    ok(/Import ESPN rosters/.test(await page.evaluate(() => document.body.textContent))
      && /Import 2025 rosters \(test run\)/.test(await page.evaluate(() => document.body.textContent))
      && /Import history/.test(await page.evaluate(() => document.body.textContent)),
      "Rules page presents all THREE importer buttons even before commissioner unlock (rendered `hidden`, not absent)");
    // Unlock commissioner status (stub prompt "1234" creates + unlocks, same as every other
    // commissioner action in this suite) — the explanatory paragraph below is itself gated on
    // isCommish(), same as the buttons, so a genuine commissioner is what "coherent presentation"
    // has to be checked against.
    await page.evaluate(() => window.__GFFL__.LG.gateCommish());
    await page.evaluate(() => window.__GFFL__.UI.show("rules"));
    await page.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 5000 });
    // Coherent presentation: the three importers sit together with distinct, readable
    // explanations of what each one does (not just three unlabeled buttons).
    const rulesTxt = await page.evaluate(() => document.body.textContent);
    const rulesTxtFlat = rulesTxt.replace(/\s+/g, " "); // the source template wraps these sentences across lines
    ok(/pre-draft \(every roster empty\)/.test(rulesTxtFlat) && /real, FINAL 2025/.test(rulesTxtFlat),
      "…with an explanation of WHY the test-run importer exists (2026 is pre-draft) and what it does (seeds from the real final 2025 season)");
    ok(!!(await page.$("#testRostersImport")) && !!(await page.$("#rostersImport")) && !!(await page.$("#historyImport")),
      "all three importer buttons are present as a claimed commissioner");
    // Click it — commissioner is already unlocked from the step above.
    await clickIn(page, "#testRostersImport");
    await page.waitForFunction(() => document.body.textContent.includes("Test rosters imported"), { timeout: 8000 });
    const outTxt = await page.evaluate(() => document.querySelector("#importOut").textContent);
    ok(/real 2025 season/.test(outTxt) && /re-import real 2026 rosters/.test(outTxt),
      "success message names the source season and reminds the commissioner to re-import real rosters once the draft happens");
    const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LSPFX + "roster_2026_w1_t1");
    ok(after.players.length === 2, "after import: the CURRENT week's roster is REPLACED by the 2025 fixture's real roster (2 players, not 12)");
    const passer = after.players.find((p) => p.name === "P. Passer");
    ok(passer && passer.key === "3915511" && passer.team === "PHI" && passer.slot === "QB",
      "…the real 2025 QB slots in correctly (same slotting rule as the live importer)");
    const injured = after.players.find((p) => p.name === "I. Injured");
    ok(injured && injured.slot === "IR" && injured.injury === "OUT",
      "…and the IR-designated player lands in the IR slot with their injury status carried");
    // The locker/lineup editor reflects the imported roster immediately (UI._rosters cleared).
    await page.evaluate(() => window.__GFFL__.UI.openLocker(1));
    await page.waitForSelector(".lockerhead", { timeout: 9000 });
    const lockerTxt = await page.evaluate(() => document.body.textContent);
    ok(/P\. Passer/.test(lockerTxt) && !/B\. Backup/.test(lockerTxt),
      "the locker's own lineup editor shows the newly-imported roster, not the old seeded bench");
    // A NON-commissioner viewer never sees any of the three import buttons at all.
    const snap = await snapshotAllDocs(page);
    const { ctx: ctx2, page: page2, errors: err2 } = await newTestPage(browser, { docs: snap, pass: "amenfarms", team: 2, who: "Rival" });
    await bootPage(page2);
    await page2.waitForSelector(".mucard", { timeout: 9000 });
    await page2.evaluate(() => window.__GFFL__.UI.show("rules"));
    await page2.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 5000 });
    const nonCommishHidden = await page2.evaluate(() =>
      ["testRostersImport", "rostersImport", "historyImport"].every((id) => {
        const el = document.getElementById(id);
        return !el || el.hidden; // rendered `hidden` (not removed from the DOM), same pattern as F's rules-page gate
      }));
    ok(nonCommishHidden, "a non-commissioner sees none of the three import buttons (rendered `hidden`, sessionStorage-scoped unlock never crossed contexts)");
    ok(err2.length === 0, "0 page errors as a non-commissioner viewer");
    ok(errors.length === 0, "0 page errors through the whole test-import flow");
    await ctx2.close();
    await ctx.close();
  }

  // ---- R: item 4 — league home additions (recent moves + league chat cards) ----
  section("R · league home additions — recent moves + league chat");
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    // Seed more than 8 tx-log entries and more than 6 chat messages, so both cards' own caps
    // (8 moves, 6 chat) are genuinely exercised rather than just "whatever happened to exist".
    // LG.logTx orders itself by a raw Date.now() call (NOT LG.now(), so LG.nowOverride has no
    // effect on it), and a tight synchronous loop on the LOCAL backend can genuinely complete
    // several iterations within the same millisecond — which would tie-break through
    // Array.sort's STABILITY (insertion order) instead of the intended chronology. Patching
    // Date.now itself (restored immediately after) pins a strictly-increasing clock covering
    // BOTH logTx and postChat, so "10"/"8" are unambiguously the newest.
    await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      const realNow = Date.now;
      let fakeT = Date.now() - 1000000;
      Date.now = () => (fakeT += 1000);
      for (let i = 1; i <= 10; i++) await LG.logTx("fa_add", 1, 1, { addKey: "k" + i, addName: "Add Number " + i });
      for (let i = 1; i <= 8; i++) await LG.postChat({ text: "chat message " + i });
      Date.now = realNow;
    });
    await page.evaluate(() => window.__GFFL__.UI.show("league"));
    await page.waitForSelector(".mucard", { timeout: 9000 });
    ok(!!(await page.$(".collapsecard")), "the league home renders at least one collapsible card in the new house style");
    // Boot-speed pass (2026-08-08): both cards now load their real data lazily, only once
    // opened — open each and wait for its placeholder to be replaced before reading it.
    await openDetails(page, "txDetails");
    await openDetails(page, "chatDetails");
    const movesCard = await page.evaluate(() => {
      const d = [...document.querySelectorAll(".collapsecard")].find((el) => el.textContent.includes("Recent moves"));
      return d ? { html: d.innerHTML, rows: d.querySelectorAll(".fline").length, hasBtn: !!d.querySelector("#recentMovesAll") } : null;
    });
    ok(!!movesCard, "🔁 Recent moves card is present on the league home");
    ok(movesCard.rows === 8, "…shows exactly the last 8 tx-log sentences (capped, not all 10)");
    ok(/Add Number 10\b/.test(movesCard.html) && !/Add Number 1\b/.test(movesCard.html) && !/Add Number 2\b/.test(movesCard.html),
      "…the MOST RECENT moves are shown (10 present, the oldest — #1 and #2 — trimmed off)");
    ok(movesCard.hasBtn, "…and a 'View all →' link through to the full Moves log");
    const chatCard = await page.evaluate(() => {
      const d = [...document.querySelectorAll(".collapsecard")].find((el) => el.textContent.includes("League chat"));
      return d ? { html: d.innerHTML, rows: d.querySelectorAll(".fline").length, hasBtn: !!d.querySelector("#recentChatOpen") } : null;
    });
    ok(!!chatCard, "💬 League chat card is present on the league home");
    ok(chatCard.rows === 6, "…shows exactly the last 6 main-channel messages (capped, not all 8)");
    ok(/chat message 8\b/.test(chatCard.html) && !/chat message 1\b/.test(chatCard.html) && !/chat message 2\b/.test(chatCard.html),
      "…the MOST RECENT messages are shown (8 posted, the oldest — #1 and #2 — trimmed off)");
    ok(chatCard.hasBtn, "…and an 'Open chat →' link through to the full Chat tab");
    // Sys posts (e.g. an automatic announcement) are included, not filtered out — they ARE the
    // league's own timeline. finalizeWeek/advanceBracket post sys chat messages via LG.postSys;
    // trigger one cheaply here through that same real path.
    await page.evaluate(() => window.__GFFL__.LG.postSys("A sys announcement"));
    await page.evaluate(() => window.__GFFL__.UI.show("league"));
    await page.waitForSelector(".mucard", { timeout: 9000 });
    // A genuine re-navigation to League re-arms both lazy cards (boot-speed pass) — the sys
    // post is only visible once the chat card is opened again, same as any other content here.
    await openDetails(page, "chatDetails");
    ok((await page.evaluate(() => document.body.textContent)).includes("A sys announcement"),
      "sys-posted chat messages appear on the league-home preview too, once opened");
    // "View all" / "Open chat" actually navigate.
    await clickIn(page, "#recentMovesAll");
    await page.waitForFunction(() => document.body.textContent.includes("Add Number 10"), { timeout: 5000 });
    ok((await page.evaluate(() => window.__GFFL__.UI.view)) === "moves", "'View all →' opens the full Moves log");
    await page.evaluate(() => window.__GFFL__.UI.show("league"));
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await clickIn(page, "#recentChatOpen");
    await page.waitForFunction(() => window.__GFFL__.UI.view === "chat", { timeout: 5000 });
    ok(true, "'Open chat →' opens the full Chat tab");
    ok(errors.length === 0, "0 page errors through the league-home additions flow");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_home_cards_390.png"), fullPage: true }); console.log("  📸 shots/gffl_home_cards_390.png"); }
    await ctx.close();
  }

  // ---- S: item 5 — the Scores tab (NFL slate + ESPN fantasy scoreboard) ----
  section("S · Scores tab — real NFL slate + family ESPN fantasy scoreboard");
  {
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    ok(!!(await page.$('.bnav button[data-v="scores"]')), "bottom nav has a Scores tab");
    await clickIn(page, '.bnav button[data-v="scores"]');
    await page.waitForFunction(() => document.body.textContent.includes("NFL this week"), { timeout: 9000 });
    ok((await page.evaluate(() => window.__GFFL__.UI.view)) === "scores", "nav click routes to the scores view");
    ok((await page.evaluate(() => document.querySelector('.bnav button[data-v="scores"]').classList.contains("on"))),
      "the Scores nav button highlights as active");
    // NFL half: sbFix() has one LIVE game (DAL @ PHI) and one PRE game (KC @ DEN, next year) —
    // grouped into day-CARDS (item 2's redesign — restaged from .gmrow "plain rows" to .sccard,
    // the class/markup genuinely changed shape, the behaviors this section checks persist).
    const body = await page.evaluate(() => document.body.textContent);
    const liveRowTxt = await page.$eval(".sccard.live", (el) => el.textContent);
    ok(/DAL/.test(liveRowTxt) && /PHI/.test(liveRowTxt) && /10/.test(liveRowTxt) && /14/.test(liveRowTxt),
      "live game (DAL @ PHI, 10-14) renders as a card with both teams + both scores, scoped to its own card");
    ok(/Q2 5:00/.test(liveRowTxt), "live game shows its in-progress clock/period, not a kickoff time");
    ok((await page.$$eval(".sccard.live", (els) => els.length)) === 1, "exactly one card is marked live (red-state CSS hook)");
    ok(/KC/.test(body) && /DEN/.test(body), "upcoming game (KC @ DEN) renders too, not just the live one");
    const dayHeaders = await page.$$eval(".scoreday h2", (els) => els.map((e) => e.textContent));
    ok(dayHeaders.length === 2, "games group into 2 separate day headers — the live game and the future game fall on different calendar dates");
    ok(!/Final/.test(await page.$eval(".sccard.live", (el) => el.textContent)), "the live card itself doesn't say Final");
    // Item 2: TV network (broadcasts[0].names[0]) and betting line (odds[0].details) — both are
    // real ESPN scoreboard fields (the SAME ones netlify/functions/sports.mjs already reads for
    // the standalone app), display strings only.
    ok(/FOX/.test(liveRowTxt), "live game shows its TV network (FOX)");
    const upcomingTxt = await page.evaluate(() => [...document.querySelectorAll(".sccard")].find((c) => c.textContent.includes("KC")).textContent);
    ok(/CBS/.test(upcomingTxt), "upcoming game shows its TV network (CBS)");
    ok(/DEN -3\.5/.test(upcomingTxt), "upcoming game shows its betting line (DEN -3.5)");
    ok(!/-3\.5/.test(liveRowTxt), "the live game (no odds in its fixture) shows no spread line of its own");
    // Item 2: "MINE: N players · OPP: N players" — logged-in team is 1 (Battle Kreussers), this
    // week's opponent is team 2 (from seedSchedule [[1,2],...]). DAL@PHI: team1 has 5 starters on
    // DAL/PHI (Passer-PHI, Rusher-DAL, Receiver-PHI, PHI D/ST, Kicker-DAL), team2 has 3 (Rival-DAL,
    // Wideout-PHI, DAL D/ST). KC@DEN: team1 has 4 (Tight-KC, Second/Two/Flexman-DEN), team2 has 0
    // — still shown (a real "your opponent has nobody in this one" fact, not hidden as 0/0).
    ok(/MINE: 5 players · OPP: 3 players/.test(liveRowTxt), "DAL@PHI mine/opp starter counts (5 vs 3) — " + liveRowTxt.replace(/\s+/g, " "));
    ok(/MINE: 4 players · OPP: 0 players/.test(upcomingTxt), "KC@DEN mine/opp starter counts (4 vs 0), including a real zero — " + upcomingTxt.replace(/\s+/g, " "));
    // Fantasy half: the real deployed sports function's ff_scoreboard action, fixtured — 2
    // matchups, the family's own team (Battle Kreussers) among them.
    ok(/ESPN league \(live\)/.test(body), "ESPN fantasy scoreboard card is present, labeled per spec");
    ok(/Battle Kreussers/.test(body) && /88\.4/.test(body) && /End Zone Goats/.test(body) && /61\.2/.test(body),
      "family's own matchup renders with live points (88.4 vs 61.2)");
    ok(/Wyoming Cowboys/.test(body) && /Waffle House Warriors/.test(body), "the OTHER league matchup renders too, not just the family's own");
    const ffRows = await page.$$eval(".ffrow", (els) => els.length);
    ok(ffRows === 2, "exactly 2 fantasy matchup rows (the fixture's whole week-1 slate)");
    // Degrade path: the SAME mechanism sports.mjs's own {ok:false,reason:"fantasy-not-configured"}
    // uses server-side (no ESPN_S2/ESPN_SWID cookies) — real network round trip through the real
    // in-process sports.mjs handler, genuinely exercising ffScoreboard()'s own failure branch,
    // not a client-side stub. The NFL half must keep working and the fantasy card must simply
    // disappear, never an error shown to the family.
    const s2Saved = process.env.ESPN_S2, swidSaved = process.env.ESPN_SWID;
    delete process.env.ESPN_S2; delete process.env.ESPN_SWID;
    await page.evaluate(() => window.__GFFL__.UI.renderScores());
    await page.waitForFunction(() => document.body.textContent.includes("NFL this week"), { timeout: 9000 });
    process.env.ESPN_S2 = s2Saved; process.env.ESPN_SWID = swidSaved;
    const ffSbAfter = await page.evaluate(() => window.__GFFL__.UI._ffSb);
    ok(ffSbAfter && ffSbAfter.ok === false && ffSbAfter.reason === "fantasy-not-configured",
      "the real in-process sports.mjs handler genuinely returned fantasy-not-configured (no cookies), not a stubbed response");
    const degraded = await page.evaluate(() => document.body.textContent);
    ok(!/ESPN league \(live\)/.test(degraded), "on a failed/unconfigured fantasy fetch, the ESPN fantasy card is hidden entirely — no error banner");
    ok(/DAL/.test(degraded) && /PHI/.test(degraded), "…while the NFL slate keeps rendering, completely unaffected");
    // Poll timers: armed while the tab is open, cleared on tab switch (never leak/keep firing
    // against a page that's moved on).
    const pollArmed = await page.evaluate(() => window.__GFFL__.UI._scoresPoll != null);
    ok(pollArmed, "a poll timer is armed while the Scores tab is open");
    await page.evaluate(() => window.__GFFL__.UI.show("league"));
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const pollCleared = await page.evaluate(() => window.__GFFL__.UI._scoresPoll == null);
    ok(pollCleared, "…and cleared the instant the tab is switched away from");
    ok(errors.length === 0, "0 page errors through the whole Scores tab flow");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_scores_390.png"), fullPage: true }); console.log("  📸 shots/gffl_scores_390.png"); }
    await ctx.close();
  }
  {
    // Item 2: desktop (≥1024px) lays the day's games out as a genuine two-column card grid,
    // not a single stacked column.
    const { ctx, page, errors } = await newTestPage(browser, fullSeed(), { vw: { width: 1440, height: 900 } });
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await clickIn(page, '.bnav button[data-v="scores"]');
    await page.waitForFunction(() => document.body.textContent.includes("NFL this week"), { timeout: 9000 });
    const cols = await page.evaluate(() => {
      const g = document.querySelector(".scgrid");
      return g ? getComputedStyle(g).gridTemplateColumns.split(" ").length : 0;
    });
    ok(cols === 2, "desktop scgrid lays out in a real 2-column grid (gridTemplateColumns reports " + cols + " track(s))");
    const scroll = await page.evaluate(() => ({ b: document.body.scrollWidth, w: window.innerWidth }));
    ok(scroll.b <= scroll.w + 1, "no sideways scroll at 1440px (" + scroll.b + "/" + scroll.w + ")");
    ok(errors.length === 0, "0 page errors on desktop scores");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_scores_desktop.png"), fullPage: true }); console.log("  📸 shots/gffl_scores_desktop.png"); }
    await ctx.close();
  }

  section("T · nav — active-tab indicator centering (item 6) + Draft link (item 8)");
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    // Item 8: a Draft tab exists in the SAME bar, points at ffdraft.html, styled like the other
    // tabs (never carries .on — it navigates away, it's never "the current view").
    const draftLink = await page.evaluate(() => {
      const a = document.querySelector(".bnav .bnavlink");
      return a ? { href: a.getAttribute("href"), text: a.textContent.trim(), tag: a.tagName, hasOn: a.classList.contains("on") } : null;
    });
    ok(!!draftLink && draftLink.tag === "A" && draftLink.href === "ffdraft.html" && draftLink.text === "Draft" && !draftLink.hasOn,
      "a Draft tab links straight to ffdraft.html, styled as a tab, never active (" + JSON.stringify(draftLink) + ")");
    // Item 6: for two DIFFERENT tabs (different label widths — "League" vs "My Team"), the
    // active-tab underline's own bounding box is centered under its label at 390px. The
    // underline is a border-bottom on the button's OWN box, so its rendered rect === the
    // button's rect; centering is proven by asserting the button's box is centered on the
    // label's ACTUAL rendered text (measured via a Range, not just "the button looks centered").
    async function indicatorCenterOffset(sel) {
      return page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        btn.click();
        const bRect = btn.getBoundingClientRect();
        const textNode = [...btn.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const tRect = range.getBoundingClientRect();
        return Math.abs((bRect.left + bRect.right) / 2 - (tRect.left + tRect.right) / 2);
      }, sel);
    }
    const offLeague390 = await indicatorCenterOffset('.bnav button[data-v="league"]');
    const offTeam390 = await indicatorCenterOffset('.bnav button[data-v="team"]');
    ok(offLeague390 <= 2, "mobile: League tab's indicator is centered under its label (Δ" + offLeague390.toFixed(1) + "px)");
    ok(offTeam390 <= 2, "mobile: My Team tab's indicator is centered under its label — a DIFFERENT label width (Δ" + offTeam390.toFixed(1) + "px)");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed(), { vw: { width: 1280, height: 900 } });
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    async function indicatorCenterOffset(sel) {
      return page.evaluate((sel) => {
        const btn = document.querySelector(sel);
        btn.click();
        const bRect = btn.getBoundingClientRect();
        const textNode = [...btn.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const tRect = range.getBoundingClientRect();
        return Math.abs((bRect.left + bRect.right) / 2 - (tRect.left + tRect.right) / 2);
      }, sel);
    }
    const offLeagueDesk = await indicatorCenterOffset('.bnav button[data-v="league"]');
    const offTeamDesk = await indicatorCenterOffset('.bnav button[data-v="team"]');
    ok(offLeagueDesk <= 2, "desktop: League tab's indicator is centered under its label (Δ" + offLeagueDesk.toFixed(1) + "px)");
    ok(offTeamDesk <= 2, "desktop: My Team tab's indicator is centered under its label (Δ" + offTeamDesk.toFixed(1) + "px)");
    // Item 8: no clipped labels at 390px is desktop-irrelevant (the Draft tab is auto-width
    // here), but confirm it's still present and reachable on desktop too.
    ok(!!(await page.$(".bnav .bnavlink")), "Draft tab present on desktop too");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }
  {
    // Item 8: the 8th tab must not clip any label at 390px (the mobile bar's tightest case).
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    const clipped = await page.evaluate(() => [...document.querySelectorAll(".bnav button, .bnav .bnavlink")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent.trim()));
    ok(clipped.length === 0, "no clipped nav labels at 390px with the 8th (Draft) tab added (" + JSON.stringify(clipped) + ")");
    const targets = await page.$$eval(".bnav button, .bnav .bnavlink", (els) => els.map((el) => el.getBoundingClientRect().height));
    ok(targets.every((h) => h >= 44), "every nav tab (incl. Draft) keeps a ≥44px touch target (" + targets.join(",") + ")");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  section("U · app-chrome emoji sweep (item 10) — every view, both rules modes, zero Extended_Pictographic characters in app-authored text");
  {
    // Renders each real view against a populated fixture and scans the rendered DOM text for
    // ANY Unicode Extended_Pictographic character (the same property class \p{Extended_
    // Pictographic} that the manual item-10 stripping pass hunted with, this time automated
    // as a standing regression guard). Per the brief's own two suggested strategies, this
    // combines both: (a) it strips the small, fixed set of containers that hold literal
    // USER-TYPED free text (a chat message body, a quoted reply, an owner's motto, the poster's
    // own identity name) — these are exempt by spec ("USER-TYPED chat content ... theirs") and
    // can never be enumerated/guaranteed emoji-free by this suite; and (b) it strips every
    // CURRENT team name at the TEXT level (not by selector) before scanning — team names
    // recur in dozens of places (mucard, teamrow, lockername, standings, bracket rows,
    // rivalries, and the sys-post/tx-log sentences that splice one into an otherwise fully
    // app-authored sentence), so stripping by content rather than trying to enumerate every
    // container is both more complete and more robust to future markup changes. sys chat
    // posts, transaction-log sentences, banners, and award names are DELIBERATELY LEFT IN
    // SCOPE (not stripped) — item 10 explicitly lists "sys chat posts" and "award names" among
    // the strings that must be emoji-free; they only read clean here because the app-authored
    // template TEXT around a spliced-in team name has already been hand-verified emoji-free
    // (sections K/M/N/O's own assertions) and the fixture's own team names are plain ASCII.
    async function sweep(page, label) {
      const r = await page.evaluate(() => {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll(".chatText2, .chatQuote, .lockermotto, .chatMeta b, input, textarea, option").forEach((el) => el.remove());
        let txt = clone.textContent || "";
        const names = (window.__GFFL__.LG.teams || []).map((t) => t.name).filter(Boolean);
        for (const n of names) txt = txt.split(n).join(" ");
        const re = /\p{Extended_Pictographic}/gu;
        const m = txt.match(re) || [];
        let sample = "";
        if (m.length) { const i = txt.indexOf(m[0]); sample = txt.slice(Math.max(0, i - 40), i + 40); }
        return { chars: m, sample };
      });
      ok(r.chars.length === 0, label + ": 0 pictographic characters in app chrome" +
        (r.chars.length ? " — found " + JSON.stringify(r.chars) + ' near "' + r.sample + '"' : ""));
    }

    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    // -------- page 1: league / matchup / moves (incl. the item-1 FA browse table + position
    // chips) / chat (a real waiver-processed sys post) / rules (view AND edit mode) / both
    // lockers (owner + non-owner) / scores / the bracket's default "not built yet" card. --------
    {
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await waitLive(page);
      await sweep(page, "league home");

      await clickIn(page, '.bnav button[data-v="matchup"]');
      await page.waitForSelector(".muhrow", { timeout: 9000 }).catch(() => {});
      await sweep(page, "matchup");

      await clickIn(page, '.bnav button[data-v="moves"]');
      await page.waitForSelector("#faPosChips", { timeout: 9000 });
      await sweep(page, "moves (free agents, waivers, propose-a-trade, tx log)");

      // A real claim + a real waiver process — exercises a genuine sys-chat announcement AND
      // a real transaction-log sentence, not just the empty-state copy.
      await page.evaluate(async () => {
        const LG = window.__GFFL__.LG, UI = window.__GFFL__.UI;
        await LG.addClaim(UI.week, { id: "claim_sweep_1", teamId: 1, addKey: "slp_9201", addName: "F. Agent", addPos: "WR", addTeam: "KC", dropKey: "111333", dropName: "B. Backup", bid: 5, t: Date.now() });
        await LG.processWaivers(UI.week);
      });
      await page.evaluate(() => window.__GFFL__.UI.show("moves"));
      await page.waitForSelector("#mvLog", { timeout: 9000 });
      await sweep(page, "moves (after a real processed waiver — real tx log sentence)");

      await clickIn(page, '.bnav button[data-v="chat"]');
      await page.waitForSelector(".chatlist", { timeout: 9000 });
      await sweep(page, "chat (incl. a real sys-posted waiver announcement)");

      await clickIn(page, '.bnav button[data-v="rules"]');
      await page.waitForSelector(".card", { timeout: 9000 });
      await sweep(page, "rules (view mode — item 7's grouped plain-English summary)");
      await clickIn(page, "#rulesEdit"); // commissioner PIN prompt -> stub "1234" creates + unlocks
      await page.waitForSelector(".redit", { timeout: 9000 });
      await sweep(page, "rules (EDIT mode — item 7's friendly labels on every input row)");
      await clickIn(page, "#rulesCancel");
      await page.waitForFunction(() => !document.querySelector(".redit"), { timeout: 5000 });

      await page.evaluate(() => { window.__GFFL__.UI.lockerTeamId = window.__GFFL__.LG.myTeamId(); window.__GFFL__.UI.show("locker"); });
      await page.waitForSelector(".lockerhead", { timeout: 9000 });
      await sweep(page, "locker (own team — owner edit affordances + lineup)");

      await page.evaluate(() => { window.__GFFL__.UI.lockerTeamId = 2; window.__GFFL__.UI.show("locker"); });
      await page.waitForSelector(".lockerhead", { timeout: 9000 });
      await sweep(page, "locker (someone else's team — read-only view)");

      await clickIn(page, '.bnav button[data-v="scores"]');
      await page.waitForFunction(() => document.body.textContent.includes("NFL this week"), { timeout: 9000 });
      await sweep(page, "scores (NFL slate + fantasy scoreboard/fallback card)");

      await page.evaluate(() => window.__GFFL__.UI.show("bracket"));
      await page.waitForSelector(".card", { timeout: 9000 });
      await sweep(page, "bracket (default pre-season — \"hasn't been built yet\" card)");

      ok(errors.length === 0, "0 page errors sweeping the whole general-fixture flow");
      if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_theme_league_390.png"), fullPage: true }); console.log("  📸 shots/gffl_theme_league_390.png"); }
      await ctx.close();
    }

    // -------- page 2: a FULLY BUILT playoff bracket (byes/play-in/consolation labels,
    // "Winner of #.../..." placeholders) — the champion/Toilet-Bowl banner strings themselves
    // are already separately hand-verified emoji-free by section O's own assertions. --------
    {
      const { ctx, page, errors } = await newTestPage(browser, seedFor7Playoffs());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await page.evaluate(() => {
        const LG = window.__GFFL__.LG;
        const start = new Date(LG.SEASON_START + "T05:00:00-05:00").getTime();
        LG.nowOverride = start + 14 * 7 * 24 * 3600 * 1000 + 3600000; // 1h into week 15
        window.__GFFL__.UI.week = LG.currentWeek();
      });
      await page.evaluate(() => window.__GFFL__.LG.buildBracket());
      await page.evaluate(() => window.__GFFL__.UI.show("bracket"));
      await page.waitForSelector(".bracketrounds", { timeout: 9000 });
      await sweep(page, "bracket (fully built — byes, play-in, semis, consolation rounds)");
      ok(errors.length === 0, "0 page errors sweeping the built bracket");
      if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_theme_bracket_390.png"), fullPage: true }); console.log("  📸 shots/gffl_theme_bracket_390.png"); }
      await ctx.close();
    }
  }

  // ---- V: the adversarial-review fix batch (2026-08-08) ----
  // Every check below is built from a CONFIRMED finding's own reproduction steps. Where a
  // check is a genuine pre-fix repro (it fails against the code as it stood before this
  // batch), the comment says so — those were verified by stashing the three app files and
  // re-running this section, not asserted from reasoning.
  section("V · adversarial review 2026-08-08 — week provenance, cache lost-updates, playoff ordering, import scoring, poll fairness");

  // V1: findings 1/3/7 — finalizeWeek used to take `week` for the ROSTER lookup only and
  // multiply it by whatever the live engine happened to be holding, then write a WRITE-ONCE
  // doc. The finding's repro verbatim: week-3 rosters, an engine sitting on week 4, and week
  // 4's numbers being the OPPOSITE result to week 3's.
  {
    fixture.espnWeekNum = 4; fixture.sleeperWeek = 4;
    const { ctx, page, errors } = await newTestPage(browser, seedWeekProvenance());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    const ew = await page.evaluate(() => window.__GFFL__.D.engineWeek());
    ok(ew === 4, "the engine reports its OWN authoritative week (4) — the provenance finalization now refuses to guess at (" + ew + ")");
    // The board as it reads on the Tuesday of week 4: week 4's points, every game final.
    await page.evaluate(() => {
      const D = window.__GFFL__.D;
      const setP = (key, name, team, pos, pts) =>
        D.S.players.set(key, { key, name, team, pos, pts, espn: null, slp: null, official: null, injury: "", src: "", conflict: false, last: 0 });
      setP("3915511", "P. Passer", "PHI", "QB", 1);    // week 4: 25 pass yds
      setP("222111", "Q. Rival", "DAL", "QB", 28);     // week 4: 400 yds, 3 TD
      ["PHI", "DAL", "DEN", "KC"].forEach((ab) => D.S.games.set(ab, { state: "post", period: 4, clock: "0:00" }));
    });
    // PRE-FIX REPRO: this returned {ok:true} and permanently recorded week 3 as 1.0 — 28.0,
    // charging team 1 a loss it actually won, with no warning and no way to undo it.
    const stale = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(3));
    ok(stale.ok === false && stale.reason === "stale-week" && stale.engineWeek === 4,
      "finalizeWeek REFUSES week 3 while the live board is showing week 4 (" + JSON.stringify(stale) + ")");
    ok(!(await readDoc(page, "weekly_2026_w3")), "…and nothing was written — no wrong numbers, silently or otherwise");
    const forced = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(3, { force: true }));
    ok(forced.ok === false && forced.reason === "stale-week",
      "the commissioner's force override does NOT bypass it — force only ever meant \"some games aren't final\", never \"score it from a different week\"");
    ok(!(await readDoc(page, "weekly_2026_w3")), "…still nothing written");
    // The honest fallback: Sleeper's archived per-week stats, which still hold week 3's own
    // numbers (P. Passer 300yd/2TD = 20.0 · Q. Rival 50yd = 2.0 — team 1 really won).
    const back = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(3, { backfill: true }));
    const m = back.ok && back.matchups.find((x) => x.home === 1 && x.away === 2);
    ok(back.ok === true && !!m && m.homePts === 20 && m.awayPts === 2,
      "the archived-stats backfill finalizes week 3 from WEEK 3's own stat lines: 20.0 — 2.0 (" + JSON.stringify(m) + ")");
    ok(back.source === "archived", "…and the doc records that provenance on the record (source=" + back.source + ")");
    const st = await page.evaluate(() => window.__GFFL__.LG.loadStandings());
    ok(st[1].w === 1 && st[1].l === 0 && st[2].l === 1,
      "…so the standings credit the team that actually won week 3 (" + JSON.stringify({ t1: st[1], t2: st[2] }) + ")");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
    fixture.espnWeekNum = null; fixture.sleeperWeek = null;
  }

  // V1b: the other side of the same gate — when the engine IS on the week being finalized,
  // the ordinary live path still works, and auto-finalization now reaches the CURRENT week
  // (it used to stop at currentWeek()-1, which is precisely why week N was only ever
  // finalizable after the engine had already rolled off it).
  {
    fixture.espnWeekNum = 3; fixture.sleeperWeek = 3;
    const { ctx, page, errors } = await newTestPage(browser, seedWeekProvenance());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(() => {
      const LG = window.__GFFL__.LG, D = window.__GFFL__.D;
      const setP = (key, name, team, pos, pts) =>
        D.S.players.set(key, { key, name, team, pos, pts, espn: null, slp: null, official: null, injury: "", src: "", conflict: false, last: 0 });
      setP("3915511", "P. Passer", "PHI", "QB", 20);   // week 3's real line
      setP("222111", "Q. Rival", "DAL", "QB", 2);
      ["PHI", "DAL", "DEN", "KC"].forEach((ab) => D.S.games.set(ab, { state: "post", period: 4, clock: "0:00" }));
      const start = new Date(LG.SEASON_START + "T05:00:00-05:00").getTime();
      LG.nowOverride = start + 2 * 7 * 24 * 3600 * 1000 + 3600000; // 1h into week 3 — the CURRENT week
    });
    const cw = await page.evaluate(() => window.__GFFL__.LG.currentWeek());
    ok(cw === 3, "the clock reads week 3 — the week the engine is holding (" + cw + ")");
    await page.evaluate(() => window.__GFFL__.UI.maybeAutoFinalizeWeeks());
    const doc3 = await readDoc(page, "weekly_2026_w3");
    const m3 = doc3 && doc3.matchups.find((x) => x.home === 1 && x.away === 2);
    ok(!!m3 && m3.homePts === 20 && m3.awayPts === 2 && doc3.source === "live",
      "auto-finalization settles the CURRENT week from the live board once every game is final: 20.0 — 2.0 (" + JSON.stringify(m3) + ")");
    ok(!(await readDoc(page, "weekly_2026_w2")) && !(await readDoc(page, "weekly_2026_w1")),
      "…and weeks 1-2, which the engine can no longer score, were left alone rather than stamped with week 3's points");
    const staleList = await page.evaluate(() => window.__GFFL__.UI._staleWeeks);
    ok(Array.isArray(staleList) && staleList.includes(1) && staleList.includes(2) && !staleList.includes(3),
      "…they're recorded as needing attention instead (" + JSON.stringify(staleList) + ")");
    // The auto path and the league home's own scan must produce the SAME shape — the card
    // repaints straight off this field without recomputing.
    const rendered = await page.evaluate(async () => {
      await window.__GFFL__.UI.renderLeague();
      const h = [...document.querySelectorAll("h2")].find((x) => /needs? finalizing/.test(x.textContent));
      return h ? h.closest(".card").textContent.replace(/\s+/g, " ") : "";
    });
    ok(/Week 1/.test(rendered) && /Week 2/.test(rendered) && !/object Object/.test(rendered),
      "…and the league home renders them as real week numbers (" + rendered.slice(0, 80) + ")");
    await page.evaluate(() => { window.__GFFL__.LG.nowOverride = null; });
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
    fixture.espnWeekNum = null; fixture.sleeperWeek = null;
  }

  // V1c: the league home SAYS SO — a week the engine can no longer score is stated plainly,
  // and the commissioner settles it from that week's own archived stats, in the real UI.
  {
    fixture.espnWeekNum = 4; fixture.sleeperWeek = 4;
    const { ctx, page, errors } = await newTestPage(browser, seedWeekProvenance());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(() => {
      const LG = window.__GFFL__.LG;
      const start = new Date(LG.SEASON_START + "T05:00:00-05:00").getTime();
      LG.nowOverride = start + 3 * 7 * 24 * 3600 * 1000 + 3600000; // 1h into week 4
      window.__GFFL__.UI.week = LG.currentWeek();
    });
    await page.evaluate(() => window.__GFFL__.LG.gateCommish()); // create-on-first-use, consumes the stub prompt
    await page.evaluate(() => window.__GFFL__.UI.renderLeague());
    await page.waitForFunction(() => /needs? finalizing/.test(document.body.textContent), { timeout: 9000 });
    const cardTxt = await page.evaluate(() => {
      const h = [...document.querySelectorAll("h2")].find((x) => /needs? finalizing/.test(x.textContent));
      return h ? h.closest(".card").textContent.replace(/\s+/g, " ").trim() : "";
    });
    ok(/Live scoring has already moved on/.test(cardTxt), "the league home states plainly that live scoring can't settle these weeks (" + cardTxt.slice(0, 120) + ")");
    ok(/Week 1/.test(cardTxt) && /Week 2/.test(cardTxt) && /Week 3/.test(cardTxt), "…naming each week that needs it");
    const btns = await page.$$eval(".staleFinBtn", (els) => els.map((e) => e.dataset.w));
    ok(btns.includes("3") && !btns.includes("4"), "…with a commissioner button per week, and NOT for week 4 — which the engine can still score live (" + JSON.stringify(btns) + ")");
    await page.evaluate(() => [...document.querySelectorAll(".staleFinBtn")].find((b) => b.dataset.w === "3").click());
    await page.waitForFunction(() => !!localStorage.getItem("lg_gffl_test1_weekly_2026_w3"), { timeout: 9000 });
    const doc3 = await readDoc(page, "weekly_2026_w3");
    const m3 = doc3.matchups.find((x) => x.home === 1 && x.away === 2);
    ok(m3.homePts === 20 && m3.awayPts === 2 && doc3.source === "archived",
      "tapping it finalizes week 3 from week 3's own archived stats, through the real UI (" + JSON.stringify(m3) + ")");
    await page.evaluate(() => { window.__GFFL__.LG.nowOverride = null; });
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
    fixture.espnWeekNum = null; fixture.sleeperWeek = null;
  }

  // V2: finding 1's widening note — pollScoreboard only ever .set() into D.S.games, so a tab
  // left open across the Tuesday rollover kept LAST week's "post" entries forever, and the
  // "is every game final?" guard passed for any past week, in any week, byes included.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    const before = await page.evaluate(() => {
      const D = window.__GFFL__.D;
      D.S.games.set("BUF", { eventId: "stale1", state: "post", period: 4, clock: "0:00" }); // last week's game
      D.S.games.set("PHI", { eventId: "401900001", state: "post", period: 4, clock: "0:00" }); // wrongly stuck at post
      return [...D.S.games.keys()].length;
    });
    await poll(page);
    const after = await page.evaluate(() => {
      const D = window.__GFFL__.D;
      return { has: [...D.S.games.keys()], phi: (D.S.games.get("PHI") || {}).state };
    });
    ok(!after.has.includes("BUF"), "a team no longer on this week's slate disappears from the game map — it is REBUILT each poll, never merged into (" + before + " -> " + after.has.length + ")");
    ok(after.phi === "in", "…and a stale 'post' is overwritten by what the slate actually says now (" + after.phi + ")");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // V3: findings 2/5/12 — two owners submitting waiver claims from two devices used to erase
  // each other. LG.addClaim was a read-modify-write over a shared `claims` ARRAY (and both
  // backends replace an array field wholesale), read through a doc cache that never expired.
  // The finding's repro: this page renders Moves first (caching the claims doc as it stands),
  // then another device writes a claim, then this page submits its own.
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForSelector("#faSearch", { timeout: 9000 });
    // Mom's device, on her own phone, submits a $40 bid — written straight into the shared
    // store, bypassing THIS page's LG.db entirely (the suite's established cross-device
    // technique). Written in the pre-split ARRAY shape, which is both what the old code wrote
    // and what a week carried over from before this batch still looks like.
    await page.evaluate((k, doc) => localStorage.setItem(k, JSON.stringify(doc)), LSPFX + "claims_2026_w1", {
      kind: "claims", week: 1, processed: false, results: null, claims: [
        { id: "m1", teamId: 2, addKey: "dst_KC", addName: "KC D/ST", addPos: "DST", addTeam: "KC", dropKey: "dst_DAL", dropName: "DAL D/ST", bid: 40, t: 1 },
      ],
    });
    // PRE-FIX REPRO: this rebuilt the whole array from the stale cached base and wrote back
    // {claims:["d1"]} — m1 gone from storage, with no error and nothing on anyone's screen.
    await page.evaluate(() => window.__GFFL__.LG.addClaim(1, {
      id: "d1", teamId: 1, addKey: "dst_KC", addName: "KC D/ST", addPos: "DST", addTeam: "KC", dropKey: "111333", dropName: "B. Backup", bid: 5, t: 2,
    }));
    const shared = await readDoc(page, "claims_2026_w1");
    ok(shared && (shared.claims || []).some((c) => c.id === "m1"),
      "the other owner's $40 claim is still in the shared store after this page submits its own (" + JSON.stringify((shared.claims || []).map((c) => c.id)) + ")");
    const both = await page.evaluate(() => window.__GFFL__.LG.loadClaims(1, { fresh: true }));
    const ids = (both.claims || []).map((c) => c.id).sort();
    ok(ids.join(",") === "d1,m1", "…and BOTH claims are on the board for processing (" + JSON.stringify(ids) + ")");
    const res = await page.evaluate(() => window.__GFFL__.LG.processWaivers(1));
    const rm = (res.results || []).find((r) => r.id === "m1"), rd = (res.results || []).find((r) => r.id === "d1");
    ok(rm && rm.ok === true && rd && rd.ok === false && rd.reason === "outbid",
      "…so the $40 bid WINS the player and the $5 bid is honestly outbid, instead of the $5 bid winning by default (" + JSON.stringify({ rm, rd }) + ")");
    const t2 = await page.evaluate(() => window.__GFFL__.LG.db.getFresh("team_2"));
    ok(t2.faab === 60, "…and the winner's FAAB really moved (100 → 60)");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // V4: finding 4 — a page holding a cached roster wrote the WHOLE players array back on the
  // next lineup tap, silently undoing a waiver win or an executed trade that had landed in
  // between (with the FAAB still spent and the transaction log still narrating the move).
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(() => { window.__GFFL__.UI.lockerTeamId = 1; window.__GFFL__.UI.show("locker"); });
    await page.waitForSelector(".lrow", { timeout: 9000 });
    // Wednesday 8am: waivers process on the commissioner's device. Team 1 wins "fa9" and
    // drops H. Healthy. Written straight into the shared store — this page never sees it.
    const seedRos = await readDoc(page, "roster_2026_w1_t1");
    const wonRos = seedRos.players.filter((p) => p.key !== "111777")
      .concat([{ key: "fa9", name: "W. Winner", pos: "WR", team: "KC", slot: "BENCH" }]);
    await page.evaluate((k, doc) => localStorage.setItem(k, JSON.stringify(doc)), LSPFX + "roster_2026_w1_t1",
      { kind: "roster", week: 1, teamId: 1, players: wonRos });
    // The owner, whose tab has been open the whole time, taps an unrelated lineup change:
    // move the OUT player to IR (section E's own flow).
    await clickIn(page, ".lrow", "I. Injured");
    await page.waitForSelector("#swapSheet .swaprow", { timeout: 5000 });
    await clickIn(page, "#swapSheet .swaprow", "IR");
    await page.waitForFunction(() => {
      const d = JSON.parse(localStorage.getItem("lg_gffl_test1_roster_2026_w1_t1") || "{}");
      return (d.players || []).some((p) => p.key === "111666" && p.slot === "IR");
    }, { timeout: 9000 });
    const saved = await readDoc(page, "roster_2026_w1_t1");
    const keys = saved.players.map((p) => p.key);
    // PRE-FIX REPRO: both of these failed — the cached array came back, so fa9 vanished and
    // the dropped player reappeared.
    ok(keys.includes("fa9"), "the waiver-won player SURVIVES an unrelated lineup tap from a stale tab (" + JSON.stringify(keys) + ")");
    ok(!keys.includes("111777"), "…and the dropped player stays dropped");
    ok(saved.players.find((p) => p.key === "111666").slot === "IR", "…while the tap itself still did exactly what it meant to");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // V5a: findings 6/8 — a playoff week's weekly doc is WRITE-ONCE, and gamesForWeek omits a
  // pairing that hasn't resolved yet. Finalizing a semifinal week before the play-in has been
  // advanced therefore deleted that semifinal from the official record permanently, and no
  // champion could ever be crowned.
  {
    fixture.espnWeekNum = 16; fixture.sleeperWeek = 16;
    const { ctx, page, errors } = await newTestPage(browser, seedFor7Playoffs());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(async () => {
      const LG = window.__GFFL__.LG, D = window.__GFFL__.D;
      const start = new Date(LG.SEASON_START + "T05:00:00-05:00").getTime();
      LG.nowOverride = start + 15 * 7 * 24 * 3600 * 1000 + 3600000; // 1h into week 16
      await LG.buildBracket();
      ["PHI", "DAL", "DEN", "KC"].forEach((ab) => D.S.games.set(ab, { state: "post", period: 4, clock: "0:00" }));
    });
    const semi1 = await page.evaluate(async () => (await window.__GFFL__.LG.loadBracket()).rounds.r2.find((g) => g.id === "semi1"));
    ok(semi1.home != null && semi1.away == null, "semi1 is waiting on the play-in winner, exactly as built (" + JSON.stringify(semi1) + ")");
    // PRE-FIX REPRO: this returned ok:true and wrote week 16 containing only semi2 + the
    // consolation game — the #1 seed's semifinal simply absent from the record, forever.
    const r = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(16));
    ok(r.ok === false && r.reason === "bracket-unresolved" && (r.games || []).includes("semi1"),
      "finalizeWeek REFUSES a playoff week with an unresolved pairing (" + JSON.stringify(r) + ")");
    const rf = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(16, { force: true }));
    ok(rf.ok === false && rf.reason === "bracket-unresolved", "…and force does not bypass it either — the doc is write-once, so a game short is a game lost");
    ok(!(await readDoc(page, "weekly_2026_w16")), "…nothing written");
    await page.evaluate(() => { window.__GFFL__.LG.nowOverride = null; });
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
    fixture.espnWeekNum = null; fixture.sleeperWeek = null;
  }

  // V5b: the season-sim outcome the finding measured — play the postseason out on the
  // ordinary cadence and a champion is ALWAYS crowned, with every bracket game on the record.
  {
    const { ctx, page, errors } = await newTestPage(browser, seedFor7Playoffs());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    for (const w of [15, 16, 17]) {
      await page.evaluate(async (w) => {
        const LG = window.__GFFL__.LG, D = window.__GFFL__.D;
        const start = new Date(LG.SEASON_START + "T05:00:00-05:00").getTime();
        LG.nowOverride = start + (w - 1) * 7 * 24 * 3600 * 1000 + 3600000;
        D.S.espnWeek = w; D.S.slpWeek = w;                       // the live board IS this week
        for (const ab of ["PHI", "DAL", "DEN", "KC"]) D.S.games.set(ab, { state: "post", period: 4, clock: "0:00" });
        await window.__GFFL__.UI.maybeAdvanceLeague();
      }, w);
    }
    const counts = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      const n = async (w) => ((await LG.loadWeekly(w)) || { matchups: [] }).matchups.length;
      const b = await LG.loadBracket();
      return { w15: await n(15), w16: await n(16), w17: await n(17), champion: b && b.champion };
    });
    ok(counts.w15 === 2, "week 15 records both of its games — the play-in and consolation A (" + counts.w15 + ")");
    ok(counts.w16 === 3, "week 16 records BOTH semifinals plus consolation B (" + counts.w16 + ") — pre-fix this was 2, the #1 seed's semi permanently missing");
    ok(counts.w17 === 3, "week 17 records the championship, the 3rd-place game and consolation C (" + counts.w17 + ")");
    ok(counts.champion != null, "a champion is crowned (team " + counts.champion + ")");
    await page.evaluate(() => { window.__GFFL__.LG.nowOverride = null; });
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // V5c: the finding's actual trigger — nobody opens the app for the whole postseason. The
  // engine has rolled past all three weeks, so nothing auto-finalizes; the commissioner
  // settles them from archived stats, and the bracket still walks all the way to a champion
  // because each week is advanced before the next one is written.
  {
    fixture.espnWeekNum = 18; fixture.sleeperWeek = 18;
    const { ctx, page, errors } = await newTestPage(browser, seedFor7Playoffs());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    const out = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      const start = new Date(LG.SEASON_START + "T05:00:00-05:00").getTime();
      LG.nowOverride = start + 17 * 7 * 24 * 3600 * 1000 + 3600000; // deep in week 18
      await window.__GFFL__.UI.maybeAdvanceLeague();               // builds the bracket, finalizes nothing
      const auto = { w15: !!(await LG.loadWeekly(15)), w16: !!(await LG.loadWeekly(16)) };
      const reasons = [];
      for (const w of [15, 16, 17]) {                              // the commissioner's own sequence
        const r = await LG.finalizeWeek(w, { backfill: true });
        reasons.push({ w, ok: r.ok, reason: r.reason });
        if (r.ok) await LG.advanceBracket();
      }
      const b = await LG.loadBracket();
      const n = async (w) => ((await LG.loadWeekly(w)) || { matchups: [] }).matchups.length;
      return { auto, reasons, champion: b && b.champion, w15: await n(15), w16: await n(16), w17: await n(17) };
    });
    ok(out.auto.w15 === false && out.auto.w16 === false,
      "nothing auto-finalizes once the engine has rolled past the whole postseason — it refuses rather than guessing");
    ok(out.reasons.every((r) => r.ok), "each week backfills from its own archived stats (" + JSON.stringify(out.reasons) + ")");
    ok(out.w16 === 3 && out.w17 === 3, "…with every bracket game recorded (w16 " + out.w16 + ", w17 " + out.w17 + ")");
    ok(out.champion != null, "…and a champion is crowned from a cold catch-up (team " + out.champion + ")");
    await page.evaluate(() => { window.__GFFL__.LG.nowOverride = null; });
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
    fixture.espnWeekNum = null; fixture.sleeperWeek = null;
  }

  // V6: finding 9 — the Sleeper stats bucket rotated [week, week+1, "1"] and LOCKED on the
  // first candidate that returned anything. Week 1's bucket is the one bucket that is always
  // full, so between the Tuesday rollover and the week's first kickoff (all of Tue/Wed/Thu,
  // every week) it locked onto week 1's completed lines and served them as live scoring.
  {
    fixture.sleeperWeek = 11; fixture.emptyWeekBucket = 11;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await poll(page); await poll(page); await poll(page); await poll(page);
    const st = await page.evaluate(() => {
      const D = window.__GFFL__.D;
      const row = D.S.players.get("3915511");
      return { cands: D.S.slpBucket.cands, locked: D.S.slpBucket.locked, week: D.S.slpWeek, engine: D.engineWeek(), slpSide: row ? row.slp : "no-row" };
    });
    ok(JSON.stringify(st.cands) === '["11"]', "the stats bucket is EXACTLY the authoritative week — no week-1 fallback candidate to fall onto (" + JSON.stringify(st.cands) + ")");
    ok(st.locked === false, "…nothing locked, because there was nothing legitimate to lock onto");
    ok(st.slpSide == null, "…and after four polls not one week-1 stat line has been served as this week's scoring (" + JSON.stringify(st.slpSide) + ")");
    ok(st.week === 11 && st.engine === 11, "…while the engine still knows which week it's on (" + st.engine + ")");
    ok(errors.length === 0, "0 page errors with an empty current-week bucket");
    await ctx.close();
    fixture.sleeperWeek = null; fixture.emptyWeekBucket = null;
  }

  // V7: finding 10 — both list() implementations built rows as {id, ...doc}, so a doc
  // carrying its own stray numeric `id` clobbered its real doc-id on every COLD read. The
  // next cacheUpsert then couldn't find the row it had just written, pushed a duplicate, and
  // LG.teamById started returning the pre-edit copy. (cacheUpsert had this exact fix already;
  // the two functions that FEED it did not.)
  {
    const base = fullSeed();
    const poisoned = { ...base.docs };
    poisoned.team_1 = { kind: "team", teamId: 1, name: "Battle Kreussers", abbrev: "T1", owner: "", faab: 90, id: 1 };
    const { ctx, page, errors } = await newTestPage(browser, { ...base, docs: poisoned });
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const cold = await page.evaluate(async () => (await window.__GFFL__.LG.db.list("team")).map((d) => d.id));
    ok(cold.includes("team_1") && !cold.includes(1), "a cold list() row keeps its real doc-id even when the doc carries a numeric `id` field (" + JSON.stringify(cold.slice(0, 3)) + ")");
    const after = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      await LG.saveTeam({ teamId: 1, motto: "Ready" });
      await LG.saveTeam({ teamId: 2, motto: "Also ready" });
      await LG.loadTeams();
      const raw1 = await LG.db.getFresh("team_1"), raw2 = await LG.db.getFresh("team_2");
      return { dupes: LG.teams.filter((t) => t.id === 1).length, faab: LG.teamById(1).faab, motto: raw1.motto, cleanId: raw2.id };
    });
    ok(after.dupes === 1, "…so a save on a cold cache updates in place instead of pushing a stale duplicate (" + after.dupes + " row(s) for team 1)");
    ok(after.faab === 90, "…and LG.teamById reads the CURRENT team, not a pre-edit copy (faab " + after.faab + ")");
    // HONEST SCOPE (the finding says so itself): a doc ALREADY carrying the stray field keeps
    // it — both backends merge, so a write cannot delete a field. It is now inert, because
    // list() attaches the real doc-id LAST and nothing reads `.id` off a get(). What matters
    // is that no NEW stray is ever minted: saveTeam strips the numeric `id` LG.loadTeams()
    // stamps on every in-memory team before writing.
    ok(after.cleanId === undefined && after.motto === "Ready",
      "…and a save never MINTS a stray `id` field — the round-trip that poisoned these docs in the first place is closed (" + JSON.stringify(after.cleanId) + ")");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // V8: finding 11 — the ESPN import MERGED over the GFFL defaults, so every scoring key the
  // real league doesn't configure kept a default. The family league scores field goals ONLY
  // by made YARDS (statId 214 at 0.1/yd, reconciled to the penny against a real season) and
  // carries no conventional FG-made ids at all, so fg_0_39/40_49/50 survived at 3/4/5 and
  // D.score() paid BOTH — roughly double for every made field goal, every week.
  {
    fixture.noFgBuckets = true;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await page.evaluate(() => window.__GFFL__.UI.show("rules"));
    await page.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 5000 });
    await clickIn(page, "#rulesImport");
    await page.waitForSelector("#importApply", { timeout: 9000 });
    await clickIn(page, "#importApply");
    await page.waitForFunction(() => window.__GFFL__.LG.rules.scoring.fg_made_yd === 0.1, { timeout: 9000 });
    const sc = await page.evaluate(() => window.__GFFL__.LG.rules.scoring);
    ok(sc.fg_0_39 === 0 && sc.fg_40_49 === 0 && sc.fg_50 === 0,
      "a scoring key the real league doesn't list drops to 0 — the import REPLACES scoring, it doesn't merge over ours (" + JSON.stringify({ a: sc.fg_0_39, b: sc.fg_40_49, c: sc.fg_50 }) + ")");
    // A kicker's ordinary day: 25 / 45 / 52-yd field goals + 2 extra points.
    const pts = await page.evaluate(() => window.__GFFL__.D.score({ fg_0_39: 1, fg_40_49: 1, fg_50: 1, fg_made_yd: 122, xp_made: 2 }));
    ok(pts === 14.2, "…so a made field goal scores ONCE, via made-yards: 122 × 0.1 + 2 XP = 14.2 (" + pts + ") — pre-fix this read 26.2");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
    fixture.noFgBuckets = false;
  }

  // V9: finding 13 — pollOnce fetched `[...wanted.keys()].slice(0, 8)`, and `wanted` is
  // rebuilt from a Set with frozen insertion order every cycle, so the SAME eight games were
  // refreshed forever and everything past the eighth was never fetched again. Silent, because
  // health only counts fetches that FAILED, never fetches that were never attempted.
  {
    fixture.bigSlate = true;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await stopPolling(page);
    const total = await page.evaluate(async () => {
      const D = window.__GFFL__.D;
      await D.pollOnce();
      D.trackTeams([...D.S.games.keys()]);          // an 8-team league's starters span the slate
      for (const k of Object.keys(D.EP)) if (k.startsWith("espn summary ")) delete D.EP[k];
      return new Set([...D.S.games.values()].map((g) => g.eventId)).size;
    });
    ok(total >= 12, "the slate has more concurrent games than one poll cycle can fetch (" + total + " > 8)");
    const oneCycle = await page.evaluate(async () => {
      const D = window.__GFFL__.D;
      await D.pollOnce();
      return Object.keys(D.EP).filter((k) => k.startsWith("espn summary ")).length;
    });
    ok(oneCycle === 8, "one cycle still fetches at most 8 summaries — the cap itself is unchanged (" + oneCycle + ")");
    const covered = await page.evaluate(async (n) => {
      const D = window.__GFFL__.D;
      for (let i = 0; i < Math.ceil(n / 8); i++) await D.pollOnce();
      const seen = new Set(Object.keys(D.EP).filter((k) => k.startsWith("espn summary ")).map((k) => k.slice(13)));
      const want = new Set([...D.S.games.values()].map((g) => g.eventId));
      return { seen: seen.size, want: want.size, missing: [...want].filter((e) => !seen.has(e)) };
    }, total);
    ok(covered.missing.length === 0,
      "…but the window ROTATES, so every tracked game is refreshed within a couple of cycles (" + covered.seen + "/" + covered.want + ", missing " + JSON.stringify(covered.missing) + ")");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
    fixture.bigSlate = false;
  }

  // V10: finding 14 — two defects from one call. deriveEspnDst read the header score, which
  // is "0" before kickoff, so every starting D/ST was credited a 5-point shutout all week;
  // and the completion handler struck ANY non-live game off the fetch list, so a game polled
  // while `pre` consumed its one "read the final box" token and its real final was never read.
  {
    fixture.pregame = true; fixture.pregameState = "pre";
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await stopPolling(page);
    const pre = await page.evaluate(async () => {
      const D = window.__GFFL__.D;
      await D.pollOnce();
      D.trackTeams(["SF", "SEA"]);
      await D.pollOnce();
      const row = D.S.players.get("dst_SF");
      return { pts: row ? row.pts : null, espn: row ? !!row.espn : false, fetchedFinal: [...D.S.fetchedFinal] };
    });
    ok(pre.espn === false && (pre.pts == null || pre.pts === 0),
      "a game that hasn't kicked off credits its D/ST NOTHING — no free 5-point shutout off a 0-0 header (" + JSON.stringify({ pts: pre.pts, espn: pre.espn }) + ")");
    ok(!pre.fetchedFinal.includes("401900777"),
      "…and a pre-game poll does NOT consume that game's one final-box read (" + JSON.stringify(pre.fetchedFinal) + ")");
    fixture.pregameState = "post";
    const post = await page.evaluate(async () => {
      const D = window.__GFFL__.D;
      await D.pollOnce();
      const row = D.S.players.get("dst_SF");
      return { pts: row ? row.pts : null, fetchedFinal: [...D.S.fetchedFinal] };
    });
    // SF's defense: 3 sacks (×1) + 2 INT (×2) + 10 points allowed (dst_pa_7_13 = 3) = 10.0
    ok(post.pts === 10, "…so when the game IS final its real box is still read, and the D/ST scores it: 3 sacks + 2 INT + 10 PA = 10.0 (" + post.pts + ")");
    ok(post.fetchedFinal.includes("401900777"), "…and only THEN is the final-box token consumed (" + JSON.stringify(post.fetchedFinal) + ")");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
    fixture.pregame = false; fixture.pregameState = "pre";
  }

  // ---- W: boot speed — nav-to-league-home-painted budget (2026-08-08 boot-speed pass) ----
  // UI.boot()/renderLeague() used to be a chain of 12+ SERIAL awaited backend calls before the
  // first pixel of the league home ever painted — fine against the instant local backend every
  // other section here runs on, but on a real (non-instant) backend that's 12+ stacked round
  // trips. This section proves the STRUCTURAL fix (parallel batches, not serial calls) rather
  // than just timing the fast local path everything else already exercises: it arms a fake
  // cloud with a real per-call delay (LG.db._installFakeCloud — same mechanism as the P4 perf
  // test, just wired up BEFORE the page's own scripts run, via a setter on window.LG installed
  // through evaluateOnNewDocument, so it's in place before boot's first real read rather than
  // racing it) and asserts the COLD nav-to-".mucard" time stays under a budget that a serial
  // chain could not possibly hit. Measured on this box: ~300-340ms cold under an 80ms/call fake
  // cloud (2-3 real round trips: the Promise.all in UI.boot(), then renderLeague's two
  // batches) vs ~1,760ms under the pre-boot-speed-pass serial chain (12+ round trips) — an
  // ~82% reduction. The budget here (900ms) is deliberately generous over the measured ~300ms
  // so the check isn't sensitive to this box's own noise, while still failing hard if the
  // fetch chain ever regresses back to a dozen serial round trips (which would take 960ms+
  // just from 12 × 80ms, before any fixed overhead).
  section("W · boot speed — nav-to-league-home-painted budget (2026-08-08 boot-speed pass)");
  {
    const SLOW_MS = 80;
    const BUDGET_MS = 900;
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 390, height: 844 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const seed = fullSeed();
    await page.evaluateOnNewDocument((seed, pfx) => {
      window.__prompts = ["Peter"];
      window.prompt = () => (window.__prompts.length ? window.__prompts.shift() : "1234");
      window.alert = () => {}; window.confirm = () => true;
      try {
        if (seed.pass) localStorage.setItem("gffl_pass", seed.pass);
        if (seed.team) localStorage.setItem("gffl_team", String(seed.team));
        if (seed.who) localStorage.setItem("gffl_who", seed.who);
        for (const id of Object.keys(seed.docs || {})) localStorage.setItem(pfx + id, JSON.stringify(seed.docs[id]));
      } catch (e) {}
    }, seed, LSPFX);
    // Arms LG.db._installFakeCloud the instant window.LG (and then LG.db) is first assigned —
    // lg-core.js's `LG.db = {...}` mutates the SAME object window.LG's own setter received, so
    // a nested setter on THAT object's "db" property catches it with zero race window, before
    // LG.backendReady's async continuation or UI.boot() can possibly read anything for real.
    await page.evaluateOnNewDocument((delayMs, pfx) => {
      let realLG = null;
      Object.defineProperty(window, "LG", {
        configurable: true,
        get() { return realLG; },
        set(v) {
          realLG = v;
          if (!v || v.__dbHookInstalled) return;
          v.__dbHookInstalled = true;
          let realDb;
          Object.defineProperty(v, "db", {
            configurable: true,
            get() { return realDb; },
            set(dbVal) {
              realDb = dbVal;
              if (!dbVal || dbVal.__slowArmed) return;
              dbVal.__slowArmed = true;
              const store = new Map();
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(pfx)) { try { store.set(k.slice(pfx.length), JSON.parse(localStorage.getItem(k))); } catch (e) {} }
              }
              const delay = (ms) => new Promise((r) => setTimeout(r, ms));
              dbVal._installFakeCloud({
                async get(id) { await delay(delayMs); return store.get(id) || null; },
                async set(id, data) { const cur = store.get(id) || {}; store.set(id, { ...cur, ...data }); },
                async del(id) { store.delete(id); },
                async list(kind) {
                  await delay(delayMs);
                  const out = []; for (const [id, d] of store) if (!kind || d.kind === kind) out.push({ id, ...d });
                  return out;
                },
                watch(id, cb) { cb(store.get(id) || null); return () => {}; },
              });
              // LG.backendReady's own catch unconditionally sets backendMode back to "local"
              // once it settles (gstatic/firebase are aborted in every suite page) — reassert
              // "cloud" right after, whichever way it resolved.
              if (realLG.backendReady && realLG.backendReady.then) {
                realLG.backendReady.then(() => { realLG.backendMode = "cloud"; }).catch(() => {});
              }
            },
          });
        },
      });
    }, SLOW_MS, LSPFX);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const u = req.url();
      if (u.startsWith(BASE)) return req.continue();
      return req.abort();
    });
    const t0 = Date.now();
    await page.goto(BASE + "/league.html?fam=" + FAM, { waitUntil: "load" });
    await page.waitForSelector(".mucard", { timeout: 20000 });
    const ms = Date.now() - t0;
    ok(ms < BUDGET_MS, "cold nav-to-league-home-painted under a " + SLOW_MS + "ms/call fake cloud stays under the " + BUDGET_MS + "ms budget (" + ms + "ms — a 12-call serial chain would need " + (12 * SLOW_MS) + "ms+)");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // ---- X: 2025 TEST SEASON MODE (2026-08-08) ----
  section("X · 2025 test season mode — isolation, guided setup, real 2025 stats, exit/reset");
  {
    const seed = fullSeed();
    const { ctx, page, errors } = await newTestPage(browser, seed);
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    // Establish commissioner status once, via the test hook (same idiom section Q already
    // uses) — the prompt() queue's one seeded value ("Peter") is free to be consumed by
    // whichever prompt happens first; gateCommish()'s own first-run branch self-unlocks on
    // ANY value, so what it returns doesn't matter here.
    await page.evaluate(() => window.__GFFL__.LG.gateCommish());
    // Let the real league's own background work (D.initSleeper()'s fetch chain + the
    // snapshotProjections() it kicks off, both started during the initial bootPage() above)
    // fully settle BEFORE snapshotting "before" — otherwise a projsnap doc landing a few
    // milliseconds later (this app's normal, pre-existing behavior, unrelated to test-season
    // mode) reads as a false "test mode touched the real collection" failure. Stopping the
    // poller afterward also guarantees nothing further can write to the real collection in the
    // background while the rest of this section runs.
    await page.evaluate(async () => {
      const G = window.__GFFL__;
      await G.D.slpReady;
      await G.LG.snapshotProjections(G.UI.week).catch(() => {});
      G.D.stop();
    });
    const beforeReal = await snapshotRealDocs(page);
    ok(Object.keys(beforeReal).length > 0, "sanity: the REAL collection actually has docs to protect before entering test mode (" + Object.keys(beforeReal).length + ")");

    await page.evaluate(() => window.__GFFL__.UI.show("rules"));
    await page.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 5000 });
    ok(!!(await page.$("#testEnter")) && !(await page.$("#testExit")),
      "as a commissioner, NOT yet in test mode: the 'Enter 2025 test season' button is present, exit/reset are not");
    ok(await page.evaluate(() => document.getElementById("testBanner").hidden), "the persistent test banner is hidden while in the real league");

    // Arm the richer 2-team 2025 roster fixture, then enter through the REAL button + confirm
    // dialog (stubbed true) — proves the actual UI wiring, not just the underlying LG calls.
    fixture.test2025Rich = true;
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      clickIn(page, "#testEnter"),
    ]);
    // The guided one-tap setup wizard runs automatically (no second tap) — wait for it to
    // finish (it lands on the claim screen once teams + weeks 1-3 exist) rather than polling a
    // fixed sleep, since the whole point is that this can take a real network round trip.
    await page.waitForSelector(".teamrow", { timeout: 15000 });
    const collInTest = await page.evaluate(() => window.__GFFL__.LG.COLL);
    ok(collInTest === "gffl_" + FAM + "_t25", "LG.COLL really did switch to the isolated '_t25' collection (" + collInTest + ")");
    const teamsAfterSetup = await page.evaluate(() => window.__GFFL__.LG.teams.map((t) => t.name));
    ok(teamsAfterSetup.length === 2 && teamsAfterSetup.includes("Battle Kreussers") && teamsAfterSetup.includes("End Zone Goats"),
      "the guided setup imported both real 2025 teams from the ESPN fixture (" + JSON.stringify(teamsAfterSetup) + ")");
    const seasonAfterSetup = await page.evaluate(() => window.__GFFL__.LG.SEASON);
    ok(seasonAfterSetup === 2025, "LG.SEASON reads 2025 inside the sandbox");

    // Claim team 1 (Battle Kreussers) — the SAME identity flow as the real league, just on the
    // test-mode-namespaced localStorage keys.
    await clickIn(page, ".teamrow");
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const weekAfterClaim = await page.evaluate(() => window.__GFFL__.LG.currentWeek());
    ok(weekAfterClaim === 4, "the pinned test clock reads week 4 (" + weekAfterClaim + ")");
    const bannerTxt = await page.evaluate(() => document.getElementById("testBanner").textContent);
    ok(!(await page.evaluate(() => document.getElementById("testBanner").hidden))
      && /2025 TEST SEASON/.test(bannerTxt) && /Week 4/.test(bannerTxt),
      "the persistent banner is now visible and names the sandbox + the current week (" + JSON.stringify(bannerTxt) + ")");
    await page.evaluate(() => window.__GFFL__.UI.show("rules"));
    await page.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 5000 });
    ok(!(await page.$("#testEnter")) && !!(await page.$("#testExit")) && !!(await page.$("#testReset")),
      "Rules now shows Exit/Reset instead of Enter, while inside the sandbox");

    // Weeks 1-3 finalized from REAL archived 2025 stats — hand-checked totals (the fixture's
    // own DEFAULT stat bucket for weeks 1-2, WEEK_STATS_FIX[3] for week 3 — see the comment by
    // ffRosterDoc2025Rich for the full hand computation): team1 (Battle Kreussers) wins all
    // three, 41.0-4.0 / 41.0-4.0 / 20.0-2.0, home/away per LG.generateSchedule's own circle
    // method for 2 teams (week1 flips home/away vs weeks 2-3).
    const wk1 = await page.evaluate(() => window.__GFFL__.LG.loadWeekly(1));
    const wk2 = await page.evaluate(() => window.__GFFL__.LG.loadWeekly(2));
    const wk3 = await page.evaluate(() => window.__GFFL__.LG.loadWeekly(3));
    const wk4 = await page.evaluate(() => window.__GFFL__.LG.loadWeekly(4));
    ok(wk1 && wk1.kind === "weekly" && wk1.source === "archived" && wk1.matchups[0].homePts === 4 && wk1.matchups[0].awayPts === 41,
      "week 1 finalized from real archived 2025 stats: 4.0 — 41.0 (" + JSON.stringify(wk1 && wk1.matchups) + ")");
    ok(wk2 && wk2.matchups[0].homePts === 41 && wk2.matchups[0].awayPts === 4,
      "week 2 finalized: 41.0 — 4.0 (" + JSON.stringify(wk2 && wk2.matchups) + ")");
    ok(wk3 && wk3.matchups[0].homePts === 20 && wk3.matchups[0].awayPts === 2,
      "week 3 finalized (P. Passer's real 300yd/2TD week): 20.0 — 2.0 (" + JSON.stringify(wk3 && wk3.matchups) + ")");
    ok(wk4 == null, "week 4 stays UNFINALIZED — upcoming, before its kickoff, exactly as designed");
    const standings = await page.evaluate(() => window.__GFFL__.LG.loadStandings());
    ok(standings[1].w === 3 && standings[1].l === 0 && standings[1].pf === 102
      && standings[2].w === 0 && standings[2].l === 3 && standings[2].pf === 10,
      "standings are populated correctly from the three finalized weeks (" + JSON.stringify(standings) + ")");

    // ---- moves: FA add (week 4, deadline already passed) + a blind-bid claim (week 5, via
    // the test-mode-only "Testing week" switch) + a trade — all against REAL rosters. ----
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForFunction(() => document.body.textContent.includes("Waivers"), { timeout: 5000 });
    let movesTxt = await page.evaluate(() => document.body.textContent);
    ok(/Free agency is open/.test(movesTxt), "at the pinned clock, week 4's Moves page shows free agency OPEN (its Wednesday deadline already passed)");
    ok(/Testing week/.test(movesTxt) && !!(await page.$('.testWkBtn[data-w="5"]')),
      "the test-mode-only 'Testing week' switch is present, so BOTH the FA and blind-bid-claim flows are reachable from the UI at this one pinned clock");
    await clickIn(page, '.testWkBtn[data-w="5"]');
    await page.waitForFunction(() => document.body.textContent.includes("Claims process"), { timeout: 5000 });
    movesTxt = await page.evaluate(() => document.body.textContent);
    ok(/Claims process Wed/.test(movesTxt), "…switching to week 5 (its own deadline hasn't passed yet) shows the ordinary blind-bid claim form instead of instant FA");
    await clickIn(page, '.testWkBtn[data-w="4"]');
    await page.waitForFunction(() => document.body.textContent.includes("Free agency is open"), { timeout: 5000 });

    // FA add (week 4): F. Agent (slp_9201, an unrostered slpPlayersFix entry) for team1's bench RB.
    const faResult = await page.evaluate(() => window.__GFFL__.LG.faAdd(
      4, 1, { key: "slp_9201", name: "F. Agent", pos: "WR", team: "KC" }, "111333"));
    ok(faResult.ok, "LG.faAdd succeeds against the isolated test collection (" + JSON.stringify(faResult) + ")");
    const rosAfterFa = await page.evaluate(() => window.__GFFL__.LG.loadRoster(4, 1));
    ok(rosAfterFa.some((p) => p.key === "slp_9201") && !rosAfterFa.some((p) => p.key === "111333"),
      "…team1's week-4 roster genuinely gained F. Agent and lost B. Backup, on the real 2025-imported roster");

    // Blind-bid claim (week 5): team2 bids on A. Vail (slp_9202, also unrostered), commissioner
    // processes it — proves the FULL FAAB claim/process/win path, not just addClaim() alone.
    const claimResult = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      await LG.addClaim(5, { id: "tclaim1", teamId: 2, addKey: "slp_9202", addName: "A. Vail", addPos: "K", addTeam: "DEN", dropKey: "111888", dropName: "S. Second", bid: 10, t: Date.now() });
      return LG.processWaivers(5);
    });
    ok(claimResult.processed && (claimResult.results || []).some((r) => r.id === "tclaim1" && r.ok),
      "a blind-bid claim submitted for week 5 processes and wins (" + JSON.stringify(claimResult.results) + ")");
    const rosAfterClaim = await page.evaluate(() => window.__GFFL__.LG.loadRoster(5, 2));
    ok(rosAfterClaim.some((p) => p.key === "slp_9202"), "…team2's week-5 roster gained the won player");

    // Trade: team1 sends R. Rusher for team2's F. Flexman, offer -> accept -> (fast-forward
    // past the 48h review window) -> execute.
    const tradeResult = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      const offer = await LG.offerTrade(1, 2, ["4241457"], ["111444"]);
      await LG.acceptTrade(offer.trade.id, 2);
      LG.nowOverride = LG.now() + 49 * 3600e3; // past the review window, still inside test week 4
      const executed = await LG.executeTrade(offer.trade.id);
      LG.nowOverride = null;
      return executed;
    });
    ok(tradeResult && tradeResult.status === "executed", "a trade between the two test-season teams offers, accepts, and executes (" + (tradeResult && tradeResult.status) + ")");
    const rosT1 = await page.evaluate(() => window.__GFFL__.LG.loadRoster(4, 1));
    const rosT2 = await page.evaluate(() => window.__GFFL__.LG.loadRoster(4, 2));
    ok(rosT1.some((p) => p.key === "111444") && !rosT1.some((p) => p.key === "4241457"), "…team1 gained F. Flexman and gave up R. Rusher");
    ok(rosT2.some((p) => p.key === "4241457") && !rosT2.some((p) => p.key === "111444"), "…team2 gained R. Rusher and gave up F. Flexman");

    // ---- isolation, both directions, after all of the above activity ----
    const midReal = await snapshotRealDocs(page);
    const realIdentical = stableStr(midReal) === stableStr(beforeReal);
    let diffMsg = "";
    if (!realIdentical) {
      const beforeKeys = new Set(Object.keys(beforeReal)), midKeys = new Set(Object.keys(midReal));
      const added = [...midKeys].filter((k) => !beforeKeys.has(k));
      const removed = [...beforeKeys].filter((k) => !midKeys.has(k));
      const changed = [...midKeys].filter((k) => beforeKeys.has(k) && stableStr(midReal[k]) !== stableStr(beforeReal[k]));
      diffMsg = " DIFF added=" + JSON.stringify(added) + " removed=" + JSON.stringify(removed) + " changed=" + JSON.stringify(changed)
        + (changed.length ? " changedDetail=" + JSON.stringify(changed.map((k) => ({ k, before: beforeReal[k], after: midReal[k] }))) : "");
    }
    ok(realIdentical, "the REAL collection is BYTE-IDENTICAL to before test mode was entered — every waiver/claim/trade/finalize above landed only in the '_t25' sandbox" + diffMsg);

    // ---- exit restores the real league exactly ----
    await page.evaluate(() => window.__GFFL__.UI.show("rules")); // moves/claim navigation above left main() elsewhere
    await page.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 5000 });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      clickIn(page, "#testExit"),
    ]);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const afterExit = await page.evaluate(() => ({
      coll: window.__GFFL__.LG.COLL, season: window.__GFFL__.LG.SEASON,
      myTeam: window.__GFFL__.LG.myTeamId(), testMode: window.__GFFL__.LG.testMode(),
      bannerHidden: document.getElementById("testBanner").hidden,
    }));
    ok(!afterExit.testMode && afterExit.coll === "gffl_" + FAM && afterExit.season === 2026 && afterExit.myTeam === 1,
      "exiting restores the real collection/season and the ORIGINAL claimed team, exactly as before (" + JSON.stringify(afterExit) + ")");
    ok(afterExit.bannerHidden, "the test banner is hidden again back in the real league");
    const afterExitReal = await snapshotRealDocs(page);
    ok(stableStr(afterExitReal) === stableStr(beforeReal), "…and the real collection is STILL byte-identical after the exit round-trip itself");

    // ---- reset wipes ONLY the test collection (direct hook — race-free: a real reload
    // immediately re-triggers the guided setup, which starts writing again on its own clock,
    // so this is the one honest place to catch the collection actually empty) ----
    await page.evaluate(() => window.__GFFL__.LG.enterTestMode()); // back in, no reload needed for this check
    const beforeReset = await snapshotTestDocs(page);
    ok(Object.keys(beforeReset).length > 0, "sanity: the test collection still holds its setup + moves docs before reset (" + Object.keys(beforeReset).length + ")");
    const resetResult = await page.evaluate(() => window.__GFFL__.LG.resetTestMode());
    ok(resetResult.ok && resetResult.wiped === Object.keys(beforeReset).length, "LG.resetTestMode() wipes every test-collection doc (" + JSON.stringify(resetResult) + ")");
    const afterResetTest = await snapshotTestDocs(page);
    ok(Object.keys(afterResetTest).length === 0, "…the test collection is now genuinely empty");
    const afterResetReal = await snapshotRealDocs(page);
    ok(stableStr(afterResetReal) === stableStr(beforeReal), "…and resetting the SANDBOX never touched a single real-collection doc");

    // A real reload from this wiped-but-still-in-test-mode state re-triggers the guided setup
    // automatically — the resumable/idempotent path, exercised from a real boot rather than a
    // direct function call.
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.body.textContent.includes("Setting up the 2025 test season"), { timeout: 9000 });
    ok(true, "a reload against a wiped-but-still-in-test-mode collection re-shows the guided setup screen on its own, with no user action needed");

    ok(errors.length === 0, "0 page errors through the entire test-season flow (enter, setup, moves, isolation, exit, reset, resume)");
    await ctx.close();
    fixture.test2025Rich = false; // reset for any suite section that might run after this one
  }

  await browser.close();
  srv.close(); ffSrv.close(); tenorSrv.close(); xaiSrv.close(); sportsFfSrv.close();
  console.log("\n================================");
  console.log(`PASS ${pass} · FAIL ${fail}`);
  if (fail) { console.log("Failures:"); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
})().catch((e) => { console.error("SUITE CRASH:", e); process.exit(1); });
