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
//   * the read log (Perry, 2026-10-10): every issue carries exactly one invisible beacon naming its
//     own path, and a browser's request for it carries the tagged page URL as its Referer;
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
// The read-log beacon is answered by the REAL netlify/functions/rgread.mjs (no service account in
// this process, so it writes nothing and returns its pixel), and each hit's i and Referer are kept.
const BEACON_HITS = [];
let RGREAD = null;
function serve() {
  return new Promise((res) => {
    const srv = http.createServer(async (q, r) => {
      if (q.url.startsWith("/.netlify/functions/rgread")) {
        BEACON_HITS.push({ i: new URL(q.url, "http://x").searchParams.get("i"), referer: q.headers.referer || "" });
        const resp = await RGREAD.default(new Request("http://127.0.0.1" + q.url, { headers: { "user-agent": q.headers["user-agent"] || "" } }));
        r.writeHead(resp.status, Object.fromEntries(resp.headers));
        return r.end(Buffer.from(await resp.arrayBuffer()));
      }
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
  delete process.env.FIREBASE_SERVICE_ACCOUNT; // the beacon route must never reach a real Firestore
  RGREAD = await import(pathToFileURL(path.join(ROOT, "netlify/functions/rgread.mjs")).href);
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
    // Read log (Perry, 2026-10-10): one beacon, naming THIS issue (a copied page logging reads
    // against another issue is the bug this guards), and the rule that keeps it invisible.
    const beacons = [...html.matchAll(/<img class="rgb" src="\/\.netlify\/functions\/rgread\?i=([^"]+)" alt="" width="1" height="1" aria-hidden="true">/g)].map((x) => x[1]);
    check(`${dir}: exactly one read-log beacon, naming its own path`, beacons.length === 1 && beacons[0] === dir.replace(/^robogoat\//, "")
      && (html.match(/rgread/g) || []).length === 1, JSON.stringify(beacons));
    check(`${dir}: the beacon's inline rule takes it out of layout and sight`, /\.rgb\{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none\}/.test(html));
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
  check("archive: no read-log beacon (it is not a column; a read there says nothing)", !/rgread/.test(aHtml));

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
          beacon: (() => { const b = document.querySelector("img.rgb"); if (!b) return null; const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
            return { w: r.width, h: r.height, op: cs.opacity, pos: cs.position, pe: cs.pointerEvents, loaded: b.naturalWidth === 1 }; })(),
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
      check(`${tag}: the read-log beacon loads, 1x1, transparent, out of the flow, untappable`,
        !!m.beacon && m.beacon.loaded && m.beacon.w <= 1 && m.beacon.h <= 1 && m.beacon.op === "0" && m.beacon.pos === "absolute" && m.beacon.pe === "none", JSON.stringify(m.beacon));
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
        // House rules from the independent review of all eight columns (Perry, 2026-10-10), for issues
        // from that day on. Weeks 3 to 5 ran 2,000 to 2,900 words on a phone; the targets are about
        // 1,000 (preview) and 1,300 (recap), and these caps leave room. The Week 4 recap said "On
        // Saturday I wrote" seven times. The voice is "I": "RoboGoat here." opens, "RoboGoat" signs
        // off, and RoboGoat is not third person in between (chat quotes may name it).
        if (issue.published >= "2026-10-10") {
          const src = fs.readFileSync(path.join(ROOT, dir, "column.md"), "utf8").split("\n")
            .filter((l) => !/^(SUBJECT|KICKER|MASTHEAD|SUBHEAD):|^\[IMAGE:/.test(l));
          const body = src.join("\n");
          const words = body.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
          const cap = issue.type === "recap" ? 1900 : 1600;
          check(`${dir}: the column is at most ${cap} words (${words})`, words <= cap, String(words));
          const wrote = (body.match(/\b((On \w+day|Last week),? I (also )?wrote|I also wrote)\b/g) || []).length;
          check(`${dir}: "On Saturday I wrote" and its cousins at most twice (${wrote})`, wrote <= 2, String(wrote));
          const third = src.filter((l) => l.trim() !== "RoboGoat").join("\n").replace(/^RoboGoat here\./m, "").replace(/“[^”]*”/g, " ");
          check(`${dir}: one voice: no third-person "RoboGoat" between the opener and the sign-off`, !/RoboGoat/.test(third), (third.match(/.{0,40}RoboGoat.{0,40}/) || [""])[0]);
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

  // ---- read log: the tag rides the Referer (Perry, 2026-10-10) ----
  // The page is script-free, so the only way the reader's team reaches rgread is the browser
  // sending the tagged page URL as the beacon's Referer. Opened here exactly as the GFFL card and a
  // push open it; the real parseRead then reads the hit (host swapped to the live one, which is all
  // the local server changes).
  for (const [dir, q, via, team] of [[ISSUES[0], "?r=app5", "app", 5], [ISSUES[ISSUES.length - 1], "?r=push12", "push", 12], [ISSUES[0], "", "direct", null]]) {
    BEACON_HITS.length = 0;
    const errs = [];
    const page = await openPage(drv, browser, VWS[1], `${base}/${dir}/${q}`, errs);
    const hit = BEACON_HITS.find((h) => h.i === dir.replace(/^robogoat\//, ""));
    const live = (u) => String(u).replace(base, "https://goatfantasyleague.com");
    const read = hit && RGREAD.parseRead(live(`${base}/.netlify/functions/rgread?i=${hit.i}`), live(hit.referer), "Mozilla/5.0 (iPhone)");
    check(`read log: ${dir}/${q || "(email link)"} -> one beacon hit whose Referer is the page${q ? " with its tag" : ""}, read as ${via}${team ? " team " + team : ""}`,
      BEACON_HITS.length === 1 && !!hit && hit.referer === `${base}/${dir}/${q}` && !!read && read.via === via && read.team === team,
      JSON.stringify({ hits: BEACON_HITS, read }));
    await page.close();
  }

  await kitChecks();
  await browser.close();
  srv.close();
  finish();
})().catch((e) => { console.error(e); fail++; finish(); });

// ================================================================================================
// The automation kit (2026-10-04): analysis.mjs, week.mjs, facts.mjs's rules, build.mjs's guards.
// Node-only, no network. Fixtures are shaped like the real data under robogoat/2026/ and the facts
// files (roster docs, tx docs, proj, the ESPN scoreboard); every expected value is worked out here.
// Each check runs inside safe(): a missing module or a thrown error is a FAIL of that check, not a crash.
// ================================================================================================
async function kitChecks() {
  const os = require("os");
  const safe = async (fn) => { try { return await fn(); } catch (e) { return "threw: " + (e && e.message ? e.message.split("\n")[0] : e); } };
  const expect = async (name, fn, want) => { const got = await safe(fn); check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) + " want " + JSON.stringify(want)); };
  const A = await safe(() => import(pathToFileURL(path.join(ROOT, "tools/robogoat/analysis.mjs")).href));
  check("kit: analysis.mjs loads", typeof A === "object" && typeof A.rankStandings === "function", typeof A === "string" ? A : "");
  const T = {
    1: { owner: "Perry", short: "Kreussers", name: "Battle Kreussers" }, 2: { owner: "Elan", short: "Skywalkers", name: "Elanikan Skywalkers" },
    3: { owner: "Joe", short: "Cowboys", name: "Wyoming Cowboys" }, 5: { owner: "Sandy", short: "Laws Rule", name: "Laws Rule" },
    9: { owner: "John", short: "Nerfherders", name: "Scruffy Looking Nerfherders" }, 11: { owner: "Calvin", short: "Kruz Control", name: "Kruz Control" },
  };

  // ---- 1a. standings: ties count half, then the tiebreak list ----
  // Two seasons of two weeks. W1: 1 beat 3 (100-90), 2 beat 4 (120-110). W2: 1 and 4 tied (100-100), 3 beat 2 (130-105).
  // Win points: team 1 = 1 + 0.5 = 1.5; teams 2 and 3 = 1.0; team 4 = 0.5. PF: 1=200, 2=225, 3=220, 4=210.
  // Old rule (wins, then PF) ignored the tie: 1, 2 and 3 all had one win, so PF put 2 (225), 3 (220), 1 (200) in front: [2,3,1,4].
  // h2h among 2 and 3: 3 won their only game, so 3 is ahead of 2 despite 5 fewer points. PF-only keeps 2 ahead.
  const G = [{ home: 1, away: 3, homePts: 100, awayPts: 90 }, { home: 2, away: 4, homePts: 120, awayPts: 110 },
    { home: 1, away: 4, homePts: 100, awayPts: 100 }, { home: 3, away: 2, homePts: 130, awayPts: 105 }];
  const REC = { 1: { team: 1, w: 1, l: 0, t: 1, pf: 200 }, 2: { team: 2, w: 1, l: 1, t: 0, pf: 225 }, 3: { team: 3, w: 1, l: 1, t: 0, pf: 220 }, 4: { team: 4, w: 0, l: 1, t: 1, pf: 210 } };
  await expect("standings: a tie is half a win, then head-to-head, then points (default tiebreak): 1, 3, 2, 4",
    () => A.rankStandings(REC, G, A.tiebreakOf({})).map((x) => x.team), [1, 3, 2, 4]);
  await expect('standings: rules.tiebreak ["pf"] ranks 2 ahead of 3 on points: 1, 2, 3, 4',
    () => A.rankStandings(REC, G, A.tiebreakOf({ rules: { tiebreak: ["pf"] } })).map((x) => x.team), [1, 2, 3, 4]);
  await expect("standings: no rules.tiebreak means h2h then pf", () => A.tiebreakOf({ rules: { roster: {} } }), ["h2h", "pf"]);

  // ---- 1b. win probability: a tie is nobody's win; an exact 0.5 reading is not a flip ----
  // Away team's chance 0.6, 0.5, 0.6 in a 100-100 game. The old code read a tie as a home win (start 1-0.6 = 0.4) and
  // counted 0.6 > 0.5, 0.5 > 0.5 (false), 0.6 > 0.5 as two flips. Now: winner null, start 0.6, zero flips.
  const S = [{ t: 0, p: 0.6 }, { t: 1000, p: 0.5 }, { t: 2000, p: 0.6 }];
  await expect("win probability: a tied game has no winner, starts at the away chance, and an exact 0.5 reading is no flip",
    () => { const w = A.summarizeWp(S, 5, 1, 100, 100); return [w.winner, w.tie, w.start, w.flips]; }, [null, true, 0.6, 0]);
  await expect("win probability: a home win still reads as 1 - p, and a real crossing is one flip",
    () => { const w = A.summarizeWp([{ t: 0, p: 0.7 }, { t: 1, p: 0.4 }], 5, 1, 90, 100); return [w.winner, w.start, w.flips, w.low.p]; }, [1, 0.3, 1, 0.3]);

  // ---- 1c. --since: the newest issue's day, capped at 14 days, else 7 ----
  const NOW = Date.parse("2026-10-04T17:00:00Z");
  await expect("since: defaults to 05:00Z (Chicago midnight) on the newest issue's published day",
    () => new Date(A.sinceDefault([{ published: "2026-09-29" }, { published: "2026-10-03" }], NOW)).toISOString(), "2026-10-03T05:00:00.000Z");
  await expect("since: an issue older than 14 days is capped at 14 days back", () => new Date(A.sinceDefault([{ published: "2026-09-01" }], NOW)).toISOString(), "2026-09-20T17:00:00.000Z");
  await expect("since: no issues means 7 days back", () => new Date(A.sinceDefault([], NOW)).toISOString(), "2026-09-27T17:00:00.000Z");

  // ---- 1d. known anomalies ----
  const allow = safeSync(() => JSON.parse(fs.readFileSync(path.join(ROOT, "tools/robogoat/known-anomalies.json"), "utf8")).known);
  const L1 = "FAIL: 1 rostered starter(s) whose NFL game is FINAL and who aren't injury-listed have NO stat line at all — and the feed IS live for other players this week, so this looks like real drift.";
  const L2 = L1.replace("FAIL: 1 ", "FAIL: 2 ");
  await expect("anomalies: the Week 2 Nacua case is listed, so it prints as known", () => { const c = A.classifyAnomalies([L1], 2, allow); return [c.known.length, c.fresh.length]; }, [1, 0]);
  await expect("anomalies: a second stat-less starter in Week 2 is NEW", () => { const c = A.classifyAnomalies([L2], 2, allow); return [c.known.length, c.fresh.length]; }, [0, 1]);
  await expect("anomalies: the same line in Week 3 is NEW", () => { const c = A.classifyAnomalies([L1], 3, allow); return [c.known.length, c.fresh.length]; }, [0, 1]);

  // ---- 2. OG / meta tags ----
  const pg = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const tags = (h) => ({ url: (/property="og:url" content="([^"]*)"/.exec(h) || [])[1], site: (/property="og:site_name" content="([^"]*)"/.exec(h) || [])[1], card: (/name="twitter:card" content="([^"]*)"/.exec(h) || [])[1] });
  await expect("meta: the archive carries og:url, og:site_name and twitter:card", () => tags(pg("robogoat/index.html")),
    { url: "https://goatfantasyleague.com/robogoat/", site: "RoboGoat · GFFL", card: "summary_large_image" });
  await expect("meta: week 3 carries og:url (its own address), og:site_name and twitter:card", () => tags(pg("robogoat/2026/week-3/index.html")),
    { url: "https://goatfantasyleague.com/robogoat/2026/week-3/", site: "RoboGoat · GFFL", card: "summary_large_image" });
  await expect("meta: the week 4 preview carries og:url, og:site_name and twitter:card", () => tags(pg("robogoat/2026/week-4-preview/index.html")),
    { url: "https://goatfantasyleague.com/robogoat/2026/week-4-preview/", site: "RoboGoat · GFFL", card: "summary_large_image" });

  // ---- 3a. lineups: snapshot, key-order invariance, keyed diff ----
  const R1 = [{ pos: "QB", slot: "BENCH", team: "KC", injury: "", key: "3139477", name: "Patrick Mahomes" }, { slot: "QB", key: "3918298", team: "BUF", name: "Josh Allen", pos: "QB", injury: "" },
    { slot: "TE", key: "3929645", team: "NO", name: "Juwan Johnson", pos: "TE" }];
  const R1b = [R1[2], { name: "Josh Allen", pos: "QB", slot: "QB", key: "3918298", team: "BUF" }, { name: "Patrick Mahomes", key: "3139477", team: "KC", pos: "QB", slot: "BENCH" }]; // same lineup, other order
  const R2 = [{ pos: "QB", slot: "QB", team: "KC", key: "3139477", name: "Patrick Mahomes" }, { slot: "BENCH", key: "3918298", team: "BUF", name: "Josh Allen", pos: "QB" },
    { slot: "TE", key: "3929645", team: "NO", name: "Juwan Johnson", pos: "TE" }, { slot: "RB", key: "slp_12495", team: "MIA", name: "Ollie Gordon", pos: "RB" }];
  await expect("lineups: two reads of one lineup in different key and array order snapshot identically, with no diff",
    () => [JSON.stringify(A.snapshotLineups({ 5: R1 })) === JSON.stringify(A.snapshotLineups({ 5: R1b })), A.diffLineups(A.snapshotLineups({ 5: R1 }), A.snapshotLineups({ 5: R1b })).length], [true, 0]);
  await expect("lineups: the diff is keyed by team, player and slot (Allen to the bench, Mahomes in, Gordon added)",
    () => A.diffLineups(A.snapshotLineups({ 5: R1 }), A.snapshotLineups({ 5: R2 })).map((d) => [d.team, d.name, d.change, d.from, d.to]),
    [[5, "Josh Allen", "moved", "QB", "BENCH"], [5, "Ollie Gordon", "added", null, "RB"], [5, "Patrick Mahomes", "moved", "BENCH", "QB"]]);
  await expect("lineups: the printed line names the owner and each move",
    () => A.formatLineupDiff(A.diffLineups(A.snapshotLineups({ 5: R1 }), A.snapshotLineups({ 5: R2 })), T),
    ["Sandy (Laws Rule): Josh Allen QB -> BENCH; Ollie Gordon added to RB; Patrick Mahomes BENCH -> QB"]);

  // ---- 3b. leads ----
  // ESPN scoreboard shape, abbreviations as ESPN spells them (WAS for Washington: the parser normalises to WSH).
  const sb = { events: [
    { id: "1", date: "2026-10-02T00:15Z", competitions: [{ competitors: [{ homeAway: "home", team: { abbreviation: "PIT", shortDisplayName: "Steelers" } }, { homeAway: "away", team: { abbreviation: "CLE", shortDisplayName: "Browns" } }] }] },
    { id: "2", date: "2026-10-04T13:30Z", competitions: [{ competitors: [{ homeAway: "home", team: { abbreviation: "WAS", shortDisplayName: "Commanders" } }, { homeAway: "away", team: { abbreviation: "IND", shortDisplayName: "Colts" } }] }] },
    { id: "3", date: "2026-10-04T17:00Z", competitions: [{ competitors: [{ homeAway: "home", team: { abbreviation: "TB", shortDisplayName: "Buccaneers" } }, { homeAway: "away", team: { abbreviation: "GB", shortDisplayName: "Packers" } }] }] },
    { id: "4", date: "2026-10-04T20:25Z", competitions: [{ competitors: [{ homeAway: "home", team: { abbreviation: "DEN", shortDisplayName: "Broncos" } }, { homeAway: "away", team: { abbreviation: "SEA", shortDisplayName: "Seahawks" } }] }] },
    { id: "5", date: "2026-10-05T00:20Z", competitions: [{ competitors: [{ homeAway: "home", team: { abbreviation: "CAR", shortDisplayName: "Panthers" } }, { homeAway: "away", team: { abbreviation: "DET", shortDisplayName: "Lions" } }] }] },
  ] };
  const sched = safeSync(() => A.parseScoreboard(sb));
  await expect("scoreboard: five games in kickoff order, WAS read as WSH", () => [sched.length, sched[1].home, sched.map((g) => g.id).join("")], [5, "WSH", "12345"]);
  const p = (name, pos, slot, team, key, injury) => ({ name, pos, slot, team, key, injury: injury || "" });
  const LU = {
    5: [p("Jameson Williams", "WR", "WR", "DET", "w1"), p("Emeka Egbuka", "WR", "BENCH", "TB", "w2"), p("Jonathan Taylor", "RB", "RB", "IND", "r1")],
    9: [p("DeVonta Smith", "WR", "WR", "PHI", "w3", "Out"), p("Isaiah Likely", "TE", "BENCH", "BAL", "t1")],
    11: [p("Jadarian Price", "RB", "RB", "SEA", "r2"), p("J.K. Dobbins", "RB", "BENCH", "DEN", "r3"), p("Kenneth Walker III", "RB", "RB", "SEA", "r4")],
  };
  const PROJ = { players: { w1: { p: 6 }, w2: { p: 9.5 }, w3: { p: 0 }, r2: { p: 0 }, r3: { p: 9 }, r4: { p: 15 }, r1: { p: 12 } } };
  const H = 3600e3, hrs = (iso) => Date.parse(iso);
  const TX = [
    { t: hrs("2026-09-30T15:00:00Z"), team: 9, type: "waiver", detail: { dropName: "Isaiah Likely", addName: "Kenyon Sadiq", bid: 18 } },
    { t: hrs("2026-09-30T20:34:00Z"), team: 9, type: "fa_add", detail: { addName: "Isaiah Likely" } },
    { t: hrs("2026-09-30T20:36:00Z"), team: 9, type: "drop", detail: { dropName: "Isaiah Likely" } },
    { t: hrs("2026-10-01T15:57:00Z"), team: 9, type: "fa_add", detail: { addName: "Isaiah Likely" } },
    { t: hrs("2026-09-30T14:00:00Z"), team: 5, type: "drop", detail: { dropName: "Dalton Kincaid" } },
  ];
  const ctx = { teams: T, lineups: LU, proj: PROJ, sched, now: Date.parse("2026-10-03T13:00:00Z"), played: new Set(),
    // Calvin's roster doc was last written Tuesday 6:05 a.m. CDT (11:05Z), John's Thursday 10:57 a.m.; the week opened Tuesday 00:00 CDT (05:00Z, Sept 29).
    updateTimes: { 5: "2026-10-03T13:49:20Z", 9: "2026-10-01T15:57:00Z", 11: "2026-09-29T11:05:00Z" }, weekOpen: safeSync(() => A.weekOpenBefore(sched[0].kickoff)), tx: TX };
  await expect("leads: the week opens Tuesday 05:00Z (Chicago midnight) before the Thursday kickoff", () => new Date(ctx.weekOpen).toISOString(), "2026-09-29T05:00:00.000Z");
  const leads = safeSync(() => A.findLeads(ctx));
  const of = (k) => (Array.isArray(leads) ? leads.filter((l) => l.kind === k) : []);
  await expect("leads: starters who are Out or projected 0.0 (Smith is Out and 0.0, Price is 0.0)", () => of("out-starter").map((l) => l.player).sort(), ["DeVonta Smith", "Jadarian Price"]);
  await expect("leads: Williams (DET, 7:20 p.m.) has a higher-projected bench receiver, Egbuka (TB, noon), who plays earlier",
    () => of("late-kickoff").filter((l) => l.player === "Jameson Williams").map((l) => [l.bench.map((b) => b.name), l.text]),
    [[["Emeka Egbuka"], "Sandy's Jameson Williams kicks off Sunday 7:20 p.m.; bench Emeka Egbuka (proj 9.5, Sunday 12:00 p.m.) plays earlier and is projected higher."]]);
  await expect("leads: Price (Seattle 3:25) is not a late-kickoff lead: his bench back Dobbins (9.0) kicks off at the same 3:25, not earlier",
    () => of("late-kickoff").filter((l) => l.player === "Jadarian Price").length, 0);
  await expect("leads: only Calvin has not changed a lineup since the week opened", () => of("no-change").map((l) => l.owner), ["Calvin"]);
  await expect("leads: John moved Isaiah Likely four times (dropped, added, dropped, added): two adds",
    () => of("tx-loop").map((l) => [l.owner, l.player, l.events.length, l.adds]), [["John", "Isaiah Likely", 4, 2]]);
  await expect("leads: John's week is a transaction timeline (five moves); Sandy's single drop is not",
    () => of("tx-timeline").map((l) => [l.owner, l.count]), [["John", 5]]);
  await expect("leads: a starter whose game is already played is never a lead",
    () => A.findLeads({ ...ctx, played: new Set(["w3", "r2", "w1"]), updateTimes: null }).filter((l) => l.kind === "out-starter" || l.kind === "late-kickoff").length, 0);

  // ---- 3c. mechanical drafts ----
  const D = { teams: T, lineups: { 2: [p("Terry McLaurin", "WR", "WR", "WSH", "m1")], 5: [p("Jonathan Taylor", "RB", "RB", "IND", "r1"), p("Spencer Shrader", "K", "K", "IND", "k1"), p("Bears D/ST", "DST", "DST", "CHI", "d1"), p("Josh Allen", "QB", "BENCH", "BUF", "q1")],
    9: [p("DeVonta Smith", "WR", "WR", "PHI", "w3", "Out")] }, sched, now: Date.parse("2026-10-03T13:00:00Z"), proj: PROJ, played: new Set() };
  await expect("draft: the weekend lists only games still to come, in kickoff order, grouped by owner (team-id order), starters only",
    () => A.restOfWeekend(D).map((x) => x.text), ["Colts at Commanders, Sunday 8:30 a.m. Central: Terry McLaurin for Skywalkers, Jonathan Taylor and Spencer Shrader for Laws Rule."]);
  await expect("draft: a defense reads 'the <Team> defense' when the schedule names the team",
    () => A.restOfWeekend({ ...D, lineups: { 5: [p("Packers D/ST", "DST", "DST", "GB", "d2")] } }).map((x) => x.text), ["Packers at Buccaneers, Sunday 12:00 p.m. Central: the Packers defense for Laws Rule."]);
  await expect("draft: the Injury Desk has Smith (Out), in the column's 'Player (Owner): text' form",
    () => A.injuryDesk({ ...D, sched: [] }).map((x) => x.text), ["DeVonta Smith (John): out."]);
  const SER = { a: 1, b: 2, wins: { 1: 3, 2: 1 }, ties: 0, streak: { team: 1, n: 1 }, last: [{ season: 2025, week: 8, 1: 65, 2: 60 }] };
  await expect("draft: a series line gives the leader, the record and the last meeting", () => A.seriesLine(SER, T), "Perry leads the series 3-1. Last meeting: Week 8, 2025, Perry won 65.0 to 60.0.");
  const hist = [{ season: 2024, week: 1, home: 1, away: 2, homePts: 100, awayPts: 90 }, { season: 2024, week: 9, home: 2, away: 1, homePts: 110, awayPts: 120 },
    { season: 2025, week: 3, home: 1, away: 2, homePts: 70, awayPts: 80 }, { season: 2025, week: 8, home: 2, away: 1, homePts: 60, awayPts: 65 }, { season: 2025, week: 9, home: 3, away: 1, homePts: 1, awayPts: 2 }];
  await expect("series: 3-1 for team 1, and the streak is one game (team 2 won the one before)", () => { const s = A.computeSeries(hist, 1, 2); return [s.wins[1], s.wins[2], s.streak]; }, [3, 1, { team: 1, n: 1 }]);
  await expect("series: without the 2025 week 3 loss the streak is three and the line says so", () => { const s = A.computeSeries(hist.filter((_, i) => i !== 2), 1, 2); return [s.streak.n, A.seriesLine(s, T)]; },
    [3, "Perry leads the series 3-0. Perry has won the last 3. Last meeting: Week 8, 2025, Perry won 65.0 to 60.0."]);
  const TW = { 5: { soFar: 18.6, starters: [{ name: "Quinshon Judkins", pos: "RB", pts: 18.6 }] }, 1: { soFar: 7, starters: [{ name: "Steelers D/ST", pos: "DST", pts: 7 }] } };
  await expect("draft: Thursday tallies read as the column's own sentence", () => A.thursdayTallies([{ away: 5, home: 1 }], TW, T).map((x) => x.text),
    ["Laws Rule 18.6 (Quinshon Judkins 18.6), Kreussers 7.0 (Steelers defense 7.0)."]);

  // ---- 3a'. the orchestrator, end to end on a fixture facts file (no network) ----
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "rg-week-"));
  const mk = (lu, stamp) => { const f = path.join(work, `facts-${stamp}.json`);
    fs.writeFileSync(f, JSON.stringify({ season: 2026, week: 4, type: "preview", pulledAt: `2026-10-03T13:0${stamp}:00.000Z`, teams: { 5: T[5] }, lineups: { 5: lu }, rosterMeta: { 5: `2026-10-03T13:0${stamp}:00Z` }, leads: [], drafts: {} })); return f; };
  const wk = (f) => safeSync(() => execSync(`node tools/robogoat/week.mjs --week 4 --type preview --work "${path.join(work, "w")}" --from-facts "${f}" --now 2026-10-04T17:00:00Z`, { cwd: ROOT, encoding: "utf8" }));
  const out1 = wk(mk(R1, "1")), out2 = wk(mk(R2, "2"));
  const newest = JSON.parse(fs.readFileSync(path.join(ROOT, "robogoat/issues.json"), "utf8")).issues.map((x) => x.published).sort().pop();
  check("week.mjs: --since is the newest issue's day in issues.json (05:00Z)", out1.includes(`since: ${newest}T05:00:00.000Z`), out1.split("\n")[0]);
  check("week.mjs: the first run snapshots the lineups and says so", /First pull/.test(out1) && fs.existsSync(path.join(work, "w/lineups.latest.json")), out1);
  check("week.mjs: the re-run prints the keyed diff (Allen QB -> BENCH, Gordon added, Mahomes BENCH -> QB)",
    out2.includes("Sandy (Laws Rule): Josh Allen QB -> BENCH; Ollie Gordon added to RB; Patrick Mahomes BENCH -> QB"), out2);
  check("week.mjs: a re-run with the same lineup in another key order prints no changes", /No lineup changes/.test(wk(mk(R2.slice().reverse().map((x) => Object.fromEntries(Object.entries(x).reverse())), "3"))));

  const readme = fs.readFileSync(path.join(ROOT, "tools/robogoat/README.md"), "utf8");
  check("README: the routine is told to use week.mjs, to re-run it for the lineup diff, and where the leads and drafts are",
    /week\.mjs --week N --type recap\|preview/.test(readme) && /Run it again just before\s+building/.test(readme) && /kit\/leads\.md/.test(readme) && /kit\/drafts\.md/.test(readme));

  // ---- 3d. picks: computed from the scores; the build fails loudly when the column disagrees ----
  // Week 2: picks 11 (at 1) and 4 (at 5). 11 scored 124.8 to 97.08: W. 4 scored 76.96 to 151.82: L. Week 2 = 1-1.
  // Week 3: picks 1 (at 12) and 11 (at 5). 1 scored 175.5 to 132.18: W. 11 scored 105.54 to 123.26: L. Week 3 = 1-1. Season 2-2.
  const season = { picks: { 2: [{ team: 11, result: "W" }, { team: 4, result: "L" }], 3: [{ team: 1, result: "W" }, { team: 11, result: "L" }], 4: [{ team: 5, result: "" }] },
    weeks: { 2: { scores: { 1: 97.08, 11: 124.8, 4: 76.96, 5: 151.82 }, games: [{ away: 11, home: 1 }, { away: 4, home: 5 }] }, 3: { scores: { 1: 175.5, 12: 132.18, 11: 105.54, 5: 123.26 }, games: [{ away: 1, home: 12 }, { away: 11, home: 5 }] } } };
  const pairs = (w) => (season.weeks[w] ? season.weeks[w].games : null);
  await expect("picks: results computed from the scores (week 2 W, L; week 3 W, L)",
    () => [A.pickResults(season.picks[2], pairs(2), season.weeks[2].scores), A.pickResults(season.picks[3], pairs(3), season.weeks[3].scores)], [["W", "L"], ["W", "L"]]);
  await expect("picks: the preview's picksRecord 2-2 and the week 3 recap's picksWeek 1-1 agree with the scores",
    () => [A.picksProblems(season, { type: "preview", week: 4, picksRecord: "2-2", picks: [5] }, pairs), A.picksProblems(season, { type: "recap", week: 3, picksWeek: "1-1" }, pairs)], [[], []]);
  await expect("picks: a hand-written picksRecord of 3-1 is named as wrong", () => A.picksProblems(season, { type: "preview", week: 4, picksRecord: "3-1", picks: [5] }, pairs).map((m) => /picksRecord is "3-1".*score 2-2/.test(m)), [true]);
  await expect("picks: a recap picksWeek of 2-0 is named as wrong", () => A.picksProblems(season, { type: "recap", week: 3, picksWeek: "2-0" }, pairs).map((m) => /picksWeek is "2-0".*score 1-1/.test(m)), [true]);
  const bad = JSON.parse(JSON.stringify(season)); bad.picks[3][1].result = "W";
  await expect("picks: a season.json result that the scores contradict is named", () => A.picksProblems(bad, { type: "recap", week: 3, picksWeek: "1-1" }, pairs).some((m) => /picks\.3\[1\].*says "W".*say "L"/.test(m)), true);
  await expect("picks: the preview's picks array must be season.json's picks.N", () => A.picksProblems(season, { type: "preview", week: 4, picksRecord: "2-2", picks: [9] }, pairs).length, 1);
  await expect("picks: blank results are filled, an existing one is kept (and warned about), a tie stays blank",
    () => { const r = A.settlePicks({ 2: [{ team: 11, result: "" }, { team: 4, result: "W" }, { team: 9, result: "" }] }, { 2: ["W", "L", "T"] });
      return [r.picks[2].map((x) => x.result), r.settled, r.warnings.length]; }, [["W", "W", ""], ["2:11=W"], 2]);
  await expect("rankings: movement is last week's place minus this week's (up positive)", () => A.rankMovement([9, 11, 5, 12], [9, 5, 12, 2]), [0, 1, 1, null]);

  // Real build, on a copy of the real issues in a temp tree: an agreeing column builds, a disagreeing one throws.
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), "rg-build-"));
  const copy = (rel) => { const d = path.join(tree, "robogoat/2026", rel); fs.mkdirSync(d, { recursive: true });
    for (const f of fs.readdirSync(path.join(ROOT, "robogoat/2026", rel))) if (/\.(md|json)$/.test(f)) fs.copyFileSync(path.join(ROOT, "robogoat/2026", rel, f), path.join(d, f)); return d; };
  copy("week-3"); const d4 = copy("week-4-preview"); fs.copyFileSync(path.join(ROOT, "robogoat/2026/season.json"), path.join(tree, "robogoat/2026/season.json"));
  const B = await safe(() => import(pathToFileURL(path.join(ROOT, "tools/robogoat/build.mjs")).href));
  const build = (rel) => { try { return B.buildIssue(path.join(tree, "robogoat/2026", rel)).page; } catch (e) { return "ERR " + e.message; } };
  // The copy sits outside the repo, so its relative links to logos/ differ; put the repo's back before comparing.
  const same = (rel) => build(rel).split(path.relative(path.join(tree, "robogoat/2026", rel), path.join(ROOT, "robogoat")).split(path.sep).join("/")).join("../..") === pg(`robogoat/2026/${rel}/index.html`);
  check("build: the real week 3 and week 4 preview build from a copy with picks and rankings agreeing", same("week-3") && same("week-4-preview"));
  // A preview's own week's picks are graded in season.json once the week is played (facts.mjs fills
  // the results on the recap run). The preview must still show them open, as published: the Week 4
  // recap run (2026-10-06) graded picks.4 and turned the live preview's "this week" into "3-1".
  // Not vacuous: it requires picks.4 to be graded before it looks at the page.
  {
    const graded = (JSON.parse(fs.readFileSync(path.join(tree, "robogoat/2026/season.json"), "utf8")).picks["4"] || []).every((p) => p.result === "W" || p.result === "L");
    const row = (build("week-4-preview").match(/<li[^>]*><b>Week 4<\/b><span class="pks">(.*?)<\/span><span class="nw">([^<]*)<\/span>/) || []);
    check("build: a preview keeps its own week's picks open after season.json grades them (the page as published)",
      graded && /^(<i class="pk open"[^>]*><\/i>){4}$/.test(row[1] || "") && row[2] === "this week", `graded=${graded} nw=${row[2]}`);
  }
  const i4 = path.join(d4, "issue.json"), j4 = JSON.parse(fs.readFileSync(i4, "utf8"));
  fs.writeFileSync(i4, JSON.stringify({ ...j4, picksRecord: "6-2" }));
  check("build: week 4's picksRecord edited to 6-2 fails the build, naming the real record", /^ERR .*picksRecord is "6-2".*score 7-1/s.test(build("week-4-preview")), build("week-4-preview").slice(0, 200));
  fs.writeFileSync(i4, JSON.stringify(j4));
  const sj = path.join(tree, "robogoat/2026/season.json"), s0 = fs.readFileSync(sj, "utf8"), sd = JSON.parse(s0);
  sd.picks["3"][0].result = "L"; fs.writeFileSync(sj, JSON.stringify(sd));
  check("build: a season.json pick result the scores contradict fails the build", /^ERR .*picks\.3\[0\].*says "L".*say "W"/s.test(build("week-3")), build("week-3").slice(0, 200));
  fs.writeFileSync(sj, s0);
  const c3 = path.join(tree, "robogoat/2026/week-3/column.md"), md0 = fs.readFileSync(c3, "utf8");
  const ml = md0.split("\n"), rk = ml.map((l, i) => (/^\d+\. .+ \(\w+, \d-\d\)\./.test(l) ? i : -1)).filter((i) => i >= 0);
  const l0 = ml[rk[0]], l1 = ml[rk[1]];
  ml[rk[0]] = l1.replace(/^\d+/, "1"); ml[rk[1]] = l0.replace(/^\d+/, "2");
  fs.writeFileSync(c3, ml.join("\n"));
  check("build: swapping power-ranking lines 1 and 2 in the column fails the build against season.json rankings", /^ERR .*power rankings/s.test(build("week-3")), build("week-3").slice(0, 200));
  const ml2 = md0.split("\n"); ml2[rk[0]] = ml2[rk[0]].replace(/\((\w+), \d-\d\)\./, "($1, 9-9).");
  fs.writeFileSync(c3, ml2.join("\n"));
  check("build: a power-ranking record that differs from the issue's records fails the build", /^ERR .*9-9/s.test(build("week-3")), build("week-3").slice(0, 200));
  fs.writeFileSync(c3, md0);
  check("build: restored, the copy builds again", same("week-3"));
  // Pairings kept in season.json (weeks 1-3) are the real ones: week 3's against its own issue.json.
  const sj3 = JSON.parse(pg("robogoat/2026/season.json")), iss3 = JSON.parse(pg("robogoat/2026/week-3/issue.json"));
  check("season.json keeps each finished week's pairings; week 3's equal the week 3 issue's games",
    [1, 2, 3].every((w) => sj3.weeks[w].games && sj3.weeks[w].games.length === 4) && JSON.stringify(sj3.weeks[3].games) === JSON.stringify(iss3.games.map((g) => ({ away: g.away, home: g.home }))));
  // A tied game is nobody's win: the old code counted a tie as a home win, so the home team read "won" in the
  // bench panel and on the star cards. Week 3 has four winners; with one game tied there are three.
  const wonCount = (h) => (h.match(/, won<\/small>/g) || []).length;
  const tieIssue = JSON.parse(pg("robogoat/2026/week-3/issue.json")); tieIssue.games[0].homePts = tieIssue.games[0].awayPts;
  fs.writeFileSync(path.join(tree, "robogoat/2026/week-3/issue.json"), JSON.stringify(tieIssue));
  const tied = build("week-3");
  check("build: a tied game has no winner (bench panel shows one fewer 'won')", !/^ERR/.test(tied) && wonCount(tied) === wonCount(pg("robogoat/2026/week-3/index.html")) - 1,
    wonCount(tied) + " vs " + wonCount(pg("robogoat/2026/week-3/index.html")));
}
function safeSync(fn) { try { return fn(); } catch (e) { return "threw: " + (e && e.message ? e.message.split("\n")[0] : e); } }

function finish() {
  console.log(`\nrobogoat: ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}
