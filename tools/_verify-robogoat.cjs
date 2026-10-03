#!/usr/bin/env node
// tools/_verify-robogoat.cjs — the RoboGoat newsletter pages (robogoat/<season>/week-<n>[-preview]/),
// the archive (robogoat/index.html + issues.json) and the kit that builds them (tools/robogoat/).
//
// Static pages the league is emailed a link to. What this guards, and why each check exists:
//   * phone first: no horizontal scroll at 360/390 px, and the win-probability chart swaps to its
//     phone-sized SVG (the desktop one scaled to ~8px type on a phone);
//   * numbers: one decimal unless the second one decides something (user, 2026-09-29) — the only
//     two-decimal values allowed are the ones an issue lists in issue.json allowTwoDecimals;
//   * names: owners by first name; Laws Rule is Sandy, never "Mom" outside a verbatim chat quote;
//     matchups read "Joe versus Calvin", never "Joe at Calvin"; the app is "GFFL", never "the app";
//   * every page rebuilds byte-identical from its sources (column.md, issue.json, wp.json,
//     season.json) — a hand edit to index.html, or a source edit never built, fails here;
//   * the archive lists every issue and every link on it resolves;
//   * Week 3, hand-computed here from the app's weekly totals (not read back from the page):
//     scoreboard, standings, bench bars, the season panel, and the power-ranking arrows;
//   * the link preview (og:image) exists at 1200×630, and the pages stay out of search engines.
// External requests (Google Fonts, ESPN headshots) are blocked: the pages must lay out on fallbacks.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { execSync } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const W3 = "robogoat/2026/week-3";

// ---- browser: puppeteer-core (family PC) or Playwright (cloud container) ----
function loadDriver() {
  try { return { kind: "puppeteer", lib: require("puppeteer-core") }; } catch (e) {}
  try { return { kind: "playwright", lib: require("playwright").chromium }; } catch (e) {}
  try {
    const g = execSync("npm root -g").toString().trim();
    return { kind: "playwright", lib: require(path.join(g, "playwright")).chromium };
  } catch (e) {}
  throw new Error("need puppeteer-core or playwright");
}
function chromeExe() {
  for (const c of [process.env.BUCKY_CHROME, "/opt/pw-browsers/chromium"]) if (c && fs.existsSync(c)) return c;
  return null;
}
async function openPage(drv, browser, vw, url, errs) {
  let page;
  if (drv.kind === "puppeteer") {
    page = await browser.newPage();
    await page.setViewport(vw);
    await page.setRequestInterception(true);
    page.on("request", (r) => (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(r.url()) || r.url().startsWith("data:") ? r.continue() : r.abort()));
  } else {
    page = await browser.newPage({ viewport: vw });
    await page.route("**/*", (r) => (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(r.request().url()) ? r.continue() : r.abort()));
  }
  page.on("pageerror", (e) => errs.push(String(e.message || e)));
  await page.goto(url, { waitUntil: drv.kind === "puppeteer" ? "networkidle0" : "networkidle" });
  return page;
}

// ---- tiny static server over the repo ----
const MIME = { ".html": "text/html; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".css": "text/css", ".json": "application/json" };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((q, r) => {
      let f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]));
      if (f.endsWith(path.sep) || f.endsWith("/")) f = path.join(f, "index.html");
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end("nope"); }
      r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
      r.end(fs.readFileSync(f));
    }).listen(0, "127.0.0.1", () => res(srv));
  });
}
const status = (url) => new Promise((res) => http.get(url, (r) => { r.resume(); res(r.statusCode); }).on("error", () => res(0)));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? "  -> " + detail : "")); }
}
const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const pngSize = (f) => { const b = fs.readFileSync(f); return b.readUInt32BE(0) === 0x89504e47 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };

// ---- Week 3, hand-entered from the app (weekly_2026_w1..w3), never read from the page ----
const WEEKLY = {
  "Battle Kreussers": [125.10, 97.08, 175.50], "Elanikan Skywalkers": [121.20, 116.38, 125.58],
  "Wyoming Cowboys": [158.30, 136.44, 120.08], "Chula Vista Jaguarrams": [162.22, 76.96, 112.22],
  "Laws Rule": [128.36, 151.82, 123.26], "Scruffy Looking Nerfherders": [165.26, 151.82, 148.98],
  "Kruz Control": [132.56, 124.80, 105.54], "The GOAT Kids": [120.66, 149.48, 132.18],
};
const WINS = { "Battle Kreussers": 2, "Elanikan Skywalkers": 1, "Wyoming Cowboys": 1, "Chula Vista Jaguarrams": 1,
  "Laws Rule": 2, "Scruffy Looking Nerfherders": 2, "Kruz Control": 2, "The GOAT Kids": 1 };
const OWNER_OF = { "Battle Kreussers": "Perry", "Elanikan Skywalkers": "Elan", "Wyoming Cowboys": "Joe", "Chula Vista Jaguarrams": "Tom",
  "Laws Rule": "Sandy", "Scruffy Looking Nerfherders": "John", "Kruz Control": "Calvin", "The GOAT Kids": "Isaac" };
const OWNERS = ["Perry", "John", "Calvin", "Sandy", "Isaac", "Tom", "Elan", "Joe"];
const GAMES = [["Battle Kreussers", 175.50, "Scruffy Looking Nerfherders", 148.98], ["Kruz Control", 105.54, "Laws Rule", 123.26],
  ["The GOAT Kids", 132.18, "Chula Vista Jaguarrams", 112.22], ["Elanikan Skywalkers", 125.58, "Wyoming Cowboys", 120.08]];
const BENCH = [44.80, 42.00, 40.22, 30.14, 23.30, 23.00, 6.90, 6.86];
// The app's own bench-blunder award (weekly_2026_wN.awards.benchBlunder): the week's biggest
// bench-left, by the app's finalize-time numbers.
const APP_BENCH_BLUNDER = { 1: ["Perry", 47.22], 2: ["Elan", 47.78], 3: ["Elan", 44.8] };
// RoboGoat's power rankings as published: Week 2 (the Week 2 recap email) and Week 3 (this page).
const RANK_W2 = ["John", "Calvin", "Sandy", "Isaac", "Elan", "Perry", "Joe", "Tom"];
const RANK_W3 = ["John", "Perry", "Sandy", "Calvin", "Isaac", "Joe", "Elan", "Tom"];
// RoboGoat's picks: Week 2 preview (Calvin, John, Sandy won; Tom lost), Week 3 preview (all four won).
const PICKS = { 2: "3-1", 3: "4-0" };

(async () => {
  const kit = await import(pathToFileURL(path.join(ROOT, "tools/robogoat/build.mjs")).href);
  const arc = await import(pathToFileURL(path.join(ROOT, "tools/robogoat/archive.mjs")).href);
  const ISSUES = kit.listIssues();

  // ---- the kit's number formatting matches the Python builder it replaced (ties to even) ----
  const fx = kit.fx;
  const cases = [[0.25, 1, "0.2"], [0.75, 1, "0.8"], [123.25, 1, "123.2"], [2.5, 0, "2"], [-0.25, 1, "-0.2"], [1.005, 2, "1.00"],
    [148.98, 1, "149.0"], [6.9, 2, "6.90"], [0.46 / 50, 4, "0.0092"]];
  check("fx() rounds like Python's format (ties to even, on the binary value)", cases.every(([x, d, w]) => fx(x, d) === w),
    cases.map(([x, d, w]) => `${x}:${fx(x, d)}/${w}`).join(" "));

  check("at least one issue exists, and Week 3 is one of them", ISSUES.includes(W3), ISSUES.join(", "));

  // ---- static checks, every issue ----
  const meta = {};
  for (const dir of ISSUES) {
    const issue = JSON.parse(fs.readFileSync(path.join(ROOT, dir, "issue.json"), "utf8"));
    meta[dir] = issue;
    const file = path.join(ROOT, dir, "index.html");
    const html = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    check(`${dir}: index.html exists`, !!html);
    let rebuilt = "";
    try { rebuilt = kit.buildIssue(dir).page; } catch (e) { rebuilt = "BUILD ERROR " + e.message; }
    check(`${dir}: rebuilds byte-identical from column.md + issue.json + season.json (no hand edits, nothing unbuilt)`,
      rebuilt === html, rebuilt.startsWith("BUILD ERROR") ? rebuilt : "run: node tools/robogoat/build.mjs " + dir);
    const og = (html.match(/property="og:image" content="([^"]+)"/) || [])[1] || "";
    check(`${dir}: og:image is its own share.png on goatfantasyleague.com`, og === `https://goatfantasyleague.com/${dir}/share.png`, og);
    const png = path.join(ROOT, dir, "share.png");
    const sz = fs.existsSync(png) ? pngSize(png) : null;
    check(`${dir}: share.png is in the repo at 1200×630`, !!sz && sz[0] === 1200 && sz[1] === 630, JSON.stringify(sz));
    check(`${dir}: noindex (family names stay out of search engines)`, /<meta name="robots" content="noindex">/.test(html));
    check(`${dir}: viewport meta for phones`, /<meta name="viewport" content="width=device-width,initial-scale=1">/.test(html));
    check(`${dir}: no script tags (static page)`, !/<script\b/i.test(html));
    // Subject lines carry a hook (user, 2026-09-29): "RoboGoat: <hook> (Week N recap|preview)",
    // short enough that a phone's inbox shows the hook, never a generic "Week N Recap".
    const sm = /^RoboGoat: (.+) \(Week (\d+) (recap|preview)\)$/.exec(issue.subject || "");
    check(`${dir}: subject reads "RoboGoat: <hook> (Week ${issue.week} ${issue.type})", at most 72 characters`,
      !!sm && Number(sm[2]) === issue.week && sm[3] === issue.type && issue.subject.length <= 72 && !/^(week|recap|preview)\b/i.test(sm[1]),
      issue.subject + " (" + (issue.subject || "").length + ")");
  }

  // ---- the archive ----
  const built = arc.archive();
  const aHtml = fs.existsSync(path.join(ROOT, "robogoat/index.html")) ? fs.readFileSync(path.join(ROOT, "robogoat/index.html"), "utf8") : "";
  const aJson = fs.existsSync(path.join(ROOT, "robogoat/issues.json")) ? fs.readFileSync(path.join(ROOT, "robogoat/issues.json"), "utf8") : "";
  check("archive: robogoat/index.html and issues.json are current (node tools/robogoat/archive.mjs)", aHtml === built.html && aJson === built.json);
  const listed = (JSON.parse(aJson || '{"issues":[]}').issues || []).map((x) => "robogoat/" + x.path.replace(/\/$/, ""));
  check("archive: issues.json lists every issue directory, once", listed.slice().sort().join(",") === ISSUES.slice().sort().join(","), listed.join(", "));
  const pub = (JSON.parse(aJson || '{"issues":[]}').issues || []).map((x) => x.published);
  check("archive: newest first", pub.every((p, i) => i === 0 || pub[i - 1] >= p), pub.join(", "));
  check("archive: noindex, viewport, no script", /<meta name="robots" content="noindex">/.test(aHtml) && /width=device-width/.test(aHtml) && !/<script\b/i.test(aHtml));

  // ---- browser ----
  const drv = loadDriver();
  const exe = chromeExe();
  const browser = await drv.lib.launch(Object.assign({ headless: true, args: ["--no-sandbox"] }, exe ? { executablePath: exe } : {}));
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const VWS = [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }];

  for (const vw of VWS) {
    const errs = [];
    const page = await openPage(drv, browser, vw, `${base}/robogoat/`, errs);
    const a = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, iw: innerWidth,
      links: [...document.querySelectorAll("a.issue")].map((x) => x.getAttribute("href")),
      broken: [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src")),
      rg: (() => { const i = document.querySelector("header.mast img.robogoat"); return i ? { ok: i.naturalWidth > 0, top: i.getBoundingClientRect().top } : null; })(),
      back: (document.querySelector('footer a[href="../league.html"]') || {}).textContent || "",
    }));
    const tag = "archive " + vw.width + "px";
    check(`${tag}: no page errors, no horizontal scroll`, errs.length === 0 && a.sw <= a.iw, errs.join(" | ") + ` ${a.sw}/${a.iw}`);
    check(`${tag}: RoboGoat's portrait heads it, and every share thumbnail loads`, !!a.rg && a.rg.ok && a.rg.top < 120 && a.broken.length === 0, JSON.stringify(a));
    check(`${tag}: one link per issue`, a.links.length === ISSUES.length, a.links.join(", "));
    if (vw.width === 390) {
      const codes = await Promise.all(a.links.map((h) => status(`${base}/robogoat/${h}`)));
      check("archive: every issue link resolves (HTTP 200)", codes.every((c) => c === 200), a.links.map((h, i) => h + " " + codes[i]).join(", "));
      check('archive: footer links back to the app ("../league.html")', /Back to the GFFL app/.test(a.back), a.back);
    }
    await page.close();
  }

  for (const dir of ISSUES) {
    const issue = meta[dir];
    const allow2 = new Set(issue.allowTwoDecimals || []);
    for (const vw of VWS) {
      const errs = [];
      const page = await openPage(drv, browser, vw, `${base}/${dir}/`, errs);
      const tag = `${dir} ${vw.width}px`;
      const m = await page.evaluate(() => {
        const svgs = [...document.querySelectorAll("svg.wp")].filter((s) => getComputedStyle(s).display !== "none");
        const svg = svgs[0];
        const textOut = [];
        if (svg) {
          const vb = svg.viewBox.baseVal;
          for (const t of svg.querySelectorAll("text")) {
            const b = t.getBBox();
            if (b.x < vb.x - 0.5 || b.x + b.width > vb.x + vb.width + 0.5) textOut.push(t.textContent + " [" + Math.round(b.x) + "," + Math.round(b.x + b.width) + "]");
          }
        }
        const svgScale = svg ? svg.getBoundingClientRect().width / svg.viewBox.baseVal.width : 0;
        const local = [...document.images].filter((i) => i.src.startsWith(location.origin));
        const arch = document.querySelector('footer a[href$="/"]');
        return {
          sw: document.documentElement.scrollWidth, iw: innerWidth, hasWp: document.querySelectorAll("svg.wp").length > 0,
          visibleSvgs: svgs.map((s) => s.getAttribute("class")), textOut,
          typePx: svg ? parseFloat(getComputedStyle(svg.querySelector("text")).fontSize) * svgScale : 0,
          brokenLocal: local.filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src")), localCount: local.length,
          // RoboGoat's portrait heads every newsletter (user, 2026-09-29): in the masthead, loaded, above the fold
          rg: (() => { const i = document.querySelector("header.mast img.robogoat"); if (!i) return null;
            const r = i.getBoundingClientRect(); return { src: i.getAttribute("src"), ok: i.naturalWidth > 0, top: r.top, h: r.height, right: r.right }; })(),
          bodyPx: parseFloat(getComputedStyle(document.querySelector("main > p, main section > p")).fontSize),
          archive: arch ? arch.href : "",
          text: document.querySelector(".wrap").innerText,
          captions: [...document.querySelectorAll(".panel .dek, .panel .src")].map((e) => e.textContent),
          // a score or record ("35-27", "2-1") in copy must sit inside a no-wrap element, or phones split it at the hyphen
          hyphenBreaks: (() => {
            const out = [], w = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
            for (let n; (n = w.nextNode());) {
              if (n.parentElement.closest("svg")) continue;
              if (/\b\d+-\d+\b/.test(n.nodeValue) && getComputedStyle(n.parentElement).whiteSpace !== "nowrap") out.push(n.nodeValue.trim().slice(0, 60));
            }
            return out;
          })(),
        };
      });
      check(`${tag}: no page errors`, errs.length === 0, errs.join(" | "));
      check(`${tag}: no horizontal scroll`, m.sw <= m.iw, `${m.sw} > ${m.iw}`);
      check(`${tag}: every local image (team logos, portrait) loads`, m.brokenLocal.length === 0 && m.localCount >= 9, m.brokenLocal.join(", ") + ` (${m.localCount})`);
      if (m.hasWp) {
        const wantSvg = vw.width <= 560 ? "wp wp-sm" : "wp wp-lg";
        check(`${tag}: exactly one win-probability chart shows, the ${wantSvg.split(" ")[1]} one`, m.visibleSvgs.length === 1 && m.visibleSvgs[0] === wantSvg, m.visibleSvgs.join(","));
        check(`${tag}: chart type renders at >= 11px`, m.typePx >= 11, m.typePx.toFixed(1) + "px");
        check(`${tag}: no chart label spills outside the chart`, m.textOut.length === 0, m.textOut.join("; "));
      }
      check(`${tag}: RoboGoat's portrait is in the masthead, loaded and fully on screen at the top`,
        !!m.rg && /(^|\/)robogoat\.png$/.test(m.rg.src) && m.rg.ok && m.rg.top >= 0 && m.rg.top < 120 && m.rg.h >= 100 && m.rg.right <= vw.width,
        JSON.stringify(m.rg));
      check(`${tag}: body copy >= 16px`, m.bodyPx >= 16, m.bodyPx + "px");
      if (vw.width === 390) {
        const text = norm(m.text);
        check(`${dir}: footer links to the archive, and it resolves`, /\/robogoat\/$/.test(m.archive) && (await status(m.archive)) === 200, m.archive);
        const twoDp = [...new Set((text.match(/\b\d+\.\d{2}\b/g) || []))];
        check(`${dir}: no two-decimal numbers except the ones the column is about (${[...allow2].join(", ") || "none"})`, twoDp.every((x) => allow2.has(x)), twoDp.join(", "));
        const unquoted = text.replace(/“[^”]*”/g, " ");
        check(`${dir}: Laws Rule is "Sandy": no "Mom" outside a verbatim quote`, !/\bmom\b/i.test(unquoted), (unquoted.match(/.{30}\bmom\b.{30}/i) || [""])[0]);
        const OWN = OWNERS.join("|");
        const atPairs = text.match(new RegExp("\\b(" + OWN + ") at (" + OWN + ")\\b", "g")) || [];
        check(`${dir}: owner matchups read "Joe versus Calvin", never "Joe at Calvin" (user, 2026-09-29)`, atPairs.length === 0, atPairs.join(", "));
        check(`${dir}: every owner is named`, OWNERS.every((o) => new RegExp("\\b" + o + "\\b").test(text)), OWNERS.filter((o) => !new RegExp("\\b" + o + "\\b").test(text)).join(","));
        check(`${dir}: curly quotes only (no straight double quotes in the copy)`, !/"/.test(text));
        // The app is "GFFL" (user, 2026-10-03: "since the app is GFFL, I would call it GFFL"). The
        // captions come from build.mjs, so every issue is held to that. The column prose is held to it
        // from that date on: the Week 3 recap went out on 2026-09-29 saying "the app" and stays as sent.
        // A chat quote may say "app"; it is somebody's words, so quotes are exempt, as for "Mom".
        check(`${dir}: chart captions call the app "GFFL"`, m.captions.length > 0 && m.captions.every((c) => !/\bapp\b/i.test(c)), m.captions.filter((c) => /\bapp\b/i.test(c)).join(" | "));
        if (issue.published >= "2026-10-03") {
          check(`${dir}: the column calls the app "GFFL", never "the app"`, !/\bapps?\b/i.test(unquoted), (unquoted.match(/.{0,40}\bapps?\b.{0,40}/i) || [""])[0]);
        }
        check(`${dir}: scores and records never split at the hyphen (each is in a no-wrap span)`, m.hyphenBreaks.length === 0, m.hyphenBreaks.join(" | "));
      }
      await page.close();
    }
  }

  // ---- Week 3: arithmetic, hand-computed ----
  {
    const page = await openPage(drv, browser, { width: 390, height: 844 }, `${base}/${W3}/`, []);
    const m = await page.evaluate(() => ({
      board: [...document.querySelectorAll(".board .game")].map((g) => [...g.querySelectorAll(".tr")].map((r) => ({
        name: r.querySelector(".tn b").textContent.trim(), pts: r.querySelector(".ts").textContent.trim(), win: r.classList.contains("win") }))),
      stand: [...document.querySelectorAll("table.stand tbody tr")].map((r) => ({
        name: r.querySelector(".tt b").textContent.trim(), wl: r.querySelector(".c").textContent.trim(), pf: r.querySelector(".r").textContent.trim() })),
      // RESTAGED 2026-09-30: this used to read every ".bench .brow" on the page. The season panel
      // (below) reuses the bench-bar rows for its season totals, so the WEEK's bars are now the
      // ones outside .season — same eight bars as before, scoped so the season's eight don't join them.
      bars: [...document.querySelectorAll(".panel:not(.season) .bench .brow")].map((r) => ({ w: r.querySelector(".bar").getBoundingClientRect().width, v: r.querySelector(".bv").textContent.trim() })),
      season: (() => {
        const s = document.querySelector(".panel.season"); if (!s) return null;
        return {
          rows: [...s.querySelectorAll(".bench .brow")].map((r) => ({
            label: r.querySelector(".bl").textContent.replace(/\s+/g, " ").trim(), v: r.querySelector(".bv").textContent.trim(),
            w: r.querySelector(".bar").getBoundingClientRect().width,
            segs: [...r.querySelectorAll(".bar i")].map((i) => ({ w: i.getBoundingClientRect().width, cls: i.className })) })),
          // child by child, joined with a space: adjacent flex items have no whitespace between them
          his: [...s.querySelectorAll("ol.hi")].map((o) => [...o.querySelectorAll("li")].map((li) => [...li.children].map((c) => c.textContent.replace(/\s+/g, " ").trim()).join(" "))),
          picks: [...s.querySelectorAll(".picks li")].map((li) => ({ t: [li.querySelector("b"), li.querySelector(".nw")].map((c) => c.textContent.trim()).join(" "),
            hit: li.querySelectorAll(".pk.hit").length, miss: li.querySelectorAll(".pk.miss").length })),
          legend: [...s.querySelectorAll(".legend span")].map((c) => c.textContent.trim()).join(" | "),
        };
      })(),
      ranks: [...document.querySelectorAll("ol.ranks li")].map((li) => ({
        rk: li.querySelector(".rk").firstChild.nodeValue.trim(), owner: li.querySelector("small").textContent.split(",")[0].trim(),
        mv: (li.querySelector(".mv") || {}).getAttribute ? li.querySelector(".mv").getAttribute("aria-label") : null,
        mvText: (li.querySelector(".mv") || {}).textContent || "", color: li.querySelector(".mv") ? getComputedStyle(li.querySelector(".mv")).color : "" })),
      text: document.querySelector(".wrap").innerText,
    }));
    await page.close();
    GAMES.forEach(([a, ap, h, hp], i) => {
      const g = m.board[i] || [];
      const ok = g.length === 2 && g[0].name.toUpperCase() === a.toUpperCase() && g[0].pts === r1(ap)
        && g[1].name.toUpperCase() === h.toUpperCase() && g[1].pts === r1(hp) && g[0].win === (ap > hp) && g[1].win === (hp > ap);
      check(`week 3 scoreboard game ${i + 1}: ${a} ${r1(ap)}, ${h} ${r1(hp)}, winner marked`, ok, JSON.stringify(g));
    });
    const want = Object.keys(WEEKLY).map((n) => ({ n, w: WINS[n], pf: WEEKLY[n].reduce((s, x) => s + x, 0) }))
      .sort((x, y) => y.w - x.w || y.pf - x.pf);
    check("week 3 standings: order is wins, then points (hand-computed)", m.stand.map((s) => s.name).join("|") === want.map((x) => x.n).join("|"),
      m.stand.map((s) => s.name).join(" | "));
    check("week 3 standings: points are the three weekly totals summed, one decimal",
      want.every((x) => (m.stand.find((s) => s.name === x.n) || {}).pf === r1(x.pf)),
      want.map((x) => x.n + " " + r1(x.pf) + " vs " + (m.stand.find((s) => s.name === x.n) || {}).pf).join("; "));
    check("week 3 standings: W-L adds up (12 wins, 12 losses)", m.stand.reduce((s, x) => s + Number(x.wl.split("-")[0]), 0) === 12
      && m.stand.reduce((s, x) => s + Number(x.wl.split("-")[1]), 0) === 12);
    const ratioOk = m.bars.length === BENCH.length && m.bars.every((b, i) => Math.abs(b.w / m.bars[0].w - BENCH[i] / BENCH[0]) < 0.01);
    check("week 3 bench bars are proportional to the values", ratioOk, m.bars.map((b) => b.w.toFixed(1)).join(","));
    check("week 3 bench values: one decimal, except the tie that needs two (6.90 over 6.86)",
      m.bars.map((b) => b.v).join(",") === "44.8,42.0,40.2,30.1,23.3,23.0,6.90,6.86", m.bars.map((b) => b.v).join(","));
    const text = norm(m.text);
    check("week 3: RoboGoat's record is stated (7-1)", /Picks record: 7-1/.test(text));

    // ---- the season panel (item 4 of the 2026-09-29 improvements) ----
    const season = JSON.parse(fs.readFileSync(path.join(ROOT, "robogoat/2026/season.json"), "utf8"));
    const S = m.season;
    check("week 3: the season panel is on the page", !!S);
    if (S) {
      const ownerOfId = { 1: "Perry", 2: "Elan", 3: "Joe", 4: "Tom", 5: "Sandy", 9: "John", 11: "Calvin", 12: "Isaac" };
      // Cross-check the stored week against this page's own week-3 bench bars (the same numbers,
      // reached independently: the bars came from issue.json, the season from facts.mjs).
      const w3 = season.weeks["3"].bench;
      check("season.json week 3 bench equals the week-3 bench bars, team by team",
        Object.values(w3).map(Number).sort((a, b) => b - a).map((v, i) => Math.abs(v - BENCH[i]) < 0.005).every(Boolean), JSON.stringify(w3));
      // The app's own bench-blunder award, week by week. Weeks 2 and 3 match to the hundredth.
      // Week 1 is 0.38 higher here: the app finalized Week 1 from the stat lines it had that
      // Tuesday; facts.mjs rescored them afterwards from Sleeper's corrected lines (Perry's
      // recomputed Week 1 starters total 126.72 against the official 125.10). Same team, same
      // decisions; the bound says a stat correction, not a different lineup.
      for (const w of [1, 2, 3]) {
        const e = Object.entries(season.weeks[String(w)].bench).sort((a, b) => b[1] - a[1])[0];
        const [who, v] = APP_BENCH_BLUNDER[w];
        const tol = w === 1 ? 0.4 : 0.005;
        check(`season week ${w}: the biggest bench is ${who}'s, within ${tol} of the app's bench-blunder award (${v})`,
          ownerOfId[e[0]] === who && Math.abs(e[1] - v) <= tol, JSON.stringify(e));
      }
      // Totals: each team's weeks summed, hand-computed from season.json, sorted, one decimal.
      const tot = Object.keys(ownerOfId).map((t) => ({ o: ownerOfId[t], by: [1, 2, 3].map((w) => season.weeks[String(w)].bench[t] || 0) }))
        .map((x) => ({ ...x, v: x.by.reduce((a, b) => a + b, 0) })).sort((a, b) => b.v - a.v);
      check("season bench: teams in order of total, most first", S.rows.map((r) => r.label.split(" ").pop()).join(",") === tot.map((x) => x.o).join(","),
        S.rows.map((r) => r.label).join(" | "));
      check("season bench: each total is the three weeks summed, one decimal", S.rows.every((r, i) => r.v === r1(tot[i].v)),
        S.rows.map((r, i) => r.v + "/" + r1(tot[i].v)).join(" "));
      check("season bench: bars are proportional to the totals", S.rows.every((r) => Math.abs(r.w / S.rows[0].w - Number(r.v) / Number(S.rows[0].v)) < 0.01),
        S.rows.map((r) => r.w.toFixed(1)).join(","));
      check("season bench: each bar's week segments are proportional to that week's bench (±1px)",
        S.rows.every((r, i) => { const nz = tot[i].by.filter((v) => v > 0); const sum = r.segs.reduce((a, s) => a + s.w, 0);
          return r.segs.length === nz.length && r.segs.every((s, k) => Math.abs(s.w - sum * nz[k] / tot[i].v) <= 1); }),
        JSON.stringify(S.rows[0].segs));
      check("season bench: the week just played is its own colour, last in each bar",
        S.rows.every((r, i) => (tot[i].by[2] > 0 ? r.segs[r.segs.length - 1].cls === "wn" : true) && r.segs.filter((s) => s.cls === "wn").length === (tot[i].by[2] > 0 ? 1 : 0)),
        S.rows.map((r) => r.segs.map((s) => s.cls).join("+")).join(" "));
      check('season bench legend reads "Weeks 1 and 2" and "Week 3"', S.legend === "Weeks 1 and 2 | Week 3", S.legend);
      const elan = tot.find((x) => x.o === "Elan");
      check(`week 3 column's "about ${Math.round(elan.v)} points on the bench in three weeks" matches Elan's season total (${r1(elan.v)})`,
        new RegExp("Elan has left about " + Math.round(elan.v) + " points on the bench in three weeks").test(text));
      // Top team scores: hand-computed from the app's weekly totals above, not from season.json.
      const all = Object.entries(WEEKLY).flatMap(([n, a]) => a.map((p, k) => ({ o: OWNER_OF[n], w: k + 1, p }))).sort((a, b) => b.p - a.p).slice(0, 3);
      check("season highs: top three team scores are the app's three best weekly totals",
        (S.his[0] || []).length === 3 && all.every((x, i) => S.his[0][i].startsWith(r1(x.p)) && S.his[0][i].endsWith(`${x.o}, Week ${x.w}`)),
        JSON.stringify(S.his[0]) + " want " + all.map((x) => r1(x.p) + " " + x.o + " W" + x.w).join(", "));
      check("season highs: three top starters, best first", (S.his[1] || []).length === 3
        && S.his[1].map((t) => Number(t.split(" ")[0])).every((v, i, a) => i === 0 || a[i - 1] >= v), JSON.stringify(S.his[1]));
      const pw = S.picks.map((p) => p.t);
      check("season picks: Week 2 3-1, Week 3 4-0, Season 7-1 (from the previews as sent)",
        pw.join("|") === `Week 2 ${PICKS[2]}|Week 3 ${PICKS[3]}|Season 7-1`, pw.join(" | "));
      check("season picks: one mark per pick, filled for a win and a ring for a loss",
        S.picks[0].hit === 3 && S.picks[0].miss === 1 && S.picks[1].hit === 4 && S.picks[1].miss === 0, JSON.stringify(S.picks));
    }

    // ---- power-ranking arrows (item 4): movement against RoboGoat's Week 2 ranking ----
    check("week 3 power rankings are the published order", m.ranks.map((r) => r.owner).join(",") === RANK_W3.join(","), m.ranks.map((r) => r.owner).join(","));
    const wantMv = RANK_W3.map((o, i) => { const d = RANK_W2.indexOf(o) - i; return d === 0 ? "same as last week" : `${d > 0 ? "up" : "down"} ${Math.abs(d)} from last week`; });
    check("rank arrows: each team's movement is its Week 2 rank minus its Week 3 rank (hand-computed)",
      m.ranks.map((r) => r.mv).join("|") === wantMv.join("|"), m.ranks.map((r) => r.owner + " " + r.mv).join("; "));
    check("rank arrows: Perry ▲4 is green, Calvin ▼2 is red, unchanged is a dash",
      /4$/.test(m.ranks[1].mvText) && m.ranks[1].color === "rgb(26, 127, 55)" && /2$/.test(m.ranks[3].mvText) && m.ranks[3].color === "rgb(213, 10, 10)" && m.ranks[0].mvText === "–",
      JSON.stringify([m.ranks[0], m.ranks[1], m.ranks[3]]));
    check("season.json rankings match the column's published order", JSON.stringify(season.rankings["3"].map((t) => ({ 1: "Perry", 2: "Elan", 3: "Joe", 4: "Tom", 5: "Sandy", 9: "John", 11: "Calvin", 12: "Isaac" })[t])) === JSON.stringify(RANK_W3)
      && JSON.stringify(season.rankings["2"].map((t) => ({ 1: "Perry", 2: "Elan", 3: "Joe", 4: "Tom", 5: "Sandy", 9: "John", 11: "Calvin", 12: "Isaac" })[t])) === JSON.stringify(RANK_W2));
  }

  await browser.close();
  srv.close();
  finish();
})().catch((e) => { console.error(e); fail++; finish(); });

function finish() {
  console.log(`\nrobogoat: ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}
