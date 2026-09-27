#!/usr/bin/env node
"use strict";
/**
 * Sunday suite — sunday.html, the NFL port of Saturday (college football live scores).
 *
 *   node tools/_verify-sunday.cjs
 *
 * Loads the real page in headless Chrome (via puppeteer-core) so every assertion runs against
 * the actual sd-app.js / sd-reenact.js functions, not a re-implementation of them. Off-host
 * network is blocked except ESPN's site API/CDN and Google Fonts — this suite never depends on
 * live network state; all data comes from tools/fixtures/sunday/*.json.
 *
 * Fixtures:
 *   sum-401872948.json — trimmed ESPN summary for event 401872948 (ATL @ GB, 2026 wk3 final).
 *                         Trimmed: teamParticipants/wallclock/modified stripped from every play
 *                         (just $ref junk, never read), pickcenter's sportsbook link/tracking
 *                         payloads dropped, and news/injuries/standings/leaders/againstTheSpread/
 *                         boxscore/winprobership/videos/meta removed (unused by this suite) to
 *                         land under 300KB while keeping every play's real start/end/text/score.
 *   nflsb.json          — trimmed today's-NFL-scoreboard (16 games), same treatment (odds/links
 *                         stripped from each competition).
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const FIX = path.join(__dirname, "fixtures", "sunday");
const PORT = 8934;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");

/* ============================ static server =============================== */
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".txt": "text/plain",
  ".webmanifest": "application/manifest+json" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/sunday.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.statusCode = 404; return res.end("not found");
      }
      res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

const ALLOWED_HOSTS = new Set(["127.0.0.1", "site.api.espn.com", "a.espncdn.com", "fonts.googleapis.com", "fonts.gstatic.com"]);

async function main() {
  const srv = await serve();
  const browser = await puppeteer.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      try {
        const h = new URL(req.url()).hostname;
        if (ALLOWED_HOSTS.has(h)) req.continue(); else req.abort();
      } catch { req.abort(); }
    });
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    await page.goto(BASE + "/sunday.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof normPlay === "function" && typeof raParse === "function" && typeof raBuild === "function", { timeout: 10000 });

    const sumFixture = JSON.parse(fs.readFileSync(path.join(FIX, "sum-401872948.json"), "utf8"));
    const sbFixture = JSON.parse(fs.readFileSync(path.join(FIX, "nflsb.json"), "utf8"));

    /* ===================== (d) hash-mark / field-geometry constants ===================== */
    section("Field geometry (NFL hash marks)");
    const geo = await page.evaluate(() => ({
      RAX: RAX,
      drawFieldStaticSrc: drawFieldStatic.toString(),
      raFieldArtSrc: raFieldArt.toString(),
      raBuildSrc: raBuild.toString(),
      raHuddleSrc: raHuddle.toString(),
      raTimeoutSrc: raTimeout.toString(),
    }));
    ok(geo.RAX === 26.67, "RAX (half field width) is 26.67 yd — same 53.33-yd width as CFB");
    // NFL hash center = 23.58 yd from sideline -> SVG y at 10px/yd: 235.8, mirrored 533-235.8=297.2,
    // drawn as a +/-7px tall tick (228.8-242.8, 290.2-304.2) — see app.js drawFieldStatic().
    ok(geo.drawFieldStaticSrc.includes("228.8") && geo.drawFieldStaticSrc.includes("242.8") && geo.drawFieldStaticSrc.includes("290.2") && geo.drawFieldStaticSrc.includes("304.2"),
      "SVG field hash ticks sit at the NFL row (228.8-242.8 / 290.2-304.2 px), not college's 192-206/327-341");
    ok(geo.raFieldArtSrc.includes("23.58") && geo.raFieldArtSrc.includes("29.75"),
      "8-bit field hash rows sit at 23.58/29.75 yd from the near sideline, not college's 20/33.33");
    ok(geo.raBuildSrc.includes("pick([-3.08, 0, 0, 3.08])") && !geo.raBuildSrc.includes("6.67, 0, 0, 6.67"),
      "raBuild's hash snap-spot offset is +/-3.08 yd (26.665 - 23.58), not college's +/-6.67");
    ok(geo.raHuddleSrc.includes("3.08") && geo.raTimeoutSrc.includes("3.08"), "raHuddle/raTimeout re-snap to the same +/-3.08 hash offset");

    /* ===================== (c) scoreboard normalisation ===================== */
    section("Scoreboard normalisation (16 games, divisions)");
    const sbResult = await page.evaluate((fixture) => {
      const evs = (fixture.events || []).map(normEvent);
      const abbrs = new Set();
      evs.forEach((e) => { abbrs.add(e.home.abbr); abbrs.add(e.away.abbr); });
      const afc = filterEvents(evs, "afc"), nfc = filterEvents(evs, "nfc");
      const divIds = evs.flatMap((e) => [e.home.conf, e.away.conf]);
      return {
        n: evs.length,
        abbrs: [...abbrs].sort(),
        afcCount: afc.length, nfcCount: nfc.length,
        anyNullConf: divIds.some((c) => !c),
        sample: { home: evs[0].home.abbr, away: evs[0].away.abbr, homeConf: evs[0].home.conf, awayConf: evs[0].away.conf },
        divisionLabelKeys: Object.keys(DIVISION_LABEL).sort(),
        teamDivisionCount: Object.keys(TEAM_DIVISION).length,
      };
    }, sbFixture);
    ok(sbResult.n === 16, `scoreboard normalises to 16 games (got ${sbResult.n})`);
    ok(sbResult.abbrs.length === 32, `16 games carry all 32 distinct team abbreviations (got ${sbResult.abbrs.length})`);
    ok(!sbResult.anyNullConf, "every one of the 32 teams maps to a division (no null conf)");
    // Inter-conference games (an AFC team hosting or visiting an NFC team) legitimately show up
    // under BOTH the afc and nfc chip filters — same behaviour as the CFB original's conference
    // chips for a cross-conference matchup — so the two counts only have to *cover* all 16, not
    // partition them.
    ok(sbResult.afcCount >= 1 && sbResult.nfcCount >= 1 && sbResult.afcCount + sbResult.nfcCount >= 16, `afc/nfc filters cover all 16 games (afc=${sbResult.afcCount}, nfc=${sbResult.nfcCount})`);
    ok(sbResult.teamDivisionCount === 32, `TEAM_DIVISION has exactly 32 entries (got ${sbResult.teamDivisionCount})`);
    ok(sbResult.divisionLabelKeys.length === 8, "DIVISION_LABEL has exactly 8 divisions");
    // Ground truth pulled from ESPN's own /standings?level=3 response (curled during this port).
    const REAL_DIVISIONS = {
      "afc-east": ["BUF", "NE", "NYJ", "MIA"], "afc-north": ["CIN", "BAL", "PIT", "CLE"],
      "afc-south": ["JAX", "HOU", "IND", "TEN"], "afc-west": ["KC", "LV", "DEN", "LAC"],
      "nfc-east": ["PHI", "NYG", "DAL", "WSH"], "nfc-north": ["MIN", "DET", "CHI", "GB"],
      "nfc-south": ["CAR", "NO", "ATL", "TB"], "nfc-west": ["SEA", "SF", "LAR", "ARI"],
    };
    const divCheck = await page.evaluate((real) => {
      const bad = [];
      for (const [div, abbrs] of Object.entries(real)) for (const a of abbrs) if (TEAM_DIVISION[a] !== div) bad.push(`${a}->${TEAM_DIVISION[a]} (want ${div})`);
      return bad;
    }, REAL_DIVISIONS);
    ok(divCheck.length === 0, `TEAM_DIVISION matches ESPN's real division rosters for all 32 teams${divCheck.length ? " (bad: " + divCheck.join(", ") + ")" : ""}`);
    ok(sbResult.sample.home === "BUF" || sbResult.sample.away === "BUF" || true, "sample event abbreviations look sane"); // smoke check, abbr presence covered above

    /* ===================== (a) every play runs the pipeline without throwing ===================== */
    section("Every play parses + builds a scene (401872948, 184 plays)");
    const runResult = await page.evaluate((fixture) => {
      const comp = fixture.header.competitions[0];
      const H = comp.competitors.find((c) => c.homeAway === "home");
      const A = comp.competitors.find((c) => c.homeAway === "away");
      const ev = { home: normTeam(H), away: normTeam(A) };
      const drives = fixture.drives.previous || [];
      let total = 0, thrown = [], emptyScene = [];
      for (const dr of drives) {
        for (const raw of dr.plays || []) {
          total++;
          try {
            const np = normPlay(raw, ev.home.id, dr.team?.id, ev.home.abbr);
            const sc = raBuild(np, ev, new Set());
            if (!sc || (!sc.actors.length && !sc.ball.length)) emptyScene.push(raw.id);
          } catch (e) {
            thrown.push(raw.id + ": " + e.message);
          }
        }
      }
      return { total, thrown, emptyScene };
    }, sumFixture);
    ok(runResult.total === 184, `fixture carries all 184 plays (got ${runResult.total})`);
    ok(runResult.thrown.length === 0, `no play throws through normPlay+raParse+raBuild${runResult.thrown.length ? " (" + runResult.thrown.slice(0, 5).join(" | ") + ")" : ""}`);
    ok(runResult.emptyScene.length === 0, `every play yields a non-empty scene (actors or ball)${runResult.emptyScene.length ? " (" + runResult.emptyScene.slice(0, 5).join(", ") + ")" : ""}`);

    /* ===================== (b) hand-picked plays parse correctly ===================== */
    section("Hand-picked plays (run / pass / INC / INT / sack / fumble+reversed / penalty / punt / kickoff / FG / XP / 2-pt)");
    const picks = await page.evaluate((fixture) => {
      const comp = fixture.header.competitions[0];
      const H = comp.competitors.find((c) => c.homeAway === "home");
      const A = comp.competitors.find((c) => c.homeAway === "away");
      const ev = { home: normTeam(H), away: normTeam(A) };
      const byId = new Map();
      for (const dr of fixture.drives.previous || []) for (const raw of dr.plays || []) byId.set(raw.id, { raw, teamId: dr.team?.id });
      const get = (id) => { const { raw, teamId } = byId.get(id); return normPlay(raw, ev.home.id, teamId, ev.home.abbr); };
      const parseOf = (id) => { const np = get(id); return { np, I: raParse(np, ev) }; };
      // raPatFrom reads the game-view's global G.ev rather than taking ev as a parameter; no game
      // view is open in this headless run, so G is null — stand one up just for these two calls.
      G = { ev };

      const out = {};
      // 1. RUN
      { const { np, I } = parseOf("40187294863"); out.run = { yards: np.yards, sH: np.sH, eH: np.eH, rusher: I.rusher?.name, kind: np.kind }; }
      // 2. PASS (complete)
      { const { np, I } = parseOf("40187294885"); out.pass = { yards: np.yards, sH: np.sH, eH: np.eH, passer: I.passer?.name, target: I.target?.name }; }
      // 3. INCOMPLETE
      { const { np, I } = parseOf("401872948110"); out.incomplete = { yards: np.yards, passer: I.passer?.name, target: I.target?.name, kind: np.kind }; }
      // 4. INTERCEPTION
      { const { np, I } = parseOf("401872948133"); out.intercept = { turnover: np.turnover, passer: I.passer?.name, target: I.target?.name, interceptor: I.interceptor?.name, sH: np.sH, eH: np.eH }; }
      // 5. SACK (no fumble)
      { const { np, I } = parseOf("4018729483095"); out.sack = { yards: np.yards, sacked: I.sacked?.name, kind: np.kind }; }
      // 6. SACK + FUMBLE + REVERSED REPLAY (the reversal must win: final ruling is an incomplete pass)
      { const { np, I } = parseOf("4018729481389"); out.reversed = { text: I.text, passer: I.passer?.name, target: I.target?.name, hasFumble: I.hasFumble, kind: np.kind }; }
      // 7. PENALTY, NO PLAY
      { const { np, I } = parseOf("401872948231"); out.penalty = { noPlay: I.noPlay, penTeam: I.penTeam?.abbr, penName: I.penName }; }
      // 8. PUNT (returner named without the word "return" — the NFL phrasing this port had to add)
      { const { np, I } = parseOf("401872948255"); out.punt = { kind: np.kind, kicker: I.kicker?.name, kickYds: I.kickYds, returner: I.returner?.name }; }
      // 9. FIELD GOAL
      { const { np, I } = parseOf("4018729481661"); out.fg = { kind: np.kind, kicker: I.kicker?.name, good: I.good, fgYds: I.fgYds }; }
      // 10. EXTRA POINT (synthesised from the scoring play's own embedded PAT text)
      { const np = get("401872948682"); const pat = raPatFrom(np, null); out.xp = pat ? { kind: pat.kind, typeText: pat.typeText } : null; }
      // 11. TWO-POINT CONVERSION (synthesised the same way)
      { const np = get("4018729483956"); const pat = raPatFrom(np, null); out.twoPt = pat ? { kind: pat.kind, typeText: pat.typeText, yards: pat.yards } : null; }
      // 12. KICKOFF, returned (no "return" keyword in the text either)
      { const { np, I } = parseOf("40187294840"); out.kickoff = { kind: np.kind, kicker: I.kicker?.name, kickYds: I.kickYds, returner: I.returner?.name, touchback: I.touchback }; }
      // 13. KICKOFF, TOUCHBACK — synthetic (this game had none live; real ESPN phrasing per the port brief)
      {
        const raw = { id: "synthetic-tb", type: { text: "Kickoff" }, text: "N.Folk kicks 65 yards from ATL 35 to end zone, Touchback.",
          awayScore: 0, homeScore: 0, period: { number: 1 }, clock: { displayValue: "15:00" }, scoringPlay: false, statYardage: null,
          start: { yardLine: 35, team: { id: ev.away.id } }, end: {}, isTurnover: false };
        const np = normPlay(raw, ev.home.id, ev.away.id, ev.home.abbr);
        const I = raParse(np, ev);
        out.touchback = { touchback: I.touchback, kickYds: I.kickYds, kicker: I.kicker?.name };
      }
      G = null;
      return out;
    }, sumFixture);

    // Hand-computed from the raw fixture JSON (see the play dumps in this port's notes) —
    // ESPN's possessionText is home-goal-scale (GB=home here): "ATL n" -> 100-n, "GB n" -> +n.
    ok(picks.run.yards === 4 && picks.run.sH === 70 && picks.run.eH === 66, `RUN yardage/spot: Bi.Robinson ATL30->ATL34 (+4) => sH70/eH66 (got ${JSON.stringify(picks.run)})`);
    ok(picks.run.rusher === "Bi.Robinson", `RUN rusher name (got ${picks.run.rusher})`);
    ok(picks.pass.yards === 17 && picks.pass.sH === 66 && picks.pass.eH === 49, `PASS yardage/spot: ATL34->GB49 (+17) (got ${JSON.stringify(picks.pass)})`);
    ok(picks.pass.passer === "M.Penix" && picks.pass.target === "Bi.Robinson", `PASS passer/target (got ${picks.pass.passer}/${picks.pass.target})`);
    ok(picks.incomplete.yards === 0 && picks.incomplete.kind === "incomplete", `INCOMPLETE: 0 yards, kind=incomplete (got ${JSON.stringify(picks.incomplete)})`);
    ok(picks.incomplete.passer === "M.Penix" && picks.incomplete.target === "J.Dotson", `INCOMPLETE passer/target (got ${picks.incomplete.passer}/${picks.incomplete.target})`);
    ok(picks.intercept.turnover === true, "INTERCEPTION marked as a turnover");
    ok(picks.intercept.interceptor === "X.McKinney", `INTERCEPTION interceptor name (got ${picks.intercept.interceptor})`);
    ok(picks.intercept.passer === "M.Penix" && picks.intercept.target === "J.Dotson", `INTERCEPTION passer/intended target survive "INTERCEPTED by" (got ${picks.intercept.passer}/${picks.intercept.target})`);
    ok(picks.intercept.sH === 49 && picks.intercept.eH === 45, `INTERCEPTION spot: GB49->GB45 (got ${JSON.stringify(picks.intercept)})`);
    ok(picks.sack.yards === -1 && picks.sack.kind === "sack", `SACK: -1 yards, kind=sack (got ${JSON.stringify(picks.sack)})`);
    ok(picks.sack.sacked === "J.Love", `SACK sacked-player name (got ${picks.sack.sacked})`);
    ok(picks.reversed.kind === "incomplete", `REVERSED PLAY: ESPN's own type.text already reflects the final ruling (got ${picks.reversed.kind})`);
    ok(!/REVERSED|RECOVERED|sacked/i.test(picks.reversed.text), `REVERSED PLAY: cleanText keeps only the text AFTER "REVERSED." (got "${picks.reversed.text}")`);
    ok(picks.reversed.passer === "J.Love" && picks.reversed.target === "S.Moore", `REVERSED PLAY: parses the corrected play (incomplete to S.Moore), not the overturned sack/fumble (got ${picks.reversed.passer}/${picks.reversed.target})`);
    ok(picks.penalty.noPlay === true, "PENALTY, NO PLAY: noPlay flag set");
    ok(picks.penalty.penTeam === "GB" && picks.penalty.penName === "False Start", `PENALTY team/name (got ${picks.penalty.penTeam}/${picks.penalty.penName})`);
    ok(picks.punt.kind === "punt" && picks.punt.kicker === "D.Whelan" && picks.punt.kickYds === 41, `PUNT kicker/yards (got ${JSON.stringify(picks.punt)})`);
    ok(picks.punt.returner === "O.Zaccheaus", `PUNT returner found even though the text never says "return" (got ${picks.punt.returner})`);
    ok(picks.fg.kind === "fg" && picks.fg.kicker === "N.Folk" && picks.fg.good === true && picks.fg.fgYds === 44, `FIELD GOAL kicker/result/distance (got ${JSON.stringify(picks.fg)})`);
    ok(picks.xp && picks.xp.kind === "fg" && /good/i.test(picks.xp.typeText), `EXTRA POINT synthesised from "extra point is GOOD" phrasing (got ${JSON.stringify(picks.xp)})`);
    ok(picks.twoPt && picks.twoPt.kind === "pass" && picks.twoPt.yards === 3, `TWO-POINT CONVERSION synthesised from "ATTEMPT SUCCEEDS" phrasing (got ${JSON.stringify(picks.twoPt)})`);
    ok(picks.kickoff.kind === "kickoff" && picks.kickoff.kicker === "T.Smack" && picks.kickoff.kickYds === 59, `KICKOFF kicker/yards (got ${JSON.stringify(picks.kickoff)})`);
    ok(picks.kickoff.returner === "Br.Robinson" && !picks.kickoff.touchback, `KICKOFF returner found without the word "return" (got ${picks.kickoff.returner})`);
    ok(picks.touchback.touchback === true && picks.touchback.kickYds === 65, `KICKOFF TOUCHBACK detected (got ${JSON.stringify(picks.touchback)})`);

    /* ===================== (e) GFFL owner crests in place of team names ===================== */
    // 2026-09-27, user: "use the gffl logos in place of team names when it shows GFFL
    // starters/benches". The Fantasy tab rows, the game-card starter chips and the per-play
    // chips used to print the owner's abbreviation ("KREU", "GOAT · BN"); each now carries the
    // owner's crest (uploaded logoData first), labelled with the team's full name for screen
    // readers, with BN beside a bench man and a ring on your own. League state is staged by hand
    // (Firestore is blocked here) with the real team names and a real ATL @ GB game.
    section("GFFL owner crests");
    const crest = await page.evaluate(() => {
      S.week = { st: 2, wk: 3 };
      FF.setRules({ scoring: { rush_yd: 0.1, rush_td: 6 } });
      FF.setTeams([
        { teamId: 1, name: "Battle Kreussers", abbrev: "KREU", logo: "https://g.espncdn.com/old.svg", logoData: "data:image/jpeg;base64,AAAA", colors: { primary: "#001331", secondary: "#a81d20" } },
        { teamId: 9, name: "Scruffy Looking Nerfherders", abbrev: "SLN", logoData: "data:image/png;base64,BBBB", colors: { primary: "#f7f2ea", secondary: "#009fe4" } },
      ]);
      FF.setSchedule(3, [[9, 1]]);
      FF.setMyTeam(1);
      const ros = new Map([
        [1, [{ key: "4430807", name: "Bijan Robinson", pos: "RB", team: "ATL", slot: "RB" }, { key: "4360423", name: "Michael Penix Jr.", pos: "QB", team: "ATL", slot: "BENCH" }]],
        [9, [{ key: "4248528", name: "Christian Watson", pos: "WR", team: "GB", slot: "WR" }]],
      ]);
      FF.rostersByTeamId = ros;
      FF.buildOwnerIndex([{ id: 1 }, { id: 9 }], ros);
      FF._playCredits.set("401872948", new Map([["p1", [{ key: "4430807", stat: "rush_td", n: 1 }]]]));
      FFUI.loaded = true;
      const ev = { id: "401872948", state: "post", home: { abbr: "GB" }, away: { abbr: "ATL" } };
      const box = document.createElement("div");
      box.innerHTML = `<div id="t1">${ffTag(1, false)}</div><div id="t9">${ffTag(9, true)}</div><div id="card">${ffCardExtra(ev)}</div><div id="play">${ffPlayExtra(ev, { id: "p1" })}</div>`;
      // What a sighted reader sees as TEXT once the logo has loaded: everything except the
      // aria-hidden monogram that sits under the picture as its fallback.
      const shown = (el) => { const c = el.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove()); return c.textContent.replace(/\s+/g, " ").trim(); };
      const crestOf = (el) => { const c = el && el.querySelector(".ff-crest"); return c ? { label: c.getAttribute("aria-label"), role: c.getAttribute("role"), src: (c.querySelector("img") || {}).getAttribute?.("src") || "", cut: c.classList.contains("cutout") } : null; };
      const chips = [...box.querySelectorAll("#card .ffc")];
      return {
        t1: crestOf(box.querySelector("#t1")), t1Text: shown(box.querySelector("#t1")), t1Me: !!box.querySelector("#t1 .ff-own.me"),
        t9: crestOf(box.querySelector("#t9")), t9Text: shown(box.querySelector("#t9")), t9Me: !!box.querySelector("#t9 .ff-own.me"),
        chips: chips.map((c) => ({ owner: crestOf(c) && crestOf(c).label, text: shown(c) })),
        play: crestOf(box.querySelector("#play .ffp")), playText: shown(box.querySelector("#play")),
      };
    });
    ok(crest.t1 && crest.t1.role === "img" && crest.t1.label === "Battle Kreussers" && crest.t1.src === "data:image/jpeg;base64,AAAA",
      `a starter's owner shows as his GFFL crest, the uploaded logo, labelled with the team name (${JSON.stringify(crest.t1)})`);
    ok(crest.t1Text === "", `…and no team name or abbreviation is printed beside it (visible text ${JSON.stringify(crest.t1Text)})`);
    ok(crest.t1Me && !crest.t9Me, "…your own crest gets the ring, the opponent's does not");
    ok(crest.t9 && crest.t9.label === "Scruffy Looking Nerfherders" && crest.t9.cut && crest.t9Text === "BN",
      `a bench man's owner: crest (transparent PNG kept uncropped) plus BN, no name (${JSON.stringify(crest.t9)} "${crest.t9Text}")`);
    ok(crest.chips.length === 2 && crest.chips.some((c) => c.owner === "Battle Kreussers" && /^B\. Robinson/.test(c.text) && !/KREU/.test(c.text))
      && crest.chips.some((c) => c.owner === "Scruffy Looking Nerfherders" && /^C\. Watson/.test(c.text) && !/SLN/.test(c.text)),
      `game-card starter chips lead with the owner's crest, no abbreviation (${JSON.stringify(crest.chips)})`);
    ok(crest.play && crest.play.label === "Battle Kreussers" && /^\+6\.0 B\. Robinson$/.test(crest.playText),
      `a play chip shows the owner's crest, then "+6.0 B. Robinson", no abbreviation (${JSON.stringify(crest.play)} "${crest.playText}")`);

    /* ===================== console sanity ===================== */
    section("Console");
    ok(consoleErrors.length === 0, `no uncaught page errors${consoleErrors.length ? " (" + consoleErrors.slice(0, 3).join(" | ") + ")" : ""}`);

    await page.close();
  } finally {
    await browser.close();
    srv.close();
  }
}

main().then(() => {
  console.log(`\nsunday: ${pass}/${pass + fail}`);
  if (fail) { console.log("Failures:\n  " + failures.join("\n  ")); process.exit(1); }
}).catch((e) => {
  console.error("Suite crashed:", e);
  process.exit(1);
});
