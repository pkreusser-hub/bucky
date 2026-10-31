#!/usr/bin/env node
// tools/robogoat/rankings.mjs — the recap's Power Rankings: each roster's strength for the rest of
// the regular season. READ-ONLY against the league (Firestore GETs, Sleeper and ESPN GETs).
//
//   node tools/robogoat/rankings.mjs --week 7 [--season 2026] [--out DIR]
//
// --week is the last FINISHED week. Writes <out>/rankings.json and prints the report: the order
// (paste it into season.json's rankings.N), each team's number, its weekly projections, its
// opponents, its lineup with raw averages, and its holes (a week with no legal starter at a slot).
//
// Perry, 2026-10-27: "on the power rankings section, it should be an analysis on strength of the
// whole team for the remainder of the season". The method (Week 7's, by hand, now this file):
//   - a player's rate is his points per game this season under league scoring, every game he played,
//     not only the weeks he was on a GFFL roster (Sleeper stat lines through the shadow scorer's own
//     score/normSlp, so the arithmetic is the league's);
//   - the rate is shrunk toward the position's replacement level by one game, so a one-game
//     pickup does not outrank a seven-game regular (replacement = the 25th-percentile rate among
//     rostered players at the position with three or more games);
//   - for each remaining regular-season week, the best legal lineup from the roster, with that
//     week's NFL byes and IR-slot players left out; the team's number is the average of those weeks.
// Quote RAW averages in the column (`ppg`, `games`); `rate` is the shrunk number the lineup uses.
"use strict";

import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, fsGet, fsIndex, firstName, r1 } from "./lib.mjs";

const STARTERS = ["QB", "RB", "WR", "TE", "FLEX", "K", "DST"];
const FLEX_OK = ["RB", "WR", "TE"]; // lg-core.js: slot === "FLEX" ? take(["RB", "WR", "TE"])
// One spelling per NFL team: rosters carry Sleeper's codes, ESPN's scoreboard its own.
export const canonTeam = (t) => ({ WSH: "WAS", JAC: "JAX", LA: "LAR" })[String(t || "").toUpperCase()] || String(t || "").toUpperCase();

/** Pure: raw average, games and the shrunk rate. games: [pts per game played]. */
export function rateOf(games, replacement) {
  const n = games.length, sum = games.reduce((a, b) => a + b, 0);
  return { games: n, ppg: n ? sum / n : 0, rate: (sum + replacement) / (n + 1) };
}

/** Pure: per position, the 25th-percentile raw average among players with 3+ games. */
export function replacementLevels(players) {
  const out = {};
  for (const pos of ["QB", "RB", "WR", "TE", "K", "DST"]) {
    const v = players.filter((p) => p.pos === pos && p.weeks.length >= 3).map((p) => p.weeks.reduce((a, b) => a + b, 0) / p.weeks.length).sort((a, b) => a - b);
    out[pos] = v.length ? v[Math.floor(v.length / 4)] : 0;
  }
  return out;
}

/** Pure: the best legal lineup by rate. players: [{ name, pos, rate }]; slots: { QB: 1, ... }.
 *  -> { total, lineup: [{ slot, ...player }], holes: [slot names left empty] } */
export function bestLineup(players, slots) {
  const used = new Set(), lineup = [], holes = [];
  const pick = (slot, ok) => {
    const p = players.filter((x) => !used.has(x) && ok.includes(x.pos)).sort((a, b) => b.rate - a.rate)[0];
    if (p) { used.add(p); lineup.push({ ...p, rosterSlot: p.slot, slot }); } else holes.push(slot);
  };
  for (const s of STARTERS) if (s !== "FLEX") for (let i = 0; i < (slots[s] || 0); i++) pick(s, [s]);
  for (let i = 0; i < (slots.FLEX || 0); i++) pick("FLEX", FLEX_OK);
  return { total: lineup.reduce((a, p) => a + p.rate, 0), lineup, holes };
}

/** Pure: the whole ranking.
 *  teams   { id: { owner, name } }
 *  players [{ team, key, name, pos, nfl, slot, weeks: [pts per game played] }]
 *  slots   the league's roster rules; sched [{ g: [{ h, a }] }] (index 0 = Week 1)
 *  byes    { week: [NFL teams off] }; from, to: the remaining weeks, inclusive */
export function restOfSeason({ teams, players, slots, sched, byes, from, to }) {
  const rep = replacementLevels(players);
  const rated = players.map((p) => ({ ...p, nfl: canonTeam(p.nfl), ...rateOf(p.weeks, rep[p.pos] || 0) }));
  const res = {};
  for (const id of Object.keys(teams)) {
    const mine = rated.filter((p) => String(p.team) === String(id));
    const active = mine.filter((p) => p.slot !== "IR");
    const full = bestLineup(active, slots);
    const weekly = [];
    for (let w = from; w <= to; w++) {
      const off = new Set((byes[w] || []).map(canonTeam));
      const b = bestLineup(active.filter((p) => !off.has(p.nfl)), slots);
      const starters = new Set(full.lineup.map((p) => p.key));
      weekly.push({ week: w, pts: b.total, holes: b.holes, out: active.filter((p) => off.has(p.nfl) && starters.has(p.key)).map((p) => p.name) });
    }
    const opponents = [];
    for (let w = from; w <= to; w++) for (const g of ((sched[w - 1] || {}).g || [])) {
      if (String(g.h) === String(id)) opponents.push(String(g.a));
      if (String(g.a) === String(id)) opponents.push(String(g.h));
    }
    const lineupKeys = new Set(full.lineup.map((p) => p.key));
    res[id] = {
      id: Number(id), owner: teams[id].owner, name: teams[id].name,
      avg: weekly.length ? weekly.reduce((a, w) => a + w.pts, 0) / weekly.length : 0,
      full: full.total, weekly, opponents, lineup: full.lineup,
      bench: active.filter((p) => !lineupKeys.has(p.key)).sort((a, b) => b.rate - a.rate),
      ir: mine.filter((p) => p.slot === "IR"),
    };
  }
  for (const r of Object.values(res)) r.oppAvg = r.opponents.length ? r.opponents.reduce((a, o) => a + res[o].avg, 0) / r.opponents.length : 0;
  const order = Object.values(res).sort((a, b) => b.avg - a.avg).map((r) => r.id);
  // League-wide comparisons the entries lean on, from raw averages (quote these, not rates).
  const byPpg = (f) => rated.filter((p) => p.slot !== "IR" && p.games && f(p)).sort((a, b) => b.ppg - a.ppg).slice(0, 6)
    .map((p) => ({ name: p.name, pos: p.pos, owner: teams[p.team].owner, ppg: p.ppg, games: p.games }));
  const pairs = Object.values(res).map((r) => {
    const best = (pos) => Math.max(0, ...r.lineup.concat(r.bench).filter((p) => p.pos === pos && p.games).map((p) => p.ppg));
    return { owner: r.owner, k: best("K"), dst: best("DST"), sum: best("K") + best("DST") };
  }).sort((a, b) => b.sum - a.sum);
  const starters = (pos) => Object.values(res).map((r) => { const p = r.lineup.find((x) => x.slot === pos); return p && { owner: r.owner, name: p.name, ppg: p.ppg, games: p.games }; })
    .filter(Boolean).sort((a, b) => b.ppg - a.ppg);
  return { order, teams: res, replacement: rep, leaders: { overall: byPpg(() => true), nonQB: byPpg((p) => p.pos !== "QB"), qb: byPpg((p) => p.pos === "QB") },
    kdst: pairs, startingTE: starters("TE"), startingQB: starters("QB") };
}

/** Pure: the plain-text report. */
export function render(r, { from, to }) {
  const L = [];
  L.push(`Rest of the season, Weeks ${from}-${to}: points a week from the best lineup each week (byes and IR out).`);
  L.push(`season.json rankings: [${r.order.join(", ")}]`, "");
  for (const id of r.order) {
    const t = r.teams[id];
    L.push(`${r.order.indexOf(id) + 1}. ${t.name} (${t.owner}): ${r1(t.avg)} a week; full roster ${r1(t.full)}; opponents average ${r1(t.oppAvg)} (${t.opponents.map((o) => r.teams[o].owner).join(", ")})`);
    L.push("   by week: " + t.weekly.map((w) => `W${w.week} ${r1(w.pts)}${w.holes.length ? ` NO ${w.holes.join("/")}` : ""}${w.out.length ? ` [off: ${w.out.join(", ")}]` : ""}`).join("; "));
    L.push("   lineup: " + t.lineup.map((p) => `${p.name} ${p.slot} ${r1(p.ppg)}/${p.games}g`).join("; "));
    L.push("   bench:  " + t.bench.slice(0, 6).map((p) => `${p.name} ${p.pos} ${r1(p.ppg)}/${p.games}g`).join("; "));
    if (t.ir.length) L.push("   IR:     " + t.ir.map((p) => `${p.name} ${r1(p.ppg)}/${p.games}g`).join("; "));
  }
  L.push("", "Leaders (raw points per game): " + r.leaders.overall.map((p) => `${p.name} (${p.owner}) ${r1(p.ppg)}`).join("; "));
  L.push("Non-quarterbacks: " + r.leaders.nonQB.map((p) => `${p.name} (${p.owner}) ${r1(p.ppg)}`).join("; "));
  L.push("Quarterbacks: " + r.leaders.qb.map((p) => `${p.name} (${p.owner}) ${r1(p.ppg)}`).join("; "));
  L.push("Kicker + defense: " + r.kdst.map((p) => `${p.owner} ${r1(p.sum)}`).join("; "));
  L.push("Starting tight ends: " + r.startingTE.map((p) => `${p.owner} ${p.name} ${r1(p.ppg)}`).join("; "));
  return L.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
  const SEASON = Number(arg("--season", "2026")), WEEK = Number(arg("--week"));
  if (!WEEK) { console.error("usage: rankings.mjs --week N (the last finished week) [--season 2026] [--out DIR]"); process.exit(2); }
  const OUT = resolve(arg("--out", join(ROOT, "shots", "robogoat", `week-${WEEK}`)));
  mkdirSync(OUT, { recursive: true });
  const S = await import("../_gffl_shadow_score.mjs");

  const settings = await fsGet("settings");
  const rules = settings.rules;
  const LAST = Number(rules.seasonWeeks || 14);
  const sched = (await fsGet(`sched_${SEASON}`)).weeks;
  const teams = {};
  for (const d of (await fsIndex()).filter((x) => x.kind === "team")) {
    const t = await fsGet(d.id);
    teams[t.teamId] = { owner: firstName(t.owner), name: t.name };
  }
  // Rosters as they stand for next week; the newest roster doc at or before it.
  const roster = {};
  for (const id of Object.keys(teams)) {
    for (let w = WEEK + 1; w >= 1 && !roster[id]; w--) { const r = await fsGet(`roster_${SEASON}_w${w}_t${id}`); if (r && r.players) roster[id] = r.players; }
  }
  const quiet = { setStatus() {}, line() {} };
  const dir = await S.loadSleeperDirectory(quiet);
  if (!dir) throw new Error("Sleeper player directory unreachable");
  const players = [];
  for (const id of Object.keys(roster)) for (const p of roster[id]) {
    const meta = new Map(roster[id].map((x) => [x.key, { name: x.name, team: x.team }]));
    players.push({ team: id, key: p.key, name: p.name, pos: p.pos, nfl: p.team || "", slot: p.slot, pid: S.resolvePid(p.key, dir.byEspn, dir.byName, meta).pid, weeks: [] });
  }
  const unresolved = players.filter((p) => !p.pid).map((p) => p.name);
  for (let w = 1; w <= WEEK; w++) {
    const b = await S.loadStatsBucket(SEASON, w, "regular");
    if (!b.ok) throw new Error(`Sleeper stats for week ${w} unreachable`);
    for (const p of players) {
      const st = p.pid && b.entries[p.pid];
      if (!st) continue;
      const played = (st.gp || 0) > 0 || (st.off_snp || 0) > 0 || (st.st_snp || 0) > 0 || st.pts_allow != null;
      if (played) p.weeks.push(S.score(S.normSlp(st, p.key.startsWith("dst_") || p.pos === "DST"), rules.scoring));
    }
  }
  const byes = {}, seen = {};
  for (let w = WEEK + 1; w <= LAST; w++) {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${w}&dates=${SEASON}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    const j = await r.json();
    seen[w] = new Set();
    for (const e of j.events || []) for (const c of e.competitions[0].competitors) seen[w].add(canonTeam(c.team.abbreviation));
  }
  const all = new Set(Object.values(seen).flatMap((s) => [...s]));
  for (const w of Object.keys(seen)) byes[w] = [...all].filter((t) => !seen[w].has(t)).sort();

  const from = WEEK + 1, to = LAST;
  const r = restOfSeason({ teams, players, slots: rules.roster, sched, byes, from, to });
  writeFileSync(join(OUT, "rankings.json"), JSON.stringify({ season: SEASON, week: WEEK, from, to, byes, ...r }, null, 1));
  console.log(render(r, { from, to }));
  console.log(`\nbyes: ${Object.entries(byes).map(([w, b]) => `W${w} ${b.join(" ") || "none"}`).join("; ")}`);
  if (unresolved.length) console.log(`unresolved (rated at replacement level): ${unresolved.join(", ")}`);
  console.log(`wrote ${join(OUT, "rankings.json")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
