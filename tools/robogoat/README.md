# RoboGoat kit

Everything that turns a week of GFFL into a RoboGoat column page at
`goatfantasyleague.com/robogoat/<season>/<issue>/`. Read the RoboGoat entries at the bottom of
[docs/gffl.md](../../docs/gffl.md) first: copy rules, names, and why the pages look the way they do.

| file | does | touches |
|---|---|---|
| `week.mjs` | **the weekly entry point**: facts + lineup snapshot/diff + leads + drafts in one command | runs `facts.mjs`; writes `--work` and `season.json` |
| `facts.mjs` | pulls one week's facts into a scratch JSON, plus `issue.skeleton.json`, `leads.md`, `drafts.md` | reads Firestore, Sleeper, ESPN's scoreboard; writes only `--out` and, with `--season-file`, new weeks, pairings and blank pick results into `season.json` |
| `analysis.mjs` | the rules, as pure functions: standings and tiebreaks, win-probability summary, leads, drafts, pick scoring | nothing |
| `known-anomalies.json` | scorer FAIL lines already looked at, so a NEW one stands out | — |
| `build.mjs` | `column.md` + `issue.json` (+ `wp.json`, `season.json`) → `index.html` | repo files only |
| `share.mjs` | the 1200×630 `share.png` link preview | repo files only; bundled fonts in `fonts/` |
| `archive.mjs` | `robogoat/index.html` (the archive page) + `robogoat/issues.json` | repo files only |
| `announce.mjs` | the league push for a new issue; **dry run unless `--send`** | `--send` wakes every league phone |
| `reads.mjs` | the private read log report: per issue, which teams read it (app or push), when, and how many untagged reads | reads Firestore |
| `lib.mjs` | Firestore read helpers, names, browser launch | — |
| `page.css` | the issue page's stylesheet, inlined by `build.mjs` | — |

Nothing in this kit writes league data. The only outbound write is `announce.mjs --send`.

**The read log** (Perry, 2026-10-10: "I want to log who actually reads the columns"; private, pulled
on request). `build.mjs` puts an invisible 1x1 beacon on every issue page that points at
`netlify/functions/rgread.mjs` with the issue's own path. That function, not this kit, writes one
`kind: "rgread"` doc per read: issue, via, team, time. It stores no IP and no user agent. The page has no
script, so the reader's team arrives in the Referer. The GFFL card links to the issue with
`?r=app<team>`, and `announce.mjs` sends `readTag: true` so notify.mjs gives each phone's link
`?r=push<team>`. The email link and the archive carry no tag; those reads count as untagged. When
Perry asks who read a column, run `node tools/robogoat/reads.mjs [robogoat/<season>/<issue>]` and
report it in plain words. Reads are logged only from the deploy that shipped this (2026-10-10);
earlier opens left no trace.

`.claude/settings.json` allows `node tools/robogoat/announce.mjs …` to run without a permission
prompt (Perry, 2026-09-30), so a session can send the push once he says so. The allow rule
removes the tool gate, not the rule: send only on his say-so for that issue, and run the command
on its own (not chained after other commands), or the rule will not match.

## Layout

```
robogoat/
  index.html, issues.json        archive (generated)
  robogoat.png, logos/           the portrait on every issue; team logos
  <season>/season.json           picks + rankings (by hand), weeks.<n> (facts.mjs, written once)
  <season>/week-<n>/             a recap:   column.md issue.json wp.json index.html share.png
  <season>/week-<n>-preview/     a preview: column.md issue.json index.html share.png
```

## The weekly command

`node tools/robogoat/week.mjs --week N --type recap|preview --work $SP/wN` does the by-hand parts:

- `--since` is the start of the newest issue's day in `robogoat/issues.json` (the last column).
  Nobody passes a date.
- It runs `facts.mjs` into `$SP/wN/kit` with the season file, which fills in the finished weeks'
  scores, pairings and **pick results** (blank `result`s only; a result already typed is kept and
  a disagreement is printed as WARNING).
- A preview's lineups are snapshotted to `$SP/wN/lineups.latest.json`. **Run it again just before
  building**: it prints what changed since the previous run, by team, player and slot (snapshots
  are key-sorted, so key order never shows up as a change). Replaces the by-hand diff.
- `kit/leads.md` is a list of joke candidates, each a fact with its numbers: starters who are Out
  or projected 0.0 by GFFL; a starter who kicks off after bench players who play earlier and are
  projected higher; teams that have not touched their lineup since the week opened (roster doc
  `updateTime`); a player moved three or more times in the window; each team's week by transaction.
  They are leads, not claims: check each against the facts and the news before using it.
- `kit/drafts.md` holds the mechanical sections for the writer to edit. Preview: `restOfWeekend`
  ("The Rest of the Weekend"), `injuryDesk` (a skeleton in the `Player (Owner): text` form; add the
  body part and the practice report), `series` (one line per game), `thursday` (points so far and
  who scored them). Recap: `series`, `nextWeek` (the "Week N+1" lines, series filled in) and
  `rankings` (the GFFL power order with movement against last week; RoboGoat's own order is still
  the writer's call). The editing is voice only; do not retype the numbers.
- A NEW scorer anomaly prints as `NEW ANOMALY`. Known ones live in `known-anomalies.json`; add an
  entry only after looking at the case.
- `issue.skeleton.json` carries `picksWeek` (recap) or `picksRecord` and `picks` (preview), computed from
  the scores. `build.mjs` fails with the reason if `picksWeek`, `picksRecord`, `picks`, a
  `season.json` pick result, the power-ranking order or a power-ranking record disagrees with the
  scores, `season.json` or `issue.json`.

## Tuesday recap (week N)

1. `node tools/robogoat/week.mjs --week N --type recap --work $SP/wN` (see above).
   The recap's own team totals are `weekly[N].matchups` (GFFL's). Player points come from the
   shadow scorer and can differ from GFFL's by a stat correction; quote GFFL for team totals.
2. Research the real NFL games, write the column, have an editor agent revise it. Public league
   chat only (`facts.chat`); never private email or `act_*`/`trade_*` docs.
3. `mkdir robogoat/2026/week-N`, write `column.md` (start from `kit/drafts.md`), copy
   `$SP/wN/kit/issue.skeleton.json` to `issue.json` and fill in: `published`, `subject` (see Subject
   lines), `description`, `window`, each game's `note`, `stars`, `wp` (the chart spec; see Week 3's
   for the shape) and `allowTwoDecimals` (only values the column is about). `picksWeek` is already
   computed; leave it. Copy the charted game's series from `kit/wp.all.json` into `wp.json` as
   `{ "m_<home>_<away>": [...] }`.
4. In `season.json`: add `rankings.N` in the column's power-ranking order (team ids). The arrows
   compare against `N-1`, and the build fails if the column's order or records differ. Pick
   results were filled by step 1.
5. Build: `node tools/robogoat/build.mjs robogoat/2026/week-N`, then
   `node tools/robogoat/share.mjs robogoat/2026/week-N`, then `node tools/robogoat/archive.mjs`.
6. `node tools/_verify-robogoat.cjs` must be green. Look at a 390px screenshot of every panel.
7. Commit on the working branch with the suite count, push the branch, open a PR, ask Perry to merge.
8. Gmail draft to the league: subject = `issue.json` subject, a two-line teaser and the link.
9. After Perry merges and Netlify deploys: `node tools/robogoat/announce.mjs robogoat/2026/week-N`
   shows the push; send it with `--send` only when Perry says so.

## Saturday preview (week N)

Saturday morning, after Thursday night's game and before Sunday's (Perry, 2026-10-03; it ran on
Thursday mornings for Week 4 only). Same steps with `--type preview` and the directory
`robogoat/2026/week-N-preview`; `week.mjs` writes the leads and the weekend, Injury Desk, series and
Thursday drafts. The facts file's `thisWeek` has each team's points so far from
Thursday's game and who scored them, and the lineups are as set that morning; GFFL's current
win probabilities are the latest reading in `wpgraph_<season>_w<n>` (`p` is the away team's
chance). Lineups move on Saturday morning (on Week 4's, Joe changed quarterbacks within an hour
of the first pull), so run `week.mjs` again just before building; it prints the lineup diff.
Open the column with a "Thursday night,
briefly" section. The skeleton has no scores, bench or chart. Each game's `note` carries the pick
(e.g. "Pick: Sandy."). Add `picks.N` to `season.json` with `"result": ""` for each pick, and put
the same team ids in `issue.json`'s `picks` (for the share image); `picksRecord` is computed from
the earlier weeks' results.
Previews carry no power rankings (the arrows compare recap to recap). `[IMAGE: season]` shows the
season through week N-1.

## Voice

RoboGoat is funny. Perry on the first Week 4 preview (2026-10-03): "its a bit dry, more humor I
think would make it better." Every section carries at least one joke, and each one is built on a
real fact from the facts file or the research: a transaction log, a projection, a chat quote, a
timing mismatch (a questionable player who kicks off after his whole bench). Rib, never wound;
it is a family league. The editor pass checks for laughs as well as numbers.

The app is **GFFL**: "GFFL projects him for 22.4", "GFFL gives her 59 percent", never "the app"
(Perry, same day: "since the app is GFFL, I would call it GFFL"). The suite checks it.

### House rules from the independent review (Perry, 2026-10-10)

An independent editor read all eight columns through the Week 5 preview. Its verdict: the best
jokes are good and are buried under everything around them. Perry asked for its fixes as standing
rules.

- **Length.** Aim for about 1,000 words in a preview and 1,300 in a recap. These are read on
  phones; Weeks 3 to 5 ran 2,000 to 2,900, nine to thirteen minutes. The suite caps the body at
  1,600 words (preview) and 1,900 (recap) for issues from 2026-10-10 on.
- **Open with the best story.** Not the picks record. Week 5's lede was Calvin's 103 points of
  starters on bye; the first draft had it 1,100 words in.
- **One voice.** "I" all the way through. "RoboGoat here." opens and "RoboGoat" signs off; no
  third person in between.
- **Callbacks once.** "On Saturday I wrote…" at most twice a column; the Week 4 recap had it seven
  times. Never reuse a sentence from an earlier column word for word.
- **Numbers that matter.** Points in parentheses only for the players the story is about, not after
  every name. A clock time only when the time is the joke ("8:49 Saturday morning"). Two or three
  a column, not twenty.
- **The Rest of the Weekend is three lines,** not the generated `restOfWeekend` list. Keep the jokes
  in it ("Seven owners have someone in Seattle"), drop the rosters.
- **No repeats between sections.** The Lineup Check lists the questionable and out starters with
  their bench options; the matchup sections do not repeat those details. Recap awards do not retell
  a story already told above them.
- **No plumbing.** How GFFL finalized a week or why an award is missing belongs in `docs/`, not the
  column.
- **Spread the ribbing.** No owner is the butt of the same joke three columns running (Elan's bench
  ran six). Tom is more than an injury list. Each recap carries one sincere award, **Good Call of
  the Week**, rotating to whoever made the week's best decision, with the facts behind it.
- **Corrections.** When a column got something wrong, the next one says so in a line ("This column
  called Murray's Week 1 a zero in five different issues. It was -0.4. I regret the rounding.").
- **Invite the league in, through public chat only:**
  - **Beat the Goat.** Owners can post picks in the league chat before Sunday's first kickoff, and
    the recap keeps the table.
  - **Letters to RoboGoat.** Chat addressed to RoboGoat, like Isaac's "187 points, baby!", gets
    quoted and answered.
  - **The Wednesday Kicker.** The recap names the waiver pickup of the week (named for Sandy's
    Week 3 kicker).
- **Who is related to whom** (Perry, 2026-10-10). Get it right, and use it only inside a joke.
  Never state a relationship as a plain line ("Calvin is Isaac's uncle"); Perry: "too awkward to
  just state it like that, but you can work the relationships into future jokes."
  - Sandy is Perry's and Calvin's mother and Isaac's grandmother ("son #1" and "son #2" in her
    chat are Calvin and Perry).
  - Perry and Calvin are brothers. Isaac is Perry's son, so Calvin is Isaac's uncle.
  - Joe is Perry's father-in-law and John's. John is Perry's brother-in-law.
  - Tom is Joe's brother.
  - Elan is Perry's and Calvin's cousin.
  Do not infer anything beyond this list. A guessed relationship once put a wrong fact in a
  review.
- **Chat GIFs are visible.** `facts.chat[].gif` is the Giphy link a message carried; download it
  and Read it to see a frame. The file name is a random Giphy ID, not a title. Describe a GIF only from what is in
  the frame, or what its poster says it is.

## column.md

Header lines `SUBJECT:`, `KICKER:`, `MASTHEAD:`, `SUBHEAD: Week N · <headline>`, then:

- `## Section`: a section label. Some names switch on a layout: **The Board** (standings table),
  **… Power Rankings** (`1. Team Name (Owner, 2-1). Text.`), **Injury Desk**
  (`Player (Owner): text`), **… Awards** (a title line, then text), and in a recap
  **Week N+1** (`Away Team at Home Team. Text.`).
- `### Heading`: a game heading; team names in it get their logos.
- `[IMAGE: board|stars|bench|wp|season]`: the graphics, built from `issue.json`/`season.json`.
- Chat quotes as their own paragraph, one per line: `Isaac, 4:22 p.m.: "…"`.
- A line reading just `RoboGoat` is the sign-off.

## Subject lines

`RoboGoat: <hook> (Week N recap|preview)`, at most 72 characters, where the hook is the week's
best line: a name and a thing that happened. "RoboGoat: Sandy beats Calvin on a Wednesday kicker
(Week 3 recap)", not "RoboGoat GFFL Week 3 Recap". The same hook is the push body.
