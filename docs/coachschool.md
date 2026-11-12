# Coach School — football-IQ puzzle page

A page that teaches a 13-15-year-old who knows NFL teams and players (fantasy-literate) the
*coaching* side of football: positions beyond fantasy, formations, personnel, routes, run
schemes, fronts, coverages, pre-snap reads, audibles, situational football, game planning.
Learn-through-puzzle, gamified, career ladder Intern → Head Coach, every concept SHOWN as an
animated play, explained, practised, and repeated on a schedule so it sticks.

Plan written 2026-11-11 (planner: Fable 5.2; amended by the orchestrator after the user's answers).
Entries below the plan follow the house rule: newest at the bottom, lower wins.

## Decisions the user made (2026-11-11)

| question | answer |
|---|---|
| Look | **The 8-bit Scores re-enactment** (`assets/sunday/sd-reenact.js` on the unmerged `scores-8bit` branch, worktree `C:\dev\bucky-wt\scores-8bit`). |
| Age / reading | **13-15, a bit more depth**: 3-4 sentences per card, real coaching vocabulary introduced up front (always defined the first time). |
| Device | **Phone, portrait** first; desktop gets a centred column. |
| Progress | **localStorage on this device only** for v1; sync later. |
| Real teams | **Real teams on the field too**: the 8-bit players wear real NFL team kits in the animations. |
| Rules | NFL rules only (default; not asked). |

## Architecture (amended from the planner's SVG plan)

The 8-bit renderer is a **canvas**, Tecmo-style camera: along-field runs horizontally, across-field
(53.33 yd) runs vertically, side-on shaded sprites. That camera fits a portrait phone well: ~40
yards along the field across the screen width, the full field width down the screen height.
So the engine is **canvas**, not SVG. Consequences:

- Art is **copied** (house convention: no shared JS between pages) from
  `C:\dev\bucky-wt\scores-8bit\assets\sunday\sd-reenact.js` — sprite rasteriser (`raFig`,
  `raSprite`, ~1343-1570), ball sprite, field art (`raFieldArt` ~1638), kits/palettes
  (`raGenericKit`, `raKit`, `raPalette` ~1802-1890 and whatever team-colour data they read),
  pixel fonts (`RA_GLYPHS`, `RA_BIG`, `pixText`, `bigText`). Record the source commit (`bdb314b`)
  in a header comment. Do NOT merge or depend on the `scores-8bit` branch; `coachschool` branches
  from `origin/main`.
- **Chalk overlay** drawn on the canvas over the sprites: route lines (dotted before the snap,
  solid as run), zone shapes, gap letters, spotlight ring, callout text. Chalkboard X/O vibe on
  top of 8-bit football.
- **Testability without DOM nodes per player**: `CS.poseAt(play, t)` is pure and returns yard
  coordinates; the renderer exposes `window.__CS__` with `{play, t, seek(t), screenToYard(px,py),
  yardToScreen(x,y), hitTest(px,py) -> playerId}`. Tests assert yards and the hit-test mapping,
  never pixels.
- Tap targets: hit-test radius ≥ 22 CSS px around each player's feet.
- All motion rAF-driven from `poseAt` (CSS keyframes stall in headless Chrome — docs/games.md).
  `prefers-reduced-motion` → step through key frames instead of tweening.

### Files

- `coachschool.html` — shell: tokens, markup, boot script; loads the classic scripts below onto one global `CS`.
- `assets/coachschool/cs-core.js` — pure, no DOM (Node `vm` loadable): state, XP/rank math, Leitner review, yard geometry, DSL resolver, `poseAt`, validators.
- `assets/coachschool/cs-field.js` — canvas renderer, camera, copied 8-bit art, chalk overlay, hit-testing, playback (play/pause/0.5x/scrub).
- `assets/coachschool/cs-lib.js` — formations, routes, zones landmarks, coverages, `BEATS` truth table, team kit table.
- `assets/coachschool/cs-pz-<type>.js` — one file per puzzle type, registers into `CS.puzzleTypes`.
- `assets/coachschool/cs-rank-<n>.js` — lessons, puzzles, Game Day exam per rank (data only).
- `assets/coachschool/cs-ui.js` — screens: career map, lesson, puzzle, film room, Game Day, promotion.
- `tools/_verify-coachschool.mjs` — the suite.
- `docs/coachschool-facts.md` — the single source of football truth; content may only use facts from it.

### Coordinates and DSL

Yards. `x` = across the field 0..53.33 (hashes at 23.58 and 29.75, NFL). `y` = relative to the
line of scrimmage, positive = offense's downfield. The camera maps `y` to screen-horizontal
(offense attacking to the right) and `x` to screen-vertical.

```js
// formation: alignments in yards; side-relative tokens resolved by cs-core
{ id:"gun-trips-rt", personnel:"11", strength:"R",
  players:[ {id:"C",pos:"C",x:26.67,y:0}, {id:"LG",pos:"G",dx:-1.5,y:0},
            {id:"X",pos:"WR",x:6,y:0,on:true}, {id:"Z",pos:"WR",x:47,y:-1},
            {id:"QB",pos:"QB",x:26.67,y:-5}, ... ] }
// route: waypoints relative to alignment; "in"/"out" resolved by the player's side
ROUTES.slant = { n:2, pts:[[0,3],["in",5,8]] }
// play
{ id:"smash-vs-c2", formation:"gun-2x2", defense:"c2-43-over", teams:{off:"KC", def:"BUF"},
  assign:{ X:{route:"hitch"}, H:{route:"corner"}, RB:{block:"B-gap-L"}, LT:{pass:"slide-L"} },
  ball:[ {t:0,ev:"snap"}, {t:2.4,ev:"throw",to:"H"}, {t:3.3,ev:"catch"} ],
  tags:["concept:smash","cov:2"], beats:"cov:2",
  callouts:[ {t:1.6, focus:"CB-L", text:"The corner sinks or squats. He can't do both."} ] }
// defender assignment
{ id:"FS", zone:"deep-half-R" } | { man:"Z" } | { rush:"A-gap-R" } | { spy:"QB" }
```

Zones resolve through a `ZONES` landmark table (flat, hook, curl, deep third/half/quarter).
Segment speeds in yd/s, defaults: receivers 7, backs 6.5, DBs 6.8, LBs 6, linemen 4.

## Curriculum — 7 ranks (~40 units)

1. **Intern — the field and the 22**: field geography (hashes, numbers, boundary vs field, red
   zone); LOS, 7 on the line, eligible receivers; OL roles LT/LG/C/RG/RT; QB/RB/FB/TE(Y);
   X (split end, on the line) / Z (flanker, off) / slot; DE/DT/nose; Sam/Mike/Will; CB/FS/SS;
   formation strength.
2. **Quality Control Coach — groupings & formations**: personnel numbers (RBs, TEs; WR = 5 − sum)
   11/12/21/10/13/22; I-form, singleback, shotgun, pistol, 2x2, 3x1 trips, bunch, empty; shift vs
   motion; base 4-3 / 3-4, nickel, dime; gaps A/B/C/D and hole numbering; reading a huddle call.
3. **Position Coach (Offense)**: route tree 0-9 (numbering varies by system — say so); 3/5/7-step
   drops and timing; man vs slide protection, who is hot; inside zone, outside zone, power, counter,
   trap, draw; play-action; screens.
4. **Position Coach (Defense)**: techniques 0/1/2i/3/5/9; over vs under; one- vs two-gap; man vs
   zone; Cover 0/1/2, Tampa 2, Cover 3/4/6, 2-man; run fits, force/contain; stunts and twists.
5. **Offensive Coordinator**: pre-snap reads (MOFO/MOFC, corner depth/leverage, motion as man/zone
   tell, box count, ID the Mike); concepts and what they stress — smash, four verts, flood/sail,
   mesh, stick, slant-flat, curl-flat, levels, dagger, post-dig; RPO and read option; audible vs
   hot route vs sight adjust vs kill.
6. **Defensive Coordinator**: disguise and rotation; Cover 0 blitz, fire zone (5 rush/3 under/3
   deep), sim pressure; matching personnel; taking away a concept; red-zone defense.
7. **Head Coach**: down & distance, third-down calls, red zone/goal line; two-minute drill (clock
   stoppages, spike, timeouts, sideline); four-minute offense; 4th-down decisions; two-point
   decisions; challenges; game plan (tendencies, matchups, opening script) and halftime
   adjustments; capstone "Super Bowl" — call a full drive both ways.

## Learning loop (every unit)

1. **Chalk talk** — 3-5 cards, 3-4 sentences each, each tied to a diagram state.
2. **Watch it** — play runs with timed callouts that pause, spotlight one player, one line of text.
3. **Walkthrough rep** — same play, he taps the answer at each pause.
4. **Puzzle set** — 6-8 puzzles: first two repeat the taught example, rest are variants. After
   rank 1, every set mixes in 2 review puzzles from earlier ranks.
5. **Film room** — every completed play is replayable with callouts.

After any answer the play ALWAYS runs. Wrong answer → the failure plays out (pick, unblocked
rusher), then the right version.

Puzzle types: `tap` (tap the player), `choice` (MC over a diagram), `route` (drag a route onto a
receiver to beat the look; checker = `BEATS`), `place` (drag players to alignments; landmark
tolerance in yards), `assign` (blockers ↔ gaps, bijection), `call` (situation card → call/audible),
`predict` (freeze at snap: where does the ball go).

Review: Leitner boxes per concept tag, intervals 0/1/3/7/21 days; wrong → box 1. Daily Practice =
10 due tags, least-seen variant.

## Gamification & persistence

- XP: 10 first-try correct, 5 second try, 5 per review rep, 100 per passed Game Day. XP → lifetime
  Coach Level; XP never gates rank.
- Promotion: all units in the rank + Game Day (12 mixed questions, scoreboard skin) at ≥ 10/12.
  Fail costs nothing, shows which tags to revisit. Promotion moment: full-screen contract-signing
  card, new title, rarity-rim flourish, WebAudio synth fanfare (persisted mute; pattern
  `hayhem.html:1638`).
- Streak: day counts with ≥ 5 reps; one "bye week" freeze per 7 days.
- Badges tiered with GFFL rarity colours (`league.html:812-830`).
- localStorage key `cs_state_v1_<choreUser>` (identity from `choreUser`, `games.html:285`; safe
  get/set wrappers per `goatcare.html:210-211`):
  `{v, xp, rank, units:{id:{done,best}}, srs:{tag:{box,due}}, streak:{n,last,freezes}, badges:[], seenPlays:[]}`.
- Chrome borrows GFFL tokens (`league.html:54-72`), card/chip chrome (`league.html:1335-1354`).
  No emoji in chrome — inline SVG icons.

## Verification — `tools/_verify-coachschool.mjs`

**A. Node (vm-loaded core/lib/rank files):** unique ids; tags exist and are taught before tested;
prereqs a DAG in rank order; every formation 11 players, exactly 7 on the line, in bounds, no two
within 0.8 yd, personnel code matches counted RBs/TEs; every defense 11; deep-defender count per
coverage hand-written (C0=0, C1=1, C2=2, Tampa 2=2 + Mike middle hole, C3=3, C4=4); every puzzle's
stored answer passes its checker and every distractor fails; route-puzzle distractors not in
`BEATS` for that coverage; a broken fixture with two right answers must be flagged; `poseAt(t=0)`
= alignment; hand-computed 12-yd dig at 7 yd/s exact at t=2.0; mirrored formation flips in/out;
ball within 0.5 yd of receiver at catch; XP/Leitner math from a fixture log with a pinned clock,
no `||`/`??` defaulting on real zeros.

**B. Headless Chrome** (pattern: `tools/_verify-hayhem.cjs`, local server on a fresh port, block
`googleapis|gstatic|firebase|firestore`): boot at 390x844, zero page errors, no page scroll on the
puzzle screen; every `[hidden]` overlay has `offsetParent === null`; `__CS__.yardToScreen` /
`hitTest` round-trip for every player after `seek`; a real tap answers a puzzle, XP +10 exactly,
reload keeps state, promotion fires once; no emoji in headings/buttons/nav (normalised
`textContent`); touch targets ≥ 44px. Review plates to the scratchpad, looked at after green.

## Phases

| # | scope | owner |
|---|---|---|
| 0 | `docs/coachschool-facts.md` — definitions, `BEATS`, clock rules, zone landmarks, alignments. **User reviews.** | strongest |
| 1 | shell + tokens, `cs-core.js`, `cs-field.js` (8-bit art copied, camera, chalk overlay, playback, hit-test), `cs-lib.js` seed, suite skeleton | strongest |
| 2 | Rank 1 vertical slice: `cs-ui.js`, `tap` + `choice`, lesson loop, Game Day, promotion, save/load, suite B | strong |
| — | **Playtest gate**: son plays rank 1 on a branch preview; dad approves look + reading level | user |
| 3a | `route`, `place`, `assign`, `call`, `predict` (one agent per file) | strongest |
| 3b | full library from the fact sheet | mid, strongest review |
| 4 | ranks 2-7 content, one agent per file, facts only from the sheet | mid, strongest accuracy review |
| 5 | review scheduler, Daily Practice, streaks, badges, film room, audio | mid |
| 6 | hub tiles (`games.html:391-404` + `index.html:2820` — keep in sync), CLAUDE.md row, plates | mechanical |
| 7 | optional Firestore sync / dad view | later |

Nothing reaches `main` without the user's preview approval.

## 2026-11-11 — after the dad's first phone playtest of PR #182

**Stuck Play on lesson 1 (fixed).** Every rank-1 watch play opened with two callouts before the
snap (t -1.0 and -0.5; the clock starts at -1.2). A press ran 0.2 s, then 0.5 s, of a frozen
pre-snap picture, stopped again, and the button went back to reading "Play". With Reduce Motion
on, each press also waited 1.2 s before its first key-frame step. Now: before the snap nobody
moves, so a lesson's Play goes straight to the next pre-snap note or straight to the snap; reduced
motion steps at once; stopped on a note the button reads "Next". Suite B16 presses through every
watch step like a user (a visible change within 400 ms per press, normal and reduced motion).

**Coach bubbles and the camera** (the dad: "text should be in bubbles with visible arrows to where
the student should be looking, and we should zoom in and out when drawing attention to
something"). Chalk-talk cards are runs of 1-4 bubbles (`say: [{focus, text}]`, 3-4 sentences per
card in all, 1-2 per bubble); callouts, walkthrough prompts and puzzle feedback are bubbles too.
A focus is a list of `CS.focusOf` tokens: player ids, groups (`ol`, `dl`, `lb`, `line`, `backs`
bracketed; `db`, `receivers` an arrow each) and field features (`hash:L|R`, `hashes`,
`sideline:L|R`, `numbers:L|R`, `los`, `ball`, `goal`, `yl:N`, `redzone`, `field`, `boundary`).
Walkthrough `look` tokens point at where to look, never at the answer. Puzzle prompts stay in the
panel (pointing would give the answer away); a tap puzzle's feedback points at the player, a
choice question's at what it is about, a pure fact question's stays in the panel. The camera is
pure (`CS.camFrame`, `CS.camLerp`, `CS.ease`), eases 480 ms, cuts under reduced motion, frames a
target to at most 55% of the view's height so its bubble has room, and zooms out whenever the play
runs. The canvas backing store now follows device pixels so zoomed art stays nearest-neighbour crisp.

**Spotlight on what a bubble names** (the dad, at the OL card's plate: the defensive line, rightly
set a yard off the ball per fact sheet 1c, overlapped the linemen, the five read as a pile and the
dashed bracket took in defenders). Coaching-film style: while a bubble names players or a group,
everyone else is drawn at 0.32 opacity (shadow too) and the named men are drawn last, on top. A
bubble about field features only (hash, LOS, numbers...) fades nobody. The fade rides the camera's
ease (`CS.spotAlpha`, same t0 and 480 ms), cuts under reduced motion, and clears when the play runs
(it stays clear after the play ends). A bubble that asks for a tap (walkthrough prompts, a wrong-tap
retry) passes `spot: false` and fades nobody: the answer is often outside what it points at, and
fading him would hide him while lighting him would give him away. A group bracket is the union of
its own members' sprites plus 5 px, never grown; a man whose sprite overlaps it from outside is
faded. Hit-testing: a faded man's sideways distance counts double (at most +10 CSS px), so a tap
where a faded sprite overlaps a lit one goes to the lit man; a tap on a faded man's own axis or
feet is still his (a flat +10 px broke the stacked-column rule). `__CS__.spot` exposes the lit ids,
each player's opacity and the draw order.

## 2026-11-11 — the 8-bit art re-ported from production

The dad, at his phone's Scores 8-bit view: Coach School's players were "not the production retro
models". Phases 1-2 had copied `sd-reenact.js` from the unmerged `scores-8bit` branch (bdb314b);
production (origin/main, 960fb27) has since redrawn the players (rigged skeletons, eight-frame
walk/jog/run/carry/backpedal strides, pass release and follow-through, catch then secure, chopping
block, fall), faces under the helmet, light grey facemasks, 7x7 helmet logos, and home-paint end
zones. `cs-field.js` now carries those verbatim (provenance and line ranges in its header);
poses and facing stay pure in t. No CDN logos are fetched (midfield and end-zone logos are skipped).
Suite A-art cuts the player code out of production's file, runs it in a vm, and requires equal
raFig grids, frame set, ball-hold spots, kits, logos and facemask colour; against the old copy all
five checks fail. Two matchups failed B15 (min 22) with the new sprites, NE-NYJ (13) and KC-DEN
(16); the defenses traded places (NE-DEN 42, KC-NYJ 58), kits untouched. `CS.placeBubble` now
treats a spot within 26 px of any arrow's point as a last resort (an arrow stopped 9 px short was a
stub on two cards once the DBs backpedal facing the offense).

## 2026-11-11 — the neutral zone drawn wide; route chalk only where it is the point

The dad, from his phone at the LOS card (bubble 4 of 4, zoomed): "still instances where lines are
overlapping", and "don't show receiver routes unless it's relevant for that puzzle or section of
the lesson".

**Overlap.** Measured, not guessed: a lineman's stance sprite paints 15 world px in front of his
feet and 10 behind; a yard is 14 px along the field (15 across). With the defensive line set 1 yd
off the ball (fact sheet 1c), every OL/DL pair overlapped by 16 px on every play; the QB under
center overlapped the center by 5 px and the guards by 7; the gun back and QB by 2-4 px; a 3-4 OLB
and the tight end by 12. The yards stay the fact sheet's. The picture spreads them, as a coaching
diagram does, in one place, `CS.spreadOf` (cs-core), from each man's own set-pose sprite as painted:
1. **The neutral zone.** The whole offense slides back until no offensive sprite comes within
   `NZ_PAD` (3) world px of the line of scrimmage; the whole defense slides forward likewise. One
   shift per team keeps every depth inside the team (X on the line and Z a yard off stay a yard
   apart) and nobody moves across the field, so techniques and shades stay right. Typical result:
   offense back 18 px (1.29 yd), defense forward 4 px (0.29 yd), so the linemen's feet are drawn
   36 px (2.6 yd) apart instead of 14, with 6 px of open turf and the ball between the two lines.
2. **Teammates.** Two of the same team whose painted boxes come within `SPREAD_GAP` (1) px on both
   axes are pulled apart along whichever axis needs the smaller move: along the field the man
   farther from the line moves away from it (the QB under center goes back off the center), across
   the field the man farther from the ball moves outward (the gun back slides a few px wider).
   Order is never swapped. The stacked OL (22.5 px apart, 21 px tall) needs nothing.
The spread holds to the snap and eases out over `SPREAD_T` (0.5 s) after it, so the lines fire off
into each other; after that the picture is the yards, and contact is football. Gait and facing
still come from `poseAt`. The ball stays on its spot before the snap; a loose snap carries the QB's
share of the spread. Everything that draws a man uses `CS.showAt` (sprites, route and zone-drop
chalk, the hit-test fallback); `__CS__.field.shown` is where each man is drawn, `.spread` the
offsets. The zoom does not matter: sprites and yards scale together, so a world-px rule holds at
every camera. The LOS card's last bubble now says so: "...and we draw the two teams further apart
than the real gap of about a yard." Suite A8 (hand arithmetic on r1-los and every library play),
B17 (every rank-1 bubble frame before the snap), B20 (every library play, every puzzle frame): no
two painted boxes intersect before the snap. One matchup re-measured on B15 once the defense's
boxes stopped taking in the offense's linemen and the blue line: HOU-JAX 19 (needs 22) became
HOU-TEN 96.

**Chalk is opt-in.** Route chalk (the dotted pre-snap path, the solid run) and zone chalk (shapes
and drops) are OFF by default everywhere: cards, watch, walkthrough, puzzles, film room, while the
play runs. A step turns them on where they are the point: `routes: true | ['Z', 'H']` and
`zones: true | [ids]` on a card, a single bubble, a callout, a walkthrough step or a puzzle; watch
and the film room use the play's own flags. A bubble's flag overrides its step's while it shows.
Rank 1 (names and places) flags nothing; the smash demo play flags both (smash is its routes
against Cover 2). Ranks 3 and 5 (route tree, concepts) opt in. Gap letters are not drawn anywhere
yet. `__CS__.field.chalk` is what the frame drew.

**Eligible receivers corrected** (the dad asked for r1-u2 to be checked; fact sheet corrected the
same day): the card no longer says interior linemen are eligible if they report, or that every
backfield player is eligible. It now teaches the spot AND the number, reporting for a 50-79 man who
lines up at an eligible spot, and the QB-under-center exception. r1-u2-p4 and the slot card say
why by his number too. Suite A6 holds the card to the corrected wording and no rank-1 string may
carry either old claim.

## 2026-11-12 — puzzle types become plugins; the suite splits into modules

Before phase 3a (five types built in parallel, one agent each), the seams they would have collided
on were cut. **The contract**: a type registers `CS.puzzleTypes[name]` with a pure half (`check`,
`truth`, `distractors`, `validate`, `examples`) and a page half (`mount(ctx) -> handle`, `rightName`,
`lookOf`, optional `outcome` for "the failure plays out, then the right one"). `askPuzzle` in cs-ui
no longer names a type: it owns tries, XP, review boxes, sounds, the explanation, Game Day and the
runs after the answer, and hands the type a `ctx`. `tap` and `choice` moved their page code into
their own files unchanged (every pre-existing check green). **Field hooks** in cs-field so no type
edits it: `overlay.path/link/gaps`, `drag()` (44 px handles, snap callback in yards, tap-select then
tap-place), `freezeAtSnap` / `playTo` (stop on the time exactly), `zoomTo`; pure helpers `CS.gapsOf`
(gaps from where the linemen stand, fact sheet 8), `CS.snapTo`, `CS.routeWaypoints`, `CS.variantOf`.
**The suite** keeps its entry file and loads `tools/coachschool-checks/*.mjs`; `contract.mjs` holds
every registered type to the contract (pure and on the page, including a clean `destroy()`), and
`field-hooks.mjs` measures the hooks against yardToScreen / spriteRect and hand-computed gap yards.
`--only a,b` runs just those modules. The brief for the type agents, with the files each may touch
and a spec per type: `docs/coachschool-puzzle-types.md`.
