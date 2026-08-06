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
      odds: [{ details: o.spread || "KC -3.5", overUnder: 47.5, provider: { name: "ESPN BET" } }],
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
        broadcast: "NBC", spread: "MIN -2.5",
      }),
      sbEvent({
        id: "401770005", date: iso(28 * 3600000), name: "Miami Dolphins at Las Vegas Raiders", shortName: "MIA @ LV",
        competitors: [sbCompetitor(TEAMS.LV, "home", 0), sbCompetitor(TEAMS.MIA, "away", 0)],
        status: { clock: 0, displayClock: "0:00", period: 0, type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false, description: "Scheduled", detail: "Scheduled", shortDetail: "9:15 PM CT" } },
        broadcast: "ESPN", spread: "MIA -1.5",
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
    pickcenter: [{ details: "MIN -2.5", overUnder: 44.5, provider: { name: "ESPN BET" } }],
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
  { id: "{AAAA-1}", displayName: "KreusserFTW", firstName: "Peter", lastName: "K" },
  { id: "{AAAA-2}", displayName: "mike", firstName: "Mike", lastName: "W" },
  { id: "{AAAA-3}", displayName: "isaac", firstName: "Isaac", lastName: "K" },
  { id: "{AAAA-4}", displayName: "ben", firstName: "Ben", lastName: "T" },
  { id: "{AAAA-5}", displayName: "grandpa", firstName: "John", lastName: "K" },
  { id: "{AAAA-6}", displayName: "sarah", firstName: "Sarah", lastName: "P" },
  { id: "{AAAA-7}", displayName: "dave", firstName: "Dave", lastName: "R" },
  { id: "{AAAA-8}", displayName: "emma", firstName: "Emma", lastName: "L" },
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
// Small lineups for the non-family matchups a suite click opens — the detail
// view renders whatever roster the doc carries, so 3 entries each is plenty.
function ffRosterSmall(qb, qbTeam, rb, rbTeam, k, kTeam) {
  return { entries: [
    ffEntry(0, qb, 1, qbTeam, 14.1, 18.0),
    ffEntry(2, rb, 2, rbTeam, 7.7, 10.5),
    ffEntry(20, k, 5, kTeam, 0, 6.5),
  ] };
}
// The real "Nerd Fantasy Football League": 8 teams, incl. the three the family
// follows — Battle Kreussers (default), The Goat Kids (Isaac), Wyoming Cowboys
// (Grandpa). "End Zone Goats" is a deliberate near-name trap for the matcher.
function ffLeagueDoc() {
  ffPlayerId = 5000;
  return {
    id: 705063, seasonId: 2026, scoringPeriodId: 2,
    status: { currentMatchupPeriod: 2, latestScoringPeriod: 2 },
    settings: {
      name: "Nerd Fantasy Football League", size: 8,
      // mSettings shapes the draft room reads: roster slots (draft rounds =
      // all slots except IR/21 → 16 here) + scoring (statId 53 = receptions;
      // points > 0 means PPR draft ranks).
      rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 1, 17: 1, 20: 7, 21: 1 } },
      scoringSettings: { scoringItems: [
        { statId: 53, points: 1 },      // receptions → PPR
        { statId: 42, points: 0.04 },   // receiving yards
        { statId: 43, points: 4 },      // receiving TD (nonsense value, junk realism)
      ] },
    },
    members: FF_MEMBERS,
    teams: [
      ffTeam(1, "Battle Kreussers", "BATT", "{AAAA-1}", 1, 0, 121.4, 98.0, 1),
      ffTeam(2, "Waffle House Warriors", "WAFF", "{AAAA-2}", 0, 1, 98.0, 121.4, 5),
      ffTeam(3, "The Goat Kids", "GOAT", "{AAAA-3}", 1, 0, 110.2, 87.9, 2),
      ffTeam(4, "End Zone Goats", "ENDZ", "{AAAA-4}", 0, 1, 87.9, 110.2, 6),
      ffTeam(5, "Wyoming Cowboys", "WYO", "{AAAA-5}", 1, 0, 104.6, 90.1, 3),
      ffTeam(6, "Draft Punks", "DRFT", "{AAAA-6}", 0, 1, 90.1, 104.6, 7),
      // The REAL league's name has a DOUBLE SPACE ("Nails  For Breakfast", measured
      // live 2026-08-06) — kept verbatim so the whitespace-normalizing matcher is
      // proven against the shape that actually broke the exact match.
      ffTeam(7, "Nails  For Breakfast", "NAIL", "{AAAA-7}", 1, 0, 99.5, 95.2, 4),
      ffTeam(8, "Hay Bale Hail Marys", "HAY", "{AAAA-8}", 0, 1, 95.2, 99.5, 8),
    ],
    schedule: [
      { id: 1, matchupPeriodId: 1, winner: "HOME",
        home: { teamId: 1, totalPoints: 121.4 }, away: { teamId: 4, totalPoints: 87.9 } },
      { id: 2, matchupPeriodId: 1, winner: "AWAY",
        home: { teamId: 2, totalPoints: 98.0 }, away: { teamId: 3, totalPoints: 110.2 } },
      { id: 3, matchupPeriodId: 1, winner: "HOME",
        home: { teamId: 5, totalPoints: 104.6 }, away: { teamId: 6, totalPoints: 90.1 } },
      { id: 4, matchupPeriodId: 1, winner: "HOME",
        home: { teamId: 7, totalPoints: 99.5 }, away: { teamId: 8, totalPoints: 95.2 } },
      { id: 5, matchupPeriodId: 2, winner: "UNDECIDED",
        home: { teamId: 1, totalPoints: 0, totalPointsLive: 87.4, totalProjectedPointsLive: 112.6,
          rosterForCurrentScoringPeriod: ffRosterTeam1() },
        away: { teamId: 2, totalPoints: 0, totalPointsLive: 76.2, totalProjectedPointsLive: 98.1,
          rosterForCurrentScoringPeriod: ffRosterTeam2() } },
      { id: 6, matchupPeriodId: 2, winner: "UNDECIDED",
        home: { teamId: 3, totalPoints: 0, totalPointsLive: 65.0, totalProjectedPointsLive: 101.4,
          rosterForCurrentScoringPeriod: ffRosterSmall("Lamar Jackson", 33, "Derrick Henry", 33, "Justin Tucker", 33) },
        away: { teamId: 6, totalPoints: 0, totalPointsLive: 55.1, totalProjectedPointsLive: 95.5,
          rosterForCurrentScoringPeriod: ffRosterSmall("Joe Burrow", 4, "Chase Brown", 4, "Evan McPherson", 4) } },
      { id: 7, matchupPeriodId: 2, winner: "UNDECIDED",
        home: { teamId: 5, totalPoints: 0, totalPointsLive: 71.9, totalProjectedPointsLive: 104.0,
          rosterForCurrentScoringPeriod: ffRosterSmall("Jordan Love", 9, "Josh Jacobs", 9, "Brandon McManus", 9) },
        away: { teamId: 8, totalPoints: 0, totalPointsLive: 60.3, totalProjectedPointsLive: 99.7,
          rosterForCurrentScoringPeriod: ffRosterSmall("Baker Mayfield", 27, "Bucky Irving", 27, "Chase McLaughlin", 27) } },
      { id: 8, matchupPeriodId: 2, winner: "UNDECIDED",
        home: { teamId: 7, totalPoints: 0, totalPointsLive: 44.0, totalProjectedPointsLive: 88.8 },
        away: { teamId: 4, totalPoints: 0, totalPointsLive: 49.5, totalProjectedPointsLive: 91.2 } },
    ],
    // Junk the slimmer must drop:
    draftDetail: { drafted: true, picks: new Array(20).fill({ playerId: 1 }) },
    transactions: [{ id: "t1" }],
  };
}

// ---------------- college football (site API, same shape as the NFL) ----------------
// The upstream default (no groups param) is the FULL FBS slate — measured live
// 2026-08-05 — so "Top 25" is the client's cut on curatedRank. groups=8 is the
// SEC. curatedRank.current: 1-25 = AP rank, 99 = unranked.

const CTEAMS = {
  UGA:  { id: "61",   abbrev: "UGA",  name: "Georgia",       full: "Georgia Bulldogs",       color: "cc0000", alt: "000000", rank: 1 },
  ALA:  { id: "333",  abbrev: "ALA",  name: "Alabama",       full: "Alabama Crimson Tide",   color: "9e1b32", alt: "828a8f", rank: 4 },
  OSU:  { id: "194",  abbrev: "OSU",  name: "Ohio State",    full: "Ohio State Buckeyes",    color: "ce1141", alt: "666666", rank: 2 },
  MICH: { id: "130",  abbrev: "MICH", name: "Michigan",      full: "Michigan Wolverines",    color: "00274c", alt: "ffcb05", rank: 12 },
  WYO:  { id: "2751", abbrev: "WYO",  name: "Wyoming",       full: "Wyoming Cowboys",        color: "492f24", alt: "ffc425", rank: null },
  CSU:  { id: "36",   abbrev: "CSU",  name: "Colorado State", full: "Colorado State Rams",   color: "1e4d2b", alt: "c8c372", rank: null },
  VAN:  { id: "238",  abbrev: "VAN",  name: "Vanderbilt",    full: "Vanderbilt Commodores",  color: "866d4b", alt: "000000", rank: null },
  UK:   { id: "96",   abbrev: "UK",   name: "Kentucky",      full: "Kentucky Wildcats",      color: "0033a0", alt: "ffffff", rank: null },
};
const SEC_IDS = new Set(["61", "333", "238", "96"]);

function cfbCompetitor(t, homeAway, score, winner) {
  const c = sbCompetitor(t, homeAway, score, winner);
  c.curatedRank = { current: t.rank == null ? 99 : t.rank };
  c.team.logo = "https://a.espncdn.com/i/teamlogos/ncaa/500/" + t.id + ".png";
  return c;
}

const CFB_CALENDAR = [
  {
    label: "Regular Season", value: "2",
    entries: [1, 2, 3].map((n) => ({
      label: "Week " + n, value: String(n),
      startDate: iso((n - 1) * 7 * 86400000 - 3 * 86400000), endDate: iso((n - 1) * 7 * 86400000 + 4 * 86400000),
    })),
  },
];

// Full FBS slate (the default fetch): a ranked live game, a ranked pregame, an
// unranked pregame, an unranked final. groups=8 narrows to the two SEC games.
function cfbScoreboard(groups) {
  const events = [
    sbEvent({
      id: "401820001", date: iso(-70 * 60000), name: "Georgia Bulldogs at Alabama Crimson Tide", shortName: "UGA @ ALA",
      competitors: [cfbCompetitor(CTEAMS.ALA, "home", 13), cfbCompetitor(CTEAMS.UGA, "away", 17)],
      status: { clock: 344, displayClock: "5:44", period: 2, type: { id: "2", name: "STATUS_IN_PROGRESS", state: "in", completed: false, description: "In Progress", detail: "5:44 - 2nd Quarter", shortDetail: "5:44 - 2nd" } },
      broadcast: "CBS",
      situation: {
        lastPlay: { id: "40182000144", text: "G. Bowers pass from C. Beck for 11 yards." },
        down: 1, distance: 10, downDistanceText: "1st & 10 at ALA 34", shortDownDistanceText: "1st & 10",
        possessionText: "UGA ball at ALA 34", possession: "61",
      },
    }),
    sbEvent({
      id: "401820002", date: iso(5 * 3600000), name: "Ohio State Buckeyes at Michigan Wolverines", shortName: "OSU @ MICH",
      competitors: [cfbCompetitor(CTEAMS.MICH, "home", 0), cfbCompetitor(CTEAMS.OSU, "away", 0)],
      status: { clock: 0, displayClock: "0:00", period: 0, type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false, description: "Scheduled", detail: "Scheduled", shortDetail: "6:30 PM CT" } },
      broadcast: "FOX", spread: "OSU -3.5",
    }),
    sbEvent({
      id: "401820003", date: iso(26 * 3600000), name: "Wyoming Cowboys at Colorado State Rams", shortName: "WYO @ CSU",
      competitors: [cfbCompetitor(CTEAMS.CSU, "home", 0), cfbCompetitor(CTEAMS.WYO, "away", 0)],
      status: { clock: 0, displayClock: "0:00", period: 0, type: { id: "1", name: "STATUS_SCHEDULED", state: "pre", completed: false, description: "Scheduled", detail: "Scheduled", shortDetail: "2:00 PM CT" } },
      broadcast: "MW Network", spread: "WYO -7",
    }),
    sbEvent({
      id: "401820004", date: iso(-6 * 3600000), name: "Vanderbilt Commodores at Kentucky Wildcats", shortName: "VAN @ UK",
      competitors: [cfbCompetitor(CTEAMS.UK, "home", 20), cfbCompetitor(CTEAMS.VAN, "away", 27, true)],
      status: { clock: 0, displayClock: "0:00", period: 4, type: { id: "3", name: "STATUS_FINAL", state: "post", completed: true, description: "Final", detail: "Final", shortDetail: "Final" } },
      broadcast: "SEC Network",
    }),
  ];
  const keep = String(groups) === "8"
    ? events.filter((ev) => ev.competitions[0].competitors.every((c) => SEC_IDS.has(String(c.id))))
    : events;
  return {
    leagues: [{ id: "23", name: "NCAA Football", calendar: CFB_CALENDAR }],
    season: { type: 2, year: 2026 },
    week: { number: 1 },
    events: keep,
  };
}

// One college game summary (the VAN @ UK final) — the summary endpoint's shape
// is identical to the NFL's, so the detail view renders through the same code.
function cfbSummaryFinal() {
  const s = summaryFinal();
  s.header.id = "401820004";
  s.header.competitions[0].id = "401820004";
  s.header.competitions[0].competitors = [
    sumCompetitor(CTEAMS.UK, "home", 20, [7, 3, 3, 7]),
    sumCompetitor(CTEAMS.VAN, "away", 27, [10, 7, 3, 7], true),
  ];
  s.drives.previous = [
    { id: "cd1", team: { id: CTEAMS.UK.id, abbreviation: "UK" }, description: "3 plays, 4 yards, 1:12", displayResult: "Punt", isScore: false },
    { id: "cd2", team: { id: CTEAMS.VAN.id, abbreviation: "VAN" }, description: "8 plays, 66 yards, 3:40", displayResult: "Touchdown", isScore: true },
  ];
  s.boxscore = boxscoreFor(CTEAMS.VAN, CTEAMS.UK);
  s.gameInfo = { venue: { fullName: "Kroger Field" } };
  return s;
}
const CFB_SUMMARIES = {
  "401820004": cfbSummaryFinal,
};

// The kona_player_info response for the X-Fantasy-Filter'd free-agent pool: a
// realistic mix — a hot pickup, an injured flyer, a D/ST, a kicker, a stashed rook.
// scoringPeriodId 2 matches the league doc; percOwned descending like the real sort.
function ffFreeAgentEntry(name, posId, proTeamId, pct, proj, seasonProj, injury) {
  return {
    onTeamId: 0, status: "FREEAGENT",
    player: {
      id: ffPlayerId++, fullName: name, defaultPositionId: posId, proTeamId,
      injuryStatus: injury || "ACTIVE",
      ownership: { percentOwned: pct, percentChange: 1.2, auctionValueAverage: 0 },
      stats: [
        { scoringPeriodId: 2, statSourceId: 1, statSplitTypeId: 1, appliedTotal: proj },
        { scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0, appliedTotal: seasonProj },
      ],
      // Junk the slimmer must drop:
      draftRanksByRankType: { STANDARD: { rank: 40 } }, seasonOutlook: "x".repeat(400),
    },
  };
}
function ffFreeAgentsDoc() {
  ffPlayerId = 9000;
  return {
    id: 705063, seasonId: 2026, scoringPeriodId: 2,
    status: { currentMatchupPeriod: 2, latestScoringPeriod: 2 },
    players: [
      ffFreeAgentEntry("Tyjae Spears", 2, 10, 61.2, 11.8, 152.4),
      ffFreeAgentEntry("Romeo Doubs", 3, 9, 48.7, 9.9, 128.0),
      ffFreeAgentEntry("Tyler Allgeier", 2, 1, 37.1, 8.4, 118.6),
      ffFreeAgentEntry("Broncos D/ST", 16, 7, 29.5, 6.8, 98.5),
      ffFreeAgentEntry("Cam Little", 5, 30, 18.2, 7.6, 121.0),
      ffFreeAgentEntry("Marvin Mims Jr.", 3, 7, 12.9, 6.1, 84.2, "QUESTIONABLE"),
      ffFreeAgentEntry("Tyrone Tracy Jr.", 2, 19, 8.4, 5.2, 71.9),
    ],
  };
}

// ---------------- draft room (ffdraft.html) fixtures ----------------
// kona_player_info under a sortDraftRanks X-Fantasy-Filter (the draft pool),
// mDraftDetail+mRoster for LAST season (keeper costs), and the season-level
// proTeamSchedules_wl doc (bye weeks).

// [pid, name, posId, proTeamId, pprRank, stdRank, adp] — the PPR and STANDARD
// orders deliberately DIFFER at the top (Chase/Bijan swap) so the requested
// format is provable from the sorted result. 4036 has NO ranks (sorts last).
const DRAFT_POOL_ROWS = [
  [4001, "Ja'Marr Chase", 3, 4, 1, 2, 1.6],
  [4002, "Bijan Robinson", 2, 1, 2, 1, 2.0],
  [4003, "Saquon Barkley", 2, 21, 3, 3, 3.2],
  [4004, "Jahmyr Gibbs", 2, 8, 4, 4, 4.4],
  [4005, "CeeDee Lamb", 3, 6, 5, 6, 5.9],
  [4006, "Justin Jefferson", 3, 16, 6, 5, 6.1],
  [4007, "Puka Nacua", 3, 14, 7, 8, 7.7],
  [4008, "Amon-Ra St. Brown", 3, 8, 8, 7, 8.2],
  [4009, "Christian McCaffrey", 2, 25, 9, 9, 9.0],
  [4010, "Derrick Henry", 2, 33, 10, 10, 10.3],
  [4011, "Josh Allen", 1, 2, 11, 12, 11.5],
  [4012, "Lamar Jackson", 1, 33, 12, 13, 12.8],
  [4013, "Brock Bowers", 4, 13, 13, 15, 13.4],
  [4014, "De'Von Achane", 2, 15, 14, 16, 14.9],
  [4015, "Nico Collins", 3, 34, 15, 11, 15.2],
  [4016, "Drake London", 3, 1, 16, 14, 16.8],
  [4017, "A.J. Brown", 3, 21, 17, 17, 17.5],
  [4018, "Jonathan Taylor", 2, 11, 18, 18, 18.1],
  [4019, "Travis Kelce", 4, 12, 19, 21, 20.6],
  [4020, "Jalen Hurts", 1, 21, 20, 19, 21.2],
  [4021, "Bucky Irving", 2, 27, 21, 20, 22.4],
  [4022, "James Conner", 2, 22, 22, 22, 23.0],
  [4023, "Jaxon Smith-Njigba", 3, 26, 23, 23, 24.1],
  [4024, "Trey McBride", 4, 22, 24, 25, 25.5],
  [4025, "Kyren Williams", 2, 14, 25, 24, 26.0],
  [4026, "Davante Adams", 3, 14, 26, 26, 27.7],
  [4027, "Tee Higgins", 3, 4, 27, 27, 28.9],
  [4028, "Patrick Mahomes", 1, 12, 28, 28, 30.2],
  [4029, "Garrett Wilson", 3, 20, 29, 29, 31.0],
  [4030, "Breece Hall", 2, 20, 30, 30, 32.4],
  [4031, "George Kittle", 4, 25, 31, 31, 33.8],
  [4032, "Rashee Rice", 3, 12, 32, 32, 35.1],
  [4033, "Brandon Aubrey", 5, 6, 33, 33, 96.0],
  [4034, "Broncos D/ST", 16, 7, 34, 34, 110.0],
  [4035, "Ravens D/ST", 16, 33, 35, 35, 118.0],
  [4036, "Deep Sleeper", 2, 9, null, null, null],
];
// The season the fantasy API is currently serving (Jan/Feb belong to the
// previous league year) — the pool's stat entries key on real seasonIds.
const FF_SEASON_NOW = (() => {
  const d = new Date();
  return d.getUTCMonth() < 2 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
})();
// Position-appropriate per-stat breakdown (community stat ids: 3/4/20 passing,
// 23/24/25 rushing, 58/53/42/43 receiving, 72 fumbles).
function draftStatBreakdown(posId, seed) {
  if (posId === 1) return { 3: 4100 + seed, 4: 30, 20: 9, 23: 88, 24: 420 + seed, 25: 4 };
  if (posId === 2) return { 23: 260 + seed, 24: 1240 + seed, 25: 10, 58: 62, 53: 48, 42: 350, 43: 2, 72: 1 };
  if (posId === 3 || posId === 4) return { 58: 130 + seed, 53: 92, 42: 1230 + seed, 43: 8, 23: 4, 24: 22 };
  return {};   // K / D/ST — totals only, no decoded lines
}
function draftPoolEntry(row) {
  const [pid, name, posId, proTeamId, ppr, std, adp] = row;
  const ranks = {};
  if (ppr != null) ranks.PPR = { rank: ppr, rankType: "PPR", auctionValue: 61, published: true };
  if (std != null) ranks.STANDARD = { rank: std, rankType: "STANDARD", auctionValue: 58, published: true };
  const projT = ppr != null ? 380 - ppr * 6 : 120;      // deterministic, rank-shaped
  const lastT = projT - 14;
  return {
    onTeamId: 0, status: "FREEAGENT",
    player: {
      id: pid, fullName: name, defaultPositionId: posId, proTeamId,
      injuryStatus: pid === 4007 ? "QUESTIONABLE" : "ACTIVE",
      ownership: { averageDraftPosition: adp, percentOwned: 92.1, percentChange: 0.4 },
      draftRanksByRankType: ranks,
      stats: [
        // This season's projection + LAST season's actual (both season splits)…
        { id: "10" + FF_SEASON_NOW, seasonId: FF_SEASON_NOW, statSourceId: 1, statSplitTypeId: 0,
          appliedTotal: projT, appliedAverage: Math.round((projT / 17) * 10) / 10,
          stats: draftStatBreakdown(posId, (ppr || 30)) },
        { id: "00" + (FF_SEASON_NOW - 1), seasonId: FF_SEASON_NOW - 1, statSourceId: 0, statSplitTypeId: 0,
          appliedTotal: lastT, appliedAverage: Math.round((lastT / 16) * 10) / 10,
          stats: draftStatBreakdown(posId, (ppr || 30) + 3) },
        // …and a WEEKLY split the season readers must never pick up.
        { scoringPeriodId: 1, seasonId: FF_SEASON_NOW, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 17.2 },
      ],
      seasonOutlook: pid === 4002
        ? "Bijan Robinson enters the season as the centerpiece of the offense — an every-down back with elite receiving chops and 400-touch upside if the line holds."
        : "x".repeat(300),
      eligibleSlots: [2, 3, 23, 20],
    },
  };
}
function ffDraftPoolDoc() {
  // Returned UNSORTED (reverse rank order) on purpose — the server must sort.
  return { id: 705063, seasonId: 2026, players: DRAFT_POOL_ROWS.slice().reverse().map(draftPoolEntry) };
}

function draftPoolRow(pid) { return DRAFT_POOL_ROWS.find((r) => r[0] === pid); }
function lastRosterEntry(pid) {
  const r = draftPoolRow(pid);
  return { playerId: pid, playerPoolEntry: { player: { id: pid, fullName: r[1], defaultPositionId: r[2], proTeamId: r[3] } } };
}
// LAST season's draft. Keeper-rule scenarios baked in: 4002 kept at R1 (a 1st
// stays a 1st), 4019 kept at R4 (→ R3), 4014 drafted R6 (→ R5), 4022 drafted
// R6 (→ R5, collides with 4014 when the same team keeps both), 4021 ABSENT
// from the draft (waiver pickup → the team's latest pick). Rosters carry each
// team's season-end squad — 4021 ended on team 1.
function ffLastDraftDoc() {
  let overall = 0;
  const picks = [];
  function pk(pid, round, teamId, keeper) {
    overall++;
    picks.push({
      id: overall, overallPickNumber: overall, roundId: round, roundPickNumber: ((overall - 1) % 8) + 1,
      playerId: pid, teamId, keeper: keeper === true,
      bidAmount: 0, autoDraftTypeId: 0, reservedForKeeper: false, memberId: "{AAAA-1}",
    });
  }
  pk(4002, 1, 1, true); pk(4001, 1, 2); pk(4003, 1, 3); pk(4004, 1, 4);
  pk(4009, 1, 5); pk(4005, 1, 6); pk(4006, 1, 7); pk(4008, 1, 8);
  pk(4010, 2, 8); pk(4007, 2, 7); pk(4011, 2, 5);
  pk(4020, 3, 7); pk(4012, 3, 2);
  pk(4019, 4, 3, true); pk(4013, 4, 3);
  pk(4014, 6, 1); pk(4022, 6, 2);
  return {
    id: 705063, seasonId: 2025,
    draftDetail: { drafted: true, inProgress: false, picks },
    teams: [
      { id: 1, abbrev: "BATT", roster: { entries: [4002, 4014, 4021, 4022, 4016].map(lastRosterEntry) } },
      { id: 3, abbrev: "GOAT", roster: { entries: [4019, 4013, 4010, 4003].map(lastRosterEntry) } },
      { id: 5, abbrev: "WYO", roster: { entries: [4011, 4009].map(lastRosterEntry) } },
    ],
    // Junk the slimmer must drop:
    members: FF_MEMBERS, positionAgainstOpponent: { positionalRatings: {} },
  };
}

// Keep-chain HISTORY (yearsBack 1..3 behind last season). Kelce (4019) has
// been kept by team 3 three straight years — drafted each year AND on team
// 3's final roster the year before → chain 3 → INELIGIBLE next season.
// Bijan (4002): drafted 2024 by team 1 + on its 2023 roster, but NOT drafted
// 2023 by them (a 2023 waiver pickup) → chain stops at 2 → a keep next year
// is his 3rd and last. Achane (4014) is NOT on team 1's roster a year back →
// chain 0 even though he was drafted last season.
function ffHistoryDoc(yearsBack) {
  const pk = (pid, round, teamId, overall) => ({
    id: overall, overallPickNumber: overall, roundId: round, roundPickNumber: 1,
    playerId: pid, teamId, keeper: false,
  });
  const team = (id, abbrev, pids) => ({ id, abbrev, roster: { entries: pids.map(lastRosterEntry) } });
  if (yearsBack === 1) return {
    id: 705063, draftDetail: { drafted: true, inProgress: false, picks: [pk(4002, 2, 1, 1), pk(4019, 5, 3, 2)] },
    teams: [team(1, "BATT", [4002, 4016]), team(3, "GOAT", [4019])],
  };
  if (yearsBack === 2) return {
    id: 705063, draftDetail: { drafted: true, inProgress: false, picks: [pk(4019, 6, 3, 1)] },
    teams: [team(1, "BATT", [4002, 4016]), team(3, "GOAT", [4019])],
  };
  return { id: 705063, teams: [team(3, "GOAT", [4019])] };   // roster-only fetch
}

// Season-level bye weeks (NOT league-scoped): settings.proTeams[].byeWeek.
function proTeamSchedulesDoc() {
  const byes = {
    1: 5, 2: 7, 4: 10, 6: 7, 7: 12, 8: 8, 9: 10, 11: 11, 12: 10, 13: 8, 14: 6,
    15: 6, 16: 13, 20: 12, 21: 9, 22: 11, 25: 14, 26: 5, 27: 9, 33: 14, 34: 14,
  };
  return {
    display: true,
    settings: {
      proTeams: Object.keys(byes).map((id) => ({
        id: Number(id), abbrev: "T" + id, location: "City", name: "Team",
        byeWeek: byes[id],
        proGamesByScoringPeriod: { 1: [{ id: 1 }] },   // junk the slimmer must drop
      })),
    },
  };
}

module.exports = { scoreboardLive, scoreboardIdle, SUMMARIES, TEAMS, ffLeagueDoc, ffFreeAgentsDoc, cfbScoreboard, CFB_SUMMARIES, CTEAMS, ffDraftPoolDoc, ffLastDraftDoc, ffHistoryDoc, proTeamSchedulesDoc };
