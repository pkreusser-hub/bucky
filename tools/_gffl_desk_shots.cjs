// _gffl_desk_shots.cjs — photograph the League tab's DESKTOP redesign (2026-08-11).
//
//   node tools/_gffl_desk_shots.cjs
//
// The user's brief was that the League tab "looks too much like an app" on a desktop, so these
// plates exist to be LOOKED AT: the two-column dashboard at 1440 and at 1280 (the tightest
// width the design has to survive with every standings column on screen), and the phone at 390
// to prove the mobile layout is untouched by any of it.
//
// Every plate ASSERTS what its filename claims BEFORE it is written (house rule) — a shot of a
// dashboard whose chat rail never mounted, or whose standings table is quietly panning inside a
// scroller, is worse than no shot at all. Serves the worktree root itself rather than relying on
// a preview server, so it can never photograph a different checkout by accident.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8875;
const BASE = "http://127.0.0.1:" + PORT;
const FAM = "test1";
const LSPFX = "lg_gffl_" + FAM + "_";

let pass = 0, fail = 0; const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; failures.push(msg); console.log("  ✗ " + msg); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };

function serve() {
  return http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const f = path.join(ROOT, rel || "index.html");
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end("nope");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  }).listen(PORT);
}

async function launch() {
  const cands = [process.env.BUCKY_CHROME, "/opt/pw-browsers/chromium"];
  const exe = cands.find((c) => c && fs.existsSync(c));
  const opts = { headless: "new", args: ["--no-sandbox", "--force-device-scale-factor=2"] };
  if (exe) opts.executablePath = exe; else opts.channel = "chrome";
  return puppeteer.launch(opts);
}

// ---- a league with enough PAST to make every new column say something ----
const NAMES = ["Battle Kreussers", "End Zone Goats", "Wyoming Cowboys", "Waffle House Warriors",
  "Nails For Breakfast", "Kruz Control", "Nerfherders", "The Goat Kids"];
const COLORS = ["#0b4f9e", "#c8102e", "#f2a900", "#0b6b3a", "#5b2d8e", "#e0561a", "#127f8f", "#8a1538"];
const ROSTER = [
  ["3915511", "Joshua Passer", "QB", "PHI", "QB"], ["4241457", "Ricky Rusher", "RB", "DAL", "RB"],
  ["111888", "Sam Second", "RB", "DEN", "RB"], ["4361741", "Wesley Receiver", "WR", "PHI", "WR"],
  ["111555", "Walter Two", "WR", "DEN", "WR"], ["111222", "Terry Tight", "TE", "KC", "TE"],
  ["111444", "Frank Flexman", "RB", "DEN", "FLEX"], ["dst_PHI", "PHI D/ST", "DST", "PHI", "DST"],
  ["2473037", "Kevin Kicker", "K", "DAL", "K"],
  ["111999", "Benny Bench", "WR", "KC", "BENCH"], ["111111", "Carl Cover", "RB", "PHI", "BENCH"],
];
// The circle-method schedule the app itself would generate — 14 weeks of real pairings, so the
// playoff-odds Monte Carlo has genuine remaining games to simulate rather than an empty season.
function sched() {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];
  const n = ids.length, rounds = n - 1, fixed = ids[0], rot = ids.slice(1), singles = [];
  for (let r = 0; r < rounds; r++) {
    const wk = [], row = [fixed, ...rot];
    for (let i = 0; i < n / 2; i++) wk.push(r % 2 ? [row[i], row[n - 1 - i]] : [row[n - 1 - i], row[i]]);
    singles.push(wk);
    rot.unshift(rot.pop());
  }
  const out = [];
  for (let w = 0; w < 14; w++) {
    const base = singles[w % rounds];
    out.push(w < rounds ? base : base.map(([h, a]) => [a, h]));
  }
  return { kind: "sched", season: 2026, weeks: out.map((wk) => ({ g: wk.map(([h, a]) => ({ h, a })) })) };
}
function seedDocs() {
  const out = {};
  NAMES.forEach((n, i) => {
    out["team_" + (i + 1)] = { kind: "team", teamId: i + 1, name: n, abbrev: "T" + (i + 1), owner: "",
      colors: { primary: COLORS[i] }, colorsCustom: true };
  });
  out.sched_2026 = sched();
  const S = out.sched_2026.weeks;
  for (let t = 1; t <= 8; t++) {
    for (const wk of [1, 2, 3]) {
      out["roster_2026_w" + wk + "_t" + t] = { kind: "roster", week: wk, teamId: t,
        players: ROSTER.map(([k, nm, p, tm, s]) => ({ key: /^dst_/.test(k) ? k : String(Number(k) + t), name: nm, pos: p, team: tm, slot: s })) };
    }
  }
  // TWO finalized weeks — enough for a real streak ("W2"/"L2"), a power snapshot with movement,
  // and a playoff-odds field that is no longer a coin flip.
  const score = (wk, h, a) => {
    // Deterministic, and deliberately lopsided by team id so the standings actually separate.
    const f = (id) => 90 + (9 - id) * 6 + ((wk * 7 + id) % 5);
    return { home: h, away: a, homePts: f(h), awayPts: f(a) };
  };
  for (const wk of [1, 2]) {
    const games = S[wk - 1].g.map((g) => score(wk, g.h, g.a));
    out["weekly_2026_w" + wk] = { kind: "weekly", week: wk, matchups: games, awards: {},
      power: [1, 2, 3, 4, 5, 6, 7, 8].map((id, i) => ({ teamId: id, rank: wk === 1 ? i + 1 : (i === 0 ? 2 : i === 1 ? 1 : i + 1), score: 100 - i * 4 })),
      accuracy: null, finalizedAt: 1000 + wk };
  }
  // A season of imported history, so the All-time card has a real table to show.
  out.hist_2024 = { kind: "hist", season: 2024, leagueName: "GFFL",
    teams: NAMES.map((n, i) => ({ id: i + 1, name: n, abbrev: "T" + (i + 1), owner: "", w: 12 - i, l: 2 + i, t: 0, pf: 1700 - i * 55, pa: 1500 + i * 20, place: i + 1 })),
    champion: { teamId: 1, name: NAMES[0] },
    matchups: [{ week: 1, home: 1, away: 2, homePts: 150.2, awayPts: 100.1 }] };
  return out;
}
const SEED_DOCS = seedDocs();

async function newPage(browser, viewport) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument((docs, pfx) => {
    window.__prompts = ["Peter"];
    window.prompt = () => (window.__prompts.length ? window.__prompts.shift() : "1234");
    window.alert = () => {}; window.confirm = () => true;
    try {
      localStorage.setItem("gffl_pass", "amenfarms");
      localStorage.setItem("gffl_team", "1");
      localStorage.setItem("gffl_who", "Peter");
      for (const id of Object.keys(docs)) localStorage.setItem(pfx + id, JSON.stringify(docs[id]));
    } catch (e) {}
  }, SEED_DOCS, LSPFX);
  // Cloud + upstreams blocked: these plates are of the APP's own chrome, and a headless run
  // that reaches production Firestore is exactly how this repo has duplicated live data before.
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (u.startsWith(BASE)) return req.continue();
    if (/googleapis|firestore|firebase|gstatic/.test(u)) return req.abort();
    return req.respond({ status: 200, contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" });
  });
  await page.goto(BASE + "/league.html?fam=" + FAM + "&sim=0", { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__GFFL__ && window.__GFFL__.LG.rules, { timeout: 20000 });
  // Chat + a transaction log, written through the app's OWN api so the plates photograph the
  // real shapes. The player names are the ones on the seeded rosters — that is what makes the
  // "names in chat are tappable" plate a real picture rather than a styled sentence.
  await page.evaluate(async () => {
    const LG = window.__GFFL__.LG;
    // Stamps have to be STAGGERED. Chat and the tx log both sort by `t`, and six writes inside
    // one millisecond leave the sort with nothing to separate them — which showed up as the
    // three messages coming out in a different order on two consecutive runs of this very
    // script. Real posts are minutes apart; the fixture says so out loud.
    const realNow = Date.now;
    let fake = realNow() - 600000;
    Date.now = () => (fake += 60000);
    // Rail balance (2026-08-11): 13 OLDER filler moves so the desktop Moves panel can prove
    // its 14-row cap (8 → 14). Stamped FIRST so the three named, readable moves stay newest
    // and lead the panel; the phone card is a collapsed <details> and never counts rows, so
    // these cost the 390 plate nothing.
    for (let i = 0; i < 13; i++) {
      await LG.logTx("fa_add", 3, 1 + (i % 4), { addKey: "111100" + i, addName: "Filler Player" + i });
    }
    await LG.logTx("fa_add", 3, 1, { addKey: "1111121", addName: "Benny Bench" });
    await LG.logTx("drop", 3, 4, { dropKey: "1111114", dropName: "Carl Cover" });
    await LG.logTx("waiver", 3, 2, { addKey: "1112223", addName: "Terry Tight", bid: 14, dropName: "Walter Two" });
    await LG.postChat({ text: "Anyone want to talk about Joshua Passer? He was unplayable." });
    await LG.postChat({ text: "I'll take Terry Tight off your hands for a bag of crisps." });
    await LG.postChat({ text: "Ricky Rusher is the best waiver pickup of the year and I will not be taking questions." });
    Date.now = realNow;
  });
  await page.evaluate(() => { window.__GFFL__.UI.week = 3; window.__GFFL__.UI.show("league"); });
  await page.waitForSelector(".mucard", { timeout: 20000 });
  await page.evaluate(() => { try { window.__GFFL__.D.stop(); } catch (e) {} }); // a still frame is what a plate wants
  await sleep(500);
  return { ctx, page, errors };
}

async function deskFacts(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const grid = q(".lgdesk"), rail = q(".lgrail"), col = q(".lgmain");
    if (!grid || !rail || !col) return null;
    const rb = rail.getBoundingClientRect(), mb = col.getBoundingClientRect();
    const chat = rail.querySelector(".chatpanel");
    const cb = chat ? chat.getBoundingClientRect() : null;
    const moves = rail.querySelector(".movespanel");
    const stand = q(".standcard table.standtbl");
    const sb = stand ? stand.getBoundingClientRect() : null;
    const card = stand ? stand.closest(".card").getBoundingClientRect() : null;
    return {
      railLeft: Math.round(rb.left), mainRight: Math.round(mb.right), railTop: Math.round(rb.top),
      chatFirst: !!(chat && rail.firstElementChild === chat),
      chatTop: cb ? Math.round(cb.top) : null,
      composer: !!rail.querySelector("#chatText"),
      chatMsgs: rail.querySelectorAll("#chatList .chatRowMsg").length,
      moves: !!moves, moveRows: moves ? moves.querySelectorAll(".fline").length : 0,
      movesDetails: !!rail.querySelector("details"),
      standCols: stand ? stand.querySelectorAll("thead th").length : 0,
      standRows: stand ? stand.querySelectorAll("tbody tr").length : 0,
      standHeads: stand ? [...stand.querySelectorAll("thead th")].map((t) => t.textContent.trim()) : [],
      standPanner: !!q(".standcard .panner"),
      standFits: !!(sb && card && sb.width <= card.width + 1),
      allTime: !!q(".alltimecard table"),
      allTimeExtras: /Biggest blowout|Highest single-week|Champions/.test((q(".alltimecard") || {}).textContent || ""),
      chatNames: document.querySelectorAll("#chatList .pcinline.chatname").length,
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      power: !!q(".lgmain") && /Power rankings/.test(q(".lgmain").textContent),
      // Rail balance (2026-08-11): injury/accuracy moved MAIN → rail; #railHot shell is
      // unconditional (the card inside self-hides until trending is warm).
      railHot: !!rail.querySelector("#railHot"),
      injInMain: /League injury report/.test(col.textContent),
      accInMain: /Projection accuracy/.test(col.textContent),
      railH: Math.round(rb.height), mainH: Math.round(mb.height),
      bars: document.querySelectorAll(".mucard .mupbar.mini").length,
      barCols: (() => {
        const b = document.querySelector(".mucard .mupbar.mini i");
        const e = document.querySelector(".mucard .mupbar.mini em");
        return b && e ? [getComputedStyle(b).backgroundColor, getComputedStyle(e).backgroundColor] : null;
      })(),
    };
  });
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const srv = serve();
  const browser = await launch();
  try {
    // ---- 1440: the design's own width ----
    {
      const { ctx, page, errors } = await newPage(browser, { width: 1440, height: 980 });
      const d = await deskFacts(page);
      ok(!!d, "1440: the league home renders the two-column dashboard (.lgdesk / .lgmain / .lgrail)");
      ok(d && d.railLeft >= d.mainRight - 1, "…the rail is to the RIGHT of the main column (rail " + (d || {}).railLeft + " ≥ main " + (d || {}).mainRight + ")");
      ok(d && d.chatFirst && d.composer, "…LEAGUE CHAT is the TOP card in the rail and carries its composer, not a preview");
      // RESTAGED 2026-08-11 (rail balance): the desktop Moves cap grew 8 → 14 and the fixture
      // now seeds 16 tx precisely so the cap is what decides — 3 rows would mean the cap
      // regressed to nothing, 16 would mean it is gone.
      ok(d && !d.movesDetails && d.moves && d.moveRows === 14, "…Recent moves is an open card showing its 14-row desktop cap (" + (d || {}).moveRows + " of 16 seeded)");
      ok(d && d.railHot, "…the Hot-pickups shell (#railHot) lives in the rail (card self-hides until trending warms)");
      ok(d && !d.injInMain && !d.accInMain, "…injury report + projection accuracy have LEFT the main column (pulse lives in the rail)");
      ok(d && d.railH >= d.mainH * 0.45, "…rail balance floor: rail " + (d || {}).railH + "px vs main " + (d || {}).mainH + "px (≥ 45% on this fixture; live data — injuries, trending, chat — closes the rest)");
      ok(d && d.standCols >= 9 && d.standHeads.join("|").includes("Streak"), "…the standings table carries the new columns (" + ((d || {}).standHeads || []).join(" ") + ")");
      ok(d && d.standRows === 8 && !d.standPanner && d.standFits, "…all 8 rows, no scroller, table inside its card (" + (d || {}).standRows + " rows)");
      ok(d && d.allTime && !d.allTimeExtras, "…ALL-TIME is the aggregate table only — the superlatives are hidden on desktop");
      ok(d && !d.power, "…and the separate Power rankings card is gone (its rank is a column now)");
      ok(d && d.chatNames >= 2, "…player names inside chat messages are tappable controls (" + (d || {}).chatNames + ")");
      ok(d && d.bars === 4 && d.barCols && d.barCols[0] !== d.barCols[1],
        "…every matchup card's probability bar is painted in the two teams' own colours (" + JSON.stringify((d || {}).barCols) + ")");
      ok(d && !d.sideways, "…and the page never scrolls sideways");
      ok(errors.length === 0, "0 page errors at 1440 (" + errors.join(" | ") + ")");
      await page.screenshot({ path: path.join(SHOTS, "gffl_desk_league_1440.png"), fullPage: true });
      console.log("  📸 shots/gffl_desk_league_1440.png");
      await ctx.close();
    }
    // ---- 1280: the tightest width every standings column still has to fit ----
    {
      const { ctx, page, errors } = await newPage(browser, { width: 1280, height: 900 });
      const d = await deskFacts(page);
      ok(!!d, "1280: still the two-column dashboard");
      ok(d && d.standRows === 8 && !d.standPanner && d.standFits, "…the full standings table still fits its card with no scroller");
      ok(d && d.chatFirst && d.composer, "…chat is still the top-right panel, expanded");
      ok(d && !d.sideways, "…and no sideways page scroll");
      ok(errors.length === 0, "0 page errors at 1280 (" + errors.join(" | ") + ")");
      await page.screenshot({ path: path.join(SHOTS, "gffl_desk_league_1280.png"), fullPage: true });
      console.log("  📸 shots/gffl_desk_league_1280.png");
      await ctx.close();
    }
    // ---- 390: the phone, which this batch is not allowed to have changed ----
    {
      const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 });
      const m = await page.evaluate(() => ({
        desk: !!document.querySelector(".lgdesk"),
        details: document.querySelectorAll("main details").length,
        openDetails: [...document.querySelectorAll("main details")].filter((d) => d.open).length,
        standCols: document.querySelectorAll(".standcard table thead th").length,
        panner: !!document.querySelector(".standcard .panner"),
        power: /Power rankings/.test(document.body.textContent),
        bars: document.querySelectorAll(".mucard .mupbar.mini").length,
        sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
      }));
      ok(!m.desk, "390: no desktop grid — the phone keeps its stacked card list");
      ok(m.details === 3 && m.openDetails === 0, "…all three lazy cards are still collapsed <details> (" + m.details + " present, " + m.openDetails + " open)");
      ok(m.standCols === 6 && m.panner, "…the standings table is the phone's own six columns, inside its scroller");
      ok(m.power, "…and the Power rankings card is still there on a phone");
      ok(m.bars === 4, "…while the matchup cards DO carry the new two-team bar (that change is everywhere) (" + m.bars + ")");
      ok(!m.sideways, "…and nothing scrolls sideways");
      ok(errors.length === 0, "0 page errors at 390 (" + errors.join(" | ") + ")");
      await page.screenshot({ path: path.join(SHOTS, "gffl_desk_mobile_390.png"), fullPage: true });
      console.log("  📸 shots/gffl_desk_mobile_390.png");
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log("\n================================");
  console.log("PASS " + pass + " · FAIL " + fail);
  if (failures.length) { console.log("Failures:"); failures.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
})();
