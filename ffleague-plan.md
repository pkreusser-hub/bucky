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

# 🐐 GFFL S5 — weekly finalization + projections + accuracy + power rankings + awards (2026-08-07)

`assets/league/lg-core.js` (finalization/projection/power-ranking/award engine),
`assets/league/lg-ui.js` (league-home cards, the commissioner's Finalize button, the matchup
page's ✨ AI read), `netlify/functions/farmgpt.mjs` (ADD-ONLY: a new mode `"gfflproj"`, copying
the fantasy/ffrecap shape — every diff hunk is a pure insertion, confirmed via `git diff`,
`netlify/functions/league.mjs` untouched). The prereq everything else in this stage feeds on.
- **`LG.finalizeWeek(week, {force})`**: computes each scheduled matchup's official totals from
  that week's rosters' STARTERS via the SAME live engine rows the matchup page already shows
  (`LG.data.S.players.get(key).pts` — at finalization time, with every relevant game "post",
  that value IS the final score). Writes `weekly_<season>_w<week>` `{kind:"weekly", week,
  matchups:[{home,away,homePts,awayPts}], awards, power, accuracy, finalizedAt}` — this is the
  SAME doc shape `LG.loadStandings`/`lockerScheduleRows` already read, so nothing downstream
  needed to change. Idempotent (an existing doc returns untouched, re-checked right before the
  write — same race guard as `processWaivers`). Guard: refuses (`{ok:false, reason:"not-final",
  pending:[...names]}`) unless every one of the week's starters' games reads `"post"` — a
  MISSING/unknown game state counts as "not final" (a week is never guessed official from
  incomplete data) — unless `opts.force` (the commissioner override, offered via a confirm
  dialog on the league home's Finalize button when the guard refuses). Posts ONE sys chat
  message naming the scores + all three awards, wrapped in try/catch (chat is never
  load-bearing).
- **Projection snapshots**: `LG.snapshotProjections(week)` — once per week, per device-first-in
  (same idempotency pattern), snapshots every rostered STARTER's pre-game projection
  `{key,name,teamId,proj}` from `LG.data.projFor`, skipping anyone whose game has already
  started. Returns `null` (writes nothing) when there's nothing worth snapshotting yet, so a
  too-early attempt can never lock in an empty/garbage snapshot that blocks a real one. Fires
  automatically at boot, chained off `d.initSleeper()`'s own memoized promise (so it runs once
  the engine's projections are actually warm, never a second directory fetch).
- **Accuracy scoreboard**: at finalization, `accuracy: {ours, n}` = mean `|proj − actual|` over
  the week's projection snapshot, stored in the weekly doc. `LG.seasonAccuracy()` rolls every
  finalized week's `accuracy` into one running season figure. **HONEST LABELING** (per the
  brief): the league-home "📈 Projection accuracy" card states only our own miss against our own
  pre-game snapshot — it is NEVER framed as a comparison to ESPN, because ESPN's live
  projections aren't logged (deferred below). The card renders nothing at all until there's a
  real number to report.
- **Power rankings**: `LG.powerRankings(throughWeek, extraWeeklyDocs)` — pure function of the
  persisted `"weekly"` docs: **score = 4×wins + 0.05×PF + 2×(wins in the last 3 games played)**
  (ties count as neither a win nor a loss for the last-3 term). `extraWeeklyDocs` lets
  `finalizeWeek` rank THROUGH the week it's currently writing before that doc exists (so the
  snapshot baked into a week's own doc already reflects that week's result). `finalizeWeek`
  stores the trimmed `power:[{teamId,score,rank}]` into the doc. The league-home "🏆 Power
  rankings" card always shows the LATEST finalized week's snapshot (independent of which week
  you're currently browsing — the plan's "published Tuesday after finalization" framing), with
  a movement arrow (▲/▼ + the rank delta) against the PRIOR finalized week's OWN snapshot for
  each team; a team with no prior week to compare against (week 1, or a gap) shows a dash, never
  a false arrow. Renders nothing until at least one week is official.
- **Weekly awards**, computed at finalization from that week's just-settled matchups: 🏅 **Top
  Score** (the single highest-scoring team) · 💀 **Bust of the Week** (the starter with the
  biggest `proj − actual` shortfall, minimum proj 8 — so a low-projected afterthought can't win
  it by scoring exactly what nobody expected) · 🪑 **Bench Blunder** (the team that left the most
  points on the bench, `optimal − actual`). "Optimal" is computed by `fzOptimalTotal`: fill every
  DEDICATED position slot (QB/RB/WR/TE/DST/K) with its own top scorers first — dedicated slots
  never compete with each other, so that's always at least as good as any alternative — then
  FLEX with the single best REMAINING RB/WR/TE. Provably optimal for this "one shared slot"
  roster shape (an exchange argument: swapping a worse player into a dedicated slot to "free up"
  a better one for FLEX can never help, because the vacated dedicated slot can only be re-filled
  by another player of that SAME position). All three awards are `null` when nothing qualifies
  (e.g. no starter has a proj ≥8, or nobody has any bench upside) rather than naming an
  arbitrary "winner."
- **Auto-finalization**: `maybeAutoFinalizeWeeks()` (mirrors S3's waiver/trade auto-processing)
  walks every week `w` with `1 ≤ w < currentWeek()` and calls `finalizeWeek(w)` if no weekly doc
  exists yet — idempotent and self-limiting (it naturally refuses via the guard until the live
  engine actually confirms every relevant game is over), so calling it often and from several
  places is cheap and safe. Triggered from `UI.boot()` (usually a fast no-op — the live engine
  hasn't polled anything yet at that point in boot, so the guard can't confirm anything), from
  `d.onUpdate` (the REAL trigger — fires after every live poll, once data genuinely exists), and
  from every `renderMoves()` visit (same three-call symmetry as S3's waiver/trade checks).
  **Deliberately never touches `week === currentWeek()`** — the live/in-progress week is never
  auto-finalized even if its data would incidentally pass the guard too; only the commissioner's
  explicit "✅ Finalize week N" button on the league home can finalize the CURRENT week (with a
  force-confirm fallback if the guard refuses).
- **✨ AI read** (plan §4.6's AI adjustment layer, mode `"gfflproj"`): Grok 4.5, same
  no-key-degrade + mid-request-outage-fallback shape as `"fantasy"`/`"ffrecap"` — a site with no
  `XAI_API_KEY` (or a dead xAI endpoint) resolves to `RESEARCH_MODEL` (Sonnet), added as
  standalone `if` blocks so the existing fantasy/ffrecap dispatch lines are never touched.
  System prompt `GFFLPROJ_SYSTEM` demands strict JSON `{players:[{name,mult,why}]}`, `mult`
  clamped 0.5–1.5, `why` ≤12 words, empty list a fine (and expected-common) answer, and
  instructs the model to only ever adjust an "in"-state player (not "pre"/"post" — nothing to
  adjust yet or any more). The server builds the single user turn from named body fields
  (`matchup:{week,teams:[{name,players:[...]}]}`) — never a client-supplied `messages[]`, per
  the ledger lesson (`MAX_CONTENT_CHARS` would slice a JSON payload mid-string). **Deliberately
  NOT auto-polling in v1** (per the brief) — a button (`#aiReadBtn`) on the matchup page, because
  preseason has no live data to adjust against and a page that fires a Grok call every poll tick
  would spend real money for nothing most of the season. One result is cached 5 minutes per
  matchup (a second tap on the same matchup inside the window fires no new request); a fresh
  matchup or an expired cache starts over. The client applies the returned multiplier to that
  player's OWN projection (`adjusted = proj × mult`) and renders `proj → adjusted ×mult` plus the
  model's one-line reason. Degrades SILENTLY on any failure (network, bad JSON, an unreachable
  model) — a toast, the card falls back to an inviting placeholder, never a broken page.
  **Robustness fix found while testing** (not a spec change): the payload's per-player
  name/pos/team now come from the ROSTER data first (always present) with the live-poll row
  layered on top only for stats/game-state — a player the poll hasn't reached yet (no stat line
  has arrived for them this cycle, which happens for real in production too, e.g. a bench/
  inactive player, or briefly for anyone before their first stat update of the night) used to
  fall back to their raw internal KEY as a "name" in the request; now it always sends their real
  name.

---

# 🐐 GFFL S6 — ESPN history import + record book + rivalries (2026-08-07)

`netlify/functions/league.mjs` (ADD-ONLY: one new action `lg_espn_history` + its dispatch
line — every existing function/line untouched, confirmed via `git diff`), `assets/league/
lg-core.js` (`LG.loadHistory`/`LG.headToHead`/`LG.recordBook`), `assets/league/lg-ui.js`
(the Rules-page importer, the league-home record-book card, the matchup page's "All-time
series" line, the locker's championship banners + rivalries table), `league.html`
(`.recordbook`/`.h2hline` CSS).
- **`lg_espn_history {season}`** — one PAST season per call, cookie-gated exactly like the
  other importers. Tries the plain URL first, then a `scoringPeriodId=0` retry (the kicker
  audit's real-world finding that past-season kona reads sometimes need it), so a season the
  plain form can't see is never silently missed. Slims hard: `teams:[{id,name,abbrev,owner,
  w,l,t,pf,pa,place}]` (`place` = `rankCalculatedFinal`, falling back to `playoffSeed`),
  `champion:{teamId,name}` (whichever team's `rankCalculatedFinal===1`, else `null`), and
  `matchups:[{week,home,away,homePts,awayPts}]` from the schedule (`week` =
  `matchupPeriodId`; a bye/unplayed pairing where BOTH sides read 0-0 is skipped — a real
  0-45 blowout is not). Unknown season / an empty league / an out-of-range year all resolve
  to `{ok:false, reason:"no-season"}` at HTTP 200, never a 500 — that's the client loop's
  stop signal, not an error to surface.
- **The client import** (commissioner-gated, Rules page, "📜 Import history"): walks seasons
  from `(current league year − 1)` down to 2015, one action call at a time, writing each
  success as `hist_<season>` `{kind:"hist", season, leagueName, teams, champion, matchups}`.
  Stops at the FIRST miss once it already has at least one success (a January re-run
  naturally stops right after the newest already-imported season, since that's the first
  year it now finds nothing new); before any success, gives up after 3 consecutive misses
  rather than grinding all the way to 2015 against an empty/never-existed league. Re-running
  always overwrites (the doc write always carries every field, so a plain `set` is a clean
  replace) — the January-refresh case from the plan needs no special "clear first" step.
  Progress paints live in `#importOut` ("Importing 2019… (3 seasons so far)"); the final line
  names the count + the season range.
- **`LG.headToHead(teamA, teamB)`** — all-time record between two CURRENT team ids, from
  imported history AND this season's own finalized `weekly` docs COMBINED, so a rivalry keeps
  growing the moment this season's games go official without waiting for a January
  re-import. Team identity is the ESPN team id: stable across seasons by ESPN's own design,
  and stable into the live GFFL doc too because `importFromEspn` already saves every current
  team under its real ESPN id — so joining "who is this franchise now" back to history needed
  no new mapping table, just `LG.teamById(id)`.
- **`LG.recordBook()`** — every superlative computed purely from `hist` + `weekly` docs:
  🏆 champions by year, 🔥 highest single-week score ever, 💥 biggest blowout (by margin),
  📈 best single-season PF, and 🐐 all-time standings (aggregated PER FRANCHISE by ESPN team
  id — W/L/T/PF summed across every imported season plus this season's own finalized weeks,
  titles counted from the champions list, sorted titles→wins→PF). A franchise whose current
  team doc still exists is shown under its CURRENT name; one that's been deleted/replaced
  falls back to whatever name that season's own history doc recorded for it — never a bare
  id. `hasData` is `false` only when there's genuinely nothing on file (no import, no
  finalized week yet) — the UI's cue for the empty state.
- **UI surface**: a collapsed `<details class="recordbook">` card on the league home (kept
  closed by default so it doesn't crowd a page that's mostly about THIS week), a one-line
  "All-time series: X leads Y–Z" (or "tied") under the matchup header — omitted entirely
  with no shared history — and, on every locker, a 🏆 Championships banner list (years only,
  rendered only when that franchise has titles) plus a Rivalries table listing ONLY the
  opponents with actual shared history (a team with zero games against you doesn't appear as
  a padded 0-0-0 row). Every team name in these three surfaces is a real `data-locker` tap
  target into that franchise's own locker (`wireLockerTaps()` — the locker page itself
  wasn't calling this before; S6 added the one missing call).
- **VERIFY**: `node tools/_verify-gffl.cjs [--shots]` — **314/314, 0 page errors** (276 prior
  + 38 new, section N): the raw action's slimming hand-checked field-by-field (place from
  `rankCalculatedFinal`, the champion pick, the 0-0-bye skip proven by a fixture season that
  ALSO carries a real 0-vs-nonzero-adjacent game, matchup field shapes), the retry ladder
  PROVEN not just assumed — one fixture season's plain URL deliberately returns empty and
  only resolves via the `scoringPeriodId=0` form — plus no-season and out-of-range refusals;
  the client import loop's stop rule exercised for real (the league's own current-year-minus-
  one season misses first with zero successes yet and correctly keeps going, then two real
  seasons import, then the loop stops at the next miss), with `hist_2024`/`hist_2023` written
  and no `hist_2022`; every record-book superlative hand-computed against two fixture seasons
  designed so each has exactly one right answer (highest week 182.4, biggest blowout margin
  100.0, best season PF 1710.6, all-time standings aggregated across BOTH seasons with exact
  W/L/PF/titles per row); `LG.headToHead` checked in both argument orders (proving it's a
  perspective flip, not two different answers) plus a zero-history pair reading honest zeros;
  the matchup page's series line on a real scheduled matchup; a locker's banner list (2023
  only, correctly NOT 2024 — a different franchise won that one) and its rivalries table
  (exactly the 2 opponents with real history, not all 7); and a from-scratch empty-state pass
  (no hist docs at all) proving the guiding message renders instead of an empty table, the
  commissioner-only import hint is genuinely gated on `isCommish()` (checked both ways in the
  SAME context — before and after gating), and a locker with no titles renders no banner card
  at all.
- **Test-only fixture note**: `startFfUpstream()`'s season-aware branch is keyed off
  `/seasons/(\d+)/` + `view=mMatchupScore` in the request URL, so it only ever intercepts the
  new history route — the pre-existing settings/rosters fixtures (any request WITHOUT
  `view=mMatchupScore`) are byte-untouched, confirmed by every prior section (A through M)
  passing unchanged.
- **DEFERRED** (flagged in the brief, not silently dropped): **draft history import** — the
  plan's §4.8 mentions "drafts" alongside standings/matchups/champions; ESPN's draft-detail
  view (`mDraftDetail`) is a separate API call this stage never made, and a "draft history"
  page/section doesn't exist yet. **Per-owner aggregation when franchises change hands** —
  the record book aggregates by ESPN TEAM id (a franchise), which is right when the SAME slot
  changes owners (a new person takes over "Battle Kreussers") but would need an explicit
  owner-identity mapping if the family ever wants "everything Peter has ever won" to follow
  the PERSON across a team he didn't originally have — not needed for the real 8-team family
  league today, so left for if it's ever actually asked for.
- **VERIFY**: `node tools/_verify-gffl.cjs [--shots]` — **276/276, 0 page errors** (220 prior +
  56 new, section M): the whole finalize flow hand-computed end to end on one scenario (guard
  refuses with the exact pending count, force bypasses it, the doc + all three awards + the
  accuracy figure + the power-rankings snapshot are all asserted against numbers worked out by
  hand — team1 87.0 vs team2 36.0, Bust = F. Flexman shortfall 10.0, Bench Blunder = team1 left
  48.0 on the bench because a 50-point bench RB should have started over a 2-point FLEX,
  accuracy mean-miss 6.25 over 4 snapshotted starters, power scores 10.35/1.8 — plus an
  empty-roster matchup finalizing at 0-0 rather than erroring, `LG.loadStandings()` reflecting
  the week with no other change needed, the sys chat message naming all three awards, and
  idempotent re-calling touching neither the doc nor posting a duplicate message); auto-finalize
  restricted to `week < currentWeek()` proven on a REAL boundary (a genuinely finalize-able week
  2 with its own schedule + fully-final data that would ALSO pass the guard, left untouched
  purely because it's the current week); the projection snapshot's once-per-device-first-in
  contract (including a live demonstration that the BOOT-TIME auto-hook already claims the slot
  on its own before any test code runs, then clearing it to test the function in isolation), the
  already-started-game exclusion, and that a second, wildly-different attempt can never overwrite
  the first; power-rankings ordering + movement arrows on synthetic multi-week snapshots (a team
  climbing #3→#1 shows ▲2, one dropping #1→#2 shows ▼1, and a week with no prior week on file
  shows no arrows for anyone); the `gfflproj` wire end-to-end through the REAL in-process
  `farmgpt.mjs` handler + a fake xAI upstream (own port, added to the suite's existing
  fake-upstream roster) — model/system-prompt/payload-shape assertions, the returned multiplier
  actually applied to a REAL rendered projection on the matchup page (both the original and
  adjusted numbers read off the DOM, not just the JS state), the 5-minute cache holding on a
  second tap, and a full-outage pass (no XAI key, no Anthropic key configured in this suite
  either) proving the silent-degrade contract with 0 page errors.
- **Test gotcha worth keeping**: seeding `D.S.players`/`D.S.games`/`D.projFor` via two SEPARATE
  `page.evaluate()` calls looked race-prone (a stray poll timer landing between them) and the
  fix — merging setup and the call under test into ONE atomic `page.evaluate()` — didn't
  actually change the result, which is what led to finding the REAL cause: `startData()`'s own
  boot-time projection-snapshot hook had already claimed week 1's snapshot slot with genuine
  fixture data before the test's explicit call ever ran, so the test's override was silently
  irrelevant (the function's own idempotency correctly short-circuited before ever reading it).
  The fix was to prove the auto-hook fired (a positive assertion) and then clear its doc before
  testing the function in isolation — not a bug in the app, a gap in the test's own setup.
- **DEFERRED** (flagged in the brief, not silently dropped): **ESPN-projection comparison** —
  the accuracy card states only our own miss against our own snapshot; comparing against ESPN's
  live projection (available in the `ff_matchup` payload already) would need a second logged
  number per player-week and is future work if the "outdo ESPN" bet (plan §4.6) wants a real
  scoreboard. **AI-written power-rankings blurbs** — plan §4.9 mentions Grok-written commentary
  alongside the algorithmic ranking; skipped in v1 to avoid double-spending against The Nerd
  Report (`sports.html`'s existing weekly column, which already covers this ground and shares
  its Grok plumbing) — a dedicated power-rankings blurb mode is easy to add later if the two are
  meant to say different things. **Auto-polling AI read** — the brief's "every ~5 minutes per
  LIVE matchup" design is explicitly NOT built in v1 (button-triggered only); worth revisiting
  once the season is live and the cost/value of automatic mid-game adjustments can be judged for
  real rather than guessed at in preseason.

---

# 🐐 GFFL S7 — playoffs, bracket, trophies (2026-08-07)

`assets/league/lg-core.js` (the bracket engine) + `lg-ui.js` (the bracket page + league-home
card + locker trophies) + `league.html` (bracket CSS). Entirely config-driven off
`LG.rules.playoffs {teams, byes}` and `LG.rules.seasonWeeks` — a future format change needs a
rules-doc edit, not a code change.

- **Seeding**: `LG.buildBracket()` refuses (`{ok:false, reason:"weeks-not-final", missing:[...]}`)
  until every regular-season week (1..seasonWeeks) has a finalized `weekly` doc. Seeds = final
  standings, wins → PF → teamId asc (the last tiebreak is new — `LG.loadStandings()`'s own sort
  only orders wins/PF, so a genuine double-tie is broken deterministically here rather than
  leaning on `Array#sort` stability).
- **Format** (locked at 5 teams / 3 byes, but every number below is read from the rules doc,
  not hardcoded): the top `byes` seeds sit out week `seasonWeeks+1` while the remaining playoff
  seeds play `Math.floor(n/2)` play-in games, paired top-vs-bottom (seed4 vs seed5 at 3 byes).
  Week `seasonWeeks+2`'s semis pair `[bye seeds..., play-in winners...]` with STANDARD BRACKET
  SEEDING — position `i` vs position `n-1-i` — so the #1 overall seed always draws the LOWEST
  surviving seed (at 3 byes/1 play-in game that's exactly the plan's semi1 = seed1 vs the
  play-in winner, semi2 = seed2 vs seed3; the two byes seeds2/seed3 are consequently fully
  resolved the moment the bracket is BUILT, before week 15 is even played — the league-home
  matchup-card list already shows that game in week 16, well before the play-in-dependent semi
  does). Week `seasonWeeks+3` is the championship (semi winners) + 3rd place (semi losers).
- **Consolation / Toilet Bowl**: the non-playoff teams (`totalTeams - playoffCount`) round-robin
  across the SAME 3 weeks — reuses `LG.generateSchedule` verbatim (the existing double-round-
  robin generator's odd-team-count null-padding already produces exactly "one bye, one game"
  per round for an odd consolation-group size, which is precisely the "seed8 idle" shape the
  plan wants — no new scheduling code needed). The Toilet Bowl loser is whoever has the FEWEST
  wins across those 3 games once week `seasonWeeks+3` finalizes, tied by worse regular-season
  standing (later in `bracket.seeds`).
- **Two-level resolution, `LG.advanceBracket()`**: a semi's still-open side carries
  `{game, result:"winner"}`/`{"loser"}` pointing at the game that decides it; the championship
  and 3rd-place game point at the semis the same way. `advanceBracket` fills whatever it can
  from already-finalized weekly docs, one round at a time, and is a no-op once nothing NEW can
  be filled — safe to call from boot, every live poll, and after every manual "Finalize week"
  tap. The moment week `seasonWeeks+3` resolves it sets `champion`/`thirdPlace`/`toilet` in one
  pass, writes the champion's `trophies` array onto their TEAM doc (`{year, kind:"champion"}`,
  refreshing `LG.teams` immediately after — the same posture `processWaivers` already uses for
  its FAAB refresh), and posts two sys chat announcements. A tie on a bracket game (force-
  finalized, or a genuine dead-even score) goes to the home side — arbitrary but deterministic;
  the alternative (refusing to advance) would strand the whole bracket on a coin flip.
- **`LG.gamesForWeek(week)`** is the one new source of truth "what's being played this week" —
  the regular schedule for `week <= seasonWeeks`, or the bracket's currently-RESOLVED pairings
  for a playoff week (an unresolved slot is simply omitted, never guessed at). `LG.finalizeWeek`
  and the matchup-tab's `myMatchupThisWeek()` were both repointed at it (previously read
  `LG.loadSchedule()` directly) — `finalizeWeek` on a playoff week now Just Works: same guard
  (every relevant starter's game must read "post"), same awards/power-rankings computation,
  same idempotency, proven against the SAME hand-computed live fixture section M1 already uses,
  just aimed at week 15 instead of week 1.
- **`LG.loadStandings()` is now REGULAR-SEASON ONLY** (filters `week <= seasonWeeks`) — a
  playoff win must never inflate the standings/waiver-priority numbers after seeding has
  already locked in. Everything else (the record book, head-to-head, rivalries) still reads
  ALL weekly docs including the playoffs, which is exactly right — a championship-week score
  legitimately becoming the season's new "highest week ever" is a feature, not a leak.
- **UI**: a 🏆 Playoffs card on the league home — once `week > seasonWeeks` with no bracket yet,
  a commissioner-only "Build bracket" button (mirrors the pre-existing ✅ Finalize-week button's
  own gating: the button is conditionally OMITTED, not just hidden, until `isCommish()` — a
  non-commissioner sees the "hasn't been built yet" note with nothing to tap, same as they
  already did for finalize); once built, a quiet link through to `#bracket`. The bracket page
  itself: 3 columns (mobile-stacked, desktop side-by-side via a `900px` media query mirroring
  the app's own breakpoint), byes listed at the top of round 1, every resolved game a tappable
  card into its own matchup page (routes `UI.week` to that game's actual playoff week first —
  a bracket game is rarely the week you're currently browsing), an unresolved game shows its
  build-time placeholder ("Winner of #4/#5", "Loser of Semifinal 2") and isn't clickable, the
  winner's side bolds green once a score exists, and a champion/Toilet Bowl banner once decided.
  Locker rooms merge the season's OWN trophy (`team.trophies`, set the moment `advanceBracket`
  crowns a champion) alongside the S6 history banners — additive, not either/or, so a title
  shows up immediately rather than waiting for next January's ESPN import.
- **Auto-chain**: `maybeAdvanceLeague()` (boot + every live poll, same trigger `d.onUpdate`
  already used for finalization) runs finalize → build-bracket → finalize again (a fresh
  bracket may have just unlocked a playoff week's own games) → 3 rounds of (finalize, advance)
  — so a client that boots well after an entire postseason's data already exists can walk the
  whole bracket to a champion in one pass instead of needing 3 separate visits.
- **VERIFY**: `node tools/_verify-gffl.cjs [--shots]` — **380/380, 0 page errors** (314 prior +
  66 new, section O). A hand-designed 14-week regular season (4 fixed pairings repeated across
  every week — not a realistic schedule, the point is EXACT win/loss/PF totals, including one
  deliberate wins-TIE — team4 and team3 both finish 7-7 — broken ONLY by points-for) seeds
  directly as `weekly` docs (bypassing `finalizeWeek` entirely, same technique section M4
  already used for power rankings), producing seeds `[5,7,1,4,3,6,8,2]` — deliberately NOT
  team-id order, so a "seed by id" shortcut bug would fail every check. Covered: the exact
  seed/PF-tiebreak, the play-in/bye/semi/championship/3rd-place shape (including that semi2 is
  fully known at BUILD time, before any playoff game is even played), the consolation round-
  robin's bye rotation, the league-home matchup-card list at weeks 15 AND 16 (proving the
  "omit unresolved, don't guess" rule), the bracket page's byes + "Winner of #4/#5" placeholder,
  standings staying regular-season-only through the whole postseason, idempotent re-builds/
  re-advances (no duplicate chat), a full 3-round advance sequence hand-verified game by game
  (including two deliberate upsets — the play-in loser-turned-semi-winner-turned-champion
  story), the trophy landing on the team doc, both sys chat posts by name, the record book
  picking up a playoff score as the new season-high, the bracket page's champion/Toilet Bowl
  banners + bolded winners, the commissioner build-button flow (incl. the non-commissioner
  seeing no button at all until PIN-gated), and `LG.finalizeWeek` driven for real against the
  live-engine fixture on a playoff week (same hand-computed totals as M1: team1 87.0 vs team2
  36.0), proving `gamesForWeek`'s bracket branch feeds the real finalize flow correctly.
- **Test gotchas worth keeping**: `.replace(/\s+/g," ")` (used to normalize rendered text for
  regex matching) collapses a team's own literal double space too ("Nails  For Breakfast" reads
  as single-spaced once whitespace is normalized) — match single-space against normalized text,
  the RAW two-space name only survives in un-normalized checks. A conditionally-rendered
  commissioner-only button (the bracket-build button is OMITTED from the DOM, not just
  `hidden`-attributed, exactly like the pre-existing ✅ Finalize-week button) can't be clicked
  into existence the way `#historyImport`'s always-present-but-`hidden` button can — call
  `LG.gateCommish()` directly first to unlock commissioner status, THEN render, THEN look for
  the button.
- **DEFERRED** (flagged in the brief, not silently dropped): **multi-week championship** — the
  plan's format is a single week-17 game; a best-of/two-leg championship option isn't built.
  **Bracket reseeding knobs** — e.g. re-seeding after the play-in round (rather than the fixed
  standard-bracket pairing used here), or a "no byes" / "more play-in rounds" format for a
  larger league, would need `LG.buildBracket`'s round2 pairing logic generalized further; the
  current algorithm is proven correct for the locked 5-team/3-bye shape and reasonable for
  nearby shapes (any single play-in round), but hasn't been exercised against, say, a 6-team/

## 🎨 GRIDIRON LEAGUE — visual re-skin (2026-08-07)

The user approved a design ("Gridiron League") from `design_handoff_fantasy_app` and asked for
it recreated over the live app — a RE-SKIN, not a rewrite: every id/class/render function stays,
`tools/_verify-gffl.cjs` needed zero behavior restages (only two additions, both new checks for
new geometry — see below), **380/380 → 385/385**.

**The system**: dark broadcast/scoreboard palette as CSS custom properties (`--bg #131315`,
`--card #1B1C1F`, `--nested #26282D`/`--nested2 #202226`, `--border-card #2B2D32`, ink/mut/faint
text scale, `--accent #D0454C`, win-green `--green #3E9B5F`, gold `--gold #C98F1B` for the champ
banner). Typography: **Barlow Condensed** 500/600/700 for every score/label/button (uppercase,
letter-spacing) via one Google Fonts `<link>` + preconnect, **Public Sans** for body copy — both
degrade to system stacks (`--font-display`/`--font-body` end in `system-ui,sans-serif`) since the
verify harness (and any offline device) blocks the fonts.googleapis.com request outright; nothing
about the layout depends on the webfont actually loading. Radii/spacing/button treatment
(primary=accent fill, everything else=a neutral secondary chip) follow the handoff's scale.

**Wordmark**: "The GFFL" kept (not renamed to "Gridiron League" — that's the design SYSTEM's
name, not this league's; same adaptation as any Bucky re-skin keeping the product's own identity)
with "GFFL" split into its own `<span class="accentword">` so it reads red, mirroring the
mockup's "Gridiron **League**" split-color wordmark.

**Nav**: mobile bottom bar restyled per spec (uppercase, active=accent color only, no background
tint, emoji icons dropped — "no emojis anywhere by design" — labels alone). Desktop (≥1024px):
`header` + `#bnav` are deliberately kept as TWO SEPARATE ELEMENTS (not merged into one row) —
`header` sets `backdrop-filter`, and in Chromium a `backdrop-filter`/`filter`/`transform` ancestor
becomes the containing block for any `position:fixed` descendant. `#bnav`'s mobile bottom bar
relies on `position:fixed`; nesting it inside `header` was tried first and would have silently
confined that fixed positioning to the header's own 52px box instead of the viewport, breaking
the bottom nav on phones. They're styled to share one background with no border between them
instead — reads as the mockup's single top-nav strip without the risk. `#bnav` switches to
`position:sticky` under the header at desktop (was `position:static` in the first draft — that
let it scroll away with the page, a real regression from the original app's own sticky desktop
nav). A new `#hMeta` (Week N · Season + a small team-initials/logo avatar, click → locker) lives
in `header`, hidden below 1024px, populated by a new `paintHeader()` called once per `UI.show()` —
bound to a static header element, so the click handler on the avatar is wired ONCE at boot
(`league.html`'s inline script) rather than through the per-render `wireLockerTaps()` convention,
which would have stacked a duplicate listener on every navigation (that convention is only safe
for content inside `main()`, which is fully replaced — never appended to — on every render).

**League home**: the "My Matchup" card (`.mucard.mine`) is visually promoted to a hero — CSS
`grid-column:1/-1; order:-1` inside a new `.mugrid` wrapper (`display:grid;
grid-template-columns:repeat(auto-fit,minmax(140px,1fr))`) so it spans full width and sorts first
while every OTHER matchup card renders smaller alongside it, all still literally `.mucard`
buttons (the suite's `.mucard.mine`/`.mucard` count/text assertions never had to change). A new
`matchupHeroExtra()` adds a LIVE/FINAL badge + a mini win-probability bar to the hero only, reusing
`d.remaining()`/`d.winProb()` — the exact functions the Matchup page already calls — so the home
hero can never disagree with the dedicated page. The hero's OWN grid had to be reworked a second
time after a first-pass screenshot showed team names wrapping into 3 lines on one side and
truncating with an ellipsis on the other: keeping the compact card's `[name | score | name]`
3-column shape at the hero's bigger 32px type left too little room either side. Fixed by giving
`.mucard.mine` its own `grid-template-columns:1fr 1fr` + 3 rows — names on row 1 (one full column
each), the combined score centered full-width on row 2, badge/win-prob full-width on row 3.
`.muscore`'s exact-string content (`"4.0 — 41.0"`, one element, tested verbatim) is untouched —
only its GRID PLACEMENT differs under `.mine`.

**Matchup page**: 44px initial-circle avatars added (`avatarHtml()` — logo image if the team has
one via the same `.logo` field `logoTd()` already reads, else colored-circle initials; mine=accent
bg, opponent=neutral per spec), a "Proj N" line under each team's live score (summed from
`d.projFor()` over that team's starters — a new number, computed from an existing per-player
function, never invented), and a LIVE/FINAL indicator between the scores (same `d.remaining()`
call the page already made for the "N to play · N live" lines). None of the required text nodes
moved — `.bigpts` stays in DOM order [away, home] and the "N to play · N live" string stays inside
`.muhteam`, both still exact-matched by the suite.

**A real CSS specificity bug, caught before it shipped**: the first pass gave every "default"
button a shared look via `button:not(.mucard):not(.lrow):not(.swaprow):not(.teamrow):not(.bgame)
{...}`, intending it as a low-priority fallback. Each `:not(.x)` clause counts as a class for
specificity purposes — eight of them gave that "fallback" rule specificity (0,8,1), which OUTRANKS
`.mucard`/`.lrow`/`.bnav button`/etc. outright and would have silently overridden their
backgrounds/padding/colors back to the generic dark pill. Replaced with a plain low-specificity
`button {...}` base rule (specificity (0,0,1)) that every real class-based override naturally
beats — the same shape the original stylesheet already used, and the right lesson for why.

**A second real leak, also caught by looking at a screenshot, not by the suite**: that base
`button` rule sets `text-transform:uppercase` + `letter-spacing`, and `text-transform` inherits.
`.mucard`/`.lrow`/`.swaprow`/`.teamrow`/`.bgame` are ALL `<button>` elements whose children (team
names, player names) never declare their own `text-transform` — so without a fix every natural-
case name on the page would have rendered in caps. Fixed by declaring `text-transform:none;
letter-spacing:normal;` directly on those five row classes, which — as a direct rule on the
element itself — wins outright over inheritance and correctly cascades back down to any child
that doesn't set its own value (child spans that DO set their own `letter-spacing`, like
`.muteam`, were already fine either way).

**A real functional bug, found in the Matchup screenshot**: player rows were overflowing the card
sideways on a 390px phone, hiding the position badge and the opposing player entirely behind a
horizontal scroll. Root cause: `.tbl td { white-space:nowrap }` (needed elsewhere, so standings
rows stay single-line) is a DESCENDANT selector that also matches the Matchup page's own table
(`<table class="tbl mutable">` carries both classes) — under the browser's default
`table-layout:auto`, a `<td>` forbidden from wrapping is sized to its unwrapped content width
regardless of its declared `%`, so a long player name/meta string forced that column wider than
its 50% share. Fixed with `table.mutable { table-layout:fixed }` (locks column widths to their
declared shares regardless of content) plus `table.mutable td { white-space:normal }` (a higher-
specificity override so THIS table's cells may wrap within their now-fixed width); `.pcell`/
`.slotcell` widths adjusted to sum to 100% (43%/14%/43%) since mixing a `%` pair with a fixed-px
badge column doesn't add up cleanly under `table-layout:fixed`.

**Team/roster, Moves, Chat, Rules, Lockers, Bracket**: no markup changes — the token/typography/
card/button/table system alone carries them, since they were already built from `.card`/`.lrow`/
`.swaprow`/`.teamrow`/`.bgame`/`table.tbl`/chat-bubble primitives shared with the screens above.
One extra fix while reviewing the Moves screenshot: the trade-partner `<select>` had never been
styled (the original app only styled `input`) and rendered as a jarring native white box against
the dark card — `select` folded into the same input rule, plus `color-scheme:dark` so the native
option-list popup is dark too, not just the closed control. Locker keeps its per-team extracted-
palette header (`.lockerhead`'s inline `background`, driven by `extractPalette()`) unchanged —
the suite's one `getComputedStyle` check (that the header background is a real, non-default
reddish `rgb()`) still holds since that's set inline, not by the stylesheet.

**Desktop (≥1024px)**: `main{max-width:1200px}`, `main[data-view="league"]` gets a cheap
`column-count:2` (3 above 1360px) via a new `main().dataset.view = name` set once at the top of
`UI.show()` — CSS-only "multi-column dashboard" feel without restructuring any card's own markup,
per the brief's "do NOT restructure component internals" instruction. Top-nav underline style on
`#bnav`'s buttons (`border-bottom:2px solid transparent`, accent when `.on`).

**Verify**: `node tools/_verify-gffl.cjs --shots` — **385/385, 0 page errors** (380 prior + 2 new:
a dedicated 1440px league-home pass asserting the desktop nav is `position:sticky` not the mobile
fixed bar, the multi-column treatment is live, and `#hMeta` is visible — restaged once, from an
overly-specific "exactly 2 columns" to "≥2 columns," since 1440px correctly clears the
stylesheet's OWN 1360px→3-column step; and a Moves-page screenshot, not required by the brief but
cheap given the page was already mid-flow in an existing test). Shots: `gffl_league_390.png`,
`gffl_matchup_390.png`, `gffl_bracket_390.png`, `gffl_league_desktop_1440.png` (the four the brief
asked for) + `gffl_matchup_desktop.png`/`gffl_moves_390.png`/`gffl_team_390.png`/
`gffl_chat_390.png`/`gffl_rules_390.png`/`gffl_locker_390.png`/`gffl_recordbook_390.png`/
`gffl_ai_read_390.png`/`gffl_bracket_final_390.png`/`gffl_matchup_thread_390.png` (pre-existing
capture points in the suite, now rendering the new system). NOT pushed/committed — re-skin only,
per the task's ground rules.

  2-bye/2-play-in-game format.

---

# PLAYTEST FIX BATCH (2026-08-08) — perf, 2025 test data, merged locker, Scores tab

Five items from live user feedback after actually playing the deployed app. All in the working
tree, uncommitted. Suite: **456/456, 0 page errors** (was 385 baseline going in).

## 1 · PERF — LG.db grew a doc-level cache (the priority complaint: "not snappy moving between tabs")

Diagnosed for real before guessing: every view (league/matchup/locker/moves/chat/rules/bracket)
re-fetched teams/rosters/weekly/tx/claims/trades through `LG.db` on EVERY tab switch, and on the
cloud backend each of those is a real Firestore round trip — several cards (record book,
power rankings, tx log, chat preview) each ran their OWN full-collection `list()`. Separately, the
boot auto-checks (`maybeAutoProcessWaivers`/`maybeAutoExecuteTrades`/`maybeAdvanceLeague`) were
wired into `renderMoves()` and the live poll's `d.onUpdate`, so the whole chain re-ran on every
paint and every ~15s live tick.

**Fix, `LG.db` (lg-core.js)**: an in-memory `docCache` (id→doc) + `listCache` (kind→{docs,at,
refreshing}) sit in front of the existing local/cloud backend split. A cache hit resolves in the
same microtask — no I/O — so a view can paint SYNCHRONOUSLY from cache on tab switch and let fresh
data arrive quietly in the background. `set()`/`del()` update both caches in place (optimistic —
this page's own writes are instantly visible without a round trip). On the CLOUD backend only, a
`list()` call whose cached copy is >15s old (`CACHE_STALE_MS`) fires a background refetch; if the
fresh result actually differs, `LG.db.onChange(kind)` fires and lg-ui's registered handler quietly
re-shows the current view. Local mode (every test in this suite, and any offline session) never
does the background refetch at all — the cache is simply always current, since every write on this
device goes through the same `LG.db.set()`.

`"chat"` is the ONE kind deliberately EXEMPTED from list-caching: message ids are minted by any
client at any time and the app already has its own explicit poll cadence for it (8s) — caching
it would make new messages read as stale exactly where staleness matters most.

**Idempotency guards bypass the cache on purpose**: the five "re-read right before the final
write, in case another device already got there first" races (`processWaivers`, `executeTrade`,
`finalizeWeek`, `buildBracket`, `snapshotProjections`) now call `LG.db.getFresh(id)` instead of
`LG.db.get(id)` at exactly their guard line — genuinely bypasses both caches and reads the real
current backend state, which is the one place a stale local cache would be actively dangerous
(the earlier double-count/double-post class of bug).

**Auto-checks throttled**: `runAutoChecks(force)` runs the same three functions it always did, but
now at most once per `AUTO_CHECK_MS` (60s) except at boot (`force:true`, so "open the app past a
deadline" still carries the league forward immediately) and any DIRECT call the test suite makes
to the underlying functions themselves. `renderMoves()` and `d.onUpdate` both switched from
calling the chain unconditionally to `runAutoChecks(false)`.

**A real bug the new caching layer introduced, found and fixed** (not shipped, caught by the
suite's own "extracted colour is stored on the team doc" check going from passing-before-this-
work to genuinely failing after it, then root-caused rather than special-cased away):
`cacheUpsert()`'s list-row builder was `{ id, ...doc }` — id spread FIRST. A LOT of call sites
round-trip an in-memory object straight back into `set()` (`LG.saveTeam({...T, teamId, colors})`,
where `T` itself carries the numeric `id` `loadTeams()` stamps onto every in-memory team), and
that stray `.id` field silently clobbered the real string doc-id inside the cached row. The NEXT
upsert's own `findIndex` could then never find the row it had just written, pushed a stale
DUPLICATE onto the list instead of updating in place, and array order made `LG.teamById()` return
the pre-edit team FOREVER (a saved logo/colour genuinely never stuck). Fixed by spreading id LAST
(`{ ...doc, id }`) so the real doc-id always wins over anything sitting inside the doc itself —
this is a general fix at the one shared choke point, so it protects every doc kind, not just
teams. Regression-guarded going forward (Section L: logo AND colour both survive two consecutive
saves, `LG.teams` has exactly one row per team id afterward).

**Measured, `--shots`-free instrumentation in the suite (`LG.db.stats` gets/lists/sets/dels/
fresh counters, plus `LG.db._installFakeCloud()` test hook)**: a second full League render makes
ZERO additional real `.get()` calls and at most one `.list()` (chat, deliberately uncached); a
fake cloud backend at 60ms/call takes ~915ms on the FIRST visit and ~70ms on a second visit to the
exact same view; the auto-check chain runs once at boot, stays throttled through 2 direct calls +
a poll tick + a Moves visit, and fires again once the 60s window passes. Verify: Section P,
`node tools/_verify-gffl.cjs`.

## 2 · 2025 TEST DATA — a commissioner "🧪 test run" importer, separate from the live importer

The 2026 ESPN league is pre-draft (every roster empty) until the season starts, so there was
nothing real to exercise lineups/waivers/trades/scoring against yet. New server action
`lg_espn_rosters_season` (netlify/functions/league.mjs, ADD-ONLY — the live `lg_espn_rosters`
action is untouched, its inline mapping logic was pulled into a shared `mapRosterTeams(j)` helper
both actions now call) seeds THIS WEEK'S GFFL rosters from a real, FINISHED past season instead —
default 2025, `body.season` overridable. Same `mRoster`/`mTeam` view, same
`applyImportedRosters()` slotting rule client-side as the live importer (a shared helper factored
out of `importRosters()`), so lineups/waivers/trades built against it behave identically to a real
in-season import.

**Past-season retry ladder** (the kicker-audit/history-import finding): a past-season `mRoster`
read sometimes needs `scoringPeriodId=0` appended to actually return roster entries — the plain
URL can come back with a real team shell but an EMPTY roster. `lgEspnRostersSeason` tries the
plain URL first, and only retries with `scoringPeriodId=0` if the first response's every team has
zero roster entries. Cookie-gated (`fantasy-not-configured`) and auth-expiry-gated
(`fantasy-auth-expired`) exactly like every other ESPN action in this file; an out-of-range season
clamps to the 2025 default rather than erroring.

**Rules page**: a third button, `🧪 Import 2025 rosters (test run)`, sits beside the existing
`👥 Import ESPN rosters` and `📜 Import history` (all three commissioner-gated, all three
rendered — just `hidden` — for everyone else, same as before). A short paragraph explains WHY it
exists (2026 is pre-draft) and what it does (seeds from the real, final 2025 season) so the three
importers read as one coherent toolkit rather than an unlabeled row of buttons. Success message
names the source season and reminds the commissioner to re-import real rosters once the real
draft happens.

Verify: server-side retry ladder + cookie/range guards + live-importer non-interference in
Section A; the Rules-page button flow (before/after roster contents, IR slot + injury carried,
the locker's lineup editor picking up the new roster immediately, non-commissioner sees nothing)
in Section Q.

## 3 · MY TEAM = LOCKER — one page, not two

The separate `renderTeam()` view (the old lineup editor) is GONE. "My Team" now routes straight
into the same locker page every team's name-tap already opened (`#locker=<id>`), with the
tap-to-swap/kickoff-lock/3-IR lineup editor embedded as the locker's OWN roster section for the
locker's OWNER — `UI.show("team")` redirects to `#locker=<myTeamId>` and sets `UI.view = "locker"`
before rendering, so the "team" view name still works as a routing target (and the bottom nav's
"My Team" button still highlights correctly, via a small `myLocker` special-case in the nav
highlight logic) without a second parallel code path existing anywhere. Every other team's locker
keeps the exact read-only roster table it always had — `isOwner = LG.myTeamId() === teamId` is the
only branch. Kickoff locks, IR-eligibility, the swap sheet, and the roster-doc persistence shape
are byte-for-byte the same mechanics `renderTeam()` used to run, just relocated.

The old `#myLockerBtn` (a button ON a team page that opened "your own locker" as a separate step)
is gone too — pointless once My Team IS the locker; nav clicks now land directly on the viewer's
own locker with no extra tap.

Restaged with reasons, not silently changed: Section E's header/comment now says "(now the
owner's own locker)"; its selectors moved from the old team-page ids to `#lockerStarters`/
`#lockerBench`/`#lockerIR`; new assertions confirm `UI.view === "locker"`,
`UI.lockerTeamId === myTeamId`, and the nav button's `.on` class. Section L's old "My locker
button" flow is now "tapping My Team nav from someone else's locker jumps straight to the
VIEWER's own locker" — proves the same reachability the button used to provide, through the nav
alone.

**One deliberate scope decision**: an experiment to also live-repaint the owner's own locker on
every poll tick (mirroring how matchup/league already do) was tried and REVERTED — `renderLocker()`
has no lightweight "repaint" mode (unlike the old `renderTeam(true)`'s cheaper fast path), and
replacing `main().innerHTML` out from under an in-progress interaction (the swap sheet open, a
logo upload mid-flight) is a real regression, not just a missed optimization. The lineup's
points/proj simply refresh next time the locker is opened. Left as a comment in `paintLive()`
rather than silently dropped.

Verify: Section E (owner lineup editing on the merged page) + Section L (locker record/roster/
schedule/tx/wall/editing/palette, non-owner read-only, nav reachability).

## 4 · LEAGUE HOME ADDITIONS — recent moves + league chat, collapsed like the record book

Two new `<details class="collapsecard">` cards on the league home, same collapsed-by-default
posture as the existing `.recordbook` card (a new class rather than reusing `.recordbook` itself —
tried first, then reverted: sharing the class broke every existing `document.querySelector(
".recordbook")`-based check, since the new cards render earlier in DOM order and silently became
the thing those selectors found instead of the real record book; the disclosure CSS rules were
duplicated onto a combined `.recordbook, .collapsecard` selector so both look identical without
either shadowing the other).

**🔁 Recent moves**: the last 8 tx-log sentences (reusing `txSentence()`, the exact wording the
full Moves log already uses) + a "View all →" link into Moves. **💬 League chat**: the last 6
main-channel messages, sys posts included (they ARE the league's own timeline, not noise to
filter) + an "Open chat →" link into Chat. Both ride the SAME `LG.loadTx()`/`LG.loadChat(null)`
calls `renderLeague()` already made for other cards — no new network cost, and (per item 1) both
kinds are cache-served on a second visit.

Verify: Section R — both caps genuinely exercised (10 tx entries → exactly 8 shown, the two
oldest trimmed; 8 chat messages → exactly 6 shown), a sys post appears in the preview, both links
navigate. Test note: `LG.logTx()` timestamps off a raw `Date.now()` call (not the overridable
`LG.now()`), and a tight synchronous seeding loop on the local backend can genuinely land several
calls in the same millisecond — the suite patches `Date.now` itself for the seeding block
(restored immediately after) so "most recent" has an unambiguous, deterministic answer rather than
depending on `Array.sort`'s tie-breaking behavior.

## 5 · SCORES TAB — real NFL slate + the family's ESPN fantasy scoreboard

A sixth bottom-nav tab, `Scores` (`view: "scores"`). **NFL half**: `pollScoreboard()`
(lg-data.js, already running as part of the existing live-scoring poll loop) now ALSO builds the
full week's slate — one entry per game, not per tracked team — into `D.S.nflEvents`; a light
parallel read of the exact same public no-key `site.api.espn.com` endpoint the per-team loop
already polls, so zero new network cost. `nflScoresHtml()` groups games by calendar day, shows
live games with their in-progress clock/period in red (`.gmrow.live`) and upcoming games with
their kickoff time; `paintScores()` repaints this half on every live poll tick via the existing
`paintLive()` dispatch (no separate timer needed — it rides the engine's own cadence).

**Fantasy half**: a genuinely separate call to the ALREADY-DEPLOYED `sports.mjs` function's
`ff_scoreboard` action (family-secret-gated, same `LG.PASS`), rendered as an "ESPN league (live)"
card. Its own poll timer — 25s while the tab is open and any NFL game is live, else 2min —
started in `renderScores()` and explicitly cleared the instant the tab is switched away from
(`stopScoresPoll()`, called from `UI.show()`'s teardown alongside the existing `stopChatPoll()`).
Degrades to hiding the card ENTIRELY on any failure (`{ok:false}` — unconfigured league, expired
cookie, network hiccup): the NFL half is fully independent and keeps working regardless.

**Test infra note**: `sports.mjs` needed its OWN fixture upstream, dedicated (`SPORTS_FF_PORT`,
distinct from the `FF_PORT` `league.mjs`'s own history importer already uses — the two fixtures
are shaped for different meanings of "roster/matchup data" and would collide if shared) and its
own in-process import with `SPORTS_FF_BASE_URL` temporarily repointed at import time (module-level
consts in `sports.mjs` capture the env var once, at import — the same gotcha `league.mjs` itself
has). Puppeteer's request interception in `newTestPage()` gained a third routed prefix,
`/.netlify/functions/sports`, alongside the existing `/league` and `/farmgpt` routes.

Verify: Section S — nav presence + highlight, live game (both teams, both scores, in-progress
clock, marked `.live`) scoped to its own row (not a whole-page substring match, which risks
colliding with unrelated digits elsewhere on the page), an upcoming game grouped into its own
day header, the fantasy card's own matchups (family's team + the rest of the league), the
degrade path driven through the REAL in-process `sports.mjs` handler with `ESPN_S2`/`ESPN_SWID`
genuinely deleted for that one request (not a client-side stub — proves `ffScoreboard()`'s actual
failure branch, not an approximation of it), and the poll timer armed/cleared across a tab switch.

## FYI, flagged but explicitly out of scope this batch

While designing the getFresh regression test for item 1, found that `processWaivers`'s roster/
team/tx WRITES happen UNCONDITIONALLY before its final idempotency-guard check (`fresh.processed`)
— only the LAST doc-write is actually guarded, so two genuinely concurrent devices processing the
same week's waivers could both compute and write duplicate roster/tx changes before either one's
guard fires. This is PRE-EXISTING (predates this batch's caching work entirely) and was
deliberately NOT touched — fixing a write-ordering race in the waiver-processing engine itself is
a different, larger piece of surgery than "add a doc cache," and redesigning it under this
session's scope risked a regression in the one system this app can least afford to get wrong
(real money — FAAB budgets). Worth a dedicated pass on its own.
