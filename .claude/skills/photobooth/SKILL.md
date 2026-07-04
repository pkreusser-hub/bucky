---
name: photobooth
description: Render headless PNG screenshots of the 3D games (poses, times of day, camera angles) into shots/ for visual review. Use whenever art or animation in goatcare.html or other 3D games needs to be SEEN.
---

# Photobooth

A headless-Chrome capture tool for BUCKY's three.js games. It loads a game page
in "photo mode" (a forced pose, camera, and time of day, with no localStorage
writes), waits for the scene to settle, and saves a PNG (or a short sequence of
PNGs) of just the `<canvas>` into `shots/`. Read the resulting image files
directly to review 3D art and animation instead of relying on a live browser
tab (which Chrome throttles/suspends when hidden).

## Quick commands

Run these from anywhere; the script resolves paths relative to the BUCKY root.

Standing three-quarter daylight portrait:
```
node tools/photobooth.js --params "pose=stand&hour=14&cam=three4"
```

Night wide shot, lying down, front camera:
```
node tools/photobooth.js --params "pose=lie&hour=23&cam=front"
```

Pronk (jump) animation as an 8-frame strip, 120ms apart:
```
node tools/photobooth.js --params "pose=pronk&hour=14&cam=three4" --frames 8 --every 120 --out shots/pronk-strip.png
```
This writes `shots/pronk-strip-f00.png` ... `shots/pronk-strip-f07.png`.

Close-up on the face/head:
```
node tools/photobooth.js --params "pose=happy&hour=12&cam=closeup"
```

Custom position/rotation (e.g. facing away, off to one side):
```
node tools/photobooth.js --params "pose=stand&rot=3.4&x=0.8&z=-0.6&cam=side"
```

## What it does

- Launches the system-installed Google Chrome via `puppeteer-core` (`channel: 'chrome'`)
  — no bundled Chromium download.
- Serves the BUCKY root over `http://localhost:8790` using `npx http-server`
  if nothing is already listening there, and tears the server down on exit.
- Appends `?photo=1` plus `--params` to the target game's URL.
- Waits for `window.__photoReady === true` (set by the game's photo-mode code
  once lighting/pose/camera have synchronously settled), or fails clearly
  after a 10s timeout.
- Screenshots just the `<canvas>` element (not the HUD chrome around it —
  actually the HUD *is* part of the canvas overlay in goatcare.html, so it's
  included; see the actual screenshots to confirm what's captured).
- Prints the absolute path and byte size of every file written. A file under
  ~20KB is a red flag for a black/blank capture — investigate before trusting it.

## CLI reference

```
node tools/photobooth.js [--url URL | --game goatcare] [--out shots/name.png]
                         [--w 900 --h 900] [--frames N --every MS]
                         [--params "pose=pronk&hour=14&cam=three4"]
```

- `--game` (default `goatcare`) — picks `<game>.html` under the BUCKY root when
  `--url` isn't given.
- `--url` — full override URL if you need something other than the default
  localhost dev server (you are responsible for `?photo=1` and params in this case).
- `--out` — output PNG path (relative to BUCKY root, or absolute). Default is
  `shots/<game>-<slugified-params>.png`.
- `--w` / `--h` — viewport size in px (default 900x900).
- `--frames` / `--every` — capture N sequential screenshots, `--every` ms apart,
  named `-f00`, `-f01`, ... This is how you review animation (walk cycles,
  pronk bounces, idle sway) frame by frame.
- `--params` — the query string forwarded to the game (see below). `photo=1`
  is added automatically; don't include it yourself.

## Game photo-mode params (goatcare.html)

All optional except that `photo=1` (added automatically) is the master switch.

| param | values | default | effect |
|---|---|---|---|
| `hour` | `0`-`23` | real clock | Freezes the day/night cycle at this hour (minutes=0). Lighting snaps instantly, no fade-in. |
| `pose` | `stand`, `lie`, `walk`, `pronk`, `eat`, `happy` | `stand` | Forces the goat's behavior state and prevents the free-roam AI from ever overriding it. `stand` zeroes every joint for a clean neutral silhouette. `walk`/`pronk`/`happy`/`eat` keep animating/looping live, so `--frames`+`--every` shows real motion. |
| `rot` | radians | `0.9` | Goat facing (Y rotation). |
| `x`, `z` | world units | `0`, `-0.2` | Goat position in the stall. |
| `cam` | `front`, `side`, `three4`, `closeup`, `game` | `three4` | Fixed camera preset. `closeup` tracks the goat's actual head position every frame. `game` leaves the normal follow-camera active (rarely useful for stills). |
| `settle` | seconds | `1.5` | How long the sim is stepped synchronously (at 60 steps/sec) before the screenshot is considered ready, so joint lerps/camera moves finish landing. Raise it if a pose still looks mid-transition. |

Example combining everything:
```
node tools/photobooth.js --params "pose=eat&hour=8&rot=2.1&x=-1&z=0.3&cam=closeup&settle=2"
```

## Adding photo mode to a new game

Only `goatcare.html` has photo mode today. To add it to another game
(`pasturepanic.html`, `hayhaul.html`, `varmintwars.html`, etc.), follow
`goatcare.html`'s pattern:

1. Parse `new URLSearchParams(location.search)` near the top of the IIFE; read
   `photo=1` into a `PHOTO` boolean and `hour=N` into a `photoHour` override.
2. Guard every `localStorage` write (`saveState()` or equivalent) with an
   early return when `PHOTO` is true.
3. Auto-dismiss any "enter your name" / "start game" overlay when `PHOTO` is true.
4. Wherever the game reads `new Date().getHours()`/`getMinutes()` for day/night
   or a clock display, fall back to `photoHour` when it's set.
5. Add `pose=`/`rot=`/`x=`/`z=` handling that forces the main character's state
   machine into a specific pose and position, marking it as forced so free-roam
   AI doesn't fight it. Watch out for state machines that no-op when you
   "re-set" the same state (see `setGoatState`'s early return in
   goatcare.html) — looping poses may need to reset their internal timer
   directly instead of calling the normal state-setter again.
6. Add `cam=` fixed camera presets, disabling the game's normal follow/orbit
   camera while photo mode is active (unless `cam=game`).
7. After forcing everything, synchronously call the game's own per-frame
   `update(dt)`-equivalent function `settle*60` times with `dt=1/60`, then set
   `window.__photoReady = true`.
8. Leave the real `requestAnimationFrame` loop running as normal — headless
   Chrome fires rAF fine, this is just what lets `--frames`/`--every` capture
   real animation after the initial settle.

## Troubleshooting

- **Timeout waiting for `__photoReady`**: open the game's photo-mode block for
  a thrown exception (check `page.on('pageerror')` output the script already
  prints), or confirm `?photo=1` actually reached the page (typos in `--params`
  don't get validated).
- **Black or tiny (<20KB) PNG**: headless Chrome's default GPU path can fail;
  the script already launches with SwiftShader software rendering flags
  (`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`). If it's still
  black, check `preview_console_logs`/pageerror output for a WebGL context
  creation failure.
- **Port 8790 already in use by something else**: pass `--url` with the
  already-running server's URL instead, or stop whatever's bound to 8790.
- **Frozen/identical animation frames**: a pose's state machine may be
  no-op'ing on re-entry (calling the same "set state" function twice does
  nothing if the state didn't change) — see point 5 above.
- **`pose=walk` wanders out of frame**: `walk` picks real roam targets across
  the whole stall and the fixed camera presets don't follow it, so a multi-frame
  walk capture can end up staring at a wall or a close-up of fur. Use `cam=game`
  (real follow camera) for walk cycle review, or accept that walk stills are
  best taken as single frames (`--frames 1`, the default) rather than a strip.
