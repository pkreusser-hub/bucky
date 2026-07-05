# BUCKY — project notes for Claude

BUCKY is a static family web app (plain HTML/JS pages, no build step) deployed to
https://amenfarms.netlify.app via GitHub auto-deploy (push to `main` = live deploy —
never push without the user's preview approval unless pre-approved in the request).
Existing games: `pasturepanic.html`, `goatcare.html`. Each game page is fully
self-contained: its own `<script>`, its own render loop, no shared JS between pages.

---

# 🍅 Barnyard Bistro — co-op cooking game (ACTIVE PROJECT)

## Goal / feel
Overcooked-style **cooperative** cooking game for two young kids (2-player online
co-op, max 2). Two chefs share one farm kitchen and work together to prep and deliver
dishes before order timers run out. Co-op, never competitive. Bright, friendly,
blocky art style — simple colored box/cylinder three.js geometry for now; Meshy.ai
models may replace pieces later. Big, simple UI for young kids.

## Tech
- **Page**: `barnyardbistro.html` — its own dedicated page, self-contained render
  loop and (later) its own multiplayer connection. Must not interfere with other pages.
- **Rendering**: three.js r128 via CDN globals (same stack as pasturepanic.html).
- **Multiplayer (Stage 3)**: [Playroom Kit](https://joinplayroom.com) via CDN —
  lobby + shareable join link + shared state. **Host-authoritative**: the host runs
  order spawning, timers, and scoring; both players write their own chef's position/
  held item and send actions into shared state.
- **State discipline (from day one)**: ALL shared game state lives in one object —
  `G` — `{ chefs, stations, boardProgress, plates, orders, score, phase }`. Nothing
  gameplay-mutable outside `G`. Local-only concerns (camera, input, meshes, tweens)
  stay outside `G`. This makes the Playroom sync a thin layer later instead of a rewrite.

## Controls (identical for both players; each controls their own chef)
- Move: WASD **or** arrow keys.
- One action button: **Spacebar** — context-sensitive by facing + held item:
  grab from crate · hold-to-chop at the board (progress bar) · place onto plate ·
  deliver at the window · dump in trash.

## The kitchen (first slice)
Rectangular tiled floor, border of counters, stations on the edges:
| Station | Interaction |
|---|---|
| 🍅 Tomato crate | press action → hold a raw tomato |
| 🥬 Lettuce crate | press action → hold a raw lettuce |
| 🔪 Cutting board | with choppable item: place it, **hold** action to chop (progress bar) → chopped |
| 🍽 Plate station | place chopped ingredients onto a plate |
| 🪟 Serving window | deliver a completed plate → score |
| 🗑 Trash bin | discard whatever you're holding |

## Item states
- tomato: `raw → chopped`
- lettuce: `raw → chopped`
- plate: `empty → partial (some ingredients) → complete dish`
- Held item renders above/in front of the chef.

## Recipes
- **Chopped Salad** = chopped tomato + chopped lettuce on a plate → serving window.
(That's the only recipe in the first slice.)

## Orders & scoring (Stage 2)
Order queue across the top of the screen, each with a countdown. Correct delivery in
time: +points, happy effect. Timer expires: small point loss and a gentle
kid-friendly "Missed!" — never harsh.

## Build order (pause after each stage for the user to test)
1. **Single-player full loop**: one blocky chef, all stations, grab → chop → plate →
   deliver → score increments. ← *build this first*
2. Order queue + timers + win/lose feedback.
3. Playroom Kit: lobby/join link, second chef, synced positions/held items,
   host-authoritative shared state.
4. Polish: distinct chef colors, sound effects (chop/deliver/success), cheerful
   victory screen, Meshy models where they help.

## V2 — big content update (design locked 2026-07-04, user authorized full autonomy)

### Levels & recipes (each level = one new recipe + rising complexity, Overcooked-inspired)
| Lv | Name | Recipe | New mechanic taught |
|---|---|---|---|
| 1 | Salad Days | Chopped Salad = chop tomato + chop lettuce → plate | chop/plate/deliver/throw |
| 2 | Soup's On | Veggie Soup = chop tomato+onion+potato → pot on stove 8s → plate | cooking timers; >16s = overdone (trash it, gentle) |
| 3 | Burger Barn | Farm Burger = bun + patty (pan 6s) + chopped lettuce+tomato → plate | pan/grill + parallel prep |
| 4 | Pizza Night | Farm Pizza = dough + chopped tomato + grated cheese → assemble → oven 10s | assembly + bake |
| 5 | Feast Night | Mixed menu (salad/soup/burger/pizza random) + more customers | mastery; tightest tips |
Ingredients: tomato, lettuce, onion, potato, bun, patty, dough, cheese (8 crates).
Progression: earn ≥1 star to unlock the next level. Stars persist in localStorage (host's).

### Customers (replaces anonymous order queue — farm animals from assets/ reused as diners)
Queue forms OUTSIDE the top wall; walk to the wide 3-segment serving window. Flow:
1. Customer waits at the window's "order here" end → chef presses action there = take order
   (speech bubble shows dish, order card gains the customer's spot number).
2. Customer walks to numbered window spot 1/2/3 and waits (patience = order timer).
3. Deliver the plated dish at THAT customer's window segment → money + tip, customer
   hops happily and leaves. Timer out → customer leaves sad (gentle), small money loss.

### Throwing (new input: X or Shift on keyboard; second 🎯 button on touch)
Held INGREDIENTS only (raw/chopped — never plates/pots). Straight line, ~9 units:
- hits a chef holding nothing → caught into their hands
- hits an empty counter tile or the cutting board → lands there
- hits a full counter → bounces off, drops to the floor (floor items can be picked up)
- hits nothing → lands on the floor where it stops
Counter tiles are now generic one-item surfaces (place/take with action button) — required
for throw landings and Overcooked-style buffering.

### Money, tips, stars (replaces raw ⭐ score)
Dish base prices: salad 20 / soup 30 / burger 40 / pizza 50 🪙. Tip: up to +15 scaled by
delivery speed (full tip if delivered in the first third of patience, tapering to 0).
Miss: −10 (floored at 0). Day = 3:00 as today. End-of-day stars per level by money
thresholds (tuned via playtesting; stored per level).

### Dish washing
Plates are finite (3 in circulation per level). ~5s after a delivery the customer's dirty
plate appears at the dish-return slot; carry to the SINK, hold action to wash, place the
clean plate on the DISH TRAY (plating pulls from the tray). No clean plates = can't plate.

### Meshy asset manifest (v2)
- 3 rigged chefs (humanoid → Meshy rigging OK; walk/run bundled free; chop/throw/hold
  from the animation library or nearest readable equivalent): farmer chef (straw hat +
  apron), grandma chef (bun + glasses + apron), kid chef (small, big hat). Player picks
  a chef on the title screen (choice synced via player state).
- Props: wooden crate (one model, ingredient shown on top), 8 ingredient models,
  cutting board + knife, pan, pot, plate, trash can, sink, dish tray, stove/oven accent.
- Customers: REUSE existing assets/ animal GLBs (armadillo, turtle, goatchar, collie) — 0 credits.

### Title screen / polish
Proper intro: logo art ("BARNYARD BISTRO" barn-sign style), level-select cards with
earned stars, chef picker, joyful colors. Plus animation juice: run bob/lean, throw
wind-up + arc, chop arm swing, customer hops.

## DONE (2026-07-05): Baby Bucky goat rebuild — assets/babygoat.glb split into a
9-part articulated rig (4-means legs FL395/FR383/BL393/BR378 tris, head 1474 @ front
30% z with neck-base pivot + seam cover blob, tail 242; ears did NOT separate — head
micro-rotations carry the wiggle). Head tracking (yaw ±0.6, pitch +0.3/−0.7), diagonal
gait, suckle bob, happy hop wired to the pre-existing never-used "jump" state. Bottle
feeding = walk to bottle → stand still → feed; pauses + follows if bottle moves >0.6.
Fixed pre-existing bugs: hay-trough walk-reissue deadlock, head-pitch sign flip,
stale first-frame bottle position, raycastGround origin fallback. GLB legs: mesh
lives on the KNEE node (hip+knee compose); lie pose damped for rigid legs.
Original plan (for reference):
Complete restart on the goat model: Meshy-generated baby goat + a complex rig for all
needed movement. Constraint: Meshy's rigging endpoint is HUMANOID-ONLY (quadrupeds 422,
no charge) — attempt once to confirm, then build a programmatic quadruped skeleton
instead (SkinnedMesh: spine/neck/head/jaw/ears/tail/4 legs; region+k-means vertex
weights — the proven Pasture Panic leg-split + snake-spine techniques, unified).
Needed motions: walk/trot, head tracking (look at bottle/cursor), feeding pose, ear
wiggle, tail wag, sit/lie. Behavior change: bottle feeding = goat WALKS TO the bottle
and STOPS (stands still, head to bottle) while feeding — no more feeding-on-the-move.

## Current progress
- [x] Design doc (this file)
- [x] Stage 1 — single-player loop: `barnyardbistro.html` (842 lines). Full
      grab→chop→plate→deliver→score loop verified headless; G-state contract in
      place; shared geometries hoisted to module scope (leak-checked flat).
      Awaiting user play-test before Stage 2.
- [x] Stage 2 — orders & scoring: order cards top-center w/ draining timer bars
      (green→amber→red, wiggle when urgent), +10 ⭐ per delivery, −5 floored-at-0 +
      gentle toast on miss. All spawn/tick/score logic isolated in hostSim(dt) /
      hostDeliver() marked HOST-AUTHORITATIVE for Stage 3. Tuning: first order
      120s, then 95s; spawn every 30s; refill ≤1s when empty; max 3. Card motion
      uses CSS transitions (not @keyframes — those stall in headless Chrome).
      Awaiting user play-test before Stage 3.
- [x] Stage 3 — Playroom 2-player co-op: SDK pinned playroomkit@0.0.96 (UMD CDN).
      G.chefs keyed by Playroom player id ("local" placeholder for solo/fallback).
      Host runs the whole sim + publishes lean G snapshot at 12Hz (+instant on
      events); guest owns only its own chef position (published {x,z,dir}, host
      adopts) so movement is zero-lag; guest actions ship as incrementing actSeq
      (exactly-once) + holdingSpace bool. Blue chef = 1st seat, red = 2nd.
      insertCoin failure → solo fallback, never a blank page. Verified 2 real
      headless browsers on the live Playroom backend: synced movement both ways,
      guest full delivery → score 10 on both pages, disconnect cleanup clean.
      Known limitation: host tab closing ends the session for both players.
      Awaiting user play-test before Stage 4.
- [x] Stage 4 — polish: WebAudio-synth sounds (grab/place/chop ticks/deliver
      arpeggio/gentle miss/victory fanfare; no audio files; 🔊 mute persisted in
      localStorage['bb_muted']; sounds are render-layer reactions to G diffs, both
      players hear shared events). Timed 180s day (G.dayLeft in hostSim; no order
      spawns in final 20s) → synced "DAY COMPLETE" victory overlay w/ stats +
      host-only Play Again (hostResetDay). Touch controls on coarse-pointer
      devices: drag-anywhere joystick + big action button routed through the
      SAME input path as keyboard (localActionPress/touchHolding). Walk-bob,
      star particles, chop flecks, window flash. Gotchas learned: #hud
      pointer-events:none must be overridden for touch layer; two-tab MP tests
      freeze rAF in background tabs (use two browser processes); CSS @keyframes
      stall in headless Chrome (use transitions).
      Post-playtest fix: hidden-tab host froze the shared kitchen (rAF suspends →
      guest actions never consumed). Host sim now also ticks from a 250ms
      setInterval heartbeat while document.hidden (browsers throttle it to ~1Hz —
      chunky but alive; rAF owns ticking when visible). Guests joining via a #r=
      link get NO Playroom lobby — they auto-join straight into the game.
      GAME COMPLETE (first slice).
- [x] V2 content update (2026-07-05, ~5900 lines): counter surfaces + throwing
      (X/Shift/Q, catch/land/floor rules) · farm-animal customer queue with
      order-taking at the bell + numbered window spots + patience · money/tips
      (speed-scaled) + 1-3 star days (bb_stars) · pot/pan/oven cooking with
      gentle overdone · 5 levels (Salad Days→Feast Night) w/ per-level stations
      + star-gated select · 3-plate dish washing (return→sink→tray) · barn-sign
      title + per-player chef picker · Meshy assets integrated: 3 rigged chefs
      (6 GLBs each, clips Armature|walking_man/running/Charged_Axe_Chop/
      baseball_pitching/Idle |baselayer; anims loaded clips-only to dedupe
      textures; skeleton.dispose fix for boneTexture leak) + 17 props + animal
      customers from existing GLBs · bot-playtested balance (per-level patience/
      spawn/starMoney from measured runs; solo ≈ mid-2-star) · juice pass ·
      TIER-1: same-keyboard couch co-op (P1 WASD/Space/Q, P2 Arrows/Enter/
      RShift; local2 excluded from snapshots), Bucky wanders kitchen L3+
      (babygoat.glb, soft collider, station-clearance waypoints), delivery
      streaks (3/5/8/12 + customer wave), emotes (E / RCtrl / 💬).
      Verified vs REAL Playroom backend (guest auto-join, clock delta 0s).
      Known: agents' sandboxes often can't reach Playroom (DNS) — use the local
      fake-relay in scratchpad for MP tests; page.screenshot flaky w/ live
      Playroom (block the CDN → solo fallback for deterministic shots).
      Tier-2 backlog: zen/endless mode, daily-special modifiers, unlockable
      hats, farm-road progress map, host migration. Tier-3: photo share cards.
      COMMITTED LOCALLY — NOT PUSHED (user preview pending).
