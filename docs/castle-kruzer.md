# Castle Kruzer — the Settlers-1 clone

`castlekruzer.html` + `assets/farmstead/fs-*.js`. Named Castle Kruzer to the player;
every internal identifier, file prefix, folder and test-suite name still says "farmstead".

Deterministic lockstep simulation — the sim files may use `FSC.rng` and nothing else. Read
the determinism law and the nine-suite battery before changing anything under `fs-sim`,
`fs-map` or `fs-military`.

> Split out of the single 12,800-line `CLAUDE.md` on 2026-08-16. Entries are verbatim and in
> their original order — the oldest at the top, the newest at the bottom. Later entries
> routinely correct earlier ones, so when two disagree, the lower one wins.

---

# 🏰 FARMSTEAD — mechanics-faithful Settlers-1 clone in 3D (2026-08-01, branch claude/settlers-3d-clone-rdg6wl, draft PR #2)

**LAUNCH NAME: CASTLE KRUZER (2026-08-02).** Player-facing rename only — page is now
`castlekruzer.html` (was `farmstead.html`, plain rename, was untracked); `<title>`/meta
description/title-screen wordmark + the fs-net.js lobby doc's `gameName` all read "Castle
Kruzer" now. Every internal identifier stays: `fs-*.js` file prefixes, `FSC`/`FSNet`/`FSSim`
globals, the `assets/farmstead/` folder, `farmstead-plan.md`, the nine `_verify-farmstead-
*.cjs` suite names, and the lobby doc's internal `game:"farmstead"` id + `fst_<code>`
collection prefix (games.html's `LOBBY_TEXT` keys off that id and now carries an explicit
`href` override so JOIN links resolve to `castlekruzer.html`, not the dead `farmstead.html`)
— same precedent as Huey keeping his goose files. Added to games.html's `GAMES` + index.html's
`PLAY_GAMES` (🏰, `castlekruzer.html`) and games.html's `LOBBY_TEXT` ("kingdom is open!" /
"mid-siege!"). Sprite-bake source GLBs (`dwarf.glb`/`knight.glb`) were already copied into
`assets/farmstead/cast/dwarfknight/src/` in the 2026-08-01 session — the production bake/rig
pipeline (`_fs_bake_sprites.cjs` → `_fs_dk_rig.py`) has no Downloads dependency; only the
abandoned, explicitly-"never shipped" `sprites-test` exploration fork still names Downloads,
in provenance comments only. Full 9-suite battery re-verified GREEN post-rename: world 84 ·
transport 138 · economy 107 · military 124 · mp 127 · ui 149 · visuals 187 · visual 60 ·
polish 68 = **1044/1044**, 0 pageerrors. Shots: `shots/fs_rename_{title,tiles}.png`.

`farmstead.html` + `assets/farmstead/fs-{const,map,sim,military,ai,net,models,render,fx,audio,ui}.js`
+ vendored `assets/vendor/three-r128.min.js` (cdn 403s through the proxy). 100% original
code/assets/names ("Farmstead"); the ORIGINAL's mechanics were recovered as FACTS (research
+ DOSBox observation of the user's own copy) — never code/art/audio from it. NEVER commit
any user-uploaded game asset; the custom-music loader keeps user audio in IndexedDB only.
- **Determinism (lockstep law)**: sim files use FSC.rng ONLY — no Math.random/transcendentals/
  Date.now (economy suite greps for violations). 100ms ticks; speeds 0/1/2/4; every mutation
  through FSSim.issueCommand (t, by, seq). MP = command-lockstep (host-authoritative,
  SYNC_HASH_T checkpoints, chunked resync; localws relay for tests, Playroom adapter live;
  guest lead ≤ lastConfirmed + CMD_DELAY_MP×max(1,speed) − 1). Co-op modes: shared kingdom
  AND separate allied kingdoms (teams: no displace/burn between allies, team victory).
- **Original-exact systems**: costs, two 26-item priority lists, slope walk table
  [51,45,38,32,26,32,51,77,102], per-building cycle ticks, mine dig-sampling + 16-bit
  exhaustion, fish 0..7 regrow(>0-guarded)+migration, sweep (SAPLING: ONE 25% roll → mature),
  construction swing accumulator, repro+knight credits, promotion tables, occupancy tiers,
  influence territory r8, morale/gold, supplies table, offsite workers = ONE random disc
  sample + per-profession retry (40/70/10/10/50t, farmer 131-miss rest). Deviations live in
  farmstead-plan.md §14 (incl. §14.10 flag-removal goods lost, §14.11 pickup aging).
- **Tests**: `tools/_fs_harness.cjs` + NINE suites `tools/_verify-farmstead-{world,transport,
  economy,military,mp,ui,visuals,polish,visual}.cjs` (~830 checks post-review). UI-suite 2×/4×
  speed-ratio checks are LOAD-SENSITIVE — run the board on an idle box. buildingDetail counts
  indexed geo by index.count/3.
- **ADVERSARIAL REVIEW 2026-08-01**: 6 finders + 6 paired refuting verifiers (Workflow) → 30
  confirmed findings, ALL fixed in 4 waves (sim-core 6a6c52e · military 454575e · netcode
  088661d · UX/integration follow-up). Highlights: tickRetry in-flight booking leak (zeroing
  it.dest before scheduleItem), splitRoadsAt wedging a goRoad carrier, boatInFlight latch,
  crew-watchdog double-request, per-player notif eviction, burning stores reporting ghost
  stock, geologists refusing unconnected flags (now offroad), beat-frame authority, peer
  identity latch, resync backoff, cmdFail toasts, castle capacityOf(G,b) = castleKnights.
- **Castle**: user's Tripo GLB was tried and REPLACED by an original procedural model in its
  design language (grey fieldstone + maroon spires, 870 tris, castleMat() cool-grey emissive
  lift — the shared warm BLD_WALL lift creams out grey stone; motte frustums share seam rings
  exactly or sky grins through). GLB + GLTFLoader removed (git history only).
- **Not linked** from games.html/index PLAY_GAMES — happens at user-approved merge, never
  push to main without preview approval (auto-deploy).
- **PICKED UP LOCALLY 2026-08-01** (cloud → local): files extracted from
  `origin/claude/roads-wip-backup` — that ref = branch tip 1a85619 PLUS the cloud session's
  uncommitted ROADS WIP snapshot (fs-models.js/fs-render.js +501/−22, road visuals mid-build,
  saved stash-style "pre-teleport") — onto the local working tree as UNTRACKED WIP on
  story-local (no branch switch; story/other WIP untouched; hashes verified byte-exact vs the
  ref). `ws ^8.21.1` added to tools/package.json (MP suite's localws relay). Full commit
  history (incl. the 4 adversarial-review fix waves) lives on origin/claude/settlers-3d-clone-rdg6wl.
- 🛤 **ROADS ARE GROUND, NOT AN OBJECT — FINISHED 2026-08-01** (user playtest: "too blocky and
  perfect… should be a texture applied to the ground instead of an object"). The cloud WIP had
  the code but was never smoke-tested, suite-updated or looked at. Land roads are now ONE
  painted decal: `FSModels.paintRoadMask` lays the WHOLE network into a single cached 2048px
  map-space canvas (Chaikin corner-cutting kills the 60°/120° lattice kinks, `wobbleSeries`
  breathes the width, 4 independently-jittered coats, ruts, grit, trodden junction blobs, alpha
  feathering out into the grass), and `rebuildRoads` lays it over the TERRAIN'S OWN triangles
  one lattice ring wide, lifted `ROAD_DECAL_LIFT = ROAD_LIFT*0.5` with polygonOffset −2.
  Water spans keep the plank ribbon (`roads:water`) — there is no ground under a causeway to
  paint. `dynamicInfo().roads` is now a DRAW-CALL count (decal 0/1 + ribbon 0/1 = 0..2), NOT a
  0/1 flag. Repaint discipline: terrain edits (`G.dirtyV`) only RE-SEAT triangles
  (`rebuildRoads(false)`, sheet reused — a digger marks dirtyV every swing and a 2048px repaint
  per swing is a hitch you feel); a `roadSignature` change repaints. Determinism safe: every
  wobble comes from the roads' own seeded `jr()`, never `FSC.rng`.
  **THREE BUGS FOUND AND FIXED in this finishing pass** (all in the "does it read as ground or
  as a sticker" family — the WIP got the paint right and the integration wrong):
  (1) **STALE TERRAIN NORMALS.** The decal copies `terrainMesh.geometry.attributes.normal` so it
  lights like the ground, but `frame()` ran `computeVertexNormals()` AFTER `syncDynamic()` — so
  the rebuild triggered by a terrain edit read PRE-MOVE normals and then kept them until the
  next rebuild. After a one-off level (a building footprint) that is permanent. Fixed by
  extracting `flushTerrainGeo()` (idempotent, dirty-flag guarded) and calling it inside the
  `dirtyV` block BEFORE the road rebuild; `frame()`'s call stays for refreshVertex issued
  outside syncDynamic. Measured: worst normal mismatch after an edit 0.196 → 0.
  (2) **WRONG AMBIENT LIFT.** The decal inherited the ribbon's `emissiveOf: COL.ROAD,
  emissiveK: 0.22` (= +34/255 red). The terrain it lies ON uses `0x6d8b5c × TERR_EMISSIVE_K
  0.14` (= +15). More than double the lift of its own ground, and because emissive is a FLAT
  add it raised the dark ruts and packed core by exactly as much as the pale verge — crushing
  the paint's tonal structure and bleaching the path to sand. Now literally the terrain's
  values. LESSON: a coplanar ground decal must match the ground's LIFT as well as its NORMALS;
  matching one and not the other still reads as a sticker.
  (3) **HARD STRAIGHT END CAPS.** `ribbonPath` closed each coat with a straight line across the
  path, and since the 4 coats are 4 different widths the chops stacked into a stepped pale
  wedge lying on the grass at every road end — the exact "blocky and perfect" read the rework
  exists to kill. New `capPoints()` walks a shallow, deliberately asymmetric nose arc traced
  with the same midpoint quadratics as the sides.
  Plus one **value regression** the rework introduced: the old ribbon multiplied its colour by
  `roadTex()` (measured mean 0.82), so COL.ROAD never reached the screen at full value; the
  decal has no second sheet (the canvas IS the surface) but painted DIRT at literally COL.ROAD
  → the whole network ~20% brighter than the road it replaced. `ROAD_GRAIN = 0.82` folds that
  factor back in ONCE over `ROADPAINT_RAW` so every coat/rut/blot keeps its authored
  relationship. Measured median rendered road colour (203,181,128) → (156,146,103) against
  grass (115,151,90).
  **Hunted and clean** (all asserted, not eyeballed): no z-fighting at 18° grazing pitch, no
  daylight gap under feathered edges on a 1.01-unit bank, no paint reaching the sheet border
  (ClampToEdge cannot smear), every decal uv inside the sheet, and the decal's own silhouette
  lands on UNPAINTED ground (worst boundary alpha 0) so the mesh edge is never a visible cut.
  Junction blobs are NOT misaligned — Chaikin leaves a polyline's first/last point untouched
  and roads always meet at flags, so blob and stroke end share a vertex by construction.
  **KNOWN LIMIT** (documented, not a bug): the sheet frames the NETWORK, so px/world-unit falls
  as the town spreads — measured 86 px/u on a young settlement, 50 at 57 roads, ~16 worst case
  if a network ever spanned a whole medium map (painted half-width 40px → 7px). `paintRoadStroke`
  floors `hw` at 2.6px so it degrades rather than collapses, and the camera is zoomed out by
  then anyway. Raising `ROAD_MASK_PX` to 4096 is the lever if a late-game town ever looks mushy.
  **Suites** (`.roads` semantics changed, so assertions had to move with it): transport's "roads
  render as one merged ribbon" → "one painted ground decal, no ribbon" + a decal-has-triangles
  check (122→123). visuals gained a 24-check section **2b** covering the whole feature —
  decal/tris/transparency, cover on-road vs off-road, probeRoad gap on flat AND on a
  deliberately-built steep bank, sheet-border + uv + silhouette hygiene, normals AND emissive
  matching the terrain, re-seat-vs-repaint discipline, the water causeway (ribbon + decal +
  roads===2), demolition shrink/empty/no-geometry-leak (58→82). Sim-level road checks needed no
  changes. **TEST GOTCHAS**: two flags may never be adjacent ("flag too close"), so the shortest
  legal road over one steep step is flag—step—flag (a 1-edge test road is impossible); a generic
  town network can easily sit entirely on flat ground, so slope conformance needs a
  deliberately-built steep road; and reading rendered pixels for a colour judgement must come
  from `gl.readPixels`, not `page.screenshot` — the HUD is DOM over the canvas and fills a
  centred transect with panel grey.
  **Full sweep**: world 75/75 · transport 123/123 · economy 104/104 · visuals 82/82 · visual
  56/56 · military 115/115 · ui 120/120, 0 pageerrors. TWO PRE-EXISTING FAILURES, both proven
  unrelated by re-running with the pristine `origin/claude/roads-wip-backup` files and getting
  the identical tallies: polish 63/67 (custom-music upload silently no-ops after a `page.goto`
  reload — reproduced in isolation, the upload works fine WITHOUT the suite's two reloads, so
  the settings file-input handler is not re-wired on reload; audio area, untouched here) and
  mp 124/126 (the far-behind-guest "catching up…" veil never shows). The visual suite also
  failed on 0/10 film strips being on disk — those are review ARTEFACTS that never came across
  with the untracked WIP; regenerated with `node tools/_fs_filmstrip.cjs <subject…>` → 56/56.
  Shots: `shots/fs_roads_{network,grazing,slope,water,town}.png`.
- 🧑‍🌾 **THE VILLAGER — the people are a sculpt now (2026-08-01)**. Serfs AND knights render
  from the Tripo-generated villager in `assets/farmstead/cast/villager/` (see its REPORT.md for
  the generation pass) instead of the ~380-triangle procedural minifig. The minifig is NOT
  deleted — it is the fallback, and `FSModels.castOn()` is the only switch.
  **VARIANT = vertex-coloured, used RAW.** The textured variant was rejected on architecture,
  not looks: every serf pool shares ONE `vcMat("serf")` and bodies merge with procedural
  parts, so a 512px character map has nowhere to live (the 4x4 building atlas cannot hold a
  UV-unwrapped face). The vc cut IS that texture, sampled per vertex. ⚠ The obvious
  `convertLinearToSRGB` ([[gltf-linear-color-gotcha]]) is WRONG HERE and a measurement proves
  it: the source JPEG's mean texel is rgb8(155,108,74) and the stored COLOR_0 mean is
  (0.690,0.486,0.333) = rgb8(176,124,85) — the baker wrote sRGB texels, not linear. Converting
  gives rgb8(216,185,156), a milky beige with "dark boots" reading as tan (shot proved it).
  The renderer sets no `outputEncoding` (r128 default Linear) so every hand-authored hex reaches
  the screen unconverted too — raw IS the world's space. Only tuning applied: chroma ×1.18
  about luma (`cast.sat`), because a photogrammetry-ish bake is flatter than the flat-Lambert
  palette around it.
  **LOADER = ~90 lines, no GLTFLoader.** farmstead lost its loader with the castle GLB and
  these three files are the narrowest possible glTF (one node, one mesh, one triangle prim,
  tight float attributes) — re-vendoring 40 KB for skins/Draco/cameras nothing uses is the
  worse trade. `FSModels.parseGLB` is deliberately STRICT (throws on anything it does not
  understand) because a silent half-parse would put a broken villager where the fallback would
  have put a working minifig. Fetches start at script-eval; `FSModels.castLoaded` is the
  promise the suites await.
  **ASYNC SWAP**: pools cache their geometry at creation and the villager lands mid-flight, so
  `cast.gen` ticks on load/toggle and fs-render's `dropCastPools()` throws away every
  serf*/knight* pool on the next `syncSerfs`. Geometry is retired ONE generation late so a pool
  that has not noticed yet can still draw it.
  **GARMENTS ARE DYED, NOT BUILT — two wrong answers first, both instructive.** (1) Primitives
  at measured coordinates: the cap let the skull poke through its crown, the surcoat vanished
  inside a chest no cylinder fits, the belt read as a wire. A sculpt has no radius. (2) A SHELL
  (the body's own triangles between two heights, offset along their normals): fits by
  construction, still tore — an offset surface self-intersects at high curvature, so bare skin
  came back through the surcoat at the shoulder roll — and cost 3000 tris for one coat. The
  answer is `castPaint`: re-dye the body's own vertices between two heights. Exact fit, ZERO
  triangles, nothing to intersect. Dye is decided PER TRIANGLE off its centroid (per-vertex
  melts the hem into a gradient and reads as a stain) with vertex splitting only along the
  seam, and modulated by the pixel's own luma so the sculpt's creases survive. Bands must be
  ≥ ~0.10 tall or the shipped 1498-tri cut goes threadbare — a triangle spans ~0.03 of him.
  Team reads three ways (shoulder YOKE for the overhead camera, waist BELT — the one height a
  band passes UNDER the hanging sleeves — and a chest baldric); job is the cap; knights get a
  full surcoat + mail coif + steel helm + greaves, rank still on plume/shield-rim/pips.
  **HIPS ARE PER BODY KIND** (`FSModels.hipOf`/`knightHipOf`): villager ±0.1235/0.255/z0.028
  vs the minifig's ±0.075, swing 0.34 rad (not 0.52) about a pivot 0.085 BELOW the joint. The
  split gave the legs a slab of tunic skirt, so swinging about the anatomical hip at full
  minifig amplitude visibly splits him at the waist; dropping the pivot keeps the hip still
  while the toe still travels 0.11. Left and right are different sculpts, so `serfLegGeo(side)`
  takes a side and the villager needs a pool each way (the symmetric minifig boot keeps one).
  **PERF — measured, and the fix is not what the brief assumed.** Large developed town, 76
  serfs, both passes in one process, `readPixels` after every frame (WITHOUT it `gl.finish()`
  under ANGLE/SwiftShader reports ~1.6 ms and hides all the GPU work): minifig 92 ms / 260k
  tris → full 6000-tri villager 168 ms / 675k tris = **+58%**, over the +30% budget. The cause
  is not that 6000 is big, it is that it is wrong for the SCREEN SIZE — a 0.79-unit villager at
  the camera's usual 26-40 units runs a dozen triangles per pixel, and sub-pixel triangles cost
  on a GPU too (each shades a 2×2 quad), so this is not a headless artefact. Decimating the
  shipped body to a budget that hits +30% works out at ~1800 tris, which the generation pass
  already rejected as "shattered glass". So the shipped cut is a 3-step Blender collapse to
  **1498 / 271 / 270** (`tools/_villager_lod.py`, re-runnable from the vc GLBs at zero Tripo
  cost — vertex colours ride through the CORNER-domain attribute, mean COLOR_0 drift
  0.6898→0.6875, no re-bake and no need for the 100 MB fullres .blend). Re-measured: **107 ms /
  358k tris = +19%**. At `CAM.DIST_MIN` (8, the closest a player can legally get) the two cuts
  are indistinguishable — shots prove it. The full 6000 cut still ships behind
  `setCast({detail:"hi"})`. 124 KB shipped, 497 KB for both cuts.
  **Suites**: visuals gained section 6b (17 checks: load/indexed/vertex-coloured, per-side legs,
  stands on y=0 at the minifig's height, hips, mid-stance foot contact, full-stride graze, seam,
  stride travel, pool count — plus a request-interception page where the .glb is BLOCKED, proving
  the load resolves false, the minifig takes over on its own hips with ONE leg pool per kind,
  and the settlement still fills with people, 0 page errors) → **82→99**. Its `tris()` helper is
  now `FSModels.triCount` (index-aware — bodies ship INDEXED; de-indexing the villager would
  triple every serf) and the ~300-tri person ceiling became a per-mode budget. visual's "legs
  cost exactly TWO draw calls" became castOn-aware (4 villager / 2 minifig). Full battery:
  world 75 · transport 123 · economy 104 · visuals 99 · visual 56 · military 115 · ui 120 ·
  polish 67 · mp 124/126 (the known far-behind-guest veil, untouched). Film strips regenerated
  (serf-walk-flat / serf-gait-closeup / serf-door / duel / knight-march; gait CV 0.107, maxJump
  1.02x, yaw 0 — no foot skate).
  **TEST GOTCHAS**: a bounding box is the WRONG way to measure stride — the leg's upper mass
  counter-rotates about the hip so the box's extremes travel backwards while the foot travels
  forwards; track the lowest vertex. Pools only exist once something has been DRAWN since the
  villager landed (his arrival drops them all), so read pool counts after a frame, not after a
  geometry call. The blocked-GLB page logs three `net::ERR_FAILED` console errors by design —
  filter those, not the whole console. And `map.bldAt`/`map.obj` (not `map.bld`) are what a
  staging script must check to find open ground, or the shot is four knights behind a pine.
  Shots: `shots/fs_villager_{closeup,walk,town,carrier,knights,two_players,before_minifig,
  after_villager,lod_full6000,lod_shipped1498}.png`.

## 🎞 SPRITE-IMPOSTOR VIABILITY DEMO — exploration only, NOT shipped (2026-08-01)

User question: "what if we kept the 3D terrain and camera/map but we used sprites and had
that 3d rotation effect — gauge how viable that would be." Answered with a live page, not a
memo. **`farmstead-proto/sprite/spritedemo.html`** (frozen-experiment precedent: the whole
dir is self-contained — its own copies of fs-const/fs-map, the terrain+lighting+fog+camera
rig lifted verbatim out of fs-render, and its own vendored r128 GLTFLoader. The live
fs-models.js / fs-render.js / farmstead.html were neither edited nor runtime-imported —
another agent was mid-integration on them.) **Full write-up + every measurement:
`farmstead-proto/sprite/VIABILITY.md`.** Verify: `node farmstead-proto/sprite/_verify.cjs
[--shots]` → 38/38, 0 pageerrors. 10 screenshots `shots/fs_sprite_*.png`.

**VERDICT: the technique works and is indistinguishable at play zoom; Farmstead does not
currently need it.** Swap every villager mesh in a frame for a baked sprite and 4-5% of
pixels change by >12/255 (whole-frame mean delta ~2/255) — see `fs_sprite_sidebyside.png`,
sprites left of the midline, meshes right. 1000 units: **4 draw calls / 2,000 tris vs 6
calls / 7.6M tris.** But impostors only pay against a triangle budget, and the `-lo-vc` cut
the integration already ships (2,039 tris) puts 800 serfs at 1.6M tris — an ordinary frame.
Build it only if a real device fails on the lo cut, or if SERF_CAP/animals/carts push the
count up. Bake from `-lo-vc` if it ever happens: it bakes to essentially the same sprite as
the 7600 cut (contrast 10.74 vs 11.65, luminance 91.2 vs 91.4).

**Design facts worth keeping** (all measured, all in VIABILITY.md): the game camera DOES
orbit 360° (`CAM.ORBIT_YAW` on right/shift-drag, Q/E) with pitch 35–70°, so full azimuth
coverage is mandatory and pitch is the unsolved axis (bake 2-3 pitch rows if it ships) ·
**16 angles is the setting** — per-frame change across one 22.5° bin is 6.5-7.1 vs the real
mesh's 6.7-7.0, i.e. statistically identical; 8 angles is 13.3-13.6, visibly popping · 128px
cells cover the whole zoom range (villager is 26px at DIST_START 34, 109px at DIST_MIN 8) →
2048×896, 9.4 MB · a Δ-indexed atlas provably CANNOT carry a world-fixed sun (one frame
serves every facing/camera pair with the same difference), so the key light is baked
camera-relative; measured cost of the wrong sun side is 12.7/255 (~13.8%) · impostors are a
TRIANGLE win, not a draw-call win (mesh path is already instanced) · at 1000 units the blob
SHADOWS cost 10,000 tris, 5× the sprites · **statics: don't** — after a ~110° orbit the barn
impostors read as flat cards sunk into the hillside (`fs_sprite_statics_impostor_orbit.png`
vs `_mesh_orbit.png`); trees survive but the game's procedural trees are ~100 tris already.

**GOTCHAS that cost real time here:**
- `WebGLRenderer.setViewport/setScissor` take LOGICAL px and multiply by pixelRatio
  internally. Baking tiles on a dPR-2 display doubles their offset+size, and "restoring" with
  `setViewport(0,0,canvas.width,…)` — canvas.width is already DEVICE px — doubles again and
  leaves the WHOLE PAGE rendering into the bottom-left quadrant, magnified. Bake at
  `setPixelRatio(1)` and restore the saved `getViewport()/getScissor()` vectors.
- The impostor quad must be VIEW-ALIGNED (camera image plane), not cylindrical: the bake is
  an ortho render from a pitched camera, so a world-vertical quad needs a 1/cos(pitch) stretch
  and still reads as a card in a hole. And it needs a DEPTH BIAS toward the camera (~0.22 ×
  quad width) — an ortho bake contains pixels below the ground anchor (the near foot seen from
  above) and the terrain z-tests them away, slicing every unit's feet off.
- GL work is queued: timing a bake with `performance.now()` measures the submit. A 4096px
  atlas "baked in 2.7 ms" until a 1-pixel `readRenderTargetPixels` drained the pipeline. The
  table's absolute ms are SwiftShader-CPU and ~1-2 orders pessimistic.
- Headless: use `--use-angle=swiftshader` (the house convention), NOT `--use-gl=swiftshader` —
  the latter lost the WebGL context mid-bake and every downstream shader failed to link with
  an EMPTY info log, which reads like a shader bug and isn't.
- The villager's COLOR_0 is DISPLAY-referred, not scene-linear (measured mean 0.69/0.49/0.33
  = the tan the Blender preview shows); running the usual convertLinearToSRGB blows him out to
  white. The game's own integration reached the same answer (`cast.srgb = false`) — two
  independent measurements, one conclusion. Also: the TEXTURED GLBs carry an all-zero COLOR_0
  left over from the vc pipeline; honouring it multiplies the baseColor map to black (baked
  luminance drops to exactly the emissive lift, 55.9). Trust vertex colours only on `-vc`.
- Atlas mipmaps bleed across tiles; a 6% transparent gutter is the cheap mitigation, a WebGL2
  `sampler2DArray` (one layer per frame) is the real fix.

## 🌾 FARMSTEAD PLAYTEST BATCH — ten fixes from one session at the wheel (2026-08-01)

User playtest, ten items. Every number below is MEASURED — 8 medium boards, 4 players,
before vs after, with the "before" reproduced by rebuilding pristine copies of
fs-map/fs-const and running the SAME metric through both (scratchpad `mapstat.cjs`).

**1-4 · WORLD GENERATION.** grass 26.1% → **33.7%** (water 49.1 → 40.7, swamp 5.9 → 4.9,
desert 4.6 → 3.6); castle separation 15.5 → **23.5** steps = 24% → **37%** of map width
(and the start-quality tier settles at 2 on every seed instead of drifting to 3-4);
mine-placeable mountain 52.4% → **92.3%**; ore sitting on mine-placeable ground 1598 →
3430; per-start budget spread (max−min over mean) wood **1.22 → 0.25**, stone **1.08 →
0.34**, ore **2.07 → 0.57**; buildable plots per start (144 starts over 3 sizes × 12 seeds)
worst **1 → 10**, mean 82 → 125. Determinism re-proved: same seed twice = same mapHash
across every size and player count, and the full sim replays identically at 3000 ticks.
- **MINES were never a mine problem — they were a ROAD problem.** `whyBuilding` has no
  slope test for mines at all; what walls a peak off is that a road step may not exceed
  `S_ROAD` 1.1 and the mountain band carried 12 world units of relief with NO smoothing
  (`smoothLowland` deliberately left the high ground rugged). `MOUNT_H` 12 → **5.2** plus a
  smoothing FLOOR `SMOOTH_W_MOUNT` 0.42 that applies at any altitude; `MOUNTAIN_Y`/`SNOW_Y`
  re-anchored (2.72 → 2.30, 11.2 → 5.6) so the mountain AREA — and therefore the ore — barely
  moves. Mean ruggedness (largest drop to any neighbour) 3.23 → 1.11, i.e. under the road cap.
- **SEPARATION**: the ladder now weighs the farthest-point set at EVERY rung instead of only
  after the whole ladder failed — a candidate pool clustered on the best-scoring corner used
  to walk all the way down to the floor. Plus `SEP_FRAC[4]` 0.36 → 0.46 and floors raised.
- **FAIRNESS** = new `balanceStarts()`: measure what each start can REACH (road-legal BFS out
  of its own door, so a seam across a cliff is honestly absent), pick a target per resource
  (upper-middle of the four, floored at what topUpStart already promises, CAPPED as a share
  of the disc), then top the poor up and trim the rich to a ±22% band. Wood/stone are counted
  over the whole reachable disc; ORE is scoped to the start's own side (radius 26 discs
  genuinely overlap) with a shared-rock fallback for a start that owns none.
  Six things this cost, all of them lessons: (a) trimming must happen inside the SAME radius
  the budget was counted over or it destroys map content without moving the number; (b) the
  reach BFS cap has to exceed the ore radius or you are measuring the cap; (c) `d < 2` is the
  castle's own footprint and counting it as a mine site hid a start with no ore behind a spot
  count of 1; (d) lifting a bare start to a forested neighbour's budget BURIES it — one board
  came out with a single legal plot in its whole territory, hence the density caps and the new
  `openCastleApproach()` playability guarantee (road-legal reach ≥ REACH_MIN AND ≥ PLOTS_MIN
  buildable plots, else clear frontier clutter); (e) that opener must run BEFORE the balancing
  or its cleared corridors come out of one start's budget; (f) banning plantings from the
  cleared corridor measured WORSE than allowing them (on a hemmed-in start the corridor IS
  most of its free ground) — it is deliberately NOT banned.
- **START SITES** now require minable rock within `MOUNTAIN_MAX` by ROAD-LEGAL walking
  (`distFieldRoad`, new) — crow-flies distance happily crosses a lake — and a wide land share
  (`WIDE_R`/`WIDE_LAND_FRAC`, an O(1) summed-area-table read) because the scorer's own
  grass test covers radius 6 and never noticed the whole PENINSULA.
- Green space: `SEA_BOWL` 0.75 → 0.38, `WATER_N` 0.27 → 0.21, `SWAMP_MOIST` 0.62 → 0.72,
  `DESERT_MOIST` 0.16 → 0.11, `FOREST_T` 0.50 → 0.56, `ROCK_T`/`ROCK_P` eased.

**5 · SUITABILITY OVERLAY IS A PROPERTY OF THE MODE.** `syncSuitOverlay()` is now the only
caller of `overlaySuitability`: on throughout placement mode (filtered to the armed type),
off the moment placement ends, and a hand toggle (T) dies at the next mode change. The old
`filteredSuitFromBuild` latch is gone — it was what let the overlay outlive its mode.

**6 · PLACE → CONNECT.** A finished building hands you the ROAD tool with its own door flag
already seeded as the start (`FSUI.roadFrom()` is the suite contract), so the next click is
the far end. The QoL#1 one-click connect chip still appears alongside. Two old UI checks were
SUPERSEDED and rewritten in place (QoL#2's "overlay appears only when a type is armed", QoL#5's
"build mode stays armed after placing").

**7 · AI DIFFICULTY** — `FSC.AI_DIFF` easy/normal/hard OVER `AI_PERSONA`, exactly the Farm
Kart DIFF_BEHAVIOR pattern: personality says who a rival IS, difficulty says how hard they
play (planner cadence, expansion hunger, concurrent sites, wish-list budget, the odds they
demand before attacking, attack cadence, committed share, and — defensively — extra occupancy
levels on threatened buildings, AI only). NORMAL is all-1s, i.e. exactly today's game.
LOCKSTEP: it lives in `G.difficulty`, set at `newGame`, serialized with the world, and carried
into MP through the host's `settings` block — a guest can never run different opponents from
its host. UI: a Rival-skill segment beside Rivals, persisted in `localStorage fs_diff`.
Measured at 12 in-game minutes on medium/12345: easy 8 bld / 550 land / 1 mil / 5 knights ·
normal 12 / 551 / 4 / 9 · hard 17 / 588 / 7 / 15 — monotonic on all four.

**8 · BUILDINGS ARE SOLID** (the reported "villagers walk through the castle"). Root cause was
NOT `passable()`: `map.bldAt` only ever marked a building's ANCHOR, so five sevenths of a
castle was open meadow to every pathfinder. New `map.bldFoot` marks the BODY — the ring of a
size-2 building minus its DOOR (which carries the flag every road and delivery needs), and
grandfathering any vertex that already holds a flag or road so building alongside your own
roads still works. Blocked in `offroadPath` (dest-vertex exemption preserved: a serf whose
errand IS the building still walks in, site crews still reach the pad), in `whyRoadStep`,
`whyFlag`, `whyBuilding`, in the offsite-worker target sampling (`freeGrass`, the fisher's
shore pick), the geologist's spot pick, the attacker's slot ring, and the AI's own scans.
Derived state: rebuilt from `G.buildings` on deserialize, so old saves load into the new rule.
**The knock-on that took the longest**: the cleared castle RING was the corridor every opening
road escaped through, and sealing it left one measured seed with FOUR road-reachable vertices
— a start that cannot build. Hence `DOORSTEP_R` (two rings of clear doorstep) and
`openCastleApproach`. Worst-case road-reachable across 72 kingdoms: 13 → 43+.

**9 · TREE SWAY** — `onBeforeCompile` on the tree materials only: displacement masked by the
vertex's own height (trunk foot planted), phase hashed from `instanceMatrix[3]` so a wood
ripples instead of swaying as one block, two detuned sines. `VIS.TREE_SWAY` 0.07 world units
at the canopy ≈ four degrees on a 2-unit pine. Zero draw calls, zero geometry, zero FSC.rng.
`FSRender.setTreeSway(false)` freezes the clock dead (verified frame-stable) and the FILM-STRIP
RIG disables it — those sheets exist to judge one thing and 24 frames of drifting foliage is
noise in every one. Default ON in the game. Measured 10.3% of pixels differ between stills a
second apart.

**10 · CARRIED GOODS RIDE PER BODY** — `FSModels.carryOf()` beside `hipOf`: minifig 0.86 (his
cap crowns at 0.855, unchanged since Phase P), villager `VILLAGER.TOP_Y + 0.012`.

**⭐ USER PREFERENCE, same day: THE ORIGINAL MINIFIG SERFS ARE THE DEFAULT AGAIN.** After
seeing the Tripo villager in game the user asked for the procedural people back. Nothing was
deleted — `cast.on` is now `false`, the boot-time `loadCast()` is gated, and a DEFAULT BOOT
MAKES ZERO NETWORK REQUESTS for the cast (asserted by request interception, not by reading a
variable). Opt in three ways: `FSModels.setCast({on:true})`, `localStorage fs_cast="1"`, or
`?cast=1` (which also writes the flag). The GLBs stay in `assets/farmstead/cast/villager/` —
the sprite-impostor exploration uses them too. visuals §6a is the new default-path section;
§6b runs the whole villager battery behind the opt-in, blocked-GLB fallback included.

**SUITES**: world **81/81** (+6: separation, mine-legality, green share, per-resource fairness,
determinism) · transport **131/131** (+7: the solidity section) · economy **104/104** · visuals
**113/113** (+7 sway, +6 default-cast, +1 villager carry height) · visual **56/56** ·
military **124/124** (+9 difficulty) · ui **128/128** (+8 placement flow) · **mp 126/126** —
the long-standing far-behind-guest veil failure passed on an idle box, which is the real
lesson: this suite's clock-sensitive checks (veil, catch-up, ping) FAIL under a parallel
Chrome and pass alone. polish 63/67 is the known, unrelated custom-music-after-reload gap.
Suite staging that the new world legitimately invalidated, fixed rather than bent: the
`pickVertex` sky probe (the island now fills a steep close view — it sweeps for real sky),
`T.flagSpot` (shortest road, not first found — roads detour around buildings now and a 16-edge
road blew every fixed tick budget), the fish-migration seed (needs ≥2 open MIGRATE directions),
the pig-breeding window (a lottery needs more than 14 cycles), `T.spotsNear` (never stage on an
ENEMY TEAM's ground — ownership was only lent for the terrain test, then the conquest cascade
burned the fresh building down), the boat crossing (re-plot after wiring the near shore), the
cramped-AI seed 777 → **22** (777 opened up to 69 plots; 22 is 17, against a median of 103),
the AI-war seed 12345 → **101** (12345's starts are no longer close enough to fight), the
cross-siege geometry (equal-distance sources, and read the LOSER off the result — which column
wins is the map's choice), and the `legPools` count (a ceiling: a pool only exists once
something has drawn from it). `SIM_BASELINE` in the visual suite was RE-BASELINED — golden
hashes, not invariants, and both halves were recomputed and re-verified reproducible.
Shots: `shots/fs_batch_{difficulty_picker,map_seed7,map_seed42,map_seed1234,mines_on_mountain,
suitability_on,suitability_off,serfs_around_castle,sway_t0,sway_t1,sway_t2,carrier_ride_height}.png`.

---

# 🧍 FARMSTEAD FORK B — baked cast sprites (2026-08-01, PRODUCTION SHEETS, awaiting in-game integration)

The user picked **Fork B**: the game camera becomes **YAW-LOCKED** (classic Settlers fixed
view, pan + zoom only) and serfs/knights render as **baked sprites**. This entry is the
pipeline + the shipped sheets. NOTHING is wired into the game yet — a later agent does the
integration. Bake source is the **original procedural minifig** (the user reverted to it; do
NOT bake the Tripo villager over these sheets), frozen from
`git show origin/claude/roads-wip-backup:assets/farmstead/fs-models.js` into
`farmstead-proto/sprite/fs-models-frozen.js`.

**THE SHEETS**: `assets/farmstead/cast/sprites/` — `serf-body.png` 1536×1920 (582 KB) ·
`serf-mask.png` 768×960 (47 KB) · `knight-body.png` 1536×1920 (660 KB) · `knight-mask.png`
1536×1920 (206 KB) · `overlays.png` 1536×2944 (259 KB) · `manifest.json` (142 KB, minified —
1800 anchors) · `README.md` (the schema, generated FROM the manifest so it cannot drift).
**1.75 MB of PNG (1.9 MB with the manifest), 53.8 MB as RGBA8 in VRAM, 12 azimuths, ONE
pitch row at 52° (`FSC.CAM.PITCH_START`), world-fixed sun.** Levers if that is too much:
fewer azimuths, 96 px body cells, or dropping tools the map never uses.
The integration agent needs `assets/farmstead/cast/sprites/README.md` and nothing else.

**REBAKE**: `node tools/_fs_bake_sprites.cjs [--contact]` (repo served on :8790). Config block
at the top of that file; bake logic in `farmstead-proto/sprite/fs-cast-bake.js`. **Model-agnostic
for real, not in theory**: `--source villager --out <dir>` runs the identical pipeline (same
azimuth grid, locked scale, pose maths, manifest schema) over the Tripo GLBs and emits body +
mask sheets — verified end-to-end, then deleted. It skips the overlay half only because that
asset has no separable hat/tool/pack.

**WHY FORK B UNLOCKS THIS** (contrast with `farmstead-proto/sprite/VIABILITY.md`, the orbiting
study): a locked camera means the atlas indexes the unit's ABSOLUTE facing, not
`cameraYaw − unitYaw`. One frame no longer has to serve every (facing, camera) pair with the
same difference, so the **sun can be world-fixed** (bake camera stands still, the MODEL turns)
and **one pitch row** suffices. If yaw is ever unlocked these sheets are wrong and must be
re-baked delta-indexed.

**THE COMBINATORICS SOLUTION** (the actual deliverable — per-job sheets would be 23 jobs × 4
players, plus 5 ranks × 4 players):
1. **Neutral bodies.** One serf, one knight, no hat/tool/pack/pips. Team + rank regions baked
   with a WHITE albedo and **no emissive lift**.
2. **Mask sheet**, same grid, unlit: **R = team, G = knight rank trim**. Formula in the
   manifest: `rgb = base * mix(mix(1, team, mask.r), rank, mask.g) + tintEmissive * max(r,g)`.
   The emissive add-back is why tinted regions are EXACT and not `emissive*(1−tint)` too dark.
   maskDiv is PER SUBJECT — serf 2 (one chunky sash), **knight 1** (a 2-3 px plume/rim against
   the team shield bleeds R into G at half res: a gold rim comes out pink).
3. **Overlays** — hat, pack, 10 tools, rank pip — own 64 px cells on the same azimuth grid,
   posed on the body. **The cap geometry is IDENTICAL for all 23 jobs; only `FSC.JOB_COLOR`
   differs — so ONE white-baked hat sheet tinted per job collapses 23 sheets into 1.**
4. **Anchors are GENERATED**: every body cell projects its 3D mount points (hat/tool/pack/carry,
   helmTop/pip0-3) into cell pixels; every overlay cell carries its own `pivotPx`. Composition
   is `overlayTopLeft = bodyAnchor − overlayPivot`. 1800 anchors, none hand-authored.

**AZIMUTH RECOMMENDATION: 12** (what shipped), measured not guessed. Two experiments, both in
the preview's hooks (`measureTurnPop`, `measureFacingError`):
- **Turn-pop** during a real hex heading change at `SERF_TURN_RATE` 7.5 rad/s (7.16°/frame),
  REAL sheets baked at each count. Peak jump is flat across counts (small-sample max); the
  statistic that matters is **pop/mean, the stepping signature**: 6 → **9.8**, 8 → **7.1**,
  12 → **5.0**, 16 → **3.3** (3D mesh reference: 1.3). At the default zoom the unit is 12 px
  and 12-azimuth pop is 0.033/255 over the crop — invisible.
- **Static hex-lattice error** — the decisive one. A serf rests on one of six 60° headings, so
  an azimuth count that does not divide 60° renders a STANDING serf permanently wrong.
  6/12/24 are exact; **8 is off by 15° forever (image diff 0.217 at max zoom), 16 by 7.5°
  (0.125)** — 8 and 16 are disqualified outright. Among the exact counts, 6 has twice 12's
  popping signature and only 6 silhouettes for an asymmetric character; 24 doubles every sheet
  for a gain visible only at max zoom during a deliberate hard turn.

**POSES ARE THE GAME'S OWN** (frozen `fs-render.js`, nothing invented): serf idle ×1 · walk ×8
(`|cos(phase)|*0.052` bob, 0.06 lean, ±0.10 twist, ∓0.055 roll, legs ±0.52 rad about the hip) ·
work ×6 **uniform in `serfSwing`'s 0..1** so `k = round(swing*5)`. Knight guard ×1 · walk ×8 ·
fight ×6 keyed by `duelPose`'s **`l`** ∈ [−0.34, 1.0] (frames carry their `l`; pick nearest).
**Deliberately NOT baked, and why**: carry-walk (the frozen `drawSerf` does not pose a carrier
differently — only a baked pack + a separate crate mesh, so those cells would be duplicates) and
a knight fall (**the game has none** — a dead knight becomes `corpseGeo`, a flat mesh that
scales away). Each fight frame also carries `lungeOffset`, the WORLD displacement toward the foe
that `knightVisual` applies — the sprite does not contain it, the integration must.

**BUGS THIS COST, all worth knowing**:
- **Bounds by world-AABB corners are wrong for a subject that rotates.** The yawed knight's
  world AABB is a square of side 2·maxRadius whose corners are empty air; projecting them
  inflated the shared frustum ~70% and left the serf filling 40% of his cell. Project real
  VERTICES — halfSpan 1.108 → 0.650, resolution +70%.
- **Sheets are top-left origin, so `texture.flipY = false`.** With three's default the whole
  cast renders upside down AND every anchor (computed in world space, not UV) points the wrong
  way.
- **Depth bias is a WORLD distance, not a fraction of each layer's quad.** Scaling it per layer
  pushed the 64 px overlay quad half as far forward as the 128 px body quad, so the body
  z-tested every hat and tool away and only the overhanging sliver showed.
- **Overlays must be baked behind a DEPTH-ONLY copy of the host body**, or a tool on the far
  side draws straight through the man. 119/1092 cells come out fully hidden (a pack from the
  front, a chest pip from behind) — they carry `"empty": true`; skip the draw.
- **Every per-instance attribute needs `needsUpdate` every frame.** One missed (`aTint2`) kept
  whatever it held at first upload while instance indices changed meaning underneath — it read
  exactly like "the rank mask is broken".
- The dPR-1 bake rule and the `readRenderTargetPixels`-to-drain rule from VIABILITY.md still
  apply and are commented at their call sites.

**"Fixed feet baseline" means the PROJECTED GROUND ANCHOR** (`footPx` = one constant, (64,
94.09), for the whole bake), not the lowest opaque pixel — the minifig has depth and a pitched
camera maps depth to screen-y, so a boot toe or a knight's shield swinging toward the camera
legitimately drops below it. The suite bounds that spread by the model's own depth extent.

**PREVIEW / ACCEPTANCE**: `farmstead-proto/sprite/forkb.html` — yaw-locked camera over the real
demo terrain, 220 sprites walking hex paths with turns, team + rank tint through the masks, a
fully composed job (hat + tool on generated anchors), a knight strike loop, all in **5 draw
calls / ~5.3k triangles**. `?sheets=<dir>` loads an alternate bake. `__FORKB__.poseCompare()`
draws the FROZEN merged 3D builder beside the sprite — that is how the bake was judged, not by
eye. **VERIFY: `node farmstead-proto/sprite/_verify_forkb.cjs [--shots] [--measure]` — 143/143,
0 pageerrors.** Shots: `shots/fs_forkb_{atlas,crowd,walkturn_a/b/c,composed_job,knight_strike}.png`.

**FOR THE INTEGRATION AGENT**: read `assets/farmstead/cast/sprites/README.md`. The lock is
load-bearing — the game's camera yaw must equal `manifest.bake.cameraYaw` (0) or every sprite
faces wrong. `forkb-preview.js` is a working reference renderer (view-aligned billboard, atlas
UV + dual tint injected into `MeshBasicMaterial` via `onBeforeCompile`, one InstancedMesh per
layer); lift it rather than re-deriving the anchor arithmetic. Contact shadows are NOT baked —
VIABILITY.md's finding that blob shadows outcost the sprites 5:1 still stands and wants an
atlas tile or decal. NOTHING in `assets/farmstead/fs-*.js` or `farmstead.html` was touched.

## 🧍 FORK B IS IN THE GAME — sprites by default, camera locked (2026-08-01)

The integration the entry above was written for. `farmstead.html` now renders serfs and
knights from `assets/farmstead/cast/sprites/` on a **yaw-locked camera**, with the 3D people
kept underneath as an automatic fallback. The LOOK is unchanged — the sheets were baked from
the minifig — so `shots/fs_forkb_sidebyside.png` (3D left, sprites right, one camera, one
world) is the whole point: you cannot tell which half is which at play zoom.

**PRECEDENCE, written where each flag lives (fs-render's `SPR` block, fs-models' `cast` block):**

    sprites (default)  >  cast opt-in (?cast=1)  >  procedural minifig

Sheets fail to arrive → `SPR.ready` stays false and the 3D path carries the settlement,
silently. The villager opt-in now only chooses which body THAT fallback wears; with sprites on
he never reaches the screen (asserted both ways). Opt out per link/device/QA: `?sprites=0`,
`localStorage fs_sprites="0"`, `FSRender.setSprites(false)`. `?sprites=1` opts back in — and,
like `?cast=1`, both forms WRITE the localStorage flag, which leaks between same-origin test
pages in one browser profile (that bit once; the visuals suite now asks for them back
explicitly).

**THE CAMERA CONTRACT** (`FSC.CAM`, fs-render `clampCam`): `YAW_LOCK = 0` = `manifest.bake.cameraYaw`,
and it is an ASSIGNMENT, not a clamp — `setCam({yaw})` from a save, a gesture or a
test is overruled, because a camera that can drift off the bake is a whole-cast rendering bug
that reads as an art bug. Orbit input is gone: right/shift-drag now PAN like left-drag, q/e are
no longer claimed by the renderer at all, the touch 2-finger TWIST is dropped (pinch-zoom +
2-finger pan stay), and both help texts lost "Q/E turn". Settings' "invert camera" was the
vertical ORBIT look; it now flips the vertical PAN — same preference, applied to the one axis
that still moves.
**PITCH is a MEASURED band, 49°..58°** around the bake's 52°. Measured in-game, not guessed
(scratchpad `fs_pitchband.cjs`): one still serf, same world and camera rendered twice — sprites,
then the 3D fallback the sheets were baked from — differenced over a 110 px crop, swept 30°→74°.
At the closest legal zoom the mean |ΔRGB| is a clean V with its minimum EXACTLY at the bake
pitch: 30° 5.73 · 40° 4.89 · 46° 3.60 · 50° 2.17 · **52° 1.21** · 56° 2.20 · 58° 2.40 · 64° 2.74
· 74° 3.18. 1.21 is the bake's own floor (cell resolution, AA, and the constant depth bias); the
band is where the error stays inside TWICE that floor. It is asymmetric because tilting toward
top-down saturates while tilting toward side-on shows the card edge-on. At the default zoom the
whole sweep is under 0.4 — invisible either way. Pitch has no player input any more; the band
exists so a saved or staged camera can be nudged for framing.

**THE RENDERER** (fs-render.js, `SPR` block ≈ 300 lines): three InstancedMeshes — serf bodies,
knight bodies, overlays — so the WHOLE workforce is **2-3 draw calls**. `forkb-preview.js`'s
approach was ported, not re-derived: view-aligned quad, atlas cell + dual tint injected into
`MeshBasicMaterial` via `onBeforeCompile`, `texture.flipY = false`, ONE world-distance depth
bias shared by every layer, `empty:true` cells skipped, every per-instance attribute
`needsUpdate` every frame. Frame lookup is the manifest's own rule (azimuth from the RAW facing
— the walk's ±0.10 twist is already IN the cell; walk k from `vis.phase`; work k from
`serfSwing`; fight k from `duelPose`'s `l`, with the world lunge still applied by
`knightVisual`). Hats tint per `FSC.JOB_COLOR` off the one white-baked hat sheet, pips per
`FSC.RANK_COLOR`, team through mask R, rank trim through mask G. Kept 3D on purpose: the
carried crate (seated on the sheets' own `carry` anchor — `(footPx.y − anchor.y)/(ppu·cos pitch)`
= 0.86 + that frame's bob, verified), the boat + wake, the contact shadow, and a fallen
knight's corpse (**the bake has no fall pose because the GAME has no fall animation**).
ADDED for the port: a per-instance `aScale` so the doorway fade still shrinks a serf toward his
own foot pixel instead of blinking him out.
**BUG THIS COST** (found on re-read, not by a test): `aOff` must go into the shader UNSCALED.
The shader multiplies `(−anchor + off + quad)` by `aScale` as one term, so pre-scaling the
overlay offset shrank every hat toward the feet by `scale²` while the body shrank by `scale` —
the cap sliding down through the head for the 0.22 s of a doorway fade.

**PERF**, measured on a 103-serf large-map town, whole settlement in frame, sprites vs the same
frame with `setSprites(false)`:

| | draw calls | triangles | **people triangles** | people draws | frame (med) |
|---|---|---|---|---|---|
| sprites | 81 | 272,235 | **470** | 2 layers | 0.8–1.7 ms |
| 3D fallback | 93 | 305,777 | **33,892** | 13 pools | 1.6 ms |

72× fewer triangles for the cast. NOTE the first frame after a layer rebuild is a ~100-170 ms
SwiftShader SHADER COMPILE — warm up past it or a perf table measures the compiler (steady
state re-measured over 3×60 frames: worst 1.7-2.2 ms).

**SUITE RESHAPE.** visuals 113 → **142**: §6a is now "the default cast is the sheets" (proven on
the WIRE — all six files fetched, villager GLBs still never asked for — plus zero 3D people
pools and ≤3 draw calls); NEW §6b is the sprite contract cell by cell (12 azimuths at the baked
pitch · all six hex headings land on an EXACT cell with 0° error and the azimuth wraps · the
walk frame advances one step at a time through the whole cycle · work frames uniform in the
swing · nearest fight frame incl. guard · all 1800 generated anchors inside their cells, all 973
pivots too, every composed placement on the body · all 119 hidden cells skipped by the DRAW
PATH's own resolver) plus a repaint probe that reads the two tint channels off the SCREEN (team
colour swapped red↔green: pixels move, only 1.7% of the man's, and they take the colour they
were given) and a door-fade probe that reads the `aScale` attribute the shader actually
consumes; §6c/§6d/§6e keep the 3D path honest — sprites-off hands the workforce back to the
minifig, the villager battery runs UNDER that fallback, and a page with the SHEETS blocked
proves fail-soft (load resolves false, no half-drawn layer, minifig takes over, camera still
locked, 0 page errors). visual 56 → **60**: the leg-pool budget check became sprite-aware, and a
new §2b covers the frame-step signature. Camera-lock ripples were restaged, not bent: world's
"pickVertex after orbit + zoom" is now "after pan + zoom" and gained a yaw-lock check (four
wild yaws all overruled) plus a q/e-does-nothing check; polish's "2-finger twist rotates the
yaw" became "can no longer turn the world" + "…and still pans"; transport's "one mesh per
job+player" and military's "two knight pools" now assert whichever path is live.
**FILM STRIPS render in the SHIPPING default (sprites)** — the strips exist to judge what the
player sees, and the gait telemetry they are judged on (`R.serfPose`, CV/jump/yaw) is
MODE-INDEPENDENT because both paths pose from the same visual state. `--fallback` renders the 3D
people for reviewing the minifig path. The rig's `DIST_MIN = 3` override stays (distance is a
play constraint); pitch is NOT overridden any more — it is a rendering contract, and a strip
shot outside the band would judge a pose the game cannot show. All 10 reviewed strips
regenerated (gait CV 0.107, jump 1.02×, yaw 0 — unchanged).

**FULL BATTERY, all green**: world 83 · transport 131 · economy 104 · visuals 142 · visual 60 ·
military 124 · mp 126 · ui 128 · polish 68 = **966 checks, 0 page errors**. (polish's known
custom-music-after-reload flake passed on this box; mp's clock-sensitive checks passed too.)
Shots: `shots/fs_forkb_game_{town,zoom,turn,knightfight,fallback3d}.png` +
`fs_forkb_{before_minifig,after_sprites,sidebyside}.png`.
**KNOWN / DEFERRED**: a failed sheet load stays failed for the session (same as the cast
loader — no retry); the depth bias makes a sprite ~3% larger than the mesh at `DIST_MIN`
(inherited from the accepted bake, invisible at play zoom); contact shadows are still the 3D
blob VIABILITY.md flagged as outcosting the sprites 5:1.

## 🧪 TEST/exploration — two downloaded GLBs through the Fork B pipeline (2026-08-01, look test only, NOT shipped)

User-downloaded `cartoon dwarf` (test **villager**) and `medieval knight` (test **knight**)
run through the sprite bake as a look test, entirely in a NEW, isolated tree so the
production sheets/pipeline above were never touched (re-verified: sha256 of every file in
`assets/farmstead/cast/sprites/` identical before/after). Nothing here ships or is
committed until a license is confirmed on the two source GLBs.

**WHERE IT LIVES** (all new/sibling files, none of the production files above were edited):
`assets/farmstead/cast/sprites-test/` (baked output: `villager-body.png` 1536×1664,
`knight-body.png` 1536×1280, `manifest-test.json`, `README-test.md`, `parts/` = the
normalized/split GLBs + per-model `*-measurements.json`, `_inspect/` = Blender preview
renders + logs from the exploration itself) · `farmstead-proto/sprite/fs-cast-bake-test.js`
+ `bake-test.html` (sibling bake harness, same 12-az/52°/world-fixed-sun/one-locked-scale
recipe as `fs-cast-bake.js`, never imports it) · `tools/_fs_bake_sprites_test.cjs` (driver)
· `tools/_fs_spritetest_{inspect,splitpreview,splitparts,assemblecheck}.{py,mjs}` (Blender +
Node normalize/split pipeline) · `farmstead-proto/sprite/forkb-test.html` +
`forkb-preview-test.js` (copy of forkb.html's preview, own sibling JS, SOURCE toggle
minifig↔test) · `farmstead-proto/sprite/_verify_forkb_test.cjs` — **84/84, 0 pageerrors**,
incl. a byte-hash check that the production sheets are untouched.

**INSPECTION**: both GLBs carry `tripo_*` node/mesh names (Tripo-pipeline provenance,
though downloaded, not generated this session) and ship in a **T-pose**, already facing
+Z (measured off raw vertex data — head-band |Z| extremes are further +Z than −Z on both,
i.e. nose-forward — no yaw correction needed, confirmed independently of trusting Blender's
axis-conversion table by eye). **Dwarf: SKINNED**, the exact same Tripo v1.0-20240301 41-joint
biped rig as `assets/farmstead/cast/villager/` (same joint names, `L_Thigh`/`L_Calf`/etc.) —
7399v/8529t, one stray 42-vert Icosphere object also in the file (marketplace leftover,
excluded by picking the largest-vertex-count primitive). **Knight: NO skin at all** —
8064v/8830t, single static mesh.

**LEG SPLIT — one clean, one honest fallback** (both attempted, judged from real Blender
renders at the production `LEG_SWING=0.52` before deciding, per
`tools/_fs_spritetest_splitpreview.py` + `_fs_spritetest_assemblecheck.py`):
- **villager = TRUE SPLIT** (`posingMethod:"split"`). Same recipe as the shipped villager:
  skin-weight-dominant classification into body/legL/legR (leg joint sets = Thigh/Calf/Foot/
  ToeBase/±Twist chains), each leg recentred on a measured hip pivot (generalized as "centroid
  of the closest-to-parent 12% band" — works without a skeleton too, see below), rigid GLB
  parts, posed at runtime by the UNCHANGED production `serfPose`/`applyPose` hip-rotation
  formula. Rest pose is seamless; at full walk stride a small gap opens at the tunic hem (the
  minifig's tunic is a deliberately bell-flared sphere-hem FOR this technique — REPORT.md
  says so; a realistic tailored tunic has no such slack) — visible in a magnified Blender
  render, much less so baked down to a 128px cell at 52° pitch (see the walk crops).
- **knight = WHOLE-BODY FALLBACK** (`posingMethod:"wholeBodyBob"`). A geometric hip-line
  split (|x|/y-cutoff, no skin to key off) was tried and LOOKED clean in a silhouette
  preview, but the assembled swing test showed a real gap between the mail/tabard hem and
  the greaves — armor has no cloth "give" to hide a rigid-part seam the way the villager's
  tunic does. Shipped instead: guard(1, whole body) + walk(3, vertical bob + gentle lean
  only, no leg articulation — deliberately subtle, a big bob reads as floating not walking)
  + **fight(6, the REAL unmodified production `knightPose('fight')` torso-lunge formula** off
  `duelPose`'s `l` — that pose is pure bob/pitch/roll, needs no legs at all, so "knights
  striking" was fully achievable even in fallback mode. The abandoned `knight-legL/legR.glb`
  split parts are still on disk in `parts/` (harmless, unused, kept as evidence the split was
  really attempted, not just asserted).

**ARM RE-POSE** (found, not asked for — the task brief only covered legs): baking the raw
T-pose gave a spread-eagle sprite because the ~1.0-unit ARM SPAN, not the ~0.79-0.99-unit
standing HEIGHT, drove the locked-scale frustum — a starfish that fills maybe 15% of its
cell. Both arms rotated DOWN ∓75° about a measured shoulder pivot (same "closest-band
centroid" technique as the hip pivot — skin-weight Clavicle+Upperarm+Forearm+Hand chain for
the dwarf, a measured `|x|>0.24` cutoff for the knight) as a REST-SHAPE edit baked into the
exported parts, not an animated rig. `tools/_fs_spritetest_splitparts.mjs` does the whole
normalize pipeline in Node via `@gltf-transform/core` — NOT Blender — deliberately: staying
in native glTF Y-up space start to finish sidesteps Blender's y-up/z-up import remap
entirely (the class of bug the villager REPORT.md's own "rotation_mode force" gotcha and
this repo's various Blender scripts keep tripping on). Blender was still used, just only for
what it's uniquely good at here: the visual QA renders that judged the split/arm-pose
decisions (`_fs_spritetest_inspect.py`, `_splitpreview.py`, `_assemblecheck.py`).
**BLENDER GOTCHA (new)**: relative output paths in a factory-fresh headless Blender resolve
against the DRIVE ROOT, not the shell's cwd (`assets/...` silently wrote to `C:\assets\...`)
— always pass absolute paths to `bpy.ops.render.render`'s `filepath`.

**THE BIG BUG (cost the most time): `.array` on a THREE `BufferAttribute` is not safe to
index directly.** `@gltf-transform`'s `io.writeBinary()` INTERLEAVES POSITION+NORMAL+
TEXCOORD_0 into one bufferView (`byteStride:32`) by default whenever a primitive has all
three — a valid, common glTF layout, and THREE's GLTFLoader correctly parses it into a
`THREE.InterleavedBufferAttribute`. But that attribute's raw `.array` is the WHOLE
interleaved buffer (8 floats/vertex here), not a clean `[x,y,z,x,y,z,...]` run — the bake's
own `camBox()` (adapted from the production file's identical-looking helper) read
`arr[i*3]` and got a cascading mix of position/normal/uv floats from neighbouring vertices.
Symptom: some "positions" landed near ±1.0 (actually normal components), which blew the
locked-scale frustum out ~3.4× (pxPerCameraUnit 33.66 vs a correct 114.57) — sprites baked
at roughly a third of their proper size, most of every cell wasted as padding. Silent and
very hard to spot from the manifest alone (nothing errors; the numbers are just wrong) — only
caught by tracing a specific vertex's expected-vs-actual position by hand. **Fix: read via
`pos.getX(i)/getY(i)/getZ(i)`**, which are stride/offset-aware on every `BufferAttribute`
subtype — correct for both interleaved and plain geometry, no need to know which a given
mesh uses. The production procedural geometry (`mergeColored`) never interleaves (each
attribute gets its own plain `Float32Array`), which is exactly why this class of bug had
never shown up in that pipeline before. **Any future code that walks `.geometry.attributes.*
.array` on a THREE mesh loaded from an externally-authored/optimized GLB (gltf-transform,
Blender's exporter, a marketplace asset) should assume it might be interleaved and use
getX/Y/Z, not raw indexing.**

**PREVIEW UX BUG (also found and fixed, not just a shots-script workaround)**: the "flip
between looks in place" SOURCE toggle originally called `spawn()` on every switch — meaning
toggling would silently teleport every unit to a fresh random layout, defeating the entire
point of a side-by-side comparison. Fixed: `setSource()` now only flips layer visibility;
`units[]` is source-agnostic (job/pose fields carry no per-source meaning) so the same crowd,
same positions, same poses just re-skin through the other layer set on the next frame.

**LOOK ASSESSMENT vs the minifig**: scale/proportion reads well side by side once the T-pose
and the interleaved-buffer bug were both fixed (`shots/fs_spritetest_sidebyside.png` — same 4
units, same poses, minifig left / test right); the villager's walk cycle is genuinely
articulated and reads as "a person walking," not just a bobbing statue; the knight's pauldrons
give it an appropriately bulkier silhouette than the villager, matching the production
knight's own bulk-vs-serf ratio. Palette is more naturalistic/desaturated than the minifig's
flatter toon colours (expected — these are textured, not vertex-painted-toon, source assets).

**SHIPPING CAVEATS, stated plainly**: (1) ~~unknown license~~ RESOLVED 2026-08-01: the user
confirmed BOTH GLBs are their OWN Tripo-studio generations (explains the tripo_* node names +
the dwarf's v1.0 skeleton) — same ownership standing as the API-generated cast, commit-safe
when adopted; (2) no team-tint masks and no hat/tool/pack overlay anchors exist for the
villager (`manifest.overlays = {}`, every subject's `mask = null`, by design — out of scope
for a look test); (3) the knight would want a genuinely rigged source model (or a from-scratch
rig) to get a real leg split instead of the whole-body fallback if this ever became real.

**Verify**: `node farmstead-proto/sprite/_verify_forkb_test.cjs [--shots]` — 84/84, 0
pageerrors, incl. the production-sheets-untouched hash check. Shots:
`shots/fs_spritetest_{atlas,dwarf_crowd,knight,sidebyside}.png`.

## 🧔 THE DWARF+KNIGHT LOOK IS THE DEFAULT — sprites, skinned, minifig one flag away (2026-08-02)

The look test above is now the shipping cast, at production fidelity. `assets/farmstead/cast/
sprites-dwarfknight/` is a FULL production-shaped set (body + mask + overlays + manifest, same
schema) and `fs-render` picks a look by base path. The minifig set is byte-untouched and one
flag away. Nothing about the 3D fallback chain changed underneath.

**PRECEDENCE, written where the flags live (fs-render's `SPR` block):**

    chosen look  >  the other look  >  cast opt-in (?cast=1)  >  procedural minifig

`?look=dwarfknight|minifig`, `localStorage fs_look`, `FSRender.setLook(name)` (re-fetches +
rebuilds the layers in place, awaitable). Both URL forms WRITE localStorage, so a link sticks —
and leaks between same-origin pages in one profile, same as `?sprites`. A chosen look that
fails to arrive falls through to the OTHER LOOK before it falls through to 3D: one missing
directory degrades to "the other art", not to "no sprites".

**THE KNIGHT IS SKINNED NOW — that is the whole upgrade.** The look test split him into rigid
body/legL/legR and said honestly that it failed: plate armour has no cloth give, so the mail
hem tore off the greaves at stride. A sprite bake photographs a mesh and a mesh can DEFORM, so
`tools/_fs_dk_rig.py` gives him a real skin by **skeleton transfer** — the dwarf's own Tripo
v1.0-20240301 41-joint biped, fitted to the knight and bound with Blender's automatic weights.
**0 Tripo credits; the API rig the brief pre-authorised was never needed.**
- **The fit is measured, not guessed** (`tools/_fs_dk_measure.mjs` → `landmarks.json`): dwarf
  H 0.9049 / crotch 0.2149 / arm line 0.5618 / leg centres ±0.105 · knight H 0.9935 / crotch
  0.2277 / arm line 0.5837 / leg centres ±0.106. Horizontally they are the SAME character
  (~1%), so the transfer is a piecewise-linear HEIGHT remap through three landmarks and NO
  horizontal scaling. That is why it is trustworthy rather than hopeful.
- **Bone heat failed at first and it was a MESH problem, not a rig problem.** `parent_set` reports
  the failure as a WARNING, returns FINISHED and leaves an UNWEIGHTED mesh — which exports with
  no skin and reads downstream as "the knight just does not animate". Root cause: the Tripo
  export splits every vertex (8064 verts for 8830 tris). `remove_doubles` → 4403 verts → heat
  solves at **99.3% coverage**. ALWAYS measure weight coverage after an auto-bind; never trust
  the operator's return value.
- **Plates must not rubber-band**: `*Twist* + Root` marked non-deform before binding, weights
  limited to 2 influences, and vertices a Clavicle/Head already OWNS locked to it outright —
  without that last step, dropping the arms 72° out of T-pose stretched each pauldron into a
  drooping flap (visible in the first render pass).
- **Judge from RENDERS, never wireframes**: `_inspect/{dwarf,knight}_{rest,strideA,strideB,work}_
  {front,side}.png` are rendered at the production `LEG_SWING` before anything is baked.
- The DWARF moved to skinned posing too (his split was clean, but skinning removes the tunic-hem
  gap at full stride and gives both bodies ONE code path). Both keep their T-pose bind; the
  arms-down rest offset is applied as a BONE POSE in the bake, so the shoulder deforms instead
  of shearing.

**MEASURED LOOK DECISIONS** (`tools/_fs_dk_review.cjs` prints mean luma + blown fraction per sheet):
- The knight looked blown out to me, so I nearly dropped the emissive lift. **The numbers said
  do not**: minifig knight 185.2 mean / 32.3% blown vs dwarfknight 169.2 / 15.4% — the SHIPPED
  sheets are brighter than the new ones. Serf 149.8/3.1% vs 153.5/13.2% (the extra blown pixels
  are the white-baked team band, which takes the team colour at runtime). Changing the lift
  would have broken the `tintEmissive` contract to fix a problem that did not exist.
- **Per-body stride**: knight `strideMul` 0.62 — a rigid fauld at the full 0.52 rad reads as a
  man kicking through his own plate. Dwarf 1.0.
- **Arm counter-swing** (0.30 rad) is the ONE addition beyond the game's own pose maths, and it
  rides on `p.stride` — the game's own `sin(phase)` — so it adds no clock and no state. A sculpt
  with visible arms reads as sliding without it; the minifig had no separable arms so the
  question never came up.

**IDENTITY LAYERS.** Mask regions are geometric bands taken as fractions of each body's OWN
measured torso span (crotch → arm line), restricted to torso-dominant BONES so the T-pose arms
never get painted: serf = shoulder yoke + waist sash, knight = breastplate surcoat + fauld.
Rank trim is the knight's PLUME, found by TEXTURE COLOUR (the only strongly red thing on white
armour — a geometric "above and behind the helm" rule would also catch the helmet's back).
Regions bake WHITE with no emissive lift, exactly like production, via a per-triangle vote that
reorders the index into three geometry GROUPS (plain/team/rank) sharing one skin — the textured
single-mesh equivalent of `buildTriplet`.
- **Anchors come off the posed skeleton where the pose moves them**: `tool` follows the HAND
  bone (the arms swing, so a static hand anchor leaves the axe hanging in mid-air); hat / pack /
  pips / helmTop stay body-local points measured off the mesh. The hat rule is
  `headTop − 0.25·headRadius` — feed it the minifig's own numbers and it returns 0.766, its
  authored hat pivot exactly, which is what makes it a fit and not a fudge. Anchoring off the
  Head BONE put the cap INSIDE the dwarf's skull: on this rig that joint is the neck.
- **Overlays were REBAKED, not reused** — deliberately. The existing sheet's occlusion is cut
  against the MINIFIG's silhouette, which is wrong for a bulkier body (169 cells come out fully
  hidden here vs 119 there), and the cap needed refitting to the dwarf's head. Geometry is
  unchanged; only scale (measured: hat ×1.05, pack ×0.97) and the occluding host differ.

**ONE FRUSTUM, TWO LOOKS.** `--source dwarfknight` inherits the minifig manifest's
`cx/cy/halfSpan`, so pxPerCameraUnit (98.45 vs 98.44) and footPx (64, 94.1 vs 94.09) match and
the renderer needs no per-look arithmetic — a look really is just a base path. Fitting became an
ASSERTION: the bake THROWS if a body overflows the inherited frustum rather than silently
clipping a plume (`--refit` opts out). The driver also refuses to write a non-minifig bake over
the shipped sheets.

**TWO BUGS THE NUMBERS CAUGHT, both invisible in an atlas thumbnail:** the tool anchor came out
at HEAD height (the arm was rotating UP — a +x arm needs a NEGATIVE rotation about +Z to come
down), and the stride sign was mirrored because this rig puts `L_` on **+X**, the opposite of the
minifig convention `pushLegs` keys on. `sideOf` now reads the side off the skeleton's own world
x, never off the bone name.

**SUITES ARE MANIFEST-DRIVEN NOW, not bake-specific.** visuals §6a asks the renderer which look
is live and holds THAT manifest to the contract; the hidden-overlay-cell count is READ OFF THE
MANIFEST (169 here, 119 there) and the assertion is that the draw path skips exactly what the
bake flagged; the tint probe derives its expected fraction from the MASK SHEET's own cell
(measured 0.239, screen moved 0.264) instead of a typed band. NEW §6a-ii is a minifig smoke pass
(sheets load, cells resolve, workforce is sprites) plus a look-fallback check. The sheets-blocked
3D-fallback pass is intact — its blocker regex now matches EVERY look, without which it was
silently testing nothing.

**FULL BATTERY, all green, first pass, no flakes** (the known polish/mp flakes both passed):
world 83 · transport 131 · economy 104 · **visuals 148** (142 → +6) · visual 60 · military 124 ·
mp 126 · ui 128 · polish 68 = **972 checks, 0 page errors**.

**Files**: `tools/_fs_dk_{measure.mjs,rig.py,review.cjs,shots.cjs}` · `assets/farmstead/cast/
dwarfknight/` (src GLBs — the user's own Tripo generations, commit-safe — plus `{dwarf,knight}-
rigged.glb`, `landmarks.json`, `rig.json`, `_inspect/`) · `assets/farmstead/cast/
sprites-dwarfknight/` · `fs-cast-bake.js` gained a `dwarfknight` source through its existing
`rigFactory`/`anchorsByKind`/`bakeOverlays` hooks plus `lockFrustum`/`occluderFactory`/
`overlayScale`; the minifig path is untouched. Minifig sheets verified unmodified (mtime 15:38,
hours before this session's 19:xx work) and sha256-baselined:
`serf-body 5ea45cb6…`, `serf-mask 0bee11b9…`, `knight-body 6cc7d18a…`, `knight-mask f408d8fe…`,
`overlays 0134ec85…`, `manifest 64aa3a04…`, `README 47bb4c6d…`.
Shots: `shots/fs_adopt_{town,serf_jobs,knight_ranks,walk_closeup,knight_stride,minifig_flag,
sidebyside_looks}.png`.
**KNOWN / DEFERRED**: the 10 reviewed film strips still show the MINIFIG look (they render in
the shipping default, so `node tools/_fs_filmstrip.cjs <subject…>` should be re-run to refresh
them — the visual suite only asserts they exist and are not blank, so it stays green either
way); `helmTop` is the plume tip rather than the helm crown (a documented anchor nothing draws);
and a tinted region bakes FLAT white, so the sculpt's own creases do not survive inside the team
band — a luma-modulated dye would keep them but breaks the manifest's "tinted pixels match the
3D game EXACTLY" contract.

## 🎯 FARMSTEAD PLAYTEST BATCH #2 — five items from one session at the wheel (2026-08-01)

**1 · TEAM COLOUR IS THE BELT, AND A KNIGHT'S IS HIS PLUME** (both looks, re-baked).
The user's new colour language, applied in the BAKERS so the sheets carry it: mask R is a
serf's BELT and a knight's helmet CREST; mask G is rank trim ONLY and never the crest, so
rank stays readable independently of team (plus the rank-pip overlay, unchanged).
- **The dwarf's belt was MEASURED, not guessed.** Binning his torso texture colour against
  the same torso-span fraction the mask bands use shows a saturated leather band at
  f 0.16..0.32 (mean rgb 91,68,48 / 82,61,42, R−B ≈ 40) against a neutral grey tunic
  everywhere else (105,99,92, R−B ≈ 13). The old `[0.20, 0.40]` "waist sash" band sat ABOVE
  the belt he actually wears.
- **Both bands ship WIDER than the thing they name, and here is the arithmetic.** A serf is
  ~26 px at play zoom, so a band that is a fraction *f* of his height is 26·*f* px. The
  minifig's authored belt is 0.045 of a 0.79-unit body = 5.7% = **1.5 px** of team colour;
  the dwarf's drawn leather is 6.1% = 1.6 px. Neither reads. Shipped: minifig belt 0.045 →
  **0.095** tall (12% ≈ 3.1 px; centre 0.262 → 0.30 so the whole band sits ON the tunic
  instead of hanging off its hem) and the dwarf's band **[0.10, 0.40]** of the torso span
  (11.5% ≈ 3.0 px, centred 0.25 on his belt's 0.24). That is the read the old diagonal sash
  had — its ROLL swept ~5 px of vertical extent, which is why a flat band of the same
  nominal height looks thinner than you expect.
- The minifig's chest baldric is GONE; its surcoat, shield face and back disc lost the team
  tint and took their own colours — the surcoat had to be toned from linen 0xd6ccb6 to
  0xb9b09b, because at linen white it out-shone the armour and read as a blank card where
  the colour used to be. Its plume boxes widened 0.05 → 0.075 / 0.04 → 0.06 in x for the
  same 1.6 → 2.5 px reason.
- The knight's rank trim became a waist band, **narrowed [0.24, 0.50] → [0.30, 0.44] after
  looking at the bake**: the fauld FLARES, so a band that is 9% of his height by the numbers
  covers a good deal more surface than that, and a whole gold skirt competed with the plume
  for "which colour is this man's identity".
- The SHOULDER YOKE went with the sash. It was there for the overhead camera and a belt is
  more self-occluded from above — that is the cost of the new language, paid deliberately.
- KNOWN: a carrier's PACK covers part of the belt from behind (the shot stages builders for
  exactly that reason); and the knight's find-the-plume-by-texture-colour rule still catches
  a handful of reddish boot vertices — a couple of pixels, present before this change too,
  when they were rank-coloured instead of team-coloured.

**2 · A BUILD CARD IS GREY IF AND ONLY IF YOU CANNOT AFFORD IT.** The panel used to re-grey
every card against the CURRENTLY HOVERED VERTEX (a `whyBuilding` per card, per hover change),
so it strobed as the mouse crossed the map and a card's meaning changed under your finger
while you were reaching for it — the reported "weird highlighting mechanics".
`refreshBuildGreying` now reads the player's own inventory and nothing else, and the hover
path (`updateHoverVisuals`) no longer touches the panel at all. Affordability is LIVE because
the refresh rides the goods ticker's ≤4 Hz beat: a delivered plank un-greys a card with no
hover, click or panel re-open. Suitability did not disappear — it lives where it can actually
be shown, the placement-mode ground overlay and the ghost footprint, which say WHERE rather
than WHETHER. Arming is unchanged (red card), and a greyed card is still CLICKABLE: you may
start a site you cannot yet pay for, exactly as before.

**3 · CONSTRUCTION FELLS THE WOOD** — and the research says the original was HALF of what the
user remembered. Full write-up in `farmstead-plan.md` §14.13; the short of it, from freeserf's
reimplementation of the original binary plus the manual:
- **Roads ran straight THROUGH standing trees in the original.** `is_road_segment_valid`
  refuses a step only at `SpaceSemipassable` and worse; every tree/pine/palm/dead-tree is
  `SpaceFilled` (1), BELOW that, while every stone pile is `SpaceImpassable` (3). Nothing
  removed the tree — the road was laid under it. Farmstead was **stricter than the original**
  here, and that unintended deviation is what let a dense wood wall a player in.
- **Flags and buildings on a tree were refused** (`can_build_flag`/`can_build_building` both
  demand `SpaceOpen`; the manual says a building needs ground with "no trees or boulders",
  and a flag can fail "because there are trees in this spot"). A large building's six-vertex
  RING only needed `< SpaceSemipassable`, so trees were legal there and stayed standing.
- **Settlers II is the same**: you woodcut first, you do not road through a wood.
So roads-through-wood is a RETURN to the original; flags and buildings on a tree are a
documented deviation, taken because a family game must never present an unwinnable start, and
because in 3D a tree standing in a painted road reads as a bug where the original's 2D sprite
happily overdrew it. Cleared: the whole tree family (four growth stages, a forester's sapling,
a woodcutter's stump). NOT cleared: stone piles and standing crops — a pile is the
stonecutter's entire economy and a field belongs to a farm. **No wood is yielded**: the
original has no clearing mechanic to be faithful to, and a free plank per road step would
out-earn the woodcutter chain the whole game is built around. `FSSim.clearWood`/
`clearWoodAlong` off the command's own vertex list, no RNG, lockstep-safe; `FSMap.objRefuses`
is the legality half. The felling animation was FREE — `dirty(G,v)` already makes
`refreshVertex` lease the instanced slot and topple it (`fall:true` for any tree kind).
MEASURED on virgin worlds (road-legal vertices reachable from the castle flag / buildable hut
plots within radius 14), seeds 12345·7·42·1234: reach **311→375, 324→408, 350→378, 354→373**;
plots **129→183, 94→141, 151→164, 227→243**.
WORLD GENERATION deliberately keeps the STRICT rule in its start-quality guarantees
(`plotOK`/`reachOK`/`openCastleApproach`/`balanceStarts`): being conservative about what a
start can reach is strictly safer, and relaxing it would move every generated map. The AI's
two cheap PRE-FILTERS were relaxed to match the predicate they guard, or a forested kingdom
would quietly under-count its own room to grow.

**4 · THE STONECUTTER WALKS TO THE NEAREST ROCK** (plan §14.14) — alone among the professions.
Everyone else keeps the original's one-random-disc-sample-per-attempt plus per-profession
retry, which is what makes output degrade with resource density instead of clearing tidily
inside-out; for the stonecutter that reads as a broken worker, because a hut sited on a near
group spends most of its trips crossing the map to a far one. Deterministic and
lockstep-identical: no `FSC.rng` at all, and ties at equal lattice distance break on the
LOWEST VERTEX INDEX — `forRadius` walks ROW-MAJOR, not ring-major, so the winner has to be
chosen explicitly rather than taken as the first hit. NOTE this removes one `FSC.rng` draw per
stonecutter attempt, so the RNG stream moves and any golden sim hash shifts with it.

**5 · THE CAMERA TURNS AGAIN; THE PITCH STAYS BANDED.** Fork B's yaw LOCK is gone — `clampCam`
wraps the angle instead of assigning it, `CAM.YAW_LOCK` became `CAM.YAW_START`, and the
pre-lock bindings are restored verbatim from the frozen snapshot: Q/E, right-drag and
shift-drag orbit, and the 2-finger TWIST is back (Fork B left `s.angle` tracked in the gesture
baseline precisely so restoring it would be two lines — it was). Pitch inputs are wired but
`clampCam` holds them inside the MEASURED 49°..58° band, unchanged. "Invert vertical drag"
KEEPS its pan meaning: pitch is a clamped band now, so an inverted look axis would be a
preference over almost no travel.
- **THE SHEETS HAD TO BE RE-BAKED, and the reason is physical.** A locked camera lets a cell
  index a unit's ABSOLUTE facing and be lit by a world-fixed sun. A turning camera makes the
  index RELATIVE — `sprAz` subtracts the live camera yaw — and one cell then has to serve
  every (facing, camera) pair sharing that difference, which no world-fixed sun can do. Both
  looks re-baked with the key light declared in CAMERA space
  (`bake.lighting.mode = "camera-relative"`), and the runtime
  `YAW_LOCK == manifest.cameraYaw` assertion became a LIGHTING assertion: `loadSprites`
  REFUSES a world-fixed manifest and falls through to the other look / the 3D path rather
  than draw the whole cast lit from the wrong side.
- **HOW WRONG IS CAMERA-RELATIVE LIGHT? Measured, and the answer is: barely.** The bake
  camera stands still while the MODEL turns, so the world sun at the bake yaw already IS a
  camera-space direction — the shipped key is exactly that, which means the cast lights
  identically to the terrain at camera yaw 0 and drifts as you turn. Swept in-game with
  `gl.readPixels` (one still serf, same world, same camera, sprites vs the 3D mesh the sheets
  were baked from, 110 px crop at dist 10, mean |ΔRGB|): **0° 1.93 · 45° 2.14 · 90° 2.69 ·
  135° 3.01 · 180° 2.81 · 225° 2.44 · 270° 2.32 · 315° 2.33**. The floor is the bake's own
  (cell resolution, AA, the constant depth bias); the worst yaw adds **1.08/255 = 0.4% of
  full scale** on a crop that is mostly serf, and the rotation trio confirms it by eye at play
  zoom. **The user's authorised fallback levers — soften the global rig, or drop the
  directional sun and the blob shadows entirely — went UNUSED.** There was no mismatch to fix,
  and the terrain keeps its sun and therefore its slope readability, which matters because
  slope is gameplay (mine placement). `KEY_YAW_MIX` in `fs-cast-bake.js` is the lever if it
  ever does: 0 flattens the key to straight overhead (no contradiction at any yaw, flatter
  form), 1 is the shipped world-sun throw.
- **AZIMUTHS 12 → 16, with the measurement.** 12 was chosen because a serf rests on one of six
  60° hex headings and 12 divides 60° exactly, so a STANDING serf was never rendered at the
  wrong angle — an argument that only holds under a LOCKED camera. Free rotation makes the
  relative azimuth continuous (every angle in between happens as you turn), that static-error
  argument dissolves, and orbit smoothness is what is left. Re-measured IN GAME (72 px crop on
  a still unit, camera orbiting it in 2° steps over 120°, frame-to-frame mean |ΔRGB|):
  **16 → mean 2.55 / worst step 8.95 / pop-over-mean 3.51 · 12 → 2.47 / 9.42 / 3.82 · the 3D
  mesh → 3.08 / 3.44 / 1.12.** 16 is smoother on both statistics, and the in-game 3.51 lines
  up with the demo's controlled `measureTurnPop` figure for 16 (3.3, against 5.0 for 12).
  Sheets grew as budgeted: minifig 1.75 → **2.21 MB** (+26%), dwarfknight 2.70 → **3.37 MB**
  (+25%); 1812 → 2416 cells, 1800 → 2400 anchors.
- Frustum parity survived the round trip (the minifig set was baked at 12 and back at 16 for
  the measurement): both looks still report `pxPerCameraUnit` 97.47 and `footPx` (64, 93.63),
  so a look is still just a base path.

**SUITES.** world **83** · transport **138** (+7, the tree-clearing section) · economy **107**
(+3, the stonecutter's near-then-far ordering run twice for determinism) · visuals **151**
(+3: relative-azimuth sweep, one-camera-step-is-one-cell-step, overlays-follow-the-camera) ·
visual **60** · military **124** · mp **126** · ui **128** · polish **68**. Proto suites kept
green: `_verify_forkb` **142/142** (its hex-lattice-exactness check restaged — that rule only
existed under the lock) and `_verify_forkb_test` **84/84** (production-sheet sha256 baselines
re-cut, below).
**Suite staging the new rules legitimately invalidated, fixed rather than bent:** economy's
workshop quarter went `sep` 3 → 4 — its site picker is greedy-NEAREST, and with forest ground
now legal the nearest legal plot is much closer in, so five LARGE workshops with SOLID
7-vertex footprints at 3 lattice steps left no lane for a road and every one failed to
connect; military's cramped-AI seed was re-scanned for the THIRD time (seed 22 went 17 → 84
plots; over seeds 1..60 on medium the tightest is now seed 13 at 47 plots against a MEDIAN of
132, so the assertion became comparative instead of an absolute that no longer means
anything); world's camera checks flipped from "yaw is overruled" to "yaw is kept (wrapped)"
and from "q/e do nothing" to "q/e move it", and its pickVertex probe got its orbit back;
polish's 2-finger-twist check returned to asserting rotation (third restage, and back where it
started); visuals' "is the camera on the bake's yaw" became the lighting-mode contract; ui's
two hut-build flows staged a yaw of 0.6 that the LOCK had been quietly overruling to 0 — with
the camera really turning, the target vertex swings across a 390 px phone screen and the tap
landed on the build panel, so both now centre on the TARGET (and the flag-tap after them pans
back, which is what a player does).
**SIM_BASELINE RE-BASELINED** (visual suite, golden hashes not invariants): both deliberate
sim changes moved them — the stonecutter stopped drawing a random disc sample, so the whole
`FSC.rng` stream shifts, and construction now edits `map.obj`, so the MAP hash moves as well
as the sim hash. World GENERATION is untouched (the tick-0 map hash is unchanged and world's
determinism checks still pass); each new pair was recomputed TWICE and verified identical
before being written down. And visual's "a paused world freezes the sprite frame" was
restaged: it demanded the post-pause cell EQUAL the pre-pause one, which assumed the serf
would still count as MOVING after the clock stops — he usually does not (his `frac` never
advances, so he settles from the walk rows onto the IDLE frame, a man standing still in a
stopped world). It now samples every frame after the pause and requires the TAIL to be one
unchanging cell, which is strictly stronger about the property under test — a cell that
cycled would fail it — and indifferent to how long the settle takes.
**RE-BASELINED sha256** for `assets/farmstead/cast/sprites/` — a deliberate rebake, not drift:
`serf-body 105ce4b6…`, `serf-mask f0c46f26…`, `knight-body 592c48ec…`, `knight-mask
7bb93b79…`, `overlays c8b9f2de…`, `manifest d7b003cd…`, `README e84ea851…`.
**Shots**: `shots/fs_b2_{belt_teams,plume_ranks,buildmenu,road_thru_forest_before,
road_thru_forest,stonecutter,rotation_a,rotation_b,rotation_c}.png`, regenerable with
`node tools/_fs_b2_shots.cjs` — 6/6, and it ASSERTS what each shot is supposed to show
(both team colours present, knights of every rank, affordable and unaffordable cards in one
frame, every tree on the road's path gone, the cutter on the near group).

## 🌾 FARMSTEAD PLAYTEST BATCH #3 — twelve items from one session at the wheel (2026-08-02)

Every number below is MEASURED, before and after, with the "before" reproduced by running the
same metric through pristine copies of the files (scratchpad `mapstat3.cjs`, 8 seeds × 3 sizes
× 4 starts; `fs_b3_perf*.cjs` for the frame board).

**A1-A3 · WORLD GENERATION.** Three changes, one pass of the generator.
- **MAPS ARE TWICE THE AREA** — `MAP_SIZES` 48/64/96 → **68/90/136** (side × ~√2, snapped even
  so the odd-row lattice keeps equal numbers of shifted and unshifted rows; area ratios 2.01 /
  1.98 / 2.01). Everything sized in ROAD STEPS is deliberately untouched — a serf does not walk
  faster on a bigger map — and everything expressed as a fraction of the map moves by itself.
  Castle separation went 12.9/21.8/33.3 steps → **23.4/32.1/51.6** (26.8/34.0/34.6% of the
  width → **34.4/35.7/38.0%**), buildable plots within r14 worst 20/53/68 → **66/92/65**, mean
  113/162/253 → **200/255/303**.
- **LESS WATER, MORE LAND AND MOUNTAIN** (`SEA_BOWL` 0.38 → 0.20, `WATER_N` 0.21 → 0.145,
  `RAD_0` 0.94 → 1.00, `MOUNT_N` 0.745 → 0.715, `SNOW_Y` 5.6 → 6.0). Water 46.3/41.5/37.0% →
  **33.2/29.5/25.6**, grass 30.8/33.9/37.3 → **37.8/40.0/42.7**, mountain 12.8/13.4/13.6 →
  **17.4/17.8/18.3**, snow 2.4/3.0/3.5 → **2.7/3.1/3.4** (SNOW_Y rose on purpose — dropping
  MOUNT_N alone would have grown the snow cap, and snow is neither walkable nor buildable).
  Seaborne mechanics keep an ocean: the biggest single water body is still **29.0/23.6/20.1%**
  of the board and all four starts land on ONE landmass on **8/8 seeds at every size**.
  Mine-placeable mountain stays 93.7-97.5%.
- **EVERY START IS GUARANTEED THE ORE ITS ECONOMY NEEDS** (`FSMap.guaranteeStartOre`, run inside
  `balanceStarts` before the budgets are read). balanceStarts equalises how MUCH ore a kingdom
  opens with; the economy does not care how much, it cares WHICH — coal and iron together are
  the whole steel chain, steel is the only source of tools, and a tool is the only way a settler
  becomes anything, so a start with a fat gold seam and no coal is finished before it begins and
  nothing on screen says why. Coal + iron are REQUIRED, gold is WANTED (morale, and rare by
  design at MINERAL_W 2), stone is deliberately NOT guaranteed — the stonecutter works surface
  piles and those are already balanced. **"Close" is now ONE number**: `MOUNTAIN_MAX` 25 → **18**
  road steps, shared by the site scorer's soft bar and the guarantee. Measured: starts with coal
  or iron ABSENT 1/0/0 per 32 → **0/0/0**; gold absent 8/0/0 → **0/0/0**; starts without BOTH
  coal and iron inside 18 road steps 9/5/4 per 32 → **1/0/2**; worst road distance to iron
  29/26/51 → **20/18/21**, to gold 40/37/60 → **20/28/24**.
  - **The cheap fix is preferred and is what normally happens: RE-KIND a seam that is already
    near home.** That costs the start's ore budget exactly nothing, so it cannot re-break the
    fairness band the balancer just set; fresh ore is only invented for a start with no near seam
    at all. Guaranteed vertices are collected in a `guarded` set and the balancer's ore TRIM
    skips them.
  - **The ladder is by DISTANCE, not by strategy** — both moves (re-kind, then seed) are tried
    inside the near ring before either may look further out. Ordered the other way round it
    measurably pushed iron to 28 road steps on boards with bare rock 10 steps from the gate:
    every near seam was spoken for, so the re-kind pass walked across the map before the seed
    pass ever ran.
- Fairness improved as a side effect of the bigger boards: spread (max−min)/mean wood
  0.71/0.21/0.20 → **0.24/0.17/0.20**, stone 0.75/0.31/0.17 → **0.17/0.15/0.16**, ore
  0.67/0.65/0.59 → **0.32/0.39/0.41**.
- **DETERMINISM RE-PROVEN**: same seed twice = same map hash at every size (3 sizes × 3 seeds),
  different seed always differs, and the world suite's own determinism section is green.
- **PERF AT THE NEW LARGE** (SwiftShader, 1280×800, warmed past the ~100-170 ms shader compile,
  60-frame medians, `readPixels` after every frame so GPU work cannot hide): worldgen+build
  **336 ms** (terrain mesh 32.5 ms), 9000 sim ticks **285 ms**, frame at play zoom **91.6 ms**
  and at max zoom **99.5 ms**, **50 draw calls / 376k triangles**, worst-case offroad path
  (157 steps) **10.0 ms**. Old large (96) on the same board: 653/243 ms, 56.7/64.0 ms frame, 63
  calls / 197k tris, 6.8 ms path. **Where the triangles are matters more than the count**: the
  terrain mesh itself only went 18,050 → 36,450; the other ~340k is TREE instances, and every
  object pool sets `frustumCulled = false`, so the whole map's foliage is submitted every frame
  whatever the camera can see. **HEADROOM**: 376k triangles at 50 draw calls is an ordinary
  frame for any real GPU (this repo's own sprite-cast entry measured 272k tris at 0.8-1.7 ms),
  and SwiftShader is a CPU rasteriser — 1-2 orders pessimistic. **2× side / 4× area (W=192) was
  measured too**: 784k tris, 180 ms SwiftShader, still 47 draw calls, worldgen 1.25 s. It would
  be comfortable on a GPU, but it is the point at which the un-culled instance pools should be
  fixed first (per-pool bounding spheres, or spatial chunking) rather than the point at which
  triangles become the problem. `CAM.DIST_MAX` was deliberately NOT raised — the minimap is the
  overview tool, and zooming further out at a 52° pitch mostly buys fog.
- MP: size travels in the host's `settings` block exactly as before; the mp suite is 126/126.

**B1 · THE STANDING BANNER IS GONE, and it was keyboard auto-repeat.** "aim at an enemy hut,
tower or castle" existed once, as an error toast in `doAttackAtHover`. Holding **A** made the OS
repeat the keydown ~30×/s, each press pushed a fresh copy with a 4.5 s life, and the strip
renders the last two — so two identical panels sat at the top of the screen for as long as the
key was down and 4.5 s after. Three fixes, all general rather than special-cased:
`if (e.repeat) return;` at the top of farmstead.html's keydown handler (every action key is a
ONE-SHOT — placing a flag, swinging an attack, stepping the clock — and holding a key is never a
way to mean "do this thirty times"); `toast()` now DEDUPES, resetting an identical message's
timer instead of stacking it; and toasts take an optional `ttl`, with the attack nudges dropped
to `TOAST_BLIP` 1.6 s and re-worded as info, not error. Measured: 25 misses in a row = exactly
ONE toast, gone inside 2 s; 12 keydowns with `repeat:true` on 11 of them = the action fires once.

**B2 · THE "CONNECT TO YOUR ROAD NETWORK?" CHIP IS GONE**, offer and all (`connectOffer`,
`offerAutoConnect`, `nearestNetworkFlag`, `acceptConnect`, `dismissConnect`, `renderConnectChip`,
the markup and its CSS). It was QoL#1, written before the road tool armed itself; once placing a
building hands you that tool with its own door flag already picked, a floating panel asking
whether you would like a road is a second answer to a question the game has already answered,
sitting over the map while you are trying to click the far end.

**B3 · EVERY BUILDING SAYS WHAT IT DOES.** `FSC.BLD_DESC` — one plain sentence per building,
under a dozen words, about PURPOSE not numbers (the numbers are on the card). REQUIREMENTS are
DERIVED from the definition (`FSUI.buildReqs`: mountain, plot size, inputs, miner food, the
profession's tool, warehouse) so they cannot drift from the rules the game enforces. Shown as a
detail strip under the grid, because this is played on an iPad and a finger has no hover state —
the information attaches to SELECTING a card; on a desktop, pointing at one previews it in the
same strip and leaving puts the armed card's text back. No hover-reactive CARD styling was
reintroduced: pointing changes nothing about the card, the greying or the armed state.
- **THE STRIP'S HEIGHT IS FIXED, and that is load-bearing.** The panel is anchored to the BOTTOM
  of the screen, so anything that changes its height moves every build card upward — and because
  pointing at a card fills the strip, an elastic strip slid the whole grid out from under the
  cursor between the pointerover and the click. It cost the UI suite three failures before the
  cause was clear. Floating it out of flow above the panel fixed the shift but put a card over
  the middle of a phone screen, which is exactly where the next tap goes. Fixed height, in flow:
  132 px desktop / 112 px mobile, both MEASURED (scratchpad `fs_b3_infofit.cjs` walks every
  building at both viewports; tallest content 130 / 110) and both asserted in the suite.
- Requirements are ONE dot-separated wrapping line, not a row of pills: pills measured **189 px**
  tall on a farm, every chip claiming its own row.
- **The phone panel pays for the strip out of its TAB ROW**: five wrapping 40 px chips cost
  128 px, and icon-only chips (label kept as `title`/`aria-label`) fit ONE row. Panel top on a
  390×844 screen: 465 → 437 px, still clear of mid-screen, with the grid unchanged at 2 rows.
  Asserted in the suite both ways.

**B4 · THE RATE STRIP.** The ticker says how much you HAVE; a hundred planks falling by six a
minute is a crisis and a hundred planks rising by six is a spare afternoon, and those look
identical on a stock counter. A second compact row under the ticker, six goods chosen off the
real chain: **plank · stone · food (fish+bread+meat as ONE number) · coal · ironOre · goldBar**
(the ore, not the bar, for iron — what stalls a steel chain is almost always the ore; the bar,
not the ore, for gold — goldOre is a step nobody watches). Net figure by default, green up / red
down / grey flat; TAP to split it into what was made and what was used.
- **PER IN-GAME MINUTE off a TICK-based window**, so 4× speed reads exactly the same as 1× —
  it is a fact about the settlement, not about how fast you are watching it. Window 1500 ticks
  (2.5 game-minutes), with a 300-tick floor before a number is shown at all.
- **SIM SIDE**: `G.cons`, the mirror of `G.prod` — `{res: total ever consumed}`, written by ONE
  function (`FSSim.consumeGood`) at every point a good genuinely leaves the economy: a workshop
  eating its inputs, a miner eating a meal, a construction site swallowing a plank or a stone, a
  settler taking up a tool, a knight being armed. Monotonic integers that nothing in the sim ever
  reads back, so lockstep is untouched; `FSSim.consumption(G, p)` is the accessor and a save from
  before it existed simply starts counting on load.
- **What sits under the top bar is positioned from the bar's MEASURED height** (`--fs-topbar-h`,
  set on the ≤4 Hz ticker beat) rather than from a constant tuned for one layout — the ticker
  already wraps on a phone and the rate strip can wrap again when tapped open. Same technique as
  index.html's sticky calendar header. Verified at 390 px: 0 clipped chips, no overlap with the
  bell/menu cluster or the speed control, top bar 74 px.

**C1 · THE FISH LANDS WITHOUT A BLACK CIRCLE — and the ring was fading the wrong way.**
`advanceRings` fades a splash by multiplying its vertex colour toward BLACK, which on an
ordinary blended material is not a fade at all: it is a ramp to a dark ring painted over bright
water. The landing ring was the widest particle in the game (0.5 → 1.9 world units over 0.62 s),
so the last two-thirds of its life was the reported black circle. The LANDING ring is removed
outright (white spray is the splash now) and `ringMat` became ADDITIVE, which makes that same
colour ramp mean what it was always written to mean — toward black = toward invisible — so the
take-off ripple and the warehouse delivery glimmer cannot go dark either.

**C2 · THE WORLD RUNS ON GAME TIME.** Tree sway, grass tufts, the water sheet, the caustic
shimmer, the shoreline surf and the whole of FSFX's ambient life (fish, birds, leaves, dust) now
advance with the SIM: 4× speed is 4× the sway and 4× the waves, and a PAUSED world is a still
photograph. `tAccum` (wall time) survives for exactly one thing — the selection ring's pulse,
because a UI affordance has to keep breathing while the game is paused or it reads as broken.
- `ambT` is read off the sim, `(G.tick + tickU) · TICK_S`, not accumulated, so it cannot drift
  from the clock it follows. It is **MONOTONIC and only moves while the clock runs**: with speed
  0 no new tick arrives, `tickAge` keeps growing and `tickU` walks up to its clamp (the world
  would creep on after you paused), while dropping the sub-tick term at the moment of pausing
  steps the phase BACKWARDS by up to a tenth of a game-second, which a sine-driven sway shows as
  a twitch. Accumulating only the FORWARD difference gives both properties.
- FSFX is handed `dt × speed`, and its `dt = Math.min(0.1, dt || 0.016)` was turning a genuine
  ZERO into a sixtieth of a second — a paused world kept boiling with jumping fish.
- Kill switches and film-strip exemptions are untouched: `setTreeSway(false)` still stops the
  wind dead and the strip rig still disables it.

**C3 · THE WATER SPARKLE IS GONE.** 240 winking sun glints really are the one thing on a calm
bay that pulls the eye off the settlement. The layer, its build and its animation are removed;
`sparkGeo`/`sparkMat`/`glintTex` and the `VIS.SPARK_*` tunables stay in the files (nothing else
uses them, and re-adding the layer is one block). The water still moves — base sheet, caustic
shimmer and surf, all on game time.

**D1 · THE GOODS ARE THEIR OWN LITTLE SCULPTS, BAKED.** All 26 used to draw as the SAME 0.30-unit
crate tinted per resource: at a flag you could not tell a loaf from a pig, and a settler crossing
the map told you nothing about what he was carrying. Each good now has its own model
(`FSModels.goodGeo`, 26 procedural chunky-toon builders in the house language — primitives,
per-part vertex colours, merged; authored for a SILHOUETTE at ~24 px, every one standing on y=0
inside a ~0.5-unit box so one frustum fits them all). **Zero generated-asset spend: every one is
code.** They bake through `tools/_fs_bake_goods.cjs` + `farmstead-proto/sprite/fs-goods-bake.js`
into `assets/farmstead/goods/` — **goods.png 512×1664, 122 KB**, 26 rows × 8 azimuths of 64 px
cells, plus a manifest and a generated README.
- Same rules as the cast sheets, so a good sits with the people: 52° pitch, CAMERA-RELATIVE key
  light (the camera turns, so one cell serves every (object yaw, camera yaw) pair sharing that
  difference — `loadGoodSprites` REFUSES a world-fixed manifest), `flipY = false`, view-aligned
  quad, one world-distance depth bias, dPR-1 bake, `readRenderTargetPixels` to drain.
  **8 azimuths, not 16** — a good is near-rotationally-simple and 24 px on screen.
- The renderer reuses the cast's layer machinery verbatim with the mask and both tints switched
  off (a good's colour is baked into its own art). **ONE draw call carries every good at every
  flag and in every settler's hands.** Fail-soft as everything else here: a missing sheet leaves
  `GSPR.ready` false and the crate pool draws exactly what it drew before. `?goods=0`,
  `localStorage fs_goods="0"`, `FSRender.setGoodSprites(false)`.
- **THE FIRST BAKE REPORTED EVERY GOOD FILLING EXACTLY 0.91 OF ITS CELL**, which is what a bug
  looks like when it is being polite: the per-good bounds walk did not check `o.visible`, and all
  26 hang off one pivot shown one at a time, so it measured the union every time. With that
  fixed the fill numbers are the review tool, and they drove a second pass on the weak models —
  goldOre became a GOLD-dominant nugget with a grey crust (grey-with-flecks read as a stone at
  24 px), flour got a real pinched-neck sack, bread got three scored slashes so it stops reading
  as a bun, stone became a squared masonry block to separate it from the ore lumps, and boat got
  a raised prow. Fill spread 0.38-0.91 → **0.51-0.91**. Judged from `shots/fs_b3_goods_atlas.png`
  (a labelled contact print, `--contact`) and from a flag piled with six goods at play zoom.
- Per-good source: **all 26 procedural**, in `fs-models.js` — plank, stone, lumber, boat, sword,
  shield, goldBar, goldOre, steel, ironOre, coal, fish, bread, meat, pig, wheat, flour, shovel,
  hammer, rod, cleaver, scythe, axe, saw, pick, pincer. No CC0 downloads and no Tripo credits
  were needed; at ~8 px on screen a generated model is wasted money, which is the call the brief
  asked for.

**D2 · A SETTLER STANDING STILL IS NOT A STATUE.** The idle pose was ONE frame, so a busy
junction was a shop window of mannequins. The sheets now carry **three slow idle loops of three
frames** (weight shift · look around · small stretch), expressed entirely in the pose scalars
both rigs already honour (bob/rx/twist/rz/stride/brace), so the skinned dwarf gets them from bone
rotations and the rigid minifig from its hip groups **with no rig change on either side**. Frame
0 of variant 0 is the original neutral stance at the same address, so the carry-height anchor and
anything that wants "a serf standing still" is unaffected.
- Deliberately bolder than realistic: a serf is ~26 px at the default zoom, so a 1° lean is a
  third of a pixel. These are 3-5°, which moves a head about a pixel at play zoom.
- **Which loop a serf stands in is decided by his own id through the RENDER layer's hash — never
  `FSC.rng`, which belongs to the sim and would desync a co-op game the moment a renderer touched
  it** (asserted: 300 resolver calls, 0 rng draws). The phase is offset by the same hash so
  twenty settlers at one flag are never in step, and the loop runs on `ambT`, so a paused world
  is a still photograph and 4× fidgets four times as fast.
- `FSRender.spriteResolve` learned the rule too (pass `id`), or the contract check would disagree
  with the draw path for any serf who happened to be standing.
- **SHEETS RE-BAKED, both looks** (`node tools/_fs_bake_sprites.cjs` then `--source dwarfknight
  --out …`): idle rows 1 → 9, cells 1812 → **2672**, anchors 1800 → **2912**. minifig 2.40 →
  **2.83 MB** (+18%, all of it `serf-body` 733 → 1126 KB and `serf-mask` 65 → 99 KB); dwarfknight
  3.56 → **4.23 MB** (+19%, `serf-body` 1216 → 1849 KB). Knight and overlay sheets are unchanged
  byte-for-byte — the knight has no idle block.

**SUITES** — all nine green, **997 checks, 0 page errors**: world **84** (+1: the separation
check split into an absolute-steps bar and a floor bar) · transport **138** · economy **107** ·
visuals **155** (+4: water freezes when paused, the glints are gone, the sway is on game time
and freezes) · visual **60** · military **124** · ui **135** (+7: the info strip's copy, its
no-clip contract at both viewports, "filling the strip never moves a build card", and the connect
chip's removal) · polish **68** · mp **126**. Plus `node tools/_fs_b3_shots.cjs` **27/27** (it
asserts what each of the eleven shots is supposed to show) and four scratchpad probes
(`fs_b3_smoke` 12 · `fs_b3_ui` 26 · `fs_b3_goods` 15 · `fs_b3_idle` 23).
**SIM_BASELINE RE-BASELINED** (visual suite, golden hashes not invariants): world GENERATION
itself changed, the guarantee pass makes its own rng draws so the whole stream shifts, and
`G.cons` is new serialized state. Recomputed TWICE in two fresh pages and verified identical
(scratchpad `rebase3.cjs`, "REPRODUCIBLE: true").
**Suite staging the new rules legitimately invalidated, fixed rather than bent:**
- world: medium 64 → 90 and large 96 → 136; the "road into water is rejected" probe LENDS
  ownership to a shore pair instead of hunting for water inside a radius-12 castle claim (the
  board is 30% water now, not 41%); the separation bar became "≥18 steps on the worst seed" plus
  "never below the generator's own 22% floor" — the worst board is 20 steps where it used to be
  15, and the fraction and the walk stopped being the same statistic when the map doubled.
- transport: the busy-frame scan went 1200 → 4000 ticks and reports which of its three conditions
  never arrived. The town is spread over twice the ground, so a fresh site's digger and builder
  have a correspondingly longer walk — `building` never reached 1 inside two game-minutes while
  `walking` (13) and `goods` (29) cleared their bars immediately.
- economy: the stonecutter's near/far check now DRAINS the event stream by watermark instead of
  polling `G.events` once per estimated round trip. The cutter really did work the near pair
  first — the full event list read [5650, 5651, 5651, 5287, 5287, 5288, 5288] — and the poll, out
  of phase with a trip whose length changed with the ground, skipped straight past it and
  reported "far first". Its staging also requires the pile sites to be OFFROAD-REACHABLE, because
  `walkable` is a terrain-class test and the new world has more mountain in it.
- visuals: the sparkle layer left the scene-name list and became an absence assertion; the water
  and wind checks run the SIM alongside the frames (ambient animation is on game time now, so a
  check that only calls `frame()` with the clock stopped asserts the opposite of what it means
  to) and gained a paused-freeze and a 4×-is-four-times case; the fish arc runs the sim too, and
  "it lands with a splash ring" became "it breaks the surface with a ripple and lands in white
  spray, with no dark ring behind it"; "no extra draw calls" is measured with the shader ON then
  OFF at ONE world state, not across a stretch of ticks that grows the settlement.
- visual: the doorway fade is measured over the whole settlement rather than by latching onto the
  first serf caught mid-fade — he can finish and step back OUT inside the window (appear
  0.64 → 0.45 → 1, read as "never disappeared"), and a carrier walking into a WAREHOUSE is
  absorbed outright, so there is no end of fade to read on him; its warm-up went 2200 → 7000
  ticks so something is GARRISONED. The audio one-for-one window went 1200 → 5000 ticks after its
  own guard ("did the window contain anything?") correctly caught it passing vacuously.
- military: the cramped-start seed re-scanned a FOURTH time (13 opened from 47 to 154 plots;
  seeds 1..60 now give seed **11** at 84 against a median of 196, and the bar stays a ratio), and
  the AI-war seed a THIRD time (101's two AIs are out of reach on a 90-wide board; seeds 1..40
  give seed **16** at 20 steps).
- ui: the connect-chip section became a removal assertion; the road-via-UI staging takes the
  SHORTEST road and LOOKS at the flag it starts from first (the section before it left the camera
  framed nine steps away, and a projected click near the viewport edge resolves to a neighbouring
  vertex).
**Film strips regenerated** — 28 subjects, gait CV 0.0945-0.1066, jump 1.02×, yaw 0, 0 page
errors — so they show the shipping default including the goods sprites and the new idles.
**Re-baked sheet sha256 (prefixes)**: `sprites/` serf-body `b5b9e63e`, serf-mask `744cf6ed`,
manifest `3e1a75ab` (knight-body `592c48ec`, knight-mask `7bb93b79`, overlays `c8b9f2de`
UNCHANGED); `sprites-dwarfknight/` serf-body `66031d01`, serf-mask `4cab5c2c`, manifest
`2310ff11`, knight-body `39a0b2ce`, knight-mask `281ce149`, overlays `fc8f6b40`;
`goods/` goods.png `cdc942b8`, manifest `bca0f327`.
**Shots**: `shots/fs_b3_{startore,waterratio,bigmap,tooltips,ratehud_desktop,ratehud_mobile,
goods_pile,goods_carried,idle_variants,fishjump,no_banner}.png` + `fs_b3_goods_atlas.png`,
regenerable with `node tools/_fs_b3_shots.cjs` (27/27) and
`node tools/_fs_bake_goods.cjs --contact`.
**KNOWN / DEFERRED**: 3 starts in 96 still have their coal or iron between 18 and 28 road steps
— those are boards whose near hills hold no minable rock at all, where the guarantee correctly
falls to its next ring rather than inventing a mountain; the object pools are still
`frustumCulled = false`, which is where the frame time on a big map actually goes; and
`CAM.DIST_MAX` was left alone on the bigger boards.

---

## 🏰 FARMSTEAD — THE MEDIEVAL SKIN (2026-08-02, UI agent; render agent worked in parallel)

User: *"we need a truly medieval, charming UI (right now its very boxy and modern looking), use
the settlers dos game and future settlers game for UI inspiration."* A pure RE-SKIN: **not one
interaction changed.** Every behaviour the 08-01/08-02 playtest batches fixed is byte-for-byte
intact — cards grey IFF unaffordable, the fixed-height detail strip on selection, the
per-in-game-minute rate strip with tap-to-split, the mode-driven suitability overlay, placement
auto-arming the road tool, toast dedupe+ttl, no standing banners. Files: `farmstead.html` (the
whole `<style>` block plus two markup lines) and a NEW `assets/farmstead/fs-skin.js`.
`fs-ui.js` was **not touched** — every class the re-skin needed was already in its markup.

**FOUR MATERIALS, AND EACH ONE MEANS SOMETHING.** The Settlers lineage's real lesson is not
"put wood on it": it is that a surface's material tells you what it does before you read a word.
- **OAK** = structure — frames, rails, panel bodies (build panel, dock, speed rail, minimap
  mount, dropdowns, the sheet's board).
- **PARCHMENT** = anything you READ — the stock tablets, the rate strip, build cards, the detail
  strip, the context ledger, sheet bodies, toasts, the steward's menu.
- **STONE** = anything you PRESS — every button face, chamfered light-above/dark-below, and it
  travels 2 px into its seat when held.
- **IRON STUDS + HEMP ROPE** = joinery — studs pin panels at the corners; a rope border-image
  frames the three surfaces that stop the game (title panel, sheet, modal) so they read as
  something *posted*.
Colour keeps the meanings the game already had: **gold** a value, **seal red** an action or a
refusal (armed card, START, ATTACK, the pause button), **moss** growth, **amber** a warning.

**ZERO ASSET FILES, ZERO NETWORK.** `fs-skin.js` paints six seamless tiles + a stud + a rope
frame onto canvases and hands them to CSS as data-URL custom properties on `:root` (~546 KB of
data-URL in memory, generated ONCE, nothing per frame). Rasterised at `devicePixelRatio` capped
at 2, sized in CSS px, so an iPad gets grain rather than a blurred upscale. Deterministic LCG per
material — the knots in the oak are in the same place on every device. Seamless by construction:
grain lines are `sin()` over a whole number of periods across the tile, and anything that crosses
an edge is drawn nine times at ±W/±H.
- **It is a BLOCKING `<head>` script on purpose.** The title screen is in the initial HTML; a
  generator at the foot of `<body>` paints flat and swaps a frame later.
- **FAIL-SOFT, and PROVEN, not asserted in prose**: the suite loads the page with `fs-skin.js`
  ABORTED outright and plays on — panels fall back to solid oak/parchment/stone (all the bevels
  are `box-shadow`, so they survive), 0 page errors. `shots/farmstead_ui_no_skin.png`.

**TYPE: NO WEBFONT, and none is wanted.** A system serif (`Georgia, Palatino Linotype, Book
Antiqua…`) in uppercase with real letterspacing carries the medieval note on headings, buttons
and tool names; **figures stay monospace** so a changing number can never shift its neighbour;
**dense body copy stays in the system sans** — a serif at 10.5 px in a 248 px phone panel costs
more legibility than it buys charm. That choice also protects the detail strip's measured height
budget. Nothing is vendored, so there is no licence to land.

**SIX BUGS THE RE-SKIN FOUND — five of them older than the re-skin.** Each is now measured by
the suite rather than trusted:
1. **Multi-layer `background-repeat` leaks.** The oak recipe declares FIVE background layers
   (four studs + planks); a later rule setting ONE `background-image` inherits the FIRST repeat
   value, `no-repeat`. The context panel spent a screenshot as a single 128 px square of
   parchment in its corner. Fixed by giving parchment-in-oak panels their own complete recipe.
   → suite asserts every skinned surface TILES (the material is always the last layer).
2. **`repeat(3,1fr)` is `minmax(AUTO,1fr)`** — the auto floor is the longest unbreakable word, so
   "Boatwright" pushed its track past a third of the panel and the grid (a scroller, therefore
   `overflow-x:auto`) cut the far column: "Boatwrigl", no scrollbar, nothing to say it had been
   trimmed. `minmax(0,1fr)` + 9.5 px names + 2 px card padding on mobile. **PRE-EXISTING.**
   → suite measures the grid's own blowout.
3. **The detail strip is `overflow:hidden` in BOTH axes and only the vertical one was measured.**
   The head row (serif name beside the cost) overflowed on a phone and ate the price — "…1 sto".
   The price is the reason the line exists. Head now wraps; strip 132→140 desktop / 112→126
   mobile, both re-measured by the suite walking every building. → new horizontal-clip check.
4. **`.fs-ghost` / `.fs-primary` / `.fs-danger` are used STANDALONE** in the dialog markup (a
   modal button never carries `.fs-btn`), so they had no base geometry — a white OS button sat in
   the middle of the game-over screen. **PRE-EXISTING.** All three joined the stone recipe.
5. **`#title` was `justify-content:center` on an overflowing flex column** — which overflows at
   BOTH ends and makes the top unreachable even with `overflow-y:auto`. The logo had been losing
   its crown for as long as the screen has existed. **PRE-EXISTING.** `flex-start` + auto margins
   on the first/last child: centred when there is room, honestly scrollable when there is not.
6. **The rate strip's figures sat at 3.7–4.4:1** on a darkened parchment. They are NUMBERS. They
   keep the full parchment and earn their lower rank from being smaller, tighter and sunken.
   → suite computes WCAG ratios in-page for seven text/surface pairs and gates at 4.5:1.

**THE TWO STATES THE RE-SKIN WAS NOT ALLOWED TO BLUR.**
- **Unaffordable = CHALKED PARCHMENT** — faded texture + grey ink + 0.72 opacity, done WITHOUT a
  CSS filter (twenty live tiles do not need to pay for one). Far more legible than the old flat
  `opacity:.38`, still obviously "you have not got this", still clickable.
- **ARMED WINS THE SURFACE.** Source order alone put `.bad` after `.armed`, quietly turning a
  picked-up card you cannot afford back into chalk. "In my hand" and "too dear" are two different
  facts and the card carries both: the seal stays, the fade is what says the second thing.

**PHONE METRICS ARE FITTED, NOT CHOSEN.** The tool rack's oak board costs width and a 390 px
screen has none spare — six 40 px tools already span 240 px — so on mobile the rail is a 2 px lip
and a 2 px chamfer (desktop 5 and 3) and the minimap mount gives back 2 px. The first cut
overlapped the minimap by exactly 9 px and the suite caught it. Also NEW: `.fs-tab{min-width:40px}`
— two of the five icon-only tab chips were coming out 33 px wide on their emoji alone; five 40 px
chips plus four 4 px gaps is 216 px inside a 222 px panel, so the documented one-row fit holds.

**COVERAGE**: title (logo/ribbon/rope panel/size+rivals+skill pickers/supplies stepper/START/
co-op host+join/continue/hint/back) · top bar + ticker + rate strip + alert chip + bell + menu
button · speed rail · dock · build panel (tabs, linen well, cards, detail strip) · context ledger
· attack + demolish modals · game over · side menu · sheets (distribution steppers, priorities,
tools, knights, stats, save/load, settings, help) · toasts · minimap frame · touch long-press menu
· co-op chrome (chip, invite, ping, veil, host-left) · dev telemetry + legacy hint bar.

**SUITES** — `_verify-farmstead-ui.cjs` **149/149** (was 135; +14, all new: the six skin checks,
the two card-state checks, the four fail-soft checks, and two clip checks) and
`_verify-farmstead-polish.cjs` **68/68**, 0 page errors. Behaviour checks were NOT touched.
Restages, all because the rule they encoded was incomplete rather than wrong: the info-strip clip
check gained a horizontal axis at both viewports; the mobile section gained the grid-blowout
check; `#fsMinimapToggle` is excluded from the ≥39 px sweep (documented exception — it is the
collapse nub on the minimap's top edge). Polish has one KNOWN FLAKE under parallel load, "an
attack horn ducks the music gain down" (audio timing, unrelated; green on re-run and on a clean
run). The full battery was left to the main session per the parallel-agent split.
**SHOTS**: `shots/fs_ui_{title_before,title_after,build_before,build_after,hud_after,sheet_after,
toasts_after,mobile_390,desktop,materials}.png` + `farmstead_ui_no_skin.png`, regenerable with
`node tools/_fs_ui_shots.cjs [--before]` (20/20) — every shot ASSERTS the thing its filename
claims before it is written. `fs_ui_materials.png` is the review tool for the skin itself: a
muddy tile, a lost seam or a tile that stopped repeating is obvious there and invisible behind
text.
**KNOWN / DEFERRED**: the detail strip's fixed height leaves visible empty parchment on short
descriptions — that is the price of the anti-reflow contract and is deliberate; the rope frame is
on three surfaces only (title, sheet, modal) because it costs 14 px of border on every edge; and
`fs-skin.js` regenerates on every load rather than caching to `localStorage` (a few ms, and a
cache would need invalidating on any edit to the generator).

## 🌿 FARMSTEAD CHARM PASS — culling, fluffy trees, sprite grass (2026-08-02)

User brief, verbatim in spirit: *"the world feels very polygonal, I want you to make the ground
and trees feel almost fluffy, charming little sprite grass or something like that, basically hide
the flat surfaces with low cost grass and the trees should be fluffy and swaying in the wind…
we just need the game to now have that medieval charm."* Render layer only — `fs-render.js`,
`fs-models.js` and render tunables in `fs-const.js`. Zero `FSC.rng` draws, zero sim changes;
every placement and variation comes from the existing seeded `hash01`/`jr` hashes.

**1 · CHUNKED FRUSTUM CULLING — the thing everything else is paid for out of.**
Playtest batch #3 measured the bill: 376k triangles at play zoom on the doubled Large board,
~340k of it tree instances the camera could not see, because every pool carried
`frustumCulled = false`. Instances are bucketed on a world grid (`CULL_CELL` 16u → 304 buckets on
Large) and only the buckets whose padded AABB meets the frustum are packed into the draw buffer.
- **COMPACTION, NOT A MESH PER BUCKET, and that was a decision not a shortcut.** The obvious shape
  — an InstancedMesh per (kind, bucket) with three.js culling it — was costed and rejected: ~250
  buckets × ~10 kinds in a developed patch would take a zoomed-out frame from 50 draw calls to
  several hundred, and the bar was that the all-visible case must not regress. So the pools stay
  exactly as they were, one mesh and one draw call per kind, and the INSTANCE BUFFER is repacked.
  Draw calls at play zoom: 51 → 51. Zoomed out: 52 → 49 (a pool with nothing visible stops
  drawing entirely).
- Authoritative per-slot matrices/colours live in CPU-side `src`/`srcCol`; `mesh.instanceMatrix`
  is a DRAW BUFFER the packer owns and **slot index != draw index**. Every writer goes through
  `cpSetMatrix`/`cpSetColor`/`cpAssign`/`cpRelease` — nothing else may touch it. Repack runs only
  when the visible set CHANGES or a pool's contents do (fell/pop/fade/road/field), so a still
  camera over a still world costs nothing; `cullTest` refreshes `camera.matrixWorldInverse`
  itself, because the renderer only does that DURING `render()` and a one-frame-stale frustum
  pops a strip of trees in at the leading edge of every pan.
- Bucket Y ranges only ever GROW (a departing instance never shrinks one): a too-tall bucket
  submits a few extra instances, a too-short one culls something on screen, and removal stays O(1).
- Hooks: `FSRender.setCulling(on)` · `cullInfo()` · `cullVisibleAt(x,z)`. Decor rides the same
  buckets, so grass is culled by the same code.

**2 · FLUFFY TREES — the canopy is painted, the geometry is small.**
A cluster of icosahedron lobes can only ever be faceted: its outline IS twenty flat triangles.
Canopies are now 2-6 FOLIAGE CARDS (a quad each) carrying an alpha-cutout leaf mass over a small
solid core, so the silhouette comes from paint — ragged, per-cell different, never twinned.
- ONE 4x2 atlas (`FSModels.foliageAtlas`, `LEAF_TEX_PX` 256) serves every tree because a tree is
  one merged geometry with one material. **Cell 0 is solid opaque white and trunks sample it at a
  single constant uv** — zero uv derivative → always mip 0 → no amount of bleeding from the ragged
  cells beside it can alpha-test a trunk into lace. It is painted LAST, deliberately: a leaf cell
  that forgets its own offset lands there, and that bug shipped once inside this pass (every
  conifer became a spiky dark splat because its cones and trunk were sampling needle strokes).
  Leaf masses are LOBED, not round — a circular card is the same stamp the icosahedra were.
- **THE CAMERA DECIDED THE ARRANGEMENT.** At 49-58° pitch a tree is read largely from above, so
  cards fan around the trunk tilted back from vertical plus 1-2 near-HORIZONTAL crown cards on
  top, which are what this camera actually reads as fluff.
- **CONIFERS KEEP CONES, and that is a finding.** A card-built pine fails on this camera both
  ways: vertical cards go edge-on from above and a wood becomes a field of green stars, and cards
  laid flat enough to read from above become a green starfish. The fluff comes from `firSkirt`
  instead — a cone whose base ring is SCALLOPED (radius alternating full / ~0.7, jittered), so the
  plan view is a soft rosette of branch clusters instead of an octagon — for FEWER triangles than
  `THREE.ConeGeometry` (which pays for a degenerate apex row and a full cap fan). Plus one small
  drooping needle card per tier to break the outline.
- Triangles per tree: broadleaf mature **216 → 92**; conifer 147 → 146 (same count, much softer).
  All twelve stage silhouettes stay monotonically taller and wider — asserted, because a
  forester's sapling has to be tellable from a mature broadleaf at a glance. Stumps and dead wood
  are untouched (they are supposed to look spiky).

**3 · SPRITE GRASS — the meadow is back, and the two things that made it "busy" are fixed.**
Phase F switched the tuft layer off on 2026-07-31 as too visually busy. It is on by default again
(`TUFT_PER_VERTEX` 3, ~23k clumps on Large, ~9k on medium) with three changes:
- **A clump takes its colour FROM THE GROUND IT STANDS ON** (`tuftTint` samples the terrain's own
  vertex colour at `TUFT_GROUND_MIX` 0.86), so it reads as that patch of meadow standing up rather
  than a separate green object sitting on it. Density stops being busyness. (The first cut of this
  had the classic aliasing bug — the lerp TARGET was `tmpC`, which every caller passes as `out`,
  so it lerped a colour toward itself and silently did nothing.)
- **AUTHORED TALLER THAN WIDE** (`TUFT_H` 0.36 / `TUFT_W` 0.26). An upright quad at 52° loses
  ~62% of its HEIGHT to foreshortening and none of its width, so a clump wider than it is tall
  arrives on screen as a squat spiky rectangle — a fallen leaf, which is exactly what the first
  pass looked like. Phase V's "tall + thin = scratches" note was written for the old wide-fan
  sheet; with the fan narrowed, tall is right.
- **NORMALS POINT STRAIGHT UP.** A vertical blade sheet's true normal is horizontal and renders
  far darker than the ground it stands in. Facing them up makes every clump take the same light as
  the terrain underneath. Standard foliage trick, costs nothing, and it is the single change that
  turned the layer from litter into ground cover.
- Placement: GRASS ONLY (swamp/desert dropped — the meadow's own cutout in a marsh reads as the
  meadow leaking into it), never on a claimed vertex, and **never on PAINTED ROAD** — the network
  is a ground decal wider than the lattice edge it follows, so `edgeCount` alone leaves grass
  growing through the middle of a track; the spawn reads the same alpha sheet the paint comes from
  (`FSRender.roadCover` > `TUFT_ROAD_ALPHA` 26). The walk toward a neighbour only happens when
  that neighbour is grass too (it used to exclude water alone, and 45 of 2630 clumps stood in a
  marsh or on a rockface). `buildDecor` is deliberately BLIND to roads: the painted sheet exists
  for a reloaded world and not for a fresh one, and seeding against it made the meadow's
  population depend on how the world arrived (41 clumps of difference) — `syncClaims` does the
  suppression from one code path on frame one.
- **THE PER-FRAME CPU BREEZE IS GONE.** Grass sways in the same vertex shader as the trees
  (`swayMat(m, amp, mask)` gained a per-material `uSwayK` — x = share of the wind, y = the height
  at which it reaches full lean — so a 2.6u tree and a 0.36u tuft bend the same at the tip while
  sharing ONE compiled program). A tuft matrix is written once at spawn and never again; the old
  rolling-window recompose+upload was the meadow's entire CPU cost and it scaled with density.
  `setTreeSway(false)` still stops the whole world dead, grass included — the film-strip rig is
  untouched and asserted.
- **ALPHA BLEED — the fix for why every cutout in the world went muddy at distance.** A canvas'
  transparent pixels are rgba(0,0,0,0); mipmapping averages RGB and alpha separately, so a 6-pixel
  grass clump samples a mip whose RGB has been dragged most of the way to BLACK. Measured
  rendered tuft colour (85,111,52) against ground (109,155,125). `FSModels.bleedAlpha` fills the
  transparent region with the sheet's own mean → (103,134,62), a 20% lift, and the specks stop
  reading as dirt. **The alpha cannot stay at zero**: a 2D canvas backing store is PREMULTIPLIED,
  so colour written under alpha 0 through `putImageData` is discarded on the spot (the first
  attempt measured the surround as pure black again and changed nothing on screen). Bleeding at
  alpha 10/255 survives the round trip, is far under every `alphaTest` here so no cutout moves at
  mip 0, and lifts the mip average out of the black. Applied per-cell to the foliage atlas so a
  leaf cell never takes on the needle cell's hue.
- The blade-noise ground sheet the brief asked about ALREADY EXISTS (`FSModels.groundTex`,
  greyscale, world-tiled at `GROUND_TEX_UV`); verified it does not fight the road decal's
  feathered edges — see `fs_charm_roadedge.png`, plus the existing decal/normals/emissive checks.

**PERF** — Large (W=136), seed 12345, 3 AIs, 3000 ticks, SwiftShader 1280x800, 60-frame medians,
`readPixels` after every frame (without it `gl.finish()` under ANGLE hides all the GPU work).
"Before" is the pristine pre-charm files measured through the same script.

| | triangles | draw calls | frame |
|---|---|---|---|
| BEFORE, play zoom | 478,431 | 51 | 133.8 ms |
| BEFORE, max zoom-out | 461,203 | 52 | 132.9 ms |
| **AFTER, play zoom** | **134,616** | **51** | **75.5 ms** |
| **AFTER, max zoom-out** (worst case) | **164,214** | **49** | **79.6 ms** |
| AFTER, closest legal zoom | 80,884 | 44 | 51.4 ms |
| AFTER, culling OFF, play zoom | 472,556 | 51 | 214.6 ms |
| AFTER, culling OFF + meadow hidden | 353,774 | 48 | 102.1 ms |
| AFTER, culling ON + meadow hidden | 115,434 | 48 | 53.8 ms |

Culling alone: **-71.5% triangles / -65% frame** at play zoom. Whole pass vs the baseline:
**-71.9% triangles / -44% frame** at play zoom, **-64.4% / -40%** zoomed out — the case that was
not allowed to regress improved instead. The card canopies took ~125k triangles off the same
instance count. THE MEADOW'S OWN COST after culling is 19,182 triangles (14% of the frame) and
21.7 ms of SwiftShader (29%) — over the 10% target *on a CPU rasteriser*, where alpha-tested fill
is the dominant cost and where the shipped build auto-thins the meadow to `QUALITY_SOFT` 0.08
anyway; the board forces `setQuality(1)` to measure the real look, so that protection is switched
off in every number above. Frame times swing +-30% run to run under parallel-agent load — the
triangle and draw-call columns are the stable ones.

**TUNABLES** (all `FSC.VIS`): `CULL`/`CULL_CELL` 16/`CULL_PAD_XZ` 1.8/`CULL_PAD_UP` 4.0/
`CULL_PAD_DOWN` 0.8 · `LEAF_CARDS` [2,3,5,6]/`LEAF_CROWN_CARDS` [0,1,1,2]/`LEAF_CORE` 0.62/
`LEAF_CARD_TILT` 0.42/`LEAF_ALPHA_TEST` 0.42/`LEAF_TEX_PX` 256 · `TUFT_PER_VERTEX` 3/`TUFT_MAX`
30000/`TUFT_H` 0.36/`TUFT_W` 0.26/`TUFT_GROUND_MIX` 0.86/`TUFT_ROAD_ALPHA` 26/`TUFT_FADE_DIST`
66/`TUFT_SHADER_SWAY` 0.9/`TUFT_SWAY_MASK` 2.4 · `TREE_SWAY` 0.07 → **0.09**/`TREE_SWAY_MASK` 0.55.

**SUITES**: `_verify-farmstead-visuals.cjs` **187/187** (was 155; +32) — new section 12 CULLING
(bucket accounting, tri drop at play zoom, zoom-out still helps, draw calls never grow, a
per-instance frustum sweep at four cameras proving **zero false negatives**, a whole-framebuffer
culling-on-vs-off pixel comparison at three cameras, and membership rebuild on fell/regrow and
sow/clear) and section 13 THE FLUFF (cutout-not-blended, double-sided, atlas solid-cell opacity,
leaf-cell raggedness, alpha bleed, per-stage silhouette monotonicity, triangle budget, grass
normals/aspect/sway/quad count, and "no clump stands on painted road" sampled against the real
paint sheet). `_verify-farmstead-visual.cjs` **60/60** unchanged. Boot smokes: world **84/84**,
transport **138/138**. The ui/mp/polish/economy/military suites were deliberately NOT run (a
parallel agent owned `fs-ui.js`/`farmstead.html` for the whole session; the main session runs the
full battery).
**RESTAGED, with reason, never bent**: section 2 flipped from "the shipped default spends nothing
on tufts" to "the meadow is on, dense, ground-tinted and grass-only" plus the inverse toggle check
that 0 still allocates nothing; "zoomed out the triangle count falls" became "zoomed out the
meadow drops out AND the far frame is cheaper than the same far frame unculled" (pulling back
admits more buckets, so the old inequality stopped being true for a good reason); the pixel-parity
check allows 1-in-20,000 pixels because the packer submits a pool in BUCKET order and two
alpha-tested fragments at exactly equal depth are decided by draw order (measured 14 / 1,024,000
at play zoom, 0 zoomed out, 0-1 zoomed in); the save/load meadow census now RENDERS before
snapshotting (it was comparing an un-synced live world against a rendered reloaded one — a test
artefact, and with both rendered the two agree clump for clump).
**SHOTS**: `node tools/_fs_charm_shots.cjs` **21/21** → `shots/fs_charm_{forest_before,
forest_after,grass_closeup,town_wide,treestages,swayspeed_a,swayspeed_b,roadedge,zoomout,
mobile}.png`, every plate asserting what its filename claims. `forest_before` is an ARCHIVED plate
(captured off the pre-charm build; the geometry it shows no longer exists, same status as the
reviewed film strips) — the script asserts it is on disk and not blank and regenerates the other
nine at the same camera.
**GOTCHAS worth keeping**: `page.screenshot` between two evaluates leaves the default framebuffer
unreadable (`preserveDrawingBuffer` is off), so a before/after pixel pair taken around a shot
reports EVERY pixel as changed — stash the grab on `window` inside the browser instead.
`animDecor` re-asserts `mesh.visible` every frame, so hiding a decor pool from a test to see what
it contributes silently does nothing (set `TUFT_FADE_DIST` to 0 instead) — that cost a wrong
diagnosis. And sway phase is driven by TICKS, so `ff(n)` advances it identically at 1x and 4x; the
4x-per-wall-second property is the one the visuals suite already covers.
**DEFERRED**: swamp and desert grow no grass at all now (one constant away, but they want their
own art, not the meadow's); the meadow is a fixed density rather than distance-tapered (the
`TUFT_FADE_DIST` cliff at 66u is the only LOD it has); and per-bucket sorting could give the
packer a front-to-back order for free if overdraw ever matters.

## 🌾 FARMSTEAD BATCH #4 — seven items from one session at the wheel (2026-08-02)

User brief, seven items: a real *sea of grass*; DOS-Settlers trees (photo references supplied
for both); goods carried OUT IN FRONT instead of on the head; real tool swings instead of a
body bob; four construction stages per building; the speed rail moved to the top right and
made inert in co-op; and construction 1.5× faster.

**0 · TWO BUGS THE BRIEF UNCOVERED, and both explain complaints nobody had connected.**
- **A DOUBLE-SIDED CARD WAS BEING LIT FROM BEHIND BY ITS OWN NEGATED NORMAL.** Every cutout in
  this world — grass clumps, leaf masses, needle fans — is authored with its normal pointing
  STRAIGHT UP so it takes the ground's light, and drawn `side: DoubleSide` because the camera
  orbits 360°. But r128's MeshLambert lights per VERTEX into `vLightFront` / `vLightBack` and
  the fragment shader picks between them on `gl_FrontFacing`, `vLightBack` being the same
  vertex lit with the normal NEGATED. So every card whose winding faced away got no sun at all
  — only the hemisphere's ground colour plus the emissive lift. Half of every clump and half
  of every canopy, at any yaw, rendering near-black. That is what "the grass reads as dark
  specks" and "the canopies are a dark haze" both were, and it is why a denser meadow had only
  ever made the ground look dirtier. `FSModels.litBothSides` swaps two strings in the fragment
  shader so both faces take `vLightFront`; no geometry, no draw call, and grass and trees still
  share ONE compiled program (the cache key is EXTENDED — `fsTreeSway|bothLit` — not replaced,
  which is a suite restage).
  Consequence worth knowing: once lit correctly the meadow became almost INVISIBLE (a clump is
  86% the colour of the ground it stands on), so the tuft sheet's value range was widened and
  `TUFT_TINT_LIFT` 1.13 puts the lit tips above the meadow. A clump reads by its own internal
  contrast now, not by being a different green.
- **`getImageData` ON A GPU-BACKED 2D CANVAS COSTS 1.4 SECONDS.** The new carpet normalises its
  own mean, which means reading itself back — and the world suite's terrain-build budget caught
  the result at **1,901 ms**. Measured: a 512² readback is 1,449 ms on a plain canvas against
  **19 ms** with `willReadFrequently`, and even a 32×32 readback costs 439 ms, so the stall is
  the GPU→CPU SYNC, not the pixels. `canvasTex` now creates every context with the hint. It was
  already being paid by the alpha bleed: `foliageAtlas` went 527 → 26 ms and `groundTex`
  1,898 → 68 ms, i.e. this batch made texture generation cheaper than it was before it started.

**1 · THE SEA OF GRASS.** The arithmetic is the whole design. At play zoom the camera puts ~24
screen px on a world unit laterally and ~19 along the ground, so one `GROUND_TEX_UV` tile
covered ~100×80 px — and a 256-texel sheet stretched over it was being MINIFIED 2.5×, which put
every blade stroke inside the mip average. The grain was real and invisible from where the game
is played. The sheet is built at THREE scales now, and the middle one does the work:
- **CLUMP scale** (0.2-0.6 world units = 5-14 screen px) — soft lumps with a shaded seat, one
  gradient each. This is what reads as a mass of grass; nothing at blade scale can.
- **BLADE scale** — 6,000 strokes per rank, dark stems then lit tips, for the close zoom where
  the sheet is magnified rather than minified.
- **SPECK scale** — 46,000 single pixels written straight into the buffer.
LOW-frequency content is deliberately ABSENT: a feature the size of the tile is what makes a
tiled sheet announce its grid, and the terrain already varies at that scale through its own
vertex colours. The mean is NORMALISED (`GROUND_TEX_MEAN` 0.955) because the sheet multiplies
the ground, so its mean IS the world's brightness — contrast can go where the art wants it only
because the level is put back. `GROUND_TEX_PX` 256→**512**, `GROUND_TEX_UV` 4.2→**3.6**.
- **ANISOTROPY IS SET FROM THE RENDERER, NOT THE MODEL** (`applyGroundAniso`). The ground is the
  one surface seen at a 49-58° graze all the way to the fog and asks for 8; the maximum is a
  driver property and on a SOFTWARE rasteriser every extra tap is real CPU on the biggest
  surface on screen. Hardware gets `min(8, getMaxAnisotropy())`, SwiftShader/llvmpipe get 2.
  **This one number was worth 28 seconds**: with aniso 8 on SwiftShader a second same-origin
  page's `DOMContentLoaded` went from 0.9 s to 28.9 s (all farmstead pages share ONE renderer
  process and the first page never stops rendering), which is what was crashing the visuals
  suite's extra pages at puppeteer's 30 s default.
- Tufts: `TUFT_PER_VERTEX` 3→**4**, `TUFT_H/W` 0.36/0.26 → **0.45/0.325** (aspect kept — bigger
  clumps cover ~1.6× the ground for the SAME triangle count, the cheapest coverage on the
  board). Grass-only, off roads, off claimed ground — all unchanged.

**2 · THE TREES ARE CLUMPS NOW** (reference: DOS-Settlers sprite trees). `leafMass` was a haze —
80 small soft dabs at randomised luminance, which averages to an even felt disc. The reference's
whole character is that you can COUNT the clumps. A mass is BUILT OUT OF BLOBS, ten to sixteen,
each drawn three times: a dark under-disc offset down-right (the neighbour's shadow, which is
what makes the cluster read as layered), a ragged body, and a lit cap up-left on the key light's
own heading. Rim blobs hang half outside the lobed radius — that is the silhouette, from the
same shapes as the interior. Value range 0.42→1.0; the reference's undersides are near-black.
Plus: `LEAF_CARDS` [2,3,5,6]→**[3,4,6,7]**, `LEAF_CROWN_CARDS` [0,1,1,2]→**[0,1,2,3]**, cards
squarer and their centres tighter (the old fan was authored 1.90×1.55 of the crown radius and
read as a flat splat with a wide waist), `LEAF_A/LEAF_B` shifted olive, and `TREE_TRUNK`
darkened to 0x43331f/0x4e3b26 with the trunk thinner and shorter — in the reference the trunk
is a small dark stem, not a lit post.
- **THE CONIFER'S CONES ARE PAINTED, and they carried NO uv at all before.** `firSkirt`
  generated position and normal only, so `mergeFoliage` dropped every fir on the solid patch: a
  flat-shaded lampshade. It emits uvs now (u round the skirt, v base→apex, per TRIANGLE so the
  wrap-around face cannot smear the whole cell across one lobe) and samples a NEW, FULLY OPAQUE
  atlas cell — the atlas went 4×2 → **4×3** for it, because alpha on a cone is what laces a
  distant fir into nothing.
  **THE STRUCTURE RUNS ACROSS u, NOT DOWN v, and that is the finding.** Bands down v are
  compressed into a 0.4-unit tier — a couple of screen pixels, which averages straight back to
  the flat lampshade. What this camera reads of a fir is its PLAN view: a rosette. So the paint
  is COLUMNS, one per scalloped lobe, lit on the up-sun side, and every branch cluster now has
  its own light from above. Segments 8/10 → **10/12** for two triangles a tier.
- The solid core is the DARKEST thing in the tree now (`deep × 0.80`, `LEAF_CORE` 0.62→0.56,
  ×0.76 again on the young stages). At 36% of the way to the highlight it showed between the
  cards as a lit diamond — a wood full of bright green gems, caught on the review plate.

**3 · GOODS ARE CARRIED IN FRONT.** A new **carry** pose — the walk cycle with both arms out,
elbows apart, a straighter back and a constant arm pose across the cycle (a man carrying a crate
does not swing it) — baked for BOTH looks, plus a per-frame **`hands`** anchor resolved from the
POSED arms. A serf with something in his hands uses those rows; standing still with a load he
holds carry frame 0 rather than an idle fidget, or the crate would jump to his head every time a
carrier waits at a junction. **Hands full, no tool**: drawing his axe as well put a second object
through the load. An older manifest with no carry block falls back to `walk`.
- **THE MINIFIG GREW ARMS.** They were two more boxes inside the merged torso, so a minifig serf
  could not reach for anything. Parts flagged `arm: ±1` build their own triplet and hang off a
  SHOULDER group; a part list with no arm flags (the knight) behaves exactly as before.
- **THE SKINNED DWARF'S SHOULDER AXIS IS MIRRORED — measured, not derived.** The carry pose
  (`armX +1.32`, "both arms out in front") put his arms straight UP in a V off the identical
  scalar the minifig swung forward. `DK.armSignX = -1`. It also means the walk's counter-swing
  has been BACKWARDS on that look since it was written — 17° on a 26 px sprite, which is why
  nobody saw it. Correct now for the same reason.
- **A PIXEL CANNOT BE SPLIT BACK INTO HEIGHT AND DEPTH.** The `hands` anchor is a pixel inside
  the body cell, and a hand held FORWARD projects downward exactly like a hand held lower — so
  seating the good by dividing that offset by cos(pitch) reads as a load sunk into his knees. It
  is applied as a CAMERA-PLANE offset instead, the same term every overlay uses (`gsprPush`
  gained ox/oy), which needs no such split and lands on the pixel at any yaw. And a good's own
  cell STANDS it on its anchor, so it is dropped `0.30 ×` its own quad or the plank floats at
  chest height.

**4 · WORK IS A TOOL SWING.** The work cycle was the torso alone — pitch forward by
`swing*0.42`, bob, brace — a man bowing at his work with his tool welded to his hip. The arms
raise the tool overhead (−0.30 → −2.05 rad at the shoulder) and strike down through the bottom
of the arc; the torso lean halved, because a 24° bow ON TOP of a raised tool folds him in half.
**The arms SPLAY as they rise** (`armOut` 0.10 → 0.55) and that is not decoration: the raise is a
rotation in the SAGITTAL plane, so from dead ahead or dead behind it is pure foreshortening and
the whole swing reads as a man standing still — which is exactly what the first bake's contact
sheet showed.
- **THE TOOL SWEEPS WITH THE HAND, on a baked-once overlay.** The manifest carries a per-cell
  **`toolAngle`**: the screen-space rotation the posed arm puts that cell's (arms-at-rest) tool
  image at. The renderer rotates the quad about its own pivot — the hand — through two new
  per-instance attributes (`aRot`, `aPiv`); at `aRot 0` the shader collapses to the original
  expression exactly, which is what every hat, pack and pip uses. Re-baking a tool sheet per arm
  angle would have multiplied the overlay sheet by the frame count.
- **THE ANGLE IS MEASURED AGAINST THE RIG'S OWN REST ARMS**, and the first cut got this wrong:
  referencing "the tool points up the body's +Y" is fine for the minifig and 155-180° out on the
  skinned dwarf, whose rest forearm points DOWN — every axe swung upside down. The bake poses
  each rig twice per cell (rest, then real) and takes the difference.
- The overlay pass poses its OCCLUDER with the arms at rest too (`noArms`), or a raised arm
  would carve its silhouette out of a tool image drawn down at the hip.

**5 · FOUR CONSTRUCTION STAGES, DERIVED.** A site used to raise ONE generic rising box whatever
it was going to become. By quartile: **0** cleared pad with the delivered planks and stones
heaped on it · **1** a TIMBER FRAME (corner posts, sill, top plate, studs, braces) · **2** WALLS
UP, NO ROOF · **3** …plus the bare roof TRUSSES · then the finished model.
- **STAGES 2 AND 3 ARE THE FINAL MODEL WITH ITS ROOF CLASSIFIED OUT**, which is what makes 23
  building types tractable — nobody hand-models 92 meshes. `classifyBuilding` decides in order of
  confidence: the part's own `role` (which `shell()` now stamps — that is the roof of every
  ordinary building, exactly, by construction) → its ATLAS CELL (thatch/shingle/slate/tile/straw
  are roofing and nothing else here is made of them) → its COLOUR against the roof palette →
  failing all three, its HEIGHT above the model's own wall line, which catches chimneys, spires,
  headframes and battlements. **Hit rate: 23 of 23 types classify with a non-empty roof and NO
  spot fixes were needed.** Nineteen resolve through `shell()`; the four that build their body by
  hand (tower, fortress, mill, the mines) fall to the geometric rule and land correctly. The
  frame and the trusses come from the SHELL BOX the finished model records (`parts.shellBox`) or
  from the part bounds — nothing is per-type.
- **CEILING JOISTS, because a wall is a solid box.** Taking the roof off leaves the box's TOP
  FACE looking at a camera 52° above it: a flat lid in the wall's own colour, which reads as
  "finished, painted brown". Four beams across the opening turn the lid into structure.
- The site mesh's ambient lift follows what it mostly IS (`COL.BLD_WALL` at stages 2-3, site
  timber below), or the walls changed colour on the frame the building finished — the same
  lesson the road decal learned about matching the ground it lies on.

**6 · THE SPEED RAIL IS TOP RIGHT, AND INERT IN CO-OP.** It sat centred under the top bar, which
is the middle of the map. It is now under the bell/menu cluster it belongs with, in the same
oak-rail-and-stone-buttons language as the dock, positioned off the bar's MEASURED height
(`--fs-topbar-h`); on a phone the buttons tighten to 38 px and `#pingBtn` drops below it.
- Multiplayer: the rail is greyed (`#fsSpeed.locked`, every button `disabled`, title "Co-op runs
  at 1×") and the number keys and Space are inert with a blip toast. Speed multiplies every
  client's command LEAD (`CMD_DELAY_MP × max(1, speed)`), so it is a property of the SESSION, not
  of one player's patience.
- **THE GATE IS DELIBERATELY NOT INSIDE `setSpeed()`.** Putting it there broke lockstep outright,
  and the reason is worth keeping: `issueCommand` takes `G.cmdSeq++` BEFORE a guest's copy is
  routed to the host, so a corrective command raised independently on both machines advances the
  two counters differently — and `cmdSeq` is serialized state, so it is in the sync hash. The two
  sims diverged inside 900 ticks. `setSpeed` is also the debug hook and FSNet's own path; the
  player gate lives in FSUI and the keydown handler, and correcting a clock that arrived wrong is
  the HOST's job alone, only for speed ABOVE 1 (pulling a PAUSED room to 1× would fight every
  legitimate reason a connected sim sits at 0), latched on a tick boundary.

**7 · CONSTRUCTION IS 1.5× FASTER.** `FSC.SWING_TICKS` [77,51,51,77] → **[51,34,34,51]** (mean 64
→ 42.5 ticks = 1.506×). Nothing else moved: the accumulator, `SWING_PER_MAT`, `LEVEL_T` and every
building's own `swings` table are the recovered originals, so a building needs exactly the
materials and swings it always did. Scaling the CLOCK rather than the counts keeps the material
draw landing on the same swing numbers; the array LENGTH is unchanged so `FSC.rngInt` still draws
once per swing and the rng stream keeps its shape. Documented as **deviation 15** in
farmstead-plan.md.

**PERF.** Large (W=136), seed 12345, 3 AIs, 3000 ticks, SwiftShader 1280×800, 60-frame medians,
`readPixels` after every frame. Draw calls **51 → 49** at play zoom and **49 → 48** zoomed out;
triangles **134,616 → 142,091** (+5.6%) and **164,214 → 171,229** (+4.3%).
FRAME TIME IS REPORTED FROM A BACK-TO-BACK A/B, not across the session: this box drifted ~25%
over six hours (the same build measured 79.6, 100, 105 and 128 ms at different points), so the
only honest number is one where both halves are measured in ONE page — the shipped art against
the same build with this batch's per-frame lever (the meadow) dialled back:
**play 88.2 → 91.3 ms (+3.5%), zoom-out 98.6 → 97.2 ms (−1.4%)**, tufts 19,759 → 24,129. Both
inside the ±15% gate. Texture generation is *faster* than before the batch (see §0).

**SUITES — all nine green, 1,044 checks, 0 page errors**: world **84** · transport **138** ·
economy **107** · visuals **187** · visual **60** · military **124** · ui **149** · polish **68**
· mp **127** (+1: the co-op speed rule). Plus `node tools/_fs_b4_shots.cjs` **38/38**.
**RESTAGED, with the reason each time, never bent:**
- visuals: the sway-hook check asks for the sway program key as a PREFIX (`litBothSides` extends
  it rather than replacing it) and keeps its "stone is untouched" half; the tint probe now FACES
  the serf at the camera before measuring, because the team region on this look is his BELT and a
  carrier's PACK covers the small of his back — a serf caught at azimuth 7 moved 5 pixels where
  his own front view moves 486, and which serf the probe grabs moved when construction sped up;
  the culling pixel-parity tolerance went 1-in-20,000/worst 96 → 1-in-10,000/worst 200, because
  both halves scale with the MEADOW and the meadow got denser and higher-contrast (measured
  54 / 1,024,000, worst 147).
- visual: `SIM_BASELINE` re-derived — construction speed is a rule change, so every seed's sim
  hash moves, and because finished buildings claim ground and their crews fell trees on the way,
  the MAP hash moves too. Recomputed twice in two fresh pages, "REPRODUCIBLE: true".
- ui: the paused-queue toast check PAUSES FIRST, THEN CONNECTS — that state is still reachable
  (it is the transient between a paused solo game and the room going live) but a connected client
  can no longer be asked to pause.
- mp: "a GUEST speed change moves BOTH screens to 2×" became the new rule from the other side —
  the rail is visibly locked and inert on a connected client, a clock that arrives wrong is
  pinned back to 1× on BOTH screens, and the live accumulator check runs at the speed the session
  actually has.
- harness: `browser.newPage` gets a 150 s default navigation timeout. Every page a suite opens is
  the SAME ORIGIN, so Chrome puts them in ONE renderer process on ONE main thread, and a
  farmstead page never stops rendering — measured 0.9 s to boot a sibling against a fresh first
  page and 28.9 s against a warmed one, on the same build. It does not hide a hang.
**RE-BAKED SHEETS, both looks** (`node tools/_fs_bake_sprites.cjs`, then `--source dwarfknight
--out …`; MINIFIG FIRST — the dwarf inherits its frustum, and it still fits, so px-per-unit,
footPx and the quad size are all unchanged): rows 23 → **31**, cells 2,672 → **2,928**, anchors
2,912 → **3,920**. minifig 2.83 → **3.39 MB**, dwarfknight 4.23 → **5.00 MB**. sha256 prefixes:
`sprites/` serf-body `226a8ddd`, serf-mask `3e3ca78b`, knight-body `592c48ec` (UNCHANGED),
knight-mask `7bb93b79` (UNCHANGED), overlays `5786e0eb`, manifest `608c28ed`;
`sprites-dwarfknight/` serf-body `f4487491`, serf-mask `a5a6a2d4`, knight-body `89a5cfb1`,
knight-mask `06f0d563`, overlays `04658101`, manifest `afb0a491`.
**TUNABLES ADDED** (`FSC.VIS`): `GROUND_TEX_PX` 512 / `GROUND_TEX_UV` 3.6 / `GROUND_BLADES` 6000
/ `GROUND_CLUMPS` 620 / `GROUND_SPECKS` 46000 / `GROUND_TEX_MEAN` 0.955 / `GROUND_TEX_ANISO` 8 ·
`TUFT_TINT_LIFT` 1.13 · `LEAF_CONIFER_MEAN` 0.94. Bake side: `B.ARM = {swing .34, carry 1.32,
carryOut .24, workLo .30, workHi 2.05}`, `DK.armSignX`.
**SHOTS**: `node tools/_fs_b4_shots.cjs` (38/38) → `shots/fs_b4_{carpet,carpet_closeup,
trees_vs_ref,carry,builder_strike,woodcutter,stages_small,stages_large,speedbtns,speedbtns_mp,
zoomout}.png` — every plate asserts what its filename claims BEFORE it is written (the carpet
plate raycasts each sample to check it landed on GRASS before demanding it be green, so it
measures the carpet and not the map).
**KNOWN / DEFERRED**: a woodcutter mid-chop stands UNDER the tree he is felling, so at this
camera's 49-58° band he is partly behind its canopy from every yaw — the plate picks the clearest
of 16 headings and pulls back, which is as good as the fixed camera allows; the `hands` anchor is
the midpoint of the two fists, so a good held by a serf seen from directly behind can sit a pixel
or two inside him; stage 0 of a LARGE building is a big pad with a small heap on it and could
carry more; and the meadow is denser but still a fixed density rather than distance-tapered.

## 🏰 CASTLE KRUZER BATCH #5 — six items from one session at the wheel (2026-08-02)

**1 · ALLIES ARE NEIGHBOURS.** Batch #3 doubled the boards and pushed every start to
23.4/32.1/51.6 road steps — right for a free-for-all, wrong for the two seats of a
SEPARATE-ALLIED-KINGDOMS co-op game, whose whole point is helping each other. The generator now
KNOWS THE TEAM LAYOUT: `FSMap.generate({..., allies})` where `allies` = `FSSim`'s `humans` (plan
§16 seats every human on team 0 and gives every AI a team of its own), threaded from `newGame`
and already carried in the host's settings block, so both machines derive the same world.
- **The allied block is placed as ONE SITE.** The existing quality/separation ladder runs for
  `n − allies + 1` kingdoms — which also makes the RIVAL spacing it aims for slightly wider,
  because `SEP_FRAC` is indexed by that count — and the remaining allies are then seated in a
  band around the anchor. Band outer edge `ST.ALLY_SEP_FRAC` 0.42 of the rival target; floor
  `ST.ALLY_SEP_MIN` **19, DERIVED not chosen**: a shade over `ST.MOUNTAIN_MAX` 18, the radius
  `guaranteeStartOre` searches, so two allies can never sit inside each other's guaranteed-ore
  reach and be handed the same seam. The band widens in rungs when a board has nothing seatable;
  the floor never moves, and a board with nothing at any rung falls back to the plain n-way
  spread (the pre-batch behaviour, always placeable).
- **MEASURED, 8 seeds × 3 sizes** (scratchpad `mapstat5.cjs`, the same probe run against
  `allies:1` for the before column): ally↔ally **19–23 / 19–20 / 19–30** steps (means
  19.5/19.3/22.4) where the same two starts used to be at the rival distance, mean
  37.4/51.8/83.0 — i.e. **52% / 37% / 27%** of it. Rivals are untouched: mean 31.9/52.5/81.5
  against 37.4/51.8/83.0, worst-board minimum 15/20/32 against 16/22/42. The ore guarantee holds
  PER START: worst coal 17/17/18, worst iron 17/17/21, starts with coal or iron beyond 18 steps
  **0/0/2** (the `allies:1` board scores 1/0/2), nothing absent anywhere. COST, reported rather
  than buried: the balancer's ore spread widens on the two smaller sizes (0.49→0.88 small,
  0.53→0.68 medium) because two close allies split one Voronoi region — large IMPROVES,
  0.78→0.43. Stone 0.43→0.33 / 0.13→0.27 / 0.14→0.16.
- **`allies < 2` IS THE UNTOUCHED PATH, byte-for-byte**, so no solo or shared-kingdom map moves —
  which is why the visual suite's `SIM_BASELINE` did not need re-deriving. It was re-derived
  anyway, TWICE in two fresh pages (scratchpad `rebase5.cjs`): both runs identical to each other
  and to the recorded table. The team layout IS in the seed contract (same seed + `separate` =
  a different, byte-stable world; asserted both ways).

**2 · CO-OP RUNS AT 1× AND 2×.** Batch #4's flat 1× pin is gone; `FSC.MP_MAX_SPEED = 2`.
- WHY 2 AND NOT 4: the wire does not care about speed at all — the command lead is
  `CMD_DELAY_MP × speed` TICKS, a CONSTANT ~400 ms of real time at any of them, so 2× gives the
  transport exactly as long to deliver an order as 1× did. What speed buys is per-second sim
  THROUGHPUT, and that is the ceiling: at 4× a client must sustain 40 ticks AND 40 frames a
  second or it lives permanently in FSNet's catch-up path, and the slowest seat sets the room's
  pace. Measured on the localws relay at 2×: guest tracks the host inside its lead window
  (`t1 + CMD_DELAY_MP×2 − 1`) with the gap under 40 ticks, hashes agree either side of the run,
  0 resyncs, 0 cmdFails.
- **THE TRAP WAS NOT RE-STEPPED ON.** The gate is still in FSUI + the keydown handler and NOT in
  `setSpeed()`. A speed the player picks travels the ORDINARY command road — `speed` is
  `CMD_HASH_NEUTRAL`, so a guest's pick is routed to the host by `FSSim.netHook` and comes back
  as the host's own broadcast; no client invents one locally. A clock that ARRIVES above the
  ceiling is still corrected by the HOST alone, above the ceiling only, latched on a tick
  boundary — now down to `MP_MAX_SPEED` instead of all the way to 1.
- UI: `speedLocked()` → `speedAllowed(s)`. `#fsSpeed.locked` no longer greys the rail; the
  dimming moved onto `button:disabled`, so pause/1×/2× read live and only 4× is dead. The
  keydown gate is one key (`3`) instead of four.

**3 · THERE IS NO ATTACK KEY.** `A` was "attack whatever is under the cursor" AND pan-left, so
panning the map west launched knights at whatever the cursor happened to be over — the worst
kind of collision, because the two meanings are a held key and an irreversible order. Removed.
Attacking keeps its deliberate route (select the enemy building → ⚔ Attack → the knight-count
dialog), which was always the main path; `FSUI.doAttackAtHover` survives as API for the suites.
**FULL KEYMAP AUDIT against the camera's w/a/s/d/q/e + arrows: A was the ONLY collision** — the
rest of the shell's map is f r b x c p t m g, Tab, Escape, Space, 1-3, `.` and the build digits.
The world suite asserts the general property, not the one key: every camera key moves the camera,
NONE of them reaches a hover action (all four are stubbed and counted), and the on-screen hint no
longer advertises a key that is not there (it advertises **WASD/QE** instead).

**4 · THE ROADS ARE A FOOTPATH AGAIN.** `ROAD_PAINT_HW` 1.45 → **1.12** of `FSC.ROAD_W`, a 23%
narrower paint — and the COAT RATIOS moved with it rather than riding along, which is the whole
point. `ROAD_COATS` k 1.85/1.36/1.02/0.60 → **2.05/1.42/1.00/0.58** and the outer coat's own edge
jitter 0.44 → 0.56: the body and the packed core come in by the full 23% while the SCUFF coat is
widened relative to the new half-width, so the feathered verge keeps the same ABSOLUTE width on
the ground. Shrinking all four uniformly makes a crisp thin stripe, and a crisp thin stripe is a
sticker — the soft edge is the entire reason the decal reads as trodden earth. Junction blobs give
back a little of the loss (base radius 1.0 → 1.18 of the half-width) because a junction has to
keep reading as a trodden PATCH, and the spilled verge blots reach 1.45 → 1.75 of the half-width
so they still land as far out in world units as before.
- **MEASURED with a real cross-section** (sweep the segment's own perpendicular out from its
  midpoint, sampling the sheet): solid half-width **0.483 → 0.362** world units, outer feather
  0.906 → 0.778, `FSC.ROAD_W` 0.32 — i.e. the body went 1.51× → **1.13× ROAD_W** and the feather
  band survived. The grass exclusion needed no change: `tuftOnRoad` thresholds the sheet's own
  alpha, so the meadow follows the paint automatically. Every road vertex still stands on painted
  ground (suite bar: cover > 120) and a serf caught mid-road at play zoom is on it.
- **TEST GOTCHA that cost the first run**: a cross-section sweep must STOP AT THE FIRST GAP, never
  take the farthest painted sample. A town's roads run within a couple of units of each other, so
  a sweep that kept going measured this road plus the next one plus the junction between them —
  it read 1.18 world units, which is three roads.

**5 · THE CARRIED GOOD WAS AT HIS FEET, and the cause is arithmetic, not plumbing.** Batch #4's
`hands` anchor, the carry rows and the camera-plane seat were all working. The seat then dropped
the good by `GOOD_HAND_DROP 0.30 × GSPR.quad` — and the quad is the whole 64 px goods cell, 0.551
world units, so the drop was **0.165**. A settler is 0.48 world units from his boots to the top of
his head. The load was being pushed down by A THIRD OF A MAN from wherever his hands were, and on
the shipping look (dwarfknight) the carry pose's hands anchor projects anywhere from 0.15 to 0.44
depending on which way the camera is standing — so at the front azimuths the good came out at
**−0.015 world units: below his boots.** Measured live before the fix, seed 12345, azimuth 4:
hands 0.217, drop 0.165, good seated at **0.052**, which is his ankle. A constant tuned against
the tallest good in the set was never going to fit the shortest one either.
- FIX: drop by a fraction of THAT GOOD'S OWN measured height, which the bake already writes into
  the goods manifest (`rows[id].h`, 0.28–0.40 across the 26). `GOOD_HAND_DROP` = **0.12 × h**
  (0.18 first; at 0.18 the plank's lower edge still came down to 0.062 on the worst azimuth).
  `GSPR.hOf` carries the table; a manifest from before `h` existed falls back to a constant.
- **AND A SECOND, DEEPER BUG THE MEASUREMENT EXPOSED: the minifig's arms have been swinging
  BACKWARDS since batch #4 separated them.** Batch #4 found the skinned dwarf's shoulder axis
  mirrored and set `DK.armSignX = -1`; it corrected the dwarf and left the minifig, and the two
  rigs have disagreed ever since. Proof, not derivation: this minifig faces +Z and the bake's
  camera stands on +Z, so "forward" must project DOWN the cell at azimuth 0 and UP at azimuth 8.
  The carry pose's `hands` anchor peaked at 0.469 at azimuth 0 and bottomed at 0.175 at azimuth 8
  — the exact mirror of the dwarf. So on that look the carry held its load at his BACK (which is
  part of why it then had to be shoved down to meet it), the walk counter-swung the wrong way,
  and the tool went up in FRONT of the shoulder instead of over it. `B.applyPose` now negates
  both shoulder terms; `armOut` was pulling the elbows IN as well (the +X arm moved toward −X)
  and is negated with it.
- Worst-azimuth result, both looks, walking AND standing, over all 16 azimuths: the good's LOWER
  EDGE sits at **0.081 (dwarf) / 0.114 (minifig)** world units against a head height of 0.43, and
  its middle at 0.24 / 0.27. Before: −0.015.

**6 · ONLY THE TOOL ARM SWINGS.** Batch #4's work pose set `armX` and `armXR` to the same scalar,
so every builder and woodcutter struck with two mirrored arms and no tool in one of them. `armXR`
is the TOOL arm on both rigs (the `tool`/`toolTip` anchors come off the side-+1 hand), so it keeps
the whole stroke (−0.30 → −2.05 rad) and the splay that makes the raise readable head-on
(`armOutR` 0.10 → 0.55); the off hand gets `ARM_OFF_BASE 0.06 + swing × 0.22` and a flat
`ARM_OFF_OUT 0.06`. `armOut` is per-side on both rigs now (`armOutR`, falling back to `armOut`,
which every pose but `work` uses).
- **HOW IT IS ASSERTED, and the subtlety worth keeping**: the off hand's ABSOLUTE travel is not
  the measurement, because it rides the torso's own lean and bob whatever the arm does. A new
  `offhand` anchor (the side-−1 hand, posed, nothing drawn on it — it exists to be measured)
  is compared to the `tool` anchor RELATIVE TO THE TORSO (the `pack` anchor). Worst azimuth over
  a full stroke: tool **22.9 px** vs off **6.6 px** (dwarf) and 20.8 vs 5.8 (minifig) — 29% and
  28%. In absolute terms the off hand moves 11.3 px against the torso's own 10.5, i.e. it barely
  moves at all on its own.

**SUITES — all nine green, 1,073 checks, 0 page errors**: world **93** (+9: the allied-start band,
the per-ally ore guarantee, solo-map byte-identity, the seed contract, and the keymap audit) ·
transport **138** · economy **107** · visuals **205** (+18: the road cross-section, and the carry
seat + one-armed swing on BOTH looks) · visual **60** · military **124** · ui **149** · polish
**68** · mp **129** (+2). Plus `node tools/_fs_b5_shots.cjs` **29/29** and scratchpad probes
`mapstat5` (the generation table) and `rebase5` (the double re-derivation).
**RESTAGED, with the reason, never bent** — one section, and it is the same section batch #4
restaged for the opposite rule: mp's co-op speed block. It used to prove "the rail is inert and
the host pins to 1×"; it now proves all three halves of the new rule — a GUEST's 2× pick moves
BOTH screens (routed through the host, so no client invents a speed), 4× is greyed and does
nothing when clicked, and a clock that arrives at 4× is pinned to the ceiling on both screens.
Its wall-clock accumulator check kept its job and lost the "at 1×" in its name.
**RE-BAKED SHEETS, both looks** (`node tools/_fs_bake_sprites.cjs`, then `--source dwarfknight
--out …`; minifig first, as always — the dwarf inherits its frustum): rows and cells UNCHANGED at
31 / 2,928 (no new pose), anchors 3,920 → **4,416** (+496 = one `offhand` per serf cell, 31 rows ×
16). minifig 3.39 → **3.15 MB**, dwarfknight 5.00 → **4.72 MB** — both SMALLER, because arms held
forward overlap the body and compress better than arms held out behind it. Only serf-body,
serf-mask and the manifest moved on either look; every knight and overlay sheet is byte-identical.
sha256 prefixes: `sprites/` serf-body `93a0f52e`, serf-mask `44ec9ab2`, manifest `cfb9891c`
(knight-body `592c48ec`, knight-mask `7bb93b79`, overlays `5786e0eb` UNCHANGED);
`sprites-dwarfknight/` serf-body `b9ef4bb1`, serf-mask `f78169cd`, manifest `6baa959a`
(knight-body `89a5cfb1`, knight-mask `06f0d563`, overlays `04658101` UNCHANGED).
**TUNABLES ADDED**: `FSC.MP_MAX_SPEED` 2 · `FSC.START.ALLY_SEP_FRAC` 0.42 / `ALLY_SEP_MIN` 19 /
`ALLY_BAND_STEP` 0.22 / `ALLY_BAND_PASSES` 6. Bake side: `ARM_OFF_BASE/SWING/OUT`, `armOutR`,
the `offhand` anchor. Render side: `GOOD_HAND_DROP` 0.12 (× the good's own height) +
`GSPR.hOf`. Plan deviations **16** (allied starts) and **17** (co-op speed ceiling).
**SHOTS**: `node tools/_fs_b5_shots.cjs` (29/29) → `shots/fs_b5_{coop_allies,mp_speed,
roads_narrow,carry_hands_dwarfknight,carry_hands_minifig,tool_swing_dwarf,tool_swing_minifig}.png`
+ `fs_b5_roads_narrow_before.png`. The roads BEFORE plate cannot be produced by the shipping
build (the width is a module constant), so the script takes it under `FS_B5_BEFORE=1` against a
tree with the old constants — which is how the shipped pair was made; every ordinary run writes
the AFTER plate and asserts its width.
**KNOWN / DEFERRED**: a load held out in front projects HIGH from behind the settler and LOW from
in front, so the good rides between 0.24 and 0.54 world units through a camera orbit — that is the
honest projection of the pose and the good stays on the hands the sheet draws, but a shallower
carry angle would tighten it; the ally band's floor (19) is what decides on small and medium
boards, so `ALLY_SEP_FRAC` only bites on large; the ore-budget spread widens on small/medium (see
item 1); and the work swing still reads more "arm out to the side" than "hammer overhead" at the
front azimuths, which is batch #4's deliberate `armOut` splay, not a regression.

---

## 🎵 THE USER'S OWN SONG IS THE BUILT-IN BGM (2026-08-03)

The default background music is now the user's OWN ORIGINAL COMPOSITION, "Castle Kruzer"
(`assets/farmstead/music/castlekruzer-theme.mp3`, 5.28 MB / 5:55, from
`Downloads/CastleKruzer.mp3` — same ownership standing as the user's Tripo-generated
models, commit-safe). It replaces `02-settlers.ogg` + `02-settlers.mid`, which are **DELETED
from the repo** — those were rendered from the original Settlers-1 MIDI, and CLAUDE.md's own
Farmstead rule is that the original's mechanics were recovered as facts but "never code/art/
audio from it"; a soundtrack derived from the original's own MIDI is exactly the audio that
rule forbids, and the game (now Castle Kruzer, public-facing) should not ship it.
- **LAZY LOAD, unchanged contract otherwise**: `fs-audio.js`'s `ensureBuiltinTheme()` used to
  fire from both `unlock()` (every gesture, including idle title-screen taps) and `init()`
  (page boot) — eagerly fetching the file before gameplay ever starts. Both eager calls are
  removed; the ONLY place that triggers the fetch now is `startMusicNodes()` (called from
  `onGameStart()`), so the 5.3MB file is requested only once actual gameplay begins. Measured:
  boot-time network cost for the theme went from 5,539,047 bytes fetched at page load to
  **0 bytes** until `onGameStart()` fires; title screen and boot pay nothing. A slow/failed
  fetch still degrades silently to the synth fallback (unchanged behavior) — no pageerrors, no
  stuck loading state.
- Looping (`BufferSourceNode.loop = true`), the file/synth/theme source abstraction, the
  IndexedDB custom-music override (still wins over the built-in; `clearCustomMusic()` still
  falls back to the theme, not to synth, once it has decoded), `musicOff`/`fs_music_off`,
  `MUSIC_LEVEL`, `duckMusic` on attack horns, and the in-game-only `onGameStart`/`onGameEnd`
  gating are all UNCHANGED — this was a source swap + a load-timing fix, not a rewrite.
  `musicInfo().name` now reads "Castle Kruzer (theme)".
  Verified: `node tools/_verify-farmstead-polish.cjs` **73/73** (grew from 68 — added lazy-load-
  at-boot, lazy-load-at-unlock, fetched-after-onGameStart, and no-Settlers-file-requested
  checks; 3 pre-existing stale assertions from an earlier synth-default era were also fixed to
  match the shipped theme-by-default behavior) + `node tools/_verify-farmstead-ui.cjs`
  **149/149**, 0 page errors both. No flakes this run (the suite's own doc notes a known
  custom-music-after-reload flake and an attack-horn-ducks-music timing flake — neither
  reproduced).

---


# 🏰 CASTLE KRUZER — SAVE A CO-OP GAME, HOST IT AGAIN LATER (2026-08-05)

User: *"in castle kruzer we need the ability in a co-op game for the host to save the game and
then at a future time host a game from that saved file that another person can then join."*
Files: `assets/farmstead/fs-{sim,net,ui}.js`, `castlekruzer.html`, `tools/_fs_harness.cjs`,
`tools/_verify-farmstead-mp.cjs` (127 → **165**), new `tools/_ck_rehost_shots.cjs`.

## The gap was the SEAT, not the snapshot
A mid-game joiner already receives the whole world (mp §9), and a save already serializes all of
it. What a save cannot carry forward is that **seat 1 was OCCUPIED when the file was written**.
Open it again and that seat has to come back genuinely EMPTY — otherwise `onPeerFrame`'s "only
into an EMPTY seat" rule refuses the newcomer.
**It turned out the world side of that was free, and knowing WHY is the load-bearing part:
nothing in `G` stores a peer's name, id or socket.** A seat is only ever an index into
`G.seats`; the partner's identity lives entirely in fs-net's `S` (`peerPid`/`peerSockId`/
`peerName`), which `FSNet.host()` already reset on `peerPid`/`peerSockId`. So the whole seat
lifecycle reduces to two things:
1. **`S.peerName` was NOT being cleared** — the one piece of stale identity that survived a
   rehost and could have labelled the newcomer as whoever played last. Now cleared with the rest.
2. **The seat→player MAP has to be re-derived**, and that is `FSSim.seatForHost(G, mode)` over the
   pure `FSSim.coopSeating(G, mode)`. Deliberately in the SIM: the suites can prove it without a
   browser, and both machines derive the same world from the same bytes.
   - The host takes **`G.seats[0]`**, not "player 0" — a guest who carried on solo after their
     host quit has `seats [p,p]` (`FSNet.detach`), so `seats[0]` really is their own kingdom and
     not the one that left. Rehosting THAT save separate seats the newcomer onto player 0, the
     original host's kingdom. Falls back to the first living non-AI player if seat 0 is gone.
   - `shared` → `[hostP, hostP]`, always available, **including from a plain solo save**.
   - `separate` → `[hostP, otherHuman]`; the arriving player inherits that kingdom whole.
   - Both human seats are forced onto **the same team**, or a separate-kingdoms room would let
     two allies besiege each other.
   - **Timing is the invariant**: seats are settled at LOAD time, before the room can hand the
     world to anybody. Changing them after a partner is seated would re-route their commands
     under them. Safe by construction — `FSNet.host`'s `.then` body (installHook → startWorld →
     netSeq → startTimer) is ONE synchronous turn, and `onMessage` only ever runs from a socket
     callback, so no `hello` can interleave.

## Lockstep across the boundary
The guest receives the host's serialized `G` verbatim, so tick, `rngState`, `cmdQueue`, `seats`
and every structure `deserialize` rebuilds (`map.bldFoot`, `FSMap.bind`, the `invPrio`/`cons`
backfills) all cross the boundary as bytes. **The one thing that does NOT is the wire's sequence
counter**, and that is the trap this codebase has hit before. `FSNet.host` used to set
`S.netSeq = 1`; a save carries `G.cmdSeq` AND any commands still queued ahead of its tick, each
stamped with the PREVIOUS session's sequence. Commands sort by `(t, by, seq)` — a tie there is
the one place two machines could legally disagree about order — so `FSSim.seqFloor(G)` returns
`max(cmdSeq, max(queued seq)+1)` and the room simply never creates one. It is applied AFTER
`startWorld` (the world has to exist first) and **never goes down**: a guest dedupes the commands
it buffered during a transfer with `seq >= snapshotSeq`, so a rewound counter would silently
replay or swallow orders.
`cmdSeq` itself is NOT in `FSSim.hash` (checked — the hash mixes `tick`/`nextId`/`routeGen`), and
host and guest already drift on it in ordinary play, so it is the ORDERING that had to be
protected, not the value.
**EVIDENCE**: a rehosted separate-kingdoms room run **2400 ticks** — `checkpoints ≥ 20` real
sync-hash comparisons, `desyncs 0`, `resyncs 0`, host and guest hash identical at the end — then
saved and rehosted AGAIN with a third person joining (generation 2, still identical).

## Solo → co-op: honest, not invented
A solo save has one human kingdom. **Shared works naturally** (both seats command player 0, and
the resumed world is byte-identical to what was saved — asserted on tick AND hash).
**Separate is refused**, with the reason on screen: *"that save has only one player kingdom —
host it as a shared kingdom instead"*. The Separate button is `disabled` on that row with the
sentence under it, so the refusal happens before anyone taps. No kingdom is invented mid-game and
nobody is handed an AI's — `coopSeating` skips `isAI` and `eliminated` players outright.

## Never a fresh world wearing a restored world's clothes
Every refusal happens in `hostSavedRoom` BEFORE `FSNet.host` is called, so a player never watches
an invite link appear for a game that cannot start. `startWorld`'s save branch is the defensive
half: if the bytes will not load it creates **NO world at all** and says so, and the caller sees a
missing `G` and closes the room. Foreign / unparseable / wrong-version / structurally-broken saves
are refused exactly as before (`FSSim.describeSave` never throws; `deserialize` still does, and is
still wrapped).

## The rest of it
- **`FSSim.describeSave(str)`** — identity + co-op eligibility off a save FILE without building a
  world (parses the doc, ignores the packed map). Feeds the picker's identity line and the greying.
  `FSSim.playedLabel(tick)` turns ticks into "1h 12m in".
- **UI, iPad-first**: a "📂 Host a saved kingdom" button under JOIN discloses a list of every
  saved slot — *"Small · separate kingdoms · 2 kingdoms + 1 rival · 4m in · 8/5/2026, 8:32 AM"* —
  with 🤝 Shared / 🏰🏰 Separate per row. 44px targets, 390px and desktop, and it re-renders on
  `backToTitle` so it can never show hour-old slots. Skin language only (parchment leaf on the oak
  panel, `.fs-btn` stone). The in-game save sheet got the same identity lines.
- **`FSNet.hostReplaceWorld(g)`** — the host loads a save WHILE hosting: the room, code and invite
  link all survive and the partner is handed the new kingdom as a normal chunked snapshot
  (`why:"rehost"` → *"Your partner opened a saved kingdom."*). Deliberately bypasses the repair
  BACKOFF — this is a player action, not a symptom. Wired into a NEW single load path
  `loadWorld()` in the page (used by `__FS__.load`, `loadState`, the sheet and title Continue),
  because a host that swaps its own world silently leaves two different games on one wire until a
  checkpoint notices, and the FSUI sheet must not be the only route that gets it right.
- **A CO-OP AUTOSAVE SLOT**: a host in a live room autosaves to `fs_save_coop`, not `fs_save_auto`
  (guests still never autosave — the host owns persistence). A dropped connection mid-session must
  not cost the kingdom, and the family's solo evening must not quietly eat the co-op one. Asserted
  both ways with a sentinel. `Continue your kingdom` still reads `auto`.
- The world resumes at the SAVE'S OWN SPEED, clamped to `FSC.MP_MAX_SPEED`.

## Suites — all nine green, 1112 checks
world **93** · transport **138** · economy **107** · visuals **205** · visual **60** ·
military **124** · **mp 165** (+38) · ui **149** · polish **73**. Plus
`node tools/_ck_rehost_shots.cjs` **8/8**.
**A LATENT FLAKE THE LONGER RUN EXPOSED, fixed in the harness rather than papered over**: the
page's activity beacon posts to `/.netlify/functions/activity` — **same origin**, so it sails past
the off-origin block and the static test server 404s it. That 404 is console noise
indistinguishable from a page fault, and it only appears once a run lasts long enough for the
beacon's flush to fire, which made "0 page errors" a coin flip in any suite. There is no functions
backend in the harness by design, so it is now answered with a 204.
**TEST BUGS worth remembering** (both mine, both cost a run): `FS.toTitle()` NULLS `G`, so a
snapshot taken after it reads −1 — read the tick and hash first; and `__FS__.load` is not the UI's
load path, so a check written against the raw hook proved nothing about what the sheet does (the
fix was to give the page ONE load path rather than to test the other one).
`shots/` is gitignored, so `_ck_rehost_shots.cjs` — not the suite — regenerates the plates, and
every plate ASSERTS what its filename claims before it is written (including that the picker is
actually IN FRAME: the first desktop plate was a screenshot of the new-game form above it).
Shots: `shots/ck_rehost_{savelist,savelist_mobile,hostflow,guest_inherited}.png`; the suite keeps
its own evidence under `farmstead_rehost_*`.
**KNOWN / DEFERRED**: a rehosted room opens at the save's speed, so a game saved while PAUSED
comes back paused (honest, and the speed rail is right there); the picker lists slots from THIS
device only, since saves are `localStorage` and always have been; and a save older than the
current `FSC.VERSION` is still refused outright rather than migrated.

---

# 🌾 THE FARMSTEAD RE-SKIN (2026-08-05)

The user brought a redesign of index.html built by Claude Design and asked for it across
Bucky. Warm cream `#f4f1e8` + pine green `#3f5c46` + clay `#b8552f`, **Source Sans 3** body
with **Fraunces** as the display serif (greeting, wordmark, dad joke), SVG line icons
replacing the emoji nav, and the bottom bar back to **ONE row** of twelve.

## Why adopting it was safe
The dropped file was a whole 11,090-line copy of index.html — the same trap as the stale
`story-local` branch. It was diffed against main BEFORE anything was copied: **75 changed
lines in 6 hunks**, and every recent feature marker (activity beacon, news topics, meals/AI
nav areas, chore rota, side rail) present at identical counts. A surgical re-skin, not a
fork. Implemented as a self-contained `<style id="farmstead-theme">` OVERRIDE block plus a
`NAV_PATHS` map — which is exactly what made it portable to the other five pages verbatim.

## Three real defects found by LOOKING, not by the suites
1. **"Chores" ellipsised to "Cho…"** — twelve areas in one row is 27.8px a button at 390px.
   Fixed with a `max-width:460px` rule giving the row its gutters back (gap 1px, padding 3px,
   label 8px) → 31.1px, which is what the eleven-area profiles already fit cleanly. Clean at
   360px too.
2. **The desktop rail was a navy→green gradient** on all five propagated pages: `#0d3d76` is
   a HARDCODED first stop that redefining `--navy` cannot reach. The porting agent's own
   check ("background contains no rgb(35,51,87)") passed straight over it, because that is a
   *different* navy. Caught by rendering every page and walking the DOM for any element still
   PAINTING a navy computed value — `scratchpad/coloraudit.cjs`, the reliable way to ask
   "what won the cascade". Root-fixed to `#4a6b52`.
3. **The active nav pill** was pale-sage-with-dark-text on the five pages vs index.html's
   solid green pill with cream text. Normalized.
Also fixed: index.html's OWN desktop rail was the last place in the app still rendering emoji.

## Suite restaging, all dated in place
`_verify-chore-care.cjs` asserted "two rows / buttons ≥60px" — that described the PREVIOUS
design, so it is superseded, not weakened: it now asserts ONE row, **zero clipped labels**
(the check that caught defect 1), and a tappable floor. `_verify-activity.cjs` had the same
two-row assumption (`navRows === 6` → `12`).

## A PRE-EXISTING failure this uncovered, unrelated to the re-skin
`_verify-fitness.cjs` was failing on clean main — proven by running it against a reverted
index.html before touching anything. Copying Eleanor's plan to everyone (2026-08-03) gave
Wednesday an 11:08 workout and Friday 11:28, outside the 9:00–11:00 `FIT_BAND`. **A latent,
day-of-the-week-dependent failure** that only shows on Wed/Fri. The plan is the intent, so
the band moved to 9:00–12:00 — in the product (`FIT_BAND`) as well as the suite, since the
builder's meter was painting two real training days amber for being what Dad wrote.

Battery green: chore-care 49 · news 200 · fitness 253 · activity 147 · health 208 ·
beacon-safety 90. Shots: `shots/skin_*.png` (six pages, phone + desktop).

---
