#!/usr/bin/env node
// tools/robogoat/reads.mjs — who read which RoboGoat column (the private read log).
//
//   node tools/robogoat/reads.mjs                         every issue, newest first
//   node tools/robogoat/reads.mjs robogoat/2026/week-5    one issue
//   node tools/robogoat/reads.mjs --json                  the same, as JSON
//
// Perry, 2026-10-10: "I want to log who actually reads the columns". Private: nothing on the pages
// shows it; this report is pulled when he asks RoboGoat. The log itself is written by
// netlify/functions/rgread.mjs (one `kind: "rgread"` doc per read: issue, via, team, t).
//
// Who it can name: a reader who opened the column from the GFFL app's RoboGoat card (?r=app<team>)
// or from the league push (?r=push<team>). The email link, the archive and a forwarded link carry
// no team, so those reads are counted as "untagged", never guessed at. A team is the phone's
// claimed team, not a person: two people on one phone read as one team.
//
// Read-only: one Firestore query. Times are Chicago time, like the rest of the kit.
"use strict";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, fsKind } from "./lib.mjs";

const fmtTime = (t) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
}).format(new Date(t));

/**
 * Pure: the log rows grouped per issue.
 *   reads   [{ issue, via, team, t }]
 *   issues  [{ path: "2026/week-5-preview/", week, type, teams: { id: { owner } } }], newest first
 * -> [{ issue, label, total, readers: [{ team, owner, count, first, via: [...] }], notYet: [owner], untagged }]
 * Readers are in order of their first read. An issue with no reads is still listed (0 is news too).
 */
export function summarize(reads, issues) {
  const out = [];
  for (const x of issues) {
    const issue = String(x.path).replace(/\/+$/, "");
    const rows = reads.filter((r) => r.issue === issue);
    const teams = x.teams || {};
    const byTeam = new Map();
    let untagged = 0;
    for (const r of rows) {
      const tid = Number(r.team);
      if (r.team == null || !Number.isInteger(tid) || tid < 1) { untagged++; continue; }
      const e = byTeam.get(tid) || { team: tid, owner: (teams[String(tid)] || {}).owner || `team ${tid}`, count: 0, first: Infinity, via: [] };
      e.count++;
      e.first = Math.min(e.first, Number(r.t));
      if (!e.via.includes(r.via)) e.via.push(r.via);
      byTeam.set(tid, e);
    }
    const readers = [...byTeam.values()].sort((a, b) => a.first - b.first);
    const notYet = Object.entries(teams).filter(([id]) => !byTeam.has(Number(id))).map(([, t]) => t.owner);
    out.push({ issue, label: `Week ${x.week} ${x.type === "preview" ? "preview" : "recap"}`, total: rows.length, readers, notYet, untagged });
  }
  return out;
}

/** Pure: the plain-text report. */
export function render(summary) {
  const lines = [];
  for (const s of summary) {
    lines.push(`${s.label} (${s.issue}): ${s.total} read${s.total === 1 ? "" : "s"}`);
    lines.push("  Read it: " + (s.readers.length
      ? s.readers.map((r) => `${r.owner} (${r.via.join(" + ")}${r.count > 1 ? `, ${r.count} times` : ""}, first ${fmtTime(r.first)})`).join("; ")
      : "nobody identified yet"));
    if (s.notYet.length) lines.push("  Not seen: " + s.notYet.join(", "));
    lines.push(`  Untagged (email link, archive, forwarded): ${s.untagged}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const argv = process.argv.slice(2);
  const only = argv.find((a) => !a.startsWith("--"));
  let issues = JSON.parse(readFileSync(join(ROOT, "robogoat/issues.json"), "utf8")).issues;
  if (only) issues = issues.filter((x) => "robogoat/" + x.path.replace(/\/+$/, "") === only.replace(/\/+$/, ""));
  if (!issues.length) { console.error(`no such issue in robogoat/issues.json: ${only}`); process.exit(2); }
  // issues.json has no owners; each issue's own issue.json does.
  issues = issues.map((x) => ({ ...x, teams: JSON.parse(readFileSync(join(ROOT, "robogoat", x.path, "issue.json"), "utf8")).teams }));
  const reads = await fsKind("rgread");
  const summary = summarize(reads, issues);
  if (argv.includes("--json")) console.log(JSON.stringify(summary, null, 2));
  else console.log(render(summary) + `${reads.length} read${reads.length === 1 ? "" : "s"} logged in all.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
