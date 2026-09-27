# Sunday — live NFL scores with GFFL fantasy points

`sunday.html` (served at `/sunday`) is an NFL port of Saturday, the college-football scores app
built on 2026-09-26, with the GFFL league layered on top. It reads the league; it never writes it.

## Files

| file | what it is |
|---|---|
| `sunday.html`, `sunday.webmanifest` | page shell, home-screen manifest (reuses the GFFL icons) |
| `assets/sunday/sd-app.js` | scoreboard, game view, SVG field, polling. Fantasy hook list at the top |
| `assets/sunday/sd-features.js` | Matchups/Standings pages, team pages, settings sheet |
| `assets/sunday/sd-reenact.js` | the 8-bit play re-enactment, parsing NFL play text |
| `assets/sunday/sd-fantasy.js` | fantasy engine: league load, scoring, per-play credit, projections. No markup |
| `assets/sunday/sd-ffui.js` | fantasy UI: implements the `ff*` hooks, box-score polling, swing toasts |
| `assets/sunday/sd.css`, `sd-ff.css` | app styles (GFFL navy tokens), fantasy styles |

## Data

- ESPN site API (`scoreboard`, `summary`): scores, drives, box scores. Browser-direct, CORS-open.
- ESPN core API (`…/events/{id}/competitions/{id}/plays`): every play's participants by athlete id
  and role (passer, receiver, scorer, kicker, sackedBy…). This is how a play shows
  "+6.9 C. Watson KREU" with no name parsing. Only fetched for the open game.
- Firestore `gffl_fam2jan2g` (read-only REST, same public key as lg-core.js): `settings.rules.scoring`,
  team docs (field-masked), `sched_<season>` / `bracket_<season>`, `roster_<season>_w<week>_t<id>`
  (walks back to the latest earlier week, like `LG.ensureRoster`), `proj_<season>_w<week>` (`p`).
- Sleeper `api.sleeper.com/projections/nfl/<season>/<week>`: projection fallback for players the
  proj_ doc doesn't cover (D/STs, slp_ keys, some QBs and kickers), scored with league rules.
  Rows carry name/team/position, so no player directory is needed.
- "My team": `?team=<id>`, then `sun.team`, then GFFL's own `gffl_team` (same origin).

League week N = NFL regular-season week N. Preseason and the NFL postseason show no fantasy layer.

## Checked against GFFL

`tools/_sunday_reconcile.mjs` re-scores league weeks 1 and 2 from ESPN box scores and compares
with `weekly_2026_w1/w2`: 15 of 16 team-weeks exact. Team 1 week 1 is 0.38 low in GFFL's final,
which never scored Kyler Murray's 3/5-18-1 INT line (0.04×18 + 0.1×9 − 2 = −0.38).

Live points are ESPN-only. GFFL merges ESPN and Sleeper, so a stat correction can make the two
differ by a few tenths until GFFL finalizes the week.

## Verify

```
node tools/_verify-sunday.cjs      # port: play parsing, divisions, field geometry
node tools/_verify-sunday-ff.cjs   # engine: arithmetic, per-play == box invariant, reconcile, live findings
```

`SUNDAY_FF_ENGINE=<path>` points the engine suite at a patched copy for bite runs.

## Known gaps

- Blocked kicks: ESPN's site box has no field for them, so `dst_blk` comes only from core-API plays.
- Missed-PAT and failed-2-pt credit paths have no real sample in the fixtures yet.
- Sleeper's projection rows carry no total `fgmiss`, so projected FG misses score 0 (GFFL does the same).
- No push alerts yet; swing toasts only show while the page is open.

## 2026-09-27 — first build

Perry: "take the Saturday app we made and do the same thing for NFL, with the twist being that it
is integrated with the GFFL app so it emphasizes fantasy scoring and impact". Chose a page on the
GFFL site over a standalone app or rebuilding league.html's Scores tab; push alerts deferred.
