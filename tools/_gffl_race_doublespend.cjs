// _gffl_race_doublespend.cjs — SEASON-SIM BUGS 3 AND 4, the two races inside processWaivers.
//
//   node tools/_gffl_race_doublespend.cjs
//
// exit 0 = both bugs are gone · exit 1 = one is present (or a page error / staging failure).
//
// BUG 3 — THE FAAB LOST UPDATE. processWaivers builds its purse map from LG.teams (this page's
// CACHED team list) and writes the answer as an ABSOLUTE value. LG.saveTeam merges onto a fresh
// read, which protects every field the caller isn't changing — and cannot protect the one it
// is. So a deduction another device made in between is simply restored: the owner ends up with
// money they already spent. Measured in the season sim at $6 inside two weeks, and an owner
// $54 up across a season. Real money, in the family's own ledger.
//
// BUG 4 — THE GUARD BEHIND THE WRITES. The "did someone else already process this week?"
// re-read sat AFTER the roster writes, the FAAB writes and the transaction log. A second runner
// that lost the race had therefore already rewritten every roster, re-deducted every purse and
// appended a DUPLICATE of every waiver transaction before finding out it lost — and the tx log
// is append-only, so that duplicate is permanent and reads to the family as two identical
// moves. The season sim caught it as one page writing team_1 twice in the same second.
//
// WHAT THIS SCRIPT STAGES.
//   Part 1 (bug 3): device A caches the league, device B spends $30 of team 1's purse, then A
//     processes a week in which team 1 wins a $10 claim. Conserved: 100 − 30 − 10 = 60.
//     Pre-fix A writes 100 − 10 = 90 and B's $30 comes back from the dead.
//   Part 2 (bug 4): ONE page fires processWaivers TWICE in the same task — which is not a
//     contrivance, it is exactly what the sim observed (a render's auto-check chain and the
//     carry-forward-on-open both reaching it while the first was still awaiting). One
//     deduction, one transaction, one set of results.
"use strict";

const K = require("./_gffl_race_kit.cjs");
const { ok, head, done, ev, sleep } = K;
const S_ = K.SEASON;

// A blind-bid claim doc, in the shape lg-core's ONE-DOC-PER-CLAIM split writes them
// (claimId, never `id` — a doc field called `id` is clobbered by the doc-id on every read).
const claimDoc = (week, claimId, teamId, addKey, addName, dropKey, bid) => ({
  kind: "claim", season: S_, week, claimId, teamId,
  addKey, addName, addPos: "RB", addTeam: "SF",
  dropKey, dropName: "B. Backup", bid, t: 1,
});

(async () => {
  console.log("GFFL RACE REPRO — bugs 3 & 4: the FAAB lost update, and the guard behind the writes");

  const srv = await K.startStatic();
  const browser = await K.launch();

  // ============================================================ PART 1 — the lost update
  head("bug 3 — a purse another device already spent from");
  {
    const store = K.makeStore(K.seedDocs({
      ["claim_" + S_ + "_w1_c1"]: claimDoc(1, "c1", 1, "p901", "N. Newman", "p110", 10),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));
    const B = await K.boot(await K.newDevice(browser, store, "B", { team: 2, who: "Joy" }));

    // Device A has the league loaded — including team 1's purse at the full budget. This is
    // the ordinary state of any page that has been open for more than a moment.
    const aSaw = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      await LG.loadTeams();
      return LG.teamFaab(LG.teamById(1));
    });
    ok(aSaw === 100, "device A has team 1's purse cached at the full budget ($" + aSaw + ")");

    // Device B spends $30 of it — a waiver that cleared on someone else's phone.
    await ev(B, () => window.__GFFL__.LG.saveTeam({ teamId: 1, faab: 70 }));
    await sleep(150);
    ok(store.docs.team_1.faab === 70, "device B has taken $30 off it in the store (now $" + store.docs.team_1.faab + ")");

    // Device A now processes a week in which team 1 wins a $10 claim.
    const res = await ev(A, () => window.__GFFL__.LG.processWaivers(1));
    await sleep(250);
    const won = (res.results || []).filter((r) => r.ok);
    ok(won.length === 1, "team 1's $10 claim is awarded (" + JSON.stringify(res.results) + ")");

    const faab = store.docs.team_1.faab;
    ok(faab === 60,
      "the purse is $60 — the budget less BOTH spends ($100 − $30 − $10). It reads $" + faab +
      (faab === 90 ? " — device B's $30 has come back from the dead (the lost update)" : ""));

    ok(A.errors.length === 0 && B.errors.length === 0,
      "0 page errors (" + JSON.stringify([...A.errors, ...B.errors]) + ")");
    await A.ctx.close(); await B.ctx.close();
  }

  // ============================================================ PART 2 — the double run
  head("bug 4 — one page, two runs of the same week, in the same task");
  {
    const store = K.makeStore(K.seedDocs({
      ["claim_" + S_ + "_w1_c1"]: claimDoc(1, "c1", 1, "p901", "N. Newman", "p110", 25),
    }));
    const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));

    // BOTH calls are fired without awaiting the first — the shape the sim observed, where a
    // render's auto-check chain and the carry-forward-on-open both reach processWaivers while
    // the first run is still in flight.
    const both = await ev(A, async () => {
      const LG = window.__GFFL__.LG;
      const [r1, r2] = await Promise.all([LG.processWaivers(1), LG.processWaivers(1)]);
      return { a: (r1.results || []).length, b: (r2.results || []).length };
    });
    await sleep(400);
    ok(both.a === 1 && both.b === 1, "both callers get the week's one result back (" + JSON.stringify(both) + ")");

    const faab = store.docs.team_1.faab;
    ok(faab === 75, "the $25 bid is deducted ONCE — the purse reads $" + faab + " (a double run leaves $50)");

    const txs = Object.entries(store.docs).filter(([, d]) => d.kind === "tx" && d.type === "waiver");
    ok(txs.length === 1,
      "exactly ONE waiver transaction is logged — the log is append-only, so a duplicate is permanent (" +
      txs.length + ": " + JSON.stringify(txs.map(([id]) => id)) + ")");

    // The roster is idempotent under a re-run, but the WRITES are not free and a second runner
    // that lost must not have made any — that is the whole point of the guard moving in front.
    const rosterWrites = store.writes.filter((w) => w.id === "roster_" + S_ + "_w1_t1");
    ok(rosterWrites.length === 1,
      "the roster is written once, not twice (" + rosterWrites.length + " write(s))");
    const teamWrites = store.writes.filter((w) => w.id === "team_1");
    ok(teamWrites.length === 1,
      "the purse is written once, not twice (" + teamWrites.length + " write(s))");

    const ros = (store.docs["roster_" + S_ + "_w1_t1"].players || []).map((p) => p.key);
    ok(ros.filter((k) => k === "p901").length === 1 && !ros.includes("p110"),
      "the roster holds the won player exactly once and no longer holds the dropped one ([" + ros.join(", ") + "])");

    ok(A.errors.length === 0, "0 page errors (" + JSON.stringify(A.errors) + ")");
    await A.ctx.close();
  }

  await browser.close();
  srv.close();
  process.exit(done("bugs 3 & 4 (waiver double-spend / double-run)"));
})().catch((e) => { console.log("\nHARNESS CRASH: " + (e && e.stack ? e.stack : e)); process.exit(2); });
