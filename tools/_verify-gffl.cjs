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
// RESTAGED 2026-08-08 (the 2025 season replay): LG.SIM_2025 now ships ON by default, which
// moves LG.SEASON to 2025 and pins the clock to week 1 of that season. Every section A-Z below
// was written against the REAL 2026 league (its seeds are roster_2026_*/sched_2026, its
// hand-computed expectations are 2026's), so they all boot with the documented ?sim=0 QA
// override — the same posture ?fam= already has. Section X (the new one) is the only section
// that boots WITHOUT it, i.e. as the family's own devices will.
const SIMOFF = "&sim=0";
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
  // Section X (the 2025 season replay) — OFF by default, so section Q's own
  // lg_espn_rosters_season(2025) fixture (1 team, 2 players) is completely untouched. When
  // true, the season-2025 mRoster retry branch serves ffRosterDoc2025Rich() (2 teams, enough
  // real 2025-labeled players to fill starters + a trade partner) instead of ffRosterDoc().
  rich2025: false,
  // Section X: does Sleeper still hold a REAL forward projection for 2025 week 1? Default
  // false = the expected reality (a season that far gone keeps none), which is what forces
  // D.simEnsureProj's derive-from-real-final-stats fallback — the shipped default path.
  simProjReal: false,
  simProjAdpOnly: false, // the live-probe ADP-husk trap (2026-08-08)
  // Coordinator addendum (2026-08-08) — the Scores tab's ff_scoreboard fixture (fake sports.mjs
  // fantasy upstream). Default false = the existing scored 2-matchup fixture; true = an
  // all-zero preseason/pre-draft shape (see ffScoreboardFix's own comment).
  ffAllZero: false,
  // Section AD (2026-08-09 playtest batch). All default OFF, so every pre-existing section
  // sees exactly the fixture it always did.
  injMix: false,   // a spread of injury designations in the Sleeper directory (item 11)
  manyFa: false,   // 60 extra free agents, so the FA table's own 40-row limit is really hit
                   // and "Show more ↓" actually renders (item 12)
  // Section AC (2026-08-09, the "everything reads 0 / NaN" production bug). When true the
  // Sleeper directory, the archived week-1 stats, the forward projections and the historical
  // slate are all swapped for PRODUCTION-SHAPED ones: real player names, roster keys that are
  // real ESPN ids, and — the thing the whole bug turns on — a directory in which only a
  // MINORITY of players carry an espn_id (measured live: 6,727 of 12,217). Default false, so
  // every other section sees exactly the fixture it always did.
  prod2025: false,
};

// ---------------- section AC: production-shaped identity data (2026-08-09) ----------------
// Straight from GitHub diag run 31287998467 against the family's own league. The names are kept
// verbatim so the next person reading this section sees what the bug was about.
//   · roster_2025_w1_t1 keys its players by ESPN id ("4430807" = Bijan Robinson)
//   · of the first 12, only FOUR resolved through Sleeper's espn_id index — 8 were invisible to
//     both the stats poll and the projections, which is why the family saw a column of 0.0
// `espnInSlp:false` is a player Sleeper genuinely carries NO espn_id for (rookies, mostly).
// Two deliberate spelling traps, both real-world: the roster spells Achane without the
// apostrophe ESPN and Sleeper both use, and Sleeper drops the "Jr." the roster carries — the
// name match has to normalise both away or those two stay dark.
const PROD_PLAYERS = [
  { espn: "4430807", pid: "8155", name: "Bijan Robinson", team: "ATL", pos: "RB", espnInSlp: false },
  { espn: "4429160", pid: "9226", name: "De'Von Achane", rosterName: "DeVon Achane", team: "MIA", pos: "RB", espnInSlp: false },
  { espn: "4239993", pid: "6801", name: "Tee Higgins", team: "CIN", pos: "WR", espnInSlp: true },
  { espn: "4432708", pid: "9493", name: "Marvin Harrison", rosterName: "Marvin Harrison Jr.", team: "ARI", pos: "WR", espnInSlp: false },
  { espn: "3121422", pid: "5927", name: "Terry McLaurin", team: "WAS", pos: "WR", espnInSlp: true },
  { espn: "4259545", pid: "6790", name: "D'Andre Swift", team: "CHI", pos: "RB", espnInSlp: true },
  { espn: "4241478", pid: "7526", name: "DeVonta Smith", team: "PHI", pos: "WR", espnInSlp: false },
  { espn: "15847", pid: "1466", name: "Travis Kelce", team: "KC", pos: "TE", espnInSlp: true },
  { espn: "4428331", pid: "9224", name: "Rashee Rice", team: "KC", pos: "WR", espnInSlp: false },
  { espn: "4429205", pid: "9500", name: "Jordan Addison", team: "MIN", pos: "WR", espnInSlp: false },
  { espn: "4426385", pid: "9756", name: "Zach Charbonnet", team: "SEA", pos: "RB", espnInSlp: false },
  { espn: "4575131", pid: "12507", name: "Jacory Croskey-Merritt", team: "WAS", pos: "RB", espnInSlp: false },
  { espn: "3139477", pid: "4034", name: "Patrick Mahomes", team: "KC", pos: "QB", espnInSlp: true },
  { espn: "4362628", pid: "7839", name: "Chase McLaughlin", team: "TB", pos: "K", espnInSlp: false },
];
// The one roster row that genuinely CANNOT be resolved by any method — no espn_id, and a name
// and NFL team the directory has never heard of. It must render "—", not a fabricated 0.0 and
// certainly not NaN.
const PROD_GHOST = { key: "9999999", name: "Ghost Player", team: "NYJ", pos: "WR" };
const PROD_TEAMS = ["ATL", "MIA", "CIN", "ARI", "WAS", "CHI", "PHI", "KC", "MIN", "SEA", "TB", "DAL"];
function prodSlpDirectory() {
  const out = {};
  for (const p of PROD_PLAYERS) {
    const [first, ...rest] = p.name.split(" ");
    out[p.pid] = { full_name: p.name, first_name: first, last_name: rest.join(" "), team: p.team, position: p.pos };
    if (p.espnInSlp) out[p.pid].espn_id = Number(p.espn);
  }
  for (const ab of PROD_TEAMS) out[ab] = { first_name: ab, last_name: "Defense", team: ab, position: "DEF" };
  // Bulk, so the directory is a real haystack (and so simProjUsable's >=25-stat-row bar is
  // reachable from the projections map below).
  for (let i = 0; i < 60; i++) out["pf" + i] = { full_name: "Filler " + i, team: "DAL", position: "WR" };
  return out;
}
// Real archived rows carry a pile of NON-FANTASY fields alongside the scoring ones (gp, gs,
// off_snp, rec_drop, pos_rank_std, bonus_* …) — exactly as the diag captured them.
const PROD_NOISE = { gms_active: 1, gp: 1, gs: 1, off_snp: 41, tm_off_snp: 63, rec_drop: 1, pos_rank_std: 30, rush_lng: 13, rec_0_4: 2 };
// Hand-computable through DEFAULT_RULES scoring (pass .04/4/-2 · rush .1/6 · rec 1/.1/6):
//   Bijan Robinson  84 rush + 1 rush TD + 4 rec + 33 rec yd = 8.4 + 6 + 4 + 3.3 = 21.7
//   Chase McLaughlin  80 FG yds (fg_made_yd is 0 by default) + 1 FG 20-29 (3) + 1 FG 50+ (5)
//                     + 2 XP (1 each) = 3 + 5 + 2 = 10.0
const PROD_WEEK1 = {
  "8155": { ...PROD_NOISE, rush_yd: 84, rush_td: 1, rec: 4, rec_yd: 33, pts_ppr: 21.7 },
  "9226": { ...PROD_NOISE, rush_yd: 55, rec: 6, rec_yd: 40 },
  "6801": { ...PROD_NOISE, bonus_fd_wr: 2, bonus_rec_wr: 3, rec: 6, rec_yd: 78, rec_td: 1 },
  "9493": { ...PROD_NOISE, rec: 5, rec_yd: 71 },
  "5927": { ...PROD_NOISE, rec: 4, rec_yd: 52 },
  "6790": { ...PROD_NOISE, rush_yd: 62, rec: 3, rec_yd: 21 },
  "7526": { ...PROD_NOISE, rec: 7, rec_yd: 96, rec_td: 1 },
  "1466": { ...PROD_NOISE, rec: 8, rec_yd: 84 },
  "9224": { ...PROD_NOISE, rec: 5, rec_yd: 60 },
  "9500": { ...PROD_NOISE, rec: 3, rec_yd: 44 },
  "9756": { ...PROD_NOISE, rush_yd: 30 },
  "12507": { ...PROD_NOISE, rush_yd: 82, rush_td: 1 },
  "4034": { ...PROD_NOISE, pass_yd: 291, pass_td: 3, pass_int: 1 },
  "7839": { ...PROD_NOISE, fgm_yds: 80, xpm: 2, fgm_20_29: 1, fgm_50p: 1 },
  KC: { ...PROD_NOISE, pts_allow: 21, sack: 3, int: 1 },
  DAL: { ...PROD_NOISE, pts_allow: 7, sack: 4, int: 2 },
};
// Real forward projections DO exist for 2025 week 1 (the diag counted 9,411 rows), and they
// carry their own non-fantasy noise (adp_dd_ppr, fum 0.07 …). Bijan's projection is a
// DIFFERENT number from his final so the two can never be confused in an assertion.
//   Bijan proj: 70 rush + 0.5 rush TD + 3 rec + 25 rec yd = 7 + 3 + 3 + 2.5 = 15.5
const PROD_PROJ = (() => {
  // Real projection noise, minus fum_lost — that one IS a scoring key (normSlp reads it), and
  // a fractional 0.03 in every row would put a rounding tail on every hand-computed number
  // below for no extra coverage. The rest genuinely are not read by the scorer.
  const noise = { adp_dd_ppr: 40, fum: 0.07, gp: 1, pos_rank_std: 30, tm_def_snp: 56 };
  const out = {
    "8155": { ...noise, rush_yd: 70, rush_td: 0.5, rec: 3, rec_yd: 25 },
    "9226": { ...noise, rush_yd: 60, rec: 4, rec_yd: 30 },
    "6801": { ...noise, rec: 6, rec_yd: 70, rec_td: 0.5 },
    "9493": { ...noise, rec: 5, rec_yd: 60 },
    "5927": { ...noise, rec: 5, rec_yd: 55 },
    "6790": { ...noise, rush_yd: 55, rec: 3, rec_yd: 20 },
    "7526": { ...noise, rec: 6, rec_yd: 75 },
    "1466": { ...noise, rec: 6, rec_yd: 65 },
    "9224": { ...noise, rec: 5, rec_yd: 55 },
    "9500": { ...noise, rec: 4, rec_yd: 50 },
    "9756": { ...noise, rush_yd: 40 },
    "12507": { ...noise, rush_yd: 45 },
    "4034": { ...noise, pass_yd: 280, pass_td: 2 },
    "7839": { ...noise, fgm_yds: 70, xpm: 2 },
    KC: { ...noise, pts_allow: 20, sack: 2 },
    DAL: { ...noise, pts_allow: 18, sack: 2 },
  };
  for (let i = 0; i < 40; i++) out["pf" + i] = { ...noise, rec_yd: 20 + i, rec: 2 };
  return out;
})();
// The live phase instant is Sunday 2025-09-07T19:00:00Z. Thursday's game is FINAL (so a
// hand-computed final score is exact and scale-free), the 17:00Z window is LIVE, the 20:25Z
// window has not kicked off.
function prodSlate() {
  const mk = (id, away, home, date, af, hf) => ({
    id, date, competitions: [{
      competitors: [
        { homeAway: "away", team: { abbreviation: away, shortDisplayName: away }, score: String(af) },
        { homeAway: "home", team: { abbreviation: home, shortDisplayName: home }, score: String(hf) },
      ],
      status: { type: { state: "post", shortDetail: "Final" }, period: 4 },
      broadcasts: [{ names: ["NBC"] }],
    }],
  });
  return { week: { number: 1 }, events: [
    mk("p1", "ATL", "TB", "2025-09-05T00:20:00Z", 20, 23),   // FINAL at the live instant
    mk("p2", "CIN", "CLE", "2025-09-07T17:00:00Z", 17, 16),  // LIVE
    mk("p3", "ARI", "NO", "2025-09-07T17:00:00Z", 20, 13),   // LIVE
    mk("p4", "MIA", "IND", "2025-09-07T17:00:00Z", 8, 33),   // LIVE
    mk("p5", "WAS", "NYG", "2025-09-07T17:00:00Z", 21, 6),   // LIVE
    mk("p6", "PHI", "DAL", "2025-09-07T17:00:00Z", 24, 20),  // LIVE
    mk("p7", "KC", "LAC", "2025-09-07T20:25:00Z", 21, 27),   // not yet kicked off
    mk("p8", "CHI", "MIN", "2025-09-08T00:20:00Z", 24, 27),  // not yet kicked off
    mk("p9", "SEA", "SF", "2025-09-07T20:25:00Z", 17, 13),   // not yet kicked off
  ] };
}
// Two teams, rosters keyed by ESPN id exactly as the family's own docs are.
function prodSeedDocs() {
  const byName = {};
  for (const p of PROD_PLAYERS) byName[p.name] = p;
  const row = (name, slot, posOverride) => {
    const p = byName[name];
    return { key: p.espn, name: p.rosterName || p.name, pos: posOverride || p.pos, team: p.team, slot };
  };
  const docs = {
    team_1: { kind: "team", teamId: 1, name: "Battle Kreussers", abbrev: "BK", owner: "" },
    team_2: { kind: "team", teamId: 2, name: "End Zone Goats", abbrev: "EZG", owner: "" },
    sched_2025: { kind: "sched", season: 2025, weeks: [[[1, 2]]] },
    roster_2025_w1_t1: { kind: "roster", week: 1, teamId: 1, players: [
      row("Patrick Mahomes", "QB"),
      row("Bijan Robinson", "RB"),          // no espn_id — FINAL game, exact 21.7
      row("De'Von Achane", "RB"),           // no espn_id + an apostrophe spelling difference
      row("Tee Higgins", "WR"),             // HAS an espn_id — the control
      row("Marvin Harrison", "WR"),         // no espn_id + a "Jr." suffix difference
      row("Travis Kelce", "TE"),
      row("Terry McLaurin", "FLEX"),
      row("Chase McLaughlin", "K"),         // no espn_id — FINAL game, exact 10.0
      { key: "dst_KC", name: "KC D/ST", pos: "DST", team: "KC", slot: "DST" },
      { ...PROD_GHOST, slot: "BENCH" },     // resolves to nobody, by any method
      row("D'Andre Swift", "BENCH"),
    ] },
    roster_2025_w1_t2: { kind: "roster", week: 1, teamId: 2, players: [
      row("DeVonta Smith", "WR"),
      row("Rashee Rice", "WR"),
      row("Jordan Addison", "FLEX"),
      row("Zach Charbonnet", "RB"),
      row("Jacory Croskey-Merritt", "RB"),
      { key: "dst_DAL", name: "DAL D/ST", pos: "DST", team: "DAL", slot: "DST" },
    ] },
  };
  return docs;
}

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
// only when fixture.rich2025 is true (never touches section Q's own 1-team fixture above).
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
      if (seasonRosterM && Number(seasonRosterM[1]) === 2025 && fixture.rich2025) {
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
  // fixture.ffAllZero (coordinator addendum, 2026-08-08): a preseason/pre-draft shape — every
  // team's record is 0-0 and every matchup's live points are 0.0 — proving the ESPN card hides
  // itself rather than rendering a "0-0/0.0 everywhere" screen with no real signal.
  if (fixture.ffAllZero) {
    return {
      settings: { name: "Nerd Fantasy Football League" },
      status: { currentMatchupPeriod: 1 },
      members: [],
      teams: [
        { id: 1, name: "Battle Kreussers", abbrev: "BK", record: { overall: { wins: 0, losses: 0 } } },
        { id: 2, name: "End Zone Goats", abbrev: "EZG", record: { overall: { wins: 0, losses: 0 } } },
      ],
      schedule: [
        { id: 101, matchupPeriodId: 1,
          home: { teamId: 1, totalPointsLive: 0, totalProjectedPointsLive: 0 },
          away: { teamId: 2, totalPointsLive: 0, totalProjectedPointsLive: 0 }, winner: "" },
      ],
    };
  }
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
// Item 4's crest URLs. DEN is absent on purpose (see mk() below).
const NFL_LOGO = {
  PHI: "https://a.espncdn.com/i/teamlogos/nfl/500/phi.png",
  DAL: "https://a.espncdn.com/i/teamlogos/nfl/500/dal.png",
  KC: "https://a.espncdn.com/i/teamlogos/nfl/500/kc.png",
  SF: "https://a.espncdn.com/i/teamlogos/nfl/500/sf.png",
  SEA: "https://a.espncdn.com/i/teamlogos/nfl/500/sea.png",
};
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
      // Item 4 (2026-08-09): ESPN's own competitor.team.logo. DEN deliberately has NONE, so
      // the "a game whose crest is missing still renders cleanly" case is a real one in the
      // fixture rather than a hypothetical.
      competitors: [
        { homeAway: "home", team: { abbreviation: homeAb, logo: NFL_LOGO[homeAb] || "" }, score: extra.hs },
        { homeAway: "away", team: { abbreviation: awayAb, logo: NFL_LOGO[awayAb] || "" }, score: extra.as },
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
// -- the 2025 SEASON REPLAY's historical slate (2026-08-08). The replay asks ESPN's own public
// scoreboard for an EXPLICIT slate — dates=<season>&seasontype=2&week=1 — rather than the bare
// "current week" endpoint sbFix() above answers. Every URL that carries `dates=` is recorded in
// simSbUrls so section X can assert the params rather than trust them.
// The teams are chosen to overlap the roster fixtures (PHI/DAL/KC/DEN) so the MINE/OPP starter
// counts and D.oppForWeek have something real to resolve, and the kickoffs deliberately span
// THREE different days so the Scores tab's day grouping is genuinely exercised. Every
// competitor carries a real FINAL score in the document — exactly what history looks like —
// which is what makes "the replay presents them all as 0-0 upcoming" a real assertion rather
// than a tautology.
const simSbUrls = [];
function sbSim2025Fix() {
  const ev = (id, away, home, date, net, extra) => ({
    id, shortName: away + " @ " + home, date,
    competitions: [{
      status: { type: { state: "post", shortDetail: "Final" }, period: 4, displayClock: "0:00" },
      broadcasts: net ? [{ names: [net] }] : [],
      odds: (extra && extra.spread) ? [{ details: extra.spread }] : [],
      competitors: [
        { homeAway: "home", team: { abbreviation: home, logo: "https://a.espncdn.com/i/teamlogos/nfl/500/" + home.toLowerCase() + ".png" }, score: (extra && extra.hs) || "20" },
        { homeAway: "away", team: { abbreviation: away, logo: "https://a.espncdn.com/i/teamlogos/nfl/500/" + away.toLowerCase() + ".png" }, score: (extra && extra.as) || "17" },
      ],
    }],
  });
  // RESTAGED 2026-08-08 (the live replay phase). The kickoffs are what the whole feature derives
  // game state from, so this slate is shaped to put the four NFL teams the roster fixture
  // actually uses (PHI/DAL via the Thursday opener, KC early Sunday, DEN late Sunday) into
  // THREE DIFFERENT STATES at the `live` instant (2025-09-07T19:00Z) — final, in progress, and
  // not yet kicked off — which is exactly the mix the phase exists to show:
  //   DAL@PHI  Thu 00:20Z  -> FINAL         (P. Passer, R. Rusher, W. Receiver, K. Kicker, both D/STs, X. Wideout, Q. Rival)
  //   NYG@WSH  Sun 17:00Z  -> Q3 7:40 LIVE  (no rostered players — it is the second live game, and its clock…)
  //   KC@LAC   Sun 17:15Z  -> Q3 12:54 LIVE (…differs from NYG@WSH's by exactly its 15-minute kickoff stagger:
  //                                          T. Tight, B. Backup, I. Injured)
  //   DEN@TEN  Sun 20:25Z  -> PRE           (F. Flexman, W. Two, H. Healthy, S. Second)
  //   BAL@BUF  Sun 00:20Z  -> PRE           (Sunday night)
  //   MIN@CHI  Mon 00:15Z  -> PRE           (Monday night — the REAL 2025 week-1 finale, which is
  //                                          also what lg-core's clamp constant is anchored to)
  // KC@LAC really was a Friday game in São Paulo; it is moved into the Sunday early window here
  // on purpose, so the viewer's OWN team has a player mid-game rather than a board of finals.
  return {
    week: { number: 1 },
    events: [
      ev("401772510", "DAL", "PHI", "2025-09-05T00:20Z", "NBC", { spread: "PHI -8.5", hs: "24", as: "20" }),
      ev("401772832", "NYG", "WSH", "2025-09-07T17:00Z", "FOX", { hs: "21", as: "6" }),
      ev("401772728", "KC", "LAC", "2025-09-07T17:15Z", "CBS", { hs: "21", as: "27" }),
      ev("401772831", "DEN", "TEN", "2025-09-07T20:25Z", "FOX", { hs: "12", as: "20" }),
      ev("401772833", "BAL", "BUF", "2025-09-08T00:20Z", "NBC", { hs: "41", as: "40" }),
      ev("401772834", "MIN", "CHI", "2025-09-09T00:15Z", "ESPN", { hs: "24", as: "27" }),
    ],
  };
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
// Item 11 (2026-08-09): a spread of REAL upstream designations, layered over the base
// directory only when fixture.injMix is on. P. Passer is deliberately "Active" — the whole
// point of the change is that a healthy player renders nothing at all — and "PUP" is the
// unanticipated-but-real case that must still show something. (I. Injured already carries
// "Out" in the base fixture, so OUT is covered without a flag.)
// Item 12: manyFa pads the directory with 60 more genuinely unrostered free agents so the
// players table's own 40-row limit is really hit and "Show more ↓" renders.
function slpDirectoryFix() {
  let dir = slpPlayersFix;
  if (fixture.injMix) {
    dir = { ...dir,
      "6904": { ...dir["6904"], injury_status: "Active" },
      "4866": { ...dir["4866"], injury_status: "Questionable" },
      "9007": { ...dir["9007"], injury_status: "Doubtful" },
      "9002": { ...dir["9002"], injury_status: "PUP" },
      "9201": { ...dir["9201"], injury_status: "Questionable" },
    };
  }
  if (fixture.manyFa) {
    dir = { ...dir };
    const pos = ["WR", "RB", "TE", "QB", "K"];
    for (let i = 0; i < 60; i++) {
      dir["95" + (100 + i)] = { full_name: "Filler " + String.fromCharCode(65 + (i % 26)) + i, team: "KC", position: pos[i % 5], search_rank: 500 + i };
    }
  }
  return dir;
}
// Section V (adversarial review 2026-08-08) needs Sleeper's stats endpoint to answer
// DIFFERENTLY per week — the whole point of findings 1/3/7 is that week N and week N+1 hold
// different numbers, and the pre-fix suite could not tell them apart because every week
// returned the same fixture. Week 1 is byte-identical to what it always was, so every
// hand-computed expectation in sections C-U is untouched.
//   week 3: P. Passer (team1's QB) 300yd 2TD = 12 + 8 = 20.0 · Q. Rival (team2's QB) 50yd = 2.0
//   week 4: P. Passer 25yd = 1.0             · Q. Rival 400yd 3TD = 16 + 12 = 28.0
// i.e. team1 wins week 3 and team2 wins week 4 — the exact "opposite result" shape the
// finding's own repro uses to prove a week was scored from the wrong week's board.
// Week 4's "9001"/"9201" entries arrived with the (since-removed) sandbox clock phases and are
// KEPT deliberately: section V's own checks are week-3-only-roster ones (neither player is a
// week-3 starter there), so they were inert for every pre-existing assertion then and remain so
// now — confirmed by grep, nothing outside those phase tests ever read them. Removing fixture
// data that nothing depends on buys nothing and risks a silent behaviour change.
const WEEK_STATS_FIX = {
  3: { "6904": { pass_yd: 300, pass_td: 2 }, "9101": { pass_yd: 50 } },
  4: { "6904": { pass_yd: 25 }, "9101": { pass_yd: 400, pass_td: 3 },
       "9001": { rec: 4, rec_yd: 50 }, "9201": { rec: 3, rec_yd: 30 } },
};
// 2025 SEASON REPLAY projections (2026-08-08). Sleeper is expected to serve NOTHING from its
// forward-projections endpoint for a season already gone, which is precisely why D.simEnsureProj
// falls back to that week's own real archived FINAL stats. Both paths are exercised:
//   · fixture.simProjReal FALSE (the default, and the expected reality) -> {} here, so the
//     fallback fires and P. Passer's projection is DERIVED from slpStatsFix's own week-1 line:
//     150 pass yd (·0.04) + 1 TD (4) - 1 INT (2) + 1 2pt (2) = 10.0.
//   · fixture.simProjReal TRUE -> a genuine forward projection, deliberately a DIFFERENT number
//     so the two paths can never be confused: P. Passer 250 yd / 2 TD = 10 + 8 = 18.0.
// The map carries the ONE hand-checked row plus 30 synthetic stat-bearing filler rows whose ids
// match no roster key: simProjUsable (2026-08-08 live-probe hardening) requires ≥25 rows with
// REAL stat fields before it trusts an archived projections map — the live 2025 archive answers
// 200 with 9,409 rows of which some carry ONLY ADP fields, and a one-row fixture would now
// (correctly) be rejected as an ADP-husk-sized map.
const SIM_PROJ_FIX = { 1: Object.fromEntries([["6904", { pass_yd: 250, pass_td: 2 }]]
  .concat(Array.from({ length: 30 }, (_, i) => ["fill" + i, { rush_yd: 20 + i }]))) };
// The trap the hardening exists for: a big map where every row is ADP-only (what Sleeper's
// archived projections bucket can degrade to) must be treated as ABSENT, not as zeros.
const SIM_PROJ_ADP_ONLY = Object.fromEntries(Array.from({ length: 200 }, (_, i) => ["adp" + i, { adp_dd_ppr: 100 + i }]));
function slpSimProjFix(season, week) {
  if (String(season) !== "2025") return null; // not a replay request — the generic slpProjFix serves it
  if (fixture.simProjAdpOnly) return SIM_PROJ_ADP_ONLY;
  if (!fixture.simProjReal) return {};        // the shipped default: nothing retained -> fallback
  return SIM_PROJ_FIX[Number(week)] || {};
}
// Section X (the 2025 replay) needs at least one genuinely UNROSTERED player to carry a real
// week-1 line, so the Moves table's PROJ column has something to derive from. Added as a
// SEASON-2025-ONLY overlay rather than to the shared default below: every other section runs
// against season 2026, so this is provably inert for all of them (F. Agent picking up live
// points/season totals there would move section I2's own sorting expectations).
//   F. Agent  3 rec / 30 yd -> 3·1 + 30·0.1 = 6.0  (the hand-checked one)
// The rest exist so the REVIEW PLATES are representative: in production Sleeper's real week-1
// box covers essentially everyone who played, so most rostered players get a projection. With
// only F. Agent here the away half of the matchup plate read "proj 0.0" down the whole column,
// which looks like a broken app rather than a fixture with two lines in it. None of these is
// hand-asserted anywhere; they only move totals nothing checks.
const SIM_WEEK1_EXTRA = {
  "9201": { rec: 3, rec_yd: 30 },
  "9101": { pass_yd: 275, pass_td: 2, pass_int: 1 },   // Q. Rival
  "9102": { rec: 5, rec_yd: 71 },                      // X. Wideout
  "9003": { rush_yd: 66, rush_td: 1 },                 // F. Flexman
  "9004": { rec: 4, rec_yd: 40 },                      // W. Two
  "9006": { rec: 2, rec_yd: 18 },                      // H. Healthy
  "9007": { rush_yd: 31 },                             // S. Second
  "9001": { rec: 6, rec_yd: 62, rec_td: 1 },           // T. Tight
  "9002": { rush_yd: 22 },                             // B. Backup
};
function slpStatsFix(week, season) {
  const w = Number(week);
  if (WEEK_STATS_FIX[w]) return WEEK_STATS_FIX[w];
  if (fixture.emptyWeekBucket && w === fixture.emptyWeekBucket) return {};
  const extra = (String(season) === "2025" && w === 1) ? SIM_WEEK1_EXTRA : null;
  return { ...(extra || {}),
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

// ---------------- section AD fixtures (2026-08-09 playtest batch) ----------------
// Item 8's check needs REALISTIC name lengths. The base fixture's players are all "P. Passer"
// shaped, and a check written against those would pass whether or not the name column is wide
// enough — the pre-fix column was 94px, which "P. Passer QB · PHI" happens to survive by
// wrapping. These are real NFL names of real length (rendered short-form by LG.shortName, so
// "Christian McCaffrey" reaches the row as "C. McCaffrey"); keys/pos/team/slots are UNCHANGED
// from seedRosterT1 so everything else on the page still resolves exactly as it did.
const LONG_NAMES = {
  "3915511": "Marvin Harrison Jr.", "4241457": "Amon-Ra St. Brown", "111888": "Christian McCaffrey",
  "4361741": "Jaxon Smith-Njigba", "111555": "Bijan Robinson", "111222": "Trey McBride",
  "111444": "Kenneth Walker III", "2473037": "Chase McLaughlin", "111333": "Ladd McConkey",
  "111666": "Rome Odunze", "111777": "Puka Nacua",
};
// Item 11's designations, as an ESPN import would really write them onto the roster doc.
// "Active" on the QB is the point of the whole change (a healthy player must render NOTHING);
// PUP is the unanticipated-but-real status that must still show something. I. Injured already
// carries "Out" in the base fixture.
const AD_INJ = {
  "3915511": "Active",       // M. Harrison Jr.  -> no chip at all
  "4241457": "Questionable",  // A. St. Brown     -> Q
  "111888": "Doubtful",       // C. McCaffrey     -> D
  "111333": "PUP",            // L. McConkey      -> PUP
};
function seedLongNames() {
  const base = fullSeed();
  const r1 = seedRosterT1();
  return { ...base, docs: { ...base.docs,
    roster_2026_w1_t1: { ...r1, players: r1.players.map((p) => ({
      ...p,
      ...(LONG_NAMES[p.key] ? { name: LONG_NAMES[p.key] } : {}),
      ...(AD_INJ[p.key] ? { injury: AD_INJ[p.key] } : {}),
    })) },
  } };
}
// Item 13's populated state: one waiver claim of mine, one trade offered TO me (so Accept /
// Decline both render), and one trade between two OTHER teams sitting in the league-veto
// window (so a Veto button renders too). reviewEndsAt is a week out, so runAutoChecks can
// never execute it out from under the measurement.
function seedPending() {
  const base = fullSeed();
  const future = Date.now() + 7 * 86400000;
  return { ...base, docs: { ...base.docs,
    claim_2026_w1_adc1: { kind: "claim", season: 2026, week: 1, claimId: "adc1", teamId: 1,
      addKey: "9201", addName: "F. Agent", addPos: "WR", addTeam: "KC",
      dropKey: "111333", dropName: "B. Backup", bid: 25, t: 1 },
    trade_ad_a: { kind: "trade", id: "trade_ad_a", from: 2, to: 1, give: ["222333"], get: ["3915511"],
      note: "", status: "offered", t: 1, acceptedAt: null, reviewEndsAt: null, vetoes: [] },
    trade_ad_b: { kind: "trade", id: "trade_ad_b", from: 3, to: 4, give: [], get: [],
      note: "", status: "accepted", t: 2, acceptedAt: 2, reviewEndsAt: future, vetoes: [] },
  } };
}

// ---------------- section AF fixtures (2026-08-09, the per-device clock) ----------------
// A 2025-REPLAY-ready store. Section AF has to run with the replay ON at its real speed (every
// other section boots ?sim=0, where LG.now() IS Date.now() and the bug cannot exist), and it
// must not spend its time in the guided auto-setup — simNeedsSetup() demands a schedule AND a
// week-1 roster for EVERY team, so all eight get one. t3-t8 carry a single player each: enough
// to be non-empty, which is all that check asks.
function seedSim2025(extra) {
  const docs = { ...seedTeams() };
  docs["sched_2025"] = { kind: "sched", season: 2025, weeks: [[[1, 2], [3, 4], [5, 6], [7, 8]]] };
  docs["roster_2025_w1_t1"] = { ...seedRosterT1(), teamId: 1 };
  docs["roster_2025_w1_t2"] = { ...seedRosterT2(), teamId: 2 };
  for (let i = 3; i <= 8; i++) {
    docs["roster_2025_w1_t" + i] = { kind: "roster", week: 1, teamId: i,
      players: [{ key: "9" + i + "0001", name: "Filler " + i, pos: "QB", team: "KC", slot: "QB" }] };
  }
  return { docs: { ...docs, ...(extra || {}) }, pass: "amenfarms", team: 1, who: "Peter" };
}
// Deliberately NOT bootPage(): that appends SIMOFF. This boots the replay at its default 8x.
async function bootSim(page) {
  await page.goto(BASE + "/league.html?fam=" + FAM, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__GFFL__ && window.__GFFL__.LG.rules, { timeout: 15000 });
  await page.waitForSelector(".mucard", { timeout: 25000 });
}

// ---------------- section AE chat fixtures (2026-08-09) ----------------
// n user messages in one thread, oldest first, plus (optionally) a sys post and a user message
// that REPLIES to it. Chat doc IDS are the message ids — lg-core stores no id inside the doc
// and list() attaches it from the key — so replyTo has to name the KEY, not an invented id.
// The bubbles are deliberately one short line each: item 14 is about how a SHORT conversation
// sits in a TALL box, and a wall of text would fill the pane and hide the very thing under test.
function seedChat(n, opts) {
  opts = opts || {};
  const base = fullSeed();
  const docs = { ...base.docs };
  const thread = opts.thread || null;
  for (let i = 0; i < n; i++) {
    docs["chat_u" + i] = { kind: "chat", teamId: 1, who: "Peter", text: "message number " + i, t: 1000 + i, thread, reactions: {} };
  }
  if (opts.sys) docs.chat_sys1 = { kind: "chat", who: "GFFL", sys: true, text: "League rules updated by Peter (1): scoring.rec 0.5 -> 1", t: 1000 + n, thread };
  if (opts.replyToSys) {
    docs.chat_reply = { kind: "chat", teamId: 2, who: "Sam", text: "quoting the robot", t: 1000 + n + 1, thread, replyTo: "chat_sys1", reactions: {} };
  }
  return { ...base, docs };
}

// ---------------- player-stats-card fixture (2026-08-08) ----------------
// Weeks 1-4 written directly as "weekly" docs (the section M4/S7 technique — bypasses
// LG.finalizeWeek's live-data gate entirely; the game log only needs to know a week is
// FINALIZED, its own `matchups` content is irrelevant to D.gameLog). Paired with
// slpStatsFix's own per-week shape (see that function's header comment) this gives P. Passer
// (key "3915511", team PHI) a hand-computable 4-week history: weeks 1-2 use the GENERIC
// default (150 pass yd + 1 TD + 1 INT + 1 2pt = 6+4-2+2 = 10.0/wk), week 3's override is
// 300yd/2TD = 12+8 = 20.0, week 4's is 25yd = 1.0. Season total 41.0, avg 10.25 (renders
// "10.3" — LG.fmtPts rounds to 1dp), best 20.0.
function seedWithWeeklyHistory() {
  const base = fullSeed();
  const docs = { ...base.docs };
  for (let w = 1; w <= 4; w++) {
    docs["weekly_2026_w" + w] = { kind: "weekly", week: w, matchups: [{ home: 1, away: 2, homePts: 0, awayPts: 0 }], awards: {}, power: [], accuracy: null, finalizedAt: 1000 + w };
  }
  return { ...base, docs };
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
      // seed.stamp marks this local store as a MIRROR of the cloud (lg-core's SNAPSHOT MIRROR
      // note). Absent by default, which is what keeps every pre-existing section a genuine,
      // fully-writable local-backend store.
      if (seed.stamp) localStorage.setItem("lg_snapstamp_" + pfx.slice("lg_gffl_".length, -1), String(seed.stamp));
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
        // The Firestore REST transport. A page that armed a wire fixture (opts.rest) gets it;
        // every other page aborts firestore.googleapis.com exactly as before, which is what
        // keeps every pre-existing section in LOCAL mode.
        if (/firestore\.googleapis\.com/.test(u)) {
          if (!opts.rest) return req.abort();
          return restRespond(req, u, opts.rest);
        }
        if (/gstatic|googleapis|firebase/.test(u)) return req.abort();
        // ESPN's crest CDN (item 4). Answered with a tiny SVG so the image genuinely LOADS —
        // an aborted request would leave every <img> broken, the review plates would show no
        // crests at all, and "the logo renders" could only ever be asserted as "the element
        // exists", which is not the same thing.
        if (/a\.espncdn\.com\/i\/teamlogos/.test(u)) {
          const ab = ((/\/([a-z0-9]+)\.png$/i.exec(u) || [])[1] || "nfl").toUpperCase();
          return req.respond({ status: 200, contentType: "image/svg+xml", headers: cors,
            body: `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="31" fill="#2a4f80"/><text x="32" y="40" font-size="21" fill="#fff" text-anchor="middle" font-family="sans-serif">${ab.slice(0, 3)}</text></svg>` });
        }
        if (u.includes("site.api.espn.com")) {
          if (fixture.espnDown) return req.respond({ status: 503, headers: cors, body: "{}" });
          if (u.includes("/scoreboard")) {
            // The 2025 replay asks for an EXPLICIT historical slate; everything else gets the
            // bare "current week" fixture exactly as before.
            if (u.includes("dates=")) { simSbUrls.push(u); return json(fixture.prod2025 ? prodSlate() : sbSim2025Fix()); }
            return json(sbFix());
          }
          if (u.includes("event=401900001")) return json(sumAFix());
          if (u.includes("event=401900002")) return json(sumBFix());
          if (u.includes("event=401900777")) return json(sumPreFix(fixture.pregameState));
          return json({});
        }
        if (u.includes("api.sleeper.app")) {
          if (fixture.sleeperDown) return req.respond({ status: 503, headers: cors, body: "{}" });
          if (u.endsWith("/state/nfl")) return json(fixture.sleeperWeek != null ? { ...slpStateFix, week: fixture.sleeperWeek } : slpStateFix);
          if (u.endsWith("/players/nfl")) return json(fixture.prod2025 ? prodSlpDirectory() : slpDirectoryFix());
          if (u.includes("/stats/nfl/")) {
            const sm = /\/stats\/nfl\/[^/]+\/(\d+)\/(\d+)/.exec(u);
            if (fixture.prod2025) return json(PROD_WEEK1);
            return json(slpStatsFix(sm ? sm[2] : u.split("/").pop(), sm ? sm[1] : null));
          }
          if (u.includes("/projections/nfl/")) {
            if (fixture.prod2025) return json(PROD_PROJ);
            // 2025 replay requests are season/week-aware (SIM_PROJ_FIX above); every other
            // caller (the real 2026 league) is untouched — same generic slpProjFix always.
            const m = /\/projections\/nfl\/[^/]+\/(\d+)\/(\d+)/.exec(u);
            const simFix = m ? slpSimProjFix(m[1], m[2]) : null;
            return json(simFix != null ? simFix : slpProjFix);
          }
          return json({});
        }
        return req.abort();
      } catch (e) { /* page closed mid-flight */ }
    })();
  });
  return { ctx, page, errors };
}
async function bootPage(page) {
  await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
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
// A tolerant waitForSelector: returns false on timeout instead of throwing. Section Z's whole
// point is proving what the PRE-FIX code does, and pre-fix the elements it waits for never
// appear at all — a thrown TimeoutError would abort the run with one stack trace instead of a
// readable list of exactly which guarantees are missing.
async function waitOr(page, sel, ms) {
  try { await page.waitForSelector(sel, { timeout: ms || 9000 }); return true; }
  catch (e) { return false; }
}
// Tolerant siblings, for a section whose hooks are all NEW (section AC's own lesson, restated
// by section AG): against the PRE-FIX app every one of these waits legitimately times out, and
// a bare wait turns the whole pre-fix verification into one stack trace instead of the readable
// list of failures it exists to produce. They report rather than abort; the real assertions
// downstream are what fail.
async function waitFnOr(page, fn, ...args) {
  try { await page.waitForFunction(fn, { timeout: 9000 }, ...args); return true; }
  catch (e) { return false; }
}
async function openTradeSideOr(page, side) { try { await openTradeSide(page, side); return true; } catch (e) { return false; } }
// page.evaluate whose browser-side body may reference something that does not exist yet.
async function evalOr(page, fn, ...args) { try { return await page.evaluate(fn, ...args); } catch (e) { return null; } }

// ---------------- fake CLOUD backend (live-bug batch, 2026-08-08) ----------------
// Every other section here runs on the LOCAL backend, which the app now (correctly) treats as
// a DEGRADED fallback — it's only ever reached because the real cloud couldn't be, so an empty
// read there proves nothing about the league (lg-core.js's SERVER-CONFIRMED EMPTINESS note).
// Any section that needs the app to believe it is genuinely talking to the league store — the
// first-run card, above all, which must only ever appear on a CONFIRMED-empty backend — arms a
// fake cloud instead. Wired through a setter on window.LG (then on LG.db) via
// evaluateOnNewDocument, exactly like section W, so it is in place before boot's first read
// rather than racing it; lg-core's own backendReady catch leaves an already-installed cloud
// alone, so nothing has to re-assert it afterwards.
//   docs    — the collection the cloud starts with ({} = a genuinely empty league)
//   delayMs — per-call latency (0 = instant); use a real delay to exercise cold-boot paint
//   fail    — every read REJECTS (a reachable-then-broken backend)
// ---------------- the Firestore REST fixture (2026-08-08, the REST transport) ----------------
// lg-core no longer loads the Firebase SDK: get/set/del/list are plain fetch against the
// Firestore REST API (see its own header note for why — three live SDK outages in one day).
// So the suite's cloud fixture is a WIRE fixture now: real REST URLs, real Firestore `fields`
// encoding, real status codes. The encoder below is deliberately an INDEPENDENT implementation
// of the same rules lg-core's fsEnc follows — that is what makes the round-trip checks real
// rather than a function agreeing with itself.
const FS_DOC_ROOT = "projects/amen-farms-app/databases/(default)/documents";
function fsWireEnc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsWireEnc) } };
  if (typeof v === "object") { const f = {}; for (const k of Object.keys(v)) f[k] = fsWireEnc(v[k]); return { mapValue: { fields: f } }; }
  return { nullValue: null };
}
function fsWireDec(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return !!v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsWireDec);
  if ("mapValue" in v) { const o = {}; const f = v.mapValue.fields || {}; for (const k of Object.keys(f)) o[k] = fsWireDec(f[k]); return o; }
  return null;
}
function fsWireDoc(id, doc) {
  const fields = {};
  for (const k of Object.keys(doc || {})) fields[k] = fsWireEnc(doc[k]);
  return { name: FS_DOC_ROOT + "/gffl_" + FAM + "/" + id, fields };
}
// A live REST fixture. `docs` is a plain id->doc map the responder mutates, so a PATCH really
// is visible to the next GET. Every flag is flippable MID-TEST (the auto-retry recovery check
// turns `fail` off while the page is running).
function restFixture(docs) {
  return { docs: JSON.parse(JSON.stringify(docs || {})), calls: [], fail: false, hang: false };
}
function restRespond(req, u, R) {
  const method = req.method();
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
  // A request that is never answered — the shape of live incident (3), and the ONLY thing the
  // AbortController timeout can be measured against.
  if (R.hang) { R.calls.push({ method, url: u, hung: true }); return; }
  if (method === "OPTIONS") return req.respond({ status: 200, headers: cors, body: "" });
  if (R.fail) { R.calls.push({ method, url: u, failed: true }); return req.abort(); }
  const json = (obj, status) => req.respond({ status: status || 200, contentType: "application/json", headers: cors, body: JSON.stringify(obj) });
  if (u.includes(":runQuery")) {
    let q = {};
    try { q = (JSON.parse(req.postData() || "{}").structuredQuery) || {}; } catch (e) { /* malformed */ }
    const kind = q.where && q.where.fieldFilter ? q.where.fieldFilter.value.stringValue : null;
    R.calls.push({ method, op: "runQuery", kind, coll: ((q.from || [])[0] || {}).collectionId, url: u });
    const rows = Object.entries(R.docs)
      .filter(([, d]) => !kind || d.kind === kind)
      .map(([id, d]) => ({ document: fsWireDoc(id, d), readTime: "2026-01-01T00:00:00Z" }));
    // A zero-result runQuery really does answer with one document-LESS row, not an empty array.
    return json(rows.length ? rows : [{ readTime: "2026-01-01T00:00:00Z" }]);
  }
  const m = /\/documents\/([^/?]+)\/([^/?]+)/.exec(u);
  const coll = m ? decodeURIComponent(m[1]) : null;
  const id = m ? decodeURIComponent(m[2]) : null;
  const body = req.postData() || "";
  R.calls.push({ method, op: "doc", id, coll, url: u, body });
  if (method === "GET") {
    const d = R.docs[id];
    if (!d) return json({ error: { code: 404, status: "NOT_FOUND", message: "Document not found." } }, 404);
    return json(fsWireDoc(id, d));
  }
  if (method === "PATCH") {
    let payload = {};
    try { payload = JSON.parse(body); } catch (e) { /* malformed */ }
    const patch = {};
    for (const k of Object.keys(payload.fields || {})) patch[k] = fsWireDec(payload.fields[k]);
    R.docs[id] = { ...(R.docs[id] || {}), ...patch }; // updateMask semantics: listed fields replaced, others kept
    return json(fsWireDoc(id, R.docs[id]));
  }
  if (method === "DELETE") { delete R.docs[id]; return json({}); }
  return json({});
}

async function armFakeCloud(page, docs, opts) {
  opts = opts || {};
  await page.evaluateOnNewDocument((docs, delayMs, fail) => {
    let realLG = null;
    Object.defineProperty(window, "LG", {
      configurable: true,
      get() { return realLG; },
      set(v) {
        realLG = v;
        if (!v || v.__fcHook) return;
        v.__fcHook = true;
        let realDb;
        Object.defineProperty(v, "db", {
          configurable: true,
          get() { return realDb; },
          set(dbVal) {
            realDb = dbVal;
            if (!dbVal || dbVal.__fcArmed) return;
            dbVal.__fcArmed = true;
            const store = new Map(Object.entries(docs || {}));
            window.__fakeCloud = { store, calls: [] };
            const delay = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
            dbVal._installFakeCloud({
              async get(id) {
                window.__fakeCloud.calls.push("get:" + id); await delay(delayMs);
                if (window.__fakeCloudFail) throw new Error("fake cloud offline");
                return store.get(id) || null;
              },
              async set(id, data) {
                // __fakeCloudFailWrites is the READS-FINE-WRITES-REJECT case (section X's
                // setup-failure check): the league loads normally and only the write half
                // rejects, which is exactly the shape a degraded backend presents to a setup
                // run. __fakeCloudFail keeps meaning "nothing works at all".
                if (window.__fakeCloudFail || window.__fakeCloudFailWrites) throw new Error("fake cloud offline");
                const cur = store.get(id) || {}; store.set(id, { ...cur, ...data });
              },
              async del(id) { store.delete(id); },
              async list(kind) {
                window.__fakeCloud.calls.push("list:" + (kind || "*")); await delay(delayMs);
                if (window.__fakeCloudFail) throw new Error("fake cloud offline");
                const out = []; for (const [id, d] of store) if (!kind || d.kind === kind) out.push({ ...d, id });
                return out;
              },
              watch(id, cb) { cb(store.get(id) || null); return () => {}; },
            });
          },
        });
      },
    });
    if (fail) window.__fakeCloudFail = true;
  }, docs || {}, opts.delayMs || 0, !!opts.fail);
}

const clickIn = (page, sel, filterText) => page.evaluate((sel, ft) => {
  const els = [...document.querySelectorAll(sel)];
  const el = ft ? els.find((e) => e.textContent.includes(ft)) : els[0];
  if (!el) return false;
  el.click(); return true;
}, sel, filterText || null);
// Player-stats-card split (2026-08-08): a row that used to BE the whole clickable surface
// (the FA table row, a trade-builder pick chip, a lineup slot) now only opens the stats card —
// the action it used to perform (add/claim, pick, swap) moved onto its OWN explicit child
// button inside that row. clickIn can't reach a nested button by the ROW's own text (the
// button's own textContent, e.g. "Add"/"Pick"/"Swap", is the same for every row), so this
// finds the CONTAINER by text first, then clicks a specific child inside it.
const clickChildIn = (page, containerSel, childSel, filterText) => page.evaluate((cs, chs, ft) => {
  const els = [...document.querySelectorAll(cs)];
  const el = ft ? els.find((e) => e.textContent.includes(ft)) : els[0];
  if (!el) return false;
  const child = el.querySelector(chs);
  if (!child) return false;
  child.click(); return true;
}, containerSel, childSel, filterText || null);
// ITEM 20 (2026-08-09): the trade builder's two sides start COLLAPSED — a side is the players
// already chosen plus a "+", and the roster picker only exists once the "+" is tapped. Every
// pre-existing test that reached straight for a .pickchip therefore has to open the side
// first, exactly as a person now does. Waits for the picker's rows so the caller's own
// click can never land before the expansion has painted.
async function openTradeSide(page, side) {
  await page.evaluate((sd) => {
    const b = document.querySelector('#mv' + (sd === "give" ? "Give" : "Get") + ' .tradeadd');
    if (b) b.click();
  }, side);
  await page.waitForFunction((sd) => document.querySelectorAll('#mv' + (sd === "give" ? "Give" : "Get") + ' .pickchip').length > 0,
    { timeout: 9000 }, side);
}
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
    await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
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
  //
  // RESTAGED 2026-08-08 (live bug: the first-run card appeared against a Firestore collection
  // that HAS eight teams). First run is now only ever offered on SERVER-CONFIRMED emptiness,
  // so this section has to give the app a backend that genuinely confirms zero teams — an
  // EMPTY fake cloud — rather than the local fallback it used to run on, which the app now
  // (correctly) refuses to take an empty read from. The behaviour under test is unchanged;
  // only the premise is stated honestly. The "unconfirmed empty must NOT show this card" half
  // is section Z below.
  section("B2 · first run — empty league → import → claim");
  {
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: null, who: null });
    await armFakeCloud(page, {});
    await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
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
    // RESTAGED 2026-08-09 (user: "get rid of it"). The chip is a WARNING now, not a status
    // badge: silent when both sources are healthy, visible only when one is degraded or gone.
    // The degraded-mode checks further down (ESPN only / Sleeper only / STALE) are unchanged
    // and are what still prove it speaks up when it matters.
    const chipHidden = await page.evaluate(() => {
      const e = document.getElementById("healthChip");
      return !e || e.hidden || !e.textContent.trim();
    });
    ok(chipHidden, "a healthy board says nothing — no health chip while both sources are fine");
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
    // RESTAGED 2026-08-09 (playtest item 3: "the bench player section should match the
    // formatting of the non bench"). The bench table now carries the SAME .mutable class as
    // the starters — that is the fix — so ".mutable tbody tr" is no longer "the starters"; it
    // is both tables. Scoped to the one that isn't the bench. The property under test (nine
    // starter slots) is unchanged.
    ok((await page.$$eval(".mutable:not(.benchtable) tbody tr", (els) => els.length)) === 9, "9 slot rows (QB RB RB WR WR TE FLEX DST K)");
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
    // ESPN-row GEOMETRY regression (2026-08-08 playtest: "the left team's players don't line
    // up with the right team's"). .pcellgrid shipped with NO layout rule at all (the .scgrid
    // family of bug), so its two inner divs stacked in raw DOM order — the left half read
    // name→points top-to-bottom while the right half read points→name. Assert the RENDERED
    // geometry, never the markup: name and points sit BESIDE each other on one horizontal
    // band, and the points column hugs the INNER edge of both halves (adjacent to the slot
    // badge), mirrored, per the ESPN head-to-head reference.
    const rowGeo = await page.evaluate(() => {
      const tr = [...document.querySelectorAll(".mutable tbody tr")].find((r) => r.textContent.includes("P. Passer"));
      if (!tr) return null;
      const cells = [...tr.querySelectorAll(".pcellgrid")];
      const g = (cell) => ({
        cell: cell.getBoundingClientRect(),
        info: cell.querySelector(".pinfo").getBoundingClientRect(),
        pts: cell.querySelector(".ppts").getBoundingClientRect(),
      });
      const l = g(cells[0]), r = g(cells[1]);
      const beside = (a, b) => a.top < b.bottom && b.top < a.bottom;
      return {
        leftBeside: beside(l.info, l.pts), rightBeside: beside(r.info, r.pts),
        leftPtsInner: (l.cell.right - l.pts.right) < 24 && l.pts.left > l.info.left,
        rightPtsInner: (r.pts.left - r.cell.left) < 24 && r.info.right > r.pts.right,
        slotAlign: getComputedStyle(tr.querySelector(".slotcell")).textAlign,
      };
    });
    ok(!!rowGeo && rowGeo.leftBeside && rowGeo.rightBeside,
      "matchup row: name and points render BESIDE each other on both halves — never stacked in DOM order (" + JSON.stringify(rowGeo) + ")");
    ok(!!rowGeo && rowGeo.leftPtsInner && rowGeo.rightPtsInner,
      "…and the points column hugs the INNER edge of each half (adjacent to the slot badge), mirrored per the ESPN reference");
    ok(!!rowGeo && rowGeo.slotAlign === "center",
      "…slot badge label is horizontally centered (td.slotcell — .tbl td's text-align:left used to outweigh it)");
    // The ESPN stat summary line under the meta line, built from the SAME picked-source stats
    // the row's points were scored from (statSummary reads row[row.src].stats).
    // RESTAGED 2026-08-09 (the ESPN matchup rebuild): line 3 is now rendered on EVERY half,
    // populated or not — reserving its height is what makes every row the same height — so a
    // row's FIRST .pstatline is the away half's (empty here), not the one under P. Passer.
    // Read the half that actually holds him.
    const passerStatline = await page.evaluate(() => {
      const el = [...document.querySelectorAll(".mutable .pcellgrid")].find((c) => c.textContent.includes("P. Passer"));
      const line = el && el.querySelector(".pstatline");
      return line ? line.textContent.trim() : null;
    });
    ok(passerStatline === "150 pass yds, 1 TD, 1 INT",
      "ESPN-style stat summary line under the player's meta line (" + JSON.stringify(passerStatline) + ")");
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
    // RESTAGED 2026-08-09 (playtest item 9: "we dont need the word locked we just need to gray
    // out the swap button"). The LOCKED word is gone — the marker IS the disabled Swap button
    // now, so the check reads the property that actually exists: five locked rows, every one
    // of them with a genuinely disabled Swap, and no ".lock" element left anywhere.
    const locked = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".lrow.locked")];
      return {
        n: rows.length,
        allDisabled: rows.every((r) => { const b = r.querySelector(".lswap"); return !!b && b.disabled; }),
        anyLockWord: /LOCKED/.test(document.body.textContent),
        lockEls: document.querySelectorAll(".lrow .lock").length,
      };
    });
    ok(locked.n === 5 && locked.allDisabled, "5 starters locked (their game is live), each with a DISABLED Swap button (" + JSON.stringify(locked) + ")");
    ok(!locked.anyLockWord && locked.lockEls === 0, "…and the word LOCKED appears nowhere on the page any more");
    const unlockedSwap = await page.evaluate(() => {
      const r = [...document.querySelectorAll(".lrow")].find((x) => !x.classList.contains("locked") && x.querySelector(".lswap") && x.textContent.includes("F. Flexman"));
      const b = r && r.querySelector(".lswap");
      return b ? { disabled: b.disabled, h: Math.round(b.getBoundingClientRect().height) } : null;
    });
    ok(!!unlockedSwap && unlockedSwap.disabled === false, "…while an UNLOCKED starter's Swap button is still enabled (" + JSON.stringify(unlockedSwap) + ")");
    ok(/0\/3/.test(await page.evaluate(() => document.body.textContent)), "IR shows 0/3 — the league's 3 IR spots");
    const tightRow = await page.evaluate(() => {
      const el = [...document.querySelectorAll(".lrow")].find((r) => r.textContent.includes("T. Tight"));
      return el ? el.textContent : "";
    });
    ok(/proj 8\.5/.test(tightRow), "projection column league-scored from Sleeper proj stats (TE 8.5)");
    // Locked tap refuses. RESTAGED (2026-08-08, player-card split): a filled .lrow's own
    // click now opens the stats card, not the swap sheet — the swap affordance is its own
    // .lswap button (item 3's "keep the existing swap affordance as its own button").
    // RESTAGED 2026-08-09 (item 9): a locked row's Swap button is DISABLED, so clicking it
    // fires no event at all — there is no toast to assert any more, and that is the point:
    // the refusal happens before the tap instead of after it. What must still hold is that no
    // swap sheet opens. (openSwap keeps its own lock guard for the paths a disabled button
    // can't reach — an empty slot's candidate list, a bumped starter — exercised below.)
    await clickChildIn(page, ".lrow", ".lswap", "P. Passer");
    await sleep(150);
    ok(!(await page.$(".swaprow")), "clicking a locked starter's greyed-out Swap does nothing — no sheet opens");
    // Injured bench player -> IR.
    await clickChildIn(page, ".lrow", ".lswap", "I. Injured");
    await page.waitForSelector(".swaprow", { timeout: 5000 });
    const opts1 = await page.$$eval(".swaprow", (els) => els.map((e) => e.textContent));
    ok(opts1.some((t) => t.includes("→ IR")), "OUT player's move sheet offers IR");
    await page.evaluate(() => { [...document.querySelectorAll(".swaprow")].find((r) => r.textContent.includes("→ IR")).click(); });
    await page.waitForFunction(() => document.body.textContent.includes("1/3"), { timeout: 5000 });
    ok(true, "moved to IR — 1/3");
    const irDoc = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LSPFX + "roster_2026_w1_t1");
    ok(irDoc.players.find((p) => p.name === "I. Injured").slot === "IR", "IR move persisted to the roster doc");
    // Healthy bench player gets no IR option.
    await clickChildIn(page, ".lrow", ".lswap", "H. Healthy");
    await page.waitForSelector(".swaprow", { timeout: 5000 });
    const opts2 = await page.$$eval(".swaprow", (els) => els.map((e) => e.textContent));
    ok(!opts2.some((t) => t.includes("→ IR")), "healthy player is NOT IR-eligible");
    ok(opts2.some((t) => t.includes("→ WR")), "…but can move into a WR slot");
    await page.evaluate(() => { [...document.querySelectorAll(".swaprow")].find((r) => r.textContent.includes("Cancel")).click(); });
    // FLEX swap: unlocked starter <-> eligible bench.
    await clickChildIn(page, ".lrow", ".lswap", "F. Flexman");
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
    // claim with a bid, exactly the same claim-sheet flow as a typed search. RESTAGED
    // (2026-08-08, item 2's row/button split): the ROW itself now opens the player stats card
    // (proven separately below), so the claim flow starts from the row's own explicit
    // accent-outlined MOVE button (.faMoveBtn) instead.
    await clickChildIn(page, "#faResults [data-fi]", ".faMoveBtn", "A. Vail");
    await page.waitForSelector("#claimSheet [data-di]", { timeout: 5000 });
    ok(/Claim A\. Vail/.test(await page.$eval("#claimSheet", (e) => e.textContent)), "tapping the MOVE button on a browsed row (no search typed) opens the claim sheet for that player");
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
    await clickChildIn(page, "#faResults [data-fi]", ".faMoveBtn", "F. Agent"); // RESTAGED — see the note above
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
    await clickChildIn(page1, "#faResults [data-fi]", ".faMoveBtn", "KC D/ST"); // RESTAGED — see I0's note
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
    await clickChildIn(page, "#faResults [data-fi]", ".faMoveBtn", "KC D/ST"); // RESTAGED — see I0's note
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

  // ---- I2: the players table rebuilt as an ESPN-style sortable stats table (2026-08-08) ----
  section("I2 · players table — ESPN-style sortable stats (PLAYER/TYPE/OPP/STATUS/PROJ/SCORE/FPTS/AVG/LAST)");
  {
    // Column set + Available/All toggle. fullSeed() (real season, live-polled) — P. Passer
    // (team1, PHI) is a real rostered starter with a real live line (10.0, hand-checked in
    // section D) and a real known opponent (the DAL@PHI game IS this week's slate).
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForSelector("#faPosChips", { timeout: 9000 });
    await page.waitForFunction(() => document.querySelectorAll("#faResults [data-fi]").length > 0, { timeout: 5000 });
    // RESTAGED 2026-08-09 (ITEM 22): the user re-ordered these columns and dropped three of
    // them — "the first column should be add, then type, then projection, then last, the opp,
    // then avg". STATUS, SCORE and FPTS are gone (a real loss, deliberately taken), PLAYER
    // stays in front as the row's own label, and the MOVE button's old trailing blank header
    // is gone because the button moved into a real, sortable ADD column of its own.
    const headers = await page.$$eval("table.faTable thead th", (els) => els.map((e) => e.textContent.replace(/[▲▼]/g, "").trim()));
    ok(JSON.stringify(headers) === JSON.stringify(["PLAYER", "ADD", "TYPE", "PROJ", "LAST", "OPP", "AVG"]),
      "the column set renders in exactly the user's order, no trailing blank header (" + JSON.stringify(headers) + ")");
    // Available (default): every visible row is a genuine free agent — TYPE reads "FA" for all
    // of them, and every row still carries its own MOVE button (unchanged behavior).
    const availTypes = await page.$$eval("#faResults .fatype", (els) => els.map((e) => e.textContent.trim()));
    ok(availTypes.length > 0 && availTypes.every((t) => t === "FA"), "Available (default): every row's TYPE reads FA (" + JSON.stringify(availTypes) + ")");
    ok((await page.$$eval("#faResults .faMoveBtn", (els) => els.length)) === availTypes.length, "…and every Available row still carries its own MOVE button");
    // All: rostered players now appear too, TYPE reads the OWNING team's own abbrev
    // (seedTeams() gives team1 abbrev "T1"), and a rostered row has NO move button at all
    // (claiming/adding a player who's already on someone's roster isn't a supported flow).
    await clickIn(page, "#faFilterChips .poschip", "All");
    await page.waitForFunction(() => [...document.querySelectorAll("#faResults tr")].some((r) => r.textContent.includes("P. Passer")), { timeout: 5000 });
    const passerRow = await page.evaluate(() => {
      const tr = [...document.querySelectorAll("#faResults tr")].find((r) => r.textContent.includes("P. Passer"));
      const b = tr && tr.querySelector(".faMoveBtn");
      return tr ? { type: tr.querySelector(".fatype").textContent.trim(), hasMove: !!b, disabled: !!(b && b.disabled), title: b && b.title } : null;
    });
    ok(passerRow && passerRow.type === "T1", "All: a rostered player's TYPE reads the OWNING GFFL team's own abbrev, not FA (" + JSON.stringify(passerRow) + ")");
    // RESTAGED 2026-08-09 (ITEM 22, "Add should be greyed out if they can't be added"): a
    // rostered row used to render an EMPTY cell, which says nothing at all. It now renders a
    // real DISABLED button naming the owner — the information is the point, the absence was
    // the bug. The behaviour under test is unchanged: an owned player still cannot be claimed.
    ok(passerRow && passerRow.hasMove === true && passerRow.disabled === true,
      "…and a rostered row's MOVE button is present but genuinely disabled — claiming an owned player still isn't offered");
    ok(passerRow && passerRow.title === "Already on your team",
      "…and it says WHY — P. Passer is on the VIEWER's own roster, so it names that rather than an abbrev (" + (passerRow || {}).title + ")");
    // A player owned by SOMEONE ELSE names that team instead — the same disabled button, a
    // different reason. (Q. Rival is on team 2, abbrev "T2", per seedTeams()/fullSeed().)
    const rivalRow = await page.evaluate(() => {
      const tr = [...document.querySelectorAll("#faResults tr")].find((r) => r.textContent.includes("Q. Rival"));
      const b = tr && tr.querySelector(".faMoveBtn");
      return tr ? { type: tr.querySelector(".fatype").textContent.trim(), disabled: !!(b && b.disabled), title: b && b.title } : null;
    });
    ok(rivalRow && rivalRow.disabled === true && rivalRow.title === "Owned by " + rivalRow.type,
      "…and a player owned by ANOTHER team is disabled naming that team (" + JSON.stringify(rivalRow) + ")");
    ok(await page.evaluate(() => document.querySelector('.poschip[data-filter="all"]').classList.contains("on")), "the active filter chip carries the visual 'on' state");
    // OPP: hand-checked against sbFix()'s real slate — PHI (home) vs DAL (away), in progress;
    // KC (away) at DEN, upcoming.
    // RESTAGED 2026-08-09 (ITEM 22): the STATUS and SCORE halves of this block are gone with
    // their columns. The live clock and this week's points both survive in full on the
    // player's own stats card, which section Y already asserts and which any row opens.
    const passerOppStatus = await page.evaluate(() => {
      const tr = [...document.querySelectorAll("#faResults tr")].find((r) => r.textContent.includes("P. Passer"));
      return { opp: tr.querySelector(".faopp").textContent.trim(), noStatus: !tr.querySelector(".fastatus"), noScore: !tr.querySelector(".fascore") };
    });
    ok(passerOppStatus.opp === "vs DAL", "OPP renders '@'-prefixed correctly for the HOME side — P. Passer (PHI, home) reads 'vs DAL' (" + passerOppStatus.opp + ")");
    ok(passerOppStatus.noStatus && passerOppStatus.noScore, "…and the dropped STATUS/SCORE cells really are gone from the row, not merely unlabelled");
    const tightRow = await page.evaluate(() => {
      const tr = [...document.querySelectorAll("#faResults tr")].find((r) => r.textContent.includes("T. Tight"));
      return { opp: tr.querySelector(".faopp").textContent.trim() };
    });
    ok(tightRow.opp === "@ DEN", "OPP renders '@'-prefixed correctly for the AWAY side — T. Tight (KC, away) reads '@ DEN' (" + tightRow.opp + ")");
    // PROJ sort: T. Tight is the fixture's only player with a real Sleeper projection (8.5 —
    // same fixture value section M's own AI-read tests already hand-check). Sorting PROJ desc
    // must put him FIRST (every FA-only row has no projection -> -Infinity, tied); asc must
    // put him LAST.
    await clickIn(page, 'th.thsort[data-sort="proj"]');
    await page.waitForFunction(() => document.querySelector("#faResults tbody tr:first-child")?.textContent.includes("T. Tight"), { timeout: 5000 });
    ok(await page.evaluate(() => document.querySelector('th.thsort[data-sort="proj"]').classList.contains("active")), "PROJ header shows the active-column state after being clicked");
    ok(/▼/.test(await page.$eval('th.thsort[data-sort="proj"]', (e) => e.textContent)), "…and the FIRST click on a column sorts it DESC (▼ shown)");
    ok((await page.$eval("#faResults tbody tr:first-child", (e) => e.textContent)).includes("T. Tight"), "PROJ desc: the only player with a real projection (8.5) sorts to the TOP of the whole pool");
    await clickIn(page, 'th.thsort[data-sort="proj"]'); // second click on the SAME column -> asc
    ok(/▲/.test(await page.$eval('th.thsort[data-sort="proj"]', (e) => e.textContent)), "clicking the SAME column again flips to ASC (▲ shown)");
    ok((await page.$eval("#faResults tbody tr:last-child", (e) => e.textContent)).includes("T. Tight"), "PROJ asc: missing projections (-Infinity) sort first, so the only real value sorts to the very BOTTOM");
    ok(errors.length === 0, "0 page errors through the column-set/filter/OPP/PROJ-sort flow");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_players_table_390.png"), fullPage: true }); console.log("  📸 shots/gffl_players_table_390.png"); }
    await ctx.close();
  }
  {
    // AVG/LAST sorting — hand-computed with THREE distinct real season lines
    // (seedWithWeeklyHistory(), All filter): P. Passer total 41.0/avg 10.3/last(wk4) 1.0 ·
    // Q. Rival total 30.0/avg 15.0/last(wk4) 28.0 · T. Tight total 9.0/avg 9.0/last(wk4) 9.0
    // (all three derived directly from WEEK_STATS_FIX/slpStatsFix — see seedWithWeeklyHistory's
    // own header comment for Passer's, and WEEK_STATS_FIX's for Rival's/Tight's).
    // RESTAGED 2026-08-09 (ITEM 22): the FPTS column is one of the three the user dropped, so
    // the season TOTAL is no longer displayed and the default landing sort is AVG desc, not
    // FPTS desc. The two surviving season columns still produce DIFFERENT top-of-pool
    // orderings from each other, which is the actual proof that clicking a different header
    // genuinely re-sorts rather than just re-labeling the same order.
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    const { ctx, page, errors } = await newTestPage(browser, seedWithWeeklyHistory());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForSelector("#faPosChips", { timeout: 9000 });
    await clickIn(page, "#faFilterChips .poschip", "All");
    // Default landing sort (no header click yet) is season AVG desc — wait for the real
    // number to land (the season columns fetch lazily) before asserting on it.
    await page.waitForFunction(() => {
      const tr = [...document.querySelectorAll("#faResults tr")].find((r) => r.textContent.includes("P. Passer"));
      return tr && tr.querySelector(".faavg").textContent.trim() === "10.3";
    }, { timeout: 9000 });
    ok(await page.evaluate(() => document.querySelector('th.thsort[data-sort="avg"]').classList.contains("active")),
      "default sort (before any header click) is already AVG — the season column that survived item 22");
    const rowSeason = async (name) => page.evaluate((n) => {
      const tr = [...document.querySelectorAll("#faResults tr")].find((r) => r.textContent.includes(n));
      return tr ? { avg: tr.querySelector(".faavg").textContent.trim(), last: tr.querySelector(".falast").textContent.trim() } : null;
    }, name);
    ok(JSON.stringify(await rowSeason("P. Passer")) === JSON.stringify({ avg: "10.3", last: "1.0" }), "P. Passer's season line, hand-computed from the 4 seeded weeks");
    ok(JSON.stringify(await rowSeason("Q. Rival")) === JSON.stringify({ avg: "15.0", last: "28.0" }), "Q. Rival's season line (only weeks 3-4 have an entry for her — weeks 1-2 omitted, not zeroed)");
    ok(JSON.stringify(await rowSeason("T. Tight")) === JSON.stringify({ avg: "9.0", last: "9.0" }), "T. Tight's season line (only week 4 has an entry for him)");
    const topName = async () => (await page.$eval("#faResults tbody tr:first-child", (e) => e.textContent)).match(/P\. Passer|Q\. Rival|T\. Tight/)?.[0];
    // seedWithWeeklyHistory()'s default per-week bucket also gives W. Receiver/PHI D/ST/
    // K. Kicker/R. Rusher real season lines of their own (not just the three named players) —
    // so rather than predicting an exact WHOLE-POOL leaderboard position (which their numbers
    // would also shift), these checks compare the RELATIVE order among just the three named
    // players, which is fully determined by their own hand-computed lines regardless of what
    // else is on the board.
    const orderOf = async (names) => {
      const all = await page.$$eval("#faResults tbody tr", (els) => els.map((e) => e.textContent));
      return names.map((n) => all.findIndex((t) => t.includes(n)));
    };
    const isAscendingIdx = (idxs) => idxs.every((v, i) => i === 0 || idxs[i - 1] < v);
    ok((await topName()) === "Q. Rival", "AVG desc (default): Q. Rival (15.0/gm) leads the WHOLE pool");
    ok(isAscendingIdx(await orderOf(["Q. Rival", "P. Passer", "T. Tight"])),
      "AVG desc: among the three, Q. Rival (15.0) > P. Passer (10.3) > T. Tight (9.0), in that row order");
    await clickIn(page, 'th.thsort[data-sort="last"]');
    await page.waitForFunction(() => document.querySelector("#faResults tbody tr:first-child")?.textContent.includes("Q. Rival"), { timeout: 5000 });
    ok((await topName()) === "Q. Rival", "LAST desc: Q. Rival (28.0) leads");
    ok(isAscendingIdx(await orderOf(["Q. Rival", "T. Tight", "P. Passer"])),
      "LAST desc: among the three, Q. Rival (28.0) > T. Tight (9.0) > P. Passer (1.0) — T. Tight now beats P. Passer, a REVERSAL from AVG where P. Passer was ahead of him — proving this is a real independent sort, not a re-labeled repeat");
    // asc: missing values (-Infinity) sort FIRST, so real values sort toward the bottom in
    // the OPPOSITE relative order to desc.
    await clickIn(page, 'th.thsort[data-sort="last"]');
    ok(isAscendingIdx(await orderOf(["P. Passer", "T. Tight", "Q. Rival"])),
      "LAST asc: the exact reverse relative order — P. Passer (1.0) < T. Tight (9.0) < Q. Rival (28.0)");
    ok(errors.length === 0, "0 page errors through the AVG/LAST hand-checked sort flow");
    await ctx.close();
  }
  {
    // Sorting acts on the WHOLE fetched pool, not just what's scrolled into view — grown by
    // "Show more". Also: no page-level sideways scroll at 390px despite the wide table (it
    // pans inside its own .panner), and the stats-card / MOVE-button behaviors this table
    // relies on are untouched (Y and I0/I1 already prove those in full — this is a light
    // spot-check specific to the new columns' own row shape).
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForSelector("#faPosChips", { timeout: 9000 });
    await clickIn(page, "#faFilterChips .poschip", "All");
    await page.waitForFunction(() => document.querySelectorAll("#faResults [data-fi]").length > 0, { timeout: 5000 });
    // Player names alpha-sort across the WHOLE pool, incl. after growing it with Show more —
    // proves sorting isn't limited to the rows that happened to render before the click.
    if (await page.$("#faMore")) await clickIn(page, "#faMore");
    await page.waitForFunction(() => document.querySelectorAll("#faResults [data-fi]").length > 0, { timeout: 5000 });
    const poolSize = await page.$$eval("#faResults [data-fi]", (els) => els.length);
    await clickIn(page, 'th.thsort[data-sort="player"]'); // first click on a fresh column -> DESC, per spec
    const names = await page.$$eval("#faResults .faname b", (els) => els.map((e) => e.textContent));
    ok(names.length === poolSize, "sorting by PLAYER re-orders the FULL rendered pool, not a subset (" + names.length + "/" + poolSize + ")");
    const descCopy = [...names].sort((a, b) => b.localeCompare(a));
    ok(JSON.stringify(names) === JSON.stringify(descCopy), "…and it's genuinely alphabetical (Z→A, first click = desc) across every row, first to last (" + JSON.stringify(names) + ")");
    await clickIn(page, 'th.thsort[data-sort="player"]'); // second click on the SAME column -> asc
    const namesAsc = await page.$$eval("#faResults .faname b", (els) => els.map((e) => e.textContent));
    const ascCopy = [...names].sort((a, b) => a.localeCompare(b));
    ok(JSON.stringify(namesAsc) === JSON.stringify(ascCopy), "…and clicking the SAME column again flips it to A→Z, still across the full pool (" + JSON.stringify(namesAsc) + ")");
    ok(errors.length === 0, "0 page errors");
    // 390px: no page-level sideways scroll despite the wide 10-column table — it pans inside
    // its own .panner, same house convention every other wide table here already relies on.
    const scroll = await page.evaluate(() => ({ b: document.body.scrollWidth, w: window.innerWidth }));
    ok(scroll.b <= scroll.w + 1, "no page-level sideways scroll at 390px despite the wide players table (" + scroll.b + "/" + scroll.w + ")");
    const pannerScrolls = await page.evaluate(() => {
      const p = document.querySelector("#faResults .panner");
      const t = p.querySelector("table");
      return t.scrollWidth > p.clientWidth; // the TABLE itself is wider than its own panning viewport — confirms it's genuinely panning, not just fitting by luck
    });
    ok(pannerScrolls, "…because the table genuinely overflows its .panner (the panning container is doing real work, not just present unused)");
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
    await waitOr(page1, "#mvGet .tradeadd"); // tolerant: a restaged wait must report, not abort a pre-fix run
    // RESTAGED (2026-08-08, item 1's "trade builder roster pickers" split): the chip itself
    // now opens the stats card — the give/get toggle moved onto its own .pcpick button.
    // RESTAGED AGAIN (2026-08-09, ITEM 20): both sides start collapsed, so each one has to be
    // expanded via its own "+" before there is a chip to pick — which is what a person now
    // does too. The picking itself, and everything downstream of it, is unchanged.
    await openTradeSideOr(page1, "give");
    await clickChildIn(page1, "#mvGive .pickchip", ".pcpick", "B. Backup");
    await openTradeSideOr(page1, "get");
    await clickChildIn(page1, "#mvGet .pickchip", ".pcpick", "X. Wideout");
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

    // RESTAGED 2026-08-09 (section AF): a trade's review window is judged in WALL time now, so
    // LG.nowOverride — which only moves the league/replay clock — can no longer expire it. Age
    // the deadline instead, which is what the passing of a real day amounts to.
    await page2.evaluate(async (id) => {
      const LG = window.__GFFL__.LG;
      const doc = await LG.loadTrade(id, { fresh: true });
      await LG.saveTrade({ ...doc, reviewEndsAt: Date.now() - 1000 });
    }, tradeId);
    // …and drive the very check renderMoves runs. Jumping nowOverride used to defeat the
    // auto-check THROTTLE for free as a side effect; ageing a wall-time deadline does not.
    await page2.evaluate(async () => {
      await window.__GFFL__.UI.maybeAutoExecuteTrades();
      await window.__GFFL__.UI.renderMoves();
    });
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
      // RESTAGED 2026-08-09 (section AF): the review window is wall time, so age the deadline
      // rather than the league clock (nowOverride no longer reaches it).
      await LG.saveTrade({ ...acc, reviewEndsAt: Date.now() - 1000 });
      await LG.executeTrade(off.trade.id);
      // Vetoed trade.
      const off2 = await LG.offerTrade(1, 2, ["111777"], ["dst_DAL"], "");
      await LG.acceptTrade(off2.trade.id, 2);
      await LG.vetoTrade(off2.trade.id, 3); await LG.vetoTrade(off2.trade.id, 4);
      await LG.vetoTrade(off2.trade.id, 5); await LG.vetoTrade(off2.trade.id, 6);
      const chat = await LG.loadChat(null);
      return chat.filter((m) => m.sys).map((m) => m.text);
    });
    // RESTAGED 2026-08-09 (item 15, user: "dont put rules changes in the chat or any other
    // system message, just users chats"). Every one of the seven sys-post sites is GONE at the
    // WRITE, not just filtered at render — each was checked for whether its event would lose
    // its ONLY record, and none would: the settings doc's own change log covers a rules save
    // (and the Rules view renders it), the transaction log covers waivers/trades/vetoes, the
    // weekly doc covers a finalized week, the bracket doc covers the bracket and the champion.
    ok(r.length === 0, "none of these events writes a sys chat post any more (" + JSON.stringify(r) + ")");
    // …and every one of them really is recorded somewhere else, so nothing was lost to tidy a list.
    const elsewhere = await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      const tx = await LG.loadTx();
      return { tx: tx.map((t) => t.type + ":" + ((t.detail && t.detail.result) || (t.detail && t.detail.addName) || "")),
               ruleLog: (LG.rulesDoc.log || []).map((e) => e.who + ":" + e.changes.join(",")) };
    });
    ok(elsewhere.ruleLog.some((l) => /Peter/.test(l) && /scoring\.rec/.test(l)),
      "a rules save is recorded in the settings doc's own change log (" + JSON.stringify(elsewhere.ruleLog) + ")");
    ok(elsewhere.tx.some((k) => /^waiver:KC D\/ST/.test(k)) && elsewhere.tx.some((k) => k === "trade:executed") && elsewhere.tx.some((k) => k === "trade:vetoed"),
      "…and the waiver, the executed trade and the veto are all in the transaction log (" + JSON.stringify(elsewhere.tx) + ")");
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
    ok(/S\. New/.test(body1), "locker transactions list shows the team's own tx history (rendered short: \"Someone New\" -> \"S. New\")");
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
  // awards, accuracy, power snapshot, standings, and idempotency (the sys chat post it used
  // to write is gone — item 15).
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
    // Undo the force-finalize so the rest of this test exercises the real, un-forced numbers
    // against a clean slate. RESTAGED 2026-08-09 (item 15): there is no sys chat post to clean
    // up any more — finalizeWeek writes the weekly doc and nothing else.
    await page.evaluate(async () => {
      await window.__GFFL__.LG.db.del("weekly_2026_w1");
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

    // RESTAGED 2026-08-09 (item 15): finalizing a week used to announce itself in chat with
    // all three awards in the sentence. It writes NOTHING to chat now — the weekly doc it just
    // wrote is the record, and the same three awards are read straight off it (asserted
    // immediately above, and rendered by the league home and the record book). So the check
    // flips: no chat message, and the awards still exactly where they need to be.
    const chat1 = await page.evaluate(() => window.__GFFL__.LG.loadAllChat());
    ok(chat1.length === chatBefore, "finalizing a week writes NO chat message at all (" + chat1.length + " vs " + chatBefore + ")");
    const wkDoc = await page.evaluate(() => window.__GFFL__.LG.loadWeekly(1));
    ok(wkDoc.awards.topScore.teamId === 1 && wkDoc.awards.topScore.pts === 87
      && /F\. Flexman/.test(wkDoc.awards.bust.name) && wkDoc.awards.benchBlunder.diff === 48,
      "…and the top score, the bust and the bench blunder all live on the weekly doc instead (" + JSON.stringify(wkDoc.awards) + ")");

    // Idempotent: a second call returns the SAME doc, untouched — no recomputation, no
    // duplicate chat post.
    const r2 = await page.evaluate(() => window.__GFFL__.LG.finalizeWeek(1));
    ok(r2.ok === true && r2.finalizedAt === r1.finalizedAt, "re-calling finalizeWeek returns the SAME doc untouched (idempotent)");
    const chat2 = await page.evaluate(() => window.__GFFL__.LG.loadAllChat());
    ok(chat2.length === chat1.length, "…and still writes nothing to chat");

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
    // doc. RESTAGED 2026-08-09 (item 15): the "bracket is set" sys chat post is gone at the
    // write, so "no DUPLICATE post" would now be vacuous — the assertion is that building it,
    // twice, writes nothing to chat at all, while the bracket doc (rendered above, byes and
    // play-in pairings and all) carries the whole announcement's content.
    const chatBefore = (await page.evaluate(() => window.__GFFL__.LG.loadAllChat())).length;
    const rebuild = await page.evaluate(() => window.__GFFL__.LG.buildBracket());
    ok(rebuild.ok === true, "re-calling buildBracket succeeds");
    ok(JSON.stringify(rebuild.seeds) === JSON.stringify(bracket.seeds), "…and returns the SAME bracket, untouched");
    const chatAfter = (await page.evaluate(() => window.__GFFL__.LG.loadAllChat())).length;
    ok(chatAfter === chatBefore && chatBefore === 0, "…and building a bracket writes nothing to chat, first time or second (" + chatAfter + ")");

    ok(errors.length === 0, "0 page errors through the build + week-15/16 display flow");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_bracket_390.png"), fullPage: true }); console.log("  📸 shots/gffl_bracket_390.png"); }

    // O2 continues in the SAME context/state — seed wk15 -> advance -> wk16 -> advance ->
    // wk17 -> advance, hand-verifying every resolution and the trophy (the two sys posts it
    // used to write are gone — item 15).
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

    // RESTAGED 2026-08-09 (item 15): crowning a champion used to post two sys chat messages.
    // Both are gone at the write — bracket.champion, the trophy just asserted on the team doc,
    // and bracket.toilet are the records, and the Bracket tab renders both as banners (which
    // this section already asserts, by name, a few checks below).
    const chatFinal = await page.evaluate(() => window.__GFFL__.LG.loadAllChat());
    ok(chatFinal.length === chatBeforeChamp, "crowning a champion writes NO chat message (" + chatFinal.length + " vs " + chatBeforeChamp + ")");
    ok(adv3.champion === 1 && adv3.toilet === 2, "…the champion and the Toilet Bowl live on the bracket doc instead");

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
    // RESTAGED 2026-08-08 (the 2025 season replay): the old copy explained the button as "the
    // 2026 league is pre-draft, so seed from 2025 instead". The replay now does exactly that
    // automatically at week 1, so that sentence would be describing a problem the app already
    // solves. The button survives as the manual re-run for whichever week is open, and the copy
    // says so — which is what this now checks. Same guarantee (the importer is EXPLAINED, not
    // just an unlabeled button), against the sentence that actually ships.
    ok(/real, FINAL 2025 season/.test(rulesTxtFlat) && /manual button for re-running it/.test(rulesTxtFlat),
      "…with an explanation of what the test-run importer does (re-seeds this week from the real final 2025 season) and when you'd reach for it");
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
      const TXNAMES = ["Aaron Ashby", "Blake Baker", "Colin Carter", "Dean Dixon", "Evan Ellis",
        "Frank Foster", "Gabe Grant", "Hank Hughes", "Ian Irwin", "Jack Jones"];
      for (let i = 1; i <= 10; i++) await LG.logTx("fa_add", 1, 1, { addKey: "k" + i, addName: TXNAMES[i - 1] });
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
    ok(/J\. Jones/.test(movesCard.html) && !/A\. Ashby/.test(movesCard.html) && !/B\. Baker/.test(movesCard.html),
      "…the MOST RECENT moves are shown (10 present, the oldest — Ashby and Baker — trimmed off)");
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
    // RESTAGED 2026-08-09 (item 15, user: "just users chats"). Sys posts used to be INCLUDED
    // here on the grounds that they "ARE the league's own timeline" — the user's answer to
    // that is the Recent moves card sitting right above this one. This is the third chat
    // surface and it filters exactly like the other two: the doc is still written (rules
    // changes are), it simply never reaches a reader.
    await page.evaluate(() => window.__GFFL__.LG.postSys("A sys announcement"));
    await page.evaluate(() => window.__GFFL__.UI.show("league"));
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await openDetails(page, "chatDetails");
    const previewAfterSys = await page.evaluate(() => {
      const d = [...document.querySelectorAll(".collapsecard")].find((el) => el.textContent.includes("League chat"));
      return { txt: document.body.textContent, rows: d ? d.querySelectorAll(".fline").length : -1 };
    });
    ok(!previewAfterSys.txt.includes("A sys announcement"),
      "a sys post never reaches the league-home chat preview — user messages only");
    ok(previewAfterSys.rows === 6, "…and it still shows the last 6 USER messages, undisturbed (" + previewAfterSys.rows + ")");
    // "View all" / "Open chat" actually navigate.
    await clickIn(page, "#recentMovesAll");
    await page.waitForFunction(() => document.body.textContent.includes("J. Jones"), { timeout: 5000 });
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
    // Coordinator addendum (2026-08-08): a "GFFL — Week N" card, ABOVE everything else,
    // showing OUR OWN league's current-week matchups with live totals — reusing the exact
    // same data path (LG.gamesForWeek + matchupCard) as the league home, so these are
    // provably the SAME numbers section C already hand-checked for this identical fixture
    // (team1/home 41.0, team2/away 4.0).
    const gfflHeading = await page.$eval("main > .card:first-child h2", (h) => h.textContent);
    ok(gfflHeading === "GFFL — Week 1", "the GFFL matchups card is the FIRST card on the Scores tab (" + gfflHeading + ")");
    ok((await page.$$eval("main > .card:first-child .mucard", (els) => els.length)) === 4, "the GFFL card shows all 4 of this week's matchups");
    const gfflScore = await page.$eval("main > .card:first-child .mucard.mine .muscore", (e) => e.textContent);
    ok(gfflScore === "4.0 — 41.0", "my GFFL matchup's live total, hand-checked identically to the league home's own card (away 4.0 — home 41.0, " + gfflScore + ")");
    await clickIn(page, "main > .card:first-child .mucard.mine");
    await page.waitForSelector(".muhead", { timeout: 9000 });
    ok((await page.$$eval(".bigpts", (els) => els.map((e) => e.textContent))).join("/") === "4.0/41.0",
      "…and tapping the GFFL card's matchup opens the real matchup view with the same totals");
    await page.evaluate(() => window.__GFFL__.UI.show("scores"));
    await page.waitForFunction(() => document.body.textContent.includes("NFL this week"), { timeout: 9000 });
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
  {
    // Coordinator addendum: the ESPN card hides ENTIRELY when every matchup reads 0-0 with
    // 0.0 points (preseason/pre-draft = no real signal) — while the GFFL card (our own live
    // data, unrelated to the ESPN upstream) keeps rendering normally regardless.
    fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false; fixture.ffAllZero = true;
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await clickIn(page, '.bnav button[data-v="scores"]');
    await page.waitForFunction(() => document.body.textContent.includes("NFL this week"), { timeout: 9000 });
    const body = await page.evaluate(() => document.body.textContent);
    ok(!/ESPN league \(live\)/.test(body), "the ESPN fantasy card is hidden entirely when every matchup reads 0-0/0.0 (preseason/pre-draft — no signal)");
    ok(/GFFL — Week 1/.test(body), "…while the GFFL matchups card (our own data) keeps rendering — unrelated to the ESPN upstream");
    ok(/NFL this week/.test(body), "…and the real NFL slate keeps rendering too");
    fixture.ffAllZero = false; // restore the default scored fixture for every section after this one
    ok(errors.length === 0, "0 page errors on the all-zero ESPN card path");
    await ctx.close();
  }
  // RESTAGED 2026-08-08 (the 2025 season replay): the block that used to live here entered
  // the "_t25" sandbox through the Rules page and proved the ESPN fantasy card hides itself
  // there. The sandbox is gone; the same rule now keys on LG.SIM_2025, and the check moved to
  // the new section X, which boots the replay the way a family device actually will.

  section("T · nav — active-tab indicator centering (item 6) + the six-tab bar (item 16)");
  {
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    // RESTAGED 2026-08-09 (item 16, user: "lets remove the tabs for rules and draft, put a
    // link to each in the league page instead"). Item 8's Draft TAB is gone from the bar
    // entirely — where it now lives, and that it still works, is section AE's business. What
    // this section keeps asserting is the bar itself: six tabs, exactly these six, and no
    // stray link left behind in it.
    const bar = await page.evaluate(() => ({
      labels: [...document.querySelectorAll(".bnav button")].map((b) => b.textContent.trim()),
      links: document.querySelectorAll(".bnav a, .bnav .bnavlink").length,
    }));
    ok(bar.labels.join("|") === "League|Matchup|My Team|Moves|Chat|Scores",
      "the bottom nav is six tabs — Rules and Draft have left it (" + bar.labels.join("|") + ")");
    ok(bar.links === 0, "…and no link is left behind in the bar (" + bar.links + ")");
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
    // RESTAGED 2026-08-09 (item 16): there is no Draft tab to find on desktop any more. The
    // desktop bar is the same six buttons, and nothing else.
    const deskBar = await page.evaluate(() => ({
      n: document.querySelectorAll(".bnav button").length, links: document.querySelectorAll(".bnav a").length,
    }));
    ok(deskBar.n === 6 && deskBar.links === 0, "desktop carries the same six tabs and no stray link (" + JSON.stringify(deskBar) + ")");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }
  {
    // RESTAGED 2026-08-09 (item 16): this used to be "the 8th tab must not clip any label",
    // and it was the known pre-existing failure — eight entries in one 390px row clipped DRAFT
    // to "DR". Dropping Rules and Draft is what fixes it, so the same measurement is kept and
    // the budget it defends is now genuinely met rather than tolerated.
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    const clipped = await page.evaluate(() => [...document.querySelectorAll(".bnav button, .bnav .bnavlink")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent.trim()));
    // NOTE: this passes at eight tabs in the harness too — the DRAFT -> "DR" clipping the user
    // reported is a real-device rendering difference this headless font does not reproduce. So
    // it is a regression invariant, not evidence that item 16 fixed anything; the width figure
    // printed below is the honest measure of how much room six tabs bought.
    ok(clipped.length === 0, "no clipped nav labels at 390px with six tabs (" + JSON.stringify(clipped) + ")");
    const targets = await page.$$eval(".bnav button, .bnav .bnavlink", (els) => els.map((el) => el.getBoundingClientRect().height));
    ok(targets.every((h) => h >= 44), "every nav tab keeps a ≥44px touch target (" + targets.join(",") + ")");
    const widths = await page.$$eval(".bnav button", (els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
    console.log("    · measured per-tab width at 390px: " + widths.join("/") + "px");
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
    // chips) / chat (real user messages — sys posts are filtered out since item 15) / rules
    // (view AND edit mode) / both
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

      // A real claim + a real waiver process — exercises the genuine tx-log sentence AND
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
      // RESTAGED 2026-08-09 (item 15): chat renders USER messages only now, so the sys-posted
      // waiver announcement this sweep used to cover is deliberately not on screen. The
      // app-authored sentence it was covering for — the waiver tx-log line — is swept on the
      // Moves page immediately above, which is where that text now lives.
      await sweep(page, "chat (user messages only — sys posts are filtered out)");

      // RESTAGED 2026-08-09 (item 16): Rules has no tab any more; it is reached from the
      // League page, through the REAL affordance rather than by calling UI.show directly.
      await clickIn(page, '.bnav button[data-v="league"]');
      // waitOr, not waitForSelector: whether the link EXISTS is section AE's assertion, and a
      // navigation helper in an unrelated sweep must report rather than abort the whole run
      // (which is exactly what a pre-fix verification needs it not to do).
      await waitOr(page, "#lnkRules", 9000);
      await clickIn(page, "#lnkRules");
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
    await clickChildIn(page, ".lrow", ".lswap", "I. Injured"); // RESTAGED (2026-08-08) — see section E's own note
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
    await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "load" });
    await page.waitForSelector(".mucard", { timeout: 20000 });
    const ms = Date.now() - t0;
    ok(ms < BUDGET_MS, "cold nav-to-league-home-painted under a " + SLOW_MS + "ms/call fake cloud stays under the " + BUDGET_MS + "ms budget (" + ms + "ms — a 12-call serial chain would need " + (12 * SLOW_MS) + "ms+)");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }

  // ---- W2: PERF REGRESSION FIX (2026-08-08) — the live site went laggy right after the
  // "test-mode phases + projections + stats card" merge. Root cause, found by tracing every
  // new caller of D.weekStats (Sleeper's archived per-week endpoint, a WHOLE-LEAGUE payload):
  // D.gameLog (the player stats card, reachable from any player row anywhere — matchup/
  // locker/FA/trade picker/claims) called it ONCE PER FINALIZED WEEK with ZERO caching and
  // ZERO in-flight dedupe. A season with N finalized weeks fired N fresh multi-hundred-KB
  // fetches EVERY SINGLE TIME any stats card was opened — a curious user tapping through 3-4
  // players re-downloaded the entire season's archive 3-4 times over, saturating the browser's
  // connection pool to api.sleeper.app and starving the live-poll's own ESPN/Sleeper requests
  // in the process. That's what "taking a long time to load anything" actually was — it read
  // as a whole-page slowdown, not an isolated stats-card one, because the connection pool is
  // shared. Everything ELSE in that commit (the sandbox's clock phases and its always-on
  // projections — both since removed with the sandbox itself) was gated behind that sandbox's
  // own flag and made zero real-league network calls — confirmed by the boot-hygiene check
  // below, which still stands on its own.
  // FIX (lg-data.js): D.weekStats now caches its resolved Map per (season,seasonType,week)
  // indefinitely — a finalized week's archived stats never change once Sleeper publishes them
  // — with an in-flight-promise dedupe for concurrent callers of the same not-yet-cached week.
  // D.gameLog needed no changes at all: it already just calls D.weekStats per week, so it
  // inherits the cache for free. A NEW D.S.loopStarts counter (incremented only where D.start()
  // actually arms a fresh loop, past its own `if (D.S.running) return` guard) makes the poll
  // loop's single-instance behavior provable rather than merely argued from reading the code —
  // traced and found NOT to be stacking (D.start() is called from exactly one place, startData(),
  // itself called exactly once per successful UI.boot()), but the coordinator asked for a suite
  // counter and this is the direct, minimal one.
  section("W2 · perf regression fix — archived week-stats caching/dedupe, boot hygiene, poll-loop non-stacking");
  {
    // Group 1: opening the SAME and then a DIFFERENT player's stats card reuses the cache —
    // this is the exact shape of the reported regression. seedWithWeeklyHistory() finalizes
    // weeks 1-4 (see its own header comment for the hand-computed P. Passer numbers), so
    // D.gameLog has 4 real archived weeks to fetch.
    const { ctx, page, errors } = await newTestPage(browser, seedWithWeeklyHistory());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    const callCounts = () => page.evaluate(() => {
      const D = window.__GFFL__.D;
      const out = {};
      for (let w = 1; w <= 4; w++) { const ep = D.EP["sleeper week stats " + w]; out[w] = ep ? ep.n : 0; }
      return out;
    });
    await page.evaluate(() => window.__GFFL__.UI.openPlayerCard("3915511")); // P. Passer
    await page.waitForSelector(".pccard .pclog", { timeout: 5000 });
    const after1 = await callCounts();
    ok(after1[1] === 1 && after1[2] === 1 && after1[3] === 1 && after1[4] === 1,
      "opening one player's stats card fetches each finalized week's archived stats exactly ONCE (" + JSON.stringify(after1) + ")");
    await page.evaluate(() => window.__GFFL__.UI.closePlayerCard());
    await page.evaluate(() => window.__GFFL__.UI.openPlayerCard("222111")); // Q. Rival — a DIFFERENT player
    await page.waitForSelector(".pccard .pclog", { timeout: 5000 });
    const after2 = await callCounts();
    ok(after2[1] === 1 && after2[2] === 1 && after2[3] === 1 && after2[4] === 1,
      "…and opening a SECOND, DIFFERENT player's card reuses the cache — still exactly 1 fetch per week, not 2 (" + JSON.stringify(after2) + ")");
    await page.evaluate(() => window.__GFFL__.UI.closePlayerCard());
    await page.evaluate(() => window.__GFFL__.UI.openPlayerCard("3915511")); // re-open the FIRST player again
    await page.waitForSelector(".pccard .pclog", { timeout: 5000 });
    const after3 = await callCounts();
    ok(after3[3] === 1, "re-opening the first player's card a second time still fires zero new fetches (week 3's call count stays 1, " + after3[3] + ")");
    ok(errors.length === 0, "0 page errors through the repeated stats-card-open flow");
    await ctx.close();
  }
  {
    // Group 2: TWO gameLog() calls fired at the exact same tick, before either's cache is
    // warm — without in-flight dedupe each would fire its own parallel fetch per week.
    const { ctx, page, errors } = await newTestPage(browser, seedWithWeeklyHistory());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    const result = await page.evaluate(async () => {
      const D = window.__GFFL__.D;
      D._weekStatsCache.clear(); D._weekStatsInFlight.clear();
      for (const k of Object.keys(D.EP)) if (k.startsWith("sleeper week stats ")) delete D.EP[k];
      await Promise.all([D.gameLog("3915511"), D.gameLog("222111")]);
      const out = {};
      for (let w = 1; w <= 4; w++) { const ep = D.EP["sleeper week stats " + w]; out[w] = ep ? ep.n : 0; }
      return out;
    });
    ok(result[1] === 1 && result[2] === 1 && result[3] === 1 && result[4] === 1,
      "two CONCURRENT gameLog() calls (before either's cache is warm) share ONE in-flight fetch per week, not two (" + JSON.stringify(result) + ")");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }
  {
    // Group 3: boot hygiene — an ordinary real-season session (no stats card ever opened, and
    // never visiting Moves) makes ZERO archived per-week-stats fetches, across a spread of
    // ordinary views. This is the "what does the existing boot-budget check NOT intercept" gap
    // the coordinator flagged — section W's own budget test aborts every non-BASE request
    // uniformly, so it can't tell "made 0 Sleeper archived calls" from "made 20"; this section
    // actually counts them.
    // RESTAGED (2026-08-08, same session, right after this section was written): the Moves
    // page's FA/players table was reworked into the ESPN-style sortable stats table below —
    // its FPTS/AVG/LAST columns are SEASON stats, so visiting Moves now legitimately fetches
    // each finalized week's archived line ONCE (governed by the exact same D.weekStats cache
    // Group 1/2 above already prove). That's intended, lazy, bounded behavior, not a
    // regression — so Moves moved OUT of this "must stay at zero" check and into its own
    // "fetches exactly once per week, and never again on a second visit" assertion right
    // after it, keeping BOTH properties independently provable.
    const { ctx, page, errors } = await newTestPage(browser, seedWithWeeklyHistory());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);
    await page.evaluate(() => window.__GFFL__.UI.show("league"));
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await page.evaluate(() => window.__GFFL__.UI.show("scores"));
    await page.waitForFunction(() => document.body.textContent.includes("NFL this week"), { timeout: 9000 });
    await page.evaluate(() => window.__GFFL__.UI.show("matchup"));
    await page.waitForSelector(".muhead", { timeout: 9000 });
    const archivedCalls = await page.evaluate(() => {
      const D = window.__GFFL__.D;
      return Object.keys(D.EP).filter((k) => k.startsWith("sleeper week stats ")).map((k) => [k, D.EP[k].n]);
    });
    ok(archivedCalls.length === 0, "boot + League/Scores/Matchup navigation makes ZERO archived per-week-stats fetches without ever visiting Moves or opening a stats card (" + JSON.stringify(archivedCalls) + ")");
    // NOW visit Moves — the sortable table's season columns fetch each finalized week ONCE
    // (not once per row, not once per player), exactly as the FA-table's own lazy-batch
    // design promises.
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForFunction(() => document.body.textContent.includes("Waivers"), { timeout: 9000 });
    await page.waitForFunction(() => {
      const D = window.__GFFL__.D;
      return D.EP["sleeper week stats 4"] && D.EP["sleeper week stats 4"].n >= 1;
    }, { timeout: 9000 });
    const afterMoves = await page.evaluate(() => {
      const D = window.__GFFL__.D;
      const out = {};
      for (let w = 1; w <= 4; w++) { const ep = D.EP["sleeper week stats " + w]; out[w] = ep ? ep.n : 0; }
      return out;
    });
    ok(afterMoves[1] === 1 && afterMoves[2] === 1 && afterMoves[3] === 1 && afterMoves[4] === 1,
      "…visiting Moves once fetches each finalized week's archived stats exactly once, for the FA table's own season columns (" + JSON.stringify(afterMoves) + ")");
    // A SECOND visit to Moves must not re-fetch anything — same cache, same session.
    await page.evaluate(() => window.__GFFL__.UI.show("league"));
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForFunction(() => document.body.textContent.includes("Waivers"), { timeout: 9000 });
    await sleep(150); // let any (unwanted) re-fetch have a moment to fire before asserting its absence
    const afterMoves2 = await page.evaluate(() => {
      const D = window.__GFFL__.D; const ep = D.EP["sleeper week stats 2"]; return ep ? ep.n : 0;
    });
    ok(afterMoves2 === 1, "…and re-visiting Moves a second time fetches nothing new (week 2's call count stays 1, " + afterMoves2 + ")");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }
  {
    // Group 4: the main poll loop is armed AT MOST ONCE — D.S.loopStarts (see D.start()'s own
    // comment) proves it directly rather than arguing it from reading D.start's guard clause.
    // Deliberately does NOT call waitLive() here — that helper stops the real loop for test
    // determinism, which would defeat the point of watching it stay single-instance.
    const { ctx, page, errors } = await newTestPage(browser, fullSeed());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const startsAfterBoot = await page.evaluate(() => window.__GFFL__.D.S.loopStarts);
    ok(startsAfterBoot === 1, "the main poll loop is armed exactly once after boot (D.S.loopStarts=" + startsAfterBoot + ")");
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.__GFFL__.UI.show("scores"));
      await page.waitForFunction(() => document.body.textContent.includes("NFL this week"), { timeout: 9000 });
      await page.evaluate(() => window.__GFFL__.UI.show("chat"));
      await page.waitForSelector("#chatText", { timeout: 9000 });
      await page.evaluate(() => window.__GFFL__.UI.show("moves"));
      await page.waitForFunction(() => document.body.textContent.includes("Waivers"), { timeout: 9000 });
      await page.evaluate(() => window.__GFFL__.UI.show("league"));
      await page.waitForSelector(".mucard", { timeout: 9000 });
    }
    const startsAfterNav = await page.evaluate(() => window.__GFFL__.D.S.loopStarts);
    ok(startsAfterNav === 1, "…and stays at exactly 1 after repeated navigation across Scores/Chat/Moves/League (" + startsAfterNav + ")");
    // A second full UI.boot() (a real, if rare, path — e.g. re-entering the claim flow) must
    // not stack a second loop either — D.start()'s own `if (D.S.running) return;` guard.
    await page.evaluate(() => window.__GFFL__.UI.boot());
    await page.waitForSelector(".mucard", { timeout: 9000 });
    const startsAfterReboot = await page.evaluate(() => window.__GFFL__.D.S.loopStarts);
    ok(startsAfterReboot === 1, "…and a second full UI.boot() call doesn't stack a second poll loop either (" + startsAfterReboot + ")");
    ok(errors.length === 0, "0 page errors through the navigation/reboot flow");
    await ctx.close();
  }

  // SECTIONS X + X2 DELETED 2026-08-08 (the 2025 season replay). They tested the
  // commissioner-gated "_t25" sandbox — a separate doc collection with its own switchable
  // clock — which is GONE: the app itself now runs as week 1 of the real 2025 season. Its
  // replacement is the NEW section X below (after Z), written against what actually ships.

  // ---------------- Y: player stats card + Moves MOVE-button split (2026-08-08) ----------------
  section("Y · player stats card — matchup/locker/FA/trade-builder/claims, MOVE button, swap, Escape/backdrop");
  {
    const { ctx, page, errors } = await newTestPage(browser, seedWithWeeklyHistory());
    await bootPage(page);
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await waitLive(page);

    // ---- Y1: opens from a MATCHUP lineup row, HOME side, with hand-checked numbers ----
    await clickIn(page, ".mucard.mine");
    await page.waitForSelector(".muhead", { timeout: 9000 });
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".pcellgrid[data-pk]")].find((e) => e.textContent.includes("P. Passer"));
      el.click();
    });
    await page.waitForSelector(".pccard .pcname", { timeout: 5000 });
    const y1 = await page.evaluate(() => ({
      name: document.querySelector(".pcname").textContent,
      pos: document.querySelector(".posbadge").textContent,
      team: document.querySelector(".pcmeta .mut").textContent,
      weekPts: document.querySelector(".pcweekrow .pts").textContent,
      weekMuts: [...document.querySelectorAll(".pcweekrow .mut")].map((e) => e.textContent),
      tiles: [...document.querySelectorAll(".pctileval")].map((e) => e.textContent),
      rows: [...document.querySelectorAll(".pclog tbody tr")].map((tr) => tr.textContent.replace(/\s+/g, " ").trim()),
    }));
    ok(y1.name === "P. Passer", "matchup lineup row opens the stats card for the tapped player (" + y1.name + ")");
    ok(y1.pos === "QB" && y1.team === "PHI", "position + team render (" + y1.pos + "/" + y1.team + ")");
    ok(y1.weekPts === "10.0", "this-week points match the live ESPN feed — section D's own hand-check (" + y1.weekPts + ")");
    ok(/proj —/.test(y1.weekMuts[0]), "no Sleeper projection on file for this player -> an honest —, never a fabricated number (" + y1.weekMuts[0] + ")");
    ok(/Live — Q2 5:00/.test(y1.weekMuts[1] || ""), "…and the live game clock renders too (" + JSON.stringify(y1.weekMuts) + ")");
    ok(y1.tiles.join("|") === "41.0|10.3|20.0", "season total/avg/best, hand-computed from the 4 seeded finalized weeks (10+10+20+1=41, /4=10.25→\"10.3\", best 20) (" + y1.tiles.join("|") + ")");
    ok(y1.rows.length === 4, "4 finalized weeks in the game log (" + y1.rows.length + ")");
    ok(/Wk 4.*1\.0/.test(y1.rows[0]) && /Wk 3.*20\.0/.test(y1.rows[1]) && /Wk 2.*10\.0/.test(y1.rows[2]) && /Wk 1.*10\.0/.test(y1.rows[3]),
      "newest week first, every figure matching the seeded per-week Sleeper fixture exactly (wk4=25yd=1.0, wk3=300yd/2TD=20.0, wk1-2 generic=10.0) (" + JSON.stringify(y1.rows) + ")");
    ok(/Wk 1.*vs DAL/.test(y1.rows[3]), "week 1 is genuinely the live engine's own current week here, so PHI's real opponent IS known (\"vs DAL\") (" + y1.rows[3] + ")");
    ok(/Wk 2.*—/.test(y1.rows[2]) && /Wk 3.*—/.test(y1.rows[1]) && /Wk 4.*—/.test(y1.rows[0]),
      "every OTHER week honestly reads — for opponent — this app tracks no historical NFL schedule, so nothing is fabricated (" + JSON.stringify(y1.rows) + ")");

    // Escape closes it.
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("playerCard").hidden, { timeout: 3000 });
    ok(true, "Escape closes the card");

    // Backdrop click closes it; a tap on the card's own content does not.
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".pcellgrid[data-pk]")].find((e) => e.textContent.includes("P. Passer"));
      el.click();
    });
    await page.waitForSelector(".pccard .pcname", { timeout: 5000 });
    await page.evaluate(() => document.querySelector(".pcweek").click());
    ok((await page.evaluate(() => !document.getElementById("playerCard").hidden)), "a tap on the card's own content does not close it");
    await page.evaluate(() => document.getElementById("playerCard").click());
    ok((await page.evaluate(() => document.getElementById("playerCard").hidden)), "a tap on the backdrop itself closes it");

    // ---- AWAY side too (item 1's "matchup lineup rows both sides") ----
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".pcellgrid[data-pk]")].find((e) => e.textContent.includes("Q. Rival"));
      el.click();
    });
    await page.waitForSelector(".pccard .pcname", { timeout: 5000 });
    ok((await text(page, ".pcname")) === "Q. Rival", "the AWAY side's own half-cells open the card too");
    await page.evaluate(() => window.__GFFL__.UI.closePlayerCard());

    // ---- Y2: LOCKER — owner's own editable lineup (.linfo = stats, .lswap = swap, unchanged) ----
    await page.evaluate(() => window.__GFFL__.UI.show("team"));
    await page.waitForSelector(".lrow", { timeout: 9000 });
    await clickChildIn(page, ".lrow", ".linfo", "T. Tight");
    await page.waitForSelector(".pccard .pcname", { timeout: 5000 });
    ok((await text(page, ".pcname")) === "T. Tight", "the owner's own lineup row opens the stats card via its .linfo area");
    await page.evaluate(() => window.__GFFL__.UI.closePlayerCard());
    // A tap on the bare row (its slot-chip, neither child button) opens nothing at all — the
    // row itself carries no click behavior any more, only its two real buttons do.
    await page.evaluate(() => {
      const row = [...document.querySelectorAll(".lrow")].find((r) => r.textContent.includes("T. Tight"));
      row.querySelector(".slotchip").click();
    });
    const nothingOpened = await page.evaluate(() => document.getElementById("playerCard").hidden && document.getElementById("swapSheet").hidden);
    ok(nothingOpened, "row-click no longer triggers anything — only .linfo (stats) and .lswap (swap) do");
    // Swap still works — the affordance moved to its own button, it didn't disappear.
    await clickChildIn(page, ".lrow", ".lswap", "F. Flexman");
    await page.waitForSelector("#swapSheet .swaprow", { timeout: 5000 });
    ok((await page.$$eval("#swapSheet .swaprow", (els) => els.length)) > 0, "the .lswap button still opens the swap sheet, unchanged");
    await page.evaluate(() => { document.getElementById("swapSheet").hidden = true; });

    // ---- non-owner locker (read-only roster table — item 1's "locker/My-Team roster rows") ----
    await page.evaluate(() => window.__GFFL__.UI.openLocker(2));
    await page.waitForSelector("tr[data-pk]", { timeout: 9000 });
    ok((await page.$$eval("tr[data-pk]", (els) => els.length)) === 3, "every roster row on a non-owner's read-only locker carries data-pk (3 players)");
    await clickIn(page, "tr[data-pk]", "Q. Rival");
    await page.waitForSelector(".pccard .pcname", { timeout: 5000 });
    ok((await text(page, ".pcname")) === "Q. Rival", "a non-owner's read-only roster row opens the stats card too");
    await page.evaluate(() => window.__GFFL__.UI.closePlayerCard());

    // ---- Y3: Moves FA table — row = stats, an explicit accent-outlined MOVE button = add/claim ----
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForSelector("#faPosChips", { timeout: 9000 });
    await page.waitForFunction(() => document.querySelectorAll("#faResults [data-fi]").length > 0, { timeout: 5000 });
    await clickIn(page, "#faResults [data-fi]", "F. Agent"); // the WHOLE row, deliberately not the button
    await page.waitForSelector(".pccard .pcname", { timeout: 5000 });
    ok((await text(page, ".pcname")) === "F. Agent", "tapping an FA row (not its MOVE button) opens the stats card");
    ok((await page.evaluate(() => document.getElementById("claimSheet").hidden)), "…and row-click no longer triggers the add/claim flow");
    await page.evaluate(() => window.__GFFL__.UI.closePlayerCard());
    const moveBtnStyle = await page.$eval(".faMoveBtn", (b) => getComputedStyle(b).borderColor);
    ok(moveBtnStyle === "rgb(213, 10, 10)", "the MOVE button is accent-outlined (--accent #d50a0a), distinct from an ordinary button's --border-card outline (" + moveBtnStyle + ")");
    await clickChildIn(page, "#faResults [data-fi]", ".faMoveBtn", "F. Agent");
    await page.waitForSelector("#claimSheet [data-di]", { timeout: 5000 });
    ok(/Claim F\. Agent/.test(await page.$eval("#claimSheet", (e) => e.textContent)), "the MOVE button still opens the claim/add flow, exactly as before");
    await clickIn(page, "#claimCancel");

    // ---- Y4: trade builder — a pick chip's own row opens stats; .pcpick still does the picking ----
    // RESTAGED (2026-08-09, ITEM 20): the side starts collapsed, so the picker has to be
    // opened first; and a picked player LEAVES the picker for the selection strip above it,
    // so "did picking work" is now read off .tradesel rather than off a class on a chip that
    // has deliberately moved. The two behaviours under test are unchanged.
    await waitOr(page, "#mvGive .tradeadd"); // tolerant, same reason as J1 above
    await openTradeSideOr(page, "give");
    await clickChildIn(page, "#mvGive .pickchip", ".pcinfo", "B. Backup");
    await page.waitForSelector(".pccard .pcname", { timeout: 5000 });
    ok((await text(page, ".pcname")) === "B. Backup", "a trade-builder pick chip's .pcinfo opens the stats card (item 1's \"roster pickers\")");
    ok(!(await page.evaluate(() => !!document.querySelector('#mvGive .tradesel .tradechip[data-gk="111333"]'))),
      "…and merely viewing it did NOT also pick it for the trade");
    await page.evaluate(() => window.__GFFL__.UI.closePlayerCard());
    await clickChildIn(page, "#mvGive .pickchip", ".pcpick", "B. Backup");
    ok(await page.evaluate(() => !!document.querySelector('#mvGive .tradesel .tradechip[data-gk="111333"]')),
      "…while its own .pcpick button still does the picking, unchanged");

    // ---- Y5: "My pending" claims list — the player name is its own tappable stats link ----
    await page.evaluate(async () => {
      const LG = window.__GFFL__.LG;
      await LG.addClaim(1, { id: "yclaim", teamId: 1, addKey: "dst_KC", addName: "KC D/ST", addPos: "DST", addTeam: "KC", dropKey: "111777", dropName: "H. Healthy", bid: 5, t: 1 });
    });
    await page.evaluate(() => window.__GFFL__.UI.show("moves"));
    await page.waitForFunction(() => (document.querySelector("#mvMyClaims") || {}).textContent.includes("KC D/ST"), { timeout: 5000 });
    await clickIn(page, "#mvMyClaims .pcinline", "KC D/ST");
    await page.waitForSelector(".pccard .pcname", { timeout: 5000 });
    ok((await text(page, ".pcname")) === "KC D/ST", "a pending claim's player name (.pcinline) opens the stats card (item 1's \"claims list\")");
    ok(!!(await page.$("#mvMyClaims .mvcancel")), "…and its Cancel button is still the same untouched button");
    await page.evaluate(() => window.__GFFL__.UI.closePlayerCard());

    ok(errors.length === 0, "0 page errors through the whole player-card + MOVE-button + swap + trade-picker + claims flow");
    if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_playercard_390.png"), fullPage: true }); console.log("  📸 shots/gffl_playercard_390.png"); }
    await ctx.close();
  }


  // ---- Z: THE LIVE EMPTY-LEAGUE BUG (2026-08-08) --------------------------------------
  // The user's deployed site showed the first-run "Import the league from ESPN" card against
  // a Firestore collection with EIGHT teams in it — and the import then "wasn't working".
  //
  // ROOT CAUSE: nothing distinguished "the league store said there are no teams" from "we
  // never actually heard back from the league store". Two ways to land on a silent empty read,
  // both ending in LG.teams.length === 0 and therefore in the first-run card:
  //   1. the Firebase import / initializeFirestore / the reachability probe throws (blocked
  //      gstatic, an extension, an offline first paint) -> lg-core silently drops to the LOCAL
  //      backend, and a cold device's localStorage holds no league docs at all;
  //   2. cloud mode, but Firestore answered the QUERY out of an empty offline cache — getDocs()
  //      falls back to the cache and, unlike getDoc(), NEVER rejects for a cache miss: an empty
  //      cold cache is indistinguishable from "a query with zero results".
  // Same lesson index.html learned twice with the goat herd: emptiness must be SERVER-CONFIRMED
  // before any "let's set this up from scratch" UI is offered.
  //
  // Every check in this section FAILS against the pre-fix code (verified by stashing the three
  // app files back to HEAD and re-running: 20 of these fail, and the pre-fix run shows the
  // first-run card in all three unconfirmed configurations).
  section("Z · live bug — an EMPTY league is only ever the league's own answer");
  {
    const bigCloud = () => {
      const d = { ...fullSeed().docs };
      return d;
    };

    // ---- Z1: COLD CLOUD BOOT — data in the cloud, NOTHING in local storage.
    // The exact shape of the user's device: the league is in Firestore, this browser has never
    // seen it. Must show the loading state, then the real league — never the first-run card,
    // not even for one frame.
    {
      const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: 1, who: "Peter" });
      // A REAL per-call latency, and the sampler starts at domcontentloaded (not load) —
      // with an instant backend, or a sampler that starts after the page has finished loading,
      // the whole cold-read window is already over by the first sample and the loading frame
      // is missed. 250ms/call over boot's own read batches keeps it open for ~1s.
      await armFakeCloud(page, bigCloud(), { delayMs: 250 });
      const seen = [];
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "domcontentloaded" });
      // Sample the screen while the (slow) cold reads are still in flight — the first-run card
      // appearing for even one frame here is the live bug.
      for (let i = 0; i < 90; i++) {
        const s = await page.evaluate(() => ({
          first: !!document.querySelector("#firstImport"),
          off: !!document.querySelector("#offlineRetry"),
          mu: !!document.querySelector(".mucard"),
          // The placeholder is league.html's own #main markup. Reading body.textContent and
          // slicing it does NOT work here — the sticky header + the 8-entry nav contribute ~60
          // characters of their own BEFORE #main's text starts, so a short slice never reaches
          // it (test bug, caught by this check failing while the page was demonstrably correct).
          loading: /Loading the league/.test((document.querySelector("#main") || {}).textContent || ""),
        })).catch(() => null);
        if (s) seen.push(s);
        if (s && s.mu) break;
        await sleep(25);
      }
      ok(seen.some((s) => !s.mu && s.loading), "cold cloud boot shows a loading state while the first real read is in flight");
      ok(!seen.some((s) => s.first), "…and NEVER the first-run \"Import from ESPN\" card, not for a single frame (THE live bug)");
      ok(!seen.some((s) => s.off), "…and never the offline card either — the backend was reachable all along");
      ok(await waitOr(page, ".mucard", 15000) && (await page.$$eval(".mucard", (e) => e.length)) === 4, "…and lands on the real league home, all 4 week-1 matchups");
      const st = await page.evaluate(() => ({ n: window.__GFFL__.LG.teams.length, conf: window.__GFFL__.LG.teamsConfirmed, deg: window.__GFFL__.LG.backendDegraded }));
      ok(st.n === 8 && st.conf === true && st.deg === false, "…with all 8 teams read from the cloud and the read marked confirmed");
      ok(errors.length === 0, "0 page errors on a cold cloud boot");
      await ctx.close();
    }

    // ---- Z2: THE BUG ITSELF — cloud unreachable (silent local fallback), nothing local.
    // Pre-fix this is the first-run card. It must be an honest outage card instead.
    {
      const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: 1, who: "Peter" });
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      ok(await waitOr(page, "#offlineRetry"), "cloud unreachable + nothing cached locally -> the honest \"couldn't reach the league\" card");
      ok(!(await page.$("#firstImport")), "…and NOT the first-run import card (THE live bug: a league with 8 teams in Firestore was told it didn't exist)");
      const body = await page.evaluate(() => document.body.textContent);
      ok(/Couldn't reach the league/.test(body), "…says what actually happened");
      ok(/still there/.test(body), "…and says the league is still there, so nobody re-imports over it");
      ok(!/isn't set up yet/.test(body), "…never claims the league isn't set up");
      const flags = await page.evaluate(() => ({ deg: window.__GFFL__.LG.backendDegraded, conf: window.__GFFL__.LG.teamsConfirmed, err: window.__GFFL__.LG.backendError }));
      ok(flags.deg === true && flags.conf === false, "LG.backendDegraded true / LG.teamsConfirmed false — the app knows it never heard back");
      ok(typeof flags.err === "string" && flags.err.length > 0, "…and records the reason verbatim, so the next report identifies itself");
      ok(await page.evaluate(() => document.querySelector("#bnav").hidden === true || getComputedStyle(document.querySelector("#bnav")).display === "none"),
        "…with the nav hidden — there is no usable app behind this screen");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- Z3: RETRY recovers in place — the card's one useful action really works.
    {
      const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: 1, who: "Peter" });
      // A cloud that is armed but REFUSING every read, exactly like a dead connection.
      await armFakeCloud(page, bigCloud(), { fail: true });
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      ok(await waitOr(page, "#offlineRetry"), "a reachable-then-broken backend also lands on the outage card, not first-run");
      ok(!(await page.$("#firstImport")), "…still never the first-run card");
      // Retry while STILL broken: honest failure, card stays, button comes back.
      await page.evaluate(() => { const b = document.querySelector("#offlineRetry"); if (b) b.click(); });
      await sleep(400);
      ok(!!(await page.$("#offlineRetry")) && !(await page.$("#firstImport")),
        "Retry while still offline keeps the outage card (and still never falls through to first-run)");
      // Now let the cloud answer, and retry for real.
      await page.evaluate(() => { window.__fakeCloudFail = false; });
      await page.evaluate(() => { const b = document.querySelector("#offlineRetry"); if (b) b.click(); });
      ok(await waitOr(page, ".mucard", 15000) && (await page.$$eval(".mucard", (e) => e.length)) === 4, "Retry once the connection is back re-boots straight into the real league");
      ok((await page.evaluate(() => window.__GFFL__.LG.teams.length)) === 8, "…with all 8 teams");
      ok(errors.length === 0, "0 page errors through the retry cycle");
      await ctx.close();
    }

    // ---- Z4: a CONFIRMED-empty backend still shows first run (the fix must not break setup).
    {
      const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: null, who: null });
      await armFakeCloud(page, {});
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      ok(await waitOr(page, "#firstImport"), "a backend that CONFIRMS zero teams still offers the first-run setup card");
      ok(!(await page.$("#offlineRetry")), "…and not the outage card");
      ok((await page.evaluate(() => window.__GFFL__.LG.teamsConfirmed)) === true, "…because the empty read was confirmed");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- Z5: a confirmed backend WITH teams can never reach first run, whatever the hash.
    {
      for (const hash of ["", "#moves", "#rules", "#chat"]) {
        const { ctx, page } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: 1, who: "Peter" });
        await armFakeCloud(page, bigCloud());
        await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF + hash, { waitUntil: "networkidle0" });
        await page.waitForFunction(() => window.__GFFL__ && window.__GFFL__.LG.teams.length === 8, { timeout: 12000 }).catch(() => {});
        await sleep(250);
        ok(!(await page.$("#firstImport")), "backend has teams -> first-run unreachable via " + (hash || "(no hash)"));
        await ctx.close();
      }
    }

    // ---- Z6: knownAbsent must not derive "this doc doesn't exist" from a degraded snapshot.
    // The negative-absence shortcut answers get() straight from a cached list(). A list taken
    // while the cloud was unreachable can be an empty offline-cache answer — deriving absence
    // from it would make every doc of that kind read as missing for the life of the tab.
    {
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      const r = await page.evaluate(async () => {
        const LG = window.__GFFL__.LG;
        // A cloud whose list() answers EMPTY (a cold offline cache) while a real doc exists.
        LG.db._installFakeCloud({
          async get(id) { return id === "team_1" ? { kind: "team", teamId: 1, name: "Battle Kreussers" } : null; },
          async set() {}, async del() {},
          async list() { return []; },
          watch(id, cb) { cb(null); return () => {}; },
        });
        await LG.db.list("team");                 // caches an EMPTY snapshot
        const healthy = await LG.db.get("team_1"); // healthy cloud: the empty list is the truth
        LG._markDegraded(new Error("offline"));    // …now the session is known-degraded
        const degraded = await LG.db.get("team_1");
        return { healthy: !!healthy, degraded: !!degraded };
      }).catch(() => ({ healthy: false, degraded: false })); // pre-fix there is no _markDegraded at all
      ok(r.healthy === false, "a CONFIRMED empty list still short-circuits get() to absent (the perf shortcut is intact)");
      ok(r.degraded === true, "…but once the session is degraded, absence is never derived from a cached list — the real backend is asked");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- Z7 DELETED 2026-08-08 (the 2025 season replay). It proved the "_t25" sandbox's
    // collection-suffix namespace round-tripped (stale flag boots the sandbox, exit reads the
    // real league). There is no second collection any more — the replay runs in the REAL one,
    // isolated purely by the season already baked into every per-season doc id — so there is
    // nothing left here to test. The new section X proves the replacement isolation instead.

    // ---- Z8: IMPORT FAILURES ARE VISIBLE (the other half of the live report).
    {
      const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: null, who: null });
      await armFakeCloud(page, {});
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      if (!(await waitOr(page, "#firstImport"))) ok(false, "Z8 staging: the confirmed-empty backend should offer the first-run card");
      await page.evaluate(() => { window.__prompts = ["4321"]; });
      await clickIn(page, "#firstImport");
      if (!(await waitOr(page, "#importApply"))) ok(false, "Z8 staging: the ESPN import preview should render");
      // The APPLY half had no catch at all: a rejected write left the button dead and silent.
      await page.evaluate(() => { window.__fakeCloudFail = true; });
      await clickIn(page, "#importApply");
      let sawFail = true;
      try { await page.waitForFunction(() => /Couldn't save the imported league/.test(document.body.textContent), { timeout: 9000 }); } catch (e) { sawFail = false; }
      ok(sawFail, "a write that fails mid-import says so on screen instead of leaving a dead button");
      ok(!!(await page.$(".card.bad")), "…rendered as a real error card");
      ok(/fake cloud offline/.test(await page.evaluate(() => document.body.textContent)), "…naming the actual reason");
      // …and it recovers: fix the backend, import again for real.
      await page.evaluate(() => { window.__fakeCloudFail = false; window.__prompts = ["Peter"]; });
      await page.evaluate(() => window.__GFFL__.UI.show("rules"));
      await waitOr(page, "#rulesImport");
      await clickIn(page, "#rulesImport");
      await waitOr(page, "#importApply");
      await clickIn(page, "#importApply");
      ok(await waitOr(page, ".teamrow", 12000) && (await page.$$eval(".teamrow", (e) => e.length)) === 8, "…and re-running the import after the connection is back completes normally");
      ok(errors.length === 0, "0 page errors — the failure never reaches the console as an unhandled rejection");
      await ctx.close();
    }

    // ---- Z9: a missing #importOut container can no longer kill the tap silently.
    // Pre-fix every importer opened with `$("#importOut").innerHTML = …` — a TypeError on a
    // null element, an unhandled rejection, and a button that does nothing at all, forever.
    {
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      const r = await page.evaluate(async () => {
        // A view with no #importOut anywhere — exactly what a renamed/absent container looks
        // like to the first-run card's `UI.show("rules"); importFromEspn()` sequence.
        document.querySelector("#main").innerHTML = "<div>no import container here</div>";
        let threw = false;
        try { window.__GFFL__.UI._importFail(null, "boom", new Error("nope")); } catch (e) { threw = true; }
        return { threw };
      });
      ok(r.threw === true, "sanity: importFail() genuinely needs a container (a null one is the pre-fix crash)");
      const src = require("fs").readFileSync(path.join(ROOT, "assets", "league", "lg-ui.js"), "utf8");
      ok(!/const out = \$\("#importOut"\);/.test(src), "no importer reads #importOut directly any more");
      ok(/function importOut\(\)/.test(src) && /appendChild/.test(src.slice(src.indexOf("function importOut()"), src.indexOf("function importOut()") + 400)),
        "…importOut() creates the container when the view doesn't carry one, so it can never return null");
      ok((src.match(/importFail\(/g) || []).length >= 6, "…and every import write path routes its failure through importFail()");
      ok((src.match(/try \{ await importFromEspn\(\); \} catch/g) || []).length === 2,
        "…both taps that start an import (first-run card + Rules page) catch a throw instead of dropping it on the floor");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }
  }


  // ---------------- X: the 2025 week-1 replay (2026-08-08) ----------------
  // The ONLY section that boots WITHOUT the ?sim=0 override — i.e. exactly as the family's own
  // devices will. Everything above runs the real 2026 league; everything here runs the replay.
  section("X · the 2025 week-1 replay — pinned clock, auto-setup, historical slate, projections");
  {
    // 2 teams, deliberately: the ESPN import fixture (rich2025) returns exactly these two, so
    // "every team has a week-1 roster" is genuinely reachable — which is what makes the
    // second-boot no-op and partial-resume checks below mean something.
    const simSeed = (opts) => {
      opts = opts || {};
      const docs = {};
      if (!opts.noTeams) {
        docs.team_1 = { kind: "team", teamId: 1, name: "Battle Kreussers", abbrev: "BK", owner: "" };
        docs.team_2 = { kind: "team", teamId: 2, name: "End Zone Goats", abbrev: "EZG", owner: "" };
      }
      for (const id of Object.keys(opts.extra || {})) docs[id] = opts.extra[id];
      return { docs, pass: "amenfarms", team: opts.noClaim ? null : 1, who: opts.noClaim ? null : "Peter" };
    };
    // The setup card is genuinely fleeting on an instant local backend — it can be gone before
    // a post-navigation query runs. A MutationObserver installed at document-start records
    // whether it was EVER in the DOM, which is the real question ("did the user see a progress
    // card, or did the app stall silently?") and is immune to how fast the run happens to be.
    const watchSetupCard = (page) => page.evaluateOnNewDocument(() => {
      window.__sawSetupCard = false;
      const check = () => { if (document.getElementById("simSetupMsg")) window.__sawSetupCard = true; };
      const arm = () => { check(); new MutationObserver(check).observe(document.body, { childList: true, subtree: true }); };
      if (document.body) arm(); else document.addEventListener("DOMContentLoaded", arm);
    });
    // Deliberately waits only for the hook, NOT for LG.rules: a degraded backend never gets
    // rules at all (boot catches and renders the outage card), and that is a state this section
    // has to be able to boot INTO rather than time out on.
    // RESTAGED 2026-08-08 (the live replay phase): `live` is the shipping DEFAULT now, and its
    // clock RUNS. `q` lets a check pin the phase and/or freeze the clock when what it is really
    // testing is the pre-kickoff presentation or a fixed instant — every such pin is annotated
    // at its own call site with the reason. A bare bootSim() boots exactly as a family device
    // will (live, 8x).
    const bootSim = async (page, q) => {
      await page.goto(BASE + "/league.html?fam=" + FAM + (q || ""), { waitUntil: "networkidle0" });
      await page.waitForFunction(() => !!window.__GFFL__, { timeout: 12000 });
    };
    // The pre-kickoff pin, frozen: what section X was written against before the clock existed.
    const PREPIN = "&simphase=pre&simspeed=0";

    // ---- X1: the flag drives the whole calendar.
    {
      // RESTAGED 2026-08-08: pinned to the `pre` phase with a frozen clock. This block is the
      // "week 1 before kickoff" calendar contract — the exact instant, and free agency already
      // open — which is now one of TWO phases rather than the only one. That the DEFAULT phase
      // is `live`, and that the clock runs, are new checks in section X8 below.
      fixture.rich2025 = true; fixture.simProjReal = false;
      const { ctx, page, errors } = await newTestPage(browser, simSeed());
      await bootSim(page, PREPIN);
      await page.waitForSelector(".mucard", { timeout: 20000 });
      const cal = await page.evaluate(() => {
        const LG = window.__GFFL__.LG;
        const now = LG.now();
        return {
          sim: LG.SIM_2025, season: LG.SEASON, start: LG.SEASON_START,
          now, simNow: LG.SIM_NOW, week: LG.currentWeek(), phase: LG.SIM_PHASE,
          deadline1: LG.waiverDeadline(1),
          iso: new Date(now).toISOString(),
          uiWeek: window.__GFFL__.UI.week,
        };
      });
      ok(cal.sim === true, "LG.SIM_2025 is ON by default — no flag, no URL param, nothing to switch on");
      ok(cal.season === 2025, "…LG.SEASON is 2025 (" + cal.season + ")");
      ok(cal.start === "2025-09-02", "…LG.SEASON_START is the Tuesday before the real Sept-4 opener (" + cal.start + ")");
      ok(cal.phase === "pre", "…?simphase=pre selects the before-kickoff phase (" + cal.phase + ")");
      ok(cal.now === cal.simNow, "…and at SIM_SPEED 0 the clock is frozen on that phase's own instant");
      ok(cal.iso === "2025-09-04T14:00:00.000Z", "…which is Thursday 2025-09-04, 09:00 America/Chicago (" + cal.iso + ")");
      ok(cal.week === 1, "…LG.currentWeek() === 1 (" + cal.week + ")");
      ok(cal.uiWeek === 1, "…and the app opens on week 1 (" + cal.uiWeek + ")");
      ok(cal.deadline1 < cal.now,
        "…week 1's Wednesday-8am waiver deadline is already PAST at the pinned instant, so free agency is OPEN");
      // …and that is what the Moves page actually renders — free agency in force, not the
      // blind-bid regime (proving the deadline arithmetic reaches the UI, not just a hook).
      // RESTAGED 2026-08-09 (ITEM 19): the card's two paragraphs of prose are gone. Which
      // regime is in force is now the "on"/"off" state of two data blocks, so that is what
      // this reads — a stronger check than the sentence was, since it also proves the OTHER
      // block is visibly stood down rather than merely absent.
      await clickIn(page, '.bnav button[data-v="moves"]');
      await waitOr(page, "#mvBlkFa", 12000); // tolerant, so a pre-fix run reports rather than aborts
      const regime = (await evalOr(page, () => ({
        fa: document.querySelector("#mvBlkFa").className,
        faVal: document.querySelector("#mvBlkFa .mvbval").textContent.trim(),
        wv: document.querySelector("#mvBlkWaiver").className,
        prose: /Claims process Wed|first come, first served\./.test(document.body.textContent),
      }))) || { fa: "", wv: "", prose: true };
      ok(/\bon\b/.test(regime.fa) && regime.faVal === "Open" && /\boff\b/.test(regime.wv),
        "…and the Moves page really renders it: the Free agency block is the one in force, Waivers is stood down (" + JSON.stringify(regime) + ")");
      ok(!regime.prose, "…with neither of the old prose paragraphs anywhere on the page");
      ok(errors.length === 0, "0 page errors on the replay's own boot");
      await ctx.close();
    }

    // ---- X1b: ?sim=0 reverts everything, one param, nothing persisted.
    {
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page); // bootPage carries SIMOFF
      const off = await page.evaluate(() => {
        const LG = window.__GFFL__.LG;
        return { sim: LG.SIM_2025, season: LG.SEASON, start: LG.SEASON_START, drift: Math.abs(LG.now() - Date.now()) };
      });
      ok(off.sim === false && off.season === 2026 && off.start === "2026-09-08",
        "?sim=0 reverts season + season start together (" + off.season + " / " + off.start + ")");
      ok(off.drift < 5000, "…and LG.now() is the real wall clock again");
      const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => /sim/i.test(k)));
      ok(stored.length === 0, "…the override persists NOTHING — no device can get stuck in the wrong season");
      ok(errors.length === 0, "0 page errors with the replay off");
      await ctx.close();
    }

    // ---- X2: auto-setup, zero taps — teams present, rosters absent.
    let simDocsAfterSetup = null;
    {
      fixture.rich2025 = true;
      const { ctx, page, errors } = await newTestPage(browser, simSeed());
      await watchSetupCard(page);
      await bootSim(page);
      ok(await waitOr(page, ".mucard", 20000), "the replay seeds itself and lands on the real league home, with no taps at any point");
      ok(await page.evaluate(() => window.__sawSetupCard === true), "…behind a visible progress card while it ran — never a silent stall");
      ok(await page.evaluate(() => window.__GFFL__.UI._simSetupDone === true), "…and the setup genuinely ran (it wasn't already seeded)");
      const wrote = await page.evaluate(() => {
        const LG = window.__GFFL__.LG;
        return {
          r1: !!(localStorage.getItem("lg_gffl_test1_roster_2025_w1_t1")),
          r2: !!(localStorage.getItem("lg_gffl_test1_roster_2025_w1_t2")),
          sched: JSON.parse(localStorage.getItem("lg_gffl_test1_sched_2025") || "null"),
          n1: (JSON.parse(localStorage.getItem("lg_gffl_test1_roster_2025_w1_t1") || "{}").players || []).length,
          old2026: localStorage.getItem("lg_gffl_test1_roster_2026_w1_t1"),
          season: LG.SEASON,
        };
      });
      ok(wrote.r1 && wrote.r2, "…week-1 2025 roster docs written for every team");
      ok(wrote.n1 === 8, "…team 1's roster carries all 8 imported players — post-draft, as if the draft just finished (" + wrote.n1 + ")");
      ok(wrote.sched && wrote.sched.season === 2025 && wrote.sched.weeks.length === 14,
        "…and a 14-week 2025 schedule (" + (wrote.sched ? wrote.sched.weeks.length : "none") + ")");
      ok(wrote.old2026 === null, "…nothing was written under the 2026 season (the replay is season-scoped, not destructive)");
      // Real post-draft rosters: starters slotted, an OUT player on IR, benchers on the bench.
      const ros = await page.evaluate(() => {
        const p = JSON.parse(localStorage.getItem("lg_gffl_test1_roster_2025_w1_t1")).players;
        return { slots: p.map((x) => x.slot), names: p.map((x) => x.name), ir: (p.find((x) => x.name === "I. Injured") || {}).slot };
      });
      ok(ros.slots.filter((sl) => sl !== "BENCH" && sl !== "IR").length >= 6, "…starters are really slotted, not all benched");
      ok(ros.ir === "IR", "…and the OUT player landed on IR");
      simDocsAfterSetup = await snapshotAllDocs(page);
      ok(errors.length === 0, "0 page errors through the whole auto-setup");
      await ctx.close();
    }

    // ---- X2b: SECOND boot is a genuine no-op — it costs zero backend writes.
    {
      const { ctx, page, errors } = await newTestPage(browser, { docs: simDocsAfterSetup, pass: "amenfarms", team: 1, who: "Peter" });
      // Count writes at the backend, not at the UI: a set() that lands identical bytes is
      // still a write, and "the setup didn't run again" has to mean exactly that.
      await page.evaluateOnNewDocument(() => {
        let realLG = null;
        Object.defineProperty(window, "LG", {
          configurable: true,
          get() { return realLG; },
          set(v) {
            realLG = v;
            if (!v || v.__wcHook) return;
            v.__wcHook = true;
            let realDb;
            Object.defineProperty(v, "db", {
              configurable: true,
              get() { return realDb; },
              set(dbVal) {
                realDb = dbVal;
                if (!dbVal || dbVal.__wcArmed) return;
                dbVal.__wcArmed = true;
                window.__writes = [];
                const realSet = dbVal.set.bind(dbVal);
                dbVal.set = (id, data) => { window.__writes.push(id); return realSet(id, data); };
              },
            });
          },
        });
      });
      await bootSim(page);
      ok(await waitOr(page, ".mucard", 20000), "an already-seeded replay boots straight to the league home");
      ok(!(await page.$("#simSetupMsg")), "…the setup card never appears a second time");
      const w = await page.evaluate(() => (window.__writes || []).filter((id) => /^roster_|^sched_|^team_/.test(id)));
      ok(w.length === 0, "…and it costs ZERO roster/schedule/team writes — genuinely idempotent (" + JSON.stringify(w) + ")");
      ok(errors.length === 0, "0 page errors on the second boot");
      await ctx.close();
    }

    // ---- X2c: a PARTIAL setup resumes on the next boot.
    {
      const partial = { ...simDocsAfterSetup };
      delete partial.roster_2025_w1_t2; // team 2's roster never landed (a dropped write mid-run)
      const { ctx, page, errors } = await newTestPage(browser, { docs: partial, pass: "amenfarms", team: 1, who: "Peter" });
      await watchSetupCard(page);
      await bootSim(page);
      ok(await waitOr(page, ".mucard", 20000), "a half-seeded replay finishes booting");
      ok(await page.evaluate(() => window.__sawSetupCard === true), "…because it picked the setup back up on the next boot");
      const back = await page.evaluate(() => (JSON.parse(localStorage.getItem("lg_gffl_test1_roster_2025_w1_t2") || "{}").players || []).length);
      ok(back === 7, "…the missing roster is rebuilt (" + back + " players)");
      ok(errors.length === 0, "0 page errors resuming a partial setup");
      await ctx.close();
    }

    // ---- X2d: a CONFIRMED-empty backend gets the setup, not the first-run import card…
    // An EMPTY but reachable fake cloud, exactly like section B2: the local backend is a
    // DEGRADED fallback by definition, so an empty read there is (correctly) an outage rather
    // than a claim that the league is new. Only a confirmed-empty backend can reach this path.
    {
      const { ctx, page, errors } = await newTestPage(browser, simSeed({ noTeams: true, noClaim: true }));
      await armFakeCloud(page, {});
      await watchSetupCard(page);
      await bootSim(page);
      ok(await waitOr(page, ".teamrow", 20000), "a confirmed-empty league loads the replay itself and lands on the claim screen");
      ok(await page.evaluate(() => window.__sawSetupCard === true), "…via the setup card, NOT the first-run import card");
      // Found live in this section: the banner's own projection warm called UI.show(undefined)
      // once projections landed, which falls through to the LEAGUE HOME — bouncing a brand-new
      // owner off the claim screen into a league they had not picked a team in. The claim
      // screen must survive that landing.
      await sleep(1200);
      ok(!!(await page.$(".teamrow")) && (await page.evaluate(() => window.__GFFL__.LG.myTeamId())) === null,
        "…and it STAYS on the claim screen once projections land — nothing bounces an unclaimed device into the league");
      ok(!/isn't set up yet/.test(await page.evaluate(() => document.body.textContent)), "…which is nowhere on screen");
      const n = await page.evaluate(() => document.querySelectorAll(".teamrow").length);
      ok(n === 2, "…all imported teams are claimable (" + n + ")");
      ok(errors.length === 0, "0 page errors seeding a from-scratch replay");
      await ctx.close();
    }

    // ---- X2e: …but an UNCONFIRMED empty read is still an outage, not a setup run.
    // The server-confirmed-emptiness fix (2026-08-08) must not be weakened by the replay: the
    // setup check sits AFTER that guard on purpose.
    {
      const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: null, who: null });
      await armFakeCloud(page, {}, { fail: true });
      await watchSetupCard(page);
      await bootSim(page);
      ok(await waitOr(page, "#offlineRetry", 12000), "an unreachable backend still gets the honest outage card under the replay");
      ok(await page.evaluate(() => window.__sawSetupCard === false), "…and NOT a setup run that could only fail");
      ok(!/isn't set up yet/.test(await page.evaluate(() => document.body.textContent)), "…and not the first-run import card either");
      ok(errors.length === 0, "0 page errors on the degraded replay boot");
      await ctx.close();
    }

    // ---- X2f: a setup FAILURE is visible, with a retry that works.
    {
      const { ctx, page, errors } = await newTestPage(browser, simSeed());
      // A reachable backend whose WRITES reject — exactly what runSimSetup's own saveTeam/
      // saveRoster hits on a degraded connection.
      await armFakeCloud(page, { team_1: { kind: "team", teamId: 1, name: "Battle Kreussers" }, team_2: { kind: "team", teamId: 2, name: "End Zone Goats" } });
      await page.evaluateOnNewDocument(() => { window.__fakeCloudFailWrites = true; });
      await bootSim(page);
      ok(await waitOr(page, "#simSetupRetry", 20000), "a write that fails mid-setup says so on screen, with a Try again button");
      const failTxt = await page.evaluate(() => document.body.textContent);
      ok(/Couldn't load the 2025 season/.test(failTxt), "…as a real failure card");
      ok(/fake cloud offline/.test(failTxt), "…naming the actual reason");
      ok(!(await page.$(".mucard")), "…and never a half-built league behind it");
      await page.evaluate(() => { window.__fakeCloudFailWrites = false; });
      await clickIn(page, "#simSetupRetry");
      ok(await waitOr(page, ".mucard", 20000), "…and Try again completes normally once the backend is back");
      ok(errors.length === 0, "0 page errors through the failure + retry");
      await ctx.close();
    }

    // ---- X3: the NFL slate — real week-1 2025 games, presented as upcoming.
    // RESTAGED 2026-08-08: pinned to `pre`, frozen. "Every game reads upcoming" is the
    // BEFORE-KICKOFF phase's contract by definition; under the shipping `live` default the
    // whole point is that they DON'T (section X8 asserts that side).
    {
      simSbUrls.length = 0;
      const { ctx, page, errors } = await newTestPage(browser, { docs: simDocsAfterSetup, pass: "amenfarms", team: 1, who: "Peter" });
      await bootSim(page, PREPIN);
      await page.waitForSelector(".mucard", { timeout: 20000 });
      await page.waitForFunction(() => window.__GFFL__.D.S.nflEvents && window.__GFFL__.D.S.nflEvents.length > 0, { timeout: 15000 });
      ok(simSbUrls.length >= 1, "the replay asks ESPN for an explicit historical slate");
      const u = simSbUrls[0] || "";
      ok(/[?&]dates=2025(&|$)/.test(u), "…dates=2025 (" + u + ")");
      ok(/[?&]seasontype=2(&|$)/.test(u), "…seasontype=2 (regular season)");
      ok(/[?&]week=1(&|$)/.test(u), "…week=1");
      const slate = await page.evaluate(() => {
        const D = window.__GFFL__.D;
        return {
          n: D.S.nflEvents.length,
          states: [...new Set(D.S.nflEvents.map((e) => e.state))],
          scores: [...new Set(D.S.nflEvents.flatMap((e) => [e.away.score, e.home.score]))],
          dates: D.S.nflEvents.map((e) => e.date),
          nets: D.S.nflEvents.map((e) => e.broadcast).filter(Boolean),
          gameStates: [...new Set([...D.S.games.values()].map((g) => g.state))],
          engineWeek: D.engineWeek(),
          espnWeek: D.S.espnWeek, slpWeek: D.S.slpWeek,
          anyLive: D.anyLive(), health: D.S.health.mode,
        };
      });
      ok(slate.n === 6, "…and gets the whole week-1 slate (" + slate.n + " games)");
      ok(slate.states.length === 1 && slate.states[0] === "pre",
        "EVERY game reads as upcoming, even though the historical document says they all finished (" + slate.states.join() + ")");
      ok(slate.scores.length === 1 && slate.scores[0] === "0", "…every score reads 0 (" + slate.scores.join() + ")");
      ok(slate.gameStates.length === 1 && slate.gameStates[0] === "pre", "…and the per-team game map agrees");
      ok(slate.dates.every((d) => /^2025-09-0[4-9]/.test(d)), "…each game keeps its REAL kickoff datetime");
      ok(slate.nets.length === 6, "…and its real TV network (" + slate.nets.join("/") + ")");
      ok(slate.anyLive === false, "nothing is live — the pin is before kickoff");
      ok(slate.health === "dual", "…and health reads nominal, not an outage, because nothing is failing (" + slate.health + ")");
      // RESTAGED 2026-08-09: the chip used to read "replay" here, which was accurate but was
      // also a standing test-environment reminder — the same one the banner was removed for.
      // A healthy replay board is now silent; `slate.health === "dual"` just above is what
      // still asserts the underlying state is nominal.
      const chip = await page.evaluate(() => { const e = document.getElementById("healthChip"); return e && !e.hidden ? { t: e.textContent.trim(), cls: e.className } : null; });
      ok(chip === null, "…and it says so silently — no health chip, and no test-environment reminder (" + (chip ? chip.t : "hidden") + ")");
      // The provenance guards must stay silent for the whole replay.
      ok(slate.espnWeek === null && slate.slpWeek === null && slate.engineWeek === null,
        "the engine's week stays UNKNOWN — the historical slate never claims to be the live one");
      const fin = await page.evaluate(async () => {
        const r = await window.__GFFL__.LG.finalizeWeek(1);
        await window.__GFFL__.UI.maybeAutoFinalizeWeeks();
        return { r, weekly: localStorage.getItem("lg_gffl_test1_weekly_2025_w1"), stale: window.__GFFL__.UI._staleWeeks };
      });
      ok(fin.r && fin.r.ok === false && fin.r.reason === "sim-replay", "…so a live-path finalize refuses outright (" + (fin.r || {}).reason + ")");
      ok(fin.weekly === null, "…no weekly doc is ever written from a slate nobody has played");
      ok(!fin.stale || fin.stale.length === 0, "…and no week is reported stale (" + JSON.stringify(fin.stale) + ")");
      // Scores tab.
      await clickIn(page, '.bnav button[data-v="scores"]');
      await page.waitForFunction(() => document.body.textContent.includes("NFL this week"), { timeout: 15000 });
      const sc = await page.evaluate(() => ({
        days: [...document.querySelectorAll(".scoreday h2")].map((e) => e.textContent.trim()),
        perDay: [...document.querySelectorAll(".scoreday .scgrid")].map((g) => g.querySelectorAll(".sccard").length),
        cards: document.querySelectorAll(".sccard").length,
        times: [...document.querySelectorAll(".scstate")].map((e) => e.textContent.trim()),
        body: document.body.textContent,
        gffl: !!document.querySelector(".mugrid"),
      }));
      ok(sc.cards === 6, "the Scores tab renders all six games (" + sc.cards + ")");
      // A RANGE, not an exact count: the grouping label comes from toLocaleDateString in the
      // BROWSER's own timezone, and a Thursday-night/Sunday-night kickoff lands on a different
      // calendar day under UTC than under Central. What must hold is that the slate really is
      // grouped (more than one day) and that the same-window Sunday games share a group.
      ok(sc.days.length >= 3 && sc.days.length <= 6, "…grouped by gameday (" + sc.days.join(" | ") + ")");
      ok(Math.max(...sc.perDay) >= 3, "…with the same-day Sunday games in one group (" + sc.perDay.join() + ")");
      ok(sc.times.every((t) => /(AM|PM)/.test(t)) && !sc.times.some((t) => /Final/.test(t)),
        "…each showing a kickoff time, never a final score (" + sc.times.join() + ")");
      ok(sc.gffl && /GFFL — Week 1/.test(sc.body), "…above the GFFL's own week-1 card");
      ok(!/ESPN league \(live\)/.test(sc.body), "…and the live ESPN fantasy card is hidden — meaningless inside a 2025 replay");
      ok(errors.length === 0, "0 page errors on the replay's Scores tab");
      await ctx.close();
    }

    // ---- X4: projections — derived from the real final line, and the real-projection path.
    // RESTAGED 2026-08-08: pinned to `pre`, frozen. Under the shipping `live` default P. Passer's
    // PHI game is already FINAL, so his row would carry a live SCORE as well as a projection —
    // and because the derived projection IS that same final line, the two read as the identical
    // number and "the matchup row shows the projection" would stop being a real assertion.
    {
      fixture.simProjReal = false;
      const { ctx, page, errors } = await newTestPage(browser, { docs: simDocsAfterSetup, pass: "amenfarms", team: 1, who: "Peter" });
      await bootSim(page, PREPIN);
      await page.waitForSelector(".mucard", { timeout: 20000 });
      await page.waitForFunction(() => window.__GFFL__.D.S.simProj, { timeout: 15000 });
      const pj = await page.evaluate(() => {
        const D = window.__GFFL__.D;
        return { source: D.S.simProj.source, week: D.S.simProj.week, passer: D.projFor("3915511"), agent: D.projFor("slp_9201") };
      });
      ok(pj.source === "actual", "with no forward projection retained, the replay DERIVES week 1's projections from its real final stats");
      ok(pj.week === 1, "…for week 1 (" + pj.week + ")");
      ok(pj.passer === 10.0, "…hand-checked through the league's own scoring: P. Passer 150yd·1TD·1INT·1×2pt = 10.0 (" + pj.passer + ")");
      ok(pj.agent === 6.0, "…and an unrostered free agent too: F. Agent 3rec·30yd = 6.0 (" + pj.agent + ")");
      // It has to REACH the surfaces, not just the hook.
      await clickIn(page, '.bnav button[data-v="matchup"]');
      await page.waitForFunction(() => document.querySelector(".mutable"), { timeout: 15000 });
      const mu = await page.evaluate(() => {
        const row = [...document.querySelectorAll(".pcellgrid")].find((e) => /P\. Passer/.test(e.textContent));
        return { row: row ? row.textContent.replace(/\s+/g, " ").trim() : null,
          headProj: [...document.querySelectorAll(".muhead .muhproj")].map((e) => e.textContent.trim()) };
      });
      ok(mu.row && /10\.0/.test(mu.row), "…the matchup row shows it (" + mu.row + ")");
      // RESTAGED 2026-08-09 (item 18). This read /Proj/ off document.body.textContent and had
      // been passing on the replay BANNER's "Projections are estimates." — never on the header
      // at all. The header's projection is a bare number in .muhproj (item E of the ESPN
      // rebuild), so that is what it now reads.
      ok(mu.headProj.length === 2 && mu.headProj.every((t) => /^\d+(\.\d)?$/.test(t)),
        "…and the header carries a projected total for each side (" + JSON.stringify(mu.headProj) + ")");
      const wp = await page.evaluate(() => {
        const el = document.querySelector(".wpfill") || document.querySelector("[class*=wp]");
        return !!el;
      });
      ok(wp, "…the win-probability bar renders off it");
      await clickIn(page, '.bnav button[data-v="moves"]');
      await page.waitForFunction(() => document.querySelector("#faResults .faproj"), { timeout: 15000 });
      const fa = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("#faResults tr")].filter((r) => /F\. Agent/.test(r.textContent));
        return rows.length ? (rows[0].querySelector(".faproj") || {}).textContent : null;
      });
      ok(fa === "6.0", "…and the players table's PROJ column shows the free agent's derived projection (" + fa + ")");
      await clickIn(page, '.bnav button[data-v="team"]');
      await page.waitForFunction(() => document.querySelector(".lrow"), { timeout: 15000 });
      const lk = await page.evaluate(() => {
        const r = [...document.querySelectorAll(".lrow")].find((e) => /P\. Passer/.test(e.textContent));
        return r ? r.textContent.replace(/\s+/g, " ") : null;
      });
      ok(lk && /10\.0/.test(lk), "…and the locker's own lineup row (" + lk + ")");
      ok(errors.length === 0, "0 page errors on the derived-projection path");
      await ctx.close();
    }
    {
      // The OTHER path: a real forward projection genuinely exists for the week.
      fixture.simProjReal = true;
      const { ctx, page, errors } = await newTestPage(browser, { docs: simDocsAfterSetup, pass: "amenfarms", team: 1, who: "Peter" });
      await bootSim(page, PREPIN); // same reason as X4 above: a projection must be the only number on the row
      await page.waitForSelector(".mucard", { timeout: 20000 });
      await page.waitForFunction(() => window.__GFFL__.D.S.simProj, { timeout: 15000 });
      const pj = await page.evaluate(() => ({ source: window.__GFFL__.D.S.simProj.source, passer: window.__GFFL__.D.projFor("3915511") }));
      ok(pj.source === "projection", "when Sleeper DOES still hold a forward projection it is used as-is, no fallback");
      ok(pj.passer === 18.0, "…hand-checked: P. Passer 250yd·2TD = 18.0, provably NOT the 10.0 derived figure (" + pj.passer + ")");
      fixture.simProjReal = false;
      ok(errors.length === 0, "0 page errors on the real-projection path");
      await ctx.close();
    }
    {
      // The LIVE-PROBE trap (2026-08-08): Sleeper's archived 2025 projections endpoint answers
      // 200 with thousands of rows, but rows can be ADP-ONLY husks (adp_dd_ppr and friends,
      // every stat projection stripped). A "non-empty means usable" test scores every player's
      // projection to 0.0 — worse than the fallback. simProjUsable must reject a 200-row
      // ADP-only map and the fallback (derived from real week-1 finals) must fire instead.
      fixture.simProjAdpOnly = true;
      const { ctx, page, errors } = await newTestPage(browser, { docs: simDocsAfterSetup, pass: "amenfarms", team: 1, who: "Peter" });
      await bootSim(page, PREPIN); // same reason as X4 above
      await page.waitForSelector(".mucard", { timeout: 20000 });
      await page.waitForFunction(() => window.__GFFL__.D.S.simProj, { timeout: 15000 });
      const pj = await page.evaluate(() => ({
        source: window.__GFFL__.D.S.simProj.source,
        passer: window.__GFFL__.D.projFor("3915511"),
        unitBig: window.__GFFL__.D.simProjUsable(Object.fromEntries(Array.from({ length: 30 }, (_, i) => ["k" + i, { rec: 3 + i }]))),
        unitAdp: window.__GFFL__.D.simProjUsable(Object.fromEntries(Array.from({ length: 500 }, (_, i) => ["k" + i, { adp_dd_ppr: i }]))),
        unitFew: window.__GFFL__.D.simProjUsable({ a: { pass_yd: 300 } }),
      }));
      ok(pj.source === "actual", "a 200-row ADP-only 'projections' map is treated as ABSENT — the derived-from-finals fallback fires (source=" + pj.source + ")");
      ok(pj.passer === 10.0, "…and P. Passer's projection is the derived 10.0, never a 0.0 husk (" + pj.passer + ")");
      ok(pj.unitBig === true && pj.unitAdp === false && pj.unitFew === false,
        "simProjUsable unit: 30 stat rows pass, 500 ADP-only rows fail, a lone stat row fails the ≥25 bar (" + JSON.stringify([pj.unitBig, pj.unitAdp, pj.unitFew]) + ")");
      fixture.simProjAdpOnly = false;
      ok(errors.length === 0, "0 page errors on the ADP-husk path");
      await ctx.close();
    }

    // ---- X5: the banner is GONE, and nothing it was quietly doing went with it.
    // RESTAGED 2026-08-09 (item 18, user: "lets also get rid of the yellow banner, I know we
    // are in a test environment dont need that reminder"). This section used to assert the
    // strip's presence, its exact copy at both widths and its non-overlap with the header and
    // the nav. It is now the inverse — plus the two things that strip was carrying that its
    // text never advertised:
    //   · its paint function WARMED the replay's projection cache on every view change, which
    //     is why projections resolved on a screen reached before any matchup/moves/locker page
    //     had been opened. Deleting the function with the strip would have taken that with it.
    //   · the offline chip MEASURED its own sticky top off the banner's height, so it must now
    //     sit directly under the header with no stale gap where the strip used to be.
    // The projections-are-estimates note is gone with it, deliberately and at the user's
    // request — it must NOT have been reinvented anywhere else.
    for (const vw of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const { ctx, page, errors } = await newTestPage(browser, { docs: simDocsAfterSetup, pass: "amenfarms", team: 1, who: "Peter" }, { vw });
      await bootSim(page);
      await page.waitForSelector(".mucard", { timeout: 20000 });
      const b = await page.evaluate(() => {
        const hr = document.querySelector("header").getBoundingClientRect();
        const main = document.querySelector("main").getBoundingClientRect();
        const navEl = document.getElementById("bnav");
        const nv = navEl.getBoundingClientRect();
        const txt = document.body.textContent;
        // The nav is a sticky TOP strip on desktop and a fixed BOTTOM bar on mobile, so what
        // sits directly above main differs by width — measure against whichever it is, or a
        // desktop run reads the nav's own height as a stale gap.
        const navTop = getComputedStyle(navEl).position === "sticky";
        const stackBottom = navTop ? Math.max(hr.bottom, nv.bottom) : hr.bottom;
        return { el: !!document.getElementById("simBanner"),
          replayCopy: /2025 SEASON REPLAY/i.test(txt), estimates: /Projections are estimates/i.test(txt),
          clockCopy: /clock runs \d+x/i.test(txt), navIsTopStrip: navTop,
          belowNav: navTop ? main.top >= nv.bottom - 1 : main.top < nv.top,
          gap: Math.round(main.top - stackBottom), vw: window.innerWidth };
      });
      ok(!b.el, "the replay banner element is gone from the page at " + vw.width + "px");
      ok(!b.replayCopy && !b.clockCopy, "…and none of its copy survives anywhere on screen at " + vw.width + "px");
      ok(!b.estimates, "…including the projections-are-estimates note, which the user accepted losing");
      // No stale offset where it used to sit: content starts right under the header.
      ok(b.gap >= 0 && b.gap <= 26,
        "…and nothing is left holding its space — content starts " + b.gap + "px under the header at " + vw.width + "px");
      ok(b.belowNav, "…and no overlap with the nav, whichever side of the page it is on at this width (top strip: " + b.navIsTopStrip + ")");
      // The offline chip used to add the banner's height to its own sticky top.
      const chip = await page.evaluate(() => {
        window.__GFFL__.LG.mirrorOffline = true;
        window.__GFFL__.UI._syncOfflineChip();
        const el = document.getElementById("offlineChip");
        const top = getComputedStyle(el).top;
        window.__GFFL__.LG.mirrorOffline = false;
        window.__GFFL__.UI._syncOfflineChip();
        return { top, expected: (window.innerWidth >= 1024 ? 46 : 52) + "px" };
      });
      ok(chip.top === chip.expected,
        "…and the offline chip sits directly under the header again, not offset by a strip that no longer exists (" + chip.top + " vs " + chip.expected + ")");
      // THE REPLAY ITSELF IS UNCHANGED — only the strip went.
      const still = await page.evaluate(() => {
        const { LG, D } = window.__GFFL__;
        return { sim: LG.SIM_2025, season: LG.SEASON, week: LG.currentWeek(), speed: LG.SIM_SPEED,
          moving: LG.now() - LG.SIM_NOW, games: D.S.games.size, proj: !!D.S.simProj };
      });
      ok(still.sim === true && still.season === 2025 && still.week === 1,
        "the replay still runs — season " + still.season + ", week " + still.week + " (" + vw.width + "px)");
      ok(still.speed > 0 && still.moving >= 0 && still.games > 0,
        "…its clock and its slate are untouched (" + still.games + " games on the board)");
      if (SHOTS) {
        fs.mkdirSync(path.join(ROOT, "shots"), { recursive: true });
        const nm = "gffl_replay_nobanner_" + (vw.width === 390 ? "390" : "desktop") + ".png";
        await page.screenshot({ path: path.join(ROOT, "shots", nm) });
        console.log("  📸 shots/" + nm);
      }
      ok(errors.length === 0, "0 page errors at " + vw.width + "px");
      await ctx.close();
    }
    // The projection warm the banner used to trigger must still happen on a view the reader
    // reaches without ever opening matchup/moves/locker.
    {
      const { ctx, page, errors } = await newTestPage(browser, { docs: simDocsAfterSetup, pass: "amenfarms", team: 1, who: "Peter" });
      await bootSim(page);
      await page.waitForSelector(".mucard", { timeout: 20000 });
      const warmed = await page.waitForFunction(() => !!window.__GFFL__.D.S.simProj, { timeout: 20000 })
        .then(() => true).catch(() => false);
      ok(warmed, "the replay's projections still warm themselves with no banner to trigger it — the cache survived the strip");
      const src = await page.evaluate(() => window.__GFFL__.D.S.simProj.source);
      ok(src === "actual" || src === "projection", "…and resolve to a real source (" + src + ")");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- X6: the sandbox is gone from the shipping files.
    {
      const files = ["league.html", path.join("assets", "league", "lg-core.js"),
        path.join("assets", "league", "lg-data.js"), path.join("assets", "league", "lg-ui.js")];
      const bad = [];
      for (const f of files) {
        const src = fs.readFileSync(path.join(ROOT, f), "utf8");
        const m = src.match(/testMode|TEST_PHASES|_t25|test2025|testLive|testProj|testWk|testSeason|testTeamBucket|testPlayerScale/g);
        if (m) bad.push(f + ": " + [...new Set(m)].join(","));
      }
      ok(bad.length === 0, "no trace of the removed sandbox survives in the shipping files (" + bad.join(" | ") + ")");
      const core = fs.readFileSync(path.join(ROOT, "assets", "league", "lg-core.js"), "utf8");
      ok(/const SIM_2025_DEFAULT = true;/.test(core), "…and the ONE switch to flip is a single documented literal");
    }

    // ================= X8 · THE LIVE PHASE — a clock that runs, games mid-play =============
    // 2026-08-08, user: "now let's advance to the middle of week 1 with live stats and live
    // games". The replay is no longer one frozen instant: `live` is the default phase, the clock
    // runs at SIM_SPEED, every game's state comes from LG.now() vs its OWN real kickoff, and
    // every player's line is his REAL week-1 final scaled by how far his own game has got.
    // Determinism throughout comes from LG.nowOverride (and ?simspeed=0), never from sleeping.
    //
    // The live instant is 2025-09-07T19:00:00Z, and against the fixture slate (see
    // sbSim2025Fix's own restage note) it gives — hand-computed from the game-clock model,
    // 60 game-minutes over 185 wall minutes with a 13-minute halftime:
    //   DAL@PHI (Thu 00:20Z)  FINAL      · NYG@WSH (17:00Z)  Q3 7:40
    //   KC@LAC  (17:15Z)      Q3 12:54   · DEN@TEN (20:25Z), BAL@BUF, MIN@CHI  PRE
    const LIVE_AT = Date.parse("2025-09-07T19:00:00Z");
    const simLive = { docs: simDocsAfterSetup, pass: "amenfarms", team: 1, who: "Peter" };
    // Drive the engine to an exact instant. Deliberately steps FORWARD through intermediate
    // polls when asked: the live feed is built by DIFFING consecutive polls, so a walk is the
    // only honest way to produce one — and a walk must never go backwards (rewinding the clock
    // is what manufactures a negative delta, which is precisely the nonsense the monotonicity
    // rule exists to prevent).
    const driveTo = (page, at, steps) => page.evaluate(async (at, steps) => {
      const { LG, D } = window.__GFFL__;
      const n = Math.max(1, steps || 1);
      const from = LG.nowOverride != null ? LG.nowOverride : at;
      for (let i = 1; i <= n; i++) {
        LG.nowOverride = Math.round(from + ((at - from) * i) / n);
        await D.pollOnce();
      }
      LG.nowOverride = at;
    }, at, steps);
    const gamesAt = (page) => page.evaluate(() => {
      const D = window.__GFFL__.D;
      const out = {};
      for (const [ab, g] of D.S.games) out[ab] = { state: g.state, detail: g.detail, period: g.period, clock: g.clock, score: g.score, opp: g.oppScore };
      return out;
    });

    // ---- X8a: the phase is a real switch, and `live` is the default.
    {
      const { ctx, page, errors } = await newTestPage(browser, simLive);
      await bootSim(page); // no params at all — exactly how a family device opens the app
      await page.waitForSelector(".mucard", { timeout: 20000 });
      const st = await page.evaluate(() => {
        const LG = window.__GFFL__.LG;
        return {
          phase: LG.SIM_PHASE, at: LG.SIM_NOW, iso: new Date(LG.SIM_NOW).toISOString(),
          speed: LG.SIM_SPEED, week: LG.currentWeek(),
          ids: Object.keys(LG.SIM_PHASES),
          stored: Object.keys(localStorage).filter((k) => /sim|phase/i.test(k)),
        };
      });
      ok(st.phase === "live", "the replay opens on the LIVE phase by default — no param, nothing stored (" + st.phase + ")");
      ok(st.iso === "2025-09-07T19:00:00.000Z", "…Sunday 2025-09-07 19:00Z, mid-afternoon (" + st.iso + ")");
      ok(st.speed === 8, "…with the clock running at 8x real time (" + st.speed + ")");
      ok(st.week === 1, "…still week 1 (" + st.week + ")");
      ok(st.ids.length === 2 && st.ids.includes("pre") && st.ids.includes("live"),
        "…and there are exactly two named phases (" + st.ids.join() + ")");
      ok(st.stored.length === 0, "…a default boot persists NO phase — the default stays the default (" + JSON.stringify(st.stored) + ")");
      ok(errors.length === 0, "0 page errors on the default live boot");
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await newTestPage(browser, simLive);
      await bootSim(page, "&simphase=pre");
      await page.waitForSelector(".mucard", { timeout: 20000 });
      const st = await page.evaluate(() => {
        const LG = window.__GFFL__.LG;
        return {
          phase: LG.SIM_PHASE, iso: new Date(LG.SIM_NOW).toISOString(), week: LG.currentWeek(),
          bannerGone: !document.getElementById("simBanner"),
          label: (LG.SIM_PHASES[LG.SIM_PHASE] || {}).label || "",
          stored: Object.keys(localStorage).filter((k) => /simphase/i.test(k)),
        };
      });
      ok(st.phase === "pre" && st.iso === "2025-09-04T14:00:00.000Z",
        "?simphase=pre reverts to the Thursday-morning instant (" + st.iso + ")");
      ok(st.week === 1, "…still week 1 (" + st.week + ")");
      // RESTAGED 2026-08-09 (item 18): the phase used to be asserted through the banner's copy.
      // The banner is gone, so the phase is read where it actually lives.
      ok(st.bannerGone && /before kickoff/.test(st.label),
        "…and the phase's own label still says so, with no banner left to print it (" + st.label + ")");
      ok(st.stored.length === 0, "…the URL override persists NOTHING — a shared link can't strand a device");
      ok(errors.length === 0, "0 page errors on the pre-phase override");
      await ctx.close();
    }
    // The commissioner's own switch: persists, and survives a reload.
    {
      const { ctx, page, errors } = await newTestPage(browser, simLive);
      await bootSim(page);
      await page.waitForSelector(".mucard", { timeout: 20000 });
      // The card is commissioner-gated, so become one first — same create-on-first-use idiom
      // (stubbed prompt) every other commissioner check in this suite uses.
      const locked = await page.evaluate(async () => {
        await window.__GFFL__.UI.show("rules");
        return { n: document.querySelectorAll(".simPhaseBtn").length, txt: document.body.textContent };
      });
      ok(locked.n === 0 && /Replay clock/.test(locked.txt) && /Commissioner only/.test(locked.txt),
        "a non-commissioner sees the Replay-clock card but no switch (" + locked.n + " buttons)");
      await page.evaluate(() => window.__GFFL__.LG.gateCommish());
      // RESTAGED 2026-08-09 (item 16): Rules is reached from the League page now, not a tab.
      await clickIn(page, '.bnav button[data-v="league"]');
      await waitOr(page, "#lnkRules", 12000); // see section U's note — report, don't abort
      await clickIn(page, "#lnkRules");
      await page.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 12000 }).catch(() => {});
      const card = await page.evaluate(() => {
        const btns = [...document.querySelectorAll(".simPhaseBtn")];
        return {
          has: !!document.body.textContent.match(/Replay clock/),
          n: btns.length,
          labels: btns.map((b) => b.textContent.trim()),
          disabled: btns.filter((b) => b.disabled).map((b) => b.dataset.phase),
          // Whitespace-normalized: the card's copy wraps across lines in its template literal,
          // so the rendered textContent carries the source's own newline + indentation.
          says8x: /clock then runs 8x real time/.test(document.body.textContent.replace(/\s+/g, " ")),
        };
      });
      ok(card.has && card.n === 2, "the Rules page carries a commissioner Replay-clock card with both phases (" + card.n + ")");
      ok(card.labels.some((l) => /Sunday afternoon/.test(l)) && card.labels.some((l) => /before kickoff/.test(l)),
        "…named in plain words (" + card.labels.join(" | ") + ")");
      ok(card.disabled.length === 1 && card.disabled[0] === "live", "…with the CURRENT phase's own button disabled (" + card.disabled.join() + ")");
      ok(card.says8x, "…and it states the speed the clock will run at");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle0", timeout: 20000 }).catch(() => {}),
        clickIn(page, '.simPhaseBtn[data-phase="pre"]'),
      ]);
      await page.waitForFunction(() => !!window.__GFFL__, { timeout: 12000 });
      const after = await page.evaluate(() => ({
        phase: window.__GFFL__.LG.SIM_PHASE,
        stored: localStorage.getItem("gffl_simphase"),
      }));
      ok(after.phase === "pre" && after.stored === "pre",
        "…switching phase reloads into it, and it STICKS on this device (" + after.phase + "/" + after.stored + ")");
      ok(errors.length === 0, "0 page errors through the phase switch");
      await ctx.close();
    }

    // ---- X8b: the clock RUNS, and it is clamped inside week 1.
    {
      const { ctx, page, errors } = await newTestPage(browser, simLive);
      await bootSim(page);
      await page.waitForSelector(".mucard", { timeout: 20000 });
      const run = await page.evaluate(async () => {
        const LG = window.__GFFL__.LG;
        LG.SIM_LOADED_AT = Date.now();
        const a = LG.simNow();
        await new Promise((r) => setTimeout(r, 700));
        const b = LG.simNow();
        return { a, b, wall: 700, moved: b - a };
      });
      ok(run.moved > 700 * 5 && run.moved < 700 * 12,
        "the replay clock genuinely RUNS, ~8x real time (" + run.moved + "ms of league time in ~700ms of wall time)");
      const clamp = await page.evaluate(() => {
        const LG = window.__GFFL__.LG;
        const cap = LG.simClampAt();
        // Pretend the tab has been open for a fortnight of real time.
        const saved = LG.SIM_LOADED_AT;
        LG.SIM_LOADED_AT = Date.now() - 14 * 24 * 3600 * 1000;
        const far = LG.simNow();
        const farWeek = (LG.nowOverride = far, LG.currentWeek());
        LG.nowOverride = null;
        LG.SIM_LOADED_AT = saved;
        return {
          cap, capIso: new Date(cap).toISOString(), far, farIso: new Date(far).toISOString(), farWeek,
          lastKick: new Date(LG.SIM_LAST_KICKOFF).toISOString(),
          startWeek: (LG.nowOverride = LG.SIM_NOW, LG.currentWeek()),
        };
      });
      await page.evaluate(() => { window.__GFFL__.LG.nowOverride = null; });
      ok(clamp.lastKick === "2025-09-09T00:15:00.000Z",
        "the clamp follows the slate's OWN last kickoff — Monday night (" + clamp.lastKick + ")");
      ok(clamp.capIso === "2025-09-09T04:15:00.000Z", "…+4 hours (" + clamp.capIso + ")");
      ok(clamp.far === clamp.cap, "…and a tab left open for two weeks stops dead on it, never running past (" + clamp.farIso + ")");
      ok(clamp.startWeek === 1 && clamp.farWeek === 1,
        "…week 1 at the phase instant AND at the clamp ceiling — the replay can never roll into week 2 (" + clamp.startWeek + "/" + clamp.farWeek + ")");
      ok(errors.length === 0, "0 page errors exercising the clock");
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await newTestPage(browser, simLive);
      await bootSim(page, "&simspeed=0");
      await page.waitForSelector(".mucard", { timeout: 20000 });
      const frozen = await page.evaluate(async () => {
        const LG = window.__GFFL__.LG;
        const a = LG.now();
        await new Promise((r) => setTimeout(r, 600));
        return { a, b: LG.now(), at: LG.SIM_NOW, speed: LG.SIM_SPEED, bannerGone: !document.getElementById("simBanner") };
      });
      ok(frozen.speed === 0 && frozen.a === frozen.at && frozen.b === frozen.at,
        "SIM_SPEED 0 freezes the clock dead on the phase instant — the deterministic mode");
      // RESTAGED 2026-08-09 (item 18): "the banner says paused" was the old way to see this;
      // the clock being provably frozen above IS the property, and there is no strip to print it.
      ok(frozen.bannerGone, "…with no banner left to claim a speed either way");
      ok(errors.length === 0, "0 page errors with the clock frozen");
      await ctx.close();
    }

    // ---- X8c: every game's state comes from its OWN real kickoff.
    {
      const { ctx, page, errors } = await newTestPage(browser, simLive);
      await bootSim(page, "&simspeed=0");
      await page.waitForSelector(".mucard", { timeout: 20000 });
      await page.waitForFunction(() => window.__GFFL__.D.S.nflEvents.length > 0, { timeout: 15000 });
      await driveTo(page, LIVE_AT, 1);
      const g = await gamesAt(page);
      ok(g.PHI && g.PHI.state === "post" && g.DAL.state === "post",
        "at Sunday 2:00pm ET the Thursday opener is FINAL (" + (g.PHI || {}).state + ")");
      ok(g.PHI && g.PHI.score === "24" && g.PHI.opp === "20",
        "…showing its exact real final score, unscaled (" + (g.PHI || {}).score + "-" + (g.PHI || {}).opp + ")");
      ok(g.KC && g.KC.state === "in" && g.KC.detail === "Q3 12:54",
        "…the 17:15Z game is mid-third-quarter (" + (g.KC || {}).detail + ")");
      ok(g.WAS && g.WAS.state === "in" && g.WAS.detail === "Q3 7:40",
        "…the 17:00Z game is FIFTEEN MINUTES further along — the clock is per-game, not one shared number (" + (g.WAS || {}).detail + ")");
      ok(g.DEN && g.DEN.state === "pre" && g.DEN.score === "0",
        "…the late-afternoon window has not kicked off, and reads 0 (" + (g.DEN || {}).state + ")");
      ok(g.MIN && g.MIN.state === "pre", "…nor has Monday night (" + (g.MIN || {}).state + ")");
      ok(g.KC && Number(g.KC.score) > 0 && Number(g.KC.score) < 21,
        "…and a game in progress shows a partial score, between nothing and its real final (" + (g.KC || {}).score + " of 21)");
      // The clock model itself, at instants chosen so the answer is hand-computable. 60 game
      // minutes are spread over 185 wall minutes with a 13-minute halftime, so 172 wall minutes
      // carry 60 game minutes: one game minute costs 172/60 = 2.86667 wall minutes.
      const model = await page.evaluate(() => {
        const D = window.__GFFL__.D;
        const ko = "2025-09-07T17:00:00Z", k = Date.parse(ko);
        const at = (min) => D.simGameState(ko, k + min * 60000);
        return {
          m0: at(0), m30: at(30), m86: at(86), m95: at(95), m99: at(99),
          m150: at(150), m184: at(184), m185: at(185), m400: at(400), before: at(-5),
        };
      });
      ok(model.before.state === "pre" && model.m0.state === "in" && model.m0.detail === "Q1 15:00",
        "the game clock: pre before kickoff, Q1 15:00 at kickoff (" + model.m0.detail + ")");
      ok(model.m30.detail === "Q1 4:32", "…30 wall minutes in = Q1 4:32 (" + model.m30.detail + ")");
      ok(model.m86.detail === "Half" && model.m95.detail === "Half" && model.m86.progress === 0.5,
        "…halftime is a real state, held for 13 wall minutes at exactly half the game (" + model.m95.detail + ")");
      ok(model.m99.detail === "Q3 15:00", "…and the second half opens on Q3 15:00 (" + model.m99.detail + ")");
      ok(model.m150.detail === "Q4 12:12", "…Q4 arrives on schedule (" + model.m150.detail + ")");
      ok(model.m184.period === 4 && model.m184.state === "in", "…the last minute of regulation is still Q4 (" + model.m184.detail + ")");
      ok(model.m185.state === "post" && model.m185.period === 4 && model.m185.clock === "0:00",
        "…then Final, clamped at Q4 0:00 (" + model.m185.period + "/" + model.m185.clock + ")");
      ok(model.m400.period === 4 && model.m400.state === "post",
        "…and hours later it is STILL Q4 — the period can never read Q5+ (" + model.m400.period + ")");
      ok(model.m0.progress === 0 && model.m185.progress === 1 && model.m150.progress > model.m30.progress,
        "…progress runs 0 -> 1 and only ever forwards");
      ok(errors.length === 0, "0 page errors deriving game state");
      await ctx.close();
    }

    // ---- X8d: live player stats, derived from the real finals.
    {
      const { ctx, page, errors } = await newTestPage(browser, simLive);
      await bootSim(page, "&simspeed=0");
      await page.waitForSelector(".mucard", { timeout: 20000 });
      await page.waitForFunction(() => window.__GFFL__.D.S.nflEvents.length > 0, { timeout: 15000 });
      // A pure, genuinely hand-computed check of the scaler: counting stats and yardage are
      // INTEGERS at every scale (a half-caught pass is not a thing).
      const unit = await page.evaluate(() => {
        const D = window.__GFFL__.D;
        return {
          half: D.scaleStatRow({ rec: 6, rec_yd: 62, rec_td: 1, pts_ppr: 18.2 }, 0.5),
          zero: D.scaleStatRow({ rec: 6, rec_yd: 62, rec_td: 1 }, 0),
          full: D.scaleStatRow({ rec: 6, rec_yd: 62, rec_td: 1 }, 1),
          fLo: Math.min(...["1", "2", "3", "9001", "6904", "abc"].map((p) => D.simPlayerScale(p))),
          fHi: Math.max(...["1", "2", "3", "9001", "6904", "abc"].map((p) => D.simPlayerScale(p))),
          stable: D.simPlayerScale("9001") === D.simPlayerScale("9001"),
        };
      });
      ok(unit.half.rec === 3 && unit.half.rec_yd === 31 && unit.half.rec_td === 1,
        "scaleStatRow at 50%: 6 rec/62 yds/1 TD -> 3/31/1, every one an integer (" + JSON.stringify(unit.half) + ")");
      ok(unit.zero.rec === 0 && unit.zero.rec_yd === 0 && unit.full.rec_yd === 62,
        "…0 at the start, the untouched real line at 100%");
      ok(unit.fLo >= 0.75 && unit.fHi <= 1.35 && unit.stable,
        "…and each player's own multiplier is a stable draw inside [0.75, 1.35] (" + unit.fLo.toFixed(3) + ".." + unit.fHi.toFixed(3) + ")");
      // A player whose game has NOT kicked off has no line at all — absent, not zeros.
      await driveTo(page, LIVE_AT, 1);
      const rows = await page.evaluate(() => {
        const D = window.__GFFL__.D;
        const grab = (k) => { const r = D.S.players.get(k); return r ? { pts: r.pts, slp: !!r.slp, yd: r.slp ? r.slp.stats.rec_yd : null } : null; };
        return { flex: grab("111444"), passer: grab("3915511"), tight: grab("111222"),
          f: D.simPlayerScale("9001"), prog: (D.S.games.get("KC") || {}).progress };
      });
      ok(rows.flex === null,
        "a player whose game has not kicked off has NO stat line at all — absent, never a row of zeros");
      ok(rows.passer && rows.passer.pts === 10.0,
        "a player whose game is OVER reads his exact real final, hand-computed through the league's own scoring: "
        + "P. Passer 150 pass yds (x0.04) + 1 TD (4) - 1 INT (2) + 1 two-pointer (2) = 10.0 (" + (rows.passer || {}).pts + ")");
      // …and the live one, computed independently here (the expected yardage is multiplied and
      // rounded by the TEST, not by scaleStatRow, so this is a genuine cross-check).
      const s = Math.min(0.98, rows.prog * rows.f);
      const wantYd = Math.round(62 * s);
      ok(rows.tight && rows.tight.slp && rows.tight.yd === wantYd,
        "a player mid-game reads his real final SCALED by how far his own game has got: T. Tight 62 rec yds x "
        + s.toFixed(3) + " = " + wantYd + " (" + (rows.tight || {}).yd + ")");
      ok(rows.tight && rows.tight.pts < 18.2 && rows.tight.pts > 0,
        "…so his points are a real partial of his 18.2 final (" + (rows.tight || {}).pts + ")");
      // Monotonic over a long walk, and never past the final.
      const walk = await page.evaluate(async () => {
        const { LG, D } = window.__GFFL__;
        const ko = Date.parse("2025-09-07T17:15:00Z");
        const out = [];
        // FORWARD from where the page already is (the live instant = kickoff + 105 wall minutes)
        // to the last minute of regulation. Deliberately never rewinds: this page has already
        // polled, so stepping BACK would diff a big line against a small one and manufacture the
        // exact negative delta the checks below exist to rule out.
        for (let i = 0; i <= 11; i++) {
          LG.nowOverride = ko + (105 + i * 7) * 60000; // 105 -> 182 wall minutes
          await D.pollOnce();
          const r = D.S.players.get("111222");
          const g = D.S.games.get("KC");
          out.push({ i, state: g.state, detail: g.detail, pts: r && r.pts != null ? r.pts : null,
            yd: r && r.slp ? r.slp.stats.rec_yd : null, rec: r && r.slp ? r.slp.stats.rec : null,
            td: r && r.slp ? r.slp.stats.rec_td : null });
        }
        LG.nowOverride = ko + 200 * 60000;
        await D.pollOnce();
        const fin = D.S.players.get("111222");
        const evs = D.S.events.filter((e) => !e.msg);
        LG.nowOverride = null;
        return { out, final: fin ? fin.pts : null, finalYd: fin && fin.slp ? fin.slp.stats.rec_yd : null,
          nEv: evs.length,
          backwards: evs.filter((e) => e.to != null && e.from != null && Number(e.to) < Number(e.from)).length,
          negDelta: evs.filter((e) => e.stat !== "dst_pa" && e.dPts < 0).length,
          sample: evs.slice(0, 3).map((e) => e.name + " " + e.stat + " " + e.from + "->" + e.to + " " + e.dPts) };
      });
      const seq = walk.out.filter((r) => r.yd != null);
      ok(seq.length >= 8, "…walked across " + seq.length + " successive polls of the same live game");
      let mono = true, capped = true;
      for (let i = 1; i < seq.length; i++) {
        if (seq[i].yd < seq[i - 1].yd || seq[i].rec < seq[i - 1].rec || seq[i].td < seq[i - 1].td) mono = false;
        if (seq[i].yd > 62 || seq[i].pts > 18.2) capped = false;
      }
      ok(mono, "…and every counting stat is NON-DECREASING the whole way — the feed diffs consecutive polls, so a value that ticked down would emit a nonsense negative line ("
        + seq.map((r) => r.yd).join(",") + ")");
      ok(capped, "…and never exceeds his real final at any point before it (max " + Math.max(...seq.map((r) => r.yd)) + " of 62)");
      ok(walk.final === 18.2 && walk.finalYd === 62,
        "…then lands EXACTLY on the real final once the game is over (" + walk.final + " / " + walk.finalYd + " yds)");
      ok(walk.nEv >= 8, "the feed fills as the game runs (" + walk.nEv + " entries: " + walk.sample.join(" | ") + ")");
      ok(walk.backwards === 0, "…with not one stat ever going backwards (" + walk.backwards + ")");
      ok(walk.negDelta === 0, "…and no negative point deltas (" + walk.negDelta + ")");
      ok(errors.length === 0, "0 page errors across the whole walk");
      await ctx.close();
    }

    // ---- X8e: locks, the matchup page, and the guards that must STAY silent.
    {
      const { ctx, page, errors } = await newTestPage(browser, simLive);
      await bootSim(page, "&simspeed=0");
      await page.waitForSelector(".mucard", { timeout: 20000 });
      await page.waitForFunction(() => window.__GFFL__.D.S.nflEvents.length > 0, { timeout: 15000 });
      // Lineup locking is derived from the SAME clock, so it can never disagree with the board.
      await driveTo(page, Date.parse("2025-09-04T14:00:00Z"), 1);
      await clickIn(page, '.bnav button[data-v="team"]');
      await page.waitForFunction(() => document.querySelector(".lrow"), { timeout: 15000 });
      // RESTAGED 2026-08-09 (item 9): ".lrow .lock" no longer exists at all, so counting it
      // would be a vacuous 0 forever. The live signal is the Swap button's own disabled state,
      // which is what a player actually sees — counted here instead.
      const early = await page.evaluate(() => ({
        locked: document.querySelectorAll(".lrow.locked").length,
        disabledSwaps: [...document.querySelectorAll(".lrow .lswap")].filter((b) => b.disabled).length,
      }));
      ok(early.locked === 0 && early.disabledSwaps === 0,
        "before any kickoff every lineup slot is editable — nothing is locked, every Swap enabled (" + JSON.stringify(early) + ")");
      await driveTo(page, LIVE_AT, 1);
      await page.evaluate(() => window.__GFFL__.UI.show("team"));
      await page.waitForFunction(() => document.querySelector(".lrow"), { timeout: 15000 });
      const late = await page.evaluate(() => {
        const rows = [...document.querySelectorAll(".lrow")];
        const find = (nm) => rows.find((r) => r.textContent.includes(nm));
        const t = find("T. Tight"), p = find("P. Passer");
        return {
          locked: rows.filter((r) => r.classList.contains("locked")).length,
          tight: !!(t && t.classList.contains("locked")),
          passer: !!(p && p.classList.contains("locked")),
        };
      });
      ok(late.tight, "…and once his game has kicked off a starter is LOCKED (T. Tight, mid-third-quarter)");
      ok(late.passer, "…as is one whose game already finished (P. Passer)");
      ok(late.locked >= 2, "…the lock follows the game state, slot by slot (" + late.locked + " locked)");
      // The matchup page reads like a real Sunday.
      await page.evaluate(() => window.__GFFL__.UI.show("matchup"));
      await page.waitForFunction(() => document.querySelector(".mutable"), { timeout: 15000 });
      const mu = await page.evaluate(() => {
        const txt = document.body.textContent.replace(/\s+/g, " ");
        const row = (nm) => { const e = [...document.querySelectorAll(".pcellgrid")].find((x) => x.textContent.includes(nm)); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };
        return { txt, tight: row("T. Tight"), passer: row("P. Passer"), flex: row("F. Flexman") };
      });
      ok(mu.tight && /Q3/.test(mu.tight), "the matchup row for a player mid-game carries his live game clock (" + mu.tight + ")");
      ok(mu.passer && /Final/.test(mu.passer), "…a finished game reads Final (" + mu.passer + ")");
      ok(mu.flex && !/Q[1-4]/.test(mu.flex), "…and one still to come shows its kickoff, not a clock (" + mu.flex + ")");
      // Hand-checkable from the fixture: at the live instant team 1's two KC starters are
      // mid-game and everyone else on that side is done, while team 2's four DEN players have
      // not kicked off — so one side reads "0 to play · 2 live" and the other "4 to play · 0 live".
      const counts = (mu.txt.match(/\d+ to play · \d+ live/g) || []);
      ok(counts.includes("0 to play · 2 live") && counts.includes("4 to play · 0 live"),
        "…and the header counts who is still playing, per side (" + counts.join(" | ") + ")");
      // The provenance guards must stay silent EVEN with the whole slate final — nothing may
      // auto-stamp week 1's permanent record from a slate nobody actually played.
      await driveTo(page, Date.parse("2025-09-09T03:30:00Z"), 2);
      const fin = await page.evaluate(async () => {
        const { LG, D, UI } = window.__GFFL__;
        const states = [...new Set([...D.S.games.values()].map((g) => g.state))];
        const r = await LG.finalizeWeek(1);
        await UI.maybeAutoFinalizeWeeks();
        return { states, r, weekly: localStorage.getItem("lg_gffl_test1_weekly_2025_w1"),
          stale: UI._staleWeeks, espnWeek: D.S.espnWeek, slpWeek: D.S.slpWeek, engineWeek: D.engineWeek(),
          health: D.S.health.mode, week: LG.currentWeek() };
      });
      ok(fin.states.length === 1 && fin.states[0] === "post", "with the WHOLE slate now final… (" + fin.states.join() + ")");
      ok(fin.week === 1, "…it is still week 1 (" + fin.week + ")");
      ok(fin.espnWeek === null && fin.slpWeek === null && fin.engineWeek === null,
        "…the engine's week is STILL unknown — the replay never claims to be the live board");
      ok(fin.r && fin.r.ok === false && fin.r.reason === "sim-replay", "…a live-path finalize still refuses outright (" + (fin.r || {}).reason + ")");
      ok(fin.weekly === null, "…no weekly doc is written; the commissioner's archived-stats backfill stays the only way to settle the week");
      ok(!fin.stale || fin.stale.length === 0, "…and no week is reported stale (" + JSON.stringify(fin.stale) + ")");
      ok(fin.health === "dual", "…health still reads nominal — nothing is failing, there is simply nothing to poll (" + fin.health + ")");
      // RESTAGED 2026-08-09 with the check above — a healthy board paints no chip at all.
      const chip = await page.evaluate(() => { const e = document.getElementById("healthChip"); return e && !e.hidden ? e.textContent.trim() : null; });
      ok(chip === null, "…and still paints no health chip, healthy being the silent case (" + chip + ")");
      await page.evaluate(() => { window.__GFFL__.LG.nowOverride = null; });
      ok(errors.length === 0, "0 page errors through locks, the matchup page and the guards");
      await ctx.close();
    }

    // ---- X7: review plates (--shots). Every one is taken against the SHIPPING replay path.
    if (SHOTS) {
      fs.mkdirSync(path.join(ROOT, "shots"), { recursive: true });
      // The LIVE phase's own plates. SIM_SPEED 0 for a deterministic clock; the feed is filled
      // by walking LG.nowOverride FORWARD to the live instant (a feed is built by diffing
      // consecutive polls, so it cannot exist without a walk — and the walk must never rewind).
      {
        const { ctx, page } = await newTestPage(browser, simLive);
        await bootSim(page, "&simspeed=0");
        await page.waitForSelector(".mucard", { timeout: 20000 });
        await page.waitForFunction(() => window.__GFFL__.D.S.simProj && window.__GFFL__.D.S.nflEvents.length, { timeout: 15000 });
        // Re-baseline the engine 40 league-minutes EARLIER, then walk forward to the live
        // instant. Booting already polled at LIVE_AT, so simply setting the clock back would
        // diff a big line against a small one and fill the plate with negative deltas — the
        // exact nonsense monotonicity exists to prevent, and it is what the first cut of this
        // plate actually showed. Dropping the rows + the seeded flag makes the earlier poll a
        // silent baseline again, so every entry after it is a genuine forward tick.
        await page.evaluate((t) => {
          const { LG, D } = window.__GFFL__;
          D.S.players.clear(); D.S.events.length = 0; D.S.slpSeeded = false;
          LG.nowOverride = t;
        }, LIVE_AT - 40 * 60000);
        await driveTo(page, LIVE_AT - 40 * 60000, 1);
        await driveTo(page, LIVE_AT, 9);
        const liveShot = async (view, name) => {
          await page.evaluate((v) => window.__GFFL__.UI.show(v), view);
          await sleep(700);
          await page.screenshot({ path: path.join(ROOT, "shots", name), fullPage: true });
          console.log("  📸 shots/" + name);
        };
        await liveShot("league", "gffl_live_league_390.png");
        await liveShot("matchup", "gffl_live_matchup_390.png");
        await liveShot("scores", "gffl_live_scores_390.png");
        await page.setViewport({ width: 1440, height: 900 });
        await liveShot("matchup", "gffl_live_matchup_desktop.png");
        await ctx.close();
      }
      const { ctx, page } = await newTestPage(browser, { docs: simDocsAfterSetup, pass: "amenfarms", team: 1, who: "Peter" });
      await bootSim(page, PREPIN); // the pre-kickoff plates keep their own (frozen) phase

      await page.waitForSelector(".mucard", { timeout: 20000 });
      await page.waitForFunction(() => window.__GFFL__.D.S.simProj && window.__GFFL__.D.S.nflEvents.length, { timeout: 15000 });
      const shot = async (view, name) => {
        await clickIn(page, '.bnav button[data-v="' + view + '"]');
        await sleep(900);
        await page.screenshot({ path: path.join(ROOT, "shots", name), fullPage: true });
        console.log("  📸 shots/" + name);
      };
      await page.screenshot({ path: path.join(ROOT, "shots", "gffl_sim25_league_390.png"), fullPage: true });
      console.log("  📸 shots/gffl_sim25_league_390.png");
      await shot("matchup", "gffl_sim25_matchup_390.png");
      await shot("moves", "gffl_sim25_moves_390.png");
      await shot("scores", "gffl_sim25_scores_390.png");
      await page.setViewport({ width: 1440, height: 900 });
      await clickIn(page, '.bnav button[data-v="league"]');
      await sleep(900);
      await page.screenshot({ path: path.join(ROOT, "shots", "gffl_sim25_league_desktop.png"), fullPage: true });
      console.log("  📸 shots/gffl_sim25_league_desktop.png");
      await ctx.close();
    }

    fixture.rich2025 = false; fixture.simProjReal = false;
  }


  // ==================== SECTION N: player names are ALWAYS "J. Surname" ====================
  // 2026-08-08, user: "player names should always be first initial and then last name."
  // LG.shortName is a DISPLAY formatter (see its own header note) — stored rosters, tx records
  // and the AI-read wire payload all keep FULL names, so nothing that matches on a name breaks
  // and history written before today shortens on screen too.
  // WHY THIS SECTION HAD TO SEED ITS OWN ROSTER: every pre-existing fixture player is ALREADY
  // written short ("P. Passer", "Q. Rival"), so the whole suite could pass with the formatter
  // doing nothing at all. These players carry FULL names, so the rendered short form is a real
  // assertion rather than a tautology.
  section("N: player names render as first initial + last name");
  {
    const NAMED_T1 = { kind: "roster", week: 1, teamId: 1, players: [
      { key: "3915511", name: "Joshua Passer", pos: "QB", team: "PHI", slot: "QB" },
      { key: "4241457", name: "Kenneth Walker III", pos: "RB", team: "DAL", slot: "RB" },
      { key: "111888", name: "Amon-Ra St. Brown", pos: "WR", team: "DEN", slot: "RB" },
      { key: "4361741", name: "Marvin Harrison Jr.", pos: "WR", team: "PHI", slot: "WR" },
      { key: "111555", name: "Ray Ray McCloud", pos: "WR", team: "DEN", slot: "WR" },
      { key: "111222", name: "T. Tight", pos: "TE", team: "KC", slot: "TE" },
      { key: "111444", name: "Flex Man", pos: "RB", team: "DEN", slot: "FLEX" },
      { key: "dst_PHI", name: "PHI D/ST", pos: "DST", team: "PHI", slot: "DST" },
      { key: "2473037", name: "Kick Kicker", pos: "K", team: "DAL", slot: "K" },
      { key: "111333", name: "Bench Backup", pos: "RB", team: "KC", slot: "BENCH" },
    ] };
    const seed = fullSeed();
    seed.docs = { ...seed.docs, ["roster_2026_w1_t1"]: NAMED_T1 };
    const { ctx, page, errors } = await newTestPage(browser, seed, {});
    await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => window.__GFFL__ && window.__GFFL__.LG.rules, { timeout: 9000 });
    await page.waitForSelector(".mucard", { timeout: 9000 });

    // -- the formatter itself, every rule it claims --
    const u = await page.evaluate(() => {
      const f = window.__GFFL__.LG.shortName;
      return {
        plain: f("Josh Allen"),
        threeToken: f("Ray Ray McCloud"),
        suffixRoman: f("Kenneth Walker III"),
        suffixJr: f("Marvin Harrison Jr."),
        particle: f("Amon-Ra St. Brown"),
        dstTeam: f("Bills D/ST"),
        dstAbbrev: f("PHI D/ST"),
        already: f("J. Allen"),
        idempotent: f(f("Josh Allen")),
        oneToken: f("Chargers"),
        empty: f(""),
        nul: f(null),
        spaces: f("  Josh   Allen  "),
      };
    });
    ok(u.plain === "J. Allen", 'shortName("Josh Allen") -> "J. Allen" (' + u.plain + ")");
    ok(u.threeToken === "R. McCloud", '…a double first name keeps only the SURNAME: "Ray Ray McCloud" -> "R. McCloud" (' + u.threeToken + ")");
    ok(u.suffixRoman === "K. Walker III", '…a roman-numeral suffix rides along (' + u.suffixRoman + ")");
    ok(u.suffixJr === "M. Harrison Jr.", '…so does Jr. (' + u.suffixJr + ")");
    ok(u.particle === "A. St. Brown", '…a surname PARTICLE stays with the surname — never the wrong "A. Brown" (' + u.particle + ")");
    ok(u.dstTeam === "Bills D/ST" && u.dstAbbrev === "PHI D/ST", "…a D/ST is a TEAM, not a person — left whole (" + u.dstTeam + " / " + u.dstAbbrev + ")");
    ok(u.already === "J. Allen" && u.idempotent === "J. Allen", "…idempotent: an already-short name is returned untouched (" + u.idempotent + ")");
    ok(u.oneToken === "Chargers", "…a single token is returned as-is");
    ok(u.empty === "" && u.nul === "", "…empty/null are safe");
    ok(u.spaces === "J. Allen", "…runs of whitespace don't produce a broken initial (" + JSON.stringify(u.spaces) + ")");

    // -- the MATCHUP lineup: what the user was actually looking at --
    await page.evaluate(() => { window.__GFFL__.UI.matchup = [1, 2]; window.__GFFL__.UI.show("matchup"); });
    await page.waitForSelector(".mutable", { timeout: 9000 });
    const mu = await page.evaluate(() => document.querySelector(".mutable").textContent);
    ok(/J\. Passer/.test(mu) && !/Joshua Passer/.test(mu), "matchup lineup renders the short form, and the full name appears NOWHERE on the row");
    ok(/K\. Walker III/.test(mu) && /A\. St\. Brown/.test(mu) && /M\. Harrison Jr\./.test(mu),
      "…suffixes and particles survive in the real rendered row");
    ok(/PHI D\/ST/.test(mu), "…the D/ST row still reads as its team");
    // The DATA is untouched — only the render is short (the whole point of a display formatter).
    const stored = await page.evaluate(() => (window.__GFFL__.UI._rosters[1].find((p) => p.key === "3915511") || {}).name);
    ok(stored === "Joshua Passer", "the stored roster keeps the FULL name — shortening is display-only (" + stored + ")");

    // -- the locker (own team, with the lineup editor) --
    await page.evaluate(() => window.__GFFL__.UI.openLocker(1));
    await page.waitForSelector(".lockerhead", { timeout: 9000 });
    const lk = await page.evaluate(() => document.body.textContent);
    ok(/J\. Passer/.test(lk) && !/Joshua Passer/.test(lk), "the locker's own lineup rows render short");

    // -- the player card, opened from a real row --
    await page.evaluate(() => window.__GFFL__.UI.openPlayerCard("3915511"));
    await page.waitForSelector(".pcname", { timeout: 9000 });
    const pc = await page.evaluate(() => document.querySelector(".pcname").textContent.trim());
    ok(pc === "J. Passer", "the player stats card's own heading is short too (" + pc + ")");
    await page.evaluate(() => window.__GFFL__.UI.closePlayerCard());

    // -- a transaction sentence written with a FULL name renders short (old history included) --
    await page.evaluate(async () => {
      await window.__GFFL__.LG.logTx("fa_add", 1, 1, { addKey: "zz9", addName: "Christian McCaffrey" });
      window.__GFFL__.UI._tx = undefined;
      window.__GFFL__.UI.show("league");
    });
    await page.waitForSelector(".mucard", { timeout: 9000 });
    await openDetails(page, "txDetails");
    const tx = await page.evaluate(() => {
      const d = [...document.querySelectorAll(".collapsecard")].find((el) => el.textContent.includes("Recent moves"));
      return d ? d.textContent : "";
    });
    ok(/C\. McCaffrey/.test(tx) && !/Christian McCaffrey/.test(tx),
      "a tx-log sentence renders short — including records written before today, since the shortening is at render time");
    ok(errors.length === 0, "0 page errors");
    await ctx.close();
  }


  // ============ SECTION AB: the Firestore IndexedDB assertion bug self-heals ============
  // Live report (2026-08-08): the league worked on the user's phone and dead-ended on their
  // desktop with 'FIRESTORE (10.12.2) INTERNAL ASSERTION FAILED: Unexpected state' printed on
  // the outage card. That is a known SDK bug in the PERSISTENT (IndexedDB) cache — a property
  // of that browser profile's stored database, not of the network: the league is perfectly
  // reachable, only the local cache is poisoned. The honest outage card was the right answer to
  // the wrong question, so the session now drops to an in-memory cache, retries the read, and
  // best-effort deletes the corrupted database.
  // The bug is only reachable through a real module boundary, and gstatic is blocked in every
  // suite page — so this drives it through LG._fbLoad, the import seam, with a fake Firestore
  // whose PERSISTENT handle throws the real assertion and whose MEMORY handle works.
  section("AB · the Firestore REST transport + the snapshot mirror (the SDK is gone)");
  {
    const STAMP = "lg_snapstamp_" + FAM;
    const leagueDocs = () => fullSeed().docs;
    // A seed whose LOCAL store already holds the league — i.e. a device that has been online
    // before. `stamp` is what makes it a MIRROR rather than a genuine local-backend store;
    // that one key is the whole distinction the offline UI turns on (and the reason every
    // pre-existing suite section, which seeds no stamp, is completely unaffected).
    const mirrorSeed = (opts) => {
      opts = opts || {};
      const s = fullSeed();
      return { ...s, stamp: opts.stamp === false ? null : (opts.stampAt || Date.now()) };
    };

    // ---- AB1: a real REST boot — wire shape, decode, and the mirror written through.
    {
      const R = restFixture(leagueDocs());
      const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: 1, who: "Peter" }, { rest: R });
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      ok(await waitOr(page, ".mucard", 15000), "a REST boot renders the real league home");
      const st = await page.evaluate(() => ({
        mode: window.__GFFL__.LG.backendMode, deg: window.__GFFL__.LG.backendDegraded,
        conf: window.__GFFL__.LG.teamsConfirmed, n: window.__GFFL__.LG.teams.length,
        mirror: window.__GFFL__.LG.mirrorOffline,
      }));
      ok(st.mode === "cloud" && st.deg === false, "…in confirmed CLOUD mode over plain fetch — no SDK, no IndexedDB (" + st.mode + "/" + st.deg + ")");
      ok(st.n === 8 && st.conf === true, "…all 8 teams read and the read marked server-confirmed");
      ok(st.mirror === false, "…and not in mirror-offline mode, because the cloud answered");
      // THE WIRE, not the wrapper: the probe is a real GET, the team list is a real runQuery
      // carrying the kind filter and this league's own collection id.
      const probe = R.calls.find((c) => c.op === "doc" && c.method === "GET" && c.id === "settings");
      ok(!!probe && /firestore\.googleapis\.com\/v1\/projects\/amen-farms-app\/databases\/\(default\)\/documents\/gffl_test1\/settings\?key=/.test(probe.url),
        "the reachability probe is a real REST GET on this league's own collection");
      const q = R.calls.find((c) => c.op === "runQuery" && c.kind === "team");
      ok(!!q, "…the team list is a runQuery with a kind=team fieldFilter ON THE WIRE");
      ok(!!q && q.coll === "gffl_" + FAM, "…scoped to this league's collection (" + (q && q.coll) + ")");
      // The codec really decoded: a number stayed a Number, a string a string.
      const t1 = await page.evaluate(() => { const t = window.__GFFL__.LG.teamById(1); return { id: typeof t.teamId, name: t.name }; });
      ok(t1.id === "number" && typeof t1.name === "string", "…and the value codec decoded typed Firestore fields back into plain JS (" + t1.id + ")");
      // THE MIRROR: every successful read wrote through to this device's own local store.
      const mir = await page.evaluate((pfx, stampKey) => ({
        team: JSON.parse(localStorage.getItem(pfx + "team_1") || "null"),
        stamp: Number(localStorage.getItem(stampKey) || 0),
      }), LSPFX, STAMP);
      ok(mir.team && mir.team.name === "Battle Kreussers", "every cloud read writes through into this device's local store — the snapshot mirror");
      ok(mir.stamp > 0 && Date.now() - mir.stamp < 120000, "…stamped, so a later offline boot knows the local store is a mirror and how fresh it is");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AB2: a 404 IS server-confirmed absence. The whole "cache-served empty" ambiguity
    // class that caused the empty-league bug cannot exist over REST — there is no cache.
    {
      const R = restFixture({});
      const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: null, who: null }, { rest: R });
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      ok(await waitOr(page, "#firstImport"), "a REST backend that answers 404/empty still offers the first-run setup card");
      ok(!(await page.$("#offlineRetry")), "…and not the outage card — a 404 is a real answer from a real server");
      const st = await page.evaluate(() => ({ conf: window.__GFFL__.LG.teamsConfirmed, deg: window.__GFFL__.LG.backendDegraded }));
      ok(st.conf === true && st.deg === false, "…the empty read is SERVER-CONFIRMED (a 404 on the probe still proves reachability)");
      const got404 = R.calls.some((c) => c.op === "doc" && c.id === "settings" && c.method === "GET");
      ok(got404, "…and the probe really was a GET for the missing settings doc");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AB3: set() — updateMask + the integer/double distinction, hand-checked ON THE WIRE.
    {
      const R = restFixture(leagueDocs());
      const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: 1, who: "Peter" }, { rest: R });
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      await waitOr(page, ".mucard", 15000);
      R.calls.length = 0;
      await page.evaluate(() => window.__GFFL__.LG.db.set("tx_codec", {
        kind: "tx", whole: 7, frac: 1.25, flag: true, label: "hi", nada: null,
        nested: { a: 1, b: "two" }, rows: [{ h: 1, a: 2 }, { h: 3, a: 4 }],
      }));
      const patch = R.calls.find((c) => c.method === "PATCH" && c.id === "tx_codec");
      ok(!!patch, "LG.db.set() goes out as a PATCH on the doc's own REST path");
      const body = patch ? JSON.parse(patch.body) : { fields: {} };
      const f = body.fields || {};
      ok(f.whole && f.whole.integerValue === "7", "…an integer is encoded as integerValue, and as a STRING per the API (" + JSON.stringify(f.whole) + ")");
      ok(f.frac && f.frac.doubleValue === 1.25, "…a non-integer as doubleValue, as a number (" + JSON.stringify(f.frac) + ")");
      ok(f.flag && f.flag.booleanValue === true && f.label && f.label.stringValue === "hi" && f.nada && "nullValue" in f.nada,
        "…boolean/string/null carry their own typed shapes");
      ok(f.nested && f.nested.mapValue && f.nested.mapValue.fields.a.integerValue === "1" && f.nested.mapValue.fields.b.stringValue === "two",
        "…a nested object is a mapValue with its own typed fields");
      ok(f.rows && f.rows.arrayValue && f.rows.arrayValue.values.length === 2 && f.rows.arrayValue.values[0].mapValue.fields.h.integerValue === "1",
        "…an array of objects is an arrayValue of mapValues");
      // The mask is what makes this setDoc(merge:true) rather than a full overwrite.
      const mask = [...(patch.url.matchAll(/updateMask\.fieldPaths=([^&]+)/g))].map((m) => decodeURIComponent(m[1]));
      const want = ["kind", "whole", "frac", "flag", "label", "nada", "nested", "rows"].map((k) => "`" + k + "`");
      ok(mask.length === want.length && want.every((w) => mask.includes(w)),
        "…the updateMask names EXACTLY the top-level keys being written (merge semantics) — " + mask.length + " paths");
      ok(mask.every((p) => /^`.*`$/.test(p)), "…every field path backtick-quoted, so a field name can never break the mask grammar");
      // Round trip: the types survive the wire in BOTH directions.
      const back = await page.evaluate(() => window.__GFFL__.LG.db.getFresh("tx_codec"));
      ok(back && back.whole === 7 && back.frac === 1.25 && back.flag === true && back.label === "hi" && back.nada === null,
        "…and a full round trip returns the same JS values, integers included (" + JSON.stringify(back && back.whole) + ")");
      ok(back && back.nested.a === 1 && back.nested.b === "two" && back.rows.length === 2 && back.rows[1].a === 4,
        "…nested maps and arrays-of-maps survive intact");
      // A merge really merges: a second set() touching one field leaves the rest alone.
      await page.evaluate(() => window.__GFFL__.LG.db.set("tx_codec", { label: "changed" }));
      const merged = await page.evaluate(() => window.__GFFL__.LG.db.getFresh("tx_codec"));
      ok(merged && merged.label === "changed" && merged.whole === 7, "…and a later one-field write MERGES (the mask leaves every unlisted field on the server)");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AB4: del() is a real DELETE.
    {
      const R = restFixture(leagueDocs());
      const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: 1, who: "Peter" }, { rest: R });
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      await waitOr(page, ".mucard", 15000);
      R.calls.length = 0;
      await page.evaluate(() => window.__GFFL__.LG.db.del("team_8"));
      const d = R.calls.find((c) => c.method === "DELETE" && c.id === "team_8");
      ok(!!d, "LG.db.del() goes out as a real DELETE on the doc's REST path");
      ok(!R.docs.team_8, "…and the document is gone from the store");
      const gone = await page.evaluate(() => window.__GFFL__.LG.db.getFresh("team_8"));
      ok(gone === null, "…a subsequent read gets a 404, decoded as a confirmed null");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AB5: NOTHING CAN HANG. The live incident that started this rework was an outage
    // card with no reason and a Retry stuck on "TRYING…" forever, because the SDK's failure
    // arrived as a HUNG PROMISE and a hung promise sails past every try/catch. Every request
    // now carries an AbortController timeout, so boot AND retry are bounded by construction.
    {
      const R = restFixture(leagueDocs());
      R.hang = true; // answered never — exactly the shape of the live incident
      const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: 1, who: "Peter" }, { rest: R });
      const t0 = Date.now();
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "domcontentloaded" });
      const shown = await waitOr(page, "#offlineRetry", 30000);
      const bootMs = Date.now() - t0;
      const budget = await page.evaluate(() => window.__GFFL__.LG.FS_TIMEOUT_MS);
      ok(shown, "a backend that NEVER answers still reaches a screen a person can act on");
      ok(bootMs < budget + 8000, "…within the timeout budget, not forever (" + bootMs + "ms, budget " + budget + "ms)");
      ok(bootMs > budget * 0.5, "…and it really did wait for the timeout rather than failing instantly for some other reason (" + bootMs + "ms)");
      const why = await page.evaluate(() => window.__GFFL__.LG.backendError);
      ok(/timed out/i.test(why), "…and the reason on screen SAYS it timed out — the live card had no reason line at all (" + why + ")");
      // THE REGRESSION: the Retry button must come back, every time, even when the retry
      // itself hangs.
      const t1 = Date.now();
      await page.evaluate(() => document.querySelector("#offlineRetry").click());
      await page.waitForFunction(() => {
        const b = document.querySelector("#offlineRetry");
        return b && !b.disabled && /Try again/i.test(b.textContent);
      }, { timeout: 30000 }).catch(() => {});
      const retryMs = Date.now() - t1;
      const bst = await page.evaluate(() => {
        const b = document.querySelector("#offlineRetry");
        return { on: !!b, disabled: b ? b.disabled : null, label: b ? b.textContent.trim() : null };
      });
      ok(bst.on && bst.disabled === false && /Try again/i.test(bst.label),
        "…a Retry against a hung backend returns to a TAPPABLE button (the stuck-\"TRYING…\" regression) — \"" + bst.label + "\"");
      ok(retryMs < budget + 8000, "…in bounded time (" + retryMs + "ms)");
      ok(errors.length === 0, "0 page errors");
      R.hang = false; // let the pending request drain before the context closes
      await ctx.close();
    }

    // ---- AB6: codec unit tests, both directions, against lg-core's own encoder/decoder.
    {
      const R = restFixture(leagueDocs());
      const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: 1, who: "Peter" }, { rest: R });
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      await waitOr(page, ".mucard", 15000);
      const c = await page.evaluate(() => {
        const LG = window.__GFFL__.LG, enc = LG._fsEnc, dec = LG._fsDec;
        const src = { i: 3, z: 0, neg: -2, d: 0.5, s: "x", b: false, n: null, m: { q: 1 }, arr: [1, "a", { k: 2 }] };
        const wire = enc(src);
        let threw = "";
        try { enc({ bad: [[1, 2]] }); } catch (e) { threw = String(e.message || e); }
        return {
          wire, back: dec(wire), threw,
          zeroIsInt: wire.z.integerValue === "0",
          negIsInt: wire.neg.integerValue === "-2",
          unknown: dec({ mystery: { fooValue: 1 } }),
          empty: dec({}),
        };
      });
      ok(c.back.i === 3 && c.back.d === 0.5 && c.back.s === "x" && c.back.b === false && c.back.n === null,
        "codec round trip: every scalar returns as the same JS value and type");
      ok(c.zeroIsInt && c.negIsInt, "…0 and a negative integer are integerValue too, not doubles");
      ok(typeof c.back.i === "number" && typeof c.back.d === "number", "…and BOTH integerValue and doubleValue decode to Number");
      ok(c.back.m.q === 1 && c.back.arr.length === 3 && c.back.arr[2].k === 2, "…nested maps and arrays-of-maps round trip");
      ok(/array directly inside an array/i.test(c.threw), "…a nested array THROWS loudly rather than silently mangling (" + c.threw + ")");
      ok(c.unknown && c.unknown.mystery === null, "…an unknown value kind decodes to null instead of throwing mid-doc, so one odd field can't lose a whole document");
      ok(JSON.stringify(c.empty) === "{}", "…and an empty fields map decodes to an empty object");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AB7: THE MIRROR. Offline, but this device has been online before: the league
    // renders NORMALLY from the saved copy. "They always need to be able to see all the data."
    {
      // No rest fixture at all -> firestore.googleapis.com is aborted, exactly like a real
      // offline device.
      const { ctx, page, errors } = await newTestPage(browser, mirrorSeed({ stampAt: Date.now() - 9 * 60000 }));
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      ok(await waitOr(page, ".mucard", 15000), "offline WITH a mirror renders the league normally — not an outage card");
      ok(!(await page.$("#offlineRetry")), "…no outage card");
      ok(!(await page.$("#firstImport")), "…and never the first-run card (the empty-league rule is untouched)");
      const st = await page.evaluate(() => ({
        mirror: window.__GFFL__.LG.mirrorOffline, mode: window.__GFFL__.LG.backendMode,
        conf: window.__GFFL__.LG.teamsConfirmed, n: window.__GFFL__.LG.teams.length,
      }));
      ok(st.mirror === true && st.mode === "local", "…LG.mirrorOffline is set (reading this device's saved copy)");
      ok(st.n === 8 && st.conf === false, "…all 8 teams are on screen, and the read is honestly marked UNCONFIRMED");
      const chip = await page.evaluate(() => {
        const el = document.querySelector("#offlineChip");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { hidden: el.hidden, text: el.textContent, w: r.width, h: r.height };
      });
      ok(chip && chip.hidden === false && chip.w > 100 && chip.h > 5, "…and a visible chip says which copy this is");
      ok(chip && /offline/i.test(chip.text) && /saved copy/i.test(chip.text), "…naming it as this device's saved copy (\"" + (chip && chip.text) + "\")");
      ok(chip && /9 minutes ago/.test(chip.text), "…with how old it is, from the mirror's own stamp");
      ok(chip && /reconnecting/i.test(chip.text), "…and that we're still trying");
      // Viewport (not fullPage): the chip is position:sticky, and this repo has already been
      // bitten by fullPage capture disagreeing with a sticky element's real placement.
      if (SHOTS) {
        fs.mkdirSync(path.join(ROOT, "shots"), { recursive: true });
        await page.screenshot({ path: path.join(ROOT, "shots", "gffl_rest_offline_390.png") });
        console.log("  📸 shots/gffl_rest_offline_390.png");
      }
      // BOOTING IS NOT A MUTATION. Caught by LOOKING at the desktop plate, which showed the
      // offline toast up with nobody having touched anything: the boot chain's own internal
      // writes (auto-checks carrying the league forward, ensureRoster copying a week forward)
      // were being refused and toasting for it. Those are now skipped on a mirror — the toast
      // is for what a PERSON tried to do.
      const bootToast = await page.evaluate(() => {
        const t = document.querySelector("#toast");
        return { on: t && !t.hidden, text: (t && t.textContent) || "" };
      });
      ok(!bootToast.on, "simply OPENING the app on a mirror raises no toast — internal housekeeping writes are skipped, not refused (\"" + bootToast.text.trim() + "\")");
      // A MUTATION IS REFUSED — a write into a mirror would be overwritten by the next cloud
      // read, so it would appear to work and then vanish.
      await clickIn(page, ".bnav button", "Chat");
      await waitOr(page, "#chatText", 9000);
      const before = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("_chat_")).length);
      await page.evaluate(() => {
        const t = document.querySelector("#chatText"); t.value = "offline post";
        document.querySelector("#chatSend").click();
      });
      await sleep(500);
      const after = await page.evaluate(() => ({
        chats: Object.keys(localStorage).filter((k) => k.includes("_chat_")).length,
        toast: (document.querySelector("#toast") || {}).textContent || "",
        toastOn: !(document.querySelector("#toast") || {}).hidden,
      }));
      ok(after.chats === before, "a mutation in mirror-offline mode writes NOTHING (" + before + " -> " + after.chats + ")");
      ok(after.toastOn && /offline/i.test(after.toast), "…and says so plainly instead of failing silently (\"" + after.toast.trim() + "\")");
      ok(errors.length === 0, "0 page errors — the refusal is reported, never thrown at the console");
      await ctx.close();
    }

    // ---- AB7b: the same state on a desktop, where the chip shares the sticky band with the
    // replay banner (its top offset is MEASURED off that banner, not hard-coded).
    {
      const { ctx, page, errors } = await newTestPage(browser, mirrorSeed({ stampAt: Date.now() - 2 * 3600000 }), { vw: { width: 1440, height: 900 } });
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      ok(await waitOr(page, ".mucard", 20000), "desktop: offline with a mirror still renders the league");
      // RESTAGED 2026-08-09 (item 18): the chip's top used to be MEASURED off the replay
      // banner, because the two sticky strips would otherwise pin to the same top and overlap.
      // With the banner gone the chip sits directly under the header, which is what this now
      // checks — including that nothing is holding the strip's old space.
      const geo = await page.evaluate(() => {
        window.__GFFL__.UI._syncOfflineChip();
        const c = document.querySelector("#offlineChip");
        const cr = c.getBoundingClientRect();
        const hr = document.querySelector("header").getBoundingClientRect();
        return { hidden: c.hidden, text: c.textContent, cTop: cr.top, w: cr.width,
          headerBottom: hr.bottom, cssTop: getComputedStyle(c).top, noBanner: !document.querySelector("#simBanner") };
      });
      ok(geo.hidden === false && geo.w > 400, "…the chip spans the page");
      ok(!(await page.evaluate(() => { const t = document.querySelector("#toast"); return t && !t.hidden; })),
        "…and no toast: opening the app is not a mutation");
      ok(/2 hours ago/.test(geo.text), "…and reads the mirror's age in hours once it's hours old (\"" + geo.text.trim() + "\")");
      ok(geo.noBanner && geo.cssTop === "46px",
        "…sitting directly under the desktop header, with no gap left where the replay banner used to be (" + geo.cssTop + ")");
      if (SHOTS) {
        await page.screenshot({ path: path.join(ROOT, "shots", "gffl_rest_offline_desktop.png") });
        console.log("  📸 shots/gffl_rest_offline_desktop.png");
      }
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AB8: THE STAMP IS THE WHOLE DISTINCTION. The same store WITHOUT it is a genuine
    // local-backend store — no chip, fully writable, exactly today's behaviour. This is the
    // check that keeps every other section in this suite (which all seed exactly that) valid.
    {
      const { ctx, page, errors } = await newTestPage(browser, mirrorSeed({ stamp: false }));
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      ok(await waitOr(page, ".mucard", 15000), "an UNSTAMPED local store still renders the league");
      const st = await page.evaluate(() => ({
        mirror: window.__GFFL__.LG.mirrorOffline,
        chip: (document.querySelector("#offlineChip") || {}).hidden,
      }));
      ok(st.mirror === false, "…but it is NOT a mirror — it's a genuine local backend");
      ok(st.chip === true, "…so no offline chip is shown");
      const wrote = await page.evaluate(async () => {
        await window.__GFFL__.LG.db.set("tx_localwrite", { kind: "tx", t: 1, text: "ok" });
        return JSON.parse(localStorage.getItem("lg_gffl_test1_tx_localwrite") || "null");
      });
      ok(wrote && wrote.text === "ok", "…and writes work exactly as they always have (this is what keeps every other section in this suite valid)");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AB9: the auto-retry recovers in place, on its own, with no tap.
    {
      const R = restFixture(leagueDocs());
      R.fail = true; // reachable host, refusing every request — a dropped connection
      const { ctx, page, errors } = await newTestPage(browser, mirrorSeed(), { rest: R });
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      ok(await waitOr(page, ".mucard", 15000), "a mirror + a refusing backend still renders the league");
      ok((await page.evaluate(() => window.__GFFL__.LG.mirrorOffline)) === true, "…in mirror-offline mode");
      ok((await page.evaluate(() => window.__GFFL__.UI._mirrorTimerOn())) === true, "…with the auto-retry loop armed — no tap required");
      // Re-arm the same loop on a short period so the REAL setInterval is what recovers here,
      // then let the connection come back.
      await page.evaluate(() => window.__GFFL__.UI._startMirrorRetry(400));
      R.fail = false;
      const back = await page.waitForFunction(() => window.__GFFL__.LG.mirrorOffline === false, { timeout: 15000 }).then(() => true).catch(() => false);
      ok(back, "…and when the connection comes back the loop reconnects on its own");
      await sleep(400);
      const st = await page.evaluate(() => ({
        mode: window.__GFFL__.LG.backendMode, deg: window.__GFFL__.LG.backendDegraded,
        conf: window.__GFFL__.LG.teamsConfirmed, n: window.__GFFL__.LG.teams.length,
        chip: (document.querySelector("#offlineChip") || {}).hidden,
        timer: window.__GFFL__.UI._mirrorTimerOn(),
        mu: document.querySelectorAll(".mucard").length,
      }));
      ok(st.mode === "cloud" && st.deg === false && st.conf === true, "…back to confirmed cloud mode");
      ok(st.chip === true && st.timer === false, "…the chip disappears and the loop stops");
      ok(st.n === 8 && st.mu === 4, "…and the screen repaints with the real league (" + st.mu + " matchups)");
      const wrote = await page.evaluate(async () => {
        try { await window.__GFFL__.LG.db.set("tx_afterheal", { kind: "tx", t: 2, text: "yes" }); return true; }
        catch (e) { return false; }
      });
      ok(wrote, "…and mutations are allowed again");
      ok(errors.length === 0, "0 page errors through the whole offline->online cycle");
      await ctx.close();
    }

    // ---- AB10: a COLD device with no network has genuinely nothing to show — the honest
    // outage card, exactly as before. Including the stamped-but-teamless case.
    {
      const { ctx, page, errors } = await newTestPage(browser, { docs: {}, pass: "amenfarms", team: 1, who: "Peter", stamp: Date.now() });
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      ok(await waitOr(page, "#offlineRetry"), "a stamped-but-EMPTY mirror + no network still gets the honest outage card");
      ok(!(await page.$("#firstImport")), "…never the first-run card");
      ok((await page.evaluate(() => window.__GFFL__.LG.mirrorOffline)) === false, "…and is not treated as a mirror, because there is no league in it to show");
      ok((await page.evaluate(() => (document.querySelector("#offlineChip") || {}).hidden)) === true, "…so no chip either");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AB11: the SDK really is gone from the shipped files.
    {
      const raw = ["assets/league/lg-core.js", "assets/league/lg-ui.js", "assets/league/lg-data.js"]
        .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
      const html = fs.readFileSync(path.join(ROOT, "league.html"), "utf8");
      // Comments are stripped before the ban is applied: the code's own header note NARRATES
      // the three SDK outages and names the machinery that caused them, which is exactly the
      // history a future reader needs. What must be gone is the CODE. (A `//` preceded by `:`
      // is a URL, not a comment — stripping those would delete the REST endpoint itself.)
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      const banned = /gstatic\.com\/firebasejs|initializeFirestore|persistentLocalCache|memoryLocalCache|clearIndexedDbPersistence|_fbLoad|healPersistence|gffl_nopersist/;
      ok(!banned.test(code), "no Firebase SDK or IndexedDB-heal machinery survives in the league's code");
      ok(!banned.test(html), "…nor in league.html");
      ok(/firestore\.googleapis\.com\/v1\/projects/.test(code), "…the transport really is the Firestore REST API");
      ok(!/\bwatch\s*\(/.test(code), "…and LG.db.watch (zero callers) is gone with it");
    }
  }

  // ================================================================================
  // AC · THE PRODUCTION "everything reads 0 / the scores say NaN" BUG (2026-08-09)
  // ================================================================================
  // User report, verbatim: "none of the scores for players are showing up they are saying
  // 'nan' and all the projections are 0". Two independent defects, both reproduced here
  // against PRODUCTION-SHAPED data (fixture.prod2025 — real names, roster keys that are real
  // ESPN ids, and a Sleeper directory in which only a minority of players carry an espn_id):
  //
  //   #1 IDENTITY. Roster keys are ESPN ids; only 6,727 of Sleeper's 12,217 players carry an
  //      espn_id. Both directions of the old espn_id-only lookup therefore lost ~half the
  //      league — no projection (so the matchup page fell back to the score and printed
  //      "proj 0.0") and stats landing under an orphan "slp_<pid>" key no roster row reads.
  //      Measured on the first 12 players of the real roster_2025_w1_t1: 4 resolved, 8 lost.
  //
  //   #2 NaN. `p += (st[k] || 0) * (sc[k] || 0)` in D.score guards a NaN (NaN is falsy) but
  //      passes a TRUTHY non-number straight through — and `0 * "x"` is NaN, so ONE bad value
  //      in the scoring table poisons EVERY player, including ones who have none of that
  //      stat. `paPoints`'s `sc.dst_pa_X ?? 0` was the second hole (?? does not catch NaN, and
  //      passes "" through, which turns the running total into a string). LG.fmtPts printed
  //      whatever it got, so a non-finite number reached the family as the literal text "NaN".
  section("AC · production identity resolution + the NaN boundary");
  {
    const prodSeed = () => ({ docs: prodSeedDocs(), pass: "amenfarms", team: 1, who: "Peter" });
    const bootProd = async (page, extra) => {
      await page.goto(BASE + "/league.html?fam=" + FAM + "&simphase=live&simspeed=0" + (extra || ""), { waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.__GFFL__ && window.__GFFL__.LG.rules, { timeout: 15000 });
      await page.evaluate(() => window.__GFFL__.D.pollOnce());
      await page.evaluate(() => window.__GFFL__.D.pollOnce());
      await page.evaluate(() => window.__GFFL__.D.stop());
    };
    // Every rendered text node, so a "NaN" anywhere on screen is caught — this scan is the
    // regression guard for the whole report, not a proxy for it.
    const nanText = (page) => page.evaluate(() => {
      const hits = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) if (/NaN/.test(n.nodeValue)) hits.push((n.parentElement && n.parentElement.className) + ": " + n.nodeValue.trim().slice(0, 40));
      return hits;
    });

    // ---- AC1: identity coverage — the headline number.
    {
      fixture.prod2025 = true;
      const { ctx, page, errors } = await newTestPage(browser, prodSeed());
      await bootProd(page);
      // Pre-fix tolerance (section Z's own lesson): every hook this section exercises is NEW,
      // and a bare call to a missing one throws and aborts the whole run with one stack trace
      // instead of the readable list of missing guarantees a pre-fix verification needs.
      const cov = await page.evaluate(() => (window.__GFFL__.D.idCoverage ? window.__GFFL__.D.idCoverage() : { total: -1, resolved: -1, unresolved: -1, byMethod: {}, missing: [] }));
      ok(cov.total === 17, "every rostered key across both teams is counted (" + cov.total + ")");
      ok(cov.resolved === 16 && cov.unresolved === 1,
        "16 of 17 roster keys resolve to a Sleeper player; the 1 that can't is the deliberately-unknowable one (" + JSON.stringify({ r: cov.resolved, u: cov.unresolved }) + ")");
      ok(cov.byMethod.espn === 5, "only 5 resolve through an espn_id — the espn_id-only lookup is what lost the rest (" + cov.byMethod.espn + ")");
      ok(cov.byMethod.name === 9, "9 resolve by NAME + TEAM — the method that had to be new (" + cov.byMethod.name + ")");
      ok(cov.byMethod.prefix === 2, "the 2 D/ST keys resolve by their own dst_ prefix");
      ok(cov.missing.length === 1 && cov.missing[0].name === "Ghost Player",
        "…and the one genuine gap is REPORTED by name, not silently swallowed (" + JSON.stringify(cov.missing) + ")");
      // The two spelling traps, individually.
      ok(await page.evaluate(() => !!window.__GFFL__.D.pidForKey && window.__GFFL__.D.pidForKey("4429160") === "9226"),
        "an apostrophe difference ('DeVon Achane' on the roster vs \"De'Von Achane\" in the directory) still matches");
      ok(await page.evaluate(() => !!window.__GFFL__.D.pidForKey && window.__GFFL__.D.pidForKey("4432708") === "9493"),
        "a suffix difference ('Marvin Harrison Jr.' vs 'Marvin Harrison') still matches");
      ok(await page.evaluate(() => !!window.__GFFL__.D.pidForKey && window.__GFFL__.D.pidForKey("9999999") === null),
        "a player the directory has genuinely never heard of resolves to null — no false match");
      ok(await page.evaluate(() => !!window.__GFFL__.D.pidMethodForKey && window.__GFFL__.D.pidMethodForKey("4239993") === "espn"),
        "a player who DOES carry an espn_id still resolves the fast way (unchanged for everyone who already worked)");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
      fixture.prod2025 = false;
    }

    // ---- AC2: the players that were dark now score and project — hand-computed.
    {
      fixture.prod2025 = true;
      const { ctx, page, errors } = await newTestPage(browser, prodSeed());
      await bootProd(page);
      const per = await page.evaluate(() => {
        const d = window.__GFFL__.D;
        const ros = window.__GFFL__.LG.ui._rosters[1] || [];
        const out = {};
        for (const p of ros) {
          const row = d.S.players.get(p.key);
          out[p.name] = { key: p.key, pts: row ? row.pts : null, proj: d.projFor(p.key), live: d.liveProj(p.key),
            score: d.livePts ? d.livePts(p.key) : (row && row.pts != null ? row.pts : 0) };
        }
        return out;
      });
      // Bijan Robinson: NO espn_id, so before the fix he had no row and no projection at all.
      // His game is FINAL at the live instant, so the score is his real line, unscaled:
      // 84 rush (.1) + 1 rush TD (6) + 4 rec (1) + 33 rec yd (.1) = 8.4 + 6 + 4 + 3.3 = 21.7
      ok(per["Bijan Robinson"] && per["Bijan Robinson"].pts === 21.7,
        "Bijan Robinson — no espn_id, previously invisible — scores his real final EXACTLY: 21.7 (" + JSON.stringify(per["Bijan Robinson"]) + ")");
      // …and his forward projection is a DIFFERENT number, so the two can't be confused:
      // 70 rush (.1) + 0.5 rush TD (6) + 3 rec (1) + 25 rec yd (.1) = 7 + 3 + 3 + 2.5 = 15.5
      ok(per["Bijan Robinson"] && per["Bijan Robinson"].proj === 15.5,
        "…and his real forward projection is 15.5, not his final and not 0 (" + (per["Bijan Robinson"] || {}).proj + ")");
      // Chase McLaughlin, K, also no espn_id, also FINAL:
      // 1 FG 20-29 (3) + 1 FG 50+ (5) + 2 XP (1) = 10.0  (fg_made_yd pays 0 by default)
      ok(per["Chase McLaughlin"] && per["Chase McLaughlin"].pts === 10,
        "Chase McLaughlin — no espn_id — scores 10.0 exactly (" + (per["Chase McLaughlin"] || {}).pts + ")");
      // Every rostered player who resolves has a projection; NONE reads null-and-therefore-0.
      const noProj = Object.entries(per).filter(([n, v]) => v.proj == null && n !== "Ghost Player").map(([n]) => n);
      ok(noProj.length === 0, "every resolvable starter and bench player has a real projection (" + JSON.stringify(noProj) + ")");
      const zeroProj = Object.entries(per).filter(([n, v]) => n !== "Ghost Player" && (v.live === 0 || v.live == null)).map(([n]) => n);
      ok(zeroProj.length === 0, "…so not one of them shows the reported 'proj 0' (" + JSON.stringify(zeroProj) + ")");
      // A player who HAS an espn_id is unaffected — the control.
      ok(per["Tee Higgins"] && per["Tee Higgins"].pts > 0 && per["Tee Higgins"].pts < 19.8,
        "the espn_id control (Tee Higgins, mid-game) still scales mid-game and is unchanged (" + (per["Tee Higgins"] || {}).pts + ")");
      // The unknowable player: "—", never 0.0, never NaN.
      ok(per["Ghost Player"] && per["Ghost Player"].score === null && per["Ghost Player"].live === null,
        "the unresolvable player yields null for both score and projection (" + JSON.stringify(per["Ghost Player"]) + ")");
      ok(await page.evaluate(() => window.__GFFL__.LG.fmtPts(null) === "—"), "…which renders as '—'");
      // (fmtPts has always dashed a null; what changed is that livePts/liveProj now GIVE it one.)
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
      fixture.prod2025 = false;
    }

    // ---- AC3: NOT ONE "NaN" ON SCREEN, anywhere, on production-shaped data.
    {
      fixture.prod2025 = true;
      const { ctx, page, errors } = await newTestPage(browser, prodSeed());
      await bootProd(page);
      for (const [view, label] of [["league", "the league home"], ["matchup", "the matchup page"], ["moves", "the players table"], ["scores", "the Scores tab"]]) {
        await page.evaluate((v) => window.__GFFL__.LG.ui.show(v), view);
        await sleep(700);
        const hits = await nanText(page);
        ok(hits.length === 0, "no 'NaN' anywhere on " + label + " (" + JSON.stringify(hits.slice(0, 3)) + ")");
      }
      await page.evaluate(() => window.__GFFL__.LG.ui.openLocker(1));
      await sleep(700);
      ok((await nanText(page)).length === 0, "no 'NaN' anywhere in the locker room");
      // The ghost row really is on screen, reading "—" rather than a fabricated 0.0.
      await page.evaluate(() => window.__GFFL__.LG.ui.show("matchup"));
      await sleep(700);
      // RESTAGED 2026-08-09 (the ESPN matchup rebuild): the projection under the score is a
      // BARE number now — the reference carries no "proj" label and at that size the word cost
      // more than it explained — so the two are read as their own elements rather than as one
      // run-together "—proj —" string. The property under test is unchanged: BOTH read "—".
      const ghostCell = await page.evaluate(() => {
        const el = document.querySelector('.pcellgrid[data-pk="9999999"]');
        if (!el) return null;
        const t = (sel) => { const e = el.querySelector(sel); return e ? e.textContent.trim() : null; };
        return { pts: t(".pts"), proj: t(".pproj") };
      });
      ok(!!ghostCell && ghostCell.pts === "—" && ghostCell.proj === "—", "the unresolvable player's cell reads '—' for both score and proj, not '0.0' and not 'NaN' (" + JSON.stringify(ghostCell) + ")");
      // Team totals are real, finite numbers.
      const tot = await page.evaluate(() => [...document.querySelectorAll(".muhead .bigpts")].map((e) => e.textContent.trim()));
      ok(tot.length === 2 && tot.every((t) => /^\d+(\.\d)?$/.test(t)), "both team totals are finite numbers (" + JSON.stringify(tot) + ")");
      ok(errors.length === 0, "0 page errors across every view");
      await ctx.close();
      fixture.prod2025 = false;
    }

    // ---- AC4: the NaN mechanics themselves, as unit checks on the real functions. Each of
    // these returned NaN before the fix (verified by stashing the app files back to HEAD).
    {
      const { ctx, page, errors } = await newTestPage(browser, { docs: fullSeed().docs, pass: "amenfarms", team: 1, who: "Peter" });
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.__GFFL__ && window.__GFFL__.LG.rules, { timeout: 12000 });
      const u = await page.evaluate(() => {
        const { D, LG } = window.__GFFL__;
        const base = { ...LG.DEFAULT_RULES.scoring };
        const qb = D.normSlp({ pass_yd: 291, pass_td: 3, pass_int: 1 });
        const dst = D.normSlp({ pts_allow: 21, sack: 3, int: 1 });
        return {
          strScoring: D.score(qb, { ...base, pass_yd: "x" }),
          // the poisoning case: a bad value on a key this player has NONE of
          objUnusedKey: D.score(qb, { ...base, rec: {} }),
          nanBracket: D.score(dst, { ...base, dst_pa_18_27: NaN }),
          emptyBracket: D.score(dst, { ...base, dst_pa_18_27: "" }),
          strStat: D.score(D.normSlp({ pass_yd: "x", pass_td: 3 }), base),
          clean: D.score(qb, base),
          fmtNaN: LG.fmtPts(NaN), fmtStr: LG.fmtPts("x"), fmtInf: LG.fmtPts(Infinity),
          fmtNull: LG.fmtPts(null), fmtNum: LG.fmtPts(12.34), fmtNeg: LG.fmtPts(-3),
          nUndef: LG.n ? LG.n(undefined) : "no LG.n", nStr: LG.n ? LG.n("3.5") : null, nGood: LG.n ? LG.n(-2) : null,
          numNaN: LG.fmtNum ? LG.fmtNum(NaN) : "no LG.fmtNum", numOk: LG.fmtNum ? LG.fmtNum(3.14159, 2) : null,
        };
      });
      ok(Number.isFinite(u.strScoring), "a non-numeric SCORING value no longer makes a score NaN (" + u.strScoring + ")");
      ok(Number.isFinite(u.objUnusedKey) && u.objUnusedKey === u.clean,
        "…and a bad value on a key this player has NONE of no longer poisons him — `0 * {}` was NaN for every player (" + u.objUnusedKey + ")");
      ok(Number.isFinite(u.nanBracket), "a NaN points-allowed bracket no longer survives `?? 0` (" + u.nanBracket + ")");
      ok(Number.isFinite(u.emptyBracket) && typeof u.emptyBracket === "number",
        "…nor does a BLANK one, which used to turn the running total into a string (" + JSON.stringify(u.emptyBracket) + ")");
      ok(Number.isFinite(u.strStat), "a non-numeric STAT value no longer makes a score NaN (" + u.strStat + ")");
      ok(u.clean === 21.64, "…and a clean line still scores exactly what it always did (21.64)");
      ok(u.fmtNaN === "—" && u.fmtStr === "—" && u.fmtInf === "—",
        "LG.fmtPts renders '—' for NaN / a non-numeric string / Infinity — the display boundary");
      ok(u.fmtNull === "—" && u.fmtNum === "12.3" && u.fmtNeg === "-3.0",
        "…and is unchanged for null, for a real number and for a negative one (" + JSON.stringify([u.fmtNull, u.fmtNum, u.fmtNeg]) + ")");
      ok(u.nUndef === 0 && u.nStr === 3.5 && u.nGood === -2, "LG.n coerces a missing value to 0 and leaves real numbers alone");
      ok(u.numNaN === "—" && u.numOk === "3.14", "LG.fmtNum guards the raw toFixed sites the same way");
      // A weekly doc with a matchup missing its points can no longer NaN a whole season's PF.
      const pf = await page.evaluate(async () => {
        const LG = window.__GFFL__.LG;
        await LG.db.set("weekly_2026_w9", { kind: "weekly", week: 9, matchups: [{ home: 1, away: 2, homePts: 100 }] });
        const st = await LG.loadStandings();
        return { pf1: st[1].pf, pa1: st[1].pa, pf2: st[2].pf };
      });
      ok(Number.isFinite(pf.pf1) && Number.isFinite(pf.pa1) && Number.isFinite(pf.pf2),
        "a half-written matchup (no awayPts) leaves every points-for FINITE, not a column of NaN (" + JSON.stringify(pf) + ")");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AC5: the WRITER that could arm #2 — the rules editor may not persist a string into
    // a field that is a number. (keepers.waiverCost etc. are legitimately text and must still
    // round-trip, which is why the old code had a raw-string fallback at all.)
    {
      const { ctx, page, errors } = await newTestPage(browser, { docs: fullSeed().docs, pass: "amenfarms", team: 1, who: "Peter" });
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF, { waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.__GFFL__ && window.__GFFL__.LG.rules, { timeout: 12000 });
      await page.evaluate(() => window.__GFFL__.LG.ui.show("rules"));
      await sleep(400);
      await clickIn(page, "#rulesEdit");
      await page.waitForSelector(".redit", { timeout: 6000 });
      await page.evaluate(() => {
        const set = (k, v) => { const i = [...document.querySelectorAll(".redit")].find((x) => x.dataset.k === k); if (i) i.value = v; };
        set("scoring.rec", "");            // blank — what a commissioner clearing a box leaves
        set("scoring.pass_td", "4 pts");   // a fat-fingered unit
        set("scoring.dst_pa_0", "abc");    // outright garbage, in the bracket `??` never guarded
        set("scoring.rush_yd", "0.25");    // a legitimate edit, which must still land
      });
      await clickIn(page, "#rulesEdit"); // Save
      await sleep(700);
      const after = await page.evaluate(() => {
        const s = window.__GFFL__.LG.rules.scoring;
        return { rec: s.rec, pass_td: s.pass_td, dst_pa_0: s.dst_pa_0, rush_yd: s.rush_yd,
          waiverCost: window.__GFFL__.LG.rules.keepers.waiverCost };
      });
      ok(typeof after.rec === "number" && typeof after.pass_td === "number" && typeof after.dst_pa_0 === "number",
        "a blank / fat-fingered / garbage scoring box can never persist a STRING into the scoring table (" + JSON.stringify(after) + ")");
      ok(after.rec === 1 && after.pass_td === 4 && after.dst_pa_0 === 5,
        "…those three keep their previous values rather than being corrupted");
      ok(after.rush_yd === 0.25, "…while a legitimate numeric edit still saves");
      ok(after.waiverCost === "last-round", "…and a field that is legitimately TEXT still round-trips");
      // …and with the rules doc intact, scoring still works.
      const stillScores = await page.evaluate(() => {
        const { D } = window.__GFFL__;
        return D.score(D.normSlp({ rec: 5, rec_yd: 50 }));
      });
      ok(Number.isFinite(stillScores) && stillScores === 10,
        "a player still scores a real number after that save (5 rec + 50 yd = 10.0, got " + stillScores + ")");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AC6: D.projFor no longer WALKS the directory. It used to scan all 12,217 entries
    // looking for a matching espn_id — per player, per render.
    {
      fixture.prod2025 = true;
      const { ctx, page, errors } = await newTestPage(browser, prodSeed());
      await bootProd(page);
      const perf = await page.evaluate(() => {
        const d = window.__GFFL__.D;
        const map = d.S.slpPlayers;
        let iters = 0, gets = 0;
        const realIter = Map.prototype[Symbol.iterator].bind(map);
        map[Symbol.iterator] = function () { iters++; return realIter(); };
        const realGet = d.S.slpByEspn.get.bind(d.S.slpByEspn);
        d.S.slpByEspn.get = function (k) { gets++; return realGet(k); };
        const keys = ["4430807", "4239993", "4432708", "3121422", "9999999", "dst_KC"];
        for (let i = 0; i < 10; i++) for (const k of keys) { if (d._pidCache) d._pidCache.clear(); d.projFor(k); }
        map[Symbol.iterator] = Map.prototype[Symbol.iterator];
        d.S.slpByEspn.get = realGet;
        return { iters, gets, dirSize: map.size };
      });
      ok(perf.dirSize > 70, "the fixture directory is a real haystack, not a handful (" + perf.dirSize + " entries)");
      ok(perf.iters === 0, "60 uncached projFor calls iterate the directory ZERO times (" + perf.iters + ")");
      ok(perf.gets >= 40, "…they go through the O(1) espn_id INDEX instead (" + perf.gets + " index lookups)");
      // Positive answers memoize, so the steady state is cheaper still.
      const memo = await page.evaluate(() => {
        const d = window.__GFFL__.D;
        let gets = 0;
        const realGet = d.S.slpByEspn.get.bind(d.S.slpByEspn);
        d.S.slpByEspn.get = function (k) { gets++; return realGet(k); };
        if (d._pidCache) d._pidCache.clear();
        for (let i = 0; i < 20; i++) { if (d.pidForKey) d.pidForKey("4239993"); else realGet("4239993"); }
        d.S.slpByEspn.get = realGet;
        return gets;
      });
      ok(memo === 1, "…and a resolved key is memoized — 20 lookups cost exactly one index read (" + memo + ")");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
      fixture.prod2025 = false;
    }

    // ---- AC7: the SYMMETRIC half — a stat row for a player with no espn_id lands on the
    // ROSTER's own key, not an orphan "slp_<pid>" nothing reads.
    {
      fixture.prod2025 = true;
      const { ctx, page, errors } = await newTestPage(browser, prodSeed());
      await bootProd(page);
      const keys = await page.evaluate(() => {
        const d = window.__GFFL__.D;
        const rostered = new Set();
        for (const tid in window.__GFFL__.LG.ui._rosters) for (const p of window.__GFFL__.LG.ui._rosters[tid]) rostered.add(String(p.key));
        const rosteredWithRows = [...rostered].filter((k) => d.S.players.has(k));
        // A "slp_" row is only legitimate for someone NOBODY rosters (the filler crowd) — for a
        // rostered player it is the orphan this bug was made of.
        const nameOf = (k) => { for (const tid in window.__GFFL__.LG.ui._rosters) { const p = (window.__GFFL__.LG.ui._rosters[tid] || []).find((x) => String(x.key) === k); if (p) return p.name; } return null; };
        const orphanedRostered = [...rostered].filter((k) => !d.S.players.has(k)
          && [...d.S.players.keys()].some((x) => x.startsWith("slp_") && d.S.players.get(x).pos !== "DST" && nameOf(k) && d.normName(d.S.players.get(x).name) === d.normName(nameOf(k))));
        return { rosteredWithRows: rosteredWithRows.length, orphanedRostered };
      });
      // Bijan (ATL, final), Achane/Harrison/McLaurin/Croskey-Merritt/Higgins/DeVonta Smith
      // (live), McLaughlin (final), dst_DAL (live) all have rows keyed by the ROSTER's key.
      ok(keys.rosteredWithRows >= 9,
        "at least 9 rostered players have a live row under their OWN roster key (" + keys.rosteredWithRows + ")");
      ok(keys.orphanedRostered.length === 0,
        "…and not one rostered player's stats sit in an orphan slp_<pid> row instead (" + JSON.stringify(keys.orphanedRostered) + ")");
      const bijan = await page.evaluate(() => {
        const d = window.__GFFL__.D;
        return { onRosterKey: d.S.players.has("4430807"), orphaned: d.S.players.has("slp_8155") };
      });
      ok(bijan.onRosterKey && !bijan.orphaned,
        "Bijan's stats land on the roster's key '4430807', NOT the orphan 'slp_8155' (" + JSON.stringify(bijan) + ")");
      // The season columns (D.weekStats) key the same way, so his history resolves too.
      const hist = await page.evaluate(async () => {
        const LG = window.__GFFL__.LG, d = window.__GFFL__.D;
        await LG.db.set("weekly_2025_w1", { kind: "weekly", week: 1, matchups: [{ home: 1, away: 2, homePts: 100, awayPts: 90 }] });
        const log = await d.gameLog("4430807");
        return { rows: log.rows.length, total: log.total };
      });
      ok(hist.rows === 1 && hist.total === 21.7,
        "…and his archived season history resolves under the same key (21.7 for week 1, got " + JSON.stringify(hist) + ")");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
      fixture.prod2025 = false;
    }

    if (SHOTS) {
      fixture.prod2025 = true;
      const { ctx, page } = await newTestPage(browser, prodSeed());
      await bootProd(page);
      await page.evaluate(() => window.__GFFL__.LG.ui.show("matchup"));
      await sleep(900);
      await page.screenshot({ path: path.join(ROOT, "shots", "gffl_nanfix_matchup_390.png") });
      await page.setViewport({ width: 1440, height: 900 });
      await sleep(400);
      await page.screenshot({ path: path.join(ROOT, "shots", "gffl_nanfix_matchup_desktop.png") });
      await ctx.close();
      fixture.prod2025 = false;
    }
  }

  // ================================================================================
  //  AD · the 2026-08-09 playtest batch (thirteen items from one session at the wheel)
  // ================================================================================
  // Every check here is behaviour or GEOMETRY, never "the markup contains a class name" —
  // three of these items are layout complaints ("cuts off player names", "slim it down by
  // half"), and a markup assertion cannot tell you whether a name fits.
  // The before-numbers quoted in the budgets are MEASURED, at 390x844, against the pre-batch
  // code (scratchpad probe, then re-confirmed by stashing the three app files back to HEAD).
  section("AD · playtest batch 2026-08-09 — feed, slot colours, bench, logos, possession, headers, nav, locks, injuries, Moves");
  {
    // ---- AD1: the matchup feed is a bounded scroll box, attributed per team, filterable.
    {
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await waitLive(page);
      await clickIn(page, ".mucard.mine");
      await page.waitForSelector(".muhead", { timeout: 9000 });
      fixture.phase = 2;
      await poll(page);
      // Enough events to make the box genuinely overflow. Pushed straight into the live
      // engine's own event list (the same shape applySide produces) and re-rendered — the
      // feature under test is the BOX, not how many stats a fixture happens to move.
      await page.evaluate(async () => {
        const { D, UI } = window.__GFFL__;
        for (let i = 0; i < 40; i++) {
          D.S.events.unshift({ t: Date.now(), key: i % 2 ? "3915511" : "222111",
            name: i % 2 ? "P. Passer" : "Q. Rival", stat: "rec_yd", from: i, to: i + 1, dPts: 0.1 });
        }
        await UI.renderMatchup(true);
      });
      const box = await page.evaluate(() => {
        const el = document.querySelector("#mufeed");
        const cs = getComputedStyle(el);
        return { h: Math.round(el.clientHeight), sh: el.scrollHeight, oy: cs.overflowY,
                 maxH: cs.maxHeight, ob: cs.overscrollBehaviorY, lines: el.querySelectorAll(".fline").length };
      });
      ok(box.oy === "auto" && box.maxH !== "none", "the feed is a bounded box (overflow-y " + box.oy + ", max-height " + box.maxH + ")");
      ok(box.h > 0 && box.h <= 320, "…capped at roughly a third of a phone screen, not the whole page (" + box.h + "px)");
      ok(box.sh > box.h + 20, "…and it really SCROLLS with a busy feed (" + box.sh + " of content in " + box.h + "px)");
      ok(box.ob === "contain", "…with overscroll-behavior:contain, so a rubber-band drag stops at its own edge");
      // Attribution: every non-system line names the team it came from.
      const attr = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("#mufeed .fline")].filter((r) => !r.classList.contains("sys"));
        const chips = rows.map((r) => { const c = r.querySelector(".fteam"); return c ? c.textContent.trim() : null; });
        const passer = rows.find((r) => r.textContent.includes("P. Passer"));
        const rival = rows.find((r) => r.textContent.includes("Q. Rival"));
        const tag = (r) => { const c = r && r.querySelector(".fteam"); return c ? c.textContent.trim() : null; };
        return {
          total: rows.length, missing: chips.filter((c) => !c).length,
          tags: [...new Set(chips)].sort(),
          passerTag: tag(passer), passerSide: passer && passer.className,
          rivalTag: tag(rival), rivalSide: rival && rival.className,
        };
      });
      ok(attr.total > 0 && attr.missing === 0, "every feed event carries a team chip (" + attr.total + " lines, " + attr.missing + " unattributed)");
      ok(attr.passerTag === "T1" && /home/.test(attr.passerSide), "…a home starter's line is tagged with the HOME team (" + attr.passerTag + ")");
      ok(attr.rivalTag === "T2" && /away/.test(attr.rivalSide), "…and an away starter's with the away team (" + attr.rivalTag + ")");
      // The filter: three chips, Both selected, and picking a side is a pure re-render.
      const chips0 = await page.$$eval("#mufeedFilter .poschip", (els) => els.map((e) => e.textContent.trim() + (e.classList.contains("on") ? "*" : "")));
      ok(chips0.join("|") === "Both*|T2|T1", "the feed carries a Both / away / home filter, defaulting to Both (" + chips0.join("|") + ")");
      const before = await page.evaluate(() => {
        window.__GFFL__.UI.__adMark = document.querySelector("#aiReadOut");
        window.__GFFL__.UI.__adMark.dataset.adMarker = "1";
        return { calls: Object.values(window.__GFFL__.D.EP).reduce((s, e) => s + e.n, 0), all: (window.__GFFL__.UI._feedAll || []).length };
      });
      await clickIn(page, "#mufeedFilter .poschip", "T2");
      await sleep(120);
      const after = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("#mufeed .fline")];
        return {
          calls: Object.values(window.__GFFL__.D.EP).reduce((s, e) => s + e.n, 0),
          all: (window.__GFFL__.UI._feedAll || []).length,
          shown: rows.length,
          onlyAway: rows.every((r) => r.classList.contains("away")),
          markerAlive: !!document.querySelector('[data-ad-marker="1"]'),
          side: window.__GFFL__.UI._feedSide,
        };
      });
      ok(after.side === "a" && after.shown > 0 && after.onlyAway, "picking the away team leaves only that team's events (" + after.shown + " lines)");
      ok(after.shown < attr.total, "…strictly fewer than Both showed (" + after.shown + " of " + attr.total + ")");
      ok(after.calls === before.calls && after.all === before.all, "…and it re-filters what is already in memory — zero new upstream calls (" + before.calls + "->" + after.calls + ")");
      ok(after.markerAlive, "…repainting the feed alone, never the whole page (the AI-read card survived untouched)");
      // A side with nothing says so rather than looking broken.
      await page.evaluate(() => {
        const { D, UI } = window.__GFFL__;
        D.S.events.length = 0;
        D.S.events.push({ t: Date.now(), key: "3915511", name: "P. Passer", stat: "rec_yd", from: 0, to: 1, dPts: 0.1 });
        return UI.renderMatchup(true);
      });
      await clickIn(page, "#mufeedFilter .poschip", "T2");
      await sleep(120);
      ok(/Nothing from T2 yet/.test(await text(page, "#mufeed") || ""), "a side with no events yet says so plainly");
      // Opening a DIFFERENT matchup starts on Both again — the filter is per-matchup.
      await clickIn(page, '.bnav button[data-v="league"]');
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await clickIn(page, ".mucard:not(.mine)");
      await page.waitForSelector(".muhead", { timeout: 9000 });
      ok((await page.evaluate(() => window.__GFFL__.UI._feedSide)) === "both", "…and a different matchup starts on Both, never inheriting the last one's side");
      if (SHOTS) {
        // The feed is item 1 and lives well below the fold — a top-of-page plate would never
        // show it, so this one is framed on the feed card itself. Back on the USER'S OWN
        // matchup first: the check just above deliberately left us on another league game,
        // whose starters have no events at all, so a plate taken there would be an empty box.
        fs.mkdirSync(path.join(ROOT, "shots"), { recursive: true });
        await clickIn(page, '.bnav button[data-v="matchup"]');
        await page.waitForSelector(".muhead", { timeout: 9000 });
        await page.evaluate(async () => {
          const { D, UI } = window.__GFFL__;
          for (let i = 0; i < 24; i++) {
            D.S.events.unshift({ t: Date.now(), key: i % 2 ? "3915511" : "222111",
              name: i % 2 ? "P. Passer" : "Q. Rival", stat: i % 3 ? "rec_yd" : "rush_td", from: i, to: i + 1, dPts: i % 3 ? 0.4 : 6 });
          }
          await UI.renderMatchup(true);
          const c = document.querySelector("#mufeed").closest(".card");
          window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 60);
        });
        await sleep(300);
        await page.screenshot({ path: path.join(ROOT, "shots", "gffl_pt_feed_390.png") });
        console.log("  📸 shots/gffl_pt_feed_390.png");
      }
      ok(errors.length === 0, "0 page errors");
      fixture.phase = 1;
      await ctx.close();
    }

    // ---- AD2/AD3/AD5/AD6: the matchup page — slot colours, the bench, possession, the header.
    {
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await waitLive(page);
      await clickIn(page, ".mucard.mine");
      await page.waitForSelector(".muhead", { timeout: 9000 });

      // AD2 — the slot badge between the two teams takes the DRAFT's position palette.
      const slots = await page.evaluate(() => {
        const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
        const root = getComputedStyle(document.documentElement);
        const want = {};
        for (const p of ["QB", "RB", "WR", "TE", "K", "DST", "X"]) want[p] = hex(root.getPropertyValue("--pos-" + p).trim());
        // The colour lives on the badge INSIDE the cell, so read the badge (a full-cell tint
        // was the first cut and reads as a slab of colour — see the CSS note in league.html).
        const paint = (td) => { const b = td && (td.querySelector(".slotbadge") || td); return b && { pos: td.dataset.pos, bg: getComputedStyle(b).backgroundColor, h: Math.round(b.getBoundingClientRect().height) }; };
        const cells = [...document.querySelectorAll(".mutable:not(.benchtable) tbody td.slotcell")].map((td) => ({
          slot: td.textContent.trim(), ...paint(td), cellH: Math.round(td.getBoundingClientRect().height),
        }));
        return { want, cells,
          bench: paint(document.querySelector(".benchtable td.slotcell")),
          tot: paint(document.querySelector(".totalrow td.slotcell")) };
      });
      const matched = slots.cells.filter((c) => slots.want[c.pos] === c.bg);
      ok(matched.length === slots.cells.length,
        "every slot badge is painted with its own --pos-* draft colour (" + matched.length + "/" + slots.cells.length + ")");
      const distinct = new Set(slots.cells.map((c) => c.bg));
      ok(distinct.size >= 6, "…and the positions are genuinely different colours, not one tint (" + distinct.size + " distinct)");
      // RESTAGED 2026-08-09 (ITEM 23) — SUPERSEDED, in the opposite direction. This used to
      // assert the badge was a compact pill inside its cell; the user has since asked for the
      // colour to "take up the width and height of the column so there isn't blank space", so
      // filling the cell IS the requirement now. Same measurement, inverted expectation.
      const short = slots.cells.filter((c) => c.h < c.cellH - 1);
      ok(short.length === 0, "…and it FILLS its cell top to bottom, no blank band above or below (" + slots.cells.map((c) => c.h + "/" + c.cellH).join(" ") + ")");
      const flex = slots.cells.find((c) => c.slot === "FLEX");
      ok(!!flex && flex.pos === "X" && flex.bg === slots.want.X, "FLEX is not a single position, so it takes the neutral --pos-X");
      ok(slots.bench && slots.bench.pos === "X" && slots.bench.bg === slots.want.X, "…as do BENCH");
      ok(slots.tot && slots.tot.pos === "X" && slots.tot.bg === slots.want.X, "…and the TOT row");

      // AD3 — the bench renders exactly like the starters, and never pans sideways.
      const bench = await page.evaluate(() => {
        const st = document.querySelector(".mutable:not(.benchtable)");
        const bn = document.querySelector(".benchtable");
        const cell = (t) => t.querySelector("tbody td.slotcell");
        const pan = bn.closest(".panner");
        return {
          benchIsMutable: bn.classList.contains("mutable"),
          layout: [getComputedStyle(st).tableLayout, getComputedStyle(bn).tableLayout],
          ws: [getComputedStyle(st.querySelector("tbody td")).whiteSpace, getComputedStyle(bn.querySelector("tbody td")).whiteSpace],
          slotW: [Math.round(cell(st).getBoundingClientRect().width), Math.round(cell(bn).getBoundingClientRect().width)],
          panOverflow: pan.scrollWidth - pan.clientWidth,
          body: document.body.scrollWidth, win: window.innerWidth,
        };
      });
      ok(bench.benchIsMutable, "the bench table carries the same .mutable formatting as the starters");
      ok(bench.layout[0] === "fixed" && bench.layout[1] === "fixed", "…the same fixed table layout (" + bench.layout.join("/") + ")");
      ok(bench.ws[0] === "normal" && bench.ws[1] === "normal", "…the same wrapping cells (" + bench.ws.join("/") + ")");
      ok(bench.slotW[0] === bench.slotW[1], "…and identical column widths (" + bench.slotW.join(" vs ") + ")");
      ok(bench.panOverflow <= 1, "…so the bench needs NO horizontal scrolling at 390px (overflow " + bench.panOverflow + "px)");
      ok(bench.body <= bench.win + 1, "…and the page itself still never scrolls sideways");

      // AD5 — possession: only the offence, never the defence, never a finished/pre game.
      const poss = await page.evaluate(() => {
        const d = window.__GFFL__.D;
        const cellFor = (nm) => {
          const tr = [...document.querySelectorAll(".mutable tbody tr")].find((r) => r.textContent.includes(nm));
          const g = tr && [...tr.querySelectorAll(".pcellgrid")].find((c) => c.textContent.includes(nm));
          // RESTAGED 2026-08-09 (ITEM 25): the pip is gone — possession is a gold ring on the
          // half-cell now. Read the painted shadow, not a marker element.
          return g && { ball: g.classList.contains("hasball"), ring: /rgb\(255, 182, 18\)/.test(getComputedStyle(g).boxShadow || ""),
                        h: Math.round(g.getBoundingClientRect().height) };
        };
        return {
          phi: d.S.games.get("PHI") && d.S.games.get("PHI").poss,
          dal: d.S.games.get("DAL") && d.S.games.get("DAL").poss,
          passer: cellFor("P. Passer"), receiver: cellFor("W. Receiver"),
          phiDst: cellFor("PHI D/ST"), rusher: cellFor("R. Rusher"),
        };
      });
      ok(poss.phi === true && poss.dal === false, "the drive's own team is recorded as having the ball, its opponent is not (PHI " + poss.phi + " / DAL " + poss.dal + ")");
      ok(poss.passer && poss.passer.ball && poss.passer.ring, "a PHI starter is highlighted with a gold possession ring");
      ok(poss.receiver && poss.receiver.ball, "…so is his team-mate");
      ok(poss.phiDst && !poss.phiDst.ball && !poss.phiDst.ring, "…but PHI's D/ST is NOT — its side has the ball, so the defence is off the field");
      // The ring is PAINTED, not laid out — a highlighted half-cell measures exactly the same
      // height as an un-highlighted one, so item 23/AE's "every player the same height" rule
      // survives possession appearing and disappearing mid-game.
      ok(poss.passer && poss.rusher && poss.passer.h === poss.rusher.h,
        "…and the ring costs the row no height at all (" + poss.passer.h + " vs " + poss.rusher.h + ")");
      ok(poss.rusher && !poss.rusher.ball, "…and nobody on the other team is highlighted");
      // It survives a bare scoreboard tick — the scoreboard carries no drive at all, so a
      // rebuild that forgot to carry it would blank the highlight between summary polls.
      const kept = await page.evaluate(async () => {
        await window.__GFFL__.D.pollScoreboard();
        return window.__GFFL__.D.S.games.get("PHI").poss;
      });
      ok(kept === true, "…and it survives a scoreboard-only refresh instead of flickering off (" + kept + ")");

      // AD6 — the header card, halved.
      const head = await page.evaluate(() => {
        const h = document.querySelector(".muhead");
        const txt = h.textContent.replace(/\s+/g, " ");
        return {
          height: Math.round(h.getBoundingClientRect().height),
          wp: !!h.querySelector(".wpfill"), live: !!h.querySelector(".mulive"),
          avatars: h.querySelectorAll(".muavatar").length,
          pts: [...h.querySelectorAll(".bigpts")].map((e) => e.textContent.trim()),
          proj: [...h.querySelectorAll(".muhproj")].map((e) => e.textContent.trim()),
          toPlay: /to play/.test(txt), live2: /live/.test(txt),
          names: /Battle Kreussers/.test(txt) && /End Zone Goats/.test(txt),
        };
      });
      // MEASURED before this batch, same fixture, same viewport: 220px.
      ok(head.height <= 120, "the matchup header is halved — 220px before this batch, " + head.height + "px now");
      ok(head.wp && head.live, "…with the win-probability bar and the live/Final indicator both still on it");
      ok(head.avatars === 2 && head.names && head.pts.join("/") === "4.0/41.0", "…both crests, both names, both scores");
      // RESTAGED 2026-08-09 (the ESPN header rebuild): the projection is still there, on both
      // sides, but as a BARE muted number under the score — the reference carries no "Proj"
      // label, so /proj/i is no longer the right way to ask whether it survived.
      ok(head.proj.length === 2 && head.proj.every((t) => /^\d+(\.\d)?$/.test(t)),
        "…and both projections survive, as bare numbers rather than a labelled 'proj N' (" + JSON.stringify(head.proj) + ")");
      ok(head.toPlay && head.live2, "…as do the to-play/live counts");
      if (SHOTS) {
        fs.mkdirSync(path.join(ROOT, "shots"), { recursive: true });
        await page.screenshot({ path: path.join(ROOT, "shots", "gffl_pt_matchup_390.png") });
        await page.setViewport({ width: 1440, height: 900 });
        await sleep(350);
        await page.evaluate(() => window.__GFFL__.UI.renderMatchup(true));
        await sleep(250);
        await page.screenshot({ path: path.join(ROOT, "shots", "gffl_pt_matchup_desktop.png") });
        console.log("  📸 shots/gffl_pt_matchup_{390,desktop}.png");
      }
      ok(errors.length === 0, "0 page errors on the matchup page");
      await ctx.close();
    }

    // ---- AD7: the Matchup TAB always lands on the logged-in user's own game.
    {
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await waitLive(page);
      await clickIn(page, ".mucard:not(.mine)");
      await page.waitForSelector(".muhead", { timeout: 9000 });
      const other = await page.evaluate(() => window.__GFFL__.UI.matchup);
      ok(other && other[0] !== 1 && other[1] !== 1, "tapping another league game opens THAT matchup (" + JSON.stringify(other) + ")");
      // A live repaint must NEVER yank a reader out of a game they deliberately opened.
      await page.evaluate(() => window.__GFFL__.UI.renderMatchup(true));
      await sleep(150);
      ok(JSON.stringify(await page.evaluate(() => window.__GFFL__.UI.matchup)) === JSON.stringify(other),
        "…and a live repaint leaves them in it");
      await clickIn(page, '.bnav button[data-v="league"]');
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await clickIn(page, '.bnav button[data-v="matchup"]');
      await page.waitForSelector(".muhead", { timeout: 9000 });
      const mineNow = await page.evaluate(() => window.__GFFL__.UI.matchup);
      ok(JSON.stringify(mineNow) === "[1,2]", "…but pressing the Matchup TAB always returns to the user's own game (" + JSON.stringify(mineNow) + ")");
      const shown = await page.evaluate(() => document.querySelector(".muhead").textContent);
      ok(/Battle Kreussers/.test(shown), "…and that is the game on screen, not merely the state variable");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AD4: NFL crests on the Scores tab, live board AND the 2025 replay.
    {
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await waitLive(page);
      await page.evaluate(() => window.__GFFL__.UI.show("scores"));
      await page.waitForSelector(".sccard", { timeout: 9000 });
      // The crest is a real (intercepted) network image, so "did it load?" cannot be SAMPLED
      // the instant the card appears — under load the request is still in flight and the read
      // comes back neither loaded nor errored (complete:false, visibility:visible, because
      // onerror hasn't fired either). Wait for every crest to SETTLE one way or the other, then
      // assert which way it went; a genuinely broken image still fails this, it just fails
      // deterministically instead of racing.
      await page.waitForFunction(
        () => [...document.querySelectorAll("img.sclogo")].every((i) => i.complete),
        { timeout: 9000 },
      );
      const logos = await page.evaluate(() => {
        const cards = [...document.querySelectorAll(".sccard")];
        // Per TEAM span, never per card: a card holds two teams and only one of them is the
        // one under test (DEN is the fixture's deliberately crest-less team, and it shares a
        // card with KC, which has one).
        const spanFor = (ab) => {
          for (const c of cards) for (const s of c.querySelectorAll(".scteam")) {
            const b = s.querySelector("b");
            if (b && b.textContent.trim() === ab) return s;
          }
          return null;
        };
        const phi = spanFor("PHI"), den = spanFor("DEN");
        const img = phi && phi.querySelector("img.sclogo");
        const r = img && img.getBoundingClientRect();
        return {
          total: document.querySelectorAll("img.sclogo").length,
          src: img && img.getAttribute("src"),
          size: r && [Math.round(r.width), Math.round(r.height)],
          loaded: !!(img && img.complete && img.naturalWidth > 0),
          vis: img && getComputedStyle(img).visibility,
          denImgs: den ? den.querySelectorAll("img.sclogo").length : -1,
          kcImgs: (spanFor("KC") || { querySelectorAll: () => [] }).querySelectorAll("img.sclogo").length,
          heights: cards.map((c) => Math.round(c.querySelector(".scteams").getBoundingClientRect().height)),
          abbrevs: cards.map((c) => [...c.querySelectorAll(".scteam b")].map((b) => b.textContent.trim()).join("@")),
        };
      });
      ok(logos.total >= 3, "the NFL scoreboard renders team crests (" + logos.total + " on the board)");
      ok(/teamlogos\/nfl\/500\/phi\.png$/.test(logos.src || ""), "…from the slate's own team.logo URL (" + logos.src + ")");
      ok(logos.size && logos.size[0] === 22 && logos.size[1] === 22, "…at a fixed 22x22, so a slow crest can't shift the score (" + JSON.stringify(logos.size) + ")");
      ok(logos.loaded === true && logos.vis === "visible", "…and the image genuinely LOADED and is on screen, not a hidden broken box (" + logos.loaded + "/" + logos.vis + ")");
      ok(logos.denImgs === 0 && logos.kcImgs === 1, "a team with NO crest in the payload renders no image at all — never a broken one (DEN " + logos.denImgs + ", its opponent KC " + logos.kcImgs + ")");
      ok(new Set(logos.heights).size === 1, "…and the crest-less row is exactly as tall as the others (" + logos.heights.join("/") + ")");
      ok(logos.abbrevs.every((a) => a.length >= 3), "…with the abbreviations still there beside them (" + logos.abbrevs.join(" ") + ")");
      if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_pt_scores_390.png") }); console.log("  📸 shots/gffl_pt_scores_390.png"); }
      ok(errors.length === 0, "0 page errors on the Scores tab");
      await ctx.close();
    }

    // ---- AD4b/AD5b: the 2025 REPLAY — crests come through its own (different) slate parser,
    // and with no drive data at all nobody is ever highlighted.
    {
      fixture.rich2025 = true;
      const { ctx, page, errors } = await newTestPage(browser, { docs: { ...seedTeams() }, pass: "amenfarms", team: 1, who: "Peter" });
      await page.goto(BASE + "/league.html?fam=" + FAM + "&simspeed=0", { waitUntil: "networkidle0" });
      await page.waitForFunction(() => !!window.__GFFL__, { timeout: 12000 });
      ok(await waitOr(page, ".mucard", 25000), "the 2025 replay boots (its own historical-slate parser, not pollScoreboard)");
      await page.waitForFunction(() => window.__GFFL__.D.S.nflEvents.length > 0, { timeout: 15000 });
      await page.evaluate(() => window.__GFFL__.UI.show("scores"));
      await page.waitForSelector(".sccard", { timeout: 15000 });
      const rep = await page.evaluate(() => ({
        logos: document.querySelectorAll("img.sclogo").length,
        poss: [...window.__GFFL__.D.S.games.values()].filter((g) => g.poss).length,
      }));
      ok(rep.logos >= 4, "…and its crests reach the board too (" + rep.logos + ")");
      await page.evaluate(() => window.__GFFL__.UI.show("matchup"));
      await page.waitForSelector(".muhead", { timeout: 15000 });
      const noBall = await page.evaluate(() => document.querySelectorAll(".pcellgrid.hasball, .possdot").length);
      ok(rep.poss === 0 && noBall === 0, "the replay has no drive data, so nobody is highlighted — it degrades to silence, not to noise");
      ok(errors.length === 0, "0 page errors under the replay");
      await ctx.close();
      fixture.rich2025 = false;
    }

    // ---- AD8/AD9/AD10/AD11: My Team — names that fit, a greyed Swap, a half-height header,
    // and injury designations that never label a healthy player.
    {
      fixture.injMix = true;
      const { ctx, page, errors } = await newTestPage(browser, seedLongNames());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await waitLive(page);
      await clickIn(page, '.bnav button[data-v="team"]');
      await page.waitForSelector(".lrow", { timeout: 9000 });

      // AD8 — the name column. MEASURED before this batch at 390px: 94px wide on a plain
      // roster (every name wrapping to THREE lines, and "C. McLaughlin K · TB" overflowing its
      // box outright at scrollWidth 97 > clientWidth 94) and collapsing to as little as 10px
      // here, where a real-length name shares the row with an injury chip — this same block
      // reports 5 of 12 names clipped and one wrapping SEVEN lines against the pre-batch code.
      const names = await page.evaluate(() => [...document.querySelectorAll(".lname")].map((el) => {
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
        return { t: el.textContent.replace(/\s+/g, " ").trim(), w: Math.round(el.clientWidth),
                 clipped: el.scrollWidth > el.clientWidth + 1, lines: Math.round(el.getBoundingClientRect().height / lh) };
      }));
      const clipped = names.filter((n) => n.clipped);
      ok(names.length >= 9 && clipped.length === 0, "no player name is clipped at 390px (" + clipped.length + " of " + names.length + " clipped)");
      ok(names.every((n) => n.w >= 140), "…because the name column is a real share of the row now — 94px on a plain roster and as little as 10px here before, " + Math.min(...names.map((n) => n.w)) + "px+ now");
      ok(names.every((n) => n.lines <= 2), "…and no name wraps past two lines (worst " + Math.max(...names.map((n) => n.lines)) + ")");
      ok(names.some((n) => /McLaughlin/.test(n.t)), "…including the one that used to overflow outright");

      // AD10 — the team-name card, halved. Measured before this batch: 182px.
      const lh = await page.evaluate(() => {
        const h = document.querySelector(".lockerhead");
        return { height: Math.round(h.getBoundingClientRect().height),
                 logo: !!h.querySelector(".lockerlogo"), name: (h.querySelector(".lockername") || {}).textContent,
                 rec: /PF/.test(h.textContent), edit: h.querySelectorAll(".lockeredit button").length };
      });
      ok(lh.height <= 110, "the team-name card is halved — 182px before this batch, " + lh.height + "px now");
      ok(lh.logo && /Battle Kreussers/.test(lh.name || "") && lh.rec, "…keeping the crest, the name and the record");
      ok(lh.edit === 3, "…and the owner's Name / Motto / Logo controls");

      // AD11 — injury designations.
      const inj = await page.evaluate(() => {
        const rowFor = (nm) => [...document.querySelectorAll(".lrow")].find((r) => r.textContent.includes(nm));
        const chip = (nm) => { const r = rowFor(nm); const c = r && r.querySelector(".inj"); return c ? c.textContent.trim() : null; };
        return {
          activeQb: chip("M. Harrison Jr."),   // directory says "Active"
          questionable: chip("A. St. Brown"),  // "Questionable"
          doubtful: chip("C. McCaffrey"),      // "Doubtful"
          out: chip("R. Odunze"),              // "Out"
          pup: chip("L. McConkey"),            // "PUP" — unanticipated, must still show
          anyActiveWord: /\bActive\b/.test(document.body.textContent),
        };
      });
      ok(inj.activeQb === null, "an ACTIVE player carries no injury chip at all — not an \"Active\" label");
      ok(!inj.anyActiveWord, "…and the word Active appears nowhere on the page");
      ok(inj.questionable === "Q", "Questionable renders as Q (" + inj.questionable + ")");
      ok(inj.doubtful === "D", "Doubtful renders as D (" + inj.doubtful + ")");
      ok(inj.out === "OUT", "Out renders as OUT (" + inj.out + ")");
      ok(inj.pup === "PUP", "…and an unanticipated-but-real designation still shows something (" + inj.pup + ")");
      // The mapping itself, directly.
      const map = await page.evaluate(() => {
        const f = window.__GFFL__.LG.injLabel;
        if (typeof f !== "function") return ["no injLabel hook"];
        return ["", "Active", "ACT", "Healthy", "Questionable", "q", "Q", "Doubtful", "D", "Out", "O", "OUT", "IR", "PUP", "Suspended", "Day-To-Day"].map((v) => v + "=>" + f(v));
      });
      ok(map.join("|") === "=>|Active=>|ACT=>|Healthy=>|Questionable=>Q|q=>Q|Q=>Q|Doubtful=>D|D=>D|Out=>OUT|O=>OUT|OUT=>OUT|IR=>IR|PUP=>PUP|Suspended=>SUS|Day-To-Day=>DAY",
        "…and the mapping is case-insensitive, idempotent and never silently swallows a status (" + map.join(" ") + ")");
      // IR eligibility still reads the RAW value, not the abbreviation.
      const ir = await page.evaluate(() => ({
        raw: window.__GFFL__.LG.irEligible("Out"), abbr: window.__GFFL__.LG.irEligible("OUT"),
      }));
      ok(ir.raw === true, "IR eligibility still reads the RAW upstream value (\"Out\" is IR-eligible)");
      await clickChildIn(page, ".lrow", ".lswap", "R. Odunze");
      await page.waitForSelector(".swaprow", { timeout: 5000 });
      const sheetIr = await page.$$eval(".swaprow", (els) => els.map((r) => r.textContent.replace(/\s+/g, " ").trim()));
      ok(sheetIr.some((t) => /→ IR/.test(t)), "…so the OUT player is still offered IR from the swap sheet");
      await page.evaluate(() => { const c = [...document.querySelectorAll(".swaprow")].find((r) => /Cancel/.test(r.textContent)); if (c) c.click(); });
      // The swap sheet's own candidate rows go through the same injChip — a non-vacuous check
      // needs a candidate who actually HAS a designation, so this opens the FLEX slot, whose
      // bench candidates include the PUP running back.
      await clickChildIn(page, ".lrow", ".lswap", "K. Walker III");
      await page.waitForSelector(".swaprow", { timeout: 5000 });
      const sheet = await page.evaluate(() => {
        const rows = [...document.querySelectorAll(".swaprow")];
        const mc = rows.find((r) => r.textContent.includes("L. McConkey"));
        return { chip: mc && (mc.querySelector(".inj") || {}).textContent,
                 chips: [...new Set(rows.map((r) => (r.querySelector(".inj") || {}).textContent).filter(Boolean))],
                 longWord: rows.some((r) => /Questionable|Doubtful|\bActive\b/.test(r.textContent)) };
      });
      ok(sheet.chip === "PUP", "…and the sheet's own candidate rows abbreviate the same way (" + sheet.chip + ")");
      ok(!sheet.longWord && sheet.chips.length >= 1, "…never printing the long upstream word (" + JSON.stringify(sheet.chips) + ")");
      await page.evaluate(() => { const c = [...document.querySelectorAll(".swaprow")].find((r) => /Cancel/.test(r.textContent)); if (c) c.click(); });

      // AD9 — the greyed Swap says what the LOCKED word used to.
      const swap = await page.evaluate(() => {
        const locked = [...document.querySelectorAll(".lrow.locked")];
        const b = locked[0] && locked[0].querySelector(".lswap");
        return {
          n: locked.length, disabled: b && b.disabled, title: b && b.title,
          aria: b && b.getAttribute("aria-label"),
          opacity: b && Number(getComputedStyle(b).opacity),
          h: b && Math.round(b.getBoundingClientRect().height),
          copy: /greyed-out Swap/.test(document.body.textContent), lockWord: /LOCKED/.test(document.body.textContent),
        };
      });
      ok(swap.n > 0 && swap.disabled === true, "a locked slot's Swap button is genuinely disabled (" + swap.n + " locked)");
      ok(/started/.test(swap.title || "") && /started/.test(swap.aria || ""), "…and says why, for a pointer and for a screen reader");
      ok(swap.opacity < 0.6, "…rendering as greyed out, not merely inert (opacity " + swap.opacity + ")");
      ok(swap.h >= 30, "…at the same size it always was, so a kickoff never reflows the row (" + swap.h + "px)");
      ok(swap.copy && !swap.lockWord, "…and the help line explains the greying instead of a LOCKED word");
      if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_pt_myteam_390.png") }); console.log("  📸 shots/gffl_pt_myteam_390.png"); }

      // AD11b — the same rule at the players table and the player stats card.
      await clickIn(page, '.bnav button[data-v="moves"]');
      await page.waitForSelector("#faResults .faTable", { timeout: 12000 });
      const faInj = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("#faResults tbody tr")];
        const agent = rows.find((r) => r.textContent.includes("F. Agent"));
        return { agent: agent && (agent.querySelector(".inj") || {}).textContent,
                 anyLongWord: rows.some((r) => /Questionable|Doubtful|Active/.test(r.textContent)) };
      });
      ok(faInj.agent === "Q", "the players table abbreviates a designation too (" + faInj.agent + ")");
      ok(!faInj.anyLongWord, "…and never prints the long upstream word");
      await page.evaluate(() => window.__GFFL__.UI.openPlayerCard("111666"));
      await page.waitForFunction(() => { const c = document.querySelector(".pccard .pcname"); return c && !/Loading/.test(c.textContent); }, { timeout: 9000 });
      const card = await page.evaluate(() => {
        const el = document.querySelector(".pccard .inj");
        return { chip: el && el.textContent.trim(), head: document.querySelector(".pchead").textContent.replace(/\s+/g, " ") };
      });
      ok(card.chip === "OUT", "the player stats card abbreviates it as well (" + card.chip + ")");
      ok(!/\bOut\b/.test(card.head), "…with the long form nowhere beside it (" + card.head.trim() + ")");
      await page.evaluate(() => window.__GFFL__.UI.closePlayerCard());
      ok(errors.length === 0, "0 page errors on My Team");
      await ctx.close();
      fixture.injMix = false;
    }

    // ---- AD12: the Moves player list is a bounded box with a working "Show more".
    {
      fixture.manyFa = true;
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await waitLive(page);
      await clickIn(page, '.bnav button[data-v="moves"]');
      await page.waitForSelector("#faResults .faTable", { timeout: 12000 });
      const fa = await page.evaluate(() => {
        const pan = document.querySelector("#faResults .panner");
        const cs = getComputedStyle(pan);
        return { h: Math.round(pan.clientHeight), sh: pan.scrollHeight, oy: cs.overflowY, ox: cs.overflowX,
                 ob: cs.overscrollBehaviorY, rows: document.querySelectorAll("#faResults tbody tr").length,
                 body: document.body.scrollWidth, win: window.innerWidth, more: !!document.querySelector("#faMore") };
      });
      ok(fa.oy === "auto" && fa.h > 0 && fa.h <= 345, "the players list is a bounded box, not the whole page (" + fa.h + "px)");
      ok(fa.sh > fa.h + 40, "…and it really scrolls (" + fa.sh + " of rows in " + fa.h + "px)");
      ok(fa.ob === "contain", "…with overscroll-behavior:contain at its own edge");
      ok(fa.ox === "auto", "…while still panning horizontally, as the wide stats table needs");
      ok(fa.body <= fa.win + 1, "…and the PAGE never scrolls sideways because of it");
      // The sticky PLAYER column and the header must both survive a doubly-scrolling box.
      // RESTAGED 2026-08-09 (ITEM 22): the table lost three columns and its phone widths were
      // cut to fit ADD/TYPE/PROJ on screen, so it no longer overflows by a fixed 220px — a
      // hardcoded scrollLeft now clamps well short of it and the check would be asserting
      // against a pan that never happened. Pan to the container's OWN maximum instead, and
      // demand it be a real pan (the narrower table still overflows by a good margin).
      const sticky = await page.evaluate(() => {
        const pan = document.querySelector("#faResults .panner");
        pan.scrollLeft = pan.scrollWidth; pan.scrollTop = 90;
        const pr = pan.getBoundingClientRect();
        const cell = pan.querySelector("tbody tr td.faname");
        const th = pan.querySelector("thead th");
        return { dx: Math.round(cell.getBoundingClientRect().left - pr.left),
                 dy: Math.round(th.getBoundingClientRect().top - pr.top), scrolled: Math.round(pan.scrollLeft) };
      });
      ok(sticky.scrolled > 60 && Math.abs(sticky.dx) <= 2, "the PLAYER column stays pinned to the box's left edge while the rest pans (" + sticky.scrolled + "px panned, " + sticky.dx + "px drift)");
      ok(Math.abs(sticky.dy) <= 2, "…and the header row sticks to the box's top while the rows scroll under it (" + sticky.dy + "px)");
      // "Show more" grows the pool without growing the box.
      ok(fa.more, "\"Show more\" is offered once the pool hits its limit");
      await clickIn(page, "#faMore");
      await page.waitForFunction((n) => document.querySelectorAll("#faResults tbody tr").length > n, { timeout: 9000 }, fa.rows);
      const after = await page.evaluate(() => {
        const pan = document.querySelector("#faResults .panner");
        return { h: Math.round(pan.clientHeight), rows: document.querySelectorAll("#faResults tbody tr").length, body: document.body.scrollWidth, win: window.innerWidth };
      });
      ok(after.rows > fa.rows, "…and it really adds rows (" + fa.rows + " -> " + after.rows + ")");
      ok(after.h === fa.h, "…without blowing the box back out to full-page height (" + after.h + "px)");
      ok(after.body <= after.win + 1, "…still no sideways page scroll");
      // The 390 Moves plate is taken HERE, on the page with a real player list — the bounded
      // box and the collapsed "My pending" line are both only judgeable with content in them.
      if (SHOTS) {
        await page.evaluate(() => { const p = document.querySelector("#faResults .panner"); if (p) { p.scrollTop = 0; p.scrollLeft = 0; } window.scrollTo(0, 0); });
        await sleep(200);
        await page.screenshot({ path: path.join(ROOT, "shots", "gffl_pt_moves_390.png") });
        console.log("  📸 shots/gffl_pt_moves_390.png");
      }
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
      fixture.manyFa = false;
    }

    // ---- AD13: "My pending" — one quiet line when there's nothing, compact when there is.
    {
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await waitLive(page);
      await clickIn(page, '.bnav button[data-v="moves"]');
      await waitOr(page, ".pendcard", 12000);
      const empty = await page.evaluate(() => {
        const c = document.querySelector(".pendcard") || [...document.querySelectorAll(".card")].find((x) => /My pending/.test(x.textContent));
        if (!c) return { h: -1, lines: -1, claims: null, trades: null };
        return { h: Math.round(c.getBoundingClientRect().height), lines: c.querySelectorAll("h2").length,
                 claims: (document.querySelector("#mvMyClaims") || {}).textContent,
                 trades: (document.querySelector("#mvMyTrades") || {}).textContent };
      });
      // MEASURED before this batch, same viewport: 190px for three empty sections stacked.
      ok(empty.h <= 80, "with nothing pending the card collapses to one short line — 190px before, " + empty.h + "px now");
      ok(empty.lines === 1, "…one heading, not four (" + empty.lines + ")");
      ok(/No pending claims/.test(empty.claims || "") && /No pending trades/.test(empty.trades || ""),
        "…and it still says, in the same containers, that both lists are empty");
      ok(errors.length === 0, "0 page errors (empty state)");
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await newTestPage(browser, seedPending());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await waitLive(page);
      await clickIn(page, '.bnav button[data-v="moves"]');
      await waitOr(page, ".pendcard .rowline", 12000);
      const full = await page.evaluate(() => {
        const c = document.querySelector(".pendcard") || [...document.querySelectorAll(".card")].find((x) => /My pending/.test(x.textContent));
        if (!c) return { h: -1, btns: [], rows: -1, txt: "" };
        const list = [...c.querySelectorAll(".rowline > button")].map((b) => ({ t: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height) }));
        return { h: Math.round(c.getBoundingClientRect().height), btns: list,
                 rows: c.querySelectorAll(".rowline").length, txt: c.textContent.replace(/\s+/g, " ") };
      });
      // MEASURED before this batch, same three pending items and same fixture: 359px — and its
      // action buttons were only 32px tall, under the 44px tap floor. Smaller AND more
      // tappable. (A probe with longer player names measured the old card at 381px; 359 is
      // what THIS fixture reports, which is the number the budget below is set against.)
      ok(full.h <= 300, "a populated card is substantially smaller — 359px before, " + full.h + "px now");
      ok(full.rows === 3, "…still carrying the claim, the trade and the league-veto row (" + full.rows + ")");
      const want = ["Cancel", "Accept", "Decline", "Veto"];
      ok(want.every((w) => full.btns.some((b) => b.t === w)), "…every action still reachable (" + full.btns.map((b) => b.t).join(",") + ")");
      ok(full.btns.every((b) => b.h >= 44), "…and every one of them at least 44px tall — 32px before (" + full.btns.map((b) => b.h).join("/") + ")");
      if (SHOTS) {
        await page.setViewport({ width: 1440, height: 900 });
        await sleep(300);
        await page.evaluate(() => window.__GFFL__.UI.show("moves"));
        await page.waitForSelector(".pendcard", { timeout: 9000 });
        await sleep(400);
        await page.screenshot({ path: path.join(ROOT, "shots", "gffl_pt_moves_desktop.png") });
        console.log("  📸 shots/gffl_pt_moves_desktop.png");
      }
      ok(errors.length === 0, "0 page errors (populated state)");
      await ctx.close();
    }
  }


  // ================================================================================
  //  AE · the ESPN matchup layout, the chat pane, and the six-tab bar (2026-08-09)
  // ================================================================================
  // From a screenshot of the real ESPN app plus three chat/nav asks in the same session.
  // Every check here is GEOMETRY or behaviour: "exactly even height for every player" and
  // "team a hugs left, team b hugs right" are claims about pixels, and a markup assertion
  // cannot tell you whether they hold.
  section("AE · ESPN matchup layout (mirrored, three even lines, crests, centre band, header) + chat pane + six-tab nav");
  {
    // ---- AE1: the lineup table — mirrored alignment, identical row heights, three lines.
    {
      // seedLongNames() puts REAL NFL name lengths on the roster ("Amon-Ra St. Brown",
      // "Christian McCaffrey"), which is what makes "a long name truncates on one line
      // instead of making its row taller" a real test rather than a lucky one.
      const { ctx, page, errors } = await newTestPage(browser, seedLongNames());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await waitLive(page);
      await clickIn(page, ".mucard.mine");
      await page.waitForSelector(".muhead", { timeout: 9000 });
      // Every crest is a real (intercepted) network image, so wait for them to SETTLE before
      // asking whether they loaded — the previous batch shipped a check that sampled one at
      // first paint and read it neither loaded nor errored, which failed intermittently.
      await page.waitForFunction(() => [...document.querySelectorAll("img.plogo")].every((i) => i.complete), { timeout: 9000 });

      // -- mirrored alignment. Computed style AND measured x, because text-align:right on a
      // block that happens to be full-width proves nothing on its own.
      const align = await page.evaluate(() => {
        const rows = [...document.querySelectorAll(".mutable:not(.benchtable) tbody tr")];
        const g = (tr, cls) => tr.querySelector(".pcellgrid." + cls);
        const named = (c) => { const b = c && c.querySelector(".pname b"); return b && b.textContent.trim() ? b : null; };
        const L = rows.map((tr) => named(g(tr, "left"))).filter(Boolean);
        const R = rows.map((tr) => named(g(tr, "right"))).filter(Boolean);
        const box = (el) => el.getBoundingClientRect();
        // Every read here is null-guarded: a pre-fix verification has to produce a readable
        // list of failures, not one stack trace from the first missing element (section AC's
        // own lesson).
        const ta = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).textAlign : null; };
        return {
          leftAlign: ta(".pcellgrid.left .pinfo"),
          rightAlign: ta(".pcellgrid.right .pinfo"),
          rightMetaAlign: ta(".pcellgrid.right .pmeta"),
          nL: L.length, nR: R.length,
          leftEdges: L.map((e) => Math.round(box(e).left)),
          rightEdges: R.map((e) => Math.round(box(e).right)),
        };
      });
      ok(align.leftAlign === "left" && align.rightAlign === "right",
        "team A's text is left-aligned and team B's is RIGHT-aligned — the mirror, corrected from the previous batch's left/left (" + align.leftAlign + "/" + align.rightAlign + ")");
      ok(align.rightMetaAlign === "right", "…the meta line mirrors too, not just the name");
      ok(align.nL >= 1 && new Set(align.leftEdges).size === 1,
        "…every LEFT name starts at one consistent x (" + JSON.stringify(align.leftEdges) + ")");
      ok(align.nR >= 2 && new Set(align.rightEdges).size === 1,
        "…and every RIGHT name ENDS at one consistent x — hugging the right edge, not ragged (" + JSON.stringify(align.rightEdges) + ")");

      // -- exactly even height, and the row set really does contain the hard cases.
      const heights = await page.evaluate(() => {
        const cells = (sel) => [...document.querySelectorAll(sel + " .pcellgrid")].map((c) => ({
          h: Math.round(c.getBoundingClientRect().height),
          txt: c.textContent.replace(/\s+/g, " ").trim(),
          lines: c.querySelectorAll(".pinfo .pline").length,
          statTxt: (c.querySelector(".pstatline") || {}).textContent || "",
          hasStat: !!c.querySelector(".pstatline"),
          statH: c.querySelector(".pstatline") ? Math.round(c.querySelector(".pstatline").getBoundingClientRect().height) : -1,
        }));
        const starters = cells(".mutable:not(.benchtable) tbody");
        const bench = cells(".benchtable tbody");
        const rowH = [...document.querySelectorAll(".mutable:not(.benchtable) tbody tr")].map((r) => Math.round(r.getBoundingClientRect().height));
        return { starters, bench, rowH,
          longest: Math.max(...starters.map((c) => c.txt.length)),
          hasEmpty: starters.some((c) => /Empty/.test(c.txt)),
          hasLive: starters.some((c) => c.statTxt.trim().length > 0),
          hasBlankStat: starters.some((c) => c.statTxt.trim().length === 0 && !/Empty/.test(c.txt)) };
      });
      const sH = new Set(heights.starters.map((c) => c.h));
      ok(sH.size === 1, "every starter half-cell is EXACTLY the same height (" + [...sH].join("/") + "px across " + heights.starters.length + " cells)");
      const rH = new Set(heights.rowH);
      ok(rH.size === 1, "…so every starter ROW is the same height too (" + [...rH].join("/") + "px)");
      const bH = new Set(heights.bench.map((c) => c.h));
      ok(bH.size === 1 && [...bH][0] === [...sH][0], "…and every bench row matches them exactly (" + [...bH].join("/") + "px)");
      ok(heights.hasEmpty && heights.hasLive && heights.hasBlankStat,
        "…and that set really contains the hard cases together: an Empty slot, a row with a live stat line, and a pre-game row with none");
      ok(heights.starters.every((c) => c.lines === 3), "each half is EXACTLY three lines (" + [...new Set(heights.starters.map((c) => c.lines))].join("/") + ")");
      ok(heights.starters.every((c) => c.hasStat && c.statH > 0),
        "…and line 3 keeps its height even when it has nothing to say — that reservation is what makes a pre-game row as tall as a live one (" + [...new Set(heights.starters.map((c) => c.statH))].join("/") + "px)");

      // -- no name wraps; a too-long one is ellipsised and keeps a title.
      const names = await page.evaluate(() => {
        const grab = (sel) => [...document.querySelectorAll(sel + " .pname b")].map((b) => ({
          txt: b.textContent.trim(), rects: b.getClientRects().length,
          need: b.scrollWidth, have: b.clientWidth,
          clipped: b.scrollWidth > b.clientWidth + 1, title: b.getAttribute("title") || "",
          ellipsis: getComputedStyle(b).textOverflow, ws: getComputedStyle(b).whiteSpace,
          side: b.closest(".pcellgrid").classList.contains("right") ? "R" : "L",
        }));
        const info = document.querySelector(".mutable .pcellgrid .pinfo");
        const logo = document.querySelector(".mutable .pname .plogo");
        const nameLine = document.querySelector(".mutable .pname");
        const avail = Math.round(info.getBoundingClientRect().width
          - logo.getBoundingClientRect().width - parseFloat(getComputedStyle(nameLine).gap || 0));
        return { starters: grab(".mutable:not(.benchtable)"), bench: grab(".benchtable"), avail };
      });
      const allNames = names.starters.concat(names.bench);
      ok(allNames.every((n) => n.rects <= 1), "no player name wraps to a second line (" + allNames.filter((n) => n.rects > 1).map((n) => n.txt).join(",") + ")");
      ok(allNames.every((n) => n.ws === "nowrap" && n.ellipsis === "ellipsis"), "…because each is nowrap + ellipsis, by construction");
      // ITEM 17 (2026-08-09) — THE BAR. This check used to assert the OPPOSITE: that a long
      // name "genuinely does truncate", written when four names a row were coming out as
      // "M. Ha…" and that was mistaken for a limitation of the width. It is not — the
      // reference app fits these same names whole at 390px, and so does this now: the name's
      // budget went from 83.8px to 102.7px, all of it found by measuring where the row's width
      // was actually going (see the media-query note in league.html). Both sides, and the
      // bench table too, because they share the widths and a regression could land in either.
      const clippedS = names.starters.filter((n) => n.clipped);
      const clippedB = names.bench.filter((n) => n.clipped);
      console.log("    · 390px name budget: " + names.avail + "px; longest rendered name needs "
        + Math.max(...allNames.map((n) => n.need)) + "px");
      ok(clippedS.length === 0,
        "NOT ONE starter name is ellipsised at 390px, either side — " + names.starters.length + " rows, longest \""
        + allNames.slice().sort((a, b) => b.need - a.need)[0].txt + "\" (" + JSON.stringify(clippedS.map((n) => n.side + ":" + n.txt + " " + n.need + ">" + n.have)) + ")");
      ok(clippedB.length === 0, "…nor one bench name (" + JSON.stringify(clippedB.map((n) => n.txt + " " + n.need + ">" + n.have)) + ")");
      // The fixture's own longest REAL names are the ones that were failing — name them, so a
      // future regression can't quietly pass by the fixture getting shorter names.
      const hardest = ["J. Smith-Njigba", "M. Harrison Jr.", "C. McLaughlin"];
      const found = hardest.filter((h) => allNames.some((n) => n.txt === h && !n.clipped));
      ok(found.length === hardest.length,
        "…including the three that used to read \"J. Smi…\" / \"M. Ha…\" / \"C. McLaug…\" (" + JSON.stringify(found) + ")");
      const real = allNames.filter((n) => n.txt && n.txt !== "Empty" && n.txt !== "TOTAL");
      ok(real.length > 0 && real.every((n) => /·/.test(n.title)),
        "…and every real player's name still carries a title with his position and team (" + real.length + " rows)");
      // Two things the width pass paid for, both of which WERE being clipped at 390px before it:
      // a three-digit team total, and the word BENCH in the centre band.
      // RANGE, not scrollWidth. The name check above can use scrollWidth because .pname b
      // carries its OWN overflow:hidden; these two do not (the hidden overflow is on their
      // PARENT .pline / cell), and an overflow:visible element reports scrollWidth === its own
      // clientWidth however far its text spills. Measured that way both of these read as a
      // comfortable fit while genuinely overflowing — a vacuous check. A Range around the text
      // node measures what is actually rendered, which is the house lesson already recorded
      // for the override-dot check in the care widget.
      const clips = await page.evaluate(() => {
        const textW = (el) => {
          const n = [...el.childNodes].find((x) => x.nodeType === 3 && x.textContent.trim());
          if (!n) return 0;
          const r = document.createRange(); r.selectNodeContents(n);
          return Math.ceil(r.getBoundingClientRect().width);
        };
        const tot = document.querySelector(".totalrow .ppts .pts");
        const before = tot.textContent;
        tot.textContent = "141.0";
        const totNeed = textW(tot), totHave = Math.floor(tot.closest(".ppts").clientWidth);
        tot.textContent = before;
        // Against the CELL, not the badge: .slotbadge is inline-block, so it sizes to its own
        // text and would always look like a perfect fit. What constrains it — and what it was
        // spilling over — is the slot cell's content box.
        const bench = document.querySelector(".benchtable td.slotcell .slotbadge");
        const cell = bench.closest("td");
        const cs2 = getComputedStyle(cell), bs = getComputedStyle(bench);
        const pad = parseFloat(bs.paddingLeft) + parseFloat(bs.paddingRight);
        return { totNeed, totHave, benchTxt: bench.textContent.trim(), benchNeed: textW(bench) + pad,
          benchHave: Math.floor(cell.clientWidth - parseFloat(cs2.paddingLeft) - parseFloat(cs2.paddingRight)) };
      });
      // Honest scope: this one PASSES pre-fix too, at exactly 36 into 36px — the mobile
      // media query's 14px already outranked .totalrow's own 17px, so it fitted by nothing.
      // Narrowing the players' column to 30px would have broken it, which is why the TOTAL row
      // got its own 44px basis; this is the invariant guarding that, not a fix being claimed.
      ok(clips.totNeed <= clips.totHave,
        "a three-digit TEAM total fits its column, with real margin now the players' column is narrower (" + clips.totNeed + " into " + clips.totHave + "px)");
      ok(clips.benchTxt === "BENCH" && clips.benchNeed <= clips.benchHave + 1,
        "…and the word BENCH fits the centre band, which it also did not (" + clips.benchNeed + " into " + clips.benchHave + "px)");

      // -- the points column: score on line 1, projection on line 2, both on the inner edge.
      const pts = await page.evaluate(() => {
        const c = [...document.querySelectorAll(".mutable .pcellgrid")].find((e) => /A\. St\. Brown/.test(e.textContent));
        if (!c) return null;
        const s = c.querySelector(".pts"), p = c.querySelector(".pproj");
        const name = c.querySelector(".pname b") || c.querySelector("b");
        if (!s || !p || !name) return { score: null, proj: null };
        const r = (e) => e.getBoundingClientRect();
        const w = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().width : -1; };
        const wL = w(".pcellgrid.left .ppts"), wR = w(".pcellgrid.right .ppts");
        return { score: s.textContent.trim(), proj: p.textContent.trim(),
          sameLineAsName: Math.abs(r(s).top - r(name).top) < 6, projBelow: r(p).top >= r(s).bottom - 1,
          tabular: getComputedStyle(c.querySelector(".ppts")).fontVariantNumeric,
          wL: Math.round(wL), wR: Math.round(wR) };
      });
      ok(!!pts && /^\d/.test(pts.score) && /^\d/.test(pts.proj), "the points column carries a score and a bare projection, both numeric (" + JSON.stringify([pts.score, pts.proj]) + ")");
      ok(!!pts && pts.sameLineAsName && pts.projBelow, "…score on the name's own line, projection directly beneath it");
      ok(!!pts && /tabular-nums/.test(pts.tabular || ""), "…in tabular numerals so the columns line up (" + pts.tabular + ")");
      ok(!!pts && pts.wL > 0 && pts.wL === pts.wR, "…and the two points columns are the same fixed width on both sides (" + pts.wL + "/" + pts.wR + ")");

      // -- the centre band: continuous, darker than the card, position colours intact.
      const band = await page.evaluate(() => {
        const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
        const root = getComputedStyle(document.documentElement);
        const cells = [...document.querySelectorAll(".mutable:not(.benchtable) td.slotcell")];
        const rects = cells.map((td) => td.getBoundingClientRect());
        let maxGap = 0;
        for (let i = 1; i < rects.length; i++) maxGap = Math.max(maxGap, Math.abs(rects[i].top - rects[i - 1].bottom));
        const badges = cells.map((td) => { const b = td.querySelector(".slotbadge");
          return { pos: td.dataset.pos, bg: b ? getComputedStyle(b).backgroundColor : null,
            bh: b ? Math.round(b.getBoundingClientRect().height) : -1, ch: Math.round(td.getBoundingClientRect().height) }; });
        const want = {}; for (const p of ["QB", "RB", "WR", "TE", "K", "DST", "X"]) want[p] = hex(root.getPropertyValue("--pos-" + p).trim());
        return { cellBg: cells.length ? getComputedStyle(cells[0]).backgroundColor : null, cardBg: null,
          nested2: hex(root.getPropertyValue("--nested2").trim()), maxGap: Math.round(maxGap),
          badges, want, matched: badges.filter((b) => want[b.pos] === b.bg).length };
      });
      ok(band.cellBg === band.nested2, "the centre column is a BAND — the cell itself is painted a shade darker than the card (" + band.cellBg + ")");
      ok(band.maxGap === 0, "…and consecutive cells are contiguous, so it reads as one continuous strip, not a stack of pills (max gap " + band.maxGap + "px)");
      ok(band.matched === band.badges.length, "…with the draft position colours KEPT (" + band.matched + "/" + band.badges.length + ")");
      // RESTAGED 2026-08-09 (ITEM 23) — SUPERSEDED, inverted: the user asked for the colour to
      // fill the column rather than float in it, so a badge shorter than its cell is now the
      // failure. The BAND itself (maxGap 0 above) is unaffected — it is simply the position
      // colour now instead of a neutral strip behind a pill.
      ok(band.badges.every((b) => b.bh >= b.ch - 1), "…filling the cell, no blank space around it (" + band.badges.map((b) => b.bh + "/" + b.ch).join(" ") + ")");

      // -- the header.
      const head = await page.evaluate(() => {
        const h = document.querySelector(".muhead");
        const side = (sel) => {
          const t = h.querySelector(sel);
          if (!t) return {};
          const av = t.querySelector(".muavatar"), sc = t.querySelector(".muhscore");
          const big = t.querySelector(".bigpts"), pj = t.querySelector(".muhproj");
          if (!av || !sc || !big || !pj) return { proj: null, name: (t.querySelector(".muhname") || {}).textContent, owner: (t.querySelector(".muhowner") || {}).textContent };
          const r = (e) => e.getBoundingClientRect();
          return { avLeft: Math.round(r(av).left), scLeft: Math.round(r(sc).left),
            big: big.textContent.trim(), proj: pj.textContent.trim(),
            bigPx: parseFloat(getComputedStyle(big).fontSize), projPx: parseFloat(getComputedStyle(pj).fontSize),
            projBelowBig: r(pj).top >= r(big).bottom - 2,
            name: (t.querySelector(".muhname") || {}).textContent, owner: (t.querySelector(".muhowner") || {}).textContent };
        };
        return { height: Math.round(h.getBoundingClientRect().height), a: side(".muhteam:not(.right)"), b: side(".muhteam.right"),
          wp: !!h.querySelector(".wpfill"), live: !!h.querySelector(".mulive"), week: /Week 1/.test(h.textContent) };
      });
      // MEASURED at 390px: 220px before the 2026-08-08 batch, 111px after it. This rebuild adds
      // a line (owner · record) and must NOT give that back.
      ok(head.height <= 111, "the matchup header does not regress past the 111px it measured at (" + head.height + "px)");
      ok(head.a.avLeft < head.a.scLeft, "team A's crest sits on the OUTER (left) edge with the score inner");
      ok(head.b.avLeft > head.b.scLeft, "…and team B's is mirrored — crest outer (right), score inner");
      ok(head.a.projBelowBig && head.b.projBelowBig, "the projection sits directly BENEATH the big score, both sides");
      ok(head.a.projPx < head.a.bigPx, "…smaller than it (" + head.a.projPx + "px vs " + head.a.bigPx + "px)");
      ok(/^\d+(\.\d)?$/.test(head.a.proj || "") && /^\d+(\.\d)?$/.test(head.b.proj || ""),
        "…and a BARE number — the reference carries no 'Proj' label (" + JSON.stringify([head.a.proj, head.b.proj]) + ")");
      ok(/Battle Kreussers/.test(head.b.name || "") && /End Zone Goats/.test(head.a.name || ""), "team names below the scores, both sides");
      // seedTeams() gives every team owner:"" — the deliberate no-owner case, which must read
      // as the record alone rather than a stray separator.
      ok(head.a.owner === "0-0" && head.b.owner === "0-0",
        "…and owner · record below that, with no stray bullet when a team has no owner on file (" + JSON.stringify([head.a.owner, head.b.owner]) + ")");
      ok(head.wp && head.live && head.week, "…while the centre column keeps the live indicator, the week and the win-probability bar");

      // -- the little crests.
      const crests = await page.evaluate(() => {
        const cellFor = (nm) => [...document.querySelectorAll(".mutable .pcellgrid")].find((c) => c.textContent.includes(nm));
        const info = (nm) => {
          const c = cellFor(nm); if (!c) return null;
          const img = c.querySelector("img.plogo");
          if (!img) {
            const ph = c.querySelector(".plogoph");
            return { has: false, ph: !!ph, phW: ph ? Math.round(ph.getBoundingClientRect().width) : 0 };
          }
          const r = img.getBoundingClientRect();
          return { has: true, src: img.getAttribute("src"), w: Math.round(r.width), h: Math.round(r.height),
            loaded: img.complete && img.naturalWidth > 0, vis: getComputedStyle(img).visibility };
        };
        return { total: document.querySelectorAll(".mutable img.plogo").length,
          phi: info("M. Harrison Jr."), den: info("C. McCaffrey") };
      });
      ok(crests.total >= 4, "the lineup carries little NFL crests beside the names (" + crests.total + ")");
      ok(crests.phi && crests.phi.has && /teamlogos\/nfl\/500\/phi\.png$/.test(crests.phi.src),
        "…from the slate's own team.logo, no new fetch (" + (crests.phi || {}).src + ")");
      ok(crests.phi.w === crests.phi.h && crests.phi.w >= 12,
        "…at a fixed square size so a slow crest can't shift a row (" + crests.phi.w + "x" + crests.phi.h + " at this width)");
      ok(crests.phi.loaded === true && crests.phi.vis === "visible", "…and it genuinely LOADED, not a hidden broken box");
      ok(crests.den && crests.den.has === false, "a team with NO crest in the payload renders no <img> at all — never a broken one (DEN)");
      ok(crests.den.ph && crests.den.phW === crests.phi.w,
        "…but it keeps a box of exactly the same width, or that row's name would start further in than every other row's (" + JSON.stringify([crests.den.ph, crests.den.phW, crests.phi.w]) + ")");

      // -- line 2: @AWAY vs bare HOME, and the live/final forms.
      const line2 = await page.evaluate(() => {
        const meta = (nm) => {
          const c = [...document.querySelectorAll(".mutable .pcellgrid")].find((e) => e.textContent.includes(nm));
          const m = c && c.querySelector(".pmeta");
          return m ? m.textContent.trim() : null;
        };
        return { tight: meta("T. McBride"), second: meta("C. McCaffrey"), passer: meta("M. Harrison Jr.") };
      });
      // sbFix: KC @ DEN, not yet kicked off. T. McBride is KC (AWAY, so he visits DEN);
      // C. McCaffrey is DEN (HOME, so he hosts KC) — the line names the OPPONENT either way,
      // and the "@" is the only thing that differs.
      ok(/^@DEN\s/.test(line2.tight || ""), "line 2 reads '@OPP kickoff' for an AWAY player (" + line2.tight + ")");
      ok(/^KC\s/.test(line2.second || ""), "…and a bare 'OPP kickoff' with no @ for a HOME one (" + line2.second + ")");
      ok(/Q2 5:00/.test(line2.passer || ""), "…and the live clock instead, once a game is on (" + line2.passer + ")");

      if (SHOTS) {
        fs.mkdirSync(path.join(ROOT, "shots"), { recursive: true });
        await page.screenshot({ path: path.join(ROOT, "shots", "gffl_espn_matchup_390.png") });
        await page.setViewport({ width: 1440, height: 900 });
        await sleep(350);
        await page.evaluate(() => window.__GFFL__.UI.renderMatchup(true));
        await sleep(300);
        await page.screenshot({ path: path.join(ROOT, "shots", "gffl_espn_matchup_desktop.png") });
        console.log("  📸 shots/gffl_espn_matchup_{390,desktop}.png");
        // The desktop mirror is worth its own assertion — a 1440px row has far more slack, so
        // "hugs right" could silently stop holding there while passing at 390.
        const deskEdges = await page.evaluate(() => {
          const R = [...document.querySelectorAll(".mutable:not(.benchtable) tbody tr")]
            .map((tr) => tr.querySelector(".pcellgrid.right .pname b"))
            .filter((b) => b && b.textContent.trim());
          return R.map((e) => Math.round(e.getBoundingClientRect().right));
        });
        ok(new Set(deskEdges).size === 1, "desktop: team B's names still end at one consistent right edge (" + JSON.stringify(deskEdges) + ")");
        const deskClip = await page.evaluate(() => [...document.querySelectorAll(".mutable .pname b")]
          .filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()));
        ok(deskClip.length === 0, "desktop: and not one name is ellipsised there either (" + JSON.stringify(deskClip) + ")");
      }
      ok(errors.length === 0, "0 page errors on the rebuilt matchup page");
      await ctx.close();
    }

    // ---- AE2: the home/away flag lands in BOTH slate parsers — the live board and the 2025
    // replay are separate code, and a flag added to only one of them is the easy mistake.
    {
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await waitLive(page);
      const live = await page.evaluate(() => {
        const g = window.__GFFL__.D.S.games;
        return { phi: g.get("PHI").home, dal: g.get("DAL").home, den: g.get("DEN").home, kc: g.get("KC").home };
      });
      ok(live.phi === true && live.dal === false && live.den === true && live.kc === false,
        "pollScoreboard records home/away for every team on the slate (" + JSON.stringify(live) + ")");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }
    {
      fixture.rich2025 = true;
      const { ctx, page, errors } = await newTestPage(browser, { docs: { ...seedTeams() }, pass: "amenfarms", team: 1, who: "Peter" });
      await page.goto(BASE + "/league.html?fam=" + FAM + "&simspeed=0", { waitUntil: "networkidle0" });
      await page.waitForFunction(() => !!window.__GFFL__, { timeout: 12000 });
      ok(await waitOr(page, ".mucard", 25000), "the 2025 replay boots");
      await page.waitForFunction(() => window.__GFFL__.D.S.games.size > 0, { timeout: 15000 });
      const rep = await page.evaluate(() => {
        const g = window.__GFFL__.D.S.games;
        return { den: g.get("DEN").home, ten: g.get("TEN").home, phi: g.get("PHI").home, dal: g.get("DAL").home };
      });
      ok(rep.den === false && rep.ten === true && rep.phi === true && rep.dal === false,
        "…and so does the replay's own, separate slate parser (" + JSON.stringify(rep) + ")");
      // The DEN players in the replay's imported rosters are all on TEAM 2, and the replay
      // GENERATES its own schedule (there is no seeded [[1,2],…] here), so team 1's week-1
      // opponent is not team 2 — open that pairing explicitly rather than assuming it.
      await page.evaluate(() => { window.__GFFL__.UI.matchup = [1, 2]; return window.__GFFL__.UI.renderMatchup(); });
      await page.waitForSelector(".mutable", { timeout: 15000 });
      const flexOk = await page.waitForFunction(
        () => [...document.querySelectorAll(".mutable .pcellgrid")].some((e) => e.textContent.includes("F. Flexman")),
        { timeout: 20000 },
      ).then(() => true).catch(() => false);
      const flexMeta = await page.evaluate((found) => {
        const c = [...document.querySelectorAll(".mutable .pcellgrid")].find((e) => e.textContent.includes("F. Flexman"));
        const m = c && c.querySelector(".pmeta");
        if (m) return m.textContent.trim();
        if (c) return "NO .pmeta LINE on his row";
        return "NOT ON SCREEN — rows were: " + [...document.querySelectorAll(".mutable .pname")].map((e) => e.textContent.trim()).join("|");
      }, flexOk);
      ok(/^@TEN\s/.test(flexMeta || ""), "…so a replay row reads '@TEN kickoff' for a DEN player, not a bare opponent (" + flexMeta + ")");
      ok(errors.length === 0, "0 page errors under the replay");
      await ctx.close();
      fixture.rich2025 = false;
    }

    // ---- AE3: the chat pane — content bottom-anchored at every width, on BOTH surfaces,
    // WITHOUT making a full history unreachable at the top.
    for (const vw of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const tag = vw.width + "px";
      // (a) few messages in a tall box — the reported symptom.
      {
        const { ctx, page, errors } = await newTestPage(browser, seedChat(3), { vw });
        await bootPage(page);
        await page.waitForSelector(".mucard", { timeout: 9000 });
        await clickIn(page, '.bnav button[data-v="chat"]');
        await page.waitForSelector("#chatList .chatRowMsg", { timeout: 9000 });
        const m = await page.evaluate(() => {
          const l = document.querySelector("#chatList");
          const rows = [...l.querySelectorAll(".chatRowMsg")];
          const lb = l.getBoundingClientRect();
          return { boxH: Math.round(lb.height), rows: rows.length,
            firstTop: Math.round(rows[0].getBoundingClientRect().top - lb.top),
            lastGap: Math.round(lb.bottom - rows[rows.length - 1].getBoundingClientRect().bottom),
            contentH: Math.round(l.scrollHeight) };
        });
        ok(m.rows === 3 && m.boxH > m.contentH - 2 && m.boxH >= 300,
          tag + ": with only 3 messages the Chat tab is still a tall pane, not a short block (" + m.boxH + "px box)");
        ok(m.lastGap <= 12, "…and the NEWEST message sits at the BOTTOM of it (" + m.lastGap + "px from the bottom edge)");
        ok(m.firstTop > 20, "…with the empty space above, not below (first message " + m.firstTop + "px down)");
        ok(errors.length === 0, "0 page errors");
        await ctx.close();
      }
      // (b) a full history — the trap. justify-content:flex-end would make the top unreachable.
      {
        const { ctx, page, errors } = await newTestPage(browser, seedChat(30), { vw });
        await bootPage(page);
        await page.waitForSelector(".mucard", { timeout: 9000 });
        await clickIn(page, '.bnav button[data-v="chat"]');
        await page.waitForSelector("#chatList .chatRowMsg", { timeout: 9000 });
        const m = await page.evaluate(() => {
          const l = document.querySelector("#chatList");
          const lb = l.getBoundingClientRect();
          const rows = [...l.querySelectorAll(".chatRowMsg")];
          const pinned = Math.round(lb.bottom - rows[rows.length - 1].getBoundingClientRect().bottom);
          l.scrollTop = 0;
          const first = rows[0].getBoundingClientRect();
          return { overflow: l.scrollHeight > l.clientHeight + 10, pinned,
            firstTopAtScrollZero: Math.round(first.top - lb.top),
            firstText: rows[0].textContent.replace(/\s+/g, " ").trim().slice(0, 60) };
        });
        ok(m.overflow, tag + ": 30 messages genuinely overflow the pane");
        ok(m.pinned <= 12, "…and it still opens pinned to the newest (" + m.pinned + "px from the bottom)");
        ok(m.firstTopAtScrollZero >= -1 && /message number 0\b/.test(m.firstText),
          "…yet scrolling to the very top reveals the FIRST message IN FULL — nothing clipped away (top " + m.firstTopAtScrollZero + "px, \"" + m.firstText + "\")");
        // The reader who has scrolled up to read history must not be yanked back down when a
        // new message lands (the wasNearBottom rule).
        const kept = await page.evaluate(async () => {
          const l = document.querySelector("#chatList");
          l.scrollTop = 0;
          const before = l.scrollTop;
          await window.__GFFL__.LG.postChat({ text: "a brand new message" });
          await window.__GFFL__.UI.refreshChatList("chat", null);
          return { before, after: document.querySelector("#chatList").scrollTop,
            landed: document.querySelector("#chatList").textContent.includes("a brand new message") };
        });
        ok(kept.landed && kept.after === kept.before,
          "…and a reader who has scrolled up to read history is NOT yanked back down when a new message lands (" + kept.before + " -> " + kept.after + ")");
        ok(errors.length === 0, "0 page errors");
        await ctx.close();
      }
      // (c) the matchup page's trash-talk thread shares the same widget.
      {
        const { ctx, page, errors } = await newTestPage(browser, seedChat(3, { thread: "w1_1-2" }), { vw });
        await bootPage(page);
        await page.waitForSelector(".mucard", { timeout: 9000 });
        await waitLive(page);
        await clickIn(page, ".mucard.mine");
        await page.waitForSelector("#muThreadList .chatRowMsg", { timeout: 9000 });
        const m = await page.evaluate(() => {
          const l = document.querySelector("#muThreadList");
          const rows = [...l.querySelectorAll(".chatRowMsg")];
          const lb = l.getBoundingClientRect();
          return { rows: rows.length, lastGap: Math.round(lb.bottom - rows[rows.length - 1].getBoundingClientRect().bottom),
            boxH: Math.round(lb.height), contentH: Math.round(l.scrollHeight) };
        });
        ok(m.rows === 3 && m.lastGap <= 12,
          tag + ": the matchup thread is bottom-anchored too (" + m.lastGap + "px from the bottom)");
        ok(m.boxH <= m.contentH + 2,
          "…but it is NOT given a fixed 52vh pane — it is one card among many on that page (" + m.boxH + "px box, " + m.contentH + "px of content)");
        ok(errors.length === 0, "0 page errors");
        await ctx.close();
      }
    }

    // ---- AE4: chat shows USER messages only.
    {
      const { ctx, page, errors } = await newTestPage(browser, seedChat(3, { sys: true, replyToSys: true }));
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await clickIn(page, '.bnav button[data-v="chat"]');
      await page.waitForSelector("#chatList .chatRowMsg", { timeout: 9000 });
      const c = await page.evaluate(() => {
        const l = document.querySelector("#chatList");
        return { txt: l.textContent, rows: l.querySelectorAll(".chatRowMsg").length,
          sysBlocks: l.querySelectorAll(".chatSys").length, quotes: l.querySelectorAll(".chatQuote").length };
      });
      ok(!/League rules updated/.test(c.txt), "a sys message is not rendered in the Chat tab at all");
      ok(c.sysBlocks === 0, "…no sys block of any kind (" + c.sysBlocks + ")");
      ok(/message number 0/.test(c.txt) && /message number 2/.test(c.txt), "…while every USER message in the same thread still renders");
      ok(c.rows === 4, "…exactly the four user messages, sys excluded (" + c.rows + ")");
      ok(c.quotes === 0, "…and the user message that REPLIES to the sys post degrades to no quote block rather than a dangling one (" + c.quotes + ")");
      // The doc itself was never deleted — the guarantee is at render.
      const still = await page.evaluate(async () => (await window.__GFFL__.LG.loadAllChat()).filter((m) => m.sys).length);
      ok(still === 1, "…and the sys doc is still in the store, untouched — nothing was deleted to achieve this (" + still + ")");
      // Same on the matchup thread and the league-home preview.
      await clickIn(page, '.bnav button[data-v="league"]');
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await openDetails(page, "chatDetails");
      ok(!/League rules updated/.test(await page.evaluate(() => document.body.textContent)),
        "…nor on the league home's own chat preview");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AE5: the six-tab bar, and Rules/Draft reached from the League page.
    {
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await page.waitForSelector(".mucard", { timeout: 9000 });
      await waitLive(page);
      const nav = await page.evaluate(() => ({
        labels: [...document.querySelectorAll(".bnav button")].map((b) => b.textContent.trim()),
        rules: !!document.querySelector('.bnav [data-v="rules"]'),
        draft: !!document.querySelector('.bnav a, .bnav .bnavlink'),
        clipped: [...document.querySelectorAll(".bnav button")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent.trim()),
        widths: [...document.querySelectorAll(".bnav button")].map((el) => Math.round(el.getBoundingClientRect().width)),
      }));
      ok(!nav.rules && !nav.draft, "the Rules tab and the Draft link are both gone from the nav");
      ok(nav.labels.length === 6, "…six tabs remain (" + nav.labels.join("|") + ")");
      ok(nav.clipped.length === 0, "…and at 390px not one label clips — eight used to cut DRAFT to \"DR\" (" + JSON.stringify(nav.widths) + "px)");

      // Both links are on the League page, findable and tappable.
      const links = await page.evaluate(() => {
        const r = document.querySelector("#lnkRules"), d = document.querySelector("#lnkDraft");
        const box = (e) => e.getBoundingClientRect();
        return { rTag: r && r.tagName, dTag: d && d.tagName, dHref: d && d.getAttribute("href"),
          rH: r ? Math.round(box(r).height) : -1, dH: d ? Math.round(box(d).height) : -1,
          rTop: r ? Math.round(box(r).top + window.scrollY) : 1e6 };
      });
      ok(links.rTag === "BUTTON" && links.dTag === "A" && links.dHref === "ffdraft.html",
        "Rules is an in-app button; Draft is a real <a href> to ffdraft.html, so middle-click/open-in-new-tab still work (" + JSON.stringify(links) + ")");
      ok(links.rH >= 44 && links.dH >= 44, "…both ≥44px tappable (" + links.rH + "/" + links.dH + ")");
      ok(links.rTop < 900, "…and high enough on the League page to be found without scrolling it all (" + links.rTop + "px down)");

      // Tapping Rules really opens the commissioner's control panel — and leaves no stale
      // tab highlight behind, since no tab corresponds to that view any more.
      await clickIn(page, ".mucard:not(.mine)"); // open a DIFFERENT matchup first…
      await page.waitForSelector(".muhead", { timeout: 9000 });
      const openMu = await page.evaluate(() => window.__GFFL__.UI.matchup);
      await clickIn(page, '.bnav button[data-v="league"]');
      await waitOr(page, "#lnkRules", 9000);
      await clickIn(page, "#lnkRules");
      // waitOr + .catch: if the link is missing the assertions below must SAY so, not abort.
      await page.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 9000 }).catch(() => {});
      const onRules = await page.evaluate(() => ({
        view: window.__GFFL__.UI.view, dataView: document.querySelector("main").dataset.view,
        on: [...document.querySelectorAll(".bnav button.on")].map((b) => b.dataset.v),
        importer: !!document.querySelector("#importBtn") || /Import/.test(document.body.textContent),
        scoring: /Scoring/.test(document.body.textContent),
        matchup: JSON.stringify(window.__GFFL__.UI.matchup),
      }));
      ok(onRules.view === "rules" && onRules.dataView === "rules", "the League page's Rules link opens the Rules view");
      ok(onRules.importer && onRules.scoring, "…with the commissioner's controls on it — the importer and the scoring table");
      ok(onRules.on.length === 0, "…and NO tab is left highlighted, since none corresponds to this view (" + JSON.stringify(onRules.on) + ")");
      ok(onRules.matchup === JSON.stringify(openMu), "…and it does not disturb the matchup the reader had open (" + onRules.matchup + ")");

      // The #rules deep link still routes — someone may have it bookmarked.
      // The ?n= nonce is load-bearing: puppeteer's goto to a URL that differs from the current
      // one ONLY by its hash is a SAME-DOCUMENT navigation, so routeInitial() never re-runs and
      // this would pass simply because the page was already on Rules from the step above.
      await page.goto(BASE + "/league.html?fam=" + FAM + SIMOFF + "&n=" + Date.now() + "#rules", { waitUntil: "networkidle0" });
      await page.waitForFunction(() => window.__GFFL__ && window.__GFFL__.LG.rules, { timeout: 9000 });
      await page.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 9000 });
      ok(await page.evaluate(() => window.__GFFL__.UI.view) === "rules", "the #rules deep link still routes");
      // …and so does the in-code caller that opens it programmatically with no tap behind it.
      await page.evaluate(() => window.__GFFL__.UI.show("league"));
      await page.waitForSelector(".mucard", { timeout: 9000 });
      // …and a PROGRAMMATIC open with no tab press behind it still renders the view with the
      // container importFromEspn() writes into (the first-run card's own path: UI.show("rules")
      // and then straight into #importOut).
      await page.evaluate(() => window.__GFFL__.UI.show("rules"));
      await page.waitForFunction(() => document.body.textContent.includes("League rules"), { timeout: 9000 });
      const prog = await page.evaluate(() => ({ view: window.__GFFL__.UI.view,
        out: !!document.querySelector("#importOut"), btn: !!document.querySelector("#rulesImport") }));
      ok(prog.view === "rules" && prog.out && prog.btn,
        "…a programmatic UI.show(\"rules\") renders the view with the importer and its output container (" + JSON.stringify(prog) + ")");
      await clickIn(page, "#rulesImport");
      await page.waitForFunction(() => (document.querySelector("#importOut") || {}).textContent.trim().length > 0, { timeout: 12000 });
      ok(true, "…and the importer really writes into it");
      if (SHOTS) {
        await page.evaluate(() => window.__GFFL__.UI.show("league"));
        await waitOr(page, "#lnkRules", 9000);
        await sleep(250);
        await page.screenshot({ path: path.join(ROOT, "shots", "gffl_league_links_390.png") });
        console.log("  📸 shots/gffl_league_links_390.png");
      }
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }
    if (SHOTS) {
      // The chat plates — the whole point of item 14 is a SHORT conversation in a TALL box.
      for (const [vw, name] of [[{ width: 1440, height: 900 }, "gffl_chat_desktop"], [{ width: 390, height: 844 }, "gffl_chat_390"]]) {
        const { ctx, page } = await newTestPage(browser, seedChat(3, { sys: true }), { vw });
        await bootPage(page);
        await page.waitForSelector(".mucard", { timeout: 9000 });
        await clickIn(page, '.bnav button[data-v="chat"]');
        await page.waitForSelector("#chatList .chatRowMsg", { timeout: 9000 });
        await sleep(300);
        await page.screenshot({ path: path.join(ROOT, "shots", name + ".png") });
        console.log("  📸 shots/" + name + ".png");
        await ctx.close();
      }
    }
  }


  // ================================================================================
  //  AF · ONE CLOCK PER JOB — persisted stamps are WALL time (2026-08-09)
  // ================================================================================
  // User, verbatim: "I did a total hard refresh on desktop and deleted all messages and then
  // did 4 messages in a row and they came in correct, then I went to mobile and added a
  // message and it went on TOP of those, instead of the bottom, so we clearly aren't sorting
  // by time received."
  //
  // LG.SIM_LOADED_AT is stamped when a TAB loads, so the replay clock restarts at the phase
  // instant on every page load and then runs at 8x only for as long as that tab has been open.
  // A desktop open 20 minutes is ~160 sim-minutes ahead of a phone that just opened the page —
  // and postChat stamped its `t` with LG.now(), which loadChat SORTS on. The phone's newest
  // message therefore carried the OLDEST timestamp on the board.
  //
  // WHY THE EXISTING SUITE COULD NOT CATCH THIS: every other section runs in ONE page, where a
  // per-page-load clock never varies, so the bug is structurally invisible. Every check below
  // therefore SIMULATES A SECOND DEVICE by rewriting LG.SIM_LOADED_AT — which is exactly what
  // a fresh page load does — and runs with the REPLAY ON at its real speed (every other
  // section boots ?sim=0, where LG.now() IS Date.now() and there is nothing to get wrong).
  section("AF · the replay clock is per-device: persisted stamps must be wall time");
  {
    const MIN = 60000;
    // A device that has had the page open for `openedMinsAgo` real minutes.
    const asDevice = (page, openedMinsAgo) => page.evaluate((m) => {
      window.__GFFL__.LG.SIM_LOADED_AT = Date.now() - m * 60000;
      return { simNow: window.__GFFL__.LG.now(), simStart: window.__GFFL__.LG.SIM_NOW };
    }, openedMinsAgo);

    // ---- AF1: two devices, one conversation. The whole reported bug.
    {
      const { ctx, page, errors } = await newTestPage(browser, seedSim2025());
      await bootSim(page);
      await clickIn(page, '.bnav button[data-v="chat"]');
      await page.waitForSelector("#chatList", { timeout: 9000 });

      // The replay really is on and really is moving — otherwise this whole section is testing
      // the ?sim=0 path by accident and proves nothing.
      const clock = await page.evaluate(() => ({ sim: window.__GFFL__.LG.SIM_2025, speed: window.__GFFL__.LG.SIM_SPEED }));
      ok(clock.sim === true && clock.speed > 0, "this section runs with the 2025 replay ON at speed " + clock.speed + " — the only configuration the bug exists in");

      const d1 = await asDevice(page, 20);   // "desktop, open 20 minutes" -> +160 sim-minutes
      ok(d1.simNow - d1.simStart > 150 * MIN,
        "a device open 20 minutes reads a league clock ~160 sim-minutes past the phase start (" + Math.round((d1.simNow - d1.simStart) / MIN) + " min)");
      await page.evaluate(() => window.__GFFL__.LG.postChat({ text: "first, from the desktop" }));
      const d2 = await asDevice(page, 0);    // "phone, just opened" -> back at the phase start
      ok(d2.simNow - d2.simStart < 5 * MIN,
        "…while a freshly-loaded one is back at the phase start — the two devices disagree by " + Math.round((d1.simNow - d2.simNow) / MIN) + " sim-minutes");
      await page.evaluate(() => window.__GFFL__.LG.postChat({ text: "second, from the phone" }));
      await page.evaluate(() => window.__GFFL__.UI.refreshChatList("chat", null));
      await sleep(200);

      const order = await page.evaluate(async () => {
        const msgs = await window.__GFFL__.LG.loadChat(null);
        const rows = [...document.querySelectorAll("#chatList .chatRowMsg")].map((r) => r.textContent);
        const idx = (frag) => rows.findIndex((t) => t.includes(frag));
        const at = (frag) => (msgs.find((m) => (m.text || "").includes(frag)) || {}).t;
        return { stored: msgs.map((m) => m.text), first: at("desktop"), second: at("phone"),
          domFirst: idx("desktop"), domSecond: idx("phone"), now: Date.now(),
          simNow: window.__GFFL__.LG.SIM_NOW };
      });
      ok(order.second > order.first,
        "the phone's message is stamped AFTER the desktop's, though the phone's replay clock reads far earlier (" + (order.second - order.first) + "ms apart)");
      ok(order.domSecond > order.domFirst && order.domFirst >= 0,
        "…and it renders BELOW it, not on top — the reported symptom (DOM rows " + order.domFirst + " then " + order.domSecond + ")");
      // THE GUARD, so this class cannot come back: the stored stamp is real-world time, and is
      // nowhere near the replay's own instant.
      ok(Math.abs(order.first - order.now) < 10000 && Math.abs(order.second - order.now) < 10000,
        "every stored chat stamp is within seconds of real Date.now() (" + (order.now - order.first) + "ms / " + (order.now - order.second) + "ms ago)");
      ok(Math.abs(order.first - order.simNow) > 300 * 24 * 3600 * 1000,
        "…and nowhere near LG.SIM_NOW, even with the replay running (" + Math.round((order.first - order.simNow) / 86400000) + " days apart)");

      // The ordering must not merely happen to work in one direction. Now make the third
      // "device" look like it has been open FAR LONGER than either — pre-fix that would push
      // its stamp far into the future and it would sort last for the wrong reason; the point
      // is that the direction of SIM_LOADED_AT no longer influences the order at all.
      await asDevice(page, 90);
      await page.evaluate(() => window.__GFFL__.LG.postChat({ text: "third, from a long-open tab" }));
      await asDevice(page, 0);
      await page.evaluate(() => window.__GFFL__.LG.postChat({ text: "fourth, from another fresh tab" }));
      await page.evaluate(() => window.__GFFL__.UI.refreshChatList("chat", null));
      await sleep(200);
      const four = await page.evaluate(() => [...document.querySelectorAll("#chatList .chatRowMsg")]
        .map((r) => (r.textContent.match(/(first|second|third|fourth)/) || [])[1]).filter(Boolean));
      ok(four.join(">") === "first>second>third>fourth",
        "four messages from devices with wildly different clocks read in true posting order, both directions (" + four.join(" > ") + ")");

      // The matchup page's trash-talk thread is the same widget on a different surface.
      await asDevice(page, 40);
      await page.evaluate(() => window.__GFFL__.LG.postChat({ text: "thread A", thread: "w1_1-2" }));
      await asDevice(page, 0);
      await page.evaluate(() => window.__GFFL__.LG.postChat({ text: "thread B", thread: "w1_1-2" }));
      await page.evaluate(() => { window.__GFFL__.UI.matchup = [1, 2]; return window.__GFFL__.UI.show("matchup"); });
      await page.waitForSelector("#muThreadList .chatRowMsg", { timeout: 12000 });
      const th = await page.evaluate(() => [...document.querySelectorAll("#muThreadList .chatRowMsg")]
        .map((r) => (r.textContent.match(/thread (A|B)/) || [])[1]).filter(Boolean));
      ok(th.join(">") === "A>B", "…and so does the matchup thread (" + th.join(" > ") + ")");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AF2: MIGRATION. Messages already in the family's store carry sim stamps.
    {
      // The reasoning to confirm rather than trust: a sim stamp is a FIXED 2025 instant
      // (~1.757e12) and a wall stamp is now (~1.786e12), so every legacy message sorts before
      // every new one — which is the true chronology, so nothing needs normalising. Seeded
      // here as a real mixed history rather than asserted in prose.
      const legacyA = Date.parse("2025-09-07T19:02:00Z");
      const legacyB = Date.parse("2025-09-07T21:40:00Z");
      const { ctx, page, errors } = await newTestPage(browser, seedSim2025({
        chat_legA: { kind: "chat", teamId: 1, who: "Peter", text: "legacy one", t: legacyA, thread: null, reactions: {} },
        chat_legB: { kind: "chat", teamId: 1, who: "Peter", text: "legacy two", t: legacyB, thread: null, reactions: {} },
        chat_newC: { kind: "chat", teamId: 2, who: "Sam", text: "already migrated", t: Date.now() - 60000, thread: null, reactions: {} },
      }));
      await bootSim(page);
      await clickIn(page, '.bnav button[data-v="chat"]');
      await page.waitForSelector("#chatList .chatRowMsg", { timeout: 9000 });
      await asDevice(page, 25);
      await page.evaluate(() => window.__GFFL__.LG.postChat({ text: "posted right now" }));
      await page.evaluate(() => window.__GFFL__.UI.refreshChatList("chat", null));
      await sleep(200);
      const mixed = await page.evaluate(() => [...document.querySelectorAll("#chatList .chatRowMsg")]
        .map((r) => (r.textContent.match(/legacy one|legacy two|already migrated|posted right now/) || [])[0]).filter(Boolean));
      ok(mixed.join(" > ") === "legacy one > legacy two > already migrated > posted right now",
        "a MIXED history of sim-stamped and wall-stamped messages still reads in true chronological order — no migration needed (" + mixed.join(" > ") + ")");
      const gap = await page.evaluate(() => Date.now() - Date.parse("2025-09-07T21:40:00Z"));
      ok(gap > 0, "…because a replay stamp is a fixed 2025 instant and always sorts before real time (" + Math.round(gap / 86400000) + " days)");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AF3: a trade's review window is judged the same on every device.
    {
      const { ctx, page, errors } = await newTestPage(browser, seedSim2025());
      await bootSim(page);
      // Accept from a FRESHLY loaded device…
      await asDevice(page, 0);
      const acc = await page.evaluate(async () => {
        const LG = window.__GFFL__.LG;
        // A 12-hour review, because the replay clock is CLAMPED ~33 sim-hours past the phase
        // start (it may never roll into week 2) — with the default 48 no device could out-run
        // the window in season time and the pre-fix failure would be unreachable. 12h is a
        // legal setting; what is under test is which CLOCK judges it, not its length.
        LG.rules.trades.reviewHours = 12;
        const off = await LG.offerTrade(2, 1, ["222333"], ["3915511"], "");
        const a = await LG.acceptTrade(off.trade.id, 1);
        return { id: off.trade.id, offeredAt: off.trade.t, acceptedAt: a.acceptedAt, endsAt: a.reviewEndsAt,
          now: Date.now(), reviewH: LG.rules.trades.reviewHours };
      });
      ok(Math.abs(acc.acceptedAt - acc.now) < 10000 && Math.abs(acc.offeredAt - acc.now) < 10000,
        "a trade's offered/accepted stamps are real-world time (" + (acc.now - acc.offeredAt) + "ms / " + (acc.now - acc.acceptedAt) + "ms ago)");
      ok(acc.endsAt - acc.acceptedAt === acc.reviewH * 3600 * 1000,
        "…and its review window is the league's own " + acc.reviewH + " REAL hours from acceptance (" + Math.round((acc.endsAt - acc.acceptedAt) / 3600000) + "h)");
      // …then ask a device that has had the page open long enough for the REPLAY clock to have
      // run past 24 SIM hours (24h / 8x = 3 real hours). Pre-fix that device executed the trade
      // out from under the one that accepted it seconds earlier.
      const longOpen = await page.evaluate(async (id) => {
        const { LG, UI } = window.__GFFL__;
        LG.SIM_LOADED_AT = Date.now() - 7 * 3600 * 1000; // 7 real hours x8 = 56 sim hours, past a 48h window
        const simAhead = LG.now() - LG.SIM_NOW;
        await UI.maybeAutoExecuteTrades();
        const doc = await LG.db.getFresh("trade_" + id.split("_")[1] + "_" + id.split("_")[2]);
        return { simAheadH: Math.round(simAhead / 3600000), status: (doc || {}).status };
      }, acc.id);
      ok(longOpen.simAheadH >= acc.reviewH,
        "a long-open device's replay clock really is past the " + acc.reviewH + "-hour mark in SEASON time (" + longOpen.simAheadH + "h ahead)");
      ok(longOpen.status === "accepted",
        "…yet it does NOT execute the trade — the review window is a real-world day, judged identically on every device (" + longOpen.status + ")");
      // And when the real day HAS passed, any device executes it, whatever its replay clock.
      const expired = await page.evaluate(async (id) => {
        const { LG, UI } = window.__GFFL__;
        const doc = await LG.loadTrade(id, { fresh: true });
        await LG.saveTrade({ ...doc, reviewEndsAt: Date.now() - 1000 });
        LG.SIM_LOADED_AT = Date.now(); // a freshly-loaded device, replay clock at the phase start
        await UI.maybeAutoExecuteTrades();
        const after = await LG.loadTrade(id, { fresh: true });
        return after.status;
      }, acc.id);
      ok(expired === "executed",
        "…and once the real 24 hours are up, a freshly-loaded device executes it just the same (" + expired + ")");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }
  }

  // ================================================================================
  //  AG · the Moves rework + the matchup's colour language (2026-08-09, items 19-25)
  // ================================================================================
  // Seven asks from one session at the wheel. Five of them are claims about PIXELS ("the
  // color should take up the width and height of the column", "we need to be able to see add,
  // type and projection without horizontal scrolling", "a gold border around that player"), so
  // almost everything here is a MEASUREMENT. The before-numbers quoted in the messages were
  // measured against the pre-batch code by stashing the app files back to HEAD.
  //
  // PRE-FIX: 56 of these 85 checks FAIL against HEAD (plus 14 restaged pre-existing ones, all
  // on-point). The 29 that pass either way are deliberate REGRESSION INVARIANTS and nothing
  // else: ten "0 page errors"; the six surviving columns' sort controls (the ADD one, which is
  // new, does fail); four "nothing is clipped" (the point of those is that the bigger type
  // must not START clipping); the page never scrolling sideways and the panner still panning;
  // the desktop table still fitting; a free agent's ADD button still being live (the enabled
  // counterpart to the new disabled state); Process-now surviving the card rework; nobody
  // being ringed under the replay; UI._tradeGive still carrying what the send path reads; and
  // a half-dismantled suggestion still being refused by the existing guard.
  //
  // The whole section is deliberately PRE-FIX TOLERANT (section AC's lesson): every hook it
  // exercises is new, and a bare wait or a bare evaluate against HEAD aborts the run with one
  // stack trace instead of the readable list a pre-fix verification exists to produce — hence
  // waitOr / waitFnOr / evalOr and a default for every result they can answer null with.
  section("AG · Moves: waiver blocks, collapsed trade builder, Suggest a trade, re-ordered players table · matchup: filled slot band, clock/injury colours, possession ring");
  {
    // ---- AG1: the Waivers card is three data blocks and no prose, in BOTH regimes.
    {
      fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await waitOr(page, ".mucard");
      await waitLive(page);
      await evalOr(page, () => window.__GFFL__.LG.gateCommish()); // create-on-first-use, consumes the stub prompt
      await evalOr(page, () => window.__GFFL__.UI.show("moves"));
      await waitOr(page, "#mvBlkFaab");
      // BEFORE this batch the card was: one FAAB line, then a "Claims process Wed 8:00 AM
      // (<full timestamp>)." paragraph, then an "Adding/dropping a player isn't locked by
      // kickoff" paragraph. Both paragraphs are gone; the deadline they carried moved INSIDE
      // the waiver block as its own value.
      const card = (await evalOr(page, () => {
        const blocks = document.querySelector("#mvBlkFaab").closest(".card");
        const blk = (id) => {
          const e = document.getElementById(id);
          return e && { cls: e.className, lab: e.querySelector(".mvblab").textContent.trim(),
            val: e.querySelector(".mvbval").textContent.trim(), sub: e.querySelector(".mvbsub").textContent.trim(),
            tag: (e.querySelector(".mvbtag") || {}).textContent || null };
        };
        return { n: document.querySelectorAll(".mvblocks .mvblk").length,
          paras: blocks.querySelectorAll("p").length,
          prose: /Claims process|isn't locked by kickoff|first come, first served\./.test(blocks.textContent),
          faab: blk("mvBlkFaab"), fa: blk("mvBlkFa"), wv: blk("mvBlkWaiver"),
          faabId: (document.getElementById("mvFaab") || {}).textContent };
      })) || { faab: {}, fa: {}, wv: {} };
      ok(card.n === 3, "the Waivers card is exactly three data blocks (" + card.n + ")");
      ok(card.paras === 0 && !card.prose, "…and carries no prose paragraph at all — both of the old sentences are gone (" + card.paras + " <p>)");
      ok(card.faab.lab === "FAAB budget" && card.faab.val === "$100" && card.faabId === "100",
        "block 1 is the FAAB budget, and #mvFaab still carries the raw figure the claim flow reads (" + JSON.stringify(card.faab) + ")");
      ok(card.fa.lab === "Free agency" && card.wv.lab === "Waivers", "blocks 2 and 3 are the two acquisition regimes, FA vs WAIVER");
      // Before the deadline the blind-bid regime is the one in force.
      ok(/\bon\b/.test(card.wv.cls) && card.wv.tag === "Now", "before the deadline, WAIVERS is the block marked as in force (" + card.wv.cls + "/" + card.wv.tag + ")");
      ok(/\boff\b/.test(card.fa.cls) && card.fa.tag === null && card.fa.val === "Closed", "…and free agency is visibly stood down, not merely absent (" + JSON.stringify(card.fa) + ")");
      // The deadline itself IS the waiver block's value: time on the value line, date under it,
      // hand-checked against LG.waiverDeadline's own answer.
      const dl = (await evalOr(page, () => {
        const d = new Date(window.__GFFL__.LG.waiverDeadline(1));
        return { t: d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
                 d: d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) };
      })) || {};
      ok(card.wv.val === dl.t && card.wv.sub === dl.d,
        "…and the deadline is the waiver block's own value — time on the value line, date under it (" + card.wv.val + " / " + card.wv.sub + ")");
      ok(!!(await page.$("#mvProcessNow")), "the commissioner's Process-now button survives the rework");
      // Past the deadline the two blocks swap, with no other change to the card.
      const after = (await evalOr(page, async (ts) => {
        const { LG, UI } = window.__GFFL__;
        LG.nowOverride = ts;
        await UI.renderMoves();
        const blk = (id) => { const e = document.getElementById(id); return { cls: e.className, val: e.querySelector(".mvbval").textContent.trim(), tag: !!e.querySelector(".mvbtag") }; };
        const r = { fa: blk("mvBlkFa"), wv: blk("mvBlkWaiver"), n: document.querySelectorAll(".mvblocks .mvblk").length };
        LG.nowOverride = null;
        return r;
      }, (await evalOr(page, () => window.__GFFL__.LG.waiverDeadline(1))) + 3600000)) || { fa: {}, wv: {} };
      ok(/\bon\b/.test(after.fa.cls) && after.fa.val === "Open" && after.fa.tag,
        "past the deadline the FREE AGENCY block takes over, and says so (" + JSON.stringify(after.fa) + ")");
      ok(/\boff\b/.test(after.wv.cls) && !after.wv.tag && after.n === 3,
        "…the waiver block stands down, and it is still three blocks either way (" + JSON.stringify(after.wv) + ")");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }
    {
      // A non-commissioner sees the blocks but not the Process-now button.
      const seed = fullSeed();
      const { ctx, page, errors } = await newTestPage(browser, seed);
      await page.evaluateOnNewDocument(() => { try { sessionStorage.removeItem("gffl_commish"); } catch (e) {} });
      await bootPage(page);
      await waitOr(page, ".mucard");
      await evalOr(page, () => { window.__GFFL__.LG.commishUnlocked = () => false; return window.__GFFL__.UI.renderMoves(); });
      await waitOr(page, "#mvBlkFaab");
      const nonc = (await evalOr(page, () => document.querySelectorAll(".mvblocks .mvblk").length)) || 0;
      ok(nonc === 3 && !(await page.$("#mvProcessNow")), "a non-commissioner gets the three blocks and no Process-now button (" + nonc + " blocks)");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AG2: the trade builder starts collapsed and expands on the plus.
    {
      fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await waitOr(page, ".mucard");
      await waitLive(page);
      await evalOr(page, () => window.__GFFL__.UI.show("moves"));
      await waitOr(page, "#mvGive .tradeadd");
      // BEFORE: 12 pick chips on the give side and 3 on the get side, every one of them
      // rendered the instant the tab mounted, ~1100px of trade builder nobody asked for.
      const shut = (await evalOr(page, () => ({
        give: document.querySelectorAll("#mvGive .pickchip").length,
        get: document.querySelectorAll("#mvGet .pickchip").length,
        plus: document.querySelectorAll(".tradeside .tradeadd").length,
        expanded: document.querySelector("#mvGive .tradeadd").getAttribute("aria-expanded"),
        noPicker: !document.querySelector("#mvGive .tradepick"),
        cardH: Math.round(document.querySelector("#mvTradeTeam").closest(".card").getBoundingClientRect().height),
      }))) || {};
      ok(shut.give === 0 && shut.get === 0, "the trade builder renders NO roster chips on open — both sides start collapsed (" + shut.give + "/" + shut.get + ")");
      ok(shut.plus === 2 && shut.expanded === "false", "…each side offers a plus instead, correctly marked collapsed");
      ok(shut.noPicker, "…and the picker is not merely hidden — a collapsed side builds no picker DOM at all");
      ok(shut.cardH < 420, "…so the whole card is a fraction of its old height (" + shut.cardH + "px, was ~1100 with both rosters spilled out)");
      // The plus expands it, and the counterparty select is still right there above it.
      await openTradeSideOr(page, "give");
      const open = (await evalOr(page, () => ({
        chips: document.querySelectorAll("#mvGive .pickchip").length,
        expanded: document.querySelector("#mvGive .tradeadd").getAttribute("aria-expanded"),
        other: document.querySelectorAll("#mvGet .pickchip").length,
        sel: !!document.querySelector("#mvTradeTeam"),
      }))) || {};
      ok(open.chips === 12 && open.expanded === "true", "tapping the plus expands that side's picker (" + open.chips + " chips)");
      ok(open.other === 0, "…and only that side — the other stays collapsed");
      ok(open.sel, "…with the counterparty dropdown still visible above them both");
      // Pick, collapse, and the chosen player survives.
      await clickChildIn(page, "#mvGive .pickchip", ".pcpick", "B. Backup");
      const picked = (await evalOr(page, () => ({
        sel: [...document.querySelectorAll("#mvGive .tradesel .tradechip")].map((e) => e.textContent.replace(/\s+/g, " ").trim()),
        stillInPicker: !!document.querySelector('#mvGive .tradepick .pickchip[data-gk="111333"]'),
        set: [...window.__GFFL__.UI._tradeGive],
      }))) || { sel: [], set: [] };
      ok(picked.sel.length === 1 && /B\. Backup/.test(picked.sel[0]), "picking a player moves him up into the selection strip (" + JSON.stringify(picked.sel) + ")");
      ok(picked.sel.length === 1 && !picked.stillInPicker, "…and out of the picker, so he can't be picked twice");
      ok(picked.set.join() === "111333", "…and UI._tradeGive — what the send path reads — carries his key, unchanged");
      await evalOr(page, () => document.querySelector("#mvGive .tradeadd").click()); // collapse again
      const collapsed = (await evalOr(page, () => ({
        chips: document.querySelectorAll("#mvGive .pickchip").length,
        sel: document.querySelectorAll("#mvGive .tradesel .tradechip").length,
        gone: !document.querySelector("#mvGive .tradepick"),
      }))) || {};
      ok(collapsed.gone && collapsed.chips === 0, "collapsing again puts the picker away");
      ok(collapsed.sel === 1, "…and the chosen player is STILL on screen — you can always see what you are offering");
      // The remove affordance takes him back off.
      await evalOr(page, () => document.querySelector("#mvGive .tradechip .tradedrop").click());
      const removed = (await evalOr(page, () => ({ sel: document.querySelectorAll("#mvGive .tradesel .tradechip").length, set: [...window.__GFFL__.UI._tradeGive].length }))) || {};
      ok(removed.sel === 0 && removed.set === 0, "…and its remove button takes him back out of the offer entirely");
      // The 3-player cap still holds, and past it the plus is replaced by the limit line.
      const capped = (await evalOr(page, () => {
        const { UI } = window.__GFFL__;
        UI._tradeGive = new Set(["111333", "111666", "111777"]);
        UI._renderTradeSide("give");
        return { sel: document.querySelectorAll("#mvGive .tradesel .tradechip").length, plus: !!document.querySelector("#mvGive .tradeadd") };
      })) || {};
      ok(capped.sel === 3 && capped.plus === false, "at the 3-player cap the plus is gone — the limit is stated, not silently ignored");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AG3: Suggest a trade. THE ALGORITHM, against hand-built rosters whose right answer
    // is arithmetic. Values come straight from D.projFor (stubbed here so the numbers under
    // test are the ones written down below rather than a fixture's incidental projections);
    // no season log exists for these keys, so tradeValueOf falls through to the projection
    // alone and every figure in this block is the one in the roster tables.
    //
    //   MINE   QB 18 · RB 20/16/14/12 · WR 8/6 · TE 9 · K 7 · DST 6      deep at RB, thin at WR
    //   THEIRS QB 17 · RB 9/7        · WR 19/17/15/13 · TE 8 · K 6 · DST 5   the mirror image
    //
    //   strength(pos) = the top N by value, N = that position's STARTING requirement
    //   edge(RB) = (20+16) - (9+7)  = +20   -> my depth,  their weakness
    //   edge(WR) = (8+6)   - (19+17)= -22   -> my weakness, their depth
    //   Every other position is a singleton on both rosters, so sending one would leave a
    //   hole — those are filtered by the legality rule, not by luck.
    //   Survivors inside tolerance (max(1.5, 15% of the larger side)), best RELATIVE
    //   imbalance first:  R1 20 <-> W1 19  (gap 1.0, rel .051)  <  R2 16 <-> W2 17 (rel .061)
    //   so the suggestion is my best RB for their best WR.
    {
      const mkRoster = (teamId, rows) => ({ kind: "roster", week: 1, teamId,
        players: rows.map(([key, name, pos, slot, team]) => ({ key, name, pos, team: team || "DEN", slot })) });
      const MINE = [["m_qb", "My QB", "QB", "QB"], ["m_rb1", "My RB One", "RB", "RB"], ["m_rb2", "My RB Two", "RB", "RB"],
        ["m_rb3", "My RB Three", "RB", "FLEX"], ["m_rb4", "My RB Four", "RB", "BENCH"],
        ["m_wr1", "My WR One", "WR", "WR"], ["m_wr2", "My WR Two", "WR", "WR"],
        ["m_te", "My TE", "TE", "TE"], ["m_k", "My K", "K", "K"], ["m_dst", "My DST", "DST", "DST"]];
      const THEIRS = [["t_qb", "Their QB", "QB", "QB"], ["t_rb1", "Their RB One", "RB", "RB"], ["t_rb2", "Their RB Two", "RB", "RB"],
        ["t_wr1", "Their WR One", "WR", "WR"], ["t_wr2", "Their WR Two", "WR", "WR"],
        ["t_wr3", "Their WR Three", "WR", "FLEX"], ["t_wr4", "Their WR Four", "WR", "BENCH"],
        ["t_te", "Their TE", "TE", "TE"], ["t_k", "Their K", "K", "K"], ["t_dst", "Their DST", "DST", "DST"]];
      const VALS = { m_qb: 18, m_rb1: 20, m_rb2: 16, m_rb3: 14, m_rb4: 12, m_wr1: 8, m_wr2: 6, m_te: 9, m_k: 7, m_dst: 6,
        t_qb: 17, t_rb1: 9, t_rb2: 7, t_wr1: 19, t_wr2: 17, t_wr3: 15, t_wr4: 13, t_te: 8, t_k: 6, t_dst: 5 };
      const base = fullSeed();
      const seed = { ...base, docs: { ...base.docs,
        roster_2026_w1_t1: mkRoster(1, MINE), roster_2026_w1_t2: mkRoster(2, THEIRS) } };
      fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
      const { ctx, page, errors } = await newTestPage(browser, seed);
      await bootPage(page);
      await waitOr(page, ".mucard");
      // Deliberately NO waitLive(): these rosters are hand-built with keys the Sleeper fixture
      // has never heard of, so no live row will ever land for them — and nothing here needs
      // one, since every value under test comes from the stubbed projFor below.
      await evalOr(page, () => window.__GFFL__.UI.show("moves"));
      await waitOr(page, "#mvSuggest");
      await evalOr(page, (v) => { window.__GFFL__.D.projFor = (k) => (k in v ? v[k] : null); }, VALS);
      const call = (mine, theirs) => evalOr(page, (m, t) => {
        const s = window.__GFFL__.UI.suggestTradePair(m, t);
        return s && { give: s.give.map((p) => p.key), get: s.get.map((p) => p.key),
          giveVal: s.giveVal, getVal: s.getVal, balance: s.balance, kind: s.kind, why: s.why, strict: s.strict };
      }, mine, theirs);
      const rosters = (await evalOr(page, () => ({ mine: window.__GFFL__.UI._rosters[1], theirs: window.__GFFL__.UI._rosters[2] }))) || { mine: [], theirs: [] };
      const s1 = await call(rosters.mine, rosters.theirs);
      ok(!!s1 && s1.give.join() === "m_rb1" && s1.get.join() === "t_wr1",
        "the suggestion is my best RB for their best WR — my surplus for my deficit, hand-computed (" + JSON.stringify(s1 && [s1.give, s1.get]) + ")");
      ok(s1 && s1.giveVal === 20 && s1.getVal === 19 && Math.abs(s1.balance - 1) < 1e-9,
        "…valued 20.0 for 19.0, a 1.0 gap (" + JSON.stringify(s1 && { g: s1.giveVal, r: s1.getVal, b: s1.balance }) + ")");
      ok(!!s1 && s1.balance <= Math.max(1.5, 0.15 * Math.max(s1.giveVal, s1.getVal)),
        "…inside the stated tolerance: 1.5 points, or 15% of the larger side, whichever is bigger (" + (s1 || {}).balance + " <= 3)");
      ok(s1 && s1.kind === "1-for-1" && s1.strict === true, "…a straight one-for-one, and it cleared the STRICT filter (both sides' starting lineups improve)");
      ok(s1 && s1.why === "You're deep at RB; they're deep at WR.", "…and it says why in one line, naming the two positions (" + (s1 || {}).why + ")");
      // POSITIONAL LOGIC, stated as the numbers rather than trusted: I send from the position
      // where my starters out-score theirs, and receive at the one where they out-score mine.
      const edges = (await evalOr(page, (m, t) => {
        const V = window.__GFFL__.UI.tradeValueOf;
        const top = (r, pos, n) => r.filter((p) => p.pos === pos).map(V).sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0);
        return { rb: top(m, "RB", 2) - top(t, "RB", 2), wr: top(m, "WR", 2) - top(t, "WR", 2) };
      }, rosters.mine, rosters.theirs)) || {};
      ok(edges.rb === 20 && edges.wr === -22,
        "…and those really are my strongest and weakest positions relative to theirs (RB " + edges.rb + ", WR " + edges.wr + ")");
      // Legality: my only QB/TE/K/DST are never offered, because sending one leaves a hole.
      const everSingleton = await evalOr(page, (m, t) => {
        const s = window.__GFFL__.UI.suggestTradePair(m, t);
        return s ? s.give.concat(s.get).some((k) => /_(qb|te|k|dst)$/.test(k)) : false;
      }, rosters.mine, rosters.theirs);
      ok(everSingleton === false, "…and neither side is ever asked to give up its only QB, TE, K or D/ST");
      // A LOCKED player is never offered. m_rb1's team is switched to PHI, whose game is live
      // in this fixture — so the suggestion has to fall to the next-best balanced pair,
      // R2 16 <-> W2 17 (gap 1.0, rel .061), which is exactly what it does.
      const s2 = await evalOr(page, (m, t) => {
        const mine = m.map((p) => (p.key === "m_rb1" ? { ...p, team: "PHI" } : p));
        const s = window.__GFFL__.UI.suggestTradePair(mine, t);
        return s && { give: s.give.map((p) => p.key), get: s.get.map((p) => p.key), giveVal: s.giveVal, getVal: s.getVal };
      }, rosters.mine, rosters.theirs);
      ok(s2 && s2.give.join() === "m_rb2" && s2.get.join() === "t_wr2" && s2.giveVal === 16 && s2.getVal === 17,
        "a player whose game has already kicked off is never offered — the suggestion falls to the next balanced pair (" + JSON.stringify(s2) + ")");
      // Nothing sensible on the board -> a plain "no", not a silly trade. Two identical
      // rosters have zero edge at every position, so there is no weakness to trade into.
      // "missing" vs "null" matters: an app with no suggester at all would otherwise pass this
      // for the wrong reason, which is exactly what a pre-fix verification is there to catch.
      const none = await evalOr(page, (m) => {
        const { UI } = window.__GFFL__;
        if (typeof UI.suggestTradePair !== "function") return "missing";
        return UI.suggestTradePair(m, m.map((p) => ({ ...p, key: "x_" + p.key }))) === null ? "null" : "some";
      }, rosters.mine);
      ok(none === "null", "two evenly-matched rosters produce NO suggestion rather than a pointless one (" + none + ")");
      // …and the UI says so in plain words instead of doing nothing. The counterparty's real
      // ROSTER DOC is rewritten as a clone of mine (mutating UI._rosters would achieve
      // nothing — renderMoves reloads it from the backend on every pass), so the button runs
      // against a genuinely evenly-matched opponent.
      await evalOr(page, (v) => { window.__GFFL__.D.projFor = (k) => (k in v ? v[k] : (k.slice(0, 2) === "x_" && k.slice(2) in v ? v[k.slice(2)] : null)); }, VALS);
      await evalOr(page, async () => {
        const { LG, UI } = window.__GFFL__;
        await LG.saveRoster(1, 2, UI._rosters[1].map((p) => ({ ...p, key: "x_" + p.key, name: "X " + p.name })));
        UI._rosters = null;
        await UI.renderMoves();
      });
      await waitOr(page, "#mvSuggest");
      await evalOr(page, () => document.querySelector("#mvSuggest").click());
      const saidSo = await waitFnOr(page, () => /No even trade fits/.test(document.querySelector("#mvSuggestWhy").textContent));
      ok(saidSo, "…and when nothing fits the card says so in plain words rather than proposing something silly");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }
    {
      // AG3b: the BUTTON — it fills both sides for real, and it never sends.
      const mkRoster = (teamId, rows) => ({ kind: "roster", week: 1, teamId,
        players: rows.map(([key, name, pos, slot]) => ({ key, name, pos, team: "DEN", slot })) });
      const MINE = [["m_qb", "My QB", "QB", "QB"], ["m_rb1", "My RB One", "RB", "RB"], ["m_rb2", "My RB Two", "RB", "RB"],
        ["m_rb3", "My RB Three", "RB", "FLEX"], ["m_rb4", "My RB Four", "RB", "BENCH"],
        ["m_wr1", "My WR One", "WR", "WR"], ["m_wr2", "My WR Two", "WR", "WR"],
        ["m_te", "My TE", "TE", "TE"], ["m_k", "My K", "K", "K"], ["m_dst", "My DST", "DST", "DST"]];
      const THEIRS = [["t_qb", "Their QB", "QB", "QB"], ["t_rb1", "Their RB One", "RB", "RB"], ["t_rb2", "Their RB Two", "RB", "RB"],
        ["t_wr1", "Their WR One", "WR", "WR"], ["t_wr2", "Their WR Two", "WR", "WR"],
        ["t_wr3", "Their WR Three", "WR", "FLEX"], ["t_wr4", "Their WR Four", "WR", "BENCH"],
        ["t_te", "Their TE", "TE", "TE"], ["t_k", "Their K", "K", "K"], ["t_dst", "Their DST", "DST", "DST"]];
      const VALS = { m_qb: 18, m_rb1: 20, m_rb2: 16, m_rb3: 14, m_rb4: 12, m_wr1: 8, m_wr2: 6, m_te: 9, m_k: 7, m_dst: 6,
        t_qb: 17, t_rb1: 9, t_rb2: 7, t_wr1: 19, t_wr2: 17, t_wr3: 15, t_wr4: 13, t_te: 8, t_k: 6, t_dst: 5 };
      const base = fullSeed();
      const seed = { ...base, docs: { ...base.docs, roster_2026_w1_t1: mkRoster(1, MINE), roster_2026_w1_t2: mkRoster(2, THEIRS) } };
      fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
      const { ctx, page, errors } = await newTestPage(browser, seed);
      await bootPage(page);
      await waitOr(page, ".mucard");
      // Deliberately NO waitLive(): these rosters are hand-built with keys the Sleeper fixture
      // has never heard of, so no live row will ever land for them — and nothing here needs
      // one, since every value under test comes from the stubbed projFor below.
      await evalOr(page, () => window.__GFFL__.UI.show("moves"));
      await waitOr(page, "#mvSuggest");
      await evalOr(page, (v) => { window.__GFFL__.D.projFor = (k) => (k in v ? v[k] : null); }, VALS);
      await evalOr(page, () => document.querySelector("#mvSuggest").click());
      await waitFnOr(page, () => document.querySelectorAll("#mvGive .tradechip").length === 1);
      const filled = (await evalOr(page, () => ({
        give: [...document.querySelectorAll("#mvGive .tradesel .tradechip")].map((e) => e.textContent.replace(/\s+/g, " ").trim()),
        get: [...document.querySelectorAll("#mvGet .tradesel .tradechip")].map((e) => e.textContent.replace(/\s+/g, " ").trim()),
        why: document.querySelector("#mvSuggestWhy").textContent,
        giveSet: [...window.__GFFL__.UI._tradeGive], getSet: [...window.__GFFL__.UI._tradeGet],
      }))) || { give: [], get: [], giveSet: [], getSet: [], why: "" };
      // Names render in the app's short form (LG.shortName): "My RB One" -> "M. One".
      ok(/M\. One/.test(filled.give[0] || "") && /T\. One/.test(filled.get[0] || ""),
        "the button fills BOTH sides of the real builder with the suggested pair (" + JSON.stringify([filled.give, filled.get]) + ")");
      ok(filled.giveSet.join() === "m_rb1" && filled.getSet.join() === "t_wr1", "…into the same selections the Send button reads, so it is a normal editable offer");
      ok(/deep at RB/.test(filled.why) && /20\.0 for 19\.0/.test(filled.why), "…and explains itself with the two values (" + filled.why + ")");
      const sent = (await evalOr(page, () => window.__GFFL__.LG.loadTrades())) || [];
      ok(sent.length === 0 && filled.giveSet.length > 0,
        "…and having filled the builder it has still sent NOTHING — the user reviews and presses Send themselves (" + sent.length + " trades on the board)");
      if (SHOTS) {
        // Scroll the TRADE card into frame first — a viewport shot of the top of Moves shows
        // the waiver blocks, which is a different plate's job. (Viewport, never fullPage:
        // this page carries sticky chrome and fullPage has already been caught disagreeing
        // with it in this repo.)
        await evalOr(page, () => {
          const c = document.querySelector("#mvTradeTeam").closest(".card");
          window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 60);
        });
        await sleep(250);
        await page.screenshot({ path: path.join(ROOT, "shots", "gffl_trade_suggest.png") });
        console.log("  📸 shots/gffl_trade_suggest.png");
      }
      // Editing the suggestion still works: drop one side and the Send path refuses, as ever.
      await evalOr(page, () => document.querySelector("#mvGet .tradechip .tradedrop").click());
      await evalOr(page, () => document.querySelector("#mvTradeSend").click());
      const stillNone = (await evalOr(page, () => window.__GFFL__.LG.loadTrades())) || [];
      ok(stillNone.length === 0, "…and a suggestion the user has half-dismantled can't be sent either — the existing guard is untouched");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }
    {
      // AG3c: the 2-for-2 fallback, when no single pair can balance.
      //   MINE   RB 20/6/5/5 (four of them) · WR 4/3    THEIRS  WR 13/13/2/2 · RB 3/2
      //   Every 1-for-1 is outside tolerance (20-13 = 7 against a 3.0 allowance; 6-13 = 7
      //   against 1.95; 6-2 = 4 against 1.5; 5-2 = 3 against 1.5) — so the only balanced
      //   trade on the board is (20 + 6) for (13 + 13), which is dead even at 26 apiece.
      const mk = (teamId, rows) => ({ kind: "roster", week: 1, teamId,
        players: rows.map(([key, name, pos, slot]) => ({ key, name, pos, team: "DEN", slot })) });
      const MINE = [["m_qb", "My QB", "QB", "QB"], ["m_rb1", "My RB One", "RB", "RB"], ["m_rb2", "My RB Two", "RB", "RB"],
        ["m_rb3", "My RB Three", "RB", "FLEX"], ["m_rb4", "My RB Four", "RB", "BENCH"],
        ["m_wr1", "My WR One", "WR", "WR"], ["m_wr2", "My WR Two", "WR", "WR"],
        ["m_te", "My TE", "TE", "TE"], ["m_k", "My K", "K", "K"], ["m_dst", "My DST", "DST", "DST"]];
      const THEIRS = [["t_qb", "Their QB", "QB", "QB"], ["t_rb1", "Their RB One", "RB", "RB"], ["t_rb2", "Their RB Two", "RB", "RB"],
        ["t_wr1", "Their WR One", "WR", "WR"], ["t_wr2", "Their WR Two", "WR", "WR"],
        ["t_wr3", "Their WR Three", "WR", "FLEX"], ["t_wr4", "Their WR Four", "WR", "BENCH"],
        ["t_te", "Their TE", "TE", "TE"], ["t_k", "Their K", "K", "K"], ["t_dst", "Their DST", "DST", "DST"]];
      const VALS = { m_qb: 15, m_rb1: 20, m_rb2: 6, m_rb3: 5, m_rb4: 5, m_wr1: 4, m_wr2: 3, m_te: 5, m_k: 4, m_dst: 4,
        t_qb: 14, t_rb1: 3, t_rb2: 2, t_wr1: 13, t_wr2: 13, t_wr3: 2, t_wr4: 2, t_te: 4, t_k: 3, t_dst: 3 };
      const base = fullSeed();
      const seed = { ...base, docs: { ...base.docs, roster_2026_w1_t1: mk(1, MINE), roster_2026_w1_t2: mk(2, THEIRS) } };
      fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
      const { ctx, page, errors } = await newTestPage(browser, seed);
      await bootPage(page);
      await waitOr(page, ".mucard");
      // Deliberately NO waitLive(): these rosters are hand-built with keys the Sleeper fixture
      // has never heard of, so no live row will ever land for them — and nothing here needs
      // one, since every value under test comes from the stubbed projFor below.
      await evalOr(page, () => window.__GFFL__.UI.show("moves"));
      await waitOr(page, "#mvSuggest");
      await evalOr(page, (v) => { window.__GFFL__.D.projFor = (k) => (k in v ? v[k] : null); }, VALS);
      const s = await evalOr(page, () => {
        const { UI } = window.__GFFL__;
        const r = UI.suggestTradePair(UI._rosters[1], UI._rosters[2]);
        return r && { give: r.give.map((p) => p.key).sort(), get: r.get.map((p) => p.key).sort(), giveVal: r.giveVal, getVal: r.getVal, kind: r.kind };
      });
      ok(!!s && s.kind === "2-for-2", "when no single pair can balance, it offers a 2-for-2 rather than giving up (" + (s || {}).kind + ")");
      ok(s && s.give.join() === "m_rb1,m_rb2" && s.get.join() === "t_wr1,t_wr2",
        "…the exact pair of pairs the arithmetic picks (" + JSON.stringify(s && [s.give, s.get]) + ")");
      ok(s && s.giveVal === 26 && s.getVal === 26, "…dead even at 26 apiece (" + JSON.stringify(s && { g: s.giveVal, r: s.getVal }) + ")");
      // …and it is still legal: both rosters keep two RBs, two WRs and a full flex pool.
      const legal = (await evalOr(page, () => {
        const { UI } = window.__GFFL__;
        const r = UI.suggestTradePair(UI._rosters[1], UI._rosters[2]);
        const after = (ros, out, inn) => { const g = new Set(out.map((p) => p.key)); const l = ros.filter((p) => !g.has(p.key)).concat(inn);
          const c = {}; for (const p of l) c[p.pos] = (c[p.pos] || 0) + 1; return c; };
        return { mine: after(UI._rosters[1], r.give, r.get), theirs: after(UI._rosters[2], r.get, r.give) };
      })) || { mine: {}, theirs: {} };
      ok(legal.mine.RB >= 2 && legal.mine.WR >= 2 && legal.theirs.RB >= 2 && legal.theirs.WR >= 2,
        "…and neither roster is left short of a starting slot afterwards (" + JSON.stringify(legal) + ")");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AG4: the players table's new column order, its greying, and the phone budget.
    {
      fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
      const { ctx, page, errors } = await newTestPage(browser, fullSeed());
      await bootPage(page);
      await waitOr(page, ".mucard");
      await waitLive(page);
      await evalOr(page, () => window.__GFFL__.UI.show("moves"));
      await waitOr(page, "#faPosChips");
      await waitFnOr(page, () => document.querySelectorAll("#faResults [data-fi]").length > 0);
      // An available player's button is genuinely usable — the counterpart to I2's disabled
      // cases, so "greyed out" is proved to be a real state and not the only state.
      const avail = (await evalOr(page, () => {
        const tr = [...document.querySelectorAll("#faResults tr")].find((r) => r.textContent.includes("F. Agent"));
        const b = tr && tr.querySelector(".faMoveBtn");
        return { has: !!b, disabled: !!(b && b.disabled), title: (b && b.title) || "" };
      })) || {};
      ok(avail.has && avail.disabled === false && avail.title === "", "a genuine free agent's ADD button is live, with nothing to explain away");
      // Every remaining column sorts, arrows and all — including ADD, which groups the rows
      // you can actually act on to the top rather than being the one dead header on the row.
      for (const col of ["player", "add", "type", "proj", "last", "opp", "avg"]) {
        await clickIn(page, 'th.thsort[data-sort="' + col + '"]');
        const st = (await evalOr(page, (c) => {
          const th = document.querySelector('th.thsort[data-sort="' + c + '"]');
          return { active: th.classList.contains("active"), arrow: /[▼▲]/.test(th.textContent) };
        }, col)) || {};
        ok(st.active && st.arrow, "the " + col.toUpperCase() + " header is a working sort control (active + arrow)");
      }
      await clickIn(page, "#faFilterChips .poschip", "All");
      await waitFnOr(page, () => [...document.querySelectorAll("#faResults tr")].some((r) => r.textContent.includes("P. Passer")));
      await clickIn(page, 'th.thsort[data-sort="add"]'); // desc = addable first
      await waitFnOr(page, () => {
        const th = document.querySelector('th.thsort[data-sort="add"]');
        return th.classList.contains("active") && /▼/.test(th.textContent);
      });
      const grouped = (await evalOr(page, () => {
        const rows = [...document.querySelectorAll("#faResults tbody tr")].map((r) => !r.querySelector(".faMoveBtn").disabled);
        const firstBlocked = rows.indexOf(false);
        return { rows: rows.length, firstBlocked, anyAfter: firstBlocked < 0 ? false : rows.slice(firstBlocked).some(Boolean) };
      })) || {};
      ok(grouped.rows > 2 && grouped.firstBlocked > 0 && !grouped.anyAfter,
        "ADD desc really groups every addable row above every blocked one (" + JSON.stringify(grouped) + ")");
      // THE PHONE BUDGET (390x844): "we need to be able to see add, type and projection
      // without horizontal scrolling". Measured at scrollLeft 0 against the panning box's own
      // visible width — the sticky PLAYER column plus those three must all land inside it.
      const mob = (await evalOr(page, () => {
        const pan = document.querySelector("#faResults .panner");
        pan.scrollLeft = 0;
        const pr = pan.getBoundingClientRect();
        const tr = pan.querySelector("tbody tr");
        const edge = (sel) => Math.round(tr.querySelector(sel).getBoundingClientRect().right - pr.left);
        return { view: Math.round(pan.clientWidth), name: edge(".faname"), add: edge(".faadd"), type: edge(".fatype"), proj: edge(".faproj"),
                 win: window.innerWidth, body: document.body.scrollWidth, pans: pan.scrollWidth > pan.clientWidth };
      })) || {};
      ok(mob.name <= mob.view && mob.add <= mob.view && mob.type <= mob.view && mob.proj <= mob.view,
        "at 390px PLAYER, ADD, TYPE and PROJ all sit inside the visible box with no panning at all (right edges " +
        [mob.name, mob.add, mob.type, mob.proj].join("/") + " within " + mob.view + "px)");
      ok(mob.body <= mob.win + 1, "…and the PAGE still never scrolls sideways (" + mob.body + "/" + mob.win + ")");
      ok(mob.pans, "…while the columns after PROJ genuinely do still pan, as before (the box is doing real work)");
      if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_moves_390.png") }); console.log("  📸 shots/gffl_moves_390.png"); }
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }
    {
      // Desktop keeps every column on screen at once.
      fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
      const { ctx, page, errors } = await newTestPage(browser, fullSeed(), { vw: { width: 1440, height: 900 } });
      await bootPage(page);
      await waitOr(page, ".mucard");
      await waitLive(page);
      await evalOr(page, () => window.__GFFL__.UI.show("moves"));
      await waitFnOr(page, () => document.querySelectorAll("#faResults [data-fi]").length > 0);
      const desk = (await evalOr(page, () => {
        const pan = document.querySelector("#faResults .panner");
        const tr = pan.querySelector("tbody tr");
        const pr = pan.getBoundingClientRect();
        return { last: Math.round(tr.querySelector(".faavg").getBoundingClientRect().right - pr.left), view: Math.round(pan.clientWidth) };
      })) || {};
      ok(desk.last <= desk.view, "on a desktop the whole re-ordered table fits with no pan at all (" + desk.last + "/" + desk.view + ")");
      if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_moves_desktop.png") }); console.log("  📸 shots/gffl_moves_desktop.png"); }
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AG5: the centre band's type, and nothing clipped. (AD2/AE already assert that the
    // colour FILLS the cell and that consecutive cells are contiguous.)
    {
      fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
      const { ctx, page, errors } = await newTestPage(browser, seedLongNames());
      await bootPage(page);
      await waitOr(page, ".mucard");
      await waitLive(page);
      await clickIn(page, ".mucard.mine");
      await waitOr(page, "td.slotcell");
      // A Range around the text node, NOT scrollWidth: the badge sets overflow:hidden, and on
      // an element whose overflow is visible scrollWidth reports no overflow at all — the trap
      // this suite has already been caught by once.
      const type = (await evalOr(page, () => {
        const read = (sel) => {
          const b = document.querySelector(sel);
          if (!b) return null;
          const td = b.closest("td");
          const r = document.createRange(); r.selectNodeContents(b);
          return { txt: b.textContent.trim(), size: parseFloat(getComputedStyle(b).fontSize),
            text: Math.ceil(r.getBoundingClientRect().width), cell: Math.floor(td.getBoundingClientRect().width) };
        };
        const qb = [...document.querySelectorAll(".mutable:not(.benchtable) td.slotcell")]
          .find((td) => td.textContent.trim() === "QB");
        const rQB = (() => { const b = qb.querySelector(".slotbadge"); const r = document.createRange(); r.selectNodeContents(b);
          return { txt: "QB", size: parseFloat(getComputedStyle(b).fontSize), text: Math.ceil(r.getBoundingClientRect().width), cell: Math.floor(qb.getBoundingClientRect().width) }; })();
        return { qb: rQB, bench: read(".benchtable td.slotcell .slotbadge"), tot: read(".totalrow td.slotcell .slotbadge"),
          flex: (() => { const td = [...document.querySelectorAll("td.slotcell")].find((t) => t.textContent.trim() === "FLEX");
            if (!td) return null; const b = td.querySelector(".slotbadge"); const r = document.createRange(); r.selectNodeContents(b);
            return { txt: "FLEX", size: parseFloat(getComputedStyle(b).fontSize), text: Math.ceil(r.getBoundingClientRect().width), cell: Math.floor(td.getBoundingClientRect().width) }; })() };
      })) || { qb: {}, bench: {}, tot: null, flex: null };
      ok(type.qb.size >= 12, "at 390px a position label is set MUCH larger than before — 9px then, " + type.qb.size + "px now");
      ok(type.qb.text <= type.qb.cell, "…and QB still sits inside its cell (" + type.qb.text + "/" + type.qb.cell + "px)");
      for (const [k, v] of Object.entries({ BENCH: type.bench, TOT: type.tot, FLEX: type.flex })) {
        ok(!!v && v.text <= v.cell, "…so does " + k + ", the label that has to step down to fit (" + (v ? v.text + "/" + v.cell : "missing") + "px)");
      }
      ok(type.bench.size < type.qb.size, "…because a >3-character label takes the .sbwide step-down rather than clipping (" + type.bench.size + " vs " + type.qb.size + "px)");
      if (SHOTS) { await page.screenshot({ path: path.join(ROOT, "shots", "gffl_matchup_390.png") }); console.log("  📸 shots/gffl_matchup_390.png"); }
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }
    {
      // The same thing on a desktop, where the type steps up again.
      fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
      const { ctx, page, errors } = await newTestPage(browser, seedLongNames(), { vw: { width: 1440, height: 900 } });
      await bootPage(page);
      await waitOr(page, ".mucard");
      await waitLive(page);
      await clickIn(page, ".mucard.mine");
      await waitOr(page, "td.slotcell");
      const d = (await evalOr(page, () => {
        const cells = [...document.querySelectorAll(".mutable:not(.benchtable) td.slotcell")];
        const qb = cells.find((td) => td.textContent.trim() === "QB");
        const b = qb.querySelector(".slotbadge");
        const r = document.createRange(); r.selectNodeContents(b);
        const bench = document.querySelector(".benchtable td.slotcell .slotbadge");
        const br = document.createRange(); br.selectNodeContents(bench);
        return { size: parseFloat(getComputedStyle(b).fontSize), text: Math.ceil(r.getBoundingClientRect().width),
          cell: Math.floor(qb.getBoundingClientRect().width),
          benchText: Math.ceil(br.getBoundingClientRect().width), benchCell: Math.floor(bench.closest("td").getBoundingClientRect().width) };
      })) || {};
      ok(d.size >= 15, "on a desktop a position label is 16px, half again what it was (11px) (" + d.size + "px)");
      ok(d.text <= d.cell && d.benchText <= d.benchCell, "…and nothing is clipped at that size either (QB " + d.text + "/" + d.cell + ", BENCH " + d.benchText + "/" + d.benchCell + ")");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AG6: red means one thing. The live clock gives it up; the injury takes it.
    {
      fixture.phase = 1; fixture.sleeperDown = false; fixture.espnDown = false;
      const { ctx, page, errors } = await newTestPage(browser, seedLongNames());
      await bootPage(page);
      await waitOr(page, ".mucard");
      await waitLive(page);
      await clickIn(page, ".mucard.mine");
      await waitOr(page, ".gclock");
      const col = (await evalOr(page, () => {
        const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
        const root = getComputedStyle(document.documentElement);
        const clock = document.querySelector(".gclock");
        // A CSS probe, not a live element: the matchup lineup row deliberately carries no
        // injury designation of its own (the previous batch cut that row to three fixed
        // lines and a name, and every pixel of its width was fought for) — .inj lives on the
        // locker, the swap sheet, the players table and the stats card, all of which the
        // surfaces block below reads for real. This proves the RULE the four of them share.
        const probe = document.createElement("span");
        probe.className = "inj"; probe.textContent = "OUT";
        document.body.appendChild(probe);
        const injCol = getComputedStyle(probe).color;
        probe.remove();
        return { accent: hex(root.getPropertyValue("--accent").trim()), mut: hex(root.getPropertyValue("--mut").trim()),
          clock: clock && getComputedStyle(clock).color, clockTxt: clock && clock.textContent.trim(),
          clockWeight: clock && getComputedStyle(clock).fontWeight,
          inj: injCol, injTxt: "OUT",
          anyLiveRed: [...document.querySelectorAll(".pcellgrid .pmeta .live")].length };
      })) || {};
      ok(/^Q\d /.test(col.clockTxt || ""), "the matchup row really is showing a live quarter and clock (" + col.clockTxt + ")");
      ok(!!col.clock && col.clock !== col.accent, "…and it is NOT red any more (" + col.clock + " vs the accent " + col.accent + ")");
      ok(col.clock === col.mut, "…it is the ordinary muted stat colour, same as the opponent and kickoff it replaces (" + col.clock + ")");
      ok(col.clockWeight === "700", "…keeping only the bold weight that made it scannable");
      ok(col.anyLiveRed === 0, "…with no .live-red clock left anywhere on a lineup row");
      ok(col.inj === col.accent, "the Q/D/OUT designation IS red now — the one alarm on the row (" + col.injTxt + " " + col.inj + ")");
      // …and every other surface that renders .inj agrees, because they share one rule.
      const surfaces = (await evalOr(page, async () => {
        const { UI } = window.__GFFL__;
        const hex = (h) => { const n = parseInt(h.replace("#", ""), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
        const accent = hex(getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
        const out = {};
        UI.openLocker(1);
        await new Promise((r) => setTimeout(r, 400));
        const l = document.querySelector(".lrow .inj");
        out.locker = l ? getComputedStyle(l).color === accent : null;
        const sw = [...document.querySelectorAll(".lswap")].find((b) => !b.disabled);
        if (sw) { sw.click(); await new Promise((r) => setTimeout(r, 300));
          const s = document.querySelector("#swapSheet .inj"); out.swap = s ? getComputedStyle(s).color === accent : null;
          const sh = document.getElementById("swapSheet"); if (sh) sh.hidden = true; }
        UI.show("moves");
        await new Promise((r) => setTimeout(r, 900));
        const chips = document.querySelectorAll("#faFilterChips .poschip");
        if (chips[1]) chips[1].click();
        await new Promise((r) => setTimeout(r, 700));
        const t = document.querySelector("#faResults .inj");
        out.table = t ? getComputedStyle(t).color === accent : null;
        const row = [...document.querySelectorAll("#faResults tr[data-pk]")].find((r) => r.querySelector(".inj"));
        if (row) { row.click(); await new Promise((r) => setTimeout(r, 400));
          const c = document.querySelector(".pccard .inj"); out.card = c ? getComputedStyle(c).color === accent : null;
          UI.closePlayerCard(); }
        return out;
      })) || {};
      const agreed = Object.entries(surfaces).filter(([, v]) => v === true).map(([k]) => k);
      ok(agreed.length >= 3 && Object.values(surfaces).every((v) => v !== false),
        "…on every surface that renders one — they share a single rule, so they cannot disagree (" + JSON.stringify(surfaces) + ")");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
    }

    // ---- AG7: possession is a gold ring, and it is absent where there is no drive to read.
    {
      // The 2025 replay carries a static historical slate with no drive data at all, so
      // nothing may be highlighted there — the rule the previous batch shipped, re-asserted
      // against the new treatment rather than the old pip.
      fixture.phase = 2; fixture.sleeperDown = false; fixture.espnDown = false;
      const { ctx, page, errors } = await newTestPage(browser, seedSim2025());
      await bootSim(page);
      const none = (await evalOr(page, () => ({
        ball: document.querySelectorAll(".pcellgrid.hasball").length,
        rings: [...document.querySelectorAll(".pcellgrid")].filter((g) => /rgb\(255, 182, 18\)/.test(getComputedStyle(g).boxShadow || "")).length,
      }))) || {};
      ok(none.ball === 0 && none.rings === 0, "under the replay nobody is ringed — a historical slate carries no drive to read (" + JSON.stringify(none) + ")");
      ok(errors.length === 0, "0 page errors");
      await ctx.close();
      fixture.phase = 1;
    }
  }

  await browser.close();
  srv.close(); ffSrv.close(); tenorSrv.close(); xaiSrv.close(); sportsFfSrv.close();
  console.log("\n================================");
  console.log(`PASS ${pass} · FAIL ${fail}`);
  if (fail) { console.log("Failures:"); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
})().catch((e) => { console.error("SUITE CRASH:", e); process.exit(1); });
