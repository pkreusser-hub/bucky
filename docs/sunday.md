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
