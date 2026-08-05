// _probe-sports.mjs — POST-DEPLOY live probe for the NFL sports feature.
//
//   node tools/_probe-sports.mjs                # hit ESPN's real API directly
//   node tools/_probe-sports.mjs --site https://amenfarms.netlify.app
//                                               # ALSO probe the deployed sports.mjs
//
// ESPN's hosts are egress-blocked from the Claude dev sandbox, so the suite's
// fixtures (tools/_sports_fixtures.cjs) were authored from the documented shapes
// rather than captured live. THIS script is the other half of that bargain: run it
// from a normal machine after deploy. It fetches the real scoreboard + one real
// game summary, checks every field the app actually reads, and prints timings.
// Anything it flags is fixture drift — fix sports.mjs's slimmer (it's defensive,
// so drift degrades to missing UI sections, never a crash).
"use strict";

const SITE = (() => {
  const i = process.argv.indexOf("--site");
  return i >= 0 ? process.argv[i + 1].replace(/\/$/, "") : null;
})();
const SECRET = process.env.BUCKY_SECRET || "amenfarms";
// Same UA the server uses: ESPN's edge 403s browser UAs from datacenter IPs but
// allows curl (measured 2026-08-05 — see sports.mjs NFL_UA).
const UA = "curl/8.6.0";

let flagged = 0;
function has(obj, pathStr) {
  let o = obj;
  for (const k of pathStr.split(".")) {
    if (o == null) return false;
    o = /^\d+$/.test(k) ? o[Number(k)] : o[k];
  }
  return o !== undefined && o !== null;
}
function check(obj, pathStr, label) {
  const okv = has(obj, pathStr);
  console.log(`  ${okv ? "✓" : "⚠ MISSING"}  ${label || pathStr}`);
  if (!okv) flagged++;
  return okv;
}
async function timed(label, fn) {
  const t0 = Date.now();
  const out = await fn();
  console.log(`  ⏱ ${label}: ${Date.now() - t0}ms`);
  return out;
}

async function probeEspnDirect() {
  console.log("\n== ESPN site API, direct ==");
  const sb = await timed("scoreboard", async () => {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard", {
      headers: { "User-Agent": UA, accept: "application/json" },
    });
    console.log(`  scoreboard HTTP ${r.status}`);
    return r.json();
  });

  console.log(`  season ${sb?.season?.year} type ${sb?.season?.type}, week ${sb?.week?.number}, ${sb?.events?.length ?? 0} events`);
  check(sb, "leagues.0.calendar.0.entries.0.label", "calendar entries (week picker)");
  check(sb, "events.0.id");
  check(sb, "events.0.date");
  check(sb, "events.0.competitions.0.competitors.0.team.abbreviation");
  check(sb, "events.0.competitions.0.competitors.0.team.shortDisplayName");
  check(sb, "events.0.competitions.0.competitors.0.team.logo");
  check(sb, "events.0.competitions.0.competitors.0.homeAway");
  check(sb, "events.0.competitions.0.status.type.state");
  check(sb, "events.0.status.type.shortDetail");
  checkProTeamMap(sb);

  const events = sb?.events || [];
  const live = events.find((e) => e?.status?.type?.state === "in");
  if (live) {
    console.log(`  LIVE now: ${live.shortName} — checking the live situation`);
    check(live, "competitions.0.situation.possession", "situation.possession (possession marker)");
    check(live, "competitions.0.situation.shortDownDistanceText", "situation down & distance");
    check(live, "competitions.0.situation.lastPlay.text", "situation last play");
  } else {
    console.log("  (no live game right now — situation fields unverified; re-run during a game)");
  }

  const pick = live || events[0];
  if (!pick) { console.log("  ⚠ no events at all — is it deep offseason?"); return; }

  const gm = await timed("summary " + pick.shortName, async () => {
    const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=" + pick.id, {
      headers: { "User-Agent": UA, accept: "application/json" },
    });
    console.log(`  summary HTTP ${r.status}`);
    return r.json();
  });
  check(gm, "header.competitions.0.competitors.0.team.abbreviation");
  check(gm, "header.competitions.0.status.type.state");
  check(gm, "gameInfo.venue.fullName");
  const state = gm?.header?.competitions?.[0]?.status?.type?.state;
  if (state === "pre") {
    console.log("  (pregame — drives/boxscore legitimately absent; re-run during a game for the full check)");
  } else {
    check(gm, "drives.previous.0.team.abbreviation", "previous drives");
    check(gm, "drives.previous.0.displayResult", "drive results");
    check(gm, "boxscore.teams.0.statistics.0.name", "team stats (named, for the stat bars)");
    check(gm, "boxscore.players.0.statistics.0.labels.0", "player stat groups");
    check(gm, "scoringPlays.0.text", "scoring plays");
    check(gm, "winprobability.0.homeWinPercentage", "win probability series");
    check(gm, "header.competitions.0.competitors.0.linescores.0.displayValue", "linescores");
  }
  if (state === "in") {
    console.log("  LIVE — checking the field-visual inputs:");
    check(gm, "drives.current.team.id", "current drive team (possession)");
    check(gm, "drives.current.start.yardsToEndzone", "drive start spot (drive band)");
    const plays = gm?.drives?.current?.plays || [];
    const last = plays[plays.length - 1];
    console.log(`  current drive has ${plays.length} plays`);
    check(last, "end.yardsToEndzone", "last play end spot (BALL MARKER — the field visual's anchor)");
    check(last, "end.shortDownDistanceText", "derived down & distance");
    check(last, "text", "last play text");
  }
}

// Must match sports.mjs's PRO_ABBREV (the fantasy join keys on these ids) — this
// probe cross-checks the map against the ids ESPN's own scoreboard reports.
const PRO_ABBREV = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
  9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
  17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
  25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};
function checkProTeamMap(sb) {
  let bad = 0, seen = 0;
  for (const ev of (sb?.events || [])) {
    for (const c of (ev?.competitions?.[0]?.competitors || [])) {
      const id = Number(c?.id ?? c?.team?.id);
      const ab = c?.team?.abbreviation;
      if (!id || !ab) continue;
      seen++;
      if (PRO_ABBREV[id] && PRO_ABBREV[id] !== ab) {
        console.log(`  ⚠ PRO_ABBREV drift: id ${id} is ${ab} on the scoreboard, map says ${PRO_ABBREV[id]}`);
        bad++; flagged++;
      }
    }
  }
  console.log(`  ${bad ? "⚠" : "✓"}  pro-team id map vs the scoreboard's own ids (${seen} teams this week, ${bad} mismatches)`);
}

async function probeDeployedFunction() {
  console.log("\n== deployed sports.mjs at " + SITE + " ==");
  async function call(body) {
    const t0 = Date.now();
    const r = await fetch(SITE + "/.netlify/functions/sports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ secret: SECRET }, body)),
    });
    const j = await r.json().catch(() => null);
    console.log(`  ${body.action} → HTTP ${r.status} in ${Date.now() - t0}ms, ${JSON.stringify(j)?.length ?? 0} bytes`);
    return j;
  }
  const sb = await call({ action: "nfl_scoreboard" });
  if (!sb || sb.ok !== true) { console.log("  ⚠ scoreboard failed: " + JSON.stringify(sb).slice(0, 200)); flagged++; return; }
  console.log(`  ok — week ${sb.week}, ${sb.events.length} events, ${sb.calendar.length} calendar groups`);
  check(sb, "events.0.teams.0.abbrev");
  check(sb, "events.0.status.state");
  // Informational — lines legitimately come and go (offseason, closed markets).
  const withSpread = sb.events.filter((e) => e.spread).length;
  console.log(`  ${withSpread}/${sb.events.length} events carry a betting line (spread)`);
  const ev = sb.events.find((e) => e.status.state === "in") || sb.events[0];
  if (ev) {
    const gm = await call({ action: "nfl_game", eventId: ev.id });
    if (!gm || gm.ok !== true) { console.log("  ⚠ game failed: " + JSON.stringify(gm).slice(0, 200)); flagged++; }
    else {
      console.log(`  ok — ${gm.teams.map((t) => t.abbrev + " " + t.score).join(" · ")} (${gm.status.detail})`);
      if (gm.status.state === "in") {
        check(gm, "situation.yardsToEndzone", "derived situation (field visual)");
        check(gm, "drives.current.plays.0.text", "current drive plays");
      }
    }
  }

  // College football through the same proxy.
  const cs = await call({ action: "ncaa_scoreboard" });
  if (!cs || cs.ok !== true) { console.log("  ⚠ ncaa_scoreboard failed: " + JSON.stringify(cs).slice(0, 200)); flagged++; }
  else {
    const ranked = cs.events.filter((e) => e.teams.some((t) => t.rank));
    console.log(`  ok — college week ${cs.week}, ${cs.events.length} events, ${ranked.length} with a ranked team`);
    if (cs.events.length && !ranked.length) { console.log("  ⚠ no curatedRank anywhere — the Top 25 filter would show nothing"); flagged++; }
    const sec = await call({ action: "ncaa_scoreboard", group: 8 });
    if (!sec || sec.ok !== true) { console.log("  ⚠ groups=8 (SEC) failed: " + JSON.stringify(sec).slice(0, 160)); flagged++; }
    else console.log(`  ok — SEC slate: ${sec.events.length} events`);
    const cev = cs.events[0];
    if (cev) {
      const cg = await call({ action: "ncaa_game", eventId: cev.id });
      if (!cg || cg.ok !== true) { console.log("  ⚠ ncaa_game failed: " + JSON.stringify(cg).slice(0, 160)); flagged++; }
      else console.log(`  ok — ${cg.teams.map((t) => t.abbrev + " " + t.score).join(" · ")} (${cg.status.detail})`);
    }
  }

  // Fantasy: the private league through the deployed cookies.
  const lg = await call({ action: "ff_league" });
  if (lg && lg.ok === false && lg.reason === "fantasy-not-configured") {
    console.log("  🔧 fantasy not configured yet — add ESPN_S2 + ESPN_SWID env vars in Netlify and redeploy.");
  } else if (lg && lg.ok === false && lg.reason === "fantasy-auth-expired") {
    console.log("  ⚠ fantasy cookies rejected by ESPN — refresh espn_s2 from a logged-in browser."); flagged++;
  } else if (!lg || lg.ok !== true) {
    console.log("  ⚠ ff_league failed: " + JSON.stringify(lg).slice(0, 200)); flagged++;
  } else {
    console.log(`  ok — "${lg.leagueName}" (${lg.teams.length} teams, week ${lg.week}), family team id ${lg.familyTeamId}`);
    if (lg.familyTeamId == null) { console.log("  ⚠ no team named like \"battle kreussers\" — check the team name in the league."); flagged++; }
    // Per-user teams the app follows — each must resolve to a real team id.
    for (const name of ["The Goat Kids", "Wyoming Cowboys"]) {
      const t = await call({ action: "ff_league", teamName: name });
      if (!t || !t.ok || t.familyTeamId == null) { console.log(`  ⚠ teamName "${name}" didn't resolve — check the name in the league.`); flagged++; }
      else console.log(`  ok — "${name}" → team id ${t.familyTeamId}`);
    }
    const fsb = await call({ action: "ff_scoreboard" });
    if (!fsb || !fsb.ok) { console.log("  ⚠ ff_scoreboard failed: " + JSON.stringify(fsb).slice(0, 160)); flagged++; }
    else console.log(`  ok — week ${fsb.week} scoreboard: ${fsb.matchups.length} matchups (8 teams → expect 4 in season)`);
    const fm = await call({ action: "ff_matchup" });
    if (fm && fm.ok && fm.matchup) {
      console.log(`  ok — ${fm.matchup.home.name} ${fm.matchup.home.points} vs ${fm.matchup.away.points} ${fm.matchup.away.name}`);
      check(fm, "matchup.home.roster.0.name", "lineup entries");
      check(fm, "matchup.home.roster.0.proj", "player projections");
    } else if (fm && fm.ok) {
      console.log("  (no matchup this week — pre-draft/offseason is fine)");
    } else { console.log("  ⚠ ff_matchup failed: " + JSON.stringify(fm).slice(0, 200)); flagged++; }
  }
}

(async () => {
  try {
    await probeEspnDirect();
  } catch (e) {
    console.log("  ⚠ direct ESPN probe failed outright: " + e.message);
    console.log("    (from the Claude sandbox this is expected — ESPN is egress-blocked; run from a normal machine)");
    flagged++;
  }
  if (SITE) {
    try { await probeDeployedFunction(); }
    catch (e) { console.log("  ⚠ deployed probe failed: " + e.message); flagged++; }
  }
  console.log("\n" + (flagged ? `⚠ ${flagged} item(s) flagged — compare against tools/_sports_fixtures.cjs and adjust the slimmer.` : "✓ all shapes match what the app reads."));
  process.exit(flagged ? 1 : 0);
})();
