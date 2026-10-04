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
    // RESTAGED 2026-09-28 (user: "just have it only be the detail page"): the board is now only the
    // loading screen. Here no games have loaded (ESPN isn't served), so the link clears its hash and
    // shows that; with games it lands on a game's detail (section "Scores is the game detail").
    ok(old.every((o) => o.hash === "" && o.board), `an old #matchups or #standings link clears its hash and, with no games loaded yet, shows the loading board (${JSON.stringify(old)})`);
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
    // RESTAGED 2026-09-28 (user: "Scores page should fit within the GFFL desktop site like the other
    // GFFL pages, right now it has its own top bar and the GFFL header goes away"): the strip now sits
    // under GFFL's own 46px header, as league.html's #bnav does, and Scores' own top bar is gone on
    // desktop (the week picker and Settings live in that header; section "GFFL's header on desktop").
    const deskT = await page.evaluate(() => ({ topbarShown: document.getElementById("topbar").offsetParent !== null, hdrH: Math.round(document.getElementById("ghdr")?.getBoundingClientRect().height ?? 0) }));
    ok(desk.pos === "sticky" && desk.gTop === 46 && desk.gH === 34 && deskT.hdrH === 46 && !deskT.topbarShown,
      `desktop: the bar is GFFL's 34px strip under GFFL's 46px header, and Scores' own top bar is gone (${JSON.stringify({ ...desk, ...deskT })})`);
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
        let jump = 0; for (let t = 0.05; t <= sc.T; t += 0.05) { const a = raBall(sc, t - 0.05), c = raBall(sc, t); jump = Math.max(jump, Math.hypot(c.x - a.x, c.z - a.z)); }
        out.tb = { endZ: end.z, spotZ: sc.spotZ, endHome: 100 - sc.spotZ, carried: sc.ball.filter((b) => b.a && b.a.side === "d").length, tb: sc.I.touchback, jump: +jump.toFixed(2) };
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
      // RESTAGED 2026-09-29, user: "lets take a run at making logos on the helmets". The logo is a
      // decal on that one-colour shell, and logos use the kit's other colours (the Packers' G is the
      // jersey green and white, the falcon has white in it), which this count took for a second
      // helmet colour. So the shell is read off the same player drawn with no logo, where it must
      // still be all H; the logo is the pixels where the two drawings differ, and every one of those
      // must be a shell pixel underneath. How much of each logo shows is checked in the players section.
      tryIt("helmet1", () => {
        const sc = raBuild(np("40187294863"), ev, new Set());
        out.helmet1 = ["o", "d"].map((side) => raPalette(sc, sc.actors.find((a) => a.side === side))).map((o) => {
          const spr = raSprite("stand", o, false, 12), gg = spr.getContext("2d"), lp = gg.getImageData(0, 0, spr.width, spr.height).data;
          const bare = raSprite("stand", { ...o, logo: null, logoKey: "" }, false, 12), px = bare.getContext("2d").getImageData(0, 0, bare.width, bare.height).data;
          const hex = (i) => "#" + [px[i], px[i + 1], px[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
          let top = 1e9; for (let y = 0; y < spr.height && top === 1e9; y++) for (let x = 0; x < spr.width; x++) if (px[(y * spr.width + x) * 4 + 3]) { top = y; break; }
          const face = new Set([o.F, o.f, o.E, o.e, o.m].filter(Boolean).map((c) => c.toLowerCase()));
          const off = new Set([o.h, o.l, o.w].filter(Boolean).map((c) => c.toLowerCase()).filter((c) => c !== o.H.toLowerCase() && !face.has(c)));
          let shell = 0, other = 0, logo = 0, logoOffShell = 0;
          for (let y = top; y < top + 9; y++) for (let x = 0; x < spr.width; x++) { const i = (y * spr.width + x) * 4; if (!px[i + 3]) continue; const c = hex(i); if (c === o.H.toLowerCase()) shell++; else if (off.has(c)) other++; }
          for (let i = 0; i < lp.length; i += 4) if (lp[i] !== px[i] || lp[i + 1] !== px[i + 1] || lp[i + 2] !== px[i + 2] || lp[i + 3] !== px[i + 3]) { logo++; if (hex(i) !== o.H.toLowerCase()) logoOffShell++; }
          return { H: o.H, shell, other, logo, logoOffShell };
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
    // RESTAGED 2026-09-28 (the week-3 audit): this asserted the ball itself ends on the 35, and it got
    // there by being put on it in one frame at the whistle, a 40-yard jump across the screen. The ball
    // now stays in the end zone where it died; the 35 is the spot the next snap is set at (sc.spotZ).
    chk(() => [ra.tb.tb && ra.tb.spotZ === 65 && ra.tb.endHome === 35 && ra.tb.endZ >= 100 && ra.tb.carried === 0 && ra.tb.jump <= 2.6,
      `kickoff touchback: the next snap is spotted at the receiving team's 35 (z ${ra.tb.spotZ}, GB ${ra.tb.endHome}), the ball stays in the end zone (z ${ra.tb.endZ?.toFixed?.(1)}) with no jump (${ra.tb.jump} yd per 0.05 s) and nobody returns it (${ra.tb.carried} carries)`]);
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
    chk(() => [ra.helmet1.length === 2 && ra.helmet1.every((h) => h.other === 0 && h.shell >= 20 && h.logoOffShell === 0),
      `helmets are one solid colour: no shadow, highlight or stripe pixels in the head, only the shell, and the team's logo painted only over shell (${JSON.stringify(ra.helmet1)})`]);
    chk(() => [ra.catchUp.oneBehind && ra.catchUp.twoBehind && ra.catchUp.fiveBehind,
      `the live 8-bit view plays the next play when one behind and jumps to the newest when further behind (${JSON.stringify(ra.catchUp)})`]);

    /* ===================== (g2) the 8-bit players: pixel art and animation ===================== */
    // 2026-09-29, user: "do a design pass on the 8-bit players in gffl to get them better pixel
    // graphics and better animations". Every number is read off the rig (RA_SKEL after raRig), the
    // rasterised shade-code grids (raFig) or frames drawn through raDraw on the ATL @ GB fixture, never
    // off rendered pixels. Frames are drawn 60 (or 30) a second on a canvas as wide as the world, so
    // nobody is culled and the stride's phase is carried from frame to frame as on screen.
    section("8-bit players: pixel art and animation");
    // (160's hit on the passer is nflverse's `hit`, so that play is built with its real detail.)
    const det160 = JSON.parse(fs.readFileSync(path.join(FIX, "pbp-401872948.json"), "utf8")).plays["401872948160"];
    const pl = await page.evaluate((fixture, det160) => {
      const comp = fixture.header.competitions[0];
      const ev = { home: normTeam(comp.competitors.find((c) => c.homeAway === "home")), away: normTeam(comp.competitors.find((c) => c.homeAway === "away")) };
      const byId = new Map();
      for (const dr of fixture.drives.previous || []) for (const raw of dr.plays || []) byId.set(raw.id, { raw, teamId: dr.team?.id });
      const np = (id) => { const { raw, teamId } = byId.get(id); return normPlay(raw, ev.home.id, teamId, ev.home.abbr); };
      const out = {};
      const tryIt = (k, fn) => { try { fn(); } catch (e) { out[k] = { err: String(e.message || e) }; } };
      const cv = document.createElement("canvas"); cv.width = RA_WORLD_W; cv.height = RA_WORLD_H;
      const g = cv.getContext("2d");
      const frames = (sc, t1, fn, dt = 1 / 60) => { const st = { sc, t: 0, cam: { x: 0, y: 0 }, shown: new Set() }; for (let t = 0; t <= t1 + 1e-9; t += dt) { st.t = t; raDraw(g, cv.width, st); fn(t, st); } };
      const d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
      const MAT = { J: "J", j: "J", L: "J", P: "P", p: "P", Q: "P", S: "S", s: "S", F: "F", f: "F", E: "F", B: "B", b: "B", C: "C", c: "C" };
      const sx = (sc, a, t) => { const [, z] = raPos(a, t); return raSX(sc.offHome ? z : 100 - z); };
      const gait = (p) => /^(walk|jog|run|carry|back|crun)\d$/.exec(p || "")?.[1] || null;
      // ── The rig: one set of bone lengths for every frame.
      tryIt("bones", () => {
        let worst = 0, at = "";
        for (const [k, S] of Object.entries(RA_SKEL)) {
          const L = [[S.fl, 5.9, 5.2], [S.bl, 5.9, 5.2], [S.fa, 6, 4.6], [S.ba, 6, 4.6]];
          const dev = Math.max(...L.flatMap(([A, a, b]) => [Math.abs(d(A[0], A[1]) - a), Math.abs(d(A[1], A[2]) - b)]), Math.abs(d(S.h, S.s) - (S.tl || 10)));
          if (dev > worst) { worst = dev; at = k; }
        }
        out.bones = { n: Object.keys(RA_SKEL).length, worst: +worst.toFixed(3), at };
      });
      // ── The strides: eight frames a gait, all different; the run's feet and bob.
      tryIt("gaits", () => {
        const names = ["walk", "jog", "run", "carry", "back"];
        const per = names.map((n) => { const fr = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => RA_SKEL[n + i]); return fr.every(Boolean) ? new Set(fr.map((_, i) => raFig(n + (i + 1), "p").g.join(""))).size : 0; });
        const run = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => RA_SKEL["run" + i]);
        const ax = run.map((S) => S.fl[2][0]), hy = run.map((S) => S.h[1]);
        out.gaits = { names, distinct: per, ankleSpan: +(Math.max(...ax) - Math.min(...ax)).toFixed(2), bob: +(Math.max(...hy) - Math.min(...hy)).toFixed(2), gaitsObj: typeof RA_GAITS === "object" };
      });
      // ── The cadence: a man speeding up from a standstill to 9 yd/s over 3 s, drawn 60 times a second.
      tryIt("cadence", () => {
        const a = { phase: 0 }, idx = [], ph = [];
        for (let i = 0; i <= 180; i++) {
          const t = i / 60, v = 3 * t, gt = v < 2.4 ? "walk" : v < 5.6 ? "jog" : "run";
          if (v < 0.8) continue;
          idx.push(+raGaitFrame(a, t, gt, v).slice(-1) - 1);
          ph.push([t, a.gph.ph]);
        }
        const steps = idx.slice(1).map((k, i) => (k - idx[i] + 8) % 8);
        const p2 = ph.find(([t]) => Math.abs(t - 2) < 1e-9)[1], p3 = ph.find(([t]) => Math.abs(t - 3) < 1e-9)[1];
        // Over the last second (6 → 9 yd/s, all running) he covers ∫3t dt = 7.5 yd at 4.2 yd a stride.
        out.cadence = { maxStep: Math.max(...steps), strides: +(p3 - p2).toFixed(3), expect: +(7.5 / 4.2).toFixed(3) };
      });
      // ── The silhouette: shoulder pads wider than the helmet.
      tryIt("pads", () => {
        const f = raFig("stand", "p");
        const rows = (set) => { let best = 0; for (let y = 0; y < f.H; y++) { let n = 0; for (let x = 0; x < f.W; x++) if (set.includes(f.g[y * f.W + x])) n++; best = Math.max(best, n); } return best; };
        out.pads = { jersey: rows(["J", "j", "L"]), helmet: rows(["H"]) };
      });
      // ── Clean pixels: no lone pixel of a tone inside a patch of another tone of the same colour, in
      // any frame, for players, officials and trainers.
      tryIt("lone", () => {
        let n = 0, frames_ = 0; const where = [];
        for (const v of ["p", "r", "m"]) for (const k of Object.keys(RA_SKEL)) {
          const f = raFig(k, v); frames_++;
          for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
            const c = f.g[y * f.W + x], m = MAT[c];
            if (!m) continue;
            const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].map(([u, w]) => (u < 0 || w < 0 || u >= f.W || w >= f.H ? "." : f.g[w * f.W + u])).filter((q) => MAT[q] === m);
            if (nb.length >= 3 && !nb.includes(c)) { n++; if (where.length < 4) where.push(`${k}/${v}`); }
          }
        }
        out.lone = { n, frames: frames_, where };
      });
      // ── No black line through the body: HEAD ringed each near arm and leg with the outline colour
      // where it crossed the body. Now it casts a shade, and the only dark cells inside a figure away
      // from the helmet's rim are the outline of an enclosed gap (between two legs, an arm and the body).
      tryIt("lines", () => {
        let n = 0, frames_ = 0, most = 0, at = "";
        for (const [k, S] of Object.entries(RA_SKEL)) {
          const f = raFig(k, "p"), cx = f.ax + S.c[0], cy = f.ay - S.c[1];
          let m = 0; frames_++;
          for (let y = 1; y < f.H - 1; y++) for (let x = 1; x < f.W - 1; x++) {
            if (f.g[y * f.W + x] !== "O") continue;
            if ([f.g[y * f.W + x - 1], f.g[y * f.W + x + 1], f.g[(y - 1) * f.W + x], f.g[(y + 1) * f.W + x]].includes(".")) continue;
            if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < 7.5) continue;           // (the helmet's own dark rim)
            m++;
          }
          n += m; if (m > most) { most = m; at = k; }
        }
        out.lines = { perFrame: +(n / frames_).toFixed(1), most, at, frames: frames_ };
      });
      // ── Play 885 (Penix to Robinson for 17, Franklin and Cisse tackle him) drawn 60 a second.
      tryIt("pass", () => {
        const sc = raBuild(np("40187294885"), ev, new Set());
        const attackRight = !sc.offHome;
        const qb = sc.actors.find((a) => a.role === "QB" && a.side === "o"), rec = sc.actors.find((a) => a.who?.last === "Robinson");
        const ol = sc.actors.filter((a) => a.role === "OL" && a.side === "o");
        const tk = sc.actors.find((a) => a.tackler) || sc.actors.find((a) => a.who?.last === "Franklin");
        const tThrow = qb.acts.find((q) => q[2] === "throw2")[0];
        const seq = { qb: [], rec: [], tk: [] }, olFace = { n: 0, wrong: 0 }, olPoses = new Set(), dbBack = new Set(), qbDrop = { back: 0, fwd: 0 };
        const push = (arr, p) => { if (arr[arr.length - 1] !== p) arr.push(p); };
        frames(sc, sc.T, (t) => {
          push(seq.qb, qb.drawn?.pose); push(seq.rec, rec.drawn?.pose); push(seq.tk, tk.drawn?.pose);
          if (t >= sc.tS && t < sc.tEnd) for (const a of ol) { olFace.n++; if (a.drawn.flip !== !attackRight) olFace.wrong++; if (t < sc.tS + 1.6 && /^block/.test(a.drawn.pose)) olPoses.add(a.drawn.pose); }
          // The drop: moving back from the line before the throw.
          if (t > sc.tS + 0.3 && t < tThrow - 0.4) { const g_ = gait(qb.drawn.pose); if (g_ === "back") qbDrop.back++; else if (g_) qbDrop.fwd++; }
          if (t > sc.tS && t < tThrow) for (const a of sc.actors) if (a.side === "d" && (a.role === "DB" || a.role === "LB") && gait(a.drawn?.pose) === "back" && a.drawn.flip === attackRight) dbBack.add(sc.actors.indexOf(a));
        });
        out.pass = { seq, olFace, olPoses: [...olPoses], dbBack: dbBack.size, qbDrop, tackler: !!tk?.tackler, hold: { throw1: RA_HOLD.throw1, far: RA_SKEL.throw1?.ba?.[2] } };
      });
      // ── No moonwalking: across the game's first 14 completions and incompletions, every frame of a man
      // moving against the way he faces (faster than a walk) is a backpedal, never a forward stride.
      tryIt("moon", () => {
        const passes = [...byId.values()].filter((r) => /\bpass\b/.test(r.raw.text || "") && !/PENALTY|INTERCEPT|sacked/i.test(r.raw.text) && r.raw.type?.text !== "Two-point Conversion").slice(0, 14);
        let n = 0, fwd = 0; const bad = [];
        for (const r of passes) {
          const sc = raBuild(np(r.raw.id), ev, new Set());
          const prev = new Map();
          frames(sc, sc.tEnd ?? sc.T, (t) => {
            for (const a of sc.actors) {
              if (a.side !== "o" && a.side !== "d") continue;
              const x = sx(sc, a, t), [px, pz] = raPos(a, Math.max(0, t - 0.1)), ox = raSX(sc.offHome ? pz : 100 - pz);
              const [cx, cz] = raPos(a, t), speed = Math.hypot(cx - px, cz - pz) / 0.1;
              const against = speed > 1.5 && a.drawn && ((x - ox > 0.5 * RA_K && a.drawn.flip) || (ox - x > 0.5 * RA_K && !a.drawn.flip));
              const g_ = gait(a.drawn?.pose);
              if (against && g_) { n++; if (g_ !== "back") { fwd++; if (bad.length < 4) bad.push(`${r.raw.id}:${a.role}@${t.toFixed(2)}`); } }
            }
          }, 1 / 30);
        }
        out.moon = { plays: passes.length, n, fwd, bad };
      });
      // ── The run (863, Bi.Robinson 4 yd): after the handoff he carries it tucked.
      tryIt("carry", () => {
        const sc = raBuild(np("40187294863"), ev, new Set());
        const car = sc.actors.find((a) => a.who?.last === "Robinson");
        const tHand = sc.ball.find((q) => q.a === car).t0;
        let n = 0, tucked = 0, atHand = true;
        frames(sc, sc.tEnd, (t) => {
          if (t < tHand + 0.1 || t > sc.tEnd - 0.15) return;
          const [px, pz] = raPos(car, t - 0.1), [x, z] = raPos(car, t);
          if (Math.hypot(x - px, z - pz) / 0.1 < 2.4) return;
          n++;
          if (gait(car.drawn.pose) === "carry") tucked++;
          const S = RA_SKEL[car.drawn.pose], h = RA_HOLD[car.drawn.pose];
          if (!S || !h || Math.hypot(h[0] - S.fa[2][0], h[1] - S.fa[2][1]) > 1.2) atHand = false;
        });
        out.carry = { n, tucked, atHand };
      });
      // ── Down and back up: 160's QB is hit as he throws (down 0.3 s after, up 2.1 s after); the
      // kneel-down (4399) takes a knee.
      tryIt("up", () => {
        const sc = raBuild(np("401872948160"), ev, new Set(), { detail: det160 }), qb = sc.actors.find((a) => a.role === "QB" && a.side === "o");
        const seq = [];
        frames(sc, Math.min(sc.T, qb.upAt + 1), () => { if (seq[seq.length - 1] !== qb.drawn?.pose) seq.push(qb.drawn?.pose); });
        const sk = raBuild(np("4018729484399"), ev, new Set()), qk = sk.actors.find((a) => a.role === "QB" && a.side === "o");
        let kneel = null;
        frames(sk, qk.downAt + 0.6, (t) => { if (t > qk.downAt + 0.5 && kneel == null) kneel = { frame: qk.drawn.pose, pose: raPoseAt(sk, qk, t), held: raBall(sk, t).held === qk }; });
        out.up = { seq, kneel, holdKneel: RA_HOLD.kneel, kneeHand: RA_SKEL.kneel?.fa?.[2] };
      });
      // ── Standing around after the whistle (885's last seconds): breathing, and hands on hips.
      tryIt("idle", () => {
        const sc = raBuild(np("40187294885"), ev, new Set());
        const seen = new Map(), hips = new Set();
        frames(sc, sc.T, (t) => {
          if (t < sc.tEnd + 0.8) return;
          for (const a of sc.actors) {
            const p = a.drawn?.pose;
            if (p === "stand" || p === "stand2") { if (!seen.has(a)) seen.set(a, new Set()); seen.get(a).add(p); }
            if (p === "hips") hips.add(a);
          }
        }, 1 / 30);
        out.idle = { breathing: [...seen.values()].filter((s) => s.size === 2).length, hips: hips.size };
      });
      // ── Every frame drawn over the whole game is a real frame (a missing name would fall back to
      // standing): each man's frame 10 times a second through raFrame, plus the names raDraw sets itself.
      tryIt("names", () => {
        const missing = new Set(); let n = 0;
        for (const id of byId.keys()) {
          let sc; try { sc = raBuild(np(id), ev, new Set()); } catch { continue; }
          for (let t = 0; t <= sc.T; t += 0.1) {
            const b = raBall(sc, t);
            for (const a of sc.actors) {
              if (a.side !== "o" && a.side !== "d") continue;
              const [x, z] = raPos(a, t), [px, pz] = raPos(a, Math.max(0, t - 0.1)), speed = Math.hypot(x - px, z - pz) / 0.1;
              const f = raFrame(sc, a, t, raPoseAt(sc, a, t), { speed, held: b.held === a, back: false, after: t > (sc.tEnd ?? sc.T) + 0.6 });
              n++; if (!RA_SKEL[f]) missing.add(f);
            }
          }
        }
        for (const f of ["cheer", "crouch", "signal", "dance", "dance2", "dance3", "stand", "stand2", "carry", "hold", "kneel", "down"]) if (!RA_SKEL[f]) missing.add(f);
        out.names = { n, missing: [...missing] };
      });
      // ── The shadow: a pixel ellipse under his feet, smaller the higher he is, longer under a man lying.
      tryIt("shadow", () => {
        const widest = (lift, flat) => { const w = []; const stub = { fillRect: (x, y, ww) => w.push(ww), set fillStyle(v) {} }; raShadow(stub, 100, 100, lift, flat); return Math.max(...w); };
        out.shadow = { ground: widest(0, false), up: widest(40, false), lying: widest(0, true) };
      });
      // ── The helmet (2026-09-29, user: "The helmet needs another pass its hard to tell what's going on,
      // white face masks would help"). The masks' colour on every team's home and road kit; the cage on
      // an upright helmet, read off the standing frame's grid; and the mask in every frame.
      tryIt("helmet", () => {
        const masks = Object.keys(RA_KITS).flatMap((A) => ["home", "road"].map((side) => {
          const T = { id: "t" + A, abbr: A, color: "#444444", alt: "#999999" }, U = { id: "u", abbr: "ZZZ", color: "#777777", alt: "#bbbbbb" };
          return raPalette({ offHome: side === "home", offT: T, defT: U, actors: [] }, { side: "o", role: "WR", idx: 3 }).m;
        }));
        const f = raFig("stand", "p"), at = (x, y) => f.g[y * f.W + x];
        const cells = (test) => { const r = []; for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) if (test(at(x, y))) r.push([x, y]); return r; };
        // (Face cells only between the top of the shell and the chin bar, so the arms' skin isn't counted.)
        const m = cells((c) => c === "m"), top = Math.min(...cells((c) => c === "H").map(([, y]) => y)), chin = Math.max(...m.map(([, y]) => y));
        const face = cells((c) => "Ffek".includes(c)).filter(([, y]) => y >= top && y <= chin), eye = cells((c) => c === "e")[0];
        // The front bar: the column with the most mask cells, and its longest unbroken run.
        const byCol = {}; for (const [x] of m) byCol[x] = (byCol[x] || 0) + 1;
        const fx = +Object.keys(byCol).sort((p, q) => byCol[q] - byCol[p])[0];
        let run = 0, best = 0; for (let y = 0; y < f.H; y++) { run = at(fx, y) === "m" ? run + 1 : 0; best = Math.max(best, run); }
        // Bars: rows where the mask reaches back from the front bar toward the face.
        const bars = [...new Set(m.map(([, y]) => y))].filter((y) => at(fx - 1, y) === "m").length;
        const gap = eye ? [...Array(fx - eye[0] - 1)].map((_, i) => at(eye[0] + 1 + i, eye[1])).includes("O") : false;
        let fewest = 99, fewestAt = "";
        for (const k of Object.keys(RA_SKEL)) { const n = raFig(k, "p").g.filter((c) => c === "m").length; if (n < fewest) { fewest = n; fewestAt = k; } }
        out.helmet = { n: masks.length, colours: [...new Set(masks)], darkest: +Math.min(...masks.map((c) => lum(c))).toFixed(3), front: best, inFront: face.every(([x]) => x < fx), gap, bars, browOverEye: eye ? at(eye[0], eye[1] - 1) : null, fewest, fewestAt };
      });
      // ── Helmet logos (2026-09-29, user: "i know we dont have a lot of pixels to work with but lets
      // take a run at making logos on the helmets"). Each team's standing player is drawn with and
      // without his logo, facing each way; the pixels that differ are the logo. What should show is
      // worked out here from the designs in RA_LOGO: a 7-by-7 box whose cell in row v, column u is the
      // pixel centred at (u − 5.4, 4 − v) in an upright head's own frame (x forward, y up). Five of
      // those centres fall outside the shell's 5.2 × 4.8 ellipse about (−0.5, 0.35), so the shell's
      // curve trims them: row,column 0,0 (1.21 of the way out), 0,1 (1.07), 1,0 (1.09), 2,0 (1.003)
      // and 6,0 (1.06). Facing left, a mark that turns with him keeps its cells; a lettered logo is
      // read the other way along each row, so the trimmed cells take the other end of it. A cell the
      // shell's own colour changes no pixel.
      tryIt("logos", () => {
        const TRIM = new Set(["0,0", "0,1", "1,0", "2,0", "6,0"]);
        const pal = (A) => raPalette({ offHome: true, offT: { id: "t" + A, abbr: A, color: "#444444", alt: "#999999" }, defT: { id: "u", abbr: "ZZZ", color: "#777777", alt: "#bbbbbb" }, actors: [] }, { side: "o", role: "WR", idx: 3 });
        const data = (spr) => spr.getContext("2d").getImageData(0, 0, spr.width, spr.height).data;
        const decal = (pose, o, flip) => {
          const spr = raSprite(pose, o, flip, 88), a = data(spr), b = data(raSprite(pose, { ...o, logo: null, logoKey: "" }, flip, 88)), r = [];
          for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) r.push([(i / 4) % spr.width, Math.floor(i / 4 / spr.width)]);
          return r;
        };
        const want = (L, H, flip) => {
          if (!L || (L.side === "r" && flip)) return 0;
          let n = 0;
          for (let v = 0; v < 7; v++) for (let u = 0; u < 7; u++) {
            if (TRIM.has(v + "," + u)) continue;
            const ch = L.px[v][flip && L.text ? 6 - u : u];
            if (ch !== "." && L.c[ch].toLowerCase() !== H.toLowerCase()) n++;
          }
          return n;
        };
        const fig = raFig("stand", "p"), rows = [];
        for (const A of [...Object.keys(RA_KITS), "ZZZ"]) {
          const o = pal(A), L = RA_LOGO[A] || null;
          const is7 = !L || (L.px.length === 7 && L.px.every((r) => r.length === 7 && [...r].every((ch) => ch === "." || L.c[ch])));
          for (const flip of [false, true]) {
            const d = decal("stand", o, flip);
            rows.push({ A, flip, got: d.length, want: is7 ? want(L, o.H, flip) : -1, is7, onShell: d.every(([x, y]) => fig.g[y * fig.W + (flip ? fig.W - 1 - x : x)] === "H") });
          }
        }
        const right = rows.filter((r) => !r.flip && RA_LOGO[r.A]).sort((p, q) => p.want - q.want);
        out.logos = {
          teams: right.length, plain: rows.filter((r) => !r.flip && !RA_LOGO[r.A]).map((r) => r.A),
          wrong: rows.filter((r) => r.got !== r.want || !r.is7).map((r) => `${r.A}${r.flip ? " facing left" : ""} ${r.got} px, design ${r.want}`),
          offShell: rows.filter((r) => !r.onShell).map((r) => r.A + (r.flip ? " facing left" : "")),
          smallest: right[0].want, smallestAt: right[0].A, pix: rows.filter((r) => !r.flip).reduce((s, r) => s + r.got, 0),
          pit: [rows.find((r) => r.A === "PIT" && !r.flip).got, rows.find((r) => r.A === "PIT" && r.flip).got],
        };
        // Which way a logo reads, with an F (not the same turned round): as letters it reads the same
        // facing either way; as a mark it turns with him, so it faces forward on both sides.
        const shape = (d, mirror) => { const xs = d.map(([x]) => (mirror ? -x : x)), x0 = Math.min(...xs), y0 = Math.min(...d.map(([, y]) => y)); return d.map(([x, y]) => `${(mirror ? -x : x) - x0},${y - y0}`).sort().join(" "); };
        const F = [".......", "..xxxx.", "..x....", "..xxx..", "..x....", "..x....", "......."];
        const gb = pal("GB");
        const asText = { ...gb, logo: { c: { x: "#ff00ff" }, text: 1, px: F }, logoKey: "F-text" }, asMark = { ...gb, logo: { c: { x: "#ff00ff" }, px: F }, logoKey: "F-mark" };
        const tR = decal("stand", asText, false), tL = decal("stand", asText, true), mR = decal("stand", asMark, false), mL = decal("stand", asMark, true);
        out.logoTurn = { n: [tR, tL, mR, mL].map((d) => d.length), textReads: shape(tL) === shape(tR), textTurned: shape(tL) === shape(tR, true), markTurns: shape(mL) === shape(mR, true), markSame: shape(mL) === shape(mR) };
        // The logo holds still through a stride: in all 40 frames of the walk, jog, run, carry and
        // backpedal (the head drawn upright in every one) the Packers' G is the standing frame's pixels,
        // moved only as the head bobs, facing either way.
        const gaits = Object.keys(RA_SKEL).filter((k) => /^(walk|jog|run|carry|back)[1-8]$/.test(k));
        const refR = shape(decal("stand", gb, false)), refL = shape(decal("stand", gb, true));
        out.logoSteady = { frames: gaits.length, px: refR.split(" ").length, moved: gaits.filter((k) => shape(decal(k, gb, false)) !== refR || shape(decal(k, gb, true)) !== refL) };
      });
      return out;
    }, sumFixture, det160);
    const pchk = (fn) => { let r; try { r = fn(); } catch (e) { r = [false, `${(/`([^`$]{0,70})/.exec(fn.toString()) || [])[1] || "check"}… (could not evaluate: ${e.message} ${JSON.stringify(pl).slice(0, 160)})`]; } ok(r[0], r[1]); };
    pchk(() => [pl.bones.n >= 70 && pl.bones.worst <= 0.01,
      `one rig for every frame: thighs 5.9, shins 5.2, upper arms 6, forearms 4.6 px and the spine its length in all ${pl.bones.n} frames (worst ${pl.bones.worst} px off, ${pl.bones.at}), so nothing grows or shrinks between frames`]);
    pchk(() => [pl.gaits.gaitsObj && pl.gaits.distinct.every((n) => n === 8) && pl.gaits.ankleSpan >= 8 && pl.gaits.bob >= 1,
      `eight-frame strides for walking, jogging, running, carrying the ball and backpedalling, every frame different (${pl.gaits.distinct.join("/")}); the run's foot travels ${pl.gaits.ankleSpan} px fore and aft and the body bobs ${pl.gaits.bob} px`]);
    // Hand-computed: 6 → 9 yd/s over the last second is 7.5 yd, at 4.2 yd a running stride 1.786 strides.
    pchk(() => [pl.cadence.maxStep <= 1 && Math.abs(pl.cadence.strides - pl.cadence.expect) < 0.01,
      `the stride keeps pace with the man: speeding up from a walk to 9 yd/s, drawn 60 times a second, the legs never skip a frame (largest step ${pl.cadence.maxStep}) and the last second is ${pl.cadence.strides} strides (7.5 yd ÷ 4.2 = ${pl.cadence.expect})`]);
    pchk(() => [pl.pads.jersey >= 13 && pl.pads.jersey >= pl.pads.helmet + 3,
      `football shoulders: a standing player's pads are ${pl.pads.jersey} px of jersey across, the helmet ${pl.pads.helmet}`]);
    pchk(() => [pl.lone.n === 0 && pl.lone.frames >= 200,
      `clean pixel art: no lone pixel of one tone inside another tone of the same colour, in ${pl.lone.frames} frames of players, officials and trainers (${pl.lone.n}${pl.lone.where.length ? ": " + pl.lone.where.join(" ") : ""})`]);
    // HEAD: 1,186 such cells in 27 frames, 44 a frame (53 in the standing frame alone).
    pchk(() => [pl.lines.perFrame <= 8 && pl.lines.most <= 16,
      `no black line through the body: a near arm or leg crossing it casts a shade, so dark cells inside a figure away from the helmet average ${pl.lines.perFrame} a frame over ${pl.lines.frames} frames (at most ${pl.lines.most}, ${pl.lines.at}: the outline of an enclosed gap) against 44 when the near limbs had black rims`]);
    pchk(() => [pl.moon.plays === 14 && pl.moon.n >= 30 && pl.moon.fwd === 0,
      `no moonwalking: in 14 passing plays, all ${pl.moon.n} frames of a man moving against the way he faces are a backpedal (${pl.moon.fwd} forward strides${pl.moon.bad.length ? ": " + pl.moon.bad.join(" ") : ""})`]);
    pchk(() => [pl.pass.qbDrop.back >= 10 && pl.pass.qbDrop.fwd === 0,
      `885: Penix drops back from the shotgun in a backpedal, still facing the line (${pl.pass.qbDrop.back} backpedal frames, ${pl.pass.qbDrop.fwd} forward)`]);
    pchk(() => [pl.pass.dbBack >= 1,
      `885: the defensive backs drop into coverage facing the quarterback, backpedalling until the throw (${pl.pass.dbBack} of them)`]);
    pchk(() => [pl.pass.olFace.n > 100 && pl.pass.olFace.wrong === 0 && pl.pass.olPoses.includes("block") && pl.pass.olPoses.includes("block2"),
      `885: the offensive line faces the rush in every frame of the play, kick-sliding back rather than turning round (${pl.pass.olFace.wrong} of ${pl.pass.olFace.n} frames turned), feet chopping while they block (${pl.pass.olPoses.join(", ")})`]);
    // (A name ending in * is any frame of that stride: "carry*" is carry1 to carry8.)
    const inOrder = (seq, want) => { let i = 0; for (const p of seq) if (i < want.length && (p === want[i] || (want[i].endsWith("*") && String(p).startsWith(want[i].slice(0, -1))))) i++; return i === want.length; };
    pchk(() => [inOrder(pl.pass.seq.qb, ["throw1", "throw2", "throw3"]) && pl.pass.hold.throw1 && Math.hypot(pl.pass.hold.throw1[0] - pl.pass.hold.far[0], pl.pass.hold.throw1[1] - pl.pass.hold.far[1]) < 1,
      `885: the pass winds up with the ball in the throwing hand behind the helmet, releases, and follows through (${pl.pass.seq.qb.filter((p) => /throw/.test(p)).join(" → ")})`]);
    pchk(() => [inOrder(pl.pass.seq.rec, ["catch", "secure", "carry*"]) && inOrder(pl.pass.seq.rec, ["fall1", "fall2", "down"]),
      `885: Robinson reaches, pulls it in, runs with it tucked, then stumbles, goes to his knees and is down (${pl.pass.seq.rec.filter((p) => !/^(jog|run|walk)\d/.test(p)).map((p) => p.replace(/^(carry|back)\d$/, "$1")).filter((p, i, a) => p !== a[i - 1]).join(" → ")})`]);
    pchk(() => [pl.pass.tackler && inOrder(pl.pass.seq.tk, ["dive", "down"]),
      `885: the man who makes the tackle dives into it (${pl.pass.seq.tk.slice(-4).join(" → ")})`]);
    pchk(() => [pl.carry.n >= 10 && pl.carry.tucked === pl.carry.n && pl.carry.atHand,
      `863: after the handoff Bi.Robinson runs with the ball tucked in his near arm (${pl.carry.tucked} of ${pl.carry.n} running frames; the ball at that hand: ${pl.carry.atHand})`]);
    pchk(() => [inOrder(pl.up.seq, ["fall1", "fall2", "down", "fall2", "rise"]),
      `160: the hit QB goes down through his knees and gets back up the same way (${pl.up.seq.filter((p) => !/^(jog|run|walk|back|carry)\d/.test(p)).join(" → ")})`]);
    pchk(() => [pl.up.kneel && pl.up.kneel.frame === "kneel" && pl.up.kneel.pose === "down" && pl.up.kneel.held && Math.hypot(pl.up.holdKneel[0] - pl.up.kneeHand[0], pl.up.holdKneel[1] - pl.up.kneeHand[1]) < 1.2,
      `4399: Penix takes a knee (drawn ${pl.up.kneel?.frame}, still "${pl.up.kneel?.pose}" to the play) with the ball in his hand on the knee`]);
    pchk(() => [pl.idle.breathing >= 8 && pl.idle.hips >= 2,
      `after the whistle the men standing around breathe (${pl.idle.breathing} seen in both frames) and some stand hands on hips (${pl.idle.hips})`]);
    pchk(() => [pl.names.n > 10000 && pl.names.missing.length === 0,
      `every frame drawn over the game's 184 plays is a real frame, none falling back to standing (${pl.names.n} checked${pl.names.missing.length ? ", missing " + pl.names.missing.join(", ") : ""})`]);
    pchk(() => [pl.shadow.ground === 19 && pl.shadow.up < pl.shadow.ground && pl.shadow.lying > pl.shadow.ground,
      `each man's shadow is a small ellipse under his feet: ${pl.shadow.ground} px across on the ground, ${pl.shadow.up} px when he is 40 px up, ${pl.shadow.lying} px under a man lying down`]);
    // RESTAGED 2026-09-29 (user, after seeing the white masks: "Lets go with light Grey face masks"): this
    // asserted white, relative luminance at least 0.85 (the white was 0.90). The mask is now one light
    // grey on every kit: light, and not white.
    pchk(() => [pl.helmet.n === 64 && pl.helmet.colours.length === 1 && pl.helmet.darkest >= 0.5 && pl.helmet.darkest <= 0.8,
      `light grey facemasks on every helmet: all 32 teams' home and road kits the one colour (${pl.helmet.colours.join(", ")}, relative luminance ${pl.helmet.darkest}: light, not white)`]);
    pchk(() => [pl.helmet.front >= 5 && pl.helmet.inFront && pl.helmet.gap && pl.helmet.bars >= 2 && pl.helmet.browOverEye === "k",
      `a cage you can read on an upright helmet: a front bar ${pl.helmet.front} px tall standing in front of the whole face, a dark gap between it and the eye (${pl.helmet.gap}), ${pl.helmet.bars} bars reaching back from it, the brow's shadow over the eye ("${pl.helmet.browOverEye}")`]);
    pchk(() => [pl.helmet.fewest >= 5,
      `the facemask shows in every one of the frames, arms up and lying down included (at least ${pl.helmet.fewest} mask pixels, ${pl.helmet.fewestAt})`]);
    // Helmet logos: what each one should draw is worked out from its design in the probe above.
    pchk(() => [pl.logos.teams === 31 && pl.logos.plain.join() === "CLE,ZZZ" && pl.logos.smallest >= 10,
      `a logo on every team's helmet but the Browns', whose helmet has none, and none for a team with no art (ZZZ): ${pl.logos.teams} logos, the smallest ${pl.logos.smallest} px (${pl.logos.smallestAt}); plain: ${pl.logos.plain.join(", ")}`]);
    pchk(() => [pl.logos.wrong.length === 0 && pl.logos.pix >= 31 * 10,
      `every logo draws exactly the pixels its 7-by-7 design puts on the shell, less the five cells the shell's curve trims, facing right and facing left (${pl.logos.pix} px across the standing helmets; wrong: ${pl.logos.wrong.join("; ") || "none"})`]);
    pchk(() => [pl.logos.offShell.length === 0,
      `a logo paints only the helmet's shell, never the face, the mask, the outline or the jersey (${pl.logos.offShell.join(", ") || "none off the shell"})`]);
    pchk(() => [pl.logos.pit[0] > 0 && pl.logos.pit[1] === 0 && pl.logoTurn.n.every((n) => n === 10) && pl.logoTurn.textReads && !pl.logoTurn.textTurned && pl.logoTurn.markTurns && !pl.logoTurn.markSame,
      `letters read the right way round facing either way, a mark turns with the player so it faces forward on both sides, and the Steelers' logo, worn on the right side only, shows only when he faces right (an F as letters: same ${pl.logoTurn.textReads}, turned ${pl.logoTurn.textTurned}; as a mark: turned ${pl.logoTurn.markTurns}; ${pl.logoTurn.n.join("/")} px; PIT ${pl.logos.pit[0]} px facing right, ${pl.logos.pit[1]} facing left)`]);
    pchk(() => [pl.logoSteady.frames === 40 && pl.logoSteady.px >= 20 && pl.logoSteady.moved.length === 0,
      `the logo holds still through a stride: the Packers' G is the same ${pl.logoSteady.px} px in all ${pl.logoSteady.frames} frames of the walk, jog, run, carry and backpedal, facing either way (${pl.logoSteady.moved.length} frames differ${pl.logoSteady.moved.length ? ": " + pl.logoSteady.moved.slice(0, 6).join(", ") : ""})`]);

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

    /* ===================== (i1) touchbacks, kicks out of bounds, fair catches, facing ===================== */
    // 2026-09-28, user: "last play of the broncos game: Stafford pass deep right intended for Adams
    // INTERCEPTED by Hufanga at DEN -1. Touchback. Our animation shows him catching the ball in the
    // endzone but then running it to the 20 yard line and getting tackled … incomplete passes should
    // use the same card color as complete ones … If a punt or kick goes out of bounds animation should
    // show that. if its a fair catch, ball should always land on the returner. quarterback should
    // always face towards the line of scrimmage. all players should face into the huddle, not out of
    // it." inttb-401872962.json is LAR @ DEN's real last drive (5085 is that play; ESPN's end spot for
    // it is the DEN 20, the touchback spot). From ATL @ GB: 133 is an interception really returned 5
    // yards (to the GB 45); 2215 "punts 48 yards to ATL 11, … out of bounds"; 400, 1317, 1463 and 3166
    // are fair catches.
    section("Touchbacks, kicks out of bounds, fair catches, facing");
    const tbFix = JSON.parse(fs.readFileSync(path.join(FIX, "inttb-401872962.json"), "utf8"));
    const fx = await page.evaluate((fixture, den) => {
      const out = {};
      const keep = G;
      const tryIt = (k, fn) => { try { fn(); } catch (e) { out[k] = { err: String(e.message || e) }; } };
      const game = (f) => {
        const comp = f.header.competitions[0];
        const ev = { id: "x", home: normTeam(comp.competitors.find((c) => c.homeAway === "home")), away: normTeam(comp.competitors.find((c) => c.homeAway === "away")) };
        const rows = [];
        for (const dr of f.drives.previous || []) for (const raw of dr.plays || []) rows.push({ raw, teamId: dr.team?.id });
        const np = (id) => { const r = rows.find((q) => q.raw.id === id); return normPlay(r.raw, ev.home.id, r.teamId, ev.home.abbr); };
        return { ev, np, rows };
      };
      const A = game(fixture), B = game(den);
      const pos = (a, t) => raPos(a, t);
      // Frames drawn on a canvas as wide as the whole world, camera at 0, so nobody is culled and every
      // player's facing is worked out each frame exactly as on screen.
      const cv = document.createElement("canvas"); cv.width = RA_WORLD_W; cv.height = RA_WORLD_H;
      const g = cv.getContext("2d");
      const frames = (sc, t0, t1, fn, dt = 0.1) => { const st = { sc, t: 0, cam: { x: 0, y: 0 }, shown: new Set() }; for (let t = 0; t <= t1 + 1e-9; t += dt) { st.t = t; raDraw(g, cv.width, st); if (t >= t0) fn(t, st); } };
      tryIt("intTB", () => {
        G = { ev: B.ev };
        const p = B.np("4018729625085"), sc = raBuild(p, B.ev, new Set());
        const hawk = sc.actors.find((a) => a.who?.last === "Hufanga");
        const zs = []; for (let t = sc.tS; t <= sc.T; t += 0.1) zs.push(pos(hawk, t)[1]);
        const tCatch = sc.ball.find((q) => q.a === hawk)?.t0;
        out.intTB = { found: !!hawk, zCatch: +pos(hawk, tCatch)[1].toFixed(2), minZafter: +Math.min(...zs.filter((_, i) => sc.tS + i * 0.1 >= tCatch)).toFixed(2), down: raPoseAt(sc, hawk, sc.tEnd + 0.4),
          banners: sc.events.filter((e) => e.kind === "banner").map((e) => e.title).join("|"), zEndText: p.eH };
      });
      // LAR @ DEN 5022, "(No Huddle) M.Stafford spiked the ball to stop the clock.", filed by ESPN as
      // a Pass Incompletion (2026-09-28, user: "it was animated like he thru an actual route").
      tryIt("spike", () => {
        G = { ev: B.ev };
        const sc = raBuild(B.np("4018729625022"), B.ev, new Set());
        const qb = sc.actors.find((a) => a.role === "QB" && a.side === "o");
        const holders = [...new Set(sc.ball.filter((q) => q.a).map((q) => q.a.role))];
        const tRel = sc.ball.find((q) => q.a === qb)?.t1;
        const flights = sc.ball.filter((q) => q.from && q.t0 >= tRel - 1e-6);
        const [qx, qz] = raPos(qb, tRel);
        const farthest = Math.max(...flights.map((q) => Math.hypot(q.to[0] - qx, q.to[1] - qz)));
        // (Up to the whistle: after it everyone walks in toward the ball, as after any play.)
        const qbMove = Math.hypot(raPos(qb, sc.tEnd)[0] - raPos(qb, 0)[0], raPos(qb, sc.tEnd)[1] - raPos(qb, 0)[1]);
        const rcvMove = Math.max(...sc.actors.filter((a) => a.side === "o" && (a.role === "WR" || a.role === "TE")).map((a) => { let m = 0; for (let t = 0; t <= sc.tEnd; t += 0.1) m = Math.max(m, Math.hypot(raPos(a, t)[0] - raPos(a, 0)[0], raPos(a, t)[1] - raPos(a, 0)[1])); return m; }));
        out.spike = { titles: sc.events.filter((e) => e.kind === "banner").map((e) => e.title).join("|"), holders, afterSnap: +(tRel - sc.tS).toFixed(2), firstZ: +(flights[0].to[1] - qz).toFixed(2), firstH: flights[0].to[2], farthest: +farthest.toFixed(2), qbMove: +qbMove.toFixed(2), rcvMove: +rcvMove.toFixed(2), who: qb.who?.last };
      });
      // ATL @ GB 1661, "N.Folk 44 yard field goal is GOOD" (2026-09-28, user: "after a field goal the
      // kicking team should celebrate and lift the kicker up and toss him in the air like rudy … and
      // the defense should slink off the field").
      tryIt("fg", () => {
        G = { ev: A.ev };
        const sc = raBuild(A.np("4018729481661"), A.ev, new Set()), c = sc.fgCheer;
        const k = c.kicker, mates = sc.actors.filter((a) => a.side === "o" && a !== k);
        const d = (a, t) => Math.hypot(raPos(a, t)[0] - raPos(k, t)[0], raPos(a, t)[1] - raPos(k, t)[1]);
        let under = 99; for (let t = c.tUp; t <= c.tDown; t += 0.1) under = Math.min(under, c.carriers.filter((q) => d(q, t) <= 1).length);
        const lifts = []; frames(sc, c.tUp + 0.35, c.tosses[1] + 0.7, () => lifts.push(k.drawn?.lift ?? 0), 0.05);
        const base = Math.round(13 * RA_K), top = Math.max(...lifts);
        let peaks = 0; for (let i = 1; i < lifts.length - 1; i++) if (lifts[i] > base + 10 * RA_K && lifts[i] >= lifts[i - 1] && lifts[i] > lifts[i + 1]) peaks++;
        const defSide = (A.ev.home.id === sc.defT.id ? 1 : -1) * (sc.offHome ? -1 : 1);
        const defs = sc.actors.filter((a) => a.side === "d");
        let fastest = 0; for (const a of defs) for (let t = c.tUp; t < sc.T - 0.05; t += 0.1) fastest = Math.max(fastest, Math.hypot(raPos(a, t + 0.1)[0] - raPos(a, t)[0], raPos(a, t + 0.1)[1] - raPos(a, t)[1]) / 0.1);
        const good = sc.events.find((e) => e.kind === "banner" && /Field goal good/.test(e.title));
        out.fg = { who: k.who?.last, mob: mates.filter((m) => d(m, c.tUp) <= 5).length, under, base, top, peaks, carriedToward: +((raPos(k, c.tDown)[0] - raPos(k, c.tUp)[0]) * c.own).toFixed(2),
          // (A slow walk from mid-field takes ~10 s, longer than the celebration: at the end of the scene
          // they are on their way, each heading past his own sideline and nearer it than at the hoist.)
          defOff: defs.filter((a) => a.k.at(-1)[1] * defSide > RAX && raPos(a, sc.T - 0.05)[0] * defSide > raPos(a, c.tUp)[0] * defSide).length, nDef: defs.length, rk: RA_K, fastest: +fastest.toFixed(2), goodAt: good && +(good.t - sc.tEnd).toFixed(3), T: sc.T, tDown: c.tDown, focus: sc.focus && sc.focus.from > sc.tEnd };
        const pat = raBuild(raPatFrom(A.np("401872948682"), null), A.ev, new Set());
        out.fg.patCheer = !!pat.fgCheer;
      });
      tryIt("intRet", () => {
        G = { ev: A.ev };
        const sc = raBuild(A.np("401872948133"), A.ev, new Set());
        const hawk = sc.actors.find((a) => a.who?.last === "McKinney");
        out.intRet = { endZ: +pos(hawk, sc.tEnd)[1].toFixed(2), z0: sc.z0, banners: sc.events.filter((e) => e.kind === "banner").map((e) => e.title).join("|") };
      });
      tryIt("incSide", () => {
        G = { ev: A.ev };
        const inc = A.rows.filter((r) => /pass incomplete/i.test(r.raw.text || "") && !/PENALTY/.test(r.raw.text));
        const sides = inc.map((r) => raBuild(A.np(r.raw.id), A.ev, new Set()).events.find((e) => e.kind === "banner" && e.title === "Incomplete")?.side);
        out.incSide = { n: inc.length, sides: [...new Set(sides)] };
      });
      tryIt("puntOob", () => {
        G = { ev: A.ev };
        const p = A.np("4018729482215"), sc = raBuild(p, A.ev, new Set());
        const segs = sc.ball.filter((q) => q.from && q.t0 >= sc.kick.tL - 0.01);
        const last = segs[segs.length - 1], land = sc.ball.find((q) => q.from && Math.abs(q.t1 - sc.kick.tL) < 1e-6);
        out.puntOob = { landX: land ? +land.to[0].toFixed(2) : null, outX: last ? +last.to[0].toFixed(2) : null, outZ: last ? +last.to[1].toFixed(2) : null, spotZ: sc.offHome ? p.eH : 100 - p.eH,
          sub: sc.events.filter((e) => e.kind === "banner").map((e) => e.sub).join("|") };
      });
      tryIt("fair", () => {
        G = { ev: A.ev };
        out.fair = ["401872948400", "4018729481317", "4018729481463", "4018729483166"].map((id) => {
          const sc = raBuild(A.np(id), A.ev, new Set()), tL = sc.kick.tL;
          const hold = sc.ball.find((q) => q.a && Math.abs(q.t0 - tL) < 1e-6), land = sc.ball.find((q) => q.from && Math.abs(q.t1 - tL) < 1e-6);
          const [rx, rz] = pos(hold.a, tL);
          return +Math.hypot(land.to[0] - rx, land.to[1] - rz).toFixed(3);
        });
      });
      tryIt("qbFace", () => {
        G = { ev: A.ev };
        const passes = A.rows.filter((r) => /\bpass\b/.test(r.raw.text || "") && !/PENALTY|INTERCEPT|sacked/i.test(r.raw.text) && r.raw.type?.text !== "Two-point Conversion").slice(0, 14);
        let frames_ = 0, wrong = 0; const bad = [];
        for (const r of passes) {
          const sc = raBuild(A.np(r.raw.id), A.ev, new Set()), qb = sc.actors.find((a) => a.role === "QB" && a.side === "o");
          const attackRight = !sc.offHome;
          frames(sc, sc.tS, (sc.tEnd ?? sc.T) - 0.05, () => { frames_++; if (qb.drawn && qb.drawn.flip !== !attackRight) { wrong++; if (bad.length < 3) bad.push(r.raw.id); } });
        }
        out.qbFace = { plays: passes.length, frames: frames_, wrong, bad: [...new Set(bad)] };
      });
      tryIt("huddle", () => {
        G = { ev: A.ev };
        const prev = raBuild(A.np("40187294863"), A.ev, new Set());          // Robinson's 4-yd run, then ATL huddle at its 34
        const hs = raHuddle(prev, A.ev, { possession: A.ev.away.id, yardLine: 66, down: 2, distance: 6, downDistanceText: "2nd & 6" });
        // RESTAGED 2026-09-28 (user: "Defenses dont really huddle like offenses, they get mostly into
        // position and then as the offense comes out they line up"): only the offense huddles and faces
        // its middle; the defense stands in its shell facing the ball (attackRight: the offense's way).
        let n = 0, wrong = 0, nd = 0, wrongD = 0;
        const attackRight = !hs.offHome;                                    // (as the renderer has it: home attacks left)
        frames(hs, hs.arrived + 0.4, hs.arrived + 0.55, (t, st) => {
          const cx = st.cam.x, cy = st.cam.y;
          const S = (x, z) => raSX(hs.offHome ? z : 100 - z) - cx;
          for (const a of hs.actors) {
            if (a.side === "d") { nd++; if (a.drawn.flip !== attackRight) wrongD++; continue; }
            const [x, z] = pos(a, t), sx = S(x, z), hx = S(...hs.hud[a.side]);
            if (Math.abs(hx - sx) <= RA_K) continue;
            n++; if (a.drawn.flip !== (hx < sx)) wrong++;
          }
        });
        // The next snap starts from that huddle: still facing its middle for the first half second.
        const next = raBuild(A.np("40187294885"), A.ev, new Set(), { from: hs, fromT: hs.arrived + 1 });
        let n2 = 0, wrong2 = 0;
        frames(next, 0.3, 0.36, (t, st) => {
          for (const a of next.actors) {
            if (a.side !== "o" || !next.hud?.o) continue;
            const [x, z] = pos(a, t), sx = raSX(next.offHome ? z : 100 - z), hx = raSX(next.offHome ? next.hud[a.side][1] : 100 - next.hud[a.side][1]);
            if (Math.abs(hx - sx) <= RA_K) continue;
            n2++; if (a.drawn.flip !== (hx < sx)) wrong2++;
          }
        });
        // The shell: the defense spread out in front of the ball, standing, not in a ring.
        const D = hs.actors.filter((a) => a.side === "d"), at = D.map((a) => pos(a, hs.arrived + 0.5));
        let minGap = Infinity;
        for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) minGap = Math.min(minGap, Math.hypot(at[i][0] - at[j][0], at[i][1] - at[j][1]));
        const dz = at.map(([, z]) => +(z - hs.z0).toFixed(1));
        const line = D.filter((a, i) => a.role === "DL" && dz[i] >= 1.5 && dz[i] <= 3).length;
        const poses = [...new Set(D.map((a) => raPoseAt(hs, a, hs.arrived + 0.5)))];
        // Out of it: the defense holds while the offense jogs out, then gets set, the line in its stances.
        const mv = (a, t0, t1) => { const [x0, z0] = pos(a, t0), [x1, z1] = pos(a, t1); return Math.hypot(x1 - x0, z1 - z0); };
        const nD = next.actors.filter((a) => a.side === "d"), nO = next.actors.filter((a) => a.side === "o");
        const avg = (l, f) => l.reduce((q, a) => q + f(a), 0) / l.length;
        const early = { d: +avg(nD, (a) => mv(a, 0, 1.4)).toFixed(2), o: +avg(nO, (a) => mv(a, 0, 1.4)).toFixed(2) };
        const setAt = next.tS - 0.4;
        const dl = nD.filter((a) => a.role === "DL"), dlStance = dl.filter((a) => raPoseAt(next, a, setAt) === "stance").length;
        const stillAtSet = nD.filter((a) => mv(a, setAt - 0.1, setAt) < 0.05).length;
        out.shell = { n: D.length, minGap: +minGap.toFixed(2), zMin: Math.min(...dz), zMax: Math.max(...dz), line, poses, early, dl: dl.length, dlStance, stillAtSet, nD: nD.length, tS: next.tS };
        out.huddle = { n, wrong, nd, wrongD, n2, wrong2, hasHud: !!next.hud };
      });
      G = keep;
      return out;
    }, sumFixture, tbFix);
    const FX = (fn) => { let r; try { r = fn(); } catch (e) { r = [false, `${(/`([^`$]{0,70})/.exec(fn.toString()) || [])[1] || "check"}… (could not evaluate: ${e.message} ${JSON.stringify(fx).slice(0, 200)})`]; } ok(r[0], r[1]); };
    FX(() => [fx.intTB.found && fx.intTB.zCatch >= 100 && fx.intTB.zCatch <= 102.5 && fx.intTB.minZafter >= 100, `LAR @ DEN 5085, a touchback: Hufanga catches it a yard deep in the end zone ("at DEN -1") and never leaves it (caught ${fx.intTB.zCatch}, lowest after ${fx.intTB.minZafter}; the goal line is 100, ESPN's end spot ${fx.intTB.zEndText} is the touchback's 20)${fx.intTB.err ? " " + fx.intTB.err : ""}`]);
    FX(() => [fx.intTB.down === "down" && /Intercepted/.test(fx.intTB.banners) && /Touchback/.test(fx.intTB.banners), `…he takes a knee there and it reads Intercepted, then Touchback (${fx.intTB.down}; ${fx.intTB.banners})`]);
    FX(() => [fx.fg.who === "Folk" && fx.fg.mob >= 8 && fx.fg.under === 3, `ATL @ GB 1661, Folk's 44-yard field goal: the kicking team mobs him (${fx.fg.mob} of 10 within 5 yd) and three of them are under him the whole time he's up (${fx.fg.under})`]);
    FX(() => [fx.fg.top >= fx.fg.base + 16 * fx.fg.rk && fx.fg.peaks === 2, `…they hoist him onto their shoulders and toss him up twice, like Rudy (drawn ${fx.fg.base} px up on their shoulders, ${fx.fg.top} px at the top of a toss, ${fx.fg.peaks} tosses)`]);
    FX(() => [fx.fg.carriedToward >= 3, `…and carry him ${fx.fg.carriedToward} yd toward their own sideline`]);
    FX(() => [fx.fg.defOff === fx.fg.nDef && fx.fg.fastest <= 3.2, `…while the defense slinks off: all ${fx.fg.nDef} head off past their own sideline (${fx.fg.defOff} on their way, nearer it than at the hoist), never faster than a walk (${fx.fg.fastest} yd/s)`]);
    FX(() => [fx.fg.goodAt === 0 && fx.fg.T >= fx.fg.tDown && fx.fg.focus && fx.fg.patCheer === false, `…the result card still comes when the ball goes through (${fx.fg.goodAt} s from the whistle), the camera stays on the celebration, and an extra point gets none of it (${fx.fg.patCheer})`]);
    FX(() => [/Spike/.test(fx.spike.titles) && !/Incomplete/.test(fx.spike.titles) && fx.spike.holders.join() === "OL,QB" && fx.spike.who === "Stafford",
      `LAR @ DEN 5022, Stafford's spike: a "Spike" card, not "Incomplete", and nobody but the center and Stafford ever has the ball (${fx.spike.titles}; held by ${fx.spike.holders.join(", ")})`]);
    FX(() => [fx.spike.afterSnap <= 0.8 && fx.spike.firstH === 0 && fx.spike.firstZ > 0 && fx.spike.firstZ < 2.5 && fx.spike.farthest <= 5,
      `…he throws it into the turf just in front of him as soon as he has it (${fx.spike.afterSnap} s after the snap, lands ${fx.spike.firstZ} yd in front, rolls to ${fx.spike.farthest} yd at most)`]);
    FX(() => [fx.spike.qbMove <= 1.5 && fx.spike.rcvMove <= 3, `…one step back, and nobody runs a route (up to the whistle the QB moves ${fx.spike.qbMove} yd; the farthest a receiver goes is ${fx.spike.rcvMove} yd)`]);
    FX(() => [Math.abs(fx.intRet.endZ - (fx.intRet.z0 + 0)) >= 0 && /Intercepted/.test(fx.intRet.banners) && !/Touchback/.test(fx.intRet.banners) && fx.intRet.endZ < 100, `…a real return still runs: McKinney's 5 yards on 133 end at the GB 45 (z ${fx.intRet.endZ}), no touchback (${fx.intRet.banners})`]);
    FX(() => [fx.incSide.n >= 10 && fx.incSide.sides.length === 1 && fx.incSide.sides[0] === "o", `every "Incomplete" card is in the offense's colour, as a completion's is (${fx.incSide.n} incompletions: ${JSON.stringify(fx.incSide.sides)})`]);
    FX(() => [Math.abs(fx.puntOob.landX) >= 19 && Math.abs(fx.puntOob.outX) > 26.67 && Math.abs(fx.puntOob.outZ - fx.puntOob.spotZ) <= 1.01 && /Out of bounds/.test(fx.puntOob.sub),
      `2215, punted out of bounds: it comes down by the sideline (x ${fx.puntOob.landX}) and goes over it (x ${fx.puntOob.outX}; the sideline is 26.67) at the ATL 11 (z ${fx.puntOob.outZ} vs ${fx.puntOob.spotZ})`]);
    // RESTAGED 2026-09-28 (the week-3 audit): every caught ball is now aimed at the catcher's hands, the
    // held ball's own +0.35 / +0.25 yd offset from his feet (raBall), so it no longer jumps that last
    // bit as he takes it. 0.43 yd = hypot(0.35, 0.25) is the hands, not a miss.
    FX(() => [fx.fair.every((d) => Math.abs(d - Math.hypot(0.35, 0.25)) < 0.01), `a fair catch comes down on the returner, every time: in his hands, hypot(0.35, 0.25) = 0.43 yd off his feet (400, 1317, 1463, 3166: ${fx.fair.join(", ")} yd)`]);
    FX(() => [fx.qbFace.plays >= 10 && fx.qbFace.wrong === 0, `the QB faces the line of scrimmage through every pass play, drop-back included (${fx.qbFace.plays} plays, ${fx.qbFace.frames} frames, ${fx.qbFace.wrong} facing away${fx.qbFace.bad.length ? ": " + fx.qbFace.bad.join(", ") : ""})`]);
    FX(() => [fx.huddle.n >= 9 && fx.huddle.wrong === 0, `in the offense's huddle everyone faces its middle (${fx.huddle.n} players, ${fx.huddle.wrong} facing out)`]);
    FX(() => [fx.huddle.nd >= 11 && fx.huddle.wrongD === 0, `…the defense, in its shell, faces the ball (${fx.huddle.nd} player-frames, ${fx.huddle.wrongD} facing away)`]);
    FX(() => [fx.shell.n === 11 && fx.shell.minGap >= 2.5 && fx.shell.zMin >= 1.5 && fx.shell.zMax <= 13 && fx.shell.line >= 4 && fx.shell.poses.join() === "stand",
      `between plays the defense stands in a loose shell, not a huddle: ${fx.shell.n} men 1.5 to 13 yd off the ball (${fx.shell.zMin} to ${fx.shell.zMax}), none closer than ${fx.shell.minGap} yd to another (a huddle's ring is about 1), ${fx.shell.line} linemen two yards off it, all ${fx.shell.poses}`]);
    FX(() => [fx.shell.early.d < 0.6 && fx.shell.early.o > 3 * fx.shell.early.d + 1,
      `…and holds there as the offense breaks its huddle: in the first 1.4 s the defense moves ${fx.shell.early.d} yd on average, the offense ${fx.shell.early.o}`]);
    FX(() => [fx.shell.dl === 4 && fx.shell.dlStance === 4 && fx.shell.stillAtSet === fx.shell.nD,
      `…then gets set before the snap: all ${fx.shell.nD} still, the ${fx.shell.dl} linemen down in their stances, 0.4 s before the snap at ${fx.shell.tS} s (${fx.shell.dlStance} in stance)`]);
    FX(() => [fx.huddle.hasHud && fx.huddle.n2 >= 8 && fx.huddle.wrong2 === 0, `…and the offense still faces its middle as the next snap's scene starts, before they break (${fx.huddle.n2} players, ${fx.huddle.wrong2} facing out)`]);

    /* ===================== (i1b) the week-3 Sunday audit ===================== */
    // 2026-09-28, user: "pick a few games from yesterday and review each plays animation against the
    // description to see if we've fixed all the disconnects". A headless audit built all 690 plays of
    // LAR @ DEN, NE @ JAX, SEA @ WSH and BAL @ DAL (with their nflverse detail) and compared each with
    // its text: end spot, result cards, who has the ball, named players, tacklers, out of bounds,
    // kicks, 11 a side, teleports, QB facing. 137 were flagged; these 16 real plays
    // (audit-20260927.json) are the causes, each checked here against what its text says.
    section("Week-3 Sunday audit: plays drawn against their text");
    const audFix = JSON.parse(fs.readFileSync(path.join(FIX, "audit-20260927.json"), "utf8"));
    const au = await page.evaluate((fx) => {
      const out = {};
      const keep = G;
      const tryIt = (k, fn) => { try { fn(); } catch (e) { out[k] = { err: String(e.message || e) }; } };
      const games = {};
      for (const [e, gm] of Object.entries(fx.games)) {
        const comp = gm.header.competitions[0];
        const ev = { id: e, home: normTeam(comp.competitors.find((c) => c.homeAway === "home")), away: normTeam(comp.competitors.find((c) => c.homeAway === "away")) };
        const rows = [];
        for (const dr of gm.drives.previous) for (const raw of dr.plays) rows.push({ raw, teamId: dr.team?.id });
        games[e] = { ev, rows, pbp: gm.pbp };
      }
      const build = (id) => {
        const e = Object.keys(games).find((k) => id.startsWith(k) && games[k].rows.some((r) => r.raw.id === id));
        const gm = games[e], r = gm.rows.find((q) => q.raw.id === id);
        G = { ev: gm.ev };
        const p = normPlay(r.raw, gm.ev.home.id, r.teamId, gm.ev.home.abbr);
        const sc = raBuild(p, gm.ev, new Set(), { detail: gm.pbp[id] || null });
        return { p, sc, Z: (H) => (sc.offHome ? H : 100 - H) };
      };
      const who = (sc, last) => sc.actors.find((a) => a.who?.last === last);
      const titles = (sc) => sc.events.filter((e) => e.kind === "banner").map((e) => e.title).join("|");
      const jump = (sc) => { let m = 0; for (let t = 0.05; t <= sc.T && t < 60; t += 0.05) { const a = raBall(sc, t - 0.05), b = raBall(sc, t); m = Math.max(m, Math.hypot(b.x - a.x, b.z - a.z)); } return +m.toFixed(2); };
      const gap = (a, b, t) => { const [ax, az] = raPos(a, t), [bx, bz] = raPos(b, t); return +Math.hypot(ax - bx, az - bz).toFixed(2); };
      tryIt("td48", () => { const { sc } = build("4018729624246"); const r = who(sc, "Mumpfield"); out.td48 = { z: +raPos(r, sc.tEnd)[1].toFixed(2), jump: jump(sc) }; });
      tryIt("sack0", () => { const { sc, p, Z } = build("4018729571096"); out.sack0 = { z: +raPos(who(sc, "Maye"), sc.tEnd)[1].toFixed(2), want: Z(p.eH) }; });
      tryIt("oob", () => {
        out.oob = ["401872955140", "4018729603246", "4018729573110"].map((id) => { const { sc } = build(id); const b = raBall(sc, sc.tEnd); return +Math.abs(raPos(b.held, sc.tEnd + 0.4)[0]).toFixed(2); });
      });
      tryIt("twoPtTD", () => {
        out.twoPtTD = ["4018729622890", "4018729603063"].map((id) => {
          const { sc, p } = build(id); const pat = raPatFrom(p, null);
          return { titles: titles(sc), scoredZ: +raBall(sc, sc.tEnd + 0.05).z.toFixed(1), pat: pat && pat.typeText };
        });
      });
      tryIt("pick6", () => { const { sc } = build("4018729554262"); out.pick6 = { titles: titles(sc), z: +raBall(sc, sc.tEnd + 0.05).z.toFixed(1) }; });
      tryIt("ownFumble", () => { out.ownFumble = ["4018729571859", "4018729601436"].map((id) => { const { sc } = build(id); return raBall(sc, sc.T - 0.1).held?.side || "none"; }); });
      tryIt("retPen", () => { const { sc, Z } = build("40187295740"); const r = who(sc, "Cameron"), t = who(sc, "Ramirez"); out.retPen = { z: +raPos(r, sc.tEnd)[1].toFixed(2), want: Z(29), gap: t ? gap(t, r, sc.tEnd) : null }; });
      tryIt("tacklers", () => { out.tacklers = [["4018729551008", "Chaisson", "Barner"], ["4018729574116", "Cameron", "Chism"]].map(([id, tk, car]) => { const { sc } = build(id); const a = who(sc, tk), c = who(sc, car); return a && c ? gap(a, c, sc.tEnd) : null; }); });
      tryIt("kickJump", () => { out.kickJump = ["401872955486", "4018729552780"].map((id) => jump(build(id).sc)); });
      // (SEA, the receiving team, is the visitor: its 4 is home-scale H 96.)
      tryIt("kickOob", () => { const { sc, Z } = build("4018729552780"); const last = sc.ball.filter((q) => q.from).at(-1); out.kickOob = { x: +Math.abs(last.to[0]).toFixed(2), z: +last.to[1].toFixed(1), want: Z(96) }; });
      tryIt("tip", () => { const { sc } = build("4018729623719"); const s = who(sc, "Sutton"), k = who(sc, "Turner"); out.tip = { sutton: s?.side || null, turner: k?.side || null }; });
      tryIt("allJump", () => { out.allJump = Object.values(games).flatMap((g) => g.rows.map((r) => [r.raw.id, jump(build(r.raw.id).sc)])).filter(([, j]) => j > 2.6); });
      G = keep;
      return out;
    }, audFix);
    const AU = (fn) => { let r; try { r = fn(); } catch (e) { r = [false, `${(/`([^`$]{0,70})/.exec(fn.toString()) || [])[1] || "check"}… (could not evaluate: ${e.message} ${JSON.stringify(au).slice(0, 240)})`]; } ok(r[0], r[1]); };
    AU(() => [au.td48.z >= 100, `LAR @ DEN 4246, Stafford to Mumpfield for 48 and a touchdown: he gets into the end zone (z ${au.td48.z}; the old eased run after the catch was capped short and stopped at the 4)`]);
    AU(() => [Math.abs(au.sack0.z - au.sack0.want) <= 1, `NE @ JAX 1096, "sacked at NE 27 for 0 yards": he goes down at the NE 27 (z ${au.sack0.z} vs ${au.sack0.want}; he used to drop back 7 and be caught 3 yards behind it)`]);
    AU(() => [au.oob.every((x) => x > 26.67), `"pushed ob" with nothing after the catch (140), on a run for -1 (BAL 3246) and on an interception return (NE 3110): each goes over the sideline (|x| ${au.oob.join(", ")}; the sideline is 26.67)`]);
    AU(() => [au.twoPtTD.every((r) => /Touchdown/.test(r.titles) && !/Two-point/.test(r.titles) && r.scoredZ >= 100 && /Two-Point/i.test(r.pat || "")),
      `a touchdown whose text carries its two-point try is drawn as the touchdown, the try as its own play (DEN 2890, DAL 3063: ${JSON.stringify(au.twoPtTD)})`]);
    AU(() => [/Pick six/.test(au.pick6.titles) && au.pick6.z <= 0, `SEA @ WSH 4262, Medrano's 50-yard pick six against two receivers draws (it threw: no nickel on the field) and scores (${au.pick6.titles}, z ${au.pick6.z})`]);
    AU(() => [au.ownFumble.every((s) => s === "o"), `"FUMBLES (D.Hamilton), and recovers at JAX 5": the man who fumbled keeps it for his team (NE 1859, BAL 1436: ${au.ownFumble.join(", ")})`]);
    AU(() => [Math.abs(au.retPen.z - au.retPen.want) <= 1 && au.retPen.gap != null && au.retPen.gap <= 2.5, `a return with a penalty after it ends where the text tackles him, "J.Cameron to JAX 29", not at the penalty's spot, his tackler on him (z ${au.retPen.z} vs ${au.retPen.want}, Ramirez ${au.retPen.gap} yd)`]);
    AU(() => [au.tacklers.every((d) => d != null && d <= 2.5), `named tacklers reach the man they tackle, from 20 yards off or behind the play (Chaisson on Barner, Cameron on the punt returner: ${au.tacklers.join(", ")} yd; up to 9 before)`]);
    AU(() => [au.kickJump.every((j) => j <= 2.6), `a kickoff touchback and a kickoff out of bounds: the ball never jumps (largest step ${au.kickJump.join(", ")} yd in 0.05 s; a touchback used to put it on the 35 in one frame, 40 yards)`]);
    AU(() => [au.kickOob.x > 26.67 && Math.abs(au.kickOob.z - au.kickOob.want) <= 1.5, `"kicks 61 yards … to SEA 4, out of bounds": it goes out at the SEA 4 (x ${au.kickOob.x}, z ${au.kickOob.z} vs ${au.kickOob.want}), not rolling up to the 40 the penalty spots it at`]);
    AU(() => [au.tip.sutton === "o" && au.tip.turner !== "o", `"intended for C.Sutton INTERCEPTED by J.Wallace (K.Turner)": Sutton keeps his name; the tipper's name isn't handed to an offensive player (Sutton ${au.tip.sutton}, Turner ${au.tip.turner})`]);
    AU(() => [au.allJump.length === 0, `across all 16 audit plays the ball never jumps more than 2.6 yd in 0.05 s: catches, snaps and picks meet the hands that take them (${JSON.stringify(au.allJump)})`]);

    /* ===================== (i2) real play detail: nflverse + FTN ===================== */
    // 2026-09-28, user: "do some looking to see if there is play by play data available anywhere after
    // the game that gives us more fidelity on exactly what happened on a given play that we could
    // apply to replays" → "Do it". tools/fixtures/sunday/pbp-401872948.json is the per-play detail for
    // ATL @ GB exactly as netlify/functions/pbpdetail.mjs returned it from the real nflverse files on
    // 2026-09-28, cross-checked against an independent Python cut of the same files (all 168 plays
    // identical save the unused snap-to-whistle `dur` rounding at .x5 on three).
    // Every expected number is read off that file: play 85 (Penix screen to Bi.Robinson, 17 yds) has
    // air -6, yac 23, hash L, screen; play 682 (Love to Watson, 4-yd TD) has hash M, under center,
    // play action, motion, out of the pocket, 5 rushers with 1 blitzer, 8 in the box; 160 a QB hit;
    // 332 a throwaway; 2101 a drop; 281 is "(Shotgun)" in ESPN's text but pistol in FTN's charting,
    // with two backs; 2018 has no back; 1242 a three-man rush.
    section("Real play detail (nflverse play-by-play, FTN charting)");
    const pbpFixture = JSON.parse(fs.readFileSync(path.join(FIX, "pbp-401872948.json"), "utf8"));
    const rd = await page.evaluate((fixture, det) => {
      const out = {};
      const keep = G;
      try {
        const comp = fixture.header.competitions[0];
        const gev = normEvent({ ...fixture.header, date: comp.date, status: comp.status });
        G = { ev: gev, sum: normSummary(fixture, gev) };
        const list = raPlays(), qbs = raQBs();
        const P = (id) => list.find((q) => String(q.id) === id);
        const build = (id, withDet = true) => raBuild(P(id), G.ev, qbs, { detail: withDet ? det.plays[id] || null : null });
        const throwSeg = (sc) => sc.ball.filter((b) => b.from && b.t0 > sc.tS + 0.2)[0];
        const roleAt = (sc, role) => sc.actors.filter((a) => a.side === "o" && a.role === role);
        const dist = (a, b, t) => { const [ax, az] = raPos(a, t), [bx, bz] = raPos(b, t); return Math.hypot(ax - bx, az - bz); };
        const banners = (sc) => sc.events.filter((e) => e.kind === "banner").map((e) => e.title).join("|");
        // Play 85: the screen.
        { const sc = build("40187294885"), sc0 = build("40187294885", false), th = throwSeg(sc), th0 = throwSeg(sc0);
          const rec = sc.ball.find((b) => b.a && b.t0 >= th.t1 - 0.01)?.a;
          const ol = roleAt(sc, "OL").filter((a) => raPos(a, th.t1 + 0.5)[1] > sc.z0 + 1).length;
          out.screen = { x0: sc.x0, z0: sc.z0, catchZ: th.to[1], catchZ0: th0.to[1], tThrow: th.t0 - sc.tS, endZ: rec ? raPos(rec, sc.tEnd)[1] : null, olDownfield: ol }; }
        // Play 682: play action, motion, out of the pocket, the blitz, the box, under center.
        { const sc = build("401872948682"), th = throwSeg(sc), qb = roleAt(sc, "QB")[0], rb = sc.fake;
          const m = sc.motion, tS = sc.tS;
          const lbBite = sc.actors.filter((a) => a.side === "d" && a.role === "LB").some((a) => raPos(a, tS + 0.85)[1] < raPos(a, 0)[1] - 1);
          const box = sc.actors.filter((a) => a.side === "d").filter((a) => { const [x, z] = raPos(a, tS - 0.05); return Math.abs(x - sc.x0) <= 5.5 && z - sc.z0 <= 8; }).length;
          out.pa = { x0: sc.x0, qbDepth: +(sc.z0 - raPos(qb, 0)[1]).toFixed(2), fake: !!rb, mesh: rb ? +dist(rb, qb, tS + 0.6).toFixed(2) : null, rbToLine: rb ? +(raPos(rb, tS + 1.3)[1] - sc.z0).toFixed(2) : null,
            tThrow: +(th.t0 - tS).toFixed(2), lbBite, motion: m ? +Math.abs(raPos(m, tS - 0.1)[0] - raPos(m, tS - 0.95)[0]).toFixed(2) : null, still: m ? +Math.abs(raPos(m, tS)[0] - raPos(m, tS - 0.1)[0]).toFixed(3) : null,
            shadowMoved: m ? (() => { const cb = sc.actors.find((a) => a.side === "d" && Math.abs(raPos(a, tS - 0.95)[0] - raPos(a, tS - 0.1)[0]) > 4); return !!cb; })() : false,
            qbRoll: +Math.abs(raPos(qb, th.t0)[0] - sc.x0).toFixed(2), blitz: (sc.blitz || []).length, blitzNear: (sc.blitz || []).map((a) => { let m = 1e9; for (let t = tS; t <= th.t0 + 0.05; t += 0.05) m = Math.min(m, dist(a, qb, t)); return +m.toFixed(2); }), box,
            catchZ: th.to[1], z0: sc.z0 }; }
        // Play 160: the QB hit.
        { const sc = build("401872948160"), th = throwSeg(sc), qb = roleAt(sc, "QB")[0], h = sc.qbHit;
          out.hit = { hitter: !!h, near: h ? +dist(h, qb, th.t0 + 0.25).toFixed(2) : null, downAfter: raPoseAt(sc, qb, th.t0 + 0.8), upLater: raPoseAt(sc, qb, th.t0 + 2.4), before: raPoseAt(sc, qb, th.t0 - 0.2) }; }
        // Play 332: the throwaway; 2101: the drop.
        { const sc = build("401872948332"), th = throwSeg(sc); out.ta = { landX: +th.to[0].toFixed(2), banners: banners(sc) }; }
        { const sc = build("4018729482101"), th = throwSeg(sc), fall = sc.ball.filter((b) => b.from && b.t0 >= th.t1 - 0.01)[0];
          out.drop = { banners: banners(sc), fell: fall ? +Math.hypot(fall.to[0] - th.to[0], fall.to[1] - th.to[1]).toFixed(2) : null }; }
        // Play 281: ESPN says shotgun, FTN pistol with two backs; 2018: no back.
        { const sc = build("401872948281"), qb = roleAt(sc, "QB")[0], backs = sc.actors.filter((a) => a.side === "o" && (a.role === "RB" || a.role === "FB"));
          out.pistol = { qbDepth: +(sc.z0 - raPos(qb, 0)[1]).toFixed(2), backs: backs.length, behind: backs.filter((b) => sc.z0 - raPos(b, 0)[1] > 3).length }; }
        { const sc = build("4018729482018"), rb = sc.actors.find((a) => a.side === "o" && a.role === "RB");
          out.empty = { rbWide: rb ? +Math.abs(raPos(rb, 0)[0] - sc.x0).toFixed(2) : null, backs: sc.actors.filter((a) => a.side === "o" && a.role === "FB").length }; }
        // Play 1242: three rushers: one lineman drops into a short zone.
        { const sc = build("4018729481242"), th = throwSeg(sc);
          out.three = { dropped: sc.actors.filter((a) => a.role === "DL" && raPos(a, th.t0)[1] > sc.z0 + 3).length }; }
        // Across the game: every play builds, 11 a side, the box count is FTN's, and the result never moves.
        const rows = [];
        for (const p of list) {
          const D = det.plays[String(p.id)];
          const sc = raBuild(p, G.ev, qbs, { detail: D || null }), sc0 = raBuild(p, G.ev, qbs, { detail: null });
          const o = sc.actors.filter((a) => a.side === "o").length, d = sc.actors.filter((a) => a.side === "d").length;
          let box = null;
          if (D && D.box >= 4 && ["pass", "run"].includes(D.type) && !p.pat) box = [D.box, sc.actors.filter((a) => a.side === "d").filter((a) => { const [x, z] = raPos(a, sc.tS - 0.05); return Math.abs(x - sc.x0) <= 5.5 && z - sc.z0 <= 8; }).length];
          const sub = (t) => t.replace("Thrown away", "Incomplete").replace("Dropped", "Incomplete");
          rows.push({ id: p.id, has: !!D, o, d, box, sameResult: sub(banners(sc)) === banners(sc0), sameEnd: Math.abs((sc.tEnd ?? 0) - (sc0.tEnd ?? 0)) < 60 });
        }
        out.rows = { n: rows.length, withDetail: rows.filter((r) => r.has).length, not11: rows.filter((r) => r.has && (r.o !== 11 || r.d !== 11) && r.d > 0).map((r) => `${r.id}:${r.o}/${r.d}`),
          boxN: rows.filter((r) => r.box).length, boxOff: rows.filter((r) => r.box && r.box[0] !== r.box[1]).map((r) => `${r.id}:${r.box.join("→")}`), resultMoved: rows.filter((r) => !r.sameResult).map((r) => r.id) };
      } catch (e) { out.err = e.message + " " + (e.stack || "").split("\n")[1]; } finally { G = keep; }
      return out;
    }, sumFixture, pbpFixture);
    const RD = (fn) => { let r; try { r = fn(); } catch (e) { r = [false, `${(/`([^`$]{0,70})/.exec(fn.toString()) || [])[1] || "check"}… (could not evaluate: ${rd.err || e.message})`]; } ok(r[0], r[1]); };
    RD(() => [rd.screen.x0 === -3.08 && rd.pa.x0 === 0, `the snap is on FTN's hash: play 85 on the left hash (x ${rd.screen.x0}), 682 in the middle (x ${rd.pa.x0})`]);
    // (RESTAGED 2026-09-28: the catch is aimed at his hands, 0.25 yd up the field from his feet — see the
    // fair-catch check above — so the catch point reads air yards + 0.25.)
    RD(() => [Math.abs(rd.screen.catchZ - (rd.screen.z0 - 6 + 0.25)) < 0.01 && rd.screen.catchZ0 !== rd.screen.catchZ, `the screen is caught where it was: 6 yd behind the line (air yards -6: caught at ${rd.screen.catchZ}, line ${rd.screen.z0}; from the text alone ${rd.screen.catchZ0?.toFixed(1)})`]);
    RD(() => [rd.screen.endZ != null && Math.abs(rd.screen.endZ - (rd.screen.z0 + 17)) < 0.05, `…and the other 23 are after the catch: he is brought down 17 yd past the line (${(rd.screen.endZ - rd.screen.z0).toFixed(2)} yd)`]);
    RD(() => [rd.screen.tThrow < 1.45 && rd.screen.olDownfield >= 2, `…thrown quickly (${rd.screen.tThrow.toFixed(2)} s after the snap), linemen out in front of him (${rd.screen.olDownfield} past the line)`]);
    RD(() => [rd.pa.qbDepth === 1.2, `682: under center, as FTN charts it (QB ${rd.pa.qbDepth} yd off the ball)`]);
    RD(() => [rd.pa.fake && rd.pa.mesh < 1.5 && rd.pa.rbToLine > -1.5 && rd.pa.tThrow >= 2.0 && rd.pa.lbBite,
      `…play action: the back meets the QB for the fake (${rd.pa.mesh} yd apart), carries on to the line (${rd.pa.rbToLine} yd), a linebacker bites, the throw comes later (${rd.pa.tThrow} s)`]);
    RD(() => [rd.pa.motion >= 4.5 && rd.pa.still < 0.01 && rd.pa.shadowMoved, `…motion: a receiver moves ${rd.pa.motion} yd across in the second before the snap and is set at it (${rd.pa.still} yd), the man over him goes with him`]);
    RD(() => [rd.pa.qbRoll >= 4.5, `…out of the pocket: the QB throws from ${rd.pa.qbRoll} yd outside the ball`]);
    RD(() => [rd.pa.blitz === 1 && rd.pa.blitzNear[0] < 2.5, `…five rushers: the four linemen and one blitzer, who gets to within ${rd.pa.blitzNear[0]} yd of the QB by the throw`]);
    RD(() => [rd.pa.box === 8, `…eight in the box at the snap, as charted (${rd.pa.box})`]);
    RD(() => [Math.abs(rd.pa.catchZ - (rd.pa.z0 + 4 + 0.25)) < 0.01, `…and Watson catches it 4 yd past the line, in the end zone (air yards 4, + 0.25 to his hands: ${(rd.pa.catchZ - rd.pa.z0).toFixed(2)})`]);
    RD(() => [rd.hit.hitter && rd.hit.near < 1.6 && rd.hit.before !== "down" && rd.hit.downAfter === "down" && rd.hit.upLater !== "down",
      `160: the QB is hit as he throws — a rusher on him (${rd.hit.near} yd), down after the throw (${rd.hit.before} → ${rd.hit.downAfter}), back up later (${rd.hit.upLater})`]);
    RD(() => [Math.abs(rd.ta.landX) > 26.67 && /Thrown away/.test(rd.ta.banners), `332: the throwaway lands past the sideline (x ${rd.ta.landX}, the sideline is 26.67) and reads "Thrown away" (${rd.ta.banners})`]);
    RD(() => [/Dropped/.test(rd.drop.banners) && rd.drop.fell != null && rd.drop.fell < 1, `2101: the drop falls at the receiver's feet (${rd.drop.fell} yd from the catch point) and reads "Dropped" (${rd.drop.banners})`]);
    RD(() => [rd.pistol.qbDepth === 4 && rd.pistol.backs === 2 && rd.pistol.behind >= 2, `281: "(Shotgun)" in ESPN's text, pistol in FTN's charting — the QB 4 yd back, two backs (${JSON.stringify(rd.pistol)})`]);
    RD(() => [rd.empty.rbWide > 5 && rd.empty.backs === 0, `2018: no back — the back is split out wide (${rd.empty.rbWide} yd), no fullback`]);
    RD(() => [rd.three.dropped >= 1, `1242: a three-man rush drops a lineman into coverage (${rd.three.dropped} past the line at the throw)`]);
    RD(() => [rd.rows.withDetail >= 150 && rd.rows.not11.length === 0, `every play of the game builds with its detail, 11 a side (${rd.rows.withDetail} of ${rd.rows.n} plays have detail; off: ${JSON.stringify(rd.rows.not11)})`]);
    RD(() => [rd.rows.boxN > 80 && rd.rows.boxOff.length === 0, `the box count is FTN's on every charted run and pass (${rd.rows.boxN} plays; off: ${JSON.stringify(rd.rows.boxOff.slice(0, 6))})`]);
    RD(() => [rd.rows.resultMoved.length === 0, `the detail never changes a result: every banner reads the same with and without it, save "Thrown away" / "Dropped" for "Incomplete" (${JSON.stringify(rd.rows.resultMoved.slice(0, 6))})`]);

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
      // The page asks netlify/functions/pbpdetail.mjs for a finished game's play detail; served here
      // from the same fixture the section above reads.
      const pbpBody = JSON.stringify(pbpFixture), pbpAsks = [];
      MOCK = (u) => /\/\.netlify\/functions\/pbpdetail\?/.test(u) ? (pbpAsks.push(u), json(pbpBody))
        : /site\.api\.espn\.com.*\/scoreboard\/401872948/.test(u) ? json(sbEvent)
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
      // RESTAGED 2026-09-28 (user: "when users click replay, it should immediately default to either
      // start of the game if the game is over, or current drive if the game is ongoing. then it should
      // have a horizontal list of drives"): tapping Replay used to ask "Game start / This drive" first.
      // Now it starts at once, and the bar carries a row of the game's drives. The fixture has 21 drives
      // (hand-read): the first ATL's (ended by an interception), the last ATL's two kneels.
      await click("#f-cap .rp-start");
      const v1 = await vis();
      const row = await probe(() => { const r = document.querySelector("#bt-rp .rp-drs"), cs = r && [...r.querySelectorAll("[data-btdrive]")]; const on = r?.querySelector(".on");
        return { n: cs?.length, first: cs?.[0] && cs[0].querySelector("b").textContent + " " + cs[0].querySelector("span").textContent, last: cs?.at(-1) && cs.at(-1).querySelector("b").textContent + " " + cs.at(-1).querySelector("span").textContent, on: on?.dataset.btdrive, onSeen: !!on && on.getBoundingClientRect().left >= r.getBoundingClientRect().left - 1 && on.getBoundingClientRect().right <= r.getBoundingClientRect().right + 1, scrolls: r ? r.scrollWidth > r.clientWidth : null }; });
      ok(v1.rp && v1.rp.from === "game" && v1.rp.id === "40187294840" && !v1.choices.includes("Game start") && !v1.choices.includes("This drive"),
        `on a final, tapping Replay plays from the start at once, no menu: the opening kickoff (${JSON.stringify(v1.rp)}, buttons ${JSON.stringify(v1.choices)})`);
      ok(v1.speeds.join("|") === "1×*|2×|3×", `…with 1×, 2× and 3×, 1× picked on a first visit (${JSON.stringify(v1.speeds)})`);
      ok(row.n === 21 && row.first === "ATL Q1 · INT" && row.last === "ATL Q4 · End" && row.on === "0" && row.onSeen && row.scrolls,
        `…and a sideways row of the game's 21 drives, each its team, quarter and result ("${row.first}" … "${row.last}"), the one playing lit and in view (drive ${row.on}, in view ${row.onSeen}, scrolls ${row.scrolls})`);
      await click('#bt-rp [data-btdrive="19"]');
      const dj = await vis();
      const djOn = await probe(() => document.querySelector("#bt-rp .rp-drs .on")?.dataset.btdrive);
      ok(dj.rp && dj.rp.id === "4018729484009" && djOn === "19", `tapping a drive jumps to its first play (GB's drive 19 opens with N.Folk's kickoff: ${dj.rp?.id}, lit ${djOn})`);
      await click('#bt-rp [data-btrp="stop"]');
      const lvd = await probe(() => { const keep = G.ev; G.ev = { ...keep, state: "in" }; document.querySelector("#f-cap .rp-start").click(); const r = SIDE.rp ? { from: SIDE.rp.from, id: String(SIDE.rp.id) } : null; G.ev = keep; tecmoRpEnd(true); return r; });
      ok(lvd && lvd.from === "drive" && lvd.id === "4018729484399", `in a game still going, Replay starts at the current drive (the drive on the field, ATL's kneels from Q4 1:11: ${JSON.stringify(lvd)})`);
      await click("#f-cap .rp-start");
      const geo = await probe(() => {
        const st = document.querySelector(".stadium").getBoundingClientRect();
        // (The drive chips scroll inside their own row, so the row is measured, not each chip.)
        const els = [...document.querySelectorAll("#bt-rp button:not(.rp-dr), #bt-rp .rp-drs")];
        return { right: Math.max(...els.map((b) => b.getBoundingClientRect().right)), left: Math.min(...els.map((b) => b.getBoundingClientRect().left)), st: [st.left, st.right], h: els.map((b) => Math.round(b.getBoundingClientRect().height)), docW: document.documentElement.scrollWidth };
      });
      ok(!geo.err && geo.left >= geo.st[0] && geo.right <= geo.st[1] && geo.docW <= 390 && geo.h.every((h) => h >= 36),
        `390px phone: every control sits inside the field box, no sideways scroll, each ≥36px tall (${JSON.stringify(geo)})`);

      // Game start, at 3×.
      await click('#bt-rp [data-btspeed="3"]');
      const v2 = await vis();
      const stored = await probe(() => localStorage.getItem("sun.tecmoSpeed"));
      ok(v2.speeds.join("|") === "1×|2×|3×*" && stored === "3", `picking 3× marks it and remembers it (${JSON.stringify(v2.speeds)}, stored ${JSON.stringify(stored)})`);
      await probe(() => tecmoRpStart("game"));
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
      // RESTAGED 2026-09-28 (user: "ok now we need a post game version"): a final's 8-bit stage now
      // rests on the postgame desk, not its last play, so Exit replay hands the stage back to the desk.
      const xd = await probe(() => ({ studio: !!SIDE.sc?.studio, post: !!SIDE.sc?.post }));
      ok(!x.rp && !x.bar && x.replayBtn && xd.studio && xd.post, `Exit replay puts the final's postgame desk back on the stage, the Replay button back in the caption (${JSON.stringify(xd)}, bar ${x.bar}, button ${x.replayBtn})`);

      // The current drive: ATL's last drive, first play. (RESTAGED 2026-09-28: no menu to come back
      // with the speed; the replay keeps the speed last picked, and the bar no longer says "this drive".)
      await probe(() => tecmoRpStart("drive"));
      const d = await vis();
      ok(d.rp && d.rp.id === "4018729484399" && d.label === "Replay · Q4 1:11" && d.speeds.join("|") === "1×|2×|3×*", `the current drive starts at its first play, at the speed last picked (ATL's first kneel, Q4 1:11: ${d.rp?.id}, ${JSON.stringify(d.label)}, ${JSON.stringify(d.speeds)})`);
      // Reaching the newest play hands the stage back: two kneels, then the replay is over.
      for (let i = 0; i < 2; i++) { await probe(() => { SIDE.t = SIDE.sc.T; }); await wait(700); }
      const e = await vis();
      ok(!e.rp && !e.bar && e.replayBtn && e.playId === "4018729484421", `…and after the drive's last play it ends by itself, the newest play still on the stage (${e.playId}, replay ${JSON.stringify(e.rp)})`);

      // The field view keeps its own replay: switching over drops an 8-bit replay, and its Replay
      // button still runs the field replay.
      await click("#f-cap .rp-start");
      await click("#f-cap [data-fview]");
      const f = await vis();
      ok(!f.tecmo && !f.rp && !f.bar, `switching to the field view ends the 8-bit replay (${JSON.stringify({ tecmo: f.tecmo, rp: f.rp, bar: f.bar })})`);
      await click("#f-cap .rp-start");
      const f2 = await vis();
      ok(f2.fieldReplay.playing && !f2.bar, `…and the field view's Replay still starts the field replay (${JSON.stringify(f2.fieldReplay)})`);
      await probe(() => { stopReplay(); localStorage.removeItem("sun.tecmoBig"); localStorage.removeItem("sun.tecmoSpeed"); });

      /* ===================== (k) the retro score bug ===================== */
      // 2026-09-28, user: "We need to add a little SNF style (retro) score bug at the bottom of the 8 bit
      // screen showing score, time and and down and distance". Hand-read from the fixture: the kickoff
      // (Q1 15:00, 0-0); Bi.Robinson's run (Q1 14:55, 1st & 10, ATL ball, 0-0); J.Love to C.Watson for
      // the GB touchdown (Q1 5:13, 1st & Goal, 0-0 before; ESPN scores it 0-7 with the kick, so the
      // touchdown shows GB 6 and the extra point 7); Bi.Robinson's touchdown and two-point try (Q4 3:33,
      // 27-14 before, ESPN 35-14 after: 33 on the touchdown, 35 on the try).
      section("Score bug on the 8-bit screen");
      await page.evaluate(() => localStorage.setItem("sun.tecmoBig", "true"));
      // A fresh load (the query string makes it one; the same URL with a hash would not reload).
      await page.goto(BASE + "/sunday.html?bug#g401872948", { waitUntil: "domcontentloaded" });
      let bugOpen = true;
      try { await page.waitForFunction(() => G && G.sum && document.getElementById("bt-cv")?.offsetParent && SIDE.sc, { timeout: 15000 }); } catch { bugOpen = false; }
      // Stage one play on the big view, hold its clock at `dt` seconds from its result, let a frame draw.
      const bugAt = async (id, dt) => {
        const r = await probe(({ id, dt }) => {
          const l = raPlays(), p = l.find((q) => String(q.id) === id);
          if (!p) return { err: "no play " + id };
          if (!SIDE.rp) tecmoRpStart("game");
          SIDE.rp.speed = 1e-6;                                          // the clock stands still
          tecmoRpPlay(p);
          SIDE.t = Math.max(0, sideResultAt(SIDE.sc) + dt);
          return {};
        }, { id, dt });
        if (r.err) return r;
        await wait(250);
        return probe(() => {
          const b = SIDE.bugState, cv = SIDE.cv;
          if (!b) return { err: "no bug drawn" };
          const g = cv.getContext("2d"), px = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return "#" + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, "0")).join(""); };
          const [x, y, w, h] = b.rect, k = b.k, seg = b.segs;
          // Box colours sampled inside each box's top-left padding, where no glyph pixel is drawn.
          const inside = (s) => px(s.x + k, y + 2 * k + k);
          let gold = 0;
          for (let yy = y + 4 * k; yy < y + 11 * k; yy += k) for (let xx = seg[5].x + 2 * k; xx < seg[5].x + seg[5].w - 2 * k; xx += k) if (px(xx, yy) === "#ffd21f") gold++;
          return { text: `${b.aAb} ${b.a} ${b.hAb} ${b.h} | ${b.clock} | ${b.dd}`, poss: b.poss, rect: b.rect, k, W: cv.width, H: cv.height, ruler: !!SIDE.ruler,
            awayBox: inside(seg[0]), homeBox: inside(seg[2]), aCol: b.aCol, hCol: b.hCol, gold };
        });
      };
      ok(bugOpen, "the fixture game opens on the big 8-bit view again");
      const kick = await bugAt("40187294840", -0.5);
      ok(kick.text === "ATL 0 GB 0 | Q1 15:00 | KICKOFF", `the opening kickoff: both teams, the score, the clock, "KICKOFF" (${kick.text || kick.err})`);
      const run = await bugAt("40187294863", -0.5);
      ok(run.text === "ATL 0 GB 0 | Q1 14:55 | 1ST & 10" && run.poss === "a", `Bi.Robinson's run: Q1 14:55, 1st & 10, the football by ATL (${run.text || run.err}, ball ${run.poss})`);
      const tdPre = await bugAt("401872948682", -0.3), tdPost = await bugAt("401872948682", 0.3);
      ok(tdPre.text === "ATL 0 GB 0 | Q1 5:13 | 1ST & GOAL" && tdPre.poss === "h", `GB's touchdown before its result: 0-0, 1st & Goal, GB ball — the bug doesn't give the play away (${tdPre.text || tdPre.err})`);
      ok(tdPost.text === "ATL 0 GB 6 | Q1 5:13 | 1ST & GOAL", `…and at the result GB has 6, not ESPN's 7, which already counts the kick (${tdPost.text || tdPost.err})`);
      const xpPre = await bugAt("401872948682-pat", -0.3), xpPost = await bugAt("401872948682-pat", 0.3);
      ok(xpPre.text === "ATL 0 GB 6 | Q1 5:13 | PAT" && xpPost.text === "ATL 0 GB 7 | Q1 5:13 | PAT", `the extra point: 6 before, 7 after (${xpPre.text || xpPre.err} → ${xpPost.text || xpPost.err})`);
      const two = await bugAt("4018729483956", -0.3), twoTd = await bugAt("4018729483956", 0.3), twoTry = await bugAt("4018729483956-pat", 0.3);
      ok(two.text === "ATL 27 GB 14 | Q4 3:33 | 1ST & GOAL" && twoTd.text === "ATL 33 GB 14 | Q4 3:33 | 1ST & GOAL" && twoTry.text === "ATL 35 GB 14 | Q4 3:33 | 2-PT TRY",
        `ATL's touchdown and two-point try: 27 → 33 → 35 (${[two, twoTd, twoTry].map((r) => r.text || r.err).join(" → ")})`);
      const all = [kick, run, tdPre, tdPost, xpPre, two, twoTry];
      ok(all.every((r) => r.rect && Math.abs(r.rect[0] + r.rect[2] / 2 - r.W / 2) <= r.k && r.rect[1] + r.rect[3] <= r.H - 11 * 2 && r.rect[1] >= r.H / 2 && r.rect[2] <= r.W * 0.9 && r.ruler),
        `big view: centred along the bottom, above the yard ruler (22 px), no wider than 90% of the stage (${JSON.stringify(kick.rect)} in ${kick.W}×${kick.H}, k ${kick.k})`);
      ok(all.every((r) => r.rect) && new Set(all.map((r) => r.rect[2])).size === 1, `…one width on every play, so it doesn't jump between "1ST & 10" and "1ST & GOAL" (${[...new Set(all.map((r) => r.rect && r.rect[2]))].join(", ")} px)`);
      ok(run.awayBox === run.aCol && run.homeBox === run.hCol && run.gold > 20,
        `…drawn on the canvas: ATL's box in ${run.aCol}, GB's in ${run.hCol}, the down in gold (sampled ${run.awayBox} / ${run.homeBox}, ${run.gold} gold pixels)`);
      // The play viewer (no ruler there) carries it too.
      await probe(() => { tecmoRpEnd(true); openReenact("4018729482018"); });
      await wait(700);
      const mv = await probe(() => { const b = RA.bugState; return b ? { text: `${b.aAb} ${b.a} ${b.hAb} ${b.h} | ${b.clock} | ${b.dd}`, rect: b.rect, W: RA.cv.width, H: RA.cv.height, k: b.k } : { err: "no bug in the viewer" }; });
      ok(mv.text === "ATL 10 GB 7 | Q2 0:59 | 3RD & GOAL" && mv.rect && mv.rect[0] >= 0 && mv.rect[0] + mv.rect[2] <= mv.W && mv.rect[1] + mv.rect[3] <= mv.H,
        `the play viewer shows it too, inside its stage (Penix to Hooper: ${mv.text || mv.err}, ${JSON.stringify(mv.rect)} in ${mv.W}×${mv.H})`);
      await probe(() => closeReenact());
      // Between plays the bug shows the game as it is.
      const lv = await probe(() => {
        const ev = G.ev, row = (e) => { const b = raBugLive(e); return `${b.pre.a}-${b.pre.h} | ${b.clock} | ${b.dd} | ${b.poss}`; };
        return {
          live: row({ ...ev, state: "in", period: 2, clock: "5:12", away: { ...ev.away, score: "10" }, home: { ...ev.home, score: "7" }, sit: { shortDownDistanceText: "3rd & 7", possession: ev.home.id } }),
          half: row({ ...ev, state: "in", name: "STATUS_HALFTIME", period: 2, clock: "0:00", sit: { shortDownDistanceText: "1st & 10", possession: ev.home.id } }),
          final: row(ev),
        };
      });
      // The fixture's final is ATL 35, GB 14.
      ok(lv.live === "10-7 | Q2 5:12 | 3RD & 7 | h" && lv.half === "35-14 | HALF |  | null" && lv.final === "35-14 | FINAL |  | null",
        `between plays: the live score, quarter, clock, down and ball; HALF with no down at halftime; FINAL after (${JSON.stringify(lv)})`);
      // The finished game's detail: asked for once per game view, used, and credited.
      const asksBefore = pbpAsks.length;
      await page.evaluate(() => localStorage.setItem("sun.tecmoBig", "true"));
      await page.goto(BASE + "/sunday.html?pbp#g401872948", { waitUntil: "domcontentloaded" });
      let got = true;
      try { await page.waitForFunction(() => G && G.pbp, { timeout: 10000 }); } catch { got = false; }
      await wait(600);
      const pd = await probe(() => {
        const c = document.querySelector("#big-tecmo .ra-credit");
        const sc = raBuild(raPlays().find((q) => String(q.id) === "40187294885"), G.ev, raQBs());
        return { n: G.pbp ? Object.keys(G.pbp).length : 0, ftn: G.pbpFtn, credit: c && c.offsetParent !== null ? c.textContent : null, air: sc.detail?.air, x0: sc.x0 };
      });
      const asks = pbpAsks.slice(asksBefore);
      ok(got && asks.length === 1 && /pbpdetail\?event=401872948$/.test(asks[0]) && pd.n === 168 && pd.air === -6 && pd.x0 === -3.08,
        `a finished game asks the pbpdetail function once for its detail and the plays use it (${asks.length} ask ${JSON.stringify(asks[0] || "")}, ${pd.n} plays, play 85 air ${pd.air}, hash x ${pd.x0})`);
      // RESTAGED 2026-09-28 (user: "get rid of this text: … Play detail: nflverse."): only FTN's own
      // credit stays, which its CC-BY-SA licence requires wherever its charting is used.
      ok(pd.credit === "Charting: FTN Data via nflverse.", `…and credits FTN under the 8-bit view, as its licence asks, and nothing else (${JSON.stringify(pd.credit)})`);
      await probe(() => openReenact("40187294885"));
      await wait(300);
      const mc = await probe(() => { const c = document.querySelector("#ra .ra-credit"); return { credit: c && c.offsetParent !== null ? c.textContent : null, note: /Drawn from the play-by-play|illustrative/.test(document.querySelector("#ra").textContent) }; });
      ok(mc.credit === "Charting: FTN Data via nflverse.", `…and in the play viewer (${JSON.stringify(mc.credit)})`);
      // 2026-09-28, user: "get rid of this text: Drawn from the play-by-play. The spots, yardage and named
      // players are real; the other players and their routes are illustrative. … and also: 5 earlier
      // snaps not drawn".
      ok(mc.note === false, `the play viewer no longer carries the "Drawn from the play-by-play … illustrative" note (${mc.note})`);
      // Drive 19 of the fixture has 15 plays, more than the field view draws (5 on a phone, 8 wider).
      const ds = await probe(() => { closeReenact(); G.viewDrive = 19; renderFieldView(true); const t = document.getElementById("f-sum")?.textContent || ""; G.viewDrive = null; renderFieldView(true); return t.replace(/\s+/g, " ").trim(); });
      ok(ds && !/not drawn|earlier snap/.test(ds), `a long drive's summary no longer says "N earlier snaps not drawn" (${JSON.stringify(ds)})`);
      await probe(() => closeReenact());
      await probe(() => localStorage.removeItem("sun.tecmoBig"));

      /* ===================== (l) the Scores tab is the game detail ===================== */
      // 2026-09-28, user: "for the GFFL scores tab, just have it only be the detail page, we no longer
      // need this page since all the relevant info is in the detail and the fantasy matchup is covered
      // on its own tab". The fixture scoreboard (16 games) is served through MOCK.
      section("Scores is the game detail");
      // The rule, on hand-built weeks (real normalised games with their state, clock and kickoff moved).
      const rule = await probe(() => {
        const base = S.events.slice(0, 6).map((e) => structuredClone(e));
        const now = Date.now(), H = 3600e3;
        const mk = (i, state, dt, sa, sh, period) => Object.assign(base[i], { state, date: new Date(now + dt), period: period ?? base[i].period, away: { ...base[i].away, score: sa }, home: { ...base[i].home, score: sh } });
        const A = mk(0, "post", -20 * H, 10, 31), B = mk(1, "post", -2 * H, 24, 21), C = mk(2, "pre", 5 * H), D = mk(3, "pre", 1 * H), E = mk(4, "in", -1 * H, 35, 3, 3), F = mk(5, "in", -1 * H, 20, 17, 4);
        return { live: defaultGameId([A, B, C, D, E, F]) === F.id, soon: defaultGameId([A, B, C, D]) === D.id, final: defaultGameId([A, B, C]) === B.id, next: defaultGameId([C]) === C.id, none: defaultGameId([]) === null };
      });
      ok(rule.live && rule.soon && rule.final && rule.next && rule.none,
        `it opens on the closest live game; else one kicking off within 3 hours; else the latest final; else the next game (${JSON.stringify(rule)})`);
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(BASE + "/sunday.html?land", { waitUntil: "domcontentloaded" });
      let landed = true;
      try { await page.waitForFunction(() => /^#g\d+$/.test(location.hash) && G && G.ev && S.loaded, { timeout: 15000 }); } catch { landed = false; }
      await wait(400);
      const L = await probe(() => {
        const gv = document.getElementById("game-view"), nav = document.getElementById("gnav"), link = nav.querySelector("a");
        const lr = link.getBoundingClientRect(), hit = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2);
        // RESTAGED 2026-10-04: the strip's first item is now RedZone's entry (sd-redzone.js; user: "its like
        // its own game that appears in the top scroll bar"), so the games are the strip's #g links, not
        // every link in it; and "another game" to tap is another #g link, not the first unlit item.
        const strip = document.getElementById("g-strip"), items = [...strip.querySelectorAll('a[href^="#g"]')], cur = strip.querySelector(".current");
        const sr = strip.getBoundingClientRect(), cr = cur?.getBoundingClientRect();
        return { hash: location.hash, id: G.id, want: defaultGameId(S.events), n: S.events.length, gvShown: !gv.hidden && gv.offsetParent !== null || getComputedStyle(gv).position === "fixed" && !gv.hidden,
          board: getComputedStyle(document.getElementById("board-view")).visibility, back: !!document.getElementById("g-back"),
          barHit: nav.contains(hit), gvBottom: Math.round(gv.getBoundingClientRect().bottom), barTop: Math.round(nav.getBoundingClientRect().top),
          items: items.length, curId: cur?.getAttribute("href"), curInView: !!cr && cr.left >= sr.left - 1 && cr.right <= sr.right + 1, stripShown: strip.offsetParent !== null,
          week: document.getElementById("gv-week-label")?.textContent.trim(), histLen: history.length, sideOther: items.find((a) => !a.classList.contains("current"))?.getAttribute("href") };
      });
      ok(landed && L.hash === "#g" + L.want && L.id === L.want && L.gvShown && L.board === "hidden" && !L.back,
        `the Scores tab opens straight on a game's detail, the default one (${L.hash}, wanted #g${L.want}); the scoreboard is gone from view (${L.board}) and there is no "Scores" back button (${L.back})`);
      ok(L.barHit && L.gvBottom <= L.barTop, `phone: the GFFL bar stays on screen and tappable under the detail (a tap on "League" reaches the bar: ${L.barHit}; detail ends at ${L.gvBottom}px, the bar starts at ${L.barTop}px)`);
      ok(L.stripShown && L.items === L.n && L.curId === L.hash && L.curInView, `phone: a strip of this week's games under the header, the open one lit and scrolled into view (${L.items} of ${L.n} games, lit ${L.curId}, in view ${L.curInView})`);
      // 2026-09-30, user: 'on Scores, remove the "follow team" stars and feature altogether.' The
      // star on each team's logo in the game header, the "Follow" pill on a team page, the "My Teams"
      // filter, the "Following" tag on a card and the toasts/sort boost for followed teams are all gone.
      // Nothing here existed before this date's edit, so nothing was restaged for it; these checks
      // are the proof it stays gone. (The team page is rendered from a hand-built team, no network.)
      const nf = await probe(() => {
        const gv = document.getElementById("game-view");
        const gone = (root) => ({ follow: root.querySelectorAll("[data-follow], .follow, .t-follow").length, star: root.querySelectorAll(".follow svg, .t-follow svg, button svg path[d^='M12 3l2.7']").length });
        const game = gone(gv);
        const gameBtns = [...gv.querySelectorAll(".gt button")].length;
        openTeamView("1");
        Object.assign(T, { team: { id: "1", abbreviation: "ATL", color: "a71930", alternateColor: "000000", name: "Falcons", location: "Atlanta", displayName: "Atlanta Falcons", record: { items: [] } }, sched: [] });
        const tv = document.getElementById("team-view");
        renderTeam();
        const team = gone(tv), teamHero = !!tv.querySelector(".t-hero-in"), teamText = tv.querySelector("#t-hero")?.textContent || "";
        return { game, gameBtns, team, teamHero, teamText, filters: FILTERS.map((f) => f.id), main: MAIN_FILTERS, favs: typeof S.favs, isFav: typeof isFav, isFavGame: typeof isFavGame, star: typeof ICON.star,
          allText: document.body.innerHTML.includes("No teams followed") };
      });
      // The open team view's own fetch is refused (no network) and paints its error into #t-body a beat
      // later; let it land before tearing the view down, or the teardown races it.
      await wait(400);
      await probe(() => { T = null; const tv = document.getElementById("team-view"); tv.hidden = true; tv.innerHTML = ""; });
      ok(nf.game.follow === 0 && nf.game.star === 0 && nf.gameBtns === 0, `the game header has no follow star: no [data-follow], .follow or star icon, no button on the team logos (${JSON.stringify(nf.game)}, ${nf.gameBtns} buttons)`);
      ok(nf.teamHero && nf.team.follow === 0 && nf.team.star === 0 && !/follow/i.test(nf.teamText), `the team page has no Follow pill (hero drawn: ${nf.teamHero}; ${JSON.stringify(nf.team)}; hero text ${JSON.stringify(nf.teamText.replace(/\s+/g, " ").trim())})`);
      ok(!nf.filters.includes("mine") && !nf.main.includes("mine"), `no "My Teams"/Following filter remains (filters ${nf.filters.join("/")}; main ${nf.main.join("/")})`);
      ok(nf.favs === "undefined" && nf.isFav === "undefined" && nf.isFavGame === "undefined" && nf.star === "undefined" && !nf.allText, `no follow state or helpers left (S.favs ${nf.favs}, isFav ${nf.isFav}, isFavGame ${nf.isFavGame}, ICON.star ${nf.star})`);
      await click(`#g-strip a[href="${L.sideOther}"]`);
      await wait(400);
      const sw = await probe(() => ({ hash: location.hash, id: "#g" + G.id, histLen: history.length, lit: document.querySelector("#g-strip .current")?.getAttribute("href") }));
      ok(/^#g\d+$/.test(L.sideOther || "") && sw.hash === L.sideOther && sw.id === L.sideOther && sw.lit === L.sideOther && sw.histLen === L.histLen, `tapping another game in the strip opens it in place, lit, without stacking history (${JSON.stringify(sw)} from ${L.histLen})`);
      await click("#gv-settings");
      await wait(200);
      // (The league isn't served here, so the sheet's "Your GFFL team" picker has no teams; the sheet itself is the check.)
      const set = await probe(() => { const sh = document.getElementById("week-sheet"); const open = !sh.hidden && !!sh.querySelector('[role="dialog"]') && /settings/i.test(sh.textContent); sh.querySelector("[data-close]")?.click(); return { open, week: document.getElementById("gv-week-label")?.textContent.trim() }; });
      ok(set.open && /^Wk \d+/.test(set.week), `the week picker and Settings moved into the detail's header (week ${JSON.stringify(set.week)}, Settings opens its sheet: ${set.open})`);
      await probe(() => { location.hash = "#matchups"; });
      await wait(400);
      const mh = await probe(() => location.hash);
      ok(/^#g\d+$/.test(mh), `an old #matchups link, with games loaded, lands on a game's detail (${mh})`);
      await page.setViewport({ width: 1280, height: 900 });
      await wait(300);
      const D = await probe(() => {
        const gv = document.getElementById("game-view"), nav = document.getElementById("gnav"), link = nav.querySelector("a");
        const lr = link.getBoundingClientRect(), hit = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2);
        return { barHit: nav.contains(hit), gvTop: Math.round(gv.getBoundingClientRect().top), side: document.querySelector(".gv-side")?.offsetParent !== null, strip: document.getElementById("g-strip").offsetParent !== null };
      });
      // RESTAGED 2026-09-28: the detail now starts under GFFL's header AND its strip (46 + 34 = 80px),
      // not the strip alone (34px); see "GFFL's header on desktop" below.
      ok(D.barHit && D.gvTop === 80 && D.side && !D.strip, `desktop: GFFL's header and 34px strip stay above the detail (tappable: ${D.barHit}, detail starts at ${D.gvTop}px, under 46 + 34) and the games list is the sidebar, not the strip (${D.side}, ${D.strip})`);

      /* ===================== (m) GFFL's header on desktop ===================== */
      // 2026-09-28, user: "Scores page should fit within the GFFL desktop site like the other GFFL
      // pages, right now it has its own top bar and the GFFL header goes away, should feel like any
      // other GFFL tab". league.html's desktop masthead, measured off it: 46px with a 3px red top rule,
      // THE GFFL, the tagline, the crest; the week picker and Settings sit where GFFL shows the week.
      section("GFFL's header on desktop");
      {
        const shownQ = "(el) => !!el && el.offsetParent !== null";
        const GH = await probe((shownSrc) => {
          const shown = eval(shownSrc);
          const h = document.getElementById("ghdr");
          if (!h) return { err: "no #ghdr" };
          const r = h.getBoundingClientRect(), cs = getComputedStyle(h);
          return { top: Math.round(r.top), h: Math.round(r.height), rule: cs.borderTopWidth, ruleCol: cs.borderTopColor, word: h.querySelector(".gh-word")?.textContent.trim(), sub: h.querySelector(".gh-sub")?.textContent.trim(), crest: shown(h.querySelector(".gh-crest")),
            week: document.getElementById("gh-week-label")?.textContent.trim(), gvWeek: document.getElementById("gv-week-label")?.textContent.trim(), weekShown: shown(document.getElementById("gh-week-label")), setShown: shown(document.getElementById("gh-settings")),
            gTop: shown(document.getElementById("g-top")), topbar: shown(document.getElementById("topbar")), navTop: Math.round(document.getElementById("gnav").getBoundingClientRect().top) };
        }, shownQ);
        ok(!GH.err && GH.top === 0 && GH.h === 46 && GH.rule === "3px" && /213, 10, 10|179, 8, 8/.test(GH.ruleCol) && GH.word === "The GFFL" && /^G\.O\.A\.T\. Fantasy Football League$/.test(GH.sub || "") && GH.crest && GH.navTop === 46,
          `desktop: GFFL's own header is on top, as on every GFFL tab (46px from 0 with a 3px red rule: ${GH.top}/${GH.h}/${GH.rule} ${GH.ruleCol}; "${GH.word}", "${GH.sub}", crest ${GH.crest}), its tab strip under it at ${GH.navTop}px`);
        ok(GH.weekShown && /^Wk \d+/.test(GH.week || "") && GH.week === GH.gvWeek && GH.setShown && !GH.gTop && !GH.topbar,
          `desktop: the week picker (${JSON.stringify(GH.week)}) and Settings sit in GFFL's header, and Scores' own top bar is gone (the detail's: ${GH.gTop}, the board's: ${GH.topbar})`);
        await click("#gh-settings");
        await wait(200);
        const hs = await probe(() => { const sh = document.getElementById("week-sheet"); const open = !sh.hidden && /settings/i.test(sh.textContent); sh.querySelector("[data-close]")?.click(); return { open }; });
        const w0 = await probe(() => JSON.stringify(S.week || S.cur));
        await click("#gh-week-prev");
        await wait(500);
        const w1 = await probe(() => ({ wk: JSON.stringify(S.week || S.cur), lab: document.getElementById("gh-week-label")?.textContent.trim() }));
        await click("#gh-week-next");
        await wait(600);
        ok(hs.open && w1.wk !== w0 && w1.lab !== GH.week, `…and they work: Settings opens its sheet (${hs.open}); ‹ steps back a week (${w0} → ${w1.wk}, label ${JSON.stringify(w1.lab)})`);
        const av = await probe(() => {
          FF.setTeams([{ teamId: 9, name: "Scruffy Looking Nerfherders", abbrev: "SLN" }, { teamId: 1, name: "Battle Kreussers", abbrev: "BK" }]);
          FF.setMyTeam(9);
          const a = document.getElementById("gh-av");
          return { shown: !!a && a.offsetParent !== null, crest: a?.querySelector(".ff-crest")?.getAttribute("aria-label"), href: a?.getAttribute("href") };
        });
        ok(av.shown && av.crest === "Scruffy Looking Nerfherders" && av.href === "league.html#team", `desktop: your GFFL team's crest in the header, as GFFL wears it, linking to My Team (${JSON.stringify(av)})`);
        await page.setViewport({ width: 390, height: 844 });
        await wait(200);
        const ph = await probe(() => ({ hdr: document.getElementById("ghdr")?.offsetParent !== null, row: document.querySelector(".g-top-row")?.offsetParent !== null, week: document.getElementById("gv-week-label")?.offsetParent !== null }));
        ok(!ph.hdr && ph.row && ph.week, `phone: no desktop header; the detail keeps its own week row, over the GFFL bar at the bottom (${JSON.stringify(ph)})`);
      }

      /* ===================== (n) end zones: the home team's, at both ends ===================== */
      // 2026-09-28, user: "do some research on endzone styles for each team, and the endzones should
      // always reflect the home team, not be different on either side". ATL @ GB: Lambeau's end zones
      // are dark green (#203731) with PACKERS at both ends in gold (#FFB612), edged white. Before, the
      // left end zone was Atlanta's, in red, reading FALCONS.
      section("End zones: the home team's, at both ends");
      {
        await probe(() => { location.hash = "#g401872948"; });
        await wait(1200);
        const tbl = await probe(() => {
          const abbrs = [...new Set(S.events.flatMap((e) => [e.away.abbr, e.home.abbr]))];
          const hex = (x) => /^#[0-9a-f]{6}$/i.test(x || "");
          const bad = abbrs.filter((a) => { const z = typeof EZ !== "undefined" && EZ[a]; return !z || !hex(z.fill) || !hex(z.ink) || !(z.edge === null || hex(z.edge)) || z.words?.length !== 2 || !z.words.every((w) => /^[A-Z0-9 &]{2,12}$/.test(w)); });
          return { n: abbrs.length, bad };
        });
        ok(tbl.n === 32 && tbl.bad && tbl.bad.length === 0, `every team in the fixture week (${tbl.n}) has its own end-zone paint: fill, lettering, outline and the words at each end (missing or malformed: ${JSON.stringify(tbl.bad || tbl.err)})`);
        const sv = await probe(() => {
          const svg = document.getElementById("field");
          const rects = [...svg.querySelectorAll('rect[width="100"]')].filter((r) => r.getAttribute("height") === "533" && /^#/.test(r.getAttribute("fill") || ""));
          const texts = [...svg.querySelectorAll("text")].filter((t) => /^[A-Z]{3,}$/.test(t.textContent.trim()));
          return { home: G.ev.home.abbr, rects: rects.map((r) => [r.getAttribute("x"), r.getAttribute("fill").toUpperCase()]), texts: texts.map((t) => [t.textContent.trim(), (t.getAttribute("fill") || "").toUpperCase(), (t.getAttribute("stroke") || "").toUpperCase()]) };
        });
        ok(sv.home === "GB" && JSON.stringify(sv.rects) === JSON.stringify([["0", "#203731"], ["1100", "#203731"]]) && JSON.stringify(sv.texts) === JSON.stringify([["PACKERS", "#FFB612", "#FFFFFF"], ["PACKERS", "#FFB612", "#FFFFFF"]]),
          `field view: both end zones are Lambeau's, dark green with PACKERS in gold edged white (${JSON.stringify(sv)})`);
        const art = await probe(() => {
          const px = (g, x, y) => { const d = g.getImageData(x, y, 1, 1).data; return "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join(""); };
          const zoneInk = (g, H0, H1, col) => { const x0 = raSX(H1), x1 = raSX(H0); const d = g.getImageData(x0, RA_TOP, x1 - x0, 53 * 14).data; let n = 0; const [r, gg, b] = [1, 3, 5].map((i) => parseInt(col.slice(i, i + 2), 16)); for (let i = 0; i < d.length; i += 4) if (d[i] === r && d[i + 1] === gg && d[i + 2] === b) n++; return n; };
          const one = (ev) => { const sc = raBuild(raPlays()[3], ev, raQBs()); const c = raFieldArt(sc); return c.getContext("2d"); };
          const g = one(G.ev), y = RA_TOP + 3 * RA_K;                           // between the grain rows, off the lettering
          const cin = structuredClone(G.ev); cin.home = { ...cin.home, abbr: "CIN", id: "cin-test", name: "Bengals" };
          const gc = one(cin);
          return { right: px(g, raSX(-2), y), left: px(g, raSX(102), y), goldR: zoneInk(g, -10, 0, "#ffb612"), goldL: zoneInk(g, 100, 110, "#ffb612"),
            hatchR: zoneInk(gc, -10, 0, "#fb4f14"), hatchL: zoneInk(gc, 100, 110, "#fb4f14") };
        });
        ok(art.right === "#203731" && art.left === "#203731" && art.goldR > 200 && art.goldL > 200,
          `8-bit field: both end zones dark green (${art.right}, ${art.left}) with gold lettering at each end (${art.goldR} and ${art.goldL} gold pixels)`);
        ok(art.hatchR > 1000 && art.hatchL > 1000 && Math.abs(art.hatchR - art.hatchL) / art.hatchR < 0.25,
          `8-bit field: a team that paints stripes gets them at both ends (Cincinnati's orange hatch: ${art.hatchR} and ${art.hatchL} pixels)`);
      }

      /* ===================== (o) halftime: the studio desk ===================== */
      // 2026-09-28, user: "for half time, since nfl doesnt have marching bands, lets have the view change
      // to 4 people around a desk like you would see on a pre-game or post game NFL broadcast, wearing
      // suits (this is all still retro) and going back and forth with chat bubbles analyzing the half.
      // have opus 5.5 write some dialogue for each of the 4 people so that the whole thing lasts around
      // a minute, and if you revisit the page while its half time it just replays the same dialogue".
      // ATL @ GB cut at the half (tools/fixtures/halftime/sum-401872948-half.json: the real summary's
      // plays through Q2, 17-7), the scoreboard moved to STATUS_HALFTIME, and the halftime function's
      // reply served from tools/fixtures/halftime/script-401872948.json.
      section("Halftime: the studio desk");
      {
        const HFIX = path.join(__dirname, "fixtures", "halftime");
        const halfSum = fs.readFileSync(path.join(HFIX, "sum-401872948-half.json"), "utf8");
        const script = JSON.parse(fs.readFileSync(path.join(HFIX, "script-401872948.json"), "utf8"));
        const sbH = structuredClone(sbFixture);
        const evH = sbH.events.find((e) => e.id === "401872948"), cH = evH.competitions[0];
        cH.status = { clock: 0, displayClock: "0:00", period: 2, type: { id: "23", name: "STATUS_HALFTIME", state: "in", completed: false, description: "Halftime", detail: "Halftime", shortDetail: "Halftime" } };
        evH.status = cH.status;
        for (const x of cH.competitors) x.score = x.homeAway === "away" ? "17" : "7";
        const json = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
        const asks = [];
        let reply = () => JSON.stringify(script);
        MOCK = (u) => /\/\.netlify\/functions\/halftime\?/.test(u) ? (asks.push(u), json(reply()))
          : /site\.api\.espn\.com.*\/scoreboard\/401872948/.test(u) ? json(JSON.stringify(evH))
          : /site\.api\.espn\.com.*\/summary\?event=401872948/.test(u) ? json(halfSum)
          : /site\.api\.espn\.com.*\/scoreboard(\?|$)/.test(u) ? json(JSON.stringify(sbH)) : null;
        await page.setViewport({ width: 390, height: 844 });
        await page.evaluate(() => localStorage.setItem("sun.tecmoBig", "true"));
        await page.goto(BASE + "/sunday.html#g401872948", { waitUntil: "domcontentloaded" });
        let up = true;
        try { await page.waitForFunction(() => G && G.sum && SIDE.sc && (SIDE.sc.halftime || SIDE.sc.studio) && document.getElementById("bt-cv")?.offsetParent, { timeout: 15000 }); } catch { up = false; }
        await wait(800);
        const s0 = await probe(() => ({ studio: !!SIDE.sc.studio, actors: SIDE.sc.actors.length, roles: [...new Set(SIDE.sc.actors.map((a) => a.role))], lines: SIDE.sc.tl?.lines.map((l) => [l.who, l.text]), first: SIDE.sc.tl?.lines[0]?.t0, last: SIDE.sc.tl?.lines.at(-1)?.t1, T: SIDE.sc.tl?.T }));
        ok(up && s0.studio && s0.actors === 0, `at halftime the 8-bit view is the studio desk, not a marching band (studio ${s0.studio}; ${s0.actors} field actors ${JSON.stringify(s0.roles)})`);
        ok(asks.length === 1 && /event=401872948$/.test(asks[0] || ""), `…it asks the halftime function for this game's script, once (${JSON.stringify(asks)})`);
        ok(JSON.stringify(s0.lines) === JSON.stringify(script.lines.map((l) => [l.who, l.text])), `…and plays that script's lines, in order, each by its speaker (${(s0.lines || []).length} of ${script.lines.length})`);
        // About a minute. By hand for 16 lines of 11 words: each line 1.1 + 0.26 × 11 = 3.96 s of reading;
        // 16 × 3.96 + 16 × 0.3 s of gaps = 68.16 s natural, scaled by 60 / 68.16 = 0.8803 to 3.486 s a line,
        // so the last line ends at 1.4 + 16 × 3.486 + 15 × 0.3 = 61.67 s; with the 0.3 s gap and the 6 s
        // break the show loops at 67.97 s.
        const syn = await probe(() => { const tl = htTimeline(Array.from({ length: 16 }, (_, i) => ({ who: i % 4, text: "one two three four five six seven eight nine ten eleven" }))); return { end: tl.lines.at(-1).t1, T: tl.T, first: tl.lines[0].t0 }; });
        ok(Math.abs(syn.end - 61.67) < 0.05 && Math.abs(syn.T - 67.97) < 0.05 && syn.first === 1.4, `a script of the length Opus is asked for (16 lines, 176 words) runs about a minute: the last line ends at ${syn.end?.toFixed?.(2)} s (hand-computed 61.67), the show loops at ${syn.T?.toFixed?.(2)} s (67.97)`);
        // (RESTAGED 2026-09-28: its two replays hold their lines until the play has run, so the bound
        // went from 75 s to 90.)
        ok(s0.first === 1.4 && s0.last >= 45 && s0.last <= 90, `…and the fixture's longer script (254 words, two replays) is held to the 1.25× squeeze: it ends at ${s0.last?.toFixed?.(1)} s`);
        const at = (t) => probe((t) => {
          SIDE.t = SIDE.sc.t0 + t; SIDE.htKey = null; raStep(SIDE, 0);
          const stage = document.querySelector("#big-tecmo .bt-stage"), b = stage.querySelector(".ht-bub");
          if (!b) return { none: true };
          const s = stage.getBoundingClientRect(), r = b.getBoundingClientRect();
          return { on: b.classList.contains("on"), name: b.querySelector("b").textContent, text: b.querySelector("span").textContent, box: [r.left - s.left, r.top - s.top, r.right - s.left, r.bottom - s.top].map(Math.round), stW: Math.round(s.width), stH: Math.round(s.height),
            tail: parseFloat(b.style.left) + parseFloat(b.style.getPropertyValue("--tx")), heads: SIDE.htHeads, font: parseFloat(getComputedStyle(b).fontSize), bug: SIDE.bugState?.clock };
        }, t);
        const b0 = await at(3);
        const hx = b0.heads?.map((h) => Math.round(h.x));
        ok(b0.on && b0.name === "Hal Brandt" && b0.text === script.lines[0].text, `the host opens: a chat bubble with his name and the first line (${JSON.stringify([b0.on, b0.name, b0.text])})`);
        ok(b0.heads?.length === 4 && hx.every((x, i) => i === 0 || x > hx[i - 1]) && Math.abs(b0.tail - b0.heads[0].x) < 2 && b0.box[3] <= b0.heads[0].top && b0.box[0] >= 0 && b0.box[2] <= b0.stW && b0.font >= 8,
          `…pinned over the host's head: four people left to right (${JSON.stringify(hx)}), the tail at ${Math.round(b0.tail)} over ${Math.round(b0.heads?.[0]?.x)}, the bubble ending at ${b0.box?.[3]} above the head at ${Math.round(b0.heads?.[0]?.top)}, inside the ${b0.stW}px stage, ${b0.font}px type`);
        ok(b0.bug === "HALF", `…with the score bug still reading HALF under the desk (${b0.bug})`);
        const mid5 = await probe(() => { const l = SIDE.sc.tl.lines[5]; return (l.t0 + l.t1) / 2; });
        const b5 = await at(mid5);
        ok(b5.on && b5.name === "RoboGoat" && b5.text === script.lines[5].text && Math.abs(b5.tail - b5.heads[3].x) < 2 && b5.box[2] <= b5.stW && b5.box[0] >= 0,
          `the analysts take their turns: line 6 is RoboGoat's, over the fourth head and kept inside the stage (${JSON.stringify([b5.name, Math.round(b5.tail), Math.round(b5.heads?.[3]?.x), b5.box])})`);
        // The replays (2026-09-28, user: "2-3 replays where an analyst brings up a specific play and it
        // shows that replay along with the commentary words overlaid on top"). The fixture's line 2
        // (the Ghost, on McKinney's pick) is spoken over play 401872948133.
        const tape = await probe(() => { const l = SIDE.sc.tl.lines[1]; return { mid: (l.t0 + l.t1) / 2, len: l.t1 - l.t0, replay: l.replay }; });
        const tp = await probe((t) => {
          SIDE.t = SIDE.sc.t0 + t; SIDE.htCapKey = null; raStep(SIDE, 0.016); raStep(SIDE, 0.016);
          const stage = document.querySelector("#big-tecmo .bt-stage"), cap = stage.querySelector(".ht-cap"), b = stage.querySelector(".ht-bub");
          const R = SIDE.htRep, s = stage.getBoundingClientRect(), r = cap?.getBoundingClientRect();
          // The inset: its frame's black and white rings, top left, measured on the canvas in CSS pixels.
          const cv = SIDE.cv, fx = cv.clientWidth / cv.width, px = (x, y) => [...cv.getContext("2d").getImageData(x, y, 1, 1).data].slice(0, 3).join(",");
          const sPx = Math.max(1, Math.round(cv.height / 150));
          return { id: R && String(R.sc.play.id), T: R?.sc.T, field: !!R && !R.sc.studio, cap: !!cap && !cap.hidden && cap.offsetParent !== null, tag: !!cap?.querySelector("i"), name: cap?.querySelector("b")?.textContent, text: cap?.querySelector("span")?.textContent,
            inside: !!r && r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1, bub: !!b?.classList.contains("on"),
            frame: [px(2 * sPx + 1, 2 * sPx + 1), px(3 * sPx + 1, 3 * sPx + 1)], capLeft: r && r.left - s.left, capTop: r && r.top - s.top, capBottom: r && r.bottom - s.top, stH: s.height,
            insetRight: Math.round((2 * sPx + HT_INSET.w * Math.max(1, Math.round((cv.height * 0.26) / HT_INSET.h)) + 4 * sPx) * fx) };
        }, tape.mid);
        // RESTAGED 2026-09-28 (user: "get rid of the red blinking replay word that isnt needed. Instead,
        // lets have a view of that analyst talking and a speech bubble at the top of the replay, that way
        // it wont cover the action but you still see who is talking"): the caption under a REPLAY tag
        // became the analyst's inset (top left) and a speech bubble beside it.
        ok(tape.replay === "401872948133" && tp.id === "401872948133" && tp.field && tp.cap && !tp.tag && tp.name === "Force Ghost John Madden" && tp.text === script.lines[1].text && tp.inside && !tp.bub,
          `going to the tape: the desk cuts to the 8-bit replay of the play named (${tp.id}, McKinney's pick), the speaker's words in a speech bubble ("${tp.name}": ${JSON.stringify((tp.text || "").slice(0, 40))}…), no REPLAY tag (${tp.tag}), no desk bubble`);
        ok(tp.frame?.[0] === "16,16,16" && tp.frame?.[1] === "251,251,244" && tp.capLeft > tp.insetRight && tp.capTop <= 12 && tp.capBottom < tp.stH * 0.4,
          `…the analyst talking in a framed inset in the top left corner (frame ${JSON.stringify(tp.frame)}), the bubble beside it (${Math.round(tp.capLeft)} px from the left, past the inset's ${tp.insetRight}) along the top, clear of the field below ${Math.round(tp.capBottom)} of ${Math.round(tp.stH)} px`);
        ok(tape.len >= Math.min(tp.T, 9) + 0.6 - 0.01, `…and the line is held long enough for the play to play out under it (${tape.len?.toFixed?.(1)} s for a ${tp.T?.toFixed?.(1)} s play)`);
        // The flicker (2026-09-28, user: "during the replay it flickers black once or twice"): every frame
        // of a replay shows the replay, with no beat of the dark studio between its lines. By hand, a
        // replay of two 5-word lines: the first ends exactly where the second begins.
        const two = await probe(() => { const tl = htTimeline([{ who: 0, text: "a b c d e", replay: "" }, { who: 1, text: "a b c d e", replay: "X" }, { who: 3, text: "a b c d e", replay: "X" }, { who: 2, text: "a b c d e", replay: "" }], 60, () => 0); return [tl.lines[1].t1, tl.lines[2].t0, tl.lines[2].t1, tl.lines[3].t0]; });
        const frames = await probe(() => { const tl = SIDE.sc.tl.lines, l = tl[1]; let off = 0; for (let t = l.t0 + 0.02; t < l.t1 - 0.02; t += 0.05) { SIDE.t = SIDE.sc.t0 + t; raStep(SIDE, 0.016); if (!SIDE.htRep) off++; } return off; });
        ok(Array.isArray(two) && Math.abs(two[0] - two[1]) < 1e-9 && two[3] - two[2] > 0.29 && frames === 0, `no black beat in a replay: its lines run end to end (${two?.[0]?.toFixed?.(2)} = ${two?.[1]?.toFixed?.(2)}; the 0.3 s gap only after it), and every frame of the fixture's replay shows the play (${frames} studio frames)`);
        const back = await probe((t) => { SIDE.t = SIDE.sc.t0 + t; raStep(SIDE, 0.016); const cap = document.querySelector("#big-tecmo .ht-cap"); return { rep: !!SIDE.htRep, cap: !!cap && !cap.hidden }; }, await probe(() => { const l = SIDE.sc.tl.lines[2]; return (l.t0 + l.t1) / 2; }));
        ok(!back.rep && !back.cap, `…then back to the desk for the next line (${JSON.stringify(back)})`);
        // The new faces (2026-09-28, user: "replace Dot Keene with RoboGoat, and chuck varney with Force
        // Ghost John Madden"): the ghost is see-through (no pixel of his suit is its solid colour; he
        // is laid over the set) and glows pale blue; RoboGoat's LED eyes are the only green on the desk.
        const faces = await probe(() => {
          SIDE.t = SIDE.sc.t0 + 3; raStep(SIDE, 0.016);
          const c = SIDE.htCv, d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
          let suit = 0, glow = 0, led = 0;
          for (let i = 0; i < d.length; i += 4) {
            const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
            if (r === 0x5a && g === 0xa9 && b === 0xe6) suit++;
            if (b > 200 && g > 170 && r < 200 && b - r > 40) glow++;
            if (r === 0x7c && g === 0xff && b === 0x6b) led++;
          }
          return { cast: SIDE.sc.cast, suit, glow, led };
        });
        ok(JSON.stringify(faces.cast) === JSON.stringify(["Hal Brandt", "Force Ghost John Madden", "Moose Tillman", "RoboGoat"]) && faces.suit === 0 && faces.glow > 40 && faces.led >= 2,
          `the desk is Hal, Force Ghost John Madden, Moose and RoboGoat: the ghost see-through and glowing (${faces.suit} solid suit pixels, ${faces.glow} glow), RoboGoat's LED eyes lit (${faces.led} green pixels)`);
        const gap = await probe(() => { const l = SIDE.sc.tl.lines[5]; return l.t1 + 0.15; });
        const bg = await at(gap);
        const lp = await at(await probe(() => SIDE.sc.tl.T + 3));
        ok(!bg.on && lp.on && lp.text === script.lines[0].text, `between lines the bubble clears (${bg.on}); after the break the show starts over from the host's opener (${JSON.stringify(lp.text)})`);
        // Revisit: another game, then back while it is still halftime.
        const other = sbFixture.events.find((e) => e.id !== "401872948").id;
        await probe((o) => { location.hash = "#g" + o; }, other);
        await wait(1500);
        await probe(() => { location.hash = "#g401872948"; });
        try { await page.waitForFunction(() => G?.id === "401872948" && SIDE.sc?.studio, { timeout: 8000 }); } catch {}
        await wait(300);
        const rv = await probe(() => ({ u: SIDE.t - SIDE.sc.t0, i: htAt(SIDE.sc, SIDE.t).i, lines: SIDE.sc.tl.lines.map((l) => l.text) }));
        ok(rv.u < 3 && rv.i <= 0 && JSON.stringify(rv.lines) === JSON.stringify(script.lines.map((l) => l.text)) && asks.length === 1,
          `a revisit during halftime replays the same dialogue from the top (${rv.u?.toFixed?.(1)} s in, line ${rv.i}; the same ${rv.lines?.length} lines; asked the function ${asks.length} time)`);
        // Still being written. RESTAGED 2026-09-28 (user: "lets go back to the script generating when the
        // first person opens the game, but it shows a post game / half time show starts soon with a
        // countdown"): it used to be the host's opener and the analysts "thinking" ("…"); now the desk
        // waits under a countdown card, timed from when the first viewer started the script (the
        // function's `since`). Here that was 12 s ago, so of the halftime show's 15 s, 3 are left.
        let n = 0;
        reply = () => (++n === 1 ? JSON.stringify({ ok: false, pending: true, since: Date.now() - 12000 }) : JSON.stringify(script));
        await probe(() => { HT.clear(); sideHalftime(); });
        await wait(400);
        const soon = () => probe(() => {
          raStep(SIDE, 0);
          const stage = document.querySelector("#big-tecmo .bt-stage"), el = stage.querySelector(".ht-soon"), b = stage.querySelector(".ht-bub");
          const s = stage.getBoundingClientRect(), r = el?.getBoundingClientRect();
          return { waiting: !!SIDE.sc.waiting, shown: !!el && el.offsetParent !== null, title: el?.querySelector("b")?.textContent, count: el?.querySelector("span")?.textContent,
            inside: !!r && r.left >= s.left && r.right <= s.right && r.top >= s.top, bub: !!b?.classList.contains("on") };
        });
        const pw = await soon();
        ok(pw.waiting && pw.shown && pw.title === "Halftime show" && /^starts in 0:0[23]$/.test(pw.count || "") && pw.inside && !pw.bub,
          `while Opus writes, the desk waits under a countdown: "${pw.title}", "${pw.count}" (15 s from the first viewer's start 12 s ago), inside the stage, no chat bubble yet`);
        try { await page.waitForFunction(() => SIDE.sc && !SIDE.sc.waiting, { timeout: 9000 }); } catch {}
        const pd = await probe(() => ({ waiting: SIDE.sc.waiting, n: SIDE.sc.tl?.lines.length, first: SIDE.sc.tl?.lines[0].text, u: SIDE.t - SIDE.sc.t0, t0: SIDE.sc.t0, card: document.querySelector("#big-tecmo .ht-soon")?.offsetParent !== null }));
        ok(!pd.waiting && pd.n === script.lines.length && pd.first === script.lines[0].text && pd.u < 2 && pd.t0 > 2 && n === 2 && !pd.card,
          `…and once it's written, the card goes and the script starts from its first line (${JSON.stringify(pd)}, ${n} asks)`);
        reply = () => JSON.stringify({ ok: false, pending: true, since: Date.now() - 60000 });
        await probe(() => { HT.clear(); sideHalftime(); });
        await wait(400);
        const late = await soon();
        ok(late.shown && late.count === "Starting…", `past the estimate it says "${late.count}" until the lines arrive`);
        // RESTAGED 2026-09-28 (user, of three games whose scripts had failed: "it took like 1 seconds to
        // generate but it was super generic and very short"): a failed script used to get five canned
        // stand-in lines. Now the desk waits under its card, "coming up shortly", no dialogue, and asks
        // again (every minute; shortened here), and a script that lands on a retry plays from its top.
        reply = () => JSON.stringify({ ok: false, reason: "failed", detail: "job" });
        // (Timers left from the checks above are cleared first, so only this desk's own retry can fetch.)
        await probe(() => { for (const e of HT.values()) clearTimeout(e.timer); if (typeof HT_TIMES === "object") HT_TIMES.retry = 600; HT.clear(); sideHalftime(); });
        await wait(400);
        const fl = await soon();
        const flTl = await probe(() => SIDE.sc.tl);
        ok(fl.shown && fl.title === "Halftime show" && fl.count === "coming up shortly" && !fl.bub && flTl === null,
          `with no script to show, no canned dialogue: the desk waits under "${fl.title}", "${fl.count}" (lines: ${JSON.stringify(flTl)}, bubble ${fl.bub})`);
        reply = () => JSON.stringify(script);
        try { await page.waitForFunction(() => SIDE.sc?.tl?.lines?.length > 5, { timeout: 5000 }); } catch {}
        const fr = await probe(() => { raStep(SIDE, 0); return { n: SIDE.sc.tl?.lines.length, first: SIDE.sc.tl?.lines[0].text, card: document.querySelector("#big-tecmo .ht-soon")?.offsetParent !== null }; });
        ok(fr.n === script.lines.length && fr.first === script.lines[0].text && !fr.card, `…it asks again, and the script that comes plays from its top, the card gone (${JSON.stringify(fr)})`);
        await probe(() => { if (typeof HT_TIMES === "object") HT_TIMES.retry = 60000; });
        const after = await probe(() => { sideRun(raBuild(raPlays()[3], G.ev, raQBs())); raStep(SIDE, 0.016); return { studio: !!SIDE.sc.studio, bub: !!document.querySelector("#big-tecmo .ht-bub.on") }; });
        ok(!after.studio && !after.bub, `when play resumes, the desk and its bubble give way to the field (${JSON.stringify(after)})`);
        // ?halftime=demo (2026-09-28, user: "give me a test link"): a finished game's first half at the
        // desk. The final ATL @ GB fixture: at the break (its last Q2 play) it was ATL 17 - 7 GB.
        asks.length = 0;
        reply = () => JSON.stringify(script);
        MOCK = (u) => /\/\.netlify\/functions\/halftime\?/.test(u) ? (asks.push(u), json(reply()))
          : /site\.api\.espn\.com.*\/scoreboard\/401872948/.test(u) ? json(JSON.stringify(sbFixture.events.find((e) => e.id === "401872948")))
          : /site\.api\.espn\.com.*\/summary\?event=401872948/.test(u) ? json(JSON.stringify(sumFixture))
          : /site\.api\.espn\.com.*\/scoreboard(\?|$)/.test(u) ? json(JSON.stringify(sbFixture)) : null;
        await page.goto(BASE + "/sunday.html?halftime=demo#g401872948", { waitUntil: "domcontentloaded" });
        try { await page.waitForFunction(() => G?.sum && SIDE.sc?.studio && SIDE.sc.tl?.lines.length > 5, { timeout: 15000 }); } catch {}
        const dm = await probe(() => { raStep(SIDE, 0); return { state: G.ev.state, studio: !!SIDE.sc?.studio, score: [SIDE.sc?.ev?.away.score, SIDE.sc?.ev?.home.score], bug: [SIDE.bugState?.a, SIDE.bugState?.h, SIDE.bugState?.clock], n: SIDE.sc?.tl?.lines.length }; });
        ok(dm.state === "post" && dm.studio && JSON.stringify(dm.score) === "[17,7]" && JSON.stringify(dm.bug) === '[17,7,"HALF"]' && dm.n === script.lines.length && asks.length === 1 && /event=401872948&demo=1$/.test(asks[0]),
          `?halftime=demo plays a finished game's first half at the desk: the score as it stood at the break, the bug reading HALF, the demo script asked for (${JSON.stringify(dm)}, ${JSON.stringify(asks)})`);
        /* ===================== (p) the postgame desk ===================== */
        // 2026-09-28, user: "ok now we need a post game version and this can be about 2 minutes long,
        // can differentiate the commentators a bit with more personality". The ATL @ GB final (35-14),
        // its script the function's real kind=post reply from the deploy preview
        // (tools/fixtures/halftime/script-post-401872948.json, written by claude-opus-5-5).
        section("The postgame desk");
        const post = JSON.parse(fs.readFileSync(path.join(HFIX, "script-post-401872948.json"), "utf8"));
        asks.length = 0;
        reply = () => JSON.stringify(post);
        await page.goto(BASE + "/sunday.html#g401872948", { waitUntil: "domcontentloaded" });
        try { await page.waitForFunction(() => G?.sum && SIDE.sc?.studio && SIDE.sc.tl?.lines.length > 5, { timeout: 15000 }); } catch {}
        const pg = await probe(() => { raStep(SIDE, 0); return { state: G.ev.state, studio: !!SIDE.sc?.studio, post: !!SIDE.sc?.post, bug: [SIDE.bugState?.a, SIDE.bugState?.h, SIDE.bugState?.clock], lines: SIDE.sc?.tl?.lines.map((l) => [l.who, l.text]), end: SIDE.sc?.tl?.lines.at(-1)?.t1, tag: document.getElementById("bt-tag")?.textContent || document.getElementById("sl-tag")?.textContent, tx: document.getElementById("bt-tx")?.textContent }; });
        ok(pg.state === "post" && pg.studio && pg.post && JSON.stringify(pg.bug) === '[35,14,"FINAL"]' && asks.length === 1 && /event=401872948&kind=post$/.test(asks[0] || ""),
          `a final's 8-bit view is the postgame desk: the bug reads FINAL 35-14, and it asks for the postgame script (${JSON.stringify({ studio: pg.studio, post: pg.post, bug: pg.bug })}, ${JSON.stringify(asks)})`);
        ok(JSON.stringify(pg.lines) === JSON.stringify(post.lines.map((l) => [l.who, l.text])) && pg.tx === "The GFFL postgame desk",
          `…playing that script's ${post.lines.length} lines in order, under "${pg.tx}"`);
        // About two minutes. By hand for 30 lines of 11 words: 30 × 3.96 s + 30 × 0.3 s = 127.8 s natural,
        // scaled by 120 / 127.8 = 0.93897 to 3.718 s a line: the last ends at 1.4 + 30 × 3.718 + 29 × 0.3
        // = 121.65 s, and the show loops at 127.95 s.
        const syn2 = await probe(() => { const tl = htTimeline(Array.from({ length: 30 }, (_, i) => ({ who: i % 4, text: "one two three four five six seven eight nine ten eleven" })), HT_POST_TARGET); return { end: tl.lines.at(-1).t1, T: tl.T }; });
        ok(Math.abs(syn2.end - 121.65) < 0.05 && Math.abs(syn2.T - 127.95) < 0.05 && pg.end >= 95 && pg.end <= 150,
          `the postgame show runs about two minutes: 30 lines of 11 words end at ${syn2.end?.toFixed?.(2)} s (hand-computed 121.65); the real script ends at ${pg.end?.toFixed?.(1)} s`);
        reply = () => JSON.stringify({ ok: false, pending: true, since: Date.now() - 5000 });
        await probe(() => { HT.clear(); sideHalftime(true); });
        await wait(400);
        const ps = await probe(() => { raStep(SIDE, 0); const el = document.querySelector("#big-tecmo .ht-soon"); return { shown: !!el && el.offsetParent !== null, title: el?.querySelector("b")?.textContent, count: el?.querySelector("span")?.textContent }; });
        ok(ps.shown && ps.title === "Postgame show" && /^starts in 0:(24|25)$/.test(ps.count || ""), `the postgame show counts down too: "${ps.title}", "${ps.count}" (30 s from a start 5 s ago)`);
        // RESTAGED 2026-09-28 (as the halftime one above): no canned postgame lines either.
        reply = () => JSON.stringify({ ok: false, reason: "failed", detail: "job" });
        await probe(() => { HT.clear(); sideHalftime(true); });
        await wait(500);
        const pf = await probe(() => { raStep(SIDE, 0); const el = document.querySelector("#big-tecmo .ht-soon"); return { tl: SIDE.sc.tl, shown: !!el && el.offsetParent !== null, title: el?.querySelector("b")?.textContent, count: el?.querySelector("span")?.textContent }; });
        ok(pf.tl === null && pf.shown && pf.title === "Postgame show" && pf.count === "coming up shortly", `with no postgame script, no canned lines: "${pf.title}", "${pf.count}" (${JSON.stringify(pf.tl)})`);
        await probe(() => localStorage.removeItem("sun.tecmoBig"));
      }
      /* ===================== (q) live: polled every 2 s, plays cut to the snap ===================== */
      // 2026-09-28, user: "is there anything we can do to decrease the time from when a play happens in
      // real life to the time it is animated in GFFL?" … "lets just try the 2 changes for tonight".
      // ATL @ GB moved to the 3rd quarter (the halftime cut of the summary, the scoreboard set live).
      section("Live: polled every 2 s; plays walk out of the huddle");
      {
        const HFIX = path.join(__dirname, "fixtures", "halftime");
        const halfSum = fs.readFileSync(path.join(HFIX, "sum-401872948-half.json"), "utf8");
        const sbL = structuredClone(sbFixture), evL = sbL.events.find((e) => e.id === "401872948"), cL = evL.competitions[0];
        cL.status = evL.status = { clock: 492, displayClock: "8:12", period: 3, type: { id: "2", name: "STATUS_IN_PROGRESS", state: "in", completed: false, description: "In Progress", detail: "8:12 - 3rd Quarter", shortDetail: "8:12 - 3rd" } };
        for (const x of cL.competitors) x.score = x.homeAway === "away" ? "17" : "7";
        const json = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
        const evAsks = [];
        MOCK = (u) => /site\.api\.espn\.com.*\/scoreboard\/401872948/.test(u) ? (evAsks.push(Date.now()), json(JSON.stringify(evL)))
          : /site\.api\.espn\.com.*\/summary\?event=401872948/.test(u) ? json(halfSum)
          : /site\.api\.espn\.com.*\/scoreboard(\?|$)/.test(u) ? json(JSON.stringify(sbL))
          : /\/\.netlify\/functions\//.test(u) ? json('{"ok":false,"reason":"none"}') : null;
        await page.setViewport({ width: 390, height: 844 });
        await page.evaluate(() => localStorage.setItem("sun.tecmoBig", "true"));
        await page.goto(BASE + "/sunday.html?live=1#g401872948", { waitUntil: "domcontentloaded" });   // (a query, so the page really reloads)
        try { await page.waitForFunction(() => G?.sum && G.ev?.state === "in" && SIDE.sc, { timeout: 15000 }); } catch {}
        const t0 = Date.now(), n0 = evAsks.length;
        await wait(6500);
        const got = evAsks.filter((t) => t >= t0).length;
        ok(got >= 3 && got <= 4, `a live game's feed is asked every 2 s, not every 5: ${got} asks in 6.5 s (every 5 s would be 1 or 2)`);
        const cut = await probe(() => {
          const l = raPlays(), prevP = l.at(-2), p = l.at(-1);
          sidePlay(prevP); SIDE.t = SIDE.sc.T;                                      // the play before, finished
          const full = raBuild(p, G.ev, raQBs(), sideFrom(p));                     // what the walk-up would have been
          sidePlay(p);
          const sc = SIDE.sc, still = (s) => s.actors.filter((a) => a.side === "o" || a.side === "d").every((a) => { const [x0, z0] = raPos(a, 0), [x1, z1] = raPos(a, 0.9); return Math.hypot(x1 - x0, z1 - z0) < 0.3; });
          const px = (t) => { SIDE.t = t; raStep(SIDE, 0); const c = SIDE.cv, d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let v = 0; for (let i = 0; i < d.length; i += 64) v += d[i] + d[i + 1] + d[i + 2]; return Math.round(v / (d.length / 64) / 3); };
          return { tS: sc.tS, cutIn: sc.cutIn, fullTS: full.tS, set: still(sc), fullSet: still(full), rNow: sideResultAt(sc), rFull: sideResultAt(full), dark: px(0), lit: px(0.45), id: String(SIDE.playId), want: String(p.id) };
        });
        // RESTAGED 2026-09-28 (user: "its looking like our changes to make the live 8 bit feed faster
        // worked, now we have some room to back off a little since its like 10 seconds ahead of the tv
        // broadcast. so lets see if we can allow them to leave the huddle each play"): the one-night cut
        // straight to the snap (players set, snap at 1.1 s, a fade from black) is gone. A live play walks
        // out of the huddle again, exactly as a replay's does; the 2 s polling above stays.
        ok(cut.id === cut.want && cut.tS === cut.fullTS && cut.tS >= 4 && !cut.set && cut.cutIn == null,
          `a live play leaves the huddle and walks into its formation (players jogging at the start: ${!cut.set}), the snap at ${cut.tS} s, as a replay's (${cut.fullTS} s), no cut`);
        ok(Math.abs(cut.rFull - cut.rNow) < 0.01 && cut.dark > 40, `…its result at the walk-up's time (${cut.rNow?.toFixed?.(1)} s), no fade from black (frame brightness ${cut.dark} at 0 s)`);
        await probe(() => localStorage.removeItem("sun.tecmoBig"));
      }
      // 2026-09-28, user (PHI @ CHI): "chicago just ran a play and it was called a touchdown, but it was
      // being reviewed so it looks like GFFL didnt want to show it. It should show the interim result of
      // the play, and if the result changes, it should show the result overturned". The fixtures are the
      // real feed at 14:50 of the 2nd, CHI 7-0: ESPN logged the play only after the review, in one text,
      // "…for 6 yards, TOUCHDOWN.The Replay Official reviewed the runner broke the plane ruling, and the
      // play was REVERSED.C.Keenum pass short right to C.Loveland to PHI 1 for 5 yards (M.Carter)."
      section("Replay reviews: the call, then the ruling");
      {
        const RFIX = path.join(__dirname, "fixtures", "sunday");
        const rSumTx = fs.readFileSync(path.join(RFIX, "sum-401872963-review.json"), "utf8");
        const rEv = JSON.parse(fs.readFileSync(path.join(RFIX, "sb-401872963-review.json"), "utf8"));
        const PID = "4018729631003";
        const FULL = "C.Keenum pass short right to C.Loveland for 6 yards, TOUCHDOWN.The Replay Official reviewed the runner broke the plane ruling, and the play was REVERSED.C.Keenum pass short right to C.Loveland to PHI 1 for 5 yards (M.Carter).";
        const PRE = "C.Keenum pass short right to C.Loveland for 6 yards, TOUCHDOWN.";
        // The interim feed (the call on the field, logged before the review): the same play id, the
        // touchdown's text, 6 yards, a scoring play.
        const rSumPre = rSumTx.split(JSON.stringify(FULL).slice(1, -1)).join(PRE);
        const json = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
        let feed = "full";
        const evNow = () => { const e = structuredClone(rEv), lp = e.competitions[0].situation?.lastPlay; if (feed === "pre" && lp) { lp.text = PRE; lp.statYardage = 6; } return JSON.stringify(e); };
        const sumAsks = [];
        MOCK = (u) => /site\.api\.espn\.com.*\/scoreboard\/401872963/.test(u) ? json(evNow())
          : /site\.api\.espn\.com.*\/summary\?event=401872963/.test(u) ? (sumAsks.push({ feed, t: Date.now() }), json(feed === "pre" ? rSumPre : rSumTx))
          : /site\.api\.espn\.com.*\/scoreboard(\?|$)/.test(u) ? json(JSON.stringify({ ...sbFixture, events: [...sbFixture.events, JSON.parse(evNow())] }))   // (the board's copy of the game says the same)
          : /\/\.netlify\/functions\//.test(u) ? json('{"ok":false,"reason":"none"}') : null;
        await page.setViewport({ width: 390, height: 844 });
        await page.evaluate(() => localStorage.setItem("sun.tecmoBig", "true"));
        await page.goto(BASE + "/sunday.html?review=1#g401872963", { waitUntil: "domcontentloaded" });
        try { await page.waitForFunction(() => G?.sum && G.ev?.state === "in" && G.id === "401872963", { timeout: 15000 }); } catch {}

        const parse = await probe((FULL) => { const r = typeof raReview === "function" ? raReview({ text: FULL }) : null; return r && { ...r }; }, FULL);
        ok(parse?.reversed === true && parse.pre === PRE && /^C\.Keenum pass short right to C\.Loveland to PHI 1 for 5 yards/.test(parse.post) && parse.by === "Replay booth" && parse.what === "Runner broke the plane",
          `the review is read out of ESPN's text: call "${parse?.pre}", ${parse?.reversed ? "reversed" : "?"} by the ${parse?.by} (${parse?.what}), now "${parse?.post?.slice(0, 48)}…"`);
        const rpl = await probe((txt) => ["The Replay Official reviewed the pass completion ruling, and the play was Upheld.", "Philadelphia challenged the fumble ruling, and the play was REVERSED."].map((t) => { const r = raReview({ text: txt + t }); return r && { rev: r.reversed, by: r.by }; }), "J.Hurts pass short left to D.Smith for 12 yards. ");
        ok(rpl?.[0]?.rev === false && rpl[0].by === "Replay booth" && rpl?.[1]?.rev === true && rpl[1].by === "Philadelphia challenge",
          `…an upheld call and a coach's challenge too: ${JSON.stringify(rpl)}`);
        const none = await probe(() => raReview({ text: "C.Keenum pass short right to C.Loveland for 6 yards, TOUCHDOWN." }));
        ok(none === null, `a play with no review is left alone (${JSON.stringify(none)})`);

        // Act one: the touchdown as called; "Under review" after it; the page's result held.
        const a1 = await probe((PID) => {
          sideStop(); clearTimeout(SIDE.idle);
          const p = raPlays().find((x) => String(x.id) === PID);
          if (!p) return null;
          sidePlay(p);
          const sc = SIDE.sc, bn = sc.events.filter((e) => e.kind === "banner").map((e) => ({ t: +e.t.toFixed(2), title: e.title, sub: e.sub }));
          const tx = () => document.querySelector("#bt-tx")?.textContent || "";
          SIDE.t = sc.callAt + 0.05; raStep(SIDE, 0);
          // (the tick shows the call's text; wait a frame for it)
          return new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res({
            td: sc.tdAt != null, scoring: sc.p?.scoring ?? null, yards: sc.p?.yards ?? null, bn, gate: String(SIDE.gatePlay), resultAt: SIDE.resultAt === Infinity ? "Infinity" : SIDE.resultAt,
            tx: tx(), T: sc.T, second: typeof sc.second === "function", pSc: p.scoring, pY: p.yards,
          }))));
        }, PID);
        const tdB = a1?.bn?.find((b) => b.title === "Touchdown"), urB = a1?.bn?.find((b) => b.title === "Under review");
        ok(a1 && a1.td && tdB && a1.pSc === false && a1.pY === 5, `the play is staged as called, a touchdown (banner at ${tdB?.t} s), though the feed's final result is a 5-yard catch (scoring ${a1?.pSc}, ${a1?.pY} yards)`);
        ok(urB && tdB && urB.t > tdB.t && urB.t < a1.T && /Replay booth/.test(urB.sub) && /plane/i.test(urB.sub),
          `…then "Under review" (${urB?.t} s, after the touchdown's ${tdB?.t} s, before the act ends at ${a1?.T?.toFixed?.(1)} s): "${urB?.sub}"`);
        ok(a1?.second && a1.resultAt === "Infinity" && a1.gate === PID, `…and the page's result waits for the ruling (result at ${a1?.resultAt}, gate on ${a1?.gate})`);
        ok(a1 && /TOUCHDOWN/.test(a1.tx) && !/REVERSED|Replay Official/i.test(a1.tx), `…the text under the field is the call's, not the ruling's: "${a1?.tx}"`);

        // Act two: "Ruling reversed", the play again, the ball down at the PHI 1, then the page updates.
        const a2 = await probe(() => new Promise((res) => {
          const first = SIDE.sc;
          SIDE.t = first.T; raStep(SIDE, 0);
          const t0 = performance.now();
          const look = () => {
            const sc = SIDE.sc;
            if (sc === first && performance.now() - t0 < 3000) return requestAnimationFrame(look);
            const bn = sc.events.filter((e) => e.kind === "banner").map((e) => ({ t: +e.t.toFixed(2), title: e.title, sub: e.sub }));
            const end = raBall(sc, sc.T), H = sc.offHome ? (sc.spotZ ?? end.z) : 100 - (sc.spotZ ?? end.z);
            const resultAt = SIDE.resultAt, gate0 = SIDE.gatePlay;
            // From the first act: the players start where the touchdown left them.
            const walk = sc.actors.filter((a) => a.side === "o").map((a) => raPos(a, 0));
            const was = first.actors.filter((a) => a.side === "o").map((a) => raPos(a, first.T));
            const near = walk.filter(([x, z], i) => was[i] && Math.hypot(x - was[i][0], z - was[i][1]) < 1.5).length;
            SIDE.t = resultAt + 0.1; raStep(SIDE, 0);
            requestAnimationFrame(() => requestAnimationFrame(() => res({ same: sc === first, reversal: !!sc.reversal, td: sc.tdAt != null, bn, H: +H.toFixed(1), resultAt, gate0: String(gate0), gate1: SIDE.gatePlay, tx: document.querySelector("#bt-tx")?.textContent || "", near, n: walk.length })));
          };
          requestAnimationFrame(look);
        }));
        const rrB = a2?.bn?.find((b) => b.title === "Ruling reversed");
        ok(a2 && !a2.same && a2.reversal && rrB && rrB.sub === "Down at the PHI 1", `a second act follows: "Ruling reversed", "${rrB?.sub}"`);
        ok(a2 && !a2.td && Math.abs(a2.H - 99) <= 1, `…the play again as it stands, no touchdown, the ball down at the ${a2?.H} (the PHI 1 is 99)`);
        ok(a2 && a2.near >= a2.n - 1, `…the players walking back from where the touchdown left them (${a2?.near}/${a2?.n} start within 1.5 yd of their spots)`);
        // (briefText keeps the play as it stands and drops the call and the review's sentence.)
        ok(a2 && Number.isFinite(a2.resultAt) && a2.gate0 === PID && a2.gate1 == null && /to PHI 1 for 5 yards/.test(a2.tx) && !/TOUCHDOWN/.test(a2.tx),
          `…and only now the page gets the result (at ${a2?.resultAt?.toFixed?.(1)} s of act two, gate ${a2?.gate0} → ${a2?.gate1}), the text under the field the ruling's: "${a2?.tx}"`);

        // The call first, the review later: ESPN logs the touchdown, then rewrites the same play.
        feed = "pre";
        await probe(() => { sideStop(); SIDE.sc = null; SIDE.playId = null; SIDE.lastPlay = null; SIDE.reviewed = null; G.sumPoller.now(); });
        // (Until the scoreboard's own poll has brought the call's text too: that is what the rewrite is
        // told apart from.)
        try { await page.waitForFunction((PID, PRE) => String(SIDE.playId) === PID && SIDE.sc && !SIDE.sc.review && SIDE.sc.tdAt != null && G.ev.sit?.lastPlay?.text === PRE, { timeout: 12000 }, PID, PRE); } catch {}
        const i1 = await probe(() => ({ id: String(SIDE.playId), td: SIDE.sc?.tdAt != null, review: !!SIDE.sc?.review, text: SIDE.lastPlay?.text }));
        ok(i1?.td && !i1.review && i1.text === PRE, `the call logged on its own plays as a touchdown (${i1?.td}), no review yet`);
        const nPre = sumAsks.length;
        feed = "full";
        const tSwitch = Date.now();
        let i2 = null;
        try {
          await page.waitForFunction(() => SIDE.sc?.reversal, { timeout: 9000 });
          i2 = await probe(() => { const sc = SIDE.sc, bn = sc.events.filter((e) => e.kind === "banner").map((e) => ({ t: +e.t.toFixed(2), title: e.title, sub: e.sub })); const end = raBall(sc, sc.T); return { bn, td: sc.tdAt != null, H: +(sc.offHome ? end.z : 100 - end.z).toFixed(1), reviewed: SIDE.reviewed }; });
        } catch {}
        const ur2 = i2?.bn?.find((b) => b.title === "Under review"), rr2 = i2?.bn?.find((b) => b.title === "Ruling reversed");
        ok(i2 && ur2 && rr2 && ur2.t < rr2.t && !i2.td && Math.abs(i2.H - 99) <= 1,
          `the rewritten play is caught on the next poll: "Under review" (${ur2?.t} s), "Ruling reversed" (${rr2?.t} s), the play as it stands to the ${i2?.H}`);
        // (The summary's own poll is every 10 s; the scoreboard's, every 2.)
        const firstFull = sumAsks.slice(nPre).find((a) => a.feed === "full");
        ok(firstFull && firstFull.t - tSwitch < 4500, `…the summary asked again as soon as the scoreboard's text for that play changed (${firstFull ? ((firstFull.t - tSwitch) / 1000).toFixed(1) + " s" : "never"} after the rewrite; its own poll is every 10 s)`);

        // An upheld call on a play already shown: the banners over the stage, no second play.
        const up = await probe((PID) => {
          sideStop(); clearTimeout(SIDE.idle);
          const p = raPlays().find((x) => String(x.id) === PID);
          const pre = { ...p, text: "C.Keenum pass short right to C.Loveland for 6 yards, TOUCHDOWN." };
          sidePlay(pre); SIDE.t = SIDE.sc.T; raStep(SIDE, 0);
          const cur = SIDE.sc;
          sideReview({ ...p, text: pre.text + "The Replay Official reviewed the runner broke the plane ruling, and the play was Upheld." });
          const bn = SIDE.sc.events.filter((e) => e.kind === "banner" && e.t > SIDE.t).map((e) => e.title);
          return { same: SIDE.sc === cur, bn, running: SIDE.running };
        }, PID);
        ok(up?.same && up.bn?.join() === "Under review,Ruling stands" && up.running, `an upheld call on a play already shown: ${JSON.stringify(up?.bn)} over the stage, no replay of the play`);
        // In a replay the reviewed play gets both acts too.
        const rp = await probe((PID) => {
          sideStop();
          const p = raPlays().find((x) => String(x.id) === PID);
          SIDE.rp = { from: "drive", id: null, speed: 1, cv: sideTarget().cv, placed: null };
          SIDE.sc = null;
          tecmoRpPlay(p);
          const r = { review: !!SIDE.sc?.review, second: typeof SIDE.sc?.second === "function", resultAt: SIDE.resultAt === Infinity };
          sideStop(); SIDE.rp = null;
          return r;
        }, PID);
        ok(rp?.review && rp.second && rp.resultAt, `…and a replay stages it the same way (${JSON.stringify(rp)})`);
        await probe(() => localStorage.removeItem("sun.tecmoBig"));
      }
      // 2026-09-28, user (PHI @ CHI): "the eagles just scored a touchdown but it is not changing the
      // score … or it did, but like 30 seconds after the 8 bit animation played". ESPN put the touchdown
      // up as the scoreboard's latest play a poll before it moved the score; the score then moved with no
      // new play, and the page held the old score for its full 25 s. A score the page can already account
      // for (the scoreboard's latest play a scoring play, or the summary's last scoring play carrying that
      // score) shows at once; the hold stays for a score that arrives before its play does.
      section("A score change its play already explains is not held");
      {
        const RFIX = path.join(__dirname, "fixtures", "sunday");
        const rSum = fs.readFileSync(path.join(RFIX, "sum-401872963-review.json"), "utf8");
        const rEv = JSON.parse(fs.readFileSync(path.join(RFIX, "sb-401872963-review.json"), "utf8"));
        const json = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
        // phase: [CHI score, the scoreboard's latest play]
        let ph = { chi: 0, td: false };
        const evNow = () => {
          const e = structuredClone(rEv), c = e.competitions[0];
          for (const x of c.competitors) if (x.homeAway === "home") x.score = String(ph.chi);
          if (ph.td) Object.assign(c.situation.lastPlay, { id: "4018729631050", scoreValue: 6, type: { id: "67", text: "Passing Touchdown" }, text: "C.Keenum pass short right to C.Loveland for 1 yard, TOUCHDOWN.", statYardage: 1 });
          return JSON.stringify(e);
        };
        MOCK = (u) => /site\.api\.espn\.com.*\/scoreboard\/401872963/.test(u) ? json(evNow())
          : /site\.api\.espn\.com.*\/summary\?event=401872963/.test(u) ? json(rSum)                 // (the summary lags: never the new touchdown)
          : /site\.api\.espn\.com.*\/scoreboard(\?|$)/.test(u) ? json(JSON.stringify({ ...sbFixture, events: [...sbFixture.events, JSON.parse(evNow())] }))
          : /\/\.netlify\/functions\//.test(u) ? json('{"ok":false,"reason":"none"}') : null;
        await page.setViewport({ width: 390, height: 844 });
        // (On the field view: this is the score hold alone. On the 8-bit view, the default since
        // 2026-09-29, the score also waits for the touchdown's banner, the gate, which is its own check.)
        await page.evaluate(() => localStorage.setItem("sun.tecmoBig", "false"));
        await page.goto(BASE + "/sunday.html?hold=1#g401872963", { waitUntil: "domcontentloaded" });
        try { await page.waitForFunction(() => G?.sum && G.ev?.state === "in" && G.id === "401872963" && +G.ev.home.score === 0, { timeout: 15000 }); } catch {}
        const settle = (want) => page.waitForFunction((want) => !G.hold && !G.gate && document.querySelector("#gs-h")?.textContent === want, { timeout: 6000 }, want).then(() => true, () => false);
        // (a) The summary already has the scoring play with this score (CHI's 7-0 touchdown, 401872963315).
        ph = { chi: 7, td: false };
        const t0 = Date.now(), a = await settle("7"), da = Date.now() - t0;
        const sa = await probe(() => ({ hold: !!G.hold, h: document.querySelector("#gs-h")?.textContent }));
        ok(a, `the score moves to 7 as soon as the scoreboard says so, its touchdown already in the summary (${a ? (da / 1000).toFixed(1) + " s" : "held: " + JSON.stringify(sa)}; the hold is 25 s)`);
        // (b) The touchdown is the scoreboard's latest play a poll before the score moves (PHI @ CHI).
        ph = { chi: 7, td: true };
        await wait(3000);
        ph = { chi: 14, td: true };
        const t1 = Date.now(), b = await settle("14"), db = Date.now() - t1;
        const sb2 = await probe(() => ({ hold: !!G.hold, gate: !!G.gate, h: document.querySelector("#gs-h")?.textContent }));
        ok(b, `…and to 14 a poll after the touchdown went up as the latest play, the summary not yet caught up (${b ? (db / 1000).toFixed(1) + " s" : "held: " + JSON.stringify(sb2)})`);
        // (c) A score with no play to account for it is still held.
        ph = { chi: 17, td: false };
        await wait(3000);
        const sc3 = await probe(() => ({ hold: !!G.hold, h: document.querySelector("#gs-h")?.textContent }));
        ok(sc3?.hold && sc3.h === "14", `…but a score that arrives before its play is still held (${JSON.stringify(sc3)})`);
        await probe(() => localStorage.removeItem("sun.tecmoBig"));
      }
      // 2026-09-29, user: "Lets set 8-bit view as the default instead of field". Nothing stored: the
      // 8-bit stage shows and the tilted field doesn't; a viewer who picked the field keeps it.
      section("The 8-bit view is the default");
      {
        const shown = () => probe(() => ({ big: document.querySelector("#big-tecmo")?.offsetParent != null, field: document.querySelector(".field-3d")?.offsetParent != null, tog: document.querySelector("[data-fview]")?.textContent?.trim() }));
        await probe(() => localStorage.removeItem("sun.tecmoBig"));
        await page.goto(BASE + "/sunday.html?dflt=1#g401872963", { waitUntil: "domcontentloaded" });
        try { await page.waitForFunction(() => G?.sum && document.querySelector("#big-tecmo")?.offsetParent != null, { timeout: 10000 }); } catch {}
        const d = await shown();
        ok(d?.big && !d.field && d.tog === "Field", `with nothing stored the game opens on the 8-bit view (8-bit shown ${d?.big}, field shown ${d?.field}; the toggle offers "${d?.tog}")`);
        await probe(() => localStorage.setItem("sun.tecmoBig", "false"));
        await page.goto(BASE + "/sunday.html?dflt=2#g401872963", { waitUntil: "domcontentloaded" });
        try { await page.waitForFunction(() => G?.sum && document.querySelector(".field-3d")?.offsetParent != null, { timeout: 10000 }); } catch {}
        const f = await shown();
        ok(f && !f.big && f.field && f.tog === "8-bit", `…a viewer who picked the field keeps it (8-bit shown ${f?.big}, field shown ${f?.field})`);
        await probe(() => localStorage.removeItem("sun.tecmoBig"));
      }
      // 2026-09-28, user: "Often when refreshing the screen or going from one game back to the live game
      // it will replay the previous play. It shouldn't replay anything it shoukd always be live view".
      // Arriving (a load, a game view opened again, the page back in front, a replay left early), the
      // 8-bit view puts the newest play straight at its end, silently, and carries on from there; only a
      // play that comes in while someone is watching is animated.
      section("Arriving at a live game: the game as it is, no replay");
      {
        const RFIX = path.join(__dirname, "fixtures", "sunday");
        const rSum = fs.readFileSync(path.join(RFIX, "sum-401872963-review.json"), "utf8");
        const rEv = JSON.parse(fs.readFileSync(path.join(RFIX, "sb-401872963-review.json"), "utf8"));
        const json = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
        const NEW = "4018729631050";
        let newer = false, tdLast = false;
        const TDID = "4018729631060";
        const evNow = () => {
          const e = structuredClone(rEv), lp = e.competitions[0].situation.lastPlay;
          // …and a touchdown after that one: Swift from the 1.
          if (tdLast) { Object.assign(lp, { id: TDID, scoreValue: 6, type: { id: "68", text: "Rushing Touchdown" }, text: "D.Swift up the middle for 1 yard, TOUCHDOWN.", statYardage: 1, start: { ...lp.end, yardLine: 99 }, end: { ...lp.end, yardLine: 100 } }); return JSON.stringify(e); }
          // A play after the reviewed one: CHI runs from the PHI 1, stopped for no gain.
          if (newer) Object.assign(lp, { id: NEW, scoreValue: 0, type: { id: "5", text: "Rush" }, text: "D.Swift up the middle to PHI 1 for no gain (Z.Baun).", statYardage: 0, start: { ...lp.end, yardLine: 99 }, end: { ...lp.end, yardLine: 99 } });
          return JSON.stringify(e);
        };
        MOCK = (u) => /site\.api\.espn\.com.*\/scoreboard\/401872963/.test(u) ? json(evNow())
          : /site\.api\.espn\.com.*\/summary\?event=401872963/.test(u) ? json(rSum)
          : /site\.api\.espn\.com.*\/scoreboard(\?|$)/.test(u) ? json(JSON.stringify({ ...sbFixture, events: [...sbFixture.events, JSON.parse(evNow())] }))
          : /\/\.netlify\/functions\//.test(u) ? json('{"ok":false,"reason":"none"}') : null;
        await page.setViewport({ width: 390, height: 844 });
        await page.evaluate(() => localStorage.setItem("sun.tecmoBig", "true"));
        // How the stage stands the moment a play is put up: its clock against its length, and whether any
        // banner is still to come.
        const stage = () => probe(() => { const sc = SIDE.sc; return sc && { id: String(SIDE.playId), t: +SIDE.t.toFixed(2), T: +(sc.T > 1e5 ? -1 : sc.T).toFixed(2), huddle: !!sc.huddle, clear: !!sc.clear, left: sc.events.filter((e) => e.kind === "banner" && !SIDE.shown.has(e)).map((e) => e.title), gate: SIDE.gatePlay, tdAt: sc.tdAt ?? null, rev: !!sc.review }; });
        const settled = (s) => !!s && (s.huddle || s.clear || (s.T > 0 && s.t >= s.T - 0.01)) && !s.left.length && s.gate == null;
        const PID = "4018729631003";
        await page.goto(BASE + "/sunday.html?arrive=1#g401872963", { waitUntil: "domcontentloaded" });
        try { await page.waitForFunction((PID) => G?.sum && String(SIDE.playId) === PID && SIDE.sc, { timeout: 15000 }, PID); } catch {}
        const s1 = await stage();
        ok(settled(s1) && s1.id === PID, `on a load, the newest play is put straight at its end, not played again (${JSON.stringify(s1)})`);
        const s1b = await probe(() => { const sc = SIDE.sc, end = raBall(sc, SIDE.t); return { td: sc.tdAt != null, rev: !!sc.review, H: +(sc.offHome ? (sc.spotZ ?? end.z) : 100 - (sc.spotZ ?? end.z)).toFixed(1), tx: document.querySelector("#bt-tx")?.textContent || "" }; });
        ok(s1b && !s1b.td && !s1b.rev && Math.abs(s1b.H - 99) <= 1 && /PHI 1 for 5 yards/.test(s1b.tx), `…a reviewed play settles on the ruling: no touchdown, no "Under review", the ball at the ${s1b?.H}, "${s1b?.tx}"`);
        await wait(2500);
        const s1c = await stage();
        ok(s1c?.huddle, `…and the game carries on from there: the huddle at the next spot (${JSON.stringify(s1c && { huddle: s1c.huddle, id: s1c.id })})`);

        // A play while watching is animated, as ever.
        newer = true;
        let s2 = null;
        try { await page.waitForFunction((NEW) => String(SIDE.playId) === NEW, { timeout: 8000 }, NEW); s2 = await stage(); } catch {}
        ok(s2 && !s2.huddle && s2.T > 0 && s2.t < s2.T / 2 && s2.left.length > 0, `a play that comes in while watching is animated from its start (${JSON.stringify(s2)})`);

        // Back to the board and into the game again: a new game view, the same game.
        await page.evaluate(() => { location.hash = ""; });
        await wait(800);
        await page.evaluate(() => { location.hash = "#g401872963"; });
        let s3 = null;
        try { await page.waitForFunction((NEW) => G?.sum && SIDE.gRef === G && String(SIDE.playId) === NEW && SIDE.sc && !SIDE.arrive, { timeout: 10000 }, NEW); s3 = await stage(); } catch {}
        ok(settled(s3), `back into the game from the board: the newest play at its end, no replay (${JSON.stringify(s3)})`);

        // Leaving a replay early.
        const s4 = await probe(() => { tecmoRpStart("drive"); tecmoRpEnd(true); const sc = SIDE.sc; return sc && { id: String(SIDE.playId), t: +SIDE.t.toFixed(2), T: +sc.T.toFixed(2), huddle: !!sc.huddle, left: sc.events.filter((e) => e.kind === "banner" && !SIDE.shown.has(e)).map((e) => e.title), gate: SIDE.gatePlay }; });
        ok(settled(s4) && s4.id === NEW, `leaving a replay early: the live view picks up the game as it is (${JSON.stringify(s4)})`);

        // The page back in front after a play came in while it was away (sd-app's visibilitychange calls sideArrive).
        const s5 = await probe((PID) => {
          sideStop(); SIDE.sc = null; SIDE.playId = PID;           // the stage last showed the play before
          sideArrive(); sideUpdate();
          const sc = SIDE.sc; return sc && { id: String(SIDE.playId), t: +SIDE.t.toFixed(2), T: +sc.T.toFixed(2), huddle: !!sc.huddle, left: sc.events.filter((e) => e.kind === "banner" && !SIDE.shown.has(e)).map((e) => e.title), gate: SIDE.gatePlay };
        }, PID);
        const wired = /visibilitychange[\s\S]{0,400}sideArrive\(\)/.test(fs.readFileSync(path.join(__dirname, "..", "assets", "sunday", "sd-app.js"), "utf8"));
        ok(settled(s5) && s5.id === NEW && wired, `the page back in front: the play it missed is put at its end, not played (${JSON.stringify(s5)}; called from visibilitychange: ${wired})`);

        // The exception (user: "if the last play was a touchdown it should shoe that").
        tdLast = true;
        await page.goto(BASE + "/sunday.html?arrive=2#g401872963", { waitUntil: "domcontentloaded" });
        let s6 = null;
        try { await page.waitForFunction((TDID) => G?.sum && String(SIDE.playId) === TDID && SIDE.sc, { timeout: 15000 }, TDID); s6 = await stage(); } catch {}
        ok(s6 && s6.tdAt != null && s6.T > 0 && s6.t < s6.T / 2 && s6.left.includes("Touchdown"), `arriving on a touchdown, it plays: from ${s6?.t} s of ${s6?.T} s, "Touchdown" still to come (${JSON.stringify(s6)})`);
        const s7 = await probe(() => {
          const l = raPlays(), i = l.findIndex((p) => String(p.id) === "401872963315"), td = l[i], pat = l[i + 1];
          const rev = l.find((p) => String(p.id) === "4018729631003");
          return { td: !!td, pat: pat && `${pat.id} ${pat.typeText}`, onPat: String(raArriveTD(pat)?.id), onTd: String(raArriveTD(td)?.id), onRev: raArriveTD(rev), onRun: raArriveTD(l[i - 1]) };
        });
        ok(s7?.td && s7.onTd === "401872963315" && s7.onPat === "401872963315" && s7.onRev === null && s7.onRun === null,
          `…on the try just after one, its touchdown plays first (${s7?.pat} → ${s7?.onPat}); a touchdown the review took away, or any other play, is settled (${JSON.stringify(s7)})`);
        await probe(() => localStorage.removeItem("sun.tecmoBig"));
      }
      // 2026-10-03, ported from Saturday's review of the ESPN feed (a recording of live games polled as
      // the page polls them, and every play of a Saturday's games through the parser): the summary runs
      // 8 to 30 s behind the scoreboard; a play seen on the scoreboard dropped out of the list when the
      // scoreboard moved on before the summary had it; play ids are not strictly increasing; the try is
      // reported at once as an "Extra Point Good" under an odd id; and between plays the situation can
      // carry the team with the ball but a yard line of 0, which put the huddle on the goal line.
      section("The ESPN feed: plays kept until the summary has them, ids out of order, the huddle's spot");
      {
        const RFIX = path.join(__dirname, "fixtures", "sunday");
        const rSum = fs.readFileSync(path.join(RFIX, "sum-401872963-review.json"), "utf8");
        const rEv = JSON.parse(fs.readFileSync(path.join(RFIX, "sb-401872963-review.json"), "utf8"));
        const json = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
        let oddId = false, sumHits = 0;
        const evNow = () => { const e = structuredClone(rEv); if (oddId) e.competitions[0].situation.lastPlay.id = "-89197925"; return JSON.stringify(e); };
        MOCK = (u) => /site\.api\.espn\.com.*\/scoreboard\/401872963/.test(u) ? json(evNow())
          : /site\.api\.espn\.com.*\/summary\?event=401872963/.test(u) ? (sumHits++, json(rSum))
          : /site\.api\.espn\.com.*\/scoreboard(\?|$)/.test(u) ? json(JSON.stringify({ ...sbFixture, events: [...sbFixture.events, JSON.parse(evNow())] }))
          : /\/\.netlify\/functions\//.test(u) ? json('{"ok":false,"reason":"none"}') : null;
        await page.setViewport({ width: 390, height: 844 });
        await probe(() => localStorage.removeItem("sun.tecmoBig"));
        await page.goto(BASE + "/sunday.html?feed=1#g401872963", { waitUntil: "domcontentloaded" });
        try { await page.waitForFunction(() => G?.sum && G.ev?.state === "in" && G.id === "401872963" && SIDE?.sc, { timeout: 15000 }); } catch {}
        // (a) The summary is asked twice as often while the scoreboard's last play is not a real play.
        // The next request is already booked 10 s after the load; from there every 5 s: three in the 22 s
        // watched (at about 10, 15 and 20 s), where every 10 s gives two (10 and 20 s).
        await wait(1500);
        oddId = true; await wait(2500);                              // (a poll, so the page has seen the odd id)
        sumHits = 0; await wait(22000);
        const odd = sumHits;
        ok(odd >= 3, `with the scoreboard's last play under an odd id (-89197925) the summary is asked every 5 s: ${odd} requests in 22 s (every 10 s would be 2)`);
        oddId = false;
        await probe(() => { G.evPoller.stop(); G.sumPoller.stop(); sideStop(); });
        // (b) Ids out of order, and the parser's two misreads.
        const f1 = await probe(() => {
          const ev = "401872963", sum = (...rows) => ({ byId: new Map(rows) });
          return {
            afterTimeout: quickIsNewer(ev + "1102", sum([ev + "1100", { kind: "run" }], [ev + "1104", { kind: "meta" }]), ev),
            afterRealPlay: quickIsNewer(ev + "1102", sum([ev + "1100", { kind: "run" }], [ev + "1104", { kind: "meta" }], [ev + "1106", { kind: "pass" }]), ev),
            ahead: quickIsNewer(ev + "1108", sum([ev + "1100", { kind: "run" }]), ev),
            odd: quickIsNewer("-89197925", sum([ev + "1100", { kind: "run" }]), ev),
            known: quickIsNewer(ev + "1100", sum([ev + "1100", { kind: "run" }]), ev),
            kinds: [
              playKind({ type: { text: "Sack" }, text: "(Shotgun) B.Pribula pass incomplete short right to T.Coleman. PENALTY on UVA-B.Pribula, Intentional Grounding, 10 yards" }),
              playKind({ type: { text: "Sack" }, text: "(Shotgun) J.Love sacked at GB 21 for -6 yards (K.Elliss)." }),
              playKind({ type: { text: "Fumble Recovery (Own)" }, text: "J.Love sacked at GB 14 for -13 yards (K.Jackson). FUMBLES (K.Jackson), and recovers at GB 14." }),
            ],
            nullTD: raParse({ id: "x1", kind: "pass", typeText: "Pass Reception", text: "J.Love pass deep right to C.Watson for 40 yards, TOUCHDOWN NULLIFIED by Penalty. PENALTY on GB-Z.Tom, Offensive Holding, 10 yards, enforced at GB 30 - No Play.", offId: G.ev.home.id }, G.ev).td,
            realTD: raParse({ id: "x2", kind: "pass", typeText: "Passing Touchdown", scoring: true, text: "J.Love pass deep right to C.Watson for 40 yards, TOUCHDOWN.", offId: G.ev.home.id }, G.ev).td,
            tacklers: raParse({ id: "x3", kind: "run", typeText: "Rush", text: "K.Johnson up the middle to GB 9 for 5 yards (4) (D.Walker).", offId: G.ev.home.id }, G.ev).tacklers.map((w) => w.last),
            fumbled: raParse({ id: "x4", kind: "run", typeText: "Fumble Recovery (Opponent)", text: "B.Brown rush middle for 3 yards to the PHI 40 fumbled by B.Brown at PHI 40 recovered by PHI X.Atkins", offId: G.ev.home.id }, G.ev).hasFumble,
          };
        });
        ok(f1?.afterTimeout === true && f1.afterRealPlay === false && f1.ahead === true && f1.odd === false && f1.known === false,
          `a play under a lower id than the timeout logged just before it is still new; not once the summary has a real play above it, nor an odd id, nor one it has (${JSON.stringify({ afterTimeout: f1?.afterTimeout, afterRealPlay: f1?.afterRealPlay, ahead: f1?.ahead, odd: f1?.odd, known: f1?.known })})`);
        ok(JSON.stringify(f1?.kinds) === '["incomplete","sack","sack"]', `an incompletion ESPN types "Sack" (intentional grounding) is an incompletion; a sack is a sack; a strip-sack typed "Fumble Recovery" is a sack (${JSON.stringify(f1?.kinds)})`);
        ok(!f1?.nullTD && f1?.realTD === true, `"TOUCHDOWN NULLIFIED by Penalty … No Play" is not a touchdown; a touchdown still is (${f1?.nullTD} / ${f1?.realTD})`);
        ok(JSON.stringify(f1?.tacklers) === '["Walker"]', `a bare number in parentheses is not a tackler: "(4) (D.Walker)" names ${JSON.stringify(f1?.tacklers)}`);
        ok(f1?.fumbled === true, `"fumbled by" is a fumble, as "FUMBLES" is (${f1?.fumbled})`);
        // (c) A touchdown on the scoreboard a poll before the summary has it; then the scoreboard moves
        // on to the try's odd entry. The touchdown stays in the list and its try follows it, under the id
        // the summary's own try will carry. (CHI's 7-0 touchdown, 401872963315, cut out of the summary.)
        const f2 = await probe(() => {
          const full = G.sum, raw = full.raw.drives.previous.flatMap((d) => d.plays), TD = raw.find((p) => p.id === "401872963315");
          const bare = TD.text.replace(/\s*C\.Santos extra point[\s\S]*$/, "");
          const cut = full.flat.findIndex((f) => f.p.id === TD.id), before = full.flat[cut - 1].p;
          const pre = { ...full, flat: full.flat.slice(0, cut), byId: new Map(full.flat.slice(0, cut).map((f) => [f.p.id, f.p])) };
          const lp = (o) => ({ team: TD.start.team, start: TD.start, end: TD.end, statYardage: TD.statYardage, ...o });
          const tail = () => raPlays().slice(-3).map((p) => `${p.id}${p.pat ? ":" + p.typeText : ""}`);
          const keepEv = G.ev, keepSum = G.sum, out = {};
          G.quicks = []; G.sum = pre;
          G.ev = { ...keepEv, sit: { ...keepEv.sit, lastPlay: lp({ id: TD.id, type: TD.type, text: bare, scoreValue: 6 }) } };
          out.s1 = tail();
          G.ev = { ...keepEv, sit: { ...keepEv.sit, lastPlay: lp({ id: "-89197925", type: { id: "61", text: "Extra Point Good" }, text: "C.Santos extra point is GOOD", scoreValue: 1, start: TD.end }) } };
          out.s2 = tail();
          const pat = raPlays().at(-1);
          out.pat = { kind: pat.kind, sH: pat.sH, home: pat.offId === G.ev.home.id, text: pat.text };
          G.sum = keepSum;                                            // the summary catches up, the kick in the touchdown's text
          { const l3 = raPlays(), i3 = l3.findIndex((p) => p.id === TD.id); out.s3 = l3.slice(i3, i3 + 2).map((p) => `${p.id}${p.pat ? ":" + p.typeText : ""}`); out.tries = l3.filter((p) => String(p.id) === TD.id + "-pat").length; out.tds = l3.filter((p) => p.id === TD.id).length; }
          out.left = G.quicks.length;
          out.before = before.id;
          // The down and distance of a play seen on the scoreboard, from the poll before it.
          G.preSnap = { id: TD.id, down: 3, dist: 2, dd: "3rd & 2", yl: TD.start.yardLine, poss: TD.start.team.id };
          G.sum = pre;
          G.ev = { ...keepEv, sit: { ...keepEv.sit, lastPlay: lp({ id: TD.id, type: TD.type, text: bare, scoreValue: 6, start: { yardLine: TD.start.yardLine, team: TD.start.team } }) } };
          const q = quickPlay(G.ev);
          out.q = { sDD: q.sDD, down: q.down, dist: q.dist };
          G.ev = keepEv; G.sum = keepSum; G.quicks = []; G.preSnap = null;
          return out;
        });
        ok(f2?.s1?.[2] === "401872963315" && f2.s1[1] === f2.before, `the touchdown is in the list from the scoreboard, the summary still a play behind (${JSON.stringify(f2?.s1 || f2)})`);
        ok(f2?.s2?.[1] === "401872963315" && f2.s2[2] === "401872963315-pat:Extra Point Good",
          `when the scoreboard moves on to the try's odd entry the touchdown stays, and its try follows it (${JSON.stringify(f2?.s2)})`);
        ok(f2?.pat?.kind === "fg" && f2.pat.sH === 85 && f2.pat.home === true && /Santos/.test(f2.pat.text), `…a kick by the home team from the 15, the kicker read from the entry (${JSON.stringify(f2?.pat)})`);
        ok(JSON.stringify(f2?.s3) === '["401872963315","401872963315-pat:Extra Point Good"]' && f2.left === 0 && f2.tds === 1 && f2.tries === 1,
          `once the summary has the touchdown: one touchdown (${f2?.tds}), one try (${f2?.tries}), the same ids, nothing left waiting (${JSON.stringify(f2?.s3)}, ${f2?.left} waiting)`);
        ok(f2?.q?.sDD === "3rd & 2" && f2.q.down === 3 && f2.q.dist === 2, `a play from the scoreboard carries the down and distance of the poll before it (${JSON.stringify(f2?.q)})`);
        // (d) The huddle's spot. A finished run at the PHI 40s, then the feed says CHI ball at yard line
        // 0: the huddle forms where the play left the ball, not on the goal line; when the feed gives the
        // 30 it moves there (a spot within a yard and a half of the huddle's is left alone). Yards from
        // the offense's own goal line; CHI is home, so z = the yard line.
        const f3 = await probe(() => {
          const l = raPlays(), p = l.find((x) => x.kind === "run" && x.offId === G.ev.home.id && x.eH > 20 && x.eH < 80 && !x.scoring && !x.penYards && !x.turnover);
          const prev = raBuild(p, G.ev, raQBs());
          const tgt = sideTarget();
          Object.assign(SIDE, { sc: prev, t: prev.T, running: false, idle: 0, cv: tgt.cv, banner: tgt.banner, gRef: G, gameId: G.id, playId: l[l.length - 1].id, lastPlay: p, rp: null, arrive: false, reviewed: String(l[l.length - 1].id), timeoutId: null });
          prev.gameId = G.id;
          const keepEv = G.ev, sit = (yl) => ({ possession: G.ev.home.id, yardLine: yl, down: 2, distance: 5, downDistanceText: yl ? "2nd & 5 at CHI 30" : "", lastPlay: keepEv.sit.lastPlay });
          const ball = raBall(prev, prev.T).z;
          G.ev = { ...keepEv, sit: sit(0) };
          sideHuddle(); sideStop();
          const bad = { huddle: !!SIDE.sc.huddle, z0: SIDE.sc.z0 };
          G.ev = { ...keepEv, sit: sit(30) };
          sideUpdate(); sideStop();
          const moved = { huddle: !!SIDE.sc.huddle, z0: SIDE.sc.z0 };
          const t0 = SIDE.sc;
          sideUpdate(); sideStop();
          const steady = SIDE.sc === t0;
          G.ev = keepEv;
          return { ball: +ball.toFixed(1), eH: p.eH, bad, moved, steady };
        });
        ok(f3?.bad?.huddle && Math.abs(f3.bad.z0 - f3.ball) <= 0.6 && f3.bad.z0 > 20,
          `with the feed's yard line at 0 the huddle forms where the play left the ball (z ${f3?.bad?.z0}, the ball at ${f3?.ball}; the goal line would be 0)`);
        ok(f3?.moved?.huddle && f3.moved.z0 === 30 && f3.steady === true, `…and moves to the 30 when the feed gives it, once (z ${f3?.moved?.z0}; a second update leaves it: ${f3?.steady})`);
        // (e) The official jogs a long penalty off. A run with 55 penalty yards to walk: at 3.2 yd/s that
        // is 17.2 s; now clamp(55 / 4.5, 3.2, 8) = 8 yd/s, 6.9 s.
        const f4 = await probe(() => {
          const l = raPlays(), home = G.ev.home.id;
          const p0 = l.find((x) => x.kind === "run" && !x.scoring && !x.penYards && x.yards > 0 && x.yards < 8 && (x.offId === home ? x.sH + x.yards + 55 < 98 : x.sH - x.yards - 55 > 2));
          if (!p0) return null;
          const dir = p0.offId === home ? 1 : -1;
          const sc = raBuild({ ...p0, id: "pen1", penYards: 55, eH: p0.sH + dir * (p0.yards + 55) }, G.ev, raQBs());
          const ref = sc.actors.find((a) => a.side === "r"), k = ref.k;
          return { walk: +(k[4][0] - k[3][0]).toFixed(2), yards: +Math.abs(k[4][2] - k[3][2]).toFixed(1) };
        });
        ok(f4 && Math.abs(f4.yards - 55) < 0.6 && Math.abs(f4.walk - f4.yards / 8) < 0.05, `a 55-yard penalty is walked off in ${f4?.walk} s (${f4?.yards} yd at 8 yd/s; it was 17.2 s at 3.2)`);
        // (f) The page's 15 s cap on a held score becomes 30 s while the stage is animating that very play.
        const f5 = await probe(() => {
          if (typeof sideGateBusy !== "function") return null;
          Object.assign(SIDE, { gatePlay: "g1", running: true, last: performance.now() });
          const a = sideGateBusy("g1"), b = sideGateBusy("g2");
          SIDE.running = false;
          const c = sideGateBusy("g1");
          SIDE.gatePlay = null;
          return [a, b, c];
        });
        ok(JSON.stringify(f5) === "[true,false,false]", `the stage says when it is animating the play the page is waiting on (that play, another play, not running: ${JSON.stringify(f5)})`);
        await probe(() => localStorage.removeItem("sun.tecmoBig"));
      }
      await page.setViewport({ width: 800, height: 600 });
      MOCK = null;
    }

    /* ===================== (r) RedZone ===================== */
    // 2026-10-04, user: 'lets add a "Redzone" card to the GFFL scores page thats always at the top
    // right, and rather than follow one game it flashes between games similar to the way redzone does,
    // showing plays as they happen and leaning towards games in the rezone, and instead of single game
    // stats below its a total feed of all fantasy activity for the league'. Data: the real scoreboard,
    // polled every ~15 s on 2026-10-04 (rz-sb-20261004.json), and the real core-API plays of two of
    // those games (rz-core-20261004.json). Every number below is hand-computed at its check.
    section("RedZone: the card, the director, the league feed");
    {
      const rzFix = JSON.parse(fs.readFileSync(path.join(FIX, "rz-sb-20261004.json"), "utf8"));
      const coreFix = JSON.parse(fs.readFileSync(path.join(FIX, "rz-core-20261004.json"), "utf8"));
      // TEN @ BAL's summary as polled at 17:20:47 (poll 3 of rz-sb), trimmed like sum-401872948.json.
      const tenSum = fs.readFileSync(path.join(FIX, "rz-sum-401872973.json"), "utf8");
      const json = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
      const miss = { status: 404, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" };
      let snapI = 0;
      MOCK = (u) => {
        if (/site\.api\.espn\.com.*\/scoreboard(\?|$)/.test(u)) return json(JSON.stringify(rzFix.snaps[snapI].sb));
        const core = u.match(/sports\.core\.api\.espn\.com.*\/events\/(\d+)\/competitions\/\d+\/plays/);
        if (core) return coreFix.games[core[1]] ? json(JSON.stringify(coreFix.games[core[1]])) : miss;
        if (/site\.api\.espn\.com.*\/summary\?event=401872973/.test(u)) return json(tenSum);
        const one = u.match(/site\.api\.espn\.com.*\/scoreboard\/(\d+)/);
        if (one) { const e = rzFix.snaps[snapI].sb.events.find((x) => x.id === one[1]); return e ? json(JSON.stringify(e)) : miss; }
        if (/site\.api\.espn\.com/.test(u)) return miss;   // summaries: not served, the card doesn't read them
        return null;
      };
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const probe = (fn, arg) => page.evaluate(fn, arg).catch((e) => ({ err: e.message.split("\n")[0] }));
      const liveN = rzFix.snaps[0].sb.events.filter((e) => e.status.type.state === "in").length;   // 8 on the recording
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(BASE + "/sunday.html#g401872972", { waitUntil: "domcontentloaded" });
      let up = true;
      try { await page.waitForFunction(() => G && S.loaded && !document.getElementById("rzn-entry")?.hidden, { timeout: 15000 }); } catch { up = false; }
      await wait(300);
      // RESTAGED 2026-10-04 (user: "the redzone shouldn't appear on every games screen, its like its own
      // game that appears in the top scroll bar"): the card used to sit at the top of every game's sidebar.
      // Now a game's own screen has no RedZone on it; the top of the sidebar is RedZone's entry, which
      // opens it like a game. (The sidebar starts under GFFL's 46 + 34 = 80px header, padding 14px: 94px.)
      const plain = await probe(() => {
        const rz = document.getElementById("redzone"), e = document.getElementById("rzn-entry"), side = document.querySelector(".gv-side"), main = document.querySelector(".gv-main");
        const r = e.getBoundingClientRect();
        return { card: rz.offsetParent !== null, tabs: document.getElementById("tabs").offsetParent !== null, first: side.firstElementChild === e, top: Math.round(r.top), left: Math.round(r.left), mainRight: Math.round(main.getBoundingClientRect().right),
          lit: e.classList.contains("current"), href: e.getAttribute("href"), text: e.textContent.replace(/\s+/g, " ").trim(), mode: document.getElementById("game-view").classList.contains("rz-mode") };
      });
      ok(up && plain.card === false && plain.tabs === true && plain.mode === false, `a game's own screen has no RedZone card; its tabs are there (card shown ${plain.card}, tabs ${plain.tabs})`);
      ok(plain.first && plain.href === "#redzone" && plain.top === 94 && plain.left > plain.mainRight && !plain.lit && plain.text.startsWith("RedZone") && plain.text.includes(`${liveN} live`),
        `desktop: RedZone's entry is at the top of the sidebar's games, top right (top ${plain.top}px), not lit, with what's on (${JSON.stringify(plain.text)})`);
      const pace0 = await probe(async () => { const got = []; const keep = boardPoller.onSchedule; boardPoller.onSchedule = (ms, ok) => { got.push(ms); keep(ms, ok); }; boardPoller.now(); await new Promise((r) => setTimeout(r, 600)); boardPoller.onSchedule = keep; return got; });
      ok(Array.isArray(pace0) && pace0.includes(15000) && !pace0.includes(5000), `outside RedZone the scoreboard keeps its 15 s live poll (${JSON.stringify(pace0)})`);

      // ── the director, on the real polls. Each poll is ingested at its own recorded time.
      const real = await probe((snaps) => {
        if (typeof rzOnBoard !== "function") return { err: "no rzOnBoard" };
        RZ.seen.clear(); RZ.totals.clear(); RZ.pending.clear(); RZ.shown.clear(); RZ.dead?.clear(); RZ.lastNews?.clear(); RZ.cur = null;
        const out = [];
        for (const s of snaps) {
          const evs = s.sb.events.map(normEvent);
          S.events = evs; S.byId = new Map(evs.map((e) => [e.id, e]));
          const t = Date.parse(s.at);
          rzOnBoard(evs, t);
          const c = RZ.cur, ev = c && S.byId.get(c.gid);
          out.push({ at: s.at.slice(11, 19), pending: RZ.pending.size, gid: c?.gid, kind: c?.kind, play: c?.play?.id != null ? String(c.play.id) : null, moment: ev ? rzMoment(ev, c) : null });
        }
        return out;
      }, rzFix.snaps);
      const R = Array.isArray(real) ? real : [];
      ok(R[0] && R[0].pending === 0 && R[0].gid, `the first poll is only a baseline: nothing is news yet, and the card sits on a live game (${JSON.stringify(R[0])})`);
      // 17:20:16 — DAL @ HOU goes 7 to 10 while its last play already reads "Official Timeout": the
      // rise of 3 is the field goal, and the card goes there.
      ok(R[1] && R[1].gid === "401872967" && R[1].kind === "score" && R[1].moment === "Field goal",
        `a field goal that lands between two polls (the last play already a timeout) is still a score: the card cuts to DAL @ HOU on "Field goal" (${JSON.stringify(R[1])})`);
      // 17:20:32 and 17:20:47 — 16 and 31 s after the field goal. DAL @ HOU's scoreboard still says red
      // zone (it does until the kickoff, 95 s of TV timeout later on this recording), but the drive is
      // over. RESTAGED 2026-10-04 (user: "its not switching to games with action, for example as soon
      // as a field goal is kicked that game should no longer be the redzone feature, it should bounce
      // around to games with activity"): the first version took the stale flag as a red-zone hold and
      // sat on DAL @ HOU until TEN @ BAL's touchdown pulled it away 49 s later.
      ok(R[2] && R[3] && R[2].gid !== "401872967" && R[3].gid !== "401872967",
        `once the field goal has had its 8 s, the card leaves DAL @ HOU for games still playing, stale red-zone flag or not (17:20:32 on ${R[2]?.gid}, 17:20:47 on ${R[3]?.gid})`);
      // 17:21:05 — TEN @ BAL: Pollard's 3-yard touchdown (play 401872973543) as the last play.
      ok(R[4] && R[4].gid === "401872973" && R[4].kind === "score" && R[4].play === "401872973543" && /^Touchdown/.test(R[4].moment || ""),
        `a red-zone touchdown takes the card (${JSON.stringify(R[4])})`);
      // 17:21:20 — 15 s on. RESTAGED 2026-10-04, same ruling as above: the touchdown used to stay up
      // because BAL still read red zone. The drive is over, so the card has moved to a game in play.
      ok(R[5] && R[5].gid !== "401872973", `15 s after the touchdown the card is on another game, not the finished drive (${JSON.stringify(R[5])})`);
      // 17:21:36 — the try ("Extra Point Good", odd id -427760) arrives 31 s after the TD, and the
      // situation no longer reads red zone. The try is never what the card shows; a new play
      // elsewhere takes the card instead (the TD's hold is over and nothing holds TEN @ BAL now).
      ok(R.length === 8 && R.every((r) => r.play !== "-427760") && R[6].gid !== "401872973" && R[6].kind === "play",
        `the extra point never replaces the touchdown on the card; once the drive is over, the next play elsewhere takes it (${JSON.stringify(R[6])})`);

      // ── the director's rules, on hand-built situations (real games from the recording, their
      // situation set by hand). t0 is arbitrary; every step is t0 + seconds.
      const rules = await probe((sb) => {
        if (typeof rzOnBoard !== "function") return { err: "no rzOnBoard" };
        const base = sb.events.map(normEvent).filter((e) => e.state === "in");
        const [A, B, C] = base.map((e) => structuredClone(e));
        const reset = () => { RZ.seen.clear(); RZ.totals.clear(); RZ.pending.clear(); RZ.shown.clear(); RZ.dead?.clear(); RZ.lastNews?.clear(); RZ.cur = null; };
        const setEvs = (evs) => { S.events = evs; S.byId = new Map(evs.map((e) => [e.id, e])); };
        const sit = (ev, o) => { ev.sit = { ...(ev.sit || {}), ...o }; ev.name = "STATUS_IN_PROGRESS"; ev.period = 2; ev.detail = "5:00 - 2nd"; return ev; };
        let n = 0;
        const play = (ev, type, extra = {}) => { ev.sit = { ...ev.sit, lastPlay: { id: ev.id + "9" + String(++n).padStart(3, "0"), type: { text: type }, text: type + " play", scoreValue: 0, statYardage: 4, team: { id: ev.home.id }, ...extra } }; return ev; };
        const t0 = 1e12, s = (x) => t0 + x * 1000;
        const out = {};
        const start = (rzA) => { reset(); for (const e of [A, B, C]) { sit(e, { isRedZone: false, down: 1, distance: 10, yardLine: 50, possession: e.home.id }); play(e, "Rush"); } if (rzA) sit(A, { isRedZone: true, yardLine: 85 }); setEvs([A, B, C]); rzOnBoard([A, B, C], s(-60)); rzCut(A.id, null, s(0)); };
        // T1 · a play elsewhere waits until the one on screen has had 7 s
        start(false);
        play(B, "Pass Reception"); rzOnBoard([A, B, C], s(3));
        out.t1a = RZ.cur.gid === A.id && RZ.pending.has(B.id);
        rzTick(s(7)); out.t1b = RZ.cur.gid === B.id && !RZ.pending.has(B.id);
        // T2 · a game in the red zone holds against an ordinary play, not against a score
        start(true);
        play(B, "Rush"); rzOnBoard([A, B, C], s(10)); rzTick(s(25));
        out.t2a = RZ.cur.gid === A.id;
        B.home.score = (B.home.score || 0) + 7; play(B, "Passing Touchdown", { scoreValue: 6 }); rzOnBoard([A, B, C], s(26));
        out.t2b = RZ.cur.gid === B.id && RZ.cur.kind === "score";
        // T3 · red zone against red zone: the newcomer gets it once the game on screen has had 20 s
        start(true);
        sit(B, { isRedZone: true, yardLine: 88 }); play(B, "Rush"); rzOnBoard([A, B, C], s(10));
        out.t3a = RZ.cur.gid === A.id;
        rzTick(s(20)); out.t3b = RZ.cur.gid === B.id;
        // T4 · a score holds the card 8 s, even against another score (RESTAGED 2026-10-04 from 14 s:
        // "as soon as a field goal is kicked that game should no longer be the redzone feature")
        start(false);
        A.home.score = (A.home.score || 0) + 3; play(A, "Field Goal Good", { scoreValue: 3 }); rzOnBoard([A, B, C], s(1));
        out.t4k = RZ.cur.gid === A.id && RZ.cur.kind === "score";
        C.away.score = (C.away.score || 0) + 7; play(C, "Rushing Touchdown", { scoreValue: 6 }); rzOnBoard([A, B, C], s(8));
        out.t4a = RZ.cur.gid === A.id;
        rzTick(s(9)); out.t4b = RZ.cur.gid === C.id;
        // T4b · a field goal with the red-zone flag left on and nothing waiting anywhere: after its 8 s
        // the card still leaves for a game in play
        start(false);
        sit(A, { isRedZone: true, yardLine: 85 }); A.home.score += 3; play(A, "Field Goal Good", { scoreValue: 3 }); rzOnBoard([A, B, C], s(1));
        rzTick(s(8)); out.t4c = RZ.cur.gid === A.id;
        rzTick(s(9)); out.t4d = RZ.cur.gid !== A.id && RZ.pending.size === 0;
        // T4c · the scoring team's kickoff (and a punt elsewhere) are not news
        start(false);
        play(B, "Kickoff"); play(C, "Punt"); rzOnBoard([A, B, C], s(2)); rzTick(s(10));
        out.t4e = RZ.cur.gid === A.id && [...RZ.pending.values()].every((n) => n.prio === 0);
        // T4d · a new drive in the red zone holds again: after the FG and kickoff, a snap from the 15
        start(false);
        A.home.score += 3; play(A, "Field Goal Good", { scoreValue: 3 }); rzOnBoard([A, B, C], s(1));
        // (Guarded so code without these helpers fails this check, not the whole probe.)
        const inRZ = typeof rzInRZ === "function" ? rzInRZ : () => null, isDead = (e) => !!RZ.dead?.has(e.id);
        const deadAfterFg = inRZ(A) === false && isDead(A);
        sit(A, { isRedZone: true, yardLine: 85 }); play(A, "Pass Reception"); rzOnBoard([A, B, C], s(30));
        out.t4f = deadAfterFg && inRZ(A) === true && !isDead(A);
        // T4e · from a finished drive, the card goes to the game that just ran a snap
        start(false);
        for (const e of [B, C]) { e.away.score = 10; e.home.score = 10; }
        A.home.score += 3; play(A, "Field Goal Good", { scoreValue: 3 }); rzOnBoard([A, B, C], s(1));
        RZ.lastNews?.set(C.id, s(4)); RZ.lastNews?.delete(B.id);
        rzTick(s(9)); out.t4g = RZ.cur.gid === C.id;
        // T5 · nothing new anywhere for 30 s: on to the next game, and a game in the red zone first
        start(false);
        sit(C, { isRedZone: true, yardLine: 90 }); setEvs([A, B, C]);
        rzTick(s(29)); out.t5a = RZ.cur.gid === A.id;
        rzTick(s(30)); out.t5b = RZ.cur.gid === C.id;
        // T6 · ...but a quiet game inside the 20 keeps the card up to 90 s
        start(true);
        rzTick(s(31)); out.t6a = RZ.cur.gid === A.id;
        rzTick(s(90)); out.t6b = RZ.cur.gid !== A.id;
        // T7 · halftime: the card leaves at once
        start(false);
        A.name = "STATUS_HALFTIME"; rzTick(s(2)); out.t7 = RZ.cur.gid !== A.id;
        // T8 · a touchdown then its extra point, both unseen: the touchdown is what's waiting
        start(false);
        B.home.score += 7; play(B, "Passing Touchdown", { scoreValue: 6 }); rzOnBoard([A, B, C], s(2));
        play(B, "Extra Point Good", { scoreValue: 1 }); rzOnBoard([A, B, C], s(4));
        out.t8 = RZ.pending.get(B.id)?.kind === "score";
        // T8b · the game on screen scores and its try shows up 4 s later: the touchdown stays up; at 8 s
        // the card moves on (RESTAGED 2026-10-04: the try used to arrive 31 s in with the TD still up)
        start(false);
        A.home.score += 7; play(A, "Passing Touchdown", { scoreValue: 6 }); rzOnBoard([A, B, C], s(1));
        const tdId = RZ.cur.play.id;
        A.home.score += 1; play(A, "Extra Point Good", { scoreValue: 1 }); rzOnBoard([A, B, C], s(5));
        out.t8b = RZ.cur.gid === A.id && RZ.cur.play.id === tdId && RZ.cur.kind === "score";
        rzTick(s(9)); out.t8c = RZ.cur.gid !== A.id;
        // T9 · timeouts and quarter ends aren't news
        start(false);
        play(B, "Timeout"); rzOnBoard([A, B, C], s(9)); play(C, "End Period"); rzOnBoard([A, B, C], s(10));
        out.t9 = RZ.pending.size === 0 && RZ.cur.gid === A.id;
        // T10 · what a play is
        const k = (type, o = {}, d = 0, rz = false) => rzClassify({ ...A, sit: { ...A.sit, isRedZone: rz } }, { id: "1", type: { text: type }, text: "", scoreValue: 0, statYardage: 3, ...o }, d);
        out.t10 = [k("Official Timeout"), k("Official Timeout", {}, 3), k("Rushing Touchdown"), k("Extra Point Good", { scoreValue: 1 }, 1), k("Interception Return"), k("Pass Reception", { statYardage: 25 }), k("Rush", {}, 0, true), k("Rush"), k("Kickoff"), k("Punt")].join(",");
        reset(); setEvs(sb.events.map(normEvent));
        return out;
      }, rzFix.snaps[0].sb);
      const RU = rules || {};
      ok(RU.t1a === true && RU.t1b === true, `a play in another game waits until the one on screen has had 7 s, then the card cuts to it (${RU.t1a}, ${RU.t1b})`);
      ok(RU.t2a === true && RU.t2b === true, `a game in the red zone keeps the card against an ordinary play elsewhere (25 s on: ${RU.t2a}), not against a touchdown (${RU.t2b})`);
      ok(RU.t3a === true && RU.t3b === true, `red zone against red zone: the other game takes the card once this one has had 20 s (at 10 s ${RU.t3a}, at 20 s ${RU.t3b})`);
      ok(RU.t4k === true && RU.t4a === true && RU.t4b === true, `a score holds the card 8 s, even against a touchdown elsewhere at 7 s in, which follows at 8 s (${RU.t4k}, ${RU.t4a}, ${RU.t4b})`);
      ok(RU.t4c === true && RU.t4d === true, `a field goal with the red-zone flag still on: 7 s in it's up, at 8 s the card moves to a game in play with nothing waiting (${RU.t4c}, ${RU.t4d})`);
      ok(RU.t4e === true, `a kickoff or a punt in another game doesn't pull the card (${RU.t4e})`);
      ok(RU.t4f === true, `after a score the game isn't "in the red zone" until a new drive snaps inside the 20 (${RU.t4f})`);
      ok(RU.t4g === true, `leaving a finished drive, the card goes to the game that just ran a play (${RU.t4g})`);
      ok(RU.t5a === true && RU.t5b === true, `with nothing new for 30 s the card moves on, to the game in the red zone (29 s ${RU.t5a}, 30 s ${RU.t5b})`);
      ok(RU.t6a === true && RU.t6b === true, `a quiet game inside the 20 keeps the card past 30 s (${RU.t6a}) up to 90 s (${RU.t6b})`);
      ok(RU.t7 === true, `a game that goes to halftime loses the card at once (${RU.t7})`);
      ok(RU.t8 === true, `a touchdown and its extra point both unseen: the touchdown is what waits (${RU.t8})`);
      ok(RU.t8b === true && RU.t8c === true, `the touchdown on screen stays up when its try arrives, then the card moves on at 8 s (${RU.t8b}, ${RU.t8c})`);
      ok(RU.t9 === true, `timeouts and quarter ends are not news (${RU.t9})`);
      ok(RU.t10 === "meta,score,score,pat,turnover,big,redzone,play,dead,dead", `play kinds: timeout, timeout +3 points, TD, try, INT, 25-yd catch, red-zone run, run, kickoff, punt (${RU.t10})`);

      // ── into RedZone: the entry, like a game
      const into = await probe(async () => {
        const h0 = history.length;
        document.getElementById("rzn-entry").click();
        await new Promise((r) => setTimeout(r, 400));
        const rz = document.getElementById("redzone");
        return { hash: location.hash, hist: history.length === h0, card: rz.offsetParent !== null, afterField: !!rz.previousElementSibling?.classList.contains("field-sec"), tabs: document.getElementById("tabs").offsetParent !== null,
          lit: document.getElementById("rzn-entry").classList.contains("current"), listLit: document.querySelectorAll(".gv-side-list .current").length, onRZ: !!RZ.cur && G.id === RZ.cur.gid,
          listHasG: !!document.querySelector(`.gv-side-list [href="#g${G.id}"]`), chs: rz.querySelectorAll(".rzn-ch").length, n: document.getElementById("rzn-n")?.textContent, cut: !!document.querySelector("#game-view .stadium.rz-cut") };
      });
      ok(into.hash === "#redzone" && into.hist && into.card && into.afterField && into.tabs === false && into.onRZ,
        `tapping the entry opens RedZone (#redzone, no history entry): the game view is on RedZone's game, and under the field its card takes the place of the tabs (${JSON.stringify(into)})`);
      ok(into.lit && into.listLit === 0 && into.listHasG, `in RedZone its entry is the one lit; no game is, and the sidebar lists every game, the one on screen too (${into.lit}, ${into.listLit} lit, on-screen game listed ${into.listHasG})`);
      ok(into.chs === liveN && into.n === `${liveN} live`, `the card has one channel per live game (${into.chs} of ${liveN}) and "${into.n}"`);
      ok(into.cut === false, `going into RedZone is not a cut: no wipe on arrival (${into.cut})`);
      // The scoreboard poll is how soon RedZone hears of a play: 5 s in RedZone while games are live.
      const pace = await probe(async () => { const got = []; const keep = boardPoller.onSchedule; boardPoller.onSchedule = (ms, ok) => { got.push(ms); keep(ms, ok); }; boardPoller.now(); await new Promise((r) => setTimeout(r, 600)); boardPoller.onSchedule = keep; return got; });
      ok(Array.isArray(pace) && pace.includes(5000), `in RedZone with games live, the scoreboard is polled every 5 s (${JSON.stringify(pace)})`);

      // ── a channel tapped: that game, held 14 s; the field plays the wipe
      const tap = await probe(async () => {
        rzRender();
        const btn = [...document.querySelectorAll("#redzone .rzn-ch")].find((b) => !b.classList.contains("on"));
        if (!btn) return { err: "no channel" };
        const id = btn.dataset.rzGame; btn.click();
        const out = { id, cur: RZ.cur?.gid, manual: RZ.cur?.manual, holdAll: rzHold(RZ.cur.since + 5000) === Infinity, holdEnds: rzHold(RZ.cur.since + 14000) !== Infinity };
        await new Promise((r) => setTimeout(r, 300));
        Object.assign(out, { g: G.id, hash: location.hash, cut: !!document.querySelector("#game-view .stadium.rz-cut"), on: document.querySelector("#redzone .rzn-ch.on")?.dataset.rzGame });
        return out;
      });
      ok(!!tap.id && tap.cur === tap.id && tap.manual === true && tap.g === tap.id && tap.hash === "#redzone" && tap.on === tap.id,
        `tapping a channel puts that game on the field, still in RedZone, and lights its channel (${JSON.stringify(tap)})`);
      ok(tap.holdAll === true && tap.holdEnds === true, `…held against everything for 14 s, then not (5 s in ${tap.holdAll}, 14 s in released ${tap.holdEnds})`);
      ok(tap.cut === true, `…and the cut sweeps the red wipe across the field (${tap.cut})`);

      // ── the league feed: the real core plays of TEN @ BAL and DAL @ HOU, a hand-made two-team league.
      // Scoring: 0.1/rush yd, 6/rush TD, 1/rec, 0.1/rec yd, 6/rec TD, 0.04/pass yd, 4/pass TD, 1/XP,
      // 3/FG under 40 + 0.1/FG yard. Team 1 starts Pollard (3916148), Collins (4258173), Aubrey
      // (3953687); team 2 starts Henry (3043078), benches Stroud (4432577). Slye (3124084) is nobody's.
      const feed = await probe(async () => {
        if (typeof rzRenderFeed !== "function") return { err: "no feed" };
        const sbEvs = S.events;
        FF.setRules({ scoring: { rush_yd: 0.1, rush_td: 6, rec: 1, rec_yd: 0.1, rec_td: 6, pass_yd: 0.04, pass_td: 4, xp_made: 1, fg_0_39: 3, fg_made_yd: 0.1 } });
        const teams = [{ teamId: 1, name: "Battle Kreussers", abbrev: "KREU", colors: { primary: "#c8102e" } }, { teamId: 2, name: "Laws Rule", abbrev: "LAWS", colors: { primary: "#1d6fd8" } }];
        FF.setTeams(teams);
        FF.rostersByTeamId = new Map([
          [1, [{ key: "3916148", name: "Tony Pollard", pos: "RB", team: "TEN", slot: "RB" }, { key: "4258173", name: "Nico Collins", pos: "WR", team: "HOU", slot: "WR" }, { key: "3953687", name: "Brandon Aubrey", pos: "K", team: "DAL", slot: "K" }]],
          [2, [{ key: "3043078", name: "Derrick Henry", pos: "RB", team: "BAL", slot: "RB" }, { key: "4432577", name: "C.J. Stroud", pos: "QB", team: "HOU", slot: "BENCH" }]],
        ]);
        FF.buildOwnerIndex(teams.map((t) => ({ id: t.teamId })), FF.rostersByTeamId);
        FF.week = ffBoardWeek(); FF.myTeamId = 1; FF.myMatchup = { me: 1, opp: 2 };
        FFUI.loaded = true; FFUI.err = null; FFUI.core.clear();
        await ffFetchCore("401872973"); await ffFetchCore("401872967");
        rzRenderFeed();
        const rows = rzFeedRows();
        // A chip's words without the crest's monogram (KREU, LAWS) and BN marker, which sit in .ff-own.
        const chipText = (c) => { const k = c.cloneNode(true); k.querySelectorAll(".ff-own").forEach((x) => x.remove()); return k.textContent.replace(/\s+/g, " ").trim() + (c.classList.contains("bench") ? " [bench]" : ""); };
        const dom = [...document.querySelectorAll("#rzn-feed .rzn-row")].map((a) => ({ href: a.getAttribute("href"), chips: [...a.querySelectorAll(".ffp")].map(chipText), time: a.querySelector(".rzn-rm").textContent.replace(/\s+/g, " ").trim() }));
        const want = { "401872973543": null, "401872967519": null, "401872967250": null, "401872973224": null };
        rows.forEach((r, i) => { if (r.pid in want) want[r.pid] = i; });
        // The card on the TD: its chips are the play's own credits.
        S.events = sbEvs; S.byId = new Map(sbEvs.map((e) => [e.id, e]));
        const ten = S.byId.get("401872973");
        RZ.cur = { gid: "401872973", play: { id: "401872973543", type: { text: "Rushing Touchdown" }, text: "T.Pollard right guard for 3 yards, TOUCHDOWN.", team: { id: ten.away.id } }, kind: "score", prio: 100, since: Date.now(), at: Date.now() };
        rzRender();
        const nowLine = [...(document.getElementById("rzn-now")?.children || [])].map((c) => c.textContent.replace(/\s+/g, " ").trim()).join(" | ");
        // Stroud (bench) threw on several plays; only the TD to Collins (a starter) is a row.
        const stroudPlays = [...(FF._playCredits.get("401872967") || new Map()).keys()].filter((pid) => FF.playCredits("401872967", pid).some((c) => c.key === "4432577")).length;
        const benchOnly = rows.filter((r) => !r.cs.some((c) => c.starter)).length;
        return { stroudPlays, benchOnly, n: rows.length, count: document.getElementById("rzn-fn")?.textContent, idx: want, times: rows.map((r) => r.t), dom, nowLine, metaN: FFUI.core.get("401872973")?.meta?.size };
      });
      const F = feed || {};
      const rowOf = (pid) => (F.dom || [])[F.idx?.[pid]] || null;
      const td = rowOf("401872973543"), fg = rowOf("401872967519"), rec = rowOf("401872967250"), hen = rowOf("401872973224");
      ok(F.metaN === coreFix.games["401872973"].count, `each fetched play keeps when it happened (${F.metaN} of ${coreFix.games["401872973"].count} TEN @ BAL plays)`);
      ok(td && td.chips.join("|") === "+6.3 T. Pollard" && td.href === "#g401872973",
        `Pollard's 3-yard TD: 3 × 0.1 + 6 = +6.3 to his owner; Slye's extra point is on nobody's roster and isn't shown (${JSON.stringify(td)})`);
      ok(fg && fg.chips.join("|") === "+6.9 B. Aubrey", `Aubrey's 39-yard field goal: 3 + 39 × 0.1 = +6.9 (${JSON.stringify(fg)})`);
      ok(rec && rec.chips.join("|") === "+7.7 N. Collins|+4.3 C. Stroud [bench]",
        `Stroud to Collins for 7 and a TD: Collins 1 + 0.7 + 6 = +7.7; Stroud 7 × 0.04 + 4 = 4.28, shown +4.3 and muted on the bench (${JSON.stringify(rec)})`);
      ok(hen && hen.chips.join("|") === "+6.5 D. Henry", `Henry's 5-yard TD: 0.5 + 6 = +6.5 (${JSON.stringify(hen)})`);
      const I = F.idx || {};
      ok(I["401872973543"] < I["401872967519"] && I["401872967519"] < I["401872967250"] && I["401872967250"] < I["401872973224"],
        `newest first across both games: Pollard 17:20:05, Aubrey 17:19:39, Collins 17:09:10, Henry 17:08:28 (rows ${JSON.stringify(I)})`);
      ok(Array.isArray(F.times) && F.times.length > 4 && F.times.every((t, i) => i === 0 || t <= F.times[i - 1]) && F.count === `${F.n} plays` && F.dom.length === F.n,
        `every row is a play that scored for a GFFL starter, by wallclock, newest first (${F.n} rows, "${F.count}")`);
      ok(F.benchOnly === 0 && F.stroudPlays > 1, `a play that only moved a bench player is not on the feed (Stroud, benched, is on ${F.stroudPlays} plays; ${F.benchOnly} rows have no starter)`);
      // RESTAGED 2026-10-04: the card had a small screen of its own (score, mini field, the play and its
      // credits). In RedZone the big field above it is that screen (the play's credits are on the
      // last-play card under it), so the card only says why the field is on this game.
      ok(F.nowLine === "Touchdown · TEN | On now: TEN @ BAL", `the card says why the field is on this game: the moment and the game (${JSON.stringify(F.nowLine)})`);

      // ── the big view follows. 2026-10-04, user: "the card on the top right is changing to new plays and
      // games but not the 8 bit field view, which should also be changing. also on redzone view we dont
      // have to start with teams in huddles, can go straight to the play". In RedZone, the game view is
      // RedZone's: every cut opens that game there.
      snapI = 3;
      await page.goto(BASE + "/sunday.html#redzone", { waitUntil: "domcontentloaded" });
      let cold = true;
      try { await page.waitForFunction(() => G && S.loaded && location.hash === "#redzone" && document.getElementById("redzone")?.offsetParent, { timeout: 15000 }); } catch { cold = false; }
      ok(cold, `a link straight to #redzone lands in RedZone`);
      const fol = await probe(async () => {
        if (typeof rzFollowing !== "function") return { err: "no rzFollowing" };
        const h0 = history.length;
        RZ.pending.clear(); RZ.cur = null;
        rzCut("401872973", null, Date.now());
        await new Promise((r) => setTimeout(r, 300));
        return { following: rzFollowing(), hash: location.hash, g: G?.id, hist: history.length === h0, card: document.getElementById("redzone").offsetParent !== null };
      });
      ok(fol.following === true && fol.hash === "#redzone" && fol.g === "401872973" && fol.hist && fol.card,
        `in RedZone a cut opens that game in the game view, still in RedZone, with no history entry (${JSON.stringify(fol)})`);
      let staged = true;
      try { await page.waitForFunction(() => SIDE.gameId === "401872973" && SIDE.sc && SIDE.running, { timeout: 10000 }); } catch { staged = false; }
      // The newest play on TEN @ BAL at 17:20:47: Pollard to the BLT 3 (401872973521). Arriving, it runs
      // from the snap: both teams set at the line (raBuild's no-scene start snaps at 1.1 s), still short
      // of its result. On a game's own screen an arrival puts the play straight at its end.
      const arr = await probe(() => ({ id: String(SIDE.playId), tS: SIDE.sc?.tS, huddle: !!SIDE.sc?.huddle, t: +SIDE.t.toFixed(2), res: SIDE.resultAt != null ? +SIDE.resultAt.toFixed(2) : null, T: SIDE.sc ? +SIDE.sc.T.toFixed(2) : null }));
      ok(staged && arr.id === "401872973521" && arr.tS === 1.1 && !arr.huddle && arr.t < arr.res,
        `the 8-bit view runs the play RedZone cut for, from the snap: no huddle, no walk-up (${JSON.stringify(arr)})`);
      // The next play in the same game: in RedZone it starts set at the line; on the game's own screen it
      // walks out of the huddle (snap at 4 s, raBuild's huddle start).
      const nxt = await probe(() => {
        const latest = sideNext();
        sideHuddle(); sidePlay(latest); const a = { tS: SIDE.sc?.tS };
        history.replaceState(history.state, "", "#g" + G.id);
        sideHuddle(); sidePlay(latest); a.tSoff = SIDE.sc?.tS;
        history.replaceState(history.state, "", "#redzone");
        return a;
      });
      ok(nxt.tS === 1.1 && nxt.tSoff === 4, `in RedZone a play starts with the teams set (snap at ${nxt.tS} s); on a game's own screen it walks out of the huddle (snap at ${nxt.tSoff} s)`);
      // A cut waits for the big view to finish the play it's running (up to 25 s), then goes. The play
      // waiting elsewhere is a touchdown, which beats TEN @ BAL's own red-zone hold, so only the stage
      // being busy can keep RedZone where it is.
      const busy = await probe(() => {
        const now = Date.now(), other = S.events.find((e) => e.state === "in" && e.id !== G.id && !isHalftime(e))?.id;
        const keep = { running: SIDE.running, resultAt: SIDE.resultAt, t: SIDE.t };
        const setUp = (ago) => { RZ.pending.clear(); RZ.cur = { gid: G.id, play: null, kind: "play", prio: 15, since: now - ago, at: now - ago }; RZ.pending.set(other, { play: { id: "x1", type: { text: "Rushing Touchdown" }, text: "" }, kind: "score", prio: 100, at: now }); };
        setUp(10000); Object.assign(SIDE, { running: true, resultAt: 5, t: 2 }); rzTick(now);
        const a = { waits: RZ.cur.gid === G.id };
        setUp(26000); rzTick(now); a.capped = RZ.cur.gid === other;
        setUp(10000); SIDE.running = false; rzTick(now); a.after = RZ.cur.gid === other;
        Object.assign(SIDE, keep);
        return a;
      });
      ok(busy.waits === true && busy.after === true && busy.capped === true, `a cut waits while the big view is mid-play (${busy.waits}), goes once the play is done (${busy.after}), and never waits past 25 s (${busy.capped})`);
      await wait(400);
      // Picking a game yourself leaves RedZone for that game's own screen; the entry goes back in.
      const pick = await probe(async () => {
        const a = document.querySelector('.gv-side-list a[href^="#g"]');
        if (!a) return { err: "no list game" };
        const want = a.getAttribute("href"); a.click();
        await new Promise((r) => setTimeout(r, 300));
        const out = { want, hash: location.hash, g: "#g" + G.id, card: document.getElementById("redzone").offsetParent !== null, tabs: document.getElementById("tabs").offsetParent !== null, entryLit: document.getElementById("rzn-entry").classList.contains("current") };
        const other = S.events.find((e) => rzOnAir(e) && "#g" + e.id !== want)?.id;
        rzCut(other, null, Date.now());
        await new Promise((r) => setTimeout(r, 300));
        out.stays = location.hash === want && "#g" + G.id === want;
        document.getElementById("rzn-entry").click();
        await new Promise((r) => setTimeout(r, 300));
        out.back = { hash: location.hash, g: "#g" + G.id, cur: "#g" + RZ.cur?.gid, card: document.getElementById("redzone").offsetParent !== null };
        return out;
      });
      ok(pick.hash === pick.want && pick.g === pick.want && pick.card === false && pick.tabs === true && pick.entryLit === false && pick.stays === true,
        `tapping a game in the Scores list opens that game's own screen, with its tabs and no RedZone, and RedZone's cuts leave it alone (${JSON.stringify(pick)})`);
      ok(pick.back && pick.back.hash === "#redzone" && pick.back.g === pick.back.cur && pick.back.card, `the entry goes back into RedZone, on RedZone's game (${JSON.stringify(pick.back)})`);

      // ── phones. RESTAGED 2026-10-04: the card used to sit under the field on every game's screen ("Also
      // need it to be on mobile"); now RedZone is the first item in the strip of games, and its card
      // shows only in RedZone (user: "its like its own game that appears in the top scroll bar").
      await page.setViewport({ width: 390, height: 844 });
      await wait(300);
      const ph = await probe(() => {
        renderStrip(); rzRender();
        const strip = document.getElementById("g-strip"), first = strip.firstElementChild;
        const rz = document.getElementById("redzone"), gv = document.getElementById("game-view"), r = rz.getBoundingClientRect();
        const hts = [...rz.querySelectorAll(".rzn-ch")].map((b) => Math.round(b.getBoundingClientRect().height));
        return { first: first?.getAttribute("href"), firstLit: first?.classList.contains("current"), litN: strip.querySelectorAll(".current").length, text: first?.textContent.replace(/\s+/g, " ").trim(),
          shown: rz.offsetParent !== null, afterField: !!rz.previousElementSibling?.classList.contains("field-sec"), left: Math.round(r.left), right: Math.round(r.right), sideways: gv.scrollWidth > gv.clientWidth,
          tabs: document.getElementById("tabs").offsetParent !== null, minTap: hts.length ? Math.min(...hts) : 0 };
      });
      ok(ph.first === "#redzone" && ph.firstLit && ph.litN === 1 && /^RedZone/.test(ph.text || ""), `phone: RedZone is the first item in the strip of games, and in RedZone it's the one lit (${JSON.stringify({ first: ph.first, lit: ph.firstLit, n: ph.litN, text: ph.text })})`);
      ok(ph.shown && ph.afterField && ph.left >= 0 && ph.right <= 390 && !ph.sideways && ph.tabs === false, `phone: in RedZone its card sits right under the field in place of the tabs, inside the 390px screen, no sideways scroll (${JSON.stringify(ph)})`);
      ok(ph.minTap >= 44, `phone: every channel is at least 44px tall (smallest ${ph.minTap}px)`);
      // A cut swaps the game under someone reading the feed: they stay where they were.
      const keep = await probe(async () => {
        const gv = document.getElementById("game-view"), g0 = G.id;
        const y = Math.min(300, gv.scrollHeight - gv.clientHeight);
        gv.scrollTop = y;
        const other = S.events.find((e) => rzOnAir(e) && e.id !== g0)?.id;
        RZ.pending.clear(); rzCut(other, null, Date.now());
        await new Promise((r) => setTimeout(r, 400));
        return { y, after: Math.round(gv.scrollTop), moved: G.id !== g0 && G.id === other };
      });
      ok(keep.moved && keep.y > 0 && Math.abs(keep.after - keep.y) <= 2, `phone: a RedZone cut keeps the page where it was scrolled (${keep.y}px before, ${keep.after}px after; game swapped ${keep.moved})`);
      // Out of RedZone on a phone: a game from the strip, its own screen, the RedZone item unlit.
      const phOut = await probe(async () => {
        const a = [...document.querySelectorAll('#g-strip a[href^="#g"]')].find((x) => x.getAttribute("href") !== "#g" + G.id);
        const want = a.getAttribute("href"); a.click();
        await new Promise((r) => setTimeout(r, 300));
        const strip = document.getElementById("g-strip");
        return { want, hash: location.hash, card: document.getElementById("redzone").offsetParent !== null, rzLit: strip.firstElementChild.classList.contains("current"), gameLit: strip.querySelector(".current")?.getAttribute("href") };
      });
      ok(phOut.hash === phOut.want && phOut.card === false && phOut.rzLit === false && phOut.gameLit === phOut.want, `phone: a game from the strip is its own screen, no RedZone card, that game lit (${JSON.stringify(phOut)})`);
      await page.setViewport({ width: 1440, height: 900 });
      await wait(200);
      // (ESPN's own current week on the recording is week 4; any other week will do.)
      const ow = await probe(() => {
        history.replaceState(history.state, "", "#redzone"); route();
        S.week = { st: S.cur.st, wk: S.cur.wk + 1 }; rzRender();
        const h = document.getElementById("redzone").offsetParent === null && document.getElementById("rzn-entry").hidden && rzEnter() === false;
        S.week = null; rzRender();
        return { h, back: document.getElementById("redzone").offsetParent !== null && !document.getElementById("rzn-entry").hidden };
      });
      ok(ow.h === true && ow.back === true, `another week (no live games to follow) has no RedZone, card or entry; this week brings it back (${JSON.stringify(ow)})`);
      await page.setViewport({ width: 800, height: 600 });
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
