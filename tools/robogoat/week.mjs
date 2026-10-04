#!/usr/bin/env node
// tools/robogoat/week.mjs — the one command for a RoboGoat week. READ-ONLY against the league.
//
//   node tools/robogoat/week.mjs --week 5 --type preview --work $SP/w5
//   node tools/robogoat/week.mjs --week 5 --type recap   --work $SP/w5
//   run it again just before building: it prints what changed in the lineups since the last run.
//
// What it does, so nobody does it by hand:
//   1. --since is the start of the newest issue's day in robogoat/issues.json (the last column);
//   2. runs facts.mjs into <work>/kit with that --since and the season file (week numbers, pick
//      results and pairings are filled from the scores; see facts.mjs);
//   3. a preview's lineups are snapshotted to <work>/lineups.<time>.json and lineups.latest.json,
//      and on a re-run the keyed diff against the previous snapshot is printed, by team, player and
//      slot (snapshots are key-sorted, so key order never shows up as a change);
//   4. prints where the leads (joke candidates), the mechanical drafts and the skeleton are.
// --from-facts FILE skips the pull and reads an existing facts file (used by the suite).
"use strict";

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib.mjs";
import { snapshotLineups, diffLineups, formatLineupDiff, sinceDefault } from "./analysis.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const SEASON = Number(arg("--season", "2026"));
const WEEK = Number(arg("--week"));
const TYPE = arg("--type", "recap");
const WORK = resolve(arg("--work", join(ROOT, "shots", "robogoat", TYPE === "recap" ? `week-${WEEK}` : `week-${WEEK}-preview`)));
if (!WEEK || !["recap", "preview"].includes(TYPE)) {
  console.error("usage: week.mjs --week N --type recap|preview [--season 2026] [--work DIR] [--from-facts FILE] [--now ISO]");
  process.exit(2);
}
mkdirSync(WORK, { recursive: true });

const NOW = arg("--now") ? Date.parse(arg("--now")) : Date.now();
let since = null;
try { since = new Date(sinceDefault(JSON.parse(readFileSync(join(ROOT, "robogoat/issues.json"), "utf8")).issues, NOW)).toISOString(); } catch (e) {}
console.log(`since: ${since || "(no issues.json; facts.mjs will use 7 days)"}`);

let factsFile = arg("--from-facts");
if (!factsFile) {
  const kit = join(WORK, "kit");
  const args = [join(ROOT, "tools/robogoat/facts.mjs"), "--season", String(SEASON), "--week", String(WEEK), "--type", TYPE, "--out", kit,
    "--season-file", `robogoat/${SEASON}/season.json`, ...(since ? ["--since", since] : []), ...(arg("--now") ? ["--now", arg("--now")] : [])];
  const out = execFileSync(process.execPath, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 64 << 20 });
  process.stdout.write(out);
  factsFile = join(kit, `facts-${SEASON}-w${WEEK}-${TYPE}.json`);
}
const facts = JSON.parse(readFileSync(factsFile, "utf8"));

if (facts.lineups) {
  const snap = { pulledAt: facts.pulledAt, rosterMeta: facts.rosterMeta || {}, lineups: snapshotLineups(facts.lineups) };
  const latest = join(WORK, "lineups.latest.json");
  if (existsSync(latest)) {
    const prev = JSON.parse(readFileSync(latest, "utf8"));
    console.log(`\nLineup changes since the ${prev.pulledAt} pull:`);
    for (const l of formatLineupDiff(diffLineups(prev.lineups, snap.lineups), facts.teams)) console.log("  " + l);
    const touched = Object.keys(snap.rosterMeta).filter((t) => (prev.rosterMeta || {})[t] !== snap.rosterMeta[t]);
    if (touched.length) console.log("  roster docs written since: " + touched.map((t) => `${facts.teams[t].owner} (${snap.rosterMeta[t]})`).join(", "));
  } else console.log("\nFirst pull for this week: lineups snapshotted. Run again just before building to see what changed.");
  const stamp = facts.pulledAt.replace(/[:.]/g, "-");
  writeFileSync(join(WORK, `lineups.${stamp}.json`), JSON.stringify(snap, null, 1));
  writeFileSync(latest, JSON.stringify(snap, null, 1));
}

console.log(`\nfacts:    ${factsFile}`);
const dir = resolve(factsFile, "..");
if (facts.leads) console.log(`leads:    ${join(dir, "leads.md")} (${facts.leads.length} joke candidates; check each against the facts before using it)`);
if (facts.drafts && Object.keys(facts.drafts).length) console.log(`drafts:   ${join(dir, "drafts.md")} (${Object.keys(facts.drafts).join(", ")}; edit for voice, the numbers are done)`);
console.log(`skeleton: ${join(dir, "issue.skeleton.json")}`);
if ((facts.newAnomalies || []).length) console.log(`\n${facts.newAnomalies.length} NEW scorer anomaly(ies): ${facts.newAnomalies.map((a) => `week ${a.week}: ${a.line}`).join(" | ")}`);
