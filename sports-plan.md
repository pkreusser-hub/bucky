# 🏈 SPORTS — fantasy football + NFL scores plan (2026-08-05)

Plan of record for bringing the family's ESPN fantasy league and live NFL scores into Bucky.
Three deliverables, in the user's words: a **fantasy snapshot on the Home page**, an **NFL
scores snapshot for the week** beside it, and a **dedicated sports page** where tapping an
individual NFL game opens an ESPN-app-style detail view — a visual of the field, the last
play, recent plays, box scores — **as real time as possible**.

---

## 1 · Data sources (verified 2026-08-05, web research; ESPN hosts are egress-blocked from
## the dev environment, so live probing happens post-deploy — the stocks.mjs precedent)

### NFL scores — ESPN's unofficial site API (free, keyless)
- **Scoreboard**: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
  (optionally `?week=N&seasontype=1|2|3` or `?dates=YYYYMMDD`). Every game of the week with
  status (pre/in/final), score, clock, quarter, and — for live games — a `situation` object:
  possession, down & distance, yard line, and `lastPlay` text. This alone powers the Home
  snapshot and the sports page's week list.
- **Game detail**: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={id}`.
  One call returns everything the detail view needs: `drives` (previous + current, each with
  `plays[]` carrying text, clock, period, and **start/end yardline + yardsToEndzone** — the
  field visual's data), `boxscore` (team stat rows + per-player passing/rushing/receiving/
  defense tables), `scoringPlays`, `leaders`, linescore, and `winprobability`.
- Team logos/headshots hotlink from `a.espncdn.com` (same posture as the weather page's OSM
  tiles). No key, no signup, no cost.
- **Caveat**: unofficial and undocumented — no SLA, shape can drift. Everything degrades to
  an honest "scores unavailable right now" card, never a blank page (news.mjs posture).

### Fantasy — ESPN fantasy API v3
- `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{leagueId}`
  with `?view=` params: `mSettings`/`mTeam` (league name, teams, owners, records),
  `mMatchupScore`/`mScoreboard` (week matchups with live totals), `mBoxscore` (per-player
  live points for a matchup — starters, bench, slots).
- **A private league requires two cookies on every request: `espn_s2` and `SWID`** (copied
  once from a logged-in browser at espn.com → DevTools → Application → Cookies). These are
  credentials and must NEVER ship to the client — this is what forces the server function.
  `espn_s2` expires roughly yearly; the plan includes an honest in-app "fantasy login
  expired" state plus a status.html registry row so Dad finds out from the ops page, not
  from a kid asking why fantasy is blank.
- Live fantasy scoring on ESPN itself lags real plays by ~30-60s, so a 60s poll during game
  windows is genuinely "as real time as ESPN".

### Real-time strategy
No websockets exist on this stack and ESPN offers none publicly — **polling is the answer**,
and it's what every ESPN-app clone does. Cadence, always paused on `document.hidden` and
resumed+refetched on visibilitychange:
- Game detail open + game in progress: **every 15s** (ESPN's own app runs ~5-20s behind
  broadcast; 15s matches it).
- Sports page week list with any live game: every 25s. No live games: every 5 min.
- Home snapshot cards: wxcard pattern (paint from localStorage instantly, quiet refresh when
  stale) — stale threshold 60s during live windows, 10 min otherwise.
- Fantasy: 60s during NFL game windows, 15 min otherwise.

---

## 2 · Architecture

### `netlify/functions/sports.mjs` — one proxy for both sources
stocks.mjs is the template: zero dependencies, `BUCKY_NOTIFY_SECRET` gate, ALLOWED_ORIGINS,
browser UA on upstream fetches, `SPORTS_NFL_BASE_URL`/`SPORTS_FF_BASE_URL` env overrides so
the test suite can point it at fake servers. Why proxy the NFL side too, when site.api.espn
MIGHT send permissive CORS: (a) CORS there is unverified and unverifiable from this
environment, (b) one code path = one caching/error story, (c) the fantasy side needs the
function regardless. If a post-deploy check shows clean CORS, a direct-fetch fast path for
NFL polling is a measured optimization later, not an assumption now.

Actions (POST `{secret, action, ...}`):
- `nfl_scoreboard {week?, seasontype?}` → slimmed events: id, teams (abbrev, logo, record,
  score), status/clock/quarter, situation (possession/down/distance/yardline/lastPlay),
  broadcast, kickoff time. The server slims aggressively — the raw scoreboard is ~1MB+.
- `nfl_game {eventId}` → slimmed summary: linescore, situation, current drive plays (full),
  previous drives (collapsed: result + play count + yards), scoringPlays, boxscore tables,
  winprobability series (thinned to ≤100 points).
- `ff_league` → league name, teams, owners, records, standings (mSettings+mTeam). Server
  caches in-memory ~1h (warm lambda) — this rarely changes.
- `ff_scoreboard {week?}` → all matchups for the scoring period with live totals
  (mMatchupScore+mScoreboard).
- `ff_matchup {week?, teamId}` → one matchup at player level (mBoxscore, sliced server-side
  to the requested matchup): each slot, player name/team/position, live points, projected,
  and the player's NFL game state (yet to play / in play / final — joined server-side
  against the scoreboard so the client gets it in one call).
- Env: `ESPN_LEAGUE_ID`, `ESPN_S2`, `ESPN_SWID` (S2/SWID only if the league is private).
  Every `ff_*` action returns a typed `{ok:false, reason:"fantasy-auth-expired"}` on ESPN
  401/403 so the client can render the honest re-auth card.
- **No odds anywhere.** The APIs carry betting lines; a family app strips them server-side.

### `sports.html` — the dedicated page
Self-contained page (weather.html precedent): own copy of the nav chrome + Farmstead skin
tokens, activity beacon (`data-feature="sports"`), no Firebase SDK needed (all data through
the function; read state and cache in localStorage).

Views (pill nav, like mealplan's TODAY/WEEK/PROGRESS):
- **🏈 NFL** — this week's games as cards grouped by day. Live games float to the top and
  carry score, clock, possession arrow, down & distance, and last-play line. Week picker
  (‹ Today › plus a week dropdown incl. preseason/playoffs). Tap a game → detail.
- **Game detail** (in-page view, back button; deep-linkable `sports.html#game=<id>`):
  - **Field visual**: SVG 100-yard field + end zones in team colors, yard numbers, hash
    ticks. Ball marker at the live spot (`yardsToEndzone` → x position), first-down line,
    a drive band showing the current drive start→now in the possessing team's color,
    possession arrow. Red-zone tint when inside the 20. This is pure data-driven SVG —
    no images, and the mapping is unit-testable (yardline in → marker x out).
  - **Last play** callout + **recent plays** feed (current drive expanded, previous drives
    as collapsible rows: "TB — 8 plays, 75 yds, Touchdown").
  - **Box score** tab: linescore, team stats side-by-side, player tables (passing/rushing/
    receiving/defense) in `.panner` overflow containers (house convention for wide tables).
  - **Scoring plays** list; small win-probability sparkline (dataviz skill at build time).
- **🏆 Fantasy** — the league's week: every matchup as a card (team names, live scores,
  projected), the family's matchup pinned first and expanded → full lineup view: slot by
  slot vs opponent, live + projected points per player, yet-to-play/in-play/done dot per
  player, bench below. **Standings** section (record, points for). League name in the
  header.

### Home page — two snapshot cards in `renderDashboard`
Slotted after the weather card (hero → calwidget → carewidget → wxcard → **nflcard** →
**ffcard** → askbar → …), both hidden entirely out of season rather than showing empty
shells:
- **🏈 NFL card**: during live windows, up to 3 in-progress games (score, clock, possession
  arrow); otherwise the next kickoffs or this week's finals. Tap → sports.html.
- **🏆 Fantasy card**: the family team's matchup — "Team Kreusser 87.4 — 76.2 Waffle House
  Warriors", a live dot when NFL games are in progress, "8 players yet to play" line. Tap →
  sports.html#fantasy. Which team is "the family team" is config (see Decisions).
Both follow the wxcard refresh discipline exactly: instant localStorage paint, quiet
background refresh when stale, repaint only if still on dashboard.

### Nav
**Decision needed** (see §5): the bar is at 12 areas — the re-skin measured 31.1px/button at
390px and the previous clipping regime started right below that, so a 13th area must be
re-measured before it ships. Options: (a) 13th "🏈 Sports" area (`url:"sports.html"`, the
farmgpt precedent) with the 390px/360px zero-clip check re-run; (b) fold into the Play area.
Proposal: try (a), fall back to (b) if labels clip. Mirror on the sibling pages' navs
(farmgpt/games/weather — keep all in sync, house rule) and the desktop rail + NAV_PATHS
line icon.

### Ops
- status.html registry: a **free-tier row for ESPN site API** (breaks: NFL scores, game
  detail, home NFL card) and a **paid-tier-style row for ESPN Fantasy** marked
  optional/cookie-based with a `configHint` naming ESPN_LEAGUE_ID/ESPN_S2/ESPN_SWID and the
  cookie-grab steps; probe = one `ff_league` call, so `fantasy-auth-expired` shows up RED on
  the ops page when the yearly cookie dies.
- CLAUDE.md entry when shipped.

---

## 3 · Build order (pause after each stage for user playtest — house rule; never push to
## main without preview approval)

1. **Server + NFL week view.** sports.mjs (`nfl_scoreboard`, `nfl_game`) + fixtures captured
   from the real API on deploy day (pregame/live/final/preseason shapes) · sports.html shell
   with nav chrome + the NFL week list + polling/visibility discipline · nav entry with the
   width measurement. *Playtest: real games are live Thu/Sun/Mon once preseason is running —
   August is perfect for this.*
2. **Game detail.** Field SVG + situation + drives/plays feed + box score + scoring plays +
   win-prob sparkline; 15s live poll; deep link. *Playtest during a live game — the field
   visual's feel (does the ball marker track the broadcast closely enough?) can only be
   judged live.*
3. **Fantasy.** Needs the user's league config (see §5). `ff_*` actions + cookie plumbing +
   auth-expired state · Fantasy view (matchups, family lineup detail, standings) · status
   registry row. *Playtest: draft-season data now, real live-scoring test in week 1.*
4. **Home snapshot cards + polish.** nflcard + ffcard in renderDashboard · red-zone/final
   flourishes · CLAUDE.md · full regression battery.

## 4 · Verification (house convention)

- `tools/_verify-sports.cjs` — Section A: sports.mjs in-process against fake ESPN servers
  (fixture files for every game state), asserting: secret gate + origin allowlist, slimming
  (payload budget), cookie headers actually sent on ff_* upstream requests and NEVER echoed
  in any response, auth-expired mapping, odds stripped, per-action failure isolation.
  Sections B+: real Chrome at 390×844 + desktop, function route-mocked, **Firebase blocked**
  (herd-duplication rule): week list states, field-visual geometry (known yardline fixture →
  asserted marker x, both possession directions — the mirror math is exactly the kind of
  thing that ships subtly backwards), poll cadence + hidden-tab pause via fake timers,
  fantasy lineup rendering, every error card, home cards incl. out-of-season hiding.
- `tools/_probe-sports.mjs` — post-deploy live probe (env blocks ESPN here): real
  scoreboard, one real summary, real league fetch; prints shapes + response times, flags
  drift against the fixtures.
- Regressions: chore-care, news, fitness, activity, health suites (nav + home + registry all
  touched).

## 5 · Needed from the user before Stage 3 (nothing blocks Stages 1-2)

1. **League ID** (the number in the league's URL: `leagueId=XXXXXX`).
2. **Public or private?** If private (almost all are): the `espn_s2` and `SWID` cookie
   values, pasted into Netlify env vars — the plan includes step-by-step instructions on the
   status page. They come from any browser logged into the ESPN account.
3. **Which team is the family's** (team name as it appears in the league) — pins the Home
   card and the expanded matchup. If multiple family members own teams, list them all; the
   card can show each person their own team (choreUser-keyed, house identity posture).
4. **Nav placement** preference if the 13th-area measurement forces the fallback (§2 Nav).

## 6 · Risks, stated plainly

- **Unofficial APIs.** ESPN can change or gate these without notice (they've moved the
  fantasy domain before). Mitigation: everything fails to honest cards, fixtures make drift
  visible in the suite, and the probe script diagnoses the live shape in minutes.
- **Cookie expiry** (~yearly) — handled as a first-class state, surfaced on status.html.
- **CORS unverified** — moot via the proxy; direct-fetch is an optimization to measure
  later, never a dependency.
- **Function volume**: 15s polling during a 3-hour game ≈ 720 invocations/device — a full
  NFL Sunday with the whole family watching is a few thousand, far under Netlify's 125k/mo
  free tier, and polling stops the moment the tab hides.
- **Cost: $0.** No keys, no paid API, no model calls.
