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

farmgpt.html + netlify/functions/farmgpt.mjs (Claude API, model claude-sonnet-5).
- ARCHITECTURE: static page → POST /.netlify/functions/farmgpt {secret, mode, messages}
  → function stamps the per-mode GUARDRAIL SYSTEM PROMPT server-side (browser can never
  override), streams Sonnet 5 text back as plain chunks. Zero-dependency raw fetch +
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
  buttons; marker hidden during stream incl. partial-marker trim) or ===THE END=== for the
  finale (~8-15 chapters). Write-in input always available. thinking disabled (speed),
  max_tokens 1200. Bookshelf: localStorage farmgpt_stories_v1 (20 cap, resume/delete;
  resume with trailing user turn auto-continues).
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
