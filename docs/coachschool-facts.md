# Coach School — football fact sheet

The single source of football truth for Coach School. Lesson cards, puzzles, callouts and the
`cs-lib.js` tables may only state facts that appear here. Written 2026-11-11 for the dad to review.

**Rules review by Fable 5.2, 2026-11-11, against the 2026 NFL Rulebook (operations.nfl.com);
findings 1-11 applied.** Citations in the form "RB 4-7-1" are Rule-Section-Article of that book.

## How to read this sheet

- **NFL rules only.** College and high-school rules differ in places (clock on first downs,
  hash width, two-point spot, ineligible-downfield distance). Where it matters, the sheet says so.
- **`[CHECK]`** marks a fact the author was not certain of. Nothing marked `[CHECK]` goes into
  lesson content until the dad clears it (delete the tag when cleared).
- **"Varies by team"** marks terminology that real teams number or name differently. Coach School
  picks one convention, labelled **CS convention**, and teaches it as *our* convention, never as
  the only one. Lesson copy should say "on many teams" or "in Coach School" for these.
- **Coordinates** (same as the plan): yards. `x` = across the field, 0 (offense's left sideline)
  to 53.33 (offense's right sideline), ball at 26.67 unless stated. `y` = relative to the line of
  scrimmage (LOS): offense negative (backfield), defense positive. Offense's right = larger `x`.
- **Alignment numbers are teaching defaults**, not measurements of a real team. Real alignments
  move with the hash, the split rules, the call and the player. Puzzles that grade placement must
  use landmark tolerances, not exact yards.
- Entries run in curriculum order (ranks 1-7), then the machine tables (sections 1-11), then the
  glossary. When two entries disagree, the lower one wins (house rule).

---

# Part A — the curriculum, rank by rank

Every concept: **What it is** (plain definition), **Spot it** (how to recognise it on the field),
**Why it matters**.

## Rank 1 — Intern: the field and the 22

### The field

| fact | value (NFL) |
|---|---|
| Length between goal lines | 100 yd |
| End zones | 10 yd deep each; total 120 yd end line to end line |
| Width | 53 1/3 yd (160 ft) |
| Hash marks | 70 ft 9 in from each sideline = x 23.58 and x 29.75; 18 ft 6 in apart (6.17 yd) |
| Goalposts | on the end line; uprights 18 ft 6 in apart, crossbar 10 ft high |
| Yard lines | every 5 yd; numbers every 10 yd |
| Yard-line numbers | NFL rulebook: the bottom of the numbers is 12 yd from the sideline (numerals about 6 ft tall, so roughly 12-14 yd in). **Coach School uses the NFL measurement:** the numbers are drawn 12-14 yd in from each sideline, and "on the numbers" as an alignment landmark is x 13 (left) and x 40.33 (right). (The flat/curl zone boundary at x 9 / 44.33 in section 4 is a separate zone convention, not "the numbers".) |
| Goal line | part of the end zone: the ball touching the plane of the goal line in possession is a touchdown |
| Red zone | from the opponent's 20-yard line to the goal line (a broadcasting/coaching term, not a rule) |

- **Field vs boundary.** What it is: when the ball sits on a hash, the wide side is the *field*
  and the short side is the *boundary*. Spot it: which side of the ball has more grass. Why it
  matters: defenses often set their call by field/boundary, and throws to the field are longer.
  NFL hashes are narrow, so the difference is smaller than in college.
- **Line of scrimmage (LOS).** What it is: the imaginary line through the ball's nose for each
  team; between the two lines is the *neutral zone*, the length of the ball. Spot it: the ball.
  Why it matters: nobody but the snapper may be in the neutral zone at the snap.

### The 22 on the field

- **Seven on the line.** What it is: the offense must have at least 7 players on the LOS at the
  snap; no more than 4 may be in the backfield. Spot it: count the players with their helmets at
  the ball's depth. Why it matters: it decides who may catch a pass. **CS convention:** every
  Coach School offensive formation has exactly 7 on the line (y = 0) and 4 off it (y ≤ -1).
- **Eligible receivers.** What it is: the two players at the *ends* of the line, plus the
  players legally in the backfield (at least 1 yd behind the LOS). Two conditions, both required:
  the right SPOT (an end of the line or the backfield) and an eligible NUMBER (0-49 or 80-89; NFL
  Rule 8-1-5). A player wearing 50-79 or 90-99 becomes eligible only if he reports to the referee AND lines up at an eligible spot; reporting
  never makes an interior lineman eligible. (Corrected 2026-11-11: the earlier text said interior
  linemen were eligible if they reported. Source: operations.nfl.com glossary "Eligible Receiver";
  footballzebras.com 2015 eligibility-reporting explainer.) Spot it: the outermost man on the line each side, and anyone off the
  line. Why it matters: a covered-up receiver (an end with another player outside him on the line)
  is ineligible. A QB taking the snap directly from under center has extra restrictions on being a
  receiver: in the NFL a QB who lines up under center in a T-formation is ineligible unless he
  legally moves at least 1 yd behind the LOS before the snap. Content may state this one exception
  ("a quarterback taking the snap under center can't catch a pass") so "everyone in the backfield is
  eligible" is never taught bare; don't build puzzles around QB-as-receiver.
- **Ineligible man downfield.** On any forward pass, an ineligible lineman may not be more than
  1 yard beyond the LOS before the ball is thrown, unless he is still blocking a man he first hit
  within that yard (NFL; college allows 3 yd and exempts passes caught behind the line). This is
  the rule RPOs live near. (RB 8-3-1 Items 1-2, 8-3-2.)
- **Offensive line (OL).** LT, LG, C, RG, RT. The center snaps. Tackles are the bookends; on a
  right-handed QB the LT protects his blind side (his back is to the left as he throws), which is
  why LT is traditionally the premium pass protector. Spot it: the five big men in the middle.
  Why it matters: nearly every play is a rule for these five.
- **QB.** Takes the snap: under center (hands under the center, y ≈ -1), shotgun (y ≈ -5) or
  pistol (y ≈ -4).
- **RB / HB / TB.** Running back = halfback = tailback (in an I-formation the deep back is the
  tailback). **FB** (fullback): a blocking back in front of the tailback. Both count as "backs"
  in personnel.
- **TE (Y).** Tight end: lines up next to the tackle ("inline", "attached") or split out
  ("flexed", "detached"). Blocks and catches. **CS convention:** the TE is lettered **Y**.
- **Wide receivers.** **X** = split end, usually *on* the line, usually away from the TE.
  **Z** = flanker, usually *off* the line (a yard back), usually to the TE side. **Slot** = a
  receiver aligned between the outside receiver and the line; CS letters the slot **H** (some
  teams use F, A, or "slot"). Letters vary by team — **CS convention: X, Z, Y, H, RB, FB**.
  Spot X vs Z: X stands level with the linemen; Z stands about a yard behind that line. Why it
  matters: a player on the line can be pressed (jammed) right at the snap and cannot go in motion;
  a player a yard off gets a cleaner release and can go in motion.
- **Defensive line (DL).** DE (ends, outside), DT (tackles, inside). A DT lined up head-up on the
  center is the **nose tackle (NT)**. **Edge** is the general term for the player who rushes from
  outside the tackle, DE or OLB.
- **Linebackers (LB).** Sam, Mike, Will. **CS convention:** Sam = strong-side LB (to the TE),
  Mike = middle LB, Will = weak-side LB. Varies by team: some name LBs by field/boundary, some
  call them Jack, Buck, Rover, Mo, etc.
- **Defensive backs (DB).** CB (cornerbacks, cover the wide receivers), FS (free safety, usually
  the deep-middle/weak safety), SS (strong safety, usually to the TE side, more run support).
  Nickel back (NB) = fifth DB, usually covers a slot. Dime = sixth DB.

### Formation strength

- What it is: the side the offense has "more" on. **CS convention:** strength = the TE side; if
  there is no TE (or one each side), the side with more receivers; if still balanced, the field
  side. Varies by team (some defenses always set to the field, or to the passing strength).
- Spot it: count the eligible players each side of the ball.
- Why it matters: the defense names its strong-side players (Sam, SS) by this call, and fronts
  like Over and Under are defined by it.

## Rank 2 — Quality Control Coach: groupings and formations

- **Personnel.** What it is: a two-digit code for who is on the field: first digit = backs (RB +
  FB), second digit = tight ends, wide receivers = 5 minus the two. Spot it: count heads coming on
  the field, not where they line up (a TE split wide is still a TE). Why it matters: the defense
  substitutes to match (section 2).
- **Formation.** Where the 11 line up. Same personnel can line up in many formations.
- **I-formation.** QB under center, FB and TB stacked in a line behind him. Downhill run game.
- **Singleback.** One back about 6-7 yd behind the QB under center. **Ace** = singleback with two TEs.
- **Shotgun.** QB about 5 yd behind the center, RB beside him. Pass-first, QB sees the field earlier.
- **Pistol.** QB about 4 yd back, RB directly behind him. Lets a team run downhill and still see from depth.
- **2x2.** Two receivers each side. **3x1 (trips)** — three to one side, one to the other.
- **Bunch.** Three receivers packed in a tight triangle; hard to press, creates natural rubs.
- **Empty.** No back in the backfield beside the QB: five receivers out. Five-man protection.
- **Counting receivers.** Receivers are numbered from the *outside in* on each side: #1 is the
  widest, #2 next, #3 next. Defenses and concepts use these numbers, not names.
- **Shift vs motion.** A *shift* is two or more players changing position before the snap;
  afterwards all 11 must be set for at least one full second. *Motion* is one player moving at the
  snap; he must be a backfield (off-the-line) player and may not be moving toward the opponent's
  goal line at the snap. Only one player may be in motion. Why it matters: motion changes
  strength, creates leverage, and can reveal man vs zone (rank 5).
- **Base defenses.** 4-3 (four DL, three LB), 3-4 (three DL, four LB), nickel (five DBs, usually
  4-2-5), dime (six DBs). See sections 1 and 2.
- **Gaps and holes.** See section 8. Spot it: the spaces between offensive linemen.
- **Reading a huddle call.** A play call is an ordered list: formation, (shift/motion), play,
  (snap count). Example in CS convention: *"Gun Trips Right, Z Jet, 26 Power, on two"* = shotgun,
  trips to the right, Z in jet motion, the tailback (2) runs power through the 6 hole, ball snapped
  on the second "hut". The back-and-hole digit system varies by team (section 8).

## Rank 3 — Position Coach (Offense)

- **Route tree.** A numbered menu of routes for a receiver; the number lets a play call give
  three receivers their routes in one word ("Spread 948"). **Numbering varies by system** — the
  CS numbering is in section 3. Spot it: the stem (straight run) and the break (the cut).
- **Stem / break / depth.** Stem = the release and straight run; break = the cut; depth = yards
  downfield at the break. Why it matters: the QB throws to where the break *will* be.
- **QB drops and timing.** Under center: 3-step ≈ 5 yd (quick game), 5-step ≈ 7 yd
  (intermediate), 7-step ≈ 9 yd (deep). From shotgun the QB is already deep, so drops are shorter
  (a 3-step from the gun times like a 5-step under center). These depths are **CS teaching
  conventions** (approximate; teams vary). Why it matters: the drop length matches the route depth so the ball comes out
  on the receiver's break.
- **Pass protection.** *Man (BOB, "big on big, backs on backers")*: OL block the down linemen,
  the back blocks a linebacker. *Slide*: the line slides one direction, each lineman taking a gap
  rather than a man; the back takes the first threat away from the slide. *Hot*: when more
  defenders rush than the protection can block, one rusher is unblocked; the QB must get rid of it
  before he arrives (section 9). Spot it: the line's first step at the snap.
- **Run schemes.** Zone vs gap. *Zone*: linemen step together and block whoever shows up in their
  zone; the back reads and cuts. *Gap / man-gap (power, counter, trap)*: linemen block angles on
  defenders, someone pulls, the hole is pre-set. Details in section 7.
- **Play-action.** The QB fakes a handoff before throwing. Spot it: the linebackers step up, then
  the ball is thrown behind them. Why it matters: it punishes defenders who play the run hard.
  **Bootleg**: the QB fakes one way and rolls out the other, usually with a run-action blocking look.
- **Screens.** The defense is let through on purpose and the ball is thrown short behind them to
  a receiver with blockers in front. *RB screen*: OL pass-block briefly, then release downfield; RB
  catches behind them. *Bubble*: slot drifts backward-outside and catches a quick throw. *Tunnel*:
  outside WR comes inside behind blockers. Why it matters: punishes heavy rush and blitz.

## Rank 4 — Position Coach (Defense)

- **Techniques.** A number for where a defensive lineman lines up relative to an offensive
  lineman (section 8). Spot it: which shoulder of which blocker he's on.
- **Over vs Under (4-3).** *Over*: the 3-technique DT goes to the strength, the 1-technique nose
  to the weak side. *Under*: the nose shades the center to the strength, the 3-technique goes to
  the weak side, and the Sam walks up on the line outside the TE. Spot it: which side the
  3-technique is on. Why it matters: it shifts where the defense is strong against the run.
- **One-gap vs two-gap.** *One-gap*: the lineman attacks and owns one gap. *Two-gap*: he lines up
  head-up, controls the blocker, and is responsible for the gap on either side, then sheds. Two-gap
  is associated with traditional 3-4 defenses. Spot it: head-up alignments and a hand-fight
  instead of a charge.
- **Man vs zone.** *Man*: each cover player has a receiver. *Zone*: each has an area and covers
  whoever enters it. Spot it: in man, defenders turn and run with receivers across the field; in
  zone, defenders drop to spots and watch the QB.
- **Coverages.** Cover 0, 1, 2, Tampa 2, 3, 4, 6, 2-man: section 5.
- **Run fits.** Every gap must have a defender (*gap integrity*). *Force*: the defender who turns
  an outside run back inside (CS: usually the CB or SS to that side; varies by call). *Contain*:
  the edge player who keeps the QB/runner from getting outside. *Spill*: a defender takes on a
  blocker to push the ball outside toward the unblocked force/alley player. *Squeeze/box*: keep
  outside leverage and push the ball back inside. Teams choose spill or box by scheme.
- **Stunts and twists.** Linemen exchange gaps after the snap to confuse blocking. *T-E twist*:
  the tackle crashes outside first, the end loops inside behind him. *E-T twist*: the reverse.
  Why it matters: a pass blocker who passes off his man badly leaves a free rusher.

## Rank 5 — Offensive Coordinator

- **MOFO / MOFC.** *Middle of the field open* = two deep safeties (shell for Cover 2, 4, 6,
  2-man). *Middle of the field closed* = one deep safety in the middle (Cover 1, 3). Cover 0 has
  no deep safety. Spot it: count safeties at about 10+ yd before the snap. Why it matters: it
  halves the list of possible coverages. Caution: defenses disguise and rotate (rank 6).
- **Corner depth and leverage.** Press (≈ 1 yd), off (≈ 5-8 yd). Inside leverage (corner shaded
  inside the receiver) invites outside routes; outside leverage invites inside routes. Deep
  off-coverage corners often mean Cover 3/4; a corner at 5 yd squatting outside can mean Cover 2.
  These are tendencies, not rules.
- **Motion as a tell.** If a defender runs across the formation with the motion man, it suggests
  man coverage; if defenders shift or "bump" zones without following him, it suggests zone. Not
  foolproof.
- **Box count.** The *box* is roughly the area from tight end to tight end within about 5-7 yd
  of the LOS. Compare defenders in the box to blockers: more defenders than blockers favours a
  pass; fewer favours a run.
- **ID the Mike.** Before the snap the QB or center points at a linebacker and calls him "the
  Mike". This is a *protection* label: it tells the line how to count and who the back blocks.
  The protection Mike need not be the defense's actual middle linebacker.
- **Pass concepts.** A *concept* is a set of routes that together put one defender in conflict:
  whatever he does, something opens. Full list, routes and beats in section 6.
- **Conflict defender.** The single defender a concept attacks — e.g., the Cover 2 cornerback
  against smash.
- **RPO (run-pass option).** Linemen block a run; the QB reads one defender after the snap and
  either hands off or throws a quick pass into the space that defender left. Linemen must stay
  within 1 yd of the LOS until the ball is thrown.
- **Read option.** The QB leaves one defender (usually the backside DE) unblocked and reads him:
  if he crashes on the back, the QB keeps; if he stays wide, the QB gives.
- **Audible vs hot route vs sight adjust vs kill.** *Audible*: the QB changes the play at the
  line with a verbal call. *Hot route*: a receiver's route changes to a quick throw because of a
  blitz (pre-set rule or a call). *Sight adjust*: QB and receiver both read the same pre-snap look
  and both change the route without a call. *Kill* (also "check-with-me"): two plays are called in
  the huddle and the QB says "kill" at the line to switch to the second.

## Rank 6 — Defensive Coordinator

- **Disguise.** Showing one shell before the snap and playing another. *Rotation*: e.g., two-high
  pre-snap, one safety drops to the middle and the other rotates down at the snap (becomes
  Cover 1 or 3). Rotation names (sky, buzz, cloud, spin) vary by team.
- **Cover 0 blitz, fire zone, sim pressure.** Section 9.
- **Matching personnel.** The defense substitutes to match: 11 → nickel; 12 and 21 → base;
  10 → nickel or dime; 13 and 22 → base or heavy (goal line). Tendencies, not rules.
- **Taking away a concept.** Play a coverage the concept is *not* built to beat (section 6), or
  put an extra defender on the conflict defender's problem (a bracket, a robber, a lurk).
- **Red-zone defense.** The field is short: the end line acts as an extra defender, deep zones
  shrink, and defenses play more man, more Cover 0/1 and more bracketing. Offenses lean on fades,
  slants, rub routes and power runs.

## Rank 7 — Head Coach

- **Down and distance.** "3rd and 7" = third down, 7 yd to the *line to gain* ("the sticks").
  Short yardage favours runs and quick throws; long yardage forces passes and invites pressure.
- **Third-down calls.** Routes should break at or past the sticks; defenses on 3rd and long sit
  deeper than the sticks and rally.
- **Goal line.** Heavy personnel (13, 22), power runs, play-action, QB sneaks, fades and rubs.
- **Two-minute drill.** Hurry-up offense to score before the half/game ends: throw outside and
  get out of bounds, spike to stop the clock, save timeouts for throws in the middle of the field.
  Clock rules: section 10.
- **Four-minute offense.** Protecting a late lead: run the ball, stay in bounds, use the play
  clock fully, and above all get first downs so the opponent's timeouts run out.
- **4th-down decisions.** Section 10.
- **Two-point decisions.** Section 10.
- **Challenges.** Section 10.
- **Game plan.** *Tendencies*: what the opponent does by down, distance, personnel, formation and
  field zone. *Matchups*: your best player on their weakest. *Opening script*: a pre-planned list
  of the first plays of the game, popularised by Bill Walsh, used to test the defense and see its
  answers. *Halftime adjustments*: change calls based on what the defense showed.

---

# Part B — machine tables

## 1. Positions and alignments

### 1a. Offensive line and backfield constants (CS convention)

| player | x | y | note |
|---|---|---|---|
| C | 26.67 | 0 | ball |
| LG / RG | 25.17 / 28.17 | 0 | 1.5 yd center-to-center splits |
| LT / RT | 23.67 / 29.67 | 0 | |
| inline TE left / right | 22.17 / 31.17 | 0 | 1.5 yd outside the tackle |
| QB under center | 26.67 | -1 | |
| QB pistol | 26.67 | -4 | |
| QB shotgun | 26.67 | -5 | |
| wide receiver left / right | 6 / 47.33 | 0 or -1 | "outside the numbers" default |
| slot left / right | 15 / 38.33 | -1 | about halfway between tackle and wide receiver |
| trips #3 / #2 (right) | 34.67 / 39.67 | -1 | |

### 1b. Offensive formations (strength right; mirror x → 53.33 - x for left)

On-line players have y = 0; every formation has exactly 7 on the line and 4 off.

| formation | pers | on the line (7) | off the line (4) |
|---|---|---|---|
| I-form | 21 | LT LG C RG RT, X (6,0), Y (31.17,0) | Z (47.33,-1), QB (26.67,-1), FB (26.67,-4.5), TB (26.67,-7) |
| Singleback | 11 | LT LG C RG RT, X (6,0), Y (31.17,0) | H (15,-1), Z (47.33,-1), QB (26.67,-1), RB (26.67,-6.5) |
| Ace (singleback 2-TE) | 12 | LT LG C RG RT, U (22.17,0), Y (31.17,0) | X (6,-1), Z (47.33,-1), QB (26.67,-1), RB (26.67,-6.5) |
| Shotgun 2x2 | 11 | LT LG C RG RT, X (6,0), Z (47.33,0) | H (15,-1), Y flexed (38.33,-1), QB (26.67,-5), RB (28.67,-5) |
| Trips 3x1 rt (gun) | 11 | LT LG C RG RT, X (6,0), Z (47.33,0) | Y #3 (34.67,-1), H #2 (39.67,-1), QB (26.67,-5), RB (24.67,-5) |
| Bunch rt (gun) | 11 | LT LG C RG RT, X (6,0), Z point (39.67,0) | H (38.67,-1), Y (40.67,-1), QB (26.67,-5), RB (24.67,-5) |
| Empty 3x2 (gun) | 11 | LT LG C RG RT, X (6,0), Z (47.33,0) | H (15,-1), Y (34.67,-1), RB as slot (39.67,-1), QB (26.67,-5) |
| Pistol | 11 | LT LG C RG RT, X (6,0), Y (31.17,0) | H (15,-1), Z (47.33,-1), QB (26.67,-4), RB (26.67,-7) |

Notes:
- In the Ace the two TEs are the ends of the line, so both wide receivers must be off the line
  (a WR on the line outside a TE would make that TE ineligible). This is a good rank 2 puzzle.
- In 2x2/trips/empty the outside receivers step *on* the line and the slots are off: that is how
  7-on-the-line is kept when there is no inline TE. Z "is usually off the line" is a default, not a law.
- In bunch, which of the three is on the line varies by team; CS puts the front (point) man on.
- In the shotgun the RB may align on either side; CS default is beside the QB, 2 yd to one side.

### 1c. Defensive technique x positions (vs the OL in 1a, strength right)

Shade = 0.5 yd off a blocker's center. DL y = +1, LB y = +4.5, CB y = +7 (off) or +1 (press),
two-high safeties y = +12, single-high FS y = +13.

| tech | strong side (right) x | weak side (left) x |
|---|---|---|
| 0 (head-up C) | 26.67 | 26.67 |
| 1 (shade C) | 27.17 | 26.17 |
| 2i (inside shade G) | 27.67 | 25.67 |
| 2 (head-up G) | 28.17 | 25.17 |
| 3 (outside shade G) | 28.67 | 24.67 |
| 4i (inside shade T) | 29.17 | 24.17 |
| 4 (head-up T) | 29.67 | 23.67 |
| 5 (outside shade T) | 30.17 | 23.17 |
| 7 (inside shade TE) | 30.67 | 22.67 if TE |
| 6 (head-up TE) | 31.17 | 22.17 if TE |
| 9 (outside shade TE) | 31.67 | 21.67 if TE |
| wide 9 / wide 5 (no TE) | 32.67 | 21.67 |

### 1d. Defensive fronts (vs I-form/singleback, TE right)

| front | DL (x, y=1) | LBs (x, y) | DBs (x, y) |
|---|---|---|---|
| 4-3 Over | SDE 5 (30.17), DT 3 (28.67), NT 1 weak (26.17), WDE 5 (23.17) | Sam (32.67,4.5), Mike (27.67,4.5), Will (24.17,4.5) | CB on X (6,7), CB on Z (47.33,7), FS (18,12), SS (35.33,12) |
| 4-3 Under | SDE 5 (30.17), NT 1 strong (27.17), DT 3 weak (24.67), WDE wide 5 (22.67); Sam on line 9-tech (31.67,1) | Mike (28.17,4.5), Will (24.17,4.5) | CB (6,7), CB (47.33,7), FS (18,12), SS (35.33,12) |
| 3-4 | NT 0 (26.67), DE 4 (29.67), DE 4 (23.67) | OLB strong (32.17,1), OLB weak (21.67,1), Mike ILB (28.17,4.5), Will ILB (25.17,4.5) | CB (6,7), CB (47.33,7), FS (18,12), SS (35.33,12) |

3-4 notes: traditional two-gap 3-4 puts the ends head-up (4) and the nose on the center (0).
Many modern 3-4 teams play the ends in 4i or 5 and one-gap. ILB names vary (Mike/Will,
Mike/Jack, Mike/Mo); OLBs are usually the edge rushers. CS teaches the traditional layout.

### 1e. Sub-package defenses (vs shotgun 2x2, strength right)

| package | DL (x, y=1) | LBs | DBs |
|---|---|---|---|
| Nickel 4-2-5 | DE 5 (30.17), DT 3 (28.67), DT 1 (26.17), DE 5 (23.17) | Mike (27.17,4.5), Will apex left (20,4.5) | CB (6,7), CB (47.33,7), NB (37.33,5) inside the right slot, FS (18,12), SS (35.33,12) |
| Dime 4-1-6 | same as nickel | Mike (26.67,5.5) | CB (6,7), CB (47.33,7), NB (37.33,5), Dime (16,5) inside the left slot, FS (18,12), SS (35.33,12) |

Apex = aligned halfway between the end of the line and the slot receiver. Dime fronts vary
(3-2-6 is also common); CS uses 4-1-6.

## 2. Personnel codes

| code | backs (RB+FB) | TEs | WRs | common defensive answer |
|---|---|---|---|---|
| 10 | 1 | 0 | 4 | nickel or dime |
| 11 | 1 | 1 | 3 | nickel |
| 12 | 1 | 2 | 2 | base (4-3 / 3-4) or nickel |
| 13 | 1 | 3 | 1 | base or heavy |
| 21 | 2 | 1 | 2 | base |
| 22 | 2 | 2 | 1 | base or heavy/goal line |

Rule: WRs = 5 - backs - TEs (the other 6 are the 5 OL and the QB). 11 personnel is the most
common grouping in the modern NFL. Check: code digits always sum to ≤ 5.

## 3. Route tree (CS numbering)

**Numbering varies by system.** Many teams use this "odd numbers break outside, even numbers break
inside" tree; others swap 3 and 5, number from a different base, or name routes instead of
numbering them. Coach School uses the tree below and says so in lessons.

Waypoints are `[across, depth]` relative to the receiver's alignment: `across` is `in` (toward
the ball) or `out` (toward the sideline) in yards, `depth` is yards downfield. First point = top
of the stem.

| # | route | waypoints | break depth | break direction | notes |
|---|---|---|---|---|---|
| 0 | Hitch | [0,6], [in 0.5,5] | 6 | stop, turn back to QB | 3-step timing; comes back a yard |
| 1 | Flat | [out 2,2], [out 10,3] | 1-2 | out, flat | usually a back, TE or slot; outside WR rarely |
| 2 | Slant | [0,3], [in 5,8] | 3 | in, 45° | 3-step timing |
| 3 | Comeback | [0,15], [out 3,12] | 15 | out and back toward the sideline | sells a go first |
| 4 | Curl | [0,12], [in 1.5,10.5] | 12 | in and back toward QB | settles in the window |
| 5 | Out | [0,10], [out 8,10] | 10 | out, flat (90°) | "speed out"/"quick out" is the 5-yd version |
| 6 | Dig (In) | [0,12], [in 12,12] | 12 | in, flat (90°) | CS test fixture: 12-yd dig at 7 yd/s |
| 7 | Corner | [0,12], [out 8,20] | 12 | out, 45° toward the pylon | "flag" |
| 8 | Post | [0,12], [in 8,20] | 12 | in, 45° toward the goalposts | |
| 9 | Go (Fly / Fade / Streak) | [0,25] | none | straight | fade = bends slightly toward the sideline |

Other named routes (no tree number in CS):

| route | waypoints | description |
|---|---|---|
| Seam | [0,25] from a slot or TE | vertical by an inside receiver, up the gap between deep zones |
| Drag (Shallow) | [in 2,2], [in 15,4] | crosses the field at 2-5 yd |
| Stick | [0,6], [0,6] sit | 5-6 yd stem, sit facing QB; **CS convention:** a fixed sit (no option). Some teams let the receiver break in or out away from a defender; teams vary |
| Sail | [0,10], [out 10,14] | out-breaking route at about 12-15 yd from a slot or TE, aimed between the flat and deep defender |
| Wheel | [out 4,2], [out 8,5], [out 8,25] | starts as a flat, turns up the sideline |
| Arrow | [out 5,4] | quick angled release to the flat at 3-5 yd |
| Whip | [in 2,4], [out 4,4] | fakes in, breaks back out |
| Bubble | [out 3,-1], [out 6,0] | drifts back and outside for a screen throw |

## 4. Zone landmarks

Teaching values with the ball in the middle. Defenders are coached to landmarks (sideline,
numbers, hash, middle) rather than to exact yards; when the ball is on a hash the landmarks move
with it. `x` ranges given left / right; drop landmark = where the dropper aims to be when the QB
throws. Zone depths in particular vary by team and by call. The depths and landmarks below are **Coach School teaching
conventions**, not NFL rules; many teams use slightly different numbers.

| zone | x range (left / right) | drop landmark (x,y) left / right | depth band |
|---|---|---|---|
| Flat | 0-9 / 44.33-53.33 | (5,6) / (48.33,6) | 0-8 |
| Curl | 9-18 / 35.33-44.33 | (12,11) / (41.33,11) | 8-14 |
| Hook | 18-26.67 / 26.67-35.33 | (21,10) / (32.33,10) | 8-12 |
| Middle hook (Cover 2 Mike) | 22-31.33 | (26.67,11) | 8-14 |
| Middle hole (Tampa 2 Mike) | 22-31.33 | (26.67,18) | 12-22, carries a vertical inside receiver |
| Deep third (L / M / R) | 0-17.78 / 17.78-35.56 / 35.56-53.33 | (9,16) / (26.67,16) / (44.33,16) | 12+ ("deepest of the deep") |
| Deep half (L / R) | 0-26.67 / 26.67-53.33 | (18,16) / (35.33,16) | 12+ |
| Deep quarter (Q1-Q4, left to right) | 0-13.33 / 13.33-26.67 / 26.67-40 / 40-53.33 | (7,14) / (20,14) / (33.33,14) / (46.33,14) | 10+ |

Combined names: *curl-flat* (also "seam-curl-flat") = one defender responsible for the curl then
the flat; *hook-curl* = hook then curl.

## 5. Coverages

Defender roles vs shotgun 2x2 (left: #1 X, #2 H; right: #1 Z, #2 Y; one RB), nickel personnel,
four DL rushing unless stated. CB-L/CB-R = corners, FS = left safety, SS = right safety,
NB = nickel (right), Mike, Will. "Deep" counts defenders responsible for deep zones at the snap.

### 5a. Assignment table

| coverage | CB-L | CB-R | FS | SS | NB | Mike | Will | rush | deep |
|---|---|---|---|---|---|---|---|---|---|
| Cover 0 | man X | man Z | man H | rush | man Y | man RB (rushes if RB blocks) | rush | 6 (7) | 0 |
| Cover 1 | man X | man Z | deep middle | man H (rotates down) | man Y | man RB | rat/robber (low middle) or 5th rusher | 4-5 | 1 |
| Cover 2 | flat L (jam #1) | flat R (jam #1) | deep half L | deep half R | hook-curl R | middle hook | hook-curl L | 4 | 2 |
| Tampa 2 | flat L | flat R | deep half L | deep half R | hook-curl R | deep middle hole | hook-curl L | 4 | 2 + Mike |
| Cover 3 | deep third L | deep third R | deep middle third | hook R (buzz down) | curl-flat R | hook L | curl-flat L | 4 | 3 |
| Cover 4 (quarters) | deep quarter Q1 | deep quarter Q4 | quarter Q2, reads #2 (H) | quarter Q3, reads #2 (Y) | curl-flat R | hook / middle | curl-flat L | 4 | 4 |
| Cover 6 | flat L (cloud, Cover 2 side) | deep quarter Q4 | deep half L | quarter Q3, reads #2 | curl-flat R | middle hook | hook-curl L | 4 | 3 |
| 2-man | man X (trail) | man Z (trail) | deep half L | deep half R | man Y | man RB | man H | 4 | 2 |

Assignment conventions vary by team (which safety rotates, who has the back, Cover 6 sides).
In CS, Cover 6 = quarters to the strength/field, Cover 2 to the weak side/boundary.

### 5b. Strengths and holes

| coverage | what it is | spot it pre-snap | strengths | holes / weaknesses |
|---|---|---|---|---|
| Cover 0 | all-out man, no deep help, max rush | no deep safety, defenders tight on every receiver | pressure arrives fast; every receiver covered | one missed tackle or one lost route is a long TD; hot routes, quick throws, screens |
| Cover 1 | man with one deep free safety | one high safety, corners pressed or tight | tight coverage plus help over the top; extra box/robber defender | crossing routes and rubs (mesh), receivers who win one-on-one, QB scrambles (defenders' backs to the QB) |
| Cover 2 | 2 deep halves, 5 underneath zones | two high safeties, corners shallow (≈5 yd) and outside | short outside throws and flats; corners reroute #1 | the hole between corner and half safety along the sideline at about 15-20 yd (corner route); the deep middle between safeties (seams, post); the intermediate middle |
| Tampa 2 | Cover 2 with the Mike running deep down the middle | as Cover 2 (hard to tell pre-snap) | closes Cover 2's deep-middle seam | the sideline hole behind the corner is still there; hook-curl defenders stretched; intermediate windows between Mike and the outside LBs |
| Cover 3 | 3 deep thirds, 4 underneath | one high safety, corners off and deep (≈7 yd) | deep balls; strong vs the run (an 8th defender near the box) | 4 verticals vs 3 deep; the seams; curl-flat defender stretched by curl/flat and stick; flats; hitches in front of bailing corners |
| Cover 4 (quarters) | 4 deep quarters, 3 underneath; safeties read #2 | two high safeties, corners off; safeties shallower (≈10 yd) and quick to fill vs the run | takes away four verticals; safeties add run support | underneath and flats (only 3 under); a safety who bites on #2's short route leaves #1's post/dig open; post-dig |
| Cover 6 | quarters to one side, Cover 2 to the other | two high; one corner squatting (cloud side), one off | can match a trips/field side with quarters and keep a jammer on the other | the Cover 2 side's holes (corner route behind the cloud corner) and the quarters side's flats |
| 2-man | 2 deep halves, 5 man underneath with trail technique | two high, corners tight and inside | very tight underneath coverage with help over the top: a favourite on 3rd and medium | only 4 rush; QB scrambles; rubs and crossers; option routes that break away from trail leverage |

## 6. Concepts and BEATS

Receivers counted #1/#2/#3 from the outside. "Beats" = the coverages the concept is *designed* to
attack in standard teaching. "Contested" = commonly claimed but depends on the variant and the
read: CS puzzles must not use a contested pairing as the single right answer.

| concept | routes | beats | conflict defender | contested / notes |
|---|---|---|---|---|
| Smash | #1 hitch (5-6), #2 corner (break 10-12) | Cover 2; Cover 6 (thrown to the Cover 2 side) | the flat corner: squat on the hitch or sink under the corner | vs Cover 4 contested |
| Four verticals | four receivers on go/seam routes | Cover 3 (four vs three deep); Cover 2 (the inside seams split the safeties) | Cover 3: the deep-middle FS between two seams; Cover 2: each half safety between seam and outside go | vs Cover 1 contested (depends on matchups); poor vs Cover 4 |
| Flood / Sail | three levels to one side: #1 go (clear), #2 sail/out at 12-15, #3 or RB flat | Cover 3 | the curl-flat defender (sail or flat) and the deep-third corner (go or sail) | vs Cover 2 contested (sail into the corner-safety hole) |
| Mesh | two shallow crossers passing close at about 5-6 yd, plus a sit/dig and outside clears | man coverage: Cover 1, Cover 0, 2-man | man defenders trailing crossers get rubbed by traffic | vs zone it still works by settling crossers in voids, but that is a different read |
| Stick | #1 go/fade (clear), #2 flat or arrow, #3 stick (6 yd sit) | Cover 3 | the curl-flat defender: flat or stick | vs Cover 4 contested |
| Slant-flat | #1 slant, #2 flat or arrow | Cover 3 | the curl-flat defender: widen to the flat (slant opens) or sink inside (flat opens) | vs man: slant can win on leverage, but that is a one-on-one, not a conflict |
| Curl-flat | #1 curl at 12, #2 flat | Cover 3; Cover 2 | Cover 3: curl-flat defender; Cover 2: the hook-curl defender (curl) with the corner on the flat | vs Cover 4 contested (thin underneath) |
| Levels | two in-breaking routes on one side at different depths (e.g., 5-yd in and 12-yd dig) | Cover 3 | the hook defender: high-low read | vs Cover 4 contested |
| Dagger | #2 seam (clear), #1 dig at 15-18 | Cover 3; Cover 4 | Cover 3: hook defender and FS pulled by the seam; Cover 4: the quarters safety carries #2 vertical, opening the dig | vs Cover 2 contested |
| Post-dig ("Mills") | #1 post, #2 dig (or reversed) | Cover 4 | the quarters safety: drive on the dig (post opens) or stay deep (dig opens) | vs Cover 2/split safeties contested |

Basic beater routes (single route vs coverage):

| route | beats | why |
|---|---|---|
| Hitch | Cover 3 (off corners) | deep-third corners bail; the hitch sits in front of them |
| Seam | Cover 2 | the deep middle between two half safeties is open (Tampa 2 sends the Mike to close it) |
| Corner | Cover 2; Cover 6 (Cover 2 side) | the sideline hole behind the squatting corner and outside the half safety |
| Post | Cover 2 | splits the two half safeties |
| Slant | Cover 0 | quick throw before unblocked pressure arrives, no deep help needed |

## 7. Run schemes

Playside = the side the run is aimed at. Backside = away. EMOL = end man on the line (the last
defender on the line of scrimmage on that side).

| scheme | OL rules | pullers | ball carrier aim / read |
|---|---|---|---|
| Inside zone | all linemen step playside together; *covered* (defender in your playside gap or on you) = block him; *uncovered* = combine with the adjacent playside lineman on his DL, then climb to the LB; backside tackle cuts off his gap | none | aim at the playside guard (A/B gap); read the first DL from the playside A gap outward: hit the front side, or cut back if the defense flows |
| Outside zone (stretch / wide zone) | reach-step playside; try to get the head across the defender's playside shoulder; uncovered men combine and climb; the defense is stretched sideways | none | aim at the outside hip of the TE (or tackle); read the playside EMOL's block: if he's sealed inside, bounce outside; if not, cut up or back |
| Power | playside linemen *down-block* (block the defender to their inside); center blocks back; backside tackle *hinges* (protects his inside gap); FB or H kicks out the EMOL | backside guard pulls through the hole and leads up on the playside LB | off-tackle, playside B or C gap; follow the puller, inside the kick-out |
| Counter (counter trey / GT) | playside down blocks as in power; RB takes a step away first (counter step) | backside guard pulls and kicks out the EMOL; backside tackle (or an H-back) pulls and leads through the hole to the LB | jab away, then follow the pullers through the playside B/C gap |
| Trap | one interior DL is left unblocked on purpose; the linemen next to him release to the linebackers | a guard (often the backside guard) pulls and blocks the unblocked DL from the side | quick inside hit (A/B gap) right behind the trap block |
| Draw | linemen show pass set and let the rushers come upfield, then steer them past the hole | none (usually) | QB drops as if to pass, hands off late; RB reads the open lane between rushers who overran it |

Notes: *zone* schemes have the RB pick the hole; *gap* schemes (power, counter, trap) pre-set the
hole. Zone and gap rules vary in detail by team; these are the standard teaching versions.

## 8. Gaps, holes and techniques

### Gaps (both sides of the ball)

| gap | between |
|---|---|
| A | center and guard |
| B | guard and tackle |
| C | tackle and TE (or outside the tackle when there is no TE) |
| D | outside the TE |

### Hole numbering

**Varies by team.** Common systems number holes even to the right and odd to the left, but some
number over players (0 = center, 2 = right guard, ...) or reverse the sides.

**CS convention:** holes are numbered from the center out, *even to the right, odd to the left*:

| hole | 7 | 5 | 3 | 1 | 2 | 4 | 6 | 8 |
|---|---|---|---|---|---|---|---|---|
| gap | left D | left C | left B | left A | right A | right B | right C | right D |

**CS convention** for back digits in a run call: 1 = QB, 2 = tailback (RB), 3 = fullback. So "26
Power" = tailback, power, right C gap. Varies widely by team.

### Defensive line techniques

**Varies by team**, especially 6/7/8/9. Odd = shade, even = head-up is the common modern
system (descended from Bear Bryant's numbering, with "i" techniques added later).

| tech | alignment |
|---|---|
| 0 | head-up on the center |
| 1 | shade on the center (in the A gap) |
| 2i | inside shade of the guard |
| 2 | head-up on the guard |
| 3 | outside shade of the guard (in the B gap) |
| 4i | inside shade of the tackle |
| 4 | head-up on the tackle |
| 5 | outside shade of the tackle |
| 7 | inside shade of the TE (CS convention; common on many teams) |
| 6 | head-up on the TE (CS convention; common on many teams) |
| 9 | outside shade of the TE |

Coordinates: section 1c. "Wide 9" = well outside the TE (or where a TE would be); "wide 5" =
outside the tackle with extra width when there is no TE. 8 is used inconsistently and CS does not
teach it. Technique numbers are coaching convention, not a rule: some systems swap 6 and 7, so
teach these as "in Coach School".

## 9. Pressure

| package | rushers | coverage behind | deep | who is hot / responsible |
|---|---|---|---|---|
| Cover 0 blitz | 6 or more | man on every eligible receiver | 0 | protection cannot block everyone; QB must throw hot or a sight-adjusted quick route; one beaten defender = no help |
| Fire zone | 5 (often a LB and/or DB, sometimes a DL drops) | 3 underneath zones (typically two curl-flat and one hook/middle) | 3 (two corners + one safety) | the offense sees 5 rushers and 6 coverage players; the hot throw goes where the blitzer came from, but a dropping DL may be sitting in that lane |
| Sim pressure (simulated pressure) | 4, but not the usual four: a LB or DB rushes while a DL drops | 7 in coverage (zone) | varies (often 2 or 3) | looks like a blitz, so the offense may set protection or throw hot to the wrong place, but there are still 7 in coverage |

- **Hot route.** What it is: a quick route a receiver converts to when the defense rushes more than
  the protection blocks. Spot it: a blitzer unblocked by design. Why it matters: the ball must come
  out before he arrives, usually into the area he left.
- **Who is responsible.** The QB (and center) identify the defense and set the protection; the
  protection decides who is unblocked; the QB and the receivers must both recognise when a route
  becomes hot. Hot rules vary by team; CS teaches: the unblocked rusher's side is the hot side, and
  the inside receiver on that side runs a quick slant/hitch/seam into the vacated area.
- **Blitz pickup by count:** 5 OL + RB = 6 blockers, so up to 6 rushers can be blocked. A 7th
  rusher, or a 6th rusher when the back runs a route instead of blocking, means someone is
  unblocked and the throw must be hot. Empty (5 blockers): any 6th rusher is unblocked.

## 10. Clock and situational rules (NFL)

### Clock

| event | NFL clock |
|---|---|
| Incomplete pass | stops; restarts on the snap |
| Runner out of bounds | outside the last 2:00 of the 1st half and the last 5:00 of the 2nd half: stops briefly, restarts on the referee's ready-for-play signal. Inside those windows: stops until the snap |
| Runner tackled in bounds | keeps running |
| First down | does **not** stop the clock in the NFL (college stops it briefly) |
| Score | stops |
| Timeout | stops; 3 per team per half; unused first-half timeouts do not carry over |
| Two-minute warning | automatic stoppage at 2:00 of the 2nd and 4th quarters (after the play in progress) |
| Penalty | stops; when it restarts depends on the foul and the time (detail not taught) |
| Change of possession (interception, fumble recovery) | stops; it restarts on the snap, not on the referee's ready signal (NFL Rule 4-3-2 treats a change of possession as an exception to the ready-for-play restart) |
| Injury | stops (official's timeout); late-half consequences (timeout or runoff) are not taught |

- **Play clock.** 40 seconds from the end of the previous play; 25 seconds after certain
  administrative stoppages. NFL Rule 4-6 lists these, including a charged timeout, the two-minute
  warning, the end of a period, a change of possession, penalty enforcement and replay review; the
  full list is not taught.
- **Spike.** The QB throws the ball straight into the ground immediately after the snap to stop
  the clock. It is legal (an exception to intentional grounding), counts as an incomplete pass and
  **uses a down**, so it is a bad idea on 4th down. Coach School teaches the spike from under
  center only: the NFL exception is written for a quarterback under center who throws the ball
  straight down immediately on taking the snap (Rule 8-2-1 Item 3). A delayed spike is
  intentional grounding. (RB 8-2-1 Items 3-4, 3-42.)
- **10-second runoff.** After the two-minute warning of either half, if the clock is running and
  the offense commits a foul that stops it (e.g., false start, intentional grounding, illegal
  substitution), 10 seconds are run off. The defense may decline the runoff and take only the
  yards; the offense may use a timeout to avoid it. A replay reversal after the two-minute warning
  also brings a runoff when the corrected ruling would have kept the clock running; neither team
  can decline that one, but either may use a timeout to prevent it. If fewer than 10 seconds
  remain, the runoff ends the half. (RB 4-7-1, 4-7-2, 4-7-4, 15-5.)
- **Sideline throws.** In the two-minute drill, throws to the sideline let the receiver get out
  of bounds and stop the clock (inside the windows above); throws in the middle of the field keep
  the clock running unless a timeout is used.

### Scoring and tries

| item | NFL |
|---|---|
| Touchdown | 6 |
| Field goal | 3 |
| Safety | 2, and the team that was scored on puts the ball in play by a safety kick (punt, drop kick or place kick; a tee is allowed) from its own 20. It uses the same dynamic-kickoff line-up and landing zone as a kickoff. (RB 6-1-1-b, 6-1-2-a, 6-1-3, 11-5-2) |
| Try (after a TD): kick | 1 point; snapped from the 15-yard line (since 2015) |
| Try: two-point | 2 points; snapped from the 2-yard line |
| Defense returns a try to the other end zone | 2 points |

### Kickoffs and touchbacks

| item | NFL |
|---|---|
| Kickoff spot | kicking team's 35 |
| Format | the "dynamic kickoff" (introduced 2024): players of both teams line up close together and may not move until the ball lands or is touched; the ball must land in the *landing zone* (the receiving team's 20 to the goal line) |
| Touchback, kickoff | the 35 for a kick that reaches the end zone on the fly (it was the 30 in 2024; 35 since 2025); a ball that first lands in the landing zone and then goes into the end zone comes out to the 20. A kickoff from the 50 (after a penalty) that ends in any touchback comes out to the 20 (2026 change; before, it followed the normal 35/20 rule). (RB 6-1-5) |
| Kickoff short of the landing zone or out of bounds | receiving team gets the ball 25 yards from the spot of the kick: its own 40 on a normal kickoff from the 35, its own 25 if a penalty moved the kickoff to the 50. (RB 6-2-4) |
| Onside kick | must be declared in advance so the receivers can set their onside formation; since 2026 it may be declared at any time in the game (2024: only in the 4th quarter and only when trailing; 2025: any time, but only when trailing) |
| Touchback, punt | ball at the receiving team's 20 |

### Challenges and review

- Each coach starts with 2 challenges; a 3rd is granted if at least one of the first two is
  successful (since 2024; before that both had to succeed). A 3rd challenge is the maximum.
- A coach must have a timeout to challenge; a failed challenge costs a timeout.
- Coaches cannot challenge inside the last 2:00 of either half or in overtime: the replay
  official (booth) initiates reviews there.
- The booth, not the coach, reviews all scoring plays and tries, interceptions and lost fumbles,
  failed fourth-down tries, kicks recovered by the kicking team, and ejections. (RB 15-1-2)

### Overtime (NFL)

If the score is tied at the end of regulation, the game goes to modified sudden-death overtime
after a new coin toss (RB 16-1-1, 16-1-2).

- **Regular season.** One 10-minute period (RB 16-1-3).
  - Both teams must get the chance to possess the ball once, unless the team that kicks off to
    start overtime scores a safety on the receiving team's first possession; then the kicking
    team wins (16-1-3-a).
  - After each team has had its chance, the team ahead wins (16-1-3-b). If the first team does not
    score on its first possession, or the score is still level after both chances, the next score
    of any kind wins (16-1-3-c).
  - There is never more than the one 10-minute period, even if the second team has not had the
    ball yet or its possession has not ended. If the score is level when it ends, the game is a
    tie (16-1-3-d).
  - Each team gets two timeouts; the fourth-quarter rules, timing included, apply (16-1-3-e).
- **Postseason.** 15-minute periods, played until there is a winner (RB 16-1-4-a, -d, -i). The same
  both-teams-get-a-chance and next-score rules apply (16-1-4-a to -c). Each team gets three
  timeouts per half (16-1-4-g).
- **Review.** Coaches cannot challenge in overtime; only the replay official starts a review
  (RB 15-1-1-c, 15-1-2-b).

### Reference for later ranks: hip-drop tackle, fair catch

Not taught in rank 1. Recorded here, from the rulebook, so later ranks have a cleared source.

- **Hip-drop tackle** (RB 12-2-18). A foul when the tackler grabs the runner with one or both
  hands or wraps him with both arms, and then drops his own weight by swivelling and dropping his
  hips or lower body, landing on or trapping the runner's legs at or below the knee. Penalty:
  15 yards and an automatic first down.
- **Fair catch** (RB 10-2).
  - *What it is*: an unhindered catch, by a receiving-team player who gave a valid signal, of a
    punt (or other scrimmage kick) that has crossed the LOS and not touched the ground, or of a
    free kick that has not touched the ground (10-2-1).
  - *The signal*: while the kick is in the air, one arm fully extended above the helmet and waved
    side to side (10-2-2 Item 1). Hands raised above the shoulders any other way is an invalid
    signal: 5 yards, and the ball is dead when the receivers catch it, but it is not a fair catch
    (10-2-2 Item 2). A player who signals may not then block a kicking-team player until the ball
    touches someone (10-2-2 Item 5; 15 yards).
  - *Protection*: the kicking team may not interfere with a receiver who has signalled; the
    penalty is 15 yards from the spot of the foul and a fair catch is awarded even if the ball is
    not caught (10-1-1 Penalty b). Once he has made the catch, no one may unnecessarily hit or
    tackle him: 15 yards from the dead-ball spot (10-2-3-c).
  - *The catch*: the ball is dead the moment he catches it, so there is no return (10-2-3-a-1). If
    the signaller lets it hit the ground and then picks it up, the ball is dead but it is not a
    fair catch (10-2-3-a-2).
  - *Next play*: the receiving team puts the ball in play from the spot of the catch, by a snap or
    by a fair catch kick (a drop kick or place kick without a tee) (10-2-4).

### 4th-down decisions (principles, no numbers)

- The general analytics consensus (win-probability and expected-points models built from many
  seasons of play-by-play data) is that NFL coaches historically **punted and kicked too often**:
  going for it on 4th and short is worth more than tradition assumed, especially around midfield
  and in opponent territory beyond comfortable field-goal range.
- What changes the answer: yards to go, field position, score, time remaining, the kicker's range,
  weather, and how good each offense and defense is.
- Teams have become much more aggressive on 4th down since about 2018 as these models spread.
  The exact starting year is a judgement call, so teach "in recent seasons".
- Lessons may present this as "the models generally say..." and must not invent percentages.

### Two-point decisions (principles)

- Because NFL kicks are taken from the 15 and two-point tries from the 2, the expected value of the
  two options is roughly similar; the *score* decides, not the average.
- Late in games, coaches go for two when the resulting margin matters (e.g., to make a deficit one
  score instead of two). Specific cases like "down 8" or "down 14" are debated and contested among
  coaches and analysts; CS should not teach a fixed chart.

## 11. Glossary

| term | definition |
|---|---|
| 2-gap | DL alignment head-up on a blocker, responsible for the gap on either side |
| 2-man | two deep halves with man coverage underneath |
| 10-second runoff | rule after the two-minute warning that runs 10 seconds off after certain offensive clock-stopping fouls |
| Ace | singleback formation with two tight ends |
| Alley | the lane between the force player and the inside defenders where a defender fills on outside runs |
| Apex | alignment halfway between the end of the line and a slot receiver |
| Arrow | quick angled route to the flat |
| Audible | QB changes the play at the line |
| A/B/C/D gap | spaces between offensive linemen, center outward |
| Backside | the side away from where the play is aimed |
| Base defense | the defense's standard personnel (4-3 or 3-4) |
| BOB | "big on big, backs on backers": man pass protection |
| Boundary | short side of the field when the ball is on a hash |
| Box | area roughly tight end to tight end within about 5-7 yd of the LOS |
| Bracket | two defenders on one receiver (one under, one over or inside/outside) |
| Break | the cut in a route |
| Bubble | quick screen to a slot drifting backward-outside |
| Bunch | three receivers in a tight triangle |
| Buzz | safety rotating down to a hook zone at the snap (term varies) |
| Cloud | corner with flat responsibility in a Cover 2 / Cover 6 shell (term varies) |
| Combo block | two linemen double a DL, then one climbs to a linebacker |
| Concept | set of routes designed to put one defender in conflict |
| Conflict defender | the defender a concept attacks; any choice he makes opens a receiver |
| Contain | keeping the QB or runner from getting outside |
| Counter | gap run with a step away first and backside pullers |
| Cover 0 | all man, no deep defender |
| Cover 1 | man with one deep free safety |
| Cover 2 | two deep halves, five underneath zones |
| Cover 3 | three deep thirds, four underneath zones |
| Cover 4 / quarters | four deep quarters, three underneath; safeties read #2 |
| Cover 6 | quarters to one side, Cover 2 to the other |
| Curl-flat | zone defender responsible for the curl, then the flat |
| Dime | defense with six defensive backs |
| Disguise | showing one coverage before the snap, playing another |
| Down block | blocking the defender to your inside |
| Draw | run disguised as a pass |
| Edge | the outside rusher, DE or OLB |
| Eligible receiver | the two ends of the line and the players at least a yard behind it, if they wear an eligible number (0-49, 80-89) or have reported; a QB under center is not eligible |
| EMOL | end man on the line of scrimmage |
| Empty | formation with no back beside or behind the QB |
| Field | wide side of the field when the ball is on a hash |
| Fire zone | 5-man pressure with 3 deep, 3 underneath zone |
| Flanker (Z) | receiver usually off the line, often to the TE side |
| Force | defender who turns an outside run back inside |
| Formation strength | the side the offense has more players on (CS: TE side) |
| Gap integrity | every gap has a defender responsible for it |
| Hash marks | two rows of short marks 70 ft 9 in from each sideline (18 ft 6 in apart in the NFL); the ball is spotted on or between them |
| Hinge | backside tackle steps back and seals his inside gap, used on power |
| Hook | underneath zone between the hash and the ball, about 8-12 yd deep |
| Hot route | quick route thrown when an unblocked rusher comes |
| I-formation | FB and TB stacked behind a QB under center |
| Inline | TE aligned next to the tackle |
| Inside zone | zone run aimed at the guard, back reads and cuts |
| Kill | switch to the second play called in the huddle |
| Leverage | which side of a receiver a defender is aligned on |
| Levels | two in-breaking routes at different depths on one side |
| Line to gain | the spot the offense must reach for a first down (the sticks) |
| LOS | line of scrimmage |
| Man coverage | each defender covers a specific receiver |
| Mesh | two shallow crossers passing close to each other |
| Mike | middle linebacker; also the protection label for the LB the line counts from |
| MOFC / MOFO | middle of the field closed (one high safety) / open (two high) |
| Motion | one backfield player moving at the snap, not toward the goal line |
| Neutral zone | the space between the two lines of scrimmage, the length of the ball |
| Nickel | defense with five defensive backs |
| Nose tackle | DT lined up on the center |
| One-gap | DL responsible for a single gap |
| Outside zone | zone run aimed outside the tackle/TE, stretches the defense sideways |
| Over front | 4-3 with the 3-technique to the strength |
| Personnel | two-digit code: backs, then tight ends |
| Pistol | QB about 4 yd back, RB directly behind him |
| Play-action | pass after a fake handoff |
| Playside | the side the play is aimed at |
| Power | gap run with down blocks, a kick-out and a pulling backside guard |
| Press | corner aligned about 1 yd from the receiver to jam him |
| Pull | lineman leaves his spot at the snap and runs along the line to block elsewhere |
| Quarters | Cover 4 |
| Read option | QB reads an unblocked defender to keep or give |
| Red zone | inside the opponent's 20 |
| Robber / rat | defender in a low middle zone in man coverage, jumping crossers |
| Rotation | safeties changing shell at the snap |
| RPO | run-pass option: run blocking, QB reads one defender to hand off or throw |
| Sam | strong-side linebacker (CS) |
| Seam | vertical route by an inside receiver between deep zones |
| Shift | two or more players changing position before the snap; all must then set 1 second |
| Shotgun | QB about 5 yd behind the center |
| Sight adjust | QB and receiver change a route on the same pre-snap read without a call |
| Sim pressure | 4-man pressure from unexpected rushers, 7 in coverage |
| Singleback | one back behind a QB under center |
| Slide protection | line slides one way blocking gaps, the back takes the other side |
| Slot (H) | receiver between the outside receiver and the line |
| Split end (X) | receiver usually on the line, often away from the TE |
| Spike | throwing the ball into the ground to stop the clock; uses a down |
| Spill | forcing a run outside toward the force/alley player |
| Stem | the straight part of a route before the break |
| Stunt / twist | linemen exchanging gaps after the snap |
| Tampa 2 | Cover 2 with the Mike carrying the deep middle |
| Technique | number for a DL's alignment on an offensive lineman |
| Touchback | ball dead in the end zone, put in play at a fixed yard line |
| Trail technique | man defender running just behind and under the receiver, trusting deep help |
| Trap | interior DL left unblocked then blocked from the side by a puller |
| Trips | three receivers to one side |
| Two-minute drill | hurry-up offense at the end of a half |
| Two-minute warning | automatic stoppage at 2:00 of the 2nd and 4th quarters |
| Under front | 4-3 with the nose to the strength, 3-technique weak, Sam on the line |
| Will | weak-side linebacker (CS) |
| Y | CS letter for the tight end |
| Zone coverage | each defender covers an area |
| Zone run | linemen block areas together; the back chooses the hole |
