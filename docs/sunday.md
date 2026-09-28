# Sunday — live NFL scores with GFFL fantasy points

`sunday.html` (served at `/sunday`; called "Scores" on screen and in GFFL's nav since 2026-09-27) is an NFL port of Saturday, the college-football scores app
built on 2026-09-26, with the GFFL league layered on top. It reads the league; it never writes it.

## Files

| file | what it is |
|---|---|
| `sunday.html`, `sunday.webmanifest` | page shell, home-screen manifest (reuses the GFFL icons) |
| `assets/sunday/sd-app.js` | scoreboard, game view, SVG field, polling. Fantasy hook list at the top |
| `assets/sunday/sd-features.js` | key moments, team pages, settings sheet (theme, your GFFL team) |
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

## 2026-09-27 — uploaded team crests

Perry: "its pulling the old espn logos for the GFFL teams, not the new logos". An uploaded
crest lives in the team doc's `logoData` (a data: URL; 7 of 8 teams have one), and the team
query's field mask only asked for the old ESPN `logo`. Sunday now reads `logoData || logo`, the
precedence GFFL uses everywhere (lg-ui.js `teamSrc`), and a transparent PNG sits uncropped on the
team colour (GFFL's `isCutoutLogo`). About 470KB of crests on first load, same as GFFL.

VERIFY: sunday-ff 53/53 (F5 mask includes logoData; F7 precedence). Bite: the previous engine
fails both. sunday 42/42.

## 2026-09-27 — owner crests in place of team names

Perry: "use the gffl logos in place of team names when it shows GFFL starters/benches". The
Fantasy tab rows, the game-card starter chips and the per-play chips printed the owner's
abbreviation ("KREU", "GOAT · BN"). `ffTag` now renders the owner's crest (the uploaded
`logoData` first) with `role="img"` and the full team name as its label, BN beside a bench man,
and a gold ring on your own. The abbreviation stays only as the aria-hidden monogram under the
picture, shown if the image fails. Cache-bust ?v=20260927i.

VERIFY: sunday 48/48 (new section "GFFL owner crests", 6 checks), sunday-ff 53/53. Bite: the
previous sd-ffui.js/sd-ff.css fail all 6.

## 2026-09-27 — every GFFL starter on the game card

Perry: "show all GFFL starters instead of having '+2 GFFL'". The card chip row showed your
matchup's starters (or the first four) and folded the rest into "+N GFFL starters". It now shows
every GFFL starter in the game, yours and your opponent's first; the row wraps (measured on the
live week-3 slate: up to 8 chips, all inside the card at 375px). Cache-bust ?v=20260927j.

VERIFY: sunday 51/51 (3 new checks), sunday-ff 53/53. Bite: the previous sd-ffui.js shows 2 of 6.

## 2026-09-27 — the GFFL bar on Sunday; filters removed

Perry: "its hard to get back to the GFFL from Sunday, move scores, matchups and standings to where
the my teams, conferences are and get rid of those entirely, that way the gffl bar can be present
when on the Sunday page". Scores / Matchups / Standings are three tabs in the top bar (the row the
filter chips held). The chips (All, Upsets, My Teams, AFC, NFC, Division) are gone and the board
always shows every game; a filter saved by an earlier visit is ignored. The bottom slot is GFFL's
bar (`#gnav`): league.html's eight entries linking to `league.html#<view>`, Sunday lit, the same
10.5px / .3px type GFFL measured for eight entries at 390px; on desktop it is GFFL's 34px top strip
with Sunday's bar sticking under it. The game view (z-index 40) still covers it, as it did the old
tab bar. Cache-bust ?v=20260927k.

VERIFY: sunday 62/62 (11 new checks), sunday-ff 53/53. Bite: the previous page fails 8.

## 2026-09-27 — Sunday is GFFL's Scores; Matchups and Standings pages removed

Perry: "lets have Sunday replace the Scores tab in GFFL, but lets ditch the matchup and standings
pages in Sunday. Rename it to 'Scores'". The page is called Scores (title, wordmark, manifest; the
file stays sunday.html). Its copy of the GFFL bar matches league.html's new seven entries, the last
being this page, lit, as Scores, at GFFL's seven-tab type (600 11px / .5px; 54px boxes at 390px,
MATCHUP ink 39px in 52px of room). The Matchups page (`ffRenderMatchupsPage`), the Standings page
and the Scores/Matchups/Standings row are gone; an old `#matchups` / `#standings-*` link lands on
the board with the hash cleared. The matchup header now opens `league.html#matchup`. "Your GFFL
team" moved from the Matchups page to the Settings sheet. Cache-bust ?v=20260927l.

VERIFY: sunday 65/65 (section "GFFL bar; one page" restaged, 3 new checks), sunday-ff 53/53. Bite:
the previous Sunday files fail 7.

## 2026-09-28 — the 8-bit replay: real formations, real kicks, 32-bit players, home and road kits

Perry: "lets start with accuracy, get the formations matching, kickoff alignment, field goals
actually looking like field goals and ball getting kicked. lets also take a turn on improving the
pixel graphics of the players to look a little clearer, more of a 32 bit look. Also, away teams
should wear white jerseys, primary team color as the pants, and whatever the official helmet color
of that team is. home teams should wear primary jersey color, white pants and their official helmet".

All in `sd-reenact.js`.

- **Formations** follow the play's tag: "(Shotgun)" puts the QB 5 yd back, "(Pistol)" 4 with the
  back behind him, no tag means under center (1.2 yd). Five linemen on the ball at 1.35-yd splits,
  the center over it. Personnel by formation: shotgun passes 11/10/empty, under-center snaps 21 (I or
  offset), 12 or 22. Defense: four down linemen, a corner over every wide receiver, two safeties
  10-13 deep, nickel against three receivers and dime against four. A pass to a man who also runs the
  ball this game (`raQBs` now records rushers as `rb:offId:name`) goes to the back.
- **Kickoffs** use the 2024 dynamic setup: kicker at his 35 with the ball on a tee, the other ten on
  the receiving 40, nine receivers in the setup zone (seven on their 35), two returners in the
  landing zone. `sc.freeze` holds everyone but the kicker until the ball comes down. A touchback
  spots the ball at the receiving 35 (the 2025 rule).
- **Punts**: snapper and four linemen, a three-man shield 5 yd deep, gunners wide with two jammers
  each, the punter 15 deep; he catches, takes two steps, drops it to his foot and kicks.
- **Field goals and tries**: snapper, six linemen, two wings, the holder kneeling where the text's
  distance puts the kick (44 − 10 − 26 = 8 yd for Folk's 44-yarder), the kicker two steps back and to
  the side. Snap to the holder, place, approach, swing; the ball leaves the foot 1.3 s after the
  snap and tumbles end over end to the posts. Misses follow the text: wide left/right, short, off an
  upright or the crossbar; a block bounces off the named rusher. Tries: kicks from the 15 (33 yd),
  two-point plays from the 2. RESTAGED the old "two-point try gains 3" check to 2 yards.
- **Goalposts** (`RA_POST`, `RA_UPRIGHT`, `RA_BAR`): uprights 18'6" apart on the end line, the
  crossbar 10 ft up, 35 ft of upright above it, an offset post 2 yd behind. They are drawn in three
  depth-sorted pieces with a small perspective shift (seen exactly side-on every part would stack on
  one screen column), and a kicked ball near the posts shifts with them.
- **Players**: the stage is twice the old resolution (`RA_K = 2`: 336 px tall, 18/14/10 px per yard;
  every hard-coded pixel in the draw code, the 128-px side card and the big view's auto height scale
  with it). Each pose is a skeleton rasterised to a 34×40 grid: capsule limbs with three tones per
  colour, a dark rim on the near arm and leg, a one-pixel outline, a helmet with stripe and face mask,
  a jersey number that never mirrors. 22 poses, among them a four-frame run, 3-point stance, snap,
  QB under center, shotgun set, holder, kick wind-up and swing, punt, throw, catch and block.
  `raPoseAt` picks the pose. Canvases smaller on screen than their pixel count (the side card on a 1x
  monitor) are filtered instead of dropping rows.
- **Uniforms** (`raKit`): home in the primary jersey and white pants, road in white with primary
  pants, the official helmet from `RA_HELMET` (32 teams, sources in the comment: TEN is white since its
  March 2026 redesign, LAC white, NYJ green, CAR silver) or the primary for an unknown team. Numbers
  pick white or the second colour on a home jersey, the primary on a road one. Benches match.

Frame time, headless Chrome, 240 frames through each of the sampled plays (mean / p95 ms, before →
after): replay modal 0.12-0.21 / 0.3-0.4 → 0.11-0.37 / 0.2-0.9; side card 0.12-0.21 / 0.3-0.4 →
0.18-0.36 / 0.4-1.0; big view 0.15-0.25 / 0.3-0.6 → 0.15-0.31 / 0.3-0.7. The worst single frame
(first draw of a play, sprites being built) went from 6.6 to 7.8 ms. The field is painted once per matchup now
(`RA_ART`), not once per play. Cache-bust ?v=20260928a.

VERIFY: sunday 91/91 (section "8-bit staging, uniforms, resolution", 26 new checks, 1 restaged),
sunday-ff 53/53. Bite: the previous sd-reenact.js fails 25 of the 26 new checks and the restaged
one; "11 a side on every play" already held.
