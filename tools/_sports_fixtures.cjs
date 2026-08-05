// Fixtures for tools/_verify-sports.cjs — RAW ESPN site-API shapes (what the real
// upstream returns), hand-authored from the documented/observed response format.
// ESPN hosts are egress-blocked from the dev sandbox, so these could not be captured
// live; tools/_probe-sports.mjs re-checks the real shapes against these expectations
// post-deploy. Dates are generated relative to "now" so day grouping stays realistic
// whenever the suite runs.
"use strict";

function iso(offsetMs) { return new Date(Date.now() + offsetMs).toISOString().replace(/\.\d{3}Z$/, "Z"); }

const TEAMS = {
  KC:  { id: "12", abbrev: "KC",  name: "Chiefs",   full: "Kansas City Chiefs", color: "e31837", alt: "ffb612" },
  BUF: { id: "2",  abbrev: "BUF", name: "Bills",    full: "Buffalo Bills",      color: "00338d", alt: "d50a0a" },
  PHI: { id: "21", abbrev: "PHI", name: "Eagles",   full: "Philadelphia Eagles",color: "06424d", alt: "a5acaf" },
  DAL: { id: "6",  abbrev: "DAL", name: "Cowboys",  full: "Dallas Cowboys",     color: "002a5c", alt: "b0b7bc" },
  HOU: { id: "34", abbrev: "HOU", name: "Texans",   full: "Houston Texans",     color: "00143f", alt: "c41230" },
  IND: { id: "11", abbrev: "IND", name: "Colts",    full: "Indianapolis Colts", color: "003b75", alt: "ffffff" },
  GB:  { id: "9",  abbrev: "GB",  name: "Packers",  full: "Green Bay Packers",  color: "204e32", alt: "ffb612" },
  MIN: { id: "16", abbrev: "MIN", name: "Vikings",  full: "Minnesota Vikings",  color: "4f2683", alt: "ffc62f" },
  MIA: { id: "15", abbrev: "MIA", name: "Dolphins", full: "Miami Dolphins",     color: "008e97", alt: "fc4c02" },
  LV:  { id: "13", abbrev: "LV",  name: "Raiders",  full: "Las Vegas Raiders",  color: "000000", alt: "a5acaf" },
};

function sbCompetitor(t, homeAway, score, winner) {
  return {
    id: t.id, homeAway, winner: winner === true,
    team: {
      id: t.id, abbreviation: t.abbrev, shortDisplayName: t.name, displayName: t.full,
      color: t.color, alternateColor: t.alt,
      logo: "https://a.espncdn.com/i/teamlogos/nfl/500/" + t.abbrev.toLowerCase() + ".png",
    },
    records: [{ type: "total", summary: "0-0" }],
    score: score == null ? "0" : String(score),
    // Junk the slimmer must drop:
    statistics: [], leaders: [{ name: "passingYards", leaders: [{ displayValue: "212", value: 212 }] }],
  };
}

function sbEvent(o) {
  const ev = {
    id: o.id, uid: "s:20~l:28~e:" + o.id, date: o.date, name: o.name, shortName: o.shortName,
    season: { year: 2026, type: 2 },
    competitions: [{
      id: o.id, date: o.date, attendance: 73000,
      competitors: o.competitors,
      status: o.status,
      broadcasts: o.broadcast ? [{ market: "national", names: [o.broadcast] }] : [],
      // Junk the slimmer must drop:
      odds: [{ details: "KC -3.5", overUnder: 47.5, provider: { name: "ESPN BET" } }],
      geoBroadcasts: [{ type: { shortName: "TV" } }],
      headlines: [{ description: "A very long headline blob ".repeat(20) }],
    }],
    status: o.status,
  };
  if (o.situation) ev.competitions[0].situation = o.situation;
  return ev;
}

const CALENDAR = [
  {
    label: "Preseason", value: "1",
    entries: [1, 2, 3].map((n) => ({
      label: "Preseason Week " + n, value: String(n),
      startDate: iso(-(30 - n * 7) * 86400000), endDate: iso(-(23 - n * 7) * 86400000),
    })),
  },
  {
    label: "Regular Season", value: "2",
    entries: [1, 2, 3].map((n) => ({
      label: "Week " + n, value: String(n),
      startDate: iso((n - 1) * 7 * 86400000 - 3 * 86400000), endDate: iso((n - 1) * 7 * 86400000 + 4 * 86400000),
    })),
  },
];

// The live Sunday: two in-progress games, one final from earlier today, one
// tonight, one tomorrow. KC is HOME in the featured game and has possession
// (tests the home-possession branch of the field math).
function scoreboardLive() {
  return {
    leagues: [{ id: "28", name: "National Football League", calendar: CALENDAR }],
    season: { type: 2, year: 2026 },
    week: { number: 1 },
    events: [
      sbEvent({
        id: "401770001", date: iso(-95 * 60000), name: "Buffalo Bills at Kansas City Chiefs", shortName: "BUF @ KC",
        competitors: [sbCompetitor(TEAMS.KC, "home", 17), sbCompetitor(TEAMS.BUF, "away", 14)],
        status: { clock: 522, displayClock: "8:42", period: 3, type: { id: "2", name: "STATUS_IN_PROGRESS", state: "in", completed: false, description: "In Progress", detail: "8:42 - 3rd Quarter", shortDetail: "8:42 - 3rd" } },
        broadcast: "CBS",
        situation: {
          lastPlay: { id: "40177000198", text: "I. Pacheco run up the middle for 3 yards (tackled by T. Bernard)." },
          down: 2, yardLine: 31, distance: 7,
          downDistanceText: "2nd & 7 at BUF 31", shortDownDistanceText: "2nd & 7",
          possessionText: "KC ball at BUF 31", isRedZone: false, homeTimeouts: 3, awayTimeouts: 2,
          possession: "12",
        },
      }),
      sbEvent({
        id: "401770002", date: iso(-88 * 60000), name: "Philadelphia Eagles at Dallas Cowboys", shortName: "PHI @ DAL",
        competitors: [sbCompetitor(TEAMS.DAL, "home", 10), sbCompetitor(TEAMS.PHI, "away", 21)],
        status: { clock: 135, displayClock: "2:15", period: 3, type: { id: "2", name: "STATUS_IN_PROGRESS", state: "in", completed: false, description: "In Progress", detail: "2:15 - 3rd Quarter", shortDetail: "2:15 - 3rd" } },
        broadcast: "FOX",
        situation: {
          lastPlay: { id: "40177000255", text: "J. Hurts pass short left to A. Brown for 9 yards." },
          down: 1, yardLine: 60, distance: 10,
          downDistanceText: "1st & 10 at DAL 40", shortDownDistanceText: "1st & 10",
          possessionText: "PHI ball at DAL 40", isRedZone: false,
          possession: "21",
        },
      }),
      sbEvent({
        id: "401770004", date: iso(-4.5 * 3600000), name: "Houston Texans at Indianapolis Colts", shortName: "HOU @ IND",
        competitors: [sbCompetitor(TEAMS.IND, "home", 24), sbCompetitor(TEAMS.HOU, "away", 31, true)],
        status: { clock: 0, displayClock: "0:00", period: 4, type: { id: "3", name: "STATUS_FINAL", state: "post", completed: true, description: "Final", detail: "Final", shortDetail: "Final" } },
        broadcast: "FOX",
      }),
      sbEvent({
        id: "401770003", date: iso(4 * 3600000), name: "Green Bay Packers at Minnesota Vikings", shortName: "GB @ MIN",
        competitors: [sbCompetitor(TEAMS.MIN, "home", 0), sbCompetitor(TEAMS.GB, "away", 0)],
        status: { clock: 0, displayClock: "0:00", period: 0, type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false, description: "Scheduled", detail: "Scheduled", shortDetail: "7:20 PM CT" } },
        broadcast: "NBC",
      }),
      sbEvent({
        id: "401770005", date: iso(28 * 3600000), name: "Miami Dolphins at Las Vegas Raiders", shortName: "MIA @ LV",
        competitors: [sbCompetitor(TEAMS.LV, "home", 0), sbCompetitor(TEAMS.MIA, "away", 0)],
        status: { clock: 0, displayClock: "0:00", period: 0, type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false, description: "Scheduled", detail: "Scheduled", shortDetail: "9:15 PM CT" } },
        broadcast: "ESPN",
      }),
    ],
  };
}

// A quiet week: nothing live (poll cadence should relax to the idle interval).
function scoreboardIdle() {
  const sb = scoreboardLive();
  sb.events = sb.events.filter((e) => e.status.type.state === "pre");
  return sb;
}

// ---------------- summaries ----------------

function sumCompetitor(t, homeAway, score, linescores, winner) {
  return {
    id: t.id, homeAway, order: homeAway === "home" ? 0 : 1, winner: winner === true,
    team: {
      id: t.id, abbreviation: t.abbrev, shortDisplayName: t.name, displayName: t.full,
      color: t.color, alternateColor: t.alt,
      logos: [{ href: "https://a.espncdn.com/i/teamlogos/nfl/500/" + t.abbrev.toLowerCase() + ".png", width: 500, height: 500 }],
    },
    score: String(score),
    linescores: (linescores || []).map((v) => ({ displayValue: String(v) })),
    record: [{ type: "total", summary: "0-0" }],
  };
}

function play(o) {
  return {
    id: o.id, sequenceNumber: o.id,
    text: o.text,
    clock: { displayValue: o.clock },
    period: { number: o.period == null ? 3 : o.period },
    scoringPlay: o.scoring === true,
    start: { down: o.sd, distance: o.sdist, yardsToEndzone: o.sy, shortDownDistanceText: o.sddt, downDistanceText: o.sddt },
    end: { down: o.ed, distance: o.edist, yardsToEndzone: o.ey, shortDownDistanceText: o.eddt, downDistanceText: o.eddt, team: { id: o.team } },
    statYardage: o.yards || 0,
  };
}

function boxscoreFor(away, home) {
  function teamStats(t, tot, pass, rush, to, poss, third) {
    return {
      team: { id: t.id, abbreviation: t.abbrev, displayName: t.full },
      statistics: [
        { name: "firstDowns", label: "1st Downs", displayValue: "14" },
        { name: "totalYards", label: "Total Yards", displayValue: String(tot) },
        { name: "netPassingYards", label: "Passing", displayValue: String(pass) },
        { name: "rushingYards", label: "Rushing", displayValue: String(rush) },
        { name: "turnovers", label: "Turnovers", displayValue: String(to) },
        { name: "possessionTime", label: "Possession", displayValue: poss },
        { name: "thirdDownEff", label: "3rd down efficiency", displayValue: third },
      ],
    };
  }
  function players(t, qb, cmp, yds, td, int_, rb, car, ryds) {
    return {
      team: { id: t.id, abbreviation: t.abbrev },
      statistics: [
        {
          name: "passing", text: "Passing", labels: ["C/ATT", "YDS", "AVG", "TD", "INT"],
          athletes: [{ athlete: { shortName: qb, displayName: qb }, stats: [cmp, String(yds), "8.8", String(td), String(int_)] }],
        },
        {
          name: "rushing", text: "Rushing", labels: ["CAR", "YDS", "AVG", "TD", "LONG"],
          athletes: [{ athlete: { shortName: rb, displayName: rb }, stats: [String(car), String(ryds), "4.9", "0", "16"] }],
        },
        {
          name: "receiving", text: "Receiving", labels: ["REC", "YDS", "AVG", "TD", "LONG"],
          athletes: [{ athlete: { shortName: "T. Kelce", displayName: "Travis Kelce" }, stats: ["6", "78", "13.0", "1", "23"] }],
        },
      ],
    };
  }
  return {
    teams: [teamStats(away, 241, 178, 63, 1, "19:08", "3-8"), teamStats(home, 289, 212, 77, 0, "24:10", "6-9")],
    players: [players(away, "J. Allen", "15/22", 178, 1, 1, "J. Cook", 9, 41), players(home, "P. Mahomes", "18/24", 212, 2, 0, "I. Pacheco", 11, 54)],
  };
}

// LIVE, home team (KC) possessing: ball at the BUF 31 (yardsToEndzone 31),
// 2nd & 7, drive started at the KC 25 (yardsToEndzone 75).
function summaryLiveHome() {
  const winprob = [];
  for (let i = 0; i < 180; i++) winprob.push({ tiePercentage: 0, homeWinPercentage: 0.5 + 0.18 * Math.sin(i / 9) + i * 0.001, playId: "p" + i });
  winprob.push({ tiePercentage: 0, homeWinPercentage: 0.68, playId: "plast" });
  return {
    header: {
      id: "401770001",
      competitions: [{
        id: "401770001", date: iso(-95 * 60000),
        competitors: [
          sumCompetitor(TEAMS.KC, "home", 17, [7, 3, 7]),
          sumCompetitor(TEAMS.BUF, "away", 14, [0, 14, 0]),
        ],
        status: { clock: 522, displayClock: "8:42", period: 3, type: { id: "2", state: "in", completed: false, description: "In Progress", detail: "8:42 - 3rd Quarter", shortDetail: "8:42 - 3rd" } },
      }],
    },
    drives: {
      current: {
        id: "4017700017", description: "7 plays, 44 yards, 3:12",
        team: { id: "12", name: "Chiefs", abbreviation: "KC" },
        start: { period: { number: 3 }, yardLine: 25, yardsToEndzone: 75, text: "KC 25" },
        timeElapsed: { displayValue: "3:12" },
        plays: [
          play({ id: "p1", text: "I. Pacheco run left for 6 yards.", clock: "11:54", sd: 1, sdist: 10, sy: 75, sddt: "1st & 10", ed: 2, edist: 4, ey: 69, eddt: "2nd & 4", team: "12", yards: 6 }),
          play({ id: "p2", text: "P. Mahomes deep right to X. Worthy for 23 yards.", clock: "11:12", sd: 2, sdist: 4, sy: 69, sddt: "2nd & 4", ed: 1, edist: 10, ey: 46, eddt: "1st & 10", team: "12", yards: 23 }),
          play({ id: "p3", text: "I. Pacheco run up the middle for 5 yards.", clock: "10:31", sd: 1, sdist: 10, sy: 46, sddt: "1st & 10", ed: 2, edist: 5, ey: 41, eddt: "2nd & 5", team: "12", yards: 5 }),
          play({ id: "p4", text: "P. Mahomes short middle to T. Kelce for 7 yards.", clock: "9:48", sd: 2, sdist: 5, sy: 41, sddt: "2nd & 5", ed: 1, edist: 10, ey: 34, eddt: "1st & 10", team: "12", yards: 7 }),
          play({ id: "p5", text: "I. Pacheco run up the middle for 3 yards (tackled by T. Bernard).", clock: "9:04", sd: 1, sdist: 10, sy: 34, sddt: "1st & 10", ed: 2, edist: 7, ey: 31, eddt: "2nd & 7", team: "12", yards: 3 }),
        ],
      },
      previous: [
        { id: "d1", team: { id: "12", abbreviation: "KC" }, description: "9 plays, 75 yards, 4:41", displayResult: "Touchdown", isScore: true },
        { id: "d2", team: { id: "2", abbreviation: "BUF" }, description: "6 plays, 70 yards, 3:05", displayResult: "Touchdown", isScore: true },
        { id: "d3", team: { id: "2", abbreviation: "BUF" }, description: "3 plays, 9 yards, 1:42", displayResult: "Punt", isScore: false },
      ],
    },
    boxscore: boxscoreFor(TEAMS.BUF, TEAMS.KC),
    scoringPlays: [
      { id: "s1", period: { number: 1 }, clock: { displayValue: "3:22" }, team: { abbreviation: "KC" }, scoringType: { abbreviation: "TD" }, awayScore: 0, homeScore: 7, text: "T. Kelce 12 Yd pass from P. Mahomes (H. Butker Kick)" },
      { id: "s2", period: { number: 2 }, clock: { displayValue: "9:40" }, team: { abbreviation: "BUF" }, scoringType: { abbreviation: "TD" }, awayScore: 7, homeScore: 7, text: "J. Allen 3 Yd Run (T. Bass Kick)" },
      { id: "s3", period: { number: 2 }, clock: { displayValue: "4:18" }, team: { abbreviation: "BUF" }, scoringType: { abbreviation: "TD" }, awayScore: 14, homeScore: 7, text: "K. Shakir 24 Yd pass from J. Allen (T. Bass Kick)" },
      { id: "s4", period: { number: 2 }, clock: { displayValue: "0:03" }, team: { abbreviation: "KC" }, scoringType: { abbreviation: "FG" }, awayScore: 14, homeScore: 10, text: "H. Butker 44 Yd Field Goal" },
      { id: "s5", period: { number: 3 }, clock: { displayValue: "11:55" }, team: { abbreviation: "KC" }, scoringType: { abbreviation: "TD" }, awayScore: 14, homeScore: 17, text: "X. Worthy 38 Yd pass from P. Mahomes (H. Butker Kick)" },
    ],
    winprobability: winprob,
    gameInfo: { venue: { id: "3622", fullName: "GEHA Field at Arrowhead Stadium", address: { city: "Kansas City", state: "MO" } } },
    // Junk the slimmer must drop:
    pickcenter: [{ details: "KC -3.5", overUnder: 47.5 }],
    odds: [{ details: "KC -3.5" }],
    standings: { groups: [] },
    news: { articles: [{ headline: "x".repeat(500) }] },
  };
}

// LIVE, AWAY team (PHI) possessing at the DAL 40 (yardsToEndzone 40), 1st & 10 —
// tests the mirrored (drive-right) branch of the field math.
function summaryLiveAway() {
  const s = summaryLiveHome();
  s.header.id = "401770002";
  s.header.competitions[0].id = "401770002";
  s.header.competitions[0].competitors = [
    sumCompetitor(TEAMS.DAL, "home", 10, [0, 10, 0]),
    sumCompetitor(TEAMS.PHI, "away", 21, [7, 7, 7]),
  ];
  s.header.competitions[0].status.displayClock = "2:15";
  s.header.competitions[0].status.type.shortDetail = "2:15 - 3rd";
  s.drives.current = {
    id: "4017700029", description: "4 plays, 25 yards, 1:58",
    team: { id: "21", name: "Eagles", abbreviation: "PHI" },
    start: { yardsToEndzone: 65, text: "PHI 35" },
    plays: [
      play({ id: "q1", text: "S. Barkley run right for 8 yards.", clock: "3:44", sd: 1, sdist: 10, sy: 65, sddt: "1st & 10", ed: 2, edist: 2, ey: 57, eddt: "2nd & 2", team: "21", yards: 8 }),
      play({ id: "q2", text: "J. Hurts pass short left to A. Brown for 9 yards.", clock: "2:59", sd: 2, sdist: 2, sy: 57, sddt: "2nd & 2", ed: 1, edist: 10, ey: 40, eddt: "1st & 10", team: "21", yards: 17 }),
    ],
  };
  s.boxscore = boxscoreFor(TEAMS.PHI, TEAMS.DAL);
  s.gameInfo = { venue: { fullName: "AT&T Stadium" } };
  return s;
}

// FINAL game — no current drive, winner flagged, everything else populated.
function summaryFinal() {
  const s = summaryLiveHome();
  s.header.id = "401770004";
  s.header.competitions[0].id = "401770004";
  s.header.competitions[0].competitors = [
    sumCompetitor(TEAMS.IND, "home", 24, [7, 10, 0, 7]),
    sumCompetitor(TEAMS.HOU, "away", 31, [14, 3, 7, 7], true),
  ];
  s.header.competitions[0].status = { clock: 0, displayClock: "0:00", period: 4, type: { id: "3", state: "post", completed: true, description: "Final", detail: "Final", shortDetail: "Final" } };
  delete s.drives.current;
  s.boxscore = boxscoreFor(TEAMS.HOU, TEAMS.IND);
  s.gameInfo = { venue: { fullName: "Lucas Oil Stadium" } };
  return s;
}

// PREGAME — no drives, no boxscore stats yet.
function summaryPre() {
  return {
    header: {
      id: "401770003",
      competitions: [{
        id: "401770003", date: iso(4 * 3600000),
        competitors: [
          sumCompetitor(TEAMS.MIN, "home", 0, []),
          sumCompetitor(TEAMS.GB, "away", 0, []),
        ],
        status: { clock: 0, displayClock: "0:00", period: 0, type: { id: "1", state: "pre", completed: false, description: "Scheduled", detail: "Scheduled", shortDetail: "7:20 PM CT" } },
      }],
    },
    boxscore: { teams: [], players: [] },
    scoringPlays: [],
    winprobability: [],
    gameInfo: { venue: { fullName: "U.S. Bank Stadium" } },
  };
}

const SUMMARIES = {
  "401770001": summaryLiveHome,
  "401770002": summaryLiveAway,
  "401770003": summaryPre,
  "401770004": summaryFinal,
};

// ---------------- fantasy (ESPN v3, league 705063) ----------------
// Week 2 is CURRENT and live; week 1 is decided. Player actual/proj totals sum
// exactly to the matchup's totalPointsLive/totalProjectedPointsLive so the
// lineup math is self-consistent. Pro teams are chosen from the NFL scoreboard
// fixture above so the game-state join has all four states to hit:
// in (KC/BUF/PHI/DAL) · post (HOU/IND) · pre (GB/MIN/MIA/LV) · absent (bye).

const FF_MEMBERS = [
  { id: "{AAAA-1}", displayName: "pkreusser", firstName: "Peter", lastName: "K" },
  { id: "{AAAA-2}", displayName: "mike", firstName: "Mike", lastName: "W" },
  { id: "{AAAA-3}", displayName: "sarah", firstName: "Sarah", lastName: "P" },
  { id: "{AAAA-4}", displayName: "ben", firstName: "Ben", lastName: "T" },
];
function ffTeam(id, name, abbrev, ownerGuid, wins, losses, pf, pa, seed) {
  return {
    id, abbrev, name,
    logo: "https://g.espncdn.com/lm-app/lm-logos/team" + id + ".png",
    owners: [ownerGuid],
    playoffSeed: seed,
    record: { overall: { wins, losses, ties: 0, pointsFor: pf, pointsAgainst: pa } },
  };
}
let ffPlayerId = 5000;
function ffEntry(slotId, name, posId, proTeamId, actual, proj, injury) {
  const stats = [];
  if (actual != null) stats.push({ scoringPeriodId: 2, statSourceId: 0, statSplitTypeId: 1, appliedTotal: actual });
  if (proj != null) stats.push({ scoringPeriodId: 2, statSourceId: 1, statSplitTypeId: 1, appliedTotal: proj });
  return {
    lineupSlotId: slotId,
    playerPoolEntry: {
      appliedStatTotal: actual != null ? actual : 0,
      player: {
        id: ffPlayerId++, fullName: name, defaultPositionId: posId, proTeamId,
        injuryStatus: injury || "ACTIVE", stats,
      },
    },
  };
}
function ffRosterTeam1() {   // Battle Kreussers — actual Σ 87.4, proj Σ 112.6
  return { entries: [
    ffEntry(0, "Josh Allen", 1, 2, 22.4, 21.3),
    ffEntry(2, "Isiah Pacheco", 2, 12, 9.8, 12.4),
    ffEntry(2, "James Cook", 2, 2, 8.1, 11.0),
    ffEntry(4, "A.J. Brown", 3, 21, 12.6, 13.8),
    ffEntry(4, "Justin Jefferson", 3, 16, 0, 16.4, "QUESTIONABLE"),
    ffEntry(6, "Travis Kelce", 4, 12, 11.2, 10.9),
    ffEntry(23, "De'Von Achane", 2, 15, 0, 13.1),
    ffEntry(16, "Texans D/ST", 16, 34, 12.0, 6.7),
    ffEntry(17, "Harrison Butker", 5, 12, 11.3, 7.0),
    ffEntry(20, "Saquon Barkley", 2, 21, 0, 15.2),
    ffEntry(20, "Bijan Robinson", 2, 1, 0, 14.8),
  ] };
}
function ffRosterTeam2() {   // Waffle House Warriors — actual Σ 76.2, proj Σ 98.1
  return { entries: [
    ffEntry(0, "Jalen Hurts", 1, 21, 19.9, 20.1),
    ffEntry(2, "Jonathan Taylor", 2, 11, 14.2, 13.5),
    ffEntry(2, "Aaron Jones", 2, 16, 0, 11.2),
    ffEntry(4, "CeeDee Lamb", 3, 6, 15.4, 14.9),
    ffEntry(4, "Tyreek Hill", 3, 15, 0, 15.8),
    ffEntry(6, "Dallas Goedert", 4, 21, 7.6, 8.3),
    ffEntry(23, "James Conner", 2, 22, 0, 9.1),
    ffEntry(16, "Cowboys D/ST", 16, 6, 8.9, 2.2),
    ffEntry(17, "Jake Elliott", 5, 21, 10.2, 3.0),
    ffEntry(20, "Kenneth Walker III", 2, 25, 0, 12.6),
  ] };
}
function ffLeagueDoc() {
  ffPlayerId = 5000;
  return {
    id: 705063, seasonId: 2026, scoringPeriodId: 2,
    status: { currentMatchupPeriod: 2, latestScoringPeriod: 2 },
    settings: { name: "Kreusser Family League", size: 4 },
    members: FF_MEMBERS,
    teams: [
      ffTeam(1, "Battle Kreussers", "BATT", "{AAAA-1}", 1, 0, 121.4, 98.0, 1),
      ffTeam(2, "Waffle House Warriors", "WAFF", "{AAAA-2}", 0, 1, 98.0, 121.4, 3),
      ffTeam(3, "Draft Punks", "DRFT", "{AAAA-3}", 1, 0, 110.2, 87.9, 2),
      ffTeam(4, "End Zone Goats", "GOAT", "{AAAA-4}", 0, 1, 87.9, 110.2, 4),
    ],
    schedule: [
      { id: 1, matchupPeriodId: 1, winner: "HOME",
        home: { teamId: 1, totalPoints: 121.4 }, away: { teamId: 4, totalPoints: 87.9 } },
      { id: 2, matchupPeriodId: 1, winner: "AWAY",
        home: { teamId: 2, totalPoints: 98.0 }, away: { teamId: 3, totalPoints: 110.2 } },
      { id: 3, matchupPeriodId: 2, winner: "UNDECIDED",
        home: { teamId: 1, totalPoints: 0, totalPointsLive: 87.4, totalProjectedPointsLive: 112.6,
          rosterForCurrentScoringPeriod: ffRosterTeam1() },
        away: { teamId: 2, totalPoints: 0, totalPointsLive: 76.2, totalProjectedPointsLive: 98.1,
          rosterForCurrentScoringPeriod: ffRosterTeam2() } },
      { id: 4, matchupPeriodId: 2, winner: "UNDECIDED",
        home: { teamId: 3, totalPoints: 0, totalPointsLive: 65.0, totalProjectedPointsLive: 101.4 },
        away: { teamId: 4, totalPoints: 0, totalPointsLive: 55.1, totalProjectedPointsLive: 95.5 } },
    ],
    // Junk the slimmer must drop:
    draftDetail: { drafted: true, picks: new Array(20).fill({ playerId: 1 }) },
    transactions: [{ id: "t1" }],
  };
}

module.exports = { scoreboardLive, scoreboardIdle, SUMMARIES, TEAMS, ffLeagueDoc };
