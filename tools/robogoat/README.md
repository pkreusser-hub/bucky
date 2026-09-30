# RoboGoat kit

Everything that turns a week of GFFL into a RoboGoat column page at
`goatfantasyleague.com/robogoat/<season>/<issue>/`. Read the RoboGoat entries at the bottom of
[docs/gffl.md](../../docs/gffl.md) first: copy rules, names, and why the pages look the way they do.

| file | does | touches |
|---|---|---|
| `facts.mjs` | pulls one week's facts into a scratch JSON, plus an `issue.skeleton.json` | reads Firestore + Sleeper; writes only `--out` and, with `--season-file`, new weeks into `season.json` |
| `build.mjs` | `column.md` + `issue.json` (+ `wp.json`, `season.json`) → `index.html` | repo files only |
| `share.mjs` | the 1200×630 `share.png` link preview | repo files only; bundled fonts in `fonts/` |
| `archive.mjs` | `robogoat/index.html` (the archive page) + `robogoat/issues.json` | repo files only |
| `announce.mjs` | the league push for a new issue; **dry run unless `--send`** | `--send` wakes every league phone |
| `lib.mjs` | Firestore read helpers, names, browser launch | — |
| `page.css` | the issue page's stylesheet, inlined by `build.mjs` | — |

Nothing in this kit writes league data. The only outbound write is `announce.mjs --send`.

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

## Tuesday recap (week N)

1. Facts, into the session scratchpad (`$SP`), with the season file updated:
   `node tools/robogoat/facts.mjs --season 2026 --week N --type recap --since <last issue's date> --out $SP/kit --season-file robogoat/2026/season.json`
   The recap's own team totals are `weekly[N].matchups` (the app's). Player points come from the
   shadow scorer and can differ from the app's by a stat correction; quote the app for team totals.
2. Research the real NFL games, write the column, have an editor agent revise it. Public league
   chat only (`facts.chat`); never private email or `act_*`/`trade_*` docs.
3. `mkdir robogoat/2026/week-N`, write `column.md`, copy `$SP/kit/issue.skeleton.json` to
   `issue.json` and fill in: `published`, `subject` (see Subject lines), `description`, `window`,
   `picksWeek`, each game's `note`, `stars`, `wp` (the chart spec; see Week 3's for the shape) and
   `allowTwoDecimals` (only values the column is about). Copy the charted game's series from
   `$SP/kit/wp.all.json` into `wp.json` as `{ "m_<home>_<away>": [...] }`.
4. In `season.json`: set `picks.N[*].result` to `"W"`/`"L"` for the preview's picks, and add
   `rankings.N` in the column's power-ranking order (team ids). The arrows compare against `N-1`.
5. Build: `node tools/robogoat/build.mjs robogoat/2026/week-N`, then
   `node tools/robogoat/share.mjs robogoat/2026/week-N`, then `node tools/robogoat/archive.mjs`.
6. `node tools/_verify-robogoat.cjs` must be green. Look at a 390px screenshot of every panel.
7. Commit on the working branch with the suite count, push the branch, open a PR, ask Perry to merge.
8. Gmail draft to the league: subject = `issue.json` subject, a two-line teaser and the link.
9. After Perry merges and Netlify deploys: `node tools/robogoat/announce.mjs robogoat/2026/week-N`
   shows the push; send it with `--send` only when Perry says so.

## Thursday preview (week N)

Same steps with `--type preview` and the directory `robogoat/2026/week-N-preview`. The skeleton
has no scores, bench or chart. Fill `picksRecord` (the season so far), each game's `note` (it
carries the pick, e.g. "Pick: Sandy."), `picks` (the picked team ids, for the share image), and
add `picks.N` to `season.json` with `"result": ""` for each. Previews carry no power rankings
(the arrows compare recap to recap). `[IMAGE: season]` shows the season through week N-1.

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
