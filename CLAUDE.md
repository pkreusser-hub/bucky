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
> **SUPERSEDED 2026-07-06** by the field-customer/LOB rework (see the progress entry at the
> bottom): no checkout window, no order-taking — customers stand in the field AROUND the
> kitchen and dishes are LOBBED out to them. Kept for history:

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

## Kitchen layout (2026-07-06): USER-DRAWN 10×16 GRID (user supplied a spreadsheet
screenshot; implemented directly on Fable 5 per the no-delegation directive).
Top wall: 5 dispenser tiles c3-c7 (kinds assigned per level from LEVELS[n].crates via
assignLevelDispensers; 3 extra tiles c8/c9/c2 activate only on Feast Night) — a
dispenser with kind:null is a plain counter. Left wall: sink r3, plate stack r14.
Right wall: stove r3, oven r5, CHECKOUT bell r7 + spots r8-r10 (VERTICAL window;
customers queue outside the RIGHT wall now: LANE_X 6.3, SERVE_X 5.75, queue extends
north, leavers exit south), dirty bin r14. Bottom: board c3, trash c4, board c5,
pan c7. Wash loop deliberately spans the kitchen (bin LR → sink UL → stack LL).
Camera: asymmetric frustum via camXShift (east side keeps the queue visible).
Follow-up (same day): the 3 Feast extras moved to the LEFT wall (z -3.5/-1.5/0.5,
one-tile gaps below the sink); trash stays between the boards. DESIGN INTENT
(user, verbatim spirit): the split wash/prep loop is deliberate — "players are
encouraged to split between top and bottom of the kitchen and throw items back
and forth"; throwing IS the game's identity, don't shorten these loops.
BABY BUCKY MODEL v2 (same day): assets/babygoat.glb replaced with the user's
Downloads/NewGoat.glb (UniRig auto-rig, 192k tris, 4×2048 PBR maps, 18.6MB) →
dieted to 1.29MB: skin/joints stripped (bones were unusable Bone_NNN, no anims),
normal/metallic/emissive maps dropped, meshopt simplify ratio 0.2 (38.5k tris —
ratio 0.07 destroyed the per-triangle texture atlas + face detail; DON'T go
below ~0.2 on per-face-atlas models), baseColor resized 2048→1024 via .NET
System.Drawing (sharp's native binding is BROKEN in this env — use PowerShell
Add-Type System.Drawing for image resizes), Y-180 rotation BAKED into the GLB
(model shipped facing -Z; game convention is +Z). Old model kept as
assets/babygoat-v1.glb. splitBabyGoat's clustering handled the new mesh
unchanged (legs FL/FR/BL/BR 4397/4622/3898/4140). Photo-mode verified
front/three4; walk + bottle-feed regression clean.

KEY TARGETING LESSON: distance-only resolution provably cannot disambiguate
corner-adjacent tiles (perpendicular wall's tile is ~0.2 closer than your own from a
square stand). Fixed with FACING-AWARE resolution: offAxisPenalty(+0.45 when >~70°
off the chef's forward axis) inside both argmins + pocket-gated cornerBonus.
STATION_BIAS stays 0.005. Verified: 0 station fails + 0 slot fails across all 5
levels; full order→cook→deliver flow on the right-wall window passes.

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
- [x] Playtest fix batch (2026-07-05): camera ~20% closer; held items 1.5x w/
      outline+shadow; ingredients 0.68-0.78; forgiving throw landing (nearest
      EMPTY surface within 0.9 — landing rate 25%→80%); catch radius 1.25;
      controls split into GRAB (Space/Enter/🖐) · WORK=chop/wash/STIR-pot-1.5x
      (C-F/RCtrl/🔪) · THROW (X-Shift/RShift/🎯) · emote (E/Period/💬);
      2 cutting boards (G.boards[]); dish tray beside sink; bubbles smaller +
      de-overlap sweep; dead-grab fixed (keys Set cleared on blur/visibility/
      pointercancel + reconnect actSeq replay guard).
- [x] FAMILY LOBBY system (2026-07-05): Playroom lobby UI gone (skipLobby:true;
      CAUTION: Playroom reads #r= hash itself in a DIFFERENT format and it
      beats the roomCode option — we parse+clear our #r=<code> hash BEFORE
      insertCoin and pass roomCode explicitly). Identity = localStorage
      choreUser everywhere. Firestore lobbies_<familyKey> registry (30s
      heartbeat, 90s liveness, 10min lazy TTL delete) → games.html shows live
      JOIN cards; notifs_<familyKey> lobby-invite docs → index.html bell with
      JOIN button (24h TTL); notify.mjs threads deep-link url (allowlisted) to
      FCM. Bistro title = family lobby: real-name chips, host-only Invite
      (profile-doc picker) + COOK!, guest sees "<host> is picking the day!".
      Solo/couch never touch Firestore; all lobby features degrade silently.
      Verified E2E vs real Playroom + real Firestore (test familyKey for
      automated writes; production cleaned/untouched).
- [x] Throwing v2 + plate rework (2026-07-05): USE_GLB_CHEFS=false (procedural
      chefs everywhere; GLB path kept); counters hold ANY item incl. plates;
      resolveStationOrSlot (nearest-with-bias, fixed station-shadowing);
      plate stack beside sink (plate station/tray gone); dirty bin right wall;
      throw→plate assembly, AIR MAIL dish delivery (+5, catch anim), trash
      swish, ±12° aim assist; chop-shake fixed (seeded PRNG — visuals were
      rebuilt per-frame w/ fresh Math.random); grass field + trees; window
      bars removed.
- [x] Overcooked-grid pass (2026-07-05): individual counter tiles, slots
      derived 1:1 from tiles (corner reachability = edge-distance + 0.2
      cornerBonus; STATION_BIAS 0.35→0.005 bug); every station exactly ONE
      tile; window tiles gray-blue; crate lid decals (canvas textures);
      recipe-of-day card; boards moved to bottom wall; type-aware throw bias
      (raw→board, chopped→plate/appliance, THROW_BIAS_TIE_R 1.2); floor
      pickup fallback at every empty-hands dead end + landing clearance.
- [x] Multi-carry + bounce batch (2026-07-05): CH 1.1→0.55 (waist-high);
      uniform tile color, inactive-station tiles = live slots (slotIsLive);
      decal-only crates; hold-stack ≤3 (LIFO, hold* helpers, ~135 call sites;
      plates/pizza/pots exclusive; dirty plates stack together); scoop onto
      held plate (board/pan/slot; pot soup special-case kept); dirty plates
      throwable (sink parks via G.sink.parked, bin swishes); bounce-and-travel
      throws (0.78 speed, ≤3 bounces, wall reflection, mid-flight catches);
      plated food floor-safe everywhere.
- [x] Mobile-first batch (2026-07-05): PORTRAIT kitchen 11×16 (stations
      rehomed; window+queue top, boards/trash/pan/sink/stack bottom, crates on
      side walls); fitCamera portrait branch (fixed hFOV ~46°, dist 48→~15 on
      phones; portrait width margin hugs kitchen +0.35); thumb-arc touch
      buttons w/ labels; progress bars 1.6x on dark plates; bounce-back
      self-catch (bounces≥1 only); hold-throw arc preview (simulateThrowPath =
      dry-run twin of advanceFlyingItems, anchor-exact); plates 1.35x;
      BANK SHOT +2 (bounced delivery). Known gap: AIR MAIL/BANK SHOT popups
      are host-only (lastDeliveryInfo not mirrored) — money syncs fine.
- [x] Desktop+reliability batch (2026-07-06): fitCamera landscape solved
      against camera's rotated basis (perspective foreshortening is
      ASYMMETRIC — old formula clipped the near wall 39% past NDC); dispenser
      v3 = plain box + lid picture; held-size delta removed; delivery
      reliability (aim-assist excludes plates/boards for completed dishes;
      findDeliveryWindowSpot defers seam judgment; heartbeat dt sub-stepped
      0.05s vs tunneling); stove+oven = floor-standing range w/ black pot
      (wallInwardDir); Invite feature REMOVED; lobby heartbeat 15s + delete
      after 60s hidden. App: allowance deterministic ids via backend.set
      (allowance_<kid>_<day>) + self-healing dupe sweep (repaired Eleanor
      +$6 over-mint); payoutPending WOs render in ACTIVE queue (amber,
      Dad-only buttons); games.html liveness 45s/3min + per-host dedupe.
- [x] FIELD-CUSTOMER + LOB rework (2026-07-06, user pivot): checkout window/
      bell/spots REMOVED entirely (stations, buildServingWindowRow,
      findDeliveryWindowSpot/findWindowSpotInPath, hostTakeOrder/
      hostDeliverAtSpot, bell/wrongSpot snapshot hints all gone). Customers
      now walk to random spots in the FIELD ring around the kitchen
      (randomFieldSpot, FIELD_BAND 1.0-1.9 outside walls, all 4 sides); order
      bubble over their head from arrival; states arriving→waiting→fetching→
      leaving. Delivery = LOB: new hold-to-aim input (P1 V · couch-P2 "/" ·
      touch 🏀 in the thumb arc; lobSeq exactly-once in MP, own "…lob"
      throwHolds keys) — high arc (per-point y in preview), sails OVER
      everything (no catches/boards/slots/bounces), flies exact lobRange.
      Aim assist: completed dish snaps dir+range onto nearest matching
      waiting customer within 0.6 rad. Landing ≤BULLSEYE_R 1.2 of matching
      waiter = instant catch +5 (BULLSEYE!, green preview ring); else rests
      exterior — nearest matching waiter within CLAIM_R 2.6 trots over
      (fetch → pay price+tip); unclaimed exterior dishes: crow takes them
      after 8s (plate returns dirty — plate economy never leaks). Emote
      button moved OFF the touch arc to top-right corner (LOB took its
      slot). Regular throws no longer deliver (kitchen-interior only).
      Fixed: stale custPrevQueuePos ref crashed rAF on first customer
      despawn; custPrevState overwritten before fetch-hop check. Verified
      headless: real-V bullseye (+40=20+15+5), claim/fetch (+35), crow TTL,
      0 pageerrors, desktop+mobile shots. Tip: full if served in first
      third of patience (unchanged core, now anchored on the customer).
- [x] BABY BUCKY v2 (2026-07-06, user pivot: "cut bait" on the 3D game):
      goatcare.html REWRITTEN 2504→950 lines as an LCD giga-pet (Tamagotchi
      shell, 96×64 pixel canvas upscaled w/ scanline overlay, zero image
      files — goat sprites PROCEDURALLY built per stage/pose/frame from
      proportion tables). Stages by real elapsed time: EGG 10min → BABY 2d →
      KID 5d → YOUNG 9d → ADULT (horn nubs→horns→beard; stage-up fanfare
      once via seenStage). Meters hunger/happy/clean/energy decay per real
      hour (sleep ×0.3 + energy regen; night 21:00-07:00 ×0.35); poop max 3;
      sick (rain cloud + 💊) only from LIVE neglect — offline gaps >30min are
      KINDNESS-CAPPED (meters floored at 1, energy 2.5, ≤1 poop, never sick,
      no death path at all). FEED/PLAY(3-arrow mini-game)/CLEAN/LIGHTS +
      medicine. State in localStorage bb2State (old goatCareState abandoned);
      mute persists. Agent-verified 51 checks + independently gated (fresh
      adopt→egg, all buttons, 375×812 zero scroll, 0 pageerrors). Old 3D
      goat assets (babygoat.glb etc.) remain on disk, now unreferenced.
- [x] LOB playtest-fix arc (2026-07-06, 4 batches from live user playtests):
      (1) claim RACE (every matching waiter within CLAIM_R 6.5 sprints, first
      to arrive wins, losers resume waiting), crow TTL 5s (frozen while
      anyone is racing), instant lob preview (no 0.25s threshold for "…lob"
      holds; ring 3x, per-point-y arc dots 1.9x), equal 64px touch buttons,
      raw patty = pink puck (rawPattyM; patty.glb read as pre-cooked).
      (2) touch buttons → 2×2 corner grid (GRAB/WORK bottom, THROW/LOB top;
      grid top edge verified below the kitchen's projected bottom wall).
      (3) ADAPTIVE LOB RANGE (lobExitRange: fly just past the wall in the
      facing dir + LOB_LAND_PAD 1.45) — fixed ranges provably failed BOTH
      ways: 13 overshot past CLAIM_R (crow ate every miss), 6.5 landed
      INSIDE the 16-deep kitchen (claims/crow correctly ignore interior
      items) while READING as "landed on the customer" from the camera.
      (4) DERIVED DISH ID (user screenshot: scooped salad ignored):
      plate.dish was only stamped on stack/slot PICKUP — scooping onto a
      held plate left dish=null → invisible to assist/bullseye/claims/crow.
      dishIdOf now derives via matchAnyRecipe(contents), scoop/add sites
      stamp eagerly, crow TTL covers ALL exterior floor items. Verified
      with the user's exact scoop flow + real V lob: animal walked 5
      samples to the plate, +35. LESSON: playtest-verify each ASSEMBLY
      PATH (stack pickup vs scoop vs counter-add), not just one.
      BABY BUCKY SNES ART PASS (same day, user pivot "SMW-level graphics"):
      same 96×64 grid + sprite geometry, monochrome LCD palette → 13-color
      PAL + outlined() auto-trace (pad 1px, warm-dark index 8 around every
      sprite — the 16-bit look without redrawing builders); layered SMW
      backdrop (two-band sky, drifting clouds, drawHill semicircles,
      scalloped grass, dirt; night = stars + yellow moon, keyed to LIGHTS);
      Yoshi-spotted filled egg; colored meters on dark HUD band; toast =
      dark chip; lcdGrid overlay deleted. Idle WANDER: render-local
      wanderX/Target, ±20px strolls every 3.5-10s while idle+awake,
      drawGridFlip mirrors when walking left. GROW test chip removed
      (goatcare has NO test hook; stage-jump testing = rewrite bb2State
      birthTs + Storage.prototype.setItem no-op to beat the pagehide
      re-save, then reload).
