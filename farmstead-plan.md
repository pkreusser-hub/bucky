# 🏰 FARMSTEAD — design + build spec (source of truth)

A mechanics-faithful 3D remake of the classic 1993 settlement-building game genre-founder
(flag-and-road logistics, serf professions, full production chains, knights and territory),
rendered in three.js. **All code and assets are original** — we clone game *rules and
systems*, never art, sound, text, or names from the original. Working title: **FARMSTEAD**.

- Page: `farmstead.html` (+ modules in `assets/farmstead/fs-*.js`, classic scripts, no build step)
- three.js: **vendored** `assets/vendor/three-r128.min.js` (this repo's r128 house version;
  vendored because the cloud test env blocks cdnjs, and it makes the game offline-capable)
- Debug hook: `window.__FS__` · localStorage prefix `fs_` · suites `tools/_verify-farmstead-*.cjs`
- Sim speed: pause / 1× / 2× / 4× (a headline feature — must be real sim-tick multiplication)

## Deliberate deviations from the original (document, don't hide)
1. **Bounded island map** instead of a wrap-around (toroidal) world — a 3D camera on a torus
   is not worth it; island maps preserve all strategy.
2. **Modernized UI layout** (HTML overlay panels, minimap, tooltips) — original's icon-grid UI
   is an artifact of 320×200; all the same *controls* exist (priorities, distributions, attack
   dialog, stats), presented cleanly.
3. **Timing constants are tuned approximations** at the same order of magnitude (a skirmish
   should take ~45-90 min at 1×; 2×/4× exist for a reason).
4. Serfs do not hard-block each other on road nodes (soft avoidance + pass-through after a
   beat. Original had real traffic jams; we keep visual congestion without gridlock bugs).
5. Flag→building door delivery is a short fixed-time hand-off, not a separately pathed walk.
6. Campaign missions are out of scope; skirmish vs 1-3 AI with seeds, 3 map sizes.
7. No 2-player split-screen (a later Playroom co-op could be a follow-up).
Everything else — building set, resource set, serf professions + tools, chains, ratios,
flags/roads/carriers, geologists, mines+food, knights/morale/gold, territory, combat,
distribution/priority controls — is implemented for real.

---

# 1. Architecture

## Files & load order (all `window.*` globals, no modules)
```
assets/vendor/three-r128.min.js   THREE
assets/farmstead/fs-const.js      FSC      constants + all data tables + mulberry32 PRNG
assets/farmstead/fs-map.js        FSMap    lattice math, map generation, terrain queries
assets/farmstead/fs-sim.js        FSSim    tick engine, flags/roads/transport, construction,
                                           serfs, production, geology  (largest file)
assets/farmstead/fs-military.js   FSMil    knights, territory, combat, victory
assets/farmstead/fs-ai.js         FSAI     computer opponents
assets/farmstead/fs-models.js     FSModels procedural three.js asset builders (no textures
                                           from disk; canvas textures + vertex colors only)
assets/farmstead/fs-render.js     FSRender scene, terrain mesh, object/serf/building visuals,
                                           camera, picking, selection, per-frame interpolation
assets/farmstead/fs-audio.js      FSAudio  WebAudio synth SFX + ambient music, fs_muted
assets/farmstead/fs-ui.js         FSUI     HUD panels, menus, minimap, notifications, save/load
farmstead.html                    shell, css, input routing, boot, __FS__ hook
```
Rule: **sim modules (FSC/FSMap/FSSim/FSMil/FSAI) never touch THREE or the DOM.** Render/UI
read `G` and the event queue. This keeps the sim headless-testable and deterministic.

## The G object (single source of truth, save/load = JSON of G)
All cross-references are **integer ids** (no object cycles). Maps are plain objects keyed by
id string; `G.nextId` increments forever.
```js
G = {
  seed, tick,            // int; tick = 100ms of game time at any speed
  speed,                 // 0|1|2|4 (0 = paused)
  nextId,
  map: {                 // static topology; mutable object layers
    W, H,                // vertices per side (48/64/96)
    height: Float32Array,     // per vertex, world units
    terr: Uint8Array,         // TERR.* per vertex
    obj:  Uint8Array,         // OBJ.* per vertex (tree stages, stones, fields, sapling…)
    objArg: Uint8Array,       // per-object arg (stone charges, tree growth timer bucket…)
    mineral: Uint8Array,      // MINERAL.* under mountains
    mineralAmt: Uint8Array,   // 0..15 remaining
    fish: Uint8Array,         // fish stock in water vertices (0..8)
    sign: Uint8Array,         // geologist sign (MINERAL.*+1, 0=none; 255=empty sign)
    owner: Int8Array,         // player id or -1
    flagAt: Int32Array,       // flag id at vertex or 0
    bldAt: Int32Array,        // building id occupying vertex or 0 (center only)
    roadAt: Uint8Array,       // bitmask of the 3 owned edge dirs (see §2) used by roads
  },
  players: [ Player ],   // index = player id; player 0 = human
  flags: {id→Flag}, roads: {id→Road}, buildings: {id→Bld}, serfs: {id→Serf},
  events: [],            // ring of {t,type,…} for render/audio/UI (sim pushes, UI drains)
  notif: [],             // player-facing notifications (kept, capped 40)
  stats: {…},            // per-player time series rings (goods, serfs, land, military)
  gameOver: null|{winner},
}

Player = { id, name, color, isAI, castleId, eliminated,
  tools: ToolPrio,             // toolmaker priorities 0..9 per tool
  transportPrio: [RES…26],     // reorderable pickup priority
  dist: { planksConstruction, planksBoats, planksTools, steelTools, steelWeapons,
          coalSteel, coalGold, coalWeapons, wheatMill, wheatPigs,
          foodStoneMine, foodCoalMine, foodIronMine, foodGoldMine },   // 0..8 weights
  knights: { minHut, maxHut, minTower, maxTower, minFort, maxFort,    // occupancy targets
             recruitRate,      // 0..8: how eagerly generics+sword/shield → knights
             attackStrong },   // attack picks strongest-first when true
}

Flag = { id, p, v, slots: [ {res, dest} ×≤8 ],   // dest = building id or 0 (=any stock)
         roads: [roadId ×≤6], bld: bldId|0 }      // bld = building whose door this is
Road = { id, p, f1, f2, path: [v…] /* incl. both flag verts */, water,
         carrier: serfId|0, boatReq/boatHave (water roads) }
Bld  = { id, p, type, v, flag: flagId, state: 'site'|'leveling'|'build'|'done'|'burn',
         progress, matHave:{plank,stone}, matReq, matInFlight,
         worker: serfId|0, workerReq: bool,
         stockIn: {res:n…}, stockOut: {res:n…}, reqInFlight: {res:n…},
         prodT,              // production cycle countdown
         mil: { knights:[serfId…], wanted, gold, goldReq },   // military types only
         mine: { kind },     // mine type
         burnT,
         inv: {res:n…} }     // castle + stock only: the warehouse inventory
Serf = { id, p, job: JOB.*, state, t,              // t = ticks left in current state
         v, from, to, frac,                        // edge-walk interpolation
         path: [v…], road: roadId|0,               // carriers own a road
         carry: RES|0, carryDest,
         home: bldId|0, target: bldId|flagId|v,
         rank, /* knights 0..4 */  … }
```

## Tick engine
- `FSSim.tick(G)` advances exactly one 100 ms game tick. `FSSim.run(G, n)` = n ticks.
- rAF loop: `acc += dtReal*G.speed; while(acc≥0.1){tick(); acc-=0.1}` with a per-frame cap of
  16 ticks (tab-return protection); render interpolates serf positions with `frac`.
- Page hidden → auto-pause (single-player; resume on visible, original was modal anyway).
- **Determinism**: every random draw inside sim goes through `FSC.rng()` (mulberry32 seeded
  from G.seed at map gen + re-seeded from save). No Date.now/Math.random in sim modules.
  Suites replay seeds and assert identical outcomes.
- Perf budget: 96×96 map + 3 AI at 4× must hold 60 fps desktop → tick ≤ 6 ms p95
  (sim work is O(serfs + dirtyFlags), routing cached — see §3).

## Debug hook (contract for every suite — keep stable!)
```js
window.__FS__ = {
  G, FSC, FSMap, FSSim, FSMil, FSAI,
  newGame(opts{size,seed,ais}), ff(nTicks),         // fast-forward, no render
  setSpeed(s), save(slot), load(slot),
  build(type, v, p=0), placeFlag(v,p), buildRoad(f1,f2,pathHint?,p),
  demolish(id), attack(bldId, count, p),
  sendGeologist(flagId), routeItem…,                // low-level helpers as needed
  q: { flagAt(v), bldAt(v), serfsOf(p), invOf(p), counts(p) },  // query helpers
  perf: { tickMsAvg, drawCalls },
  version
}
```

---

# 2. Map & lattice

Triangular lattice (each vertex has 6 neighbours) via odd-row offset:
`v = r*W + c`; world `x = (c + (r&1)*0.5) * TILE`, `z = r * TILE * 0.866`, `y = height[v]`.
Neighbour dirs `E, W, NE, NW, SE, SW` with parity-dependent offsets (FSMap.nbr(v,dir),
FSMap.neighbors(v) — returns <6 at map edge). `roadAt` stores each edge once on the vertex
that owns dirs E, SE, SW (bit 0..2).

Terrain classes (`TERR`): WATER, GRASS, DESERT (buildable-flag only, no buildings/farms),
SWAMP (nothing buildable, walkable), MOUNTAIN (mines + flags only), SNOW (nothing — peaks).
Generation (FSMap.generate(seed, size)):
- fBm value-noise heightfield, island falloff to deep water at borders; quantize into
  terrain by height + moisture noise (swamp pockets in low grass, desert patches, mountain
  ranges with snow caps above threshold).
- Underground minerals seeded per mountain region as blobs: GOLD (rare, small), IRON, COAL
  (common, large), STONE; `mineralAmt` 4..15.
- Surface objects on grass: tree clusters (OBJ.TREE1..4 growth stages; 4 = mature), stone
  piles (OBJ.STONE1..8 = charges), scattered on noise. Fish 3..8 in coastal water.
- Guaranteed fairness: each player start site (flat grass ≥ radius 6, near trees+stones,
  reachable mountain within ~25) — retry with new offsets until found; castle placed at
  start, initial territory radius CASTLE_RADIUS.
- Validity queries (used by UI ghosts + sim):
  `canPlaceFlag(v,p)` — own land, land terrain, no obj that blocks, no flag within 1
    (adjacent vertices can't both be flags), not building vertex.
  `canPlaceBuilding(type,v,p)` — own land, terrain fits (mines: MOUNTAIN; farms/large need
    GRASS + slope ≤ S_LARGE around; small ≤ S_SMALL), vertex + reserved ring free, door
    vertex (SE neighbour) flaggable-or-has-own-flag, min distance 1 to other buildings
    (their reserved vertices), castle min-dist rules.
  `canBuildRoadStep(a,b,p)` — both own land (or water for boat roads), not through flags
    (except endpoints), edge unused, slope ≤ S_ROAD, terrain walkable (water only if boat
    road being built from a shore flag).

---

# 3. Flags, roads, transport (the heart — get this exactly right)

- Flags sit on vertices; ≤ 8 goods wait in `slots`. Buildings have exactly one **door flag**
  at their SE neighbour vertex (auto-created with the site; can also pre-exist).
- A road connects exactly 2 flags with a vertex path; **each road has one carrier serf**
  (water roads: a sailor + a boat delivered as a BOAT good). New road → castle dispatches a
  transporter (generic serf, no tool) who walks to the road and stays.
- Splitting: placing a flag on a road vertex splits the road in two (second carrier
  requested); removing a merge-flag merges? (original: no auto-merge — keep: no merge).
- **Item lifecycle**: producer/building output → placed in own door-flag slot with `dest`
  resolved at creation: nearest (road-graph hops) open **request** for that res, else
  nearest warehouse (castle/stock), else stays destless (rescheduled every RETRY ticks).
  Requests come from: construction sites (planks/stones), production inputs (cap stockIn +
  inFlight ≤ IN_CAP, default 2), military (gold), toolmaker/etc, warehouses accept all.
- **Routing**: per-flag BFS next-hop table, cached with a `G.routeGen` generation counter
  bumped on any road/flag change; recompute lazily per (flag,destFlag) on demand, memo in
  a Map keyed `f1:f2:gen`. Carrier picks the highest-transport-priority good waiting at
  either end whose next-hop is his road, walks to it, carries to the other flag (or hands
  into the destination building if that flag is the dest door), drops → re-idles at road
  middle. If the destination flag's slots are full → carrier waits at his own end holding
  the item (congestion, like the original) but re-checks every tick and can give up →
  return item to origin flag after CONGEST_T.
- Road demolished / flag destroyed: goods on its slots re-schedule (dest reachable? else
  destless); carrier walks back to nearest warehouse and rejoins the serf pool; goods in a
  carrier's hands get dropped at the surviving end. Dest building destroyed → in-transit
  goods re-dest to nearest warehouse at their next flag.
- Warehouse arrivals credit `inv`; serfs entering warehouses despawn into the pool counts.
- **Serf travel** (non-carrier professions): spawn at castle/stock door, walk the flag graph
  (BFS path over roads) to target flag, then into building. If network cut mid-walk →
  re-path from current flag; unreachable → return to warehouse (walks back over roads;
  if the serf's current component has no warehouse he walks offroad to nearest own flag of
  a component that has one — simple teleport-free rescue; keep it rare and logged).
- Geologists/attacking knights/leveling diggers may walk **offroad** direct to targets
  (original behavior for specialists).

# 4. Construction

`build(type,v)` → state 'site': ghost + auto door flag. Costs from FSC.BLD[type]
(planks/stones). Flow: requests materials (both in parallel, capped in-flight);
LARGE + MEDIUM sites first need a **digger** (serf w/ shovel) leveling `LEVEL_T` ticks
(sets surrounding heights toward mean — purely cosmetic terracing in render);
then a **builder** (hammer) arrives; construction progresses only while materials remain:
each unit of material = `BUILD_T_PER_MAT` ticks of hammering; done when all consumed →
state 'done', `workerReq` set, worker profession requested (see §5), production begins on
worker arrival. Military buildings instead request knights + start territory (§7).
Demolish own building → burns (BURN_T), refunds nothing (original refunded nothing),
serf inside flees to warehouse; site demolish before build → refund delivered mats? NO —
burned (keep original harshness). Castle demolish is not allowed (only conquest).

# 5. Serfs, professions, tools

Generic serfs live as **counts** in warehouse `inv.serf`; they materialize as Serf entities
when given a job (exit door one per SPAWN_GAP ticks per warehouse). Professions and their
tools (from FSC.JOBS): transporter —, sailor —(needs boat on road), digger shovel,
builder hammer, lumberjack axe, forester shovel, stonecutter pick, fisher rod, farmer
scythe, miller —, baker —, pigfarmer —, butcher cleaver, sawyer saw, miner pick,
smelter —, goldsmelter —, toolmaker hammer+saw, weaponsmith hammer+pincer,
boatwright hammer, geologist hammer, knight sword+shield.
- Creating a professional consumes 1 generic + the tool(s) from the same warehouse (nearest
  warehouse that has both; if tools exist but no generic → wait; if no tool → toolmaker
  demand is implicitly signalled via the tool request system).
- Knights: created per `recruitRate` whenever sword+shield+generic available; rank 0..4
  (renders as shield trim); promoted by winning fights (+1). Knights garrison military
  buildings; extras rest in warehouses.
- Workers whose building burns → walk back to warehouse, keep profession (tool kept).

# 6. Economy buildings (types, recipes — numbers live in FSC.BLD, cite here for review)

| type | size | worker | consumes → produces (cycle) | notes |
|---|---|---|---|---|
| castle | HQ | — | stores all; spawns serfs | 1 per player, conquerable |
| stock | large | — | warehouse | extra spawn/storage point |
| hut / tower / fortress | S/M/L | knights | — | garrison 3/6/12, territory r 8/11/14, gold 2/4/8 |
| fisher | S | fisher rod | nearby fish → FISH | works shore ≤ R7, fish stock depletes+regrows slowly |
| lumberjack | S | axe | mature tree → LUMBER | fells within R7, stumps fade |
| forester | S | shovel | — → saplings | plants within R7 on free grass, stages T1..T4 |
| stonecutter | S | pick | stone pile charge → STONE | surface piles, R7 |
| sawmill | M | saw | 1 LUMBER → 1 PLANK | |
| forester/lumberjack pairing sustains wood | | | | |
| farm | L | scythe | sows/harvests fields → WHEAT | fields = OBJ on free grass R7; sow→grow 4 stages→harvest |
| mill | M | — | 1 WHEAT → 1 FLOUR | idle windmill spins when working |
| bakery | M | — | 1 FLOUR → 1 BREAD | |
| pigfarm | L | — | 1 WHEAT → 1 PIG (slow) | pigs visible in pen |
| butcher | M | cleaver | 1 PIG → 2 MEAT | |
| stone/coal/iron/gold mine | S(mountain) | pick | 1 food (FISH/BREAD/MEAT) → try extract | success P by mineralAmt; depletes → "mine exhausted" notif |
| smelter (steel) | M | — | 1 COAL + 1 IRONORE → 1 STEEL | |
| goldsmelter | M | — | 1 COAL + 1 GOLDORE → 1 GOLDBAR | |
| toolmaker | M | hammer+saw | 1 PLANK + 1 STEEL → 1 tool | tool kind by player prio sliders |
| weaponsmith | M | hammer+pincer | 1 COAL + 1 STEEL → SWORD/SHIELD alternating | |
| boatwright | S | hammer | 2 PLANK → 1 BOAT | for water roads |

Goods (26, default transport priority order in FSC.RES_ORDER): plank, stone, lumber, boat,
sword, shield, goldBar, goldOre, steel, ironOre, coal, fish, bread, meat, pig, wheat,
flour, shovel, hammer, rod, cleaver, scythe, axe, saw, pick, pincer.
Distribution sliders (Player.dist) gate *which requester wins* when multiple compete
(weighted round-robin by slider 0..8); food sliders split fish/bread/meat among the 4 mine
types. Transport priority list is player-reorderable (UI) and drives carrier pickup order.

# 7. Military, territory, combat

- Occupied military building claims all vertices within its radius for its player;
  `owner[]` = argmin(dist to any occupied mil bld of that player, tie → earlier building).
  Recompute on occupation change / capture / destruction (incremental region update fine).
  Losing ownership of a vertex with an enemy civilian building/flag/road on it →
  building burns, roads/flags dissolve (goods re-scheduled or lost if unreachable).
  Frontier render: small border stakes in player color along ownership boundary.
- Garrison: building requests knights until `wanted` (player min/max settings by type +
  border proximity: near-border buildings use max, interior min). Gold delivered raises
  defender morale: morale = MORALE_BASE + gold/goldCap * MORALE_GOLD.
- **Attack**: player selects enemy military building in range (any own occupied mil bld
  within ATTACK_RANGE of it can contribute), chooses count (up to available minus min
  garrison), strongest/weakest first. Attackers walk offroad to the target's flag and duel
  defenders 1v1: each round, P(att wins) = attScore/(attScore+defScore),
  score = (1+rank) * morale. Loser dies (drop to corpse fade). Defenders fight to the last;
  last defender dead → **capture**: building converts to attacker (keeps damage/gold=0),
  surviving attackers garrison it, territory recomputes (cascade: enemy buildings now
  outside their territory burn).
  Castle capture = player eliminated (all their stuff burns/dissolves, dramatic + notif).
  Last player standing → victory screen + stats.
- Under-attack notifications; retreating is not a thing (original: fights are to the death).

# 8. Geology & mines

Flag on mountain → "send geologist": geologist (hammer) walks to the flag, then wanders
≤ GEO_SPOTS nearby mountain vertices, hammering ~GEO_T each; each spot gets a sign:
mineral type + density (from map.mineral/Amt) or empty sign. Signs render as tiny posts
(color = mineral). Mines built on a vertex read `mineral[]` **at their vertex** (not the
sign — signs are information, the ground truth is the deposit, exactly like the original).
Each successful extraction decrements mineralAmt in the local blob; empty → notif.

# 9. AI opponents (1-3)

Tick-budgeted planner (runs every AI_PERIOD ticks, staggered per player):
opening: ring of huts to claim land → lumberjack×2+forester+sawmill+stonecutter →
food (fisher/farm+mill+bakery) → geologist → mines near best signs → smelter+toolmaker →
weaponsmith+goldsmelter → expand military toward player/resources → attack when
projected strength ratio > AI_AGGRO threshold (attacks weakest reachable target).
Road building: A* over lattice cost (slope, detours) between new door flag and nearest
network flag. AI uses identical rules/costs (no cheating), modest APM cap.
Personalities: aggressiveness/expansion bias per AI index. Must never softlock: watchdog
re-plans if no progress in N minutes (e.g. blocked site → demolish it).

# 10. Rendering (three.js r128, house style: chunky low-poly, vertex colors, Lambert)

- Terrain: single BufferGeometry from lattice (2 tris per cell), per-vertex colors by
  terrain (+ slope shading + subtle noise), flat water plane w/ opacity + gentle sine bob
  of alpha or vertex y; beaches blend. Grid ~96×96 max → trivial.
- Roads: flattened dark ribbon quads along edges (slight y lift); water roads = plank
  bridge segments. Flags: pole + waving player-color pennant (skinned by sin), queued
  goods rendered as tiny stacked crates color-coded per RES at the flag base.
- Buildings: `FSModels.building(type, stage)` — distinct silhouettes from primitives
  (≤ ~400 tris each), construction stages (stakes → scaffold frame → done), burn state
  (fire sprites + blackened), site ghost (green/red validity). Smoke puffs from working
  smelters/bakery/mines; mill sails + mine wheel rotate while producing.
- Serfs: instanced-friendly minifig (~150 tris): body capsule, head, hat by profession,
  player-color sash, tool prop in hand, carried good as tiny crate overhead. Walk = bob +
  lean; work anims = simple oscillation (chop swing, hammer tap, scythe sweep). Knights:
  helmet + shield color by rank; duels = two knights facing, alternating lunge + clang.
  Target ≤ 350 serfs; use one InstancedMesh per body part with per-instance color, or
  merged per-serf groups if ≤ 150 draw calls total — measure, decide in Phase B.
- Territory: border stakes + subtle ground tint overlay for own land (toggle).
- Selection/hover: pulsing ring decal; building/vertex tooltips.
- Camera: MapControls-like — LMB drag pan (or edge scroll + WASD), wheel zoom (8..80),
  RMB/Q/E orbit yaw, pitch clamped 35°..70°. Touch: 1-finger pan, pinch zoom, 2-finger
  rotate. Zoom-scaled pan speed. `fitStart()` frames player castle at boot.
- Day cycle: none (constant warm light, like the original's eternal afternoon).

# 11. UI (FSUI; all DOM overlay, Old-Glory-adjacent farm palette, big touch targets)

- Top bar: goods ticker (key counts), serf count, land %, notifications bell.
- **Speed control**: ⏸ 1× 2× 4× segmented buttons + keys `Space,1,2,3` (+`.` step-tick
  when paused for debugging). Speed persists per save, never in localStorage globally.
- Bottom-left: build menu (tabbed S/M/L/mines/military, greyed w/ reason tooltips,
  ghost-follow placement mode), road mode (click flag → click target flag/vertices with
  live path preview + validity), flag mode, demolish mode, geologist send via flag panel.
- Click flag: panel (goods queued, connected roads, send geologist, demolish, build road).
- Click building: panel per state (site: materials bar; done: stock in/out, worker, prod
  toggle-pause? original had stop-production toggle — include halt button; military:
  garrison list w/ ranks, gold, attack button when enemy selected… attack flow: click
  ENEMY military building → attack dialog: count slider + strong/weak toggle + GO).
- Panels: Distribution (sliders), Transport priority (reorder list), Tools priority,
  Knights (occupancy min/max, recruit rate, cycle), Stats (line charts on canvas: goods,
  land, military strength; per player), Save/Load (3 slots + autosave/continue), Settings
  (mute, invert zoom…), Help (concise how-to-play).
- Minimap (canvas, bottom-right): terrain + territory tint + buildings dots + viewport
  trapezoid; click/drag to move camera. Update ≤ 4 Hz + on events.
- Notifications: toast + bell log ("Hut finished", "Under attack!", "Mine exhausted",
  "Geologist found gold", "Knight promoted", "Enemy eliminated") with click-to-jump-camera.
- Game over overlay: victory/defeat + stat graphs + New Game / Load.
- New game screen (boot): map size, seed (random button), AI count 1-3, speed preset,
  short flavor intro. Continue button if autosave exists.

# 12. Audio (FSAudio, all synth, no files)

Mute persisted `fs_muted`. Gentle farm ambience loop (soft pad + birds chirp PRNG),
UI clicks, build hammer taps, chop, sawmill saw loop nearby?, fanfare on building done
(short), horn on attack, clangs during duels, capture sting, victory/defeat themes,
notification ping. Spatial: volume by camera distance (house gainAt pattern).

# 13. Save/load

`fs_save_<slot>` = JSON {version, G} with typed arrays b64-encoded; autosave every 2 min
(game tick driven) to `fs_save_auto`. Load validates version, reseeds RNG stream from
saved rngState. Saves ≥ 200 KB fine. `__FS__.save/load` used by suites for determinism
checks (save→load→ff(1000) equals straight ff(1000) on key invariants).

# 14. Test plan (each phase ships its suite; ALL suites green before push)

Shared harness `tools/_fs_harness.cjs`: static server (node http, no deps), puppeteer-core
launch (CHROME_PATH env → /opt/pw-browsers/chromium → channel:chrome), pageerror collection,
`check(name, cond)` counter, screenshot helper into `shots/`. Suites drive ONLY via
`__FS__` + real DOM clicks for UI. Every suite: exit 0 + "N/N PASS", 0 pageerrors.
- world: gen determinism (same seed = same hash), terrain invariants (start sites valid,
  minerals only under mountains), picking accuracy, camera clamps, 60-frame render smoke.
- transport: flag/road validity incl. splitting, carrier delivers plank castle→site,
  congestion (9th good waits), reroute on road demolish, construction full cycle to 'done',
  digger leveling, castle inventory math, determinism replay.
- economy: every chain end-to-end at 4× ff (wood→plank; stone; fish; wheat→flour→bread;
  wheat→pig→meat; food→coal+iron→steel→tools; →weapons; gold→bars); geologist signs match
  ground truth; mine depletion notif; boats: water road carries goods; distribution slider
  measurably shifts flow; tool priority produces chosen tool.
- military: garrison fills to setting, territory grows on occupation + shrinks on loss,
  attack duel math within tolerance over N samples (seeded), capture converts + burns
  cut-off buildings, elimination + victory, AI 30-min ff builds economy + attacks
  (assert: >12 buildings, >0 attacks, no error, no stuck serfs>threshold).
- ui: every panel opens (real clicks), build placement via UI, speed buttons: measure
  ticks over 2 real seconds ≈ ratio 1:2:4 (tolerance), pause freezes tick, save→reload→
  load resumes, minimap click moves camera, mobile 390×844: layout fits + touch build
  path works, 0 clipped controls.
- polish/perf: tick p95 under budget at 4× on 96 map w/ 3 AI (ff-measured), draw calls
  < 900, no leak across newGame×3 (scene child + heap growth bounds), audio state machine.
- longplay (adversarial phase): 60 sim-minutes vs AI at 4×, assert liveness invariants
  every 5 min (no destless goods > cap, no serf stuck > 2 min, carriers on all roads,
  economy monotonic-ish), then save/load equivalence.

# 15. Build phases (sequential agents; each: read this file + fs-const.js first,
run earlier suites before AND after, keep them green, 0 pageerrors, update __FS__)

A. world engine (fs-map, fs-models terrain objects, fs-render terrain/camera/picking,
   farmstead.html shell+boot) → world suite. Boot straight into a generated map w/ castle
   placed (sim stub: G exists, tick counts, no serfs yet) + new-game screen minimal.
B. transport+construction core (fs-sim: flags/roads/carriers/scheduling/construction/serf
   movement; render: flags/roads/serfs/buildings-basic; minimal build/road UI glue for
   manual testing) → transport suite.
C. economy complete (all producers, mines, geology, tools, boats, stock, distribution) →
   economy suite.
D. military+AI (fs-military, fs-ai; attack UI dialog) → military suite.
E. UI complete (fs-ui everything in §11; replaces any temp glue) → ui suite.
F. audio+polish+mobile+perf (fs-audio, effects, touch, budgets) → polish suite.
Then: integration pass, adversarial review (multi-agent), fixes, push.

File ownership per phase to avoid conflicts: A owns map/models/render/html; B owns sim +
extends render via NEW functions (never rewrites A's); C extends sim (marked sections);
D owns military/ai; E owns ui (+ its html/css block); F owns audio + touch block.
Marked section comments `/* ===== PHASE-X: name ===== */` at every extension point.
