# Farm Kart — the kart racer

`farmkart.html`, `farmkart-editor.html`, `assets/farmkart-track.js`,
`assets/farmkart-props.js` and the track/prop assets under `assets/farmkart/`.

Physics feel is the product here: the tune lives in `localStorage fk_tune_v2` and overrides
the baked defaults, which is why several bugs in this file could only be reproduced with the
user's own saved tune. Feel regressions are never acceptable.

> Split out of the single 12,800-line `CLAUDE.md` on 2026-08-16. Entries are verbatim and in
> their original order — the oldest at the top, the newest at the bottom. Later entries
> routinely correct earlier ones, so when two disagree, the lower one wins.

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
      BINARY FULL-LOCK (2026-07-09, user: analog drag was "too tricky" — "lets have it be
      full turning speed no matter how little or much you drag the touch"): pointermove now
      quantizes past a DEADZONE_PX=12 deadzone straight to touch.steer = ±1 (Math.sign(dx)),
      no proportional in-between; same slide-right=turn-right sign convention preserved.
      #steerKnob snaps to one of 3 positions (center / full-left / full-right at ±steerRangePx)
      instead of tracking the finger. Ring position/behavior unchanged.

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
- [x] CONCRETE TUNNELS (2026-07-10, user: "add the ability to put concrete tunnels ... manipulate
      them in the editor"): track.tunnels=[{id,tag,s,len,h,w}] — s=0..1 start fraction along the
      centerline ARC LENGTH (same convention as boostPads' `s`), len=world-unit span, h=optional
      inner clearance height (builder default 6), w=optional inner width (builder default
      trackWidth+3); sanitize validates/clamps and OMITS the key entirely when absent/empty (re-
      verified byte-identical sanitize output for tracks without tunnels). Shared builder
      FK_TRACK.buildTunnelMesh(sampled, tunnels, trackWidth, THREE, opts) sweeps a 9-point concrete
      arch profile (open bottom — walls + ceiling only, no floor) along the centerline in ~2.5u
      steps via an arc-length interpolation helper (mirrors buildFenceMesh's terrain-walk pattern);
      ends get a portal "bulge" (scaled-up profile within ~2.5u of each opening) so entrances read
      clearly. Seated on opts.heightFn(x,z) — game/editor pass sampleHeight/roadHeightAt so tunnels
      follow the ROAD height, not raw terrain (matches the fence heightFn convention). CONCRETE
      MATERIAL (design-review fix): the bore's interior faces get no directional light, so a plain
      grey MeshLambert fell back to the scene's ambient tint and read dark olive — same class of
      bug as [[gltf-linear-color-gotcha]]. Fix: MeshLambert color WHITE + vertexColors (per-vertex
      diffuse = warm concrete 0xa8a8a2; portal-ring vertices darkened ×0.78 for contrast) + an
      EMISSIVE lift 0x3e3e3c (≈ base × 0.37) so unlit interior faces still read mid-grey concrete.
      NOTE: when
      the default inner width (trackWidth+3) exceeds the default height (6), the semicircular-arch
      radius (=half-width) forces the straight side walls to clamp near 0 and the tube reads TALLER
      than the nominal h (observed ~13.7 high for an 18-wide road) — harmless (only over-satisfies
      camera clearance) but worth knowing before hand-tuning h/w on a track. GAME: rendered once at
      boot alongside fences (`TUNNEL_GROUP`, exposed on `__KART__` for tests); purely visual, no
      physics change — the existing corridor walls already constrain karts. EDITOR: new 🚇 tunnel
      mode mirrors the ⚡ boost-pad pattern (click the road → `addTunnelAt` drops one at the nearest
      centerline s, default len 18/h 6/w trackWidth+3) plus a tunnel list (select/delete) and, for
      the SELECTED tunnel, len/height/inner-width sliders that live-rebuild (110ms-throttled, same
      pattern as the P3 sculpt brush) the shared-builder preview mesh — byte-parity with the game.
      Persists automatically through the existing doSave()/sanitize()/cloud-sync path (no new cloud
      code needed). Verified (scratchpad fk_tunnels.cjs, cloud domains blocked throughout): 10
      pure-Node sanitize-regression checks (byte-identical DEFAULT_TRACK + wario-stadium sanitize
      vs the pre-change module loaded from `git show HEAD:...`, invalid entries dropped, valid
      fields round-trip, h/w omitted when unset) + 22 editor checks (add via click → 1 mesh, len/h
      sliders grow the bbox, delete clears the mesh, save→reload round-trips exact field values) +
      game checks (boot renders the 1 saved tunnel with a real bbox, kart drives through the
      span with finite/monotonic position — 0 collision weirdness since tunnels don't collide, a
      mid-span camera-position sample stays within the tunnel's lateral+vertical envelope, and both
      screenshots position-asserted before/inside the span) — 40/40 green, 0 pageerrors editor+game.
      Screenshots fk_tunnel_outside.png (approaching, grey portal against the grass) /
      fk_tunnel_inside.png (mid-bore, concrete walls + exit ahead) in the session scratchpad. TWO
      TEST GOTCHAS caught here: (1) game centerPts are uniform in CURVE PARAMETER, not arc length —
      converting a tunnel's s to a sample index via round(s*N) poses you PAST the tunnel on long
      straights; convert through arcS instead. (2) posing the "inside" screenshot at the arc
      midpoint of a wide (≈22u) tunnel puts the walls/arch OUTSIDE the 62° frustum near the exit —
      the frame shows only the opening and reads as open road; pose ~30% into the bore so walls +
      exit portal frame the shot. Regressions: tools/_verify-hud-defaults.cjs
      PASS, tools/_verify-items.cjs 24/24 (both boot the game fine with the new TUNNEL_GROUP code
      path; a second agent has unrelated concurrent farmkart.html changes in the working tree —
      confirmed via `git diff -- farmkart.html` that tunnels are the only hunk this task touched).
      Still LOCAL/untracked-in-spirit (farmkart.html itself is committed, but no push happened here).
- [x] TUNNEL PLAYTEST-FIX BATCH (2026-07-10, user playtest of the tunnel feature): three bugs.
      (1) EDITOR OBJECT-ADDER GREY SQUARES ("all the objects come in as big grey squares") — ROOT
      CAUSE found with a headless repro (holding one `.glb` request open forever via request
      interception, no response): the P6 prop preloader called `FK_loadProps(null,...)` ONCE for
      all 57 CC0 models via a single `Promise.all`, and `propCache`/`rebuildObjects()` only fired
      after EVERY one of the 57 settled. `GLTFLoader`'s `.load()` has no built-in request timeout,
      so a genuinely STALLED fetch (flaky wifi, a dropped connection, a CDN hiccup — anything short
      of an outright network error, which DOES call `onError` and resolve) never settles — the whole
      batch hangs forever, `propCache` never gets assigned, and EVERY placed object (even ones whose
      own model already downloaded fine) stays on the grey `0x99a0a8` placeholder box permanently.
      Confirmed: with `tree_default.glb` held open, `propStatus` froze at "56/57" and two already-
      placed unrelated props (barn, rock) stayed grey 8s+ later. FIX (farmkart-editor.html only —
      `assets/farmkart-props.js`'s shared `FK_loadProps` fn itself is untouched, still used by the
      game): the editor now calls `FK_loadProps([id],...)` ONCE PER MODEL, each raced against a 10s
      `Promise.race` timeout, merging into `propCache` and calling `rebuildObjects()` as each one
      lands — one stuck request now only leaves ITS OWN model greyed out (status shows "(N failed to
      load)") instead of wedging every other prop for the whole session.
      GREY-BOX FOLLOW-UP (2026-07-11, second report: "the grey object boxes are still a problem").
      Exhaustively re-tested the ABOVE per-model fix via real UI events (not shortcut calls) — click
      the 🧊 objects mode button, click the propCat dropdown, click a real prop button across 4
      categories (tree/building/rock/plant), click the canvas to place; also placed immediately at
      page load (before the 57-model preload settles) and reloaded a saved track with glb objects in
      both the editor AND the game. ALL of these paths rendered real models with zero placeholder
      boxes — the 2026-07-10 fix was correct and complete for the happy path (script:
      scratchpad fk_objects.cjs, 25/25). Two REAL gaps were found instead, neither a "grey forever"
      regression of the original bug but both genuine reliability gaps worth closing: (a) a model
      that GENUINELY fails (real timeout/404/parse error, not just a slow queue) was marked failed
      after exactly ONE 10s attempt with NO retry and no way to recover short of a full page reload —
      a transient hiccup (a brief OneDrive sync lock, an antivirus scan touching the file, a dev-
      server hiccup under the 57-request simultaneous burst) permanently greys that model's
      placements for the rest of the session; (b) `farmkart.html` (the GAME) never received the
      2026-07-10 fix at all — it still called `FK_loadProps(ids,...)` ONCE per track via a single
      `Promise.all`/`.then`, so if even one glb id a track references genuinely fails, NONE of that
      track's glb scenery ever renders in the game (worse than the editor: no placeholder shown
      either — the objects just silently never appear). FIX: (1) `farmkart-editor.html`'s per-model
      loader now retries up to 3 attempts (10s timeout each) before giving up, tracks failed ids in
      `propFailedIds`, and shows a "🔄 retry N failed models" button (`#propRetryBtn`, exposed on
      `window.__EDITOR__.propFailedIds`) that re-runs the same loader for just the failed set — no
      more silent permanent failures, and no full reload needed to recover from a transient blip.
      (2) `farmkart.html` ported the SAME per-model-independent-render pattern (own `_loadGlbWithRetry`
      helper, `_glbCache` exposed on `window.__KART__.glbPropCache`): each glb id loads on its own
      timeline and is added to the scene the moment ITS OWN model lands, so one stuck model in a
      track's object list no longer blocks every other prop on that track. TEST-BUG NOTE for future
      sessions: the first investigation pass surfaced 3 false failures that were bugs in the TEST
      HARNESS, not the product — worth remembering since they're easy traps: `a && b && c` in JS
      yields `undefined` (not `false`) when a non-Mesh `Object3D`/`Group`'s `.isMesh` short-circuits
      the chain, and `JSON.stringify`/puppeteer's structured-clone serialization silently DROPS
      `undefined`-valued object keys — always seed a boolean explicitly (`!!(...)`) when a check's
      result crosses an `evaluate()` boundary. `fk_tracks_v1` in localStorage is a MAP keyed by track
      id (`{[id]: track}`), not an array — seeding it as an array silently no-ops every lookup.
      `FK_TRACK.sanitize()` rejects (`return null`) any track with under 8 `points`, dropping the
      WHOLE track (including its `objects`) with no error surfaced to a test that doesn't check the
      return value. `loadById(id)` is a closure-local editor function, NOT exposed on
      `window.__EDITOR__` — the test hook only exposes `loadTrack(trackObject)`, which takes the
      track data directly. Regression fk_tunnels.cjs's stuck-request stall test now waits 32s (was
      12s) to stay past the new 3×10s retry ceiling before asserting the model is marked failed;
      fk_tunnels.cjs 65/65, fk_objects.cjs 25/25 (new, scratchpad), tools/_verify-items.cjs full
      pass, 0 pageerrors across every pass. (2) TUNNEL PLACEMENT WAS
      NOT START-AT-CLICK — `addTunnelAt` computed `s = bi/N` (nearest sample's INDEX fraction), but
      `buildTunnelMesh` treats `tn.s` as an ARC-LENGTH fraction (`startArc = s*trackLen`, walked via
      `arcS[]`). `centerPts` are sampled uniform in CURVE PARAMETER (`t=i/N`), not arc length, so on
      uneven curves `bi/N` and `arcS[bi]/L` diverge by tens of world units — confirmed via a diag
      script (click at z=90 landed the tunnel start at z=48.5). Fix: `s = arcS[bi]/L` — the tunnel
      now starts within one sample step of the actual click (re-verified: click z=90 -> start
      z=89.37). (3) WALLS DIDN'T REACH THE GROUND ON SLOPES/EMBANKMENTS — the arch profile's two
      wall-leg base points sat at `v=0` (road height, same for both legs since `ringAt`'s shared `y`
      comes from the CENTERLINE height only); on a sloped span the terrain drops away laterally
      beside the road while the base stayed pinned to centerline height, showing a gap/floating edge.
      Fix: `assets/farmkart-track.js`'s `profile()` now bottoms both legs at `TUNNEL_BURY_DEPTH=2.5`
      below the seat height (fence-post style — extends DOWN only, interior clearance/arch/wallH
      unchanged). Verified on wario-stadium's steepest span (Δy≈4.7 over ~30u): wall-base y <=
      roadY-2 at 3 sampled rings (20/50/80% through the span), both walls, exact vertex lookup via
      the mesh's raw position buffer (had to disambiguate top-vs-base — both share identical (x,z),
      only `v`/height differs — by taking the LOWEST-y vertex within a small XZ radius rather than
      nearest-XZ-any-y). Test suite `fk_tunnels.cjs` extended 40->63 checks (start-at-click distance
      assert, 57/57 prop-load + 0-placeholder assert after placing tree+barn, a dedicated stuck-
      request regression proving the root-cause fix, 3-ring buried-wall assert on a sloped builtin
      track) — 63/63 green, 0 pageerrors. New screenshots `fk_objects_fixed.png` (tree+barn render
      as real GLB models, not boxes) and `fk_tunnel_buried.png` (tunnel shell meeting sloped
      terrain with no under-wall gap). Regressions: tools/_verify-hud-defaults.cjs PASS,
      tools/_verify-items.cjs 24/24. Byte-identical no-tunnel sanitize output re-confirmed unchanged.
- [x] FLUFFY GRASS (2026-07-08, user: grass too flat + color too sharp): buildGroundMesh reworked —
      base green softened 0x6fae54→0x86a862 (muted), gentle low-freq "patch" brightness variation
      (±10%, two sines) so big areas aren't uniform, world-tiled UVs (every 5u), and a CACHED 256px
      GRAYSCALE blade-noise CanvasTexture (5200 short strokes via a deterministic PRNG + soft blotches,
      RepeatWrapping) that MODULATES the vertex colour. Material now always vertexColors + white +
      map. KEY: the texture is grayscale so it fluffs ANY colour — grass green AND painted dirt/sand
      both gain blade detail (paint = sampleColor × patch × texture). Zero per-frame cost (texture made
      once). Heights UNTOUCHED (re-verified byte-identical 0.0 — physics identical; purely a visual
      change). Verified: game + paint render fluffy, 0 pageerrors. Still LOCAL.
- [x] 3D GRASS TUFTS (2026-07-08, user: "lets try the grass tufts also"): FK_TRACK.buildGrassTufts —
      ONE InstancedMesh of crossed-quad tufts (cached geo + a white-blade alpha CanvasTexture, per-
      instance green tint via setColorAt, alphaTest cutout so no transparency sorting, MeshLambert +
      emissive lift). Scattered along the track CORRIDOR (random centerline sample × side × off in
      [half+3.5, half+3.5+band] + tangent jitter), seated on terrain via opts.heightFn (game
      sampleHeight, editor terrainHeightAt). GOTCHAS FIXED: (1) first pass tufts were HUGE (size 2.4 →
      towering over the kart) — dropped to size 0.62, small ground tufts; (2) the track LOOPS so a tuft
      offset from sample k can still land on the road elsewhere — per-instance nearestOnCenter road
      check hides it (zero scale) if dist < half+2.5. Game: ~4600 tufts (2200 on mobile — matchMedia
      coarse), built once at boot, frustumCulled off. Editor: rebuilt in rebuildTerrain (follows
      sculpts) w/ a 🌱 tufts toggle (paired with 🌾 terrain), 3200 count. Verified: game tufts off the
      road + seated on grass, editor 3200 instances + toggle clears them, heights byte-identical, 0
      pageerrors. Tunables: buildGrassTufts opts.count/band/size. Still LOCAL.
- [x] PROP LIBRARY EXPANSION (2026-07-10, user: "bigger prop library, need all sorts of props for
      building levels"): grew assets/farmkart/props/ from 57 → **200** CC0/Public Domain GLBs, all
      manifested in assets/farmkart-props.js (unchanged loader/normalize/material-conversion code —
      see [[gltf-linear-color-gotcha]] — just a bigger FK_PROPS array). SOURCES (all verified CC0
      before inclusion): (1) Kenney Nature Kit full zip (kenney.nl/assets/nature-kit, 329 GLBs total,
      cherry-picked 74 new ones beyond the original 48 — cliffs, bridges, more crops/fences/flowers/
      mushrooms, ground paths, rivers, platforms, statues, extra trees/rocks/stones/stumps/logs/
      tents/campfires); (2) Kenney Racing Kit (kenney.nl/assets/racing-kit, 46 picked, id prefix
      `race_`, new cat "race") — banner towers, barriers, billboards, grandstands (5 variants), track
      lights, overhead gantries, pit garages/offices, pylon, radar, guardrail/fence, trackside tents,
      trees — perfect kart-track dressing; (3) Kenney Survival Kit (kenney.nl/assets/survival-kit, 23
      picked, id prefix `surv_`, new cats "clutter"/"structures") — barrels, crates/chests, tools,
      workbenches, canvas/metal structures, campfire, signposts. Existing 57 (48 Nature + 9 Quaternius
      Farm Buildings via poly.pizza) untouched. LICENSE VERIFICATION METHOD: fetched each kit's asset
      page (kenney.nl/assets/<kit>) to confirm the "Public Domain (CC0)" license text + grab the exact
      zip URL (kenney.nl's zip links carry a rotating hash, hardcoding an old one 404s — always re-
      resolve from the assets page), then extracted each kit's own License.txt into
      assets/farmkart/props/License-<kit>.txt (nature/racing/survival) alongside a written
      License-quaternius-farmbuildings.txt citing the poly.pizza bundle page's per-model "Licence:
      Public Domain (CC0)" listings for the pre-existing farm_* buildings. NEW CATEGORIES added to the
      editor's PROP_CATS label map (farmkart-editor.html): cliff/bridge/path/water/structures/race/
      clutter (existing tree/rock/plant/crop/log/fence/building/prop kept); #propList max-height
      180px→260px so bigger categories (race=46, tree=23, rock=19, plant=20) scroll comfortably.
      GOTCHA FOUND + FIXED: all 23 Survival Kit GLBs shipped with an EXTERNAL texture reference
      (`images[0].uri: "Textures/colormap.png"`, not embedded in the .glb binary buffer like every
      other kit here) — they loaded fine as JSON/geometry but every material failed decode ("The
      source image could not be decoded") because that relative path 404'd. Fixed by extracting the
      shared Textures/colormap.png from the survival-kit zip to assets/farmkart/props/Textures/
      colormap.png (the same relative path every surv_*.glb expects) — no manifest/loader change
      needed, all 23 load clean once the texture file exists alongside. Per-category final counts:
      tree 23 · rock 19 · plant 20 · crop 10 · log 8 · fence 9 · building 8 · prop 14 · cliff 8 ·
      bridge 4 · path 5 · water 3 · structures 8 · race 46 · clutter 15 = 200 total, 3.38MB on disk
      (well under the no-build-step page-weight comfort zone — average ~17KB/model). Verified headless
      (scratchpad fk_props_expand.cjs, own throwaway static server on :8793): manifest parses/0 dupe
      ids/0 missing files/0 files >2MB, editor loads all 200 with 0 load failures (propStatus "200 CC0
      models ready"), one real button-click placement per category (all 15) lands a real multi-mesh
      model (not the grey placeholder box) with correctly-lit (not near-black) materials, 0
      pageerrors. Still LOCAL/untracked per the existing Farm Kart convention (user decides when any
      of this ships).
- [x] SCULPT BRUSH: preview ring + LEVEL sub-mode (2026-07-10, user: "you get a preview of your land
      sculpting so you know how big your brush is"): (1) BRUSH PREVIEW RING — a thin terrain-draped
      annulus (28-seg strip mesh, ~28 bilinear height samples/update, not a THREE.Line — linewidth is
      ignored on Windows ANGLE/SwiftShader) follows the cursor in 🎨 paint AND ⛰ sculpt mode, resizing
      live with the brush-size slider and colored by what the brush would DO: green=raise, red=lower
      (incl. momentary Shift-held-to-lower), cyan=level, swatch color=paint. One shared raycast per
      pointermove drives both the ring and the actual stroke (no duplicate picks). Hides on mode exit
      and on pointerleave (`hideRing()`); `refreshRing()` re-renders it immediately after a slider/
      swatch change without waiting for the next mouse move. (2) LEVEL BRUSH — a 3rd sculpt sub-mode
      (raise/lower/level 3-way, key **L** toggles level⇄raise while in sculpt mode) alongside the
      existing raise/lower. On stroke start the height under the click becomes the TARGET; while
      dragging, `applyLevelBrush` lerps each touched grid cell's stored delta toward `target −
      procHeightAt(cell)` (procHeightAt = `FK_TRACK.groundHills` WITHOUT the user field — the pure
      procedural noise) at a smoothstep-falloff, per-call rate of `min(1, strength*0.14)`, so sustained
      brushing flattens an area to the initial click height regardless of the underlying rolling-hill
      noise. Reuses the exact same one-snapshot-per-stroke undo commit as raise/lower (no history
      changes needed — `applyBrush`'s signature/behavior is untouched, so the pre-existing `sculptAt`
      test hook still works unmodified). Verified headless (scratchpad fk_sculpt.cjs, 29/29): ring
      visible/hidden/follows/resizes/recolors correctly across both modes + Shift + level, a raised
      bump levels toward a captured target with shrinking (~monotonic) variance across 3 sample points,
      undo reverts a whole level stroke in ONE step, raise/lower behavior unchanged; regression
      fk_ux_pass.cjs 69/69 (undo/redo incl. the sculpt-stroke-is-one-commit case) unaffected. Screens:
      scratchpad/shots/fk_ring_small.png, fk_ring_large.png, fk_level_before.png, fk_level_after.png.

# 🏁 Farm Kart — custom Bucky Kart + procedural goat driver (2026-07-09)

Replaced the fused Meshy Gator + Chef Bucky GLB with all-procedural three.js:
- **Kart** (`buildCustomKart`): game-forward (+Z), chunky accent body, cream bed + hay, roll
  hoop, grill/lights, 4 knobby tires, separate seat + steering wheel + pedals.
- **Driver** (`buildGoatDriver`): humanoid goat (fur, snout, droopy ears, horn nubs, chef
  toque). Hands parented to wheel grip anchors (turn with the rim); feet parented to pedals;
  upper/lower arm & leg segments stretch shoulder↔hand / hip↔foot each frame; torso leans
  into steer/drift. `kartBuild:3` migrates fit TUNE keys. Verify: `node tools/_verify-driver.cjs`.

# 🏁 Farm Kart — Stage A terrain authority unify (2026-07-09)

Root cause of road↔ground weirdness: **two height functions**. Kart/entities used
`sampleHeight` (XZ-nearest branch + blend skirt); grass mesh used `groundSampleHeight`
(lowest-branch walk) — they disagreed at road edges even on single-level tracks, so the
ribbon and displaced ground skirt fought and `rideHeight = max(both)` was a band-aid.
Stage A: `groundSampleHeight` now **equals `sampleHeight`** except under true multi-level
overlaps (`_isMultiLevelRoad`, Y gap >1.5m) where the mesh stays on the lowest branch so
bridges keep open air. Ribbon remains a separate visual (+0.08). Verified:
`tools/_verify-terrain-auth.cjs` (default maxDiff 0; Royal keeps bridge gaps) + slope-conform
PASS. Stage B (later): bake road into one heightfield / ribbon from same verts. Stage C:
optional mesh raycast seating.

# 🏁 Farm Kart — race minimap (2026-07-09)

Top-right `#minimap` canvas (north-up): corridor outline from `centerPts`/`TRACK_WIDTH`,
live dots for every `G.players` entry (local = white-ringed facing wedge; others use
`_slotCol` / `botColor`). Shown in countdown/racing/finished; hidden on menu. Safe-area
aware; mobile ♻ reset shifted below it. Verify: `node tools/_verify-minimap.cjs`.

# 🏁 Farm Kart — defaults + race HUD (2026-07-09)

Boot default course = **Wario Stadium** (`?track=wario-stadium` / bare URL); Amen Farms
via `?track=amen-farms`. Default bots = **3** (`fk_bots` unset → 3). Race HUD: large
top-left `#placeHud` stack (place + lap time / lap / race); bottom-left `#hud` hidden.
Mobile camera = fixed Eff defaults (camDist 6.5 / camHeight 3.2 / camLag 14 / fov 74) —
never written into `fk_tune_v2` (desktop tune stays the persisted source). Verify:
`node tools/_verify-hud-defaults.cjs`.

# 🏁 Farm Kart — new items (2026-07-09)

Extended K4 item pool (weighted roll — triples rarer):
- **🐔 Homing chicken** — seeks the racer ahead by `totalProgress` (race position), gentle
  `chickenTurn` so it can be dodged; same spin-out on hit as tomato.
- **🍅×3 / 🐔×3** — three orbit the kart; each tap fires one (straight tomato / homing chicken).
- **Hold-behind trail** — hold item button ≥`itemTrailHoldMs` (~250ms) on a **single**
  tomato/chicken/hay to trail it behind as a rear shield (absorbs one rear-hemisphere hit
  from projectiles/hay). Triples never trail (orbit is the hold). Tap = fire; hold = trail;
  tap again while trailing = fire. Mobile: same hold on the 🎁 button.
HUD shows ×N for triples and 🛡 when trailing. Bots fire chickens/tomatoes at rivals ahead
and trail when threatened from behind. Verify: `node tools/_verify-items.cjs`.

# 🏁 Farm Kart — audio redesign (2026-07-09)

WebAudio-only SFX pass (no asset files; mute = `fk_muted` → masterGain 0 + speech cancel):
- **Engine** — deeper car growl: saw fundamental + detuned square harmonic through a
  lowpass that opens with RPM (`spd/maxSpeed`); idle ~38 Hz → top ~95 Hz (was thin
  single-saw ~52+spd*6).
- **Drift** — looping dual bandpass tire scrape while `drift.active`; gain + brightness
  climb with MT tier (plus existing charge ticks / tier chimes).
- **Countdown** — `countdownVoice(3/2/1/GO)`: SpeechSynthesis when unmuted + available,
  always backed by MK-style WebAudio stingers (works headless / muted / no speech).
- **Items** — tomato fire whoosh+pop + wet splat on kart hit / wall bounce; chicken
  squawk on fire + softer chirp on hit; hay keeps generic fire beep.
Kept: boost whoosh, spin warble, bonk, land thump, item-roll ticks, finish fanfare.
Verify: `node tools/_verify-audio.cjs`.
- **2026-07-09 (user requests)**: mobile chase-camera pulled closer — `MOBILE_CAM.camDist`
  6.5→5.35 (camHeight/camLag/fov and the desktop `TUNE.camDist` untouched). Drift scrape
  SFX REMOVED entirely (user didn't like it): `driftNoise/driftNoise2/driftFilter/
  driftFilter2/driftGain` nodes deleted from `startContinuousAudio()`, the per-frame gain/
  filter modulation block deleted from `updateAudio()`, `driftGainV` dropped from the
  `audioState()` debug hook. Drifting physics/visuals/particles and the rest of this SFX
  batch (engine growl, countdown voice, item sounds, boost/spin/bonk/fanfare, MT charge
  ticks/tier chimes) are untouched. Verified: scratchpad/fk_camdrift.mjs.

# 🏁 Farm Kart — generated audio samples wired in (2026-07-10)

`assets/audio/` (ElevenLabs-generated, manifest.json, ~3MB/16 files) is now layered ON TOP
of the K6 WebAudio synth above — the synth was NOT deleted, it's the graceful fallback.
Every sample-aware path checks its buffer first and falls straight back to the exact
original synth call when a buffer hasn't decoded (blocked/slow/failed fetch) — nothing can
brick playback. Everything still routes through `masterGain` (SFX/engine/drift, one 🔊
kill switch) or `musicBus`→`masterGain` (music/ambience, plus its own 🎵 kill switch).
- **Loading**: `loadAudioBuffers()` fetches + `decodeAudioData`s all 16 files at boot
  (no gesture needed — only *playback* needs a gesture, decoding doesn't) into `audioBuffers`
  map keyed by filename-sans-extension; failures land `null` (stays synth-only forever).
  `audioState().buffersLoaded`/`buffersTotal` for tests. `playSample(name, {gain,rate,dest,
  delay})` = one-shot through masterGain (or a custom dest); returns `false` when the buffer
  isn't ready so call sites can fall back inline.
- **Engine crossfade**: 3 always-running loop sources (`fk-engine-low/mid/high`) with
  per-frame gain crossfade by `rpm = spd/maxSpeed` via a `trapezoid(x,a,b,c,d)` ramp helper
  (low dominant 0→0.3, mid ~0.25→0.7, high 0.6→1.0, overlapping) PLUS `playbackRate`
  modulation ~0.85→1.3 across the full range (boost nudges the high source to ~1.35). The
  OLD synth engine graph keeps running unchanged underneath but its gain target is forced to
  0 whenever `engineSampleReady()` (all 3 buffers loaded) — silenced, not removed, so a
  losing a buffer mid-session would still have live oscillators to fall back to next frame.
  `audioState().engineMix = {low,mid,high,rate}` for tests.
- **Drift loop** (2026-07-10, USER-APPROVED sample — the synth scrape was removed
  2026-07-09 for being hated; this replaces it): `fk-sfx-drift-loop` loops silently from
  first use, gain ramps to ~0.20+tier while `drift.active && !airborne && speed>2.5`, fades
  to 0 over ~0.15s on release/airborne. `audioState().driftLoopGainV`.
  - **SFX swaps** (sample when loaded, else the untouched original synth): tomato splat/hit
  (`fk-sfx-splat`, fire keeps the synth whoosh unchanged), chicken fire/hit (`fk-sfx-squawk-
  fire`/`-hit`), hay fire+hit — new `haySound()` wraps both the drop call sites and the
  hazard-hit call site (`fk-sfx-haybale`), item-box pickup (`fk-sfx-itembox`), trail-shield
  deploy (`fk-sfx-shield`), race finish/podium fanfare (`fk-sfx-finish`, replaces the synth
  tone sequence regardless of place). GO moment LAYERS `fk-sfx-go-cheer` OVER the existing
  synth stinger (not a swap) inside `countdownVoice()`. Kept 100% synth per spec: countdown
  number stingers + speech, boost whoosh, spin warble, bonk, land thump, MT ticks/chimes,
  item-roll ticks, tomato FIRE whoosh.
- **Music state machine**: `musicPhase` ('menu'|'race'|null) driven from the existing phase
  transitions — `startCountdown()` (host + solo) and the guest's countdown-entry block in
  `guestApply` both call `setMusicPhase('race')`; `toMenu()`/`toMenuGuest()` call
  `setMusicPhase('menu')`; `showResults()` calls new `musicRaceEnd()` (fades race music,
  goes silent, fires `fk-sfx-win-jingle` once through `musicBus`) — menu music/ambience only
  resume when the player actually returns to the menu, per spec. Menu phase starts
  `fk-music-menu` (loop) + `fk-ambient-farm` (loop, faded to only 25% of the menu track's
  gain) together; race phase crossfades to `fk-music-race` (loop). All fades are 0.5s linear
  ramps via a shared `fadeGainTo()` helper; `musicBus` sits at a flat 0.35 gain under SFX.
  Autoplay: playback only starts after the first real gesture — `_firstGestureAudioUnlock()`
  is a `{once:true}` listener on `pointerdown`/`keydown`/`touchstart` that resumes the ctx and
  starts menu music IF still on the menu (a tap that also advances menu→countdown, e.g. the
  existing tap-to-start UX, naturally lands on race music instead — both are "engaged").
- **🎵 music toggle**: new button next to 🔊 (`#musicBtn`, same visual style, `localStorage
  fk_music_off`). Toggling sets `musicBus.gain.value` INSTANTLY (not a fade — this is a
  discrete on/off, unlike the phase-transition fades) to 0 or 0.35; only affects music+
  ambience, never SFX; the 🔊 master mute still zeroes everything via `masterGain`.
- **Debug hook**: `audioState()` gained `buffersLoaded/buffersTotal`, `engineMix`,
  `engineSampleReady`, `musicTrack`, `musicOff`, `musicGainV`, `driftLoopGainV`, and
  `sfxPlays` (per-sample play counters: splat/squawkFire/squawkHit/haybale/itembox/shield/
  goCheer/finish/winJingle — only increment when the SAMPLE actually played, not the synth
  fallback) — all for headless assertions.
- Verified: `tools/_verify-audio.cjs` REWRITTEN as a two-pass suite — BLOCKED (assets/audio/*
  aborted via request interception: 0 buffers load, `engineSampleReady:false`, synth engine
  drives audibly, no sample SFX counters tick, 0 pageerrors) and SAMPLES (all 16 decode,
  engine crossfades low→high with rising rate as speed ramps 0→top, synth engine gain forced
  to ~0, drift loop rises/falls, every sample SFX counter ticks exactly once per call, GO
  layers the cheer on top of the stinger, music phase machine walks menu→race→(silent after
  `musicRaceEnd`, win jingle counted)→menu, 🎵 toggle zeroes/restores `musicGainV` instantly
  and persists the flag, 🔊 mute still zeroes `masterGain` and gates speech) — 71/71 PASS, 0
  pageerrors both passes. `tools/_verify-items.cjs` 24/24 (untouched — item mechanics
  unchanged, only their sound side-effects gained sample paths). Mobile pass (scratchpad
  fk_audiowire.cjs, matchMedia coarse-pointer stub, 390×844): `body.mobile` set, first touch
  engages the music system (menu or race depending on where the tap landed — the existing
  tap-anywhere-to-start UX), 0 pageerrors.
  **KNOWN OUT-OF-SCOPE ISSUE** (not caused by this batch): `tools/_verify-hud-defaults.cjs`
  fails on `MOBILE_CAM.camDist` — a concurrent Cursor-agent edit landed in `farmkart.html`
  mid-session (see the "Cursor agent shares this repo" memory note) that reverted
  `camDist:5.35`→`3.5` (contradicting its own adjacent comment) and touched an unrelated
  wheel-steer line; left untouched since it's the other agent's live WIP, not mine to revert.

# 🏁 Farm Kart — family lobby port (2026-07-09)

Hosting a race used to be discoverable only via copy/paste link. Ported Barnyard Bistro's
proven family-lobby system (see barnyardbistro.html ~line 730-898, the reference this
mirrors closely) into farmkart.html so hosting registers a Firestore doc that games.html's
already-generic `renderLobbies()` shows as a live JOIN card. House convention: Firebase
config/helpers DUPLICATED inline (no shared JS module in this repo), all `fk`-prefixed to
avoid collisions with the game's own `net`/`Lobby`-adjacent names.
- **farmkart.html**: new block right after `myName()` — `fkFirebaseConfig`/
  `FK_FAMILY_PASSWORD`/`fkRoomId`/`fkFamilyKey` (with `?fam=` test override), lazy Firebase
  ESM import (`fkInitLobbyBackend`/`fkLobbyBackendReady`), `Lobby` state object,
  `ensureLobbyDoc`/`updateLobbyDoc`/`deleteLobbyDoc`, 15s heartbeat, pagehide/beforeunload
  cleanup, 60s hidden-tab delete + recreate-on-visible — same shape/timings as Bistro.
  Doc id `lobbies_<familyKey>/fk_<roomCode>`. Fields: `game:"farmkart"`,
  `gameName:"Farm Kart"`, `ico:"🏁"`, `hostName` (localStorage `choreUser`), `roomCode`,
  `createdAt`/`updatedAt`, `status` ("open"|"started"), `playerCount` (live count of HUMAN
  Playroom players, never bots — `net.players.length`), `maxPlayers: MAX_KARTS` (4).
  WIRING: `ensureLobbyDoc()` called at the end of `initNet()`'s success path (covers both
  the FAMILY RACE button and a deep-link guest who becomes host because the room was
  empty/new — its own `isHost` guard no-ops the latter); `updateLobbyDoc({playerCount})` on
  every guest join/quit; `startCountdown()` flips `status:'started'` when the host actually
  starts a race; the host's per-frame race-over check flips `status:'open'` again the
  instant all karts finish (edge-triggered via `!G.raceOver`, so a race that's over but not
  yet re-started shows as joinable). Guests never write (every entry point gated on
  `net.mp && net.isHost`); solo/Playroom-unreachable never touches Firestore. UI: `#mpBox`
  gained `#mpLiveNote` — host-only "✅ Race is live in the Games tab — family can tap JOIN"
  under the existing copy-link box (copy-link kept as a secondary/manual path). Debug hook
  `window.__fkLobby = { ensureLobbyDoc, deleteLobbyDoc, updateLobbyDoc, get state() }`
  (mirrors the existing `window.__KART__`/`window.__net` convention).
- **games.html**: `renderLobbies()`'s card-text is now looked up per `data.game` via a new
  `LOBBY_TEXT` map (`lobbyText(data, cooking)`) instead of hardcoded Bistro wording —
  `barnyardbistro` keeps its exact original "...'s kitchen is open! · n/m chefs" text,
  `farmkart` reads "🏁 <host>'s race is forming! · n/4 racers" (open) / "🏁 <host>'s race is
  mid-race!" (started), anything else falls back to a neutral "<host> is hosting
  <gameName>!" so a future game doesn't need a games.html change just to show a card. Also
  added the same `?fam=` override `familyKey` already supports on the other pages (needed
  so tests never touch the production `lobbies_fam2jan2g` collection — games.html had no
  override before this).
- **Verification**: scratchpad `fk_lobby.cjs` (`.cjs` not `.mjs` — puppeteer-core here is
  CommonJS, matching the `tools/_verify-*.cjs` convention; uses `tools/node_modules/
  puppeteer-core`, real Chrome). Real Playroom WAS reachable from this environment — full
  live flow verified against it (no stub fallback needed): host registers
  `lobbies_famtestfk/fk_<code>` with the exact doc shape, games.html renders the JOIN card
  (icon/text/href all correct), a real guest follows the card's href into the SAME Playroom
  room, playerCount live-ticks 1→2, `startCountdown()` flips status→started and games.html
  swaps to the static in-progress card (no JOIN link), closing the host tab deleted the doc
  (pagehide fired reliably in headless Chrome). Degradation checked separately: with
  googleapis/firestore/gstatic all blocked, FAMILY RACE hosting still works (`net.mp` true,
  `Lobby.available` false, 0 pageerrors); solo play with Playroom+Firestore both blocked is
  unchanged (0 pageerrors, `forceRace()` still drives the kart). All Firestore calls in the
  test target `?fam=famtestfk` only; every doc the test creates is deleted via the
  Firestore REST API afterward and the collection is confirmed empty (0 remaining). Regression:
  `tools/_verify-items.cjs` 24/24 and 16/18 on `tools/_verify-audio.cjs` (both pre-existing
  drift-gain failures — `driftGainV` was removed in the same-day "remove drift scrape SFX"
  commit above; that test file predates the removal and wasn't in this task's edit scope).
  `tools/_verify-hud-defaults.cjs` similarly has one pre-existing failure (expects mobile
  camDist 6.5, code now correctly reads 5.35 per the same-day mobile-camera pullback) —
  neither pre-existing failure is caused by or related to the lobby port.
- **HOST-SIDE INVISIBLE-GUEST FIX (2026-07-09)**: on the host, `Playroom.onPlayerJoin`
  pre-creates `G.players['r_'+player.id]` (grid pose only) the moment a guest joins, so the
  `if (!p)` new-entry branch in `adoptKart` — the only place that called `buildKartView` —
  never ran for that key; guest karts synced position/hits but had no mesh (host saw an
  empty track, guest saw everyone fine). Fixed by hoisting the `buildKartView` call out of
  the `if (!p)` branch so it runs on every `adoptKart` tick for any player missing a view
  (idempotent via the existing `kartViews[key]` guard). Quit cleanup was already correct
  (`onPlayerJoin`'s `player.onQuit` calls `removeKartView` + deletes the `G.players` entry) —
  no change needed there. Verified live vs the real Playroom backend (2 real Chrome
  instances): guest-joins-on-menu-then-race-starts and guest-joins-mid-race both end with
  the host's `r_<id>` entry `hasView:true`/`inScene:true`/tracking world position, exactly
  one `kartViews` entry per player, 0 pageerrors; host screenshot shows the guest's kart +
  name label. Regression: solo race boots/drives with Playroom blocked (0 pageerrors),
  `tools/_verify-items.cjs` 24/24, `_verify-audio.cjs` 18/18, `_verify-hud-defaults.cjs` PASS.

# 🏁 Farm Kart — MENU OVERHAUL (2026-07-10, farmkart.html only; still LOCAL/unpushed)

Reworked the home page from the old one-screen quick-menu (track `<select>` + mode buttons +
bots picker + FAMILY RACE) into a proper multi-screen flow. Everything lives inside
`#startOverlay > #menuFlow`; the LEGACY controls (`trackSel`/`modeBtns`/`kartPick`/`drvPick`/
`familyRaceBtn`/`mpBox`) are KEPT in the DOM but hidden in `#legacyMenu` so all their original
wiring stays valid — the new flow calls those same functions (`setRaceMode`/`setLocal*`/
`startCountdown`/`initNet`). The whole thing is the `MenuFlow` IIFE module (`window.MenuFlow`)
inserted right before the boot `toMenu()`/`MenuFlow.init()`.
- **FLOW MAP**: home → SINGLE PLAYER → TIME TRIAL → course grid → RACER SELECT → RACE (0 bots) ·
  or GRAND PRIX → cup select → RACER SELECT → 4-track cup sequence. MULTIPLAYER → HOST → RACE →
  SINGLE RACE → course → MP DRIVER SELECT (waiting room) · or JOIN (enabled only when a fresh
  open family lobby exists). Screens are `.mfScreen[data-name]` toggled by `MenuFlow.show()`;
  `histStack`/`back()` give a Back button on every deep screen. Menu music (`setMusicPhase`)
  keeps playing across all screens; race music on race start.
- **FK_RACERS** (8): `{ id, name, color, kartId, driverId }` — a "racer" is just a PRESET over the
  EXISTING procedural builders (no new characters modeled). `setLocalRacer(id)` applies
  kart+driver+color, persists `localStorage fk_racer`, stamps `player._racerCol`. In-race the
  local kart uses `_racerCol` (seat funcs in `startCountdown`/`placeAllAtGrid` assign a grid-slot
  color, then the racer color WINS for the human you control). NOTE: the tractor kart always paints
  `TRACTOR_RED`, so tractor-based racers read red regardless of `color`. Sunny/Clover/Rusty/Daisy/
  Pepper/Biscuit/Maple/Turbo.
- **FK_CUPS** (4 placeholder cups, trivially editable): `{ id, name, ico, trackIds[4] }` over the
  builtin/amen-farms track ids — 🌽 Corn / 🐐 Goat / 🚜 Tractor / 🌟 Star. Points = `FK_CUP_POINTS`
  `[15,12,10,9,8,7,6,5,4,3,2,1]` (MK-ish, 12-kart field). Cup is SESSION-SCOPED (nothing persisted
  beyond `fk_best`): `cup = { cupId, raceIdx, points, racerId }` in `sessionStorage fk_cup_session`.
  Because switching tracks requires a full page RELOAD (the scene/`centerPts`/`arcS`/fences are
  built once from `ACTIVE_TRACK` at load), the cup drives its 4 races by reloading to each
  `?track=<id>` and resuming from `sessionStorage`; after each race `onCupRaceFinished()` awards
  cumulative points (keyed by name — bot names are DETERMINISTIC `BOT_NAMES[i]` so they persist
  across reloads) and renders a 12-row standings screen (reuses `#results`/`#rStandings` + a `.spts`
  points column); `raceAgain()`/tap advances to the next track; after race 4 = final cup podium.
- **Track previews**: `drawTrackPreview(canvas, track)` reuses the minimap corridor approach —
  `FK_TRACK.resample(track, THREE, 140)` → fit the closed centerline into a small canvas (thick
  dim corridor + bright racing line + start dot). Course grid = amen-farms + all `BUILTIN_TRACKS` +
  saved-map extras (≥14 cards). `drawRacerSwatch()` draws a top-down kart glyph in the racer color.
- **MP READY PROTOCOL**: every connected player publishes Playroom player state
  `pick = { racerId, ready }` (`publishPick()`); the waiting room polls `net.players` `getState('pick')`
  (600ms) and renders every player's swatch/name/ready live (`renderWaiting`/`allPicks`). The host's
  START RACE (`#mfStartBtn` / `mpTryStart()`) enables ONLY when every player is ready; guests never
  start. Each player's own racer color publishes via `serializeKart`'s `col` (= `_racerCol`), so
  remote karts render each player's OWN colors (verified both directions). `beginHost()` calls
  `initNet(null)` (creates the room + `ensureLobbyDoc`); the lobby doc now also carries a `track`
  field so the in-page JOIN builds `?track=<hostTrack>[&fam=…]#r=<code>` (reuses the deep-link path).
  MP CUP + BATTLE are shown but DISABLED "coming soon 🚧" (cross-track cups need per-race reloads,
  incompatible with a live Playroom room; battle mode isn't built).
- **JOIN**: `subscribeLobbies()` `onSnapshot(lobbies_<familyKey>)`; `refreshJoin()` enables the button
  only for the freshest lobby with `game==='farmkart'`, `status!=='started'`, `updatedAt` <45s (the
  games-hub liveness rule), labeled "JOIN <host>'s race". Firestore unreachable → disabled + a
  subtle "No lobbies found / unavailable" note. `?fam=` override preserved through the join nav.
- **DEEP-LINK BACK-COMPAT**: `MenuFlow.init()` precedence — (1) `#r=` guest (`window.__fkDeepGuest`)
  → MP waiting room; (2) `sessionStorage fk_flow_pending` (a TT course or MP-host course that needed
  a track reload) → resume; (3) `fk_cup_session` → resume the cup; (4) a plain `?track=<id>` (editor
  test buttons / lobby links w/o `#r=`) → boot STRAIGHT into a race; (5) bare URL → home. The old
  blanket "tap/Enter anywhere on the menu starts a race" is GONE (`advance()` no longer starts from
  the `menu` phase — explicit RACE buttons drive it); the finished screen routes tap/Enter through
  `MenuFlow.raceAgain()` (cup-aware).
- **VERIFIED**: `scratchpad/fk_menuflow.cjs` OFFLINE 41/41 (home SP/MP, TT course grid ≥13 cards w/
  canvas previews + names, racer select 8 racers, 0-bot trial race, GP 4 cups, cup race 1 → 12-row
  points standings → race 2 loads cup track[1], MP JOIN disabled + note, MP HOST BATTLE + MP CUP
  disabled, `?track=` auto-race, racer persistence across reload, mobile 390×844 no h-scroll, 0
  pageerrors). `scratchpad/fk_menu_mp.cjs` LIVE 22/22 vs REAL Playroom + REAL Firestore
  (`?fam=famtestfk`, all docs deleted after, collection confirmed empty): host reaches driver-select
  + lobby doc registered (w/ `track`), guest MP→JOIN sees the live lobby + host name + joins the same
  room, both see 2 pick rows live, host START disabled until guest readies then enabled, race starts
  for both, guest's kart on host = turbo blue / host's kart on guest = sunny yellow (colors sync both
  ways). Regressions: `_verify-items.cjs` 24/24, `_verify-audio.cjs` 102/102, `fk_wrongway.cjs` 48/48,
  `fk_tunnels.cjs` game-side 0 pageerrors (its 2 failures are the props-manifest count 200-vs-57 in
  `assets/farmkart-props.js`, editor-side, pre-existing/out of scope). `_verify-hud-defaults.cjs`
  still reads the hidden `trackSel`/`modeBtns` fine; its ONLY failure is Cursor's WIP `MOBILE_CAM`
  `camDist:3.5`-vs-expected-5.35 (untouched per the task — Cursor owns those lines). All farmkart
  files STILL UNTRACKED/UNPUSHED.

# 🏁 Farm Kart — cloud track sync (2026-07-10)

User: "hitting save on the editor always pushes that new track to any device/version." Tracks
used to live ONLY in per-device `localStorage fk_tracks_v1`. Now the WHOLE map also syncs
through one Firestore doc — same house pattern as `leveleditor.html`'s `bistroLayouts`.
- **Doc**: `settings_<familyKey>/fkTracks` — `{ tracks: JSON.stringify(fullMap), updatedAt }`
  (every track is well under 10KB, so the whole map fits in one doc). `farmkart-editor.html`
  gets its OWN small inline Firebase config/init (`fkEdFirebaseConfig`/`fkEdInitCloud`/
  `FkCloud`/`fkEdFamilyKey`, `?fam=` override) — house convention is to duplicate config per
  page rather than share a module. `farmkart.html` does NOT duplicate config: it reuses the
  family-lobby `Lobby.db`/`Lobby.fs` handles + `fkFamilyKey` that already exist for the
  race-lobby doc (`fkLobbyBackendReady`).
- **Editor**: boot stays LOCAL-FIRST (`loadInitial()` unchanged, still reads localStorage
  synchronously so there's no blank-screen wait on Firestore); `fkEdPullCloud()` runs in the
  background right after boot — pulls the cloud map (3s race timeout), overwrites localStorage
  on success, hot-reloads the track CURRENTLY open in the editor if its own cloud copy differs,
  and refreshes the load-picker; silent no-op offline/on timeout. `doSave()` still does its
  synchronous localStorage write + returns the id immediately (so `testBtn`'s
  `window.open(...)` keeps working unchanged), then fires the cloud `setDoc` in the background
  with HONEST toasts: "⏳ saving… to all devices" → "✔ saved … to ALL devices" / "✔ saved …
  on THIS device only (offline)" / "…(cloud save failed)". `toast(msg, ms)` gained an optional
  duration (save toasts run ~3s instead of the default 1.6s — too quick to read).
  `pickerEntries()` no longer HIDES a saved override of a built-in track id — it keeps the
  built-in option and appends "(edited)" to its label (the map copy already wins in
  `loadById`, this was purely a visibility bug).
- **Game**: `populateTrackPicker` (now a named function, not an IIFE, so the reconcile can
  re-call it) gets the same "(edited)" labeling for any built-in/`amen-farms` id with a saved
  override. `loadActiveTrack()`: when a `?track=<id>` resolves a map entry that FAILS
  `sanitize()`, it used to fall through to the builtin/default silently — now it also sets
  `window.__fkTrackLoadWarning = id`, surfaced on the start menu via a new small `#trackWarn`
  note under the track picker ("⚠ Saved track '<id>' couldn't load — using default.").
  `fkReconcileTracksCloud()` (background, fire-and-forget at boot, reuses `Lobby.*`): pulls
  the cloud doc (3s timeout), and if the raw JSON differs from localStorage, writes it to
  localStorage. If the CURRENTLY ACTIVE track's own entry in the map actually changed AND the
  game is still on the start menu solo (`G.phase==='menu' && !net.mp` — never mid-race, never
  MP-connected), it reloads the page ONCE via a `sessionStorage` guard (`fk_tracks_adopted`,
  cleared at the top of every fresh page load) so the fresh track takes effect without a
  reload loop; otherwise (mid-race, MP, or already adopted this session) it just updates
  localStorage silently and re-runs `populateTrackPicker()` — applies on the next navigation.
  Test key `famtestfk` used for all Firestore-touching verification (never `fam2jan2g`).

# 🏁 Farm Kart — proximity audio, louder engine, wrong-way HUD (2026-07-10)

Three user-requested audio/HUD passes, all in `farmkart.html` only.
- **PROXIMITY AUDIO** (user: "you don't hear other carts' sounds at the same volume as your
  own"): new `gainAt(pos, name)` — cheap 2D (XZ) distance gain from the LOCAL kart, no
  PannerNodes. `PROX_FULL_R=8` (full volume) → linear falloff → `PROX_ZERO_R=55` →
  `PROX_FLOOR=0.12` (never fully silent). A sound fired AT the local kart's own position is
  distance 0 → always full gain, so every call site can pass a kart's `pos` unconditionally —
  no separate "is this me" branch needed. `playSample()` gained `opts.at` (world pos, calls
  `gainAt` internally) / `opts.mul` (pre-computed multiplier); `tone()`/`noiseBurst()` gained
  `opts.mul` so synth fallbacks share the same distance-fade. Routed through: `boostWhoosh`,
  `spinSound`, `tomatoFireSound`, `tomatoSplatSound`, `chickenSquawkSound`, `haySound`/
  `itemFireSound`, `itemRollSound`, `itemBlockSound`, `landThump` (all now take an optional
  trailing `pos`/kart-object param — every non-local call site was audited and updated:
  `useItem()`'s boost/tomato/chicken/hay branches (fires for bots AND host-simulated remote
  guests via `hostConsumeGuestUse`), `applySpinOut()`, `hitKartWithProjectile()`/
  `tryAbsorbWithTrail()` (any kart can be hit), the hazard-hit path in `advanceHazards()`, the
  item-box pickup in `updateItemBoxes()`, and — a real pre-existing bug, not just a tuning
  gap — `landThump()` in `syncKartView()`, which runs once per rendered kart (local + bots +
  remotes) every frame and previously always thumped at full volume regardless of which kart
  landed). Existing local-only-gated call sites (mini-turbo release, boost-pad kick,
  ramp-jump whoosh) were left untouched — they already only fire for the local kart, and
  `gainAt(undefined)` still resolves to full gain so their behavior is unchanged. Debug hook:
  `audioState().prox = {name,dist,mul}` (last proximity-scaled call); `gainAt`/`PROX_FULL_R`/
  `PROX_ZERO_R`/`PROX_FLOOR` exposed on `window.__KART__`.
- **ENGINE LOUDER** (user: local sample engine too quiet): `updateSampleEngine()`'s three
  band-gain targets (`tgtLow`/`tgtMid`/`tgtHigh`) multiplied by a new `ENGINE_LEVEL_MUL = 1.75`
  — same per-band formula/crossover weights as before, just scaled up. Drift loop, music bus,
  and masterGain headroom untouched (peak combined engine mix stays comfortably under
  masterGain=1 even mid-crossfade). Synth-fallback engine gain (blocked-buffers path) NOT
  changed — the user's complaint was specifically about the sample engine.
- **WRONG-WAY HUD**: an indicator (`#wrongway`) already existed (text "⟲ TURN AROUND",
  2s threshold) driven by a pre-existing, untouched signal — `p.wrongWayT` accumulates in
  `updateRaceProgress()` off the WRAP-AWARE arc-length delta `ds = progressS - prevProgressS`
  (handles the lap-boundary wrap so crossing the finish line never reads as reversing);
  resets to 0 the instant `ds` goes forward again. This session: (1) text → "⚠ WRONG WAY",
  (2) threshold constant `WRONG_WAY_SHOW_T` extracted and lowered 2s → **0.8s**, (3) CSS
  restyled to the `#placeHud` family (Consolas/monospace, heavy text-shadow, big 30px/20px-
  mobile red pulse badge) and repositioned to clear `#itemSlot` (top 14-90px), the top-right
  `#minimap`, and the mobile `#touchCtl` thumb buttons (`top: calc(104px + safe-area)` desktop,
  `140px` mobile). Hide-on-correct is inherently instant (next forward-progress frame resets
  `wrongWayT` to 0), well under the ~0.5s budget. A brief knockback/spin never reaches 0.8s
  of *sustained* reversal so it never false-positives; a spin-out only scales kart speed
  (same direction), so it doesn't perturb the sign of `ds` either. `updateRaceProgress`/
  `updateHUD` exposed on `window.__KART__` for deterministic headless testing (drives the
  signal by moving the kart's position along `centerPts` rather than simulating real
  keyboard input).
- **Verify**: `tools/_verify-audio.cjs` extended in place (was 71 checks incl. the K6 sample-
  audio suite, now 102: +1 engine-level-bump assertion in the SAMPLES pass, +13 proximity-gain
  checks per pass incl. a live bot-kart near/far comparison via `addTestKart`). New scratchpad
  suite `fk_wrongway.cjs` (48 checks, desktop + mobile passes: forward/no-indicator, sustained-
  reverse/shows, correct/hides-fast, brief-knock/never-shows, spin-out/never-shows, styling
  family, bbox non-overlap with touch controls + minimap + item slot). Regression:
  `tools/_verify-items.cjs` 24/24 clean. `tools/_verify-hud-defaults.cjs` has ONE pre-existing
  failure unrelated to this batch — mobile `camDist` expects 5.35, reads 3.5 (a parallel
  Cursor session's live edit to `MOBILE_CAM`, per its own dated comment "pulled closer
  2026-07-09... was 6.5" then further to 3.5 — left untouched per this task's scope; not
  caused by or related to the proximity/engine/wrong-way work). 0 new JS pageerrors in either
  suite.

# 🏁 Farm Kart — EDITOR UX PASS + BRIDGES (2026-07-10)

Usability/simplicity pass on `farmkart-editor.html` (user: "run a pass on the track editor
for usability, simplicity, ui — anything that makes building a track easier and smoother").
Files touched: `farmkart-editor.html` (all the UI/UX work), `assets/farmkart-track.js`
(bridges data model + shared builder), `farmkart.html` (bridge rendering only — same
pattern as tunnels).

- **UNDO/REDO** (the #1-priority ask): whole-track snapshot history — `history` is a
  linear array of JSON clones of `track` with `histIndex` pointing at the current entry;
  `commitHistory()` runs at the END of every mutating action (point move/insert/delete,
  item/boost placement, object add/move/delete, sculpt/paint STROKE END — not per-frame,
  fence point/finish-from-edges/delete, tunnel/bridge add/change/delete, field edits on
  `change` not `input` so typing doesn't spam entries), capped at 50 (oldest dropped, index
  shifted). A NEW action after an undo truncates any redo tail before appending (standard
  semantics). `Ctrl+Z`/`Ctrl+Shift+Z`/`Ctrl+Y` (Cmd on Mac) + small `↶ ↷` buttons in the
  title bar (auto-disable at the ends). Restore reuses the same rebuild path as
  `loadTrack`/`loadById` (`rebuild()+rebuildObjects()+rebuildFences()+rebuildBridges()`);
  `histSuspended` guards the restore's own field writes from re-entering `commitHistory`.
  Boot/import/load-track reset the history to a single fresh entry (loading a track is
  never itself an undo step). Gizmo object-drags commit ONE entry on `dragging-changed`
  release (not per-frame `objectChange`).
- **PROP SEARCH**: `#propSearch` text box above the 200-prop button list (grown past the
  original 57 since a later CC0-expansion session — `renderPropList(cat, q)` now takes an
  optional search term; non-empty search matches name OR category across ALL props
  (ignores the category dropdown — no need to guess the right category first), shows a
  "N matches" count, updates live on `input`).
- **PANEL DECLUTTER**: wallMargin/world-size/corridor-bounds/terrain+tufts toggles/follow-
  terrain moved into a collapsible **"⚙ advanced"** section (`#advBody`), collapsed by
  default, open/closed state remembered in `localStorage['fk_ed_advanced_open']`. Fixed
  the known overlap (hint bar vs delete-point button in tight viewports): `#tools` max-
  height changed `96vh` → `calc(100vh - 20px)` (was leaving a sliver where the SAME
  z-index hint bar could paint over the panel's last row) and `#hint` dropped to
  `z-index:9` (below the panel) + wraps (`white-space:normal;max-width:64vw`) instead of
  a fixed nowrap line that could stretch wide on long mode hints. Verified 0 overlaps at
  1280×800 AND 1024×768 (bbox checks: hint vs delete button, hint vs save button, panel
  bottom inside the viewport).
- **SAVE HYGIENE**: `dirty` flag — `markDirty()`/`clearDirty()`; a `●` dot on the Save
  button (`#dirtyDot`) shows when there are unsaved changes (set by every `commitHistory`
  call) and clears in `doSave()`. `Ctrl+S` triggers `doSave()`. `beforeunload` warns on an
  unsaved close/refresh. Save + **"🏁 Test drive"** (renamed from "▶ test") both got a
  `.prominent` style (green Save / red Test drive) — Test drive already saved-then-opened
  (`doSave()` then `window.open('farmkart.html?track=...')`), unchanged, just restyled.
- **BRIDGES** (the requested new feature) — mirrors the tunnel architecture exactly:
  - Data: `track.bridges = [{id, tag, s, len, style?}]` (same `s`=arc-length start
    fraction, `len`=world-unit span convention as tunnels/boost pads). `sanitize()`
    validates + OMITS when empty — re-verified byte-identical output for bridge-less
    tracks (DEFAULT_TRACK + wario-stadium, old vs new module).
  - Shared builder `FK_TRACK.buildBridgeMesh(sampled, bridges, trackWidth, THREE, opts)`
    in `assets/farmkart-track.js`: side RAILS (posts + two horizontal rails each side,
    same construction as `buildFenceMesh`'s "rail" style) along both road edges, a thin
    raised DECK LIP strip along each edge, and vertical SUPPORT PILLARS at ~6u intervals
    from the road underside (`opts.heightFn`, seated on the ROAD height like tunnels) down
    to `opts.groundFn` (defaults to `heightFn` if omitted; game/editor pass
    `groundSampleHeight` — the terrain height WITHOUT road influence, which stays on the
    LOWEST branch under a true multi-level overlap) — pillars are SKIPPED where the gap is
    under ~1.5u (an at-grade span needs no support) and each gets a small buried footing
    box. Warm wood-brown `MeshLambertMaterial`s with an emissive lift (house convention —
    unlit undersides don't render flat black, same lesson as tunnels/
    `[[gltf-linear-color-gotcha]]`).
  - Editor: 🌉 bridge mode mirrors 🚇 tunnel mode exactly (click the road = bridge STARTS
    at the click; `#bridgeList` w/ select/delete; length slider; live throttled rebuild;
    `bridgeGroup` renders via the shared builder). Hooked into `rebuild()` alongside
    `rebuildTunnels()`.
  - Game (`farmkart.html`): renders `ACTIVE_TRACK.bridges` via `BRIDGE_GROUP` right next
    to `TUNNEL_GROUP`, passing `sampleHeight`/`groundSampleHeight` as heightFn/groundFn.
    Purely visual — no collision/physics change (matches tunnels).
  - TESTED CAVEAT: a real self-crossing figure-8 track's overlap is a single XZ point (not
    a sustained span), so it doesn't reliably exercise the pillar-count/skip logic on its
    own — the rigorous pillar test is a synthetic straight `sampled` with controlled
    `heightFn`/`groundFn` (elevated-span case: sane pillar count, pillars reach the
    terrain; at-grade case: zero pillars, rails/lip still render). The figure-8 integration
    test stays as a lighter "does it render without crashing on the real self-crossing
    track" smoke check + the requested screenshot.
- **SMALL EXTRAS**: arrow-key nudge for the selected point OR object (0.5u, Shift = 2u,
  commits one history entry per nudge); `Ctrl+D` duplicates the selected object (only
  active in object mode with a selection — mirrors the existing `⧉ duplicate` button);
  `Escape` now ALSO exits the current placement MODE back to `select` (previously only
  ended an armed click-to-stamp `pendingPlace`).
- **USER MID-TASK ADDITION — no more floating object-name labels in the 3D viewport**: the
  editor used to render a canvas-sprite label ("(untitled)" etc.) floating above every
  placed object (`makeLabel`/`positionLabel`/`labelGroup`) — cluttered the scene,
  especially with several untitled objects. REMOVED entirely from the render path (the
  dead helper functions + empty `labelGroup` are left in place, not ripped out, in case a
  future "toggle labels" option wants them back). Object names/tags now live ONLY in the
  sidebar `#objList`, which gained a per-type icon (🧊 block / 🏚 barn / 🥫 silo / 🌳 tree /
  💧 water / 🛫 ramp / 🌲 glb prop) so several same-named/untitled objects still read at a
  glance; the existing selection-highlight tint disambiguates exact identity. Clicking a
  viewport object already routed through `selectObject()` (which calls `refreshObjList()`),
  so viewport-click → list-highlight was already wired — no separate change needed there.
- **SKIPPED / DEFERRED**: nothing from the brief was skipped — all 6 numbered items plus
  the mid-task label-removal addendum landed.
- Verified (scratchpad `fk_ux_pass.cjs`, 69/69): undo/redo across 5+ action types incl.
  sculpt-stroke granularity (3 brush dabs mid-drag = 0 new entries, stroke end = exactly 1)
  and redo-clear-on-new-action; prop search narrows/empties/clears correctly; advanced
  section collapses by default and its open state survives a fresh page load; 0 UI overlaps
  at 1280×800 and 1024×768; dirty dot appears on mutation, clears on save, Ctrl+S saves for
  real (localStorage checked); bridge click-to-place lands within ~0.1 s-fraction of the
  click, editable via the length slider, deletable; synthetic pillar-logic unit test (sane
  count on a 40u elevated span, zero pillars on an at-grade span); bridge-less sanitize
  byte-identical (DEFAULT_TRACK + wario-stadium); figure-8 integration render; game boots a
  bridged track (`ACTIVE_TRACK.bridges`, `BRIDGE_GROUP`) and drives near the span with a
  finite kart position; 0 pageerrors throughout both editor and game passes. Regression:
  `fk_tunnels.cjs` 63/65 (2 pre-existing unrelated failures — a stale prop-count assertion
  from before a later prop-library expansion, not touched by this pass) and `fk_objects.cjs`
  25/25 (confirms the label removal didn't break anything) both still green. Screenshots:
  `shots/before_desktop.png` / `shots/after_desktop.png` (panel before/after) and
  `shots/fk_bridge_editor.png` / `shots/fk_bridge_game.png` (a placed bridge on an elevated
  figure-8 span, editor + in-game).

# 🏁 Farm Kart — TOAD'S TURNPIKE night-city rebuild (2026-07-17, Fable + 2 opus agents)

The bare `toads-turnpike` layout port is now a full MK64-Toad's-Turnpike-style night city
highway (layout/points untouched). TWO new sanitize keys (whitelisted, omitted-when-absent,
byte-identical for every other track — re-verified vs `git show HEAD`):
- **`theme:"city"`** → night-city environment. Track def also gained `sky:"night"`,
  `wallMargin:6`, `music:"turnpike"` (mp3 absent → clean fallback to default race theme).
  `FK_TRACK.buildCityscape(sampled,width,THREE,{heightFn,groundFn,wallMargin,mobile})` = ONE
  deterministic group, 18 draw calls: 63 arc-spaced sodium street lamps (instanced poles/heads
  + additive glows + road light-pools, seated on heightFn so they climb the elevated start
  ramp), 160/100-mobile near buildings (4 window-grid canvas variants, MeshBasicMaterial =
  self-lit windows, footprint-corner road clearance, sidewalk aprons, groundFn-min seating),
  80/48 far-skyline towers fading into the night fog, 10 atlas-batched billboards (goat-mascot
  "BUCKY!" ads = the Toad analog + farm-parody ads; faces built on the road-viewer's
  screen-right so text never mirrors — first pass DID render mirrored, fixed via
  R_view=(-outN.z,outN.x) + DoubleSide + dark backing), horizon dusk-glow cylinder ("very
  late sunset"). `FK_TRACK.buildLaneMarks` = merged dashed 4-lane dividers (−4.5/0/+4.5) +
  solid edge lines. New opt-in builder opts (defaults = exact old values): buildRibbonGeometry
  roadColor/curbColor, buildFenceMesh ribbonColors/ribbonEmissive (concrete barriers),
  buildGroundMesh skipBladeTexture. Game hooks gated on `ACTIVE_TRACK.theme==='city'`: asphalt
  ground 0x2e3136 (no blade tex), blue-gray road 0x3d434e, no grass/painted tufts, concrete
  walls, hemi 0.58 + sun 0.52 warm nudge (shared SKY_PRESETS.night NOT mutated), dark-navy
  minimap pad (grass-green elsewhere). `CITY_GROUP`/`LANE_GROUP`/`theme` on `__KART__`.
- **`traffic:{count:1..24, speed:1..40}`** → civilian traffic, the signature hazard
  (authentic MK64 mix: white sedans / turquoise tankers / red box trucks / yellow school
  buses). `FK_TRACK.buildTraffic` mirrors buildTrainsMesh: group + userData.update(dt) +
  userData.vehicles[{head,lane,laneOff,speed,len,type,x,z,yaw}]. Deterministic spawn over the
  4 lane centers (−6.75/−2.25/+2.25/+6.75), 30u start-grid exclusion, inner lanes ×1.05 /
  outer ×0.92 (no lane changes → same-lane gaps constant), bright red taillights + headlight
  road pools (night readability), vehicles drive at ALL phases. Turnpike def: count 12,
  speed 9.5 (≈32% of maxSpeed 30). COLLISION `advanceTrafficHits`: swept kart segment (chicken
  pattern) vs 2-circle hull (±len*0.28, r 1.55+~0.45); ruling model DELIBERATELY deviates from
  host-rules-all — each client rules only karts it simulates (solo=all, host=own+bots,
  guest=own; traffic is deterministic + head-synced like trains in snapshots, so rulings
  agree) → guests get real LOCAL launch physics with zero extra net traffic. Hit = MK64
  upward LAUNCH: airborne, vy 7.5 (vs RAMP_LAUNCH_BASE 3.0), horizontal ×0.35,
  trafficInvulnT 1.6s (new makePlayer field), then applySpinOut (star/bull/rescue immunity
  respected — star karts plow through), type-aware horn + impact particles. Minimap gets pale
  traffic dots. `TRAFFIC_GROUP`/`trafficVehicles`/`advanceTrafficHits` on `__KART__`.
- VERIFY: `tools/_verify-turnpike.cjs` **77/77** (pure-node sanitize byte-identical + clamp/
  drop, city boot counts/colors/no-tufts, building road-clearance ≥21u, drive check, traffic
  boot/mix/ramp-follow/wrap/advance, launch/invuln/star rulings, minimap pads both ways,
  default-track fully unchanged, mobile pass incl. 18-draw budget, 0 pageerrors ×3 passes) +
  `_verify-items.cjs` 24/24 + `_verify-hud-defaults.cjs` PASS. Screenshots: shots/
  fk_turnpike_{start,night_desktop,mobile,traffic,launch,traffic_mobile}.png. UNPUSHED —
  awaiting user playtest (preview-before-push). Optional follow-up offered: generate a real
  `fk-music-race-turnpike.mp3` city-night theme (needs ElevenLabs credits — ask first).

# 🏁 Farm Kart — MARIO KART BOT OVERHAUL, phases 1–5 (2026-07-17)

Researched real MK CPU design (MK64: off-screen-only rubber-band cheating, self-spawned CPU
items, 1–2 random rivals per GP; Double Dash: per-CC rubber tables + CC-gated item access +
cup-persistent rivals + spiteful timing; MK Wii: enemy-path widths, per-point behavior flags,
behavioral CC tiers — 50cc never drifts/rarely items/errs, 150cc drifts everything, 2 rivals
leashed to the player) and rebuilt the farmkart.html bots on that recipe. All 5 phases in the
working tree, sonnet-delegated per phase, Fable spec+review. UNPUSHED/uncommitted — awaiting
user playtest; the parallel Cursor agent's "city theme" WIP shares the tree (its hunks in
farmkart.html/farmkart-track.js/CLAUDE.md — separate the commits when shipping).
- **P1 rubber-band curve**: the old flat ±6%-past-25u step → smoothstep ramp
  botRubberNear(15u)→botRubberFar(90u), asym slow-down side (botRubberAsym 0.7, floor 0.55),
  extra capped catch-up 120→220u behind (botCatchupFar 0.3). KEY BUG FOUND: target-speed-only
  rubber was a silent no-op on straights — stepKart hard-caps bots at botCap; fix stashes the
  catch-up factor on p._rbBoost (reset each botTargetSpeed call) and stepKart lifts botCap by
  max(1,_rbBoost) (lift-only; leaders never capped down). Spin recovery: applySpinOut scales
  bot dur ×botRecoverMul(0.6) ramped over 20→80u behind; humans never scaled.
- **P2 rivals**: setupRoster picks 2 rival bots per prix race (0 in battle; humans never).
  Cup runs persist the SAME rivals across all 4 races via fk_cup_session.rivalNames
  (session shape is {cupId,raceIdx,points,loadout} — no racerId despite older docs).
  Rivals REPLACE the P1 curve with a leash: err past band [-rivalBandAhead 20, +rivalBandBack
  35] → f = clamp(1+err*rivalGain(0.004), rivalSlowFloor 0.75, rivalBoostCap 1.22), boost side
  feeds _rbBoost. Rivals get botSkill floor (rivalSkillFloor 1.0) but keep persona quirks;
  NON-rivals get rubberMul × nonRivalRubber(0.5) so the field spreads honestly.
- **P3 difficulty behavior gates**: DIFF_BEHAVIOR{easy,normal,hard} table beside DIFF_MUL
  (code-tunable like BOT_PERSONA, not sliders): drift 'off'/'sharp'(1.6× botDriftCurv)/'all',
  mistakeEvery 8/20/55s, itemConeMul .6/1/1.15, itemHoldMul 1.6/1/.75, trailAllowed,
  spiteOk (hard only), recoverBase (hard .85), rival leash muls (easy looser+capped .92,
  hard tighter+harder). applyBotPersona stashes p._beh + seeds p._mistakeT (skill-scaled).
  MISTAKE SYSTEM: advanceBotMistakes(p,dt) (called beside botUseItems at both sim-loop sites,
  skipped while spin/air/rescue/finished) rolls one of slow(tv×0.6,1s)/look(lookahead×0.5)/
  wide(apex offset inverted ×-0.6)/nodrift — easy bots are beatable because they ERR, not
  because they crawl. Hard floors botLineMul ≥1. None of _beh/_mErr/_mistakeT serialized (bots
  host-sim only; serializeKart confirmed clean). Wario-stadium measured: 213/400 samples over
  botDriftCurv, 156/400 over the sharp gate — natural tier separation on the default track;
  20s e2e driftFrames easy 0 / normal 1083 / hard 1235.
- **P4 item flavor**: BOT_PERSONA gains sig items (DD "special items", roll weight ×
  SIG_ITEM_BIAS 2.5, place gate stays authoritative so leaders never roll back-only sigs):
  Archie bull · Graffi tomato3 · Steffi boost · Oakley mimic · Annie star · Peyton chicken3 ·
  Daisy egg · Raspberry storm · Hay Bill+Silo Sam hay · Cluck Norris chicken · Mud Bug tomato.
  DIFF_BEHAVIOR.rollBias: easy {egg:0,storm:0,triples ×0.5}. SPITE (hard-only): spiteT=1.5s
  armed when the human's computePlace transitions to 1 (advanceSpiteTracking(dt), once per
  frame both sim branches, frozen+zeroed in battle); hard bots holding egg/storm fire into the
  window, tomato/chicken prioritize the human-in-cone. All bias paths p.isBot-gated — human
  rolls (local + hostGrantItems remotes) provably untouched.
- **P5 standing suite**: tools/_verify-bots.cjs (1014 lines, ~60s): Section A curated
  functional core (~57) + TUNE/table surface audit (~50) + Section B MEASURED race outcomes
  (~38): per tier, autopilot-human (driven by botInput — rubber no-ops on the human, honest
  reference driver) races 50s × 3 pooled seeds; ORDINAL asserts only (easy humanMeanPlace +1
  ≤ hard's; easy mistakes/min > 2× hard's; easy driftFrames 0, hard >0; rival mean-gap <
  non-rival mean-gap ±25%; spread >60u) + a MEASURED stdout table for eyeballing tune drift.
  145/145 ×3 consecutive runs. STABILITY LESSONS: seeding Math.random alone doesn't make the
  sim deterministic — Date.now()/performance.now() in cosmetic paths reorder the PRNG stream;
  stub BOTH clocks (fake monotonic) + pool 3 seeds and average; never hard-assert a MAX
  statistic (one bad corner = one-sample-takes-all — demote to informational).
- Scratchpad suites (finer-grained): fk_phase1_rubber 40/40 · fk_phase2_rivals 47/47 ·
  fk_phase3_difficulty 53/53 · fk_phase4_items 34/34. Regressions all green every phase:
  _verify-items 24/24 · _verify-audio 102/102 · _verify-hud-defaults PASS. E2E TEST TECHNIQUE:
  drive the "human" with botInput autopilot, pin gaps by moving the HUMAN's lap/progressS
  (pin the bot's baseline first — grid-start progress dwarfs the shift otherwise).

# 🏁 Farm Kart — "BUCKY'S MIDNIGHT RUN" original drift circuit (2026-07-17, Fable-designed)

New builtin `midnight-run` in BUILTIN_TRACKS (after toads-turnpike): an ORIGINAL drift-focused
night-city circuit reusing the full city kit (sky night · theme city · wallMargin 6 ·
traffic{count:8,speed:9}). 48 points, 1617u, laps 3, width 18. Lap: home straight → T1 90°R
sweeper → 4-corner esses (y0→2→0) → "Skyline Loop" ~200° climbing 180 (R≈40, y0→7.6) →
viaduct west at y8 CROSSING OVER the home straight (true over/under, d=3.4u XZ, Ygap 8) w/
boost pad (s .483) → downhill left carousel → CONCRETE TUNNEL (s .668, len 70) containing a
descending S-bend → "The Hook" ~170° L hairpin R≈20 + exit boost pad (s .81) → back esses w/
a RAMP-jump straight (aligned ramp object) → "Last Call" wide final sweeper onto a home
straight that leans FAINTLY EAST on purpose (P0 at (14,-4)) — closure tangent 2.7°; a literal
x=0 north home straight from the back-ess endpoint is topologically a hook, don't "fix" it.
DRIFT BAR (the design goal): scripted real-key drift runs reach mini-turbo TIER 2 in T1 +
Skyline Loop + Last Call (3/3). TEST GOTCHAS: kart height is p.y NOT p.pos.y (pos = {x,z});
drift tests must pin steer to p.drift.dir (full-lock) — proportional steer oscillates, never
trips mtChargeBonus (needs p.steer*dir>0.4) and understates drift tiers. Tightest corners:
hairpin r≈20, esses r≈22-28 — bots lap fine, do NOT tighten further. VERIFY:
tools/_verify-midnightrun.cjs 54/54 (sanitize round-trip + byte-identical, geometry incl.
closure kink 2.7°/slope 0.063/only-intended overlap, 3 bots lap 90s no-stuck, drift tiers,
city kit + tunnel-spans-S-bend + ramp aligned + pads on-road, over/under resolves both
branches, menu card + preview) + regressions turnpike 77/77, items 24/24, hud-defaults PASS.
Screens: shots/fk_midnight_{start,esses,tunnel,viaduct,mobile}.png. UNPUSHED (preview rule).
NOTE (same day): the family cloud doc settings_fam2jan2g/fkTracks had a saved EDITOR COPY of
toads-turnpike (hills remix: followTerrain, 218 sculpt cells, tunnel/bridge/ramp) SHADOWING
the builtin on all devices — renamed in-place to id `toads-turnpike-old` ("Toad's Turnpike
(old)", still playable from the course grid; backup in session scratchpad) so the night-city
builtin shows through. LESSON: a saved map/cloud entry under a builtin id always wins — when a
builtin gets reworked, check fkTracks for a shadowing copy. (Node gotcha hit doing the REST
write: `const URL=...` shadows the global URL class and breaks fetch with "Failed to parse
URL" — name it BASE.)

# 🏁 Farm Kart — "HARVEST HOLLOW" farm-life showcase track (2026-07-17, Fable-designed)

New builtin `harvest-hollow` — the first track composing the WHOLE farm feature set: dirt road,
pastures/cows, critter crossings, gated steam-train crossings, fordable water, ramp, props.
NEW GENERAL KEYS: `roadColor`/`curbColor` (sanitize: finite ints 0..0xffffff, omitted when
absent, byte-identical otherwise; terrainOpts precedence explicit track > theme > builder
default 0x33373d/0xdfe4ea). Hollow: road 0x8a6b45 / curb 0xb0996f, sky:"sun", wallMargin 8,
width 18, laps 3, 929u, 34 pts, closure kink 2.4°, winding exactly 360°. LAP: home lane
(fences+farmhouse) → T1 → pasture straight (2 pastures/6 cows + chicken crossing + TRAIN: loop
straddles the straight = TWO gated crossings — a closed train loop always crosses a road an
EVEN number of times) → crop esses (gold paint+crops) → FORD (road dips y−1.0, water level
−0.35 → depth 0.65 = wading 0.84x, NEVER drowns; hay ramp sy1.7/sz12 before it — top speed
clears the creek, maxY 8.4) → orchard esses → windmill hilltop turn (R≈20 uphill; a true 170°
hairpin breaks a non-self-intersecting 360° loop — softened deliberately, don't "restore" it)
→ barnyard chicane THROUGH farm_open_barn (mid support post on its centerline — offset ~5.5u
perpendicular + scale 30 so the line clears the post) + goat & chicken crossings → last
sweeper past the pond. 138 objects, 413 sculpt cells, 245 paint, 78 tufts, 2 boost pads.
KEY AUTHORING LESSON — FLOOD-FILL FORD CONTAINMENT: `waters` flood-fill runs away (2400+
cells) because groundHillAmp 3.4 puts ~40% of terrain below any usable level, all 4-connected;
fix = sculpt a SOLID RAISED PLATEAU RING via the terrain field (delta = target −
groundHills(cell), +0.8 out to r26 encircling the creek) — road dip self-seals at its ends,
plateau seals the perimeter, 0 leak. objects[type:'water'] slabs do NOT splash — only
flood-fill `waters` feeds WATER_LOOKUP/waterAt. Depth consts: WATER_SHALLOW_K 0.35×H≈0.55
wade, WATER_DROWN_K 2.0×H≈3.14 drown. TRAIN SCREENSHOT GOTCHA: train speed is closure-local —
to freeze it, no-op TRAIN_GROUP.userData.update after seating (userData.trains[0].speed does
nothing). Cow pastures: centers must be off-road (_randomCowSpot falls back to pasture
CENTER). Generator: tools/_hh_build.cjs re-patches the HH_GEN_START/END block (idempotent).
VERIFY: tools/_verify-harvesthollow.cjs 70/70 0 pageerrors (sanitize isolation, geometry,
dirt-vs-default colors, ford wade/splash/no-crow/containment, ramp-clears-water, chicken+goat
spins, train gates lower/spin/rise, cows ≥19u off-road 30s, drift tier≥2 in T1+orchard+last,
3 bots lap + all cross the ford, menu, mobile) + midnightrun 65/65 + turnpike 88/88 (one 87/88
flake on a timing-dependent overpass-seating check, passes on retry — pre-existing) + items
24/24 + hud PASS. Shots: shots/fk_harvest_{start,pasture,train,ford,windmill,barn,mobile}.png.
UNPUSHED (preview rule). The session's 3 new tracks (toads-turnpike rework · midnight-run ·
harvest-hollow) all await ONE user-approved push; name the Cursor agent's concurrent work in
the commit when it ships.
- 🎉 FARM PARTY PIVOT (2026-07-17, user direction, opus agent): Storybook is no longer a
  standalone game — farmparty.html (3389 lines, evolved FROM storybook.html which stays
  byte-identical on disk as the verified reference; retire it at go-live) is a
  Mario-Party-style suite shell: PARTY phase machine title→lobby→select→minigame→result→
  select (party persists across rounds; ONE page because a Playroom room dies on
  navigation). PARTY object above the minigame's G; select screen = per-char tally strip
  (session-scoped PARTY.tally, sb_wins still lifetime) + MINIGAMES registry cards (📖
  Storybook Squish ready + 2 SOON placeholders); host picks w/ live hover sync ("«host» is
  picking!", guests read-only); solo party offers Match + classic Challenge (sb_best kept);
  result overlay bumps the winner's tally (+1 🏆) → host-only "Back to the games!".
  MINIGAME INTERFACE (the template for game #2): { id, name, ico, ready, soloModes?,
  start(ctx{party,subMode,isHost}), hostTick(dt), guestTick(dt), isOver(), result()→
  {draw,winnerChar}|null, teardown() } — shell owns phase/seats/tally/networking, minigame
  owns its sim+render while active; snap gains party:{phase,game,hover,tally}; new games
  add namespaced snap keys only. Leak contract: teardown returns sceneChildCount to
  baseline (measured 230 across 2 full loops, asserted). Lobby chip nit fixed ("Bucky
  (you)"). Hook renamed __BOOK__→__PARTY__ (old accessors kept + partyState/selectCard/
  hostBackToSelect/sceneChildCount etc.). VERIFIED: farmparty_verify.cjs 139/139 ×4 (full
  114 ported + ~19 shell checks incl. second-match loop + leak proof), fp_mp_local.cjs
  10/10 (lazy SDK, blocked-CDN → solo-party fallback), fp_mp_live.cjs 39/39 ×2 vs REAL
  Playroom (2 processes: lobby→select sync→hover→match→cross-screen elimination→result
  both→back-to-select w/ tally on both→SECOND match→both disconnect directions), 0
  pageerrors everywhere. Shots fp_title/fp_select/fp_select_guest/fp_result + ported set.
  Step-by-step "add minigame #2" guide in the build agent's report (this session's task
  transcript); STILL UNTRACKED/UNPUSHED — go-live bundle when approved: games.html +
  PLAY_GAMES tiles for Farm Party, Firestore lobbies_<familyKey>/sb_* JOIN cards, retire
  storybook.html, ONE push.

# 🛡 Farm Kart — TANK BATTLE co-op MVP (2026-07-18, Fable + opus agent, UNCOMMITTED — awaiting family playtest)

Battle-mode pivot (user): co-op Double-Dash-style TANK — one drives, one guns. MVP is couch/solo
only; old balloon battle + racing byte-identical (everything gated on `ACTIVE_TRACK.tankBattle`).
- New sanitize key `tankBattle:true` + builtin arena `downtown-showdown` ("Downtown Showdown",
  battle+tankBattle+sky:night+theme:city+offroad, 130×130): 16 SOLID lit-window buildings +
  perimeter — visuals DERIVED IN-GAME from the track's ghostWalls rectangles (one source: collision
  and visuals can never drift; building height encoded in id `bld_<h>`), 2-lane streets + central
  plaza, 9 battleBoxes at intersections, 8 lamps. Generator tools/_dt_build.cjs (marked-block).
  buildCityscape gated OFF for tank arenas (its buildings are collision-less).
- TANK: KART_STATS ×(top .68, accel .85), drift/mini-turbo intact. Procedural turret (ring/mantlet/
  barrel), WORLD-relative yaw (holds heading while hull drifts). GUNNER: ←→ aim 3.2 rad/s, Enter
  fire. SOLO: 4s without gunner input → auto-aim nearest enemy, F fires, any arrow retakes manual.
  Couch DRIVER: WASD+Space. Mobile boots + auto-aim + FIRE btn (manual touch aim = deferred gap).
- AMMO: cannon shell default (∞, 0.9s reload, ~2× tomato speed, detonates on buildings — never
  through) pops balloons via the existing battle path; battleBoxes grant chicken3/tomato3(±10°)/
  hay mine, fired along turret aim, then revert. HUD ammo chip + reload bar.
- ENEMIES: 2 red AI tanks (3 balloons; player 5). Driving = street-waypoint roam + RANDOM-WALK
  unstick (KEY LESSON: the open-field battleBotInput wedges on city walls, and reverse+turn
  oscillates in corners — random-heading-until-moving slides free; worst stuck 0.8s over 8×30s).
  Enemy turrets track player ±6°, fire 2.8-3.8s, LOS-gated (segment-vs-building — no through-wall
  shots). Win "🏆 CITY CHAMPIONS!" / lose "TANK DOWN" (gentle), both restart cleanly.
- READABILITY PASS (Fable reviewer bounce — first screenshots had an invisible tank + balloon
  cluster filling the frame): tankBattle hemi 0.95/sun 0.8 (city keeps 0.58/0.52), emissive lift
  hull ×0.36 / turret ×0.38 / barrel ×0.42 (traffic-vehicle convention), balloons ×0.55 raised
  +2.85 forward +0.75, TANK_CAM {dist 1.35, height 1.3} multiplier inside camDistEff/camHeightEff
  (MOBILE_CAM precedent — composes, zero per-site edits). Muzzle-flash scale clamped.
- GOTCHAS: turret built LAZILY in syncTurret (buildKartView runs at boot before TANK consts init —
  const TDZ); building emissiveMap needs material color WHITE; net._grantDt mirrored into
  soloRaceTick (was MP-host-only) for solo box grants; snapCameraBehind exposed for screenshot
  poses after teleports.
- VERIFY: tools/_verify-tankbattle.cjs 75/75 ×stable (sanitize byte-identical all 19 prior tracks,
  4-dir building solidity + projectile-vs-building, speed ratio .68 measured, drift tier as tank,
  turret independence/auto-aim/override, shell/specials/reload/pop, roam no-stuck, LOS blocked+
  clear, win/lose/restart, TANK_CAM ratios, balloon scale, classic-battle unmultiplied camera +
  scale-1 regressions) + items 24/24 + hud PASS + midnightrun 65/65 + barnyard-brawl classic
  battle boots/pops with no turret. Shots: shots/fk_tank_{arena,aim,fire,battle,win,mobile}.png.
- DEFERRED (post-playtest): online driver/gunner Playroom pairing (state shaped for it), manual
  touch/mouse gunner aim, arenas/rounds/scoring, ramming rules, richer audio. Entry: Single
  Player → "🛡 TANK BATTLE (2P co-op)" card. NOTE: Cursor agent concurrently wiring "Farm Party"
  (games.html/index.html hunks are theirs).
- 🚀 FARM PARTY WENT LIVE (2026-07-17): lobby cards (fp_<code> docs, game:"farmparty" 🎉,
  status open in lobby/select/result + started only mid-minigame, 15s heartbeat, verified
  28/28 live vs famtestfp incl. real guest join + games.html card swap) + 🎉 tiles first in
  games.html GAMES and index.html PLAY_GAMES + storybook.html RETIRED (backup in the
  session scratchpad; zero tracked references). Shipped: farmparty.html, games/index tiles,
  cast GLBs (assets/cast/{bucky,goat}/*.glb + presets txt; RAW intermediates gitignored via
  assets/cast/*/*/). farmkart.html + farmkart-track.js changes (bot overhaul + Cursor city
  theme) deliberately NOT shipped — still awaiting playtest.
- TOME + PAGE-SOURCE + JOSTLING (2026-07-17, user playtest of live Farm Party; LOCAL/unpushed):
  (1) TOME — TUNE.TOME_TOP_Y=1.55 single raised-surface const (every table-level Y routes
  through it; camera target+content shift by the same const so fitCamera fit is provably
  identical, portrait fill still 29.7%); buildBook adds tomeCover (deep red slab + gold trim)
  + ~1.23u cream tomePageBlock w/ makePageStackTexture striped page-edge sides. (2) PAGE
  SOURCE — unreadWedge group at the hinge, WEDGE_TILT_RAD 28°; page REST pose = the wedge
  tilt and both flip interpolators ramp WEDGE_TILT→π (pages peel off the stack); landed
  mirror math UNCHANGED (end-state fn; suite localToWorld check + a new from-rest-angle
  check). Wedge thins by wedgeRemainingFrac() from synced G.page (guest updateWedge after
  applySnapshot — no new wire state). VISUAL COMPROMISE flagged: camera pitch ≈ wedge slope
  makes a faithful thin wedge nearly invisible — shipped as a short/deep/tall gold-tan band
  (0.85u×2.2u) at the fold; revisit if the user wants a dramatic freestanding stack.
  (3) JOSTLING — CHAR_R 0.42, 2-iteration pairwise soft separation each frame among alive/
  revealed/non-pancaked chars; MP ownership: separationMovableIds() = non-isRemote (host
  moves bots+self, NEVER adopted guests; guests separate only their own char) — proven by
  an offline fake-net unit (remote displacement 0.000000) + live 39/39; bots re-pick a
  crowded stand-point at most once/page (_repicked flag; same-hole planning min-dist
  0.6→CHAR_R*2); judgment untouched (shove-outs at slam = authentic). Bump blip (tone(),
  rate-limited 0.15s) + 0.06s micro-squash. Suite 139→167 checks ×4 green; fp_mp_local
  10/10; fp_mp_live 39/39 real backend. One pre-existing "bot competence" check got a
  bounded 3-retry wrapper (crowded-shove of a shared small hole is designed behavior, not
  a pathing bug — diagnosed at exactly 0.840u separation). Shots fp_tome_*.png/fp_jostle.png.
- MOO STAMPEDE! minigame #2 (2026-07-18, opus agent, LOCAL/unpushed): id 'stampede' 🐄 in
  MINIGAMES (after storybook; placeholders kept) — 30s survival on a floating pond dock,
  procedural toon cows (shared geo, ~121 tris/cow, cap ramps to ~30 concurrent at frenzy)
  stampede right→left and ACCELERATE before plunging off (signature detail); calf/cow/GIANT
  (3.6-4.4x, 1.2s "❗ MOOOO!" warning + rumble); contact SHOVES (contact-duration trampling
  escalates the carry — the asymmetric skill lever that keeps bots fair); off any edge =
  splash+spectate; last-standing wins instantly, timer-end ≥2 alive = draw, simultaneous
  wipeout = draw. Solo modes: match (vs 3 bots) + challenge (endless, best in
  fp_stampede_best). Bots err-based (late reacts/wrong dodges/dawdle), measured mean ~18s,
  competent proxy 15/16 wins. MP mirrors storybook wire: snap.smp={t,md,warn,wl,cows:[[id,
  type,x,z,size]]} (~0.25-0.7KB @12Hz), guests interp cows by id-diff + publish own pos;
  live-verified 22/22 vs real Playroom (2 browsers). SMP module farmparty.html ~L4071-4781;
  shell seams guarded by stampedeActive() (checks ACTIVE_MINIGAME OR mirrored
  PARTY.selectedGame — guests never get ACTIVE_MINIGAME). Storybook tome/wedge/scenery
  groups HIDDEN during stampede, restored on teardown; teardown → sceneChildCount baseline.
  Suites (scratchpad): fp_stampede.cjs 57/57 (proxy check hardened to N=16 ≥10 wins — N=10
  ≥7 flaked at ~1-in-8 by binomial noise), fp_stampede_mp_local 5/5, fp_stampede_mp_live
  22/22. Minigame #3 friction note: elimination visuals + snap payload need small guarded
  branches in guestTick/buildSnapshot/applySnapshot (future: lift into optional interface
  methods eliminateVisual/buildSnap/applySnap).

# 🏁 Farm Kart — SIX-TRACK THEME PACK (2026-07-18, Fable-designed, 2 opus waves — UNCOMMITTED)

Six bare MK64 layout ports re-themed into original courses (ids/XZ shapes byte-identical to
HEAD — cups/bests/links intact; only `name` + theming data changed). User bars: great to look
at · consistent theme · NO objects in the road · fun to play. New sanitize key `decor`
(whitelist 'skyway'|'pumpkin'|'stadium') gating 3 new night builders.
- `kalimari-desert` → **"Dust Devil Gulch"**: sun sky, road 0x9c7a50 + warm verge band
  0xbb8250 (reviewer bounce: original 0xc2a36b road vanished into the sand paint), mesas via
  sculpt, western town (saloon/well/windmill), cacti/rocks/skulls edge dressing, 2 tumbleweed
  crossings, steam-train loop w/ 2 gated crossings, 203 props.
- `koopa-troopa-beach` → **"Seashell Shores"**: clouds sky, seaLevel −0.45 surrounds the course
  (53% water), sand road 0xd8c48e, palms/tents/driftwood, 2 crab crossings. REVIEWER BOUNCE +
  LESSON: the original +0.6 shore berm HID the entire sea from kart eye height — reshaped to a
  +0.05 beach strip w/ waterline ~19u from centerline; the suite now has a durable SEA-VISIBILITY
  check (8 road samples, eye-height sight-line must reach water ≤60u unoccluded, ≥6/8). Theme
  must read FROM THE DRIVER'S SEAT, not the map view. Generator `keep()` max-abs rule silently
  drowned the palm islets — discTarget gained a 'force' overwrite mode.
- `dks-jungle-parkway` → **"Croc Creek Canopy"**: clouds sky, dirt 0x7a6248, seaLevel −15.5
  river beside the gorge road (2.8% water), 485 props (canopy walls + slope understory),
  2 turtle crossings, bridge/waterfall/river-rocks. LESSONS: sculpt channels must clear the
  road skirt (half+margin≈18u — an early creek carved the road edge into a pit and bots fell);
  bunched bots can PHYSICALLY lap but miss checkFinishGate's ~10u lateral credit window —
  drivability tests must use a wrap-aware arc-length ODOMETER, not the credit counter; posed
  (snapCameraBehind) shots beat driven shots for determinism (frame-rate-dependent depth
  tripped the camera pit-lift into an overhead view).
- `rainbow-road` → **"Starlight Skyway"** (showstopper): AUTHORIZED uniform Y+100 (XZ identical;
  road floats 11.5-100u), night sky, road 0x6a5cff/curb 0xeef0ff + FK_TRACK.buildSkywayDecor
  (additive glowing road edges, star/glow-orb field, 3 ringed pastel planets, twinkle), ground
  painted near-void 0x090b16, tufts skipped, 5 boost pads, wallMargin 12 (WIDER margins let a
  bot loop into the over/under gap — 12 is the sweet spot), deliberate-fall→crow verified
  branch-aware, drift tier2 3/3.
- `choco-mountain` → **"Pumpkin Hollow"**: night sky + warm hemi 0.75 dusk lift, path 0x6b5a48,
  FK_TRACK.buildPumpkinLamps (jack-o-lantern street lamps: carved-face emissive canvas, glow +
  road pool, arc-walk + own-sample seating on climbs), autumn paint (1201 cells), 204 props
  (dark pines/mushrooms/stumps/abandoned camp), covered bridge, 2 goat crossings, NO water (the
  layout's self-merge valley offers no safe creek spot). KNOWN: base layout has a self-merge
  pinch (frac 0.55↔0.88 ~8u apart, roads overlap) that snags bots seed-dependently — geometry
  locked, handled via best-of-3 seed pooling in the suite's B-pass.
- `wario-stadium` → **"Thunderdome Supercross"**: night + cool-white hemi 0.9 floodlit, dirt
  0x8a6a4a, 165 race-kit props (grandstand runs, banner towers, corner light towers, 2 overhead
  gantries — 9u clearance asserted, pit cluster, pylons, checker start paint), 4 supercross
  ramps (~8u air) + 3 pads, drift 3/3. NOTE: wario-stadium is the BOOT DEFAULT track — the
  game now boots showing "Thunderdome Supercross" (flagged to user; 1-line change if unwanted).
  Reviewer bounce: the signature screenshot config posed at a barren back corner (s0.402) —
  re-aimed to the main-straight ramp (s0.085) where the grandstands frame the jump.
VERIFY: tools/_verify-themepack.cjs (config-driven, both waves) **249/249** exit 0 — per track:
XZ byte-identity (skyway Y=HEAD+100 exact), all-other-tracks sanitize byte-identical, road-
clearance sweep (no in-road/floating/buried props; ramps + verified gantry spans exempt), water
safety + crow checks, bot odometer laps (3 bots), drift tiers, feature checks (crossings/train/
lamps/gantries/ramps/pads), menu cards, mobile passes. Regressions: items 24/24 · hud PASS ·
tankbattle 75/75 · midnightrun 65/65 (3 stale assertions in those suites updated for renames/
decor key — documented inline). Generators tools/_w1_build.cjs + _w2_build.cjs (marker-baked).
Shots: shots/fk_{gulch,shores,canopy,skyway,hollow,thunder}_{start,signature,drift}.png +
fk_wave{1,2}_mobile.png. ALL UNCOMMITTED — one push bundle after user preview (incl. Tank
Battle MVP; name Cursor's concurrent Farm Party work in the commit).
- 🚀 PUSHED 2026-07-18: the tome/page-source/jostling batch + the art polish round (standing
  68° book half, aged-paper print language, farm-study scenery) + the OTHER session's Moo
  Stampede minigame #2 shipped together in one farmparty.html commit. Pre-push combined
  verification: farmparty_verify 191 checks clean on re-run (one perf-stability flake under
  parallel-Chrome load only), fp_stampede.cjs 57/57 run from ITS session scratchpad
  (460d3b7d…/scratchpad — suites live in their OWN session dirs), fp_mp_local 10/10. Suite
  card-count assertions updated 3→4 cards / 1→2 playable for the new registry reality.

---
