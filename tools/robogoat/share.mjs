#!/usr/bin/env node
// tools/robogoat/share.mjs — the 1200×630 link-preview image (og:image) for one issue.
//
//   node tools/robogoat/share.mjs robogoat/2026/week-4-preview [--out file.png]
//
// Recap: the week's final scores. Preview: the week's matchups with records and RoboGoat's pick.
// Fonts come from tools/robogoat/fonts (bundled, OFL) and logos from robogoat/logos, both served
// from a throwaway local http server, so the render never depends on the network.
"use strict";

import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve, extname } from "node:path";
import { ROOT, launchBrowser, newPage } from "./lib.mjs";
import { fx, esc } from "./build.mjs";

export function shareHtml(issue) {
  const RECAP = issue.type === "recap";
  const tm = (id) => issue.teams[String(id)];
  const picks = new Set(((issue.picks || [])).map(Number));
  const row = (t, pts, win) => {
    const x = tm(t);
    const right = RECAP ? `<div class="ts">${fx(pts, 1)}</div>`
      : `<div class="rec">${issue.records[t]}${picks.has(t) ? '<i class="pick">Pick</i>' : ""}</div>`;
    return `<div class="tr${win ? " win" : ""}" style="--c:${x.color}"><img src="/robogoat/logos/team-${t}.jpg">` +
      `<div class="tn" data-short="${esc(x.short)}"><span class="nm">${esc(x.name)}</span><span class="ow">${esc(x.owner)}</span></div>${right}</div>`;
  };
  const games = issue.games.map((g) => `<div class="game">${row(g.away, g.awayPts, RECAP && g.awayPts > g.homePts)}${row(g.home, g.homePts, RECAP && g.homePts > g.awayPts)}</div>`).join("");
  const right = RECAP ? `Final scores<br><b>RoboGoat picks: ${issue.picksWeek}</b>` : `Picks record<br><b>${issue.picksRecord}</b>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Bar;src:url(/tools/robogoat/fonts/BarlowCondensed-700.woff2);font-weight:700}
@font-face{font-family:Bar;src:url(/tools/robogoat/fonts/BarlowCondensed-600.woff2);font-weight:600}
@font-face{font-family:Int;src:url(/tools/robogoat/fonts/Inter-400.woff2);font-weight:400}
@font-face{font-family:Int;src:url(/tools/robogoat/fonts/Inter-600.woff2);font-weight:600}
body{margin:0}
#share{width:1200px;height:630px;box-sizing:border-box;background:#fbfaf7;border-top:14px solid #d50a0a;padding:34px 56px 30px;font-family:Int,sans-serif;color:#141414;display:flex;flex-direction:column;overflow:hidden}
.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:4px solid #141414;padding-bottom:14px}
.name{font:700 84px/0.9 Bar,sans-serif;letter-spacing:1px}
.col{font:600 20px Int;letter-spacing:4px;text-transform:uppercase;color:#d50a0a;margin-bottom:8px}
.right{text-align:right;font:600 22px/1.35 Int;color:#555;margin-left:auto;margin-right:18px}
.rg{height:150px;margin:-20px 0 -18px}
.right b{color:#141414}
.grid{flex:1;display:grid;grid-template-columns:1fr 1fr;column-gap:48px;padding-top:14px}
.game{border-bottom:1px solid #dcd8cf;padding:12px 0;min-width:0}
.game:nth-last-child(-n+2){border-bottom:0}
.tr{display:flex;align-items:center;gap:16px;padding:6px 0 6px 12px;border-left:8px solid var(--c)}
.tr img{width:56px;height:56px;border-radius:50%;box-shadow:0 0 0 3px #fbfaf7,0 0 0 4px #dcd8cf;flex:none}
.tn{flex:1;min-width:0;font:700 30px/1 Bar;text-transform:uppercase;color:${RECAP ? "#8a8883" : "#141414"}}
.tn .nm{display:block;white-space:nowrap;overflow:hidden}
.tn .ow{display:block;font:400 18px Int;text-transform:none;margin-top:3px}
.ts{font:700 44px/1 Bar;color:#8a8883}
.rec{font:700 34px/1 Bar;color:#141414;text-align:right}
.pick{display:block;font:600 14px Int;font-style:normal;letter-spacing:2px;text-transform:uppercase;color:#d50a0a;margin-top:4px}
.win .tn,.win .ts{color:#141414}
</style></head><body>
<div id="share"><div class="top">
<div><div class="col">RoboGoat · Week ${issue.week} ${RECAP ? "Recap" : "Preview"}</div><div class="name">THE GFFL</div></div>
<div class="right">${right}</div><img class="rg" src="/robogoat/robogoat.png"></div>
<div class="grid">${games}</div></div>
</body></html>`;
}

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".html": "text/html; charset=utf-8" };
export async function renderShare(dir, out) {
  const issue = JSON.parse(readFileSync(join(ROOT, dir, "issue.json"), "utf8"));
  const html = shareHtml(issue);
  const srv = createServer((q, r) => {
    const u = decodeURIComponent(q.url.split("?")[0]);
    if (u === "/share.html") { r.writeHead(200, { "content-type": TYPES[".html"] }); return r.end(html); }
    const f = resolve(ROOT, "." + u);
    if (!f.startsWith(ROOT) || !/^\/(robogoat|tools\/robogoat\/fonts)\//.test(u) || !existsSync(f)) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" });
    r.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const h = await launchBrowser();
  try {
    const p = await newPage(h, { width: 1200, height: 630, deviceScaleFactor: 1 });
    await p.goto(`http://127.0.0.1:${srv.address().port}/share.html`);
    await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    // Measured only once the bundled fonts are in: a long team name that would clip falls back
    // to its short name (Scruffy Looking Nerfherders → Nerfherders).
    await p.evaluate(async () => {
      await document.fonts.ready;
      for (const tn of document.querySelectorAll(".tn")) { const nm = tn.querySelector(".nm"); if (nm.scrollWidth > nm.clientWidth + 1) nm.textContent = tn.dataset.short; }
    });
    const el = await p.$("#share");
    await el.screenshot({ path: out });
  } finally { await h.browser.close(); srv.close(); }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("share.mjs")) {
  const argv = process.argv.slice(2);
  const dir = argv.find((a) => !a.startsWith("--"));
  const oi = argv.indexOf("--out");
  if (!dir) { console.error("usage: share.mjs <issue-dir> [--out file.png]"); process.exit(2); }
  const out = oi >= 0 ? resolve(argv[oi + 1]) : join(ROOT, dir, "share.png");
  console.log("wrote " + (await renderShare(dir, out)));
}
