# 🐐 GFFL TEST PLAN — from tonight to kickoff (written 2026-08-11)

The family's hands-on schedule. Every item is "tap this, you should see that" — if you see
anything else, a screenshot + one sentence to Claude is enough. Items marked **(Claude)** are
run headless from the orchestrator's side and listed so you know they're happening; everything
else is yours or the family's. All times **Central**.

**GATE (before any dated item): tonight's S5–S10 batch must be DEPLOYED.** Everything below
assumes it is live on goatfantasyleague.com. The week-one batch (PINs, countdown, colours,
push) deployed 2026-08-10; S5–S10 are on the branch awaiting the word.

---

## Wed Aug 12 · 7:00–7:30 PM — SETUP NIGHT (you + one kid, two phones)

1. **Commish check** — open goatfantasyleague.com on YOUR phone first (if you haven't since
   the Aug 10 deploy). Rules → any commissioner action → it asks your PIN once; your normal
   family PIN works. This is also what seals the commissioner hash in the cloud.
2. **Install** — Add to Home Screen on both phones (Android: Chrome ⋮ → Install app;
   iPhone: Share → Add to Home Screen). The icon is the GFFL shield, NOT the Bucky goat.
3. **Alerts** — in the installed app: My Team → "Get league alerts on this phone" → Allow.
   Both phones. (iPhone: this only works from the INSTALLED app, not Safari.)
4. **Push round-trip #1** — kid's phone: Moves → send you any trade offer. Your phone should
   buzz "Trade offer" within ~10s; tapping it opens Moves. Now **Counter** it from your
   phone → kid's phone buzzes "Trade countered". Decline to clean up. *(Tests S4 + S7 on
   real hardware — the single most important item on this page.)*
5. **The card** — Moves → tap Add on any free agent → a centered card appears (not a bottom
   sheet) with the FAAB bid box and "Who do you drop?", every row showing PROJ and OWN%.
   **If OWN% reads "—" for everyone**, the ESPN cookies have expired — tell Claude (it's an
   env-var refresh, not a bug). Cancel out.
6. **The pencil** — My Team → pencil (top right) → change a colour → check the standings and
   matchup show it. Countdown card on the League page reads **Sun, Sep 6 · 3:00 PM** and
   ticks.

## Wed/Thu Aug 12–13 · 30 min — SLEEPER/GFFL DRAFT PREP CHECK (optional, whenever)

- Draft Room link opens ffdraft.html inside the installed app (no browser bar). Keeper
  panel shows last year's costs. Report anything that looks wrong THIS WEEK, not draft week.

## Thu Aug 13 · during any preseason game (~7:15 PM on) — GAME-NIGHT DRILL #1 (15 min)

Preseason Week 2 begins; the backup-filled rosters exist precisely so these games light up.
1. **Scores tab** — the live game shows a ticking clock and score; tap it → the field view
   updates with drives/plays.
2. **Matchup tab** — any rostered player in that game accumulates live points; the win%
   bar under the header moves and carries the "est." label.
3. **Finalize refuses** — League page → FINALIZE WEEK 1 → it must refuse with the preseason
   message ("nothing counts yet"). This guard protects the whole season's records.
4. **(Claude)** live probe `--report` during the game — settles the kicker-stat WARN and
   re-proves the feeds under live load.

## Sat–Sun Aug 15–16 — FAMILY ENROLLMENT WEEKEND (10 min per owner)

Every owner, own phone: claim team → set a 4+-digit PIN → install → enable alerts → pencil:
logo and/or colours (Isaac: the Goat Kids crest is already in the app's repo).
**Commish drill**: reset ONE kid's PIN (their locker → pencil → Reset owner PIN), have them
re-claim with a new PIN on their phone. Second device check: any owner logs in on the iPad
with just their PIN.

## Thu Aug 20 · ~7:00 PM — PUSH BLAST + DRILL #2 (during a W3 game, 15 min)

1. **(Claude) force-fires the waiver cron once** (its season guard normally sleeps until
   Sep 9). Within ~a minute, EVERY enrolled phone should get "GFFL waivers". Report who got
   it and who didn't — that's the install-matrix truth table.
2. Repeat drill #1's items 1–3.
3. **Injury feed** — by W3, some rostered player will carry a designation change; check the
   "League injury report" card on the League page and that the OWNING team's phone got the
   push ("Injury update: …").

## Mon Aug 24 – Mon Aug 31 — DRESS-REHEARSAL WEEK

- **(Claude)** P3: full-season replay on a scratch league — waivers → trades → finalize all
  weeks → bracket → champion → **backup restore**. Plus regression battery.
- **Yours (any evening, 15 min)**: a full trade chain with a kid — offer → counter →
  counter-back → accept → wait for the review window / commish push-through → BOTH phones
  get "Trade executed". A waiver claim with a real FAAB bid via the card → commish "Process
  now" → claimant gets their results push.

## Tue Sep 1 · evening — PRE-FREEZE FAMILY SCRIMMAGE (30 min, everyone)

The last night for finding problems while fixes are still allowed (freeze starts Sep 3).
Run the whole loop once with everyone on their own phone: lineup swaps via the card,
a claim, a trade, chat with an @mention (mentioned owner gets the push), every phone
confirmed installed + alerted + PIN'd.

## Sep 3–5 — FREEZE. Nothing ships. (Claude delivers the draft-day + week-1 runbooks.)

## Sun Sep 6 · 2:30 PM — DRAFT DAY (draft at 3:00)

- 2:30: Draft Room open on the big screen, owners on phones. Countdown hits zero at 3:00
  and the League card flips to "Draft is LIVE — join".
- After: every My Team shows its drafted roster; keepers correct.

## Tue Sep 8 — season opens (league week 1). Everyone sets lineups.

## Wed Sep 9 · 8:00–8:10 AM — THE CRON'S FIRST REAL FIRE

Queue at least one test waiver claim Tuesday night. Wednesday ~8:00–8:05 AM every phone
gets "GFFL waivers"; the first person to open the app triggers processing; owners with
claims get their personal results push. This is S5's one real-world proof.

## Thu Sep 10 · 7:20 PM — WEEK 1 OPENER

Live scoring on real starters, win% through the evening, lineup locks at kickoff (a locked
player's Swap greys with "Game started").

## Sun Sep 13 · night — **(Claude)** P6 shadow verification

Hand-check of computed points vs the ESPN box score — the last word on the scoring engine.
Your only job: play, and report anything that felt wrong within a day while it's fresh.
