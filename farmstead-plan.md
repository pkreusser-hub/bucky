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
3. **Timing constants are the original's exact values** (recovered from reimplementation
   source: walk 2.55s/flat edge with slope-dependent costs, per-building cycle ticks,
   promotion checks every 60s, etc — internal-tick ÷ 10 = our 100ms ticks). The handful
   still approximated (pig-shipping rule, a few UI cadences) are marked in code comments.
4. Serfs do not hard-block each other on road nodes (soft avoidance + pass-through after a
   beat. Original had real traffic jams; we keep visual congestion without gridlock bugs).
5. Flag→building door delivery is a short fixed-time hand-off, not a separately pathed walk.
6. Campaign missions are out of scope; skirmish vs 1-3 AI with seeds, 3 map sizes.
7. 2-player mode is SHARED-KINGDOM CO-OP over the network (both players command the same
   settlement vs AI) — the original's 2-player was competitive split-screen; co-op is the
   requested design here.
8. Territory uses the original's influence-weight model (per-ring tier tables, radius 8,
   argmax of summed influence; castle = fortress row). Castle keeps a widened initial
   claim at game start (radius 12) purely so both start economies have room.
9. Terrain naming: the classic's families are water/grass/desert/tundra/snow; our SWAMP
   (walkable, unbuildable flavor) + MOUNTAIN≙tundra keep the same buildability rules.
10. Removing a flag LOSES the goods waiting on it (bookings + boat latches released,
    itemLost events emitted). The classic scatters them to the ground; nothing sensible
    recovers scattered goods there either, and losing them keeps the economy honest.
11. Anti-starvation pickup aging: an item repeatedly passed over at a flag in favour of
    higher-priority goods slowly gains effective priority, so plank/stone bound for a
    construction site can never be starved forever on a busy shared road. The classic
    can starve them indefinitely; a co-op family game shouldn't.
12. The FORESTER plants inside ring 4 (`FSC.WORK_SPIRAL.forester = [1, 60]`, mean ≈ 2.9
    tiles) instead of the classic's spiral index 1–128 (rings 1–6, mean ≈ 4.4, a quarter
    of trips at the rim). The original scatters a forester's saplings so widely that his
    grove reads as unrelated woodland and he spends his life walking; a grove that grows
    visibly AROUND the hut is what players expect from the building. Every other
    profession keeps its exact original spiral range. Restore `[1, 128]` for the classic
    behaviour — it is a one-line change and nothing else depends on it.
13. **Construction fells the trees in its way** (roads, flags and buildings), and the felled
    tree yields no wood. Researched before it was implemented, and the answer is more
    interesting than the question was:
    - **The original let ROADS run straight THROUGH standing trees.** `is_road_segment_valid`
      in the freeserf reimplementation of the original binary refuses a step only when the
      target's `map_space_from_obj` is `SpaceSemipassable` or worse; every tree, pine, palm,
      dead tree and felled trunk is `SpaceFilled` (1), BELOW that threshold, while every
      stone/sandstone pile is `SpaceImpassable` (3). Nothing removes the tree — the road is
      simply laid under it. So Farmstead was, until 2026-08-01, **stricter than the original**
      here, and that unintended deviation is what let a dense wood wall a player in.
    - **The original refused FLAGS and BUILDINGS on a tree.** `can_build_flag` and
      `can_build_building` both demand `SpaceOpen`, and the manual agrees: *"all buildings must
      be built on your land and there must not be trees or boulders on the area"*, and placing
      a flag can fail *"because there are trees in this spot"*. A large building's six-vertex
      RING, by contrast, only needs `< SpaceSemipassable` — trees were legal there and stayed
      standing.
    - **Settlers II is the same**: you cannot lay a road through a wood; you send a woodcutter
      first.
    So: roads-through-wood is a RETURN to original behaviour; flags and buildings on a tree are
    a **deliberate deviation**, taken because a family game must never present an unwinnable
    start, and because in 3D a tree standing in a painted road reads as a bug where the
    original's 2D sprite happily overdrew it. The tree family (all four growth stages, a
    forester's sapling, a woodcutter's stump) is cleared by the construction that lands on it;
    STONE piles and standing crops still refuse, because a stone is the stonecutter's entire
    economy and a field belongs to a farm. **No wood is yielded** — the original has no
    clearing mechanic to be faithful to, and a free plank per road step would out-earn the
    woodcutter chain the whole game is built around. Sim side: `FSSim.clearWood` /
    `clearWoodAlong`, driven by the command's own vertex list, no RNG, lockstep-safe. Legality
    side: `FSMap.objRefuses` (= blocks minus the clearable family). WORLD GENERATION
    deliberately keeps the STRICT `objBlocks` rule in its start-quality guarantees (`plotOK`,
    `reachOK`, `openCastleApproach`, `balanceStarts`): being conservative about what a start
    can reach is strictly safer, and relaxing it would move every generated map.
    Measured effect on a virgin world (road-legal vertices reachable from the castle flag /
    buildable hut plots within radius 14), seeds 12345·7·42·1234:
    311→375, 324→408, 350→378, 354→373 reach; 129→183, 94→141, 151→164, 227→243 plots.
14. **The STONECUTTER walks to the NEAREST rock**, alone among the professions. Every other
    offsite worker keeps the original's model exactly: ONE uniformly-drawn spiral index per
    attempt inside the profession's range, resolved to a ring and then to a uniform tile on
    that ring, with a per-profession retry cadence on a miss — which is what makes output
    degrade with resource density instead of clearing tidily inside-out. The stonecutter's
    version of that reads as a broken worker rather than as a sampling model: a hut sited on a
    near group spends most of its trips walking across the map to a far one. He now takes the
    nearest valid pile inside his radius, works it out, then moves to the next-nearest.
    Deterministic and identical on every client: no `FSC.rng` at all, and ties at equal lattice
    distance break on the LOWEST VERTEX INDEX (`forRadius` walks row-major, not ring-major, so
    the winner has to be chosen explicitly rather than taken as the first hit). `FSSim`'s
    `nearestStone`; restore the original by deleting the one early return at the top of
    `pickTask`.
15. **CONSTRUCTION IS 1.5× FASTER than the original** (2026-08-02, user request).
    `FSC.SWING_TICKS` — the ticks between a builder's hammer swings — went from the
    original's `[77, 51, 51, 77]` (mean 64 ticks = 6.4 s a swing) to `[51, 34, 34, 51]`
    (mean 42.5 = 4.25 s), a measured 1.506×. Nothing else about construction moved: the
    16-bit accumulator, `SWING_PER_MAT` (one material every 8 swings), `LEVEL_T` and every
    building's own `swings` table are the recovered originals, so a building still needs
    exactly the materials and exactly the swings it always did — it just gets them sooner.
    Scaling the CLOCK rather than the swing counts is deliberate: the material draw keeps
    landing on the same swing numbers, so the "waiting on a plank" states occur in the same
    places. The array LENGTH is unchanged so `FSC.rngInt(SWING_TICKS.length)` still draws
    once per swing and the rng STREAM keeps its shape — only the timing differs.
    WHY: at the original cadence a small hut takes ~1.7 game-minutes of pure swinging after
    its materials arrive, and a family game spends that time watching a man tap. Restore the
    original by putting `[77, 51, 51, 77]` back; nothing else depends on it.
    KNOWN CONSEQUENCE: the visual suite's `SIM_BASELINE` golden hashes move (the world is in
    a different state at any given tick), and construction-timed staging in the economy and
    transport suites shifts — both re-derived rather than bent.
16. **ALLIED STARTS ARE NEIGHBOURS** (2026-08-02, user playtest). The generator maximises
    the smallest gap between kingdoms, which is right for rivals and wrong for the two seats
    of a SEPARATE-ALLIED-KINGDOMS co-op game: after the boards doubled in area, two allies
    landed 32 road steps apart on a medium map and could not help each other for the first
    ten minutes of a game whose entire point is helping each other. `FSMap.generate` now
    takes `allies` (= `FSSim`'s `humans`, since every human is on team 0) and places the
    ALLIED BLOCK AS ONE SITE on the existing quality ladder — so the rival spacing is
    computed for one fewer kingdom and comes out slightly WIDER — then seats the remaining
    allies in a band around the anchor: outer edge `ST.ALLY_SEP_FRAC` (0.42) of the rival
    target, floor `ST.ALLY_SEP_MIN` (19), which is derived from `ST.MOUNTAIN_MAX` (18) so
    two allies can never sit inside each other's guaranteed-ore reach and be handed the same
    seam. Measured over 8 seeds × 3 sizes: allies 19–30 steps (mean 20.4) against rivals'
    31.9 / 52.5 / 81.5 by size, with the per-start coal+iron guarantee unchanged.
    `allies` is part of the SEED CONTRACT — the same seed with a different team layout is a
    different map, deliberately — and it rides in the host's settings block, which already
    carries `humans`. `allies < 2` is the untouched code path, so no solo or shared-kingdom
    map or sim hash moves (re-derived twice: `SIM_BASELINE` is unchanged).
17. **CO-OP RUNS UP TO 2×, NOT 4×** (2026-08-02, user request; supersedes the batch-#4 rule
    that pinned a connected room to 1×). `FSC.MP_MAX_SPEED = 2`. The wire is indifferent to
    speed — the command lead is `CMD_DELAY_MP × speed` TICKS, i.e. a constant ~400 ms of
    real time at any of them — so the ceiling is about per-second THROUGHPUT: at 4× a client
    must sustain 40 ticks and 40 frames a second or it lives in FSNet's catch-up path, and
    the slowest seat sets the room's pace. Either seat may pick pause / 1× / 2×; the pick
    travels the ordinary command road (`speed` is `CMD_HASH_NEUTRAL`, a guest's request is
    routed to the host and comes back as the host's own broadcast), and a clock that arrives
    above the ceiling is pulled back to it by the HOST alone, on a tick boundary. The gate
    lives in FSUI and the keydown handler and NOT in `setSpeed()` — see the batch-#4 note:
    `issueCommand` takes `G.cmdSeq++` before a guest's copy is routed, so a corrective
    command raised independently on both machines diverges the two sims.

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
- Road demolished: goods addressed across it re-schedule (dest reachable? else
  destless). Flag destroyed: the goods ON it are lost (deviation §14.10) — everything
  else re-schedules; carrier walks back to nearest warehouse and rejoins the serf pool; goods in a
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
- Knights: created via the reproduction/knight-credit system (serfToKnightRate overflow
  counter; sword+shield consumed at spawn); rank 0..4 (renders as shield trim); promoted
  by PERIODIC probability rolls while garrisoned (per-building × per-rank table — the
  castle trains fastest; combat never changes rank). Knights garrison military
  buildings; extras rest in warehouses.
- Workers whose building burns → walk back to warehouse, keep profession (tool kept).

# 6. Economy buildings (types, recipes — numbers live in FSC.BLD, cite here for review)

**Costs/sizes in fs-const.js are the reconciled CONFIRMED originals — that file is the
source of truth.** Size model: only small (center vertex, no leveling) and large (flat
7-vertex footprint, digger-leveled) exist — there is NO medium tier; mines are small-class
on mountains. Notable: mill is SMALL; sawmill/bakery/butcher/tower are LARGE.

| type | size | worker | consumes → produces (cycle) | notes |
|---|---|---|---|---|
| castle | HQ | — | stores all; spawns serfs | 1 per player, conquerable |
| stock | large | — | warehouse | extra spawn/storage point |
| hut / tower / fortress | S/L/L | knights | — | garrison 3/6/12, territory r 8 UNIFORM, gold 2/4/8 |
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

Goods (26). TWO separate reorderable priority lists exist (do not conflate):
- FSC.RES_ORDER — FLAG TRANSPORT priority (which waiting good a carrier picks up first);
  confirmed original default starts goldOre/goldBar and ends stone/plank. Pickup choice is
  a LIVE re-evaluation: a higher-priority arrival pre-empts a lower one not yet picked up.
- FSC.INV_ORDER — WAREHOUSE OUTPUT priority (which stored goods leave storage first).
Distribution sliders (Player.dist) gate *which requester wins* when multiple compete
(weighted by slider on the classic's 0..65500 scale, 20 notches of 3275 — build stepped
controls); food sliders split food among the 4 mine types. Confirmed defaults in
FSC.DIST_DEFAULTS/TOOL_PRIO_DEFAULT (hammer is by far the top default tool).
Toolmaker/weaponsmith are demand-responsive each cycle (live priority minus current
stock), never fixed round-robin. Warehouses later gain per-res In/Stop/Out modes (§11).

# 7. Military, territory, combat

- Knight strength is EXPONENTIAL in rank: FSC.KNIGHT_EXP = [1,2,4,8,16]. A knight fighting
  on his OWN player's territory fights at full strength; fighting on foreign soil his
  strength is scaled by his player's morale (gold-share formula in fs-const.js — no gold
  anywhere in the game = everyone at full morale). Duel round: P(A beats B) =
  scoreA/(scoreA+scoreB), seeded rng.
- Garrison targets use 4 THREAT TIERS by distance to the nearest enemy border (tier 3 =
  at the border), each with player-settable min/max occupation level 0..9
  (FSC.KNIGHT_OCC_DEFAULTS); headcount = max(1, round(level/9 × cap)). Castle garrison =
  player-set stepper (default 3, cap 99). "Cycle knights" action rotates garrisons home
  for promotion churn (cooldown FSC.CYCLE_KNIGHTS_T).
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

# 16. Multiplayer — 2-player shared-kingdom co-op (deterministic lockstep)

TWO co-op modes, chosen by the host at room creation:
- SHARED KINGDOM: both seats command PLAYER 0's settlement together vs 1-3 AI.
- SEPARATE KINGDOMS: seat 0 = player 0, seat 1 = player 1, each with their own castle,
  economy and territory, ALLIED (same team) against 1-2 AI enemies.
Seat→player mapping is the ONLY netcode difference between the modes — everything else
is the team system (below). Netcode is COMMAND-LOCKSTEP: both browsers run the identical
deterministic sim; only player commands travel the network.

## Teams (implemented in sim regardless of MP)
- Player.team int. Solo: human team 0, each AI its own team. Shared co-op: same. Separate
  co-op: players 0+1 both team 0 (human alliance), AIs teams 1+.
- The team layout reaches WORLD GENERATION: allied starts are seated as neighbours and
  rivals stay far away (deviation 16). `FSMap.generate({..., allies})`, `allies = humans`.
- Attack validation rejects same-team targets (UI greys allied buildings). AI targets
  enemy teams only.
- Territory between SAME-TEAM players never displaces: an owned vertex keeps its owner
  when the would-be claimer is an ally; the conquest demolish rule ("lost land burns
  buildings") applies only across teams. Roads/flags/buildings remain strictly per-player
  (no shared networks or gifting — deviation note: the classic has no trade either).
- Elimination: castle falls → that player out. Team defeated when all members out;
  victory = your team is the last with living players. Overlays say "team" in co-op. Transport: Playroom Kit (house stack, pin playroomkit@0.0.96 UMD,
lazy-load only when hosting/joining; skipLobby:true; parse+CLEAR the #r= hash BEFORE
insertCoin and pass roomCode explicitly — house caution).

## The command layer (built in Phase B, solo uses it too — MP is just a transport)
EVERY mutating player action is a command object:
  {t: execTick, seq, by: seatId, type: "flag"|"road"|"build"|"demolish"|"attack"|
   "geologist"|"speed"|"prio"|"dist"|"toolPrio"|"knightSet"|"halt"|…, args}
- FSSim.issueCommand(G, cmd) queues; commands execute at the START of their tick in
  (t, by, seq) order; invalid-at-execution commands fail silently-but-logged (event).
- Solo: execTick = current tick + 1. MP: host assigns execTick = hostTick + DELAY_TICKS
  (~4 = 400ms) and broadcasts; both sides execute at that tick. Guest sends command
  requests to host (host validates seat, assigns tick, broadcasts).
- G.speed changes are commands (both screens follow). Pause while hidden: SOLO only;
  in MP the sim keeps its tick schedule (host heartbeat pattern) and a hidden tab
  catches up in capped slices on return ("catching up…" veil).
## Sync guarantees
- Determinism rules (already enforced): sim/map modules use FSC.rng only; NO
  Math.sin/cos/tan/pow/exp/log, no Math.random, no Date.now in sim or mapgen (float
  transcendentals are engine-implementation-defined and break cross-device lockstep;
  + - * / sqrt floor min max and integer hashing only). Suites grep-audit this.
- Desync detection: every 100 ticks both sides compute cheap hash (tick, rngCalls, ids,
  inv totals, serf/flag/bld counts, owner checksum) → exchange → mismatch triggers
  RESYNC: host chunks a b64 save over the wire (8KB chunks), guest loads, play continues
  (event logged; suites assert zero desyncs in normal play).
- Join mid-game: same chunked-save transfer, then guest applies buffered commands.
- Drop handling: guest leaves → host continues seamlessly (it owns the room). HOST
  leaves → guest has the full state: offer "continue solo" (loads local state into solo
  mode). Both directions tested.
## Lobby / discovery
- Title screen: SOLO / HOST CO-OP / JOIN. Host creates room → share link (#r=<code>) +
  Firestore family-lobby doc lobbies_<familyKey>/fst_<code> {game:"farmstead",
  gameName:"Farmstead", ico:"🏰", hostName, status, playerCount 1..2, maxPlayers 2,
  updatedAt} with 15s heartbeat + pagehide delete (games.html's generic lobby renderer
  shows a JOIN card via its neutral-fallback text — zero games.html changes needed).
  Identity = localStorage choreUser. Firestore unreachable → lobby features degrade
  silently (link sharing still works). Playroom unreachable → clean fallback to solo
  with a friendly note, never a blank page.
- Test transport: FSNet abstracts the wire (playroom | localWS). Suites run TWO browser
  processes against a tiny node WS relay (?mpws=ws://127.0.0.1:PORT) since Playroom's
  CDN/backend is blocked from this container; the playroom adapter follows the exact
  house integration pattern (verified live in prior projects) and is spot-checked
  manually post-deploy.

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
M. multiplayer co-op per §16 (fs-net.js: command transport, hash/resync, lobby glue,
   minimal host/join screens; localWS test adapter) → mp suite (two browser processes
   over the local relay: joint build session, command ordering, hash agreement, drop
   handling both directions, speed-as-command).
E. UI complete (fs-ui everything in §11 + polished co-op lobby/partner presence) → ui suite.
F. audio+polish+mobile+perf (fs-audio, effects, touch, budgets) → polish suite.
Then: integration pass, adversarial review (multi-agent), fixes, push.

File ownership per phase to avoid conflicts: A owns map/models/render/html; B owns sim +
extends render via NEW functions (never rewrites A's); C extends sim (marked sections);
D owns military/ai; M owns fs-net.js (+ command-layer seams in sim marked PHASE-M);
E owns ui (+ its html/css block); F owns audio + touch block.
Marked section comments `/* ===== PHASE-X: name ===== */` at every extension point.
