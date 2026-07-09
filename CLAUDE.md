# BUCKY — project notes for Claude

BUCKY is a static family web app (plain HTML/JS pages, no build step) deployed to
https://amenfarms.netlify.app via GitHub auto-deploy (push to `main` = live deploy —
never push without the user's preview approval unless pre-approved in the request).
Existing games: `pasturepanic.html`, `goatcare.html`. Each game page is fully
self-contained: its own `<script>`, its own render loop, no shared JS between pages.

---

# 🗺 Farm3D — real-terrain 3D map of the actual farm (2026-07-06)

`farm3d.html` — interactive 3D viewer of the real property (727 Co Rd 80, Woodville AL;
geocoded 34.686537,-86.210417, ground elev ~201 m). UNTRACKED pending user preview.
- **Data** (baked into `assets/farm3d/`): Esri World Imagery — 5 km context z16
  (`sat_ctx.jpg` 2048²) + 1.26 km core z19 (`sat_core.jpg` 4096²); USGS 3DEP via AWS
  terrarium z15 → `height_terrarium.png` (1536², lossless; elev = R*256+G+B/256−32768,
  page subtracts farm-center E0). In-page `GEO` block = exact tile-grid mercator bounds.
  Scene units meters: +X east, +Z south. Download/stitch pipeline (tiles.mjs,
  stitch_sat.ps1, stitch_ter.mjs) lives in the session scratchpad — rerun to refresh.
- **Coordinates**: everything hand-placed in `sat_core.jpg` 4096-px coords via `P(px,py)`
  (0.307 m/px). `placeAt(g,px,py,rot,sink,r)` seats objects on the MIN terrain height
  sampled over footprint radius r — the anti-float-on-slope rule; pads (pool deck,
  basketball) are thick buried boxes instead.
- **Why 3D models**: the Esri drape predates the family's 2022-23 buildout, so the
  current farm is modeled on top: house/brick porch, pool + black fence ON the deck +
  pavilion + gambrel shed, green-roof shop + hoop pad + arbor, white barn, green cabin,
  pond (water/fountain/dock/shed), garden (white net fence, beds, hooped bed, stone
  rings, coop+run, greenhouse, tan shed), goat pen (red barn, shade sails, 3 goats),
  PIRATE SHIP (sail/flag/wheel), swing set, fire pit, picnic, trees.
- **Photo pins**: 9 family photos in `assets/farm3d/photos/` (EXIF GPS was stripped →
  hand-placed), polaroid sprites w/ distance-adaptive scale, click = lightbox.
- **Photo mode**: `?photo=1&view=home|far|yard|top` (or custom `px/py/dist/az/el`) sets
  `window.__photoReady` — `tools/photobooth.js --url` works on this page (that's the
  ONLY way to screenshot it in-session: the Launch preview tab is `document.hidden`, so
  rAF/WebGL never paint there). Interaction smoke test: scratchpad farm3d_interact.mjs
  (13 checks). Not linked from games.html yet.

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
- [x] CO-OP DESIGN PASS (2026-07-06, user design directive — "the fun of the
      game is tossing items back and forth between two players and lobbing
      finished items over the wall"):
      FREE-FORM LOB: aim assist REMOVED entirely (skill throws — land near a
      customer and watch them run). Distance = player-charged: tap = minimum
      (lobExitRange, just over the wall in the facing dir); holding charges
      +LOB_CHARGE_RATE 3.2/s up to LOB_CHARGE_MAX_T 1.5s (~+4.8); the preview
      ring slides outward live. Charge plumbing: endThrowHold passes
      heldSeconds to fireFn; guest publishes "lobCharge" alongside lobSeq
      (same input tick, read together in hostApplyRemoteInputs).
      SPLIT-ZONE LAYOUT: TOP = supply + big cooking (5 top-wall dispensers,
      3 Feast extras left wall z -5.5/-3.5/-1.5, stove -5.5 + oven -3.5 +
      dirtyBin -1.5 right wall); BOTTOM = prep + finish (boards/trash/pan
      bottom wall, sink left z 3.5, plateStack left z 5.5). Every recipe
      crosses the midline: raw veg down, soup veg/patties/plates up or down,
      dirty plates return TOP and get thrown down to the sink. L5 station
      self-resolution sweep: 0 fails.
      CO-OP BARRIER: with 2 chefs in G.chefs (MP guest or couch local2) a
      hay-bale fence spans z=0 (BARRIER_Z_HALF 0.5) — moveChef clamps each
      chef to the side they're on (side judged pre-move); throws and lobs
      sail over untouched; solo = no fence (the "1-player layout").
      Deterministic from G.chefs — zero new synced state. Seat 0/P1 spawns
      bottom (z 2.2), seat 1/couch-P2 spawns top (z -2.2). Fence visual =
      9 hay bales, deterministic jitter, visibility synced per frame.
      Verified headless: charge +3.8 over tap; no assist (aimed-at-customer
      tap = adaptive exit range, NOT snapped); both chefs blocked at ±0.92;
      FULL split flow (P2 top: grab+throw tomato/lettuce over the fence —
      tomato landed straight on a board via throw bias; P1 bottom: chop,
      plate, tap-lob → BULLSEYE +40). 0 pageerrors.
- [x] USER-DRAWN CO-OP GRID v2 (2026-07-06, second drawn layout, supersedes
      the first grid + the co-op-pass station shuffle): every ingredient has
      a FIXED crate (assignLevelDispensers/dispSlot DELETED; activation =
      crateVisibleThisLevel alone). Mapping c→x=c-5.5, r→z=r-8.5.
      TOP: lettuce c3 · onion c5 · board c7 · SINK c8 (top wall); patty r3 ·
      stove r5 · oven r7 (left); dough r3 · trash r6 (right).
      BOTTOM: board c3 · potato c5 · tomato c7 · DIRTY BIN c8 · pan c9
      (bottom wall); plates r12 · bun r14 (left); trash r10 · cheese r14
      (right). Oven/pan placements + TWO trash cans (one per zone)
      user-confirmed ("confirm both"). Wash = vertical relay: dirty plates
      land BOTTOM, thrown UP over the fence to the top sink (parks), washed,
      thrown back DOWN to the stack. TRASH_STATION_IDS loop replaces the
      single stationById("trashBin") in flight + preview. Verified: 18/18
      L5 self-resolution, both bins swish thrown items, full cross-fence
      salad (P2 chops lettuce TOP + throws chopped down; P1 chops tomato
      BOTTOM, plates, tap-lob +40), dirty-plate throw parks at the top
      sink. 0 pageerrors.
- [x] LEVEL EDITOR (2026-07-06, user-requested): leveleditor.html — click-a-
      piece, click-a-wall-tile editor on the 10×16 grid (18-piece set: 8
      crates, 2 boards, sink/dirtyBin/plateStack/stove/oven/pan, 1-2 trash;
      2nd trash optional, everything else required; live validation).
      Saves to localStorage["bb_layout_v1"] as [{type,kind?,c,r}]. Game:
      stationsFromLayout() at BOOT (strict validation, silent fallback to
      the default on anything invalid — a bad save can never brick);
      canonical station IDS preserved so all game code is untouched;
      TRASH_STATION_IDS derived from the live list (1-2 bins). MP: host
      snapshot carries layoutSig ("default"|raw JSON); mismatched guest
      adopts to localStorage + reloads ONCE (sessionStorage guard,
      #r= room hash re-set so the reload auto-rejoins). NOT linked from
      games.html (dad's tool, direct URL). Verified: editor move+save,
      game boots edited layout (0 L5 sweep fails), corrupt+invalid fall
      back, one-trash layout boots clean. Editor's DEFAULT_LAYOUT const
      must be kept in sync with the game's default station list.
- [x] CLEANUP BATCH + ENDLESS MODE (2026-07-06): sink/stove/oven now
      REPLACE their counter tile (tile builder skips those types; appliance
      bodies are counter-sized — buildApplianceBody bodyH = CH-feet; sink =
      floor-to-CH porcelain cabinet w/ recessed basin + wall-side faucet).
      Multi-carry stack COMICALLY TALL (STACK_RISE 0.16→0.5 + wobble).
      LOB = FIXED DISTANCE (LOB_FIXED_RANGE 8; adaptive range + charging
      REMOVED — chargeT params remain in the plumbing but are ignored;
      positioning your feet is the aim skill; preview unchanged).
      ENDLESS RUSH (LEVELS[5], id 6, always unlocked, 🏆-best card from
      localStorage bb_endless_best): no countdown (dayLeft 999999 so old
      guards never trip; G.runT counts UP, synced, HUD shows "♾ m:ss");
      spawn gap endlessSpawnInterval = max(2.5, 18*0.5^(runT/90)), cap
      endlessMaxWaiting = min(8, 3+floor(runT/45)); ONE missed order →
      phase day_end w/ "THE RUSH GOT YOU! 🐔" + survived time + best-money
      save (stars hidden/skipped). Verified: lob 8.0 from 3 poses w/
      charge arg ignored; endless card unlocked sans stars; interval
      18→4.5@3min; clock counts up; staged miss → game over + best 45
      persisted (55 − 10 miss penalty, correct). 0 pageerrors.
- [x] PER-LEVEL KITCHENS + ENDLESS VARIANTS (2026-07-06): the kitchen is
      now REBUILDABLE — rebuildKitchenForLevel(levelId) swaps G.stations
      (from localStorage bb_layouts_v2 = {levelId: entries} else
      DEFAULT_LAYOUT_ENTRIES, the single source of truth mirrored in the
      editor), refreshes tile→station mapping + counter slots (tile grid
      is static so slot array length/order — and the MP slot wire format —
      never change), and rebuildStationVisuals() tears down + re-runs all
      station builders. Called from hostStartLevel AND the guest's
      applySnapshot level change. MP layout sync: snapshot carries a djb2
      HASH (layoutsHash); the FULL map publishes once as room state
      "layoutsV2"; mismatched guest adopts + reloads once. ENDLESS is now
      a VARIANT of every level (LEVELS Endless entry deleted): purple
      "♾️ ENDLESS" chip on each unlocked card (chip needs explicit
      display:"block" — "" falls back to the CSS base display:none, and
      el.click() works on hidden elements so the headless assert had been
      a false positive until a SCREENSHOT caught it), G.endlessMode synced,
      per-level bests in bb_endless_best_v2={levelId:money}, chip shows
      "· 🏆N". Inactive stove/oven tiles render as plain countertops
      (syncApplianceTileVisibility per rebuild; sink always active so
      always replaced). Plate contrast: plateStack mat = slate blue
      0x33475c, dirtyBin mat = dark brown 0x4a3a30. EDITOR: per-level tabs
      (in-memory edits map so tab switches keep work; SAVE persists every
      COMPLETE tab at once, default-equal levels omitted; ● dot = custom).
      Verified: editor L2 sink move saves map {2} only; game boots L1
      default → L2 custom → L1 default (rebuild both ways); L1 shows
      stove/oven countertops, L4 hides; ♾️ chip run → "RUSH GOT YOU" +
      {"1":23} + chip trophy. 0 pageerrors. NOTE: inactive stations
      resolving to "slot" in sweeps is CORRECT (their tiles are usable
      counters by design).
- [x] ROGUE-LIKE ENDLESS + balance batch (2026-07-06): L1 spawnFactor
      1.5→0.85 / patience 90 (3-star 300 was unreachable); L3 easier
      (spawnFactor 1.2, patience 85, 3-star 180). TRASH accepts only
      PLACED items (thrown-swish removed from flight + preview). Bucky
      tinted brown 0x8a5c36 (per-instance material clones). ENDLESS
      ROGUE-LIKE: money = XP, thresholds xpNeededFor(n)=25n(n+3)/2
      (50/125/225/…); level-up FREEZES the whole sim (G.upgradeChoice
      guard at top of hostSim = built-in breather) + 3-card overlay
      (host picks via hostPickUpgrade, guests see options + waiting
      note; synced xpLevel/upgrades/upgradeChoice + customers.munchT).
      Pool of 11 (one copy each/run): split (Double Delivery — 2nd
      matching customer served free, MUST also match state "fetching"
      because the claim race converts nearby waiters instantly; no 2nd
      dirty plate via completeDelivery's skipPlateReturn param), speed
      (moveChef 5→6.4), chop ×1.5, wash ×2, cook ×1.35 (dt-scaled in
      advanceCookingStations — overdone windows also faster, intended),
      tips ×1.5, patience ×1.25, snack (raw ingredient lobbed near a
      waiting customer → munchT 6s pauses patience, bubble 😋), magnet
      (walk-over 0.62→1.35), plate (+1 clean, one-time), scarecrow
      (crow TTL ×2). HUD: endless clock shows \" · ⬆N\". Verified: freeze
      (runT+patience static 1.5s), pick applies + speed measured
      2.54→3.25/0.5s, snack munch freeze + 😋, split serves 2 from one
      dish (+65). 0 pageerrors.
- [x] CLEANUP PASS 2 (2026-07-06, then pushed): 🚪 EXIT button bottom-left
      (in-game only, two-tap confirm "SURE?" 2.5s, reload w/o hash → title;
      host exit ends the shared session as ever). SINK parks up to
      SINK_PARK_MAX=3 dirty plates (G.sink.parked is a COUNT now — place
      by hand via tryAction or thrown landings; full → wobble/no-park;
      washes consume parked first, one per scrub; stacked askew visual +
      count badge). Cutting boards CENTERED on their tile (the old
      +0.35/+0.28 inward offsets removed from board/itemGroup/bar/flecks;
      knife block keeps a wall-side offset). Verified: exit flow round-
      trip, park 3 → 4th refused → thrown-at-full bounced back → 3 washes
      → +3 clean. 0 pageerrors.
- [x] CLOUD LAYOUT SYNC (2026-07-06, user: "editor save overrides the
      default on all devices"): layouts map also lives in Firestore
      (settings_<familyKey>/bistroLayouts, field layouts = JSON string or
      "default"). Editor: loads cloud copy before first render (3s
      timeout), SAVE writes localStorage + setDoc ("Saved to ALL devices"
      / honest offline fallback note). Game: boots from localStorage
      instantly, background getDoc reconciles (updates cache; rebuilds the
      kitchen on the spot if still on title/level-select, else applies at
      next level start; MP layoutsHash updates live so guests adopt).
      ?fam= URL param on both pages = dev/test family override (verified
      vs REAL Firestore w/ scratch famtest key + fresh browser context as
      "device 2"; doc deleted after). NOTE: bistro3p.html (Minecraft-style
      3P camera + tank-controls experiment) exists UNTRACKED/local-only —
      deliberately never committed.
- [x] ZOOMED ISO FOLLOW CAMERA (2026-07-06, testers rejected the live 3P
      mode): the third-person camera + tank controls are REMOVED from
      barnyardbistro.html (driveMyChef/tankMove/FOLLOW/bb_cam3p all gone;
      both frame() movement sites back to classic screen-relative
      moveChef). Replacement: same 55° isometric view but ZOOMED
      (ISO_FOLLOW_ZOOM 0.62 × the fitCamera fit distance) and PANNING
      after your own chef — fitCamera stores its fit in camFit
      {dist,camXShift,vFovDeg,angle,sceneHalfW,sceneHalfD}; per-frame
      updateIsoFollowCamera lerps a clamped target (clamp extent =
      halfExtent×(1−zoom) around camXShift, so the zoomed window never
      shows past what the full fit frames; lerp min(1,dt*5)). 🎥 button
      is now 🔍 FOLLOW / 🗺 TOP, persisted in localStorage bb_camfollow
      (NEW key, default ON — bb_cam3p may hold stale tester opt-outs).
      Follow is skipped on title/couch (couch = both chefs, one screen)
      and toggling off snaps straight back via fitCamera(). Verified
      headless: dist ratio 0.62 exact, W = screen-north regardless of
      facing, camera pans then clamps at maxCamX while the chef keeps
      going, toggle round-trip persists, couch forces overview + hides
      the button. 0 pageerrors.
- [x] STEAMPUNK CHEF "TINKER" (2026-07-06, user's Meshy model from Downloads):
      Meshy_AI_Adventurous_Steampunk_*.glb had NO rig (raw texture-stage
      export, 595k tris) and wasn't in the API account's task list (made in
      the web workspace) — so: local diet (meshopt simplify 0.3 → 178k tris
      under the rig endpoint's 300k-face cap, tex 1024 JPEG, normal/metallic
      dropped) → uploaded as a data: model_url to /openapi/v1/rigging
      (height 1.3, 5 credits; walk+run FREE with the rig) → 3 animate calls
      idle=0 / Charged_Axe_Chop=237 / baseball_pitching=393 (9 credits;
      action IDs from docs.meshy.ai/en/api/animation-library). Final diet:
      base chef-steampunk.glb 2.0MB (simplify 0.2 → 35.7k tris, 24 bones);
      the 5 anim GLBs are MESH-LESS (nodes+clips only, 27-112KB each —
      PropertyBinding binds tracks by node name against the base clone, so
      the game's clips-only loader doesn't need the mesh; whole chef 2.3MB
      vs farmer's 12.4MB). Game: USE_GLB_CHEFS replaced by per-model
      GLB_CHEF_IDS=["steampunk"] (farmer/grandma/kid stay procedural),
      4th picker card ⚙️ Tinker, chefModelFor fallback look. GOTCHAS:
      Meshy rig output ships metallicFactor 1 + NO MR texture → renders
      near-BLACK under the kitchen lights (set 0); loadChefTemplate now
      swaps all GLB-chef materials to MeshLambertMaterial (skinning:true
      REQUIRED in r128 or the skinned mesh freezes in bind pose); base
      texture rebaked +18% brightness (her palette is darker than the toon
      props); camera framing in tests must use bone world positions (the
      0.01-armature Box3 gotcha). Verified in-game headless: picker →
      GLB-backed visual, idle/run/chop(progress)/throw states via real
      keys, carry pose (arm bones forward, held mesh at chest), farmer
      template absent. 0 pageerrors. Rig task id (reusable for more clips):
      019f3a43-924f-71d1-9877-bdec6a56bb7c.

---

# 🌾 FarmGPT — family AI: story time + research (2026-07-07)

farmgpt.html + netlify/functions/farmgpt.mjs. PER-MODE MODEL (2026-07-08): STORY + its
background SUMMARY run on Anthropic claude-haiku-4-5 ($1/$5 MTok); RESEARCH stays on
claude-sonnet-5 ($3/$15, stronger homework/coding). STORY_PROVIDER env = "haiku" (default) |
"gemini" | "sonnet" flips story without a code change (resolves provider+model near the
upstream fetch; RESEARCH_MODEL/STORY_MODEL/GEMINI_MODEL consts). WHY HAIKU over the earlier
Gemini plan: the Gemini 2.5 Flash FREE tier turned out to be capped at ~20 requests/DAY on
this project (quotaId GenerateRequestsPerDayPerProjectPerModel-FreeTier=20 — the free tier is
unusable for a family story app; gemini-2.0-flash's free quota also reads 0, only 2.5-flash
had any). Haiku wins on: reuses the existing ANTHROPIC_API_KEY + Anthropic request/SSE path
(no new vendor/key), no rate-limit cliff, reliable ===CHOICES===/===CHAPTER===/guardrail
adherence (Claude family), ~pennies (still ~4x Gemini-paid but negligible at family volume —
cost + Gemini's bigger context are both non-factors here since the summary system keeps every
request tiny). 3-way quality test (Haiku vs Sonnet vs Gemini 2.5 Flash on the exact prompt):
Haiku ≈ Gemini for kids' chapters, both a notch below Sonnet. HAIKU QUIRK fixed: Haiku added a
Markdown "# Title" heading → STORY_SYSTEM now says "write plain story prose only, no Markdown,
titles come only from ===CHAPTER===". The GEMINI PATH is still in the function (kept for the
STORY_PROVIDER=gemini escape hatch): :streamGenerateContent?alt=sse, system_instruction +
user/model contents + thinkingBudget 0, toGeminiContent() maps messages; GOTCHA — Gemini SSE
delimits events with CRLF (\r\n\r\n) vs Anthropic's bare LF, so the hand-parser strips all raw
\r; Gemini refusals (finishReason SAFETY/RECITATION/OTHER or promptFeedback.blockReason) map
to the shared "refusal" stand-in; GEMINI_API_KEY only needed when STORY_PROVIDER=gemini.
Usage dashboard prices story/summary at Haiku ($1/$5) and research at Sonnet ($3/$15) w/ cache
(1.25x write / 0.1x read). Verified in-process vs REAL Haiku+Sonnet: story→Haiku (===CHAPTER===
title, exactly-3 ===CHOICES===, no Markdown heading), close→===CHAPTER END===, summary
continuity, research→Sonnet. GEMINI_BASE_URL env override exists for fake-server tests.
- SLOW-BURN PACING (2026-07-08): STORY_SYSTEM rewritten to fix "world ends by sentence 3" — new
  PACING & TONE section (start small in ordinary life, build stakes slowly over many chapters, one
  thread at a time, no world-ending stakes early, calm moments valued); choices reframed from
  "genuinely different directions" → "natural next steps that fit the moment"; intro dropped the
  "exciting" pressure. Verified on the Star Trek scenario: 3 chapters stayed grounded (a flickering
  conduit), zero chaos words.
- CHAPTER SYSTEM + shelving (2026-07-08): stories are now an endless serialized NOVEL told in
  young-adult-length CHAPTERS (the ===THE END===/finish button is GONE; END_MARK kept only so
  legacy finished stories still resume). Each assistant reply is a "scene" ending in ===CHOICES===
  as before; the CLIENT tracks words in the open chapter (CHAPTER_TARGET_WORDS=1600) and, once over,
  sends endChapter:true so the next scene CLOSES the chapter with ===CHAPTER END=== (no choices) →
  UI shows "Read the next chapter →" / "📚 Shelve for now". Shelve saves to the existing bookshelf;
  resume rebuilds chapter dividers + restores the chapter-end prompt. "Next chapter" pushes a
  NEXT_CHAPTER_MSG sentinel (never rendered as a picked choice) with newChapter:true → model opens
  a ===CHAPTER=== <title> scene and MAY switch POV (multi-protagonist saga). New markers CHAPTER_MARK
  / CHAPTER_END_MARK; parseChapter returns {title, chapterEnd}; story.chapter + story.closing (latch)
  persisted. KEY LESSON: a CLOSE-chapter directive placed in the SYSTEM prompt loses to the base
  "end EVERY scene with ===CHOICES===" rule — Gemini kept emitting choices. FIX: the server injects
  the new/close directive onto the LAST USER TURN (models follow the immediate user instruction far
  more reliably); confirmed live (===CHAPTER END=== with a gentle close). The client latches
  story.closing so it keeps asking until the model complies. Tunable: CHAPTER_TARGET_WORDS. Verified:
  25/25 headless UI checks (divider, threshold→close, chapter-end UI, shelve, resume incl. chapter-end
  state, next-chapter POV, sentinel not shown, 0 pageerrors) + both directives live on real Gemini.
- ARCHITECTURE: static page → POST /.netlify/functions/farmgpt {secret, mode, messages}
  → function stamps the per-mode GUARDRAIL SYSTEM PROMPT server-side (browser can never
  override), streams the model's text back as plain chunks. Zero-dependency raw fetch +
  hand-parsed SSE (house convention, same as notify.mjs). Secret = the existing
  BUCKY_NOTIFY_SECRET / FAMILY_PASSWORD pair; NEW Netlify env var required:
  ANTHROPIC_API_KEY (function 500s with a clear message until set).
  ANTHROPIC_BASE_URL env override exists for testing against a fake server.
- GUARDRAILS (user spec, both modes share FAMILY_RULES): no swearing / graphic violence /
  sexual content; combat non-detailed ("he slew the dragon"), deaths OK but gentle;
  nothing political; nothing on gender identity / sexual orientation; restricted topics →
  story redirects in-story without lecturing, research suggests asking a parent/teacher.
- STORY MODE: first message = world+situation (setup screen w/ example chips); model must
  end every chapter with ===CHOICES=== + exactly 3 numbered choices (client parses into
  buttons; marker hidden during stream incl. partial-marker trim). Write-in input always
  available. thinking disabled (speed), max_tokens 1200. Bookshelf: localStorage
  farmgpt_stories_v1 (20 cap, resume/delete; resume with trailing user turn auto-continues).
- ENDLESS STORIES (2026-07-08, PUSHED ba3183d; top user complaint was the arbitrary
  ~8-15-chapter auto-ending). Two root causes fixed: the prompt told the model to "build toward
  an ending after 8-15 chapters", AND KEEP_TAIL_STORY=16 deleted the story's MIDDLE
  (head(2)+tail(16)) so it forgot the arc and wrapped up. TWO independent parts:
  (A) ENDINGS: prompt now says the story NEVER self-ends — always 3 fresh choices — and only
  writes ===THE END=== when the reader asks to finish. Kid-facing '🌙 Finish the story' button
  (#finishBtn, appears at ≥3 chapters, confirm → pushes a "wrap up now" user turn → finale).
  (B) MEMORY / FLAT COST via a DEDICATED SUMMARY CALL. NOTE: the first attempt (commit 6e63d6a)
  had the CHAPTER model emit an inline ===RECAP=== marker each turn — real-API testing showed it
  complied only ~HALF the time (stochastic, not caused by the recap-stripping; A/B-confirmed
  live), so story.recap often never set. REPLACED with MODES.summary (SUMMARY_SYSTEM, maxTokens
  400, thinking off) — a tiny single-purpose call whose only job is to compress the story so far
  into ≤180-word continuity notes, which it does reliably. Client: buildSendMessages() sends
  world-setup + story.recap folded into the head user turn as a "STORY SO FAR" note + last
  SEND_CHAPTERS=4 chapters verbatim (strippedForSend drops only ===ART===; windows once >4
  assistant msgs & a recap exists, else sends full). maybeSummarize() runs in the BACKGROUND
  after each chapter, folding new chapters into story.recap every SUMMARIZE_EVERY=3 (4≥3 so
  nothing leaves the verbatim window un-summarized); wrapped in try/catch — a failed summary
  keeps the prior note and never disrupts the story. story.recap + story.summarizedIdx persisted
  in the bookshelf. Per-chapter cost FLAT regardless of length (~9-msg sends at ch.9 or ch.90);
  summary calls add ~15-20%, bucketed under story ("s") in the usage dashboard. Server prompt has
  a CONTINUITY clause telling the model to treat the "STORY SO FAR" note as true past events.
  Verified vs the REAL API post-deploy: 6 chapters + 2 summary calls, coherent memory note
  stored, no auto-end, finish→THE END, no marker leak, 0 pageerrors. Tunable: SEND_CHAPTERS
  (verbatim depth), SUMMARIZE_EVERY (summary cadence).
- USAGE TRACKING v2 (2026-07-08): (1) summary calls now log to their OWN field prefix "u"
  (u_in/u_out/u_req/u_cw/u_cr) instead of being bucketed under story "s" — chapter vs recap cost
  is now separable; logUsage key = story→s, summary→u, research→r. (2) HOURLY granularity: every
  logUsage commit now increments BOTH the daily doc (farmgpt_usage/<date>) AND an hourly doc
  (farmgpt_usage_hourly/<YYYY-MM-DD-HH> Central via farmHour()) in ONE :commit (two writes, one
  network call). readCollection() shared mapper (usageRow) reads s/u/r × in/out/req/cw/cr;
  readHourly caps at 72 rows. mode:stats now returns {days, hours}. Dashboard: 3-way split
  (📖 Story chapters / 📝 Story recaps / 🔬 Research), rowCost() counts all three, daily table
  gained a 📝 column, new "🕐 Recent hours" table. NOTE hourly docs accumulate ~24/day forever
  (no TTL yet — fine for now, revisit if the collection grows huge). Old day docs pre-v2 read
  u_*=0 (summary cost is retro-mixed into their s_*, unavoidable).
- STORY TRANSCRIPT EXPORT (2026-07-08): '⬇ Export all' button on the bookshelf header
  (renderBookshelf) → exportStories() downloads a readable .txt of ALL saved stories on THIS
  device (storyToText strips ===CHOICES/RECAP/ART=== and the private recap notes; shows [The
  world], chapter prose, '➤ (You chose) …', '*** THE END ***'). IMPORTANT REALITY: stories live
  ONLY in per-device localStorage farmgpt_stories_v1 — there is NO server-side story store, so
  transcripts can't be pulled centrally/server-side; each device exports its own. Verified
  headless (createObjectURL hook): 2 stories, titles/world/chapters/choices/THE END present, no
  markers or recap notes leaked, 0 pageerrors.
- RESEARCH MODE: teen homework+coding chat; markdown via marked+DOMPurify CDN; adaptive
  thinking (default) w/ "Thinking…" indicator, max_tokens 4096; localStorage
  farmgpt_research_v1 (50 msgs; user msg saved BEFORE the reply streams so a mid-stream
  close keeps the exchange).
- Server-side caps: ≤60 messages, ≤12k chars each, long convos trimmed head(2)+tail(40)
  re-aligned to a user turn. Refusal stop w/ no text → friendly stand-in line.
- games.html: 🌾 FarmGPT tile added.
- Verified E2E headless (REAL function handler in-process + fake Anthropic SSE server):
  401/400 paths, progressive streaming, choices parse, THE END, bookshelf resume,
  research markdown+persist+clear, request shape (model/stream/thinking/guardrails),
  mobile 375px layout. 0 pageerrors. NOT yet tested against the real API (needs
  ANTHROPIC_API_KEY in Netlify) — set env var, redeploy, then live-test both modes.
- MATH RENDERING (2026-07-07, user report: raw $$ formulas): research mode typesets
  LaTeX via KaTeX CDN (auto-render). mdToHtml STASHES math segments ($$..$$, [..],
  (..), $..$) behind ❢N❢ placeholders BEFORE marked.parse (else underscores in
  subscripts become <em>), restores them HTML-escaped after DOMPurify, then
  renderMathInElement typesets in-DOM (throwOnError:false). System prompt now tells the
  model to always write LaTeX math. Verified: display+inline math typeset, no raw $$,
  subscripts un-mangled.
- TUTOR POLICY (2026-07-07, user: learn the material, don't do their homework):
  RESEARCH_SYSTEM rewritten around "concepts are free, their assignment is theirs".
  Tutor moves: parallel example w/ different numbers then hand theirs back ·
  invite/diagnose their attempt (never present the corrected version) · graduated
  hints (never flat refusal, never answer on first ask) · holds the line warmly
  under "just give me the answer" pressure (never caves) · writing = outline/
  brainstorm/feedback only, never submittable prose · ends with a now-you-try.
  CODING: only on explicitly coding questions (never volunteered elsewhere);
  concept snippets fine, build-X assignments get skeletons/TODOs not programs,
  debugging points at the bug. Live-probed all 5 behaviors on deployed Sonnet 5:
  solve-for-me → method on a different quadratic + hands it back (roots never
  given, even under pressure); essay request → outline coaching; no code on a
  math question; concept questions still fully taught.
- USAGE TRACKING (2026-07-07, user request): every reply exact token counts (SSE
  message_start input_tokens / message_delta usage.output_tokens) are aggregated into ONE
  Firestore doc per day - farmgpt_usage/<YYYY-MM-DD America/Chicago>, per-mode increment
  fields s_in/s_out/s_req + r_in/r_out/r_req via documents:commit fieldTransforms
  (creates-if-missing; no per-request docs, storage stays ~1 doc/day). Auth reuses
  FIREBASE_SERVICE_ACCOUNT w/ hand-signed JWT (notify.mjs technique), token cached across
  warm invocations; logging awaited in the stream finally (lambda stays alive) and can
  NEVER break a reply. mode:stats returns the day docs (secret-gated). Page: 📊 API
  usage link on FarmGPT home -> month estimate + all-time, story/research split, 21-day
  table; cost estimated at Sonnet 5 list price (USD 3 in / 15 out per MTok; labeled
  estimate, may read high vs intro pricing). Test env overrides: FARMGPT_FIRESTORE_BASE +
  FARMGPT_GOOGLE_TOKEN_URL (harness fakes Google token + Firestore commit/list with a
  generated RSA key). Verified: increments exact (3 story + 1 research -> 369/150/123/50),
  dashboard renders, stats 200.
- PROMPT CACHING (2026-07-07, PUSHED 948c9b5; user cost concern: $0.71/29 story reqs —
  the growing story history was re-sent at full input price every chapter): top-level
  cache_control ephemeral on the API request (auto-places on the last cacheable block;
  system+history re-read at 0.1x within the 5-min TTL; prefixes <2048 tokens silently
  skip caching on Sonnet 5 — fine, kicks in a few chapters deep). Usage tracking also
  logs cache tokens (s_cw/s_cr + r_cw/r_cr daily increments; legacy docs read 0) and
  the dashboard prices them (writes 1.25x in-rate, reads 0.1x) + "cached 💰" split line.
  DECISIONS: Max subscription can NOT fund API calls (asked 2026-07-07) — FarmGPT stays
  on Console pay-as-you-go; both modes stay on Sonnet 5 (Haiku-for-story offered,
  declined). Verified: real handler in-process vs fake Anthropic SSE + fake Firestore,
  7/7 (cache_control on wire, cache tokens committed, stats returns new fields).
- [x] SOLO COMPACT KITCHEN + AUTO-WORK (2026-07-07, user: solo layout too large, nobody to
      throw to): LEVEL 1 played ALONE (1 chef at hostStartLevel — no couch P2, no guest)
      runs on a 10×8 grid (same width, HALF the depth). Kitchen depth is now DYNAMIC:
      FLOOR_D/HALF_D/INNER_Z are lets switched by setKitchenDepth() inside
      rebuildKitchenForLevel(levelId, compact); COUNTER_TILES regenerates in place; the
      render layer gained rebuildKitchenGeometryVisuals() = rebuildFloorMeshes +
      rebuildCounterTileMeshes (per-tile materials disposed) + rebuildSlotLayer (slot
      groups + slotTileMesh, now a let); fitCamera far-wall depth reads live HALF_D (the
      SCENE_HALF_D const remains only for boot-time ground/decor sizing). Every runtime
      HALF_D consumer (moveChef clamps, throw bounces, landing clamps, field ring,
      exterior checks, lob exit) adapts automatically. layoutCellToXZ maps r===FLOOR_D as
      the bottom row / z = r-(HALF_D+0.5). SOLO_L1_LAYOUT_ENTRIES: crates across the top
      (lettuce c3, onion c4, potato c5, tomato c7), board c3 + trash c4 + board c6 +
      sink c8 across the bottom, patty/stove/oven/plates down the left, dough/pan/cheese/
      bun/dirtyBin down the right (17 entries, all required stations present; inactive =
      plain counters). Solo spawn: center-bottom (z = HALF_D-CT-1).
      AUTO-WORK (compact only): an item that arrived at a cut/wash station BY THROW works
      itself at 50% of player speed — thrown raw+choppable onto a board sets board.auto
      (cleared on any HAND placement + on completion); thrown dirty plate parking at the
      sink bumps G.sink.autoQueue (manual scrubs clamp it to parked). advanceAutoWork(dt)
      in hostSim ticks boards (skipped while board.manualHold>0, set each frame the player
      holds WORK — player = normal speed, never additive) and the sink (skipped while
      washingChef set; completion parked--/autoQueue--/clean++). Progress bars render via
      the existing fields untouched.
      MP: G.compact synced in snapshots; guest applySnapshot rebuilds on compact change
      (same path as level change, before cs applies); a guest joining mid-compact makes
      hostAssignSeat RESTART the current level on the full grid (or quietly swap back if
      on level-select/day-end). Verified headless: compact 8/32 tiles + camera 28.6→18.6,
      all ACTIVE stations self-resolve (inactive→neighbor/slot is by design), thrown
      tomato auto-chops in 3s, manual chop 0.5 progress @0.75s (normal, not stacked),
      thrown dirty plate auto-washes (parked/queue/clean exact), hand-placed never autos,
      L2 solo + L1 couch stay full 16/48, L1 solo returns compact, real V-lob salad from
      center = +35 served. 0 pageerrors. PUSHED 94f72bf.
- [x] SOLO TUNING (2026-07-07, user playtest): auto-work 50% -> 25% of player speed (chop
      ~6s, wash ~8s alone). Solo layout wash loop now faces itself ACROSS the kitchen:
      sink LEFT r5 (x -4.5, z 0.5) directly opposite dirtyBin RIGHT r5 (x 4.5, z 0.5) —
      grab dirty plate at the bin, throw it clean across to the sink; oven took the sink
      old bottom c8 tile, cheese/bun shifted down the right wall. Compact spawns 30%
      faster (spawnFactor × 0.7). BUGFIX exposed by the new loop: resolveIngredientLanding
      now takes the flight dir and DROPS candidates BEHIND the throw (dot < -0.35 vs the
      launch-relative anchor) — without it, throwing a dirty plate from beside the bin
      re-absorbed it into the bin on the first flight step (and a raw ingredient thrown
      from beside its own crate went straight back in the box). Both call sites (flight +
      aim preview) pass dir. Verified: cross-kitchen dirty-plate throw parks at the sink,
      auto rates measured at 25%, manual override still exactly 1x, full regression suite
      green. PUSHED 94f72bf.
- [x] SOLO MODE ALL LEVELS + PLATE RECOVERY (2026-07-07, user): G.compact now = solo on ANY
      level (was L1-only). SOLO_LAYOUT_ENTRIES = per-level 10×8 maps designed around the
      THROW-ACROSS principle (sink LEFT always directly opposite dirtyBin RIGHT):
      L2 Soup ping-pong — veg TOP → boards BOTTOM → chopped thrown back UP to the pot
      (stove top c8); L3 Burger signature cross — patty crate L r2 directly opposite the
      pan R r2 (throw the patty clean across to the grill), veg top → boards bottom;
      L4 Pizza — dough/tomato/cheese top → boards bottom, oven bottom c8 beside the
      boards (pizzaBase is not throwable → short carry); L5 Feast — all active, veg+dough
      top, patty L2↔pan R2 AND stove L3↔oven R3 face-offs. All 17 entries/level, all
      required stations present. Verified per level: compact 8-deep, sink↔bin opposite,
      every ACTIVE station self-resolves (L5: 0 fails with everything active), L3 patty
      cross-throw lands in the pan cooking, L2 chopped tomato throw lands in the pot.
      PLATE RECOVERY (user: lobbing dishes out = fail state): hostResolveClaims now uses
      PLATE_RECOVERY_TTL=3s for any exterior item WITHOUT a completed dish (empty/partial
      plates, stray ingredients) — and the crow return includes kind dirtyPlate (was
      plate-only: a lobbed dirty plate was PERMANENTLY lost → soft-lock with all 3 out).
      Completed dishes keep the 5s claimable crow TTL. Verified: dirtyPlate + empty +
      partial plate lobbed outside all back in dirtyQueue ~4s later. PUSHED 94f72bf.
- [x] CHEF BUCKY — first fully in-house Blender chef (2026-07-07, user request): modeled,
      rigged AND animated from scratch via the Blender MCP bridge (official Blender Lab
      MCP addon, installed via CLI: lab repo zip -> extension install-file -> enable +
      use_autostart; server localhost:9876, works whenever Blender is open). SOURCE OF
      TRUTH: assets/blender/chefbucky.blend (186KB) — 29-part chunky low-poly upright
      goat mascot chef (brown fur, toque, apron, blaze, droopy ears, horn nubs, beard),
      faces -Y in Blender = +Z in glTF. Rig: 7 deform bones (Hips/Chest/Head/LeftArm/
      RightArm/LeftLeg/RightLeg — Left/RightArm names are what buildChefGLB carry-pose
      regex needs) + 3 LEAF bones (feet + HeadTop) added because the game scales chefs by
      the JOINT-ORIGIN bounding box (computeBoneWorldBox) — without leaves the 7 origins
      spanned 0.58-1.22 and scaleTo came out 2.34 (giant chef); with leaves 0.04-1.58 ->
      0.974. Skinning: RIGID per part (each object vertex-grouped 100% to one bone before
      join — no auto-weight bleed; bevel modifiers applied pre-join since join discards
      them). Anims hand-keyed at 24fps as 5 Blender actions (idle 48f breathe/sway, walk
      16f, run 12f + lean, chop 14f raise-slam loop, throw 18f windup-snap-follow); sign
      conventions: -X = forward swing, empty-dict frames are SKIPPED by the keyframe
      helper (idle loop-close needed explicit neutral keys). Export: glTF ACTIONS mode ->
      one GLB -> gltf-transform split into chef-bucky.glb (419KB) + 5 MESH-LESS clip GLBs
      (~19KB each, Tinker pattern). Game: GLB_CHEF_IDS + picker card 🐐 Chef Bucky (5th).
      Fur brightened at the source (dark under kitchen lights, same as Tinker lesson).
      Verified in-game headless: picker, GLB-backed, idle/run/chop/throw via real keys,
      carry pose, scale 0.974. 0 pageerrors. PUSHED 94f72bf.
- [x] CARRY ANIM + ARM-STOMP FIX (2026-07-07): Blender "carry" clip (16f walk cycle,
      arms locked in a world-space-solved tray pose euler (-72,±0.6,±0.8), f1 =
      passing pose) -> chef-bucky-carry.glb (mesh-less). Game: optional per-model
      6th clip via GLB_CHEF_EXTRA_CLIPS; holding+moving+a.carry -> animState "carry"
      (run timeScale rules); heldSlot raised to (0,0.80,0.42) so items rest ON the
      outstretched hands. CRITICAL FIX found during wiring: the hold-pose blend wrote
      bone.rotation.x every frame, which rebuilds the quaternion from STALE euler y/z
      and silently FROZE all GLB chefs' arm animation in-game — now a post-mixer
      additive quaternion delta applied only while blend>0.01 (verified: arm quat
      delta 1.73/frame mid-chop vs 0 before).
- [x] NEW 3-CHARACTER CAST (2026-07-07, PUSHED 94f72bf): Otis 🐶 (white golden
      retriever: cream fur, blue band/belt, floppy hanging ears — goat ears rotated
      72° about an inner-top pivot — fluffy tail, black nose) and Boots 🐱 (grey cat:
      WHITE paws/feet, pink nose, brick-red band, new 4-vert-cone pointy ears, long
      thin upturned tail) — both dissected from the ChefBucky mesh via loose-part
      separation (identify parts by material+bbox center; horns/beard deleted) and
      REJOINED ON THE SAME ChefBuckyRig in assets/blender/chefbucky.blend. Shared
      skeleton = shared clips: chef-otis.glb / chef-boots.glb are BASE-ONLY (361KB);
      all 6 clips load from chef-bucky-*.glb via GLB_CHEF_CLIP_SRC — new rig anims
      automatically work for the whole cast. Picker = exactly bucky/otis/boots; old
      chefs (farmer/grandma/kid/steampunk Tinker) REMOVED incl all 24 Meshy GLBs
      (~30MB, in git history); default/legacy chefModel ids -> bucky; couch P2
      default otis. GOTCHAS: Blender MCP render_viewport_to_path renders from the
      scene CAMERA and ignores hide_set/hide_viewport (use hide_render or move
      objects apart — overlapping chars z-fight into a chimera that reads as wrong
      materials); .blend1 backups must not be committed; export with everyone at
      the origin (export_apply bakes object transforms).
- [x] HOME POLISH + DAD JOKES V2 (2026-07-07, PUSHED 59f83e7): dashboard tiles
      2-col cards -> compact 3x3 grid (42px icon circles, descs hidden <560px);
      greeting + joke card tightened. FIT GUARANTEE: on 375x812 the greeting,
      all 9 section tiles, AND the full dad-joke card are visible with zero
      scrolling (joke bottom 620/812; desktop 1280x800 also fits w/ descs).
      Folded in the parallel session's work: assets/dadjokes.js 723-joke DB
      (window.DAD_JOKES + inline fallback, joke-of-day keyed to date, ➜ bonus
      jokes), pill-style scrollable top tab bar, header gradient, FarmGPT
      no-auto-scroll-while-streaming. TEST GOTCHA: headless index.html tests
      with choreUnlocked+choreUser hit PRODUCTION Firestore (notification
      toasts bury the layout) — block googleapis/firestore requests for
      deterministic offline shots ("using this phone only" mode).
- [x] ONE-ROW TAB BAR (2026-07-07, PUSHED 4d20720): index.html tabs = single fixed
      row of 10 equal-width icon-only buttons (flex 1 1 0; labels -> tooltips/aria;
      scrollIntoView centering removed). No horizontal scroll at any width.
- [x] RESEARCH FOLLOW-UPS + MC PRACTICE (2026-07-07, PUSHED d4d1d1e): every research
      answer ends in tappable next moves — chips 📚 More examples / ✏️ Practice
      problems / ➡️ Next step (write-in always available). Practice = ALWAYS
      multiple choice: server prompt protocol ===ANSWERS=== + 4 "A) opt" lines
      (mirrors story's ===CHOICES===), client parses to A-D tap buttons (KaTeX
      typeset labels; tap sends "My answer: B) ..."), marker hidden incl. partial
      mid-stream; actions restored on reload + after failed requests. RAW reply
      (with marker) stays in researchMsgs so the model sees its own protocol.
      Verified E2E vs real handler + fake Anthropic SSE. Live Sonnet 5 protocol
      adherence still to be spot-checked post-deploy ("give me a practice problem").
- [x] MC WRONG-ANSWER REWORK + ENDLESS REBALANCE (2026-07-07, PUSHED a5d2d05):
      research practice problems — wrong answer now = reveal the correct option +
      explain why + the picked distractor's mistake, then a NEW same-concept
      problem (different numbers) with fresh ===ANSWERS=== buttons in the SAME
      message (the same-problem-retry design + 🔁 Answer choices fallback chip
      were removed — didn't land in live testing). Endless Rush all levels:
      endlessSpawnInterval = max(5, 20*0.5^(t/180)) (was max(2.5, 18*0.5^(t/90)))
      and endlessMaxWaiting = min(7, 3+floor(t/90)) (was min(8, 3+floor(t/45)))
      — peak pressure halved and ~3x later; user asked for "a good bit" easier
      with a smoother ramp.
- [x] GOAT RECORD FIELDS (2026-07-07, PUSHED 1805d41, first sonnet-delegated task):
      Goats tab adds breed (datalist: Nigerian Dwarf / Mini LaMancha), regnum
      ("Registration #"), horns (select Disbudded/Horned/Polled), freshenings
      (number) — editable in the goat sheet, detail shows breed always + others
      when set. goatBreed(g) name-fallback (Archie/Graffi/Steffi/Oakley/Annie/
      Peyton -> Mini LaMancha, else Nigerian Dwarf) covers the LIVE Firestore
      herd; BUCKY_SEED backfilled via JSON transform. Also fixed pre-existing
      bug: #goatOverlay now z-index 41 (edit sheet used to open UNDER the
      detail overlay -> Save unclickable from the detail-view Edit path).
      DELEGATION LESSONS (policy re-enabled 2026-07-07, see memory): sonnet
      agents may hallucinate "I've launched a background agent" and stop after
      1 tool call (can chain!) — every delegation prompt needs an explicit
      "do ALL work yourself with Read/Edit/Bash; do NOT use the Agent tool"
      ground rule, and check `git diff --stat` on every completion before
      trusting the report. index.html's script is type="module" — headless
      tests must drive real DOM clicks (page.evaluate can't reach module
      globals), which is also what catches paint/stacking bugs.
- [x] HERD DUPLICATION incident + fix (2026-07-07, PUSHED 825106c): 34 goat dupes
      (+1 resurrected "Raspberry") appeared 2026-07-06 18:33Z — root cause: the
      cloud backend's one-time seeding ran on an EMPTY fromCache first snapshot
      (fresh device/test browser, cold cache) and addDoc'd the seed herd into
      the LIVE chores_fam2jan2g (write died mid-flight: 35 of 42 items landed,
      no starter chores). FIX: seeding requires !snap.metadata.fromCache.
      CLEANUP: 34 pristine seed copies (no photo/care) deleted via Firestore
      REST DELETE w/ the web API key (rules are public); originals untouched;
      user chose to KEEP Raspberry (previously deleted, now a bare record).
      LESSON: any headless test that lets index.html reach production Firestore
      with a fresh profile can trigger first-launch paths — ALWAYS block
      /googleapis|firestore|firebase|gstatic/ in test browsers (gstatic serves
      the SDK). Firestore REST audit one-liner lives in this session's
      transcript; familyKey = roomId("amenfarms") = fam2jan2g.
- [x] ILLUSTRATED STORIES + HOMEWORK CAMERA (2026-07-07, PUSHED 1b37ee0, built by
      an opus subagent from a Fable spec): story chapters can end ===ART=== +
      inline SVG (client DOMPurify svg profile + FORBID script/foreignObject/
      image/href — server prompt bans them too); 🎨 frequency seg on story
      setup (every / every3 DEFAULT / first / off, localStorage farmgpt_illust);
      illustrate:true requests get maxTokens 3000, plain stay 1200; art streams
      after text+choices; bookshelf saves >300KB strip art oldest-first.
      Research 📷: photo -> ≤1280px JPEG client-side -> vision image block;
      sanitizeMessages accepts text/image block arrays (jpeg/png/webp, ≤2.8M
      b64 chars, ≤4 imgs/request oldest-stripped); RESEARCH_SYSTEM PHOTOS block
      (coach photographed worksheets, never answer-sheet); saveResearch stores
      thumb (≤200px) + "[photo shared earlier]" placeholder, NEVER full b64
      (in-memory keeps full image for same-session follow-ups — storage copies,
      don't mutate, or the in-flight request loses its image). TODO next: live
      story on every3 -> read real ¢/illustration off the usage dashboard and
      tune default frequency/art prompt.

---

# 🏁 Farm Kart — kart racer feel prototype (ACTIVE, 2026-07-07)

farmkart.html — UNTRACKED (never commit/push until the user calls it mature; farm3d
precedent). MKW-mechanism physics (Kinoko-derived, see farmkart-physics-notes.md), user's
tune approved. Live TUNE slider panel (fk_tune_v2) + window.__KART__ hook are load-bearing —
keep both. GOTCHAS: renderer.setSize must keep updateStyle=true (dPR>1 canvas-crop bug —
always test at deviceScaleFactor 1.5); R-reset must snap camHeading/camPos; camStiff slider
= rest-vs-speed camera gap (~speed/camStiff).
Full stage specs live in **farmkart-plan.md** (untracked, repo root): K1 race format +
G-state restructure → K2 terrain height → K3 track data + 3D editor → K4 power-ups →
K5 Playroom 4-player MP → K6 polish → K7 collisions/walls/overlap/boost-pads. One stage per
agent run, user playtests between stages, feel regressions are never acceptable.
K7 DONE (2026-07-08): kart-vs-kart collision (radial split + capped bump), corridor walls +
visible fence (per-track wallMargin, editor field + corridor-viz toggle, gaps at overlaps),
track-overlap jump fix (FK_TRACK.nearestOnCenterAtY keeps the kart on ITS level → figure-8s/
bridges legal, "Figure 8 (bridge)" demo track; editor overlap = advisory not error), boost
pads (per-track boostPads[{s,lane}], editor ⚡ mode, drive-over boost once/pass). Plus the
decline-bounce fix (landing seats vy=terrainVY so a sustained decline no longer re-launches).
GATOR KART MODEL (2026-07-08, untracked local test): user Meshy "6x4 John Deere Gator" GLB (1.18M tris/43MB) dieted via Blender DECIMATE collapse 0.047 -> 55k (NOT meshopt simplify — 0.02 left shard artifacts; Blender collapse is clean), 6 wheels split by fixed-seed radial + origin at X-Z-bounds-midpoint (true axle, no wobble), spin about local Z by speed + front-pair steer (assets/farmkart-kart.glb, GLTFLoader script added, buildKartView modelSlot + fillKartModel + syncKartView wheel loop). GOTCHA: Blender headless FIRST bpy.ops.mesh.separate grabs a STALE full selection regardless of what you set — burn it with a throwaway separate+rejoin before the real loop, else the first-processed part is mangled. Full physics regression NOT yet re-run since the kart-view changes. All farmkart files STILL UNTRACKED. Stage backups in session scratchpad (farmkart-pre-k*).
- [x] FARM KART K1-K6 COMPLETE (2026-07-08, all six stages by opus agents from the
      farmkart-plan.md specs, Fable review between stages): K1 race format +
      G.players restructure (grid/countdown/start-boost-or-stall/checkpoint laps/
      results) · K2 terrain height (sampleHeight authority, slope accel, hairpin
      crest +5.5) · K2.5 airborne (ballistic launch when reqAccel < -gravity,
      air control/grip, landing squash, camera float; playtest fixes: landing FX
      gated on airtime, height sampling INTERPOLATED between spline samples —
      stairs bug, gravity 28->18 w/ one-time saved-tune migration) · K3 shared
      assets/farmkart-track.js + farmkart-editor.html (orbit view, drag points,
      Shift-drag elevation, validation, fk_tracks_v1, ?track= w/ silent fallback)
      · K3.5 bots (pure-pursuit via same stepKart, botSkill + rubber-band, 0-3
      from menu) · K4 items (boxes from itemRows, roll HUD, ⚡🍅🌾, 1s spin-outs,
      bots use items) · K5 Playroom MP (client-authoritative own kart @18Hz,
      host: countdown/bots/item rolls/hit rulings @12Hz snap, ~120ms interp,
      exactly-once useSeq/spin seq, live 2-browser verified incl. cross-screen
      spin + hidden-host heartbeat + disconnect cleanup; family-lobby substage
      deliberately deferred) · K6 polish (reactive WebAudio set + fk_muted,
      pooled particles, barn-sign title, medal podium, per-track best fk_best_<id>).
      Final suite 161/161 @ dPR 1.5, 0 pageerrors across 6 page contexts. ALL
      FARMKART FILES STILL UNTRACKED (farmkart.html, farmkart-editor.html,
      assets/farmkart-track.js, farmkart-plan.md, farmkart-physics-notes.md) —
      user decides when it goes live. Backups of every stage in the session
      scratchpad (farmkart-pre-k*-backup.html).
- [x] CAMERA-UNDER-GRASS FIX (2026-07-08, user playtest, several failed guesses first):
      the symptom ("both cam AND kart under the grass") was NOT the flat-ground clamp.
      Real cause: near an ELEVATED span (hairpin crest +5.5, ~8.6u above the ground
      beside it) the kart tips off the raised outer edge into the pit at its base; the
      low/close chase cam (camDist 3, camHeight 2.4) drops BELOW the elevated ground lip
      and looks up into the ground mesh's UNLIT BACKFACE (DoubleSide MeshLambert → the
      near-black wall in the screenshot, sky through the gap). The old clamp only checked
      the thin cam->kart LINE, missing a lip beside/ahead of the camera. FIX (frame(),
      the terrain-clamp block): sample the ACTUAL mesh fn groundSampleHeight (not
      sampleHeight) at (a) the sight-line, (b) a ring around the camera, and (c) the LOOK
      direction out to 18u — if terrain there towers >1.6u over the camera (pit/underside
      case) lift the camera to ~crest height so it looks ACROSS the crest, not up into the
      backside; clearance now also covers the near plane (near 0.5->0.3). The >1.6 gate
      means ordinary rolling hills in normal play never nudge the camera. KEY DEBUGGING
      LESSON: could NOT reproduce headless for a long time because (1) the persisted live
      tune lives in localStorage fk_tune_v2 and OVERRIDES the baked TUNE_DEFAULTS at load
      — fresh headless browsers use the gentle baked amp, not the user's, and (2) centered
      pure-pursuit driving never reaches the elevated OUTER RIM where it happens. Pulled
      the user's actual screenshot out of the session .jsonl (node readline → base64
      decode) to see it, then reproduced the exact crest-pit pose. Verified: the exact
      broken pose renders clean post-fix; 6 crest poses clean; full-lap normal driving =
      cam never below mesh + NO abnormal lift (feel intact) + 0 pageerrors; K1-K6
      regression all pass. GOTCHA on the mass black-pixel scan: teleporting the kart
      through 200+ poses back-to-back WITHOUT forceRace-resetting drives the game into a
      degenerate state (9-min lap timer, camera jams into the kart) → false "black"
      positives; render each suspect pose in a FRESH race to judge it. STILL UNTRACKED.
- [x] WENT LIVE (2026-07-08, commit 7c56c29): farmkart.html + assets/farmkart-track.js
      + assets/farmkart-kart.glb + farmkart-editor.html committed & pushed; linked from
      games.html (🏁 tile). Shipped together with the other session's FarmGPT story
      update (Haiku + chapters + slow-burn). (farm3d, bistro3p, tools/mk64-to-farmkart
      still deliberately untracked.)
- [x] MOBILE CONTROLS + camera pullback (2026-07-08, user: "forgot mobile controls,
      probably need a farther camera on mobile"): IS_MOBILE = matchMedia('(pointer:
      coarse)') && min(innerW,innerH)<900. On-screen thumb layer #touchCtl (shown via
      body.mobile + .on class, toggled to countdown+racing phases; a no-op on desktop
      since CSS gates on body.mobile): ◀▶ steer bottom-left, DRIFT + 🎁 item bottom-
      right, ♻ reset top-right. bindHold() wires pointerdown/up/cancel/leave/
      lostpointercapture → a `touch` flag object that gatherInput() folds in exactly
      like the gamepad. MOBILE AUTO-ACCELERATE: throttle=1 whenever G.phase==='racing'
      (frees a thumb; throttle turning on exactly at GO also earns the start boost;
      countdown stays throttle-off so no early-start stall) — so there's no gas button.
      Camera pullback via camDistEff()/camHeightEff() = TUNE.camDist/Height ×
      (IS_MOBILE ? 1.7/1.3 : 1), applied at all 3 camera sites (init, snapCameraBehind,
      frame targetPos) — MULTIPLIER on the live tune so the user's tuned values stay the
      source. Stats #hud + keyboard #help hidden on mobile to free the thumb zones
      (place top-left + itemSlot top-center stay). Verified headless (matchMedia stub +
      small viewport): body.mobile set, 5 buttons, touch ◀ → steer=1, auto-accel drove
      the kart (spd 19.8, no gas btn), rest cam dist 5.1 (=3×1.7) / height 3.12 (=2.4×
      1.3) vs desktop 3.0/2.4 unchanged, touchCtl display:none on desktop, 0 pageerrors
      both. Mobile screenshot clean. GOTCHA: puppeteer's emulateMediaFeatures rejects
      'pointer' in this Chrome — stub window.matchMedia via evaluateOnNewDocument.
- [x] MOBILE STEERING → DRAG-TO-STEER (2026-07-08, user: the ◀▶ buttons "aren't really
      doing it"; researched Mario Kart Tour/Asphalt — they use ANALOG drag/tilt, not
      on/off buttons). Replaced the two steer buttons with a full-area #tcSteer drag
      layer (z1, under the z3 buttons so DRIFT/item/reset still capture their taps):
      touch down anywhere = neutral, slide left/right = proportional steer; a #steerRing
      at the origin + #steerKnob show it; release straightens. touch.steer is analog
      [-1,1] (+left, matching keyboard sign; slide-right = -steer = turn right),
      gatherInput does `steer += touch.steer`. One steering pointer (pid latch) so a 2nd
      finger on DRIFT/item doesn't disturb it; setPointerCapture wrapped in try/catch
      (throws on synthetic pointers but the full-screen zone gets the moves anyway).
      steerRangePx = clamp(innerWidth*0.24, 90..150) = px slide for full lock. Auto-accel
      + DRIFT/item/reset unchanged. Verified headless: slide right Δθ -0.79 / left +0.70
      (opposite), half-slide -0.23 (~⅓ = analog), ring block during drag → none on
      release, 0 pageerrors; mobile screenshot shows ring+knob. Kept steering method as a
      single default (no tilt/wheel toggle) per the user's pick.

## WORLD EDITOR (2026-07-08, user: flesh out tracks → needs a more powerful editor). Multi-phase
plan (user chose: WYSIWYG-terrain FIRST, objects VISUAL-first/collide-later): P1 WYSIWYG terrain ·
P2 objects+tag+gizmo (tag a rectangle → I design a barn there) · P3 free terrain sculpting · P4
paint + water · P5 fence tool + real props. All ADDITIVE + safe for the LIVE game (empty world =
today's render). World data model will extend the track format (terrain heightfield + paint grid +
water[] + objects[{id,tag,type,transform}] + fences[]), saved via the same localStorage + cloud
layout sync.
- [x] P1 WYSIWYG TERRAIN (2026-07-08): promoted the game's terrain math into the shared
      FK_TRACK module so the editor renders byte-identical grass/hills. Added FK_TRACK.groundHills/
      sampleHeight/groundSampleHeight/buildGroundMesh (parameterized by opts={amp,wave,margin}
      instead of the game's TUNE globals; buildGroundMesh also accepts groundMargin/seg/color +
      an optional vertexColorFn for P4 paint). GAME refactor: groundHills/sampleHeight/
      groundSampleHeight are now thin wrappers → FK_TRACK.*(_sampled,...,terrainOpts()), and the
      inline ground-grid block → FK_TRACK.buildGroundMesh(_sampled,TRACK_WIDTH,THREE,terrainOpts());
      terrainOpts() reads live TUNE. VERIFIED BYTE-IDENTICAL: captured 837 sampleHeight+
      groundSampleHeight points pre-refactor, re-checked post — max diff 0.0, 0 mismatches, game
      boots + grass renders + 0 pageerrors. EDITOR: rebuildTerrain() builds the same mesh
      (TERRAIN={amp:3.4,wave:60,margin:9} = TUNE_DEFAULTS), DEBOUNCED 140ms so point drags stay
      smooth; 🌾 terrain ON/OFF toggle (hides the reference grid when on). Verified: editor renders
      terrain (default + Royal Raceway w/ elevation skirts), toggle works, 0 pageerrors. NOTE terrain
      params are still global (TUNE_DEFAULTS) not per-track — P3 sculpting will add per-track terrain.
- [x] P2 OBJECTS + TAG + GIZMO (2026-07-08): place/move/rotate/scale/tag world objects. DATA:
      track.objects=[{id,tag,type,x,y,z,rotY,sx,sy,sz,color}] where (x,y,z)=CENTER, (sx,sy,sz)=box
      dims; added to FK_TRACK.sanitize (absent→omitted, empty world = live game unchanged) +
      FK_TRACK.buildObjectMesh (shared: a THREE.Group w/ a unit box scaled/positioned/yaw'd; type
      "block" for now, opts.ghost=translucent for the editor). EDITOR: TransformControls gizmo
      (examples/js addon) — 🧊 objects mode, ＋ add block (spawns at the orbit target on the terrain,
      auto-selects), click-to-select, move/rotate/scale buttons + G/R/S keys, tag input + floating
      canvas-sprite label per object (shows the tag), object list (select/delete), duplicate, Del to
      delete. gizmo.enabled/visible gated to object mode so it never steals clicks from point editing;
      'dragging-changed'→disable OrbitControls; 'objectChange'→writeBackSelected() (reads group
      pos/scale/rotY back into the data + moves the label). Load paths (loadById/import/boot/
      loadTrack) call rebuildObjects(); objects live in their own group so point-drag rebuild()s don't
      touch them. GAME: renders ACTIVE_TRACK.objects via the same buildObjectMesh (solid, no collision
      yet — "visual first" per the user). Verified headless: add→1 obj selected, transform writes back
      exact (40,12,-30/14,8,20/0.6), tag persists through save→empty-load→reload, gizmo attaches,
      game renders the box on a ?track= with objects, 0 pageerrors editor+game. Mode row → flex-wrap
      (5 buttons overflowed 250px). WORKFLOW UNLOCKED: user tags a rectangle → tells me what to
      build there → I add a real type case to buildObjectMesh keyed off that footprint.
- [x] P3 TERRAIN SCULPTING (2026-07-08): raise/lower grass hills+dips independent of the track.
      DATA: track.terrain = { cell:6, cells:{"i,j":delta} } — a SPARSE world-anchored heightfield
      (grid point i,j at world i*cell,j*cell), sanitized (absent/empty→omitted = live game terrain
      unchanged, re-verified byte-identical 0.0 diff). FK_TRACK.sampleField() bilinear-reads it;
      injected INTO groundHills (h += sampleField(opts.field)) so every consumer — kart physics,
      camera, ground mesh, both editor+game — sees the sculpt via opts.field (game terrainOpts()
      adds field:ACTIVE_TRACK.terrain; editor edTerrainOpts() adds field:track.terrain). The road is
      UNAFFECTED: on-track height = trackY (the skirt blend overrides the field), verified
      onTrackChange=0. EDITOR: ⛰ sculpt mode, raise/lower toggle (or hold Shift = lower), brush
      size+strength sliders, clear-all; drag the grass → applyBrush() bumps cells in radius w/
      smoothstep falloff; live throttled rebuild (110ms — debounce would never fire mid-drag),
      full exact rebuild on pointerup; pickGround() raycasts the terrain mesh. Verified headless:
      raise +12 / lower -12 at grass points, road unaffected, mesh bbox deforms (maxY 19.4 hill /
      minY -14.6 dip), persists save→empty→reload (height exact), game sampleHeight at a sculpted
      bump = 7.16 vs flat 0.77, 0 pageerrors editor+game. NOTE sculpts only render where the ground
      MESH reaches (track bbox + 55 margin); sculpting past that edits data w/ no visible mesh.
      All P1-P3 still LOCAL (not pushed) per the user's "keep it local, link per phase" workflow.
- [x] P4 PAINT + WATER (2026-07-08): terrain color painting + water bodies. PAINT: sparse color
      grid track.paint={cell,cells:{"i,j":0xRRGGBB}} sanitized like the sculpt field; FK_TRACK.
      sampleColor() bilinear-blends it (unpainted cells fall back to base grass 0x6fae54 so patches
      feather smoothly). buildGroundMesh derives a vertexColorFn from opts.paint when non-empty →
      per-vertex colors, material forced WHITE (it multiplies vertex color); absent → no color attr,
      mesh byte-identical (re-verified 0.0). Editor 🎨 paint mode: 8-swatch palette (grass/dark/dry/
      dirt/sand/path/red-clay/snow), brush-size slider, clear-all, drag-to-paint (sets cells in
      radius, throttled live rebuild). game+editor terrainOpts add paint:track.paint. WATER: a new
      object type "water" (reuses ALL P2 object machinery — place/gizmo/move/scale/rotate/list/save/
      game-render) rendered by buildObjectMesh as a translucent blue slab (opacity .72, depthWrite
      false, renderOrder 3); 💧 add water button spawns {type:water, sx/sz 30, sy .6, blue} at the
      view center on the terrain, then gizmo it into a sculpted dip. Verified headless: paint 137
      cells → mesh gains color attr, water obj added, both persist save→empty→reload, game renders
      painted dirt swath + translucent pond, road unaffected, 0 pageerrors editor+game. All P1-P4
      still LOCAL.
- [x] P5 FENCE TOOL + REAL PROPS (2026-07-08): cattle fences + the blockout→real-model pattern.
      FENCES: track.fences=[{id,tag,points:[{x,z}],height,postGap}] sanitized; FK_TRACK.buildFenceMesh
      builds terrain-following posts + 3 rails (walks each segment at 2.5u steps, samples opts.heightFn
      per point — game passes sampleHeight, editor terrainHeightAt; rails oriented by quaternion
      setFromUnitVectors so they pitch along slopes). Editor 🔗 fence mode: CLICK the ground to drop
      posts (down+up<6px = click, else drag orbits — fenceDown tracks it), ↶ undo point, ✓ finish
      (starts a new run), fence list w/ delete, yellow point-marker dots. REAL PROPS: buildObjectMesh
      switched on obj.type — added barn (red walls + 2-plane gable roof + door), silo (cylinder +
      hemisphere dome), tree (trunk + canopy sphere); all authored to a UNIT box (base y=-0.5) so the
      group (x,y,z)=center + (sx,sy,sz) scale + gizmo work uniformly like block/water. Editor: an
      object TYPE dropdown (block/barn/silo/tree/water) retypes the SELECTED object → a tagged
      blockout becomes a real model on the spot. Game renders ACTIVE_TRACK.fences via buildFenceMesh.
      Verified headless: fence 3pts renders mesh + persists, retype block→barn persists, game loads
      4 props (barn/silo/2 trees) + 1 fence and renders them all, byte-identical when empty, 0
      pageerrors editor+game. THE WORLD-EDITOR PLAN (P1 WYSIWYG terrain · P2 objects+tag · P3 sculpt ·
      P4 paint+water · P5 fence+props) IS COMPLETE — all LOCAL, never pushed. WORKFLOW: user tags a
      blockout / names a spot → I add a bespoke type case to buildObjectMesh (barn/house/etc.) keyed
      to that footprint. Model polish (nicer barn roof, more prop types) is per-request from here.
- [x] P6 FREE CC0 SCENERY MODELS (2026-07-08, user: "get some free scenery models online"): 57 CC0
      GLBs downloaded into assets/farmkart/props/ (Kenney Nature Kit selection — 48: trees/rocks/
      stones/plants/flowers/crops/logs/stumps/fences/mushrooms + Quaternius Farm Buildings — 9: barn/
      big_barn/small_barn/open_barn/silo/silo_house/windmill/chickencoop/fence). All PUBLIC DOMAIN/CC0
      (no attribution). SOURCING: Kenney = one direct zip (kenney.nl/media/.../kenney_nature-kit.zip,
      329 .glb inside); Poly Pizza = per-model GLB at static.poly.pizza/<uuid>.glb (model page /m/<id>
      has the uuid + a "Title" JSON field + license — Poly Pizza MIXES CC0 and CC-BY, verified each;
      animals/vehicles searched were mostly CC-BY so SKIPPED to stay attribution-free). NEW module
      assets/farmkart-props.js: window.FK_PROPS manifest [{id,name,file,cat,size}] + FK_loadProps(ids,
      THREE,base,onOne) → loads each GLB, CONVERTS materials (see [[gltf-linear-color-gotcha]]:
      MeshStandard→MeshLambert, white base when textured/vertex-colored, convertLinearToSRGB on solid
      colors, emissive≈base×0.34 — otherwise they render near-black), NORMALIZES into a unit box (base
      y=-0.5, centered XZ), caches for cloning. buildObjectMesh type "glb" clones from opts.propCache
      (placeholder box until loaded); sanitize preserves the .model field. EDITOR: GLTFLoader+props.js
      added; 🌲 Scenery section = category dropdown + scrollable prop buttons; picking one places a
      type:glb object sized per category; all 57 preloaded at boot (propStatus counter), propCache
      passed to rebuildObjects. GAME: non-glb objects render sync, glb props async-load only the models
      the track references then pop in (empty track = no load = byte-identical, re-verified 0.0).
      Verified headless: 57 loaded, picker 13 tree btns, place→real mesh (0 placeholders), model field
      persists save→reload, game renders barn/silo/trees/rock with CORRECT colors (sRGB fix) + 0
      pageerrors. Kenney License.txt kept in props/. Still LOCAL. NEXT: user tags/places → I can also
      hand-build bespoke models, and CC-BY animals/vehicles are available if a credits line is OK.
