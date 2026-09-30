#!/usr/bin/env node
// tools/robogoat/announce.mjs — the league push for a new RoboGoat issue.
//
//   node tools/robogoat/announce.mjs robogoat/2026/week-4-preview          DRY RUN: prints the push
//   node tools/robogoat/announce.mjs robogoat/2026/week-4-preview --send   sends it
//
// --send is the ONE outbound write in this kit and it wakes every phone in the league, so it runs
// only on Perry's say-so for that issue, and only after the page is live: it first fetches the
// issue's public URL and refuses unless that page is up and carries the issue's own description
// (a push to a 404, or to last week's page, is worse than no push).
//
// It goes through the same notify function the app's own week-final push uses
// (LG.pushWeekRecap in lg-core.js): { gfflAll: true, kind: "recap" }, so a device that muted
// "Week recaps" in the app's notification settings is skipped.
"use strict";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, LG_PASS, FAM_KEY } from "./lib.mjs";
import { attr } from "./build.mjs";

const SITE = "https://goatfantasyleague.com";
const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith("--"));
if (!dir) { console.error("usage: announce.mjs <issue-dir> [--send]"); process.exit(2); }
const issue = JSON.parse(readFileSync(join(ROOT, dir, "issue.json"), "utf8"));
const url = `${SITE}/${dir.replace(/^\/+|\/+$/g, "")}/`;
// Subject "RoboGoat: <hook> (Week N recap)" → title "RoboGoat · Week N recap", body "<hook>".
const m = /^RoboGoat:\s*(.+?)\s*\((Week \d+ (?:recap|preview))\)\s*$/.exec(issue.subject || "");
if (!m) { console.error(`issue.json subject must read "RoboGoat: <hook> (Week N recap|preview)": ${issue.subject}`); process.exit(2); }
const hook = m[1];
const payload = {
  secret: LG_PASS, familyKey: FAM_KEY,
  title: `RoboGoat · ${m[2]}`, body: hook[0].toUpperCase() + hook.slice(1), url,
  gfflAll: true, kind: "recap",
};

if (!argv.includes("--send")) {
  console.log("DRY RUN — nothing sent. Pass --send to push this to every league device:");
  console.log(JSON.stringify({ ...payload, secret: "<LG.PASS>" }, null, 1));
  process.exit(0);
}
const page = await fetch(url, { redirect: "follow" });
const text = page.ok ? await page.text() : "";
const want = `<meta name="description" content="${attr(issue.description)}">`;
if (!page.ok || !text.includes(want)) {
  console.error(`refusing to push: ${url} is ${page.status}${page.ok ? " but is not this issue (its description differs)" : ""}. Is the PR merged and deployed?`);
  process.exit(1);
}
const r = await fetch(`${SITE}/.netlify/functions/notify`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: SITE }, body: JSON.stringify(payload),
});
const out = await r.text();
console.log(`notify HTTP ${r.status}: ${out}`);
if (!r.ok) process.exit(1);
