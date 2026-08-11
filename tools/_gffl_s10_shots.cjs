// _gffl_s10_shots.cjs — photograph S10's centered drop/swap card and S6's trending chrome,
// at phone and desktop widths.
//
//   node tools/_gffl_s10_shots.cjs
//
// Five plates:
//   gffl_s10_trending_390     — the Hot pickups strip + HOT/COLD chips on the players table
//   gffl_s10_dropcard_390     — the ADD/CLAIM card: who's coming in, then who do you drop
//   gffl_s10_dropcard_desktop — the same card on a 1440 screen (still a card, still centred)
//   gffl_s10_swapcard_390     — the LINEUP SWAP card: the same component, the same columns
//   gffl_s10_swapcard_desktop
//
// Every plate ASSERTS what its filename claims BEFORE it is written (house rule): a shot of a
// card that came out anchored to the bottom of the screen, or whose % OWNED column is a row of
// dashes because the fixture never answered, is worse than no shot at all. Serves the worktree
// root itself rather than relying on a preview server, so it can never photograph a different
// checkout by accident, and every upstream is answered from a fixture in this file — a headless
// run that reaches production Firestore is exactly how this repo has duplicated live data.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8874;
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

// ---------------- fixtures ----------------
// Real-length NFL names, because a card of "P. Passer"-shaped rows would photograph a layout
// nobody will ever see. Roster keys are ESPN player ids (what the league's own import writes),
// which is what the percent-owned batch is keyed by.
const ROSTER = [
  ["3915511", "Marvin Harrison Jr.", "WR", "ARI", "WR"],
  ["4241457", "Amon-Ra St. Brown", "WR", "DET", "WR"],
  ["111888", "Christian McCaffrey", "RB", "SF", "RB"],
  ["4361741", "Jaxon Smith-Njigba", "WR", "SEA", "FLEX"],
  ["111555", "Bijan Robinson", "RB", "ATL", "RB"],
  ["111222", "Trey McBride", "TE", "ARI", "TE"],
  ["2473037", "Chase McLaughlin", "K", "TB", "K"],
  ["dst_PHI", "Philadelphia Eagles", "DST", "PHI", "DST"],
  ["111444", "Kenneth Walker III", "RB", "SEA", "BENCH"],
  ["111333", "Ladd McConkey", "WR", "LAC", "BENCH"],
  ["111777", "Puka Nacua", "WR", "LAR", "BENCH"],
];
const PCT_OWNED = { 111444: 94.2, 111333: 88.7, 111777: 71.4, 111888: 99.1, 3915511: 97.6, 111222: 62.3, 111555: 98.4 };
const SLP_DIR = (() => {
  const d = {};
  ROSTER.forEach(([key, name, pos, team], i) => {
    if (key.startsWith("dst_")) { d.PHI = { first_name: "Philadelphia", last_name: "Eagles", team: "PHI", position: "DEF" }; return; }
    d["70" + (100 + i)] = { full_name: name, team, position: pos, espn_id: Number(key), search_rank: 20 + i };
  });
  // Genuinely unrostered — the free agents the players table browses and the card adds.
  d["9301"] = { full_name: "Tyjae Spears", team: "TEN", position: "RB", search_rank: 61 };
  d["9302"] = { full_name: "Romeo Doubs", team: "GB", position: "WR", search_rank: 74 };
  d["9303"] = { full_name: "Cam Little", team: "JAX", position: "K", search_rank: 140 };
  d.KC = { first_name: "Kansas City", last_name: "Chiefs", team: "KC", position: "DEF" };
  return d;
})();
// Sleeper's own stat keys — the app scores them with the league's rules (rec 1, rec_yd 0.1,
// rush_yd 0.1, rush_td 6), so these are real numbers rather than pre-computed points.
const SLP_PROJ = {
  "70100": { rec: 6, rec_yd: 78, rec_td: 1 }, "70101": { rec: 7, rec_yd: 84 },
  "70102": { rush_yd: 92, rush_td: 1, rec: 3, rec_yd: 24 }, "70103": { rec: 5, rec_yd: 61 },
  "70104": { rush_yd: 88, rush_td: 1 }, "70105": { rec: 5, rec_yd: 52 },
  "70108": { rush_yd: 74, rec: 2, rec_yd: 15 }, "70109": { rec: 6, rec_yd: 66 },
  "70110": { rec: 6, rec_yd: 71, rec_td: 1 },
  "9301": { rush_yd: 58, rec: 3, rec_yd: 21 }, "9302": { rec: 4, rec_yd: 47 },
};
const TRENDING = { add: [["9301", 41208], ["9302", 27640], ["9303", 9114]], drop: [["70109", 6320]] };

function seedTeams() {
  const names = ["Battle Kreussers", "End Zone Goats", "Wyoming Cowboys", "Waffle House Warriors",
    "Nails For Breakfast", "Team Six", "Team Seven", "The Goat Kids"];
  const out = {};
  names.forEach((n, i) => { out["team_" + (i + 1)] = { kind: "team", teamId: i + 1, name: n, abbrev: "T" + (i + 1), owner: "" }; });
  return out;
}
const SEED_DOCS = Object.assign({}, seedTeams(), {
  sched_2026: { kind: "sched", season: 2026, weeks: [[[1, 2], [3, 4], [5, 6], [7, 8]]] },
  roster_2026_w1_t1: { kind: "roster", week: 1, teamId: 1,
    players: ROSTER.map(([key, name, pos, team, slot]) => ({ key, name, pos, team, slot })) },
  roster_2026_w1_t2: { kind: "roster", week: 1, teamId: 2, players: [
    { key: "222111", name: "Josh Allen", pos: "QB", team: "BUF", slot: "QB" },
  ] },
});

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
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    const cors = { "Access-Control-Allow-Origin": "*" };
    const json = (o) => req.respond({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(o) });
    if (u.includes("/.netlify/functions/sports")) {
      // The percent-owned batch, answered the way the deployed function answers it: an id
      // ESPN doesn't know is simply ABSENT, so the card's "—" path is exercised too.
      let ids = [];
      try { ids = (JSON.parse(req.postData() || "{}").ids || []).map(Number); } catch (e) {}
      const own = {};
      ids.forEach((id) => { if (PCT_OWNED[id] != null) own[String(id)] = PCT_OWNED[id]; });
      return json({ ok: true, season: 2026, own });
    }
    if (u.startsWith(BASE)) return req.continue();
    // ABORTED, not answered: an aborted cloud is what puts lg-core into its LOCAL backend,
    // which is where the seeded league lives.
    if (/googleapis|firestore|firebase|gstatic/.test(u)) return req.abort();
    if (u.includes("api.sleeper.app")) {
      if (u.includes("/players/nfl/trending/")) {
        const kind = /trending\/(add|drop)/.exec(u);
        return json((TRENDING[kind ? kind[1] : "add"] || []).map(([pid, count]) => ({ player_id: pid, count })));
      }
      if (u.endsWith("/state/nfl")) return json({ week: 1, leg: 1, season: "2026", season_type: "regular" });
      if (u.endsWith("/players/nfl")) return json(SLP_DIR);
      if (u.includes("/projections/nfl/")) return json(SLP_PROJ);
      return json({});
    }
    return json({});
  });
  await page.goto(BASE + "/league.html?fam=" + FAM + "&sim=0", { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__GFFL__ && window.__GFFL__.LG.rules, { timeout: 20000 });
  await page.evaluate(() => { window.__GFFL__.UI.week = 1; window.__GFFL__.UI.show("league"); });
  await page.waitForSelector(".mucard", { timeout: 20000 });
  // The live poll repaints on its own timer; a still frame is what a plate wants. (One
  // controlled pass first, so the directory and the projections are in memory.)
  await page.waitForFunction(() => !!window.__GFFL__.D.S.slpPlayers, { timeout: 20000 });
  await page.evaluate(async () => { await window.__GFFL__.D.pollOnce(); window.__GFFL__.D.stop(); });
  return { ctx, page, errors };
}

const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + ".png") });
  console.log("  📸 shots/" + name + ".png");
};

async function openMoves(page) {
  await page.evaluate(() => window.__GFFL__.UI.go("moves"));
  await page.waitForSelector("#faResults [data-fi]", { timeout: 20000 });
  await page.waitForFunction(() => !!document.querySelector(".hotpick"), { timeout: 20000 });
  await sleep(250);
}
async function openClaimCard(page, name) {
  await page.evaluate((n) => {
    const row = [...document.querySelectorAll("#faResults [data-fi]")].find((r) => r.textContent.includes(n));
    row.querySelector(".faMoveBtn").click();
  }, name);
  await page.waitForSelector("#rosterCard .swaprow", { timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll("#rosterCard .rcnum")].some((e) => /%/.test(e.textContent)), { timeout: 20000 });
  await sleep(250);
}
async function openSwapCard(page) {
  await page.evaluate(() => window.__GFFL__.UI.go("team"));
  await page.waitForSelector(".lrow", { timeout: 20000 });
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".lrow")].find((r) => /FLEX/.test(r.textContent) && r.querySelector(".lswap"));
    row.querySelector(".lswap").click();
  });
  await page.waitForSelector("#rosterCard .swaprow", { timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll("#rosterCard .rcnum")].some((e) => /%/.test(e.textContent)), { timeout: 20000 });
  await sleep(250);
}
// What a plate must prove before it is allowed to be written.
async function cardFacts(page) {
  return page.evaluate(() => {
    const card = document.querySelector("#rosterCard .rccard");
    if (!card) return null;
    const b = card.getBoundingClientRect();
    const rows = [...card.querySelectorAll(".swaprow")];
    const nums = rows.map((r) => [...r.querySelectorAll(".rcnum")].map((e) => e.textContent.trim()));
    return {
      title: (card.querySelector(".pcname") || {}).textContent || "",
      cx: b.left + b.width / 2, cy: b.top + b.height / 2, w: b.width, h: b.height,
      vw: innerWidth, vh: innerHeight, top: b.top, bottom: b.bottom,
      head: (card.querySelector(".rchead") || {}).textContent || "",
      rows: rows.length,
      projs: nums.map((n) => n[0]).filter((v) => v && v !== "—").length,
      owns: nums.map((n) => n[1]).filter((v) => /%/.test(v || "")).length,
      minRow: rows.length ? Math.min(...rows.map((r) => r.getBoundingClientRect().height)) : 0,
    };
  });
}
function assertCard(f, label) {
  ok(!!f, label + ": the card is on screen");
  if (!f) return;
  ok(Math.abs(f.cx - f.vw / 2) < 3 && Math.abs(f.cy - f.vh / 2) < f.vh * 0.1,
    label + ": centred on the screen, not anchored to its bottom (" + Math.round(f.cx) + "," + Math.round(f.cy) + " of " + f.vw + "x" + f.vh + ")");
  ok(f.top > 10 && f.bottom < f.vh - 10, label + ": real air above and below it");
  ok(f.w <= 362, label + ": still a card at " + Math.round(f.w) + "px, not a full-width sheet");
  ok(/Player/.test(f.head) && /Proj/.test(f.head) && /Own/.test(f.head), label + ": the Player / Proj / Own header is on it");
  ok(f.rows >= 3, label + ": it lists real candidates (" + f.rows + ")");
  ok(f.projs >= 2, label + ": with real projections on them (" + f.projs + " of " + f.rows + ")");
  ok(f.owns >= 2, label + ": …and real percent-owned figures (" + f.owns + " of " + f.rows + ")");
  ok(f.minRow >= 44, label + ": every row is a 44px touch target (" + f.minRow + ")");
}

(async () => {
  const srv = serve();
  const browser = await launch();
  try {
    // ---- 390: trending, then the claim card ----
    {
      const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 });
      await openMoves(page);
      const trend = await page.evaluate(() => ({
        picks: [...document.querySelectorAll(".hotpick")].map((b) => b.textContent.replace(/\s+/g, " ").trim()),
        hot: [...document.querySelectorAll(".trendchip.up")].length,
        cold: [...document.querySelectorAll(".trendchip.down")].length,
        emoji: [...document.querySelector("#hotStrip").textContent].filter((c) => /\p{Extended_Pictographic}/u.test(c)).length,
        sideways: document.documentElement.scrollWidth > innerWidth,
      }));
      ok(trend.picks.length >= 2, "trending: the Hot pickups strip really has pickups on it (" + trend.picks.length + ")");
      ok(/\+41,208/.test(trend.picks[0] || ""), "trending: with the add count on the leader (" + (trend.picks[0] || "") + ")");
      ok(trend.hot >= 1, "trending: a HOT chip is on the players table");
      ok(trend.emoji === 0, "trending: the strip is words, never an emoji");
      ok(!trend.sideways, "trending: the page does not scroll sideways at 390px");
      await shot(page, "gffl_s10_trending_390");

      await openClaimCard(page, "T. Spears");
      const f = await cardFacts(page);
      assertCard(f, "drop card 390");
      ok(/Claim T\. Spears/.test(f.title), "drop card 390: it names the player being added (" + f.title.trim() + ")");
      const asks = await page.evaluate(() => /Who do you drop\?/.test(document.querySelector("#rosterCard").textContent));
      ok(asks, "drop card 390: …and asks who to drop");
      await shot(page, "gffl_s10_dropcard_390");
      ok(errors.length === 0, "drop card 390: 0 page errors");
      await ctx.close();
    }
    // ---- 390: the swap card ----
    {
      const { ctx, page, errors } = await newPage(browser, { width: 390, height: 844 });
      await openSwapCard(page);
      const f = await cardFacts(page);
      assertCard(f, "swap card 390");
      ok(/FLEX/.test(f.title), "swap card 390: it names the slot being filled (" + f.title.trim() + ")");
      await shot(page, "gffl_s10_swapcard_390");
      ok(errors.length === 0, "swap card 390: 0 page errors");
      await ctx.close();
    }
    // ---- 1440: both flows, still a card ----
    {
      const { ctx, page, errors } = await newPage(browser, { width: 1440, height: 900 });
      await openMoves(page);
      await openClaimCard(page, "T. Spears");
      assertCard(await cardFacts(page), "drop card desktop");
      await shot(page, "gffl_s10_dropcard_desktop");
      await page.evaluate(() => window.__GFFL__.UI.closeRosterCard());
      await openSwapCard(page);
      assertCard(await cardFacts(page), "swap card desktop");
      await shot(page, "gffl_s10_swapcard_desktop");
      ok(errors.length === 0, "desktop: 0 page errors");
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log("\n================================");
  console.log("S10/S6 PLATES: " + pass + "/" + (pass + fail));
  if (fail) { console.log("Failures:"); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
})().catch((e) => { console.error("SHOTS CRASH:", e); process.exit(1); });
