# 🐐 THE GOAT LEAGUE — plan of record for our own fantasy football app

Working title: **The GOAT League** (the family mascot is literally a goat; rename freely).
Replaces the ESPN app for the 8-team "Nerd Fantasy Football League" (keeper, PPR).
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
- **Recommendation: FAAB** ($100 budget, blind bids, ties by reverse standings) — more
  strategic and more fun than rolling priority; the rules doc supports both.
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
Rules-doc driven: default **4 teams, weeks 15–17** (semis + championship + 3rd place),
options for 6-team with byes; seeding record → points-for. Consolation bracket for the
rest, and a **Toilet Bowl** for last place (see 5). Bracket page with live matchup
links; champion gets the banner, the trophy room entry, and a chat takeover.

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

## 7 · Costs & risks

- **Running cost ≈ $0 + AI pennies**: Sleeper/ESPN keyless, Firestore free tier,
  Netlify existing, Grok/Sonnet on existing keys (~cents/week at family volume;
  usage lands in the existing dashboard buckets).
- **Sleeper API is unofficial**: stable for years, but if it ever shuts, the ESPN box
  parser (proven in fftest) is the fallback for stats, and scoring is ours either way.
- **ESPN cookie expiry** touches only history import — refresh yearly or don't.
- **Preseason ≠ regular season**: fftest ran on one game; S2's gate is a full Sunday
  slate test in preseason weeks 2–3.
- **Two sources disagreeing**: display rule — Sleeper is authoritative for stats,
  ESPN for game state; discrepancies > 0.5 pts get a ⚠ and resolve at finalization.

## 8 · Open questions for the family

1. FAAB vs rolling waiver priority? (Plan recommends FAAB $100.)
2. Playoff size — 4 or 6 of 8? (Plan defaults 4; 6-of-8 makes the regular season
   nearly meaningless.)
3. Trade veto: commissioner-only (default) or league vote?
4. Keeper rules to encode: how many keepers, round cost, years allowed?
5. App name: The GOAT League? (The draft room and Nerd Report brands already exist.)
6. Do we run it PARALLEL with ESPN for season 1 (shadow mode — same league mirrored,
   switch when trust is earned) or cut over cold? **Plan recommends shadow season**:
   run the ESPN league as normal, our app reads the same reality, and by December we
   know exactly what's missing with zero risk to the season.
