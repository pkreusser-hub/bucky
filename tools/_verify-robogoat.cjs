#!/usr/bin/env node
// tools/_verify-robogoat.cjs — the RoboGoat newsletter pages (robogoat/<season>/week-<n>/).
//
// Static pages the league is emailed a link to. What this guards, and why each check exists:
//   * phone first: no horizontal scroll at 360/390 px, and the win-probability chart swaps to its
//     phone-sized SVG (the desktop one scaled to ~8px type on a phone);
//   * numbers: one decimal unless the second one decides something (user, 2026-09-29) — the only
//     two-decimal values allowed are the ones the column is ABOUT (0.46/0.16 margins, 6.86 vs 6.90);
//   * names: owners by first name; Laws Rule is Sandy, never "Mom" outside a verbatim chat quote;
//   * arithmetic, hand-computed here from the app's weekly totals (not read back from the page):
//     scoreboard values, standings points and order, bench-bar proportions;
//   * the link preview (og:image) exists, and the page stays out of search engines.
// External requests (Google Fonts, ESPN headshots) are blocked: the page must lay out on fallbacks.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PAGE = "/robogoat/2026/week-3/";

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
const MIME = { ".html": "text/html; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".css": "text/css" };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((q, r) => {
      let f = path.join(ROOT, decodeURIComponent(q.url.split("?")[0]));
      if (f.endsWith(path.sep) || f.endsWith("/")) f = path.join(f, "index.html");
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); return r.end("nope"); }
      r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
      r.end(fs.readFileSync(f));
    }).listen(0, "127.0.0.1", () => res(srv));
  });
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? "  -> " + detail : "")); }
}
const norm = (t) => String(t || "").replace(/\s+/g, " ").trim();
const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

// The app's finalized weekly totals (weekly_2026_w1..w3), by team: hand-entered, not read from the page.
const WEEKLY = {
  "Battle Kreussers": [125.10, 97.08, 175.50], "Elanikan Skywalkers": [121.20, 116.38, 125.58],
  "Wyoming Cowboys": [158.30, 136.44, 120.08], "Chula Vista Jaguarrams": [162.22, 76.96, 112.22],
  "Laws Rule": [128.36, 151.82, 123.26], "Scruffy Looking Nerfherders": [165.26, 151.82, 148.98],
  "Kruz Control": [132.56, 124.80, 105.54], "The GOAT Kids": [120.66, 149.48, 132.18],
};
const WINS = { "Battle Kreussers": 2, "Elanikan Skywalkers": 1, "Wyoming Cowboys": 1, "Chula Vista Jaguarrams": 1,
  "Laws Rule": 2, "Scruffy Looking Nerfherders": 2, "Kruz Control": 2, "The GOAT Kids": 1 };
const OWNERS = ["Perry", "John", "Calvin", "Sandy", "Isaac", "Tom", "Elan", "Joe"];
const GAMES = [["Battle Kreussers", 175.50, "Scruffy Looking Nerfherders", 148.98], ["Kruz Control", 105.54, "Laws Rule", 123.26],
  ["The GOAT Kids", 132.18, "Chula Vista Jaguarrams", 112.22], ["Elanikan Skywalkers", 125.58, "Wyoming Cowboys", 120.08]];
const BENCH = [44.80, 42.00, 40.22, 30.14, 23.30, 23.00, 6.90, 6.86];
const ALLOWED_2DP = new Set(["0.46", "0.16", "6.86", "6.90"]);

(async () => {
  const file = path.join(ROOT, PAGE, "index.html");
  check("page file exists", fs.existsSync(file), file);
  if (!fs.existsSync(file)) return finish();
  const html = fs.readFileSync(file, "utf8");

  // ---- static checks on the markup ----
  const og = (html.match(/property="og:image" content="([^"]+)"/) || [])[1] || "";
  check("og:image is an absolute goatfantasyleague.com URL", /^https:\/\/goatfantasyleague\.com\/robogoat\/2026\/week-3\/share\.png$/.test(og), og);
  check("og:image file is in the repo", fs.existsSync(path.join(ROOT, "robogoat/2026/week-3/share.png")));
  check("noindex (family names stay out of search engines)", /<meta name="robots" content="noindex">/.test(html));
  check("viewport meta for phones", /<meta name="viewport" content="width=device-width,initial-scale=1">/.test(html));
  check("no script tags (static page)", !/<script\b/i.test(html));

  const drv = loadDriver();
  const exe = chromeExe();
  const browser = await drv.lib.launch(Object.assign({ headless: true, args: ["--no-sandbox"] }, exe ? { executablePath: exe } : {}));
  const srv = await serve();
  const url = `http://127.0.0.1:${srv.address().port}${PAGE}`;

  for (const vw of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const errs = [];
    const page = await openPage(drv, browser, vw, url, errs);
    const tag = vw.width + "px";
    const m = await page.evaluate(() => {
      const vis = (e) => !!e && e.offsetParent !== null && getComputedStyle(e).display !== "none";
      const svgs = [...document.querySelectorAll("svg.wp")].filter((s) => getComputedStyle(s).display !== "none");
      const svg = svgs[0];
      let textOut = [];
      if (svg) {
        const vb = svg.viewBox.baseVal;
        for (const t of svg.querySelectorAll("text")) {
          const b = t.getBBox();
          if (b.x < vb.x - 0.5 || b.x + b.width > vb.x + vb.width + 0.5) textOut.push(t.textContent + " [" + Math.round(b.x) + "," + Math.round(b.x + b.width) + "]");
        }
      }
      const svgScale = svg ? svg.getBoundingClientRect().width / svg.viewBox.baseVal.width : 0;
      const fs = svg ? parseFloat(getComputedStyle(svg.querySelector("text")).fontSize) : 0;
      const local = [...document.images].filter((i) => i.src.startsWith(location.origin));
      return {
        sw: document.documentElement.scrollWidth, iw: innerWidth,
        visibleSvgs: svgs.map((s) => s.getAttribute("class")), textOut, typePx: fs * svgScale,
        brokenLocal: local.filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src")),
        localCount: local.length,
        bodyPx: parseFloat(getComputedStyle(document.querySelector("main > p")).fontSize),
        board: [...document.querySelectorAll(".board .game")].map((g) => [...g.querySelectorAll(".tr")].map((r) => ({
          name: r.querySelector(".tn b").textContent.trim(), pts: r.querySelector(".ts").textContent.trim(), win: r.classList.contains("win") }))),
        stand: [...document.querySelectorAll("table.stand tbody tr")].map((r) => ({
          name: r.querySelector(".tt b").textContent.trim(), wl: r.querySelector(".c").textContent.trim(), pf: r.querySelector(".r").textContent.trim() })),
        bars: [...document.querySelectorAll(".bench .brow")].map((r) => ({ w: r.querySelector(".bar").getBoundingClientRect().width, v: r.querySelector(".bv").textContent.trim() })),
        text: document.querySelector(".wrap").innerText,
        // a score or record ("35-27", "2-1") in copy must sit inside a no-wrap element, or phones split it at the hyphen
        hyphenBreaks: (() => {
          const out = [], w = document.createTreeWalker(document.querySelector("main"), NodeFilter.SHOW_TEXT);
          for (let n; (n = w.nextNode());) {
            if (n.parentElement.closest("svg")) continue;
            if (/\b\d+-\d+\b/.test(n.nodeValue) && getComputedStyle(n.parentElement).whiteSpace !== "nowrap") out.push(n.nodeValue.trim().slice(0, 60));
          }
          return out;
        })(),
        hed: vis(document.querySelector(".hed h1")),
      };
    });
    check(`${tag}: no page errors`, errs.length === 0, errs.join(" | "));
    check(`${tag}: no horizontal scroll`, m.sw <= m.iw, `${m.sw} > ${m.iw}`);
    check(`${tag}: every local image (team logos) loads`, m.brokenLocal.length === 0 && m.localCount >= 24, m.brokenLocal.join(", ") + ` (${m.localCount})`);
    const wantSvg = vw.width <= 560 ? "wp wp-sm" : "wp wp-lg";
    check(`${tag}: exactly one win-probability chart shows, the ${wantSvg.split(" ")[1]} one`, m.visibleSvgs.length === 1 && m.visibleSvgs[0] === wantSvg, m.visibleSvgs.join(","));
    check(`${tag}: chart type renders at >= 11px`, m.typePx >= 11, m.typePx.toFixed(1) + "px");
    check(`${tag}: no chart label spills outside the chart`, m.textOut.length === 0, m.textOut.join("; "));
    check(`${tag}: body copy >= 16px`, m.bodyPx >= 16, m.bodyPx + "px");
    await page.close();
    if (vw.width !== 390) continue;

    // ---- arithmetic and copy rules, once, on the phone layout ----
    GAMES.forEach(([a, ap, h, hp], i) => {
      const g = m.board[i] || [];
      const ok = g.length === 2 && g[0].name.toUpperCase() === a.toUpperCase() && g[0].pts === r1(ap)
        && g[1].name.toUpperCase() === h.toUpperCase() && g[1].pts === r1(hp) && g[0].win === (ap > hp) && g[1].win === (hp > ap);
      check(`scoreboard game ${i + 1}: ${a} ${r1(ap)}, ${h} ${r1(hp)}, winner marked`, ok, JSON.stringify(g));
    });
    const want = Object.keys(WEEKLY).map((n) => ({ n, w: WINS[n], pf: WEEKLY[n].reduce((s, x) => s + x, 0) }))
      .sort((x, y) => y.w - x.w || y.pf - x.pf);
    check("standings: order is wins, then points (hand-computed)", m.stand.map((s) => s.name).join("|") === want.map((x) => x.n).join("|"),
      m.stand.map((s) => s.name).join(" | "));
    check("standings: points are the three weekly totals summed, one decimal",
      want.every((x) => (m.stand.find((s) => s.name === x.n) || {}).pf === r1(x.pf)),
      want.map((x) => x.n + " " + r1(x.pf) + " vs " + (m.stand.find((s) => s.name === x.n) || {}).pf).join("; "));
    check("standings: W-L adds up (12 wins, 12 losses)", m.stand.reduce((s, x) => s + Number(x.wl.split("-")[0]), 0) === 12
      && m.stand.reduce((s, x) => s + Number(x.wl.split("-")[1]), 0) === 12);
    const ratioOk = m.bars.length === BENCH.length && m.bars.every((b, i) => Math.abs(b.w / m.bars[0].w - BENCH[i] / BENCH[0]) < 0.01);
    check("bench bars are proportional to the values", ratioOk, m.bars.map((b) => b.w.toFixed(1)).join(","));
    check("bench values: one decimal, except the tie that needs two (6.90 over 6.86)",
      m.bars.map((b) => b.v).join(",") === "44.8,42.0,40.2,30.1,23.3,23.0,6.90,6.86", m.bars.map((b) => b.v).join(","));

    const text = norm(m.text);
    const twoDp = [...new Set((text.match(/\b\d+\.\d{2}\b/g) || []))];
    check("no two-decimal numbers except the ones the column is about", twoDp.every((x) => ALLOWED_2DP.has(x)), twoDp.join(", "));
    const unquoted = text.replace(/“[^”]*”/g, " ");
    check('Laws Rule is "Sandy": no "Mom" outside a verbatim quote', !/\bmom\b/i.test(unquoted), (unquoted.match(/.{30}\bmom\b.{30}/i) || [""])[0]);
    check("every owner is named", OWNERS.every((o) => new RegExp("\\b" + o + "\\b").test(text)), OWNERS.filter((o) => !new RegExp("\\b" + o + "\\b").test(text)).join(","));
    check("curly quotes only (no straight double quotes in the copy)", !/"/.test(text));
    check("scores and records never split at the hyphen (each is in a no-wrap span)", m.hyphenBreaks.length === 0, m.hyphenBreaks.join(" | "));
    check("RoboGoat's record is stated (7-1)", /Picks record: 7-1/.test(text));
  }

  await browser.close();
  srv.close();
  finish();
})().catch((e) => { console.error(e); fail++; finish(); });

function finish() {
  console.log(`\nrobogoat: ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}
