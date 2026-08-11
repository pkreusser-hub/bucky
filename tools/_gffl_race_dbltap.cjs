// _gffl_race_dbltap.cjs — the SEASON-SIM ADVISORY: #claimGo is not idempotent.
//
//   node tools/_gffl_race_dbltap.cjs
//
// exit 0 = the button is disarmed · exit 1 = a second entry still files a duplicate claim.
//
// THE HAZARD. The claim card's submit handler reads the bid, then closes the card. Closing
// EMPTIES #rosterCard (the modal discipline the player card established — a modal must not
// hold a stale screen), so #claimBid is gone afterwards. `chosen` is a CLOSURE variable and
// survives, so the handler's own `if (!chosen) return` guard does not stop a second entry:
// it re-runs with a real drop still selected and `Number(undefined) || 0` for the bid, and
// files a DUPLICATE claim for the same player at $0. The owner's real bid is the one that
// then loses, silently, and no screen ever says so.
//
// ⚠ THIS IS AN ADVISORY, AND THE HONESTY MATTERS. It is not reachable by a real double-tap
// today — the season sim measured that: a second REAL pointer tap is hit-tested against a
// button already detached from the DOM and never fires, while a programmatic click()×2 files
// the duplicate. So the script below drives it the way it is genuinely reachable, and says so
// in its own output. It becomes a live bug the moment anything puts an await, an animation or
// a confirm step between the click and the close, or keeps the card mounted — which is exactly
// why the fix disarms the CONTROL rather than relying on the read order that made this class
// survive its own last fix.
"use strict";

const K = require("./_gffl_race_kit.cjs");
const { ok, head, done, ev, sleep } = K;
const S_ = K.SEASON;

(async () => {
  console.log("GFFL RACE REPRO — advisory: #claimGo files a duplicate $0 claim on a second entry");
  console.log("(driven programmatically — a real double-tap cannot reach it today; see the header)");

  const srv = await K.startStatic();
  const store = K.makeStore(K.seedDocs());
  const browser = await K.launch();
  const A = await K.boot(await K.newDevice(browser, store, "A", { team: 1, who: "Peter" }));

  head("staging — the claim card, open, with a bid typed and a drop picked");

  // Week 1, BEFORE the waiver deadline: that is the state in which the card offers a FAAB bid
  // at all (past it, the card is a plain "Add" with no #claimBid and nothing to lose).
  await ev(A, () => {
    const LG = window.__GFFL__.LG;
    LG.nowOverride = LG.waiverDeadline(1) - 3600 * 1000;
    window.__GFFL__.UI.week = 1;
  });
  await ev(A, () => window.__GFFL__.UI.go("moves"));
  await A.page.waitForSelector("#faResults tr[data-pk] .faMoveBtn", { timeout: 15000 });

  const key = await ev(A, () => {
    const row = [...document.querySelectorAll("#faResults tr[data-pk]")]
      .find((r) => { const b = r.querySelector(".faMoveBtn"); return b && !b.disabled; });
    if (!row) return null;
    row.querySelector(".faMoveBtn").click();
    return row.dataset.pk;
  });
  ok(!!key, "a free agent's MOVE button opens the claim card (" + key + ")");
  // The row must be a GENUINE free agent, or this repro is quietly claiming somebody's starter
  // and the ownership half of the fixture is broken (see the name-matching note in the kit).
  const owned = await ev(A, async (k) => {
    const LG = window.__GFFL__.LG;
    const pid = String(k).replace(/^slp_/, "");
    for (const t of LG.teams) {
      const r = (await LG.ensureRoster(1, t.id, { fresh: true })) || [];
      if (r.some((p) => p.key === pid || p.key === k)) return t.id;
    }
    return null;
  }, key);
  ok(owned === null, "…and that row really is unowned (owner: " + owned + ")");
  await A.page.waitForSelector("#rosterCard [data-di]", { timeout: 8000 });

  const staged = await ev(A, () => {
    const bid = document.querySelector("#claimBid");
    if (!bid) return { bid: false };
    bid.value = "11";
    document.querySelector("#rosterCard [data-di]").click(); // pick a drop -> arms #claimGo
    return { bid: true, armed: !document.querySelector("#claimGo").disabled };
  });
  ok(staged.bid, "the card offers a FAAB bid (we are before the waiver deadline)");
  ok(staged.armed, "picking a drop arms the submit button");

  head("the verdict — the handler is entered TWICE in one task");

  // Two click events on the same button object, synchronously — the shape the sim measured.
  await ev(A, () => { const g = document.querySelector("#claimGo"); g.click(); g.click(); });
  await sleep(700);

  const claims = Object.entries(store.docs)
    .filter(([, d]) => d.kind === "claim" && d.week === 1 && d.teamId === 1 && d.addKey === key)
    .map(([id, d]) => ({ id, bid: d.bid }));

  ok(claims.length === 1,
    "exactly ONE claim is filed for that player (" + claims.length + ": " + JSON.stringify(claims) + ")");
  ok(!claims.some((c) => Number(c.bid) === 0),
    "no $0 claim exists — the owner's real bid is not shadowed by a phantom one (" + JSON.stringify(claims.map((c) => c.bid)) + ")");
  ok(claims.length === 1 && Number(claims[0].bid) === 11,
    "the one claim carries the bid that was actually typed ($" + (claims[0] && claims[0].bid) + ")");

  // The disarm itself, asserted directly: it is the property that closes the CLASS, and it
  // must hold whether or not this particular staging can still reach the handler.
  const disarmed = await ev(A, () => {
    const g = document.querySelector("#claimGo");
    return g ? { present: true, disabled: g.disabled } : { present: false };
  });
  ok(!disarmed.present || disarmed.disabled === true,
    "the submit control is disarmed (or gone with the card) after firing — " + JSON.stringify(disarmed));

  ok(A.errors.length === 0, "0 page errors (" + JSON.stringify(A.errors) + ")");

  await browser.close();
  srv.close();
  process.exit(done("advisory (#claimGo double-fire)"));
})().catch((e) => { console.log("\nHARNESS CRASH: " + (e && e.stack ? e.stack : e)); process.exit(2); });
