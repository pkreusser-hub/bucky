# Bucky tools

## Mobile preview (daily)

Phone-viewport Chrome for any Bucky page or game. Reuses/starts `http-server` on
port **8790** (same as Launch `bucky-static` / photobooth). Stubs
`matchMedia('(pointer: coarse)')` by default so Farm Kart touch UI / `IS_MOBILE`
actually turns on (desktop Chrome never reports coarse pointer).

### One-click (Windows)

Double-click **`Mobile Preview.bat`** at the repo root. That opens a phone-size
Chrome window on a picker page — tap Home / Farm Kart / Weather / etc. Close
Chrome when done.

In Cursor: **Terminal → Run Task… → Mobile Preview** (same `--picker` flow).

### CLI

```bash
# Interactive picker (same as the .bat)
node tools/mobile-preview.mjs --picker

# Interactive (visible Chrome, close window when done)
node tools/mobile-preview.mjs farmkart.html
node tools/mobile-preview.mjs index.html

# Screenshot → shots/mobile-<page>.png
node tools/mobile-preview.mjs weather.html --shot
node tools/mobile-preview.mjs --all

# Devices: iphone14 (390×844, default) | se | pixel | ipad
node tools/mobile-preview.mjs games.html --device se --dpr 3
node tools/mobile-preview.mjs --list
```

**Gotchas**

- Use `http://localhost:8790/...`, never `file://` (assets break).
- Farm Kart needs the coarse-pointer stub (on by default). `--no-coarse` disables it.
- Cursor Launch preview tabs can be `document.hidden` → WebGL/rAF stall; prefer this CLI for games.
- Chrome DevTools alternative: open the localhost URL → Ctrl+Shift+M → pick a phone. Still stub coarse pointer for Farm Kart (or use this tool).

Deps: `puppeteer-core` in this folder (`npm install` under `tools/` if missing) + system Google Chrome.
