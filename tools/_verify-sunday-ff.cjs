// tools/_verify-sunday-ff.cjs — verification for Sunday's fantasy-scoring engine
// (assets/sunday/sd-fantasy.js).
//
//   node tools/_verify-sunday-ff.cjs
//
// Entirely offline: every fixture under tools/fixtures/sunday-ff/ was captured live on
// 2026-09-27 (ESPN's public site + core APIs, and read-only Firestore GETs against the real
// GFFL league) and is used as-is — no fixture here is kinder than what the real feeds returned.
//
//   Section A — hand-computed arithmetic on real ATL @ GB (2026 week 3, event 401872948)
//               players: Jordan Love, Christian Watson, Bijan Robinson, both kickers, both
//               D/STs. Each check's own comment shows the arithmetic against the LIVE scoring
//               table (tools/fixtures/sunday-ff/fs-settings.json).
//   Section B — the invariant: for every one of the 67 players who touched that game, the SUM
//               of FF.ingestPlays' per-play credits (the core-API path) equals FF.ingestSummary's
//               box-derived total (the site-API path), within 0.01 — except one NAMED,
//               EXPLAINED gap (dst_blk), which gets its own positive assertion instead of being
//               swept into the tolerance.
//   Section C — ownership: dst_WAS resolves from ESPN's WSH; a slp_ key resolves by normalized
//               name + NFL team; starters vs bench; a real production roster's dst_ key
//               (dst_PIT, from the week-3 fixture) resolves too.
//   Section D — reconciliation against GFFL's own finalized weekly_2026_w1/w2 totals (the
//               strongest check) — delegates to tools/_sunday_reconcile.mjs so there is exactly
//               ONE implementation of "how to reconcile a week," and asserts every team-week
//               diff is either ~0 or the one already-named exception.
//   Section F — the live-preview findings: board keying (WSH/WAS), projected finish, stat
//               lines, the Sleeper projection fallback, the loader end to end, play corrections.
//   Section E — proof of bite: a deliberately-broken copy of the engine (FG distance credit
//               disabled) is loaded in isolation and shown to fail Section A's kicker checks;
//               the real module is then reconfirmed green.
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const FIX = path.join(__dirname, "fixtures", "sunday-ff");
// SUNDAY_FF_ENGINE lets a bite run point the suite at a deliberately broken copy.
const ENGINE_PATH = process.env.SUNDAY_FF_ENGINE || path.join(ROOT, "assets", "sunday", "sd-fantasy.js");

let pass = 0, fail = 0; const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; failures.push(msg); console.log("  ✗ " + msg); }
}
function near(a, b, tol) { return a != null && b != null && Math.abs(a - b) <= (tol == null ? 0.01 : tol); }
function section(name) { console.log("\n== " + name + " =="); }

// ---------------------------------------------------------------------------------------------
// Firestore REST decode (test-side twin of the one in sd-fantasy.js's loader — small, and the
// house convention is to duplicate rather than share, same as the engine itself does).
function fsDec(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return !!v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsDec);
  if ("mapValue" in v) { const o = {}; for (const k in (v.mapValue.fields || {})) o[k] = fsDec(v.mapValue.fields[k]); return o; }
  return null;
}
function readFsDoc(p) { const raw = JSON.parse(fs.readFileSync(p, "utf8")); const doc = {}; for (const k in raw.fields) doc[k] = fsDec(raw.fields[k]); return doc; }
function readJSON(p) { return JSON.parse(fs.readFileSync(path.join(FIX, p), "utf8")); }

const FF = require(ENGINE_PATH);
const settings = readFsDoc(path.join(FIX, "fs-settings.json"));
FF.setRules(settings.rules);

const EVENT = "401872948"; // ATL @ GB, 2026 week 3 — final ATL 35, GB 14
const summary = readJSON("atl-gb-w3-summary.json");
const corePlays = readJSON("atl-gb-w3-core-plays.json");

FF.resetGames();
const box = FF.ingestSummary(EVENT, summary);
const running = FF.ingestPlays(EVENT, corePlays.items);

// =================================================================================================
section("A — hand-computed arithmetic (ATL @ GB, event " + EVENT + ")");
// =================================================================================================
// Live scoring coefficients actually exercised below (read from the fixture, not hardcoded here —
// printed so a reviewer can check the arithmetic against the same numbers the engine used):
//   pass_yd .04  pass_td 4  pass_int -2  bonus_pass_300 3  bonus_pass_400 4
//   rush_yd .1   rush_td 6  bonus_rush_100 3  bonus_rush_200 4
//   rec .5  rec_yd .1  rec_td 6
//   fg_made_yd .1  fg_miss -1  xp_made 1  (every fg_0_39/40_49/50 bucket is 0 — a made FG scores
//   purely on distance × .1, never on the bucket)
//   dst_sack 1  dst_int 2  dst_pa_* all 0
{
  const sc = settings.rules.scoring;
  ok(sc.pass_yd === 0.04 && sc.rec === 0.5 && sc.fg_made_yd === 0.1 && sc.dst_pa_14_17 === 0,
    "live scoring table matches the coefficients every hand-check below assumes");

  function line(name) { for (const [, v] of box) if (v.meta.name === name) return v; return null; }

  // Jordan Love: 28/53, 312 yds, 2 TD, 1 INT (box). 312*.04=12.48; 2*4=8; 1*-2=-2;
  // 312 is in [300,400) -> bonus_pass_300=3. Total = 12.48+8-2+3 = 21.48.
  ok(near(line("Jordan Love").pts, 21.48), "Jordan Love: 312 pass yd, 2 pass TD, 1 INT, 300-yd bonus -> 21.48 (got " + line("Jordan Love").pts + ")");

  // Christian Watson: 7 rec, 96 yds, 1 TD. 7*.5=3.5; 96*.1=9.6; 1*6=6. 96<100, no rec bonus.
  // Total = 3.5+9.6+6 = 19.1.
  ok(near(line("Christian Watson").pts, 19.1), "Christian Watson: 7 rec, 96 yd, 1 TD -> 19.1 (got " + line("Christian Watson").pts + ")");

  // Bijan Robinson: 29 car, 194 yd, 2 rush TD; 2 rec, 19 yd, 0 TD. 194*.1=19.4; 2*6=12;
  // 194 in [100,200) -> bonus_rush_100=3; 2*.5=1; 19*.1=1.9. Total = 19.4+12+3+1+1.9 = 37.3.
  ok(near(line("Bijan Robinson").pts, 37.3), "Bijan Robinson: 194 rush yd, 2 rush TD, 2 rec/19 yd -> 37.3 (got " + line("Bijan Robinson").pts + ")");

  // Nick Folk (ATL K): 2/2 FG (44, 31 yd — from scoringPlays text), 3/3 XP.
  // (44+31)*.1=7.5; 3*1=3. Total = 10.5. No fg_miss, so bucket counts (all coefficient 0) don't matter.
  ok(near(line("Nick Folk").pts, 10.5), "Nick Folk: FG 44+31 yd, 3/3 XP -> 10.5 (got " + line("Nick Folk").pts + ")");

  // Trey Smack (GB K): 0/1 FG (missed/blocked), 2/2 XP. 1*-1=-1; 2*1=2. Total = 1.0.
  ok(near(line("Trey Smack").pts, 1.0), "Trey Smack: 0/1 FG, 2/2 XP -> 1.0 (got " + line("Trey Smack").pts + ")");

  // dst_ATL (ATL's D faced GB's offense): GB's box shows 1 sack allowed (1-1), 1 INT thrown
  // (Xavier Watts, credited to ATL), 0 fumbles lost, GB scored 14 (points-allowed bracket
  // dst_pa_14_17 = 0). 1*1 + 1*2 + 0 = 3.0.
  const dstAtl = box.get("dst_ATL");
  ok(near(dstAtl.pts, 3.0), "dst_ATL: 1 sack, 1 INT, 14 PA (0-rate bracket) -> 3.0 (got " + dstAtl.pts + ")");

  // dst_GB (GB's D faced ATL's offense): ATL's box shows 0 sacks allowed (0-0), 1 INT thrown
  // (Xavier McKinney, credited to GB), 0 fumbles lost, ATL scored 35 (dst_pa_35_45 = 0).
  // 0*1 + 1*2 + 0 = 2.0.
  const dstGb = box.get("dst_GB");
  ok(near(dstGb.pts, 2.0), "dst_GB: 0 sacks, 1 INT, 35 PA (0-rate bracket) -> 2.0 (got " + dstGb.pts + ")");

  // Cross-check via FF.playCredits: the Watson TD play (401872948682) should itself account for
  // Watson's TD slice (rec 1 + rec_yd 4 + rec_td 1 = .5+.4+6 = 6.9), Love's TD slice
  // (pass_yd 4 + pass_td 1 = .16+4 = 4.16), and Smack's XP (1.0) — three separate credited keys
  // off ONE play id, proving playCredits groups by athlete rather than flattening the play.
  const tdCredits = FF.playCredits(EVENT, "401872948682");
  const byName = new Map(tdCredits.map((c) => [c.name, c]));
  ok(tdCredits.length === 3, "the Watson TD play credits exactly 3 players (got " + tdCredits.length + ")");
  ok(near(byName.get("Christian Watson")?.pts, 6.9), "playCredits: Watson's slice of that play is 6.9 (got " + byName.get("Christian Watson")?.pts + ")");
  ok(near(byName.get("Jordan Love")?.pts, 4.16), "playCredits: Love's slice of that play is 4.16 (got " + byName.get("Jordan Love")?.pts + ")");
  ok(near(byName.get("Trey Smack")?.pts, 1.0), "playCredits: Smack's XP slice of that play is 1.0 (got " + byName.get("Trey Smack")?.pts + ")");
}

// =================================================================================================
section("B — invariant: sum(per-play credits) == box total, for every player in the game");
// =================================================================================================
{
  const KNOWN_GAP = new Set(["dst_ATL"]); // see the named explanation below
  let checked = 0, agree = 0;
  for (const [key, rec] of box) {
    if (KNOWN_GAP.has(key)) continue;
    const rstat = running.get(key) || FF.emptyStat();
    const rpts = FF.score(rstat);
    checked++;
    if (near(rpts, rec.pts)) agree++;
    else failures.push(`invariant: ${key} (${rec.meta.name}) box=${rec.pts} plays=${rpts}`);
  }
  ok(agree === checked, `${agree}/${checked} players: per-play credit sum equals the box total within 0.01`);

  // The one named gap: ESPN's SITE summary has no field anywhere (team stats or scoringPlays,
  // which only ever lists SCORES, and a blocked-but-not-returned kick is not a score) that says
  // a kick was blocked — deriveEspnDst simply cannot see it, box dst_blk is always 0 for a
  // block with no return. The CORE-API play-by-play (creditCorePlay) DOES see it, via the
  // `blocker` participant on Trey Smack's blocked 47-yard attempt. That is a real, positive
  // capability of the play-by-play path the box-only path lacks — not a bug to reconcile away.
  ok(box.get("dst_ATL").stats.dst_blk === 0, "box-derived dst_ATL.dst_blk is 0 (ESPN's site summary has no blocked-kick field to derive it from)");
  ok((running.get("dst_ATL") || {}).dst_blk === 1, "play-derived dst_ATL.dst_blk is 1 (creditCorePlay saw the blocker on T.Smack's blocked FG that the box path cannot)");
}

// =================================================================================================
section("C — ownership: dst_<ABBR>, slp_ name+team resolution, starters vs bench");
// =================================================================================================
{
  const own = readJSON("ownership-sample.json");
  const rostersByTeamId = new Map(Object.entries(own.rosters).map(([k, v]) => [Number(k), v]));
  FF.buildOwnerIndex(own.teams, rostersByTeamId);

  ok(FF.ownerOfDst("WSH") !== null && FF.ownerOfDst("WSH").teamId === 101,
    "ownerOfDst('WSH') resolves the roster's dst_WAS key (ESPN's WSH -> Sleeper's WAS)");
  ok(FF.ownerOfDst("WSH").starter === true, "the DST slot counts as a starter, not bench");

  const slpHit = FF.ownerOfAthlete("7777001", { name: "Fixture Only Player", nflAbbr: "KC" });
  ok(slpHit !== null && slpHit.key === "slp_9999901", "ownerOfAthlete resolves a slp_ key by normalized name + NFL team when the ESPN id itself isn't on any roster");
  ok(slpHit.starter === true, "the resolved slp_ player is flagged a starter (roster slot WR, not BENCH/IR)");

  const benchHit = FF.ownerOfAthlete("9999");
  ok(benchHit !== null && benchHit.starter === false, "a BENCH-slotted player resolves but is NOT flagged a starter");
  const irHit = FF.ownerOfAthlete("9998");
  ok(irHit !== null && irHit.starter === false, "an IR-slotted player resolves but is NOT flagged a starter");

  // Same check against a REAL production roster doc (team 1, week 3 — the roster fixture the
  // reconciliation section also reads), proving this isn't only a synthetic-fixture behavior.
  const realRoster = readFsDoc(path.join(FIX, "fs-roster-2026-w3-t1.json"));
  const rosters2 = new Map([[1, realRoster.players]]);
  FF.buildOwnerIndex([{ id: 1 }], rosters2);
  ok(FF.ownerOfDst("PIT") !== null && FF.ownerOfDst("PIT").teamId === 1, "a REAL roster's dst_PIT key resolves via ownerOfDst('PIT') (team 1's actual week-3 roster)");
}

// =================================================================================================
section("D — reconciliation against GFFL's real 2026 weekly finals (weeks 1 and 2)");
// =================================================================================================
{
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, "_sunday_reconcile.mjs")], { encoding: "utf8" });
  } catch (e) {
    out = (e.stdout || "") + (e.stderr || "");
    code = e.status || 1;
  }
  console.log(out.split("\n").map((l) => "    " + l).join("\n"));
  ok(code === 0, "tools/_sunday_reconcile.mjs exits 0 (every team-week diff is ~0 or a named, explained exception)");
  ok(/RECONCILED/.test(out), "reconcile script reports RECONCILED, not FAILED");
}

// =================================================================================================
section("E — proof of bite: break FG-distance credit, watch Section A's kicker checks fail");
// =================================================================================================
{
  // A deliberately-broken COPY of the engine — the FG branch of creditCorePlay is patched to
  // never add fg_made_yd (as if someone "simplified" it to only track make/miss counts, the
  // exact kind of regression this check exists to catch) — loaded from a throwaway temp path so
  // require()'s module cache never collides with the real, already-loaded ENGINE_PATH. The
  // fg_0_39/40_49/50 buckets stay untouched (they're worth 0 either way in this league, so a
  // broken-bucket regression wouldn't show up in points at all — distance-based fg_made_yd is
  // the ONLY thing that actually pays in this league's rules, which is exactly why it's the one
  // this check breaks).
  // Section A's kicker checks are box-derived (FF.ingestSummary -> applyScoringPlays), so that
  // is the path this patches — breaking creditCorePlay's OWN fg_made_yd line (the play-by-play
  // path) would prove nothing about the box-derived numbers Section A actually asserts on.
  const src = fs.readFileSync(ENGINE_PATH, "utf8");
  const marker = "rec.stats.fg_made_yd = (d.yds || 0) + Math.max(0, made - seen) * 33;";
  if (!src.includes(marker)) {
    fail++; failures.push("proof-of-bite: the FG-distance line this check patches has moved or changed — update the marker");
    console.log("  ✗ could not locate the FG-distance line to patch (marker out of date)");
  } else {
    const broken = src.replace(marker, "rec.stats.fg_made_yd = 0; /* PATCHED: FG distance credit disabled */");
    const tmp = path.join(require("os").tmpdir(), "sd-fantasy.BROKEN." + process.pid + ".js");
    fs.writeFileSync(tmp, broken);
    delete require.cache[tmp];
    let BROKEN_FF;
    try {
      BROKEN_FF = require(tmp);
      BROKEN_FF.setRules(settings.rules);
      BROKEN_FF.resetGames();
      const bBox = BROKEN_FF.ingestSummary(EVENT, summary);
      let folkPts = null;
      for (const [, v] of bBox) if (v.meta.name === "Nick Folk") folkPts = v.pts;
      ok(!near(folkPts, 10.5), "BROKEN engine: Nick Folk's points now DIFFER from the hand-computed 10.5 (got " + folkPts + ") — the check bites");
      ok(near(folkPts, 3.0), "BROKEN engine: with fg_made_yd zeroed, Folk scores only his 3 XP -> 3.0 (got " + folkPts + ")");
    } finally {
      try { fs.unlinkSync(tmp); } catch (e) { /* best-effort cleanup */ }
    }

    // The REAL module (already loaded at the top of this file, untouched) still gives the right
    // answer — the break was isolated to the throwaway copy, never the file under test.
    const realLine = (() => { for (const [, v] of box) if (v.meta.name === "Nick Folk") return v; })();
    ok(near(realLine.pts, 10.5), "the REAL engine (unpatched) still scores Nick Folk at 10.5 — restored/never touched");
  }
}

// =================================================================================================
// Section F — the live-page findings (2026-09-27 preview against the real week-3 slate). Each
// check below failed, or would have, before its fix; the comment at each says what was on screen.
async function sectionF() {
  section("F — live board, projections, stat lines, Sleeper fallback, loader, play corrections");
  const scoring = settings.rules.scoring;

  // F1 — board keying. ESPN calls Washington WSH; roster docs (Sleeper abbreviations) say WAS.
  // ingestBoard used to key its game map by the ESPN abbreviation while every reader looked up
  // by slpTeam(p.team), so on 2026-09-27 (SEA @ WSH) every Washington starter read "pre" all day.
  FF.resetGames();
  FF.setTeams([{ teamId: 1, name: "A" }, { teamId: 2, name: "B" }]);
  FF.setSchedule(3, [[1, 2]]);
  const rosterA = [
    { key: "16800", name: "Terry McLaurin", pos: "WR", team: "WAS", slot: "WR" },   // WAS, live
    { key: "4430807", name: "Bijan Robinson", pos: "RB", team: "ATL", slot: "RB" },  // final game
    { key: "dst_PIT", name: "Steelers D/ST", pos: "DST", team: "PIT", slot: "DST" }, // bye on this board
  ];
  FF.rostersByTeamId = new Map([[1, rosterA], [2, []]]);
  FF.buildOwnerIndex([{ id: 1 }, { id: 2 }], FF.rostersByTeamId);
  FF.ingestBoard([
    { id: "e1", state: "in", period: 2, clock: "7:30", home: { abbr: "WSH" }, away: { abbr: "SEA" } },
    { id: EVENT, state: "post", period: 4, clock: "0:00", home: { abbr: "GB" }, away: { abbr: "ATL" } },
  ]);
  const byName = (sc, n) => sc.starters.find((r) => r.name === n);
  let sc = FF.teamScore(1);
  ok(byName(sc, "Terry McLaurin").state === "in", "F1 a WAS roster player finds ESPN's WSH game on the board (state 'in', was 'pre')");
  ok(byName(sc, "Steelers D/ST").state === "bye", "F1 a team with no game on a loaded board reads 'bye', not 'pre'");

  // F2 — projected finish. teamScore.proj used to add each starter's PREGAME projection even
  // after his game ended, so the win odds ignored what had already happened.
  FF.ingestSummary(EVENT, summary);
  FF.projByKey = new Map([["4430807", 18], ["16800", 10]]);
  sc = FF.teamScore(1);
  // Bijan's game is final: his projected finish is what he scored, 37.3 (Section A), not 18.
  ok(near(byName(sc, "Bijan Robinson").proj, 37.3), "F2 a final game's starter projects to his actual points (37.3), not his pregame 18 (got " + byName(sc, "Bijan Robinson").proj + ")");
  // McLaurin: 0 so far, Q2 7:30 left -> minutes left = (4-2)*15 + 7.5 = 37.5 of 60 -> 0.625;
  // 0 + 10 × 0.625 = 6.25.
  ok(near(byName(sc, "Terry McLaurin").proj, 6.25), "F2 a live starter projects pts + proj × clock left: 0 + 10 × 37.5/60 = 6.25 (got " + byName(sc, "Terry McLaurin").proj + ")");
  const rem = FF.remaining(rosterA.map((p) => p.key));
  ok(rem.left === 0 && rem.playing === 1 && rem.done === 2, "F2 remaining(): bye and final both count done, live counts playing (" + JSON.stringify(rem) + ")");

  // F3 — stat lines. ESPN's site box carries no position on its athletes, and lineFor switched on
  // position, so every non-D/ST player's line was "" and the Fantasy tab said "No stats yet"
  // beside Bijan's 37.3. Expected lines read straight off the fixture's box score.
  const boxNow = FF._gameBox.get(EVENT);
  ok(boxNow.get("4430807").line === "29 car, 194 yds, 2 TD · 2 rec, 19 yds", "F3 Bijan's line: " + JSON.stringify(boxNow.get("4430807").line));
  ok(boxNow.get("4036378").line === "28/53 pass, 312 yds, 2 TD, 1 INT · 1 car, 0 yds", "F3 Jordan Love's line: " + JSON.stringify(boxNow.get("4036378").line));
  ok(boxNow.get("10621").line === "2/2 FG, 3/3 XP", "F3 Nick Folk's line: " + JSON.stringify(boxNow.get("10621").line));

  // F4 — Sleeper projection fallback, real rows from api.sleeper.com week 3 (fixture). The
  // proj_ doc skips D/STs, slp_ keys and (week 3) several QBs and kickers; with no fallback they
  // projected 0 and the header read "15% to win" for an even matchup. Hand-scored, live table:
  const slp = readJSON("sleeper-proj-w3-sample.json");
  FF.projByKey = new Map();
  FF.rostersByTeamId = new Map([[1, [
    { key: "slp_7839", name: "Evan McPherson", pos: "K", team: "CIN", slot: "K" },
    { key: "5005", name: "Tyler Shough", pos: "QB", team: "NO", slot: "QB" },
    { key: "dst_PIT", name: "Steelers D/ST", pos: "DST", team: "PIT", slot: "DST" },
    { key: "dst_WAS", name: "Commanders D/ST", pos: "DST", team: "WAS", slot: "BENCH" },
  ]]]);
  FF.buildOwnerIndex([{ id: 1 }], FF.rostersByTeamId);
  FF.setSleeperProj(slp);
  // PIT DEF: sack 2.39×1 + int 0.74×2 + fum_rec 0.51×1 + def_td 0.11×6 + ff 0.68×1 + blk 0.06×3
  //        = 2.39 + 1.48 + 0.51 + 0.66 + 0.68 + 0.18 = 5.90 (points allowed pay 0 here)
  ok(near(FF.projFor("dst_PIT"), 5.90), "F4 dst_PIT from Sleeper DEF row = 5.90 (got " + FF.projFor("dst_PIT") + ")");
  // WAS DEF (Sleeper id "WAS"): 2.41 + 0.62×2 + 0.43 + 0.06×6 + 0.56 + 0.06×3 = 2.41+1.24+0.43+0.36+0.56+0.18 = 5.18
  ok(near(FF.projFor("dst_WAS"), 5.18), "F4 dst_WAS = 5.18 (got " + FF.projFor("dst_WAS") + ")");
  // McPherson (slp_ key, by name+team): fgm_yds 59.19×0.1 + xpm 2.47×1 = 5.919 + 2.47 = 8.389
  ok(near(FF.projFor("slp_7839"), 8.39), "F4 slp_7839 Evan McPherson by name+team = 8.39 (got " + FF.projFor("slp_7839") + ")");
  // Shough: 239.85×.04 + 1.56×4 − 0.52×2 + 0.07×2 + 17.94×.1 + 0.25×6 + 0.01×2 − 0.19×2
  //       = 9.594 + 6.24 − 1.04 + 0.14 + 1.794 + 1.5 + 0.02 − 0.38 = 17.868
  ok(near(FF.projFor("5005"), 17.87), "F4 Tyler Shough (ESPN key absent from proj_ doc) by name+team = 17.87 (got " + FF.projFor("5005") + ")");
  FF.projByKey = new Map([["5005", 21]]);
  ok(FF.projFor("5005") === 21, "F4 the proj_ doc still wins over Sleeper when it has the player");

  // F5 — the loader, end to end against a fake fetch serving the real Firestore fixtures. It
  // must read the adjusted `p` (lg-data.js D.projFor reads hit.p), not the baseline `b`, and it
  // must not wait on Sleeper's 2MB projections before announcing "loaded".
  const docs = {
    settings: path.join(FIX, "fs-settings.json"),
    sched_2026: path.join(FIX, "fs-sched-2026.json"),
    roster_2026_w3_t1: path.join(FIX, "fs-roster-2026-w3-t1.json"),
  };
  let slpResolve;
  const slpGate = new Promise((r) => { slpResolve = r; });
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const fakeFetch = async (url, init) => {
    if (/documents:runQuery/.test(url)) return res(200, readJSON("fs-teams.json"));
    if (/api\.sleeper\.com\/projections/.test(url)) { await slpGate; return res(200, slp); }
    const id = decodeURIComponent((url.match(/gffl_fam2jan2g\/([^?]+)/) || [])[1] || "");
    if (id === "proj_2026_w3") return res(200, { fields: { players: { mapValue: { fields: { "4430807": { mapValue: { fields: { b: { doubleValue: 14.1 }, p: { doubleValue: 16.4 } } } } } } } } });
    if (docs[id]) return res(200, JSON.parse(fs.readFileSync(docs[id], "utf8")));
    return res(404, { error: { code: 404, status: "NOT_FOUND" } });
  };
  let loadedAt = null;
  FF.onChange((w) => { if (w && w.type === "loaded" && loadedAt == null) loadedAt = Date.now(); });
  // Sleeper is held until after this check: a loader that waits on it never resolves, so race it.
  const loadP = FF.load({ week: 3, teamId: 1, fetch: fakeFetch });
  const settled = await Promise.race([loadP.then(() => true), new Promise((r) => setTimeout(() => r(false), 3000))]);
  ok(settled && loadedAt != null, "F5 FF.load resolves and fires 'loaded' while Sleeper's projections are still in flight");
  if (!settled) { slpResolve(); await loadP; }
  ok(FF.projFor("4430807") === 16.4, "F5 proj_ doc: the adjusted p (16.4) is used, not the baseline b (14.1) (got " + FF.projFor("4430807") + ")");
  ok(FF.myMatchup && FF.myMatchup.me === 1 && FF.myMatchup.opp === 9, "F5 week-3 schedule fixture: team 1 plays team 9 (" + JSON.stringify(FF.myMatchup) + ")");
  ok((FF.rostersByTeamId.get(1) || []).length === 21 && (FF.rostersByTeamId.get(2) || []).length === 0, "F5 rosters: t1 from its week-3 doc (21 players); a team with no doc at any week is empty, not an error");
  ok(FF.projFor("dst_PIT") == null, "F5 before Sleeper answers, dst_PIT has no projection yet");
  slpResolve();
  await new Promise((r) => setTimeout(r, 20));
  ok(near(FF.projFor("dst_PIT"), 5.90), "F5 once Sleeper answers, dst_PIT picks up its 5.90 (got " + FF.projFor("dst_PIT") + ")");

  // F6 — a live play rewritten after it first appeared (review, added penalty). ingestPlays is
  // idempotent by play id, so without forgetPlay the corrected version was skipped forever.
  FF.resetGames();
  FF.ingestSummary(EVENT, summary);
  const td = corePlays.items.find((p) => /C\.Watson for 4 yards, TOUCHDOWN/.test(p.text));
  FF.ingestPlays(EVENT, [td]);
  const before = FF.playCredits(EVENT, td.id).find((c) => c.name === "Christian Watson");
  const nulled = { ...td, text: td.text + " PENALTY on GB, Offensive Holding, 10 yards - No Play." };
  FF.ingestPlays(EVENT, [nulled]);
  const stillOld = FF.playCredits(EVENT, td.id).length;
  FF.forgetPlay(EVENT, td.id);
  FF.ingestPlays(EVENT, [nulled]);
  const run = FF._runningStats.get(EVENT).get("4248528");
  // Watson on the TD: rec 0.5 + 4 yds × 0.1 + TD 6 = 6.9; after the No Play rewrite, nothing.
  ok(before && near(before.pts, 6.9), "F6 the original TD credits Watson +6.9 (0.5 + 0.4 + 6)");
  ok(stillOld > 0, "F6 re-ingesting the rewritten play WITHOUT forgetPlay keeps the stale credit (why forgetPlay exists)");
  ok(FF.playCredits(EVENT, td.id).length === 0 && run && run.rec === 0 && run.rec_td === 0, "F6 after forgetPlay the No Play version credits nothing and the running totals are unwound");
  // …and a second review that restores the touchdown is re-credited, not skipped as already seen.
  FF.forgetPlay(EVENT, td.id);
  FF.ingestPlays(EVENT, [td]);
  const back = FF.playCredits(EVENT, td.id).find((c) => c.name === "Christian Watson");
  ok(back && near(back.pts, 6.9) && run.rec === 1 && run.rec_td === 1, "F6 restoring the original play re-credits Watson +6.9 once (rec " + (run && run.rec) + ", rec_td " + (run && run.rec_td) + ")");
}

// =================================================================================================
sectionF().catch((e) => ok(false, "F threw: " + ((e && e.stack) || e))).then(() => {
console.log("\n" + "=".repeat(60));
console.log(`sunday-ff: ${pass}/${pass + fail}`);
if (fail) { console.log("\nFailures:"); for (const f of failures) console.log("  ✗ " + f); }
process.exit(fail ? 1 : 0);
});
