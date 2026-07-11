# legacy-verify — 3D-era test suites (archived, do not run)

These `verify-p0.cjs … verify-p15.cjs` + `verify-editor.cjs` suites verified the
**three.js 3D** builds of Farm Life (phases P0–P11 + the 3D world editor). The
2026-07-11 **2D MODERN PIXEL** pivot replaced the three.js render layer with a
Canvas2D pixel renderer, so these suites target hooks that no longer exist
(`__FL__.world.*`, scene child counts, bone quaternions, GLB visuals, the 3D
editor `__FLED__`, etc.) and **will not pass** against the current build.

They are kept **only as documentation of the 3D era** — the gameplay/sync/growth
logic they exercised survived the pivot and is now re-verified in 2D.

## The live 2D suites (in `farmlife/`)

| Suite | Covers |
|---|---|
| `verify-2d-r1.cjs` | R1 render core — pixel renderer, camera, collision, day/night, hop |
| `verify-2d-r2.cjs` | R2 gameplay parity — till/plant/water/harvest/sell, animals, decor, map/inventory, weather |
| `verify-2d-r3.cjs` | R3 — MP presence (live Playroom), cloud farm (famtestfl), mobile touch, THREE-shed |
| `verify-2d-all.cjs` | one-command offline smoke: r1 + r2 + r3(`--offline`) |

Unit tests (`npm test`, vitest) survived the pivot unchanged and remain the
source-of-truth for the pure growth/action/animal/sync logic.
