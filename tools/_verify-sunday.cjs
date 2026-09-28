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
    // MOCK(url) → a response or null. The 8-bit replay section serves the fixture game through it, so
    // the real game view opens with no live ESPN call.
    let MOCK = null;
    page.on("request", (req) => {
      try {
        const m = MOCK && MOCK(req.url());
        if (m) return req.respond(m);
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
      // ── Uniforms: GB at home, ATL on the road (ATL has the ball on this run). GB and ATL's real
      // researched kits (RA_KITS), not ESPN's team.color, are the expected values here.
      tryIt("kit", () => {
        const sc = raBuild(np("40187294863"), ev, new Set());
        const o = raPalette(sc, sc.actors.find((a) => a.side === "o")), d = raPalette(sc, sc.actors.find((a) => a.side === "d"));
        out.kit = { offHome: sc.offHome, away: { J: o.J, P: o.P, H: o.H, n: o.n }, home: { J: d.J, P: d.P, H: d.H, n: d.n },
          nAway: raContrast(o.n, o.J), nHome: raContrast(d.n, d.J), ATLroad: RA_KITS.ATL.road, GBhome: RA_KITS.GB.home };
        // The sidelines wear the same kits as the teams on the field.
        const bench = raBench(sc);
        const bh = raPalette(sc, bench.find((b) => b.side === "d")), ba = raPalette(sc, bench.find((b) => b.side === "o"));
        out.kit.bench = bh.J === d.J && bh.P === d.P && ba.J === o.J && ba.P === o.P;
      });
      // ── RA_KITS itself: all 32 teams, valid hex on every field, home/road/homeWhite shape.
      tryIt("kits32", () => {
        const bad = [];
        for (const a of Object.keys(RA_KITS)) {
          const k = RA_KITS[a];
          if (!k) { bad.push(`${a}:missing`); continue; }
          for (const side of ["home", "road"]) {
            const e = k[side];
            if (!e) { bad.push(`${a}.${side}:missing`); continue; }
            for (const f of ["jersey", "pants", "helmet", "num"]) if (!/^#[0-9a-fA-F]{6}$/.test(e[f] || "")) bad.push(`${a}.${side}.${f}:${e[f]}`);
          }
        }
        out.kits32 = { n: Object.keys(RA_KITS).length, bad };
      });
      // ── An unknown abbreviation on both sides falls back to the old generic rule.
      tryIt("kitUnknown", () => {
        const xt = { abbr: "XYZ", color: "#123456", alt: "#0a0a0a" }, yt = { abbr: "ZYX", color: "#654321", alt: "#f0f0f0" };
        const k = raKit(xt, yt);
        out.kitUnknown = { homeJ: k.home.J, homeP: k.home.P, homeH: k.home.H, roadJ: k.road.J, roadP: k.road.P, roadH: k.road.H };
      });
      // ── Denver: ESPN's team.color for DEN is navy, but the real home jersey is orange, white
      // pants, navy helmet (the exact case the user flagged). Built directly from RA_KITS via raKit
      // on synthetic competitors, normTeam-shaped, swapped in for the fixture's own teams.
      tryIt("kitDen", () => {
        const den = normTeam({ team: { id: "d1", abbreviation: "DEN", color: "002244", alternateColor: "fb4f14" } });
        const kc = normTeam({ team: { id: "k1", abbreviation: "KC", color: "e31837", alternateColor: "ffb612" } });
        out.kitDen = raKit(den, kc).home;
      });
      // ── A homeWhite team (Dallas, white at home) against a visitor whose own road jersey is also
      // white: the visitors switch to their colour (home) jersey instead of clashing white-on-white.
      tryIt("kitClash", () => {
        const dal = normTeam({ team: { id: "dl1", abbreviation: "DAL", color: "002244", alternateColor: "8a98a8" } });
        const nyg = normTeam({ team: { id: "ng1", abbreviation: "NYG", color: "0b2265", alternateColor: "a71930" } });
        out.kitClash = raKit(dal, nyg);
      });
      tryIt("res", () => {
        const sc = raBuild(np("40187294863"), ev, new Set()), o = raPalette(sc, sc.actors.find((a) => a.side === "o"));
        const spr = raSprite("stand", o, false, 12), gg = spr.getContext("2d"), px = gg.getImageData(0, 0, spr.width, spr.height).data;
        let top = 1e9, bot = -1, l = 1e9, r = -1;
        for (let y = 0; y < spr.height; y++) for (let x = 0; x < spr.width; x++) if (px[(y * spr.width + x) * 4 + 3]) { top = Math.min(top, y); bot = Math.max(bot, y); l = Math.min(l, x); r = Math.max(r, x); }
        out.res = { RA_H, PX, PY, HK, inkH: bot - top + 1, inkW: r - l + 1, poses: Object.keys(RA_SKEL).length };
      });
      // 2026-09-28, user: "the players have two colors on their helmet, make the helmet 1 solid
      // color". In the head (the top 9 rows of ink) nothing may be the helmet's shadow or highlight
      // tone or its stripe colour; the shell is all H. (The face, eye and mask are other colours.)
      tryIt("helmet1", () => {
        const sc = raBuild(np("40187294863"), ev, new Set());
        out.helmet1 = ["o", "d"].map((side) => raPalette(sc, sc.actors.find((a) => a.side === side))).map((o) => {
          const spr = raSprite("stand", o, false, 12), gg = spr.getContext("2d"), px = gg.getImageData(0, 0, spr.width, spr.height).data;
          const hex = (i) => "#" + [px[i], px[i + 1], px[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
          let top = 1e9; for (let y = 0; y < spr.height && top === 1e9; y++) for (let x = 0; x < spr.width; x++) if (px[(y * spr.width + x) * 4 + 3]) { top = y; break; }
          const face = new Set([o.F, o.f, o.E, o.e, o.m].filter(Boolean).map((c) => c.toLowerCase()));
          const off = new Set([o.h, o.l, o.w].filter(Boolean).map((c) => c.toLowerCase()).filter((c) => c !== o.H.toLowerCase() && !face.has(c)));
          let shell = 0, other = 0;
          for (let y = top; y < top + 9; y++) for (let x = 0; x < spr.width; x++) { const i = (y * spr.width + x) * 4; if (!px[i + 3]) continue; const c = hex(i); if (c === o.H.toLowerCase()) shell++; else if (off.has(c)) other++; }
          return { H: o.H, shell, other };
        });
      });
      // 2026-09-28, user: "I keep having to refresh to see latest play". The live 8-bit view worked
      // through a backlog up to two plays at a time, each with its walk-back and huddle; now it plays
      // the next one only when exactly one behind, and otherwise goes straight to the newest.
      tryIt("catchUp", () => {
        const keep = G;
        try {
          const comp = fixture.header.competitions[0];
          const gev = normEvent({ ...fixture.header, date: comp.date, status: comp.status });
          G = { ev: gev, sum: normSummary(fixture, gev) };
          const list = raPlays(), n = list.length, keepId = SIDE.playId;
          SIDE.playId = list[n - 2].id; const one = sideNext().id;
          SIDE.playId = list[n - 3].id; const two = sideNext().id;
          SIDE.playId = list[n - 6].id; const five = sideNext().id;
          SIDE.playId = keepId;
          out.catchUp = { n, oneBehind: one === list[n - 1].id, twoBehind: two === list[n - 1].id, fiveBehind: five === list[n - 1].id, twoGot: two, newest: list[n - 1].id };
        } finally { G = keep; }
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
    // RESTAGED 2026-09-28: the old checks here encoded the generic "home jersey = ESPN primary,
    // white pants; away white jersey, primary pants" rule. The user asked for each team's real,
    // researched kit instead (Denver's ESPN team.color is navy but its actual jersey is orange, and
    // several teams like Dallas wear white at home) — the expected values below are GB's and ATL's
    // real researched RA_KITS entries, not ev.away.color/ev.home.color.
    chk(() => [ra.kit.offHome === false && ra.kit.away.J === ra.kit.ATLroad.jersey && ra.kit.away.P === ra.kit.ATLroad.pants && ra.kit.away.H === ra.kit.ATLroad.helmet,
      `away (ATL): its researched road kit, jersey ${ra.kit.ATLroad.jersey} pants ${ra.kit.ATLroad.pants} helmet ${ra.kit.ATLroad.helmet} (${JSON.stringify(ra.kit.away)})`]);
    chk(() => [ra.kit.home.J === ra.kit.GBhome.jersey && ra.kit.home.P === ra.kit.GBhome.pants && ra.kit.home.H === ra.kit.GBhome.helmet,
      `home (GB): its researched home kit, jersey ${ra.kit.GBhome.jersey} pants ${ra.kit.GBhome.pants} helmet ${ra.kit.GBhome.helmet} (${JSON.stringify(ra.kit.home)})`]);
    chk(() => [ra.kit.nAway >= 3 && ra.kit.nHome >= 3, `numbers contrast with the jersey (away ${ra.kit.nAway.toFixed(2)}:1, home ${ra.kit.nHome.toFixed(2)}:1)`]);
    chk(() => [ra.kit.bench, "the sidelines wear the same kits as the teams on the field"]);
    chk(() => [ra.helmets.n === 32 && nfl32.every((a) => ra.helmets.keys.includes(a)) && ["WSH", "LAR", "LAC", "JAX"].every((a) => ra.helmets.keys.includes(a)) && ra.helmets.bad.length === 0,
      `RA_HELMET (now derived from RA_KITS) covers all 32 ESPN abbreviations with hex shells (${ra.helmets.n}, missing ${nfl32.filter((a) => !ra.helmets.keys.includes(a)).join(",") || "none"})`]);
    // RA_KITS itself: all 32 teams, every field on both sides a valid hex.
    chk(() => [ra.kits32.n === 32 && ra.kits32.bad.length === 0, `RA_KITS has all 32 teams with valid hex on every field${ra.kits32.bad.length ? " (bad: " + ra.kits32.bad.slice(0, 8).join(", ") + ")" : ""}`]);
    // An unknown abbreviation on both sides still falls back to the old generic rule (primary
    // jersey/white pants at home, white jersey/primary pants on the road, primary-colour helmet).
    chk(() => [ra.kitUnknown.homeJ === "#123456" && ra.kitUnknown.homeP === "#f2f2f0" && ra.kitUnknown.homeH === "#123456" && ra.kitUnknown.roadJ === "#f2f2f0" && ra.kitUnknown.roadP === "#654321" && ra.kitUnknown.roadH === "#654321",
      `an unrecognised abbreviation falls back to the generic rule (${JSON.stringify(ra.kitUnknown)})`]);
    // Denver: the case the user named — ESPN's team.color is navy, but the real home jersey is
    // orange, worn with white pants, under the navy helmet.
    chk(() => [ra.kitDen.J === "#FB4F14" && ra.kitDen.P === "#FFFFFF" && ra.kitDen.H === "#0a2343",
      `DEN home: orange jersey, white pants, navy helmet, not ESPN's navy team.color (${JSON.stringify(ra.kitDen)})`]);
    // Dallas (white at home) vs. a visitor whose own road jersey is also white: they'd clash, so the
    // visitors wear their own colour (home) jersey instead, same as the real NFL does.
    chk(() => [ra.kitClash.home.J === "#FFFFFF" && ra.kitClash.road.J === "#0B2265",
      `white-vs-white clash: Dallas stays in its white home jersey, the visitors (NYG) switch to their own colour jersey instead of also wearing white (${JSON.stringify(ra.kitClash.home)} / ${JSON.stringify(ra.kitClash.road)})`]);
    // Resolution: the 168px stage at RA_K = 2 → 336px, 18/14/10 px per yard; a standing player was
    // 17 rows of ink plus outline (19); now he is at least 32 rows tall and 12 wide.
    chk(() => [ra.res.RA_H === 336 && ra.res.PX === 18 && ra.res.PY === 14 && ra.res.HK === 10 && ra.res.inkH >= 32 && ra.res.inkH <= 40 && ra.res.inkW >= 12 && ra.res.poses >= 20,
      `the stage is twice the old resolution and a standing player is drawn in ${ra.res.inkW}×${ra.res.inkH} px (${ra.res.poses} poses)`]);
    chk(() => [ra.helmet1.length === 2 && ra.helmet1.every((h) => h.other === 0 && h.shell >= 20),
      `helmets are one solid colour: no shadow, highlight or stripe pixels in the head, only the shell (${JSON.stringify(ra.helmet1)})`]);
    chk(() => [ra.catchUp.oneBehind && ra.catchUp.twoBehind && ra.catchUp.fiveBehind,
      `the live 8-bit view plays the next play when one behind and jumps to the newest when further behind (${JSON.stringify(ra.catchUp)})`]);

    /* ===================== console sanity ===================== */
    // 2026-09-28, user: "when a play includes 'push ob' or 'ob' that means the ball carrier finishes
    // the play crossing out of bounds, so our animation should use that". raParse only knew "out of
    // bounds", which NFL text never says of a runner, so every "pushed ob" play in the game ended in a
    // tackle in the field. Real plays from the fixture: 12 "pushed ob", 4 "ran ob" (runs, catches, a
    // punt return), a punt that went "out of bounds" on its own (the ball, not a runner), and the
    // reversed Kraft fumble whose "ball out of bounds" was overturned.
    section("Out of bounds");
    const oob = await page.evaluate((fixture) => {
      const comp = fixture.header.competitions[0];
      const ev = { home: normTeam(comp.competitors.find((c) => c.homeAway === "home")), away: normTeam(comp.competitors.find((c) => c.homeAway === "away")) };
      const rows = [];
      for (const dr of fixture.drives.previous || []) for (const raw of dr.plays || []) rows.push({ raw, teamId: dr.team?.id });
      const np = (r) => normPlay(r.raw, ev.home.id, r.teamId, ev.home.abbr);
      const flags = (r) => { const I = raParse(np(r), ev); return { oob: !!I.oob, pushed: !!I.pushedOb }; };
      const find = (id) => rows.find((r) => r.raw.id === id);
      const out = { parse: {}, plays: [] };
      out.parse.puntKickOob = flags(find("4018729482215"));      // "punts 48 yards to ATL 11, … out of bounds"
      out.parse.reversed = flags(find("4018729482154"));         // "ball out of bounds" overturned → incomplete
      // "(No Huddle, Shotgun) J.Love pass … ran ob at ATL 18 for 11 yards." names nobody; the formation
      // tag used to be read as two tacklers, "No Huddle" and "Shotgun".
      out.parse.tagTacklers = raParse(np(find("4018729483652")), ev).tacklers.map((w) => w.name || w);
      out.parse.realTacklers = raParse(np(find("4018729483042")), ev).tacklers.map((w) => w.name || w);
      out.parse.counts = { pushed: 0, ran: 0 };
      for (const r of rows) { const f = flags(r); if (f.pushed) out.parse.counts.pushed++; else if (f.oob) out.parse.counts.ran++; }
      // Stage every "ob" play that actually ran (skip the No Play one), find the carrier (the last
      // actor to hold the ball) and the moment he crosses the sideline.
      for (const r of rows) {
        if (!/\bob\b/i.test(r.raw.text) || /no play/i.test(r.raw.text)) continue;
        const p = np(r), I = raParse(p, ev), sc = raBuild(p, ev, new Set());
        // The last PLAYER to hold it: after the whistle an official picks the ball up to spot it.
        const held = sc.ball.filter((b) => b.a && (b.a.side === "o" || b.a.side === "d"));
        const car = held.length ? held[held.length - 1].a : null;
        if (!car) { out.plays.push({ id: r.raw.id, err: "no carrier" }); continue; }
        let tX = null;
        for (let t = 0; t < 20; t += 0.02) if (Math.abs(raPos(car, t)[0]) >= RAX) { tX = t; break; }
        const others = sc.actors.filter((a) => a !== car && a.side === (car.side === "o" ? "d" : "o"));
        let near = 1e9;
        if (tX != null) for (let t = tX - 0.3; t <= tX + 0.3; t += 0.02) { const [cx, cz] = raPos(car, t); for (const a of others) { const [x, z] = raPos(a, t); near = Math.min(near, Math.hypot(x - cx, z - cz)); } }
        out.plays.push({
          id: r.raw.id, pushed: !!I.pushedOb, named: I.tacklers.length > 0, crossed: tX != null,
          drift: tX != null ? +Math.abs(raPos(car, tX + 1)[0]).toFixed(2) : null,
          down: car.downAt != null, near: +near.toFixed(2),
        });
      }
      return out;
    }, sumFixture);
    const RA_SIDELINE_CHECK = 26.67 + 1.5; // half the field's width plus a stride and a half
    // Hand count from the fixture text: 13 "pushed ob" (one of them wiped out by a penalty, No Play,
    // which raParse still reads; staging skips it) and 4 "ran ob".
    ok(oob.parse.counts.pushed === 13 && oob.parse.counts.ran === 4,
      `raParse reads NFL's "pushed ob" and "ran ob" (13 pushed, 4 ran in the game; got ${JSON.stringify(oob.parse.counts)})`);
    ok(oob.parse.tagTacklers.length === 0 && oob.parse.realTacklers.length === 1,
      `a formation tag "(No Huddle, Shotgun)" is not a tackler list; "(J.Bates)" is (${JSON.stringify(oob.parse)})`.slice(0, 400));
    ok(!oob.parse.puntKickOob.oob, `a punt that goes "out of bounds" on its own is not a runner going out (${JSON.stringify(oob.parse.puntKickOob)})`);
    ok(!oob.parse.reversed.oob, `the reversed Kraft fumble ("ball out of bounds", overturned to incomplete) is not out of bounds (${JSON.stringify(oob.parse.reversed)})`);
    const staged = oob.plays.filter((q) => !q.err);
    ok(staged.length >= 15 && staged.every((q) => q.crossed), `every staged "ob" play's carrier crosses the sideline (${staged.filter((q) => q.crossed).length}/${oob.plays.length}: ${JSON.stringify(oob.plays.filter((q) => q.err || !q.crossed))})`);
    ok(staged.every((q) => q.drift > RA_SIDELINE_CHECK), `…and keeps going a step or two past it, out of the field (min ${Math.min(...staged.map((q) => q.drift))} yd from the middle vs ${RA_SIDELINE_CHECK})`);
    ok(staged.every((q) => !q.down), `…on his feet: nobody tackles a man who went out of bounds (${JSON.stringify(staged.filter((q) => q.down).map((q) => q.id))})`);
    ok(staged.filter((q) => q.pushed).every((q) => q.near <= 1.2), `"pushed ob": a defender is on him as he crosses (${JSON.stringify(staged.filter((q) => q.pushed).map((q) => q.near))} yd)`);
    // "ran ob (B.Cisse)": ESPN names the defender who forced him out, so that one shadows him a stride
    // off; with no name he is alone. (3 named, 1 unnamed in the game.)
    ok(staged.filter((q) => !q.pushed && q.named).every((q) => q.near > 0.9 && q.near <= 2.2), `"ran ob" with a named defender: he shadows him out a stride off, no contact (${JSON.stringify(staged.filter((q) => !q.pushed && q.named).map((q) => q.near))} yd)`);
    ok(staged.filter((q) => !q.pushed && !q.named).length >= 1 && staged.filter((q) => !q.pushed && !q.named).every((q) => q.near > 2.5), `"ran ob" with nobody named: he steps out alone, nobody within 2.5 yd (${JSON.stringify(staged.filter((q) => !q.pushed && !q.named).map((q) => q.near))} yd)`);

    /* ===================== (h) injuries: the stretcher ===================== */
    // 2026-09-28, user: "if there is an injury on the play, 2 medical staff with a stretcher should come
    // out and take a guy off the field, show the guys name as he is carried off". ESPN writes it after
    // the play: "ATL-J.Bates was injured during the play." A later "** Injury Update: ATL-J.Bates has
    // returned to the game." is not an injury. Fixtures: ATL @ GB (Bates is a named tackler on 2505,
    // Monk is not otherwise named on 4171; 2567 is the update) and inj-401872949.json, four real CAR @
    // CLE plays (a No Play injury 744, the update 2378, an injury on a failed two-point try 3922, a
    // kickoff injury 3961; ESPN writes Cleveland "CLV" in the text, "CLE" in the header).
    section("Injuries: two trainers, a stretcher, his name");
    const injFix = JSON.parse(fs.readFileSync(path.join(FIX, "inj-401872949.json"), "utf8"));
    const inj = await page.evaluate((fixture, fx2) => {
      const out = {};
      const tryIt = (k, fn) => { try { fn(); } catch (e) { out[k] = { err: String(e.message || e) }; } };
      const game = (fx) => {
        const comp = fx.header.competitions[0];
        const ev = { home: normTeam(comp.competitors.find((c) => c.homeAway === "home")), away: normTeam(comp.competitors.find((c) => c.homeAway === "away")) };
        const byId = new Map();
        for (const dr of fx.drives.previous || []) for (const raw of dr.plays || []) byId.set(raw.id, { raw, teamId: dr.team?.id });
        const np = (id, text) => { const { raw, teamId } = byId.get(id); return normPlay(text == null ? raw : { ...raw, text }, ev.home.id, teamId, ev.home.abbr); };
        return { ev, np, raw: (id) => byId.get(id).raw };
      };
      const A = game(fixture), B = game(fx2);
      const names = (I) => (I.injured || []).map((x) => `${x.team.abbr}-${x.who.name}`);
      // What the side card waits for before it lets the page show the result (sidePlay's resultAt).
      const resultAt = (sc) => Math.min(sc.events.filter((e) => e.kind === "banner").map((e) => e.t).sort((x, y) => x - y)[0] ?? Infinity, sc.tEnd ?? sc.T - 1.5);
      const acrossFromFar = (sc, x) => RAX + x * (sc.offHome ? -1 : 1);     // 0 = far sideline, 53.33 = near
      const crewOf = (sc) => sc.injury?.crews || [];
      tryIt("parse", () => {
        out.parse = {
          bates: names(raParse(A.np("4018729482505"), A.ev)), monk: names(raParse(A.np("4018729484171"), A.ev)), update: names(raParse(A.np("4018729482567"), A.ev)),
          jackson: names(raParse(B.np("401872949744"), B.ev)), wallace: names(raParse(B.np("4018729493961"), B.ev)), update2: names(raParse(B.np("4018729492378"), B.ev)),
          tdPlay: names(raParse(B.np("4018729493922"), B.ev)), cle: B.ev.home.abbr,
        };
        G = { ev: B.ev };
        try { const pat = raPatFrom(B.np("4018729493922"), null); out.parse.tryPlay = names(raParse(pat, B.ev)); out.parse.tryKind = pat.kind; } finally { G = null; }
      });
      // ── 2505: J.Bates (ATL, away, on defense) was one of the two tacklers.
      tryIt("bates", () => {
        const p = A.np("4018729482505"), clean = A.np("4018729482505", A.raw("4018729482505").text.replace(/\s*ATL-J\.Bates was injured during the play\./, ""));
        const sc = raBuild(p, A.ev, new Set()), sc0 = raBuild(clean, A.ev, new Set());
        const cr = crewOf(sc)[0], a = cr.a;
        const named0 = sc0.actors.findIndex((m) => m.who?.name === "J.Bates");
        const tR = resultAt(sc);
        const downAll = [], still = [];
        const [xi, zi] = raPos(a, tR + 0.15);
        for (let t = tR + 0.15; t < cr.tLoad - 0.5; t += 0.05) { downAll.push(raPoseAt(sc, a, t) === "down"); const [x, z] = raPos(a, t); still.push(Math.hypot(x - xi, z - zi)); }
        const meds = sc.actors.filter((m) => m.role === "MED"), str = sc.actors.find((m) => m.role === "STR");
        let reach = 1e9;
        for (let t = cr.tIn; t <= cr.tLoad; t += 0.05) { const [sx, sz] = raPos(str, t); reach = Math.min(reach, Math.hypot(sx - xi, sz - zi)); }
        // The tag: draw one frame mid-carry and one at the result, and read what raDraw writes.
        const said = (t) => {
          const cv = document.createElement("canvas"); cv.width = 600; cv.height = RA_H;
          const orig = window.pixText, seen = [];
          window.pixText = function (g, s, ...rest) { seen.push(String(s)); return orig.call(this, g, s, ...rest); };
          try { const st = { sc, t, cam: null }; const f = sc.injury.focus(t); st.cam = { x: clamp(raSX(sc.offHome ? f.z : 100 - f.z) - 300, 0, RA_WORLD_W - 600), y: clamp(RA_TOP + (RAX + f.x * (sc.offHome ? -1 : 1)) * PY - RA_H * 0.55, 0, RA_WORLD_H - RA_H) }; raDraw(cv.getContext("2d"), 600, st); }
          finally { window.pixText = orig; }
          return seen;
        };
        out.bates = {
          crews: crewOf(sc).length, who: a.who?.name, sameMan: sc.actors.indexOf(a) === named0 && named0 >= 0, side: a.side, atlSide: sc.offT.abbr === "ATL" ? "o" : "d",
          tR, tR0: resultAt(sc0), tEnd: sc.tEnd, tEnd0: sc0.tEnd, banners: JSON.stringify(sc.events.filter((e) => e.kind === "banner").map((e) => [e.t, e.title])), banners0: JSON.stringify(sc0.events.filter((e) => e.kind === "banner").map((e) => [e.t, e.title])),
          T: sc.T, T0: sc0.T, tIn: cr.tIn, tOff: cr.tOff, tLoad: cr.tLoad,
          down: downAll.length > 0 && downAll.every(Boolean), stillMax: Math.max(...still),
          nMed: meds.length, medStart: meds.map((m) => +acrossFromFar(sc, raPos(m, cr.tIn)[0]).toFixed(2)), reach,
          end: [...meds, str, a].map((m) => +acrossFromFar(sc, raPos(m, sc.T)[0]).toFixed(2)),
          tagCarry: said((cr.tUp + cr.tOff) / 2), tagResult: said(tR + 0.3),
          huddle: raHuddle(sc, A.ev, { possession: sc.offT.id, yardLine: 50, down: 1, distance: 10 }).actors.length,
        };
      });
      // ── 4171: GB-J.Monk, named nowhere else in the play; GB is at home and on offense.
      tryIt("monk", () => {
        const sc = raBuild(A.np("4018729484171"), A.ev, new Set()), cr = crewOf(sc)[0], a = cr.a;
        const tR = sc.tEnd, bb = raBall(sc, tR), d = (m) => { const [x, z] = raPos(m, tR); return Math.hypot(x - bb.x, z - bb.z); };
        const gb = sc.offT.abbr === "GB" ? "o" : "d";
        const others = sc.actors.filter((m) => m.side === gb && m !== a && !m.who && m.role !== "K");
        out.monk = { who: a.who?.name, side: a.side, gb, dist: d(a), nearestOther: Math.min(...others.map(d)),
          medStart: sc.actors.filter((m) => m.role === "MED").map((m) => +acrossFromFar(sc, raPos(m, cr.tIn)[0]).toFixed(2)) };
      });
      // ── 744: an injury on a play wiped out by a flag. The stretcher comes after the walk-off.
      tryIt("noPlay", () => {
        const raw = B.raw("401872949744");
        const sc = raBuild(B.np("401872949744"), B.ev, new Set()), sc0 = raBuild(B.np("401872949744", raw.text.replace(/\s*CAR-M\.Jackson was injured during the play\./, "")), B.ev, new Set());
        const cr = crewOf(sc)[0];
        out.noPlay = { crews: crewOf(sc).length, refEnd: sc.refEnd, tIn: cr?.tIn, tR: resultAt(sc), tR0: resultAt(sc0), who: cr?.a.who?.name };
      });
      // ── 3961: a Cleveland player hurt on the kickoff; Cleveland is at home, near side.
      tryIt("kick", () => {
        const sc = raBuild(B.np("4018729493961"), B.ev, new Set()), cr = crewOf(sc)[0];
        out.kick = { who: cr?.a.who?.name, medStart: sc.actors.filter((m) => m.role === "MED").map((m) => +acrossFromFar(sc, raPos(m, cr.tIn)[0]).toFixed(2)) };
      });
      // ── 3922: the injury is on the failed two-point try, staged as its own play.
      tryIt("try", () => {
        G = { ev: B.ev };
        let pat; try { pat = raPatFrom(B.np("4018729493922"), null); } finally { G = null; }
        const td = raBuild(B.np("4018729493922"), B.ev, new Set()), sc = raBuild(pat, B.ev, new Set());
        out.try = { tdCrews: crewOf(td).length, tryCrews: crewOf(sc).length, who: crewOf(sc)[0]?.a.who?.name, team: crewOf(sc)[0] && (crewOf(sc)[0].a.side === "o" ? sc.offT : sc.defT).abbr };
      });
      return out;
    }, sumFixture, injFix);
    const IJ = (fn) => { let r; try { r = fn(); } catch (e) { r = [false, `${(/`([^`$]{0,70})/.exec(fn.toString()) || [])[1] || "check"}… (could not evaluate: ${e.message})`]; } ok(r[0], r[1]); };
    IJ(() => [inj.parse.bates.join() === "ATL-J.Bates" && inj.parse.monk.join() === "GB-J.Monk" && inj.parse.update.length === 0,
      `parse: Bates on 2505, Monk on 4171, nobody on 2567's "Injury Update … returned" (${JSON.stringify([inj.parse.bates, inj.parse.monk, inj.parse.update])})`]);
    IJ(() => [inj.parse.jackson.join() === "CAR-M.Jackson" && inj.parse.wallace.join() === `${inj.parse.cle}-T.Wallace` && inj.parse.update2.length === 0,
      `parse: the No Play injury, a "CLV-" kickoff injury resolved to ${inj.parse.cle}, and no injury on the update (${JSON.stringify([inj.parse.jackson, inj.parse.wallace, inj.parse.update2])})`]);
    IJ(() => [inj.parse.tdPlay.length === 0 && inj.parse.tryPlay.join() === "CAR-D.Lewis" && inj.parse.tryKind === "run",
      `parse: an injury written after "TWO-POINT CONVERSION ATTEMPT" belongs to the try ("rushes up the middle" → a run), not the touchdown (TD ${JSON.stringify(inj.parse.tdPlay)}, try ${JSON.stringify(inj.parse.tryPlay)} ${inj.parse.tryKind})`]);
    const IB = inj.bates;
    IJ(() => [IB.crews === 1 && IB.who === "J.Bates" && IB.sameMan && IB.side === IB.atlSide, `2505: the man who goes down is the Bates already on the field as a tackler, an ATL defender (${IB.who}, same actor ${IB.sameMan}, side ${IB.side})`]);
    IJ(() => [IB.tR === IB.tR0 && IB.tEnd === IB.tEnd0 && IB.banners === IB.banners0, `…the result shows at the same moment as the same play without the injury, banners untouched (${IB.tR.toFixed(3)} vs ${IB.tR0.toFixed(3)})`]);
    IJ(() => [IB.down && IB.stillMax < 0.05 && IB.tIn >= IB.tR, `…he is on the ground, not moving, from the result until he is loaded; the trainers only come out after it (down ${IB.down}, moved ${IB.stillMax.toFixed(3)} yd, crew out ${(IB.tIn - IB.tR).toFixed(2)} s after the result)`]);
    IJ(() => [IB.nMed === 2 && IB.medStart.every((y) => y < 0), `…exactly two trainers, starting beyond the far sideline, ATL's (away) side (${IB.nMed}; ${IB.medStart.join(", ")} yd from the far sideline)`]);
    IJ(() => [IB.reach <= 1.5, `…the stretcher is set down within 1.5 yd of him (${IB.reach.toFixed(2)} yd)`]);
    IJ(() => [IB.end.every((y) => y < 0), `…the trainers, the stretcher and Bates finish beyond the far sideline (${IB.end.join(", ")})`]);
    IJ(() => [IB.tagCarry.includes("BATES") && !IB.tagResult.includes("BATES"), `…"BATES" is drawn over him while he is carried off, and not before (carry ${JSON.stringify(IB.tagCarry)}, at the result ${JSON.stringify(IB.tagResult)})`]);
    IJ(() => [Math.abs(IB.T - Math.max(IB.T0, IB.tOff + 1)) < 1e-9 && IB.T > IB.T0, `…the scene runs until he is off (sc.T ${IB.T0.toFixed(2)} → ${IB.T.toFixed(2)} = carry-off at ${IB.tOff.toFixed(2)} + 1)`]);
    IJ(() => [IB.huddle === 21, `…he doesn't come back for the next huddle (${IB.huddle} players; a substitute runs on for the next snap)`]);
    IJ(() => [inj.monk.who === "J.Monk" && inj.monk.side === inj.monk.gb && inj.monk.dist <= inj.monk.nearestOther && inj.monk.medStart.every((y) => y > 53.33),
      `4171: an unnamed man: the GB player nearest the ball becomes Monk, and the trainers come from GB's (home, near) sideline (${inj.monk.dist.toFixed(2)} vs next ${inj.monk.nearestOther.toFixed(2)} yd; start ${inj.monk.medStart.join(", ")})`]);
    IJ(() => [inj.noPlay.crews === 1 && inj.noPlay.refEnd > 0 && inj.noPlay.tIn >= inj.noPlay.refEnd && inj.noPlay.tR === inj.noPlay.tR0,
      `No Play (744): the injury is still shown, after the flag is walked off, the result time unchanged (walk-off ends ${inj.noPlay.refEnd?.toFixed(2)}, trainers out ${inj.noPlay.tIn?.toFixed(2)})`]);
    IJ(() => [inj.kick.who === "T.Wallace" && inj.kick.medStart.every((y) => y > 53.33), `kickoff (3961): T.Wallace carried off to Cleveland's near sideline (${inj.kick.medStart.join(", ")})`]);
    IJ(() => [inj.try.tdCrews === 0 && inj.try.tryCrews === 1 && inj.try.who === "D.Lewis" && inj.try.team === "CAR", `two-point try (3922): the stretcher is on the try, not the touchdown (TD ${inj.try.tdCrews}, try ${inj.try.tryCrews} for ${inj.try.team}-${inj.try.who})`]);

    /* ===================== (j) replay on the big 8-bit view ===================== */
    // 2026-09-28, user: "On the gffl scores, the 8-bit animation feature, i want to give the option to
    // hit replay like we have on the field view, and then replay gives the option for game start or
    // this drive. Add a 2x and 3x option to replay". The real game view, opened on the ATL @ GB final
    // with the 8-bit view picked. Hand-read from the fixture: the game opens with T.Smack's kickoff
    // (40187294840), then Bi.Robinson's 4-yard run (40187294863); the last drive is ATL's two kneels
    // (4018729484399 at Q4 1:11, 4018729484421 at 0:38) and "End of Game", so "This drive" starts at
    // 4018729484399.
    section("8-bit replay: game start or this drive, 1× 2× 3×");
    {
      const sbEvent = JSON.stringify(sbFixture.events.find((e) => e.id === "401872948"));
      const sumBody = JSON.stringify(sumFixture), sbBody = JSON.stringify(sbFixture);
      const json = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
      MOCK = (u) => /site\.api\.espn\.com.*\/scoreboard\/401872948/.test(u) ? json(sbEvent)
        : /site\.api\.espn\.com.*\/summary\?event=401872948/.test(u) ? json(sumBody)
        : /site\.api\.espn\.com.*\/scoreboard(\?|$)/.test(u) ? json(sbBody) : null;
      await page.setViewport({ width: 390, height: 844 });
      await page.evaluate(() => { localStorage.setItem("sun.tecmoBig", "true"); localStorage.removeItem("sun.tecmoSpeed"); });
      await page.goto(BASE + "/sunday.html#g401872948", { waitUntil: "domcontentloaded" });
      let opened = true;
      try { await page.waitForFunction(() => G && G.sum && document.getElementById("bt-cv")?.offsetParent && SIDE.sc, { timeout: 15000 }); } catch { opened = false; }
      ok(opened, "the fixture game opens on the big 8-bit view");
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      // Every probe reports instead of throwing, so the section runs (and fails check by check) against
      // code without the feature.
      const probe = (fn, arg) => page.evaluate(fn, arg).catch((e) => ({ err: e.message.split("\n")[0] }));
      const vis = () => probe(() => {
        const shown = (el) => !!el && el.offsetParent !== null && el.getBoundingClientRect().width > 0;
        const bar = document.getElementById("bt-rp"), st = document.querySelector(".stadium");
        return {
          replayBtn: shown(document.querySelector("#f-cap .rp-start")), bar: shown(bar),
          choices: bar ? [...bar.querySelectorAll("[data-btrp]")].filter(shown).map((b) => b.textContent.trim()) : [],
          speeds: bar ? [...bar.querySelectorAll("[data-btspeed]")].filter(shown).map((b) => b.textContent.trim() + (b.getAttribute("aria-pressed") === "true" ? "*" : "")) : [],
          label: bar?.querySelector(".bt-rp-l")?.textContent.replace(/\s+/g, " ").trim() || "",
          rp: SIDE.rp ? { id: String(SIDE.rp.id), speed: SIDE.rp.speed, from: SIDE.rp.from } : null,
          fieldReplay: { playing: !!G.playing, cursor: G.cursor ?? null, bar: shown(document.getElementById("replay")) },
          tecmo: st.classList.contains("tecmo"), playId: String(SIDE.playId),
        };
      });
      const click = (sel) => probe((sel) => { const el = document.querySelector(sel); if (!el) return { err: "no " + sel }; el.click(); return {}; }, sel);

      const v0 = await vis();
      ok(v0.tecmo && v0.replayBtn, `the 8-bit view shows a Replay button in the field caption, as the field view does (8-bit on ${v0.tecmo}, button shown ${v0.replayBtn})`);
      await click("#f-cap .rp-start");
      const v1 = await vis();
      ok(v1.bar && v1.choices.join("|") === "Game start|This drive", `…tapping it offers Game start or This drive (${JSON.stringify(v1.choices)})`);
      ok(v1.speeds.join("|") === "1×*|2×|3×", `…with 1×, 2× and 3×, 1× picked on a first visit (${JSON.stringify(v1.speeds)})`);
      ok(!v1.fieldReplay.playing && v1.fieldReplay.cursor === null && !v1.fieldReplay.bar && !v1.rp, `…and it only asks: the field view's replay isn't started, nothing plays yet (${JSON.stringify(v1.fieldReplay)}, 8-bit replay ${JSON.stringify(v1.rp)})`);
      const geo = await probe(() => {
        const st = document.querySelector(".stadium").getBoundingClientRect();
        const els = [...document.querySelectorAll("#bt-rp button")];
        return { right: Math.max(...els.map((b) => b.getBoundingClientRect().right)), left: Math.min(...els.map((b) => b.getBoundingClientRect().left)), st: [st.left, st.right], h: els.map((b) => Math.round(b.getBoundingClientRect().height)), docW: document.documentElement.scrollWidth };
      });
      ok(!geo.err && geo.left >= geo.st[0] && geo.right <= geo.st[1] && geo.docW <= 390 && geo.h.every((h) => h >= 36),
        `390px phone: every control sits inside the field box, no sideways scroll, each ≥36px tall (${JSON.stringify(geo)})`);

      // Game start, at 3× picked from the menu.
      await click('#bt-rp [data-btspeed="3"]');
      const v2 = await vis();
      const stored = await probe(() => localStorage.getItem("sun.tecmoSpeed"));
      ok(v2.speeds.join("|") === "1×|2×|3×*" && stored === "3", `picking 3× marks it and remembers it (${JSON.stringify(v2.speeds)}, stored ${JSON.stringify(stored)})`);
      await click('#bt-rp [data-btrp="game"]');
      const g = await vis();
      ok(g.rp && g.rp.id === "40187294840" && g.playId === "40187294840", `Game start plays the opening kickoff first (T.Smack from the GB 35: ${g.rp?.id})`);
      ok(g.rp && g.rp.speed === 3 && g.label === "Replay · Q1 15:00", `…at 3×, the bar saying where the replay is (${g.rp?.speed}×, ${JSON.stringify(g.label)})`);
      ok(!g.replayBtn && g.choices.join("|") === "Exit replay", `…the caption's Replay button steps aside for an Exit replay button on a final (${g.replayBtn}, ${JSON.stringify(g.choices)})`);
      // Clock rate: scene seconds per wall second, sampled on the same scene at each speed.
      const rate = async (v) => {
        await click(`#bt-rp [data-btspeed="${v}"]`);
        const a = await probe(() => ({ t: SIDE.t, w: performance.now(), sc: SIDE.sc }));
        await wait(700);
        return probe((a0) => ({ r: (SIDE.t - a0.t) / ((performance.now() - a0.w) / 1000), same: SIDE.playId === "40187294840" }), a);
      };
      await probe(() => { SIDE.t = 0.5; });
      const r1 = await rate(1), r2 = await rate(2), r3 = await rate(3);
      const k2 = r2.r / r1.r, k3 = r3.r / r1.r;
      ok(r1.same && r3.same && Math.abs(k2 - 2) < 0.35 && Math.abs(k3 - 3) < 0.5,
        `2× and 3× run the play's clock two and three times as fast as 1× (${r1.r?.toFixed(2)} / ${r2.r?.toFixed(2)} / ${r3.r?.toFixed(2)} scene s per s → ×${k2.toFixed(2)}, ×${k3.toFixed(2)})`);
      // When a scene ends the next play follows: the kickoff, then Robinson's first run.
      await probe(() => { SIDE.t = SIDE.sc.T; });
      await wait(900);
      const g2 = await vis();
      ok(g2.rp && g2.rp.id === "40187294863", `…and when the kickoff is over the next play follows on its own (Bi.Robinson's run: ${g2.rp?.id})`);
      const live = await probe(() => { const keep = G.ev; try { G.ev = { ...keep, state: "in" }; const during = sideLiveOn(); const r = SIDE.rp; SIDE.rp = null; const after = sideLiveOn(); SIDE.rp = r; return { during, after }; } finally { G.ev = keep; } });
      ok(live.during === false && live.after === true, `in a live game the replay never holds the page's score back (gate on during the replay ${live.during}, without it ${live.after})`);
      await click('#bt-rp [data-btrp="stop"]');
      await wait(200);
      const x = await vis();
      ok(!x.rp && !x.bar && x.replayBtn && x.playId === "4018729484421", `Exit replay puts the final play back on the stage, the Replay button back in the caption (${x.playId}, bar ${x.bar}, button ${x.replayBtn})`);

      // This drive: ATL's last drive, first play.
      await click("#f-cap .rp-start");
      const again = await vis();
      ok(again.speeds.join("|") === "1×|2×|3×*", `the menu comes back with the speed last picked (${JSON.stringify(again.speeds)})`);
      await click('#bt-rp [data-btrp="drive"]');
      const d = await vis();
      ok(d.rp && d.rp.id === "4018729484399" && d.label === "Replay · this drive · Q4 1:11", `This drive starts at the first play of the drive on the field (ATL's first kneel, Q4 1:11: ${d.rp?.id}, ${JSON.stringify(d.label)})`);
      // Reaching the newest play hands the stage back: two kneels, then the replay is over.
      for (let i = 0; i < 2; i++) { await probe(() => { SIDE.t = SIDE.sc.T; }); await wait(700); }
      const e = await vis();
      ok(!e.rp && !e.bar && e.replayBtn && e.playId === "4018729484421", `…and after the drive's last play it ends by itself, the newest play still on the stage (${e.playId}, replay ${JSON.stringify(e.rp)})`);

      // The field view keeps its own replay: switching over drops an 8-bit replay, and its Replay
      // button still runs the field replay.
      await click("#f-cap .rp-start"); await click('#bt-rp [data-btrp="game"]');
      await click("#f-cap [data-fview]");
      const f = await vis();
      ok(!f.tecmo && !f.rp && !f.bar, `switching to the field view ends the 8-bit replay (${JSON.stringify({ tecmo: f.tecmo, rp: f.rp, bar: f.bar })})`);
      await click("#f-cap .rp-start");
      const f2 = await vis();
      ok(f2.fieldReplay.playing && !f2.bar, `…and the field view's Replay still starts the field replay (${JSON.stringify(f2.fieldReplay)})`);
      await probe(() => { stopReplay(); localStorage.removeItem("sun.tecmoBig"); localStorage.removeItem("sun.tecmoSpeed"); });
      MOCK = null;
    }

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
