# Coach School — puzzle types: the plugin contract and the field hooks

This is the brief for the agents who build the five interactive puzzle types (`route`, `place`,
`assign`, `call`, `predict`) **in parallel, one agent per type**. Read `docs/coachschool.md` first
(the plan and its dated decisions, lower wins) and `docs/coachschool-facts.md` (the only source of
football truth). Written 2026-11-12; entries below the per-type specs follow the house rule, newest at
the bottom.

## Files: what a type agent may and may not edit

A type agent edits exactly three things, and nothing else:

| file | what |
|---|---|
| `assets/coachschool/cs-pz-<type>.js` | new: the whole type, pure half and page half |
| `tools/coachschool-checks/pz-<type>.mjs` | new: the type's own checks (the conformance check needs no edit) |
| `coachschool.html` | ONE line: replace `<!-- puzzle type: <type> -->` with `<script src="assets/coachschool/cs-pz-<type>.js"></script>` |

The placeholder lines are separated by blank lines so five branches merge without a conflict (tried:
three branches each replacing their own line merge cleanly). The suite fails if a `cs-pz-*.js` file
on disk has no script tag on the page.

**Read only** (if you need a change there, stop and say so in your report; the orchestrator makes it):
`cs-core.js`, `cs-field.js`, `cs-ui.js`, `cs-lib.js` (another agent owns it), `cs-rank-*.js`,
`cs-pz-tap.js`, `cs-pz-choice.js`, `tools/_verify-coachschool.mjs`,
`tools/coachschool-checks/contract.mjs`, `field-hooks.mjs`, the docs. Do not write in this doc; put
notes for it in your report.

**Styles.** The page's CSS is in `coachschool.html`; do not edit it. Panel controls get the existing
look for free as `<button>`s in `ctx.panel` (`#stOpts.opts button`: a two-column grid, at least 48 px tall, `.good` / `.bad` states). For
anything else, inject one `<style id="cs-pz-<type>-css">` at file load, guarded so the Node vm (no
`document`) skips it: `if (root.document && !root.document.getElementById(ID)) {...}`. It is then part
of the page before any puzzle, so the conformance check's stray-element count does not see it. Never
add a style (or anything) to the page in `mount()` that `destroy()` does not remove.

**Content.** Puzzles for real lessons come later (phase 4, rank files). A type ships its own fixture
puzzles as `T.examples` on library plays (`CS.lib.PLAYS`), at least two, so the conformance check and
the type's checks have something to run. If no library play fits, build a variant in the type file
with `CS.variantOf(play, {...})` and register it into `CS.lib.PLAYS` under an id that starts
`pz-<type>-` (never overwrite an existing id).

## The contract

```js
CS.puzzleTypes[name] = {
  name,
  // PURE: no DOM, no window. The suite runs these in a Node vm.
  check(pz, ans, lib)        -> boolean     the one judge, for the page and the suite
  truth(pz, lib)             -> ans         the right answer, worked out from the play / the rule
  distractors(pz, lib)       -> ans[]       non-empty; each must fail check()
  validate(pz, lib)          -> string[]    authoring errors, [] = clean; must flag two right answers,
                                            a stored answer that is not truth(), and a missing play
                                            (report it, never throw)
  examples                   : pz[]         fixture puzzles (see Content)
  // PAGE: cs-ui calls these with a ctx (below).
  mount(ctx)                 -> handle      put up controls / field hooks for ONE puzzle
  rightName(pz, ctx)         -> string      the right answer in words: "The answer: <rightName>."
  lookOf(pz, ctx)            -> tokens|null CS.focusOf tokens the explanation bubble points at;
                                            null = the explanation stays in the panel
  outcome?(pz, ans, ok, ctx) -> runs|null   what plays after the answer, in order:
                                            [{ play, say?, marks?, chalk? }]
}
handle = {
  destroy()                  remove EVERY control, listener, overlay and drag session it added
  onTap?(id)                 a tap on the field: a player id, or null for grass
  missed?(ans)               first wrong try in a lesson: show what he picked, keep it open
  resolved?({ ok, picked })  the puzzle is over: lock the controls; may return extra field
                             marks [{ id, kind: 'good' | 'bad' | 'focus' }]
}
```

`CS.PUZZLE_API` lists the members; `CS.contractErrors(T, name)` is what the conformance check calls.
The answer `ans` is any JSON value (it must survive `JSON.parse(JSON.stringify(ans))` unchanged and
still check the same). `check` must not mutate `pz` and must give the same verdict twice.

**cs-ui owns everything else**, type-agnostically (`askPuzzle` in `cs-ui.js`): tries (2 in lessons,
1 on Game Day), XP (10 first try, 5 second) and review boxes, the right / wrong sound, the
explanation (bubble at `lookOf`, or the panel), Game Day scoring, the Next button, Replay, and
"after any answer the play runs". A type never awards XP, plays a sound, or advances the lesson.

Flow for one puzzle:
1. cs-ui sets the play (chalk per the puzzle's `routes` / `zones` flags), the `focus` marks, the
   prompt in the panel, an empty hidden `ctx.panel`, then calls `T.mount(ctx)`.
2. The type puts up its controls. An answer goes to `ctx.submit(ans)`; cs-ui checks it.
3. Wrong on try 1 of 2: `handle.missed(ans)` (without one, cs-ui says "Not that one. One more try.").
   The type must leave the controls usable for the second try (reset the drag, disable the wrong
   option, etc.).
4. Right, or out of tries: `handle.resolved({ ok, picked })`, then the explanation, then the runs
   from `T.outcome(...)` (or the puzzle's own play once). Replay replays the whole list.
5. Leaving the puzzle (Next, Back, another screen): `handle.destroy()`, then cs-ui sweeps
   `field.overlay.clear()` and `field.endDrags()` as a safety net. The conformance check calls ONLY
   your `destroy()`, so the sweep does not hide a leak.

### ctx

| member | what |
|---|---|
| `pz`, `play`, `lib`, `CS`, `doc` | the puzzle, its play object, the library, the global, `document` |
| `field` | the stage field: the whole cs-field API plus the hooks below |
| `panel` | `#stOpts`, empty and hidden at mount; fill it and set `hidden = false` |
| `submit(ans)` | answer; ignored once the puzzle is done |
| `feedback(kind, parts)` | the panel feedback line; kind `'good' | 'bad' | null`; parts = strings / `{tag, text, cls}` |
| `say(bubble)` | a coach bubble on the field: `{ parts, focus, tone, zoom, spot }`; `say(null)` clears |
| `action(label, fn)` | the main button: e.g. `ctx.action('Lock it in', () => ctx.submit(current))`; `ctx.action(null)` hides it |
| `focusMarks` | the puzzle's own `focus` marks (to keep when you set marks) |
| `tries`, `tryNo`, `done`, `gameDay` | 2 or 1; the current try; over yet; on Game Day |
| `reduced` | prefers-reduced-motion: no tweens, cut straight to the end state |
| `sfx.right()`, `sfx.wrong()` | the sounds (cs-ui already plays them on answers; use for a snap-into-place tick only if it matters) |
| `nameOf(id, play?)`, `lc(text)` | a player's display name ("the left tackle"), lower-casing for mid-sentence |

## Field hooks (cs-field.js)

All positions are **yards**: `x` across the field 0..53.33, `y` from the line of scrimmage, positive
downfield for the offense. The hooks draw through the camera, so they zoom and pan with it. A player's
yards are `CS.poseAt` (the fact sheet's), not the spread picture; the drawn spot before the snap is
`field.shown` (the neutral zone is drawn wider than it is, `docs/coachschool.md`, 2026-11-11).

### Overlays: `field.overlay`

```js
const h = ctx.field.overlay.path({ pts: [[x, y], ...], anchor: 'X', tone: 'focus', dashed: true, arrow: true });
const k = ctx.field.overlay.link({ from: 'LT', to: 'B-gap-L', tone: 'chalk', dashed: false, arrow: true });
const g = ctx.field.overlay.gaps({ side: 'R' });          // or { names: ['A-gap-L', 'A-gap-R'] }, or {}
h.update({ pts: newPts }); h.remove();
ctx.field.overlay.count;                                  // how many are up
```

- **path**: a chalk polyline from yard waypoints. `anchor: id` makes it ride with that man's drawn
  spot before the snap (like route chalk). For a route use
  `CS.routeWaypoints(play, 'X', 'corner')` (a `ROUTES` name or `{pts}`; in / out by his side, ball on
  the hash included).
- **link**: a connector. Each end is a player id (ends on the centre of his painted sprite), a gap
  name `'A-gap-L'..'D-gap-R'` (on the line of scrimmage between the two men who make it), or
  `{x, y}` yards.
- **gaps**: the gap letters A-D each side, at `CS.gapsOf(compiled)` (fact sheet 8, from where the
  linemen actually stand: A center-guard, B guard-tackle, C tackle-TE or half a split outside the
  tackle with no TE, D outside the TE or 1.5 splits outside the tackle; moves with the ball on a hash).
- Tones: `chalk` (white), `focus` (yellow), `good` (green), `bad` (red).
- `field.overlays` is what this frame drew, in client CSS px: `{ paths: [{pts}], links: [{a, b}],
  gaps: [{name, letter, yd, x, y, ground}] }`. Assert against it, with `yardToScreen` / `spriteRect`.

### Drag: `field.drag(o)`

```js
const d = ctx.field.drag({
  handles: [{ key: 'rb', id: 'RB' }, { key: 'm1', x: 31, y: -6, label: 'S' }],  // a player, or a free marker
  snap: (pos, key) => CS.snapTo(pos, LANDMARKS, 1),  // -> {x, y, name?} | null; tolerance in YARDS
  moves: true,                    // false: the handle stays and a rubber band follows the finger ("connect")
  onStart(key) {}, onMove(key, pos, snapped) {}, onDrop(key, pos, snapped) {},
});
d.positions;      // { rb: {x, y}, m1: {x, y} } in yards
d.selected;       // the key picked by a tap, or null
d.set('rb', { x: 22, y: -6 });   // put it somewhere (a reset after a miss)
d.destroy();      // handles gone, moved players back on their alignment, touch-action given back
```

- Handles are 44 px across under the finger at any zoom. A press on a handle is the drag's: no player
  tap reaches `onTap`. A press-and-drag moves it; **a tap on a handle selects it and the next tap on
  the field drops it there** (one finger, no drag). Both paths call `snap` and `onDrop`.
- A moved player is drawn on his new yards (plus his share of the pre-snap spread) until the drag is
  destroyed or the play changes.
- For "connect A to B" (assign): `moves: false` handles on the blockers; on `onDrop(key, pos)` find
  the target under the drop (`CS.snapTo(pos, gapAndDefenderLandmarks, tol)`), then draw a `link`.
- `field.drags` (handle centres in client px, radius) and `field.moved` are for the suite.

### Clock and camera

```js
ctx.field.freezeAtSnap((t) => { /* t === 0: the snap, held */ });
ctx.field.playTo(1.5, cb);        // run from where it is, stop ON 1.5 exactly, then cb(1.5)
ctx.field.zoomTo(['ol', 'dl']);   // CS.focusOf tokens; zoomTo(null) = the whole view; { instant: true } cuts
ctx.field.gapsOf();               // the gaps of the play on the field, {'A-gap-L': x, ...}
```

`seek`, `pause` and `setPlay` cancel a pending freeze. Under reduced motion the clock steps through
key frames, and `playTo` still stops on its time exactly.

### Pure helpers (cs-core.js)

`CS.gapsOf(compiled)`, `CS.snapTo(pos, landmarks, tol)` (nearest within `tol` yd, inclusive),
`CS.routeWaypoints(play, id, route)`, `CS.variantOf(play, { tag, assign: { X: {route: 'slant'} }, ... })`
(a new legal play for an outcome run: his wrong route, the unblocked rusher), `CS.compile(play)`
(`.byId`, `.off`, `.def`, `.target` = who the ball is thrown to, `.snapT`), `CS.poseAt(play, t)`,
`CS.focusOf(play, token, t)`. Zone landmarks: `CS.lib.ZONES` (fact sheet 4).

## How a wrong answer plays out

The plan: "After any answer the play ALWAYS runs. Wrong answer → the failure plays out (pick,
unblocked rusher), then the right version." That is `outcome()`:

```js
outcome(pz, ans, ok, ctx) {
  if (ok) return null;                                    // the puzzle's own play, once
  const bad = ctx.CS.variantOf(ctx.play, { tag: 'wrong', assign: { [ans.id]: { route: ans.route } }, ball: [...] });
  return [
    { play: bad, say: { parts: ['Corner sits on it. Picked.'], focus: ['CB-L'], tone: 'bad', zoom: false } },
    { play: ctx.play },                                   // then the right version
  ];
}
```

cs-ui plays the runs back to back (the next starts when one ends), Replay starts the list again, and
the explanation bubble shows on any run without its own `say`. Each run's `play` must pass
`CS.validatePlay` (check it in your module). Keep a wrong run honest: it shows what the fact sheet
says goes wrong, nothing invented.

## Adding a type, step by step

1. `assets/coachschool/cs-pz-<type>.js`, the same IIFE shape as `cs-pz-tap.js`:
   `(function (root) { const CS = root.CS; const T = {...}; CS.puzzleTypes.<type> = T; })(typeof window !== 'undefined' ? window : globalThis);`
   Pure half first, `examples` second, page half last.
2. Its script tag on its placeholder line in `coachschool.html`.
3. `tools/coachschool-checks/pz-<type>.mjs` exporting `node(H)` and/or `browser(H)`:
   - `H = { CS, L, ctx, loadVm(extraFiles?), check(cond, label), near(a, b, eps), ROOT, PLATES, J, FILES }`;
     in `browser` also `open(viewport, { hash, reduced, storage, init })`, `plate(page, name)`,
     `settle(page, ms)`, `BASE`. Every check's label says what it proves; expected numbers are worked
     out in the test by hand from the fact sheet, not read back from the code under test.
   - Node: the checker's rule on hand-made answers (right, each kind of wrong, edge of tolerance),
     validate() flags a fixture with two right answers and one with a wrong stored answer,
     every outcome run is a legal play.
   - Browser: answer by real pointer input (`page.mouse`) through the page, at a zoom, and see the
     verdict; a plate of the type mid-puzzle and after a wrong answer, and LOOK at them.
4. Run `node tools/_verify-coachschool.mjs --only pz-<type>,contract` while working (this file's own
   node checks still run; its long Chrome battery does not), then the whole suite before you finish.
5. Prove your checks bite: break the checker (or the hook use), see your checks fail, restore.

**Conformance** (`tools/coachschool-checks/contract.mjs`) runs for every registered type with no
edit: the contract's members; every content puzzle and example validates, `truth()` is the stored
answer and passes, every distractor fails, answers survive JSON, `check()` is pure, `validate()`
reports a missing play; on the page, the puzzle goes up through `askPuzzle` (lesson and Game Day),
there is a way to answer, every panel control is focusable and at least 44x44 px, drag handles at
least 44 px, a wrong-then-right lesson answer and a wrong Game Day answer score as they should, the
explanation opens "Right." or "The answer: ...", the bubble points only at things on the field, the
play runs, and `destroy()` alone leaves no element, listener, overlay, drag or moved player behind.

## Per-type specs

Answer shapes are a proposal the type agent may refine, as long as the conformance check holds and the
report says what changed. Truth always comes from the fact sheet or the library, never from a
number made up in the type.

### route — drag a route onto a receiver to beat the shown coverage

- **Puzzle**: `{ id, type: 'route', play, receiver: 'Z', routes: ['hitch', 'corner', 'post', ...],
  prompt, tags, why, answer }`. The play's defense names its coverage (`DEFENSES[id].coverage`,
  e.g. `'cov:2'`).
- **Answer**: `{ id: 'Z', route: 'corner' }` (`id` is the receiver he dropped it on).
- **Checker = BEATS**: right when `id === pz.receiver` and the route beats the coverage per fact
  sheet 6 ("Basic beater routes"; concept rows via `L.BEATS`). `cs-lib.js` has no per-route table
  yet: keep `ROUTE_BEATS` in the type file, transcribed row by row with the section cited, and check
  it against the fact sheet in your module; the orchestrator moves it to the library at merge. A
  *contested* pairing is never the single right answer, and `validate` flags a puzzle where two
  offered routes both beat the coverage.
- **Interaction**: route chips in the panel (buttons, 44 px); pick one, then drag it (a `moves: false`
  handle with a rubber band, or tap-select then tap the receiver) onto a receiver. The chosen route
  shows as `overlay.path` from `CS.routeWaypoints`, anchored to him. "Lock it in" with `ctx.action`.
- **Wrong**: the failure plays out: `variantOf` with his route on that receiver and the ball thrown
  to him, so the defender the fact sheet names (the conflict defender, the squatting corner) is on it;
  then the right route runs and is caught.

### place — drag players to their alignments

- **Puzzle**: `{ id, type: 'place', play, move: ['RB'], at: { RB: { x, y } | 'landmark-name' },
  tol: 1, prompt, tags, why, answer }`. Targets come from the formation / defense in the library or
  zone landmarks (fact sheet 1, 4); `tol` in yards (default 1, never above 1.5).
- **Answer**: `{ RB: { x, y } }`, one position per moved man, yards.
- **Checker**: every man within `tol` yards (inclusive, `CS.snapTo` semantics) of his target; any
  other man listed, or one missing, is wrong.
- **Interaction**: `field.drag` with player handles; `snap` to the landmarks within `tol`; the men
  start somewhere neutral (`d.set` after mount) that is not already right. "Lock it in".
- **Wrong**: the play runs from where he put them (`variantOf` with the moved alignments, as far as
  the library lets a variant move a man; else a bubble on the misplaced man), then from the right
  alignment.

### assign — connect blockers to gaps / defenders

- **Puzzle**: `{ id, type: 'assign', play, blockers: ['LT', 'LG', 'C', 'RG', 'RT'], targets:
  ['B-gap-L', ..., 'MIKE'], prompt, tags, why, answer }`.
- **Answer**: `{ LT: 'B-gap-L', LG: 'A-gap-L', ... }`.
- **Checker**: a **bijection**: every blocker has exactly one target, no target is taken twice, and
  each pair matches the play's scheme (the run scheme's rules, fact sheet 7-8). `validate` flags a
  puzzle whose truth is not a bijection.
- **Interaction**: `overlay.gaps()` for the letters, `moves: false` drag handles on the blockers
  (rubber band), drop on a gap letter or a defender (`snapTo` over the gap points and the defenders'
  yards) and draw an `overlay.link`. A blocker can be re-connected; "Lock it in" once all are.
- **Wrong**: the failure plays out: the man left unblocked rushes free (`variantOf` with his rush
  through the open gap), then the right fits.

### call — situation card, pick the call or audible

- **Puzzle**: `{ id, type: 'call', play?, situation: { down, dist, yardline, quarter, clock, score,
  timeouts }, options: [{ t, v }], answer (index), prompt, tags, why, src }`.
- **Answer**: the option index (like `choice`).
- **Checker**: the option whose `v` the rule picks for the situation, from fact sheet 10 (clock,
  scoring, 4th-down and two-point principles; principles only, no invented numbers). `src` names the
  fact-sheet section. `validate` flags two options the rule accepts.
- **Interaction**: the situation card in the panel (down and distance, clock, score, timeouts, as
  text), options as buttons. The field shows the play (or the snap picture) if one is given.
- **Wrong**: the explanation says what the call costs; if a `play` is given it runs. No invented
  outcome.

### predict — freeze at the snap: where does the ball go

- **Puzzle**: `{ id, type: 'predict', play, prompt, tags, why, answer }` (the answer a receiver id).
- **Answer**: a player id (a field tap on an eligible receiver).
- **Checker**: `CS.compile(play).target` (the `throw` event's `to`). `validate` flags a play with no
  throw and a puzzle whose read is not decidable from the snap picture the fact sheet teaches
  (e.g. the coverage's hole for the concept, fact sheet 5-6).
- **Interaction**: mount runs the pre-snap picture into the snap with `field.freezeAtSnap` and holds
  there; then the question opens (tap a receiver, `onTap`). No answer is taken before the freeze.
- **Wrong**: the play runs from the snap as drawn (the ball goes where it goes); his pick gets a
  `bad` mark and the right man a `good` mark (`resolved` returns them).
