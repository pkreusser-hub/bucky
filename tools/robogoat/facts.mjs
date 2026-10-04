#!/usr/bin/env node
// tools/robogoat/facts.mjs — pull everything a RoboGoat column needs for one week, READ-ONLY.
//
//   node tools/robogoat/facts.mjs --season 2026 --week 3 --type recap   --out <dir>
//   node tools/robogoat/facts.mjs --season 2026 --week 4 --type preview --out <dir> [--since ISO]
//   add --season-file robogoat/2026/season.json to add each finished week's numbers to that file
//   (weeks.<n>: bench left, official scores, top starters). A week already in the file is left
//   alone — published pages read it, and a later stat correction must not quietly rewrite an old
//   page — unless --refresh is passed. RoboGoat's own keys (picks, rankings) are never touched.
//
// Writes <dir>/facts-<season>-w<week>-<type>.json, <dir>/issue.skeleton.json (the computed half of
// an issue.json, prose fields left empty) and per-week player dumps. Nothing here writes
// to the league: Firestore GETs/LISTs, Sleeper GETs (via tools/_gffl_shadow_score.mjs --dump).
//
// What it computes, and where each number comes from:
//   official team totals / awards / app power   weekly_<season>_w<n>   (the app's finalized week)
//   player points, starters and bench           _gffl_shadow_score.mjs --dump (league rules over
//                                               Sleeper's stat lines; totals can differ from the app
//                                               by a post-finalize stat correction — quote the
//                                               weekly doc for TEAM totals, never recomputed ones)
//   points left on the bench                    best legal lineup (settings roster slots, FLEX =
//                                               RB/WR/TE) minus the recomputed starters, per week
//   standings                                   weekly docs: win points (w + 0.5 t), then settings.rules.tiebreak
//                                               (default ["h2h","pf"]; see analysis.mjs rankStandings)
//   series                                      hist_<year> matchups + this season's weekly docs
//   win probability (recap)                     wpgraph_<season>_w<n>: p is the AWAY team's chance;
//                                               readings exist only while someone had the app open
//   chat / transactions                         chat_* (public league chat, sys lines dropped),
//                                               tx_* — never act_* (the private app log), never
//                                               trade_* (offers are private)
"use strict";

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, fsGet, fsIndex, firstName, shortName, r2 } from "./lib.mjs";
import { tiebreakOf, rankStandings, summarizeWp, computeSeries, classifyAnomalies, pickResults, recordOf, rankMovement,
  parseScoreboard, findLeads, restOfWeekend, injuryDesk, seriesLine, thursdayTallies, weekOpenBefore, sinceDefault, settlePicks } from "./analysis.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const SEASON = Number(arg("--season", "2026"));
const WEEK = Number(arg("--week"));
const TYPE = arg("--type", "recap");
const OUT = resolve(arg("--out", join(ROOT, "shots", "robogoat")));
if (!WEEK || !["recap", "preview"].includes(TYPE)) {
  console.error("usage: facts.mjs --season 2026 --week N --type recap|preview --out DIR [--since ISO|Nd] [--now ISO]");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
// The last FINISHED week: a recap covers WEEK itself; a preview is written before WEEK kicks off.
const LAST = TYPE === "recap" ? WEEK : WEEK - 1;

// ---------------- league skeleton ----------------
const index = await fsIndex();
const byKind = (k) => index.filter((d) => d.kind === k).map((d) => d.id);
// The scoreboard's team stripe: the first of primary/secondary/tertiary dark enough to show on
// white (Laws Rule's and the Nerfherders' primaries are white and cream).
function stripe(c) {
  const lum = (h) => { const n = parseInt(h.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
  return [c && c.primary, c && c.secondary, c && c.tertiary].find((h) => /^#[0-9a-f]{6}$/i.test(h || "") && lum(h) < 0.8) || "#555555";
}
const teams = {};
for (const id of byKind("team")) {
  const t = await fsGet(id);
  teams[t.teamId] = { id: t.teamId, name: t.name, owner: firstName(t.owner), short: shortName(t.teamId, t.name), abbrev: t.abbrev || "",
    color: stripe(t.colors), motto: t.motto || "" };
}
const TEAM_IDS = Object.keys(teams).map(Number).sort((a, b) => a - b);
const settings = await fsGet("settings");
const slots = (settings && settings.rules && settings.rules.roster) || { QB: 1, RB: 3, WR: 3, TE: 1, FLEX: 1, DST: 1, K: 1 };
const sched = await fsGet(`sched_${SEASON}`);
const weekly = {};
for (let w = 1; w <= LAST; w++) {
  const d = await fsGet(`weekly_${SEASON}_w${w}`);
  if (!d) throw new Error(`weekly_${SEASON}_w${w} is missing — week ${w} is not finalized in the app yet`);
  weekly[w] = d;
}

// ---------------- per-week player points (the shadow scorer, --dump) ----------------
const ALLOW = (() => { try { return JSON.parse(readFileSync(join(ROOT, "tools/robogoat/known-anomalies.json"), "utf8")).known || []; } catch (e) { return []; } })();
const NEW_ANOMALIES = [];
function dumpWeek(w) {
  const file = join(OUT, `players-${SEASON}-w${w}.json`);
  rmSync(file, { force: true }); // a stale dump from an earlier run must never pass for this one
  try {
    execFileSync(process.execPath, [join(ROOT, "tools/_gffl_shadow_score.mjs"), "--season", String(SEASON), "--week", String(w),
      "--no-live", "--quiet", "--dump", file], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 16 << 20 });
  } catch (e) {
    // The scorer exits 1 when one of ITS OWN health checks fails — e.g. a starter whose game is
    // final has no stat line (Puka Nacua, Week 2, ruled out and left in a lineup). That is its
    // report on the feed, not a failed dump: when the dump was written, use it and pass the
    // FAIL lines on so the column's author sees them. No dump at all is a real failure.
    if (!existsSync(file)) throw e;
    // Anomalies the author has already looked at (known-anomalies.json) print as one quiet line;
    // anything else prints as NEW, so a second stat-less starter cannot hide behind the first.
    const { known, fresh } = classifyAnomalies(String(e.stdout || "").split("\n").filter((x) => /^FAIL:/.test(x)), w, ALLOW);
    for (const k of known) console.error(`week ${w} scorer: known anomaly (${k.reason || "listed"})`);
    for (const f of fresh) { console.error(`week ${w} scorer: NEW ANOMALY: ${f.line}`); NEW_ANOMALIES.push({ week: w, line: f.line }); }
  }
  return JSON.parse(readFileSync(file, "utf8"));
}
const players = {};
for (let w = 1; w <= LAST; w++) players[w] = dumpWeek(w);

// Best legal lineup: fill each position with its best scorers, then FLEX with the best RB/WR/TE
// left over. Greedy is exact for this slot shape (FLEX draws only from the three leftover pools).
function optimal(list) {
  const ps = list.filter((p) => p.slot !== "IR").map((p) => ({ ...p, pts: p.pts || 0 }));
  const used = new Set(), pick = [];
  const take = (pos, n) => {
    for (const p of ps.filter((x) => x.pos === pos).sort((a, b) => b.pts - a.pts)) {
      if (n <= 0) break;
      if (!used.has(p.key)) { used.add(p.key); pick.push({ ...p, oslot: pos }); n--; }
    }
  };
  for (const pos of ["QB", "RB", "WR", "TE", "DST", "K"]) take(pos, slots[pos] || 0);
  const flexN = slots.FLEX || 0;
  const flex = ps.filter((p) => ["RB", "WR", "TE"].includes(p.pos) && !used.has(p.key)).sort((a, b) => b.pts - a.pts).slice(0, flexN);
  for (const f of flex) { used.add(f.key); pick.push({ ...f, oslot: "FLEX" }); }
  return { total: r2(pick.reduce((s, p) => s + p.pts, 0)), players: pick };
}
const bench = {}; // week -> teamId -> { actual, optimal, left, shouldStart[], over[] }
for (let w = 1; w <= LAST; w++) {
  bench[w] = {};
  for (const [tid, t] of Object.entries(players[w].teams)) {
    const opt = optimal(t.players);
    const inOpt = new Set(opt.players.map((p) => p.key));
    bench[w][tid] = {
      actual: t.startersTotal, optimal: opt.total, left: r2(opt.total - t.startersTotal),
      shouldStart: t.players.filter((p) => p.slot === "BENCH" && inOpt.has(p.key)).map((p) => ({ name: p.name, pts: p.pts })),
      over: t.players.filter((p) => p.slot !== "BENCH" && p.slot !== "IR" && !inOpt.has(p.key)).map((p) => ({ name: p.name, pts: p.pts || 0 })),
    };
  }
}

// ---------------- standings and season threads ----------------
const rec = {}; for (const id of TEAM_IDS) rec[id] = { team: id, w: 0, l: 0, t: 0, pf: 0, pa: 0, weekly: [] };
for (let w = 1; w <= LAST; w++) {
  for (const m of weekly[w].matchups) {
    const H = rec[m.home], A = rec[m.away];
    H.pf += m.homePts; H.pa += m.awayPts; A.pf += m.awayPts; A.pa += m.homePts;
    H.weekly.push(m.homePts); A.weekly.push(m.awayPts);
    if (m.homePts > m.awayPts) { H.w++; A.l++; } else if (m.awayPts > m.homePts) { A.w++; H.l++; } else { H.t++; A.t++; }
  }
}
const seasonGames = [];
for (let w = 1; w <= LAST; w++) for (const m of weekly[w].matchups) seasonGames.push(m);
const TIEBREAK = tiebreakOf(settings);
const standings = rankStandings(Object.fromEntries(Object.entries(rec).map(([id, x]) => [id, { ...x, pf: r2(x.pf), pa: r2(x.pa) }])), seasonGames, TIEBREAK);
const benchYTD = TEAM_IDS.map((id) => ({ team: id, left: r2(Object.values(bench).reduce((s, wk) => s + (wk[id] ? wk[id].left : 0), 0)),
  byWeek: Object.keys(bench).map((w) => (bench[w][id] ? bench[w][id].left : 0)) })).sort((a, b) => b.left - a.left);
const teamHighs = [];
for (let w = 1; w <= LAST; w++) for (const m of weekly[w].matchups) {
  teamHighs.push({ week: w, team: m.home, pts: m.homePts }, { week: w, team: m.away, pts: m.awayPts });
}
teamHighs.sort((a, b) => b.pts - a.pts);
const playerHighs = [];
for (let w = 1; w <= LAST; w++) for (const [tid, t] of Object.entries(players[w].teams)) {
  for (const p of t.players) if (p.slot !== "BENCH" && p.slot !== "IR" && p.pts != null) playerHighs.push({ week: w, team: Number(tid), name: p.name, key: p.key, pos: p.pos, pts: p.pts });
}
playerHighs.sort((a, b) => b.pts - a.pts);

// ---------------- the target week's matchups + series ----------------
const weekGames = (w) => (sched.weeks[w - 1] ? sched.weeks[w - 1].g : []).map((g) => ({ away: g.a, home: g.h }));
const hist = [];
for (const d of byKind("hist")) { const h = await fsGet(d); for (const m of h.matchups || []) hist.push({ season: h.season, ...m }); }
for (let w = 1; w <= LAST; w++) for (const m of weekly[w].matchups) hist.push({ season: SEASON, week: w, ...m });
const series = (a, b) => computeSeries(hist, a, b);
const games = weekGames(WEEK).map((g) => {
  const out = { ...g, series: series(g.away, g.home) };
  if (TYPE === "recap") {
    const m = weekly[WEEK].matchups.find((x) => x.home === g.home && x.away === g.away);
    Object.assign(out, { awayPts: m.awayPts, homePts: m.homePts, margin: r2(Math.abs(m.homePts - m.awayPts)) });
  }
  return out;
});
const next = weekGames(WEEK + 1);

// ---------------- win probability (recap) ----------------
let wp = null;
if (TYPE === "recap") {
  const g = await fsGet(`wpgraph_${SEASON}_w${WEEK}`);
  if (g) {
    wp = {};
    for (const gm of games) {
      const s = g[`m_${gm.home}_${gm.away}`];
      if (!s) continue;
      // A tied game has no winner (winner null, series stays the away team's chance); it used to
      // be read as a home win.
      wp[`${gm.away}@${gm.home}`] = summarizeWp(s, gm.away, gm.home, gm.awayPts, gm.homePts);
    }
  }
}

// ---------------- chat + transactions since the last column ----------------
// Default: from the start of the newest published issue's day (robogoat/issues.json), so the chat
// and transactions are everything since the last column; "Nd" means N days back. With no issues
// file, 7 days. Capped at 14 days so an old issues.json cannot pull a month of chat.
const NOW = arg("--now") ? Date.parse(arg("--now")) : Date.now();
function defaultSince() {
  try { return sinceDefault(JSON.parse(readFileSync(join(ROOT, "robogoat/issues.json"), "utf8")).issues, NOW); } catch (e) { return NOW - 7 * 864e5; }
}
const sinceArg = arg("--since");
const since = !sinceArg ? defaultSince() : /^\d+d$/.test(sinceArg) ? NOW - Number(sinceArg.slice(0, -1)) * 864e5 : Date.parse(sinceArg);
const chat = [];
for (const id of byKind("chat")) {
  const t = Number(id.split("_")[1]);
  if (!(t >= since)) continue;
  const c = await fsGet(id);
  if (c.sys || (!c.text && !c.gif)) continue;
  chat.push({ t: c.t, who: c.who, teamId: c.teamId, thread: c.thread || null, text: c.text || "[gif]" });
}
chat.sort((a, b) => a.t - b.t);
const tx = [];
for (const id of byKind("tx")) {
  const t = Number(id.split("_")[1]);
  if (!(t >= since)) continue;
  const x = await fsGet(id);
  tx.push({ t: x.t || t, team: x.teamId, type: x.type, detail: x.detail || {} });
}
tx.sort((a, b) => a.t - b.t);

// ---------------- preview extras: this week's lineups, injuries, projections ----------------
let lineups = null, proj = null, rosterMeta = null, nflSched = null;
if (TYPE === "preview") {
  lineups = {}; rosterMeta = {};
  for (const id of TEAM_IDS) {
    const r = await fsGet(`roster_${SEASON}_w${WEEK}_t${id}`);
    lineups[id] = r ? r.players : [];
    rosterMeta[id] = r ? r._updateTime : null; // when this team last changed its lineup or roster
  }
  proj = await fsGet(`proj_${SEASON}_w${WEEK}`);
  // The week's NFL kickoffs (ESPN's public scoreboard, a GET): "who plays when" for the leads and drafts.
  try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${WEEK}&dates=${SEASON}`);
    nflSched = r.ok ? parseScoreboard(await r.json()) : null;
  } catch (e) { nflSched = null; }
  if (!nflSched || !nflSched.length) { console.error("warning: no NFL kickoff times from ESPN; kickoff-based leads and the weekend schedule are skipped"); nflSched = []; }
}

// A preview written after Thursday night (the Saturday preview) needs the week so far: each
// team's points from games already played, and who scored them. Players whose games have not
// started have no stat line yet (pts null) and are left out.
let thisWeek = null, injuries = null, playedKeys = null;
if (TYPE === "preview") {
  const d = dumpWeek(WEEK);
  injuries = {}; playedKeys = [];
  for (const x of Object.values(d.teams)) for (const p of x.players) { if (p.injury) injuries[p.key] = p.injury; if (p.pts != null && p.slot !== "IR") playedKeys.push(p.key); }
  thisWeek = Object.fromEntries(Object.entries(d.teams).map(([t, x]) => {
    const played = x.players.filter((p) => p.pts != null && p.slot !== "IR");
    return [t, {
      soFar: x.startersTotal,
      starters: played.filter((p) => p.slot !== "BENCH").map(({ name, nfl, pos, pts, line }) => ({ name, nfl, pos, pts, line })),
      bench: played.filter((p) => p.slot === "BENCH").map(({ name, nfl, pos, pts, line }) => ({ name, nfl, pos, pts, line })),
    }];
  }));
}

// ---------------- RoboGoat's own file: picks and rankings (read here; written only with --season-file) ----------------
const SF = arg("--season-file");
const SFPATH = resolve(ROOT, SF || `robogoat/${SEASON}/season.json`);
const seasonDoc = existsSync(SFPATH) ? JSON.parse(readFileSync(SFPATH, "utf8")) : { season: SEASON, picks: {}, rankings: {} };
const scoresOf = (w) => { const o = {}; for (const m of weekly[w].matchups) { o[m.home] = m.homePts; o[m.away] = m.awayPts; } return o; };
// Computed from the weekly scores, never typed: each pick's result, the week's picks record and the season's.
const pickRes = {}; // week -> [ "W" | "L" | "T" | null ] parallel to seasonDoc.picks[week]
for (let w = 1; w <= LAST; w++) if (seasonDoc.picks && seasonDoc.picks[w]) pickRes[w] = pickResults(seasonDoc.picks[w], weekGames(w), scoresOf(w));
const picksSeason = (() => { let w = 0, l = 0; for (const r of Object.values(pickRes)) for (const x of r) { if (x === "W") w++; else if (x === "L") l++; } return `${w}-${l}`; })();

// ---------------- leads and drafts for the writer ----------------
const owners = Object.fromEntries(TEAM_IDS.map((id) => [id, teams[id]]));
let leads = null, drafts = {};
if (TYPE === "preview") {
  const lineupObjs = Object.fromEntries(Object.entries(lineups).map(([t, ps]) => [t, ps.map((p) => ({ ...p, injury: (injuries && injuries[p.key]) || p.injury || "" }))]));
  const ctx = { teams: owners, lineups: lineupObjs, injuries, proj, sched: nflSched, now: NOW, played: new Set(playedKeys),
    updateTimes: rosterMeta, weekOpen: nflSched.length ? weekOpenBefore(nflSched[0].kickoff) : null, tx };
  leads = findLeads(ctx);
  drafts = {
    restOfWeekend: restOfWeekend(ctx).map((x) => x.text),
    injuryDesk: injuryDesk(ctx).map((x) => x.text),
    series: games.map((g) => seriesLine(g.series, owners)),
    thursday: thursdayTallies(games, thisWeek, owners).map((x) => x.text),
  };
} else {
  drafts = {
    series: games.map((g) => seriesLine(g.series, owners)),
    nextWeek: next.map((g) => `${teams[g.away].name} at ${teams[g.home].name}. ${seriesLine(series(g.away, g.home), owners)}`),
    rankings: (() => {
      const prev = (seasonDoc.rankings || {})[String(WEEK - 1)] || null;
      const order = (weekly[WEEK].power || []).slice().sort((a, b) => a.rank - b.rank).map((x) => x.teamId);
      const mv = rankMovement(prev, order);
      return order.map((t, i) => `${i + 1}. ${teams[t].name} (${teams[t].owner}, ${rec[t].w}-${rec[t].l}${rec[t].t ? "-" + rec[t].t : ""}). ` +
        `[${mv[i] == null ? "new" : mv[i] === 0 ? "same" : mv[i] > 0 ? "up " + mv[i] : "down " + -mv[i]}; GFFL power score ${(weekly[WEEK].power.find((x) => x.teamId === t) || {}).score}]`);
    })(),
  };
}

const facts = {
  season: SEASON, week: WEEK, type: TYPE, lastFinished: LAST, pulledAt: new Date().toISOString(), since: new Date(since).toISOString(),
  teams, slots, games, next,
  weekly: Object.fromEntries(Object.entries(weekly).map(([w, d]) => [w, { matchups: d.matchups, awards: d.awards, power: d.power }])),
  standings, bench, benchYTD, teamHighs: teamHighs.slice(0, 8), playerHighs: playerHighs.slice(0, 10),
  wp, chat, tx, lineups, proj, thisWeek,
  rosterMeta, nflSched, leads, drafts, newAnomalies: NEW_ANOMALIES,
  picks: { week: seasonDoc.picks ? seasonDoc.picks[WEEK] || null : null, results: pickRes, record: picksSeason },
};
const file = join(OUT, `facts-${SEASON}-w${WEEK}-${TYPE}.json`);
writeFileSync(file, JSON.stringify(facts, null, 1));
console.log(file);
if (drafts && Object.keys(drafts).length) {
  // The mechanical sections as plain text, for the writer to edit. Voice only: the numbers are done.
  const md = Object.entries(drafts).map(([k, v]) => `## ${k}\n\n${v.join("\n")}\n`).join("\n");
  writeFileSync(join(OUT, "drafts.md"), md);
}
if (leads) writeFileSync(join(OUT, "leads.md"), leads.map((l) => `- [${l.kind}] ${l.text}`).join("\n") + "\n");
if (NEW_ANOMALIES.length) console.error(`${NEW_ANOMALIES.length} NEW scorer anomaly(ies) above: look at them before writing numbers.`);

// ---------------- issue.json skeleton: the computed half; the column's author fills the rest ----------------
const slug = TYPE === "recap" ? `week-${WEEK}` : `week-${WEEK}-preview`;
const recStr = (id) => { const r = rec[id]; return `${r.w}-${r.l}` + (r.t ? `-${r.t}` : ""); };
const skeleton = {
  season: SEASON, week: WEEK, type: TYPE,
  published: "YYYY-MM-DD",
  subject: `RoboGoat: <hook> (Week ${WEEK} ${TYPE})`,
  description: "",
  share: `https://goatfantasyleague.com/robogoat/${SEASON}/${slug}/share.png`,
  window: "",
  // Computed from season.json's picks and the weekly scores; "W-L" is left only when there is nothing to score.
  ...(TYPE === "recap" ? { picksWeek: pickRes[WEEK] ? recordOf(pickRes[WEEK]) : "W-L" } : { picksRecord: Object.keys(pickRes).length ? picksSeason : "W-L" }),
  ...(TYPE === "preview" && seasonDoc.picks && seasonDoc.picks[WEEK] ? { picks: seasonDoc.picks[WEEK].map((p) => p.team) } : {}),
  teams: Object.fromEntries(TEAM_IDS.map((id) => [id, { name: teams[id].name, owner: teams[id].owner, color: teams[id].color, short: teams[id].short }])),
  records: Object.fromEntries(TEAM_IDS.map((id) => [id, recStr(id)])),
  games: games.map((g) => ({ away: g.away, ...(TYPE === "recap" ? { awayPts: g.awayPts } : {}), home: g.home, ...(TYPE === "recap" ? { homePts: g.homePts } : {}), note: "" })),
  standings: standings.map((s) => ({ team: s.team, w: s.w, l: s.l, pf: s.pf })),
  ...(TYPE === "recap" ? {
    bench: Object.entries(bench[WEEK]).map(([t, b]) => ({ team: Number(t), left: b.left })).sort((a, b) => b.left - a.left),
    stars: { kick: "The week’s biggest numbers", title: "", items: [] },
    wp: { game: { home: 0, away: 0 }, team: 0, kick: "", title: "", aria: "", t0: "", t1: "", annotations: [] },
  } : {}),
};
writeFileSync(join(OUT, "issue.skeleton.json"), JSON.stringify(skeleton, null, 1));
if (TYPE === "recap" && wp) {
  // wp.json for the issue: every game's raw series (p = AWAY team's chance), keyed as in the app.
  const g = await fsGet(`wpgraph_${SEASON}_w${WEEK}`);
  writeFileSync(join(OUT, "wp.all.json"), JSON.stringify(Object.fromEntries(Object.entries(g).filter(([k]) => k.startsWith("m_")))));
}

// ---------------- season.json: refresh the computed keys, keep RoboGoat's own ----------------
if (SF) {
  const path = SFPATH;
  const cur = seasonDoc;
  const weeks = { ...(cur.weeks || {}) };
  const added = [];
  for (let w = 1; w <= LAST; w++) {
    if (weeks[w] && !weeks[w].games) weeks[w] = { ...weeks[w], games: weekGames(w) }; // pairings added to a week stored before they were kept
    if (weeks[w] && !argv.includes("--refresh")) continue;
    const scores = {};
    for (const m of weekly[w].matchups) { scores[m.home] = m.homePts; scores[m.away] = m.awayPts; }
    weeks[w] = {
      bench: Object.fromEntries(Object.entries(bench[w]).map(([t, b]) => [t, b.left])),
      scores,
      games: weekGames(w), // the pairings, so picks can be scored without a recap issue for that week
      top: playerHighs.filter((p) => p.week === w).slice(0, 5).map(({ key, week, ...p }) => p),
    };
    added.push(w);
  }
  // Pick results are filled from the scores where blank. They used to be typed by hand (README step 4);
  // a result already there is never overwritten, but one that disagrees with the scores is reported.
  const { picks, settled, warnings } = settlePicks(cur.picks, pickRes);
  for (const w of warnings) console.error(/says/.test(w) ? "WARNING " + w : w);
  const { through, bench: _b, teamHighs: _t, playerHighs: _p, ...keep } = cur;
  writeFileSync(path, JSON.stringify({ ...keep, season: SEASON, picks, weeks }, null, 1) + "\n");
  console.log(`${SF}: ${added.length ? "wrote week(s) " + added.join(", ") : "no new weeks"}${settled.length ? "; settled picks " + settled.join(" ") : ""}`);
}
