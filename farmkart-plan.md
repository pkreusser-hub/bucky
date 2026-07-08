# 🏁 FARM KART — architecture & build plan (authored by Fable 5, 2026-07-07)

This document is the SPEC for finishing Farm Kart. It is written to be executed by **Opus 4.8
agents** stage by stage, with the user playtesting between stages. Read this whole file plus
`farmkart-physics-notes.md` (real Mario Kart Wii mechanisms, MIT-licensed Kinoko reference)
before touching code. The current prototype is `farmkart.html` — WORKING and feel-approved by
the user; treat its physics core and TUNE-panel system as sacred. UNTRACKED by design: never
commit/push any farmkart file until the user says the game is mature enough (farm3d precedent).

## Non-negotiable working rules (from the project's hard-won lessons)
- THE GAME LIVES OR DIES BY RACING FEEL (user's words). Never regress feel for a feature. Any
  new physics-adjacent constant goes in TUNE with a slider + range; defaults must preserve the
  user's current tune. `window.__KART__` hook stays (test + tuning aid).
- Every agent prompt gets: "do ALL work yourself with Read/Edit/Write/Bash; do NOT use the
  Agent tool". Check `git diff --stat` (and untracked file mtimes) on completion before
  trusting any report. Fable/Opus reviews evidence (screenshots + numbers), not prose.
- Headless verify recipe: puppeteer-core from tools/node_modules (channel "chrome", headless
  "new"), http-server on 889x, REAL key events, screenshots reviewed visually. ALWAYS include
  a deviceScaleFactor:1.5 pass (the dPR canvas-crop bug was invisible at dPR 1). Remember
  hidden tabs suspend rAF (test with headless pages, not the Launch preview panel).
- Multiplayer tests: agents' sandboxes often can't resolve Playroom DNS — use two real headless
  browser PROCESSES against the live backend when possible (bistro lesson), block playroom CDN
  to get deterministic solo-fallback screenshots.
- One stage per agent run; user previews and approves before the next stage begins.

## Current state (what exists in farmkart.html)
- MKW-mechanism physics: fixed-angular-step grip (gripRate/driftGripRate), ramp-then-taper turn
  authority (turnPeakSpeed/turnHighFrac), target-seeking clamped drift angle (driftAngle*,
  signed, dir baked in), MT points (mtChargeBase/Bonus, tier1/tier2=2x, SMT boost 3x duration),
  step boost (boostMult/boostAccel/boostT1, smooth decay). See physics notes + code comments.
- Flat 18-wide ribbon track from `CENTERLINE` waypoints (scaled 1.5x), grass slowdown, soft
  walls, lap line w/ 5s debounce, best-lap localStorage, chase cam (camLag heading smoothing,
  camStiff position stiffness, drift swing = driftAngle*0.5, FOV speed read), keyboard +
  gamepad, TUNE panel (fk_tune_v2) with reset/copy, R reset (snaps camera).
- Kart = red box + cream capsule. No wheels yet, by user instruction.

## Stage K1 — race format + multiplayer-shaped state (do FIRST)
Restructure BEFORE adding features (bistro lesson: G-state discipline from day one made MP a
thin layer instead of a rewrite):
- All race-mutable state into one `G` object: `G.players` keyed by player id ("local" solo),
  each = {pos, theta, v, steer, drift, driftAngle, boost, mt, lap, checkpoint, progressS,
  finished, itemHeld, spinT}. Local-only concerns (camera, meshes, input, tune) stay outside G.
  The physics step becomes `stepKart(p, inp, dt)` operating on a player entry — pure-ish,
  no globals beyond TUNE/track. Solo behavior must be pixel-identical after refactor (verify
  with the fk_test2.mjs suite; adapt paths to state via G.players.local).
- Race phase machine: `G.phase = "menu" | "countdown" | "racing" | "finished"`. Menu = press
  Enter/tap to start (placeholder for future lobby). Countdown: karts locked on a 2x2 GRID
  behind the start line (grid slots computed from centerline tangent), big 3-2-1-GO overlay
  (~0.9s per beat), WebAudio synth beeps (bistro's synth-sound pattern, no audio files),
  holding throttle during "2" for a start-boost (MKW-style: release window ±0.3s of GO =
  small boost, too early = brief stall).
- Laps & anti-cheat progress: precompute arc-length parameter s over the centerline. Each
  frame update p.progressS = nearest-point s (window-search around last s for perf/stability).
  4 checkpoints at s = 0, 25%, 50%, 75%; a lap counts only after passing all checkpoints in
  order then crossing the finish. Race = `G.lapsTotal` (default 3, TUNE-able or track data).
  Wrong-way indicator when s regresses persistently >2s ("⟲ TURN AROUND").
- Finish: per-player finish time + place; results overlay (place, total time, best lap) with
  restart. HUD adds: position (computed from laps+progressS), lap n/N, race clock.
- Verify: countdown locks input, early-throttle stall + timed-release boost, full 3-lap race
  headless (drive the centerline programmatically via injected inputs), checkpoint skipping
  does NOT count a lap (teleport test), results overlay, dPR 1.5 shot, 0 pageerrors.

## Stage K2 — terrain height
- Track data gains per-point elevation `y` (CENTERLINE points become {x,z,y}); centerline
  resampled as a Catmull-Rom spline in 3D. Ribbon mesh gets per-vertex y; curbs follow.
- ONE height authority: `sampleHeight(x, z)` = smooth blend of (a) track surface height (from
  nearest centerline point, valid within width/2 + blend margin) and (b) base ground = gentle
  value-noise hills (amplitude TUNE.groundHillAmp default ~2.5, wavelength ~60) so off-track
  isn't a flat void. Ground plane mesh becomes a displaced grid (segment size ~4 over the
  track's bounding box + margin).
- Kart: y = sampleHeight(pos); mesh pitch/roll aligned to surface normal (sample 3 nearby
  points, smooth the normal ~10/s to avoid jitter). FEEL: slope acceleration — add
  `TUNE.slopeAccel` (default ~6) * dot(downhill, forward) to speed each frame; uphill slows,
  downhill rewards. Downhill+drift should feel great; verify no oscillation at rest on a slope
  (deadzone below ~4° or at speed < 1).
- Camera: camHeight becomes height ABOVE the kart's y; lookAt y = kart y + 1. Verify camera
  never clips into terrain on the test hill (raise if sampleHeight at camera xz > camera y).
- Default track: give the existing circuit modest elevation (rolling straight ~+2, hairpin on
  a hill +4, chicane descending) so the user feels it immediately.
- Verify: kart y tracks surface on/off track, mesh tilts on slopes, downhill measurably faster
  than uphill (numbers), camera above ground everywhere on a full programmatic lap, dPR pass.

## Stage K2.5 — AIRBORNE (user request 2026-07-07, ships WITH K3)
The kart must feel airborne off jumps and steep crests (today y snaps to the surface):
- Kart gains vertical state: `p.y`, `p.vy`, `p.airborne`. Grounded: y follows sampleHeight as
  now, and track vertical FOLLOW velocity implicitly. LAUNCH: when grounded and the surface
  falls away faster than the kart's vertical follow can track (new groundY < y − ~0.15) OR a
  crest converts slope into upward motion at speed, go airborne with vy seeded from the
  terrain's dY/dt under the kart (slope · speed, so fast crests = real jump arcs).
- Airborne physics: vy −= TUNE.gravity (default ~28) · dt; NO throttle accel, NO slope accel,
  steering authority × TUNE.airControl (~0.3), grip = TUNE.airGrip (~0.2 rad/s — the MKW
  airborne 0.2°/frame from the physics notes), drift charge frozen (drift state persists so a
  held drift survives a small hop, MKW-style). Land when y ≤ groundY: y=groundY, vy=0, small
  squash-and-stretch on the kart mesh (~0.15s) + soft landing thump (WebAudio).
- Camera: smooth the camera's vertical tracking (~4/s lerp on the kart-y input) so jumps read
  as FLOAT — the kart rises in frame while the camera eases after it. HUD surface tag shows
  ✈ AIR while airborne.
- TUNE additions (sliders): gravity, airControl, airGrip. Landing squash time can be const.
- Verify: launch off the post-hairpin descent at speed → airborne=true with a measurable arc
  (sample y vs groundY over the flight), no throttle gain mid-air, drift survives a hop,
  landing squash fires once, camera never snaps (per-frame camera-y delta bounded), parked
  kart on a slope still never launches. The full prior suite stays green.

## Stage K3 — track data + 3D level editor
- Extract track building into `assets/farmkart-track.js` (script-tag global, like dadjokes.js):
  `window.FK_TRACK = { buildRibbonGeometry(trackData), sampleTrack(...), resample(...),
  DEFAULT_TRACK }`. Game and editor BOTH load it — no duplicated geometry code (bistro editor's
  keep-in-sync pain, avoided).
- Track data format v1 (versioned!): `{ v:1, name, width, laps, points:[{x,z,y}...],
  itemRows:[sFraction...], gridSide:"left"|"right" }`. Game boots DEFAULT_TRACK; a track picker
  on the menu lists saved tracks from localStorage `fk_tracks_v1` (map id->track) + default.
- `farmkart-editor.html` (dad's tool, direct URL, not linked anywhere):
  - three.js orbit view (drag rotate, wheel zoom, RMB pan) of the live ribbon built from the
    SAME shared module, updating on every edit.
  - Control points as draggable spheres (raycast pick; drag moves in XZ plane; hold Shift+drag
    = elevation Y). Click empty track to INSERT a point on the nearest segment; Delete key
    removes selected (min 8 points). Per-point readout panel.
  - Item rows: toggle mode drops an item-row marker at a clicked spot on the ribbon (stored as
    s-fraction). Start line always at s=0 (point 0); "reverse direction" button.
  - Validation live: min corner radius vs width/2 (warn bowtie pinch, the hairpin lesson),
    self-intersection check (segment AABB sweep), min point spacing.
  - Save (localStorage), name field, 📋 export JSON / paste-import (how the user shares tracks
    into chat for help), ▶ TEST button → opens farmkart.html?track=<id> in a new tab.
- Verify: edit→save→game loads the edited track (?track=), insert/delete/elevation round-trip,
  validation catches a deliberate bowtie, export/import round-trip, editor + game screenshots.

## K2.5 playtest fixes (user feedback 2026-07-07, fix BEFORE K4)
1. SQUASH SPAM: landing squash/thump fires during normal driving — micro launch/land cycles
   from terrain curvature. Gate landing EFFECTS (squash, thump) behind minimum airtime
   (~0.25s) AND/OR minimum impact vy; micro-hops still physically happen but are silent and
   invisible. Also consider a small hysteresis margin on the launch condition (reqAccel <
   -gravity*1.1) so spline noise doesn't flicker the airborne state.
2. STAIRS ON SLOPES: sampleHeight on-track returns the NEAREST centerline sample's y —
   piecewise-constant height = stair-stepping while climbing. Interpolate: project the query
   point onto the segment between the two nearest samples and lerp their y (and use the same
   interpolation for the terrain-follow vy). Verify: kart y along a full climb is monotonic
   and C0-smooth (max per-frame y step at constant speed bounded by slope*speed*dt*1.5), and
   the mesh no longer visibly steps.
3. GRAVITY: default 28 too heavy off jumps (user). Default -> 18. (Slider already exists.)

## Stage K3.5 — AI OPPONENT (user request, build WITH K4 as its test partner)
A bot is a normal G.players entry stepped by the SAME stepKart with synthesized inputs (this
keeps physics honest and makes bots host-runnable in MP):
- Racing line: pure-pursuit on the centerline spline — steer toward a lookahead point
  (TUNE.botLookahead ~8 + speed*0.25) on the centerline; target speed from upcoming curvature
  (sample max curvature over the next ~25u of spline; slow to sqrt(latAccelLimit/curvature),
  TUNE.botCornerGrip ~0.9), full throttle otherwise; brake input when over target.
- Drifting: v1 bots do NOT drift (clean line is enough to race against). They DO use the
  start boost with slight timing randomness.
- Rubber-band: TUNE.botSkill (0..1, slider, default 0.75) scales target speed; a light
  catch-up factor (+-6% speed when >25u behind/ahead of the human) keeps family races close.
- Bots pick up items and use them on a simple policy: offensive items when a target is within
  ~30u ahead, hay/boost after a random 1-3s hold. Bots can be hit/spun like anyone.
- Menu: "+ 🤖 BOT" toggle (0-3 bots) on the race menu; bots get grid slots, distinct kart
  colors (green/blue/yellow), names ("Hay Bill", "Cluck Norris", "Baler Swift"), full lap/
  place tracking through the existing checkpoint system.
- Verify: bot completes 3 clean laps unassisted on the default track (no wall-stuck, laps
  count via checkpoints), finishes with a plausible time (within 2x of a scripted optimal),
  rubber-band measurably engages, bot appears in results with its place.

## Stage K4 — power-ups (solo-testable before MP)
- Item boxes: at each itemRow s-fraction, 3 boxes across the track width; spinning translucent
  cubes with ? decal (canvas texture); pickup within radius → box hides, respawns after 3s
  (per-box timer). Driving through while holding an item does nothing.
- MVP items (farm-themed MK trio), one held at a time, HUD slot bottom-right + item button
  (X / gamepad B / tap):
  1. ⚡ ROOSTER BOOST — instant tier-2-equivalent boost (reuse boost pipeline).
  2. 🍅 TOMATO — projectile: fires forward at speed+18, follows terrain height, lives 4s,
     bounces off soft walls once; on kart hit → spin-out.
  3. 🌾 HAY BALE — drops behind the kart; persistent obstacle (max 6 alive, oldest despawns);
     hit → spin-out.
- Spin-out state (shared by hazards): p.spinT = 1.0s — input ignored, kart spins 720° visually,
  speed *= 0.35 once, drift/boost cancelled. Gentle, readable, kid-friendly.
- Random roll weighted by race position once MP exists; solo = uniform. Roll animation in the
  HUD slot (cycling icons ~0.8s) before it settles — the anticipation IS the fun.
- Physics interactions live in the same fixed-step update; projectiles use the flying-item
  pattern from bistro (advance, sample height, radius hit tests vs karts).
- Verify: pickup/respawn, each item's full flow with a stationary dummy kart entry in G.players
  (spawn a scripted second player server-side in the test), spin-out locks input exactly 1s,
  max-6 hay bales, HUD roll, dPR pass.

## Stage K5 — multiplayer (Playroom, up to 4)
Model: **each client is authoritative over its OWN kart** (racing is latency-sensitive; bistro
already proved client-owned movement + host-owned events works for this family):
- Reuse bistro's stack verbatim where possible: playroomkit@0.0.96 UMD, skipLobby:true, OUR
  #r=<code> hash parsed+cleared BEFORE insertCoin (Playroom's own #r format conflicts — see
  CLAUDE.md), roomCode explicit, insertCoin-failure → solo fallback, hidden-tab heartbeat
  (250ms setInterval) for the HOST race sim, blur/visibility key-clear.
- Per-player published state at 15-20Hz + on events: {x, z, theta, driftAngle, speed, lap,
  checkpoint, progressS, spinT, itemHeld(display only), name, chefModel}. Remote karts render
  via interpolation buffer (~120ms delay, lerp pos/theta; snap if error > 8 units).
- HOST authoritative over: phase/countdown start time (clock-delta corrected like bistro),
  item box states, item ROLLS (weighted by position), projectile/hazard spawns + hit
  resolution (clients send fire events with seq numbers, exactly-once like bistro actSeq;
  host declares spin-outs; the spun player's client applies it to their own kart), final
  standings. Ties break by host receipt order — fine for family scale.
- Kart-vs-kart collision: soft radial push resolved LOCALLY on each client against interpolated
  remotes (cheap, no authority needed, feels fine at family latency).
- 2x2 start grid by join order; seat colors/chef identity: reuse bucky/otis/boots pick from a
  simple pre-race picker (blocky characters as capsule recolors for now — GLB drivers are a
  later polish stage, NOT here).
- Family lobby (games.html JOIN cards + Firestore lobbies_<familyKey>) is a LAST substage,
  copied from bistro's lobby shim; solo/local must never touch Firestore.
- Verify: two real headless browsers vs live Playroom — synced countdown, both karts visible
  and interpolating, item hit spins the remote kart, laps/places consistent on both screens,
  host-hidden-tab keeps racing, guest disconnect cleanup. Plus solo-fallback screenshot with
  playroom blocked.

## Stage K7 — collisions, walls/corridor, overlap fix, boost pads (user request 2026-07-08)
Four related features. Touches farmkart.html, assets/farmkart-track.js, farmkart-editor.html.

1. **KART-VS-KART COLLISION** (no clipping): each frame, a local separation pass over ALL karts
   present locally (own + bots + interpolated remotes). If XZ distance < `kartRadius*2`
   (kartRadius ~0.9, TUNE), push the pair apart to just-touching (split the overlap; for
   remotes, push only OWN kart — you don't own theirs), and add a light momentum exchange
   along the collision normal so bumps read as bumps, not walls (elastic factor ~0.4, capped
   so a bump can't fling you off-track). Soft "bonk" WebAudio on a fresh contact (debounced).
   O(n²) is fine (≤4 + bots). MP: still local-authoritative on own kart (bistro/plan model);
   no new synced state. Verify: two karts driven into each other never overlap (<2r), separate
   cleanly, a bump nudges both, no jitter when resting side by side, does not launch anyone.

2. **WALLS / DRIVABLE CORRIDOR** (grass room, but no course-cutting): replace the fixed
   `half+14` soft wall with a tunable corridor. Per-TRACK `wallMargin` (grass width beyond the
   road edge; DEFAULT ~7 — enough grass to run wide, not enough to skip a corner) editable in
   the editor, TUNE `wallMargin` fallback. Bounds test uses distance to the NEAREST centerline
   (union of corridors) so a self-overlap is automatically in-bounds on either branch. Behavior:
   inside the road = full grip; road edge..edge+margin = grass (existing slowdown); AT
   edge+margin = a FIRM wall — strong corrective push + heavy speed scrub, effectively
   un-passable so players cannot muscle across the grass to cut the course (tune so you bounce,
   never tunnel). Render a VISIBLE low fence/berm ribbon along BOTH corridor edges (chevron
   posts or a striped curb-wall, cheap instanced/merged geometry following the offset edges;
   height-follows terrain). At self-overlaps the two corridors merge — the wall must have a GAP
   where corridors overlap (only draw a wall post if that post's position is outside every
   OTHER segment's corridor), else a wall would block the legal crossing.
   EDITOR: `wallMargin` numeric field + a toggle to VISUALIZE the corridor bounds (two offset
   outlines showing where the walls sit) so the user tunes grass room and sees the drivable area.

3. **TRACK-OVERLAP BIG-JUMP FIX** (self-crossing tracks): ROOT CAUSE — `sampleHeight`/
   `FK_TRACK.nearestOnCenter` pick the nearest centerline point in XZ ONLY; at a self-crossing
   with the two branches at different elevations, the nearest point flips between the low and
   high road as you cross, so `trackY` jumps in one frame and the airborne launch check
   (reqAccel) spikes → the "big jump" the user hit. FIX = height-AWARE sampling: add
   `FK_TRACK.nearestOnCenterAtY(sampled, x, z, currentY)` that, among centerline candidates near
   in XZ (within ~one road-width), prefers the branch whose interpolated y is closest to
   currentY — i.e. the kart stays on the level it's on. The kart's OWN height follow + tilt +
   launch check use the y-aware version seeded with `p.y`; context-free callers (camera ground
   clamp, etc.) keep the plain nearest. This removes the height discontinuity → no spurious
   launch through a crossing. Editor validation: STOP warning self-intersection as an error —
   overlaps are now legal; instead show an "overlap OK (bridge)" note. (Ribbon rendering of a
   true over/under is imperfect for now — acceptable; the fix targets the DRIVING jump. If cheap,
   lift the ribbon slightly at the higher branch so the crossing reads as a bridge.) Verify:
   build/scripted a self-crossing track (two branches, ~+6 elevation apart), drive the lower
   branch THROUGH the crossing → airborne stays false, kart y stays on the low branch (no jump),
   and driving the upper branch stays high. The K2.5 decline-bounce fix + jump behavior stay green.

4. **BOOST PADS** (drive over → boost): new per-track `boostPads:[{s, lane}]` (s = 0..1 lap
   fraction like itemRows; lane = -1..1 across the width, 0 center). FK_TRACK: add to the data
   format + sanitize (clamp s 0..1, lane -1..1) + reverse (s -> 1-s). Render glowing forward
   chevron arrows on the road surface (canvas-texture or merged tris, height-follows, subtle
   pulse). On drive-over (own or bot, within pad radius), grant a short boost via the existing
   boost pipeline (`boostPadT` ~0.6s at ~tier-1 strength, TUNE `boostPadStrength`) + whoosh +
   a little speed-line particle burst; a per-kart cooldown so one pad fires once per pass.
   EDITOR: a "boost pad" placement mode (like item rows) — click the ribbon to drop a pad at
   that s + lane; list with remove buttons; saved in the track. Bots benefit automatically.
   Verify: pad on the track, drive over it → boost engages once (cooldown blocks re-fire while
   standing on it), bot gets boosted crossing it, editor places + saves + game loads a pad.

Verification for all of K7: FULL prior suite green (regression), the four per-feature checks
above, dPR 1.5 pass on game + editor, 0 pageerrors. Screenshots: two karts bumping (not
clipped), the visible wall/corridor + a kart bounced off it, an overlap crossing driven with no
jump (kart y trace flat), a boost pad being crossed with the boost active, editor showing the
corridor visualization + a placed boost pad. Backup farmkart.html first.

## Stage K6 — first full race polish (the "stage 1 complete" bar)
- WebAudio synth sound set: countdown beeps, engine pitch vs speed (oscillator), drift
  scritch, MT charge tick + tier chimes, boost whoosh, item roll/fire/hit, finish fanfare
  (bistro's reactive-sound pattern: sounds react to G diffs so MP "just works").
- Results → "Race again" (host-driven in MP). Speed lines / dust particles at drift (cheap
  sprites). Best-lap per track id. Title screen with FARM KART sign (barn-sign style like
  bistro's). STILL no character GLBs / wheels unless the user asks — feel first, trappings last.

## Deferred / explicitly out of scope for now
AI opponents, farm3d real-terrain track, GLB character drivers, touch controls, host
migration, spectator, minimap. Do not build these without the user asking.

## Tuning workflow (unchanged, applies to every stage)
User plays → adjusts TUNE sliders → 📋 copy → pastes JSON → those become TUNE_DEFAULTS in the
same change that ships the next stage. Never overwrite the user's saved localStorage tune.
