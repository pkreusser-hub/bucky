# mk64-to-farmkart

Convert a real **Mario Kart 64** course (from the [n64decomp/mk64](https://github.com/n64decomp/mk64)
decompilation) into a **Farm Kart** track (`fk_tracks_v1` format — control points + width + laps +
elevation), ready to paste into `assets/farmkart-track.js`'s `BUILTIN_TRACKS` map.

## What it uses
Each course dir has `d_course_<name>_track_path[]` in `course_data.c` — the CPU **racing line**,
a dense ordered closed loop of `{posX, posY, posZ, trackSectionId}` (s16) with real elevation.
That's the centerline source. (The `.inc.c` mesh vertices are only used to sanity-check road width.)

## Pipeline
1. **Parse** `track_path` (stop at the `{0x8000,..}` sentinel).
2. **Transform** — translate start→origin, rotate 180° so the start straight heads +Z (Farm Kart
   convention), apply a **fixed scale 0.09** (MK64 units→metres, calibrated so the ~200-unit road
   ≈ Farm Kart's 18m). MK64 units are consistent across all courses, so one scale preserves each
   course's true relative size *and* keeps road width consistent.
3. **RDP-simplify** the ~500-point line to ~35–47 control points, carrying Y (keeps points on
   corners, drops them on straights).
4. **Curvature guard** — MK64's racing line cuts apexes tighter than the road, so a constant-width
   ribbon would bowtie (radius < half-width). `limitCurvature()` gently Laplacian-relaxes only the
   too-tight apexes until min spline radius ≥ half-width × 1.2. This is what stops the crumpled-mesh
   bug; it is course-agnostic.
5. **Item boxes** — `item_box_spawns` (real MK64 box locations, clustered by group) are transformed to
   Farm Kart coords, projected onto the centerline, and averaged per cluster → one `itemRows` lap
   fraction per real box row (falls back to `[0.15,0.45,0.75]` if a course has none).
6. **Validate** (ported from `FK_TRACK.validate`) + emit JSON.

## Setup
```sh
git clone --depth 1 https://github.com/n64decomp/mk64   # anywhere; ~155MB, source only
export MK64_SRC=/path/to/mk64                            # or pass it inline per command
```

## Usage
```sh
# survey every convertible race course (lap length, size, elevation, min-radius, self-crossings)
MK64_SRC=./mk64 node convert.mjs --survey

# convert one course -> <id>.fktrack.json
MK64_SRC=./mk64 node convert.mjs choco_mountain "Choco Mountain" --laps 3 --out .

# convert ALL race courses -> builtin_tracks.json (a { id: track } map)
MK64_SRC=./mk64 node convert.mjs --all --out .

# render top-down PNG previews of a candidate set (edit the CANDIDATES list in the file)
MK64_SRC=./mk64 node preview_batch.mjs      # writes preview_grid.html
```

## Adding a converted course to the game
1. Convert it, grab the `points` array from the JSON.
2. Add an entry to `BUILTIN_TRACKS` in `assets/farmkart-track.js` keyed by a slug id
   (e.g. `"choco-mountain"`). The game's track picker + `?track=<id>` loader pick it up automatically.
3. **Always preview it** — top-down (`preview_batch.mjs`) AND in-game before committing. Watch for:
   - **self-crossings** (`cross N` in the survey): courses with over/under bridges (Choco Mountain,
     Royal Raceway, Toad's Turnpike, Wario Stadium, Rainbow Road). The two branches must sit at
     different elevations or the ribbon reads as a flat X. Verify the bridge renders before shipping.
   - **elevation spikes**: check the profile is a smooth valley/hill, not a one-point crater.

## Currently shipped in Farm Kart
mario-raceway, moo-moo-farm, luigi-raceway, kalimari-desert, koopa-troopa-beach,
frappe-snowland, sherbet-land (all self-crossing-free, verified in-game).

## Notes / knobs (top of `convert.mjs`)
- `FK_WIDTH` (18) — road width in metres. Fixed across courses for consistent kart-to-road feel.
- `FIXED_SCALE` (0.09) — units→metres. Lower = bigger tracks.
- `CURV_MARGIN` (1.2) — bowtie safety factor (min radius = half-width × this).
- `TARGET_PTS_LO/HI` (34–52) — control-point budget the RDP epsilon is auto-tuned to hit.
- Per-course mesh width auto-measure exists (`measureRoadWidth`, `--` opt `measure`) but is noisier
  than the fixed scale; kept for reference.

## IP note
These reproduce Nintendo's course layouts. Fine for a private/passworded family app; do not
distribute publicly.
