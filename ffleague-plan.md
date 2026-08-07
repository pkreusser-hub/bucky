# 🐐 THE GOAT FANTASY FOOTBALL LEAGUE (GFFL) — plan of record

Name: **The Goat Fantasy Football League — the GFFL** (DECIDED 2026-08-07).
Replaces the ESPN app for the 8-team league (keeper, PPR). This is the MAIN league,
not a shadow (user call 2026-08-07; the shadow-season option in §8 stays on the table
as a safety valve, but we build to run the real thing).
This document is the plan of record; build entries get appended per stage like every
other Bucky project.

## 0 · North star

**Fast, simple, clean.** ESPN's app is slow, ad-choked, and buries the three screens a
family league actually lives on. We build exactly those screens and nothing else:

1. **My matchup** — live, breathing, event-fed. The screen everyone has open on Sunday.
2. **My team** — set lineup in ten seconds, see problems before kickoff.
3. **The league** — standings, chat, waivers/trades, the drama.

Everything renders in under a second from cache and never shows an ad, a news module,
or a "Fantasy Cast" upsell. If a screen doesn't serve a Sunday or a Tuesday-night
waiver claim, it doesn't exist.

## 1 · What we are NOT recreating from ESPN

- **News/analysis content** — no articles, videos, expert ranks. Player cards link out.
- **Public leagues / mock lobbies with strangers** — one private league, 8 known humans.
- **Auction drafts, dynasty tools, best-ball, IDP** — keeper snake only (the draft room
  already exists: `ffdraft.html`).
- **Native apps** — installable PWA (Bucky already has manifest + FCM push).
- **Accounts/passwords** — Bucky's soft identity (`choreUser`) + team claim; Dad's PIN
  gates commissioner tools. Same posture as the rest of the app.
- **Stat-corrections infrastructure** — we adopt Sleeper's corrections by re-polling
  before Tuesday finalization instead of building our own review pipeline.
- **Ads, insurance upsells, ESPN+ crossovers** — obviously.

## 2 · Data verdict (LOCKED — measured live, HOF game 2026-08-06, fftest.html)

- **Sleeper public API is the backbone**: one keyless 16KB poll returns every player in
  every game; official `pts_ppr` audits our engine; D/ST rows, injuries, snap counts,
  projections, FG-distance keys. Median 10-40s behind ESPN. CORS `*` — pollable straight
  from the browser.
- **ESPN site API is the live layer**: 10-40s fresher (first on 20 of 23 paired samples),
  and the only source of clock/possession/red-zone. Already proxied by `sports.mjs`.
- **Scoring is ours**: 31/31 offensive stat lines matched Sleeper's official points to
  the cent across two captures. We compute from raw stats with our own rules.
- **Identity needs our own id-map**: Sleeper's `espn_id` is missing for most recent
  players; name+team matching covers nearly all of the rest; a hand-curated alias table
  handles nicknames ("Bam"/"Zonovan" Knight). `players_map` is a first-class collection.
- **ESPN fantasy API (cookies)** works for our private league — used for HISTORY IMPORT
  and draft data only; the live product must not depend on a cookie that expires yearly.

## 3 · Architecture

House pattern, nothing exotic:

- **`league.html`** + `assets/league/lg-*.js` modules (castlekruzer precedent — one page,
  module files, no build step). Embedded as a Bucky tab via the persistent-iframe
  machinery later; standalone page first.
- **`netlify/functions/league.mjs`** — the authoritative server: rules doc writes, waiver
  processing, trade state machine, weekly finalization, history import, AI calls. Gated
  by the family secret like every function; commissioner actions re-checked against
  Dad's PIN hash server-side (the dungeon-mode pattern — this app moves "money").
- **Firestore** collections (family-key suffixed): `lg_settings` (rules doc, versioned),
  `lg_teams`, `lg_rosters` (per week), `lg_matchups`, `lg_transactions` (waivers/trades/
  adds — one append-only log), `lg_chat`, `lg_history` (imported seasons), `lg_weekly`
  (finalized scores, power rankings, awards). Live sync via `onSnapshot` with the
  persistent-cache + `includeMetadataChanges` lessons already learned.
- **Live scoring runs in the CLIENT** (fftest's proven engine, promoted): poll Sleeper
  (one call, whole slate) + ESPN summaries only for games involving league starters.
  Every viewer computes identical scores from the same rules doc — no server in the
  hot loop, nothing to scale, works even if Netlify is down.
- **The server finalizes**: Tuesday morning (scheduled function), re-pull final stats,
  write the official `lg_weekly` doc, update standings/records. Live scores are always
  labeled live; official is official.
- **Push**: existing FCM plumbing (`notify.mjs`, `pushTokens`) — trade offers, waiver
  results, close-game alerts, "you're losing by 2 with one player left" Monday nights.

## 4 · The features

### 4.1 Matchup feed (the heart — user priority #1)
Head-to-head page: both lineups, live totals, and a **scrolling event feed** where every
entry is a fantasy event, not a football event: *"8:42 PM — Ja'Marr Chase 12-yd TD:
**+7.2** · you lead 84.1–79.9"*. Powered by the fftest change-detection engine (already
built and field-tested). Plus:
- **Score-impact framing**: every event shows the delta AND the new margin.
- **Win probability strip** that moves with the feed (our model; see 4.6).
- **Red-zone flags** from ESPN's situation data: a 🔴 on any starter whose team is
  inside the 20 — the "stand up and watch" signal.
- **Players-remaining clocks**: "3 to play vs 1" is half of Sunday math; show it always.
- Yet-to-play players show live-adjusted projections, not season averages.

### 4.2 Editable rules
One versioned `lg_settings` doc, edited in-app by the commissioner: scoring values
(the PPR table fftest already uses), roster slots, playoff format, waiver system,
trade deadline/veto policy, keeper rules. **Every change is logged and announced in
chat** ("Commissioner changed FG 50+ from 5 → 6 pts, effective week 4"); scoring
changes apply from the NEXT unfinalized week so history never silently rewrites.
The scoring engine reads this doc — nothing is hardcoded.

### 4.3 Weekly waivers
- **DECIDED: FAAB, $100 budget** (blind bids, ties by reverse standings). The rules doc
  still supports rolling priority as a knob, but FAAB is the league's system.
- Claims open at kickoff lock, process **Wednesday 8 AM Central** (scheduled function,
  chorereminders pattern), results pushed + posted to chat. Free agency (first-come)
  after clears until Sunday lock.
- Simple claim UX: pick add, pick drop, bid — with the AI advisor (already built in
  sports.html: Grok waiver suggestions against real free-agent data) one tap away.

### 4.4 Trades
Offer → counter → accept, with push at every step. Rules-doc knobs: review window
(default 24h), veto method (commissioner veto default — 8-team family league; league
vote optional), deadline week. Draft-pick/keeper-slot trading is a **later phase** —
player-for-player first. Every completed trade is a chat event and a transactions-log
entry forever.

### 4.5 League chat — gifs and memes
- One league-wide channel + auto-generated event posts (trades, waivers, records,
  Nerd Report drops) so the chat is also the league's timeline.
- **GIF search via Tenor** (free API, one `TENOR_API_KEY` env var, proxied through the
  function so the key stays server-side). **Meme library**: family-uploaded images
  (Firebase Storage — already used by the photo uploader) with a picker of house
  classics; paste-an-image supported.
- Reactions (🔥💀😂🐐), reply-to, and per-matchup **trash-talk threads** that render on
  the matchup page itself.
- Family posture: it's the same people as the Bucky chat surfaces; kids are in this
  league — content stays family-grade, no moderation infrastructure needed beyond
  delete-own + commissioner delete.

### 4.6 AI-powered live projections (the "outdo ESPN" bet)
Two layers, honestly measured before we brag:
- **Deterministic core** (client, free, instant): rest-of-game projection =
  usage-share × plays-remaining, driven by live clock, score differential (run/pass
  script), and the player's actual snap/target share tonight (Sleeper gives snaps
  live). This alone beats ESPN's static-decay model in blowouts and injury situations.
- **AI adjustment layer** (server, Grok/Sonnet via the existing farmgpt provider
  plumbing): every ~5 minutes per LIVE matchup, the model gets the game state +
  deterministic projections and returns per-player multipliers with one-line reasons
  ("CAR down 17, Etienne game-script fade; Metchie target surge — 8 targets on 21
  snaps"). Reasons render in the matchup feed — the projection *explains itself*,
  which ESPN never does.
- **Scoreboard for the bet**: every week we log our projection error vs ESPN's (their
  live proj is in the fantasy API we already read) and show the running tally on a
  stats page. If we're not beating them, the page says so — and that page is fun
  either way.

### 4.7 Locker rooms (team pages)
Each owner's page is THEIRS: upload a logo → we extract its palette client-side
(canvas dominant-color) → the whole page themes to it (header, accents, banner) —
same token-theming muscle the app already has. Contents: record + place, banner
trophies (from history), all-time head-to-head vs each rival, current roster,
schedule/results, transaction history, and a wall where the chat's @mentions of the
team collect. Name, motto, logo editable by the owner only.

### 4.8 ESPN history import
One-time (plus each January) import via the cookie'd fantasy API: every past season's
standings, matchups, champions, drafts. Slimmed into `lg_history` and then **the
dependency is over** — the cookie can die and the record book survives. Feeds:
- **Record book**: highest week ever, biggest blowout, longest streaks, all-time
  standings, championship banners per locker room.
- **Rivalries**: all-time head-to-head on every matchup page ("You lead this rivalry
  31–17 since 2019").

### 4.9 Power rankings
- **Weekly**: algorithmic core (record, points-for, last-3 form, roster strength from
  projections) → ordered list with movement arrows, PLUS the Grok-written blurbs —
  this is The Nerd Report's sibling and reuses its plumbing and voice.
- **Season**: the weekly snapshots make a ranking-over-time chart per team.
- Published Tuesday after finalization; lands in chat.

### 4.10 Playoffs & championship
**DECIDED: 5 playoff teams** of 8, weeks 15–17, seeding by record → points-for:
- **Week 15**: #4 vs #5 play-in; seeds 1–3 earn byes (a real reward for the regular
  season — and the bye race stays alive to the last week).
- **Week 16 semis**: #1 vs the play-in winner · #2 vs #3.
- **Week 17**: Championship + 3rd-place game.
- The other three teams play a consolation round robin, with the **Toilet Bowl**
  crowning (dishonoring) last place in week 17.
Bracket page with live matchup links; champion gets the banner, the trophy-room entry,
and a chat takeover. All of it rules-doc driven so a future season can change format.

## 5 · Suggested additions (the "what am I missing")

- **Lineup guard, pushed**: the sports-tab guard (bye/OUT/IR/Questionable starters)
  becomes a Saturday-night push: "Isaac, your TE is on bye." The #1 quality-of-life
  gap in every family league.
- **Weekly awards, auto-generated**: Top Score, Bust of the Week, **Bench Blunder**
  (most points left on bench — computed from optimal-lineup retro), Kicker Carried
  You, etc. Posted to chat Tuesday with the power rankings. Pure trash-talk fuel.
- **Playoff picture / scenarios**: from week 10, "you make the playoffs if..." — the
  deterministic seeding math plus an AI-written summary. ESPN buries this; we won't.
- **Draft day integration**: `ffdraft.html` (keeper draft room, already built and
  rehearsed) becomes the league's draft; results flow straight into week-1 rosters.
  Keeper declarations UI in the offseason (cost = last year's round, rules-doc knob).
- **The Nerd Report stays**: the weekly Grok column already exists and the family
  reads it — it moves in and gets the finalized data.
- **Trophy case + punishments**: champion banners AND a last-place punishment tracker
  (photo evidence uploadable — this is what the meme library is for).
- **Matchup of the Week**: auto-pick the closest projected matchup, feature it on the
  league home.
- **Dues/payout ledger** (optional, commissioner-maintained note — not a payments
  system).

## 6 · Build order (playtest gate after every stage; preseason weeks 2–3 are the
scrimmage, season starts ~Sep 10)

- **S1 — Foundation**: league.html shell, teams claimed, rules doc + editor, roster
  slots, schedule generator, lineup setting w/ kickoff locks. The id-map collection.
- **S2 — Live scoring + matchup page**: promote the fftest engine; matchup feed,
  totals, players-remaining, red-zone flags. *The league could run on S1+S2 alone.*
- **S3 — Waivers + trades + transactions log** (and the Wednesday scheduled function).
- **S4 — Chat** (Tenor + meme library + event posts) **+ locker rooms**.
- **S5 — Projections** (deterministic core, then the AI layer + accuracy scoreboard)
  **+ power rankings + weekly awards**.
- **S6 — History import + record book + rivalries.**
- **S7 — Playoffs, bracket, trophies** (needed by ~week 12, built earlier).
- Draft room: already exists; wire its output into S1 rosters.

## 7 · Resilience — dual-source live stats with automatic pivot (USER PRIORITY)

The one catastrophic in-season failure is a data source dying on a Sunday. The design
makes EITHER source alone sufficient, and the pivot automatic:

- **One normalized stat schema, two independent feeders.** Proven in fftest: the ESPN
  box parser and the Sleeper normalizer already emit identical stat lines, and the
  scoring engine never knows which source fed it. That property is load-bearing and
  suite-enforced forever: any stat the rules doc can score MUST be derivable from BOTH
  sources.
- **Closing ESPN-only gaps AT BUILD TIME, not in an emergency** (S2 requirements):
  D/ST scoring derived from ESPN's team box + scoring plays; 2-pt conversions and FG
  distances parsed from ESPN's `scoringPlays` (both absent from its box score — the
  fftest checklist finding). After that, ESPN-only mode scores everything.
  Sleeper-only mode already scores everything; it just loses clock/possession/red-zone
  chrome, which degrades the feed's flavor, never its numbers.
- **Source-health state machine** (fftest's endpoint tracking, promoted): a source is
  UNHEALTHY on consecutive HTTP failures, on parse-to-zero-players during a live game,
  or on staleness (no stat movement for N minutes while the other source moves).
  Modes: `dual` (normal — Sleeper authoritative for stats, ESPN for freshness + game
  state) → `espn-only` / `sleeper-only` (automatic, banner shown: "running on ESPN
  only — Sleeper unreachable since 3:42") → back to `dual` when health returns. No
  human in the loop on a Sunday.
- **Tertiary source**: ESPN's fantasy API (`lm-api-reads`, a different host and edge
  than the site API) serves live actuals per player — already read by `ff_matchup`.
  Third independent path if both primaries misbehave.
- **Last resort**: last-known state clearly labeled STALE + commissioner manual score
  entry (needed anyway for corrections). The league never shows silently-wrong numbers
  — every degraded mode announces itself.
- **Finalization stores BOTH raw snapshots** in the weekly doc and reports any
  discrepancy > 0.5 pts to the commissioner before making the week official.
- **Ops**: Sleeper + ESPN site API get rows in status.html's registry so Dad sees
  provider health on the ops page, not just in-app.

## 8 · Backups — league data can never be lost (USER PRIORITY)

Layered, because the failure modes differ (bad write, accidental deletion, Firestore
outage, a kid with devtools — the rules are public-with-a-secret like the rest of
Bucky):

- **The data model resists corruption first**: `lg_transactions` is APPEND-ONLY,
  weekly finalized docs are WRITE-ONCE, the rules doc is versioned. Standings and
  records are always re-derivable from the transaction log + weekly docs — there is
  no single mutable doc whose loss loses the season.
- **Nightly automated export**: a scheduled GitHub Action pulls every `lg_*`
  collection via the Firestore REST API and stores the JSON as a workflow ARTIFACT
  (90-day retention, free, private to the repo's Actions) — point-in-time restore
  for the whole league, no server needed.
- **Season archives in the repo**: monthly and at season's end, a slimmed export
  (history, standings, transactions, weekly results — **never chat**: the repo is
  public) is committed under `assets/league/archive/`. Championship history becomes
  as durable as the code.
- **One-tap commissioner backup**: "⬇ Download league backup" in commissioner tools
  (the fftest export pattern) — Dad keeps local copies whenever he likes.
- **Restore path built, not improvised**: `lg_restore` function action (commissioner
  PIN, server-verified) loads any backup JSON back into Firestore. A backup you've
  never restored from is a hope, not a backup — restoring into a `?fam=` test key is
  part of the S1 verify suite.
- **Test discipline**: every league suite runs against `?fam=` test keys with
  Firebase blocked by default — the herd-duplication incidents are the house scar
  tissue here; league data gets the same protections from day one.

## 9 · Costs & other risks

- **Running cost ≈ $0 + AI pennies**: Sleeper/ESPN keyless, Firestore free tier,
  Netlify existing, Grok/Sonnet on existing keys (~cents/week at family volume;
  usage lands in the existing dashboard buckets).
- **ESPN cookie expiry** touches only history import — refresh yearly or don't.
- **Preseason ≠ regular season**: fftest ran on one game; S2's gate is a full Sunday
  slate test in preseason weeks 2–3.

## 10 · Open questions (decided items struck)

1. ~~FAAB vs rolling priority~~ — **DECIDED: FAAB, $100.**
2. ~~Playoff size~~ — **DECIDED: 5 teams** (1–3 byes, 4v5 play-in week 15).
3. Trade veto: commissioner-only (default) or league vote?
4. Keeper rules to encode: how many keepers, round cost, years allowed?
5. ~~App name~~ — **DECIDED: The Goat Fantasy Football League (GFFL).**
6. ~~Shadow vs main~~ — **DECIDED: build as the MAIN league.** Shadow season remains
   available as a fallback posture if season prep runs tight; the resilience section
   (§7) is what makes running it for real defensible.

---

# 🐐 GFFL S1+S2 — foundation + live scoring/matchup (2026-08-07)

`league.html` + `assets/league/lg-{core,data,ui}.js` + `netlify/functions/league.mjs`.
Standalone page (own future domain — commented host-rewrite block in netlify.toml with
setup steps), passphrase gate → claim-your-team identity, mobile bottom nav / desktop rail.
- **lg-core**: dual backend (Firestore `gffl_<fam>` collection w/ persistent cache +
  includeMetadataChanges, localStorage fallback — suites run local), versioned rules doc
  with append-only change log, commissioner = Dad-PIN gate (dadPinHash scheme), 14-week
  double-round-robin generator (circle method, proven exactly-twice-per-pair), per-week
  roster docs (lazily copied forward), slot/IR eligibility, Chicago week clock w/ test
  override. DECISIONS ENCODED: FAAB $100 · 5-team playoffs (1-3 byes, 4v5 play-in) ·
  **3 IR spots** · ESPN-standard trades (48h review, 4 votes veto) · the ffdraft keeper
  rule (max 3, cost last-round−1 floor R1, 3 straight years max, waiver=last pick).
- **lg-data**: the fftest engine promoted. One normalized schema fed by either provider;
  rules-doc-driven scoring incl. FG distance buckets + DST PA brackets; ESPN-only gaps
  CLOSED (DST derived from the opponent's offensive box — their thrown INTs are your
  INTs — + scoring plays + header score; FG distances and 2-pt conversions parsed from
  scoringPlays text); source-health state machine dual→espn-only/sleeper-only/none w/
  self-announcing banner; Sleeper week-bucket hunt; name+team identity fallback w/ alias
  table; league-scored projections from Sleeper proj stats; live-adjusted projections +
  logistic win prob; change events carry FANTASY DELTAS (the feed's fuel). GOTCHA fixed:
  pollSleeper must await the directory load (a pre-directory poll read as "empty bucket"
  and rotated wrongly) and a failed directory load must THROW so health sees it.
  ⚠ conflict flag = SETTLED disagreement only (game final, sources differ >0.5) — live
  lag is 10-40s by measurement and must not flash.
- **lg-ui**: league home (matchup cards + standings), matchup page (totals, win-prob bar,
  slot-paired lineups, 🔴 red-zone, players-remaining, feed), team page (tap-to-swap
  lineup editor, kickoff locks, bench, IR 3 w/ injury gating), rules page (view for all,
  commissioner edit → version bump + logged diffs, ESPN import w/ unmapped-item review,
  schedule generate, roster import).
- **league.mjs**: read-only importers lg_espn_settings (mSettings/mTeam → mapped scoring
  via STAT_MAP + RAW unmapped list + slots/trade/acquisition/teams) + lg_espn_rosters
  (mRoster → espn ids/pos/proTeam/injury/slot). Import PRESERVES GFFL decisions (IR 3,
  playoffs 5) and adopts ESPN's scoring/slots/trade values.
- VERIFY: `node tools/_verify-gffl.cjs [--shots]` — **82/82, 0 page errors**: in-process
  server section, gate/claim, hand-computed totals (41.0 dual == 41.0 espn-only == 41.0
  sleeper-only — the §7 parity property, asserted), matchup feed deltas, locks/IR/FLEX
  eligibility, rules versioning + live re-scoring, schedule validity, all three degraded
  modes incl. honest STALE, 390px + 1280px. SUITE GOTCHA: the schedule pair-count check
  failed via a CASCADE (fixture ESPN team ids diverged from seeds → 9 teams → 9-team
  schedule) — the generator itself was proven correct standalone first.
- Post-deploy: sports-diag.yml `gffl` job prints the REAL league's imported rules
  (scoring + unmapped + slots + trade + rosters) for review against what we encoded.

# 🐐 GFFL rules review vs the REAL league (2026-08-07, live diag run 31140091195)

The post-deploy `gffl` diag job pulled the Nerd league's actual 2026 settings through the
live function. Findings, and what changed because of them:
- **HALF-PPR** (rec = 0.5, not 1.0) · **3 RB / 3 WR** starting slots (not 2/2) ·
  14 weeks ✓ · playoffs 5 ✓ (already our decided value) · **IR already 3 on ESPN** ✓ ·
  FAAB $100 ✓ · trade review **24h** (not 48h) + 4 veto votes. The rules IMPORT adopts
  all of these on apply, so the encoded defaults being off is self-healing — but the
  import is now provably complete for this league's scoring (below).
- **12 unmapped scoring items** in the first import. 9 identified with confidence and
  NOW MAPPED + ENGINE-SUPPORTED: yardage GAME BONUSES 17/18 (pass 300+/400+),
  37/38 (rush 100+/200+), 56/57 (rec 100+/200+) — derived in `D.score` from the stat
  line as mutually-exclusive brackets exactly as ESPN applies them (a 410-yd game earns
  the 400 bonus only); distance FG misses 79/82 → `fg_miss`; 63 → `off_fum_td`
  (+ Sleeper's `fum_rec_td` normalized into it).
- **3 STILL UNCERTAIN, must be confirmed empirically before week 1**: statId 206 (2 pts),
  209 (1 pt), 214 (0.1/unit — possibly FG-made yards). Notably the league's scoring
  carries NO conventional FG-made ids (74/77/80/83) — kicker scoring may run entirely
  through 214-style per-yard items. CONFIRMATION PLAN: pull a 2025 kicker's applied
  weekly stats (kona_player_info appliedStats) and solve the coefficients against his
  official weekly totals; adjust STAT_MAP + the engine before the season.

# 🐐 GFFL S3 — waivers + trades + transactions log (2026-08-07)

`assets/league/lg-core.js` (waiver/trade/tx state machine) + `lg-data.js` (free-agent
search over the Sleeper directory) + `lg-ui.js` (the new 🔁 Moves tab) + `league.html`
(nav button, `.picked`/list CSS). `netlify/functions/league.mjs` untouched — S3 is
entirely client-side per the plan's own resilience posture (no server in the hot loop).
- **FAAB claims**: one doc per week (`claims_<season>_w<week>`), blind by UI
  convention only — the doc is a normal shared read, `lg-ui` just never renders another
  team's claim before the week is processed. `LG.processWaivers(week)` is deterministic
  and idempotent: sorts by bid desc, ties by `LG.waiverPriorityOrder()` (worst record
  first — fewer wins, then fewer PF, then lower teamId, off the SAME standings math the
  league-home table already used — that function moved from a private `lg-ui` helper to
  `LG.loadStandings` so both share one source of truth). A claim wins iff its target
  isn't already owned or won-this-run, its drop is still on the roster, and the bid fits
  remaining FAAB (`team.faab`, default = `rules.waivers.budget`); winners get their
  roster updated (drop out, add in on BENCH) + FAAB deducted + one `"waiver"` tx logged;
  losers get a reason (`outbid`/`player-taken`/`drop-gone`/`insufficient-faab`) and
  nothing moves. Re-reads the doc immediately before the final write (guards a
  processed-twice race) and short-circuits instantly if already processed.
- **Deadline**: `LG.waiverDeadline(week)` reads `rules.waivers.processDow/processHour`
  (default Wed 8am, already in `DEFAULT_RULES` — nothing new to configure) off the same
  fixed-clock convention `LG.currentWeek()` uses. Free agency (first-come, no bid,
  `LG.faAdd`) is simply "whatever week it is once the deadline has passed" — no separate
  FA-open flag to get out of sync.
- **DEVIATION from plan §4.3/§6 (documented, not a scheduled function)**: processing is
  **client-triggered** — `UI.boot()` and every `renderMoves()` call `maybeAutoProcess-
  Waivers()`/`maybeAutoExecuteTrades()`, so the first client to open the app (or Moves)
  past a deadline carries the league forward for everyone (idempotent, so simultaneous
  clients can't double-run it). A commissioner "⚙ Process now" button (`gateCommish`) is
  the manual backstop. A real Wednesday-morning scheduled function is future work if a
  week ever goes by with nobody opening the app.
- **Trades**: `LG.offerTrade/acceptTrade/declineTrade/cancelTrade/vetoTrade/executeTrade`.
  Offer → accept (opens a `rules.trades.reviewHours`-hour window, `reviewEndsAt`) →
  auto-executes once any client opens past that window, UNLESS `rules.trades.vetoVotes`
  (default 4) distinct NON-party owners veto it first (repeat votes from one team don't
  double-count; the two parties can't veto their own trade). Execution re-verifies both
  rosters right before swapping and fails SAFE to `status:"cancelled"` (never a half-swap)
  if a listed player has moved since the offer. Blocked entirely past
  `rules.trades.deadlineWeek`. **No roster-size cap on an uneven trade in v1** (a 2-for-1
  is legal) — the plan flagged this as a later-phase decision, left open here.
- **Adds/drops are NOT kickoff-gated** (plan's explicit v1 scope — only the STARTING
  LINEUP has locks); a trade can include a player whose game already started.
- **Transactions log**: append-only, `tx_<t>_<rand4>` docs, one per actual roster move
  (a LOSING waiver claim is not a transaction — nothing moved). Rendered as plain
  sentences newest-first in the Moves "Log" card.
- **UI**: new 🔁 Moves tab — My pending (my claims + my trades + a "trades under review"
  block any non-party owner can vote on, + my last waiver results once the week's
  processed) · Waivers (FA search over `D().searchFA`, min 3 chars, excludes anyone
  already rostered league-wide, shows remaining FAAB + the next deadline; flips to
  instant free-agency once the deadline's passed) · Propose a trade (counterparty picker
  + up-to-3-a-side player chips) · Transaction log.
- VERIFY: `node tools/_verify-gffl.cjs [--shots]` — **150/150, 0 page errors** (82 prior
  + 68 new: blind claims across two independent browser contexts, bid/tie-break/FAAB
  math, idempotent re-processing, deadline auto-process on boot, FAAB-never-negative,
  claim cancel, a full offer→accept→hold→execute round trip across two devices with the
  roster swap verified both directions, the veto threshold incl. self-veto and duplicate-
  vote rejection, decline/cancel, and the trade deadline). SUITE GOTCHA: `UI.boot()`
  originally fired the auto-process checks fire-and-forget (never blocking the more
  time-sensitive league render) — correct for production, but it meant `await UI.boot()`
  in a test returned before processing actually finished. Fixed by awaiting them in boot
  after all: this path only does real work once a deadline/review-window has genuinely
  passed (a couple of cheap doc reads otherwise), so the ordering guarantee is worth more
  than the few extra ms.

# 🐐 GFFL S4 — league chat + locker rooms (2026-08-07)

`assets/league/lg-core.js` (chat data layer + event-post hooks), `assets/league/lg-ui.js`
(the new 💬 Chat tab, matchup trash-talk threads, locker rooms), `league.html` (nav button,
`#imgOverlay`, chat/locker CSS), `netlify/functions/league.mjs` (one new action, nothing
else touched — `lg_gif_search`, a Tenor proxy).
- **Chat data model**: one doc per message, `kind:"chat"`, id `chat_<t>_<rand4>` (no id
  stored inside the doc — same convention as `tx_*`; `LG.db.list("chat")` attaches it from
  the key). `LG.postChat({text?,img?,gif?,replyTo?,thread?})`, `LG.loadChat(thread)`
  (oldest-first, filtered to that thread or the main channel when `thread` is null/absent),
  `LG.loadAllChat()` (newest-first, every thread — feeds the meme library and lockers'
  "wall"), `LG.toggleReaction(id,emoji,teamId)`, `LG.deleteChat(id,byTeamId,allowCommish)`.
  `LG.db` gained a `del` (both backends — `localStorage.removeItem` / `fs.deleteDoc`, no new
  import needed, `deleteDoc` already rides in on the existing `fs` module namespace).
- **Event posts**: `LG.postSys(text)` (self-catching — chat can never break the flow it's
  narrating) called from the three places the plan named — `saveRules` (after logging
  changes), `processWaivers` (after the winners are decided, naming who won what),
  `executeTrade`/`vetoTrade` (the same player names the transactions log already computes).
  Every call site ALSO wraps its own `postSys` call in try/catch — belt and suspenders.
- **Reactions** (🔥💀😂🐐): tap toggles your teamId in that emoji's array; counts render
  inline, no count shown at zero.
- **Reply-to**: composer captures `{id,who,text}` of the tapped message, renders a small
  quoted preview above the compose row; the sent message carries `replyTo` and renders a
  `.chatQuote` snippet of the original above its own body.
- **Delete**: own messages always; `LG.commishUnlocked()` unlocks delete-any. Hard delete
  (`LG.db.del`), not a soft/hidden flag.
- **Images**: file-pick → resize to ≤320px longest side, JPEG q0.72 (`resizeImageToDataUrl`,
  the same shape as index.html's photo pickers, written inline per house convention — no
  shared JS module between pages). One gate, `UI.attachImage(idPfx,dataUrl)`, refuses over
  `IMG_CAP` (~80,000 dataURL chars) with a toast; exposed so a test can drive the oversized
  path directly without needing a real >320px source image. Tap a posted image → `#imgOverlay`
  full-size view.
- **Meme library**: `LG.recentChatImages(12)` — the most recent DISTINCT images posted
  ANYWHERE in chat (main channel or any thread — "house classics" span the whole league, not
  one thread), tap-to-repost via the same `UI.attachImage` gate.
- **GIFs (Tenor)**: `netlify/functions/league.mjs`'s `lgGifSearch` — no `TENOR_API_KEY` →
  `{ok:false,reason:"gif-not-configured"}` at HTTP 200, never a 500; a key configured →
  `GET tenor.googleapis.com/v2/search` (base overridable via `TENOR_BASE_URL` for tests),
  `contentfilter=high` (deliberate — kids are in this league), mapped to `{url,preview}`
  from `media_formats.tinygif/nanogif`. Client: the GIF button starts VISIBLE (no proactive
  probe — a blocked/no-key Tenor should never cost a request nobody asked for); the FIRST
  tap probes once (`ensureGifAvailability`), and only the literal `gif-not-configured`
  reason hides the button for the rest of the session (any other hiccup stays retryable).
- **Matchup trash-talk threads**: `thread:"w<week>_<h>-<a>"` — the exact same chat widget
  (`chatWidgetHtml`/`wireChat`/`refreshChatList`, id-prefixed `muThread`) mounted at the
  bottom of the matchup page. Genuinely separate from the main channel and from every other
  matchup's thread (asserted both directions).
- **Polling**: the Chat tab refreshes every 8s while open (`startChatPoll`/`stopChatPoll`,
  cleared at the top of every `UI.show()` so switching views can never leak a timer); the
  matchup thread gets its own poll too, restarted only on a genuine idPfx/thread change so
  the live-score repaint cycle (which already rebuilds the whole matchup page) doesn't spawn
  a fresh interval every tick.
- **Lockers** (plan §4.7): route `#locker=<teamId>`, reached by tapping a team name anywhere
  sensible (standings rows, matchup header, both team names) via a shared `data-locker`
  delegate (`UI.openLocker`/`wireLockerTaps`) — no new nav entry, per the plan. "My locker"
  on the team page header jumps to the VIEWER's own team. Contents: themed header (name,
  motto, place+record), current-week roster, schedule with results-so-far (reads `weekly`
  docs when they exist, `—` otherwise — degrades honestly since finalization is S5+), that
  team's own transaction history (reusing `txSentence`), and "the wall" — chat messages
  (any thread) that mention the team's name or `abbrev`, newest first, capped at 15.
- **Owner editing**: `LG.myTeamId() === teamId` gates Name/Motto (max 80 chars)/Logo edit
  buttons — absent entirely for anyone else, verified from a second device.
- **Palette extraction**: `extractPalette(dataUrl)` — draws to a 32×32 canvas, buckets
  pixels by 10°-wide hue (skipping grayish/near-black/near-white), picks the most-populous
  saturated bucket's average RGB. Computed ONCE at logo-upload time and stored as
  `team.colors.primary`, never recomputed on render; the locker header uses it as its
  background (white text) or falls back to the app's green. Verified against a REAL
  upload — a canvas-generated red PNG assigned to the hidden file input via a synthesized
  `File`+`DataTransfer`+`change` event (not a shortcut call), so the resize→extract→save→
  re-render chain is exercised end to end.
- **GOTCHA (found via a screenshot, not a test) — the house `[hidden]`-override lesson bit
  FOUR new elements**: `#imgOverlay` (`.imgoverlay{display:flex}`) and three chat auxiliary
  panels (`.chatmeme`/`.chatGifGrid{display:grid}`, `.chatReplyPreview`/`.chatPending
  {display:flex}`) all stayed visually SHOWN despite their `hidden` attribute, because an
  author rule with no matching `[hidden]` restatement always beats the UA default — this is
  the third time this exact class of bug has hit this codebase per CLAUDE.md, and it's why
  `#imgOverlay` was silently covering the WHOLE PAGE (including the passphrase gate button)
  from first load. Fixed with explicit `[hidden]{display:none}` restatements on all four;
  the suite now also asserts GEOMETRY (`getBoundingClientRect().height === 0`), never the
  attribute, for exactly this reason.
- VERIFY: `node tools/_verify-gffl.cjs [--shots]` — **217/217, 0 page errors** (150 prior +
  67 new: sections K/chat — text post+persist, cross-device visibility via a snapshot-based
  "second device" (the local backend's per-context storage stand-in — `snapshotAllDocs`/
  `replaceAllDocs`, the latter clearing the target's whole doc set first since a MERGE can't
  represent a deletion), reactions on/off, reply+quote, delete (own/absent/commissioner, incl.
  proving delete propagates through `LG.db.del` rather than a per-context filter), images
  (oversized refused/small posts/overlay/meme-repost), GIF search (no-key hides-on-first-tap,
  keyed end-to-end against a fake Tenor upstream), all four event-post call sites, matchup
  threads separate both directions — and L/lockers — header/roster/schedule/tx/wall, owner-
  only editing (both directions), the real upload→palette→header-color pipeline, tap-through
  from standings/matchup/"My locker". Fake Tenor server on its own port, same house pattern
  as the fake ESPN fantasy upstream. Screenshots: `gffl_chat_390.png`, `gffl_matchup_
  thread_390.png`, `gffl_locker_390.png`.
- DEFERRED: no scheduled Wednesday-morning digest of chat activity (not asked for); GIF
  search has no pagination/load-more (12 results, matches the design's grid); the meme
  library doesn't distinguish "posted by me" from "posted by anyone" (deliberate — house
  classics are shared); reader/read-state ("seen by") is out of scope, same posture as the
  rest of the app's chat-adjacent surfaces.

# 🐐 GFFL — the 3 mystery scoring ids SOLVED (2026-08-07, live kicker audit)

`lg_espn_kicker_audit` pulled 2025 kickers' league-applied season lines and **Michael
Badgley reconciled to the penny**: appliedTotal 64.5 = 20 XP (×1) + 0.1 × 445 FG made
YARDS, his lone 50+ miss unpenalized. That proves:
- **214 = FG made yards, 0.1/yd** — the league's ONLY per-make FG scoring (no flat FG
  points exist; a 45-yarder is worth 4.5). Engine: Sleeper `fgm_yds` ↔ ESPN scoring-play
  distance sum (uncounted makes approximate at 33 yds under the existing fgApprox flag).
- **206 = 2-pt conversion returned for TD** (2 pts, DST) — ffscrapr's map confirms the
  name; Sleeper `def_2pt` feeds it.
- **209 = 1-pt safety** (1 pt) — rarest play in football; NO live source carries it
  (documented ~0-impact approximation on both feeds; the import maps it so the rules doc
  is complete).
**Every scoring item in the real league now maps — unmapped list is empty.** Audit
endpoint kept for future rule archaeology (the sort-filter 400s on past seasons; the
slot-only fallback is what worked). Suite 220/220.
