# The shared 3D cast and the asset pipelines

Tripo character generation, the biped rig and its 97-clip preset library, Blender conversion,
and the sprite bakes. Assets live under `assets/cast/`.

Generating anything here spends real credits — never do it unprompted. The raw intermediates
(~1 GB) stay untracked; only the converted `.glb` files ship.

> Split out of the single 12,800-line `CLAUDE.md` on 2026-08-16. Entries are verbatim and in
> their original order — the oldest at the top, the newest at the bottom. Later entries
> routinely correct earlier ones, so when two disagree, the lower one wins.

---

# 🐐 BUCKY CAST — Tripo character pipeline (ACTIVE, 2026-07-17)

North-star: a Mario-Party-style SHARED CAST — same rigged characters across every game
(Farm Kart drivers, Pasture Panic, party minigames). TWO cast members DONE, each 6 clips
(idle/walk/run/jump/dance/cheer), demoed on `characterdemo.html` (untracked pending user
approval; character picker + button-per-clip crossfade, speed/spin/bones/wire/root-motion
toggles; test hook `window.__DEMO__`; suite takes a char arg: `castdemo_verify.cjs bucky`;
🎛 POSE MODE (2026-07-17): per-bone XYZ rotation-offset sliders applied post-mixer as
base×delta (capture-and-compose — the mixer does NOT rewrite bones at timeScale 0, naive
multiply accumulates; ⏸ freeze + persistence per char in localStorage cd_pose_<name>;
"copy JSON" emits the exact {bone:[x,y,z]} table format the games' pose code consumes,
e.g. BUCKY3D_SEATED_POSE; hooks __DEMO__.setBoneDelta/poseJSON/pose; verify: scratchpad
posecheck.cjs 11/11. 2026-07-18 additions (mirror_kart_check.cjs 11/11): 🪞 MIRROR default
ON — L_/R_ limb edits auto-apply [x,-y,-z] to the twin (the rig's mirrored local frames;
toggle off for asymmetric poses like Huey's); 🛻 KART PREVIEW — seats the character in
farmkart-gator3d.glb with SEATED_POSE (a copy of BUCKY3D_SEATED_POSE — keep in sync),
user deltas compose rest×seated×user exactly like the game, char switches stay seated,
picking a clip exits; per-char poseDefaults in CHARACTERS (Huey ships user-tuned wing/feet
offsets). Goose char is named HUEY (user naming, 2026-07-18). POSE v2 (2026-07-18, user:
arms clip into bodies): per-bone TRANSLATION offsets too ("shift (anchor point)" sliders
±0.2, capture-and-compose on bone.position like rotations — Tripo clips bake constant
position tracks on every bone so the mixer rewrites them each frame; mirror for t is
GEOMETRIC — local→world via the PARENT quat (bone.position lives in parent space),
reflect across the model-local sagittal plane, into the twin's parent frame — so "left
arm out = right arm out" exactly; naive [tx,-ty,-tz] moved the twin INWARD, and rotation
mirroring stays [x,-y,-z]); JSON format: rotation-only bones stay PLAIN ARRAYS (game-table compatible),
translated bones emit {r,t} — game appliers must learn {r,t} before consuming those;
kart preview gains a 🛞 steering-wheel section (X/Y/Z/scale sliders move the kart GLB's
SteerWheel node + ✋ gripAngle positions 2 red rim markers as hand targets; exported as
__steerWheel meta key; restored on exit so the shared template never drifts). Verify:
scratchpad pose_v2_check.cjs 12/12 + all prior suites green.):
- **Bucky** `assets/cast/bucky/` — THE mascot, generated IMAGE-TO-3D from the user's
  Mario-style reference (brown fur, white ribbed horns, blue overalls, white gloves, red
  boots; ref saved at `scratchpad bucky_ref.png`, extracted from the session .jsonl).
  `image` task w/ `--enable-image-autofix --texture-alignment original_image`. KEY
  LEARNING: the reference's RELAXED pose (arms ~30° down, not T-pose) rigged perfectly
  first try — organic cartoon characters with clear limb separation don't need strict
  T-pose. 3.5MB total.
- **Billy** `assets/cast/goat/` — first pipeline proof, text-to-3D T-pose prompt (cream
  fur, navy overalls, red bandana). 2.9MB total.
**FARM KART INTEGRATION DONE** (2026-07-17, opus agent): driverId `bucky3d` ("Bucky 3D" 🐐)
in DRIVER_KINDS — loads bucky.glb once, SkeletonUtils.clone per kart (r128 script tag added),
MeshLambert{skinning:true} + emissive lift 0.30 (normal/MR dropped), seated-pose bone table
`BUCKY3D_SEATED_POSE` applied rest×delta on a wrapper (base yaw -π/2 — THE GLB READS +X in
the kart frame, not +Z; native height ~0.98u → TARGET_H 1.52 after the user's -20% playtest
note), steer/drift lean = quat delta on Spine01/Head — lean SIGN IS FLIPPED vs the
procedural torso (the -π/2 wrapper yaw mirrors bone-local Z; playtest-confirmed).
SEATED-POSE ARMS RE-SOLVED 2026-07-18 (user: "hands swapped, arms look crossed"): hands
now land ON the wheel grips via a grip-marker sweep in the cast demo's kart preview
(score = hand→own-grip distances + crossing penalty; total miss 0.16u). GROUND TRUTH for
sides: the +X-facing GLB's anatomical LEFT is world -Z — verify against SHOULDER bone
world positions, never derive by hand (two sign derivations in a row were wrong here).
Huey's composed forearm overrides were recomputed against the new bases (merge_pose.cjs
in session scratchpad composes base×user quats → euler). glb branch in fillKartDriver/syncKartDriver (no stretchLimb/hand-parenting);
hats gated OFF for glb drivers; procedural bucky stays DEFAULT; bucky3d in bot random pool
(~48k tris/clone — fine at 3 bots). Verify: `node tools/_verify-bucky3d.cjs` (16/16).
KNOWN: hands hover ~0.26u from grips meeting center-front (anatomical reach limit; occluded
from chase cam); `_verify-driver.cjs` currently times out on networkidle0 because it's the
one suite that doesn't block cloud domains and the boot-time cloud track-reconcile keeps a
socket open (pre-existing/environmental) — procedural regression covered by a focused check.
**GATOR 3D KART DONE** (2026-07-17, opus agent): kartId `gator3d` ("Gator 3D" 🐊) — Tripo
text-to-3D cartoon John Deere gator (task `74f9d95f-76d9-4ff5-b3ca-898c76d716d9`, ~30cr),
Blender-split into `assets/farmkart/farmkart-gator3d.glb` (1.5MB, 38.5k tris): GatorBody +
Wheel_FL/FR/BL/BR (origins at axle centers, roll about X, front steer about Y) + SteerWheel
(measured column axis (0,0.933,-0.361), turns with steer; the PROCEDURAL steer wheel is
kept INVISIBLE for grip anchors so procedural drivers' hands still work). Fixed green like
the tractor precedent (racer color can't repaint the baked texture). GATOR3D_OFFSETS =
additive per-kart driver/steer/pedal offsets in syncDriverPlacement (zero for other karts).
Source orientation was X-front → baked -90° Z rotation (game forward = +Z). Verify:
`node tools/_verify-gator3d.cjs` (24/24). Blender GOTCHAS: headless EEVEE render fails
(use BLENDER_WORKBENCH); steering-axis PCA corrupted by column length (use ring-center −
column-base); measure clone bboxes DETACHED from the scene or mid-race transforms corrupt
seating.
**GATOR WHEELS REBUILT v3** (2026-07-17, Fable direct after 2 agent carve attempts failed —
user playtest: tire chunks stayed welded to the body + steering yawed a chunk of the front):
the carved wheels are GONE — replaced by 4 instances of a separately-generated Tripo wheel
(task `f90ef504-1ef0-4800-af5a-0a162a55e3c6`; its baked texture was ugly grey → STRIPPED,
flat two-material toon paint instead: tire charcoal + hub vibrant yellow 0xf2c53d, matching
the game's flat-Lambert look). Rebuild recipe = `tools/_gator_rebuild.py` (run from repo
root, Blender 5.1 headless; regenerates farmkart-gator3d.glb from the two raw Tripo GLBs).
HARD-WON LESSONS baked into that script: (1) the Tripo mesh is SHELL SOUP (~590 loose
parts) — remove tires at ISLAND level classified by TEXTURE COLOR (neutral+not-bright =
rubber), never by geometry-only cylinders/sweeps (geometry alone ate the hood twice: tires
tuck under the hood edges and overlap it in every spatial axis); (2) Blender Image.pixels
are LINEAR floats — sRGB-intuition thresholds misclassify John-Deere green (~0.26 linear)
as "dark", use saturation not value; (3) selection-dependent ops (transform_apply) silently
no-op — use mesh.data.transform(Matrix) and assert bboxes after every bake; (4) ground
truth measured in glTF space via `tools/_gator_measure.mjs`: wheelbase 0.528 > track 0.459,
tire dia 0.40 axle y -0.146 (v2 swapped axes → monster-truck chaos); (5) fender undersides
LEGITIMATELY interpenetrate the tires (they did in the original) — the no-fragment
guarantee must be color-aware (build-time "tirelike faces in tire zone" assert; the runtime
suite check is a loose proximity bound only). Steering wheel = color-gated sphere split of
the ORIGINAL ring+column at measured center (0,-0.11,0.205 blender-final frame).
_prepGator3dTemplate now tints the emissive lift by the material's own color for
UNTEXTURED materials (flat white lift washed the new dark tires grey). `kartviewer.html`
(new page, untracked): kart inspection viewer w/ drive/steer/spin/wire/parts controls
mirroring the game's exact quaternion conventions; test hook `window.__KV__`; gator entry
also in characterdemo.html's picker (inspect-only).

**Pipeline** (threejs-3d-generator skill + `TRIPO_API_KEY` in `tools/.env`; run
`py -3 -X utf8 ~/.claude/skills/threejs-3d-generator/scripts/threejs_3d_asset.py`):
1. `character-pipeline --prompt "<T-pose mascot prompt>" --animations preset:idle,preset:walk,preset:run,preset:jump --texture-quality detailed --geometry-quality detailed --out-dir assets/cast/<name>` — generates, rig-checks, rigs (biped → v1.0-20240301 anatomical skeleton, auto-validated), retargets (v1.0 = ONE FBX per clip, GLB bake broken upstream).
2. Extra clips later: `postprocess --type animate_retarget --original-task-id <RIG_TASK> --rig-type biped --animation preset:biped:<name>` (~10 credits each, failures free).
   **THE LEGACY LIBRARY IS THE WHOLE POINT of the v1.0 rig: 97 clips** — full list in
   `assets/cast/tripo-biped-presets.txt` (extracted from the studio web bundle; NOT in
   public docs; incl. dance_01-06, cheer, clap, greet, wave_goodbye, laugh, cry, sit,
   swim, basketball/football/baseball moves). `preset:biped:dance` (no suffix) is NOT
   valid — task fails w/ error_code 1004, 0 credits.
3. Convert FBX→GLB via Blender 5.1 headless (session scratchpad `fbx2glb.py`; recreate
   from this spec): `base` mode = decimate ratio 0.025 (1.89M→~47k tris) + images→1024
   + no anims → `goat.glb` 2.4MB; `clip` mode = delete meshes, keep best action renamed
   → mesh-less clip GLBs 60-280KB. GOTCHAS: Blender 5 removed `Action.fcurves` (count
   via layers→strips→channelbags); exporter bakes constant-1.0 scale tracks on every
   bone — strip w/ `node tools/_cast_split.mjs strip-scale in.glb out.glb` (NEVER strip
   position tracks — Tripo bakes meaningful per-bone positions).
4. Games load base + only the clips they need; clips bind to the base's clone by BONE
   NAME (both come through the same FBX path so names always match; root bone = `Root`).
   In-place conversion at runtime: zero the HORIZONTAL deltas of the single
   `Root.position` track, keep Y (see characterdemo.html `inPlaceClip()`).

**Clip facts** (measured): only `Root` carries real translation; walk travels ~1.06u/cycle
along +X; **jump has ZERO vertical root motion** (reads through leg extension — don't
assert root-Y in tests); idle keeps feet planted (15.4s subtle sway).
**Cost**: ~115 credits per cast member w/ 6 clips (gen 30 · rig 25 · 6×10 retargets).
**Task IDs** (reusable for more clips — retarget against the RIG id):
- Billy: gen `56c274e0-ad96-4486-b22f-6231364ebe01`, RIG `4b4b68ca-2e82-4448-98e0-9f45874eb9e3`
- Bucky: gen `ba8d7a1b-5362-417a-9f24-93a4d7da64f0`, RIG `df08d15e-f514-4ae6-9d2b-bca5266eaaec`
- Otis 🐶 (dog, image-to-3D from user ref): gen `ade492c3-f028-4962-9e31-c8899f4d9d78`, RIG `6b3de3e8-de18-40a6-b1f2-190b0d722545`
- Boots 🐱 (cat, user ref): gen `3d5775af-0c18-47de-b967-ae71ed75b105`, RIG `943f751f-9083-4fd0-bccd-45dbc7e31950`
- Huey 🦆 (goose, user ref — USER NAMED HIM HUEY; rigged with EXPLICIT --rig-type biped so
  the checker can't route it avian; files stay assets/cast/goose/goose*.glb): gen
  `c05d614d-1e2a-4098-b36e-340d06cf6efb`, RIG `c8dff594-b24a-4ba9-92cf-0a8f8ab88552`
(2026-07-18: cast batch ×3 all 26/26 in castdemo_verify; conversion batching =
scratchpad cast_convert.sh; ~11MB total for the three.)
**ALL FOUR GLB KART DRIVERS** (2026-07-18, opus agent + Fable follow-up): bucky3d machinery
refactored into `GLB_DRIVER_DEFS` registry (farmkart.html ~L2131: {url,name,ico,targetH,
baseYaw,pose}; shared _prepGlbDriverTemplate/loadGlbDriverTemplate/_attachGlbDriver;
_poseWith(overrides) clones the base seated table; bucky3d hooks aliased, its 16/16 suite
UNCHANGED). Drivers: bucky3d · otis3d · boots3d · **huey3d** ("Huey 3D" 🦆 — renamed from
gus3d per user; targetH 1.72 for the neck; pose = base + user's pose-tool wing/feet JSON
(forearms QUATERNION-COMPOSED base×user then re-extracted as euler — additive tables don't
compose) + NeckTwist01/02+Head -X raises the head so the chase cam sees more than a white
blob). All four: same +X facing/-π/2 yaw, same base seated pose. 4 concurrent GLB drivers
= 254k tris, no cap needed. Verify: `node tools/_verify-glbdrivers.cjs` (65/65).
Huey's pose-tool defaults also ship in characterdemo CHARACTERS.goose.poseDefaults.
**RAW intermediates** (~1GB total: base/rig GLBs + per-clip FBXs under
`assets/cast/<name>/<task-dirs>/`) are kept untracked for re-conversion — NEVER commit
them; only `<name>.glb` + `<name>-*.glb` + the presets txt ship.
**Test gotcha**: headless SwiftShader runs the page at ~5-10fps with dt capped at 0.05
→ crossfades stretch ~4x past wall-clock; tests must wait for fade completion by
ACTION WEIGHT, not sleep(600) (see scratchpad castdemo_verify.cjs `settle()`; 25/25).

---
