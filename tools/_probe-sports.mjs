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
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

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
