# 🌱 Farm Life — persistent family mini-MMO (plan)

Working title: **Farm Life** (name candidates to pick with the family: Amen Acres ·
Bucky's Valley · Harvest Hollow · Goat Creek Farm). UNTRACKED planning doc, same
convention as farmkart-plan.md — one phase per run, user playtests between phases,
feel regressions never acceptable, nothing pushes without preview approval.

## The pitch

A Harvest Moon 64 / Harvest Moon: A Wonderful Life-style 3D farming game, but the farm
is ONE persistent shared world the whole family lives in. Kids jump in and out; the farm
keeps existing between sessions. The magic moment: *"I planted this yesterday, my sister
watered it while I was at school, and it's ready to harvest now."* Cooperative, cozy,
never competitive. Same audience rules as the rest of BUCKY: young-kid friendly, gentle
failure states, big readable UI.

## Style & feel targets

- **Look**: HM64/GameCube era — low-poly, warm. Small handcrafted farm valley, NOT
  procedural/infinite. PLAYER = HUMAN farmer kid (user 2026-07-09; humans hold tools).
  **ART DIRECTION (user 2026-07-10): the QUATERNIUS asset family replaces the blocky
  procedural style.** All CC0, one coherent studio style: Farm Animal Pack (animated),
  Farm Buildings, Ultimate Crops (5 growth stages — maps onto our growthStage system),
  a character pack + Universal Animation Library (120+ retargetable clips) for the
  player, plus their food/object packs for future needs (user noted). Conversion order:
  crops → animals → buildings → player character (most integration work last: procedural
  part-animation → AnimationMixer + retargeted clips; tool-use gestures may stay partly
  procedural). Ingestion reuses the proven Farm Kart pipeline + the
  gltf-linear-color-gotcha material pass (MeshStandard→Lambert, sRGB, emissive lift) —
  BUT note farmlife is r169: imported GLB textures still need colorSpace tagging, test
  visually. Procedural stays as fallback where packs lack coverage. A bespoke
  Tripo-generated hero farmer (concept-art-first, retarget the same clip library)
  remains a bounded future option if the stock characters don't land.
- **Camera/controls**: "like Minecraft (3rd person)" — WASD/left-stick camera-relative
  movement, drag-to-orbit chase camera, JUMP is IN (user 2026-07-09). TOOL-BASED
  actions (user 2026-07-09, supersedes the P1 auto-context button): the hotbar holds
  real TOOLS — hoe, watering can, seed pouch, bare hands — and the action button does
  what the equipped tool does. Wrong tool on a target = gentle hint, never punishment.
  The auto-context mode remains a documented FUTURE accessibility toggle for younger
  players ("little kid mode") — design the input layer so both modes share one action
  pipeline, build only tool mode now.
- **Watering can has a tank** (user 2026-07-09): limited uses, refilled by using the
  can at the pond edge. Capacity is a TUNE knob.
- **Mobile is first-class**: drag-anywhere steer + action button, the Farm Kart /
  Bistro touch patterns. Test at 390×844 from P1 onward (tools/mobile-preview.mjs).
- **Time = real time.** No in-game clock to manage. Crops grow in real hours/days.
  Cosmetic day/night lighting synced to actual America/Chicago time (night on the farm
  = night in the game). Stretch: real Woodville weather (existing Open-Meteo
  integration) — when it actually rains at the farm, crops get watered in-game.

## Tech stack (the Vite decision — this game is why)

- **Vite + TypeScript + three.js (npm, modern rXXX)** — the first BUCKY game NOT built
  as a single HTML file. Justification: 10k+ lines of systems (world, farming, sync,
  presence, inventory) want modules + types; growth/validation logic wants to be ONE
  shared module (client now, Netlify function later if server enforcement is ever
  needed); modern three.js from npm ends the CDN-r128-globals era for this project.
- **Layout**: source in `farmlife/` (Vite project, its own package.json — sibling of
  `tools/`, never touches root). Built output committed to `farmlife/dist/` and served
  statically like every other page (games.html links to `/farmlife/dist/`). Netlify
  config stays untouched: BUILD LOCALLY, COMMIT DIST — keeps "push = live" and the
  preview-approval workflow intact. (Alternative — Netlify build command — rejected
  for now: it changes deploy behavior for the whole site.)
- **Existing games are NOT migrated.** This is a one-project exception, not a new
  house convention.
- **State discipline (Bistro lesson, day one):** all world-persistent state lives in
  typed `World` objects mirroring Firestore docs; all live-ephemeral state (avatar
  positions, emotes) lives in a separate `Presence` layer; local-only (camera, input,
  meshes, tweens) stays out of both. Never blur these — it's what makes P2/P3 thin
  layers instead of rewrites.

## The two-layer multiplayer architecture

**Persistence (Firestore — source of truth, survives everyone leaving):**
- The farm exists whether or not anyone is online. No server ticks: growth is a PURE
  FUNCTION of timestamps (`plantedAt`, `wateredLog`) evaluated lazily on read — the
  Baby Bucky giga-pet offline-catchup pattern at world scale.
- Collection `farmlife_<familyKey>` (familyKey = existing roomId(FAMILY_PASSWORD)):
  - `region_<x>_<z>` docs — the farm map split into fixed regions (~16×16 tiles each,
    sized so a doc stays far under 1MB). Fields keyed `t_<x>_<z>` per tile:
    `{kind: grass|tilled|planted, crop?, plantedAt?, lastWatered?, waterCount?}`.
    Writes are per-tile field updates (`updateDoc` field paths) so two kids editing
    different tiles in the same region never conflict.
  - `player_<name>` docs — identity = localStorage `choreUser` (house convention):
    inventory, coins, last position, unlocks.
  - `meta` doc — farm-wide facts (name, founded date, shipped-crop totals, milestones).
- Live sync via `onSnapshot` — edits appear on everyone's screen in ~1s. Farming
  actions are low-frequency; write volume is trivial at family scale.
- **Firestore rules are public (existing posture)** — family-trust model, same as
  chores/bank. Anti-cheat = none, on purpose: coins are purely in-game (the Farm Bank
  tie-in was cut 2026-07-09), so there is nothing real to protect.
- **Test discipline (goat-dup lesson, non-negotiable):** every headless test blocks
  `/googleapis|firestore|firebase|gstatic/` unless deliberately targeting the
  `?fam=` test-family override (`famtestfl`), and cleans up its docs after. NO
  auto-seeding path may write without a server-confirmed (non-fromCache) read first.

**Presence (Playroom — ephemeral, who's on the farm right now):**
- Avatars, positions (~10Hz), facing, current animation, emotes. NOTHING of value
  lives in the Playroom room — if the room dies, the farm never notices; client
  silently rejoins/recreates. This dodges the host-leaves-session-ends problem that
  bites Bistro/Kart, because there is no host-authoritative sim: Firestore is the
  authority and every client applies its own farming actions there.
- Family-lobby integration (proven ported pattern, see Farm Kart port): being on the
  farm registers `lobbies_<familyKey>/fl_<code>` → games.html shows a live
  "🌱 <name> is on the farm — n playing" JOIN card via the existing `LOBBY_TEXT` map.

## Phases (one per run; user playtest gates every arrow)

**P0 — scaffold + walkable farm (the feel gate)**
Vite/TS project boots; deploy pipeline proven (build → commit dist → preview at
localhost + mobile-preview). One handcrafted farm valley (terrain, fences, farmhouse
blockout, pond) — Kenney/Quaternius CC0 props (assets/farmkart/props pipeline +
[[gltf-linear-color-gotcha]] material conversion) + procedural. Player character
(procedural goat-kid or reuse cast) with walk/run/idle, chase camera, mobile touch
controls. TUNE slider panel from day one (Farm Kart convention — camera + movement
feel are load-bearing). NO gameplay yet. **Gate: does walking around the farm feel
good on phone and desktop?**

**P1 — the farming loop, solo + local (playable slice)**
Till → plant → water → grow (real hours; 4 starter crops with staggered times: e.g.
turnips 4h, potatoes 12h, corn 1d, pumpkin 3d) → harvest → sell at the shipping bin →
coins → buy seeds at a stand. Growth = the shared pure `growthStage(tile, now)` module
with unit tests (first real unit tests in BUCKY — part of why Vite). Persistence to
localStorage FIRST (fast iteration, no Firestore risk while the model churns —
[[pasture-panic-save-data-not-precious]] applies). Crop meshes: procedural stages
(sprout → plant → ready, Bistro-style readable shapes). **Gate: is the loop fun for
10 minutes?**

**P1.5 — character & tools rework + world editor (added 2026-07-09 after the P0/P1
user playtest approval with changes)**
- **P1.5a**: replace the goat kid with the procedural human farmer; add jump; tool
  system (hoe/can/seeds/hands as hotbar tools, 3D tool models held in hand, use
  animations: hoe swing, tilt-pour with droplets, plant scatter, harvest scoop);
  watering-can tank + pond refill; wrong-tool hints; water meter on the can slot.
- **P1.5b**: WORLD EDITOR (Farm Kart precedent — Dad's tool, direct URL, not linked):
  its own Vite entry `farmlife/editor.html`. PORT the proven Farm Kart editor concepts
  from farmkart-editor.html + assets/farmkart-track.js into farmlife TS modules:
  terrain sculpting (sparse world-anchored heightfield deltas, bilinear sampleField,
  brush w/ falloff), terrain painting (sparse color grid blended into vertex colors),
  object placement (palette of procedural props + TransformControls gizmo, tag field),
  fence polylines (terrain-following posts+rails). World data = one typed `WorldData`
  saved via the same store-interface pattern (localStorage `fl_world_v1` now, cloud in
  P2); the GAME loads and renders it — empty world = today's handcrafted valley
  unchanged. sampleHeight in terrain.ts stays the single height authority (Farm Kart
  Stage-A lesson: never two height functions); the farming field stays flat/protected.
**Gate: farming with real tools feels good; editor round-trips a decorated world.**

**P2 — persistent shared world (the mini-MMO moment)**
Swap localStorage for the Firestore region/player model (the storage interface from P1
makes this a backend swap, not a rewrite). Lazy growth from timestamps verified across
devices; onSnapshot live edits; per-tile write granularity; offline/blocked-Firestore
degrades to read-only-ish local play with honest UI. Seed/first-run guards per the
herd-dup hardening. **Gate: plant on one device, harvest hours later on another;
two family members farming simultaneously see each other's edits.**

**P3 — live presence (see your family)**
Playroom layer: avatars + name tags, ~10Hz positions with interpolation, join/leave
toasts ("Eleanor arrived at the farm 🌻"), emotes (E / touch button, Bistro pattern).
Family-lobby card in games.html. Optional bell notification via notify.mjs ("Isaac is
on the farm!"). **Gate: two phones, walking around together feels alive.**

**P4 — animals + the farm comes to life**
Goats obviously (Tripo quadruped rig pipeline — its actual first BUCKY use — or the
proven procedural splitBabyGoat approach as fallback), chickens. Pet/feed daily →
produce (milk/eggs) on real-time cadence, same lazy-timestamp math as crops (kindness
caps: animals never suffer for the family being away — Baby Bucky rule). Cosmetic
day/night by real Central time. Stretch: real Woodville rain waters crops (Open-Meteo,
cached, the weather.html integration). **Gate: kids voluntarily return two days in a
row to check on animals.**

**P5 — economy + content**
(Farm Bank tie-in CUT — user decision 2026-07-09: game coins stay purely in-game.)
More crops, decorations/placeables (fences, paths, flowers), farm milestones and
shipped-crop totals on the meta doc. **Gate: user playtest of the content pass.**

**P6 — polish + release**
WebAudio SFX set (house style: synth, no files) or ElevenLabs if key is set; ambient
birds/night crickets; particles (water splash, harvest pop, sparkles); seasonal
touches. Full QA sweep: threejs-qa-release checklists — browser console clean, 390×844
+ desktop screenshots, perf budget on a low-end phone profile, bot-playtest of the
core loop, dist build verified. games.html tile + Play-area card. Push after preview
approval.

## Data model sketch (v1 — refine in P1/P2)

```ts
type TileKind = 'grass' | 'tilled' | 'planted' | 'path' | 'blocked';
interface Tile { k: TileKind; c?: CropId; p?: number /*plantedAt ms*/;
                 w?: number /*lastWatered ms*/; n?: number /*waterings*/ }
interface Crop { id: CropId; name: string; emoji: string; growMs: number;
                 stages: 3; waterEveryMs: number; seedCost: number; sellPrice: number }
// growthStage(tile, crop, now) -> 0..stages | 'ready' | 'wilted(gentle)'
// PURE FUNCTION — the whole persistence model hangs on this being deterministic.
interface PlayerDoc { name: string; coins: number; inv: Record<ItemId, number>;
                      pos?: {x:number; z:number}; lastSeen: number }
```

Wilting is GENTLE (kindness-cap posture): an unwatered crop pauses growth, never dies;
watering resumes it. No punishment mechanics anywhere.

## Risks & mitigations

- **Scope creep** (the Stardew trap): phases are hard-gated; nothing from a later
  phase leaks earlier; "mini" is the product, content grows only after P6 ships.
- **Region-doc write contention**: per-tile field paths + last-write-wins is fine at
  family scale; revisit only if real conflicts observed.
- **Firestore cost**: farming writes are tiny; presence NEVER touches Firestore
  (Playroom only). Watch read volume from onSnapshot in P2 verification.
- **Vite pipeline friction**: P0 exists to burn this down first; if build-and-commit
  proves annoying, evaluate Netlify build config as a deliberate follow-up decision.
- **Modern three.js unknowns**: the team's r128 gotcha library may not transfer 1:1;
  P0 feel gate flushes renderer/color-space surprises early (expect the
  outputColorSpace/sRGB changes to bite once).

## Build log (2026-07-09/10 — P0 through P6 built in one autonomous run)

- [x] **P0** scaffold + walkable valley (opus): Vite/TS/three r169, farm valley, goat-kid
      (later replaced), chase cam w/ terrain clamp, mobile joystick+orbit, TUNE panel.
      14/14. r169 finding: procedural colors just work; CanvasTexture maps still need
      `colorSpace = SRGBColorSpace`; GLB imports would still need the r128 conversion.
- [x] **P1** farming loop (sonnet): 12×12 field, facing-aware targeting, 4 crops,
      pure growthStage + vitest (BUCKY's first unit tests), LocalFarmStore (fl_farm_v1,
      debounced + pagehide flush), shipping bin + seed stand, HUD. 10 unit + 32/32.
      Time-travel testing via farm/time.ts now()+offset (`__FL__.farm._setTimeOffset`).
- [x] **P1.5a** human farmer + tools (opus, user rework): straw-hat farmer, JUMP
      (Space; action moved to E; mobile JUMP button), tool hotbar (hands/hoe/can/seeds),
      held 3D tools + 5 use anims (arm-quat verified — no frozen-arm), can tank +
      pond refill, wrong-tool hints (rate-limited), resolveAction(mode:'tool'|'auto')
      seam unit-tested both modes ('auto' = future little-kid toggle, no UI yet).
      23 unit + 38/38 + 26/26.
- [x] **P1.5b** world editor (opus): editor.html second Vite entry; ported Farm Kart
      concepts (sparse heightfield sampleField bilinear + smoothstep brush, paint grid,
      TransformControls objects w/ tags, fence polylines) into THREE-free typed modules;
      11-prop registry w/ collision descriptors; field protected from brushes;
      EMPTY WORLD = BYTE-IDENTICAL terrain (max diff 0.0, unit-asserted). 16/16.
- [x] **P2** Firestore shared world (sonnet): firebase@11 modular SDK (+223KB gz),
      farmlife_<familyKey>: region docs (t_x_z fields), player_<name>, meta, world;
      serverConfirmed write gate, one-time local→cloud migration, per-tile debounced
      writes, onSnapshot live diffs, offline fallback + sync pill. 22/22 vs REAL
      Firestore famtestfl (2 browser contexts), cleanup verified empty.
      POST-P3 FIX (opus): harvest-revert race — the torn-write guard froze player
      fields to last-SENT (stale) values; echo during the 1s debounce reverted local
      progress and the stale value then got PERSISTED. Fix: mergeLocalDirty — locally
      dirty fields win over echoes until write ACK (release guarded by reference
      identity; second-device same-user = last-write-wins, documented). Same
      protection extended to dirty tiles. 6/6 consecutive 22/22 runs.
- [x] **P3** Playroom presence (opus): ONE persistent auto-join family room
      (roomCode = "FL"+familyKey sanitized, explicit roomCode — never #r= hash),
      state {x,y,z,h,tool,anim/emote seqs} ~10Hz + instant on change, 120ms interp,
      shirt-tint remote farmers + canvas name tags, synced tool anims, emotes
      (Z/X/C + 💬 picker — E was taken), join/leave toasts, lobby doc fl_farm w/
      OLDEST-PRESENT single-writer hand-off → games.html JOIN card (LOBBY_TEXT +
      new lobbyHref() per-game href — farmlife/dist/, no hash). 25/25 vs REAL
      Playroom, 2 processes. Firestore stays sole farm authority.
- [x] **P4** animals + day/night + weather (sonnet): 2 goats + 3 chickens (Clover/
      Buttons/Henrietta/Nugget/Peep), animals doc a_<id> fields on the same session
      listener, seedIfEmpty AFTER serverConfirmed (dup-guard: exactly 5 across
      reload, 2-device verified), hands-tool feed/collect/pet priority resolver,
      produce = pure lazy fn (milk 12h/egg 8h, care window 24h ≥ produce cycle =
      kindness cap: any absence → exactly one produce waiting, never sick — no such
      field exists), day/night keyframes from real Central time via now() (testable),
      Open-Meteo real Woodville weather (fl_wx cache, degrade to clear) — real rain
      = particles + auto-water via normal waterTile path (idempotent). 117 unit +
      39/39. Fixed a TDZ boot crash (weather cache callback ran synchronously).
- [x] **P5** content (sonnet — NOTE: violated no-delegation rule, re-verified
      independently): 8 crops total (strawberry/carrot/tomato/sunflower added),
      🎀 Decorate shop tab (8 items), ghost-preview placement (valid/invalid, rotate,
      Esc/✖ cancel+refund — walk-away cancel dropped deliberately), decor doc d_<id>
      shared live, 2-tap remove confirm, milestones on meta doc via TRUE Firestore
      increment() (concurrent-sell proven exact), 📖 Farm Book panel. 158 unit + 39/39.
- [x] **P6** polish + QA (opus): WebAudio synth SFX set + day/night/rain ambient
      beds (fl_muted/fl_sfxvol, M key + TUNE rows, first-gesture unlock), camera
      occlusion FADE (raycast every 3 frames + hysteresis; instanced trees swap a
      pooled fade-proxy + zero-scaled instance; buildings fade in place), proper hoe
      model + inline SVG icon (no hoe emoji exists), collider handles + removeByTag
      (stale-collider leak fixed), branded loading card w/ choreUser greeting,
      games.html GAMES tile + index.html PLAY_GAMES entry. Perf: 36-37 draw calls,
      ~40k tris. Full QA table green (one stale p2 assertion fixed after). Bot
      playtest full loop 0 pageerrors.
- [x] **FIX BATCH 1** (2026-07-10, user playtest, opus): (1) L/R REVERSED — chaseCam
      rightVec() was the negation of screen-right (cross-product sign); fixed the one
      shared strafe path (keyboard+joystick), p0 gained an explicit strafe assertion
      (only forward was ever tested — how it slipped). (2) SHOP CLOSE dead — proximity
      loop reopened it next frame; shopDismissed latch (clears on walk-away). (3) EDITOR
      BLANK — not reproducible in built dist even w/ network+played localStorage; real
      repro = opening /farmlife/editor.html (source path, module script 404s under the
      static server) → fixed source path + added a 4s boot WATCHDOG that names the right
      URL instead of silent blank; verify-editor gained a network-ON section (22/22).
      (4) PATHS painted not meshed — DEFAULT_PATH_PTS + pure pathBlend() baked into
      buildGroundMesh BEFORE editor paint (clear-paint can't erase them), path meshes
      removed (draw calls 36→35), heights untouched (byte-identity still 0.0). 160 unit.
- [x] **P7 map + inventory** (2026-07-10, user request; run survived a process restart
      mid-way — resumed from transcript, partial work verified then completed): 🗺 MAP
      (Tab / button): Canvas2D, north-up, TWO-LAYER cache (static bg offscreen keyed by
      world signature, invalidated on reconcileWorld; dynamic layer per frame) — field
      grid w/ READY tiles pulsing gold, stations/pond/painted paths/props/fences/decor,
      animal emoji dots, self = facing arrow, remotes = shirt-tint dots + names, legend;
      full-screen sheet ≤520px. 🎒 INVENTORY (I / button): seeds (tap = select crop +
      equip pouch + close, one tap to planting-ready), produce w/ sell prices + total
      ("Worth 🪙 N at the bin!"), tools row w/ tank meter; single source of truth =
      FarmState, signature-guarded re-render, live updates while open. New pure
      mapProjection module (7 unit tests). 167 unit + 46/46, regressions green.
- [x] **P8 Quaternius world conversion** (2026-07-10, opus): crops/animals/buildings →
      Quaternius CC0 GLBs (+1.6MB total; public/models/ + LICENSE.txt). New
      gltfAssets.ts pipeline — **r169 HOUSE-KNOWLEDGE UPDATE (differs from the r128
      recipe!)**: convertLinearToSRGB on solid colors is WRONG under r169
      ColorManagement (double-corrects → washed out; REMOVED), Lambert swap still
      needed (no env map), emissive lift 0.34→0.12, `skinning` material flag gone
      (automatic on SkinnedMesh — no frozen-bind-pose). Chicken = skeletal
      (Idle/Walk mixer); GOAT = Poly-by-Google **CC-BY** (credited; no CC0 goat
      exists — Tripo-generated rigged goat is the future option), procedurally
      animated. Buildings reuse farmkart GLBs. Procedural fallback on any load
      failure. 17/17 + all regressions.
- [x] **P9 Quaternius player** (2026-07-10, opus): Quaternius "Farmer" (CC0, cowboy
      hat/overalls, 1.37MB, 62-bone rig, 24 clips). Mixer Idle/Walk/Run + clip-mapped
      actions (hoe=Sword_Slash, plant/harvest/pet=Interact) + additive post-mixer
      quaternion overlays where no clip fits (water pour, refill dip, HOLD-UP beat,
      jump tuck) — never write bone.rotation.x (frozen-arm rule). RIG GOTCHAS
      (documented in player.ts): bone names lose dots in three; root motion stripped
      per-frame; armature ×100 scale puts the wrist BONE origin ~5m from the visible
      hand — tools attach via applyBoneTransform on a wrist-weighted vertex. Remote
      tint = clothing materials 62% toward player color, skin natural. Procedural
      farmer kept as offline fallback. 34/34 + full regression sweep green.
- [x] **RIGHT-CLICK batch** (2026-07-10, user): (a) right-click = action (contextmenu
      suppressed on canvas; right button excluded from orbit); (b) WALK-THEN-ACT —
      right-click raycasts the ground to a field tile: in-reach → act on THAT tile
      (explicit target, never the facing heuristic), distant → auto-walk at run speed
      to a stand point then act; cancels on manual input/jump/new click/placement/6s
      timeout/650ms jam; label+highlight follow the clicked tile mid-walk; tiles only
      (stations/animals keep proximity behavior); (c) **FAST-GROW TEST TOGGLE — ⚠️ ON
      BY DEFAULT, MUST FLIP OFF IN tune.ts TUNE_DEFAULTS BEFORE SHIP** — effectiveCrop()
      accessor scales every crop to 60s growMs / 30s waterEveryMs (pure growthStage
      untouched; unwatered-pause still testable — one watering after the 30s grace
      carries to maturity); TUNE panel "🌱 Fast grow" toggle persisted; all 12 verify
      suites seed fastGrow OFF (they assert real timelines). 173 unit + verify-p10
      21/21 + regressions green.
- [x] **ANIMAL HUSBANDRY REWORK** (2026-07-10, user design): the P4 cosmetic circular
      "pen" wander is replaced by a real husbandry sim. NEW LAYOUT: a 30×22 fenced
      PASTURE (`farm/pasture.ts` PURE geometry: bounds x22..52,z-8..14) ENCLOSING a
      functional BARN (footprint x33..42,z6..13, hugging the north fence; door on the
      south wall facing the open grazing area). Player GATE = a gap in the west fence
      (walk-through for the player — NO collider there — but part of the boundary for
      animals). Silo beside the barn. The old decorative farmstead (barn+silo blockout in
      scenery.ts) was DELETED; `buildFarmstead`/`rebuildFarmstead`/the `farmstead`
      occluder are gone; `farFromStuff` now excludes the pasture so trees/rocks don't
      spawn in it. BARN + fence + door + eggs live in the new `world/barn3d.ts`
      (procedural THREE; registers player colliders = walls minus the always-passable
      door opening + fence minus the gate gap; barn root registered with the P6 Occlusion
      manager so the near wall/roof FADE to see inside). CONTAINMENT: `containAnimal(x,z,r,
      doorOpen)` clamps to the pasture + pushes off barn walls (south wall split around
      the door; a sealed segment added when the door is shut) + the silo — the door is the
      ONLY barn↔pasture passage and only when open; the gate/fence is solid for animals.
      A `funnelTarget()` two-stage waypoint (line up at DOOR_OUTSIDE → step through
      DOOR_INSIDE) makes animals cross the gap without pathfinding (fixed a threshold
      oscillation). ROUTINE (shared clock → all devices agree): `dayPhase(ms)` from
      centralHour — dawn 6-8 / day 8-18.5 / dusk 18.5-20.5 / night otherwise. animals3d.ts
      state machine: DAY/DAWN graze (south-biased waypoints, occasional head-down graze
      pose, may wander into the barn if open); DUSK walk to the barn (inside if open, else
      settle just OUTSIDE the shut door — a one-time "waiting by the barn door 🌙" toast,
      no penalty); NIGHT sleep (lying goat / hunkered chicken + drifting 💤 sprite);
      interactions still `wake()` a sleeper. PHYSICAL EGGS: chickens lay an EGG MESH at a
      deterministic barn-floor nest when their 8h cycle completes (`maybeLayEggs` each
      tick; deterministic `eggId(chicken,lastFed)` → re-spawn merges same key, never a
      dup); hands-action an egg = +1 egg, cycle reset, pop+chime. GOAT MILK/PET (exact user
      spec): `resolveAnimalAction` now = milk-ready goat→collect (milk beat), else pet;
      chickens only ever pet. FEEDING REMOVED (grazing IS feeding — no hunger gate; care =
      produce accrues continuously, capped at one; 7-day absence → exactly one milk/egg
      waiting, documented in animals.ts). SHARED STATE: new `barn` doc (door {open,at} +
      `e_<chicken>_<cycle>` egg fields) via LocalBarnStore/CloudBarnStore (mirrors decor
      store; local-dirty guard; egg-race resolves to ONE collector via LWW collectedBy +
      loser-reconcile — the reconcile re-fires after our own write acks so the loser
      finally sees the winner + gets a "<name> got that one! 🥚" toast). Door toggles
      animate live across devices. MAP shows the pasture fence+gate, barn footprint, live
      door state + waiting egg count. animals.test.ts + new pasture.test.ts rewritten
      (180 unit total). verify-p11.cjs 34/34 (routine, containment, eggs, milk/pet, gate,
      + live famtestfl door-sync/egg-race/migration; cleanup confirmed empty) + 3
      screenshots. Existing suites updated where they asserted the OLD model: verify-p4
      (pasture bounds not pen; milk/pet not feed; 37/37), verify-p6 (milk not feed),
      verify-p7 (pasture bounds; also bumped its own act()/faceTile settle to fix a
      pre-existing rAF-timing flake in the crop-ripen path — product proven correct via
      p1 40/40 + a direct probe; 46/46). p8/p10 green, `npm run build` + `tsc` clean.
- [x] **P11 ANIMAL HUSBANDRY rework** (2026-07-10, user design, opus): 30×22 fenced
      PASTURE (x 22-52, z -8-14) enclosing a new FUNCTIONAL barn (src/world/barn3d.ts,
      procedural w/ real interior + occlusion-registered walls/roof; replaced the P8
      decorative farmstead — buildFarmstead deleted). Hinged DOOR (hands-action toggle,
      swing anim, SHARED barn doc field, live A→B sync); player GATE in west fence
      (walk-through for player, solid for animals). Behavior from dayPhase(now()):
      day graze (waypoints, head-down pose) / dusk walk home (closed door = settle
      outside + one gentle toast, no penalty) / night sleep (lying/hunkered + 💤,
      interactions still work) / dawn out. containAnimal clamps pasture + barn walls
      (door gap only passage); funnelTarget 2-stage waypoint crosses the doorway.
      EGGS = physical meshes on the barn floor: deterministic id e_<chicken>_<cycle>
      (re-spawn merges same key — never dupes), hands-collect, 2-context race → ONE
      collector via LWW + reconcile-after-ack ("<name> got that one! 🥚" for the loser).
      GOAT: hands = milk-if-ready else pet (user spec: first action milks, second pets);
      FEEDING REMOVED — grazing is feeding; kindness caps unchanged (7-day absence =
      exactly one produce waiting). lastFed kept as wire-compat cycle checkpoint; legacy
      docs migrate clean. 180 unit + verify-p11 34/34 + FULL suite green (p0-p10, p15,
      editor). FOLLOW-UP NOTED: the new procedural barn reads rougher than the P8
      Quaternius barn it replaced (roof shape esp.) — needs a beauty pass or a
      door-cut Quaternius hybrid.
- [x] **BARN v2 — first Blender-MCP-authored building** (2026-07-10): modeled live in
      Blender 5.1 via the MCP bridge (source assets/blender/farmlife-barn.blend, house
      convention) → farmlife/public/models/buildings/barn2.glb (49.9KB). Two nodes:
      "Barn" (gambrel + gables + trim + interior floor + 3 straw nests at local x
      -2.6/0/+2.6) and "Door" (X-brace panel, ORIGIN AT THE LEFT JAMB — game rotates the
      node; authored front = glTF +Z = game south, true world scale 9×7×6.3, door
      3.2×2.7). Blender gotchas hit: Principled base colors must be LINEARIZED from
      sRGB hex (else salmon); 5.1 has no BLENDER_EEVEE_NEXT enum; AgX view transform
      washes saturated colors in review renders (use Standard). MCP STARTUP: addon
      silently loses enabled state — see memory [[blender-mcp-startup-fix]] (CLI
      relaunch w/ addon_utils.enable + save_userpref). INTEGRATION (sonnet):
      instantiateWorldScale() (no unit normalization), 180° Y flip, bbox-centered on
      the BARN footprint (documented ~0.5m door-panel-vs-gap offset — the pasture door
      gap is off-center by design; funnel waypoint still inside the visual opening),
      GLB Door node driven by shared doorAngle (sign flipped inside rotated parent),
      procedural barn kept as offline fallback, occlusion via the same barnRoot group
      (interior visible, near wall fades to ~22%), nests/egg spots aligned to the GLB.
      r169 pipeline handled materials with zero changes. 180 unit + p11 34/34 ×2 +
      p7/p8/p9 green (p6 48/49 = the pre-existing tree-occlusion flake, stash-verified
      unrelated). WORKFLOW UNLOCKED: bespoke functional models (pivots/cutouts/
      interiors) via Blender MCP; next candidates: pasture gate, chicken coop.
- [x] **ART DIRECTION LOCKED: full Blender + the "Sunny" player pipeline** (2026-07-10):
      user chose FULL-BLENDER art (three reference images in Examples/; north star =
      soft-beveled chunky chibi, Examples/Character North Star.webp). STYLE KIT =
      assets/blender/farmlife-stylekit.blend: 23 locked FL_* palette materials, bevel/
      proportion conventions, approval VIGNETTE (ground/path/fence/tree/pumpkins/
      chicken/girl — shots/farmlife-style-vignette.png). SUNNY PLAYER PIPELINE (the
      full hybrid workflow, all in one session): user's Meshy web-workspace generation
      (Examples/Meshy_AI_Sunny_Pigtail_Kid_*.glb, preview mesh: 3,088 tris, NO
      materials/UVs/rig, T-pose, 13 loose parts) → colored in Blender per-part +
      polygon-region splits (hair/face on the fused head; sleeves/mitts/shoes on the
      body shells) from the FL_ palette → Meshy AUTO-RIG via API (11 credits total:
      rig 5 + idle 3 + Charged_Axe_Chop 3; MESHY_API_KEY now in User env; height 0.9;
      CHIBI PROPORTIONS RIGGED FINE — 24-bone Mixamo-style skeleton, T-pose intact,
      walk/run free with the rig) → Meshy STRIPPED ALL MATERIALS from the rigged GLBs
      (0 materials/vcols; known pipeline behavior now) → colors RE-TRANSFERRED in
      Blender via BVH nearest-face from the original colored mesh (3,088/3,088 polys,
      Meshy kept face count, split verts 1.6k→8.9k for skinning) → 4 actions packed
      (Idle/Walk/Run/HoeChop via NLA stash + export_animation_mode='ACTIONS') →
      farmlife/public/models/character/sunny.glb (680KB). Blender 5.1 anim gotchas in
      memory [[blender-mcp-startup-fix]] (action_slot! layered fcurves! shade_smooth_
      by_angle! linearized colors! Standard view transform!). Integration to the P9
      player pipeline delegated (bone remap Mixamo names, HoeChop subrange for the
      hoe, overlays for other tools, RightHand tool anchor, FL_Overall/FL_Shirt tint).
      NOTE for the family: Sunny is currently THE avatar for everyone — a boy variant
      (Isaac) would be another cheap Meshy round when wanted.
- [x] **ART DIRECTION FINAL: 2D MODERN PIXEL** (2026-07-11, user decision after a
      full fresh-start exploration): user rejected soft-chibi 3D, voxel (basic AND
      duck-grade premium), Meshy-flat, Meshy-textured, and the hybrid Ellie. Fresh
      3-proposal round (research: Fall Guys mannequin design, cozy-trend) produced
      3D plush-bean (vinyl look-dev won its round) vs 2D flat-vector vs 2D pixel;
      user picked CLASSIC PIXEL pushed to MODERN fidelity (Fields-of-Mistria class:
      320×240-ish native, 4-5 shade hue-shifted ramps, selective outlines, lush
      ground detail, 28px farmer). Approved mockup: shots/2d-modern-pixel.png,
      source scratchpad 2d-modern-pixel.html (canvas-drawn — sprites-as-code is the
      asset pipeline). ANIMATION = puppet-over-pixel-parts (Dead-Cells technique):
      parts authored once, tweened in code — same economics as the bean, no frame
      sheets. COSMETICS = layered part sprites on anchors (hat/hair/outfit) + tints.
      **THE 2D PIVOT**: replaces the three.js render layer with a Canvas2D
      integer-scaled pixel renderer (bundle sheds three.js ~500KB); top-down world
      mapped from the existing farm layout (field/pasture/barn/pond/stations
      preserved in 2D coords); jump becomes a cosmetic hop (shadow squash); 3D world
      editor + sculpt/paint DEPRECATED for now (2D tile editor = future follow-up);
      GLB/Quaternius/Blender-model pipeline retired for farmlife (barn2.glb etc.
      stay on disk; Blender remains for other games). ALL simulation/sync layers
      survive untouched: growth/action/animals pure logic, FarmState/stores,
      Firestore region docs, presence (x,z → 2D), lobby, HUD systems, weather,
      day/night phase (renders as palette tint now). Conversion runs R1 renderer
      core → R2 gameplay parity → R3 MP/mobile/QA; many verify suites need 2D
      rewrites (unit tests survive).
- [x] **THE 2D CONVERSION, R1-R4 — COMPLETE** (2026-07-11, four opus rounds):
      R1 renderer core (Canvas2D integer-scaled ~480×270, sprites-as-code atlas,
      tilemap world preserving the farm geography, puppet farmer 4-dir + hop,
      tile collision, day/night as capped-readable tint; 28/28). R2 gameplay parity
      (8 crops × 4 states at mockup fidelity, held tools + tween use-anims incl. the
      hold-up beat, click/tap walk-then-act, barn roof-fade cutaway interior w/ warm
      light pool, upgraded stations + coin-arc, pixel rain/snow + puddle glints,
      all 8 decor sprites + placement mode, map re-sourced; 39/39). R3 MP/mobile/QA
      (remote farmers = tinted pixel puppets + pixel name tags + anim/emote replay —
      wire format UNCHANGED (3D/2D clients interop); analog joystick + tap-vs-drag
      (12px/260ms discrimination); THREE structurally out of the module graph
      (161→160 modules — tree-shaking had already stripped ~99%, now guaranteed);
      QA rebuilt: verify-2d-r1/r2/r3 + one-command verify-2d-all, stale 3D suites →
      farmlife/legacy-verify/; perf ~0.8ms/frame; 51/51 incl. live 2-process
      Playroom + famtestfl cloud, cleanup verified). R4 user-feedback round
      (MEASURED SCALE PASS: buildings to genre ratios as billboards over unchanged
      footprints — farmhouse 1.9×→5.5× farmer, silo 5.2×, trees 2.6-3.9×, doors
      ≥1.43×; barn kept 4.8× cutaway deliberately — its door faces the herd;
      INTERIOR SCENE SYSTEM: scenes.ts stack, door ⏎ prompt → 280ms fade →
      farmhouse cozy room (fireplace/bed/rug/day-night windows), exit mat back,
      MP publishes door coords while inside (no wire change), map 🚪 markers,
      future rooms = data + draw fn; AUTO-TILING: blob-style terrainCoverage +
      Bayer 4×4 dither for path/field-edge/pond-bank/barn-door-wear transitions;
      29/29). **TOTAL: verify-2d-all 115/115, npm test 180/180.** Punch-list:
      fastGrow still ON (ship-blocker), audio first-gesture hint, barn roof beauty
      pass, interiors decorative (bed/storage = future), 2D tile editor = future.
      FEATURE ROADMAP written from the Stardew/Mistria/Harvest-Moon research →
      **farmlife-roadmap.md** (9 tracks, M1-M6 build order, tractor = signature).
- [x] **R5 — 3 PLAYTEST CHANGES (fade-behind · solid buildings · FREE-FORM farming)**
      (2026-07-11): the user playtested the LIVE 2D game and asked for three things.
      (1) FADE-BEHIND OCCLUSION (render2d + main): any TALL sprite — trees always,
      placed decor ≥16 px tall (scarecrow/gnome/birdbath/flag/pinwheel; NOT flat
      bench/bed/path, NEVER buildings) — whose sort baseline is IN FRONT of (higher z
      than) the LOCAL player AND whose sprite rect overlaps the player's rect fades to
      0.45 alpha over ~150 ms (per-sprite exponential lerp in `spriteFade`), restoring
      when the player walks out. VIEWER-LOCAL by design: only the local player drives
      it (a remote family member behind a tree on their screen doesn't fade it on
      yours — documented; the fade is inherently per-client). `fadeAlphaFor()` in main,
      `flHook.render.fade(key)` for tests. (2) SOLID BUILDINGS (Stardew rule):
      `plots.BUILDINGS` = solid footprint boxes for farmhouse/silo/bin/stand (barn
      UNTOUCHED — its cutaway + door-gap + pasture routing kept); each expands to ~the
      full visual base so a player can never walk behind + vanish. Door approaches +
      shop/sell proximity stay clear (south side kept open); the bin box was pulled
      east of the adjacent FIELD GATE so the gate stays walkable (its south lane clear).
      Boot-time `nudgeFromCollider()` slides a saved position that now sits inside a
      collider to the nearest open tile (one-time, silent). (3) FREE-FORM FARMING — the
      12×12 GRID IS GONE. New pure `farm/plots.ts`: `Plant {id,x,z (continuous),crop,
      plantedAt,accruedMs,lastWatered,waterings}` (growth.ts math reused VERBATIM per
      plant — `growthTileOf` adapter) + `TilledPatch {id,x,z,r}` organic soil circles.
      HOE tills a patch at the aimed point (re-hoe within 0.72 m EXTENDS it up to
      1.8 m; overlapping patches MERGE into one blob). SEEDS plant at the exact point
      IF ≥0.7 m from every other plant (too close = red ✕ ghost + gentle hint, no
      punishment). CAN waters the nearest plant + a SPLASH credits neighbours within
      1.0 m (spec said 0.6, but that sits BELOW the 0.7 spacing → inert; bumped so a
      min-spaced cluster actually gets watered together — documented). HANDS harvest
      the exact ready plant (hold-up beat unchanged). RENDER: Field2D re-baked a
      dithered soil-disc STAMP layer (dynamic analog of world2d's bake-time
      terrainCoverage — patches change at runtime) blitted like the static map,
      re-baked only on a `patchVersion` bump; plants y-sorted from `FarmState.plants`;
      damp ring under watered plants; the tile-rect highlight → a small pulsing GROUND
      MARKER at the point. The baked FIELD SOIL is GONE (the fenced field is grass now,
      decorative starter geography, tillable like anywhere). WIRE (sync.ts): plants
      (`p_<id>`) + patches (`tp_<id>`) ride the SAME region docs, keyed by WORLD POS
      (`regionKeyForWorldPos`, 32 m regions); toWire/fromWire/diff for both; CloudFarm
      store diffs+writes them by region (removals → null field, region from last-sent
      coords) with the local-dirty echo guard extended. MIGRATION: legacy `t_<x>_<z>`
      tiles → plants (at tile centres) + patches, DETERMINISTIC ids `p_mig_<gx>_<gz>` /
      `tp_mig_<gx>_<gz>` (so concurrent devices / re-runs converge — the signature
      dup-incident class), exactly-once. LOCAL: `sanitizeFarmState` migrates an
      old-shape save + clears tiles. CLOUD: `buildFarmStateFromDocs` converts leftover
      t_ in memory (same ids), `CloudFarmStore.migrateTiles()` persists p_/tp_ + clears
      t_ (null) + sets a `mig_freeform` marker on region_0_0, serverConfirmed-gated.
      MAP: plant DOTS (gold when ready) + soil blobs, tile-grid inset dropped, field →
      faint outline. HUD/render/hooks/farmMap all switched off `.tiles`. VERIFIED: npm
      test 206/206 (+26: plots.test.ts spacing/coverage/merge/migration/geometry; sync
      plant/patch wire+region+diff+migration); verify-2d-all 142/142 offline (r1 "E
      tills a patch", r2 full free-form loop + 8-crop distinct + click/walk-then-act at
      points + map dots, r3 offline patch-till + free-form tap, r4 patch-edge dither
      replaces the dead field-soil edge, NEW r5 27/27: fade behind→0.45→restore +
      buildings-never-fade, solid-behind-blocked + door-open + nudge, free-form
      loop incl. too-close ghost + splash + exact harvest, patch-merge blob, LOCAL
      migration once/no-dup); full r3 cloud+MP 54/55 vs REAL famtestfl+Playroom (A
      plants free-form → B sees it at the same coords; legacy t_ → p_mig_3_3 migrates
      once, 2nd device no-dup; cleanup empty — the 1 fail is the PRE-EXISTING lobby
      pagehide-delete race in net/lobby.ts, untouched, fails identically each run). 0
      pageerrors desktop+mobile. Shots: farmlife-2d-r5-freeform (organic scattered
      garden) / -fade / -solid. Changed-assertion list documented in the R5 report.
      DEVIATIONS: splash 0.6→1.0 (see above); rocks excluded from fade (shorter than
      the farmer); dead `farm/field.ts`/`targeting.ts` grid helpers left (tree-shaken).
- STATUS: R5 LOCAL/UNCOMMITTED awaiting user preview + approval before push (the
  R1-R4 2D conversion + Farm Kart batch went LIVE 2026-07-11, commit a7c5e27; R5
  changes the save/wire shape via the free-form migration, so it ships only after
  the user's look). Open punch list: fastGrow still ON live (ship-blocker for real
  pacing), audio needs first tap (no hint shown), lobby pagehide-delete race in
  net/lobby.ts (pre-existing, 1 flaky MP check), dead grid modules to delete,
  plant-cap (400) untested headless.

## House rules that bind this project

Preview before push (always) · playtest gates between phases · delegation policy per
[[delegate-coding-to-cheaper-model]] (opus for camera/feel + sync architecture; sonnet
for systems implementation; plan/specs/review stay in the main loop) · headless tests
block Firebase or use `?fam=famtestfl` + cleanup · mobile 390×844 verified every phase ·
threejs-game-director QA gates apply (its Vite scaffold assumptions FIT this project;
adapt only its "invoke sibling skills" mechanics per runner) · Tripo/Gemini/ElevenLabs
credits never spent without asking.
