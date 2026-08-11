// _gffl_race_clobber.cjs — SEASON-SIM BUG 1: ensureRoster's copy-forward is a blind write.
//
//   node tools/_gffl_race_clobber.cjs
//
// exit 0 = the bug is gone · exit 1 = the bug is present (or a page error / staging failure).
//
// THE BUG, stated as the mechanism rather than the symptom.
// A league renders a week by listing every roster doc up front (lg-ui's loadWeekRosters —
// "ONE list() up front instead of N per-doc reads … A cached list of the kind answers 'absent'
// for free"). That list snapshot is what lg-core's knownAbsent() then uses to answer
// get(roster_<season>_w<week>_t<team>) as **null with no round trip**. So on a week nobody has
// touched yet, "this roster does not exist" is DERIVED from a snapshot, not observed.
// LG.ensureRoster took that null at face value, copied week N-1 forward, and WROTE.
// Between the snapshot and the write, another device wins a waiver — or an owner sets a
// lineup — and writes that exact doc. The copy-forward lands on top of it. Measured in the
// season sim: waiver results silently undone, and (because the previous week still holds the
// dropped player while the new roster holds the added one) a player on TWO teams from week 8
// to the end of the season. 551 of the season's 622 roster writes take this path.
//
// WHAT THIS SCRIPT STAGES, and why each step is the honest one.
//   1. Device A renders the week — a real render, through the real Moves view — which is what
//      puts the week-2 absence into its list cache. Nothing is faked: the "stale snapshot" is
//      the one the app itself takes, for the reason it takes it.
//   2. Device B, a genuinely separate browser context sharing the same Node-side store, writes
//      the week-2 roster: team 1 has added a player and dropped another, exactly as a won
//      waiver leaves the doc.
//   3. Device A calls ensureRoster for that week — the call every render makes.
// PRE-FIX device A's copy-forward wins and B's write is gone. POST-FIX device A reads fresh
// before writing, finds the doc, and adopts it.
"use strict";

const K = require("./_gffl_race_kit.cjs");
const { ok, head, done, ev, sleep } = K;
const S_ = K.SEASON;

(async () => {
  console.log("GFFL RACE REPRO — bug 1: ensureRoster's copy-forward clobbers a concurrent write");

  const srv = await K.startStatic();
  const store = K.makeStore(K.seedDocs());
  const browser = await K.launch();

  const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
  const B = await K.boot(await K.newDevice(browser, store, "B", { team: 2, who: "Joy" }));

  const rid = "roster_" + S_ + "_w2_t1";

  head("staging");
  ok(!store.docs[rid], "week 2 starts with no roster doc for team 1 (the copy-forward's own precondition)");

  // ---- 1. Device A renders week 2. This is the ONLY thing that makes the absence "free":
  // loadWeekRosters lists the roster kind, and knownAbsent answers every week-2 get from it.
  await ev(A, () => { window.__GFFL__.UI.week = 2; });
  await ev(A, () => window.__GFFL__.UI.go("moves"));
  await sleep(500);
  // The render itself already copied week 1 forward (that IS the write under test), so the
  // store and device A's caches are reset back to the pre-write state and the render's OWN
  // first step is re-run: LG.db.list("roster"), the list whose snapshot knownAbsent then
  // answers every week-2 get from. What that leaves is exactly the state every first render of
  // a new week is genuinely in — a list snapshot saying "absent", no cached doc — and the ONE
  // write this repro judges is now the one it stages.
  delete store.docs[rid];
  store.writes.length = 0;
  await ev(A, () => window.__GFFL__.LG.db.clearCache());
  await ev(A, () => window.__GFFL__.LG.db.list("roster"));
  const aThinksAbsent = await ev(A, (id) => window.__GFFL__.LG.db.get(id).then((d) => !d), rid);
  ok(aThinksAbsent, "device A's cached list answers 'week 2 has no roster' with no round trip — the stale snapshot is real");

  // ---- 2. Device B writes the week-2 roster: the shape a won waiver leaves behind.
  const WON = "p999";
  await ev(B, async (season, week) => {
    const LG = window.__GFFL__.LG;
    const w1 = await LG.loadRoster(1, 1, { fresh: true });
    const next = w1.map((p) => ({ ...p }));
    const i = next.findIndex((p) => p.key === "p110");     // drop B. Backup
    next.splice(i, 1, { key: "p999", name: "N. Newman", pos: "RB", team: "SF", slot: "BENCH" });
    await LG.saveRoster(week, 1, next);
  }, S_, 2);
  await sleep(200);
  const afterB = store.docs[rid];
  ok(afterB && afterB.players.some((p) => p.key === WON),
    "device B has written week 2 for team 1, with the won player on it");

  // ---- 3. Device A does what every render does.
  const aResult = await ev(A, async (week) => {
    const r = await window.__GFFL__.LG.ensureRoster(week, 1);
    return r.map((p) => p.key);
  }, 2);
  await sleep(200);

  head("the verdict");
  const stored = store.docs[rid];
  const storedKeys = (stored && stored.players || []).map((p) => p.key);
  const clobber = store.writes.filter((w) => w.id === rid && w.by === "A");

  ok(storedKeys.includes(WON),
    "the roster of record still holds the player device B won" +
    (storedKeys.includes(WON) ? "" : " — CLOBBERED by device A's copy-forward; store now: [" + storedKeys.join(", ") + "]"));
  ok(!storedKeys.includes("p110"),
    "…and the dropped player has NOT come back (a copy-forward restores him)");
  ok(aResult.includes(WON),
    "device A's own ensureRoster RETURNS the real roster, not its copy-forward (got: [" + aResult.join(", ") + "])");
  ok(clobber.length === 0,
    "device A wrote nothing over it (" + clobber.length + " write(s) from A: " +
    JSON.stringify(clobber.map((w) => (w.patch.players || []).map((p) => p.key))) + ")");

  // A player on two teams is the season-long consequence, so it is asserted as its own fact.
  const t2 = await ev(B, async () => (await window.__GFFL__.LG.ensureRoster(2, 2, { fresh: true })).map((p) => p.key));
  const dup = storedKeys.filter((k) => t2.includes(k));
  ok(dup.length === 0, "no player is on two teams in week 2 (" + JSON.stringify(dup) + ")");

  ok(A.errors.length === 0 && B.errors.length === 0,
    "0 page errors on both devices (" + JSON.stringify([...A.errors, ...B.errors]) + ")");

  await browser.close();
  srv.close();
  process.exit(done("bug 1 (roster clobber)"));
})().catch((e) => { console.log("\nHARNESS CRASH: " + (e && e.stack ? e.stack : e)); process.exit(2); });
