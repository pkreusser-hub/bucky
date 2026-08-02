# Sprite impostors on Farmstead's 3D terrain — viability

**Demo:** http://localhost:8790/farmstead-proto/sprite/spritedemo.html
**Verify:** `node farmstead-proto/sprite/_verify.cjs [--shots]` — 38/38, 0 pageerrors.
(Needs the repo served on :8790; uses `tools/node_modules/puppeteer-core` + real Chrome.)
Frozen experiment. Nothing here is wired into the game; nothing outside
`farmstead-proto/sprite/` and `shots/fs_sprite_*.png` was touched.

---

## Verdict

**The technique works and looks right. Farmstead does not currently need it.**

Two separate findings, in that order.

**It works.** At the zoom the game actually plays at, a baked sprite of the Tripo
villager is indistinguishable from the 6000-triangle mesh — swap every mesh in the
frame for a sprite and 4-5% of pixels change by more than 12/255, with a mean
difference of about 2/255 over the whole image. Look at `shots/fs_sprite_sidebyside.png`:
the left half is sprites, the right half is meshes, and you have to be told which
is which. 1000 units cost 2,000 triangles instead of 7.6M.

**It is not needed.** Impostors only pay off against a triangle budget problem,
and Farmstead does not have one:

| villager cut | tris each | ×800 (4 players at `SERF_CAP` 200) |
|---|---:|---:|
| today's procedural minifig | ~140 | 112k |
| **`-lo-vc`, what `fs-models.js` loads right now** | **2,039** | **1.6M** |
| `-vc` / textured, full detail | 7,600 | 6.1M |
| sprite impostor | 2 | 1.6k |

While I was building this, the parallel Farmstead work landed a decimated
`villager-*-lo-vc.glb` set — 1498-triangle body, 271/270-triangle legs — and
`fs-models.js` already sets `detail: "lo"`. 1.6M triangles for a full four-player
settlement is an ordinary frame. Nothing is on fire.

So: **build this if and only if a real device fails on the lo cut** (an old
tablet, a Chromebook, or a later decision to raise `SERF_CAP` or add animals and
carts on top). The demo exists so that call can be made from measurements instead
of guesses, and the code is ready to lift if the answer ever changes.

One free finding either way: the lo cut bakes into essentially the same sprite as
the full-detail one (local contrast 10.74 vs 11.65, luminance 91.2 vs 91.4). If
impostors ever ship, bake from `-lo-vc` — it costs nothing and loads faster.

---

## What the demo is

Real Farmstead terrain (frozen copies of `fs-const.js` + `fs-map.js`, and the
terrain build, lighting rig, fog and camera lifted verbatim out of `fs-render.js`),
populated with wandering villagers that render three ways: all sprites, all 3D
meshes, or split down the middle of the board. Drag to orbit, shift/right-drag to
pan, wheel to zoom. Every toggle is in the panel; every one is also a URL param
(`?mode=split&count=1000&angles=8&cell=64&light=flat&bb=axis&statics=sprite`),
plus `?variant=lo` for the 2039-triangle cut and `?variant=tex` for the textured
GLBs.

The impostors are baked **in-engine at boot**: the villager GLB is assembled
(body + two legs pivoted at their measured hips), posed through the same walk
maths `fs-render.js` uses (`LEG_SWING` 0.52 rad counter-phase, `|cos(phase)|·0.052`
bob, ±0.10 torso twist, −0.055 roll), and rendered into one `WebGLRenderTarget`
atlas from N azimuths × 7 poses (1 idle + 6 walk) with an orthographic camera
pitched to match the game camera. Drawing is one `InstancedMesh` of quads with a
per-instance `aFrame` float selecting the atlas tile; the billboard and the atlas
UV are injected into `MeshBasicMaterial` via `onBeforeCompile`, so fog, alpha-test
and tone mapping come along unchanged.

---

## Objective numbers

All measured by `_verify.cjs` off `renderer.info`, 1280×800. The units wander,
so image-difference figures move a few tenths between runs; ranges below are what
three consecutive runs produced.

### Draw calls and triangles

| units | mode | draw calls | triangles |
|---:|---|---:|---:|
| 50 | sprite | 4 | 5,020 |
| 50 | mesh | 6 | 384,920 |
| 200 | sprite | 4 | 6,820 |
| 200 | mesh | 6 | 1,526,420 |
| 1000 | sprite | 4 | 16,420 |
| 1000 | mesh | 6 | 7,614,420 |
| 1000 | split | 7 | 3,048,022 |
| 1000 | mesh, `-lo-vc` cut | 6 | 2,053,420 |

The scene floor is 4,420 triangles (terrain lattice + water). So at 1000 units the
sprites themselves cost **2,000 triangles** and the meshes cost **7.6M** — a 3800×
reduction on the units, 464× on the whole frame.

Worth noticing: at 1000 units the **blob shadows cost 10,000 triangles, five times
the sprites**. Once units are impostors, the contact shadow is the expensive part
of a unit, and it should become a texture-atlas tile or a decal rather than a
10-segment `CircleGeometry`.

Draw calls barely move (4 vs 6) because the mesh path is already instanced —
body, legL, legR, one call each. Impostors are a **triangle** win, not a
draw-call win. Anyone selling this on "fewer draw calls" is wrong.

### Atlas cost

| angles | cell px | atlas | MB (RGBA8 + mips) | bake ms |
|---:|---:|---|---:|---:|
| 8 | 64 | 512×448 | 1.17 | 316 |
| 8 | 128 | 1024×896 | 4.69 | 655 |
| 8 | 256 | 2048×1792 | 18.76 | 1887 |
| 16 | 64 | 1024×448 | 2.35 | 1061 |
| 16 | 128 | 2048×896 | 9.38 | 2786 |
| 16 | 256 | 4096×1792 | 37.52 | 6747 |

**The bake times are ANGLE/SwiftShader CPU rasterisation and are ~1-2 orders of
magnitude pessimistic.** 16×128 is 112 renders of a 7600-triangle model into 1.8M
pixels; any real GPU does that in well under 100 ms. Treat the table as a
*relative* cost curve. On the user's GPU, verify before deciding whether to bake
at boot or ship prebaked sheets — the answer is probably "bake at boot, it's
free".

Sizing: on a 1080-tall viewport the villager is 26 px at the default zoom
(`DIST_START` 34), 109 px at the closest the game allows (`DIST_MIN` 8), 11 px at
`DIST_MAX` 80. **128 px cells cover the whole zoom range with headroom; 64 px is
right for the default zoom and blurs at max zoom-in; 256 px is waste.** 16 angles
at 128 px — 9.4 MB — is the setting to ship.

### Angle popping

Mean absolute per-pixel change when the camera orbits by exactly one atlas bin,
same frozen scene:

| | one bin | 1/8 bin |
|---|---:|---:|
| 8 angles (45°) | 13.3 – 13.6 | 0.76 – 0.92 |
| 16 angles (22.5°) | 6.5 – 7.1 | 0.27 |
| real 3D mesh, same 22.5° step | 6.7 – 7.0 | 0.14 – 0.19 |

**At 16 angles the frame-to-frame change is statistically identical to the real
mesh — 6.5-7.1 against 6.7-7.0 across runs.** The impostor is not visibly "stepping" — the camera has
moved 22.5°, and a real mesh's silhouette changes by about that much anyway. At
8 angles it is twice the mesh's change, and you can see it. Ship 16.

The 1/8-bin column is the popping signature: within a bin the sprite does not
change at all until it flips, so a slow orbit reads as a series of small jumps
rather than continuous motion. At 26 px that is invisible. At the closest zoom
it is a mild shimmer during a deliberate slow orbit, and nothing during play.

### Lighting cohesion

Whole-frame mean luminance, identical scene and camera:

| | mean luminance | mesh↔sprite image difference |
|---|---:|---|
| 3D meshes | 129.4 | — |
| sprites, **lit** bake | 127.8 – 128.3 | 1.7 – 2.0/255 mean, 4.0 – 4.6% of pixels differ >12 |
| sprites, **flat** bake + per-instance sun tint | 127.6 – 127.9 | 1.9 – 2.3/255 mean, 4.4 – 4.9% of pixels differ >12 |

**The lit bake wins, narrowly.** Both are close enough that this is not the axis
to agonise over.

The bake's key light is placed in the *bake camera's* frame, not the world's, and
that is forced, not lazy. A frame indexed by `cameraYaw − unitYaw` serves every
(facing, camera) pair with the same difference, and those pairs have different
sun-relative geometry — so a Δ-indexed atlas provably cannot carry a world-fixed
sun. Measured cost of getting the sun side wrong: flipping the bake key light
left↔right changes the baked pixels by **12.7/255, about 13.8% of their mean
luminance**. That is the ceiling on the lighting error, and it is invisible at
26 px. In `shots/fs_sprite_closeup.png` (109 px, the closest the game zooms) the
sprite does read slightly darker and warmer than the mesh beside it — that is
this error, and it is the one artefact a player could notice.

---

## Visual assessment

- `fs_sprite_sidebyside.png` — 200 units at play zoom, sprites left of the
  midline, meshes right. Cohesive. No seam, no size mismatch, no lighting break
  across the line.
- `fs_sprite_closeup.png` — the same walk pose and facing at `DIST_MIN`, sprite
  left, mesh right. Registration is exact: same height, same footing, same
  silhouette. The sprite is softer (a 128 px tile magnified) and a shade darker.
  This is the worst case, and it is acceptable.
- `fs_sprite_orbit_a/b/c.png` — one frozen scene at yaw 0, 120°, 240°. Every unit
  swaps to the correct facing; nothing tips, nothing slides.
- `fs_sprite_1000units.png` — 1000 sprites, 4 draw calls, 16,420 triangles.
- **Slope contact** is correct. Units seat on the interpolated terrain height and
  the quad is anchored so the model's ground point lands on the ground point —
  see the villagers walking across the snow ridge in the side-by-side shot.
- **Sorting** is clean. Alpha-test cutout (0.3), no blending, so sprites z-test
  against terrain, water and each other with no sorting order to get wrong. The
  one place it needed help is the depth bias, below.

### Two things that had to be solved, and will bite anyone who redoes this

**1. The quad must be view-aligned, not cylindrical.** A classic cylindrical
billboard (world-up stays up, quad only yaws) is the obvious choice for a ground
unit, and it is wrong here. The bake is an *orthographic* render from a pitched
camera, so its vertical axis is foreshortened world height; a vertical quad needs
a 1/cos(pitch) stretch to occupy the same screen height as the mesh, and even
then its content is a card standing in a hole. A view-aligned quad — the camera's
own image plane — reproduces the baked tile 1:1 with no correction anywhere. Both
modes are in the demo (`quad: view-aligned | cylindrical`); the difference is
obvious at the closest zoom.

**2. The quad needs a depth bias toward the camera.** An orthographic bake at
pitch p contains pixels *below* the model's ground anchor — the near-side foot,
seen from above. On any plane through the anchor those pixels land at or under
the ground, so the terrain z-tests them away and every unit renders with its feet
sliced off. Pushing the whole quad ~0.22 × the quad width toward the camera fixes
it. The `bias: 0` button in the demo shows the failure.

---

## Statics: don't

`shots/fs_sprite_statics_impostor.png` vs `fs_sprite_statics_mesh.png` at the
bake azimuth look the same. `fs_sprite_statics_impostor_orbit.png` vs
`fs_sprite_statics_mesh_orbit.png` — after orbiting ~110° — do not. The barns
read as flat rectangles pasted on the hillside and sink into the terrain, because
a large object's silhouette changes far more within a 22.5° bin than a small one's
does, and because a view-aligned card that is 3 m tall leans that much further
into the ground. The trees survive (small, nearly radially symmetric); the barns
do not.

And the economics are backwards. Farmstead's trees are ~80-200 triangles of
merged procedural geometry drawn from instanced pools. Impostoring them trades a
few thousand triangles for an atlas, a bake, and a visible artefact. (The demo's
statics comparison shows 134 draw calls for meshes vs 5 for impostors — ignore
that, the demo clones each tree as its own `Group` where the game instances them.
The honest comparison is ~2 calls either way.)

Buildings are the one static worth reconsidering later, and only if Farmstead
ever ships a genuinely heavy castle model. Even then the answer is an LOD mesh,
not a billboard.

---

## The camera question

I checked, because it changes everything: **Farmstead's camera orbits.**
`fs-render.js` binds right-click and shift-drag to `cam.yaw += dx * CAM.ORBIT_YAW`,
and Q/E to `CAM.YAW_RATE`. Pitch is draggable too, clamped by `FSC.CAM` to
35°–70°, starting at 52°. Zoom runs 8–80, starting at 34.

That is the hardest case for impostors, and it is why the demo is built around
orbiting rather than a fixed-yaw pan. Two consequences:

- **Full 360° azimuth coverage is mandatory.** If the camera were fixed-yaw, the
  atlas would only need to track unit facing, an 8-angle sheet would do, and you
  could bake per-facing world-space lighting correctly. None of those shortcuts
  are available.
- **Pitch is the unsolved axis.** The atlas is baked at one pitch. At the bake
  pitch the sprite is exact; at 35° or 70° the content is a 52° view drawn on a
  correctly-oriented card. The demo's "re-bake @ pitch" button re-bakes at the
  live pitch so you can feel the difference — it is small over ±10° and visible
  at the extremes. Production options, cheapest first: (a) clamp the shipped
  pitch range; (b) bake 2-3 pitch rows and pick the nearest (2-3× atlas, so
  ~19-28 MB at 16×128); (c) blend two pitch rows in the shader. **(b) is what I
  would do.**

---

## What production integration would touch

Nothing in the sim, nothing in the net layer. Impostors are render-only, so
multiplayer determinism is unaffected — the demo already proves per-instance
tinting works (`tint on`), which is how player colours would ride along, and a
tint is a per-instance attribute write with no sim involvement.

1. **`fs-models.js`** — the loading half is already done. That file now carries
   its own ~90-line GLB reader (Farmstead deliberately does not vendor
   `GLTFLoader` — the castle GLB took it away) plus an async `cast` object with a
   `cast.gen` generation counter that makes `fs-render` drop stale pools, and the
   procedural minifig kept as the permanent fallback. An impostor path would hang
   off exactly that switch: bake once when `cast.ready` flips, tick `cast.gen`.
2. **`fs-render.js` `syncSerfs`/`drawSerf`** — the swap point. Today it pushes a
   body matrix into `dynPool("serf:job:player")` and calls `pushLegs`. The
   impostor path replaces both with one `setMatrixAt` + one `aFrame` write. The
   existing `vis` object already carries everything needed (`x`, `y`, `z`, `yaw`,
   `phase`, `speed`), so the walk-phase → atlas-row mapping is a two-line
   function.
3. **Carried crates, hats, tools, knights.** This is the real work. The current
   serf composes a per-job geometry (`serfGeo(job, player)`) with a tool in hand,
   a profession-coloured hat and a player sash, and draws a carried crate as a
   separate instance above the head. A single-character atlas cannot express that.
   Either bake per job (atlas × job count — 9.4 MB × N is quickly unaffordable),
   or keep small attachments as real 3D geometry on top of the sprite body (works,
   but the attachment has to be depth-biased to match), or accept a plainer serf.
   **Budget most of the effort here, not in the sprite system.**
4. **Boot cost.** One bake at world init, measured in tens of milliseconds on a
   real GPU. Nothing else changes.

Rough effort: **2-3 days** for units with no attachments, lifting
`sprite-impostor.js` nearly as-is. **A week or more** including jobs, carried
goods and knights. Against a 1.6M-triangle problem that already runs, that is not
a trade worth making today.

---

## Findings that belong in the handoff regardless

- **`villager-body-vc.glb`'s COLOR_0 is display-referred, not scene-linear.**
  Measured mean (0.69, 0.49, 0.33) — already the tan the Blender preview shows.
  Running the usual `convertLinearToSRGB` ([[gltf-linear-color-gotcha]]) pushes it
  to ~0.85 and the peasant blows out to a white blob under the farm's
  hemi 0.58 + sun 0.72 + fill 0.20 rig. Pass it through untouched. (The game's own
  integration reached the same answer independently — `fs-models.js` sets
  `cast.srgb = false`. Two measurements, one conclusion.)
- **The villager is authored much brighter than the world it goes into.** Even
  untouched, its modal colour (0.75, 0.50, 0.38) sits well above the grass base
  (0.42, 0.58, 0.31), and with the standard 0.34 serf emissive lift it clips. The
  demo applies a 0.72 gain and a gentler warm lift (`IMP.VC_GAIN` /
  `IMP.EMISSIVE_K` in `sprite-impostor.js`). Whoever integrates the asset has to
  make the same call somewhere — re-bake the vertex colours, or per-body-kind
  material constants.
- **The textured GLBs also carry an all-zero COLOR_0 attribute** left over from
  the vc pipeline. Honouring it multiplies the baseColor map to black — the baked
  luminance drops to 55.9, which is exactly the emissive lift alone. Trust vertex
  colours only on the `-vc` variant.
- **Textured vs vertex-coloured bakes identically at sprite resolution** (local
  contrast 11.65 vs 11.77, mean luminance 91.4 vs 91.7, same coverage). Use the
  vertex-coloured set: no texture to bind, matches the game's `vcMat` pipeline,
  and 362 KB on disk against 466 KB (the `-lo-vc` cut is 120 KB).
- **`WebGLRenderer.setViewport`/`setScissor` take logical pixels and multiply by
  the renderer's pixel ratio.** Baking tiles on a dPR-2 display places them at 2×
  the offset and size, and restoring with `setViewport(0, 0, canvas.width, …)` —
  where `canvas.width` is already device pixels — doubles again and leaves the
  *whole game* rendering into the bottom-left quadrant, magnified. The bake sets
  pixel ratio to 1 and restores the saved `getViewport`/`getScissor` vectors.
  This cost me the longest debugging detour in the build; the comment in
  `sprite-impostor.js` exists to stop it happening twice.
- **GL work is queued, so timing a bake with `performance.now()` measures the
  submit, not the render.** A 4096 px atlas "baked in 2.7 ms" until a 1-pixel
  `readRenderTargetPixels` was added to drain the pipeline.
- **Atlas mipmaps bleed across tiles.** The demo pads each tile with a 6%
  transparent gutter and lives with it. The correct production fix is a WebGL2
  `sampler2DArray` (one layer per frame), which removes bleed entirely and lifts
  the 4096 px width limit at 16×256.

---

## Files

```
farmstead-proto/sprite/
  spritedemo.html        page + control panel
  sprite-world.js        FROZEN copy of the terrain / lighting / fog / camera rig
  sprite-impostor.js     GLB load, rig assembly, atlas bake, instanced billboard
  sprite-demo.js         units, wander sim, mode switching, __SPRITE__ test hook
  fs-const.js            frozen copy (2026-08-01)
  fs-map.js              frozen copy (2026-08-01)
  GLTFLoader.js          three r128 example loader, vendored here on purpose
  _verify.cjs            38 checks + the measurement tables above
  VIABILITY.md           this file
shots/
  fs_sprite_sidebyside.png                 200 units, sprites left / meshes right
  fs_sprite_closeup.png                    the same pose at DIST_MIN, sprite left / mesh right
  fs_sprite_orbit_a.png / _b / _c          one frozen scene at yaw 0 / 120 / 240 degrees
  fs_sprite_1000units.png                  1000 sprites, 4 calls, 16,420 tris
  fs_sprite_statics_mesh.png               trees + barns as real geometry, at the bake azimuth
  fs_sprite_statics_impostor.png           …as impostors, same view — indistinguishable
  fs_sprite_statics_mesh_orbit.png         both again after orbiting ~110 degrees
  fs_sprite_statics_impostor_orbit.png     …where the barns fall apart
```

The live `assets/farmstead/fs-models.js`, `fs-render.js` and `farmstead.html` were
neither modified nor imported at runtime.
