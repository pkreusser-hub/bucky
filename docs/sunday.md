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

## 2026-09-28 — out of bounds ("pushed ob", "ran ob")

Perry: "when a play includes 'push ob' or 'ob' that means the ball carrier finishes the play
crossing out of bounds, so our animation should use that". raParse only knew "out of bounds", which
NFL text never says of a runner, so all 17 "ob" plays in the ATL @ GB fixture ended in a tackle in
the field. Now `oob` reads `ob` (a kick "out of bounds" is the ball, not a runner) and
`pushedOb` reads "pushed ob". The carrier's path ends a step past the sideline (`OOB_X`) and drifts
out; nobody tackles him. "pushed ob": the named defender (else the nearest) meets him on the line
and follows through. "ran ob (B.Cisse)": the named defender shadows him a stride off. "ran ob" with
no name: he steps out alone. Punt/kick returns do the same; the returner is now found in
"Z.Branch pushed ob at ATL 17".

Two things that bit: `go()` clamps every position a yard inside the field (a new `out` flag lets
an out-of-bounds move cross), and raBuild's last pass caps speed at 11 yd/s ÷ the easing's peak, so
a long pursuit eased like a lunge arrived yards short (the approach is now easing 0). Also fixed:
the tackler parse read the first parenthesis, so "(No Huddle, Shotgun)" named tacklers "No Huddle"
and "Shotgun". Cache-bust ?v=20260928b.

VERIFY: sunday 101/101 (new section "Out of bounds", 10 checks), sunday-ff 53/53. Bite: the
previous sd-reenact.js fails 8 of them.

## 2026-09-28 — injuries: two trainers and a stretcher

Perry: "if there is an injury on the play, 2 medical staff with a stretcher should come out and take a
guy off the field, show the guys name as he is carried off".

ESPN adds "ATL-J.Bates was injured during the play." after the play text (100 such plays across the
16 games that day). `raParse` returns `injured: [{team, who}]` (up to two are staged). A later
"** Injury Update: ATL-J.Bates has returned to the game." is not an injury. On a touchdown, an injury
written after "TWO-POINT CONVERSION ATTEMPT" or the extra point belongs to the try, and `raPatFrom`
carries it into the try it synthesises. That also fixed "C.Hubbard rushes up the middle", which the
try parser used to read as a pass.

In `raBuild`, after everything else: the man goes down where the play ended, at `sc.tEnd`. It is the
actor already carrying his name (Bates is a named tackler on 2505), or else the nearest unnamed
teammate to the ball, who takes it. Three teammates walk over and take a knee; anyone within 5.5 yd
backs off; anyone else on the ground gets up (`upAt`). 1.2 s after the result, and after any
walk-off on a No Play, two trainers (grey shirt with a red cross, navy trousers, bareheaded; side
`m`, variant `m` in the sprite system) jog out from his team's sideline (home near, visitors far)
with the stretcher between them. They set it down 1.25 yd from him, kneel, load him, lift and walk him
off past the sideline, his name tag over him (under him along the far sideline, where the banner
sits). The camera follows the stretcher. Banners and `sc.tEnd` are untouched, so the gate's result
moment is identical; only `sc.T` grows, to the carry-off plus a second: about 17 s for Bates, who
goes to the far side. The carried-off man is `gone`: the next huddle has 21 and a substitute runs on
for the next snap. Cache-bust ?v=20260928c.

New fixture `tools/fixtures/sunday/inj-401872949.json` (3.6 KB): four real CAR @ CLE plays (a No
Play injury, a kickoff injury with "CLV-", an injury on a failed two-point try, an injury update).

VERIFY: sunday 117/117 (section "Injuries: two trainers, a stretcher, his name", 16 new checks),
sunday-ff 53/53. Bite: the previous sd-reenact.js fails all 16 and passes the other 101.

## 2026-09-28 — real NFL kits, researched team by team

Perry: "do some research on each nfl team's primary kit, for example broncos should be white
pants, orange jersey, blue helmet". `raKit`'s generic rule (home = jersey in ESPN's `team.color`,
white pants; away = white jersey, pants in `team.color`) is wrong for a lot of teams — ESPN's
`team.color` is often not the jersey colour at all (Denver's is navy, but the actual home jersey is
orange), several teams (Dallas, and Carolina's schedule this year) don't wear their colour jersey
at home, and 2026 brought several real redesigns.

`RA_KITS` (in `sd-reenact.js`) replaces it: 32 ESPN abbreviations, each a `home` and `road` entry
(jersey/pants/helmet/num, all hex), plus `homeWhite: true` on Dallas. `RA_HELMET` is now *derived*
from `RA_KITS` (`v.home.helmet` per team) instead of being a second table that could disagree with
it. `raKit(homeTeam, roadTeam)` builds both sides for a game at once: the home team gets its `home`
entry, the visitors get their `road` entry — unless that pairs two white (or near-identical)
jerseys, in which case the visitors switch to their own colour (`home`) jersey instead, same as the
real NFL does (checked against a synthetic Dallas-at-home-vs-Giants-visiting case). An abbreviation
not in the table still falls back to the old generic rule. Numbers run through the existing
contrast fallback (`raSafeNum`) so a researched number colour that doesn't read on the sprite gets
swapped for white/black.

Sources are cited per team below; where the standard kit isn't a 2025-26 change I relied on the
teams' own long-standing identity (colour codes cross-checked against usbrandcolors.com /
teamcolorcodes.com / Wikipedia's `Module:Gridiron color/data`) rather than searching every team
individually. This session's scratchpad `kits.json` has the full per-team `note`/`sources` fields;
the highlights are below.

2025-26 redesigns found and applied: Atlanta (Apr 2026 — red jersey returns as home primary, white
pants, black helmet); Baltimore "Next Flight" (Apr 2026 — monochrome purple home / monochrome white
road, matte-black helmet both ways); Denver "Mile High" (2024 — orange jersey/white pants at home,
navy helmet: the exact case the user named); Houston (2024 — "Deep Steel Blue" jersey *and* helmet,
white pants); Tennessee (Mar 2026 — Oilers-blue home jersey, white road, and a white helmet/facemask
for the first time in franchise history); Washington (Apr 2026 — gloss-burgundy helmet with a gold
facemask, gold pants both ways). Confirmed unchanged this session (no error in the previous
RA_HELMET table): Indianapolis (white shell, not blue), Las Vegas (silver shell, not black),
Jacksonville (black shell is still standard, teal is the alternate), the Jets' green "Legacy"
shell, the Chargers' white shell.

| team | home (jersey/pants/helmet) | road (jersey/pants/helmet) | note |
|---|---|---|---|
| ARI | #97233F / white / white | white / #97233F / white | |
| ATL | #A71930 / white / black | white / white / black | 2026 redesign, red jersey returns |
| BAL | #241773 / #241773 / black | white / white / black | "Next Flight" Apr 2026 |
| BUF | #00338D / white / white | white / #00338D / white | |
| CAR | black / white / silver | white / black / silver | 2026: no white pants at home this year (schedule, not kit) |
| CHI | #0B162A / white / navy | white / #0B162A / navy | |
| CIN | black / black / black | white / black / black | standard is all-black, not "Open in Orange" |
| CLE | #311D00 / white / orange | white / #311D00 / orange | |
| DAL | white / silver / silver | #002244 / silver / silver | `homeWhite`: white at home since the 1960s |
| DEN | #FB4F14 / white / navy | white / white / navy | 2024 "Mile High"; the case the user named |
| DET | #0076B6 / silver / silver | white / silver / silver | |
| GB | #203731 / gold / gold | white / gold / gold | never wears white pants |
| HOU | #03202F / white / #03202F | white / #03202F / #03202F | 2024: "Deep Steel Blue" jersey+helmet |
| IND | #002C5F / white / white | white / #002C5F / white | white shell confirmed, not blue |
| JAX | #006778 / black / black | white / black / black | black shell confirmed standard |
| KC | #E31837 / white / red | white / #E31837 / red | |
| LV | black / black / silver | white / black / silver | silver shell confirmed, not black |
| LAC | #0080C6 / white / white | white / #002A5E / white | white shell confirmed, powder blue is standard home |
| LAR | #003594 / white / blue | white / white / blue | |
| MIA | #008E97 / white / white | white / #008E97 / white | |
| MIN | #4F2683 / white / purple | white / #4F2683 / purple | |
| NE | #002244 / silver / silver | white / silver / silver | |
| NO | black / black / gold | white / black / gold | |
| NYG | #0B2265 / white / blue | white / white / blue | |
| NYJ | #115740 / white / green | white / #115740 / green | green shell confirmed standard |
| PHI | #004C54 / white / green | white / white / green | home pants corrected black → white on review (onpattison.com) |
| PIT | black / gold / black | white / black / black | |
| SF | #AA0000 / gold / gold | white / gold / gold | |
| SEA | #002244 / navy / navy | white / navy / navy | home pants corrected grey → navy on review (seahawks.com) |
| TB | #D50A0A / pewter / pewter | white / pewter / pewter | |
| TEN | #4495D2 / white / white | white / white / white | Mar 2026 Oilers rebrand, white helmet |
| WSH | #5A1414 / gold / burgundy | white / gold / burgundy | Apr 2026 rebrand |

Sources (spot-checked, not exhaustive — the full list with a URL per team is in the scratchpad
`kits.json`): [Falcons 2026 uniforms](https://www.espn.com/nfl/story/_/id/48378096/atlanta-falcons-new-uniforms-2026),
[Ravens "Next Flight"](https://www.baltimoreravens.com/news/ravens-new-uniforms-jerseys-helmets-next-flight-collection-midnight-purple-matte-black-wings-talon-stripes),
[Broncos 2024 uniforms](https://www.espn.com/nfl/story/_/id/39997084/denver-broncos-new-uniforms-mile-high-nfl-2024),
[Texans 2024 redesign](https://www.nfl.com/news/houston-texans-unveil-first-uniform-redesign-since-franchise-s-inception-in-2000),
[Titans 2026 uniforms](https://www.espn.com/nfl/story/_/id/48189440/tennessee-titans-nfl-new-uniforms-2026),
[Commanders 2026 uniforms](https://www.commanders.com/news/commanders-2026-uniform-inspired-franchise-history),
[Colts helmet](https://www.sportslogos.net/logos/view/15866112023/Indianapolis-Colts-Logo/2023/Helmet-),
[Raiders helmet](https://www.riddell.com/riddell/en/Open-Catalogue/Collectibles/NFL/Authentic-Full-Size/Las-Vegas-Raiders-Authentic-SpeedFlex/p/000000000008055805),
[Jaguars 2026 jerseys ranked](https://www.colorwaysports.com/stories/jaguars-jerseys-2026-ranked),
[Chargers 2026 schedule](https://sports.yahoo.com/articles/chargers-2026-uniform-schedule-la-212338497.html),
[Cowboys white at home](https://www.wfaa.com/article/sports/nfl/cowboys/why-the-dallas-cowboys-almost-always-wear-white/287-4fb08ca5-c939-430d-b44a-b25a1ec67a23).

Verified with screenshots: GB(home)/ATL(away) — GB's green/gold/gold kit and ATL's white/white/
black road kit both render correctly at the LOS; a synthetic DEN-home scene close-up confirms the
orange jersey/white pants/navy helmet combo pixel for pixel; a synthetic Dallas(home)-vs-Giants
scene confirms the white-vs-white clash rule (the Giants switch to their navy home jersey rather
than also wearing white). Cache-bust ?v=20260928d.

VERIFY: sunday 121/121 (section "8-bit staging, uniforms, resolution" restaged — the old checks
encoded the generic rule the user asked to replace — plus 8 new checks: RA_KITS shape/hex, the
GB/ATL real-kit assertions, an unknown-team fallback, the DEN case, the white-vs-white clash),
sunday-ff 53/53. Bite: restoring HEAD's sd-reenact.js against the new tests fails exactly those 8
(all other 113 checks, including the untouched RA_HELMET-coverage check, still pass).

## 2026-09-28 — live view keeps up; one-colour helmets

Perry: "I keep having to refresh to see latest play". With the 8-bit field on, the page holds the
score and last play until the animation reaches that play (the gate). Watching LAR @ DEN live on the
site, a play already in the feed reached the last-play card ~30 s late. The hold only ever ended by
its 45 s cap, partly because the test pane was hidden and a hidden page runs no animation frames.
Changes: the gate caps at 15 s (was 45); it only engages while the 8-bit canvas is on screen and the
page is in front (`tecmoOnScreen`, `document.hidden`); coming back to the page opens any held gate; the
live view jumps to the newest play when more than one behind (`sideNext`, was up to two at a time); and
once the current scene has shown its result, a newer play cuts in instead of waiting for the
walk-back, huddle or a stretcher.

Perry: "the players have two colors on their helmet, make the helmet 1 solid color". The shell is one
flat `H`: no stripe, no shadow/highlight tones. Cache-bust ?v=20260928e.

VERIFY: sunday 123/123 (2 new: head pixels are all shell, 0 of 50 other tones where HEAD had 30;
sideNext jumps when 2 or 5 behind), sunday-ff 53/53. Bite: HEAD fails both.

## 2026-09-28 — Replay on the 8-bit view: game start or this drive, at 1×, 2× or 3×

Perry: "On the gffl scores, the 8-bit animation feature, i want to give the option to hit replay like
we have on the field view, and then replay gives the option for game start or this drive. Add a 2x
and 3x option to replay".

The field caption's Replay button used to be hidden on the big 8-bit view (`.stadium.tecmo
.rp-start`). It now shows there, and on the 8-bit view it opens a row under the stage (`#bt-rp`)
instead of starting the field replay: **Game start**, **This drive**, and a 1× / 2× / 3× speed
picker (remembered as `sun.tecmoSpeed`). Game start begins at the opening kickoff; This drive at the
first play of the drive the newest play is in (a synthesised try goes with its touchdown's drive).
The field view's own Replay and its 1× / 2× button are unchanged.

In `sd-reenact.js` (`tecmoRp*`): the plays run back to back on the big stage through the same
`sideRun` as the live view, each built from the scene before it (`sideFrom`, pulled out of
`sidePlay`), so the players jog from one play into the next formation. The speed multiplies the
stage clock in `sideResume`, and the pause between plays is 900 ms divided by the speed. The play's
text shows when its result does, as it does live. The bar reads "Replay · Q1 15:00", with Back to
live (Exit replay on a final). While a replay runs `sideLiveOn()` is false, so the page's score is
never held back for the stage. `sideUpdate` leaves the stage to the replay, and drops the replay if
the viewer switches to the field view or the game view is rebuilt. Plays that come in during a
replay join the list. When the replay reaches the newest play it ends and the live view carries on
from there (the huddle at the next spot). Leaving early replays the newest play fresh. Cache-bust
?v=20260928f.

VERIFY: sunday 141/142 (new section "8-bit replay: game start or this drive, 1× 2× 3×", 19 checks;
it opens the real game view on the ATL @ GB fixture through a request mock), sunday-ff 53/53. The one
failure, "the widest label's ink fits its box", fails the same way on HEAD in a container without
the Barlow webfont (57.7 px ink against 52 px of room) and is not touched by this change. Bite: the
previous files fail 16 of the 19 new checks; the three that pass are the game view opening and the
two field-view regression guards.

## 2026-09-28 — a retro score bug on the 8-bit screen

Perry: "We need to add a little SNF style (retro) score bug at the bottom of the 8 bit screen
showing score, time and and down and distance".

`raBugDraw` (end of `raDraw`, so every 8-bit stage has it: the big view, the play viewer, the
desktop side card) draws it into the canvas in the scoreboard font (`bigText`; `:` and `-` added to
`RA_BIG`): each team's abbreviation on its colour (`pair()`'s raw colours, the ones the banners
use) with its score, a football by the team with the ball, a navy clock box, and the down and
distance in gold. It is centred along the bottom, just above the yard ruler where there is one, as
large as fits in 90% of the width (2 to 4 canvas pixels per glyph pixel), and one width on every
play: the boxes are sized for two digits, "Q4 15:00" and "4TH & GOAL". It is cached as an image and
rebuilt only when what it says changes.

What it says: on a play (`sc.play`, now set by `raBuild`), the score before the snap until the
result shows, then after, so it never gives a play away and agrees with the page's held score. ESPN's
score on a touchdown already counts the try, which plays as its own scene, so the touchdown shows
the six and the try the rest (`raBugPlay` walks `raPlays()` once per scene). The clock and down are
the snap's; kickoffs read KICKOFF, tries PAT or 2-PT TRY. Between plays (huddle, timeout, halftime,
lined up for the next snap) it shows the game as it is (`raBugLive`): HALF at halftime, FINAL after.
Cache-bust ?v=20260928g.

VERIFY: sunday 153/154 (new section "Score bug on the 8-bit screen", 12 checks, all hand-read from
the ATL @ GB fixture: the kickoff 0-0 at Q1 15:00; the GB touchdown 0-0 before its result, GB 6
after, 7 after the kick; ATL's 27 → 33 → 35 two-point try; centred above the ruler; one width; box
colours and gold pixels sampled off the canvas; the play viewer; the between-plays state), sunday-ff
53/53. The one failure is the webfont ink check that fails the same way on HEAD in this container.
Bite: the previous sd-reenact.js fails 11 of the 12; the game view opening passes.

## 2026-09-28 — replays of finished games use what really happened (nflverse + FTN)

Perry: "do some looking to see if there is play by play data available anywhere after the game that
gives us more fidelity on exactly what happened on a given play that we could apply to replays" →
"Do it". Survey (sources tested from the container, ATL @ GB): nflverse play-by-play is free and
has a finished game the same night (air yards, yards after the catch, QB hits, pass location);
FTN's charting, also through nflverse, follows in a day or two (hash, QB alignment, backfield
count, box count, pass rushers and blitzers, play action, motion, screens, out of the pocket,
throwaways, drops). Participation (routes, coverage, all 22 players) only appears after the Super
Bowl; NGS tracking and api.nfl.com need tokens; Sportradar and PFF are paid.

**`netlify/functions/pbpdetail.mjs`** — `GET /.netlify/functions/pbpdetail?event=<ESPN id>`. GitHub
release assets send no CORS headers, hence the function. games.csv's `espn` column gives the
nflverse game_id; the season's pbp .csv.gz is streamed and the game's rows kept (stops at the next
game); FTN's rows are merged on play_id when charted. ESPN play id = event id + nflverse play_id
(162 of 162 real plays matched on ATL @ GB). Other games' rows are cut into records but never split
into fields: 2025's Super Bowl, the worst case (last in a 98 MB file), takes 1.2 s locally, down
from 3.5 s with a character-at-a-time parser; ATL @ GB from the real upstream 0.9 s, 42 KB of JSON.
CDN-cached per event (`Netlify-Vary: query=event`, durable): 30 days once FTN has charted the game,
an hour before that, 10 minutes for `not-yet`. FTN writes "0" for a kick's hash and QB alignment;
only L/M/R and U/S/P go out. `NA` is treated as missing.

**Client (`sd-reenact.js`)** — `raDetailLoad` asks once per game view, only for a finished game;
`raBuild` reads `raDetail(p)` (or `opts.detail`). Every field is optional and the text-only staging is
unchanged without it. What each field does:
- `air` → the catch point (or target, or pick) is the line + air yards; a completion's gain after it is
  the yards after the catch. The screen on play 85 is caught 6 yd behind the line, not 10 in front.
- `qbl` → under center / shotgun / pistol, over the text's tag (ESPN writes "(Shotgun)" on six pistol
  snaps in ATL @ GB). `bf` → the number of backs (a second back beside the QB out of the gun/pistol).
- `hash` → the snap spot on the L / M / R hash. **Assumed to be from the offense's side of the ball**
  (FTN's dictionary doesn't say; unverified).
- `box` → safeties, then the nearest corners, walk down into the box, or linebackers widen out, until
  the count is FTN's (all 127 charted runs and passes in ATL @ GB match).
- `rush` / `blitz` → blitzers from the linebackers, slot corner and safeties go at the QB and don't
  cover; a three-man rush drops the widest lineman.
- `pa` → the QB and back mesh for the fake, the back carries on into the line, the short defenders
  bite, the throw comes 0.45 s later. `mot` → the slot starts 5 yd inside his spot and motions out in
  the second before the snap; the man over him follows. `screen` → a quick throw, three linemen lead
  upfield. `oop` → the QB rolls toward his throw. `hit` → a rusher reaches him at the release and both
  go down. `ta` → the ball sails past the sideline ("Thrown away"); `drop` → it falls at the
  receiver's feet ("Dropped").
- The result never moves: every banner reads the same with and without the detail (save "Thrown
  away" / "Dropped" for "Incomplete"). The credit "Play detail: nflverse. Charting: FTN Data via
  nflverse." shows under the big 8-bit view and in the play viewer whenever the detail is in use
  (FTN's CC-BY-SA 4.0 licence asks for it). Cache-bust ?v=20260928h.

VERIFY: sunday 176/177 — new section "Real play detail" (20 checks, every number read off
`tools/fixtures/sunday/pbp-401872948.json`, the function's real output for ATL @ GB, cross-checked
against an independent Python cut: identical save the unused `dur` rounding on three plays) and 3
checks in the game view (asked once, used, credited); the one failure is the webfont ink check that
fails the same way on HEAD. pbpdetail 61/61 (`node tools/_verify-pbpdetail.mjs`; fixtures cut from
the real files in `tools/fixtures/pbpdetail/`, one desc edited to carry a comma and an escaped
quote). sunday-ff 53/53. Bite: the previous sd-reenact.js fails 19 of the 23 new Scores checks (the
four that pass are invariants: the yards after the catch, 682 under center from its text, 11 a side,
results unchanged); the function suite's bites (`PBP_FN=`) fail their checks — `x || 0`, a naive
comma split, no early stop, and passing FTN's "0" through.

## 2026-09-28 — touchback interceptions, kicks out of bounds, fair catches, facing

Perry, on LAR @ DEN's last play ("Stafford pass deep right intended for Adams INTERCEPTED by
Hufanga at DEN -1. Touchback."): "Our animation shows him catching the ball in the endzone but then
running it to the 20 yard line and getting tackled … incomplete passes should use the same card
color as complete ones … If a punt or kick goes out of bounds animation should show that. if its a
fair catch, ball should always land on the returner. quarterback should always face towards the
line of scrimmage. all players should face into the huddle, not out of it."

- **Touchback interceptions.** ESPN's end spot on a touchback is the 20 the ball comes out to, and the
  return ran there. Now the pick is made in the end zone and he takes a knee: "Intercepted", then
  "Touchback". `RA_SPOT` also reads a minus ("DEN -1" is a yard deep), which it used to skip, so the
  catch is a yard deep rather than wherever the text-free guess put it.
- **Incomplete** (and "Thrown away" / "Dropped") cards are in the offense's colour, like a completion's.
- **Kicks out of bounds** ("punts 48 yards to ATL 11, …, out of bounds"; `kOob`, not the runner's
  `oob`): the ball comes down by a sideline and bounces over it where the next snap is spotted. The
  banner reads "Out of bounds".
- **Fair catches** came down 6.7 yd from the returner on all four in ATL @ GB. After he reached his
  spot, the generic chase moved him along with the ball in the air. He now stands still from his spot
  until after the catch, and every caught kick (fair or returned) is aimed at where he really is at
  the landing (`sc.catchOn`, applied after the speed cap, which can shorten his run).
- **The QB faces the line of scrimmage** for the whole play, drop-back and rollout included, until the
  defense has the ball or the play is over. Before this, 240 of 511 frames across 14 pass plays had
  him facing his own end zone.
- **Huddles:** `raHuddle` records each huddle's middle (`sc.hud`); a player standing in a huddle
  faces it, as he does in the first half-second of the next snap's scene before they break.
  Cache-bust ?v=20260928i.

New fixture `tools/fixtures/sunday/inttb-401872962.json` (10 KB): LAR @ DEN's real last drive.

VERIFY: sunday 185/186 (new section "Touchbacks, kicks out of bounds, fair catches, facing", 9
checks; the one failure is the webfont ink check that fails the same way on HEAD in this container),
sunday-ff 53/53, pbpdetail 61/61. Bite: the previous sd-reenact.js fails 8 of the 9; McKinney's
real 5-yard return (the guard that a return still runs) passes on both.

## 2026-09-28 — the week-3 Sunday audit: every play drawn against its text

Perry: "pick a few games from yesterday and review each plays animation against the description to
see if we've fixed all the disconnects". LAR @ DEN, NE @ JAX, SEA @ WSH and BAL @ DAL (690 plays,
with their nflverse detail; FTN hadn't charted them yet). A scratchpad audit built every play with
the real sd-reenact.js and checked:
- end spot against ESPN's, and the result cards against the text
- who holds the ball at the end, and whether the named players are labelled
- named tacklers reach the carrier, and runners marked "ob" go out of bounds
- kicks: fair catches, touchbacks, out of bounds, returns
- 11 a side, player speed over 13 yd/s, the ball moving more than 2.6 yd in 0.05 s
- QB facing (3,260 drawn frames, all correct)

It flagged 137 plays; after the fixes 4, all of them the checker's own limits. Contact sheets of
the fixed plays were reviewed by eye.

**The biggest cause was one mechanism.** raBuild's last pass caps every leg's speed at 11 yd/s
divided by its easing's peak, shortening the leg. Anything scripted to meet a point with an eased
leg stopped short of it:
- a 48-yd TD's run after the catch ended at the 4
- sacks ended 3 yd behind their spot
- tacklers ended up to 9 yd off the man they tackled
- catches: the ball jumped 3–9 yd to the receiver as he caught it

The fixes:
- Last legs into a tackle and runs after the catch are flat-out (easing 0).
- A sack at or ahead of the QB's drop has him climb the pocket into it.
- A tackler's lead time is measured after his chase is scripted, and redone with a longer lead if he
  still needs over 9.5 yd/s.
- After the cap, every ball in the air starts from the hands it leaves and ends in the hands that
  take it, at the held ball's +0.35/+0.25 yd.

Other fixes:
- **A touchdown carrying its two-point try was drawn as the try** ("Two-point no good", no touchdown):
  `twoPt` reads only the play's own text, and the try is its own scene (raPatFrom).
- **A pick six against two receivers crashed the play** (no nickel, so `def.NB` was null inside
  nearest()).
- **"FUMBLES (X), and recovers at …"** (the fumbler falls on it) went to the defense; `recTeam` is now
  his own team.
- **"pushed ob" / "ran ob" with nothing after the catch, on a run for no gain or a loss, and on an
  interception return** now go over the sideline (22 plays in the four games).
- **A kick return with a penalty** ran to the enforced spot; it ends at the text's return spot
  (`retH`).
- **A kickoff out of bounds** rolled to the 40 the penalty spots it at; it goes out where it landed.
- **Kick touchbacks** no longer put the ball on the 20/35 in one frame (a 25–40 yd jump). It stays
  where it died, and `sc.spotZ` still carries the next snap's spot (sideHuddle reads it).
  RESTAGED: the suite's "the ball ends at the receiving team's 35" check.
- **"INTERCEPTED by X (K.Turner)"** credits the tipper; his name was handed to an offensive player
  (stealing the intended receiver's label). Only names after the pick tackle the return.

RESTAGED as well: four checks measured the ball's end point at a catch exactly. It is now aimed at
the catcher's hands, hypot(0.35, 0.25) = 0.43 yd off his feet. Each check says so at the check.
Cache-bust ?v=20260928j. New fixture `tools/fixtures/sunday/audit-20260927.json` (19 KB): the 16 real
plays behind the fixes, with their nflverse detail.

VERIFY: sunday 197/198 (new section "Week-3 Sunday audit", 12 checks; 4 restaged; the one failure is
the webfont ink check that fails the same way on HEAD in this container), sunday-ff 53/53, pbpdetail
61/61. Bite: HEAD's sd-reenact.js fails all 12 new checks and the 4 restaged ones.

## 2026-09-28 — spikes

Perry: "in the rams final drive Stafford spiked the ball to stop the clock, but it was animated like
he thru an actual route, when it should be him stepping back and tossing the ball at the ground".
ESPN files "(No Huddle) M.Stafford spiked the ball to stop the clock." as a Pass Incompletion, so it
was staged as a full incomplete pass: a 7-yard drop, routes, a throw 15 yards downfield. `raParse`
now reads `spike` (and `spiker`, since there is no "pass" to find the passer by), and raBuild has a
`spike` kind beside `kneel`. The snap, one step back, the ball thrown straight into the turf about a
yard in front of him, one bounce and a short roll. The line fires out and stops, receivers take a
step, and nobody runs a route. The card reads "Spike · Clock stopped" in the offense's colour, and
the whistle is on the spike. The three spikes in the audited week-3 games (two by Stafford, one by
Lawrence) all draw this way. Cache-bust ?v=20260928k.

VERIFY: sunday 200/201 (3 new checks on LAR @ DEN 5022 in "Touchbacks, kicks out of bounds, fair
catches, facing"; the one failure is the webfont ink check that fails the same way on HEAD in this
container), sunday-ff 53/53, pbpdetail 61/61. Bite: HEAD's sd-reenact.js fails all 3 (thrown 15 yd
downfield 1.6 s after the snap, the QB 6.75 yd back, a receiver 12 yd downfield).

## 2026-09-28 — the field-goal celebration: Rudy, and the defense slinks off

Perry: "after a field goal the kicking team should celebrate and lift the kicker up and toss him in
the air like rudy … and the defense should slink off the field".

After a good field goal (not a try, which stays routine), `fgCelebrate`:
- the ten other men on the kicking unit run to the kicker; three get under him, the rest jump
  around him cheering
- they hoist him onto their shoulders, toss him up twice and carry him 5 yards toward their own
  sideline
- `a.hoist` drives the drawing (`raHoistLift`): 13 sprite pixels up onto the shoulders, 18 more at
  the top of each 0.6-s toss; he is drawn over the men holding him, arms up, name tag riding with
  him
- the camera stays on them (`sc.focus`)

The defense slinks off: each coasts to a stop, stands a moment, then walks slowly (2.4–3 yd/s) past
his own sideline. That walk is now `slinkOff`, shared with the team that gives up a touchdown.
The "Field goal good" card and `sc.tEnd` are unchanged; only `sc.T` grows, by about 5 s.
Cache-bust ?v=20260928l.

VERIFY: sunday 205/206 (5 new checks on ATL @ GB 1661 in "Touchbacks, kicks out of bounds, fair
catches, facing"; the one failure is the webfont ink check that fails the same way on HEAD in this
container), sunday-ff 53/53, pbpdetail 61/61; the week-3 audit is unchanged (the same 4
checker-limit flags). Bite: HEAD's sd-reenact.js fails all 5.

## 2026-09-28 — three notes removed

Perry: "get rid of this text: Drawn from the play-by-play. The spots, yardage and named players are
real; the other players and their routes are illustrative. / Play detail: nflverse. … and also: 5
earlier snaps not drawn". The play viewer's note (`.ra-note`, CSS gone too), and the drive summary's
"N earlier snaps not drawn" (the field view still draws the last 5 plays on a phone and 8 wider; it
just no longer says so). The play-detail credit keeps only FTN's own line, "Charting: FTN Data via
nflverse.", shown only once FTN has charted the game: its CC-BY-SA 4.0 licence requires the credit
wherever its charting is used. RESTAGED the two credit checks. Cache-bust ?v=20260928m.

VERIFY: sunday 207/208 (the two credit checks restaged, 2 new: no viewer note, no "not drawn"; the
one failure is the webfont ink check that fails the same way on HEAD in this container),
sunday-ff 53/53, pbpdetail 61/61. Bite: HEAD fails the 2 new and the 2 restaged.

## 2026-09-28 — the Scores tab is the game detail; the scoreboard page is gone

Perry: "for the GFFL scores tab, just have it only be the detail page, we no longer need this page
since all the relevant info is in the detail and the fantasy matchup is covered on its own tab".

- **Landing.** With no game (or team) in the hash, `ensureGame()` opens `defaultGameId()` with
  `replaceState`. It runs after every board load and at the end of `route()`. The default:
  - the most exciting live game (`excitement()`: your followed teams +100, your GFFL starters by
    `ffGameWeight`)
  - else a game kicking off within 3 hours
  - else the latest final
  - else the next game
  An old `#matchups` / `#standings` link lands there too. After the viewer picks another week, the
  open game gives way to that week's default (`S.weekPicked`).
- **The header.** The back button ("‹ Scores") is gone: there is no board to go back to, and Escape
  no longer closes a game. In its place, the week picker (‹ Wk 3 ›, `#gv-week-*`, sharing
  `renderWeekLabel`) and Settings (`#gv-settings`), which used to live only in the board's top bar.
  Under them on phones is **the game strip** (`#g-strip`): this week's games, live, then upcoming,
  then finals latest first, the open one lit and scrolled into view. Tapping one swaps it in with
  `replaceState`, as the desktop sidebar already did (desktop keeps the sidebar and hides the strip).
- **The GFFL bar stays visible.** The game view used to cover everything (z-index 40) over the board.
  It now stops at the bar on phones (`bottom: 58px + safe area`) and starts under GFFL's 34px top
  strip on desktop.
- **The board** (`#board-view`) is only the loading screen now, and the page a week with no games
  would show. It is hidden while a game is open. Its GFFL matchup card (`#ff-head`) and status line
  are hidden for good. The board still loads and polls, always now (it used to pause on phones): it
  feeds the strip, the sidebar and the default pick. Cache-bust ?v=20260928n.

VERIFY: sunday 215/216 (new section "Scores is the game detail", 8 checks: the default rule on
hand-built weeks, landing on it, the GFFL bar tappable on phone and desktop, the strip lit and in
view, a strip tap swapping without history, the week picker and Settings in the header, #matchups
landing on a game, the desktop sidebar; RESTAGED the no-data #matchups check, with the reason at the
check; the one failure is the webfont ink check that fails the same way on HEAD in this container),
sunday-ff 53/53, pbpdetail 61/61. Bite: HEAD's sd-app.js and sd.css fail all 8.

## 2026-09-28 — GFFL's header on desktop; home end zones; the halftime desk

Perry: "Scores page should fit within the GFFL desktop site like the other GFFL pages, right now it
has its own top bar and the GFFL header goes away, should feel like any other GFFL tab. Also, do
some research on endzone styles for each team, and the endzones should always reflect the home team,
not be different on either side. for half time, since nfl doesnt have marching bands, lets have the
view change to 4 people around a desk … wearing suits (this is all still retro) and going back and
forth with chat bubbles analyzing the half. have opus 5.5 write some dialogue for each of the 4
people so that the whole thing lasts around a minute, and if you revisit the page while its half
time it just replays the same dialogue".

- **GFFL's header (desktop, ≥1024px).** `#ghdr` in sunday.html copies league.html's desktop
  masthead, measured off it: 46px with a 3px red top rule, THE GFFL (links to the league), the
  tagline centred, the crest at the right. The slot where GFFL shows "Week N · year" holds the week
  picker (`#gh-week-*`, one more prefix in `renderWeekLabel`) and Settings (`#gh-settings`), plus your
  GFFL team's crest (`#gh-av`, `ffHeaderAvatar`) linking to My Team. The tab strip sticks under it at
  46px, as `#bnav` does there; the game view starts at 80px. Scores' own bars are gone on desktop:
  the board's top bar, and the detail's week row (its phone strip of games stays until the 1080px
  sidebar takes over). Phones are unchanged: GFFL's phone header would take 52px from the game.
- **End zones: the home team's, both ends.** They used to be one team's each (away left, home right).
  `EZ` in sd-app.js holds every team's own paint: fill, a diagonal hatch where a team paints stripes
  (Cincinnati's tiger stripes), the words at each end (often the nickname at one, the city at the
  other), the lettering colour and its outline, and whether the logo sits beside the word.
  `ezStyle(home)` feeds both the field view's SVG and the 8-bit field (`raOutlined` draws the
  lettering with a one-third-glyph-pixel outline, so the letters' counters stay open). Research by a
  web-search pass, which mostly found text pointing at photo galleries it could not see:
  - fill and words confirmed in text: BAL (black, RAVENS / BALTIMORE), BUF (the new Highmark
    Stadium's blue; its opener used throwback red), CIN (BENGALS / CINCINNATI, stripes sewn in), DEN
    (BRONCOS, orange letters edged white), GB (dark green; gold and white the only paint colours),
    LV (black and silver), MIN (purple panels, VIKINGS), NE, PHI and SEA (from their Super Bowl end
    zones), PIT (STEELERS at the south end, PITTSBURGH in gold at the north)
  - everything else (lettering colours, outlines, word splits, ATL's black vs red, KC's regular-season
    red, LAC's navy vs powder, TEN's and WSH's 2026 rebrands) is broadcast recollection, low
    confidence. MetLife and SoFi repaint per home team, so NYG/NYJ and LAR/LAC each keep their own.
    Special fields (throwback weeks, Arizona's Rivalries field) are not modelled.
- **The halftime desk** replaces the home band (`raHalftime`, and the band's sprites and palette,
  gone). The 8-bit view at halftime is a pixel studio: four analysts in suits waist-up behind a GFFL
  desk, light columns in both teams' colours, a monitor with HALFTIME and the score, the score bug
  (HALF) underneath. Speaking mouths move, the speaker lifts a hand now and then, the others look at
  whoever is talking, everyone blinks. The line being said is an HTML chat bubble (Press Start 2P,
  wraps; the speaker's name in their suit colour; a tail down to their head), pinned over the speaker
  and kept inside the stage. On a narrow stage (a phone, the sidebar card) the desk takes a 4:3 frame
  (`studio-tall`; the sidebar's fixed-height canvas grows by the same 1.2 so the score bug still fits),
  as a 16:10 phone stage left a long line's bubble no room above the heads. The cast is fixed so the
  show has regulars: Hal Brandt (host), Chuck Varney (ex-quarterback), Moose Tillman (ex-linebacker),
  Dot Keene (numbers and fantasy).
  - **Timing** (`htTimeline`): each line gets 1.1 s + 0.26 s a word, 0.3 s gaps, scaled so the show
    runs a minute (within 0.8× to 1.25× of that pace), after a 1.4 s open; then a 6 s break and it
    starts over.
  - **The script** comes from `netlify/functions/halftime.mjs` (GET `?event=`). The first request at
    halftime claims Firestore `sunday_halftime/<event>` with a create-only write (two phones opening
    the game together start one job) and starts `halftime-background.mjs` (15-minute allowance: an
    Opus call with thinking outruns a synchronous function here). The job builds the half's facts
    from ESPN's summary on the server (`halftimeFacts`: score, first-half scoring plays, ESPN's
    leaders and team stats, drive results, big plays, turnovers and sacks, nothing past Q2) and asks
    `claude-opus-5-5` (medium effort, structured JSON output, `fallbacks: "default"`; asked again
    without it on a 400) for 14 to 18 lines, 150 to 190 words, facts only. `cleanScript` keeps 8 to 24
    lines with every speaker heard. Every later request returns the stored lines (CDN-cached for good),
    so a revisit replays the same dialogue. A failed or stuck try (4 minutes) may be re-claimed, 3 tries
    per game. Only a real ESPN event at halftime gets a script, so the public endpoint cannot run up
    model calls. Env: ANTHROPIC_API_KEY, FIREBASE_SERVICE_ACCOUNT, BUCKY_NOTIFY_SECRET (all already set
    for books.mjs and farmgpt.mjs).
  - **The page** (`htLoad`) polls every 5 s while the script is written (about 3 minutes): the host
    opens with the score and the analysts "think" ("…"), then the script starts from its first line.
    If no script comes, a five-line stand-in keeps the desk talking. Every visit to the game at
    halftime starts the show from the top (a freshly opened game view drops the old desk).
  Cache-bust ?v=20260928o.

VERIFY: sunday 239/240 (3 new sections, 23 new checks: "GFFL's header on desktop" 5, "End zones: the
home team's, at both ends" 4, "Halftime: the studio desk" 14; RESTAGED the two desktop-geometry checks,
the strip now under GFFL's 46px header and the detail at 80px, with the reason at each; the one
failure is the webfont ink check that fails the same way on HEAD in this container), sunday-ff 53/53,
pbpdetail 61/61, halftime 36/36 (new suite, fake ESPN / Google token / Firestore with real
precondition refusals / Anthropic / background runner). Bite: HEAD's app files fail the 23 new and the
2 restaged, every other check passing; a copy of halftime.mjs without the create-only claim fails the
claim and race checks, one without the Q2 filter fails the facts check. No live Opus call was made from
this container (no key here); the page's fixture script is hand-written in the model's output shape
(tools/fixtures/halftime/script-401872948.json).

**Test link: `?halftime=demo`** (Perry: "give me a test link", with no game at halftime). On a finished
game, `sunday.html?halftime=demo#g<event>` plays its first half at the desk: the monitor and the bug
show the score as it stood after the last Q2 play (`htDemoEv`), and the page asks the function with
`&demo=1`. The function writes a real Opus script for a FINAL only (`not-final` otherwise), from the
half's facts with the score at the break and no leaders or team stats (ESPN's are the full game's by
then), stored apart as `sunday_halftime/demo-<event>`: one call per game at most. `Netlify-Vary` is
now `query=event|demo`.

VERIFY: sunday 240/241 (1 new: the demo on the ATL @ GB final shows 17-7 and HALF and asks for the demo
script), halftime 40/40 (4 new demo checks; the Vary check restaged to `query=event|demo`). Bite: the
previous sd-reenact.js fails the new page check; the previous halftime.mjs fails the 4 demo checks and
the restaged Vary check.

## 2026-09-28 — the postgame desk; four sharper voices

Perry: "ok now we need a post game version and this can be about 2 minutes long, can differentiate
the commentators a bit with more personality".

- **Where.** A final's 8-bit view (the big stage, and the desktop sidebar card) now rests on the
  postgame desk instead of the game's last play. The monitor reads FINAL, the bug FINAL and the final
  score, the caption "The GFFL postgame desk". Replay still runs the game or a drive, and Exit replay
  hands the stage back to the desk. A game that ends while you watch plays its last play out first.
  `?halftime=demo` still shows the halftime desk on a final.
- **The script.** The halftime function's `&kind=post`: a FINAL only (`not-final` otherwise), the whole
  game's facts (every scoring play through Q4, ESPN's leaders and team stats, all drives, the last 28
  big plays and turnovers), stored as `sunday_halftime/post-<event>`, once per final, the first time
  anyone opens it. Opus is asked for about two minutes: 26 to 32 lines, 300 to 370 words, each analyst
  at least 6 times, the host opening on the final score and signing off, with some shape (a first take,
  an argument, a verdict) and the turning point, the player of the game, a play each analyst loved,
  and the fantasy fallout. `cleanScript` keeps 16 to 40 postgame lines. The page times it to 120 s
  (`HT_POST_TARGET`, same 0.8× to 1.25× squeeze) and keys it apart (`htKey`, `post:<id>`).
  `Netlify-Vary` is now `query=event|demo|kind`.
- **Four voices** (both shows, one `PEOPLE` block in the prompt):
  - Hal Brandt, host: silver-haired pro, smooth as a late-night radio DJ, groan-worthy puns, keeps the
    peace, hands off by name.
  - Chuck Varney, ex-quarterback from West Texas: folksy, ranch-and-farm comparisons, sticks up for
    the quarterback, misty about how football used to be played.
  - Moose Tillman, ex-linebacker: loud, lives for hits, sacks and takeaways, "grown-man football",
    needles Chuck.
  - Dot Keene, numbers and fantasy: deadpan, settles arguments with a stat, talks to fantasy managers,
    one dry zinger a show.
  They must never repeat a catchphrase, and each line should sound like only its speaker could say it.
- **Fixture:** the page's postgame script (tools/fixtures/halftime/script-post-401872948.json) is the
  deploy preview's real reply for ATL @ GB, written by claude-opus-5-5: 28 lines, 369 words, 122 s.
  Cache-bust ?v=20260928p.

VERIFY: sunday 244/245 (new section "The postgame desk", 4 checks; RESTAGED "Exit replay puts the final
play back" to the desk, with the reason at the check; the one failure is the webfont ink check that
fails the same way on HEAD in this container), halftime 47/47 (7 new, the Vary check restaged to
`query=event|demo|kind`), sunday-ff 53/53, pbpdetail 61/61. Bite: the previous sd-reenact.js fails the
4 new page checks and the restaged one; the previous halftime.mjs fails all 8 new or restaged function checks.

## 2026-09-28 — the desks' scripts are written when the game gets there, not when someone looks

Perry: "We need to make it so that after the game ends it triggers the script creation, not someone
just opening it because then they just see '...' instead of a script". `netlify/functions/deskcron.mjs`
runs every 2 minutes (netlify.toml) and calls `sweepDesks()` in halftime.mjs: one ESPN scoreboard read;
a game at halftime gets its halftime script started, a game gone final (within 8 hours of kickoff) its
postgame one, through the same claim-and-background-job path a viewer's request uses
(`ensureScript`, now shared). So a script is ready a minute or two after halftime or the final whistle,
before anyone opens the game. Finals past the 8-hour window cost no Firestore reads for the rest of the
week; an idle run is one scoreboard read. A viewer's request still starts a missing script (the week's
older finals, a sweep that failed). The job's URL comes from Netlify's `URL` env.

VERIFY: halftime 54/54 (new section "The scheduled sweep (deskcron)", 7 checks: the schedule; with nobody
on the page the halftime and postgame jobs start for the right games; the final from 30 hours ago, the
game in progress and the unstarted one are left alone without a doc read; the report; the next sweep
starts nothing; the first viewer gets the script at once; a quiet week is one scoreboard read). Bite:
HEAD's halftime.mjs, without the sweep, fails all 7. No page files changed.

**Streamed calls; a rest after three failures** (same day). Backfilling the week's finals, 12 of 15
postgame scripts landed and 3 failed all three tries with the job's catch-all error: a long answer sent
whole sends no headers until Opus finishes thinking, and Node's fetch gives up after 5 minutes without
them. The call is streamed now (`stream: true`; `readStream` folds the event stream back into one
message and records the token counts, kept with the script as `usage` for costing). A thrown error is
recorded with its code, and a failure reply carries the last try's reason (`detail`). A game whose
three tries all failed may try again after an hour's rest (`RETRY_MS`), still at most three calls an hour.

VERIFY: halftime 60/60 (new section "Streamed, with its token counts; a rest after three failures", 6
checks). Bite: the previous halftime.mjs fails 5 of them (the sixth, a failure saying why, came with it).

## 2026-09-28 — back to writing on first view, at low effort, behind a countdown

Perry: "Lets try this, rather than pre generating the scripts, lets go back to the script generating
when the first person opens the game, but it shows a post game / half time show starts soon with a
countdown. That way we save cost if nobody watches them but the hope is that opus 5.5 low is quick".
This REVERSES the scheduled sweep above (deskcron and its netlify.toml schedule are gone; its seven
checks are replaced by one saying there is no schedule): a script is written only when someone opens a
game at halftime or after the final, so an unwatched game costs nothing.

- **Opus 5.5 at low effort.** Measured on one postgame script (Panthers at Browns): low effort skipped
  thinking, 5,849 tokens in and 1,444 out, about 5 cents against medium's estimated 9 to 10, and
  proportionally quicker. Its one slip in that trial was five field goals for four.
  Sonnet 5.5 with thinking off (Chargers at Bills, 5,575 in, 1,538 out, about 2.6 cents) ran 560 words
  against the 300-370 asked, said "grown-man football" four times and muddled an overturned touchdown.
- **The countdown.** While the script is written the desk waits under a card over the monitor:
  "Halftime show / starts in 0:15" (15 s) or "Postgame show / starts in 0:25" (25 s), counting from
  when the first viewer's request started the job: the function's pending answer now carries `since`,
  the claim time, so a second viewer's countdown agrees with the first's. At zero it reads
  "Starting…" until the lines arrive; the page polls every 3 s, and the show runs from its top the
  moment they do. The host's opener and the analysts' "…" are gone. A finished script records `ms`,
  claim to script, for tuning the 15/25. Measured on the preview: a low-effort halftime script (ARI @ SF,
  the demo) took 11.5 s to write and reached the page at 13 s; 2,937 tokens in, 783 out, no thinking,
  about 2.7 cents (263 words, over the 150-190 asked; the timeline's 0.8 squeeze holds it to about 70 s).

VERIFY: sunday 246/247 (RESTAGED the two "still being written" checks to the countdown, with the reason
at the check; 2 new: "Starting…" past the estimate, the postgame countdown; the one failure is the
webfont ink check that fails the same way on HEAD in this container), halftime 57/57 (the sweep's 7
checks replaced by 4: no schedule, low effort on every call, `since` shared, `ms` recorded). Bite: the
previous sd-reenact.js and sd.css fail the 4 countdown checks; the previous halftime.mjs fails the 5
new or restaged function checks.

## 2026-09-28 — no canned stand-in lines

Perry, having opened the three games whose postgame scripts had failed: "it took like 1 seconds to
generate but it was super generic and very short". That was the page's stand-in (five canned lines,
`htStandIn`) for a failed script, not Opus: those docs had used their three tries under the old
unstreamed call and were in their hour's rest. The stand-in is gone. With no script, the desk waits
under its card, "Halftime show / coming up shortly" (or "Postgame show"), no dialogue, and the page
asks again every minute while that desk is on screen (`HT_TIMES.retry`; polls stay every 3 s while a
try runs). Once a retry is running the countdown takes over, and the script plays from its top the
moment it lands. The three games were then written by hand, the streamed call working.
Cache-bust ?v=20260928r.

VERIFY: sunday 247/248 (RESTAGED the two stand-in checks to the card, with the reason at the check; 1
new: a retry's script plays from its top, with earlier checks' timers cleared first so only the retry
can fetch; the one failure is the webfont ink check that fails the same way on HEAD in this
container). Bite: the live sd-reenact.js fails all 3.

## 2026-09-28 — live plays reach the 8-bit view sooner

Perry: "is there anything we can do to decrease the time from when a play happens in real life to the
time it is animated in GFFL?" … "lets just try the 2 changes for tonight and see how it feels".
Measured first: ESPN caches the per-game scoreboard feed (the one the 8-bit view animates from) for
1 s (`max-age=1`); summary 5 s, core API 8-10 s, cdn.espn.com 94 s, so the source was already the
freshest. ESPN's own entry lag can't be read after the fact (a play's `modified` is rewritten after the
game), and isn't ours to change.

- **Polled every 2 s** in a live game (was 5): about 1.5 s sooner on average. The phone fetches ESPN
  directly, so our functions don't see it.
- **Live plays cut to the snap.** By the time ESPN has a play it is over, so the 4-6 s jog from the
  huddle into the formation only added delay (it can't be squeezed: a wide receiver's walk-out already
  needs about 3 s at the 11 yd/s speed cap). In a live game `sidePlay` builds the play as a fresh one
  (players set, snap at 1.1 s, the hash kept) behind a 0.3 s fade from black, the way TV cuts to the
  next snap; the result shows about 3.4 s sooner (measured on the fixture: 2.5 s against 5.9 s). A
  replay keeps the walk-up. Cache-bust ?v=20260928s.

VERIFY: sunday 251/252 (new section "Live: polled every 2 s, plays cut to the snap", 4 checks: 3 feed
requests in 6.5 s on a live game; the players set at t=0 and the snap at 1.1 s instead of 4.5; the
result 3.4 s sooner; the frame black at 0 s and lit at 0.45 s; the one failure is the webfont ink check
that fails the same way on HEAD in this container). Bite: HEAD's sd-app.js and sd-reenact.js fail all 4.

## 2026-09-28 — Replay starts at once, with a drive row; the desk goes to the tape; a new cast

Perry: "when users click replay, it should immediately default to either start of the game if the game
is over, or current drive if the game is ongoing. then it should have a horizontal list of drives that
can be clicked to take you to any specific drive. I also want to expand the half time and post game
analysis to mirror real life: 2-3 replays where an analyst brings up a specific play and it shows that
replay along with the commentary words overlaid on top. Also replace Dot Keene with RoboGoat, and chuck
varney with Force Ghost John Madden".

- **Replay starts at once** (the big 8-bit view): the whole game on a final, the current drive in a
  game still going. The Game start / This drive menu is gone. Under the controls, **a sideways row of
  the game's drives** (`tecmoRpDrives`): one chip per drive, the team, quarter and result (TD, FG,
  Punt, INT, Downs, End of half…), the drive being replayed lit in its team's colour and kept in view.
  A chip starts the replay at that drive's first play (`tecmoRpStart(n)`).
- **The desk goes to the tape.** Opus is asked to call up a specific play from the facts twice at
  halftime and three times after the game (every scoring and notable play in the facts now carries its
  ESPN id). A line's `replay` names the play shown while it is spoken; `cleanScript` keeps a replay only
  for a play in the facts, three lines each, three a show. On the page (`htReplay`) the desk cuts to the
  play staged fresh on the 8-bit field, its own score bug showing that moment's clock and down, with a
  blinking red REPLAY tag and the analyst's words across the top (`.ht-cap`); the run of lines is held
  until the play has played out (at most 9 s, plus a beat), and then it's back to the desk.
- **The cast**: Hal Brandt, **Force Ghost John Madden** (in Chuck Varney's seat: drawn see-through in
  pale blues over a glow, bobbing above his chair; the prompt keeps him an affectionate tribute, kind,
  never crude), Moose Tillman, **RoboGoat** (in Dot Keene's: a metal goat's head with horns, a snout,
  LED eyes and an LED mouth, over a bow tie; beeps and the odd bleat). Scripts moved to a new Firestore
  collection, `sunday_desk2`, so every game's script is written anew with the new cast and the replays.
  Cache-bust ?v=20260928t.

VERIFY: sunday 256/257 (RESTAGED the replay section's menu checks to start-at-once, the controls
geometry to measure the drive row not each chip, and the fixture show's length bound to 90 s for its
replays; 7 new: start of game on a final, the drive row, a chip's jump, the current drive when live,
the cut to the tape with its caption, the line held for the play, the new faces; the one failure is
the webfont ink check that fails the same way on HEAD in this container), halftime 61/61 (RESTAGED the
cast and personality checks; 4 new: ids in the facts, `replay` required, `cleanScript`'s replay rules,
the stored replays). Bite: HEAD's page files fail the 8 new or restaged page checks; HEAD's halftime.mjs
fails the new cast, collection and replay checks.
Checked on the preview: Opus 5.5 at low effort wrote ATL @ GB's postgame show in 25.8 s (6,095 tokens
in, 1,927 out, about 6 cents), 27 lines and 510 words, with three replays on real plays (Bijan
Robinson's 55-yard run, Zach Harrison's blocked field goal, Drake London's 68-yard catch). The
postgame countdown went from 25 s to 30.

## 2026-09-28 — replay fixes: no black beat, the analyst's inset and bubble; catchphrase pools

Perry: "during the replay it flickers black once or twice, not sure why. also get rid of the red
blinking replay word that isnt needed. Instead, lets have a view of that analyst talking and a speech
bubble at the top of the replay, that way it wont cover the action but you still see who is talking.
Lets give our analysts a larger database of catch phrases, its fun for them to use them every so often
but if its the same one over and over it gets tiring".

- **The flicker** was the timeline's 0.3 s gap between two lines of the same replay: with no line to
  say, the dark studio showed for a beat. Inside a replay the lines now run end to end
  (`htTimeline`); the gap stays between lines at the desk.
- **No REPLAY tag.** Over a replay, the speaking analyst sits in a framed inset in the top left corner
  (`htInset`, drawn on the canvas, about a quarter of the stage's height, mouth moving; the ghost still
  see-through, RoboGoat's LEDs lit), and their words are in a white speech bubble beside it along the top
  (`.ht-cap`, its tail pointing at the inset), clear of the field below.
- **Catchphrases** (`PHRASES` in halftime.mjs): twelve for each of the four. Every game's prompt offers a
  different four from each list (`phrasePool`, seeded by the two teams and the show, so a retry asks the
  same), to use once or twice each at most, never the same one twice, most lines with none. Scripts
  moved to `sunday_desk3` so every game is written anew. Cache-bust ?v=20260928u.

VERIFY: sunday 258/259 (RESTAGED the tape check: no REPLAY tag, the bubble; 2 new: the inset's frame and
the bubble's place beside it along the top, no studio frame inside a replay with its lines end to end;
the one failure is the webfont ink check that fails the same way on HEAD in this container), halftime
65/65 (4 new catchphrase checks; the voices check restaged to the pool's wording). Bite: the live page
files fail the 4 new or restaged page checks; the live halftime.mjs fails the new collection and pool checks.

## 2026-09-28 — live plays walk out of the huddle again

Perry, after watching the Monday night game: "its looking like our changes to make the live 8 bit feed
faster worked, now we have some room to back off a little since its like 10 seconds ahead of the tv
broadcast. so lets see if we can allow them to leave the huddle each play and then we are still ahead
of the broadcast". REVERSES the same day's cut straight to the snap (players set, snap at 1.1 s, a
0.3 s fade from black; `sc.cutIn` is gone): a live play walks out of the huddle into its formation
again, as a replay's does, which gives back about 3.4 s (result at 5.9 s against 2.5 s on the fixture),
leaving the view roughly 6-7 s ahead of the broadcast. The 2 s polling stays. Cache-bust ?v=20260928v.

VERIFY: sunday 257/258 (section renamed "Live: polled every 2 s; plays walk out of the huddle"; its three
cut checks RESTAGED to two, with the reason at the check: the players jogging from the huddle with the
snap at the walk-up's 4.5 s and no fade, the result at the walk-up's time; the one failure is the webfont
ink check that fails the same way on HEAD in this container). Bite: the cut-to-the-snap sd-reenact.js
fails both.

## 2026-09-28 — a reviewed play: the call, then the ruling

Perry, during PHI @ CHI: "chicago just ran a play and it was called a touchdown, but it was being
reviewed so it looks like GFFL didnt want to show it. It should show the interim result of the play,
and if the result changes, it should show the result overturned". ESPN logged that play (4018729631003)
only once the review was over, in one text: the call ("…for 6 yards, TOUCHDOWN."), then "The Replay
Official reviewed the runner broke the plane ruling, and the play was REVERSED.", then the play as it
stands ("…to PHI 1 for 5 yards"). Its yards and scoring flag are the final ruling's.

- **`raReview(p)`** reads that sentence: booth review or a coach's challenge ("Philadelphia challenged
  the …"), reversed or upheld/confirmed/stands, the call's text and the ruling's. The challenger
  alternative is a capitalised place name only: a looser one matched "TOUCHDOWN.The Replay Official"
  as a team.
- **Two acts** (`raReviewed`, `sideSecondAct`): the play as called (`raAsCalled`: the call's yards, a
  touchdown to the goal line with its celebration), "Under review" 2.2 s after its result; reversed, then
  "Ruling reversed / Down at the PHI 1" and the play again as it stands, the players walking back from
  where the first act left them; upheld, "Ruling stands" and nothing replayed. The text under the field
  is the call's during the first act. The page's result gate waits for the ruling (`raRulingAt`); review
  banners carry `ruling: true` so `sideResultAt` skips them. Replays stage it the same way.
- **The call first, the rewrite later**: if the stage already showed a play and its text comes back with
  a review, `sideUpdate` hands it to `sideReview` ("Under review", then the ruling). sd-app.js asks for
  the summary as soon as the scoreboard's text for the same play id changes, rather than on the 10 s
  summary poll. Cache-bust ?v=20260928w.

VERIFY: sunday 273/274 (new section "Replay reviews: the call, then the ruling", 16 checks, fixtures
sum-/sb-401872963-review.json from the live feed; the one failure is the webfont ink check that fails the
same way on HEAD in this container), sunday-ff 53/53, pbpdetail 61/61, halftime 65/65. Bite: main's page
files fail 13 of the 16 new checks, every pre-existing check still passing; the 3 that pass there check
only the end state (the ball at the 1, the players' starting spots, the call-only feed staged as a
touchdown). The rewritten-play check first passed vacuously-then-flaked: its setup ended before the
scoreboard's poll had brought the call's text, so it now waits for that.

## 2026-09-28 — a score its play already explains is not held

Perry, PHI @ CHI, the Eagles' touchdown on the last play of the half: "the eagles just scored a
touchdown but it is not changing the score … or it did, but like 30 seconds after the 8 bit animation
played". The page holds a scoreboard score that moves with no new play (`G.hold`: the score must not beat
its play onto the screen) until the summary brings a *new* scoring play, or 25 s. ESPN had put the
touchdown up as the scoreboard's latest play a poll before it moved the score, so the score then moved
with no new play, the lagging summary never counted it as fresh, and the hold ran its full 25 s.
`scoreExplained(ev, q)`: a score is shown at once when the scoreboard's latest play is a scoring play, or
the summary's last scoring play carries that very score; `loadGameEvent` doesn't start a hold for it and
releases one it can now explain, and `loadSummary` releases on it too. A score that arrives before any
play accounts for it is still held. Also: the 8-bit tick stops when the stage has been cleared
(`SIDE.sc` null) rather than throwing. Cache-bust ?v=20260928x.

VERIFY: sunday 276/277 (new section "A score change its play already explains is not held", 3 checks: the
summary already holding the scoring play, the touchdown as the scoreboard's latest play a poll before the
score, a score with no play still held; the one failure is the webfont ink check that fails the same way on
HEAD in this container), sunday-ff 53/53, pbpdetail 61/61. Bite: main's sd-app.js holds both explained
scores (0 and 7 on screen), and the third check then fails too because the first hold is still running.

## 2026-09-28 — arriving at a live game shows it as it is, no replay

Perry: "Often when refreshing the screen or going from one game back to the live game it will replay the
previous play. It shouldn't replay anything it shoukd always be live view". On arrival the 8-bit view had
no play of its own yet (`SIDE.playId` null), so `sideNext` handed it the newest play and `sidePlay`
animated it, walk-up, banners, held score and all.

- **`SIDE.arrive`** is set for a new game view (`SIDE.gRef !== G`: a load, a game opened from the board
  or from another game), by `sideArrive()` when the page comes back in front (sd-app.js's
  `visibilitychange`), and when a replay is left early (`tecmoRpEnd(true)`, which used to animate the
  newest play again). Showing the desk or starting a replay clears it.
- **`sideSettle(p)`**: the newest play is staged and put straight at its end: every banner marked shown,
  no score gate, its text up at once. What follows runs as it would have (the huddle at the next spot, the
  teams off after a score, the kickoff). A reviewed play settles on the ruling. The play already on the
  stage is settled too if it never finished (the view closed or hidden mid-play), which also clears its
  pending gate. Plays that come in while someone is watching are animated as before.

Cache-bust ?v=20260928y.

VERIFY: sunday 283/284 (new section "Arriving at a live game: the game as it is, no replay", 7 checks: a
load, the reviewed play settled on its ruling, the huddle after, a new play while watching still animated,
back in from the board, a replay left early, the page back in front and its wiring; the one failure is the
webfont ink check that fails the same way on HEAD in this container), sunday-ff 53/53, pbpdetail 61/61.
Bite: main's page files fail all 7, every pre-existing check still passing (the "new play animated" guard
fails there only because main's two-act review of the arrival play is still running when the new play
arrives).

## 2026-09-28 — the defense doesn't huddle

Perry: "Defenses dont really huddle like offenses, they get mostly into position and then as the offense
comes out they line up, so the defense can kind of stand around in a basic defensive formation and then
when the offense runs up the defense gets set, linemen go into stance". REVERSES the two-huddle picture
(`raHuddleSpot` put the defense in a ring 7 yd past the ball, facing its middle, bouncing on its toes):

- **`raHuddle`**: only the offense huddles. The defense jogs into a loose 4-3 shell at the next spot
  (`RA_SHELL`: the line 2 yd off the ball, linebackers at 5-6, corners 11.5 wide, safeties 12 deep; each man
  takes the nearest open spot for his position, `raShellSpots`), standing and facing the ball, no bounce.
  `sc.hud` has only the offense's middle.
- **The walk-up** out of a huddle scene: the defense holds its shell while the offense breaks, then
  shuffles into its alignment late (it starts moving max(1.3 s, distance / 4.5 yd/s) before `tSet`), still
  set 0.9 s before the snap with the line down in its stances, as before.

Cache-bust ?v=20260928z.

VERIFY: sunday 287/288. RESTAGED "in the huddles everyone faces its middle" to the offense only, with the
reason at the check; new: the defense faces the ball in its shell; the shell is 11 men spread 1.5-13 yd off
the ball, none within 2.5 yd of another, the 4 linemen 2 yd off, all standing; it holds while the offense
breaks (0.17 yd moved against the offense's 2.6 in 1.4 s); all 11 still with the 4 linemen in stance 0.4 s
before the snap. The one failure is the webfont ink check that fails the same way on HEAD. sunday-ff 53/53,
pbpdetail 61/61. Bite: main's sd-reenact.js fails the facing, shell and hold checks (a ring 5.5-8.5 yd off,
0.85 yd apart; the defense moving 2.6 yd in the first 1.4 s); the set-before-the-snap check passes on both,
as it should.

## 2026-09-29 — arriving on a touchdown, it plays

Perry: "Also we need an exception to the no replay rule, if the last play was a touchdown it should shoe
that". The one exception to the arrival rule above: when the newest play is a touchdown, or the try just
after one (a real extra-point play or the `-pat` raPlays synthesises), `raArriveTD` hands back the
touchdown and `sidePlay` animates it, the try following as `sideNext` has it; anything else is settled as
before. A touchdown the review took away doesn't count (the final ruling isn't a scoring play). Applies to
every arrival: a load, a game opened again, the page back in front, a replay left early. Cache-bust
?v=20260929a.

VERIFY: sunday 289/290 (2 new in "Arriving at a live game": a load on a touchdown plays it from the start
with its "Touchdown" banner still to come; `raArriveTD` on the fixture's 401872963315 and its try gives
the touchdown, on the reversed 4018729631003 and an ordinary play nothing; the one failure is the webfont
ink check that fails the same way on HEAD), sunday-ff 53/53, pbpdetail 61/61. Bite: main's sd-reenact.js
puts the touchdown straight at its end and fails both.

## 2026-09-29 — the 8-bit view is the default

Perry: "Lets set 8-bit view as the default instead of field". `bigTecmo()` falls back to true when nothing
is stored (`sun.tecmoBig`), on phone and desktop alike; the Field / 8-bit toggle still stores the pick, so
a viewer who chose the field keeps it. Cache-bust ?v=20260929b.

VERIFY: sunday 291/292 (new section "The 8-bit view is the default": nothing stored opens on the 8-bit
stage with the toggle offering "Field"; a stored "false" keeps the field. The score-hold section now pins
the field view, noted at the check: with nothing stored it would also wait for the 8-bit touchdown's
banner, the gate, which is its own behaviour. The one failure is the webfont ink check that fails the same
way on HEAD), sunday-ff 53/53, pbpdetail 61/61. Bite: main's sd-reenact.js opens on the field and fails
the default check; the stored-pick check passes on both.

## 2026-09-29 — the 8-bit players redrawn, and animated frame by frame

Perry: "I want you to do a design pass on the 8-bit players in gffl to get them better pixel graphics
and better animations". All in `sd-reenact.js`; the stage, the camera, the kits and the play staging
are unchanged.

**The sprites** (`raFig`, same 34×40 grid and foot anchor):
- **Football proportions, drawn in the chunky three-quarter style retro football games use.** Shoulder
  pads 14 px of jersey across against a 10 px helmet (11 against 9 before), a tapered waist, longer and
  slimmer legs, the pants ending under the knee over the socks, the arms hanging from the pads' edges.
- **The helmet stays one solid shell** (2026-09-28 rule) with the face in its opening, an eye, and the
  facemask's bars in front. It keeps a dark rim so it separates from the pads.
- **Clean shading.** Two tones a colour, lit from above and in front, plus a lighter third only on the
  top of the pads. The far arm and leg sit in shadow. A near arm or leg crossing the body casts a shade
  in the body's own shadow tone instead of the black rim it had, which put 44 dark cells a frame through
  the figure. A last pass gives any lone pixel of a tone its neighbours' tone (13 such pixels before).
- **One rig.** Every frame is rebuilt through `raRig` with fixed bones (thigh 5.9, shin 5.2, upper arm 6,
  forearm 4.6 px, spine 10), so nothing grows or shrinks between frames (it varied by up to 3.4 px).
  A pose now gives the hands and feet and which way the elbows and knees bend; the rig places the
  shoulders and hips and solves the joints. `tl`/`nl` shorten the spine and neck for poses lying flat.
- **The ball** is a little smaller (it sits in the hands now). A shadow is a pixel ellipse (`raShadow`)
  that shrinks as a man goes up and is longer under a man lying down. Officials and trainers go through
  the same rasteriser.

**The animation** (82 frames, 27 before; `raPoseAt` still returns the same poses, `raFrame` picks the
frame and its in-betweens):
- **Eight-frame strides** generated from one foot path per gait (`RA_GAITS`, `raGait`): walk, jog, run,
  carrying the ball, backpedal, and the trainers with the stretcher. The body leans and bobs twice a
  stride, the arms pump against the legs. The stride's phase is carried from frame to frame against the
  distance covered (`raGaitFrame`, `RA_STRIDE_YD`), so speeding up changes the cadence and never skips
  the legs ahead.
- **The ball carrier** runs with it tucked in his near arm; a man standing with it holds it at his chest.
- **No moonwalking.** A man moving against the way he faces backpedals. That is the QB's drop, which
  used to run a forward stride backwards, and now also: the defensive backs and linebackers drop facing
  the quarterback until the throw (a man who has to sprint turns and runs, and stays turned), and the
  linemen face their man for the whole snap, kick-sliding back in pass protection (the centre used to
  turn round), feet chopping while they block.
- **The pass:** wound up with the ball behind the helmet (drawn behind the passer), the release, a
  follow-through with the back foot coming up. **The catch:** reach, then pull it in.
- **Going down:** a stumble and the knees before he is flat; the man who makes the tackle dives into it;
  getting up goes back through the knees. **Taking a knee** is a kneel, the ball on the knee (the QB's
  kneel-down, the touchback interception, a kick returner downing it in the end zone, teammates beside
  an injured man). `raPoseAt` still reads `down` for the first two, as the play's own checks expect.
- **Standing around:** breathing, and about two in five with hands on hips after the whistle (the old
  one-pixel hop is gone). Jumping teammates squat between jumps, the scorer's dance is four steps then
  arms up twice, the men holding up a kicker hold their arms straight up.

Frame time, headless Chrome, 240 frames through each of five plays on a phone-size stage (mean ms,
HEAD → now): 0.5-1.4 → 0.3-1.5, the same. The new frames cost 1.4-2.3 ms each to rasterise, so they are
built while the page is idle after load; the first play's 95th-percentile frame is 1.2-1.3 ms (HEAD
0.9-2.2 over five runs; 4.5 before the idle-time build).
The sprite cache holds up to 2,400 uniformed frames and drops the least recently drawn beyond that.
Cache-bust ?v=20260929c.

VERIFY: sunday 310/311 (new section "8-bit players: pixel art and animation", 19 checks: the rig's
bone lengths in all 82 frames; eight distinct frames a gait, the run's 10-px foot travel and 1-px bob;
the cadence on a 0-9 yd/s ramp at 60 fps, never more than one frame a step, 1.792 strides in the last
second against the hand-computed 7.5 ÷ 4.2 = 1.786; pads 14 vs helmet 10; no lone pixels in 246 frames
of players, officials and trainers; 5.4 dark cells a frame inside the figures, all enclosed gaps;
no forward stride in 3,962 frames of men moving against their facing over 14 passes; on 885 Penix's
backpedal, six defensive backs dropping, the line facing the rush in 1,045 of 1,045 frames with both
block frames, throw1 → throw2 → throw3, Robinson's catch → secure → carry → fall1 → fall2 → down, the
tackler's dive; 863's carry tucked in 50 of 50 frames; 160's hit QB down and up through his knees (with
the play's nflverse detail); 4399's kneel with the ball on the knee; breathing and hands on hips; every
frame drawn across 184 plays a real one; the shadow 19 px, 11 up, 29 lying. The one failure is the
webfont ink check that fails the same way on HEAD), sunday-ff 53/53, pbpdetail 61/61, halftime 65/65.
Bite: HEAD's sd-reenact.js scores 291/311, failing exactly the 19 new checks (and the webfont check);
every pre-existing check passes on both.

## 2026-09-29 — the helmet: white facemasks, a face you can see

Perry, on the redrawn players: "The helmet needs another pass its hard to tell what's going on, white
face masks would help". The shell stayed a round block of one colour with a small patch of skin in
front and a grey facemask (a dark one on gold and silver shells, where grey didn't show). On a gold,
silver or white helmet the face and mask were lost.

- **White facemasks on every helmet** (`RA_MASK`, all 32 teams, home and road). The shell is still
  one solid colour (the 2026-09-28 rule).
- **A cage, one pixel thick, sized to the upright head's pixel rows:** a front bar standing off the
  face and joined to the brow, a short bar across at the nose, one under the chin, with dark gaps
  between them and the face. The first try packed the bars so close they merged into a white block,
  and its chin bar never landed on a pixel row.
- **The opening:** the brow's shadow across the top (a new near-black `k`), then the eye, then the face,
  shaded toward the ear and the chin. The dark brow line is what separates a light face from a gold or
  white shell.
- **Poses re-aimed so an arm doesn't cover the mask.** The celebration `cheer` is now a flex, with the
  near arm out in front below the mask and the far arm up behind the helmet. The scorer's `dance`
  points forward with the far arm raised. The kicker-hoisting `signal` raises the near arm over the
  helmet's side. The punter's hand is lower. The falling head in `fall2` looks forward. Every frame
  keeps at least 5 mask pixels; `signal` had kept 0 and `dance` 1.

Cache-bust ?v=20260929d.

VERIFY: sunday 313/314 (3 new checks in "8-bit players: pixel art and animation": white masks on all
64 kits, relative luminance at least 0.90 where they were 0.03-0.35; the cage on the standing frame's
grid, a 6-px front bar in front of every face cell, a dark gap at the eye's row, 3 bars, the brow's
shadow over the eye; at least 5 mask pixels in all 82 frames. The one failure is the webfont ink check
that fails the same way on HEAD. "Helmets are one solid colour" still passes: 58 shell pixels, 0
others), sunday-ff 53/53, pbpdetail 61/61, halftime 65/65. Bite: the previous sd-reenact.js scores
310/314, failing exactly the 3 new checks; every other check passes on both.

## 2026-09-29 — light grey facemasks

Perry, having seen the white masks: "Lets go with light Grey face masks". REVERSES the white above:
`RA_MASK` is `#d0d4d9` on every helmet (relative luminance 0.65 against the white's 0.90). Against the
shells it reads about as well on white (1.35:1) as on silver (1.35:1 for New England, 1.53:1 for
Carolina). A darker grey would lose the silver helmets, a lighter one the white. The dark gaps between
the bars do most of the separating either way. Cage, opening and poses unchanged. Cache-bust
?v=20260929e.

VERIFY: sunday 313/314 (RESTAGED the facemask colour check, with the reason at the check: one colour on
all 64 kits, relative luminance between 0.5 and 0.8, light but not white; the one failure is the webfont
ink check that fails the same way on HEAD). Bite: the white-mask sd-reenact.js fails the restaged check
(0.903) and nothing else in the section.

## 2026-09-29 — helmet logos

Perry: "i know we dont have a lot of pixels to work with but lets take a run at making logos on the
helmets". Every team but Cleveland (whose helmet has no logo) now wears its logo on the side of the
helmet (`RA_LOGO`), painted over the one-colour shell like a decal. The shell under it is still one
solid colour (the 2026-09-28 rule); the facemask and the opening are unchanged.

- **The box:** 7 by 7 pixels on the side of the shell behind the face opening (`RA_LOGO_BOX`), one
  character a pixel in the table, each logo drawn facing forward (right). On an upright helmet the
  shell's curve trims five cells at the back: row 0's first two, the first cell of rows 1, 2 and 6.
  The designs keep their ink off those cells where losing it would throw them off balance; the
  Commanders' W, the Titans' T bar, the Giants' "ny", the fleur-de-lis and the jet were moved for it.
- **Which way it faces:** animals, bolts, wings and horns turn with the player so they face forward on
  both sides, as on real helmets. Lettered logos (`text`: the G, the C, "ny", "SF", the Raiders'
  shield, the Titans' T, the Commanders' W, the Steelmark) never read backwards. The Steelers wear
  theirs on the right side only (`side: 'r'`), so it shows only when he faces right.
- **Stand-ins:** the Texans' bull is drawn head-on with its horns up. The real one is side-on, and at
  seven pixels every side-on try read as a red heart. The Jets' helmet wordmark has four letters too
  many for seven pixels, so they wear a jet. The Panthers' black head keeps a blue outline on its back
  and top; without it the head ran into the helmet's black outline and read as a two-tone helmet.
- **2026 designs:** the Titans' white sword-T on a light-blue roundel, no flames; the Commanders' gold
  W; the Falcons' falcon on the new low-gloss black; the Ravens' raven head on the 1999 helmet they
  kept. Sources: [Titans helmet logo](https://www.sportslogos.net/logos/view/16093562026/Tennessee-Titans-Logo/2026/Helmet-Logo),
  [Commanders](https://www.espn.com/nfl/story/_/id/48489288/washington-commanders-new-uniforms-2026),
  [Falcons](https://news.sportslogos.net/2026/04/02/atlanta-falcons-officially-unveil-new-uniforms-for-2026-season/football/),
  [Ravens](https://www.cbssports.com/nfl/news/nfl-ravens-uniform-change-new-helmets/),
  [2026-27 changes](https://news.sportslogos.net/2026/09/09/previewing-the-nfls-new-uniforms-helmets-and-logos-for-the-2026-27-season/football/).
- **A still head:** a head tilted less than 14 degrees is now drawn upright on the same sub-pixel footing
  in every frame (`raFig`), so helmet, mask and logo are the same pixels all through a stride. Without
  it the Packers' G changed shape in all 40 stride frames. A head tilted further (diving, lying down)
  keeps its exact place: a first try snapped those too, and the face-down `down` frame's cage fell
  between pixel rows (3 mask pixels, was 8).
- `raFig` records the shell's cells as it paints them (index, and place on the side of the helmet);
  `raSprite` paints the logo onto the ones still showing, so an arm across the helmet stays an arm. It
  costs about 4 µs a sprite (61 against 57, built once and cached); scanning the whole grid for them
  had cost 55. The sprite cache key carries the logo.
- At game size on a phone the G, the C, the falcon and the Steelmark read; on the desktop's
  whole-field view a logo is a few pixels of colour on the helmet.

Cache-bust ?v=20260929f.

VERIFY: sunday 318/319 (5 new checks in "8-bit players: pixel art and animation": 31 logos, none for
the Browns or a team with no art, the smallest 11 px (Washington); every logo draws exactly the pixels
its design puts on the shell less the five trimmed cells, facing right and facing left, 766 px over
the standing helmets, the expected counts worked out in the check from the table and the shell's
ellipse; logos only on shell cells; an F reads the same both ways as letters and turns as a mark,
Pittsburgh 36 px facing right and 0 facing left; the G the same 42 px in all 40 stride frames.
RESTAGED "helmets are one solid colour", the reason at the check: the logos use kit colours, so the
shell is read off the player drawn without his logo, and every pixel the logo changes must be shell
underneath (58 shell pixels and 0 others for both teams; logos 22 and 42 px). The one failure is the
webfont ink check that fails the same way on HEAD), sunday-ff 53/53, pbpdetail 61/61, halftime 65/65.
Bite: HEAD's sd-reenact.js scores 313/319, failing the 5 new checks (and the webfont check); the
restaged check passes on both. Breaking one thing at a time fails the check meant for it: no head
snap, the stride check (40 of 40 frames); letters mirrored, the turn check and Chicago's count (20
against 18); the Steelmark on both sides, Pittsburgh's count (36 against 0) and the turn check; the
logo left out of the sprite cache key, every count 0; tilted heads snapped too, the facemask check
(`down`, 3 px).
