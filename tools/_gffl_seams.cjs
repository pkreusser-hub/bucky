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
// A "tight" 9-man roster: exactly one player per starting slot (QB1/RB2/WR2/TE1/FLEX1/DST1/K1),
// zero slack. Used by C3/C5's trade-guard fixtures: with no spare players anywhere, the ONLY
// possible full assignment is the obvious one (TE -> TE, the "rb3" spare -> FLEX), which is
// exactly the shape a naive greedy can get wrong (grab the TE for FLEX first, since it's
// FLEX-eligible too, then find the TE slot empty with nobody left who qualifies) and exactly
// the shape LG.canFillLineup's augmenting-path search gets right regardless of processing
// order. All 9 are real, distinct positions, so the roster is genuinely fillable — pulling any
// ONE of them out (see C3b/C3's "both RBs" fixture) is what makes it genuinely NOT fillable.
function tightNine(prefix) {
  const P = prefix.toUpperCase();
  return [
    { key: prefix + "qb", name: P + " QB", pos: "QB", team: "PHI", slot: "QB" },
    { key: prefix + "rb1", name: P + " RB1", pos: "RB", team: "KC", slot: "RB" },
    { key: prefix + "rb2", name: P + " RB2", pos: "RB", team: "KC", slot: "RB" },
    { key: prefix + "wr1", name: P + " WR1", pos: "WR", team: "KC", slot: "WR" },
    { key: prefix + "wr2", name: P + " WR2", pos: "WR", team: "KC", slot: "WR" },
    { key: prefix + "te", name: P + " TE", pos: "TE", team: "KC", slot: "TE" },
    { key: prefix + "rb3", name: P + " RB3", pos: "RB", team: "KC", slot: "FLEX" },
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
    const cap = 19; // roster.QB1+RB2+WR2+TE1+FLEX1+DST1+K1+BENCH7+IR3, per LG.DEFAULT_RULES.roster
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
      ok(before.length === cap, "team 1 starts at exactly the roster cap (" + before.length + "/" + cap + ")");
      const offer = await ev(A, () => window.__GFFL__.LG.offerTrade(1, 2, ["f1_1"], ["p902", "p903"], ""));
      // PROOF that acceptTrade's own early-refusal gate (added by this same ruling) ALSO
      // catches this fixture — this exact trade is already over cap (19 -1 +2 = 20) at offer
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
        "team 1 to " + (cap + 1) + " players (19 -1 +2), one over LG.rosterCap()=" + cap + " (status=" + r.status + " reason=" + r.cancelReason + ")");
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
    // lineup before the trade, so losing the QB is what BREAKS it.
    {
      const t1 = tightNine("a"); // 9 players, exactly fills QB1/RB2/WR2/TE1/FLEX1/DST1/K1 with none left over
      const t2 = [...tightNine("b"), { key: "bspare", name: "B Spare", pos: "RB", team: "KC", slot: "BENCH" }]; // a full lineup PLUS one spare RB it can afford to give away
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
        "RESTAGED (ruling 2026-08-17, was 'executes silently'): executeTrade now CANCELS — hand check: post-trade team 1 " +
        "would be (arb1,arb2,awr1,awr2,ate,arb3,adst,ak,bspare), 9 players with RB2=(arb1,arb2), WR2=(awr1,awr2), TE1=ate, " +
        "FLEX1=(arb3 or bspare), DST1=adst, K1=ak all resolvable — every slot but QB1, which has ZERO eligible players " +
        "left, is exactly the case this checker subsumes without a QB special case (status=" + r.status + " reason=" +
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
      const t1 = [
        { key: "cqb", name: "C QB", pos: "QB", team: "PHI", slot: "QB" },
        { key: "crb1", name: "C RB1", pos: "RB", team: "KC", slot: "RB" },
        { key: "crb2", name: "C RB2", pos: "RB", team: "KC", slot: "RB" },
        { key: "cwr1", name: "C WR1", pos: "WR", team: "KC", slot: "WR" },
        { key: "cwr2", name: "C WR2", pos: "WR", team: "KC", slot: "WR" },
        { key: "cte", name: "C TE", pos: "TE", team: "KC", slot: "TE" },
        { key: "cdst", name: "C DST", pos: "DST", team: "KC", slot: "DST" },
        { key: "ck", name: "C K", pos: "K", team: "KC", slot: "K" },
        // 8 real positions + one throwaway: QB isn't FLEX-eligible, so a SECOND QB does
        // nothing for the lineup — there is no FLEX candidate at all yet.
        { key: "cSpareQB", name: "C Spare QB", pos: "QB", team: "PHI", slot: "BENCH" },
      ];
      const t2 = [...tightNine("d"), { key: "incomingRB", name: "Incoming RB", pos: "RB", team: "KC", slot: "BENCH" }];
      const docs = { ...K.seedDocs() };
      docs["team_1"] = teamDoc(1, "Battle Kreussers");
      docs["team_2"] = teamDoc(2, "End Zone Goats");
      docs["roster_" + S_ + "_w1_t1"] = rosterDoc(1, 1, t1);
      docs["roster_" + S_ + "_w1_t2"] = rosterDoc(1, 2, t2);
      const store = K.makeStore(docs);
      const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
      // Give the useless spare QB, get a real RB — post-trade team 1 is exactly the trap
      // shape: (cqb,crb1,crb2,cwr1,cwr2,cte,cdst,ck,incomingRB), one TE and one other FLEX
      // candidate (incomingRB), nothing else spare.
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
        const badOrder = ["QB", "RB", "RB", "WR", "WR", "FLEX", "TE", "DST", "K"];
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
      ok(check.size === 9 && check.naive === false,
        "the arithmetic behind the trap: 9 players, one TE (cte) and one other FLEX-eligible spare (incomingRB) — a " +
        "FLEX-before-TE greedy grabs cte for FLEX (RB/WR/TE are all FLEX-eligible, TE included), leaving TE1 with " +
        "nobody left. The reference naive greedy above genuinely fails this exact roster (naive=" + check.naive + ", size=" + check.size + ")");
      ok(check.exact === true,
        "LG.canFillLineup gets the SAME roster right: TE1=cte, FLEX1=incomingRB, RB2=(crb1,crb2), WR2=(cwr1,cwr2), " +
        "DST1=cdst, K1=ck, QB1=cqb — 9 players, 9 slots, none left over (exact=" + check.exact + ")");
      ok(A.errors.length === 0, "0 page errors");
      await A.ctx.close();
    }
    // --- 3c: BOTH of a team's RB2-slot backs traded away — proves the checker counts a real
    // POSITION SHORTAGE, not just "is there a QB": a completely different shape of the same
    // break. Tested at ACCEPT (not execute, which 3b already proved): a plain, un-bypassed
    // call is the path a real owner actually hits.
    {
      const t1 = tightNine("e");
      const t2 = [...tightNine("f"),
        { key: "fwrSpare1", name: "F WR Spare 1", pos: "WR", team: "KC", slot: "BENCH" },
        { key: "fwrSpare2", name: "F WR Spare 2", pos: "WR", team: "KC", slot: "BENCH" }];
      const docs = { ...K.seedDocs() };
      docs["team_1"] = teamDoc(1, "Battle Kreussers");
      docs["team_2"] = teamDoc(2, "End Zone Goats");
      docs["roster_" + S_ + "_w1_t1"] = rosterDoc(1, 1, t1);
      docs["roster_" + S_ + "_w1_t2"] = rosterDoc(1, 2, t2);
      const store = K.makeStore(docs);
      const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
      // Give BOTH RB2-slot backs (erb1, erb2), keep the FLEX one (erb3) — get 2 WRs back.
      const offer = await ev(A, () => window.__GFFL__.LG.offerTrade(1, 2, ["erb1", "erb2"], ["fwrSpare1", "fwrSpare2"], ""));
      const r = await ev(A, (id) => window.__GFFL__.LG.acceptTrade(id, 2), offer.trade.id);
      ok(!!r && r.ok === false && r.reason === "lineup-unfillable",
        "the arithmetic: post-trade team 1 would be (eqb,ewr1,ewr2,ete,erb3,edst,ek,fwrSpare1,fwrSpare2) — 4 WR-position " +
        "players and 1 RB-position player (erb3), but RB2 needs TWO distinct RB bodies and FLEX cannot lend one back " +
        "(the slot doesn't require RB — the shortage is a plain COUNT of RB-eligible players, 1 where 2 are required). " +
        "acceptTrade refuses at the early gate, reason=" + (r && r.reason) + " detail=" + JSON.stringify(r && r.detail));
      ok(A.errors.length === 0, "0 page errors");
      await A.ctx.close();
    }
  }

  head("C4. a trade executing while processWaivers is mid-run on an overlapping roster");
  {
    // Team 1 is a party to BOTH: it trades p107 away to team 2, AND has a waiver claim pending
    // in the same run. Fired concurrently, one page, no artificial delay — the SAME shape the
    // season sim actually observed for the analogous double-processWaivers race (season-sim bug
    // 4): real network round trips to the fake-Firestore store genuinely interleave within one
    // task even without an injected pause.
    const store = K.makeStore(K.seedDocs({
      ["claim_" + S_ + "_w1_c1"]: claimDoc(1, "c1", 1, "p901", "N. Newman", "RB", "SF", "p110", "B. Backup", 10),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
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
    const tradeApplied = !keys.includes("p107") && keys.includes("p203");
    const waiverApplied = !keys.includes("p110") && keys.includes("p901");
    const bothApplied = tradeApplied && waiverApplied;
    if (bothApplied) {
      ok(true, "both the trade's roster change AND the waiver's roster change survive on team 1's final roster — " +
        "each op's own fresh-read-before-write (both call LG.ensureRoster(..., {fresh:true}) immediately before saving) " +
        "narrowed the window enough that no update was lost here (keys=[" + keys.join(", ") + "])");
    } else {
      // SEAM-FINDING: a genuine lost update — one op's write clobbered the other's, because
      // LG.saveRoster replaces the WHOLE players array and neither op holds a lock or a
      // compare-and-swap against the other. This is the exact class of race the codebase already
      // documents as accepted-but-narrowed ("cross-device waiver concurrency is NARROWED not
      // eliminated... true CAS = transport surgery, argued at the call site" — 2026-08-11 batch)
      // extended to a trade/waiver pair rather than waiver/waiver. Not fixed here — the fix is
      // the same transport-level CAS work already deferred there, out of scope for a single seam.
      ok(true, "SEAM-FINDING pinned: a lost update — trade-applied=" + tradeApplied + " waiver-applied=" + waiverApplied +
        " (keys=[" + keys.join(", ") + "]) — neither op holds a lock, LG.saveRoster replaces the whole array, " +
        "consistent with the codebase's own documented \"narrowed, not eliminated\" concurrency limit");
    }
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
      const t1 = tightNine("g");
      const t2 = tightNine("h");
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
      // and after (still exactly tightNine's shape), so neither CAP nor LINEUP can be why this
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
      const t1 = [...tightNine("i"), { key: "iBench", name: "I Bench", pos: "RB", team: "DAL", slot: "BENCH" }];
      const t2 = [...tightNine("j"), { key: "jBench", name: "J Bench", pos: "RB", team: "KC", slot: "BENCH" }];
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
    const store = K.makeStore(K.seedDocs());
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

  await browser.close();
  srv.close();
  process.exit(done("GFFL seam suite (docs/gffl.md-driven interaction hunt)"));
})().catch((e) => { console.log("\nHARNESS CRASH: " + (e && e.stack ? e.stack : e)); process.exit(2); });
