#!/usr/bin/env node
// tools/robogoat/archive.mjs — the archive page (robogoat/index.html, served at
// goatfantasyleague.com/robogoat/) and its machine-readable twin robogoat/issues.json.
//
//   node tools/robogoat/archive.mjs            write both
//   node tools/robogoat/archive.mjs --check    exit 1 if either is stale
//
// Both are derived from every issue directory's issue.json + column.md, newest first. Run it after
// every build; the suite fails if the archive does not list an issue that exists.
"use strict";

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";
import { listIssues, esc, attr, typo, longDate } from "./build.mjs";

export function archive() {
  const issues = listIssues().map((dir) => {
    const issue = JSON.parse(readFileSync(join(ROOT, dir, "issue.json"), "utf8"));
    const md = readFileSync(join(ROOT, dir, "column.md"), "utf8");
    const sub = (/^SUBHEAD:\s*(.*)$/m.exec(md) || [, ""])[1].split("·").slice(1).join("·").trim();
    return {
      season: issue.season, week: issue.week, type: issue.type,
      path: dir.replace(/^robogoat\//, "") + "/",
      published: issue.published, headline: sub, description: issue.description, subject: issue.subject,
      share: existsSync(join(ROOT, dir, "share.png")) ? dir.replace(/^robogoat\//, "") + "/share.png" : null,
    };
  }).sort((a, b) => b.published.localeCompare(a.published) || b.week - a.week || (a.type === "recap" ? -1 : 1));
  const json = JSON.stringify({ issues }, null, 1) + "\n";

  const cards = issues.map((x, i) => {
    const label = `Week ${x.week} ${x.type === "recap" ? "recap" : "preview"}`;
    const img = x.share ? `<img src="${attr(x.share)}" alt="" width="1200" height="630"${i > 1 ? ' loading="lazy"' : ""}>` : "";
    return `<li><a class="issue" href="${attr(x.path)}">${img}<span class="meta">${label} · ${esc(longDate(x.published))}</span>` +
      `<b>${typo(x.headline)}</b><span class="dsc">${typo(x.description)}</span></a></li>`;
  }).join("\n");
  const css = `
:root{--paper:#fbfaf7;--page:#ecebe6;--ink:#141414;--ink2:#3f3f3f;--mut:#6b6a66;--rule:#dcd8cf;--red:#d50a0a;--navy:#013369;
--hed:"Barlow Condensed","Arial Narrow",Arial,sans-serif;--ser:"Source Serif 4",Georgia,"Times New Roman",serif;--ui:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--ink);font:17px/1.55 var(--ser)}
.wrap{max-width:720px;margin:0 auto;background:var(--paper);min-height:100vh;box-shadow:0 0 0 1px var(--rule)}
header.mast{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;padding:18px 20px 0;border-top:6px solid var(--red);border-bottom:3px solid var(--ink);background:linear-gradient(180deg,#fbfaf7 55%,#eef1f6)}
.mt{padding-bottom:18px;min-width:0}
img.robogoat{display:block;height:150px;width:auto;flex:none;margin-bottom:-1px}
.mast .league{font:600 12px/1.2 var(--ui);letter-spacing:.18em;text-transform:uppercase;color:var(--mut)}
.mast .name{font:700 52px/1 var(--hed);letter-spacing:.02em;margin:6px 0 2px}
.mast .col{font:600 13px/1.4 var(--ui);letter-spacing:.12em;text-transform:uppercase;color:var(--red)}
main{padding:8px 20px 28px}
ol.issues{list-style:none;margin:0;padding:0}
.issues li{border-top:1px solid var(--rule);padding:20px 0}
.issues li:first-child{border-top:0}
a.issue{display:block;color:inherit;text-decoration:none}
a.issue img{display:block;width:100%;height:auto;aspect-ratio:1200/630;border:1px solid var(--rule);margin-bottom:10px;background:#fff}
.meta{display:block;font:700 12px/1.3 var(--ui);letter-spacing:.14em;text-transform:uppercase;color:var(--red)}
a.issue b{display:block;font:700 30px/1.05 var(--hed);text-transform:uppercase;margin:6px 0 6px}
a.issue:hover b{color:var(--navy);text-decoration:underline;text-decoration-thickness:2px}
.dsc{display:block;color:var(--ink2)}
.nw{white-space:nowrap}
footer{border-top:1px solid var(--rule);padding:16px 20px 28px;font:13px/1.5 var(--ui);color:var(--mut);text-align:center}
footer a{color:var(--navy)}
@media (max-width:420px){.mast .name{font-size:44px}img.robogoat{height:128px}.mast .league{font-size:11px;letter-spacing:.1em}a.issue b{font-size:26px}}
`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RoboGoat · GFFL</title>
<meta name="description" content="Every RoboGoat preview and recap for the Goat Fantasy Football League.">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#013369">
<meta property="og:type" content="website">
<meta property="og:site_name" content="RoboGoat · GFFL">
<meta property="og:url" content="https://goatfantasyleague.com/robogoat/">
<meta property="og:title" content="RoboGoat · GFFL">
<meta property="og:description" content="Every RoboGoat preview and recap for the Goat Fantasy Football League.">
${issues[0] && issues[0].share ? `<meta property="og:image" content="https://goatfantasyleague.com/robogoat/${issues[0].share}">\n<meta name="twitter:card" content="summary_large_image">\n` : ""}<link rel="icon" href="/icons/gffl-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;600;700&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div class="wrap">
<header class="mast">
<div class="mt">
<div class="league">Goat Fantasy Football League</div>
<div class="name">ROBOGOAT</div>
<div class="col">Every preview and recap</div>
</div>
<img class="robogoat" src="robogoat.png" alt="RoboGoat" width="228" height="278">
</header>
<main>
<ol class="issues">
${cards}
</ol>
</main>
<footer><a href="../league.html">Back to the GFFL app</a> · <a href="https://goatfantasyleague.com/">goatfantasyleague.com</a></footer>
</div>
</body>
</html>
`;
  return { json, html, issues };
}

if (process.argv[1] && process.argv[1].endsWith("archive.mjs")) {
  const { json, html, issues } = archive();
  const files = [[join(ROOT, "robogoat/issues.json"), json], [join(ROOT, "robogoat/index.html"), html]];
  if (process.argv.includes("--check")) {
    let stale = 0;
    for (const [f, s] of files) { const cur = existsSync(f) ? readFileSync(f, "utf8") : ""; if (cur !== s) { stale++; console.log("STALE " + f); } }
    if (stale) process.exit(1);
    console.log(`ok    archive lists ${issues.length} issue(s)`);
  } else {
    for (const [f, s] of files) writeFileSync(f, s);
    console.log(`wrote robogoat/index.html and robogoat/issues.json (${issues.length} issue(s))`);
  }
}
