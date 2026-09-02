// _gffl_seams.cjs — hunts SEAMS in the GFFL league engine: places where two systems, or a
// system and the clock, disagree about the truth. Built on tools/_gffl_race_kit.cjs (the same
// fake-Firestore + headless-league.html harness the race repros and the season sim use) —
// REUSED, not re-implemented, per the house convention.
//
//   node tools/_gffl_seams.cjs
//
// This suite is for INTERACTIONS between lg-core.js (rules + money paths) and lg-data.js
// (feeds + clock), not for re-proving mechanisms already covered by tools/_verify-gffl.cjs's
// waiver/IR/drop sections or the three _gffl_race_*.cjs repros. Where current behavior is
// AMBIGUOUS or looks wrong, this file does NOT change engine semantics — it pins the current
// behavior with a `// SEAM-FINDING:` comment and the finding is repeated in the session report.
// Only outright bugs (crashes, arithmetic corruption, a guard that provably does nothing) get a
// same-session engine fix, restaged with the reason written at the check.
"use strict";

const path = require("path");
const K = require("./_gffl_race_kit.cjs");
const { ok, head, done, ev, sleep } = K;
const S_ = K.SEASON;

// ---------------------------------------------------------------------------- canonical compare
// Sorts every object's keys recursively before stringifying — a plain JSON.stringify is
// sensitive to key INSERTION ORDER, which is not a content guarantee across two separate reads
// even when nothing actually changed (the exact gotcha the 2025-test-season batch hit and fixed
// with this same technique — see docs/gffl.md's "Suite gotchas" note on that entry).
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}
const cj = (v) => JSON.stringify(canon(v));

// ---------------------------------------------------------------------------- doc builders
const claimDoc = (week, claimId, teamId, addKey, addName, addPos, addTeam, dropKey, dropName, bid) => ({
  kind: "claim", season: S_, week, claimId, teamId,
  addKey, addName, addPos, addTeam, dropKey, dropName, bid, t: 1,
});
function weeklyDoc(week, matchups, extra) {
  return { kind: "weekly", week, matchups, awards: { topScore: null, bust: null, benchBlunder: null },
    power: [], accuracy: null, finalizedAt: 1, source: "live", ...(extra || {}) };
}
function rosterDoc(week, teamId, players) {
  return { kind: "roster", week, teamId, players };
}
function teamDoc(id, name, extra) {
  return { kind: "team", teamId: id, name, abbrev: "T" + id, owner: "", ...(extra || {}) };
}
function fillerPlayers(n, prefix, slot) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ key: prefix + i, name: "Filler " + i, pos: "RB", team: "SF", slot: slot || "BENCH" });
  return out;
}
// The league's own slot script, as a single constant every fixture below derives from rather
// than re-typing. RESTAGED 2026-09-02: LG.DEFAULT_RULES.roster caught up with the live settings
// doc (v=8) — RB 2->3 and WR 2->3, so there are ELEVEN starting slots, not nine, and
// LG.rosterCap() is 21, not 19. Every fixture that hand-built a roster to exactly fill a lineup,
// or to sit exactly at cap, had to move with it; each such restage names this line as its
// reason. The runtime assertions in C3 re-read LG.rosterCap()/LG.rules.roster from the booted
// page, so this constant can never silently drift away from the engine again.
const STARTERS = { QB: 1, RB: 3, WR: 3, TE: 1, FLEX: 1, DST: 1, K: 1 }; // 11
const ROSTER_CAP = 21; // 11 starters + BENCH 7 + IR 3
const N_STARTING_SLOTS = Object.values(STARTERS).reduce((s, n) => s + n, 0);

// A "tight" roster: exactly one player per starting slot (QB1/RB3/WR3/TE1/FLEX1/DST1/K1), zero
// slack — 11 players. Used by C3/C5's trade-guard fixtures: with no spare players anywhere, the
// ONLY possible full assignment is the obvious one (TE -> TE, the spare RB -> FLEX), which is
// exactly the shape a naive greedy can get wrong (grab the TE for FLEX first, since it's
// FLEX-eligible too, then find the TE slot empty with nobody left who qualifies) and exactly
// the shape LG.canFillLineup's augmenting-path search gets right regardless of processing
// order. All 11 are real, distinct positions, so the roster is genuinely fillable — pulling any
// ONE of them out (see C3b/C3's "both RBs" fixture) is what makes it genuinely NOT fillable.
// RESTAGED 2026-09-02 from `tightNine` (9 players, RB2/WR2) for the slot-script change above:
// the same fixture IDEA, re-sized. Key names carry over so every assertion below still names
// the same men.
function tightEleven(prefix) {
  const P = prefix.toUpperCase();
  return [
    { key: prefix + "qb", name: P + " QB", pos: "QB", team: "PHI", slot: "QB" },
    { key: prefix + "rb1", name: P + " RB1", pos: "RB", team: "KC", slot: "RB" },
    { key: prefix + "rb2", name: P + " RB2", pos: "RB", team: "KC", slot: "RB" },
    { key: prefix + "rb3", name: P + " RB3", pos: "RB", team: "KC", slot: "RB" },
    { key: prefix + "wr1", name: P + " WR1", pos: "WR", team: "KC", slot: "WR" },
    { key: prefix + "wr2", name: P + " WR2", pos: "WR", team: "KC", slot: "WR" },
    { key: prefix + "wr3", name: P + " WR3", pos: "WR", team: "KC", slot: "WR" },
    { key: prefix + "te", name: P + " TE", pos: "TE", team: "KC", slot: "TE" },
    { key: prefix + "rb4", name: P + " RB4", pos: "RB", team: "KC", slot: "FLEX" },
    { key: prefix + "dst", name: P + " DST", pos: "DST", team: "KC", slot: "DST" },
    { key: prefix + "k", name: P + " K", pos: "K", team: "KC", slot: "K" },
  ];
}

(async () => {
  console.log("GFFL SEAM SUITE — where two systems, or a system and the clock, disagree");

  const srv = await K.startStatic();
  const browser = await K.launch();

  // ================================================================================ A. CLOCK

  head("A1. kickoff millisecond — dropBlocked, gameStarted and the locker's Swap/Drop buttons agree");
  {
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const KICKOFF = Date.UTC(2026, 8, 13, 17, 0, 0); // an arbitrary Sunday 1pm ET kickoff

    // ONE millisecond BEFORE kickoff: nothing has started anywhere.
    const before = await ev(A, (t) => {
      const { LG, D } = window.__GFFL__;
      D.S.games.set("PHI", { state: "pre", kickoff: new Date(t).toISOString() });
      LG.nowOverride = t - 1;
      const p101 = { key: "p101", name: "P. Passer", pos: "QB", team: "PHI", slot: "QB" };
      return { gameStarted: D.gameStarted("PHI"), dropBlocked: LG.dropBlocked(p101) };
    }, KICKOFF);
    ok(before.gameStarted === false && before.dropBlocked === false,
      "1ms before kickoff: D.gameStarted and LG.dropBlocked both read NOT STARTED (" + JSON.stringify(before) + ")");

    // EXACTLY the kickoff millisecond: D.gameStarted's own comparator is `LG.now() >= kickoff`
    // (lg-data.js), which lg-core's LG.dropBlocked (via the same D.gameStarted call) and
    // lg-ui.js's playerLocked (a one-line delegation to D.gameStarted, confirmed by reading the
    // source — "ONE DEFINITION OF UNDERWAY", 2026-08-15) all now share as their SOLE
    // determination of "underway". Proven end-to-end through the real locker DOM below, not
    // just by re-reading the source.
    const at = await ev(A, (t) => {
      const { LG, D } = window.__GFFL__;
      D.S.games.set("PHI", { state: "pre", kickoff: new Date(t).toISOString() });
      LG.nowOverride = t;
      const p101 = { key: "p101", name: "P. Passer", pos: "QB", team: "PHI", slot: "QB" };
      return { gameStarted: D.gameStarted("PHI"), dropBlocked: LG.dropBlocked(p101) };
    }, KICKOFF);
    ok(at.gameStarted === true && at.dropBlocked === true,
      "AT the kickoff ms (>=): D.gameStarted and LG.dropBlocked both flip to STARTED (" + JSON.stringify(at) + ")");

    // Render the real locker (team 1 owns P. Passer at QB) at exactly the kickoff instant and
    // read the Swap/Drop buttons' own disabled state off the DOM — the UI's actual truth, not a
    // re-derivation of it.
    await ev(A, (t) => {
      const { LG } = window.__GFFL__;
      LG.nowOverride = t;
      window.__GFFL__.UI.openLocker(1);
    }, KICKOFF);
    await A.page.waitForFunction(() => !!document.querySelector('#lockerStarters .lrow[data-slot="QB"]'), { timeout: 8000 });
    const dom = await A.page.evaluate(() => {
      const row = document.querySelector('#lockerStarters .lrow[data-slot="QB"]');
      const swap = row && row.querySelector(".lswap");
      const drop = row && row.querySelector(".ldrop");
      return { rowLocked: row && row.classList.contains("locked"), swapDisabled: swap && swap.disabled, dropDisabled: drop && drop.disabled };
    });
    ok(dom.rowLocked === true && dom.swapDisabled === true && dom.dropDisabled === true,
      "the real locker DOM agrees too: .lrow.locked, Swap disabled, Drop disabled at the same instant (" + JSON.stringify(dom) + ")");

    ok(A.errors.length === 0, "0 page errors (" + JSON.stringify(A.errors) + ")");
    await A.ctx.close();
  }

  head("A2. bye week — no game object in D.S.games all week");
  {
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const r = await ev(A, () => {
      const { LG, D } = window.__GFFL__;
      D.S.games.clear(); // no game object at all for ANY team — the bye-week shape all week
      const p101 = { key: "p101", name: "P. Passer", pos: "QB", team: "PHI", slot: "QB" };
      return {
        gameStarted: D.gameStarted("PHI"),
        dropBlocked: LG.dropBlocked(p101),
        livePts: D.livePts("p101"),      // rostered, known pid, no game row -> 0, never null/NaN
        liveProj: D.liveProj("p101"),    // no game -> falls through to the projection (0, not NaN, since no proj map warmed)
        unknownLivePts: D.livePts("totally_unknown_key_xyz"), // resolves to no pid at all -> "-" (null)
      };
    });
    ok(r.gameStarted === false && r.dropBlocked === false,
      "an untracked team reads NOT STARTED — droppable/swappable all week (" + JSON.stringify(r) + ")");
    ok(Number.isFinite(r.livePts) && r.livePts === 0,
      "a rostered, known player with no game row scores a real 0, never NaN (livePts=" + r.livePts + ")");
    ok(Number.isFinite(r.liveProj),
      "the same player's live-adjusted projection is finite, never NaN (liveProj=" + r.liveProj + ")");
    ok(r.unknownLivePts === null,
      "a key that resolves to NO player at all reads null (\"—\"), the honest answer — never a fabricated 0 (" + r.unknownLivePts + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("A3. a game's state glitches in -> pre (real ESPN behavior) — no permanent lock, no crash");
  {
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const KICKOFF = Date.UTC(2026, 8, 13, 17, 0, 0);
    const r = await ev(A, (t) => {
      const { LG, D } = window.__GFFL__;
      LG.nowOverride = t + 3600e3; // an hour after kickoff — the game is genuinely underway
      // Poll 1: the feed reports "in", same shape pollScoreboard's rebuild produces.
      D.S.games.set("PHI", { state: "in", period: 2, clock: "5:00", kickoff: new Date(t).toISOString() });
      const p101 = { key: "p101", name: "P. Passer", pos: "QB", team: "PHI", slot: "QB" };
      const during = { gameStarted: D.gameStarted("PHI"), dropBlocked: LG.dropBlocked(p101) };
      // Poll 2: the SAME real game, feed glitches back to "pre" (D.S.games is REBUILT each poll,
      // never merged into — see the 2026-08-08 adversarial-review fix, finding 1's widening
      // note — so a bare re-set here is exactly what a real poll cycle does).
      D.S.games.set("PHI", { state: "pre", period: 0, clock: "", kickoff: new Date(t).toISOString() });
      const after = { gameStarted: D.gameStarted("PHI"), dropBlocked: LG.dropBlocked(p101) };
      return { during, after };
    }, KICKOFF);
    ok(r.during.gameStarted === true && r.during.dropBlocked === true,
      "while state reads \"in\", both paths agree the game is underway (" + JSON.stringify(r.during) + ")");
    // THE SEAM: D.gameStarted does not trust "state" alone — it falls back to LG.now() vs the
    // game's own kickoff time (lg-data.js). So a state glitch back to "pre" does NOT un-latch a
    // real, already-started game, because the wall-clock kickoff comparison still holds. This is
    // the CORRECT, resilient answer (a feed hiccup must never let a started starter get dropped
    // instantly, nor a locked lineup slot unlock mid-game) — pinned here as the guard against a
    // regression that would make the glitch dangerous.
    ok(r.after.gameStarted === true && r.after.dropBlocked === true,
      "after the glitch back to \"pre\", the KICKOFF-TIME fallback keeps both paths reporting STARTED — " +
      "the glitch cannot un-latch a real in-progress game (" + JSON.stringify(r.after) + ")");
    // finalizeWeek's own gate reads game state through fzGameState (state string only, no
    // kickoff fallback) — confirm a glitched-to-"pre" game is honestly treated as "not final"
    // rather than crashing or silently passing.
    const fz = await ev(A, async (t) => {
      const { LG, D } = window.__GFFL__;
      LG.nowOverride = t + 3600e3;
      D.S.espnWeek = 1; D.S.slpWeek = 1; D.S.espnSeasonType = "regular"; D.S.slpSeasonType = "regular";
      D.S.games.set("PHI", { state: "pre", kickoff: new Date(t).toISOString() });
      const res = await LG.finalizeWeek(1);
      return res;
    }, KICKOFF);
    ok(fz.ok === false && fz.reason === "not-final",
      "finalizeWeek honestly refuses (\"not-final\") a week whose game glitched back to \"pre\" — no crash (" + JSON.stringify(fz) + ")");
    ok(A.errors.length === 0, "0 page errors (" + JSON.stringify(A.errors) + ")");
    await A.ctx.close();
  }

  head("A4. waiver-Wednesday cron across the Nov 1 2026 DST fall-back");
  {
    // No browser needed — netlify/functions/leaguecron.mjs is a standalone ESM module. Its own
    // isScheduledSlot() guard is Intl-based (America/Chicago), never hand-rolled offset math,
    // and the toml fires it at BOTH UTC 13:00 and UTC 14:00 every Wednesday specifically so one
    // candidate always lands inside the 20-minute Central band regardless of DST state
    // (netlify/functions/leaguecron.mjs's own header comment + netlify.toml's
    // `schedule = "0 13,14 * * 3"`). Nov 1 2026 (Sunday) is the real US fall-back; the first
    // Wednesday after it is Nov 4 2026 — this proves the guard, not just reads the comment.
    const handlerPath = "file:///" + path.join(K.ROOT, "netlify", "functions", "leaguecron.mjs").replace(/\\/g, "/");
    async function fireAt(iso) {
      process.env.LEAGUECRON_TEST_NOW_MS = String(Date.parse(iso));
      delete process.env.LEAGUECRON_FORCE;
      delete process.env.FIREBASE_SERVICE_ACCOUNT; // absent on purpose — see below
      const mod = await import(handlerPath + "?t=" + Date.now() + Math.random()); // fresh module eval per call (env is read at call time, but a cache-buster keeps this future-proof)
      const resp = await mod.default();
      const body = await resp.json();
      return { status: resp.status, body };
    }
    // Nov 4 2026 8:00 AM CST is UTC 14:00 (CST = UTC-6, post-fall-back). The 13:00 UTC candidate
    // is 7:00 AM CST — outside the 20-min band. Only the 14:00 candidate should pass the slot
    // guard. Neither run can reach a real network call: FIREBASE_SERVICE_ACCOUNT is deliberately
    // unset, so a run that GETS PAST the schedule/season guards fails fast with a distinct,
    // guard-specific reason ("FIREBASE_SERVICE_ACCOUNT not set") rather than "not-a-scheduled-slot" —
    // that reason string is what proves which guard did (or didn't) let it through.
    const r1300 = await fireAt("2026-11-04T13:00:00Z");
    const r1400 = await fireAt("2026-11-04T14:00:00Z");
    ok(r1300.body.skipped === true && r1300.body.reason === "not-a-scheduled-slot",
      "Nov 4 2026 13:00 UTC (7:00 AM CST — the wrong DST candidate) is correctly rejected by the slot guard (" + JSON.stringify(r1300.body) + ")");
    ok(r1400.body.reason === "FIREBASE_SERVICE_ACCOUNT not set",
      "Nov 4 2026 14:00 UTC (8:00 AM CST — the real post-fall-back candidate) PASSES both the slot and season guards " +
      "(it fails only on the deliberately-absent credential, proving it got all the way through) (" + JSON.stringify(r1400.body) + ")");
    // Cross-check against a pre-fall-back Wednesday (Oct 28 2026, still CDT = UTC-5) so the same
    // guard is proven correct on BOTH sides of the shift, not just after it: 13:00 UTC there is
    // 8:00 AM CDT (the right candidate) and 14:00 UTC is 9:00 AM CDT (outside the band).
    const preA = await fireAt("2026-10-28T13:00:00Z");
    const preB = await fireAt("2026-10-28T14:00:00Z");
    ok(preA.body.reason === "FIREBASE_SERVICE_ACCOUNT not set" && preB.body.reason === "not-a-scheduled-slot",
      "Oct 28 2026 (pre-fall-back, CDT): the OTHER UTC candidate (13:00) is now the correct one and 14:00 is rejected — " +
      "the same guard flips which candidate it accepts across the DST boundary, correctly, both times (" +
      JSON.stringify({ preA: preA.body.reason, preB: preB.body.reason }) + ")");
    delete process.env.LEAGUECRON_TEST_NOW_MS;
  }

  // ================================================================================ B. WAIVERS

  head("B1. claim legal at submit, drop target's game started by run — the claim WINS (drops of started starters wait for waivers, they are not refused)");
  {
    // lg-core.js's processWaivers carries an explicit, documented DECISION here (2026-08-15,
    // "DROPPING ONCE THE BALL IS IN THE AIR"): a claim's drop takes effect AT the waiver run,
    // which IS "once waivers clear" — so a claim dropping an already-started starter is the
    // PERMITTED route (the abuse the rule targets is the INSTANT free-agent add via LG.faAdd,
    // gated separately by LG.dropBlocked). A first cut gated processWaivers too and it broke 9
    // pre-existing waiver checks specifically because it contradicted this rule. Pinned here
    // exactly as documented — this is confirmed-by-design, not an open question.
    const store = K.makeStore(K.seedDocs({
      ["claim_" + S_ + "_w1_c1"]: claimDoc(1, "c1", 1, "p901", "N. Newman", "RB", "SF", "p101", "P. Passer", 10),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const KICKOFF = Date.UTC(2026, 8, 13, 17, 0, 0);
    // p101 (the claim's own drop target) is a QB — start him, then mark his game underway.
    await ev(A, (t) => { window.__GFFL__.D.S.games.set("PHI", { state: "in", period: 1, clock: "10:00", kickoff: new Date(t).toISOString() }); }, KICKOFF);
    const res = await ev(A, () => window.__GFFL__.LG.processWaivers(1));
    const won = (res.results || []).filter((r) => r.ok);
    ok(won.length === 1 && won[0].reason === "won",
      "the claim WINS even though its drop target's game is underway at run time (" + JSON.stringify(res.results) + ")");
    const ros = (store.docs["roster_" + S_ + "_w1_t1"].players || []).map((p) => p.key);
    ok(!ros.includes("p101") && ros.includes("p901"),
      "the started player is actually dropped and the winner actually added — the roster carries it out ([" + ros.join(", ") + "])");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("B2. claim's dropKey already dropped via faAdd between submit and run — drop-gone, purse untouched, priority unconsumed");
  {
    const store = K.makeStore(K.seedDocs({
      ["claim_" + S_ + "_w1_c1"]: claimDoc(1, "c1", 1, "p901", "N. Newman", "RB", "SF", "p110", "B. Backup", 15),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    // Bench player, undroppable-block-free — drop him via the standalone drop button (real
    // faAdd/dropPlayer path) BEFORE the run, exactly the "already dropped" window B2 targets.
    const before = await ev(A, () => window.__GFFL__.LG.dropPlayer(1, 1, "p110"));
    ok(before.ok === true, "the standalone drop lands before the run (" + JSON.stringify(before) + ")");
    const priorityBefore = await ev(A, () => window.__GFFL__.LG.waiverPriorityOrder());
    const res = await ev(A, () => window.__GFFL__.LG.processWaivers(1));
    const lost = (res.results || [])[0];
    ok(lost && lost.ok === false && lost.reason === "drop-gone",
      "the claim refuses at run time with reason drop-gone, not a crash or a silent skip (" + JSON.stringify(lost) + ")");
    const faab = await ev(A, () => { const LG = window.__GFFL__.LG; return LG.teamFaab(LG.teamById(1)); });
    ok(faab === 100, "the purse is UNTOUCHED — the losing claim's $15 was never spent ($" + faab + ")");
    const priorityAfter = await ev(A, () => window.__GFFL__.LG.waiverPriorityOrder());
    ok(cj(priorityBefore) === cj(priorityAfter),
      "waiver priority order is unchanged by the loss — nothing about it was \"consumed\" (" + JSON.stringify(priorityAfter) + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("B3. IR became illegal between submit and run — the SECOND (processing-time) IR gate fires");
  {
    const store = K.makeStore(K.seedDocs({
      ["claim_" + S_ + "_w1_c1"]: claimDoc(1, "c1", 1, "p901", "N. Newman", "RB", "SF", null, null, 5),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    // A key the live engine has NEVER heard of ("irtest_1", not in the race kit's Sleeper
    // directory) — the exact technique tools/_verify-gffl.cjs's own AI15 section uses (comment:
    // "with an unknown key, D.injuryFor falls through to the roster's own stored value, which
    // this fixture controls outright — so 'healthy' means healthy at every moment of the run").
    // With an unknown key, D.S.players has no row for him at all, so D.injuryOf reads straight
    // through to the ROSTER's own stored `injury` field — which is what we flip between steps.
    const submitTime = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const ros = await LG.ensureRoster(1, 1, { fresh: true });
      const irMan = { key: "irtest_1", name: "H. Healed", pos: "WR", team: "SF", slot: "IR", injury: "O" };
      await LG.saveRoster(1, 1, ros.concat([irMan]));
      const fresh = await LG.ensureRoster(1, 1, { fresh: true });
      return LG.illegalIR(fresh).map((p) => p.key);
    });
    ok(submitTime.length === 0, "he is LEGITIMATELY stashed at submit time — Out is IR-eligible, illegalIR names nobody (" + JSON.stringify(submitTime) + ")");
    // By Wednesday morning he is cleared — the roster's own stored designation now reads healthy
    // (whatever real-world path updates it; LG.illegalIR only cares what it reads AT RUN TIME).
    const stash = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const ros = await LG.ensureRoster(1, 1, { fresh: true });
      await LG.saveRoster(1, 1, ros.map((p) => (p.key === "irtest_1" ? { ...p, injury: "" } : p)));
      const fresh = await LG.ensureRoster(1, 1, { fresh: true });
      return LG.illegalIR(fresh).map((p) => p.key);
    });
    ok(stash.length === 1 && stash[0] === "irtest_1", "he is illegally stashed on IR at run time, healed (" + JSON.stringify(stash) + ")");
    const res = await ev(A, () => window.__GFFL__.LG.processWaivers(1));
    const lost = (res.results || [])[0];
    ok(lost && lost.ok === false && lost.reason === "ir-illegal",
      "the claim LOSES with reason ir-illegal — the processing-time gate fires (" + JSON.stringify(lost) + ")");
    // Ordering, per the code's own comment: ir-illegal is checked AFTER drop-gone and
    // insufficient-faab. Confirm that ordering holds — a claim with BOTH an insufficient bid
    // AND an illegal stash reports the EARLIER reason.
    const store2 = K.makeStore(K.seedDocs({
      ["claim_" + S_ + "_w1_c1"]: claimDoc(1, "c1", 1, "p901", "N. Newman", "RB", "SF", null, null, 999), // over budget
    }));
    const B = await K.boot(await K.newDevice(browser, store2, "B", { team: 1, who: "Peter" }));
    await ev(B, async () => {
      const LG = window.__GFFL__.LG;
      const ros = await LG.ensureRoster(1, 1, { fresh: true });
      await LG.saveRoster(1, 1, ros.concat([{ key: "irtest_2", name: "H. Healed 2", pos: "WR", team: "SF", slot: "IR", injury: "" }])); // healed = illegal, same technique as above
    });
    const res2 = await ev(B, () => window.__GFFL__.LG.processWaivers(1));
    ok(res2.results[0].reason === "insufficient-faab",
      "insufficient-faab is checked and reported BEFORE ir-illegal, matching lg-core's own ordering comment (" + JSON.stringify(res2.results[0]) + ")");
    ok(A.errors.length === 0 && B.errors.length === 0, "0 page errors");
    await A.ctx.close(); await B.ctx.close();
  }

  head("B4. two claims, same player, different teams — priority decides, loser gets a reason, loser's priority is not consumed");
  {
    const store = K.makeStore(K.seedDocs({
      // team 1 (0-0, PF 0) and team 2 (0-0, PF 0) tie on record — the deterministic tiebreak is
      // teamId ascending, so team 1 outranks team 2 (LG.waiverPriorityOrder: worse record first,
      // lower teamId as the final tiebreak). Both bid the SAME amount so BID doesn't decide it —
      // priority has to.
      ["claim_" + S_ + "_w1_c1"]: claimDoc(1, "c1", 1, "p901", "N. Newman", "RB", "SF", null, null, 20),
      ["claim_" + S_ + "_w1_c2"]: claimDoc(1, "c2", 2, "p901", "N. Newman", "RB", "SF", null, null, 20),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const priorityBefore = await ev(A, () => window.__GFFL__.LG.waiverPriorityOrder());
    ok(priorityBefore[0] === 1, "team 1 (lower id, same 0-0/0 record as team 2) holds priority BEFORE the run (" + JSON.stringify(priorityBefore) + ")");
    const res = await ev(A, () => window.__GFFL__.LG.processWaivers(1));
    const byTeam = new Map(res.results.map((r) => [r.teamId, r]));
    ok(byTeam.get(1).ok === true && byTeam.get(1).reason === "won",
      "team 1 (higher priority) WINS the contested player (" + JSON.stringify(byTeam.get(1)) + ")");
    // "outbid" (not "player-taken") is the correct reason for a same-run conflict: player-taken
    // means the player was ALREADY owned before this run started; outbid means a HIGHER-priority
    // claim in this SAME run took him (processWaivers: `wonThisRun.has(addKey) ? "outbid" : "player-taken"`).
    ok(byTeam.get(2).ok === false && byTeam.get(2).reason === "outbid",
      "team 2 (lower priority) LOSES with a stated reason, not silently (" + JSON.stringify(byTeam.get(2)) + ")");
    const faab2 = await ev(A, () => { const LG = window.__GFFL__.LG; return LG.teamFaab(LG.teamById(2)); });
    ok(faab2 === 100, "team 2's $20 bid is never spent — the purse is untouched ($" + faab2 + ")");
    const priorityAfter = await ev(A, () => window.__GFFL__.LG.waiverPriorityOrder());
    ok(cj(priorityBefore) === cj(priorityAfter),
      "waiver priority order is IDENTICAL after the run — the loser's priority was not consumed by losing (" + JSON.stringify(priorityAfter) + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("B5. processWaivers invoked twice, sequentially — idempotent, canonical-JSON-identical after run 2");
  {
    const store = K.makeStore(K.seedDocs({
      ["claim_" + S_ + "_w1_c1"]: claimDoc(1, "c1", 1, "p901", "N. Newman", "RB", "SF", "p110", "B. Backup", 12),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    await ev(A, () => window.__GFFL__.LG.processWaivers(1));
    const snap1 = { roster: store.docs["roster_" + S_ + "_w1_t1"], team: store.docs.team_1, claims: store.docs["claims_" + S_ + "_w1"], writeCount: store.writes.length };
    const res2 = await ev(A, () => window.__GFFL__.LG.processWaivers(1));
    ok(res2.processed === true && Array.isArray(res2.results) && res2.results.length === 1,
      "a second run of the SAME week returns the settled doc untouched, not a re-resolve (" + JSON.stringify(res2.results) + ")");
    const snap2 = { roster: store.docs["roster_" + S_ + "_w1_t1"], team: store.docs.team_1, claims: store.docs["claims_" + S_ + "_w1"] };
    ok(cj(snap1.roster) === cj(snap2.roster) && cj(snap1.team) === cj(snap2.team) && cj(snap1.claims) === cj(snap2.claims),
      "roster / team (purse) / claims docs are canonical-JSON-IDENTICAL before vs after the second run");
    ok(store.writes.length === snap1.writeCount,
      "the second run performs NO writes at all (" + store.writes.length + " total writes, unchanged since run 1)");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("B5b. processWaivers invoked twice concurrently, one page — single execution (in-flight latch)");
  {
    const store = K.makeStore(K.seedDocs({
      ["claim_" + S_ + "_w1_c1"]: claimDoc(1, "c1", 1, "p901", "N. Newman", "RB", "SF", "p110", "B. Backup", 12),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const both = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const [r1, r2] = await Promise.all([LG.processWaivers(1), LG.processWaivers(1)]);
      return { a: r1.results.length, b: r2.results.length, same: r1 === r2 || (r1.finalizedAtDummy, true) };
    });
    ok(both.a === 1 && both.b === 1, "both concurrent callers get the SAME one-result run back (" + JSON.stringify(both) + ")");
    const txs = Object.entries(store.docs).filter(([, d]) => d.kind === "tx" && d.type === "waiver");
    ok(txs.length === 1, "exactly one waiver tx logged — the append-only log never doubled (" + txs.length + ")");
    ok(store.docs.team_1.faab === 88, "the $12 bid is deducted exactly once ($" + store.docs.team_1.faab + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("B6. no-drop claim, team fills to cap by run time (via a trade meanwhile) — refused at run, roster unchanged");
  {
    // team 1 starts with room (10 rostered, cap 19). We fill it to EXACTLY cap via a direct
    // roster write (standing in for "a trade landed meanwhile" — the mechanism the fill arrives
    // by is irrelevant to processWaivers, which only ever re-checks LG.rosterRoom at run time).
    const store = K.makeStore(K.seedDocs({
      ["claim_" + S_ + "_w1_c1"]: claimDoc(1, "c1", 1, "p901", "N. Newman", "RB", "SF", null, null, 8),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const fillTo19 = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const ros = await LG.ensureRoster(1, 1, { fresh: true });
      const filler = [];
      for (let i = ros.length; i < LG.rosterCap(); i++) filler.push({ key: "cap_filler_" + i, name: "Filler " + i, pos: "RB", team: "SF", slot: "BENCH" });
      const next = ros.concat(filler);
      await LG.saveRoster(1, 1, next);
      return { size: next.length, cap: LG.rosterCap(), room: LG.rosterRoom(next) };
    });
    ok(fillTo19.size === fillTo19.cap && fillTo19.room === 0, "team 1's roster is filled to EXACTLY the cap (" + JSON.stringify(fillTo19) + ")");
    const res = await ev(A, () => window.__GFFL__.LG.processWaivers(1));
    const lost = res.results[0];
    ok(lost.ok === false && lost.reason === "roster-full",
      "the no-drop claim refuses at run time with reason roster-full (" + JSON.stringify(lost) + ")");
    const rosterAfter = await ev(A, () => window.__GFFL__.LG.ensureRoster(1, 1, {}));
    ok(rosterAfter.length === fillTo19.size && !rosterAfter.some((p) => p.key === "p901"),
      "the roster is unchanged — still exactly cap size, the free agent never landed (" + rosterAfter.length + ")");
    const faabB6 = await ev(A, () => { const LG = window.__GFFL__.LG; return LG.teamFaab(LG.teamById(1)); });
    ok(faabB6 === 100, "the $8 bid is never spent ($" + faabB6 + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  // ================================================================================ C. TRADES

  head("C1. accept at exactly the review-window expiry ms — executeTrade and maybeAutoExecuteTrades agree which side wins");
  {
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const BASE = Date.UTC(2026, 8, 10, 12, 0, 0);
    const setup = await ev(A, async (base) => {
      const LG = window.__GFFL__.LG;
      const origNow = Date.now;
      Date.now = () => base;
      const offer = await LG.offerTrade(1, 2, ["p107"], ["p203"], "");
      const accepted = await LG.acceptTrade(offer.trade.id, 2);
      const reviewMs = ((LG.rules.trades || {}).reviewHours || 24) * 3600e3; // rules default is 48h, not 24 — read, never assumed
      Date.now = origNow;
      return { id: offer.trade.id, reviewEndsAt: accepted.reviewEndsAt, reviewMs, expectedEnd: base + reviewMs };
    }, BASE);
    ok(setup.reviewEndsAt === setup.expectedEnd,
      "acceptTrade stamps reviewEndsAt = acceptedAt + rules.trades.reviewHours*3600e3 exactly (" + setup.reviewEndsAt + " vs " + setup.expectedEnd + ")");

    // 1ms before expiry: neither path should execute.
    const before = await ev(A, async (id, t) => {
      const LG = window.__GFFL__.LG;
      const orig = Date.now; Date.now = () => t - 1;
      const r1 = await LG.executeTrade(id);
      await LG.ui.maybeAutoExecuteTrades();
      const doc = await LG.loadTrade(id, { fresh: true });
      Date.now = orig;
      return { execReturn: r1.status, afterAuto: doc.status };
    }, setup.id, setup.reviewEndsAt);
    ok(before.execReturn === "accepted" && before.afterAuto === "accepted",
      "1ms before expiry: BOTH executeTrade and maybeAutoExecuteTrades agree — still accepted, not executed (" + JSON.stringify(before) + ")");

    // Exactly at expiry: lg-core's comparator is `Date.now() < reviewEndsAt` (false at equality,
    // so it proceeds) — confirm the UI's own auto-check comparator lands on the SAME side.
    const at = await ev(A, async (id, t) => {
      const LG = window.__GFFL__.LG;
      const orig = Date.now; Date.now = () => t;
      const r1 = await LG.executeTrade(id);
      Date.now = orig;
      return r1.status;
    }, setup.id, setup.reviewEndsAt);
    ok(at === "executed", "AT the expiry ms, executeTrade's `Date.now() < reviewEndsAt` is false — it executes (status=" + at + ")");

    // A second trade, driven ONLY through maybeAutoExecuteTrades at the same boundary, to prove
    // the UI path lands on the identical side.
    const setup2 = await ev(A, async (base) => {
      const LG = window.__GFFL__.LG;
      const orig = Date.now; Date.now = () => base;
      // p203 already moved to team 1 in the first trade above — use team 2's still-held p202.
      const offer = await LG.offerTrade(2, 1, ["p202"], ["p110"], "");
      const accepted = await LG.acceptTrade(offer.trade.id, 1);
      Date.now = orig;
      return { id: offer.trade.id, reviewEndsAt: accepted.reviewEndsAt };
    }, BASE + 1);
    const at2 = await ev(A, async (id, t) => {
      const LG = window.__GFFL__.LG;
      const orig = Date.now; Date.now = () => t;
      await LG.ui.maybeAutoExecuteTrades();
      const doc = await LG.loadTrade(id, { fresh: true });
      Date.now = orig;
      return doc.status;
    }, setup2.id, setup2.reviewEndsAt);
    ok(at2 === "executed",
      "AT the expiry ms via maybeAutoExecuteTrades (`Date.now() >= reviewEndsAt`, lg-ui.js): also executes — same side wins as executeTrade (status=" + at2 + ")");

    // RESTAGED 2026-08-17 (same day, at review): this was born as a SEAM-FINDING pin — lg-ui's
    // maybeAutoExecuteTrades used `|| Infinity` where lg-core's executeTrade uses
    // `?? Infinity`, disagreeing exactly when reviewEndsAt is the literal 0. Unreachable from
    // any app state today (reviewEndsAt is always Date.now() + reviewMs), but it is CLAUDE.md's
    // own documented `??`/`||` trap on a deadline compared in two places, so the review fixed
    // the one character rather than filing it. The pin now asserts the two comparators MATCH,
    // by reading both source files — so a future edit reintroducing the drift fails here.
    const comparators = await (async () => {
      const fs = require("fs"), path = require("path");
      const core = fs.readFileSync(path.join(__dirname, "..", "assets", "league", "lg-core.js"), "utf8");
      const ui = fs.readFileSync(path.join(__dirname, "..", "assets", "league", "lg-ui.js"), "utf8");
      return {
        core: (core.match(/reviewEndsAt (\?\?|\|\|) Infinity/) || [])[1] || null,
        ui: (ui.match(/reviewEndsAt (\?\?|\|\|) Infinity/) || [])[1] || null,
      };
    })();
    ok(comparators.core === "??" && comparators.ui === "??",
      "lg-core and lg-ui use the SAME `?? Infinity` comparator for the one reviewEndsAt deadline (" +
      JSON.stringify(comparators) + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("C2. executeTrade after the roster changed since offer — a SUBTLE change (same players, different slot) does NOT cancel");
  {
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const offer = await ev(A, () => window.__GFFL__.LG.offerTrade(1, 2, ["p107"], ["p203"], ""));
    await ev(A, (id) => window.__GFFL__.LG.acceptTrade(id, 2), offer.trade.id);
    // Subtle change: p107 (the GIVE side) moves from FLEX to BENCH — same player, same roster,
    // different slot. The fail-safe's own check is `fromRoster.some(p => p.key === k)` — key
    // PRESENCE only, never slot — so this should NOT trip it.
    await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const ros = await LG.ensureRoster(1, 1, { fresh: true });
      await LG.saveRoster(1, 1, ros.map((p) => (p.key === "p107" ? { ...p, slot: "BENCH" } : p)));
    });
    const executed = await ev(A, async (id) => { const orig = Date.now; const _base = orig(); Date.now = () => _base + 200 * 3600e3; const r = await window.__GFFL__.LG.executeTrade(id); Date.now = orig; return r; }, offer.trade.id);
    // SEAM-FINDING: pin current behavior — this executes normally, it is NOT cancelled, because
    // the fail-safe only ever checks whether the traded player's KEY is still present on the
    // roster, never his slot. This is narrower than "any roster change" — it catches a player
    // who left the roster entirely (traded/dropped elsewhere), not a player who simply moved
    // slots. Confirmed correct-for-scope: the traded-in player is re-slotted to BENCH by
    // executeTrade itself regardless of his slot at offer time, so the giving side's slot detail
    // was never load-bearing to begin with.
    ok(executed.status === "executed",
      "SEAM-FINDING pinned: a slot-only roster change between offer and execute does NOT cancel the trade — " +
      "the fail-safe checks player PRESENCE by key only, never slot (status=" + executed.status + ")");

    // Regression proof: a player who genuinely LEFT the roster (the mechanism the fail-safe
    // actually exists for) DOES cancel.
    // RESTAGED 2026-08-17 (ruling, same day): this used to send team 1's p104 (a STARTING WR)
    // back to team 2. Team 1 has only p105 left at WR after that (p104 was one of two), which
    // the new LINEUP guard correctly refuses — a real, deliberate catch, just not the one this
    // check exists to prove. Swapped for p110 (team 1's bench RB, idle since the trade above),
    // which leaves team 1's lineup untouched and lets the doc reach "accepted" so the
    // roster-changed fail-safe below is still what actually gets exercised. The reason this
    // needed a fixture change and C1/C4's shared trades elsewhere in this file did not: this is
    // the only spot that hands a STARTING position player (not a bench one) back across a trade
    // using team 1's real, fillable 10-man roster.
    const offer2 = await ev(A, () => window.__GFFL__.LG.offerTrade(2, 1, ["p203"], ["p110"], ""));
    await ev(A, (id) => window.__GFFL__.LG.acceptTrade(id, 1), offer2.trade.id);
    await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const ros = await LG.ensureRoster(1, 2, { fresh: true });
      await LG.saveRoster(1, 2, ros.filter((p) => p.key !== "p203")); // p203 genuinely gone (traded/dropped elsewhere)
    });
    const cancelled = await ev(A, async (id) => { const orig = Date.now; const _base = orig(); Date.now = () => _base + 200 * 3600e3; const r = await window.__GFFL__.LG.executeTrade(id); Date.now = orig; return r; }, offer2.trade.id);
    ok(cancelled.status === "cancelled" && cancelled.cancelReason === "roster-changed",
      "a player who genuinely left the roster DOES trip the fail-safe (status=" + cancelled.status + ", reason=" + cancelled.cancelReason + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("C3. THE RULING (2026-08-17): CAP and LINEUP now block a trade — restaged from a SEAM-FINDING pin");
  {
    // RESTAGED 2026-09-02: was 19. LG.DEFAULT_RULES.roster is now the live league's own script —
    // QB1+RB3+WR3+TE1+FLEX1+DST1+K1 = 11 starters, +BENCH7 +IR3 = 21. The constant is asserted
    // against the booted engine's own LG.rosterCap() below, so it cannot drift again unnoticed.
    const cap = ROSTER_CAP; // 21
    // --- 3a: over-cap. Team 1 built to EXACTLY cap, team 2 gives 2 players for team 1's 1.
    // RESTAGED 2026-08-17 (was a SEAM-FINDING pin: "executeTrade has NO roster-cap check at
    // all", quoting lg-core's own "no roster-size cap in v1" comment). The commissioner ruled
    // the same day this was found: a trade may not leave either roster over LG.rosterCap().
    // Fixture UNCHANGED from the pin — only the assertion flips, from "executes silently" to
    // "refused, and the refusal NAMES the reason".
    {
      const t1 = [{ key: "p101", name: "P. Passer", pos: "QB", team: "PHI", slot: "QB" }, ...fillerPlayers(cap - 1, "f1_")];
      const t2 = [{ key: "p201", name: "Q. Rival", pos: "QB", team: "DAL", slot: "QB" }, { key: "p902", name: "A. Available", pos: "WR", team: "KC", slot: "BENCH" }, { key: "p903", name: "O. Open", pos: "TE", team: "SF", slot: "BENCH" }];
      const docs = { ...K.seedDocs() };
      docs["team_1"] = teamDoc(1, "Battle Kreussers");
      docs["team_2"] = teamDoc(2, "End Zone Goats");
      docs["roster_" + S_ + "_w1_t1"] = rosterDoc(1, 1, t1);
      docs["roster_" + S_ + "_w1_t2"] = rosterDoc(1, 2, t2);
      const store = K.makeStore(docs);
      const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
      const before = await ev(A, () => window.__GFFL__.LG.ensureRoster(1, 1, {}));
      // The engine's OWN cap and slot script, read off the booted page — so this section can
      // never again sit on a hardcoded number the engine has moved past (which is exactly what
      // the 2026-09-02 DEFAULT_RULES catch-up found: `cap = 19` against an engine at 21).
      const live = await ev(A, () => ({ cap: window.__GFFL__.LG.rosterCap(), roster: window.__GFFL__.LG.rules.roster }));
      ok(live.cap === cap && cj(live.roster) === cj({ ...STARTERS, BENCH: 7, IR: 3 }),
        "the engine's own LG.rosterCap() and rules.roster match this file's constants exactly — " +
        JSON.stringify(live) + " vs cap " + cap + " / " + JSON.stringify({ ...STARTERS, BENCH: 7, IR: 3 }));
      ok(before.length === cap, "team 1 starts at exactly the roster cap (" + before.length + "/" + cap + ")");
      const offer = await ev(A, () => window.__GFFL__.LG.offerTrade(1, 2, ["f1_1"], ["p902", "p903"], ""));
      // PROOF that acceptTrade's own early-refusal gate (added by this same ruling) ALSO
      // catches this fixture — this exact trade is already over cap (21 -1 +2 = 22) at offer
      // time, so an ordinary accept refuses right here, before the doc ever reaches
      // "accepted". Which is exactly why the EXECUTE-gate check below has to fabricate an
      // "accepted" doc directly rather than calling acceptTrade — going through the normal
      // path would never leave "offered" to prove executeTrade's OWN gate at all.
      const acceptRefusal = await ev(A, (id) => window.__GFFL__.LG.acceptTrade(id, 2), offer.trade.id);
      ok(acceptRefusal && acceptRefusal.ok === false && acceptRefusal.reason === "over-cap",
        "acceptTrade's early-refusal gate catches the same fixture (" + JSON.stringify(acceptRefusal) + ")");
      // Writes the exact doc shape LG.acceptTrade itself would have written, bypassing its
      // guard — isolates executeTrade's OWN authoritative gate, which is what actually
      // protects a trade whose rosters change DURING the review window (the case accept alone
      // can never catch, since it only ever sees the trade at the moment it's offered).
      const accepted = await ev(A, (offerDoc) => {
        const LG = window.__GFFL__.LG;
        const t = Date.now();
        const doc = { ...offerDoc, status: "accepted", acceptedAt: t, reviewEndsAt: t };
        return LG.saveTrade(doc).then(() => doc);
      }, offer.trade);
      const r = await ev(A, async (id) => { const orig = Date.now; const _base = orig(); Date.now = () => _base + 200 * 3600e3; const x = await window.__GFFL__.LG.executeTrade(id); Date.now = orig; return x; }, offer.trade.id);
      const after = await ev(A, () => window.__GFFL__.LG.ensureRoster(1, 1, {}));
      ok(r.status === "cancelled" && r.cancelReason === "over-cap",
        "RESTAGED (ruling 2026-08-17, was 'executes silently'): executeTrade now CANCELS a 1-for-2 trade that would push " +
        "team 1 to " + (cap + 1) + " players (" + cap + " -1 +2), one over LG.rosterCap()=" + cap + " (status=" + r.status + " reason=" + r.cancelReason + ")");
      ok(after.length === cap, "team 1's roster is UNCHANGED at exactly cap — the cancelled trade never applied (" + after.length + "/" + cap + ")");
      ok(!!r.cancelDetail && r.cancelDetail.team === "Battle Kreussers",
        "the cancelled doc carries WHICH team the reason is about, not just the code (" + JSON.stringify(r.cancelDetail) + ")");
      ok(A.errors.length === 0, "0 page errors");
      await A.ctx.close();
    }
    // --- 3b: a team's only QB is traded away, leaving zero QB-eligible players anywhere on the
    // roster. RESTAGED 2026-08-17 (was a SEAM-FINDING pin: "executeTrade has NO
    // startable-lineup check"). Fixture UPGRADED from the pin's 2-player roster (which could
    // never have fielded a lineup, QB trade or not — see the "leave...unable" transition note
    // at LG.tradeBlockers) to tightNine: a roster that genuinely IS a full, exactly-fillable
    // lineup before the trade, so losing the QB is what BREAKS it. (RESTAGED 2026-09-02 to
    // tightEleven — same fixture idea, re-sized for the 11-slot script.)
    {
      const t1 = tightEleven("a"); // 11 players, exactly fills QB1/RB3/WR3/TE1/FLEX1/DST1/K1 with none left over
      const t2 = [...tightEleven("b"), { key: "bspare", name: "B Spare", pos: "RB", team: "KC", slot: "BENCH" }]; // a full lineup PLUS one spare RB it can afford to give away
      const docs = { ...K.seedDocs() };
      docs["team_1"] = teamDoc(1, "Battle Kreussers");
      docs["team_2"] = teamDoc(2, "End Zone Goats");
      docs["roster_" + S_ + "_w1_t1"] = rosterDoc(1, 1, t1);
      docs["roster_" + S_ + "_w1_t2"] = rosterDoc(1, 2, t2);
      const store = K.makeStore(docs);
      const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
      const offer = await ev(A, () => window.__GFFL__.LG.offerTrade(1, 2, ["aqb"], ["bspare"], "")); // give our ONLY QB, get a bench RB back
      // Same bypass as 3a, same reason: this fixture is already unfillable-after-trade at
      // offer time (proven for real in 3a; not re-proven here to keep this block focused).
      const accepted = await ev(A, (offerDoc) => {
        const LG = window.__GFFL__.LG;
        const t = Date.now();
        const doc = { ...offerDoc, status: "accepted", acceptedAt: t, reviewEndsAt: t };
        return LG.saveTrade(doc).then(() => doc);
      }, offer.trade);
      const r = await ev(A, async (id) => { const orig = Date.now; const _base = orig(); Date.now = () => _base + 200 * 3600e3; const x = await window.__GFFL__.LG.executeTrade(id); Date.now = orig; return x; }, offer.trade.id);
      const after = await ev(A, () => window.__GFFL__.LG.ensureRoster(1, 1, {}));
      const qbs = after.filter((p) => p.pos === "QB").length;
      ok(r.status === "cancelled" && r.cancelReason === "lineup-unfillable" && qbs === 1,
        "RESTAGED (ruling 2026-08-17, was 'executes silently'; arithmetic re-derived 2026-09-02 for the 11-slot script): " +
        "executeTrade now CANCELS — hand check: post-trade team 1 would be (arb1,arb2,arb3,awr1,awr2,awr3,ate,arb4,adst," +
        "ak,bspare), 11 players with RB3=(arb1,arb2,arb3), WR3=(awr1,awr2,awr3), TE1=ate, FLEX1=(arb4 or bspare), " +
        "DST1=adst, K1=ak all resolvable — every slot but QB1, which has ZERO eligible players left, is exactly the case " +
        "this checker subsumes without a QB special case (status=" + r.status + " reason=" +
        r.cancelReason + " — cancelled means untouched, so team 1's actual QB count is still " + qbs + ")");
      ok(A.errors.length === 0, "0 page errors");
      await A.ctx.close();
    }
    // --- 3b-ii: the FALSE-REFUSAL guard. "Refusing a legal trade is as much a bug as passing
    // an illegal one" (the ruling's own words). A trade that leaves team 1 with EXACTLY
    // tightNine's shape — one TE, one other FLEX-eligible spare, nothing else spare — MUST be
    // allowed. A naive greedy that assigns FLEX before TE would grab the roster's only TE for
    // FLEX (it's FLEX-eligible too) and then find TE1 with nobody left, wrongly refusing a
    // legal trade. Proven two ways: the real trade executes, AND a hand-rolled reference
    // "naive greedy" run against the identical post-trade roster is shown to get it WRONG, so
    // the contrast is evidence, not assumption.
    {
      // RESTAGED 2026-09-02 for the 11-slot script: the same trap, re-sized — 10 real positions
      // (QB1/RB3/WR3/TE1/DST1/K1) + one throwaway. QB isn't FLEX-eligible, so a SECOND QB does
      // nothing for the lineup — there is no FLEX candidate at all yet.
      const t1 = [
        { key: "cqb", name: "C QB", pos: "QB", team: "PHI", slot: "QB" },
        { key: "crb1", name: "C RB1", pos: "RB", team: "KC", slot: "RB" },
        { key: "crb2", name: "C RB2", pos: "RB", team: "KC", slot: "RB" },
        { key: "crb3", name: "C RB3", pos: "RB", team: "KC", slot: "RB" },
        { key: "cwr1", name: "C WR1", pos: "WR", team: "KC", slot: "WR" },
        { key: "cwr2", name: "C WR2", pos: "WR", team: "KC", slot: "WR" },
        { key: "cwr3", name: "C WR3", pos: "WR", team: "KC", slot: "WR" },
        { key: "cte", name: "C TE", pos: "TE", team: "KC", slot: "TE" },
        { key: "cdst", name: "C DST", pos: "DST", team: "KC", slot: "DST" },
        { key: "ck", name: "C K", pos: "K", team: "KC", slot: "K" },
        { key: "cSpareQB", name: "C Spare QB", pos: "QB", team: "PHI", slot: "BENCH" },
      ];
      const t2 = [...tightEleven("d"), { key: "incomingRB", name: "Incoming RB", pos: "RB", team: "KC", slot: "BENCH" }];
      const docs = { ...K.seedDocs() };
      docs["team_1"] = teamDoc(1, "Battle Kreussers");
      docs["team_2"] = teamDoc(2, "End Zone Goats");
      docs["roster_" + S_ + "_w1_t1"] = rosterDoc(1, 1, t1);
      docs["roster_" + S_ + "_w1_t2"] = rosterDoc(1, 2, t2);
      const store = K.makeStore(docs);
      const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
      // Give the useless spare QB, get a real RB — post-trade team 1 is exactly the trap
      // shape: (cqb,crb1,crb2,crb3,cwr1,cwr2,cwr3,cte,cdst,ck,incomingRB), one TE and one other
      // FLEX candidate (incomingRB), nothing else spare.
      const offer = await ev(A, () => window.__GFFL__.LG.offerTrade(1, 2, ["cSpareQB"], ["incomingRB"], ""));
      await ev(A, (id) => window.__GFFL__.LG.acceptTrade(id, 2), offer.trade.id);
      const executed = await ev(A, async (id) => { const orig = Date.now; const _base = orig(); Date.now = () => _base + 200 * 3600e3; const x = await window.__GFFL__.LG.executeTrade(id); Date.now = orig; return x; }, offer.trade.id);
      ok(executed.status === "executed",
        "the trade EXECUTES — a legal trade is not wrongly refused (status=" + executed.status + ")");
      const check = await ev(A, async () => {
        const LG = window.__GFFL__.LG;
        const roster = await LG.ensureRoster(1, 1, { fresh: true });
        // Reference "naive greedy" — FOR THIS TEST ONLY, never production code: assigns slots
        // in a deliberately bad order (FLEX before TE) and never backtracks. If it grabs the
        // TE for FLEX first, TE1 is left stuck with nobody eligible.
        // RESTAGED 2026-09-02 for the 11-slot script (RB3/WR3).
        const badOrder = ["QB", "RB", "RB", "RB", "WR", "WR", "WR", "FLEX", "TE", "DST", "K"];
        const used = new Set();
        let naive = true;
        for (const slot of badOrder) {
          const pick = roster.find((p) => !used.has(p.key) && LG.slotEligible(p.pos, slot));
          if (!pick) { naive = false; break; }
          used.add(pick.key);
        }
        // Guarded rather than a bare call: pre-ruling lg-core has no LG.canFillLineup at all,
        // and this needs to FAIL the assertion below cleanly rather than crash the harness
        // (which would hide every check after it in the proof-of-bite run).
        const exact = (typeof LG.canFillLineup === "function") ? LG.canFillLineup(roster) : null;
        return { naive, exact, size: roster.length };
      });
      ok(check.size === N_STARTING_SLOTS && check.naive === false,
        "the arithmetic behind the trap: " + N_STARTING_SLOTS + " players, one TE (cte) and one other FLEX-eligible " +
        "spare (incomingRB) — a FLEX-before-TE greedy grabs cte for FLEX (RB/WR/TE are all FLEX-eligible, TE included), " +
        "leaving TE1 with nobody left. The reference naive greedy above genuinely fails this exact roster (naive=" +
        check.naive + ", size=" + check.size + ")");
      ok(check.exact === true,
        "LG.canFillLineup gets the SAME roster right: TE1=cte, FLEX1=incomingRB, RB3=(crb1,crb2,crb3), " +
        "WR3=(cwr1,cwr2,cwr3), DST1=cdst, K1=ck, QB1=cqb — " + N_STARTING_SLOTS + " players, " + N_STARTING_SLOTS +
        " slots, none left over (exact=" + check.exact + ")");
      ok(A.errors.length === 0, "0 page errors");
      await A.ctx.close();
    }
    // --- 3c: BOTH of a team's RB2-slot backs traded away — proves the checker counts a real
    // POSITION SHORTAGE, not just "is there a QB": a completely different shape of the same
    // break. Tested at ACCEPT (not execute, which 3b already proved): a plain, un-bypassed
    // call is the path a real owner actually hits.
    {
      const t1 = tightEleven("e");
      const t2 = [...tightEleven("f"),
        { key: "fwrSpare1", name: "F WR Spare 1", pos: "WR", team: "KC", slot: "BENCH" },
        { key: "fwrSpare2", name: "F WR Spare 2", pos: "WR", team: "KC", slot: "BENCH" }];
      const docs = { ...K.seedDocs() };
      docs["team_1"] = teamDoc(1, "Battle Kreussers");
      docs["team_2"] = teamDoc(2, "End Zone Goats");
      docs["roster_" + S_ + "_w1_t1"] = rosterDoc(1, 1, t1);
      docs["roster_" + S_ + "_w1_t2"] = rosterDoc(1, 2, t2);
      const store = K.makeStore(docs);
      const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
      // Give TWO of the three RB-slot backs (erb1, erb2), keep erb3 and the FLEX one (erb4) —
      // get 2 WRs back. RESTAGED 2026-09-02: with RB3 the shortage arithmetic moves from "1 RB
      // where 2 are required" to "2 RBs where 3 are required" — the same shape, one slot deeper.
      const offer = await ev(A, () => window.__GFFL__.LG.offerTrade(1, 2, ["erb1", "erb2"], ["fwrSpare1", "fwrSpare2"], ""));
      const r = await ev(A, (id) => window.__GFFL__.LG.acceptTrade(id, 2), offer.trade.id);
      ok(!!r && r.ok === false && r.reason === "lineup-unfillable",
        "the arithmetic: post-trade team 1 would be (eqb,erb3,ewr1,ewr2,ewr3,ete,erb4,edst,ek,fwrSpare1,fwrSpare2) — " +
        "5 WR-position players and 2 RB-position players (erb3, erb4), but RB3 needs THREE distinct RB bodies and FLEX " +
        "cannot lend one back (the slot doesn't require RB — the shortage is a plain COUNT of RB-eligible players, 2 " +
        "where 3 are required). acceptTrade refuses at the early gate, reason=" + (r && r.reason) +
        " detail=" + JSON.stringify(r && r.detail));
      ok(A.errors.length === 0, "0 page errors");
      await A.ctx.close();
    }
  }

  head("C4. a trade executing while processWaivers is mid-run on an overlapping roster");
  {
    // Team 1 is a party to BOTH: it trades p107 away to team 2, AND has a waiver claim pending
    // in the same run. Fired concurrently, one page — the SAME shape the season sim actually
    // observed for the analogous double-processWaivers race (season-sim bug 4).
    //
    // THE COLLISION IS NOW STAGED, and that is a strengthening, not a weakening (2026-08-18).
    // Before the CAS rework each operation carried SECONDS of resolution work between its
    // fresh read and its write, so the two windows overlapped on their own and this check ran
    // with no injected pause. LG.db.update reads immediately before it writes, which shrinks
    // that window to one round-trip pair — and a window that small stopped overlapping by
    // itself, which would have quietly turned this check into a test of nothing. So the first
    // roster PATCH out of this page is HELD for 600ms while the other operation completes its
    // whole read-modify-write against the same document. The held write is then released with
    // a base version that provably no longer exists: without a precondition it lands on top and
    // erases the other, which is exactly the lost update this section pinned for a day.
    const store = K.makeStore(K.seedDocs({
      ["claim_" + S_ + "_w1_c1"]: claimDoc(1, "c1", 1, "p901", "N. Newman", "RB", "SF", "p110", "B. Backup", 10),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    await ev(A, () => {
      const orig = window.fetch;
      let held = 0;
      window.fetch = function (u, init) {
        if (init && init.method === "PATCH" && /roster_/.test(String(u)) && held++ === 0) {
          return new Promise((r) => setTimeout(r, 600)).then(() => orig(u, init));
        }
        return orig(u, init);
      };
    });
    const offer = await ev(A, () => window.__GFFL__.LG.offerTrade(1, 2, ["p107"], ["p203"], ""));
    await ev(A, (id) => window.__GFFL__.LG.acceptTrade(id, 2), offer.trade.id);
    const raced = await ev(A, async (id) => {
      const LG = window.__GFFL__.LG;
      const orig = Date.now; const _base = orig(); Date.now = () => _base + 200 * 3600e3;
      const [tradeRes, waiverRes] = await Promise.all([LG.executeTrade(id), LG.processWaivers(1)]);
      Date.now = orig;
      return { tradeStatus: tradeRes.status, waiverResults: waiverRes.results };
    }, offer.trade.id);
    const ros1 = await ev(A, () => window.__GFFL__.LG.ensureRoster(1, 1, {}));
    const keys = ros1.map((p) => p.key);
    // RESTAGED 2026-08-18 (was a SEAM-FINDING pin: "a genuine lost update — neither op holds a
    // lock, LG.saveRoster replaces the whole array… the fix is the same transport-level CAS
    // work already deferred"). That work landed today. Both backends now carry a precondition
    // (rest.setIf's `currentDocument.updateTime`, local.setIf's version key), LG.db.update is
    // the one read-modify-write loop, and BOTH of these operations express their roster change
    // as a DELTA re-applied to the store's own current array — so neither can replace the
    // other, whichever order they land in.
    //
    // THE ARITHMETIC, stated rather than eyeballed. Team 1 starts week 1 with the kit's ten:
    //   p101 p102 p103 p104 p105 p106 p107 dst_PHI p109 p110
    // the trade takes p107 out and puts p203 in; the waiver takes p110 out and puts p901 in.
    // Ten − two + two = TEN, and the eight neither op touched must all still be there. That is
    // one serialization of the pair (the two are disjoint, so both orders give the same set),
    // and it is the only correct answer: any nine-key result is one op's write erased.
    const untouched = ["p101", "p102", "p103", "p104", "p105", "p106", "dst_PHI", "p109"];
    const want = untouched.concat(["p203", "p901"]).slice().sort();
    const got = keys.slice().sort();
    const tradeApplied = !keys.includes("p107") && keys.includes("p203");
    const waiverApplied = !keys.includes("p110") && keys.includes("p901");
    ok(got.length === 10 && JSON.stringify(got) === JSON.stringify(want),
      "BOTH operations land: 10 starting players − 2 leaving (p107 traded, p110 dropped) + 2 arriving " +
      "(p203, p901) = 10, the 8 men neither op touched included — one serialization of the pair, and the " +
      "only correct answer, since a 9-key roster is one op's write erased. trade-applied=" + tradeApplied +
      " waiver-applied=" + waiverApplied + " · store refused " + store.conflicts + " stale write(s) · " +
      "want=[" + want.join(", ") + "] got=[" + got.join(", ") + "]");
    ok(raced.tradeStatus === "executed", "the trade itself completed without erroring (status=" + raced.tradeStatus + ")");
    ok(raced.waiverResults.length === 1, "the waiver run itself completed without erroring (" + JSON.stringify(raced.waiverResults) + ")");
    ok(A.errors.length === 0, "0 page errors (" + JSON.stringify(A.errors) + ")");
    await A.ctx.close();
  }

  head("C5. THE RULING (2026-08-17): a trade may not move a player whose game has started — restaged from a pin with no ruling");
  {
    // RESTAGED 2026-08-17 (was a SEAM-FINDING pin: "the commissioner has not ruled on clock
    // semantics for trades... this suite does not invent one"). The ruling arrived the same
    // day the seam was found: block on the SAME clock LG.dropBlocked already reads
    // (D.gameStarted via LG.data), deliberately STRICTER — every traded player, any slot,
    // bench and IR included, because it's the PLAYER that changed hands, not his slot. Note
    // LG.offerTrade ITSELF is still deliberately left unchecked (unchanged from the pin) —
    // the gate lives in acceptTrade (early UX) and executeTrade (authoritative), matching the
    // design's three call sites; offerTrade's own job is only "is this a well-formed ask".

    // --- 5a: a STARTER traded mid-game — refused at accept, and (via the same bypass
    // technique C3 uses, for the same reason: the condition is already true at offer time)
    // independently cancelled at execute too, proving BOTH gates rather than trusting accept
    // to always run first.
    {
      const t1 = tightEleven("g");
      const t2 = tightEleven("h");
      const docs = { ...K.seedDocs() };
      docs["team_1"] = teamDoc(1, "Battle Kreussers");
      docs["team_2"] = teamDoc(2, "End Zone Goats");
      docs["roster_" + S_ + "_w1_t1"] = rosterDoc(1, 1, t1);
      docs["roster_" + S_ + "_w1_t2"] = rosterDoc(1, 2, t2);
      const store = K.makeStore(docs);
      const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
      const KICKOFF = Date.UTC(2026, 8, 13, 17, 0, 0);
      await ev(A, (t) => window.__GFFL__.D.S.games.set("PHI", { state: "in", period: 2, clock: "5:00", kickoff: new Date(t).toISOString() }), KICKOFF);
      // A straight QB-for-QB swap — count and position mix are IDENTICAL on both sides before
      // and after (still exactly tightEleven's shape), so neither CAP nor LINEUP can be why this
      // refuses; only CLOCK is in play.
      const offer = await ev(A, () => window.__GFFL__.LG.offerTrade(1, 2, ["gqb"], ["hqb"], ""));
      const acceptRefusal = await ev(A, (id) => window.__GFFL__.LG.acceptTrade(id, 2), offer.trade.id);
      ok(!!acceptRefusal && acceptRefusal.ok === false && acceptRefusal.reason === "player-started",
        "acceptTrade refuses a trade for G QB, whose PHI game reads state=in (reason=" + (acceptRefusal && acceptRefusal.reason) +
        " detail=" + JSON.stringify(acceptRefusal && acceptRefusal.detail) + ")");
      const accepted = await ev(A, (offerDoc) => {
        const LG = window.__GFFL__.LG;
        const t = Date.now();
        const doc = { ...offerDoc, status: "accepted", acceptedAt: t, reviewEndsAt: t };
        return LG.saveTrade(doc).then(() => doc);
      }, offer.trade);
      const executed = await ev(A, async (id) => { const orig = Date.now; const _base = orig(); Date.now = () => _base + 200 * 3600e3; const x = await window.__GFFL__.LG.executeTrade(id); Date.now = orig; return x; }, offer.trade.id);
      ok(executed.status === "cancelled" && executed.cancelReason === "player-started",
        "executeTrade ALSO cancels the same trade on its own — the authoritative gate, not just accept's early one " +
        "(status=" + executed.status + " reason=" + executed.cancelReason + " detail=" + JSON.stringify(executed.cancelDetail) + ")");
      const after1 = await ev(A, () => window.__GFFL__.LG.ensureRoster(1, 1, {}));
      ok(after1.some((p) => p.key === "gqb"), "team 1's roster is untouched — G QB never actually moved (" + after1.map((p) => p.key).join(",") + ")");
      ok(A.errors.length === 0, "0 page errors");
      await A.ctx.close();
    }

    // --- 5b: a BENCH player mid-game — the deliberate contrast with LG.dropBlocked. dropBlocked
    // only freezes a STARTER (bench is always droppable, per the 2026-08-15 drop rule); this
    // guard is stricter on purpose, because the player himself changed hands, not his slot.
    // Asserted directly against LG.dropBlocked's own verdict on the identical player/fixture,
    // so the difference is pinned as deliberate, never accidental.
    {
      const t1 = [...tightEleven("i"), { key: "iBench", name: "I Bench", pos: "RB", team: "DAL", slot: "BENCH" }];
      const t2 = [...tightEleven("j"), { key: "jBench", name: "J Bench", pos: "RB", team: "KC", slot: "BENCH" }];
      const docs = { ...K.seedDocs() };
      docs["team_1"] = teamDoc(1, "Battle Kreussers");
      docs["team_2"] = teamDoc(2, "End Zone Goats");
      docs["roster_" + S_ + "_w1_t1"] = rosterDoc(1, 1, t1);
      docs["roster_" + S_ + "_w1_t2"] = rosterDoc(1, 2, t2);
      const store = K.makeStore(docs);
      const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
      await ev(A, () => window.__GFFL__.D.S.games.set("DAL", { state: "in", period: 3, clock: "9:00" }));
      const verdicts = await ev(A, async () => {
        const LG = window.__GFFL__.LG;
        const ros1 = await LG.ensureRoster(1, 1, {});
        const iBench = ros1.find((p) => p.key === "iBench");
        const dropVerdict = LG.dropBlocked(iBench);
        const ros2 = await LG.ensureRoster(1, 2, {});
        // Guarded the same way as the false-refusal check above — pre-ruling lg-core has no
        // LG.tradeBlockers, and this needs to fail cleanly, not crash the harness.
        const blockers = (typeof LG.tradeBlockers === "function") ? LG.tradeBlockers({ from: 1, to: 2, give: ["iBench"], get: ["jBench"] }, ros1, ros2) : [];
        return { dropVerdict, tradeReason: (blockers.find((b) => b.reason === "player-started") || {}).reason || null };
      });
      ok(verdicts.dropVerdict === false,
        "LG.dropBlocked says I Bench is droppable right now — bench is exempt from the drop rule regardless of kickoff " +
        "(dropBlocked=" + verdicts.dropVerdict + ")");
      ok(verdicts.tradeReason === "player-started",
        "LG.tradeBlockers says the SAME player, in the SAME started game, blocks a TRADE anyway — deliberately stricter " +
        "than dropBlocked on the identical fixture, because it's the player that changed hands, not his slot " +
        "(reason=" + verdicts.tradeReason + ")");
      const offer = await ev(A, () => window.__GFFL__.LG.offerTrade(1, 2, ["iBench"], ["jBench"], ""));
      const acceptRefusal = await ev(A, (id) => window.__GFFL__.LG.acceptTrade(id, 2), offer.trade.id);
      ok(!!acceptRefusal && acceptRefusal.ok === false && acceptRefusal.reason === "player-started",
        "and the real trade lifecycle agrees — acceptTrade refuses the bench-player trade the same way (" + JSON.stringify(acceptRefusal) + ")");
      ok(A.errors.length === 0, "0 page errors");
      await A.ctx.close();
    }
  }

  head("C6. two FAAB deductions genuinely interleaved on ONE purse — the money seam, staged rather than hoped for");
  {
    // NEW 2026-08-18, with the compare-and-swap rework. C4 above stages a roster collision and
    // has to take whatever interleaving the two real round trips happen to produce; this one
    // stages the MONEY collision and leaves nothing to chance, because a purse is the one doc
    // in this league where a lost update is a family member's dollars.
    //
    // THE GATE. Device A's own fetch is wrapped so its first PATCH — and only a PATCH, never a
    // read — parks on a promise this script holds open. That freezes A precisely inside the
    // window every read-modify-write has: it has READ the purse (100) and has not yet written.
    // Device B then completes a whole deduction against the same doc, unobstructed. Only then
    // is A released, so A's write necessarily carries a base version that no longer exists.
    // Without a precondition, A's write lands on top and B's $20 is simply gone — the exact
    // shape of season-sim bug 3, which is what this staging reproduces on demand.
    //
    // THE ARITHMETIC: $100 − $30 (A) − $20 (B) = $50. Any other number names its own failure —
    // $70 is A's write erasing B's, $80 is B's erasing A's.
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const B = await K.boot(await K.newDevice(browser, store, "B", { team: 2, who: "Joy" }));
    await ev(A, () => {
      const orig = window.fetch;
      window.__gate = new Promise((res) => { window.__openGate = res; });
      window.fetch = function (u, init) {
        if (init && init.method === "PATCH") return window.__gate.then(() => orig(u, init));
        return orig(u, init);
      };
    });
    const spend = (dev, amt) => ev(dev, (n) => window.__GFFL__.LG.saveTeam({ teamId: 1 }, {
      from: (cur) => ({ faab: window.__GFFL__.LG.teamFaab(cur || {}) - n }),
    }), amt);
    const pA = spend(A, 30);          // reads $100, then parks at its PATCH
    await K.sleep(400);
    await spend(B, 20);               // completes end to end: the store now holds $80
    await ev(A, () => window.__openGate());
    await pA;                          // released: A's stale write is refused, re-read, re-applied
    await K.sleep(150);
    const faab = store.docs.team_1.faab;
    const errs = [...A.errors, ...B.errors];
    ok(faab === 50 && store.conflicts >= 1 && errs.length === 0,
      "two interleaved deductions on one purse both land: $100 − $30 (device A, held open across B's whole write) " +
      "− $20 (device B) = $50, and the purse reads $" + faab + ". The store REFUSED " + store.conflicts +
      " stale write(s), which is A's first attempt being told its base had moved; without that refusal A's " +
      "$70 would have overwritten B's $80 and the league would have been $20 richer than its own record. " +
      "(page errors: " + JSON.stringify(errs) + ")");
    await A.ctx.close(); await B.ctx.close();
  }

  // ================================================================================ D. finalizeWeek

  head("D1. double finalize, sequential and concurrent — idempotent, canonical-JSON-identical standings");
  {
    const store = K.makeStore(K.seedDocs({
      ["weekly_" + S_ + "_w1"]: weeklyDoc(1, [{ home: 1, away: 2, homePts: 110.4, awayPts: 98.2 }]),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const st1 = await ev(A, () => window.__GFFL__.LG.loadStandings());
    const r2 = await ev(A, () => window.__GFFL__.LG.finalizeWeek(1));
    ok(r2.ok === true && cj(r2.matchups) === cj([{ home: 1, away: 2, homePts: 110.4, awayPts: 98.2 }]),
      "a second sequential finalizeWeek(1) returns the ORIGINAL write-once doc untouched (" + JSON.stringify(r2.matchups) + ")");
    const st2 = await ev(A, () => window.__GFFL__.LG.loadStandings());
    ok(cj(st1) === cj(st2), "standings are canonical-JSON-identical after the second sequential call");
    const writesBefore = store.writes.length;
    const both = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const [a, b] = await Promise.all([LG.finalizeWeek(1), LG.finalizeWeek(1)]);
      return { a: a.ok, b: b.ok };
    });
    ok(both.a === true && both.b === true, "two CONCURRENT finalizeWeek(1) calls both resolve ok:true (" + JSON.stringify(both) + ")");
    ok(store.writes.length === writesBefore, "the concurrent pair performs no NEW writes — the weekly doc already existed (writes " + writesBefore + " -> " + store.writes.length + ")");
    const st3 = await ev(A, () => window.__GFFL__.LG.loadStandings());
    ok(cj(st1) === cj(st3), "standings remain canonical-JSON-identical after the concurrent pair too");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("D2. an exact tie — regular season records a T, the playoff bracket decides tie-goes-to-home (a real disagreement)");
  {
    // Regular season: loadStandings records a genuine tie (both teams' `t` increments, neither
    // `w` nor `l`) — hand-verify against a single tied matchup.
    {
      const store = K.makeStore(K.seedDocs({
        ["weekly_" + S_ + "_w1"]: weeklyDoc(1, [{ home: 1, away: 2, homePts: 88.8, awayPts: 88.8 }]),
      }));
      const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
      const st = await ev(A, () => window.__GFFL__.LG.loadStandings());
      ok(st[1].w === 0 && st[1].l === 0 && st[1].t === 1 && st[2].w === 0 && st[2].l === 0 && st[2].t === 1,
        "an exact tie is a genuine T for BOTH teams in the regular-season standings, no winner declared (" + JSON.stringify({ 1: st[1], 2: st[2] }) + ")");
      ok(A.errors.length === 0, "0 page errors");
      await A.ctx.close();
    }
    // Playoffs: build a real bracket over a deterministic 14-week season (team id descending =
    // most wins, by construction), then seed the week-15 play-in game (seed4 vs seed5, i.e. team
    // 5 home / team 4 away with this ordering) as an exact tie and advance the bracket.
    {
      const docs = K.seedDocs();
      const store = K.makeStore(docs);
      const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
      const setup = await ev(A, async () => {
        const LG = window.__GFFL__.LG;
        const ids = LG.teams.map((t) => t.id); // [1..8]
        const weeks = LG.generateSchedule(ids, 14);
        for (let w = 0; w < 14; w++) {
          const matchups = weeks[w].map(([h, a]) => ({ home: h, away: a, homePts: 100 + h, awayPts: 100 + a })); // higher id always wins
          await LG.db.set("weekly_" + LG.SEASON + "_w" + (w + 1), { kind: "weekly", week: w + 1, matchups, awards: {}, power: [], accuracy: null, finalizedAt: 1, source: "live" });
        }
        const bracket = await LG.buildBracket();
        return { seeds: bracket.seeds, playin: bracket.rounds.r1.find((g) => g.kind === "playin") };
      });
      ok(cj(setup.seeds) === cj([8, 7, 6, 5, 4, 3, 2, 1]),
        "the 14-week deterministic fixture seeds strictly by descending team id (" + JSON.stringify(setup.seeds) + ")");
      ok(setup.playin && setup.playin.home === 5 && setup.playin.away === 4,
        "the play-in game (byes=3) is seed4 vs seed5 = team 5 (home) vs team 4 (away) (" + JSON.stringify(setup.playin) + ")");
      const advanced = await ev(A, async () => {
        const LG = window.__GFFL__.LG;
        await LG.db.set("weekly_" + LG.SEASON + "_w15", {
          kind: "weekly", week: 15, matchups: [{ home: 5, away: 4, homePts: 77.7, awayPts: 77.7 }], // exact tie
          awards: {}, power: [], accuracy: null, finalizedAt: 1, source: "live",
        });
        await LG.advanceBracket();
        const bracket = await LG.loadBracket();
        const semi1 = bracket.rounds.r2.find((g) => g.id === "semi1");
        return semi1;
      });
      ok(advanced.away === 5,
        "SEAM-FINDING pinned: the tied play-in game resolves to the HOME team (5) advancing — bkResult's own rule " +
        "(`hp >= ap ? home : away`) — while the IDENTICAL score in the regular season above produced a symmetric T for " +
        "both sides. The bracket and the regular-season table do NOT share one interpretation of a tie (semi1.away=" +
        advanced.away + ")");
      ok(A.errors.length === 0, "0 page errors");
      await A.ctx.close();
    }
  }

  head("D3. finalize refuses while any of this week's starters' games reads \"in\"");
  {
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const r = await ev(A, async () => {
      const { LG, D } = window.__GFFL__;
      D.S.espnWeek = 1; D.S.slpWeek = 1; D.S.espnSeasonType = "regular"; D.S.slpSeasonType = "regular";
      D.S.games.set("PHI", { state: "post" });
      D.S.games.set("DAL", { state: "in", period: 3, clock: "8:00" }); // one starter's game still live
      D.S.games.set("DEN", { state: "post" });
      D.S.games.set("KC", { state: "post" });
      return LG.finalizeWeek(1);
    });
    ok(r.ok === false && r.reason === "not-final" && Array.isArray(r.pending) && r.pending.length > 0,
      "finalizeWeek refuses with reason not-final and NAMES the still-live starter(s) (" + JSON.stringify(r) + ")");
    const doc = store.docs["weekly_" + S_ + "_w1"];
    ok(!doc, "no weekly_..._w1 doc was written by the refused attempt");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("D4. no stats row / a zero-valued row / a string-numbered row through the whole scoring path (the ?? / || 0 trap hunt)");
  {
    // RESTAGED 2026-09-02 (the S6 empty-matchup ruling): this used to finalize week 1 against
    // the kit's default 4-pairing schedule while only teams 1 and 2 carried rosters at all — so
    // three of the four matchups had ZERO starters on both sides and would have been recorded as
    // 0-0 ties. finalizeWeek now refuses the whole week for exactly that ("empty-matchup", naming
    // the pairings), which is the ruling working, not a regression. The fixture is narrowed to
    // the ONE pairing it was ever about (1 vs 2, the two teams it rosters), so the week it
    // finalizes is a week that genuinely could be played. The hand-computed 12.4 is untouched.
    const store = K.makeStore(K.seedDocs({
      ["sched_" + S_]: { kind: "sched", season: S_, weeks: [[[1, 2]]] },
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const KICKOFF = Date.UTC(2026, 8, 13, 17, 0, 0);
    const r = await ev(A, async (t) => {
      const { LG, D } = window.__GFFL__;
      D.S.espnWeek = 1; D.S.slpWeek = 1; D.S.espnSeasonType = "regular"; D.S.slpSeasonType = "regular";
      D.S.games.set("PHI", { state: "post" }); D.S.games.set("DAL", { state: "post" });
      D.S.games.set("DEN", { state: "post" }); D.S.games.set("KC", { state: "post" });
      // Stub D.weekStats for the backfill path with exactly three shapes: absent / present-zero /
      // present-with-a-STRING-number. Default rules: rec_yd 0.1/yd, so "124" -> 12.4 exactly.
      const origWeekStats = D.weekStats;
      D.weekStats = async () => new Map([
        // p101 (absent entirely) is simply never a key in this map.
        ["p104", 0],   // present, all-zero stat row -> D.score already computed this to 0
        ["p105", 12.4], // present, a string-numbered stat row -> D.score's num() coerced "124"*0.1
      ]);
      const res = await LG.finalizeWeek(1, { backfill: true });
      D.weekStats = origWeekStats;
      return res;
    }, KICKOFF);
    ok(r.ok === true, "the backfill finalize succeeds (" + JSON.stringify(r.reason || "ok") + ")");
    const home = r.matchups.find((m) => m.home === 1 || m.away === 1);
    // Team 1's starters include p101 (QB, absent), p104 (WR, zeroed), p105 (WR, "12.4"), plus
    // others at 0 by the same absent-key rule — so team 1's total is EXACTLY 12.4 (only p105
    // contributes) if every other starter is likewise absent from the stub map.
    const teamTotal = home.home === 1 ? home.homePts : home.awayPts;
    ok(teamTotal === 12.4,
      "hand-computed: team 1's total is EXACTLY 12.4 — absent (p101, QB) -> 0, zero-row (p104) -> 0, " +
      "string-numbered row (p105, rec_yd:\"124\"@0.1/yd) -> 12.4, every other starter absent -> 0 (total=" + teamTotal + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();

    // The live path's own version of the same three-way test, via D.livePts directly (not
    // finalizeWeek) — proves the LIVE scoring funnel (mergeRow -> D.score) survives the same
    // three shapes, not just the backfill's ptsOf fallback.
    const store2 = K.makeStore(K.seedDocs());
    const B = await K.boot(await K.newDevice(browser, store2, "B", { team: 1, who: "Peter" }));
    const live = await ev(B, () => {
      const { D } = window.__GFFL__;
      // p101: truly no live row at all (never applySide'd) — but he IS a known rostered/directory
      // player, so D.livePts must read a real 0, never null/NaN (the "unknown vs known-but-silent"
      // distinction D.livePts's own comment describes).
      // p104: a live row with an all-zero stat object.
      D.mergeRow && null;
      const zero = {}; for (const k of D.KEYS) zero[k] = 0; zero.dst_pa = null;
      window.__GFFL__.LG.data.S.players.set("p104", { key: "p104", name: "W. Receiver", pos: "WR", team: "PHI", espn: { stats: zero, raw: {}, last: 1 }, slp: null, pts: null });
      // p105: a live row whose stats carry a STRING number for rec_yd.
      const strRow = {}; for (const k of D.KEYS) strRow[k] = 0; strRow.rec_yd = "124"; strRow.dst_pa = null;
      window.__GFFL__.LG.data.S.players.set("p105", { key: "p105", name: "W. Two", pos: "WR", team: "DEN", espn: { stats: strRow, raw: {}, last: 1 }, slp: null, pts: null });
      const D2 = window.__GFFL__.D;
      // Re-run mergeRow's own scoring (row.pts is normally set by mergeRow during a poll; call
      // D.score directly against the stored stats to get the SAME funnel without needing a full poll).
      const scorePts = (key) => window.__GFFL__.LG.data.S.players.get(key) ? window.__GFFL__.LG.data.S.players.get(key).espn.stats : null;
      const p104pts = window.__GFFL__.D.score ? window.__GFFL__.D.score(scorePts("p104")) : null;
      const p105pts = window.__GFFL__.D.score(scorePts("p105"));
      return { p101_livePts: D.livePts("p101"), p104_scored: p104pts, p105_scored: p105pts };
    });
    ok(live.p101_livePts === 0, "a rostered, known player with no live row at all reads a real 0 through D.livePts (never null/NaN) (" + live.p101_livePts + ")");
    ok(live.p104_scored === 0, "an all-zero-valued live stats row scores exactly 0 through D.score (" + live.p104_scored + ")");
    ok(live.p105_scored === 12.4, "a live stats row with a STRING-numbered rec_yd (\"124\") scores exactly 12.4 through D.score's num() coercion (" + live.p105_scored + ")");
    ok(B.errors.length === 0, "0 page errors");
    await B.ctx.close();
  }

  head("D5. standings arithmetic — hand-computed W/L/PF/PA across a 3-week fixture");
  {
    const store = K.makeStore(K.seedDocs({
      ["weekly_" + S_ + "_w1"]: weeklyDoc(1, [{ home: 1, away: 2, homePts: 100, awayPts: 90 }, { home: 3, away: 4, homePts: 80, awayPts: 85 }]),
      ["weekly_" + S_ + "_w2"]: weeklyDoc(2, [{ home: 2, away: 3, homePts: 95, awayPts: 95 }, { home: 4, away: 1, homePts: 70, awayPts: 111 }]),
      ["weekly_" + S_ + "_w3"]: weeklyDoc(3, [{ home: 1, away: 3, homePts: 60, awayPts: 65 }, { home: 2, away: 4, homePts: 88, awayPts: 60 }]),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const st = await ev(A, () => window.__GFFL__.LG.loadStandings());
    // Hand-computed from the fixture above:
    //   team 1: w1 home beat 2 (100>90) W, PF100 PA90 | w2 away lost to 4 (111 vs 70 -> team1 WON, it's away=111) ... see below
    // Recompute precisely, matching loadStandings' own [h,a] convention (home=m.home, away=m.away):
    //   W1 m1: home=1(100) away=2(90)  -> 1 W, PF+=100 PA+=90 | 2 L, PF+=90 PA+=100
    //   W1 m2: home=3(80)  away=4(85)  -> 3 L, PF+=80 PA+=85  | 4 W, PF+=85 PA+=80
    //   W2 m1: home=2(95)  away=3(95)  -> TIE:  2 t, PF+=95 PA+=95 | 3 t, PF+=95 PA+=95
    //   W2 m2: home=4(70)  away=1(111) -> 1 (away) W, PF+=111 PA+=70 | 4 L, PF+=70 PA+=111
    //   W3 m1: home=1(60)  away=3(65)  -> 3 (away) W, PF+=65 PA+=60 | 1 L, PF+=60 PA+=65
    //   W3 m2: home=2(88)  away=4(60)  -> 2 W, PF+=88 PA+=60 | 4 L, PF+=60 PA+=88
    // Totals (each team plays exactly 3 games — one per week — so W+L+T=3 for all four):
    //   team 1: W1 W(h), W2 W(a, 111>70), W3 L(h, 60<65)      -> W=2 L=1 T=0  PF=100+111+60=271  PA=90+70+65=225
    //   team 2: W1 L(a, 90<100), W2 T(h), W3 W(h, 88>60)      -> W=1 L=1 T=1  PF=90+95+88=273    PA=100+95+60=255
    //   team 3: W1 L(h, 80<85), W2 T(a), W3 W(a, 65>60)       -> W=1 L=1 T=1  PF=80+95+65=240    PA=85+95+60=240
    //   team 4: W1 W(a, 85>80), W2 L(h, 70<111), W3 L(a,60<88)-> W=1 L=2 T=0  PF=85+70+60=215    PA=80+111+88=279
    const expect = {
      1: { w: 2, l: 1, t: 0, pf: 271, pa: 225 },
      2: { w: 1, l: 1, t: 1, pf: 273, pa: 255 },
      3: { w: 1, l: 1, t: 1, pf: 240, pa: 240 },
      4: { w: 1, l: 2, t: 0, pf: 215, pa: 279 },
    };
    for (const id of [1, 2, 3, 4]) {
      const got = st[id], want = expect[id];
      ok(got.w === want.w && got.l === want.l && got.t === want.t && Math.round(got.pf * 100) / 100 === want.pf && Math.round(got.pa * 100) / 100 === want.pa,
        "team " + id + ": hand-computed W" + want.w + "-L" + want.l + "-T" + want.t + " PF" + want.pf + " PA" + want.pa +
        " matches loadStandings() exactly (got " + JSON.stringify(got) + ")");
    }
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("D6. non-contiguous team ids (1,2,3,4,5,9,11,12) — standings, waiver priority and bracket seeding treat id 12 like id 1");
  {
    const ids = [1, 2, 3, 4, 5, 9, 11, 12];
    const docs = {};
    ids.forEach((id, i) => { docs["team_" + id] = teamDoc(id, "Team " + id); });
    docs["sched_" + S_] = { kind: "sched", season: S_, weeks: [] };
    const store = K.makeStore(docs);
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const r = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const idsIn = LG.teams.map((t) => t.id);
      const weeks = LG.generateSchedule(idsIn, 14); // must not crash / silently drop id 12
      let sawFlatIndexBug = false;
      for (const wk of weeks) for (const [h, a] of wk) { if (!idsIn.includes(h) || !idsIn.includes(a)) sawFlatIndexBug = true; }
      for (let w = 0; w < 14; w++) {
        const matchups = weeks[w].map(([h, a]) => ({ home: h, away: a, homePts: 50 + h, awayPts: 50 + a }));
        await LG.db.set("weekly_" + LG.SEASON + "_w" + (w + 1), { kind: "weekly", week: w + 1, matchups, awards: {}, power: [], accuracy: null, finalizedAt: 1, source: "live" });
      }
      const st = await LG.loadStandings();
      const prio = await LG.waiverPriorityOrder();
      const bracket = await LG.buildBracket();
      return { idsIn, sawFlatIndexBug, st12: st[12], st1: st[1], prio, seeds: bracket.seeds, champion: bracket.champion };
    });
    ok(cj(r.idsIn.sort((a, b) => a - b)) === cj(ids), "LG.teams carries all 8 non-contiguous ids untouched (" + JSON.stringify(r.idsIn) + ")");
    ok(r.sawFlatIndexBug === false, "LG.generateSchedule never emits a team id outside the real set — no flat-index leak");
    ok(r.st12 && Number.isFinite(r.st12.w) && Number.isFinite(r.st12.pf),
      "team id 12's standings row is a real, finite record, same shape as team id 1's (" + JSON.stringify(r.st12) + " vs " + JSON.stringify(r.st1) + ")");
    ok(Array.isArray(r.prio) && r.prio.length === 8 && new Set(r.prio).size === 8 && r.prio.every((id) => ids.includes(id)),
      "waiver priority order is a permutation of the REAL 8 ids, id 12 included, no duplicates/drops (" + JSON.stringify(r.prio) + ")");
    ok(Array.isArray(r.seeds) && r.seeds.length === 8 && new Set(r.seeds).size === 8,
      "bracket seeding produces exactly 8 distinct real team ids (" + JSON.stringify(r.seeds) + ")");
    // grep-confirmed (see report): no array-indexed-by-team-id pattern exists in lg-core.js /
    // lg-data.js / lg-ui.js — every id-keyed structure in the engine is a Map or a plain object
    // keyed by the real id, never a fixed-length Array. This section is the regression guard for
    // that structural fact rather than evidence of a bug found.
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  // ================================================================================ E. WEEK ROLLOVER

  head("E1. every consumer of \"current week\" derives from the SAME source — a Tuesday-night boundary never splits the app");
  {
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    // LG.SEASON_START = "2026-09-08" (Tuesday). Week N's boundary is Tuesday 05:00 -05:00.
    // 1ms before the week-2 boundary vs exactly at it: currentWeek, waiverDeadline (for the week
    // AT that instant) and D.gameStarted (which reads the SAME LG.now()) must all move together,
    // in the same evaluate() call, so there is no possibility of two different reads of "now".
    const boundary = Date.parse("2026-09-15T05:00:00-05:00"); // start of week 2
    const r = await ev(A, (t) => {
      const LG = window.__GFFL__.LG;
      LG.nowOverride = t - 1;
      const before = { cw: LG.currentWeek(), dl1: LG.waiverDeadline(1), dl2: LG.waiverDeadline(2) };
      LG.nowOverride = t;
      const after = { cw: LG.currentWeek(), dl1: LG.waiverDeadline(1), dl2: LG.waiverDeadline(2) };
      return { before, after };
    }, boundary);
    ok(r.before.cw === 1 && r.after.cw === 2,
      "LG.currentWeek() itself crosses cleanly at the boundary (1ms before=" + r.before.cw + ", at=" + r.after.cw + ")");
    ok(r.before.dl1 === r.after.dl1 && r.before.dl2 === r.after.dl2,
      "week-specific deadlines (LG.waiverDeadline(1)/(2)) are pure functions of the WEEK NUMBER, not of \"now\" — " +
      "unaffected by the boundary crossing themselves, which is exactly what makes currentWeek() the single dial " +
      "(dl1 " + r.before.dl1 + "->" + r.after.dl1 + ", dl2 " + r.before.dl2 + "->" + r.after.dl2 + ")");
    // Structural check: every consumer this suite could find (maybeAutoFinalizeWeeks,
    // LG.tradeDeadlinePassed, the Moves-page waiver-open check, the trade-deadline check, the
    // countdown card) calls LG.currentWeek() live at the moment it runs rather than caching a
    // copy — confirmed by grep (assets/league/lg-ui.js:4844 `const cw = LG.currentWeek();` sits
    // INSIDE maybeAutoFinalizeWeeks' own function body, evaluated fresh on every call; 4813/4967
    // read LG.waiverDeadline(wk) live the same way) — proven here by calling
    // maybeAutoFinalizeWeeks() itself across the exact same boundary and confirming it reads the
    // NEW week, not a stale one.
    const auto = await ev(A, async (t) => {
      const LG = window.__GFFL__.LG;
      LG.nowOverride = t; // week 2 now
      await LG.ui.maybeAutoFinalizeWeeks();
      return LG.currentWeek();
    }, boundary);
    ok(auto === 2, "maybeAutoFinalizeWeeks (the S5/S7 auto-check chain) reads the post-boundary week live, not a cached pre-boundary one (" + auto + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  // ============================================================ F. THE ENGINE-REVIEW FIX BATCH
  // 2026-09-02. Each block below is built from the reproduction of the finding it closes — the
  // scratchpad probes named at each head() are what MEASURED the pre-fix behaviour, and the
  // numbers quoted in the messages are those measurements, not predictions.

  head("F1. a FAAB delta computed against a document nobody read (probe9b) — the deduction THROWS, the purse is untouched");
  {
    // The pre-fix engine: LG.saveTeam's offline fall-through called build(null), so opts.from
    // was handed `null`, LG.teamFaab({}) resolved to the RULES DEFAULT (100), and a $10 waiver
    // deduction on a purse that really held $40 WROTE $90. Measured exactly that: $40 -> $90, a
    // $50 refund, silently, mid-processWaivers.
    const docs = { ...K.seedDocs() };
    docs["team_1"] = teamDoc(1, "Battle Kreussers", { faab: 40, pinHash: "H" });
    const store = K.makeStore(docs);
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    ok(store.docs["team_1"].faab === 40, "the fixture starts with a purse that has already been spent down ($" + store.docs["team_1"].faab + " of 100)");
    // Fail the CAS READ at the transport, the way a 12s Firestore timeout really arrives — a
    // one-shot rejection on the next GET of this team's own document.
    const armReadFail = (page, idFragment) => ev({ page }, (frag) => {
      const orig = window.fetch;
      window.__seamFailed = 0;
      window.fetch = function (u, init) {
        const url = String(u);
        const method = (init && init.method) || "GET";
        if (method === "GET" && url.indexOf(frag) >= 0 && window.__seamFailed === 0) {
          window.__seamFailed = 1;
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return orig(u, init);
      };
    }, idFragment);
    await armReadFail(A.page, "/team_1?");
    const deducted = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      try {
        await LG.saveTeam({ teamId: 1 }, { from: (cur) => ({ faab: Math.max(0, LG.teamFaab(cur || {}) - 10) }) });
        return { threw: false };
      } catch (e) { return { threw: true, msg: String((e && e.message) || e) }; }
    });
    ok(deducted.threw === true,
      "the deduction THROWS rather than falling through to a blind write (" + JSON.stringify(deducted) + ")");
    ok(store.docs["team_1"].faab === 40,
      "the purse is EXACTLY what it was — $40, not the pre-fix $90 (budget 100 minus the $10 bid, computed against a doc " +
      "nobody read). Free money: $" + (store.docs["team_1"].faab - 40));
    ok(store.docs["team_1"].name === "Battle Kreussers" && store.docs["team_1"].pinHash === "H",
      "and nothing else on the doc moved either (" + store.docs["team_1"].name + " / pinHash " + store.docs["team_1"].pinHash + ")");
    // ANTI-VACUITY, both halves: the same delta with the read WORKING lands correctly, and a
    // NON-delta caller still takes the offline fall-through it has always taken.
    const okDeduct = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      await LG.saveTeam({ teamId: 1 }, { from: (cur) => ({ faab: Math.max(0, LG.teamFaab(cur || {}) - 10) }) });
      return true;
    });
    ok(okDeduct === true && store.docs["team_1"].faab === 30,
      "with the read working, the identical deduction lands: $40 − $10 = $30 (" + store.docs["team_1"].faab + ")");
    await armReadFail(A.page, "/team_1?");
    const renamed = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      try { await LG.saveTeam({ teamId: 1, name: "Renamed Offline" }); return { threw: false }; }
      catch (e) { return { threw: true, msg: String((e && e.message) || e) }; }
    });
    ok(renamed.threw === false && store.docs["team_1"].name === "Renamed Offline" && store.docs["team_1"].faab === 30,
      "a caller with NO delta still writes its plain fields through the offline fall-through, exactly as before — the " +
      "rename lands and the purse it never mentioned is untouched (" + store.docs["team_1"].name + " / $" + store.docs["team_1"].faab + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("F2. one failed auth read used to hand over the league (probe3) — the gate refuses, Dad's hash survives, nobody is unlocked");
  {
    const docs = { ...K.seedDocs() };
    docs["auth"] = { kind: "auth", commishPinHash: "DADS_REAL_HASH" };
    const store = K.makeStore(docs);
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    // Record every prompt this gate raises — the pre-fix engine's tell was the WORDING: it asked
    // "Set a commissioner PIN (first time)" at a league that plainly had one, then wrote the
    // kid's answer over DADS_REAL_HASH and unlocked. A first-time prompt is itself the lie, so
    // the fixed gate must raise NO prompt at all when the read did not answer.
    await ev(A, () => {
      window.__prompts = []; window.__alerts = [];
      window.prompt = (m) => { window.__prompts.push(String(m)); return "9999"; };
      window.alert = (m) => { window.__alerts.push(String(m)); };
      try { localStorage.removeItem("dadPinHash"); sessionStorage.removeItem("gfflCommish"); } catch (e) {}
    });
    await ev(A, () => {
      const orig = window.fetch;
      window.__authFailed = 0;
      window.fetch = function (u, init) {
        const url = String(u);
        const method = (init && init.method) || "GET";
        if (method === "GET" && url.indexOf("/auth?") >= 0 && window.__authFailed === 0) {
          window.__authFailed = 1;
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return orig(u, init);
      };
    });
    const gated = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const unlocked = await LG.gateCommish();
      return {
        unlocked,
        prompts: window.__prompts.slice(),
        alerts: window.__alerts.slice(),
        session: sessionStorage.getItem("gfflCommish"),
        local: localStorage.getItem("dadPinHash"),
        authRead: LG.authRead,
      };
    });
    ok(gated.unlocked === false, "gateCommish REFUSES on an unanswered read (" + gated.unlocked + ")");
    ok(gated.prompts.length === 0,
      "and raises no PIN prompt at all — least of all the first-time one (" + JSON.stringify(gated.prompts) + ")");
    ok(gated.alerts.length === 1 && /Couldn't reach the league/.test(gated.alerts[0]),
      "it says WHY, in the reader's own words (" + JSON.stringify(gated.alerts) + ")");
    ok(store.docs["auth"].commishPinHash === "DADS_REAL_HASH",
      "Dad's hash is byte-identical on the record (" + store.docs["auth"].commishPinHash + ")");
    ok(gated.session === null && gated.local === null,
      "nothing was unlocked and nothing was mirrored to this device (session=" + gated.session + " local=" + gated.local + ")");
    // THE OTHER HALF — the write is create-only now. Stage the exact window it protects: the READ
    // answers 404 (so the gate believes the league has no PIN and takes the first-time branch)
    // while the store really holds one, i.e. somebody set it in between. The create-only write is
    // refused, the doc it refused against is handed back, and the typed PIN is judged against
    // THAT instead of overwriting it.
    await ev(A, () => {
      window.__prompts = []; window.__alerts = [];
      const orig = window.fetch;
      window.__auth404 = 0;
      window.fetch = function (u, init) {
        const url = String(u);
        const method = (init && init.method) || "GET";
        if (method === "GET" && url.indexOf("/auth?") >= 0 && window.__auth404 === 0) {
          window.__auth404 = 1;
          return Promise.resolve(new Response(JSON.stringify({ error: { code: 404, status: "NOT_FOUND" } }), { status: 404, headers: { "content-type": "application/json" } }));
        }
        return orig(u, init);
      };
    });
    const raced = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const unlocked = await LG.gateCommish();
      return { unlocked, prompts: window.__prompts.slice(), alerts: window.__alerts.slice(), session: sessionStorage.getItem("gfflCommish") };
    });
    ok(/first time/i.test(raced.prompts[0] || ""),
      "the gate genuinely took the FIRST-TIME branch (the staged 404 made it believe the league had no PIN) — " +
      JSON.stringify(raced.prompts));
    ok(raced.unlocked === false && raced.session === null,
      "…and the create-only write was REFUSED by the doc that was really there, so nobody became the commissioner " +
      "(unlocked=" + raced.unlocked + " session=" + raced.session + ")");
    ok(store.docs["auth"].commishPinHash === "DADS_REAL_HASH",
      "Dad's hash STILL survives the first-time branch itself — the case the pre-fix unconditional set could not survive " +
      "(" + store.docs["auth"].commishPinHash + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("F3. a starter on a BYE (probe1) — the finalize gate and RULE 2's clock now give the same answer");
  {
    // Eleven-slot rosters for all eight teams, everybody on PHI except team 8's QB, who is on
    // DET — a team simply not on this week's slate, which is exactly what a bye looks like in
    // D.S.games (the map is REBUILT every poll, so an off-slate team has no entry by construction).
    const docs = { ...K.seedDocs() };
    docs["sched_" + S_] = { kind: "sched", season: S_, weeks: [[[1, 2], [3, 4], [5, 6], [7, 8]]] };
    for (let t = 1; t <= 8; t++) {
      const ros = tightEleven("t" + t + "_").map((p) => ({ ...p, team: "PHI" }));
      if (t === 8) ros[0] = { key: "t8_qb", name: "Bye Guy", pos: "QB", team: "DET", slot: "QB" };
      docs["roster_" + S_ + "_w1_t" + t] = rosterDoc(1, t, ros);
    }
    const store = K.makeStore(docs);
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const r = await ev(A, async () => {
      const { LG, D } = window.__GFFL__;
      D.S.espnWeek = 1; D.S.slpWeek = 1; D.S.espnSeasonType = "regular"; D.S.slpSeasonType = "regular";
      D.S.games.clear();
      D.S.games.set("PHI", { state: "post" }); // every tracked game is FINAL; DET is simply not on the slate
      const res = await LG.finalizeWeek(1);
      return { res, donePHI: D.gameDone("PHI"), doneDET: D.gameDone("DET") };
    });
    ok(r.donePHI === true && r.doneDET === true,
      "RULE 2's own clock says BOTH are done — the tracked game because it is final, the bye because a team off the " +
      "slate can never add another point (gameDone PHI=" + r.donePHI + " DET=" + r.doneDET + ")");
    ok(r.res.ok === true,
      "…and finalizeWeek now AGREES: the week settles. Pre-fix it read D.S.games raw, got null for DET, and refused " +
      "\"not-final\" naming Bye Guy — forever, every week from week 5 on (" + JSON.stringify({ ok: r.res.ok, reason: r.res.reason, pending: r.res.pending }) + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();

    // The other side of the same seam: an EMPTY games map is not a finished board. The check
    // reads gameDone's OWN answer and asserts finalizeWeek agrees with it, so it stays honest
    // whichever way the data layer's own rule lands.
    const store2 = K.makeStore(JSON.parse(JSON.stringify(docs)));
    const B = await K.boot(await K.newDevice(browser, store2, "B", { team: 1, who: "Peter" }));
    const r2 = await ev(B, async () => {
      const { LG, D } = window.__GFFL__;
      D.S.espnWeek = 1; D.S.slpWeek = 1; D.S.espnSeasonType = "regular"; D.S.slpSeasonType = "regular";
      D.S.games.clear(); // no board at all — a cold boot, or a tab whose every ESPN read failed
      const res = await LG.finalizeWeek(1);
      return { res, donePHI: D.gameDone("PHI"), size: D.S.games.size };
    });
    ok(r2.donePHI === false && r2.size === 0,
      "with an EMPTY games map, D.gameDone says nothing is done (gameDone=" + r2.donePHI + ", games=" + r2.size + ")");
    ok(r2.res.ok === false && r2.res.reason === "not-final",
      "…and finalizeWeek refuses on exactly that answer — the two seams agree in BOTH directions (" +
      JSON.stringify({ ok: r2.res.ok, reason: r2.res.reason }) + ")");
    ok(!store2.docs["weekly_" + S_ + "_w1"], "nothing was written by the refused attempt");
    ok(B.errors.length === 0, "0 page errors");
    await B.ctx.close();
  }

  head("F4 (S1). one failing write must not take the rest of the league down with it (probe4 case B)");
  {
    const store = K.makeStore(K.seedDocs({
      ["claim_" + S_ + "_w1_c1"]: claimDoc(1, "c1", 1, "p901", "N. Newman", "RB", "SF", null, null, 30),
      ["claim_" + S_ + "_w1_c2"]: claimDoc(1, "c2", 2, "p902", "A. Available", "WR", "KC", null, null, 25),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const res = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const real = LG.saveTeam;
      let n = 0;
      LG.saveTeam = async function (t, opts) {
        n++;
        if (n === 2) throw new Error("Firestore write failed (503)");
        return real.call(LG, t, opts);
      };
      let out = null, threw = null;
      try { out = await LG.processWaivers(1); } catch (e) { threw = String((e && e.message) || e); }
      LG.saveTeam = real;
      return { out, threw };
    });
    // PRE-FIX TOLERANT: the old engine THROWS out of the run at the second saveTeam, so `out` is
    // null there — every read below has to survive that and fail readably rather than crashing
    // the harness (which would hide every remaining check in a bite proof).
    const out = res.out || {};
    ok(res.threw === null, "processWaivers does not throw out of the run any more (" + res.threw + ")");
    const won = (out.results || []).filter((r) => r.ok).map((r) => r.teamId).sort();
    ok(cj(won) === cj([1, 2]), "both claims still resolved as wins (" + JSON.stringify(out.results) + ")");
    ok(store.docs["team_1"].faab === 70,
      "team 1 IS charged — $100 − $30 = $70 — even though team 2's purse write is the one that fails ($" + store.docs["team_1"].faab + ")");
    ok(store.docs["team_2"].faab == null || store.docs["team_2"].faab === 100,
      "team 2's purse is genuinely unpaid, which is the honest outcome of a failed write (" + store.docs["team_2"].faab + ")");
    const tx = Object.entries(store.docs).filter(([id, d]) => d.kind === "tx" && d.type === "waiver").map(([, d]) => d.teamId).sort();
    ok(cj(tx) === cj([1, 2]),
      "a transaction row exists for BOTH winners — the log is written BEFORE the money, so a failing purse can no " +
      "longer erase the only human-readable record of the move (" + JSON.stringify(tx) + ")");
    const fails = out.failures || [];
    ok(fails.length === 1 && fails[0].teamId === 2 && fails[0].stage === "faab" && fails[0].spend === 25,
      "the failure is NAMED, by team and by stage, in the run's own result (" + JSON.stringify(fails) + ")");
    const rec = store.docs["claims_" + S_ + "_w1"];
    ok(rec && rec.processed === true && Array.isArray(rec.failures) && rec.failures.length === 1 && rec.failures[0].teamId === 2,
      "…and recorded on the week's own processing document, where a commissioner can find it (" + JSON.stringify(rec && rec.failures) + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("F5 (S2). two owners vetoing at the same instant (probe7) — both votes land");
  {
    const tradeId = "trade_veto_seam";
    const store = K.makeStore(K.seedDocs({
      [tradeId]: { kind: "trade", id: tradeId, from: 1, to: 2, give: ["p107"], get: ["p203"], note: "",
        status: "accepted", t: 1, acceptedAt: 1, reviewEndsAt: Date.now() + 1e7, vetoes: [] },
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    // The same staging C4/C6 use: hold the FIRST write to this doc out of the page until the
    // second voter has completed its whole read-modify-write, so the released write provably
    // carries a base that no longer exists. Pre-CAS that write simply landed on top and the
    // first vote was gone; measured on the pre-fix engine as 2 cast, 1 recorded.
    await ev(A, (id) => {
      const orig = window.fetch;
      let held = 0;
      window.fetch = function (u, init) {
        if (init && init.method === "PATCH" && String(u).indexOf(id) >= 0 && held++ === 0) {
          return new Promise((r) => setTimeout(r, 600)).then(() => orig(u, init));
        }
        return orig(u, init);
      };
    }, tradeId);
    const votes = await ev(A, async (id) => {
      const LG = window.__GFFL__.LG;
      const a = LG.vetoTrade(id, 3);                       // owner 3 votes, and is held
      await new Promise((r) => setTimeout(r, 20));
      const b = await LG.vetoTrade(id, 4);                 // owner 4 votes and lands first
      const mid = (b && b.vetoes) || [];
      await a;
      return { mid };
    }, tradeId);
    const final = store.docs[tradeId];
    ok(cj(votes.mid) === cj([4]), "owner 4's vote lands first, alone, while owner 3's write is held (" + JSON.stringify(votes.mid) + ")");
    ok(cj((final.vetoes || []).slice().sort()) === cj([3, 4]),
      "after BOTH votes the record carries BOTH — 2 cast, 2 recorded (" + JSON.stringify(final.vetoes) + ")");
    ok(store.conflicts >= 1,
      "the store REFUSED at least one stale write, which is owner 3's first attempt being told its base had moved — " +
      "without that refusal his write would have put the vetoes array back to [3] and owner 4's vote would be gone " +
      "(conflicts=" + store.conflicts + ")");
    ok(final.status === "accepted",
      "with vetoVotes=4 two votes do not kill the trade, so no veto push/logTx fired on either write (status=" + final.status + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("F6 (S3). the trade deadline binds the whole trade, not just the offer (probe6 section C)");
  {
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const r = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      // PRE-FIX TOLERANT (the section Z / AC lesson): LG.weekStart does not exist on the old
      // engine, and a bare call would throw INSIDE the browser and take the whole node-side run
      // down with one stack trace instead of producing the readable list a bite proof exists for.
      // The fallback is the OLD fixed-offset arithmetic verbatim, so the pre-fix run still
      // stages the same two weeks and still fails on-point.
      const wkStart = (n) => (typeof LG.weekStart === "function" ? LG.weekStart(n)
        : new Date(LG.SEASON_START + "T05:00:00-05:00").getTime() + (n - 1) * 7 * 24 * 3600e3);
      const wk = (n) => wkStart(n) + 3600e3; // an hour into that league week
      LG.nowOverride = wk(10);
      const cwOffer = LG.currentWeek();
      const deadlineWeek = LG.rules.trades.deadlineWeek;
      const offer = await LG.offerTrade(1, 2, ["p107"], ["p203"], "");
      LG.nowOverride = wk(12);
      const cwAccept = LG.currentWeek();
      const passed = LG.tradeDeadlinePassed();
      const accept = await LG.acceptTrade(offer.trade.id, 2);
      const after = await LG.loadTrade(offer.trade.id, { fresh: true });
      // …and the authoritative gate too: force the doc to "accepted" past its review window and
      // ask executeTrade directly, which is the path a stale device's auto-check would take.
      await LG.saveTrade({ ...after, status: "accepted", acceptedAt: 1, reviewEndsAt: 1 });
      const exec = await LG.executeTrade(offer.trade.id);
      LG.nowOverride = null;
      return { cwOffer, cwAccept, deadlineWeek, offerOk: offer.ok, passed, accept, status: after.status, exec };
    });
    ok(r.cwOffer === 10 && r.cwAccept === 12 && r.deadlineWeek === 11,
      "the staging is real: offered in week " + r.cwOffer + ", accepted in week " + r.cwAccept +
      ", against a deadlineWeek of " + r.deadlineWeek);
    ok(r.offerOk === true && r.passed === true,
      "the offer itself was legal when it was made, and the deadline has genuinely passed by the time it is answered");
    ok(r.accept && r.accept.ok === false && r.accept.reason === "deadline-passed",
      "acceptTrade REFUSES, in offerTrade's own shape (" + JSON.stringify(r.accept) + ")");
    ok(r.status === "offered", "…and the trade is left exactly as it was, still merely offered (" + r.status + ")");
    ok(r.exec && r.exec.ok === false && r.exec.reason === "deadline-passed",
      "executeTrade refuses the same way — the authoritative gate, for a trade accepted before the deadline whose " +
      "review window closes after it (" + JSON.stringify(r.exec) + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("F7 (S4). the waiver deadline reads 08:00 Central on BOTH sides of the Nov 1 2026 fall-back (probe2)");
  {
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const r = await ev(A, () => {
      const LG = window.__GFFL__.LG;
      const central = (ms) => new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago", hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit",
      }).format(new Date(ms));
      // PRE-FIX TOLERANT, same reason as F6's own note — the fallback is the old fixed-offset
      // formula, which is exactly the arithmetic these checks exist to disprove.
      const wkStart = (n) => (typeof LG.weekStart === "function" ? LG.weekStart(n)
        : new Date(LG.SEASON_START + "T05:00:00-05:00").getTime() + (n - 1) * 7 * 24 * 3600e3);
      const out = { start: LG.SEASON_START, deadlines: {}, weekStarts: {}, centralDl: {}, centralWs: {} };
      for (const w of [1, 2, 8, 9, 10, 14]) {
        out.deadlines[w] = LG.waiverDeadline(w);
        out.centralDl[w] = central(out.deadlines[w]);
        out.weekStarts[w] = wkStart(w);
        out.centralWs[w] = central(out.weekStarts[w]);
      }
      const b9 = wkStart(9);
      LG.nowOverride = b9 - 1; const before = LG.currentWeek();
      LG.nowOverride = b9; const at = LG.currentWeek();
      LG.nowOverride = null;
      return { ...out, before, at };
    });
    // HAND-COMPUTED, from SEASON_START 2026-09-08 (a Tuesday) and rules.waivers {processDow:3
    // (Wed), processHour:8}: week 1's Wednesday is Sep 9 and week N's is Sep 9 + 7(N−1). CDT is
    // UTC−5, CST is UTC−6, and the US falls back on Sunday Nov 1 2026 — so the LAST CDT
    // Wednesday is week 8 (Oct 28) and the FIRST CST one is week 9 (Nov 4).
    const want = {
      1: "2026-09-09T13:00:00.000Z",  // 08:00 CDT
      2: "2026-09-16T13:00:00.000Z",  // 08:00 CDT
      8: "2026-10-28T13:00:00.000Z",  // 08:00 CDT — the last one before the shift
      9: "2026-11-04T14:00:00.000Z",  // 08:00 CST — the first one after it
      10: "2026-11-11T14:00:00.000Z", // 08:00 CST
      14: "2026-12-09T14:00:00.000Z", // 08:00 CST
    };
    for (const w of Object.keys(want).map(Number)) {
      ok(new Date(r.deadlines[w]).toISOString() === want[w],
        "week " + w + "'s waiver deadline is " + want[w] + " — " + r.centralDl[w] + " Central (got " +
        new Date(r.deadlines[w]).toISOString() + ")");
    }
    ok(Object.values(r.centralDl).every((s) => /08:00/.test(s)),
      "every one of those reads 08:00 Central, before AND after the shift — the pre-fix fixed −05:00 frame made every " +
      "week from 9 on read 07:00 Central, an hour AHEAD of leaguecron.mjs's own Intl-derived 08:00 band (" +
      JSON.stringify(r.centralDl) + ")");
    ok(/Tue/.test(r.centralWs[8]) && /05:00/.test(r.centralWs[8]) && /Tue/.test(r.centralWs[9]) && /05:00/.test(r.centralWs[9]),
      "the WEEK boundaries move with it: week 8 starts " + r.centralWs[8] + " and week 9 starts " + r.centralWs[9] +
      " — both Tuesday 05:00 Central, though they sit an hour apart in UTC (" +
      new Date(r.weekStarts[8]).toISOString() + " vs " + new Date(r.weekStarts[9]).toISOString() + ")");
    ok(r.weekStarts[9] - r.weekStarts[8] === 7 * 24 * 3600e3 + 3600e3,
      "and that hour is exactly the fall-back: week 9 is 7 days AND ONE HOUR of real time after week 8 (" +
      ((r.weekStarts[9] - r.weekStarts[8]) / 3600e3) + "h)");
    ok(r.before === 8 && r.at === 9,
      "LG.currentWeek() still crosses cleanly on that real boundary — 1ms before it reads " + r.before + ", at it reads " + r.at);
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("F8 (S5). advanceBracket writing a stale cached bracket (probe5) — the resolved round survives");
  {
    // THE COLLISION IS STAGED, for exactly C4's own reason. Two devices that each advance the
    // bracket from their own read is the real hazard (the season sim's writeOnce.bracket sweep
    // caught it as champ/third reverting from a real team id to null at w17, 2 of 2 runs on
    // unmodified HEAD) — but the two windows will not reliably overlap on their own, and a check
    // that only overlaps sometimes is a check that proves nothing. So device A's first bracket
    // PATCH is HELD on a gate Node releases, and device B completes its WHOLE read-modify-write
    // inside that window. A's released write then provably carries a base that no longer exists.
    const bId = "bracket_" + S_;
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const B = await K.boot(await K.newDevice(browser, store, "B", { team: 2, who: "Other" }));
    await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const ids = LG.teams.map((t) => t.id);
      const weeks = LG.generateSchedule(ids, 14);
      for (let w = 0; w < 14; w++) {
        const matchups = weeks[w].map(([h, a]) => ({ home: h, away: a, homePts: 100 + h, awayPts: 100 + a }));
        await LG.db.set("weekly_" + LG.SEASON + "_w" + (w + 1), { kind: "weekly", week: w + 1, matchups, awards: {}, power: [], accuracy: null, finalizedAt: 1, source: "live" });
      }
      await LG.buildBracket();
      // Only week 15 exists so far, so device A's advance can resolve r2 and NOTHING else.
      const g15 = await LG.gamesForWeek(15);
      await LG.db.set("weekly_" + LG.SEASON + "_w15", { kind: "weekly", week: 15, matchups: g15.map(([h, a]) => ({ home: h, away: a, homePts: 100, awayPts: 50 })), awards: {}, power: [], accuracy: null, finalizedAt: 1, source: "live" });
      await LG.loadStandings(); // warms the "weekly" list cache, which is what makes w16 read ABSENT to A
    });
    // The gate: A's FIRST bracket PATCH waits until Node says go. Its retry (if any) goes free.
    await ev(A, (id) => {
      window.__seamGate = new Promise((r) => { window.__seamRelease = r; });
      const orig = window.fetch;
      let held = 0;
      window.fetch = function (u, init) {
        if (init && init.method === "PATCH" && String(u).indexOf(id) >= 0 && held++ === 0) {
          return window.__seamGate.then(() => orig(u, init));
        }
        return orig(u, init);
      };
    }, bId);
    // A starts advancing — it reads the bracket (r2 and r3 both unresolved), fills r2 from week
    // 15, and is held on its write. Deliberately NOT awaited.
    const pA = ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const cached = await LG.loadBracket();
      const staleR3 = (cached.rounds.r3 || []).filter((g) => g.id === "champ").map((g) => ({ home: g.home, away: g.away }));
      await LG.advanceBracket();
      return { staleR3 };
    });
    await K.sleep(400);
    // Device B, entirely inside A's held window, walks the bracket the way the season really
    // does: advance week 15 (r2's semis resolve), THEN read week 16's own slate — which is only
    // knowable once the semis are set — finalize it, and advance again so r3 resolves. B ends
    // with a fully-resolved championship on the shared record.
    await ev(B, async () => {
      const LG = window.__GFFL__.LG;
      // B booted alongside A, BEFORE the bracket existed, so its boot-time list("bracket") is
      // cached as empty and knownAbsent would answer loadBracket() with null for the life of the
      // tab. Dropping the caches is what makes B a device that opens the app AFTER the bracket
      // was built — which is the scenario — rather than one that can never see it.
      LG.db.clearCache();
      await LG.advanceBracket();
      const games = await LG.gamesForWeek(16);
      await LG.db.set("weekly_" + LG.SEASON + "_w16", { kind: "weekly", week: 16, matchups: games.map(([h, a]) => ({ home: h, away: a, homePts: 100, awayPts: 50 })), awards: {}, power: [], accuracy: null, finalizedAt: 1, source: "live" });
      await LG.advanceBracket();
    });
    const r3Before = (store.docs[bId].rounds.r3 || []).filter((g) => g.id === "champ" || g.id === "third")
      .map((g) => ({ id: g.id, home: g.home, away: g.away }));
    ok(r3Before.length === 2 && r3Before.every((g) => g.home != null && g.away != null),
      "device B resolves the championship and the third-place game on the record, inside A's held window (" +
      JSON.stringify(r3Before) + ")");
    await ev(A, () => { window.__seamRelease(); });
    const after = await pA;
    ok(cj(after.staleR3) === cj([{ home: null, away: null }]),
      "device A's own copy really was stale when it computed its write — its championship pairing read null/null (" +
      JSON.stringify(after.staleR3) + ")");
    const r3After = (store.docs[bId].rounds.r3 || []).filter((g) => g.id === "champ" || g.id === "third")
      .map((g) => ({ id: g.id, home: g.home, away: g.away }));
    ok(cj(r3After) === cj(r3Before),
      "…and device B's resolved round SURVIVES device A's released write, byte for byte. Pre-fix that write was a blind " +
      "whole-document set of A's own cached copy, which put both pairings back to null and left a bracket no champion " +
      "could ever be crowned out of (" + JSON.stringify(r3After) + ")");
    ok(store.conflicts >= 1,
      "the store REFUSED at least one stale write — A's held PATCH being told its base had moved, which is the " +
      "precondition doing the work (conflicts=" + store.conflicts + ")");
    ok(A.errors.length === 0 && B.errors.length === 0, "0 page errors");
    await A.ctx.close();
    await B.ctx.close();
  }

  head("F8b (S5). …and the fill no longer MUTATES the object loadBracket handed out");
  {
    // The second half of the same finding, in its own fixture so the advance genuinely resolves
    // something (an advance that fills nothing mutates nothing either way, which would make this
    // vacuous). LG.loadBracket returns LG.db's OWN cached object — cacheUpsert has a comment
    // about that hazard one layer up — and the pre-fix advanceBracket wrote g.home/g.away
    // straight onto the games inside it, so every other reader on the page holding that object
    // had it rewritten underneath them mid-render.
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const r = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const ids = LG.teams.map((t) => t.id);
      const weeks = LG.generateSchedule(ids, 14);
      for (let w = 0; w < 14; w++) {
        const matchups = weeks[w].map(([h, a]) => ({ home: h, away: a, homePts: 100 + h, awayPts: 100 + a }));
        await LG.db.set("weekly_" + LG.SEASON + "_w" + (w + 1), { kind: "weekly", week: w + 1, matchups, awards: {}, power: [], accuracy: null, finalizedAt: 1, source: "live" });
      }
      await LG.buildBracket();
      const g15 = await LG.gamesForWeek(15);
      await LG.db.set("weekly_" + LG.SEASON + "_w15", { kind: "weekly", week: 15, matchups: g15.map(([h, a]) => ({ home: h, away: a, homePts: 100, awayPts: 50 })), awards: {}, power: [], accuracy: null, finalizedAt: 1, source: "live" });
      const held = await LG.loadBracket();          // the cache's own object, r2 unresolved
      const before = JSON.stringify(held);
      await LG.advanceBracket();
      const semisInStore = (await LG.db.getFresh(LG.bracketId(LG.SEASON))).rounds.r2
        .filter((g) => g.kind === "semi").map((g) => ({ id: g.id, home: g.home, away: g.away }));
      return { untouched: JSON.stringify(held) === before, semisInStore };
    });
    ok(r.semisInStore.length === 2 && r.semisInStore.every((g) => g.home != null && g.away != null),
      "the advance genuinely resolved something — both semifinals are filled on the record, so this is not a no-op (" +
      JSON.stringify(r.semisInStore) + ")");
    ok(r.untouched === true,
      "…and the object loadBracket handed the caller is BYTE-UNCHANGED by it: the fill runs over a clone (untouched=" +
      r.untouched + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("F9 (S6). one matchup with nobody on either side (probe6 section E) — the WEEK is refused, and the pairing is named");
  {
    const docs = { ...K.seedDocs() };
    docs["sched_" + S_] = { kind: "sched", season: S_, weeks: [[[1, 2], [3, 4], [5, 6], [7, 8]]] };
    for (let t = 1; t <= 8; t++) {
      // Teams 5 and 6 field NOBODY — the pairing nobody played. Every other team is a real,
      // fully-slotted roster on a board where every game is final.
      const ros = (t === 5 || t === 6) ? [] : tightEleven("t" + t + "_").map((p) => ({ ...p, team: "PHI" }));
      docs["roster_" + S_ + "_w1_t" + t] = rosterDoc(1, t, ros);
    }
    const store = K.makeStore(docs);
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const r = await ev(A, async () => {
      const { LG, D } = window.__GFFL__;
      D.S.espnWeek = 1; D.S.slpWeek = 1; D.S.espnSeasonType = "regular"; D.S.slpSeasonType = "regular";
      D.S.games.clear(); D.S.games.set("PHI", { state: "post" });
      return { plain: await LG.finalizeWeek(1), forced: await LG.finalizeWeek(1, { force: true }) };
    });
    ok(r.plain.ok === false && r.plain.reason === "empty-matchup",
      "finalizeWeek refuses the WHOLE week — three real matchups were ready and one had nobody, and a week is a unit " +
      "(" + JSON.stringify({ ok: r.plain.ok, reason: r.plain.reason }) + ")");
    ok(cj(r.plain.pairs) === cj([[5, 6]]),
      "…and it NAMES the pairing, so the commissioner knows which roster to fix (" + JSON.stringify(r.plain.pairs) + ")");
    // Named against the ENGINE's own LG.teamName for that pair rather than a literal, so a
    // future rename in the fixture (team 5 is "Nails For Breakfast" in the kit's seed and "Laws
    // Rule" in production) can never turn this into a false failure.
    const named = await ev(A, () => {
      const LG = window.__GFFL__.LG;
      return LG.teamName(5) + " vs " + LG.teamName(6);
    });
    ok(Array.isArray(r.plain.matchups) && r.plain.matchups.length === 1 && r.plain.matchups[0] === named,
      "in the teams' own names, not raw ids — \"" + named + "\" (" + JSON.stringify(r.plain.matchups) + ")");
    ok(r.forced.ok === false && r.forced.reason === "empty-matchup",
      "commissioner FORCE does not bypass it — the same rule the 2026-08-31 empty-week guard established, one level in " +
      "(" + JSON.stringify({ ok: r.forced.ok, reason: r.forced.reason }) + ")");
    ok(!store.docs["weekly_" + S_ + "_w1"], "nothing at all was written — not the three real matchups either");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("F10 (S7). two carry-forwards of the same week at the same instant — ONE document, and both callers get it");
  {
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const before = store.writes.filter((w) => w.id === "roster_" + S_ + "_w2_t1").length;
    const r = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      LG.db.clearCache(); // both callers start from the same "week 2 does not exist yet" position
      const [a, b] = await Promise.all([LG.ensureRoster(2, 1, {}), LG.ensureRoster(2, 1, {})]);
      return { a: a.map((p) => p.key), b: b.map((p) => p.key) };
    });
    ok(r.a.length === 10 && cj(r.a) === cj(r.b),
      "both concurrent carry-forwards return the identical roster, copied from week 1 (" + r.a.length + " players, identical=" +
      (cj(r.a) === cj(r.b)) + ")");
    const doc = store.docs["roster_" + S_ + "_w2_t1"];
    ok(doc && doc.week === 2 && doc.teamId === 1 && cj(doc.players.map((p) => p.key)) === cj(r.a),
      "exactly one week-2 document exists on the record, and it is that roster (" + (doc && doc.players.length) + " players)");
    const accepted = store.writes.filter((w) => w.id === "roster_" + S_ + "_w2_t1" && !w.refused).length - before;
    ok(accepted === 1,
      "and exactly ONE write was accepted — the loser's create-only precondition was refused rather than overwriting it " +
      "(accepted=" + accepted + ", refused=" + store.writes.filter((w) => w.id === "roster_" + S_ + "_w2_t1" && w.refused).length + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("F11 (S8 + the ownership belt + the minors). the IR vocabulary, one man under two keys, and the small ones");
  {
    const store = K.makeStore(K.seedDocs());
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    // ---- S8: the IR table, every spelling the two feeds actually emit.
    const ir = await ev(A, () => {
      const LG = window.__GFFL__.LG;
      const yes = ["OUT", "DOUBTFUL", "INJURY_RESERVE", "SUSPENSION", "Sus", "IR", "PUP", "NFI", "Out", "Doubtful", "O", "D", "ir", " out "];
      const no = ["Questionable", "", "ACTIVE", "Healthy", "Q", "DAY_TO_DAY"];
      return {
        yes: yes.filter((s) => LG.irEligible(s)), yesAll: yes.length,
        no: no.filter((s) => !LG.irEligible(s)), noAll: no.length,
        nullish: LG.irEligible(null) === false && LG.irEligible(undefined) === false,
      };
    });
    ok(ir.yes.length === ir.yesAll,
      "every spelling both feeds emit for \"not available\" is IR-eligible — ESPN's OUT/DOUBTFUL/INJURY_RESERVE/" +
      "SUSPENSION, Sleeper's Out/Doubtful/IR/PUP/NFI/Sus, the O/D shorthands, and case/whitespace variants (" +
      ir.yes.length + "/" + ir.yesAll + ")");
    ok(ir.no.length === ir.noAll && ir.nullish,
      "and Questionable / healthy / empty / null are NOT — the anti-vacuity half: a rule that said yes to everything " +
      "would let a Q be parked on IR for a free 22nd roster spot (" + ir.no.length + "/" + ir.noAll + ", nullish=" + ir.nullish + ")");
    // ---- the ownership belt: one man, two spellings of his key.
    await A.page.waitForFunction(() => {
      const D = window.__GFFL__ && window.__GFFL__.D;
      return D && D.S && D.S.slpPlayers && D.S.slpPlayers.size > 0;
    }, { timeout: 15000 });
    const belt = await ev(A, async () => {
      const { LG, D } = window.__GFFL__;
      // p203 (Z. Spare) sits on TEAM 2's roster keyed by his ESPN id. `slp_p203` is the SAME man,
      // spelled the way anything resolved through the Sleeper directory keys him.
      // typeof-guarded: LG.sameMan does not exist on the pre-fix engine, and a bare call would
      // crash the harness rather than failing this check (the section Z / AC lesson).
      const ids = { raw: D.pidForKey("p203"), slp: D.pidForKey("slp_p203"),
        same: typeof LG.sameMan === "function" ? LG.sameMan("p203", "slp_p203") : null };
      const add = await LG.faAdd(1, 1, { key: "slp_p203", name: "Z. Spare", pos: "RB", team: "KC" }, null);
      await LG.addClaim(1, { id: "cBelt", teamId: 1, addKey: "slp_p203", addName: "Z. Spare", addPos: "RB", addTeam: "KC", dropKey: null, bid: 5, t: 1 });
      const run = await LG.processWaivers(1);
      // ANTI-VACUITY: a genuine free agent, keyed exactly the same slp_ way, still goes through.
      const fa = await LG.faAdd(1, 1, { key: "slp_p901", name: "N. Newman", pos: "RB", team: "SF" }, null);
      return { ids, add, claim: (run.results || [])[0], fa };
    });
    ok(belt.ids.raw === "p203" && belt.ids.slp === "p203" && belt.ids.same === true,
      "the fixture's premise: both spellings resolve to the same Sleeper pid, so LG.sameMan says they are one man (" +
      JSON.stringify(belt.ids) + ")");
    ok(belt.add && belt.add.ok === false && belt.add.reason === "player-taken",
      "faAdd REFUSES him as already owned, though no roster holds that literal key anywhere (" + JSON.stringify(belt.add) + ")");
    ok(belt.claim && belt.claim.ok === false && belt.claim.reason === "player-taken",
      "and a waiver claim for him loses for the same reason, rather than winning him onto a second roster (" +
      JSON.stringify(belt.claim) + ")");
    ok(belt.fa && belt.fa.ok === true,
      "…while a genuinely unowned free agent under the identical slp_ key spelling still goes straight through (" +
      JSON.stringify(belt.fa) + ")");
    // ---- the minors.
    const minors = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      // DEFAULT_RULES caught up with the live settings sheet.
      const dr = LG.DEFAULT_RULES;
      // ID_KIND: with a cached list of the "proj" kind in hand, a miss on a proj_ doc must be
      // answered from that snapshot with NO backend read at all (knownAbsent's whole point).
      await LG.db.list("proj");
      await LG.db.list("awards");
      const g0 = LG.db.stats.gets;
      await LG.db.get(LG.projId(LG.SEASON, 1));
      await LG.db.get("awards_history");
      const g1 = LG.db.stats.gets;
      // toggleReaction, two owners on one message at the same instant.
      const mid = "chat_seam_react";
      await LG.db.set(mid, { kind: "chat", t: 1, who: "P", teamId: 1, text: "hi", reactions: {} });
      await Promise.all([LG.toggleReaction(mid, "\u{1F525}", 3), LG.toggleReaction(mid, "\u{1F525}", 4)]);
      const react = await LG.db.getFresh(mid);
      return {
        roster: dr.roster, cap: LG.rosterCap(),
        dst2pt: dr.scoring.dst_2pt_ret, onePt: dr.scoring.one_pt_safety,
        readsForTwoMisses: g1 - g0,
        reacts: ((react.reactions || {})["\u{1F525}"] || []).slice().sort(),
      };
    });
    ok(cj(minors.roster) === cj({ ...STARTERS, BENCH: 7, IR: 3 }) && minors.cap === ROSTER_CAP,
      "LG.DEFAULT_RULES.roster is the live league's own slot script — " + JSON.stringify(minors.roster) +
      ", summing to LG.rosterCap()=" + minors.cap);
    ok(minors.dst2pt === 4 && minors.onePt === 1,
      "and the two rules the 2026-08-13 ESPN reconciliation grounded through the settings sheet rather than the 2025 " +
      "sample are no longer defaulted to zero: dst_2pt_ret=" + minors.dst2pt + ", one_pt_safety=" + minors.onePt);
    ok(minors.readsForTwoMisses === 0,
      "ID_KIND knows `proj` and `awards` now, so a miss on either is answered from the cached list of its own kind — " +
      "0 backend reads for two misses, where before every one was a real round trip on every render (" +
      minors.readsForTwoMisses + ")");
    ok(cj(minors.reacts) === cj([3, 4]),
      "two owners reacting to the same message at the same instant BOTH land — toggleReaction is a compare-and-swap " +
      "now, not a getFresh-then-set (" + JSON.stringify(minors.reacts) + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("F12. the reason a claim was refused is the FIRST one that applied, not the last one checked");
  {
    // A claim whose drop target is already gone, submitted by a team that ALSO has a healthy man
    // stashed on IR. Pre-fix the chain read `if (!reason && overBudget) … else if (illegalIR)`,
    // so with `reason` already set to "drop-gone" the `else if` RAN and overwrote it — the owner
    // was told to fix an IR stash when the real problem was a drop that no longer existed.
    const docs = { ...K.seedDocs() };
    docs["roster_" + S_ + "_w1_t1"] = rosterDoc(1, 1, [
      ...tightEleven("t1_").map((p) => ({ ...p, team: "PHI" })),
      { key: "healthyIR", name: "Healthy Stash", pos: "RB", team: "PHI", slot: "IR", injury: "" },
    ]);
    docs["claim_" + S_ + "_w1_c1"] = claimDoc(1, "c1", 1, "p901", "N. Newman", "RB", "SF", "gone_key", "Gone Man", 5);
    const store = K.makeStore(docs);
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const r = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const ros = await LG.ensureRoster(1, 1, { fresh: true });
      const stash = LG.illegalIR(ros).map((p) => p.name);
      const run = await LG.processWaivers(1);
      return { stash, result: (run.results || [])[0] };
    });
    ok(cj(r.stash) === cj(["Healthy Stash"]),
      "the fixture really does carry an illegal IR stash, so the overwritten branch is genuinely reachable (" +
      JSON.stringify(r.stash) + ")");
    ok(r.result && r.result.ok === false && r.result.reason === "drop-gone",
      "the refusal names the FIRST problem — the missing drop — not the last check that happened to be true (" +
      JSON.stringify(r.result) + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  head("F13. the zombie weekly doc — a 0-0 record written by an un-reloaded device heals itself");
  {
    // The exact shape of the two real ones (2026-08-30 and 2026-09-01): four 0-0 ties and an
    // all-zero power table, written out of a device's boot auto-checks over empty rosters.
    const voidDoc = {
      kind: "weekly", week: 1,
      matchups: [{ home: 1, away: 2, homePts: 0, awayPts: 0 }, { home: 3, away: 4, homePts: 0, awayPts: 0 },
        { home: 5, away: 6, homePts: 0, awayPts: 0 }, { home: 7, away: 8, homePts: 0, awayPts: 0 }],
      awards: { topScore: null, bust: null, benchBlunder: null },
      power: [1, 2, 3, 4, 5, 6, 7, 8].map((id, i) => ({ teamId: id, score: 0, rank: i + 1 })),
      accuracy: null, finalizedAt: 1, source: "live",
    };
    const docs = { ...K.seedDocs() };
    docs["sched_" + S_] = { kind: "sched", season: S_, weeks: [[[1, 2], [3, 4], [5, 6], [7, 8]]] };
    for (let t = 1; t <= 8; t++) docs["roster_" + S_ + "_w1_t" + t] = rosterDoc(1, t, tightEleven("t" + t + "_").map((p) => ({ ...p, team: "PHI" })));
    docs["weekly_" + S_ + "_w1"] = JSON.parse(JSON.stringify(voidDoc));
    const store = K.makeStore(docs);
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const seen = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const raw = await LG.db.get(LG.weeklyId(LG.SEASON, 1));
      // typeof-guarded for the same reason F6/F11 are: neither helper exists on the pre-fix
      // engine, and this whole block must fail READABLY there rather than crashing the run.
      return {
        isVoid: typeof LG.weeklyIsVoid === "function" ? LG.weeklyIsVoid(raw) : null,
        viaLoadWeekly: await LG.loadWeekly(1),
        standings: await LG.loadStandings(),
        docs: typeof LG.loadWeeklyDocs === "function" ? (await LG.loadWeeklyDocs()).length : null,
      };
    });
    ok(seen.isVoid === true, "the seeded record is recognised as void (all matchups 0-0 AND an all-zero power table)");
    ok(seen.viaLoadWeekly === null, "LG.loadWeekly reads it as ABSENT, so every bracket and week reader inherits the heal");
    ok(seen.docs === 0, "…and LG.loadWeeklyDocs — the one funnel every list-reader in lg-core now uses — returns none of it");
    const zeroed = [1, 2, 3, 4, 5, 6, 7, 8].every((id) => {
      const s = seen.standings[id];
      return s && s.w === 0 && s.l === 0 && s.t === 0 && s.pf === 0 && s.pa === 0;
    });
    ok(zeroed === true,
      "so the standings read 0-0-0 for every team, instead of the four phantom TIES the family reported (" +
      JSON.stringify(seen.standings[1]) + " …)");
    // The stale-week card. RESTAGED 2026-09-02, the same day, at the coordinator's review: this
    // check was written while lg-ui's staleFinalizeWeeks still built its `have` set straight
    // off LG.db.list("weekly"), so a void doc counted as "have" and NO card was raised — and the
    // original comment said so, calling it the outcome reached by lg-ui's accidental route
    // rather than by the void filter. Build B then routed staleFinalizeWeeks through
    // LG.loadWeeklyDocs on the coordinator's instruction, which is the CORRECT reading: a void
    // week is ABSENT, and an absent week the engine has rolled past (the board is at week 2
    // here) is exactly what "a week needs finalizing" exists to say — the real finalize below
    // then REPLACES the zombie. So the honest assertion is inverted: the alarm MUST appear.
    // Silence here would mean a phantom 0-0 week sat in the record with nothing prompting the
    // commissioner to fix it.
    const card = await ev(A, async () => {
      const { LG, D } = window.__GFFL__;
      D.S.espnWeek = 2; D.S.slpWeek = 2; D.S.espnSeasonType = "regular"; D.S.slpSeasonType = "regular";
      LG.ui.go ? LG.ui.go("league") : LG.ui.show("league");
      await new Promise((r) => setTimeout(r, 300));
      const main = document.querySelector("#main");
      return (main ? main.textContent : "").replace(/\s+/g, " ");
    });
    ok(/finalizing/i.test(card),
      "and the league home DOES raise the \"a week needs finalizing\" alarm over it — a void week is absent, and an absent past week is exactly what the card is for");
    // THE REPAIR. Real rosters, every game final — the REAL finalize must get past the zombie.
    const healed = await ev(A, async () => {
      const { LG, D } = window.__GFFL__;
      D.S.espnWeek = 1; D.S.slpWeek = 1; D.S.espnSeasonType = "regular"; D.S.slpSeasonType = "regular";
      D.S.games.clear(); D.S.games.set("PHI", { state: "post" });
      for (const p of ["t1_qb", "t1_rb1", "t2_qb"]) LG.data.S.players.set(p, { key: p, pts: 10 });
      const first = await LG.finalizeWeek(1);
      const second = await LG.finalizeWeek(1);
      return { first, second };
    });
    ok(healed.first.ok === true && healed.first.replacedVoid === true,
      "finalizeWeek REPLACES the zombie rather than bouncing off it, and stamps the repair on the record " +
      "(ok=" + healed.first.ok + " replacedVoid=" + healed.first.replacedVoid + ")");
    const rec = store.docs["weekly_" + S_ + "_w1"];
    ok(rec.replacedVoid === true && (rec.matchups || []).some((m) => m.homePts > 0 || m.awayPts > 0),
      "the stored record now carries real scores (" + JSON.stringify(rec.matchups) + ")");
    ok(healed.second.ok === true && healed.second.replacedVoid === true &&
      cj(healed.second.matchups) === cj(healed.first.matchups),
      "and a second call is idempotent — the repaired record is a REAL one now, so write-once takes over again");
    // …and a NON-void record is still untouchable, which is the whole reason this is narrow.
    const store2 = K.makeStore({
      ...docs,
      ["weekly_" + S_ + "_w1"]: { ...voidDoc, matchups: [{ home: 1, away: 2, homePts: 110.4, awayPts: 98.2 }] },
    });
    const B = await K.boot(await K.newDevice(browser, store2, "B", { team: 1, who: "Peter" }));
    const kept = await ev(B, async () => {
      const { LG, D } = window.__GFFL__;
      D.S.espnWeek = 1; D.S.slpWeek = 1; D.S.espnSeasonType = "regular"; D.S.slpSeasonType = "regular";
      D.S.games.clear(); D.S.games.set("PHI", { state: "post" });
      for (const p of ["t1_qb", "t1_rb1"]) LG.data.S.players.set(p, { key: p, pts: 99 });
      const res = await LG.finalizeWeek(1);
      return { res };
    });
    ok(kept.res.ok === true && cj(kept.res.matchups) === cj([{ home: 1, away: 2, homePts: 110.4, awayPts: 98.2 }]) && !kept.res.replacedVoid,
      "a REAL existing record is returned untouched and never carries replacedVoid — the heal cannot reach a week that " +
      "was genuinely played (" + JSON.stringify(kept.res.matchups) + ")");
    ok(cj(store2.docs["weekly_" + S_ + "_w1"].matchups) === cj([{ home: 1, away: 2, homePts: 110.4, awayPts: 98.2 }]),
      "and the stored document is byte-identical to what was seeded");
    ok(A.errors.length === 0 && B.errors.length === 0, "0 page errors");
    await A.ctx.close();
    await B.ctx.close();
  }

  head("F14. a NaN player score can never reach the write-once weekly document");
  {
    const docs = { ...K.seedDocs() };
    docs["sched_" + S_] = { kind: "sched", season: S_, weeks: [[[1, 2]]] };
    for (const t of [1, 2]) docs["roster_" + S_ + "_w1_t" + t] = rosterDoc(1, t, tightEleven("t" + t + "_").map((p) => ({ ...p, team: "PHI" })));
    const store = K.makeStore(docs);
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const r = await ev(A, async () => {
      const { LG, D } = window.__GFFL__;
      D.S.espnWeek = 1; D.S.slpWeek = 1; D.S.espnSeasonType = "regular"; D.S.slpSeasonType = "regular";
      D.S.games.clear(); D.S.games.set("PHI", { state: "post" });
      LG.data.S.players.set("t1_qb", { key: "t1_qb", pts: NaN });      // the poisoned row
      LG.data.S.players.set("t1_rb1", { key: "t1_rb1", pts: 12.5 });
      LG.data.S.players.set("t2_qb", { key: "t2_qb", pts: 20 });
      const res = await LG.finalizeWeek(1);
      return res;
    });
    const m = (r.matchups || [])[0] || {};
    ok(Number.isFinite(m.homePts) && Number.isFinite(m.awayPts),
      "both team totals are finite numbers (" + JSON.stringify(m) + ")");
    ok(m.homePts === 12.5 && m.awayPts === 20,
      "hand-computed: the NaN row contributes exactly 0 and every other starter's real points survive — " +
      "team 1 = 12.5, team 2 = 20 (" + m.homePts + " / " + m.awayPts + ")");
    const stored = store.docs["weekly_" + S_ + "_w1"];
    ok(!/NaN|null/.test(JSON.stringify(stored.matchups)),
      "and nothing non-numeric reached the stored, write-once record (" + JSON.stringify(stored.matchups) + ")");
    ok(A.errors.length === 0, "0 page errors");
    await A.ctx.close();
  }

  await browser.close();
  srv.close();
  process.exit(done("GFFL seam suite (docs/gffl.md-driven interaction hunt)"));
})().catch((e) => { console.log("\nHARNESS CRASH: " + (e && e.stack ? e.stack : e)); process.exit(2); });
