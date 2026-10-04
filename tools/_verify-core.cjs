// _verify-core.cjs — fast NODE-ONLY checks of the GFFL engine (assets/league/lg-core.js).
//
//   node tools/_verify-core.cjs
//
// lg-core.js is loaded into a bare `vm` context with ~15 lines of browser stubs and LG.db is
// swapped for an in-memory fake. No Chrome, no network, runs in about a second. Every expected
// number below is HAND-COMPUTED from the fixture in the comment beside it. The fake DB is
// deliberately NOT kinder than the real one where it matters: list() hands back ONE shared array
// per kind, exactly as LG.db's cache does, so an in-place sort of it is visible.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CORE = path.join(__dirname, "..", "assets", "league", "lg-core.js");
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log("  FAIL  " + msg); } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");

function load() {
  const store = {};
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const win = {};
  const ctx = {
    window: win, location: { search: "?fam=core1", hostname: "localhost", href: "http://localhost/league.html", origin: "http://localhost" },
    localStorage: ls, sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: { userAgent: "node" },
    document: { addEventListener() {}, querySelector() { return null; }, getElementById() { return null }, createElement() { return { style: {}, getContext() { return null; } }; }, body: {} },
    console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, URLSearchParams, Intl, Date, Math, JSON, Map, Set, Promise,
    fetch: async () => ({ ok: false, json: async () => null, text: async () => "" }),
    addEventListener() {}, indexedDB: undefined, crypto: { subtle: null }, TextEncoder, performance: { now: () => Date.now() }, atob, btoa, structuredClone,
  };
  win.window = win; Object.assign(win, ctx); ctx.self = win;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(CORE, "utf8"), ctx);
  const LG = win.LG;
  // In-memory LG.db. `kind` is the doc's own field (team_* ids are teams), like the real store.
  const docs = new Map();
  const lists = new Map(); // kind -> the ONE array handed to every caller (the cache's behaviour)
  const rowsOf = (kind) => [...docs.entries()].filter(([id, d]) => d.kind === kind || (kind === "team" && id.startsWith("team_"))).map(([id, d]) => ({ ...d, id }));
  const db = {
    docs, stats: { lists: 0, fresh: 0, sets: 0 }, fail: null,
    async get(id) { return docs.has(id) ? { ...docs.get(id), id } : null; },
    async getFresh(id) { return this.get(id); },
    async list(kind) { if (!lists.has(kind)) lists.set(kind, rowsOf(kind)); return lists.get(kind); },
    async listFresh(kind) { lists.delete(kind); return this.list(kind); },
    // The real LG.db.listSince, minus the transport: a range read when the backend has one, else list + filter.
    async listSince(kind, sinceMs) { this.stats.since = (this.stats.since || 0) + 1; return (await this.list(kind)).filter((d) => Number(d.t) >= sinceMs); },
    async set(id, d) { docs.set(id, { ...(docs.get(id) || {}), ...d }); lists.clear(); },
    async del(id) { docs.delete(id); lists.clear(); },
    async update(id, fn) {
      if (this.fail) { const f = this.fail(id); if (f) throw f; }
      const cur = docs.has(id) ? { ...docs.get(id) } : null;
      const next = fn(cur);
      if (next == null) return { ok: false, aborted: true, doc: cur };
      docs.set(id, { ...(cur || {}), ...next }); lists.clear();
      return { ok: true, doc: docs.get(id) };
    },
  };
  LG.db = db;
  LG.pushAllBut = () => {}; LG.pushTeam = () => {}; LG.pushNotify = () => {}; LG.logAct = () => {}; LG.pushWaiverResults = () => {};
  return { LG, db, ctx };
}

const P = (key, pos, slot) => ({ key, name: key, pos, team: "X", slot });
function fullRoster(pre) {
  const slots = [["QB", "QB"], ["RB", "RB"], ["RB", "RB"], ["RB", "RB"], ["WR", "WR"], ["WR", "WR"], ["WR", "WR"], ["TE", "TE"], ["RB", "FLEX"], ["DST", "DST"], ["K", "K"]];
  const r = slots.map(([pos, slot], i) => P(pre + i, pos, slot));
  for (let i = 0; i < 7; i++) r.push(P(pre + "b" + i, "WR", "BENCH"));
  return r;
}
async function seedTeams(LG, db, n, faab) {
  for (let i = 1; i <= n; i++) await db.set("team_" + i, { kind: "team", teamId: i, name: "T" + i, faab: faab == null ? 100 : faab });
  await LG.loadTeams();
}
const weekly = (db, week, ms) => db.set("weekly_2026_w" + week, { kind: "weekly", week, matchups: ms.map(([home, away, homePts, awayPts]) => ({ home, away, homePts, awayPts })), power: [{ teamId: 1, score: 1 }] });

(async () => {
  // ====================================================================== 1. WAIVER REPLAY
  {
    const { LG, db } = load();
    await LG.loadRules(); await seedTeams(LG, db, 2);
    await db.set("roster_2026_w4_t1", { kind: "roster", week: 4, teamId: 1, players: fullRoster("a") });
    await db.set("roster_2026_w4_t2", { kind: "roster", week: 4, teamId: 2, players: fullRoster("b") });
    const claim = (id, tid, add, drop, bid) => db.set("claim_2026_w4_" + id, { kind: "claim", season: 2026, week: 4, claimId: id, teamId: tid, addKey: add, addName: add, addPos: "WR", addTeam: "Y", dropKey: drop, dropName: drop, bid, t: tid });
    await claim("c1", 1, "FA1", "ab0", 10); await claim("c2", 2, "FA2", "bb0", 5);
    let failed = false;
    db.fail = (id) => (id === "roster_2026_w4_t2" && !failed ? ((failed = true), new Error("flaky")) : null);
    const r1 = await LG.processWaivers(4);
    ok(r1.processed === false && r1.failures.length === 1 && r1.failures[0].teamId === 2, "WV1 run 1 reports team 2's roster failure and stays unprocessed");
    ok(db.docs.get("roster_2026_w4_t1").players.some((p) => p.key === "FA1"), "WV2 team 1's roster WAS moved before the failure (the state the bug lives in)");
    ok(db.docs.get("team_1").faab === 100, "WV3 nothing is charged while the run is unprocessed");
    // A claim filed or cancelled now cannot change a resolution that is already stored.
    eq((await LG.addClaim(4, { id: "late", teamId: 1, addKey: "FA9", addName: "FA9", addPos: "WR", addTeam: "Y", dropKey: "ab1", bid: 1 })).reason, "already-processed", "WV4 a stored plan closes the week to new claims");
    const r2 = await LG.processWaivers(4);
    ok(r2.processed === true, "WV5 the re-run completes the week");
    eq(r2.results.map((x) => [x.id, x.ok, x.reason]), [["c1", true, "won"], ["c2", true, "won"]], "WV6 the re-run REPLAYS the first resolution: team 1 still WON (was player-taken before the fix)");
    eq([db.docs.get("team_1").faab, db.docs.get("team_2").faab], [90, 95], "WV7 FAAB charged exactly once each: 100-10 and 100-5");
    eq([...db.docs.values()].filter((d) => d.kind === "tx" && d.type === "waiver").map((d) => d.teamId).sort(), [1, 2], "WV8 exactly one waiver tx per winner");
    ok(db.docs.get("roster_2026_w4_t2").players.some((p) => p.key === "FA2") && !db.docs.get("roster_2026_w4_t2").players.some((p) => p.key === "bb0"), "WV9 team 2's roster applied on the replay (add in, drop out)");
    const r3 = await LG.processWaivers(4);
    ok(r3.processed === true && db.docs.get("team_1").faab === 90, "WV10 a third run changes nothing");
    eq([...db.docs.values()].filter((d) => d.kind === "tx" && d.type === "waiver").length, 2, "WV11 …and logs nothing more");
  }
  // ---- the pre-existing race guarantees still hold: a bid ladder + a contested player, no failure.
  {
    const { LG, db } = load();
    await LG.loadRules(); await seedTeams(LG, db, 3, 20);
    for (const i of [1, 2, 3]) await db.set("roster_2026_w4_t" + i, { kind: "roster", week: 4, teamId: i, players: fullRoster("r" + i) });
    const claim = (id, tid, add, drop, bid, extra) => db.set("claim_2026_w4_" + id, { kind: "claim", season: 2026, week: 4, claimId: id, teamId: tid, addKey: add, addName: add, addPos: "WR", addTeam: "Y", dropKey: drop, dropName: drop, bid, t: tid, ...(extra || {}) });
    await claim("a", 1, "FA1", "r10", 7); await claim("b", 2, "FA1", "r20", 9); await claim("c", 3, "FA1", "r30", 9);
    // team 3 and team 2 tie at $9: no games played so the worse record goes first = lower id first (waiver order on an untouched season) -> team 2 wins.
    const r = await LG.processWaivers(4);
    eq(r.results.map((x) => [x.id, x.reason]).sort(), [["a", "outbid"], ["b", "won"], ["c", "outbid"]], "WV12 contested player: the $9 bid with waiver priority wins, the rest are outbid");
    eq([db.docs.get("team_2").faab, db.docs.get("team_1").faab, db.docs.get("team_3").faab], [11, 20, 20], "WV13 only the winner pays");
    ok(r.processed && !r.failures, "WV14 clean run has no failures");
  }
  // ====================================================================== 2. BID VALIDATION
  {
    const { LG, db } = load();
    await LG.loadRules(); await seedTeams(LG, db, 2);
    eq([LG.validBid(5), LG.validBid(0), LG.validBid(-1), LG.validBid(2.5), LG.validBid(NaN), LG.validBid("7"), LG.validBid(Infinity)], [5, 0, null, null, null, null, null], "BID1 validBid accepts whole dollars >= 0 only");
    eq([LG.cleanBid(4.9), LG.cleanBid(-3), LG.cleanBid(NaN), LG.cleanBid(undefined), LG.cleanBid("6")], [4, 0, 0, 0, 6], "BID2 cleanBid floors, clamps at 0, and never returns NaN");
    await db.set("roster_2026_w4_t1", { kind: "roster", week: 4, teamId: 1, players: fullRoster("a") });
    await db.set("roster_2026_w4_t2", { kind: "roster", week: 4, teamId: 2, players: fullRoster("b") });
    for (const bad of [NaN, -5, 1.5, Infinity]) {
      const r = await LG.addClaim(4, { id: "x", teamId: 1, addKey: "FA1", addName: "FA1", addPos: "WR", addTeam: "Y", dropKey: "a0", bid: bad });
      eq(r.reason, "bad-bid", "BID3 addClaim refuses bid " + bad);
    }
    // A bad bid ALREADY on disk (written before this validation) must not poison the purse.
    await db.set("claim_2026_w4_old", { kind: "claim", season: 2026, week: 4, claimId: "old", teamId: 1, addKey: "FA1", addName: "FA1", addPos: "WR", addTeam: "Y", dropKey: "ab0", bid: NaN, t: 1 });
    await db.set("claim_2026_w4_neg", { kind: "claim", season: 2026, week: 4, claimId: "neg", teamId: 2, addKey: "FA2", addName: "FA2", addPos: "WR", addTeam: "Y", dropKey: "bb0", bid: -50, t: 2 });
    await db.set("claim_2026_w4_old", { bid: undefined }); // NaN is not storable; the point is a missing bid
    const r = await LG.processWaivers(4);
    ok(r.processed, "BID4 run completes with unusable bids");
    eq([db.docs.get("team_1").faab, db.docs.get("team_2").faab], [100, 100], "BID5 unusable bids read as $0: both purses stay 100, never NaN or 150");
  }
  // ====================================================================== 3. RANKING WITH TIES
  {
    const { LG, db } = load();
    await LG.loadRules(); await seedTeams(LG, db, 4);
    // wk1: T1 v T2 tie 110/110 · T3 beat T4 100/90.   wk2: T2 beat T4 120/100 · T3 beat T1 105/100.
    await weekly(db, 1, [[1, 2, 110, 110], [3, 4, 100, 90]]);
    await weekly(db, 2, [[2, 4, 120, 100], [1, 3, 100, 105]]);
    // T1: 0-1-1 pf 210 · T2: 1-0-1 pf 230 · T3: 2-0 pf 205 · T4: 0-2 pf 190
    const st = await LG.loadStandings();
    eq([st[1].w, st[1].l, st[1].t], [0, 1, 1], "TB1 T1 record");
    eq([st[2].w, st[2].l, st[2].t], [1, 0, 1], "TB2 T2 record");
    eq(LG.rankTeams([1, 2, 3, 4], st), [3, 2, 1, 4], "TB3 win% with a half-win tie: 2-0 (1.0) > 1-0-1 (0.75) > 0-1-1 (0.25) > 0-2 (0)");
    // 1-1 (.5) vs 1-0-1 (.75): the old wins-then-PF sort put the 1-1 team first on PF.
    const a = { w: 1, l: 1, t: 0, pf: 300 }, b = { w: 1, l: 0, t: 1, pf: 200 };
    eq(LG.rankTeams([1, 2], { 1: a, 2: b }), [2, 1], "TB4 1-0-1 (pf 200) outranks 1-1 (pf 300): the tie is worth half a win");
    // Head-to-head: A and B both 1-1; B has more PF but A won the game between them.
    const mk = (w, l, pf, h2h) => ({ w, l, t: 0, pf, h2h });
    const s2 = { 1: mk(1, 1, 200, { 2: [1, 0, 0] }), 2: mk(1, 1, 250, { 1: [0, 1, 0] }) };
    eq(LG.rankTeams([1, 2], s2), [1, 2], "TB5 default rule: head-to-head beats points-for");
    eq(LG.rankTeams([1, 2], s2, { rule: ["pf"] }), [2, 1], "TB6 rule [pf] alone: points-for decides");
    eq(LG.rankTeams([1, 2], s2, { rule: [] }), [1, 2], "TB7 no tiebreakers: team id");
    // Never met -> h2h cannot separate them -> falls to PF.
    const s3 = { 1: mk(1, 1, 200, {}), 2: mk(1, 1, 250, {}) };
    eq(LG.rankTeams([1, 2], s3), [2, 1], "TB8 teams that never met fall through to points-for");
    // Three-way: 1 beat 2, 2 beat 3, 3 beat 1 (each 1-1 inside the group) -> h2h level -> PF.
    const s4 = { 1: mk(2, 2, 100, { 2: [1, 0, 0], 3: [0, 1, 0] }), 2: mk(2, 2, 300, { 1: [0, 1, 0], 3: [1, 0, 0] }), 3: mk(2, 2, 200, { 1: [1, 0, 0], 2: [0, 1, 0] }) };
    eq(LG.rankTeams([1, 2, 3], s4), [2, 3, 1], "TB9 a three-way cycle is level on h2h (.5 each) and goes to PF: 300, 200, 100");
    // Mini-league restart: 1 beat 2 and 3; 2 and 3 split -> 1 first, then 2/3 by their own h2h (3 beat 2).
    const s5 = { 1: mk(2, 2, 10, { 2: [1, 0, 0], 3: [1, 0, 0] }), 2: mk(2, 2, 900, { 1: [0, 1, 0], 3: [0, 1, 0] }), 3: mk(2, 2, 50, { 1: [0, 1, 0], 2: [1, 0, 0] }) };
    eq(LG.rankTeams([1, 2, 3], s5), [1, 3, 2], "TB10 three tied: the h2h leader peels off, the other two re-rank on THEIR game (3 beat 2) despite 2's huge PF");
    // Head-to-head needs EVERY pair in the tied group to have met. T5 beat T6, but T7 has met nobody here, so the whole group goes to PF.
    const s6 = { 5: mk(1, 1, 200, { 6: [1, 0, 0] }), 6: mk(1, 1, 300, { 5: [0, 1, 0] }), 7: mk(1, 1, 100, {}) };
    eq(LG.rankTeams([5, 6, 7], s6), [6, 5, 7], "TB17 a pair that has not met makes h2h inapplicable to the group: PF 300, 200, 100");
    eq(LG.rankTeams([3, 1, 2], { 1: { w: 0, l: 0, t: 0, pf: 0 }, 2: { w: 0, l: 0, t: 0, pf: 0 }, 3: { w: 0, l: 0, t: 0, pf: 0 } }, { idDesc: true }), [3, 2, 1], "TB11 full tie falls to id (idDesc flips it)");
    // Waiver order: worst first.
    eq(await LG.waiverPriorityOrder(), [4, 1, 2, 3], "TB12 waiver order is the standings reversed: T4 (0-2), T1, T2, T3");
    // Untouched season: lower id first, as it always was.
    const f = load(); await f.LG.loadRules(); await seedTeams(f.LG, f.db, 3);
    eq(await f.LG.waiverPriorityOrder(), [1, 2, 3], "TB13 an untouched 0-0 season keeps lower-id-first");
    // Rule text.
    eq(LG.tiebreakOrder(), ["h2h", "pf"], "TB14 default rules.tiebreak is [h2h, pf]");
    ok(/win % \(a tie counts as half a win\), then head-to-head record among the tied teams, then points for\./.test(LG.tiebreakText()), "TB15 footer text names the applied order: " + LG.tiebreakText());
    eq(LG.tiebreakOrder({ tiebreak: ["pf", "bogus"] }), ["pf"], "TB16 unknown tiebreak tokens are dropped");
  }
  // ---- seeding through buildBracket (the third consumer of the same ranking)
  {
    const { LG, db } = load();
    await LG.loadRules();
    LG.rules = LG.mergeRules(LG.DEFAULT_RULES, { seasonWeeks: 2, playoffs: { teams: 2, byes: 0, startWeek: 3 } });
    await seedTeams(LG, db, 4);
    // wk1: T1 beat T4 150-50 · T2 tied T3 80-80.   wk2: T3 beat T1 160-150 · T2 beat T4 90-60.
    //   T1 1-1 pf 300 · T2 1-0-1 pf 170 · T3 1-0-1 pf 240 · T4 0-2.
    // The OLD wins-then-PF sort gave [1, 3, 2, 4] (three teams on one win, ordered by PF). Ties as half a win make T2 and T3
    // .75 against T1's .5; they tied each other (h2h level), so PF: T3 then T2.
    await weekly(db, 1, [[1, 4, 150, 50], [2, 3, 80, 80]]);
    await weekly(db, 2, [[3, 1, 160, 150], [2, 4, 90, 60]]);
    const b = await LG.buildBracket({ force: true });
    ok(b.ok, "SEED0 bracket builds (" + JSON.stringify(b.reason || "") + ")");
    eq(b.seeds, [3, 2, 1, 4], "SEED1 seeds: T3 (.75, pf 240), T2 (.75, pf 170), T1 (.5), T4 — the old sort had T1 first");
  }
  // ====================================================================== 4. canFillLineup / IR
  {
    const { LG } = load();
    await LG.loadRules();
    LG.rules = LG.DEFAULT_RULES;
    const base = [P("qb", "QB", "QB"), P("r1", "RB", "RB"), P("r2", "RB", "RB"), P("r3", "RB", "RB"), P("w1", "WR", "WR"), P("w2", "WR", "WR"), P("w3", "WR", "WR"),
      P("te", "TE", "TE"), P("fx", "WR", "FLEX"), P("d", "DST", "DST"), P("k", "K", "K"), P("teIR", "TE", "IR"), P("b1", "RB", "BENCH")];
    ok(LG.canFillLineup(base) === true, "IR1 a full lineup fills");
    const noTE = base.filter((p) => p.key !== "te");
    ok(LG.canFillLineup(noTE) === false, "IR2 the only other TE is on IR: he cannot start, so the lineup is NOT fillable");
    const bl = LG.tradeBlockers({ from: 1, to: 2, give: ["te"], get: ["tq2"] }, base, [P("tq2", "WR", "BENCH")]);
    eq(bl.map((x) => x.reason), ["lineup-unfillable"], "IR3 trading away the only startable TE is blocked");
    ok(LG.canFillLineup(noTE.concat([P("te2", "TE", "BENCH")])) === true, "IR4 a bench TE does fill the slot");
  }
  // ====================================================================== 5. || zero traps
  {
    const { LG } = load();
    await LG.loadRules();
    LG.rules = LG.mergeRules(LG.DEFAULT_RULES, { trades: { deadlineWeek: 0 } });
    LG.nowOverride = Date.parse("2026-09-09T18:00:00Z"); // week 1
    ok(LG.currentWeek() === 1 && LG.tradeDeadlinePassed() === true, "ZT1 deadlineWeek 0 means no trades: passed in week 1 (was `0 || 99` = never)");
    LG.rules = LG.mergeRules(LG.DEFAULT_RULES, { trades: { deadlineWeek: 11 } });
    ok(LG.tradeDeadlinePassed() === false, "ZT2 week 1 vs deadline 11: not passed");
    const src = fs.readFileSync(CORE, "utf8");
    ok(!/trades\.(deadlineWeek|reviewHours|vetoVotes)\)\s*\|\|/.test(src), "ZT3 no `||` fallback left on a trades rule field");
  }
  // ====================================================================== 6. loadRules merge
  {
    const { LG, db } = load();
    await db.set("settings", { kind: "settings", v: 3, rules: { name: "X", scoring: { rec: 0.5 }, roster: { RB: 4 } } });
    await LG.loadRules();
    ok(LG.rules.trades && LG.rules.trades.deadlineWeek === 11 && LG.rules.waivers.budget === 100 && LG.rules.playoffs.teams === 5, "RL1 missing blocks come from the defaults");
    ok(LG.rules.seasonWeeks === 14, "RL2 a missing seasonWeeks is 14, not undefined");
    ok(LG.rules.scoring.rec === 0.5 && LG.rules.scoring.pass_td === 4, "RL3 stored scoring wins, the rest of the scoring block fills in");
    ok(LG.rules.roster.RB === 4 && LG.rules.roster.WR === 3, "RL4 a partial roster block merges field by field");
    eq(LG.rules.name, "X", "RL5 stored scalars win");
    ok(LG.teamFaab({}) === 100 && !LG.tradeDeadlinePassed.toString().includes("throw"), "RL6 teamFaab works on a doc with no waivers block");
    ok(Array.isArray(LG.rules.tiebreak), "RL7 tiebreak defaults in");
    const d2 = load(); await d2.db.set("settings", { kind: "settings", v: 1, rules: { tiebreak: ["pf"], playoffs: { teams: 4 } } });
    await d2.LG.loadRules();
    eq([d2.LG.rules.tiebreak, d2.LG.rules.playoffs.teams, d2.LG.rules.playoffs.byes], [["pf"], 4, 3], "RL8 arrays replace wholesale, objects merge");
  }
  // ====================================================================== 7. fmtPts
  {
    const { LG } = load();
    eq([12.35, 8.25, 0.35, 0.45, 151.82, 99.95, 7.5, 0.05, 0.04].map(LG.fmtPts), ["12.4", "8.3", "0.4", "0.5", "151.8", "100.0", "7.5", "0.1", "0.0"], "FP1 half-up on the 1-dp display (was 12.3 / 8.3 / 0.3 / 0.5 / 7.5)");
    eq([-12.35, -0.04, -0.05, "7.55", null, undefined, NaN, "abc"].map(LG.fmtPts), ["-12.4", "0.0", "-0.1", "7.6", "—", "—", "—", "—"], "FP2 negatives mirror, strings parse, junk is a dash");
    eq(LG.fmtPts(0), "0.0", "FP3 zero");
  }
  // ====================================================================== 8. caches are not sorted in place
  {
    const { LG, db } = load();
    await LG.loadRules();
    for (const [id, t] of [["tx_1", 1], ["tx_3", 3], ["tx_2", 2]]) await db.set(id, { kind: "tx", t });
    const before = (await db.list("tx")).map((d) => d.t);
    const out = await LG.loadTx();
    eq(out.map((d) => d.t), [3, 2, 1], "SORT1 loadTx returns newest first");
    eq((await db.list("tx")).map((d) => d.t), before, "SORT2 …without reordering the cache's own array");
    for (const [id, t] of [["trade_1", 1], ["trade_3", 3]]) await db.set(id, { kind: "trade", t });
    const b2 = (await db.list("trade")).map((d) => d.t); await LG.loadTrades();
    eq((await db.list("trade")).map((d) => d.t), b2, "SORT3 loadTrades leaves the cache alone");
  }
  // ====================================================================== 9. activity window
  {
    const { LG, db } = load();
    const NOW = Date.now(), DAY = 86400e3;
    for (const [d, id] of [[1, "a"], [10, "b"], [27, "c"], [40, "d"], [90, "e"]]) await db.set("act_" + (NOW - d * DAY) + "_" + id, { kind: "act", t: NOW - d * DAY, type: "open" });
    const w = await LG.loadAct();
    eq(w.map((r) => r.id.split("_")[2]), ["a", "b", "c"], "ACT1 default window is 28 days, newest first (the 40 and 90 day rows are not returned)");
    eq((await LG.loadAct({ days: 0 })).length, 5, "ACT2 days:0 reads everything");
    eq((await LG.loadAct({ days: 7 })).map((r) => r.id.split("_")[2]), ["a"], "ACT3 a 7-day window");
    ok(db.stats.since === 2, "ACT4 the default and windowed reads go through LG.db.listSince (a range read), not list()");
  }
  // ====================================================================== 10. playoff odds
  {
    // 4 teams, 2 spots, 3-week season. Week 3's pairings come from the stored schedule.
    const setup = async (sched, wk1, wk2) => {
      const { LG, db } = load();
      await LG.loadRules();
      LG.rules = LG.mergeRules(LG.DEFAULT_RULES, { seasonWeeks: 3, playoffs: { teams: 2, byes: 0, startWeek: 4 } });
      await seedTeams(LG, db, 4);
      await LG.saveSchedule(sched);
      await weekly(db, 1, wk1); await weekly(db, 2, wk2);
      return { LG, db };
    };
    const sched = [[[1, 2], [3, 4]], [[1, 3], [2, 4]], [[1, 4], [2, 3]]];
    // wk1: 1 beat 2, 3 beat 4.  wk2: 1 beat 3, 2 beat 4.   After 2 weeks: T1 2-0, T2 1-1, T3 1-1, T4 0-2.
    // wk3 left: 1v4 and 2v3.  T1 can finish no worse than 2-1; the 2v3 winner finishes 2-1, T4 at best 1-2.
    //   T1 is in all 4 outcomes (>=2 wins; at most one other team reaches 2), T4 is out in all 4 (<=1 win while two teams have 2),
    //   T2 and T3 each make it only by winning their game.
    const wk1 = [[1, 2, 100, 90], [3, 4, 100, 90]], wk2 = [[1, 3, 100, 90], [2, 4, 100, 90]];
    {
      const { LG } = await setup(sched, wk1, wk2);
      const o = await LG.playoffOdds();
      eq([o[1], o[4]], [100, 0], "PO1 exact: T1 is CLINCHED (100) and T4 ELIMINATED (0) — certain, not sampled");
      ok(o[2] >= 1 && o[2] <= 99 && o[3] >= 1 && o[3] <= 99, "PO2 T2 and T3 are alive: strictly between 1 and 99 (" + o[2] + ", " + o[3] + ")");
      // LIVE week: the 2v3 game is already decided for T2 (pHome 1 = T2 is the home side of [2,3]).
      const p = await LG.playoffOdds({ live: { week: 3, games: [{ home: 1, away: 4, pHome: 0.5 }, { home: 2, away: 3, pHome: 1 }] } });
      eq([p[1], p[2], p[3], p[4]], [100, 100, 0, 0], "PO3 live: with 2v3 decided for T2, T2 is clinched and T3 eliminated");
      const q = await LG.playoffOdds({ live: { week: 3, games: [{ home: 2, away: 3, pHome: 0.7 }] } });
      ok(q[2] >= 1 && q[2] <= 99, "PO4 a live 0.7 game keeps T2 alive but not certain (" + q[2] + ")");
      ok(q[2] > o[2], "PO5 …and 0.7 for T2 puts T2 above the live-free figure (" + q[2] + " > " + o[2] + ")");
      const k1 = LG._poCache.key;
      await LG.playoffOdds({ live: { week: 3, games: [{ home: 2, away: 3, pHome: 0.4 }] } });
      ok(LG._poCache.key !== k1, "PO6 the cache key includes the live probabilities");
    }
    {
      // Same game COUNT, different pairings -> must not be served from the cache.
      const { LG } = await setup(sched, wk1, wk2);
      const a = await LG.playoffOdds(); const ka = LG._poCache.key;
      await LG.saveSchedule([[[1, 2], [3, 4]], [[1, 3], [2, 4]], [[1, 4], [3, 2]]]); // week 3 home/away flipped on 2v3
      LG.db.docs.set("sched_2026", { ...LG.db.docs.get("sched_2026") });
      await LG.playoffOdds();
      ok(LG._poCache.key !== ka, "PO7 a changed remaining schedule of the same length changes the cache key");
      await LG.saveSchedule([[[1, 2], [3, 4]], [[1, 3], [2, 4]], [[2, 4], [1, 3]]]); // a different set of games altogether
      const c = await LG.playoffOdds();
      ok(JSON.stringify(c) !== JSON.stringify(a), "PO8 and a different set of games gives different odds (" + JSON.stringify(c) + " vs " + JSON.stringify(a) + ")");
    }
    {
      // Preseason, full 8-team schedule: > 12 games left, Monte Carlo only: never 0 or 100.
      const { LG, db } = load();
      await LG.loadRules(); await seedTeams(LG, db, 8);
      await LG.saveSchedule(LG.generateSchedule([1, 2, 3, 4, 5, 6, 7, 8], 14));
      const o = await LG.playoffOdds();
      ok(Object.values(o).every((v) => v >= 1 && v <= 99), "PO9 sampled odds can never claim a lock or an elimination (" + JSON.stringify(o) + ")");
    }
    {
      // A clinch decided by a TIE: T1 and T2 are both 1-0-1... use ties counted as half wins in the sim.
      const { LG, db } = load();
      await LG.loadRules();
      LG.rules = LG.mergeRules(LG.DEFAULT_RULES, { seasonWeeks: 2, playoffs: { teams: 1, byes: 0, startWeek: 3 } });
      await seedTeams(LG, db, 2);
      await LG.saveSchedule([[[1, 2]], [[1, 2]]]);
      await weekly(db, 1, [[1, 2, 100, 100]]); // a tie; week 2 left
      const o = await LG.playoffOdds();
      ok(o[1] >= 1 && o[1] <= 99 && o[2] >= 1 && o[2] <= 99, "PO10 after a tie with one game left neither team is clinched (" + JSON.stringify(o) + ")");
      await weekly(db, 2, [[1, 2, 120, 100]]);
      LG._poCache = null;
      const f = await LG.playoffOdds();
      eq([f[1], f[2]], [100, 0], "PO11 all games final: T1 (1-0-1) is in, T2 (0-1-1) is out — certain");
    }
  }
  // ====================================================================== 11. award ties
  {
    const { LG } = load();
    await LG.loadRules();
    const ros = new Map(); for (const id of [1, 2, 3, 4]) ros.set(id, [P("q" + id, "QB", "QB")]);
    const none = () => null;
    const a = await LG._fzAwards(2, [{ home: 1, away: 2, homePts: 151.82, awayPts: 151.82 }, { home: 3, away: 4, homePts: 100, awayPts: 90 }], () => 0, none, ros);
    eq([a.topScore.teamId, a.topScore.pts, a.topScore.tied], [1, 151.82, [2]], "AW1 an exact tie for Top Score names BOTH teams (the first by id stays teamId, the other is in `tied`)");
    const b = await LG._fzAwards(2, [{ home: 1, away: 2, homePts: 151.82, awayPts: 151.83 }, { home: 3, away: 4, homePts: 100, awayPts: 90 }], () => 0, none, ros);
    ok(b.topScore.teamId === 2 && !("tied" in b.topScore), "AW2 151.82 v 151.83 is not a tie (scores are stored to 2 dp)");
    const c = await LG._fzAwards(2, [{ home: 1, away: 2, homePts: 80, awayPts: 70 }, { home: 3, away: 4, homePts: 100, awayPts: 90 }], () => 0, none, ros);
    ok(c.topScore.teamId === 3 && !("tied" in c.topScore), "AW3 no tie, no `tied` field");
    const d = await LG._fzAwards(2, [{ home: 1, away: 2, homePts: 100, awayPts: 100 }, { home: 3, away: 4, homePts: 100, awayPts: 99 }], () => 0, none, ros);
    eq([d.topScore.teamId, d.topScore.tied], [1, [2, 3]], "AW4 a three-way tie lists both others");
  }
  // ====================================================================== 12. server clock
  {
    const { LG } = load();
    const T = Date.now();
    eq(LG.clockOffset, 0, "CK1 no samples: no offset");
    LG.noteServerTime(new Date(T + 300000 + 50).toISOString(), T, T + 100); // server 300 s ahead, 100 ms round trip -> midpoint T+50
    ok(Math.abs(LG.clockOffset - 300000) <= 5, "CK2 a server 5 minutes ahead gives offset ~300000 (" + LG.clockOffset + ")");
    ok(Math.abs(LG.now() - (Date.now() + 300000)) < 50, "CK3 LG.now() follows server time");
    LG.noteServerTime(new Date(T + 999000).toISOString(), T, T + 4000); // worse round trip: ignored
    ok(Math.abs(LG.clockOffset - 300000) <= 5, "CK4 a slower sample does not replace the best one");
    LG.noteServerTime(new Date(T + 20 * 60e3).toISOString(), T, T + 10);
    ok(Math.abs(LG.clockOffset - 300000) <= 5, "CK5 an offset beyond 15 minutes is ignored (a mocked clock, not skew)");
    LG.noteServerTime("not a date", T, T + 10);
    LG.noteServerTime(undefined, T, T + 10);
    ok(Math.abs(LG.clockOffset - 300000) <= 5, "CK6 garbage never breaks the offset");
    LG.nowOverride = 12345;
    eq(LG.now(), 12345, "CK7 the test override still wins");
  }

  console.log(`\n_verify-core: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
