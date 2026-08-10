// _gffl_palette_shots.cjs — photograph S3's team-colour identity: the locker hero and the
// matchup, at phone and desktop widths, for FOUR kinds of team.
//
//   node tools/_gffl_palette_shots.cjs
//
// The four are the four the colour model has to survive, not four pretty pictures:
//   photo   — a busy multi-colour crest (a photographed logo's worst case for extraction)
//   flat    — flat vector art, three clean bands
//   none    — no logo at all, so the initials placeholder and the DEFAULT palette carry it
//   picked  — colours set BY HAND, latched, over a logo whose colours disagree with them
//             (this is the plate that proves the editor path renders identically to the
//             extracted one, and that the latch really holds)
//
// Every plate ASSERTS what its filename claims BEFORE it is written (house rule) — a shot of
// a hero whose crest never loaded, or of a matchup where both sides came out the same colour,
// is worse than no shot at all. Serves the worktree root itself rather than relying on a
// preview server, so it can never photograph a different checkout by accident.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8873;
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

// ---- the four teams' art, drawn in-page so the plates need no binary fixtures on disk ----
// PHOTO: a noisy radial spread with a foreground mark — the shape a real photographed crest
// has, and the one that makes a single-bucket extractor produce mud.
const PHOTO_LOGO = `(function () {
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
  const c = cv.getContext("2d");
  const g = c.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, "#1c4f8a"); g.addColorStop(0.5, "#2f8f4e"); g.addColorStop(1, "#c9a227");
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    c.fillStyle = "rgba(" + (60 + ((i * 37) % 180)) + "," + (40 + ((i * 71) % 170)) + "," + (30 + ((i * 53) % 190)) + ",0.28)";
    c.fillRect((i * 29) % 128, (i * 17) % 128, 4, 4);
  }
  c.fillStyle = "#e8442f"; c.beginPath(); c.arc(64, 60, 34, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#f7f3e8"; c.font = "bold 34px sans-serif"; c.textAlign = "center"; c.fillText("BK", 64, 72);
  return cv;
})()`;
// FLAT ART: three clean bands plus a mark — a vector crest, the easy case, and the one whose
// extracted scheme should come back looking exactly like the art.
const FLAT_LOGO = `(function () {
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
  const c = cv.getContext("2d");
  c.fillStyle = "#0f2f6b"; c.fillRect(0, 0, 128, 128);
  c.fillStyle = "#e0a800"; c.fillRect(0, 84, 128, 26);
  c.fillStyle = "#d43a2f"; c.beginPath(); c.moveTo(64, 18); c.lineTo(100, 76); c.lineTo(28, 76); c.closePath(); c.fill();
  return cv;
})()`;
// The PICKED team's logo is deliberately BLUE/GREEN while its hand-picked scheme is
// magenta/orange — so a plate in which the latch had failed would be obvious at a glance.
const PICKED_LOGO = `(function () {
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
  const c = cv.getContext("2d");
  c.fillStyle = "#13656b"; c.fillRect(0, 0, 128, 128);
  c.fillStyle = "#8fd6b0"; c.fillRect(20, 20, 88, 88);
  c.fillStyle = "#0b3f45"; c.fillRect(44, 44, 40, 40);
  return cv;
})()`;
const PICKED_COLORS = { primary: "#b5197a", secondary: "#5c0b3d", tertiary: "#ff8a3d" };

function seedTeams() {
  const names = ["Battle Kreussers", "End Zone Goats", "Wyoming Cowboys", "Waffle House Warriors",
    "Nails For Breakfast", "Team Six", "Team Seven", "The Goat Kids"];
  const out = {};
  names.forEach((n, i) => { out["team_" + (i + 1)] = { kind: "team", teamId: i + 1, name: n, abbrev: "T" + (i + 1), owner: "" }; });
  return out;
}
function seedRoster(week, teamId, offset) {
  const base = [
    ["3915511", "P. Passer", "QB", "PHI", "QB"], ["4241457", "R. Rusher", "RB", "DAL", "RB"],
    ["111888", "S. Second", "RB", "DEN", "RB"], ["4361741", "W. Receiver", "WR", "PHI", "WR"],
    ["111555", "W. Two", "WR", "DEN", "WR"], ["111222", "T. Tight", "TE", "KC", "TE"],
    ["111444", "F. Flexman", "RB", "DEN", "FLEX"], ["dst_PHI", "PHI D/ST", "DST", "PHI", "DST"],
    ["2473037", "K. Kicker", "K", "DAL", "K"],
  ];
  return { kind: "roster", week, teamId,
    players: base.map(([k, n, p, t, s]) => ({ key: String(Number(k) + offset), name: n, pos: p, team: t, slot: s })) };
}
const SEED_DOCS = Object.assign({}, seedTeams(), {
  sched_2026: { kind: "sched", season: 2026, weeks: [[[1, 2], [3, 4], [5, 6], [7, 8]]] },
  roster_2026_w1_t1: seedRoster(1, 1, 0),
  roster_2026_w1_t2: seedRoster(1, 2, 1),
  weekly_1: { kind: "weekly", week: 1, matchups: [{ home: 1, away: 2, homePts: 118.4, awayPts: 96.2 }] },
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
  // Cloud + upstreams blocked: these plates are of the APP's own chrome, and a headless run
  // that reaches production Firestore is exactly how this repo has duplicated live data before.
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (u.startsWith(BASE)) return req.continue();
    // ABORTED, not answered: an aborted cloud is what puts lg-core into its LOCAL backend,
    // which is where the seeded league lives. Answering `{}` instead reads as "the cloud is
    // reachable and empty" and the page renders the honest can't-reach-the-league card.
    if (/googleapis|firestore|firebase|gstatic/.test(u)) return req.abort();
    // Upstreams answer EMPTY rather than aborting — nothing on these plates depends on live
    // NFL data, and a flat 200 keeps the console clean.
    return req.respond({ status: 200, contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" });
  });
  await page.goto(BASE + "/league.html?fam=" + FAM + "&sim=0", { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__GFFL__ && window.__GFFL__.LG.rules, { timeout: 20000 });
  // These plates photograph the EDITOR as well as the result, and the editor only renders for
  // an owner or an unlocked commissioner — so this device is the commissioner. (The device
  // owns team 1; the other three lockers are somebody else's, which is exactly the case the
  // commissioner gate exists for.)
  await page.evaluate(() => { sessionStorage.setItem("gfflCommish", "1"); });
  // Every upstream is blocked, so the app cannot learn which NFL week it is; pin it to the one
  // the seeded schedule actually holds and repaint. (Left to itself it renders a league home
  // with no games, which is a true picture of an offline device but not what these plates are of.)
  await page.evaluate(() => { window.__GFFL__.UI.week = 1; window.__GFFL__.UI.show("league"); });
  try {
    await page.waitForSelector(".mucard", { timeout: 20000 });
  } catch (e) {
    const diag = await page.evaluate(() => ({
      view: (document.querySelector("main") || {}).dataset && document.querySelector("main").dataset.view,
      week: window.__GFFL__.UI.week, teams: window.__GFFL__.LG.teams.length,
      body: document.body.textContent.slice(0, 400),
    }));
    console.log("DIAG " + JSON.stringify(diag));
    throw e;
  }
  // The live poll repaints on its own timer; a still frame is what a plate wants.
  await page.evaluate(() => { try { window.__GFFL__.D.stop(); } catch (e) {} });
  return { ctx, page, errors };
}

const openLocker = async (page, id) => {
  await page.evaluate((i) => window.__GFFL__.UI.openLocker(i), id);
  await page.waitForSelector(".lockerhead", { timeout: 15000 });
  await sleep(220);
};

async function uploadLogo(page, teamId, expr) {
  await openLocker(page, teamId);
  await page.evaluate(async (e) => {
    const cv = eval(e); // eslint-disable-line no-eval
    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    const file = new File([blob], "logo.png", { type: "image/png" });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.getElementById("lockerLogoInput");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, expr);
  await page.waitForFunction((id) => {
    const t = window.__GFFL__.LG.teamById(id);
    return t && (t.logoData || "").startsWith("data:image/");
  }, { timeout: 20000 }, teamId);
  await sleep(200);
}

// ---- what a plate must prove before it is allowed to be written ----
async function heroFacts(page) {
  return page.evaluate(() => {
    const head = document.querySelector(".lockerhead");
    if (!head) return null;
    const logo = head.querySelector(".lockerlogo");
    const nm = head.querySelector(".lockername");
    const cs = getComputedStyle(head);
    const toHex = (c) => "#" + (c.match(/\d+/g) || ["0", "0", "0"]).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, "0")).join("");
    return {
      name: nm ? nm.textContent.trim() : "",
      logoW: logo ? Math.round(logo.getBoundingClientRect().width) : 0,
      isPlaceholder: !!(logo && logo.classList.contains("lockerlogo-ph")),
      imgLoaded: !!(logo && logo.tagName === "IMG" && logo.naturalWidth > 0),
      wash: !!head.querySelector(".lockerwash"),
      gradient: /gradient/.test(cs.backgroundImage),
      fill: cs.getPropertyValue("--tp").trim(),
      ink: toHex(getComputedStyle(nm).color),
      contrast: window.__GFFL__.LG.contrast(toHex(getComputedStyle(nm).color), cs.getPropertyValue("--tp").trim()),
      swatches: [...document.querySelectorAll(".tcswatch")].map((i) => i.value),
      state: (document.querySelector(".tcstate") || {}).textContent,
      height: Math.round(head.getBoundingClientRect().height),
    };
  });
}
async function matchupFacts(page) {
  return page.evaluate(() => {
    const head = document.querySelector(".card.muhead");
    if (!head) return null;
    const sides = [...head.querySelectorAll(".muhteam")];
    const bars = [...document.querySelectorAll(".gsb")];
    return {
      height: Math.round(head.getBoundingClientRect().height),
      crests: [...head.querySelectorAll(".muavatar")].map((a) => Math.round(a.getBoundingClientRect().width)),
      crestImgs: [...head.querySelectorAll(".muavatar img")].filter((i) => i.naturalWidth > 0).length,
      tp: sides.map((s) => getComputedStyle(s).getPropertyValue("--tp").trim()),
      names: sides.map((s) => s.querySelector(".muhname").textContent.trim()),
      bars: bars.length,
      barLabels: bars.map((b) => b.querySelector(".small").textContent.trim()),
    };
  });
}

async function plate(page, file, label) {
  await page.screenshot({ path: path.join(SHOTS, file) });
  console.log("  📸 shots/" + file + "  (" + label + ")");
}

(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  const srv = serve();
  const browser = await launch();
  const allErrors = [];

  for (const [wname, vp] of [["390", { width: 390, height: 844 }], ["1440", { width: 1440, height: 900 }]]) {
    console.log("\n== " + wname + "px ==");
    const { ctx, page, errors } = await newPage(browser, vp);

    // Give each of the four teams its identity, through the REAL paths a person would use.
    await uploadLogo(page, 1, PHOTO_LOGO);   // team 1: photo logo, colours extracted
    await uploadLogo(page, 2, FLAT_LOGO);    // team 2: flat art, colours extracted
    await uploadLogo(page, 4, PICKED_LOGO);  // team 4: a logo whose colours will be overruled
    await page.evaluate(async (c) => {
      const LG = window.__GFFL__.LG;
      // Hand-picked, latched — the editor path. Written exactly as the swatch handler writes it.
      await LG.saveTeam({ teamId: 4, colors: c, colorsCustom: true });
      await LG.loadTeams();
    }, PICKED_COLORS);
    // team 3 keeps NO logo and NO colours at all — the initials-placeholder plate.

    // ---- plate 1: the photo-logo hero ----
    await openLocker(page, 1);
    let f = await heroFacts(page);
    ok(!!f && f.imgLoaded && f.logoW >= 96, wname + " · photo hero: the crest is a real loaded image at hero size (" + (f && f.logoW) + "px)");
    ok(f.wash && f.gradient, "…over its own blurred wash and the primary→secondary gradient");
    ok(f.contrast >= 4.5, "…with the name legible on the fill (" + f.contrast.toFixed(2) + ":1 on " + f.fill + ")");
    ok(f.swatches.length === 3 && new Set(f.swatches).size >= 2, "…and three swatches showing the EXTRACTED scheme (" + f.swatches.join(" ") + ")");
    ok(/logo/.test(f.state || ""), "…labelled as coming from the logo (\"" + (f.state || "").trim() + "\")");
    if (f.imgLoaded && f.contrast >= 4.5) await plate(page, "gffl_pal_hero_photo_" + wname + ".png", "photo logo");

    // ---- plate 2: the flat-art hero ----
    await openLocker(page, 2);
    f = await heroFacts(page);
    ok(!!f && f.imgLoaded && f.logoW >= 96, wname + " · flat-art hero: real crest at hero size (" + (f && f.logoW) + "px)");
    ok(f.contrast >= 4.5, "…name legible on its own fill (" + f.contrast.toFixed(2) + ":1 on " + f.fill + ")");
    if (f.imgLoaded && f.contrast >= 4.5) await plate(page, "gffl_pal_hero_flat_" + wname + ".png", "flat-art logo");

    // ---- plate 3: the no-logo hero ----
    await openLocker(page, 3);
    f = await heroFacts(page);
    ok(!!f && f.isPlaceholder && f.name.length > 0, wname + " · no-logo hero: initials placeholder, not an empty box");
    ok(!f.wash, "…and no wash, because there is no picture to blur");
    ok(f.gradient && f.contrast >= 4.5, "…on the team's DEFAULT palette, still legible (" + f.contrast.toFixed(2) + ":1 on " + f.fill + ")");
    if (f.isPlaceholder && f.contrast >= 4.5) await plate(page, "gffl_pal_hero_none_" + wname + ".png", "no logo — initials placeholder");

    // ---- plate 4: the hand-picked hero. THE LATCH PLATE.
    await openLocker(page, 4);
    f = await heroFacts(page);
    ok(!!f && f.imgLoaded, wname + " · hand-picked hero: the logo is present…");
    ok(f.fill.toLowerCase() === PICKED_COLORS.primary, "…and the hero wears the HAND-PICKED colour, not the logo's (" + f.fill + ")");
    ok(f.swatches[0] === PICKED_COLORS.primary && f.swatches[1] === PICKED_COLORS.secondary && f.swatches[2] === PICKED_COLORS.tertiary,
      "…all three swatches show exactly what was chosen (" + f.swatches.join(" ") + ")");
    ok(/hand-picked/.test(f.state || ""), "…labelled hand-picked, so the latch is visible to the reader (\"" + (f.state || "").trim() + "\")");
    ok(f.contrast >= 4.5, "…and it is legible (" + f.contrast.toFixed(2) + ":1)");
    if (f.fill.toLowerCase() === PICKED_COLORS.primary && f.contrast >= 4.5) {
      await plate(page, "gffl_pal_hero_picked_" + wname + ".png", "hand-picked colours over a disagreeing logo");
    }

    // ---- plate 5: the matchup — photo team vs flat-art team ----
    await page.evaluate(() => { window.__GFFL__.UI.matchup = [1, 2]; window.__GFFL__.UI.show("matchup"); });
    await page.waitForSelector(".muhead", { timeout: 15000 });
    await sleep(300);
    let m = await matchupFacts(page);
    ok(!!m && m.height <= 120, wname + " · matchup: the header still fits its 120px ceiling (" + (m && m.height) + "px)");
    ok(m.crests.length === 2 && m.crests.every((w) => w >= 44 && w <= 56), "…crest-vs-crest inside the 44-56px band (" + JSON.stringify(m.crests) + ")");
    ok(m.crestImgs === 2, "…both crests are real loaded images");
    ok(m.tp[0] !== m.tp[1], "…and the two sides are visibly DIFFERENT colours (" + JSON.stringify(m.tp) + ")");
    ok(m.bars >= 3 && m.barLabels[0] === "Points", "…with the split stat bars below it (" + m.bars + " rows)");
    if (m.height <= 120 && m.crestImgs === 2 && m.tp[0] !== m.tp[1] && m.bars >= 3) {
      await plate(page, "gffl_pal_matchup_" + wname + ".png", "photo vs flat-art");
    }

    // ---- plate 6: the matchup with the hand-picked team and the no-logo team ----
    await page.evaluate(() => { window.__GFFL__.UI.matchup = [4, 3]; window.__GFFL__.UI.show("matchup"); });
    await page.waitForSelector(".muhead", { timeout: 15000 });
    await sleep(300);
    m = await matchupFacts(page);
    ok(!!m && m.height <= 120, wname + " · matchup (picked vs no-logo): header still inside 120px (" + (m && m.height) + "px)");
    ok(m.tp[1] && m.tp[1].toLowerCase() === PICKED_COLORS.primary,
      "…the hand-picked side renders IDENTICALLY to an extracted one — same helper, same clamp (" + m.tp[1] + ")");
    ok(m.tp[0] !== m.tp[1], "…and the no-logo side still has an identity of its own (" + JSON.stringify(m.tp) + ")");
    if (m.height <= 120 && m.tp[0] !== m.tp[1]) {
      await plate(page, "gffl_pal_matchup_picked_" + wname + ".png", "hand-picked vs no-logo");
    }

    // ---- plate 7: the league home — every team at once, which is where "each team feels
    // unique" either lands or doesn't. Not on the brief's plate list, but it is the surface
    // the crest/name/typography changes touch most widely, so it is worth a reviewer's eyes.
    await page.evaluate(() => window.__GFFL__.UI.show("league"));
    await page.waitForSelector(".mucard", { timeout: 15000 });
    await sleep(300);
    const home = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".tbl .teamlink")];
      return {
        rows: rows.length,
        crests: rows.filter((r) => r.querySelector(".tcrest")).length,
        colours: [...new Set(rows.map((r) => getComputedStyle(r.querySelector(".tcrest")).backgroundColor))].length,
        crestW: rows[0] ? Math.round(rows[0].querySelector(".tcrest").getBoundingClientRect().width) : 0,
        cardCrests: document.querySelectorAll(".mucard .tcrest").length,
        hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    ok(home.rows === 8 && home.crests === 8, wname + " · league home: every standings row carries a crest (" + home.crests + "/" + home.rows + ")");
    ok(home.colours >= 6, "…in at least six DIFFERENT colours across eight teams — the whole point of the default hue wheel (" + home.colours + ")");
    ok(home.crestW >= 28, "…at the S3 standings size (" + home.crestW + "px)");
    ok(home.cardCrests >= 8, "…and every matchup card carries both teams' crests (" + home.cardCrests + ")");
    ok(!home.hscroll, "…with no horizontal scroll introduced at this width");
    if (home.crests === 8 && !home.hscroll) await plate(page, "gffl_pal_league_" + wname + ".png", "the whole league, each team its own colour");

    ok(errors.length === 0, wname + " · 0 page errors (" + errors.join(" | ") + ")");
    allErrors.push(...errors);
    await ctx.close();
  }

  await browser.close();
  srv.close();
  console.log("\n================================");
  console.log(`PASS ${pass} · FAIL ${fail}`);
  if (fail) { console.log("Failures:"); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
})().catch((e) => { console.error("SHOTS CRASH:", e); process.exit(1); });
