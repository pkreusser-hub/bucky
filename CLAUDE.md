# BUCKY — project notes for Claude

BUCKY is a static family web app (plain HTML/JS pages, no build step) deployed to
https://amenfarms.netlify.app via GitHub auto-deploy (push to `main` = live deploy —
never push without the user's preview approval unless pre-approved in the request).
Existing games: `pasturepanic.html`, `goatcare.html`. Each game page is fully
self-contained: its own `<script>`, its own render loop, no shared JS between pages.

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

# 📱 MOBILE PREVIEW (daily testing)

Reliable phone viewport for pages + games — prefer this over one-off DevTools tips.

```bash
node tools/mobile-preview.mjs --picker          # phone picker (or double-click Mobile Preview.bat)
node tools/mobile-preview.mjs farmkart.html     # visible Chrome @ 390×844
node tools/mobile-preview.mjs index.html --shot # → shots/mobile-index.png
node tools/mobile-preview.mjs --all             # smoke shots of common pages
node tools/mobile-preview.mjs --list            # pages + device presets
```

- **One-click:** double-click `Mobile Preview.bat` (repo root) or Cursor **Run Task → Mobile Preview**.
- Serves/reuses **http://localhost:8790** (Launch `bucky-static` / photobooth port).
- Default device **iphone14** 390×844, `--dpr 2`; also `se` / `pixel` / `ipad`.
- Stubs `matchMedia('(pointer: coarse)')` so Farm Kart `IS_MOBILE` + `#touchCtl` appear
  (desktop Chrome never reports coarse pointer — DevTools device mode alone is not enough).
- Never `file://` — assets break. Cursor Launch preview tabs can be `document.hidden`
  (WebGL/rAF stall); this CLI opens real Chrome / headless for shots.
- Details: `tools/README.md`.

---

# 🎨 UI REDESIGN — modern app shell for index.html (ACTIVE, 2026-07-09)

Total UI overhaul of the main app "to conform with best practice modern app design"
built as `redesign/index.html` (a full COPY of the live `index.html`) so it NEVER
interferes with the live files. STRATEGY = re-skin, not rewrite: index.html is
token-based (~10 CSS custom properties) and all logic (Firebase backend, render
dispatch, sheets) is reused unchanged; only tokens + shell + Home get redesigned.
Final step: flip `index.html` to the finished redesign and push (ONE push, only when
the WHOLE project is done — user: "lets finish the project before we push to live").
DESIGN DECISIONS (user): red-white-blue "Old Glory" palette; keep the name **Bucky**
with subtext "Family Farm Hub"; goat logo top-left (`/bucky.png`); LIGHT MODE default;
colors extracted from the Bucky logo — **red #ba303e, navy #233357**; vanilla + design
tokens (no framework); regroup the 9 sections into ~5 areas.
- **P1 DONE — recolor**: copied index.html → redesign/index.html, global hex swap to the
  logo palette (#0a3161→#233357, #b31942→#ba303e, etc.), asset paths made root-absolute
  (`/bucky.png`, `/assets/dadjokes.js`, `/push-client.js`, `/manifest.webmanifest`).
- **P2 DONE — navigation** (2026-07-09): replaced the top 10-icon row with a fixed
  **5-area bottom tab bar** (`#bnav`, built from `NAV_GROUPS`): Home / Tasks / Bank /
  Farm / Play. Areas map to section keys — Home→dashboard · Tasks→[chores,workorders,
  shopping] · Bank→[farmbank] · Farm→[goathooves,goatcare,print3d] · Play→[play,game,
  catgame]. Multi-section areas (Tasks, Farm) render a segmented **sub-nav** (`#subnav`,
  `renderSubnav()`) whose chips switch `currentTab`; `groupLast[gid]` remembers the last
  sub-section so re-tapping the area returns there. `groupForTab()` maps currentTab→area;
  `syncTabsUI()` now highlights the bottom bar (still touches the hidden legacy `#tabs`
  for deep-link coherence). New pseudo-tab **"play"** → `renderPlay()` = in-app menu with
  2 cards linking out to games.html + farmgpt.html. Legacy top `#tabs` and header
  `.stripes` hidden via CSS; FAB lifted above the bar; body bottom-padding clears it.
  Desktop (≥700px): bar spans full width but clusters its 5 items centered under the
  760px content column. Verified headless (Firebase/gstatic BLOCKED per goat-dup lesson)
  23/23 nav checks on 390px + desktop 1280px; 0 JS pageerrors (only file:// asset-404
  console noise, resolves on the real host). Test: scratchpad/p2_nav_test.mjs.
- **P3 DONE — personalized Home** (2026-07-09): replaced the 9-tile grid with a
  data-driven dashboard (`renderDashboard`): greeting + a **hero card** (today's chore
  progress as an SVG completion ring, celebratory when all done) + a **2×2 stat grid**
  (Bank / Goats / open Work Orders + payout badge / hooves-due, red-alert when >0) +
  a **quick-pill row** (Shopping/3D Prints/Play with live counts) + the dad joke.
  Personalized by `myName()`: a BANK_KID sees their OWN balance ("Your balance"); a
  parent sees the kids' combined savings. Cards navigate via new `goTo(tab)` (sets
  currentTab + `groupLast` so the sub-nav lands right). Data pulled live from the
  existing model (isDone/kidBalance/careAt/daysSince); nothing new persisted.
- **P4 DONE — section polish** (2026-07-09): the section views already came through the
  P1 re-skin cohesive (token-based cards), so P4 was light — added short segmented
  sub-nav labels (`SUBNAV_LABEL`: Chores/Jobs/Shopping · Goats/Care/Prints; "Work
  Orders"/"3D Prints" were truncating in the 3-up control) and removed the now-dead
  `.dash-grid`/`.dash-tile` CSS. Also added the **"Family Farm Hub" subtitle** (missing
  from the P1 copy — only the mockup had it): header title is now "Bucky" + subtitle,
  and the lock card shows "Bucky" + red-uppercase "FAMILY FARM HUB".
- **P5 — DONE + WENT LIVE** (2026-07-09): full headless sweep (Firebase/gstatic BLOCKED)
  all green — lock→unlock 6/6, P2 nav 23/23, P3 home 14/14 (parent + kid), P4 sub-nav 0
  clipped, 0 JS pageerrors on mobile 390px + desktop 1280px. Before flipping, VERIFIED
  redesign/index.html was a clean SUPERSET of the live index.html: a parallel session had
  5 uncommitted "UI FIX BATCH" fixes in index.html (compact WO cards · .sheet scroll cap ·
  expanded DEEP_LINK_TABS · goat-care blank-when-never-logged · bank privacy showKids) and
  all 5 were already present in the redesign copy (P1 `cp` was taken after that batch), so
  the flip preserved them. FLIP = `cp redesign/index.html index.html`; the redundant
  redesign/index.html was then `git rm`'d (redesign IS index.html now). Committed +
  pushed index.html + CLAUDE.md ONLY (left the parallel session's farmgpt.html/games.html/
  farmkart.html/launch.json changes untouched/uncommitted). THE UI REDESIGN IS LIVE.
  Tests in scratchpad: p2_nav_test / p3_home_test / p4_verify / p5_qa .mjs.
- **HOME REBUILD to match the approved mockup** (2026-07-09, post-launch): the P3 Home I
  first shipped (ring + 2×2 stat grid + pills) DID NOT match the polished mockup the user
  had approved (scratchpad/redesign_home.html) — user: "isn't what I see on the current home
  page." Rebuilt renderDashboard to faithfully port the mockup, wired to real data: hero
  (eyebrow date + "Morning/Afternoon/Evening, <name>" + "N chores left today" + navy progress
  ring), a 3-up stat row (💰 Bank / 🔥 Streak / 🛠 Jobs), an INTERACTIVE "Today's chores" card
  (real chores; tapping a row toggles done via setSlot → ring updates), a 2×2 bento (Farm Bank
  + this-week delta · Needs care = first goat overdue on hooves · 3D prints · Play), styled
  dad-joke card + footer. Mockup class names scoped under `.home2` to avoid colliding with the
  app's global .check/.card/.row. New :root tokens (--ink-2/--line-2/--surface-2/--navy-soft/
  --red-soft/--good*). New helpers: bankMarkup, money2, homeChoreSub, toggleHomeChore,
  weeklyBankDelta, choreStreak (honest per-person localStorage consecutive-all-done-days
  counter), dayKey. #progress hidden on Home (greeting is in the hero), restored in render()
  for other tabs. Dropped the mockup's per-chore "+$1" reward chips — no per-chore reward field
  exists (only work orders have `value`). Verified headless (Firebase blocked): 20/20 across two
  suites, card nav routes correct, interactive toggle 0/6→1/6, 0 JS errors, mobile + desktop.
  Tests: p6_home / p6_nav .mjs.
- **HOME + NAV FIX BATCH** (2026-07-09, user playtest): (1) BACK BUTTON — in-app tab
  changes now `history.pushState({buckyTab})` (goTo is the single navigator; navGroup/
  sub-nav/homeBtn/legacy-tabs all route through it, push=false when restoring); the
  existing WO-sheet popstate guard kept as branch (1), new branch (2) restores the tab
  from history.state.buckyTab so phone Back walks Home←Tasks←Bank instead of jumping out
  to the last external page (FarmGPT/Games); baseline `history.replaceState` seeded at
  boot. (2) Today's chores render ALL chores but the `.rows` list is capped to ~4 rows
  (max-height 216px, overflow-y auto). (3) Jobs stat = the LOGGED-IN user's OPEN work
  orders only (`!done && assignee===myName()`; all-open if no name). (4) 3D Prints moved
  from the Farm area to Tasks (NAV_GROUPS: tasks=[chores,workorders,shopping,print3d],
  farm=[goathooves,goatcare]); segmented sub-nav tightened (font 13px, padding 9px 3px)
  so 4 Tasks chips fit at 390px with 0 clipped. Verified headless 14/14, 0 pageerrors.
  Test: p7_fixes.mjs (injects buckyData1 to control chores/jobs/goats).
- **CHORE/BANK AUDIENCE GATING + "Open Work Orders"** (2026-07-09, user): Home "Jobs"
  stat renamed → "Open Work Orders". CHORES + FARM BANK now only show for
  `CHORE_BANK_USERS = ["Eleanor","Isaac","Dad"]` (via `seesChoreBank()`); everyone else
  (Mom, guests) gets a farm-focused Home. Gated: the hero chore RING ("bubble" top-right),
  the "Today's chores" listing, the Bank + Streak stats, the Farm Bank bento (→ "The herd"
  mini instead), the **Bank bottom-nav area** (`navGroupVisible`), and the Tasks **Chores
  chip** (`navKeyVisible`). Non-allowed stat row = Open Work Orders / Goats / Care due
  (grid-template-columns set to statDefs.length). `navGroup` skips hidden sections (Tasks
  lands on Jobs when Chores is hidden); `render()` bounces a non-allowed user off chores/
  farmbank → dashboard; nav rebuilt on profile switch (buildBottomNav+syncTabsUI added to
  the meBtn handler). NOTE the Tasks sub-nav chip for work orders stays short ("Jobs") —
  "Open Work Orders" only fits on the Home stat card (wraps to 2 lines there, fine).
  Verified headless 19/19 (Eleanor full vs Mom gated) + p7 regression 14/14, 0 pageerrors.
  Test: p8_gate.mjs.
- **HOME REWORK: lists + FarmGPT ask bar** (2026-07-09, user): removed the 2×2 bento grid
  from renderDashboard. Home is now hero + stat row + a **FarmGPT research ask bar** +
  the **Today's chores** scroll list (chore/bank users only, ~4 rows) + an **Open work
  orders** scroll list (`.rows.short`, ~3 rows, the logged-in user's open WOs sorted by due
  date; each row = 🛠 name · "Due <date>"/"Open" · $value; taps → workorders) + dad joke.
  The ask bar submits to `farmgpt.html?ask=<q>`; farmgpt.html's new `handleAskParam()` reads
  `?ask=`, opens Research (`show("research")` + `submitResearch(q)`), and `replaceState`s the
  URL clean so a refresh doesn't re-ask. New CSS `.home2 .askbar/.wo-ic/.wo-amt/.chev` +
  `.rows.short`; dead bento CSS removed; empty2 selector fixed (`.home2 .empty2`). Verified
  headless 15/15 (layout + handoff + farmgpt opens Research) + p7 14/14 + p8 19/19, 0 real
  pageerrors. Test: p9_home2.mjs (routes farmgpt.html to capture the ?ask handoff).
- **7-TAB BOTTOM NAV + WEATHER WIDGET** (2026-07-09, user): bottom bar now has 7 areas —
  Home · Tasks · **Jobs (🛠 workorders)** · **Shop (🛒 shopping)** · Bank · Farm · Play.
  Shopping + Work Orders are their OWN areas now (pulled OUT of Tasks; Tasks = [chores,
  print3d]). `groupForTab` resolves workorders→wo / shopping→shop (each in exactly one
  group). Non-allowed users (Mom) still drop Bank → 6 tabs. 7 short labels fit 390px with 0
  clipped. WEATHER: a 3-day forecast card for the farm (Woodville, AL 34.6865,-86.2104) via
  **Open-Meteo** (free, no key, CORS ok — no CSP on the site so the client fetch works):
  `wxFetch()` caches to localStorage `bucky_wx` (refetch if >3h), paints a 3-col strip
  (Today/Wkday, WMO-code→emoji via `wxIcon`, hi°/lo° °F, America/Chicago), background-refresh
  only repaints while still on dashboard. Card sits between the stat row and the ask bar,
  shown for everyone. Verified: real API returns Woodville data; headless (7 tabs, no clip,
  Tasks sub=chores/print3d, wo/shop tabs, Mom 6 tabs) + p7/p8/p9 regressions updated & green.
  Test: p10_navwx.mjs (mocks open-meteo). UPDATED to **5-day + precip %** (user): daily adds
  `precipitation_probability_max`, forecast_days=5, cache key bumped to `bucky_wx2` (old
  3-day shape ignored); each cell now day/emoji/hi°/lo°/💧%; `.wxdays` = 5 cols, tighter
  cells (emoji 21px, temps nowrap) — fits 390px with 0 clip. p10 now 19/19.
- **AUDIENCE REWORK: chores for all, Mom banks, Prints→Jobs, Shopping stat** (2026-07-09,
  user): (1) CHORES UNGATED — the chores gate is fully reversed: every user (incl. guests)
  gets the hero ring, Today's-chores card, Streak stat, and the Chores tab; `CHORE_BANK_USERS/
  seesChoreBank` → `BANK_USERS = ["Eleanor","Isaac","Dad","Mom"]` / `seesBank()` gating ONLY
  Farm Bank (bank stat, Bank nav area, farmbank bounce). (2) MOM = family (in BANK_USERS →
  sees Bank; 7 tabs). Guests (e.g. Grandma): 6 tabs, no Bank stat. (3) HOME STAT ROW is now
  universal: 💰 Bank (family) / 🔥 Streak / 🛠 Open Work Orders / 🛒 **Shopping** (open
  shopping-list items — replaces the old goat/care-due guest stats; the goat counter is GONE
  per user request; "Open Work Orders" wraps 3 lines at 4-up, acceptable). (4) 3D PRINTS
  moved from Tasks → the **Jobs** area (wo members=[workorders,print3d] → Jobs gets a
  Jobs/Prints sub-nav); the tasks area holds only chores so its bottom label was renamed
  **"Chores"**. Dead helpers weeklyBankDelta/money2 removed. Verified headless: p10 30/30
  (4-stat row + shopping count, no Chores sub-nav, Jobs sub=workorders/print3d, Mom full w/
  bank, Grandma 6 tabs + ring + no bank), p7 13/13 / p8 18/18 / p9 15/15 updated to the new
  spec. 0 pageerrors.
- **TASTE-TEST FIX BATCH** (2026-07-09, Fable design sweep of all 14 screens; shots in
  scratchpad/taste/): (1) **FarmGPT + Games shell parity** — their #buckyNav arrays updated
  to the 7-tab set (Home/Chores/Jobs/Shop/Bank/Farm/Play) with the SAME BANK_USERS gate as
  index (duplicated list — keep all three in sync); candy `.stripes` hidden on both pages;
  "← BUCKY" → "← Bucky" (games markup + farmgpt markup AND its show() fn); AND both pages'
  token blocks were still the OLD palette — completed the P1 hex swap (#0a3161→#233357,
  #07223f→#18233b, #b31942→#ba303e incl. theme-color metas). (2) Home stat values BOTTOM-
  ALIGN (.stat flex column + .v margin-top:auto) so the 4 numbers form one line despite
  wrapped labels. (3) STATUS LINE auto-tucks 4s after a healthy "live" connect (.status.tucked
  max-height:0 transition; any non-live setStatus brings it back). (4) JOBS restyle: money
  cards' full green outline → 4px left accent stripe (li.wo has NO base border — 0px top is
  correct); OPEN pill mustard → red-soft/red; Reassign/Claim/Copy/Reopen switched from bare
  .iconbtn text to a real `.wo-ghost-btn` (bordered; .claim = navy). (5) TOASTS capped at 2
  (oldest evicted) + lifetime 5s→4s. (6) PLAY TAB furnished: FarmGPT card + inline 9-game
  `.pgrid/.ptile` arcade (PLAY_GAMES const MIRRORS games.html's GAMES list — keep in sync;
  in-app games route via goTo(game/catgame)) + a "games hub" link (lobby JOIN cards live
  there). (7) farmgpt chatInput placeholder shortened ("Ask me anything…" — old one clipped),
  Send button red→navy primary; games "Pick your poison"→"Pick a game!". Verified p11 24/24 +
  p7/p8/p9/p10 all green. Test: p11_taste.mjs.
- **POLISH BATCH 2** (2026-07-09, user playtest): (1) farmgpt.html DOCUMENT SCROLL LOCK — the
  bottom `#buckyNav` (an in-flow flex child, not `position:fixed`) could be dragged up on phones
  because `html,body` had no `overflow:hidden`/`overscroll-behavior:none`; a rubber-band drag
  chained past `main`'s/`#chatScroll`'s inner scrollers up to the document itself, moving the
  whole flex column. Fixed: `html,body{overflow:hidden;overscroll-behavior:none}` + added
  `overscroll-behavior:contain` to `main`, `#chatScroll`, `#storyScroll` so each scroller stops
  the chain at its own edge instead of bubbling up. (2) Home "Today's chores" card now hides
  DONE chores and sorts the rest daily-by-time-of-day (morning→noon→night) then any weekly/
  monthly/yearly chores, then `c.order` (`visibleChores` derived from `dayChores`; hero ring
  still counts done/total across ALL of today's chores unchanged); all-done state shows the
  reused `.empty2` row "All done — go play! 🎉". (3) Stat row cards are icon-only (`.k` = just
  the emoji, 17px, no label text) with `title` + `aria-label` set to the full name (Bank/Streak/
  Open Work Orders/Shopping) for accessibility; `.v` values stay bottom-aligned. (4) Hero ring
  numerator/denominator: `.val` switched from `display:grid;place-items:center` (which stacked
  the number and `<small>/total</small>` as two grid rows) to `display:flex;align-items:baseline;
  justify-content:center` + `small{margin-left:1px}` so "3/6" reads on one baseline, still
  centered in the ring. Updated STALE test assertions: p8_gate.mjs and p10_navwx.mjs switched
  their `.home2 .stat .k` textContent checks to `.home2 .stat` `aria-label` (icon-only `.k` no
  longer carries the label text); p7_fixes.mjs seeded chores all-not-done (unchanged) and gained
  a new check that tapping a row hides it (8→7) and increments the ring (0/8→1/8); p11_taste.mjs
  needed no changes (its `.v` bottom-alignment check still holds). New suite p12_polish.mjs
  (26 checks: done-chore hiding + tod sort + all-done empty state + ring-count-unchanged, icon-
  only stats + title/aria-label + font-size + alignment, ring single-baseline overlap, farmgpt
  document-scroll-lock on home + research incl. injected tall content + internal #chatScroll
  scroll + composer visibility above the nav). Verified: p7 15/15, p8 18/18, p9 15/15, p10
  30/30, p11 24/24, p12 26/26 — 128/128, 0 pageerrors.

---

# 📅 PLAN AREA — family calendar + animal care (2026-07-19, opus agent, UNPUSHED)

8th bottom-nav area "📅 Plan" (members ['calendar','animalcare']; nav mirrored on
farmgpt/games/weather — keep all four in sync; 8 areas = 46px each at 390px, blabel
10px). CALENDAR: netlify/functions/calendar.mjs (secret-gated like farmgpt, reuses
FIREBASE_SERVICE_ACCOUNT w/ calendar scope + GOOGLE_CALENDAR_ID env; actions
status/list/create/update/delete; status.saEmail feeds the in-app setup card; Google
401/403/404 → "calendar-not-shared"; CALENDAR_BASE_URL/CAL_GOOGLE_TOKEN_URL test
overrides). index.html renderCalendar ~L4195: month/week/day views (view persisted
bucky_cal_view), localStorage cache bucky_cal_cache for instant paint, add/edit/delete
sheet #calOverlay, times America/Chicago. SETUP (Dad, one-time): share family calendar
w/ the SA email shown on the setup card ("Make changes to events") + enable Calendar API
on amen-farms-app + set GOOGLE_CALENDAR_ID in Netlify + redeploy. ANIMAL CARE:
renderAnimalCare ~L4491 — backend.getSetting/setSetting("animalCare") JSON envelope
{defaults:{mon..sun:{am,pm}}, overrides:{"YYYY-MM-DD":{am/pm}}} (sparse, 30-day prune
on save); groups Kreussers(navy)/Joy(red)/Grandparents(amber); tap chip = cycle →
override (auto-removes when equal to default, ↺ resets); #careSchedOverlay = weekly
default editor; week paging. Test hooks __CAL__/__CARE__/__NAV__. Suites (scratchpad):
cal_server_test.mjs 57/57 (fake Google; SA key never leaked asserted) +
cal_ui_test.cjs 104/104 (needs PPT env var = path to puppeteer-core; Firebase blocked).
GOTCHA the tests caught: passing a slot OBJECT as a map key stringifies to
"[object Object]" and silently reads defaults wrong — pass slot.id.
RECURRING EVENTS (2026-07-19, sonnet agent): Google-native RRULE. Function: list/get
emit seriesId (recurringEventId); create/update take event.repeat {freq DAILY|WEEKLY|
BIWEEKLY|MONTHLY|YEARLY, until} → buildRRule (WEEKLY = no BYDAY, weekday implicit;
until timed = UNTIL=...T235959Z, all-day = value-date; NONE on update = explicit
recurrence:[] clear; absent = omit/unchanged; CUSTOM never clobbers); action "get"
parses RRULE back (exotic → freq:CUSTOM read-only in UI). UI: Repeats+Ends rows in the
sheet (weekly label live-follows date), ↻ marker on instances, instance tap = This day/
Whole series scope seg (series save = get master → apply form time-of-day onto master's
ORIGINAL dates → update master id; asserted ordering), dual delete buttons. Suites now
cal_server 130 / cal_ui 154 (PPT env var). Agent correctly refused live-pane index.html
verification (production-Firestore risk) — headless route-mocked only.
HOME CAL WIDGET (2026-07-20, user): the 4-up stat row (Bank/Streak/Open WO/Shopping) is
GONE from renderDashboard — replaced by a universal clickable calendar card in its slot
(hero → calwidget → weather): "📅 <Weekday, Month D>" + up to 3 upcoming events over
today→+7d from bucky_cal_cache (Today/Tomorrow/weekday chips, time or All day, ↻ for
recurring, "+N more this week", friendly empty state — never errors), whole card →
goTo('calendar'). ONE fetch path: calFetchEvents() shared by tab + widget;
bucky_cal_cache_ts stamp; widget refresh = wxcard pattern (>10min stale → one quiet
fetch, repaint only if still on dashboard). Dead code removed w/ grep evidence
(bankMarkup/choreStreak/dayKey); seesBank/kidBalance/woIsMine KEPT (shared). Suite:
scratchpad home_calwidget_test.cjs 64/64.
CARE WIDGET (2026-07-20, user; reworked same day to a GRID): .carewidget card below
.calwidget — HORIZONTAL 7-day grid (.caregrid, 22px + repeat(7,minmax(0,1fr))):
columns = next 7 days (2-letter weekday over date, TODAY filled red + column tinted),
rows = 🌅/🌙, cells = single-letter chips K/J/G (Kreussers navy — note --green IS the
navy · Joy red · Grandparents amber; full name in title tooltip), .ov::after override
dot; tap → goTo('animalcare'). ZERO duplicated logic: resolves via the Care tab's own
careSlotValue/careGroupById/defaultCareData/loadAnimalCare; deterministic clock shared
w/ calwidget (__CAL__.setHomeNow drives both). Override date-scoping proven by rolling
the clock so the same weekday's NEXT occurrence shows the default. Test gotcha: the
override dot legitimately overhangs the chip corner ~2px — measure text clipping via
Range width, not scrollWidth. home_calwidget_test.cjs now 114/114.
FIVE-CHANGE BATCH (2026-07-20, user; opus agent): (1) calendar controls STICKY
(.cal-controls, top=--cal-sticky-top measured from header.offsetHeight per render;
IntersectionObserver sentinel toggles .stuck shadow); (2) event tap → read-only PREVIEW
sheet (#calPreviewOverlay: title/date/time/repeat-description/notes + Close/✏️ Edit —
preview fetches the series master for exact cadence wording; FAB still edits directly);
(3) nav order = Home · Plan · Chores · Jobs · Shop · Bank · Farm · Play across all 4
mirrored navs; (4) CHORE REMINDERS gated server-side in chorereminders.mjs
getAllDeviceTokens(): CHORE_REMINDER_USERS={Isaac,Eleanor} filters pushTokens docs by
their .user field (written by push-client enable(userName); untagged legacy docs also
dropped); (5) BANK-CREDIT notifications: unified notifyBankCredit(kid,amount,source,
dedupeId) — kid∈{Isaac,Eleanor} + amount>0 only — hooked into allowance mint /
WO payout / manual deposit, in-app bell via notifs_<fam> keyed to the credit's
DETERMINISTIC id (idempotent vs self-healing sweeps) + targeted FCM via pushTokens.user;
bell renderer now type-aware (bank_credit rows → Farm Bank, not lobby-invite styling).
NOTE behavior change: payout alert text unified to "💰 $X added to your bank! (Work
order: <name>)". Suites: cal_ui 197 · notif_chore_test.mjs 18 · notif_bank_test.cjs 19.
CALENDAR UX REWORK (2026-07-23, two pushed batches): ‹ › nav buttons REMOVED (Today + ↻ stay).
MONTH: phones ≤700px swap title chips for event DOTS (.cal-dots; navy timed/red all-day) w/
34px cells so the tapped day's agenda shows 3+ events with no scrolling (desktop keeps chips);
swipe left/right (attachCalSwipe: pointer-based so mouse-drag + horizontal wheel work; real
swipe suppresses the day-cell click via a capture handler) changes month. WEEK: endless feed
BOTH directions — calWeeksBefore(1)/calWeekCount(3) grow ±2 per IntersectionObserver sentinel
(CAL_WEEK_MAX 26 each way); upward prepend compensates scroll (scrollHeight delta →
window.scrollTo) so content never jumps; opening the week tab ALWAYS snaps calFocus to today
+ aligns today's sep (data-anchor) under the sticky controls (calWeekScrollPending one-shot);
labeled .cal-weeksep per week, dates on every day card; fetch range = anchor±counts weeks.
DAY: full 30-min planner grid (CAL_SLOT_H 26px × 48 slots, hour gutter labels, timed events =
positioned blocks w/ PER-CLUSTER overlap lanes, all-day chip row, red .cal-nowline on today,
auto-scroll to now−1h/first event/7AM, tap empty slot → add sheet prefilled w/ that time,
swipe changes day). EVENT SHEET: end time defaults to start and FOLLOWS it until hand-edited
(calEndTouched); start past end snaps end up; save clamps en ≥ st. openCalEventSheet gained
(ev, opts{date,start}). Hooks: __CAL__.state() adds weekCount/weeksBefore. Suite: scratchpad
cal_batch_test.mjs 30/30 (SWIPE TEST GOTCHA: pick a pointer y clamped inside BOTH the element
and the viewport — a scrolled day grid has negative box.y and off-viewport coords silently
no-op; measure scroll compensation by capturing anchor position in the SAME evaluate as the
scrollTo, before the async observer fires).
PINNING BATCH (2026-07-23, pushed): MONTH page never scrolls — `body.cal-fixed` (toggled in
render() AND renderCalendar, keyed on tab+view so it never leaks to other tabs) zeroes the
body's 156px nav-clearance padding, and the agenda card gets class `scrolly` + a JS maxHeight
clamp (space to #bnav top, then a SECOND pass subtracts any remaining
scrollHeight−innerHeight overshoot — one pass alone left 31px of scroll from below-card
margins). DAY all-day chip row = sticky at --cal-allday-top (calStickyBase + controls height,
set in a rAF at the end of renderCalendar). #subnav (ALL area sub-navs, not just Plan) is now
sticky under the header (--subnav-top set in renderSubnav) + slimmed (5px chip padding);
.cal-controls stack below it — calStickyBase (module let) = headerH + subnavH feeds the
sticky top, the stuck-shadow rootMargin, and calStickyOffset(). Suite now 36/36.
🛠 WORK ORDERS REDESIGN (2026-07-23, taste-skill pass — user: "busy and not easy to
navigate"): buildWoCard rewritten to SUMMARY-FIRST accordion — a card is one row (.wo-sum:
thumb? · title · quiet meta · $value right · chevron) until tapped; `expandedWoId` (one at a
time) opens .wo-detail (desc, byline, progress bar→milestones, photo, actions). Actions = ONE
.wo-primary (assigned: "✓ Close work order" / unassigned: "✋ Claim this job") + .wo-link text
links (Update progress·Reassign/Assign·Close·Edit; closed: Progress history·Copy to new·
Reopen·Edit). Payout-pending cards PINNED open (page's real CTA), flattened — no more
card-in-card-in-card amber nesting; .payout-confirm-btn full-width + "Not yet" link;
non-admin = read-only "waiting for Dad's OK". Killed: red OPEN pill (open = default state,
no chrome; .wo-status kept quiet navy/green for the 3D PRINTS page which shares it),
green .wo-hasvalue stripe, "Assigned:" labels (group header carries it), "Created by" own
line (→ .wo-byline in detail), .wo-ghost-btn/.wo-close-btn/.wo-progress-btn/.payout-card.
woDuePhrase() = relative dues ("overdue by 2 days" red / "due today/tomorrow/Friday" /
"due Aug 12"); woDueInfo stays (chores-tab wo-row + toast use it). woGroupHeader: sentence
case ink name + quiet "· N" count (li.group-head.wo-group-head — DOUBLE class needed, the
base group-head uppercase rule comes later in the sheet); red .wo-badge ONLY on the payout
group (alert=true 4th param). Red = overdue + payout alert only; money = --good-d.
Suite: scratchpad wo_redesign_test.mjs 34/34 (collapse/expand/one-at-a-time, relative dues,
claim persists, progress sheet + milestones, close sheet, Dad confirm clears payoutPending,
reopen, quiet headers, 0 pageerrors ×2 users).
📈 STOCK WATCHLIST (2026-07-23, dashboard bottom): a per-device watchlist card at the end of
renderDashboard (after the dad joke, before the footer). Add/remove tickers (＋ Add toggles an
inline uppercase input; ✕ removes), each row shows ticker · company name · price · daily change
colored green ▲ / red ▼ (vs prior close) + %. DATA: localStorage bucky_stocks (["AAPL",...]) +
bucky_stocks_cache {ts,q:{SYM:quote}} for instant paint; stocksRefresh() repaints-if-still-on-
dashboard when stale >60s / a symbol has no quote / forced (weather-card pattern). Quotes come
through netlify/functions/stocks.mjs — a KEYLESS server proxy to Yahoo's /v8/finance/chart/<SYM>
endpoint (no API key, no new env var — just the existing BUCKY_NOTIFY_SECRET gate; server-side
because Yahoo sends no CORS headers so a direct browser fetch like the weather widget can't
work). Per-symbol parallel fetch (the batch /v7/quote endpoint now needs a crumb+cookie),
cleanSymbol() allows only [A-Z0-9.\-^=]{1,12} (blocks path injection; permits BRK-B/^GSPC), a
bad/unknown ticker returns {ok:false} without sinking the others, ≤20 symbols, browser UA (Yahoo
rate-limits the default). STOCKS_BASE_URL env override for tests. NOT live-tested vs real Yahoo
(env egress blocks finance hosts) — after deploy spot-check a couple tickers render live. VERIFY:
node tools/_verify-stocks-server.mjs (18: parse/change-math, unknown→ok:false, dedupe+upcase,
injection/over-long reject, 20-cap, secret gate) + scratchpad stocks_client_test.mjs (14,
playwright: add/upcase/persist, ▲green/▼red, Not-found, ✕ remove, cache paints with network
down). GOTCHA: `new Response(null,{status:204})` for the CORS preflight — Node's undici rejects a
204 with even an empty-STRING body (Netlify tolerated ""); and in playwright route mocks the
catch-all `**/.netlify/functions/**` must be registered BEFORE the specific `/stocks` route
(most-recently-added handler wins).
🍽 MEALS — Mom-only calorie tracker (2026-07-22, opus agent from Fable spec, UNPUSHED):
3rd Plan-area member `mealplan` (NAV_GROUPS plan=['calendar','animalcare','mealplan'];
chip via navKeyVisible gated on seesMeals()/MEAL_USERS=["Mom"]; render() bounces non-Mom
→ dashboard; farmgpt/games/weather navs untouched — areas unchanged). Source = the user's
Weekly_GF_Meal_Plan.docx baked in verbatim as consts (1,400 cal/day GF plan, Mon–Sun day
totals 1395/1350/1390/1430/1360-Fri-cheat/1395/1355 — suite asserts recomputed sums equal
these). renderMealPlan pill nav (bucky_meal_page): TODAY (day paging, eaten/1,400 summary
bar green→amber→red, tap-row toggle, ⇄ swap / ✕ remove+undo, Add sheet = catalog + doc
quick-adds + custom name+cal, future days read-only note) · WEEK (Mon–Sun grid, tap-through)
· PROGRESS (SVG bars 30/90/all vs 1400 line, 7-day avg/days-on-plan/streak, deficit
estimate vs ~1,850 maintenance, weigh-in sheet + SVG trend vs 150→125 goal line over 20
wks) · GUIDE (full plan tables + rules + tiers + swaps + grocery). DATA: getSetting docs
mealMeta {start,startWeight,goalWeight,target} · mealLog_<YYYY-MM> month-sharded
{days:{key:{items:[{id,meal,n,c,done,add?}]}}} · mealWeight sparse map. Days materialize
LAZILY on first interaction as self-contained snapshots (viewing never writes; history
immune to template edits); ~400ms debounced saves. Day keys America/Chicago en-CA via
UTC-noon arithmetic (NOT the siblings' dateKeyLocal). Test hook __MEAL__; CSS scoped
.mealwrap. Suite: scratchpad mealplan_test.cjs 76/76, 0 pageerrors (gating incl. Dad
gateDad() prompt auto-dismiss, template sums, toggle/add/swap−70/remove, reload persist +
setting_mealLog_ key + untouched-day-writes-nothing, 2-month shard seed, mobile 390 +
desktop). TEST GOTCHA: shared browser context leaks localStorage across "fresh" pages —
use an isolated incognito context per app open.
DAD + AI CALORIE LOOKUP (2026-07-31): MEAL_USERS now ["Mom","Dad"] — MEAL_PROFILES per-user
config {target, maintenance, template, suffix, start/goalWeight}: Mom = 1400/GF-template/legacy
doc ids (unchanged live data), Dad = 2500/freeform (days start EMPTY, no quick-adds/catalog/
swap/Guide — those are the GF-plan surface; deficit note + weight goal line also Mom-only).
Per-user docs via mealDocSuffix(): Dad's are mealMeta_Dad / mealLog_<month>_Dad / mealWeight_Dad.
mealResetForUser() (renderMealPlan + every ensure*) clears caches on profile switch and FIRST
flushes pending debounced saves to the OLD user's doc ids — a timer firing after the switch
would otherwise write Mom's day into Dad's log. ✨ AI ADD (both users, Add sheet): free-text
meal description → farmgpt mode "calories" (Sonnet 5, non-streaming strict-JSON action like
storylog_*, secret-gated; usage bucket c_* + 🍽 dashboard row) → item logged already-done w/
"✨ AI" badge; not-food → ok:false gentle toast; parse-fail 502 → toast + button re-enabled.
Suites: tools/_verify-calories-server.mjs 20/20 + scratchpad meal_dad_test.cjs 35/35 (Mom
regression, Dad gating/2500/empty, doc separation both directions, AI ok/error/not-food paths).
NOT live-tested vs real Sonnet (env blocks Anthropic) — post-deploy, spot-check a couple of
real estimates for sane numbers.
🎤 VOICE LOGGING + HOME-SCREEN WIDGET (2026-07-31, same batch): (1) in-app — the Add sheet AI
row gains a 🎤 dictation button (Web Speech API, absent where unsupported; final transcript
auto-runs Estimate & add). (2) meallog.html — standalone voice quick-log page ("the widget"):
tap mic (NO auto-listen on open — user request 2026-08-02: listening only ever starts from a
mic tap; the old meallog_mic_ok auto-listen gate is removed) → speak →
mode "calories" → entry QUEUED to settings doc mealInbox<suffix> {items:[{k,meal,n,c}]}
(meal-of-day by Chicago hour; cloud via inline-duplicated Firebase config w/ 4s race, else
localStorage setting_ fallback — same keys the app's local backend reads); result screen w/
breakdown + Undo; identity = meallog_who || choreUser-if-meal-user || Dad. DELIBERATELY NO
manifest link on the page — Chrome "Add to Home screen" then makes a plain shortcut straight
to meallog.html (that shortcut IS the android widget; a true widget needs a native APK).
manifest.webmanifest gains a shortcuts entry (long-press Bucky icon → "🍽 Log a meal").
MACROS (2026-07-31, user): mode "calories" also returns protein/carbs/fat GRAMS (meal-level
+ per-item p/cb/f, clamped 0..2000, maxTokens 600→800); AI-added items store {p,cb,f} (manual/
template items don't — macro totals count only what's tracked); MEAL_PROFILES.macros = daily
targets (Mom 90/155/47g, Dad 155/280/85g ≈ 25/45/30% of cal target); Today page renders 3
.mealmacros bars (eaten g vs target, >115% = .over tint); meallog result + toast show the
macro line; inbox items carry p/cb/f through the drain. Suites now calories-server 24 ·
meal_dad 38 · meallog 37.
⭐ ADD AGAIN — recents (2026-08-01, user: re-select previously entered foods next day): the Add
sheet gains an "Add again" chip row (below the AI row, both users) — mealRecentFoods() derives
recents straight from the month shards (this + last month, mealPrevMonthKey), add:true items
only (template plan meals excluded), deduped by normalized name w/ FRESHEST calories/macros
winning, sorted last-day-desc then count-desc, cap 14, fills async (hidden when empty). Tap =
mealAdd done:true carrying ai flag + macros → counts as eaten immediately. No new storage —
works retroactively on everything already logged. Hook __MEAL__.recents(). Suite: scratchpad
meal_recent_test.cjs 18/18 (dedupe/freshest/exclusions/order/macros/Mom-template-exclusion/
suffix separation).
VOICE MODE SAGA (2026-07-31, three iterations — the SURVIVOR is one-shot): (1) tap-to-finish
(continuous=true + onend restart-until-⏹) fixed thinking-pause cutoffs but on the user's
Android each restart REPLAYED THE MIC CHIME and dropped words between sessions; (2) a raw-audio
rework (MediaRecorder → server mode calories_audio → Gemini) killed the beeps but Gemini kept
rejecting the clips ("voice estimator isn't reachable") and the user vetoed Gemini — REVERTED
(PR #7 reverts PR #6; note the Anthropic API takes NO audio input, so "Sonnet transcribes" is
impossible — transcription must be on-device or Gemini). (3) FINAL: both mics are ONE-SHOT
Web Speech — continuous=false, say the meal in one go, recognizer self-ends on the first real
pause and auto-submits (tap ⏹ = finish early, submits what was heard); NO restart loop ever
(that's the beep source). User accepts speaking without pauses. Suite fake fires
__SR_LAST__.onresult then .onend().
(3) index.html mealDrainInbox() (renderMealPlan, 60s-throttled, __MEAL__.drainInbox forces):
drains the inbox through mealAdd (template-aware — the widget page can't materialize Mom's
plan days, which is WHY it queues instead of writing mealLog directly); applied-then-cleared
so a crash duplicates rather than loses; aborts mid-drain on profile switch. Suite:
scratchpad meallog_test.cjs 25/25. TEST GOTCHA: headless Chromium exposes UNPREFIXED
window.SpeechRecognition natively — a fake must override BOTH names or the real one shadows
it and errors not-allowed. Voice quality/mic UX not testable headless — playtest on the
actual phone. (Auto-listen on open was indeed unwanted — removed 2026-08-02, see above.)

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
- PARENT MONITORING (2026-07-09): (1) the 📊 API-usage-&-cost link in FarmGPT is now Dad-only —
  gated on localStorage["choreUser"]==="Dad" (same identity as index.html PRINT_ADMIN; NOT a hard
  lock — the stats endpoint is still family-password gated — just keeps spend out of the kids'
  sight). (2) STORY CONTENT LOG so Dad can review what the kids read: the FUNCTION logs every story
  scene to Firestore collection farmgpt_story_log (server-side, kids can't bypass), keyed by kid +
  Central day; deterministic doc id `<date>__<user>__<storyId>__<idx>` (retries overwrite, never
  dup). The client sends user(choreUser)/storyId/storyTitle/sceneIdx/choice on story requests;
  logStoryReq gate skips research/summary AND user==="Dad"; ===ART=== SVG stripped before store;
  logged in the stream finally (never breaks a reply). DELIVERY = an IN-APP Dad-only "📖 Story Log"
  page in FarmGPT (NOT a local file / not emailed — user iterated through all three; the browser
  page needs no Windows Task Scheduler and works on any device). New secret-gated function actions:
  mode:"storylog" → readStoryLog() lists the collection server-side (service account), AUTO-PRUNES
  anything older than STORY_LOG_RETENTION_DAYS=30 (bounds public-Firestore exposure w/o a scheduler),
  returns {entries} sorted date-desc/idx-asc; mode:"storylog_clear" {date} → clearStoryLog() deletes
  a day (via :commit delete writes). Client Story Log view groups entries date→user→story and
  renders each scene with the EXISTING parseChapter() (world/setup line, chapter title, prose,
  choices offered + the one taken) + a per-day 🗑 clear. Button + view gated on choreUser==="Dad"
  (UI-hidden only; endpoints are family-password gated like stats). WHY route the browser read
  through the function (not Firestore-direct): dodges browser CORS, reuses the server-side service
  account, keeps the public key off a third page. Verified: backend storylog read excludes Dad +
  prunes 30-day-old docs + clear empties + 401 on bad secret (fake Firestore + REAL Haiku); UI
  renders grouped/parsed w/ Dad-gating + clear, 0 pageerrors. (Retention gotcha: .slChap CSS
  uppercases the chapter label, so innerText reads it uppercased in tests.)
- DAD ACCOUNT LOCK (2026-07-09, app-wide — index.html + farmgpt.html): the Dad profile is now
  PIN-protected (sensitive stuff moved to it — banking, API cost, kids' Story Log). In-app PIN
  (user chose "no server setup"): created the first time Dad is selected, hashed sha256(pin +
  ":" + FAMILY_PASSWORD) — never stored plaintext — saved to Firestore settings_<familyKey>/
  dadAuth.pinHash AND mirrored to localStorage["dadPinHash"] so farmgpt.html (no Firebase SDK)
  can verify it too. Unlock = sessionStorage["dadUnlocked"]="1", which is ORIGIN-WIDE so unlocking
  in one page unlocks the other. Shared helper names identical in both files: sha256Hex,
  dadPinHash(), dadConfigured(), dadUnlocked(), gateDad()/tryUnlockDad(). index.html: added
  backend.getSetting/setSetting (a settings_<fam> doc, kept OUT of the chores collection; local
  backend uses localStorage "setting_<id>"); meBtn (profile switch) → gateDad() when name==="Dad"
  (create-or-verify; leaving Dad clears the unlock); afterBackendReady() syncs the hash + auto-
  prompts if Dad-but-locked on load; the two banking gates (payout confirm buttons + kid bank
  admin chips) changed myName()===BANK_ADMIN → bankAdmin()= name && dadUnlocked(). farmgpt.html:
  usage + Story Log links gated on isDad()=name && dadUnlocked(); a "🔒 Unlock Dad tools" link
  (shown when Dad-but-locked & PIN synced locally) prompts + verifies against the local hash. SOFT
  client gate (a devtools kid could set the session flag; the real strength is not knowing the
  PIN) — consistent with the app's existing choreUser-identity posture. Verified headless: farmgpt
  gating + PIN unlock reveals the Dad links (18/18); index.html create-PIN/verify/reject-wrong/
  auto-prompt-on-load, banking untouched, Firestore blocked → local backend, 0 pageerrors (10/10).
  KNOWN GAP: banking data still lives in public Firestore (rules unchanged) — the lock hides the
  admin UI, not the raw data; true server enforcement would need the "server-enforced" option
  (DAD_PASSWORD env var) the user declined.
- ROSTER-EDIT PIN GATE (2026-07-10, index.html): a kid discovered the FarmGPT 30/day story cap
  is per-choreUser-identity and beat it by renaming their own profile in the Family sheet (new
  name = fresh identity = fresh cap). Family-sheet roster MUTATIONS (add member, save an edit,
  delete a member) are now gated behind `gateDadForRoster()` — a wrapper around the existing
  `gateDad()` (create-or-verify PIN prompt) called at every mutation point: `saveFamilyMember()`
  (covers both Add and Save-edit — the single mutation path for both), the ✎ edit-entry `onclick`
  (gated too, for early friction — the ✎ button just loads the form, so double-gating it is free),
  and the 🗑 delete `onclick`. "This is me" (selecting an EXISTING profile) stays ungated except
  the pre-existing Dad-profile gate. A muted hint line was added under the form: "🔒 Dad's PIN is
  needed to change the family list". SUBTLETY CAUGHT: `gateDad()` sets the SESSION-WIDE
  `sessionStorage["dadUnlocked"]` flag on success, and that same flag also gates banking admin UI
  via `bankAdmin() = isDadName() && dadUnlocked()`. Traced every `dadUnlocked()` call site (3:
  `bankAdmin()`, the payout-confirm/kid-bank-admin-chip gate, and the Dad-but-locked auto-prompt in
  `render()`) — all of them ALSO require `isDadName()` (current profile === "Dad"), so a kid's
  session having `dadUnlocked=1` while `choreUser` is still the kid's own name does NOT by itself
  unlock banking (and re-selecting "This is me" → Dad still forces a fresh `gateDad()` prompt
  regardless of the flag). Handled defensively anyway per the task spec: `gateDadForRoster()`
  clears `sessionStorage["dadUnlocked"]` right after a successful gate IF the current profile is
  NOT Dad, so a kid's session never carries the flag past the roster edit; if the current profile
  IS Dad, the unlock is left in place (a legitimate Dad session, matches existing behavior).
  Verified headless (scratchpad p14_roster_gate.mjs, window.prompt stubbed via addInitScript with a
  scriptable answer queue since gateDad uses prompt()/alert()): 10/10 — fresh family + cancel PIN
  creation → no member added; wrong PIN at the ✎ entry gate → form not populated; wrong PIN at the
  save gate → rename rejected; right PIN at both → rename applies; add-with-right-PIN succeeds;
  "This is me" on a non-Dad profile calls prompt() 0 times; post-edit sessionStorage.dadUnlocked is
  null for a kid session; 0 pageerrors. Regressions unaffected (profile-switch flows exercised
  there call no roster mutations): p7_fixes.mjs 15/15, p8_gate.mjs 18/18.
- STORY CAP: CANONICAL IDENTITY BUCKETS (2026-07-16, user: Eleanor ran 50+ story requests/day
  despite the 30 cap): production `farmgpt_story_log` showed the cap WAS enforcing exactly 30 —
  per exact `user` STRING. Eleanor ran a second identity `"Eleanor ( :"` alongside `"Eleanor"`
  (30+30 on 07-11, 30+21 on 07-12; no such profile exists in the roster now — either deleted
  after, or she set localStorage.choreUser directly, the roster PIN gate can't stop devtools).
  (Her 54-scene 07-10 run predates that day's 13:44 CDT cap deploy — not a live bug.) FIX
  (farmgpt.mjs): `canonStoryUser()` — lowercase, strip non-alphanumerics; any name CONTAINING a
  known family name (STORY_CAP_KNOWN = eleanor/grandma/grandpa/janae/isaac/john/joy/mom) buckets
  as that person; anything unrecognized shares ONE `~other` bucket (invented names split a single
  30/day, never one each). Only the EXACT string "Dad" stays uncapped (caller check unchanged) —
  "Dad ( :" style variants land in ~other and ARE capped. `countStoryToday()` now queries by date
  equality ONLY (+ a `select` mask on the `user` field — scene docs are up to ~24KB and only the
  name is needed) and bucket-matches in code; still fails OPEN on query errors. Log docs keep the
  RAW name so the Story Log shows the parent exactly what identity was used. Client mirror
  (farmgpt.html): same canon fn keys the local `farmgpt_story_count_v1` counter (a same-device
  rename no longer resets the pre-check) + exact-"Dad" client exemption added (previously the
  local counter would wrongly block Dad at 30 even though the server never would). KNOWN LIMIT:
  a devtools kid setting choreUser to exactly "Dad" bypasses cap AND logging — server can't
  verify the PIN; consistent with the app's stated identity posture. Keep STORY_CAP_KNOWN in sync
  (both files) when the family roster changes; a NEW legit member shares ~other until added.
  Verified: scratchpad cap_test.mjs (in-process handler + fake Google/Firestore/Anthropic, 13/13:
  rename/case/punctuation variants capped, mixed identities sum, 29 allowed, query shape, shared
  ~other bucket, per-kid isolation, Dad exempt / Dad-variant capped, fails open, research
  untouched) + cap_client_test.mjs (playwright vs local http, CDN libs stubbed — jsdelivr is
  unreachable from sandbox Chromium, 4/4). Production Firestore audit script: storylog_audit.mjs.
  CAP LOWERED 30 → 15/day (2026-07-16, user, after confirming the bucket fix held for a few
  days) — STORY_DAILY_CAP in BOTH farmgpt.mjs and farmgpt.html (keep in sync); both suites
  re-run green at 15.
- STORY LOG → DAILY SUMMARIES (2026-07-30, sonnet agent from Fable spec, PUSHED): Dad's Story
  Log no longer stores/renders full transcripts — ONE Haiku-written summary per kid per day
  (📖 about / 🧭 how the kid steered it, write-ins quoted / verdict line: ✅ clean or 🚩 flagged
  when the kid pushed toward restricted-adult content or the story had to redirect; uncertain →
  flag with a note). NEW collection farmgpt_story_summary (doc id <date>__<canonKey>, ~other→
  "other" in the id only; users[] keeps every raw identity seen so the rename trick stays
  visible; 90-day prune STORY_SUMMARY_RETENTION_DAYS). NEW action storylog_summaries (replaces
  the old storylog transcript action; runs LAZILY when Dad opens the log: groups raw scenes by
  (date, canonStoryUser), processes ≤3 groups/request, client polls while pending>0 cap 10).
  ORDERING GUARANTEE: the summary doc write is confirmed ok BEFORE that day's raw scenes are
  deleted, and TODAY's raw scenes are NEVER deleted (countStoryToday's daily cap queries them;
  today renders a "(so far today)" partial:true card, re-summarized when sceneCount changes).
  Failure = one retry then a flagged:null sentinel doc (sceneCount:-1) so the group re-attempts
  next open with scenes intact. storylog_clear now clears scenes AND summaries for the date.
  Summarizer = non-streaming Haiku (callAnthropicOnce), STRICT-JSON parsed defensively, usage
  under u_*; kidstory (Benjie) scenes summarize through the same path. GOTCHA the suite caught:
  `pending` must count group RESOLUTION (classified − resolved), not classified − batchSize —
  a failed write otherwise reports pending:0 and the client poll never converges. VERIFY:
  node tools/_verify-storylog-summary.mjs (77: blocked-write ordering proof, cap regression,
  rename-variant merge, all retry paths, pending arithmetic 7→3/3/1, both prunes, 401) +
  scratchpad client suite 24/24 + kidstory 54/54 + dnd 47/47 regressions. Flag QUALITY not
  live-testable from this env — spot-check the first real day post-deploy and tune
  STORY_LOG_SUMMARY_SYSTEM if flags read too twitchy or too quiet.
- CONTINUITY BATCH (2026-08-01, user: "Eleanor often hits continuity issues" — diagnosed from her
  live story log: the model narrated past a decision she reserved, and after her "Redo that…"
  correction the rejected scene's invented details (chains/cuffs) kept resurfacing because the bad
  scene stayed in the history; her most careful correction was ALSO silently clipped at the
  write-in box's maxlength=400, mid-sentence, at exactly 400 chars): (1) REDO MECHANIC — a
  write-in matching /^\s*(please\s+)?re-?do\b/i REMOVES the rejected scene from story.messages
  entirely (tryRedo in farmgpt.html; the redo text stays as its own user turn tagged
  {opener:bool}); consecutive user turns are merged ONLY at send time (mergeUserRuns in
  buildSendMessages — the API needs alternating roles, the saved transcript stays honest);
  paintTranscript (factored out of resumeStory) repaints the scroll; a redone chapter OPENER
  regenerates with newChapter:true (resume honors last.opener too); summarizedIdx pulls back if
  the rejected scene was already folded. sceneIdx for the parent log is now MONOTONIC
  (story.sceneSeq) so a redo logs under a FRESH doc id — Dad sees both versions AND redos still
  count against the 15/day cap (reusing the index would have overwritten the doc and made redos
  cap-free). (2) write-in maxlength 400→2000 (server already caps at 12k). (3) STORY BIBLE — the
  recap prompt (SUMMARY_SYSTEM, farmgpt.mjs) rewritten from "≤180-word bullet notes" to a
  4-section bible (CHARACTERS w/ established physical details marked CANON · NOW = where everyone
  is · FACTS & SECRETS incl. who-knows-what · THREADS), ≤400 words, maxTokens 400→800; redone
  content: "corrected version is the ONLY truth". (4) STORY_RULES_REMINDER (rides every last user
  turn) gains continuity law: reader-specified details are CANON, never contradicted; a reader-
  reserved decision ("I want to decide that") means END THE SCENE BEFORE that point; a REDO
  message means the flawed scene is already discarded — write fresh. Suites:
  tools/_verify-story-reminder.mjs now 25/25 (+bible checks) + scratchpad story_redo_test.cjs
  26/26 (wire/DOM/saved-story scene removal, role alternation, merged turns, fresh sceneIdx,
  opener redo, resume, maxlength) + storylog-summary 77 / kidstory 54 / dnd 47 regressions green.
- COLLABORATIVE STORY BATCH (2026-08-01, user, 6 changes): (1) CHAPTER STEERING — chapterEndRow
  gains #nextChapterIdea (maxlength 2000): filled → the idea IS the next chapter's opening user
  turn (tagged {opener:true}, addPickedEl'd, logged as the choice); blank → NEXT_CHAPTER_MSG
  sentinel as before; Enter submits. (2) SCROLL-GATED CHOICES — gateChoices()/storyAtBottom()
  (farmgpt.html): after a scene lands, choiceBtns/writeRow/chapterEndRow hide (.gated class +
  #scrollHint "⇣ keep reading") until #storyScroll is within 48px of the bottom; short scenes
  never gate; capped/ended never gate. (3) MEMORY BEEF-UP (user-approved token spend): mode
  "summary" now runs on SONNET always (provider resolution split from story; dashboard prices
  u_* at Sonnet from 2026-08-01 — earlier u_* docs were Haiku, slight over-estimate is fine);
  bible gains GOALS & MOTIVATIONS section + POSSESSIONS-per-character in CHARACTERS, ~700 words,
  maxTokens 1200; SEND_CHAPTERS 4→6. (4) PARENT-REPORT FLAGS RECALIBRATED — franchise crossovers
  (Star Wars/lightsabers) + ordinary fantasy combat are NEVER flag-worthy; flag only GRAPHIC
  content (gore/torture/dwelled-on injuries), REPEATED pushes for more/harsher violence (>1
  redirect), or sexual/political content. (5) TRANSCRIPTS RETAINED — raw farmgpt_story_log
  scenes are NO LONGER deleted after summarization (the cleanup kind is gone; final-summary +
  scenes = normal resting state); STORY_LOG_RETENTION_DAYS 30→90 (accessible for review via
  Firestore REST — public rules, see scratchpad pull_eleanor.mjs pattern); new secret-gated
  action storylog_scenes {date, canon} → the Story Log renders a "📜 Read the day's transcript"
  toggle under each report card (slTrans* CSS; parseChapter strips markers). storylog_clear
  still deletes both. (6) READER IS LAW — STORY_SYSTEM write-in line + STORY_RULES_REMINDER
  gain co-author language: write-ins are direction not suggestion, never watered down, crossovers
  welcome; content rules remain the only override. Suites: _verify-story-reminder 30/30 ·
  _verify-storylog-summary 86/86 (deletion asserts inverted to retention + storylog_scenes +
  flag-rule checks) · scratchpad story_ux_test.cjs 22/22 (gate/steer/transcript) ·
  story_redo_test 26/26 + parent-research 25 / kidstory 54 / dnd 47 / calories 24.
📚 UNIVERSE BIBLES (2026-08-01, user: Eleanor's redos mostly correct HTTYD canon): server-side
  UNIVERSE_BIBLES in farmgpt.mjs — compact franchise fact sheets (HTTYD incl. RTTE · Super Mario ·
  Star Wars · Pokémon; ~250 words each) AUTO-ATTACHED to the STORY system prompt when the
  request's message text matches a trigger regex (universeGuides(messages) — JSON.stringify scan;
  no picker, the world setup names the franchise and character names in scenes/recap keep it
  sticky after windowing; crossovers attach multiple guides). Key facts encode the exact redo
  classes: dragons NEVER talk, Hiccup/Toothless prosthetics, Grimborns, per-character
  weapons/dragons; Pokémon say only their names + faint-never-die; Mario poof-not-die. Guide
  header: reader's explicit changes WIN (reader-is-law compatible). story mode only (research/
  kidstory/summary untouched). False-positive care: bare "peach"/"toad" don't trigger ("princess
  peach" does). To add a universe: append an entry, nothing else to wire. Verify:
  _verify-story-reminder.mjs now 40/40 (+10: attach/facts/yield-line, no-trigger, peach guard,
  Mario, crossover BOTH, recap-sticky, research-never).
⚔️ STAR WARS SHEET REBUILT MECHANICS-FIRST (2026-08-02, user: "she needs more force awareness,
  not characters"): ~680 words — THE FORCE (light/dark, born-not-learned, ranks, Rule of Two;
  telekinesis scaling; body powers + deflection-via-precognition; mind trick limits; TELEPATHY
  & FORCE BONDS — siblings/partners speak mind-to-mind, feel each other, sense across distance,
  the exact mechanic Eleanor plays; dark powers; limits/costs/Force ghosts) + LIGHTSABERS
  (kyber crystals choose/bleeding-makes-red, weightless blade/cauterizes/locks, beskar resists;
  TYPES incl. double-bladed = ONE central handle — evidenced by her ASCII-art redo — shoto,
  crossguard, curved, darksaber; seven dueling forms) + compressed galaxy color. Triggers +=
  kyber|padawan|darksaber|force push|force lightning.
🧬 EVOLVING FAMILY CANON (2026-08-01, user: kid-created characters like Bree should become part
  of the universe sheet and evolve): farmgpt_canon/<universeKey> Firestore doc per universe —
  after every mode-"summary" story-bible fold, the server detects the story's universe(s) and a
  Sonnet bookkeeper (CANON_UPDATE_SYSTEM, ≤500 words, NO_CHANGES sentinel skips writes, never
  drops a reader-created character — compresses instead) merges reader-created characters +
  lasting universe changes into the doc (updateUniverseCanons in the stream finally;
  captureReply = logStoryReq || summary). universeGuides() is now ASYNC: serves baked facts +
  "FAMILY CANON" block (fetchUniverseCanon, 60s warm cache; write updates cache). Canon is
  FAMILY-SHARED — one kid's characters exist in siblings' stories. Usage logs under u_*
  (Sonnet-priced ✓). HTTYD sheet also expanded 3x (~1,050 words, full RTTE cast w/ physical
  descriptions, Dragon Eye, lore; Johann twist stated plainly — kids have seen everything;
  "dragon rider" trigger REMOVED as too generic — an original dragon world must never get
  "dragons never talk" imposed). Verify: _verify-storylog-summary 105/105 (+11 canon:
  no-universe skip, Sonnet fold, empty-canon first fold, doc write, story-prompt injection,
  current-canon merge, NO_CHANGES no-write) + reminder 40/40.
🎁 STORY BUDGET REFRESH (2026-08-01, user): Dad-only button atop the Story Log view
  (#budgetGrantBtn) → mode story_budget_grant increments farmgpt_story_bonus/<farmDate> .extra
  by STORY_DAILY_CAP — everyone's effective cap that day = 15 + extra (grants stack; bonus read
  fails CLOSED to the base cap, unlike the count query which fails open). Server cap check +
  new mode story_budget {user} → {used, cap, capped}. CLIENT: farmgpt_story_count_v1 gains
  .cap (default 15); when locally capped, guardStoryCap + the capped-UI paint fire a THROTTLED
  (8s) background refreshStoryBudget() — a granted device adopts the new cap, repaints the
  controls, toasts "🎁 Dad refreshed…" (no reload needed; local block stays instant). Suites:
  _verify-storylog-summary 94/94 (+8 budget: stack/uncap/stream/Dad/401; fake Firestore now
  APPLIES integer increment transforms) + story_ux_test 28/28.
🍎 TEACHERGPT (2026-08-02, user; FINAL SHAPE = on-device .docx, NO Google APIs): FarmGPT home
  card + viewTeacher — a teacher photographs material (≤8 photos, client-resized 1568px JPEG,
  >4.5MB batches pre-blocked: Netlify ~6MB body cap), picks Quiz/Test + question count (3-50)
  + optional notes → mode "teachergpt" (OPUS 5, callAnthropicOnce w/ image blocks, maxTokens
  8000, strict JSON {title,chapter,instructions,questions[{q,choices?,lines}],answerKey};
  existing-quiz photos → same problems DIFFERENT numbers, prompt-enforced) → server returns
  the QUIZ JSON; the PAGE builds a .docx ON DEVICE (buildTeacherDocx in farmgpt.html:
  hand-rolled STORED-entry zip + CRC32 + minimal WordprocessingML — centered bold title,
  chapter · QUIZ/TEST line, Name/Date line, instructions, numbered questions w/ lettered
  choices or ruled answer lines, PAGE BREAK, ANSWER KEY page) → 💾 Save (a[download]) + 📤
  Share (Web Share API w/ files — native sheet: email anyone/print/Drive; hidden where
  unsupported; docx imports into Google Docs). Test hook __TEACHER__ (docx blob/name/build).
  TIMEOUT SAGA (three live failures shaped this): (1) plain response → Netlify sync cap kills
  60-90s Opus runs; (2) keepalive stream ALSO died live (~45s); (3) Google-Docs delivery via
  the SA died 403 despite both APIs verified enabled (suspect: 2025 zero-Drive-quota for
  service accounts) → Google axed entirely per user ("word doc + share = simpler").
  ARCHITECTURE: netlify/functions/teachergpt-background.mjs (-background suffix = 202
  immediately, 15-min allowance) → runTeacherJob (exported from farmgpt.mjs; re-checks the
  secret — endpoint is public; validates jobId) → teacherGenerate → writes
  farmgpt_teacher_jobs/<jobId> {status, quiz JSON, error}; the page polls mode
  teachergpt_result every 5s (missing doc = pending, 5-min client timeout); the streamed
  in-function path remains an automatic fallback when the background endpoint 404s. Usage
  bucket t_* priced at Opus 5 ($5/$25) w/ 🍎 dashboard row. Verify: tools/
  _verify-teachergpt.mjs 32/32 (prompt rules, quiz-JSON contract, bg job/poll/auth, other
  modes clean) + scratchpad teacher_client_test.cjs 21/21 (incl. unzipping the built docx
  with python zipfile and asserting the full print layout). NOT live-tested vs real Opus —
  post-deploy: run one real quiz, open the .docx in Word/Google Docs, check layout + print.
  PLAYTEST BATCH (2026-08-02, PRs #17/#18): button = "Generate the quiz/test ✨"; 0.5" margins
  (pgMar 720); heading EXACTLY "Chapter XX Quiz/Test" (tHeading regex; model title never prints);
  #tClass class-name input under the heading; answer space = BLANK paragraphs not ruled lines,
  keepNext+keepLines chains keep each question whole per page; "lines" prompt-matched to required
  work (compact bias — Err on the SMALL side). SHARE SAGA: Android Chrome's Web Share file-type
  allowlist REFUSES .docx (canShare() lies true, share() throws) → final UX = 💾 Save as Word doc
  + 📤 Send as PDF (buildTeacherPdf: hand-rolled %PDF-1.4, letter, base-14 Helvetica/WinAnsi,
  uncompressed streams, block-based keep-together pagination; PDFs ARE share-allowlisted; desktop/
  refused-share falls back to saving). Headless quirk: blob-anchor downloads report
  suggestedFilename "download" — assertions must tolerate.
  TYPESET MATH (2026-08-02, user: "math notation that looks good in a document"): TEACHER_SYSTEM
  now REQUIRES $...$ math with a tiny LaTeX subset (\frac{a}{b}, ^{n}, _{n}, \sqrt{x}, \times \div
  \pi \le \ge \ne \pm, 90^{\circ}; fractions NEVER slashes; money = NOT math, bare $4.50). Client
  tMathParse/tMathSplit (farmgpt.html, shared by both builders) parse to nodes; a $span$ only
  counts as math if it has \cmd/^/_ or is a short symbol-y run — dollar amounts in word problems
  stay literal ("costs $4.50 and $2" never becomes math; rejected spans re-scan from the 2nd $).
  DOCX: real OMML (m:oMath/m:f/m:sSup/m:sSub/m:rad; xmlns:m on w:document) — Word/Google Docs
  render native stacked fractions. PDF: hand-typeset — stacked fractions w/ drawn bar (0.72×
  digits, axis y+0.30size), raised 0.66× superscripts, radical drawn as a line path, π≤≥≠ via
  base-14 SYMBOL font F3 (built-in encoding — do NOT add /WinAnsiEncoding), ×÷°± are WinAnsi;
  tokens wrap w/ math segs unbreakable+glued to adjacent text, frac lines get extra leading
  (tall flag). GOTCHAS: JS template literals EAT backslashes (\f=formfeed, \s dropped) — prompt
  source needs \\frac, and python embedded in a JS template must build backslashes via chr(92)/
  chr(960); PDF op font sizes need rounding (11*0.72 prints 7.920000000000001). Suites now
  server 36 + client 42 (OMML asserts, fraction-bar/radical path ops, Symbol font, money-literal
  both formats). Math rendering verified visually via pdf.js render of the built PDF.
  FORM-B STYLE PASS (2026-08-02, user brought a LaTeX-made sample: "better style especially the
  way it shows formulas"): (1) header = navy #233357 bold heading + chapter-topic SUBTITLE (text
  after ":" in q.chapter) + Name/Date/SCORE ___/N row over a navy rule; (2) per-question "section"
  field in the quiz JSON — consecutive questions sharing it print ONE italic textbook directive
  ("Add." / "Solve. Show your work.") and question text stops repeating instructions; (3) NEW math
  commands \\stack{641}{872}{+358} (vertical column arithmetic, rows right-aligned over an answer
  bar; docx = m:eqArr + figure-space \\u2007 padding + m:bar pos=bot on the last row) and
  \\longdiv{47}{3,170} (docx = divisor + ")" + m:bar pos=top vinculum; PDF draws both); (4) bold
  question-number prefix runs; (5) PDF gains F4 Helvetica-Oblique for the italic directives + rg/RG
  navy color ops + rule items; boolean "tall" leading replaced by MEASURED tPdfMathExtra {up,down}
  per line (stacks rise a full row per addend). Suites now server 39 · client 48. Regenerating a
  sample: scratchpad make_test.cjs + ch1_quiz.json drive the REAL page builders headless via
  route-mocks (the pattern for making a test by hand: write the quiz JSON, run make_test.cjs).
- GUARDRAILS TIGHTENED (2026-07-30, user): FAMILY_RULES — torture scenes are never written even
  if explicitly/repeatedly requested (redirects in-story like other restricted topics);
  interrogation OK (questioning/pressure/bluffing/wits) but zero violence, torture, or threats
  of physical harm; injuries/suffering MAY be described, just never graphically — no blood, no
  gore, no dwelling on wound detail (user iterated: first cut banned describing suffering
  entirely, softened same day). STORY_LOG_SUMMARY_SYSTEM flag list mirrors the additions
  (torture/deliberate cruelty, blood/gore, violent interrogation). kidstory (already bans all
  peril) + dungeon (deliberately unrestricted) untouched. Suites re-green 77/77 + 54/54.
- UI FIX BATCH (2026-07-09, index.html + games.html + farmgpt.html): (1) Farm Bank shows only the
  logged-in kid's account (renderFarmBank: a BANK_KID sees just their card; Dad sees all). (2) Work-
  order cards compacted (tighter .wo-top/.wo-meta/.wo-desc/.wo-actions padding + 34px thumb) to fit
  more per screen. (3) .sheet gets max-height:calc(100dvh-16px)+overflow-y:auto so the tall Edit-goat
  form scrolls instead of running off the top. (4) Goat-care "never logged" confusion FIXED: the care
  editor pre-filled TODAY when nothing was logged (toInputDate(at || Date.now())) — looked like a real
  date next to the tab's "Never logged"; now blank when at===0 (careAt/daysSince already treat 0 as
  never; no data bug). (5) PERSISTENT NAV: the index tab bar vanished on the FarmGPT/Games pages (they
  navigate away). Added a persistent #buckyNav to farmgpt.html + games.html; in-app tabs link to
  index.html#<key>, and DEEP_LINK_TABS expanded to every section key so those hashes open the right tab
  (was game/catgame/workorders/farmbank only). Fixes (1)-(4) + DEEP_LINK_TABS all landed in index.html
  while the PARALLEL UI-redesign session was copying index.html→redesign/index.html, so the flip-to-live
  CAPTURED THEM — they shipped inside the redesign commit d7336b5 and are LIVE (verified present:
  showKids 3300, .wo-top 283, .sheet max-height 520, care-blank 2374, DEEP_LINK_TABS 1009). Do NOT
  re-apply to index.html.
  NAV REDONE 2026-07-09 to match the redesign: the first pass was a 10-icon GREEN top row, but the live
  redesign replaced index's top row with a 5-AREA BOTTOM BAR (#bnav / NAV_GROUPS: Home/Tasks/Bank/Farm/
  Play) in the Old Glory navy/red palette. So the farmgpt/games #buckyNav was rebuilt as the SAME fixed
  bottom bar (5 areas, navy #233357 active on #e7eefb, frosted blur, icon+label), Play active on both
  pages (both live under the Play area; Play→games.html). Colors HARDCODED (not var-based) so each
  page's own tokens can't drift it. LAYOUT differs by page because their body layouts differ:
  · games.html (simple BLOCK flow, no bottom composer) → the bar is position:fixed + body padding-bottom
    calc(safe-area+78px). Fine — block containers honor padding-bottom for scroll.
  · farmgpt.html (full-height FLEX column: header + main flex:1 + composer) → the bar is an IN-FLOW flex
    child placed AFTER </main> (flex:0 0 auto), NOT fixed. main got overflow-y:auto so the story-setup
    view scrolls INSIDE main. WHY not fixed: a fixed bar covered the flex-pinned research composer AND
    the story-setup "Begin" button; padding-bottom on a flex SCROLL container is NOT honored at
    scroll-end (button stayed under the bar even at max scroll). As an in-flow last child the bar takes
    real layout space, main shrinks to fit, and content can never hide behind it. #toast lifted to
    bottom safe-area+84px so transient toasts float above the bar.
  Verified headless (scratchpad/navtest2.mjs, CDNs allowed): 25/25 — 5 areas + labels + Play-active +
  hrefs on both pages, bar at viewport bottom, farmgpt research composer AND story-setup Begin button
  both clear the bar (mainscroll.mjs: btn reachable at main max-scroll), games bar fixed, 0 pageerrors.
  Regression: clienttest 17/17 + storyloguitest 18/18 still green with the nav added. TEST GOTCHA:
  puppeteer page.goto to a hash-only-different URL is a same-document nav (no reload) so initialHashTab
  never re-reads — add a ?n=<nonce> to force a full load.
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
- STORY DAILY CAP + LONGER CHAPTERS + HOME CAMERA→RESEARCH + RING FIX (2026-07-09, user: story
  time "getting too much use"): (1) DAILY CAP — server-enforced (kids can't bypass): on mode
  "story" requests (not research/summary), before calling the model, countStoryToday(user) runs a
  Firestore structuredQuery (:runQuery, two EQUALITY filters on date+user against
  farmgpt_story_log — no composite index needed) counting today's logged scenes; at/over
  STORY_DAILY_CAP=30 the function returns 200 + JSON {capped:true, message} WITHOUT ever calling
  the model (never a scary error). Dad and any unnamed session pass through uncapped (same
  condition logStoryReq already used to skip logging them — nothing new to count). Fails OPEN: a
  runQuery failure (network/auth/infra) returns null and the request proceeds normally — the cap
  must never break story time. Mirrored client-side (farmgpt.html) as a cheap pre-check +
  UX: localStorage farmgpt_story_count_v1 = {day (Central, en-CA format — matches the server's
  farmDate()), user, count}, bumped after each successful scene; guardStoryCap() short-circuits
  beginBtn/takeTurn/nextChapterBtn/resume-continue before ever hitting the network once local
  count hits 30, resets automatically on a new Central day (day mismatch = fresh state). If the
  server disagrees (says capped when the local counter didn't), callFarmGPT detects the JSON
  {capped:true} response (vs the normal text/plain stream) via content-type, throws a tagged
  err.capped, and streamChapter's catch syncs the local counter up to 30. UI: new #storyCappedRow
  ("📚 Wow, you've read a LOT today! … come back tomorrow…") replaces choices+write-in
  (setStoryControls computes `capped` and it wins over chapterEnd); shelving (doShelveStory,
  shared by #shelveBtn/#shelveCappedBtn) and the whole bookshelf stay fully usable. Research mode
  untouched. (2) CHAPTER LENGTH raised for an average ~3500 words/chapter (was ~1600):
  CHAPTER_SOFT_WORDS 1400→2800, CHAPTER_HARD_WORDS 2200→4200 (client word-count window that
  decides when to ask the model to close a chapter — chapters are still built from several ~900-
  word scenes since server maxTokens for story stays 1200). STORY_SYSTEM gained a line asking for
  full, unhurried, multi-paragraph scenes so length comes from richer scenes, not just more of
  them; also found (and fixed) that the model COULD self-close a chapter by emitting
  ===CHAPTER END=== unprompted (parseChapter honors the marker wherever it appears) — added an
  explicit "never write ===CHAPTER END=== unless a message explicitly instructs you to close the
  chapter right now" line to STORY_SYSTEM. (3) HOME CAMERA→RESEARCH: index.html's Home ask bar
  (.askbar) 🔬 icon replaced with a tappable 📷 button (.askcam, aria-label "Snap a photo for
  research") wired to a hidden <input type=file accept="image/*" capture="environment"> — picking
  a photo reuses resizeImage(file,1280,cb) (same helper the goat/work-order photo pickers use) to
  downscale to a JPEG dataURL, stashes it in sessionStorage["farmgpt_ask_photo"], then navigates
  to farmgpt.html?ask=<typed text>&photo=1. farmgpt.html's handleAskParam() extended: on photo=1
  it pops (reads + removes) that sessionStorage key, opens Research, and sends it through the
  SAME research photo pathway as the in-app 📷 attach flow (image content block + scaleToJpeg
  thumb via submitResearch) — text defaults to "Can you help me with this?" when nothing was
  typed. URL cleaned via replaceState either way so a refresh never re-asks/re-sends. Typed-text-
  only submits (no photo) are unchanged. Story cap does not apply to research. (4) RING CENTERING:
  .home2 .ring .val had been switched to display:flex;align-items:baseline (to get the "3/6"
  numerator+denominator on one baseline) which broke vertical centering inside the absolutely-
  positioned inset:0 box. Fixed by splitting the concerns: outer .val back to
  display:grid;place-items:center (true 2-axis centering) wrapping a new inner <span> that does
  display:flex;align-items:baseline (renderDashboard's hero template now emits
  `<span>${done}<small>/${total}</small></span>` inside .val). TESTS (scratchpad, new
  sessions must recreate the fake-service pattern — none of this hits real
  Anthropic/Firestore): p13_server.mjs (in-process farmgpt.mjs harness — fake Google
  token/Firestore/Anthropic http servers; 20/20: under-cap allowed, capped at 30 blocks the model,
  29 still allowed, query-failure fails open, research/summary unaffected, Dad/no-name pass
  through, runQuery filter shape, STORY_SYSTEM source checks), p13_client.mjs (playwright,
  farmgpt.html served over local http — file:// pages can't fetch() a root-relative path at all,
  so route-mocked fetch tests need a real scheme; 31/31: normal flow, local pre-cap blocks Begin
  with a toast, mid-story local cap replaces choices/composer while bookshelf stays usable
  (shelve+resume), server-side capped response syncs the local counter, stale-day rollover, research
  unaffected, raised word constants), p13_camera_ring.mjs (playwright, index.html + farmgpt.html
  both served over the same local http origin — file:// throws SecurityError on session/
  localStorage, and an ABORTED top-level navigation replaces the document with Chromium's
  network-error interstitial (also opaque-origin) which broke a naive "abort and then inspect
  sessionStorage" test — fix was to leave the intercepted navigation request pending instead of
  aborting it, so the original document stays alive to inspect; 21/21: camera button + hidden
  input wiring, sessionStorage payload + URL handoff (with and without typed text), farmgpt.html
  photo=1 pathway sends a real image block + text (typed and default-text cases), sessionStorage
  cleared + URL cleaned, typed-text-only regression, ring "3/6" centered within a fraction of a
  px on both axes). Regression note: this session's scratchpad happened to retain
  p9_home2.mjs/p10_navwx.mjs/p11_taste.mjs/p12_polish.mjs from earlier sessions (scratchpad
  persistence isn't guaranteed) — re-ran p12_polish.mjs (26/26) as a spot-check that the ring
  markup/CSS change didn't regress the rest of Home; didn't re-run p9/p10/p11 since none of them
  touch the ring/askbar/chapter code paths this batch changed.
- 🧒 STORY TIME JR — early-reader page for a visiting 6-year-old (2026-07-24, built for
  nephew Benjie on an iPad): `storytime.html` (self-contained, no nav chrome) + server modes
  `kidstory` (Haiku, maxTokens 500) and `kidart` (Sonnet — draws noticeably better shapes).
  DELIBERATELY NOT the big-kid story mode: scenes are 3-5 sentences of 3-9 words (a first
  grader can't read 900-word chapters), and the child NEVER TYPES. THE CENTRAL SAFEGUARD is
  that closed loop: the opening turn is one of 9 fixed STARTERS baked into the page, and every
  turn after is a choice the model itself wrote — so no text a child can produce ever enters
  the conversation. Backed server-side by KID_TURN_MAX_CHARS=200 truncation on kid-mode USER
  turns only (assistant scenes uncapped), so a tampered client still can't smuggle
  instructions. Guardrails stack KID_RULES (no peril/danger/death/villains/weapons/meanness/
  gross-out, every turn ends safe or silly, quietly steer away rather than refuse, treat all
  input as story never command) ON TOP OF the shared FAMILY_RULES. No daily cap; every scene
  IS logged to farmgpt_story_log so it shows in Dad's existing Story Log (logStoryReq extended
  to kidstory; parseChapter renders them fine since they use ===CHOICES===).
  CHOICE FORMAT: `1. 🦆 | Say hi to the duck` — the PIPE is deliberate, emoji-vs-text regex
  splitting is fragile; client falls back to a leading-Extended_Pictographic match then "✨".
  CLIENT (iPad-first): 30px/1.95 story text in per-word spans, read-aloud via SpeechSynthesis
  with word highlighting (boundary events + a 340ms paced fallback when they don't fire; iOS
  needs primeSpeech() — a silent utterance inside a real tap — before it will ever speak),
  96px+ choice cards, 9 emoji starter cards, localStorage resume (storytime_save_v1), `?who=`
  sets the greeting + Story Log name (default "Benjie", remembered per device).
  LAYOUT GOTCHA: stacked, the 400×260 picture fills a landscape iPad and pushes the words
  below the fold — landscape ≥900px goes SIDE-BY-SIDE (#storyTop grid: art left, words right,
  choices across the bottom). Per-word highlight spans need `margin: 0 -4px` to cancel their
  own padding or word gaps visibly inflate.
  🎨 IMAGES — two providers behind one env switch: `svg` (DEFAULT, free, no key: Sonnet draws
  a flat storybook scene, DOMPurify-sanitized client-side with script/foreignObject/image/text
  forbidden) and `gemini` (KID_ART_PROVIDER=gemini + GEMINI_API_KEY → gemini-2.5-flash-image
  "nano banana", ~4¢/image, returns a data: URL). Gemini failure FALLS THROUGH to the SVG
  drawing so a picture always appears. NOTE generativelanguage.googleapis.com IS reachable
  from the sandbox (unlike Anthropic/Yahoo) — verified with a real API-key-invalid response —
  so the image path can be live-probed with a key. Usage splits into TWO buckets since they
  bill differently: k_* kid text (Haiku) + a_* drawings (Sonnet) + g_* GENERATED IMAGES
  (counted, priced flat ~$0.039 each in the dashboard — per-image not per-token); rows 🧒/🎨/🖼.
  DIAGNOSTIC: mode `kidart_status` → {provider,hasGeminiKey,model,live} (no image, no cost) and
  `storytime.html?art=1` shows it as a banner — the gemini path falls back to a drawing SILENTLY,
  so without this there's no way to tell a configured setup from a quietly-broken one.
  TO TURN GENERATED IMAGES ON: Netlify env KID_ART_PROVIDER=gemini + GEMINI_API_KEY, redeploy.
  VERIFY: `node tools/_verify-kidstory-server.mjs` (36: model/budget, KID_RULES+FAMILY_RULES
  both stamped, 200-char user cap w/ assistant uncapped, no-cap + logging, k_*/a_* buckets,
  svg vs gemini provider incl. failure fallback + prompt content, story/research untouched)
  + scratchpad kidstory_client_test.mjs (37: zero text inputs anywhere ×2 screens, 30px text,
  choice parsing/size, exact wire payload, hostile-SVG neutered, resume, portrait+landscape
  fit). NOT live-tested vs real Haiku/Sonnet (env blocks Anthropic) — after deploy check
  reading level, exactly-3 piped choices, and drawing quality; if SVG art disappoints, flip
  KID_ART_PROVIDER=gemini. Page is intentionally UNLINKED from the family nav — bookmark
  storytime.html to the iPad home screen (apple-mobile-web-app-capable = opens fullscreen).
- 🎲 DUNGEON MODE (2026-07-23, Dad-only D&D 5e DM): `dungeon.html` (self-contained page, linked
  Dad-only from the FarmGPT home next to Story Log) + modes `dnd`/`dnd_update`/`dnd_summary` +
  storage actions `dnd_list/get/save/delete` in farmgpt.mjs. Sonnet 5 (RESEARCH_MODEL), adaptive
  thinking, maxTokens 3000. DELIBERATE DIFFERENCES from story mode (user spec): NO FAMILY_RULES
  appended (stock Sonnet only), NO daily cap, NO story-log capture. Because guardrails are off,
  this is the app's ONE hard server-side gate: every dnd* request carries Dad's RAW PIN
  (`dndPin`, typed per page-load, kept in memory + tab sessionStorage only, NEVER localStorage —
  the synced pinHash is public-ish so hash-as-credential would be replayable by any kid device);
  server sha256(pin+":"+secret)-compares vs settings_<fam>/dadAuth.pinHash (familyKeyFromSecret
  mirrors index.html roomId; 10-min warm cache; 8 wrong tries/10min = brake) and FAILS CLOSED.
  DM contract in DND_SYSTEM: absolute player agency (never act/speak for the PC), RAW 5e 2014,
  module fidelity, and REAL DICE — model may never invent a roll; it ends replies with
  `===ROLL=== dice|player-or-dm|label` lines, the page rolls crypto-random (adv/dis = d20adv/
  d20dis notation), player rolls tap-to-roll / dm rolls auto-roll openly, results auto-send as a
  `[ROLLS] …` user turn the prompt treats as authoritative. STATE: character sheet (JSON) +
  campaign journal appended client-side to the FINAL user turn only (older history stays
  byte-stable for the prompt cache); sheet updated after each DM turn by a dedicated `dnd_update`
  bookkeeper call (inline-marker state proved unreliable in the recap saga — dedicated calls
  only), journal folded by `dnd_summary` when >24 unsummarized turns; Dad can edit the sheet
  JSON directly (source of truth) + quick HP ± buttons. STORAGE: Firestore `farmgpt_dnd` via the
  function — campaign doc c_<id> (kind, name, charName, sheet, journal, turns tail ≤80,
  moduleShards, updatedAt) + module shards m_<id>_<n> (≤400k chars each, module ≤600k, pasted or
  .txt at campaign creation; module rides in the system prompt every dnd turn → cached re-reads).
  No sheet at creation → DM runs session zero. MODULE PDFs (2026-07-23): picker accepts .pdf —
  text-layer PDFs extract client-side via VENDORED pdf.js (assets/pdfjs/, pdfjs-dist 3.11.174,
  lazy-loaded on pick; "----- page N -----" markers so the DM honors page refs; 600k cap);
  SCANNED/photocopy PDFs (no text layer, detected <200 chars over >2 pages) offer "🔍 Read it
  with AI" → mode `dnd_ocr` (Sonnet vision, PIN-gated, 1 page-JPEG per request ≤1568px q0.82,
  3 in flight, 2 attempts/page, cancel keeps finished pages, ~1-2¢/page one-time). Usage logs
  under NEW `d_*` prefix (dashboard: 🎲 row + column, priced at Sonnet). VERIFY:
  `node tools/_verify-dnd-server.mjs` (47 checks:
  PIN fail-closed/brake, no-FAMILY_RULES + Sonnet + module injection asserts, no-cap/no-log,
  d_* usage, storage round-trip incl. shard preservation on module-less re-save, story/research
  regression — rules still stamped, cap still fires, scenes still logged). Client suite (35
  checks, playwright) in session scratchpad `dnd_client_test.mjs` (gate/create/dice/sheet/
  persistence/mobile). NOT yet live-tested vs real Sonnet (env can't reach the API) — after
  deploy, spot-check: never-acts-for-player, ===ROLL=== adherence, sheet extraction, module
  fidelity. Netlify request-body limits cap a pasted module ~a few MB (600k chars is fine).
- PARENT RESEARCH MODE (2026-08-01, user): research requests now carry `user` (choreUser) and
  EXACTLY "Dad"/"Mom" get PARENT_RESEARCH_SYSTEM — direct answers, full ANSWER KEYS for pasted/
  photographed worksheets (numbered, bold finals, one-line justifications), grade-a-kid's-work
  checks; tutor restrictions absent; FAMILY_RULES + LaTeX/Markdown + ===ANSWERS=== protocol
  kept; maxTokens unchanged. Everyone else (kids, "dad", "Dad ( :", missing) keeps the tutor
  prompt (PARENT_RESEARCH_USERS exact-match — same soft-identity posture as the story cap's Dad
  exemption; no PIN check server-side). Verify: tools/_verify-parent-research.mjs (25) +
  scratchpad parent_research_client.cjs (4, wire carries user).
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
- [x] HERD DUPLICATION RECURRENCE + hardening (2026-07-09): 36 goat dupes + 2 daily
      chores ("Feed the goats"/"Collect eggs") re-appeared in ONE burst 2026-07-08
      00:50Z (BEFORE that day's redesign push — unrelated to it). All bare seed copies
      (no photo/care) matching BUCKY_SEED; the 06-29 originals (photos+care) survived
      underneath. The batch = seed items {1,2,7-42} (2 chores + all 36 goats, skipping
      chores 3-6) = the same partial-concurrent-write signature as the 07-06 incident,
      i.e. a re-seed/herd-load path fired against the live DB. The 07-06 fromCache guard
      only closed ONE door; TWO re-seed paths remained: (a) the cloud auto-seed looped 42
      NON-awaited addDocs (partial-write prone); (b) the "Load the goat herd" button
      (importHerd) dumps the WHOLE herd if tapped while the in-memory list is empty (fresh
      device / a headless test hitting production before sync — there ARE un-blocked
      index.html test scripts in this session's scratchpad: verify-dash.js/verify-wiring.js/
      verify-tray.js/etc.; MY p2-p6 tests all block Firebase). CLEANUP (Firestore REST,
      public rules): scratchpad/goat_cleanup.mjs merged one stray care log (Daisy dewormed)
      onto its original then deleted all 36 dupes → 38 goats, 0 dups; the 2 daily chores
      were KEPT (each had a completion). HARDENING (index.html): new `serverConfirmed` flag
      (true on the local backend always; on cloud only when a NON-fromCache snapshot
      arrives) — importHerd now REFUSES to run until serverConfirmed (can't dump the herd
      pre-sync); the cloud-seed loop now name+frequency dedupes against present docs AND
      awaits each addDoc (no more partial writes). Verified headless 20/20, 0 pageerrors.
      REMINDER (again): headless index.html tests MUST block /googleapis|firestore|firebase|
      gstatic/ — old scratchpad scripts that don't are how this keeps happening.
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

# 🌤️ Weather — Woodville / Amen Farms (2026-07-09)

`weather.html` — dedicated farm weather page (no API keys). Lat/lon 34.686537,
-86.210417 (727 Co Rd 80, Woodville AL).
- **Forecast:** Open-Meteo (current + 7-day daily hi/lo/precip%/WMO emoji). Friendly
  error if fetch fails — page never blank.
- **Radar:** RainViewer Weather Maps API (`api.rainviewer.com/public/weather-maps.json`)
  + Leaflet OSM basemap. Past ~2h frames (10-min steps); nowcast appended when the API
  returns any (free tier often empty). Play/Pause + scrubber; farm pin on the map.
  Attribution: RainViewer + Open-Meteo + OSM.
- **Nav:** same 7-tab `#buckyNav` as games/farmgpt (Farm tab active). Home's weather
  card is a button → `weather.html` ("Radar & 7-day →").
- Smoke: `node tools/_verify-weather.cjs` (local http-server; network for real APIs).
- **RADAR MAP + PLAY-BAR BUG FIX (2026-07-09)**: user reported the radar map "not displaying
  properly" and the play bar "not working". Root cause: the `leaflet.css` `<link>`'s SRI
  `integrity` hash was WRONG (stale/typo'd), so Chrome silently BLOCKED the stylesheet
  (SRI mismatch — no visible error without opening DevTools). Without Leaflet's CSS,
  `.leaflet-*` panes/controls lose their `position:absolute` rules and render in normal
  document flow — the zoom control block pushed/overlapped content and tile panes stacked
  incorrectly, which also silently displaced the play/scrub row so clicks landed on the wrong
  spot (looked like "the play bar isn't working" but the click handler itself was fine).
  RainViewer's tile URL scheme (`host` field from `weather-maps.json` + `frame.path` +
  `/{size}/{z}/{x}/{y}/2/1_1.png`) was already correct — not the bug. FIX: corrected the CSS
  integrity hash to `sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=` (recomputed via
  `openssl dgst -sha256 -binary leaflet.css | openssl base64`; the JS `<script>` hash was
  already correct, untouched). `tools/_verify-weather.cjs` hardened to catch this class of bug
  again: asserts the stylesheet actually has `cssRules` (not just that the `<link>` tag exists),
  asserts ≥1 radar `<img class="leaflet-tile">` is mounted+loaded on the map, samples a real
  RainViewer tile HTTP response for 200, and the play/pause check now waits ~1.6s and asserts
  the scrub value actually ADVANCES (previously only checked the `.playing` CSS class toggled,
  which passed even during this SRI-block regression — a false-passing test). Verified fixed vs
  real network: 0 pageerrors, radar tiles load + render, play advances frames over time, pause
  halts, scrub jumps to a chosen frame and updates `#frameTime`; desktop + 390×844 screenshots
  confirm the map, farm pin, and unobstructed play/scrub controls.
- **FUTURE RADAR: −2h → now → +2h TIMELINE w/ NOAA HRRR (2026-07-09)**: the radar animation
  used to stop at "now" (RainViewer past frames only). Extended into the future with NOAA
  HRRR simulated-reflectivity model tiles, on ONE continuous scrubber. RainViewer's own
  nowcast is intentionally NOT used for the future segment (probed live: unreliable, often 0
  frames, ≤30 min when present) — dropped entirely; the server response's `radar.nowcast`
  array is no longer read.
  - **HRRR tile source + GOTCHA**: Iowa State Mesonet (`mesonet.agron.iastate.edu`) serves
    HRRR simulated reflectivity as Leaflet-compatible XYZ tiles at
    `/cache/tile.py/1.0.0/<layer>/{z}/{x}/{y}.png`. The layer name MUST be
    `hrrr::REFD-F<mmmm>-0` — **uppercase** `REFD`, and a trailing `-0` meaning "latest
    processed run" (`hrrrLayerName()` in weather.html). The lowercase form
    `hrrr::refd-fNNNN` (what seemed obviously right and is what got probed/shipped first)
    silently returns HTTP 200 for EVERY request with a fixed baked-in "Invalid TMS Request"
    error image (always exactly 20229 bytes at every z/x/y) — a false-positive trap for any
    `r.ok`-only probe. Verified real forecast steps exist every 15 min from f0000 through at
    least f0180 (HRRR's reflectivity product goes out further; untested steps not divisible
    by 15 min, e.g. f0500, correctly 503). `probeHrrrFrames()` in weather.html gently
    sequential-probes (not a burst) offsets 15/30/45/60/75/90/105/120 min against one tile at
    a low probe zoom (z=6, `lonLatToTile()`) and only adds steps that respond 200 — with the
    corrected layer name this is now a genuine existence check, not just status-200 theater.
  - **Timeline UX**: `frames` is now `past.concat(future)` (RainViewer past + HRRR future) as
    ONE array; `nowIdx` = index of the last past frame = the "now" boundary. A custom
    `.timeline-track` overlay (`#segPast` navy solid / `#segFuture` red diagonal-striped,
    widths set by `updateTimelineTrack()`) sits BEHIND `#scrub` and a `#nowMarker` tick+"NOW"
    label sits at the boundary — required stripping ALL native range-input chrome
    (`-webkit-appearance:none` on both the input AND `::-webkit-slider-runnable-track`, custom
    `::-webkit-slider-thumb`/`::-moz-range-thumb`) because Chrome's default track pill paints
    OVER a merely-`background:transparent` override and hides the custom colors underneath —
    found by comparing a rendered screenshot against `getComputedStyle` (the gradient WAS
    applied but invisible). `#frameTime` shows past frames as today's clock time + a "Now" tag
    on the boundary frame, future frames as `+N min · FORECAST` (no clock time — HRRR run
    timestamps aren't fetched, offsets are relative to page-load time). `playStep()` needed NO
    change — it already wraps 0..frames.length-1, so play now naturally traverses the whole
    past→future timeline and loops.
  - **Farm rain line**: new `#farmRainLine` strip under the radar card, from Open-Meteo
    `minutely_15` (`forecast_minutely_15=8` = 2h of 15-min slots). First slot with
    precipitation>0 → "🌧 Rain could reach the farm around 3:15 PM"; all-zero → "☀️ No rain
    expected...". Time parsed directly from the ISO string's `T HH:MM` (Open-Meteo returns
    local wall-clock for the requested `timezone`, no offset suffix) rather than through
    `Date()`, to avoid a double timezone conversion. **Hidden entirely** (not an error message)
    on fetch failure — `el.classList.add("hidden")` + empty text, no stale content.
  - **Degradation**: HRRR probe failing → `futureFrames:0`, timeline is past-only exactly as
    before (verified — the independent node-side reachability probe in
    `tools/_verify-weather.cjs` gates which branch the test expects). RainViewer failing but
    HRRR up → future-only timeline + an inline "Live radar is unavailable... showing HRRR
    forecast only" note. Both failing → the original full radar-err message. Page never blank.
  - **Verify**: `tools/_verify-weather.cjs` rewritten with 2 browser passes — mobile (full
    suite incl. future-frame presence gated on an independent IEM reachability probe, scrub-
    into-future swaps to a real loaded `mesonet.agron.iastate.edu` tile + `#frameTime` says
    "forecast", play traverses past the `nowIdx` boundary, now-marker visible, mobile
    timeline/nav non-overlap) and desktop (screenshot + a REQUEST-INTERCEPTION-blocked
    Open-Meteo `minutely_15` route to prove the rain line hides gracefully rather than
    aborting the page — request must stay pending-not-aborted-then-inspected per the
    farmgpt camera-ring lesson doesn't apply here since it's a fetch not a navigation, plain
    `req.abort()` is fine for a fetch). Screenshots `shots/wx_future_desktop.png` +
    `shots/wx_future_mobile.png` (scrubbed to a future frame first). Verified live against
    real RainViewer + real IEM + real Open-Meteo: 21 total frames (13 past + 8 future),
    nowIdx 12, all future steps 15–120 min found, 0 pageerrors both passes.

# 🎃 Hayhem — farmyard artillery (ACTIVE, 2026-07-10)

`hayhem.html` — Worms-style **1v1** farm artillery (Playroom Kit later). Terrain fantasy =
two farmyards with a pond between (NOT open dig-everything). Cast = Bucky animals only.
Team size 3/side. Old `varmintwars.html` DELETED; games.html + index PLAY_GAMES tile
swapped to Hayhem.

## Locked decisions
- Name: **Hayhem** · MP: 1v1 online, same arch as Farm Kart + Bistro (Playroom,
  host-authoritative, G-state) — Stage 4 · Stage 1 = solo/local feel
- three.js r128 CDN · custom chunked voxel grid (InstancedMesh) · ballistic pumpkin +
  carve blast · G object from day one · Bucky navy/red accents · mobile drag-aim + FIRE

## Build order (pause after each stage for playtest)
0. Scrap/relink VW · stub title + Bucky nav/back · games + PLAY_GAMES tiles
1. 3D voxel island (two yards + pond) + camera + drag-aim + one projectile + carve
2. Ragdoll critters + water-out win · dummy opponents (cannon-es)
3. Weapons / wind / juice
4. Playroom 1v1
5. Polish

## Current progress
- [x] **Stage 0** (2026-07-10): deleted `varmintwars.html`; removed VW from games.html +
  index.html `PLAY_GAMES`; added 🎃 Hayhem tiles → `hayhem.html`; title screen + ← Bucky
  bar; photobooth skill example updated.
- [x] **Stage 1** (2026-07-10): chunked voxel island (dirt/grass/stone, pond channel +
  translucent water), fixed overview camera, drag-aim arc preview + pumpkin ballistic,
  sphere carve rebuilds dirty chunks, 3 spawn flags + animal stubs per side (1 active
  shooter), rigid knockback, mobile FIRE button. Debug hook `window.__HAYHEM__`.
- [x] **Stage 2** (2026-07-10): cannon-es ragdolls (6 bodies: torso/head/4 legs) —
  stiff/kinematic while idle, soft PointToPoint + DYNAMIC on blast impulse; procedural
  blocky goats (west) + armadillos (east dummies); water-out when torso stays under the
  pond line (~0.55s) → gentle toast + team outs; win when one side all out; scoreboard +
  win banner; Stage 1 aim/carve preserved. Verify: `node tools/_verify-hayhem.cjs`.
  **Paused for user playtest — do not start Stage 3 until approved.**

## Hayhem A/B VERDICT (2026-07-10): hayhem2 WON — its build now IS hayhem.html
The user playtested both and picked hayhem2 (the independent Fable-session build): full
turn system (alternating teams, unit cycling, settle-wait, active-shooter arrow + name
labels), EAST AI that shoots back (accuracy ramps per round), slingshot drag-aim (pull
back, release fires; 40% arc preview), per-turn X-axis wind (HUD arrow, preview integrator
matches flight), WebAudio SFX (mute key localStorage hh2_muted — kept), 3rd-person
behind-the-shoulder aim camera + ~3s island-overview interlude between shots, water plane
above pond bed, direct-hit detonation (HIT_R 0.62), speed-scaled substeps (no tunneling),
portrait 390×844 framing, ammo system. Tuning: GRAV 18, MAX_POWER 26, carve r 1.5 /
knock r 2.9. CONSOLIDATION: winner content moved to hayhem.html (games/Play tiles needed
no change); v1 + hayhem2.html DELETED; debug hook renamed __HAYHEM2__ → __HAYHEM__
(fireAt/aimDrag/forceCamMode/camInfo/waterInfo/setWind/aiFireNow…); the winner's suite
replaced the old verify as `node tools/_verify-hayhem.cjs` — now 90 checks (grew past the
original 54 with ammo/camera-orbit/tap-aim sections), 90/90 PASS post-consolidation.
GOTCHA from the consolidation itself: OneDrive settled two agents' writes OUT OF ORDER
(page + verify script briefly held mismatched hook names; a stale http-server squatted the
suite's port 8862) — after any cross-file rename in this repo, re-grep BOTH files for
consistency before trusting a verify run, and kill port squatters by PID (never
taskkill-all-node: it nukes the other agent's processes).

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

# 📖 Storybook Squish! — Booksquirm party minigame (ACTIVE, 2026-07-17)

`storybook.html` — farm remake of Mario Party 4's Booksquirm using the NEW Tripo-rigged
mascot (assets/cast/bucky/, see BUCKY CAST section). UNTRACKED, not linked from games/index
yet, awaiting user playtest. Solo Challenge mode (survive pages, cap 99); versus/multi-cast
is the Stage 2+ plan. Built via threejs-game-director skill flow (gameplay/UI/QA sibling
skills loaded by the opus build agent), Fable spec+review, one polish pass.
- MECHANICS (researched vs MP4/Top 100/Superstars): pages HINGE-FLIP 180° over the spine
  (not an elevator drop), accelerating flipT(N)=max(0.95, 4.4·0.965^N)s, gap shrinks; holes
  3 (N≤8) → 2 (≤20) → 1, relief 2-hole every 7th; die-cut shapes circle/star/heart/egg/
  apple/goat-head (ShapeGeometry + hole paths, polygon verts kept for collision); stand in
  the landed hole or comic pancake (procedural y-squash 0.12 — no clip needed). Score =
  pages survived, best localStorage sb_best; 99 = cheer clip + confetti; dance clip on new
  best. MIRROR RULE (load-bearing): a hole authored at shape (sx,sy) lands at world
  (HINGE_X−sx, −sy) — flip mirrors across the hinge; verify suite asserts vs the real
  rendered transform, not the helper.
- READABILITY: per-hole landing markers = warm-orange soft fill + BOLD ribbon-ring of the
  hole's own polygon (buildOffsetRingGeometry, ±offset triangulated w/ miter correction —
  THREE.Line linewidth is a no-op on Windows ANGLE, never use it), opacity ramps with the
  flip to ≥0.85 + scale pulse in the last 25%. These markers ARE the aiming mechanic.
- PORTRAIT CAMERA LESSON: a 15×11 landscape spread viewed down -Z can only fill ~20% of a
  390×844 portrait screen at ANY pitch/FOV (proved analytically) — rotating the portrait
  camera azimuth onto the book's SHORT axis (CAM_DIR_PORTRAIT (1.0,1.9,0.08)) doubled fill
  to 42% with all corners + flip apex in frame. Desktop uses a separate CAM_DIR_LANDSCAPE.
- MODEL: characterdemo.html loader pattern (GLTFLoader + r128 SkeletonUtils.clone, clips
  from the mesh-less bucky-*.glb by node name, +X-facing GLB → -π/2 yaw wrapper,
  skinning:true on converted materials). BUCKY_H 1.875 (1.25× polish bump), hemisphere
  1.1 + emissive 0.34 so the page's underside never swallows him. Blob shadow (no shadow
  map — headless swiftshader double-renders 48k skinned tris; real GPUs moot but blob is
  cheap + spreads with the pancake).
- HOUSE PATTERNS: G single-state object, host-authoritative-shaped sim fns (hostAdvance/
  beginFlip/onSlamAndJudge/judge/clearPageAndNext) ready for Playroom Stage 3; WebAudio
  synth SFX only (mute sb_muted); drag-anywhere analog stick on coarse pointer; dt-clamp;
  220-particle pool, no hot-loop allocs. Debug hook window.__BOOK__.
- VERIFY: scratchpad storybook_verify.cjs 53/53 ×2 (mirror math, survive+shadow ramp,
  squish→overlay→best→restart, forgiveness margin (center+4 satellites, ≥3 rule), ramp,
  clips incl. cheer via forcePage(99), mobile stick+framing ≥35% fill, perf-stability,
  no-hooks real-timer page-1 survive) + pose_midflip.cjs re-poser. Shots in scratchpad
  shots/sb_*.png. Perf: headless floor ~33-66ms is CPU-skinning the 48k-tri model
  (resolution-independent, proved via quarter-res test) — fine on any real GPU; suite
  gates on frame-time STABILITY not absolute ms.
- Stage 2+ backlog: versus mode (bots/local co-op, shared cast — Billy exists at
  assets/cast/goat/), games.html + PLAY_GAMES tiles, 3D cover-open flourish, art pass
  (barn props/page doodles), difficulty tuning from family playtests, ElevenLabs samples
  (ask before spending credits).
- PORTRAIT REORIENT + DESCENT SHADOW (2026-07-17, user direction from the real MP4 shot):
  spine now along world X at the FAR edge (HINGE_Z -5.5), page flips about rotation.x
  TOWARD the camera — mid-flip it's a readable billboard, and the resting page's die-cuts
  are visible at the top of the screen BEFORE the flip (the "react early" affordance).
  Mirror math re-derived: lateral x NEVER mirrors, depth reflects (hole landing (wx,wz)
  is cut at shape (wx, wz-HINGE_Z)); suite asserts vs the real localToWorld transform.
  DESCENT SHADOW: hole-cutout dark mesh pivoted at the hinge, scale.z = -cos(angle)
  (creeps spine→player, exact landed footprint at π), opacity 0→0.38 over 90°→175° —
  light POOLS through the holes ("stand in the light", diegetic) under the orange rings.
  Page canvas texture prints ~0.12u outline rings around each hole (billboard pop).
  CAMERA LESSON: the 15×11 ground spread caps portrait fill ~20-26% for any symmetric
  camera; full 90° azimuth reads as an unusable diamond — settled 18° yaw (29.7% ground
  fill; the COMPOSITE incoming-page + spread fills the phone screen well, which is what
  matters). Suite now 71 checks ×2 green. Possible future: reshape the spread itself
  portrait (11×15, pages taller than wide like a real book) — would fix fill natively.
- **OVERPASS CROW/PHANTOM-HIT FIX BATCH** (2026-07-17, user playtest: "lakitu grabs you over or
  under the overpass"): FOUR context-free-height bugs at multi-level crossings, all repro'd
  pre-fix then proven clean. (1) rescueTriggered's fell-out-of-the-world check used plain
  sampleHeight(x,z) (XZ-nearest branch — reads the y8 deck under the viaduct) → phantom crow;
  now sampleHeightAtY(x,z,p.y) (genuine falls still fire — a single-branch section resolves the
  only road). (2) advanceTrafficHits was XZ-only → cross-level phantom launches through the
  deck; new TRAFFIC_Y_GATE=2.5 on |q.y − v.y| (q.y NOT q.pos.y — pos has no y; same-level Δy
  <~1.5, deck gap 8). (3) buildTraffic seated vehicles via heightFn(x,z) → a low-road bus
  teleported to deck height (8.01) in the flip band; sampleAtArc now interpolates centerline y
  (branch-correct by construction), v.y exposed in state. (4) buildLaneMarks dashes +
  buildCityscape lamp bases/light pools now seat on their own walk-sample y, not an XZ probe
  (verified heightFn-independent). LESSON: at over/unders, ANY kart-context or
  own-arc-position consumer must use branch-aware/own-sample height; plain sampleHeight is only
  for true context-free callers (camera clamp, mesh, placement). KNOWN pre-existing (K7, out of
  scope): turnpike's perpendicular under-crossing can legitimately mount the deck edge via the
  height-follow at the deck lip. Suites: midnightrun 65/65 (+11 crossing), turnpike 88/88
  (+11), items 24/24, hud PASS. Shot: shots/fk_midnight_crossing_fixed.png.
- STAGE 2 — SQUISH MATCH versus mode (2026-07-17): title = 📖 Story Book (solo, untouched —
  original 71 checks pass with zero assertion edits) · 🥊 Squish Match (player + 3 bots,
  last-standing; MP4 draw rule when all remaining flatten on one page; spectate w/ tap-skip
  when the player is out; sb_wins persisted; sb_mode remembers the pick). CAST from the 2
  Tripo rigs at zero credits: Bucky · Billy (assets/cast/goat/, own 6 clips) · Rosie
  (SkeletonUtils.clone of Bucky, pink tint 0xffd8dc) · Clover (Billy clone, green 0xd8f0d2);
  per-instance material clones; NECKERCHIEF (torus+cone) parented to bone NeckTwist01
  (fallback NeckTwist02→Spine02→Head; both GLBs share the Tripo v1.0 biped skeleton) with
  world-scale compensation — kerchief color = HUD chip color (red/blue/pink/green).
  BOT AI (kid-fair, Farm-Kart philosophy — bots lose by ERRING, never by being slow): same
  speed ±10%, reactionT 0.35-0.9s, pick nearest-ish spawned hole, stand inside w/ ≥0.6u
  separation (holes shareable, authentic); errChanceAt(page)=min(0.5, base+page*0.012) →
  late-react ×2.5 / wobble-between-holes / mid-walk dawdle. No future-reading, no post-slam
  dodges. Measured: good-player proxy won 10/10, resolution pages 11-24 (avg 19.2);
  bots-only baseline avg page 13. HARNESS LESSON: reposition test players on the
  stage→"pause" transition, NOT on G.page change (holes spawn 0.6s later in
  clearPageAndNext — an earlier 0/10 result was the harness's own bug). Suite 114/114
  (71+43) ×6 clean runs; sb_mobile_solo.png preserved, sb_mobile.png = versus retake.
  PERF: 4×48k-tri skinned = ~1.9-2.4× headless frame cost (stable, no leak; swiftshader
  CPU-skinning artifact — real GPUs fine; dt-clamp 0.05s makes heavy headless rAF runs
  under-count sim time — drive hostAdvance directly for match measurements). Stage 3 MP
  notes: G.player needs re-keying by player id (Farm Kart G.players pattern); guest skip
  can't fast-forward a shared sim (host-only or all-tap skip).
- STAGE 3 — PLAYROOM ONLINE MP (2026-07-17, opus agent, verified LIVE vs the real Playroom
  backend): 🌐 Family Match title button — host creates room (SDK playroomkit@0.0.96 UMD,
  LAZY-loaded only when picked; #r= hash parsed+CLEARED before insertCoin, roomCode explicit
  per the Bistro caution), waiting room ON the book (hop-in + share link + copy + host-only
  START; "empty spots become friendly goats"), guests auto-join via #r= link. Up to 4 humans,
  join order = Bucky/Billy/Rosie/Clover, bots fill leftover seats. G REKEYED: G.player+G.bots
  → G.players map ('local' / 'r_<pid>' / bot ids keyed by char); one unified
  renderCharacters/charViews path (any char renders as local/remote/bot). WIRE: host snap
  ~12Hz+events {stage,page,matchGen,flipDur,flipElapsed,holeGen,seats,players-by-CHAR,result
  w/ winnerChar = perspective-neutral}; holes sent ONCE per page keyed holeGen (guest rebuilds
  polys via unitPoly); guest publishes only own x,z,facing,moving ~18Hz (host adopts for
  judgment); guests extrapolate flipAngle from the host's π·t^1.7 curve between snaps; remote
  interp ~120ms exp-lerp, snap >6u. Hidden-host 250ms heartbeat sub-stepped ≤0.05s. Host quit
  = 5s stale-heartbeat → "the book closed!" → title; guest quit = poof + "(left)" chip, no
  mid-match bot replacement; MP disables the local skipSpectate fast-forward; host-only Play
  Again. CDN/insertCoin failure → toast + local-versus fallback (never blank). VERIFIED ×2:
  114/114 local regression (Playroom blocked; suite edits = 8 mechanical G.players renames
  only), sb_mp_local.cjs 10/10 (lazy-load proven: zero playroom requests in solo/versus;
  blocked-CDN fallback), sb_mp_live.cjs 36/36 — TWO real Chrome processes on the REAL
  backend: join, cast assign, guest-move adoption Δ0.000, cross-screen elimination,
  perspective-correct win overlays ("You win" vs "Bucky wins!"), Play Again both, both
  disconnect directions. 0 pageerrors all processes. Shots sb_mp_waiting/sb_mp_match.png.
  KNOWN: late-joiner "hang tight" path implemented but not live-asserted; waiting-room chip
  says "Player (you)" vs in-match "Bucky (you)" (label nit); client-authoritative guest
  position (family-app posture). STAGE 4 spec'd in the Stage-3 report: Firestore
  lobbies_<familyKey>/sb_<roomCode> doc (game:"storybook", ico 📖, 15s heartbeat) +
  games.html LOBBY_TEXT entry + tiles → then go-live push (user approval required).

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


# 💪 FITNESS — the kids' daily 10-minute workout (2026-08-02)

A new `fitness` section in `index.html` (~1,370 lines) plus a baked exercise library in
`assets/fitness/`. Isaac and Eleanor open it, tap Start, and are walked through ~9 exercises
grouped into labelled muscle blocks, each with a target and a picture of the movement, resting
between. Dad builds the week behind the PIN. Nearest precedent throughout is the Meals section.

**USER DECISIONS** (asked up front, all four load-bearing): blocks *inside* each day (full-body,
Core → Chest → Legs) rather than a weekday split · library scoped to **bodyweight + dumbbells +
bands** · **Dad-only PIN gate** on editing · a section in the main app, not its own page.

## The source data is NOT animated — and that shaped the design
`free-exercise-db` (873 exercises, **Unlicense / public domain**) ships **exactly two static
JPEGs per exercise**: the start position and the end position. There are no animations in it to
pull. The player cross-fades frame 0 ↔ frame 1 on a 900 ms loop, which is what actually reads as
the movement (Plank: kneel → plank). Verified all 873 carry exactly 2 frames, so this is uniform.
Class-toggle + CSS transition, deliberately **not** `@keyframes` — those stall under headless
Chrome (the Bistro lesson). True video would be a different, paid source.

## The bake — `node tools/_fit_build_library.mjs [--force|--dry]`
Downloads, filters, downscales, writes `assets/fitness/`. Idempotent (skips images on disk), and
**validates the default week against the baked library before writing** — a typo fails the bake
instead of shipping a broken Monday.
- **311 exercises, 622 images, 9.8 MB.** Never downloaded wholesale by a user: images are
  per-exercise and `loading="lazy"`, so a day's workout costs ~18 files.
- **WebP 600px q72** — measured against the real photos: same total bytes as JPEG/480/q76 but 25%
  more resolution. (`sharp` WORKS in this environment; the repo's "sharp is broken, use
  System.Drawing" note is stale.)
- `equipment: null` on 76 non-expert entries does **not** mean "unknown" — they are all
  genuinely no-equipment (Mountain Climbers, walking lunges, the whole stretch catalogue).
  Normalised to `"none"` and KEPT; the stretches are what a warm-up/cool-down block is built from.
  Filtering them out silently (the obvious first pass) loses staples.
- Exclusion list: both neck isometrics + the loaded-spine moves (Good Mornings, Dumbbell Clean,
  Stiff-Legged Deadlift, Hyperextensions, neck stretches) — a physio's call for unsupervised kids.
- 8 muscle groups. **The Back group's icon is 🧗, NOT 🔙** — that emoji renders as a literal
  "BACK" arrow and reads as navigation next to the picker's own "← Back" button (caught in review).

## Data model
- **Plan** = ONE shared week, settings doc `fitPlan`; `assets/fitness/default-plan.json` is the
  fallback until Dad edits. Merely viewing never writes (mealplan rule). Shape takes a per-kid key
  later without a migration.
- **Log** = per kid, month-sharded `fitLog_<Kid>_<YYYY-MM>`, 400 ms debounced. Per-day snapshots
  are the whole point: chores overwrite `doneLog` in place and keep **no history**, which is
  exactly why the old `choreStreak` needed a fragile localStorage counter and got deleted.
- **Streak is DERIVED** by walking backwards (the `mealStreak` pattern) — stateless, cloud-synced,
  same on every device. **Rest days are stepped over: never counted, never a break.** One-day
  grace so an unfinished morning doesn't read as zero. Stops honestly at an unloaded month
  (under-reports rather than inventing days).
- Day keys are the Plan-area scheme (America/Chicago, UTC-noon anchored, `fitNowOverride` test
  clock) — NOT `dateKeyLocal`. Two kids logging from two devices into one cloud doc would
  otherwise disagree about which day "today" is.

## The player
Flat step list — `block card → exercise → rest → … → finish`. **Timing reads the wall clock**,
never accumulated ticks, so a slow frame can't turn a 40-second plank into 44. A hidden tab
**PAUSES rather than fast-forwarding** — coming back to three auto-completed exercises would be a
lie about what the kid did. Quitting part-way keeps the progress but does not mark the day done
("Keep going"). Timed sets auto-advance; rep sets wait for a tap. WebAudio synth cues (3-2-1 /
go / rest / fanfare, `bucky_fit_muted`), `navigator.wakeLock`, `prefers-reduced-motion` holds
frame 0 behind a "Show movement" tap.

## Budget
`fitDuration()` is the single source of truth for both the builder's meter and the player: time
sets count their seconds, rep sets estimate `max(20, reps × 3)`, plus rest between and 5 s per
block card. Default week measures **9:16–9:51, average 9:35** (band 9:00–11:00; the meter goes
amber outside it). Rep estimates are deliberately conservative, so real elapsed runs a touch longer.

## Builder + picker (Dad only)
Edits run against a **draft deep-copy**, so Cancel really cancels. `gateDad()` always prompts, so
the call site short-circuits on `dadUnlocked()` first. Non-Dad profiles get the same sheet
read-only and are never asked for a PIN. Picker shares the one sheet overlay (swap contents +
Back) rather than stacking — a sheet on a sheet on a phone is a scroll trap. Exercises are
**grouped under muscle-group headers** with search + equipment filter. A new exercise defaults to
a timed set when the library marks it `force:"static"` or a stretch, else reps — read from the
data, not guessed per name.

## Nav
**9 bottom-nav areas now** (Home · Plan · Chores · **Fit** · Jobs · Shop · Bank · Farm · Play) —
measured at 390 px: 0 clipped labels. The section is visible to everyone (Mom/Dad build it); only
the Home card is gated on `FITNESS_USERS = ["Isaac","Eleanor"]`.

## VERIFY: `node tools/_verify-fitness.cjs [--shots]` — **113/113, 0 page errors**
Section A is pure Node (library/plan integrity, all 622 images present and non-empty, no excluded
exercise shipped, every day in band — recomputed independently rather than asking the app to grade
its own homework). B–F drive real Chrome at 390×844 + desktop. **Firebase is blocked throughout**
(`googleapis|firestore|firebase|gstatic`) — an unblocked headless run against index.html has twice
duplicated the live goat herd, and this suite exercises first-run paths.
**THREE TEST GOTCHAS worth keeping:** (1) pages in a SHARED browser context share localStorage, so
a "fresh" page inherits the previous section's saved plan and completion log — every page gets its
own `createBrowserContext()`. (2) The test clock does **not** survive a reload; re-pin before
asserting on the day you edited. (3) `pinWorkoutDay()` exists because the suite otherwise tests
whatever day it happens to run on — a Sunday run hits the rest day and reads as a pile of bugs
(this produced 5 false failures on the first pass before the real ones showed).
Shots: `shots/fit_{today,week,progress,player,rest,finish,builder,picker,home_card,desktop}.png`.

**UNPUSHED** — awaiting user preview (`main` auto-deploys). Deferred: push reminders (would clone
`chorereminders.mjs` with its own allowlist), separate plans per kid, spoken exercise names,
rep-count progression.

## FITNESS follow-up — per-kid plans + phone preview (2026-08-02, same day)

**📱 `node tools/phone-preview.mjs [fitness|<page>] [--port N]`** — serves the repo on
**0.0.0.0** so the REAL phone loads it over wifi, and prints the LAN URL. Distinct from
`mobile-preview.mjs`, which only opens a phone-SIZED desktop Chrome on this machine. A bare
word argument is treated as an in-app tab and deep-links it (`index.html#fitness`), which
matters on a phone where hunting for a tab is the whole friction. `no-store` on everything
(a stale phone cache costs more than it saves) and, on Windows, prints the one-time
`netsh advfirewall` rule — the firewall silently dropping inbound is the likely failure.
DELIBERATELY NO QR CODE: no QR dep is installed, and a hand-rolled encoder can't be verified
to actually scan from here — a wrong QR is worse than typing 18 characters.

**👧🧒 PER-KID PLANS.** `fitPlan` is still the shared family plan (unchanged doc id, so
existing saves keep working); `fitPlan_<Kid>` is an optional override. A kid with no override
follows the shared plan, so the common case stays ONE plan to maintain and Dad forks a kid off
it only when they actually need something different.
- `fitPlanOf(who)` / `fitHasOwnPlan(who)` / `fitWhose()` are the whole contract. **`fitWhose()`
  returns a kid's OWN name always** — a kid can never be pointed at a sibling's plan, and the
  selector is not rendered for them.
- **TOMBSTONES:** neither settings backend has a delete and `setSetting` MERGES, so "put this
  kid back on the shared plan" writes `{none:true}` rather than removing the doc. `fitHasOwnPlan`
  is the single place that knows this. Suite asserts the revert survives a reload — a naive
  delete would silently restore the override.
- Everything that reasons about rest days is now per-kid: `fitStreak(kid)` uses
  `fitDayOf(key, kid)`, Week ticks skip a kid whose own plan rests that day, Progress grids
  read each kid's plan. Isaac resting while Eleanor works is a legal, handled state.
- `fitDuration(day, who)` and `fitBuildSteps(day, who)` take the owner because `rest` lives on
  the plan.
- UI: a **"Plan for: Everyone / Isaac / Eleanor"** selector (parents only), a banner stating
  shared-vs-own with a one-tap fork/revert (PIN-gated), and the builder carries a `.fitscope`
  line naming the plan the save will land on. Silence there is exactly how you change
  everyone's Monday meaning to change one kid's — so it is always stated.
- The Home card always reads the kid's OWN plan (`fitDayOf(key, kid)`), never the viewer's.

**Suite: `_verify-fitness.cjs` 113 → 141 checks**, new section E2 (fork isolation both
directions, persistence, reload, tombstoned revert, kid immunity to the selector).
**TEST GOTCHA (4th of the set):** `dataset` is a `DOMStringMap` and does NOT survive
puppeteer's structured clone — it arrives as `{}`. Read `el.dataset.foo` as a STRING inside
`evaluate`, never return the map. Cost two false failures.
Shot: `shots/fit_perkid.png`.

## FITNESS follow-up 2 — the big looping demo (2026-08-02, same day)

User: *"when a kid selects an exercise to do it should show a large version of the animation
on loop so they can see exactly how to do it."* New full-screen demo overlay `#fitDemoOverlay`
(`fitOpenDemo/fitCloseDemo/fitDemoToggleFreeze`) — **z-index 70, above the player's 60**, so
form can be checked mid-set without ending the workout.

**THREE ENTRY POINTS**, all the same component: every exercise row in Today/Week is now a real
`<button class="fitrow tap">` with a 🔍 affordance and a "Show me how" aria-label · the
player's own picture is tappable (`.fitp-anim.tappable` + a "tap for a closer look" hint) ·
the picker's THUMBNAIL previews while the rest of the row still adds. That last one forced a
markup change: a button inside a button is invalid and keyboard-unreachable, so a picker entry
is now `.fitpick-row` wrapping a `.fitpick-look` button and the original `.fitpick-item` button
(`data-group` moved onto the ROW, since the suite's grouping check walks `#fitPickList > *`).

**MID-WORKOUT IT PAUSES AND RESUMES.** Opening the demo from a running workout calls
`fitTogglePause()` and latches `fitDemoResume`; closing un-pauses. The button reads "Got it —
keep going". Measured: **0ms drift over 900ms** with the demo open, and the remaining time is
intact after resuming (45s → 45s). A kid asking "how do I do this?" costs nothing.

**LAYOUT — the box hugs the photo, it does not letterbox it.** First cut gave the animation
`flex:1` and got a 362×530 container holding a 362×241 photo: huge white bands, and the picture
no bigger for it. Frames are NOT a uniform aspect (measured: 111/120 are 3:2, but **6 are
portrait 2:3** plus a couple of odd ones), so a fixed `aspect-ratio` would have letterboxed the
portrait ones instead. Fix: frame 0 is a normal block `<img>` (`max-width:100%; max-height:52vh`)
that DEFINES the box; frame 1 is absolutely positioned on top. Full-bleed via
`width:calc(100% + 28px); margin:0 -14px`. Result 390×260 on a 390px screen — **0% dead space,
51× the list thumbnail's area**. `.fitdemo-act { margin-top:auto }` parks the button at the
bottom where a thumb reaches it.

Tap the picture to FREEZE on a frame (`.frozen` kills the transition) for "hold on, what are the
arms doing?" — badge toggles "Tap to pause"/"Tap to play". `prefers-reduced-motion` opens frozen
with "Tap to play". The demo runs its OWN flip interval, independent of the player's (which is
correctly stopped while paused).

**Suite 141 → 169.** New section C2. **TEST LESSON:** the first version used `__FIT__.warp()` to
fake elapsed time while paused and "found" two bugs that did not exist — warp rewinds
`stepStart`, which is precisely what pause accounting is designed to ignore, so it was testing
the harness. Rewritten to wait REAL wall time (900ms) and assert the countdown is frozen.
Also: measure the rendered `img`, never its container — a container larger than the photo is
dead letterbox space and must not count as "large" (that assertion is what caught the
letterboxing). Shot: `shots/fit_demo.png`.

## FITNESS follow-up 3 — the kids' real plans, as circuits (2026-08-02, same day)

Dad supplied Isaac's and Eleanor's actual programmes (5 exercises × 5 days; Eleanor's is
the volleyball cut, Isaac's the general-strength one). **All 25 named exercises already
existed in the baked library — zero substitutions.** They ship as
`assets/fitness/plan-{isaac,eleanor}.json`, validated at bake time like default-plan.json.

**PER-KID DEFAULTS.** `fitEnsurePlan(who)` now falls back to `plan-<kid>.json` when no
`fitPlan_<Kid>` override doc exists, so both kids arrive on their own programme with no
setup. Precedence: **override doc > baked per-kid plan > shared plan**. The `{none:true}`
tombstone suppresses BOTH the doc and the baked file, so "use the shared plan" still means
what it says.

**THREE ADDITIONS TO THE ITEM SHAPE**, all driven by what Dad actually wrote:
- `side` ("per leg", "per arm", "each way") — the number is PER SIDE. Displays as `×8 ea`
  and **doubles the time estimate**: eight per leg is sixteen reps of work, and counting
  eight would under-read every single-leg day by half.
- `note` — his ranges and swaps ("10–12 reps", "bodyweight lunges are fine", "hold 1–2 sec
  at the top"), shown under the exercise name in place of the equipment line.
- block `label` + `focus` — days carry their own names ("Legs & Jump Power") instead of a
  generic muscle label. The Today chip is suppressed when a lone block just repeats the
  day title.

**CIRCUITS (`day.rounds`).** Dad: *"each exercise gets done twice, but in a circuit, so if
there are 5 exercises then that's 10 total sets with rests between them."* `fitBuildSteps`
runs the whole list `rounds` times with a rest between EVERY set including across the round
boundary — 5 exercises × 2 rounds = 10 sets, 9 rests. A round card ("Round 2 of 2")
replaces the per-block cards when rounds > 1 (carding both interrupts the circuit twice);
it auto-advances on the same short timer the block card always used. Builder gets a
Rounds 1/2/3 control.

**THE ARITHMETIC, because the first two answers were wrong.** Plans as written: 4:24/day.
Raising rest 20s → 30s only reached 5:04 — **five exercises is four gaps, so +10s each buys
40 seconds**; the shortfall was never in the rests, it was ~3 minutes of actual work.
Running the list twice is what fixed it: **10:52 · 9:44 · 11:08 · 9:56 · 11:28** (avg 10:33).

**BUG THE CIRCUIT EXPOSED — progress was counted as DISTINCT EXERCISE IDS.** In a circuit the
same movement comes round again, so round two credited nothing: the bar would have stalled at
50% and the finish screen would have read "5 exercises" after ten sets. Now `setsDone` /
`setsSkipped` count sets (player, progress bar, finish screen, `rec.sets`) while the id
arrays stay unique — "which exercises did you do" is the useful question in the LOG, "how
many sets" is the useful question DURING. Suite asserts both.

**Suite 169 → 230.** New E3 (both plan files: 5 days Mon–Fri, weekend off, named blocks,
per-side marks, notes preserved, Eleanor's focus lines; per-side doubling for reps AND
timed holds; the circuit's step shape; a full 10-set walk reaching 100%). Restaged, with
reasons: E2 assumed kids START on the shared plan — the premise this change reverses — so it
now unforks Isaac first and asserts isolation as "Eleanor is UNAFFECTED" rather than "Eleanor
follows the shared plan"; section C's "opens on a block card" became "opens on an intro card"
(a circuit opens on a round card). **TEST GOTCHA:** `__FIT__.start()` is async — calling
`steps()` straight after returns null.

## FITNESS follow-up 4 — a stale fork shadowed the shipped plans (2026-08-02)

User, twice: *"I don't see the new set of exercises"* / *"I logged in from kid profile and
they still have the old 9 exercises."* **The deploy was fine; the cause was data.**

At 23:35 and 23:36 Dad had tapped "Give Isaac their own plan" / "Give Eleanor their own
plan" while looking at the FIRST fitness deploy. That forked a copy of the generic
9-exercise shared week into `settings_<fam>/fitPlan_Isaac` and `_Eleanor`. Precedence is
**override doc > baked plan > shared**, so those forks shadowed the real programmes for
both kids on every device.

TWO DESIGN FAULTS, both fixed:
1. **A parent landed on the shared week by default.** `fitWhose()` returned the selector's
   value, which defaulted to `""`. Once both kids are forked the shared week is the plan
   NOBODY does — so Dad opened Fitness, saw the old generic exercises, and reasonably
   concluded the deploy had failed. `fitPlanView` is now `null` until explicitly chosen and
   `fitViewNow()` resolves that to the first kid who HAS a plan. Choosing "Everyone" still
   works and now states who is actually on it ("Isaac and Eleanor are both on their own
   plans, so nobody is doing this one").
2. **There was no way back to a shipped plan.** The revert wrote a `{none:true}` tombstone
   which suppresses the baked file too, so "use the shared plan" was the only exit and it
   led somewhere wrong. `fitEnsureBaked` now loads `plan-<kid>.json` ALONGSIDE any override,
   and when they differ the banner offers **"Reset to <Kid>'s programme"** (PIN-gated,
   confirm-gated).

DATA FIX (user-approved, both docs backed up to the session scratchpad first): the two
override docs were OVERWRITTEN with the real plans via the Firestore REST API rather than
deleted — a replace keeps Dad's future edits working exactly as before, and an empty doc is
a state the app had never run against on live data. Read back and verified: 5 exercises ×
2 rounds = 10 sets, 30s rest, correct titles, Sat/Sun rest.
GOTCHA: Firestore REST needs `integerValue` for whole numbers — send `rounds` as a double
and `rounds === 2` stops being true in the app. And PATCH was given an explicit
`updateMask.fieldPaths` covering every field so no stale key survived the replace.

**Suite 230 → 233.** New: an undecided parent lands on a kid's real plan (not the unused
shared week), and "Everyone" still selectable and self-describing.
**TEST GOTCHA that cost the most time here:** `page.click()` scrolls only minimally, so a
control at the page bottom can be left under the fixed `#bnav` and the click lands on the
nav instead — silently, with no error. Symptom was "the builder never opens" with zero page
errors and zero unhandled rejections. New `tap(page, sel)` helper scrolls it to centre
first, the way a thumb would. Also restaged: the persistence check asserted
`setting_fitPlan`, but a save now lands on `setting_fitPlan_<Kid>` since Dad defaults to a
kid's view.


# 💪 FITNESS — the kids' daily 10-minute workout (2026-08-02)

A new `fitness` section in `index.html` (~1,370 lines) plus a baked exercise library in
`assets/fitness/`. Isaac and Eleanor open it, tap Start, and are walked through ~9 exercises
grouped into labelled muscle blocks, each with a target and a picture of the movement, resting
between. Dad builds the week behind the PIN. Nearest precedent throughout is the Meals section.

**USER DECISIONS** (asked up front, all four load-bearing): blocks *inside* each day (full-body,
Core → Chest → Legs) rather than a weekday split · library scoped to **bodyweight + dumbbells +
bands** · **Dad-only PIN gate** on editing · a section in the main app, not its own page.

## The source data is NOT animated — and that shaped the design
`free-exercise-db` (873 exercises, **Unlicense / public domain**) ships **exactly two static
JPEGs per exercise**: the start position and the end position. There are no animations in it to
pull. The player cross-fades frame 0 ↔ frame 1 on a 900 ms loop, which is what actually reads as
the movement (Plank: kneel → plank). Verified all 873 carry exactly 2 frames, so this is uniform.
Class-toggle + CSS transition, deliberately **not** `@keyframes` — those stall under headless
Chrome (the Bistro lesson). True video would be a different, paid source.

## The bake — `node tools/_fit_build_library.mjs [--force|--dry]`
Downloads, filters, downscales, writes `assets/fitness/`. Idempotent (skips images on disk), and
**validates the default week against the baked library before writing** — a typo fails the bake
instead of shipping a broken Monday.
- **311 exercises, 622 images, 9.8 MB.** Never downloaded wholesale by a user: images are
  per-exercise and `loading="lazy"`, so a day's workout costs ~18 files.
- **WebP 600px q72** — measured against the real photos: same total bytes as JPEG/480/q76 but 25%
  more resolution. (`sharp` WORKS in this environment; the repo's "sharp is broken, use
  System.Drawing" note is stale.)
- `equipment: null` on 76 non-expert entries does **not** mean "unknown" — they are all
  genuinely no-equipment (Mountain Climbers, walking lunges, the whole stretch catalogue).
  Normalised to `"none"` and KEPT; the stretches are what a warm-up/cool-down block is built from.
  Filtering them out silently (the obvious first pass) loses staples.
- Exclusion list: both neck isometrics + the loaded-spine moves (Good Mornings, Dumbbell Clean,
  Stiff-Legged Deadlift, Hyperextensions, neck stretches) — a physio's call for unsupervised kids.
- 8 muscle groups. **The Back group's icon is 🧗, NOT 🔙** — that emoji renders as a literal
  "BACK" arrow and reads as navigation next to the picker's own "← Back" button (caught in review).

## Data model
- **Plan** = ONE shared week, settings doc `fitPlan`; `assets/fitness/default-plan.json` is the
  fallback until Dad edits. Merely viewing never writes (mealplan rule). Shape takes a per-kid key
  later without a migration.
- **Log** = per kid, month-sharded `fitLog_<Kid>_<YYYY-MM>`, 400 ms debounced. Per-day snapshots
  are the whole point: chores overwrite `doneLog` in place and keep **no history**, which is
  exactly why the old `choreStreak` needed a fragile localStorage counter and got deleted.
- **Streak is DERIVED** by walking backwards (the `mealStreak` pattern) — stateless, cloud-synced,
  same on every device. **Rest days are stepped over: never counted, never a break.** One-day
  grace so an unfinished morning doesn't read as zero. Stops honestly at an unloaded month
  (under-reports rather than inventing days).
- Day keys are the Plan-area scheme (America/Chicago, UTC-noon anchored, `fitNowOverride` test
  clock) — NOT `dateKeyLocal`. Two kids logging from two devices into one cloud doc would
  otherwise disagree about which day "today" is.

## The player
Flat step list — `block card → exercise → rest → … → finish`. **Timing reads the wall clock**,
never accumulated ticks, so a slow frame can't turn a 40-second plank into 44. A hidden tab
**PAUSES rather than fast-forwarding** — coming back to three auto-completed exercises would be a
lie about what the kid did. Quitting part-way keeps the progress but does not mark the day done
("Keep going"). Timed sets auto-advance; rep sets wait for a tap. WebAudio synth cues (3-2-1 /
go / rest / fanfare, `bucky_fit_muted`), `navigator.wakeLock`, `prefers-reduced-motion` holds
frame 0 behind a "Show movement" tap.

## Budget
`fitDuration()` is the single source of truth for both the builder's meter and the player: time
sets count their seconds, rep sets estimate `max(20, reps × 3)`, plus rest between and 5 s per
block card. Default week measures **9:16–9:51, average 9:35** (band 9:00–11:00; the meter goes
amber outside it). Rep estimates are deliberately conservative, so real elapsed runs a touch longer.

## Builder + picker (Dad only)
Edits run against a **draft deep-copy**, so Cancel really cancels. `gateDad()` always prompts, so
the call site short-circuits on `dadUnlocked()` first. Non-Dad profiles get the same sheet
read-only and are never asked for a PIN. Picker shares the one sheet overlay (swap contents +
Back) rather than stacking — a sheet on a sheet on a phone is a scroll trap. Exercises are
**grouped under muscle-group headers** with search + equipment filter. A new exercise defaults to
a timed set when the library marks it `force:"static"` or a stretch, else reps — read from the
data, not guessed per name.

## Nav
**9 bottom-nav areas now** (Home · Plan · Chores · **Fit** · Jobs · Shop · Bank · Farm · Play) —
measured at 390 px: 0 clipped labels. The section is visible to everyone (Mom/Dad build it); only
the Home card is gated on `FITNESS_USERS = ["Isaac","Eleanor"]`.

## VERIFY: `node tools/_verify-fitness.cjs [--shots]` — **113/113, 0 page errors**
Section A is pure Node (library/plan integrity, all 622 images present and non-empty, no excluded
exercise shipped, every day in band — recomputed independently rather than asking the app to grade
its own homework). B–F drive real Chrome at 390×844 + desktop. **Firebase is blocked throughout**
(`googleapis|firestore|firebase|gstatic`) — an unblocked headless run against index.html has twice
duplicated the live goat herd, and this suite exercises first-run paths.
**THREE TEST GOTCHAS worth keeping:** (1) pages in a SHARED browser context share localStorage, so
a "fresh" page inherits the previous section's saved plan and completion log — every page gets its
own `createBrowserContext()`. (2) The test clock does **not** survive a reload; re-pin before
asserting on the day you edited. (3) `pinWorkoutDay()` exists because the suite otherwise tests
whatever day it happens to run on — a Sunday run hits the rest day and reads as a pile of bugs
(this produced 5 false failures on the first pass before the real ones showed).
Shots: `shots/fit_{today,week,progress,player,rest,finish,builder,picker,home_card,desktop}.png`.

**UNPUSHED** — awaiting user preview (`main` auto-deploys). Deferred: push reminders (would clone
`chorereminders.mjs` with its own allowlist), separate plans per kid, spoken exercise names,
rep-count progression.

## FITNESS follow-up — per-kid plans + phone preview (2026-08-02, same day)

**📱 `node tools/phone-preview.mjs [fitness|<page>] [--port N]`** — serves the repo on
**0.0.0.0** so the REAL phone loads it over wifi, and prints the LAN URL. Distinct from
`mobile-preview.mjs`, which only opens a phone-SIZED desktop Chrome on this machine. A bare
word argument is treated as an in-app tab and deep-links it (`index.html#fitness`), which
matters on a phone where hunting for a tab is the whole friction. `no-store` on everything
(a stale phone cache costs more than it saves) and, on Windows, prints the one-time
`netsh advfirewall` rule — the firewall silently dropping inbound is the likely failure.
DELIBERATELY NO QR CODE: no QR dep is installed, and a hand-rolled encoder can't be verified
to actually scan from here — a wrong QR is worse than typing 18 characters.

**👧🧒 PER-KID PLANS.** `fitPlan` is still the shared family plan (unchanged doc id, so
existing saves keep working); `fitPlan_<Kid>` is an optional override. A kid with no override
follows the shared plan, so the common case stays ONE plan to maintain and Dad forks a kid off
it only when they actually need something different.
- `fitPlanOf(who)` / `fitHasOwnPlan(who)` / `fitWhose()` are the whole contract. **`fitWhose()`
  returns a kid's OWN name always** — a kid can never be pointed at a sibling's plan, and the
  selector is not rendered for them.
- **TOMBSTONES:** neither settings backend has a delete and `setSetting` MERGES, so "put this
  kid back on the shared plan" writes `{none:true}` rather than removing the doc. `fitHasOwnPlan`
  is the single place that knows this. Suite asserts the revert survives a reload — a naive
  delete would silently restore the override.
- Everything that reasons about rest days is now per-kid: `fitStreak(kid)` uses
  `fitDayOf(key, kid)`, Week ticks skip a kid whose own plan rests that day, Progress grids
  read each kid's plan. Isaac resting while Eleanor works is a legal, handled state.
- `fitDuration(day, who)` and `fitBuildSteps(day, who)` take the owner because `rest` lives on
  the plan.
- UI: a **"Plan for: Everyone / Isaac / Eleanor"** selector (parents only), a banner stating
  shared-vs-own with a one-tap fork/revert (PIN-gated), and the builder carries a `.fitscope`
  line naming the plan the save will land on. Silence there is exactly how you change
  everyone's Monday meaning to change one kid's — so it is always stated.
- The Home card always reads the kid's OWN plan (`fitDayOf(key, kid)`), never the viewer's.

**Suite: `_verify-fitness.cjs` 113 → 141 checks**, new section E2 (fork isolation both
directions, persistence, reload, tombstoned revert, kid immunity to the selector).
**TEST GOTCHA (4th of the set):** `dataset` is a `DOMStringMap` and does NOT survive
puppeteer's structured clone — it arrives as `{}`. Read `el.dataset.foo` as a STRING inside
`evaluate`, never return the map. Cost two false failures.
Shot: `shots/fit_perkid.png`.

## FITNESS follow-up 2 — the big looping demo (2026-08-02, same day)

User: *"when a kid selects an exercise to do it should show a large version of the animation
on loop so they can see exactly how to do it."* New full-screen demo overlay `#fitDemoOverlay`
(`fitOpenDemo/fitCloseDemo/fitDemoToggleFreeze`) — **z-index 70, above the player's 60**, so
form can be checked mid-set without ending the workout.

**THREE ENTRY POINTS**, all the same component: every exercise row in Today/Week is now a real
`<button class="fitrow tap">` with a 🔍 affordance and a "Show me how" aria-label · the
player's own picture is tappable (`.fitp-anim.tappable` + a "tap for a closer look" hint) ·
the picker's THUMBNAIL previews while the rest of the row still adds. That last one forced a
markup change: a button inside a button is invalid and keyboard-unreachable, so a picker entry
is now `.fitpick-row` wrapping a `.fitpick-look` button and the original `.fitpick-item` button
(`data-group` moved onto the ROW, since the suite's grouping check walks `#fitPickList > *`).

**MID-WORKOUT IT PAUSES AND RESUMES.** Opening the demo from a running workout calls
`fitTogglePause()` and latches `fitDemoResume`; closing un-pauses. The button reads "Got it —
keep going". Measured: **0ms drift over 900ms** with the demo open, and the remaining time is
intact after resuming (45s → 45s). A kid asking "how do I do this?" costs nothing.

**LAYOUT — the box hugs the photo, it does not letterbox it.** First cut gave the animation
`flex:1` and got a 362×530 container holding a 362×241 photo: huge white bands, and the picture
no bigger for it. Frames are NOT a uniform aspect (measured: 111/120 are 3:2, but **6 are
portrait 2:3** plus a couple of odd ones), so a fixed `aspect-ratio` would have letterboxed the
portrait ones instead. Fix: frame 0 is a normal block `<img>` (`max-width:100%; max-height:52vh`)
that DEFINES the box; frame 1 is absolutely positioned on top. Full-bleed via
`width:calc(100% + 28px); margin:0 -14px`. Result 390×260 on a 390px screen — **0% dead space,
51× the list thumbnail's area**. `.fitdemo-act { margin-top:auto }` parks the button at the
bottom where a thumb reaches it.

Tap the picture to FREEZE on a frame (`.frozen` kills the transition) for "hold on, what are the
arms doing?" — badge toggles "Tap to pause"/"Tap to play". `prefers-reduced-motion` opens frozen
with "Tap to play". The demo runs its OWN flip interval, independent of the player's (which is
correctly stopped while paused).

**Suite 141 → 169.** New section C2. **TEST LESSON:** the first version used `__FIT__.warp()` to
fake elapsed time while paused and "found" two bugs that did not exist — warp rewinds
`stepStart`, which is precisely what pause accounting is designed to ignore, so it was testing
the harness. Rewritten to wait REAL wall time (900ms) and assert the countdown is frozen.
Also: measure the rendered `img`, never its container — a container larger than the photo is
dead letterbox space and must not count as "large" (that assertion is what caught the
letterboxing). Shot: `shots/fit_demo.png`.

## FITNESS follow-up 3 — the kids' real plans, as circuits (2026-08-02, same day)

Dad supplied Isaac's and Eleanor's actual programmes (5 exercises × 5 days; Eleanor's is
the volleyball cut, Isaac's the general-strength one). **All 25 named exercises already
existed in the baked library — zero substitutions.** They ship as
`assets/fitness/plan-{isaac,eleanor}.json`, validated at bake time like default-plan.json.

**PER-KID DEFAULTS.** `fitEnsurePlan(who)` now falls back to `plan-<kid>.json` when no
`fitPlan_<Kid>` override doc exists, so both kids arrive on their own programme with no
setup. Precedence: **override doc > baked per-kid plan > shared plan**. The `{none:true}`
tombstone suppresses BOTH the doc and the baked file, so "use the shared plan" still means
what it says.

**THREE ADDITIONS TO THE ITEM SHAPE**, all driven by what Dad actually wrote:
- `side` ("per leg", "per arm", "each way") — the number is PER SIDE. Displays as `×8 ea`
  and **doubles the time estimate**: eight per leg is sixteen reps of work, and counting
  eight would under-read every single-leg day by half.
- `note` — his ranges and swaps ("10–12 reps", "bodyweight lunges are fine", "hold 1–2 sec
  at the top"), shown under the exercise name in place of the equipment line.
- block `label` + `focus` — days carry their own names ("Legs & Jump Power") instead of a
  generic muscle label. The Today chip is suppressed when a lone block just repeats the
  day title.

**CIRCUITS (`day.rounds`).** Dad: *"each exercise gets done twice, but in a circuit, so if
there are 5 exercises then that's 10 total sets with rests between them."* `fitBuildSteps`
runs the whole list `rounds` times with a rest between EVERY set including across the round
boundary — 5 exercises × 2 rounds = 10 sets, 9 rests. A round card ("Round 2 of 2")
replaces the per-block cards when rounds > 1 (carding both interrupts the circuit twice);
it auto-advances on the same short timer the block card always used. Builder gets a
Rounds 1/2/3 control.

**THE ARITHMETIC, because the first two answers were wrong.** Plans as written: 4:24/day.
Raising rest 20s → 30s only reached 5:04 — **five exercises is four gaps, so +10s each buys
40 seconds**; the shortfall was never in the rests, it was ~3 minutes of actual work.
Running the list twice is what fixed it: **10:52 · 9:44 · 11:08 · 9:56 · 11:28** (avg 10:33).

**BUG THE CIRCUIT EXPOSED — progress was counted as DISTINCT EXERCISE IDS.** In a circuit the
same movement comes round again, so round two credited nothing: the bar would have stalled at
50% and the finish screen would have read "5 exercises" after ten sets. Now `setsDone` /
`setsSkipped` count sets (player, progress bar, finish screen, `rec.sets`) while the id
arrays stay unique — "which exercises did you do" is the useful question in the LOG, "how
many sets" is the useful question DURING. Suite asserts both.

**Suite 169 → 230.** New E3 (both plan files: 5 days Mon–Fri, weekend off, named blocks,
per-side marks, notes preserved, Eleanor's focus lines; per-side doubling for reps AND
timed holds; the circuit's step shape; a full 10-set walk reaching 100%). Restaged, with
reasons: E2 assumed kids START on the shared plan — the premise this change reverses — so it
now unforks Isaac first and asserts isolation as "Eleanor is UNAFFECTED" rather than "Eleanor
follows the shared plan"; section C's "opens on a block card" became "opens on an intro card"
(a circuit opens on a round card). **TEST GOTCHA:** `__FIT__.start()` is async — calling
`steps()` straight after returns null.

## FITNESS follow-up 4 — a stale fork shadowed the shipped plans (2026-08-02)

User, twice: *"I don't see the new set of exercises"* / *"I logged in from kid profile and
they still have the old 9 exercises."* **The deploy was fine; the cause was data.**

At 23:35 and 23:36 Dad had tapped "Give Isaac their own plan" / "Give Eleanor their own
plan" while looking at the FIRST fitness deploy. That forked a copy of the generic
9-exercise shared week into `settings_<fam>/fitPlan_Isaac` and `_Eleanor`. Precedence is
**override doc > baked plan > shared**, so those forks shadowed the real programmes for
both kids on every device.

TWO DESIGN FAULTS, both fixed:
1. **A parent landed on the shared week by default.** `fitWhose()` returned the selector's
   value, which defaulted to `""`. Once both kids are forked the shared week is the plan
   NOBODY does — so Dad opened Fitness, saw the old generic exercises, and reasonably
   concluded the deploy had failed. `fitPlanView` is now `null` until explicitly chosen and
   `fitViewNow()` resolves that to the first kid who HAS a plan. Choosing "Everyone" still
   works and now states who is actually on it ("Isaac and Eleanor are both on their own
   plans, so nobody is doing this one").
2. **There was no way back to a shipped plan.** The revert wrote a `{none:true}` tombstone
   which suppresses the baked file too, so "use the shared plan" was the only exit and it
   led somewhere wrong. `fitEnsureBaked` now loads `plan-<kid>.json` ALONGSIDE any override,
   and when they differ the banner offers **"Reset to <Kid>'s programme"** (PIN-gated,
   confirm-gated).

DATA FIX (user-approved, both docs backed up to the session scratchpad first): the two
override docs were OVERWRITTEN with the real plans via the Firestore REST API rather than
deleted — a replace keeps Dad's future edits working exactly as before, and an empty doc is
a state the app had never run against on live data. Read back and verified: 5 exercises ×
2 rounds = 10 sets, 30s rest, correct titles, Sat/Sun rest.
GOTCHA: Firestore REST needs `integerValue` for whole numbers — send `rounds` as a double
and `rounds === 2` stops being true in the app. And PATCH was given an explicit
`updateMask.fieldPaths` covering every field so no stale key survived the replace.

**Suite 230 → 233.** New: an undecided parent lands on a kid's real plan (not the unused
shared week), and "Everyone" still selectable and self-describing.
**TEST GOTCHA that cost the most time here:** `page.click()` scrolls only minimally, so a
control at the page bottom can be left under the fixed `#bnav` and the click lands on the
nav instead — silently, with no error. Symptom was "the builder never opens" with zero page
errors and zero unhandled rejections. New `tap(page, sel)` helper scrolls it to centre
first, the way a thumb would. Also restaged: the persistence check asserted
`setting_fitPlan`, but a save now lands on `setting_fitPlan_<Kid>` since Dad defaults to a
kid's view.

## FITNESS follow-up 5 — look an exercise up while BUILDING, not just from Today (2026-08-02)

User: *"When I am adding new exercises in the Dad account, I need to be able to click in and
see the animation and description from that view, not just in the today view."* Two real
gaps: the builder's own rows had **no way in at all**, and the picker's thumbnail opened the
demo but had nothing to say so, making it undiscoverable.

`fitThumbButton(id, opts)` is now the one control for "tap the picture to see it" — used
wherever a row can't itself be a button: the builder rows hold number inputs, and a picker
row's main tap already means *add this*. It carries a **🔍 badge**, which is the whole point;
without it the picture reads as decoration. `stopPropagation` keeps a look from becoming an
add. The demo it opens is the same full-screen looping view, and from the builder it also
shows the amount that row is set to ("🦵 Legs · 10 reps · No equipment").

Also: builder rows gained `.edit`, which lets the name WRAP. With a mode chip, a number
field and a remove button on the row, "Standing Dumbbell Calf Raise" was ellipsising to
"Standing Dumbbe…" — useless when you are choosing between similar movements. Notes now
show under the name in the builder too.

**Suite 233 → 251.** New: the picker badge exists and says what it does, tapping it opens a
full-size demo WITH the description and does NOT add the exercise, every builder row is
tappable, closing returns to the builder with edits intact, and no name is clipped.
Restaged three that the kids' real plans invalidated: the Today "chips" check (a day that is
one block named after itself suppresses the chip by design — the block heading names it
instead), the Home-card title regex (it names a kid's own plan now), and the image-serving
check (measure `blob().size`, not `content-length` — the suite's own server streams chunked
and sends no such header, so that assertion had been reading `1`).

**TOOLING GOTCHA, cost real time:** patching the suite via `node -e` with backticks inside a
bash double-quoted string lets the SHELL run command substitution on the template literals.
It silently produced `/S/` where `/\S/` was meant and emptied two `ok()` messages — the
checks then passed while testing almost nothing. Use the Edit tool for anything containing
backticks.

## FITNESS follow-up 6 — one plan per person, no "everybody" (2026-08-03)

User: *"lets also get rid of the shared plan, get rid of the reset programme, and add a dad
plan. there will never be an 'everybody' plan."* The shared plan was the root of the two
bugs above — a fork copied it, a tombstone reverted to it, and a parent landed on it — so
removing it deletes that whole class of problem rather than patching it again.

**THE MODEL IS NOW FLAT.** `FITNESS_USERS = ["Isaac","Eleanor","Dad"]` — each has
`settings_<fam>/fitPlan_<Name>` for Dad's edits, falling back to the plan they ship with,
`assets/fitness/plan-<name>.json`. `fitPlanOf(who)` returns **their plan or null**; there is
no inheritance. Someone not on the list (Mom, Grandma) has no plan and gets `null` — they
can still open the tab and look at someone else's.

GONE: `default-plan.json` (the bake now deletes it), the `fitPlan` doc id, `fitForkPlan`,
`fitUnforkPlan`, `fitBakedDiffers`, `fitResetToBaked`, `fitAppendForkNote`, the `{none:true}`
tombstone semantics (a legacy one now just reads as "no saved edits"), and the "Everyone"
option. Function count 89 → 85, and the removals are exactly those five.

**NEW: `FIT_LOCKED_USERS` / `fitLocked()`** splits two ideas that `seesFitness()` was
conflating — *has a plan* vs *may choose whose plan to look at*. The kids are LOCKED to
their own (no selector, no wandering into a sibling's); everyone else gets the selector, so
Dad can build all three. Dad defaults to **his own** plan, a non-participant to the first
person who has one. `fitViewNow()` also rejects a stale saved name, so a renamed profile
can't strand the view.

**DAD'S PLAN** is a deep copy of Isaac's general-strength programme — a starting point, not
something invented for him. Flagged to the user; he can edit or replace it.

**Suite 251 → 253.** E2 was rewritten from "fork/unfork/shared" (all deleted) to the new
model: no "Everyone" option, all three have plans, someone without one gets null with
nothing to inherit, editing one person cannot touch another, no `setting_fitPlan` doc is
ever written, the builder names the person it will change, the fork/reset controls AND their
hooks are gone, kids are locked, Dad gets a Home card. Section A dropped its default-plan
validation (E3 covers the three real plans) and now asserts the shared file is NOT shipped.

**INCIDENT WORTH REMEMBERING.** Deleting the fork helpers with an index-based
`cut(startMark, endMark)` swallowed ~100 lines beyond the intended range — the entire
duration / log / streak layer (`fitItemSecs`, `fitDuration`, `fitEnsureLog`, `fitRecord`,
`fitStreak`, `fitWriteRecord`, …). The syntax check still PASSED, because deleting whole
function declarations leaves valid JavaScript; only running the suite caught it
("fitEnsurePlan is not defined"). Recovered by extracting the exact span from
`git show HEAD:index.html` rather than retyping it from memory. Two lessons: a marker-pair
cut needs its end marker verified to be the NEXT occurrence, and after any bulk deletion,
diff the defined-function list against HEAD — `node --check` will not tell you.
---

# 📰 NEWS — the family's daily feed (2026-08-03)

A `news` section in `index.html` (~430 lines) plus `netlify/functions/news.mjs`. Dad pastes a
publication's web address, the server finds its RSS feed, and every day the section shows that
morning's articles from every subscribed publication in one feed, each with a short summary
written by Sonnet 5. Everyone reads it; only Dad changes the list.

**USER DECISIONS** (asked up front, all three load-bearing): AI summaries on **Sonnet 5** (not
Haiku) · **custom URLs only**, no curated starter list · visible to everyone, **Dad-PIN-gated
editing**. Nearest precedent throughout is Fitness (Dad-edits/everyone-reads) and stocks.mjs
(the server-proxy argument).

## Why a server proxy at all
Publishers send no CORS headers on their feeds, so a browser fetch of any RSS URL fails before
it starts — the same reason `stocks.mjs` exists for Yahoo. Server-side also lets us set a real
User-Agent (several publishers 403 the default) and is the only place the Anthropic key may
live. **No new env vars**: `BUCKY_NOTIFY_SECRET` and `ANTHROPIC_API_KEY` are both already set
for FarmGPT.

## TWO CALLS, NOT ONE — the shape the timeout forced
A Netlify function has ~10s to answer and Sonnet writing forty 40-word summaries is a minute of
generation, so one combined call would time out **every single day**. Split:
- `feed` — fetch + parse only (a few seconds), returning each article with the publisher's own
  blurb already in `summary`. The client paints headlines immediately.
- `summarize` — a batch of ≤8 articles. The client fires several in parallel (3 at a time) and
  swaps each card's text as its batch lands.

Progressive by necessity, better by accident: headlines in about a second instead of a spinner.
A batch that fails costs only its own cards, which keep the publisher's blurb — the feed
degrades, it never blanks.

## Storage — two docs, and the split is deliberate
- `newsSources` — the subscription list. Small, rarely changes, Dad-edited.
- `newsDigest` — TODAY's finished articles + summaries. **ONE doc, overwritten daily**, so it
  needs no pruning (the settings backend has no delete — which is why the Fitness revert had to
  invent a `{none:true}` tombstone).

The digest is **shared, not per-device**, and that is the whole cost story: the first person to
open News today pays for one set of calls and everyone else reads what they generated;
re-opening the app costs nothing. A device paints its `localStorage` copy instantly, reconciles
against the cloud (whoever generated more recently wins), and only calls the server when the day
rolls over or the subscription list actually changes (`newsSig`). Read state is per-device
(`bucky_news_read`) — reading is personal. Day keys are the Plan-area scheme
(America/Chicago, UTC-noon anchored), matching Meals/Fitness.

## SSRF — closed properly, not trusted
The function fetches a URL a person typed. Only Dad can add one, so the threat model is mild,
but "our server will GET any address you name" is exactly the shape of an SSRF. `guardUrl`:
https/http only, no credentials, no non-standard ports, and the hostname must **resolve**
(`dns.lookup`, all addresses checked) outside private/loopback/link-local ranges —
169.254.169.254 is the cloud metadata endpoint. `NEWS_ALLOW_PRIVATE=1` is the test-harness
escape hatch and is checked **before** the port rule so a fake publisher can serve on any
loopback port.

## Discovery ladder
The URL itself if it's already a feed → `<link rel="alternate" type=".../rss+xml">` on the page
(RSS preferred over Atom) → the well-known paths (`/feed`, `/rss`, `/rss.xml`, `/feed.xml`,
`/index.xml`, `/atom.xml`, …). The feed's own title is read from **before the first `<item>`**,
or a channel with a chatty first article gets named after that article.

## THREE BUGS WORTH REMEMBERING
1. **A synchronous claim, not an `await`-then-claim.** Deep-linking to `#news` renders the
   section twice in quick succession (boot, then the navigator). With `newsBusy = true` set
   after the first `await`, both renders got past the guard — two fetches, and the second
   landed on top of the digest the first one's summaries had just been written into. The claim
   is now taken before any await.
2. **The retry floor keyed on the wrong event.** A failed fetch leaves the digest stale and
   `renderNews` auto-refreshes on a stale digest, so a floor is needed or they spin forever.
   Keying it on the last *attempt* also blocked the legitimate day-rollover refetch. It keys on
   the last **failure** (`newsLastFail`), cleared on success.
3. **Double-escaped feeds need a second decode.** A feed carrying `&amp;ndash;` inside escaped
   HTML leaves `7&ndash;2` on the card after one pass. Safe to decode twice **here** and only
   here: this text is written with `textContent`, never `innerHTML`, so there is no markup to
   smuggle back in.

## Nav
**Ten bottom-nav areas now** (Home · Plan · Chores · Fit · News · Jobs · Shop · Bank · Farm ·
Play). Ten at 390px is ~36px each, which clips a 6-character label, so a `max-width:460px` rule
tightens the bar (gap 1px, label 9.5px, no letter-spacing). Measured: 0 clipped labels.

## VERIFY: `node tools/_verify-news.cjs [--shots]` — **136/136, 0 page errors**
Section A runs `news.mjs` **in process** against a fake publisher (RSS + Atom + a homepage
advertising its feed + a quiet weekly) and a fake Anthropic — no real internet, no real
publishers, no API spend. Covers the discovery ladder, RSS/Atom/CDATA/entity parsing, the SSRF
guard both ways, per-source caps, a broken publication not sinking healthy ones, batching
(one model call per batch, Sonnet 5, prompt content), and every summariser failure mode.
Sections B–G drive real Chrome at 390×844 + desktop with the function **route-mocked**, so the
client's caching, gating and two-phase flow are what's under test.
**FIREBASE IS BLOCKED THROUGHOUT** — this suite exercises first-run paths, and an unblocked
headless run against index.html has twice duplicated the live goat herd.

**TEST GOTCHAS** (all cost real time here):
- `page.goto(BASE + "/index.html#news?n=1")` puts the query **inside the hash**, so
  `location.hash.slice(1)` is `"news?n=1"`, not a deep-link tab — boot lands on Home and
  re-highlights it *after* you navigate. Query before hash. This produced a screenshot showing
  News content under a lit-up Home button, which reads exactly like a nav bug and wasn't one.
- Navigate by **tapping the nav button**, not just by calling `goTo` — that is what catches an
  area that renders its section but never lights up.
- A mock that answers instantly means a "before" snapshot can already be the "after". Compare
  against blurbs taken from the **mock**, not read off the screen.
- Mock feed handlers keyed to fixed source ids silently hand an empty feed to a
  newly-added publication, whose id is generated at runtime.
- The suite's own `hours` is clamped (min 6), so testing the quiet-publication fallback needs a
  genuinely stale feed, not a narrow window.

**Shots**: `shots/news_{empty,feed,sources,desktop}.png`.

**UNPUSHED** — awaiting user preview (`main` auto-deploys). Deferred: a Home dashboard card
(the weather/calendar/stocks slot is the obvious home for a headline or two), per-person
subscriptions, and a "read it here" reader view instead of opening the publisher's site.

---

# ✅ CHORE ROTA · FITNESS GATE · CHROME REWORK (2026-08-03, same session as News)

Four changes asked for before the News push. `index.html` only, plus a new suite
`tools/_verify-chore-care.cjs` (**40/40**).

## 1 · The daily chores follow the animal-care rota
The daily chores ARE the animal chores, so they only belong to the kids on the days the
Kreussers are actually covering. `choreOnDuty(c)`: **morning → the 🌅 am slot; noon AND
night → the 🌙 pm slot** (there are two care slots, not three). Only DAILY chores follow the
rota — a weekly barn muck-out is ours whoever fed the goats that morning.
- **USER DECISIONS**: off-duty chores are **hidden**, not greyed ("everything a kid can see
  is something they have to do, so 'all done' means all done"); a **partial day still pays**
  — finish the slots we DO have and the $2 lands. A day with no Kreusser slot has no chores
  and no allowance.
- One quiet `.care-off` line per uncovered slot says who has them, or the missing chores
  just look like a bug. It sits **above** the frequency loop deliberately: when a whole slot
  is someone else's there are no daily chores left to hang it off, which is exactly when the
  explanation matters most (first version put it inside the loop, which `continue`d past it).
- Applied in all three places that must agree: the Chores tab, the Home hero ring
  (`dayChores`), and `allDailyChoresDone()` → the allowance.
- **Failure directions are deliberately opposite.** Until the rota loads, the chore list
  shows everything (hiding a kid's real chores is worse than showing one extra) while the
  allowance *waits* (minting is irreversible in practice — see the 4x-mint incident).
  `loadAnimalCare()` now runs at boot from `afterBackendReady`, not only when someone opens
  the Animal Care tab.

**THE BUG THIS UNCOVERED — the most ordinary family never got paid.** `loadAnimalCare`
repainted only when the fetched rota *differed* from what was in memory. The shipped default
is "Kreussers on every slot", so for a family that never overrides anything the fetch matched
byte-for-byte, `changed` was false, and nothing re-rendered — even though `careLoaded` had
just flipped false→true. Everything gated on `careLoaded` (now: the chore list, the ring, the
allowance) therefore never re-evaluated, and `ensureDailyAllowance` ran exactly once, before
the rota existed. Fixed by repainting when `changed || !wasLoaded`. Also moved that `render()`
**out of the try/catch** that wraps the settings fetch — with it inside, any error render()
threw was swallowed silently, with no page error to show for it.
Found by tracing exit reasons, not by reading: the trace read `["no-care"]`, one entry, which
is what proved it was never called again rather than called-and-refused.

## 2 · Fitness is only for the three people who use it
`navKeyVisible("fitness")` and a new `navGroupVisible("fit")` branch both gate on
`seesFitness()` (`FITNESS_USERS` = Isaac, Eleanor, Dad), and `render()` bounces a stale
`#fitness` deep-link to Home. It used to be reachable by everyone; the fitness suite's
assertion to that effect was updated rather than bent.

## 3+4 · Half-height header paying for a two-row nav
**MEASURED before and after at 390x844, because "net result of space should be equal" is a
number**: header **90 → 55px**, nav **59 → 95px**, total **149 → 150px**.
- Header: the goat logo is gone; title and subtitle sit on ONE baseline (stacking them was
  most of the height); bell 34→28px, padding 16/14→5/5, stripes 6→3px, status 12→11px.
  `#toastWrap` moved up with it (88→56px).
- `#bnav` is a **grid** now, two rows on a phone. `--bnav-cols` is set in `buildBottomNav`
  to `ceil(shown/2)` so the rows stay BALANCED however many areas that person can see —
  10 → 5+5, 9 → 5+4, 8 → 4+4 (the Bank and Fit gates change the count). Desktop keeps ONE
  row via `--bnav-all`; the two-row layout solves a phone problem.
- Buttons went **38px → 72px** wide, so the `max-width:460px` label-shrinking hack the News
  entry added for ten one-row areas was deleted. Body clearance 156 → 196px.

## VERIFY
`node tools/_verify-chore-care.cjs [--shots]` — **40/40**, 0 page errors. Section A drives the
rota (full day / Joy on nights / Grandparents all day, incl. the Home ring agreeing with the
list and the weekly chore being exempt); B drives the allowance (unfinished pays nothing, the
DEFAULT rota pays with no prompting, a no-slot day never pays, a partial day does); C measures
the chrome and walks four profiles through the Fitness gate.
Firebase blocked throughout — this suite writes chores and allowance docs.
**Test notes**: the local backend keeps every chore (allowance rows included) in ONE
`buckyData1` array, not per-chore keys; a chore is done when `donePeriod` matches today's
period key and `doneLog` fills its target; and `rota("Kreussers")` is byte-identical to the
shipped default, which is precisely what makes it the important case to test.
Regressions: news **137/137**, fitness **253/253** (one assertion updated for the new Fitness
gate). New hook `window.__CHORES__` (careLoaded/onDuty/allDone/mine/mint).
Shots: `shots/chores_offduty.png`, `shots/chrome_2row.png`.

---

# 🖥 NAV ICONS · NEWS TOPICS · DESKTOP SITE (2026-08-03, orchestrated batch: sonnet nav/news + opus desktop)

Three user asks, all in index.html. Suites: news **157/157** · chore-care **49/49** · fitness
**253/253**, 0 page errors.

## Nav
- **🌾 AI** is its own bottom-nav area (NAV_GROUPS entry with `url:"farmgpt.html"` — a group
  with `.url` navigates instead of calling navGroup, never highlights). The FarmGPT feature
  card was removed from renderPlay.
- **🍽️ Meals** is its own area (pulled out of Plan), gated by seesMeals(); using the nav
  button forces `bucky_meal_page = "today"` before render so it always lands on Today.
- 12 areas now; the two-row phone grid balances automatically via `--bnav-cols`.

## News: topics, not publication names
- Each source carries a `topic` (preset list incl. US News/World/Defense/Sports/…; default
  "News"; legacy sources without the field read "News" via `NEWS_TOPIC_DEFAULT`). Dad sets it
  per-row in the Publications sheet; saves immediately.
- Filter chips = "All" + distinct topics of the user's ENABLED publications, `flex-wrap` so
  they all fit with no scrolling. Pick persisted in `bucky_news_topic`.
- **📰 dropdown** (everyone, not Dad-gated): checkbox per publication, per-USER via
  localStorage `bucky_news_off_<name>`. Disabling hides that pub's articles and its topic chip
  when orphaned; the SHARED digest fetch is untouched (other users still need those sources).
- Hook additions: `__NEWS__.topics/topic/offIds/togglePub/setTopic`.
- TEST GOTCHA (cost the sonnet agent real time): `newPage`'s `evaluateOnNewDocument` re-seeds
  `choreUser` on EVERY navigation, silently stomping a mid-test profile switch on reload — it
  now only seeds when nothing is set. And the 📰 dropdown stays open across its own re-render,
  so a test must not "reopen" it blindly.

## Desktop website layout (≥1024px only)
- **Left rail 230px** (`buildSideNav`, rebuilt from `syncTabsUI` so the highlight can't
  drift): wordmark + vertical nav from the SAME NAV_GROUPS/gates/SUBNAV_LABEL, active-group
  child links indented. Bell/who are NOT moved — `body{padding-left:230px}` slides the
  existing header right of the rail; its title hides and `#deskCrumb` names the open section
  (so "Bucky" appears once, in the rail). `#bnav` + `#subnav` hidden, body's 196px nav
  clearance returned.
- Content `main` max-width 900px centred right of the rail.
- **Home is two-column at desktop** — the ONE DOM change: renderDashboard builds
  `.home2-main`/`.home2-rail` wrappers ONLY when `matchMedia(min-width:1024px)` matches
  (below, both names alias the flat container, so the phone DOM is byte-identical — a pure
  CSS grid over the flat list left holes because columns share rows). A matchMedia change
  listener re-renders Home at the boundary crossing only.
- 390px behaviour is sacred and asserted unchanged; the 700–1023px band keeps the old
  clustered one-row bar.
- SUITE RESTAGE OF NOTE: chore-care's old "desktop keeps a single nav row" had become
  VACUOUS (hidden buttons all report top 0 → one-entry Set) — replaced with real assertions:
  bnav hidden, rail visible with ≥10 entries, active highlight, content clear of the rail,
  crumb correct, two-column Home, rail click switches tabs, and 390px restores everything.

Shots: worktree `shots/desk_{home,news,chores,mobile_unchanged}.png`.

---

# 📈 ACTIVITY — who's using Bucky, and how much (2026-08-03, Dad-only)

User: "how users are engaging with bucky — who is using the news app and how often, who is
using story time, are games being played, meals logged." Nothing recorded who OPENED
anything, so this is a NEW telemetry path: the dashboard starts empty and fills from deploy
day. **No backfill, nothing inferred** — `TRACKING_SINCE` in activity.html is the one date to
bump if the deploy slips.

## Three parts
- **`assets/activity.js`** — the beacon, one `<script src="/assets/activity.js" defer
  data-feature="…">` on 15 family pages (NOT the editors/demos, not activity.html). Identity =
  localStorage `choreUser`, else "Unknown" — never invented. Auto-view on load; **dwell** ticks
  every 30s only while `visibilityState === "visible"` (accumulating REAL elapsed), which is
  what separates "opened" from "played". Aggregates into localStorage `bucky_act_buf`, flushes
  on pagehide / hidden / ~90s via `sendBeacon` (fetch keepalive fallback), KEEPS the buffer on
  a failed flush, caps it so it can't grow unbounded offline.
- **`netlify/functions/activity.mjs`** — `log` + `stats`, zero deps, NO NEW ENV VARS
  (BUCKY_NOTIFY_SECRET gate + FIREBASE_SERVICE_ACCOUNT, same JWT/Firestore-REST technique as
  farmgpt.mjs). ONE DOC PER USER PER MONTH in `bucky_activity`, id `<YYYY-MM>__<userSlug>`,
  counter fields `<DD>_<feature>_v` / `_m` so every write is an INCREMENT fieldTransform and
  concurrent devices converge instead of clobbering. Minutes are `doubleValue` on purpose —
  rounding a 40-second visit to 0 would systematically erase exactly the short visits that
  distinguish opened from played. `log` ALWAYS returns 200 (it's a beacon on a page someone is
  mid-use of). 6-month retention pruned on read.
- **`activity.html`** — Dad-gated (same soft posture as the API-usage page: endpoint is
  family-secret gated, UI is `isDad()` + PIN). Day bars, per-person cards (sessions / time /
  last seen / top features), and a per-feature breakdown with a bar per user. Same chrome as
  weather.html (12-area nav + desktop rail); NO nav entry is marked active — it is a Dad tool,
  not one of the family areas. Unlinked, direct-URL only, like leveleditor.html.

## Index/farmgpt get finer-grained hits
`goTo(tab)` → `app_<tab>` and farmgpt's `show(name)` → `farmgpt_<name>`, both guarded with
`window.BuckyActivity &&` so a missing or blocked beacon can never break navigation.

## VERIFY
`node tools/_verify-activity.cjs` **147/147** (Section A drives the function in-process against
a FAKE Google token + FAKE Firestore that really APPLIES the transforms, so convergence is
measured not asserted; B+ drives real Chrome with Firebase blocked).
`node tools/_verify-beacon-safety.cjs` **90/90** — the important one, because the beacon now
sits on 15 pages: each page is loaded three ways (beacon present · beacon 404 · beacon present
with its own `setItem` and `sendBeacon` THROWING) and must render the same character count and
stay error-free every time.
**TEST GOTCHAS**: (1) sabotaging `localStorage` wholesale proves NOTHING about the beacon — it
just breaks every page's own profile code; scope the throw to keys starting `bucky_act`.
(2) weather.html reports `L is not defined` under a no-external-hosts harness because Leaflet's
CDN is blocked — it appears identically with the beacon 404'd, which is how you know it isn't
yours. (3) A percentage width on an inline `<span>` does nothing: the first dashboard bars
rendered flat AND the test passed because it read `style.width` ("100%") instead of geometry —
measure `getBoundingClientRect()` against the track.
Regressions green: news 157 · chore-care 49 · fitness 253.
Shots: `shots/activity_{desktop,mobile,empty}.png`.

---

# 📖 STORY TIME CONTINUITY — the ledger engine, steps 1-2 (2026-08-03, UNPUSHED)

Plan of record: `storytime-continuity-plan.md`. Steps 1 (schema + plumbing) and 2 (narrator
path) are done; the KEEPER (step 3) is deliberately NOT built — the plan's own rule is that the
narrator has to be right before bookkeeping is automated. Files: `farmgpt.html`,
`netlify/functions/farmgpt.mjs`, new `tools/_verify-storyledger.cjs` (**212/212**, 0 page
errors) and `tools/_probe-storyledger.mjs`. Built on top of the parallel session's uncommitted
baked-stories WIP; none of its hunks were touched.

## What a ledger story is
A story object created from here on carries `ledger` (schema v1), `ledgerDiffs[]` and
`schemaVersion`. A story saved BEFORE this — no `ledger` field — is legacy forever and keeps
the "STORY SO FAR" recap path byte-identical, including `maybeSummarize`. `hasLedger(s)` is the
only switch, and every branch (send, save, resume, export) reads it. A ledger that comes back
malformed (hand-edited localStorage, a partial write) is DELETED on resume: the story drops to
the legacy path and still reads and still continues, rather than shipping a broken ledger to
the narrator.

## Step 1 — plumbing, no AI
- `validateLedger` is structural, not semantic: right shape ⇒ always renderable. It rejects a
  wrong `schema_version`, any list that isn't a list, a canon entry with no rule, and a ledger
  far past the cap.
- **Canon is append-only and `canonPreserved` proves it by comparison, not by intent** — it
  diffs the canon before and after and catches an edit, a delete, AND a reorder (a reorder is
  an edit in disguise once entries are referenced by position). `update.canon` is rejected on
  sight as malformed.
- `applyLedgerDiff` is **all-or-nothing**: everything lands on a deep copy, and the copy is
  adopted only once canon survives intact and the result validates. A patch that is half good
  applies NOTHING (tested). The original object is never mutated, so a rejected diff can't
  half-write. Ids are assigned by the CLIENT, never taken from the patch — a keeper can't
  collide or renumber.
- **`ledgerDiffs` is load-bearing for step 5's rewind**, so the contract is complete + ordered +
  no gaps: exactly one entry per scene, at its own index. A scene whose keeper hasn't run (right
  now: every scene) still records an honest empty entry, and `recordLedgerDiff` backfills any
  hole — a hole would silently shift every later replay. `replayLedgerDiffs(seed, log, N)`
  rebuilds the ledger at scene N and is asserted equal to the live one.
- **Universe picker** (🐉 HTTYD · ⚔️ Star Wars · ✨ My own world, default). A pack is fetched at
  story creation from `assets/storytime/universes/<id>.json` and seeds the ledger; the story's
  COPY is what evolves, so editing a pack file never rewrites a story in progress. A missing or
  broken pack degrades to a valid empty original-world ledger plus a quiet toast — a content
  workstream's uptime can never stop a story starting.
- **PROTAGONIST CAPTURE = a name field on the setup screen** (`#heroName`), applied to both the
  typed box and the builder, appended to the opening prompt as "My name is X." Both blocks are
  created either way: `protagonist` AND a full `characters[]` entry with `origin:"reader"` and
  the same sheet fields a pack character gets. With no name given they exist unnamed, for the
  keeper to fill from scene 1 — the renderer prints "(unnamed — the reader's own character; take
  the name from the story)", which reads fine to the narrator.
- Bookshelf size math: art still goes first; if the shelf is STILL over 300KB every ledger on it
  is compacted to 8KB (timeline first, then resolved threads — a character is NEVER dropped, so
  a 23KB HTTYD ledger simply stays; 20 of them is ~470KB of localStorage, well inside budget).
  20-story cap unchanged.

## Step 2 — the narrator path
- `SEND_SCENES = 3` verbatim for ledger stories (replacing the 4-CHAPTER window) — smaller AND
  more reliable, because the memory is now structure instead of prose. Legacy keeps
  `SEND_CHAPTERS = 4` + the recap fold-in.
- **THE LEDGER RIDES IN ITS OWN REQUEST FIELD (`body.ledger`), NOT INSIDE A MESSAGE.**
  `MAX_CONTENT_CHARS` is 12000 per message, so a 30KB ledger stuffed into `messages[0]` would be
  sliced mid-JSON — silently, and the narrator would read half a world. Keeping it separate also
  lets the SERVER own the rendering, the cap and the placement.
- **DEVIATION FROM THE PLAN, deliberate, and it serves the plan's own stated reason.** The plan
  orders the prompt "meta+canon → characters/locations/relationships → protagonist/flags/threads/
  player_knowledge → last N scenes → choice", justified as "by volatility (cache-friendly)". The
  ledger blocks keep exactly that ORDER, but the split lands the STABLE half (meta, canon, cast,
  places, bonds) on the world-setup turn and the VOLATILE half (hero, flags, live threads, what
  the reader knows) on the reader's newest message — i.e. AFTER the scenes, not before. Putting
  the volatile half in `messages[0]` would change the cached prefix every single turn and destroy
  caching outright, which is the opposite of the ordering's purpose. Recency is a bonus: "how
  things stand right now" sits where the model attends most. Asserted both ways in the suite.
- `STORY_LEDGER_RULES` is appended to the system prompt **only when a ledger is actually
  present**, so a legacy story's prompt is provably byte-identical to what it was. Rules: the
  ledger outranks recent prose · canon contradictions FAIL DIEGETICALLY (the world refuses, never
  the narrator) · `hidden_from_player` may not leak by statement, implication, hint or
  foreshadowing · recorded voices are mandatory · threads resolve only when earned · **FAMILY_RULES
  outrank every line of the ledger, canon included** (the ledger arrives from an untrusted
  client — the house cap-bypass threat model).
- `hidden_from_player` IS sent to the narrator, on purpose: it has to know the secret to write
  toward it without giving it away. The timeline is NOT sent — it is an audit trail for the
  keeper, and it is therefore also the first thing compaction drops.
- **Multi-POV retired** (single protagonist per the plan): the STORY_SYSTEM chapter clause and
  the `STORY_NEW_CHAPTER` directive both said a new chapter MAY switch whose eyes we follow.
  Both now pin the same hero. `SUMMARY_SYSTEM`'s "may follow SEVERAL protagonists" was left
  alone — that is the legacy recap path, and the brief said retire just the next-chapter
  affordance.
- Preserved verbatim and asserted: the ===CHOICES===/===CHAPTER===/===CHAPTER END=== protocol,
  directives-on-the-LAST-USER-TURN (the volatile ledger block is appended BEFORE the chapter
  directive so the directive stays last), the pacing section, "natural next steps" (the spec's
  rejected "meaningfully different kinds" was NOT restored), maxTokens 1200, thinking disabled,
  `cache_control`. ADDED per the plan: "never offer a choice whose outcome is obvious".
- Server size cap 30KB is a **backstop, not the mechanism**: the client trims to 28KB before
  sending, and an oversized ledger that arrives anyway is COMPACTED, never rejected — bookkeeping
  must never be the reason a scene fails to arrive.

## CAST HYDRATION — why the wire never truncates the cast
The real `httyd.json` carries **22 characters in 23.1KB**, of which ~16.5KB is character sheets.
An earlier version of `compactLedger` fit the budget by `pop()`ing the tail of `characters` —
which would have silently deleted Mala, the Grimborns and Johann from the world somewhere around
scene 10-20 of every HTTYD story. A kid asks about Snotlout and he no longer exists, with no
error anywhere. **That is the exact failure this engine exists to prevent, and it fails
silently, which is worse.** Truncation was the wrong tool; hydration is the right one (the
plan's step-5 "dormant characters" idea, applied from turn zero).
- The **STORED ledger always holds every character's full sheet.** Nothing is ever lost on disk.
- `shapeLedgerForWire` sends FULL sheets only for who is **ON STAGE**: the protagonist · the
  reader's character · anyone who has actually appeared (`last_seen.turn > 0`) · anyone named in
  an unresolved thread. Everyone else becomes a **CAST ROSTER** line — id, name, ≤10-word role,
  and nothing else (voice/physical/knows/does_not_know are where the bytes are).
- **HYDRATION IS AUTOMATIC**: the turn after the keeper sets `last_seen` on a first appearance,
  that character arrives with a full sheet. The narrator is told so — roster names are real,
  present-but-off-screen people it may walk into a scene, and it must NOT invent a voice or a
  history for one, because the sheet arrives the moment they enter. The roster block's wording
  is load-bearing: a roster that reads like a list of *absent* people invites the narrator to
  write the world as if they don't exist.
- **THREAD-NAME MATCHING IS STRENGTH-RANKED, and a test fixture caught why.** A cast whose names
  share a leading word ("Character 7…", "Character 19…") made a bare first-name substring match
  pull ALL 22 on stage, crowding out the one the thread was actually about. Matching is now
  word-bounded, full-name matches outrank first-name ones, and the over-`ONSTAGE_MAX` sort is
  most-recently-seen then thread-strength. The reader is never cut.
- **Truncation order, and nothing outside it is ever dropped**: timeline (oldest first) →
  resolved threads → roster ROLE LINES → locations. Canon, the protagonist, every on-stage sheet
  and every roster ENTRY are untouchable — a character may lose their role line, never their name.
- **THE TIMELINE NEVER TRAVELS.** `renderLedgerBlocks` never shows it to the narrator (it is the
  keeper's and the rewind tool's audit trail, both of which read the STORED ledger), so sending
  it bought nothing — and it was 5.5-10KB of every request, the single thing pinning a long story
  at 100% of budget. Dropped from the wire copy; the stored copy keeps every entry.

**MEASURED (`_verify-storyledger.cjs` section H prints these every run, against the REAL packs):**

| httyd.json (23 chars, 23.6KB stored) | wire bytes | % of 28KB | on stage | on the wire |
|---|---|---|---|---|
| fresh story | 9,128 | 33% | 1 | all 23 |
| ~scene 40 | 16,135 | 58% | 6 | all 23 |
| ~scene 100, heavy | 22,466 | 80% | 10 | all 23 |

(starwars.json, 4 chars: 7,572 / 13,378 / 17,759 — 27% / 48% / 63%.) At scene 100 the bytes are
onstage 6,532 · knowledge 4,240 · threads 3,691 · canon 2,957 · rels 1,852 · locations 1,376 ·
roster 1,281. **RECOMMENDATION: LEDGER_WIRE_BUDGET stays at 28,000.** With hydration and the
timeline off the wire there is 20% headroom on the worst realistic case, and compaction is not
touching content at any length — the suite asserts exactly that (`at ~scene 100 compaction has
not had to bite into roster roles or locations`). If that assertion ever trips, RAISE THE BUDGET
rather than lose content; at Haiku prices the cap is far cheaper than a missing character.

**ANSWERING THE PACK SECTION'S FLAG** (see "universe packs" below — it closes by noting ~7KB of
headroom is tight and offering two outs: seed only the characters a story touches, or let step 5
collapse dormant ones). That was the engine's call and this is it: **neither out was needed, and
the first one would have been the wrong answer** — a pack seeds every character precisely so the
narrator knows who exists, and a story cannot "touch" a character it was never told about. What
was actually expensive was sending 22 full SHEETS on every turn, not storing 22 characters. Step
5's dormant-character idea is pulled forward to turn zero as hydration, so the pack should keep
seeding its whole cast at full detail. **Packs do not need to get smaller for the engine's sake.**

## ⚠ NOT LIVE-VERIFIED — the step-2 gate is still open
There is no `ANTHROPIC_API_KEY` in this environment (`tools/.env` has only ELEVENLABS and TRIPO)
and api.anthropic.com is unreachable, so **the narrator prompt has never been run against a real
model.** Everything above is proven on the WIRE and in the CLIENT against a fake Anthropic.
`node tools/_probe-storyledger.mjs [--url <base>] [--gate canon|hidden|voice|choices]` runs the
four acceptance gates against the deployed function and prints the transcripts: a canon rule
("nobody in Saltmere can swim") attacked by a write-in that assumes swimming · a
`hidden_from_player` secret hunted across 5 consecutive scenes including a direct question ·
a terse character's voice under pressure to monologue · the choice contract. It sends **no
`user` field**, so it neither counts against the 15/day cap nor writes to the kids' Story Log.
Its automated checks are TRIPWIRES; the transcripts are the deliverable. Tune
`STORY_LEDGER_RULES` and re-run.

## Tests
`node tools/_verify-storyledger.cjs [--shots]` — **212/212**. Section A runs farmgpt.mjs IN
PROCESS against a fake Anthropic (which records every request body), a fake Google token signed
with a throwaway RSA key, and a fake Firestore: block order both halves, every ledger rule
stamped, the timeline withheld, legacy byte-identity, the preserved machinery, single POV, the
size backstop, and the regressions that matter — **the daily cap still fires (and the model is
never called), scenes still log, FAMILY_RULES still stamped**. Sections B-F drive the real page
in headless Chrome over a local http origin: validator accept/reject incl. all four canon-drift
shapes, ~12 diff rejections each proving the ledger is unchanged, all-or-nothing, the diff-log
contract, replay, seeding, graceful pack failure, the wire window for both paths, and a real
story start → shelve → reload → resume with a legacy story on the same shelf.
Section G is the hydration battery (a 22-character synthetic pack the same size as the real one:
nobody vanishes at any budget including 500 bytes, on-stage keeps its sheet while the unseen stay
roster lines, hydration lands the turn after first appearance, canon + protagonist survive, and a
long-story simulation still ships all 23). Section H MEASURES the REAL packs and reports rather
than asserting their content, so a pack edit can never fail the suite.
Regressions: `_verify-kidstory-server.mjs` 54/54, `_verify-dnd-server.mjs` 47/47.
**THE PACKS ARE NOT THIS SUITE'S TO ASSERT ON** — `assets/storytime/universes/*.json` is a
parallel content workstream; every pack FETCH is intercepted and answered with a FIXTURE defined
in the suite (an invented harbour town), so what is under test is the seeding CONTRACT, not
anyone's prose. The real packs are read only by section H, only to measure bytes.
New test hook `window.__STORY__`.
**TEST GOTCHAS**: the CDN libraries must be stubbed by request interception — jsdelivr is
unreachable here and `marked.setOptions` runs at page-script top level, so an unstubbed CDN
takes the whole script (test hook included) down with it, which reads as "the page is broken".
And the fake Anthropic response must be DRAINED FULLY (`await resp.text()`), or the handler's
`finally{}` logging never runs and the cap/log assertions test nothing.
Shots: `shots/st_ledger_setup.png`, `shots/st_ledger_universe.png`.

**DEFERRED to the keeper (step 3), by design**: nothing writes a diff yet, so every
`ledgerDiffs` entry is currently an honest `{diff:null, ok:false, reason:"no keeper yet"}` at
its own scene index; `meta.turn` advances per scene. Reader-canon promotion (`source:"reader"`
from a write-in or redo) has its schema field and its precedence documented but no
implementation, and there is no redo affordance yet.

---

# 📖 STORY TIME CONTINUITY — universe packs (2026-08-03)

The rebuilt "universe info sheet" the family lost. Packs seed a new Story Time story's
ledger so the world starts out knowing itself; they exist because Story Time kept getting
franchise facts wrong and the kids noticed (wrong character details, wrong lightsaber
mechanics). **Pack accuracy is the product** — every load-bearing claim was web-verified
during authoring, sources listed per pack in the directory README. Schema, precedence
rules and how a pack seeds a story live in `storytime-continuity-plan.md` (repo root);
this entry does not restate them. Engine side (farmgpt.html / farmgpt.mjs / storytime.html)
was built by a parallel agent and is NOT touched by this work.

**Files** — `assets/storytime/universes/`: `httyd.json` · `starwars.json` ·
`_validate.mjs` (reusable pack validator) · `README.md` (format, sources, judgment calls).

- **httyd.json** — timeline point **"conclusion of Race to the Edge (before HTTYD 2)"**,
  the user's explicit spec: every status true as of series end, not the films. 22
  characters (six riders AND their six dragons as full entries, Stoick, Gobber, Heather +
  Windshear, Dagur + Sleuther, Mala, and the four antagonists), 17 canon rules, 7
  relationships, 5 locations. The era subtleties are the point and live in the right
  buckets: Valka believed dead (Hiccup AND Stoick), Toothless believed the last Night
  Fury, no Hidden World or Light Fury, Hiccup not yet chief, Hiccup+Astrid together but
  NOT engaged, Berk at peace, both Dragon Eyes destroyed. Antagonists at series end —
  Viggo dead (sacrificed himself after Johann's betrayal), Ryker dead (Submaripper took
  his ship), Johann dead (frozen by the Bewilderbeast), **Krogan ALIVE and vanished**
  (commonly misremembered as a death; he is the one RTTE villain a new story can reuse).
- **starwars.json** — RULES pack per the user, not a cast dump: 25 canon entries on how
  the Force works and how lightsabers work (light/dark and what feeds each, training,
  telekinesis, reflexes, sensing, visions as one possible future, mind trick + who resists
  it + droids immune, kyber crystals as the living heart of a blade, attunement/colour,
  bleeding red and healing back, what a blade cuts and what resists it — beskar, cortosis,
  phrik — blade-on-blade locking, deflecting bolts). **Era-agnostic**; the reader sets an
  era in setup. Only 3 characters, each era-flagged inside `status` so a pre-Empire story
  correctly has no Vader. Jedi and Sith are canon entries, not characters.

**VERIFY**: `node assets/storytime/universes/_validate.mjs [file.json]` — **928/928, exit 0**
(schema subset complete, no empty field, unique/well-formed C*/CH*/L* ids, one-sentence
canon rules, pack turns all 0, no stray top-level keys, seed size under the ledger cap).
A 14-case negative test (deliberately corrupted packs) proved every rule actually fires —
and immediately caught a real bug in the validator itself: `argv.map(basename)` hands
`basename()` the array INDEX as its `suffix` argument, so single-file mode crashed on every
invocation. **A validator that has only ever passed is untested.**

**SIZE / the ledger budget** — the number that matters is the MINIFIED seed, since that is
what counts against the server's ~30KB ledger cap: httyd **22.7KB**, starwars **9.5KB**.
HTTYD is over the 4-8KB hoped for and that is a genuine trade-off, not an oversight: 22
characters × 8 prose fields plus JSON keys floors near 16KB however tightly worded, and the
prose was cut twice — what remains is `voice` (voice drift was a family complaint), `status`
(the timeline point's actual payload) and the knowledge buckets, i.e. the three things the
pack exists to fix. **Flagged for the engine**: ~7KB of headroom is tight; the easy outs are
seeding only the characters a story touches, or letting the planned compaction step (plan
doc build step 5) collapse dormant ones. That is the engine's call, not the pack's.

---

# 📖 STORY TIME CONTINUITY — the KEEPER, step 3 (2026-08-03, UNPUSHED)

Plan of record: `storytime-continuity-plan.md`, build step 3, now ticked. The ledger stops being
plumbing and starts remembering: after every scene of a ledger story a second tiny model call —
the KEEPER — reads what was just written and returns a DIFF, which the client validates, applies
and files. Files: `netlify/functions/farmgpt.mjs`, `farmgpt.html`, `tools/_verify-storyledger.cjs`
(212 → **374**, 0 page errors), new `tools/_probe-storykeeper.mjs`. **Verified LIVE against real
Haiku** — an `ANTHROPIC_API_KEY` exists in `tools/.env` now and api.anthropic.com is reachable, so
unlike steps 1-2 nothing below is fake-server-only. Built on top of the parallel session's WIP;
none of its hunks were touched.

## The keeper
Server mode `"ledger"`: Haiku, thinking off, JSON only, **its own** records-clerk system prompt
(`LEDGER_KEEPER_SYSTEM`) — it is not a storyteller, and FAMILY_RULES is deliberately NOT re-sent to
it (one short "leave that material out of the ledger, and stay JSON" line instead: a clerk that
refuses returns prose, and prose is a lost scene). Its single user turn is built SERVER-SIDE from
named body fields (`ledger` + `scene` + `choice` + `readerAssert` + `turn`); a `messages` array from
the client is ignored, because `MAX_CONTENT_CHARS` would slice a 28KB ledger mid-JSON.
`renderLedgerForKeeper` is deliberately NOT `renderLedgerBlocks`: the narrator is shown a world, the
clerk is shown a **filing system** — every entry carries the id an update must quote back, and
HIDDEN is a working list to promote FROM rather than a secret to write around.
- **It costs no daily cap and writes no Story Log.** Both gates were already `mode === "story"`, so
  this is structural rather than a new exception — the scene it reads was logged by the story call
  that produced it, and a second copy would corrupt Dad's review view AND double-count the cap.
- Usage lands in a new bucket **`l`** (`l_in/l_out/l_req/l_cw/l_cr`), with a 📒 row and column in the
  dashboard. Folding it into `s` would make a chapter look twice as expensive as it is.
- Pinned to Haiku regardless of `STORY_PROVIDER`: flipping the narrator to Gemini or Sonnet is a
  prose decision and must not silently move the bookkeeper onto a provider whose JSON adherence
  nobody has measured.

## Client: fail-open is the contract
`runKeeper` sits in the `maybeSummarize` slot (legacy stories keep the recap path untouched). EVERY
failure — network, unparseable JSON, a rejected patch, a canon violation, a timeout — leaves the
previous ledger byte-identical, records an honest empty entry so the diff log stays gapless, and
says nothing to the reader. A keeper failure is invisible from the reading chair.
- **Keeper calls QUEUE, they never overlap and are never dropped.** The first cut used a boolean
  latch, which silently threw away a scene's bookkeeping whenever the reader chose faster than the
  keeper answered — and diffs must apply in scene order anyway, each written against the ledger the
  one before it left behind.
- A 45s abort. Without it a hung request latched the keeper closed for the rest of the session —
  the one failure mode fail-open does not cover by itself.
- The failure REASON now carries a 200-char snippet of what actually came back. "Wasn't JSON" alone
  is unfalsifiable a week later, it is the field step 5's audit tool will read, and it is what found
  the max_tokens bug below.

## `promote_knowledge` — the reveal-preserving move
A new diff op, and **the only way anything ever leaves `hidden_from_player`**. Everything else in a
diff is additive (which is what makes a bad patch harmless), but player_knowledge has to move a line
between buckets: a secret still marked HIDDEN after the reader has learned it makes the narrator
hide something the reader is already holding. Two rungs, per the step-2 gate's finding:
**hidden → suspected** (the reader earned doubt) → **known** (the story confirmed it). Matching is
exact → normalised → containment-either-way with a ≥12-char overlap guard, because a model told to
"copy the line exactly" still paraphrases; the LEDGER'S wording is what moves, never the paraphrase.
A fact that was never hidden is simply added rather than lost. Re-promoting to the rung it is
already on is a no-op — the keeper does re-report.

## Reader canon
A write-in or a redo note is a READER ASSERTION and can become permanent canon with
`source:"reader"`, which the narrator is now told **outranks any other canon rule it contradicts**
(the pack FILE is never touched — only this story's copy). The rendered CANON block marks those
lines; FAMILY_RULES still has the last word.
**The CLIENT, not the model, decides when that authority may be minted.** `sanitizeKeeperDiff`
downgrades any `source:"reader"` the model invents on a turn that carried no assertion, and `"pack"`
is denied outright (only the seeder mints pack canon). Permanence is free: canon is append-only and
`canonPreserved` already catches an edit, a delete or a reorder.

## Redo
"↻ redo this scene" + an optional note, offered whenever a scene is on the page and the story is
waiting on the reader (including at a chapter end). It throws the last scene away, **truncates the
diff log so no entry outlives its scene**, and rewinds the ledger through `ledgerPrev` — the
keeper's snapshot from immediately before the diff it applied. A stale keeper still in flight for
the discarded scene abandons quietly (`story.keeperGen`) rather than stamping its diff onto the
index the replacement now occupies — a silent, unfindable corruption otherwise. `ledgerPrev` doubles
a ledger story's footprint, so under shelf pressure it is shed OLDEST BOOK FIRST, before any ledger
is compacted, and the book on top keeps its undo.
A redo can leave the reader's note attached to the NEXT_CHAPTER sentinel, so every "is this the
next-chapter turn?" test is now a PREFIX test (`isNextChapterTurn`) — four call sites.

## Two fixes this step made to steps 1-2, both found by the live work
- **`update.meta` now applies BEFORE the adds.** New canon and timeline entries are stamped from
  `meta.turn`, so with the update running last a replay stamped them differently from the live run —
  i.e. `seed + diffs 0..N` did NOT reproduce the ledger exactly, quietly breaking step 5's rewind
  primitive. Caught by asserting the WHOLE ledger rather than just its canon.
- The keeper stamps the scene's turn into the diff itself, for the same reason (a replay never runs
  the client code that sets `meta.turn`).
- Plus one tolerated misplacement: the model repeatedly emits `player_knowledge` at the TOP level
  instead of under `add`. Unshimmed that is an unknown key — the diff "succeeds" while silently
  losing what the reader learned. Only this one key is folded; an ambiguous misplacement
  (`protagonist`, which could mean add OR update) is left alone rather than guessed at.

## LIVE — what the model actually did
`node tools/_probe-storykeeper.mjs [--promo N] [--habits N] [--play N]` hosts the real function
in-process with the real key and Firestore pointed at a dead host (so probe scenes never touch the
Story Log and the cap query fails open), and `--play` drives the REAL page end to end.
- **PROMOTION, 5 fixed scenes × N trials** — fixed scenes so only the keeper's judgement varies;
  narrator variance would otherwise dominate the number. **Before tuning 31/40 = 22% failure**, in
  two clear shapes: found evidence read as PROOF (promoted straight to `known`), and mere
  topic-relevance read as suspicion (a confident accusation of the WRONG person promoted the
  secret). After rewriting that section as an ordered 3-question test plus an explicit WHEN NOT TO
  PROMOTE: **136/140 pooled over three runs = 3% failure**, then 40/40 on a fourth after the
  reader-canon tightening; the residue is the safe direction (over-knowing a fact nearly earned,
  not the narrator hiding one already learned). `last_seen` coverage — the other most-missed
  update — ran 39/40 · 60/60 · 38/40 across runs, i.e. ~95%+ and never the cause of a rejected
  diff. Invented ids: **0 in every run** — worth knowing, because one would throw a whole diff away.
- **READING EVERY DIFF OF A REAL STORY** is what found the rest, and NONE of it reproduced on short
  fixtures — the pre-tune prompt scores 32/32 on the isolated versions of all of these. They only
  appear once a ledger has accumulated. Found: canon minted from a QUESTION ("[C6] Wren asked Maren
  directly if she is putting out the lamps" — permanent, append-only, from a turn that asserted
  nothing) and later from an ACTION ("[C3] Wren walks from the quay to the lighthouse via the shoal
  path" — that is where she went, not a rule of the world); a character's DENIAL written into
  `known` while that very fact sat on the HIDDEN list, the ledger contradicting itself; and `known`
  growing five entries a scene to 38 by turn 15, every one re-read forever. Prompt rules fixed all
  of them — the reader-assertion section now carries three WORKED EXAMPLES (question / action /
  statement) because naming the categories abstractly left the action case failing 1-in-8. A
  regression battery for exactly these, `--habits`: **39/40 before the worked examples, 50/50
  after**, with the `known` bloat down to 20 entries at the same 15 turns and denials correctly
  recorded as "Maren SAYS she is not…".
- **THE max_tokens BUG, and it is the one worth remembering.** Three consecutive keeper failures
  mid-playthrough were invisible to every isolated test — 12/12 clean by direct POST, 8/8 clean
  through the client — because the untested variable was SCENE LENGTH. On a long, event-dense scene:
  **7 of 8 truncated MID-JSON at the plan's sketched 600 tokens, 0 of 8 at 1200.** The failure is
  silent and total (unparseable → fail-open → that scene's bookkeeping simply gone), and output
  tokens bill only for what is produced, so the headroom is free on ordinary scenes. A short-scene
  fixture will never reproduce it: do not lower `MODES.ledger.maxTokens` without re-measuring on a
  long one.
- **A PROBE FINDING, NOT A PRODUCT BUG, and it cost three runs**: every `--play` run stopped dead at
  exactly 15 turns. That is `STORY_DAILY_CAP` — the client counts every scene it renders, so a
  20-turn probe walks into the "you've read a LOT today" notice and correctly refuses to continue.
  The probe now identifies as **Dad**, the one identity exempt from the cap on both sides (it still
  sends no `user` on the wire, so the server counts and logs nothing either way). Worth remembering
  for any future long automated playthrough of story mode.
- **THE FINAL 20-TURN RUN, everything in**: 20 scenes, **20/20 keeper diffs applied, 0 not applied**,
  diff log 20 entries for 20 scenes and ordered, 3 promotions (hidden → suspected → known, the
  ladder walking on its own), the redo landing its note as the run's ONE reader-canon rule
  ("Bramblewick has a wooden leg."), 0 canon minted from a question, 0 denials in `known`, 0 leaks,
  0 page errors, ledger valid, 22 known entries / 8047 bytes on the wire.
- **ONE MORE BUG, caught by reading that run's diffs rather than by any test**: the keeper
  re-reports a fact it has already moved, and PARAPHRASES when it does — so a "…to known" for
  something already sitting in `suspected` matched nothing (it was no longer hidden) and landed a
  SECOND copy of the same secret in a second bucket. The narrator was then told the reader both
  knew it and merely suspected it. `promote_knowledge` now fuzzy-matches the OTHER rungs too, moves
  the ledger's own wording between them, and refuses to regress a known fact back to suspected.

## Suites
`tools/_verify-storyledger.cjs` **374/374**, 0 page errors — same house pattern (in-process handler
+ fake Anthropic/Google/Firestore for the wire; real Chrome over a local origin for the client).
New: A8-A11 (the keeper's wire, no-cap/no-log, its edges, reader-canon precedence for the narrator),
G (promote_knowledge incl. both rungs and wholesale rejection), H (the keeper: the happy path with
THE test — a secret learned on the page moves HIDDEN → KNOWN — then **eight failure modes one at a
time**, a timeout, the queue, and a redo racing a keeper), I (reader canon minted, persisted and
un-editable; the model downgraded on a non-asserting turn; redo's log truncation and ledger rewind;
replay-after-redo reproducing the live ledger EXACTLY; the shelf shedding `ledgerPrev` first).

**KNOWN / DEFERRED**: `known` still grows ~1.5 lines a scene, which is fine at 20 turns and wants
step 5's compaction by 100; `ledgerPrev` is a ONE-step undo, so redo replaces the last scene only;
and the probe's leak tripwire only fires while a fact is still hidden (once promoted the narrator is
entitled to play with it, and flagging that would be flagging the feature working).

---

# 📖 STORY TIME CONTINUITY — caching + the operating loop, steps 4-5 (2026-08-03, UNPUSHED)

Plan of record: `storytime-continuity-plan.md`, build steps 4 and 5, both now ticked — **the
continuity engine is complete**. Files: `netlify/functions/farmgpt.mjs`, `farmgpt.html`,
`tools/_verify-storyledger.cjs` (374 → **457**, 0 page errors), new `tools/_probe-storycache.mjs`
and `tools/_probe-storystep5.mjs`. Everything below was MEASURED or run against real models, not
reasoned about. Built on top of the parallel session's WIP; none of its hunks were touched.

## Step 4 — caching: the answer is 0.0%, and that is the finding

Step 2 chose the prompt block order FOR caching and never observed a cache field. So this step read
what the API actually reports. `tools/_probe-storycache.mjs` wraps global `fetch` before the
function module is imported, tees each upstream SSE response, and records
`cache_creation_input_tokens` / `cache_read_input_tokens` per request — narrator and keeper
separately — across a real 6-turn story driven through the real page. It also fingerprints the
system prompt and `messages[0]` per turn, so a zero hit rate can be **explained** rather than just
reported.

| real 6-turn story, real Haiku | input | cache write | cache read | hit rate |
|---|---|---|---|---|
| narrator | 3,777 | **25,919** | **0** | **0.0%** |
| keeper | 20,436 | 0 | 0 | 0.0% |

- **The narrator was paying a pure surcharge.** A cache WRITE bills at 1.25x input, so 25,919
  written-and-never-read tokens is **+21.8% on input for nothing**.
- **WHY IT CAN NEVER HIT.** The top-level flag auto-places ONE breakpoint on the last cacheable
  block, so the cached entry is the WHOLE prompt — and a story's prompt is never byte-identical
  twice. The probe's fingerprints show `messages[0]` changing every single turn: the keeper rewrites
  `last_seen` on the "stable" ledger half every scene, and cast hydration reshapes that half **by
  design** the turn a character first appears. (The system prompt also flips between two hashes —
  that is `shouldIllustrate()` appending `STORY_ILLUSTRATION` every third scene.)
- **A SYSTEM-ONLY BREAKPOINT DOES NOT RESCUE IT, and this was measured, not assumed.** Sent as a
  cache-controlled block on its own, the narrator's system prompt is 2,839 tokens and the keeper's
  2,215, and **both write nothing** — under Haiku 4.5's minimum cacheable prefix. The playthrough
  brackets that minimum independently: no write at 3,762 tokens, a write at 4,334. The documented
  figure is 4,096. **The minimum is not monotonic across models** — 1,024 on Sonnet 5, 4,096 on
  Haiku 4.5 — so "it caches on Sonnet" tells you nothing about Haiku.
- **THE CHEAP FIX, TAKEN**: `cache_control` is now per-mode (`MODES.<mode>.cache`, default on),
  **off for `story` and `ledger`**, unchanged for research and dungeon — where the prefix genuinely
  is append-only, the system prompt is large, and the model is Sonnet. The dungeon entry's claim
  that a pasted module re-reads at ~10% after the first turn is therefore intact.
- **THE EXPENSIVE FIX, NOT TAKEN, and this is the recommendation**: the spec's stabilized/split
  ledger would mean giving up cast hydration (a character moving from roster to full sheet IS a
  prefix change) to buy back roughly **$1/month at the family's absolute ceiling**. The plan's own
  rule is "no stabilized-ledger engineering until costs demand it"; they do not. REVISIT only if
  story moves to Sonnet AND the stable half is made byte-stable.

## Step 5a — compaction: one principle, and everything follows from it

> **COMPACTION NEVER DELETES A FACT FROM DISK.** What it removes from the STORED ledger is only
> structure already rewritten losslessly elsewhere in the same ledger. Everything else is shaping
> for THE WIRE, with the stored copy left whole — exactly like cast hydration.

That is what makes it reversible-safe, and it is asserted rather than assumed.
- **Resolved threads fold** into ONE timeline line carrying the thread's own sentence verbatim, then
  leave `open_threads`. Stored, deterministic (a pure function of the ledger — it reads `meta.turn`,
  never a clock), and **idempotent**, which is what lets it run inside every `applyLedgerDiff` so a
  replay folds at the same moments and `seed + diffs` still reproduces the live ledger BYTE for
  byte. The fold also had to teach `resolve_threads` tolerance: the keeper re-reports a resolution
  it has already reported, and without recognising an already-folded id that would throw away a
  whole otherwise-good diff (a genuinely unknown id still rejects it).
- **Dormancy is ONE MORE CONDITION on the on-stage test hydration already uses** — deliberately, so
  the two compose instead of fighting. Hydration asks "has this person ever appeared?"; fifty turns
  later the honest answer is "yes, long ago", and a full sheet for someone the story left behind
  costs the same bytes as a never-met one. Past `DORMANT_AFTER` 20 turns a character drops to a
  roster line **marked with `lastSeen`** — load-bearing, because the roster block otherwise tells
  the narrator that someone it has already written scenes for has never been on screen — and
  **rehydrates automatically** the turn the keeper moves `last_seen`. An unresolved thread naming
  them overrides dormancy. **Nothing is removed from disk.**
- **Stale places and a runaway KNOWN list, wire-only**: a place unvisited for 20+ turns travels as
  name + current state without its description (a place with no recorded `state` keeps it — a bare
  name tells the narrator nothing), and `known` is capped to its newest 24 (it grew ~1.5 lines a
  scene in the step-3 live runs and is most of the volatile block by turn 100).
- **MEASURED on a synthetic 120-scene story** (a timeline line, a known fact and a thread every
  scene, a character every tenth, a third of threads resolving): stored **28,651 bytes** — inside
  the 30KB cap — wire **9,843**, every canon rule and every character intact, every character still
  reaching the narrator in some form, and the whole run replaying **byte-identically**.
- KNOWN LIMIT, and it is the pre-existing timeline shedding rather than a new one: once a ledger
  nears its cap the budget compaction drops timeline entries oldest-first, folded thread lines
  included. The guarantee is "a folded thread keeps its sentence until the whole timeline is being
  shed", and the suite checks a RECENT fold for exactly that reason.

## Step 5b — go back: rewind and branching on the diff log

The primitive has been sitting there since step 1 (`ledger@N === seed + diffs 0..N`); this makes it
a reader-facing feature. A 🕰 **go back** button on the same bar as the redo affordance opens a list
of the choices the reader made, newest first; picking one confirms, then unwrites that scene and
everything after it, leaving the reader standing at that choice again.
- **`story.ledgerSeed` is new and load-bearing** — the world at turn 0, stored at creation and never
  written to again. Without it there is nothing to replay onto, so a story that predates the field
  **refuses honestly** instead of guessing at a starting world. It is shed LAST under shelf
  pressure and never from the book being read (it never grows, so it is rarely what put the shelf
  over).
- **THE OLD VERSION IS ALWAYS KEPT**, on the shelf under its own id as "<title> (the old way)".
  Going back is the one action here that destroys reading the family already did, so nothing is
  destroyed and there is no decision to make.
- What moves together, all asserted: the transcript (cut to end on a scene, so the choices are
  offered again), the diff log (cut to match, still one entry per scene with no gaps), `meta.turn`,
  the chapter number (recomputed), the `closing` latch, `ledgerPrev` (redo's undo pointed at a scene
  that no longer exists), and `keeperGen` — bumped, so a keeper still in flight abandons instead of
  stamping its diff onto an index that now belongs to a different scene.

## Step 5c — the contradiction audit (Dad only)

Server mode **`"audit"`**: Sonnet (a reasoning job over a whole story, read by a parent deciding
whether the engine works — the cheapest place to be wrong), its own `STORY_AUDIT_SYSTEM`, its own
single turn built SERVER-SIDE from `ledger` + `transcript` (same reason as the keeper's: a 28KB
ledger inside a message would be sliced at `MAX_CONTENT_CHARS`), **no daily cap, no Story Log** —
both gates are `mode === "story"`-only, so this is structural rather than a new exception. Usage
lands in a new bucket **`c`** with a 🔎 row and column in the dashboard. `cache:false` — a one-shot
call's cached prefix is never read.
- It gets the FULL ledger **including the timeline**, which the narrator never sees, because the
  timeline is precisely the audit trail a contradiction is checked against.
- The client page is Dad-gated exactly like the Story Log, lists the shelf (stories live only in
  this device's localStorage — there is no server story store), and renders findings by severity
  with the evidence a parent can check for themselves.
- **The keeper's accumulated `notes` are surfaced alongside**, plus any scene whose bookkeeping
  failed outright. `notes` is free text the diff format has always allowed and nothing had ever
  displayed — it is the bookkeeper's drift alarm, written at the moment it was unsure.

## LIVE — what the real models actually did
`node tools/_probe-storystep5.mjs [--rewind N] [--audit]` (real function in process, real key,
Firestore dead-hosted, probe identifies as **Dad** or the 15/day cap stops it at turn 16).
- **REWIND, a real 7-scene story**: rewound to scene 3 and every diff printed before and after. The
  rewound ledger is **byte-equal to a fresh replay of seed + surviving diffs**; the discarded
  version landed on the shelf whole (7 scenes); a different choice from the same moment produced a
  new scene with the log still gapless at 4/4 and the turn counter following. 0 page errors.
- **AUDIT, against three planted contradictions** (canon: nobody in Saltmere can swim, and the hero
  swims the channel · voice: warm wandering Maren speaking "clipped and short, the way Bramblewick
  would have" · a hidden fact the prose gives away): it found the canon break at HIGH severity with
  both quotations, found the voice break, AND found a real one nobody planted (the lighthouse
  recorded as lit while the scene ends with its lamp doused). **The control — the same world, a
  story that breaks nothing — returned ZERO findings**, which is the half that matters most: a
  checker that invents contradictions is worse than none.
- ONE PROMPT ITERATION, and it was worth it: the first live run found only the canon break. Adding a
  HOW TO WORK section that walks the ledger's lists in turn ("every character's VOICE: read their
  actual dialogue… the obvious break is rarely the only one") took it from 1 finding to 3 with the
  control still clean.

## Suites
`tools/_verify-storyledger.cjs` **457/457**, 0 page errors. New: **A12-A13** (the audit's wire —
its own system prompt with neither of the others leaking in, Sonnet, server-built turn, the timeline
included, no cap consumed, no Story Log written, usage in bucket `c`), **A14** (caching: the wire
facts asserted, the MEASURED numbers **reported not asserted** — cache behaviour depends on a
5-minute TTL and a model-dependent minimum, and an assertion on it would be a flaky test rather than
a useful one, the same treatment the pack-size measurements get), **J** (compaction: fold /
idempotence / re-report tolerance, replay identity across a fold, stale places, the KNOWN cap, disk
untouched, and the 120-scene simulation), **K** (rewind: points, truncation, `meta.turn`, chapter,
`keeperGen`, the shelf copy, refusals at both ends, a real branch, and THE test — the replayed
ledger byte-equal to a fresh play), **L** (the audit client: transcript building, keeper notes, JSON
tolerance, Dad gating, and the whole flow against a stubbed report).
Regressions: `_verify-kidstory-server.mjs` 54/54, `_verify-dnd-server.mjs` 47/47.
**RESTAGED, each with its reason in the file**: "prompt caching still requested" → story now asks
for NO breakpoint; two "a thread is resolved" checks → a resolved thread is now folded into the
timeline, so the same fact is checked where it now lives; the hydration battery's long-story case →
its fixture puts five characters 55 turns past their `last_seen`, which is exactly what dormancy
exists for, so it now asserts the dormant round trip instead; and the redo bar lays out as `flex`
rather than `block` now that it carries two affordances.
**TEST GOTCHA worth keeping**: every page in this suite shares one browser profile and therefore one
localStorage. Two things in it are cumulative and will silently break a later section — the daily
story counter (past `STORY_DAILY_CAP`, `takeTurn` stops doing anything at all, with no error) and
the bookshelf. Sections that drive many turns now clear both.

**KNOWN / DEFERRED**: the audit still misses the subtlest plant (a hidden fact the prose gave away)
about as often as it catches it; a story created before this step has no `ledgerSeed` and cannot be
rewound; and the shelf copy a rewind leaves behind counts against the 20-book cap like any other.

---

# 📖 STORY TIME CONTINUITY — landed on main (2026-08-03)

The four sections above were built on a base copy of `farmgpt.html` / `netlify/functions/farmgpt.mjs`
that was ~1,385 lines behind `origin/main`. Copying those files over main would have reverted three
other sessions' shipped work, and a branch merge produced 15 unrelated add/add conflicts across
fitness/news/castlekruzer. So the engine was landed as a NARROW three-way merge instead —
base = the ledger session's own HEAD, ours = `origin/main`, theirs = the ledger working tree — on
those two files only. **16 conflict hunks in the page, 5 in the function**, each resolved by hand.
Everything else in the branch is a new file.

**FIVE THINGS THE MERGE HAD TO DECIDE, and why:**
- **THE `c` USAGE BUCKET WAS ALREADY TAKEN.** The audit shipped writing `c_in/c_out/c_req` on the
  shared `farmgpt_usage` doc — and main's Meals calorie estimator has owned "c" there since
  2026-08-01. Two modes incrementing one bucket makes BOTH dashboard rows lie, and Firestore
  increments are not separable after the fact. The newcomer moved: **the audit is bucket `x`**
  (server map, `usageRow`'s read list, `rowCost`, `tokTotal`, the monthly split row, and the daily +
  hourly 🔎 columns). The suite assertion moved with it and now also pins that it is NOT "c".
- **TWO SESSIONS BUILT REDO INDEPENDENTLY.** Main has a typed one (`REDO_RE` / `tryRedo` — a
  write-in starting "redo…" splices the rejected scene out); the ledger has the ↻ button
  (`redoScene`, which additionally bumps `keeperGen` and truncates `ledgerDiffs`/`meta.turn`). Main's
  splice is CORRECT for a legacy story and CORRUPTING for a ledger one — `ledgerDiffs[N]` describes
  scene N, so a scene removed without its entry shifts every later replay and silently breaks 🕰 go
  back. `tryRedo` now delegates to `redoScene` when `hasLedger(story)`, and keeps its own body
  verbatim otherwise. Both roads, one destination.
- **BOTH SESSIONS EXTRACTED THE SAME PAINTER.** Main called it `paintTranscript()` (closes over the
  global `story`), the ledger `paintStoryScroll(s)`. The ledger's is a strict superset — it also
  renders a redo note left on the next-chapter sentinel, and validates a malformed ledger on resume
  — so it won, and main's one call site was repointed. (The auto-merge left one `story.messages`
  inside the `s`-parameterised body; caught by reading, not by a test.)
- **`SEND_CHAPTERS` IS MAIN'S KNOB, 6 NOT 4.** Main raised it for stronger continuity. The suite's
  legacy-window checks were written against a hardcoded 4 and a 6-scene fixture, which at 6 makes
  the whole transcript short enough to skip the recap path entirely — two failures that were the
  TEST being stale, not the code. The fixture is now sized off `S.SEND_CHAPTERS` and asserts against
  it. Ledger stories are unaffected: they travel on `SEND_SCENES = 3`.
- **THE PARALLEL SESSION'S WORK WAS ALREADY ON MAIN, and newer.** The story-log summary engine
  (`buildStoryLogCard`, `STORY_LOG_SUMMARY_SYSTEM`, the summary job) appeared on BOTH sides — main's
  version retains raw scenes as a 90-day readable transcript and has the refined flagging prompt, so
  main's won outright in both files (a 640-line hunk and a 106-line one).
Also merged rather than chosen: the `views` map (main's `teacher` + the ledger's `audit`), the
`sceneIdx` source (main's monotonic `story.sceneSeq` + the ledger's chapter-note-aware choice label),
the resume path (`isNextChapterTurn(...) || !!last.opener`), and `rowCost` (main's Sonnet-priced `u`,
`c`, Opus `t` + the ledger's `l` and `x`). The 🔎 audit button joined main's compact `#dadRow` pill
row rather than restoring the old stacked block.
**GOTCHA:** the ledger session wrote `farmgpt.mjs` with CRLF endings while main is LF, so the first
three-way merge reported "1 conflict" that was really the whole file. Normalise line endings before
trusting a merge-file count. Shipped LF, matching main.
**VERIFIED on the merge:** storyledger **457/457** · kidstory-server **54/54** · dnd-server **47/47**
· news **157/157** · fitness **253/253** · activity **147/147** · beacon-safety **90/90**, plus a
headless farmgpt.html boot at 390×844 and 1280×800 (0 page errors, all 16 hook functions and all 8
views present, home still fits one screen: 658/844 and 698/800) and a usage-dashboard render with
mocked stats (10/10 columns on both tables, all 11 mode rows, no sideways body scroll). LIVE against
real Haiku through the merged function AND the merged page (`_probe-storykeeper.mjs --promo 3
--play 4`): 4 scenes, 4 keeper diffs applied / 0 failed, a promotion fired, diff log 5 entries for 5
scenes in order, final ledger valid, 0 page errors.
**KNOWN, pre-existing, NOT introduced here:** main's `usageRow` never reads the `t_*` (TeacherGPT)
prefix it writes, so that dashboard row always shows zero. Left alone — it is another session's
feature and a one-word fix belongs with them.


## ⚠ THE FIELD-PATH BUG — twelve hours of silence (2026-08-04)

Shipped 2026-08-03 with 147/147 green; recorded NOTHING for twelve hours. Root cause: the
counter fields were named `03_news_v`, and **Firestore rejects any unquoted property path
that does not match `([a-zA-Z_][a-zA-Z_0-9]*)`** — every commit came back HTTP 400. They are
`d03_news_v` now, and that leading `d` is load-bearing, not decoration.

TWO THINGS HID IT, both fixed here:
1. **The fake Firestore was more permissive than the real one.** It stored whatever field
   name it was handed. A mock that accepts what the real service rejects is worse than no
   mock — it manufactures confidence. It now enforces the same grammar and answers the same
   400, so this exact bug fails the suite instead of passing it.
2. **`log` always returns 200** (correct — it is a beacon on a page someone is mid-use of),
   so the 400 was swallowed into a `reason` field nobody read. Diagnosis was one curl against
   production: `{"ok":true,"wrote":0,"reason":"http-400"}`. **`wrote:0` is the tell** — when
   this dashboard looks empty, curl the live `log` action before touching any code.

NEW SUITE: `node tools/_verify-activity-live.mjs` (9 checks) sends the function's REAL write
to REAL Firestore, reads it back, proves two commits ADD rather than clobber, and deletes
after itself. It uses the scratch collection `diag_activity` and the public web key — never
`bucky_activity`, never the service account. A fake can only ever encode the rules we already
know about, so run this whenever the write shape changes.

THE SHELL GOTCHA, AGAIN (this file already warned about it and I still hit it): appending
this very entry with `node -e "..."` containing backticks let bash run command substitution —
it EXECUTED the verify script and spliced its output into the docs. Use a quoted heredoc
(`<< 'EOF'`) or the Edit tool for any text containing backticks.

---

# 📖 STORY TIME — THE SHIPPING STACK: Fable seeds, Grok narrates, Haiku keeps the books (2026-08-04)

The comparison experiment is over and its result is now the default. `farmgpt.html` +
`netlify/functions/farmgpt.mjs`; suite `tools/_verify-storyledger.cjs` **545 → 602**; new live
probe `tools/_probe-storyship.mjs` and plate script `tools/_shot-usage-before.cjs`.

## The stack, and why each seat is filled the way it is
- **NARRATOR = grok-4.5.** `STORY_PROVIDER` defaults to `"grok"` (was `"haiku"`). Approved on the
  measured prose comparison.
- **SEEDER = Fable 5.** `STORY_SEED_PROVIDER` defaults to `"fable"` (was UNSET = dormant); `off` /
  `none` / `0` / `false` switch it back off. The client's `?seed=1` opt-in is gone — the flag now
  reads `!== "0"`, so `?seed=0` or `localStorage farmgpt_seed="0"` forces it off for testing.
- **THE KEEPER STAYS ON HAIKU 4.5, and this is the load-bearing negative result.** Grok's keeper
  scored 40/40 on judgement but ran a **median 47.8s against the client's 45s abort** and lost
  **3 of 8** scenes' bookkeeping in a real run. `KEEPER_PROVIDER` exists so that can be
  re-measured; it must stay defaulted to haiku. A bookkeeper that is right but late is worse than
  one that is merely good, because the failure is silent — the diff is simply never filed.
- Audit unchanged (Sonnet). Research unchanged.

## EVERY xAI ROUTE DEGRADES BY ITSELF — proven both ways, live
A Netlify site that has this code but no `XAI_API_KEY` is a working site, just a Haiku-narrated
one. Two independent guards:
1. **Before the request is built**: `provider === "xai" && !XAI_API_KEY` resolves back to
   Anthropic. No 500, and nothing is said to the reader.
2. **After it fails**: `openUpstream()` was extracted so a whole attempt — including a non-ok
   STATUS, not just a thrown fetch — is retryable, and a failed story-mode attempt is retried ONCE
   on Haiku. Deliberately **story-only**: the seeder already fails open into an ordinary story
   start, the keeper is on Anthropic anyway, and silently swapping the model under research or
   dungeon would hide a real misconfiguration instead of protecting a reader.
Live-verified with xAI pointed at a dead socket, at a 429, and with the key deleted outright: a
real Haiku scene arrived every time, with its choices, and the usage was billed to **the model
that actually wrote it** (`s_claudehaiku45_req`), not the one we asked for.

## ✨ FIVE MORE SCENES — the reader's own once-a-day grant
At the cap the screen used to just stop. It now offers **five more scenes to reach a stopping
place**, once per reader per Central day. `farmgpt_story_finish/<date>__<bucket>`, keyed on the
same `canonStoryUser` bucket the cap uses (a renamed profile shares one grant — this house has
already had that exact bypass in production). **Server-enforced by a
`currentDocument:{exists:false}` precondition**, so a second tap, or a second device racing the
first, LOSES the write and gets `{already:true}`. 15 + one grant = 20, and no more.

**IT IS A DESCENT, NOT SIMPLY MORE STORY.** The server computes how many granted scenes remain
from its OWN count — never from the client, which could lie about it — and injects
`STORY_FINISH_SOON(n)` ("about N more scenes remain… do NOT introduce a new mystery, enemy, place
or problem") on the LAST USER TURN. The final one gets `STORY_FINISH_LAST`, which forbids choices
and demands a real `===CHAPTER END===`, so the shelf shows a clean boundary. Live against real
Grok, the last granted scene came back as a lamplit landing with soup and "whatever strange quiet
had settled over the boats could wait until morning", then `===CHAPTER END===`. Once the five are
spent the message changes from "come back tomorrow" to a warm goodnight, and the offer does not
come back.

## ✂️ THE TRUNCATION BUG — it was the token ceiling, and the measurement says so
Reported live: scenes arriving cut off mid-sentence with **no `===CHOICES===` at all**, stranding
the reader (2 of 8 in one run; a third offered 2 choices). Measured directly against both real
APIs on the same ~900-word prompt:

| max_tokens | Haiku stop reason | Grok stop reason | choices? |
|---|---|---|---|
| **1200** | `max_tokens` (1200 out) | `length` (1200 out) | **NO** |
| **1600** | `end_turn` (1210 out) | `stop` (1197 out) | **yes** |

A 900-word scene wants ~1200 tokens, which sat exactly ON the old ceiling — hence the
intermittency. `MODES.story.maxTokens` 1200 → **1600**. Output bills only for what is produced, so
the headroom is free on an ordinary scene. Three defences, in order:
1. the bigger budget, which lowers the rate;
2. **`repairIfTruncated`** — a choice-less reply triggers exactly ONE repair call, never a loop:
   the half-scene goes back as the assistant turn it is, `STORY_REPAIR` rides the last user turn
   asking for the tail only, and the halves are joined at the break. It carries **no `user`
   field**, so it costs no scene of the daily cap and writes no second Story Log doc. A repair
   that also comes back truncated is DISCARDED rather than adopted;
3. **"▶ Keep going"** — a choice-less scene still renders a tappable control beside the write-in
   box. The reader is never stranded, whatever the cause.
Provider-agnostic by construction: the test is on the REPLY, not on who wrote it.

## 📊 THE USAGE DASHBOARD — cost follows the MODEL, not the mode
**The bug this had to fix first**: the moment story mode moved to Grok, every figure on this page
became silently wrong, including for months already closed. So `logUsage` now writes each record
TWICE in one commit — into its mode bucket (unchanged, so every existing row keeps working) and
into `<bucket>_<modelSlug>_*`. A row's cost is Σ(per-model tokens × that model's real rate) + the
REMAINDER priced at the mode's historical rate. For a row written before today the breakdown is
empty and everything falls to the old rate; for a row written after, the remainder is exactly
zero. **A closed month does not move** — verified, 2026-07 still prices at $0.20.
- Rates: Haiku 4.5 $1/$5 · Sonnet 5 $3/$15 · Opus 5 $5/$25 · Fable 5 $10/$50 · **grok-4.5 $2 in /
  $0.30 cached / $6 out** (docs.x.ai, re-verified — those are the <200k-prompt rates; ≥200k
  doubles, and our prompts are ~8k).
- **QUIET ROWS FOLD BY RULE, not by a list**: under 1% of the month's cost AND under 2% of its
  requests → a single 🧩 **Other** line that NAMES what it swallowed, with story and research as
  an always-show floor. The rows (Other included) reconcile to the headline — a table whose rows
  do not add up is its own bug, and the suite asserts it to within a cent per displayed row.
- **`t` (TeacherGPT) and `f` (the seeder) added to `usageRow`.** `t` is the pre-existing bug the
  last session flagged and left for its owner: `logUsage` wrote `t_*` faithfully and nothing ever
  read it back, so that row always showed zero however much Opus it had burned. Picked up here on
  request.
- Fixed while measuring: `sum()` did `a + d[k]`, so a day's document missing a bucket rendered the
  whole column as **NaN**. The `|| 0` there is load-bearing, not defensive habit.
- BEFORE → AFTER on the same fixture month: **11 rows (five of them reading "0 requests"), $4.51,
  story mislabelled "Haiku 4.5", no seeder row at all** → **five rows + Other, $6.00, every row
  naming the model that did the work**. Plates `shots/st_usage_{before,after}{,_mobile}.png`;
  390px verified (main's `scrollWrap` work intact, the page never scrolls sideways).

## ⚠️ LATENCY — the thing to watch after deploy
Measured through the real function, streamed:

| | TTFB | total | words | choices |
|---|---|---|---|---|
| **grok-4.5** | 4.0–13.2s | **23–29s** | 478–536 | 3 ✓ |
| **haiku** (fallback) | 0.7–1.6s | 12.2s | 622–730 | 3 ✓ |
| **Fable seeder** | **~14s** | **~52s** | (a whole world) | — |

**Netlify documents a 10-second synchronous function limit, and says a streaming response STOPS
when it is reached.** The live app has been serving ~12s Haiku scenes successfully, so the
effective limit on this deployment is demonstrably higher than the documented one — but nobody has
proven it is higher than 29s, and the seeder at ~52s is the biggest exposure. Mitigations are
already in place: the repair pass recovers a cut-off scene whatever cut it, and
`seedLedgerWithAI` now has a **75s AbortController timeout** whose expiry is just another
fail-open (the story starts on the ordinary pack/empty ledger). If Grok proves too slow in
production the rollback is one env var: `STORY_PROVIDER=haiku`. Grok also writes noticeably
SHORTER scenes than Haiku (478–536 vs 622–730 words) — worth reading a few before concluding it is
the better narrator for the kids.

## 🔑 NETLIFY ENV VARS THE USER MUST SET BY HAND
Exactly **one**, on purpose — everything else is a code-side default, so shipping the code and
enabling the feature are one step rather than two:
- **`XAI_API_KEY`** — from console.x.ai. **Without it the site still works**, on Haiku, silently.
Nothing else is needed. `STORY_PROVIDER`, `STORY_SEED_PROVIDER` and `KEEPER_PROVIDER` all default
correctly in code and exist only as overrides and rollbacks.

## Verified
storyledger **602/602** · kidstory-server **54/54** · dnd-server **47/47** · news **157/157** ·
fitness **253/253** = **1,113 checks, 0 page errors**. New suite sections: A16 (Grok default +
the outage fallback), A17 (the grant), A18 (the repair directive), A19 (usage buckets), M (repair
in the browser), N (the grant UI), O (the dashboard).
**RESTAGED, each with its reason recorded in the file, never bent**: story `maxTokens` 1200 →
1600; the seeder's "dormant by default" block → "on by default, and still switchable off"; "grok
with no key fails loudly" → "degrades to Anthropic" (no-key is the state every deploy is in until
the key is added, and a reader must never meet it); the keeper-independence check now pins the
NARRATOR to Haiku and proves the keeper stays on Grok (the old form was really asserting the old
haiku-by-default narrator); and kidstory-server's "big-kid story unchanged (Haiku, 1200 tok)" →
1600 tokens with Haiku as the fallback.
LIVE, against real Fable + real Grok + real Haiku, with a fake Firestore so nothing touched the
family's data: `node tools/_probe-storyship.mjs [--gate seed|narrate|grant|fallback]` — 6/6,
12/12, 16/16, 5/5.

**TEST-HARNESS NOTE worth keeping**: the suite's fake Firestore grew a real document store — it
honours increments AND the `exists:false` precondition — because "once per day" cannot be
demonstrated against a mock that accepts every write. That is the same lesson the activity
field-path bug taught two entries above: a mock more permissive than the real service manufactures
confidence. Also, `clearFlags()` does NOT clear `XAI_API_KEY`, so any section that wants to read
the narrator's prompt off the Anthropic fake has to delete it first — three checks failed on that
alone.

**KNOWN / DEFERRED**: a repair sends no `user`, so Dad's Story Log keeps the TRUNCATED half of a
repaired scene (what the model genuinely produced) while the reader saw the mended one; the grant
is five scenes and once a day, with both numbers as server constants rather than settings; and the
seeder's ~14s time-to-first-byte is the one number to re-check on the real host after deploy.

---

# 🩺 STATUS — the ops dashboard (2026-08-04)

`status.html` (Dad-only, unlinked/direct-URL like `activity.html`/`leveleditor.html`) answers
one question: *"everything I've signed up for or paid for that could go dark and break one of my
tools."* Server half `netlify/functions/health.mjs` (its own top-comment is the API contract —
read that first, not this). No new env vars are REQUIRED — the page works and tells the truth
with zero of the optional ones set.

**THE REGISTRY IS THREE TIERS**, rendered as three sections in this order: 💳 **paid**
(Anthropic/xAI/Gemini/Netlify/Firebase/ElevenLabs/Tripo — an account with a bill or a login) ·
🔌 **free** (Open-Meteo/RainViewer/IEM HRRR/Yahoo Finance/jsDelivr/unpkg×2/gstatic/Google
Fonts — no account, but Bucky depends on them staying up) · ⚙️ **self** (this site's own sibling
functions, pinged with a harmless malformed request — farmgpt/news/stocks/calendar/activity/
goats/notify/teachergpt-background/chorereminders). Every row carries its own `breaks[]` list
("If this dies: …") — that mapping from "this account lapsed" to "here's what a kid notices
broken" is the entire point of the page, not a nice-to-have.

**UNCONFIGURED IS A FIRST-CLASS STATE, not an error.** A paid service with no key set renders as
a grey OUTLINE dot (visually distinct from "unknown"'s grey FILLED dot) with a dashed "🔧 How to
wire it" box carrying the server's `configHint` verbatim — literally which env var to add and
where to get it. Most of the paid tier is OPTIONAL (xAI/Gemini/ElevenLabs/Tripo — Story Time and
dev-time asset generation quietly degrade without them) and the page says so in plain words
rather than painting them red. Only Anthropic/Netlify/Firebase are load-bearing.

**OPTIONAL ENV VARS Dad can add later** (none required to ship): `NETLIFY_API_TOKEN` (bandwidth
usage bar — a Personal Access Token from app.netlify.com), `ELEVENLABS_API_KEY`/`TRIPO_API_KEY`
(dev-time asset generation only — nothing shipped ever depends on these staying set),
`XAI_API_KEY` (Story Time's Grok narrator experiment — falls back to Haiku silently). Every one
of these renders its own `configHint` when absent; adding one later needs no code change, only
the Netlify env var + a redeploy.

**TWO PAID PROBES, NEITHER EVER AUTO-RUNS**: `firestore_usage` (free to call, per-collection doc
count/size table, `>= N` when a collection's walk hit its page cap — the number is a FLOOR, not
an estimate) auto-loads its CACHED result on page open (24h TTL) so Dad sees an age-stamped
number without doing anything; the "Measure storage" button forces a fresh walk.
`probe_anthropic_credit` (~1¢, one real completion) is different — it costs real money, so it
NEVER fires from a page load or a Re-check, only an explicit button click, and says so in the
UI ("This makes one tiny real request… about a penny. It never runs on its own."). A
`credit-low` result renders in its own red state naming exactly where to go
(console.anthropic.com) — the one status this page is loudest about, because it's the one that
silently breaks everything downstream first.

**CACHING**: `summary` is Firestore-cached 10 minutes (`settings_fam2jan2g/opsHealth`);
`firestore_usage` 24 hours (`settings_fam2jan2g/opsFirestoreUsage`). The client's own "↻
Re-check" button is the only thing that sends `force:true` for summary; page load always asks
for the cached copy first. A `cached:true` response still shows its real `generatedAt` age
("Checked 4 min ago (cached)") — never re-stamped to "just now".

**SECRET HYGIENE**: the function never forwards an upstream body verbatim (every probe writes
its own headline/detail from known-safe fields), and `redactSecrets()` scrubs every response
text for the literal value of every secret env var plus any Bearer token, as a backstop. The
client only ever sends the family password + an action name — it never sees a raw API key.

**HONESTY RULES the client itself follows**: a service marked `unknown` (chorereminders) shows
the server's own explanation of *why* it can't be probed (it's on a cron, not a request) rather
than just labeling it mysteriously. If the health function itself is unreachable (bad network,
non-200, unparseable body) the page shows a dedicated "Couldn't reach the health function" state
with a retry — never a blank page, never fabricated numbers. If a Re-check fails but a previous
summary is still in memory, the stale data stays on screen with a small inline note instead of
being replaced by an error.

**Layout**: same activity.html shell — 12-area two-row bottom nav / navy rail at ≥1024px, but
with NO nav entry ever marked active (this is a Dad ops tool, not one of the family's sections).
The Firestore table pans inside its own `overflow-x:auto` container so it never widens the page
on a phone (the same `.panner` convention as `activity.html`'s day chart and the API-usage page).

**Verify**: `node tools/_verify-health.cjs [--shots]` — **204/204**, 0 page errors. Sections A-N
are the pre-existing pure-Node server suite (127 checks, unchanged, in-process against realistic
fakes for every upstream). New sections O-T drive real Chrome against `status.html` with
`/.netlify/functions/health` ROUTE-MOCKED (77 checks): the Dad gate (incl. a non-Dad visitor
triggering zero fetches), dot colors/counts/breaks/configHint across an all-ok and a
warn+down+unconfigured+unknown mixed fixture, Re-check's `force:true` + repaint, the credit
probe's never-on-load/fires-on-click/credit-low-is-red contract, the Firestore table (incl. a
truncated `>= ` row and its panner), the fetch-failure retry state, and layout at 390×844 +
1280×800. Firebase blocked throughout (googleapis/firestore/firebase/gstatic) per house rule,
even though `status.html` never talks to Firestore directly itself.

**TEST GOTCHA worth keeping**: a button positioned near the bottom of a short (844px) viewport
can be brought "into view" by Puppeteer's auto-scroll while still sitting BEHIND this page's
`position:fixed` bottom nav (z-index 40) — a synthetic mouse click at that screen point lands on
the nav, not the button, and silently does nothing (no error, no page error, just zero effect).
Fixed with a `clickSafely()` helper that `scrollIntoView({block:"center"})`s before clicking —
used for every button in the suite, not just the one that first exposed it.

Shots: `shots/ops_desktop.png` (the mixed fixture — the interesting one), `shots/ops_mobile.png`,
`shots/ops_gate.png` (non-Dad).
# ⏳ STORY TIME — THE WORLD-CREATION WAIT SCREEN (2026-08-04, UNPUSHED)

User: *"because Fable takes some serious time to set up, the user doesnt really know to wait and
might get frustrated, a status bar would be helpful or even show the blank page and say the story
world is being created, please wait."* Files: `farmgpt.html` (a new view, a new module, a streamed
seeder) and `tools/_verify-storyledger.cjs` (602 → **683**), plus a new live probe
`tools/_probe-storyworld.mjs`.

## The rule the screen is built on: IT MAY NOT LIE
Every stage transition and every millimetre the bar moves is a REAL event — a request opening, a
character finishing, the first word of the story arriving. The bar is stages FINISHED over stages
total, so it is structurally incapable of moving without one. The only thing on screen that moves
on its own is the pulsing dot beside the running stage, and it claims nothing except "alive".
Stages are chosen from what will ACTUALLY happen: no pack, no notes stage; the seeder switched
off, no world stage. A bar over stages that were never going to run is the first way a progress
screen lies.

## THE SEEDER IS READ AS A STREAM NOW — that is what made the screen interesting
`seedLedgerWithAI` used to `await resp.text()`. The server already streams every model mode as
`text/plain`, so buffering threw away every event in the ~40s between the request and the world,
and those events are the only honest progress this screen has. It now reads the body with a
reader and calls back on two things: the FIRST BYTE (Fable thinks before it writes), and each
character or place the moment it is finished — `partialArrayObjects(raw, key)` walks balanced
braces inside a half-written JSON document and returns only the complete objects, so a name
appears on screen the instant the world-builder finishes writing it. Falls back to a plain read
where no body reader exists. The scanner is scoped BY KEY and is only ever called for
`characters` and `locations`, so it never walks `player_knowledge` at all.

## HOW SECRETS ARE GUARANTEED NOT TO LEAK
The seeder's whole point is planted secrets, so a leak here would destroy the feature. Three
layers, and the third is the one that earns its keep:
1. **An ALLOWLIST, not a denylist.** `WORLD_SAFE_FIELDS = {characters:["name","role"],
   locations:["name"]}`, read by name. Nothing is spread, nothing is iterated generically.
   `hidden_from_player` and `open_threads` are never read for display — only COUNTED, and a count
   ("3 secrets hidden for you to find") teases without telling, which is the nicest line on the
   screen.
2. **A phrase scrub.** `role` is model-written and CAN come back carrying a secret's own wording.
   Any candidate sharing a run of 4 consecutive words with a hidden secret or an open thread is
   dropped. WORD RUNS, not single words — a character's name appears inside their own secret
   constantly, and dropping the name would delete the feature to protect nothing. The suite's
   fixture plants the secret verbatim as a character's `role`: the allowlist alone does not save
   you there, the scrub does.
3. **Mid-stream, names only.** When a character arrives the secrets usually have not (they are
   written last), so there is nothing to scrub a `role` against. Streaming shows the NAME alone;
   the roles fill in at the end from the finished world, when the scrub has the whole list. A
   second beat, and provably safe rather than carefully safe.

The test is not "we filtered it": a sentinel watches every DOM mutation AND polls the painted text
every 25ms for the whole run, and the assertion is that the planted string was on screen zero
times over ~3,000 sampled frames. The live probe runs the same sentinel against real secrets.

## THE HANDOFF — the screen dies on the first word, not the last
`streamChapter` gained `opts.onFirstToken`, fired on the first chunk carrying visible prose. The
wait screen owns the storyteller's stage too and tears down the moment there are words, so it is
up exactly as long as there is nothing to read. For an opening scene the first readable text is
the chapter's own title, one chunk ahead of the prose — that is the right moment: the instant
there are words the child should be looking at them. It is a VIEW, not an overlay (`show()`
toggles views mutually exclusive), so it is structurally incapable of ending up painted on top of
scene one, and awaiting `streamChapter` in a `try/finally` covers the error path — a scene that
never arrives still lands the reader in the book with the storyteller's own toast.

## THE UNHAPPY PATHS ALL END IN A STORY
The seeder already fails open; the screen matches. A server error, a seeder switched off
server-side, a world that comes back as nonsense, a hung request — all of them simply mean less
to show, never an error a child can act on. `WORLD_SEED_DEADLINE_MS = SEED_TIMEOUT_MS + 4000`
races the seed at the FLOW level, so the screen can never outlive the seeder's own abort even if
something upstream wedges (the suite shrinks both clocks and exercises it for real rather than
asserting about constants). Backing out mid-build cancels: the screen's own 46px button and the
header link both abort the request and return to setup with no half-made story and nothing on the
shelf. Once the first page is being written the cancel goes away rather than lying about what it
can do — that request is in flight and already logged.

## MEASURED LIVE — what the child actually experiences
`node tools/_probe-storyworld.mjs [--runs N] [--universe httyd]` drives the real page through a
real creation against real Fable + real Grok (Firestore dead-hosted; the probe is Dad, so it
neither counts against the cap nor writes to the Story Log). Elapsed from the Begin tap:

| | original world (3 runs) | with the HTTYD pack |
|---|---|---|
| Fable's first byte | 4.5 / 5.2 / **21.0**s | 18.6–35.6s |
| first NAME on screen | 13.1 / 13.8 / **28.0**s | 24.4s |
| world finished | 39.7 / 43.6 / 53.4s | 41.9s |
| FIRST WORD (into the book) | 47.7 / 63.0 / 57.9s | 46.0s |
| scene finished streaming | 62.3 / 85.0 / 79.8s | 72.1s |

**Fable thinks for 4–21s on an original world and 18–36s on a packed one** (23KB of established
canon to read first), then writes for another 20–38s. Grok reaches its first word in 4–19s.
So: **~13–28s before there is anything to look at, ~46–63s to the first word, ~62–86s to a
finished opening scene.** Two design decisions came straight out of those numbers.
- **The reassurance ladder is SPLIT per phase** (`pre` at 9s and 25s, `post` at 18s and 40s from
  the first byte). One ladder would have described thinking while it was writing, or the reverse
  — a screen saying the wrong thing about what is happening is exactly what this set out not to
  do. `note()` swaps ladders on the real event. Reassurance never touches the bar.
- **The cast is capped at 8 characters and 4 places, with "…and 16 more to meet"** — the real
  HTTYD pack seeds 24 characters and unbounded that is a wall of names burying the once-only line
  and the way out under a scroll. Caught by a live run, not by reasoning.

## THREE BUGS THE WORK FOUND
1. **`paint()` discarded the stage's sub-line**, so any repaint put the generic text back over
   what a real event had just said — a screen that forgets what it told you reads as broken. The
   notes live in module state now and `paint()` reads them.
2. **Duplicate cast entries.** A pack names its people and the seeder is told not to name them
   again, but a model that does anyway put Bramblewick on screen twice. `worldReveal` dedupes by
   lowercased name, first entry (the pack's better wording) winning. Caught by a SCREENSHOT, not
   a test.
3. The reader's own entry read as *"Wren — the hero of this story — the reader's own character"*.
   It is now **"Wren — that's you!"**, sorted to the top of the cast; seeing your own name first
   is the best thing on the screen.

## Verified
storyledger **683/683** (was 602 — 81 new checks, every original one still green) ·
kidstory-server **54/54** · dnd-server **47/47**, 0 page errors. New section **P**: the filter
(allowlist, the phrase scrub, the planted-role trap, dedupe, the cap, counts-not-text), the
partial-JSON scanner, the live screen against a REAL chunked response served by the suite's own
static server (puppeteer's `req.respond` can only hand back a finished body, so the server grew a
scriptable `/.netlify/functions/farmgpt` route — armed only when a plan is set, so every other
section 404s on that path exactly as it always did), every unhappy path, the deadline for real,
cancel, "not on resume", 390px + desktop, and `prefers-reduced-motion`.
LIVE: `node tools/_probe-storyworld.mjs` — 4 real creations, all clean, 0 secrets on screen over
~12,000 sampled frames.
Shots: `shots/st_world_{mid_390,mid_desktop,handoff_390,handoff_desktop}.png`.

**KNOWN / DEFERRED**: the ~13–28s before the first name is the honest floor of a single
non-streamed thinking phase — the only way to shorten it is a faster seeder or a two-call seed
(cast first, then the rest), and neither is worth doing before the family has used this; the
handoff fires on the chapter TITLE, which then jumps from the body into the divider when the
scene finishes parsing (pre-existing streaming behaviour, now simply visible a beat earlier); and
`SEED_TIMEOUT_MS`/`WORLD_SEED_DEADLINE_MS` are `let` so the suite can shrink them, which means a
devtools reader could too — harmless, and the alternative was asserting about constants instead
of exercising the path.

---

# 📰 NEWS — summaries that say something (2026-08-04)

The user asked for 4-5 sentence summaries instead of 1-2. Doing only that would have made the
feed WORSE, silently, so three changes shipped together. Files: `netlify/functions/news.mjs`,
`index.html` (the two batching constants), `netlify/functions/farmgpt.mjs` + `farmgpt.html`
(one dashboard bucket each), `tools/_verify-news.cjs` (157 → **200** checks).

## 1 · The brief: 4-5 sentences, 80-110 words
`SUMMARY_SYSTEM` moved from "1-2 plain sentences, 25-45 words". Every other rule survives
verbatim and the suite asserts each one individually rather than trusting the diff — lead with
substance, never open with "This article", use only what you were given, neutral, family-safe
(difficult news plain rather than vivid), plain prose, strict JSON array.
**The invent-nothing rule got STRONGER, not left alone.** A model asked for 95 words from a
teaser will pad, and padding a news summary is fabrication. Three additions: the ban now names
dates, causes, reactions and outcomes and explicitly forbids filling with background the model
happens to know or with what usually happens next; **"LENGTH IS A CEILING, NOT A QUOTA"**; and
the thin-excerpt escape hatch is spelled out as the RIGHT answer rather than a failure ("write
ONE neutral sentence… do not speculate about what the rest of the article probably says in
order to reach four sentences").
LIVE, it holds. A BBC story with a 78-character teaser got 28 words; a 1,379-character Ars
piece got 79. **Summary length tracks excerpt length almost linearly** — which is the whole
design working, and it means the source data, not the prompt, is what caps most cards.

## 2 · The output cap — a hard blocker, and the old one was ALREADY too small
`max_tokens: 220 + n*90` gave 940 for a batch of 8. **Measured against real Haiku, a batch of 8
rich articles produces 995 output tokens.** It would have been cut off mid-JSON, the array would
have failed to parse, and all 8 cards would have dropped silently back to the publisher's blurb
— shorter summaries, no error, nobody notices. The identical failure that was quietly losing
story-keeper scenes at 600 tokens. Now `SUMMARY_BASE_TOKENS 300 + n * SUMMARY_TOKENS_PER_ARTICLE
250` (1,800 for a batch of 6) against a measured worst case of 689-743. Output bills for what is
produced, never for the ceiling, so the headroom is free.
**A FOURTH CAP was hiding behind it**, not in the brief and not in the plan: `s.slice(0, 400)`
on each summary as it comes off the wire, sized for the 25-45 word version. At 80-110 words a
summary runs 500-700 characters, so every long one would have lost its last sentence — mid-word,
with no error anywhere. Now 900. **When a length target moves, grep for every cap between the
model and the screen, not just the one named in the ticket.**

## 3 · Richer source text — and the honest finding
`EXCERPT_CHARS` 700 → **1800**. 700 is ~120 words; asking for a 95-word summary from that is
padding, not summarising, and it fights rule 1 directly. 1800 is ~300 words, about three times
the summary — a real compression ratio, and where the returns stop, because news writing is an
inverted pyramid and the rest is quotes and background a family digest drops anyway.
**MEASURED on five real feeds (NPR, BBC, The Verge, Science Daily, Ars Technica): excerpt lengths
run min 78 / median 306 / max 1379.** So this only bites on publications that put real text in
`content:encoded` — Ars alone had four articles between 877 and 1,379 characters that were being
cut at 700. The rest ship a teaser and there is nothing more to have. Raising the cap further
would buy nothing; **the ceiling on summary length is the publishers, not us.**
The FALLBACK card is deliberately unchanged at 220 characters and the suite pins it there: 1,800
characters of raw article body on a phone card is not a fallback, it is a wall.

## MAX_SUMMARIZE 8 → 6, measured not guessed
Netlify answers a synchronous function in ~10s. Worst case (every excerpt at the full 1800, real
Haiku): **8 articles ran 4.4 / 4.4 / 6.3s; 6 ran 3.8 / 4.0 / 4.1s** — and an ordinary run of the
OLD code was once seen at 7.5s for a batch of 8. Eight works on a good day, which is exactly the
problem: an overrun fails WHOLE and every card in it reverts silently. Six keeps ~6s of margin.
The client pays in parallelism, not time: `NEWS_SUM_CHUNK` 8 → 6 and `NEWS_SUM_PARALLEL` 3 → 4,
so 40 articles still finish in two waves. **The chunk MUST equal the server's MAX_SUMMARIZE** —
ask for more and the overflow is dropped with nothing said — so the suite now reads both files
and compares them.

## Cost — measured on both sides, and it barely moved
Same 20 real articles through `origin/main`'s news.mjs and through this one:

| | input tok | output tok | 20 articles | 40-article digest | /month |
|---|---|---|---|---|---|
| before | 3,110 | 1,216 | $0.0092 | ~$0.018 | ~$0.55 |
| **after** | **4,197** | **1,483** | **$0.0116** | **~$0.024** | **~$0.73** |

**+32%, not the ~4x a first estimate suggested** — because the excerpt raise barely moves input
when the median feed ships 306 characters, and output only rose ~30% for the same reason.
Median summary went 30 → 41 words, max 48 → 92.

## Usage logging — bucket `n`
news.mjs received `usage` from the API and threw it away, which is why the cost above could only
ever have been estimated. It now writes `n_in/n_out/n_req/n_cw/n_cr` plus the per-model
`n_claudehaiku45_*` breakdown into the same `farmgpt_usage` / `farmgpt_usage_hourly` docs as
everything else, one commit for both, in a try/catch that can never break a summary.
`getGoogleAccessToken`/`logUsage` are DUPLICATED from farmgpt.mjs — separate Netlify functions
with no shared module, the same house convention that duplicates the Firebase config on every
page. Dashboard: `"n"` added to farmgpt.mjs's `USAGE_BUCKETS` and a 📰 **News summaries** row to
farmgpt.html's `BUCKETS`, priced at Haiku. The summarize response also returns `usage:{in,out}`,
which is what made the table above measurable. Bucket letters now in use: **s u r d k a g c l x
t f n**.

## Verified
`_verify-news.cjs` **200/200**, 0 page errors — the 157 that existed all still green, +43 in two
new sections. **A2** covers the length target, the old target's absence, all seven surviving
guardrails one at a time, the three strengthened rules, a full batch at the top of the band
fitting under the cap WITH headroom, an explicit tripwire that the old formula could not have
carried it, a 574-character summary surviving whole down to its last sentence, a full-text
article reaching the summariser past the old 700-char cut and still clamping at 1800, the
fallback card still short, and the client/server batch sizes matching. **A3** stands up a
throwaway RSA service account and fake Google token + Firestore endpoints and proves the commit:
both docs, both field shapes, the real token count, authenticated — plus the backend down and
the summaries still arriving. New fixtures: a `/long.xml` publication with its real body in
`content:encoded`, and an Anthropic `long` mode returning a genuine 4-5 sentence summary.
The browser mock's three summaries were LENGTHENED to real 85-100 word ones, because the
screenshots are the density review and reviewing placeholder strings would review the wrong
thing. LIVE: `scratchpad/news_live.mjs` + `news_worst.mjs` (real feeds, real Haiku, through the
real handler). Regressions: fitness **253/253**, storyledger **683/683**.
Shots: `shots/news_long_390.png` + `news_long_390_full.png`.

## DENSITY — flagged, not silently shipped
Measured at 390×844: cards **247 / 228 / 208px** where they were ~120, so **2.5 cards on screen
instead of ~5**, and a 40-article digest is roughly 9,000px of scroll. Each card reads well — 8
lines, not a wall — and a whole card still fits on screen (asserted). But **headline scanning got
harder**: you can no longer see four headlines at once. If that turns out to bother the family,
the fix is a `-webkit-line-clamp: 4` on `.newsc-sum` with a "more" affordance — and it needs a
design decision first, because the card is already a button that opens the article, so "more"
would have to be its own tap target rather than a tap on the card.

**KNOWN**: the model occasionally omits one article from a batch (19 of 20 summarised in two
consecutive live runs) — that card keeps the publisher's blurb, and it is PRE-EXISTING, not a
side effect of the longer format: `origin/main`'s code scored the identical 19 of 20 on the same
feeds. Two near-duplicate wire stories in one batch is the usual cause.

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

# 🏈 SPORTS — NFL scores page + live game detail (2026-08-05, branch claude/fantasy-nfl-sports-integration-9uc6z1, PR #21)

Stage 1+2 of `sports-plan.md` (the plan of record — fantasy + home cards are later stages).
Files: `sports.html` · `netlify/functions/sports.mjs` · `tools/_sports_fixtures.cjs` ·
`tools/_verify-sports.cjs` (**96/96**, 0 page errors) · `tools/_probe-sports.mjs`.

**THE FUNCTION** (stocks.mjs pattern, zero deps, no new env vars): actions `nfl_scoreboard
{week,seasontype,year}` and `nfl_game {eventId}` proxy ESPN's unofficial site API
(site.api.espn.com — free, keyless) and SLIM aggressively (raw scoreboard ~1MB → a few KB;
the suite pins slim < raw/2). Odds/pickcenter/news are never mapped (family app). Every read
is optional-chained; upstream failure = `{ok:false, reason}` at HTTP 200 → honest cards, never
a blank page. `SPORTS_NFL_BASE_URL` points tests at a fake server. **The live `situation` is
DERIVED server-side from the current drive's last play `end`** — the summary endpoint carries
no reliable top-level situation; `end.yardsToEndzone` is the field visual's anchor.

**THE PAGE**: week list (games grouped by Chicago day, LIVE NOW pinned first, away team
listed first, possession ◂, loser dimmed on finals, kickoff+TV on upcoming) with a week
picker driven by the response's flattened season `calendar`; hash-routed game detail
(`sports.html#game=<id>`) with score header + linescore, the SVG FIELD (end zones in team
colors, drive band from `startYardsToEndzone`, gold first-down line, LOS + ball marker,
direction arrow), last-play callout, this-drive plays NEWEST FIRST, previous drives, win-prob
sparkline (server thins the series to ≤80 pts), team stat bars matched by stat `name`, player
box-score tables in `.panner`s, scoring plays. **FIELD MATH** (unit-tested through the DOM):
field coord 0..100 from the LEFT (away) goal line; away possession → `pos = 100 − yTE`
(drives →), home possession → `pos = yTE` (drives ←); first down = pos ± distance;
`x = 83.33 + pos·8.3334` on the 1000-wide viewBox. POLLING: 15s live game / 25s live week /
2min pregame detail / 5min quiet week; document.hidden clears the timer and visibilitychange
refreshes immediately (both asserted). localStorage `bucky_nfl_sb` caches the default week for
instant paint; a failed refresh keeps the stale copy + shows a note. `window.__SPORTS__` hook.

**NAV: 13 AREAS NOW** — `sports` (🏈, `url:"sports.html"`, the gpt-style url area) inserted
after News in index.html's NAV_GROUPS + NAV_PATHS AND the 5 mirrored navs (farmgpt, games,
weather, activity, status) + sports.html's own. Two-row phone bar balances 7+6 for Dad
(ceil(13/2)); measured 0 clipped at 390px. RESTAGED for the 13th area: `_verify-activity.cjs`
links 12→13, navRows(=columns) 6→7, rail 12→13; `_verify-beacon-safety.cjs` PAGES gained
sports.html (`data-feature="sports"` beacon on the page). chore-care needed NO restage (its
counts are per-gated-user and float).

**FANTASY (stage 3, same day)**: `ff_league` / `ff_scoreboard` / `ff_matchup` proxy the
fantasy v3 API (lm-api-reads.fantasy.espn.com) for the family's PRIVATE league — **league
705063, team "Battle Kreussers", both baked as defaults** (env overrides ESPN_LEAGUE_ID /
ESPN_TEAM_NAME / ESPN_SEASON). Private = cookies: **ESPN_S2 + ESPN_SWID env vars** (from a
logged-in espn.com browser's cookies; SWID braces added server-side if missing; espn_s2
expires ~yearly). Cookies are read AT CALL TIME (env update + redeploy = fixed, no code
change), sent upstream only, never echoed. Missing → `fantasy-not-configured`; ESPN 401/403
→ `fantasy-auth-expired` — the page renders a Dad-facing setup/fix card for each, and the
suite pins both. `ffSeason()`: Jan/Feb belong to the PREVIOUS league year. `ff_matchup`
returns both lineups (slot-sorted via SLOT_ORDER, actual + projected from the player stats
array: statSourceId 0=actual 1=projection at the scoringPeriodId) AND joins each player's
REAL NFL game state by fetching the site scoreboard — **fantasy proTeamId and the site
API's team ids are the same id space** (PRO_ABBREV map in sports.mjs; the probe cross-checks
it against the live scoreboard's own id↔abbrev pairs). Page: 🏆 Fantasy pill / `#fantasy`
hash → family matchup pinned with side-by-side lineups (live dots, muted "proj N" until a
player's game starts, injury letter), Around-the-league matchups, standings from a ~1h-cached
`ff_league` (localStorage `bucky_ff_league`). Poll 60s during NFL game windows (ESPN's own
fantasy scoring lags ~30-60s — faster buys nothing), 15min otherwise.

**⚠ NOT LIVE-VERIFIED**: ESPN hosts are egress-blocked from this sandbox, so
`_sports_fixtures.cjs` is authored from documented shapes, not captured. POST-DEPLOY:
`node tools/_probe-sports.mjs --site https://amenfarms.netlify.app` from a normal machine —
it checks every field the app reads incl. the fantasy league + pro-team map (run once during
a LIVE game for the situation/drive fields) and flags drift. The slimmer is defensive, so
drift = missing sections, not crashes. Suite now **138/138**.

**🚨 THE UA GOTCHA (2026-08-05, found live — the site shipped broken for ~20 min)**:
site.api.espn.com's Akamai edge **403s datacenter requests with a BROWSER User-Agent but
answers `curl/*` with 200** — the EXACT INVERSE of the Yahoo/stocks.mjs lesson this function
originally copied. Measured twice from GitHub runners: browser UA / empty / "node" /
"bucky-family-app" all 403, default curl 200 both times. `NFL_UA = "curl/8.6.0"` in
sports.mjs (suite-pinned); the fantasy host (lm-api-reads) is FINE with the browser UA and
keeps it — don't unify. DIAGNOSIS PATTERN when the sandbox can't reach a host:
`.github/workflows/sports-diag.yml` (hand-dispatched) curls ESPN + the live function from a
GitHub runner and prints bodies — that's how both the 403 and the fix were proven (the live
fix confirmed the same way: function returns ok:true with real events post-deploy).

**TEST GOTCHAS (new)**: (1) seeding `choreUser="Dad"` makes index.html AUTO-PROMPT for the
Dad PIN on load — a native `prompt()` wedges headless Chrome silently (no error, no render);
stub `window.prompt/alert/confirm` in every init script (chore-care already knew this — copy
its harness, don't re-derive it). (2) A blanket "abort everything non-localhost" interception
also kills `data:` URLs and wedges index.html's boot — abort only external http(s) +
firebase-ish hosts. (3) In THIS cloud env suites' `channel:"chrome"` needs
`mkdir -p /opt/google/chrome && ln -sf /opt/pw-browsers/chromium-1194/chrome-linux/chrome
/opt/google/chrome/chrome` once per container; `_verify-sports.cjs` itself falls back to
`/opt/pw-browsers/chromium` (or `BUCKY_CHROME`) automatically.

**HOME CARDS (stage 4, same day)**: `nflcard` + `ffcard` in renderDashboard, slotted right
after the weather card (wxcard discipline: instant localStorage paint from `bucky_nfl_home`/
`bucky_ff_home`, quiet refresh when stale — 60s during live windows via `sportsHomeAnyLive()`,
10 min otherwise — repaint only if still on dashboard). NFL card: up to 3 live games
(away @ home scores, possession ◂, red clock, situation line on the featured game only),
else next kickoffs, else last finals; "+N more this week ›" footer; tap → sports.html.
Fantasy card: the family matchup (trailing side dimmed), proj line + "N starters yet to
play"; tap → sports.html#fantasy. **BOTH CARDS START `hidden` AND STAY HIDDEN when there is
nothing to show** — off-season/empty scoreboard, fantasy not configured, a failed fetch with
no cache, or another suite's blanket `{}` function mock (all five states asserted; the
`.home2 .nflcard` `display:block` rule outweighs the UA's `[hidden]` rule, so a
`[hidden]{display:none}` restatement is REQUIRED). All card text renders via textContent
(API text is external data). Suite section G; **156/156** total.

**STAGE 5 — FANTASY SCOREBOARD + MATCHUP DETAIL · PER-USER TEAMS · COLLEGE FOOTBALL
(2026-08-05)**: three user asks in one batch.
- **Fantasy is a SCOREBOARD now** (`#fantasy`): every matchup in the 8-team league as a
  tappable row (`.gbtn[data-ffteam]`, away side on top like the NFL rows), the family's
  pinned under "Your matchup", the rest under "Around the league", standings (all 8) below.
  Tapping opens **`#ffm=<teamId>`** — the matchup LINEUP detail (the old paintFf body moved
  to `paintFfm`/`#ffmView`; server `ff_matchup` already took `teamId`, so ANY matchup opens).
  The `ff` view loads only `ff_scoreboard` (+cached `ff_league`); `ffm` loads `ff_matchup`.
  Gate cards (not-configured/expired) factored into `ffGateHTML()` shared by both views.
- **PER-USER TEAMS**: `FF_TEAM_BY_USER` = { isaac: "The Goat Kids", grandpa: "Wyoming
  Cowboys" }, default Battle Kreussers — matched by `choreUser`, lowercased. DUPLICATED in
  three places, keep in sync: sports.html `myFfTeamName()`, index.html `sportsHomeFfTeam()`
  (the home ffcard passes `teamName` and treats a cached copy for ANOTHER team as stale via
  the cache's `team` field), and the server resolves `body.teamName` (exact → includes →
  env-default fallback; "End Zone Goats" vs "The Goat Kids" is the near-name trap the exact
  pass exists for). Server-side `ffWantedName`/`ffFamilyTeamId` in sports.mjs.
- **COLLEGE (`#college`, 🎓 pill)**: same shared week-list machinery — `siteScoreboard/
  siteGame` were already league-parameterized, so `ncaa_scoreboard`/`ncaa_game` are the same
  code on `college-football`. **The upstream default is the FULL FBS slate (measured live
  2026-08-05), NOT a Top-25 cut** — "Top 25" is the CLIENT's filter on `curatedRank`
  (slimmed to `team.rank`, 1-25 else null; rendered as `#N` badges). **PRESEASON has NO
  ranks at all** (live 2026-08-05: 99 events, 0 ranked) — Top 25 falls back to the full
  slate with a friendly note instead of an empty tab, and re-engages once rankings publish
  (suite fakes it via `upstream.cfbUnranked`). Conference dropdown
  (`#cfbGroup`, persisted `bucky_cfb_group`, default top25): real ESPN `groups=` ids —
  80 all-FBS · 8 SEC · 5 B1G · 4 B12 · 1 ACC · 9 Pac-12 · 151 AAC · 17 MWC · 37 Sun Belt ·
  15 MAC · 12 CUSA · 18 Indep. College games deep-link **`#cgame=<id>`** ("cgame" contains
  "game", so the router matches cgame FIRST); the game view is sport-aware via `gameSport`
  (back button reads "‹ College"). College has its own week picker (`flatWeeksOf`/
  `weekIndexOf`/`stepWeekOf` — the old NFL-only fns parameterized) + stale-note/error card.
- **RACE FIXED (`cfbReload` latch)**: changing the filter while a fetch is in flight used to
  no-op on the `cfbLoading` guard and paint the STALE in-flight group; now the latch re-runs
  `loadCfb` with the latest group when the in-flight one lands (suite polls the URL rather
  than reading `lastUrl` once).
- **BUG FIXED — `.pills[hidden]`**: `.pills { display:flex }` beat the UA `[hidden]` rule, so
  the "hidden" top pills stayed painted on every game detail since stage 1 (same class as
  the `.nflcard` note above — THIRD time this class of bug has bitten; any styled container
  toggled via the `hidden` attribute needs a `[hidden]{display:none}` restatement, and
  suites must assert GEOMETRY (`offsetParent === null`), not the attribute).
- One delegated document click handler routes all score rows (`data-eid`+`data-sport` →
  game/cgame, `data-ffteam` → ffm) — per-paint handlers are gone.
- Fixtures: the real "Nerd Fantasy Football League" shape (8 teams incl. the two per-user
  ones + the near-name trap), 4 live + 4 decided matchups, small rosters on the extra live
  ones; college slate (ranked live/pre + unranked pre/final, SEC filter on groups=8) + a
  college summary. Suite **212/212** (+A college/rank/groups checks, +E per-user resolution,
  F rewritten for scoreboard→detail incl. Isaac/Grandpa contexts, +H the college view,
  +G Isaac's home card). Probe extended (ncaa actions, ff_scoreboard, both per-user names
  must resolve). chore-care 50/50 regression green.

**STAGE 6 — SPREADS · RECORDS · MY-STARTERS BADGES · FANTASY WIN% + POLISH (2026-08-05)**:
- Game rows (NFL + college): team RECORD beside the name (`.trec`, data was already
  slimmed); the BETTING LINE on upcoming rows (new `spread` field — scoreboard from
  `comp.odds[0].details`, game detail from `pickcenter[0].details`, DISPLAY STRING ONLY,
  provider/prices asserted never to leak; pregame detail card gains a "Spread:" line);
  and **🏆 N of yours** — how many of MY fantasy starters play in each NFL game
  (`loadMyFfCounts()` fires once at boot via ff_matchup w/ the per-user teamName, builds
  a proTeam→count map, repaints the week; NFL-ONLY by `sport` gate — college MIA/etc.
  abbrevs collide with pro ones). Live rows append the badge to the situation line;
  pre rows get spread+badge on their own `.situ` line; finals badge-only.
- Fantasy scoreboard: **estimated win% beside each score** (`ffWinPct` — normal model on
  projected finals, σ=30, Φ≈logistic 1.702x; OUR estimate, not ESPN's; decided matchups
  skip it). Matchup rows got air (`.ffvs` padding 10px + divider between stacked rows —
  the wpct span carries `margin-left:auto` so rows WITHOUT one keep the old score
  alignment). Standings: usernames REMOVED (team name only) and the W-L wrap fixed
  (`table.stand th,td { white-space:nowrap }` + the name column takes `width:100%;
  max-width:0; ellipsis` so nowrap can't blow the table wide).
- Suite **227/227** (spread string-only leak checks, records/spread/badge row checks incl.
  live-vs-pre placement, win% hand-computed 31%/69%, separation + nowrap + no-owner).

**TAB HEADERS UNIFIED (2026-08-05, user: "AI and Sports … have a green header with a back
button, they should have the same header as every other tab")**: sports.html + farmgpt.html
headers re-styled to index.html's app header — cream `--bg`, 1px `--line` bottom border,
"Bucky" Fraunces-green wordmark + "Family Farm Hub" subtitle on one baseline (the wordmark
IS the link home, keeping the `#backLink` id so nothing else moved), the page/view name as
a QUIET right-aligned muted label (`#bar .t`; farmgpt's `#barTitle` still swaps per view and
the 🧹 Clear button restyled as a light chip). Desktop (≥1024px): wordmark hidden (the rail
carries it) and `.t` becomes the ink crumb — index's exact pattern. farmgpt's green came
from its `farmstead-theme-page` OVERRIDE block (appended last, wins) — that had to be
emptied, not just the head rule. **SPECIFICITY GOTCHA**: the head rule `#bar a#backLink`
(2 ids) beats the desktop media block's old `#backLink { display:none }` (1 id) — media
queries don't add specificity; the hider had to become `#bar a#backLink` too. games.html +
weather.html deliberately untouched (not direct nav tabs; user scoped the ask). Suites:
sports 227/227 · storyledger 683/683.

**DEFERRED** (per plan): status.html registry rows for ESPN (free NFL row + a
cookie-configured fantasy row surfacing `fantasy-auth-expired` on the ops page).
