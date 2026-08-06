// _verify-fftest.cjs — verification for the fantasy-data feasibility console (fftest.html).
//
//   node tools/_verify-fftest.cjs [--shots]
//
// The page polls ESPN's site API and Sleeper's public API DIRECTLY from the
// browser (both send ACAO:* — confirmed by the ff-data diag job in
// .github/workflows/sports-diag.yml). Both hosts are egress-blocked from this
// sandbox, so every cross-origin request is answered here by request
// interception with fixtures modeled on the diag job's real captures. What is
// under test is the page's engine: box-score parsing, Sleeper normalization,
// PPR scoring math (hand-computed expectations), change detection, cross-
// provider id matching, latency pairing, the checklist, and export.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const SRV_PORT = 8841;
const BASE = "http://127.0.0.1:" + SRV_PORT;
const SHOTS = process.argv.includes("--shots");
const SHOTS_DIR = path.join(ROOT, "shots");

let pass = 0, fail = 0; const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; failures.push(msg); console.log("  ✗ " + msg); }
}
function section(name) { console.log("\n== " + name + " =="); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- fixtures ----------------
// Phase 1 = pregame baseline stats · phase 2 = ESPN reports new stats first ·
// phase 3 = Sleeper catches up to the same values (latency pairs form).
const fixture = { phase: 1, sleeperDown: false };

const EID = "401850001";
function sbFix() {
  return {
    events: [{
      id: EID, shortName: "DAL @ PHI", name: "Dallas Cowboys at Philadelphia Eagles",
      date: "2026-08-06T19:00Z",
      competitions: [{
        id: EID,
        status: { type: { state: "in", shortDetail: "Q1 10:00" } },
        competitors: [
          { homeAway: "home", team: { abbreviation: "PHI" }, score: "7" },
          { homeAway: "away", team: { abbreviation: "DAL" }, score: "0" },
        ],
      }],
    }],
  };
}

// ESPN box score shape as captured by the diag job (labels drive parsing).
function espnAthlete(id, name, pos, stats) {
  return { athlete: { id, displayName: name, position: { abbreviation: pos } }, stats };
}
function summaryFix() {
  const p2 = fixture.phase >= 2;
  return {
    header: {
      competitions: [{
        competitors: [
          { homeAway: "home", team: { abbreviation: "PHI" }, score: p2 ? "14" : "7" },
          { homeAway: "away", team: { abbreviation: "DAL" }, score: "3" },
        ],
        status: { period: p2 ? 2 : 1, displayClock: p2 ? "8:12" : "4:30", type: { state: "in", shortDetail: "Q2 8:12" } },
      }],
    },
    boxscore: {
      players: [
        {
          team: { abbreviation: "PHI" },
          statistics: [
            { name: "passing", labels: ["C/ATT", "YDS", "AVG", "TD", "INT", "SACKS", "QBR", "RTG"],
              athletes: [espnAthlete("3915511", "P. Passer", "QB",
                p2 ? ["12/16", "131", "8.2", "1", "0", "1-8", "77", "112"] : ["10/14", "112", "8.0", "1", "0", "1-8", "70", "108"])] },
            { name: "receiving", labels: ["REC", "YDS", "AVG", "TD", "LONG", "TGTS"],
              athletes: [espnAthlete("4361741", "W. Receiver", "WR",
                p2 ? ["4", "52", "13.0", "1", "24", "6"] : ["3", "41", "13.7", "0", "22", "5"])] },
            { name: "fumbles", labels: ["FUM", "LOST", "REC"],
              athletes: [espnAthlete("3915511", "P. Passer", "QB", ["1", "0", "1"])] },
          ],
        },
        {
          team: { abbreviation: "DAL" },
          statistics: [
            { name: "rushing", labels: ["CAR", "YDS", "AVG", "TD", "LONG"],
              athletes: [espnAthlete("4241457", "R. Rusher", "RB", ["6", "28", "4.7", "0", "9"])] },
            { name: "kicking", labels: ["FG", "PCT", "LONG", "XP", "PTS"],
              athletes: [espnAthlete("2473037", "K. Kicker", "K", ["1/1", "100.0", "27", "1/1", "4"])] },
          ],
        },
      ],
    },
  };
}

// Sleeper fixtures — v1 shapes (map keyed by sleeper player_id).
const slpStateFix = { season: "2026", season_type: "pre", week: 1, leg: 1 };
const slpPlayersFix = {
  "6904": { full_name: "P. Passer", team: "PHI", position: "QB", espn_id: 3915511, injury_status: "Questionable" },
  "7564": { full_name: "W. Receiver", team: "PHI", position: "WR", espn_id: 4361741 },
  "4866": { full_name: "R. Rusher", team: "DAL", position: "RB", espn_id: 4241457 },
  "1266": { full_name: "K. Kicker", team: "DAL", position: "K", espn_id: 2473037 },
  "9999": { full_name: "N. Noid", team: "PHI", position: "TE" }, // no espn_id -> slp_ key
  PHI: { first_name: "Philadelphia", last_name: "Eagles", team: "PHI", position: "DEF" },
  "5555": { full_name: "Other Guy", team: "KC", position: "WR", espn_id: 111 }, // not in this game
};
function slpStatsFix() {
  const p3 = fixture.phase >= 3;
  return {
    "6904": p3
      ? { pass_yd: 131, pass_td: 1, pass_int: 0, pass_att: 16, pass_cmp: 12, pts_ppr: 9.24, off_snp: 18 }
      : { pass_yd: 112, pass_td: 1, pass_int: 0, pass_att: 14, pass_cmp: 10, pts_ppr: 8.48, off_snp: 14 },
    "7564": p3
      ? { rec: 4, rec_yd: 52, rec_td: 1, rec_tgt: 6, pts_ppr: 15.2, off_snp: 16 }
      : { rec: 3, rec_yd: 41, rec_tgt: 5, pts_ppr: 7.1, off_snp: 12 },
    "4866": { rush_yd: 28, rush_att: 6, pts_ppr: 2.8 },
    "1266": { fgm: 1, fga: 1, xpm: 1, xpa: 1, fgm_20_29: 1, pts_ppr: 4 },
    "9999": { rec: 2, rec_yd: 15, rec_2pt: 1, pts_ppr: 5.5 },
    PHI: { pts_allow: 3, sack: 1, pts_ppr: 5 },
    "5555": { rec: 9, rec_yd: 120, pts_ppr: 21 }, // other game — must be filtered out
  };
}
const slpProjFix = { "7564": { pts_ppr: 12.4 }, "6904": { pts_ppr: 17.8 } };

// Hand-computed PPR expectations (independent of the page's SCORING table):
//   QB p1: 112*.04 + 4 = 8.48        QB p2/3: 131*.04 + 4 = 9.24
//   WR p1: 3 + 41*.1 = 7.1           WR p2/3: 4 + 52*.1 + 6 = 15.2
//   RB: 28*.1 = 2.8    K: 1*3 + 1*1 = 4    TE(no espn id): 2 + 1.5 + 2 = 5.5

// ---------------- servers / browser ----------------
function startStatic() {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html");
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end("nope"); return; }
    const ext = path.extname(p);
    const mime = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(fs.readFileSync(p));
  });
  return new Promise((resolve) => srv.listen(SRV_PORT, "127.0.0.1", () => resolve(srv)));
}

function chromeExe() {
  const cands = [process.env.BUCKY_CHROME, "/opt/pw-browsers/chromium"];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return null;
}
async function launchBrowser() {
  const exe = chromeExe();
  const opts = { headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] };
  if (exe) opts.executablePath = exe; else opts.channel = "chrome";
  return puppeteer.launch(opts);
}

async function newTestPage(browser, opts) {
  opts = opts || {};
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(opts.vw || { width: 1200, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Export capture: stash the blob text where the suite can read it.
  await page.evaluateOnNewDocument(() => {
    window.__blobText = null;
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      if (b && b.text) b.text().then((t) => { window.__blobText = t; });
      try { return orig(b); } catch (e) { return "blob:fake"; }
    };
    HTMLAnchorElement.prototype.click = function () {};
  });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    const cors = { "Access-Control-Allow-Origin": "*" };
    const json = (obj) => req.respond({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(obj) });
    try {
      if (u.startsWith(BASE)) return req.continue();
      if (u.includes("site.api.espn.com")) {
        if (u.includes("/scoreboard")) return json(sbFix());
        if (u.includes("/summary")) return json(summaryFix());
        return req.respond({ status: 404, headers: cors, body: "{}" });
      }
      if (u.includes("api.sleeper.app")) {
        if (fixture.sleeperDown) return req.respond({ status: 503, contentType: "application/json", headers: cors, body: '{"error":"down"}' });
        if (u.endsWith("/state/nfl")) return json(slpStateFix);
        if (u.endsWith("/players/nfl")) return json(slpPlayersFix);
        if (u.includes("/stats/nfl/")) return json(slpStatsFix());
        if (u.includes("/projections/nfl/")) return json(slpProjFix);
        return req.respond({ status: 404, headers: cors, body: "{}" });
      }
      return req.abort();
    } catch (e) { /* interception raced page close */ }
  });
  return { ctx, page, errors };
}

const poll = async (page) => {
  await page.evaluate(async () => {
    await Promise.allSettled([window.__FFTEST__.pollEspn(), window.__FFTEST__.pollSleeper()]);
    window.__FFTEST__.renderAll();
  });
};
const rowByName = async (page, name) => page.evaluate((nm) => {
  const tr = [...document.querySelectorAll("#pTable tbody tr")].find((r) => r.cells[0].textContent === nm);
  return tr ? [...tr.cells].map((c) => c.textContent.trim()) : null;
}, name);

// ---------------- main ----------------
(async () => {
  const srv = await startStatic();
  const browser = await launchBrowser();

  // ---- A: boot + discovery + baseline ----
  section("A · boot, discovery, baseline stats + scoring math");
  {
    fixture.phase = 1; fixture.sleeperDown = false;
    const { ctx, page, errors } = await newTestPage(browser);
    await page.goto(BASE + "/fftest.html", { waitUntil: "networkidle0" });
    await page.waitForSelector(".gamebtn", { timeout: 8000 });
    ok(true, "page boots and renders tonight's slate from the ESPN scoreboard");
    const btnTxt = await page.$eval(".gamebtn", (b) => b.textContent);
    ok(/DAL @ PHI/.test(btnTxt), "game button carries the matchup label");
    ok(/LIVE/.test(btnTxt), "in-progress game is flagged LIVE");

    await page.click(".gamebtn");
    ok(await page.$eval("#startBtn", (b) => !b.disabled), "picking a game arms the Start button");
    ok((await page.$eval("#slpWeek", (i) => i.value)) === "1" &&
       (await page.$eval("#slpType", (i) => i.value)) === "pre",
      "Sleeper bucket inputs prefilled from /state (pre · wk 1)");

    await page.click("#startBtn");
    await page.waitForFunction(() => document.querySelectorAll("#pTable tbody tr").length >= 5, { timeout: 8000 });
    await page.evaluate(() => window.__FFTEST__.pause());
    ok(true, "start loads the Sleeper directory and the first poll fills the table");

    const qb = await rowByName(page, "P. Passer");
    ok(qb && qb[3] === "8.5" && qb[4] === "8.5", "QB PPR both sides = 8.5 (112*.04+4=8.48, hand-computed)");
    ok(qb && qb[6] === "8.5" && qb[7] === "✓", "QB engine check ✓ vs Sleeper's official pts_ppr");
    ok(qb && qb[13] === "Questionable", "injury status surfaces from the Sleeper directory");
    ok(qb && qb[12] === "17.8", "Sleeper projection column populated");
    const wr = await rowByName(page, "W. Receiver");
    ok(wr && wr[4] === "7.1" && wr[7] === "✓", "WR 3rec/41yd = 7.1 and engine ✓");
    const te = await rowByName(page, "N. Noid");
    ok(te && te[4] === "5.5", "Sleeper-only player (no espn_id) still gets a row (2pt worth 2 included)");
    const dst = await rowByName(page, "PHI D/ST");
    ok(dst && dst[6] === "5.0" && dst[7] === "—", "DST row shows Sleeper official pts, engine check suppressed");
    ok(!(await rowByName(page, "Other Guy")), "player from another game is filtered out of the table");

    const match = await page.$eval("#matchline", (el) => el.textContent);
    ok(/4\/4/.test(match), "id match line: 4/4 ESPN box players found via Sleeper espn_id (" + match + ")");
    const score = await page.$eval("#scorehdr", (el) => el.textContent);
    ok(/DAL 3 — 7 PHI/.test(score), "score header away-first (" + score + ")");
    ok(/Q1 · 4:30 · LIVE/.test(await page.$eval("#clockline", (el) => el.textContent)), "clock line shows quarter + clock");

    const evN = await page.evaluate(() => window.__FFTEST__.S.events.filter((e) => !e.msg).length);
    ok(evN === 0, "baseline poll seeds silently — no change-event flood");

    // Checklist after baseline.
    const marks = await page.evaluate(() => {
      const out = {};
      for (const tr of document.querySelectorAll("#ckTable tbody tr")) out[tr.cells[0].textContent] = [tr.cells[1].textContent, tr.cells[2].textContent];
      return out;
    });
    ok(marks["Passing yds / TD / INT"].join() === "✓,✓", "checklist: passing ✓/✓");
    ok(marks["Kicker FG / XP"].join() === "✓,✓", "checklist: kicking ✓/✓");
    ok(marks["FG distance splits (40-49, 50+)"].join() === "✗,✓", "checklist: FG distances ✗ ESPN / ✓ Sleeper");
    ok(marks["Team defense (D/ST) stat rows"][1] === "✓", "checklist: DST ✓ Sleeper");
    ok(marks["Snap counts"][1] === "✓", "checklist: snap counts ✓ Sleeper (off_snp)");
    ok(marks["Cross-provider player IDs"][1] === "✓", "checklist: id mapping ✓ (match rate ≥ 50%)");
    ok(marks["Stats actually updating during play"].join() === "…,…", "checklist: live-updates row still pending before any change");

    // ---- B: phase 2 — ESPN moves first ----
    section("B · change detection — ESPN updates first");
    fixture.phase = 2;
    await poll(page);
    const qb2 = await rowByName(page, "P. Passer");
    ok(qb2 && qb2[3] === "9.2" && qb2[4] === "8.5", "QB now 9.2 on ESPN while Sleeper still 8.5");
    const evs = await page.evaluate(() => window.__FFTEST__.S.events.filter((e) => !e.msg).map((e) => e.src + ":" + e.name + ":" + e.stat + ":" + e.to));
    ok(evs.includes("espn:P. Passer:pass_yd:131"), "event feed logged QB pass_yd 112→131 from ESPN");
    ok(evs.includes("espn:W. Receiver:rec_td:1"), "event feed logged the WR touchdown from ESPN");
    ok(!evs.some((e) => e.startsWith("slp:")), "no Sleeper events yet — it has not caught up");
    ok((await page.evaluate(() => window.__FFTEST__.S.samples.length)) === 0, "no latency pairs until both sources report the value");
    const marks2 = await page.evaluate(() => [...document.querySelectorAll("#ckTable tbody tr")].map((tr) => [tr.cells[0].textContent, tr.cells[1].textContent, tr.cells[2].textContent]).find((r) => r[0].startsWith("Stats actually")));
    ok(marks2[1] === "✓" && marks2[2] === "…", "live-updates checklist: ESPN ✓, Sleeper still pending");

    // ---- C: phase 3 — Sleeper catches up, latency pairs form ----
    section("C · latency pairing — Sleeper catches up");
    fixture.phase = 3;
    await sleep(700); // real wall-clock gap so the lag measurement is non-zero
    await poll(page);
    const samples = await page.evaluate(() => window.__FFTEST__.S.samples);
    ok(samples.length >= 3, "latency samples formed once both sources agree (" + samples.length + ")");
    ok(samples.every((s) => s.d >= 0.5), "every sample shows Sleeper trailing by the real wall-clock gap");
    ok(samples.some((s) => s.stat === "rec_td" && s.val === 1), "the WR touchdown is one of the paired samples");
    const lat = await page.$eval("#latSummary", (el) => el.textContent);
    ok(/median Sleeper lag \+/.test(lat) && /ESPN first \d+×/.test(lat), "latency summary: median + first-counts (" + lat + ")");
    const qb3 = await rowByName(page, "P. Passer");
    ok(qb3 && qb3[4] === "9.2" && qb3[7] === "✓", "Sleeper caught up to 9.2 and engine still ✓ vs new official");
    const wr3 = await rowByName(page, "W. Receiver");
    ok(wr3 && wr3[3] === "15.2" && wr3[4] === "15.2" && wr3[5] === "", "WR 15.2 both sides (4rec 52yd TD), Δ clear");
    if (SHOTS) {
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS_DIR, "fftest_desktop.png"), fullPage: true });
      console.log("  📸 shots/fftest_desktop.png");
    }

    // ---- D: export ----
    section("D · export");
    await page.click("#exportBtn");
    await page.waitForFunction(() => window.__blobText, { timeout: 5000 });
    const exp = JSON.parse(await page.evaluate(() => window.__blobText));
    ok(exp.game.id === EID, "export carries the game id");
    ok(Array.isArray(exp.events) && exp.events.length >= 5, "export carries the event log");
    ok(Array.isArray(exp.latencySamples) && exp.latencySamples.length === samples.length, "export carries the latency samples");
    ok(exp.players.some((p) => p.name === "P. Passer" && p.espn && p.espn.pts === 9.24), "export carries full per-player stat lines");
    ok(exp.scoring && exp.scoring.rec === 1, "export records the scoring settings used");

    ok(errors.length === 0, "0 page errors through the whole run" + (errors.length ? " — " + errors[0] : ""));
    await ctx.close();
  }

  // ---- E: Sleeper outage degrades, ESPN alone still works ----
  section("E · Sleeper down — ESPN side still runs, failure visible");
  {
    fixture.phase = 1; fixture.sleeperDown = true;
    const { ctx, page, errors } = await newTestPage(browser);
    await page.goto(BASE + "/fftest.html", { waitUntil: "networkidle0" });
    await page.waitForSelector(".gamebtn", { timeout: 8000 });
    await page.click(".gamebtn");
    await page.click("#startBtn");
    await page.waitForFunction(() => document.querySelectorAll("#pTable tbody tr").length >= 3, { timeout: 8000 });
    await page.evaluate(() => window.__FFTEST__.pause());
    const qb = await rowByName(page, "P. Passer");
    ok(qb && qb[3] === "8.5" && qb[4] === "—", "ESPN points computed, Sleeper column honestly empty");
    const ep = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#epTable tbody tr")];
      const bad = rows.filter((r) => /sleeper/.test(r.cells[0].textContent) && /HTTP 503/.test(r.cells[6].textContent));
      return bad.length;
    });
    ok(ep >= 1, "endpoint table shows the Sleeper 503s in red instead of hiding them");
    ok(errors.length === 0, "0 page errors with Sleeper down");
    await ctx.close();
  }

  // ---- F: mobile ----
  section("F · phone viewport");
  {
    fixture.phase = 3; fixture.sleeperDown = false;
    const { ctx, page, errors } = await newTestPage(browser, { vw: { width: 390, height: 844 } });
    await page.goto(BASE + "/fftest.html", { waitUntil: "networkidle0" });
    await page.waitForSelector(".gamebtn", { timeout: 8000 });
    await page.click(".gamebtn");
    await page.click("#startBtn");
    await page.waitForFunction(() => document.querySelectorAll("#pTable tbody tr").length >= 5, { timeout: 8000 });
    await page.evaluate(() => window.__FFTEST__.pause());
    const scroll = await page.evaluate(() => ({ body: document.body.scrollWidth, win: window.innerWidth }));
    ok(scroll.body <= scroll.win + 1, "no sideways body scroll at 390px (tables pan inside .panner) — " + scroll.body + "/" + scroll.win);
    if (SHOTS) {
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS_DIR, "fftest_mobile.png"), fullPage: true });
      console.log("  📸 shots/fftest_mobile.png");
    }
    ok(errors.length === 0, "0 page errors at 390px");
    await ctx.close();
  }

  await browser.close();
  srv.close();

  console.log("\n================================");
  console.log(`PASS ${pass} · FAIL ${fail}`);
  if (fail) { console.log("Failures:"); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
})().catch((e) => { console.error("SUITE CRASH:", e); process.exit(1); });
