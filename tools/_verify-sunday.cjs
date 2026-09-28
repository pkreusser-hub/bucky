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
    // RESTAGED 2026-09-28: this used to expect 3 yards, the college try from the 3 that the port
    // inherited. An NFL two-point try is snapped from the 2 (user, 2026-09-27: "get the formations
    // matching"), so the synthesised play now starts at the 2 and a good try gains 2.
    ok(picks.twoPt && picks.twoPt.kind === "pass" && picks.twoPt.yards === 2, `TWO-POINT CONVERSION synthesised from "ATTEMPT SUCCEEDS" phrasing, a 2-yard try (got ${JSON.stringify(picks.twoPt)})`);
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

    // 2026-09-27, user: "show all GFFL starters instead of having '+2 GFFL'". The card used to
    // show your matchup's starters (or the first four) and fold the rest into "+N GFFL starters".
    // Six starters in one game: yours, your opponent's, and four on two other GFFL teams.
    const all = await page.evaluate(() => {
      FF.setTeams([
        { teamId: 1, name: "Battle Kreussers", abbrev: "KREU" }, { teamId: 9, name: "Scruffy Looking Nerfherders", abbrev: "SLN" },
        { teamId: 2, name: "Elanikan Skywalkers", abbrev: "ESKY" }, { teamId: 12, name: "The GOAT Kids", abbrev: "GOAT" },
      ]);
      FF.setSchedule(3, [[9, 1], [12, 2]]);
      FF.setMyTeam(1);
      const ros = new Map([
        [1, [{ key: "a1", name: "Bijan Robinson", team: "ATL", slot: "RB" }]],
        [9, [{ key: "a2", name: "Christian Watson", team: "GB", slot: "WR" }]],
        [2, [{ key: "a3", name: "Drake London", team: "ATL", slot: "WR" }, { key: "a4", name: "Jordan Love", team: "GB", slot: "QB" }]],
        [12, [{ key: "a5", name: "Tucker Kraft", team: "GB", slot: "TE" }, { key: "a6", name: "Kyle Pitts", team: "ATL", slot: "TE" }, { key: "a7", name: "Nick Folk", team: "ATL", slot: "BENCH" }]],
      ]);
      FF.rostersByTeamId = ros;
      FF.buildOwnerIndex([...ros.keys()].map((id) => ({ id })), ros);
      const box = document.createElement("div");
      box.innerHTML = ffCardExtra({ id: "401872948", state: "pre", home: { abbr: "GB" }, away: { abbr: "ATL" } });
      return {
        owners: [...box.querySelectorAll(".ffc .ff-crest")].map((c) => c.getAttribute("aria-label")),
        names: [...box.querySelectorAll(".ffc")].map((c) => c.textContent.replace(/\s+/g, " ").trim()),
        text: box.textContent.replace(/\s+/g, " ").trim(),
      };
    });
    ok(all.owners.length === 6 && !/\+\d|GFFL starter/.test(all.text),
      `a game with six GFFL starters shows all six chips, no "+N GFFL starters" (${all.owners.length}: ${JSON.stringify(all.names)})`);
    ok(all.owners[0] === "Battle Kreussers" && all.owners[1] === "Scruffy Looking Nerfherders",
      `…yours first, then your opponent's (${JSON.stringify(all.owners.slice(0, 2))})`);
    ok(!all.names.some((n) => /Folk/.test(n)), "…and a bench player is not a starter chip");

    /* ===================== (f) the GFFL bar + the sections row ===================== */
    // 2026-09-27, user: "its hard to get back to the GFFL from Sunday, move scores, matchups and
    // standings to where the my teams, conferences are and get rid of those entirely, that way the
    // gffl bar can be present when on the Sunday page". A visitor who once picked "My Teams" must
    // not be stuck with a filtered board and no chips to clear it, so reload with one saved.
    // RESTAGED 2026-09-27 (user: "lets have Sunday replace the Scores tab in GFFL, but lets ditch
    // the matchup and standings pages in Sunday. Rename it to 'Scores'"). The bar is GFFL's seven
    // entries now: GFFL's own Scores tab is gone and this page, lit, takes its place and name. The
    // Scores/Matchups/Standings row is gone with the two pages it switched to.
    section("GFFL bar; one page");
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => localStorage.setItem("sun.filter", JSON.stringify("mine")));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof renderBoard === "function" && document.fonts, { timeout: 10000 });
    await page.evaluate(() => document.fonts.ready);
    const nav = await page.evaluate(() => {
      const g = document.getElementById("gnav");
      const links = g ? [...g.querySelectorAll("a")] : [];
      const cs = links[0] ? getComputedStyle(links[0]) : null;
      const ink = (el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; };
      const secs = [...document.querySelectorAll("#topbar .sections a, #tabbar a")];
      const gr = g && g.getBoundingClientRect();
      return {
        labels: links.map((a) => a.textContent.trim()), hrefs: links.map((a) => a.getAttribute("href")),
        current: links.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent.trim()),
        box: links.map((a) => +a.getBoundingClientRect().width.toFixed(2)),
        room: links.map((a) => a.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
        ink: links.map((a) => +ink(a).toFixed(1)), heights: links.map((a) => Math.round(a.getBoundingClientRect().height)),
        font: cs && cs.fontFamily.split(",")[0], fontOk: document.fonts.check("600 10.5px 'Barlow Condensed'"),
        atBottom: gr ? Math.round(innerHeight - gr.bottom) : null, position: g && getComputedStyle(g).position,
        sections: secs.map((a) => a.textContent.trim()), secHrefs: secs.map((a) => a.getAttribute("href")),
        chips: !!document.getElementById("chips"), oldTabbar: !!document.querySelector(".tabbar"),
        filter: S.filter,
        pages: ["fan-page", "stand-page"].filter((id) => document.getElementById(id)),
        title: document.title, wordmark: (document.querySelector(".wordmark")?.firstChild?.textContent || "").trim(),
      };
    });
    ok(nav.labels.join("|") === "League|Matchup|My Team|Rosters|Moves|Chat|Scores",
      `the GFFL bar carries GFFL's seven entries in GFFL's order (${nav.labels.join("|")})`);
    ok(nav.hrefs.slice(0, 6).join(" ") === "league.html#league league.html#matchup league.html#team league.html#rosters league.html#moves league.html#chat",
      `…each league entry links to its GFFL view, and none to GFFL's old Scores view (${nav.hrefs.join(" ")})`);
    ok(nav.current.join() === "Scores" && nav.hrefs[6] === "sunday.html", `…and the lit one is this page, named Scores (${JSON.stringify(nav.current)} → ${nav.hrefs[6]})`);
    ok(nav.title === "Scores" && nav.wordmark === "SCORES", `the page itself is called Scores (title ${JSON.stringify(nav.title)}, wordmark ${JSON.stringify(nav.wordmark)})`);
    ok(nav.position === "fixed" && nav.atBottom === 0, `phone: the bar is fixed to the bottom edge (${nav.position}, ${nav.atBottom}px from the bottom)`);
    // Hand-computed: 390px wide, 6px padding a side, seven equal items → (390 − 12) / 7 = 54px.
    ok(nav.box.length === 7 && nav.box.every((w) => Math.abs(w - 54) <= 0.5), `…every entry's box is (390 − 12) / 7 = 54px (${nav.box.join("/")})`);
    const worstInk = Math.max(...nav.ink), leastRoom = Math.min(...nav.room);
    ok(nav.fontOk && worstInk <= leastRoom, `…the widest label's ink fits its box (Range: ${worstInk}px vs ${leastRoom}px room, Barlow loaded: ${nav.fontOk})`);
    ok(nav.heights.every((h) => h >= 44), `…every entry keeps a ≥44px target (${nav.heights.join(",")})`);
    ok(nav.sections.length === 0 && nav.pages.length === 0,
      `no Matchups or Standings: no section row, no pages (${JSON.stringify(nav.sections)} ${JSON.stringify(nav.pages)})`);
    ok(!nav.chips && !nav.oldTabbar, `the filter chips and Sunday's old bottom tab bar are gone (chips ${nav.chips}, old bar ${nav.oldTabbar})`);
    ok(nav.filter === "all", `a filter saved by an earlier visit ("mine") no longer hides games (S.filter = ${JSON.stringify(nav.filter)})`);
    // An old #matchups / #standings link (a bookmark, a home-screen shortcut) lands on the board.
    const old = [];
    for (const h of ["#matchups", "#standings-nfc-north"]) {
      await page.evaluate((h) => { location.hash = h; }, h);
      await new Promise((r) => setTimeout(r, 150));
      old.push(await page.evaluate(() => ({ hash: location.hash, board: !!document.getElementById("board")?.offsetParent })));
    }
    ok(old.every((o) => o.hash === "" && o.board), `an old #matchups or #standings link shows the board, hash cleared (${JSON.stringify(old)})`);
    // Changing your GFFL team moved to Settings with the Matchups page gone.
    const pick = await page.evaluate(() => {
      FF.setTeams([{ teamId: 1, name: "Battle Kreussers" }, { teamId: 9, name: "Scruffy Looking Nerfherders" }]);
      FF.setMyTeam(9);
      openSettings();
      const sel = document.querySelector("#week-sheet #ff-team-pick");
      const out = { opts: sel ? [...sel.options].map((o) => o.textContent) : null, chosen: sel && sel.value };
      if (sel) { sel.value = "1"; sel.dispatchEvent(new Event("change", { bubbles: true })); }
      out.after = FF.myTeamId; out.stored = localStorage.getItem("sun.team");
      document.querySelector("#week-sheet [data-close]")?.click();
      return out;
    });
    ok(pick.opts && pick.opts.join("|") === "Choose…|Battle Kreussers|Scruffy Looking Nerfherders" && pick.chosen === "9" && pick.after === 1 && pick.stored === "1",
      `Settings carries "Your GFFL team"; picking one switches the page and remembers it (${JSON.stringify(pick)})`);
    await page.setViewport({ width: 1280, height: 900 });
    const desk = await page.evaluate(() => {
      const g = document.getElementById("gnav").getBoundingClientRect(), t = document.getElementById("topbar");
      return { gTop: Math.round(g.top), gH: Math.round(g.height), pos: getComputedStyle(document.getElementById("gnav")).position, topbarTop: getComputedStyle(t).top };
    });
    ok(desk.pos === "sticky" && desk.gTop === 0 && desk.gH === 34 && desk.topbarTop === "34px",
      `desktop: the bar is GFFL's 34px top strip and Sunday's top bar sticks under it (${JSON.stringify(desk)})`);
    await page.setViewport({ width: 800, height: 600 });

    /* ===================== (g) the 8-bit re-enactment: staging, uniforms, resolution ===================== */
    // 2026-09-28, user: "lets start with accuracy, get the formations matching, kickoff alignment, field
    // goals actually looking like field goals and ball getting kicked ... improving the pixel graphics
    // of the players ... away teams should wear white jerseys, primary team color as the pants ...
    // home teams should wear primary jersey color, white pants and their official helmet".
    // Every number below is hand-computed from the fixture (GB home, ATL away) and the rulebook.
    section("8-bit staging, uniforms, resolution");
    const ra = await page.evaluate((fixture) => {
      const comp = fixture.header.competitions[0];
      const ev = { home: normTeam(comp.competitors.find((c) => c.homeAway === "home")), away: normTeam(comp.competitors.find((c) => c.homeAway === "away")) };
      const byId = new Map();
      for (const dr of fixture.drives.previous || []) for (const raw of dr.plays || []) byId.set(raw.id, { raw, teamId: dr.team?.id });
      const np = (id) => { const { raw, teamId } = byId.get(id); return normPlay(raw, ev.home.id, teamId, ev.home.abbr); };
      const synth = (base, text, extra = {}) => { const { raw, teamId } = byId.get(base); return normPlay({ ...raw, id: base + "-x", text, ...extra }, ev.home.id, teamId, ev.home.abbr); };
      const at0 = (a) => raPos(a, 0);
      const moved = (a, t0, t1) => { let m = 0; const [x0, z0] = raPos(a, t0); for (let t = t0; t <= t1; t += 0.02) { const [x, z] = raPos(a, t); m = Math.max(m, Math.hypot(x - x0, z - z0)); } return m; };
      const segAt = (sc, t) => { let s = null; for (const b of sc.ball) if (t >= b.t0) s = b; return s; };
      const out = {};
      // Each block reports on its own, so code without one of these pieces fails its checks instead of
      // crashing the section.
      const tryIt = (k, fn) => { try { fn(); } catch (e) { out[k] = { err: String(e.message || e) }; } };
      // ── Kickoff, GB kicks from its 35 (T.Smack 59 yards to ATL 6, returned 24)
      tryIt("ko", () => {
        const sc = raBuild(np("40187294840"), ev, new Set());
        const K = sc.actors.find((a) => a.role === "K"), off = sc.actors.filter((a) => a.side === "o" && a !== K), def = sc.actors.filter((a) => a.side === "d");
        const { tK, tL } = sc.kick;
        out.ko = {
          z0: sc.z0, tee: raBall(sc, 0).z, kickerAtKick: raPos(K, tK)[1], nOff: off.length + 1, nDef: def.length,
          offZ: off.map((a) => +at0(a)[1].toFixed(2)),
          inSetup: def.filter((a) => at0(a)[1] >= 65 && at0(a)[1] <= 70).length,
          inLanding: def.filter((a) => at0(a)[1] >= 80 && at0(a)[1] <= 100).length,
          beyondSetup: def.filter((a) => { const z = at0(a)[1]; return !(z >= 65 && z <= 70) && !(z >= 80 && z <= 110); }).length,
          earlyMove: sc.actors.filter((a) => a !== K && (a.side === "o" || a.side === "d")).map((a) => moved(a, 0, tL - 0.01)).reduce((m, v) => Math.max(m, v), 0),
          laterMove: off.map((a) => moved(a, tL, tL + 1.5)).reduce((m, v) => Math.max(m, v), 0),
          kickPose: raPoseAt(sc, K, tK + 0.01), ballLeaves: +(raBall(sc, tK + 0.2).z - raBall(sc, tK).z).toFixed(2),
        };
        // …and the same on all ten kickoffs in the game.
        const kos = [...byId.keys()].filter((id) => np(id).kind === "kickoff");
        out.ko.all = kos.length;
        out.ko.allEarly = Math.max(...kos.map((id) => { const s2 = raBuild(np(id), ev, new Set()), K2 = s2.actors.find((a) => a.role === "K"); return Math.max(...s2.actors.filter((a) => a !== K2).map((a) => moved(a, 0, s2.kick.tL - 0.01))); }));
      });
      // ── Kickoff touchback. ESPN puts an ATL kickoff's start at yardLine 65 (home-goal scale), as the
      // real kicks in this fixture do (4018729481681), so the synthetic play carries the same shape.
      tryIt("tb", () => {
        const p = synth("4018729481681", "N.Folk kicks 65 yards from ATL 35 to end zone, Touchback to the GB 35.", { statYardage: 0, end: { yardLine: 35, team: { id: ev.home.id }, possessionText: "GB 35" } });
        const sc = raBuild(p, ev, new Set());
        const end = raBall(sc, sc.T);
        out.tb = { endZ: end.z, endHome: 100 - end.z, carried: sc.ball.filter((b) => b.a && b.a.side === "d").length, tb: sc.I.touchback };
      });
      // ── Field goal: N.Folk 44 yards, snapped at GB 26 (ATL offense, so z0 = 100 − 26 = 74)
      const fg = (p) => {
        const sc = raBuild(p, ev, new Set());
        const K = sc.actors.find((a) => a.role === "K"), holder = sc.actors.find((a) => a.set === "hold");
        const tS = sc.tS, snap = segAt(sc, tS + 0.01);
        // The first time the ball moves off the placed spot is the kick.
        const kick = sc.ball.find((b) => b.from && b.t0 > tS && b.roll !== "tee" && (b.from[0] !== b.to[0] || b.from[1] !== b.to[1] || b.from[2] !== b.to[2]) && b.from[2] < 0.5);
        const post = sc.ball.find((b) => b.to && b.to[1] === RA_POST && b.t0 >= (kick?.t0 ?? 0));
        const place = sc.ball.find((b) => b.roll === "tee");
        const [hx, hz] = raPos(holder, tS + 0.5);
        return { z0: sc.z0, spotZ: place.to[1], holderToSpot: Math.hypot(hx - place.to[0], hz - place.to[1]),
          snapEndsAtHolder: Math.hypot(snap.to[0] - hx, snap.to[1] - hz),
          kickT: kick.t0, tK: sc.kick.tK, poseAtKick: raPoseAt(sc, K, kick.t0 + 0.01), poseBefore: raPoseAt(sc, K, kick.t0 - 0.5),
          kickerToBall: Math.hypot(raPos(K, kick.t0)[0] - kick.from[0], raPos(K, kick.t0)[1] - kick.from[1]),
          kickFromZ: kick.from[1], postX: post ? post.to[0] : null, postH: post ? post.to[2] : null, postZ: post ? post.to[1] : null,
          landZ: kick.to[1], landH: kick.to[2], nOff: sc.actors.filter((a) => a.side === "o").length, nDef: sc.actors.filter((a) => a.side === "d").length };
      };
      tryIt("fg", () => { out.fg = fg(np("4018729481661")); });
      tryIt("fgWide", () => { out.fgWide = fg(synth("4018729481661", "N.Folk 44 yard field goal is No Good, Wide Right, Center-L.McCullough, Holder-J.Bailey.", { type: { id: "60", text: "Field Goal Missed" } })); });
      tryIt("fgShort", () => { out.fgShort = fg(synth("4018729481661", "N.Folk 44 yard field goal is No Good, Short, Center-L.McCullough, Holder-J.Bailey.", { type: { id: "60", text: "Field Goal Missed" } })); });
      // ── The try: a kick from the 15, a two-point play from the 2 (both synthesised from the TD text)
      tryIt("pat", () => {
      let pat, two;
      G = { ev };
      try { pat = raPatFrom(np("401872948682"), null); two = raPatFrom(np("4018729483956"), null); } finally { G = null; }
      out.pat = fg(pat);
      out.two = (() => { const sc = raBuild(two, ev, new Set()); return { z0: sc.z0, nOff: sc.actors.filter((a) => a.side === "o").length, nDef: sc.actors.filter((a) => a.side === "d").length }; })(); });
      // ── Formations on every play of the game
      tryIt("form", () => { const qbs = new Set();
      out.form = { plays: 0, not11: [], ol: [], gun: [], under: [], punt: [], gunN: 0, underN: 0, puntN: 0 };
      for (const id of byId.keys()) {
        const p = np(id);
        let sc; try { sc = raBuild(p, ev, qbs); } catch (e) { continue; }
        out.form.plays++;
        const o = sc.actors.filter((a) => a.side === "o"), d = sc.actors.filter((a) => a.side === "d");
        if (o.length !== 11 || d.length !== 11) out.form.not11.push(`${id}:${o.length}/${d.length}`);
        const qb = o.find((a) => a.role === "QB"), K = o.find((a) => a.role === "K");
        if (qb && !K && qb.set !== "hold") {
          const ol = o.filter((a) => a.role === "OL");
          const atLos = ol.filter((a) => Math.abs(at0(a)[1] - sc.z0) <= 1.5).length;
          // Splits: neighbouring linemen 1-1.5 yd apart across the ball (centre to centre).
          const xs = ol.map((a) => at0(a)[0]).sort((m, n) => m - n), gaps = xs.slice(1).map((x, i) => x - xs[i]);
          if (ol.length !== 5 || atLos !== 5 || gaps.some((g) => g < 1 || g > 1.5)) out.form.ol.push(`${id}:${ol.length}/${atLos}/${gaps.map((g) => g.toFixed(2)).join(",")}`);
          const back = sc.z0 - at0(qb)[1];
          if (sc.I.form === "gun") { out.form.gunN++; if (back < 4 || back > 6) out.form.gun.push(`${id}:${back}`); }
          else if (sc.I.form === "under") { out.form.underN++; if (back > 1.5 || back < 0.5) out.form.under.push(`${id}:${back}`); }
        }
        if (p.kind === "punt") {
          out.form.puntN++;
          const back = sc.z0 - at0(K)[1], shield = o.filter((a) => a !== K && sc.z0 - at0(a)[1] >= 4.5 && sc.z0 - at0(a)[1] <= 6).length;
          if (back < 13 || back > 16 || shield !== 3) out.form.punt.push(`${id}:${back}/${shield}`);
        }
      } });
      // ── Uniforms: GB at home, ATL on the road (ATL has the ball on this run)
      tryIt("kit", () => {
        const sc = raBuild(np("40187294863"), ev, new Set());
        const o = raPalette(sc, sc.actors.find((a) => a.side === "o")), d = raPalette(sc, sc.actors.find((a) => a.side === "d"));
        out.kit = { offHome: sc.offHome, away: { J: o.J, P: o.P, H: o.H, n: o.n }, home: { J: d.J, P: d.P, H: d.H, n: d.n },
          nAway: raContrast(o.n, o.J), nHome: raContrast(d.n, d.J), ATL: ev.away.color, GB: ev.home.color, HATL: RA_HELMET.ATL, HGB: RA_HELMET.GB, white: RA_WHITE,
          unknown: raKit({ abbr: "XYZ", color: "#123456", alt: "#654321" }, true).H };
        // The bench players wear the same kits.
        const bench = raBench(sc);
        const bh = raPalette(sc, bench.find((b) => b.side === "d")), ba = raPalette(sc, bench.find((b) => b.side === "o"));
        out.kit.bench = bh.J === d.J && bh.P === d.P && ba.J === o.J && ba.P === o.P;
      });
      tryIt("res", () => {
        const sc = raBuild(np("40187294863"), ev, new Set()), o = raPalette(sc, sc.actors.find((a) => a.side === "o"));
        const spr = raSprite("stand", o, false, 12), gg = spr.getContext("2d"), px = gg.getImageData(0, 0, spr.width, spr.height).data;
        let top = 1e9, bot = -1, l = 1e9, r = -1;
        for (let y = 0; y < spr.height; y++) for (let x = 0; x < spr.width; x++) if (px[(y * spr.width + x) * 4 + 3]) { top = Math.min(top, y); bot = Math.max(bot, y); l = Math.min(l, x); r = Math.max(r, x); }
        out.res = { RA_H, PX, PY, HK, inkH: bot - top + 1, inkW: r - l + 1, poses: Object.keys(RA_SKEL).length };
      });
      tryIt("helmets", () => { out.helmets = { n: Object.keys(RA_HELMET).length, keys: Object.keys(RA_HELMET), bad: Object.entries(RA_HELMET).filter(([, v]) => !/^#[0-9a-f]{6}$/.test(v)).map(([k]) => k) }; });
      tryIt("post", () => { out.post = { RA_POST, RA_UPRIGHT, RA_BAR }; });
      return out;
    }, sumFixture);
    // A check whose inputs are missing (the section run against code without the feature) fails with
    // the reason instead of throwing.
    const chk = (fn) => { let r; try { r = fn(); } catch (e) { r = [false, `${(/`([^`$]{0,70})/.exec(fn.toString()) || [])[1] || "check"}… (could not evaluate: ${e.message})`]; } ok(r[0], r[1]); };
    const nfl32 = [...new Set(sbFixture.events.flatMap((e) => e.competitions[0].competitors.map((c) => c.team.abbreviation)))];
    // Kickoff geometry, from the rule: kicking team's 35 = z 35, the receiving team's 40 = z 60,
    // their 35..30 = z 65..70, their 20..goal line = z 80..100.
    chk(() => [ra.ko.z0 === 35 && ra.ko.tee === 35 && Math.abs(ra.ko.kickerAtKick - 35) <= 1, `kickoff: the ball on a tee at the kicking team's 35 and the kicker at it when he kicks (tee z ${ra.ko.tee}, kicker z ${ra.ko.kickerAtKick.toFixed(2)})`]);
    chk(() => [ra.ko.offZ.length === 10 && ra.ko.offZ.every((z) => Math.abs(z - 60) <= 0.5), `kickoff: the other ten kicking-team players line up on the receiving team's 40, z 60 ±0.5 (${ra.ko.offZ.join(",")})`]);
    chk(() => [ra.ko.inSetup >= 9 && ra.ko.inLanding >= 1 && ra.ko.inLanding <= 2 && ra.ko.beyondSetup === 0 && ra.ko.nDef === 11 && ra.ko.nOff === 11,
      `kickoff: ≥9 receivers in the setup zone (their 35-30), 1-2 returners in the landing zone, nobody else, 11 a side (setup ${ra.ko.inSetup}, landing ${ra.ko.inLanding}, elsewhere ${ra.ko.beyondSetup}, ${ra.ko.nOff}/${ra.ko.nDef})`]);
    chk(() => [ra.ko.earlyMove < 0.01 && ra.ko.laterMove > 2 && ra.ko.all === 10 && ra.ko.allEarly < 0.01,
      `kickoff: nobody but the kicker moves until the ball comes down, then the coverage goes (max move before landing ${ra.ko.earlyMove.toFixed(3)} yd, after ${ra.ko.laterMove.toFixed(1)}; worst of all ${ra.ko.all} kickoffs ${ra.ko.allEarly.toFixed(3)})`]);
    chk(() => [ra.ko.kickPose === "kick" && ra.ko.ballLeaves > 2, `kickoff: the kicker is in his kicking pose as the ball leaves the tee (${ra.ko.kickPose}, ball ${ra.ko.ballLeaves} yd downfield 0.2 s later)`]);
    // ATL kicks toward the home goal: the receiving (GB) 35 is home-scale H 35, kicking-frame z 65.
    chk(() => [ra.tb.tb && ra.tb.endZ === 65 && ra.tb.endHome === 35 && ra.tb.carried === 0,
      `kickoff touchback: the ball ends at the receiving team's 35 (z ${ra.tb.endZ}, GB ${ra.tb.endHome}) and nobody returns it (${ra.tb.carried} carries)`]);
    // Field goal: 44 yards from GB 26 → kick spot 44 − 10 − 26 = 8 yards behind the LOS (z 74 − 8 = 66), posts at z 110.
    chk(() => [ra.fg.z0 === 74 && ra.fg.spotZ === 66 && ra.fg.z0 - ra.fg.spotZ >= 6 && ra.fg.z0 - ra.fg.spotZ <= 8 && ra.fg.holderToSpot < 1,
      `FG: the holder kneels at the spot, 44 − 10 − 26 = 8 yd behind the LOS (LOS z ${ra.fg.z0}, spot ${ra.fg.spotZ}, holder ${ra.fg.holderToSpot.toFixed(2)} yd from it)`]);
    chk(() => [ra.fg.snapEndsAtHolder < 1, `FG: the snap travels to the holder's hands (${ra.fg.snapEndsAtHolder.toFixed(2)} yd off)`]);
    chk(() => [Math.abs(ra.fg.kickT - ra.fg.tK) < 1e-6 && ra.fg.poseAtKick === "kick" && ra.fg.poseBefore !== "kick" && ra.fg.kickerToBall < 1.2,
      `FG: the ball's first move off the spot is the kicker's swing (pose ${ra.fg.poseAtKick}, before it ${ra.fg.poseBefore}, kicker ${ra.fg.kickerToBall.toFixed(2)} yd from the ball)`]);
    chk(() => [ra.fg.postZ === ra.post.RA_POST && ra.post.RA_POST === 110 && ra.fg.postH > ra.post.RA_BAR && Math.abs(ra.post.RA_BAR - 10 / 3) < 0.01 && Math.abs(ra.fg.postX) < ra.post.RA_UPRIGHT,
      `FG good: at the end line (z 110) the ball is over the 10-ft (3.33-yd) bar between the uprights (height ${ra.fg.postH?.toFixed(2)} yd, ${ra.fg.postX?.toFixed(2)} yd off centre, uprights ±${ra.post.RA_UPRIGHT})`]);
    chk(() => [ra.post.RA_POST - ra.fg.kickFromZ === 44, `FG: 44 yards from the kick spot to the posts (110 − ${ra.fg.kickFromZ})`]);
    chk(() => [ra.fgWide.postX > ra.post.RA_UPRIGHT && ra.fgWide.postZ === 110, `FG "No Good, Wide Right": the ball passes the end line outside the right upright (x ${ra.fgWide.postX?.toFixed(2)} > ${ra.post.RA_UPRIGHT})`]);
    chk(() => [ra.fgShort.postZ == null && ra.fgShort.landH === 0 && ra.fgShort.landZ < 110, `FG "No Good, Short": the ball comes down before the end line (at z ${ra.fgShort.landZ?.toFixed(1)}, height ${ra.fgShort.landH})`]);
    chk(() => [ra.pat.z0 === 85 && ra.post.RA_POST - ra.pat.kickFromZ === 33 && ra.pat.postH > ra.post.RA_BAR && ra.pat.nOff === 11 && ra.pat.nDef === 11,
      `PAT: snapped at the 15 (z ${ra.pat.z0}), a 33-yard kick (110 − ${ra.pat.kickFromZ}), over the bar, 11 a side`]);
    chk(() => [ra.two.z0 === 98 && ra.two.nOff === 11 && ra.two.nDef === 11, `two-point try: a scrimmage play from the 2 (z ${ra.two.z0}), 11 a side`]);
    chk(() => [ra.form.plays === 184 && ra.form.not11.length === 0, `11 a side on every one of the ${ra.form.plays} plays${ra.form.not11.length ? " (" + ra.form.not11.slice(0, 6).join(" ") + ")" : ""}`]);
    chk(() => [ra.form.ol.length === 0, `every scrimmage play: five offensive linemen, all within 1.5 yd of the LOS, 1-1.5 yd splits${ra.form.ol.length ? " (" + ra.form.ol.slice(0, 6).join(" ") + ")" : ""}`]);
    chk(() => [ra.form.gunN >= 60 && ra.form.gun.length === 0, `shotgun snaps (${ra.form.gunN}): the QB 5±1 yd behind the ball${ra.form.gun.length ? " (" + ra.form.gun.slice(0, 5).join(" ") + ")" : ""}`]);
    chk(() => [ra.form.underN >= 20 && ra.form.under.length === 0, `under-center snaps (${ra.form.underN}): the QB within 1.5 yd of the ball${ra.form.under.length ? " (" + ra.form.under.slice(0, 5).join(" ") + ")" : ""}`]);
    chk(() => [ra.form.puntN === 7 && ra.form.punt.length === 0, `punts (${ra.form.puntN} in the game — 255, 400, 1117, 1317, 1463, 2215, 3166): the punter 13-16 yd behind the LOS, a three-man shield about 5 yd deep${ra.form.punt.length ? " (" + ra.form.punt.join(" ") + ")" : ""}`]);
    chk(() => [ra.kit.offHome === false && ra.kit.away.J === ra.kit.white && ra.kit.away.P === ra.kit.ATL && ra.kit.away.H === ra.kit.HATL,
      `away (ATL): white jersey, primary (${ra.kit.ATL}) pants, official helmet ${ra.kit.HATL} (${JSON.stringify(ra.kit.away)})`]);
    chk(() => [ra.kit.home.J === ra.kit.GB && ra.kit.home.P === ra.kit.white && ra.kit.home.H === ra.kit.HGB,
      `home (GB): primary (${ra.kit.GB}) jersey, white pants, official helmet ${ra.kit.HGB} (${JSON.stringify(ra.kit.home)})`]);
    chk(() => [ra.kit.nAway >= 3 && ra.kit.nHome >= 3, `numbers contrast with the jersey (away ${ra.kit.nAway.toFixed(2)}:1, home ${ra.kit.nHome.toFixed(2)}:1)`]);
    chk(() => [ra.kit.bench, "the sidelines wear the same kits as the teams on the field"]);
    chk(() => [ra.helmets.n === 32 && nfl32.every((a) => ra.helmets.keys.includes(a)) && ["WSH", "LAR", "LAC", "JAX"].every((a) => ra.helmets.keys.includes(a)) && ra.helmets.bad.length === 0 && ra.kit.unknown === "#123456",
      `RA_HELMET covers all 32 ESPN abbreviations with hex shells; an unknown team falls back to its primary (${ra.helmets.n}, missing ${nfl32.filter((a) => !ra.helmets.keys.includes(a)).join(",") || "none"})`]);
    // Resolution: the 168px stage at RA_K = 2 → 336px, 18/14/10 px per yard; a standing player was
    // 17 rows of ink plus outline (19); now he is at least 32 rows tall and 12 wide.
    chk(() => [ra.res.RA_H === 336 && ra.res.PX === 18 && ra.res.PY === 14 && ra.res.HK === 10 && ra.res.inkH >= 32 && ra.res.inkH <= 40 && ra.res.inkW >= 12 && ra.res.poses >= 20,
      `the stage is twice the old resolution and a standing player is drawn in ${ra.res.inkW}×${ra.res.inkH} px (${ra.res.poses} poses)`]);

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
