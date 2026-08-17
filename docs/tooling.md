# Tooling

Preview servers, screenshot rigs and the verification suites' shared harnesses.

The verify suites themselves live in `tools/_verify-*.{cjs,mjs}` and are documented in the
topic file they belong to, next to the feature they check.

> Split out of the single 12,800-line `CLAUDE.md` on 2026-08-16. Entries are verbatim and in
> their original order — the oldest at the top, the newest at the bottom. Later entries
> routinely correct earlier ones, so when two disagree, the lower one wins.

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
