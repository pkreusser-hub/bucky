// tools/robogoat/analysis.mjs — the pure half of the RoboGoat kit: every rule that turns facts
// into standings, win-probability summaries, joke leads, mechanical drafts and pick results.
//
// No network, no files, no clock unless one is passed in. facts.mjs, week.mjs and build.mjs call
// these; tools/_verify-robogoat.cjs calls them with fixtures shaped like the real data, so each
// rule has a hand-computed check.
"use strict";

export const r2 = (x) => Math.round(Number(x) * 100) / 100;

// ---------------------------------------------------------------- standings
/** The league's tiebreak order. rules.tiebreak (settings doc) wins when present; until it is,
 *  the default is ["h2h","pf"] — head-to-head among the tied teams, then points for — because
 *  that is what the app is moving to (2026-10-04). Before it, the kit sorted wins then PF only. */
export const DEFAULT_TIEBREAK = ["h2h", "pf"];
export function tiebreakOf(settings) {
  const t = settings && settings.rules && settings.rules.tiebreak;
  return Array.isArray(t) && t.length ? t.map(String) : DEFAULT_TIEBREAK;
}
/** Win points: a win is 1, a tie is a half. */
export const winPts = (r) => r.w + 0.5 * r.t;

/** Rank teams: win points (w + 0.5 t) first; teams level on that are split by each tiebreak in
 *  order ("h2h" = win points in games among the tied teams only; "pf" = points for), a step only
 *  applying to teams it still leaves level; team id is the last word so the order is stable.
 *  rec: { [id]: { team, w, l, t, pf, ... } }; games: [{ home, away, homePts, awayPts }] this season. */
export function rankStandings(rec, games, tiebreak = DEFAULT_TIEBREAK) {
  const rows = Object.values(rec);
  const split = (group, steps) => {
    if (group.length < 2 || !steps.length) return group.slice().sort((a, b) => a.team - b.team);
    const [step, ...rest] = steps;
    let score;
    if (step === "pf") score = (x) => x.pf;
    else if (step === "h2h") {
      const ids = new Set(group.map((x) => x.team)), h = {};
      for (const x of group) h[x.team] = 0;
      for (const g of games) {
        if (!ids.has(g.home) || !ids.has(g.away)) continue;
        if (g.homePts > g.awayPts) h[g.home] += 1;
        else if (g.awayPts > g.homePts) h[g.away] += 1;
        else { h[g.home] += 0.5; h[g.away] += 0.5; }
      }
      score = (x) => h[x.team];
    } else score = () => 0; // an unknown step separates nobody; the next one gets its turn
    const out = [];
    const levels = [...new Set(group.map(score))].sort((a, b) => b - a);
    for (const v of levels) out.push(...split(group.filter((x) => score(x) === v), rest));
    return out;
  };
  const out = [];
  for (const v of [...new Set(rows.map(winPts))].sort((a, b) => b - a)) out.push(...split(rows.filter((x) => winPts(x) === v), tiebreak));
  return out;
}

// ---------------------------------------------------------------- win probability
/** One game's wpgraph series (s[i].p = the AWAY team's chance, s[i].t ms) summarised for the page.
 *  A tied game has no winner: winner is null and the series stays the away team's chance. A reading
 *  of exactly 0.5 is on neither side, so it never counts as a flip by itself (the side before it
 *  and the side after it are compared). */
export function summarizeWp(s, away, home, awayPts, homePts) {
  const tie = awayPts === homePts;
  const awayWon = awayPts > homePts;
  const pw = (x) => (tie || awayWon ? x.p : 1 - x.p);
  let flips = 0, last = 0;
  const gaps = [];
  for (let i = 0; i < s.length; i++) {
    const side = Math.sign(s[i].p - 0.5);
    if (side && last && side !== last) flips++;
    if (side) last = side;
    if (i && s[i].t - s[i - 1].t > 3 * 3600e3) gaps.push({ from: s[i - 1].t, to: s[i].t, pFrom: r2(pw(s[i - 1])), pTo: r2(pw(s[i])) });
  }
  const low = s.reduce((m, x) => (pw(x) < pw(m) ? x : m), s[0]);
  return { winner: tie ? null : awayWon ? away : home, tie, start: r2(pw(s[0])), low: { t: low.t, p: r2(pw(low)) }, flips, gaps,
    series: s.map((x) => ({ t: x.t, p: Math.round(pw(x) * 1e4) / 1e4 })) };
}

// ---------------------------------------------------------------- the window since the last column
/** Where "since the last column" starts: the beginning of the newest issue's day (issues: the
 *  issues.json list; Chicago midnight, taken as UTC-5 so the window never starts late), never more
 *  than 14 days before now; 7 days back when there is no issue yet. Returns ms. */
export function sinceDefault(issues, now) {
  const d = (issues || []).map((x) => x.published).filter(Boolean).sort().pop();
  if (!d) return now - 7 * 864e5;
  return Math.max(Date.parse(d + "T00:00:00Z") + 5 * 3600e3, now - 14 * 864e5);
}

// ---------------------------------------------------------------- series
/** Head-to-head between two teams over every game in hist ({ season, week, home, away, homePts, awayPts }),
 *  plus the current streak (who has won the most recent run, and how long). */
export function computeSeries(hist, a, b) {
  let wa = 0, wb = 0, t = 0;
  const games = [];
  for (const m of hist) {
    if (!((m.home === a && m.away === b) || (m.home === b && m.away === a))) continue;
    const pa = m.home === a ? m.homePts : m.awayPts, pb = m.home === b ? m.homePts : m.awayPts;
    if (pa > pb) wa++; else if (pb > pa) wb++; else t++;
    games.push({ season: m.season, week: m.week, [a]: pa, [b]: pb });
  }
  let streak = null;
  for (let i = games.length - 1; i >= 0; i--) {
    const w = games[i][a] > games[i][b] ? a : games[i][b] > games[i][a] ? b : null;
    if (w == null) break;
    if (!streak) streak = { team: w, n: 1 };
    else if (streak.team === w) streak.n++;
    else break;
  }
  return { a, b, wins: { [a]: wa, [b]: wb }, ties: t, streak, last: games.slice(-4) };
}

// ---------------------------------------------------------------- anomalies (the scorer's FAIL lines)
/** Split scorer FAIL lines into known and new. allow: [{ week, pattern, count?, reason }]. A line is
 *  known when an entry for that week (or no week) matches its text and, when the entry carries a
 *  count, the line's leading number ("FAIL: 1 rostered starter(s) ...") equals it — so a second
 *  stat-less starter in the same week is NEW even though the wording is the same. */
export function classifyAnomalies(lines, week, allow) {
  const known = [], fresh = [];
  for (const l of lines) {
    const n = Number((/^FAIL:\s*(\d+)/.exec(l) || [])[1]);
    const hit = (allow || []).find((e) => (e.week == null || e.week === week) && new RegExp(e.pattern, "i").test(l) && (e.count == null || e.count === n));
    (hit ? known : fresh).push(hit ? { line: l, reason: hit.reason || "" } : { line: l });
  }
  return { known, fresh };
}

// ---------------------------------------------------------------- picks
/** Result of each pick against that week's scores. picks: [{ team, result? }]; games: [{ away, home }];
 *  scores: { [team]: pts }. A pick is "W" if the picked team outscored its opponent, "L" if it was
 *  outscored, "T" on a tie, and null when its game or either score is not known. */
export function pickResults(picks, games, scores) {
  return picks.map((p) => {
    const g = (games || []).find((x) => x.away === p.team || x.home === p.team);
    if (!g) return null;
    const mine = scores && scores[p.team], theirs = scores && scores[g.away === p.team ? g.home : g.away];
    if (mine == null || theirs == null) return null;
    return mine > theirs ? "W" : mine < theirs ? "L" : "T";
  });
}
/** Fill blank pick results from computed ones. A result already written is never replaced (a
 *  disagreement is returned as a warning), and a tie is left blank. res: pickResults() by week. */
export function settlePicks(picks, res) {
  const out = JSON.parse(JSON.stringify(picks || {})), settled = [], warnings = [];
  for (const [w, r] of Object.entries(res)) {
    out[w].forEach((p, i) => {
      if (r[i] === "T") warnings.push(`picks.${w}[${i}] (team ${p.team}) tied; left blank`);
      else if (!p.result && r[i]) { p.result = r[i]; settled.push(`${w}:${p.team}=${r[i]}`); }
      else if (p.result && r[i] && p.result !== r[i]) warnings.push(`picks.${w}[${i}] (team ${p.team}) says "${p.result}" but the scores say "${r[i]}"`);
    });
  }
  return { picks: out, settled, warnings };
}
export const recordOf = (results) => `${results.filter((r) => r === "W").length}-${results.filter((r) => r === "L").length}`;
/** Season picks record "W-L" through `through`, from season.picks results already settled. */
export function picksRecord(picks, through) {
  let w = 0, l = 0;
  for (const [wk, list] of Object.entries(picks || {})) {
    if (Number(wk) > through) continue;
    for (const p of list) { if (p.result === "W") w++; else if (p.result === "L") l++; }
  }
  return `${w}-${l}`;
}
/** Everything the hand-written picks columns must agree with, as a list of problems (empty = fine).
 *  pairings(w) -> [{ away, home }] for week w or null; scores from season.weeks[w].scores. */
export function picksProblems(season, issue, pairings) {
  const out = [];
  const through = issue.type === "recap" ? issue.week : issue.week - 1;
  const settled = {}; // week -> computed results (only where pairings and scores are both known)
  for (const [wk, list] of Object.entries(season.picks || {})) {
    const w = Number(wk);
    if (w > through) continue;
    const res = pickResults(list, pairings(w), season.weeks && season.weeks[wk] && season.weeks[wk].scores);
    if (res.some((r) => r == null)) { out.push(`season.json picks.${w} cannot be checked: no pairings or scores for week ${w}`); continue; }
    settled[w] = res;
    list.forEach((p, i) => { if (p.result !== res[i]) out.push(`season.json picks.${w}[${i}] (team ${p.team}) says "${p.result}", the week ${w} scores say "${res[i]}"`); });
  }
  if (issue.type === "recap" && issue.picksWeek != null && settled[issue.week] && issue.picksWeek !== recordOf(settled[issue.week])) {
    out.push(`issue.json picksWeek is "${issue.picksWeek}", week ${issue.week}'s picks score ${recordOf(settled[issue.week])}`);
  }
  if (issue.type === "preview" && issue.picksRecord != null) {
    const want = Object.entries(settled).reduce((s, [, r]) => [s[0] + r.filter((x) => x === "W").length, s[1] + r.filter((x) => x === "L").length], [0, 0]).join("-");
    const unsettled = Object.keys(season.picks || {}).map(Number).filter((w) => w <= through && !settled[w]);
    if (!unsettled.length && issue.picksRecord !== want) out.push(`issue.json picksRecord is "${issue.picksRecord}", picks through week ${through} score ${want}`);
  }
  if (issue.type === "preview" && Array.isArray(issue.picks)) {
    const sp = ((season.picks || {})[String(issue.week)] || []).map((p) => p.team);
    if (JSON.stringify(sp) !== JSON.stringify(issue.picks)) out.push(`issue.json picks ${JSON.stringify(issue.picks)} differ from season.json picks.${issue.week} ${JSON.stringify(sp)}`);
  }
  return out;
}

// ---------------------------------------------------------------- rankings
/** Movement against the previous ranking: +n up, -n down, 0 same, null for a team not in it. */
export function rankMovement(prev, cur) {
  return cur.map((t, i) => (prev && prev.includes(t) ? prev.indexOf(t) - i : null));
}
/** The column's power-ranking lines ("1. Team (Owner, 2-1). Text.") against season.rankings[week]
 *  and issue.records: problems as a list. names: { name -> id }; owners: { id -> owner }. */
export function rankingProblems(lines, ranking, records, byName, owners) {
  const out = [];
  const ids = [];
  for (const l of lines) {
    const m = /^(\d+)\.\s*(.+?) \((\w+), (\d-\d(?:-\d)?)\)\./.exec(l);
    if (!m) continue; // the parser in build.mjs reports unparseable lines itself
    const id = byName[m[2]];
    ids.push(id);
    if (id == null) continue;
    if (Number(m[1]) !== ids.length) out.push(`power rankings: "${m[2]}" is numbered ${m[1]} but is line ${ids.length}`);
    if (owners[id] && m[3] !== owners[id]) out.push(`power rankings: ${m[2]} is listed under ${m[3]}, the owner is ${owners[id]}`);
    if (records[id] && m[4] !== records[id]) out.push(`power rankings: ${m[2]} is listed at ${m[4]}, the record is ${records[id]}`);
  }
  if (ranking && JSON.stringify(ids) !== JSON.stringify(ranking)) out.push(`power rankings order ${JSON.stringify(ids)} differs from season.json rankings ${JSON.stringify(ranking)}`);
  return out;
}

// ---------------------------------------------------------------- lineups
const BENCHISH = new Set(["BENCH", "IR"]);
export const isStarter = (p) => !BENCHISH.has(p.slot);
/** Canonical lineup snapshot: { [team]: { [playerKey]: { name, slot } } } with every key sorted,
 *  so two reads of the same lineup compare equal regardless of key order (CLAUDE.md bite 9). */
export function snapshotLineups(lineups) {
  const out = {};
  for (const t of Object.keys(lineups || {}).sort((a, b) => Number(a) - Number(b))) {
    out[t] = {};
    for (const p of (lineups[t] || []).slice().sort((a, b) => String(a.key).localeCompare(String(b.key)))) out[t][p.key] = { name: p.name, slot: p.slot };
  }
  return out;
}
/** Keyed diff of two snapshots, by team, player and slot. Sorted by team then player name. */
export function diffLineups(prev, next) {
  const out = [];
  const teams = [...new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])].sort((a, b) => Number(a) - Number(b));
  for (const t of teams) {
    const a = (prev && prev[t]) || {}, b = (next && next[t]) || {};
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
      if (!a[k]) out.push({ team: Number(t), key: k, name: b[k].name, change: "added", from: null, to: b[k].slot });
      else if (!b[k]) out.push({ team: Number(t), key: k, name: a[k].name, change: "removed", from: a[k].slot, to: null });
      else if (a[k].slot !== b[k].slot) out.push({ team: Number(t), key: k, name: b[k].name, change: "moved", from: a[k].slot, to: b[k].slot });
    }
  }
  return out.sort((x, y) => x.team - y.team || x.name.localeCompare(y.name));
}
export function formatLineupDiff(diff, teams) {
  if (!diff.length) return ["No lineup changes."];
  const by = {};
  for (const d of diff) (by[d.team] = by[d.team] || []).push(d);
  return Object.entries(by).map(([t, ds]) => {
    const who = teams && teams[t] ? `${teams[t].owner} (${teams[t].short || teams[t].name})` : `team ${t}`;
    return `${who}: ` + ds.map((d) => (d.change === "moved" ? `${d.name} ${d.from} -> ${d.to}` : d.change === "added" ? `${d.name} added to ${d.to}` : `${d.name} dropped from ${d.from}`)).join("; ");
  });
}

// ---------------------------------------------------------------- time
const CHI = "America/Chicago";
const DOW = new Intl.DateTimeFormat("en-US", { timeZone: CHI, weekday: "long" });
const HM = new Intl.DateTimeFormat("en-US", { timeZone: CHI, hour: "numeric", minute: "2-digit", hour12: true });
/** "Sunday 8:30 a.m." in Chicago time. */
export function chiWhen(ms) {
  const hm = HM.format(new Date(ms)).replace(" AM", " a.m.").replace(" PM", " p.m.");
  return `${DOW.format(new Date(ms))} ${hm}`;
}
export const chiClock = (ms) => HM.format(new Date(ms)).replace(" AM", " a.m.").replace(" PM", " p.m.");
export const chiDay = (ms) => DOW.format(new Date(ms));
/** Chicago midnight (UTC ms) of the Tuesday at or before ms: when a fantasy week opens for lineups. */
export function weekOpenBefore(ms) {
  let t = ms;
  for (let i = 0; i < 8; i++) {
    if (DOW.format(new Date(t)) === "Tuesday") break;
    t -= 864e5;
  }
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: CHI, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  // Chicago midnight of that date: find the offset by probing midnight UTC of the same date.
  const utc = Date.parse(f + "T00:00:00Z");
  for (const off of [5, 6]) {
    const cand = utc + off * 3600e3;
    if (new Intl.DateTimeFormat("en-CA", { timeZone: CHI, hour: "2-digit", hourCycle: "h23" }).format(new Date(cand)) === "00") return cand;
  }
  return utc + 6 * 3600e3;
}

// ---------------------------------------------------------------- NFL teams + kickoffs
const ABBR = { WAS: "WSH", JAC: "JAX", LA: "LAR", OAK: "LV", SD: "LAC", STL: "LAR" };
export const nflAbbr = (a) => { const u = String(a || "").toUpperCase(); return ABBR[u] || u; };
/** ESPN scoreboard JSON -> [{ id, kickoff (ms), away, home, awayName, homeName }] with normalised abbreviations. */
export function parseScoreboard(j) {
  const out = [];
  for (const ev of (j && j.events) || []) {
    const c = ev.competitions && ev.competitions[0];
    if (!c || !ev.date) continue;
    const away = (c.competitors || []).find((x) => x.homeAway === "away"), home = (c.competitors || []).find((x) => x.homeAway === "home");
    if (!away || !home) continue;
    out.push({ id: ev.id, kickoff: Date.parse(ev.date), away: nflAbbr(away.team.abbreviation), home: nflAbbr(home.team.abbreviation),
      awayName: away.team.shortDisplayName || away.team.name || away.team.abbreviation, homeName: home.team.shortDisplayName || home.team.name || home.team.abbreviation });
  }
  return out.sort((a, b) => a.kickoff - b.kickoff);
}
/** How a column names a player: defenses as "the Bears defense" (or "the CHI defense" with no schedule to name the team). */
function playerName(p, sched) {
  if (p.pos !== "DST") return p.name;
  const g = gameOf(sched, p.team);
  const n = g ? (g.away === nflAbbr(p.team) ? g.awayName : g.homeName) : p.name.replace(/ D\/ST$/, "");
  return `the ${n} defense`;
}
const gameOf = (sched, team) => (sched || []).find((g) => g.away === nflAbbr(team) || g.home === nflAbbr(team)) || null;
const isOut = (inj) => /^(out|o|ir|pup|sus|suspended)$/i.test(String(inj || ""));

// ---------------------------------------------------------------- leads (joke candidates)
/** Joke leads for the writer, each a plain fact with the numbers that make it one.
 *  ctx: { teams, lineups, injuries?: { key: status }, proj?: { players }, sched: parseScoreboard(), now,
 *         played?: Set<key> (players whose game is done), updateTimes?: { team: ISO }, weekOpen?: ms,
 *         tx?: [{ t, team, type, detail }] }
 *  A lead is never a claim of its own: the writer checks it against the facts before using it. */
export function findLeads(ctx) {
  const leads = [];
  const owner = (t) => (ctx.teams[t] ? ctx.teams[t].owner : `team ${t}`);
  const projOf = (p) => { const x = ctx.proj && ctx.proj.players && ctx.proj.players[p.key]; return x && typeof x.p === "number" ? x.p : null; };
  const injOf = (p) => String((ctx.injuries && ctx.injuries[p.key]) || p.injury || "");
  const played = ctx.played || new Set();
  for (const [t, list] of Object.entries(ctx.lineups || {})) {
    const starters = list.filter(isStarter);
    const bench = list.filter((p) => p.slot === "BENCH");
    for (const s of starters) {
      if (played.has(s.key)) continue;
      const inj = injOf(s), pr = projOf(s);
      if (isOut(inj) || pr === 0) {
        leads.push({ kind: "out-starter", team: Number(t), owner: owner(t), player: s.name, slot: s.slot, status: inj || null, proj: pr,
          text: `${owner(t)} starts ${s.name} at ${s.slot}` + (inj ? `, listed ${inj}` : "") + (pr === 0 ? ", projected 0.0" : "") + "." });
      }
      // A starter who kicks off after bench players who could replace him and would outscore him.
      const g = gameOf(ctx.sched, s.team);
      if (!g) continue;
      const canFill = (b) => b.pos === s.pos || (s.slot === "FLEX" && ["RB", "WR", "TE"].includes(b.pos)) ;
      const earlier = bench.filter((b) => canFill(b) && !played.has(b.key) && gameOf(ctx.sched, b.team) && gameOf(ctx.sched, b.team).kickoff < g.kickoff);
      const better = earlier.filter((b) => projOf(b) != null && pr != null && projOf(b) > pr);
      const fills = bench.filter((b) => canFill(b));
      const allEarlier = fills.length > 0 && fills.every((b) => gameOf(ctx.sched, b.team) && gameOf(ctx.sched, b.team).kickoff < g.kickoff);
      const doubtful = inj && !/^(healthy|active)$/i.test(inj);
      if (better.length || (doubtful && allEarlier)) {
        leads.push({ kind: "late-kickoff", team: Number(t), owner: owner(t), player: s.name, slot: s.slot, status: inj || null, proj: pr, kickoff: g.kickoff,
          bench: (better.length ? better : earlier).map((b) => ({ name: b.name, proj: projOf(b), kickoff: gameOf(ctx.sched, b.team).kickoff })),
          text: `${owner(t)}'s ${s.name}${doubtful ? ` (${inj})` : ""} kicks off ${chiWhen(g.kickoff)}; ` +
            (better.length ? `bench ${better.map((b) => `${b.name} (proj ${projOf(b)}, ${chiWhen(gameOf(ctx.sched, b.team).kickoff)})`).join(", ")} ${better.length > 1 ? "play" : "plays"} earlier and ${better.length > 1 ? "are" : "is"} projected higher.`
              : `every bench player who could take the slot kicks off earlier.`) });
      }
    }
  }
  // Teams that have not touched their lineup since the week opened.
  if (ctx.updateTimes && ctx.weekOpen != null) {
    for (const t of Object.keys(ctx.lineups || {})) {
      const u = ctx.updateTimes[t] && Date.parse(ctx.updateTimes[t]);
      if (u && u <= ctx.weekOpen + 12 * 3600e3) {
        leads.push({ kind: "no-change", team: Number(t), owner: owner(t), lastChange: ctx.updateTimes[t],
          text: `${owner(t)} has not changed a lineup since ${chiWhen(u)}, ${chiDay(ctx.weekOpen)} being when the week opened.` });
      }
    }
  }
  // Per-team transaction timelines, and any player who comes and goes more than twice.
  const byTeam = {};
  for (const x of (ctx.tx || []).slice().sort((a, b) => a.t - b.t)) {
    const d = x.detail || {};
    for (const [dir, nm] of [["added", d.addName], ["dropped", d.dropName]]) if (nm) (byTeam[x.team] = byTeam[x.team] || []).push({ t: x.t, who: nm, dir, type: x.type, bid: d.bid });
  }
  for (const [t, ev] of Object.entries(byTeam)) {
    const per = {};
    for (const e of ev) (per[e.who] = per[e.who] || []).push(e);
    for (const [who, es] of Object.entries(per)) {
      if (es.length < 3) continue;
      const adds = es.filter((e) => e.dir === "added").length;
      leads.push({ kind: "tx-loop", team: Number(t), owner: owner(t), player: who, events: es.map((e) => ({ t: e.t, dir: e.dir, type: e.type })), adds,
        text: `${owner(t)} moved ${who} ${es.length} times: ` + es.map((e) => `${e.dir} ${chiWhen(e.t)}`).join(", ") + ` (added ${adds} time${adds === 1 ? "" : "s"}).` });
    }
    if (ev.length >= 4) {
      leads.push({ kind: "tx-timeline", team: Number(t), owner: owner(t), count: ev.length,
        text: `${owner(t)}'s week, by transaction: ` + ev.map((e) => `${e.dir} ${e.who} ${chiWhen(e.t)}${e.bid ? ` ($${e.bid})` : ""}`).join("; ") + "." });
    }
  }
  return leads;
}

// ---------------------------------------------------------------- mechanical drafts
const joinAnd = (xs) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`);
/** "The Rest of the Weekend": every game not yet played that has a starter in it, kickoff order, with
 *  who starts from which team. ctx: { teams, lineups, sched, now, played? } */
export function restOfWeekend(ctx) {
  const lines = [];
  const played = ctx.played || new Set();
  for (const g of ctx.sched || []) {
    if (g.kickoff <= ctx.now) continue;
    const by = {};
    for (const [t, list] of Object.entries(ctx.lineups || {})) {
      for (const p of list.filter(isStarter)) {
        if (played.has(p.key)) continue;
        if (nflAbbr(p.team) === g.away || nflAbbr(p.team) === g.home) (by[t] = by[t] || []).push(playerName(p, ctx.sched));
      }
    }
    if (!Object.keys(by).length) continue;
    const parts = Object.entries(by).map(([t, ps]) => `${joinAnd(ps)} for ${ctx.teams[t] ? ctx.teams[t].short : "team " + t}`);
    lines.push({ kickoff: g.kickoff, away: g.away, home: g.home,
      text: `${g.awayName} at ${g.homeName}, ${chiWhen(g.kickoff)} Central: ${parts.join(", ")}.` });
  }
  return lines;
}
/** Injury Desk skeleton, in the column's "Player (Owner): text" form. A starter with any injury
 *  status; the text is the status and the same-position bench options with kickoff and projection.
 *  The writer adds the body part, the practice report and the voice. */
export function injuryDesk(ctx) {
  const lines = [];
  const projOf = (p) => { const x = ctx.proj && ctx.proj.players && ctx.proj.players[p.key]; return x && typeof x.p === "number" ? x.p : null; };
  const injOf = (p) => String((ctx.injuries && ctx.injuries[p.key]) || p.injury || "");
  for (const [t, list] of Object.entries(ctx.lineups || {})) {
    const bench = list.filter((p) => p.slot === "BENCH");
    for (const s of list.filter(isStarter)) {
      // GFFL zeroes a player it knows is out, so a projection of 0.0 counts when no status came through.
      const inj = injOf(s) || (projOf(s) === 0 ? "projected 0.0 by GFFL" : "");
      if (!inj || /^(healthy|active)$/i.test(inj)) continue;
      const opts = bench.filter((b) => b.pos === s.pos || (s.slot === "FLEX" && ["RB", "WR", "TE"].includes(b.pos)))
        .map((b) => { const g = gameOf(ctx.sched, b.team); return `${playerName(b, ctx.sched)}${g ? ` (${chiWhen(g.kickoff)})` : ""}${projOf(b) != null ? `, proj ${projOf(b)}` : ""}`; });
      const g = gameOf(ctx.sched, s.team);
      lines.push({ team: Number(t), text: `${playerName(s, ctx.sched)} (${ctx.teams[t] ? ctx.teams[t].owner : t}): ${inj.toLowerCase()}${g ? `, plays ${chiWhen(g.kickoff)}` : ""}.` + (opts.length ? ` Bench options: ${opts.join("; ")}.` : "") });
    }
  }
  return lines;
}
/** One series line per game: who leads, the streak and the last meeting. */
export function seriesLine(series, teams) {
  const { a, b, wins, ties } = series;
  const nm = (t) => (teams[t] ? teams[t].owner : `team ${t}`);
  const tail = ties ? `-${ties}` : "";
  const lead = wins[a] === wins[b] ? `${nm(a)} and ${nm(b)} are tied ${wins[a]}-${wins[b]}${tail}.`
    : `${wins[a] > wins[b] ? nm(a) : nm(b)} leads the series ${Math.max(wins[a], wins[b])}-${Math.min(wins[a], wins[b])}${tail}.`;
  const st = series.streak && series.streak.n > 1 ? ` ${nm(series.streak.team)} has won the last ${series.streak.n}.` : "";
  const l = series.last[series.last.length - 1];
  const lm = l ? ` Last meeting: Week ${l.week}, ${l.season}, ${nm(l[a] > l[b] ? a : b)} won ${Math.max(l[a], l[b]).toFixed(1)} to ${Math.min(l[a], l[b]).toFixed(1)}.` : " They have not met.";
  return lead + st + (l && l[a] === l[b] ? ` Last meeting: Week ${l.week}, ${l.season}, a tie at ${l[a].toFixed(1)}.` : lm);
}
/** Thursday-night tallies for a Saturday preview: each game's points so far and who scored them. */
export function thursdayTallies(games, thisWeek, teams) {
  return games.map((g) => {
    const side = (t) => {
      const w = thisWeek && thisWeek[t];
      const who = w ? w.starters.filter((s) => s.pts != null).map((s) => `${s.pos === "DST" ? s.name.replace(/ D\/ST$/, " defense") : s.name} ${s.pts.toFixed(1)}`) : [];
      return `${teams[t].short} ${(w ? w.soFar : 0).toFixed(1)}${who.length ? ` (${who.join(", ")})` : ""}`;
    };
    return { away: g.away, home: g.home, text: `${side(g.away)}, ${side(g.home)}.` };
  });
}
