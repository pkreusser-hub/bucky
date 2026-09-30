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
//   standings                                   weekly docs: W-L, then points
//   series                                      hist_<year> matchups + this season's weekly docs
//   win probability (recap)                     wpgraph_<season>_w<n>: p is the AWAY team's chance;
//                                               readings exist only while someone had the app open
//   chat / transactions                         chat_* (public league chat, sys lines dropped),
//                                               tx_* — never act_* (the private app log), never
//                                               trade_* (offers are private)
"use strict";

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, fsGet, fsIndex, firstName, shortName, r2 } from "./lib.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const SEASON = Number(arg("--season", "2026"));
const WEEK = Number(arg("--week"));
const TYPE = arg("--type", "recap");
const OUT = resolve(arg("--out", join(ROOT, "shots", "robogoat")));
if (!WEEK || !["recap", "preview"].includes(TYPE)) {
  console.error("usage: facts.mjs --season 2026 --week N --type recap|preview --out DIR [--since ISO]");
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
function dumpWeek(w) {
  const file = join(OUT, `players-${SEASON}-w${w}.json`);
  execFileSync(process.execPath, [join(ROOT, "tools/_gffl_shadow_score.mjs"), "--season", String(SEASON), "--week", String(w),
    "--no-live", "--quiet", "--dump", file], { stdio: ["ignore", "ignore", "inherit"] });
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
const standings = Object.values(rec).map((x) => ({ ...x, pf: r2(x.pf), pa: r2(x.pa) }))
  .sort((a, b) => b.w - a.w || b.pf - a.pf);
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
function series(a, b) {
  let wa = 0, wb = 0, t = 0; const games = [];
  for (const m of hist) {
    if (!((m.home === a && m.away === b) || (m.home === b && m.away === a))) continue;
    const pa = m.home === a ? m.homePts : m.awayPts, pb = m.home === b ? m.homePts : m.awayPts;
    if (pa > pb) wa++; else if (pb > pa) wb++; else t++;
    games.push({ season: m.season, week: m.week, [a]: pa, [b]: pb });
  }
  return { a, b, wins: { [a]: wa, [b]: wb }, ties: t, last: games.slice(-4) };
}
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
      const awayWon = gm.awayPts > gm.homePts, win = awayWon ? gm.away : gm.home;
      const pw = (x) => (awayWon ? x.p : 1 - x.p);
      let flips = 0, gaps = [];
      for (let i = 1; i < s.length; i++) {
        if ((s[i].p > 0.5) !== (s[i - 1].p > 0.5)) flips++;
        if (s[i].t - s[i - 1].t > 3 * 3600e3) gaps.push({ from: s[i - 1].t, to: s[i].t, pFrom: r2(pw(s[i - 1])), pTo: r2(pw(s[i])) });
      }
      const low = s.reduce((m, x) => (pw(x) < pw(m) ? x : m), s[0]);
      wp[`${gm.away}@${gm.home}`] = { winner: win, start: r2(pw(s[0])), low: { t: low.t, p: r2(pw(low)) }, flips, gaps,
        // the full series, oriented as P(winner), for the page's chart
        series: s.map((x) => ({ t: x.t, p: Math.round(pw(x) * 1e4) / 1e4 })) };
    }
  }
}

// ---------------- chat + transactions since the last column ----------------
const since = arg("--since") ? Date.parse(arg("--since")) : Date.now() - 7 * 864e5;
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
let lineups = null, proj = null;
if (TYPE === "preview") {
  lineups = {};
  for (const id of TEAM_IDS) {
    const r = await fsGet(`roster_${SEASON}_w${WEEK}_t${id}`);
    lineups[id] = r ? r.players : [];
  }
  proj = await fsGet(`proj_${SEASON}_w${WEEK}`);
}

const facts = {
  season: SEASON, week: WEEK, type: TYPE, lastFinished: LAST, pulledAt: new Date().toISOString(), since: new Date(since).toISOString(),
  teams, slots, games, next,
  weekly: Object.fromEntries(Object.entries(weekly).map(([w, d]) => [w, { matchups: d.matchups, awards: d.awards, power: d.power }])),
  standings, bench, benchYTD, teamHighs: teamHighs.slice(0, 8), playerHighs: playerHighs.slice(0, 10),
  wp, chat, tx, lineups, proj,
};
const file = join(OUT, `facts-${SEASON}-w${WEEK}-${TYPE}.json`);
writeFileSync(file, JSON.stringify(facts, null, 1));
console.log(file);

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
  ...(TYPE === "recap" ? { picksWeek: "W-L" } : { picksRecord: "W-L" }),
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
const SF = arg("--season-file");
if (SF) {
  const path = resolve(ROOT, SF);
  const cur = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { season: SEASON, picks: {}, rankings: {} };
  const weeks = { ...(cur.weeks || {}) };
  const added = [];
  for (let w = 1; w <= LAST; w++) {
    if (weeks[w] && !argv.includes("--refresh")) continue;
    const scores = {};
    for (const m of weekly[w].matchups) { scores[m.home] = m.homePts; scores[m.away] = m.awayPts; }
    weeks[w] = {
      bench: Object.fromEntries(Object.entries(bench[w]).map(([t, b]) => [t, b.left])),
      scores,
      top: playerHighs.filter((p) => p.week === w).slice(0, 5).map(({ key, week, ...p }) => p),
    };
    added.push(w);
  }
  const { through, bench: _b, teamHighs: _t, playerHighs: _p, ...keep } = cur;
  writeFileSync(path, JSON.stringify({ ...keep, season: SEASON, weeks }, null, 1) + "\n");
  console.log(`${SF}: ${added.length ? "wrote week(s) " + added.join(", ") : "no new weeks"}`);
}
